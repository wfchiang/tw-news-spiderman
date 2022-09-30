'use strict'; 

const uuid = require('uuid');
const URL = require('url'); 

// Imports the Google Cloud client library
const {Datastore} = require('@google-cloud/datastore');

// Creates an expression app 
const express = require('express'); 
const app = express(); 

// Defines express's error handler 
function defaultErrorHandler (err, req, res, next) {
    res.status(500).send({'error': err}); 
}

app.use(defaultErrorHandler); 

// Creates a datastore client
const datastoreClient = new Datastore(); 
const datastoreKind = 'web_news'; 

// Defines a helper function for inserting data into Datastore 
async function insert2Datastore (host, url, title, content) {
    let id = uuid.v4(); 

    // The Cloud Datastore key for the new entity
    const taskKey = datastoreClient.key([datastoreKind, id]);

    // Prepares the new entity
    const task = {
        key: taskKey,
        data: [
            { name: 'host', value: host }, 
            { name: 'url', value: url }, 
            { name: 'timestamp', value: new Date() }, 
            { name: 'title', value: title, excludeFromIndexes: true }, 
            { name: 'content', value: content, excludeFromIndexes: true }
        ],
    };

    // Saves the entity
    await datastoreClient.save(task);
    // console.log(`[DEBUG] Saved ${task.key.name}: ${JSON.stringify(task.data)}`);
}

// Creates a crawler "spiderman"
const Crawler = require('crawler');
const { resolveSoa } = require('dns');
let maxVisitedUrls = 100; 
let sleepTimeMs = 1000; 
let visitedUrls = []; 

const crawlerInstance = new Crawler({
    maxConnections: 10,
    callback: (error, res, done) => {
        if (error) {
            console.log(error);
        } else {
            if (res.statusCode == 200) {
                // Prepare the page parsing 
                const $ = res.$; 
                
                let urlHost = res.request.uri.host; 
                let urlOrigin = new URL.URL(res.request.uri.href).origin; 
                let thisUrl = res.request.uri.href; 
                let title = ''; 
                let content = ''; 
                let hrefs = []; 

                // go analyzing the web page 
                if (!visitedUrls.includes(thisUrl) && visitedUrls.length < maxVisitedUrls) {
                    visitedUrls.push(thisUrl); 
                    console.debug('Analyzing URL: ' + thisUrl); 

                    // sleep before analyzing 
                    // delay(sleepTimeMs); 

                    // extract all hrefs of the same host 
                    $('a').each((i, aitem) => {
                        let subHref = $(aitem).attr('href'); 
                        subHref = new URL.URL(subHref, urlOrigin).href; 

                        if (urlHost == new URL.URL(subHref).host) { 
                            if (!visitedUrls.includes(subHref)) {
                                crawlerInstance.queue(subHref);
                            }
                        }
                    }); 

                    // extract the webpage content 
                    if (urlHost.includes('setn.com')) {
                        title = $('h1').text() + ' ' + $('h2').text(); 
                        content = $('.page-text article').text(); 
                    }
                    else if (urlHost.includes('tvbs.com.tw')) {
                        $('.title_box').find('h1').each((i, elem) => {
                            title = (title + ' ' + $(elem).text()).trim(); 
                        }); 
                        $('.title_box').find('h2').each((i, elem) => {
                            title = (title + ' ' + $(elem).text()).trim(); 
                        }); 

                        $('.article_content').find('body').each((i, elem) => {
                            $(elem).contents().each((ii, subElem) => {
                                if (subElem.type == 'text') {
                                    content = (content + ' ' + $(subElem).text()).trim(); 
                                }
                            });
                        }); 
                    }
                    else { 
                        title = ''; 
                        content = $('body').text(); 
                    }
                    
                    // save the new record 
                    insert2Datastore(
                        urlHost, 
                        thisUrl, 
                        title, 
                        content 
                    ); 
                }
            }
            else {
                console.info('Error status (' + String(res.statusCode) + ') returned from URL ' + res.request.uri.href); 
            }
        }
        done();
    }
});

// Defines endpoints 
app.get('/', (req, res) => {
    res.send({
        'maxVisitedUrls': maxVisitedUrls, 
        'visitedUrls.length': visitedUrls.length
    }); 
}); 

app.get('/clearVisitedUrls', (req, res) => {
    visitedUrls = []; 
    res.send({'message': 'ok'}); 
}); 

app.get('/setMaxVisitedUrls', (req, res) => {
    let value = req.query.value; 
    try {
        value = parseInt(value); 
        if (value > 0) {
            maxVisitedUrls = value; 
            res.send({'message': 'ok'}); 
        }
        else {
            res.send({'error': 'maxVisitedUrls must be greater than 0'}); 
        }
    } catch (err) {
        res.send({'error': err.message}); 
    }
}); 

app.get('/craw', (req, res) => {
    let urlToCraw = req.query.url; 
    if (typeof(urlToCraw) == 'string') {
        console.debug('Received URL: ' + urlToCraw); 
        crawlerInstance.queue(urlToCraw); 
        res.send({'message': 'ok'}); 
    }
    else {
        res.send({'error': 'Invalid URL to craw'}); 
    }
});

// Setup the app 
const PORT = parseInt(process.env.PORT) || 8080; 
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}...`); 
}); 

module.exports = app; 
'use strict'; 

const uuid = require('uuid');
const URL = require('url'); 

// Imports the Google Cloud client library
const {Firestore} = require('@google-cloud/firestore');

// Creates an expression app 
const express = require('express'); 
const app = express(); 

// Defines express's error handler 
function defaultErrorHandler (err, req, res, next) {
    res.status(500).send({'error': err}); 
}

app.use(defaultErrorHandler); 

// Creates a firestore client
const firestoreClient = new Firestore(); 
const firestoreKind = 'web_news'; 
const firestoreCollectionRef = firestoreClient.collection(firestoreKind); 

// Define a function for delaying execution 
function delayExe (timeInMs) {
    return new Promise(resolve => setTimeout(resolve, timeInMs)); 
}

// Defines a helper function for inserting data into Firestore 
async function insert2Firestore (host, url, title, content) {
    let id = uuid.v4(); 

    let expirationDate = new Date(); 
    expirationDate.setDate(expirationDate.getDate() + 30); 

    await firestoreCollectionRef.doc(id).set(
        {
            'host': host, 
            'url': url, 
            'timestamp': new Date(), 
            'expiration': expirationDate, 
            'title': title, 
            'content': content
        }
    ); 
}

// Creates a crawler "spiderman"
const Crawler = require('crawler');
let crawlingQuota = 3;
let usedCrawlingQuota = 0;  
let sleepTimeMs = 2000; 
let visitedUrls = new Set([]); 

const crawlerInstance = new Crawler({
    maxConnections: 1,
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

                // sleep before analyzing 
                delayExe(sleepTimeMs * (Math.random() + 1.0)).then(() => {
                    // go analyzing the web page 
                    if (visitedUrls.has(thisUrl)) {
                        console.debug('Skipping the visited url: ' + thisUrl); 
                    }
                    else if (usedCrawlingQuota >= crawlingQuota) {
                        console.debug('Running out of crawling quota...'); 
                    }
                    else {
                        console.debug('Analyzing URL: ' + thisUrl); 
                        visitedUrls.add(thisUrl); 
                        usedCrawlingQuota = usedCrawlingQuota + 1; 

                        // extract all hrefs of the same host 
                        $('a').each((i, aitem) => {
                            let subHref = $(aitem).attr('href'); 
                            subHref = new URL.URL(subHref, urlOrigin).href; 

                            if (urlHost == new URL.URL(subHref).host) { 
                                if (!visitedUrls.has(subHref) && usedCrawlingQuota < crawlingQuota) {
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
                        insert2Firestore(
                            urlHost, 
                            thisUrl, 
                            title, 
                            content 
                        ); 
                    }
                });
            }
            else {
                console.info('Error status (' + String(res.statusCode) + ') returned from URL ' + res.request.uri.href); 
            }
        }
        done();
    }
});

// (Pre-)load the visitedUrls
async function listVisitedUrls () {
    let firestoreQuery = firestoreCollectionRef.select('url'); 
    firestoreQuery.get().then(querySnapshot => {
        visitedUrls = new Set(querySnapshot.docs.map((doc) => doc.data().url)); 
    }); 
}

listVisitedUrls(); 

// Defines endpoints 
app.get('/', (req, res) => {
    res.send({
        'crawlingQuota': crawlingQuota,
        'usedCrawlingQuota': usedCrawlingQuota,  
        'visitedUrls.size': visitedUrls.size
    }); 
}); 

app.get('/listVisitedUrls', (req, res) => {
    res.send(Array.from(visitedUrls)); 
}); 

app.get('/reListVisitedUrls', (req, res) => {
    listVisitedUrls().then(() => {
        res.send(Array.from(visitedUrls)); 
    }); 
}); 

app.get('/setCrawlingQuota', (req, res) => {
    let value = req.query.value; 
    try {
        value = parseInt(value); 
        if (value > 0) {
            crawlingQuota = value; 
            res.send({'message': 'ok'}); 
        }
        else {
            res.send({'error': 'crawlingQuota must be greater than 0'}); 
        }
    } catch (err) {
        res.send({'error': err.message}); 
    }
}); 

app.get('/resetUsedCrawlingQuota', (req, res) => {
    let value = req.query.value; 
    try {
        value = parseInt(value); 
        if (value > 0) {
            usedCrawlingQuota = value; 
            res.send({'message': 'ok'}); 
        }
        else {
            res.send({'error': 'usedCrawlingQuota must be greater than 0'}); 
        }
    } catch (err) {
        res.send({'error': err.message}); 
    }
}); 

app.get('/crawl', (req, res) => {
    let urlToCrawl = req.query.url; 
    if (typeof(urlToCrawl) == 'string') {
        console.debug('Received URL: ' + urlToCrawl); 
        crawlerInstance.queue(urlToCrawl); 
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
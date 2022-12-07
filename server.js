'use strict'; 

const os = require('os'); 
const uuid = require('uuid');
const URL = require('url'); 
const fs = require('fs');

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
let visitedUrls = new Set([]); 

let skippedBeforeAnalysis = {
    'noQuota': 0, 
    'visited': 0
}; 
let skippedAfterAnalysis = {
    'noQuota': 0, 
    'visited': 0 
}; 

const crawlerInstance = new Crawler({
    rateLimit: 1000,
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
                if (usedCrawlingQuota >= crawlingQuota) {
                    // console.debug('Running out of crawling quota...'); 
                    skippedAfterAnalysis['noQuota'] = skippedAfterAnalysis['noQuota'] + 1; 
                }
                else {
                    console.debug('Analyzing URL: ' + thisUrl); 

                    // extract all hrefs of the same host 
                    $('a').each((i, aitem) => {
                        let subHref = $(aitem).attr('href'); 
                        subHref = new URL.URL(subHref, urlOrigin).href; 

                        if (urlHost == new URL.URL(subHref).host) { 
                            // Randomly deplay 0 ~ 10 sec before adding more links into the queue 
                            delayExe(10000 * Math.random()).then(() => { 
                                if (visitedUrls.has(subHref)) {
                                    skippedBeforeAnalysis['visited'] = skippedBeforeAnalysis['visited'] + 1;
                                }
                                else if (usedCrawlingQuota >= crawlingQuota) {
                                    skippedBeforeAnalysis['noQuota'] = skippedBeforeAnalysis['noQuota'] + 1;
                                } 
                                else {
                                    crawlerInstance.queue(subHref);
                                }
                            }); 
                        }
                    }); 

                    // extract the webpage content 
                    if (visitedUrls.has(thisUrl)) {
                        // console.debug('Skipping the visited url: ' + thisUrl); 
                        skippedAfterAnalysis['visited'] = skippedAfterAnalysis['visited'] + 1; 
                    }
                    else {
                        // Use 1 quota here 
                        visitedUrls.add(thisUrl); 
                        usedCrawlingQuota = usedCrawlingQuota + 1; 

                        // Analyze the news page 
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

                            let extract_tvbs_article_content = function(jqElems) {
                                let all_text = ''; 
                                jqElems.contents().each((ii, subElem) => {
                                    let text_fragment = ''; 
                                    if (subElem.type == 'tag') {
                                        if (subElem.name == 'div' || subElem.name == 'p') {
                                            text_fragment = extract_tvbs_article_content($(subElem)); 
                                        } 
                                    }
                                    if (subElem.type == 'text') { 
                                        text_fragment = $(subElem).text(); 
                                    }
                                    all_text = (all_text + ' ' + text_fragment).trim(); 
                                }); 
                                return all_text; 
                            }; 

                            $('.article_content').find('body').each((i, elem) => { 
                                content = extract_tvbs_article_content($(elem)); 
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
                }
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
    let querySnapshot = await firestoreQuery.get(); 
    visitedUrls = new Set(querySnapshot.docs.map((doc) => doc.data().url)); 
}

listVisitedUrls(); 

// Setup static contents 
app.use('/', express.static('public'))

// Defines endpoints 
app.get('/ping', (req, res) => {
    res.send({
        'crawlingQuota': crawlingQuota,
        'usedCrawlingQuota': usedCrawlingQuota,  
        'visitedUrls': { 
            'size': visitedUrls.size
        }, 
        'skippedBeforeAnalysis': skippedBeforeAnalysis, 
        'skippedAfterAnalysis': skippedAfterAnalysis, 
        'crawlerQueueLength': crawlerInstance.queueSize
    }); 
}); 

app.get('/listVisitedUrls', (req, res) => {
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
    usedCrawlingQuota = 0;
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

// Endpoint for downloading all data from Firestore -->> this is not good, but I don't find a good alternative at this moment 
app.get('/snapshotFirestoreCollection', (req, res, next) => {
    firestoreCollectionRef.get()
    .then((querySnapshot) => {
        let collectionSnapshot = querySnapshot.docs.map((doc) => doc.data()); 
        let jsonContent = JSON.stringify(collectionSnapshot); 
        
        let tmpFilePath = os.tmpdir() + '/' + uuid.v4() + '.json'; 
        tmpFilePath = tmpFilePath.replace(/\\/g, '/'); 
        console.info('Writing into tmp file: (' + typeof(tmpFilePath) + ') ' + tmpFilePath); 
        fs.writeFileSync(tmpFilePath, jsonContent);

        console.info('Start downloading...'); 
        res.download(
            tmpFilePath, 
            'tw-news-snapshot.json', 
            function (err) { 
                if (err) {
                    console.info('Download was actually failed...'); 
                    console.info(err);
                }
            }
        ); 
    })
    .catch((err) => {
        console.error('Snapshoting Firestore collection failed...'); 
        next(err); 
    }); 
}); 

// Setup the app 
const PORT = parseInt(process.env.PORT) || 8080; 
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}...`); 
}); 

module.exports = app; 
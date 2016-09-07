#!/usr/bin/env node
'use strict';

const userAgent = 'crawler@tourank';
const startPage = 'http://4travel.jp/search/shisetsu/dm?category_group=kankospot&page=1&sa=%E5%9B%BD%E5%86%85'


var Crawler = require('js-crawler');
var crawler = new Crawler();
var onceForAll = false;

//引入断言机制
var assert = require('assert');

/******* 改变控制台输出颜色,便于观察 ******/
var log4js = require('log4js');
log4js.configure({
  appenders: [
    { type: 'console' }
 ],
   replaceConsole: true
});


/************数据库存储*************/
var AsyncStreamer = require('async-streamer');

const crawlerDatabase = 'mongodb://localhost:27017/travelCrawler',
    
     collectionNameOfTravelDetailLinks = 'travelDetailLinks';


var asyncRecordStreamer = new AsyncStreamer({
    url: crawlerDatabase,
    collection: collectionNameOfTravelDetailLinks
});

asyncRecordStreamer.start();



/*********爬取页面********/

var allPagesNumber;

crawler.configure({
    ignoreRelative: false, 
    depth: 1,
    userAgent: userAgent,
    maxConcurrentRequests: 10,
    oblivious: true,
    enableTimeOut:true,
    shouldCrawl: function(url) {
        // console.warn(url)
        return true;
    },
    onSuccess: function(page) {

        // console.info('请求成功%s', page.actualUrl);
        if (page.actualUrl == startPage && !onceForAll) {
            allPagesNumber = parseAndRequestAllOfTravelPages(this, page.body);
            onceForAll = true;
        }
        
               
        parseAndStreamTravelDetailLinks(page.body, page.actualUrl,allPagesNumber);
       
    },
    onFailure: function(postmortem) {
        console.warn('Failed to crawl %s (%s)', postmortem.url, postmortem.status? 'HTTP: ' + postmortem.status : 'OTHER: ' + postmortem.error);
        if (postmortem.status && [404].indexOf(postmortem.status) < 0) {
            console.error('...Ask for re-crawling when possibily recoverable failure/error returned from web server');
            return true;
        }
        if (postmortem.error && ['EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET'].indexOf(postmortem.error.code) >= 0) {
            console.error('...Ask for re-crawling in case of: 1. name resolving error, 2. timeout, 3. connection reset');
            return true;
        }
        //onFailure:这里就是对超时的响应对报错处理,不再让他等待,要不然一直挂起
        //返回true就是重新爬取,
        return false;
    },
    onAllFinished: function() {
        console.log('All crawling are finished');
        asyncRecordStreamer.stop();
        console.log('请求并解析成功的页面的数量'+ pageNumbersArr.length + '数组'+ pageNumbersArr)
    }
})
.crawl(startPage);

//发起所有页面的网络请求
function  parseAndRequestAllOfTravelPages(crawler, content) {

        var regExpForAllTravelNumbers = new RegExp('全<span class="num">(.{0,10})</span>件中','ig')
        var allTravelNumbers = regExpForAllTravelNumbers.exec(content);

        //加入断言,如果没有匹配成功直接报错
        assert.notEqual(null, allTravelNumbers,['没有匹配到景点数量的总值'])
        

        var numbersTemp = parseInt(allTravelNumbers[1].replace(/,/ig,''))
        
        var allTravelPagesNumber = parseInt(numbersTemp/10) + 1
        
        var pageRegExp = /page=1/ig;

         //发起所有页面的网络请求
        for (let  i = 2; i <= allTravelPagesNumber; i++) {
             crawler.enqueueRequest({url: startPage.replace(pageRegExp,`page=${i}`)}, 1);
         }

      return allTravelPagesNumber;   
}


var  domesticUrlRegExp = /<a href="http:\/\/4travel\.jp\/domestic\/area\/.*?" class=(("ico_kankospot")|("ico_transport")|("ico_restaurant"))>\n(.*?)\n<em><\/em>\n<\/a>/ig;

var  spotUrlRegExp = /<a href="(http:\/\/spot4travel\.jp\/landmark\/dm\/)([0-9]*?)" class="ico_kankospot" target="_blank">\n(.*?)\n<em><\/em>\n<\/a>/ig;

var pageNumbersArr = [];


function parseAndStreamTravelDetailLinks (content,pageUrl,allPagesNumber) {
    
    //存储每页匹配成功的景点详情链接,每页中10个
    var urlArr = [];

    //提取出来该页面的页码
    var tempstart = pageUrl.indexOf('page=')
    var tempEnd = pageUrl.indexOf('&sa')
    var page_number = pageUrl.slice(tempstart + 5,tempEnd)
    

    //提取出该页面下景点链接中domestic类型的url
    var domesticUrl;
    while((domesticUrl = domesticUrlRegExp.exec(content))!= null){
       
         //解析出要存储的信息,放入一个对象中   
        let objTravel1 = sliceDomesticUrl(domesticUrl,page_number);
        console.log(objTravel1);

        //写入到数据库中
        asyncRecordStreamer.commit(objTravel1);

        urlArr.push(domesticUrl[0])
    }

    //提取出该页面下景点链接中spot类型的url
    var spotUrl;
    while((spotUrl = spotUrlRegExp.exec(content)) != null) {

        //解析出要存储的信息,放入一个对象中
        let objTravel2 = sliceSpotUrl(spotUrl,page_number);
        console.info(objTravel2.travelName)

        //写入到数据库中
        asyncRecordStreamer.commit(objTravel2);

        urlArr.push(spotUrl[0])
    } 

    
    //断言每页中10个,不等于10就直接报错,以求不漏掉一个信息
    if(page_number==allPagesNumber){
        // assert.equal(3,urlArr.length)
        console.warn('这是最后一页了')
    }else {
        assert.equal(10,urlArr.length);

    }
    
   
   //把所有获得信息的页面的页码放在一个数组中,待验证,后续使用
   var length = pageNumbersArr.push(page_number);

}

//解析出spoturl类型的景点详情链接中的信息,存放在一个对象中;
function sliceSpotUrl(spotUrl,page_number){

    var obj;

    //景点的详情链接url
    var _url = spotUrl[1].concat(spotUrl[2]);

    //景点链接中id
    var _id = spotUrl[2];

    //景点的名字
    var _name = spotUrl[3]

    //景点所在的页面的页码
    var _page_number = page_number


let  temp = `http://4travel.jp/search/shisetsu/dm?category_group=kankospot&page=${page_number}&sa=%E5%9B%BD%E5%86%85`


    obj = {
        crawler:'TravelDetailLinks',
        website:'4travel.jp',
        country:'jp',
        language:'en',
        id:_id,
        href:_url,
        travelName:_name,
        refUrl:temp,
        crawledAt: new Date() 
    }

    return obj;
}


//解析出domesticurl类型的景点详情链接中的信息,存放在一个对象中;
function sliceDomesticUrl (domesticUrl,page_number) {

    var obj;

    // 景点的详情链接url
    var start = domesticUrl[0].indexOf('href="')
    var end  = domesticUrl[0].indexOf('class=')
    var _url  = domesticUrl[0].slice(start + 6,end-2)
    

    //链接中的id
    var tempId = /\/([0-9]{1,9})\//.exec(_url);
    var _id = tempId[1];

    
    //景点名字name
    var _name = domesticUrl[5];

    //景点所在的页面pageNumber
    // var _page_number = page_number;


let  temp = `http://4travel.jp/search/shisetsu/dm?category_group=kankospot&page=${page_number}&sa=%E5%9B%BD%E5%86%85`


    obj = {
        crawler:'TravelDetailLinks',
        website:'4travel.jp',
        country:'jp',
        language:'en',
        id:_id,
        href:_url,
        travelName:_name,
        refUrl:temp,
        crawledAt: new Date()
    }

    return obj;
}





/*
     <a href="http://4travel.jp/domestic/area/chugoku/hiroshima/miyajima/miyajima/temple/10002779/" class="ico_kankospot">
嚴島神社
<em></em>
</a>

>
<a href= http://spot4travel.jp/landmark/dm/10005826" class="ico_kankospot" target="www.baidu.com">
首里城公園 (首里城)
<em></em>

*/





























































































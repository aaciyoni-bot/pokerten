'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const {validateVideo}=require('../../functions/tableClips');

test('Chrome records synthetic camera frames, previews locally and uploads only on Share', {timeout:45000},async()=>{
  const scripts={
    '/react.js':require.resolve('react').replace(/index\.js$/,'umd/react.production.min.js'),
    '/dom.js':require.resolve('react-dom').replace(/index\.js$/,'umd/react-dom.production.min.js'),
    '/clips.js':require.resolve('../../assets/js/table-clips.js')
  };
  const html='<!doctype html><div id="app"></div><script src="/react.js"></script><script src="/dom.js"></script><script src="/clips.js"></script><script>window.sent=[];window.fb={fx:async(n,d)=>{window.sent.push(d);return {ok:true}}};ReactDOM.createRoot(document.getElementById("app")).render(React.createElement(PokerTableClips.Composer,{tableId:"fixture"}));</script>';
  const server=createServer((req,res)=>{
    if(req.url==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html);}
    else if(Object.hasOwn(scripts,req.url)){res.writeHead(200,{'content-type':'text/javascript'});fs.createReadStream(scripts[req.url]).pipe(res);}
    else {res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  let browser;
  try{
    const executablePath=process.env.CHROME_BIN||['/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>fs.existsSync(p));
    assert.ok(executablePath,'Chrome is required');
    browser=await chromium.launch({executablePath,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
    const context=await browser.newContext({viewport:{width:390,height:844},permissions:['camera']});
    const page=await context.newPage();
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByRole('button',{name:'SnapCam'}).click();
    await page.getByRole('button',{name:'Record without sound'}).click();
    await page.getByRole('button',{name:'Stop',exact:true}).waitFor({state:'visible'});
    await page.locator('video[controls]').waitFor({state:'visible',timeout:10000});
    assert.equal(await page.evaluate(()=>window.sent.length),0);
    assert.equal(await page.getByRole('button',{name:'Stop',exact:true}).count(),0);
    await page.getByRole('button',{name:'Share with table'}).click();
    await page.getByText('Clip shared at this table.').waitFor();
    const sent=await page.evaluate(()=>window.sent);
    assert.equal(sent.length,1);assert.equal(sent[0].op,'send');
    const bytes=Buffer.from(sent[0].video,'base64');
    assert.ok(bytes.length>0&&bytes.length<=256*1024);
    await validateVideo(bytes,sent[0].mime);
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});

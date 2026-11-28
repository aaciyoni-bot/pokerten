'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright-core');
const {build}=require('../../scripts/locales/client.cjs');

test('a phone with Hebrew saved reaches the English sign-in screen after reopening or following an old link',{timeout:45000},async t=>{
  const root=path.resolve(__dirname,'../..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'poker-phone-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));build(root,out);
  const executablePath=process.env.CHROME_BIN||['/usr/bin/google-chrome','/usr/bin/chromium'].find(f=>fs.existsSync(f));
  const browser=await chromium.launch({executablePath,args:['--no-sandbox']});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  // Exercise the full generated app with the real React and auth UI, offline.
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem('seeded')){
      localStorage.setItem('pkUiLanguage','he');sessionStorage.setItem('seeded','1');
    }
    window.fb={fx:async()=>({available:true}),auth:{currentUser:null},onAuthStateChanged:(_,fn)=>{fn(null);return ()=>{};}};
  });
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url()),file=url.pathname.slice(1);
    if(url.hostname==='poker.test'){
      if(['index.html','he.html'].includes(file))return route.fulfill({path:path.join(out,file),contentType:'text/html'});
      if(file.startsWith('assets/')&&fs.existsSync(path.join(root,file)))return route.fulfill({path:path.join(root,file)});
    }
    if(url.host==='unpkg.com'){
      const pkg=file.startsWith('react-dom@')?'react-dom':'react';
      return route.fulfill({path:path.join(path.dirname(require.resolve(pkg)), 'umd',pkg+'.production.min.js'),contentType:'application/javascript',headers:{'access-control-allow-origin':'*'}});
    }
    if(url.host==='cdn.tailwindcss.com')return route.fulfill({body:'window.tailwind={};',contentType:'application/javascript'});
    return route.abort();
  });
  for(const name of ['he.html?uiLang=he&club=demo#seat','index.html']){
    await page.goto('https://poker.test/'+name,{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Sign in with Google',exact:true}).waitFor({timeout:7000});
    assert.match(page.url(),/\/index\.html/);
    assert.equal(await page.locator('[data-language-choice]').count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('pkUiLanguage')),'en');
  }
  assert.deepEqual(errors,[]);
});

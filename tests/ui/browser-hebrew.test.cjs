'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright-core');
const {build}=require('../../scripts/locales/client.cjs');

test('Hebrew sign-in and registration fit 320, 390 and 412 pixel screens', {timeout:45000},async t=>{
  const root=path.resolve(__dirname,'../..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'poker-phone-he-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  build(root,temp);
  const hebrew=fs.readFileSync(path.join(temp,'he.html'),'utf8');
  const executablePath=process.env.CHROME_BIN||['/usr/bin/google-chrome','/usr/bin/chromium'].find(f=>fs.existsSync(f));
  assert.ok(executablePath,'Chrome required');
  const browser=await chromium.launch({executablePath,args:['--no-sandbox']});t.after(()=>browser.close());
  for(const width of [320,390,412]){
    const page=await browser.newPage({viewport:{width,height:800}});
    await page.setContent(hebrew.match(/<html\b[^>]*>/)[0]+'<body><div id="root"></div></body></html>');
    await page.addStyleTag({path:path.join(root,'assets/css/hebrew-ui.css')});
    for(const js of [
      require.resolve('react').replace(/index\.js$/,'umd/react.production.min.js'),
      require.resolve('react-dom').replace(/index\.js$/,'umd/react-dom.production.min.js'),
      path.join(temp,'assets/js/hebrew-labels.js'),path.join(temp,'assets/js/poker-auth.he.js')
    ])await page.addScriptTag({path:js});
    await page.evaluate(()=>ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(PokerAuthUI.CodeLogin,{})));
    const form=page.getByRole('form',{name:'כניסה עם קוד אישי'});
    await form.getByRole('button',{name:'כניסה',exact:true}).waitFor();
    assert.equal(await form.evaluate(el=>getComputedStyle(el).direction),'rtl');
    assert.equal(await form.getByLabel('קוד אישי',{exact:true}).evaluate(el=>getComputedStyle(el).direction),'ltr');
    await form.getByRole('button',{name:/שחקן חדש/}).click();
    const name=form.getByLabel('השם שלך',{exact:true});await name.fill('Player');assert.equal(await name.inputValue(),'Player');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.close();
  }
});

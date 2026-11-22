'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const {build,translateScript,englishEntry}=require('../../scripts/locales/client.cjs');
const {applyLanguagePreference,LanguageChoice}=require('../../scripts/locales/english.cjs');

test('explicit language switching preserves deep links, English default and stored choice',()=>{
  const url='https://example.invalid/game/index.html?club=demo#seat';
  for(const [language,preference,query,target,stored] of [
    ['en',null,'',undefined,undefined],['en','he','','https://example.invalid/game/he.html?club=demo#seat',undefined],
    ['he',null,'',undefined,'he'],['en','he','&uiLang=en',undefined,'en']
  ]){
    let destination,value;
    const actual=url.replace('#seat',query+'#seat');
    vm.runInNewContext('('+applyLanguagePreference.toString()+')()',{
      URL,location:{href:actual,replace:next=>{destination=next;}},document:{documentElement:{lang:language}},
      localStorage:{getItem:()=>preference,setItem:(key,v)=>{assert.equal(key,'pkUiLanguage');value=v;}}
    });
    assert.equal(destination,target);assert.equal(value,stored);
    const link=vm.runInNewContext('('+LanguageChoice.toString()+')()',{
      URL,window:{location:new URL(actual)},document:{documentElement:{lang:language}},React:{createElement:(tag,props,text)=>({tag,props,text})}
    });
    const next=new URL(link.props.href);
    assert.equal(next.hash,'#seat');assert.equal(next.searchParams.get('club'),'demo');
    assert.equal(next.searchParams.get('uiLang'),language==='en'?'he':'en');
  }
});

test('Hebrew changes rendered copy and leaves names, notes, signed amounts and actions intact',()=>{
  const input="h('button',{title:'Wallet',onClick:()=>send('Wallet')},'Wallet',person.name,person.note,person.chips)";
  const he=translateScript(input,{Wallet:'ארנק',Player:'שחקן'});let sent;
  const ui=vm.runInNewContext(he,{
    h:(tag,props,...children)=>({tag,props,children}),person:{name:'Player',note:'Wallet',chips:-219},send:v=>{sent=v;}
  });
  assert.equal(ui.props.title,'ארנק');assert.deepEqual(ui.children,['ארנק','Player','Wallet',-219]);ui.props.onClick();assert.equal(sent,'Wallet');
});

test('build creates independent, versioned entry points and retains the original video',t=>{
  const root=path.resolve(__dirname,'../..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'pokerten-language-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const source=fs.readFileSync(path.join(root,'index.html'),'utf8'),version=require('../../assets/release.json').version;
  build(root,temp);
  const en=fs.readFileSync(path.join(temp,'index.html'),'utf8'),he=fs.readFileSync(path.join(temp,'he.html'),'utf8');
  assert.equal(englishEntry(en,version),en);
  assert.equal(fs.readFileSync(path.join(root,'index.html'),'utf8'),source);
  const doc=new JSDOM(he).window.document;
  assert.equal(doc.documentElement.dir,'rtl');assert.equal(doc.documentElement.lang,'he');
  assert.match(en,/<html lang="en" dir="ltr"/);assert.ok(!en.includes('hebrew-labels.js'));
  for(const html of [en,he]){assert.ok(html.includes('pokerten-orizis-intro.mp4'));assert.ok(html.includes('assets/js/app-update.js?v='+version));}
  for(const script of doc.querySelectorAll('script[src*=".he.js"]')){
    const [filename,query]=script.getAttribute('src').split('?');assert.equal(query,'v='+version);assert.ok(fs.existsSync(path.join(temp,filename)));
  }
  const auth=fs.readFileSync(path.join(temp,'assets/js/poker-auth.he.js'),'utf8');
  assert.match(auth,/כניסה עם קוד אישי/);assert.match(auth,/pkPinLogin/);
  const wallet=fs.readFileSync(path.join(temp,'assets/js/wallet-requests.he.js'),'utf8');assert.match(wallet,/בקשות ההעברה שלי/);
});

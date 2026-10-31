'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const context={window:{}};vm.runInNewContext(read('synga-config.js'),context);
assert.equal(context.window.SYNGA_CONFIG.firebase.projectId,'pokerten');
assert.equal(context.window.SYNGA_CONFIG.databaseId,'synga');
assert.equal(context.window.SYNGA_CONFIG.functionsPrefix,'synga-');
assert.deepEqual(JSON.parse(read('.firebaserc')).projects,{});
assert.ok(!fs.existsSync(path.join(root,'CNAME')),'Original custom domain must not move.');
assert.ok(read('assets/js/synga-firebase.js').includes("window.SYNGA_CONFIG.databaseId!=='synga'"));
assert.ok(read('assets/js/synga-firebase.js').includes("getFirestore(app,'synga')"));
assert.ok(read('assets/js/synga-firebase.js').includes("httpsCallable(fx,'synga-'+name"));
assert.ok(!read('index.html').includes('pokerten.firebaseapp.com'));
assert.ok(read('tests/ui/synga-preview.html').includes('updateDoc:denyWrite,setDoc:denyWrite,addDoc:denyWrite,deleteDoc:denyWrite,runTransaction:denyWrite'));
for(const name of fs.readdirSync(path.join(root,'.github/workflows')))assert.ok(!/^deploy-.*\.yml$/.test(name),'Inherited deployment is disabled: '+name);
const html=read('index.html');
for(const match of html.matchAll(/(?:src|href)="((?:assets\/|synga-config)[^"?]+)(?:\?[^"']*)?"/g))assert.ok(fs.existsSync(path.join(root,match[1])),'Referenced local asset exists: '+match[1]);
assert.equal(JSON.parse(read('manifest.json')).orientation,'landscape');
console.log('SYNGA isolation: named database and prefixed functions, no original domain/deploy workflow, preview writes denied, assets present.');

for(const file of ['index.html','privacy.html','delete-account.html','preview.html','manifest.json','sw.js','src/settlement-export.js',...fs.readdirSync(path.join(root,'assets/css')).map(n=>'assets/css/'+n),...fs.readdirSync(path.join(root,'assets/js')).filter(n=>n!=='synga-firebase.js').map(n=>'assets/js/'+n)])assert.ok(!/pokerten|mynga/i.test(read(file)),'No previous brand is shipped in product text: '+file);
assert.ok(!html.includes('id="orizis-intro"'),'Studio intro removed from live entry');
assert.ok(!read('preview.html').includes('id="orizis-intro"'),'Studio intro removed from preview');
const soundContext={window:{}};vm.runInNewContext(read('assets/js/synga-soundpack.js'),soundContext);
for(const names of Object.values(soundContext.window.SYNGA_SOUNDS))for(const name of names){const bytes=fs.readFileSync(path.join(root,'assets/sounds',name+'.wav'));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');}
console.log('SYNGA brand: direct entry, no prior product names, extracted WAV files verified.');

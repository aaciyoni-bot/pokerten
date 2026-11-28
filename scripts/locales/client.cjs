'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {englishEntry}=require('./english.cjs');
const version=require('../../assets/release.json').version;

function build(root,out=root){
  fs.mkdirSync(out,{recursive:true});
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  fs.writeFileSync(path.join(out,'index.html'),englishEntry(html,version));
  fs.copyFileSync(path.join(__dirname,'recover.html'),path.join(out,'he.html'));
}
if(require.main===module)build(process.argv[2]||'.',process.argv[3]||process.argv[2]||'.');
module.exports={build,englishEntry};

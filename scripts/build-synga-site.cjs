'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'site');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
// Explicit public files only: no server sources, rules, credentials or workflows.
for(const name of ['index.html','preview.html','privacy.html','delete-account.html','manifest.json','sw.js','synga-config.js','assets','src/settlement-export.js','tests/ui/synga-preview.html']) {
  fs.mkdirSync(path.dirname(path.join(out,name)),{recursive:true});
  fs.cpSync(path.join(root,name),path.join(out,name),{recursive:true});
}
console.log('SYNGA public site built.');

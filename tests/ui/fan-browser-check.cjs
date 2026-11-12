'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {execFileSync} = require('node:child_process');

// Hit-test both digits against the following card using the rendered player seat
// and the same stylesheets, in cascade order, as the game.
module.exports = function checkFan(index, seat) {
  const base = pathToFileURL(path.resolve(__dirname, '../../') + '/').href;
  const styles = index.match(/<style\b[^>]*>[\s\S]*?<\/style>|<link\b[^>]*href="assets\/css\/[^"]+"[^>]*>/gi).join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-rank-'));
  try {
    const file = path.join(dir, 'fan.html');
    fs.writeFileSync(file, `<!doctype html><meta charset="UTF-8"><base href="${base}">
      <style>*{box-sizing:border-box}body{margin:0}.flex{display:flex}.flex-col{flex-direction:column}.items-center{align-items:center}
      .absolute{position:absolute}.relative{position:relative}.inline-block{display:inline-block}.overflow-hidden{overflow:hidden}</style>${styles}
      <style>.pt-stage{height:780px}.poker-room .card-reveal{animation:none!important}.card-face{pointer-events:auto!important}</style>
      <div class="poker-room"><div class="pt-stage"><div class="poker-table relative">${seat}</div></div></div><output></output>
      <script>
      const stage=document.querySelector('.pt-stage'), ten=document.querySelector('.poker-own-fan [data-card-rank="10"]');
      const rank=ten.querySelector('.poker-card-index > span'),next=ten.closest('[data-card-position]').nextElementSibling;
      const samples=[320,360,393,430].map(width=>{
        stage.style.width=width+'px';
        const r=rank.getBoundingClientRect();
        const clear=[.15,.5,.92].every(x=>[.25,.5,.75].every(y=>
          document.elementFromPoint(r.left+r.width*x,r.top+r.height*y)?.closest('.card-face')===ten));
        return {width,clear,rankWidth:r.width,next:next?.querySelector('.card-face')?.dataset.cardRank};
      });
      document.querySelector('output').textContent=JSON.stringify(samples);
      </script>`);
    const output = execFileSync(process.env.CHROME_BIN || 'google-chrome', [
      '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--allow-file-access-from-files',
      '--window-size=500,900','--user-data-dir='+dir+'/profile','--dump-dom',pathToFileURL(file).href
    ], {encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
    const samples = JSON.parse(output.match(/<output>([^<]+)<\/output>/)[1]);
    for (const row of samples) assert.ok(row.clear && row.rankWidth > 5 && row.next === '9',JSON.stringify(row));
    console.log('PLO6 ten ahead of nine remains readable at 320, 360, 393 and 430px.');
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
};

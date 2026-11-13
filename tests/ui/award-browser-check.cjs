// The DOM harness knows the styles we set. Chrome also checks that the chips
// are painted at the expected screen positions throughout a portrait hand.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {execFileSync} = require('node:child_process');

module.exports = function checkAwardInBrowser(index, award) {
  const css = index.slice(index.indexOf('@keyframes pokerAwardTravel'), index.indexOf('.card-reveal {'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'award-browser-'));
  try {
    const file = path.join(dir, 'award.html');
    fs.writeFileSync(file, `<!doctype html><style>${css}
      .poker-pot-award{position:absolute;top:0;left:0;width:400px;height:800px}
      .poker-pot-award>div{position:absolute}
    </style>${award}<output></output><script>
      const flight=document.querySelector('.poker-pot-award'), label=flight.firstElementChild;
      flight.getBoundingClientRect();
      const animations=flight.getAnimations();
      if(animations.length!==2)throw Error('Expected travel and fade');
      animations.forEach(a=>a.pause());
      const samples=[0,400,900,1400,1900,2400,4800,5250].map(t=>{
        animations.forEach(a=>a.currentTime=t);
        const rect=label.getBoundingClientRect(),style=getComputedStyle(flight);
        return [Math.round(rect.left+rect.width/2),Math.round(rect.top+rect.height/2),Number(style.opacity),style.visibility];
      });
      document.querySelector('output').textContent=JSON.stringify(samples);
    </script>`);
    const out = execFileSync(process.env.CHROME_BIN || 'google-chrome', [
      '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--user-data-dir='+path.join(dir,'profile'),'--dump-dom',pathToFileURL(file).href
    ], {encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']});
    const samples=JSON.parse(out.match(/<output>([^<]+)<\/output>/)[1]);
    assert.deepEqual(samples[0],[140,320,1,'visible']);
    assert.deepEqual(samples.slice(1,7),[
      [140,320,1,'visible'],[125,400,1,'visible'],[110,480,1,'visible'],
      [95,560,1,'visible'],[80,640,1,'visible'],[80,640,1,'visible']
    ]);
    assert.equal(samples.at(-1)[2],0);
    console.log('Chrome verified a visible chip transfer at 0%, 25%, 50%, 75% and 100%, then a hold at the winner.');
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
};

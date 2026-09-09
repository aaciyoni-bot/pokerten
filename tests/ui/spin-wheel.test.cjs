const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),babel=require('@babel/core');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');const source=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('const SpinWheel ='))[1];
const names=['SPIN_WHEEL','SPIN_SEGS','SPIN_DISPLAY_MULTS','spinDrawMult','spinPrize'];const chunks=[];
for(const node of babel.parseSync(source).program.body)if(node.type==='VariableDeclaration')for(const d of node.declarations)if(names.includes(d.id.name))chunks.push(`${node.kind} ${source.slice(d.start,d.end)};`);
const scope={Math};vm.runInNewContext(chunks.join('\n')+'\nthis.wheel={'+names.join(',')+'};',scope);const client=scope.wheel,server=require('../../functions/pokerCore');
assert.deepEqual(Array.from(client.SPIN_SEGS),server.SPIN_SEGS);for(const entry of server.SPIN_WHEEL){assert.ok(client.SPIN_SEGS.includes(entry.mult));assert.ok(client.SPIN_DISPLAY_MULTS.includes(entry.mult));}
for(let i=0;i<1000;i++)assert.equal(client.spinDrawMult(i/1000),server.spinDrawMult(i/1000));
assert.equal(client.SPIN_DISPLAY_MULTS.includes(100),false);assert.equal(client.spinPrize(2.33,25),server.spinPrize(2.33,25));
console.log('PASS: every drawable spin prize has a segment, client/server draws match, no impossible advertised jackpot');

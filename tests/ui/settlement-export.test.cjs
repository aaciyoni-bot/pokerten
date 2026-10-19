'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const fixture=require('./settlement-fixture.cjs');
const w=new JSDOM('<div id="root"></div>',{url:'https://pokerten.com/',runScripts:'outside-only',pretendToBeVisual:true}).window;
global.window=w;global.document=w.document;Object.defineProperty(global,'navigator',{value:w.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),ReactDOM=require('react-dom/client'),{Simulate}=require('react-dom/test-utils');
w.React=React;w.TextEncoder=TextEncoder;w.Blob=Blob;
const timers=[];w.setInterval=fn=>{timers.push(fn);return timers.length;};w.clearInterval=()=>{};
let downloaded,clicked;w.URL.createObjectURL=blob=>{downloaded=blob;return 'blob:test';};w.URL.revokeObjectURL=()=>{};
w.HTMLAnchorElement.prototype.click=function(){clicked={name:this.download,href:this.href};};
w.eval(fs.readFileSync(require.resolve('../../assets/js/poker-settlement-ui.js'),'utf8'));
const root=ReactDOM.createRoot(w.document.getElementById('root')),doc=w.document;
const button=text=>[...doc.querySelectorAll('button')].find(b=>b.textContent===text);
const range={fromAt:Date.parse('2026-10-04T21:00:00Z'),toAt:Date.parse('2026-10-18T21:00:00Z')};
const players=[{uid:'p1',name:'אביב & <לוי>',result:-34017,rake:1200,chips:15983},{uid:'p2',name:'=HYPERLINK("bad")',result:12030,rake:900,chips:50000},{uid:'0007',name:'Zero',result:0,rake:0,chips:0}];
const legacy=role=>({active:false,legacy:true,role,supportsDateRange:true,readOnly:true,dateRange:range,cycle:{id:'date_range',status:'range',startAt:range.fromAt,endAt:range.toAt},cycles:[],legacyReport:{asOf:range.toAt,players:structuredClone(players),agents:[],totals:{balance:0,chips:65983,result:-21987,rake:2100,commission:0}}});
let data=legacy('owner'),calls=[],fail=false,defer=null,key=0;
const call=async(name,args)=>{calls.push({name,args});assert.equal(name,'pkSettlementReport');if(fail)throw Error('Report unavailable');if(defer)return defer;return structuredClone(data);};
const mount=async()=>React.act(async()=>root.render(React.createElement(w.PokerSettlement.Settlement,{key:++key,user:{uid:data.role==='player'?'p1':data.role,role:data.role},clubId:'netabel',call})));
function unzip(bytes){
 const files={};let offset=0;
 while(bytes.readUInt32LE(offset)===0x04034b50){
  assert.equal(bytes.readUInt16LE(offset+8),0);const len=bytes.readUInt32LE(offset+18),n=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+n+extra;
  files[bytes.subarray(offset+30,offset+30+n).toString()]=bytes.subarray(start,start+len).toString();offset=start+len;
 }
 assert.equal(bytes.readUInt32LE(offset),0x02014b50,'ZIP central directory exists');return files;
}
async function readFile(file){
 const bytes=Buffer.from(await file.blob.arrayBuffer()),files=unzip(bytes);
 for(const text of Object.values(files))assert.equal(new w.DOMParser().parseFromString(text,'application/xml').querySelector('parsererror'),null,'valid XML');
 const sheet=new w.DOMParser().parseFromString(files['xl/worksheets/sheet1.xml'],'application/xml');
 const rows=[...sheet.querySelectorAll('sheetData row')].map(row=>[...row.querySelectorAll('c')].map(c=>c.getAttribute('t')==='n'?Number(c.querySelector('v').textContent):c.textContent||null));
 assert.equal(sheet.querySelectorAll('f').length,0,'player text never becomes a formula');
 return {bytes,files,sheet,rows};
}
(async()=>{
 await mount();await React.act(()=>button('Download Excel').click());assert.equal(calls.length,1,'export uses the authorized report without another fetch');
 assert.match(clicked.name,/2026-10-05-2026-10-18\.xlsx$/);assert.equal(downloaded.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 let file=await readFile({blob:downloaded});assert.match(file.rows[1][0],/2026-10-05 to 2026-10-18/);
 const rowFor=name=>file.rows.find(r=>r[0]===name);
 assert.deepEqual(rowFor('אביב & <לוי>').slice(1),[-340.17,12,159.83,'p1']);
 assert.deepEqual(rowFor('Zero').slice(1),[0,0,0,'0007']);assert.ok(rowFor('=HYPERLINK("bad")'));
 assert.deepEqual(rowFor('Total').slice(1),[-219.87,21,659.83,null]);
 assert.equal(file.sheet.querySelector('autoFilter').getAttribute('ref'),'A6:E9');assert.equal(file.sheet.querySelector('pane').getAttribute('state'),'frozen');
 if(process.env.SETTLEMENT_EXPORT_OUTPUT){fs.mkdirSync(process.env.SETTLEMENT_EXPORT_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.SETTLEMENT_EXPORT_OUTPUT,'players.xlsx'),file.bytes);}
 // Older cycle snapshots keep their balance label and exact cycle boundaries.
 const closed=legacy('owner');delete closed.dateRange;closed.readOnly=false;closed.cycle={id:'legacy_current',status:'closed',startAt:range.fromAt,endAt:range.toAt};
 file=await readFile(w.PokerSettlementExcel.createFile(closed,{clubId:'netabel',userId:'owner'}));assert.ok(file.rows[4].includes('Chips at closing'));
 // Private player view strips staff-only columns even if unexpected extra fields exist.
 data=legacy('player');await mount();await React.act(()=>button('Download Excel').click());file=await readFile({blob:downloaded});assert.doesNotMatch(file.files['xl/worksheets/sheet1.xml'],/Rake|p2|HYPERLINK|0007/);assert.equal(file.rows.length,7);
 // Split counterparty activity is one player row, wallet is not added twice.
 data=fixture('owner','owner');data.details.push({...structuredClone(data.details[0]),agentId:'club',totals:{result:1000,rake:20,hands:2,games:1}});data.funds[0].chips=16983;await mount();await React.act(()=>button('Download Excel').click());file=await readFile({blob:downloaded});assert.deepEqual(file.rows.find(r=>r[0]==='Other human player').slice(1),[-330.17,10.2,22,2,169.83,'other']);
 // Agent exports remain scoped to the server's own-player rows.
 data=fixture('agent','agent');data.funds.push({uid:'agent',name:'Agent own wallet',balance:99900});await mount();await React.act(()=>button('Download Excel').click());file=await readFile({blob:downloaded});assert.doesNotMatch(file.files['xl/worksheets/sheet1.xml'],/Agent own wallet|999/);
 data=fixture('player','p1');await mount();await React.act(()=>button('Download Excel').click());file=await readFile({blob:downloaded});assert.doesNotMatch(file.files['xl/worksheets/sheet1.xml'],/Rake|Other human player/);
 // Unknown start, loading, rejected date range and stale failures cannot be exported.
 data=legacy('owner');data.needsPeriodStart=true;await mount();assert.equal(button('Download Excel'),undefined);
 data=legacy('owner');let release;defer=new Promise(resolve=>release=resolve);await mount();assert.equal(button('Download Excel'),undefined);defer=null;await React.act(()=>release(structuredClone(data)));assert.ok(button('Download Excel'));
 fail=true;await React.act(async()=>timers[timers.length-1]());assert.equal(button('Download Excel').disabled,true);fail=false;
 const dateForm=doc.querySelector('form[aria-label="Report date range"]');
 await React.act(()=>Simulate.change(dateForm.querySelectorAll('input')[0],{target:{value:'2026-10-06'}}));
 await React.act(()=>Simulate.change(dateForm.querySelectorAll('input')[1],{target:{value:'2026-10-19'}}));
 await React.act(async()=>Simulate.submit(dateForm));assert.equal(button('Download Excel'),undefined,'server returned the wrong date range');
 data=legacy('owner');data.legacyReport.players=[];await mount();await React.act(()=>button('Download Excel').click());file=await readFile({blob:downloaded});assert.equal(file.sheet.querySelector('autoFilter'),null);
 assert.equal(calls.some(c=>c.name==='pkSettlement'),false,'download never changes balances or cycles');
 await React.act(()=>root.unmount());w.close();console.log('PASS: actual XLSX download, dates, numeric money, Hebrew, text safety, totals, role scope, duplicate counterparties, empty/loading/error states');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});

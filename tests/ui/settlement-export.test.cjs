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
const players=[{uid:'p1',name:'אביב & <לוי>',agentUid:'a',recordedHands:40,handCountStatus:'Recorded cash segments only',result:-34017,rake:1200,chips:15983},{uid:'p2',name:'=HYPERLINK("bad")',agentUid:'b',recordedHands:10,handCountStatus:'Recorded cash segments only',result:12030,rake:900,chips:50000},{uid:'0007',name:'Zero',result:0,rake:0,chips:0}];
const legacy=role=>({active:false,legacy:true,role,supportsDateRange:true,readOnly:true,dateRange:range,cycle:{id:'date_range',status:'range',startAt:range.fromAt,endAt:range.toAt},cycles:[],legacyReport:{asOf:range.toAt,players:structuredClone(players),agents:[{uid:'a',name:'סוכן אחד',commission:600},{uid:'b',name:'סוכן שני',commission:450}],totals:{balance:0,chips:65983,result:-21987,rake:2100,commission:0}}});
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
 const sheets={};
 const workbook=new w.DOMParser().parseFromString(files['xl/workbook.xml'],'application/xml');
 for(const [i,node] of [...workbook.querySelectorAll('sheet')].entries()){
  const sheet=new w.DOMParser().parseFromString(files[`xl/worksheets/sheet${i+1}.xml`],'application/xml');
  const rows=[...sheet.querySelectorAll('sheetData row')].map(row=>[...row.querySelectorAll('c')].map(c=>c.getAttribute('t')==='n'?Number(c.querySelector('v').textContent):c.textContent||null));
  assert.equal(sheet.querySelectorAll('f').length,0,'untrusted player text never becomes a formula');
  const headers=rows[4],records=rows.slice(5).map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]])));
  sheets[node.getAttribute('name')]={sheet,rows,records};
 }
 return {bytes,files,sheets};
}
const lookup=(file,sheet,key,value)=>file.sheets[sheet].records.find(r=>r[key]===value);
(async()=>{
 await mount();await React.act(()=>button('Download Excel').click());assert.equal(calls.length,1,'export uses the authorized response without another fetch');
 assert.match(clicked.name,/2026-10-05-2026-10-18\.xlsx$/);assert.equal(downloaded.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 let file=await readFile({blob:downloaded});assert.deepEqual(Object.keys(file.sheets).slice(0,3),['Agents','Players','By agent']);assert.equal(Object.keys(file.sheets).length,6);
 assert.match(file.sheets.Players.rows[1][0],/2026-10-05 to 2026-10-18/);
 let row=lookup(file,'Players','Player','אביב & <לוי>');
 assert.equal(row.Agent,'סוכן אחד');assert.equal(row['Profit / loss (chips)'],-340.17);assert.equal(row['Recorded cash hands'],40);assert.equal(row['Current chips (wallet + tables)'],159.83);
 row=lookup(file,'Players','Player','Zero');assert.equal(row['Profit / loss (chips)'],0);assert.equal(row['Recorded cash hands'],null);assert.equal(row['Hand count coverage'],'Not recorded');assert.equal(row['Player ID'],'0007');
 assert.ok(lookup(file,'Players','Player','=HYPERLINK("bad")'));
 row=lookup(file,'Players','Player','Total');assert.equal(row['Profit / loss (chips)'],-219.87);assert.equal(row['Rake (included in result)'],21);assert.equal(row['Recorded cash hands'],50);assert.match(row['Hand count coverage'],/Partial/);
 row=lookup(file,'Agents','Agent','סוכן אחד');assert.equal(row.Players,1);assert.equal(row['Profit / loss (chips)'],-340.17);assert.equal(row['Recorded commission'],6);
 row=lookup(file,'Agents','Agent','Total');assert.equal(row.Players,3);assert.equal(row['Profit / loss (chips)'],-219.87);assert.equal(row['Recorded commission'],10.5);
 assert.ok(lookup(file,'Agents','Agent','Direct / no agent'));
 const subtotals=file.sheets['By agent'].records.filter(r=>r.Player==='Agent subtotal');assert.equal(subtotals.length,3);assert.equal(Math.round(subtotals.reduce((n,r)=>n+r['Profit / loss (chips)'],0)*100),-21987);
 for(const agent of file.sheets.Agents.records.filter(r=>r.Agent!=='Total')){
  const tab=file.sheets[agent['Player details tab']];assert.ok(tab,'each agent has a named player details tab');
  assert.equal(tab.records.length,agent.Players+1);assert.equal(tab.records.at(-1)['Profit / loss (chips)'],agent['Profit / loss (chips)']);
  assert.equal(tab.records.at(-1)['Rake (included in result)'],agent['Rake (included in result)']);assert.equal(tab.records.at(-1)['Recorded cash hands'],agent['Recorded cash hands']);
  assert.match(tab.rows[1][0],/2026-10-05 to 2026-10-18/);assert.match(tab.rows[3][0],/Bot results are excluded/);
  assert.ok(tab.sheet.querySelector('autoFilter'));
 }
 assert.equal(lookup(file,'סוכן אחד','Player ID','p1')['Profit / loss (chips)'],-340.17);assert.equal(lookup(file,'סוכן אחד','Player ID','p2'),undefined,'agent tabs contain only that agent’s players');
 for(const s of Object.values(file.sheets))assert.equal(s.sheet.querySelector('pane').getAttribute('state'),'frozen');
 assert.ok(file.sheets.Players.sheet.querySelector('autoFilter'));assert.equal(file.sheets['By agent'].sheet.querySelector('autoFilter'),null,'subtotals cannot be filtered into data totals');
 if(process.env.SETTLEMENT_EXPORT_OUTPUT){fs.mkdirSync(process.env.SETTLEMENT_EXPORT_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.SETTLEMENT_EXPORT_OUTPUT,'agents.xlsx'),file.bytes);}
 // A winning agent total must not hide a losing player; duplicate segments
 // for the same player are combined only within their recorded agent.
 const mixed=legacy('owner');mixed.legacyReport.players[1].agentUid='a';mixed.legacyReport.players[1].result=50000;
 const mixedFile=await readFile(w.PokerSettlementExcel.createFile(mixed,{clubId:'netabel',userId:'owner'}));
 assert.equal(lookup(mixedFile,'סוכן אחד','Player','Total')['Profit / loss (chips)'],159.83);assert.equal(lookup(mixedFile,'סוכן אחד','Player ID','p1')['Profit / loss (chips)'],-340.17);
 // Excel tab names must survive real agent names, collisions, reserved names,
 // punctuation, apostrophes, and truncation, including supplementary Unicode.
 const named=legacy('owner'),names=['Agents','agents','Players','By agent','History',"'Team / [A]:?*\\'",'A'.repeat(40),'A'.repeat(39)+'B','😀'.repeat(25),''];
 named.legacyReport.agents=names.map((name,i)=>({uid:`a${i}`,name,commission:0}));
 named.legacyReport.players=names.map((name,i)=>({...players[0],uid:`p${i}`,agentUid:`a${i}`,name:`Player ${i}`}));
 const namedFile=await readFile(w.PokerSettlementExcel.createFile(named,{clubId:'netabel',userId:'owner'})),tabs=Object.keys(namedFile.sheets);
 assert.equal(tabs.length,3+names.length);assert.equal(new Set(tabs.map(n=>n.toLowerCase())).size,tabs.length);
 for(const name of tabs){assert.ok(name.length<=31&&name.length>0);assert.doesNotMatch(name,/[\\/?*\[\]:\u0000-\u001f]/);assert.ok(!name.startsWith("'")&&!name.endsWith("'"));assert.notEqual(name.toLowerCase(),'history');}
 for(const agent of namedFile.sheets.Agents.records.filter(r=>r.Agent!=='Total'))assert.ok(namedFile.sheets[agent['Player details tab']]);
 const closed=legacy('owner');delete closed.dateRange;closed.cycle={id:'legacy_current',status:'closed',startAt:range.fromAt,endAt:range.toAt};
 file=await readFile(w.PokerSettlementExcel.createFile(closed,{clubId:'netabel',userId:'owner'}));assert.ok(file.sheets.Players.rows[4].includes('Chips at closing'));
 data=legacy('player');await mount();await React.act(()=>button('Download Excel').click());file=await readFile({blob:downloaded});assert.deepEqual(Object.keys(file.sheets),['Players']);assert.doesNotMatch(file.files['xl/worksheets/sheet1.xml'],/Rake|p2|HYPERLINK|0007|סוכן/);
 // A player can change agent. Group entries reconcile to one player total and one wallet.
 data=fixture('owner','owner');data.details.push({...structuredClone(data.details[0]),agentId:'club',totals:{result:1000,rake:20,hands:2,games:1}});data.funds[0].chips=16983;await mount();await React.act(()=>button('Download Excel').click());file=await readFile({blob:downloaded});
 row=lookup(file,'Players','Player','Other human player');assert.equal(row['Profit / loss (chips)'],-330.17);assert.equal(row['Recorded cash hands'],22);assert.equal(row['Current chips (wallet + tables)'],169.83);
 assert.equal(lookup(file,'Agents','Agent','Total').Players,1);assert.equal(file.sheets['By agent'].records.filter(r=>r.Player==='Other human player').length,2);
 assert.equal(lookup(file,'Agents','Agent','Direct / no agent')['Profit / loss (chips)'],10);
 const repeated=structuredClone(data);repeated.details.push({...structuredClone(data.details[0]),totals:{result:100,rake:10,hands:3,games:1}});
 const repeatedFile=await readFile(w.PokerSettlementExcel.createFile(repeated,{clubId:'netabel',userId:'owner'})),ownTab=lookup(repeatedFile,'Agents','Agent','agent')['Player details tab'];
 assert.equal(repeatedFile.sheets[ownTab].records.filter(r=>r['Player ID']==='other').length,1);assert.equal(lookup(repeatedFile,ownTab,'Player ID','other')['Profit / loss (chips)'],-339.17);assert.equal(lookup(repeatedFile,ownTab,'Player ID','other')['Recorded cash hands'],23);
 // Agent scope stays identical to the authorized server report, excluding its own wallet.
 data=fixture('agent','agent');data.funds.push({uid:'agent',name:'Agent own wallet',balance:99900});await mount();await React.act(()=>button('Download Excel').click());file=await readFile({blob:downloaded});assert.doesNotMatch(JSON.stringify(file.files),/Agent own wallet|99900/);
 data=fixture('player','p1');await mount();await React.act(()=>button('Download Excel').click());file=await readFile({blob:downloaded});assert.doesNotMatch(JSON.stringify(file.files),/Rake|Other human player/);assert.equal(lookup(file,'Players','Player','My player')['Recorded cash hands'],20);
 // Tournament hands are not presented as a complete all-game count.
 data=fixture('owner','owner');data.details[0].rows[0].kind='tournament';file=await readFile(w.PokerSettlementExcel.createFile(data,{clubId:'netabel',userId:'owner'}));assert.match(lookup(file,'Players','Player','Other human player')['Hand count coverage'],/Partial/);
 // Unknown start, loading, rejected date range and stale failures cannot be exported.
 data=legacy('owner');data.needsPeriodStart=true;await mount();assert.equal(button('Download Excel'),undefined);
 data=legacy('owner');let release;defer=new Promise(resolve=>release=resolve);await mount();assert.equal(button('Download Excel'),undefined);defer=null;await React.act(()=>release(structuredClone(data)));assert.ok(button('Download Excel'));
 fail=true;await React.act(async()=>timers[timers.length-1]());assert.equal(button('Download Excel').disabled,true);fail=false;
 const dateForm=doc.querySelector('form[aria-label="Report date range"]');
 await React.act(()=>Simulate.change(dateForm.querySelectorAll('input')[0],{target:{value:'2026-10-06'}}));
 await React.act(()=>Simulate.change(dateForm.querySelectorAll('input')[1],{target:{value:'2026-10-19'}}));
 await React.act(async()=>Simulate.submit(dateForm));assert.equal(button('Download Excel'),undefined,'server returned the wrong date range');
 data=legacy('owner');data.legacyReport.players=[];await mount();await React.act(()=>button('Download Excel').click());file=await readFile({blob:downloaded});assert.equal(file.sheets.Players.sheet.querySelector('autoFilter'),null);
 assert.equal(calls.some(c=>c.name==='pkSettlement'),false,'download never changes balances or cycles');
 await React.act(()=>root.unmount());w.close();console.log('PASS: separate agent tabs, safe tab names, visible player losses, reconciled subtotals, role scope, dates and XLSX download');
})().catch(async e=>{console.error(e);await React.act(()=>root.unmount());w.close();process.exitCode=1;});

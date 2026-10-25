/* Excel export of an already authorized settlement response. No data requests or writes. */
(function (global) {
'use strict';
const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const day=n=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(n);
const stamp=n=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',dateStyle:'short',timeStyle:'short'}).format(n);
const amount=n=>n==null?null:Number.isSafeInteger(n)?n/100:(()=>{throw Error('The report contains an invalid amount. Refresh and try again.');})();
const xml=value=>String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').slice(0,32767).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const col=n=>{let name='';for(n++;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};

const sum=(rows,key)=>rows.reduce((n,p)=>n+(p[key]??0),0);
const handCount=n=>Number.isSafeInteger(n)&&n>=0?n:null;
const counted=rows=>rows.some(p=>p.hands!=null)?sum(rows,'hands'):null;
const coverage=rows=>rows.every(p=>p.hands!=null)&&rows.every(p=>p.handStatus==='Recorded cash hands')?'Recorded cash hands':rows.some(p=>p.hands!=null)?'Partial history; recorded cash hands only':'Not recorded';
const money=(key,label,width=23)=>({key,label,width,money:true});
const countStatus={key:'handStatus',label:'Hand count coverage',width:39};
const handsColumn={key:'hands',label:'Recorded cash hands',width:22};
const playerColumn={key:'name',label:'Player',width:28};
const agentColumn={key:'agent',label:'Agent',width:28};
const resultColumn=money('result','Profit / loss (chips)');
const rakeColumn=money('rake','Rake (included in result)',25);
const idColumn={key:'id',label:'Player ID',width:30};
// Excel names are limited to 31 UTF-16 units and unique ignoring case. Keep
// complete agent names in the sheet title when a tab name needs shortening.
function tabName(label,used){
 const clean=String(label||'Agent').replace(/[\\/?*\[\]:\u0000-\u001f\ufffe\uffff]/g,' ').replace(/\s+/g,' ').trim().replace(/^'+|'+$/g,'').trim()||'Agent';
 const cut=(text,length)=>{let out='';for(const ch of text){if(out.length+ch.length>length)break;out+=ch;}return out.replace(/'+$/g,'')||'Agent';};
 let suffix='',name=cut(clean,31),n=2;
 while(used.has(name.toLowerCase())){suffix=` (${n++})`;name=cut(clean,31-suffix.length)+suffix;}
 used.add(name.toLowerCase());return name;
}

function reportModel(data,userId){
 const staff=data.role!=='player',agents=data.legacy?data.legacyReport.agents||[]:data.agents||[data.agent].filter(Boolean);
 const names=new Map(agents.map(a=>[a.uid||a.agentId,a.name||a.agentName]));
 for(const f of data.funds||[])if(!names.has(f.uid))names.set(f.uid,f.name||f.uid);
 const agentName=id=>id==='club'?'Direct / no agent':names.get(id)||id;
 let segments=[];
 if(data.legacy){
  segments=data.legacyReport.players.filter(p=>staff||p.uid===userId).map(p=>({id:p.uid,name:p.name,agentId:p.agentUid&&p.agentUid!==p.uid?p.agentUid:'club',result:p.result,rake:p.rake,chips:p.chips,hands:handCount(p.recordedHands),handStatus:p.handCountStatus||'Not recorded'}));
 }else if(!staff){
  const p=data.player;if(!p||p.playerId!==userId)throw Error('Your player report is unavailable.');
  segments=[{id:p.playerId,name:p.playerName,...p.totals,hands:handCount(p.totals.hands),handStatus:(p.rows||[]).some(r=>r.kind==='tournament')?'Cash only; tournament counts not recorded':'Recorded cash hands',chips:data.chips??data.balance,agentId:'club'}];
 }else{
  segments=(data.details||[]).map(p=>({id:p.playerId,name:p.playerName,agentId:p.agentId||'club',...p.totals,hands:handCount(p.totals.hands),handStatus:(p.rows||[]).some(r=>r.kind==='tournament')?'Cash only; tournament counts not recorded':'Recorded cash hands'}));
  for(const p of data.funds||[]){
   // Wallets are displayed once per player, never repeated in group subtotals.
   const own=segments.filter(s=>s.id===p.uid);
   if(own.length)for(const row of own)row.chips=p.chips??p.balance;
   else if(!(data.role==='agent'&&p.uid===userId))segments.push({id:p.uid,name:p.name||p.uid,agentId:p.agentId|| (data.role==='agent'?userId:'club'),result:0,rake:0,hands:0,games:0,handStatus:'Recorded cash hands',chips:p.chips??p.balance});
  }
 }
 const byId=new Map(),groups=new Map();
 for(const s of segments){
  s.agent=agentName(s.agentId);
  if(!byId.has(s.id))byId.set(s.id,[]);byId.get(s.id).push(s);
  if(!groups.has(s.agentId))groups.set(s.agentId,[]);groups.get(s.agentId).push(s);
 }
 const combine=rows=>({id:rows[0].id,name:rows[0].name,agent:[...new Set(rows.map(s=>s.agent))].join(', '),result:sum(rows,'result'),rake:sum(rows,'rake'),hands:counted(rows),handStatus:coverage(rows),games:sum(rows,'games'),chips:rows.find(s=>s.chips!=null)?.chips});
 const players=[...byId.values()].map(combine).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
 if(staff)for(const a of agents){const id=a.uid||a.agentId;if(!groups.has(id))groups.set(id,[]);}
 const grouped=[...groups].map(([id,segments])=>{
  const byPlayer=new Map();for(const s of segments){if(!byPlayer.has(s.id))byPlayer.set(s.id,[]);byPlayer.get(s.id).push(s);}
  const rows=[...byPlayer.values()].map(combine).sort((a,b)=>String(a.name).localeCompare(String(b.name))),a=agents.find(a=>(a.uid||a.agentId)===id);
  return{id,agent:agentName(id),rows,players:rows.length,result:sum(rows,'result'),rake:sum(rows,'rake'),hands:counted(rows),handStatus:coverage(rows),commission:id==='club'?0:a?.commission??null};
 }).sort((a,b)=>a.agent.localeCompare(b.agent));
 return{players,groups:grouped,staff};
}

function buildReport(data,{clubId,userId,now=Date.now()}){
 if(!data||data.needsPeriodStart||!data.cycle||!['owner','agent','player'].includes(data.role)||!data.legacy&&!data.active)throw Error('Load a complete report with confirmed dates before downloading.');
 const range=data.dateRange,closed=data.legacy&&!range&&data.cycle.status!=='open';
 const from=range?.fromAt??data.cycle.startAt,to=range?.toAt??(data.cycle.status==='open'?null:data.cycle.endAt);
 const period=range?`${day(from)} to ${day(to-1)} (inclusive)`:`${data.cycle.id}: ${stamp(from)} to ${to==null?'open':stamp(to)}`;
 const basis=(range?'Profit/loss uses cash-outs and completed tournaments recorded in these dates. Hands use cash journal segments recorded in these dates; older history may be missing.':closed?'Saved cycle results. Historical hand counts may not have been recorded.':'Selected cycle results include settled open-table activity. Hand counts cover recorded cash hands; tournament hand counts are unavailable.')+' Positive result = won; negative result = lost. Bot results are excluded.';
 const {players,groups,staff}=reportModel(data,userId),asOf=data.legacyReport?.asOf??now;
 const context=[period,`Club: ${clubId}   |   As of: ${stamp(asOf)} (Asia/Jerusalem)`];
 const totalRow=rows=>({name:'Total',agent:'Total',result:sum(rows,'result'),rake:sum(rows,'rake'),hands:counted(rows),handStatus:coverage(rows),games:sum(rows,'games'),chips:rows.every(p=>p.chips!=null)?sum(rows,'chips'):null,commission:rows.every(p=>p.commission!=null)?sum(rows,'commission'):null});
 const sheet=(name,title,columns,rows,totals,note)=>({name,columns,notes:[title,...context,note],rows:rows.map(p=>columns.map(c=>c.money?amount(p[c.key]):p[c.key]??null)),rowKinds:rows.map(p=>p.kind||''),totals:columns.map(c=>c.money?amount(totals[c.key]):totals[c.key]??null)});
 const sheets=[];
 if(staff){
  const used=new Set(['agents','players','by agent','history']);
  for(const g of groups)g.tab=tabName(g.agent,used);
  const totals={...totalRow(players),players:players.length,commission:groups.every(g=>g.commission!=null)?sum(groups,'commission'):null};
  sheets.push(sheet('Agents','SYNGA POKER — Agent summary',[agentColumn,{key:'players',label:'Players',width:14},resultColumn,rakeColumn,handsColumn,countStatus,money('commission','Recorded commission'),{key:'tab',label:'Player details tab',width:28},{key:'id',label:'Agent ID',width:30}],groups,totals,basis+' Agent results are net totals of their players. Hand totals count player participations. A player may appear under several agents; the total counts unique players.'));
 }
 sheets.push(sheet('Players','SYNGA POKER — Player totals',[playerColumn,...(staff?[agentColumn]:[]),resultColumn,...(staff?[rakeColumn]:[]),handsColumn,countStatus,...(!data.legacy?[{key:'games',label:'Recorded segments',width:22}]:[]),money('chips',closed?'Chips at closing':'Current chips (wallet + tables)',29),idColumn],players,totalRow(players),basis+(closed?'':' Current chips are a current balance, not period profit.')));
 if(staff){
  const detail=[];
  for(const g of groups){
   const rows=g.rows.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)));
   detail.push({kind:'group',agent:g.agent,name:`${g.players} player${g.players===1?'':'s'}`,id:g.id});
   detail.push(...rows.map(p=>({...p,agent:g.agent})));
   detail.push({...totalRow(rows),kind:'subtotal',agent:g.agent,name:'Agent subtotal'});
  }
  sheets.push(sheet('By agent','SYNGA POKER — Players by agent',[agentColumn,playerColumn,resultColumn,rakeColumn,handsColumn,countStatus,idColumn],detail,totalRow(players),basis+(data.legacy?' Agent grouping uses the membership assignment in this report.':' Each segment keeps its recorded agent. The Players sheet combines each player once.')));
  for(const g of groups)sheets.push(sheet(g.tab,`SYNGA POKER — ${g.agent} — Player details`,[playerColumn,resultColumn,rakeColumn,handsColumn,countStatus,...(!data.legacy?[{key:'games',label:'Recorded segments',width:22}]:[]),idColumn],g.rows,totalRow(g.rows),basis+(data.legacy?' Agent grouping uses the membership assignment in this report.':' Only activity recorded under this agent is included. The Players sheet combines each player across agents.')));
 }
 return {sheets,filename:`synga-agents-${String(clubId).replace(/[^a-zA-Z0-9_-]/g,'_')}-${day(from)}-${day(to==null?asOf:range?to-1:to)}.xlsx`};
}

// Minimal Open XML workbook: typed numbers and inline text, including names
// beginning with '='. No formulas or external links are accepted from report data.
function workbookXml(report){
 const last=col(report.columns.length-1),end=6+report.rows.length;
 const numeric=value=>{if(!Number.isFinite(value))throw Error('The report contains an invalid number. Refresh and try again.');return value;};
 const cell=(value,r,c,style)=>value==null?`<c r="${col(c)}${r}" s="${style}"/>`:typeof value==='number'?
  `<c r="${col(c)}${r}" s="${style}" t="n"><v>${numeric(value)}</v></c>`:
  `<c r="${col(c)}${r}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
 const notes=report.notes.map((n,i)=>`<row r="${i+1}" ht="${i===3?80:28}" customHeight="1">${cell(n,i+1,0,i===0?1:2)}</row>`).join('');
 const headers=`<row r="6" ht="38" customHeight="1">${report.columns.map((c,i)=>cell(c.label,6,i,3)).join('')}</row>`;
 const body=report.rows.map((row,i)=>`<row r="${i+7}" ht="${Math.max(23,...row.map((v,j)=>typeof v==='string'?Math.ceil(v.length/(report.columns[j].width-2))*16+7:23))}" customHeight="1">${row.map((v,j)=>cell(v,i+7,j,report.rowKinds?.[i]==='group'||report.rowKinds?.[i]==='subtotal'?(report.columns[j].money?5:6):(report.columns[j].money?4:0))).join('')}</row>`).join('');
 const total=`<row r="${end+1}" ht="27" customHeight="1">${report.totals.map((v,j)=>cell(v,end+1,j,report.columns[j].money?5:6)).join('')}</row>`;
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}${end+1}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="23"/><cols>${report.columns.map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${c.width}" customWidth="1"/>`).join('')}</cols><sheetData>${notes}${headers}${body}${total}</sheetData>${report.rows.length&&report.name!=='By agent'?`<autoFilter ref="A6:${last}${end}"/>`:''}<mergeCells count="4">${report.notes.map((_,i)=>`<mergeCell ref="A${i+1}:${last}${i+1}"/>`).join('')}</mergeCells><pageMargins left="0.25" right="0.25" top="0.3" bottom="0.3" header="0.1" footer="0.1"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}
const styles=`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]-#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FF123C46"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD5EFE9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="left" indent="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="left" indent="1"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1" applyFill="1" applyFont="1"><alignment wrapText="1" vertical="center" horizontal="left" indent="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="right" indent="1"/></xf><xf numFmtId="164" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="center" horizontal="right" indent="1"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="left" indent="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// ZIP STORE avoids a network dependency and works offline in mobile browsers.
// Standard local headers, CRC-32 and central directory, with UTF-8 filenames.
function zip(files){
 const encoder=new global.TextEncoder(),parts=[],directory=[];let offset=0;
 const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 const header=n=>{const bytes=new Uint8Array(n);return {bytes,view:new DataView(bytes.buffer)};};
 for(const [path,content] of Object.entries(files)){
  const name=encoder.encode(path),data=encoder.encode(content);let crc=0xffffffff;
  for(const byte of data)crc=crcTable[(crc^byte)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
  const local=header(30),central=header(46),l=local.view,c=central.view;
  l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);
  c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
  parts.push(local.bytes,name,data);directory.push(central.bytes,name);offset+=30+name.length+data.length;
 }
 const size=directory.reduce((n,p)=>n+p.length,0),end=header(22),e=end.view;
 e.setUint32(0,0x06054b50,true);e.setUint16(8,directory.length/2,true);e.setUint16(10,directory.length/2,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
 return new global.Blob([...parts,...directory,end.bytes],{type:MIME});
}
function createFile(data,options){
 const report=buildReport(data,options);
 const files={
  '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${report.sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  '_rels/.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${report.sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${report.sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="${REL}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="styles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
  'xl/styles.xml':styles
 };
 report.sheets.forEach((sheet,i)=>{files[`xl/worksheets/sheet${i+1}.xml`]=workbookXml(sheet);});
 return {blob:zip(files),filename:report.filename};
}
function download(data,options){
 const {blob,filename}=createFile(data,options),url=global.URL.createObjectURL(blob),a=global.document.createElement('a');
 a.href=url;a.download=filename;global.document.body.appendChild(a);
 try{a.click();}finally{a.remove();global.setTimeout(()=>global.URL.revokeObjectURL(url),30000);}
}
global.PokerSettlementExcel={createFile,download};
})(window);

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

function reportRows(data,userId){
 const staff=data.role!=='player';
 if(data.legacy)return data.legacyReport.players.filter(p=>staff||p.uid===userId).map(p=>({id:p.uid,name:p.name,result:p.result,rake:p.rake,chips:p.chips}));
 if(!staff){const p=data.player;if(!p||p.playerId!==userId)throw Error('Your player report is unavailable.');return [{id:p.playerId,name:p.playerName,...p.totals,chips:data.chips??data.balance}];}
 // A player can have several counterparties in one cycle; sum each segment once.
 const byId=new Map();
 for(const p of data.details||[]){
  let row=byId.get(p.playerId);
  if(!row){row={id:p.playerId,name:p.playerName,result:0,rake:0,hands:0,games:0};byId.set(p.playerId,row);}
  for(const key of ['result','rake','hands','games'])row[key]+=p.totals[key]||0;
 }
 for(const p of data.funds||[]){
  // Agent self-play is separate from the agent's player report.
  if(data.role==='agent'&&p.uid===userId&&!byId.has(p.uid))continue;
  const row=byId.get(p.uid)||{id:p.uid,name:p.name||p.uid,result:0,rake:0,hands:0,games:0};
  row.chips=p.chips??p.balance;byId.set(p.uid,row);
 }
 return [...byId.values()];
}

function buildReport(data,{clubId,userId,now=Date.now()}){
 if(!data||data.needsPeriodStart||!data.cycle||!['owner','agent','player'].includes(data.role)||!data.legacy&&!data.active)throw Error('Load a complete report with confirmed dates before downloading.');
 const range=data.dateRange,closed=data.legacy&&!range&&data.cycle.status!=='open';
 const from=range?.fromAt??data.cycle.startAt,to=range?.toAt??(data.cycle.status==='open'?null:data.cycle.endAt);
 const period=range?`${day(from)} to ${day(to-1)} (inclusive)`:`${data.cycle.id}: ${stamp(from)} to ${to==null?'open':stamp(to)}`;
 const basis=range?'Recorded cash-outs and completed tournaments in the selected dates. Open sessions are excluded.':closed?'Saved results and chip balances at cycle closing.':'Selected cycle results, including settled activity at open tables. Unfinished hands are excluded.';
 const columns=[{key:'name',label:'Player',width:28},{key:'result',label:'Profit / loss (chips)',money:true,width:23},
  ...(data.role!=='player'?[{key:'rake',label:'Rake (included in result)',money:true,width:24}]:[]),
  ...(!data.legacy?[{key:'hands',label:'Hands',width:14},{key:'games',label:'Sessions',width:14}]:[]),
  {key:'chips',label:closed?'Chips at closing':'Current chips (wallet + tables)',money:true,width:27},{key:'id',label:'Player ID',width:32}];
 const players=reportRows(data,userId).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
 const rows=players.map(p=>columns.map(c=>c.money?amount(p[c.key]):p[c.key]??null));
 const totals=columns.map((c,i)=>{
  if(i===0)return 'Total';if(c.key==='id')return null;
  const values=players.map(p=>p[c.key]);if(values.some(v=>v==null))return null;
  const sum=values.reduce((n,v)=>n+v,0);return c.money?amount(sum):sum;
 });
 const asOf=data.legacyReport?.asOf??now;
 return {columns,rows,totals,notes:['POKERTEN — Player results',period,`Club: ${clubId}   |   Report as of: ${stamp(asOf)} (Asia/Jerusalem)`,basis+(closed?'':' Current chips are a current balance, not period profit.')],
  filename:`pokerten-players-${String(clubId).replace(/[^a-zA-Z0-9_-]/g,'_')}-${day(from)}-${day(to==null?asOf:range?to-1:to)}.xlsx`};
}

// Minimal Open XML workbook: typed numbers and inline text, including names
// beginning with '='. No formulas or external links are accepted from report data.
function workbookXml(report){
 const last=col(report.columns.length-1),end=6+report.rows.length;
 const numeric=value=>{if(!Number.isFinite(value))throw Error('The report contains an invalid number. Refresh and try again.');return value;};
 const cell=(value,r,c,style)=>value==null?`<c r="${col(c)}${r}" s="${style}"/>`:typeof value==='number'?
  `<c r="${col(c)}${r}" s="${style}" t="n"><v>${numeric(value)}</v></c>`:
  `<c r="${col(c)}${r}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
 const notes=report.notes.map((n,i)=>`<row r="${i+1}" ht="${i===3?60:28}" customHeight="1">${cell(n,i+1,0,i===0?1:2)}</row>`).join('');
 const headers=`<row r="6" ht="38" customHeight="1">${report.columns.map((c,i)=>cell(c.label,6,i,3)).join('')}</row>`;
 const body=report.rows.map((row,i)=>`<row r="${i+7}" ht="23" customHeight="1">${row.map((v,j)=>cell(v,i+7,j,report.columns[j].money?4:0)).join('')}</row>`).join('');
 const total=`<row r="${end+1}" ht="27" customHeight="1">${report.totals.map((v,j)=>cell(v,end+1,j,report.columns[j].money?5:6)).join('')}</row>`;
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><dimension ref="A1:${last}${end+1}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="23"/><cols>${report.columns.map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${c.width}" customWidth="1"/>`).join('')}</cols><sheetData>${notes}${headers}${body}${total}</sheetData>${report.rows.length?`<autoFilter ref="A6:${last}${end}"/>`:''}<mergeCells count="4">${report.notes.map((_,i)=>`<mergeCell ref="A${i+1}:${last}${i+1}"/>`).join('')}</mergeCells></worksheet>`;
}
const styles=`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]-#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FF123C46"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD5EFE9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1" applyFill="1" applyFont="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

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
  '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  '_rels/.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Players" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
  'xl/styles.xml':styles,'xl/worksheets/sheet1.xml':workbookXml(report)
 };
 return {blob:zip(files),filename:report.filename};
}
function download(data,options){
 const {blob,filename}=createFile(data,options),url=global.URL.createObjectURL(blob),a=global.document.createElement('a');
 a.href=url;a.download=filename;global.document.body.appendChild(a);
 try{a.click();}finally{a.remove();global.setTimeout(()=>global.URL.revokeObjectURL(url),30000);}
}
global.PokerSettlementExcel={createFile,download};
})(window);

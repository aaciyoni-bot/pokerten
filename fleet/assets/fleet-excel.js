/* Browser-side XLSX export. JSZip 3.10.1 is bundled locally under its MIT license.
   SpreadsheetML structure: https://learn.microsoft.com/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document */
const FleetExcel=(()=>{
 const xml=x=>String(x??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
 const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
 const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 function sheetXml(rows){
  const width=Math.max(1,...rows.map(r=>r.length)),end=col(width-1)+Math.max(rows.length,1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><dimension ref="A1:${end}"/><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols><col min="1" max="${width}" width="24" customWidth="1"/></cols><sheetData>${rows.map((row,r)=>`<row r="${r+1}"${r===0?' ht="36" customHeight="1"':''}>${row.map((v,c)=>{const ref=col(c)+(r+1);if(typeof v==='number'&&Number.isFinite(v))return `<c r="${ref}" s="${r===0?1:2}"><v>${v}</v></c>`;const t=typeof v==='object'&&v!==null?JSON.stringify(v):String(v??'');if(t.length>32767)throw new Error('אחד השדות ארוך ממגבלת Excel; אפשר לשלוף גיבוי JSON מלא');return `<c r="${ref}" s="${r===0?1:0}" t="inlineStr"><is><t xml:space="preserve">${xml(t)}</t></is></c>`;}).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:${end}"/></worksheet>`;
 }
 async function build(tabs,Zip){
  if(!tabs.length)throw new Error('אין לשוניות לייצוא');const zip=new Zip();
  zip.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tabs.map((t,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${tabs.map((t,i)=>`<sheet name="${xml(t.title.slice(0,31))}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tabs.map((t,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${tabs.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml',`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF285345"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  tabs.forEach((tab,i)=>zip.file(`xl/worksheets/sheet${i+1}.xml`,sheetXml(tab.rows)));
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
 }
 function equipmentTab(vehicles,frameworks,data){return {title:'ציוד ואפיון רכב',rows:[['מספר רכב','שם רכב','סוג','מסגרת','אפיון','קוד דלקן','קודנית',...data.equipment.map(x=>x[1]),'הערות כלי נהג','מטפים','אישור 1028 ביציאה האחרונה','מועד האישור','מאשר','מספר צבאי','מספר רישוי צהוב'],...vehicles.filter(v=>!v.deleted).map(v=>[v.number,v.displayName||v.type,v.type,frameworks[v.unit]?.name||v.unit,v.description||'',v.fuelCode||'',v.keypadCode||'',...data.equipment.map(([k])=>data.stateLabel(v.equipment?.[k])),v.driverTools||'',v.extinguisherCount??'',v.serviceDispatch?.form1028Completed?'מולא':'לא נרשם',v.serviceDispatch?.at||'',v.serviceDispatch?.by||'',...(typeof FleetVehicleNumbers!=='undefined'?Object.values(FleetVehicleNumbers.get(v)):['',''])])]};}
 return {build,sheetXml,equipmentTab};
})();
if(typeof module!=='undefined')module.exports=FleetExcel;
if(typeof window!=='undefined'){
 let exporting=false;
 window.downloadFleetExcel=async function(kind='mileage'){
  if(exporting)return;if(kind==='full'&&!guard())return;exporting=true;
  try{
   toast('טוען נתונים עדכניים לדוח');const state=await FleetIO.freshState(),frameworks={...FRBY,...Object.fromEntries(state.frameworks.map(f=>[f.id,f]))};
   const tabs=kind==='full'?FleetPlanner.report(state,frameworks,dateIL()):FleetVehicleData.mileageTabs(state.vehicles,frameworks);
   tabs.unshift({title:'מועד הדוח',rows:[['מדד','ערך'],['מועד שליפה',new Date().toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})],['מקור','מסד הנתונים המשותף של דרך ארץ'],['עדכון','שליפה חדשה כוללת את העדכונים האחרונים שנשמרו. קובץ שכבר הורד אינו מתעדכן מעצמו.']]});
   const bytes=await FleetExcel.build(tabs,JSZip),blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='derech1894-'+(kind==='full'?'full':'mileage')+'-'+dateIL()+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('דוח האקסל הורד');
  }catch(e){toast(e.message||'לא ניתן להוריד את הדוח');}finally{exporting=false;}
 };
 const renderBeforeExcel=renderFleet;renderFleet=function(){renderBeforeExcel();const heading=document.querySelector('.page-heading');if(heading){const b=document.createElement('button');b.className='chip';b.textContent='אקסל ק״מ';b.onclick=()=>downloadFleetExcel('mileage');heading.append(b);}};
 const b=document.createElement('button');b.dataset.editOnly='true';b.textContent='הורדת דוח אקסל מלא';b.onclick=()=>{closeMenu();downloadFleetExcel('full');};document.getElementById('menu').append(b);
}


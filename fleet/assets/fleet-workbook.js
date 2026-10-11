/* Workbook enrichment: no personal data is bundled in this file. */
const FleetWorkbook=(()=>{
 const empty=x=>x===undefined||x===null||x===''||(Array.isArray(x)&&!x.length);
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const unique=items=>[...new Map(items.map(x=>[JSON.stringify(x),x])).values()];
 const driverFields=['name','company','dept','role','phone','license','trailer','private','lastRefresh','courses','notes','requestedPermits','trainingPlan','refreshRequired','licenseStatus','permitBasis','permits','permitNotMarked'];
 const vehicleFields=['km','nextServiceKm','nextServiceDate','nextServiceNote','serviceDateKind','testExpiry','extinguisherCount','driverTools','inspectionPhotoNote','reportedRemainingKm','notes','serviceIntervalKm','fuelCode','sourceFrameworkLabel'];
 function validate(x){
  if(x?.schema!=='fleet-workbook-v1'||!/^workbook-[a-f0-9]{20}$/.test(x.id)||!Array.isArray(x.drivers)||!Array.isArray(x.vehicles)||x.drivers.length>1000||x.vehicles.length>200)throw new Error('מבנה קובץ הייבוא אינו תקין');
  const pns=x.drivers.map(d=>d.pn),numbers=x.vehicles.map(v=>v.number);
  if(new Set(pns).size!==pns.length||pns.some(p=>!/^\d{6,8}$/.test(p))||new Set(numbers).size!==numbers.length||numbers.some(p=>!/^\d{6,8}$/.test(p)))throw new Error('מספרים כפולים או לא תקינים בייבוא');
  for(const d of x.drivers)if(typeof d.name!=='string'||!d.name.trim()||!Array.isArray(d.sources)||!Array.isArray(d.permits))throw new Error('כרטיס נהג אינו תקין');
  for(const v of x.vehicles){
   if(!v.fields||typeof v.type!=='string'||!Array.isArray(v.sources))throw new Error('רשומת רכב אינה תקינה');
   for(const k of ['km','nextServiceKm','extinguisherCount','serviceIntervalKm'])if(v.fields[k]!==undefined&&(!Number.isFinite(v.fields[k])||v.fields[k]<0))throw new Error('ערך מספרי אינו תקין');
   for(const k of ['nextServiceDate','testExpiry'])if(v.fields[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(v.fields[k]))throw new Error('תאריך אינו תקין');
  }
  return x;
 }
 function merge(before,item,kind,batch){
  if(before?._workbookImports?.includes(batch))return null;
  const out=JSON.parse(JSON.stringify(before||{})),incoming=kind==='drivers'?item:item.fields;
  out.importReview=[...(out.importReview||[]),...(item.importReview||[])];
  for(const key of kind==='drivers'?driverFields:vehicleFields){
   const value=incoming[key];if(empty(value))continue;
   if(empty(out[key]))out[key]=value;
   else if(!same(out[key],value)){
    if(key==='notes'||key==='courses'||key==='trainingPlan'||key==='requestedPermits'||key==='refreshRequired'){
     out[key]=unique([...String(out[key]).split('\n'),...String(value).split('\n')]).join('\n');
    }else out.importReview.push({field:key,current:out[key],incoming:value,source:batch});
   }
  }
  if(kind==='drivers')out.pn=item.pn;
  if(kind==='vehicles'&&before?.type&&before.type!==item.type)out.importReview.push({field:'type',current:before.type,incoming:item.type,source:batch});
  out.importReview=unique(out.importReview);
  out.workbookSources=unique([...(out.workbookSources||[]),...item.sources.map(s=>({...s,batch}))]);
  out._workbookImports=[...(out._workbookImports||[]),batch];
  return out;
 }
 return {validate,merge};
})();
if(typeof module!=='undefined')module.exports=FleetWorkbook;
if(typeof window!=='undefined'){
 openImport=function(){if(!guard())return;openSheet('ייבוא נתוני קובץ',`<p>בחרו קובץ ייבוא שהוכן מהגיליון. רשומות מזוהות לפי מספר אישי או מספר רכב; פרטים סותרים נשמרים לבירור לצד הנתון הקיים.</p><div class="field"><label for="importFile">קובץ JSON</label><input id="importFile" type="file" accept=".json,application/json"></div>`,async()=>{const f=$('#importFile').files[0];if(!f){toast('יש לבחור קובץ');return;}const input=JSON.parse(await f.text());if(input.schema==='fleet-workbook-v1'){await FleetIO.stageWorkbook(input);closeSheet();await openWorkbookReport();}else{const r=await FleetIO.importVehicles(input);closeSheet();toast(r.added+' נוספו, '+r.skipped+' כבר קיימים');}});$('#_sv').textContent='ייבוא ושמירה במסד';};
 const labels={name:'שם',phone:'טלפון',company:'פלוגה',dept:'מחלקה',role:'תפקיד',license:'רישיון',trailer:'נגררת',permits:'היתרים',type:'סוג רכב',km:'ק״מ',nextServiceKm:'ק״מ טיפול הבא',nextServiceDate:'תאריך טיפול',testExpiry:'טסט'};
 const display=x=>Array.isArray(x)?x.join(', '):typeof x==='object'?JSON.stringify(x):String(x??'');
 function provenance(record){
  const warnings=record.importReview||[],sources=record.workbookSources||[];
  return `${warnings.length?`<details class="detail-block" open><summary>⚠ נתונים לבירור (${warnings.length})</summary><p>נתון קיים נשמר כאשר יש סתירה. אפשר לעדכן את הכרטיס לאחר בירור.</p>${warnings.map(w=>`<p><b>${esc(labels[w.field]||w.field)}</b>: ${esc(display(w.current))} ← בקובץ: ${esc(display(w.incoming))}<br><small>${esc(w.source||'')}</small></p>`).join('')}</details>`:''}${sources.length?`<details class="detail-block"><summary>מקורות בקובץ (${sources.length})</summary>${sources.map(s=>`<details><summary>${esc(s.sheet)} · שורה ${s.row}</summary><dl>${Object.entries(s.values).map(([k,v])=>`<dt>${esc(k)}</dt><dd style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(v)}</dd>`).join('')}</dl></details>`).join('')}</details>`:''}`;
 }
 const driverView=openDriver;
 openDriver=function(pn){driverView(pn);const d=getDriver(pn);const block=document.createElement('section');
  block.innerHTML=`${d.licenseStatus?`<p class="pill bad">${esc(d.licenseStatus)}</p>`:''}<div class="dgrid">${[['היתרים מבוקשים / רשימת הכשרה',d.requestedPermits],['תכנית הכשרה',d.trainingPlan],['רענון נדרש',d.refreshRequired],['מקור ההיתרים',d.permitBasis]].filter(x=>x[1]).map(([k,v])=>`<div class="dg"><small>${esc(k)}</small><b style="white-space:pre-wrap">${esc(v)}</b></div>`).join('')}</div>${provenance(d)}`;
  document.querySelector('#sheet .srow')?.before(block);
 };
 const vehicleView=openEdit;
 openEdit=function(id){vehicleView(id);const v=vehicleById(id);if(!v)return;const block=document.createElement('section');
  block.innerHTML=`<div class="dgrid">${[['מטפים',v.extinguisherCount],['כלי נהג',v.driverTools],['צילום / מצב בדיקה לפי הקובץ',v.inspectionPhotoNote],['הערת יעד טיפול',v.nextServiceNote],['מחזור טיפול בק״מ',v.serviceIntervalKm],['ק״מ שנותרו לפי הקובץ',v.reportedRemainingKm],['מסגרת כפי שנרשמה בקובץ',v.sourceFrameworkLabel],...(canEdit()?[['קוד דלק',v.fuelCode]]:[])].filter(x=>x[1]!==undefined&&x[1]!==null&&x[1]!=='').map(([k,a])=>`<div class="dg"><small>${esc(k)}</small><b>${esc(a)}</b></div>`).join('')}</div>${v.serviceDateKind==='deadline'?'<p>מועד הטיפול הוזן כמועד אחרון לביצוע, לא כתור שנקבע במוסך.</p>':''}${provenance(v)}`;
  document.querySelector('#sheet .quick-actions')?.before(block);
 };
 window.openWorkbookReport=async function(){
  if(!guard())return;const jobs=await FleetIO.workbookJobs();
  openSheet('נתוני הקבצים וייבוא',jobs.length?jobs.map(j=>{
   const p=JSON.parse(j.payload),c=p.counts||{};
   return `<article class="detail-block"><h4>${esc(p.filename)}</h4><p>${c.sheets} לשוניות · ${c.tables} טבלאות · ${c.drivers} כרטיסי נהג · ${c.vehicleRecords} רשומות רכב</p><p>${j.completed?'✓ הייבוא הושלם ונבדק מול המסד':'ממתין להשלמת ייבוא'}${j.result?' · '+j.result.drivers+' נהגים, '+j.result.vehicles+' רכבים':''}</p><details><summary>רשומות לבירור (${p.review.length})</summary>${p.review.map(r=>`<p><b>${esc(r.message)}</b><br>${esc(r.name||r.number||r.pn||'')} · ${esc(r.source.sheet)} · שורה ${r.source.row}<br>${esc(Object.entries(r.source.values).map(([k,v])=>k+': '+v).join(' · '))}</p>`).join('')}</details><details><summary>הערות ותאים שלא שויכו (${p.unmapped.length} שורות)</summary>${p.unmapped.map(r=>`<p>${esc(r.sheet)} · שורה ${r.row}<br>${esc(Object.entries(r.values).map(([k,v])=>k+': '+v).join(' · '))}</p>`).join('')}</details><details><summary>כל הלשוניות ונתוני המקור</summary>${p.sourceSheets.map(s=>`<details><summary>${esc(s.name)} · ${s.rows.length} שורות</summary>${s.rows.map(r=>`<p><b>שורה ${r.row}</b> ${esc(Object.entries(r.cells).map(([k,v])=>k+': '+v.value).join(' · '))}</p>`).join('')}</details>`).join('')}</details></article>`;
  }).join(''):'<p>לא הוכנו קבצים לייבוא.</p>',async()=>{await FleetIO.importPendingWorkbooks();await openWorkbookReport();});
  $('#_sv').textContent=jobs.some(j=>!j.completed)?'השלמת ייבוא':'בדיקה חוזרת';
 };
 const driverEditor=editDriver;
 editDriver=function(pn){driverEditor(pn);const d=getDriver(pn),fields=[['name','שם מלא'],['company','פלוגה'],['license','סוג רישיון'],['trailer','קיימת נגררת'],['lastRefresh','רענון אחרון'],['courses','דרישות קורסים'],['requestedPermits','היתרים מבוקשים'],['trainingPlan','תכנית הכשרה'],['refreshRequired','רענון נדרש'],['licenseStatus','מצב רישיון']];
  const container=document.createElement('section');container.innerHTML=fields.map(([k,l])=>`<div class="field"><label for="wd_${k}">${l}</label><input id="wd_${k}" ${k==='lastRefresh'?'type="date"':''} value="${esc(d[k]||'')}"></div>`).join('');document.querySelector('#sheet .field')?.before(container);
  $('#_sv').onclick=async()=>{if(!guard())return;const button=$('#_sv');button.disabled=true;try{const value={...S.driverOverrides[pn]};for(const [k]of fields)value[k]=$('#wd_'+k).value.trim();if(!value.name){toast('יש להזין שם');return;}for(const k of ['phone','role','dept','notes'])value[k]=$('#ed_'+k).value.trim();S.driverOverrides[pn]=value;await save();closeSheet();render();}catch(e){toast(e.message||'השמירה נכשלה');}finally{if(button.isConnected)button.disabled=false;}};
 };
}

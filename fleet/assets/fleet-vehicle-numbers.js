/* Two identifiers belong to one vehicle record and retain its immutable ID. */
const FleetVehicleNumbers=(()=>{
 const key=x=>String(x??'').replace(/[-\s]/g,'');
 const civil=v=>String(v.prefix||'').includes('ל');
 function get(v){return {militaryNumber:civil(v)?v.militaryNumber||'':v.number||v.militaryNumber||'',yellowNumber:civil(v)?v.number||v.yellowNumber||'':v.yellowNumber||''};}
 function compose(v,military,yellow,primary){
  const m=String(military||'').trim(),y=String(yellow||'').trim();
  if(!m&&!y)throw new Error('יש להזין מספר צבאי או מספר רישוי צהוב');
  if(m&&!/^\d{6,8}$/.test(key(m)))throw new Error('מספר צבאי חייב לכלול 6–8 ספרות');
  if(y&&!/^\d{7,8}$/.test(key(y)))throw new Error('מספר רישוי צהוב חייב לכלול 7–8 ספרות');
  if(m&&y&&key(m)===key(y))throw new Error('יש להזין שני מספרים שונים');
  const yellowPrimary=primary==='yellow'?!!y:!m;
  return {...v,militaryNumber:m,yellowNumber:y,number:yellowPrimary?y:m,prefix:yellowPrimary?'ל.ז-':'צ-'};
 }
 function keys(v){const n=get(v);return [...new Set(Object.values(n).map(key).filter(Boolean))];}
 function assertAvailable(v,vehicles){const own=keys(v);if(vehicles.some(x=>String(x.id)!==String(v.id)&&keys(x).some(k=>own.includes(k))))throw new Error('מספר רכב זה כבר קיים במאגר');}
 return {get,key,compose,keys,assertAvailable};
})();
if(typeof module!=='undefined')module.exports=FleetVehicleNumbers;
if(typeof window!=='undefined'){
 window.vehicleNumberFields=function(v,p){const n=FleetVehicleNumbers.get(v);return `<fieldset><legend>מספרי הרכב</legend><div class="srow"><div class="field"><label for="${p}_military">מספר צבאי</label><input id="${p}_military" dir="ltr" inputmode="numeric" value="${esc(n.militaryNumber)}" placeholder="617-665"></div><div class="field"><label for="${p}_yellow">מספר רישוי צהוב</label><input id="${p}_yellow" dir="ltr" inputmode="numeric" value="${esc(n.yellowNumber)}" placeholder="123-45-678"></div></div><div class="field"><label for="${p}_primary">מספר ראשי לתצוגה</label><select id="${p}_primary"><option value="military" ${!isCivil(v)?'selected':''}>צבאי</option><option value="yellow" ${isCivil(v)?'selected':''}>צהוב</option></select></div><p>אפשר למלא אחד או את שניהם. שני המספרים שייכים לאותו רכב.</p></fieldset>`;};
 window.readVehicleNumbers=function(v,p){const next=FleetVehicleNumbers.compose(v,$('#'+p+'_military').value,$('#'+p+'_yellow').value,$('#'+p+'_primary').value);FleetVehicleNumbers.assertAvailable(next,S.vehicles);return next;};
 window.vehicleNumberSummary=function(v){const n=FleetVehicleNumbers.get(v);return `<div class="dgrid"><div class="dg"><small>מספר צבאי</small><b dir="ltr">${esc(n.militaryNumber||'—')}</b></div><div class="dg"><small>מספר רישוי צהוב</small><b dir="ltr">${esc(n.yellowNumber||'—')}</b></div></div>`;};
}

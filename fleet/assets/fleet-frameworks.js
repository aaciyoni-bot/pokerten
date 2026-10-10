(function(root){
 const name=value=>{const n=String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ');if(!n||n.length>80)throw new Error('שם מסגרת חייב להכיל 1–80 תווים');return n;};
 const id=value=>'F_'+Array.from(new TextEncoder().encode(name(value).toLocaleLowerCase('he')),x=>x.toString(16).padStart(2,'0')).join('');
 const belongs=(v,unit)=>v.unit===unit||v.secondaryUnit===unit;
 const assign=(v,unit,secondary,frameworks)=>{if(!frameworks[unit]||(secondary&&(!frameworks[secondary]||secondary===unit||secondary==='POOL')))throw new Error('יש לבחור מסגרות שונות ותקינות');return {...v,unit,secondaryUnit:secondary||''};};
 root.FleetFrameworks={name,id,belongs,assign};
 if(typeof module!=='undefined')module.exports=root.FleetFrameworks;
})(typeof window==='undefined'?globalThis:window);

if(typeof window!=='undefined'){
 const defaults=FR.map(f=>({...f}));
 window.updateFrameworks=function(items){FR.splice(0,FR.length,...defaults,...items.map(f=>({...f,base:'גדוד 1894',slots:[]})));Object.keys(FRBY).forEach(k=>delete FRBY[k]);FR.forEach(f=>FRBY[f.id]=f);};
 window.openNewFramework=function(onCreated){if(!guard())return;openSheet('יצירת מסגרת חדשה','<div class="field"><label for="frameworkName">שם המסגרת</label><input id="frameworkName" maxlength="80" placeholder="שם המסגרת החדשה"></div><p>המסגרת תופיע לכל המשתמשים ותהיה זמינה לשיוך ראשי או נוסף.</p>',async()=>{const id=await FleetIO.createFramework($('#frameworkName').value);closeSheet();toast('המסגרת נוצרה');if(onCreated)onCreated(id);else render();});$('#_sv').textContent='יצירת מסגרת';};
 window.openAssignments=function(id,draft){if(!guard())return;const current=vehicleById(id);if(!current)return;const v=draft||structuredClone(current);
 const options=selected=>FR.map(f=>`<option value="${esc(f.id)}" ${f.id===selected?'selected':''}>${esc(f.name)}</option>`).join('');
 openSheet('שיוכים — '+v.number,`<div class="field"><label for="primaryUnit">מסגרת ראשית</label><select id="primaryUnit">${options(v.unit)}</select></div><div class="field"><label for="secondaryUnit">שיוך נוסף</label><select id="secondaryUnit"><option value="">ללא שיוך נוסף</option>${FR.filter(f=>f.id!=='POOL').map(f=>`<option value="${esc(f.id)}" ${f.id===v.secondaryUnit?'selected':''}>${esc(f.name)}</option>`).join('')}</select></div><button class="chip" id="newAssignmentFramework">+ מסגרת חדשה</button><p>הרכב יופיע בשתי המסגרות וייספר פעם אחת בסך הגדודי. לביטול השיוך הנוסף בוחרים ״ללא שיוך נוסף״.</p>`,async()=>{const next=FleetFrameworks.assign(v,$('#primaryUnit').value,$('#secondaryUnit').value,FRBY);journal(next,'עדכון שיוכים',{from:v.unit,to:next.unit,note:'שיוך נוסף: '+(FRBY[v.secondaryUnit]?.name||'ללא')+' ← '+(FRBY[next.secondaryUnit]?.name||'ללא')});S.vehicles=S.vehicles.map(x=>x.id===id?next:x);await save();closeSheet();render();});
 $('#newAssignmentFramework').onclick=()=>{const pending={...v,unit:$('#primaryUnit').value,secondaryUnit:$('#secondaryUnit').value};openNewFramework(newId=>openAssignments(id,{...pending,secondaryUnit:newId}));};
 };
 const previousOpenEdit=openEdit;
 openEdit=function(id){previousOpenEdit(id);const v=vehicleById(id);if(!v)return;const heading=document.querySelector('#sheet .vehicle-modal-heading');if(heading&&v.secondaryUnit){const label=document.createElement('span');label.textContent='שיוך נוסף: '+(FRBY[v.secondaryUnit]?.name||v.secondaryUnit);heading.append(label);}if(canEdit()){const row=document.querySelector('#sheet .quick-actions');if(row){const b=document.createElement('button');b.className='chip';b.textContent='שיוכים ומסגרות';b.onclick=()=>openAssignments(id);row.append(b);}}};
 const previousRow=fleetVehicleRow;
 fleetVehicleRow=function(v){let html=previousRow(v);if(v.secondaryUnit)html=html.replace('<div class="row-unit">','<div class="row-unit"><small>שיוך נוסף: '+esc(FRBY[v.secondaryUnit]?.name||v.secondaryUnit)+'</small>');return html;};
 const b=document.createElement('button');b.dataset.editOnly='true';b.textContent='+ מסגרת חדשה';b.onclick=()=>{closeMenu();openNewFramework();};document.getElementById('menu').append(b);
}

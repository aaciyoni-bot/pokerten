(function(root){
 const name=value=>{const n=String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ');if(!n||n.length>80)throw new Error('שם מסגרת חייב להכיל 1–80 תווים');return n;};
 const id=value=>'F_'+Array.from(new TextEncoder().encode(name(value).toLocaleLowerCase('he')),x=>x.toString(16).padStart(2,'0')).join('');
 root.FleetFrameworks={name,id};
 if(typeof module!=='undefined')module.exports=root.FleetFrameworks;
})(typeof window==='undefined'?globalThis:window);
if(typeof window!=='undefined'){
 const defaults=FR.map(f=>({...f}));
 window.updateFrameworks=function(items){FR.splice(0,FR.length,...defaults,...items.map(f=>({...f,base:'גדוד 1894',slots:[]})));Object.keys(FRBY).forEach(k=>delete FRBY[k]);FR.forEach(f=>FRBY[f.id]=f);};
 window.openNewFramework=function(onCreated){if(!guard())return;openSheet('יצירת מסגרת חדשה','<div class="field"><label for="frameworkName">שם המסגרת</label><input id="frameworkName" maxlength="80" placeholder="שם המסגרת החדשה"></div><p>המסגרת תופיע לכל המשתמשים. לאחר יצירתה ניתן להעביר אליה רכבים מהמאגר או ממסגרת אחרת.</p>',async()=>{const id=await FleetIO.createFramework($('#frameworkName').value);closeSheet();toast('המסגרת נוצרה');if(onCreated)onCreated(id);else render();});$('#_sv').textContent='יצירת מסגרת';};
 const previousTransfer=openTransfer;
 openTransfer=function(id){previousTransfer(id);if(!canEdit()||!vehicleById(id))return;const select=$('#t_fr');if(!select)return;const b=document.createElement('button');b.className='chip';b.textContent='+ מסגרת חדשה';b.onclick=()=>openNewFramework(newId=>{openTransfer(id);$('#t_fr').value=newId;});select.parentElement.append(b);};
 const b=document.createElement('button');b.dataset.editOnly='true';b.textContent='+ מסגרת חדשה';b.onclick=()=>{closeMenu();openNewFramework();};document.getElementById('menu').append(b);
 const previousRenderFleet=renderFleet;
 renderFleet=function(){previousRenderFleet();if(!canEdit())return;const heading=document.querySelector('.page-heading');if(heading){const button=document.createElement('button');button.className='chip';button.textContent='+ מסגרת חדשה';button.onclick=()=>openNewFramework();heading.append(button);}};
}

import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithEmailAndPassword,createUserWithEmailAndPassword,inMemoryPersistence,onAuthStateChanged,signOut,browserSessionPersistence,setPersistence} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {getFirestore,doc,collection,query,where,getDoc,getDocs,onSnapshot,runTransaction,writeBatch,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {getStorage,ref,uploadBytes,getBlob} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
const app=initializeApp(window.FLEET_FIREBASE_CONFIG,'derech-eretz-1894');
const auth=getAuth(app),db=getFirestore(app),storage=getStorage(app);
const googleApp=initializeApp(window.FLEET_FIREBASE_CONFIG,'derech-eretz-google-export'),googleAuth=getAuth(googleApp);
let activating=false,invitationToken=new URLSearchParams(location.hash.slice(1)).get('activate')||'';
if(invitationToken){history.replaceState(null,'',location.pathname+location.search);document.getElementById('activationConfirm').classList.remove('hidden');document.getElementById('loginPassword').autocomplete='new-password';}
const loginEmail=number=>{number=String(number).trim();if(!/^\d{6,8}$/.test(number))throw new Error('יש להזין מספר אישי תקין');return 'p'+number+'@fleet1894.invalid';};
const loginError=e=>({'auth/invalid-credential':'מספר אישי או סיסמה שגויים','auth/wrong-password':'מספר אישי או סיסמה שגויים','auth/user-not-found':'מספר אישי או סיסמה שגויים','auth/email-already-in-use':'החשבון כבר קיים. היכנסו עם הסיסמה האישית כדי להשלים הפעלה, או פנו למנהל.','auth/too-many-requests':'בוצעו ניסיונות רבים. המתינו לפני ניסיון נוסף.','auth/operation-not-allowed':'הכניסה בסיסמה עדיין לא הופעלה. יש לפנות למנהל המערכת.','auth/weak-password':'הסיסמה אינה עומדת בדרישות. בחרו סיסמה חזקה יותר.'})[e.code]||friendly(e);
async function activate(number,password){
 if(!/^[a-f0-9]{64}$/.test(invitationToken))throw new Error('קישור ההפעלה אינו תקין');
 if(password.length<8)throw new Error('יש להזין סיסמה בת 8 תווים לפחות');
 const email=loginEmail(number);activating=true;
 try{
  await setPersistence(auth,browserSessionPersistence);
  let result;try{result=await createUserWithEmailAndPassword(auth,email,password);}catch(e){if(e.code!=='auth/email-already-in-use')throw e;result=await signInWithEmailAndPassword(auth,email,password);}
  const uid=result.user.uid,inviteRef=path('invitations',invitationToken),memberRef=path('members',uid);
  await runTransaction(db,async tx=>{
   const invitation=await tx.get(inviteRef),existing=await tx.get(memberRef),i=invitation.data();
   if(!i||i.loginEmail!==email||(i.usedBy&&i.usedBy!==uid))throw new Error('קישור ההפעלה אינו מתאים למספר האישי או שכבר נוצל');
   if(existing.exists()){if(i.usedBy===uid)return;throw new Error('החשבון כבר הופעל');}
   tx.set(memberRef,{name:i.name,role:i.role,active:true,loginEmail:email,invitationId:invitationToken});
   tx.update(inviteRef,{usedBy:uid,usedAt:serverTimestamp()});
  });
  invitationToken='';document.getElementById('activationConfirm').classList.add('hidden');document.getElementById('loginPassword').autocomplete='current-password';document.getElementById('passwordLogin').textContent='כניסה';
  activating=false;await loadUser(result.user);
 }catch(e){await signOut(auth);throw e;}finally{activating=false;}
}

const ROOT=['fleet1894','preview'];
const path=(c,id)=>doc(db,...ROOT,c,String(id));
const col=c=>collection(db,...ROOT,c);
const clone=x=>JSON.parse(JSON.stringify(x));
let member=null,unsubs=[],state={vehicles:[],fuel:[],cards:[],driverOverrides:{}},records={},ready=new Set(),online=false,epoch=0,memberUnsub=null;
const clean=o=>{const r={...o};delete r._rev;delete r._updatedAt;return r;};
function emit(){window.fleetStateChanged(clone(state),online);}
function fail(e){online=false;emit();document.getElementById('lgErr').textContent='לא ניתן לטעון את הנתונים: '+friendly(e);}
function friendly(e){return ({'auth/popup-closed-by-user':'חלון ההתחברות נסגר. אפשר לנסות שוב.','auth/unauthorized-domain':'הכתובת עדיין אינה מאושרת להתחברות ב־Firebase.','auth/popup-blocked':'הדפדפן חסם את חלון ההתחברות. יש לאפשר חלונות קופצים לאתר.','permission-denied':'אין הרשאה לפעולה זו.','unavailable':'אין חיבור לשרת. השינוי לא נשמר.'})[e.code]||e.message||'הפעולה לא הושלמה';}
function stop(){unsubs.forEach(f=>f());unsubs=[];records={};ready=new Set();online=false;state={vehicles:[],fuel:[],cards:[],driverOverrides:{}};}
function subscribe(){
 stop();const current=epoch;
 const groups=member.role==='commander'?['vehicles']:['vehicles','fuel','cards','drivers'];
 groups.forEach(c=>{
  const q=member.role==='commander'?query(col(c),where('unit','==',member.scope)):col(c);
  unsubs.push(onSnapshot(q,{includeMetadataChanges:true},snap=>{
   if(current!==epoch)return;
   records[c]=Object.fromEntries(snap.docs.map(d=>[d.id,d.data()]));
   const items=snap.docs.map(d=>d.data());
   if(c==='drivers')state.driverOverrides=Object.fromEntries(snap.docs.map(d=>[d.id,d.data()]));
   else state[c]=items.sort((a,b)=>Number(a.id)-Number(b.id));
   ready.add(c);online=ready.size===groups.length&&!snap.metadata.fromCache;emit();
   if(c==='vehicles'&&!snap.metadata.fromCache){const id=Number(new URLSearchParams(location.search).get('vehicle'));if(id&&state.vehicles.some(v=>v.id===id)&&!window.__fleetDeepLinked){window.__fleetDeepLinked=true;window.openEdit(id);}}
  },fail));
 });
}
async function commitState(next){
 if(!online||!member||member.role!=='officer')throw new Error('אין חיבור או הרשאת עריכה');
 const changes=[];
 for(const c of ['vehicles','fuel','cards','drivers']){
  const desired=c==='drivers'?Object.entries(next.driverOverrides||{}).map(([id,v])=>[id,v]):(next[c]||[]).map(v=>[String(v.id),v]);
  for(const [id,v] of desired){
   const before=(records[c]||{})[id];
   if(before&&(v._rev||0)!==(before._rev||0))throw new Error('הרשומה עודכנה במכשיר אחר. פתח אותה מחדש.');
   if(!before||JSON.stringify(clean(v))!==JSON.stringify(clean(before)))changes.push({c,id,value:clean(v),before:before?clone(before):null});
  }
 }
 if(!changes.length)return;
 // Each UI action changes at most a few records. Import has its own idempotent path.
 if(changes.length>5)throw new Error('יש לשמור עד חמישה שינויים יחד');
 const auditRef=doc(col('audit'));
 await runTransaction(db,async tx=>{
  const reads=await Promise.all(changes.map(ch=>tx.get(path(ch.c,ch.id))));
  const newPlates=[];
  for(let i=0;i<changes.length;i++){
   const ch=changes[i],actual=reads[i];
   if(actual.exists()!==!!ch.before||(actual.exists()&&(actual.data()._rev||0)!==(ch.before._rev||0)))throw new Error('הרשומה השתנתה במכשיר אחר. הנתונים רועננו; יש לפתוח שוב ולנסות.');
   if(ch.c==='vehicles'){
    const key=String(ch.value.number||'').replace(/\D/g,'');
    if(!/^\d{6,8}$/.test(key))throw new Error('מספר הרכב חייב לכלול 6–8 ספרות');
    ch.value.plateKey=key;
    const p=await tx.get(path('plates',key));
    if(p.exists()&&p.data().vehicleId!==ch.id)throw new Error('מספר רכב זה כבר קיים במאגר');
    if(newPlates.includes(key))throw new Error('מספר רכב זה כבר קיים במאגר');newPlates.push(key);
   }
  }
  changes.forEach(ch=>{
   if(ch.c==='vehicles'){
    tx.set(path('plates',ch.value.plateKey),{vehicleId:ch.id});
    if(ch.before?.plateKey&&ch.before.plateKey!==ch.value.plateKey)tx.delete(path('plates',ch.before.plateKey));
   }
   tx.set(path(ch.c,ch.id),{...ch.value,_rev:(ch.before?._rev||0)+1,_updatedAt:serverTimestamp()});
  });
  tx.set(auditRef,{actor:auth.currentUser.uid,at:serverTimestamp(),action:'update',changes:changes.map(ch=>({collection:ch.c,id:ch.id,before:ch.before?clean(ch.before):null,after:ch.value}))});
 });
 // Refresh authoritative snapshots immediately, also resolving snapshot/ack ordering.
 for(const ch of changes){const latest=await getDoc(path(ch.c,ch.id));if(latest.exists())(records[ch.c]??={})[ch.id]=latest.data();}
 rebuild();
}
function rebuild(){for(const c of ['vehicles','fuel','cards'])state[c]=Object.values(records[c]||{}).sort((a,b)=>Number(a.id)-Number(b.id));state.driverOverrides={...(records.drivers||{})};emit();}
async function importVehicles(input){
 if(!member||member.role!=='officer')throw new Error('נדרשת הרשאת עריכה');
 const items=Array.isArray(input)?input:input.vehicles;
 if(!Array.isArray(items)||items.length>200)throw new Error('קובץ הייבוא אינו תקין');
 const numbers=items.map(v=>String(v.number||'').replace(/\D/g,''));
 if(new Set(numbers).size!==items.length||numbers.some(x=>!/^\d{6,8}$/.test(x)))throw new Error('הקובץ מכיל מספרים כפולים או לא תקינים');
 let added=0,skipped=0;
 for(const item of items){
  const key=String(item.number).replace(/\D/g,''),id=String(item.id||Number(key));
  if(!Number.isSafeInteger(Number(id))||Number(id)<=0||!FRBY[item.unit]||!['כשיר','לא כשיר','בטיפול','ממתין לשיבוץ','במשימה','תקול','מושבת'].includes(item.status))throw new Error('רשומת ייבוא אינה תקינה');
  const value={...item,id:Number(id),plateKey:key,drivers:item.drivers||[],history:item.history||[],services:item.services||[],media:item.media||[]};
  const auditRef=doc(col('audit'));
  const inserted=await runTransaction(db,async tx=>{
   const vehicle=await tx.get(path('vehicles',id)),plate=await tx.get(path('plates',key));
   if(vehicle.exists()||plate.exists())return false;
   tx.set(path('vehicles',id),{...value,_rev:1,_updatedAt:serverTimestamp()});
   tx.set(path('plates',key),{vehicleId:id});
   tx.set(auditRef,{actor:auth.currentUser.uid,at:serverTimestamp(),action:'import',changes:[{collection:'vehicles',id,after:value}]});return true;
  });
  if(inserted)added++;else skipped++;
 }
 return {added,skipped};
}
async function importBootstrap(){
 if(!member||member.role!=='officer')return;
 const seed=await getDoc(path('bootstrap','initial-fleet'));
 if(!seed.exists()||seed.data().completed)return;
 const result=await importVehicles(JSON.parse(seed.data().payload));
 await runTransaction(db,async tx=>{const current=await tx.get(path('bootstrap','initial-fleet'));if(current.exists())tx.update(path('bootstrap','initial-fleet'),{completed:true,completedAt:serverTimestamp(),...result});});
 window.toast('רשימת הרכבים נטענה: '+result.added+' נוספו');
}
async function loadUser(user){
 epoch++;if(memberUnsub){memberUnsub();memberUnsub=null;}stop();member=null;window.fleetSession(null);
 if(!user)return;
 const current=epoch;
 memberUnsub=onSnapshot(path('members',user.uid),snap=>{
  if(current!==epoch)return;
  const m=snap.data();if(!snap.exists()||!m.active||m.loginEmail!==user.email){stop();member=null;window.fleetSession(null);document.getElementById('lgErr').textContent='לחשבון זה אין הרשאת גישה פעילה';return;}
  const next={role:m.role,name:m.name,scope:null,owner:false};
  if(!['officer','viewer'].includes(next.role)){fail(new Error('הרשאת הגישה אינה תקינה'));return;}
  const same=member&&JSON.stringify(member)===JSON.stringify(next);member=next;
  if(!same){window.fleetSession(member);subscribe();importBootstrap().catch(fail);}
 },fail);
}
onAuthStateChanged(auth,user=>{if(!activating)loadUser(user).catch(fail);});
window.FleetIO={
 login:async(number,password)=>{await setPersistence(auth,browserSessionPersistence);await signInWithEmailAndPassword(auth,loginEmail(number),password);},activate,hasInvitation:()=>!!invitationToken,loginError,
 async googleToken(kind){if(!member||member.role!=='officer')throw new Error('נדרשת הרשאת עריכה');const provider=new GoogleAuthProvider();provider.addScope(kind==='calendar'?'https://www.googleapis.com/auth/calendar.app.created':'https://www.googleapis.com/auth/drive.file');await setPersistence(googleAuth,inMemoryPersistence);const result=await signInWithPopup(googleAuth,provider);const token=GoogleAuthProvider.credentialFromResult(result).accessToken;await signOut(googleAuth);return token;},
 async getCalendarSettings(){if(!member||!auth.currentUser)throw new Error('נדרשת התחברות');const r=await getDoc(path('preferences',auth.currentUser.uid));return r.data()||{};},
 async setCalendarSettings(value){if(!member||member.role!=='officer')throw new Error('נדרשת הרשאת עריכה');await runTransaction(db,async tx=>{tx.set(path('preferences',auth.currentUser.uid),{calendarId:value.calendarId,lastSync:value.lastSync||'',updatedAt:serverTimestamp()});});},
 logout:()=>signOut(auth),save:commitState,refreshState:rebuild,importVehicles,
 async upload(vehicle,file){if(!online||!member||member.role!=='officer')throw new Error('אין הרשאת העלאה');if(!/^(image\/|video\/|application\/pdf$)/.test(file.type)||file.size>30*1024*1024)throw new Error('ניתן להעלות תמונה, וידאו או PDF עד 30MB');const p=ROOT.join('/')+'/vehicles/'+vehicle.id+'/'+crypto.randomUUID();await uploadBytes(ref(storage,p),file,{contentType:file.type});return {path:p,name:file.name,type:file.type,at:new Date().toISOString()};},
 async mediaBlob(p){if(!p.startsWith(ROOT.join('/')+'/vehicles/'))throw new Error('נתיב קובץ אינו תקין');return getBlob(ref(storage,p),30*1024*1024);}
};
const button=document.getElementById('passwordLogin');button.disabled=false;button.textContent=invitationToken?'הפעלה וקביעת סיסמה':'כניסה';
window.addEventListener('offline',()=>{online=false;emit();});

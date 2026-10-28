'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase/app');
const {getFirestore,connectFirestoreEmulator,doc,getDoc,setDoc,updateDoc,deleteDoc,collection,getDocs,query,where}=require('firebase/firestore');
const serverRequire=require('node:module').createRequire(require('node:path').resolve(__dirname,'../../.synga-functions/package.json'));
const {initializeApp:adminApp,deleteApp:deleteAdmin}=serverRequire('firebase-admin/app');
const {getFirestore:adminFirestore}=serverRequire('firebase-admin/firestore');
const projectId='demo-synga',apps=[];
let admin;
function client(uid,email='player@example.test',database='synga') {
  const app=initializeApp({projectId,apiKey:'emulator-only'},'test-'+apps.length);apps.push(app);
  const db=getFirestore(app,database);
  const options=uid?{mockUserToken:{sub:uid,email,email_verified:true}}:{};
  connectFirestoreEmulator(db,'127.0.0.1',8186,options);
  return db;
}
async function denied(promise){await assert.rejects(promise,e=>e.code==='permission-denied');}
before(async()=>{
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8186','Emulator only');
  admin=adminApp({projectId},'seed');
  for(const database of ['synga','(default)']) {
    const db=adminFirestore(admin,database),batch=db.batch();
    const docs={
      'users/alice':{username:'Alice',email:'alice@example.test',role:'player'},
      'users/bob':{username:'Bob',email:'bob@example.test',role:'player'},
      'clubs/one':{name:'Test club',ownerUid:'owner'},
      'memberships/alice_one':{uid:'alice',clubId:'one',status:'approved',role:'player',balance:100},
      'tables/table':{authorityVersion:2,clubId:'one',players:{},gameState:{}},
      'tables/table/priv/alice':{cards:['As','Ks']},
      'tables/table/priv/bob':{cards:['Ah','Kh']},
      'tables/table/priv/_engine':{deck:['secret']},
      'tables/legacy':{clubId:'one',gameState:{deck:['secret']}},
      'tables/orphan/priv/alice':{cards:['secret']},
      '_pkPinCredentials/secret':{hash:'secret'}
    };
    for(const [p,data] of Object.entries(docs))batch.set(db.doc(p),data);
    await batch.commit();
  }
});
after(async()=>{await Promise.all(apps.map(deleteApp));if(admin)await deleteAdmin(admin);});
test('signed-in player can load only their own profile and membership',async()=>{
  const db=client('alice');assert.equal((await getDoc(doc(db,'users/alice'))).data().username,'Alice');
  await denied(getDoc(doc(db,'users/bob')));await denied(getDocs(collection(db,'users')));
  const memberships=await getDocs(query(collection(db,'memberships'),where('uid','==','alice')));assert.equal(memberships.size,1);
});
test('approved member can query public game state and their own cards',async()=>{
  const db=client('alice');assert.equal((await getDocs(query(collection(db,'tables'),where('authorityVersion','==',2),where('clubId','==','one')))).size,1);
  assert.deepEqual((await getDoc(doc(db,'tables/table/priv/alice'))).data().cards,['As','Ks']);
  for(const p of ['tables/legacy','tables/table/priv/bob','tables/table/priv/_engine','tables/orphan/priv/alice','_pkPinCredentials/secret'])await denied(getDoc(doc(db,p)));
});
test('unauthenticated users and nonmembers cannot read protected state',async()=>{
  await denied(getDocs(collection(client(null),'clubs')));
  await denied(getDoc(doc(client('bob'),'tables/table')));
});
test('wallet, role, ownership, forged identity and oversized writes are denied',async()=>{
  const db=client('alice');
  for(const patch of [{balance:999999},{role:'super_admin'},{username:'x'.repeat(50000)},{email:'aaci.yoni@gmail.com'}, {username:42}])await denied(updateDoc(doc(db,'users/alice'),patch));
  await denied(updateDoc(doc(db,'clubs/one'),{ownerUid:'alice'}));
  await denied(updateDoc(doc(db,'memberships/alice_one'),{balance:100000}));
  await denied(setDoc(doc(db,'users/mallory'),{uid:'alice',role:'super_admin'}));
  await denied(deleteDoc(doc(db,'users/alice')));
});
test('even owner mutations require server functions, private profiles stay self-only',async()=>{
  const db=client('owner','aaci.yoni@gmail.com');
  await denied(getDoc(doc(db,'users/alice')));
  await denied(setDoc(doc(db,'clubs/new'),{ownerUid:'owner'}));
  await denied(updateDoc(doc(db,'memberships/alice_one'),{balance:999}));
});
test('the same rules cannot grant any access to the original default database',async()=>{
  const db=client('alice','aaci.yoni@gmail.com','(default)');
  for(const p of ['users/alice','clubs/one','memberships/alice_one','tables/table'])await denied(getDoc(doc(db,p)));
  await denied(setDoc(doc(db,'clubs/new'),{name:'Blocked'}));
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const dir=fs.existsSync(__dirname+'/../assets')?__dirname+'/../':__dirname+'/../fleet/';
const source=fs.readFileSync(dir+'assets/fleet-cloud.js','utf8'),html=fs.readFileSync(dir+'index.html','utf8');
const activation=source.slice(source.indexOf('const loginEmail='),source.indexOf('const ROOT='));
function fixture(options={}){
 const email='p1111111@fleet1894.invalid',uid='example-user',writes=[],data=new Map([['invitations/'+ 'a'.repeat(64),{name:'Example Viewer',role:'viewer',loginEmail:email,usedBy:'',...options.invite}]]);
 let loaded=null;const elements={};
 const c=vm.createContext({activating:false,invitationToken:'a'.repeat(64),auth:{},db:{},browserSessionPersistence:{},friendly:e=>e.message,setPersistence:async()=>{},createUserWithEmailAndPassword:async()=>{if(options.existing)throw {code:'auth/email-already-in-use'};return {user:{uid,email}};},signInWithEmailAndPassword:async()=>{if(options.wrongPassword)throw {code:'auth/invalid-credential'};return {user:{uid,email}};},signOut:async()=>{},serverTimestamp:()=>({server:true}),path:(c,id)=>c+'/'+id,document:{getElementById:id=>elements[id]??={classList:{add:()=>{},remove:()=>{}}}},loadUser:async u=>{loaded=u;},runTransaction:async(db,fn)=>{const staged=[];const r=await fn({get:async p=>({exists:()=>data.has(p),data:()=>data.get(p)}),set:(p,v)=>staged.push(['set',p,v]),update:(p,v)=>staged.push(['update',p,v])});for(const [op,p,v]of staged){data.set(p,op==='set'?v:{...data.get(p),...v});writes.push([op,p,v]);}return r;}});
 vm.runInContext(activation,c);return {c,data,writes,loaded:()=>loaded};
}
test('activation binds the exact invited role and consumes invitation atomically',async()=>{const f=fixture();await f.c.activate('1111111','example-password');assert.equal(f.data.get('members/example-user').role,'viewer');assert.equal(f.data.get('invitations/'+'a'.repeat(64)).usedBy,'example-user');assert.equal(f.loaded().uid,'example-user');assert.equal(f.c.invitationToken,'');});
test('an invitation for another personal number grants no access',async()=>{const f=fixture({invite:{loginEmail:'p2222222@fleet1894.invalid'}});await assert.rejects(()=>f.c.activate('1111111','example-password'),/אינו מתאים/);assert.equal(f.writes.length,0);});
test('a consumed invitation cannot be reused by another UID',async()=>{const f=fixture({invite:{usedBy:'someone-else'}});await assert.rejects(()=>f.c.activate('1111111','example-password'),/כבר נוצל/);assert.equal(f.writes.length,0);});
test('existing account must authenticate before completing activation',async()=>{const f=fixture({existing:true,wrongPassword:true});await assert.rejects(()=>f.c.activate('1111111','example-password'),e=>e.code==='auth/invalid-credential');assert.equal(f.writes.length,0);});
test('short activation passwords are rejected before authentication',async()=>{const f=fixture();await assert.rejects(()=>f.c.activate('1111111','1234'),/8/);assert.equal(f.writes.length,0);});
test('greeting uses authenticated membership name and read-only users see no edit menu',()=>{
 const nodes={};let nav=false;const edit=[{},{}];const c=vm.createContext({sess:{name:'Example Viewer',role:'viewer'},ROLE_SUB:{viewer:'צפייה'},ROLE_CHIP:{viewer:'צפייה בלבד'},FRBY:{},$:s=>nodes[s]??={},document:{querySelectorAll:()=>edit},buildNav:()=>nav=true});
 const fn=html.match(/^function applyRole\(\).*$/m)[0];vm.runInContext(fn,c);c.applyRole();assert.match(nodes['#hdrSub'].textContent,/ברוך הבא, Example Viewer/);assert.ok(edit.every(b=>b.hidden));assert.ok(nav);
});

test('eight-character activation password is accepted without changing the invited role',async()=>{const f=fixture();await f.c.activate('1111111','11111111');assert.equal(f.loaded().uid,'example-user');assert.equal(f.data.get('members/example-user').role,'viewer');});

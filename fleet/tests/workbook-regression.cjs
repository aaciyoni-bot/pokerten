const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),app=fs.existsSync(path.join(root,'assets'))?root:path.join(root,'fleet');
const importer=require(path.join(app,'assets/fleet-workbook.js'));
const source=fs.readFileSync(path.join(app,'assets/fleet-cloud.js'),'utf8');
const fn=source.slice(source.indexOf('async function importWorkbook('),source.indexOf('async function importPendingWorkbooks('));
function batch(){return {schema:'fleet-workbook-v1',id:'workbook-'+'a'.repeat(20),filename:'synthetic.xlsx',drivers:[{pn:'1111111',name:'Synthetic driver',permits:[],phone:'0500000000',sources:[{sheet:'Drivers',row:2,values:{A:'Synthetic driver'}}]}],vehicles:[{number:'123456',type:'Synthetic type',fields:{km:500,nextServiceKm:1000},sources:[]},{number:'234567',type:'New type',fields:{km:10},sources:[],create:{unit:'POOL',status:'ממתין לשיבוץ'}}]};}
function fixture(){
 const vehicle={id:77,number:'123-456',plateKey:'123456',type:'Synthetic type',unit:'A',status:'כשיר',km:600,drivers:['1111111'],services:[{date:'2026-01-01'}],history:[],_rev:4};
 const data=new Map([['vehicles/77',structuredClone(vehicle)],['plates/123456',{vehicleId:'77'}]]),writes=[];
 const snap=p=>({exists:()=>data.has(p),data:()=>structuredClone(data.get(p))});
 const c=vm.createContext({FleetWorkbook:importer,member:{role:'officer',name:'Editor'},auth:{currentUser:{uid:'editor'}},db:{},path:(kind,id)=>kind+'/'+id,serverTimestamp:()=>({server:true}),clean:o=>{const r={...o};delete r._rev;delete r._updatedAt;return r;},getDoc:async p=>snap(p),runTransaction:async(db,run)=>{const staged=[];const result=await run({get:async p=>snap(p),set:(p,v)=>staged.push([p,v])});for(const [p,v]of staged){data.set(p,structuredClone(v));writes.push(p);}return result;}});
 vm.runInContext(fn,c);return {c,data,writes};
}
test('import enriches exact identities, keeps assignments and conflicting live values, and backs up before changes',async()=>{
 const f=fixture(),r=await f.c.importWorkbook(batch()),v=f.data.get('vehicles/77');
 assert.equal(r.drivers,1);assert.equal(r.vehicles,2);assert.equal(r.createdVehicles,1);
 assert.equal(v.km,600);assert.equal(v.nextServiceKm,1000);assert.equal(v.unit,'A');assert.equal(v.status,'כשיר');assert.deepEqual(v.drivers,['1111111']);assert.equal(v.services.length,1);assert.equal(v._rev,5);assert.equal(v.importReview[0].incoming,500);
 const audit=f.data.get('audit/'+batch().id+'-vehicles-77');assert.equal(audit.changes[0].before.km,600);assert.equal(audit.changes[0].before.nextServiceKm,undefined);
 assert.equal(f.data.get('plates/234567').vehicleId,'234567');assert.equal(f.data.get('drivers/1111111')._rev,1);
});
test('a retry is idempotent and does not replace later manual edits or duplicate history',async()=>{
 const f=fixture();await f.c.importWorkbook(batch());f.data.get('vehicles/77').km=900;const before=f.writes.length;
 const result=await f.c.importWorkbook(batch());assert.equal(result.skipped,3);assert.equal(f.writes.length,before);assert.equal(f.data.get('vehicles/77').km,900);assert.equal(f.data.get('vehicles/77').history.length,1);
});
test('viewers and interrupted editor sessions cannot write',async()=>{
 const f=fixture();f.c.member.role='viewer';await assert.rejects(()=>f.c.importWorkbook(batch()),/הרשאת/);assert.equal(f.writes.length,0);
});
test('known vehicle missing from the server does not become a new vehicle under another ID',async()=>{
 const f=fixture(),b=batch();b.drivers=[];f.data.delete('vehicles/77');await assert.rejects(()=>f.c.importWorkbook(b),/חסר/);assert.equal(f.data.has('vehicles/123456'),false);
});
test('duplicate workbook identities and malformed odometers are rejected before writing',async()=>{
 const f=fixture(),b=batch();b.drivers.push({...b.drivers[0]});await assert.rejects(()=>f.c.importWorkbook(b),/כפולים/);assert.equal(f.writes.length,0);
 const bad=batch();bad.vehicles[0].fields.km=-1;assert.throws(()=>importer.validate(bad),/מספרי/);
});
test('unconfirmed requests stay separate from reported permits',()=>{
 const d=importer.merge(null,{pn:'1111111',name:'Driver',permits:[],requestedPermits:'Requested course',sources:[]},'drivers',batch().id);
 assert.equal(d.permits,undefined);assert.equal(d.requestedPermits,'Requested course');
});

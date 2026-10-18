const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.existsSync(__dirname+'/../assets')?__dirname+'/../':__dirname+'/../fleet/';
const data=require(app+'assets/fleet-vehicle-data.js'),excel=require(app+'assets/fleet-excel.js'),Zip=require(app+'assets/vendor/jszip-3.10.1.min.js');
const actor={name:'Test editor',uid:'test-editor'},at='2026-10-11T10:00:00Z';
test('every new service departure requires a fresh 1028 assertion',()=>{
 const before={status:'כשיר',km:100};assert.throws(()=>data.prepare(before,{...before,status:'בטיפול'},actor,at,'change'),/1028/);
 const first=data.prepare(before,{...before,status:'בטיפול',serviceDispatch:{id:'dispatch-1',form1028Completed:true}},actor,at,'change');
 assert.equal(first.serviceDispatch.actor,actor.uid);assert.equal(first.serviceDispatches.length,1);
 assert.throws(()=>data.prepare({...first,status:'כשיר'},first,actor,at,'change2'),/1028/);
 const next=data.prepare({...first,status:'כשיר'},{...first,serviceDispatch:{id:'dispatch-2',form1028Completed:true}},actor,at,'change2');assert.equal(next.serviceDispatches.length,2);
 first.serviceDispatch.recordedAt={server:true};assert.equal(first.serviceDispatches[0].recordedAt,undefined);
});
test('mileage records original, corrected and cleared values, but does not duplicate unchanged mileage',()=>{
 const before={km:100,status:'כשיר'},v=data.prepare(before,{...before,km:80,kmChangeNote:'Correction'},actor,at,'km1');
 assert.deepEqual(v.mileageHistory[0],{id:'km1',at,by:'Test editor',previous:100,km:80,note:'Correction'});assert.equal(before.mileageHistory,undefined);
 assert.equal(data.prepare(v,{...v,description:'Updated'},actor,at,'km2').mileageHistory.length,1);
 const unknown=data.prepare(v,{...v,km:null},actor,at,'km3');assert.equal(unknown.mileageHistory.length,2);assert.equal(unknown.mileageHistory[1].km,null);
 assert.throws(()=>data.prepare(v,{...v,km:-1},actor,at,'km4'),/ק״מ/);
});
test('equipment distinguishes missing from uninspected, preserving leading zeros in codes',()=>{
 const v=data.prepare(null,{status:'כשיר',equipment:{jack:true,spareWheel:false,reflectiveVest:null},fuelCode:'0012',keypadCode:'0020'},actor,at,'c');
 assert.equal(v.fuelCode,'0012');assert.equal(v.keypadCode,'0020');assert.equal(data.stateLabel(v.equipment.spareWheel),'חסר');assert.equal(data.stateLabel(v.equipment.reflectiveVest),'טרם נבדק');assert.equal(data.equipment.length,6);
});
test('XLSX is a valid package; identifiers and formula-looking input remain literal strings',async()=>{
 const tabs=[{title:'בדיקה',rows:[['מספר','ק״מ','קוד','הערה'],['00123456',1234,'0012','=HYPERLINK("bad")']]}];
 const bytes=await excel.build(tabs,Zip),z=await Zip.loadAsync(bytes),xml=await z.file('xl/worksheets/sheet1.xml').async('string');
 assert.match(xml,/<t xml:space="preserve">00123456<\/t>/);assert.match(xml,/<c r="B2" s="2"><v>1234<\/v>/);assert.match(xml,/rightToLeft="1"/);assert.doesNotMatch(xml,/<f>/);assert.ok(z.file('[Content_Types].xml'));
});
test('full export includes new vehicle fields, mileage and equipment tabs',()=>{
 const c=vm.createContext({FleetVehicleData:data,FleetExcel:excel,module:{exports:{}}});vm.runInContext(fs.readFileSync(app+'assets/fleet-planner.js','utf8'),c);
 const v={id:1,number:'00123456',type:'Test',unit:'A',status:'כשיר',km:100,fuelCode:'0012',equipment:{jack:true}};
 const tabs=c.module.exports.report({vehicles:[v],driverOverrides:{},fuel:[],cards:[]},{A:{name:'A'}},'2026-10-11');
 assert.equal(tabs.length,14);assert.ok(tabs.find(t=>t.title==='ק״מ רכבים'));const eq=tabs.find(t=>t.title==='ציוד ואפיון רכב');assert.equal(eq.rows[1][5],'0012');
});


test('fuel device status remains separate from its code and recognizes prior recorded presence',()=>{const D=require('../assets/fleet-vehicle-data.js');assert.equal(D.fuelLabel({notes:'מצב דלקן: פעיל',fuelCode:'0012'}),'תקין');assert.equal(D.fuelLabel({notes:'מצב דלקן: לא פעיל'}),'לא תקין');assert.equal(D.fuelLabel({notes:'מצב דלקן: אין דלקן'}),'אין דלקן');assert.equal(D.fuelLabel({fuelDeviceStatus:'faulty',notes:'מצב דלקן: פעיל'}),'לא תקין');});

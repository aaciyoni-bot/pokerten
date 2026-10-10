const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),app=fs.existsSync(path.join(root,'index.html'))?root:path.join(root,'fleet');
const p=require(path.join(app,'assets/fleet-planner.js'));
test('service dates work for civilian vehicles and stay stable across month and DST boundaries',()=>{
 assert.equal(p.dueDate({prefix:'ל.ז-',lastService:'2026-03-27',frequency:30}),'2026-04-26');
 assert.equal(p.dueDate({lastService:'2026-03-27',frequency:30,nextServiceDate:'2026-05-01'}),'2026-05-01');
 assert.equal(p.validDate('2026-02-30'),false);assert.equal(p.addDays('2026-12-31',1),'2027-01-01');
});
test('unknown odometer is not overdue and a mileage-only target is tracked',()=>{
 assert.equal(p.due({km:null,nextServiceKm:1000},'2026-01-01').kmDue,false);
 assert.equal(p.due({km:1001,nextServiceKm:1000},'2026-01-01').kmDue,true);
 assert.equal(p.due({nextServiceDate:'2025-12-31'},'2026-01-01').late,true);
});
test('calendar identities are repeatable; removals and missing dates do not create events',()=>{
 const v={id:1,type:'בדיקה',number:'00123456',unit:'A',nextServiceDate:'2026-10-31'};
 const e=p.calendarEvent(v,{A:{name:'א'}});assert.equal(e.end.date,'2026-11-01');
 assert.deepEqual(p.calendarEvent(v,{}).id,e.id);assert.equal(p.calendarEvent({...v,deleted:true},{}),null);
 assert.equal(p.calendarEvent({...v,nextServiceDate:'',nextServiceKm:100},{}),null);
});
test('full report preserves leading-zero identifiers and literal formulas, includes deleted history',()=>{
 const state={vehicles:[{id:1,number:'00123456',unit:'A',type:'רכב',status:'כשיר',notes:'=IMPORTXML("bad")',services:[]},{id:2,number:'00123457',unit:'A',deleted:true,services:[{date:'2026-01-01',km:3}]}],fuel:[],cards:[],driverOverrides:{}};
 const tabs=p.report(state,{A:{name:'א'}},'2026-10-11');assert.equal(tabs.find(t=>t.title==='רכבים').rows.length,2);assert.equal(tabs.find(t=>t.title==='טיפולים').rows.length,2);
 const book=p.spreadsheet(tabs,'דוח'),row=book.sheets[1].data[0].rowData[1].values;
 assert.deepEqual(row[0].userEnteredValue,{stringValue:'00123456'});assert.deepEqual(row[8].userEnteredValue,{stringValue:'=IMPORTXML("bad")'});
 assert.equal(book.sheets.length,11);
});
test('deleted vehicles stay outside active scope and restoration returns them without losing history',()=>{
 const source=fs.readFileSync(path.join(app,'assets/fleet-actions.js'),'utf8');const fn=source.match(/scopeVehicles=function\(\)\{let vs=S\.vehicles\.filter\(v=>showDeletedVehicles[^\n]+/)[0];
 const vehicle={id:1,unit:'A',deleted:true,history:[{action:'מחיקה'}]};const c=vm.createContext({S:{vehicles:[vehicle,{id:2,unit:'C'}]},sess:{role:'commander',scope:'A'},showArchivedVehicles:false,showDeletedVehicles:false});vm.runInContext(fn,c);
 assert.equal(c.scopeVehicles().length,0);c.showDeletedVehicles=true;assert.equal(c.scopeVehicles().length,1);vehicle.deleted=false;c.showDeletedVehicles=false;assert.equal(c.scopeVehicles().length,1);assert.equal(vehicle.history.length,1);
});

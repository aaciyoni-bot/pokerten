/* Driver discovery uses recorded permits only; training requests stay separate. */
const FleetDriverSearch=(()=>{
 const norm=x=>String(x??'').normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').replace(/[״׳"']/g,'').toLowerCase().trim();
 const values=x=>Array.isArray(x)?x:[x||''];
 function matches(d,f={}){
  if(f.company&&d.company!==f.company)return false;
  if(f.license&&d.license!==f.license)return false;
  if(f.permit&&!values(d.permits).includes(f.permit))return false;
  if(f.state==='review'&&!d.importReview?.length)return false;
  if(f.state==='refresh'&&!d.refreshRequired)return false;
  if(f.state==='requests'&&![d.requestedPermits,d.courses,d.trainingPlan].some(Boolean))return false;
  if(f.state==='none'&&values(d.permits).filter(Boolean).length)return false;
  const fields=[d.name,d.company,d.dept,d.role,d.license,...values(d.permits),d.requestedPermits,d.courses,d.trainingPlan,d.refreshRequired,d.licenseStatus,d.notes];
  if(f.pii!==false)fields.push(d.pn,d.phone,String(d.phone||'').replace(/\D/g,''));
  const hay=norm(fields.join(' '));
  return norm(f.query).split(/\s+/).filter(Boolean).every(q=>hay.includes(q));
 }
 function options(drivers,key){return [...new Set(drivers.flatMap(d=>values(d[key])).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'he'));}
 return {matches,options,norm};
})();
if(typeof module!=='undefined')module.exports=FleetDriverSearch;

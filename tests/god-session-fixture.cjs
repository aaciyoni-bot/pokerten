'use strict';
const fs=require('node:fs'),vm=require('node:vm');
const engine=fs.readFileSync(require.resolve('../functions/pokerEngine.js'),'utf8');
const emails=Array.from(vm.runInNewContext(engine.match(/const GOD_EMAILS = [^;]+;/)[0]+' GOD_EMAILS'));
const authority=require('../functions/pokerAuthority');
function grantFor(user,extraEmail){
  const email=user?.email||'', verified=user?.emailVerified===true;
  return {uid:user?.uid,email,god:verified && (emails.includes(email.trim().toLowerCase()) || email===extraEmail),
    oversight:authority.root({auth:{uid:user?.uid,token:{email,email_verified:verified}}})};
}
function mockComponentGrant(fb,extraEmail){
  Object.defineProperty(fb,'viewerGrant',{get:()=>grantFor(fb.auth?.currentUser,extraEmail),configurable:true});
}
const oversightEmails=emails.filter(email=>grantFor({uid:'fixture',email,emailVerified:true}).oversight);
const memberEmails=emails.filter(email=>!oversightEmails.includes(email));
const identities={owner:oversightEmails[0],supervisors:oversightEmails.slice(1),observer:memberEmails[0],
  revoked:'revoked@example.invalid'};
module.exports={emails,identities,grantFor,mockComponentGrant};

'use strict';
const fs=require('node:fs');
const {accessSecret}=require('../functions/godIdentity');
const authoritySource=fs.readFileSync(require.resolve('../functions/pokerAuthority.js'),'utf8');
const rootList=authoritySource.match(/const root=[^\n]*?(\[[^\]]+\])\.includes/);
if(!rootList)throw Error('Missing oversight test fixture');
const roots=JSON.parse(rootList[1].replace(/'/g,'"'));
const emails=[...roots,'observer@example.invalid','observer-b@example.invalid','observer-c@example.invalid','observer-d@example.invalid'];
process.env[accessSecret]=JSON.stringify(emails);
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

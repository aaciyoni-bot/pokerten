'use strict';
// Build an independent codebase; never edit or deploy the original functions/.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.synga-functions');
fs.rmSync(output, {recursive: true, force: true});
fs.mkdirSync(output, {recursive: true});
const owner = 'aaci.yoni@gmail.com';
for (const entry of fs.readdirSync(path.join(root, 'functions'), {withFileTypes: true})) {
  if (!entry.isFile() || !/\.(js|json)$/.test(entry.name) || /test|arena|bench/.test(entry.name)) continue;
  let source = fs.readFileSync(path.join(root, 'functions', entry.name), 'utf8');
  if (entry.name.endsWith('.js')) {
    source = source.replace(/getFirestore\(\)/g, "getFirestore('synga')");
    source = source.replace(/minInstances: 1/g, 'minInstances: 0');
    // All privileged identities belong to SYNGA's owner only.
    source = source.replace(/const GOD_EMAILS = \[[^;]+;/, `const GOD_EMAILS = [${JSON.stringify(owner)}];`);
    source = source.replace(/const allowed=\[[^;]+;/, `const allowed=[${JSON.stringify(owner)}];`);
    source = source.replace("['aaci.yoni@gmail.com','haim29071994@gmail.com']", `[${JSON.stringify(owner)}]`);
    source = source.replace("const uid = 'pk_' +", "const uid = 'synga_' +");
    if (entry.name === 'personalCode.js') {
      const marker = '  return {playerId};\n});';
      assert.equal(source.split(marker).length, 2, 'Owner bootstrap insertion must be unambiguous');
      source = source.replace(marker, `  if (superAdmin) await db.runTransaction(async tx => {
    const club = db.doc('clubs/synga_main'), member = db.doc('memberships/' + uid + '_synga_main');
    const [c,m] = await tx.getAll(club,member);
    if (!c.exists) tx.set(club,{name:'SYNGA CLUB',ownerUid:uid,ownerName:user.displayName||'Owner',createdAt:Date.now()});
    if (!m.exists) tx.set(member,{uid,clubId:'synga_main',username:user.displayName||'Owner',playerId,role:'club_owner',status:'approved',balance:0,clubProfits:0,agentProfits:0});
  });
${marker}`);
    }
    if (entry.name === 'index.js') {
      source = source.replace('Object.assign(exports, require("./aviator"));', '');
      source = source.replace(/onDocumentWrittenWithAuthContext\("([^"]+)",/g,
        (_, document) => `onDocumentWrittenWithAuthContext({document:${JSON.stringify(document)},database:'synga',region:'europe-west1'},`);
    }
    assert.ok(!/getFirestore\(\)|admin\.firestore\(|\(default\)/.test(source), `Unscoped database in ${entry.name}`);
    assert.ok(!/deleteUser\(|updateUser\(|setCustomUserClaims\(/.test(source), `Shared Auth mutation in ${entry.name}`);
  }
  fs.writeFileSync(path.join(output, entry.name === 'index.js' ? 'synga-engine.js' : entry.name), source);
}
fs.copyFileSync(path.join(root,'synga-backend/siteAccess.js'),path.join(output,'siteAccess.js'));
fs.writeFileSync(path.join(output, 'index.js'), "'use strict';\nexports.synga = require('./synga-engine');\nObject.assign(exports.synga,require('./siteAccess'));\n" +
  "exports.synga.backendStatus = require('firebase-functions/v2/https').onCall({region:'us-central1'},async()=>({brand:'SYNGA',databaseId:require('firebase-admin/firestore').getFirestore('synga').databaseId,release:1}));\n");
const pkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json')));
pkg.name = 'synga-functions';
pkg.description = 'SYNGA isolated codebase in the existing Firebase project';
pkg.engines.node = '22';
fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
const lockFile = path.join(output, 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockFile));
lock.name = pkg.name;
lock.packages[''].name = pkg.name;
lock.packages[''].engines = pkg.engines;
fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
console.log('Built SYNGA backend: named database synga, exports synga-*, no original source changes.');

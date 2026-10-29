'use strict';
// The pre-authority engine created synthetic bot stacks without a wallet debit.
// Its leftStacks records are already-paid cash-out receipts (a re-entry floor),
// not outstanding refunds. Keep both in the archive; never replay money effects.
const RETIRED_AT=Date.UTC(2026,8,13);
const DAY=86400000;
const map=v=>v&&typeof v==='object'&&!Array.isArray(v);
const zero=v=>v==null||v===0;
const idle=new Set(['waiting','showdown','ended','finished','done','gameOver','gameover']);
const ghostFields={lastSeen:v=>Number.isFinite(v)&&v>0,cards:v=>Array.isArray(v)&&v.length===0,cardCount:v=>v===0,bet:v=>v===0,actionText:v=>v==='',hasActed:v=>v===false,reveal:v=>v===false,status:v=>v==='sitout'};
const ghost=p=>map(p)&&Object.keys(p).length>0&&Number.isFinite(p.lastSeen)&&Object.entries(p).every(([k,v])=>ghostFields[k]?.(v));
function archiveReason(t,now=Date.now()){
 if(!map(t)||t.authorityVersion!=null&&t.authorityVersion!==1||t.tournamentId||t.tournament||t.cardGameVersion)return null;
 if(t.players!=null&&!map(t.players)||t.gameState!=null&&!map(t.gameState)||t.history!=null&&!Array.isArray(t.history)||t.leftStacks!=null&&!map(t.leftStacks))return null;
 if(t.spin&&Object.prototype.hasOwnProperty.call(t.spin,'fundingPending'))return null;
 const players=t.players||{},g=t.gameState||{},seats=Object.entries(players),phase=g.phase||t.phase||t.status||'waiting';
 if(g.pots!=null&&!Array.isArray(g.pots))return null;
 const pots=g.pots||[];
 const emptyPot=zero(t.pot)&&zero(g.pot)&&zero(g.highestBet)&&pots.every(p=>map(p)&&zero(p.amount));
 if(!seats.length&&idle.has(phase)&&emptyPot&&!g.activeTurnUid)return 'empty-legacy';
 // Only the retired, identifiable format is eligible for synthetic-seat cleanup.
 // A future/malformed protocol, recent activity, real seat, or funded bot blocks.
 if(t.type!=='poker'||!Number.isFinite(t.createdAt)||t.createdAt<=0||t.createdAt>=RETIRED_AT)return null;
 const times=[t.createdAt,t.updatedAt,t.settingsUpdatedAt,t.spinStartAt,g.turnStartedAt,g.showdownAt,
  ...seats.map(([,p])=>p?.lastSeen),...(t.history||[]).map(h=>h?.at),...Object.values(t.leftStacks||{}).map(p=>p?.at)];
 if(times.some(v=>v!=null&&(!Number.isFinite(v)||v>=RETIRED_AT||now-v<DAY)))return null;
 if(g.highestBet!=null&&(!Number.isFinite(g.highestBet)||g.highestBet<0))return null;
 const bots=new Set();
 for(const [uid,p]of seats){
  if(ghost(p))continue;
  if(!map(p)||!/^bot_\d+_[a-z0-9]+$/.test(uid)||p.uid!==uid||p.isBot!==true||p.fundingUid||!zero(p.spinPaid)||!zero(p.pendingTopUp))return null;
  if(['stack','bet','buyTotal'].some(k=>p[k]!=null&&(!Number.isFinite(p[k])||p[k]<0)))return null;
  bots.add(uid);
 }
 if(g.activeTurnUid&&!bots.has(g.activeTurnUid))return null;
 for(const pot of pots){
  if(!map(pot)||!Number.isFinite(pot.amount)||pot.amount<0)return null;
  if(pot.amount>0&&(!Array.isArray(pot.eligible)||!pot.eligible.length||pot.eligible.some(uid=>!bots.has(uid))))return null;
 }
 for(const key of ['handStartWealth','handStartStacks'])if(g[key]&&(!map(g[key])||Object.keys(g[key]).some(uid=>!bots.has(uid))))return null;
 // An anonymous aggregate pot cannot be attributed safely to synthetic bots.
 if(!zero(t.pot)||!zero(g.pot))return null;
 if(!bots.size&&(!idle.has(phase)||!emptyPot))return null;
 if(!idle.has(phase)&&!['preflop','flop','discard','turn','river'].includes(phase))return null;
 return bots.size?'retired-unfunded-bots':'retired-empty-seats';
}
async function archiveTable(tx,db,ref,table,by,now){
 const reason=archiveReason(table,now);
 const A=require('./pokerAuthority');
 if(!reason)A.fail('failed-precondition','This unfinished legacy table needs an accounting review: '+ref.id);
 const archive=db.doc('_pkClosedTables/'+ref.id);
 const [prior,privateDocs]=await Promise.all([tx.get(archive),tx.get(ref.collection('priv').limit(201))]);
 if(prior.exists)A.fail('failed-precondition','A legacy table archive already exists; review before replacing it.');
 if(privateDocs.size>200)A.fail('failed-precondition','Review the oversized legacy table archive.');
 tx.create(archive,{...table,closedAt:now,closedBy:by,legacyArchive:{version:1,reason,moneyEffects:0}});
 for(const doc of privateDocs.docs){tx.create(archive.collection('priv').doc(doc.id),doc.data());tx.delete(doc.ref);}
 tx.create(db.collection('_pkAudit').doc(),{action:'legacy-table-archive',tableId:ref.id,clubId:table.clubId,uid:by,at:now,reason,moneyEffects:0});
 tx.delete(ref);
 return{ok:true,deleted:true,queued:false};
}
module.exports={archiveReason,archiveTable,RETIRED_AT};

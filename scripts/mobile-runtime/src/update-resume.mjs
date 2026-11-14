// A spectator or a player removed by a manager can retain a stale resume marker.
// Only an authoritative read for the same account may remove that one key.
export async function clearStaleResume(root) {
  let timer;
  try {
    const fb=root.fb, uid=fb?.auth?.currentUser?.uid;
    const storage=root.localStorage, saved=storage.getItem('pkResume');
    if(!uid||!saved||!fb.getDocFromServer||String(root.__pkAppView).endsWith('-table'))return;
    const snapshot=await Promise.race([
      fb.getDocFromServer(fb.doc(fb.db,'tables',saved)),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),5000);})
    ]);
    if(fb.auth.currentUser?.uid!==uid||storage.getItem('pkResume')!==saved||String(root.__pkAppView).endsWith('-table'))return;
    if(!snapshot.exists()||!snapshot.data().players?.[uid])storage.removeItem('pkResume');
  } catch(_) { /* Offline, inaccessible or unknown state keeps the guard in place. */ }
  finally {clearTimeout(timer);}
}

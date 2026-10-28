(async function () {
  'use strict';
  if(window.SyngaEntry?.isHost)return;
  const config=window.SYNGA_CONFIG?.firebase;
  if(!config?.projectId)return;
  try {
    if(config.projectId!=='pokerten' || window.SYNGA_CONFIG.databaseId!=='synga' || window.SYNGA_CONFIG.functionsPrefix!=='synga-')throw new Error('SYNGA backend isolation is not configured.');
    const [a,u,d,f]=await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js')
    ]);
    const app=a.initializeApp(config),auth=u.getAuth(app),fx=f.getFunctions(app,window.SYNGA_CONFIG.functionsRegion||'us-central1');
    const persistence=u.setPersistence(auth,u.indexedDBLocalPersistence).catch(()=>u.setPersistence(auth,u.browserLocalPersistence));
    window.fb={auth,db:d.getFirestore(app,'synga'),googleProvider:new u.GoogleAuthProvider()};
    for(const key of ['signInWithPopup','signInWithRedirect','getRedirectResult','onAuthStateChanged','onIdTokenChanged','signOut'])window.fb[key]=u[key];
    for(const key of ['collection','doc','setDoc','getDoc','getDocs','onSnapshot','query','where','updateDoc','addDoc','deleteDoc','runTransaction'])window.fb[key]=d[key];
    window.fb.signInCode=async token=>{await persistence;return u.signInWithCustomToken(auth,token);};
    window.fb.signIn=()=>u.signInWithPopup(auth,window.fb.googleProvider);
    window.fb.fx=(name,data)=>{
      if(!/^[A-Za-z][A-Za-z0-9]*$/.test(name))return Promise.reject(new Error('Invalid SYNGA action.'));
      return f.httpsCallable(fx,'synga-'+name,{timeout:20000})(data).then(r=>r.data);
    };
    u.getRedirectResult(auth).catch(()=>{});
    await persistence;
    window.dispatchEvent(new Event('firebase-ready'));
  } catch(error){window.__syngaBootError=error.message;window.dispatchEvent(new Event('synga-boot-error'));}
})();

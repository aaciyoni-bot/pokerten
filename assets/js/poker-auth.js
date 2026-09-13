(function (root) {
  'use strict';
  const {createElement: h, useState, useRef} = root.React;
  const inputClass = 'w-full bg-slate-950 border border-white/20 rounded-xl px-4 py-3 text-white outline-none';
  const buttonClass = 'w-full btn-gold py-3 rounded-xl disabled:opacity-50';
  function errorText(error) {
    const code = error && error.code || '';
    if (code === 'auth/popup-blocked') return 'חלון Google נחסם בדפדפן. אפשר חלונות קופצים לאתר ונסה שוב.';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'חלון Google נסגר לפני השלמת הכניסה. אפשר לנסות שוב.';
    if (code === 'functions/unauthenticated') return 'מספר השחקן או הקוד האישי שגויים.';
    if (code === 'functions/resource-exhausted') return 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד 15 דקות.';
    if (code === 'functions/failed-precondition') return 'כדי להגדיר קוד אישי, צא והיכנס שוב לחשבון ואז חזור לכאן.';
    if (code === 'auth/unauthorized-domain' || code === 'auth/operation-not-allowed') return 'כניסת Google אינה זמינה בכתובת הזו כרגע.';
    return 'לא ניתן להשלים את הכניסה כרגע. בדוק את החיבור ונסה שוב.';
  }
  const field = (label, value, set, options = {}) => h('label', {className: 'block text-sm text-right'}, label,
    h('input', {className: inputClass + ' mt-1', 'aria-label': label, value, onChange: e => set(e.target.value), required: true, ...options}));
  function CodeLogin({loading = false}) {
    const [register, setRegister] = useState(false), [name, setName] = useState(''), [loginId, setLoginId] = useState('');
    const [pin, setPin] = useState(''), [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const lock = useRef(false);
    const submit = async event => {
      event.preventDefault();
      if (lock.current || loading) return;
      if (!/^\d{8,12}$/.test(pin)) return setError('הקוד האישי צריך להכיל 8–12 ספרות.');
      if (register && pin !== confirm) return setError('הקודים אינם תואמים.');
      if (register && name.trim().length < 2) return setError('השם צריך להכיל לפחות 2 תווים.');
      if (!register && !/^P\d{9}$/.test(loginId.trim().toUpperCase())) return setError('הזן מספר שחקן שמתחיל ב־P ואחריו 9 ספרות.');
      lock.current = true; setBusy(true); setError('');
      try {
        const result = await root.fb.fx(register ? 'pkPinRegister' : 'pkPinLogin', register ? {name: name.trim(), pin} : {loginId: loginId.trim().toUpperCase(), pin});
        await root.fb.signInCode(result.token);
        setPin(''); setConfirm('');
      } catch (e) { setError(errorText(e)); }
      finally { lock.current = false; setBusy(false); }
    };
    return h('form', {onSubmit: submit, dir: 'rtl', className: 'space-y-3 text-right', 'aria-label': 'כניסה בקוד אישי'},
      h('p', {className: 'text-sm text-slate-300'}, register ? 'חשבון חדש ונפרד. אם כבר שיחקת עם Google, היכנס עם Google כדי לשמור על החשבון הקיים.' : 'מספר שחקן וקוד אישי שהגדרת. אין צורך בהודעת SMS.'),
      register ? field('השם שלך', name, setName, {maxLength: 20, autoComplete: 'nickname'}) : field('מספר שחקן', loginId, setLoginId, {dir: 'ltr', maxLength: 10, autoComplete: 'username', placeholder: 'P123456789'}),
      field('קוד אישי', pin, setPin, {type: 'password', inputMode: 'numeric', minLength: 8, maxLength: 12, autoComplete: register ? 'new-password' : 'current-password'}),
      register && field('אימות קוד אישי', confirm, setConfirm, {type: 'password', inputMode: 'numeric', minLength: 8, maxLength: 12, autoComplete: 'new-password'}),
      error && h('p', {role: 'alert', className: 'auth-error'}, error),
      h('button', {type: 'submit', disabled: busy || loading, className: buttonClass}, busy || loading ? 'מתחבר…' : register ? 'יצירת חשבון וכניסה' : 'כניסה'),
      h('button', {type: 'button', disabled: busy || loading, className: 'w-full underline text-sm py-2', onClick: () => {setRegister(!register); setPin(''); setConfirm(''); setError('');}}, register ? 'יש לי חשבון עם קוד אישי' : 'שחקן חדש? יצירת חשבון עם קוד אישי'));
  }
  function CodeSettings({user}) {
    const [pin, setPin] = useState(''), [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const lock = useRef(false);
    const save = async event => {
      event.preventDefault(); if (lock.current) return;
      if (!/^\d{8,12}$/.test(pin) || pin !== confirm) return setMessage('יש להזין קוד זהה בשני השדות, עם 8–12 ספרות.');
      lock.current = true; setBusy(true); setMessage('');
      try { const result = await root.fb.fx('pkPinEnroll', {pin}); setPin(''); setConfirm(''); setMessage('הקוד נשמר. מספר הכניסה שלך: ' + result.loginId); }
      catch (e) { setMessage(errorText(e)); }
      finally { lock.current = false; setBusy(false); }
    };
    return h('details', {className: 'glass-panel rounded-2xl p-4 my-4', dir: 'rtl'},
      h('summary', {className: 'cursor-pointer font-bold'}, 'הגדרת קוד אישי לכניסה'),
      h('p', {className: 'text-sm my-3'}, 'מספר השחקן שלך: ', h('b', {dir: 'ltr'}, user.playerId), '. הקוד מאפשר כניסה לאותו חשבון, ללא SMS.'),
      h('form', {onSubmit: save, className: 'space-y-3'},
        field('קוד אישי חדש', pin, setPin, {type: 'password', inputMode: 'numeric', minLength: 8, maxLength: 12, autoComplete: 'new-password'}),
        field('אימות הקוד החדש', confirm, setConfirm, {type: 'password', inputMode: 'numeric', minLength: 8, maxLength: 12, autoComplete: 'new-password'}),
        message && h('p', {role: 'status'}, message), h('button', {type: 'submit', disabled: busy, className: buttonClass}, busy ? 'שומר…' : 'שמירת קוד אישי')));
  }
  root.PokerAuthUI = {CodeLogin, CodeSettings, errorText};
})(window);

(function (root) {
  'use strict';
  const {createElement: h, useState, useRef} = root.React;
  const inputClass = 'w-full bg-slate-950 border border-white/20 rounded-xl px-4 py-3 text-white outline-none';
  const buttonClass = 'w-full btn-gold py-3 rounded-xl disabled:opacity-50';
  function errorText(error) {
    const code = error && error.code || '';
    if (code === 'auth/popup-blocked') return 'The Google sign-in window was blocked. Allow pop-ups for this site and try again.';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'The Google sign-in window closed before sign-in was complete. Please try again.';
    if (code === 'functions/unauthenticated') return 'The player ID or personal code is incorrect.';
    if (code === 'functions/resource-exhausted') return 'Too many attempts. Please try again in 15 minutes.';
    if (code === 'functions/failed-precondition') return 'To set a personal code, sign out and sign back in, then return here.';
    if (code === 'auth/unauthorized-domain' || code === 'auth/operation-not-allowed') return 'Google sign-in is currently unavailable at this address.';
    return 'Unable to sign in right now. Check your connection and try again.';
  }
  const field = (label, value, set, options = {}) => h('label', {className: 'block text-sm text-left'}, label,
    h('input', {className: inputClass + ' mt-1', 'aria-label': label, value, onChange: e => set(e.target.value), required: true, ...options}));
  function CodeLogin({loading = false}) {
    const [register, setRegister] = useState(false), [name, setName] = useState(''), [loginId, setLoginId] = useState('');
    const [pin, setPin] = useState(''), [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const lock = useRef(false);
    const submit = async event => {
      event.preventDefault();
      if (lock.current || loading) return;
      if (!/^\d{8,12}$/.test(pin)) return setError('Your personal code must contain 8–12 digits.');
      if (register && pin !== confirm) return setError('The codes do not match.');
      if (register && name.trim().length < 2) return setError('Your name must contain at least 2 characters.');
      if (!register && !/^P\d{9}$/.test(loginId.trim().toUpperCase())) return setError('Enter a player ID starting with P followed by 9 digits.');
      lock.current = true; setBusy(true); setError('');
      try {
        const result = await root.fb.fx(register ? 'pkPinRegister' : 'pkPinLogin', register ? {name: name.trim(), pin} : {loginId: loginId.trim().toUpperCase(), pin});
        await root.fb.signInCode(result.token);
        setPin(''); setConfirm('');
      } catch (e) { setError(errorText(e)); }
      finally { lock.current = false; setBusy(false); }
    };
    return h('form', {onSubmit: submit, dir: 'ltr', className: 'space-y-3 text-left', 'aria-label': 'Personal code sign-in'},
      h('p', {className: 'text-sm text-slate-300'}, register ? 'This creates a separate account. If you already play with Google, sign in with Google to keep your existing account.' : 'Use your player ID and the personal code you set. No SMS required.'),
      register ? field('Your name', name, setName, {maxLength: 20, autoComplete: 'nickname'}) : field('Player ID', loginId, setLoginId, {dir: 'ltr', maxLength: 10, autoComplete: 'username', placeholder: 'P123456789'}),
      field('Personal code', pin, setPin, {type: 'password', inputMode: 'numeric', minLength: 8, maxLength: 12, autoComplete: register ? 'new-password' : 'current-password'}),
      register && field('Confirm personal code', confirm, setConfirm, {type: 'password', inputMode: 'numeric', minLength: 8, maxLength: 12, autoComplete: 'new-password'}),
      error && h('p', {role: 'alert', className: 'auth-error'}, error),
      h('button', {type: 'submit', disabled: busy || loading, className: buttonClass}, busy || loading ? 'Signing in…' : register ? 'Create account and sign in' : 'Sign in'),
      h('button', {type: 'button', disabled: busy || loading, className: 'w-full underline text-sm py-2', onClick: () => {setRegister(!register); setPin(''); setConfirm(''); setError('');}}, register ? 'I already have a personal code account' : 'New player? Create a personal code account'));
  }
  function CodeSettings({user}) {
    const [pin, setPin] = useState(''), [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const lock = useRef(false);
    const save = async event => {
      event.preventDefault(); if (lock.current) return;
      if (!/^\d{8,12}$/.test(pin) || pin !== confirm) return setMessage('Enter the same 8–12 digit code in both fields.');
      lock.current = true; setBusy(true); setMessage('');
      try { const result = await root.fb.fx('pkPinEnroll', {pin}); setPin(''); setConfirm(''); setMessage('Code saved. Your login ID: ' + result.loginId); }
      catch (e) { setMessage(errorText(e)); }
      finally { lock.current = false; setBusy(false); }
    };
    return h('details', {className: 'glass-panel rounded-2xl p-4 my-4', dir: 'ltr'},
      h('summary', {className: 'cursor-pointer font-bold'}, 'Set up a personal sign-in code'),
      h('p', {className: 'text-sm my-3'}, 'Your player ID: ', h('b', {dir: 'ltr'}, user.playerId), '. Use this code to sign in to the same account, with no SMS.'),
      h('form', {onSubmit: save, className: 'space-y-3'},
        field('New personal code', pin, setPin, {type: 'password', inputMode: 'numeric', minLength: 8, maxLength: 12, autoComplete: 'new-password'}),
        field('Confirm new code', confirm, setConfirm, {type: 'password', inputMode: 'numeric', minLength: 8, maxLength: 12, autoComplete: 'new-password'}),
        message && h('p', {role: 'status'}, message), h('button', {type: 'submit', disabled: busy, className: buttonClass}, busy ? 'Saving…' : 'Save personal code')));
  }
  root.PokerAuthUI = {CodeLogin, CodeSettings, errorText};
})(window);

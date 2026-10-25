/* Fullscreen belongs to the outer entrance so intros and game share one screen. */
(function () {
  'use strict';
  if (window.SyngaFullscreen) return;
  let automaticAttempted = false, pending = null;
  function owner() {
    let current = window;
    try {
      while (current !== current.parent) {
        if (current.SyngaEntry?.isHost) break;
        if (!current.parent.document) break;
        current = current.parent;
      }
      if (current.SyngaFullscreen) return current;
    } catch (_) {}
    return window;
  }
  const active = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const installedFullscreen = () => !!window.matchMedia?.('(display-mode: fullscreen)').matches && !active();
  const denied = error => { console.info('SYNGA fullscreen unavailable:',error?.name,error?.message); return false; };
  function enter(automatic = false) {
    const host = owner();
    if (host !== window) return host.SyngaFullscreen.enter(automatic);
    if (active() || installedFullscreen()) return Promise.resolve(true);
    if (pending) return pending;
    if (automatic && automaticAttempted) return Promise.resolve(false);
    automaticAttempted = true;
    const root = document.documentElement;
    if (!root.requestFullscreen && !root.webkitRequestFullscreen) return Promise.resolve(false);
    try {
      // Call synchronously in the trusted click, before transient activation expires.
      const request = root.requestFullscreen ? root.requestFullscreen({navigationUI:'hide'}) : root.webkitRequestFullscreen();
      pending = Promise.resolve(request).then(() => true, denied).finally(() => { pending = null; });
      return pending;
    } catch (error) { return Promise.resolve(denied(error)); }
  }
  function toggle() {
    const host = owner();
    if (host !== window) return host.SyngaFullscreen.toggle();
    automaticAttempted = true;
    if (!active()) return enter();
    try {
      const exit = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen();
      return Promise.resolve(exit).then(() => true, () => false);
    } catch (_) { return Promise.resolve(false); }
  }
  window.SyngaFullscreen = {
    enter, toggle,
    get active() { const host = owner(); return host === window ? active() : host.SyngaFullscreen.active; },
    get available() {
      const host = owner();
      return host === window ? !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen) && !installedFullscreen() : host.SyngaFullscreen.available;
    },
    subscribe(listener) {
      const doc = owner().document;
      doc.addEventListener('fullscreenchange',listener);
      doc.addEventListener('webkitfullscreenchange',listener);
      return () => { doc.removeEventListener('fullscreenchange',listener); doc.removeEventListener('webkitfullscreenchange',listener); };
    }
  };
  document.addEventListener('click',event => {
    if (!event.isTrusted || event.defaultPrevented) return;
    if (event.target.closest?.('[data-synga-auth],.auth-screen button,[data-synga-fullscreen],.poker-fullscreen-button,input,textarea,select,[contenteditable="true"]')) return;
    void enter(true);
  },true);
})();

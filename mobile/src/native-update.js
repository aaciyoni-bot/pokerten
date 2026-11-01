/* Store packages contain a local client. A page reload cannot update it. */
(function (root) {
  'use strict';
  const version = Number(document.querySelector('meta[name="app-version"]')?.content);
  let notice, view = 'auth';
  function check(manual = false) {
    if (!manual) return;
    if (!notice) {
      notice = document.createElement('aside');
      notice.className = 'app-update-notice';
      notice.setAttribute('aria-label', 'App update');
      const message = document.createElement('span');
      message.setAttribute('role', 'status');
      message.textContent = 'Installed game v' + version + '. App updates are installed through your app store.';
      notice.append(message);
      if (root.Capacitor?.getPlatform() === 'android') {
        const link = document.createElement('a');
        link.textContent = 'Check Google Play';
        link.href = 'https://play.google.com/store/apps/details?id=com.orizis.pokerten';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.addEventListener('click', event => {
          if (String(root.__pkAppView || view).endsWith('-table')) {
            event.preventDefault();
            message.textContent = 'Return to the lobby before opening Google Play.';
          }
        });
        notice.append(link);
      }
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Dismiss update notice');
      close.addEventListener('click', () => { notice.hidden = true; });
      notice.append(close);
      document.body.append(notice);
    }
    notice.hidden = false;
  }
  root.PokerAppUpdate = { version, check, reload: () => check(true), setView(next) { view = next; } };
})(window);

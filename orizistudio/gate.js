/* ORIZISTUDIO — שער כניסה לאזור המנהל.
 *
 * חשוב להבין מה זה כן ומה זה לא:
 * הבדיקה מתבצעת בדפדפן, ולכן היא מונעת כניסה מזדמנת של מי שנתקל בכתובת —
 * אבל מי שיפתח את קוד המקור יוכל לעקוף אותה. ההגנה האמיתית היא
 * Deployment Protection של Vercel, שחוסמת בשרת עוד לפני שהדף נטען.
 * השער הזה נועד להיות שכבה נוחה מעליה, לא במקומה.
 *
 * הוספת משתמש: מריצים את djb2 על "שם:סיסמה" באותיות קטנות ומוסיפים ל-USERS.
 */
(function () {
  var USERS = {
    '4a19049e': 'ג׳ני',   // jenni
    '78c8bee9': 'יוני'    // yoni
  };
  var KEY = 'os_gate_v1';

  function djb2(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  function unlocked() {
    try { return !!USERS[localStorage.getItem(KEY)]; } catch (e) { return false; }
  }

  window.osGateUser = function () {
    try { return USERS[localStorage.getItem(KEY)] || ''; } catch (e) { return ''; }
  };
  window.osGateLogout = function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
    location.reload();
  };

  if (unlocked()) return;

  var css = document.createElement('style');
  css.textContent = [
    '.os-gate{position:fixed;inset:0;z-index:9999;background:#0b0b12;display:grid;',
    '  place-items:center;padding:22px;direction:rtl;',
    "  font-family:'Inter','Heebo',system-ui,sans-serif;color:#f5f5fa}",
    '.os-gate .aur{position:absolute;inset:0;overflow:hidden;pointer-events:none}',
    '.os-gate .aur i{position:absolute;border-radius:50%;filter:blur(90px);opacity:.4;display:block}',
    '.os-gate .aur i:first-child{width:460px;height:460px;background:#5b3fff;top:-140px;inset-inline-start:-110px}',
    '.os-gate .aur i:last-child{width:400px;height:400px;background:#ff5ca8;bottom:-150px;inset-inline-end:-120px;opacity:.26}',
    '.os-gate form{position:relative;width:100%;max-width:360px;background:#12121c;',
    '  border:1px solid rgba(255,255,255,.12);border-radius:24px;padding:30px 28px;',
    '  box-shadow:0 24px 60px rgba(0,0,0,.7)}',
    '.os-gate .lg{display:flex;align-items:center;gap:10px;font-weight:700;font-size:19px;',
    "  font-family:'Space Grotesk','Assistant','Heebo',sans-serif}",
    '.os-gate .lg .mk{width:33px;height:33px;border-radius:10px;display:grid;place-items:center;',
    '  font-size:16px;background:linear-gradient(135deg,#7c5cff,#ff5ca8)}',
    '.os-gate .lg .wm{direction:ltr;unicode-bidi:isolate}',
    '.os-gate .lg b{color:#a48bff}',
    '.os-gate h2{margin:20px 0 4px;font-size:20px;font-weight:700;',
    "  font-family:'Space Grotesk','Assistant','Heebo',sans-serif}",
    '.os-gate p.s{color:#6c6c85;font-size:13.5px;margin-bottom:20px}',
    '.os-gate label{display:block;font-size:13px;font-weight:600;color:#a6a6bd;margin:0 0 6px}',
    '.os-gate input{width:100%;box-sizing:border-box;background:#181826;color:#f5f5fa;',
    '  border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px 14px;font-size:16px;',
    '  outline:none;margin-bottom:14px;font-family:inherit}',
    '.os-gate input:focus{border-color:#7c5cff;box-shadow:0 0 0 3px rgba(124,92,255,.16)}',
    '.os-gate button{width:100%;border:none;cursor:pointer;font-family:inherit;font-weight:600;',
    '  font-size:15.5px;padding:13px;border-radius:999px;color:#fff;',
    '  background:linear-gradient(135deg,#7c5cff,#9a6bff);box-shadow:0 10px 26px -12px rgba(124,92,255,.5)}',
    '.os-gate button:hover{filter:brightness(1.07)}',
    '.os-gate .err{color:#ff6b81;font-size:13.5px;margin-top:12px;min-height:1.2em}',
    '.os-gate .ft{color:#6c6c85;font-size:12px;margin-top:16px;text-align:center}'
  ].join('\n');
  document.head.appendChild(css);

  var gate = document.createElement('div');
  gate.className = 'os-gate';
  gate.innerHTML =
    '<div class="aur"><i></i><i></i></div>' +
    '<form autocomplete="off">' +
      '<div class="lg"><span class="mk">◆</span><span class="wm">ORIZI<b>S</b>TUDIO</span></div>' +
      '<h2>אזור מנהל</h2>' +
      '<p class="s">הכלים הפנימיים. לקוחות לא מגיעים לכאן.</p>' +
      '<label for="osu">שם משתמש</label>' +
      '<input id="osu" autocapitalize="none" autocorrect="off" spellcheck="false">' +
      '<label for="osp">סיסמה</label>' +
      '<input id="osp" type="password">' +
      '<button type="submit">כניסה</button>' +
      '<p class="err" id="ose"></p>' +
      '<p class="ft">שכחת? פני ליוני.</p>' +
    '</form>';
  document.documentElement.appendChild(gate);

  var form = gate.querySelector('form');
  var err = gate.querySelector('#ose');
  setTimeout(function () { gate.querySelector('#osu').focus(); }, 60);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var u = gate.querySelector('#osu').value.trim().toLowerCase();
    var p = gate.querySelector('#osp').value;
    var h = djb2(u + ':' + p);
    if (USERS[h]) {
      try { localStorage.setItem(KEY, h); } catch (ex) {}
      gate.remove();
      if (typeof window.osGateReady === 'function') window.osGateReady();
    } else {
      err.textContent = 'שם משתמש או סיסמה לא נכונים.';
      gate.querySelector('#osp').value = '';
      gate.querySelector('#osp').focus();
    }
  });
})();

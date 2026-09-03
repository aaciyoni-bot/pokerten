/* ORIZISTUDIO — וידג'ט נגישות עצמאי (ללא תלות חיצונית).
 * מוסיף כפתור נגישות צף שפותח פאנל אפשרויות: הגדלת טקסט, ניגודיות,
 * הדגשת קישורים, גופן קריא, עצירת אנימציות, סמן גדול ואיפוס.
 * ההעדפות נשמרות במכשיר. תואם RTL, מקלדת וקורא מסך.
 */
(function () {
  'use strict';
  var KEY = 'os_a11y_v1';
  var state = { font: 0, contrast: false, links: false, readable: false, stop: false, cursor: false };
  try { state = Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}

  /* ---------- styles ---------- */
  var css = document.createElement('style');
  css.textContent = [
    /* דילוג לתוכן */
    '.a11y-skip{position:fixed;top:-60px;inset-inline-start:12px;z-index:10001;background:#7c5cff;',
    '  color:#fff;padding:10px 18px;border-radius:0 0 10px 10px;font-weight:700;text-decoration:none;',
    '  font-family:inherit;transition:top .15s}',
    '.a11y-skip:focus{top:0}',
    /* כפתור */
    '.a11y-btn{position:fixed;inset-inline-end:20px;bottom:20px;z-index:9998;width:54px;height:54px;',
    '  border-radius:50%;border:none;cursor:pointer;background:#12121c;color:#fff;',
    '  border:1px solid rgba(255,255,255,.18);box-shadow:0 8px 24px rgba(0,0,0,.4);',
    '  display:grid;place-items:center;transition:transform .15s,box-shadow .15s}',
    '.a11y-btn:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(124,92,255,.4);',
    '  border-color:#a48bff}',
    '.a11y-btn svg{width:28px;height:28px}',
    /* פאנל */
    '.a11y-panel{position:fixed;inset-inline-end:20px;bottom:84px;z-index:9999;width:290px;max-width:calc(100vw - 40px);',
    '  background:#12121c;color:#f5f5fa;border:1px solid rgba(255,255,255,.14);border-radius:18px;',
    '  box-shadow:0 24px 60px rgba(0,0,0,.6);padding:16px;direction:rtl;',
    "  font-family:'Inter','Heebo',system-ui,sans-serif;display:none}",
    '.a11y-panel.open{display:block}',
    '.a11y-panel h2{margin:0 0 4px;font-size:16px;font-weight:800;',
    "  font-family:'Space Grotesk','Assistant','Heebo',sans-serif}",
    '.a11y-panel .sub{color:#a6a6bd;font-size:12px;margin-bottom:12px}',
    '.a11y-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;margin-bottom:8px}',
    '.a11y-opt{width:100%;text-align:start;background:#181826;border:1px solid rgba(255,255,255,.1);',
    '  color:#f5f5fa;border-radius:12px;padding:11px 13px;font-size:14px;font-weight:600;cursor:pointer;',
    '  font-family:inherit;display:flex;align-items:center;gap:9px;transition:border-color .15s,background .15s}',
    '.a11y-opt:hover{border-color:rgba(255,255,255,.25)}',
    '.a11y-opt[aria-pressed="true"]{background:rgba(124,92,255,.16);border-color:#7c5cff;color:#fff}',
    '.a11y-opt .em{font-size:17px;line-height:1}',
    '.a11y-font{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;margin-bottom:8px}',
    '.a11y-font button{background:#181826;border:1px solid rgba(255,255,255,.1);color:#f5f5fa;',
    '  border-radius:10px;padding:9px 0;font-size:18px;font-weight:800;cursor:pointer;font-family:inherit}',
    '.a11y-font button:hover{border-color:#7c5cff}',
    '.a11y-font .lab{text-align:center;font-size:13px;color:#a6a6bd}',
    '.a11y-reset{width:100%;background:transparent;border:1px solid rgba(255,255,255,.16);color:#f5f5fa;',
    '  border-radius:12px;padding:10px;font-size:13.5px;font-weight:600;cursor:pointer;margin-top:6px;font-family:inherit}',
    '.a11y-reset:hover{border-color:#ff6b81;color:#ff6b81}',
    '.a11y-panel .stmt{display:block;text-align:center;margin-top:10px;font-size:12.5px;color:#a48bff;',
    '  text-decoration:none}',
    '.a11y-panel .stmt:hover{text-decoration:underline}',
    /* --- מצבי נגישות מוחלים על העמוד --- */
    'html.a11y-contrast{filter:contrast(1.35) saturate(1.15)}',
    'html.a11y-contrast body{background:#000!important;color:#fff!important}',
    'html.a11y-links a{text-decoration:underline!important;text-underline-offset:2px}',
    'html.a11y-links a:focus,html.a11y-links a:hover{outline:2px solid #ffd400!important;outline-offset:2px}',
    "html.a11y-readable, html.a11y-readable *{font-family:'Arial','Heebo',sans-serif!important;",
    '  letter-spacing:.01em!important;line-height:1.75!important}',
    'html.a11y-stop *{animation:none!important;transition:none!important;scroll-behavior:auto!important}',
    'html.a11y-cursor, html.a11y-cursor *{cursor:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\' viewBox=\'0 0 40 40\'%3E%3Cpath d=\'M6 2l26 14-11 3-5 12z\' fill=\'%23fff\' stroke=\'%23000\' stroke-width=\'2\'/%3E%3C/svg%3E") 6 2, auto!important}',
    '@media (prefers-reduced-motion:reduce){.a11y-btn,.a11y-skip{transition:none}}'
  ].join('\n');
  document.head.appendChild(css);

  /* ---------- skip link ---------- */
  var main = document.querySelector('main') || document.querySelector('#top') || document.body;
  if (main && !main.id) main.id = 'a11y-main';
  var skip = document.createElement('a');
  skip.className = 'a11y-skip';
  skip.href = '#' + (main.id || 'a11y-main');
  skip.textContent = 'דלג לתוכן';
  document.body.insertBefore(skip, document.body.firstChild);

  /* ---------- button + panel ---------- */
  var btn = document.createElement('button');
  btn.className = 'a11y-btn';
  btn.setAttribute('aria-label', 'תפריט נגישות');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="3.6" r="2.1"/><path d="M21 7.5c0 .7-.5 1.2-1.2 1.3l-4.3.5v3l1.9 6.2c.2.7-.2 1.4-.9 1.6-.7.2-1.4-.2-1.6-.9L13 15.2h-2l-1 4c-.2.7-.9 1.1-1.6.9-.7-.2-1.1-.9-.9-1.6l1.9-6.2v-3l-4.3-.5A1.3 1.3 0 0 1 4.2 6c.1-.7.8-1.2 1.5-1.1l5 .6c.9.1 1.7.1 2.6 0l5-.6c.7-.1 1.4.4 1.5 1.1 0 .1 0 .3 0 .5z"/></svg>';

  var panel = document.createElement('div');
  panel.className = 'a11y-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'הגדרות נגישות');
  panel.innerHTML =
    '<h2>נגישות</h2><p class="sub">התאמת האתר לצרכים שלך</p>' +
    '<div class="a11y-font"><button type="button" data-font="-1" aria-label="הקטנת טקסט">א−</button>' +
      '<span class="lab" id="a11y-fontlab">גודל טקסט</span>' +
      '<button type="button" data-font="1" aria-label="הגדלת טקסט">א+</button></div>' +
    '<button class="a11y-opt" data-t="contrast" aria-pressed="false"><span class="em">◐</span>ניגודיות גבוהה</button>' +
    '<button class="a11y-opt" data-t="links" aria-pressed="false"><span class="em">🔗</span>הדגשת קישורים</button>' +
    '<button class="a11y-opt" data-t="readable" aria-pressed="false"><span class="em">א</span>גופן קריא</button>' +
    '<button class="a11y-opt" data-t="stop" aria-pressed="false"><span class="em">⏸</span>עצירת אנימציות</button>' +
    '<button class="a11y-opt" data-t="cursor" aria-pressed="false"><span class="em">➤</span>סמן גדול</button>' +
    '<button class="a11y-reset" type="button">איפוס הגדרות</button>' +
    '<a class="stmt" href="accessibility.html">הצהרת הנגישות המלאה</a>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  /* ---------- apply ---------- */
  function apply() {
    var h = document.documentElement;
    h.classList.toggle('a11y-contrast', state.contrast);
    h.classList.toggle('a11y-links', state.links);
    h.classList.toggle('a11y-readable', state.readable);
    h.classList.toggle('a11y-stop', state.stop);
    h.classList.toggle('a11y-cursor', state.cursor);
    h.style.fontSize = state.font ? (100 + state.font * 12) + '%' : '';
    panel.querySelectorAll('.a11y-opt').forEach(function (b) {
      b.setAttribute('aria-pressed', String(!!state[b.dataset.t]));
    });
    var lab = document.getElementById('a11y-fontlab');
    lab.textContent = state.font ? 'טקסט ' + (state.font > 0 ? '+' : '') + (state.font * 12) + '%' : 'גודל טקסט';
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function toggle(open) {
    var show = open == null ? !panel.classList.contains('open') : open;
    panel.classList.toggle('open', show);
    btn.setAttribute('aria-expanded', String(show));
    if (show) panel.querySelector('.a11y-font button').focus();
  }

  btn.addEventListener('click', function () { toggle(); });
  panel.addEventListener('click', function (e) {
    var opt = e.target.closest('.a11y-opt');
    if (opt) { state[opt.dataset.t] = !state[opt.dataset.t]; apply(); return; }
    var f = e.target.closest('[data-font]');
    if (f) { state.font = Math.max(-2, Math.min(5, state.font + Number(f.dataset.font))); apply(); return; }
    if (e.target.closest('.a11y-reset')) {
      state = { font: 0, contrast: false, links: false, readable: false, stop: false, cursor: false };
      apply();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('open')) { toggle(false); btn.focus(); }
  });
  document.addEventListener('click', function (e) {
    if (panel.classList.contains('open') && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target))
      toggle(false);
  });

  apply();
})();

/* ZADALOG — interactions ------------------------------------------------- */
(function () {
  'use strict';

  var T = window.I18N, ZD = window.ZD;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  T.init();

  /* ---------- year ---------- */
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  /* ---------- language toggle ---------- */
  var lt = document.getElementById('langToggle');
  if (lt) lt.addEventListener('click', function () { T.set(T.lang === 'he' ? 'en' : 'he'); });

  /* ---------- sticky nav + mobile menu ---------- */
  var nav = document.getElementById('nav'), links = document.getElementById('navLinks'),
      burger = document.getElementById('burger');
  function onScrollNav() { nav.classList.toggle('is-stuck', window.scrollY > 20); }
  onScrollNav();
  if (burger) {
    burger.addEventListener('click', function () {
      var open = links.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') { links.classList.remove('is-open'); burger.setAttribute('aria-expanded', 'false'); }
    });
  }

  /* ---------- reveal on scroll ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
  $$('.reveal').forEach(function (el) { io.observe(el); });

  /* ---------- animated counters ---------- */
  var cio = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target, target = +el.dataset.count, suffix = el.dataset.suffix || '';
      cio.unobserve(el);
      if (reduced) { el.textContent = target + suffix; return; }
      var t0 = null, dur = 1500;
      function tick(ts) {
        if (!t0) t0 = ts;
        var p = Math.min((ts - t0) / dur, 1);
        var e = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * e).toLocaleString() + suffix;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.5 });
  $$('[data-count]').forEach(function (el) { cio.observe(el); });

  /* ---------- marquee ---------- */
  function buildMarquee() {
    var row = document.getElementById('marqueeRow'); if (!row) return;
    var items = T.t('mqr');
    var html = items.map(function (s) { return '<span>' + s + '</span>'; }).join('');
    row.innerHTML = html + html;
  }
  buildMarquee();

  /* ---------- live ops ticker ---------- */
  var tickList = document.getElementById('tickerList');
  var tickState = [];
  function randCode() {
    var L = 'ABCDEFGHJKLMNPRSTUVWXZ';
    return L[(Math.random()*22)|0] + L[(Math.random()*22)|0] + L[(Math.random()*22)|0] +
           'U ' + (100000 + ((Math.random()*899999)|0));
  }
  function tickTime(offsetMin) {
    var d = new Date(Date.now() - offsetMin * 60000);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function pushTick(initial) {
    var ev = ZD.TICKER[(Math.random() * ZD.TICKER.length) | 0];
    tickState.unshift({ code: randCode(), ev: ev, min: initial ? (Math.random()*90)|0 : 0 });
    if (tickState.length > 6) tickState.pop();
    paintTicker();
  }
  function paintTicker() {
    if (!tickList) return;
    tickList.innerHTML = tickState.map(function (r) {
      return '<li><span class="t-code">' + r.code + '</span>' +
             '<span class="t-txt">' + (T.lang === 'he' ? r.ev.he : r.ev.en) + '</span>' +
             '<span class="t-time">' + tickTime(r.min) + '</span></li>';
    }).join('');
  }
  if (tickList) {
    for (var i = 0; i < 6; i++) pushTick(true);
    tickState.sort(function (a, b) { return a.min - b.min; });
    paintTicker();
    if (!reduced) setInterval(function () { pushTick(false); }, 3000);
  }

  /* ---------- network table ---------- */
  function buildNet() {
    var body = document.getElementById('netBody'); if (!body) return;
    var freqMap = { weekly: 'freqWeekly', biweekly: 'freqBiweekly', 'twice weekly': 'freqTwice' };
    body.innerHTML = ZD.LANES.map(function (l) {
      var a = ZD.PORTS[l.from], b = ZD.PORTS[l.to];
      var nameA = T.lang === 'he' ? a[2] : a[1], nameB = T.lang === 'he' ? b[2] : b[1];
      return '<tr>' +
        '<td>' + nameA + ' <span class="mono" style="color:var(--ink-3)">' + a[0] + '</span></td>' +
        '<td>' + nameB + '</td>' +
        '<td class="mono">' + l.days + ' ' + T.t('ntDays') + '</td>' +
        '<td>' + T.t(freqMap[l.freq] || 'freqWeekly') + '</td>' +
        '<td><span class="net__tag">' + l.svc + '</span></td>' +
      '</tr>';
    }).join('');
  }
  buildNet();

  /* ---------- testimonials ---------- */
  var qv = document.getElementById('quotesViewport'), qn = document.getElementById('quotesNav');
  var qIdx = 0, qTimer = null;
  function buildQuotes() {
    if (!qv) return;
    qv.innerHTML = ZD.QUOTES.map(function (q, i) {
      var d = T.lang === 'he' ? q.he : q.en;
      return '<figure class="quote' + (i === qIdx ? ' is-on' : '') + '">' +
        '<div class="quote__mark">&#8220;</div>' +
        '<blockquote class="quote__text">' + d.t + '</blockquote>' +
        '<figcaption class="quote__who"><span class="quote__av">' + q.av + '</span>' +
        '<span><b>' + d.n + '</b><span>' + d.r + '</span></span></figcaption>' +
      '</figure>';
    }).join('');
    qn.innerHTML = ZD.QUOTES.map(function (_, i) {
      return '<button type="button" class="' + (i === qIdx ? 'is-on' : '') + '" data-q="' + i +
             '" aria-label="' + (i + 1) + '"></button>';
    }).join('');
  }
  function showQuote(i) {
    qIdx = (i + ZD.QUOTES.length) % ZD.QUOTES.length;
    $$('.quote', qv).forEach(function (el, n) { el.classList.toggle('is-on', n === qIdx); });
    $$('button', qn).forEach(function (el, n) { el.classList.toggle('is-on', n === qIdx); });
  }
  if (qv) {
    buildQuotes();
    qn.addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]'); if (!b) return;
      showQuote(+b.dataset.q); restartQ();
    });
    function restartQ() { clearInterval(qTimer); if (!reduced) qTimer = setInterval(function () { showQuote(qIdx + 1); }, 7000); }
    restartQ();
  }

  /* ---------- unload scroll scene ---------- */
  var unload = document.getElementById('unload');
  var cargoWrap = document.getElementById('contCargo');
  var CARGO_N = 24;
  if (cargoWrap) {
    var h = '';
    for (var b = 0; b < CARGO_N; b++) h += '<b></b>';
    cargoWrap.innerHTML = h;
  }
  var cargoEls = cargoWrap ? $$('b', cargoWrap) : [];
  var doorL = $('.cont__door--l'), doorR = $('.cont__door--r');
  var stepEls = unload ? $$('#unloadSteps li') : [];
  var uBar = document.getElementById('unloadBar'), uPct = document.getElementById('unloadPct');

  function updateUnload() {
    if (!unload || !doorL) return;
    var r = unload.getBoundingClientRect();
    var span = unload.offsetHeight - window.innerHeight;
    var p = span > 0 ? Math.min(Math.max(-r.top / span, 0), 1) : (r.top < window.innerHeight * .6 ? 1 : 0);

    var open = Math.min(Math.max((p - 0.08) / 0.26, 0), 1);
    var deg = open * 104;
    doorL.style.transform = 'perspective(1100px) rotateY(' + (-deg) + 'deg)';
    doorR.style.transform = 'perspective(1100px) rotateY(' + deg + 'deg)';
    doorL.style.opacity = doorR.style.opacity = String(1 - open * 0.15);

    var un = Math.min(Math.max((p - 0.34) / 0.5, 0), 1);
    var gone = Math.round(un * CARGO_N);
    cargoEls.forEach(function (el, i) { el.classList.toggle('is-out', (CARGO_N - 1 - i) < gone); });

    var stepIdx = p < 0.2 ? 0 : p < 0.42 ? 1 : p < 0.78 ? 2 : 3;
    stepEls.forEach(function (el, i) { el.classList.toggle('is-on', i === stepIdx); });

    if (uBar) uBar.style.width = (p * 100).toFixed(0) + '%';
    if (uPct) uPct.textContent = Math.round(p * 100) + '%';
  }

  /* ---------- voyage rail ---------- */
  var railPorts = document.getElementById('voyagePorts'),
      railFill = document.getElementById('voyageFill'),
      railShip = document.getElementById('voyageShip');
  var sections = $$('[data-port]');
  function buildRail() {
    if (!railPorts) return;
    railPorts.innerHTML = sections.map(function (s) {
      return '<li data-for="' + s.dataset.port + '">' +
        (T.lang === 'he' ? s.dataset.portHe : s.dataset.portEn) + '</li>';
    }).join('');
  }
  buildRail();

  var railEl = document.querySelector('.voyage');
  function updateRail() {
    if (!railFill) return;
    if (railEl) railEl.classList.toggle('is-live', window.scrollY > window.innerHeight * 0.75);
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
    railFill.style.height = (p * 100) + '%';
    railShip.style.top = (p * 100) + '%';

    var mid = window.scrollY + window.innerHeight * 0.45, active = null;
    sections.forEach(function (s) {
      if (s.offsetTop <= mid) active = s.dataset.port;
    });
    $$('li', railPorts).forEach(function (li) {
      li.classList.toggle('is-on', li.dataset.for === active);
    });
  }

  /* ---------- scroll loop ---------- */
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      onScrollNav(); updateUnload(); updateRail(); ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  /* ---------- quote form ---------- */
  var form = document.getElementById('quoteForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = document.getElementById('formStatus');
      var name = $('#fName'), phone = $('#fPhone'), email = $('#fEmail');
      var bad = false;
      [name, phone, email].forEach(function (el) {
        var ok = el.value.trim().length > 1;
        if (el === email) ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(el.value.trim());
        if (el === phone) ok = el.value.replace(/\D/g, '').length >= 9;
        el.classList.toggle('is-bad', !ok);
        if (!ok) bad = true;
      });
      if (bad) {
        status.textContent = T.t('fErr');
        status.classList.add('is-bad');
        return;
      }
      status.classList.remove('is-bad');
      status.textContent = T.t('fSending');

      /* No backend yet — hand the enquiry to the mail client so nothing is lost. */
      var fd = new FormData(form), lines = [];
      fd.forEach(function (v, k) { if (v) lines.push(k + ': ' + v); });
      var subject = encodeURIComponent('ZADALOG — ' + (T.lang === 'he' ? 'בקשת הצעת מחיר' : 'Quote request') + ' — ' + name.value.trim());
      var body = encodeURIComponent(lines.join('\n'));

      setTimeout(function () {
        status.textContent = T.t('fOk');
        window.location.href = 'mailto:info@zadalog.com?subject=' + subject + '&body=' + body;
        form.reset();
      }, 500);
    });
  }

  /* ---------- WhatsApp prefill ---------- */
  var wa = document.getElementById('waBtn');
  if (wa) {
    T.onChange(function () {
      wa.href = 'https://wa.me/972000000000?text=' + encodeURIComponent(
        T.lang === 'he' ? 'שלום, אשמח לקבל הצעת מחיר לשילוח.' : 'Hi, I would like a freight quote.');
    });
    wa.href = 'https://wa.me/972000000000?text=' + encodeURIComponent('שלום, אשמח לקבל הצעת מחיר לשילוח.');
  }

  /* ---------- language change hooks ---------- */
  T.onChange(function () { buildMarquee(); paintTicker(); buildNet(); buildQuotes(); buildRail(); updateRail(); });

  /* ---------- boot tools ---------- */
  window.PLANNER.init();
  window.TRACKING.init();
})();

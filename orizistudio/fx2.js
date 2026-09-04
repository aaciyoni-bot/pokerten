/* ORIZISTUDIO — שכבת אינטראקציה לכל האתר.
 * פס התקדמות גלילה, סמן זוהר מותאם, כפתורים מגנטיים, רצועת קטגוריות,
 * מספרים שרצים, הטיית כרטיסים תלת-ממדית וקונפטי בפתיחת הצעה.
 * הכל מכבד prefers-reduced-motion / מסך מגע.
 */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;
  var fine = window.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches;

  /* ---------- פס התקדמות גלילה ---------- */
  var bar = document.getElementById('scrollbar');
  if (bar) {
    var onScroll = function () {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? h.scrollTop / max : 0) + ')';
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- רצועת קטגוריות ---------- */
  var mq = document.getElementById('marquee');
  if (mq) {
    var items = [
      ['🛒', 'חנות אונליין', 1], ['📅', 'זימון תורים', 0], ['📞', 'עמוד נחיתה', 0],
      ['🍽️', 'מסעדה ותפריט', 1], ['🎨', 'תיק עבודות', 0], ['🏷️', 'לוחות ומודעות', 0],
      ['💎', 'מועדון לקוחות', 1], ['🎓', 'קורסים', 0], ['💍', 'אירועים', 0],
      ['🔗', 'לינק בביו', 0], ['🎰', 'גיימינג', 1], ['💇', 'מספרה', 0],
      ['⚖️', 'עורך דין', 0], ['🔧', 'מוסך', 0], ['🩺', 'קליניקה', 0],
      ['💐', 'חנות פרחים', 0], ['🍕', 'פיצריה', 0], ['💪', 'מאמן כושר', 0],
      ['📷', 'צלם', 0], ['🏡', 'נדל״ן', 0], ['☕', 'בית קפה', 0], ['🐾', 'חיות מחמד', 0]
    ];
    var one = items.map(function (it) {
      return '<span class="m-chip' + (it[2] ? ' hot' : '') + '"><span class="e">' +
        it[0] + '</span>' + it[1] + '</span>';
    }).join('');
    mq.innerHTML = one + one;   // כפילות לגלילה חלקה
  }

  /* ---------- סמן זוהר + כפתורים מגנטיים ---------- */
  if (fine && !reduce) {
    var orb = document.getElementById('cursorOrb');
    var ox = window.innerWidth / 2, oy = window.innerHeight / 2, tx = ox, ty = oy, shown = false;
    document.querySelectorAll('.hero-cta .btn, .btn-lg').forEach(function (b) { b.classList.add('magnetic'); });

    window.addEventListener('pointermove', function (e) {
      tx = e.clientX; ty = e.clientY;
      if (!shown && orb) { orb.classList.add('on'); shown = true; }
      var grab = e.target.closest && e.target.closest('a,button,.work,.chip,.m-chip,input,select');
      if (orb) orb.classList.toggle('grab', !!grab);
      // מגנטיות
      var mag = e.target.closest && e.target.closest('.magnetic');
      document.querySelectorAll('.magnetic').forEach(function (b) {
        if (b === mag) {
          var r = b.getBoundingClientRect();
          b.style.transform = 'translate(' + (e.clientX - (r.left + r.width / 2)) * 0.25 + 'px,' +
            (e.clientY - (r.top + r.height / 2)) * 0.35 + 'px)';
        } else if (b.style.transform) { b.style.transform = ''; }
      });
    }, { passive: true });
    window.addEventListener('pointerleave', function () { if (orb) orb.classList.remove('on'); shown = false; });

    if (orb) {
      (function loop() {
        ox += (tx - ox) * 0.22; oy += (ty - oy) * 0.22;
        orb.style.transform = 'translate(' + ox + 'px,' + oy + 'px) translate(-50%,-50%)';
        requestAnimationFrame(loop);
      })();
    }
  }

  /* ---------- הטיית כרטיסי עבודה ---------- */
  if (fine && !reduce) {
    document.addEventListener('pointermove', function (e) {
      var c = e.target.closest && e.target.closest('.work'); if (!c) return;
      var r = c.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      c.style.transform = 'translateY(-6px) rotateY(' + (px * 7) + 'deg) rotateX(' + (-py * 7) + 'deg)';
    }, { passive: true });
    document.addEventListener('pointerout', function (e) {
      var c = e.target.closest && e.target.closest('.work');
      if (c && !c.contains(e.relatedTarget)) c.style.transform = '';
    }, { passive: true });
  }

  /* ---------- מספרים שרצים ---------- */
  if ('IntersectionObserver' in window) {
    var seen = false;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (x) {
        if (!x.isIntersecting || seen) return; seen = true;
        document.querySelectorAll('.stats .stat .n').forEach(function (el) {
          var m = el.textContent.match(/(\d[\d,]*)/);
          if (!m || reduce) return;
          var target = parseInt(m[1].replace(/,/g, ''), 10);
          var suffix = el.textContent.slice(el.textContent.indexOf(m[1]) + m[1].length);
          var prefix = el.textContent.slice(0, el.textContent.indexOf(m[1]));
          var start = null, dur = 1400;
          (function step(ts) {
            if (start === null) start = ts;
            var k = Math.min(1, (ts - start) / dur);
            var e2 = 1 - Math.pow(1 - k, 3);
            el.textContent = prefix + Math.round(target * e2).toLocaleString('en-US') + suffix;
            if (k < 1) requestAnimationFrame(step);
          })(performance.now());
        });
      });
    }, { threshold: 0.4 });
    var stats = document.querySelector('.stats');
    if (stats) io.observe(stats);
  }

  /* ---------- קונפטי בפתיחת הצעה ---------- */
  var modal = document.getElementById('orderModal');
  if (modal && !reduce) {
    var cols = ['#7c5cff', '#a48bff', '#ff7cc0', '#7ce7d0', '#e0b64f'];
    var burst = function () {
      var wrap = document.createElement('div');
      wrap.className = 'confetti';
      for (var i = 0; i < 70; i++) {
        var c = document.createElement('i');
        c.style.left = Math.random() * 100 + 'vw';
        c.style.background = cols[i % cols.length];
        c.style.animationDuration = (1.4 + Math.random() * 1.6) + 's';
        c.style.animationDelay = (Math.random() * 0.25) + 's';
        c.style.transform = 'translateY(0) rotate(' + (Math.random() * 360) + 'deg)';
        wrap.appendChild(c);
      }
      document.body.appendChild(wrap);
      setTimeout(function () { wrap.remove(); }, 3400);
    };
    new MutationObserver(function () {
      if (modal.classList.contains('open')) burst();
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  }
})();

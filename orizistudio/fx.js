/* ORIZISTUDIO — מנוע ה-Hero הוויזואלי.
 * חור שחור זוהר עם דיסקת צבירה, חלקיקים שנשאבים פנימה, ברקים חשמליים
 * ותגובה לעכבר. Canvas 2D בלבד — מהיר, ללא תלות חיצונית, מותאם לנייד.
 * מכבד prefers-reduced-motion ואת מתג "עצירת אנימציות" של וידג'ט הנגישות.
 */
(function () {
  'use strict';
  var canvas = document.querySelector('.hero-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var shell = canvas.parentElement;

  var W = 0, H = 0, DPR = 1, cx = 0, cy = 0;      // מידות ומרכז
  var particles = [], sparks = [], bolts = [];
  var mouse = { x: 0, y: 0, active: false };
  var t = 0, boltTimer = 90, flash = 0, running = true, raf = 0;

  var COL = {
    core:   [168, 139, 255],   // סגול המותג
    hot:    [255, 124, 192],   // מגנטה
    cool:   [124, 231, 208],   // טורקיז
  };
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function lerp(a, b, m) { return a + (b - a) * m; }

  function resize() {
    var r = shell.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 1.75);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W * 0.5; cy = H * 0.52;
    seed();
  }

  function seed() {
    var count = Math.round(Math.min(150, Math.max(50, W / 9)));
    particles = [];
    for (var i = 0; i < count; i++) particles.push(newParticle(true));
  }

  function newParticle(spread) {
    var ang = Math.random() * Math.PI * 2;
    var rad = spread ? (Math.random() * Math.max(W, H) * 0.6 + 90)
                     : (Math.max(W, H) * 0.55 + Math.random() * 120);
    var spin = (Math.random() < 0.5 ? 1 : -1);
    return {
      a: ang, r: rad, spin: spin,
      v: 0.15 + Math.random() * 0.5,
      size: 0.6 + Math.random() * 1.6,
      col: Math.random() < 0.5 ? COL.core : (Math.random() < 0.5 ? COL.hot : COL.cool),
      px: 0, py: 0, hasPrev: false
    };
  }

  /* ---------- ברק ---------- */
  function makeBolt(x1, y1, x2, y2, disp, depth) {
    var pts = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    for (var d = 0; d < depth; d++) {
      var np = [];
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var nx = -(b.y - a.y), ny = (b.x - a.x);
        var len = Math.hypot(nx, ny) || 1;
        var off = (Math.random() - 0.5) * disp;
        np.push(a); np.push({ x: mx + nx / len * off, y: my + ny / len * off });
      }
      np.push(pts[pts.length - 1]);
      pts = np; disp *= 0.55;
    }
    return pts;
  }

  function spawnBolt() {
    var ang = Math.random() * Math.PI * 2;
    var reach = Math.max(W, H) * (0.35 + Math.random() * 0.35);
    var ex = cx + Math.cos(ang) * reach, ey = cy + Math.sin(ang) * reach;
    var col = Math.random() < 0.5 ? COL.hot : COL.cool;
    var main = makeBolt(cx, cy, ex, ey, Math.min(W, H) * 0.18, 5);
    var branches = [];
    for (var i = 0; i < 2; i++) {
      var k = 2 + ((Math.random() * (main.length - 4)) | 0);
      var base = main[k];
      var ba = ang + (Math.random() - 0.5) * 1.4;
      branches.push(makeBolt(base.x, base.y,
        base.x + Math.cos(ba) * reach * 0.4, base.y + Math.sin(ba) * reach * 0.4,
        Math.min(W, H) * 0.09, 4));
    }
    bolts.push({ main: main, branches: branches, col: col, life: 1 });
    flash = 1;
  }

  function drawPath(pts, col, width, alpha) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = rgba(col, alpha);
    ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
  }

  /* ---------- לולאת הרינדור ---------- */
  function frame() {
    if (!running) return;
    t++;

    // דעיכת עקבות
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(11,11,18,0.28)';
    ctx.fillRect(0, 0, W, H);

    // מרכז נמשך קלות לעבר העכבר
    var tx = mouse.active ? lerp(W * 0.5, mouse.x, 0.10) : W * 0.5;
    var ty = mouse.active ? lerp(H * 0.52, mouse.y, 0.10) : H * 0.52;
    cx += (tx - cx) * 0.05; cy += (ty - cy) * 0.05;

    ctx.globalCompositeOperation = 'lighter';

    // הילת הליבה (חור שחור זוהר) + פעימה
    var pulse = 0.6 + Math.sin(t * 0.04) * 0.12 + flash * 0.5;
    var coreR = Math.min(W, H) * 0.16 * pulse;
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    g.addColorStop(0, rgba(COL.core, 0.9));
    g.addColorStop(0.35, rgba(COL.hot, 0.28));
    g.addColorStop(1, rgba(COL.core, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();

    // "אופק האירועים" — טבעת כהה בלב הזוהר
    var holeR = Math.min(W, H) * 0.045;
    ctx.globalCompositeOperation = 'source-over';
    var hg = ctx.createRadialGradient(cx, cy, holeR * 0.2, cx, cy, holeR);
    hg.addColorStop(0, 'rgba(6,6,12,0.95)');
    hg.addColorStop(1, 'rgba(6,6,12,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(cx, cy, holeR, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';

    // דיסקת צבירה — טבעת חלקיקים מסתובבת
    var diskR = Math.min(W, H) * 0.11;
    for (var d = 0; d < 60; d++) {
      var da = (d / 60) * Math.PI * 2 + t * 0.03;
      var wob = Math.sin(da * 3 + t * 0.05) * diskR * 0.08;
      var dx = cx + Math.cos(da) * (diskR + wob) * 1.35;
      var dy = cy + Math.sin(da) * (diskR + wob) * 0.5;   // אליפסה
      var c = d % 2 ? COL.hot : COL.core;
      ctx.fillStyle = rgba(c, 0.5);
      ctx.beginPath(); ctx.arc(dx, dy, 1.4, 0, Math.PI * 2); ctx.fill();
    }

    // חלקיקים נשאבים פנימה
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var pull = 1 + (Math.min(W, H) * 0.16) / (p.r + 30);
      p.r -= p.v * pull;
      p.a += p.spin * (0.004 + 0.6 / (p.r + 60));
      var x = cx + Math.cos(p.a) * p.r;
      var y = cy + Math.sin(p.a) * p.r * 0.82;
      if (p.hasPrev) {
        var near = 1 - Math.min(1, p.r / (Math.max(W, H) * 0.5));
        ctx.strokeStyle = rgba(p.col, 0.15 + near * 0.5);
        ctx.lineWidth = p.size * (0.6 + near * 1.6);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(x, y); ctx.stroke();
      }
      p.px = x; p.py = y; p.hasPrev = true;
      if (p.r < holeR * 0.8) { particles[i] = newParticle(false); }
    }

    // ברקים
    boltTimer--;
    if (boltTimer <= 0 && bolts.length < 2) {
      spawnBolt();
      boltTimer = 130 + (Math.random() * 200) | 0;
    }
    for (var b = bolts.length - 1; b >= 0; b--) {
      var bo = bolts[b];
      var al = bo.life;
      drawPath(bo.main, [255, 255, 255], 4.5, al * 0.5);
      drawPath(bo.main, bo.col, 2, al);
      for (var br = 0; br < bo.branches.length; br++) drawPath(bo.branches[br], bo.col, 1.2, al * 0.7);
      bo.life -= 0.06;
      if (bo.life <= 0) bolts.splice(b, 1);
    }
    flash *= 0.85;

    // ניצוצות אחרי העכבר
    if (mouse.active && t % 2 === 0) {
      sparks.push({ x: mouse.x, y: mouse.y, vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5, life: 1,
        col: Math.random() < 0.5 ? COL.cool : COL.hot });
    }
    for (var s = sparks.length - 1; s >= 0; s--) {
      var sp = sparks[s];
      sp.x += sp.vx; sp.y += sp.vy; sp.life -= 0.03;
      ctx.fillStyle = rgba(sp.col, Math.max(0, sp.life));
      ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.life * 2.2, 0, Math.PI * 2); ctx.fill();
      if (sp.life <= 0) sparks.splice(s, 1);
    }

    raf = requestAnimationFrame(frame);
  }

  /* ---------- מצב סטטי (נגישות / העדפת תנועה) ---------- */
  function staticFrame() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0b0b12'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    var r = Math.min(W, H) * 0.2;
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba(COL.core, 0.7));
    g.addColorStop(0.4, rgba(COL.hot, 0.2));
    g.addColorStop(1, rgba(COL.core, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    for (var d = 0; d < 60; d++) {
      var da = (d / 60) * Math.PI * 2;
      var dx = cx + Math.cos(da) * r * 0.75 * 1.35, dy = cy + Math.sin(da) * r * 0.75 * 0.5;
      ctx.fillStyle = rgba(d % 2 ? COL.hot : COL.core, 0.45);
      ctx.beginPath(); ctx.arc(dx, dy, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  function reduced() {
    return (window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches) ||
      document.documentElement.classList.contains('a11y-stop');
  }

  function start() {
    cancelAnimationFrame(raf);
    if (reduced()) { running = false; staticFrame(); return; }
    running = true; raf = requestAnimationFrame(frame);
  }

  /* ---------- אירועים ---------- */
  window.addEventListener('resize', function () { resize(); if (!running) staticFrame(); }, { passive: true });
  window.addEventListener('mousemove', function (e) {
    var r = shell.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    mouse.active = mouse.y > -80 && mouse.y < H + 80;
  }, { passive: true });
  window.addEventListener('mouseout', function () { mouse.active = false; });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else start();
  });
  // מתג הנגישות (עצירת אנימציות) נצפה דרך שינוי מחלקה ב-<html>
  new MutationObserver(function () { start(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  resize();
  start();
})();

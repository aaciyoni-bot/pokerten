/* ZADALOG — container load planner -------------------------------------- */
window.PLANNER = (function () {
  'use strict';

  var C = window.ZD.CONTAINERS, CARGO = window.ZD.CARGO, T = window.I18N;
  var $ = function (id) { return document.getElementById(id); };

  var state = { cargo: 'eur', cont: '40hc', stack: false };
  var els = {};

  /* ---- packing maths ---------------------------------------------------- */

  /* Max footprints on a rectangular floor using two guillotine strips. */
  function floorFit(L, W, l, w) {
    if (l <= 0 || w <= 0) return 0;
    var best = 0;
    for (var sw = 0; sw < 2; sw++) {
      var a1 = sw ? w : l, b1 = sw ? l : w;   /* strip A orientation */
      var a2 = sw ? l : w, b2 = sw ? w : l;   /* strip B orientation */
      if (a1 > L && a2 > L) continue;
      var rows = Math.floor(L / a1);
      for (var k = 0; k <= rows; k++) {
        var cA = k * Math.floor(W / b1);
        var rem = L - k * a1;
        var cB = Math.floor(rem / a2) * Math.floor(W / b2);
        var tot = cA + cB;
        if (tot > best) best = tot;
      }
    }
    return best;
  }

  function preset() {
    for (var i = 0; i < CARGO.length; i++) if (CARGO[i].id === state.cargo) return CARGO[i];
    return CARGO[0];
  }
  function container(id) {
    for (var i = 0; i < C.length; i++) if (C[i].id === id) return C[i];
    return C[0];
  }

  function readInputs() {
    return {
      l: Math.max(1, +els.len.value || 1),
      w: Math.max(1, +els.wid.value || 1),
      h: Math.max(1, +els.hei.value || 1),
      kg: Math.max(0.1, +els.wgt.value || 0.1),
      qty: Math.max(1, Math.round(+els.qty.value || 1))
    };
  }

  /* Core calculation for one container spec. */
  function calc(spec, cg) {
    var p = preset();
    var untouched = (cg.l === p.L && cg.w === p.W && cg.h === p.H);

    var floors;
    if (p.known && p.known[spec.id] && untouched) floors = p.known[spec.id];
    else floors = floorFit(spec.L, spec.W, cg.l, cg.w);

    var layers = state.stack ? Math.max(1, Math.floor(spec.H / cg.h)) : 1;
    if (cg.h > spec.H) layers = 0;

    var bySpace  = floors * layers;
    var byWeight = Math.floor(spec.payload / cg.kg);
    var fit = Math.max(0, Math.min(bySpace, byWeight));

    var unitCbm = (cg.l * cg.w * cg.h) / 1e6;
    var loaded  = Math.min(fit, cg.qty);
    var volPct  = spec.cbm ? (loaded * unitCbm) / spec.cbm * 100 : 0;
    var wgtPct  = (loaded * cg.kg) / spec.payload * 100;

    return {
      spec: spec, floors: floors, layers: layers, fit: fit,
      bySpace: bySpace, byWeight: byWeight,
      needed: fit > 0 ? Math.ceil(cg.qty / fit) : 0,
      volPct: Math.min(volPct, 100), wgtPct: Math.min(wgtPct, 100),
      loaded: loaded, unitCbm: unitCbm,
      bound: byWeight < bySpace ? 'weight' : 'volume'
    };
  }

  /* ---- isometric render ------------------------------------------------- */

  var COS30 = Math.cos(Math.PI / 6), SIN30 = 0.5;

  function drawIso(res, cg) {
    var svg = els.iso, spec = res.spec;
    var VW = 460, VH = 300, PAD = 26;

    var Lc = spec.L, Wc = spec.W, Hc = spec.H;
    var sc = Math.min(
      (VW - PAD * 2) / ((Lc + Wc) * COS30),
      (VH - PAD * 2) / ((Lc + Wc) * SIN30 + Hc)
    );
    var ox = PAD + Wc * COS30 * sc;
    var oy = PAD + Hc * sc;

    function pt(a, b, z) {
      return [(ox + (a - b) * COS30 * sc).toFixed(1),
              (oy + (a + b) * SIN30 * sc - z * sc).toFixed(1)];
    }
    function poly(pts, fill, stroke, extra) {
      return '<polygon points="' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' ') +
             '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width=".7"' : '') +
             (extra || '') + '/>';
    }

    var out = [];

    /* container floor + wire frame */
    out.push(poly([pt(0,0,0), pt(Lc,0,0), pt(Lc,Wc,0), pt(0,Wc,0)],
                  'rgba(33,212,196,.07)', 'rgba(33,212,196,.35)'));

    /* cargo blocks */
    var nx, ny, nz, bl, bw, bh, cells, fillCells;

    var rawX = Math.max(1, Math.floor(Lc / cg.l));
    var rawY = Math.max(1, Math.floor(Wc / cg.w));
    var rawZ = Math.max(1, res.layers || 1);
    /* prefer the rotated footprint when it fits more per floor */
    if (Math.floor(Lc / cg.w) * Math.floor(Wc / cg.l) > rawX * rawY) {
      rawX = Math.max(1, Math.floor(Lc / cg.w));
      rawY = Math.max(1, Math.floor(Wc / cg.l));
      var sw = cg.l; cg = { l: cg.w, w: sw, h: cg.h, kg: cg.kg, qty: cg.qty };
    }

    if (res.layers === 0 || res.fit === 0) {
      nx = ny = nz = 0;
    } else if (rawX * rawY * rawZ <= 260) {
      nx = rawX; ny = rawY; nz = rawZ;
      bl = cg.l; bw = cg.w; bh = cg.h;
      cells = nx * ny * nz;
      /* mixed-orientation loading can beat the naive grid — stretch it so every
         unit we claim fits is actually drawn, still inside the container walls */
      if (res.loaded > cells) {
        nx = Math.ceil(res.loaded / (ny * nz));
        bl = Math.min(bl, Lc / nx);
        cells = nx * ny * nz;
      }
      fillCells = Math.min(cells, res.loaded);
    } else {
      /* too many units to draw individually — draw proportional blocks */
      var f = Math.cbrt(260 / (rawX * rawY * rawZ));
      nx = Math.max(1, Math.round(rawX * f * 1.6));
      ny = Math.max(1, Math.round(rawY * f));
      nz = Math.max(1, Math.round(rawZ * f));
      bl = Lc / nx; bw = Wc / ny; bh = Hc / nz;
      cells = nx * ny * nz;
      var ratio = Math.max(res.volPct, 0) / 100;
      fillCells = Math.round(cells * ratio);
    }

    var list = [];
    var placed = 0;
    for (var k = 0; k < nz && placed < fillCells; k++) {
      for (var j = 0; j < ny && placed < fillCells; j++) {
        for (var i = 0; i < nx && placed < fillCells; i++) {
          list.push([i, j, k]); placed++;
        }
      }
    }
    list.sort(function (a, b) { return (a[0] + a[1]) - (b[0] + b[1]) || a[2] - b[2]; });

    list.forEach(function (c) {
      var i = c[0], j = c[1], k = c[2];
      var a0 = i * bl, a1 = a0 + bl * .97;
      var b0 = j * bw, b1 = b0 + bw * .97;
      var z0 = k * bh, z1 = z0 + bh * .97;
      out.push(poly([pt(a0,b0,z1), pt(a1,b0,z1), pt(a1,b1,z1), pt(a0,b1,z1)], '#E5A75B', 'rgba(0,0,0,.35)'));
      out.push(poly([pt(a1,b0,z0), pt(a1,b1,z0), pt(a1,b1,z1), pt(a1,b0,z1)], '#B77F3C', 'rgba(0,0,0,.35)'));
      out.push(poly([pt(a0,b1,z0), pt(a1,b1,z0), pt(a1,b1,z1), pt(a0,b1,z1)], '#8C5C28', 'rgba(0,0,0,.35)'));
    });

    /* container wire cage on top */
    var e = 'rgba(160,200,235,.42)';
    function line(p1, p2, o) {
      return '<line x1="' + p1[0] + '" y1="' + p1[1] + '" x2="' + p2[0] + '" y2="' + p2[1] +
             '" stroke="' + e + '" stroke-width="1" opacity="' + (o || 1) + '"/>';
    }
    var c000 = pt(0,0,0), c100 = pt(Lc,0,0), c110 = pt(Lc,Wc,0), c010 = pt(0,Wc,0);
    var c001 = pt(0,0,Hc), c101 = pt(Lc,0,Hc), c111 = pt(Lc,Wc,Hc), c011 = pt(0,Wc,Hc);
    out.push(line(c000,c100), line(c100,c110), line(c110,c010,.45), line(c010,c000,.45));
    out.push(line(c001,c101), line(c101,c111), line(c111,c011), line(c011,c001));
    out.push(line(c000,c001,.45), line(c100,c101), line(c110,c111), line(c010,c011,.45));

    svg.innerHTML = out.join('');
    els.vizTag.textContent = spec.label;
  }

  /* ---- render ----------------------------------------------------------- */

  function fmt(n) { return n.toLocaleString(T.lang === 'he' ? 'he-IL' : 'en-US'); }

  function render() {
    var cg = readInputs();
    var res = calc(container(state.cont), cg);

    els.kFit.textContent  = res.fit ? fmt(res.fit) : '—';
    els.kCont.textContent = res.needed ? fmt(res.needed) : '—';
    els.kVol.textContent  = res.fit ? Math.round(res.volPct) + '%' : '—';
    els.kWgt.textContent  = res.fit ? Math.round(res.wgtPct) + '%' : '—';

    els.barVol.style.width = res.volPct + '%';
    els.barWgt.style.width = res.wgtPct + '%';
    els.barVolTxt.textContent = Math.round(res.volPct) + '%';
    els.barWgtTxt.textContent = Math.round(res.wgtPct) + '%';

    /* verdict */
    var v = els.verdict, html = '', cls = '';
    if (res.fit === 0) {
      html = T.t('vNoFit'); cls = 'is-bad';
    } else {
      if (cg.qty <= res.fit) html = T.t('vFitsAll', { q: fmt(cg.qty) });
      else html = T.t('vNeeds', { n: fmt(res.needed), c: res.spec.label, q: fmt(cg.qty) });

      html += ' ' + (res.bound === 'weight' ? T.t('vWgtBound') : T.t('vVolBound'));

      /* better container? */
      var best = null;
      C.forEach(function (s) {
        var r = calc(s, cg);
        if (!r.fit) return;
        if (!best || r.needed < best.needed ||
            (r.needed === best.needed && r.volPct > best.volPct)) best = r;
      });
      if (best && best.spec.id !== res.spec.id && best.needed < res.needed) {
        html += ' ' + T.t('vSuggest', { c: best.spec.label });
        cls = 'is-warn';
      } else if (res.volPct < 45 && res.wgtPct < 45) {
        html += ' ' + T.t('vTight');
        cls = 'is-warn';
      }

      html += ' <span class="mono" style="color:var(--ink-3)">(' + res.floors + ' ' + T.t('vFloor') +
              ' × ' + res.layers + ' ' + T.t('vLayers') + ')</span>';
    }
    v.innerHTML = html;
    v.className = 'verdict' + (cls ? ' ' + cls : '');

    drawIso(res, cg);
    window.__ZD_LAST_CALC = { res: res, cg: cg };
  }

  /* ---- chips + wiring ---------------------------------------------------- */

  function buildChips() {
    els.cargoChips.innerHTML = CARGO.map(function (c) {
      var name = T.lang === 'he' ? c.he : c.en;
      var dim = c.dim ? ' <bdi class="chip__dim">' + c.dim + '</bdi>' : '';
      return '<button type="button" class="chip' + (c.id === state.cargo ? ' is-on' : '') +
             '" data-cargo="' + c.id + '">' + name + dim + '</button>';
    }).join('');
    els.contChips.innerHTML = C.map(function (c) {
      return '<button type="button" class="chip' + (c.id === state.cont ? ' is-on' : '') +
             '" data-cont="' + c.id + '">' + c.label + '</button>';
    }).join('');
  }

  function applyPreset(id) {
    state.cargo = id;
    var p = preset();
    els.len.value = p.L; els.wid.value = p.W; els.hei.value = p.H; els.wgt.value = p.kg;
    state.stack = !!p.stack;
    els.stack.checked = state.stack;
    buildChips(); render();
  }

  function init() {
    ['cargoChips','contChips','len','wid','hei','wgt','qty','stack','iso','vizTag',
     'kFit','kCont','kVol','kWgt','barVol','barWgt','barVolTxt','barWgtTxt','verdict',
     'plQuote','plReset'].forEach(function (k) {
      var map = { len:'inLen', wid:'inWid', hei:'inHei', wgt:'inWgt', qty:'inQty',
                  stack:'inStack', iso:'isoBox' };
      els[k] = $(map[k] || k);
    });
    if (!els.cargoChips) return;

    buildChips();
    applyPreset('eur');
    els.qty.value = 40;
    render();

    els.cargoChips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cargo]'); if (b) applyPreset(b.dataset.cargo);
    });
    els.contChips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cont]');
      if (b) { state.cont = b.dataset.cont; buildChips(); render(); }
    });
    ['len','wid','hei','wgt','qty'].forEach(function (k) {
      els[k].addEventListener('input', function () {
        if (state.cargo !== 'custom') {
          var p = preset();
          if (+els.len.value !== p.L || +els.wid.value !== p.W || +els.hei.value !== p.H) {
            /* dimensions edited by hand — drop the preset badge silently */
          }
        }
        render();
      });
    });
    els.stack.addEventListener('change', function () { state.stack = els.stack.checked; render(); });
    els.plReset.addEventListener('click', function () { state.cont = '40hc'; applyPreset('eur'); els.qty.value = 40; render(); });

    els.plQuote.addEventListener('click', function () {
      var d = window.__ZD_LAST_CALC; if (!d) return;
      var msg = T.lang === 'he'
        ? d.cg.qty + ' יח׳ ' + (preset().he + ' ' + (preset().dim || '')) + ' · ' + d.cg.l + '×' + d.cg.w + '×' + d.cg.h +
          ' ס״מ · ' + d.cg.kg + ' ק״ג ליח׳ · ' + d.res.needed + ' × ' + d.res.spec.label +
          ' (ניצולת נפח ' + Math.round(d.res.volPct) + '%)'
        : d.cg.qty + ' × ' + (preset().en + ' ' + (preset().dim || '')) + ' · ' + d.cg.l + '×' + d.cg.w + '×' + d.cg.h +
          ' cm · ' + d.cg.kg + ' kg each · ' + d.res.needed + ' × ' + d.res.spec.label +
          ' (volume ' + Math.round(d.res.volPct) + '%)';
      var ta = $('fMsg'); if (ta) { ta.value = msg; }
      var sel = $('fType'); if (sel) sel.value = 'fcl';
      document.getElementById('contact').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function () { var n = $('fName'); if (n) n.focus({ preventScroll: true }); }, 700);
    });

    T.onChange(function () { buildChips(); render(); });
  }

  return { init: init };
})();

/* ZADALOG — track & trace (deterministic demo data) ---------------------- */
window.TRACKING = (function () {
  'use strict';

  var T = window.I18N, P = window.ZD.PORTS, V = window.ZD.VESSELS;
  var $ = function (id) { return document.getElementById(id); };

  var ORIGINS = ['SHA','NGB','SZX','SIN','MUN','JEA','IST','PIR','RTM','HAM','VLC','NYC'];
  var DESTS   = ['ASD','HFA'];
  var STEP_KEYS = ['trS1','trS2','trS3','trS4','trS5','trS6','trS7'];
  var last = null;

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }

  function fmtDate(d) {
    var loc = T.lang === 'he' ? 'he-IL' : 'en-GB';
    return d.toLocaleDateString(loc, { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtShort(d) {
    var loc = T.lang === 'he' ? 'he-IL' : 'en-GB';
    return d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit' });
  }

  function build(raw) {
    var id = raw.trim().toUpperCase().replace(/\s+/g, '');
    if (!id) return null;

    var showcase = id === 'ZDL-8842-IL' || id === 'ZDL8842IL';
    var h = hash(id);

    var from = showcase ? 'SHA' : ORIGINS[h % ORIGINS.length];
    var to   = showcase ? 'ASD' : DESTS[(h >> 3) % DESTS.length];
    var vessel = showcase ? 'MSC AURORA' : V[(h >> 5) % V.length];
    var stage  = showcase ? 3 : (h >> 7) % 7;           /* 0..6 */
    var totalDays = showcase ? 28 : 12 + (h >> 11) % 22;
    var contType = ['20\' GP', '40\' GP', '40\' HC', '45\' HC'][(h >> 13) % 4];
    var weight = showcase ? 18.4 : (6 + ((h >> 17) % 200) / 10);
    var contNo = 'ZDLU ' + (1000000 + (h % 8999999));

    var now = new Date();
    var start = new Date(now.getTime() - (stage / 6) * totalDays * 864e5);
    var eta   = new Date(start.getTime() + totalDays * 864e5);

    var steps = STEP_KEYS.map(function (k, i) {
      var d = new Date(start.getTime() + (i / 6) * totalDays * 864e5);
      return { key: k, date: d, state: i < stage ? 'done' : (i === stage ? 'now' : '') };
    });

    var statusKey = stage >= 6 ? 'trStatusDone'
                  : stage === 5 ? 'trStatusCustoms'
                  : stage === 4 ? 'trStatusPort'
                  : stage >= 3 ? 'trStatusMoving' : 'trStatusPort';

    return { id: id, from: from, to: to, vessel: vessel, stage: stage, steps: steps,
             eta: eta, statusKey: statusKey, contType: contType, weight: weight,
             contNo: contNo, updated: new Date(now.getTime() - (h % 9) * 36e5) };
  }

  function paint(s) {
    if (!s) return;
    last = s;
    var pn = function (c) { return T.lang === 'he' ? P[c][2] : P[c][1]; };

    $('rId').textContent = s.id;
    $('rStatus').textContent = T.t(s.statusKey);
    $('rEta').textContent = fmtDate(s.eta);
    $('rFrom').textContent = pn(s.from);
    $('rTo').textContent = pn(s.to);
    $('rVessel').textContent = s.vessel;

    $('rSteps').innerHTML = s.steps.map(function (st) {
      return '<li class="' + (st.state === 'done' ? 'is-done' : st.state === 'now' ? 'is-now' : '') + '">' +
             '<b>' + T.t(st.key) + '</b><span>' + fmtShort(st.date) + '</span></li>';
    }).join('');

    $('rMeta').innerHTML =
      '<div><span>' + T.t('trVessel')  + '</span><b>' + s.vessel + '</b></div>' +
      '<div><span>' + T.t('trCont')    + '</span><b>' + s.contNo + '</b></div>' +
      '<div><span>' + T.t('trType')    + '</span><b>' + s.contType + '</b></div>' +
      '<div><span>' + T.t('trWeight')  + '</span><b>' + s.weight.toFixed(1) + ' t</b></div>' +
      '<div><span>' + T.t('trUpdated') + '</span><b>' + fmtShort(s.updated) + '</b></div>';

    var box = $('trackResult');
    box.hidden = false;
    requestAnimationFrame(function () {
      $('rProg').style.width = Math.round((s.stage / 6) * 100) + '%';
    });
  }

  function init() {
    var form = $('trackForm'); if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('trackInput').value.trim() || 'ZDL-8842-IL';
      $('trackInput').value = v;
      var s = build(v);
      if (!s) { $('trackHint').textContent = T.t('trEmpty'); return; }
      $('rProg').style.width = '0%';
      paint(s);
    });
    T.onChange(function () { if (last) paint(build(last.id)); });
  }

  return { init: init };
})();

/* ZADALOG — dot-matrix world map with live trade lanes ------------------- */
(function () {
  'use strict';

  var svg = document.getElementById('worldMap');
  if (!svg) return;

  var NS = 'http://www.w3.org/2000/svg';

  /* Equirectangular grid: 72 cols x 5deg (lon -180..180),
     28 rows x 5deg (lat 80N..-60S). Values are inclusive column spans. */
  var LAND = [
    /*  0  80N */[[27,31]],
    /*  1  75N */[[12,24],[26,32],[52,68]],
    /*  2  70N */[[3,8],[9,25],[26,31],[38,44],[45,71]],
    /*  3  65N */[[2,8],[9,24],[26,31],[33,34],[38,44],[45,71]],
    /*  4  60N */[[2,8],[9,24],[27,30],[37,44],[45,71]],
    /*  5  55N */[[3,7],[9,24],[35,36],[37,42],[43,71]],
    /*  6  50N */[[10,24],[34,36],[37,43],[44,70]],
    /*  7  45N */[[11,22],[34,43],[44,69]],
    /*  8  40N */[[11,22],[33,42],[43,68]],
    /*  9  35N */[[11,22],[33,46],[46,68]],
    /* 10  30N */[[12,21],[33,47],[47,67]],
    /* 11  25N */[[13,19],[20,22],[33,49],[51,56],[57,66]],
    /* 12  20N */[[15,19],[20,23],[32,48],[51,56],[57,64]],
    /* 13  15N */[[17,20],[21,23],[31,46],[51,55],[57,63]],
    /* 14  10N */[[18,25],[32,46],[52,54],[58,64]],
    /* 15   5N */[[21,28],[33,46],[58,66]],
    /* 16   0  */[[20,29],[34,46],[58,67]],
    /* 17   5S */[[20,29],[35,45],[59,68]],
    /* 18  10S */[[20,29],[35,44],[60,69]],
    /* 19  15S */[[20,28],[35,44],[45,46],[59,67]],
    /* 20  20S */[[21,28],[35,43],[45,46],[59,67]],
    /* 21  25S */[[21,28],[35,43],[45,46],[59,67]],
    /* 22  30S */[[22,28],[35,42],[60,66],[69,70]],
    /* 23  35S */[[22,27],[36,40],[69,71]],
    /* 24  40S */[[22,26],[69,70]],
    /* 25  45S */[[22,25]],
    /* 26  50S */[[22,25]],
    /* 27  55S */[[23,24]]
  ];

  var STEP = 10, X0 = 5, Y0 = 10;
  function px(lon) { return (lon + 180) / 5 * STEP + X0; }
  function py(lat) { return (80 - lat) / 5 * STEP + Y0; }

  var P = window.ZD.PORTS, R = window.ZD.ROUTES;

  /* Columns that sit close to one of our lanes get the highlighted colour. */
  var hot = {};
  R.forEach(function (r) {
    [r[0], r[1]].forEach(function (code) {
      var p = P[code];
      var c = Math.round((p[4] + 180) / 5), rw = Math.round((80 - p[3]) / 5);
      for (var dc = -1; dc <= 1; dc++) for (var dr = -1; dr <= 1; dr++) hot[(rw + dr) + ':' + (c + dc)] = 1;
    });
  });

  var parts = [];

  /* defs */
  parts.push(
    '<defs>' +
      '<linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="#21D4C4" stop-opacity=".15"/>' +
        '<stop offset=".5" stop-color="#21D4C4" stop-opacity=".85"/>' +
        '<stop offset="1" stop-color="#FF6B2C" stop-opacity=".9"/>' +
      '</linearGradient>' +
      '<radialGradient id="portGlow">' +
        '<stop offset="0" stop-color="#FF6B2C" stop-opacity=".55"/>' +
        '<stop offset="1" stop-color="#FF6B2C" stop-opacity="0"/>' +
      '</radialGradient>' +
    '</defs>'
  );

  /* land dots */
  var dots = '';
  LAND.forEach(function (spans, row) {
    spans.forEach(function (sp) {
      for (var c = sp[0]; c <= sp[1]; c++) {
        var key = row + ':' + c;
        dots += '<circle class="wm-dot' + (hot[key] ? ' wm-dot--hi' : '') + '" cx="' +
                (c * STEP + X0) + '" cy="' + (row * STEP + Y0) + '" r="' + (hot[key] ? 2 : 1.55) + '"/>';
      }
    });
  });
  parts.push('<g>' + dots + '</g>');

  /* routes */
  var routeSvg = '', portSvg = '', shipSvg = '';
  R.forEach(function (r, i) {
    var a = P[r[0]], b = P[r[1]], bend = r[2];
    var x1 = px(a[4]), y1 = py(a[3]), x2 = px(b[4]), y2 = py(b[3]);
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    var dx = x2 - x1, dy = y2 - y1;
    var cx = mx + dy * bend, cy = my - dx * bend;
    var d = 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) +
            ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
    var id = 'rt' + i;
    var dur = (13 + (i % 5) * 2.6).toFixed(1);

    routeSvg += '<path id="' + id + '" class="wm-route" d="' + d + '" ' +
                'stroke-dasharray="5 7" stroke-dashoffset="0">' +
                  '<animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.6s" repeatCount="indefinite"/>' +
                '</path>';

    shipSvg += '<g class="wm-ship-g">' +
                 '<circle class="wm-ship" r="2.2">' +
                   '<animateMotion dur="' + dur + 's" repeatCount="indefinite" rotate="auto" begin="' + (i * 1.4).toFixed(1) + 's">' +
                     '<mpath href="#' + id + '"/>' +
                   '</animateMotion>' +
                 '</circle>' +
               '</g>';
  });
  parts.push('<g>' + routeSvg + '</g>');

  /* ports */
  var seen = {};
  R.forEach(function (r) { seen[r[0]] = 1; seen[r[1]] = 1; });
  Object.keys(seen).forEach(function (code) {
    var p = P[code], x = px(p[4]), y = py(p[3]);
    var dest = code === 'ASD' || code === 'HFA';
    portSvg +=
      '<g>' +
        '<circle cx="' + x + '" cy="' + y + '" r="' + (dest ? 16 : 11) + '" fill="url(#portGlow)"/>' +
        '<circle class="wm-port-ring" cx="' + x + '" cy="' + y + '" r="3.4" stroke-width=".8">' +
          '<animate attributeName="r" values="3.4;9;3.4" dur="3.2s" repeatCount="indefinite"/>' +
          '<animate attributeName="opacity" values=".65;0;.65" dur="3.2s" repeatCount="indefinite"/>' +
        '</circle>' +
        '<circle class="wm-port" cx="' + x + '" cy="' + y + '" r="' + (dest ? 3.1 : 2.2) + '"/>' +
        '<text class="wm-label" x="' + (x + 7) + '" y="' + (y + 2.8) + '">' + p[0] + '</text>' +
      '</g>';
  });
  parts.push('<g>' + portSvg + '</g>');
  parts.push('<g>' + shipSvg + '</g>');

  svg.innerHTML = parts.join('');
})();

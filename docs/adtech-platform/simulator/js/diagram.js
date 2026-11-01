/* diagram.js — [diagram] SIM.diagram: metro haritası (SPEC.md §7)
 * Bileşenler istasyon, veri akışları renkli hat. Paketler hat üzerinde etiketli haplar olarak gider.
 *
 * Genel API (sözleşme):
 *   mount(rootEl, legendEl), travel({from,to,line,label,size}) -> Promise, pulse(nodeId,{line,text}),
 *   badge(nodeId, text|null), ambient({path,line}), focus(nodeIds|null), setActiveLine(lineId|null),
 *   select(nodeId), relayout()
 * Yayınlar: bus 'node:select' {nodeId}. Ek: bus 'diagram:line' {lineId}, 'diagram:layout' {layout}.
 *
 * Yerleşimler: 'wide' (en/boy ≥ 1,25), 'square' (0,8–1,25), 'tall' (< 0,8; telefon).
 * Koordinatlar ızgara birimindedir (sütun, satır); kenarlar 0°/45°/90° parçalarla yönlendirilir.
 * Klasik script; harici kütüphane yok. DOM yoksa (Node) yalnızca API iskeleti kurulur.
 */
window.SIM = window.SIM || {};

(function (SIM) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var hasDoc = typeof document !== 'undefined';

  /* ==================================================================
   * 1. Yerleşimler
   *    n: { id: [col, row, labelPos, [dx,dy]?, maxW?] }   labelPos: e w n s ne nw se sw
   *    e: { edgeId: 'ds' | [[col,row], …] }   (varsayılan: önce düz, sonra 45°)
   *    z: { zoneId: [c0, r0, c1, r1, labelCorner?] | { poly:[[c,r]…], lp:[c,r], anchor } }
   * ================================================================== */
  var LAYOUTS = {
    wide: {
      id: 'wide',
      cell: [92, 92],
      margin: [34, 44, 26, 44],     // üst, sağ, alt, sol (birim)
      font: { label: 14, sub: 10.5, zone: 10.5, packet: 9.5, badge: 9.5 },
      n: {
        cmp:        [0, 6, 'e'],
        browser:    [0, 5, 'w'],
        gateway:    [1, 4, 'n'],
        adapi:      [2, 4, 's'],
        collector:  [2, 5, 's'],
        tracking:   [2, 6, 's'],
        kafka:      [3, 5, 'ne'],
        flink:      [6, 5, 's!', [0, 15]],
        cdn:        [2, 1, 'n'],
        auction:    [5, 1, 'n'],
        prebid:     [7, 1, 'n'],
        dsp:        [8, 3, 'e'],
        decision:   [6, 3, 'e!', null, 86],
        tindex:     [5, 0, 'w'],
        ml:         [5, 2, 'w'],
        fcap:       [2, 2, 'n'],
        identity:   [5, 4, 'nw!', null, 84],
        profile:    [6, 4, 'ne!', null, 80],
        segment:    [7, 4, 'ne!', null, 72],
        activation: [8, 4, 'e!'],
        iceberg:    [8, 6, 's'],
        clickhouse: [7, 6, 's'],
        pacer:      [5, 6, 's'],
        partner:    [10, 5, 'n'],
        dcr:        [9, 6, 'se'],
        policy:     [9, 5, 'n'],
        admin:      [10, 4, 's'],
        postgres:   [9, 1, 'e'],
        config:     [9, 0, 'e'],
        privacy:    [4, 7, 'nw']
      },
      e: {
        'adapi-decision': 'ds',
        'admin-postgres': 'ds',
        'browser-privacy': 'ds',
        'browser-tracking': 'sd',
        'cdn-browser': 'ds',
        'clickhouse-admin': 'ds',
        'decision-auction': 'sd',
        'decision-fcap': 'sds',
        'decision-kafka': 'hv',
        'decision-prebid': 'sd',
        'decision-tindex': 'sd',
        'flink-iceberg': 'sd',
        'pacer-fcap': 'sd',
        'policy-segment': 'sd',
        'prebid-dsp': 'sd',
        'privacy-activation': 'sd',
        'privacy-dcr': 'sd',
        'privacy-identity': 'sds',
        'privacy-kafka': 'sd'
      },
      z: {
        client:    [-0.42, 4.55, 0.97, 6.5],
        edge:      { poly: [[0.55, 3.5], [2.62, 3.5], [2.62, 6.55], [1.03, 6.55], [1.03, 4.5], [0.55, 4.5]] },
        backbone:  [2.66, 4.52, 6.55, 5.6],
        ad:        [1.45, -0.32, 8.86, 3.42],
        dmp:       [3.95, 3.5, 9.3, 4.45],
        analytics: [4.45, 5.64, 8.62, 6.52],
        cleanroom: [8.66, 4.52, 10.44, 6.55],
        control:   { poly: [[8.92, -0.32], [10.44, -0.32], [10.44, 4.47], [9.52, 4.47], [9.52, 1.45], [8.92, 1.45]] },
        privacy:   [3.0, 6.58, 4.42, 7.28]
      }
    },
    square: {
      id: 'square',
      cell: [64, 64],
      margin: [30, 40, 22, 40],
      hideSub: true,
      labelW: 86,
      font: { label: 13, sub: 9.5, zone: 9.5, packet: 9.2, badge: 9.2 },
      n: {
        cmp:        [0, 6, 'e'],
        browser:    [0, 5, 'w'],
        gateway:    [1, 4, 'n'],
        adapi:      [2, 4, 's'],
        collector:  [2, 5, 's'],
        tracking:   [2, 6, 's'],
        kafka:      [3, 5, 'ne'],
        flink:      [6, 5, 's!', [0, 10]],
        cdn:        [2, 1, 'n'],
        auction:    [5, 1, 'n'],
        prebid:     [7, 1, 'n'],
        dsp:        [9, 3, 'w'],
        decision:   [6, 3, 'e'],
        tindex:     [5, 0, 'w'],
        ml:         [5, 2, 'w'],
        fcap:       [2, 2, 'n'],
        identity:   [5, 4, 'nw'],
        profile:    [6, 4, 'ne!', null, 54],
        segment:    [7, 4, 'ne!', null, 84],
        activation: [9, 4, 's'],
        iceberg:    [8, 6, 's'],
        clickhouse: [7, 6, 's'],
        pacer:      [5, 6, 's'],
        partner:    [9, 8, 'e'],
        dcr:        [8, 8, 'w'],
        policy:     [9, 7, 'e'],
        admin:      [10, 2, 'w'],
        postgres:   [10, 1, 'w'],
        config:     [10, 0, 'w'],
        privacy:    [4, 7, 'nw']
      },
      e: {
        'adapi-decision': 'ds',
        'admin-postgres': 'ds',
        'browser-privacy': 'ds',
        'browser-tracking': 'sd',
        'cdn-browser': 'ds',
        'clickhouse-admin': 'sds',
        'decision-auction': 'sd',
        'decision-fcap': 'sds',
        'decision-kafka': 'hv',
        'decision-prebid': 'sd',
        'decision-tindex': 'sd',
        'flink-iceberg': 'sd',
        'pacer-fcap': 'sd',
        'policy-segment': 'sd',
        'prebid-dsp': 'sd',
        'privacy-activation': [[7.5, 7], [9, 5.5]],
        'privacy-dcr': 'sd',
        'privacy-identity': 'sds',
        'privacy-kafka': 'sd'
      },
      z: {
        client:    [-0.55, 4.5, 1.15, 6.55],
        edge:      { poly: [[0.45, 3.45], [2.62, 3.45], [2.62, 6.55], [1.2, 6.55], [1.2, 4.45], [0.45, 4.45]] },
        backbone:  [2.66, 4.55, 6.5, 5.55],
        ad:        { poly: [[1.3, -0.42], [8.85, -0.42], [8.85, 2.5], [9.5, 2.5], [9.5, 3.36], [1.3, 3.36]] },
        dmp:       [3.9, 3.44, 9.62, 4.5],
        analytics: [4.4, 5.6, 8.62, 6.52],
        cleanroom: [6.7, 6.6, 10.6, 8.33],
        control:   [8.95, -0.42, 10.6, 2.44],
        privacy:   [2.75, 6.6, 4.42, 7.45]
      }
    },
    tall: {
      id: 'tall',
      cell: [78, 50],
      margin: [22, 22, 16, 22],
      hideSub: true,
      labelW: 84,
      font: { label: 10.5, sub: 9, zone: 9, packet: 8.6, badge: 8.6 },
      n: {
        cmp:        [3, 0, 'e'],
        browser:    [3, 1, 'ne'],
        gateway:    [3, 2, 'ne'],
        adapi:      [2, 3, 'w'],
        collector:  [3, 3, 'e'],
        tracking:   [2, 2, 'w'],
        kafka:      [3, 4, 'e'],
        flink:      [3, 8, 'ne!', [0, -12], 66],
        cdn:        [0, 1, 'ne'],
        auction:    [0, 3, 'ne'],
        prebid:     [0, 4, 'ne'],
        dsp:        [0, 5, 'e'],
        decision:   [1, 5, 'se'],
        tindex:     [0, 6, 'w'],
        ml:         [1, 2, 'w'],
        fcap:       [2, 5, 'n'],
        identity:   [2, 7, 'n'],
        profile:    [2, 8, 'w'],
        segment:    [2, 9, 'sw'],
        activation: [1, 7, 'w'],
        iceberg:    [3, 9, 'sw'],
        clickhouse: [4, 9, 'sw'],
        pacer:      [4, 8, 'nw!', null, 57],
        partner:    [3, 11, 'e'],
        dcr:        [3, 10, 'se'],
        policy:     [2, 11, 's'],
        admin:      [0, 12, 'ne'],
        postgres:   [0, 11, 'e'],
        config:     [0, 10, 'e'],
        privacy:    [4, 6, 'nw']
      },
      e: {
        'activation-dsp': 'sd',
        'adapi-decision': 'sd',
        'browser-privacy': 'hv',
        'browser-tracking': 'ds',
        'clickhouse-admin': 'vh',
        'config-decision': 'sd',
        'dcr-policy': 'sd',
        'decision-auction': 'sd',
        'decision-identity': 'sd',
        'decision-kafka': 'ds',
        'decision-prebid': 'ds',
        'decision-profile': 'sd',
        'decision-tindex': 'sds',
        'flink-clickhouse': 'ds',
        'flink-identity': 'ds',
        'flink-segment': 'ds',
        'gateway-adapi': 'ds',
        'pacer-fcap': 'sd',
        'privacy-activation': 'sd',
        'privacy-dcr': 'sd',
        'privacy-identity': 'sd',
        'privacy-kafka': 'sd',
        'segment-activation': 'ds',
        'tracking-kafka': 'sd'
      },
      z: {
        client:    [2.5, -0.42, 4.42, 1.45],
        edge:      [1.52, 1.55, 4.42, 3.45],
        ad:        { poly: [[-0.28, 0.55], [2.42, 0.55], [2.42, 1.47], [1.45, 1.47], [1.45, 3.53], [2.55, 3.53], [2.55, 6.42], [-0.28, 6.42]] },
        backbone:  [2.62, 3.55, 3.55, 8.45],
        privacy:   { poly: [[3.62, 5.5], [4.42, 5.5], [4.42, 6.5], [3.62, 6.5]], lp: [4.25, 5.42], anchor: 'end' },
        dmp:       [0.5, 6.5, 2.55, 9.45],
        analytics: { poly: [[3.62, 7.55], [4.42, 7.55], [4.42, 9.45], [2.62, 9.45], [2.62, 8.55], [3.62, 8.55]] },
        cleanroom: [1.5, 9.55, 4.42, 11.45],
        control:   [-0.28, 9.55, 1.42, 12.32]
      }
    }
  };
  ['square', 'tall'].forEach(function (k) { if (!Object.keys(LAYOUTS[k].n).length) LAYOUTS[k].n = LAYOUTS.wide.n; });

  /* ==================================================================
   * 2. Sabitler
   * ================================================================== */
  var R_ST = 6.5, R_HUB = 11, R_EXT = 7.5;
  var LANE_W = 4.2, LANE_PITCH = 5.6;
  var CORNER_R = 16;
  var MIN_PX = { label: 11.5, sub: 10, zone: 9.5, packet: 9, badge: 9 };
  var AMBIENT_MAX = 25;
  var FIT_INSET = [16, 12];   // diagram.css .dg-stage.is-fit inset (yatay, dikey toplam)
  var FLOW_PAD = 10;          // diagram.css .dg-flow .dg-stage dikey dolgu toplamı

  /* ==================================================================
   * 3. Durum
   * ================================================================== */
  var st = {
    mounted: false,
    root: null, legend: null, stage: null, svg: null,
    layers: null,
    layout: null, layoutId: null, scale: 1, flow: false, renderKey: '',
    fonts: null,
    geo: null,                 // { nodes:{id:{x,y,r,…}}, edges:{id:{pts, lanes:{line:{pts,d}}, center:{pts,d}}} }
    stationEls: {}, laneEls: {}, edgeEls: {}, zoneEls: {}, zoneLabelEls: {}, badgeEls: {}, edgeLabelEls: {},
    selected: null, focus: null, activeLine: null,
    badges: {},
    items: [],                 // animasyon öğeleri (paket + ambient)
    ambientCount: 0,
    raf: 0, lastFrame: 0, watchdog: 0, layoutRaf: 0,
    ro: null, legendBtns: {}
  };

  /* ==================================================================
   * 4. Küçük yardımcılar
   * ================================================================== */
  function data() { return SIM.data; }
  function util() { return SIM.util || {}; }
  function settings() { return SIM.settings || {}; }
  function perfNow() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function clock() {
    var u = util();
    return typeof u.clock === 'function' ? u.clock() : perfNow();
  }
  function speed() { var v = Number(settings().speed); return v > 0 && isFinite(v) ? v : 1; }
  var motionMq = null;
  try { if (typeof window.matchMedia === 'function') motionMq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (e) { motionMq = null; }
  function isReduced() { return !!settings().reducedMotion || !!(motionMq && motionMq.matches); }
  function waitMs(ms) {
    var u = util();
    if (typeof u.wait === 'function') return u.wait(ms);
    return new Promise(function (r) { setTimeout(r, ms); });
  }
  function warn() { try { console.warn.apply(console, ['[SIM.diagram]'].concat([].slice.call(arguments))); } catch (e) { /* yut */ } }

  function mk(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'text') n.textContent = String(v);
        else n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (parent) parent.appendChild(n);
    return n;
  }
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = String(v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function f1(x) { return Math.round(x * 10) / 10; }
  function clampN(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
  function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  function trUpper(s) { try { return String(s).toLocaleUpperCase('tr-TR'); } catch (e) { return String(s).toUpperCase(); } }

  function lineOrder() { var D = data(); return (D && D.lineOrder) || ['dmp', 'ad', 'measure', 'cleanroom', 'privacy', 'control']; }
  function lineIdx(l) { var i = lineOrder().indexOf(l); return i < 0 ? 99 : i; }

  /* ==================================================================
   * 5. Geometri
   * ================================================================== */
  function gridPt(L, c, r) {
    return { x: L.margin[3] + c * L.cell[0], y: L.margin[0] + r * L.cell[1] };
  }

  /**
   * Sekizgen (0/45/90°) otomatik ara noktalar — piksel uzayında gerçek 45°.
   * mode: 'sd' (önce düz, sonra çapraz) | 'ds' (önce çapraz) | 'sds' (çapraz ortada) | 'hv' | 'vh' (dik L).
   */
  function autoViaPx(a, b, mode) {
    var dx = b.x - a.x, dy = b.y - a.y, adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < 0.5 || ady < 0.5 || Math.abs(adx - ady) < 0.5) return [];
    var m = Math.min(adx, ady), sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    if (mode === 'hv') return [{ x: b.x, y: a.y }];
    if (mode === 'vh') return [{ x: a.x, y: b.y }];
    if (mode === 'ds') return [{ x: a.x + sx * m, y: a.y + sy * m }];
    if (mode === 'sds') {
      if (adx > ady) { var hs = (adx - m) / 2; return [{ x: a.x + sx * hs, y: a.y }, { x: a.x + sx * (hs + m), y: b.y }]; }
      var vs = (ady - m) / 2; return [{ x: a.x, y: a.y + sy * vs }, { x: b.x, y: a.y + sy * (vs + m) }];
    }
    if (adx > ady) return [{ x: b.x - sx * m, y: a.y }];
    return [{ x: a.x, y: b.y - sy * m }];
  }

  function normalOf(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: -dy / l, y: dx / l };
  }
  /** Çoklu çizgiyi dik yönde off kadar kaydırır (gönye birleşimli). */
  function offsetPts(pts, off) {
    if (!off) return pts.slice();
    var out = [], n = pts.length;
    for (var i = 0; i < n; i++) {
      var p = pts[i];
      var nP = i > 0 ? normalOf(pts[i - 1], p) : null;
      var nN = i < n - 1 ? normalOf(p, pts[i + 1]) : null;
      if (!nP) { out.push({ x: p.x + nN.x * off, y: p.y + nN.y * off }); continue; }
      if (!nN) { out.push({ x: p.x + nP.x * off, y: p.y + nP.y * off }); continue; }
      var mx = nP.x + nN.x, my = nP.y + nN.y, ml = Math.hypot(mx, my);
      if (ml < 1e-6) { out.push({ x: p.x + nN.x * off, y: p.y + nN.y * off }); continue; }
      mx /= ml; my /= ml;
      var cos = mx * nN.x + my * nN.y;
      var k = off / Math.max(cos, 0.35);
      out.push({ x: p.x + mx * k, y: p.y + my * k });
    }
    return out;
  }
  function polyLen(pts) { var s = 0; for (var i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }
  function trimStart(pts, d) {
    var acc = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var l = dist(pts[i], pts[i + 1]);
      if (acc + l >= d) {
        var t = l > 0 ? (d - acc) / l : 0;
        return [lerp(pts[i], pts[i + 1], t)].concat(pts.slice(i + 1));
      }
      acc += l;
    }
    return [pts[pts.length - 1]];
  }
  function trimEnd(pts, d) { return trimStart(pts.slice().reverse(), d).reverse(); }

  /** Köşeleri yuvarlatılmış path 'd'. */
  function pathD(pts, R) {
    if (!pts.length) return '';
    var d = 'M' + f1(pts[0].x) + ' ' + f1(pts[0].y);
    for (var i = 1; i < pts.length - 1; i++) {
      var a = pts[i - 1], p = pts[i], b = pts[i + 1];
      var la = dist(a, p), lb = dist(p, b);
      // eş doğrusal ise köşe yok
      var cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
      if (Math.abs(cross) < 1e-3 * la * lb) { d += 'L' + f1(p.x) + ' ' + f1(p.y); continue; }
      var r = Math.min(R, la / 2, lb / 2);
      var p1 = lerp(p, a, r / la), p2 = lerp(p, b, r / lb);
      d += 'L' + f1(p1.x) + ' ' + f1(p1.y) + 'Q' + f1(p.x) + ' ' + f1(p.y) + ' ' + f1(p2.x) + ' ' + f1(p2.y);
    }
    var z = pts[pts.length - 1];
    d += 'L' + f1(z.x) + ' ' + f1(z.y);
    return d;
  }

  function nodeRadius(n) { return n.hub ? R_HUB : (n.external ? R_EXT : R_ST); }

  /** İstasyonun ana hattı: bölge hattı istasyondan geçiyorsa o, değilse ilk hat. */
  function primaryLine(n) {
    var D = data();
    var lines = D.linesOf ? D.linesOf(n.id) : [];
    var z = D.zones[n.zone];
    if (z && z.line && lines.indexOf(z.line) >= 0) return z.line;
    return lines[0] || 'control';
  }

  function buildGeometry(L) {
    var D = data();
    var g = { nodes: {}, edges: {}, w: 0, h: 0 };
    var maxC = 0, maxR = 0;
    D.nodes.forEach(function (n) {
      var spec = L.n[n.id];
      if (!spec) { warn('yerleşimde istasyon yok:', L.id, n.id); spec = [0, 0, 'e']; }
      var p = gridPt(L, spec[0], spec[1]);
      maxC = Math.max(maxC, spec[0]); maxR = Math.max(maxR, spec[1]);
      g.nodes[n.id] = {
        id: n.id, x: p.x, y: p.y, c: spec[0], r: spec[1], rad: nodeRadius(n),
        pos: String(spec[2] || 'e').replace('!', ''), fixed: /!$/.test(spec[2] || ''), off: spec[3] || null, maxW: spec[4] || null,
        hub: !!n.hub, external: !!n.external, line: primaryLine(n), node: n
      };
    });
    g.w = L.margin[3] + maxC * L.cell[0] + L.margin[1];
    g.h = L.margin[0] + maxR * L.cell[1] + L.margin[2];
    if (L.vb) { g.w = L.vb[0]; g.h = L.vb[1]; }

    D.edges.forEach(function (e) {
      var a = L.n[e.from], b = L.n[e.to];
      if (!a || !b) return;
      var spec = L.e && L.e[e.id];
      var pa = gridPt(L, a[0], a[1]), pb = gridPt(L, b[0], b[1]);
      var pts;
      if (Array.isArray(spec)) {
        // elle verilen ara noktalar (ızgara); son parça gerekirse otomatik 45° ile tamamlanır
        pts = [pa];
        spec.forEach(function (q) { pts.push(gridPt(L, q[0], q[1])); });
        pts.push(pb);
      } else {
        pts = [pa].concat(autoViaPx(pa, pb, typeof spec === 'string' ? spec : 'sd'), [pb]);
      }
      // ardışık aynı noktaları temizle
      pts = pts.filter(function (p, i) { return i === 0 || dist(p, pts[i - 1]) > 0.01; });
      checkOcti(L.id, e.id, pts);
      var lines = e.lines.slice().sort(function (x, y) { return lineIdx(x) - lineIdx(y); });
      var nA = g.nodes[e.from], nB = g.nodes[e.to];
      var maxOff = (lines.length - 1) / 2 * LANE_PITCH;
      var t0 = (maxOff > 0 && !(nA.hub && maxOff <= nA.rad - 3)) ? nA.rad + 10 : 0;
      var t1 = (maxOff > 0 && !(nB.hub && maxOff <= nB.rad - 3)) ? nB.rad + 10 : 0;
      var total = polyLen(pts);
      if (t0 + t1 > total * 0.8) { var k = total * 0.8 / (t0 + t1 || 1); t0 *= k; t1 *= k; }
      var lanes = {};
      lines.forEach(function (l, i) {
        var off = (i - (lines.length - 1) / 2) * LANE_PITCH;
        var lp = offsetPts(pts, off);
        if (off) {
          if (t0 > 0) lp = [pts[0]].concat(trimStart(lp, t0));
          if (t1 > 0) lp = trimEnd(lp, t1).concat([pts[pts.length - 1]]);
        }
        lanes[l] = { pts: lp, d: pathD(lp, CORNER_R), off: off };
      });
      g.edges[e.id] = {
        id: e.id, edge: e, lines: lines, pts: pts,
        center: { pts: pts, d: pathD(pts, CORNER_R) },
        lanes: lanes, width: lines.length * LANE_PITCH - (LANE_PITCH - LANE_W)
      };
    });
    return g;
  }

  function checkOcti(lid, eid, pts) {
    for (var i = 1; i < pts.length; i++) {
      var dx = Math.abs(pts[i].x - pts[i - 1].x), dy = Math.abs(pts[i].y - pts[i - 1].y);
      if (dx < 0.5 || dy < 0.5) continue;
      // hücre en/boy oranı farklıysa 45° ızgara biriminde ölçülür; yine de makul açıyı kabul et
      var ang = Math.atan2(dy, dx) * 180 / Math.PI;
      if (ang < 25 || ang > 65) warn('kenar açısı 45° değil:', lid, eid, f1(ang) + '°');
    }
  }

  /* ==================================================================
   * 6. Ölçek ve yazı boyları
   * ================================================================== */
  function fontsFor(L, s) {
    var F = L.font;
    var cap = 1.7;
    var lf = clampN(Math.max(F.label, MIN_PX.label / s), F.label, F.label * cap);
    var sf = Math.max(F.sub, MIN_PX.sub / s);
    var hideSub = !!L.hideSub || sf > F.sub * 1.5;
    sf = Math.min(sf, F.sub * 1.5);
    return {
      label: f1(lf), sub: f1(sf), hideSub: hideSub,
      zone: f1(clampN(Math.max(F.zone, MIN_PX.zone / s), F.zone, F.zone * cap)),
      packet: f1(clampN(Math.max(F.packet, MIN_PX.packet / s), F.packet, F.packet * cap)),
      badge: f1(clampN(Math.max(F.badge, MIN_PX.badge / s), F.badge, F.badge * cap))
    };
  }

  /* ==================================================================
   * 7. Çizim
   * ================================================================== */
  function render(L, s) {
    var D = data();
    var focusId = null;
    try {
      var ae = document.activeElement;
      if (ae && ae.getAttribute && ae.getAttribute('data-node') && st.svg && st.svg.contains(ae)) focusId = ae.getAttribute('data-node');
    } catch (e) { /* yut */ }

    var geo = buildGeometry(L);
    var F = fontsFor(L, s);
    st.geo = geo; st.layout = L; st.layoutId = L.id; st.scale = s; st.fonts = F;
    st.stationEls = {}; st.laneEls = {}; st.edgeEls = {}; st.zoneEls = {}; st.badgeEls = {}; st.edgeLabelEls = {};

    var svg = mk('svg', {
      class: 'dg-svg', viewBox: '0 0 ' + f1(geo.w) + ' ' + f1(geo.h),
      preserveAspectRatio: 'xMidYMid meet', role: 'group',
      'aria-label': 'Veri akış haritası: ' + D.nodes.length + ' istasyon, ' + lineOrder().length + ' hat. İstasyon ayrıntısı için seçin.',
      'data-layout': L.id, focusable: 'false'
    });
    mk('title', { text: 'Reklam altyapısı metro haritası' }, svg);
    mk('desc', { text: 'Tarayıcıdan başlayan veri akışları Edge, Kafka, Flink, DMP, Ad Server, Analitik, Data Clean Room, Kontrol ve Gizlilik bölgelerindeki istasyonlar arasında renkli hatlarla gösterilir.' }, svg);

    var layers = {};
    ['zones', 'edges', 'zoneLabels', 'edgeLabels', 'ghost', 'trails', 'stations', 'badges', 'fx', 'packets'].forEach(function (k) {
      layers[k] = mk('g', { class: 'dg-layer dg-l-' + k, 'aria-hidden': k === 'stations' ? null : 'true' }, svg);
    });
    st.layers = layers;

    drawZones(L, geo, F, layers.zones, layers.zoneLabels);
    drawEdges(geo, F, layers.edges, layers.edgeLabels);
    drawStations(geo, F, layers.stations);

    var old = st.svg;
    if (old && old.parentNode) old.parentNode.replaceChild(svg, old);
    else st.stage.appendChild(svg);
    st.svg = svg;

    placeLabels();
    Object.keys(st.badges).forEach(function (id) { drawBadge(id); });
    applySelected(); applyFocus(); applyActiveLine(); applyPaused();
    rebindItems();

    if (focusId && st.stationEls[focusId]) { try { st.stationEls[focusId].focus({ preventScroll: true }); } catch (e) { /* yut */ } }
    try { SIM.bus && SIM.bus.emit('diagram:layout', { layout: L.id, scale: s }); } catch (e) { /* yut */ }
  }

  function drawZones(L, geo, F, layer, labelLayer) {
    var D = data();
    st.zoneLabelEls = {};
    Object.keys(D.zones).forEach(function (zid) {
      var z = D.zones[zid];
      if (!D.nodes.some(function (n) { return n.zone === zid; })) return;
      var g = mk('g', { class: 'dg-zone', 'data-zone': zid, 'data-line': z.line || null }, layer);
      mk('path', { class: 'dg-zone-area' }, g);
      // bölge adı hatların üstünde (zemin halesiyle) çizilir ki hat geçse de okunsun
      st.zoneLabelEls[zid] = mk('text', { class: 'dg-zone-label', 'data-zone': zid, 'data-line': z.line || null,
        'font-size': F.zone, text: trUpper(z.label) }, labelLayer || g);
      st.zoneEls[zid] = g;
    });
  }

  /** Köşeleri pahlı (45°) çokgen yolu. */
  function chamferPoly(poly, c) {
    var n = poly.length, d = '';
    for (var i = 0; i < n; i++) {
      var p = poly[i], a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
      var la = dist(a, p), lb = dist(p, b);
      var k = Math.min(c, la / 2, lb / 2);
      var p1 = lerp(p, a, k / la), p2 = lerp(p, b, k / lb);
      d += (i === 0 ? 'M' : 'L') + f1(p1.x) + ' ' + f1(p1.y) + 'L' + f1(p2.x) + ' ' + f1(p2.y);
    }
    return d + 'Z';
  }

  function drawEdges(geo, F, layer, labelLayer) {
    var D = data();
    // Önce tüm kılıflar (casing), sonra şeritler: kesişmelerde temiz ayrım
    var casingG = mk('g', { class: 'dg-casings' }, layer);
    var laneG = mk('g', { class: 'dg-lanes' }, layer);
    D.edges.forEach(function (e) {
      var ge = geo.edges[e.id];
      if (!ge) return;
      mk('path', { class: 'dg-casing', d: ge.center.d, 'stroke-width': f1(ge.width + 4.5), 'data-edge': e.id }, casingG);
      var g = mk('g', { class: 'dg-edge', 'data-edge': e.id }, laneG);
      st.edgeEls[e.id] = g;
      st.laneEls[e.id] = {};
      ge.lines.forEach(function (l) {
        var p = mk('path', { class: 'dg-lane', d: ge.lanes[l].d, 'data-line': l, 'stroke-width': LANE_W }, g);
        st.laneEls[e.id][l] = p;
      });
      // kenar etiketi (hat vurgulanınca görünür)
      var mid = longestSegMid(ge.pts);
      var lt = mk('text', { class: 'dg-edge-label', x: f1(mid.x), y: f1(mid.y + (mid.horizontal ? -ge.width / 2 - 4 : 3)),
        'text-anchor': 'middle', 'font-size': F.packet, 'data-edge': e.id, text: e.label }, labelLayer);
      st.edgeLabelEls[e.id] = lt;
    });
  }

  function longestSegMid(pts) {
    var best = 0, bi = 0;
    for (var i = 1; i < pts.length; i++) { var l = dist(pts[i - 1], pts[i]); if (l > best) { best = l; bi = i; } }
    var a = pts[bi - 1] || pts[0], b = pts[bi] || pts[0];
    var m = lerp(a, b, 0.5);
    m.horizontal = Math.abs(a.y - b.y) < 0.5;
    return m;
  }

  function drawStations(geo, F, layer) {
    var D = data();
    D.nodes.forEach(function (n) {
      var gn = geo.nodes[n.id];
      var r = gn.rad;
      var cls = 'dg-st' + (n.hub ? ' is-hub' : '') + (n.external ? ' is-ext' : '');
      var g = mk('g', {
        class: cls, 'data-node': n.id, 'data-line': gn.line, role: 'button', tabindex: '0',
        'aria-label': n.label + ' — ' + n.sub, 'aria-pressed': 'false',
        transform: 'translate(' + f1(gn.x) + ' ' + f1(gn.y) + ')'
      }, layer);
      mk('title', { text: n.label + ' — ' + n.sub }, g);
      mk('circle', { class: 'dg-st-hit', r: Math.max(20, r + 12) }, g);
      mk('circle', { class: 'dg-st-sel', r: f1(r + 6.5) }, g);
      mk('circle', { class: 'dg-st-focus', r: f1(r + 4.5) }, g);
      mk('circle', { class: 'dg-st-ring', r: r }, g);
      if (n.hub) mk('circle', { class: 'dg-st-core', r: 3 }, g);

      mk('rect', { class: 'dg-st-labhit', width: 0, height: 0 }, g);   // etikete dokunmak da istasyonu seçer
      var tg = mk('g', { class: 'dg-st-text' }, g);
      mk('text', { class: 'dg-st-label', 'font-size': F.label, text: n.label }, tg);
      if (!F.hideSub) mk('text', { class: 'dg-st-sub', 'font-size': F.sub, text: n.sub }, tg);
      g.addEventListener('click', onStationClick);
      g.addEventListener('keydown', onStationKey);
      st.stationEls[n.id] = g;
    });
  }

  /** Bir etiket yuvası için göreli konum (istasyon merkezine göre). */
  function labelPlacement(gn, F, pos) {
    var r = gn.rad + (gn.hub ? 2 : 1.5);
    var gap = 4.5;
    var lf = F.label, sf = F.hideSub ? 0 : F.sub;
    var out = { anchor: 'start', x: 0, yL: 0, yS: 0, pos: pos };
    var capL = lf * 0.7, capS = sf * 0.7, lead = sf ? Math.max(3.5, sf * 0.38) : 0;
    var twoH = sf ? capL + lead + capS : capL;
    function vCenter() { out.yL = -twoH / 2 + capL; out.yS = out.yL + lead + capS; }
    function above(y0) { if (sf) { out.yS = y0; out.yL = y0 - capS - lead; } else { out.yL = y0; } }
    function below(yTop) { out.yL = yTop + capL; out.yS = out.yL + lead + capS; }
    var d = r * 0.62 + 2;
    switch (pos) {
      case 'w': out.anchor = 'end'; out.x = -(r + gap); vCenter(); break;
      case 'n': out.anchor = 'middle'; above(-(r + gap + (sf ? sf * 0.22 : lf * 0.2))); break;
      case 's': out.anchor = 'middle'; below(r + gap); break;
      case 'ne': out.anchor = 'start'; out.x = d; above(-(r + 2)); break;
      case 'nw': out.anchor = 'end'; out.x = -d; above(-(r + 2)); break;
      case 'se': out.anchor = 'start'; out.x = d; below(r + 1); break;
      case 'sw': out.anchor = 'end'; out.x = -d; below(r + 1); break;
      default: out.anchor = 'start'; out.x = r + gap; vCenter();
    }
    if (gn.off && pos === gn.pos) { out.x += gn.off[0]; out.yL += gn.off[1]; out.yS += gn.off[1]; }
    out.top = out.yL - capL;
    out.bottom = sf ? out.yS + sf * 0.24 : out.yL + lf * 0.24;
    return out;
  }

  function textWidth(t, fs, k) {
    var w = 0;
    try { w = t.getComputedTextLength(); } catch (e) { w = 0; }
    if (!(w > 0)) w = (t.textContent || '').length * fs * k;
    return w;
  }

  function rectHitsSeg(R, a, b) {
    var t0 = 0, t1 = 1, dx = b.x - a.x, dy = b.y - a.y;
    var P = [-dx, dx, -dy, dy], Q = [a.x - R.x0, R.x1 - a.x, a.y - R.y0, R.y1 - a.y];
    for (var i = 0; i < 4; i++) {
      if (P[i] === 0) { if (Q[i] < 0) return false; }
      else {
        var t = Q[i] / P[i];
        if (P[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
    }
    return true;
  }
  function rectsOverlap(a, b, m) { m = m || 0; return a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m; }
  function rectCircle(R, c, r) {
    var cx = clampN(c.x, R.x0, R.x1), cy = clampN(c.y, R.y0, R.y1);
    return Math.hypot(cx - c.x, cy - c.y) < r;
  }

  var SLOT_ORDER = ['e', 'w', 'n', 's', 'ne', 'se', 'nw', 'sw'];

  /**
   * Etiketleri yerleştir: gerçek metin genişliğini ölç, gerekirse sıkıştır, 8 yuvadan
   * hat/istasyon/etiket çakışması en az olanı seç (yerleşimdeki ipucu öncelikli).
   */
  function placeLabels() {
    if (!st.svg || !st.geo || !st.layout) return;
    var D = data(), geo = st.geo, F = st.fonts, L = st.layout;
    var segs = [];
    Object.keys(geo.edges).forEach(function (eid) {
      var ge = geo.edges[eid];
      for (var i = 1; i < ge.pts.length; i++) segs.push({ a: ge.pts[i - 1], b: ge.pts[i], hw: ge.width / 2 + 2.5, e: eid });
    });
    var placed = [];
    var degree = {};
    D.edges.forEach(function (e) { degree[e.from] = (degree[e.from] || 0) + 1; degree[e.to] = (degree[e.to] || 0) + 1; });
    var order = D.nodes.slice().sort(function (a, b) { return (degree[b.id] || 0) - (degree[a.id] || 0); });
    var maxDefault = (L.labelW || L.cell[0] * 1.1);
    order.forEach(function (n) {
      var gn = geo.nodes[n.id], g = st.stationEls[n.id];
      if (!g) return;
      var tL = g.querySelector('.dg-st-label'), tS = g.querySelector('.dg-st-sub');
      var maxW = gn.maxW || maxDefault;
      var wL = 0, wS = 0;
      [tL, tS].forEach(function (t, i) {
        if (!t) return;
        t.removeAttribute('textLength'); t.removeAttribute('lengthAdjust');
        var w = textWidth(t, i ? F.sub : F.label, i ? 0.55 : 0.47);
        var lim = i ? maxW * 1.05 : maxW;
        if (w > lim) {
          var target = Math.max(lim, w * 0.6);
          t.setAttribute('textLength', f1(target));
          t.setAttribute('lengthAdjust', 'spacingAndGlyphs');
          w = target;
        }
        if (i) wS = w; else wL = w;
      });
      var w = Math.max(wL, wS);
      var hint = gn.pos || 'e';
      var slots = [hint].concat(SLOT_ORDER.filter(function (x) { return x !== hint; }));
      if (gn.fixed) slots = [hint];
      var best = null;
      slots.forEach(function (slot, rank) {
        var lab = labelPlacement(gn, F, slot);
        var ax = gn.x + lab.x;
        var x0 = lab.anchor === 'start' ? ax : (lab.anchor === 'end' ? ax - w : ax - w / 2);
        var R = { x0: x0, x1: x0 + w, y0: gn.y + lab.top, y1: gn.y + lab.bottom };
        var cost = rank === 0 ? 0 : 2 + rank * 0.4;
        // kırpılan etiket okunamaz; hat üstündeki etiket (zemin halesiyle) okunur → kırpılma çok pahalı
        var outX = Math.max(0, 2 - R.x0, R.x1 - (geo.w - 2)), outY = Math.max(0, 2 - R.y0, R.y1 - (geo.h - 2));
        if (outX > 0 || outY > 0) cost += 200 + (outX + outY) * 4;
        for (var i = 0; i < segs.length; i++) {
          var sg = segs[i];
          var RR = { x0: R.x0 - sg.hw, y0: R.y0 - sg.hw, x1: R.x1 + sg.hw, y1: R.y1 + sg.hw };
          if (rectHitsSeg(RR, sg.a, sg.b)) cost += 14;
        }
        D.nodes.forEach(function (m) {
          var o = geo.nodes[m.id];
          if (rectCircle(R, o, o.rad + 3)) cost += m.id === n.id ? 40 : 30;
        });
        placed.forEach(function (P) { if (rectsOverlap(R, P, 3)) cost += 36; });
        if (!best || cost < best.cost - 0.01) best = { cost: cost, lab: lab, R: R };
      });
      var lab = best.lab;
      [tL, tS].forEach(function (t, i) {
        if (!t) return;
        t.setAttribute('x', f1(lab.x));
        t.setAttribute('y', f1(i ? lab.yS : lab.yL));
        t.setAttribute('text-anchor', lab.anchor);
      });
      gn.lab = lab; gn.labRect = best.R; gn.labCost = best.cost;
      var hit = g.querySelector('.dg-st-labhit');
      if (hit) {
        hit.setAttribute('x', f1(best.R.x0 - gn.x - 3)); hit.setAttribute('y', f1(best.R.y0 - gn.y - 3));
        hit.setAttribute('width', f1(best.R.x1 - best.R.x0 + 6)); hit.setAttribute('height', f1(best.R.y1 - best.R.y0 + 6));
      }
      placed.push(best.R);
    });
    layoutZones();
  }

  /**
   * Bölge alanları (semtler). Elle verilmemişse: üye istasyon + etiket kutularının ve yakın üyeler
   * arası ince köprülerin birleşimi ızgaraya taranır, başka bölgelerin istasyonları çıkarılır ve
   * kenar çizgisi izlenerek dik açılı (pahlı köşeli) bir çokgen elde edilir.
   */
  function layoutZones() {
    var D = data(), geo = st.geo, L = st.layout, F = st.fonts;
    var zids = Object.keys(st.zoneEls);
    var RES = 4;
    var GW = Math.ceil(geo.w / RES) + 1, GH = Math.ceil(geo.h / RES) + 1;
    var pad = L.zonePad || 8;
    var cellMax = Math.max(L.cell[0], L.cell[1]) * 1.25;
    function fill(grid, R, v) {
      var x0 = clampN(Math.floor(R.x0 / RES), 0, GW - 1), x1 = clampN(Math.ceil(R.x1 / RES), 0, GW - 1);
      var y0 = clampN(Math.floor(R.y0 / RES), 0, GH - 1), y1 = clampN(Math.ceil(R.y1 / RES), 0, GH - 1);
      for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) grid[y * GW + x] = v;
    }
    var members = {}, cores = {};
    zids.forEach(function (zid) {
      members[zid] = D.nodes.filter(function (n) { return n.zone === zid; }).map(function (n) { return geo.nodes[n.id]; });
      cores[zid] = members[zid].map(function (m) { var rr = m.rad + 10; return { x0: m.x - rr, y0: m.y - rr, x1: m.x + rr, y1: m.y + rr }; });
    });
    var labRects = D.nodes.map(function (n) { return geo.nodes[n.id].labRect; }).filter(Boolean);
    var zoneLabRects = [];
    zids.forEach(function (zid) {
      var g = st.zoneEls[zid];
      var area = g.querySelector('.dg-zone-area'), text = st.zoneLabelEls && st.zoneLabelEls[zid];
      var spec = L.z && L.z[zid];
      var d = '', rect;
      if (spec && (spec.poly || Array.isArray(spec))) {
        var poly;
        if (spec.poly) poly = spec.poly.map(function (q) { return gridPt(L, q[0], q[1]); });
        else {
          var a = gridPt(L, spec[0], spec[1]), b = gridPt(L, spec[2], spec[3]);
          poly = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
        }
        rect = bboxOf(poly);
        d = chamferPoly(poly, 9);
      } else {
        var grid = new Uint8Array(GW * GH);
        var ms = members[zid];
        ms.forEach(function (m, i) {
          var c = cores[zid][i];
          fill(grid, { x0: c.x0 - pad + 4, y0: c.y0 - pad + 4, x1: c.x1 + pad - 4, y1: c.y1 + pad - 4 }, 1);
          if (m.labRect) fill(grid, { x0: m.labRect.x0 - pad, y0: m.labRect.y0 - pad + 2, x1: m.labRect.x1 + pad, y1: m.labRect.y1 + pad - 2 }, 1);
        });
        // yakın üyeler arasında köprü (ince çekirdek kutusu)
        for (var i = 0; i < ms.length; i++) for (var j = i + 1; j < ms.length; j++) {
          var A = ms[i], B = ms[j];
          if (Math.abs(A.x - B.x) <= cellMax * 1.05 + 1 && Math.abs(A.y - B.y) <= cellMax * 1.05 + 1) {
            var w = 12;
            fill(grid, { x0: Math.min(A.x, B.x) - w, y0: Math.min(A.y, B.y) - w, x1: Math.max(A.x, B.x) + w, y1: Math.max(A.y, B.y) + w }, 1);
          }
        }
        // diğer bölgelerin istasyon ve etiketlerini çıkar
        zids.forEach(function (oid) {
          if (oid === zid) return;
          members[oid].forEach(function (m, k) {
            var c = cores[oid][k];
            fill(grid, { x0: c.x0 - 4, y0: c.y0 - 4, x1: c.x1 + 4, y1: c.y1 + 4 }, 0);
            if (m.labRect) fill(grid, { x0: m.labRect.x0 - 3, y0: m.labRect.y0 - 3, x1: m.labRect.x1 + 3, y1: m.labRect.y1 + 3 }, 0);
          });
        });
        var loops = traceLoops(grid, GW, GH);
        rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        var bestArea = -1;
        loops.forEach(function (lp) {
          var pts = lp.map(function (q) { return { x: q[0] * RES, y: q[1] * RES }; });
          var bb = bboxOf(pts), ar = (bb.x1 - bb.x0) * (bb.y1 - bb.y0);
          if (ar < 300) return;
          d += chamferPoly(pts, 7);
          if (ar > bestArea) { bestArea = ar; rect = bb; }
        });
        if (!isFinite(rect.x0)) rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
      }
      area.setAttribute('d', d);
      g._rect = rect;
      if (!text) return;
      var zw = textWidth(text, F.zone, 0.62);
      var zf = F.zone;
      var cands;
      if (spec && spec.lp) {
        var lp = gridPt(L, spec.lp[0], spec.lp[1]);
        cands = [{ x: lp.x, y: lp.y, anchor: spec.anchor || 'start' }];
      } else {
        var corner = (Array.isArray(spec) && spec[4]) || (spec && spec.corner) || 'tl';
        var all = {
          tl: { x: rect.x0 + 8, y: rect.y0 + zf + 3, anchor: 'start' },
          tr: { x: rect.x1 - 8, y: rect.y0 + zf + 3, anchor: 'end' },
          bl: { x: rect.x0 + 8, y: rect.y1 - 5, anchor: 'start' },
          br: { x: rect.x1 - 8, y: rect.y1 - 5, anchor: 'end' },
          ta: { x: rect.x0 + 8, y: rect.y0 - 4, anchor: 'start' },
          ba: { x: rect.x0 + 8, y: rect.y1 + zf + 2, anchor: 'start' }
        };
        cands = [all[corner]].concat(['tl', 'tr', 'bl', 'br', 'ta', 'ba'].filter(function (k) { return k !== corner; }).map(function (k) { return all[k]; }));
      }
      var best = null;
      cands.forEach(function (c, rank) {
        var x0 = c.anchor === 'start' ? c.x : c.x - zw;
        var R = { x0: x0, x1: x0 + zw, y0: c.y - zf * 0.75, y1: c.y + 2 };
        var cost = rank * 0.6 + (rank >= 4 ? 6 : 0);
        if (R.x0 < 1 || R.y0 < 1 || R.x1 > geo.w - 1 || R.y1 > geo.h - 1) cost += 200;
        labRects.concat(zoneLabRects).forEach(function (P) { if (rectsOverlap(R, P, 2)) cost += 30; });
        D.nodes.forEach(function (m) { var o = geo.nodes[m.id]; if (rectCircle(R, o, o.rad + 3)) cost += 30; });
        Object.keys(geo.edges).forEach(function (eid) {
          var ge = geo.edges[eid];
          for (var i = 1; i < ge.pts.length; i++) {
            var hw = ge.width / 2 + 1;
            if (rectHitsSeg({ x0: R.x0 - hw, y0: R.y0 - hw, x1: R.x1 + hw, y1: R.y1 + hw }, ge.pts[i - 1], ge.pts[i])) { cost += 8; break; }
          }
        });
        if (!best || cost < best.cost) best = { cost: cost, c: c, R: R };
      });
      text.setAttribute('x', f1(best.c.x)); text.setAttribute('y', f1(best.c.y));
      text.setAttribute('text-anchor', best.c.anchor);
      zoneLabRects.push(best.R);
    });
  }

  function bboxOf(pts) {
    var r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    pts.forEach(function (p) { r.x0 = Math.min(r.x0, p.x); r.x1 = Math.max(r.x1, p.x); r.y0 = Math.min(r.y0, p.y); r.y1 = Math.max(r.y1, p.y); });
    return r;
  }

  /** İkili ızgaranın dış hatlarını kapalı döngüler olarak çıkarır (köşe noktaları, eş doğrusallar elenmiş). */
  function traceLoops(grid, W, H) {
    function at(x, y) { return x >= 0 && y >= 0 && x < W && y < H && grid[y * W + x] === 1; }
    // yönlü kenarlar: dolu hücrenin sınırı, içi sağda kalacak şekilde
    var next = {};
    function key(x, y) { return x + ',' + y; }
    function add(ax, ay, bx, by) { (next[key(ax, ay)] = next[key(ax, ay)] || []).push([bx, by]); }
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
    var loops = [];
    Object.keys(next).forEach(function (k) {
      while (next[k] && next[k].length) {
        var start = k.split(',').map(Number), cur = start, loop = [start], guard = 0;
        var nb = next[k].pop();
        var prevDir = null;
        cur = nb;
        while (guard++ < 200000) {
          loop.push(cur);
          var ck = key(cur[0], cur[1]);
          if (ck === k) break;
          var list = next[ck];
          if (!list || !list.length) break;
          // köşegen temaslarda dönüşü tercih et
          var pick = 0;
          if (list.length > 1) {
            var last = loop[loop.length - 2];
            var dx = cur[0] - last[0], dy = cur[1] - last[1];
            for (var q = 0; q < list.length; q++) {
              var ndx = list[q][0] - cur[0], ndy = list[q][1] - cur[1];
              if (dx * ndy - dy * ndx > 0) { pick = q; break; }
            }
          }
          cur = list.splice(pick, 1)[0];
        }
        // eş doğrusalları ele
        var out = [];
        for (var i = 0; i < loop.length - 1; i++) {
          var a = loop[(i - 1 + loop.length - 1) % (loop.length - 1)], b = loop[i], c = loop[i + 1];
          if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
        }
        if (out.length >= 4) loops.push(out);
      }
    });
    return loops;
  }


  /* ==================================================================
   * 8. Rozet, nabız, odak, hat vurgusu, seçim
   * ================================================================== */
  function drawBadge(nodeId) {
    if (!st.svg || !st.geo) return;
    var old = st.badgeEls[nodeId];
    var text = st.badges[nodeId];
    var gn = st.geo.nodes[nodeId];
    if (text == null || text === '' || !gn) {
      if (old && old.parentNode) old.parentNode.removeChild(old);
      delete st.badgeEls[nodeId];
      return;
    }
    var fs = st.fonts.badge;
    var tw = String(text).length * fs * 0.6;
    var w = tw + fs * 1.1, hgt = fs * 1.7;
    var pl = badgeSlot(gn, w, hgt);
    var x = pl.x, y = pl.y;
    var g = old;
    if (!g) {
      g = mk('g', { class: 'dg-badge', 'data-node': nodeId, 'data-line': gn.line }, st.layers.badges);
      mk('rect', { class: 'dg-badge-bg' }, g);
      mk('text', { class: 'dg-badge-tx', 'text-anchor': 'middle' }, g);
      st.badgeEls[nodeId] = g;
    } else {
      g.classList.remove('is-bump'); void g.getBBox; // yeniden tetikle
    }
    g.setAttribute('transform', 'translate(' + f1(gn.x + x) + ' ' + f1(gn.y + y) + ')');
    var rect = g.firstChild, tx = g.lastChild;
    rect.setAttribute('width', f1(w)); rect.setAttribute('height', f1(hgt));
    rect.setAttribute('rx', f1(Math.min(3, hgt / 2)));
    tx.setAttribute('x', f1(w / 2)); tx.setAttribute('y', f1(hgt / 2 + fs * 0.35));
    tx.setAttribute('font-size', fs);
    if (tx.textContent !== String(text)) {
      tx.textContent = String(text);
      if (old && !isReduced()) {
        g.classList.remove('is-bump');
        // reflow ile animasyonu yeniden başlat
        try { void g.getBoundingClientRect(); } catch (e) { /* yut */ }
        g.classList.add('is-bump');
      }
    }
  }
  /** Rozet için dört köşeden hat/etiket/istasyon çakışması en az olanı (etiketin karşı tarafı öncelikli). */
  function badgeSlot(gn, w, hgt) {
    var r = gn.rad, geo = st.geo;
    var pos = gn.lab ? gn.lab.pos : gn.pos;
    var pref = { e: 'nw', ne: 'sw', se: 'nw', w: 'ne', nw: 'se', sw: 'ne', n: 'se', s: 'ne' }[pos] || 'ne';
    var order = [pref].concat(['ne', 'nw', 'se', 'sw'].filter(function (k) { return k !== pref; }));
    var best = null;
    order.forEach(function (k, rank) {
      var x = k.charAt(1) === 'e' ? r * 0.55 : -r * 0.55 - w;
      var y = k.charAt(0) === 'n' ? -r * 0.65 - hgt : r * 0.65;
      var R = { x0: gn.x + x, y0: gn.y + y, x1: gn.x + x + w, y1: gn.y + y + hgt };
      var cost = rank * 0.5;
      Object.keys(geo.edges).forEach(function (eid) {
        var ge = geo.edges[eid];
        for (var i = 1; i < ge.pts.length; i++) {
          var hw = ge.width / 2 + 1;
          if (rectHitsSeg({ x0: R.x0 - hw, y0: R.y0 - hw, x1: R.x1 + hw, y1: R.y1 + hw }, ge.pts[i - 1], ge.pts[i])) { cost += 6; break; }
        }
      });
      Object.keys(geo.nodes).forEach(function (id) {
        var o = geo.nodes[id];
        if (o.labRect && rectsOverlap(R, o.labRect, 1)) cost += 10;
        if (id !== gn.id && rectCircle(R, o, o.rad + 2)) cost += 10;
      });
      if (R.x0 < 0 || R.y0 < 0 || R.x1 > geo.w || R.y1 > geo.h) cost += 20;
      if (!best || cost < best.cost) best = { cost: cost, x: x, y: y };
    });
    return best;
  }

  function pulse(nodeId, opts) {
    if (!st.mounted || !st.svg || !st.geo) return;
    opts = opts || {};
    var gn = st.geo.nodes[nodeId];
    if (!gn) return;
    var line = opts.line || gn.line;
    var reduced = isReduced();
    var g = mk('g', { class: 'dg-fx' + (reduced ? ' is-static' : ''), 'data-line': line,
      transform: 'translate(' + f1(gn.x) + ' ' + f1(gn.y) + ')' }, st.layers.fx);
    var sp = speed();
    var ring = mk('circle', { class: 'dg-fx-ring', r: f1(gn.rad + 1) }, g);
    var last = ring;
    if (!reduced) ring.style.animationDuration = Math.round(720 / sp) + 'ms';
    if (opts.text != null && opts.text !== '') {
      var fs = st.fonts.packet;
      var txt = String(opts.text);
      if (txt.length > 22) txt = txt.slice(0, 21) + '…';
      var w = txt.length * fs * 0.6 + fs * 1.2, hh = fs * 1.75;
      var chip = mk('g', { class: 'dg-fx-chip' }, g);
      var inner = mk('g', { transform: 'translate(' + f1(-w / 2) + ' ' + f1(-gn.rad - hh - 6) + ')' }, chip);
      mk('rect', { width: f1(w), height: f1(hh), rx: f1(hh / 2) }, inner);
      mk('text', { x: f1(w / 2), y: f1(hh / 2 + fs * 0.36), 'text-anchor': 'middle', 'font-size': fs, text: txt }, inner);
      if (!reduced) chip.style.animationDuration = Math.round(1500 / sp) + 'ms';
      last = chip;
    }
    var removed = false;
    function done() { if (removed) return; removed = true; if (g.parentNode) g.parentNode.removeChild(g); }
    if (reduced) {
      waitMs(last === ring ? 380 : 1300).then(done);
    } else {
      last.addEventListener('animationend', done);
      // emniyet: animasyon hiç başlamazsa (ör. görünmez sekme) yine temizle
      waitMs(last === ring ? 1600 : 2600).then(done);
    }
  }

  function applySelected() {
    Object.keys(st.stationEls).forEach(function (id) {
      var on = id === st.selected;
      var el = st.stationEls[id];
      el.classList.toggle('is-selected', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function applyFocus() {
    if (!st.svg) return;
    var set = st.focus;
    st.svg.classList.toggle('has-focus', !!set);
    var D = data();
    Object.keys(st.stationEls).forEach(function (id) { st.stationEls[id].classList.toggle('is-focus', !!(set && set[id])); });
    Object.keys(st.edgeEls).forEach(function (eid) {
      var e = D.edgeById[eid];
      st.edgeEls[eid].classList.toggle('is-focus', !!(set && e && set[e.from] && set[e.to]));
    });
    Object.keys(st.badgeEls).forEach(function (id) { st.badgeEls[id].classList.toggle('is-focus', !!(set && set[id])); });
    Object.keys(st.zoneEls).forEach(function (zid) {
      var any = false;
      if (set) D.nodes.forEach(function (n) { if (n.zone === zid && set[n.id]) any = true; });
      st.zoneEls[zid].classList.toggle('is-focus', any);
      if (st.zoneLabelEls && st.zoneLabelEls[zid]) st.zoneLabelEls[zid].classList.toggle('is-focus', any);
    });
  }

  function applyActiveLine() {
    var l = st.activeLine;
    var D = data();
    if (st.svg) {
      st.svg.classList.toggle('has-line', !!l);
      if (l) st.svg.setAttribute('data-active-line', l); else st.svg.removeAttribute('data-active-line');
      Object.keys(st.laneEls).forEach(function (eid) {
        var lanes = st.laneEls[eid];
        Object.keys(lanes).forEach(function (ln) { lanes[ln].classList.toggle('is-on', ln === l); });
        var lab = st.edgeLabelEls[eid];
        if (lab) lab.classList.toggle('is-on', !!(l && lanes[l]));
      });
      Object.keys(st.stationEls).forEach(function (id) {
        st.stationEls[id].classList.toggle('is-on', !!(l && D.linesOf(id).indexOf(l) >= 0));
      });
    }
    Object.keys(st.legendBtns).forEach(function (ln) {
      st.legendBtns[ln].setAttribute('aria-pressed', ln === l ? 'true' : 'false');
    });
    if (st.legend) st.legend.classList.toggle('has-line', !!l);
  }

  function applyPaused() {
    if (st.svg) st.svg.classList.toggle('is-paused', !!settings().paused);
  }

  /* ==================================================================
   * 9. Animasyon döngüsü (tek rAF, tüm paketler)
   * ================================================================== */
  function easeInOut(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

  function kick() {
    if (!st.raf && typeof requestAnimationFrame === 'function') st.raf = requestAnimationFrame(frame);
    if (!st.watchdog) {
      st.watchdog = setInterval(function () {
        if (!st.items.length) { clearInterval(st.watchdog); st.watchdog = 0; return; }
        // rAF durmuşsa (gizli sekme) zamanlayıcıyla ilerlet
        if (perfNow() - st.lastFrame > 300) tick();
      }, 250);
    }
  }
  function frame() {
    st.raf = 0;
    st.lastFrame = perfNow();
    tick();
    if (st.items.length) st.raf = requestAnimationFrame(frame);
  }
  function tick() {
    var now = clock();
    var items = st.items;
    var keep = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var finished = false;
      try { finished = it.update(now); } catch (e) { finished = true; try { console.error('[SIM.diagram]', e); } catch (x) { /* yut */ } }
      if (finished) { try { it.finish(); } catch (e) { /* yut */ } } else keep.push(it);
    }
    // update sırasında eklenenler (ambient bir sonraki hop) korunur
    for (var j = items.length; j < st.items.length; j++) keep.push(st.items[j]);
    st.items = keep;
  }
  function addItem(it) { st.items.push(it); kick(); }

  function laneFor(edgeId, line, reversed) {
    var ge = st.geo && st.geo.edges[edgeId];
    if (!ge) return null;
    var lane = (line && ge.lanes[line]) || ge.center;
    var key = reversed ? 'rev' : 'fwd';
    if (!lane[key]) {
      var pts = reversed ? lane.pts.slice().reverse() : lane.pts;
      lane[key] = { pts: pts, d: reversed ? pathD(pts, CORNER_R) : lane.d };
    }
    return { d: lane[key].d, pts: lane[key].pts, laneEl: st.laneEls[edgeId] && st.laneEls[edgeId][line] };
  }

  function ghostRoute(from, to) {
    var a = st.geo.nodes[from], b = st.geo.nodes[to];
    var pts = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
    return { d: pathD(pts, 0), pts: pts, laneEl: null, ghost: true };
  }

  function routeFor(from, to, line) {
    var D = data();
    var eb = D.edgeBetween ? D.edgeBetween(from, to) : null;
    if (eb && st.geo.edges[eb.edge.id]) {
      var useLine = line && eb.edge.lines.indexOf(line) >= 0 ? line : null;
      var r = laneFor(eb.edge.id, useLine || line, eb.reversed);
      if (!useLine) r = laneFor(eb.edge.id, null, eb.reversed);
      r.edgeId = eb.edge.id; r.line = useLine; r.reversed = eb.reversed;
      r.laneEl = useLine ? st.laneEls[eb.edge.id][useLine] : null;
      return r;
    }
    var g = ghostRoute(from, to);
    g.edgeId = null;
    return g;
  }

  function markLive(laneEl, delta) {
    if (!laneEl) return;
    var n = (laneEl._live || 0) + delta;
    laneEl._live = n < 0 ? 0 : n;
    laneEl.classList.toggle('is-live', laneEl._live > 0);
  }

  function truncate(s, max) {
    s = String(s == null ? '' : s);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  /** Paket (etiketli hap) öğesi. */
  function makePacket(opts, resolve) {
    var D = data();
    var lineId = opts.line && D.lines[opts.line] ? opts.line : null;
    var it = {
      kind: 'packet', opts: opts, resolve: resolve, start: clock(), dur: 0, done: false,
      line: lineId, els: null, route: null, len: 0, path: null
    };
    it.bind = function () {
      var route = routeFor(opts.from, opts.to, lineId);
      if (!it.line) {
        var eb = D.edgeBetween ? D.edgeBetween(opts.from, opts.to) : null;
        it.line = eb ? eb.edge.lines[0] : 'control';
      }
      it.route = route;
      var size = opts.size === 'lg' ? 'lg' : (opts.size === 'sm' ? 'sm' : 'md');
      var fs = st.fonts.packet * (size === 'lg' ? 1.15 : size === 'sm' ? 0.88 : 1);
      var label = truncate(opts.label, size === 'lg' ? 20 : size === 'sm' ? 12 : 16);
      if (route.ghost) {
        it.ghostEl = mk('path', { class: 'dg-ghost', d: route.d, 'data-line': it.line }, st.layers.ghost);
      }
      var tA = mk('path', { class: 'dg-trail dg-trail-a', d: route.d, 'data-line': it.line, 'stroke-width': f1(LANE_W + 3.5) }, st.layers.trails);
      var tB = mk('path', { class: 'dg-trail dg-trail-b', d: route.d, 'data-line': it.line, 'stroke-width': f1(LANE_W + 2) }, st.layers.trails);
      var g = mk('g', { class: 'dg-pk dg-pk-' + size, 'data-line': it.line }, st.layers.packets);
      var hgt = fs * 1.65;
      it.hw = hgt * 0.32; it.hh = hgt / 2;
      if (label) {
        var w = label.length * fs * 0.6 + fs * 1.3;
        it.hw = w / 2;
        mk('rect', { class: 'dg-pk-bg', x: f1(-w / 2), y: f1(-hgt / 2), width: f1(w), height: f1(hgt), rx: f1(hgt / 2) }, g);
        mk('text', { class: 'dg-pk-tx', x: 0, y: f1(fs * 0.36), 'text-anchor': 'middle', 'font-size': f1(fs), text: label }, g);
      } else {
        mk('circle', { class: 'dg-pk-bg', r: f1(hgt * 0.32) }, g);
      }
      it.els = { g: g, tA: tA, tB: tB };
      it.path = tA;
      var len = 0;
      try { len = tA.getTotalLength(); } catch (e) { len = polyLen(route.pts); }
      if (!(len > 0)) len = polyLen(route.pts) || 1;
      it.len = len;
      if (!it.dur) it.dur = clampN(360 + len * 2.1, 450, 1100);
      tA.setAttribute('stroke-dasharray', '0 ' + f1(len * 2 + 10));
      tB.setAttribute('stroke-dasharray', '0 ' + f1(len * 2 + 10));
      markLive(route.laneEl, 1);
      it.update(clock());
    };
    it.unbind = function () {
      if (it.route) markLive(it.route.laneEl, -1);
      if (it.els) {
        ['g', 'tA', 'tB'].forEach(function (k) { var e = it.els[k]; if (e && e.parentNode) e.parentNode.removeChild(e); });
      }
      if (it.ghostEl && it.ghostEl.parentNode) it.ghostEl.parentNode.removeChild(it.ghostEl);
      it.els = null; it.ghostEl = null;
    };
    it.update = function (now) {
      var p = clampN((now - it.start) / it.dur, 0, 1);
      var e = easeInOut(p);
      var d = e * it.len;
      var pt;
      try { pt = it.path.getPointAtLength(d); } catch (x) { pt = { x: 0, y: 0 }; }
      // hap görünüm kutusunun dışına taşmasın (iz hat üzerinde kalır)
      var gw = st.geo ? st.geo.w : 1e9, gh = st.geo ? st.geo.h : 1e9;
      var px = clampN(pt.x, it.hw + 2, Math.max(it.hw + 2, gw - it.hw - 2));
      var py = clampN(pt.y, it.hh + 2, Math.max(it.hh + 2, gh - it.hh - 2));
      it.els.g.setAttribute('transform', 'translate(' + f1(px) + ' ' + f1(py) + ')');
      var big = it.len * 2 + 10;
      var la = Math.min(d, 46), lb = Math.min(d, 20);
      it.els.tA.setAttribute('stroke-dasharray', f1(la) + ' ' + f1(big));
      it.els.tA.setAttribute('stroke-dashoffset', f1(-(d - la)));
      it.els.tB.setAttribute('stroke-dasharray', f1(lb) + ' ' + f1(big));
      it.els.tB.setAttribute('stroke-dashoffset', f1(-(d - lb)));
      return p >= 1;
    };
    it.finish = function () {
      if (it.done) return;
      it.done = true;
      it.unbind();
      pulse(opts.to, { line: it.line });
      resolve();
    };
    it.abort = function () {
      if (it.done) return;
      it.done = true;
      it.unbind();
      resolve();
    };
    return it;
  }

  function travel(opts) {
    opts = opts || {};
    var D = data();
    if (!st.mounted || !st.geo || !hasDoc) return waitMs(450);
    if (!D || !D.nodeById[opts.from] || !D.nodeById[opts.to] || opts.from === opts.to) {
      if (D && D.nodeById[opts.to]) pulse(opts.to, { line: opts.line });
      return Promise.resolve();
    }
    if (isReduced()) return reducedTravel(opts);
    return new Promise(function (resolve) {
      var it = makePacket(opts, resolve);
      it.bind();
      addItem(it);
    });
  }

  function reducedTravel(opts) {
    var route = routeFor(opts.from, opts.to, opts.line);
    var el = route.laneEl, ghost = null;
    if (!el && route.edgeId) {
      // hat kenarda yoksa kenarın tüm şeritlerini vurgula
      var lanes = st.laneEls[route.edgeId] || {};
      var all = Object.keys(lanes).map(function (k) { return lanes[k]; });
      all.forEach(function (x) { x.classList.add('is-hot'); });
      return waitMs(300).then(function () {
        all.forEach(function (x) { x.classList.remove('is-hot'); });
        pulse(opts.to, { line: opts.line });
      });
    }
    if (!el) {
      ghost = mk('path', { class: 'dg-ghost is-hot', d: route.d, 'data-line': opts.line || 'control' }, st.layers.ghost);
    } else el.classList.add('is-hot');
    return waitMs(300).then(function () {
      if (el) el.classList.remove('is-hot');
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      pulse(opts.to, { line: opts.line });
    });
  }

  /** Ambient: soluk, etiketsiz noktalar ardışık kenarlarda sıçrar. */
  function ambient(opts) {
    if (!st.mounted || !st.geo || !hasDoc) return;
    opts = opts || {};
    var s = settings();
    if (s.paused || s.ambient === false || isReduced()) return;
    if (st.ambientCount >= AMBIENT_MAX) return;
    var path = (opts.path || []).filter(function (id) { return data().nodeById[id]; });
    if (path.length < 2) return;
    st.ambientCount++;
    var it = { kind: 'ambient', idx: 0, start: clock(), dur: 0, done: false, line: opts.line || null, el: null, path: null };
    it.bindHop = function () {
      var a = path[it.idx], b = path[it.idx + 1];
      var eb = data().edgeBetween(a, b);
      if (!eb) return false;
      var line = it.line && eb.edge.lines.indexOf(it.line) >= 0 ? it.line : eb.edge.lines[0];
      var r = laneFor(eb.edge.id, line, eb.reversed);
      if (!it.el) {
        it.el = mk('circle', { class: 'dg-amb', r: 2.6, 'data-line': line }, st.layers.trails);
      } else {
        it.el.setAttribute('data-line', line);
      }
      if (!it.path) it.path = mk('path', { class: 'dg-amb-path', d: r.d }, null);
      it.path.setAttribute('d', r.d);
      it.ptsLen = polyLen(r.pts);
      it.pts = r.pts;
      it.dur = clampN(520 + it.ptsLen * 3.2, 700, 1800);
      return true;
    };
    it.bind = function () {
      if (it.el && it.el.parentNode) it.el.parentNode.removeChild(it.el);
      it.el = null;
      if (!it.bindHop()) it.done = true;
    };
    it.update = function (now) {
      if (it.done) return true;
      var p = (now - it.start) / it.dur;
      if (p >= 1) {
        it.idx++;
        if (it.idx >= path.length - 1) return true;
        it.start = now;
        if (!it.bindHop()) return true;
        p = 0;
      }
      var pt = pointAlong(it.pts, p * it.ptsLen);
      it.el.setAttribute('cx', f1(pt.x)); it.el.setAttribute('cy', f1(pt.y));
      return false;
    };
    it.finish = it.abort = function () {
      if (it.fin) return;
      it.fin = true; it.done = true;
      st.ambientCount = Math.max(0, st.ambientCount - 1);
      if (it.el && it.el.parentNode) it.el.parentNode.removeChild(it.el);
    };
    it.unbind = function () { if (it.el && it.el.parentNode) it.el.parentNode.removeChild(it.el); it.el = null; };
    if (!it.bindHop()) { it.finish(); return; }
    addItem(it);
  }

  /** Çoklu çizgi üzerinde mesafe d'deki nokta (köşeler düz; ambient için yeterli). */
  function pointAlong(pts, d) {
    var acc = 0;
    for (var i = 1; i < pts.length; i++) {
      var l = dist(pts[i - 1], pts[i]);
      if (acc + l >= d) return lerp(pts[i - 1], pts[i], l > 0 ? (d - acc) / l : 0);
      acc += l;
    }
    return pts[pts.length - 1];
  }

  function rebindItems() {
    st.items.forEach(function (it) {
      if (it.done) return;
      if (it.kind === 'packet') { it.els = null; it.ghostEl = null; it.route = null; it.bind(); }
      else { it.el = null; it.path = null; if (!it.bindHop()) it.done = true; }
    });
  }

  function clearItems(kind) {
    var keep = [];
    st.items.forEach(function (it) {
      if (!kind || it.kind === kind) { try { it.abort(); } catch (e) { /* yut */ } }
      else keep.push(it);
    });
    st.items = keep;
  }

  /* ==================================================================
   * 10. Etkileşim
   * ================================================================== */
  function activate(nodeId) {
    select(nodeId);
    try { SIM.bus && SIM.bus.emit('node:select', { nodeId: nodeId }); } catch (e) { /* yut */ }
  }
  function onStationClick(ev) {
    var id = ev.currentTarget.getAttribute('data-node');
    if (id) activate(id);
  }
  function onStationKey(ev) {
    var k = ev.key;
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      ev.preventDefault();
      ev.stopPropagation();
      var id = ev.currentTarget.getAttribute('data-node');
      if (id) activate(id);
    }
  }

  function select(nodeId) {
    var D = data();
    st.selected = nodeId && D && D.nodeById[nodeId] ? nodeId : null;
    applySelected();
  }
  function focus(ids) {
    if (!ids || (Array.isArray(ids) && !ids.length)) st.focus = null;
    else {
      var set = {};
      (Array.isArray(ids) ? ids : [ids]).forEach(function (id) { set[id] = true; });
      st.focus = set;
    }
    applyFocus();
  }
  function setActiveLine(lineId) {
    var D = data();
    var next = lineId && D && D.lines[lineId] ? lineId : null;
    var changed = next !== st.activeLine;
    st.activeLine = next;
    applyActiveLine();
    if (changed) { try { SIM.bus && SIM.bus.emit('diagram:line', { lineId: next }); } catch (e) { /* yut */ } }
  }
  function badge(nodeId, text) {
    if (!nodeId) return;
    if (text == null || text === '') delete st.badges[nodeId];
    else st.badges[nodeId] = String(text);
    if (st.mounted) drawBadge(nodeId);
  }

  /* ==================================================================
   * 11. Lejant
   * ================================================================== */
  var SHORT = { dmp: 'Veri', ad: 'Reklam', measure: 'Ölçüm', cleanroom: 'Clean Room', privacy: 'Rıza', control: 'Kontrol' };
  function renderLegend() {
    var el = st.legend;
    if (!el) return;
    var D = data();
    while (el.firstChild) el.removeChild(el.firstChild);
    el.classList.add('dg-legend');
    st.legendBtns = {};
    var list = h('div', { class: 'dg-legend-lines', role: 'group', 'aria-label': 'Hatlar: vurgulamak için seçin' });
    lineOrder().forEach(function (lid) {
      var L = D.lines[lid];
      if (!L) return;
      var b = h('button', {
        type: 'button', class: 'dg-legend-btn', 'data-line': lid, 'aria-pressed': 'false',
        title: L.code + ' · ' + L.name + ' — ' + L.desc,
        onclick: function () { setActiveLine(st.activeLine === lid ? null : lid); }
      }, [
        h('span', { class: 'line-badge sm', 'aria-hidden': 'true', text: L.code }),
        h('span', { class: 'dg-legend-name' }, [
          h('span', { class: 'dg-full', text: L.name }),
          h('span', { class: 'dg-short', 'aria-hidden': 'true', text: SHORT[lid] || L.name })
        ])
      ]);
      st.legendBtns[lid] = b;
      list.appendChild(b);
    });
    el.appendChild(list);
    var keys = h('div', { class: 'dg-legend-keys', 'aria-hidden': 'true' }, [
      h('span', { class: 'dg-key' }, [keySvg('hub'), 'aktarma']),
      h('span', { class: 'dg-key' }, [keySvg('ext'), 'dış sistem']),
      h('span', { class: 'dg-key dg-key-hint', text: 'İstasyona dokunun: ayrıntı' })
    ]);
    el.appendChild(keys);
    applyActiveLine();
  }
  function keySvg(kind) {
    var s = mk('svg', { class: 'dg-key-ico', viewBox: '-10 -10 20 20', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' });
    if (kind === 'hub') { mk('circle', { r: 6.5, class: 'k-hub' }, s); mk('circle', { r: 2, class: 'k-core' }, s); }
    else mk('circle', { r: 6, class: 'k-ext' }, s);
    return s;
  }

  /* ==================================================================
   * 12. Yerleşim seçimi ve yeniden ölçekleme
   * ================================================================== */
  function chooseLayout(W, H, flow) {
    if (flow) return W >= 900 ? 'wide' : (W >= 560 ? 'square' : 'tall');
    var a = W / Math.max(1, H);
    return a >= 1.25 ? 'wide' : (a >= 0.8 ? 'square' : 'tall');
  }

  function doLayout(force) {
    if (!st.root || !st.stage) return;
    var W = st.root.clientWidth;
    if (W < 40) return;      // gizli: görünür olunca ResizeObserver yeniden çağırır
    st.root.style.height = '';
    st.stage.classList.add('is-fit');
    var H = st.root.clientHeight;
    var flow = H < 120;
    var id = chooseLayout(W, H, flow);
    var L = LAYOUTS[id];
    var vb = layoutSize(L);
    var s;
    if (flow) {
      s = W / vb.w;
      st.root.style.height = Math.ceil(W * vb.h / vb.w + FLOW_PAD) + 'px';
      st.stage.classList.remove('is-fit');
    } else {
      // sahne kökün içinde FIT_INSET kadar içeride
      s = Math.min((W - FIT_INSET[0]) / vb.w, (H - FIT_INSET[1]) / vb.h);
      st.root.style.height = '';
    }
    st.flow = flow;
    st.root.classList.toggle('dg-flow', flow);
    st.root.setAttribute('data-layout', id);
    var F = fontsFor(L, s);
    var key = id + '|' + F.label + '|' + F.sub + '|' + F.hideSub + '|' + F.packet;
    if (force || key !== st.renderKey || !st.svg) {
      st.renderKey = key;
      render(L, s);
    }
  }

  function layoutSize(L) {
    if (L._size) return L._size;
    var maxC = 0, maxR = 0;
    Object.keys(L.n).forEach(function (k) { maxC = Math.max(maxC, L.n[k][0]); maxR = Math.max(maxR, L.n[k][1]); });
    L._size = L.vb ? { w: L.vb[0], h: L.vb[1] } : {
      w: L.margin[3] + maxC * L.cell[0] + L.margin[1],
      h: L.margin[0] + maxR * L.cell[1] + L.margin[2]
    };
    return L._size;
  }

  function scheduleLayout() {
    if (st.layoutRaf) return;
    var run = function () { st.layoutRaf = 0; doLayout(false); };
    st.layoutRaf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16);
  }

  /* ==================================================================
   * 13. mount
   * ================================================================== */
  function mount(rootEl, legendEl) {
    if (!hasDoc) return;
    if (typeof rootEl === 'string') rootEl = document.querySelector(rootEl);
    if (typeof legendEl === 'string') legendEl = document.querySelector(legendEl);
    rootEl = rootEl || document.getElementById('diagram-root');
    legendEl = legendEl === undefined ? document.getElementById('map-legend') : legendEl;
    if (!rootEl || !data()) { warn('mount: kök öğe veya SIM.data yok'); return; }
    if (st.ro) { try { st.ro.disconnect(); } catch (e) { /* yut */ } }
    st.root = rootEl;
    st.legend = legendEl || null;
    while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);
    rootEl.classList.add('dg-root');
    st.stage = h('div', { class: 'dg-stage is-fit' });
    rootEl.appendChild(st.stage);
    st.svg = null;
    st.mounted = true;
    renderLegend();
    doLayout(true);
    if (!st.svg) {
      // görünmez kökte bile bir çizim olsun (ör. gizli sekme); ölçek 1 varsayılır
      var L = LAYOUTS.square;
      st.renderKey = '';
      render(L, 1);
    }
    if (typeof ResizeObserver === 'function') {
      st.ro = new ResizeObserver(function () { scheduleLayout(); });
      st.ro.observe(rootEl);
    } else {
      window.addEventListener('resize', scheduleLayout);
    }
    try {
      if (document.fonts && document.fonts.addEventListener) {
        document.fonts.addEventListener('loadingdone', function () { placeLabels(); });
      }
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { placeLabels(); });
    } catch (e) { /* yut */ }
  }

  function relayout() {
    if (!st.mounted) return;
    doLayout(true);
  }

  /* ==================================================================
   * 14. Bus
   * ================================================================== */
  function wireBus() {
    var bus = SIM.bus;
    if (!bus || wireBus.done) return;
    wireBus.done = true;
    bus.on('settings', function (p) {
      if (!p) return;
      if (p.key === 'paused') applyPaused();
      if (p.key === 'ambient' && !p.value) clearItems('ambient');
      if (p.key === 'reducedMotion' && p.value) {
        // hareket kapandı: uçuştaki paketleri hemen bitir
        st.items.slice().forEach(function (it) { if (it.kind === 'packet') { try { it.finish(); } catch (e) { /* yut */ } } });
        st.items = st.items.filter(function (it) { return it.kind !== 'packet'; });
        clearItems('ambient');
      }
    });
    bus.on('reset', function () {
      clearItems();
      st.badges = {};
      Object.keys(st.badgeEls).forEach(function (id) { var g = st.badgeEls[id]; if (g && g.parentNode) g.parentNode.removeChild(g); });
      st.badgeEls = {};
      if (st.layers) {
        ['fx', 'ghost'].forEach(function (k) { var l = st.layers[k]; while (l && l.firstChild) l.removeChild(l.firstChild); });
      }
      focus(null);
    });
    bus.on('node:select', function (p) {
      if (p && p.nodeId !== st.selected) select(p.nodeId);
    });
  }

  SIM.diagram = {
    mount: mount,
    travel: travel,
    pulse: pulse,
    badge: badge,
    ambient: ambient,
    focus: focus,
    setActiveLine: setActiveLine,
    select: select,
    relayout: relayout,
    /* Ekler (sözleşme dışı, isteğe bağlı) */
    layoutId: function () { return st.layoutId; },
    activeLine: function () { return st.activeLine; },
    inFlight: function () { return st.items.filter(function (it) { return it.kind === 'packet'; }).length; },
    _layouts: LAYOUTS,
    _debug: function () { return { geo: st.geo, scale: st.scale, fonts: st.fonts, layout: st.layoutId, flow: st.flow, items: st.items.length, ambient: st.ambientCount }; }
  };

  wireBus();
})(window.SIM);

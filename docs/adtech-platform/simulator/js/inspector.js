/* inspector.js — [inspector] SIM.inspector: “Sistem içi görünüm” paneli (SPEC.md §9)
 *
 * Sekmeler (id → başlık): flow → Akış, kafka → Kafka, profile → Profil, decision → Reklam Kararı,
 * reports → Raporlar, campaigns → Kampanyalar, cleanroom → Clean Room, node → İstasyon.
 *
 * SIM.state'i yalnızca OKUR (motor yazar); değişiklik istekleri SIM.engine.dispatch ile gider.
 * Bus dinleyicileri dosya yüklenirken bağlanır: mount'tan önce gelen olaylar da kaybolmaz.
 * Yeniden çizimler sekme başına rAF + en fazla ~5/sn ile sınırlanır; görünmeyen sekme yalnızca
 * "kirli" işaretlenir ve okunmamış noktası yanar.
 *
 * Sözleşmeye eklenenler (SPEC'te yok, yalnızca ek):
 *   SIM.inspector.mount(rootEl, { tab })    ilk sekme (varsayılan 'flow')
 *   SIM.inspector.show(tabId, { reveal })   reveal:true → telefon/tablette paneli görünür alana kaydırır
 *   SIM.inspector.activeTab(), .tabs, .refresh(), .docsBase ('../' — İstasyon sekmesindeki .md bağlantılarının öneki)
 *   bus 'inspector:show' { tab, reveal?, nodeId? }   (nodeId verilirse istasyon da seçilir)
 *   bus 'inspector:tab'  { tab }            sekme değişince yayınlanır
 *   DOM id'leri: ins-tab-<tab>, ins-panel-<tab>, ins-status-<li>, ins-rate-<li>, ins-fcap-<li>,
 *                ins-save-<li>, ins-cr-run, ins-dec-select
 */
window.SIM = window.SIM || {};

(function (SIM) {
  'use strict';

  var bus = SIM.bus;
  var U = SIM.util;
  if (!bus || !U) {
    try { console.error('[SIM.inspector] core.js inspector.js’ten önce yüklenmeli.'); } catch (e) { /* yut */ }
    SIM.inspector = { mount: function () {}, show: function () {}, selectNode: function () {} };
    return;
  }
  var hasDoc = typeof document !== 'undefined';
  var el = U.el, sv = U.svg;

  /* ==================================================================
   * Sabitler
   * ================================================================== */
  var TABS = [
    { id: 'flow',      label: 'Akış',          line: null },
    { id: 'kafka',     label: 'Kafka',         line: null },
    { id: 'profile',   label: 'Profil',        line: 'dmp' },
    { id: 'decision',  label: 'Reklam Kararı', line: 'ad' },
    { id: 'reports',   label: 'Raporlar',      line: 'measure' },
    { id: 'campaigns', label: 'Kampanyalar',   line: 'control' },
    { id: 'cleanroom', label: 'Clean Room',    line: 'cleanroom' },
    { id: 'node',      label: 'İstasyon',      line: null }
  ];
  var TAB_BY_ID = {};
  TABS.forEach(function (t) { TAB_BY_ID[t.id] = t; });

  var MAX_NARR = 200, MAX_KAFKA = 150, MAX_DEC = 20;
  var MIN_INTERVAL = 200;          // ms — sekme başına en fazla ~5 çizim/sn
  var FLASH_MS = 2000;             // değişen profil alanlarının vurgu süresi
  var MERGE_ANIM_MS = 1500;

  var KIND_LABEL = { info: 'bilgi', ok: 'tamam', warn: 'uyarı', drop: 'atıldı' };
  var STORE_LABEL = { profile: 'Profil (Aerospike)', idmap: 'idmap', iceberg: 'Iceberg', clickhouse: 'ClickHouse', cleanroom: 'Clean room', partners: 'Aktivasyon ortakları' };
  var PURPOSE_LABEL = { kampanya_olcumleme_ve_aktivasyon: 'Kampanya ölçümleme ve aktivasyon' };
  var TEMPLATE_LABEL = { overlap_report: 'örtüşme raporu', audience_activation: 'kitle aktivasyonu' };
  var ID_ORDER = { fpc: 0, hem: 1, maid: 2 };

  /* ==================================================================
   * Küçük yardımcılar
   * ================================================================== */
  function D() { return SIM.data || {}; }
  function S() { var s = SIM.state; return (s && typeof s === 'object') ? s : null; }
  function LBL(group, key, fb) {
    var l = (SIM.data && SIM.data.labels && SIM.data.labels[group]) || null;
    return l && l[key] != null ? l[key] : (fb != null ? fb : key);
  }
  function perf() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function nowSim() { try { return U.nowSim(); } catch (e) { return Date.now(); } }
  function num(x, d) { x = Number(x); return isFinite(x) ? x : (d === undefined ? 0 : d); }
  function keysOf(o) { return o && typeof o === 'object' ? Object.keys(o) : []; }
  function last(a) { return a && a.length ? a[a.length - 1] : null; }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function pct(x) { return (clamp(num(x), 0, 1) * 100).toFixed(3) + '%'; }
  function reducedMotion() {
    if (SIM.settings && SIM.settings.reducedMotion) return true;
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function isDesktop() { try { return U.breakpoint() === 'desktop'; } catch (e) { return true; } }
  function raf(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }
  function cssEsc(s) {
    s = String(s);
    try { if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s); } catch (e) { /* yut */ }
    return s.replace(/["\\\]\[]/g, '\\$&');
  }
  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }

  var fInt = function (n) { return U.fmtInt(n); };
  var fTL = function (n, d) { return U.fmtTL(n, d); };
  var fPct = function (x, d) { return U.fmtPct(x, d); };
  var fMs = function (x) { return U.fmtMs(x); };
  var fNum = function (n, d, m) { return U.fmtNum(n, d, m); };
  var fTime = function (t) { return U.fmtTime(t); };
  var fDate = function (t) { return U.fmtDate(t); };
  var fCompact = function (n) { return U.fmtCompact(n); };
  var shortH = function (h) { return U.shortHash(h); };

  function tsShort(ts) {
    ts = num(ts, NaN);
    if (!isFinite(ts)) return '—';
    var n = nowSim();
    return fDate(ts) === fDate(n) ? fTime(ts) : fDate(ts) + ' ' + fTime(ts).slice(0, 5);
  }
  function parseTs(s) { var t = Date.parse(s); return isNaN(t) ? null : t; }

  /* ---- veri erişimi ---- */
  function lineOf(id) { var ls = D().lines || {}; return id && ls[id] ? ls[id] : null; }
  function nodeOf(id) { var m = D().nodeById || {}; return id && m[id] ? m[id] : null; }
  function nodeLabel(id) { var n = nodeOf(id); return n ? n.label : (id || ''); }
  function segOf(id) {
    var s = S();
    if (s && s.segments && s.segments[id]) return s.segments[id];
    var m = D().segmentById || {};
    return m[id] || null;
  }
  function liOf(id) {
    var s = S();
    if (s && s.lineItems && s.lineItems[id]) return s.lineItems[id];
    var m = D().lineItemById || {};
    return m[id] || null;
  }
  function bidderOf(id) { var m = D().bidderById || {}; return m[id] || null; }
  function topicOf(id) { var t = D().topics || {}; return t[id] || null; }
  function ctxLabel(cat) {
    var d = D();
    return (d.contextLabels && d.contextLabels[cat]) || (d.categoryLabels && d.categoryLabels[cat]) || cat || '—';
  }
  function lineItemList() {
    var s = S();
    var src = (s && s.lineItems) || null;
    var arr = src ? keysOf(src).map(function (k) { return src[k]; }) : (D().lineItems || []).slice();
    return arr.filter(Boolean).sort(function (a, b) { return (num(a.priority) - num(b.priority)) || (num(a.id) - num(b.id)); });
  }
  function decisionList() {
    var s = S();
    if (s && Array.isArray(s.decisions) && s.decisions.length) return s.decisions;
    return M.decisions;
  }
  function winnerName(tr) {
    var w = (tr && tr.winner) || {};
    if (w.source === 'prebid') { var b = bidderOf(w.bidder); return b ? b.name : (w.bidder || 'Programatik'); }
    if (w.lineItemId != null) { var li = liOf(w.lineItemId); return li ? li.name : 'LI ' + w.lineItemId; }
    return 'House (dolum yok)';
  }
  function consentLabel(st) { return LBL('consentStatus', st || 'unknown', st || '—'); }

  /* ---- DOM parçaları ---- */
  function lineBadge(id, size, withName) {
    var ln = lineOf(id);
    if (!ln) return null;
    var b = el('span', { class: ['line-badge', size || null], 'data-line': id, title: ln.code + ' · ' + ln.name, 'aria-hidden': 'true' }, ln.code);
    if (!withName) return [b, el('span', { class: 'sr-only' }, ln.name)];
    return el('span', { class: 'ins-line' }, b, el('span', { class: 'ins-line-name' }, ln.name));
  }
  function pill(kind, text, glyph, attrs) {
    var a = attrs || {};
    a.class = (kind === 'line' ? 'pill' : 'pill-' + kind) + (a.class ? ' ' + a.class : '');
    return el('span', a, glyph ? el('span', { class: 'ins-pg', 'aria-hidden': 'true' }, glyph) : null, text);
  }
  var hid = 0;
  function section(cls, title, meta, kids, opts) {
    opts = opts || {};
    var id = 'ins-h-' + (++hid);
    return el('section', { class: ['ins-sec', cls], 'aria-labelledby': id, 'data-line': opts.line || null },
      el('div', { class: 'ins-sec-head' },
        el('h3', { class: 'ins-h', id: id }, title),
        meta ? el('span', { class: 'ins-sec-meta' }, meta) : null),
      kids);
  }
  function empty(title, text, kind, extra) {
    return el('div', { class: 'ins-empty', 'data-kind': kind || 'info' },
      el('p', { class: 'ins-empty-title' }, title),
      text ? el('p', { class: 'ins-empty-text' }, text) : null,
      extra || null);
  }
  function sumStrip(cells) {
    return el('dl', { class: 'ins-sum' }, cells.filter(Boolean).map(function (c) {
      return el('div', { class: ['ins-sum-cell', c.cls || null] },
        el('dt', c.k),
        el('dd', null,
          el('span', { class: ['ins-sum-v', c.mono ? 'mono' : null] }, c.v),
          c.sub ? el('span', { class: 'ins-sum-sub' }, c.sub) : null));
    }));
  }
  function note(text, cls) { return el('p', { class: ['ins-note', cls || null] }, text); }
  function appendAll(parent, kids) {
    (Array.isArray(kids) ? kids : [kids]).forEach(function (k) {
      if (k == null || k === false) return;
      if (Array.isArray(k)) { appendAll(parent, k); return; }
      parent.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
    });
  }
  function detailsEl(key, defOpen, summaryKids, bodyKids, cls) {
    var open = M.details[key] != null ? M.details[key] : !!defOpen;
    return el('details', { class: ['ins-details', cls || null], 'data-dk': key, open: open },
      el('summary', { class: 'ins-summary' }, summaryKids), bodyKids);
  }

  /* ==================================================================
   * JSON görünümü (sözdizimi renkli, değişen satır vurgulu)
   * ================================================================== */
  function isPrim(x) { return x === null || x === undefined || typeof x !== 'object'; }
  function jsonView(value, opts) {
    opts = opts || {};
    var root = el('div', { class: ['ins-json', opts.cls || null] });
    var changed = opts.changed || null;
    function punc(t) { return el('span', { class: 'j-punc' }, t); }
    function lineEl(depth, hot, parts) {
      return el('div', { class: ['j-line', hot ? 'is-changed' : null], style: { '--d': depth } }, parts);
    }
    function keyParts(k, path) {
      var shown = opts.keyLabel ? opts.keyLabel(String(k), path) : String(k);
      var a = { class: 'j-key' };
      if (shown !== String(k)) a.title = String(k);
      return [el('span', a, JSON.stringify(shown)), punc(': ')];
    }
    function prim(v) {
      if (v === null || v === undefined) return el('span', { class: 'j-null' }, 'null');
      var t = typeof v;
      if (t === 'number') return el('span', { class: 'j-num' }, isFinite(v) ? String(v) : 'null');
      if (t === 'boolean') return el('span', { class: 'j-bool' }, String(v));
      var s = String(v);
      var shown = /^[0-9a-f]{40,}$/i.test(s) ? shortH(s) : s;
      var a = { class: 'j-str' };
      if (shown !== s) a.title = s;
      return el('span', a, JSON.stringify(shown));
    }
    function annot(path, k, v) {
      var n = opts.annotate ? safe(function () { return opts.annotate(path, k, v); }, null) : null;
      return n ? el('span', { class: 'j-note' }, '  // ' + n) : null;
    }
    function walk(v, depth, path, key, isLast, hot) {
      hot = hot || !!(changed && path && changed[path]);
      var comma = isLast ? null : punc(',');
      var kp = key != null ? keyParts(key, path) : null;
      var isArr = Array.isArray(v);
      var inlineArr = isArr && v.every(isPrim);
      if (v && typeof v === 'object' && !inlineArr) {
        var ks = isArr ? v.map(function (_, i) { return i; }) : Object.keys(v);
        if (!ks.length) { root.appendChild(lineEl(depth, hot, [kp, punc(isArr ? '[]' : '{}'), comma])); return; }
        root.appendChild(lineEl(depth, hot, [kp, punc(isArr ? '[' : '{')]));
        ks.forEach(function (k, i) {
          walk(v[k], depth + 1, path ? path + '.' + k : String(k), isArr ? null : k, i === ks.length - 1, hot);
        });
        root.appendChild(lineEl(depth, hot, [punc(isArr ? ']' : '}'), comma]));
        return;
      }
      if (inlineArr) {
        var parts = [punc('[')];
        v.forEach(function (x, i) { if (i) parts.push(punc(', ')); parts.push(prim(x)); });
        parts.push(punc(']'));
        root.appendChild(lineEl(depth, hot, [kp, parts, comma, annot(path, key, v)]));
        return;
      }
      root.appendChild(lineEl(depth, hot, [kp, prim(v), comma, annot(path, key, v)]));
    }
    walk(value, 0, '', null, true, false);
    return root;
  }

  function flatten(v, prefix, out) {
    out = out || {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      var ks = Object.keys(v);
      if (!ks.length && prefix) out[prefix] = '{}';
      ks.forEach(function (k) { flatten(v[k], prefix ? prefix + '.' + k : k, out); });
    } else if (prefix) {
      out[prefix] = JSON.stringify(v === undefined ? null : v);
    }
    return out;
  }

  /* ==================================================================
   * Modül durumu
   * ================================================================== */
  var M = {
    root: null, mounted: false, head: null, statusText: null, statusDot: null, clockEl: null, clockTimer: null,
    tabsEl: null, bodyEl: null, tabBtns: {}, panels: {}, ui: {},
    active: 'flow', unread: {}, dirty: {}, lastRender: {}, timer: {}, rafPending: {}, sig: {},
    scroll: {}, details: {},
    flows: {}, flowSeq: 0, narr: [], narrSeq: 0,
    kafka: [], kSeq: 0, kafkaFilter: 'all',
    decisions: [], decisionSel: null,
    profSnap: undefined, profChanged: null, profSig: null, merge: null, segChange: null, flashTimer: null,
    lastRun: null, selectedNode: null,
    activeFlows: {}, pending: {}, crPending: false, drafts: {}, camMsg: {},
    busy: { busy: false, queue: 0 }, busyLine: null, campSig: null, crSig: null,
    sparkHover: null
  };
  TABS.forEach(function (t) { M.unread[t.id] = false; M.dirty[t.id] = true; });

  /* ==================================================================
   * Zamanlama: rAF + en fazla ~5/sn
   * ================================================================== */
  function invalidate(tab) {
    M.dirty[tab] = true;
    if (M.mounted && tab === M.active) schedule(tab);
  }
  function schedule(tab) {
    if (M.timer[tab] || M.rafPending[tab]) return;
    var wait = MIN_INTERVAL - (perf() - (M.lastRender[tab] || 0));
    if (wait > 0) {
      M.timer[tab] = setTimeout(function () { M.timer[tab] = null; frame(tab); }, wait);
    } else frame(tab);
  }
  function frame(tab) {
    M.rafPending[tab] = true;
    raf(function () {
      M.rafPending[tab] = false;
      if (M.mounted && tab === M.active && M.dirty[tab]) renderNow(tab);
    });
  }
  function renderNow(tab) {
    if (!M.mounted || !M.panels[tab]) return;
    M.dirty[tab] = false;
    M.lastRender[tab] = perf();
    try { RENDER[tab](); }
    catch (e) { try { console.error('[SIM.inspector] "' + tab + '" sekmesi çizilemedi:', e); } catch (e2) { /* yut */ } }
  }
  function markUnread(tab) {
    if (M.mounted && tab === M.active) return;
    if (M.unread[tab]) return;
    M.unread[tab] = true;
    paintDot(tab);
  }
  function paintDot(tab) {
    var b = M.tabBtns[tab];
    if (!b) return;
    b.setAttribute('data-unread', M.unread[tab] ? 'true' : 'false');
    var sr = b.querySelector('.ins-tab-new');
    if (sr) sr.textContent = M.unread[tab] ? ' · yeni veri' : '';
  }

  /** Bir sekmeyi yeniden kurar: odak (data-fk / id + seçim), yatay kaydırma (data-sk) korunur. */
  function rebuildPanel(tab, kids) {
    var panel = M.panels[tab];
    if (!panel) return;
    var ae = hasDoc ? document.activeElement : null;
    var fk = null, s0 = null, s1 = null, hadFocus = false;
    if (ae && ae !== panel && panel.contains(ae)) {
      hadFocus = true;
      fk = ae.getAttribute('data-fk') || ae.id || null;
      try { s0 = ae.selectionStart; s1 = ae.selectionEnd; } catch (e) { s0 = null; }
    }
    var sk = {};
    U.qsa('[data-sk]', panel).forEach(function (n) { sk[n.getAttribute('data-sk')] = n.scrollLeft; });
    var frag = document.createDocumentFragment();
    appendAll(frag, kids);
    U.clear(panel);
    panel.appendChild(frag);
    if (hadFocus) {
      var t = fk ? (panel.querySelector('[data-fk="' + cssEsc(fk) + '"]') || document.getElementById(fk)) : null;
      try {
        if (t && panel.contains(t) && !t.disabled) {
          t.focus({ preventScroll: true });
          if (s0 != null && typeof t.setSelectionRange === 'function') t.setSelectionRange(s0, s1);
        } else panel.focus({ preventScroll: true });
      } catch (e) { /* yut */ }
    }
    U.qsa('[data-sk]', panel).forEach(function (n) { var v = sk[n.getAttribute('data-sk')]; if (v) n.scrollLeft = v; });
  }

  /* ==================================================================
   * Bus dinleyicileri (yüklenirken bağlanır)
   * ================================================================== */
  function userFlowActive() { return keysOf(M.activeFlows).length > 0; }
  function flowActionOf(type) {
    var out = [];
    keysOf(M.activeFlows).forEach(function (k) { var a = M.activeFlows[k]; if (a && a.type === type) out.push(a); });
    return out;
  }

  bus.on('flow:start', function (p) {
    if (!p || !p.flowId) return;
    M.flows[p.flowId] = {
      flowId: p.flowId, title: p.title || (p.action && p.action.type) || 'Akış', line: p.line || null,
      action: p.action || null, parentFlowId: p.parentFlowId || null, ts: nowSim(), seq: ++M.flowSeq, ended: false
    };
    M.activeFlows[p.flowId] = p.action || {};
    M.busyLine = p.line || M.busyLine;
    markUnread('flow');
    invalidate('flow');
    var t = p.action && p.action.type;
    if (t === 'campaign_update') invalidate('campaigns');
    if (t === 'cleanroom_run') invalidate('cleanroom');
    paintStatus();
  });
  bus.on('flow:end', function (p) {
    if (!p || !p.flowId) return;
    var f = M.flows[p.flowId];
    if (f) { f.ended = true; f.endTs = nowSim(); }
    delete M.activeFlows[p.flowId];
    invalidate('flow');
    invalidate('campaigns');
    invalidate('cleanroom');
    paintStatus();
  });
  bus.on('narrate', function (p) {
    if (!p || p.text == null) return;
    M.narr.push({
      id: ++M.narrSeq, flowId: p.flowId || null, text: String(p.text), nodeId: p.nodeId || null,
      line: p.line || null, kind: KIND_LABEL[p.kind] ? p.kind : 'info', ts: p.ts != null ? p.ts : nowSim()
    });
    if (M.narr.length > MAX_NARR) M.narr.splice(0, M.narr.length - MAX_NARR);
    markUnread('flow');
    invalidate('flow');
  });
  bus.on('kafka', function (p) {
    if (!p || !p.topic) return;
    pushKafka(p);
    markUnread('kafka');
    invalidate('kafka');
    if (M.selectedNode) invalidate('node');
  });
  function pushKafka(p) {
    M.kafka.push({
      id: ++M.kSeq, topic: p.topic, partition: p.partition, offset: p.offset, key: p.key, value: p.value,
      ts: p.ts != null ? p.ts : nowSim(), line: p.line || ((topicOf(p.topic) || {}).line) || null
    });
    if (M.kafka.length > MAX_KAFKA) M.kafka.splice(0, M.kafka.length - MAX_KAFKA);
  }
  bus.on('state', function (p) {
    var keys = (p && Array.isArray(p.keys)) ? p.keys : [];
    var any = function () { for (var i = 0; i < arguments.length; i++) if (keys.indexOf(arguments[i]) >= 0) return true; return false; };
    // init/reset tüm anahtarları birden yayınlar: bu "yeni veri" değildir, okunmamış noktası yakmaz
    var broadcast = keys.length >= 8;
    if (any('user', 'consent', 'idmap', 'profiles', 'segments', 'dsar')) {
      var changed = computeProfileDiff();
      var sig = profileSig();
      if ((changed || sig !== M.profSig) && !broadcast) markUnread('profile');
      M.profSig = sig;
      invalidate('profile');
    }
    if (any('decisions')) invalidate('decision');
    if (any('reports', 'lineItems')) {
      invalidate('reports');
      if (!broadcast && keys.indexOf('lineItems') >= 0 && keys.indexOf('reports') >= 0) markUnread('reports');
    }
    if (any('lineItems', 'config')) {
      var cs = campaignsSig();
      if (cs !== M.campSig) {
        var prevVer = M.campSig ? M.campSig.split('|')[0] : null;
        M.campSig = cs;
        if (!broadcast && prevVer !== null && prevVer !== cs.split('|')[0]) markUnread('campaigns');
        invalidate('campaigns');
      }
    }
    if (any('cleanroom')) {
      var crs = cleanroomSig();
      if (crs !== M.crSig && !broadcast) markUnread('cleanroom');
      M.crSig = crs;
      invalidate('cleanroom');
    }
    if (M.selectedNode) invalidate('node');
  });
  bus.on('decision', function (p) {
    if (!p || !p.trace) return;
    M.decisions.push(p.trace);
    if (M.decisions.length > MAX_DEC) M.decisions.splice(0, M.decisions.length - MAX_DEC);
    markUnread('decision');
    invalidate('decision');
  });
  bus.on('identity:merge', function (p) {
    if (!p) return;
    M.merge = { from: p.from, into: p.into, ids: (p.ids || []).slice(), moved: (p.moved || []).slice(), at: perf(), simAt: nowSim(), shownAt: null };
    computeProfileDiff();
    markUnread('profile');
    invalidate('profile');
  });
  bus.on('segment:change', function (p) {
    if (!p) return;
    M.segChange = { personId: p.personId, added: (p.added || []).map(Number), removed: (p.removed || []).map(Number), at: perf(), shownAt: null };
    markUnread('profile');
    invalidate('profile');
  });
  bus.on('cleanroom:result', function (p) {
    if (!p || !p.run) return;
    M.lastRun = p.run;
    markUnread('cleanroom');
    invalidate('cleanroom');
  });
  bus.on('node:select', function (p) {
    if (!p) return;
    selectNode(p.nodeId, { fromBus: true });
  });
  bus.on('inspector:show', function (p) {
    if (!p) return;
    var tab = typeof p === 'string' ? p : p.tab;
    if (p.nodeId) selectNode(p.nodeId, { noShow: true });
    var rev = p.reveal === true || (p.reveal !== false && !isDesktop() && userActive() && !inspectorInView());
    show(tab, { reveal: rev });
  });
  bus.on('busy', function (p) { if (p) { M.busy = { busy: !!p.busy, queue: num(p.queue) }; paintStatus(); } });
  bus.on('settings', function (p) { if (p && p.key === 'paused') paintStatus(); });
  bus.on('reset', function () { resetModule(); });

  function userActive() {
    try { return !!(navigator.userActivation && navigator.userActivation.isActive); } catch (e) { return false; }
  }
  function inspectorInView() {
    if (!M.root) return true;
    var r = M.root.getBoundingClientRect();
    var vh = window.innerHeight || 800;
    return r.top < vh * 0.6 && r.bottom > vh * 0.2;
  }

  /* ---- profil farkı (son güncellemede değişen alanlar) ---- */
  function currentProfile() {
    var s = S();
    var pid = s && s.user ? s.user.personId : null;
    var prof = pid && s.profiles ? s.profiles[pid] : null;
    return prof ? { pid: pid, prof: prof } : null;
  }
  function profileBins(prof) {
    var order = ['ids', 'seg', 'fcap', 'attrs', 'consent', 'ver', 'createdAt', 'updatedAt', 'lastSeen'];
    var out = {};
    order.forEach(function (k) { if (prof[k] !== undefined) out[k] = prof[k]; });
    keysOf(prof).forEach(function (k) { if (k !== 'personId' && k !== 'counters' && !(k in out)) out[k] = prof[k]; });
    return out;
  }
  function computeProfileDiff() {
    var cur = currentProfile();
    var flat = cur ? flatten(profileBins(cur.prof)) : null;
    var prev = M.profSnap;
    M.profSnap = { pid: cur ? cur.pid : null, flat: flat };
    if (prev === undefined || !flat) return false;
    var changed = {}, n = 0;
    keysOf(flat).forEach(function (k) {
      if (!prev.flat || prev.flat[k] !== flat[k]) { changed[k] = true; n++; }
    });
    if (!n) return false;
    M.profChanged = { paths: changed, at: perf(), shownAt: null };
    return true;
  }
  /** Vurgu, değişiklik ekranda ilk göründüğü andan itibaren ~2 sn sürer (sekme kapalıyken kaçmasın). */
  function freshOf(c) {
    if (!c) return false;
    var t = perf();
    if (c.shownAt == null) {
      if (t - c.at > 15000) return false;
      c.shownAt = t;
      scheduleFlashClear();
    }
    return t - c.shownAt < FLASH_MS;
  }
  function scheduleFlashClear() {
    if (M.flashTimer) clearTimeout(M.flashTimer);
    M.flashTimer = setTimeout(function () {
      M.flashTimer = null;
      if (!M.mounted) return;
      U.qsa('.is-changed', M.panels.profile || M.root).forEach(function (n) { n.classList.remove('is-changed'); });
    }, FLASH_MS + 30);
  }
  function cleanroomSig() {
    var s = S();
    var cr = (s && s.cleanroom) || {};
    return [cr.epsilonUsed, (cr.runs || []).length].join('|');
  }
  function profileSig() {
    var s = S();
    if (!s) return '';
    var u = s.user || {}, c = s.consent || {};
    var cur = currentProfile();
    return [u.personId, u.suppressed, c.status, cur ? cur.prof.ver : '-', keysOf(s.idmap).length, (s.dsar || []).length,
      (last(s.dsar || []) || {}).status].join('|');
  }

  /* ==================================================================
   * Montaj
   * ================================================================== */
  function mount(rootEl, opts) {
    if (!hasDoc) return SIM.inspector;
    if (typeof rootEl === 'string') rootEl = document.querySelector(rootEl);
    rootEl = rootEl || document.getElementById('inspector-root');
    if (!rootEl) { try { console.warn('[SIM.inspector] #inspector-root bulunamadı.'); } catch (e) { /* yut */ } return SIM.inspector; }
    if (M.mounted && M.root === rootEl) return SIM.inspector;
    opts = opts || {};
    if (opts.tab && TAB_BY_ID[opts.tab]) M.active = opts.tab;

    M.root = rootEl;
    U.clear(rootEl);
    rootEl.classList.add('ins');

    // Başlık
    M.statusDot = el('span', { class: 'ins-live', 'aria-hidden': 'true' });
    M.statusText = el('span', { class: 'ins-status-text' }, 'boşta');
    M.clockEl = el('span', { class: 'ins-clock mono', title: 'Simülasyon saati (Europe/Istanbul)' }, fTime(nowSim()));
    M.head = el('header', { class: 'ins-head' },
      el('h2', { class: 'ins-title' }, 'Sistem içi görünüm'),
      el('div', { class: 'ins-status' }, M.statusDot, M.statusText, el('span', { class: 'ins-sep', 'aria-hidden': 'true' }, '·'), M.clockEl));

    // Sekmeler
    M.tabsEl = el('div', { class: 'ins-tabs', role: 'tablist', 'aria-label': 'Sistem içi görünüm sekmeleri' });
    M.tabBtns = {};
    TABS.forEach(function (t) {
      var sel = t.id === M.active;
      var b = el('button', {
        type: 'button', role: 'tab', class: 'ins-tab', id: 'ins-tab-' + t.id, 'data-tab': t.id, 'data-line': t.line,
        'aria-selected': sel, 'aria-controls': 'ins-panel-' + t.id, tabindex: sel ? '0' : '-1', 'data-unread': 'false'
      },
        el('span', { class: 'ins-tab-mark', 'aria-hidden': 'true' }),
        el('span', { class: 'ins-tab-label' }, t.label, el('span', { class: 'ins-dot', 'aria-hidden': 'true' })),
        el('span', { class: 'sr-only ins-tab-new' }, ''));
      M.tabBtns[t.id] = b;
      M.tabsEl.appendChild(b);
    });

    // Paneller
    M.bodyEl = el('div', { class: 'ins-body' });
    M.panels = {};
    M.ui = {};
    TABS.forEach(function (t) {
      var p = el('section', {
        class: 'ins-panel', role: 'tabpanel', id: 'ins-panel-' + t.id, 'data-panel': t.id,
        'aria-labelledby': 'ins-tab-' + t.id, tabindex: '0', hidden: t.id !== M.active
      });
      M.panels[t.id] = p;
      M.bodyEl.appendChild(p);
    });

    rootEl.appendChild(M.head);
    rootEl.appendChild(M.tabsEl);
    rootEl.appendChild(M.bodyEl);

    M.tabsEl.addEventListener('click', onTabClick);
    M.tabsEl.addEventListener('keydown', onTabKey);
    rootEl.addEventListener('toggle', onToggle, true);
    rootEl.addEventListener('click', onRootClick);
    rootEl.addEventListener('change', onRootChange);
    rootEl.addEventListener('input', onRootInput);
    rootEl.addEventListener('submit', onRootSubmit);

    // Mount'tan önce başlamış bir oturum: Kafka günlüğünü durumdan tohumla
    var s = S();
    if (!M.kafka.length && s && s.kafka && Array.isArray(s.kafka.log)) s.kafka.log.forEach(pushKafka);
    if (M.profSnap === undefined) computeProfileDiff();
    M.profSig = profileSig();
    M.campSig = campaignsSig();
    M.crSig = cleanroomSig();

    M.mounted = true;
    // Mount'tan önceki olaylar için okunmamış işareti yok (panel henüz yoktu)
    TABS.forEach(function (t) { M.unread[t.id] = false; M.dirty[t.id] = true; paintDot(t.id); });
    M.unread[M.active] = false;
    paintDot(M.active);
    paintStatus();
    renderNow(M.active);

    if (M.clockTimer) clearInterval(M.clockTimer);
    M.clockTimer = setInterval(function () { if (M.clockEl) M.clockEl.textContent = fTime(nowSim()); }, 1000);
    return SIM.inspector;
  }

  function paintStatus() {
    if (!M.statusText) return;
    var paused = !!(SIM.settings && SIM.settings.paused);
    var busy = M.busy.busy || userFlowActive();
    var q = M.busy.queue;
    var txt = paused ? 'duraklatıldı' : (busy ? ('akış sürüyor' + (q > 0 ? ' · sırada ' + q : '')) : 'boşta');
    M.statusText.textContent = txt;
    M.statusDot.setAttribute('data-state', paused ? 'paused' : (busy ? 'busy' : 'idle'));
    if (busy && M.busyLine) M.statusDot.setAttribute('data-line', M.busyLine);
    else M.statusDot.removeAttribute('data-line');
  }

  /* ---- sekme etkileşimi ---- */
  function onTabClick(ev) {
    var b = ev.target.closest ? ev.target.closest('.ins-tab') : null;
    if (!b) return;
    show(b.getAttribute('data-tab'));
  }
  function onTabKey(ev) {
    var k = ev.key;
    var ids = TABS.map(function (t) { return t.id; });
    var cur = ids.indexOf(M.active);
    var next = -1;
    if (k === 'ArrowRight' || k === 'ArrowDown') next = (cur + 1) % ids.length;
    else if (k === 'ArrowLeft' || k === 'ArrowUp') next = (cur - 1 + ids.length) % ids.length;
    else if (k === 'Home') next = 0;
    else if (k === 'End') next = ids.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    show(ids[next]);
    try { M.tabBtns[ids[next]].focus(); } catch (e) { /* yut */ }
  }
  function onToggle(ev) {
    var d = ev.target;
    if (!d || d.tagName !== 'DETAILS') return;
    var key = d.getAttribute('data-dk');
    if (key) M.details[key] = d.open;
    if (d.open && d.classList.contains('ins-kval') && !d._built) buildKafkaValue(d);
  }

  /* ---- kaydırma konumu (sekme başına) ---- */
  function bodyScrolls() {
    if (!M.bodyEl) return false;
    var oy = safe(function () { return getComputedStyle(M.bodyEl).overflowY; }, 'visible');
    return oy === 'auto' || oy === 'scroll';
  }
  function stickyOffset() {
    if (!M.tabsEl) return 0;
    var pos = safe(function () { return getComputedStyle(M.tabsEl).position; }, 'static');
    return pos === 'sticky' ? M.tabsEl.offsetHeight : 0;
  }
  function bodyTopAbs() { return M.bodyEl.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0); }
  function saveScroll(tab) {
    if (!M.bodyEl) return;
    if (bodyScrolls()) { M.scroll[tab] = M.bodyEl.scrollTop; return; }
    var y = window.scrollY || window.pageYOffset || 0;
    M.scroll[tab] = Math.max(0, y - (bodyTopAbs() - stickyOffset()));
  }
  function restoreScroll(tab) {
    if (!M.bodyEl) return;
    var v = M.scroll[tab] || 0;
    if (bodyScrolls()) { M.bodyEl.scrollTop = v; return; }
    var y = window.scrollY || window.pageYOffset || 0;
    var top = bodyTopAbs() - stickyOffset();
    if (y > top + 1) window.scrollTo(0, top + v);
  }

  /* ==================================================================
   * Genel API
   * ================================================================== */
  function show(tabId, opts) {
    opts = opts || {};
    if (!TAB_BY_ID[tabId]) {
      if (tabId != null) { try { console.warn('[SIM.inspector] bilinmeyen sekme:', tabId); } catch (e) { /* yut */ } }
      return;
    }
    if (!M.mounted) { M.active = tabId; return; }
    var prev = M.active;
    if (tabId !== prev) {
      saveScroll(prev);
      TABS.forEach(function (t) {
        var on = t.id === tabId;
        var b = M.tabBtns[t.id];
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.setAttribute('tabindex', on ? '0' : '-1');
        if (on) M.panels[t.id].removeAttribute('hidden');
        else M.panels[t.id].setAttribute('hidden', '');
      });
      M.active = tabId;
    }
    M.unread[tabId] = false;
    paintDot(tabId);
    if (M.dirty[tabId] || tabId !== prev) renderNow(tabId);
    if (tabId !== prev) {
      restoreScroll(tabId);
      revealTab(tabId);
      try { bus.emit('inspector:tab', { tab: tabId }); } catch (e) { /* yut */ }
    }
    if (opts.reveal) revealPanel();
  }
  /** Telefonda yatay kayan sekme satırında seçili sekmeyi görünür yap (dikey kaydırma yapmadan). */
  function revealTab(tabId) {
    var b = M.tabBtns[tabId], row = M.tabsEl;
    if (!b || !row || row.scrollWidth <= row.clientWidth + 1) return;
    var l = b.offsetLeft - 16, r = b.offsetLeft + b.offsetWidth + 16;
    var target = null;
    if (l < row.scrollLeft) target = l;
    else if (r > row.scrollLeft + row.clientWidth) target = r - row.clientWidth;
    if (target == null) return;
    try { row.scrollTo({ left: Math.max(0, target), behavior: reducedMotion() ? 'auto' : 'smooth' }); }
    catch (e) { row.scrollLeft = Math.max(0, target); }
  }
  function revealPanel() {
    if (!M.root || isDesktop()) return;
    var pane = (M.root.closest && M.root.closest('.pane')) || M.root;
    try { pane.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); } catch (e) { /* yut */ }
  }
  function selectNode(nodeId, opts) {
    opts = opts || {};
    M.selectedNode = nodeOf(nodeId) ? nodeId : null;
    M.sig.node = null;
    M.dirty.node = true;
    if (!opts.fromBus && SIM.diagram && typeof SIM.diagram.select === 'function') {
      try { SIM.diagram.select(M.selectedNode); } catch (e) { /* yut */ }
    }
    if (opts.noShow) { invalidate('node'); return; }
    show('node');
  }
  function refresh() { if (M.mounted) { M.sig[M.active] = null; renderNow(M.active); } }

  /* ---- sıfırlama ---- */
  function resetModule() {
    M.flows = {}; M.narr = []; M.kafka = []; M.decisions = []; M.decisionSel = null;
    M.profChanged = null; M.merge = null; M.segChange = null; M.lastRun = null;
    M.activeFlows = {}; M.pending = {}; M.crPending = false; M.drafts = {}; M.camMsg = {};
    M.details = {}; M.sig = {}; M.sparkHover = null; M.scroll = {}; M.busyLine = null;
    M.profSnap = undefined;
    computeProfileDiff();
    M.profSig = profileSig();
    M.campSig = campaignsSig();
    M.crSig = cleanroomSig();
    TABS.forEach(function (t) { M.unread[t.id] = false; M.dirty[t.id] = true; paintDot(t.id); });
    if (!M.mounted) return;
    M.ui = {};
    TABS.forEach(function (t) { U.clear(M.panels[t.id]); });
    paintStatus();
    renderNow(M.active);
  }

  /* ---- yetki devri (delegasyon) ---- */
  function onRootClick(ev) {
    var t = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!t || !M.root.contains(t)) return;
    var act = t.getAttribute('data-act');
    if (act === 'kfilter') { setKafkaFilter(t.getAttribute('data-topic')); return; }
    if (act === 'node') { ev.preventDefault(); try { bus.emit('node:select', { nodeId: t.getAttribute('data-node') }); } catch (e) { /* yut */ } return; }
    if (act === 'tab') { ev.preventDefault(); show(t.getAttribute('data-tab')); return; }
    if (act === 'dec-prev' || act === 'dec-next' || act === 'dec-latest') { stepDecision(act); return; }
    if (act === 'cr-run') { runCleanroom(); return; }
    if (act === 'camp-status') { toggleCampaignStatus(t); return; }
  }
  function onRootChange(ev) {
    var t = ev.target;
    if (t && t.id === 'ins-dec-select') {
      var list = decisionList();
      var lastT = last(list);
      M.decisionSel = (lastT && t.value === String(lastT.id)) ? null : t.value;
      M.sig.decision = null;
      renderNow('decision');
    }
  }

  /* ==================================================================
   * 1) AKIŞ — anlatım zaman çizelgesi (artımlı)
   * ================================================================== */
  function renderFlow() {
    var panel = M.panels.flow;
    var ui = M.ui.flow;
    if (!ui) {
      U.clear(panel);
      ui = M.ui.flow = { groups: {}, items: {}, built: false };
      ui.meta = el('span', { class: 'ins-sec-meta mono' });
      ui.head = el('div', { class: 'ins-sec-head ins-flow-head' },
        el('h3', { class: 'ins-h' }, 'Anlatım akışı'), ui.meta);
      ui.lead = note('Ziyaretçinin her aksiyonu istasyon istasyon burada listelenir; en yeni adım en üstte. Renkli şerit hattı, nokta adımın sonucunu gösterir.', 'ins-lead');
      ui.empty = empty('Henüz akış yok', 'Soldaki Gündem+ sitesinde bir şey yapın (rıza verin, haber açın): her istasyon adımı burada saatiyle görünür.');
      ui.list = el('div', { class: 'ins-tl', role: 'list', 'aria-label': 'Akış adımları, en yeni üstte' });
      appendAll(panel, [ui.head, ui.lead, ui.empty, ui.list]);
    }
    var anim = ui.built && !reducedMotion();

    // Kırpılan (en eski) adımları kaldır
    var alive = {};
    M.narr.forEach(function (e) { alive[e.id] = true; });
    keysOf(ui.items).forEach(function (id) {
      if (!alive[id]) { var n = ui.items[id]; if (n.parentNode) n.parentNode.removeChild(n); delete ui.items[id]; }
    });

    // Gruplar: akış başlangıç sırasına göre (en yeni üstte)
    var flowIds = keysOf(M.flows).sort(function (a, b) { return M.flows[a].seq - M.flows[b].seq; });
    var withEntries = {};
    M.narr.forEach(function (e) { withEntries[e.flowId || '∅'] = true; });
    flowIds.forEach(function (fid) {
      var f = M.flows[fid];
      if (withEntries[fid] || !f.ended) ensureGroup(ui, fid);
    });

    // Yeni adımlar (eskiden yeniye işlenir; her biri grubunun başına eklenir)
    M.narr.forEach(function (e) {
      if (ui.items[e.id]) return;
      var g = ensureGroup(ui, e.flowId || '∅');
      var item = flowItem(e, anim);
      g.list.insertBefore(item, g.list.firstChild);
      ui.items[e.id] = item;
      g.count++;
    });

    // Boşalan ve bitmiş grupları temizle, başlıkları güncelle
    keysOf(ui.groups).forEach(function (gid) {
      var g = ui.groups[gid];
      var f = M.flows[gid];
      g.count = g.list.children.length;
      if (!g.count && (!f || f.ended)) {
        if (g.root.parentNode) g.root.parentNode.removeChild(g.root);
        delete ui.groups[gid];
        if (f && !withEntries[gid]) delete M.flows[gid];
        return;
      }
      paintGroupHead(g, f);
    });

    var total = M.narr.length, nGroups = keysOf(ui.groups).length;
    ui.empty.hidden = total > 0 || nGroups > 0;
    ui.lead.hidden = !ui.empty.hidden;
    ui.meta.textContent = total ? fInt(total) + ' adım · ' + fInt(nGroups) + ' akış' : '';
    ui.built = true;
  }

  function ensureGroup(ui, gid) {
    if (ui.groups[gid]) return ui.groups[gid];
    var f = M.flows[gid];
    var line = f ? f.line : null;
    var g = { id: gid, count: 0 };
    g.badge = el('span', { class: 'ins-tl-badge' });
    g.title = el('span', { class: 'ins-tl-title' });
    g.meta = el('span', { class: 'ins-tl-meta mono' });
    g.state = el('span', { class: 'ins-tl-state' });
    g.head = el('div', { class: 'ins-tl-head' }, g.badge, el('span', { class: 'ins-tl-headtext' }, g.title, g.meta), g.state);
    g.list = el('ol', { class: 'ins-tl-list', reversed: true });
    g.root = el('div', { class: 'ins-tl-group', role: 'listitem', 'data-line': line || 'control', 'data-flow': gid }, g.head, g.list);
    ui.list.insertBefore(g.root, ui.list.firstChild);
    ui.groups[gid] = g;
    paintGroupHead(g, f);
    return g;
  }
  function paintGroupHead(g, f) {
    U.clear(g.badge);
    if (f && f.line) appendAll(g.badge, lineBadge(f.line, 'sm'));
    g.title.textContent = f ? f.title : 'Diğer adımlar';
    var meta = f ? f.flowId + ' · ' + fTime(f.ts) : '';
    if (f && f.parentFlowId) meta += ' · ' + f.parentFlowId + ' alt akışı';
    g.meta.textContent = meta;
    var running = f && !f.ended;
    var st = running ? 'running' : 'done';
    if (g.state.getAttribute('data-state') !== st) {
      g.state.setAttribute('data-state', st);
      U.clear(g.state);
      if (running) appendAll(g.state, [el('span', { class: 'ins-run-dot', 'aria-hidden': 'true' }), 'sürüyor']);
      else if (f) g.state.textContent = 'tamamlandı';
    }
  }
  function flowItem(e, anim) {
    var n = nodeOf(e.nodeId);
    var kindTag = null;
    if (e.kind === 'ok') kindTag = el('span', { class: 'ins-k-ok', 'aria-hidden': 'true' }, '✓');
    else if (e.kind === 'warn') kindTag = pill('warn', 'uyarı', '!');
    else if (e.kind === 'drop') kindTag = pill('bad', 'atıldı', '×');
    return el('li', { class: ['ins-tl-item', anim ? 'is-new' : null], 'data-kind': e.kind, 'data-line': e.line || null },
      el('span', { class: 'ins-tl-time mono' }, fTime(e.ts)),
      el('span', { class: 'ins-tl-rail', 'aria-hidden': 'true' }, el('span', { class: 'ins-tl-dot' })),
      el('div', { class: 'ins-tl-body' },
        el('div', { class: 'ins-tl-where' },
          e.line ? lineBadge(e.line, 'sm') : null,
          el('span', { class: 'ins-tl-node' }, n ? n.label : (e.nodeId || 'Sistem')),
          kindTag,
          el('span', { class: 'sr-only' }, ' — ' + KIND_LABEL[e.kind])),
        el('p', { class: 'ins-tl-text' }, e.text)));
  }

  /* ==================================================================
   * 2) KAFKA — mesaj listesi + konu filtresi (artımlı)
   * ================================================================== */
  function topicIds() {
    var t = D().topics || {};
    var ids = keysOf(t);
    M.kafka.forEach(function (m) { if (ids.indexOf(m.topic) < 0) ids.push(m.topic); });
    return ids;
  }
  function renderKafka() {
    var panel = M.panels.kafka;
    var ui = M.ui.kafka;
    if (!ui) {
      U.clear(panel);
      ui = M.ui.kafka = { chips: {}, items: {}, built: false, filter: null };
      ui.meta = el('span', { class: 'ins-sec-meta mono' });
      ui.chipRow = el('div', { class: 'ins-kf', role: 'group', 'aria-label': 'Konu filtresi', 'data-sk': 'kf' });
      ui.empty = empty('Henüz mesaj yok', 'Olaylar Collector ve Tracking üzerinden Kafka konularına yazıldıkça burada görünür: konu, partition, offset, anahtar ve mesaj gövdesi (EventEnvelope).');
      ui.list = el('ol', { class: 'ins-klist', reversed: true, 'aria-label': 'Kafka mesajları, en yeni üstte' });
      appendAll(panel, [
        el('div', { class: 'ins-sec-head' }, el('h3', { class: 'ins-h' }, 'Kafka mesajları'), ui.meta),
        note('Partition = anahtarın hash’i mod partition sayısı; offset konu başına artar. Gövde, 05-veri-modeli.md’deki Protobuf EventEnvelope’un JSON karşılığıdır.', 'ins-lead'),
        ui.chipRow, ui.empty, ui.list
      ]);
    }
    // Filtre çipleri
    var counts = { all: M.kafka.length };
    M.kafka.forEach(function (m) { counts[m.topic] = (counts[m.topic] || 0) + 1; });
    ['all'].concat(topicIds()).forEach(function (id) {
      var c = ui.chips[id];
      if (!c) {
        var t = topicOf(id);
        c = ui.chips[id] = { count: el('span', { class: 'chip-count mono' }, '0') };
        c.btn = el('button', {
          type: 'button', class: 'chip ins-kchip', 'data-act': 'kfilter', 'data-topic': id, 'data-fk': 'kf-' + id,
          'data-line': id === 'all' ? null : ((t && t.line) || null), 'aria-pressed': 'false'
        }, el('span', { class: id === 'all' ? null : 'mono' }, id === 'all' ? 'Tümü' : id), c.count);
        ui.chipRow.appendChild(c.btn);
      }
      c.count.textContent = fInt(counts[id] || 0);
      c.btn.setAttribute('aria-pressed', M.kafkaFilter === id ? 'true' : 'false');
    });

    if (ui.filter !== M.kafkaFilter) {
      U.clear(ui.list);
      ui.items = {};
      ui.filter = M.kafkaFilter;
      ui.built = false;
    }
    var anim = ui.built && !reducedMotion();
    var alive = {};
    M.kafka.forEach(function (m) { alive[m.id] = true; });
    keysOf(ui.items).forEach(function (id) {
      if (!alive[id]) { var n = ui.items[id]; if (n.parentNode) n.parentNode.removeChild(n); delete ui.items[id]; }
    });
    var shown = 0;
    M.kafka.forEach(function (m) {
      if (M.kafkaFilter !== 'all' && m.topic !== M.kafkaFilter) return;
      shown++;
      if (ui.items[m.id]) return;
      var item = kafkaItem(m, anim);
      ui.list.insertBefore(item, ui.list.firstChild);
      ui.items[m.id] = item;
    });
    ui.empty.hidden = shown > 0;
    if (!shown && M.kafka.length) {
      ui.empty.querySelector('.ins-empty-title').textContent = 'Bu konuda mesaj yok';
    } else {
      ui.empty.querySelector('.ins-empty-title').textContent = 'Henüz mesaj yok';
    }
    ui.meta.textContent = M.kafka.length ? fInt(M.kafka.length) + ' mesaj' + (M.kafka.length >= MAX_KAFKA ? ' (son ' + MAX_KAFKA + ')' : '') : '';
    ui.built = true;
  }
  function setKafkaFilter(id) {
    M.kafkaFilter = id && id !== M.kafkaFilter ? id : 'all';
    renderNow('kafka');
  }
  function kafkaSummary(v) {
    if (!v || typeof v !== 'object') return { type: null, meta: typeof v };
    var t = v.event_type || (v.op ? 'CDC op=' + v.op : null) || v.type || v.link_type || null;
    var keys = keysOf(v).length;
    var size = safe(function () { return JSON.stringify(v).length; }, 0);
    var kb = size >= 1024 ? fNum(size / 1024, 1) + ' KB' : fInt(size) + ' B';
    return { type: t, meta: keys + ' alan · ' + kb };
  }
  function kafkaItem(m, anim) {
    var key = 'k:' + m.topic + ':' + m.offset;
    var sum = kafkaSummary(m.value);
    var d = el('details', { class: 'ins-details ins-kval', 'data-dk': key, open: !!M.details[key] },
      el('summary', { class: 'ins-summary' },
        el('span', { class: 'ins-sum-label' }, 'value'),
        sum.type ? el('span', { class: 'ins-kt mono' }, sum.type) : null,
        el('span', { class: 'ins-sum-meta mono' }, sum.meta)));
    d._msg = m;
    if (d.open) buildKafkaValue(d);
    return el('li', { class: ['ins-kmsg', anim ? 'is-new' : null], 'data-line': m.line || null },
      el('div', { class: 'ins-kmsg-head' },
        el('span', { class: 'ins-topic mono', 'data-line': m.line || null }, m.topic),
        el('span', { class: 'ins-kpos mono' }, 'p' + m.partition + ' · ' + fInt(m.offset)),
        el('span', { class: 'ins-ktime mono' }, fTime(m.ts))),
      el('div', { class: 'ins-kkey' }, el('span', { class: 'ins-kkey-k' }, 'anahtar'), el('code', { class: 'mono' }, String(m.key == null ? 'null' : m.key))),
      d);
  }
  function buildKafkaValue(d) {
    if (d._built || !d._msg) return;
    d._built = true;
    d.appendChild(jsonView(d._msg.value, { cls: 'ins-json-k' }));
  }

  /* ==================================================================
   * 3) PROFİL — Aerospike kaydı, idmap, kimlik grafiği, segmentler
   * ================================================================== */
  function renderProfile() {
    var s = S();
    var sig = JSON.stringify([
      profileSig(), M.profChanged && M.profChanged.at, M.merge && M.merge.at, M.segChange && M.segChange.at,
      s ? s.idmap : null, (function () { var c = currentProfile(); return c ? c.prof : null; })(),
      s ? s.dsar : null, s && s.suppression ? s.suppression.length : 0
    ]);
    if (sig === M.sig.profile) return;
    M.sig.profile = sig;
    rebuildPanel('profile', buildProfile());
  }
  function buildProfile() {
    var s = S();
    if (!s) return [empty('Durum yükleniyor', 'Motor başlatılıyor; ilk durum gelince profil burada görünür.')];
    var d = D();
    var user = s.user || {}, consent = s.consent || {};
    var cur = currentProfile();
    var prof = cur ? cur.prof : null;
    var pid = cur ? cur.pid : null;
    var tnow = nowSim();
    var segs = prof ? keysOf(prof.seg).filter(function (k) { return num(prof.seg[k]) > tnow; }).map(Number).sort(function (a, b) { return a - b; }) : [];
    var out = [];

    out.push(sumStrip([
      { k: 'Kişi (person_id)', v: pid || '—', mono: true, sub: pid ? 'Aerospike dmp/profile' : 'profil yok' },
      { k: 'Rıza', v: consentLabel(consent.status), sub: consent.kvkkExplicit ? 'KVKK açık rıza ✓' : 'açık rıza yok' },
      { k: 'Kimlik', v: prof ? fInt(keysOf(prof.ids).length) : '0', sub: prof ? keysOf(prof.ids).map(function (k) { return k.split(':')[0]; }).join(' · ') : '—' },
      { k: 'Segment', v: fInt(segs.length), sub: prof ? 'sürüm v' + num(prof.ver, 1) : '—' }
    ]));

    var dsar = last(s.dsar || []);
    if (dsar) out.push(dsarCard(dsar, s));

    if (!prof) {
      out.push(profileEmpty(s));
      out.push(idmapSection(s, null));
      return out;
    }

    var fresh = freshOf(M.profChanged) ? M.profChanged.paths : null;
    var segFresh = M.segChange && M.segChange.personId === pid && freshOf(M.segChange) ? M.segChange.added : [];

    // Segmentler
    var segKids = segs.length ? el('ul', { class: 'ins-segs' }, segs.map(function (id) {
      var sg = segOf(id) || { name: 'Segment ' + id, kind: 'realtime', line: 'dmp' };
      var cr = sg.kind === 'clean_room' || sg.exportable === false;
      return el('li', { class: ['ins-seg', (segFresh.indexOf(id) >= 0 || (fresh && fresh['seg.' + id])) ? 'is-changed' : null], 'data-line': cr ? 'cleanroom' : (sg.line || 'dmp') },
        el('span', { class: 'ins-seg-name' }, sg.name),
        el('span', { class: 'ins-seg-meta' },
          el('span', { class: 'mono' }, String(id)), ' · ', LBL('segmentKind', sg.kind, sg.kind), ' · bitiş ', el('span', { class: 'num' }, fDate(prof.seg[id]))),
        cr ? pill('line', 'dışa aktarılamaz', null, { 'data-line': 'cleanroom', class: 'ins-seg-tag' }) : null);
    })) : note('Henüz segment üyeliği yok. Gerçek zamanlı kurallar her olayda Flink’te değerlendirilir (ör. 7 günde ≥ 2 otomobil içeriği → 1001).');
    out.push(section('ins-sec-segs', 'Segment üyelikleri', segs.length ? fInt(segs.length) + ' aktif' : null, [segKids, countersBlock(prof)]));

    // Kimlik grafiği
    var mergeHere = M.merge && M.merge.into === pid ? M.merge : null;
    out.push(section('ins-sec-idg', 'Kimlik grafiği', keysOf(prof.ids).length + ' kimlik → ' + pid, [
      idGraph(prof, pid, mergeHere),
      mergeHere ? note('Son birleştirme ' + fTime(mergeHere.simAt) + ': ' + mergeHere.from + ' → ' + mergeHere.into +
        (mergeHere.moved.length ? ' · taşınan: ' + mergeHere.moved.map(function (k) { return k.split(':')[0]; }).join(', ') : '') +
        '. idmap artık tüm kimlikleri ' + mergeHere.into + '’ye yönlendiriyor.', 'ins-caption') : null
    ]));

    // Aerospike kaydı
    var bins = profileBins(prof);
    out.push(section('ins-sec-rec', 'Aerospike kaydı', null, [
      el('div', { class: 'ins-reckey' },
        el('span', { class: 'ins-reckey-part' }, el('span', { class: 'ins-reckey-k' }, 'namespace'), el('code', { class: 'mono' }, 'dmp')),
        el('span', { class: 'ins-reckey-part' }, el('span', { class: 'ins-reckey-k' }, 'set'), el('code', { class: 'mono' }, 'profile')),
        el('span', { class: 'ins-reckey-part' }, el('span', { class: 'ins-reckey-k' }, 'key'), el('code', { class: 'mono' }, (d.tenantId || 42) + ':' + pid)),
        el('span', { class: 'ins-reckey-part' }, el('span', { class: 'ins-reckey-k' }, 'TTL'), el('span', null, '180 gün inaktivite'))),
      detailsEl('prof-json', true, [el('span', { class: 'ins-sum-label' }, 'bins'), el('span', { class: 'ins-sum-meta mono' }, keysOf(bins).length + ' bin · v' + num(prof.ver, 1)),
        fresh ? el('span', { class: 'ins-fresh' }, el('span', { class: 'ins-fresh-dot', 'aria-hidden': 'true' }), keysOf(fresh).length + ' alan değişti') : null],
        jsonView(bins, { changed: fresh, keyLabel: idKeyLabel, annotate: profAnnotate }))
    ]));

    out.push(idmapSection(s, pid));
    return out;
  }
  function idKeyLabel(k) {
    var i = k.indexOf(':');
    if (i < 0) return k;
    var v = k.slice(i + 1);
    return /^[0-9a-f]{40,}$/i.test(v) ? k.slice(0, i) + ':' + shortH(v) : k;
  }
  function profAnnotate(path, key, v) {
    var parts = String(path).split('.');
    if (parts[0] === 'seg' && typeof v === 'number') {
      var sg = segOf(parts[1]);
      return (sg ? sg.name + ' · ' : '') + 'bitiş ' + fDate(v);
    }
    if (path === 'consent.purposes' && typeof v === 'number') return v === 1023 ? 'tüm amaçlar' : 'amaç bitmask';
    if (parts[0] === 'fcap' && parts[2] === 'count') { var li = liOf(parts[1]); return li && li.fcap ? 'LI ' + parts[1] + ' · sınır ' + li.fcap.max + ' / ' + li.fcap.windowH + ' sa' : null; }
    if (typeof v === 'number' && v > 1e12 && v < 1e13) return tsShort(v);
    return null;
  }
  function countersBlock(prof) {
    var c = prof && prof.counters;
    var ks = keysOf(c).filter(function (k) { return Array.isArray(c[k]) && c[k].length; });
    if (!ks.length) return null;
    return el('div', { class: 'ins-counters' },
      el('p', { class: 'ins-caption' }, 'Kural sayaçları (Flink keyed state) — segment kurallarının girdisi:'),
      el('ul', { class: 'ins-ctr-list' }, ks.map(function (k) {
        var arr = c[k];
        return el('li', { class: 'ins-ctr' },
          el('span', { class: 'ins-ctr-k' }, ctxLabel(k)),
          el('span', { class: 'ins-ctr-v num' }, fInt(arr.length) + ' olay'),
          el('span', { class: 'ins-ctr-s mono' }, 'son ' + tsShort(last(arr))));
      })));
  }
  function profileEmpty(s) {
    var c = s.consent || {}, u = s.user || {};
    var dsar = last(s.dsar || []);
    var sup = (s.suppression || []).length;
    if (u.suppressed || (dsar && dsar.status === 'done')) {
      return empty('DSAR ile silindi', 'Profil, idmap kayıtları, segment üyelikleri ve fcap sayaçları silindi. Hash’li kimlikler (' + fInt(sup) +
        ' kayıt) suppression listesinde: bu tarayıcı eski çerezle yeniden olay gönderse bile profil oluşturulmaz.', 'privacy');
    }
    if (!c.status || c.status === 'unknown') {
      return empty('Rıza yok', 'Ziyaretçi henüz rıza kararı vermedi. KVKK gereği bu sırada yalnızca zorunlu işleme yapılır: davranış olayı toplanmaz, 1. parti çerez (fpc) yazılmaz, profil oluşmaz; reklamlar kimliksiz ve kontekstüel gider.', 'warn');
    }
    if (c.status === 'necessary' || c.status === 'reject') {
      return empty('Profilleme rızası yok', '“' + consentLabel(c.status) + '” seçildi. Olaylar kimliksiz işlenir ve yalnızca agrega analitiğe (Iceberg) gider; kişi profili ve segment üyeliği oluşmaz, reklamlar kontekstüeldir.', 'warn');
    }
    return empty('Henüz olay yok', 'Rıza verildi' + (u.fpc ? ' ve 1. parti çerez yazıldı (fpc ' + u.fpc + ')' : '') +
      '. İlk sayfa görüntülemesinde Flink fpc’yi Identity Graph’ta çözümler ve Aerospike’ta profil oluşur.', 'info');
  }
  function dsarCard(rec, s) {
    var stores = rec.stores || {};
    var doneN = keysOf(stores).filter(function (k) { return stores[k] === 'done'; }).length;
    var total = keysOf(stores).length;
    var done = rec.status === 'done';
    return el('div', { class: 'card ins-dsar', 'data-line': 'privacy' },
      el('div', { class: 'ins-card-head' },
        el('span', { class: 'eyebrow' }, 'Silme talebi · KVKK m.11'),
        done ? pill('ok', 'tamamlandı', '✓') : pill('warn', 'sürüyor ' + doneN + '/' + total, null)),
      el('p', { class: 'ins-dsar-id mono' }, rec.id + ' · ' + fTime(rec.at) + (rec.personId ? ' · ' + rec.personId : '')),
      el('ul', { class: 'ins-stores' }, keysOf(stores).map(function (k) {
        var ok = stores[k] === 'done';
        return el('li', { class: 'ins-store', 'data-state': ok ? 'done' : 'pending' },
          el('span', { class: 'ins-store-k' }, STORE_LABEL[k] || k),
          ok ? pill('ok', 'silindi', '✓') : pill('muted', 'bekliyor', '…'));
      })),
      el('p', { class: 'ins-caption' }, 'Suppression listesi: ' + fInt((s.suppression || []).length) + ' hash — kişi geri dönse bile yeniden profillenmez.'));
  }
  function idmapSection(s, pid) {
    var idmap = s.idmap || {};
    var ks = keysOf(idmap);
    if (!ks.length) {
      var gone = (s.dsar || []).some(function (d) { return d.stores && d.stores.idmap === 'done'; });
      return section('ins-sec-idmap', 'idmap', 'dmp/idmap', note(gone ? 'idmap boş: ziyaretçinin kimlik kayıtları DSAR ile silindi.' : 'idmap boş: henüz çözümlenmiş kimlik yok.'));
    }
    ks.sort(function (a, b) {
      var ma = idmap[a] === pid ? 0 : 1, mb = idmap[b] === pid ? 0 : 1;
      if (ma !== mb) return ma - mb;
      var ta = ID_ORDER[a.split(':')[0]], tb = ID_ORDER[b.split(':')[0]];
      return num(ta, 9) - num(tb, 9);
    });
    var tenant = D().tenantId || 42;
    var rows = ks.map(function (k) {
      var i = k.indexOf(':');
      var type = i > 0 ? k.slice(0, i) : k, val = i > 0 ? k.slice(i + 1) : '';
      var mine = idmap[k] === pid && pid;
      return el('tr', { class: mine ? 'is-mine' : null },
        el('td', null,
          el('span', { class: 'ins-idtype' }, type),
          el('span', { class: 'ins-idval mono', title: val }, /^[0-9a-f]{40,}$/i.test(val) ? shortH(val) : val),
          el('span', { class: 'ins-idsub' }, LBL('idType', type, ''))),
        el('td', { class: 'ins-idarrow', 'aria-hidden': 'true' }, '→'),
        el('td', null, el('span', { class: 'mono' }, idmap[k]), mine ? el('span', { class: 'ins-you' }, 'ziyaretçi') : null));
    });
    return section('ins-sec-idmap', 'idmap', 'dmp/idmap · key ' + tenant + ':tür:değer', [
      el('div', { class: 'table-wrap', 'data-sk': 'idmap' },
        el('table', { class: 'table ins-table ins-idmap' },
          el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Kimlik'), el('th', { scope: 'col' }, el('span', { class: 'sr-only' }, 'yön')), el('th', { scope: 'col' }, 'person_id'))),
          el('tbody', null, rows))),
      note('Ad server istek başına en fazla iki tek anahtarlı okuma yapar: idmap (kimlik → kişi) ve profile.', 'ins-caption')
    ]);
  }

  /** Kimlik grafiği: sol tarafta kişi (aktarma istasyonu), sağda kimlikler (duraklar), metro kırılımlı bağlar. */
  function idGraph(prof, pid, merge) {
    var ids = keysOf(prof.ids).sort(function (a, b) {
      var ta = num(ID_ORDER[a.split(':')[0]], 9), tb = num(ID_ORDER[b.split(':')[0]], 9);
      return (ta - tb) || (num(prof.ids[a]) - num(prof.ids[b]));
    });
    var n = Math.max(1, ids.length);
    var ROW = 40;
    var H = Math.max(124, (n - 1) * ROW + 68);
    var W = 340;
    var cy = H / 2;
    var top = cy - (n - 1) * ROW / 2;
    var capX = 8, capW = 84, capH = 30;
    var trunkX = 114, nodeX = 142;
    var animate = false, elapsed = 0;
    if (merge && !reducedMotion()) {
      if (merge.shownAt == null && perf() - merge.at < 20000) merge.shownAt = perf();
      if (merge.shownAt != null) { elapsed = perf() - merge.shownAt; animate = elapsed < MERGE_ANIM_MS; }
    }
    var moved = {};
    (merge ? merge.moved : []).forEach(function (k) { moved[k] = true; });
    var label = 'Kimlik grafiği: ' + pid + ' kişisine bağlı ' + ids.length + ' kimlik (' + ids.map(function (k) { return k.split(':')[0]; }).join(', ') + ')';
    var svg = sv('svg', { class: 'ins-idg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': label, style: { 'max-height': H * 1.25 + 'px' } });
    var gEdges = sv('g', { class: 'ins-idg-edges' });
    var gNodes = sv('g', { class: 'ins-idg-nodes' });
    var anims = [];
    ids.forEach(function (k, i) {
      var y = top + i * ROW;
      var dy = y - cy;
      var r = Math.min(9, Math.abs(dy) / 2);
      var dPath;
      if (Math.abs(dy) < 0.5) dPath = 'M' + (capX + capW) + ' ' + cy + ' H' + (nodeX - 7);
      else {
        var sgn = dy > 0 ? 1 : -1;
        dPath = 'M' + (capX + capW) + ' ' + cy + ' H' + (trunkX - r) + ' Q' + trunkX + ' ' + cy + ' ' + trunkX + ' ' + (cy + sgn * r) +
          ' V' + (y - sgn * r) + ' Q' + trunkX + ' ' + y + ' ' + (trunkX + r) + ' ' + y + ' H' + (nodeX - 7);
      }
      var i2 = k.indexOf(':');
      var type = k.slice(0, i2), val = k.slice(i2 + 1);
      var shown = /^[0-9a-f]{40,}$/i.test(val) ? shortH(val) : (val.length > 18 ? val.slice(0, 8) + '…' + val.slice(-6) : val);
      var edge = sv('path', { d: dPath, class: 'ins-idg-edge' });
      gEdges.appendChild(edge);
      var g = sv('g', { class: ['ins-idg-id', moved[k] ? 'is-moved' : null] },
        sv('circle', { cx: nodeX, cy: y, r: 6.5, class: 'ins-idg-dot' }),
        sv('text', { x: nodeX + 14, y: y - 3, class: 'ins-idg-type' }, type,
          sv('tspan', { class: 'ins-idg-typesub', dx: 6 }, LBL('idType', type, ''))),
        sv('text', { x: nodeX + 14, y: y + 12, class: 'ins-idg-val' }, shown));
      gNodes.appendChild(g);
      if (animate && moved[k]) anims.push({ g: g, edge: edge, i: anims.length });
    });
    var cap = sv('g', { class: 'ins-idg-person' },
      sv('rect', { x: capX, y: cy - capH / 2, width: capW, height: capH, rx: capH / 2, class: 'ins-idg-cap' }),
      sv('text', { x: capX + capW / 2, y: cy + 4.5, 'text-anchor': 'middle', class: 'ins-idg-pid' }, pid));
    svg.appendChild(gEdges);
    var ghost = null;
    if (animate) {
      ghost = sv('g', { class: 'ins-idg-ghost' },
        sv('rect', { x: capX, y: cy - capH / 2, width: capW, height: capH, rx: capH / 2 }),
        sv('text', { x: capX + capW / 2, y: cy + 4.5, 'text-anchor': 'middle' }, merge.from || ''));
      svg.appendChild(ghost);
    }
    svg.appendChild(cap);
    svg.appendChild(gNodes);
    if (animate) {
      var offY = Math.min(46, H / 2 - 4);
      // Animasyonlar DOM'a eklendikten sonra başlatılır; yeniden çizimde kaldığı yerden sürer.
      raf(function () {
        try {
          var g1 = ghost.animate([
            { transform: 'translate(0px, ' + offY + 'px)', opacity: 1 },
            { transform: 'translate(0px, ' + offY + 'px)', opacity: 1, offset: 0.25 },
            { transform: 'translate(0px, 0px)', opacity: 0 }
          ], { duration: MERGE_ANIM_MS, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'both' });
          g1.currentTime = elapsed;
          anims.forEach(function (a) {
            var an = a.g.animate([
              { transform: 'translate(-110px, ' + (offY * 0.6) + 'px)', opacity: 0 },
              { transform: 'translate(-110px, ' + (offY * 0.6) + 'px)', opacity: 0, offset: 0.3 },
              { transform: 'translate(0px, 0px)', opacity: 1 }
            ], { duration: MERGE_ANIM_MS, delay: a.i * 90, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'both' });
            an.currentTime = elapsed;
            var len = safe(function () { return a.edge.getTotalLength(); }, 200);
            var ae = a.edge.animate([
              { strokeDasharray: len + ' ' + len, strokeDashoffset: len },
              { strokeDasharray: len + ' ' + len, strokeDashoffset: len, offset: 0.45 },
              { strokeDasharray: len + ' ' + len, strokeDashoffset: 0 }
            ], { duration: MERGE_ANIM_MS, delay: a.i * 90, easing: 'ease-out', fill: 'backwards' });
            ae.currentTime = elapsed;
          });
        } catch (e) { /* WAAPI yoksa statik kalır */ }
      });
      setTimeout(function () { M.sig.profile = null; invalidate('profile'); }, Math.max(60, MERGE_ANIM_MS - elapsed + 120));
    }
    return el('div', { class: 'ins-idg-wrap' }, svg);
  }

  /* ==================================================================
   * 4) REKLAM KARARI — iz (trace)
   * ================================================================== */
  function renderDecision() {
    var list = decisionList();
    var sig = [list.length, list.length ? last(list).id : '', M.decisionSel].join('|');
    if (sig === M.sig.decision) return;
    M.sig.decision = sig;
    rebuildPanel('decision', buildDecision(list));
  }
  function selectedTrace(list) {
    if (!list.length) return null;
    if (M.decisionSel != null) {
      for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(M.decisionSel)) return list[i];
      M.decisionSel = null;
    }
    return last(list);
  }
  function stepDecision(act) {
    var list = decisionList();
    if (!list.length) return;
    var tr = selectedTrace(list);
    var i = list.indexOf(tr);
    if (act === 'dec-latest') M.decisionSel = null;
    else if (act === 'dec-prev' && i > 0) M.decisionSel = String(list[i - 1].id);
    else if (act === 'dec-next' && i < list.length - 1) M.decisionSel = i + 1 === list.length - 1 ? null : String(list[i + 1].id);
    M.sig.decision = null;
    renderNow('decision');
  }
  function buildDecision(list) {
    if (!list.length) {
      return [empty('Henüz reklam kararı yok', 'Bir makale açın (ör. “Otomobil haberi oku”): reklam isteği Ad API’den Karar Motoru’na gider; adaylar, header bidding teklifleri, açık artırma ve gecikme şelalesi burada görünür.')];
    }
    var tr = selectedTrace(list);
    var idx = list.indexOf(tr);
    var following = M.decisionSel == null;
    var out = [];

    // Seçici
    var opts = list.slice().reverse().map(function (t) {
      var n = list.indexOf(t) + 1;
      return el('option', { value: String(t.id), selected: t === tr },
        fTime(t.at) + ' · ' + ((t.slot && t.slot.id) || 'slot') + ' → ' + winnerName(t));
    });
    out.push(el('div', { class: 'ins-dec-nav' },
      el('label', { class: 'sr-only', for: 'ins-dec-select' }, 'Karar seç'),
      el('select', { class: 'select ins-dec-select', id: 'ins-dec-select' }, opts),
      el('span', { class: 'ins-dec-pos num' }, 'Karar ' + (idx + 1) + ' / ' + list.length),
      el('div', { class: 'btn-group ins-dec-step' },
        el('button', { type: 'button', class: 'btn btn-sm', 'data-act': 'dec-prev', 'data-fk': 'dec-prev', disabled: idx <= 0, 'aria-label': 'Önceki karar', title: 'Önceki karar' }, '‹'),
        el('button', { type: 'button', class: 'btn btn-sm', 'data-act': 'dec-next', 'data-fk': 'dec-next', disabled: idx >= list.length - 1, 'aria-label': 'Sonraki karar', title: 'Sonraki karar' }, '›')),
      following ? el('span', { class: 'ins-follow' }, el('span', { class: 'ins-run-dot', 'aria-hidden': 'true' }), 'son karar')
        : el('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'data-act': 'dec-latest', 'data-fk': 'dec-latest' }, 'Son karara git')));

    var slot = tr.slot || {};
    var ctx = tr.context || {};
    out.push(sumStrip([
      { k: 'Slot', v: (slot.id || '—') + ' · ' + (slot.size || ''), sub: 'floor ' + fTL(slot.floorCpm) },
      { k: 'Bağlam', v: ctx.label || ctxLabel(ctx.category), sub: ctx.path || '' },
      { k: 'Kişiselleştirme', v: tr.personalized ? 'açık' : 'kapalı', sub: tr.personalized ? 'kimlikli · ' + (tr.personId || '') : (tr.consentStatus === 'unknown' ? 'rıza yok · kontekstüel' : 'kimliksiz · kontekstüel'), cls: tr.personalized ? 'is-on' : 'is-off' },
      { k: 'Sunucu içi', v: fMs(tr.serverMs), sub: 'toplam ' + fMs(tr.totalMs) }
    ]));
    out.push(note('First-price açık artırma: kazanan teklif ettiği fiyatı öder. Floor (' + fTL(slot.floorCpm) +
      ') altındaki aday ve teklifler elenir; direct adaylar eCPM, programatik teklifler CPM ile aynı açık artırmada yarışır.', 'ins-explain'));

    out.push(winnerCard(tr));
    out.push(candidatesSection(tr));
    out.push(biddersSection(tr));
    out.push(waterfallSection(tr));
    return out;
  }

  function winnerCard(tr) {
    var w = tr.winner || {};
    var src = LBL('winnerSource', w.source, w.source);
    var li = w.lineItemId != null ? liOf(w.lineItemId) : null;
    var bd = w.source === 'prebid' ? bidderOf(w.bidder) : null;
    var cand = null;
    (tr.candidates || []).forEach(function (c) { if (c.status === 'won') cand = c; });
    var cr = tr.creative || (li && li.creative) || (bd && bd.creative) || {};
    var ru = tr.runnerUp;
    var priceLabel = w.source === 'house' ? 'faturalanmaz' : (li && li.pricing && li.pricing !== 'CPM' ? 'eCPM (' + li.pricing + ' → 1.000 gösterim başı)' : 'ödenen CPM (first-price)');
    return el('div', { class: 'card ins-win', 'data-line': 'ad', 'data-source': w.source || 'house' },
      el('div', { class: 'ins-card-head' },
        el('span', { class: 'eyebrow' }, 'Kazanan · ' + src + (bd ? ' · ' + bd.name : '')),
        w.source === 'house' ? pill('muted', 'doldurma', null) : pill('ok', 'kazandı', '✓')),
      el('div', { class: 'ins-win-main' },
        el('div', { class: 'ins-win-name' },
          el('span', { class: 'ins-win-title' }, li ? li.name : (bd ? (cr.brand || bd.name) : 'House')),
          el('span', { class: 'ins-win-sub' }, li ? li.advertiser + ' · ' + LBL('lineItemType', li.type, li.type) : (bd ? 'Prebid Server · ' + (cr.adomain || '') : (D().site ? D().site.name : '')))),
        el('div', { class: 'ins-win-price' },
          el('span', { class: 'ins-win-v' }, fTL(w.priceCpm)),
          el('span', { class: 'ins-win-k' }, priceLabel))),
      el('dl', { class: 'kv ins-win-kv' },
        el('dt', 'Neden'), el('dd', null, w.reason || '—'),
        cand && cand.shadow ? [el('dt', 'Gölge fiyat'), el('dd', null, 'eCPM ' + fTL(cand.ecpm) + ' = ' + fTL(cand.rate) + ' × (1 + teslimat açığı ' + fPct(cand.deficit || 0, 1) + ')')] : null,
        ru ? [el('dt', 'En yakın rakip'), el('dd', null, (ru.name || ru.bidder || ('LI ' + ru.lineItemId)) + ' · ' + fTL(ru.ecpm) + ' (fark ' + fTL(num(w.ecpm) - num(ru.ecpm)) + ')')] : null,
        cr.headline ? [el('dt', 'Kreatif'), el('dd', null, '“' + cr.headline + '”' + (cr.brand ? ' — ' + cr.brand : ''))] : null));
  }

  function formulaParts(c) {
    var p = [];
    var rate = fTL(c.rate);
    if (c.pricing === 'CPC') p.push(rate + ' × pCTR ' + fPct(c.pCtr, 2) + ' × 1.000');
    else if (c.pricing === 'CPA') p.push(rate + ' × pCTR ' + fPct(c.pCtr, 2) + ' × pCVR ' + fPct(c.pCvr, 1) + ' × 1.000');
    else {
      p.push('CPM ' + rate + (c.shadow ? (num(c.deficit) > 0 ? ' × (1 + ' + fPct(c.deficit, 1) + ')' : ' · teslimat açığı yok') : ''));
      p.push('pCTR ' + fPct(c.pCtr, 2));
    }
    return p;
  }
  function statusPill(st, kind) {
    if (st === 'won') return pill('ok', kind === 'bid' ? LBL('bidStatus', 'won', 'kazandı') : LBL('candidateStatus', 'won', 'kazandı'), '✓');
    if (st === 'filtered') return pill('warn', LBL('candidateStatus', 'filtered', 'elendi'), '−');
    if (st === 'timeout') return pill('bad', LBL('bidStatus', 'timeout', 'zaman aşımı'), '×');
    if (st === 'nobid') return pill('muted', LBL('bidStatus', 'nobid', 'teklif yok'), '–');
    return pill('muted', LBL('candidateStatus', 'lost', 'kaybetti'), null);
  }
  function candidatesSection(tr) {
    var cands = tr.candidates || [];
    var rows = cands.map(function (c) {
      return el('tr', { class: 'is-' + c.status, 'data-status': c.status },
        el('td', { class: 'ins-c-li' },
          el('span', { class: 'ins-c-name' }, c.name || ('LI ' + c.lineItemId)),
          el('span', { class: 'ins-c-id mono' }, String(c.lineItemId)),
          el('span', { class: 'ins-c-sub' }, LBL('lineItemType', c.type, c.type) + ' · ' + c.pricing),
          el('span', { class: 'ins-c-formula mono' }, formulaParts(c).join(' · '))),
        el('td', { class: 'num ins-c-ecpm' },
          el('span', { class: 'ins-ecpm' }, fTL(c.ecpm)),
          c.shadow ? el('span', { class: 'ins-shadow', title: 'Garantili kampanya: teslimat açığına göre yükseltilmiş gölge fiyat' }, el('span', { 'aria-hidden': 'true' }, '◆ '), 'gölge') : null),
        el('td', { class: 'ins-c-st' }, statusPill(c.status), el('span', { class: 'ins-reason' }, c.reason || '')));
    });
    var won = cands.filter(function (c) { return c.status === 'won'; }).length;
    var filt = cands.filter(function (c) { return c.status === 'filtered'; }).length;
    return section('ins-sec-cands', 'Direct adaylar', fInt(cands.length) + ' aday · ' + fInt(filt) + ' elendi' + (won ? ' · 1 kazandı' : ''), [
      el('div', { class: 'table-wrap', 'data-sk': 'cands' },
        el('table', { class: 'table ins-table ins-cands' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col' }, 'Line item · fiyatlama'),
            el('th', { scope: 'col', class: 'num' }, 'eCPM'),
            el('th', { scope: 'col' }, 'Durum · neden'))),
          el('tbody', null, rows))),
      note('eCPM = CPM: fiyat · CPC: fiyat × pCTR × 1.000 · CPA: fiyat × pCTR × pCVR × 1.000. Segment eşleşmesinde pCTR × 1,6. ◆ gölge: garantili kampanya teslimat açığı kadar yükseltilir.', 'ins-caption')
    ]);
  }
  function biddersSection(tr) {
    var bids = tr.bids || [];
    var timeout = num(tr.timeoutMs, num(D().bidderTimeoutMs, 120));
    var maxLat = 0;
    bids.forEach(function (b) { maxLat = Math.max(maxLat, num(b.latencyMs)); });
    var domain = Math.max(timeout * 1.6, maxLat * 1.06, 1);
    var tPct = pct(timeout / domain);
    var rows = bids.map(function (b) {
      var bd = bidderOf(b.bidder);
      var late = num(b.latencyMs) > timeout;
      return el('tr', { class: 'is-' + b.status, 'data-status': b.status },
        el('td', { class: 'ins-b-name' },
          el('span', { class: 'ins-c-name' }, b.name || (bd && bd.name) || b.bidder),
          el('span', { class: 'ins-c-sub' }, b.withIds ? 'kimlikli' + (bd ? ' · ×' + fNum(bd.idBoost, 1, 1) : '') : 'kimliksiz')),
        el('td', { class: 'num ins-b-cpm' },
          b.cpm != null ? el('span', { class: 'ins-ecpm' }, fTL(b.cpm)) : el('span', { class: 'ins-dash', 'aria-label': 'teklif yok' }, '—')),
        el('td', { class: 'ins-b-lat' },
          el('div', { class: 'ins-lat', style: { '--t': tPct } },
            el('div', { class: 'ins-lat-track', 'aria-hidden': 'true' },
              el('span', { class: ['ins-lat-bar', late ? 'is-late' : null], style: { width: pct(num(b.latencyMs) / domain) } }),
              el('span', { class: 'ins-lat-limit' })),
            el('span', { class: 'ins-lat-v num' }, fInt(b.latencyMs) + ' ms'))),
        el('td', { class: 'ins-c-st' }, statusPill(b.status, 'bid'),
          b.status === 'timeout' && b.lateCpm != null ? el('span', { class: 'ins-reason' }, 'geç teklif ' + fTL(b.lateCpm) + ' elendi')
            : (b.reason && b.status !== 'nobid' && b.status !== 'timeout' ? el('span', { class: 'ins-reason' }, b.reason) : null)));
    });
    var to = bids.filter(function (b) { return b.status === 'timeout'; }).length;
    return section('ins-sec-bids', 'Header bidding teklifleri', fInt(bids.length) + ' teklifçi' + (to ? ' · ' + to + ' zaman aşımı' : ''), [
      el('div', { class: 'table-wrap', 'data-sk': 'bids' },
        el('table', { class: 'table ins-table ins-bids' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col' }, 'Teklifçi'),
            el('th', { scope: 'col', class: 'num' }, 'CPM'),
            el('th', { scope: 'col', class: 'ins-b-lath' }, el('span', null, 'Gecikme'), el('span', { class: 'ins-lat-legend' }, el('span', { class: 'ins-lat-key', 'aria-hidden': 'true' }), fInt(timeout) + ' ms sınır')),
            el('th', { scope: 'col' }, 'Durum'))),
          el('tbody', null, rows))),
      note('Prebid Server teklifleri paralel toplar; ' + fInt(timeout) + ' ms’yi aşan teklif açık artırmaya giremez. Kimlikli istekte (rıza + 1P kimlik) teklifler idBoost katsayısıyla yükselir.', 'ins-caption')
    ]);
  }
  function niceStep(max) {
    if (max <= 1.5) return 0.25;
    if (max <= 3) return 0.5;
    if (max <= 7) return 1;
    if (max <= 14) return 2;
    return 5;
  }
  function waterfallSection(tr) {
    var steps = tr.timings || [];
    var serial = steps.filter(function (t) { return !t.parallel; });
    var server = num(tr.serverMs) || serial.reduce(function (a, t) { return a + num(t.ms); }, 0);
    var par = steps.filter(function (t) { return t.parallel; })[0];
    var hb = par ? num(par.ms) : num(tr.headerBiddingMs);
    var total = num(tr.totalMs) || server + hb;
    var dom = Math.max(server, 0.01);
    var step = niceStep(dom);
    var ticks = [];
    for (var v = 0; v <= dom + 1e-9; v += step) ticks.push(v);
    var cum = 0;
    var rows = steps.map(function (t) {
      if (t.parallel) {
        return el('li', { class: 'ins-wf-row is-parallel' },
          el('span', { class: 'ins-wf-k' }, t.step),
          el('span', { class: 'ins-wf-track', 'aria-hidden': 'true' }, el('span', { class: 'ins-wf-bar is-par' }), el('span', { class: 'ins-wf-break' })),
          el('span', { class: 'ins-wf-v num' }, fMs(t.ms)));
      }
      var ms = num(t.ms);
      var left = cum / dom, w = ms / dom;
      cum += ms;
      if (t.skipped || ms <= 0) {
        return el('li', { class: 'ins-wf-row is-skipped' },
          el('span', { class: 'ins-wf-k' }, t.step),
          el('span', { class: 'ins-wf-track ins-wf-skip' }, t.note ? 'atlandı · ' + t.note : 'atlandı'),
          el('span', { class: 'ins-wf-v num' }, '—'));
      }
      return el('li', { class: 'ins-wf-row' },
        el('span', { class: 'ins-wf-k' }, t.step),
        el('span', { class: 'ins-wf-track', 'aria-hidden': 'true' },
          el('span', { class: 'ins-wf-bar', style: { left: pct(left), width: 'max(3px, ' + pct(w) + ')' } })),
        el('span', { class: 'ins-wf-v num' }, fMs(ms)));
    });
    var ratio = server > 0 ? hb / server : 0;
    return section('ins-sec-wf', 'Gecikme şelalesi', 'toplam ' + fMs(total), [
      el('div', { class: 'ins-wf-comp', role: 'img', 'aria-label': 'Toplam ' + fMs(total) + ': sunucu içi ' + fMs(server) + ', header bidding ' + fMs(hb) },
        el('div', { class: 'ins-wf-compbar', 'aria-hidden': 'true' },
          el('span', { class: 'ins-wf-cs is-server', style: { width: 'max(4px, ' + pct(server / Math.max(total, 0.01)) + ')' } }),
          el('span', { class: 'ins-wf-cs is-hb', style: { width: pct(hb / Math.max(total, 0.01)) } })),
        el('div', { class: 'ins-wf-legend' },
          el('span', null, el('span', { class: 'ins-key is-server', 'aria-hidden': 'true' }), 'Sunucu içi ', el('b', { class: 'num' }, fMs(server))),
          el('span', null, el('span', { class: 'ins-key is-hb', 'aria-hidden': 'true' }), 'Header bidding ', el('b', { class: 'num' }, fMs(hb))))),
      el('div', { class: 'ins-wf' },
        el('div', { class: 'ins-wf-axis', 'aria-hidden': 'true' },
          el('span', { class: 'ins-wf-k' }),
          el('span', { class: 'ins-wf-ticks' }, (function () {
            var shown = ticks.filter(function (tv) { return tv / dom <= 0.9; });
            return shown.map(function (tv, i) {
              return el('span', { class: 'ins-wf-tick', style: { left: pct(tv / dom) } }, fNum(tv, 2) + (i === shown.length - 1 && i > 0 ? ' ms' : ''));
            });
          })()),
          el('span', { class: 'ins-wf-v' })),
        el('ol', { class: 'ins-wf-rows', style: { '--grid': pct(step / dom) } }, rows)),
      note('Ölçek: sunucu içi adımlar 0–' + fMs(dom) + '. Header bidding bu ölçeğin ' + (ratio >= 1 ? '~' + fNum(ratio, 0) + ' katı' : 'altında') +
        ' olduğu için kesik çizildi; profil okuma ve aday hesaplama onunla paralel yürür. Toplam = sunucu içi + header bidding.', 'ins-caption')
    ]);
  }

  /* ==================================================================
   * 5) RAPORLAR — ClickHouse (yerinde güncellenir)
   * ================================================================== */
  var TILE_DEFS = [
    { id: 'qps', label: 'İstek/sn' },
    { id: 'imp', label: 'Gösterim' },
    { id: 'clk', label: 'Tıklama' },
    { id: 'ctr', label: 'CTR' },
    { id: 'rev', label: 'Gelir' },
    { id: 'fill', label: 'Doluluk' }
  ];
  function renderReports() {
    var s = S();
    var panel = M.panels.reports;
    var lis = lineItemList();
    var liKey = lis.map(function (li) { return li.id; }).join(',');
    if (!s || !s.reports) {
      M.ui.reports = null;
      rebuildPanel('reports', [empty('Rapor yok', 'ClickHouse raporları motor başlayınca dolar.')]);
      return;
    }
    var ui = M.ui.reports;
    if (!ui || ui.liKey !== liKey) {
      ui = M.ui.reports = buildReportsSkeleton(lis);
      ui.liKey = liKey;
      U.clear(panel);
      appendAll(panel, ui.nodes);
    }
    updateReports(ui, s, lis);
  }
  function buildReportsSkeleton(lis) {
    var ui = { tiles: {}, rows: {}, nodes: [] };
    ui.caption = el('span', { class: 'ins-sec-meta' });
    var tiles = el('div', { class: 'ins-tiles' }, TILE_DEFS.map(function (t) {
      var v = el('span', { class: 'ins-tile-v' }, '—');
      var sb = el('span', { class: 'ins-tile-s mono' }, '');
      ui.tiles[t.id] = { v: v, s: sb };
      return el('div', { class: 'ins-tile', 'data-tile': t.id }, el('span', { class: 'ins-tile-k' }, t.label), v, sb);
    }));
    ui.spark = buildSpark();
    var rows = [];
    lis.forEach(function (li) {
      var r = ui.rows[li.id] = {};
      r.state = el('span', { class: 'ins-r-state' });
      r.rev = el('td', { class: 'num' });
      r.ctr = el('td', { class: 'num' });
      r.thrV = el('span', { class: 'num' });
      r.thrFill = el('span', { class: 'ins-meter-fill' });
      r.fill = el('span', { class: 'ins-prog-fill' });
      r.plan = el('span', { class: 'ins-prog-plan', title: 'Plan: uçuş süresine göre beklenen teslimat' });
      r.ptext = el('span', { class: 'ins-prog-text num' });
      r.ptag = el('span', { class: 'ins-prog-tag' });
      rows.push(el('tbody', { class: 'ins-r-li', 'data-li': li.id },
        el('tr', { class: 'ins-r-main' },
          el('th', { scope: 'row', class: 'ins-r-name' },
            el('span', { class: 'ins-c-name' }, li.name),
            el('span', { class: 'ins-c-sub' }, (li.advertiser || '') + ' · ' + LBL('lineItemType', li.type, li.type) + ' · ' + li.pricing), r.state),
          r.rev, r.ctr,
          el('td', { class: 'num ins-r-thr' }, r.thrV, el('span', { class: 'ins-meter', 'aria-hidden': 'true' }, r.thrFill))),
        el('tr', { class: 'ins-r-prog' },
          el('td', { colspan: '4' },
            el('div', { class: 'ins-prog' },
              el('span', { class: 'ins-prog-track', 'aria-hidden': 'true' }, r.fill, r.plan),
              el('span', { class: 'ins-prog-row' }, r.ptext, r.ptag))))));
    });
    ui.nodes = [
      el('div', { class: 'ins-sec-head' }, el('h3', { class: 'ins-h' }, 'ClickHouse raporları'), ui.caption),
      tiles,
      ui.spark.root,
      section('ins-sec-li', 'Line item teslimatı', 'kampanya başından beri', [
        el('div', { class: 'table-wrap', 'data-sk': 'rli' },
          el('table', { class: 'table ins-table ins-rli' },
            el('thead', null, el('tr', null,
              el('th', { scope: 'col' }, 'Line item · teslimat'),
              el('th', { scope: 'col', class: 'num' }, 'Gelir'),
              el('th', { scope: 'col', class: 'num' }, 'CTR'),
              el('th', { scope: 'col', class: 'num' }, 'Throttle'))),
            rows)),
        note('Çubuk hedefe (gösterim) ya da bütçeye göre ilerlemeyi, dikey çizgi uçuş süresine göre planı gösterir. Garantili kampanya plan gerisindeyse gölge fiyatla öne çıkar; öndeyse Pacing Kontrol throttle’ı düşürür.', 'ins-caption')
      ])
    ];
    return ui;
  }
  function updateReports(ui, s, lis) {
    var R = s.reports || {}, T = R.totals || {};
    var series = Array.isArray(R.series) ? R.series : [];
    var avg = series.length ? series.reduce(function (a, b) { return a + num(b); }, 0) / series.length : 0;
    var imps = num(T.impressions), clicks = num(T.clicks), reqs = num(T.requests);
    var period = (R.periods && R.periods.totals) || 'bugün';
    ui.caption.textContent = 'ads.ad_stats_hourly · ' + period;
    setTile(ui, 'qps', fInt(R.qps), series.length ? 'son 60 sn ort. ' + fInt(avg) : 'anlık');
    setTile(ui, 'imp', fCompact(imps), fInt(imps));
    setTile(ui, 'clk', fCompact(clicks), fInt(clicks));
    setTile(ui, 'ctr', imps ? fPct(clicks / imps, 2) : '—', 'tıklama / gösterim');
    setTile(ui, 'rev', fCompact(T.revenueTL) + ' ₺', fTL(T.revenueTL, 0));
    setTile(ui, 'fill', reqs ? fPct(imps / reqs, 1) : '—', 'gösterim / istek');
    updateSpark(ui.spark, series, num(R.qps));

    var tnow = nowSim();
    var by = R.byLineItem || {};
    lis.forEach(function (li) {
      var r = ui.rows[li.id];
      if (!r) return;
      var b = by[li.id] || {};
      var imp = num(b.impressions, num(li.delivered));
      var clk = num(b.clicks, num(li.clicks));
      r.rev.textContent = li.type === 'house' ? '—' : fTL(num(b.revenueTL, num(li.spentTL)), 0);
      r.ctr.textContent = imp ? fPct(clk / imp, 2) : '—';
      var thr = clamp(num(li.throttle, 1), 0, 1);
      r.thrV.textContent = li.type === 'house' ? '—' : fPct(thr, 0);
      r.thrFill.style.width = li.type === 'house' ? '0%' : pct(thr);
      var paused = li.status === 'paused';
      if (r.state.getAttribute('data-paused') !== String(paused)) {
        r.state.setAttribute('data-paused', String(paused));
        U.clear(r.state);
        if (paused) r.state.appendChild(pill('warn', 'durduruldu', '‖'));
      }
      var prog = deliveryProgress(li, tnow);
      r.fill.style.width = pct(prog.ratio);
      r.fill.setAttribute('data-kind', prog.kind);
      if (prog.plan != null) { r.plan.hidden = false; r.plan.style.left = pct(prog.plan); } else r.plan.hidden = true;
      r.ptext.textContent = prog.text;
      var tagKey = prog.tag ? prog.tag.kind + prog.tag.text : '';
      if (r.ptag.getAttribute('data-k') !== tagKey) {
        r.ptag.setAttribute('data-k', tagKey);
        U.clear(r.ptag);
        if (prog.tag) r.ptag.appendChild(pill(prog.tag.kind, prog.tag.text, prog.tag.glyph));
      }
    });
  }
  function setTile(ui, id, v, sub) {
    var t = ui.tiles[id];
    if (!t) return;
    if (t.v.textContent !== v) t.v.textContent = v;
    if (t.s.textContent !== sub) t.s.textContent = sub;
  }
  function deliveryProgress(li, tnow) {
    var fl = li.flight || null;
    var start = fl ? parseTs(fl.start) : null, end = fl ? parseTs(fl.end) : null;
    var frac = (start != null && end != null && end > start) ? clamp((tnow - start) / (end - start), 0, 1) : null;
    if (li.goal && li.goal.qty) {
      var r = num(li.delivered) / li.goal.qty;
      var tag = null;
      if (frac != null) {
        var diff = r - frac;
        tag = diff < -0.02 ? { kind: 'warn', text: 'plan gerisinde', glyph: '↓' } : (diff > 0.02 ? { kind: 'muted', text: 'plan önünde', glyph: '↑' } : { kind: 'ok', text: 'planda', glyph: '✓' });
      }
      return { kind: 'goal', ratio: r, plan: frac, tag: tag,
        text: fInt(li.delivered) + ' / ' + fInt(li.goal.qty) + ' gösterim · ' + fPct(r, 1) + (frac != null ? ' · plan ' + fPct(frac, 0) : '') };
    }
    if (li.budgetTL) {
      var rb = num(li.spentTL) / li.budgetTL;
      return { kind: 'budget', ratio: rb, plan: frac, tag: rb >= 0.98 ? { kind: 'bad', text: 'bütçe sonu', glyph: '!' } : null,
        text: fTL(li.spentTL, 0) + ' / ' + fTL(li.budgetTL, 0) + ' bütçe · ' + fPct(rb, 1) };
    }
    return { kind: 'none', ratio: 0, plan: null, tag: null, text: fInt(li.delivered) + ' gösterim · hedef yok (doldurma)' };
  }

  /* ---- sparkline (alan dolgusu + soluk ızgara + vurgulu uç nokta + hover) ---- */
  var SPW = 300, SPH = 64;
  function buildSpark() {
    var sp = {};
    sp.now = el('span', { class: 'ins-spark-now' });
    sp.grid = [0, 1, 2].map(function () { return sv('line', { x1: 0, x2: SPW, class: 'ins-spark-grid', 'vector-effect': 'non-scaling-stroke' }); });
    sp.area = sv('path', { class: 'ins-spark-area' });
    sp.line = sv('path', { class: 'ins-spark-line', 'vector-effect': 'non-scaling-stroke' });
    sp.svg = sv('svg', { class: 'ins-spark-svg', viewBox: '0 0 ' + SPW + ' ' + SPH, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' }, sp.grid, sp.area, sp.line);
    sp.ylabels = [0, 1, 2].map(function () { return el('span', { class: 'ins-spark-yl num' }); });
    sp.end = el('span', { class: 'ins-spark-end', 'aria-hidden': 'true' });
    sp.endLab = el('span', { class: 'ins-spark-endlab num', 'aria-hidden': 'true' });
    sp.cross = el('span', { class: 'ins-spark-cross', hidden: true, 'aria-hidden': 'true' });
    sp.hdot = el('span', { class: 'ins-spark-hdot', hidden: true, 'aria-hidden': 'true' });
    sp.tip = el('span', { class: 'ins-spark-tip num', hidden: true, 'aria-hidden': 'true' });
    sp.plot = el('div', { class: 'ins-spark-plot', tabindex: '0', role: 'img', 'data-fk': 'spark' }, sp.svg, sp.end, sp.endLab, sp.cross, sp.hdot, sp.tip);
    sp.root = el('div', { class: 'ins-spark', 'data-line': 'measure' },
      el('div', { class: 'ins-spark-head' }, el('span', { class: 'ins-spark-title' }, 'İstek/sn'), el('span', { class: 'ins-spark-span' }, 'son 60 sn'), sp.now),
      el('div', { class: 'ins-spark-body' },
        el('div', { class: 'ins-spark-y', 'aria-hidden': 'true' }, sp.ylabels),
        sp.plot),
      el('div', { class: 'ins-spark-x', 'aria-hidden': 'true' }, el('span', null, '−60 sn'), el('span', null, '−30 sn'), el('span', null, 'şimdi')));
    sp.data = [];
    sp.lo = 0; sp.hi = 1;
    sp.plot.addEventListener('pointermove', function (ev) {
      var n = sp.data.length;
      if (n < 2) return;
      var r = sp.plot.getBoundingClientRect();
      M.sparkHover = clamp(Math.round((ev.clientX - r.left) / Math.max(1, r.width) * (n - 1)), 0, n - 1);
      paintSparkHover(sp);
    });
    sp.plot.addEventListener('pointerleave', function () { M.sparkHover = null; paintSparkHover(sp); });
    sp.plot.addEventListener('blur', function () { M.sparkHover = null; paintSparkHover(sp); });
    sp.plot.addEventListener('keydown', function (ev) {
      var n = sp.data.length;
      if (n < 2) return;
      var i = M.sparkHover == null ? n - 1 : M.sparkHover;
      if (ev.key === 'ArrowLeft') i = Math.max(0, i - 1);
      else if (ev.key === 'ArrowRight') i = Math.min(n - 1, i + 1);
      else if (ev.key === 'Home') i = 0;
      else if (ev.key === 'End') i = n - 1;
      else if (ev.key === 'Escape') { M.sparkHover = null; paintSparkHover(sp); return; }
      else return;
      ev.preventDefault();
      M.sparkHover = i;
      paintSparkHover(sp);
    });
    return sp;
  }
  function updateSpark(sp, series, cur) {
    var data = series.map(function (v) { return num(v); });
    sp.data = data;
    sp.now.textContent = fInt(cur);
    if (data.length < 2) { sp.line.setAttribute('d', ''); sp.area.setAttribute('d', ''); sp.end.hidden = true; sp.endLab.hidden = true; return; }
    var mn = Math.min.apply(null, data), mx = Math.max.apply(null, data);
    var stepV = 250;
    var lo = Math.floor(mn / stepV) * stepV, hi = Math.ceil(mx / stepV) * stepV;
    if (hi - lo < stepV * 2) { hi = lo + stepV * 2; }
    if (Math.round((hi - lo) / stepV) % 2) hi += stepV;   // orta ızgara çizgisi de yuvarlak değer olsun
    sp.lo = lo; sp.hi = hi;
    var n = data.length;
    var X = function (i) { return i / (n - 1) * SPW; };
    var Y = function (v) { return SPH - (v - lo) / (hi - lo) * SPH; };
    var d = '';
    data.forEach(function (v, i) { d += (i ? 'L' : 'M') + X(i).toFixed(2) + ' ' + Y(v).toFixed(2); });
    sp.line.setAttribute('d', d);
    sp.area.setAttribute('d', d + 'L' + SPW + ' ' + SPH + 'L0 ' + SPH + 'Z');
    [hi, (hi + lo) / 2, lo].forEach(function (v, i) {
      var y = Y(v);
      sp.grid[i].setAttribute('y1', y.toFixed(2));
      sp.grid[i].setAttribute('y2', y.toFixed(2));
      sp.ylabels[i].textContent = fInt(v);
      sp.ylabels[i].style.top = (y / SPH * 100).toFixed(2) + '%';
    });
    var lastV = data[n - 1];
    var ey = Y(lastV) / SPH * 100;
    sp.end.hidden = false;
    sp.end.style.top = ey.toFixed(2) + '%';
    sp.endLab.hidden = false;
    sp.endLab.textContent = fInt(lastV);
    sp.endLab.style.top = ey.toFixed(2) + '%';
    sp.endLab.setAttribute('data-pos', ey < 30 ? 'below' : 'above');
    sp.plot.setAttribute('aria-label', 'İstek/sn, son ' + n + ' saniye: en düşük ' + fInt(mn) + ', en yüksek ' + fInt(mx) + ', şu an ' + fInt(lastV) + '. Ok tuşlarıyla değerleri gezebilirsiniz.');
    paintSparkHover(sp);
  }
  function paintSparkHover(sp) {
    var i = M.sparkHover, n = sp.data.length;
    var on = i != null && n >= 2 && i < n;
    sp.cross.hidden = !on; sp.hdot.hidden = !on; sp.tip.hidden = !on;
    if (!on) return;
    var x = i / (n - 1) * 100;
    var v = sp.data[i];
    var y = (1 - (v - sp.lo) / (sp.hi - sp.lo)) * 100;
    sp.cross.style.left = x.toFixed(2) + '%';
    sp.hdot.style.left = x.toFixed(2) + '%';
    sp.hdot.style.top = y.toFixed(2) + '%';
    sp.tip.style.left = x.toFixed(2) + '%';
    sp.tip.setAttribute('data-align', x > 70 ? 'end' : (x < 30 ? 'start' : 'mid'));
    var ago = n - 1 - i;
    sp.tip.textContent = (ago ? '−' + ago + ' sn' : 'şimdi') + ' · ' + fInt(v) + ' istek/sn';
  }

  /* ==================================================================
   * 6) KAMPANYALAR — Admin UI
   * ================================================================== */
  function campaignsSig() {
    var s = S();
    if (!s) return 'none|';
    var lis = s.lineItems || {};
    return ((s.config && s.config.version) || 1) + '|' + keysOf(lis).map(function (id) {
      var li = lis[id];
      return [id, li.status, li.rate, li.fcap ? li.fcap.max : '-', li.version || 1].join(':');
    }).join(',');
  }
  function campaignFlowFor(id) {
    return flowActionOf('campaign_update').some(function (a) { return String(a.lineItemId) === String(id); });
  }
  function renderCampaigns() {
    var sig = [campaignsSig(), JSON.stringify(M.pending), flowActionOf('campaign_update').map(function (a) { return a.lineItemId; }).join(','), JSON.stringify(M.camMsg)].join('#');
    if (sig === M.sig.campaigns) return;
    M.sig.campaigns = sig;
    rebuildPanel('campaigns', buildCampaigns());
  }
  function buildCampaigns() {
    var s = S();
    if (!s || !s.lineItems) return [empty('Kampanya yok', 'Line item yapılandırması motor başlayınca yüklenir.')];
    var cfg = s.config || {};
    var lc = cfg.lastChange;
    var out = [];
    out.push(el('div', { class: 'card ins-cfg', 'data-line': 'control' },
      el('div', { class: 'ins-cfg-row' },
        el('span', { class: 'ins-cfg-ver', 'data-line': 'control' }, el('span', { class: 'ins-cfg-v' }, 'v' + (cfg.version || 1)), el('span', { class: 'sr-only' }, ' config sürümü')),
        el('div', { class: 'ins-cfg-text' },
          el('span', { class: 'eyebrow' }, 'Config Stream · config.adserver'),
          el('span', { class: 'ins-cfg-last' }, lc ? changeText(lc) : 'Yayınlanmış değişiklik yok; pod’lar başlangıç snapshot’ını kullanıyor.'))),
      note('Kaydet → Management API → PostgreSQL (UPDATE line_items) → Debezium CDC → config.adserver → pod’larda atomic snapshot swap. Ad server bu veritabanını sıcak yolda sorgulamaz.', 'ins-caption')));
    lineItemList().forEach(function (li) { out.push(campaignForm(li)); });
    return out;
  }
  function changeText(lc) {
    var li = liOf(lc.lineItemId);
    var b = lc.before || {}, a = lc.after || {}, p = lc.patch || {};
    var parts = [];
    if (p.status) parts.push('durum ' + LBL('status', b.status, b.status).toLowerCase() + ' → ' + LBL('status', a.status, a.status).toLowerCase());
    if (p.rate != null) parts.push('fiyat ' + fTL(b.rate) + ' → ' + fTL(a.rate));
    if (p.fcapMax != null) parts.push('fcap ' + (b.fcap_max == null ? '—' : b.fcap_max) + ' → ' + a.fcap_max);
    return 'Son değişiklik ' + (lc.at ? fTime(lc.at) : '') + ': LI ' + lc.lineItemId + (li ? ' “' + li.name + '”' : '') + ' · ' + (parts.join(', ') || 'güncellendi');
  }
  function draftOf(li) {
    var d = M.drafts[li.id];
    return {
      status: d && d.status != null ? d.status : li.status,
      rate: d && d.rate != null ? d.rate : fNum(li.rate, 2, 2),
      fcap: d && d.fcap != null ? d.fcap : (li.fcap ? String(li.fcap.max) : '')
    };
  }
  function parseDecimal(str) {
    var s = String(str == null ? '' : str).trim().replace(/[\s₺]/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (!/^\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    return Number(s);
  }
  function computePatch(li) {
    var d = M.drafts[li.id] || {};
    var patch = {}, errors = {};
    if (d.status != null && d.status !== li.status) patch.status = d.status;
    if (d.rate != null) {
      var r = parseDecimal(d.rate);
      if (r === null || isNaN(r) || r < 0) errors.rate = 'Geçerli bir tutar girin (ör. 85,00).';
      else if (r > 100000) errors.rate = 'Tutar çok yüksek.';
      else if (Math.abs(r - num(li.rate)) > 1e-9) patch.rate = Math.round(r * 10000) / 10000;
    }
    if (d.fcap != null) {
      var t = String(d.fcap).trim();
      if (t === '') { if (li.fcap) errors.fcap = 'Boş bırakılamaz (1–99).'; }
      else if (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > 99) errors.fcap = '1–99 arası tam sayı girin.';
      else if (!li.fcap || li.fcap.max !== Number(t)) patch.fcapMax = Number(t);
    }
    return { patch: patch, errors: errors };
  }
  function campaignForm(li) {
    var id = li.id;
    var d = draftOf(li);
    var busy = !!M.pending[id] || campaignFlowFor(id);
    var res = computePatch(li);
    var dirty = keysOf(res.patch).length > 0;
    var hasErr = keysOf(res.errors).length > 0;
    var house = li.type === 'house';
    var msg = M.camMsg[id];
    var on = d.status === 'active';
    var rateLabel = 'Fiyat · ' + li.pricing + ' (₺)';
    var stateText = busy ? 'Yayınlanıyor…' : (hasErr ? 'Hatalı alanı düzeltin' : (dirty ? 'Kaydedilmemiş değişiklik' : (msg ? msg.text : 'Değişiklik yok')));
    return el('form', { class: ['ins-camp', busy ? 'is-busy' : null, dirty ? 'is-dirty' : null], 'data-li': id, novalidate: true, 'aria-busy': busy ? 'true' : 'false', 'aria-labelledby': 'ins-camp-' + id + '-name' },
      el('div', { class: 'ins-camp-head' },
        el('div', { class: 'ins-camp-title' },
          el('span', { class: 'ins-c-name', id: 'ins-camp-' + id + '-name' }, li.name),
          el('span', { class: 'ins-c-sub' }, el('span', { class: 'mono' }, String(id)), ' · ', li.advertiser, ' · ', LBL('lineItemType', li.type, li.type), ' · öncelik ', String(li.priority))),
        el('span', { class: 'ins-li-ver mono', title: 'line_items.version (optimistic versioning)' }, 'v' + (li.version || 1))),
      el('div', { class: 'ins-camp-fields' },
        el('div', { class: 'ins-field ins-field-switch' },
          el('span', { class: 'field-label', id: 'ins-status-' + id + '-l' }, 'Durum'),
          el('button', {
            type: 'button', class: 'switch', role: 'switch', id: 'ins-status-' + id, 'data-act': 'camp-status', 'data-li': id,
            'aria-checked': on ? 'true' : 'false', 'aria-labelledby': 'ins-status-' + id + '-l ins-status-' + id + '-t', disabled: busy
          }, el('span', { id: 'ins-status-' + id + '-t' }, on ? 'Aktif' : 'Durduruldu'))),
        el('div', { class: 'ins-field' },
          el('label', { class: 'field-label', for: 'ins-rate-' + id }, rateLabel),
          el('input', {
            class: 'input mono', id: 'ins-rate-' + id, name: 'rate', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
            'data-li': id, 'data-field': 'rate', value: house ? fNum(li.rate, 2, 2) : d.rate, disabled: busy || house,
            'aria-invalid': res.errors.rate ? 'true' : 'false', 'aria-describedby': 'ins-camp-' + id + '-msg'
          }),
          house ? el('span', { class: 'ins-field-hint' }, 'house · faturalanmaz') : null),
        el('div', { class: 'ins-field' },
          el('label', { class: 'field-label', for: 'ins-fcap-' + id }, 'Fcap · ' + ((li.fcap && li.fcap.windowH) || 24) + ' saatte en fazla'),
          el('input', {
            class: 'input mono', id: 'ins-fcap-' + id, name: 'fcapMax', type: 'text', inputmode: 'numeric', autocomplete: 'off',
            'data-li': id, 'data-field': 'fcap', value: d.fcap, placeholder: 'sınırsız', disabled: busy,
            'aria-invalid': res.errors.fcap ? 'true' : 'false', 'aria-describedby': 'ins-camp-' + id + '-msg'
          }))),
      el('div', { class: 'ins-camp-foot' },
        el('button', { type: 'submit', class: 'btn btn-primary', 'data-line': 'control', id: 'ins-save-' + id, disabled: busy || !dirty || hasErr },
          busy ? [el('span', { class: 'ins-spin', 'aria-hidden': 'true' }), 'yayınlanıyor…'] : 'Kaydet ve yayınla'),
        el('span', { class: ['ins-camp-msg', hasErr ? 'is-err' : null, msg && msg.ok && !dirty && !busy ? 'is-ok' : null], id: 'ins-camp-' + id + '-msg', role: 'status' },
          hasErr ? (res.errors.rate || res.errors.fcap) : stateText)));
  }
  function refreshCampaignForm(id) {
    // Yazarken formu yeniden kurma: yalnızca buton/ileti durumunu güncelle
    var li = liOf(id);
    var form = M.panels.campaigns && M.panels.campaigns.querySelector('form[data-li="' + String(id).replace(/[^0-9A-Za-z_-]/g, '') + '"]');
    if (!li || !form) return;
    var res = computePatch(li);
    var dirty = keysOf(res.patch).length > 0;
    var hasErr = keysOf(res.errors).length > 0;
    var busy = !!M.pending[id] || campaignFlowFor(id);
    var btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = busy || !dirty || hasErr;
    form.classList.toggle('is-dirty', dirty);
    var rate = form.querySelector('[data-field="rate"]'), fc = form.querySelector('[data-field="fcap"]');
    if (rate) rate.setAttribute('aria-invalid', res.errors.rate ? 'true' : 'false');
    if (fc) fc.setAttribute('aria-invalid', res.errors.fcap ? 'true' : 'false');
    var msgEl = form.querySelector('.ins-camp-msg');
    if (msgEl) {
      msgEl.textContent = hasErr ? (res.errors.rate || res.errors.fcap) : (dirty ? 'Kaydedilmemiş değişiklik' : 'Değişiklik yok');
      msgEl.classList.toggle('is-err', hasErr);
      msgEl.classList.remove('is-ok');
    }
  }
  function onRootInput(ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    var f = t.getAttribute('data-field');
    var id = t.getAttribute('data-li');
    if (!f || !id) return;
    var d = M.drafts[id] = M.drafts[id] || {};
    d[f] = t.value;
    delete M.camMsg[id];
    refreshCampaignForm(id);
  }
  function toggleCampaignStatus(btn) {
    var id = btn.getAttribute('data-li');
    var li = liOf(id);
    if (!li || btn.disabled) return;
    var d = M.drafts[id] = M.drafts[id] || {};
    var cur = d.status != null ? d.status : li.status;
    d.status = cur === 'active' ? 'paused' : 'active';
    var on = d.status === 'active';
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    var t = btn.querySelector('span');
    if (t) t.textContent = on ? 'Aktif' : 'Durduruldu';
    delete M.camMsg[id];
    refreshCampaignForm(id);
  }
  function onRootSubmit(ev) {
    var form = ev.target;
    if (!form || !form.classList || !form.classList.contains('ins-camp')) return;
    ev.preventDefault();
    saveCampaign(form.getAttribute('data-li'));
  }
  function dispatchAction(action) {
    try {
      if (SIM.engine && typeof SIM.engine.dispatch === 'function') return Promise.resolve(SIM.engine.dispatch(action));
      bus.emit('action', action);
      return Promise.resolve({ ok: true, viaBus: true });
    } catch (e) {
      try { console.error('[SIM.inspector] aksiyon gönderilemedi:', e); } catch (e2) { /* yut */ }
      return Promise.resolve({ ok: false, error: String(e && e.message || e) });
    }
  }
  function saveCampaign(id) {
    var li = liOf(id);
    if (!li || M.pending[id] || campaignFlowFor(id)) return;
    var res = computePatch(li);
    if (keysOf(res.errors).length || !keysOf(res.patch).length) { refreshCampaignForm(id); return; }
    var action = { type: 'campaign_update', lineItemId: li.id, patch: res.patch };
    M.pending[id] = true;
    delete M.camMsg[id];
    M.sig.campaigns = null;
    invalidate('campaigns');
    if (M.active === 'campaigns') renderNow('campaigns');
    dispatchAction(action).then(function (r) {
      M.pending[id] = false;
      if (r && r.ok === false) {
        M.camMsg[id] = { ok: false, text: r.cancelled ? 'İptal edildi (sıfırlama)' : ('Yayınlanmadı' + (r.reason ? ': ' + r.reason : '')) };
      } else {
        delete M.drafts[id];
        var s = S();
        var ver = (r && r.version) || (s && s.config && s.config.version) || null;
        M.camMsg[id] = { ok: true, text: '✓ ' + (ver ? 'config v' + ver + ' yayınlandı' : 'yayınlandı') };
      }
      M.sig.campaigns = null;
      invalidate('campaigns');
    });
  }

  /* ==================================================================
   * 7) CLEAN ROOM
   * ================================================================== */
  function lastRunOf(s) {
    var runs = (s && s.cleanroom && s.cleanroom.runs) || [];
    var r = last(runs);
    if (M.lastRun && (!r || M.lastRun.id === r.id || num(M.lastRun.no) > num(r.no))) return M.lastRun;
    return r || M.lastRun;
  }
  function crRunning() { return M.crPending || flowActionOf('cleanroom_run').length > 0; }
  function renderCleanroom() {
    var s = S();
    var cr = (s && s.cleanroom) || {};
    var r = lastRunOf(s);
    var sig = JSON.stringify([cr.epsilonUsed, cr.epsilonBudget, (cr.runs || []).length, r && r.id, crRunning(), s && s.user && s.user.loggedIn, s && s.user && s.user.personId]);
    if (sig === M.sig.cleanroom) return;
    M.sig.cleanroom = sig;
    rebuildPanel('cleanroom', buildCleanroom());
  }
  function runCleanroom() {
    if (crRunning()) return;
    M.crPending = true;
    M.sig.cleanroom = null;
    renderNow('cleanroom');
    dispatchAction({ type: 'cleanroom_run' }).then(function () {
      M.crPending = false;
      M.sig.cleanroom = null;
      invalidate('cleanroom');
    });
  }
  function buildCleanroom() {
    var s = S();
    var P = D().partner || {};
    var cr = (s && s.cleanroom) || {};
    var used = num(cr.epsilonUsed), budget = num(cr.epsilonBudget, num(P.epsilonBudget, 10));
    var per = num(cr.epsilonPerRun, num(P.epsilonPerRun, 0.5));
    var k = num(cr.k, num(P.k, 50)), minSeg = num(cr.minSegment, num(P.minSegment, 1000));
    var cells = per > 0 ? Math.round(budget / per) : 0;
    var usedCells = per > 0 ? Math.round(used / per) : 0;
    var remainingRuns = per > 0 ? Math.max(0, Math.floor((budget - used) / per + 1e-9)) : 0;
    var exhausted = used + per > budget + 1e-9;
    var running = crRunning();
    var out = [];

    var epsBar = el('div', { class: 'ins-eps', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(budget), 'aria-valuenow': String(used), 'aria-label': 'ε bütçesi kullanımı', 'aria-valuetext': fNum(used, 1, 1) + ' / ' + fNum(budget, 0) },
      el('span', { class: 'ins-eps-cells', 'aria-hidden': 'true', style: { '--n': cells || 1 } },
        Array.apply(null, Array(Math.min(cells, 60))).map(function (_, i) { return el('span', { class: ['ins-eps-cell', i < usedCells ? 'is-used' : null] }); })));
    out.push(el('div', { class: 'card ins-collab', 'data-line': 'cleanroom' },
      el('div', { class: 'ins-card-head' },
        el('span', { class: 'eyebrow' }, 'Collaboration'),
        pill('line', 'aktif', null, { 'data-line': 'cleanroom' })),
      el('p', { class: 'ins-collab-title' }, (P.name || 'Partner') + ' × ' + ((D().site && D().site.name) || 'Gündem+')),
      el('p', { class: 'ins-collab-id mono' }, cr.collaborationId || P.collaborationId || ''),
      el('dl', { class: 'kv ins-collab-kv' },
        el('dt', 'Amaç'), el('dd', null, PURPOSE_LABEL[P.purpose] || P.purpose || '—'),
        el('dt', 'Geçerlilik'), el('dd', null, el('span', { class: 'num' }, P.validFrom ? fDate(parseTs(P.validFrom + 'T00:00:00+03:00')) + ' – ' + fDate(parseTs(P.validTo + 'T00:00:00+03:00')) : '—')),
        el('dt', 'Eşleştirme'), el('dd', null, 'TEE içi hash join (AMD SEV-SNP, remote attestation) · anahtar ' + (P.keys || ['hem']).join(', ') + ' (SHA-256)'),
        el('dt', 'Şablonlar'), el('dd', null, (P.templates || []).map(function (t) { return TEMPLATE_LABEL[t] || t; }).join(', ') || '—'),
        el('dt', 'Eşikler'), el('dd', null, 'k ≥ ' + fInt(k) + ' · opak segment ≥ ' + fInt(minSeg) + ' kişi')),
      el('div', { class: 'ins-eps-wrap' },
        el('div', { class: 'ins-eps-head' },
          el('span', { class: 'ins-eps-k' }, 'ε bütçesi'),
          el('span', { class: 'ins-eps-v num' }, fNum(used, 1, 1) + ' / ' + fNum(budget, 0)),
          el('span', { class: 'ins-eps-s' }, 'çalıştırma başına ' + fNum(per, 1, 1) + ' · ' + fInt(remainingRuns) + ' çalıştırma kaldı')),
        epsBar),
      el('div', { class: 'ins-cr-actions' },
        el('button', { type: 'button', class: 'btn btn-primary', 'data-line': 'cleanroom', id: 'ins-cr-run', 'data-act': 'cr-run', disabled: running || exhausted },
          running ? [el('span', { class: 'ins-spin', 'aria-hidden': 'true' }), 'Çalışıyor…'] : 'Eşleştirmeyi çalıştır'),
        el('span', { class: 'ins-cr-hint', role: 'status' }, running ? 'Partner ve Iceberg verisi TEE’ye yükleniyor…' : (exhausted ? 'ε bütçesi tükendi: yeni sorgu çalışmaz.' : 'Her çalıştırma ε = ' + fNum(per, 1, 1) + ' harcar.')))));

    var run = lastRunOf(s);
    if (!run) {
      out.push(empty('Henüz çalıştırma yok', 'Çalıştırınca: partner ' + fInt(P.records) + ' hash’li e-postayı yükler, yayıncı Iceberg’den ' + fInt(P.publisherHems) +
        ' hash’li e-posta + maruz kalma verisi gönderir; TEE içinde eşleşme yapılır, politika katmanı k eşiğini ve DP gürültüsünü uygular.'));
      return out;
    }
    out.push(section('ins-sec-run', 'Son çalıştırma', run.id + ' · ' + fTime(run.at), [
      venn(run, P),
      el('div', { class: 'ins-dp' },
        el('div', { class: 'ins-dp-row is-true' },
          el('span', { class: 'ins-dp-k' }, 'Gerçek eşleşme', el('span', { class: 'ins-dp-s' }, 'yalnızca TEE içinde · kimse görmez')),
          el('span', { class: 'ins-dp-v num' }, el('span', { class: 'ins-lock', 'aria-hidden': 'true' }), fInt(run.matchedTrue))),
        el('div', { class: 'ins-dp-row is-noisy' },
          el('span', { class: 'ins-dp-k' }, 'Yayınlanan sayı', el('span', { class: 'ins-dp-s' }, (run.mechanism || 'Laplace') + ' gürültüsü · ε = ' + fNum(run.epsilon, 1, 1) + ' · hassasiyet ' + (run.sensitivity || 1))),
          el('span', { class: 'ins-dp-v num' }, fInt(run.matchedNoisy), el('span', { class: 'ins-dp-noise num' }, (num(run.noise) < 0 ? '−' : '+') + fNum(Math.abs(num(run.noise)), 1, 1))))),
      el('div', { class: 'ins-checks' },
        run.kPassed ? pill('ok', 'k ≥ ' + fInt(run.k) + ' sağlandı', '✓') : pill('bad', 'k ≥ ' + fInt(run.k) + ' sağlanmadı', '×'),
        run.segmentOk ? pill('ok', 'segment ≥ ' + fInt(run.minSegment), '✓') : pill('warn', 'segment < ' + fInt(run.minSegment), '!'),
        run.attestation && run.attestation.ok ? pill('ok', 'TEE attestation', '✓') : null,
        pill('muted', 'örtüşme ' + fPct(run.overlapPct, 1) + ' (partner)', null)),
      opaqueSegmentCard(run),
      visitorMatch(run, s),
      run.attestation && run.attestation.measurement ? note('Attestation: ' + (run.attestation.platform || 'TEE') + ' · ölçüm ' + run.attestation.measurement + '…', 'ins-caption mono') : null
    ]));
    var runs = (s && s.cleanroom && s.cleanroom.runs) || [];
    if (runs.length > 1) {
      out.push(section('ins-sec-runs', 'Çalıştırma geçmişi', fInt(runs.length) + ' çalıştırma',
        el('div', { class: 'table-wrap', 'data-sk': 'runs' },
          el('table', { class: 'table ins-table ins-runs' },
            el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Çalıştırma'), el('th', { scope: 'col', class: 'num' }, 'Yayınlanan'), el('th', { scope: 'col', class: 'num' }, 'Gürültü'), el('th', { scope: 'col', class: 'num' }, 'ε toplam'))),
            el('tbody', null, runs.slice().reverse().map(function (x) {
              return el('tr', null,
                el('td', null, el('span', { class: 'mono' }, x.id), el('span', { class: 'ins-c-sub' }, fTime(x.at))),
                el('td', { class: 'num' }, fInt(x.matchedNoisy)),
                el('td', { class: 'num' }, (num(x.noise) < 0 ? '−' : '+') + fNum(Math.abs(num(x.noise)), 1, 1)),
                el('td', { class: 'num' }, fNum(x.epsilonUsed, 1, 1)));
            }))))));
    }
    return out;
  }
  function lensArea(r1, r2, d) {
    if (d >= r1 + r2) return 0;
    if (d <= Math.abs(r1 - r2)) return Math.PI * Math.pow(Math.min(r1, r2), 2);
    var a = r1 * r1 * Math.acos(clamp((d * d + r1 * r1 - r2 * r2) / (2 * d * r1), -1, 1));
    var b = r2 * r2 * Math.acos(clamp((d * d + r2 * r2 - r1 * r1) / (2 * d * r2), -1, 1));
    var c = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
    return a + b - c;
  }
  function venn(run, P) {
    var A = num(run.publisherHems, num(P.publisherHems, 48000)), B = num(run.partnerRecords, num(P.records, 12400));
    var O = clamp(num(run.matchedNoisy), 0, Math.min(A, B));
    var W = 340, H = 176;
    var rA = 62, rB = rA * Math.sqrt(B / A);
    var target = O / A * Math.PI * rA * rA;
    var lo = Math.abs(rA - rB), hi = rA + rB;
    for (var i = 0; i < 40; i++) { var mid = (lo + hi) / 2; if (lensArea(rA, rB, mid) > target) lo = mid; else hi = mid; }
    var dist = (lo + hi) / 2;
    var cy = 92;
    var cxA = 22 + rA;                       // sola yaslı: partner etiketi B'nin sağına sığsın
    var cxB = cxA + dist;
    // Mercek (kesişim) yatayda (cxB − rB) … (cxA + rA) arasında; ortası etiketin çapası
    var lensX = ((cxA + rA) + (cxB - rB)) / 2;
    var clipId = 'ins-venn-clip-' + (++hid);
    var labelY = 18;
    var svg = sv('svg', { class: 'ins-venn', viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Venn: yayıncı ' + fInt(A) + ' hash’li e-posta, partner ' + fInt(B) + ' kayıt, yayınlanan kesişim ' + fInt(O) },
      sv('defs', null, sv('clipPath', { id: clipId }, sv('circle', { cx: cxB, cy: cy, r: rB }))),
      sv('circle', { cx: cxA, cy: cy, r: rA, class: 'ins-venn-a' }),
      sv('circle', { cx: cxB, cy: cy, r: rB, class: 'ins-venn-b' }),
      sv('circle', { cx: cxA, cy: cy, r: rA, class: 'ins-venn-o', 'clip-path': 'url(#' + clipId + ')' }),
      sv('path', { class: 'ins-venn-lead', d: 'M' + lensX.toFixed(1) + ' ' + (cy - 6) + ' V' + (labelY + 10) }),
      sv('circle', { cx: lensX, cy: cy, r: 3, class: 'ins-venn-pt' }),
      sv('text', { x: lensX, y: labelY, 'text-anchor': 'middle', class: 'ins-venn-ol' }, '∩ ' + fInt(O)),
      sv('text', { x: cxA - rA * 0.25, y: cy + 4, 'text-anchor': 'middle', class: 'ins-venn-in' }, fInt(A)),
      sv('text', { x: cxA, y: cy + rA + 17, 'text-anchor': 'middle', class: 'ins-venn-cap' }, (D().site && D().site.name) || 'Gündem+'),
      sv('text', { x: cxB + rB + 8, y: cy - 2, 'text-anchor': 'start', class: 'ins-venn-cap' }, P.name || 'Partner'),
      sv('text', { x: cxB + rB + 8, y: cy + 13, 'text-anchor': 'start', class: 'ins-venn-in' }, fInt(B) + ' kayıt'));
    return el('figure', { class: 'ins-venn-fig' }, svg,
      el('figcaption', { class: 'ins-venn-legend' },
        el('span', null, el('span', { class: 'ins-key is-a', 'aria-hidden': 'true' }), ((D().site && D().site.name) || 'Gündem+') + ' · ', el('b', { class: 'num' }, fInt(A)), ' hash’li e-posta'),
        el('span', null, el('span', { class: 'ins-key is-b', 'aria-hidden': 'true' }), (P.name || 'Partner') + ' · ', el('b', { class: 'num' }, fInt(B)), ' kayıt'),
        el('span', null, el('span', { class: 'ins-key is-o', 'aria-hidden': 'true' }), 'yayınlanan kesişim · ', el('b', { class: 'num' }, fInt(O)))));
  }
  function opaqueSegmentCard(run) {
    var sg = segOf(run.segmentId) || {};
    var li102 = null;
    lineItemList().forEach(function (li) { if (li.targeting && (li.targeting.segments || []).indexOf(num(run.segmentId)) >= 0) li102 = li; });
    return el('div', { class: 'ins-opaque', 'data-line': 'cleanroom' },
      el('div', { class: 'ins-opaque-head' },
        lineBadge('cleanroom', null),
        el('span', { class: 'ins-opaque-title' }, el('span', { class: 'mono' }, String(run.segmentId)), ' · ', sg.name || 'Opak segment'),
        pill('bad', 'exportable = false', '⊘')),
      el('p', { class: 'ins-opaque-text' },
        run.segmentOk ? '≈ ' + fInt(run.segmentSize || run.matchedNoisy) + ' kişi · TTL ' + (sg.ttlDays || 30) + ' gün. ' : 'Küme ' + fInt(run.minSegment) + ' kişinin altında: segment üretilmedi. ',
        'Yalnızca ad server içinde hedeflenir' + (li102 ? ' (LI ' + li102.id + ' · ' + li102.advertiser + ' ' + LBL('lineItemType', li102.type, li102.type).toLowerCase() + ')' : '') +
        '; DSP, sosyal ağ ve arama kanallarına aktarılamaz.'));
  }
  function visitorMatch(run, s) {
    var u = (s && s.user) || {};
    if (run.userMatched) {
      return el('div', { class: 'ins-match is-yes' }, pill('ok', 'Ziyaretçi eşleşti', '✓'),
        el('span', null, 'Partner listesinde ziyaretçinin e-posta hash’i vardı → profiline ' + run.segmentId + ' yazıldı (' + (run.matchedPersonId || u.personId || '') + ').'));
    }
    var why = !run.userLoggedIn
      ? 'Ziyaretçi giriş yapmadığı için web profili e-posta hash’iyle bağlanmadı. Giriş yapıp eşleştirmeyi yeniden çalıştırın.'
      : 'Ziyaretçinin profili eşleşen kümede değil.';
    return el('div', { class: 'ins-match is-no' }, pill('muted', 'Ziyaretçi eşleşmedi', '–'), el('span', null, why));
  }

  /* ==================================================================
   * 8) İSTASYON
   * ================================================================== */
  function renderNode() {
    var s = S();
    var live = M.selectedNode && s ? safe(function () { return JSON.stringify(liveFor(M.selectedNode, s).rows); }, '') : '';
    var sig = [M.selectedNode, live, M.selectedNode === 'kafka' && s && s.kafka ? JSON.stringify(s.kafka.offsets) : '',
      M.selectedNode === 'segment' && s ? JSON.stringify(keysOf(s.segments).map(function (k) { return s.segments[k].estimate; })) : ''].join('#');
    if (sig === M.sig.node) return;
    M.sig.node = sig;
    rebuildPanel('node', buildNode());
  }
  function buildNode() {
    var d = D();
    var id = M.selectedNode;
    var n = nodeOf(id);
    if (!n) {
      return [empty('İstasyon seçilmedi', 'Haritada bir istasyona dokunun ya da aşağıdan seçin: ne yaptığı, neden orada olduğu, teknolojisi ve canlı sayaçları burada görünür.'), stationDirectory()];
    }
    var zone = (d.zones || {})[n.zone] || {};
    var lines = typeof d.linesOf === 'function' ? d.linesOf(id) : [];
    var det = n.detail || {};
    var s = S();
    var out = [];
    out.push(el('div', { class: 'ins-node-head', 'data-line': zone.line || null },
      el('span', { class: 'eyebrow ins-node-zone' }, zone.label || n.zone),
      el('h3', { class: 'ins-node-title' }, n.label),
      el('p', { class: 'ins-node-sub' }, n.sub,
        n.hub ? pill('muted', 'aktarma istasyonu', null, { class: 'ins-node-tag' }) : null,
        n.external ? pill('muted', 'harici sistem', null, { class: 'ins-node-tag' }) : null),
      lines.length ? el('ul', { class: 'ins-node-lines', 'aria-label': 'Geçen hatlar' }, lines.map(function (l) { return el('li', null, lineBadge(l, 'sm', true)); })) : null));

    if (s) {
      var lv = liveFor(id, s);
      if (lv.rows.length || lv.extra) {
        out.push(section('ins-sec-live', 'Canlı sayaçlar', null, [
          lv.rows.length ? el('dl', { class: 'ins-live-kv' }, lv.rows.map(function (r) {
            return [el('dt', r[0]), el('dd', { class: r[2] === false ? null : 'num' }, r[1])];
          })) : null,
          lv.extra || null
        ], { line: zone.line || null }));
      }
    }

    out.push(el('dl', { class: 'ins-node-detail' },
      [['Ne yapar', det.what], ['Neden', det.why], ['Teknoloji', det.tech], ['Gecikme', det.latency], ['Ölçek', det.scale]].map(function (r) {
        return r[1] ? [el('dt', r[0]), el('dd', null, r[1])] : null;
      })));

    var edges = typeof d.edgesOf === 'function' ? d.edgesOf(id) : [];
    if (edges.length) {
      out.push(section('ins-sec-edges', 'Bağlantılar', fInt(edges.length) + ' hat bağlantısı',
        el('ul', { class: 'ins-edges' }, edges.map(function (e) {
          var other = e.from === id ? e.to : e.from;
          var on = nodeOf(other);
          return el('li', { class: 'ins-edge' },
            el('button', { type: 'button', class: 'chip ins-edge-node', 'data-act': 'node', 'data-node': other, 'data-fk': 'edge-' + other, 'aria-label': (on ? on.label : other) + ' istasyonunu aç' },
              el('span', { class: 'ins-edge-dir', 'aria-hidden': 'true' }, e.from === id ? '→' : '←'), on ? on.label : other),
            el('span', { class: 'ins-edge-label' }, e.label),
            el('span', { class: 'ins-edge-lines' }, (e.lines || []).map(function (l) { return lineBadge(l, 'sm'); })));
        }))));
    }
    if (det.docs) {
      out.push(el('p', { class: 'ins-docs' }, 'Doküman: ',
        el('a', { href: ((SIM.inspector && SIM.inspector.docsBase) || '../') + det.docs, target: '_blank', rel: 'noopener' }, el('span', { class: 'mono' }, det.docs))));
    }
    out.push(el('div', { class: 'ins-node-dir' }, detailsEl('node-dir', false, el('span', { class: 'ins-sum-label' }, 'Diğer istasyonlar'), stationDirectory())));
    return out;
  }
  function stationDirectory() {
    var d = D();
    var zones = d.zones || {};
    var byZone = {};
    (d.nodes || []).forEach(function (n) { (byZone[n.zone] = byZone[n.zone] || []).push(n); });
    return el('div', { class: 'ins-dir' }, keysOf(zones).map(function (zid) {
      var list = byZone[zid] || [];
      if (!list.length) return null;
      var z = zones[zid];
      return el('div', { class: 'ins-dir-zone', 'data-line': z.line || null },
        el('p', { class: 'ins-dir-label' }, z.label),
        el('div', { class: 'ins-dir-chips' }, list.map(function (n) {
          return el('button', {
            type: 'button', class: 'chip ins-dir-chip', 'data-act': 'node', 'data-node': n.id, 'data-fk': 'dir-' + n.id,
            'aria-pressed': n.id === M.selectedNode ? 'true' : 'false'
          }, n.label);
        })));
    }));
  }
  function liveFor(id, s) {
    var rows = [], extra = null;
    var R = s.reports || {}, T = R.totals || {};
    var K = (s.kafka && s.kafka.offsets) || {};
    var u = s.user || {}, c = s.consent || {};
    var decs = decisionList();
    var lt = last(decs);
    var cfgV = (s.config && s.config.version) || 1;
    var P = D().partner || {};
    var cr = s.cleanroom || {};
    var lr = lastRunOf(s);
    function topic(t, label) { if (K[t] != null) rows.push([label || (t + ' offset'), fInt(K[t])]); }
    var lis = lineItemList();
    var prof = u.personId && s.profiles ? s.profiles[u.personId] : null;
    switch (id) {
      case 'browser':
        rows.push(['Sayfa', u.page || '—', false], ['Sepet', fInt((u.cart || []).length) + ' ürün'], ['1P çerez (fpc)', u.fpc || 'yok'], ['Oturum', u.loggedIn ? 'giriş yapıldı' : 'anonim', false]);
        break;
      case 'cmp': {
        var pp = c.purposes || {};
        var nOk = keysOf(pp).filter(function (k) { return pp[k]; }).length;
        rows.push(['Rıza', consentLabel(c.status), false], ['İzin verilen amaç', nOk + ' / ' + keysOf(pp).length], ['TC string', c.tcString ? shortH(c.tcString) : 'yok'], ['Karar zamanı', c.at ? fTime(c.at) : '—']);
        break;
      }
      case 'gateway': rows.push(['İstek/sn', fInt(R.qps)], ['Bugünkü reklam isteği', fInt(T.requests)]); break;
      case 'collector': topic('raw.web_events', 'raw.web_events offset'); rows.push(['Olay/sn (≈ istek × 2,6)', fInt(num(R.qps) * 2.6)]); break;
      case 'adapi': rows.push(['İstek/sn', fInt(R.qps)], ['Ziyaretçinin kararları', fInt(decs.length)]); break;
      case 'tracking': topic('ad.events', 'ad.events offset'); rows.push(['Gösterim (bugün)', fInt(T.impressions)], ['Tıklama (bugün)', fInt(T.clicks)]); break;
      case 'kafka': extra = topicTable(K); break;
      case 'flink': topic('enriched.events', 'enriched.events offset'); topic('ad.events', 'ad.events offset'); topic('dmp.segment_changes', 'dmp.segment_changes offset'); break;
      case 'identity':
        rows.push(['idmap kaydı', fInt(keysOf(s.idmap).length)], ['Ziyaretçinin kişisi', u.personId || '—']);
        topic('identity.merges', 'identity.merges offset');
        break;
      case 'profile':
        rows.push(['Profil (simülasyonda)', fInt(keysOf(s.profiles).length)], ['idmap kaydı', fInt(keysOf(s.idmap).length)], ['Ziyaretçi profili', prof ? u.personId + ' · v' + num(prof.ver, 1) : 'yok']);
        break;
      case 'segment':
        extra = segmentTable(s);
        topic('dmp.segment_changes', 'dmp.segment_changes offset');
        break;
      case 'activation': {
        var segs = keysOf(s.segments).map(function (k) { return s.segments[k]; });
        rows.push(['Dışa aktarılabilir segment', fInt(segs.filter(function (x) { return x.exportable !== false; }).length)], ['Aktarılamaz (clean room)', fInt(segs.filter(function (x) { return x.exportable === false; }).length)]);
        break;
      }
      case 'decision':
        if (lt) rows.push(['Son karar', fTime(lt.at) + ' · ' + ((lt.slot && lt.slot.id) || '')], ['Sunucu içi', fMs(lt.serverMs)], ['Header bidding dahil', fMs(lt.totalMs)], ['Kazanan', winnerName(lt), false]);
        else rows.push(['Son karar', 'henüz yok', false]);
        rows.push(['Config snapshot', 'v' + cfgV]);
        break;
      case 'tindex':
        rows.push(['Aktif line item', fInt(lis.filter(function (l) { return l.status === 'active'; }).length) + ' / ' + fInt(lis.length)], ['Config snapshot', 'v' + cfgV]);
        break;
      case 'fcap':
        if (prof && keysOf(prof.fcap).length) {
          keysOf(prof.fcap).forEach(function (k) {
            var li = liOf(k), e = prof.fcap[k];
            rows.push(['LI ' + k + (li ? ' · ' + li.name : ''), fInt(e.count) + ' / ' + (li && li.fcap ? li.fcap.max : '—')]);
          });
        } else rows.push(['Ziyaretçinin fcap sayaçları', 'yok']);
        lis.filter(function (l) { return l.goal; }).forEach(function (l) { rows.push(['Throttle · LI ' + l.id, fPct(num(l.throttle, 1), 0)]); });
        break;
      case 'ml':
        if (lt) {
          var sc = (lt.candidates || []).filter(function (x) { return x.status !== 'filtered'; });
          rows.push(['Son kararda skorlanan', fInt(sc.length) + ' aday']);
          sc.slice(0, 3).forEach(function (x) { rows.push([x.name, 'pCTR ' + fPct(x.pCtr, 2)]); });
        } else rows.push(['Son karar', 'henüz yok', false]);
        break;
      case 'auction':
        if (lt) rows.push(['Kazanan', winnerName(lt), false], ['Ödenen CPM', fTL(lt.winner && lt.winner.priceCpm)], ['Floor', fTL(lt.slot && lt.slot.floorCpm)]);
        else rows.push(['Son açık artırma', 'henüz yok', false]);
        break;
      case 'prebid':
        if (lt) {
          var bs = lt.bids || [];
          var cnt = function (st) { return bs.filter(function (b) { return b.status === st; }).length; };
          rows.push(['Teklif', fInt(bs.filter(function (b) { return b.cpm != null; }).length) + ' / ' + fInt(bs.length)], ['Zaman aşımı', fInt(cnt('timeout'))], ['Teklif yok', fInt(cnt('nobid'))]);
        }
        rows.push(['Timeout', fInt(num(D().bidderTimeoutMs, 120)) + ' ms']);
        break;
      case 'dsp':
        (D().bidders || []).forEach(function (b) { rows.push([b.name, 'teklif %' + fInt(b.bidRate * 100) + ' · kimlik ×' + fNum(b.idBoost, 1, 1)]); });
        break;
      case 'cdn':
        if (lt && lt.creative) rows.push(['Son kreatif', (lt.creative.brand || '') + ' — ' + (lt.creative.headline || ''), false]);
        else rows.push(['Son kreatif', 'henüz yok', false]);
        break;
      case 'clickhouse':
        rows.push(['Reklam isteği', fInt(T.requests)], ['Gösterim', fInt(T.impressions)], ['Görünür gösterim', fInt(T.viewables)], ['Tıklama', fInt(T.clicks)], ['Dönüşüm', fInt(T.conversions)], ['Gelir', fTL(T.revenueTL, 0)]);
        break;
      case 'iceberg': topic('raw.web_events', 'Arşive akan ham olay (offset)'); topic('ad.events', 'Arşive akan reklam olayı (offset)'); break;
      case 'pacer':
        lis.filter(function (l) { return l.goal; }).forEach(function (l) { rows.push(['LI ' + l.id + ' · ' + l.name, 'throttle ' + fPct(num(l.throttle, 1), 0)]); });
        break;
      case 'partner':
        rows.push(['Yüklenen kayıt', fInt(P.records)], ['Son agrega rapor', lr ? fInt(lr.matchedNoisy) + ' eşleşme' : '—']);
        break;
      case 'dcr':
        rows.push(['Çalıştırma', fInt((cr.runs || []).length)], ['Son gerçek eşleşme (TEE içi)', lr ? fInt(lr.matchedTrue) : '—'], ['Yayıncı hem', fInt(P.publisherHems)]);
        break;
      case 'policy':
        rows.push(['ε bütçesi', fNum(cr.epsilonUsed || 0, 1, 1) + ' / ' + fNum(cr.epsilonBudget || P.epsilonBudget || 10, 0)], ['k eşiği', 'k ≥ ' + fInt(cr.k || P.k || 50)], ['Asgari segment', fInt(cr.minSegment || P.minSegment || 1000) + ' kişi']);
        break;
      case 'admin':
        rows.push(['Aktif line item', fInt(lis.filter(function (l) { return l.status === 'active'; }).length)], ['Durdurulan', fInt(lis.filter(function (l) { return l.status === 'paused'; }).length)]);
        break;
      case 'postgres':
        rows.push(['Config sürümü', 'v' + cfgV]);
        lis.filter(function (l) { return num(l.version, 1) > 1; }).forEach(function (l) { rows.push(['line_items ' + l.id, 'version ' + l.version]); });
        break;
      case 'config':
        rows.push(['Config sürümü', 'v' + cfgV]);
        if (s.config && s.config.lastChange) rows.push(['Son değişiklik', changeText(s.config.lastChange), false]);
        topic('config.adserver', 'config.adserver offset');
        break;
      case 'privacy': {
        var ld = last(s.dsar || []);
        rows.push(['DSAR talebi', fInt((s.dsar || []).length)], ['Suppression listesi', fInt((s.suppression || []).length) + ' hash']);
        if (ld) rows.push(['Son talep', ld.id + ' · ' + (ld.status === 'done' ? 'tamamlandı' : 'sürüyor')]);
        break;
      }
      default: break;
    }
    return { rows: rows, extra: extra };
  }
  function topicTable(K) {
    var ids = topicIds();
    var lastTs = {};
    M.kafka.forEach(function (m) { lastTs[m.topic] = m.ts; });
    return el('div', { class: 'table-wrap', 'data-sk': 'ktopics' },
      el('table', { class: 'table ins-table ins-topics' },
        el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Konu'), el('th', { scope: 'col', class: 'num' }, 'Part.'), el('th', { scope: 'col', class: 'num' }, 'Offset'))),
        el('tbody', null, ids.map(function (t) {
          var tp = topicOf(t) || {};
          return el('tr', null,
            el('td', null, el('span', { class: 'ins-topic mono', 'data-line': tp.line || null }, t),
              el('span', { class: 'ins-c-sub' }, (tp.retention ? tp.retention : '') + (lastTs[t] ? ' · son ziyaretçi mesajı ' + fTime(lastTs[t]) : ''))),
            el('td', { class: 'num' }, tp.partitions != null ? fInt(tp.partitions) : '—'),
            el('td', { class: 'num' }, K[t] != null ? fInt(K[t]) : '—'));
        }))));
  }
  function segmentTable(s) {
    var segs = keysOf(s.segments).map(function (k) { return s.segments[k]; }).sort(function (a, b) { return num(a.id) - num(b.id); });
    return el('div', { class: 'table-wrap', 'data-sk': 'segtab' },
      el('table', { class: 'table ins-table ins-segtab' },
        el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Segment'), el('th', { scope: 'col', class: 'num' }, 'Tahmini kişi'))),
        el('tbody', null, segs.map(function (g) {
          return el('tr', null,
            el('td', null, el('span', { class: 'ins-c-name' }, g.name), el('span', { class: 'ins-c-sub' }, el('span', { class: 'mono' }, String(g.id)), ' · ' + LBL('segmentKind', g.kind, g.kind) + (g.exportable === false ? ' · dışa aktarılamaz' : ''))),
            el('td', { class: 'num' }, num(g.estimate) ? fCompact(g.estimate) : '—'));
        }))));
  }

  /* ==================================================================
   * Çizim tablosu ve dışa aktarım
   * ================================================================== */
  var RENDER = {
    flow: renderFlow,
    kafka: renderKafka,
    profile: renderProfile,
    decision: renderDecision,
    reports: renderReports,
    campaigns: renderCampaigns,
    cleanroom: renderCleanroom,
    node: renderNode
  };

  SIM.inspector = {
    mount: mount,
    show: show,
    selectNode: function (nodeId) { selectNode(nodeId, {}); },
    activeTab: function () { return M.active; },
    refresh: refresh,
    /** İstasyon sekmesindeki doküman bağlantısının öneki (index.html → docs/adtech-platform/). Tek dosyalık sürümde değiştirilebilir. */
    docsBase: '../',
    tabs: TABS.map(function (t) { return { id: t.id, label: t.label, line: t.line }; })
  };
})(window.SIM);

/* engine.js — [engine] SIM.engine + SIM.state (SPEC.md §6)
 *
 * Sıralı aksiyon kuyruğu, akışlar (istasyonlar arası "hop" dizileri), saf karar fonksiyonu (decide),
 * Kafka / Aerospike / ClickHouse / clean room durum modeli ve arka plan trafiği.
 * DOM'a DOKUNMAZ: görsel etkiler yalnızca (varsa) SIM.diagram API'si üzerinden, diğer modüller bus olaylarını dinler.
 *
 * Sözleşmeye eklenenler (SPEC'te yok, yalnızca ek):
 *   SIM.engine.stop()/start()          arka plan döngüsünü durdur / başlat (testler ve Node için)
 *   SIM.engine.demoHem()               demo e-postasının SHA-256 hash'i
 *   SIM.engine.isSuppressed()          ziyaretçinin kimliği suppression listesinde mi
 *   flow:start.parentFlowId            ölçüm akışı (imp + viewable) reklam isteği akışının alt akışıdır
 *   trace.requestId/impressionId/creative/withIds/runnerUp/headerBiddingMs/timeoutMs, aday ve tekliflerde ek alanlar
 *   kafka mesajında line ve flowId; user.sessionId/articleId/sku/lastOrder; reports.since/series/byLineItem.viewables
 */
if (typeof window === 'undefined') { globalThis.window = globalThis; }
window.SIM = window.SIM || {};

(function (SIM) {
  'use strict';

  var D = SIM.data;
  var u = SIM.util;
  var bus = SIM.bus;
  if (!D || !u || !bus) {
    try { console.error('[SIM.engine] core.js ve data.js engine.js’ten önce yüklenmeli.'); } catch (e) { /* yut */ }
    return;
  }

  /* ==================================================================
   * Sabitler
   * ================================================================== */
  var DAY = 86400000, HOUR = 3600000, MIN = 60000;
  var MAX_LOG = 150, MAX_DECISIONS = 20, SERIES_LEN = 60, MAX_COUNTER = 40;
  var TENANT = D.tenantId || 42;
  var SEED_PID = D.demoUser.seedPersonId;
  var ATTRIBUTION_WINDOW = 7 * DAY;
  var ALL_KEYS = ['user', 'consent', 'idmap', 'profiles', 'segments', 'lineItems', 'reports', 'kafka', 'decisions', 'cleanroom', 'dsar', 'config'];
  var L = D.labels || {};
  var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
  var IP_TRUNC = '88.241.37.0';
  var CONSENT_TEXT_VERSION = 'aydınlatma v3.2';
  var DSAR_STORES = ['profile', 'idmap', 'iceberg', 'clickhouse', 'cleanroom', 'partners'];

  /** SIM.state kimliği hiç değişmez; reset içeriği yerinde yeniden kurar (önbellekleyen modüller bozulmaz). */
  var S = SIM.state = SIM.state || {};

  /** Motorun iç durumu (SIM.state'e yazılmaz). */
  var G = {
    gen: 0,                  // reset sayacı: eski akışlar bunu görünce durur
    queue: [], running: false,
    initPromise: null, initialized: false,
    demoHem: null,
    clk0: 0,                 // simNow = simStart + (clock() - clk0)
    simNowVal: 0,
    timer: null, lastTickClock: 0, lastTickReal: 0,
    lastSampleReal: 0, lastStateEmitReal: 0, reportsDirty: false,
    lastPacerSim: 0, packetBudget: 0,
    acc: {},                 // arka plan trafiği için kesirli birikimler
    flowSeq: 0,
    badges: {}, lastBadgeForce: 0,
    lastBusy: null, lastQueue: null,
    supSet: {}               // suppression listesi için hızlı arama
  };

  function Stale() { this.stale = true; this.message = 'akış sıfırlama ile iptal edildi'; }

  /* ==================================================================
   * Küçük yardımcılar
   * ================================================================== */
  function num(x, d) { x = Number(x); return isFinite(x) ? x : (d === undefined ? 0 : d); }
  function round(x, d) { var p = Math.pow(10, d || 0); return Math.round(x * p) / p; }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function last(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
  function clone(x) { return u.clone(x); }
  function iso(ts) { try { return new Date(ts).toISOString(); } catch (e) { return ''; } }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function tl(n, d) { return u.fmtTL(n, d == null ? 2 : d); }
  function ctxLabel(cat) { return (D.contextLabels && D.contextLabels[cat]) || D.categoryLabels[cat] || cat || '—'; }
  function catText(cat) { return cat ? String(cat) : ''; }
  function parseTs(s) { var t = Date.parse(s); return isNaN(t) ? 0 : t; }
  function normEmail(e) { return String(e == null ? '' : e).trim().toLowerCase(); }

  function randHex(n) {
    var out = '', c = (typeof window.crypto !== 'undefined' && window.crypto && typeof window.crypto.getRandomValues === 'function') ? window.crypto : null;
    if (c) {
      var bytes = new Uint8Array(Math.ceil(n / 2));
      c.getRandomValues(bytes);
      for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
      return out.slice(0, n);
    }
    while (out.length < n) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  /** UUIDv7 benzeri: zaman sıralı (event_id, dedup anahtarı). */
  function uuid7(ts) {
    var h = Math.floor(num(ts, Date.now())).toString(16);
    h = pad(h, 12).slice(-12);
    var r = randHex(20);
    var variant = (8 + (parseInt(r.charAt(3), 16) & 3)).toString(16);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-7' + r.slice(0, 3) + '-' + variant + r.slice(4, 7) + '-' + r.slice(7, 19);
  }

  function hashOf(type, value) {
    if (type === 'hem') return String(value);           // hem zaten SHA-256
    return u.sha256HexSync(type + ':' + value);
  }

  /* ==================================================================
   * Zaman
   * ================================================================== */
  function clockNow() {
    try { return SIM.util.clock(); } catch (e) { return Date.now(); }
  }
  /**
   * simNow = 2026-10-31T10:00+03:00 + (hız ölçekli, duraklatma farkında saat).
   * SIM.state.simNow canlı bir getter'dır (her okumada güncel); değer monoton artar.
   */
  function syncNow() {
    var t = D.simStart + Math.max(0, clockNow() - G.clk0);
    if (!(t >= G.simNowVal)) t = G.simNowVal;
    G.simNowVal = t;
    return t;
  }
  function defineSimNow(obj) {
    Object.defineProperty(obj, 'simNow', {
      get: syncNow,
      set: function () { /* yalnızca motor ilerletir; dış yazımlar yok sayılır */ },
      enumerable: true, configurable: true
    });
  }

  /* ==================================================================
   * Bus / diagram kısayolları
   * ================================================================== */
  function emitState(keys) { bus.emit('state', { keys: keys }); }

  function diag(method) {
    var dg = SIM.diagram;
    if (!dg || typeof dg[method] !== 'function') return undefined;
    var args = Array.prototype.slice.call(arguments, 1);
    try { return dg[method].apply(dg, args); }
    catch (e) { try { console.error('[SIM.engine] SIM.diagram.' + method + ' hata verdi:', e); } catch (e2) { /* yut */ } }
    return undefined;
  }
  function pulse(nodeId, line, text) { diag('pulse', nodeId, { line: line, text: text }); }

  function setBadge(nodeId, text, force) {
    if (!force && G.badges[nodeId] === text) return;
    G.badges[nodeId] = text;
    diag('badge', nodeId, text);
  }
  function refreshBadges(force) {
    var dg = SIM.diagram;
    if (!dg || typeof dg.badge !== 'function') { G.badges = {}; return; }
    var lk = S.kafka && S.kafka.log && last(S.kafka.log);
    setBadge('kafka', lk ? u.fmtInt(lk.offset) : null, force);
    setBadge('profile', u.fmtInt(Object.keys(S.profiles || {}).length) + ' profil', force);
    var cr = S.cleanroom || {};
    setBadge('policy', 'ε ' + u.fmtNum(cr.epsilonUsed || 0, 1) + '/' + u.fmtNum(cr.epsilonBudget || 0, 0), force);
    setBadge('config', 'v' + ((S.config && S.config.version) || 1), force);
  }

  /* ==================================================================
   * Başlangıç durumu
   * ================================================================== */
  function seededSeries(seedKey) {
    var r = u.seeded(seedKey), q = 2440, out = [];
    for (var i = 0; i < SERIES_LEN; i++) {
      q += (r() - 0.5) * 150 + (2480 - q) * 0.08;
      q = clamp(q, 2050, 2950);
      out.push(Math.round(q));
    }
    return out;
  }

  function buildLineItems() {
    var map = {};
    D.lineItems.forEach(function (li) {
      var x = clone(li);
      var seed = li.seed || {};
      x.delivered = num(seed.delivered);
      x.spentTL = num(seed.spentTL);
      x.clicks = num(seed.clicks);
      x.conversions = num(seed.conversions);
      x.throttle = num(li.throttle, 1);
      x.baseThrottle = x.throttle;
      x.status = li.status || 'active';
      x.version = 1;
      map[li.id] = x;
    });
    return map;
  }

  function buildSegments() {
    var map = {};
    D.segments.forEach(function (s) { var x = clone(s); x.estimate = num(s.estimate); map[s.id] = x; });
    return map;
  }

  function buildReports(lineItems) {
    var by = {};
    Object.keys(lineItems).forEach(function (id) {
      var li = lineItems[id];
      by[id] = {
        impressions: li.delivered,
        viewables: Math.round(li.delivered * 0.67),
        clicks: li.clicks,
        conversions: li.conversions,
        revenueTL: round(li.spentTL, 2)
      };
    });
    // Bugün 00:00'dan 10:00'a kadar (gece trafiği düşük) — Raporlar sekmesi açılışta dolu görünsün.
    var requests = 41862317;
    var impressions = Math.round(requests * 0.934);
    return {
      totals: {
        requests: requests,
        impressions: impressions,
        viewables: Math.round(impressions * 0.684),
        clicks: Math.round(impressions * 0.0021),
        conversions: Math.round(impressions * 0.0021 * 0.025),
        revenueTL: round(impressions * 0.03146, 2)
      },
      byLineItem: by,
      qps: 2480,
      series: seededSeries('qps-seed'),
      since: Date.parse('2026-10-31T00:00:00+03:00'),
      periods: { totals: 'bugün 00:00’dan beri', byLineItem: 'kampanya başından beri' }
    };
  }

  function seedProfile(demoHem) {
    var du = D.demoUser;
    var created = Date.parse(du.seedAttrs.ilkGorulme + 'T19:42:00+03:00') || D.simStart - 109 * DAY;
    var ids = {};
    (du.seedIds || []).forEach(function (x) { ids[x.type + ':' + x.value] = Date.parse('2026-10-30T21:14:00+03:00'); });
    ids['hem:' + demoHem] = Date.parse('2026-09-02T02:00:00+03:00');   // CRM onboarding (sadakat programı)
    var seg = {};
    (du.seedSegments || []).forEach(function (id) {
      var s = D.segmentById[id];
      var base = s && s.kind === 'batch' ? Date.parse('2026-10-31T03:00:00+03:00') : Date.parse('2026-10-28T02:00:00+03:00');
      seg[id] = base + ((s && s.ttlDays) || 30) * DAY;
    });
    var attrs = { sehir: 'İstanbul', dil: 'tr', sadakat: 'gold' };
    Object.keys(du.seedAttrs || {}).forEach(function (k) { attrs[k] = du.seedAttrs[k]; });
    return {
      personId: SEED_PID,
      ids: ids,
      seg: seg,
      fcap: {},
      attrs: attrs,
      consent: { status: 'all', kanal: 'mobil uygulama', purposes: 1023, kvkkExplicit: true, tcf: null, updated: Date.parse('2026-07-14T19:42:00+03:00') },
      counters: {
        'anne-bebek': [Date.parse('2026-10-12T21:05:00+03:00'), Date.parse('2026-10-19T22:31:00+03:00'), Date.parse('2026-10-29T20:48:00+03:00')]
      },
      ver: 7,
      createdAt: created,
      updatedAt: Date.parse('2026-10-31T03:00:00+03:00'),
      source: 'mobil uygulama + CRM onboarding'
    };
  }

  /** Durumu SIM.data'dan (yerinde) kurar. */
  function buildState() {
    var hem = G.demoHem || u.sha256HexSync(normEmail(D.demoUser.email));
    G.demoHem = hem;
    G.clk0 = clockNow();
    G.simNowVal = D.simStart;
    var lineItems = buildLineItems();
    var offsets = {};
    Object.keys(D.topics || {}).forEach(function (t) { offsets[t] = D.topics[t].startOffset; });
    var idmap = {};
    (D.demoUser.seedIds || []).forEach(function (x) { idmap[x.type + ':' + x.value] = SEED_PID; });
    idmap['hem:' + hem] = SEED_PID;
    var profiles = {};
    profiles[SEED_PID] = seedProfile(hem);

    var st = {
      user: {
        personId: null, fpc: null, hem: null, email: null, loggedIn: false, cart: [],
        lastAd: null, clickedAd: null, suppressed: false, page: 'home',
        articleId: null, sku: null, sessionId: null, visited: false, lastOrder: null
      },
      consent: {
        status: 'unknown', tcString: null,
        purposes: { storage: false, measurement: false, profiling: false, personalizedAds: false },
        kvkkExplicit: false, at: null
      },
      idmap: idmap,
      profiles: profiles,
      segments: buildSegments(),
      lineItems: lineItems,
      reports: buildReports(lineItems),
      kafka: { offsets: offsets, log: [] },
      decisions: [],
      cleanroom: {
        epsilonBudget: D.partner.epsilonBudget, epsilonUsed: 0, epsilonPerRun: D.partner.epsilonPerRun,
        k: D.partner.k, minSegment: D.partner.minSegment, collaborationId: D.partner.collaborationId, runs: []
      },
      suppression: [],
      dsar: [],
      config: { version: 1, updatedAt: null, lastChange: null }
    };
    Object.keys(S).forEach(function (k) { delete S[k]; });
    defineSimNow(S);
    Object.keys(st).forEach(function (k) { S[k] = st[k]; });
    G.supSet = {};
    G.acc = {};
    G.lastPacerSim = S.simNow;
    G.reportsDirty = false;
    return S;
  }

  /* ==================================================================
   * Rıza, kimlik, suppression
   * ================================================================== */
  function purposesFor(choice) {
    if (choice === 'all') return { storage: true, measurement: true, profiling: true, personalizedAds: true };
    if (choice === 'necessary') return { storage: true, measurement: false, profiling: false, personalizedAds: false };
    return { storage: false, measurement: false, profiling: false, personalizedAds: false };
  }
  function purposesBitmask(p) {
    if (!p) return 0;
    if (p.profiling && p.personalizedAds && p.measurement && p.storage) return 1023;
    var m = 0;
    if (p.storage) m |= 1;
    if (p.measurement) m |= 2 | 256;
    if (p.profiling) m |= 4 | 8;
    if (p.personalizedAds) m |= 16 | 32 | 64 | 128 | 512;
    return m;
  }
  function canProfile() {
    var c = S.consent;
    return !!(c && c.status === 'all' && c.purposes && c.purposes.profiling && c.kvkkExplicit);
  }
  function canPersonalize() { return canProfile() && !!S.consent.purposes.personalizedAds; }
  function canMeasureIdentity() { return !!(S.consent && S.consent.purposes && S.consent.purposes.measurement); }

  function makeTcString(choice, ts) {
    var r = u.seeded('tc:' + choice + ':' + ts);
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    var s = 'CQ';
    for (var i = 0; i < 46; i++) s += A.charAt(Math.floor(r() * 64));
    return s + '.' + (choice === 'all' ? 'YAAAAAAAAAAA' : (choice === 'necessary' ? 'IAAAAAAA' : 'AAAA'));
  }

  function profileConsent(ts) {
    var c = S.consent;
    return {
      status: c.status, kanal: 'web', purposes: purposesBitmask(c.purposes), kvkkExplicit: !!c.kvkkExplicit,
      tcf: c.tcString ? u.shortHash(u.sha256HexSync(c.tcString)) : null, updated: ts
    };
  }

  function rebuildSupSet() {
    G.supSet = {};
    (S.suppression || []).forEach(function (h) { G.supSet[h] = 1; });
  }
  function addSuppression(h) {
    if (!h || G.supSet[h]) return false;
    S.suppression.push(h);
    G.supSet[h] = 1;
    return true;
  }
  function isSuppressedId(type, value) { return !!(value && G.supSet[hashOf(type, value)]); }
  /** Ziyaretçi suppression listesinde mi? (DSAR sonrası) */
  function isSuppressedUser() {
    var us = S.user;
    if (!us) return false;
    return !!(us.suppressed || isSuppressedId('fpc', us.fpc) || isSuppressedId('hem', us.hem));
  }

  /* ==================================================================
   * Kafka
   * ================================================================== */
  function publish(topic, key, value, f) {
    var t = D.topics[topic] || { partitions: 12, line: null, startOffset: 0 };
    var partition = u.hash32(String(key)) % t.partitions;
    var prev = S.kafka.offsets[topic];
    if (prev == null) prev = t.startOffset || 0;
    var offset = prev + 1;
    S.kafka.offsets[topic] = offset;
    var msg = {
      topic: topic, partition: partition, offset: offset, key: key, value: value, ts: syncNow(),
      line: t.line || null, flowId: f ? f.id : null
    };
    S.kafka.log.push(msg);
    if (S.kafka.log.length > MAX_LOG) S.kafka.log.splice(0, S.kafka.log.length - MAX_LOG);
    bus.emit('kafka', msg);
    emitState(['kafka']);
    refreshBadges(false);
    return msg;
  }

  function consentBlock() {
    var c = S.consent || {};
    return {
      tcf_string: c.tcString || '',
      gpp_string: c.tcString ? 'DBABMA~' + c.tcString.slice(2, 14) : '',
      purposes_bitmask: purposesBitmask(c.purposes),
      kvkk_explicit: !!c.kvkkExplicit,
      limit_ad_tracking: !(c.purposes && c.purposes.personalizedAds)
    };
  }
  function deviceRaw() { return { ua: UA, ip_truncated: IP_TRUNC }; }
  function deviceEnriched() {
    return { ua: UA, ip_truncated: IP_TRUNC, os: 'iOS', os_version: '18.1', device_type: 'mobile', country: 'TR', region: 'İstanbul', city: 'İstanbul' };
  }
  function browserIds(withHem) {
    var ids = [];
    if (S.user.fpc) ids.push({ type: 'fpc', value: S.user.fpc });
    if (withHem && S.user.hem) ids.push({ type: 'hem', value: S.user.hem });
    return ids;
  }

  /** 05-veri-modeli.md'deki EventEnvelope'a benzer JSON. */
  function envelope(o) {
    var now = syncNow();
    var cat = o.category && o.category !== 'anasayfa' ? o.category : null;
    var env = {
      event_id: o.eventId || uuid7(now),
      event_type: o.type,
      event_time: iso(now - (o.skewMs == null ? 85 : o.skewMs)),
      received_time: iso(now),
      tenant_id: TENANT,
      consent: consentBlock(),
      identity: { person_id: o.personId || '', ids: o.ids || [] },
      device: o.enriched ? deviceEnriched() : deviceRaw(),
      context: {
        site_or_bundle: D.site.domain,
        url: 'https://' + D.site.domain + (o.path || '/'),
        referrer: o.referrer || '',
        content_categories: cat ? [cat] : [],
        page_view_id: o.pageViewId || ''
      }
    };
    if (o.payloadKey) env[o.payloadKey] = o.payload || {};
    if (o.enriched) env.enrichment = { geo: 'İstanbul (GeoIP)', ua: 'iOS 18.1 · Safari · mobil', bot: false, consent_profiling: canProfile(), content_category: cat || '' };
    return env;
  }

  /* ==================================================================
   * Profil ve segmentler
   * ================================================================== */
  function activeSegIds(prof, now) {
    if (!prof || !prof.seg) return [];
    return Object.keys(prof.seg).filter(function (k) { return num(prof.seg[k]) > now; })
      .map(Number).sort(function (a, b) { return a - b; });
  }

  function newPersonId() {
    var id;
    do { id = u.uid('P'); } while (S.profiles[id] || id === SEED_PID);
    return id;
  }

  function newProfile(pid, now) {
    return {
      personId: pid, ids: {}, seg: {}, fcap: {},
      attrs: { sehir: 'İstanbul', cihaz: 'mobil', dil: 'tr' },
      consent: profileConsent(now), counters: {}, ver: 1, createdAt: now, updatedAt: now
    };
  }

  function touchProfile(prof, now) {
    prof.ver = (prof.ver || 0) + 1;
    prof.updatedAt = now;
  }

  /** fpc → person (yoksa oluşturur). Yalnızca profilleme rızası varken çağrılır. */
  function resolveFpc(now) {
    if (!S.user.fpc) S.user.fpc = randHex(16);
    var key = 'fpc:' + S.user.fpc;
    var pid = S.idmap[key];
    var created = false;
    if (!pid || !S.profiles[pid]) {
      pid = newPersonId();
      S.profiles[pid] = newProfile(pid, now);
      S.idmap[key] = pid;
      created = true;
    }
    S.profiles[pid].ids[key] = now;
    S.user.personId = pid;
    return { personId: pid, created: created, profile: S.profiles[pid] };
  }

  function pushCounter(prof, key, ts) {
    var arr = prof.counters[key] || (prof.counters[key] = []);
    arr.push(ts);
    if (arr.length > MAX_COUNTER) arr.splice(0, arr.length - MAX_COUNTER);
  }

  function applyEventToProfile(prof, ev, now) {
    if (ev.category && D.categoryLabels[ev.category] && (ev.type === 'page_view' || ev.type === 'product_view')) {
      pushCounter(prof, ev.category, now);
    }
    if (ev.type === 'add_to_cart' || ev.type === 'purchase' || ev.type === 'ad_click') pushCounter(prof, ev.type, now);
    if (S.user.fpc) prof.ids['fpc:' + S.user.fpc] = now;
    prof.consent = profileConsent(now);
    prof.lastSeen = now;
    touchProfile(prof, now);
  }

  function countWithin(counters, keys, since) {
    var n = 0;
    keys.forEach(function (k) { (counters[k] || []).forEach(function (ts) { if (ts > since) n++; }); });
    return n;
  }

  /** Gerçek zamanlı kural değerlendirme (SPEC §5.5): olay türü → kural indeksi; yalnızca ilgili kurallar. */
  function evaluateSegments(prof, evType, category, now) {
    var res = { added: [], removed: [], refreshed: [], checks: [] };
    if (!prof) return res;
    D.segments.forEach(function (seg) {
      var lg = seg.logic;
      if (!lg) return;
      var ok = false, n = null, min = null;
      if (lg.type === 'count') {
        if (lg.events.indexOf(evType) < 0 || lg.categories.indexOf(category) < 0) return;
        n = countWithin(prof.counters, lg.categories, now - lg.withinDays * DAY);
        min = lg.min;
        ok = n >= lg.min;
      } else if (lg.type === 'cart_abandon') {
        if (lg.events.indexOf(evType) < 0 && evType !== lg.without) return;
        var lastAdd = last(prof.counters.add_to_cart), lastBuy = last(prof.counters[lg.without]);
        ok = !!lastAdd && (!lastBuy || lastBuy < lastAdd);
      } else if (lg.type === 'event') {
        if (lg.events.indexOf(evType) < 0) return;
        n = countWithin(prof.counters, lg.events, now - lg.withinDays * DAY);
        min = lg.min;
        ok = n >= lg.min;
      } else {
        return;   // batch / crm / clean_room gerçek zamanlı değerlendirilmez
      }
      var member = num(prof.seg[seg.id]) > now;
      res.checks.push({ id: seg.id, ok: ok, n: n, min: min, member: member, type: lg.type });
      if (ok && !member) res.added.push(seg.id);
      else if (ok && member) res.refreshed.push(seg.id);
      else if (!ok && member) res.removed.push(seg.id);
    });
    return res;
  }

  function applySegChange(prof, res, now) {
    res.added.concat(res.refreshed).forEach(function (id) { prof.seg[id] = segExpiry(id, now); });
    res.removed.forEach(function (id) { delete prof.seg[id]; });
    res.added.forEach(function (id) { if (S.segments[id]) S.segments[id].estimate += 1; });
    res.removed.forEach(function (id) { if (S.segments[id]) S.segments[id].estimate = Math.max(0, S.segments[id].estimate - 1); });
    if (res.added.length || res.removed.length || res.refreshed.length) touchProfile(prof, now);
  }

  function segName(id) { var s = D.segmentById[id]; return s ? s.name : String(id); }

  function segExpiry(id, now) { var s = D.segmentById[id]; return now + ((s && s.ttlDays) || 30) * DAY; }

  function segChangeText(res, now) {
    var parts = [];
    res.added.forEach(function (id) {
      var s = D.segmentById[id];
      var c = null;
      res.checks.forEach(function (x) { if (x.id === id) c = x; });
      parts.push(id + ' “' + s.name + '” — ' + s.rule + (c && c.n != null ? ' (' + c.n + ')' : '') +
        ' ✓ → üyelik, bitiş ' + u.fmtDate(segExpiry(id, now)));
    });
    res.removed.forEach(function (id) { parts.push(id + ' “' + segName(id) + '” üyeliği düştü'); });
    if (parts.length) {
      return 'Segment Motoru: ' + parts.join('; ') + '. Theta sketch erişim tahmini güncellendi, dmp.segment_changes yayınlanıyor.';
    }
    if (res.refreshed.length) {
      return 'Segment Motoru: ' + res.refreshed.join(', ') + ' zaten üye — kural yeniden sağlandı, üyelik bitişi ' +
        u.fmtDate(segExpiry(res.refreshed[0], now)) + ' tarihine uzatıldı.';
    }
    if (res.checks.length) {
      return 'Segment Motoru: olay türü → kural indeksi; yalnızca ' + res.checks.map(function (c) {
        return c.id + (c.n != null ? ' (' + c.n + '/' + c.min + ')' : '');
      }).join(', ') + ' değerlendirildi — eşik altında, üyelik değişmedi.';
    }
    return 'Segment Motoru: bu olay türü için tetiklenen gerçek zamanlı kural yok; üyelik değişmedi.';
  }

  function emitSegChange(pid, added, removed, reason, f) {
    if (!added.length && !removed.length) return;
    bus.emit('segment:change', { personId: pid, added: added.slice(), removed: removed.slice() });
    var now = syncNow();
    var prof = S.profiles[pid];
    publish('dmp.segment_changes', TENANT + ':' + pid, {
      event_id: uuid7(now), event_time: iso(now), tenant_id: TENANT, person_id: pid,
      added: added.map(function (id) { return { segment_id: id, expire_at: prof && prof.seg[id] ? iso(prof.seg[id]) : null }; }),
      removed: removed.map(function (id) { return { segment_id: id }; }),
      reason: reason || 'realtime_rule', rule_engine: reason === 'clean_room' ? 'dcr' : 'flink'
    }, f);
  }

  function fcapCount(prof, li, now) {
    if (!prof || !li.fcap) return 0;
    var e = prof.fcap[String(li.id)];
    if (!e) return 0;
    if (now - e.windowStart >= li.fcap.windowH * HOUR) return 0;
    return e.count;
  }
  function incFcap(prof, li, now) {
    var k = String(li.id);
    var e = prof.fcap[k];
    var windowH = li.fcap ? li.fcap.windowH : 24;
    if (!e || now - e.windowStart >= windowH * HOUR) e = prof.fcap[k] = { count: 0, windowStart: now };
    e.count += 1;
    e.windowH = windowH;
    touchProfile(prof, now);
    return e.count;
  }

  /** Birleştirme: from → into (SPEC §6.6 login). */
  function mergeProfiles(from, into, now) {
    var a = S.profiles[from], b = S.profiles[into];
    var before = activeSegIds(a, now);
    var moved = Object.keys(a.ids);
    moved.forEach(function (k) { b.ids[k] = Math.max(num(b.ids[k]), num(a.ids[k])); });
    Object.keys(a.seg).forEach(function (k) { b.seg[k] = Math.max(num(b.seg[k]), num(a.seg[k])); });
    Object.keys(a.fcap).forEach(function (k) {
      var x = a.fcap[k], y = b.fcap[k];
      if (!y || x.windowStart > y.windowStart || x.count > y.count) b.fcap[k] = clone(x);
    });
    Object.keys(a.counters).forEach(function (k) {
      b.counters[k] = (b.counters[k] || []).concat(a.counters[k]).sort(function (p, q) { return p - q; }).slice(-MAX_COUNTER);
    });
    var devices = [];
    [b.attrs.cihaz, a.attrs.cihaz].concat(b.attrs.cihazlar || []).forEach(function (d) { if (d && devices.indexOf(d) < 0) devices.push(d); });
    var attrs = {};
    Object.keys(a.attrs).forEach(function (k) { attrs[k] = a.attrs[k]; });
    Object.keys(b.attrs).forEach(function (k) { attrs[k] = b.attrs[k]; });
    attrs.cihazlar = devices.map(function (d) { return d === 'mobil' ? 'mobil web' : d; });
    b.attrs = attrs;
    b.consent = clone(a.consent);             // en güncel rıza (web) geçerli
    b.ver = Math.max(num(a.ver), num(b.ver)) + 1;
    b.updatedAt = now;
    b.lastSeen = now;
    b.merged = (b.merged || []).concat([{ from: from, at: now }]);
    Object.keys(S.idmap).forEach(function (k) { if (S.idmap[k] === from) S.idmap[k] = into; });
    moved.forEach(function (k) { S.idmap[k] = into; });
    delete S.profiles[from];
    var after = activeSegIds(b, now);
    return { moved: moved, ids: Object.keys(b.ids), addedSegs: after.filter(function (id) { return before.indexOf(id) < 0; }) };
  }

  /* ==================================================================
   * Teslimat / pacing
   * ================================================================== */
  var flightCache = {};
  function flightOf(li) {
    if (!li.flight) return null;
    var k = li.id + '|' + li.flight.start + '|' + li.flight.end;
    if (!flightCache[k]) flightCache[k] = { start: parseTs(li.flight.start), end: parseTs(li.flight.end) };
    return flightCache[k];
  }
  /** Teslimat açığı: max(0, beklenen − teslim) / hedef, 0..0,5 aralığına kırpılır (gölge fiyat için). */
  function deliveryInfo(li, now) {
    if (!li || !li.goal || !li.goal.qty) return null;
    var fl = flightOf(li);
    if (!fl || !(fl.end > fl.start)) return null;
    var frac = clamp((now - fl.start) / (fl.end - fl.start), 0, 1);
    var expected = li.goal.qty * frac;
    var gap = expected - num(li.delivered);
    return {
      frac: frac, expected: Math.round(expected), delivered: num(li.delivered),
      error: gap / li.goal.qty,
      deficit: clamp(Math.max(0, gap) / li.goal.qty, 0, 0.5),
      ahead: Math.max(0, -gap) / li.goal.qty
    };
  }
  /** Bütçe temposu: harcanan / (bütçe × geçen uçuş oranı). 1 = planında. */
  function budgetPace(li, now) {
    var fl = flightOf(li);
    if (!li.budgetTL || !fl || !(fl.end > fl.start)) return null;
    var frac = clamp((now - fl.start) / (fl.end - fl.start), 0.0001, 1);
    return num(li.spentTL) / (li.budgetTL * frac);
  }
  /** PID benzeri oransal kontrol: taban throttle + Kp × hata (hedef eğrisinden sapma). */
  function pacerTarget(li, now, jitter) {
    var di = deliveryInfo(li, now);
    if (!di) return li.throttle;
    var base = num(li.baseThrottle, li.throttle);
    return round(clamp(base + 0.2 * di.error + (jitter || 0), 0.05, 1), 2);
  }

  /* ==================================================================
   * decide(ctx) — saf karar fonksiyonu (SPEC §6.5)
   * ================================================================== */
  function resolveSlot(slot) {
    if (slot && typeof slot === 'object') return { id: slot.id || 'mpu', size: slot.size || '300x250', floorCpm: num(slot.floorCpm, 30), code: slot.code || '' };
    var s = D.slots[slot] || D.slots.mpu;
    return { id: s.id, size: s.size, floorCpm: s.floorCpm, code: s.code };
  }

  function ecpmOf(li, pCtr, pCvr) {
    if (li.pricing === 'CPC') return num(li.rate) * pCtr * 1000;
    if (li.pricing === 'CPA') return num(li.rate) * pCtr * pCvr * 1000;
    return num(li.rate);
  }

  function rankOf(c) {
    if (c.status === 'won') return 0;
    if (c.status === 'lost' && c.type !== 'house') return 1;
    if (c.status === 'filtered') return 2;
    return 3;
  }

  /**
   * decide(ctx) -> trace
   * ctx: { requestId, impressionId?, slot:'mpu'|'home'|{…}, category, path, now?, consent?, personalized?, withIds?,
   *        personId?, profile?, segments? (profil yoksa), lineItems? (varsayılan SIM.state.lineItems), bidders? }
   * Aynı ctx + aynı durum → aynı sonuç (istek id'sinden tohumlanmış RNG). Durumu değiştirmez.
   */
  function decide(ctx) {
    ctx = ctx || {};
    var now = ctx.now != null ? num(ctx.now) : u.nowSim();
    var reqId = String(ctx.requestId || ctx.id || u.uid('req', 6));
    var rng = u.seeded('decide:' + reqId);
    var slot = resolveSlot(ctx.slot);
    var floor = slot.floorCpm;
    var category = ctx.category || 'anasayfa';
    var path = ctx.path || (category === 'anasayfa' ? '/' : '/' + category);
    var consent = ctx.consent || S.consent || { status: 'unknown', purposes: {} };
    var personalized = ctx.personalized != null ? !!ctx.personalized :
      !!(consent.status === 'all' && consent.purposes && consent.purposes.personalizedAds && ctx.personId);
    var profile = personalized ? (ctx.profile || null) : null;
    var personId = personalized ? (ctx.personId || (profile && profile.personId) || null) : null;
    var segs = profile ? activeSegIds(profile, now) : (personalized && Array.isArray(ctx.segments) ? ctx.segments.map(Number) : []);
    var withIds = ctx.withIds != null ? (!!ctx.withIds && personalized) : personalized;
    var lis = ctx.lineItems || S.lineItems || {};
    var list = Object.keys(lis).map(function (k) { return lis[k]; })
      .sort(function (a, b) { return (a.priority - b.priority) || (a.id - b.id); });

    /* ---- adaylar ---- */
    var candidates = [];
    var houseCand = null;
    list.forEach(function (li) {
      var t = li.targeting || {};
      var segT = t.segments || [], ctxT = t.contexts || [];
      var matched = segT.filter(function (s) { return segs.indexOf(s) >= 0; });
      var segMatch = matched.length > 0;
      var pCtr = round(num(li.baseCtr) * (segMatch ? 1.6 : 1), 6);
      var pCvr = round(num(li.baseCvr), 6);
      var c = {
        lineItemId: li.id, name: li.name, type: li.type, pricing: li.pricing, rate: num(li.rate), priority: li.priority,
        pCtr: pCtr, pCvr: pCvr, ecpm: 0, status: 'filtered', reason: '',
        segmentMatch: segMatch, matchedSegments: matched, throttle: num(li.throttle, 1)
      };
      var e = ecpmOf(li, pCtr, pCvr);
      if (li.type === 'standard') {
        var di = deliveryInfo(li, now);
        c.shadow = true;
        c.deficit = round(di ? di.deficit : 0, 4);
        e = e * (1 + c.deficit);
      }
      c.ecpm = round(e, 2);
      c.billingCpm = li.pricing === 'CPM' ? num(li.rate) : c.ecpm;

      if (li.type === 'house') {
        c.status = 'lost';
        c.reason = 'yalnızca doldurma (house)';
        if (li.status !== 'active') { c.status = 'filtered'; c.reason = 'durduruldu'; }
        houseCand = c;
        candidates.push(c);
        return;
      }
      candidates.push(c);
      if (li.status !== 'active') { c.reason = 'durduruldu'; return; }
      if (segT.length) {
        if (!personalized) { c.reason = 'rıza yok'; return; }
        if (!segMatch) { c.reason = 'hedefleme uymadı'; return; }
      } else if (t.requiresConsent && !personalized) { c.reason = 'rıza yok'; return; }
      if (ctxT.length && ctxT.indexOf(category) < 0) { c.reason = 'hedefleme uymadı'; return; }
      c.targeted = true;
      if (li.fcap && profile) {
        var n = fcapCount(profile, li, now);
        c.fcap = { count: n, max: li.fcap.max, windowH: li.fcap.windowH };
        if (n >= li.fcap.max) { c.reason = 'fcap ' + n + '/' + li.fcap.max; return; }
      }
      if (li.budgetTL != null && num(li.spentTL) >= num(li.budgetTL)) { c.reason = 'bütçe tükendi'; return; }
      var roll = u.hash32('pace:' + reqId + ':' + li.id) / 4294967296;
      c.pacingRoll = round(roll, 3);
      if (roll >= c.throttle) { c.reason = 'pacing throttle'; return; }
      if (c.billingCpm < floor) { c.reason = 'floor altı'; return; }
      c.status = 'eligible';
    });

    /* ---- header bidding (Prebid Server) ---- */
    var timeout = num(D.bidderTimeoutMs, 120);
    var bidders = ctx.bidders || D.bidders;
    var bids = bidders.map(function (b) {
      var latency = round(rng.range(b.latencyMs[0], b.latencyMs[1]), 0);
      var has = rng() < b.bidRate;
      var raw = rng.range(b.cpm[0], b.cpm[1]);
      var cpm = round(raw * (withIds ? b.idBoost : 1), 2);
      var bid = { bidder: b.id, name: b.name, cpm: null, latencyMs: latency, withIds: withIds, status: 'nobid', reason: 'teklif yok' };
      if (latency > timeout) {
        bid.status = 'timeout';
        bid.reason = 'zaman aşımı (> ' + timeout + ' ms)';
        if (has) bid.lateCpm = cpm;
        return bid;
      }
      if (!has) return bid;
      bid.cpm = cpm;
      if (cpm < floor) { bid.status = 'lost'; bid.reason = 'floor altı'; return bid; }
      bid.status = 'valid';
      bid.reason = '';
      return bid;
    });

    /* ---- birleşik açık artırma (first-price, floor) ---- */
    var pool = [];
    candidates.forEach(function (c) { if (c.status === 'eligible') pool.push({ kind: 'direct', c: c, ecpm: c.ecpm, prio: c.priority }); });
    bids.forEach(function (b) { if (b.status === 'valid') pool.push({ kind: 'prebid', b: b, ecpm: b.cpm, prio: 12 }); });
    pool.sort(function (x, y) { return (y.ecpm - x.ecpm) || (x.prio - y.prio); });
    var top = pool[0] || null;
    var winner;
    pool.forEach(function (p, i) {
      if (i === 0) return;
      if (p.kind === 'direct') { p.c.status = 'lost'; p.c.reason = 'daha düşük eCPM'; }
      else { p.b.status = 'lost'; p.b.reason = 'daha düşük teklif'; }
    });
    if (top && top.kind === 'direct') {
      top.c.status = 'won';
      top.c.reason = 'en yüksek eCPM';
      winner = { source: 'direct', lineItemId: top.c.lineItemId, bidder: null, priceCpm: round(top.c.billingCpm, 2), ecpm: top.c.ecpm,
        reason: top.c.shadow ? 'en yüksek eCPM (gölge fiyat)' : 'en yüksek eCPM' };
    } else if (top) {
      top.b.status = 'won';
      top.b.reason = 'en yüksek teklif';
      winner = { source: 'prebid', lineItemId: null, bidder: top.b.bidder, priceCpm: top.b.cpm, ecpm: top.b.cpm, reason: 'en yüksek teklif (first-price)' };
    } else if (houseCand && houseCand.status !== 'filtered') {
      houseCand.status = 'won';
      houseCand.reason = 'doldurma (house)';
      winner = { source: 'house', lineItemId: houseCand.lineItemId, bidder: null, priceCpm: 0, ecpm: 0, reason: 'floor üstü teklif yok → house' };
    } else {
      winner = { source: 'house', lineItemId: null, bidder: null, priceCpm: 0, ecpm: 0, reason: 'dolum yok (house durduruldu)' };
    }
    var second = pool[1] || null;
    var runnerUp = second ? (second.kind === 'direct'
      ? { source: 'direct', lineItemId: second.c.lineItemId, name: second.c.name, ecpm: second.ecpm }
      : { source: 'prebid', bidder: second.b.bidder, name: second.b.name, ecpm: second.ecpm }) : null;
    bids.forEach(function (b) { if (b.status === 'valid') { b.status = 'lost'; b.reason = 'daha düşük teklif'; } });
    candidates.forEach(function (c) { if (c.status === 'eligible') { c.status = 'lost'; c.reason = 'daha düşük eCPM'; } });

    /* ---- kreatif ---- */
    var creative;
    if (winner.source === 'prebid') {
      var bd = D.bidderById[winner.bidder];
      creative = clone((bd && bd.creative) || {});
      creative.programmatic = true;
      creative.bidder = winner.bidder;
      creative.bidderName = bd ? bd.name : winner.bidder;
    } else if (winner.lineItemId != null && lis[winner.lineItemId]) {
      creative = clone(lis[winner.lineItemId].creative || {});
      creative.adomain = lis[winner.lineItemId].adomain;
    } else {
      creative = { brand: D.site.name, headline: 'Bu alan şu an boş', body: 'Uygun reklam bulunamadı.', cta: 'Gündem+', theme: 'house', landing: { title: D.site.name } };
    }
    creative.lineItemId = winner.lineItemId;

    /* ---- gecikme şelalesi ---- */
    var hbMs = Math.min(Math.max.apply(null, bids.map(function (b) { return b.latencyMs; }).concat([0])), timeout);
    var timings = [];
    (D.decisionSteps || []).forEach(function (st) {
      if (st.parallel) { timings.push({ step: st.step, ms: round(hbMs, 1), parallel: true }); return; }
      var ms = round(rng.range(st.range[0], st.range[1]), 2);
      if (!personalized && (st.step === 'ID çözümleme' || st.step === 'Profil okuma')) {
        timings.push({ step: st.step, ms: 0, skipped: true, note: 'kişiselleştirme yok' });
        return;
      }
      timings.push({ step: st.step, ms: ms });
    });
    var serverMs = 0;
    timings.forEach(function (t) { if (!t.parallel) serverMs += t.ms; });
    serverMs = round(serverMs, 2);

    candidates.sort(function (a, b) {
      var ra = rankOf(a), rb = rankOf(b);
      if (ra !== rb) return ra - rb;
      if (ra === 1) return b.ecpm - a.ecpm;
      return (a.priority - b.priority) || (a.lineItemId - b.lineItemId);
    });

    return {
      id: reqId, requestId: reqId, impressionId: ctx.impressionId || ('imp-' + reqId.replace(/^req-?/, '')), at: now,
      slot: slot,
      context: { category: category, path: path, label: ctxLabel(category) },
      personalized: personalized, personId: personId, segments: segs, withIds: withIds,
      consentStatus: consent.status || 'unknown',
      candidates: candidates, bids: bids, winner: winner, runnerUp: runnerUp, creative: creative,
      timings: timings, serverMs: serverMs, headerBiddingMs: round(hbMs, 1), totalMs: round(serverMs + hbMs, 2), timeoutMs: timeout
    };
  }

  /* ==================================================================
   * Akış altyapısı
   * ================================================================== */
  function checkGen(f) { if (f && f.gen !== G.gen) throw new Stale(); }

  function startFlow(action, title, line, parent) {
    G.flowSeq += 1;
    var f = { id: 'F-' + pad(G.flowSeq, 4), gen: G.gen, action: action, title: title, line: line, parentId: parent ? parent.id : null };
    var p = { flowId: f.id, action: action, title: title, line: line };
    if (parent) p.parentFlowId = parent.id;
    bus.emit('flow:start', p);
    return f;
  }
  function endFlow(f) {
    if (!f || f.gen !== G.gen) return;
    bus.emit('flow:end', { flowId: f.id, action: f.action });
  }

  function narr(f, nodeId, line, text, kind) {
    if (f && f.gen !== G.gen) return;
    var p = { flowId: f ? f.id : null, text: text, kind: kind || 'info', ts: syncNow() };
    if (nodeId) p.nodeId = nodeId;
    if (line) p.line = line;
    bus.emit('narrate', p);
  }

  /** Bir hop: önce gate (adım modu), sonra diagram.travel (yoksa wait 600). Yalnızca SIM.data.edges'teki çiftler. */
  async function hop(f, from, to, line, label, size) {
    checkGen(f);
    await SIM.util.gate();
    checkGen(f);
    var eb = D.edgeBetween(from, to);
    if (!eb) {
      try { console.error('[SIM.engine] tanımsız kenar: ' + from + ' → ' + to); } catch (e) { /* yut */ }
      return false;
    }
    var lines = eb.edge.lines;
    if (lines.indexOf(line) < 0) line = lines[0];
    var dg = SIM.diagram;
    if (dg && typeof dg.travel === 'function') {
      var opts = { from: from, to: to, line: line, label: label };
      if (size) opts.size = size;
      try { await dg.travel(opts); }
      catch (e) {
        try { console.error('[SIM.engine] SIM.diagram.travel hata verdi:', e); } catch (e2) { /* yut */ }
        await SIM.util.wait(300);
      }
    } else {
      await SIM.util.wait(600);
    }
    checkGen(f);
    syncNow();
    return true;
  }

  /** İstasyonda kısa işleme beklemesi (hız ve duraklatma farkında). */
  async function proc(f, ms) {
    checkGen(f);
    await SIM.util.wait(ms);
    checkGen(f);
    syncNow();
  }

  /* ==================================================================
   * Akış: visit
   * ================================================================== */
  async function runVisit(f) {
    S.user.visited = true;
    S.user.page = 'home';
    if (!S.user.sessionId) S.user.sessionId = u.uid('S', 6);
    emitState(['user']);
    await hop(f, 'cmp', 'browser', 'privacy', "rıza banner'ı");
    pulse('browser', 'privacy', 'KVKK');
    narr(f, 'cmp', 'privacy', S.consent.status === 'unknown'
      ? 'CMP: KVKK aydınlatma metni ve açık rıza banner’ı gösterildi. Karar verilene kadar zorunlu olmayan çerez yazılmaz, olay toplanmaz; “Reddet” en az “Kabul et” kadar kolay.'
      : 'CMP: kayıtlı rıza bulundu (' + (L.consentStatus[S.consent.status] || S.consent.status) + '); banner yeniden gösterildi, karar her an değiştirilebilir.');
    return { ok: true };
  }

  /* ==================================================================
   * Akış: ortak olay girişi (browser → gateway → collector → kafka → flink)
   * ================================================================== */
  async function ingest(f, ev) {
    if (ev.browserText) narr(f, 'browser', 'dmp', ev.browserText);
    await hop(f, 'browser', 'gateway', 'dmp', ev.label);
    await hop(f, 'gateway', 'collector', 'dmp', ev.label);
    pulse('collector', 'dmp', '204');
    narr(f, 'collector', 'dmp', 'Collector: şema geçerli, received_time eklendi; tarayıcıya hemen 204 döndü (işlemenin bitmesi beklenmez). Olay raw.web_events konusuna yazılıyor.');
    await hop(f, 'collector', 'kafka', 'dmp', 'raw.web_events');
    var key = TENANT + ':' + (S.user.fpc ? 'fpc:' + S.user.fpc : 'anon:' + ev.eventId.slice(-8));
    var raw = envelope({
      type: ev.type, eventId: ev.eventId, category: ev.category, path: ev.path, pageViewId: ev.pageViewId,
      ids: ev.ids, payloadKey: ev.payloadKey, payload: ev.payload
    });
    var msg = publish('raw.web_events', key, raw, f);
    pulse('kafka', 'dmp', 'p' + msg.partition);
    narr(f, 'kafka', 'dmp', 'Kafka: raw.web_events · p' + msg.partition + ' · offset ' + u.fmtInt(msg.offset) +
      ' (anahtar tenant + ' + (S.user.fpc ? 'cihaz çerezi' : 'anonim cihaz') + '). Olay kalıcı, sıralı ve şemalı; Flink tüketiyor.');
    await hop(f, 'kafka', 'flink', 'dmp', ev.label);
    await proc(f, 220);
    return msg;
  }

  function makeEvent(type, info, payloadKey, payload, extra) {
    var now = syncNow();
    var ev = {
      type: type, label: (extra && extra.label) || type,
      category: info.category || null, path: info.path || '/', desc: info.desc || '',
      eventId: uuid7(now), pageViewId: info.pageViewId || u.uid('pv', 6),
      payloadKey: payloadKey, payload: payload,
      ids: browserIds(extra && extra.withHem)
    };
    if (extra) Object.keys(extra).forEach(function (k) { if (k !== 'label' && k !== 'withHem') ev[k] = extra[k]; });
    if (ev.browserText === undefined) {
      ev.browserText = 'Tarayıcı: collect.js ' + type + ' olayını' + (ev.desc ? ' (' + ev.desc + ')' : '') +
        ' sendBeacon ile gönderdi; olay ' + (S.user.fpc ? 'TC string ve 1P çerezi (fpc) taşıyor.' : 'TC string taşıyor, kimlik yok.');
    }
    return ev;
  }

  function pageInfo(action) {
    var page = action.page || 'home';
    var info = { page: page, category: null, path: '/', desc: '', title: '' };
    if (action.type === 'product_view' || page === 'product') {
      var p = D.productBySku[action.sku];
      info.page = 'product';
      info.sku = p ? p.sku : action.sku;
      info.category = p ? p.category : null;
      info.path = p ? p.path : '/pazar';
      info.title = p ? p.name : 'Ürün';
      info.product = p || null;
      info.desc = 'ürün · ' + info.title;
    } else if (page === 'article') {
      var a = D.articleById[action.articleId];
      info.articleId = a ? a.id : action.articleId;
      info.category = a ? a.category : null;
      info.path = a ? a.path : '/';
      info.title = a ? a.title : 'Makale';
      info.desc = 'makale · ' + (info.category || '—');
    } else if (page === 'home') {
      info.category = 'anasayfa'; info.path = '/'; info.title = 'Ana sayfa'; info.desc = 'ana sayfa';
    } else if (page === 'cart') {
      info.path = '/sepet'; info.title = 'Sepet'; info.desc = 'sepet';
    } else if (page === 'login') {
      info.path = '/giris'; info.title = 'Giriş'; info.desc = 'giriş sayfası';
    } else if (page === 'privacy') {
      info.path = '/gizlilik'; info.title = 'Gizlilik'; info.desc = 'gizlilik sayfası';
    }
    return info;
  }

  function itemOf(sku, qty) {
    var p = D.productBySku[sku];
    return { sku: sku, category: p ? p.category : '', brand: p ? p.brand : '', price_micros: p ? Math.round(p.priceTL * 1e6) : 0, qty: qty || 1 };
  }

  /** Rıza yokken (unknown) olay toplanmaz: collect.js CMP'ye sorar ve durur. */
  async function noConsentYet(f, what) {
    narr(f, 'browser', 'privacy', 'Rıza henüz verilmedi: collect.js CMP’ye sordu (__tcfapi) ve ' + what +
      ' göndermedi. KVKK gereği yalnızca zorunlu işleme yapılır; veri toplanmadı.', 'drop');
    await hop(f, 'browser', 'cmp', 'privacy', '__tcfapi');
    await hop(f, 'cmp', 'browser', 'privacy', 'rıza yok');
    pulse('browser', 'privacy', 'olay yok');
  }

  /**
   * DMP olay akışı (page_view / product_view / add_to_cart / purchase / ad olmayan diğerleri).
   * Profilleme izni yoksa: flink → iceberg (agrega) ve biter.
   */
  async function runDmpEvent(f, ev) {
    var res = { collected: false, profiled: false, personId: null, segChange: null };
    if (S.consent.status === 'unknown') { await noConsentYet(f, 'olayı'); return res; }
    await ingest(f, ev);
    res.collected = true;
    if (!canProfile()) {
      pulse('flink', 'dmp', 'agrega');
      narr(f, 'flink', 'dmp', 'Flink: şema ✓, bot değil. Profilleme izni yok (' + (L.consentStatus[S.consent.status] || S.consent.status) +
        ') → olay kimliksizleştirildi; kimlik çözümleme ve profil yazımı yok, yalnızca agrega analitiğe (Iceberg) gidiyor.', 'drop');
      await hop(f, 'flink', 'iceberg', 'dmp', 'agrega');
      pulse('iceberg', 'dmp', '+1 agrega');
      return res;
    }
    if (isSuppressedUser()) {
      pulse('flink', 'privacy', 'suppression');
      narr(f, 'flink', 'privacy', 'Flink: şema ✓ — ancak kimlik suppression listesinde (DSAR sonrası). Profil yeniden oluşturulmaz; olay yalnızca agrega analitiğe gider.', 'drop');
      await hop(f, 'flink', 'iceberg', 'dmp', 'agrega');
      return res;
    }
    pulse('flink', 'dmp', '✓ şema');
    narr(f, 'flink', 'dmp', 'Flink: şema doğrulandı, rıza = profilleme açık, bot değil; şehir İstanbul, cihaz mobil' +
      (ev.category && D.categoryLabels[ev.category] ? ', içerik kategorisi ' + catText(ev.category) : '') + ' olarak zenginleştirildi.');
    var pid = null, prof = null;
    await Promise.all([
      (async function () {
        await hop(f, 'flink', 'identity', 'dmp', 'fpc → person');
        var now = syncNow();
        var r = resolveFpc(now);
        pid = r.personId;
        pulse('identity', 'dmp', r.created ? 'yeni kişi' : pid);
        narr(f, 'identity', 'dmp', r.created
          ? 'Identity Graph: fpc:' + u.shortHash(S.user.fpc) + ' idmap’te yok → yeni kişi ' + pid + ' oluşturuldu; idmap’e “' + TENANT + ':fpc:…” → ' + pid + ' yazıldı.'
          : 'Identity Graph: idmap okuması (p99 < 1 ms): fpc:' + u.shortHash(S.user.fpc) + ' → ' + pid + '.');
        emitState(['user', 'idmap']);
        await hop(f, 'identity', 'profile', 'dmp', 'idmap');
        now = syncNow();
        prof = S.profiles[pid];
        if (!prof) { prof = S.profiles[pid] = newProfile(pid, now); }
        applyEventToProfile(prof, ev, now);
        pulse('profile', 'dmp', 'v' + prof.ver);
        var ctr = '';
        if (ev.category && D.categoryLabels[ev.category] && (ev.type === 'page_view' || ev.type === 'product_view')) {
          ctr = ' — ' + catText(ev.category) + ' görüntüleme sayacı ' + countWithin(prof.counters, [ev.category], now - 7 * DAY) + ' (son 7 gün)';
        } else if (ev.type === 'add_to_cart') ctr = ' — sepete ekleme kaydı';
        else if (ev.type === 'purchase') ctr = ' — satın alma kaydı';
        narr(f, 'profile', 'dmp', 'Aerospike: profil “' + TENANT + ':' + pid + '” güncellendi (v' + prof.ver + ')' + ctr + '.');
        emitState(['profiles']);
        refreshBadges(false);
      })(),
      (async function () {
        await hop(f, 'flink', 'iceberg', 'dmp', 'arşiv');
        pulse('iceberg', 'dmp', 'arşiv');
      })()
    ]);
    res.profiled = true;
    res.personId = pid;
    publish('enriched.events', TENANT + ':' + pid, envelope({
      type: ev.type, eventId: ev.eventId, category: ev.category, path: ev.path, pageViewId: ev.pageViewId,
      personId: pid, ids: ev.ids, enriched: true, payloadKey: ev.payloadKey, payload: ev.payload, skewMs: 140
    }), f);
    await hop(f, 'flink', 'segment', 'dmp', 'kural');
    var now2 = syncNow();
    prof = S.profiles[pid];
    var ch = evaluateSegments(prof, ev.type, ev.category, now2);
    res.segChange = ch;
    var text = segChangeText(ch, now2);
    if (ch.added.length || ch.removed.length) {
      pulse('segment', 'dmp', ch.added.map(function (x) { return '+' + x; }).concat(ch.removed.map(function (x) { return '−' + x; })).join(' '));
      narr(f, 'segment', 'dmp', text, 'ok');
      await hop(f, 'segment', 'profile', 'dmp', 'üyelik yaz');
      prof = S.profiles[pid] || prof;
      applySegChange(prof, ch, now2);
      pulse('profile', 'dmp', 'v' + prof.ver);
      emitSegChange(pid, ch.added, ch.removed, 'realtime_rule', f);
      emitState(['profiles', 'segments']);
    } else {
      if (ch.refreshed.length) applySegChange(prof, ch, now2);
      narr(f, 'segment', 'dmp', text);
      if (ch.refreshed.length) emitState(['profiles']);
    }
    return res;
  }

  /* ==================================================================
   * Akış: consent
   * ================================================================== */
  async function runConsent(f, action) {
    var choice = action.choice;
    if (choice !== 'all' && choice !== 'necessary' && choice !== 'reject') {
      narr(f, 'cmp', 'privacy', 'Geçersiz rıza seçimi: ' + choice + ' — “all”, “necessary” veya “reject” olmalı.', 'warn');
      return { ok: false };
    }
    var prev = S.consent.status;
    narr(f, 'browser', 'privacy', 'Ziyaretçi “' + (L.consentChoice[choice] || choice) + '” seçti; karar CMP’ye iletiliyor.');
    await hop(f, 'browser', 'cmp', 'privacy', 'karar');
    await proc(f, 250);
    var now = syncNow();
    var tc = makeTcString(choice, now);
    var c = S.consent;
    c.status = choice;
    c.tcString = tc;
    c.purposes = purposesFor(choice);
    c.kvkkExplicit = choice === 'all';
    c.at = now;
    c.textVersion = CONSENT_TEXT_VERSION;
    c.channel = 'web';
    pulse('cmp', 'privacy', 'TC string');
    narr(f, 'cmp', 'privacy', choice === 'all'
      ? 'CMP: karar IAB TCF 2.2 TC string’e kodlandı (' + tc.slice(0, 10) + '…), kvkk_explicit = true. Rıza kaydı (zaman, metin sürümü, kanal) ispat için değiştirilemez şekilde saklanır.'
      : (choice === 'necessary'
        ? 'CMP: karar TC string’e kodlandı (' + tc.slice(0, 10) + '…); yalnızca zorunlu amaç (cihazda saklama) açık — ölçüm, profilleme ve kişiselleştirilmiş reklam kapalı, kvkk_explicit = false. Rıza kaydı yine ispat için saklanır.'
        : 'CMP: karar TC string’e kodlandı (' + tc.slice(0, 10) + '…); isteğe bağlı tüm amaçlar kapalı, kvkk_explicit = false. Ret kaydı da ispat için saklanır.'));
    emitState(['consent']);
    await hop(f, 'cmp', 'browser', 'privacy', 'TC string');
    var withdrawn = prev === 'all' && choice !== 'all';
    if (choice === 'all') {
      var created = !S.user.fpc;
      if (created) S.user.fpc = randHex(16);
      pulse('browser', 'privacy', 'fpc');
      narr(f, 'browser', 'privacy', (created ? '1P çerez yazıldı: ' : '1P çerez korunuyor: ') + 'fpc = ' + u.shortHash(S.user.fpc) +
        ' — gundem.example alan adından, sunucu tarafında (HttpOnly · Secure · SameSite=Lax). Bu tarayıcının kalıcı 1. parti kimliği.', 'ok');
    } else {
      var had = !!S.user.fpc;
      S.user.fpc = null;
      narr(f, 'browser', 'privacy', choice === 'necessary'
        ? 'Yalnızca zorunlu: 1P çerez (fpc) ' + (had ? 'silindi' : 'yazılmadı') + ', yalnızca oturum çerezi var. Olaylar kimliksiz işlenecek, reklamlar kontekstüel.'
        : 'Reddedildi: zorunlu olmayan hiçbir çerez yazılmadı' + (had ? ' (mevcut fpc silindi)' : '') + '; kişisel veri işlenmeyecek, reklamlar yalnızca kontekstüel.',
        choice === 'reject' ? 'warn' : 'info');
    }
    emitState(['consent', 'user']);
    var evType = withdrawn ? 'consent_withdrawn' : 'consent_update';
    var cur = pageInfo({ type: 'page_view', page: S.user.page, articleId: S.user.articleId, sku: S.user.sku });
    var ev = makeEvent(evType, { path: cur.path }, 'custom',
      { name: evType, props: { choice: choice, tcf_version: '2.2', text_version: CONSENT_TEXT_VERSION, channel: 'web', previous: prev } },
      { label: 'consent_update', browserText: null });
    await ingest(f, ev);
    pulse('flink', 'privacy', '✓ rıza');
    var pid = S.user.personId;
    var prof = pid ? S.profiles[pid] : null;
    if (withdrawn && prof) {
      narr(f, 'flink', 'privacy', 'Flink: rıza geri çekildi (consent_withdrawn) → profil anında “kişiselleştirme kapalı” moduna alınıyor ve segment üyelikleri siliniyor.', 'warn');
      await hop(f, 'flink', 'profile', 'privacy', 'rıza geri çekildi');
      var now2 = syncNow();
      var removed = activeSegIds(prof, now2);
      removed.forEach(function (id) { delete prof.seg[id]; if (S.segments[id]) S.segments[id].estimate = Math.max(0, S.segments[id].estimate - 1); });
      prof.consent = profileConsent(now2);
      prof.personalization = false;
      touchProfile(prof, now2);
      pulse('profile', 'privacy', removed.length ? '−' + removed.length + ' seg' : 'v' + prof.ver);
      narr(f, 'profile', 'privacy', 'Aerospike: ' + pid + ' profilinde rıza güncellendi (v' + prof.ver + ')' +
        (removed.length ? '; ' + removed.length + ' segment üyeliği silindi (' + removed.join(', ') + ').' : '; silinecek segment üyeliği yoktu.'), 'ok');
      emitSegChange(pid, [], removed, 'consent_withdrawn', f);
      emitState(['profiles', 'segments']);
    } else {
      if (prof && choice === 'all') { prof.consent = profileConsent(syncNow()); prof.personalization = true; }
      narr(f, 'flink', 'privacy', 'Flink: rıza kaydı işlendi. Bundan sonra her olay Consent alanını (TC string, amaçlar, kvkk_explicit) taşır; downstream servisler kararı bu alandan verir, merkezi bir servise sormaz.', 'ok');
    }
    return { ok: true, consent: clone(S.consent) };
  }

  /* ==================================================================
   * Akış: page_view / product_view / add_to_cart / purchase
   * ================================================================== */
  async function runPageView(f, action) {
    var info = pageInfo(action);
    S.user.page = info.page;
    S.user.articleId = info.articleId || null;
    S.user.sku = info.sku || null;
    emitState(['user']);
    var type = info.page === 'product' ? 'product_view' : 'page_view';
    var payloadKey = type === 'product_view' ? 'commerce' : 'page_view';
    var payload = type === 'product_view'
      ? { type: 'product_view', order_id: '', revenue_micros: 0, currency: 'TRY', items: [itemOf(info.sku, 1)] }
      : { scroll_depth: 0, dwell_ms: 0, title: info.title };
    var ev = makeEvent(type, info, payloadKey, payload, { label: type });
    var r = await runDmpEvent(f, ev);
    r.ok = true;
    return r;
  }

  async function runAddToCart(f, action) {
    var p = D.productBySku[action.sku];
    if (!p) { narr(f, 'browser', 'dmp', 'Bilinmeyen ürün: ' + action.sku + ' — sepete eklenmedi.', 'warn'); return { ok: false }; }
    S.user.cart.push(p.sku);
    emitState(['user']);
    var ev = makeEvent('add_to_cart', { category: p.category, path: p.path, desc: 'sepete: ' + p.name }, 'commerce',
      { type: 'add_to_cart', order_id: '', revenue_micros: Math.round(p.priceTL * 1e6), currency: 'TRY', items: [itemOf(p.sku, 1)] },
      { label: 'add_to_cart' });
    var r = await runDmpEvent(f, ev);
    r.ok = true;
    return r;
  }

  async function runPurchase(f) {
    var cart = S.user.cart.slice();
    if (!cart.length) {
      narr(f, 'browser', 'dmp', 'Sepet boş — satın alınacak ürün yok.', 'warn');
      return { ok: false, reason: 'sepet boş' };
    }
    var qty = {};
    cart.forEach(function (sku) { qty[sku] = (qty[sku] || 0) + 1; });
    var items = Object.keys(qty).map(function (sku) { return itemOf(sku, qty[sku]); });
    var revenueTL = 0;
    items.forEach(function (it) { revenueTL += it.price_micros / 1e6 * it.qty; });
    var now = syncNow();
    var orderId = 'SIP-' + u.uid('', 6);
    S.user.cart = [];
    S.user.page = 'cart';
    S.user.lastOrder = { orderId: orderId, revenueTL: revenueTL, items: cart, at: now };
    emitState(['user']);
    var ev = makeEvent('purchase', { path: '/sepet/odeme', desc: u.fmtTL(revenueTL, 0) + ', ' + items.length + ' kalem' }, 'commerce',
      { type: 'purchase', order_id: orderId, revenue_micros: Math.round(revenueTL * 1e6), currency: 'TRY', items: items },
      { label: 'purchase' });
    var r = await runDmpEvent(f, ev);
    r.ok = true;
    r.orderId = orderId;
    r.conversion = null;

    // Atıflama: reklam tıklamasından sonra gelen satın alma → dönüşüm (post-click, 7 gün)
    var clk = S.user.clickedAd;
    if (clk && !clk.converted && r.collected) {
      var age = syncNow() - num(clk.clickedAt);
      if (!canMeasureIdentity() || isSuppressedUser()) {
        narr(f, 'flink', 'measure', 'Atıflama yapılmadı: ölçüm izni yok veya kimlik suppression listesinde — dönüşüm yalnızca kimliksiz agrega sayılır.', 'drop');
      } else if (age > ATTRIBUTION_WINDOW) {
        narr(f, 'flink', 'measure', 'Atıflama yapılmadı: tıklama 7 günlük post-click penceresinin dışında.', 'drop');
      } else {
        pulse('flink', 'measure', 'atıflama');
        narr(f, 'flink', 'measure', 'Flink: atıflama — satın alma, ' + Math.max(1, Math.round(age / MIN)) + ' dk önceki “' +
          ((clk.creative && clk.creative.brand) || 'reklam') + '” tıklamasına bağlandı (post-click, 7 gün penceresi) → dönüşüm.');
        await hop(f, 'flink', 'clickhouse', 'measure', 'conversion');
        var conv = recordConversion(clk, revenueTL);
        clk.converted = true;
        clk.orderId = orderId;
        publish('ad.events', TENANT + ':' + clk.impressionId, adEventEnvelope('conversion', clk, { value_micros: Math.round(revenueTL * 1e6), order_id: orderId }), f);
        pulse('clickhouse', 'measure', '+1 dönüşüm');
        narr(f, 'clickhouse', 'measure', 'ClickHouse: dönüşüm +1' + (conv.lineItem ? ' (' + conv.lineItem.id + ' · ' + conv.lineItem.name + ')' : ' (programatik reklamveren)') +
          (conv.billedTL > 0 ? '; CPA kampanya dönüşüm başına faturalandı: +' + tl(conv.billedTL) + '.' : '; bu kampanya CPA değil, dönüşüm yalnızca raporlanır.'), 'ok');
        emitState(['user', 'reports', 'lineItems']);
        r.conversion = conv;
      }
    }
    return r;
  }

  /* ==================================================================
   * Akış: login (kimlik bağlama / birleştirme)
   * ================================================================== */
  async function runLogin(f, action) {
    var email = normEmail(action.email || D.demoUser.email);
    var hem = await SIM.util.sha256Hex(email);
    checkGen(f);
    S.user.email = email;
    S.user.hem = hem;
    S.user.loggedIn = true;
    if (email === normEmail(D.demoUser.email)) S.user.displayName = D.demoUser.displayName || null;
    emitState(['user']);
    pulse('browser', 'dmp', 'SHA-256');
    narr(f, 'browser', 'dmp', 'Tarayıcı: e-posta normalize edildi (trim + küçük harf) ve SHA-256 ile hash’lendi → hem ' + u.shortHash(hem) + '. Ham e-posta sunucuya hiç gitmez.');
    await proc(f, 300);
    var res = { ok: true, hem: hem, merged: false, personId: null };
    if (S.consent.status === 'unknown') { await noConsentYet(f, 'identity_link olayını'); return res; }
    var profiling = canProfile();
    var ev = makeEvent(profiling ? 'identity_link' : 'login', { path: '/giris' }, profiling ? 'identity_link' : 'custom',
      profiling ? { a: { type: 'fpc', value: S.user.fpc }, b: { type: 'hem', value: hem }, link_type: 'login', confidence: 1 }
        : { name: 'login', props: { method: 'email' } },
      { label: profiling ? 'identity_link' : 'login', withHem: profiling,
        browserText: profiling ? 'Tarayıcı: identity_link {fpc, hem} olayı gönderildi — aynı olayda birlikte görülen iki kimlik deterministik bağlantıdır.'
          : 'Tarayıcı: oturum açıldı; profilleme izni olmadığı için hem gönderilmiyor, yalnızca kimliksiz login olayı.' });
    await ingest(f, ev);
    if (!profiling) {
      narr(f, 'flink', 'dmp', 'Flink: profilleme izni yok → kimlik bağlama yapılmaz; login yalnızca agrega sayılır.', 'drop');
      await hop(f, 'flink', 'iceberg', 'dmp', 'agrega');
      return res;
    }
    if (isSuppressedUser()) {
      narr(f, 'flink', 'privacy', 'Flink: hem/fpc suppression listesinde (DSAR sonrası) → kimlik grafiğine bağlanmaz, profil yeniden oluşmaz.', 'drop');
      pulse('flink', 'privacy', 'suppression');
      await hop(f, 'flink', 'iceberg', 'dmp', 'agrega');
      return res;
    }
    pulse('flink', 'dmp', '✓ şema');
    narr(f, 'flink', 'dmp', 'Flink: identity_link doğrulandı (link_type = login, confidence 1,0) → Identity Graph’a gerçek zamanlı bağlantı.');
    await hop(f, 'flink', 'identity', 'dmp', 'fpc + hem');
    await proc(f, 280);
    var now = syncNow();
    if (!S.user.fpc) S.user.fpc = randHex(16);
    var fpcKey = 'fpc:' + S.user.fpc, hemKey = 'hem:' + hem;
    var pF = S.idmap[fpcKey] && S.profiles[S.idmap[fpcKey]] ? S.idmap[fpcKey] : null;
    var pH = S.idmap[hemKey] && S.profiles[S.idmap[hemKey]] ? S.idmap[hemKey] : null;
    var into, from = null, kind, mres = null;
    if (pF && pH && pF !== pH) {
      into = S.profiles[pH].createdAt <= S.profiles[pF].createdAt ? pH : pF;
      from = into === pH ? pF : pH;
      kind = 'merge';
      mres = mergeProfiles(from, into, now);
    } else if (pF && pH) {
      into = pF; kind = 'same';
    } else if (pH) {
      into = pH; kind = 'link-fpc';
      S.idmap[fpcKey] = into;
      S.profiles[into].ids[fpcKey] = now;
      touchProfile(S.profiles[into], now);
    } else if (pF) {
      into = pF; kind = 'link-hem';
      S.idmap[hemKey] = into;
      S.profiles[into].ids[hemKey] = now;
      touchProfile(S.profiles[into], now);
    } else {
      into = newPersonId(); kind = 'new';
      S.profiles[into] = newProfile(into, now);
      S.profiles[into].ids[fpcKey] = now;
      S.profiles[into].ids[hemKey] = now;
      S.idmap[fpcKey] = into;
      S.idmap[hemKey] = into;
    }
    var prevPid = S.user.personId;
    S.user.personId = into;
    var prof = S.profiles[into];
    if (kind === 'merge') {
      pulse('identity', 'dmp', 'birleşti');
      narr(f, 'identity', 'dmp', 'Identity Graph: deterministik bağlantı! hem → ' + into + (into === SEED_PID ? ' (mobil uygulama, maid + CRM)' : '') +
        ', fpc → ' + from + '. İki kişi ' + into + ' altında birleştirildi; identity.merges olayı yayınlanıyor.', 'ok');
      bus.emit('identity:merge', { from: from, into: into, ids: mres.ids.slice(), moved: mres.moved.slice() });
      publish('identity.merges', TENANT + ':' + into, {
        event_id: uuid7(now), event_time: iso(now), tenant_id: TENANT, merge_id: u.uid('M', 6),
        from_person: from, into_person: into, moved_ids: mres.moved, ids: mres.ids, link_type: 'login', confidence: 1, ver: prof.ver
      }, f);
      res.merged = true;
    } else if (kind === 'link-fpc') {
      pulse('identity', 'dmp', into);
      narr(f, 'identity', 'dmp', 'Identity Graph: hem → ' + into + ' zaten biliniyordu; bu tarayıcının fpc’si aynı kişiye bağlandı.', 'ok');
    } else if (kind === 'link-hem') {
      pulse('identity', 'dmp', into);
      narr(f, 'identity', 'dmp', 'Identity Graph: bu hem ilk kez görülüyor → mevcut kişi ' + into + '’ye bağlandı (fpc + hem).', 'ok');
    } else if (kind === 'new') {
      pulse('identity', 'dmp', 'yeni kişi');
      narr(f, 'identity', 'dmp', 'Identity Graph: fpc ve hem ilk kez görülüyor → yeni kişi ' + into + ' (iki kimlikle) oluşturuldu.', 'ok');
    } else {
      pulse('identity', 'dmp', into);
      narr(f, 'identity', 'dmp', 'Identity Graph: fpc ve hem zaten aynı kişide (' + into + '); yalnızca last_seen güncellendi.');
    }
    emitState(['user', 'idmap', 'profiles']);
    await hop(f, 'identity', 'profile', 'dmp', kind === 'merge' ? 'birleştir' : 'idmap');
    now = syncNow();
    prof = S.profiles[into];
    prof.consent = profileConsent(now);
    prof.lastSeen = now;
    if (kind !== 'merge') touchProfile(prof, now);
    var segs = activeSegIds(prof, now);
    pulse('profile', 'dmp', 'v' + prof.ver);
    narr(f, 'profile', 'dmp', (kind === 'merge'
      ? 'Aerospike: profiller tek kayıtta birleşti (v' + prof.ver + '): '
      : 'Aerospike: profil ' + into + ' güncellendi (v' + prof.ver + '): ') +
      Object.keys(prof.ids).length + ' kimlik (' + Object.keys(prof.ids).map(function (k) { return k.split(':')[0]; }).join(', ') + '), segmentler ' +
      (segs.length ? segs.join(', ') : 'yok') + (kind === 'merge' ? '. Eski kayıt silindi, idmap yeni kişiyi gösteriyor.' : '.'), 'ok');
    if (kind === 'merge' && mres.addedSegs.length) emitSegChange(into, mres.addedSegs, [], 'identity_merge', f);
    else if (kind === 'link-fpc' && prevPid !== into && segs.length) bus.emit('segment:change', { personId: into, added: segs, removed: [] });
    publish('enriched.events', TENANT + ':' + into, envelope({
      type: 'identity_link', eventId: ev.eventId, path: '/giris', personId: into, ids: ev.ids, enriched: true,
      payloadKey: 'identity_link', payload: ev.payload, skewMs: 140
    }), f);
    emitState(['user', 'idmap', 'profiles', 'segments']);
    refreshBadges(false);
    res.personId = into;
    res.kind = kind;
    return res;
  }

  /* ==================================================================
   * Raporlama / faturalama
   * ================================================================== */
  function byLi(id) {
    var by = S.reports.byLineItem;
    return by[id] || (by[id] = { impressions: 0, viewables: 0, clicks: 0, conversions: 0, revenueTL: 0 });
  }

  function recordImpression(trace) {
    var w = trace.winner, T = S.reports.totals;
    var rev = 0, li = null;
    T.impressions += 1;
    if (w.source === 'prebid') rev = w.priceCpm / 1000;
    if (w.lineItemId != null && S.lineItems[w.lineItemId]) {
      li = S.lineItems[w.lineItemId];
      li.delivered += 1;
      if (li.pricing === 'CPM' && w.source === 'direct') { rev = w.priceCpm / 1000; li.spentTL = round(li.spentTL + rev, 4); }
      var b = byLi(li.id);
      b.impressions += 1;
      b.revenueTL = round(b.revenueTL + rev, 4);
    }
    T.revenueTL = round(T.revenueTL + rev, 4);
    return { revenueTL: rev, lineItem: li };
  }

  function recordClick(ad) {
    var T = S.reports.totals;
    T.clicks += 1;
    var billed = 0, li = null;
    if (ad.lineItemId != null && S.lineItems[ad.lineItemId]) {
      li = S.lineItems[ad.lineItemId];
      li.clicks += 1;
      var b = byLi(li.id);
      b.clicks += 1;
      if (li.pricing === 'CPC' && ad.source === 'direct') {
        billed = num(li.rate);
        li.spentTL = round(li.spentTL + billed, 4);
        b.revenueTL = round(b.revenueTL + billed, 4);
      }
    }
    T.revenueTL = round(T.revenueTL + billed, 4);
    return { billedTL: billed, lineItem: li };
  }

  function recordConversion(ad) {
    var T = S.reports.totals;
    T.conversions += 1;
    var billed = 0, li = null;
    if (ad.lineItemId != null && S.lineItems[ad.lineItemId]) {
      li = S.lineItems[ad.lineItemId];
      li.conversions += 1;
      var b = byLi(li.id);
      b.conversions += 1;
      if (li.pricing === 'CPA' && ad.source === 'direct') {
        billed = num(li.rate);
        li.spentTL = round(li.spentTL + billed, 4);
        b.revenueTL = round(b.revenueTL + billed, 4);
      }
    }
    T.revenueTL = round(T.revenueTL + billed, 4);
    return { billedTL: billed, lineItem: li, lineItemId: li ? li.id : null };
  }

  function adEventEnvelope(type, ad, extra) {
    var now = syncNow();
    var env = envelope({
      type: type, path: ad.path || '/', category: ad.category,
      personId: ad.personalized && ad.personId ? ad.personId : '',
      ids: ad.personalized ? browserIds(false) : [], enriched: false
    });
    env.ad_event = {
      impression_id: ad.impressionId, request_id: ad.requestId, type: type,
      line_item_id: ad.lineItemId || 0, creative_id: ad.lineItemId ? ad.lineItemId * 10 + 1 : 0,
      winner_source: ad.source, bidder: ad.bidder || '',
      price_micros: type === 'impression' ? Math.round(num(ad.priceCpm) / 1000 * 1e6) : 0,
      value_micros: 0, ivt_flag: false, ivt_reason: '', signed: true, ts: iso(now)
    };
    if (extra) Object.keys(extra).forEach(function (k) { env.ad_event[k] = extra[k]; });
    return env;
  }

  /* ==================================================================
   * Akış: ad_request (+ otomatik ölçüm)
   * ================================================================== */
  function bidSummary(trace) {
    return trace.bids.map(function (b) {
      if (b.status === 'timeout') return b.name + ' ' + u.fmtInt(b.latencyMs) + ' ms → zaman aşımı';
      if (b.status === 'nobid') return b.name + ' teklif yok';
      return b.name + ' ' + tl(b.cpm) + ' (' + u.fmtInt(b.latencyMs) + ' ms)' + (b.reason === 'floor altı' ? ' floor altı' : '');
    }).join(' · ');
  }

  async function runAdRequest(f, action) {
    var slot = D.slots[action.slot] ? D.slots[action.slot] : D.slots.mpu;
    var category = action.category || 'anasayfa';
    var path = action.path || (category === 'anasayfa' ? '/' : '/' + category);
    var requestId = u.uid('req', 6);
    var impressionId = u.uid('imp', 6);
    bus.emit('ad:loading', { slot: slot.id });

    var allowed = canPersonalize();
    var sup = isSuppressedUser();
    var hasId = !!S.user.fpc;
    var personalized = allowed && hasId && !sup;
    var why = personalized ? 'Kişiselleştirme izni var.'
      : (S.consent.status === 'unknown' ? 'Rıza henüz yok → kimliksiz, kontekstüel istek.'
        : (sup ? 'Kimlik suppression listesinde → kimliksiz istek.' : 'Kişiselleştirme izni yok → kimliksiz, kontekstüel istek.'));
    narr(f, 'browser', 'ad', 'Tarayıcı: ad tag ' + slot.id + ' (' + slot.size + ') için reklam isteği — sayfa ' + path + ', TC string' +
      (personalized ? ', 1P kimlik (fpc)' : '') + '. ' + why);
    await hop(f, 'browser', 'gateway', 'ad', 'ad request');
    await hop(f, 'gateway', 'adapi', 'ad', 'ad request');
    narr(f, 'adapi', 'ad', 'Ad API: istek doğrulandı; GeoIP → İstanbul, UA → iOS · mobil. Profil okunamasa bile kontekstüel bir yanıt her koşulda döner.');
    await hop(f, 'adapi', 'decision', 'ad', 'karar isteği');
    await proc(f, 150);

    var now = syncNow();
    var pid = personalized && S.idmap['fpc:' + S.user.fpc] ? S.idmap['fpc:' + S.user.fpc] : null;
    if (pid && !S.profiles[pid]) pid = null;
    var profile = pid ? S.profiles[pid] : null;
    var trace = decide({
      requestId: requestId, impressionId: impressionId, slot: slot.id, category: category, path: path, now: now,
      consent: S.consent, personalized: personalized, withIds: personalized, personId: pid, profile: profile
    });
    S.reports.totals.requests += 1;
    G.reportsDirty = true;

    pulse('decision', 'ad', personalized ? '✓ rıza' : 'kontekstüel');
    narr(f, 'decision', 'ad', personalized
      ? 'Karar Motoru: rıza kontrolü ✓ (TCF amaç 1, 3, 4 + KVKK açık rıza). Paralel: idmap + profil okuması ‖ header bidding (teklifçi timeout ' + trace.timeoutMs + ' ms).'
      : 'Karar Motoru: kişiselleştirme izni yok → profil okunmaz, teklifçilere kimlik iletilmez; karar yalnızca sayfa bağlamına (' + ctxLabel(category) + ') göre. Header bidding kimliksiz başlıyor.',
      personalized ? 'info' : 'warn');

    var timeouts = trace.bids.filter(function (b) { return b.status === 'timeout'; });
    var validBids = trace.bids.filter(function (b) { return b.cpm != null && b.reason !== 'floor altı'; });
    await Promise.all([
      (async function () {
        if (!personalized) return;
        await Promise.all([
          hop(f, 'decision', 'identity', 'ad', 'fpc → person', 'sm'),
          hop(f, 'decision', 'profile', 'ad', 'profil oku', 'sm')
        ]);
        var segs = trace.segments;
        pulse('profile', 'ad', segs.length + ' segment');
        var fc = [];
        trace.candidates.forEach(function (c) { if (c.fcap) fc.push(c.lineItemId + ': ' + c.fcap.count + '/' + c.fcap.max); });
        narr(f, 'profile', 'ad', pid
          ? 'Aerospike: idmap (fpc → ' + pid + ') + profil okuması ≈ 2 ms — segmentler ' + (segs.length ? segs.join(', ') : 'yok') +
            (fc.length ? '; fcap ' + fc.join(', ') : '') + '.'
          : 'Aerospike: bu fpc için henüz profil yok → segment yok; istek yine kimlikli (fpc) gider.');
      })(),
      (async function () {
        await hop(f, 'decision', 'prebid', 'ad', 'BidRequest');
        narr(f, 'prebid', 'ad', 'Prebid Server: OpenRTB 2.6 BidRequest ' + trace.bids.length + ' teklifçiye paralel gönderildi' +
          (trace.withIds ? ' — user.eids (fpc), user.data (Seller-Defined Audiences), schain, regs.' : ' — kimliksiz: user.eids ve user.data yok; yalnızca site, sayfa kategorisi, schain, regs.'));
        await hop(f, 'prebid', 'dsp', 'ad', 'OpenRTB');
        await proc(f, 150);
        pulse('dsp', 'ad', validBids.length + ' teklif');
        narr(f, 'dsp', 'ad', 'DSP’ler: ' + bidSummary(trace) + '.' +
          (trace.withIds ? ' Kimlikli istekte teklifler yükselir (idBoost).' : ' Kimliksiz istek: idBoost yok, teklifler düşük.'));
        await hop(f, 'dsp', 'prebid', 'ad', 'BidResponse');
        if (timeouts.length) {
          pulse('prebid', 'ad', 'timeout');
          narr(f, 'prebid', 'ad', 'Prebid Server: ' + trace.timeoutMs + ' ms’yi aşan ' + timeouts.map(function (b) { return b.name; }).join(', ') +
            ' zaman aşımına uğradı ve elendi; ' + validBids.length + ' geçerli teklif açık artırmaya gidiyor.', 'warn');
        }
        await hop(f, 'prebid', 'auction', 'ad', 'teklifler');
      })()
    ]);

    var targeted = trace.candidates.filter(function (c) { return c.targeted; });
    var byId = function (a, b) { return a - b; };
    var noConsent = trace.candidates.filter(function (c) { return c.reason === 'rıza yok'; }).map(function (c) { return c.lineItemId; }).sort(byId);
    var paused = trace.candidates.filter(function (c) { return c.reason === 'durduruldu'; }).map(function (c) { return c.lineItemId; }).sort(byId);
    var miss = trace.candidates.filter(function (c) { return c.reason === 'hedefleme uymadı'; }).length;
    await hop(f, 'decision', 'tindex', 'ad', 'aday sorgusu');
    pulse('tindex', 'ad', targeted.length + ' aday');
    narr(f, 'tindex', 'ad', 'Targeting Index: DNF + conjunction index → ' + targeted.length + ' aday' +
      (targeted.length ? ' (' + targeted.map(function (c) { return c.lineItemId; }).join(', ') + ')' : '') + ', < 1 ms.' +
      (miss ? ' ' + miss + ' line item hedeflemeye uymadı.' : '') +
      (noConsent.length ? ' Segment hedefli ' + noConsent.join(', ') + ': rıza yok.' : '') +
      (paused.length ? ' Durdurulmuş: ' + paused.join(', ') + '.' : ''));

    await hop(f, 'decision', 'fcap', 'ad', 'filtre');
    var parts = targeted.map(function (c) {
      if (c.status === 'filtered') return c.lineItemId + ' ✗ ' + c.reason;
      var bits = [];
      if (c.fcap) bits.push('fcap ' + c.fcap.count + '/' + c.fcap.max);
      if (c.throttle < 1) bits.push('throttle ' + u.fmtNum(c.throttle, 2));
      return c.lineItemId + ' ✓' + (bits.length ? ' (' + bits.join(', ') + ')' : '');
    });
    var survivors = trace.candidates.filter(function (c) { return c.targeted && c.status !== 'filtered'; });
    pulse('fcap', 'ad', targeted.length ? survivors.length + '/' + targeted.length + ' geçti' : '—');
    narr(f, 'fcap', 'ad', targeted.length
      ? 'Filtreler (fcap, pacing throttle, bütçe, floor ' + tl(trace.slot.floorCpm) + '): ' + parts.join(' · ') + '.'
      : 'Filtreler: elenecek direct aday yok.',
      targeted.some(function (c) { return c.status === 'filtered'; }) ? 'warn' : 'info');

    await hop(f, 'decision', 'ml', 'ad', 'skor');
    var ml = survivors.map(function (c) {
      if (c.shadow) return c.lineItemId + ' gölge fiyat ' + tl(c.ecpm) + ' (' + tl(c.rate) + ' × (1 + ' + u.fmtPct(c.deficit, 1) + ' teslimat açığı))';
      if (c.pricing === 'CPC') return c.lineItemId + ' CPC ' + tl(c.rate) + ' × pCTR ' + u.fmtPct(c.pCtr, 2) + ' × 1000 = ' + tl(c.ecpm);
      if (c.pricing === 'CPA') return c.lineItemId + ' CPA ' + tl(c.rate) + ' × pCTR ' + u.fmtPct(c.pCtr, 2) + ' × pCVR ' + u.fmtPct(c.pCvr, 1) + ' × 1000 = ' + tl(c.ecpm);
      return c.lineItemId + ' CPM ' + tl(c.ecpm) + ' (pCTR ' + u.fmtPct(c.pCtr, 2) + ')';
    });
    var best = survivors[0];
    pulse('ml', 'ad', best ? 'pCTR ' + u.fmtPct(best.pCtr, 2) : '—');
    narr(f, 'ml', 'ad', survivors.length
      ? 'ML Skor (in-process, < 2 ms): ' + ml.join(' · ') + (survivors.some(function (c) { return c.segmentMatch; }) ? '. Segment eşleşmesinde pCTR × 1,6.' : '.')
      : 'ML Skor: skorlanacak direct aday kalmadı; yalnızca programatik teklifler yarışacak.');

    await hop(f, 'decision', 'auction', 'ad', 'direct adaylar');
    await proc(f, 150);
    var w = trace.winner;
    var li = w.lineItemId != null ? S.lineItems[w.lineItemId] : null;
    var winText, ru = trace.runnerUp;
    if (w.source === 'direct') {
      var wc = trace.candidates[0];
      winText = '“' + li.name + '” (' + li.id + ') · eCPM ' + tl(w.ecpm) + (wc && wc.shadow ? ' — gölge fiyat; faturalama ' + tl(li.rate) + ' CPM' : '');
    } else if (w.source === 'prebid') {
      winText = (D.bidderById[w.bidder] ? D.bidderById[w.bidder].name : w.bidder) + ' · ' + tl(w.priceCpm) + ' CPM (first-price: teklifi kadar öder)';
    } else {
      winText = 'floor üstü teklif yok → house: ' + D.site.name + ' uygulama reklamı';
    }
    pulse('auction', 'ad', w.source === 'house' ? 'house' : tl(w.priceCpm, 0));
    narr(f, 'auction', 'ad', 'Açık artırma (first-price, floor ' + tl(trace.slot.floorCpm) + '): kazanan ' + winText +
      (ru ? '; en yakın rakip ' + ru.name + ' ' + tl(ru.ecpm) : '') + '.', 'ok');
    S.decisions.push(trace);
    if (S.decisions.length > MAX_DECISIONS) S.decisions.splice(0, S.decisions.length - MAX_DECISIONS);
    bus.emit('decision', { trace: trace });
    emitState(['decisions', 'reports']);

    await hop(f, 'auction', 'cdn', 'ad', 'kazanan kreatif');
    narr(f, 'cdn', 'ad', 'Kreatif CDN: ' + (w.source === 'prebid' ? 'programatik' : (w.source === 'house' ? 'house' : 'direct')) +
      ' kreatif markup’ı + HMAC-SHA256 imzalı imp/clk URL’leri sayfaya gönderiliyor.');
    await hop(f, 'cdn', 'browser', 'ad', 'reklam yanıtı');
    var ad = {
      decisionId: trace.id, requestId: requestId, impressionId: impressionId, slot: slot.id, source: w.source,
      lineItemId: w.lineItemId, bidder: w.bidder, priceCpm: w.priceCpm, creative: trace.creative,
      category: category, path: path, personalized: personalized, personId: pid, at: syncNow()
    };
    S.user.lastAd = ad;
    emitState(['user']);
    bus.emit('ad:rendered', {
      slot: slot.id, decisionId: trace.id, source: w.source, lineItemId: w.lineItemId, bidder: w.bidder,
      priceCpm: w.priceCpm, creative: trace.creative, impressionId: impressionId, requestId: requestId
    });
    pulse('browser', 'ad', 'reklam');
    narr(f, 'browser', 'ad', 'Reklam gösterildi: ' + (trace.creative.brand || '') + ' — “' + (trace.creative.headline || '') + '”. Sunucu içi ' +
      u.fmtMs(trace.serverMs) + ', header bidding dahil toplam ' + u.fmtMs(trace.totalMs) + '.', 'ok');

    await Promise.all([
      (async function () {
        await hop(f, 'decision', 'kafka', 'ad', 'ad.decisions', 'sm');
        var env = envelope({ type: 'ad_decision', category: category, path: path, personId: pid || '', ids: personalized ? browserIds(false) : [], enriched: true });
        env.ad_decision = {
          request_id: requestId, impression_id: impressionId, line_item_id: w.lineItemId || 0,
          creative_id: w.lineItemId ? w.lineItemId * 10 + 1 : 0, winner_source: w.source, bidder: w.bidder || '',
          price_micros: Math.round(num(w.priceCpm) * 1e6), floor_micros: Math.round(trace.slot.floorCpm * 1e6), currency: 'TRY',
          p_ctr: li ? (trace.candidates[0] && trace.candidates[0].pCtr) || li.baseCtr : 0,
          matched_segments: trace.segments, candidate_count: targeted.length,
          latency_us: Math.round(trace.serverMs * 1000), no_fill_reason: w.source === 'house' ? 'no_bid_above_floor' : ''
        };
        var m = publish('ad.decisions', TENANT + ':' + requestId, env, f);
        narr(f, 'kafka', 'ad', 'Karar olayı ad.decisions konusuna asenkron yazıldı (p' + m.partition + ' · offset ' + u.fmtInt(m.offset) +
          ') — sıcak yolda senkron Kafka yazımı yok.');
      })(),
      runMeasurement(f, trace, ad)
    ]);
    return { ok: true, trace: trace };
  }

  async function runMeasurement(parent, trace, ad) {
    var f = startFlow({ type: 'measurement', parent: 'ad_request', impressionId: ad.impressionId, decisionId: trace.id },
      'Ölçüm · gösterim + görünürlük', 'measure', parent);
    try {
      await Promise.all([
        measureImp(f, trace, ad),
        (async function () { await proc(f, 1000); await measureViewable(f, trace, ad); })()   // ~1 sn sonra görünürlük
      ]);
    } catch (e) {
      if (!(e && e.stale)) endFlow(f);
      throw e;
    }
    endFlow(f);
  }

  async function measureImp(f, trace, ad) {
    await hop(f, 'browser', 'tracking', 'measure', 'imp');
    pulse('tracking', 'measure', '✓ HMAC');
    narr(f, 'tracking', 'measure', 'Tracking: /imp?d=…&s=… imzalı URL — HMAC-SHA256 doğrulandı (begin-to-render sayımı). Sahte beacon ve fiyat manipülasyonu bu imzayla engellenir.');
    await hop(f, 'tracking', 'kafka', 'measure', 'ad.events');
    var m = publish('ad.events', TENANT + ':' + ad.impressionId, adEventEnvelope('impression', ad), f);
    pulse('kafka', 'measure', 'p' + m.partition);
    await hop(f, 'kafka', 'flink', 'measure', 'imp');
    await proc(f, 200);
    pulse('flink', 'measure', '✓ dedup');
    narr(f, 'flink', 'measure', 'Flink: impression_id ile 24 saatlik dedup ✓ (ilk kez görüldü) · IVT: GIVT/SIVT temiz → faturalanabilir gösterim.');
    var w = trace.winner;
    var direct = w.source === 'direct' && w.lineItemId != null && !!S.lineItems[w.lineItemId];
    var li = direct ? S.lineItems[w.lineItemId] : null;
    await Promise.all([
      (async function () {
        await hop(f, 'flink', 'clickhouse', 'measure', 'rapor satırı');
        var r = recordImpression(trace);
        pulse('clickhouse', 'measure', '+1 imp');
        var note = '';
        if (li && li.pricing === 'CPC') note = ' (CPC: gösterimde ücret yok, tıklamada faturalanır)';
        else if (li && li.pricing === 'CPA') note = ' (CPA: gösterimde ücret yok, dönüşümde faturalanır)';
        else if (w.source === 'house') note = ' (house: gelir yok)';
        narr(f, 'clickhouse', 'measure', 'ClickHouse: ads.ad_events’e satır, ad_stats_hourly MV güncellendi; gelir +' + tl(r.revenueTL, 3) + note + '.', 'ok');
        emitState(['reports', 'lineItems']);
      })(),
      (async function () {
        if (!direct) return;
        await hop(f, 'flink', 'pacer', 'measure', 'harcama sayacı');
        var now = syncNow();
        var old = li.throttle;
        var di = deliveryInfo(li, now);
        if (di) li.throttle = pacerTarget(li, now, 0);
        pulse('pacer', 'measure', 'θ ' + u.fmtNum(li.throttle, 2, 2));
        await hop(f, 'pacer', 'fcap', 'measure', 'throttle oranı');
        var state;
        if (di) {
          state = di.error > 0.005 ? 'teslimat hedef eğrisinin ' + u.fmtPct(di.error, 1) + ' gerisinde'
            : (di.error < -0.005 ? 'teslimat hedef eğrisinin ' + u.fmtPct(-di.error, 1) + ' önünde' : 'teslimat hedef eğrisinde');
        } else if (li.pacing === 'asap') {
          state = 'asap pacing: bütçe sınırına kadar kısıtsız';
        } else {
          var bp = budgetPace(li, now);
          state = bp == null ? 'bütçe eğrisinde' : (bp > 1.02 ? 'harcama bütçe planının ' + u.fmtPct(bp - 1, 0) + ' önünde'
            : (bp < 0.98 ? 'harcama bütçe planının gerisinde (throttle zaten en üstte)' : 'harcama bütçe planında'));
        }
        narr(f, 'pacer', 'measure', 'Pacing Kontrol (PID, ~10 sn): ' + li.id + ' ' + state + ' → throttle ' + u.fmtNum(old, 2, 2) + ' → ' + u.fmtNum(li.throttle, 2, 2) +
          '; oran Fcap + Pacing filtresine iletildi. Harcama ' + u.fmtPct(li.budgetTL ? li.spentTL / li.budgetTL : 0, 1) + ' (soft stop %98).');
      })(),
      (async function () {
        if (!direct || !li.fcap || !trace.personalized || !ad.personId || !S.profiles[ad.personId]) return;
        await hop(f, 'flink', 'profile', 'measure', 'fcap +1');
        var prof = S.profiles[ad.personId];
        if (!prof) return;
        var n = incFcap(prof, li, syncNow());
        pulse('profile', 'measure', 'fcap ' + n + '/' + li.fcap.max);
        narr(f, 'profile', 'measure', 'Aerospike: fcap ' + li.id + ' → ' + n + '/' + li.fcap.max + ' (' + li.fcap.windowH + ' saat penceresi); kalıcı sayaç. Bir sonraki istekte ad server bunu okur.');
        emitState(['profiles']);
      })()
    ]);
  }

  async function measureViewable(f, trace, ad) {
    await hop(f, 'browser', 'tracking', 'measure', 'viewable');
    narr(f, 'tracking', 'measure', 'OM SDK: reklamın %50’si 1 sn boyunca ekranda kaldı (MRC display standardı) → viewable beacon.');
    await hop(f, 'tracking', 'kafka', 'measure', 'ad.events');
    publish('ad.events', TENANT + ':' + ad.impressionId, adEventEnvelope('viewable', ad), f);
    await hop(f, 'kafka', 'flink', 'measure', 'viewable');
    await hop(f, 'flink', 'clickhouse', 'measure', 'viewable');
    S.reports.totals.viewables += 1;
    if (ad.lineItemId != null) byLi(ad.lineItemId).viewables += 1;
    pulse('clickhouse', 'measure', '+1 viewable');
    narr(f, 'clickhouse', 'measure', 'ClickHouse: viewable +1 — görünür gösterim oranı raporlarda güncellendi.', 'ok');
    emitState(['reports']);
  }

  /* ==================================================================
   * Akış: ad_click
   * ================================================================== */
  async function runClick(f) {
    var ad = S.user.lastAd;
    if (!ad) {
      narr(f, 'browser', 'measure', 'Tıklanacak reklam yok: önce bir reklam gösterilmeli.', 'warn');
      return { ok: false };
    }
    var cr = ad.creative || {};
    var landing = cr.landing || {};
    var dest = landing.sku ? (landing.title || landing.sku) : (landing.page === 'cart' ? 'sepet sayfası' : (cr.adomain || landing.title || 'reklamveren sitesi'));
    narr(f, 'browser', 'measure', 'Ziyaretçi reklama tıkladı: ' + (cr.brand || 'reklam') + '. Tarayıcı imzalı /clk adresine gidiyor.');
    await hop(f, 'browser', 'tracking', 'measure', '/clk 302');
    pulse('tracking', 'measure', '302');
    narr(f, 'tracking', 'measure', 'Tracking: /clk imzası ✓ → 302 ile yalnızca imzalı hedefe yönlendirme (open redirect koruması): ' + dest + '.');
    var now = syncNow();
    var clicked = clone(ad);
    clicked.clickedAt = now;
    clicked.converted = false;
    S.user.clickedAd = clicked;
    emitState(['user']);
    if (landing.sku) bus.emit('device:navigate', { page: 'product', sku: landing.sku });
    else if (landing.page) bus.emit('device:navigate', { page: landing.page });
    await hop(f, 'tracking', 'kafka', 'measure', 'ad.events');
    publish('ad.events', TENANT + ':' + ad.impressionId, adEventEnvelope('click', ad), f);
    await hop(f, 'kafka', 'flink', 'measure', 'click');
    await proc(f, 200);
    var profileOk = canProfile() && !isSuppressedUser() && !!S.user.fpc;
    pulse('flink', 'measure', '✓ IVT');
    narr(f, 'flink', 'measure', 'Flink: tıklama dedup ✓ · IVT: tıklama zamanlaması ve oturum davranışı normal (SIVT temiz).' +
      (profileOk ? '' : ' Profilleme izni yok → tıklama yalnızca agrega raporlanır, segment yazılmaz.'), profileOk ? 'info' : 'drop');
    var result = { ok: true, click: null, segChange: null };
    await Promise.all([
      (async function () {
        await hop(f, 'flink', 'clickhouse', 'measure', 'click');
        var r = recordClick(ad);
        result.click = r;
        pulse('clickhouse', 'measure', '+1 tık');
        narr(f, 'clickhouse', 'measure', 'ClickHouse: tıklama +1' + (r.lineItem ? ' (' + r.lineItem.id + ')' : '') +
          (r.billedTL > 0 ? '; CPC kampanya tıklama başına faturalandı: +' + tl(r.billedTL) + '.' : '; CTR raporu güncellendi.'), 'ok');
        emitState(['reports', 'lineItems']);
      })(),
      (async function () {
        if (!profileOk) return;
        await hop(f, 'flink', 'segment', 'dmp', 'ad_click');
        var t = syncNow();
        var rr = resolveFpc(t);
        var prof = rr.profile;
        applyEventToProfile(prof, { type: 'ad_click' }, t);
        var ch = evaluateSegments(prof, 'ad_click', null, t);
        result.segChange = ch;
        var text = segChangeText(ch, t);
        if (ch.added.length || ch.removed.length) {
          pulse('segment', 'dmp', ch.added.map(function (x) { return '+' + x; }).join(' '));
          narr(f, 'segment', 'dmp', text, 'ok');
          await hop(f, 'segment', 'profile', 'dmp', '+' + ch.added.join(' +'));
          prof = S.profiles[rr.personId] || prof;
          applySegChange(prof, ch, t);
          pulse('profile', 'dmp', 'v' + prof.ver);
          emitSegChange(rr.personId, ch.added, ch.removed, 'realtime_rule', f);
        } else {
          if (ch.refreshed.length) applySegChange(prof, ch, t);
          narr(f, 'segment', 'dmp', text);
        }
        emitState(['profiles', 'segments', 'user', 'idmap']);
      })()
    ]);
    return result;
  }

  /* ==================================================================
   * Akış: cleanroom_run
   * ================================================================== */
  function laplace(rng, b) {
    var x = rng() - 0.5;
    if (x > 0.4999) x = 0.4999;
    if (x < -0.4999) x = -0.4999;
    return -b * (x < 0 ? -1 : 1) * Math.log(1 - 2 * Math.abs(x));
  }

  async function runCleanroom(f) {
    var P = D.partner, CR = S.cleanroom;
    var eps = num(CR.epsilonPerRun, P.epsilonPerRun);
    if (CR.epsilonUsed + eps > CR.epsilonBudget + 1e-9) {
      pulse('policy', 'cleanroom', 'ε bitti');
      narr(f, 'policy', 'cleanroom', 'Politika: ε bütçesi tükendi (' + u.fmtNum(CR.epsilonUsed, 1) + ' / ' + u.fmtNum(CR.epsilonBudget, 0) +
        ') → sorgu çalıştırılmadı. Bütçe, art arda sorgularla yapılacak fark saldırısını matematiksel olarak sınırlar.', 'warn');
      return { ok: false, refused: true, reason: 'epsilon' };
    }
    var runNo = CR.runs.length + 1;
    var rng = u.seeded('cleanroom:' + runNo + ':' + (S.user.sessionId || 'oturum'));
    narr(f, 'partner', 'cleanroom', P.name + ': ' + u.fmtInt(P.records) + ' müşterinin e-postası kendi tarafında normalize edilip SHA-256 ile hash’lendi; partnerin kendi KMS anahtarıyla şifrelenip yükleniyor.');
    await Promise.all([
      hop(f, 'partner', 'dcr', 'cleanroom', "hash'li CRM " + u.fmtInt(P.records)),
      hop(f, 'iceberg', 'dcr', 'cleanroom', 'maruz kalma + hem')
    ]);
    await proc(f, 350);
    var matchedTrue = P.baseMatches + rng.int(-45, 45);
    pulse('dcr', 'cleanroom', 'TEE ✓');
    narr(f, 'dcr', 'cleanroom', 'Clean Room: TEE remote attestation ✓ (AMD SEV-SNP; partner çalışan kodun ölçümünü doğruladı). Gizli VM içinde hash join (ECDH-PSI alternatifi): ' +
      u.fmtInt(P.publisherHems) + ' ∩ ' + u.fmtInt(P.records) + ' → ' + u.fmtInt(matchedTrue) + ' eşleşme; gerçek kimlik yerine opak match_id.');
    await hop(f, 'dcr', 'policy', 'cleanroom', 'eşleşen küme');
    await proc(f, 350);
    var noise = laplace(rng, 1 / eps);          // hassasiyet 1, ölçek b = 1/ε
    var noisy = Math.max(0, Math.round(matchedTrue + noise));
    var kPassed = noisy >= P.k;
    var segOk = noisy >= P.minSegment;
    CR.epsilonUsed = round(CR.epsilonUsed + eps, 4);
    var now = syncNow();

    // Partner listesi demo e-postasının hash'ini içerir → o hash'e sahip kişi (varsa) eşleşir.
    var demoKey = 'hem:' + G.demoHem;
    var matchedPid = P.includesDemoEmail !== false && S.idmap[demoKey] && S.profiles[S.idmap[demoKey]] && !G.supSet[G.demoHem] ? S.idmap[demoKey] : null;
    var userMatched = !!(matchedPid && matchedPid === S.user.personId);
    var run = {
      id: 'CR-RUN-' + pad(runNo, 3), no: runNo, at: now, status: 'ok',
      partnerId: P.id, partnerName: P.name, collaborationId: P.collaborationId, template: 'audience_activation', matching: P.matching || 'tee_hash_join',
      publisherHems: P.publisherHems, partnerRecords: P.records,
      matchedTrue: matchedTrue, matchedNoisy: noisy, noise: round(noise, 2),
      overlapPct: round(noisy / P.records, 4), overlapOfPublisher: round(noisy / P.publisherHems, 4),
      k: P.k, kPassed: kPassed, minSegment: P.minSegment, segmentOk: segOk,
      epsilon: eps, epsilonUsed: CR.epsilonUsed, epsilonBudget: CR.epsilonBudget, epsilonRemaining: round(CR.epsilonBudget - CR.epsilonUsed, 4),
      sensitivity: 1, mechanism: 'Laplace', delta: P.delta,
      segmentId: P.segmentId || 9001, segmentSize: segOk ? noisy : 0, exportable: false,
      userMatched: userMatched, matchedPersonId: matchedPid, userLoggedIn: !!S.user.loggedIn,
      attestation: { ok: true, platform: 'AMD SEV-SNP', measurement: 'sha384:' + u.sha256HexSync('dcr-image:' + P.collaborationId).slice(0, 24) }
    };
    pulse('policy', 'cleanroom', '✓ k≥' + P.k);
    narr(f, 'policy', 'cleanroom', 'Politika + DP: onaylı şablon audience_activation; her hücre k ≥ ' + P.k + (kPassed ? ' ✓' : ' ✗') +
      '. Laplace gürültüsü (ε = ' + u.fmtNum(eps, 1) + ', hassasiyet 1, ölçek 1/ε = ' + u.fmtNum(1 / eps, 0) + '): ' + u.fmtInt(matchedTrue) +
      ' ' + (noise < 0 ? '−' : '+') + ' ' + u.fmtNum(Math.abs(noise), 1, 1) + ' → ' + u.fmtInt(noisy) +
      '. ε bütçesi ' + u.fmtNum(CR.epsilonUsed, 1) + ' / ' + u.fmtNum(CR.epsilonBudget, 0) + '.', 'ok');
    CR.runs.push(run);
    if (segOk && S.segments[run.segmentId]) S.segments[run.segmentId].estimate = noisy;
    emitState(['cleanroom', 'segments']);
    refreshBadges(false);

    await Promise.all([
      (async function () {
        await hop(f, 'policy', 'partner', 'cleanroom', 'agrega rapor');
        pulse('partner', 'cleanroom', 'agrega');
        narr(f, 'partner', 'cleanroom', P.name + ' yalnızca gürültülü agrega raporu görür: örtüşme ' + u.fmtPct(run.overlapPct, 1) + ' (' + u.fmtInt(noisy) +
          ' kişi). Hangi kişilerin eşleştiğini hiçbir zaman öğrenmez.');
      })(),
      (async function () {
        if (!segOk) {
          narr(f, 'policy', 'cleanroom', 'Politika: eşleşen küme ' + u.fmtInt(P.minSegment) + ' kişinin altında → opak segment üretilmedi.', 'warn');
          return;
        }
        await hop(f, 'policy', 'segment', 'cleanroom', 'opak segment 9001');
        pulse('segment', 'cleanroom', String(run.segmentId));
        narr(f, 'segment', 'cleanroom', 'Segment Motoru: opak segment ' + run.segmentId + ' “' + segName(run.segmentId) + '” ≈ ' + u.fmtInt(noisy) +
          ' kişi (≥ ' + u.fmtInt(P.minSegment) + ' ✓), exportable = false — yalnızca ad server içinde hedeflenir, aktivasyona gönderilemez.', 'ok');
        await hop(f, 'segment', 'profile', 'cleanroom', 'üyelik yaz ' + run.segmentId);
        var t = syncNow();
        if (matchedPid && S.profiles[matchedPid]) {
          var prof = S.profiles[matchedPid];
          var had = num(prof.seg[run.segmentId]) > t;
          prof.seg[run.segmentId] = t + ((D.segmentById[run.segmentId] && D.segmentById[run.segmentId].ttlDays) || 30) * DAY;
          prof.segMeta = prof.segMeta || {};
          prof.segMeta[run.segmentId] = { exportable: false, source: P.collaborationId };
          touchProfile(prof, t);
          pulse('profile', 'cleanroom', '+' + run.segmentId);
          if (!had) emitSegChange(matchedPid, [run.segmentId], [], 'clean_room', f);
          narr(f, 'profile', 'cleanroom', userMatched
            ? 'Aerospike: ziyaretçi (' + matchedPid + ') partner listesindeydi → ' + run.segmentId + ' üyeliği yazıldı (exportable = false). Artık ' +
              (S.lineItems[102] ? S.lineItems[102].advertiser + '’ın preferred deal’i (LI 102)' : 'clean room hedefli kampanyalar') + ' bu kişiye gösterilebilir.'
            : 'Aerospike: eşleşen kişilere (ör. ' + matchedPid + ') ' + run.segmentId + ' üyeliği yazıldı. Ziyaretçinin web profili henüz bu kişiyle birleşmediği için (giriş yok) o eşleşmedi.',
            'ok');
        } else {
          pulse('profile', 'cleanroom', 'üyelik');
          narr(f, 'profile', 'cleanroom', 'Aerospike: eşleşen kişilerin profillerine ' + run.segmentId + ' üyeliği yazıldı; ziyaretçi eşleşen kümede değil.');
        }
        emitState(['profiles', 'segments']);
      })()
    ]);
    bus.emit('cleanroom:result', { run: run });
    return { ok: true, run: run };
  }

  /* ==================================================================
   * Akış: campaign_update (kontrol düzlemi)
   * ================================================================== */
  function sanitizePatch(p, li) {
    var out = {};
    if (!p || typeof p !== 'object') return out;
    if (p.status === 'active' || p.status === 'paused') { if (p.status !== li.status) out.status = p.status; }
    if (p.rate != null && isFinite(Number(p.rate)) && Number(p.rate) >= 0 && Number(p.rate) !== li.rate) out.rate = round(Number(p.rate), 4);
    if (p.fcapMax != null && isFinite(Number(p.fcapMax)) && Number(p.fcapMax) >= 1) {
      var fm = Math.round(Number(p.fcapMax));
      if (!li.fcap || li.fcap.max !== fm) out.fcapMax = fm;
    }
    return out;
  }

  async function runCampaignUpdate(f, action) {
    var id = Number(action.lineItemId);
    var li = S.lineItems[id];
    if (!li) { narr(f, 'admin', 'control', 'Line item bulunamadı: ' + action.lineItemId + '.', 'warn'); return { ok: false }; }
    var patch = sanitizePatch(action.patch, li);
    var keys = Object.keys(patch);
    if (!keys.length) {
      narr(f, 'admin', 'control', 'Admin UI: “' + li.name + '” için kaydedilecek değişiklik yok.', 'warn');
      return { ok: false, reason: 'değişiklik yok' };
    }
    var diffs = [], sets = [];
    if (patch.status) { diffs.push('durum = ' + (L.status[patch.status] || patch.status).toLowerCase()); sets.push("status = '" + patch.status + "'"); }
    if (patch.rate != null) { diffs.push('fiyat ' + tl(li.rate) + ' → ' + tl(patch.rate) + ' (' + li.pricing + ')'); sets.push('rate_micros = ' + u.fmtInt(Math.round(patch.rate * 1e6))); }
    if (patch.fcapMax != null) { diffs.push('fcap ' + (li.fcap ? li.fcap.max : '—') + ' → ' + patch.fcapMax + ' / ' + ((li.fcap && li.fcap.windowH) || 24) + ' saat'); sets.push('frequency_caps = [{max:' + patch.fcapMax + '}]'); }
    narr(f, 'admin', 'control', 'Admin UI: “' + li.name + '” (' + li.id + ') için ' + diffs.join(', ') + '. Management API (SSO + RBAC ✓) değişikliği PostgreSQL’e yazıyor.');
    await hop(f, 'admin', 'postgres', 'control', 'UPDATE line_items');
    await proc(f, 220);
    var liVer = (li.version || 1) + 1;
    pulse('postgres', 'control', 'v' + liVer);
    narr(f, 'postgres', 'control', 'PostgreSQL: UPDATE line_items SET ' + sets.join(', ') + ', version = ' + liVer +
      ' (optimistic versioning); audit_log’a değiştirilemez kayıt düştü. Ad server bu veritabanını sıcak yolda asla sorgulamaz.');
    var newVer = S.config.version + 1;
    await hop(f, 'postgres', 'config', 'control', 'CDC v' + newVer);
    var now = syncNow();
    var before = { status: li.status, rate: li.rate, fcap_max: li.fcap ? li.fcap.max : null, version: li.version || 1 };
    var after = {
      status: patch.status || li.status, rate: patch.rate != null ? patch.rate : li.rate,
      fcap_max: patch.fcapMax != null ? patch.fcapMax : (li.fcap ? li.fcap.max : null), version: liVer
    };
    S.config.version = newVer;
    S.config.updatedAt = now;
    S.config.lastChange = { lineItemId: li.id, patch: clone(patch), before: before, after: after, at: now };
    publish('config.adserver', String(TENANT), {
      op: 'u', source: { connector: 'debezium', db: 'adtech', table: 'line_items', lsn: 48120000 + newVer * 37 },
      ts_ms: now, tenant_id: TENANT, line_item_id: li.id, before: before, after: after, config_version: newVer
    }, f);
    pulse('config', 'control', 'CDC v' + newVer);
    narr(f, 'config', 'control', 'Config Stream: Debezium CDC değişikliği yakaladı → config.adserver (compacted) konusuna delta v' + newVer + ' yazıldı; tüm bölgelerdeki pod’lara dağıtılıyor.');
    emitState(['config']);
    refreshBadges(false);
    await Promise.all([
      hop(f, 'config', 'decision', 'control', 'snapshot swap'),
      hop(f, 'config', 'tindex', 'control', 'indeks yenile')
    ]);
    if (patch.status) li.status = patch.status;
    if (patch.rate != null) li.rate = patch.rate;
    if (patch.fcapMax != null) {
      if (li.fcap) li.fcap.max = patch.fcapMax;
      else li.fcap = { max: patch.fcapMax, windowH: 24 };
    }
    li.version = liVer;
    pulse('decision', 'control', 'swap v' + newVer);
    pulse('tindex', 'control', 'yenilendi');
    narr(f, 'decision', 'control', 'Ad server pod’ları yeni immutable snapshot’ı atomic pointer swap ile devraldı — restart yok, karar sırasında okuma kesilmedi. Targeting index yeniden derlendi' +
      (patch.status === 'paused' ? '; ' + li.id + ' artık aday olmayacak (durduruldu).' : (patch.status === 'active' ? '; ' + li.id + ' yeniden yarışta.' : '.')), 'ok');
    emitState(['lineItems', 'config']);
    return { ok: true, version: newVer, lineItemId: li.id, patch: patch };
  }

  /* ==================================================================
   * Akış: dsar_delete
   * ================================================================== */
  async function runDsar(f) {
    var now = syncNow();
    var pid = S.user.personId && S.profiles[S.user.personId] ? S.user.personId : null;
    var prof = pid ? S.profiles[pid] : null;
    var idKeys = prof ? Object.keys(prof.ids) : [];
    if (S.user.fpc && idKeys.indexOf('fpc:' + S.user.fpc) < 0) idKeys.push('fpc:' + S.user.fpc);
    if (S.user.hem && idKeys.indexOf('hem:' + S.user.hem) < 0) idKeys.push('hem:' + S.user.hem);
    var stores = {};
    DSAR_STORES.forEach(function (k) { stores[k] = 'pending'; });
    var rec = { id: 'DSAR-2026-' + u.uid('', 5), at: now, type: 'erasure', personId: pid, ids: idKeys.slice(), status: 'pending', stores: stores, doneAt: {}, completedAt: null };
    S.dsar.push(rec);
    emitState(['dsar']);
    narr(f, 'browser', 'privacy', 'Ziyaretçi “Verilerimi sil” dedi: KVKK m.11 kapsamında silme talebi Gizlilik Portalı’na gidiyor.');
    await hop(f, 'browser', 'privacy', 'privacy', 'silme talebi');
    pulse('privacy', 'privacy', 'DSAR');
    narr(f, 'privacy', 'privacy', 'Gizlilik Portalı: talep ' + rec.id + ' alındı, kimlik doğrulandı (oturum + e-posta onayı). Yasal süre 30 gün; hedef 72 saat.');
    await hop(f, 'privacy', 'identity', 'privacy', 'kimlikleri bul');
    await proc(f, 220);
    var types = idKeys.map(function (k) { return k.split(':')[0]; });
    narr(f, 'identity', 'privacy', pid
      ? 'Identity Graph: ' + pid + ' kişisine bağlı ' + idKeys.length + ' kimlik bulundu (' + types.join(', ') + ').'
      : 'Identity Graph: bu tarayıcıya bağlı profil bulunamadı; çerez / e-posta kimlikleri (' + (types.length ? types.join(', ') : 'yok') + ') yine de talebe eklendi.');
    idKeys.forEach(function (k) {
      var i = k.indexOf(':');
      addSuppression(hashOf(k.slice(0, i), k.slice(i + 1)));
    });
    S.user.suppressed = true;
    pulse('privacy', 'privacy', 'suppression');
    narr(f, 'privacy', 'privacy', 'Hash’li kimlikler (' + (types.length ? types.join(', ') : '—') + ') suppression listesine eklendi: kişi eski çerezle dönse bile profil yeniden oluşturulmaz.');
    emitState(['user', 'dsar']);
    await hop(f, 'privacy', 'kafka', 'privacy', 'privacy.dsar');
    publish('privacy.dsar', TENANT + ':' + (pid || ('fpc:' + (S.user.fpc || 'yok'))), {
      event_id: uuid7(now), event_time: iso(syncNow()), tenant_id: TENANT, request_id: rec.id, type: 'erasure',
      person_id: pid || '', ids: idKeys.map(function (k) { var i = k.indexOf(':'); return { type: k.slice(0, i), value_hash: hashOf(k.slice(0, i), k.slice(i + 1)) }; }),
      stores: DSAR_STORES.slice(), legal_basis: 'KVKK m.11', deadline: iso(now + 30 * DAY)
    }, f);
    await hop(f, 'kafka', 'flink', 'privacy', 'privacy.dsar');
    narr(f, 'flink', 'privacy', 'Flink: privacy.dsar tüketildi → silme tüm depolarda paralel başlıyor.');

    function done(keys, nodeId, text) {
      var t = syncNow();
      keys.forEach(function (k) { rec.stores[k] = 'done'; rec.doneAt[k] = t; });
      emitState(['dsar']);
      narr(f, nodeId, 'privacy', text, 'ok');
    }
    await Promise.all([
      (async function () {
        await hop(f, 'flink', 'profile', 'privacy', 'sil');
        var t = syncNow();
        var removedSegs = [], idmapCount = 0;
        if (pid && S.profiles[pid]) {
          removedSegs = activeSegIds(S.profiles[pid], t);
          removedSegs.forEach(function (id) { if (S.segments[id]) S.segments[id].estimate = Math.max(0, S.segments[id].estimate - 1); });
          delete S.profiles[pid];
        }
        Object.keys(S.idmap).forEach(function (k) {
          if ((pid && S.idmap[k] === pid) || idKeys.indexOf(k) >= 0) { delete S.idmap[k]; idmapCount++; }
        });
        S.user.personId = null;
        pulse('profile', 'privacy', 'silindi');
        if (pid && removedSegs.length) bus.emit('segment:change', { personId: pid, added: [], removed: removedSegs });
        done(['profile', 'idmap'], 'profile', pid
          ? 'Aerospike: profil “' + TENANT + ':' + pid + '” (kimlikler, ' + removedSegs.length + ' segment, fcap sayaçları) ve ' + idmapCount + ' idmap kaydı silindi.'
          : 'Aerospike: silinecek profil yoktu; ' + idmapCount + ' idmap kaydı temizlendi.');
        emitState(['profiles', 'idmap', 'user', 'segments']);
        refreshBadges(false);
      })(),
      (async function () {
        await hop(f, 'flink', 'iceberg', 'privacy', 'row-level delete');
        done(['iceberg'], 'iceberg', 'Iceberg: row-level delete (merge-on-read) + compaction; eski snapshot’lar süresi dolunca temizlenir.');
      })(),
      (async function () {
        await hop(f, 'flink', 'clickhouse', 'privacy', 'DELETE');
        done(['clickhouse'], 'clickhouse', 'ClickHouse: lightweight DELETE — reklam olaylarında person_id anonimleştirildi; agrega raporlar korunur.');
      })(),
      (async function () {
        await hop(f, 'privacy', 'dcr', 'privacy', "collab'dan çıkar");
        done(['cleanroom'], 'dcr', 'Clean Room: kişi aktif collaboration’ın (' + D.partner.name + ') eşleşme kümesinden çıkarıldı; opak segment üyeliği düştü.');
      })(),
      (async function () {
        await hop(f, 'privacy', 'activation', 'privacy', 'ortaklardan sil');
        done(['partners'], 'activation', 'Aktivasyon: DSP ve kitle ortaklarına çıkarma çağrıları gönderildi (hash’li kitle listelerinden silme).');
      })()
    ]);
    rec.status = 'done';
    rec.completedAt = syncNow();
    pulse('privacy', 'privacy', '✓ ' + DSAR_STORES.length + '/' + DSAR_STORES.length);
    narr(f, 'privacy', 'privacy', 'Silme tamamlandı: ' + DSAR_STORES.length + '/' + DSAR_STORES.length + ' depo kanıtlı (depo + zaman damgası) — veri sahibine yanıt hazır.', 'ok');
    emitState(['dsar', 'user']);
    return { ok: true, dsar: rec };
  }

  /* ==================================================================
   * Aksiyon yönlendirme
   * ================================================================== */
  function flowMeta(a) {
    var t = a.type;
    if (t === 'visit') return { title: 'Ziyaret · KVKK rıza banner’ı', line: 'privacy' };
    if (t === 'consent') return { title: 'Rıza kararı · ' + ((L.consentChoice && L.consentChoice[a.choice]) || a.choice), line: 'privacy' };
    if (t === 'page_view' || t === 'product_view') {
      var info = pageInfo(a);
      return { title: 'Olay · ' + (info.page === 'product' ? 'product_view' : 'page_view') + ' · ' + (info.desc || info.page), line: 'dmp' };
    }
    if (t === 'add_to_cart') { var p = D.productBySku[a.sku]; return { title: 'Olay · add_to_cart · ' + (p ? p.name : a.sku), line: 'dmp' }; }
    if (t === 'purchase') return { title: 'Olay · purchase', line: 'dmp' };
    if (t === 'login') return { title: 'Giriş · kimlik bağlama', line: 'dmp' };
    if (t === 'ad_request') return { title: 'Reklam isteği · ' + (a.slot || 'mpu') + ' · ' + ctxLabel(a.category || 'anasayfa'), line: 'ad' };
    if (t === 'ad_click') return { title: 'Reklam tıklaması · /clk', line: 'measure' };
    if (t === 'cleanroom_run') return { title: 'Data Clean Room · eşleştirme', line: 'cleanroom' };
    if (t === 'campaign_update') return { title: 'Kampanya güncelleme · LI ' + a.lineItemId, line: 'control' };
    if (t === 'dsar_delete') return { title: 'Silme talebi (DSAR)', line: 'privacy' };
    return { title: 'Aksiyon · ' + t, line: 'control' };
  }

  async function runAction(action) {
    var meta = flowMeta(action);
    var f = startFlow(action, meta.title, meta.line, null);
    var result;
    try {
      switch (action.type) {
        case 'visit': result = await runVisit(f); break;
        case 'consent': result = await runConsent(f, action); break;
        case 'page_view':
        case 'product_view': result = await runPageView(f, action); break;
        case 'add_to_cart': result = await runAddToCart(f, action); break;
        case 'purchase': result = await runPurchase(f); break;
        case 'login': result = await runLogin(f, action); break;
        case 'ad_request': result = await runAdRequest(f, action); break;
        case 'ad_click': result = await runClick(f); break;
        case 'cleanroom_run': result = await runCleanroom(f); break;
        case 'campaign_update': result = await runCampaignUpdate(f, action); break;
        case 'dsar_delete': result = await runDsar(f); break;
        default:
          narr(f, null, 'control', 'Bilinmeyen aksiyon: ' + action.type + '.', 'warn');
          result = { ok: false, reason: 'bilinmeyen aksiyon' };
      }
    } catch (e) {
      if (e && e.stale) throw e;
      narr(f, null, meta.line, 'Motor hatası: ' + (e && e.message ? e.message : e), 'warn');
      endFlow(f);
      throw e;
    }
    endFlow(f);
    return result;
  }

  /* ==================================================================
   * Kuyruk
   * ================================================================== */
  function emitBusy(force) {
    var b = G.running || G.queue.length > 0;
    var q = G.queue.length;
    if (!force && b === G.lastBusy && q === G.lastQueue) return;
    G.lastBusy = b;
    G.lastQueue = q;
    bus.emit('busy', { busy: b, queue: q });
  }

  async function pump() {
    if (G.running) return;
    G.running = true;
    emitBusy();
    try {
      while (G.queue.length) {
        var item = G.queue.shift();
        emitBusy();
        if (item.gen !== G.gen) { item.resolve({ ok: false, cancelled: true }); continue; }
        try {
          await ensureInit();
          var res = await runAction(item.action);
          item.resolve(res === undefined ? { ok: true } : res);
        } catch (e) {
          if (e && e.stale) item.resolve({ ok: false, cancelled: true });
          else {
            try { console.error('[SIM.engine] aksiyon hata verdi:', item.action && item.action.type, e); } catch (e2) { /* yut */ }
            item.resolve({ ok: false, error: e && e.message ? e.message : String(e) });
          }
        }
      }
    } finally {
      G.running = false;
      emitBusy();
    }
  }

  /** dispatch(action) -> Promise: kuyruğa alır; KENDİ akışı bitince çözülür (hata olsa da reddetmez). */
  function dispatch(action) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      try { console.warn('[SIM.engine] geçersiz aksiyon:', action); } catch (e) { /* yut */ }
      return Promise.resolve({ ok: false, reason: 'geçersiz aksiyon' });
    }
    if (action.type === 'reset') return reset().then(function () { return { ok: true, reset: true }; });
    return new Promise(function (resolve) {
      G.queue.push({ action: action, resolve: resolve, gen: G.gen });
      emitBusy();
      pump();
    });
  }

  /* ==================================================================
   * Arka plan trafiği (diğer ziyaretçiler) + simNow saati
   * ================================================================== */
  var AMBIENT_PATHS = [
    { w: 16, line: 'dmp', path: ['browser', 'gateway', 'collector', 'kafka', 'flink', 'iceberg'] },
    { w: 9, line: 'dmp', path: ['kafka', 'flink', 'identity', 'profile'] },
    { w: 6, line: 'dmp', path: ['flink', 'segment', 'profile'] },
    { w: 3, line: 'dmp', path: ['segment', 'activation', 'dsp'] },
    { w: 15, line: 'ad', path: ['browser', 'gateway', 'adapi', 'decision'] },
    { w: 7, line: 'ad', path: ['decision', 'prebid', 'dsp'] },
    { w: 6, line: 'ad', path: ['dsp', 'prebid', 'auction'] },
    { w: 8, line: 'ad', path: ['decision', 'auction', 'cdn', 'browser'] },
    { w: 4, line: 'ad', path: ['decision', 'profile'] },
    { w: 3, line: 'ad', path: ['decision', 'identity'] },
    { w: 4, line: 'ad', path: ['decision', 'kafka'] },
    { w: 12, line: 'measure', path: ['browser', 'tracking', 'kafka', 'flink', 'clickhouse'] },
    { w: 4, line: 'measure', path: ['flink', 'pacer', 'fcap'] },
    { w: 3, line: 'measure', path: ['kafka', 'flink', 'iceberg'] },
    { w: 2, line: 'measure', path: ['flink', 'profile'] },
    { w: 1, line: 'control', path: ['clickhouse', 'admin'] }
  ].filter(function (p) {
    for (var i = 0; i < p.path.length - 1; i++) {
      var eb = D.edgeBetween(p.path[i], p.path[i + 1]);
      if (!eb || eb.edge.lines.indexOf(p.line) < 0) {
        try { console.warn('[SIM.engine] geçersiz arka plan yolu atlandı:', p.path.join('→')); } catch (e) { /* yut */ }
        return false;
      }
    }
    return true;
  });
  var AMBIENT_W = AMBIENT_PATHS.reduce(function (s, p) { return s + p.w; }, 0);

  /** Line item başına arka plan teslimat hızı (gösterim / sim-saniye; throttle ile çarpılır). */
  var AMBIENT_LI_RATE = { 101: 0.42, 102: 0.3, 103: 0.2, 104: 0.1, 105: 0.6, 106: 0.18, 199: 0.35 };

  function accAdd(key, x) {
    var a = (G.acc[key] || 0) + x;
    var whole = Math.floor(a);
    G.acc[key] = a - whole;
    return whole;
  }

  function ambientTraffic(sec) {
    var R = S.reports, T = R.totals;
    var q = num(R.qps, 2480);
    if (!(q >= 1800)) q = 2480;
    q += (Math.random() - 0.5) * 160 * Math.min(1, sec * 4) + (2480 - q) * Math.min(0.5, 0.06 * sec * 4);
    q = clamp(q, 2000, 3000);
    R.qps = Math.round(q);
    var req = q * sec;
    var imps = req * 0.934;
    T.requests += accAdd('req', req);
    T.impressions += accAdd('imp', imps);
    T.viewables += accAdd('view', imps * 0.684);
    T.clicks += accAdd('clk', imps * 0.0021);
    T.conversions += accAdd('conv', imps * 0.0021 * 0.025);
    T.revenueTL = round(T.revenueTL + imps * 0.03146, 4);

    Object.keys(S.lineItems).forEach(function (id) {
      var li = S.lineItems[id];
      var rate = AMBIENT_LI_RATE[id];
      if (!rate || li.status !== 'active') return;
      if (li.budgetTL != null && li.spentTL >= li.budgetTL) return;
      if (id === '102' && !(S.segments[9001] && S.segments[9001].estimate > 0)) return;
      var n = accAdd('li' + id, rate * num(li.throttle, 1) * sec);
      if (!n) return;
      var b = byLi(li.id);
      li.delivered += n;
      b.impressions += n;
      b.viewables += accAdd('liv' + id, n * 0.67);
      var c = accAdd('lic' + id, n * num(li.baseCtr));
      li.clicks += c;
      b.clicks += c;
      var cv = accAdd('liq' + id, c * num(li.baseCvr) * 3);
      li.conversions += cv;
      b.conversions += cv;
      var spend = li.pricing === 'CPM' ? n * li.rate / 1000 : (li.pricing === 'CPC' ? c * li.rate : cv * li.rate);
      if (spend) { li.spentTL = round(li.spentTL + spend, 4); b.revenueTL = round(b.revenueTL + spend, 4); }
    });

    var off = S.kafka.offsets;
    function bump(topic, x) { if (off[topic] != null) off[topic] += accAdd('k:' + topic, x); }
    bump('raw.web_events', req * 2.6);
    bump('enriched.events', req * 2.1);
    bump('ad.decisions', req);
    bump('ad.events', imps * 1.72);
    bump('dmp.segment_changes', req * 0.04);
    bump('identity.merges', req * 0.002);

    // Pacing Kontrol: her ~10 sim-saniyede garantili line item'lar için throttle
    var now = S.simNow;
    if (now - G.lastPacerSim >= 10000) {
      G.lastPacerSim = now;
      Object.keys(S.lineItems).forEach(function (id) {
        var li = S.lineItems[id];
        if (li.goal && li.status === 'active') li.throttle = pacerTarget(li, now, (Math.random() - 0.5) * 0.02);
      });
    }
    G.reportsDirty = true;
  }

  function ambientPackets(realSec) {
    if (!SIM.diagram || typeof SIM.diagram.ambient !== 'function' || !AMBIENT_PATHS.length) return;
    var rate = 1.8 * ((G.running || G.queue.length) ? 0.55 : 1);
    G.packetBudget = Math.min(3, G.packetBudget + realSec * rate);
    var sent = 0;
    while (G.packetBudget >= 1 && sent < 3) {
      G.packetBudget -= 1;
      sent++;
      var r = Math.random() * AMBIENT_W, p = AMBIENT_PATHS[0];
      for (var i = 0; i < AMBIENT_PATHS.length; i++) { r -= AMBIENT_PATHS[i].w; if (r <= 0) { p = AMBIENT_PATHS[i]; break; } }
      diag('ambient', { path: p.path.slice(), line: p.line });
    }
  }

  function tick() {
    try {
      var c = clockNow();
      var dtSim = Math.max(0, c - G.lastTickClock);
      G.lastTickClock = c;
      var realNow = Date.now();
      var realSec = Math.max(0, Math.min(2, (realNow - (G.lastTickReal || realNow)) / 1000));
      G.lastTickReal = realNow;
      syncNow();
      var s = SIM.settings || {};
      if (!s.paused) {
        if (s.ambient) {
          if (dtSim > 0) ambientTraffic(Math.min(5, dtSim / 1000));
          ambientPackets(realSec);
        } else if (S.reports.qps !== 0) {
          S.reports.qps = 0;
          G.reportsDirty = true;
        }
        if (realNow - G.lastSampleReal >= 1000) {
          G.lastSampleReal = realNow;
          S.reports.series.push(Math.round(num(S.reports.qps)));
          if (S.reports.series.length > SERIES_LEN) S.reports.series.splice(0, S.reports.series.length - SERIES_LEN);
          G.reportsDirty = true;
        }
      }
      if (G.reportsDirty && realNow - G.lastStateEmitReal >= 500) {
        G.lastStateEmitReal = realNow;
        G.reportsDirty = false;
        emitState(['reports']);
      }
      if (realNow - G.lastBadgeForce >= 4000) { G.lastBadgeForce = realNow; refreshBadges(true); }
      else refreshBadges(false);
    } catch (e) {
      try { console.error('[SIM.engine] arka plan döngüsü hata verdi:', e); } catch (e2) { /* yut */ }
    }
  }

  function start() {
    if (G.timer) return;
    G.lastTickClock = clockNow();
    G.lastTickReal = Date.now();
    G.lastSampleReal = Date.now();
    G.timer = setInterval(tick, 250);
  }
  function stop() {
    if (G.timer) { clearInterval(G.timer); G.timer = null; }
  }

  /* ==================================================================
   * init / reset
   * ================================================================== */
  function ensureInit() { return G.initPromise || init(); }

  function init() {
    if (G.initPromise) return G.initPromise;
    G.initPromise = (async function () {
      var hem = await SIM.util.sha256Hex(normEmail(D.demoUser.email));
      if (hem !== G.demoHem) { G.demoHem = hem; buildState(); }
      G.initialized = true;
      start();
      emitState(ALL_KEYS.slice());
      emitBusy(true);
      refreshBadges(true);
      setTimeout(function () { refreshBadges(true); }, 1200);
      return S;
    })();
    return G.initPromise;
  }

  function reset() {
    G.gen += 1;
    var pending = G.queue.splice(0);
    pending.forEach(function (it) { try { it.resolve({ ok: false, cancelled: true }); } catch (e) { /* yut */ } });
    buildState();
    G.lastTickClock = clockNow();
    bus.emit('reset', {});
    emitState(ALL_KEYS.slice());
    emitBusy(true);
    refreshBadges(true);
    return ensureInit().then(function () { return S; });
  }

  /* ==================================================================
   * Bağlama
   * ================================================================== */
  bus.on('action', function (a) { return SIM.engine.dispatch(a); });
  bus.on('settings', function (p) {
    if (!p) return;
    if (p.key === 'ambient') {
      if (p.value && S.reports && !(S.reports.qps > 0)) S.reports.qps = 2480;
      G.reportsDirty = true;
    }
    if (p.key === 'paused' && !p.value) { G.lastTickReal = Date.now(); }
  });

  // SIM.state ilk andan itibaren dolu olsun (diğer modüller init beklemeden okuyabilir).
  buildState();

  SIM.engine = {
    init: init,
    reset: reset,
    dispatch: dispatch,
    isBusy: function () { return G.running || G.queue.length > 0; },
    queueLength: function () { return G.queue.length; },
    decide: decide,
    // Ekler
    start: start,
    stop: stop,
    demoHem: function () { return G.demoHem; },
    isSuppressed: isSuppressedUser,
    _internal: {
      deliveryInfo: deliveryInfo, evaluateSegments: evaluateSegments, activeSegIds: activeSegIds,
      pacerTarget: pacerTarget, ambientPaths: AMBIENT_PATHS, laplace: laplace, purposesFor: purposesFor
    }
  };
})(window.SIM);

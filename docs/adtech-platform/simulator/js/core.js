/* core.js — [foundation] SIM.settings, SIM.setSetting, SIM.bus, SIM.util
 * Sözleşme: SPEC.md §4. Klasik script; ES module yok, harici kütüphane yok.
 * Node/VM içinde de yüklenebilir (testler için): window yoksa globalThis kullanılır.
 */
if (typeof window === 'undefined') { globalThis.window = globalThis; }
window.SIM = window.SIM || {};

(function (SIM) {
  'use strict';

  var hasDoc = typeof document !== 'undefined';
  var perfNow = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  SIM.version = '1.0.0';
  /** Yerleşim kırılımları (base.css ile aynı). */
  SIM.BREAKPOINTS = { tablet: 820, desktop: 1180 };

  /* ==================================================================
   * SIM.bus — basit olay yolu
   * ================================================================== */
  var listeners = Object.create(null);
  var anyListeners = [];

  function report(evt, err) {
    try { console.error('[SIM.bus] "' + evt + '" dinleyicisi hata verdi:', err); } catch (e) { /* yut */ }
  }

  function invoke(fn, evt, payload, isAny) {
    try {
      var r = isAny ? fn(evt, payload) : fn(payload, evt);
      if (r && typeof r.then === 'function' && typeof r.catch === 'function') {
        r.catch(function (err) { report(evt, err); });
      }
    } catch (err) {
      report(evt, err);
    }
  }

  var bus = {
    /** on(evt, fn) -> unsubscribe(). fn(payload, evt) */
    on: function (evt, fn) {
      if (typeof fn !== 'function') throw new TypeError('SIM.bus.on("' + evt + '"): dinleyici fonksiyon olmalı');
      (listeners[evt] || (listeners[evt] = [])).push(fn);
      return function () { bus.off(evt, fn); };
    },
    /** Tek seferlik dinleyici. */
    once: function (evt, fn) {
      var wrapped = function (payload, e) { bus.off(evt, wrapped); return fn(payload, e); };
      wrapped._orig = fn;
      return bus.on(evt, wrapped);
    },
    off: function (evt, fn) {
      var arr = listeners[evt];
      if (!arr) return;
      for (var i = arr.length - 1; i >= 0; i--) {
        if (arr[i] === fn || arr[i]._orig === fn) { arr.splice(i, 1); break; }
      }
      if (!arr.length) delete listeners[evt];
    },
    /** Dinleyici hataları yakalanır ve console.error ile raporlanır; diğer dinleyiciler çalışmaya devam eder. */
    emit: function (evt, payload) {
      var arr = listeners[evt];
      if (arr && arr.length) {
        var copy = arr.slice();
        for (var i = 0; i < copy.length; i++) invoke(copy[i], evt, payload, false);
      }
      if (anyListeners.length) {
        var anyCopy = anyListeners.slice();
        for (var j = 0; j < anyCopy.length; j++) invoke(anyCopy[j], evt, payload, true);
      }
    },
    /** Ek: tüm olayları dinler. fn(evt, payload). Hata ayıklama / kayıt için. */
    onAny: function (fn) {
      if (typeof fn !== 'function') throw new TypeError('SIM.bus.onAny: dinleyici fonksiyon olmalı');
      anyListeners.push(fn);
      return function () {
        var i = anyListeners.indexOf(fn);
        if (i >= 0) anyListeners.splice(i, 1);
      };
    },
    /** Ek: bir olayın dinleyici sayısı (test/teşhis). */
    count: function (evt) { return (listeners[evt] || []).length; }
  };
  SIM.bus = bus;

  /* ==================================================================
   * SIM.settings + SIM.setSetting
   * ================================================================== */
  var motionMq = null;
  try {
    if (typeof window.matchMedia === 'function') motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch (e) { motionMq = null; }

  var defaults = {
    speed: 1,            // 0.5 | 1 | 2 | 4
    paused: false,
    stepMode: false,     // true iken her hop öncesi SIM.util.gate() "İleri" bekler
    ambient: true,       // arka plan trafiği
    autoScroll: true,    // telefonda aksiyon sonrası haritaya kaydır
    reducedMotion: !!(motionMq && motionMq.matches)
  };
  var existing = SIM.settings || {};
  SIM.settings = {};
  Object.keys(defaults).forEach(function (k) {
    SIM.settings[k] = Object.prototype.hasOwnProperty.call(existing, k) ? existing[k] : defaults[k];
  });
  Object.keys(existing).forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(SIM.settings, k)) SIM.settings[k] = existing[k];
  });

  var BOOL_KEYS = { paused: 1, stepMode: 1, ambient: 1, autoScroll: 1, reducedMotion: 1 };

  function speedOf(s) {
    var v = Number(s && s.speed);
    return v > 0 && isFinite(v) ? v : 1;
  }

  /* ---- Simülasyon saati: duraklatılmamış, hız ile ölçeklenmiş monoton ms ---- */
  var clk = { base: 0, t0: perfNow(), speed: speedOf(SIM.settings), paused: !!SIM.settings.paused };
  function clockRead() {
    var s = SIM.settings;
    var sp = speedOf(s), pz = !!s.paused;
    var t = perfNow();
    var value = clk.paused ? clk.base : clk.base + (t - clk.t0) * clk.speed;
    if (sp !== clk.speed || pz !== clk.paused) {
      // Ayar setSetting dışında (doğrudan) değiştirilmiş: şu andan itibaren yeni değerlerle say.
      clk.base = value; clk.t0 = t; clk.speed = sp; clk.paused = pz;
    }
    return value;
  }
  function clockRebase() {
    var t = perfNow();
    clk.base = clk.paused ? clk.base : clk.base + (t - clk.t0) * clk.speed;
    clk.t0 = t;
  }

  function applyMotionAttr() {
    if (!hasDoc || !document.documentElement) return;
    try {
      document.documentElement.setAttribute('data-motion', SIM.settings.reducedMotion ? 'reduce' : 'full');
    } catch (e) { /* yut */ }
  }

  /** setSetting(key, value): değiştirir + bus.emit('settings', {key, value, prev}). */
  SIM.setSetting = function (key, value) {
    if (key === 'speed') {
      var v = Number(value);
      if (!(v > 0) || !isFinite(v)) { console.warn('[SIM] geçersiz hız:', value); return SIM.settings.speed; }
      value = v;
    } else if (BOOL_KEYS[key]) {
      value = !!value;
    }
    var prev = SIM.settings[key];
    if (key === 'speed' || key === 'paused') {
      clockRebase();
      SIM.settings[key] = value;
      clk.speed = speedOf(SIM.settings);
      clk.paused = !!SIM.settings.paused;
    } else {
      SIM.settings[key] = value;
    }
    if (key === 'reducedMotion') applyMotionAttr();
    bus.emit('settings', { key: key, value: value, prev: prev });
    if (key === 'stepMode' && !value) releaseGates();
    return value;
  };

  if (motionMq) {
    var onMotionChange = function (e) { SIM.setSetting('reducedMotion', !!e.matches); };
    try {
      if (typeof motionMq.addEventListener === 'function') motionMq.addEventListener('change', onMotionChange);
      else if (typeof motionMq.addListener === 'function') motionMq.addListener(onMotionChange);
    } catch (e) { /* yut */ }
  }
  applyMotionAttr();

  /* ==================================================================
   * SIM.util
   * ================================================================== */
  var util = {};

  /* ---------- zaman: wait / gate / clock ---------- */
  var TICK_MAX = 40;      // ms; ayar değişikliklerine tepki süresi
  var TICK_PAUSED = 50;

  /** Hız ile ölçeklenmiş, duraklatılmamış simülasyon saati (ms, monoton). Animasyonlar da kullanabilir. */
  util.clock = clockRead;

  /**
   * wait(ms) -> Promise
   * ms / speed kadar *duraklatılmamış* süre bekler. Bekleme sırasında hız değişirse kalan süre yeni hızla akar;
   * paused iken ilerlemez (duraklatma bekleme ortasında olsa bile donar). wait(0) da duraklatmada bekler.
   */
  util.wait = function (ms) {
    ms = Number(ms);
    if (!(ms > 0) || !isFinite(ms)) ms = 0;
    return new Promise(function (resolve) {
      var target = clockRead() + ms;
      function tick() {
        var now = clockRead();
        var s = SIM.settings;
        if (!s.paused && now >= target) { resolve(); return; }
        var delay = s.paused ? TICK_PAUSED : Math.min(TICK_MAX, Math.max(0, (target - now) / speedOf(s)));
        setTimeout(tick, delay);
      }
      if (ms === 0 && !SIM.settings.paused) { setTimeout(resolve, 0); return; }
      setTimeout(tick, SIM.settings.paused ? TICK_PAUSED : Math.min(TICK_MAX, ms / speedOf(SIM.settings)));
    });
  };

  var gateResolvers = [];
  function releaseGates() {
    if (!gateResolvers.length) return 0;
    var list = gateResolvers;
    gateResolvers = [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](); } catch (e) { console.error(e); }
    }
    bus.emit('step:waiting', false);
    return list.length;
  }

  /**
   * gate() -> Promise
   * stepMode kapalıysa hemen çözülür. Açıksa bus 'step:next' gelene kadar bekler.
   * İlk bekleyen eklendiğinde bus.emit('step:waiting', true); serbest bırakılınca ('step:waiting', false).
   * Tek bir 'step:next' o anda bekleyen TÜM kapıları açar (paralel hop'lar birlikte ilerler).
   * stepMode kapatılınca ve 'reset' olayında da bekleyenler serbest bırakılır (kilitlenme olmaz).
   */
  util.gate = function () {
    if (!SIM.settings.stepMode) return Promise.resolve();
    return new Promise(function (resolve) {
      gateResolvers.push(resolve);
      if (gateResolvers.length === 1) bus.emit('step:waiting', true);
    });
  };
  /** Ek: bekleyen kapı sayısı. */
  util.gateWaiting = function () { return gateResolvers.length; };
  /** Ek: bekleyen tüm kapıları aç (bus 'step:next' ile aynı etki). */
  util.releaseGates = releaseGates;
  /** Ek: kısayol — bus.emit('step:next'). */
  util.stepNext = function () { bus.emit('step:next'); };

  bus.on('step:next', function () { releaseGates(); });
  bus.on('reset', function () { releaseGates(); });

  /** Sonraki animasyon karesi (rAF yoksa ~16 ms). */
  util.raf = function () {
    return new Promise(function (resolve) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function (t) { resolve(t); });
      else setTimeout(function () { resolve(perfNow()); }, 16);
    });
  };

  /* ---------- rastgelelik ---------- */
  util.clamp = function (x, a, b) {
    x = Number(x);
    if (a > b) { var t = a; a = b; b = t; }
    return x < a ? a : (x > b ? b : x);
  };
  /** float, [a, b) */
  util.rand = function (a, b) {
    if (b === undefined) { b = a === undefined ? 1 : a; a = 0; }
    return a + Math.random() * (b - a);
  };
  /** tamsayı, [a, b] dahil */
  util.randInt = function (a, b) {
    a = Math.ceil(a); b = Math.floor(b);
    if (b < a) { var t = a; a = b; b = t; }
    return a + Math.floor(Math.random() * (b - a + 1));
  };
  util.pick = function (arr) {
    if (!arr || !arr.length) return undefined;
    return arr[Math.floor(Math.random() * arr.length)];
  };

  /** Ek: FNV-1a 32 bit (işaretsiz). Partition hesabı ve deterministik kararlar için. */
  util.hash32 = function (str) {
    str = String(str);
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };

  /**
   * seeded(seed) -> () => [0,1)   (mulberry32). seed sayı veya metin olabilir.
   * Ek: dönen fonksiyonda .int(a,b), .range(a,b), .pick(arr) yardımcıları vardır.
   */
  util.seeded = function (seed) {
    var s = (typeof seed === 'number' && isFinite(seed)) ? (seed >>> 0) : util.hash32(seed === undefined ? 'sim' : seed);
    if (s === 0) s = 0x9e3779b9;
    var next = function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = function (a, b) { return a + next() * (b - a); };
    next.int = function (a, b) { return Math.ceil(a) + Math.floor(next() * (Math.floor(b) - Math.ceil(a) + 1)); };
    next.pick = function (arr) { return arr && arr.length ? arr[Math.floor(next() * arr.length)] : undefined; };
    return next;
  };

  /* ---------- kimlik ---------- */
  var B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (I, L, O, U yok)
  var issued = Object.create(null);
  var cryptoObj = (typeof window.crypto !== 'undefined') ? window.crypto : null;

  function randomCode(len) {
    var out = '';
    var bytes = null;
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      bytes = new Uint8Array(len);
      cryptoObj.getRandomValues(bytes);
    }
    for (var i = 0; i < len; i++) {
      var r = bytes ? (bytes[i] & 31) : Math.floor(Math.random() * 32);
      out += B32.charAt(r);
    }
    return out;
  }

  /**
   * uid(prefix, len=4) -> 'P-7Q2K'
   * Kısa, okunur kimlik (Crockford base32). Oturum içinde tekildir; prefix verilmezse yalnızca kod döner.
   */
  util.uid = function (prefix, len) {
    len = Math.floor(Number(len)) || 4;
    if (len < 1) len = 1;
    if (len > 16) len = 16;
    var p = prefix == null || prefix === '' ? '' : String(prefix);
    var sep = (!p || /[-_:.\/]$/.test(p)) ? '' : '-';
    var tries = 0, id;
    do {
      id = p + sep + randomCode(len);
      tries++;
      if (tries % 12 === 0 && len < 16) len++; // alan doluysa uzunluğu artır
    } while (issued[id]);
    issued[id] = 1;
    return id;
  };

  /* ---------- SHA-256 ---------- */
  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var bin = unescape(encodeURIComponent(str));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function hex32(x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }

  /** Saf JS SHA-256 (UTF-8). Senkron. */
  function sha256PureHex(input) {
    var bytes = (input instanceof Uint8Array) ? input : utf8Bytes(String(input));
    var len = bytes.length;
    var total = ((len + 9 + 63) >> 6) << 6; // 0x80 + 8 bayt uzunluk, 64'ün katı
    var buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    var bitsHi = Math.floor(len / 0x20000000);
    var bitsLo = (len * 8) >>> 0;
    buf[total - 8] = (bitsHi >>> 24) & 255; buf[total - 7] = (bitsHi >>> 16) & 255;
    buf[total - 6] = (bitsHi >>> 8) & 255;  buf[total - 5] = bitsHi & 255;
    buf[total - 4] = (bitsLo >>> 24) & 255; buf[total - 3] = (bitsLo >>> 16) & 255;
    buf[total - 2] = (bitsLo >>> 8) & 255;  buf[total - 1] = bitsLo & 255;

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
        h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var W = new Int32Array(64);
    for (var off = 0; off < total; off += 64) {
      var i;
      for (i = 0; i < 16; i++) {
        var j = off + i * 4;
        W[i] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
      }
      for (i = 16; i < 64; i++) {
        var w15 = W[i - 15], w2 = W[i - 2];
        var s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
        var s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K256[i] + W[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return hex32(h0) + hex32(h1) + hex32(h2) + hex32(h3) + hex32(h4) + hex32(h5) + hex32(h6) + hex32(h7);
  }

  function bufToHex(buf) {
    var arr = new Uint8Array(buf), out = '';
    for (var i = 0; i < arr.length; i++) out += (arr[i] < 16 ? '0' : '') + arr[i].toString(16);
    return out;
  }

  function getSubtle() {
    try {
      var c = window.crypto;
      if (c && c.subtle && typeof c.subtle.digest === 'function') return c.subtle;
    } catch (e) { /* yut */ }
    return null;
  }

  /**
   * sha256Hex(str, opts?) -> Promise<string>
   * crypto.subtle varsa onu kullanır; yoksa (veya hata verirse) saf JS fallback.
   * Ek: opts.fallback === true veya SIM.util.forceShaFallback === true ise doğrudan fallback.
   */
  util.sha256Hex = function (str, opts) {
    str = str == null ? '' : String(str);
    var force = (opts && opts.fallback === true) || util.forceShaFallback === true;
    var subtle = force ? null : getSubtle();
    if (!subtle) return Promise.resolve(sha256PureHex(str));
    try {
      return subtle.digest('SHA-256', utf8Bytes(str)).then(bufToHex, function () { return sha256PureHex(str); });
    } catch (e) {
      return Promise.resolve(sha256PureHex(str));
    }
  };
  /** Ek: senkron saf JS SHA-256 (fallback'in kendisi). */
  util.sha256HexSync = sha256PureHex;
  util.forceShaFallback = false;

  /** shortHash(hex) -> 'a3f9…c41e' (ilk 4 + … + son 4) */
  util.shortHash = function (hex) {
    hex = hex == null ? '' : String(hex);
    if (hex.length <= 9) return hex;
    return hex.slice(0, 4) + '…' + hex.slice(-4);
  };

  /* ---------- biçimlendirme (tr-TR) ---------- */
  function manualNumber(n, minD, maxD) {
    var neg = n < 0;
    var s = Math.abs(n).toFixed(maxD);
    var parts = s.split('.');
    var intPart = parts[0];
    var frac = parts[1] || '';
    while (frac.length > minD && frac.charAt(frac.length - 1) === '0') frac = frac.slice(0, -1);
    intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var out = frac ? intPart + ',' + frac : intPart;
    if (neg && /[1-9]/.test(out)) out = '-' + out;
    return out;
  }

  var intlOk = false;
  try {
    intlOk = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(1234.5) === '1.234,5'
      && new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(8499) === '8.499';
  } catch (e) { intlOk = false; }

  var nfCache = Object.create(null);
  function fmtNumber(n, minD, maxD) {
    if (maxD < minD) maxD = minD;
    if (!intlOk) return manualNumber(n, minD, maxD);
    var key = minD + ':' + maxD;
    var f = nfCache[key];
    if (!f) {
      f = nfCache[key] = new Intl.NumberFormat('tr-TR', {
        minimumFractionDigits: minD, maximumFractionDigits: maxD, useGrouping: true
      });
    }
    var out = f.format(n);
    return out === '-0' ? '0' : out;
  }
  function num(n) { n = Number(n); return isFinite(n) ? n : NaN; }
  var DASH = '—';

  /** Ek: genel sayı biçimi. fmtNum(1234.56, 1) -> '1.234,6' */
  util.fmtNum = function (n, digits, minDigits) {
    n = num(n); if (isNaN(n)) return DASH;
    var d = digits == null ? 0 : digits;
    return fmtNumber(n, minDigits == null ? 0 : Math.min(minDigits, d), d);
  };
  /** fmtInt(1234567) -> '1.234.567' */
  util.fmtInt = function (n) {
    n = num(n); if (isNaN(n)) return DASH;
    return fmtNumber(Math.round(n), 0, 0);
  };
  /** fmtTL(85) -> '85,00 ₺' ; fmtTL(32999, 0) -> '32.999 ₺' */
  util.fmtTL = function (n, digits) {
    n = num(n); if (isNaN(n)) return DASH;
    var d = digits == null ? 2 : digits;
    return fmtNumber(n, d, d) + ' ₺';
  };
  /** fmtPct(0.006) -> '%0,6'  (x bir orandır: 0.006 = %0,6) */
  util.fmtPct = function (x, digits) {
    x = num(x); if (isNaN(x)) return DASH;
    var d = digits == null ? 1 : digits;
    var v = fmtNumber(Math.abs(x * 100), d, d);
    var neg = x < 0 && /[1-9]/.test(v);
    return (neg ? '-%' : '%') + v;
  };
  /** fmtMs(1.23) -> '1,2 ms' ; fmtMs(118.4) -> '118 ms' ; fmtMs(0.35) -> '0,35 ms' */
  util.fmtMs = function (ms) {
    ms = num(ms); if (isNaN(ms)) return DASH;
    var a = Math.abs(ms);
    if (a < 1) return fmtNumber(ms, 1, 2) + ' ms';
    if (a < 10) return fmtNumber(ms, 1, 1) + ' ms';
    return fmtNumber(Math.round(ms), 0, 0) + ' ms';
  };
  /** Ek: fmtCompact(1840000) -> '1,8 Mn' ; 412000 -> '412 B' ; 2,4e9 -> '2,4 Mr' */
  util.fmtCompact = function (n) {
    n = num(n); if (isNaN(n)) return DASH;
    var a = Math.abs(n), unit = '', v = n;
    if (a >= 1e9) { v = n / 1e9; unit = ' Mr'; }
    else if (a >= 1e6) { v = n / 1e6; unit = ' Mn'; }
    else if (a >= 1e4) { v = n / 1e3; unit = ' B'; }
    else return util.fmtInt(n);
    var d = Math.abs(v) < 10 ? 1 : 0;
    return fmtNumber(v, 0, d) + unit;
  };

  /* ---- zaman biçimleri: Europe/Istanbul (2016'dan beri sabit UTC+3) ---- */
  var tfTime = null, tfDate = null;
  try {
    tfTime = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    if (tfTime.format(Date.UTC(2026, 9, 31, 7, 4, 31)) !== '10:04:31') tfTime = null;
  } catch (e) { tfTime = null; }
  try {
    tfDate = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' });
    if (tfDate.format(Date.UTC(2026, 9, 31, 7, 4, 31)) !== '31.10.2026') tfDate = null;
  } catch (e) { tfDate = null; }

  function pad2(x) { return (x < 10 ? '0' : '') + x; }
  function toTs(ts) {
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === 'string') { var p = Date.parse(ts); return isNaN(p) ? NaN : p; }
    return Number(ts);
  }
  function istParts(ts) {
    var d = new Date(ts + 3 * 3600 * 1000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }

  /** fmtTime(ts) -> '10:04:31' (Europe/Istanbul). ts: ms, Date veya ISO metni; boşsa nowSim(). */
  util.fmtTime = function (ts) {
    ts = ts == null ? util.nowSim() : toTs(ts);
    if (!isFinite(ts)) return DASH;
    if (tfTime) return tfTime.format(ts);
    var p = istParts(ts);
    return pad2(p.h) + ':' + pad2(p.mi) + ':' + pad2(p.s);
  };
  /** Ek: fmtDate(ts) -> '31.10.2026' */
  util.fmtDate = function (ts) {
    ts = ts == null ? util.nowSim() : toTs(ts);
    if (!isFinite(ts)) return DASH;
    if (tfDate) return tfDate.format(ts);
    var p = istParts(ts);
    return pad2(p.d) + '.' + pad2(p.mo) + '.' + p.y;
  };
  /** Ek: fmtDateTime(ts) -> '31.10.2026 10:04:31' */
  util.fmtDateTime = function (ts) { return util.fmtDate(ts) + ' ' + util.fmtTime(ts); };

  /** nowSim() -> SIM.state.simNow varsa onu, yoksa Date.now() */
  util.nowSim = function () {
    var st = SIM.state;
    return (st && typeof st.simNow === 'number' && isFinite(st.simNow)) ? st.simNow : Date.now();
  };

  /* ---------- DOM yardımcıları ---------- */
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function kebab(s) { return String(s).replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }); }

  function applyAttrs(node, attrs, isSvg) {
    for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v == null) continue;
      var isAria = k.indexOf('aria-') === 0, isData = k.indexOf('data-') === 0;
      if (v === false && !isAria && !isData) continue;
      if (k === 'class' || k === 'className') {
        if (Array.isArray(v)) v = v.filter(Boolean).join(' ');
        if (v === '' || v === false) continue;
        node.setAttribute('class', String(v));
      } else if (k === 'dataset' && typeof v === 'object') {
        for (var dk in v) {
          if (Object.prototype.hasOwnProperty.call(v, dk) && v[dk] != null) node.setAttribute('data-' + kebab(dk), String(v[dk]));
        }
      } else if (k === 'style') {
        if (typeof v === 'string') node.style.cssText = v;
        else if (typeof v === 'object') {
          for (var sk in v) {
            if (!Object.prototype.hasOwnProperty.call(v, sk) || v[sk] == null) continue;
            if (sk.indexOf('--') === 0 || sk.indexOf('-') > 0) node.style.setProperty(sk, String(v[sk]));
            else node.style[sk] = v[sk];
          }
        }
      } else if (k.length > 2 && k.charAt(0) === 'o' && k.charAt(1) === 'n' && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'text') {
        node.textContent = String(v);
      } else if (k === 'html') {
        node.innerHTML = String(v);
      } else if (k === 'ref' && typeof v === 'function') {
        v(node);
      } else if (!isSvg && (k === 'value' || k === 'checked' || k === 'selected' || k === 'indeterminate')) {
        node[k] = v;
        if (k !== 'indeterminate' && typeof v !== 'object') {
          if (v === true) node.setAttribute(k, ''); else if (k === 'value') node.setAttribute('value', String(v));
        }
      } else if (v === true) {
        node.setAttribute(k, (isAria || isData) ? 'true' : '');
      } else if (v === false) {
        node.setAttribute(k, 'false'); // yalnızca aria-* / data-*
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }

  function appendChildren(node, kids) {
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c == null || c === false || c === true) continue;
      if (Array.isArray(c)) { appendChildren(node, c); continue; }
      if (typeof c === 'object' && typeof c.nodeType === 'number') { node.appendChild(c); continue; }
      node.appendChild(document.createTextNode(String(c)));
    }
  }

  function isChildLike(a) {
    return a == null || typeof a === 'string' || typeof a === 'number' || Array.isArray(a) ||
      (typeof a === 'object' && typeof a.nodeType === 'number');
  }

  /**
   * el(tag, attrs, ...children) -> HTMLElement
   * attrs: class|className (metin/dizi), dataset{}, style (metin/nesne, --değişken destekli), on<olay>: fn,
   *        text, html, ref(fn), value/checked (özellik olarak), aria-* ve data-* (true/false -> "true"/"false"),
   *        boolean öznitelikler (true -> "", false -> eklenmez), diğerleri setAttribute.
   * attrs atlanabilir: el('p', 'metin') çalışır.
   */
  util.el = function (tag, attrs) {
    var node = document.createElement(tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    if (isChildLike(attrs)) kids.unshift(attrs);
    else if (attrs) applyAttrs(node, attrs, false);
    appendChildren(node, kids);
    return node;
  };

  /** svg(tag, attrs, ...children) -> SVGElement (aynı attrs kuralları; değerler setAttribute ile) */
  util.svg = function (tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    if (isChildLike(attrs)) kids.unshift(attrs);
    else if (attrs) applyAttrs(node, attrs, true);
    appendChildren(node, kids);
    return node;
  };

  /** Ek: düğümün tüm çocuklarını sil. */
  util.clear = function (node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  };
  /** Ek: querySelector kısayolları. */
  util.qs = function (sel, root) { return (root || document).querySelector(sel); };
  util.qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /** Ek: HTML kaçışı (innerHTML gerekiyorsa). */
  util.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
    });
  };

  /** Ek: debounce(fn, ms) */
  util.debounce = function (fn, ms) {
    var t = null;
    return function () {
      var self = this, args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms || 0);
    };
  };

  /** Ek: derin kopya (structuredClone, yoksa JSON). Fonksiyon içermeyen düz veri için. */
  util.clone = function (x) {
    if (x == null || typeof x !== 'object') return x;
    try { if (typeof structuredClone === 'function') return structuredClone(x); } catch (e) { /* JSON'a düş */ }
    return JSON.parse(JSON.stringify(x));
  };

  /** Ek: 'phone' | 'tablet' | 'desktop' — base.css kırılımlarıyla aynı. */
  util.breakpoint = function () {
    var w = (typeof window.innerWidth === 'number') ? window.innerWidth : SIM.BREAKPOINTS.desktop;
    if (w >= SIM.BREAKPOINTS.desktop) return 'desktop';
    if (w >= SIM.BREAKPOINTS.tablet) return 'tablet';
    return 'phone';
  };

  SIM.util = util;

  // İç test kancası (fallback doğrulaması için): SIM._internal.sha256Pure
  SIM._internal = SIM._internal || {};
  SIM._internal.sha256Pure = sha256PureHex;
  SIM._internal.manualNumber = manualNumber;
})(window.SIM);

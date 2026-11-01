// ===========================================================================
// Küçük, bağımlılıksız ses sentezi (DSP) kütüphanesi.
// Saf JavaScript: hem tarayıcıda (oyun açılırken ses üretmek) hem Node'da
// (WAV dosyası dışa aktarmak) aynı kod çalışır. Hiç ses dosyası kullanılmaz.
// Tüm sinyaller mono Float32Array'dir.
// ===========================================================================

export const SR = 44100;
const TAU = Math.PI * 2;

/** Tohumlu rastgele sayı üreteci (mulberry32) — aynı tohum = aynı ses. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const samples = (sec) => Math.max(1, Math.round(sec * SR));
export const buf = (sec) => new Float32Array(samples(sec));

/**
 * Parametre: sabit sayı, fonksiyon f(t) ya da kırılma noktaları [[t, v], ...]
 * (noktalar arası doğrusal).
 */
export function param(p) {
  if (typeof p === 'function') return p;
  if (Array.isArray(p)) {
    const pts = p;
    return (t) => {
      if (t <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        if (t <= pts[i][0]) {
          const [t0, v0] = pts[i - 1];
          const [t1, v1] = pts[i];
          return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
        }
      }
      return pts[pts.length - 1][1];
    };
  }
  return () => p;
}

/** a'dan b'ye üstel geçiş (frekans taramaları için kulağa doğal gelir). */
export const sweep = (a, b, dur, curve = 1) => (t) => a * Math.pow(b / a, Math.pow(Math.min(1, Math.max(0, t / dur)), curve));

/** Hızlı vuruş + üstel sönüm zarfı. */
export const perc = (attack, decay) => (t) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

/** Yumuşak yükselip inen zarf (whoosh'lar için). peak: 0..1 tepe konumu. */
export const swell = (dur, peak = 0.5, power = 2) => (t) => {
  const x = t / dur;
  if (x <= 0 || x >= 1) return 0;
  const y = x < peak ? x / peak : (1 - x) / (1 - peak);
  return Math.pow(Math.sin((y * Math.PI) / 2), power);
};

// ---------------------------------------------------------------------------
// Kaynaklar
// ---------------------------------------------------------------------------

function polyBlep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Osilatör. type: sine | tri | saw | square. freq/amp: param(). */
export function osc(sec, { type = 'sine', freq = 440, amp = 1, phase = 0, pw = 0.5 } = {}) {
  const out = buf(sec);
  const f = param(freq);
  const A = param(amp);
  let ph = phase;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const fr = f(t);
    const dt = Math.min(0.5, Math.abs(fr) / SR);
    let v;
    if (type === 'sine') v = Math.sin(TAU * ph);
    else if (type === 'tri') v = 1 - 4 * Math.abs(ph - 0.5);
    else if (type === 'saw') v = 2 * ph - 1 - polyBlep(ph, dt);
    else {
      v = ph < pw ? 1 : -1;
      v += polyBlep(ph, dt);
      v -= polyBlep((ph + 1 - pw) % 1, dt);
    }
    out[i] = v * A(t);
    ph += fr / SR;
    ph -= Math.floor(ph);
  }
  return out;
}

/** Gürültü. color: white | pink | brown. */
export function noise(sec, { color = 'white', amp = 1, r = Math.random } = {}) {
  const out = buf(sec);
  const A = param(amp);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0,
    br = 0;
  for (let i = 0; i < out.length; i++) {
    const w = r() * 2 - 1;
    let v = w;
    if (color === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else if (color === 'brown') {
      br = (br + 0.02 * w) / 1.02;
      v = br * 3.5;
    }
    out[i] = v * A(i / SR);
  }
  return out;
}

/** Seyrek "çıtırtı" darbeleri (ateş, gıcırtı, fitil). density: saniyedeki darbe sayısı (param). */
export function crackle(sec, { density = 200, amp = 1, r = Math.random } = {}) {
  const out = buf(sec);
  const d = param(density);
  const A = param(amp);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    if (r() < d(t) / SR) out[i] = (r() * 2 - 1) * A(t);
  }
  return out;
}

/**
 * Modal sentez: sönümlü sinüsler toplamı. Metal, çan, tahta tınısı.
 * ratios: f0'a oranlar, decays: sn (tek sayı ya da dizi), amps: genlikler.
 */
export function modal(sec, { f0 = 440, ratios = [1], decays = 0.3, amps = null, r = Math.random, detune = 0.004 } = {}) {
  const out = buf(sec);
  for (let k = 0; k < ratios.length; k++) {
    const f = f0 * ratios[k] * (1 + (r() * 2 - 1) * detune);
    if (f >= SR * 0.45) continue;
    const dcy = Array.isArray(decays) ? decays[k] : decays / Math.sqrt(ratios[k]);
    const a = amps ? amps[k] : 1 / (k + 1);
    const ph = r() * TAU;
    const w = (TAU * f) / SR;
    const n = Math.min(out.length, Math.ceil(dcy * 7 * SR));
    const fadeN = Math.min(2205, n >> 2); // son 50 ms yumuşak bitiş
    for (let i = 0; i < n; i++) {
      const k = i >= n - fadeN ? (n - i) / fadeN : 1;
      out[i] += a * Math.sin(w * i + ph) * Math.exp(-i / SR / dcy) * k;
    }
  }
  return out;
}

/** Karplus-Strong telli çalgı: yay teli "tınngg". */
export function pluck(sec, { freq = 110, decay = 0.994, brightness = 0.6, r = Math.random } = {}) {
  const out = buf(sec);
  const N = Math.max(2, Math.round(SR / freq));
  const line = new Float32Array(N);
  let prev = 0;
  for (let i = 0; i < N; i++) {
    const w = r() * 2 - 1;
    prev = prev + brightness * (w - prev);
    line[i] = prev;
  }
  let idx = 0;
  for (let i = 0; i < out.length; i++) {
    const a = line[idx];
    const b = line[(idx + 1) % N];
    const v = decay * 0.5 * (a + b);
    out[i] = a;
    line[idx] = v;
    idx = (idx + 1) % N;
  }
  return out;
}

/**
 * Formant ses: testere dişi kaynak + bant geçiren formant filtreleri.
 * Sevimli yaratık iniltileri, ciyaklamalar. formants: [[frekans, Q, kazanç], ...]
 * ya da her biri param() olan frekanslar.
 */
export function voice(sec, { pitch = 300, formants = [[700, 6, 1], [1200, 8, 0.6], [2600, 10, 0.3]], vibrato = 0, vibratoRate = 6, breath = 0.05, r = Math.random } = {}) {
  const p = param(pitch);
  const src = osc(sec, { type: 'saw', freq: (t) => p(t) * (1 + vibrato * Math.sin(TAU * vibratoRate * t)) });
  const br = noise(sec, { r });
  for (let i = 0; i < src.length; i++) src[i] += br[i] * breath;
  const out = buf(sec);
  for (const [f, q, g] of formants) addInto(out, filter(src, 'bp', f, q), 0, g);
  return out;
}

// ---------------------------------------------------------------------------
// İşleyiciler
// ---------------------------------------------------------------------------

/**
 * RBJ biquad filtre. type: lp | hp | bp | peak. cutoff/Q param() olabilir
 * (zamanla değişen kesim frekansı = "wah", whoosh taramaları).
 */
export function filter(x, type, cutoff, Q = 0.707, gainDb = 0) {
  const fc = param(cutoff);
  const fq = param(Q);
  const y = new Float32Array(x.length);
  let b0 = 1,
    b1 = 0,
    b2 = 0,
    a1 = 0,
    a2 = 0;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  const A = Math.pow(10, gainDb / 40);
  for (let i = 0; i < x.length; i++) {
    if ((i & 15) === 0) {
      const t = i / SR;
      const f = Math.min(SR * 0.45, Math.max(15, fc(t)));
      const q = Math.max(0.1, fq(t));
      const w0 = (TAU * f) / SR;
      const cs = Math.cos(w0);
      const al = Math.sin(w0) / (2 * q);
      let a0;
      if (type === 'lp') {
        b0 = (1 - cs) / 2;
        b1 = 1 - cs;
        b2 = b0;
        a0 = 1 + al;
      } else if (type === 'hp') {
        b0 = (1 + cs) / 2;
        b1 = -(1 + cs);
        b2 = b0;
        a0 = 1 + al;
      } else if (type === 'bp') {
        b0 = al;
        b1 = 0;
        b2 = -al;
        a0 = 1 + al;
      } else {
        b0 = 1 + al * A;
        b1 = -2 * cs;
        b2 = 1 - al * A;
        a0 = 1 + al / A;
      }
      a1 = (-2 * cs) / a0;
      a2 = (type === 'peak' ? 1 - al / A : 1 - al) / a0;
      b0 /= a0;
      b1 /= a0;
      b2 /= a0;
    }
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** Zarf uygula (yerinde). env: param(). */
export function mul(x, env) {
  const e = param(env);
  for (let i = 0; i < x.length; i++) x[i] *= e(i / SR);
  return x;
}

export function gain(x, g) {
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

/** Yumuşak doyum (tanh) — darbelere "gövde" katar. */
export function drive(x, amount = 2) {
  const n = Math.tanh(amount);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * amount) / n;
  return x;
}

/** Halka modülasyonu / tremolo. */
export function tremolo(x, rate, depth = 0.5) {
  const rt = param(rate);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    ph += rt(i / SR) / SR;
    x[i] *= 1 - depth * (0.5 + 0.5 * Math.sin(TAU * ph));
  }
  return x;
}

export function reverse(x) {
  return Float32Array.from(x).reverse();
}

/** src'yi dst'ye `at` saniye ofsetle ekler (dst yeterince uzun olmalı). */
export function addInto(dst, src, at = 0, g = 1) {
  const o = Math.round(at * SR);
  const n = Math.min(src.length, dst.length - o);
  // katmanın son 10 ms'sini söndür: kesilme noktasında "tık" olmasın
  const fadeN = Math.min(441, n >> 2);
  for (let i = Math.max(0, -o); i < n; i++) {
    const k = i >= n - fadeN ? (n - i) / fadeN : 1;
    dst[o + i] += src[i] * g * k;
  }
  return dst;
}

/** Katmanları tek bir buffer'da birleştirir: [[sinyal, zaman, kazanç], ...] */
export function layers(sec, list) {
  const out = buf(sec);
  for (const [s, at = 0, g = 1] of list) addInto(out, s, at, g);
  return out;
}

/**
 * Freeverb benzeri küçük yankı (4 tarak + 2 tüm geçiren). tail: eklenen kuyruk (sn).
 */
export function reverb(x, { size = 0.6, damp = 0.35, mix = 0.25, tail = 0.6 } = {}) {
  x = Float32Array.from(x);
  const fx = Math.min(441, x.length);
  for (let i = 0; i < fx; i++) x[x.length - 1 - i] *= i / fx; // kuru sinyalin sonunu yumuşat
  const n = x.length + samples(tail);
  const wet = new Float32Array(n);
  const combs = [1116, 1188, 1277, 1356, 1422, 1491].map((d) => Math.round(d * (0.6 + size * 0.6) * (SR / 44100)));
  const fb = 0.7 + size * 0.26;
  for (const d of combs) {
    const line = new Float32Array(d);
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const out = line[idx];
      lp = out * (1 - damp) + lp * damp;
      line[idx] = (i < x.length ? x[i] : 0) + lp * fb;
      wet[i] += out;
      idx = (idx + 1) % d;
    }
  }
  for (const d of [556, 441]) {
    const line = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const bufOut = line[idx];
      const inp = wet[i];
      wet[i] = -inp + bufOut;
      line[idx] = inp + bufOut * 0.5;
      idx = (idx + 1) % d;
    }
  }
  const out = new Float32Array(n);
  const wg = mix / combs.length;
  for (let i = 0; i < n; i++) out[i] = (i < x.length ? x[i] * (1 - mix * 0.5) : 0) + wet[i] * wg;
  return out;
}

/** Tek tekrarlı yankı. */
export function echo(x, { time = 0.12, feedback = 0.35, mix = 0.3, repeats = 4 } = {}) {
  const out = new Float32Array(x.length + samples(time * repeats));
  addInto(out, x);
  let g = mix;
  for (let k = 1; k <= repeats; k++, g *= feedback) addInto(out, x, time * k, g);
  return out;
}

/** DC kaydırmasını temizle, baş/son kısa yumuşatma, tepe normalizasyonu. */
export function finalize(x, { peak = 0.89, fadeIn = 0.001, fadeOut = 0.02, trim = true } = {}) {
  // DC engelleyici
  let px = 0;
  let py = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] - px + 0.995 * py;
    px = x[i];
    py = v;
    x[i] = v;
  }
  // sondaki sessizliği kırp
  let end = x.length;
  if (trim) {
    let m = 0;
    for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
    const th = m * 0.0015;
    while (end > SR * 0.05 && Math.abs(x[end - 1]) < th) end--;
    end = Math.min(x.length, end + samples(0.01));
  }
  const y = x.subarray(0, end);
  const fi = samples(fadeIn);
  const fo = Math.min(samples(fadeOut), y.length >> 1);
  for (let i = 0; i < fi && i < y.length; i++) y[i] *= i / fi;
  for (let i = 0; i < fo; i++) y[y.length - 1 - i] *= i / fo;
  let m = 0;
  for (let i = 0; i < y.length; i++) m = Math.max(m, Math.abs(y[i]));
  if (m > 0) gain(y, peak / m);
  return Float32Array.from(y);
}

// ---------------------------------------------------------------------------
// WAV (16 bit PCM mono)
// ---------------------------------------------------------------------------
export function encodeWav(x, sampleRate = SR) {
  const bytes = 44 + x.length * 2;
  const ab = new ArrayBuffer(bytes);
  const v = new DataView(ab);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-1, Math.min(1, x[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return ab;
}

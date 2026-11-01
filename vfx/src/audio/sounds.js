// ===========================================================================
// SES KÜTÜPHANESİ — her ses bir "tarif"tir: tohumlu rastgele sayı (r) alır,
// Float32Array (44.1 kHz mono) döndürür. Hiç ses dosyası yoktur; farklı tohumlar
// aynı sesin doğal varyasyonlarını üretir (aynı vuruş 100 kez arka arkaya
// çalınca robotik duyulmasın diye).
//
// def alanları: name (Türkçe ad), category, gain (karışım seviyesi),
//   rate (çalarken rastgele perde sapması ±), limit (35 ms içinde en fazla kaç kez),
//   loop (döngü sesi mi), priority (ses sınırı dolunca hangisi kalsın)
// ===========================================================================
import {
  osc,
  noise,
  crackle,
  modal,
  voice,
  param,
  pluck,
  filter,
  mul,
  gain,
  drive,
  tremolo,
  reverse,
  addInto,
  layers,
  reverb,
  echo,
  finalize,
  sweep,
  perc,
  swell,
  buf,
  samples,
  SR,
} from './dsp.js';

export const CATEGORIES = {
  vurus: '⚔️ Vuruşlar',
  okcu: '🏹 Okçu',
  buyu: '✨ Büyü & Efekt',
  hareket: '💨 Hareket',
  ates: '🔥 Ateş',
  firtina: '⛈️ Fırtına',
  yaratik: '👾 Yaratık',
  kahraman: '🗣️ Kahraman Sesleri',
  arayuz: '🪙 Ödül & Arayüz',
};

export const SOUNDS = {};
function def(id, category, name, opts, render) {
  SOUNDS[id] = { id, category, name, gain: 1, rate: 0.06, limit: 3, loop: false, priority: 0, ...opts, render };
}

// ---------------------------------------------------------------------------
// Yapı taşları
// ---------------------------------------------------------------------------
const R = (r, a, b) => a + r() * (b - a);

/** Bant geçiren gürültü taraması: savurma / rüzgâr sesi. */
function whoosh(r, dur, f0, f1, { q = 1.2, peak = 0.45, color = 'pink' } = {}) {
  return mul(filter(noise(dur, { color, r }), 'bp', sweep(f0, f1, dur), q), swell(dur, peak, 1.5));
}
/** Perdesi düşen sinüs gövdesi: darbenin "güm"ü. */
function thud(f0, f1, decay, dur = decay * 7) {
  return osc(dur, { freq: sweep(f0, f1, decay * 2.5), amp: perc(0.002, decay) });
}
/** Filtreli gürültü patlaması. */
function burst(r, dur, type, f, q, decay, color = 'white') {
  return mul(filter(noise(dur, { r, color }), type, f, q), perc(0.0008, decay));
}
const click = (r, hp = 3500, decay = 0.0015) => burst(r, 0.02, 'hp', hp, 0.7, decay);
/** Metalik çınlama (uyumsuz kısmi frekanslar). */
const metal = (r, f0, decay, dur = decay * 6, ratios = [1, 1.47, 2.09, 2.56, 3.39, 4.21]) => modal(dur, { f0, ratios, decays: decay, r });
/** Yavaş değişen yumuşak rastgele eğri (rüzgâr, alev titreşimi). */
function drift(r, rate, lo, hi) {
  const pts = [];
  for (let i = 0; i < 400; i++) pts.push(lo + r() * (hi - lo));
  return (t) => {
    const x = t * rate;
    const i = Math.floor(x);
    const f = x - i;
    const k = (1 - Math.cos(f * Math.PI)) / 2;
    return pts[i % 400] * (1 - k) + pts[(i + 1) % 400] * k;
  };
}
/** Pürüzsüz döngü: kuyruğu başa çapraz karıştırır. */
function loopify(x, overlapSec) {
  const O = samples(overlapSec);
  const L = x.length - O;
  const out = new Float32Array(L);
  for (let i = 0; i < L; i++) out[i] = x[i];
  for (let i = 0; i < O; i++) {
    const k = i / O;
    out[i] = x[i] * Math.sin((k * Math.PI) / 2) + x[L + i] * Math.cos((k * Math.PI) / 2);
  }
  return out;
}
const fin = (x, peak = 0.89) => finalize(x, { peak });
const finLoop = (x, peak = 0.8) => finalize(x, { peak, fadeIn: 0, fadeOut: 0, trim: false });

// Notalar
const NOTE = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760 };
function bell(r, f, dur, decay, { harm = [1, 2.01, 3.02], amps = [1, 0.35, 0.12], type = 'sine' } = {}) {
  const out = buf(dur);
  harm.forEach((h, k) => addInto(out, osc(dur, { type, freq: f * h, amp: perc(0.004, decay / (k + 1)) }), 0, amps[k]));
  return out;
}

// ===========================================================================
// ⚔️ VURUŞLAR
// ===========================================================================
def('vurusHafif', 'vurus', 'Hafif vuruş', { gain: 0.7, limit: 4 }, (r) =>
  fin(layers(0.25, [[thud(R(r, 230, 280), 110, 0.035)], [burst(r, 0.1, 'bp', R(r, 1400, 2000), 1.4, 0.018), 0, 0.7], [click(r), 0, 0.4]])),
);
def('vurusOrta', 'vurus', 'Orta vuruş (küt darbe)', { gain: 0.8 }, (r) =>
  fin(layers(0.35, [[drive(thud(R(r, 150, 180), 48, 0.07), 1.6)], [burst(r, 0.2, 'lp', 900, 0.8, 0.05), 0, 0.8], [click(r, 2500), 0, 0.35]])),
);
def('vurusAgir', 'vurus', 'Ağır vuruş', { gain: 0.9, priority: 1 }, (r) => {
  const x = layers(0.7, [
    [drive(thud(R(r, 120, 140), 38, 0.14), 2.5)],
    [mul(filter(noise(0.5, { color: 'brown', r }), 'lp', sweep(3000, 200, 0.3), 0.9), perc(0.002, 0.12)), 0, 0.9],
    [click(r, 2000, 0.003), 0, 0.5],
  ]);
  return fin(reverb(x, { size: 0.4, mix: 0.12, tail: 0.3 }));
});
def('kritikVurus', 'vurus', 'Kritik vuruş', { gain: 1, priority: 2 }, (r) => {
  const x = layers(1.0, [
    [whoosh(r, 0.09, 500, 2400, { peak: 0.8 }), 0, 0.5],
    [drive(thud(90, 34, 0.2), 3), 0.07],
    [mul(filter(noise(0.6, { color: 'brown', r }), 'lp', sweep(4000, 250, 0.35), 1), perc(0.002, 0.18)), 0.07, 0.9],
    [metal(r, R(r, 1700, 1950), 0.3), 0.07, 0.35],
    [burst(r, 0.2, 'hp', 5000, 0.7, 0.06), 0.07, 0.3],
  ]);
  return fin(reverb(x, { size: 0.55, mix: 0.18, tail: 0.5 }));
});
def('kilicVurus', 'vurus', 'Kılıç vuruşu', { gain: 0.85 }, (r) =>
  fin(
    layers(0.5, [
      [whoosh(r, 0.11, 900, 3200, { q: 1.5, peak: 0.75 }), 0, 0.55],
      [thud(R(r, 150, 175), 60, 0.06), 0.07],
      [burst(r, 0.15, 'lp', 1800, 0.8, 0.035), 0.07, 0.7],
      [metal(r, R(r, 2200, 2800), 0.13), 0.07, 0.22],
    ]),
  ),
);
def('hancerSaplanma', 'vurus', 'Hançer saplanması', { gain: 0.75, limit: 4 }, (r) =>
  fin(
    layers(0.3, [
      [click(r, 4000, 0.0012), 0, 0.6],
      [thud(R(r, 210, 240), 90, 0.045)],
      [burst(r, 0.12, 'bp', 1200, 3, 0.03), 0, 0.7],
      [metal(r, R(r, 4800, 5600), 0.04), 0, 0.15],
    ]),
  ),
);
def('okIsabet', 'vurus', 'Ok isabeti', { gain: 0.75, limit: 4 }, (r) =>
  fin(
    layers(0.3, [
      [burst(r, 0.1, 'bp', R(r, 1400, 1800), 1.5, 0.022), 0, 0.85],
      [osc(0.1, { freq: sweep(540, 470, 0.05), amp: perc(0.001, 0.028) }), 0, 0.45],
      [thud(R(r, 115, 130), 55, 0.065)],
    ]),
  ),
);
def('metalCarpma', 'vurus', 'Metal çarpma (kalkan)', { gain: 0.8 }, (r) => {
  const ratios = [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.16, 4.1];
  const x = layers(1.2, [
    [click(r, 2500, 0.002), 0, 0.7],
    [modal(1.1, { f0: R(r, 480, 620), ratios, decays: [0.7, 0.5, 0.45, 0.4, 0.3, 0.28, 0.22, 0.15], r }), 0, 0.8],
    [burst(r, 0.1, 'bp', 3200, 1, 0.02), 0, 0.5],
  ]);
  return fin(reverb(x, { size: 0.4, mix: 0.15, tail: 0.4 }));
});
def('buyuIsabet', 'vurus', 'Büyü isabeti', { gain: 0.7 }, (r) =>
  fin(
    layers(0.5, [
      [osc(0.15, { type: 'tri', freq: sweep(R(r, 1700, 2100), 380, 0.09), amp: perc(0.001, 0.05) }), 0, 0.7],
      [burst(r, 0.12, 'bp', 2600, 1.2, 0.035), 0, 0.6],
      [bell(r, NOTE.E6 * R(r, 0.97, 1.03), 0.4, 0.18), 0.03, 0.25],
      [thud(140, 70, 0.04), 0, 0.5],
    ]),
  ),
);

// ===========================================================================
// 🏹 OKÇU
// ===========================================================================
def('yayGerme', 'okcu', 'Yay germe (gıcırtı)', { gain: 0.5, rate: 0.04 }, (r) => {
  const d = 0.5;
  const cr = crackle(d, { density: [[0, 40], [d, 500]], r });
  const x = filter(cr, 'bp', R(r, 750, 1000), 10);
  addInto(x, mul(filter(noise(d, { r }), 'bp', 1600, 4), (t) => 0.04 * (t / d)), 0);
  return fin(mul(x, swell(d, 0.85, 1)));
});
def('okAtis', 'okcu', 'Ok bırakma (yay teli)', { gain: 0.7, limit: 4 }, (r) => {
  const tw = filter(pluck(0.4, { freq: R(r, 95, 125), decay: 0.991, brightness: 0.7, r }), 'lp', 2600, 0.9);
  return fin(
    layers(0.4, [
      [mul(tw, perc(0.001, 0.09))],
      [osc(0.15, { freq: sweep(210, 130, 0.08), amp: perc(0.001, 0.04) }), 0, 0.5],
      [whoosh(r, 0.1, 2800, 700, { peak: 0.2, q: 1 }), 0.005, 0.6],
      [click(r, 3000), 0, 0.5],
    ]),
  );
});
def('okUcus', 'okcu', 'Ok uçuşu (vızıltı)', { gain: 0.45, limit: 2 }, (r) => {
  const d = 0.35;
  const f = (t) => 1300 + 2200 * Math.sin(Math.PI * Math.min(1, t / d)) ** 2;
  return fin(mul(filter(noise(d, { r, color: 'pink' }), 'bp', f, 4), swell(d, 0.5, 2)));
});
def('okSaplanma', 'okcu', 'Ok yere saplanma', { gain: 0.6, limit: 3 }, (r) =>
  fin(
    layers(0.45, [
      [burst(r, 0.1, 'bp', R(r, 320, 400), 6, 0.035), 0, 0.9],
      [osc(0.12, { freq: sweep(270, 200, 0.05), amp: perc(0.001, 0.045) }), 0, 0.5],
      [burst(r, 0.15, 'lp', 900, 0.7, 0.05, 'pink'), 0, 0.5],
      [tremolo(osc(0.35, { freq: R(r, 150, 180), amp: perc(0.002, 0.09) }), 22, 0.8), 0.01, 0.18],
    ]),
  ),
);

// ===========================================================================
// ✨ BÜYÜ & EFEKT
// ===========================================================================
def('sarj', 'buyu', 'Enerji toplama (parlak)', { gain: 0.55, rate: 0.03, priority: 1 }, (r) => {
  const d = 1.0;
  const f = sweep(200, 800, 0.95);
  const env = (t) => (t < 0.95 ? Math.pow(t / 0.95, 1.5) : Math.max(0, 1 - (t - 0.95) / 0.05));
  const tone = layers(d, [[osc(d, { type: 'saw', freq: f })], [osc(d, { type: 'saw', freq: (t) => f(t) * 1.006 }), 0, 0.8], [osc(d, { freq: (t) => f(t) / 2 }), 0, 0.6]]);
  const x = mul(tremolo(filter(tone, 'lp', sweep(600, 6000, 0.95), 1.5), sweep(6, 26, d), 0.5), env);
  addInto(x, mul(whoosh(r, d, 500, 4500, { peak: 0.97 }), env), 0, 0.8);
  return fin(reverb(x, { size: 0.4, mix: 0.15, tail: 0.3 }));
});
def('olumSarj', 'buyu', 'Karanlık enerji toplama', { gain: 0.6, rate: 0.02, priority: 1 }, (r) => {
  const d = 1.0;
  const f = sweep(55, 110, 0.95);
  const env = (t) => (t < 0.93 ? Math.pow(t / 0.93, 1.3) : Math.max(0, 1 - (t - 0.93) / 0.07));
  const tone = layers(d, [[osc(d, { type: 'saw', freq: f })], [osc(d, { type: 'saw', freq: (t) => f(t) * 1.012 })], [osc(d, { type: 'square', freq: (t) => f(t) * 1.5, pw: 0.3 }), 0, 0.3]]);
  const x = mul(drive(tremolo(filter(tone, 'lp', sweep(300, 2400, 0.95), 3), sweep(4, 18, d), 0.6), 1.8), env);
  addInto(x, mul(tremolo(filter(noise(d, { r }), 'bp', sweep(700, 1600, d), 3), 9, 0.7), env), 0, 0.5);
  return fin(reverb(x, { size: 0.7, mix: 0.25, tail: 0.6 }));
});
def('patlama', 'buyu', 'Patlama', { gain: 1, rate: 0.08, priority: 2, limit: 2 }, (r) => {
  const x = layers(1.6, [
    [drive(thud(70, 28, 0.35, 1.6), 3)],
    [mul(filter(noise(1.5, { color: 'brown', r }), 'lp', sweep(5000, 150, 0.8), 0.8), perc(0.003, 0.5)), 0, 1],
    [filter(crackle(1.2, { density: (t) => 900 * Math.exp(-t / 0.3), amp: perc(0.001, 0.4), r }), 'bp', 2200, 1), 0.02, 0.8],
  ]);
  return fin(reverb(x, { size: 0.85, mix: 0.25, tail: 0.8 }));
});
def('sokDalgasi', 'buyu', 'Şok dalgası', { gain: 0.75, priority: 1 }, (r) => {
  const x = layers(0.8, [[thud(120, 40, 0.12)], [mul(filter(noise(0.75, { r, color: 'pink' }), 'bp', sweep(250, 3000, 0.5), 0.9), swell(0.75, 0.12, 1.4)), 0, 0.9]]);
  return fin(reverb(x, { size: 0.5, mix: 0.15, tail: 0.4 }));
});
def('buyuParilti', 'buyu', 'Büyü parıltısı', { gain: 0.5, rate: 0.03 }, (r) => {
  const scale = [NOTE.E6, NOTE.G6, NOTE.A6, NOTE.D6, NOTE.C6 * 2, NOTE.A6 * 1.5];
  const x = buf(0.9);
  for (let k = 0; k < 7; k++) addInto(x, bell(r, scale[Math.floor(r() * scale.length)], 0.4, R(r, 0.08, 0.2)), R(r, 0, 0.45), R(r, 0.4, 0.8));
  addInto(x, mul(filter(noise(0.6, { r }), 'hp', 7000, 0.7), swell(0.6, 0.3)), 0, 0.12);
  return fin(reverb(x, { size: 0.6, mix: 0.3, tail: 0.5 }));
});
def('runAktif', 'buyu', 'Rün aktivasyonu', { gain: 0.45, rate: 0.02 }, (r) => {
  const x = layers(1.1, [
    [bell(r, NOTE.A5, 1.1, 0.7), 0, 0.6],
    [bell(r, NOTE.E6, 1.1, 0.6), 0.03, 0.45],
    [bell(r, NOTE.A6, 1.1, 0.5), 0.06, 0.3],
    [osc(1.1, { freq: 220, amp: swell(1.1, 0.25) }), 0, 0.3],
  ]);
  return fin(reverb(mul(tremolo(x, 7, 0.25), (t) => Math.min(1, t / 0.04)), { size: 0.7, mix: 0.35, tail: 0.6 }));
});
def('golgeGecis', 'buyu', 'Gölgeye dönüşme (ters fısıltı)', { gain: 0.7, priority: 1 }, (r) => {
  const d = 0.32;
  const swellIn = mul(filter(noise(d, { r, color: 'pink' }), 'lp', sweep(600, 2400, d), 1.2), (t) => Math.pow(t / d, 3));
  const x = layers(0.6, [[swellIn], [osc(0.5, { freq: sweep(240, 60, 0.4), amp: (t) => Math.pow(Math.min(1, t / d), 2) * Math.exp(-Math.max(0, t - d) / 0.06) }), 0, 0.6]]);
  return fin(echo(x, { time: 0.07, feedback: 0.4, mix: 0.25, repeats: 3 }));
});
def('golgeBelirme', 'buyu', 'Gölgeden belirme', { gain: 0.65 }, (r) =>
  fin(
    layers(0.45, [
      [osc(0.3, { freq: sweep(60, 190, 0.06), amp: perc(0.004, 0.07) })],
      [burst(r, 0.2, 'lp', 900, 1, 0.07, 'pink'), 0, 0.8],
      [reverse(mul(filter(noise(0.15, { r }), 'hp', 3000, 0.7), perc(0.001, 0.05))), 0, 0.3],
    ]),
  ),
);
def('dumanPuf', 'buyu', 'Duman bombası patlaması', { gain: 0.85, priority: 1 }, (r) =>
  fin(
    layers(1.8, [
      [mul(filter(noise(0.6, { r, color: 'pink' }), 'lp', sweep(3000, 500, 0.3), 1), perc(0.002, 0.16))],
      [thud(115, 60, 0.06), 0, 0.8],
      [mul(filter(noise(1.7, { r, color: 'pink' }), 'hp', 3500, 0.7), perc(0.08, 0.6)), 0.05, 0.35],
    ]),
  ),
);
def('fitil', 'buyu', 'Fitil cızırtısı', { gain: 0.4, rate: 0.03, limit: 2 }, (r) => {
  const d = 0.8;
  const x = mul(filter(noise(d, { r }), 'hp', 4200, 0.7), (t) => 0.5 + 0.5 * Math.sin(t * 90) ** 2);
  addInto(x, filter(crackle(d, { density: 300, r }), 'bp', 5500, 2), 0, 1.5);
  return fin(mul(x, swell(d, 0.15, 0.6)));
});
def('olumCani', 'buyu', 'Ölüm çanı', { gain: 0.8, rate: 0.02, priority: 2, limit: 1 }, (r) => {
  const ratios = [0.5, 1, 1.183, 1.506, 2, 2.514, 2.662, 3.011, 4.166];
  const x = layers(2.4, [
    [modal(2.3, { f0: R(r, 150, 168), ratios, decays: [2.0, 1.6, 1.2, 1.0, 0.8, 0.5, 0.45, 0.35, 0.25], amps: [0.8, 1, 0.6, 0.5, 0.45, 0.3, 0.3, 0.2, 0.15], r })],
    [burst(r, 0.05, 'bp', 2000, 1, 0.006), 0, 0.4],
    [osc(2.3, { freq: 55, amp: swell(2.3, 0.15) }), 0, 0.35],
  ]);
  return fin(reverb(x, { size: 0.9, mix: 0.35, tail: 1 }));
});
def('kesikFinal', 'buyu', 'Final kesiği', { gain: 1, priority: 2, limit: 1 }, (r) => {
  const x = layers(1.2, [
    [whoosh(r, 0.25, 300, 4200, { q: 0.9, peak: 0.75 }), 0, 0.9],
    [metal(r, R(r, 2400, 2800), 0.45), 0.13, 0.4],
    [drive(thud(75, 30, 0.22, 1), 2.5), 0.15],
    [mul(filter(noise(0.6, { r, color: 'brown' }), 'lp', sweep(3500, 300, 0.3), 1), perc(0.002, 0.16)), 0.15, 0.7],
  ]);
  return fin(reverb(x, { size: 0.6, mix: 0.2, tail: 0.5 }));
});

// ===========================================================================
// 💨 HAREKET
// ===========================================================================
def('savurma', 'hareket', 'Savurma (hızlı)', { gain: 0.55, limit: 4, rate: 0.1 }, (r) => fin(whoosh(r, R(r, 0.16, 0.22), R(r, 450, 600), R(r, 2500, 3200), { q: 1 })));
def('savurmaAgir', 'hareket', 'Savurma (ağır)', { gain: 0.65, rate: 0.08 }, (r) =>
  fin(layers(0.4, [[whoosh(r, 0.36, 240, 1400, { q: 0.8 })], [mul(filter(noise(0.36, { r, color: 'brown' }), 'lp', 300, 1), swell(0.36, 0.45)), 0, 0.6]])),
);
def('takla', 'hareket', 'Takla (dönme)', { gain: 0.55 }, (r) => {
  const d = 0.6;
  const f = (t) => 600 + 1500 * Math.sin((Math.PI * 2 * t) / d) ** 2;
  return fin(mul(filter(noise(d, { r, color: 'pink' }), 'bp', f, 1.4), (t) => swell(d, 0.5, 1)(t) * (0.35 + 0.65 * Math.sin((Math.PI * 2 * t) / d) ** 2)));
});
def('atilma', 'hareket', 'Atılma (dash)', { gain: 0.6 }, (r) =>
  fin(layers(0.3, [[whoosh(r, 0.24, 800, 5000, { q: 0.9, peak: 0.6 })], [osc(0.2, { freq: sweep(1200, 3200, 0.18), amp: swell(0.2, 0.6) }), 0, 0.08]])),
);
def('hancerFirlat', 'hareket', 'Hançer fırlatma', { gain: 0.55, limit: 3, rate: 0.1 }, (r) =>
  fin(layers(0.3, [[whoosh(r, 0.16, 1500, 4200, { q: 1.3, peak: 0.35 })], [metal(r, R(r, 5600, 6600), 0.05, 0.25, [1, 1.31, 1.72]), 0, 0.22]])),
);
def('ayakSesi', 'hareket', 'Ayak sesi (toprak)', { gain: 0.35, limit: 4, rate: 0.12 }, (r) =>
  fin(layers(0.2, [[burst(r, 0.15, 'lp', R(r, 700, 1000), 0.8, 0.03, 'pink')], [thud(R(r, 90, 110), 60, 0.025), 0, 0.6], [filter(crackle(0.08, { density: 600, amp: perc(0.001, 0.02), r }), 'bp', 2500, 1.5), 0.005, 0.5]])),
);
def('inis', 'hareket', 'Yere iniş', { gain: 0.55 }, (r) =>
  fin(layers(0.4, [[thud(130, 45, 0.07)], [burst(r, 0.3, 'lp', 1200, 0.8, 0.06, 'pink'), 0, 0.8], [filter(crackle(0.2, { density: 900, amp: perc(0.001, 0.05), r }), 'bp', 2200, 1.2), 0.005, 0.5]])),
);

// ===========================================================================
// 🔥 ATEŞ
// ===========================================================================
/** Alev "kükremesi": kahverengi gürültü + titreyen düşük geçiren. */
function roar(r, d, lo = 300, hi = 900) {
  return mul(filter(noise(d, { r, color: 'brown' }), 'lp', drift(r, 7, lo, hi), 0.9), drift(r, 11, 0.55, 1));
}
function fireCrackle(r, d, density = 25) {
  const pops = filter(crackle(d, { density, r }), 'bp', drift(r, 3, 1800, 4200), 2.5);
  const tiny = filter(crackle(d, { density: density * 8, amp: 0.25, r }), 'hp', 3000, 0.7);
  return layers(d, [[pops, 0, 2.2], [tiny, 0, 1]]);
}
def('atesTutusma', 'ates', 'Tutuşma (fwuuş)', { gain: 0.8, priority: 1 }, (r) => {
  const d = 1.1;
  const x = layers(d, [
    [mul(filter(noise(d, { r, color: 'pink' }), 'lp', sweep(250, 3500, 0.3), 1.1), swell(d, 0.22, 1.2)), 0, 1],
    [mul(roar(r, d, 200, 600), swell(d, 0.3, 1)), 0, 1.2],
    [mul(fireCrackle(r, d, 40), (t) => Math.min(1, t / 0.2) * Math.exp(-t / 0.6)), 0, 0.6],
  ]);
  return fin(x);
});
def('atesTopu', 'ates', 'Ateş topu (uçuş)', { gain: 0.75 }, (r) => {
  const d = 1.0;
  const x = layers(d, [
    [mul(tremolo(roar(r, d, 400, 1300), 17, 0.35), swell(d, 0.35, 1)), 0, 1.2],
    [whoosh(r, d, 400, 2200, { q: 0.8, peak: 0.6 }), 0, 0.7],
    [mul(fireCrackle(r, d, 50), swell(d, 0.5, 1)), 0, 0.5],
  ]);
  return fin(x);
});
def('atesPatlama', 'ates', 'Ateş patlaması', { gain: 1, priority: 2, limit: 2 }, (r) => {
  const x = layers(2.0, [
    [drive(thud(80, 30, 0.3, 1.5), 3)],
    [mul(filter(noise(1.8, { color: 'brown', r }), 'lp', sweep(6000, 300, 0.6), 0.8), perc(0.003, 0.45)), 0, 1],
    [mul(roar(r, 1.9, 300, 1000), (t) => Math.min(1, t / 0.05) * Math.exp(-t / 0.7)), 0, 1.3],
    [mul(fireCrackle(r, 1.9, 70), (t) => Math.exp(-t / 0.6)), 0.03, 0.7],
  ]);
  return fin(reverb(x, { size: 0.8, mix: 0.2, tail: 0.6 }));
});
def('yanma', 'ates', 'Yanma (döngü)', { gain: 0.5, loop: true, rate: 0, limit: 1 }, (r) => {
  const d = 3.4;
  const x = layers(d, [[roar(r, d, 250, 700), 0, 1.4], [fireCrackle(r, d, 22), 0, 0.7], [mul(filter(noise(d, { r }), 'hp', 5000, 0.7), drift(r, 2, 0.02, 0.08)), 0, 1]]);
  return finLoop(loopify(x, 0.4));
});
def('yanmaHasar', 'ates', 'Yanma hasarı (cız)', { gain: 0.55, limit: 3 }, (r) =>
  fin(layers(0.45, [[mul(filter(noise(0.45, { r }), 'hp', 3000, 0.8), perc(0.005, 0.12)), 0, 0.8], [mul(fireCrackle(r, 0.45, 120), perc(0.001, 0.15)), 0, 0.8], [thud(170, 90, 0.03), 0, 0.3]])),
);
def('sonme', 'ates', 'Sönme (tıss)', { gain: 0.55 }, (r) =>
  fin(layers(1.2, [[mul(filter(noise(1.2, { r, color: 'pink' }), 'hp', sweep(1500, 4500, 1), 0.8), perc(0.02, 0.35))], [mul(fireCrackle(r, 0.6, 30), (t) => Math.exp(-t / 0.15)), 0, 0.4]])),
);

// ===========================================================================
// ⛈️ FIRTINA
// ===========================================================================
function rumble(r, d, peaks) {
  const env = (t) => peaks.reduce((s, [at, a, w]) => s + a * Math.exp(-(((t - at) / w) ** 2)), 0);
  return mul(filter(noise(d, { r, color: 'brown' }), 'lp', drift(r, 4, 120, 380), 0.8), env);
}
def('simsek', 'firtina', 'Şimşek (yakın)', { gain: 1, priority: 2, limit: 1, rate: 0.05 }, (r) => {
  const crack = drive(mul(filter(noise(0.05, { r }), 'hp', 900, 0.7), perc(0.0005, 0.01)), 4);
  const sizzle = mul(filter(crackle(0.5, { density: 4000, r }), 'hp', 2500, 0.7), perc(0.002, 0.12));
  const x = layers(3.2, [
    [crack, 0, 1],
    [sizzle, 0.005, 0.6],
    [drive(thud(70, 30, 0.4, 1.6), 2), 0.01, 0.9],
    [rumble(r, 3.1, [[0.1, 1, 0.25], [0.6, 0.7, 0.4], [1.3, 0.5, 0.5], [2.1, 0.3, 0.6]]), 0.02, 1.4],
  ]);
  return fin(reverb(x, { size: 0.95, mix: 0.3, tail: 1 }));
});
def('gokGurultusu', 'firtina', 'Gök gürültüsü (uzak)', { gain: 0.8, priority: 1, limit: 1, rate: 0.05 }, (r) => {
  const d = 4.5;
  const x = rumble(r, d, [[0.4, 0.6, 0.35], [1.0, 1, 0.5], [1.9, 0.7, 0.6], [2.9, 0.45, 0.7], [3.8, 0.2, 0.6]]);
  return fin(reverb(x, { size: 0.95, mix: 0.35, tail: 1 }));
});
function windBed(r, d) {
  const body = mul(filter(noise(d, { r, color: 'pink' }), 'bp', drift(r, 0.6, 300, 1100), 2.5), drift(r, 0.5, 0.3, 1));
  const whistle = mul(filter(noise(d, { r }), 'bp', drift(r, 0.4, 700, 1500), 18), drift(r, 0.35, 0, 1));
  return layers(d, [[body, 0, 1], [whistle, 0, 0.5]]);
}
function rainBed(r, d) {
  const bed = filter(filter(noise(d, { r }), 'hp', 900, 0.7), 'lp', 7500, 0.7);
  const drops = filter(crackle(d, { density: 900, amp: 0.6, r }), 'bp', drift(r, 5, 2500, 6000), 1.2);
  const near = filter(crackle(d, { density: 25, r }), 'bp', 1400, 4);
  return layers(d, [[bed, 0, 0.35], [drops, 0, 1.4], [near, 0, 1.5]]);
}
def('ruzgar', 'firtina', 'Rüzgâr (döngü)', { gain: 0.5, loop: true, rate: 0, limit: 1 }, (r) => finLoop(loopify(windBed(r, 6.5), 1.0)));
def('yagmur', 'firtina', 'Yağmur (döngü)', { gain: 0.45, loop: true, rate: 0, limit: 1 }, (r) => finLoop(loopify(rainBed(r, 4.5), 0.5)));
def('firtina', 'firtina', 'Fırtına ambiyansı (döngü)', { gain: 0.55, loop: true, rate: 0, limit: 1 }, (r) => {
  const d = 9;
  const x = layers(d, [[windBed(r, d), 0, 0.9], [rainBed(r, d), 0, 0.8], [rumble(r, 4, [[0.8, 0.8, 0.5], [1.7, 0.5, 0.6], [2.6, 0.25, 0.6]]), 3.5, 2.2]]);
  return finLoop(loopify(x, 1.0));
});

// ===========================================================================
// 👾 YARATIK (sevimli, çizgi film)
// ===========================================================================
def('yaratikAci', 'yaratik', 'Yaratık acı ciyaklaması', { gain: 0.5, limit: 2, rate: 0.12 }, (r) => {
  const p = R(r, 620, 760);
  const x = voice(0.2, { pitch: [[0, p], [0.04, p * 1.15], [0.2, p * 0.7]], formants: [[800, 6, 1], [1300, 8, 0.7], [2700, 10, 0.3]], vibrato: 0.02, r });
  return fin(mul(x, perc(0.008, 0.07)));
});
def('yaratikSaldiri', 'yaratik', 'Yaratık hırlaması', { gain: 0.55, limit: 2, rate: 0.1 }, (r) => {
  const d = 0.35;
  const p = R(r, 150, 190);
  const x = voice(d, { pitch: [[0, p], [d, p * 0.8]], formants: [[600, 4, 1], [1000, 5, 0.6], [2400, 8, 0.2]], vibrato: 0.06, vibratoRate: 32, breath: 0.4, r });
  return fin(drive(mul(x, swell(d, 0.25, 1)), 2));
});
def('yaratikOlum', 'yaratik', 'Yaratık ölümü', { gain: 0.7, limit: 2 }, (r) => {
  const p = R(r, 600, 700);
  const sq = voice(0.55, {
    pitch: sweep(p, 130, 0.5),
    formants: [[(t) => 750 - 400 * Math.min(1, t / 0.5), 6, 1], [(t) => 1250 - 500 * Math.min(1, t / 0.5), 8, 0.6], [2500, 10, 0.25]],
    vibrato: 0.03,
    r,
  });
  return fin(
    layers(1.0, [
      [mul(sq, perc(0.01, 0.2)), 0, 0.8],
      [mul(filter(noise(0.4, { r, color: 'pink' }), 'lp', sweep(2500, 500, 0.2), 1), perc(0.002, 0.1)), 0.3, 0.9],
      [bell(r, NOTE.E6, 0.4, 0.15), 0.34, 0.2],
      [bell(r, NOTE.B5 * 2, 0.4, 0.12), 0.42, 0.15],
    ]),
  );
});
def('yaratikDogus', 'yaratik', 'Yaratık doğuşu', { gain: 0.5 }, (r) =>
  fin(
    layers(0.7, [
      [reverse(mul(filter(noise(0.3, { r, color: 'pink' }), 'bp', 1500, 1.2), perc(0.001, 0.12))), 0, 0.7],
      [osc(0.25, { freq: sweep(200, 600, 0.08), amp: perc(0.004, 0.06) }), 0.28, 0.7],
      [bell(r, NOTE.A5, 0.4, 0.2), 0.3, 0.3],
    ]),
  ),
);

// ===========================================================================
// 🗣️ KAHRAMAN SESLERİ ("ah", "uh", "hah!"...) — kalın ve ince ses
// Formant sentezi: gerçek insan sesi değil, sevimli/çizgi film tınısı.
// ===========================================================================
const VOWELS = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [300, 2200, 2950],
  o: [570, 840, 2410],
  u: [320, 870, 2240],
  ı: [400, 1450, 2450],
  m: [260, 1000, 2200],
};
/**
 * Bir hece: v1 -> v2 sesli geçişi, perde eğrisi, "h" nefesi, nefesli bitiş.
 * pitch: göreli eğri (taban perdeye oranlar) [[t, oran], ...]
 */
function syllable(r, base, fScale, { d, v1, v2 = v1, pitch, h = 0, breathEnd = 0, nasal = false, tense = 0 }) {
  const A = VOWELS[v1];
  const B = VOWELS[v2];
  const m = (t) => Math.min(1, Math.max(0, (t - h) / Math.max(0.01, d - h)));
  const fq = (k) => (t) => (A[k] + (B[k] - A[k]) * m(t)) * fScale;
  const pc = param(pitch.map(([t, v]) => [t, v * base]));
  const jit = drift(r, 25, 0.985, 1.015); // perde titreşimi (jitter) doğal dursun
  const pf = (t) => pc(t) * jit(t);
  const src = filter(osc(d, { type: 'saw', freq: pf }), 'lp', 3800 * fScale, 0.7);
  const voicedEnv = (t) => Math.min(1, Math.max(0, (t - h * 0.8) / 0.025)) * Math.min(1, (d - t) / 0.06);
  mul(src, voicedEnv);
  const br = mul(noise(d, { r, color: 'pink' }), (t) => (t < h ? 0.9 * Math.min(1, t / 0.01) : 0) + breathEnd * Math.max(0, (t - (d - 0.12)) / 0.12) + 0.04);
  addInto(src, br, 0, 1.2);
  const out = buf(d);
  const qs = nasal ? [4, 10, 12] : [5, 8, 10];
  const gs = nasal ? [1, 0.12, 0.05] : [1, 0.65, 0.35];
  for (let k = 0; k < 3; k++) addInto(out, filter(src, 'bp', fq(k), qs[k]), 0, gs[k]);
  addInto(out, filter(src, 'lp', 500, 0.7), 0, nasal ? 0.4 : 0.12);
  return tense ? drive(out, 1 + tense * 3) : out;
}
function fricative(r, d, f, q = 0.8) {
  return mul(filter(noise(d, { r }), 'hp', f, q), (t) => Math.min(1, t / 0.02) * Math.min(1, (d - t) / 0.04));
}

const EMOTES = {
  ah: { name: 'Ah! (acı)', make: (r, b, s) => syllable(r, b, s, { d: 0.36, v1: 'a', h: 0.035, pitch: [[0, 1.35], [0.07, 1.65], [0.36, 1.0]], breathEnd: 0.3, tense: 0.2 }) },
  uh: { name: 'Uh (darbe alma)', make: (r, b, s) => syllable(r, b, s, { d: 0.2, v1: 'u', v2: 'ı', pitch: [[0, 1.15], [0.2, 0.85]], tense: 0.3 }) },
  hah: { name: 'Hah! (saldırı)', make: (r, b, s) => syllable(r, b, s, { d: 0.24, v1: 'a', h: 0.05, pitch: [[0, 1.45], [0.24, 1.2]], tense: 0.6 }) },
  hiya: {
    name: 'Hi-yaa! (büyük saldırı)',
    make: (r, b, s) => layers(0.55, [[syllable(r, b, s, { d: 0.13, v1: 'i', h: 0.04, pitch: [[0, 1.5], [0.13, 1.55]], tense: 0.5 })], [syllable(r, b, s, { d: 0.38, v1: 'i', v2: 'a', pitch: [[0, 1.75], [0.12, 1.85], [0.38, 1.3]], tense: 0.7 }), 0.15]]),
  },
  hup: { name: 'Hup! (zıplama)', make: (r, b, s) => syllable(r, b, s, { d: 0.13, v1: 'u', h: 0.035, pitch: [[0, 1.4], [0.13, 1.55]], tense: 0.3 }) },
  of: { name: 'Off (yorgun)', make: (r, b, s) => layers(0.55, [[syllable(r, b, s, { d: 0.38, v1: 'o', pitch: [[0, 1.1], [0.38, 0.8]] })], [fricative(r, 0.15, 2600), 0.33, 0.35]]) },
  olum: { name: 'Aaahh… (ölüm)', make: (r, b, s) => syllable(r, b, s, { d: 0.95, v1: 'a', v2: 'o', h: 0.03, pitch: [[0, 1.5], [0.15, 1.55], [0.95, 0.6]], breathEnd: 0.6, tense: 0.15 }) },
  haha: {
    name: 'Ha-ha! (gülme)',
    make: (r, b, s) => {
      const out = buf(0.7);
      [1.55, 1.5, 1.45, 1.3].forEach((p, i) => addInto(out, syllable(r, b, s, { d: 0.12, v1: 'a', h: 0.035, pitch: [[0, p], [0.12, p * 0.95]] }), i * 0.15));
      return out;
    },
  },
  yasasin: { name: 'Yeey! (sevinç)', make: (r, b, s) => syllable(r, b, s, { d: 0.5, v1: 'e', v2: 'i', pitch: [[0, 1.3], [0.25, 1.95], [0.5, 2.0]], tense: 0.3 }) },
  hmm: { name: 'Hmm (düşünme)', make: (r, b, s) => syllable(r, b, s, { d: 0.6, v1: 'm', nasal: true, pitch: [[0, 1.05], [0.3, 0.95], [0.6, 1.08]] }) },
  ooh: { name: 'Ooh! (şaşkınlık)', make: (r, b, s) => syllable(r, b, s, { d: 0.55, v1: 'o', v2: 'u', pitch: [[0, 1.15], [0.25, 1.65], [0.55, 1.3]] }) },
};
const VOICES = { Kalin: { base: [115, 135], f: 1.0, label: 'kalın' }, Ince: { base: [210, 250], f: 1.18, label: 'ince' } };
for (const [key, e] of Object.entries(EMOTES)) {
  for (const [vk, v] of Object.entries(VOICES)) {
    def(`${key}${vk}`, 'kahraman', `${e.name} — ${v.label} ses`, { gain: 0.55, limit: 2, rate: 0.04 }, (r) =>
      fin(e.make(r, R(r, v.base[0], v.base[1]), v.f * R(r, 0.97, 1.03))),
    );
  }
}

// ===========================================================================
// 🪙 ÖDÜL & ARAYÜZ
// ===========================================================================
def('altin', 'arayuz', 'Altın toplama', { gain: 0.45, rate: 0.02, limit: 3 }, (r) =>
  fin(layers(0.45, [[bell(r, NOTE.B5, 0.08, 0.05, { type: 'square', amps: [0.5, 0.2, 0.1] })], [bell(r, NOTE.E6, 0.4, 0.22, { type: 'square', amps: [0.5, 0.2, 0.1] }), 0.07]])),
);
def('altinlar', 'arayuz', 'Altın şıngırtısı', { gain: 0.45, limit: 2 }, (r) => {
  const x = buf(0.9);
  for (let k = 0; k < 7; k++) addInto(x, modal(0.3, { f0: R(r, 2600, 4200), ratios: [1, 2.7, 5.1], decays: [R(r, 0.05, 0.12), 0.04, 0.02], r }), R(r, 0, 0.5), R(r, 0.5, 1));
  return fin(x);
});
def('seviyeAtla', 'arayuz', 'Seviye atlama', { gain: 0.6, rate: 0, priority: 3, limit: 1 }, (r) => {
  const x = buf(1.9);
  [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => addInto(x, bell(r, f, 0.6, 0.35, { type: 'tri' }), i * 0.09, 0.7));
  [NOTE.C6, NOTE.E6, NOTE.G6].forEach((f) => addInto(x, tremolo(bell(r, f, 1.4, 0.9), 6, 0.3), 0.4, 0.45));
  for (let k = 0; k < 6; k++) addInto(x, bell(r, NOTE.C6 * 2 * (1 + r()), 0.3, 0.1), 0.4 + r() * 0.6, 0.15);
  return fin(reverb(x, { size: 0.6, mix: 0.3, tail: 0.6 }));
});
def('gorevTamam', 'arayuz', 'Görev tamamlandı', { gain: 0.6, rate: 0, priority: 3, limit: 1 }, (r) => {
  const x = buf(1.4);
  [[NOTE.G5, 0], [NOTE.C6, 0.12], [NOTE.E6, 0.24], [NOTE.G6, 0.36]].forEach(([f, at]) => addInto(x, bell(r, f, 0.8, at < 0.3 ? 0.18 : 0.6, { type: 'square', amps: [0.35, 0.12, 0.05] }), at));
  addInto(x, bell(r, NOTE.C6, 1, 0.7), 0.36, 0.4);
  return fin(reverb(x, { size: 0.5, mix: 0.25, tail: 0.5 }));
});
def('odul', 'arayuz', 'Ödül / sandık', { gain: 0.6, rate: 0, priority: 3, limit: 1 }, (r) => {
  const x = layers(1.5, [
    [whoosh(r, 0.4, 400, 3500, { peak: 0.9 }), 0, 0.4],
    [bell(r, NOTE.G5, 1.1, 0.8), 0.38, 0.5],
    [bell(r, NOTE.B5, 1.1, 0.8), 0.38, 0.4],
    [bell(r, NOTE.D6, 1.1, 0.8), 0.38, 0.35],
  ]);
  for (let k = 0; k < 8; k++) addInto(x, bell(r, NOTE.D6 * 2 * (1 + r() * 0.8), 0.3, 0.1), 0.38 + r() * 0.7, 0.15);
  return fin(reverb(x, { size: 0.6, mix: 0.3, tail: 0.6 }));
});
def('buton', 'arayuz', 'Buton tık', { gain: 0.35, rate: 0.02, limit: 2 }, (r) => fin(layers(0.06, [[osc(0.05, { freq: 1500, amp: perc(0.0005, 0.008) })], [click(r, 3000, 0.001), 0, 0.5]])));
def('hata', 'arayuz', 'Hata / olmaz', { gain: 0.4, rate: 0, limit: 1 }, (r) => {
  const beep = (f) => filter(osc(0.11, { type: 'square', freq: f, amp: (t) => Math.min(1, t / 0.005) * Math.min(1, (0.11 - t) / 0.01) }), 'lp', 1800, 0.7);
  return fin(layers(0.3, [[beep(196)], [beep(165), 0.14]]));
});

/** Ses id'lerini kategoriye göre gruplar. */
export function byCategory() {
  const out = {};
  for (const s of Object.values(SOUNDS)) (out[s.category] ||= []).push(s);
  return out;
}

export { SR };

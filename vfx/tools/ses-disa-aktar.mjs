#!/usr/bin/env node
// Tüm sesleri WAV dosyası olarak dışa aktarır (başka motorlarda / ses
// editöründe kullanmak, dinleyip değerlendirmek için).
//
//   node tools/ses-disa-aktar.mjs [çıkış klasörü] [--varyasyon=3]
//
// Ayrıca 8 yeteneğin oyundaki zaman çizelgesiyle birebir aynı "tam yetenek"
// seslerini üretir (yetenek-*.wav). Bunun için `three` kurulu olmalı
// (vfx klasöründe `npm install three`); yoksa bu kısım atlanır.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUNDS, CATEGORIES } from '../src/audio/sounds.js';
import { rng, encodeWav, addInto, finalize, SR, samples } from '../src/audio/dsp.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? join(here, '..', 'sesler');
const variants = Number((args.find((a) => a.startsWith('--varyasyon=')) ?? '--varyasyon=1').split('=')[1]);
mkdirSync(outDir, { recursive: true });

const rendered = {};
const index = [];
for (const s of Object.values(SOUNDS)) {
  for (let v = 0; v < (s.loop ? 1 : variants); v++) {
    const x = s.render(rng(1000 + v * 7919));
    if (v === 0) rendered[s.id] = x;
    const file = v === 0 ? `${s.id}.wav` : `${s.id}_${v + 1}.wav`;
    writeFileSync(join(outDir, file), Buffer.from(encodeWav(x)));
  }
  index.push(`| \`${s.id}\` | ${CATEGORIES[s.category]} | ${s.name} | ${(rendered[s.id].length / SR).toFixed(2)} sn${s.loop ? ' · döngü' : ''} |`);
}
console.log(`${Object.keys(SOUNDS).length} ses yazıldı -> ${outDir}`);

// ---------------------------------------------------------------------------
// Tam yetenek sesleri: yetenek kodunu sahte bir VFX nesnesiyle çalıştırıp
// vfx.sound() çağrılarını kaydeder, sonra aynı zamanlamayla miksler.
// ---------------------------------------------------------------------------
let skills = null;
try {
  skills = (await import('../src/skills/index.js')).SKILLS;
} catch (e) {
  console.log('`three` bulunamadı, yetenek sesleri atlandı (npm install three).');
}
if (skills) {
  const SKILL_IDS = ['seriAtis', 'taklaAtis', 'okYagmuru', 'olumAtisi', 'golgeAdimi', 'hancerYelpazesi', 'dumanBombasi', 'binKesik'];
  for (const id of SKILL_IDS) {
    const events = [];
    const noop = () => {};
    const base = {
      unit: 1,
      quality: 1,
      time: 0,
      timeScale: 1,
      particles: { emit: noop },
      n: (c) => c,
      isVisible: () => true,
      isVisibleSegment: () => true,
      shoot: (kind, a, b, o = {}) => (o.delay ?? 0) + (o.duration ?? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / (o.speed ?? 25)),
      pathPoint: (a, b, arc, u, out) => {
        out.x = a.x + (b.x - a.x) * u;
        out.y = a.y + (b.y - a.y) * u + arc * 4 * u * (1 - u);
        out.z = a.z + (b.z - a.z) * u;
        return out;
      },
      sound: (sid, pos, delay = 0, opts = {}) => events.push({ sid, delay, gain: opts?.gain ?? 1 }),
    };
    const mock = new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop) });
    skills[id].fn(mock, { from: { x: 0, y: 0, z: 6 }, target: { x: 0, y: 0, z: -2 }, voice: id === 'binKesik' || id === 'olumAtisi' ? 'Kalin' : undefined });

    // oyundaki gibi: aynı ses 35 ms içinde en fazla `limit` kez
    events.sort((a, b) => a.delay - b.delay);
    const kept = [];
    for (const e of events) {
      const lim = SOUNDS[e.sid]?.limit ?? 3;
      if (kept.filter((k) => k.sid === e.sid && Math.abs(k.delay - e.delay) < 0.035).length < lim) kept.push(e);
    }
    let len = 0;
    const parts = kept.map((e, i) => {
      const x = SOUNDS[e.sid].render(rng(5000 + i * 31));
      len = Math.max(len, e.delay + x.length / SR);
      return [x, e];
    });
    const mix = new Float32Array(samples(len + 0.1));
    for (const [x, e] of parts) addInto(mix, x, e.delay, SOUNDS[e.sid].gain * e.gain);
    writeFileSync(join(outDir, `yetenek-${id}.wav`), Buffer.from(encodeWav(finalize(mix, { peak: 0.9 }))));
  }
  console.log('8 yetenek sesi yazıldı (yetenek-*.wav)');
}

writeFileSync(
  join(outDir, 'LISTE.md'),
  `# Ses listesi\n\nHepsi 44.1 kHz, 16 bit, mono WAV. Kod: \`src/audio/sounds.js\`.\n\n| id | kategori | ad | süre |\n|---|---|---|---|\n${index.join('\n')}\n`,
);

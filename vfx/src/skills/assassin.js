import * as THREE from 'three';
import { SHAPE } from '../pools/ParticlePool.js';
import { DECAL } from '../pools/DecalPool.js';
import { UP, v3, flatDir, rightOf, yawQuat, face, handPos, finish, theme, impact, dustRing, rnd, DEBRIS } from './common.js';

// ===========================================================================
// SUİKASTÇI YETENEKLERİ: 👤 Gölge Adımı · 🔪 Hançer Yelpazesi · 💨 Duman Bombası · ⚔️ Bin Kesik
// Opsiyonlar okçu yetenekleriyle aynı (bkz. archer.js başlığı).
// ===========================================================================

const SHADOW = theme(0xb58cff, 0x5a1fd1);
const STEEL = theme(0x9ffcff, 0x18b5c9);
const POP = theme(0xfff6d8, 0xb79cff);
const BLADE = theme(0xe6f6ff, 0x5fb4ff);

const SHADOW_SMOKE = {
  shape: SHAPE.SMOKE,
  life: [0.55, 0.9],
  size: [0.55, 0.85],
  grow: 1.9,
  color: 0x2e1a4a,
  alpha: 0.85,
  colorEnd: 0x120820,
  alphaEnd: 0,
  drag: 3.2,
  gravity: -1.4,
  spin: [-1.5, 1.5],
  additive: 0,
};
const SMOKE_BIG = {
  shape: SHAPE.SMOKE,
  life: [2.4, 3.2],
  size: [1.5, 2.2],
  grow: 1.6,
  color: 0xd9d4e8,
  alpha: 0.8,
  colorEnd: 0x9a93b0,
  alphaEnd: 0,
  drag: 2.4,
  gravity: -0.25,
  spin: [-0.4, 0.4],
  additive: 0,
};
const FUSE = { shape: SHAPE.SPARK, life: [0.18, 0.3], size: [0.07, 0.1], grow: 0.3, color: 0xffe7a0, colorEnd: 0xff6a00, alphaEnd: 0, drag: 2, gravity: 6, stretch: 0.04 };
const FUSE_GLOW = { shape: SHAPE.GLOW, life: 0.12, size: 0.45, grow: 0.5, color: 0xffd27a, alpha: 0.9, colorEnd: 0xff6a00, alphaEnd: 0 };
const GLITTER = { shape: SHAPE.STAR, life: [0.5, 0.9], size: [0.2, 0.32], grow: 0.1, color: 0xf0e6ff, colorEnd: 0x9a7bff, alphaEnd: 0, gravity: -0.4, spin: [-2, 2] };
const CUT_COLORS = [0xffffff, 0xd6f0ff, 0x9fd8ff, 0xc8b8ff];

// ---------------------------------------------------------------------------
// 👤 GÖLGE ADIMI — gölgeye dönüşüp hedefin arkasında belirir, sırtından vurur
// ---------------------------------------------------------------------------
export function golgeAdimi(vfx, o) {
  const U = vfx.unit;
  const from = v3(o.from);
  const target = v3(o.target);
  const dir = flatDir(from, target);
  const behind = target.clone().addScaledVector(dir, (o.behind ?? 1.4) * U);
  const hitP = v3(target).addScaledVector(UP, 0.85 * U);
  const tGone = 0.04;
  const tArrive = 0.2;
  const tStab = 0.3;
  face(o, dir);

  const caster = o.caster;
  if (caster) {
    const qFace = yawQuat(dir.clone().negate());
    vfx.ghost(caster, { color: 0x5a2bb0, opacity: 0.6, duration: 0.5 });
    for (let i = 1; i <= 2; i++) {
      vfx.ghost(caster, {
        color: 0x7a4cff,
        opacity: 0.35,
        additive: true,
        duration: 0.35,
        delay: 0.04 + i * 0.05,
        position: from.clone().lerp(behind, i / 3),
        quaternion: yawQuat(dir),
      });
    }
    vfx.after(tGone, () => (caster.visible = false));
    vfx.after(tArrive, () => {
      caster.position.copy(behind);
      caster.quaternion.copy(qFace);
      caster.visible = true;
    });
  }

  const fx = vfx.isVisibleSegment(from, behind, 3 * U);
  if (fx) {
    const chestA = v3(from).addScaledVector(UP, 0.8 * U);
    const chestB = behind.clone().addScaledVector(UP, 0.8 * U);
    vfx.sound('golgeGecis', from, 0);
    vfx.sound('golgeBelirme', behind, tArrive);
    vfx.sound('savurma', target, tStab - 0.05);
    vfx.sound('hancerSaplanma', target, tStab + 0.04, { gain: 1.2 });
    // çıkış
    vfx.decal(DECAL.VORTEX, from, { r0: 1.3, r1: 1.6, duration: 0.7, color: 0x7a3cff });
    vfx.burst(SHADOW_SMOKE, chestA, vfx.n(14), { speed: [1, 3], radius: 0.4, up: 0.6 });
    vfx.burst(SHADOW.spark, chestA, vfx.n(10), { speed: [3, 6], up: 1 });
    vfx.burst(SHADOW.glow, chestA, 1, { sizeMul: 1.4 });
    // gölge çizgisi
    for (const h of [0.35, 0.9, 1.45]) {
      const a = v3(from).addScaledVector(UP, h * U);
      const b = behind.clone().addScaledVector(UP, h * U);
      vfx.trail(a, b, { delay: 0.03, duration: tArrive - 0.03, length: 0.14, width: 0.75, color: 0x140a24, intensity: 0.9, additive: 0 });
      vfx.trail(a, b, { delay: 0.03, duration: tArrive - 0.03, length: 0.1, width: 0.25, color: SHADOW.core, intensity: 1.3 });
    }
    vfx.line(SHADOW.mote, chestA, chestB, vfx.n(14), { t0: 0.03, t1: tArrive, radius: 0.5, speed: [0.3, 1] });
    // varış
    vfx.decal(DECAL.VORTEX, behind, { r0: 1.0, r1: 1.5, duration: 0.6, color: 0x7a3cff, delay: tArrive });
    vfx.burst(SHADOW_SMOKE, chestB, vfx.n(10), { speed: [1, 2.5], radius: 0.3, up: 0.6, delay: tArrive });
    vfx.burst(SHADOW.ring, chestB, 1, { delay: tArrive, sizeMul: 1.2 });
    vfx.burst(SHADOW.glow, chestB, 1, { delay: tArrive, sizeMul: 1.2 });
    // sırttan kesik
    const back = dir.clone().negate();
    const n = UP.clone().applyAxisAngle(back, 0.9);
    vfx.slash(hitP, { normal: n, toward: back, radius: 1.15, arc: 2.6, width: 0.55, delay: tStab, duration: 0.24, color: 0x1b0d30, additive: 0 });
    vfx.slash(hitP, { normal: n, toward: back, radius: 1.2, arc: 2.6, width: 0.22, delay: tStab, duration: 0.24, color: SHADOW.core, intensity: 1.4 });
    impact(vfx, hitP, target, SHADOW, { delay: tStab + 0.04, size: 0.9, dir: back });
  }
  return finish(vfx, o, { duration: tStab + 0.5, hits: [{ time: tStab + 0.04, position: hitP }], endPosition: behind });
}

// ---------------------------------------------------------------------------
// 🔪 HANÇER YELPAZESİ — yelpaze şeklinde dönen hançerler
// ---------------------------------------------------------------------------
export function hancerYelpazesi(vfx, o) {
  const U = vfx.unit;
  const from = v3(o.from);
  const target = v3(o.target);
  const dir = flatDir(from, target);
  const hand = handPos(vfx, from, dir, 1.0);
  const N = o.count ?? 9;
  const spread = o.spread ?? 1.25;
  const range = Math.max(from.distanceTo(target) + 1 * U, 6 * U);
  const speed = 24;
  face(o, dir);

  const fx = vfx.isVisible(from, range + 2 * U);
  if (fx) {
    vfx.slash(v3(from).addScaledVector(UP, 1.0 * U).addScaledVector(dir, 0.2 * U), {
      normal: UP,
      toward: dir,
      radius: 1.0,
      arc: 2.0,
      width: 0.3,
      duration: 0.16,
      color: STEEL.core,
    });
    vfx.burst(STEEL.glow, hand, 1, { sizeMul: 0.8 });
    vfx.sound('savurma', from, 0);
    for (let k = 0; k < 3; k++) vfx.sound('hancerFirlat', from, k * 0.025);
  }

  const hits = [];
  const mid = (N - 1) / 2;
  for (let j = 0; j < N; j++) {
    const ang = N > 1 ? (j / (N - 1) - 0.5) * spread : 0;
    const d = dir.clone().applyAxisAngle(UP, ang);
    const delay = Math.abs(j - mid) * 0.014;
    const end = hand.clone().addScaledVector(d, range);
    end.y = target.y + 0.75 * U;
    let t = delay + hand.distanceTo(end) / (speed * U);
    if (fx) {
      t = vfx.shoot('dagger', hand, end, {
        delay,
        speed,
        arc: 0.15,
        scale: 1.1,
        pitchSpin: 22,
        emissive: 0.3,
        tint: STEEL.core,
        trails: [{ width: 0.14, length: 0.07, color: STEEL.core, intensity: 1.1 }],
      });
      impact(vfx, end, null, STEEL, { delay: t, size: 0.5, dir: d });
      vfx.sound('hancerSaplanma', end, t, { gain: 0.7 });
    }
    hits.push({ time: t, position: end });
  }
  return finish(vfx, o, { duration: Math.max(...hits.map((h) => h.time)) + 0.3, hits });
}

// ---------------------------------------------------------------------------
// 💨 DUMAN BOMBASI — kavisle atılan bomba, patlama, dakikalarca değil saniyelerce süren bulut
// ---------------------------------------------------------------------------
export function dumanBombasi(vfx, o) {
  const U = vfx.unit;
  const from = v3(o.from);
  const target = v3(o.target);
  const dir = flatDir(from, target);
  const hand = handPos(vfx, from, dir, 1.1);
  const land = v3(target).addScaledVector(UP, 0.15 * U);
  const R = (o.radius ?? 3.5) * U;
  const linger = o.duration ?? 4.5;
  const flight = 0.6;
  const arc = 2.8;
  face(o, dir);

  const fx = vfx.isVisibleSegment(from, target, R + 2 * U);
  if (fx) {
    vfx.shoot('bomb', hand, land, { duration: flight, arc, scale: 1.6, pitchSpin: 9 });
    vfx.sound('savurma', from, 0, { gain: 0.8 });
    vfx.sound('fitil', from, 0.02);
    vfx.sound('dumanPuf', target, flight);
    const p = new THREE.Vector3();
    for (let k = 0; k <= 14; k++) {
      const kk = k / 14;
      vfx.pathPoint(hand, land, arc, kk, p).addScaledVector(UP, 0.25 * U);
      vfx.burst(FUSE, p, 3, { delay: kk * flight, speed: [1, 2.5], up: 1 });
      vfx.burst(FUSE_GLOW, p, 1, { delay: kk * flight });
    }

    // patlama
    vfx.burst(POP.glow, land, 1, { delay: flight, sizeMul: 3.2 });
    vfx.burst(POP.star, land, 3, { delay: flight, speed: [1, 3], sizeMul: 1.5 });
    vfx.burst(POP.spark, land, vfx.n(18), { delay: flight, speed: [4, 9], up: 2 });
    vfx.decal(DECAL.SHOCKWAVE, target, { r0: 0.3, r1: R / U + 1, duration: 0.5, color: 0xd8ccff, delay: flight });
    vfx.decal(DECAL.SOFT, target, { r0: (R / U) * 0.9, r1: (R / U) * 1.1, duration: linger + 0.8, color: 0x2a2633, alpha: 0.35, delay: flight });

    // bulut: ilk savrulma + yukarı kabaran katman + süreklilik
    vfx.burst(SMOKE_BIG, land, vfx.n(22), { delay: flight, flat: true, speed: [3, 8], radius: 0.4, up: 0.8 });
    vfx.burst(SMOKE_BIG, v3(land).addScaledVector(UP, 0.8 * U), vfx.n(10), { delay: flight + 0.05, speed: [1.5, 4], up: 1, sizeMul: 1.2 });
    const sustain = vfx.n(30);
    const q = new THREE.Vector3();
    for (let i = 0; i < sustain; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = R * 0.8 * Math.sqrt(Math.random());
      q.set(land.x + Math.cos(a) * r, land.y + rnd(0, 0.6) * U, land.z + Math.sin(a) * r);
      vfx.burst(SMOKE_BIG, q, 1, { delay: flight + 0.4 + (i / sustain) * Math.max(0.5, linger - 2.4), speed: [0.2, 0.6], up: 0.3 });
    }
    vfx.burst(GLITTER, v3(land).addScaledVector(UP, 1 * U), vfx.n(12), { delay: flight + 0.3, jitter: Math.max(0.5, linger - 1), radius: (R / U) * 0.8 });
  }
  return finish(vfx, o, {
    duration: flight + linger,
    hits: [{ time: flight, position: land }],
    area: { center: target, radius: R, start: flight, duration: linger },
  });
}

// ---------------------------------------------------------------------------
// ⚔️ BİN KESİK — hedefin etrafında ışınlanarak onlarca kesik + çapraz final
// ---------------------------------------------------------------------------
export function binKesik(vfx, o) {
  const U = vfx.unit;
  const from = v3(o.from);
  const target = v3(o.target);
  const dir = flatDir(from, target);
  const right = rightOf(dir);
  const center = v3(target).addScaledVector(UP, 0.9 * U);
  const dashEnd = target.clone().addScaledVector(dir, -1.3 * U);
  const N = o.count ?? 24;
  const dashT = 0.12;
  const start = 0.16;
  const span = o.span ?? 1.35;
  const finaleT = start + span + 0.12;
  face(o, dir);

  const caster = o.caster;
  if (caster) {
    vfx.ghost(caster, { color: 0x9fd8ff, opacity: 0.45, additive: true, duration: 0.35 });
    vfx.tween(dashT, (k) => caster.position.lerpVectors(from, dashEnd, k * k));
    const blinks = 6;
    for (let b = 0; b < blinks; b++) {
      vfx.after(start + (b * span) / blinks, () => {
        vfx.ghost(caster, { color: 0x9fd8ff, opacity: 0.4, additive: true, duration: 0.3 });
        const a = Math.random() * Math.PI * 2;
        caster.position.set(target.x + Math.cos(a) * 1.4 * U, target.y, target.z + Math.sin(a) * 1.4 * U);
        caster.quaternion.copy(yawQuat(flatDir(caster.position, target)));
      });
    }
    vfx.after(finaleT - 0.08, () => {
      vfx.ghost(caster, { color: 0x9fd8ff, opacity: 0.4, additive: true, duration: 0.3 });
      caster.position.copy(dashEnd);
      caster.quaternion.copy(yawQuat(dir));
    });
  }

  const hits = [];
  const fx = vfx.isVisibleSegment(from, target, 4 * U);
  const n = new THREE.Vector3();
  const c = new THREE.Vector3();
  const a = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const t = start + (i / N) * span + Math.random() * 0.03;
    const dur = rnd(0.14, 0.2);
    c.copy(center).add(a.randomDirection().multiplyScalar(0.3 * U));
    if (fx) {
      // rastgele düzlem ama yukarı (kameraya) doğru eğilimli: üstten bakınca kesikler net görünsün
      n.randomDirection().addScaledVector(UP, 1.1).normalize();
      vfx.slash(c, {
        normal: n,
        radius: rnd(1.1, 1.8),
        arc: rnd(2.4, 3.6),
        width: rnd(0.3, 0.5),
        delay: t,
        duration: dur,
        color: CUT_COLORS[i % CUT_COLORS.length],
        intensity: 1.5,
        growth: 0.3,
      });
      vfx.burst(BLADE.spark, c, vfx.n(5), { delay: t + dur * 0.35, speed: [3, 8] });
      vfx.sound('savurma', target, t, { gain: 0.7 });
      if (i % 2 === 0) vfx.sound('kilicVurus', target, t + dur * 0.35, { gain: 0.6 });
      vfx.burst(BLADE.glow, c, 1, { delay: t + dur * 0.3, sizeMul: 0.45 });
      if (i % 3 === 0) {
        a.randomDirection().multiplyScalar(1.8 * U);
        vfx.trail(c.clone().sub(a), c.clone().add(a), { delay: t, duration: 0.07, length: 0.07, width: 0.08, color: 0xffffff, intensity: 1.6 });
      }
    }
    hits.push({ time: t + dur * 0.35, position: c.clone() });
  }

  if (fx) {
    dustRing(vfx, dashEnd, { size: 0.6 });
    vfx.sound('atilma', from, 0);
    if (o.voice) vfx.sound(`hiya${o.voice}`, target, finaleT - 0.35, { gain: 0.8 });
    vfx.sound('kesikFinal', target, finaleT - 0.1);
    vfx.sound('sokDalgasi', target, finaleT + 0.05, { gain: 0.8 });
    vfx.trail(v3(from).addScaledVector(UP, 0.9 * U), v3(dashEnd).addScaledVector(UP, 0.9 * U), {
      duration: dashT,
      length: 0.1,
      width: 0.5,
      color: BLADE.edge,
      intensity: 1.2,
    });
    vfx.decal(DECAL.RUNE, target, { r0: 1.6, r1: 1.8, duration: finaleT, color: BLADE.edge, alpha: 0.6, spin: -4 });

    // final: çapraz X + yatay halka
    const nA = UP.clone().applyAxisAngle(dir, 0.75);
    const nB = UP.clone().applyAxisAngle(dir, -0.75);
    vfx.slash(center, { normal: nA, toward: right, radius: 2.2, arc: 2.7, width: 0.7, delay: finaleT, duration: 0.3, color: 0xffffff, intensity: 1.6 });
    vfx.slash(center, { normal: nB, toward: right.clone().negate(), radius: 2.2, arc: 2.7, width: 0.7, delay: finaleT + 0.04, duration: 0.3, color: BLADE.core, intensity: 1.6 });
    vfx.slash(v3(target).addScaledVector(UP, 0.5 * U), { normal: UP, radius: 2.6, arc: Math.PI * 1.9, width: 0.5, delay: finaleT + 0.06, duration: 0.36, color: BLADE.edge, intensity: 1.2 });
    vfx.burst(BLADE.glow, center, 1, { delay: finaleT, sizeMul: 3 });
    vfx.burst(BLADE.spark, center, vfx.n(30), { delay: finaleT, speed: [5, 12], up: 2 });
    vfx.burst(BLADE.star, center, vfx.n(5), { delay: finaleT, speed: [1, 3], sizeMul: 1.3 });
    vfx.burst(DEBRIS, target, vfx.n(8), { delay: finaleT, dir: UP, spread: 1.0, speed: [4, 7] });
    vfx.decal(DECAL.SHOCKWAVE, target, { r0: 0.5, r1: 5, duration: 0.5, color: BLADE.edge, alpha: 0.8, delay: finaleT });
    dustRing(vfx, target, { size: 1.3, delay: finaleT });
  }
  if (o.shake) vfx.after(finaleT, () => vfx.shake(0.4, 0.3));
  hits.push({ time: finaleT + 0.05, position: center.clone(), final: true });
  return finish(vfx, o, { duration: finaleT + 0.6, hits, endPosition: dashEnd });
}

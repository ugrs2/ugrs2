import * as THREE from 'three';
import { SHAPE } from '../pools/ParticlePool.js';
import { DECAL } from '../pools/DecalPool.js';
import { UP, v3, flatDir, rightOf, yawQuat, face, handPos, finish, theme, impact, dustRing, rnd, DEBRIS } from './common.js';

// ===========================================================================
// OKÇU YETENEKLERİ: 🔫 Seri Atış · 🤸 Takla Atış · 🏹 Ok Yağmuru · 💀 Ölüm Atışı
//
// Ortak opsiyonlar:
//   from     kahramanın ayak konumu      target  hedefin ayak konumu
//   caster   (ops.) kahramanın Object3D'si — yön/hareket animasyonu için
//   onHit(hit, i)  her isabette   onEnd(result)  yetenek bitince
//   shake    (ops.) kamera sarsıntısı (sadece oyuncunun kendi kahramanı için açın)
// Dönüş: { duration, hits: [{ time, position }], endPosition? }
// ===========================================================================

const GOLD = theme(0xffd56b, 0xff7a1a);
const WIND = theme(0xa8f7ff, 0x2fa8ff);
const SKY = theme(0xfff2c4, 0xffa938);
const BLOOD = theme(0xff3b5c, 0x8a0020);

const WIND_MOTE = { shape: SHAPE.GLOW, life: [0.3, 0.5], size: [0.18, 0.28], grow: 0.1, color: 0xe0fdff, colorEnd: 0x3fb8ff, alphaEnd: 0, drag: 2 };
const DARK_SMOKE = {
  shape: SHAPE.SMOKE,
  life: [0.6, 1.0],
  size: [0.5, 0.8],
  grow: 2.2,
  color: 0x3a0c1c,
  alpha: 0.8,
  colorEnd: 0x12040a,
  alphaEnd: 0,
  drag: 3,
  gravity: -1.0,
  spin: [-1, 1],
  additive: 0,
};
const SKULL = { shape: SHAPE.SKULL, life: 1.5, size: 1.7, grow: 1.25, color: 0xff2e4d, alpha: 1, colorEnd: 0xff2e4d, alphaEnd: 0, drag: 1.2, rotate: false, additive: 0 };
const EMBER = { shape: SHAPE.GLOW, life: [0.35, 0.55], size: [0.18, 0.28], grow: 0.1, color: 0xff7086, colorEnd: 0x7a0018, alphaEnd: 0, drag: 2.5 };

// ---------------------------------------------------------------------------
// 🔫 SERİ ATIŞ — altın enerjiyle hızlı ok serisi
// ---------------------------------------------------------------------------
export function seriAtis(vfx, o) {
  const U = vfx.unit;
  const from = v3(o.from);
  const target = v3(o.target);
  const dir = flatDir(from, target);
  const right = rightOf(dir);
  const hand = handPos(vfx, from, dir);
  const hitBase = v3(target).addScaledVector(UP, 0.8 * U);
  const count = o.count ?? 6;
  const interval = o.interval ?? 0.085;
  const windup = 0.14;
  const speed = 32;
  face(o, dir);

  const fx = vfx.isVisibleSegment(from, target, 4 * U);
  if (fx) {
    vfx.decal(DECAL.RUNE, from, { r0: 1.0, r1: 1.15, duration: windup + count * interval + 0.4, color: GOLD.core, alpha: 0.75, spin: 2 });
    vfx.converge(GOLD.inflow, hand, vfx.n(10), { radius: 1.0, time: windup });
  }

  const hits = [];
  for (let i = 0; i < count; i++) {
    const d = windup + i * interval;
    const last = i === count - 1;
    const end = hitBase
      .clone()
      .addScaledVector(right, rnd(-0.35, 0.35) * U)
      .addScaledVector(UP, rnd(-0.15, 0.2) * U);
    let t = d + hand.distanceTo(end) / (speed * U);
    if (fx) {
      vfx.burst(GOLD.glow, hand, 1, { delay: d, sizeMul: 0.55 });
      vfx.burst(GOLD.spark, hand, vfx.n(3), { delay: d, dir, spread: 0.4, speed: [5, 10] });
      t = vfx.shoot('arrow', hand, end, {
        delay: d,
        speed,
        arc: 0.12,
        scale: last ? 1.2 : 0.9,
        emissive: 0.5,
        tint: GOLD.core,
        trails: [{ width: last ? 0.3 : 0.2, length: 0.07, color: GOLD.core, intensity: 1.1 }],
      });
      impact(vfx, end, last ? target : null, GOLD, { delay: t, size: last ? 0.95 : 0.6, dir });
    }
    hits.push({ time: t, position: end });
  }
  return finish(vfx, o, { duration: hits[hits.length - 1].time + 0.3, hits });
}

// ---------------------------------------------------------------------------
// 🤸 TAKLA ATIŞ — geriye takla atarken havada 3'lü rüzgâr oku
// ---------------------------------------------------------------------------
export function taklaAtis(vfx, o) {
  const U = vfx.unit;
  const from = v3(o.from);
  const target = v3(o.target);
  const dir = flatDir(from, target);
  const right = rightOf(dir);
  const back = dir.clone().negate();
  const land = from.clone().addScaledVector(back, (o.distance ?? 3) * U);
  const T = 0.62;
  const jump = 1.7 * U;
  const centerAt = (k) =>
    from
      .clone()
      .lerp(land, k)
      .addScaledVector(UP, jump * 4 * k * (1 - k) + 0.65 * U);
  const fireT = T * 0.5;
  const apex = centerAt(0.5);
  const muzzle = apex.clone().addScaledVector(dir, 0.3 * U);
  const hitBase = v3(target).addScaledVector(UP, 0.75 * U);
  face(o, dir);

  if (o.caster) flipTween(vfx, o.caster, from, land, dir, T, jump);

  const fx = vfx.isVisibleSegment(land, target, 5 * U);
  if (fx) {
    dustRing(vfx, from, { size: 0.9 });
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      vfx.burst(WIND_MOTE, centerAt(k), vfx.n(2), { delay: k * T, radius: 0.35, speed: [0.3, 1] });
    }
    // taklanın çizdiği dikey rüzgâr yayı
    vfx.slash(apex, { axisX: back, axisY: UP, radius: 1.05, start: Math.PI / 2, arc: -5.4, width: 0.32, delay: T * 0.08, duration: T * 0.85, color: WIND.core, intensity: 1.1, growth: 0 });
    vfx.burst(WIND.ring, muzzle, 1, { delay: fireT, sizeMul: 1.3 });
    vfx.burst(WIND.glow, muzzle, 1, { delay: fireT });
    vfx.burst(WIND.spark, muzzle, vfx.n(8), { delay: fireT, dir, spread: 0.5, speed: [6, 12] });
    dustRing(vfx, land, { size: 0.75, delay: T });
  }

  const hits = [];
  for (let j = -1; j <= 1; j++) {
    const end = hitBase.clone().addScaledVector(right, j * 1.1 * U);
    let t = fireT + muzzle.distanceTo(end) / (34 * U);
    if (fx) {
      t = vfx.shoot('arrow', muzzle, end, {
        delay: fireT,
        speed: 34,
        scale: 1.0,
        emissive: 0.7,
        tint: WIND.core,
        rollSpin: 14,
        trails: [
          { width: 0.32, length: 0.12, color: WIND.edge, intensity: 1.0 },
          { width: 0.1, length: 0.08, color: 0xffffff, intensity: 1.2 },
        ],
      });
      impact(vfx, end, target, WIND, { delay: t, size: 0.75 });
    }
    hits.push({ time: t, position: end });
  }
  return finish(vfx, o, { duration: Math.max(T, hits[2].time) + 0.3, hits, endPosition: land });
}

/** Kahramanı göğüs hizası etrafında geriye 360° döndürerek zıplatır. */
function flipTween(vfx, caster, from, land, dir, T, jump) {
  const U = vfx.unit;
  const qYaw = yawQuat(dir);
  const qPitch = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  const hc = new THREE.Vector3(0, 0.65 * U, 0);
  const tmp = new THREE.Vector3();
  vfx.tween(
    T,
    (k) => {
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      qPitch.setFromAxisAngle(X, -Math.PI * 2 * e);
      caster.quaternion.copy(qYaw).multiply(qPitch);
      tmp.copy(hc).applyQuaternion(caster.quaternion);
      caster.position.copy(from).lerp(land, k);
      caster.position.y += jump * 4 * k * (1 - k);
      caster.position.add(hc).sub(tmp);
    },
    0,
    () => {
      caster.quaternion.copy(qYaw);
      caster.position.copy(land);
    },
  );
}

// ---------------------------------------------------------------------------
// 🏹 OK YAĞMURU — gökyüzüne atılan oklar alana yağar, yere saplanır
// ---------------------------------------------------------------------------
export function okYagmuru(vfx, o) {
  const U = vfx.unit;
  const from = v3(o.from);
  const target = v3(o.target);
  const dir = flatDir(from, target);
  const right = rightOf(dir);
  const hand = handPos(vfx, from, dir, 1.2);
  const R = (o.radius ?? 4) * U;
  const count = o.count ?? 36;
  const rainStart = 0.6;
  const rainSpan = o.span ?? 1.4;
  const fall = 0.32;
  face(o, dir);

  const fx = vfx.isVisibleSegment(from, target, R + 3 * U);
  if (fx) {
    for (let j = 0; j < 3; j++) {
      const d = j * 0.07;
      const top = hand
        .clone()
        .addScaledVector(UP, 9 * U)
        .addScaledVector(dir, 1.5 * U)
        .addScaledVector(right, (j - 1) * 0.6 * U);
      vfx.burst(SKY.glow, hand, 1, { delay: d, sizeMul: 0.6 });
      vfx.burst(SKY.spark, hand, vfx.n(4), { delay: d, dir: UP, spread: 0.5, speed: [5, 9] });
      vfx.shoot('arrow', hand, top, { delay: d, duration: 0.35, emissive: 0.9, tint: SKY.edge, trails: [{ width: 0.28, length: 0.18, color: SKY.edge, intensity: 1.3 }] });
      vfx.burst(SKY.star, top, 1, { delay: d + 0.35, sizeMul: 2 });
    }
    vfx.decal(DECAL.AOE, target, { r0: R / U, duration: rainStart + rainSpan + fall + 0.25, color: 0xffb547, alpha: 0.9, spin: 0.25 });
  }

  const hits = [];
  for (let i = 0; i < count; i++) {
    const d = rainStart + (i / count) * rainSpan + Math.random() * 0.05;
    const a = Math.random() * Math.PI * 2;
    const r = R * 0.95 * Math.sqrt(Math.random());
    const ground = new THREE.Vector3(target.x + Math.cos(a) * r, target.y, target.z + Math.sin(a) * r);
    if (fx) {
      const end = ground.clone().addScaledVector(UP, -0.14 * U); // ucu toprağa gömülsün
      const start = end
        .clone()
        .addScaledVector(UP, 11 * U)
        .addScaledVector(dir, -3 * U)
        .addScaledVector(right, rnd(-0.6, 0.6) * U);
      vfx.shoot('arrow', start, end, {
        delay: d,
        duration: fall,
        stick: 1.2 + Math.random() * 0.4,
        emissive: 0.25,
        tint: SKY.core,
        trails: [{ width: 0.16, length: 0.13, color: SKY.core, intensity: 1.1 }],
      });
      vfx.burst(DUST_SMALL, ground, vfx.n(2), { delay: d + fall, flat: true, speed: [1, 2.5], up: 0.6 });
      vfx.burst(SKY.spark, ground, vfx.n(3), { delay: d + fall, dir: UP, spread: 1.0, speed: [2.5, 5] });
      vfx.decal(DECAL.SHOCKWAVE, ground, { r0: 0.1, r1: 0.75, duration: 0.3, color: SKY.core, alpha: 0.6, delay: d + fall });
    }
    hits.push({ time: d + fall, position: ground });
  }
  return finish(vfx, o, { duration: rainStart + rainSpan + fall + 1.6, hits, area: { center: target, radius: R } });
}

const DUST_SMALL = {
  shape: SHAPE.SMOKE,
  life: [0.45, 0.7],
  size: [0.3, 0.45],
  grow: 2,
  color: 0xb9a688,
  alpha: 0.5,
  colorEnd: 0x8a7a63,
  alphaEnd: 0,
  drag: 3,
  gravity: -0.5,
  spin: [-1, 1],
  additive: 0,
};

// ---------------------------------------------------------------------------
// 💀 ÖLÜM ATIŞI — kan kırmızısı şarj, delip geçen dev ok, kafatası
// ---------------------------------------------------------------------------
export function olumAtisi(vfx, o) {
  const U = vfx.unit;
  const from = v3(o.from);
  const target = v3(o.target);
  const dir = flatDir(from, target);
  const right = rightOf(dir);
  const hand = handPos(vfx, from, dir, 1.15);
  const hitP = v3(target).addScaledVector(UP, 0.85 * U);
  const end = hitP.clone().addScaledVector(dir, (o.pierce ?? 6) * U);
  const charge = o.charge ?? 0.9;
  const speed = 45 * U;
  const total = hand.distanceTo(end);
  const flight = total / speed;
  const hitT = charge + hand.distanceTo(hitP) / speed;
  face(o, dir);

  const fx = vfx.isVisibleSegment(from, end, 5 * U);
  if (fx) {
    // --- şarj ---
    vfx.decal(DECAL.RUNE, from, { r0: 1.5, r1: 1.75, duration: charge + 0.35, color: BLOOD.core, alpha: 0.9, spin: 3 });
    vfx.decal(DECAL.SOFT, from, { r0: 2.0, r1: 2.2, duration: charge + 0.6, color: 0x16030a, alpha: 0.55 });
    vfx.converge(BLOOD.inflow, hand, vfx.n(30), { radius: 2.6, time: 0.4, jitter: charge - 0.4 });
    for (let k = 0; k < 9; k++) vfx.burst(BLOOD.glow, hand, 1, { delay: (k * charge) / 9, sizeMul: 0.4 + k * 0.12 });
    vfx.burst(DARK_SMOKE, v3(from).addScaledVector(UP, 0.2 * U), vfx.n(8), { radius: 1.0, flat: true, up: 1.2, jitter: charge, sizeMul: 0.7 });

    // --- bırakış ---
    vfx.burst(BLOOD.glow, hand, 1, { delay: charge, sizeMul: 2.4 });
    vfx.burst(BLOOD.ring, hand, 1, { delay: charge, sizeMul: 2 });
    vfx.burst(BLOOD.star, hand, 2, { delay: charge, sizeMul: 1.5 });
    vfx.burst(BLOOD.spark, hand, vfx.n(16), { delay: charge, dir, spread: 0.5, speed: [8, 16] });
    vfx.decal(DECAL.SHOCKWAVE, from, { r0: 0.3, r1: 3.5, duration: 0.45, color: BLOOD.core, delay: charge });
    dustRing(vfx, from, { delay: charge, size: 0.8 });

    vfx.shoot('arrow', hand, end, {
      delay: charge,
      duration: flight,
      scale: 2.0,
      emissive: 1.1,
      tint: BLOOD.core,
      rollSpin: 10,
      trails: [
        { width: 1.0, length: 0.22, color: 0x1a0008, intensity: 0.85, additive: 0 },
        { width: 0.55, length: 0.16, color: BLOOD.core, intensity: 1.5 },
        { width: 0.14, length: 0.1, color: 0xffd6de, intensity: 1.5 },
      ],
    });

    // okun etrafında dönen çift sarmal kor
    const steps = Math.max(4, Math.ceil(total / (0.3 * U * (1 / vfx.quality))));
    const P = new THREE.Vector3();
    for (let s = 0; s <= steps; s++) {
      const k = s / steps;
      P.lerpVectors(hand, end, k);
      const t0 = vfx.time + charge + k * flight;
      for (let strand = 0; strand < 2; strand++) {
        const ang = (k * total) / U * 2.2 + strand * Math.PI;
        const ox = (right.x * Math.cos(ang)) * 0.35 * U;
        const oy = Math.sin(ang) * 0.35 * U;
        const oz = (right.z * Math.cos(ang)) * 0.35 * U;
        vfx.particles.emit(EMBER, P.x + ox, P.y + oy, P.z + oz, ox * 4, oy * 4, oz * 4, t0);
      }
      if (s % 3 === 0) vfx.particles.emit(DARK_SMOKE, P.x, P.y, P.z, 0, 0.5 * U, 0, t0, -1, 0.6);
    }

    // --- isabet ---
    vfx.burst(BLOOD.glow, hitP, 1, { delay: hitT, sizeMul: 2.8 });
    vfx.burst(BLOOD.spark, hitP, vfx.n(30), { delay: hitT, speed: [5, 13], up: 2 });
    vfx.burst(BLOOD.star, hitP, vfx.n(4), { delay: hitT, speed: [1, 3], sizeMul: 1.3 });
    vfx.burst(DARK_SMOKE, hitP, vfx.n(12), { delay: hitT, speed: [2, 4.5], radius: 0.4 });
    vfx.burst(DEBRIS, target, vfx.n(10), { delay: hitT, dir: UP, spread: 1.0, speed: [4, 8] });
    vfx.decal(DECAL.SHOCKWAVE, target, { r0: 0.4, r1: 5, duration: 0.55, color: BLOOD.core, delay: hitT });
    vfx.decal(DECAL.SCORCH, target, { r0: 2.2, r1: 2.4, duration: 3.5, color: BLOOD.core, delay: hitT });
    vfx.particles.emit(SKULL, hitP.x, hitP.y + 0.9 * U, hitP.z, 0, 1.3 * U, 0, vfx.time + hitT + 0.05);
    vfx.burst(BLOOD.glow, end, 1, { delay: charge + flight, sizeMul: 0.8 });
  }
  if (o.shake) {
    vfx.after(charge, () => vfx.shake(0.15, 0.2));
    vfx.after(hitT, () => vfx.shake(0.45, 0.35));
  }
  return finish(vfx, o, { duration: Math.max(hitT + 1.5, charge + flight), hits: [{ time: hitT, position: hitP }] });
}

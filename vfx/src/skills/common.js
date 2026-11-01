import * as THREE from 'three';
import { SHAPE } from '../pools/ParticlePool.js';
import { DECAL } from '../pools/DecalPool.js';

export const UP = new THREE.Vector3(0, 1, 0);

export const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);

/** from -> to yatay yön (birim). */
export function flatDir(from, to) {
  const d = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  const l = d.length();
  return l > 1e-5 ? d.multiplyScalar(1 / l) : new THREE.Vector3(0, 0, 1);
}

/** Yatay düzlemde dik vektör (sağ taraf). */
export const rightOf = (dir) => new THREE.Vector3(-dir.z, 0, dir.x);

export function yawQuat(dir) {
  return new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(dir.x, dir.z));
}

/** Kahramanı (+Z ileri kabulüyle) yöne çevirir. */
export function face(o, dir) {
  if (o.caster && o.face !== false) o.caster.quaternion.copy(yawQuat(dir));
}

/** Elin / yayın konumu: ayak + yukarı + biraz ileri. */
export function handPos(vfx, from, dir, height = 1.1) {
  const U = vfx.unit;
  return v3(from).addScaledVector(UP, height * U).addScaledVector(dir, 0.35 * U);
}

/** Yetenek sonucunu tamamlar: isabet ve bitiş geri çağrılarını planlar. */
export function finish(vfx, o, result) {
  if (o.onHit) {
    result.hits.forEach((h, i) => vfx.after(h.time, () => o.onHit(h, i)));
  }
  if (o.onEnd) vfx.after(result.duration, () => o.onEnd(result));
  return result;
}

const rnd = (a, b) => a + Math.random() * (b - a);
export { rnd };

/**
 * Bir renk temasından hazır parçacık preset'leri üretir.
 * core: parlak ana renk, edge: sönerken dönüştüğü renk.
 */
export function theme(core, edge) {
  return {
    core,
    edge,
    glow: { shape: SHAPE.GLOW, life: [0.16, 0.24], size: [0.9, 1.1], grow: 1.7, color: core, alpha: 0.95, colorEnd: edge, alphaEnd: 0 },
    spark: {
      shape: SHAPE.SPARK,
      life: [0.22, 0.42],
      size: [0.05, 0.08],
      grow: 0.3,
      color: core,
      colorEnd: edge,
      alphaEnd: 0,
      drag: 3.5,
      gravity: 7,
      stretch: 0.045,
    },
    star: { shape: SHAPE.STAR, life: [0.25, 0.45], size: [0.35, 0.55], grow: 0.1, color: 0xffffff, colorEnd: core, alphaEnd: 0, spin: [-3, 3] },
    mote: { shape: SHAPE.GLOW, life: [0.45, 0.85], size: [0.14, 0.22], grow: 0.15, color: core, colorEnd: edge, alphaEnd: 0, drag: 1.5, gravity: -1.2 },
    ring: { shape: SHAPE.RING, life: [0.28, 0.32], size: [0.4, 0.4], grow: 5, color: core, alpha: 0.9, colorEnd: edge, alphaEnd: 0, rotate: false },
    // converge() için: sürtünmesiz
    inflow: { shape: SHAPE.GLOW, size: [0.12, 0.2], grow: 0.4, color: edge, alpha: 0.2, colorEnd: core, alphaEnd: 1 },
  };
}

export const DUST = {
  shape: SHAPE.SMOKE,
  life: [0.55, 0.85],
  size: [0.5, 0.75],
  grow: 2.1,
  color: 0xb9a688,
  alpha: 0.55,
  colorEnd: 0x8a7a63,
  alphaEnd: 0,
  drag: 3,
  gravity: -0.5,
  spin: [-1, 1],
  additive: 0,
};

export const DEBRIS = {
  shape: SHAPE.SHARD,
  life: [0.45, 0.7],
  size: [0.1, 0.16],
  grow: 0.6,
  color: 0x8f8170,
  alpha: 1,
  colorEnd: 0x6b5f52,
  alphaEnd: 0,
  drag: 1,
  gravity: 14,
  spin: [-12, 12],
  additive: 0,
};

/** Standart vuruş patlaması. pos: isabet noktası, ground: zemin noktası. */
export function impact(vfx, pos, ground, th, o = {}) {
  const s = o.size ?? 1;
  const delay = o.delay ?? 0;
  vfx.burst(th.glow, pos, 1, { delay, sizeMul: s });
  vfx.burst(th.spark, pos, vfx.n(Math.round(8 * s)), { speed: [3, 7.5], up: 1.5, delay, dir: o.dir, spread: o.dir ? 1.1 : Math.PI });
  if (s >= 0.6) vfx.burst(th.star, pos, vfx.n(1), { speed: [0.3, 1], delay, sizeMul: s });
  if (ground) vfx.decal(DECAL.SHOCKWAVE, ground, { r0: 0.15, r1: 1.2 * s, duration: 0.35, color: th.core, alpha: 0.75, delay });
}

/** Yerden kalkan toz halkası (zıplama, iniş, saplanma). */
export function dustRing(vfx, ground, o = {}) {
  const s = o.size ?? 1;
  const delay = o.delay ?? 0;
  vfx.burst(DUST, ground, vfx.n(Math.round(8 * s)), { flat: true, speed: [2, 4.5], radius: 0.3 * s, up: 0.4, delay, sizeMul: s });
  vfx.decal(DECAL.SHOCKWAVE, ground, { r0: 0.2, r1: 1.6 * s, duration: 0.4, color: 0xd9ccb4, alpha: 0.5, delay });
}

// ---------------------------------------------------------------------------
// Temel saldırılar ve genel efektler (yüzlerce kahraman sürekli bunları kullanır,
// bu yüzden çok ucuz tutuldu)
// ---------------------------------------------------------------------------

const BASIC = theme(0xfff0c2, 0xff9a3c);
const MELEE = theme(0xe6f4ff, 0x7fb8ff);
const DEATH = theme(0xd59bff, 0x6a2fd0);

const DEATH_SMOKE = {
  shape: SHAPE.SMOKE,
  life: [0.6, 0.9],
  size: [0.5, 0.8],
  grow: 2,
  color: 0x9a6be0,
  alpha: 0.7,
  colorEnd: 0x4a2c7a,
  alphaEnd: 0,
  drag: 3.5,
  gravity: -1.2,
  spin: [-1.5, 1.5],
  additive: 0,
};
const COIN = {
  shape: SHAPE.DOT,
  life: [0.7, 0.9],
  size: [0.16, 0.2],
  grow: 0.8,
  color: 0xffd34d,
  alpha: 1,
  colorEnd: 0xffb020,
  alphaEnd: 0,
  gravity: 16,
  additive: 0,
};
const SOUL = { shape: SHAPE.GLOW, life: [0.7, 1.1], size: [0.25, 0.35], grow: 0.2, color: 0xe8d4ff, colorEnd: 0x8f5cff, alphaEnd: 0, drag: 0.5, gravity: -3 };

/** Temel ok atışı. */
export function temelAtis(vfx, o) {
  const from = v3(o.from);
  const target = v3(o.target);
  const dir = flatDir(from, target);
  const U = vfx.unit;
  const hand = handPos(vfx, from, dir);
  const hit = v3(target).addScaledVector(UP, 0.75 * U);
  face(o, dir);
  let t = hand.distanceTo(hit) / (26 * U);
  if (vfx.isVisibleSegment(hand, hit, 2 * U)) {
    t = vfx.shoot('arrow', hand, hit, { speed: 26, arc: 0.25, scale: 0.85, trails: [{ width: 0.1, length: 0.06, color: 0xfff1c9, intensity: 0.8 }] });
    impact(vfx, hit, null, BASIC, { delay: t, size: 0.45, dir });
  }
  return finish(vfx, o, { duration: t, hits: [{ time: t, position: hit }] });
}

/** Temel yakın dövüş vuruşu (kılıç / hançer savurma). */
export function temelVurus(vfx, o) {
  const from = v3(o.from);
  const target = v3(o.target);
  const dir = flatDir(from, target);
  const U = vfx.unit;
  const hit = v3(target).addScaledVector(UP, 0.75 * U);
  face(o, dir);
  const t = 0.08;
  if (vfx.isVisible(from, 3 * U)) {
    const c = v3(from).addScaledVector(UP, 0.85 * U).addScaledVector(dir, 0.35 * U);
    const n = UP.clone().applyAxisAngle(dir, rnd(-0.6, 0.6)); // hafif eğik yatay düzlem
    vfx.slash(c, { normal: n, toward: dir, radius: 0.95, arc: 2.3, width: 0.32, duration: 0.18, color: o.color ?? 0xbfe3ff, intensity: 1 });
    impact(vfx, hit, null, MELEE, { delay: t, size: 0.45, dir });
  }
  return finish(vfx, o, { duration: 0.2, hits: [{ time: t, position: hit }] });
}

/** Yaratık ölümü: mor duman, ruh, saçılan altınlar. */
export function yaratikOlum(vfx, o) {
  const p = v3(o.position);
  const U = vfx.unit;
  if (vfx.isVisible(p, 3 * U)) {
    const c = v3(p).addScaledVector(UP, 0.6 * U);
    vfx.burst(DEATH.glow, c, 1, { sizeMul: 1.6 });
    vfx.burst(DEATH_SMOKE, c, vfx.n(10), { speed: [1.5, 3.5], radius: 0.3, up: 0.5 });
    vfx.burst(DEATH.spark, c, vfx.n(10), { speed: [3, 6], up: 2 });
    vfx.burst(DEATH.star, c, vfx.n(2), { speed: [0.5, 1.5] });
    vfx.burst(SOUL, c, vfx.n(4), { speed: [0.2, 0.8], radius: 0.25, jitter: 0.25 });
    vfx.burst(COIN, c, vfx.n(o.coins ?? 5), { dir: UP, spread: 0.7, speed: [4, 6.5] });
    vfx.decal(DECAL.SHOCKWAVE, p, { r0: 0.2, r1: 2, duration: 0.45, color: DEATH.core, alpha: 0.8 });
    vfx.decal(DECAL.SOFT, p, { r0: 1.0, r1: 1.4, duration: 1.2, color: 0x2a1840, alpha: 0.5 });
  }
  return finish(vfx, o, { duration: 1, hits: [] });
}

/** Genel isabet kıvılcımı (dışarıdan da kullanılabilir). */
export function isabet(vfx, o) {
  const p = v3(o.position);
  if (vfx.isVisible(p, 2 * vfx.unit)) impact(vfx, p, o.ground ? v3(o.ground) : null, o.theme ?? MELEE, { size: o.size ?? 0.6 });
  return finish(vfx, o, { duration: 0.4, hits: [] });
}

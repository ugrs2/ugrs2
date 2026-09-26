// Prosedürel low-poly modeller. Parçalar tek bir geometriye (köşe renkleriyle) birleştirilir → az çizim çağrısı.
import * as THREE from 'three';

const D2R = Math.PI / 180;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export const litMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, metalness: 0.1 });
export const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
export const ghostMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.5, roughness: 0.5 });

// Temel geometriler (paylaşılan)
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cone: new THREE.ConeGeometry(0.5, 1, 8),
  cone4: new THREE.ConeGeometry(0.5, 1, 4),
  sph: new THREE.IcosahedronGeometry(0.5, 1),
  sphLo: new THREE.IcosahedronGeometry(0.5, 0),
  oct: new THREE.OctahedronGeometry(0.5, 0),
  dod: new THREE.DodecahedronGeometry(0.5, 0),
  torus: new THREE.TorusGeometry(0.5, 0.08, 6, 16),
  torusThin: new THREE.TorusGeometry(0.5, 0.04, 5, 20),
  hemi: new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
};

// Parça tanımı: [geo, renk, {p:[x,y,z], r:[rx,ry,rz] (derece), s:[sx,sy,sz]|sayı, glow}]
function P(geo, color, o = {}) { return { geo: G[geo] || geo, color, ...o }; }

export function mergeParts(parts) {
  const pos = [], nor = [], col = [];
  for (const pt of parts) {
    let g = pt.geo.index ? pt.geo.toNonIndexed() : pt.geo.clone();
    const p = pt.p || [0, 0, 0];
    const r = pt.r || [0, 0, 0];
    const s = pt.s == null ? [1, 1, 1] : (typeof pt.s === 'number' ? [pt.s, pt.s, pt.s] : pt.s);
    _e.set(r[0] * D2R, r[1] * D2R, r[2] * D2R);
    _q.setFromEuler(_e);
    _m.compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
    g.applyMatrix4(_m);
    const pa = g.attributes.position.array, na = g.attributes.normal.array;
    _c.set(pt.color);
    for (let i = 0; i < pa.length; i += 3) {
      pos.push(pa[i], pa[i + 1], pa[i + 2]);
      nor.push(na[i], na[i + 1], na[i + 2]);
      col.push(_c.r, _c.g, _c.b);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

function split(parts) {
  const lit = parts.filter(p => !p.glow), glow = parts.filter(p => p.glow);
  return { lit: lit.length ? mergeParts(lit) : null, glow: glow.length ? mergeParts(glow) : null };
}

// ------------------------------------------------------------------ KULELER
const DARK = '#2f343c', STEEL = '#6d7480', STEEL2 = '#9aa3ad';

function towerHead(type, c, spec) {
  const acc = spec === 'A' ? '#ffd54a' : spec === 'B' ? '#ff4fa3' : null;
  switch (type) {
    case 'mg': return [
      P('box', c, { p: [0, 0.05, 0], s: [0.42, 0.28, 0.46] }),
      P('box', DARK, { p: [0, 0.22, -0.05], s: [0.3, 0.08, 0.3] }),
      P('cyl8', DARK, { p: [0.09, 0.05, 0.4], r: [90, 0, 0], s: [0.07, 0.5, 0.07] }),
      P('cyl8', DARK, { p: [-0.09, 0.05, 0.4], r: [90, 0, 0], s: [0.07, 0.5, 0.07] }),
      ...(spec === 'A' ? [P('cyl8', DARK, { p: [0, 0.14, 0.4], r: [90, 0, 0], s: [0.07, 0.5, 0.07] }), P('cyl8', DARK, { p: [0, -0.04, 0.4], r: [90, 0, 0], s: [0.07, 0.5, 0.07] })] : []),
      P('box', '#ffe066', { p: [0, 0.05, 0.66], s: [0.3, 0.08, 0.04], glow: true }),
    ];
    case 'cannon': return [
      P('sph', c, { p: [0, 0.05, 0], s: 0.5 }),
      P('cyl', DARK, { p: spec === 'B' ? [0.1, 0.05, 0.35] : [0, 0.05, 0.35], r: [90, 0, 0], s: [0.17, 0.55, 0.17] }),
      ...(spec === 'B' ? [P('cyl', DARK, { p: [-0.1, 0.05, 0.35], r: [90, 0, 0], s: [0.17, 0.55, 0.17] })] : []),
      P('torus', STEEL, { p: [0, 0.05, 0.6], s: spec === 'A' ? 0.34 : 0.22 }),
    ];
    case 'frost': return [
      P('oct', '#bff0ff', { p: [0, 0.35, 0], s: [0.45, 0.75, 0.45], glow: true }),
      P('oct', '#7fd8ff', { p: [0.3, 0.1, 0], s: [0.14, 0.3, 0.14], glow: true }),
      P('oct', '#7fd8ff', { p: [-0.15, 0.1, 0.26], s: [0.14, 0.3, 0.14], glow: true }),
      P('oct', '#7fd8ff', { p: [-0.15, 0.1, -0.26], s: [0.14, 0.3, 0.14], glow: true }),
      P('torusThin', acc || '#e0f7ff', { p: [0, 0.05, 0], r: [90, 0, 0], s: 0.7 }),
    ];
    case 'sniper': return [
      P('box', c, { p: [0, 0.05, -0.05], s: [0.22, 0.2, 0.5] }),
      P('cyl8', DARK, { p: [0, 0.07, 0.55], r: [90, 0, 0], s: [0.05, 0.9, 0.05] }),
      P('cyl8', DARK, { p: [0, 0.22, 0.02], r: [90, 0, 0], s: [0.08, 0.28, 0.08] }),
      P('sph', '#ff3030', { p: [0, 0.22, 0.17], s: 0.05, glow: true }),
      ...(spec === 'B' ? [P('box', DARK, { p: [0, 0.07, 0.96], s: [0.12, 0.12, 0.1] })] : []),
    ];
    case 'flak': {
      const out = [P('box', c, { p: [0, 0.05, 0], s: [0.5, 0.26, 0.42] })];
      for (const x of [-0.12, 0.12]) for (const y of [0.0, 0.14]) out.push(P('cyl8', DARK, { p: [x, 0.12 + y, 0.28], r: [60, 0, 0], s: [0.06, 0.45, 0.06] }));
      if (spec === 'A') out.push(P('cone', '#ff5252', { p: [0, 0.35, 0.1], r: [60, 0, 0], s: [0.1, 0.25, 0.1] }));
      return out;
    }
    case 'flame': return [
      P('cyl', '#b33a16', { p: [0, 0.08, -0.12], r: [0, 0, 90], s: [0.28, 0.45, 0.28] }),
      P('box', c, { p: [0, 0.05, 0.1], s: [0.22, 0.2, 0.3] }),
      P('cone', DARK, { p: [0, 0.05, 0.38], r: [-90, 0, 0], s: [0.16, 0.3, 0.16] }),
      P('sph', acc || '#ffb300', { p: [0, 0.05, 0.55], s: 0.1, glow: true }),
    ];
    case 'mine': return [
      P('cone', '#8d6e63', { p: [0, 0.05, 0], r: [180, 0, 0], s: [0.3, 0.45, 0.3] }),
      P('torus', '#5d4037', { p: [0, 0.35, 0], s: 0.35 }),
      P('dod', '#ffd54a', { p: [0.25, -0.02, 0.18], s: 0.18, glow: true }),
      P('dod', '#ffd54a', { p: [-0.22, -0.02, 0.2], s: 0.14, glow: true }),
      P('dod', '#ffca28', { p: [0.05, -0.02, -0.28], s: 0.16, glow: true }),
      ...(acc ? [P('box', acc, { p: [0, 0.55, 0], s: [0.2, 0.2, 0.2], glow: true })] : []),
    ];
    case 'tesla': return [
      P('cyl8', STEEL, { p: [0, 0.2, 0], s: [0.08, 0.7, 0.08] }),
      P('torus', '#b87333', { p: [0, 0.0, 0], r: [90, 0, 0], s: 0.5 }),
      P('torus', '#b87333', { p: [0, 0.18, 0], r: [90, 0, 0], s: 0.42 }),
      P('torus', '#b87333', { p: [0, 0.36, 0], r: [90, 0, 0], s: 0.34 }),
      P('sph', acc || '#9ff3ff', { p: [0, 0.62, 0], s: 0.26, glow: true }),
    ];
    case 'missile': {
      const out = [
        P('box', c, { p: [0, 0.1, 0], r: [-12, 0, 0], s: [0.55, 0.34, 0.48] }),
        P('box', DARK, { p: [0, 0.1, -0.2], s: [0.2, 0.2, 0.15] }),
      ];
      const n = spec === 'A' ? 3 : 2;
      for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) {
        const x = (i - (n - 1) / 2) * 0.16, y = 0.03 + j * 0.15;
        out.push(P('cone', spec === 'B' ? '#ffd54a' : '#ff5252', { p: [x, y + 0.08, 0.3], r: [78, 0, 0], s: [0.1, 0.16, 0.1] }));
      }
      return out;
    }
    case 'mortar': return [
      P('cyl', c, { p: [0, -0.02, 0], s: [0.5, 0.12, 0.5] }),
      P('cyl', DARK, { p: [0, 0.2, 0.08], r: [35, 0, 0], s: [0.26, 0.5, 0.26] }),
      P('torus', STEEL2, { p: [0, 0.4, 0.22], r: [125, 0, 0], s: 0.28 }),
      ...(acc ? [P('sph', spec === 'B' ? '#ff6d00' : '#ffd54a', { p: [0, 0.43, 0.24], s: 0.12, glow: true })] : []),
    ];
    case 'poison': return [
      P('cyl', '#4a5a3a', { p: [0, 0.12, 0], s: [0.55, 0.35, 0.55] }),
      P('cyl', '#9cff57', { p: [0, 0.3, 0], s: [0.46, 0.02, 0.46], glow: true }),
      P('sph', '#76ff03', { p: [0.08, 0.36, 0.05], s: 0.14, glow: true }),
      P('sph', '#b2ff59', { p: [-0.1, 0.34, -0.07], s: 0.1, glow: true }),
      P('cyl8', STEEL, { p: [0, 0.2, 0.34], r: [70, 0, 0], s: [0.07, 0.3, 0.07] }),
      ...(acc ? [P('torus', acc, { p: [0, 0.3, 0], r: [90, 0, 0], s: 0.56 })] : []),
    ];
    case 'laser': return [
      P('sph', c, { p: [0, 0.05, 0], s: 0.42 }),
      P('cyl', DARK, { p: [0, 0.05, 0.24], r: [90, 0, 0], s: [0.22, 0.14, 0.22] }),
      P('cyl', acc || '#ff7ab0', { p: [0, 0.05, 0.32], r: [90, 0, 0], s: [0.15, 0.04, 0.15], glow: true }),
      P('box', STEEL, { p: [0.25, 0.05, 0], s: [0.06, 0.3, 0.3] }),
      P('box', STEEL, { p: [-0.25, 0.05, 0], s: [0.06, 0.3, 0.3] }),
    ];
    case 'radar': return [
      P('cyl8', STEEL, { p: [0, 0.1, 0], s: [0.08, 0.3, 0.08] }),
      P('hemi', c, { p: [0, 0.3, 0.05], r: [-110, 0, 0], s: [0.7, 0.3, 0.7] }),
      P('cyl8', DARK, { p: [0, 0.35, 0.18], r: [70, 0, 0], s: [0.03, 0.3, 0.03] }),
      P('sph', acc || '#3dffb0', { p: [0, 0.42, 0.3], s: 0.08, glow: true }),
    ];
    case 'rail': return [
      P('box', c, { p: [0, 0.05, -0.1], s: [0.4, 0.26, 0.45] }),
      P('box', STEEL2, { p: [0.11, 0.05, 0.38], s: [0.07, 0.12, 0.95] }),
      P('box', STEEL2, { p: [-0.11, 0.05, 0.38], s: [0.07, 0.12, 0.95] }),
      P('box', acc || '#c9b3ff', { p: [0, 0.05, 0.38], s: [0.05, 0.05, 0.9], glow: true }),
    ];
    case 'gravity': return [
      P('sph', '#140022', { p: [0, 0.4, 0], s: 0.42 }),
      P('torus', acc || '#d38cff', { p: [0, 0.4, 0], r: [70, 0, 0], s: 0.62, glow: true }),
      P('torus', '#8e24aa', { p: [0, 0.4, 0], r: [-30, 40, 0], s: 0.72, glow: true }),
    ];
  }
  return [P('box', c, { s: 0.4 })];
}

const SPINNERS = new Set(['frost', 'mine', 'tesla', 'radar', 'gravity']);
export function towerSpins(type) { return SPINNERS.has(type); }

const towerCache = new Map();
export function towerGeometry(type, def, level, spec) {
  const k = `${type}|${level}|${spec || ''}`;
  if (towerCache.has(k)) return towerCache.get(k);
  const c = def.color;
  const base = [
    P('box', DARK, { p: [0, 0.06, 0], s: [0.86, 0.12, 0.86] }),
    P('cyl8', STEEL, { p: [0, 0.27, 0], s: [0.62, 0.3, 0.62] }),
    P('cyl8', c, { p: [0, 0.44, 0], s: [0.5, 0.06, 0.5] }),
  ];
  if (type === 'sniper') base.push(P('cyl8', STEEL, { p: [0, 0.6, 0], s: [0.3, 0.4, 0.3] }));
  for (let i = 0; i < Math.min(level, 3); i++) base.push(P('box', '#ffd54a', { p: [-0.3 + i * 0.15, 0.14, 0.38], s: [0.1, 0.06, 0.06], glow: true }));
  if (spec) base.push(P('oct', spec === 'A' ? '#ffd54a' : '#ff4fa3', { p: [0.32, 0.2, 0.32], s: 0.16, glow: true }));
  if (level >= 2) base.push(P('box', STEEL2, { p: [0, 0.2, 0], s: [0.72, 0.08, 0.72] }));
  const headY = type === 'sniper' ? 0.95 : 0.62;
  const res = { base: split(base), head: split(towerHead(type, c, spec)), headY, scale: 1 + 0.06 * (level - 1) };
  towerCache.set(k, res);
  return res;
}

// ------------------------------------------------------------------ DÜŞMANLAR (birim boyutta ~1 çap, +z ileri)
function enemyParts(type, c) {
  const eye = (x, y, z, s = 0.08, col = '#ffeb3b') => P('sph', col, { p: [x, y, z], s, glow: true });
  switch (type) {
    case 'grunt': return [
      P('box', c, { p: [0, 0.45, 0], s: [0.55, 0.5, 0.4] }),
      P('sph', '#f0c8a0', { p: [0, 0.85, 0.02], s: 0.34 }),
      P('box', '#5d4037', { p: [0, 0.98, 0], s: [0.36, 0.1, 0.36] }),
      P('box', '#37474f', { p: [0.14, 0.12, 0], s: [0.16, 0.25, 0.18] }),
      P('box', '#37474f', { p: [-0.14, 0.12, 0], s: [0.16, 0.25, 0.18] }),
      P('box', DARK, { p: [0.3, 0.5, 0.2], s: [0.08, 0.08, 0.45] }),
      eye(0.08, 0.88, 0.17, 0.06, '#222'), eye(-0.08, 0.88, 0.17, 0.06, '#222'),
    ];
    case 'runner': return [
      P('cone', c, { p: [0, 0.45, 0.05], r: [30, 0, 0], s: [0.4, 0.7, 0.4] }),
      P('sph', c, { p: [0, 0.8, 0.22], s: 0.26 }),
      P('box', '#6d4c41', { p: [0.1, 0.12, 0], r: [30, 0, 0], s: [0.08, 0.3, 0.08] }),
      P('box', '#6d4c41', { p: [-0.1, 0.12, 0], r: [-30, 0, 0], s: [0.08, 0.3, 0.08] }),
      eye(0.07, 0.84, 0.33), eye(-0.07, 0.84, 0.33),
    ];
    case 'swarm': return [
      P('sph', c, { p: [0, 0.25, 0], s: [0.7, 0.4, 0.9] }),
      P('sph', '#33691e', { p: [0, 0.3, 0.42], s: 0.35 }),
      ...[-1, 1].flatMap(sd => [0.2, 0, -0.2].map(z => P('box', '#1b1b1b', { p: [sd * 0.38, 0.1, z], r: [0, 0, sd * 30], s: [0.3, 0.05, 0.05] }))),
      eye(0.1, 0.36, 0.56, 0.07, '#ff1744'), eye(-0.1, 0.36, 0.56, 0.07, '#ff1744'),
    ];
    case 'brute': return [
      P('box', c, { p: [0, 0.55, 0], s: [0.8, 0.65, 0.55] }),
      P('box', '#546e7a', { p: [0.45, 0.8, 0], s: [0.3, 0.25, 0.45] }),
      P('box', '#546e7a', { p: [-0.45, 0.8, 0], s: [0.3, 0.25, 0.45] }),
      P('box', '#455a64', { p: [0, 1.0, 0.05], s: [0.35, 0.3, 0.35] }),
      P('box', '#263238', { p: [0.2, 0.15, 0], s: [0.25, 0.3, 0.3] }),
      P('box', '#263238', { p: [-0.2, 0.15, 0], s: [0.25, 0.3, 0.3] }),
      P('box', '#ff5252', { p: [0, 1.02, 0.23], s: [0.25, 0.06, 0.02], glow: true }),
    ];
    case 'drone': return [
      P('cyl', c, { p: [0, 0, 0], s: [0.55, 0.16, 0.55] }),
      P('hemi', '#263238', { p: [0, 0.08, 0], s: [0.35, 0.3, 0.35] }),
      ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].flatMap(([a, b]) => [
        P('box', '#37474f', { p: [a * 0.28, 0.02, b * 0.28], r: [0, 45 * a * b, 0], s: [0.35, 0.04, 0.06] }),
        P('cyl', '#b0bec5', { p: [a * 0.42, 0.06, b * 0.42], s: [0.3, 0.02, 0.3] }),
      ]),
      eye(0, 0, 0.28, 0.09, '#ff1744'),
    ];
    case 'shield': return [
      P('box', c, { p: [0, 0.5, 0], s: [0.6, 0.6, 0.45] }),
      P('sph', '#9fa8da', { p: [0, 0.95, 0], s: 0.32 }),
      P('box', '#3949ab', { p: [0, 0.55, 0.32], s: [0.7, 0.8, 0.08] }),
      P('box', '#8c9eff', { p: [0, 0.55, 0.37], s: [0.4, 0.5, 0.02], glow: true }),
      eye(0.08, 0.98, 0.14, 0.05), eye(-0.08, 0.98, 0.14, 0.05),
    ];
    case 'healer': return [
      P('cyl8', '#eceff1', { p: [0, 0.45, 0], s: [0.55, 0.7, 0.55] }),
      P('sph', '#eceff1', { p: [0, 0.95, 0], s: 0.35 }),
      P('box', '#ff1744', { p: [0, 0.55, 0.28], s: [0.3, 0.08, 0.02], glow: true }),
      P('box', '#ff1744', { p: [0, 0.55, 0.28], s: [0.08, 0.3, 0.02], glow: true }),
      P('torusThin', '#69f0ae', { p: [0, 1.25, 0], r: [90, 0, 0], s: 0.35, glow: true }),
    ];
    case 'splitter': return [
      P('sph', c, { p: [0, 0.45, 0], s: 0.7 }),
      P('sph', '#ce93d8', { p: [0.25, 0.75, 0.1], s: 0.35 }),
      P('sph', '#ce93d8', { p: [-0.25, 0.7, -0.1], s: 0.32 }),
      P('sph', '#8e24aa', { p: [0, 0.25, 0.3], s: 0.3 }),
      eye(0.1, 0.6, 0.33), eye(-0.1, 0.6, 0.33),
    ];
    case 'splitling': return [
      P('sph', c, { p: [0, 0.35, 0], s: 0.65 }),
      eye(0.1, 0.45, 0.28), eye(-0.1, 0.45, 0.28),
    ];
    case 'ghost': return [
      P('cone', c, { p: [0, 0.5, 0], s: [0.65, 0.9, 0.65] }),
      P('sph', c, { p: [0, 0.95, 0], s: 0.45 }),
      eye(0.1, 1.0, 0.19, 0.07, '#00e5ff'), eye(-0.1, 1.0, 0.19, 0.07, '#00e5ff'),
    ];
    case 'tank': return [
      P('box', c, { p: [0, 0.3, 0], s: [0.75, 0.3, 1.0] }),
      P('box', '#263238', { p: [0.42, 0.18, 0], s: [0.16, 0.3, 1.05] }),
      P('box', '#263238', { p: [-0.42, 0.18, 0], s: [0.16, 0.3, 1.05] }),
      P('cyl8', '#6b8e23', { p: [0, 0.55, -0.05], s: [0.5, 0.22, 0.5] }),
      P('cyl8', '#37474f', { p: [0, 0.57, 0.4], r: [90, 0, 0], s: [0.1, 0.65, 0.1] }),
    ];
    case 'berserker': return [
      P('box', c, { p: [0, 0.5, 0], s: [0.6, 0.6, 0.45] }),
      P('sph', '#b71c1c', { p: [0, 0.95, 0.05], s: 0.36 }),
      P('cone', '#eeeeee', { p: [0.15, 1.15, 0], r: [0, 0, -25], s: [0.08, 0.25, 0.08] }),
      P('cone', '#eeeeee', { p: [-0.15, 1.15, 0], r: [0, 0, 25], s: [0.08, 0.25, 0.08] }),
      P('cone', '#424242', { p: [0.35, 0.75, 0], r: [0, 0, -70], s: [0.12, 0.3, 0.12] }),
      P('cone', '#424242', { p: [-0.35, 0.75, 0], r: [0, 0, 70], s: [0.12, 0.3, 0.12] }),
      P('box', '#212121', { p: [0.15, 0.12, 0], s: [0.18, 0.25, 0.2] }),
      P('box', '#212121', { p: [-0.15, 0.12, 0], s: [0.18, 0.25, 0.2] }),
      eye(0.1, 0.98, 0.2, 0.06, '#ffea00'), eye(-0.1, 0.98, 0.2, 0.06, '#ffea00'),
    ];
    case 'golem': return [
      P('dod', c, { p: [0, 0.6, 0], s: [0.85, 0.8, 0.7] }),
      P('dod', '#81d4fa', { p: [0, 1.1, 0.05], s: 0.45 }),
      P('dod', '#e1f5fe', { p: [0.5, 0.7, 0], s: 0.35 }),
      P('dod', '#e1f5fe', { p: [-0.5, 0.7, 0], s: 0.35 }),
      P('box', '#4fc3f7', { p: [0.2, 0.15, 0], s: [0.25, 0.3, 0.3] }),
      P('box', '#4fc3f7', { p: [-0.2, 0.15, 0], s: [0.25, 0.3, 0.3] }),
      P('oct', '#e0f7ff', { p: [0, 0.65, 0.3], s: 0.2, glow: true }),
      eye(0.1, 1.12, 0.25, 0.06, '#00b0ff'), eye(-0.1, 1.12, 0.25, 0.06, '#00b0ff'),
    ];
    case 'bomber': return [
      P('cyl8', c, { p: [0, 0, 0], r: [90, 0, 0], s: [0.3, 1.1, 0.3] }),
      P('cone', c, { p: [0, 0, 0.7], r: [90, 0, 0], s: [0.3, 0.3, 0.3] }),
      P('box', '#455a64', { p: [0, 0, 0.05], s: [1.5, 0.05, 0.35] }),
      P('box', '#455a64', { p: [0, 0.15, -0.5], s: [0.5, 0.04, 0.2] }),
      P('box', '#455a64', { p: [0, 0.2, -0.5], s: [0.04, 0.3, 0.2] }),
      P('sph', '#ff6d00', { p: [0.4, -0.02, -0.15], s: 0.12, glow: true }),
      P('sph', '#ff6d00', { p: [-0.4, -0.02, -0.15], s: 0.12, glow: true }),
    ];
    case 'summoner': return [
      P('cone', c, { p: [0, 0.55, 0], s: [0.75, 1.1, 0.75] }),
      P('sph', '#4a148c', { p: [0, 1.1, 0], s: 0.32 }),
      P('cone', '#311b92', { p: [0, 1.35, 0], s: [0.3, 0.35, 0.3] }),
      P('sph', '#e040fb', { p: [0, 1.6, 0.25], s: 0.2, glow: true }),
      eye(0.07, 1.12, 0.14, 0.05, '#e040fb'), eye(-0.07, 1.12, 0.14, 0.05, '#e040fb'),
    ];
    case 'phaser': return [
      P('oct', c, { p: [0, 0.6, 0], s: [0.6, 0.9, 0.6], glow: true }),
      P('torus', '#006064', { p: [0, 0.6, 0], r: [90, 0, 0], s: 0.6 }),
      P('oct', '#e0f7fa', { p: [0, 0.6, 0], s: [0.25, 0.4, 0.25], glow: true }),
    ];
    case 'titan': return [
      P('box', c, { p: [0, 0.8, 0], s: [0.9, 0.8, 0.6] }),
      P('box', '#5d4037', { p: [0, 1.35, 0], s: [0.5, 0.4, 0.45] }),
      P('box', '#6d4c41', { p: [0.6, 0.9, 0], s: [0.3, 0.8, 0.3] }),
      P('box', '#6d4c41', { p: [-0.6, 0.9, 0], s: [0.3, 0.8, 0.3] }),
      P('box', '#4e342e', { p: [0.22, 0.2, 0], s: [0.3, 0.45, 0.35] }),
      P('box', '#4e342e', { p: [-0.22, 0.2, 0], s: [0.3, 0.45, 0.35] }),
      P('cone', '#ffca28', { p: [0, 1.65, 0], s: [0.4, 0.2, 0.4] }),
      P('box', '#ff3d00', { p: [0, 1.4, 0.23], s: [0.35, 0.07, 0.02], glow: true }),
      P('oct', '#ff9100', { p: [0, 0.85, 0.31], s: 0.2, glow: true }),
    ];
    case 'mothership': return [
      P('cyl', c, { p: [0, 0, 0], s: [1.4, 0.18, 1.4] }),
      P('cyl', '#37474f', { p: [0, -0.12, 0], s: [1.0, 0.12, 1.0] }),
      P('hemi', '#80deea', { p: [0, 0.08, 0], s: [0.6, 0.45, 0.6], glow: true }),
      P('torus', '#ff1744', { p: [0, 0, 0], r: [90, 0, 0], s: 1.42, glow: true }),
      P('box', '#455a64', { p: [0, 0.05, 0.75], s: [0.2, 0.1, 0.3] }),
    ];
    case 'queen': return [
      P('sph', c, { p: [0, 0.55, -0.35], s: [0.8, 0.7, 1.0] }),
      P('sph', '#ad1457', { p: [0, 0.65, 0.3], s: 0.55 }),
      P('sph', '#c2185b', { p: [0, 0.85, 0.65], s: 0.4 }),
      P('cone', '#ffd54a', { p: [0.12, 1.1, 0.65], s: [0.08, 0.2, 0.08] }),
      P('cone', '#ffd54a', { p: [-0.12, 1.1, 0.65], s: [0.08, 0.2, 0.08] }),
      P('cone', '#ffd54a', { p: [0, 1.14, 0.65], s: [0.08, 0.22, 0.08] }),
      ...[-1, 1].flatMap(sd => [0.4, 0.1, -0.2].map(z => P('box', '#3e0020', { p: [sd * 0.5, 0.25, z], r: [0, 0, sd * 35], s: [0.5, 0.07, 0.07] }))),
      P('sph', '#f8bbd0', { p: [0, 0.6, -0.35], s: [0.6, 0.2, 0.6], glow: true }),
      eye(0.12, 0.9, 0.82, 0.07, '#76ff03'), eye(-0.12, 0.9, 0.82, 0.07, '#76ff03'),
    ];
  }
  return [P('box', c, { p: [0, 0.4, 0], s: 0.6 })];
}

const enemyCache = new Map();
export function enemyGeometry(type, def) {
  if (enemyCache.has(type)) return enemyCache.get(type);
  const res = split(enemyParts(type, def.color));
  enemyCache.set(type, res);
  return res;
}

// ------------------------------------------------------------------ DEKOR
export function decoGeometry(kind, theme) {
  switch (kind) {
    case 'tree': return split([
      P('cyl6', '#6d4c41', { p: [0, 0.25, 0], s: [0.14, 0.5, 0.14] }),
      P('sphLo', '#2e7d32', { p: [0, 0.75, 0], s: [0.7, 0.6, 0.7] }),
      P('sphLo', '#388e3c', { p: [0.12, 1.05, 0.05], s: [0.45, 0.4, 0.45] }),
    ]);
    case 'pine': return split([
      P('cyl6', '#5d4037', { p: [0, 0.15, 0], s: [0.12, 0.3, 0.12] }),
      P('cone', '#1b5e20', { p: [0, 0.6, 0], s: [0.7, 0.7, 0.7] }),
      P('cone', '#2e7d32', { p: [0, 0.95, 0], s: [0.5, 0.55, 0.5] }),
      P('cone', '#f5f5f5', { p: [0, 1.2, 0], s: [0.25, 0.25, 0.25] }),
    ]);
    case 'cactus': return split([
      P('cyl8', '#558b2f', { p: [0, 0.45, 0], s: [0.22, 0.9, 0.22] }),
      P('cyl8', '#689f38', { p: [0.18, 0.55, 0], r: [0, 0, 0], s: [0.14, 0.4, 0.14] }),
      P('cyl8', '#689f38', { p: [-0.16, 0.45, 0], s: [0.13, 0.35, 0.13] }),
      P('dod', '#bcaaa4', { p: [0.25, 0.08, 0.2], s: 0.2 }),
    ]);
    case 'rock': return split([
      P('dod', '#4e4040', { p: [0, 0.25, 0], s: [0.8, 0.55, 0.7] }),
      P('dod', '#5d4b4b', { p: [0.25, 0.18, 0.2], s: 0.35 }),
      P('dod', '#ff5722', { p: [-0.2, 0.05, 0.25], s: [0.25, 0.08, 0.25], glow: true }),
    ]);
    case 'lamp': return split([
      P('box', '#37474f', { p: [0, 0.2, 0], s: [0.6, 0.4, 0.6] }),
      P('box', '#455a64', { p: [0, 0.75, 0], s: [0.45, 0.7, 0.45] }),
      P('box', '#ffe082', { p: [0.23, 0.8, 0], s: [0.02, 0.12, 0.12], glow: true }),
      P('box', '#ffe082', { p: [0, 0.6, 0.23], s: [0.12, 0.12, 0.02], glow: true }),
      P('cyl8', '#263238', { p: [0.3, 0.9, 0.3], s: [0.04, 1.2, 0.04] }),
      P('sph', '#fff59d', { p: [0.3, 1.5, 0.3], s: 0.14, glow: true }),
    ]);
    case 'crystal': return split([
      P('dod', '#2a1845', { p: [0, 0.1, 0], s: [0.7, 0.25, 0.7] }),
      P('oct', '#00e5ff', { p: [0, 0.55, 0], s: [0.25, 0.9, 0.25], glow: true }),
      P('oct', '#b388ff', { p: [0.2, 0.35, 0.1], r: [0, 0, -25], s: [0.15, 0.5, 0.15], glow: true }),
      P('oct', '#ea80fc', { p: [-0.18, 0.3, -0.1], r: [0, 0, 25], s: [0.14, 0.45, 0.14], glow: true }),
    ]);
  }
  return split([P('dod', '#777', { s: 0.6 })]);
}

// ------------------------------------------------------------------ KARARGAH
export function hqGeometry() {
  return split([
    P('cyl8', '#5f6b7a', { p: [0, 0.2, 0], s: [4.6, 0.4, 4.6] }),
    P('cyl8', '#77849a', { p: [0, 0.45, 0], s: [4.0, 0.15, 4.0] }),
    P('box', '#cfd8dc', { p: [0, 1.1, 0], s: [2.2, 1.3, 2.2] }),
    P('box', '#90a4ae', { p: [0, 1.85, 0], s: [2.4, 0.2, 2.4] }),
    P('cyl8', '#b0bec5', { p: [0, 2.35, 0], s: [1.3, 0.8, 1.3] }),
    P('hemi', '#4fc3f7', { p: [0, 2.75, 0], s: [1.2, 1.0, 1.2], glow: true }),
    ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].flatMap(([a, b]) => [
      P('box', '#90a4ae', { p: [a * 1.25, 1.3, b * 1.25], s: [0.5, 1.9, 0.5] }),
      P('cone4', '#607d8b', { p: [a * 1.25, 2.45, b * 1.25], r: [0, 45, 0], s: [0.6, 0.4, 0.6] }),
      P('box', '#80d8ff', { p: [a * 1.25, 1.6, b * 1.51], s: [0.2, 0.3, 0.02], glow: true }),
    ]),
    P('box', '#37474f', { p: [0, 0.75, 1.12], s: [0.6, 0.6, 0.05] }),
    P('box', '#80d8ff', { p: [0.6, 1.3, 1.11], s: [0.3, 0.2, 0.02], glow: true }),
    P('box', '#80d8ff', { p: [-0.6, 1.3, 1.11], s: [0.3, 0.2, 0.02], glow: true }),
  ]);
}

export function hqGunGeometry() {
  return split([
    P('cyl8', '#455a64', { p: [0, 0, 0], s: [0.7, 0.3, 0.7] }),
    P('box', '#546e7a', { p: [0, 0.25, 0], s: [0.5, 0.3, 0.6] }),
    P('cyl8', '#263238', { p: [0.12, 0.25, 0.55], r: [90, 0, 0], s: [0.1, 0.7, 0.1] }),
    P('cyl8', '#263238', { p: [-0.12, 0.25, 0.55], r: [90, 0, 0], s: [0.1, 0.7, 0.1] }),
    P('box', '#ff5252', { p: [0, 0.42, 0.1], s: [0.2, 0.05, 0.2], glow: true }),
  ]);
}

export function makeMesh(geos, { cast = true, receive = false, ghost = false } = {}) {
  const g = new THREE.Group();
  if (geos.lit) { const m = new THREE.Mesh(geos.lit, ghost ? ghostMaterial : litMaterial); m.castShadow = cast; m.receiveShadow = receive; g.add(m); }
  if (geos.glow) { const m = new THREE.Mesh(geos.glow, glowMaterial); g.add(m); }
  return g;
}

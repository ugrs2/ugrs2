import * as THREE from 'three';

/**
 * Birden fazla parçayı tek BufferGeometry'de birleştirir; her parçaya
 * vertex rengi verir. Flat-shading (low-poly) görünüm için index'siz.
 *
 * parts: [{ geo, color, position?: [x,y,z], rotation?: [x,y,z], scale?: [x,y,z] }]
 */
export function mergeColored(parts) {
  const positions = [];
  const normals = [];
  const colors = [];
  const c = new THREE.Color();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const part of parts) {
    let g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    e.set(...(part.rotation ?? [0, 0, 0]));
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(...(part.position ?? [0, 0, 0])), q, new THREE.Vector3(...(part.scale ?? [1, 1, 1])));
    g.applyMatrix4(m);
    g.deleteAttribute('normal');
    g.computeVertexNormals(); // index'siz -> yüz normali (flat)
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    c.set(part.color);
    for (let i = 0; i < p.length; i++) {
      positions.push(p[i]);
      normals.push(n[i]);
    }
    for (let i = 0; i < p.length / 3; i++) colors.push(c.r, c.g, c.b);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return out;
}

const HALF_PI = Math.PI / 2;

/** Ok: uç (0,0,0)'da, +Z yönünü gösterir, gövde -Z'ye uzanır. Boy ~1. */
export function arrowGeometry() {
  const fin = new THREE.BoxGeometry(0.006, 0.09, 0.2);
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.018, 0.018, 0.86, 5), color: 0x8a5a32, rotation: [HALF_PI, 0, 0], position: [0, 0, -0.55] },
    { geo: new THREE.ConeGeometry(0.055, 0.2, 4), color: 0xd8dde6, rotation: [HALF_PI, 0, 0], position: [0, 0, -0.1] },
    { geo: fin, color: 0xf2efe6, position: [0, 0.045, -0.88] },
    { geo: fin, color: 0xe24b4b, position: [0.039, -0.022, -0.88], rotation: [0, 0, (2 * Math.PI) / 3] },
    { geo: fin, color: 0xe24b4b, position: [-0.039, -0.022, -0.88], rotation: [0, 0, -(2 * Math.PI) / 3] },
  ]);
}

/** Hançer: ağırlık merkezi orijinde (takla atarak dönebilsin), uç +Z. */
export function daggerGeometry() {
  return mergeColored([
    { geo: new THREE.ConeGeometry(0.065, 0.4, 4), color: 0xe3ebf5, rotation: [HALF_PI, 0, 0], position: [0, 0, 0.14], scale: [1, 1, 0.28] },
    { geo: new THREE.BoxGeometry(0.17, 0.035, 0.035), color: 0xb08a3e, position: [0, 0, -0.07] },
    { geo: new THREE.CylinderGeometry(0.018, 0.02, 0.15, 6), color: 0x3b2a48, rotation: [HALF_PI, 0, 0], position: [0, 0, -0.16] },
    { geo: new THREE.OctahedronGeometry(0.03), color: 0xb08a3e, position: [0, 0, -0.25] },
  ]);
}

/** Duman bombası: küre + bant + fitil. */
export function bombGeometry() {
  return mergeColored([
    { geo: new THREE.IcosahedronGeometry(0.2, 1), color: 0x34303f },
    { geo: new THREE.CylinderGeometry(0.205, 0.205, 0.06, 10), color: 0x8a6bd1 },
    { geo: new THREE.CylinderGeometry(0.05, 0.06, 0.08, 6), color: 0x5c5866, position: [0, 0.2, 0] },
    { geo: new THREE.CylinderGeometry(0.012, 0.012, 0.12, 4), color: 0xe9d6a8, position: [0.02, 0.28, 0], rotation: [0, 0, -0.4] },
  ]);
}

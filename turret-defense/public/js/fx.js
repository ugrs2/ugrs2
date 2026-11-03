// Efekt sistemi: parçacıklar, ışınlar, görsel mermiler. Hepsi InstancedMesh havuzlarıyla çizilir.
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

class Pool {
  constructor(scene, geo, mat, cap = 1024) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.n = 0;
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  push(pos, quat, scale, r, g, b) {
    if (this.n >= this.cap) return;
    _m.compose(pos, quat, scale);
    this.mesh.setMatrixAt(this.n, _m);
    this.mesh.setColorAt(this.n, _c.setRGB(r, g, b));
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

const additive = () => new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });

export class FX {
  constructor(scene) {
    const ring = new THREE.RingGeometry(0.88, 1, 48); ring.rotateX(-Math.PI / 2);
    const beam = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const ringMat = additive(); ringMat.side = THREE.DoubleSide;
    this.pools = {
      glow: new Pool(scene, new THREE.IcosahedronGeometry(1, 1), additive(), 1500),
      spark: new Pool(scene, new THREE.BoxGeometry(1, 1, 1), additive(), 2500),
      ring: new Pool(scene, ring, ringMat, 400),
      beam: new Pool(scene, beam, additive(), 1200),
      solid: new Pool(scene, new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.4 }), 600),
    };
    this.parts = [];
    this.beams = [];
    this.projs = [];
    this.frameBeams = [];
  }

  clear() { this.parts.length = 0; this.beams.length = 0; this.projs.length = 0; }

  // ------------------------------------------------------------ oluşturucular
  particle(o) {
    if (this.parts.length > 3000) return;
    this.parts.push({
      pool: o.pool || 'spark', x: o.x, y: o.y ?? 0.5, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      g: o.g ?? 0, life: o.life ?? 0.5, max: o.life ?? 0.5, s0: o.s0 ?? 0.1, s1: o.s1 ?? 0, r: o.r ?? 1, gg: o.gg ?? 1, b: o.b ?? 1,
      fade: o.fade ?? true, pulse: o.pulse || 0, drag: o.drag || 0,
    });
  }

  burst(x, y, z, n, col, speed = 3, life = 0.5, size = 0.1, g = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 0.8 + 0.2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.particle({ x, y, z, vx: Math.cos(a) * sp * u, vy: sp * (0.4 + Math.random()), vz: Math.sin(a) * sp * u, g, life: life * (0.6 + Math.random() * 0.6), s0: size, s1: size * 0.2, r: col[0], gg: col[1], b: col[2], drag: 1.5 });
    }
  }

  explosion(x, z, r, col = [1, 0.55, 0.15], y = 0.3) {
    this.particle({ pool: 'glow', x, y, z, life: 0.35, s0: 0.2 * r, s1: 1.0 * r, r: col[0], gg: col[1], b: col[2] });
    this.particle({ pool: 'glow', x, y, z, life: 0.18, s0: 0.5 * r, s1: 0.2, r: 1, gg: 1, b: 0.9 });
    this.particle({ pool: 'ring', x, y: 0.05, z, life: 0.45, s0: 0.2, s1: r * 1.1, r: col[0] * 0.8, gg: col[1] * 0.8, b: col[2] * 0.8 });
    this.burst(x, y, z, Math.min(30, 8 + r * 8), col, 3 + r * 2, 0.6, 0.08 + r * 0.03);
  }

  ring(x, z, r0, r1, life, col, y = 0.08) {
    this.particle({ pool: 'ring', x, y, z, life, s0: r0, s1: r1, r: col[0], gg: col[1], b: col[2] });
  }

  beam(a, b, w, col, life, jag = 0) {
    if (jag) {
      const n = 4;
      let px = a.x, py = a.y, pz = a.z;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        let nx = a.x + (b.x - a.x) * t, ny = a.y + (b.y - a.y) * t, nz = a.z + (b.z - a.z) * t;
        if (i < n) { nx += (Math.random() - 0.5) * jag; ny += (Math.random() - 0.5) * jag; nz += (Math.random() - 0.5) * jag; }
        this.beams.push({ ax: px, ay: py, az: pz, bx: nx, by: ny, bz: nz, w, r: col[0], g: col[1], b: col[2], life, max: life });
        px = nx; py = ny; pz = nz;
      }
      return;
    }
    this.beams.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, w, r: col[0], g: col[1], b: col[2], life, max: life });
  }

  // Tek karelik ışın (lazer gibi sürekli efektler için)
  frameBeam(a, b, w, col) { this.frameBeams.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, w, r: col[0], g: col[1], b: col[2] }); }

  projectile(o) { this.projs.push(o); }

  // ------------------------------------------------------------ güncelleme
  update(dt, resolve) {
    for (const k in this.pools) this.pools[k].begin();

    // parçacıklar
    const parts = this.parts;
    let w = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.drag) { const f = Math.max(0, 1 - p.drag * dt); p.vx *= f; p.vz *= f; }
      p.vy -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.g > 0) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      const t = 1 - p.life / p.max;
      let s = p.s0 + (p.s1 - p.s0) * t;
      if (p.pulse) s *= 1 + 0.15 * Math.sin(p.life * p.pulse);
      const f = p.fade ? Math.min(1, (p.life / p.max) * 1.5) : 1;
      _p.set(p.x, p.y, p.z);
      _q.identity();
      _s.set(s, s, s);
      this.pools[p.pool].push(_p, _q, _s, p.r * f, p.gg * f, p.b * f);
      parts[w++] = p;
    }
    parts.length = w;

    // ışınlar
    const drawBeam = (bm, f) => {
      _d.set(bm.bx - bm.ax, bm.by - bm.ay, bm.bz - bm.az);
      const len = _d.length();
      if (len < 0.001) return;
      _p.set((bm.ax + bm.bx) / 2, (bm.ay + bm.by) / 2, (bm.az + bm.bz) / 2);
      _q.setFromUnitVectors(UP, _d.divideScalar(len));
      _s.set(bm.w, len, bm.w);
      this.pools.beam.push(_p, _q, _s, bm.r * f, bm.g * f, bm.b * f);
    };
    w = 0;
    for (let i = 0; i < this.beams.length; i++) {
      const bm = this.beams[i];
      bm.life -= dt;
      if (bm.life <= 0) continue;
      drawBeam(bm, bm.life / bm.max);
      this.beams[w++] = bm;
    }
    this.beams.length = w;
    for (const bm of this.frameBeams) drawBeam(bm, 1);
    this.frameBeams.length = 0;

    // görsel mermiler
    w = 0;
    for (let i = 0; i < this.projs.length; i++) {
      const p = this.projs[i];
      if (p.target != null) {
        const t = resolve(p.target);
        if (t) { p.tx = t.x; p.tz = t.z; p.ty = t.y; }
      }
      const dx = p.tx - p.x, dz = p.tz - p.z;
      const dist = Math.hypot(dx, dz);
      const step = p.speed * dt;
      p.life -= dt;
      if (dist <= step || p.life <= 0) {
        if (p.onHit) p.onHit(p);
        continue;
      }
      p.x += dx / dist * step; p.z += dz / dist * step;
      if (p.arc) {
        p.travel += step;
        const t = Math.min(1, p.travel / p.total);
        p.y = p.y0 + (p.ty - p.y0) * t + Math.sin(t * Math.PI) * p.arc;
      } else {
        p.y += (p.ty - p.y) * Math.min(1, dt * 8);
      }
      this.drawProj(p, dx / dist, dz / dist);
      if (p.trail && Math.random() < 0.7) {
        this.particle({ pool: 'glow', x: p.x - dx / dist * 0.2, y: p.y, z: p.z - dz / dist * 0.2, life: 0.35, s0: 0.08, s1: 0.2, r: p.trail[0], gg: p.trail[1], b: p.trail[2] });
      }
      this.projs[w++] = p;
    }
    this.projs.length = w;

    for (const k in this.pools) this.pools[k].end();
  }

  drawProj(p, ux, uz) {
    const c = p.color;
    _p.set(p.x, p.y, p.z);
    switch (p.look) {
      case 'tracer': {
        _d.set(ux, 0, uz);
        _q.setFromUnitVectors(UP, _d);
        _p.set(p.x - ux * 0.18, p.y, p.z - uz * 0.18);
        _s.set(0.035, 0.36, 0.035);
        this.pools.beam.push(_p, _q, _s, c[0], c[1], c[2]);
        break;
      }
      case 'solid':
        _q.identity(); _s.set(p.size, p.size, p.size);
        this.pools.solid.push(_p, _q, _s, c[0], c[1], c[2]);
        break;
      case 'missile': {
        _d.set(ux, 0, uz);
        _q.setFromUnitVectors(UP, _d);
        _s.set(0.06, 0.32, 0.06);
        this.pools.solid.push(_p, _q, _s, 0.9, 0.9, 0.9);
        break;
      }
      default:
        _q.identity(); _s.set(p.size, p.size, p.size);
        this.pools.glow.push(_p, _q, _s, c[0], c[1], c[2]);
    }
  }
}

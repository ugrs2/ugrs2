import * as THREE from 'three';
import { ParticlePool } from './pools/ParticlePool.js';
import { DecalPool } from './pools/DecalPool.js';
import { SlashPool } from './pools/SlashPool.js';
import { ProjectilePool, TrailPool } from './pools/ProjectilePool.js';
import { arrowGeometry, daggerGeometry, bombGeometry } from './geometry.js';
import { SKILLS } from './skills/index.js';

const EMPTY = Object.freeze({});
const rr = (v) => (Array.isArray(v) ? v[0] + Math.random() * (v[1] - v[0]) : v);

const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

/** Eksen etrafında koni içinde (ya da küre/yatay daire) rastgele birim yön. */
function randomDir(out, axis, spread, flat) {
  if (flat) {
    let yaw = Math.random() * Math.PI * 2;
    if (axis && spread < Math.PI) yaw = Math.atan2(axis.z, axis.x) + (Math.random() * 2 - 1) * spread;
    return out.set(Math.cos(yaw), 0, Math.sin(yaw));
  }
  if (!axis || spread >= Math.PI) {
    const z = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    return out.set(s * Math.cos(a), z, s * Math.sin(a));
  }
  const cosT = 1 - Math.random() * (1 - Math.cos(spread));
  const sinT = Math.sqrt(1 - cosT * cosT);
  const phi = Math.random() * Math.PI * 2;
  basis(axis, _t1, _t2);
  return out
    .copy(axis)
    .multiplyScalar(cosT)
    .addScaledVector(_t1, sinT * Math.cos(phi))
    .addScaledVector(_t2, sinT * Math.sin(phi));
}

/** n'e dik iki birim vektör. */
export function basis(n, outA, outB) {
  if (Math.abs(n.y) < 0.99) outA.set(0, 1, 0);
  else outA.set(1, 0, 0);
  outA.cross(n).normalize();
  outB.crossVectors(n, outA);
  return outA;
}

/**
 * Prosedürel (dokusuz) VFX sistemi.
 *
 *   const vfx = new VFXSystem({ scene, camera });
 *   // oyun döngüsünde:
 *   vfx.update(dt);
 *   // yetenek:
 *   vfx.cast('okYagmuru', { from: hero.position, target: mob.position, caster: hero });
 *
 * Toplam draw call sayısı efekt sayısından bağımsızdır (7 adet).
 */
export class VFXSystem {
  constructor({
    scene,
    camera = null,
    unit = 1, // 1 "metre"nin oyundaki karşılığı (kahraman boyu ~1.3 metre varsayılır)
    quality = 1, // 0.25..1 — parçacık sayısı çarpanı (mobil için düşür)
    cull = true, // ekran dışındaki kahramanların efektlerini hiç üretme
    capacity = {},
    cloneFn = null, // art görüntü kopyalayıcı (SkinnedMesh için SkeletonUtils.clone)
  } = {}) {
    this.cloneFn = cloneFn;
    this.scene = scene;
    this.camera = camera;
    this.unit = unit;
    this.quality = quality;
    this.cull = cull;
    this.time = 0;
    this.timeScale = 1;
    this.uniforms = { uTime: { value: 0 } };

    const cap = {
      particles: 24576,
      decals: 1024,
      slashes: 1024,
      trails: 4096,
      arrows: 2048,
      daggers: 1024,
      bombs: 128,
      ...capacity,
    };
    this.particles = new ParticlePool(cap.particles, this.uniforms, unit);
    this.decals = new DecalPool(cap.decals, this.uniforms);
    this.slashes = new SlashPool(cap.slashes, this.uniforms);
    this.trails = new TrailPool(cap.trails, this.uniforms);
    this.projectiles = {
      arrow: new ProjectilePool(arrowGeometry(), cap.arrows, this.uniforms, 'arrows'),
      dagger: new ProjectilePool(daggerGeometry(), cap.daggers, this.uniforms, 'daggers'),
      bomb: new ProjectilePool(bombGeometry(), cap.bombs, this.uniforms, 'bombs'),
    };
    this._pools = [this.particles, this.decals, this.slashes, this.trails, ...Object.values(this.projectiles)];

    this.root = new THREE.Group();
    this.root.name = 'VFX';
    for (const p of this._pools) this.root.add(p.mesh);
    scene.add(this.root);

    this.skills = SKILLS;
    this._tasks = [];
    this._frustum = new THREE.Frustum();
    this._pm = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
    this._shake = { i: 0, end: 0, dur: 1, last: new THREE.Vector3(), camPos: new THREE.Vector3(), applied: false };
    this._updateFrustum();
  }

  _updateFrustum() {
    if (!this.camera) return;
    this.camera.updateMatrixWorld();
    this._pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pm);
  }

  // -------------------------------------------------------------------------
  // Döngü
  // -------------------------------------------------------------------------

  update(dt) {
    this.time += dt * this.timeScale;
    this.uniforms.uTime.value = this.time;

    const tasks = this._tasks;
    for (let i = tasks.length - 1; i >= 0; i--) {
      const task = tasks[i];
      if (this.time < task.start) continue;
      if (task.fn) {
        const span = task.end - task.start;
        task.fn(span > 0 ? Math.min(1, (this.time - task.start) / span) : 1);
      }
      if (this.time >= task.end) {
        tasks[i] = tasks[tasks.length - 1];
        tasks.pop();
        if (task.done) task.done();
      }
    }

    for (const p of this._pools) p.ring.flush(p.geometry);

    this._updateFrustum();
  }

  /** delay saniye sonra fn() çağır (efekt saatine göre; timeScale'e uyar). */
  after(delay, fn) {
    this._tasks.push({ start: this.time + delay, end: this.time + delay, fn: null, done: fn });
  }

  /** duration boyunca her karede fn(k) (k: 0..1), sonunda done(). */
  tween(duration, fn, delay = 0, done = null) {
    this._tasks.push({ start: this.time + delay, end: this.time + delay + duration, fn, done });
  }

  /** Bu noktadaki bir efekt ekranda görünür mü? (yarıçap: dünya birimi) */
  isVisible(p, radius = 0) {
    if (!this.cull || !this.camera) return true;
    this._sphere.center.set(p.x, p.y, p.z);
    this._sphere.radius = radius;
    return this._frustum.intersectsSphere(this._sphere);
  }

  /** a-b doğru parçasını kapsayan küre görünür mü? */
  isVisibleSegment(a, b, pad = 0) {
    if (!this.cull || !this.camera) return true;
    _d.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    const r = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / 2 + pad;
    return this.isVisible(_d, r);
  }

  /** Kaliteye göre parçacık sayısı. */
  n(count) {
    return count <= 0 ? 0 : Math.max(1, Math.round(count * this.quality));
  }

  /** Yetenek çalıştır. Bkz. src/skills/*.js — sonuç: { duration, hits, endPosition? } */
  cast(id, options) {
    const s = this.skills[id];
    if (!s) throw new Error(`Bilinmeyen yetenek: ${id}`);
    return s.fn(this, options);
  }

  // -------------------------------------------------------------------------
  // Kamera sarsıntısı
  // -------------------------------------------------------------------------

  shake(intensity = 0.3, duration = 0.3) {
    const s = this._shake;
    if (this.time < s.end && s.i > intensity) return;
    s.i = intensity * this.unit;
    s.dur = duration;
    s.end = this.time + duration;
  }

  /**
   * Kamerayı konumlandırdıktan SONRA her karede çağırın. Oyun kamerayı her
   * karede yeniden yerleştirmiyorsa bir önceki sarsıntı ofsetini geri alır.
   */
  applyShake(camera = this.camera) {
    const s = this._shake;
    if (s.applied && camera.position.equals(s.camPos)) camera.position.sub(s.last);
    s.applied = false;
    const left = s.end - this.time;
    if (left <= 0) return;
    const k = (left / s.dur) ** 2 * s.i;
    const t = this.time * 60;
    s.last.set(Math.sin(t * 1.13) * k, Math.sin(t * 0.91 + 1.7) * k * 0.6, Math.sin(t * 1.37 + 4.1) * k);
    camera.position.add(s.last);
    s.camPos.copy(camera.position);
    s.applied = true;
  }

  // -------------------------------------------------------------------------
  // Parçacık yardımcıları (hızlar m/sn — unit ile çarpılır)
  // -------------------------------------------------------------------------

  /**
   * Bir noktadan parçacık patlaması.
   * o: speed, dir, spread (rad), flat, up (m/sn), vel (Vector3 m/sn), radius (m),
   *    shell, delay, jitter, sizeMul, life
   */
  burst(P, pos, count, o = EMPTY) {
    const U = this.unit;
    const spread = o.spread ?? Math.PI;
    const radius = (o.radius ?? 0) * U;
    const up = (o.up ?? 0) * U;
    const t0 = this.time + (o.delay ?? 0);
    const jitter = o.jitter ?? 0;
    const sizeMul = o.sizeMul ?? 1;
    const life = o.life ?? -1;
    const vel = o.vel;
    for (let i = 0; i < count; i++) {
      randomDir(_d, o.dir, spread, o.flat);
      const sp = rr(o.speed ?? 0) * U;
      let x = pos.x;
      let y = pos.y;
      let z = pos.z;
      if (radius > 0) {
        randomDir(_r, null, Math.PI, o.flat);
        const k = o.shell ? radius : radius * Math.sqrt(Math.random());
        x += _r.x * k;
        y += _r.y * k;
        z += _r.z * k;
      }
      this.particles.emit(
        P,
        x,
        y,
        z,
        _d.x * sp + (vel ? vel.x * U : 0),
        _d.y * sp + up + (vel ? vel.y * U : 0),
        _d.z * sp + (vel ? vel.z * U : 0),
        t0 + Math.random() * jitter,
        life,
        sizeMul,
      );
    }
  }

  /**
   * Parçacıklar dış çemberden merkeze akar ve tam `time` saniyede varır
   * (preset drag'ı 0 olmalı). o: radius (m), time, delay, jitter, flat, sizeMul
   */
  converge(P, center, count, o = EMPTY) {
    const U = this.unit;
    const R = (o.radius ?? 2) * U;
    const time = o.time ?? 0.4;
    for (let i = 0; i < count; i++) {
      randomDir(_d, null, Math.PI, o.flat);
      if (!o.flat && _d.y < -0.2) _d.y = -_d.y;
      const k = R * (0.6 + 0.4 * Math.random());
      const x = center.x + _d.x * k;
      const y = center.y + _d.y * k;
      const z = center.z + _d.z * k;
      const t0 = this.time + (o.delay ?? 0) + Math.random() * (o.jitter ?? 0);
      this.particles.emit(P, x, y, z, (center.x - x) / time, (center.y - y) / time, (center.z - z) / time, t0, time, o.sizeMul ?? 1);
    }
  }

  /**
   * a'dan b'ye bir çizgi boyunca, zamana yayılmış parçacıklar
   * (ör. bir mermi geçerken arkasında kalan kıvılcımlar).
   * o: t0, t1 (sn gecikme, ilk ve son parçacık), speed, radius (m), up, sizeMul
   */
  line(P, a, b, count, o = EMPTY) {
    const U = this.unit;
    const radius = (o.radius ?? 0) * U;
    const ta = o.t0 ?? 0;
    const tb = o.t1 ?? ta;
    const up = (o.up ?? 0) * U;
    for (let i = 0; i < count; i++) {
      const k = count === 1 ? 0.5 : i / (count - 1);
      randomDir(_d, null, Math.PI, false);
      randomDir(_r, null, Math.PI, false);
      const sp = rr(o.speed ?? 0) * U;
      const rk = radius * Math.random();
      this.particles.emit(
        P,
        a.x + (b.x - a.x) * k + _r.x * rk,
        a.y + (b.y - a.y) * k + _r.y * rk,
        a.z + (b.z - a.z) * k + _r.z * rk,
        _d.x * sp,
        _d.y * sp + up,
        _d.z * sp,
        this.time + ta + (tb - ta) * k,
        -1,
        o.sizeMul ?? 1,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Zemin desenleri, kesikler, mermiler, izler
  // -------------------------------------------------------------------------

  /**
   * Zemin deseni. type: DECAL.*  pos: zemin noktası.
   * o: r0, r1 (m), duration, delay, color, alpha, additive, rot, spin (rad/sn)
   */
  decal(type, pos, o = EMPTY) {
    const U = this.unit;
    const r1 = (o.r1 ?? o.r0 ?? 1) * U;
    const r0 = (o.r0 ?? o.r1 ?? 1) * U;
    const additive = o.additive ?? (type === 3 || type === 4 || type === 5 ? 0 : 1);
    this.decals.emit(
      type,
      pos.x,
      pos.y + 0.03 * U,
      pos.z,
      r0,
      r1,
      this.time + (o.delay ?? 0),
      o.duration ?? 0.5,
      o.color ?? 0xffffff,
      o.alpha ?? 1,
      additive,
      o.rot ?? Math.random() * Math.PI * 2,
      o.spin ?? 0,
    );
  }

  /**
   * Hilal kesik. center: kesiğin merkezi.
   * Düzlem: o.normal (Vector3) ya da o.axisX + o.axisY.
   * o.toward: yayın ortası bu yöne baksın. o.start: başlangıç açısı (rad).
   * o: radius, arc (rad, eksi = ters yön), width (m), delay, duration, color,
   *    intensity, additive (1), growth (0.15)
   */
  slash(center, o = EMPTY) {
    const U = this.unit;
    if (o.axisX && o.axisY) {
      _X.copy(o.axisX);
      _Y.copy(o.axisY);
    } else {
      _t1.copy(o.normal ?? _UP).normalize();
      basis(_t1, _X, _Y);
    }
    const arc = o.arc ?? 2.4;
    let start = o.start ?? Math.random() * Math.PI * 2;
    if (o.toward) start = Math.atan2(o.toward.dot(_Y), o.toward.dot(_X)) - arc / 2;
    this.slashes.emit(
      center.x,
      center.y,
      center.z,
      _X,
      _Y,
      (o.radius ?? 1.2) * U,
      arc,
      (o.width ?? 0.35) * U,
      start,
      this.time + (o.delay ?? 0),
      o.duration ?? 0.22,
      o.additive ?? 1,
      o.growth ?? 0.15,
      o.color ?? 0xffffff,
      o.intensity ?? 1,
    );
  }

  /**
   * Işık izi (mermi olmadan da kullanılabilir: ör. gölge adımı çizgisi).
   * o: delay, duration, arc (m), length (sn), width (m), color, intensity, additive
   */
  trail(from, to, o = EMPTY) {
    const U = this.unit;
    this.trails.emit(
      from,
      to,
      this.time + (o.delay ?? 0),
      o.duration ?? 0.3,
      (o.arc ?? 0) * U,
      o.length ?? 0.1,
      (o.width ?? 0.2) * U,
      o.intensity ?? 1,
      o.additive ?? 1,
      o.color ?? 0xffffff,
    );
  }

  /**
   * 3B mermi (kind: 'arrow' | 'dagger' | 'bomb') + isteğe bağlı izler.
   * o: delay, duration ya da speed (m/sn), arc (m), stick (sn, hedefte saplı kalma),
   *    scale, pitchSpin, rollSpin (rad/sn), emissive, tint, trails: [trail opsiyonları]
   * Dönen değer: varış gecikmesi (sn).
   */
  shoot(kind, from, to, o = EMPTY) {
    const U = this.unit;
    const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const duration = o.duration ?? dist / ((o.speed ?? 25) * U);
    const delay = o.delay ?? 0;
    const arc = (o.arc ?? 0) * U;
    this.projectiles[kind].emit(
      from,
      to,
      this.time + delay,
      duration,
      arc,
      o.stick ?? 0,
      (o.scale ?? 1) * U,
      o.pitchSpin ?? 0,
      o.rollSpin ?? 0,
      o.emissive ?? 0,
      o.tint ?? 0xffffff,
    );
    if (o.trails) {
      for (const tr of o.trails) {
        this.trails.emit(
          from,
          to,
          this.time + delay,
          duration,
          arc,
          tr.length ?? 0.1,
          (tr.width ?? 0.2) * U,
          tr.intensity ?? 1,
          tr.additive ?? 1,
          tr.color ?? 0xffffff,
        );
      }
    }
    return delay + duration;
  }

  /** Mermi yörüngesindeki bir nokta (shader ile birebir aynı formül). */
  pathPoint(from, to, arcMeters, u, out = new THREE.Vector3()) {
    out.lerpVectors(from, to, u);
    out.y += arcMeters * this.unit * 4 * u * (1 - u);
    return out;
  }

  // -------------------------------------------------------------------------
  // Hayalet / art görüntü
  // -------------------------------------------------------------------------

  /**
   * Bir Object3D'nin solan saydam kopyası.
   * o: color, opacity, duration, delay, additive, position, quaternion,
   *    cloneFn (SkinnedMesh için SkeletonUtils.clone verin)
   */
  ghost(object, o = EMPTY) {
    if (!object) return;
    object.updateWorldMatrix(true, true);
    const clone = (o.cloneFn ?? this.cloneFn ?? ((x) => x.clone(true)))(object);
    const mat = new THREE.MeshBasicMaterial({
      color: o.color ?? 0x7a3cff,
      transparent: true,
      opacity: o.opacity ?? 0.5,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    clone.traverse((n) => {
      n.visible = true;
      if (n.isMesh) {
        n.material = mat;
        n.castShadow = false;
        n.receiveShadow = false;
        n.renderOrder = 5;
      }
    });
    object.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    if (o.position) clone.position.copy(o.position);
    if (o.quaternion) clone.quaternion.copy(o.quaternion);
    const base = clone.scale.clone();
    const op = mat.opacity;
    const dur = o.duration ?? 0.45;
    clone.visible = false;
    this.after(o.delay ?? 0, () => {
      clone.visible = true;
      this.scene.add(clone);
    });
    this.tween(
      dur,
      (k) => {
        mat.opacity = op * (1 - k) * (1 - k);
        clone.scale.copy(base).multiplyScalar(1 + 0.12 * k);
      },
      o.delay ?? 0,
      () => {
        this.scene.remove(clone);
        mat.dispose();
      },
    );
  }

  // -------------------------------------------------------------------------

  stats() {
    const now = this.time;
    return {
      particles: this.particles.ring.countAlive(now),
      decals: this.decals.ring.countAlive(now),
      slashes: this.slashes.ring.countAlive(now),
      trails: this.trails.ring.countAlive(now),
      projectiles: Object.values(this.projectiles).reduce((s, p) => s + p.ring.countAlive(now), 0),
      drawCalls: this._pools.length,
      tasks: this._tasks.length,
    };
  }

  dispose() {
    this.scene.remove(this.root);
    for (const p of this._pools) {
      p.geometry.dispose();
      p.material.dispose();
    }
    this._tasks.length = 0;
  }
}

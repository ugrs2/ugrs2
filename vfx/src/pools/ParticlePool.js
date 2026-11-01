import * as THREE from 'three';
import { InstancedRing, instancedFrom, premultipliedBlend, DEAD_VERTEX } from '../core/InstancedRing.js';
import { NOISE_GLSL } from '../core/glsl.js';

/** Parçacık şekilleri — hepsi fragment shader'da SDF/gürültü ile çizilir. */
export const SHAPE = {
  GLOW: 0, // yumuşak parlama noktası
  SPARK: 1, // hıza göre uzayan kıvılcım çizgisi
  RING: 2, // halka
  SMOKE: 3, // gürültülü duman topağı
  STAR: 4, // 4 kollu ışıltı
  SKULL: 5, // kafatası (Ölüm Atışı)
  SHARD: 6, // dönen kırık parçası
  DOT: 7, // sert kenarlı daire (altın, çakıl)
};

// Kayıt düzeni (float): pos(3) vel(3) time(4) col0(4) col1(4) size(4) shape(4) = 26
const STRIDE = 26;

const vertexShader = /* glsl */ `
uniform float uTime;
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aTime;   // başlangıç, ömür, sürtünme, yerçekimi
attribute vec4 aCol0;
attribute vec4 aCol1;
attribute vec4 aSize;   // boyut0, boyut1, açı0, dönüş hızı
attribute vec4 aShape;  // şekil, uzama(sn), tohum, additive

varying vec2 vUv;
varying vec4 vColor;
varying vec3 vMisc;     // şekil, tohum, yaş(0..1)
varying float vAdd;

void main() {
  float t = uTime - aTime.x;
  float life = aTime.y;
  if (t < 0.0 || t > life) { ${DEAD_VERTEX} return; }
  float a = t / life;

  // Analitik hareket: p = p0 + v0 * (1 - e^-kt)/k - g t^2 / 2
  float k = aTime.z;
  float ek = exp(-k * t);
  float f = abs(k) < 1e-3 ? t : (1.0 - ek) / k;
  vec3 p = aPos + aVel * f;
  p.y -= 0.5 * aTime.w * t * t;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float size = mix(aSize.x, aSize.y, a);
  vec2 c = position.xy;

  if (aShape.y > 0.0) {
    // Hız yönünde uzat (motion blur)
    vec3 v = aVel * ek;
    v.y -= aTime.w * t;
    vec2 vd = (modelViewMatrix * vec4(v, 0.0)).xy;
    float sp = length(vd);
    vec2 d = sp > 1e-4 ? vd / sp : vec2(1.0, 0.0);
    c.x *= 1.0 + sp * aShape.y / max(size, 1e-3);
    c = vec2(c.x * d.x - c.y * d.y, c.x * d.y + c.y * d.x);
  } else {
    float r = aSize.z + aSize.w * t;
    float cs = cos(r), sn = sin(r);
    c = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  }

  mv.xy += c * size;
  // Billboard'u kameraya doğru it: yere/karaktere saplanıp düz bir çizgiyle
  // kesilmesin (soft-particle'ın derinlik dokusu gerektirmeyen ucuz hâli).
  mv.z += size * 0.5;
  gl_Position = projectionMatrix * mv;

  vec4 col = mix(aCol0, aCol1, a);
  col.a *= clamp(a * 12.0, 0.0, 1.0); // pat diye belirmesin
  vColor = col;
  vUv = uv;
  vMisc = vec3(aShape.x, aShape.z, a);
  vAdd = aShape.w;
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vMisc;
varying float vAdd;

${NOISE_GLSL}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  int shape = int(vMisc.x + 0.5);
  float age = vMisc.z;
  vec3 col = vColor.rgb;
  float alpha = 0.0;

  if (shape == 0) {            // GLOW
    alpha = exp(-r * r * 5.0) * (1.0 - smoothstep(0.7, 1.0, r));
    col = mix(col, vec3(1.0), exp(-r * r * 28.0) * 0.6);
  } else if (shape == 1) {     // SPARK
    alpha = (1.0 - smoothstep(0.0, 1.0, abs(p.y))) * (1.0 - smoothstep(0.35, 1.0, abs(p.x)));
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.5, abs(p.y))) * 0.7);
  } else if (shape == 2) {     // RING
    float w = 0.08 + 0.22 * (1.0 - age);
    alpha = 1.0 - smoothstep(0.0, w, abs(r - 0.82));
  } else if (shape == 3) {     // SMOKE
    float n = fbm(p * 1.7 + vMisc.y * 37.0 + vec2(age * 0.6, -age * 0.4));
    float d = r + (n - 0.5) * 0.75;
    alpha = 1.0 - smoothstep(0.3, 0.95, d);
    // sahte ışık: sol üstten aydınlat
    float light = clamp(0.9 + 0.45 * dot(p, vec2(-0.45, 0.6)) * (1.0 - r) + (n - 0.5) * 0.45, 0.55, 1.3);
    col *= light;
  } else if (shape == 4) {     // STAR
    float rays = exp(-abs(p.x) * 14.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.y)))
               + exp(-abs(p.y) * 14.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.x)));
    alpha = clamp(rays + exp(-r * r * 14.0), 0.0, 1.0);
    col = mix(col, vec3(1.0), exp(-r * r * 30.0));
  } else if (shape == 5) {     // SKULL
    vec2 q = p * 1.18;
    float head = length(q - vec2(0.0, 0.17)) - 0.6;
    float jaw = sdBox(q - vec2(0.0, -0.42), vec2(0.3, 0.17)) - 0.08;
    float skull = min(head, jaw);
    float eyes = min(length(q - vec2(-0.24, 0.1)) - 0.165, length(q - vec2(0.24, 0.1)) - 0.165);
    float nose = sdBox(q - vec2(0.0, -0.13), vec2(0.035, 0.06)) - 0.02;
    float gap = abs(mod(q.x + 0.085, 0.17) - 0.085) - 0.016;
    float teeth = max(gap, abs(q.y + 0.48) - 0.12);
    float holes = min(min(eyes, nose), teeth);
    float sd = max(skull, -holes);
    float fill = 1.0 - smoothstep(-0.02, 0.02, sd);
    float inEye = 1.0 - smoothstep(-0.02, 0.02, eyes);
    float glow = exp(-max(sd, 0.0) * 9.0) * 0.55;
    vec3 bone = mix(vec3(1.0, 0.97, 0.92), col, 0.18) * (0.85 + 0.25 * (q.y + 0.5));
    col = mix(col * 1.3, bone, fill);
    col = mix(col, col * 0.2 + vColor.rgb * 1.6, inEye);
    alpha = max(max(fill, inEye), glow) * (1.0 - smoothstep(0.9, 1.0, r));
  } else if (shape == 6) {     // SHARD
    float d = abs(p.x) + abs(p.y) * 2.2;
    alpha = 1.0 - smoothstep(0.85, 0.95, d);
    col *= p.x > 0.0 ? 0.7 : 1.15;
  } else {                     // DOT
    alpha = 1.0 - smoothstep(0.75, 0.95, r);
    col *= 1.0 + 0.35 * dot(p, vec2(-0.5, 0.5));
  }

  float a = vColor.a * alpha;
  gl_FragColor = vec4(col * a, a * (1.0 - vAdd));
}
`;

const _c = new THREE.Color();
function resolveColor(hex, out, offset, alpha) {
  _c.set(hex);
  out[offset] = _c.r;
  out[offset + 1] = _c.g;
  out[offset + 2] = _c.b;
  out[offset + 3] = alpha;
}

/** Preset'i bir kez çözümleyip içine önbellek koyar (renkler -> float). */
function resolve(P) {
  const r = { c: new Float32Array(8) };
  resolveColor(P.color ?? 0xffffff, r.c, 0, P.alpha ?? 1);
  resolveColor(P.colorEnd ?? P.color ?? 0xffffff, r.c, 4, P.alphaEnd ?? 0);
  P._r = r;
  return r;
}

const rr = (v) => (Array.isArray(v) ? v[0] + Math.random() * (v[1] - v[0]) : v);

/**
 * GPU parçacık havuzu. Tek draw call. Parçacıklar gelecekteki bir zamanda
 * başlayacak şekilde de yazılabilir (t0 > şimdi) — böylece bir yeteneğin
 * bütün zaman çizelgesi daha cast anında GPU'ya bırakılır.
 */
export class ParticlePool {
  constructor(capacity, uniforms, unit) {
    this.unit = unit;
    const ring = (this.ring = new InstancedRing(STRIDE, capacity));
    this.geometry = instancedFrom(new THREE.PlaneGeometry(1, 1), ring, [
      ['aPos', 3, 0],
      ['aVel', 3, 3],
      ['aTime', 4, 6],
      ['aCol0', 4, 10],
      ['aCol1', 4, 14],
      ['aSize', 4, 18],
      ['aShape', 4, 22],
    ]);
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      ...premultipliedBlend,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 40;
    this.mesh.name = 'vfx.particles';
  }

  /**
   * @param P preset (bkz. README "Parçacık preset'i")
   * x,y,z / vx,vy,vz dünya biriminde. t0 mutlak zaman.
   * life < 0 ise preset'teki ömür kullanılır.
   */
  emit(P, x, y, z, vx, vy, vz, t0, life = -1, sizeMul = 1) {
    const R = P._r || resolve(P);
    const L = life > 0 ? life : rr(P.life ?? 0.5);
    const o = this.ring.alloc(t0 + L);
    const a = this.ring.array;
    const s0 = rr(P.size ?? 0.3) * this.unit * sizeMul;
    a[o] = x;
    a[o + 1] = y;
    a[o + 2] = z;
    a[o + 3] = vx;
    a[o + 4] = vy;
    a[o + 5] = vz;
    a[o + 6] = t0;
    a[o + 7] = L;
    a[o + 8] = P.drag ?? 0;
    a[o + 9] = (P.gravity ?? 0) * this.unit;
    const c = R.c;
    for (let i = 0; i < 8; i++) a[o + 10 + i] = c[i];
    a[o + 18] = s0;
    a[o + 19] = s0 * (P.grow ?? 1);
    a[o + 20] = P.rotate === false ? 0 : Math.random() * 6.2831853;
    a[o + 21] = P.spin ? rr(P.spin) : 0;
    a[o + 22] = P.shape ?? 0;
    a[o + 23] = P.stretch ?? 0;
    a[o + 24] = Math.random();
    a[o + 25] = P.additive ?? 1;
  }
}

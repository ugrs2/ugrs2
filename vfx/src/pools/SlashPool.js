import * as THREE from 'three';
import { InstancedRing, instancedFrom, premultipliedBlend, DEAD_VERTEX } from '../core/InstancedRing.js';

// center(3) axisX(3) axisY(3) params(4: yarıçap, yay açısı, kalınlık, başlangıç açısı)
// timing(4: başl, süre, additive, büyüme) color(4: rgb, yoğunluk) = 21
const STRIDE = 21;
const SEGMENTS = 28;

const vertexShader = /* glsl */ `
uniform float uTime;
attribute vec3 aCenter;
attribute vec3 aAxisX;
attribute vec3 aAxisY;
attribute vec4 aParams;
attribute vec4 aTiming;
attribute vec4 aColor;

varying vec2 vK;      // x: kuyruk(0)->baş(1), y: iç(0)->dış(1)
varying float vFade;
varying vec4 vColor;
varying float vAdd;

void main() {
  float t = uTime - aTiming.x;
  float dur = aTiming.y;
  if (t < 0.0 || t > dur) { ${DEAD_VERTEX} return; }
  float p = t / dur;

  // Baş hızlıca süpürür, kuyruk arkadan yetişir -> hilal "swoosh"
  float head = 1.0 - pow(1.0 - clamp(p / 0.45, 0.0, 1.0), 3.0);
  float tail = 1.0 - pow(1.0 - clamp((p - 0.12) / 0.88, 0.0, 1.0), 2.0);
  float k = position.x;
  float s = mix(tail, head, k);
  float th = aParams.w + s * aParams.y;

  float R = aParams.x * (1.0 + aTiming.w * p);
  float w = aParams.z * pow(sin(k * 3.14159), 0.7) * (0.35 + 0.65 * k);
  float rad = mix(R - w, R, position.y);
  vec3 wp = aCenter + (cos(th) * aAxisX + sin(th) * aAxisY) * rad;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
  vK = position.xy;
  vFade = 1.0 - smoothstep(0.55, 1.0, p);
  vColor = aColor;
  vAdd = aTiming.z;
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vK;
varying float vFade;
varying vec4 vColor;
varying float vAdd;

void main() {
  float edge = pow(vK.y, 4.0);
  float body = 0.25 + 0.45 * vK.y * vK.y;
  float along = pow(vK.x, 0.8);
  float a = clamp((edge + body) * along * vFade, 0.0, 1.0);
  vec3 col = mix(vColor.rgb, vec3(1.0), edge * 0.85 * vAdd);
  col *= vColor.a;
  gl_FragColor = vec4(col * a, a * (1.0 - vAdd));
}
`;

function stripGeometry(segments) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const k = i / segments;
    pos.push(k, 0, 0, k, 1, 0);
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Hilal şeklinde kılıç/hançer kesikleri. Tek draw call. */
export class SlashPool {
  constructor(capacity, uniforms) {
    const ring = (this.ring = new InstancedRing(STRIDE, capacity));
    this.geometry = instancedFrom(stripGeometry(SEGMENTS), ring, [
      ['aCenter', 3, 0],
      ['aAxisX', 3, 3],
      ['aAxisY', 3, 6],
      ['aParams', 4, 9],
      ['aTiming', 4, 13],
      ['aColor', 4, 17],
    ]);
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      ...premultipliedBlend,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.name = 'vfx.slashes';
    this._color = new THREE.Color();
  }

  emit(cx, cy, cz, X, Y, radius, arc, width, startAngle, t0, dur, additive, growth, color, intensity) {
    const o = this.ring.alloc(t0 + dur);
    const a = this.ring.array;
    const c = this._color.set(color);
    a[o] = cx;
    a[o + 1] = cy;
    a[o + 2] = cz;
    a[o + 3] = X.x;
    a[o + 4] = X.y;
    a[o + 5] = X.z;
    a[o + 6] = Y.x;
    a[o + 7] = Y.y;
    a[o + 8] = Y.z;
    a[o + 9] = radius;
    a[o + 10] = arc;
    a[o + 11] = width;
    a[o + 12] = startAngle;
    a[o + 13] = t0;
    a[o + 14] = dur;
    a[o + 15] = additive;
    a[o + 16] = growth;
    a[o + 17] = c.r;
    a[o + 18] = c.g;
    a[o + 19] = c.b;
    a[o + 20] = intensity;
  }
}

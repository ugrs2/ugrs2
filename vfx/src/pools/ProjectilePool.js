import * as THREE from 'three';
import { InstancedRing, instancedFrom, premultipliedBlend, DEAD_VERTEX } from '../core/InstancedRing.js';
import { PATH_GLSL } from '../core/glsl.js';

// ---------------------------------------------------------------------------
// Uçan 3B modeller (ok, hançer, bomba). Yörünge GPU'da hesaplanır.
// start(3) end(3) timing(4: başl, süre, kavis, saplanma) style(4: ölçek, takla, yuvarlanma, ışıma) tint(4) = 18
// ---------------------------------------------------------------------------
const P_STRIDE = 18;

const projVertex = /* glsl */ `
uniform float uTime;
attribute vec3 color;
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec4 aTiming;
attribute vec4 aStyle;
attribute vec4 aTint;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vEm;

${PATH_GLSL}

vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 rotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }

void main() {
  float t = uTime - aTiming.x;
  float dur = aTiming.y;
  float stick = aTiming.w;
  if (t < 0.0 || t > dur + stick) { ${DEAD_VERTEX} return; }
  float u = clamp(t / dur, 0.0, 1.0);
  vec3 P = pathPos(aStart, aEnd, aTiming.z, u);
  vec3 T = normalize(pathTan(aStart, aEnd, aTiming.z, u));
  vec3 ref = abs(T.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 R = normalize(cross(ref, T));
  vec3 U = cross(T, R);

  float tm = min(t, dur);
  float shrink = 1.0 - smoothstep(dur + stick * 0.6, dur + stick, t);
  vec3 lp = rotX(rotZ(position, aStyle.z * tm), aStyle.y * tm) * aStyle.x * shrink;
  vec3 ln = rotX(rotZ(normal, aStyle.z * tm), aStyle.y * tm);

  vec3 wp = P + R * lp.x + U * lp.y + T * lp.z;
  vN = normalize(R * ln.x + U * ln.y + T * ln.z);
  vCol = color;
  vEm = aTint.rgb * aStyle.w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
}
`;

const projFragment = /* glsl */ `
varying vec3 vCol;
varying vec3 vN;
varying vec3 vEm;
void main() {
  vec3 L = normalize(vec3(0.35, 1.0, 0.45));
  float d = max(dot(normalize(vN), L), 0.0);
  gl_FragColor = vec4(vCol * (0.5 + 0.7 * d) + vEm, 1.0);
}
`;

export class ProjectilePool {
  constructor(geometry, capacity, uniforms, name) {
    const ring = (this.ring = new InstancedRing(P_STRIDE, capacity));
    this.geometry = instancedFrom(geometry, ring, [
      ['aStart', 3, 0],
      ['aEnd', 3, 3],
      ['aTiming', 4, 6],
      ['aStyle', 4, 10],
      ['aTint', 4, 14],
    ]);
    this.material = new THREE.ShaderMaterial({ uniforms, vertexShader: projVertex, fragmentShader: projFragment });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = `vfx.${name}`;
    this._color = new THREE.Color();
  }

  emit(a0, b0, t0, dur, arc, stick, scale, pitchSpin, rollSpin, emissive, tint) {
    const o = this.ring.alloc(t0 + dur + stick);
    const a = this.ring.array;
    const c = this._color.set(tint);
    a[o] = a0.x;
    a[o + 1] = a0.y;
    a[o + 2] = a0.z;
    a[o + 3] = b0.x;
    a[o + 4] = b0.y;
    a[o + 5] = b0.z;
    a[o + 6] = t0;
    a[o + 7] = dur;
    a[o + 8] = arc;
    a[o + 9] = stick;
    a[o + 10] = scale;
    a[o + 11] = pitchSpin;
    a[o + 12] = rollSpin;
    a[o + 13] = emissive;
    a[o + 14] = c.r;
    a[o + 15] = c.g;
    a[o + 16] = c.b;
    a[o + 17] = 1;
  }
}

// ---------------------------------------------------------------------------
// Işık izleri (ribbon). Mermiyle aynı yörünge fonksiyonunu izler; kavisli olabilir.
// start(3) end(3) timing(4: başl, süre, kavis, iz uzunluğu sn) style(4: genişlik, yoğunluk, additive, -) color(4) = 18
// ---------------------------------------------------------------------------
const T_STRIDE = 18;
const T_SEGMENTS = 10;

const trailVertex = /* glsl */ `
uniform float uTime;
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec4 aTiming;
attribute vec4 aStyle;
attribute vec4 aColor;
varying vec2 vS;     // x: baş(0)->kuyruk(1), y: -1..1 kenar
varying vec4 vColor;
varying float vAdd;

${PATH_GLSL}

void main() {
  float t = uTime - aTiming.x;
  float dur = aTiming.y;
  float L = aTiming.w;
  if (t < 0.0 || t - L > dur) { ${DEAD_VERTEX} return; }
  float th = clamp(t, 0.0, dur);
  float tt = clamp(t - L, 0.0, dur);
  float u = mix(th, tt, position.x) / dur;
  vec3 P = pathPos(aStart, aEnd, aTiming.z, u);
  vec3 T = normalize(pathTan(aStart, aEnd, aTiming.z, u));
  vec3 V = normalize(cameraPosition - P);
  vec3 S = cross(T, V);
  float sl = length(S);
  S = sl > 1e-4 ? S / sl : vec3(1.0, 0.0, 0.0);
  float w = aStyle.x * (1.0 - position.x * 0.9) * 0.5;
  P += S * position.y * w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0);
  vS = position.xy;
  vColor = vec4(aColor.rgb, aStyle.y);
  vAdd = aStyle.z;
}
`;

const trailFragment = /* glsl */ `
varying vec2 vS;
varying vec4 vColor;
varying float vAdd;
void main() {
  float core = 1.0 - abs(vS.y);
  float along = 1.0 - vS.x;
  float a = clamp(pow(along, 1.4) * smoothstep(0.0, 0.7, core), 0.0, 1.0);
  vec3 col = mix(vColor.rgb, vec3(1.0), pow(core, 4.0) * along * 0.8 * vAdd);
  gl_FragColor = vec4(col * a * vColor.a, a * (1.0 - vAdd));
}
`;

function ribbonGeometry(segments) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const k = i / segments;
    pos.push(k, -1, 0, k, 1, 0);
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

export class TrailPool {
  constructor(capacity, uniforms) {
    const ring = (this.ring = new InstancedRing(T_STRIDE, capacity));
    this.geometry = instancedFrom(ribbonGeometry(T_SEGMENTS), ring, [
      ['aStart', 3, 0],
      ['aEnd', 3, 3],
      ['aTiming', 4, 6],
      ['aStyle', 4, 10],
      ['aColor', 4, 14],
    ]);
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: trailVertex,
      fragmentShader: trailFragment,
      ...premultipliedBlend,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'vfx.trails';
    this._color = new THREE.Color();
  }

  emit(a0, b0, t0, dur, arc, length, width, intensity, additive, color) {
    const o = this.ring.alloc(t0 + dur + length);
    const a = this.ring.array;
    const c = this._color.set(color);
    a[o] = a0.x;
    a[o + 1] = a0.y;
    a[o + 2] = a0.z;
    a[o + 3] = b0.x;
    a[o + 4] = b0.y;
    a[o + 5] = b0.z;
    a[o + 6] = t0;
    a[o + 7] = dur;
    a[o + 8] = arc;
    a[o + 9] = length;
    a[o + 10] = width;
    a[o + 11] = intensity;
    a[o + 12] = additive;
    a[o + 13] = 0;
    a[o + 14] = c.r;
    a[o + 15] = c.g;
    a[o + 16] = c.b;
    a[o + 17] = 1;
  }
}

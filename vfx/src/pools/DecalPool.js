import * as THREE from 'three';
import { InstancedRing, instancedFrom, premultipliedBlend, DEAD_VERTEX } from '../core/InstancedRing.js';
import { NOISE_GLSL } from '../core/glsl.js';

/** Zemine yatık çizilen prosedürel desenler. */
export const DECAL = {
  SHOCKWAVE: 0, // genişleyen şok dalgası halkası
  AOE: 1, // alan hedef göstergesi (dolan daire)
  RUNE: 2, // dönen büyü çemberi (heksagram + rün bandı)
  SCORCH: 3, // yanık izi + çatlaklar
  SOFT: 4, // yumuşak leke (duman gölgesi, toz)
  VORTEX: 5, // gölge girdabı
};

// center(3) params(4: r0, r1, tip, dönüş hızı) timing(4: başl, süre, açı0, tohum) color(4) extra(1: additive) = 16
const STRIDE = 16;

const vertexShader = /* glsl */ `
uniform float uTime;
attribute vec3 aCenter;
attribute vec4 aParams;
attribute vec4 aTiming;
attribute vec4 aColor;
attribute float aAdd;

varying vec2 vP;
varying vec4 vColor;
varying vec4 vInfo; // tip, yaş(0..1), geçen sn, tohum
varying float vAdd;

void main() {
  float t = uTime - aTiming.x;
  float dur = aTiming.y;
  if (t < 0.0 || t > dur) { ${DEAD_VERTEX} return; }
  float a = t / dur;
  float e = 1.0 - pow(1.0 - a, 3.0);
  float R = mix(aParams.x, aParams.y, e);
  float ang = aTiming.z + aParams.w * t;
  float c = cos(ang), s = sin(ang);
  vec2 q = position.xy;
  vec2 rq = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * R;
  vec3 wp = aCenter + vec3(rq.x, 0.0, -rq.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
  vP = q;
  vColor = aColor;
  vInfo = vec4(aParams.z, a, t, aTiming.w);
  vAdd = aAdd;
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vP;
varying vec4 vColor;
varying vec4 vInfo;
varying float vAdd;

${NOISE_GLSL}

const float TAU = 6.2831853;

void main() {
  int type = int(vInfo.x + 0.5);
  float a = vInfo.y;
  float T = vInfo.z;
  float seed = vInfo.w;
  vec2 p = vP;
  float r = length(p);
  if (r > 1.0) { gl_FragColor = vec4(0.0); return; }
  float ang = atan(p.y, p.x);
  vec3 col = vColor.rgb;
  float alpha = 0.0;
  float fin = smoothstep(0.0, 0.12, a);
  float fout = 1.0 - smoothstep(0.75, 1.0, a);

  if (type == 0) {            // SHOCKWAVE
    float w = mix(0.28, 0.05, a);
    float band = (1.0 - smoothstep(0.965, 1.0, r)) * smoothstep(1.0 - w, 0.985, r);
    alpha = band * band * pow(1.0 - a, 1.6) * 0.9;
    col = mix(col, vec3(1.0), smoothstep(0.93, 0.99, r) * 0.5 * (1.0 - a));
  } else if (type == 1) {     // AOE
    float border = 1.0 - smoothstep(0.0, 0.035, abs(r - 0.955));
    float dash = step(0.5, fract(ang / TAU * 28.0 + T * 0.6)) * (1.0 - smoothstep(0.0, 0.022, abs(r - 0.86)));
    float grow = (1.0 - smoothstep(a - 0.03, a, r)) * 0.22;           // içten dışa dolan ilerleme
    float front = (1.0 - smoothstep(0.0, 0.03, abs(r - a))) * 0.6;     // dolum cephesi
    alpha = (border + dash * 0.7 + 0.1 + grow + front) * fin * (1.0 - smoothstep(0.9, 1.0, a));
  } else if (type == 2) {     // RUNE
    float ring1 = 1.0 - smoothstep(0.0, 0.025, abs(r - 0.95));
    float ring2 = 1.0 - smoothstep(0.0, 0.018, abs(r - 0.79));
    float ring3 = 1.0 - smoothstep(0.0, 0.014, abs(r - 0.4));
    float u = (ang / TAU + 0.5) * 30.0;
    float h = hash12(vec2(floor(u), seed * 17.0));
    float lu = fract(u);
    float band = step(0.82, r) * step(r, 0.92);
    float glyph = band * step(0.3, h) * step(0.18, lu) * step(lu, 0.82)
                * step(0.45, fract((r - 0.82) * 28.0 + h * 2.0));
    float lines = 0.0;
    for (int i = 0; i < 6; i++) {
      float th = 1.5707963 + float(i) * 1.0471976;
      lines += 1.0 - smoothstep(0.0, 0.014, abs(dot(p, vec2(cos(th), sin(th))) - 0.395));
    }
    lines *= step(r, 0.79);
    float pulse = 0.8 + 0.2 * sin(T * 9.0);
    alpha = (ring1 + ring2 * 0.8 + ring3 * 0.6 + glyph * 0.9 + min(lines, 1.0) * 0.75 + (1.0 - r) * 0.12)
          * fin * fout * pulse;
  } else if (type == 3) {     // SCORCH
    float n = fbm(p * 3.0 + seed * 10.0);
    float blot = 1.0 - smoothstep(0.35, 1.0, r + (n - 0.5) * 0.6);
    float ca = ang / TAU * 9.0 + fbm(p * 4.0 + seed * 3.0) * 1.3;
    float cracks = (1.0 - smoothstep(0.0, 0.07, abs(fract(ca) - 0.5) * (0.4 + r)))
                 * (1.0 - smoothstep(0.25, 0.95, r));
    float ember = cracks * (1.0 - smoothstep(0.0, 0.45, a));
    col = mix(vec3(0.05, 0.035, 0.04), vColor.rgb * 1.4, ember);
    alpha = max(blot * 0.7, cracks * 0.9) * smoothstep(0.0, 0.04, a) * (1.0 - smoothstep(0.55, 1.0, a));
  } else if (type == 4) {     // SOFT
    float n = fbm(p * 2.4 + seed * 7.0 + T * 0.12);
    alpha = (1.0 - smoothstep(0.15, 1.0, r + (n - 0.5) * 0.55)) * fin * fout;
  } else {                    // VORTEX
    float sw = sin(ang * 3.0 + r * 10.0 - T * 8.0) * 0.5 + 0.5;
    float disk = 1.0 - smoothstep(0.45, 1.0, r);
    float rim = smoothstep(0.55, 0.95, sw) * smoothstep(0.15, 0.85, r);
    col = mix(vColor.rgb * 0.08, vColor.rgb * 1.3, rim);
    alpha = disk * (0.6 + 0.4 * sw) * fin * fout;
  }

  float al = clamp(alpha, 0.0, 1.0) * vColor.a;
  gl_FragColor = vec4(col * al, al * (1.0 - vAdd));
}
`;

export class DecalPool {
  constructor(capacity, uniforms) {
    const ring = (this.ring = new InstancedRing(STRIDE, capacity));
    this.geometry = instancedFrom(new THREE.PlaneGeometry(2, 2), ring, [
      ['aCenter', 3, 0],
      ['aParams', 4, 3],
      ['aTiming', 4, 7],
      ['aColor', 4, 11],
      ['aAdd', 1, 15],
    ]);
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      ...premultipliedBlend,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'vfx.decals';
    this._color = new THREE.Color();
  }

  emit(type, x, y, z, r0, r1, t0, dur, color, alpha, additive, rot, spin) {
    const o = this.ring.alloc(t0 + dur);
    const a = this.ring.array;
    const c = this._color.set(color);
    a[o] = x;
    a[o + 1] = y;
    a[o + 2] = z;
    a[o + 3] = r0;
    a[o + 4] = r1;
    a[o + 5] = type;
    a[o + 6] = spin;
    a[o + 7] = t0;
    a[o + 8] = dur;
    a[o + 9] = rot;
    a[o + 10] = Math.random();
    a[o + 11] = c.r;
    a[o + 12] = c.g;
    a[o + 13] = c.b;
    a[o + 14] = alpha;
    a[o + 15] = additive;
  }
}

// Ortak GLSL parçaları: doku yerine gürültü fonksiyonları.

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v / 0.875;
}
`;

// Bir mermi/iz yörüngesi: düz çizgi + parabolik kavis (arc = tepe yüksekliği).
export const PATH_GLSL = /* glsl */ `
vec3 pathPos(vec3 a, vec3 b, float arc, float u) {
  return mix(a, b, u) + vec3(0.0, arc * 4.0 * u * (1.0 - u), 0.0);
}
vec3 pathTan(vec3 a, vec3 b, float arc, float u) {
  return (b - a) + vec3(0.0, arc * 4.0 * (1.0 - 2.0 * u), 0.0);
}
`;

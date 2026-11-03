// Harita üretimi: ortada karargah, 4 yönden gelen kıvrımlı koridorlar.
// Hücre merkezleri tam sayı koordinatlardadır: x,z ∈ [-HALF, HALF].

export const HALF = 17;
export const SIZE = HALF * 2 + 1;
export const HQ_R = 2; // karargah |x|,|z| <= 2

export const CELL = { EMPTY: 0, PATH: 1, HQ: 2, BLOCK: 3 };

// Kuzey koridoru için yol noktaları (merkeze göre). Diğer koridorlar 90° döndürülerek elde edilir.
// Tüm noktalar |dx| <= -dz-1 kaması içinde kalır, böylece koridorlar kesişmez.
export const TEMPLATES = {
  A: [[0, -17], [0, -15], [-8, -15], [-8, -11], [6, -11], [6, -7], [-3, -7], [-3, -4], [0, -4], [0, -3]],
  B: [[0, -17], [0, -14], [9, -14], [9, -10], [-5, -10], [-5, -6], [3, -6], [3, -4], [0, -4], [0, -3]],
  C: [[0, -17], [0, -16], [-11, -16], [-11, -13], [10, -13], [10, -11], [-8, -11], [-8, -9], [6, -9], [6, -7], [-4, -7], [-4, -5], [0, -5], [0, -3]],
};

export function rotate(p, k) {
  let [x, z] = p;
  for (let i = 0; i < k; i++) { const nx = -z; z = x; x = nx; }
  return [x + 0, z + 0];
}

export function idx(x, z) { return (z + HALF) * SIZE + (x + HALF); }
export function inGrid(x, z) { return x >= -HALF && x <= HALF && z >= -HALF && z <= HALF; }

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makePath(points) {
  const pts = points.map(([x, z]) => ({ x, z }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  return { pts, cum, len: cum[cum.length - 1] };
}

// Yol üzerinde d mesafesindeki nokta ve yön
export function pointAt(path, d, out) {
  out = out || {};
  const { pts, cum } = path;
  if (d <= 0) { out.x = pts[0].x; out.z = pts[0].z; seg(out, pts[0], pts[1]); return out; }
  if (d >= path.len) { const n = pts.length; out.x = pts[n - 1].x; out.z = pts[n - 1].z; seg(out, pts[n - 2], pts[n - 1]); return out; }
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
  const a = pts[lo], b = pts[lo + 1];
  const t = (d - cum[lo]) / (cum[lo + 1] - cum[lo] || 1);
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  seg(out, a, b);
  return out;
}
function seg(out, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
  out.dx = dx / l; out.dz = dz / l;
}

export function buildMap(templateId, lanes, seed) {
  const tpl = TEMPLATES[templateId] || TEMPLATES.A;
  const grid = new Uint8Array(SIZE * SIZE);
  const deco = []; // {x,z,v}
  const paths = {};
  const airPaths = {};

  for (let x = -HQ_R; x <= HQ_R; x++) for (let z = -HQ_R; z <= HQ_R; z++) grid[idx(x, z)] = CELL.HQ;

  for (const lane of lanes) {
    const raw = [[0, -HALF - 3], ...tpl].map(p => rotate(p, lane));
    for (let i = 1; i < raw.length; i++) {
      const [ax, az] = raw[i - 1], [bx, bz] = raw[i];
      const steps = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(ax + (bx - ax) * s / steps), z = Math.round(az + (bz - az) * s / steps);
        if (inGrid(x, z) && grid[idx(x, z)] !== CELL.HQ) grid[idx(x, z)] = CELL.PATH;
      }
    }
    paths[lane] = makePath(raw);
    airPaths[lane] = makePath([rotate([-7, -HALF - 3], lane), rotate([-7, -9], lane), rotate([-1.2, -2.6], lane)]);
  }

  // Engeller (dekor)
  const rnd = mulberry32(seed || 1);
  for (let z = -HALF; z <= HALF; z++) {
    for (let x = -HALF; x <= HALF; x++) {
      if (grid[idx(x, z)] !== CELL.EMPTY) continue;
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!inGrid(x + dx, z + dz)) continue;
        const c = grid[idx(x + dx, z + dz)];
        if (c === CELL.PATH || c === CELL.HQ) { near = true; break; }
      }
      const edge = Math.max(Math.abs(x), Math.abs(z)) >= HALF - 1;
      const p = near ? 0 : edge ? 0.22 : 0.06;
      if (rnd() < p) {
        grid[idx(x, z)] = CELL.BLOCK;
        deco.push({ x, z, v: Math.floor(rnd() * 1000) });
      }
    }
  }

  return { half: HALF, size: SIZE, grid, paths, airPaths, lanes: lanes.slice(), deco };
}

export function cellAt(map, x, z) {
  if (!inGrid(x, z)) return -1;
  return map.grid[idx(x, z)];
}

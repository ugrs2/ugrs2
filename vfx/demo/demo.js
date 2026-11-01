import * as THREE from 'three';
import { VFXSystem, SKILLS, DECAL, mergeColored, SFXPlayer } from '../src/index.js';

// ---------------------------------------------------------------------------
// Sahne
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const FOG = 0x5a6b5f;
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.Fog(FOG, 45, 130);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 400);
const NORMAL_CAM = { target: new THREE.Vector3(0, 0, 0.8), offset: new THREE.Vector3(0, 16, 10.5) };
const STRESS_CAM = { target: new THREE.Vector3(0, 0, 4), offset: new THREE.Vector3(0, 52, 34) };
const cam = {
  target: NORMAL_CAM.target.clone(),
  offset: NORMAL_CAM.offset.clone(),
  wantTarget: NORMAL_CAM.target.clone(),
  wantOffset: NORMAL_CAM.offset.clone(),
};

scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x45523f, 1.25));
const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
sun.position.set(14, 26, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
setShadowBounds(22);
scene.add(sun, sun.target);

function setShadowBounds(s) {
  const c = sun.shadow.camera;
  c.left = -s;
  c.right = s;
  c.top = s;
  c.bottom = -s;
  c.near = 1;
  c.far = 90;
  c.updateProjectionMatrix();
}

// --- prosedürel zemin (vertex renkli, doku yok) ---
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < 4; i++) {
    s += a * vnoise(x, y);
    x *= 2.03;
    y *= 2.03;
    a *= 0.5;
  }
  return s / 0.9375;
}
{
  const g = new THREE.PlaneGeometry(260, 260, 130, 130);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const cols = [];
  const dark = new THREE.Color(0x4a5a4d);
  const mid = new THREE.Color(0x617366);
  const light = new THREE.Color(0x7a8473);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n = fbm(x * 0.06, z * 0.06);
    const m = fbm(x * 0.21 + 40, z * 0.21 - 13);
    c.copy(dark).lerp(mid, THREE.MathUtils.smoothstep(n, 0.3, 0.6)).lerp(light, THREE.MathUtils.smoothstep(m, 0.62, 0.8) * 0.6);
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  ground.receiveShadow = true;
  scene.add(ground);
}

// --- toplu test kamp yerleşimi (ağaçlar buralara girmesin) ---
const CAMPS = [];
for (let gx = 0; gx < 6; gx++) for (let gz = 0; gz < 5; gz++) CAMPS.push(new THREE.Vector3((gx - 2.5) * 11.5, 0, (gz - 2) * 11.5));

// --- çam ağaçları (InstancedMesh) ---
{
  const treeGeo = mergeColored([
    { geo: new THREE.CylinderGeometry(0.16, 0.24, 0.9, 5), color: 0x5b3d2a, position: [0, 0.45, 0] },
    { geo: new THREE.ConeGeometry(1.35, 1.7, 7), color: 0x2d6a3e, position: [0, 1.55, 0] },
    { geo: new THREE.ConeGeometry(1.05, 1.45, 7), color: 0x34784a, position: [0, 2.35, 0] },
    { geo: new THREE.ConeGeometry(0.72, 1.2, 7), color: 0x3d8753, position: [0, 3.05, 0] },
  ]);
  const N = 420;
  const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), N);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  let placed = 0;
  let guard = 0;
  while (placed < N && guard++ < 20000) {
    const a = Math.random() * Math.PI * 2;
    const r = 11 + Math.random() * 95;
    p.set(Math.cos(a) * r, 0, Math.sin(a) * r * 0.85);
    if (Math.abs(p.x) < 9 && p.z > -12 && p.z < 9) continue; // arena
    if (CAMPS.some((c) => c.distanceTo(p) < 5.2)) continue;
    const k = 0.8 + Math.random() * 0.7;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    m.compose(p, q, s.set(k, k * (0.85 + Math.random() * 0.3), k));
    trees.setMatrixAt(placed, m);
    trees.setColorAt(placed, col.setHSL(0.36 + Math.random() * 0.05, 0.35, 0.45 + Math.random() * 0.15).multiplyScalar(2.1));
    placed++;
  }
  trees.count = placed;
  trees.castShadow = true;
  trees.receiveShadow = true;
  scene.add(trees);

  const rockGeo = mergeColored([{ geo: new THREE.IcosahedronGeometry(0.6, 0), color: 0x8a8f88, scale: [1, 0.6, 1] }]);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 80);
  for (let i = 0; i < 80; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 80;
    p.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
    const k = 0.4 + Math.random() * 1.1;
    q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, Math.random()));
    m.compose(p, q, s.set(k, k, k));
    rocks.setMatrixAt(i, m);
  }
  rocks.castShadow = true;
  scene.add(rocks);
}

// ---------------------------------------------------------------------------
// Low-poly karakterler (tek mesh, vertex renkli)
// ---------------------------------------------------------------------------
const HALF = Math.PI / 2;
const archerGeo = mergeColored([
  { geo: new THREE.BoxGeometry(0.34, 0.42, 0.22), color: 0x4a3626, position: [0, 0.21, 0] },
  { geo: new THREE.CylinderGeometry(0.25, 0.31, 0.58, 7), color: 0x2fb3a3, position: [0, 0.7, 0] },
  { geo: new THREE.CylinderGeometry(0.32, 0.32, 0.07, 7), color: 0x6b4423, position: [0, 0.46, 0] },
  { geo: new THREE.IcosahedronGeometry(0.23, 1), color: 0xe9b48c, position: [0, 1.15, 0] },
  { geo: new THREE.CylinderGeometry(0.4, 0.4, 0.04, 10), color: 0x241f2c, position: [0, 1.28, 0] },
  { geo: new THREE.ConeGeometry(0.25, 0.48, 7), color: 0x2a2433, position: [0, 1.52, 0] },
  { geo: new THREE.TorusGeometry(0.42, 0.035, 4, 12, Math.PI), color: 0x8a5a2b, position: [0.36, 0.82, 0.18], rotation: [0, HALF, -HALF] },
  { geo: new THREE.BoxGeometry(0.01, 0.84, 0.01), color: 0xf3ead8, position: [0.36, 0.82, 0.18] },
  { geo: new THREE.CylinderGeometry(0.09, 0.08, 0.5, 6), color: 0x7a4b28, position: [-0.12, 0.85, -0.27], rotation: [0.35, 0, 0.3] },
]);
const assassinGeo = mergeColored([
  { geo: new THREE.BoxGeometry(0.34, 0.42, 0.22), color: 0x221b2e, position: [0, 0.21, 0] },
  { geo: new THREE.CylinderGeometry(0.24, 0.32, 0.6, 7), color: 0x3d2c63, position: [0, 0.7, 0] },
  { geo: new THREE.CylinderGeometry(0.25, 0.27, 0.11, 7), color: 0xc0392b, position: [0, 0.98, 0] },
  { geo: new THREE.IcosahedronGeometry(0.22, 1), color: 0xe9b48c, position: [0, 1.17, 0.02] },
  { geo: new THREE.IcosahedronGeometry(0.28, 1), color: 0x2a1f45, position: [0, 1.22, -0.06], scale: [1, 1.05, 1.05] },
  { geo: new THREE.BoxGeometry(0.34, 0.1, 0.1), color: 0x1a1426, position: [0, 1.1, 0.19] },
  { geo: new THREE.BoxGeometry(0.42, 0.75, 0.03), color: 0x2a1f45, position: [0, 0.68, -0.3], rotation: [0.15, 0, 0] },
  { geo: new THREE.BoxGeometry(0.04, 0.04, 0.38), color: 0xdfe8f2, position: [0.36, 0.62, 0.2] },
  { geo: new THREE.BoxGeometry(0.04, 0.04, 0.38), color: 0xdfe8f2, position: [-0.36, 0.62, 0.2] },
]);
const creatureGeo = mergeColored([
  { geo: new THREE.IcosahedronGeometry(0.58, 0), color: 0x7c4fd8, position: [0, 0.52, 0], scale: [1, 0.85, 1] },
  { geo: new THREE.ConeGeometry(0.09, 0.32, 5), color: 0xf2ece0, position: [0.26, 0.98, 0.08], rotation: [0.2, 0, -0.45] },
  { geo: new THREE.ConeGeometry(0.09, 0.32, 5), color: 0xf2ece0, position: [-0.26, 0.98, 0.08], rotation: [0.2, 0, 0.45] },
  { geo: new THREE.IcosahedronGeometry(0.11, 0), color: 0xfafafa, position: [0.19, 0.62, 0.44] },
  { geo: new THREE.IcosahedronGeometry(0.11, 0), color: 0xfafafa, position: [-0.19, 0.62, 0.44] },
  { geo: new THREE.IcosahedronGeometry(0.055, 0), color: 0x16121c, position: [0.2, 0.62, 0.53] },
  { geo: new THREE.IcosahedronGeometry(0.055, 0), color: 0x16121c, position: [-0.2, 0.62, 0.53] },
  { geo: new THREE.BoxGeometry(0.2, 0.12, 0.24), color: 0x5a3aa0, position: [0.25, 0.06, 0.05] },
  { geo: new THREE.BoxGeometry(0.2, 0.12, 0.24), color: 0x5a3aa0, position: [-0.25, 0.06, 0.05] },
]);
const heroMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const ringGeo = new THREE.RingGeometry(0.62, 0.72, 32).rotateX(-HALF);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x6fe6ff, transparent: true, opacity: 0.55, depthWrite: false });
const selMat = new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.8, depthWrite: false });

const heroes = [];
const creatures = [];

function makeHero(role, pos, main) {
  const obj = new THREE.Group();
  const mesh = new THREE.Mesh(role === 'okcu' ? archerGeo : assassinGeo, heroMat);
  mesh.castShadow = main;
  obj.add(mesh);
  obj.position.copy(pos);
  scene.add(obj);
  let ring = null;
  if (main) {
    ring = new THREE.Mesh(ringGeo, ringMat);
    ring.renderOrder = 1;
    scene.add(ring);
  }
  const h = { role, obj, ring, home: pos.clone(), busy: false, main, next: 1 + Math.random() * 3 };
  heroes.push(h);
  return h;
}

function makeCreature(pos, main) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xffd6e0, emissiveIntensity: 0 });
  const obj = new THREE.Group();
  const mesh = new THREE.Mesh(creatureGeo, mat);
  mesh.castShadow = main;
  obj.add(mesh);
  obj.position.copy(pos);
  obj.rotation.y = Math.random() * 0.8 - 0.4;
  scene.add(obj);
  const c = { obj, mesh, mat, home: pos.clone(), hp: 14, alive: true, flash: 0, squash: 0, phase: Math.random() * 6 };
  mesh.userData.creature = c;
  creatures.push(c);
  return c;
}

// ---------------------------------------------------------------------------
// VFX
// ---------------------------------------------------------------------------
// Sesler: dosya yok, açılışta arka planda matematikle üretilir
const sfx = new SFXPlayer({ variants: 3 });
sfx.unlock();
sfx.preload();
const vfx = new VFXSystem({ scene, camera, audio: sfx });

const HIT_RADIUS = { okYagmuru: 1.3, dumanBombasi: 3.5, binKesik: 1.6, olumAtisi: 1.4 };
const DAMAGE = { olumAtisi: 14, binKesik: 1, okYagmuru: 1, seriAtis: 2, hancerYelpazesi: 2, dumanBombasi: 2, golgeAdimi: 6, taklaAtis: 3 };

function damageAt(position, radius, dmg) {
  for (const c of creatures) {
    if (!c.alive) continue;
    const dx = c.obj.position.x - position.x;
    const dz = c.obj.position.z - position.z;
    if (dx * dx + dz * dz > radius * radius) continue;
    c.flash = 1;
    c.squash = 1;
    c.hp -= dmg;
    if (Math.random() < 0.35) sfx.play('yaratikAci', { position: c.obj.position, delay: 0.03 });
    if (c.hp <= 0) kill(c);
  }
}

function kill(c) {
  c.alive = false;
  c.obj.visible = false;
  vfx.cast('yaratikOlum', { position: c.obj.position });
  if (selected === c) selected = null;
  vfx.after(2.2, () => {
    c.obj.position.copy(c.home);
    c.hp = 14;
    c.alive = true;
    c.obj.visible = stress || arena.includes(c);
    c.squash = 1;
    if (vfx.isVisible(c.home, 2)) {
      sfx.play('yaratikDogus', { position: c.home, gain: 0.6 });
      vfx.decal(DECAL.RUNE, c.home, { r0: 1.1, r1: 1.2, duration: 0.6, color: 0xb58cff, alpha: 0.7, spin: 3 });
      vfx.decal(DECAL.SHOCKWAVE, c.home, { r0: 0.2, r1: 1.6, duration: 0.4, color: 0xb58cff });
    }
  });
}

function nearestCreature(from) {
  let best = null;
  let bd = Infinity;
  for (const c of creatures) {
    if (!c.alive) continue;
    const d = c.obj.position.distanceToSquared(from);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

let shakeOn = true;

function cast(hero, id) {
  const def = SKILLS[id];
  if (!def || hero.busy) return null;
  const target = hero.main && selected && selected.alive ? selected : nearestCreature(hero.home);
  if (!target) return null;
  const r = HIT_RADIUS[id] ?? 1.2;
  const dmg = DAMAGE[id] ?? 1;
  const res = vfx.cast(id, {
    from: hero.obj.position,
    target: target.obj.position,
    caster: hero.obj,
    shake: shakeOn && hero.main,
    voice: hero.main ? (hero.role === 'okcu' ? 'Ince' : 'Kalin') : undefined,
    volume: hero.main ? 1 : 0.45, // diğer kahramanlar daha kısık
    priority: hero.main ? 2 : 0, // ses sınırı dolunca önce kendi kahramanımız duyulsun
    onHit: (h) => damageAt(h.position, r, dmg),
  });
  if (def.moves) {
    hero.busy = true;
    vfx.after(res.duration + 0.3, () => goHome(hero));
  }
  return res;
}

function goHome(hero) {
  const start = hero.obj.position.clone();
  const dist = start.distanceTo(hero.home);
  if (dist < 0.05) {
    hero.busy = false;
    return;
  }
  hero.obj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(hero.home.x - start.x, hero.home.z - start.z));
  vfx.tween(
    Math.min(0.8, 0.12 + dist * 0.08),
    (k) => {
      hero.obj.position.lerpVectors(start, hero.home, k);
      hero.obj.position.y = Math.abs(Math.sin(k * Math.PI * 4)) * 0.12;
    },
    0,
    () => {
      hero.obj.position.copy(hero.home);
      const t = nearestCreature(hero.home);
      if (t) hero.obj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(t.obj.position.x - hero.home.x, t.obj.position.z - hero.home.z));
      hero.busy = false;
    },
  );
}

// ---------------------------------------------------------------------------
// Dünya kurulumu
// ---------------------------------------------------------------------------
let selected = null;
let stress = false;
const mainArcher = makeHero('okcu', new THREE.Vector3(-3.2, 0, 3.2), true);
const mainAssassin = makeHero('suikastci', new THREE.Vector3(3.2, 0, 3.2), true);
const arena = [
  [0, -4.5],
  [-3.2, -6.5],
  [3.4, -6.2],
  [-1.2, -8.6],
  [1.8, -9.4],
].map(([x, z]) => makeCreature(new THREE.Vector3(x, 0, z), true));
selected = arena[0];
for (const h of heroes) h.obj.lookAt(arena[0].obj.position.x, 0, arena[0].obj.position.z);

const stressHeroes = [];
const stressCreatures = [];
function buildStress() {
  const idsArcher = ['okcu', 'okcu', 'suikastci', 'suikastci'];
  for (const c of CAMPS) {
    if (Math.abs(c.x) < 7 && Math.abs(c.z) < 7) continue; // ana arena
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.random() * 0.5;
      const p = new THREE.Vector3(c.x + Math.cos(a) * 4, 0, c.z + Math.sin(a) * 4);
      const h = makeHero(idsArcher[i], p, false);
      h.obj.lookAt(c.x, 0, c.z);
      stressHeroes.push(h);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      stressCreatures.push(makeCreature(new THREE.Vector3(c.x + Math.cos(a) * 1.4, 0, c.z + Math.sin(a) * 1.4), false));
    }
  }
}
buildStress();
function setStress(on) {
  stress = on;
  for (const h of stressHeroes) h.obj.visible = on;
  for (const c of stressCreatures) c.obj.visible = on && c.alive;
  cam.wantOffset.copy((on ? STRESS_CAM : NORMAL_CAM).offset);
  cam.wantTarget.copy((on ? STRESS_CAM : NORMAL_CAM).target);
  setShadowBounds(on ? 50 : 22);
  document.getElementById('btn-stress').classList.toggle('on', on);
  updateModeLabel();
}
function updateModeLabel() {
  const n = stress ? heroes.length : 2;
  document.getElementById('mode').innerHTML = `Kahraman: <b>${n}</b> · Yaratık: <b>${stress ? creatures.length : arena.length}</b>`;
}

// toplu test kapalıyken o yaratıkları sahneden "çıkar"
const activeCreatures = () => (stress ? creatures : arena);

// ---------------------------------------------------------------------------
// Arayüz
// ---------------------------------------------------------------------------
const KEYS = { seriAtis: '1', taklaAtis: '2', okYagmuru: '3', olumAtisi: '4', golgeAdimi: '5', hancerYelpazesi: '6', dumanBombasi: '7', binKesik: '8' };
const keyToSkill = {};
for (const [id, def] of Object.entries(SKILLS)) {
  if (!KEYS[id]) continue;
  const btn = document.createElement('button');
  btn.className = 'pill';
  btn.innerHTML = `<span>${def.emoji}</span><span>${def.name}</span><span class="key">${KEYS[id]}</span>`;
  btn.addEventListener('click', () => castMain(id));
  document.getElementById(def.role).appendChild(btn);
  keyToSkill[KEYS[id]] = id;
}
function castMain(id) {
  return cast(SKILLS[id].role === 'okcu' ? mainArcher : mainAssassin, id);
}

let auto = false;
let slow = false;
const QUALITIES = [
  ['Yüksek', 1],
  ['Orta', 0.6],
  ['Düşük', 0.35],
];
let qi = 0;
const toggle = (id, fn) => document.getElementById(id).addEventListener('click', (e) => e.currentTarget.classList.toggle('on', fn()));
toggle('btn-auto', () => (auto = !auto));
toggle('btn-slow', () => (slow = !slow));
toggle('btn-shake', () => (shakeOn = !shakeOn));
toggle('btn-sound', () => {
  sfx.muted = !sfx.muted;
  if (sfx.muted) sfx.stopAll();
  return !sfx.muted;
});
document.getElementById('btn-stress').addEventListener('click', () => setStress(!stress));
document.getElementById('btn-quality').addEventListener('click', (e) => {
  qi = (qi + 1) % QUALITIES.length;
  vfx.quality = QUALITIES[qi][1];
  e.currentTarget.textContent = `✨ Kalite: ${QUALITIES[qi][0]}`;
});

window.addEventListener('keydown', (e) => {
  if (keyToSkill[e.key]) castMain(keyToSkill[e.key]);
  if (e.code === 'Space') {
    e.preventDefault();
    ['olumAtisi', 'binKesik'].forEach(castMain);
  }
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(activeCreatures().filter((c) => c.alive).map((c) => c.mesh))[0];
  if (hit) selected = hit.object.userData.creature;
});

const selRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.88, 32).rotateX(-HALF), selMat);
selRing.renderOrder = 1;
scene.add(selRing);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Döngü
// ---------------------------------------------------------------------------
const roleSkills = {
  okcu: ['seriAtis', 'taklaAtis', 'okYagmuru', 'olumAtisi', 'temelAtis', 'temelAtis'],
  suikastci: ['golgeAdimi', 'hancerYelpazesi', 'dumanBombasi', 'binKesik', 'temelVurus', 'temelVurus'],
};

let simTime = 0;
let paused = false;
function step(dt, timeScale = 1) {
  simTime += dt;
  vfx.timeScale = timeScale;
  vfx.update(dt / timeScale);

  for (const h of heroes) {
    if (!h.main && !stress) continue;
    if (!h.main || auto) {
      h.next -= dt;
      if (h.next <= 0 && !h.busy) {
        const list = roleSkills[h.role];
        const id = list[(Math.random() * list.length) | 0];
        if (id === 'temelVurus' && h.obj.position.distanceTo(nearestCreature(h.home)?.obj.position ?? h.home) > 4.5) {
          cast(h, 'hancerYelpazesi');
        } else cast(h, id);
        h.next = h.main ? 1.8 + Math.random() : 2.2 + Math.random() * 3;
      }
    }
    if (h.ring) h.ring.position.set(h.obj.position.x, 0.03, h.obj.position.z);
  }

  for (const c of creatures) {
    if (!c.alive) continue;
    c.flash = Math.max(0, c.flash - dt * 7);
    c.squash = Math.max(0, c.squash - dt * 5);
    c.mat.emissiveIntensity = c.flash * 0.45;
    const bob = Math.sin(simTime * 3 + c.phase) * 0.04;
    c.mesh.scale.set(1 + c.squash * 0.15, 1 - c.squash * 0.25 + bob, 1 + c.squash * 0.15);
  }

  selRing.visible = !!(selected && selected.alive && !stress);
  if (selRing.visible) selRing.position.set(selected.obj.position.x, 0.03, selected.obj.position.z);

  const k = 1 - Math.exp(-dt * 4);
  cam.offset.lerp(cam.wantOffset, k);
  cam.target.lerp(cam.wantTarget, k);
}

function render() {
  camera.position.copy(cam.target).add(cam.offset);
  camera.lookAt(cam.target);
  vfx.applyShake(camera);
  sfx.setListenerFromCamera(camera, cam.target);
  renderer.render(scene, camera);
}

const timer = new THREE.Timer();
let fpsT = 0;
let fpsN = 0;
function frame(now) {
  timer.update(now);
  const raw = Math.min(timer.getDelta(), 1 / 20);
  if (!paused) step(raw * (slow ? 0.25 : 1), slow ? 0.25 : 1);
  render();
  fpsT += raw;
  fpsN++;
  if (fpsT > 0.5) {
    const s = vfx.stats();
    document.getElementById('fps').textContent = Math.round(fpsN / fpsT);
    document.getElementById('calls').textContent = renderer.info.render.calls;
    document.getElementById('parts').textContent = s.particles.toLocaleString('tr-TR');
    document.getElementById('projs').textContent = s.projectiles;
    document.getElementById('vfxcalls').textContent = s.drawCalls;
    fpsT = 0;
    fpsN = 0;
  }
  requestAnimationFrame(frame);
}
setStress(false);
requestAnimationFrame(frame);

// Otomatik testler / ekran görüntüsü için küçük bir API
window.__demo = {
  vfx,
  castMain,
  setStress,
  setPaused: (p) => (paused = p),
  advance(sec, fps = 60) {
    for (let t = 0; t < sec; t += 1 / fps) step(1 / fps);
    render();
  },
  select(i) {
    selected = arena[i];
  },
  renderer,
  sfx,
};

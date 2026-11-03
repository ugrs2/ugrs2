// three.js sahnesi: harita, karargah, kuleler, düşmanlar, efektler, imleçler, kamera.
import * as THREE from 'three';
import { TOWERS, TOWER_ORDER, ENEMIES, ENEMY_ORDER, THEMES, STAGES, PLAYER_COLORS } from '/shared/data.js';
import { buildMap, CELL, HALF, SIZE, idx, rotate } from '/shared/map.js';
import * as M from './models.js';
import { FX } from './fx.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _e = new THREE.Euler();
const TAU = Math.PI * 2;

function hexRGB(h) { _c.set(h); return [_c.r, _c.g, _c.b]; }
function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; }
function angLerp(a, b, t) { let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; }

const PROJ_LOOK = {
  bullet: { look: 'tracer', color: [1, 0.85, 0.3], size: 0.05 },
  shell: { look: 'solid', color: [0.2, 0.2, 0.22], size: 0.13 },
  flak: { look: 'glow', color: [1, 0.7, 0.3], size: 0.08 },
  missile: { look: 'missile', color: [1, 1, 1], size: 0.1, trail: [1, 0.5, 0.15] },
  mortar: { look: 'solid', color: [0.15, 0.15, 0.15], size: 0.18, arc: 3.5 },
  glob: { look: 'glow', color: [0.4, 1, 0.2], size: 0.16, arc: 1.2 },
};
const BOOM_COL = {
  shell: [1, 0.55, 0.15], flak: [1, 0.75, 0.35], missile: [1, 0.45, 0.1], mortar: [1, 0.5, 0.1],
  glob: [0.4, 1, 0.15], strike: [1, 0.4, 0.05],
};

export class GameView {
  constructor(container, { touch = false, quality = 'high' } = {}) {
    this.container = container;
    this.touch = touch;
    this.quality = quality;
    const r = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));
    r.shadowMap.enabled = quality === 'high';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);
    r.domElement.style.touchAction = 'none';
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 400);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.fx = new FX(this.scene);
    this.enemies = new Map();
    this.towers = new Map();
    this.towerOrder = [];
    this.enemyMeshes = new Map();
    this.cursorObjs = new Map();
    this.floaters = [];
    this.snapInterval = 1 / 15;
    this.lastSnapAt = 0;
    this.time = 0;
    this.shake = 0;
    this.cam = { tx: 0, tz: 1, dist: 45, az: 0, pitch: 0.95, fixed: !touch };
    this.onTap = null;
    this.onHover = null;
    this.act = [];
    this.hqState = [0, 1, 0, 0, 0];
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.floatRoot = document.createElement('div');
    this.floatRoot.className = 'float-root';
    container.appendChild(this.floatRoot);

    this.initBars();
    this.initPointer();
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.cam.fixed) this.fitCamera();
  }

  fitCamera() {
    const t = Math.tan(this.camera.fov * Math.PI / 360);
    const a = this.camera.aspect;
    this.cam.dist = Math.max(20 / (t * a), 17.5 / t) * 1.02;
    this.cam.tx = 0; this.cam.tz = 1.2;
  }

  focusLane(lane) {
    const dir = rotate([0, -1], lane);
    this.cam.az = Math.atan2(dir[0], dir[1]);
    this.cam.tx = dir[0] * 7; this.cam.tz = dir[1] * 7;
    this.cam.dist = 40;
    this.cam.fixed = false;
  }

  // ------------------------------------------------------------ kurulum
  setup(init) {
    this.clearWorld();
    const stage = STAGES.find(s => s.id === init.stageId) || STAGES[0];
    const theme = THEMES[stage.theme];
    this.theme = theme;
    this.map = buildMap(init.template, init.lanes, init.seed);
    this.players = new Map(init.players.map(p => [p.pid, p]));
    const W = this.world;

    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.Fog(theme.fog, 70, 160);

    const hemi = new THREE.HemisphereLight(theme.sky, theme.ground, 1.1 * theme.light);
    W.add(hemi);
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2 * theme.light);
    sun.position.set(-18, 34, 14);
    sun.castShadow = this.renderer.shadowMap.enabled;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0008;
    W.add(sun);
    this.sun = sun;

    // Zemin
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: theme.edge, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.32; ground.receiveShadow = true;
    W.add(ground);

    // Hücreler
    const tileGeo = new THREE.BoxGeometry(0.96, 0.3, 0.96);
    const tileMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
    const cells = [];
    for (let z = -HALF; z <= HALF; z++) for (let x = -HALF; x <= HALF; x++) {
      const c = this.map.grid[idx(x, z)];
      if (c !== CELL.HQ) cells.push([x, z, c]);
    }
    const tiles = new THREE.InstancedMesh(tileGeo, tileMat, cells.length);
    tiles.receiveShadow = true;
    const g1 = new THREE.Color(theme.ground), g2 = new THREE.Color(theme.ground2), pc = new THREE.Color(theme.path);
    cells.forEach(([x, z, c], i) => {
      const isPath = c === CELL.PATH;
      _m.compose(_p.set(x, isPath ? -0.27 : -0.15, z), _q.identity(), _s.set(isPath ? 1.02 : 1, 1, isPath ? 1.02 : 1));
      tiles.setMatrixAt(i, _m);
      const v = 0.94 + hash(x * 131 + z * 7 + 3) * 0.1;
      _c.copy(isPath ? pc : ((x + z) & 1 ? g1 : g2)).multiplyScalar(v);
      tiles.setColorAt(i, _c);
    });
    W.add(tiles);

    // Kenar çerçevesi
    const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.edge).multiplyScalar(0.7), roughness: 1 });
    const L = SIZE + 0.6;
    for (const [x, z, sx, sz] of [[0, -HALF - 0.8, L + 1, 0.6], [0, HALF + 0.8, L + 1, 0.6], [-HALF - 0.8, 0, 0.6, L], [HALF + 0.8, 0, 0.6, L]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.5, sz), frameMat);
      b.position.set(x, -0.1, z); b.receiveShadow = true; W.add(b);
    }

    // Dekor (engeller + harita dışı)
    const decoPos = this.map.deco.map(d => [d.x, d.z, d.v]);
    const r = (n) => hash(n * 977 + 13);
    for (let i = 0; i < 260; i++) {
      const a = r(i) * TAU, d = 19.5 + r(i + 999) * 16;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      let ok = true;
      for (const lane of this.map.lanes) {
        const [lx, lz] = rotate([x, z], (4 - lane) % 4);
        if (Math.abs(lx) < 4.5 && lz < -15) ok = false;
        if (Math.abs(lx + 7) < 3 && lz < -15) ok = false;
      }
      if (ok) decoPos.push([x, z, Math.floor(r(i + 5) * 1000)]);
    }
    const dg = M.decoGeometry(theme.deco);
    const mk = (geo, mat) => {
      const im = new THREE.InstancedMesh(geo, mat, decoPos.length);
      decoPos.forEach(([x, z, v], i) => {
        const s = 0.8 + (v % 100) / 250;
        _e.set(0, (v % 360) * Math.PI / 180, 0);
        _m.compose(_p.set(x + ((v % 7) - 3) * 0.04, 0, z + ((v % 5) - 2) * 0.04), _q.setFromEuler(_e), _s.set(s, s, s));
        im.setMatrixAt(i, _m);
      });
      im.castShadow = true;
      W.add(im);
    };
    if (dg.lit) mk(dg.lit, M.litMaterial);
    if (dg.glow) mk(dg.glow, M.glowMaterial);

    // Portallar
    this.portals = [];
    for (const lane of this.map.lanes) {
      const owner = [...this.players.values()].find(p => p.lane === lane);
      const col = owner ? owner.color : '#ff5252';
      const [px, pz] = rotate([0, -HALF - 1.2], lane);
      const g = new THREE.Group();
      g.position.set(px, 0, pz);
      g.rotation.y = Math.atan2(...rotate([0, 1], lane));
      const arch = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.14, 8, 24, Math.PI), new THREE.MeshStandardMaterial({ color: '#37474f' }));
      arch.castShadow = true;
      g.add(arch);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24, 0, Math.PI), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide, toneMapped: false }));
      g.add(inner);
      W.add(g);
      this.portals.push({ g, inner, col: hexRGB(col), x: px, z: pz });
      // Hava yolu işaretçisi
      const ap = this.map.airPaths[lane].pts[0];
      const beacon = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 4), new THREE.MeshBasicMaterial({ color: '#80d8ff', toneMapped: false }));
      beacon.position.set(ap.x, 0.4, ap.z);
      W.add(beacon);
    }

    // Karargah
    const hq = new THREE.Group();
    hq.add(M.makeMesh(M.hqGeometry(), { receive: true }));
    this.hqRing = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 6, 40), new THREE.MeshBasicMaterial({ color: '#4fc3f7', toneMapped: false }));
    this.hqRing.position.y = 3.3; this.hqRing.rotation.x = Math.PI / 2;
    hq.add(this.hqRing);
    this.hqGun = M.makeMesh(M.hqGunGeometry());
    this.hqGun.position.y = 3.25; this.hqGun.visible = false;
    hq.add(this.hqGun);
    this.hqWalls = [];
    for (let i = 0; i < 3; i++) {
      const wall = new THREE.Mesh(new THREE.TorusGeometry(2.45 + i * 0.12, 0.08, 4, 8), new THREE.MeshStandardMaterial({ color: '#90a4ae', metalness: 0.5, roughness: 0.4 }));
      wall.rotation.x = Math.PI / 2; wall.rotation.z = Math.PI / 8; wall.position.y = 0.5 + i * 0.12; wall.visible = false;
      hq.add(wall);
      this.hqWalls.push(wall);
    }
    W.add(hq);
    this.hq = hq;

    this.enemyRoot = new THREE.Group();
    this.scene.add(this.enemyRoot);
    this.towerRoot = new THREE.Group();
    W.add(this.towerRoot);

    if (this.cam.fixed) this.fitCamera();
  }

  clearWorld() {
    const disposeTree = (o) => o.traverse(c => {
      if (c.isMesh || c.isInstancedMesh) {
        if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose?.();
      }
    });
    for (const c of [...this.world.children]) { this.world.remove(c); }
    if (this.enemyRoot) { this.scene.remove(this.enemyRoot); disposeTree(this.enemyRoot); }
    this.enemies.clear();
    this.towers.clear();
    this.towerOrder = [];
    this.enemyMeshes.clear();
    for (const o of this.cursorObjs.values()) this.scene.remove(o.group);
    this.cursorObjs.clear();
    this.fx.clear();
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
  }

  // ------------------------------------------------------------ sağlık barları
  initBars() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mk = (color, cap) => {
      const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color, depthWrite: false, transparent: true, toneMapped: false }), cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false; im.count = 0; im.renderOrder = 10;
      this.scene.add(im);
      return im;
    };
    this.barBg = mk('#111', 800);
    this.barFg = mk('#fff', 800);
    this.barFg.setColorAt(0, _c.set(1, 1, 1));
    this.barFg.renderOrder = 11;
    const bub = new THREE.IcosahedronGeometry(1, 2);
    this.bubbles = new THREE.InstancedMesh(bub, new THREE.MeshBasicMaterial({ color: '#82b1ff', transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false }), 400);
    this.bubbles.frustumCulled = false; this.bubbles.count = 0;
    this.scene.add(this.bubbles);
  }

  // ------------------------------------------------------------ işaretçi (dokunmatik / fare)
  initPointer() {
    const el = this.renderer.domElement;
    const pts = new Map();
    let start = null, pinch = null, moved = false;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { start = { x: e.clientX, y: e.clientY, t: performance.now(), tx: this.cam.tx, tz: this.cam.tz }; moved = false; }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: this.cam.dist, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx: this.cam.tx, tz: this.cam.tz };
        moved = true;
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) {
        if (e.pointerType === 'mouse' && this.onHover) { const c = this.pick(e.clientX, e.clientY); if (c) this.onHover(c); }
        return;
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.cam.dist = Math.max(12, Math.min(75, pinch.dist * pinch.d / Math.max(20, d)));
        this.cam.fixed = false;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.panBy(mx - pinch.mx, my - pinch.my, pinch);
      } else if (pts.size === 1 && start) {
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) > 12) moved = true;
        if (moved && (this.touch || e.pointerType !== 'mouse' || e.buttons & 2)) { this.panBy(dx, dy, start); this.cam.fixed = false; }
        if (e.pointerType === 'mouse' && this.onHover) { const c = this.pick(e.clientX, e.clientY); if (c) this.onHover(c); }
      }
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 0) {
        if (start && !moved && performance.now() - start.t < 600 && e.button !== 2) {
          const c = this.pick(e.clientX, e.clientY);
          if (c && this.onTap) this.onTap(c, e);
        }
        start = null; pinch = null;
      } else if (pts.size === 1) {
        const p = [...pts.values()][0];
        start = { x: p.x, y: p.y, t: 0, tx: this.cam.tx, tz: this.cam.tz };
        pinch = null;
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist = Math.max(12, Math.min(75, this.cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
      this.cam.fixed = false;
    }, { passive: false });
  }

  panBy(dx, dy, ref) {
    const k = this.cam.dist / (this.container.clientHeight || 800) * 1.1;
    const s = Math.sin(this.cam.az), c = Math.cos(this.cam.az);
    // ekran sağı = (c, -s), ekran yukarısı = (-s, -c)
    const wx = -dx * k * c + -dy * k * s;
    const wz = dx * k * s + -dy * k * c;
    this.cam.tx = Math.max(-22, Math.min(22, ref.tx + wx));
    this.cam.tz = Math.max(-22, Math.min(22, ref.tz + wz));
  }

  resetCamera() {
    if (this.touch && this.myLane != null) this.focusLane(this.myLane);
    else { this.cam.fixed = true; this.cam.az = 0; this.fitCamera(); }
  }

  pick(cx, cy) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, _v);
    if (!hit) return null;
    const x = Math.round(hit.x), z = Math.round(hit.z);
    if (Math.abs(x) > HALF || Math.abs(z) > HALF) return null;
    return { x, z };
  }

  toScreen(x, y, z) {
    _v.set(x, y, z).project(this.camera);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    return { x: (_v.x + 1) / 2 * w, y: (1 - _v.y) / 2 * h, vis: _v.z < 1 };
  }

  cellInfo(x, z) {
    if (!this.map || Math.abs(x) > HALF || Math.abs(z) > HALF) return { cell: -1 };
    const cell = this.map.grid[idx(x, z)];
    let tower = null;
    for (const t of this.towers.values()) if (t.x === x && t.z === z) { tower = t; break; }
    return { cell, tower };
  }

  // ------------------------------------------------------------ anlık görüntü
  applySnapshot(s) {
    const now = performance.now();
    if (this.lastSnapAt) {
      const d = (now - this.lastSnapAt) / 1000;
      this.snapInterval = Math.max(0.02, Math.min(0.2, this.snapInterval * 0.85 + d * 0.15));
    }
    this.lastSnapAt = now;

    if (s.T) this.syncTowers(s.T);
    for (let i = 0; i < this.towerOrder.length && i < s.ta.length; i++) {
      const t = this.towers.get(this.towerOrder[i]);
      if (t) t.targetYaw = s.ta[i] / 100;
    }
    this.act = s.act || [];
    this.hqState = s.hq;

    const seen = this.snapSeq = (this.snapSeq || 0) + 1;
    const e = s.e;
    for (let i = 0; i < e.length; i += 6) {
      const id = e[i];
      let en = this.enemies.get(id);
      const x = e[i + 2] / 100, z = e[i + 3] / 100;
      if (!en) {
        const type = ENEMY_ORDER[e[i + 1]];
        const def = ENEMIES[type];
        en = { id, type, def, x, z, fx: x, fz: z, tx: x, tz: z, t: 1, yaw: 0, hp: 100, flags: 0, y: 0, off: (hash(id) - 0.5) * (def.boss ? 0 : def.flying ? 1.0 : 0.45), phase: hash(id + 7) * TAU };
        this.enemies.set(id, en);
      }
      en.fx = en.x; en.fz = en.z; en.tx = x; en.tz = z; en.t = 0;
      en.hp = e[i + 4]; en.flags = e[i + 5]; en.seen = seen;
    }
    for (const [id, en] of this.enemies) if (en.seen !== seen) this.enemies.delete(id);

    if (s.ev && s.ev.length) this.handleEvents(s.ev);
  }

  syncTowers(list) {
    const ids = new Set();
    this.towerOrder = list.map(t => t[0]);
    for (const [id, ti, x, z, level, spec, owner, mode, kills] of list) {
      ids.add(id);
      const type = TOWER_ORDER[ti];
      const specL = spec === 1 ? 'A' : spec === 2 ? 'B' : null;
      let t = this.towers.get(id);
      if (t && (t.level !== level || t.spec !== specL)) {
        this.towerRoot.remove(t.group);
        this.fx.burst(x, 1, z, 20, [1, 0.85, 0.3], 3, 0.8, 0.08, 2);
        this.fx.ring(x, z, 0.2, 1.2, 0.5, [1, 0.85, 0.3]);
        t = null;
      }
      if (!t) {
        const old = this.towers.get(id);
        t = this.makeTower(id, type, x, z, level, specL, owner);
        if (old) { t.yaw = old.yaw; t.head.rotation.y = old.yaw; }
        this.towers.set(id, t);
      }
      t.mode = mode; t.kills = kills; t.owner = owner;
    }
    for (const [id, t] of this.towers) {
      if (!ids.has(id)) { this.towerRoot.remove(t.group); this.towers.delete(id); }
    }
  }

  makeTower(id, type, x, z, level, spec, owner) {
    const def = TOWERS[type];
    const geo = M.towerGeometry(type, def, level, spec);
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const base = M.makeMesh(geo.base);
    group.add(base);
    const head = new THREE.Group();
    head.position.y = geo.headY;
    head.add(M.makeMesh(geo.head));
    group.add(head);
    const pc = PLAYER_COLORS[owner % 4];
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.035, 4, 24), new THREE.MeshBasicMaterial({ color: pc, toneMapped: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.13;
    group.add(ring);
    group.scale.setScalar(geo.scale);
    this.towerRoot.add(group);
    const yaw = Math.atan2(-x, -z);
    head.rotation.y = yaw;
    return { id, type, def, x, z, level, spec, owner, group, head, headY: geo.headY * geo.scale, yaw, targetYaw: yaw, spin: M.towerSpins(type), mode: 0, kills: 0, pop: 0.35 };
  }

  muzzle(t, fwd = 0.45) {
    return { x: t.x + Math.sin(t.yaw) * fwd, y: t.headY + 0.05, z: t.z + Math.cos(t.yaw) * fwd };
  }

  enemyPos(id) {
    const e = this.enemies.get(id);
    if (!e) return null;
    return { x: e.x, y: e.y + e.def.size * 0.9, z: e.z };
  }

  // ------------------------------------------------------------ olaylar
  handleEvents(evs) {
    const fx = this.fx;
    for (const ev of evs) {
      switch (ev.k) {
        case 'f': {
          const src = ev.f === 0 ? { x: Math.sin(this.hqGun.rotation.y) * 0.9, y: 3.5, z: Math.cos(this.hqGun.rotation.y) * 0.9 } : (this.towers.get(ev.f) ? this.muzzle(this.towers.get(ev.f)) : null);
          if (!src) break;
          const look = PROJ_LOOK[ev.p] || PROJ_LOOK.bullet;
          const tgt = ev.e != null ? this.enemyPos(ev.e) : { x: ev.x, y: 0.1, z: ev.z };
          if (!tgt) break;
          const dist = Math.hypot(tgt.x - src.x, tgt.z - src.z);
          fx.projectile({
            ...look, x: src.x, y: src.y, z: src.z, y0: src.y, tx: tgt.x, tz: tgt.z, ty: tgt.y, target: ev.e ?? null,
            speed: ev.s, life: 6, travel: 0, total: Math.max(0.5, dist),
            onHit: look.look === 'tracer' ? (p) => fx.particle({ pool: 'spark', x: p.x, y: p.y, z: p.z, life: 0.1, s0: 0.12, s1: 0.02, r: 1, gg: 0.8, b: 0.4 }) : null,
          });
          fx.particle({ pool: 'glow', x: src.x, y: src.y, z: src.z, life: 0.07, s0: 0.18, s1: 0.05, r: 1, gg: 0.8, b: 0.4 });
          break;
        }
        case 'b': {
          const col = BOOM_COL[ev.p] || [1, 0.55, 0.15];
          fx.explosion(ev.x, ev.z, ev.p === 'strike' ? ev.r * 0.9 : ev.r, col);
          if (ev.ff) for (let i = 0; i < 3; i++) fx.particle({ pool: 'ring', x: ev.x, y: 0.06, z: ev.z, life: 4, s0: ev.r * (0.5 + i * 0.25), s1: ev.r * (0.6 + i * 0.25), r: 0.9, gg: 0.35, b: 0.05, pulse: 8 + i * 3, fade: true });
          if (ev.p === 'strike' || ev.r > 2.5) this.shake = Math.max(this.shake, 0.35);
          break;
        }
        case 'r': {
          const t = this.towers.get(ev.f), p = this.enemyPos(ev.e);
          if (!t || !p) break;
          fx.beam(this.muzzle(t, 0.9), p, ev.c ? 0.06 : 0.03, ev.c ? [1, 0.2, 0.2] : [1, 0.95, 0.7], 0.15);
          if (ev.c) fx.burst(p.x, p.y, p.z, 10, [1, 0.2, 0.2], 3, 0.4, 0.08);
          break;
        }
        case 'rl': {
          const t = this.towers.get(ev.f);
          if (!t) break;
          const a = this.muzzle(t, 0.9);
          fx.beam(a, { x: ev.x, y: 0.5, z: ev.z }, 0.12, [0.7, 0.5, 1], 0.35);
          fx.beam(a, { x: ev.x, y: 0.5, z: ev.z }, 0.04, [1, 1, 1], 0.2);
          this.shake = Math.max(this.shake, 0.08);
          break;
        }
        case 'c': {
          const t = this.towers.get(ev.f);
          if (!t) break;
          let a = { x: t.x, y: t.headY + 0.7, z: t.z };
          for (const id of ev.ids) {
            const p = this.enemyPos(id);
            if (!p) continue;
            fx.beam(a, p, 0.035, [0.6, 0.95, 1], 0.18, 0.5);
            fx.particle({ pool: 'glow', x: p.x, y: p.y, z: p.z, life: 0.15, s0: 0.3, s1: 0.1, r: 0.5, gg: 0.9, b: 1 });
            a = p;
          }
          break;
        }
        case 'pu': {
          const t = this.towers.get(ev.f);
          if (!t) break;
          fx.ring(t.x, t.z, 0.3, ev.r, 0.5, [0.5, 0.85, 1], 0.15);
          for (let i = 0; i < 8; i++) {
            const a = Math.random() * TAU;
            fx.particle({ x: t.x, y: 0.4, z: t.z, vx: Math.cos(a) * ev.r * 1.8, vz: Math.sin(a) * ev.r * 1.8, vy: 0.5, life: 0.45, s0: 0.08, s1: 0.03, r: 0.8, gg: 0.95, b: 1, drag: 2 });
          }
          break;
        }
        case 'g': {
          fx.particle({ pool: 'glow', x: ev.x, y: 0.6, z: ev.z, life: 0.7, s0: ev.r, s1: 0.1, r: 0.55, gg: 0.15, b: 0.9 });
          fx.ring(ev.x, ev.z, ev.r * 1.3, 0.1, 0.7, [0.8, 0.3, 1]);
          for (let i = 0; i < 16; i++) {
            const a = Math.random() * TAU, d = ev.r * 1.2;
            fx.particle({ x: ev.x + Math.cos(a) * d, y: 0.5, z: ev.z + Math.sin(a) * d, vx: -Math.cos(a) * d * 1.6, vz: -Math.sin(a) * d * 1.6, life: 0.6, s0: 0.1, s1: 0.02, r: 0.8, gg: 0.4, b: 1 });
          }
          break;
        }
        case 'k': {
          const def = ENEMIES[ENEMY_ORDER[ev.t]];
          const col = hexRGB(def.color);
          const y = ev.f ? (ev.b ? 2.4 : 1.6) : 0.4;
          fx.burst(ev.x, y, ev.z, ev.b ? 60 : 10, col, ev.b ? 7 : 3, ev.b ? 1.2 : 0.6, ev.b ? 0.2 : 0.09);
          fx.particle({ x: ev.x, y: y + 0.3, z: ev.z, vy: 1.5, life: 0.6, s0: 0.12, s1: 0.12, r: 1, gg: 0.85, b: 0.2 });
          if (ev.b) {
            fx.explosion(ev.x, ev.z, 3, [1, 0.6, 0.2], y);
            this.shake = Math.max(this.shake, 0.8);
            this.floatText(ev.x, y + 1, ev.z, `+${ev.g}`, '#ffd54a', true);
          }
          break;
        }
        case 'l':
          fx.explosion(ev.x, ev.z, 1.2, [1, 0.2, 0.2], 1);
          this.shake = Math.max(this.shake, 0.3);
          this.floatText(ev.x, 2.5, ev.z, `-${ev.d}`, '#ff5252');
          break;
        case 'bd':
          fx.ring(ev.x, ev.z, 0.2, 1, 0.4, [1, 1, 1]);
          fx.burst(ev.x, 0.2, ev.z, 10, [0.8, 0.7, 0.5], 2, 0.5, 0.07);
          break;
        case 'sl':
          fx.burst(ev.x, 0.4, ev.z, 16, [1, 0.85, 0.3], 3, 0.6, 0.08);
          this.floatText(ev.x, 1.2, ev.z, `+${ev.g}`, '#ffd54a');
          break;
        case 'st':
          fx.particle({ pool: 'ring', x: ev.x, y: 0.07, z: ev.z, life: ev.d, s0: ev.r, s1: ev.r * 0.9, r: 1, gg: 0.15, b: 0.1, pulse: 18, fade: false });
          fx.particle({ pool: 'ring', x: ev.x, y: 0.07, z: ev.z, life: ev.d, s0: ev.r * 0.1, s1: ev.r, r: 1, gg: 0.3, b: 0.1 });
          for (let i = 0; i < 5; i++) {
            const a = i / 5 * TAU, d = i ? ev.r * 0.55 : 0;
            const tx = ev.x + Math.cos(a) * d, tz = ev.z + Math.sin(a) * d;
            fx.projectile({ look: 'solid', color: [0.15, 0.15, 0.15], size: 0.2, x: tx + 3, y: 14, z: tz - 2, y0: 14, tx, tz, ty: 0, speed: Math.hypot(3, 2) / ev.d, life: ev.d + 0.1, arc: 0.001, travel: 0, total: Math.hypot(3, 2) });
          }
          break;
        case 'h':
          fx.ring(ev.x, ev.z, 0.3, 2.5, 0.6, [0.3, 1, 0.5], 0.3);
          break;
        case 'bl':
          fx.burst(ev.x1, 0.6, ev.z1, 10, [0, 0.9, 1], 2, 0.4, 0.07, 0);
          fx.burst(ev.x2, 0.6, ev.z2, 10, [0, 0.9, 1], 2, 0.4, 0.07, 0);
          break;
        case 'in': {
          const t = this.towers.get(ev.f);
          if (!t) break;
          fx.burst(t.x, 1, t.z, 14, [1, 0.85, 0.2], 2.5, 0.9, 0.08, 3);
          this.floatText(t.x, 1.8, t.z, `+${ev.g}`, '#ffd54a');
          break;
        }
        case 'up': {
          const t = this.towers.get(ev.f);
          if (t) this.floatText(t.x, 1.8, t.z, ev.lv === 4 ? 'UZMAN!' : `Sv ${ev.lv}`, '#fff59d');
          break;
        }
        case 'hq':
          fx.ring(0, 0, 1, 3.5, 0.8, [0.3, 0.8, 1], 0.6);
          fx.burst(0, 3, 0, 30, [0.4, 0.85, 1], 4, 1, 0.1, 3);
          break;
        case 'w':
          for (const p of this.portals) { fx.ring(p.x, p.z, 0.3, 2.5, 0.8, p.col, 0.5); }
          break;
      }
    }
  }

  floatText(x, y, z, text, color, big) {
    if (this.floaters.length > 40) return;
    const el = document.createElement('div');
    el.className = 'floater' + (big ? ' big' : '');
    el.textContent = text;
    el.style.color = color;
    this.floatRoot.appendChild(el);
    this.floaters.push({ el, x, y, z, life: 1.2 });
  }

  // ------------------------------------------------------------ imleçler
  setCursors(list) {
    const keep = new Set();
    for (const c of list) {
      keep.add(c.pid);
      let o = this.cursorObjs.get(c.pid);
      if (!o) o = this.makeCursor(c.pid, c.color);
      o.group.visible = true;
      o.tx = c.x; o.tz = c.z;
      if (o.x == null) { o.x = c.x; o.z = c.z; }
      o.range.visible = !!c.range;
      if (c.range) {
        o.range.scale.setScalar(c.range);
        o.rangeFill.scale.setScalar(c.range);
        o.range.material.color.set(c.valid === false ? '#ff5252' : '#ffffff');
      }
      o.rangeFill.visible = !!c.range;
      o.fill.material.opacity = c.valid === false ? 0.15 : 0.3;
      o.arrow.visible = c.arrow !== false;
    }
    for (const [pid, o] of this.cursorObjs) if (!keep.has(pid)) o.group.visible = false;
  }

  makeCursor(pid, color) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const edges = new THREE.Group();
    for (const [x, z, sx, sz] of [[0, -0.48, 1, 0.07], [0, 0.48, 1, 0.07], [-0.48, 0, 0.07, 1], [0.48, 0, 0.07, 1]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.08, sz), mat);
      b.position.set(x, 0.06, z);
      edges.add(b);
    }
    group.add(edges);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }));
    fill.rotation.x = -Math.PI / 2; fill.position.y = 0.04;
    group.add(fill);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 4), mat);
    arrow.rotation.x = Math.PI; arrow.position.y = 1.9;
    group.add(arrow);
    const rg = new THREE.RingGeometry(0.97, 1, 64); rg.rotateX(-Math.PI / 2);
    const range = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    range.position.y = 0.08;
    const cg = new THREE.CircleGeometry(1, 48); cg.rotateX(-Math.PI / 2);
    const rangeFill = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false }));
    rangeFill.position.y = 0.07;
    const rangeRoot = new THREE.Group();
    rangeRoot.add(range); rangeRoot.add(rangeFill);
    group.add(rangeRoot);
    this.scene.add(group);
    const o = { group, fill, arrow, range, rangeFill, x: null, z: null };
    this.cursorObjs.set(pid, o);
    return o;
  }

  // ------------------------------------------------------------ çizim döngüsü
  frame(dt) {
    this.time += dt;
    const T = this.time;
    if (!this.map) { this.renderer.render(this.scene, this.camera); return; }

    // kamera
    const cam = this.cam;
    const pitch = cam.pitch;
    let cx = cam.tx + Math.sin(cam.az) * Math.cos(pitch) * cam.dist;
    let cz = cam.tz + Math.cos(cam.az) * Math.cos(pitch) * cam.dist;
    let cy = Math.sin(pitch) * cam.dist;
    if (this.shake > 0) {
      const s = this.shake * 0.6;
      cx += (Math.random() - 0.5) * s; cy += (Math.random() - 0.5) * s; cz += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 1.5);
    }
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(cam.tx, 0, cam.tz);

    // karargah
    const [hp, maxHp, armor, gun, hqa] = this.hqState;
    this.hqRing.rotation.z += dt * 0.8;
    this.hqRing.position.y = 3.3 + Math.sin(T * 2) * 0.1;
    this.hqGun.visible = gun > 0;
    if (gun > 0) this.hqGun.rotation.y = angLerp(this.hqGun.rotation.y, hqa / 100, Math.min(1, dt * 10));
    this.hqWalls.forEach((w, i) => { w.visible = armor > i; });
    if (maxHp && hp / maxHp < 0.4 && Math.random() < dt * 8) {
      this.fx.particle({ pool: 'glow', x: (Math.random() - 0.5) * 2, y: 2, z: (Math.random() - 0.5) * 2, vy: 1.2, life: 0.8, s0: 0.25, s1: 0.5, r: 0.8, gg: 0.25, b: 0.05 });
    }
    for (const p of this.portals) p.inner.material.opacity = 0.45 + Math.sin(T * 3) * 0.15;

    // kuleler
    for (const t of this.towers.values()) {
      if (t.spin) { t.head.rotation.y += dt * (t.type === 'radar' ? 1.5 : 0.8); t.yaw = t.head.rotation.y; }
      else { t.yaw = angLerp(t.yaw, t.targetYaw, Math.min(1, dt * 12)); t.head.rotation.y = t.yaw; }
      if (t.type === 'gravity' || t.type === 'frost') t.head.position.y = (t.type === 'gravity' ? 0.62 : 0.62) + Math.sin(T * 2 + t.id) * 0.06;
      if (t.pop > 0) { t.pop = Math.max(0, t.pop - dt); const k = 1 - t.pop / 0.35; t.group.scale.setScalar(M.towerGeometry(t.type, t.def, t.level, t.spec).scale * (0.4 + 0.6 * easeOutBack(k))); }
    }
    // sürekli efektler (lazer / alev)
    const act = this.act;
    for (let i = 0; i < act.length;) {
      const id = act[i], n = act[i + 1];
      const t = this.towers.get(id);
      if (n === 0) {
        if (t) {
          const m = this.muzzle(t, 0.55);
          for (let k = 0; k < 2; k++) {
            const a = t.yaw + (Math.random() - 0.5) * 0.7, sp = 4 + Math.random() * 2;
            this.fx.particle({ pool: 'glow', x: m.x, y: m.y, z: m.z, vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, vy: 0.3 + Math.random() * 0.5, life: 0.4, s0: 0.1, s1: 0.4, r: 1, gg: 0.45 + Math.random() * 0.3, b: 0.1 });
          }
        }
        i += 2;
      } else {
        const ramp = act[i + 2 + n] / 10;
        if (t) {
          const m = this.muzzle(t, 0.35);
          for (let k = 0; k < n; k++) {
            const p = this.enemyPos(act[i + 2 + k]);
            if (!p) continue;
            const w = 0.03 + ramp * 0.012;
            this.fx.frameBeam(m, p, w * 2.2, [0.6, 0.1, 0.3]);
            this.fx.frameBeam(m, p, w, [1, 0.5, 0.8]);
            if (Math.random() < 0.3) this.fx.particle({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3, life: 0.25, s0: 0.06, s1: 0.01, r: 1, gg: 0.4, b: 0.7 });
          }
        }
        i += 3 + n;
      }
    }

    // düşmanlar
    this.drawEnemies(dt, T);

    // efektler
    this.fx.update(dt, (id) => this.enemyPos(id));

    // imleçler
    for (const o of this.cursorObjs.values()) {
      if (!o.group.visible) continue;
      o.x += (o.tx - o.x) * Math.min(1, dt * 20);
      o.z += (o.tz - o.z) * Math.min(1, dt * 20);
      o.group.position.set(o.x, 0, o.z);
      o.arrow.position.y = 1.9 + Math.sin(T * 5) * 0.15;
      o.arrow.rotation.y += dt * 2;
    }

    // yüzen yazılar
    const fl = this.floaters;
    let w = 0;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      f.life -= dt; f.y += dt * 1.2;
      if (f.life <= 0) { f.el.remove(); continue; }
      const s = this.toScreen(f.x, f.y, f.z);
      f.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
      f.el.style.opacity = Math.min(1, f.life * 2);
      fl[w++] = f;
    }
    fl.length = w;

    this.renderer.render(this.scene, this.camera);
  }

  getEnemyMesh(type, def, need = 1) {
    let em = this.enemyMeshes.get(type);
    if (em && em.cap >= need) return em;
    let cap = em ? em.cap : (def.boss ? 8 : 64);
    while (cap < need) cap *= 2;
    if (em) { if (em.lit) this.enemyRoot.remove(em.lit); if (em.glow) this.enemyRoot.remove(em.glow); }
    const geo = M.enemyGeometry(type, def);
    const mk = (g, mat) => {
      if (!g) return null;
      const im = new THREE.InstancedMesh(g, mat, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, _c.set(1, 1, 1));
      im.frustumCulled = false; im.castShadow = true; im.count = 0;
      this.enemyRoot.add(im);
      return im;
    };
    em = { cap, lit: mk(geo.lit, def.stealth ? M.ghostMaterial : M.litMaterial), glow: mk(geo.glow, M.glowMaterial), n: 0 };
    this.enemyMeshes.set(type, em);
    return em;
  }

  drawEnemies(dt, T) {
    const counts = new Map();
    for (const en of this.enemies.values()) counts.set(en.type, (counts.get(en.type) || 0) + 1);
    for (const [type, n] of counts) this.getEnemyMesh(type, ENEMIES[type], n);
    for (const em of this.enemyMeshes.values()) em.n = 0;

    const camQ = this.camera.quaternion;
    const right = _v.set(1, 0, 0).applyQuaternion(camQ).clone();
    let nb = 0, nbub = 0;
    for (const en of this.enemies.values()) {
      en.t += dt / this.snapInterval;
      const a = Math.min(1, en.t);
      const nx = en.fx + (en.tx - en.fx) * a, nz = en.fz + (en.tz - en.fz) * a;
      const mdx = nx - en.x, mdz = nz - en.z;
      if (mdx * mdx + mdz * mdz > 1e-6) en.yaw = angLerp(en.yaw, Math.atan2(mdx, mdz), Math.min(1, dt * 10));
      en.x = nx; en.z = nz;
      const def = en.def;
      const fly = def.flying;
      const bob = fly ? Math.sin(T * 2 + en.phase) * 0.15 : Math.abs(Math.sin(T * 9 * def.speed + en.phase)) * 0.06;
      en.y = fly ? (def.boss ? 2.6 : 1.7) + bob : bob;
      const sc = def.size * (def.boss ? 1.25 : 1.7);
      const ox = Math.cos(en.yaw) * en.off, oz = -Math.sin(en.yaw) * en.off;
      const px = en.x + ox, pz = en.z + oz;
      const em = this.enemyMeshes.get(en.type);
      if (em.n >= em.cap) continue;
      const stunned = en.flags & 16;
      const wob = stunned ? Math.sin(T * 30) * 0.15 : 0;
      _e.set(wob, en.yaw, fly ? Math.sin(T * 1.5 + en.phase) * 0.1 : 0);
      _q.setFromEuler(_e);
      _m.compose(_p.set(px, en.y, pz), _q, _s.set(sc, sc, sc));
      if (em.lit) em.lit.setMatrixAt(em.n, _m);
      if (em.glow) em.glow.setMatrixAt(em.n, _m);
      // durum renkleri
      let r = 1, g = 1, b = 1;
      if (en.flags & 1) { r = 0.3; g = 0.3; b = 0.45; }
      if (en.flags & 2) { r *= 0.6; g *= 0.85; b *= 1.6; }
      if (en.flags & 4) { r *= 1.6; g *= 0.8; b *= 0.5; }
      if (en.flags & 8) { r *= 0.7; g *= 1.5; b *= 0.6; }
      if (stunned) { r *= 1.4; g *= 1.4; b *= 0.6; }
      if (en.flags & 64) { r *= 1.3; g *= 0.7; b *= 0.7; }
      if (em.lit) em.lit.setColorAt(em.n, _c.setRGB(r, g, b));
      em.n++;
      // yanma / zehir parçacıkları
      if ((en.flags & 4) && Math.random() < dt * 10) this.fx.particle({ pool: 'glow', x: px, y: en.y + sc * 0.5, z: pz, vy: 1.5, life: 0.4, s0: 0.12, s1: 0.02, r: 1, gg: 0.45, b: 0.1 });
      if ((en.flags & 8) && Math.random() < dt * 6) this.fx.particle({ pool: 'glow', x: px, y: en.y + sc * 0.5, z: pz, vy: 0.8, life: 0.5, s0: 0.1, s1: 0.02, r: 0.3, gg: 1, b: 0.2 });
      // kalkan
      if ((en.flags & 32) && nbub < 400) {
        _m.compose(_p.set(px, en.y + sc * 0.45, pz), _q.identity(), _s.setScalar(sc * 0.75));
        this.bubbles.setMatrixAt(nbub++, _m);
      }
      // can barı
      if ((en.hp < 100 || def.boss) && !(en.flags & 1) && nb < 800) {
        const w = def.boss ? 2.2 : 0.8, h = def.boss ? 0.16 : 0.09;
        const y = en.y + sc * (fly ? 0.6 : 1.25) + 0.25;
        _m.compose(_p.set(px, y, pz), camQ, _s.set(w + 0.06, h + 0.05, 1));
        this.barBg.setMatrixAt(nb, _m);
        const f = en.hp / 100;
        _p.set(px, y, pz).addScaledVector(right, -(1 - f) * w / 2);
        _m.compose(_p, camQ, _s.set(w * f, h, 1));
        this.barFg.setMatrixAt(nb, _m);
        if (en.flags & 32) _c.setRGB(0.5, 0.7, 1);
        else if (f > 0.5) _c.setRGB(0.3, 0.9, 0.3);
        else if (f > 0.25) _c.setRGB(1, 0.8, 0.2);
        else _c.setRGB(1, 0.25, 0.2);
        this.barFg.setColorAt(nb, _c);
        nb++;
      }
    }
    for (const em of this.enemyMeshes.values()) {
      for (const im of [em.lit, em.glow]) {
        if (!im) continue;
        im.count = em.n;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
    this.barBg.count = nb; this.barFg.count = nb;
    this.barBg.instanceMatrix.needsUpdate = true; this.barFg.instanceMatrix.needsUpdate = true;
    if (this.barFg.instanceColor) this.barFg.instanceColor.needsUpdate = true;
    this.bubbles.count = nbub; this.bubbles.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.clearWorld();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.floatRoot.remove();
  }
}

function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

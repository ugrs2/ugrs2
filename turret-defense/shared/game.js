// Oyun simülasyonu (otoriter). Sunucuda veya yerel modda tarayıcıda çalışır.
import {
  TOWERS, TOWER_ORDER, ENEMIES, ENEMY_ORDER, BOSS_ORDER, STAGES, DIFFICULTIES, LANE_SETS,
  LEVEL_MULT, upgradeCost, SELL_RATIO, xpToNext, MAX_PLAYER_LEVEL, LEVEL_DMG_BONUS, STRIKE, HQ,
  PLAYER_COLORS, sanitizePerks, starsFor,
} from './data.js';
import { buildMap, pointAt, cellAt, CELL, mulberry32, HQ_R } from './map.js';

const TOWER_INDEX = Object.fromEntries(TOWER_ORDER.map((k, i) => [k, i]));
const ENEMY_INDEX = Object.fromEntries(ENEMY_ORDER.map((k, i) => [k, i]));
const SPEC_INDEX = { A: 1, B: 2 };
const FIRST_WAVE_DELAY = 30;
const BUILD_TIME = 15;

export class Game {
  constructor(opts = {}) {
    const { stageId = 1, difficulty = 1, players = [] } = opts;
    this.stage = STAGES.find(s => s.id === stageId) || STAGES[0];
    this.diff = DIFFICULTIES[difficulty] || DIFFICULTIES[1];
    this.difficulty = this.diff.id;
    const n = Math.max(1, Math.min(4, players.length || 1));
    this.lanes = LANE_SETS[n];
    this.seed = this.stage.seed * 1000 + n;
    this.map = buildMap(this.stage.template, this.lanes, this.seed);
    this.rng = mulberry32(this.seed ^ 0x9e3779b9);

    this.players = new Map();
    this.towers = [];
    this.towerAt = new Map();
    this.enemies = [];
    this.enemyById = new Map();
    this.projectiles = [];
    this.fields = [];
    this.strikes = [];
    this.events = [];
    this.nextId = 1;
    this.time = 0;
    this.wave = 0;
    this.totalWaves = this.stage.waves; // 0 = sonsuz
    this.phase = 'build';
    this.timer = FIRST_WAVE_DELAY;
    this.spawnQueue = [];
    this.waveTime = 0;
    this.paused = false;
    this.speed = 1;
    this.towersDirty = true;
    this.result = null;
    this.stats = { kills: 0, leaks: 0, bossKills: 0 };
    this.seenTypes = new Set();

    players.forEach((p, i) => this.addPlayer(p, i));

    let hqPerk = 0;
    for (const p of this.players.values()) hqPerk = Math.max(hqPerk, p.perks.hq);
    const maxHp = Math.round(HQ.baseHp * this.diff.hq * (1 + 0.5 * (n - 1)) + hqPerk * 10);
    this.hq = { hp: maxHp, maxHp, armor: 0, gun: 0, cd: 0, angle: 0 };
  }

  // ------------------------------------------------------------ oyuncular
  addPlayer(info, order) {
    const perks = sanitizePerks(info.perks);
    const lane = this.lanes[(order ?? this.players.size) % this.lanes.length];
    const catchUp = this.wave > 0 ? this.wave * 40 : 0;
    const p = {
      pid: info.pid, name: info.name || 'Oyuncu', color: PLAYER_COLORS[info.pid % 4], perks, lane,
      gold: Math.round(300 + perks.gold * 40 + catchUp), xp: 0, level: 1, kills: 0, dmg: 0, built: 0,
      cx: 0, cz: 0, strikeCd: 0,
    };
    // İmleci kendi koridorunun girişine yakın başlat
    const path = this.map.paths[lane];
    if (path) { const pt = pointAt(path, 8); p.cx = Math.round(pt.x); p.cz = Math.round(pt.z); }
    this.players.set(p.pid, p);
    return p;
  }

  playerInfo() {
    return [...this.players.values()].map(p => ({ pid: p.pid, name: p.name, color: p.color, lane: p.lane }));
  }

  ev(e) { this.events.push(e); }

  // ------------------------------------------------------------ istatistik hesaplama
  towerStats(t) {
    const def = TOWERS[t.type];
    const s = { ...def };
    delete s.specs;
    if (t.spec) {
      const sp = def.specs[t.spec];
      if (sp.set) Object.assign(s, sp.set);
    }
    const lv = Math.min(t.level, 3) - 1;
    const dm = Math.pow(LEVEL_MULT.dmg, lv);
    if (s.dmg) s.dmg *= dm;
    if (s.burn) s.burn *= dm;
    if (s.poison) s.poison *= dm;
    if (s.fireField) s.fireField *= dm;
    if (s.range) s.range *= Math.pow(LEVEL_MULT.range, lv);
    if (s.rate) s.rate *= Math.pow(LEVEL_MULT.rate, lv);
    if (s.splash) s.splash *= Math.pow(LEVEL_MULT.splash, lv);
    if (s.income) s.income *= Math.pow(LEVEL_MULT.income, lv);
    if (s.kind === 'aura') { s.buffDmg *= 1 + 0.25 * lv; s.reveal *= 1 + 0.1 * lv; }
    if (t.spec) {
      const mods = def.specs[t.spec].mods || {};
      for (const k in mods) if (typeof s[k] === 'number') s[k] *= mods[k];
    }
    const owner = this.players.get(t.owner);
    if (owner) {
      const b = 1 + (owner.level - 1) * LEVEL_DMG_BONUS + owner.perks.dmg * 0.04;
      if (s.dmg) s.dmg *= b;
      if (s.burn) s.burn *= b;
      if (s.poison) s.poison *= b;
      if (s.fireField) s.fireField *= b;
    }
    return s;
  }

  recalcAll() {
    const radars = [];
    for (const t of this.towers) {
      if (t.type === 'radar') { t.s = this.towerStats(t); radars.push(t); }
    }
    for (const t of this.towers) {
      if (t.type === 'radar') continue;
      const s = this.towerStats(t);
      let bd = 0, br = 0, brt = 0;
      for (const r of radars) {
        const d2 = (r.x - t.x) ** 2 + (r.z - t.z) ** 2;
        if (d2 <= r.s.range * r.s.range) {
          bd = Math.max(bd, r.s.buffDmg); br = Math.max(br, r.s.buffRange); brt = Math.max(brt, r.s.buffRate || 0);
        }
      }
      if (bd) { if (s.dmg) s.dmg *= 1 + bd; if (s.burn) s.burn *= 1 + bd; if (s.poison) s.poison *= 1 + bd; }
      if (br && s.range) s.range *= 1 + br;
      if (brt && s.rate) s.rate *= 1 + brt;
      s.buffed = bd > 0;
      t.s = s;
    }
  }

  costFor(p, base) { return Math.round(base * (1 - p.perks.cost * 0.03)); }

  // ------------------------------------------------------------ oyuncu eylemleri
  handle(pid, a) {
    const p = this.players.get(pid);
    if (!p || !a || this.result) return;
    switch (a.a) {
      case 'cur':
        p.cx = clampInt(a.x, -this.map.half, this.map.half);
        p.cz = clampInt(a.z, -this.map.half, this.map.half);
        break;
      case 'build': this.build(p, a.type, clampInt(a.x, -99, 99), clampInt(a.z, -99, 99)); break;
      case 'up': this.upgrade(p, this.towerById(a.id)); break;
      case 'spec': this.specialize(p, this.towerById(a.id), a.s); break;
      case 'sell': this.sell(p, this.towerById(a.id)); break;
      case 'mode': {
        const t = this.towerById(a.id);
        if (t) { t.mode = (t.mode + 1) % 4; this.towersDirty = true; }
        break;
      }
      case 'strike': this.strike(p, Number(a.x) || 0, Number(a.z) || 0); break;
      case 'next': if (this.phase === 'build') this.callWave(p); break;
      case 'hq': this.hqUpgrade(p, a.u); break;
      case 'pause': this.paused = !this.paused; this.ev({ k: 'pz', v: this.paused, p: pid }); break;
      case 'speed': this.speed = this.speed === 1 ? 2 : 1; this.ev({ k: 'spd', v: this.speed, p: pid }); break;
      case 'gift': {
        // En az altını olan takım arkadaşına 100 altın gönder
        let target = null;
        for (const o of this.players.values()) if (o !== p && (!target || o.gold < target.gold)) target = o;
        const amt = Math.min(100, Math.floor(p.gold));
        if (target && amt > 0) { p.gold -= amt; target.gold += amt; this.ev({ k: 'gf', p: pid, to: target.pid, g: amt }); }
        break;
      }
    }
  }

  err(p, text) { this.ev({ k: 'x', p: p.pid, text }); }

  towerById(id) { return this.towers.find(t => t.id === id); }

  build(p, type, x, z) {
    const def = TOWERS[type];
    if (!def) return;
    if (cellAt(this.map, x, z) !== CELL.EMPTY || this.towerAt.has(key(x, z))) return this.err(p, 'Buraya inşa edilemez');
    if (p.level < def.unlock) return this.err(p, `${def.name} için seviye ${def.unlock} gerekli`);
    const cost = this.costFor(p, def.cost);
    if (p.gold < cost) return this.err(p, 'Yetersiz altın');
    p.gold -= cost;
    const t = { id: this.nextId++, type, x, z, owner: p.pid, level: 1, spec: null, spent: cost, cd: 0.2, angle: Math.atan2(-x, -z), mode: 0, ramp: 0, beamIds: [], lastFire: -9, kills: 0 };
    this.towers.push(t);
    this.towerAt.set(key(x, z), t);
    p.built++;
    this.recalcAll();
    this.towersDirty = true;
    this.ev({ k: 'bd', f: t.id, x, z, p: p.pid, t: type });
  }

  upgrade(p, t) {
    if (!t) return;
    if (t.level >= 3) return this.err(p, 'Uzmanlık seçmelisin');
    const cost = this.costFor(p, upgradeCost(TOWERS[t.type], t.level));
    if (p.gold < cost) return this.err(p, 'Yetersiz altın');
    p.gold -= cost; t.spent += cost; t.level++;
    this.recalcAll(); this.towersDirty = true;
    this.ev({ k: 'up', f: t.id, lv: t.level, p: p.pid });
  }

  specialize(p, t, s) {
    if (!t || t.level !== 3 || !(s === 'A' || s === 'B')) return;
    const cost = this.costFor(p, upgradeCost(TOWERS[t.type], 3));
    if (p.gold < cost) return this.err(p, 'Yetersiz altın');
    p.gold -= cost; t.spent += cost; t.level = 4; t.spec = s;
    this.recalcAll(); this.towersDirty = true;
    this.ev({ k: 'up', f: t.id, lv: 4, p: p.pid });
  }

  sell(p, t) {
    if (!t) return;
    if (t.owner !== p.pid && this.players.has(t.owner) && !this.players.get(t.owner).gone) return this.err(p, 'Sadece kendi kuleni satabilirsin');
    const g = Math.floor(t.spent * SELL_RATIO);
    p.gold += g;
    this.towers.splice(this.towers.indexOf(t), 1);
    this.towerAt.delete(key(t.x, t.z));
    this.recalcAll(); this.towersDirty = true;
    this.ev({ k: 'sl', x: t.x, z: t.z, g, p: p.pid });
  }

  strike(p, x, z) {
    if (p.level < STRIKE.unlock) return this.err(p, `Hava saldırısı seviye ${STRIKE.unlock}'de açılır`);
    if (p.strikeCd > 0) return this.err(p, 'Hava saldırısı hazır değil');
    const dmg = STRIKE.dmg * (1 + 0.15 * (p.level - 1)) * (1 + 0.15 * p.perks.air) * (1 + this.wave * 0.06);
    this.strikes.push({ x, z, t: STRIKE.delay, pid: p.pid, dmg, r: STRIKE.radius });
    p.strikeCd = STRIKE.cooldown * (1 - 0.1 * p.perks.air);
    this.ev({ k: 'st', x, z, r: STRIKE.radius, d: STRIKE.delay, p: p.pid });
  }

  hqUpgrade(p, u) {
    const hq = this.hq;
    if (u === 'repair') {
      if (hq.hp >= hq.maxHp) return this.err(p, 'Karargah zaten tam');
      if (p.gold < HQ.repair.cost) return this.err(p, 'Yetersiz altın');
      p.gold -= HQ.repair.cost;
      hq.hp = Math.min(hq.maxHp, hq.hp + hq.maxHp * HQ.repair.amount);
    } else if (u === 'armor') {
      if (hq.armor >= HQ.armor.costs.length) return;
      const c = HQ.armor.costs[hq.armor];
      if (p.gold < c) return this.err(p, 'Yetersiz altın');
      p.gold -= c; hq.armor++;
    } else if (u === 'gun') {
      if (hq.gun >= HQ.gun.costs.length) return;
      const c = HQ.gun.costs[hq.gun];
      if (p.gold < c) return this.err(p, 'Yetersiz altın');
      p.gold -= c; hq.gun++;
    } else return;
    this.ev({ k: 'hq', u, p: p.pid });
  }

  // ------------------------------------------------------------ dalgalar
  hpScale(w) {
    return (1 + (w - 1) * 0.13 + Math.pow(Math.max(0, w - 20), 1.5) * 0.02) * Math.pow(1.06, Math.max(0, w - 50)) * this.stage.hp * this.diff.hp;
  }
  rewardScale(w) { return (1 + (w - 1) * 0.03) * this.diff.gold * this.stage.gold; }

  callWave(p) {
    const bonus = Math.ceil(this.timer * 3 * this.diff.gold);
    if (bonus > 0 && this.wave > 0) {
      for (const o of this.players.values()) o.gold += bonus;
      this.ev({ k: 'm', text: `${p.name} dalgayı erken çağırdı: herkese +${bonus} altın` });
    }
    this.startWave();
  }

  planWave(w) {
    const rnd = this.rng;
    const list = []; // {t, type}
    let t = 0;
    const isBoss = w % 10 === 0;
    const special = !isBoss && w % 5 === 0;
    let name = `Dalga ${w}`;
    let budget = 6 + w * 2.3 + Math.pow(w, 1.35) * 0.35;
    const pool = ENEMY_ORDER.filter(k => { const d = ENEMIES[k]; return !d.boss && d.wave <= w && d.cost > 0; });
    let spPool = pool;
    if (special) {
      const themes = [
        { name: 'Hava Saldırısı', types: ['drone', 'bomber'] },
        { name: 'Sürü İstilası', types: ['swarm', 'runner', 'splitter'] },
        { name: 'Zırhlı Tümen', types: ['brute', 'tank', 'golem'] },
        { name: 'Gölge Birliği', types: ['ghost', 'phaser', 'runner'] },
        { name: 'Kalkan Duvarı', types: ['shield', 'healer', 'brute'] },
      ].map(th => ({ ...th, types: th.types.filter(k => ENEMIES[k].wave <= w) })).filter(th => th.types.length);
      const th = themes[Math.floor(rnd() * themes.length)];
      if (th) { spPool = th.types; name = `Dalga ${w}: ${th.name}`; budget *= 1.15; }
    }
    if (isBoss) {
      const bosses = 1 + Math.floor(w / 40);
      const bt = BOSS_ORDER[(w / 10 - 1) % BOSS_ORDER.length];
      name = `Dalga ${w}: ${ENEMIES[bt].name}!`;
      budget *= 0.5;
      for (let i = 0; i < bosses; i++) list.push({ t: 4 + i * 6, type: bt });
    }
    const gap = Math.max(0.35, 1.0 - w * 0.012);
    while (budget > 0.3) {
      let type = spPool[Math.floor(rnd() * spPool.length)];
      // Erken dalgalarda yeni tipler çok ağır basmasın
      if (!special && rnd() < Math.max(0.15, 0.6 - w * 0.03)) type = w >= 2 && rnd() < 0.4 ? 'runner' : 'grunt';
      if (ENEMIES[type].wave > w) type = 'grunt';
      const d = ENEMIES[type];
      const g = d.group;
      for (let i = 0; i < g; i++) {
        list.push({ t, type });
        t += g > 1 ? 0.28 : gap;
      }
      t += gap * 0.8;
      budget -= d.cost * g;
    }
    list.sort((a, b) => a.t - b.t);
    return { list, name, isBoss };
  }

  startWave() {
    this.wave++;
    this.phase = 'wave';
    this.timer = 0;
    this.waveTime = 0;
    const plan = this.planWave(this.wave);
    this.spawnQueue = [];
    for (const lane of this.lanes) {
      const off = this.rng() * 0.6;
      for (const s of plan.list) this.spawnQueue.push({ t: s.t + off, type: s.type, lane });
    }
    this.spawnQueue.sort((a, b) => a.t - b.t);
    const newTypes = [];
    for (const s of plan.list) if (!this.seenTypes.has(s.type)) { this.seenTypes.add(s.type); newTypes.push(s.type); }
    this.ev({ k: 'w', w: this.wave, name: plan.name, boss: plan.isBoss, nt: newTypes });
  }

  endWave() {
    const w = this.wave;
    const bonus = Math.round((40 + 6 * w) * this.diff.gold);
    for (const p of this.players.values()) {
      p.gold += bonus;
      this.gainXp(p, 10 + 3 * w);
    }
    for (const t of this.towers) {
      if (t.s.kind !== 'eco') continue;
      const o = this.players.get(t.owner);
      if (!o) continue;
      let g = Math.round(t.s.income);
      if (t.s.interest) g += Math.min(150, Math.floor(o.gold * t.s.interest));
      o.gold += g;
      this.ev({ k: 'in', f: t.id, g });
    }
    this.ev({ k: 'wc', w, g: bonus });
    if (this.totalWaves && w >= this.totalWaves) return this.finish(true);
    this.phase = 'build';
    this.timer = BUILD_TIME;
  }

  finish(win) {
    this.phase = win ? 'won' : 'lost';
    const hqFrac = Math.max(0, this.hq.hp / this.hq.maxHp);
    const stars = starsFor(this.stage, win, hqFrac, win ? this.wave : this.wave - 1);
    this.result = {
      win, stars, stageId: this.stage.id, difficulty: this.difficulty, wave: this.wave, hqFrac,
      kills: this.stats.kills, leaks: this.stats.leaks,
      players: [...this.players.values()].map(p => ({ pid: p.pid, name: p.name, kills: p.kills, dmg: Math.round(p.dmg), level: p.level, built: p.built })),
    };
    this.ev({ k: 'end', win });
  }

  // ------------------------------------------------------------ düşmanlar
  spawnEnemy(type, lane, o = {}) {
    const def = ENEMIES[type];
    const flying = !!def.flying;
    const path = flying ? this.map.airPaths[lane] : this.map.paths[lane];
    if (!path) return null;
    const w = Math.max(1, this.wave);
    const hpMult = this.hpScale(w) * (o.hpMult || 1);
    const hp = def.hp * hpMult;
    const e = {
      id: this.nextId++, type, ti: ENEMY_INDEX[type], def, lane, path, d: o.d || 0, x: 0, z: 0,
      hp, maxHp: hp, shield: (def.shield || 0) * hpMult, maxShield: (def.shield || 0) * hpMult, shieldT: 0,
      speed: def.speed * (1 + Math.min(0.3, w * 0.004)), armor: (def.armor || 0) * (1 + w * 0.02),
      slow: 0, slowT: 0, stunT: 0, burn: 0, burnT: 0, burnPid: null, poison: 0, poisonT: 0, poisonPid: null,
      shredT: 0, markT: 0, markAmt: 0, flying, stealth: !!def.stealth, revealed: false,
      reward: Math.max(1, Math.round(def.reward * this.rewardScale(w) * (o.rewardMult ?? 1))),
      xp: def.xp, boss: !!def.boss, dead: false, leaked: false,
      summonT: def.summon ? def.summon.every : 0, blinkT: def.blink ? def.blink.every : 0, healT: 1,
    };
    const pt = pointAt(path, e.d);
    e.x = pt.x; e.z = pt.z;
    this.enemies.push(e);
    this.enemyById.set(e.id, e);
    return e;
  }

  damage(e, amt, dtype, pid, o = {}) {
    if (e.dead || !(amt > 0)) return 0;
    let m = 1;
    const res = e.def.resist;
    if (!o.ignoreResist && res && res[dtype] != null) m *= res[dtype];
    if (e.markT > 0) m *= 1 + e.markAmt;
    if (e.boss && o.bossMult) m *= o.bossMult;
    let dmg = amt * m;
    if (!o.dot && dtype !== 'poison' && e.armor > 0) {
      const armor = e.armor * (e.shredT > 0 ? 0.3 : 1) * (1 - (o.armorPierce || 0)) * (o.armorScale ?? 1);
      dmg = Math.max(dmg * 0.25, dmg - armor);
    }
    if (e.shield > 0 && dtype !== 'poison') {
      const sm = dtype === 'elec' ? 2 : 1;
      const absorbed = Math.min(e.shield, dmg * sm);
      e.shield -= absorbed;
      dmg -= absorbed / sm;
      e.shieldT = 2.5;
    }
    e.hp -= dmg;
    const p = this.players.get(pid);
    if (p) p.dmg += dmg;
    if (e.hp <= 0) this.kill(e, pid, o.tower);
    return dmg;
  }

  kill(e, pid, tower) {
    e.dead = true;
    this.stats.kills++;
    if (e.boss) this.stats.bossKills++;
    const p = this.players.get(pid);
    if (p) {
      p.gold += e.reward; p.kills++;
      this.gainXp(p, e.xp);
    } else {
      // Karargah / sahipsiz: ödül tüm oyunculara paylaştırılır
      const n = this.players.size || 1;
      const g = Math.ceil(e.reward / n);
      for (const o of this.players.values()) { o.gold += g; this.gainXp(o, Math.ceil(e.xp / n)); }
    }
    if (tower) tower.kills++;
    this.ev({ k: 'k', x: r2(e.x), z: r2(e.z), g: e.reward, p: pid ?? -1, t: e.ti, b: e.boss ? 1 : 0, f: e.flying ? 1 : 0 });
    const sp = e.def.split;
    if (sp) {
      for (let i = 0; i < sp.n; i++) {
        this.spawnEnemy(sp.type, e.lane, { d: Math.max(0, e.d - i * 0.35), rewardMult: 1 });
      }
    }
  }

  gainXp(p, amount) {
    p.xp += amount * (1 + p.perks.xp * 0.1);
    let up = false;
    while (p.level < MAX_PLAYER_LEVEL && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      up = true;
      const un = TOWER_ORDER.filter(k => TOWERS[k].unlock === p.level);
      this.ev({ k: 'lv', p: p.pid, l: p.level, un, st: p.level === STRIKE.unlock ? 1 : 0 });
    }
    if (up) { this.recalcAll(); }
  }

  updateEnemies(dt) {
    const tmp = {};
    for (const e of this.enemies) {
      if (e.dead) continue;
      const def = e.def;
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slow = 0; }
      if (e.shredT > 0) e.shredT -= dt;
      if (e.markT > 0) e.markT -= dt;
      if (e.burnT > 0) { e.burnT -= dt; this.damage(e, e.burn * dt, 'fire', e.burnPid, { dot: true }); if (e.dead) continue; }
      if (e.poisonT > 0) { e.poisonT -= dt; this.damage(e, e.poison * dt, 'poison', e.poisonPid, { dot: true }); if (e.dead) continue; }
      if (e.maxShield > 0) {
        if (e.shieldT > 0) e.shieldT -= dt;
        else if (e.shield < e.maxShield) e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.15 * dt);
      }
      if (def.regen && e.poisonT <= 0) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * def.regen * dt);
      if (def.heal) {
        e.healT -= dt;
        if (e.healT <= 0) {
          e.healT = 1;
          let any = false;
          for (const o of this.enemies) {
            if (o.dead || o === e || o.poisonT > 0 || o.hp >= o.maxHp) continue;
            if ((o.x - e.x) ** 2 + (o.z - e.z) ** 2 < 6.25) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * def.heal); any = true; }
          }
          if (any) this.ev({ k: 'h', x: r2(e.x), z: r2(e.z) });
        }
      }
      if (def.summon) {
        e.summonT -= dt;
        if (e.summonT <= 0) {
          e.summonT = def.summon.every;
          for (let i = 0; i < def.summon.n; i++) {
            this.spawnEnemy(def.summon.type, e.lane, { d: Math.max(0, e.d - 0.3 - i * 0.3), rewardMult: 0.5, hpMult: 0.8 });
          }
        }
      }
      if (def.blink && e.stunT <= 0) {
        e.blinkT -= dt;
        if (e.blinkT <= 0) {
          e.blinkT = def.blink.every;
          const x1 = e.x, z1 = e.z;
          e.d = Math.min(e.path.len - 0.5, e.d + def.blink.dist);
          pointAt(e.path, e.d, tmp);
          e.x = tmp.x; e.z = tmp.z;
          this.ev({ k: 'bl', x1: r2(x1), z1: r2(z1), x2: r2(e.x), z2: r2(e.z) });
        }
      }
      if (e.stunT > 0) { e.stunT -= dt; continue; }
      let sp = e.speed;
      if (!def.immuneSlow) sp *= 1 - e.slow;
      if (def.berserk) sp *= 1 + def.berserk * (1 - e.hp / e.maxHp);
      e.d += sp * dt;
      if (e.d >= e.path.len) {
        // Karargaha ulaştı
        e.dead = true; e.leaked = true;
        const dmg = e.def.dmg * (1 - this.hq.armor * HQ.armor.reduce);
        this.hq.hp -= dmg;
        this.stats.leaks++;
        this.ev({ k: 'l', x: r2(e.x), z: r2(e.z), d: Math.round(dmg * 10) / 10 });
        if (this.hq.hp <= 0) { this.hq.hp = 0; this.finish(false); return; }
        continue;
      }
      pointAt(e.path, e.d, tmp);
      e.x = tmp.x; e.z = tmp.z;
    }
  }

  updateReveal() {
    const radars = this.towers.filter(t => t.type === 'radar');
    for (const e of this.enemies) {
      if (e.dead) continue;
      for (const r of radars) {
        if (r.s.mark) {
          const mr = r.s.range * 2;
          if ((r.x - e.x) ** 2 + (r.z - e.z) ** 2 <= mr * mr) { e.markT = 0.3; e.markAmt = Math.max(e.markAmt, r.s.mark); }
        }
      }
      if (!e.stealth) continue;
      let rev = e.x * e.x + e.z * e.z < 16;
      if (!rev) for (const r of radars) {
        if ((r.x - e.x) ** 2 + (r.z - e.z) ** 2 <= r.s.reveal * r.s.reveal) { rev = true; break; }
      }
      if (!rev) for (const t of this.towers) {
        if ((t.x - e.x) ** 2 + (t.z - e.z) ** 2 <= 3.24) { rev = true; break; }
      }
      e.revealed = rev;
    }
  }

  // ------------------------------------------------------------ kuleler
  canHit(s, e) {
    if (e.dead) return false;
    if (e.flying ? !s.air : !s.ground) return false;
    if (e.stealth && !e.revealed) return false;
    return true;
  }

  score(mode, e, x, z) {
    switch (mode) {
      case 1: return e.path.len - e.d; // son
      case 2: return e.hp + e.shield; // güçlü
      case 3: return -((e.x - x) ** 2 + (e.z - z) ** 2); // yakın
      default: return -(e.path.len - e.d); // ilk
    }
  }

  findTargets(t, s, n, x = t.x, z = t.z) {
    const r2max = s.range * s.range;
    const r2min = s.minRange ? s.minRange * s.minRange : -1;
    if (n === 1) {
      let best = null, bs = -Infinity;
      for (const e of this.enemies) {
        if (!this.canHit(s, e)) continue;
        const d2 = (e.x - x) ** 2 + (e.z - z) ** 2;
        if (d2 > r2max || d2 < r2min) continue;
        const sc = this.score(t.mode, e, x, z);
        if (sc > bs) { bs = sc; best = e; }
      }
      return best ? [best] : [];
    }
    const arr = [];
    for (const e of this.enemies) {
      if (!this.canHit(s, e)) continue;
      const d2 = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d2 > r2max || d2 < r2min) continue;
      arr.push([this.score(t.mode, e, x, z), e]);
    }
    arr.sort((a, b) => b[0] - a[0]);
    return arr.slice(0, n).map(a => a[1]);
  }

  aim(t, e) { t.angle = Math.atan2(e.x - t.x, e.z - t.z); }

  updateTowers(dt) {
    for (const t of this.towers) {
      const s = t.s;
      if (s.kind === 'eco' || s.kind === 'aura') continue;
      if (s.kind === 'beam') { this.updateBeam(t, s, dt); continue; }
      t.cd -= dt;
      if (t.cd > 0) continue;
      const targets = this.findTargets(t, s, s.multishot || 1);
      if (!targets.length) { t.cd = 0; continue; }
      t.cd += 1 / s.rate;
      if (t.cd < 0) t.cd = 0;
      const e = targets[0];
      this.aim(t, e);
      t.lastFire = this.time;
      const src = { tower: t, armorPierce: s.armorPierce, bossMult: s.bossMult, ignoreResist: s.ignoreResist };
      switch (s.kind) {
        case 'proj':
          for (const tg of targets) this.fireProj(t, s, tg);
          break;
        case 'lob': {
          const dist = Math.hypot(e.x - t.x, e.z - t.z);
          const tt = dist / s.projSpeed + 0.4;
          const fut = pointAt(e.path, e.d + e.speed * (1 - e.slow) * tt);
          this.projectiles.push({ kind: s.proj, x: t.x, z: t.z, tx: fut.x, tz: fut.z, target: null, speed: s.projSpeed, dmg: s.dmg, dtype: s.dtype, splash: s.splash, s, t, pid: t.owner, life: 6 });
          this.ev({ k: 'f', f: t.id, p: s.proj, x: r2(fut.x), z: r2(fut.z), s: s.projSpeed });
          break;
        }
        case 'hitscan': {
          let dmg = s.dmg;
          const crit = this.rng() < (s.crit || 0);
          if (crit) dmg *= s.critMult;
          this.damage(e, dmg, s.dtype, t.owner, src);
          this.ev({ k: 'r', f: t.id, e: e.id, c: crit ? 1 : 0 });
          break;
        }
        case 'rail': {
          const dx = e.x - t.x, dz = e.z - t.z, l = Math.hypot(dx, dz) || 1;
          const ux = dx / l, uz = dz / l;
          const len = s.range;
          for (const o of this.enemies) {
            if (o.dead || (o.stealth && !o.revealed)) continue;
            const px = o.x - t.x, pz = o.z - t.z;
            const along = px * ux + pz * uz;
            if (along < 0 || along > len) continue;
            const perp = Math.abs(px * uz - pz * ux);
            if (perp <= 0.55 + o.def.size * 0.3) {
              this.damage(o, s.dmg, s.dtype, t.owner, src);
              if (s.stun && !o.def.immuneStun) o.stunT = Math.max(o.stunT, s.stun);
            }
          }
          this.ev({ k: 'rl', f: t.id, x: r2(t.x + ux * len), z: r2(t.z + uz * len) });
          break;
        }
        case 'pulse': {
          let n = 0;
          for (const o of this.enemies) {
            if (!this.canHit(s, o)) continue;
            if ((o.x - t.x) ** 2 + (o.z - t.z) ** 2 > s.range * s.range) continue;
            this.damage(o, s.dmg, s.dtype, t.owner, src);
            this.applySlow(o, s.slow, s.slowDur);
            if (s.freezeChance && !o.def.immuneStun && !o.def.immuneSlow && this.rng() < s.freezeChance) o.stunT = Math.max(o.stunT, 1);
            n++;
          }
          this.ev({ k: 'pu', f: t.id, r: r2(s.range) });
          break;
        }
        case 'flame': {
          const ang = t.angle;
          const cosCone = Math.cos(s.cone);
          const fx = Math.sin(ang), fz = Math.cos(ang);
          for (const o of this.enemies) {
            if (!this.canHit(s, o)) continue;
            const px = o.x - t.x, pz = o.z - t.z;
            const d2 = px * px + pz * pz;
            if (d2 > s.range * s.range) continue;
            const d = Math.sqrt(d2) || 1;
            if ((px * fx + pz * fz) / d < cosCone && d > 0.7) continue;
            this.damage(o, s.dmg, s.dtype, t.owner, src);
            o.burn = Math.max(o.burnT > 0 ? o.burn : 0, s.burn); o.burnT = Math.max(o.burnT, s.burnDur); o.burnPid = t.owner;
          }
          break;
        }
        case 'chain': {
          const hit = new Set();
          let cur = e, dmg = s.dmg;
          const ids = [];
          for (let i = 0; i < s.chain && cur; i++) {
            hit.add(cur);
            ids.push(cur.id);
            this.damage(cur, dmg, s.dtype, t.owner, src);
            if (s.stun && !cur.def.immuneStun) cur.stunT = Math.max(cur.stunT, s.stun);
            dmg *= 0.85;
            let next = null, nd = s.chainRange * s.chainRange;
            for (const o of this.enemies) {
              if (hit.has(o) || !this.canHit(s, o)) continue;
              const d2 = (o.x - cur.x) ** 2 + (o.z - cur.z) ** 2;
              if (d2 < nd) { nd = d2; next = o; }
            }
            cur = next;
          }
          this.ev({ k: 'c', f: t.id, ids });
          break;
        }
        case 'grav': {
          const gx = e.x, gz = e.z;
          for (const o of this.enemies) {
            if (o.dead) continue;
            if ((o.x - gx) ** 2 + (o.z - gz) ** 2 > s.radius * s.radius) continue;
            this.damage(o, s.dmg, s.dtype, t.owner, src);
            if (o.dead) continue;
            o.d = Math.max(0, o.d - s.pull * (o.boss ? 0.3 : 1));
            if (s.slow) this.applySlow(o, s.slow, s.slowDur);
            if (s.stun && !o.def.immuneStun) o.stunT = Math.max(o.stunT, s.stun);
          }
          this.ev({ k: 'g', f: t.id, x: r2(gx), z: r2(gz), r: s.radius });
          break;
        }
      }
    }
  }

  applySlow(e, amt, dur) {
    if (e.def.immuneSlow || !amt) return;
    if (amt >= e.slow) { e.slow = amt; e.slowT = Math.max(e.slowT, dur); }
    else e.slowT = Math.max(e.slowT, dur * 0.5);
  }

  fireProj(t, s, e) {
    this.projectiles.push({
      kind: s.proj, x: t.x, z: t.z, tx: e.x, tz: e.z, target: e.id, speed: s.projSpeed,
      dmg: s.dmg, dtype: s.dtype, splash: s.splash || 0, s, t, pid: t.owner, life: 5,
    });
    this.ev({ k: 'f', f: t.id, e: e.id, p: s.proj, s: s.projSpeed });
  }

  updateBeam(t, s, dt) {
    const n = s.beams || 1;
    const targets = this.findTargets(t, s, n);
    if (!targets.length) { t.ramp = 0; t.beamIds = []; return; }
    const ids = targets.map(e => e.id);
    if (ids[0] === t.beamIds[0]) t.ramp = Math.min(s.rampMax - 1, t.ramp + dt * (s.rampMax - 1) / s.rampTime);
    else t.ramp = 0;
    t.beamIds = ids;
    this.aim(t, targets[0]);
    t.lastFire = this.time;
    const src = { tower: t, armorScale: dt * 3, ignoreResist: s.ignoreResist };
    for (const e of targets) this.damage(e, s.dmg * (1 + t.ramp) * dt, s.dtype, t.owner, src);
  }

  updateHq(dt) {
    const hq = this.hq;
    if (!hq.gun) return;
    hq.cd -= dt;
    if (hq.cd > 0) return;
    const s = { range: HQ.gun.range, ground: true, air: true };
    let best = null, bd = Infinity;
    for (const e of this.enemies) {
      if (!this.canHit(s, e)) continue;
      const d2 = e.x * e.x + e.z * e.z;
      if (d2 < bd && d2 <= s.range * s.range) { bd = d2; best = e; }
    }
    if (!best) { hq.cd = 0; return; }
    hq.cd = 1 / HQ.gun.rate;
    hq.angle = Math.atan2(best.x, best.z);
    const dmg = HQ.gun.dmg[hq.gun] * (1 + this.wave * 0.08);
    this.projectiles.push({ kind: 'shell', x: 0, z: 0, tx: best.x, tz: best.z, target: best.id, speed: 16, dmg, dtype: 'expl', splash: 0.8, s: { ground: true, air: true }, t: null, pid: null, life: 4 });
    this.ev({ k: 'f', f: 0, e: best.id, p: 'shell', s: 16 });
  }

  updateProjectiles(dt) {
    const out = [];
    for (const p of this.projectiles) {
      p.life -= dt;
      if (p.target != null) {
        const e = this.enemyById.get(p.target);
        if (e && !e.dead) { p.tx = e.x; p.tz = e.z; }
        else if (!p.splash) continue; // hedef öldü, mermi boşa gitti
      }
      const dx = p.tx - p.x, dz = p.tz - p.z;
      const dist = Math.hypot(dx, dz);
      const step = p.speed * dt;
      if (dist <= step + 0.05) { this.projHit(p); continue; }
      p.x += dx / dist * step; p.z += dz / dist * step;
      if (p.life > 0) out.push(p);
    }
    this.projectiles = out;
  }

  projHit(p) {
    const s = p.s;
    const src = { tower: p.t, armorPierce: s.armorPierce, bossMult: s.bossMult, ignoreResist: s.ignoreResist };
    if (p.splash > 0) {
      const r2 = p.splash * p.splash;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (e.flying ? !s.air : !s.ground) continue;
        const d2 = (e.x - p.tx) ** 2 + (e.z - p.tz) ** 2;
        if (d2 > r2) continue;
        const fall = e.id === p.target ? 1 : 1 - 0.4 * Math.sqrt(d2) / p.splash;
        this.onHitEffects(e, s, p.pid);
        this.damage(e, p.dmg * fall, p.dtype, p.pid, src);
      }
      if (s.fireField) this.fields.push({ x: p.tx, z: p.tz, r: p.splash, t: 4, dps: s.fireField, pid: p.pid });
      this.ev({ k: 'b', x: r2f(p.tx), z: r2f(p.tz), r: r2f(p.splash), p: p.kind, ff: s.fireField ? 1 : 0 });
    } else {
      const e = this.enemyById.get(p.target);
      if (e && !e.dead) {
        this.onHitEffects(e, s, p.pid);
        this.damage(e, p.dmg, p.dtype, p.pid, src);
      }
    }
  }

  onHitEffects(e, s, pid) {
    if (s.stun && !e.def.immuneStun) e.stunT = Math.max(e.stunT, s.stun * (e.boss ? 0.3 : 1));
    if (s.poison) { e.poison = Math.max(e.poisonT > 0 ? e.poison : 0, s.poison); e.poisonT = s.poisonDur; e.poisonPid = pid; }
    if (s.shred) e.shredT = 4;
  }

  updateFields(dt) {
    if (this.fields.length) {
      const keep = [];
      for (const f of this.fields) {
        f.t -= dt;
        for (const e of this.enemies) {
          if (e.dead || e.flying) continue;
          if ((e.x - f.x) ** 2 + (e.z - f.z) ** 2 <= f.r * f.r) this.damage(e, f.dps * dt, 'fire', f.pid, { dot: true });
        }
        if (f.t > 0) keep.push(f);
      }
      this.fields = keep;
    }
    if (this.strikes.length) {
      const keep = [];
      for (const s of this.strikes) {
        s.t -= dt;
        if (s.t > 0) { keep.push(s); continue; }
        for (const e of this.enemies) {
          if (e.dead) continue;
          if ((e.x - s.x) ** 2 + (e.z - s.z) ** 2 <= s.r * s.r) this.damage(e, s.dmg, 'expl', s.pid, { armorPierce: 0.5 });
        }
        this.ev({ k: 'b', x: r2f(s.x), z: r2f(s.z), r: s.r, p: 'strike' });
      }
      this.strikes = keep;
    }
  }

  // ------------------------------------------------------------ ana döngü
  update(dt) {
    if (this.paused || this.result) return;
    this.time += dt;
    for (const p of this.players.values()) if (p.strikeCd > 0) p.strikeCd = Math.max(0, p.strikeCd - dt);

    if (this.phase === 'build') {
      this.timer -= dt;
      if (this.timer <= 0) this.startWave();
    } else if (this.phase === 'wave') {
      this.waveTime += dt;
      while (this.spawnQueue.length && this.spawnQueue[0].t <= this.waveTime) {
        const s = this.spawnQueue.shift();
        this.spawnEnemy(s.type, s.lane);
      }
    }

    this.updateReveal();
    this.updateEnemies(dt);
    if (this.result) return;
    this.updateTowers(dt);
    this.updateHq(dt);
    this.updateProjectiles(dt);
    this.updateFields(dt);

    if (this.enemies.some(e => e.dead)) {
      this.enemies = this.enemies.filter(e => {
        if (e.dead) { this.enemyById.delete(e.id); return false; }
        return true;
      });
    }

    if (this.phase === 'wave' && !this.spawnQueue.length && !this.enemies.length) this.endWave();
  }

  // ------------------------------------------------------------ ağ görüntüsü
  snapshot(full) {
    const e = [];
    for (const en of this.enemies) {
      if (en.dead) continue;
      let flags = 0;
      if (en.stealth && !en.revealed) flags |= 1;
      if (en.slowT > 0 && en.slow > 0) flags |= 2;
      if (en.burnT > 0) flags |= 4;
      if (en.poisonT > 0) flags |= 8;
      if (en.stunT > 0) flags |= 16;
      if (en.shield > 1) flags |= 32;
      if (en.markT > 0) flags |= 64;
      e.push(en.id, en.ti, Math.round(en.x * 100), Math.round(en.z * 100), Math.max(1, Math.round(en.hp / en.maxHp * 100)), flags);
    }
    const ta = [];
    const act = [];
    for (const t of this.towers) {
      ta.push(Math.round(t.angle * 100));
      if (t.s.kind === 'beam' && t.beamIds.length && this.time - t.lastFire < 0.1) act.push(t.id, t.beamIds.length, ...t.beamIds, Math.round(t.ramp * 10));
      else if (t.s.kind === 'flame' && this.time - t.lastFire < 0.25) act.push(t.id, 0);
    }
    const p = [];
    for (const pl of this.players.values()) {
      p.push([pl.pid, Math.floor(pl.gold), Math.floor(pl.xp), pl.level, xpToNext(pl.level), pl.cx, pl.cz, Math.ceil(pl.strikeCd), pl.kills]);
    }
    const snap = {
      t: 's', tm: Math.round(this.time * 1000) / 1000, ph: this.phase, w: this.wave, tw: this.totalWaves,
      tmr: Math.ceil(this.timer), pz: this.paused ? 1 : 0, sp: this.speed,
      hq: [Math.ceil(this.hq.hp), this.hq.maxHp, this.hq.armor, this.hq.gun, Math.round(this.hq.angle * 100)],
      p, e, ta, act, ev: this.events,
    };
    if (this.towersDirty || full) {
      snap.T = this.towers.map(t => [t.id, TOWER_INDEX[t.type], t.x, t.z, t.level, t.spec ? SPEC_INDEX[t.spec] : 0, t.owner, t.mode, t.kills]);
      this.towersDirty = false;
    }
    this.events = [];
    return snap;
  }
}

function key(x, z) { return x * 1000 + z; }
function clampInt(v, a, b) { v = Math.round(Number(v) || 0); return Math.max(a, Math.min(b, v)); }
function r2(v) { return Math.round(v * 100) / 100; }
const r2f = r2;

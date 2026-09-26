// Yerel oyuncu denetleyicisi: imleç, inşa/yükseltme menüleri. Kol, klavye/fare ve dokunmatik aynı API'yi kullanır.
import { TOWERS, TOWER_ORDER, TARGET_MODES, upgradeCost, SELL_RATIO, HQ, DAMAGE_TYPES } from '/shared/data.js';
import { Game } from '/shared/game.js';
import { CELL, HALF } from '/shared/map.js';
import { BTN, DirRepeat } from './input.js';
import { profile } from './storage.js';

const statCtx = { players: new Map() };
export function statsFor(type, level, spec) {
  return Game.prototype.towerStats.call(statCtx, { type, level, spec, owner: -1 });
}
function costFor(base) { return Math.round(base * (1 - profile.perks.cost * 0.03)); }
function spentFor(type, level) {
  const def = TOWERS[type];
  let s = costFor(def.cost);
  for (let l = 1; l < level; l++) s += costFor(upgradeCost(def, l));
  return s;
}
function fmt(n) { return n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(0) : n.toFixed(1); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export class LocalPlayer {
  constructor(app, localId, device, padIndex = -1) {
    this.app = app;
    this.localId = localId;
    this.device = device; // 'pad' | 'kbm' | 'touch'
    this.padIndex = padIndex;
    this.pid = null;
    this.cx = 0; this.cz = 0;
    this.menu = null;
    this.rep = new DirRepeat();
    this.sentCur = '';
    this.curTimer = 0;
    this.strikeMode = false;
    this.lastBuild = 'mg';
    this.el = document.createElement('div');
    this.el.className = device === 'touch' ? 'sheet hidden' : 'pmenu hidden';
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.sig = '';
  }

  get label() {
    if (this.device === 'pad') return `Kol ${this.padIndex + 1}`;
    if (this.device === 'kbm') return 'Klavye/Fare';
    return 'Dokunmatik';
  }

  attach(root) { root.appendChild(this.el); }
  detach() { this.el.remove(); }

  state() { return this.app.playerState(this.pid); }
  color() { return this.app.playerColor(this.pid); }

  send(a) { if (this.pid != null) this.app.session.send({ t: 'in', pid: this.pid, ...a }); }

  setCursor(x, z) {
    this.cx = Math.max(-HALF, Math.min(HALF, x));
    this.cz = Math.max(-HALF, Math.min(HALF, z));
  }

  // ------------------------------------------------------------ komutlar
  move(dx, dz) {
    if (this.menu) { this.navigate(dx, dz); return; }
    this.setCursor(this.cx + dx, this.cz + dz);
    this.app.audio.tick();
  }

  navigate(dx, dz) {
    const m = this.menu;
    const n = m.items.length;
    if (m.kind === 'build') {
      const cols = 5;
      let i = m.index + dx + dz * cols;
      if (i < 0) i = dz ? m.index % cols : 0;
      if (i >= n) i = dz ? m.index : n - 1;
      m.index = Math.max(0, Math.min(n - 1, i));
    } else {
      m.index = (m.index + (dz || dx) + n) % n;
    }
    this.app.audio.tick();
  }

  cycle(d) {
    if (this.menu) { const n = this.menu.items.length; this.menu.index = (this.menu.index + d + n) % n; this.app.audio.tick(); }
  }

  confirm() {
    if (this.menu) { this.activate(this.menu.items[this.menu.index]); return; }
    this.openMenu();
  }

  back() {
    if (this.strikeMode) { this.strikeMode = false; return; }
    if (this.menu) { this.menu = null; this.app.audio.tick(); }
  }

  selectCell(x, z) {
    if (this.strikeMode) { this.setCursor(x, z); this.strike(); return; }
    const same = this.menu && this.menu.x === x && this.menu.z === z;
    this.setCursor(x, z);
    if (same && this.device !== 'touch') { this.menu = null; return; }
    this.openMenu();
  }

  openMenu() {
    const info = this.app.view.cellInfo(this.cx, this.cz);
    if (info.tower) this.menu = { kind: 'tower', x: this.cx, z: this.cz, index: 0, towerId: info.tower.id, items: [] };
    else if (info.cell === CELL.EMPTY) {
      const idx = Math.max(0, TOWER_ORDER.indexOf(this.lastBuild));
      this.menu = { kind: 'build', x: this.cx, z: this.cz, index: idx, items: [] };
    } else if (info.cell === CELL.HQ) this.menu = { kind: 'hq', x: this.cx, z: this.cz, index: 0, items: [] };
    else { this.menu = null; this.app.toast('Buraya inşa edilemez', this.color()); this.app.audio.error(); return; }
    this.refreshItems();
    this.app.audio.open();
  }

  quickUpgrade() {
    const info = this.app.view.cellInfo(this.cx, this.cz);
    if (info.tower) {
      if (info.tower.level >= 3) { this.openMenu(); return; }
      this.send({ a: 'up', id: info.tower.id });
    } else if (info.cell === CELL.EMPTY) {
      this.send({ a: 'build', type: this.lastBuild, x: this.cx, z: this.cz });
    }
  }

  strike() {
    this.strikeMode = false;
    this.send({ a: 'strike', x: this.cx, z: this.cz });
  }

  // ------------------------------------------------------------ menü içeriği
  refreshItems() {
    const m = this.menu;
    if (!m) return;
    const st = this.state();
    const gold = st ? st.gold : 0, level = st ? st.level : 1;
    if (m.kind === 'build') {
      if (this.app.view.cellInfo(m.x, m.z).tower) { m.kind = 'tower'; m.index = 0; return this.refreshItems(); }
      m.items = TOWER_ORDER.map(k => {
        const def = TOWERS[k];
        const cost = costFor(def.cost);
        const locked = level < def.unlock;
        return { k: 'build', type: k, label: def.name, short: def.short, color: def.color, cost, locked, enabled: !locked && gold >= cost, sub: locked ? `Sv ${def.unlock}` : `${cost}` };
      });
    } else if (m.kind === 'tower') {
      const t = this.app.view.towers.get(m.towerId);
      if (!t) { this.menu = null; return; }
      m.tower = t;
      const def = TOWERS[t.type];
      const items = [];
      if (t.level < 3) {
        const c = costFor(upgradeCost(def, t.level));
        items.push({ k: 'up', label: `Yükselt → Sv ${t.level + 1}`, sub: `${c}`, cost: c, enabled: gold >= c, icon: '⬆' });
      } else if (t.level === 3) {
        const c = costFor(upgradeCost(def, 3));
        for (const s of ['A', 'B']) items.push({ k: 'spec', s, label: def.specs[s].name, desc: def.specs[s].desc, sub: `${c}`, cost: c, enabled: gold >= c, icon: s === 'A' ? '★' : '✦', accent: s === 'A' ? '#ffd54a' : '#ff4fa3' });
      }
      if (def.kind !== 'eco' && def.kind !== 'aura') items.push({ k: 'mode', label: `Hedef: ${TARGET_MODES[t.mode]}`, sub: '↻', enabled: true, icon: '◎' });
      const refund = Math.floor(spentFor(t.type, t.level) * SELL_RATIO);
      const mine = t.owner === this.pid || !this.app.playerState(t.owner);
      items.push({ k: 'sell', label: 'Sat', sub: `+${refund}`, enabled: mine, icon: '✖', danger: true });
      m.items = items;
    } else if (m.kind === 'hq') {
      const hq = this.app.snap ? this.app.snap.hq : [0, 1, 0, 0];
      const items = [];
      items.push({ k: 'hq', u: 'repair', label: 'Onar (+%30 can)', sub: `${HQ.repair.cost}`, enabled: gold >= HQ.repair.cost && hq[0] < hq[1], icon: '✚' });
      if (hq[2] < 3) { const c = HQ.armor.costs[hq[2]]; items.push({ k: 'hq', u: 'armor', label: `Zırh Sv ${hq[2] + 1} (-%15 hasar)`, sub: `${c}`, enabled: gold >= c, icon: '⛨' }); }
      if (hq[3] < 3) { const c = HQ.gun.costs[hq[3]]; items.push({ k: 'hq', u: 'gun', label: `Merkez Topu Sv ${hq[3] + 1}`, sub: `${c}`, enabled: gold >= c, icon: '✹' }); }
      if (this.app.gamePlayers.length > 1) items.push({ k: 'gift', label: 'Takıma 100 altın ver', sub: '→', enabled: gold >= 1, icon: '♥' });
      m.items = items;
    }
    if (m.index >= m.items.length) m.index = m.items.length - 1;
    if (m.index < 0) m.index = 0;
  }

  activate(it) {
    if (!it) return;
    const m = this.menu;
    if (!it.enabled) {
      this.app.audio.error();
      if (it.locked) this.app.toast(`${it.label}: seviye ${TOWERS[it.type].unlock} gerekli`, this.color());
      else if (it.cost) this.app.toast('Yetersiz altın', this.color());
      return;
    }
    switch (it.k) {
      case 'build':
        this.lastBuild = it.type;
        this.send({ a: 'build', type: it.type, x: m.x, z: m.z });
        this.menu = null;
        break;
      case 'up': this.send({ a: 'up', id: m.towerId }); break;
      case 'spec': this.send({ a: 'spec', id: m.towerId, s: it.s }); break;
      case 'mode': this.send({ a: 'mode', id: m.towerId }); break;
      case 'sell': this.send({ a: 'sell', id: m.towerId }); this.menu = null; break;
      case 'hq': this.send({ a: 'hq', u: it.u }); break;
      case 'gift': this.send({ a: 'gift' }); break;
    }
  }

  onClick(e) {
    const b = e.target.closest('[data-i],[data-act]');
    if (!b || !this.menu) return;
    if (b.dataset.act === 'ok') { this.activate(this.menu.items[this.menu.index]); return; }
    if (b.dataset.act === 'close') { this.menu = null; return; }
    const i = Number(b.dataset.i);
    if (i === this.menu.index || this.menu.kind !== 'build') { this.menu.index = i; this.activate(this.menu.items[i]); }
    else { this.menu.index = i; this.app.audio.tick(); }
  }

  // Menüdeki seçime göre menzil önizlemesi
  preview() {
    const m = this.menu;
    if (!m) {
      const info = this.app.view.cellInfo(this.cx, this.cz);
      if (info.tower && this.device !== 'touch') return { range: statsFor(info.tower.type, info.tower.level, info.tower.spec).range || 0 };
      return {};
    }
    if (m.kind === 'build') {
      const it = m.items[m.index];
      return it ? { range: TOWERS[it.type].range || 0, valid: it.enabled } : {};
    }
    if (m.kind === 'tower' && m.tower) {
      const t = m.tower;
      const it = m.items[m.index];
      let lv = t.level, sp = t.spec;
      if (it && it.k === 'up') lv++;
      if (it && it.k === 'spec') { lv = 4; sp = it.s; }
      return { range: statsFor(t.type, lv, sp).range || 0 };
    }
    return {};
  }

  // ------------------------------------------------------------ giriş işleme
  handlePad(p, dt) {
    const pr = p.pressed;
    if (pr.has(BTN.A)) this.confirm();
    if (pr.has(BTN.B)) this.back();
    if (pr.has(BTN.X)) this.quickUpgrade();
    if (pr.has(BTN.Y)) this.strike();
    if (pr.has(BTN.LB)) this.cycle(-1);
    if (pr.has(BTN.RB)) this.cycle(1);
    if (pr.has(BTN.START)) this.send({ a: 'next' });
    if (pr.has(BTN.BACK)) this.send({ a: 'pause' });
    if (pr.has(BTN.RT) || pr.has(BTN.RS)) this.send({ a: 'speed' });
    const step = this.rep.step(p.dx, p.dz, dt, p.mag);
    if (step) this.move(step[0], step[1]);
  }

  handleKey(k) {
    const c = k.code;
    if (['ArrowUp', 'KeyW'].includes(c)) this.move(0, -1);
    else if (['ArrowDown', 'KeyS'].includes(c)) this.move(0, 1);
    else if (['ArrowLeft', 'KeyA'].includes(c)) this.move(-1, 0);
    else if (['ArrowRight', 'KeyD'].includes(c)) this.move(1, 0);
    else if (['Enter', 'Space', 'NumpadEnter'].includes(c)) { if (!k.repeat) this.confirm(); }
    else if (['Escape', 'Backspace'].includes(c)) this.back();
    else if (c === 'KeyQ') this.cycle(-1);
    else if (c === 'KeyE') this.cycle(1);
    else if (c === 'KeyU') this.quickUpgrade();
    else if (c === 'KeyF') this.strike();
    else if (c === 'KeyN') this.send({ a: 'next' });
    else if (c === 'KeyP') this.send({ a: 'pause' });
    else if (c === 'KeyH') this.send({ a: 'speed' });
    else if (c === 'KeyX') { const info = this.app.view.cellInfo(this.cx, this.cz); if (info.tower) this.send({ a: 'sell', id: info.tower.id }); }
    else if (/^Digit[1-9]$/.test(c) && this.menu && this.menu.kind === 'build') {
      const i = Number(c.slice(5)) - 1;
      if (i < this.menu.items.length) { this.menu.index = i; this.app.audio.tick(); }
    }
  }

  update(dt) {
    if (this.pid == null) return;
    this.curTimer -= dt;
    const key = this.cx + ',' + this.cz;
    if (key !== this.sentCur && this.curTimer <= 0) {
      this.sentCur = key; this.curTimer = 0.08;
      this.send({ a: 'cur', x: this.cx, z: this.cz });
    }
    if (this.menu) {
      // İmleç menüden ayrıldıysa (dokunmatik hariç) kapat
      if (this.device !== 'touch' && (this.menu.x !== this.cx || this.menu.z !== this.cz)) this.menu = null;
      else this.refreshItems();
    }
  }

  // ------------------------------------------------------------ çizim
  render() {
    const m = this.app.result ? null : this.menu;
    if (!m) { if (!this.el.classList.contains('hidden')) { this.el.classList.add('hidden'); this.sig = ''; } return; }
    const st = this.state();
    const col = this.color();
    const sig = JSON.stringify([m.kind, m.index, m.items.map(i => [i.label, i.sub, i.enabled]), m.tower && [m.tower.level, m.tower.mode, m.tower.kills]]);
    if (sig !== this.sig) {
      this.sig = sig;
      this.el.innerHTML = this.menuHtml(m, st);
      this.el.style.setProperty('--pc', col);
      this.el.classList.remove('hidden');
      const sel = this.el.querySelector('.sel');
      if (sel && sel.scrollIntoView && this.device === 'touch') sel.scrollIntoView({ block: 'nearest' });
    }
    if (this.device !== 'touch') {
      const s = this.app.view.toScreen(m.x, 0.5, m.z);
      const W = window.innerWidth, H = window.innerHeight;
      const w = this.el.offsetWidth, h = this.el.offsetHeight;
      let x = s.x + 40, y = s.y - h / 2;
      if (x + w > W - 8) x = s.x - 40 - w;
      x = Math.max(8, Math.min(W - w - 8, x));
      y = Math.max(60, Math.min(H - h - 8, y));
      this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
  }

  menuHtml(m, st) {
    const gold = st ? st.gold : 0;
    const name = esc(this.app.playerName(this.pid));
    let html = `<div class="pm-head"><span class="pm-name">${name}</span><span class="pm-gold">💰 ${gold}</span>${this.device === 'touch' ? '<button class="pm-x" data-act="close">✕</button>' : ''}</div>`;
    if (m.kind === 'build') {
      html += '<div class="pm-grid">';
      m.items.forEach((it, i) => {
        html += `<button data-i="${i}" class="pm-tile ${i === m.index ? 'sel' : ''} ${it.enabled ? '' : 'off'} ${it.locked ? 'locked' : ''}" style="--tc:${it.color}">
          <span class="tile-ico">${it.locked ? '🔒' : it.short}</span><span class="tile-cost">${it.locked ? it.sub : '💰' + it.sub}</span></button>`;
      });
      html += '</div>';
      const it = m.items[m.index];
      if (it) html += this.towerInfoHtml(it.type, 1, null, it);
    } else if (m.kind === 'tower') {
      const t = m.tower;
      const def = TOWERS[t.type];
      const owner = esc(this.app.playerName(t.owner));
      html += `<div class="pm-title" style="--tc:${def.color}">${def.name} <b>Sv ${t.level}</b>${t.spec ? ` · ${def.specs[t.spec].name}` : ''}</div>`;
      html += `<div class="pm-meta">Sahibi: <span style="color:${this.app.playerColor(t.owner)}">${owner}</span> · Öldürme: ${t.kills || 0}</div>`;
      html += this.statsHtml(t.type, t.level, t.spec, m.items[m.index]);
      html += '<div class="pm-list">';
      m.items.forEach((it, i) => {
        html += `<button data-i="${i}" class="pm-row ${i === m.index ? 'sel' : ''} ${it.enabled ? '' : 'off'} ${it.danger ? 'danger' : ''}" ${it.accent ? `style="--ac:${it.accent}"` : ''}>
          <span class="row-ico">${it.icon || ''}</span><span class="row-label">${esc(it.label)}${it.desc ? `<small>${esc(it.desc)}</small>` : ''}</span><span class="row-sub">${it.k === 'up' || it.k === 'spec' ? '💰' : ''}${it.sub}</span></button>`;
      });
      html += '</div>';
    } else if (m.kind === 'hq') {
      const hq = this.app.snap ? this.app.snap.hq : [0, 1, 0, 0];
      html += `<div class="pm-title" style="--tc:#4fc3f7">Karargah</div><div class="pm-meta">Can ${hq[0]}/${hq[1]} · Zırh Sv ${hq[2]} · Top Sv ${hq[3]}</div><div class="pm-list">`;
      m.items.forEach((it, i) => {
        html += `<button data-i="${i}" class="pm-row ${i === m.index ? 'sel' : ''} ${it.enabled ? '' : 'off'}"><span class="row-ico">${it.icon}</span><span class="row-label">${esc(it.label)}</span><span class="row-sub">${it.k === 'gift' ? '' : '💰'}${it.sub}</span></button>`;
      });
      html += '</div>';
    }
    if (this.device === 'pad') html += `<div class="pm-hint"><b>A</b> seç · <b>B</b> kapat · <b>LB/RB</b> gez</div>`;
    else if (this.device === 'kbm') html += `<div class="pm-hint">Tıkla / <b>Enter</b> seç · <b>Esc</b> kapat · <b>1-9</b></div>`;
    else if (m.kind === 'build') {
      const it = m.items[m.index];
      if (it) html += `<button class="pm-ok ${it.enabled ? '' : 'off'}" data-act="ok">${it.locked ? `🔒 Seviye ${TOWERS[it.type].unlock}` : `İnşa Et · 💰${it.cost}`}</button>`;
    }
    return html;
  }

  towerInfoHtml(type, level, spec, it) {
    const def = TOWERS[type];
    return `<div class="pm-title" style="--tc:${def.color}">${def.name}${it && it.locked ? ` <span class="lock">🔒 Sv ${def.unlock}</span>` : ''}</div>
      <div class="pm-desc">${esc(def.desc)}</div>${this.statsHtml(type, level, spec)}`;
  }

  statsHtml(type, level, spec, it) {
    const s = statsFor(type, level, spec);
    let n = null;
    if (it && it.k === 'up') n = statsFor(type, level + 1, spec);
    if (it && it.k === 'spec') n = statsFor(type, 4, it.s);
    const row = (label, a, b, unit = '') => {
      if (a == null || Number.isNaN(a)) return '';
      const diff = b != null && Math.abs(b - a) > 0.01 ? ` <em>→ ${fmt(b)}${unit}</em>` : '';
      return `<span><i>${label}</i> ${fmt(a)}${unit}${diff}</span>`;
    };
    let out = '<div class="pm-stats">';
    if (s.kind === 'eco') out += row('Gelir/dalga', s.income, n && n.income);
    else if (s.kind === 'aura') {
      out += row('Hasar+', s.buffDmg * 100, n && n.buffDmg * 100, '%') + row('Menzil', s.range, n && n.range) + row('Görüş', s.reveal, n && n.reveal);
    } else {
      const dps = (x) => x.kind === 'beam' ? x.dmg : x.kind === 'grav' ? x.dmg * x.rate : x.dmg * x.rate;
      out += row(s.kind === 'beam' ? 'Hasar/sn' : 'Hasar', s.dmg, n && n.dmg);
      if (s.kind !== 'beam') out += row('Atış/sn', s.rate, n && n.rate);
      out += row('Menzil', s.range, n && n.range);
      out += row('DPS', dps(s), n && dps(n));
      if (s.splash) out += row('Alan', s.splash, n && n.splash);
      out += `<span><i>Hedef</i> ${s.ground ? 'Kara' : ''}${s.ground && s.air ? '+' : ''}${s.air ? 'Hava' : ''}</span>`;
      out += `<span><i>Tür</i> ${DAMAGE_TYPES[s.dtype]}</span>`;
    }
    return out + '</div>';
  }
}


// Uygulama: menüler, lobi, oyun döngüsü ve cihaz yönetimi.
import { STAGES, DIFFICULTIES, THEMES, PERKS, perkCost, PLAYER_COLORS, LANE_SETS, TOWERS, TOWER_ORDER, ENEMIES, ENEMY_ORDER } from '/shared/data.js';
import { NetSession, LocalSession } from './session.js';
import { GameView } from './view.js';
import { Hud } from './hud.js';
import { LocalPlayer } from './controller.js';
import { Gamepads, Keyboard, BTN, DirRepeat } from './input.js';
import { Audio } from './audio.js';
import { profile, save, totalStars, freeStars, buyPerk, resetPerks, recordStars, stageUnlocked, deviceKey } from './storage.js';

const $ = (sel, el = document) => el.querySelector(sel);
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

class App {
  constructor() {
    this.ui = $('#ui-root');
    this.gameRoot = $('#game-root');
    this.toastRoot = $('#toast-root');
    this.touch = matchMedia('(pointer: coarse)').matches && ('ontouchstart' in window);
    document.body.classList.toggle('is-touch', this.touch);
    this.audio = new Audio();
    this.audio.enabled = profile.sfx !== false;
    this.pads = new Gamepads();
    this.kb = new Keyboard();
    this.navRep = new DirRepeat();
    this.locals = new Map();
    this.session = null;
    this.room = null;
    this.screen = 'menu';
    this.view = null;
    this.hud = null;
    this.snap = null;
    this.pstate = new Map();
    this.gamePlayers = [];
    this.lanIps = null;
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));

    const code = new URLSearchParams(location.search).get('oda');
    if (code) this.joinRoom(code);
    else this.renderMenu();
  }

  // ------------------------------------------------------------ yardımcılar
  isHost() { return !this.session || this.session.local || (this.room && this.room.host === this.room.you); }
  hasLocal() { for (const l of this.locals.values()) if (l.pid != null) return true; return false; }
  isLocalPid(pid) { for (const l of this.locals.values()) if (l.pid === pid) return true; return false; }
  firstLocal() { for (const l of this.locals.values()) if (l.pid != null) return l; return null; }
  playerState(pid) { return this.pstate.get(pid); }
  playerInfo(pid) { return this.gamePlayers.find(p => p.pid === pid) || (this.room && this.room.players.find(p => p.pid === pid)); }
  playerName(pid) { const p = this.playerInfo(pid); return p ? p.name : 'Takım'; }
  playerColor(pid) { return PLAYER_COLORS[((pid % 4) + 4) % 4] || '#fff'; }

  toast(text, color = '#fff', dur = 2.5) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.setProperty('--tc', color);
    t.textContent = text;
    this.toastRoot.appendChild(t);
    while (this.toastRoot.children.length > 5) this.toastRoot.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, dur * 1000);
  }

  // ------------------------------------------------------------ bağlantı
  async openSession(local) {
    this.closeSession();
    this.autoJoined = false;
    const s = local ? new LocalSession() : new NetSession();
    this.session = s;
    s.onMessage((m) => this.onMessage(m));
    s.onStatus = (st) => {
      if (st === 'closed') this.toast('Bağlantı koptu, yeniden bağlanılıyor…', '#ff7675', 3);
      if (st === 'reconnected') this.rejoin();
    };
    await s.connect();
    return s;
  }

  closeSession() {
    if (this.session) this.session.close();
    this.session = null;
    this.room = null;
    for (const l of this.locals.values()) l.detach();
    this.locals.clear();
  }

  async startLocal() {
    try { await this.openSession(true); } catch (e) { this.toast(e.message, '#ff7675'); return; }
    this.screen = 'lobby';
  }

  async hostRoom() {
    try { await this.openSession(false); } catch (e) { this.toast('Sunucuya bağlanılamadı. "npm start" ile sunucuyu başlattınız mı?', '#ff7675', 4); return; }
    this.session.send({ t: 'create' });
    this.screen = 'lobby';
  }

  async joinRoom(code) {
    code = String(code || '').trim().toUpperCase();
    if (code.length !== 4) { this.toast('Oda kodu 4 harf olmalı', '#ff7675'); return; }
    try { await this.openSession(false); } catch { this.toast('Sunucuya bağlanılamadı', '#ff7675'); this.renderMenu(); return; }
    this.joinCode = code;
    this.session.send({ t: 'join', code });
    this.screen = 'lobby';
    this.ui.innerHTML = `<div class="screen center"><h2>Bağlanılıyor…</h2></div>`;
  }

  rejoin() {
    if (!this.room || this.session.local) return;
    this.session.send({ t: 'join', code: this.room.code });
    for (const l of this.locals.values()) {
      this.session.send({ t: 'addPlayer', localId: l.localId, key: deviceKey(l.localId), name: l.device === 'pad' ? '' : profile.name, perks: profile.perks });
    }
  }

  leave() {
    this.closeSession();
    this.exitGame();
    history.replaceState(null, '', location.pathname);
    this.renderMenu();
  }

  addLocal(device, padIndex = -1) {
    const localId = device === 'pad' ? 'pad' + padIndex : device;
    if (this.locals.has(localId) || !this.session) return;
    const count = this.room ? this.room.players.filter(p => p.connected).length : 0;
    if (count >= 4) { this.toast('Oda dolu (en fazla 4 oyuncu)', '#ff7675'); return; }
    const lp = new LocalPlayer(this, localId, device, padIndex);
    this.locals.set(localId, lp);
    lp.attach(this.ui);
    this.session.send({ t: 'addPlayer', localId, key: deviceKey(localId), name: device === 'pad' ? '' : profile.name, perks: profile.perks });
    this.audio.open();
  }

  removeLocal(localId) {
    const lp = this.locals.get(localId);
    if (!lp) return;
    if (lp.pid != null) this.session.send({ t: 'removePlayer', pid: lp.pid });
    lp.detach();
    this.locals.delete(localId);
  }

  // ------------------------------------------------------------ mesajlar
  onMessage(m) {
    switch (m.t) {
      case 'room': {
        const prevState = this.room && this.room.state;
        this.room = m;
        if (!this.touch && !this.session.local && m.code) history.replaceState(null, '', `?oda=${m.code}`);
        // Otomatik katılım: dokunmatik cihazlar tek oyuncu olarak girer, yerel modda klavye oyuncusu
        if (m.state === 'lobby' && !this.locals.size && !this.autoJoined) {
          this.autoJoined = true;
          if (this.touch) this.addLocal('touch');
          else if (this.session.local) this.addLocal('kbm');
        }
        for (const [id, l] of this.locals) {
          if (l.pid != null && !m.players.some(p => p.pid === l.pid && p.clientId === m.you)) { l.detach(); this.locals.delete(id); }
        }
        if (m.state === 'lobby') {
          if (this.screen === 'game' && prevState === 'game') this.exitGame();
          this.screen = 'lobby';
          this.renderLobby();
        }
        break;
      }
      case 'added': {
        const l = this.locals.get(m.localId);
        if (l) l.pid = m.pid;
        if (this.screen === 'lobby') this.renderLobby();
        if (this.screen === 'game' && this.hud) this.hud.renderHelp();
        break;
      }
      case 'init': this.startGame(m); break;
      case 's': this.onSnapshot(m); break;
      case 'end': this.onEnd(m.result); break;
      case 'error':
        this.toast(m.text, '#ff7675', 3);
        if (m.fatal) this.leave();
        break;
    }
  }

  startGame(init) {
    const same = this.screen === 'game' && this.init && this.init.seed === init.seed && this.init.stageId === init.stageId && this.view;
    this.init = init;
    this.gamePlayers = init.players;
    if (same) { this.hud.renderCards(init.players); this.hud.renderHelp(); return; }
    this.screen = 'game';
    this.ui.innerHTML = '';
    this.snap = null;
    this.result = null;
    if (!this.view) this.view = new GameView(this.gameRoot, { touch: this.touch, quality: this.touch ? 'low' : 'high' });
    this.view.setup(init);
    this.view.onTap = (c, e) => this.onTap(c, e);
    this.view.onHover = (c) => { const k = this.locals.get('kbm'); if (k && !k.menu) k.setCursor(c.x, c.z); };
    this.gameRoot.classList.remove('hidden');
    this.hud = new Hud(this, this.ui);
    this.hud.setup(init);
    for (const l of this.locals.values()) {
      l.attach(this.ui);
      l.menu = null;
      const p = init.players.find(x => x.pid === l.pid);
      if (p) {
        const [x, z] = { 0: [0, -12], 1: [12, 0], 2: [0, 12], 3: [-12, 0] }[p.lane];
        l.setCursor(x, z);
      }
    }
    const tl = [...this.locals.values()].find(l => l.device === 'touch');
    const tp = tl && init.players.find(x => x.pid === tl.pid);
    this.view.myLane = tp ? tp.lane : null;
    this.view.resetCamera();
  }

  exitGame() {
    if (this.hud) { this.hud.destroy(); this.hud = null; }
    if (this.view) { this.view.clearWorld(); this.view.map = null; }
    this.gameRoot.classList.add('hidden');
    this.init = null;
    this.snap = null;
  }

  onSnapshot(s) {
    if (this.screen !== 'game' || !this.view) return;
    this.snap = s;
    for (const [pid, gold, xp, level, need, cx, cz, strikeCd, kills] of s.p) {
      this.pstate.set(pid, { gold, xp, level, need, cx, cz, strikeCd, kills });
    }
    this.view.applySnapshot(s);
    if (s.ev.length) { this.audio.events(s.ev); this.hud.events(s.ev); }
    this.hud.update(s);
  }

  onEnd(r) {
    this.result = r;
    if (this.hasLocal() || (this.session && this.session.local)) {
      if (r.stars) recordStars(r.stageId, r.stars);
    }
    if (r.win) this.audio.win(); else this.audio.lose();
    if (this.hud) this.hud.showResult(r, this.isHost());
  }

  onTap(c, e) {
    const pointerType = e.pointerType;
    const lp = pointerType === 'mouse' ? this.locals.get('kbm') : (this.locals.get('touch') || this.locals.get('kbm'));
    if (!lp || lp.pid == null) return;
    lp.selectCell(c.x, c.z);
  }

  hudAction(a) {
    const lp = this.firstLocal();
    switch (a) {
      case 'next': if (lp) lp.send({ a: 'next' }); break;
      case 'speed': if (lp) lp.send({ a: 'speed' }); break;
      case 'pause': if (lp) lp.send({ a: 'pause' }); else this.toast('Duraklatmak için oyuncu olarak katıl', '#fff'); break;
      case 'menu': this.hud.toggleMenu(true); break;
      case 'closemenu': this.hud.toggleMenu(false); break;
      case 'sound':
        this.audio.enabled = !this.audio.enabled; profile.sfx = this.audio.enabled; save();
        this.toast(this.audio.enabled ? 'Ses açık' : 'Ses kapalı');
        break;
      case 'camera': this.view.resetCamera(); this.hud.toggleMenu(false); break;
      case 'lobby': this.session.send({ t: 'toLobby' }); break;
      case 'leave': this.leave(); break;
      case 'strike': {
        const tl = this.locals.get('touch');
        if (tl) { tl.strikeMode = !tl.strikeMode; if (tl.strikeMode) { tl.menu = null; this.toast('Saldırı için haritada bir yere dokun', this.playerColor(tl.pid), 1.8); } }
        break;
      }
    }
  }

  // ------------------------------------------------------------ ana döngü
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const pads = this.pads.poll();
    const keys = this.kb.drain();

    for (const k of keys) if (k.code === 'KeyM' && !k.repeat) { this.audio.enabled = !this.audio.enabled; profile.sfx = this.audio.enabled; save(); this.toast(this.audio.enabled ? 'Ses açık' : 'Ses kapalı'); }

    if (this.screen === 'lobby') this.lobbyInput(pads, keys);
    else if (this.screen === 'game') this.gameInput(pads, keys, dt);
    else this.menuNav(pads, dt);

    if (this.screen === 'game' && this.view) {
      for (const l of this.locals.values()) { l.update(dt); l.render(); }
      const cursors = [];
      for (const p of this.gamePlayers) {
        const local = [...this.locals.values()].find(l => l.pid === p.pid);
        if (local) {
          const pv = local.preview();
          if (local.device === 'touch' && !local.menu && !local.strikeMode) { cursors.push({ pid: p.pid, x: local.cx, z: local.cz, color: p.color, arrow: false }); continue; }
          cursors.push({ pid: p.pid, x: local.menu ? local.menu.x : local.cx, z: local.menu ? local.menu.z : local.cz, color: p.color, range: local.strikeMode ? 2.6 : pv.range, valid: local.strikeMode ? true : pv.valid });
        } else {
          const st = this.pstate.get(p.pid);
          if (st) cursors.push({ pid: p.pid, x: st.cx, z: st.cz, color: p.color });
        }
      }
      this.view.setCursors(cursors);
      this.view.frame(dt);
    }
  }

  gameInput(pads, keys, dt) {
    const resultOpen = !!this.result;
    for (const p of pads) {
      const l = this.locals.get('pad' + p.index);
      if (resultOpen) {
        if (p.pressed.has(BTN.A) && this.isHost()) this.session.send({ t: 'toLobby' });
        continue;
      }
      if (l) { if (l.pid != null) l.handlePad(p, dt); }
      else if (p.pressed.has(BTN.A) || p.pressed.has(BTN.START)) this.addLocal('pad', p.index);
    }
    const kbm = this.locals.get('kbm');
    for (const k of keys) {
      if (resultOpen) continue;
      if (kbm && kbm.pid != null) kbm.handleKey(k);
      else if (!kbm && k.code === 'Enter' && !this.touch) this.addLocal('kbm');
    }
  }

  lobbyInput(pads, keys) {
    if (!this.room) return;
    const host = this.isHost();
    for (const p of pads) {
      const id = 'pad' + p.index;
      const l = this.locals.get(id);
      if (!l) {
        if (p.pressed.has(BTN.A) || p.pressed.has(BTN.START)) this.addLocal('pad', p.index);
        continue;
      }
      if (p.pressed.has(BTN.B)) { this.removeLocal(id); continue; }
      if (host) {
        if (p.pressed.has(BTN.START)) this.startMatch();
        if (p.pressed.has(BTN.X) || p.pressed.has(BTN.RB) || p.pressed.has(BTN.RIGHT)) this.cycleStage(1);
        if (p.pressed.has(BTN.LB) || p.pressed.has(BTN.LEFT)) this.cycleStage(-1);
        if (p.pressed.has(BTN.Y) || p.pressed.has(BTN.UP)) this.cycleDiff(1);
        if (p.pressed.has(BTN.DOWN)) this.cycleDiff(-1);
      }
    }
    for (const k of keys) {
      if (k.code === 'Enter' && !this.locals.has('kbm') && !this.touch && document.activeElement === document.body) this.addLocal('kbm');
    }
  }

  // Menülerde kol ile gezinme
  menuNav(pads, dt) {
    for (const p of pads) {
      const step = this.navRep.step(p.dx, p.dz, dt, p.mag);
      const btns = [...this.ui.querySelectorAll('button:not([disabled]), input')].filter(b => b.offsetParent);
      if (!btns.length) continue;
      let i = btns.indexOf(document.activeElement);
      if (step) {
        i = i < 0 ? 0 : (i + (step[0] + step[1] > 0 ? 1 : -1) + btns.length) % btns.length;
        btns[i].focus();
        this.audio.tick();
      }
      if (p.pressed.has(BTN.A) && i >= 0) btns[i].click();
      if (p.pressed.has(BTN.B)) { const back = $('[data-back]', this.ui); if (back) back.click(); }
    }
  }

  cycleStage(d) {
    const list = STAGES.filter(s => stageUnlocked(s.id));
    let i = list.findIndex(s => s.id === this.room.settings.stage);
    i = (i + d + list.length) % list.length;
    this.session.send({ t: 'settings', stage: list[i].id, difficulty: this.room.settings.difficulty });
  }
  cycleDiff(d) {
    const n = DIFFICULTIES.length;
    this.session.send({ t: 'settings', stage: this.room.settings.stage, difficulty: (this.room.settings.difficulty + d + n) % n });
  }
  startMatch() {
    if (!this.room || !this.isHost()) return;
    if (!this.room.players.some(p => p.connected)) { this.toast('En az bir oyuncu katılmalı', '#ff7675'); return; }
    this.session.send({ t: 'start' });
  }

  // ------------------------------------------------------------ ekranlar
  renderMenu() {
    this.screen = 'menu';
    this.gameRoot.classList.add('hidden');
    const stars = totalStars();
    this.ui.innerHTML = `
      <div class="screen menu">
        <div class="logo"><div class="logo-top">KALE</div><div class="logo-bot">SAVUNMASI</div>
          <div class="logo-sub">4 koridor · 4 oyuncu · ${TOWER_ORDER.length} kule · ${ENEMY_ORDER.length} düşman</div></div>
        <label class="name-field">Adın <input id="name" maxlength="16" placeholder="Oyuncu" value="${esc(profile.name)}"></label>
        <div class="menu-btns">
          <button class="big primary" data-go="local">🎮 Tek Ekranda Oyna<small>Xbox kolları + klavye/fare · aynı ekran</small></button>
          <button class="big" data-go="host">📺 Oda Kur<small>Bu ekran + telefonlar / diğer bilgisayarlar</small></button>
          <div class="join-row"><input id="code" maxlength="4" placeholder="KOD" autocapitalize="characters"><button class="big" data-go="join">📱 Odaya Katıl</button></div>
          <button data-go="perks">⭐ Gelişim <small>${freeStars()} / ${stars} yıldız</small></button>
          <button data-go="help">❓ Nasıl Oynanır</button>
        </div>
        <div class="menu-foot">Kolunuzu bağlayıp herhangi bir tuşa basın · D-pad ile gezinin, A ile seçin</div>
      </div>`;
    const name = $('#name', this.ui);
    name.addEventListener('change', () => { profile.name = name.value.trim().slice(0, 16); save(); });
    const code = $('#code', this.ui);
    code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinRoom(code.value); });
    this.ui.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
      profile.name = name.value.trim().slice(0, 16); save();
      const go = b.dataset.go;
      if (go === 'local') this.startLocal();
      else if (go === 'host') this.hostRoom();
      else if (go === 'join') this.joinRoom(code.value);
      else if (go === 'perks') this.renderPerks();
      else if (go === 'help') this.renderHelp();
    }));
  }

  renderPerks() {
    this.screen = 'perks';
    const rows = Object.entries(PERKS).map(([k, p]) => {
      const lvl = profile.perks[k];
      const maxed = lvl >= p.max;
      const cost = perkCost(lvl);
      const pips = Array.from({ length: p.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="perk"><div><b>${p.name}</b><small>${p.desc} (seviye başına)</small><div class="pips">${pips}</div></div>
        <button data-perk="${k}" ${maxed || freeStars() < cost ? 'disabled' : ''}>${maxed ? 'MAKS' : `⭐ ${cost}`}</button></div>`;
    }).join('');
    const stageRows = STAGES.map(s => `<span class="st-chip">${esc(s.name)} ${'★'.repeat(profile.stars[s.id] || 0)}${'☆'.repeat(3 - (profile.stars[s.id] || 0))}</span>`).join('');
    this.ui.innerHTML = `<div class="screen panel">
      <div class="panel-head"><button data-back>← Geri</button><h2>Gelişim</h2><div class="star-count">⭐ ${freeStars()} / ${totalStars()}</div></div>
      <p class="muted">Bölümleri bitirerek yıldız kazan (Karargah canına göre 1-3). Yıldızlarla kalıcı güçlendirmeler al; bu cihazdan katılan tüm oyuncularına uygulanır.</p>
      <div class="perks">${rows}</div>
      <div class="st-chips">${stageRows}</div>
      <button data-reset class="danger">Gelişimleri sıfırla (yıldızlar geri gelir)</button>
    </div>`;
    $('[data-back]', this.ui).addEventListener('click', () => this.renderMenu());
    $('[data-reset]', this.ui).addEventListener('click', () => { resetPerks(); this.renderPerks(); });
    this.ui.querySelectorAll('[data-perk]').forEach(b => b.addEventListener('click', () => { if (buyPerk(b.dataset.perk)) this.audio.upgrade(); this.renderPerks(); }));
  }

  renderHelp() {
    this.screen = 'help';
    const towers = TOWER_ORDER.map(k => { const t = TOWERS[k]; return `<div class="hl-item" style="--tc:${t.color}"><b>${t.name}</b> <small>Sv ${t.unlock} · ${t.cost}💰</small><p>${t.desc}</p><p class="specs">★ ${t.specs.A.name}: ${t.specs.A.desc}<br>✦ ${t.specs.B.name}: ${t.specs.B.desc}</p></div>`; }).join('');
    const enemies = ENEMY_ORDER.filter(k => k !== 'splitling').map(k => { const e = ENEMIES[k]; const tags = [e.flying && 'uçan', e.armor && 'zırhlı', e.stealth && 'görünmez', e.shield && 'kalkan', e.heal && 'iyileştirir', e.split && 'bölünür', e.summon && 'çağırır', e.blink && 'ışınlanır', e.berserk && 'öfkelenir', e.immuneSlow && 'yavaşlamaz', e.boss && 'BOSS'].filter(Boolean).join(', '); return `<div class="hl-item" style="--tc:${e.color}"><b>${e.name}</b> <small>${e.boss ? 'her 10. dalga' : e.wave + '. dalgadan itibaren'}</small><p>${tags || 'standart'}</p></div>`; }).join('');
    this.ui.innerHTML = `<div class="screen panel">
      <div class="panel-head"><button data-back>← Geri</button><h2>Nasıl Oynanır</h2><div></div></div>
      <div class="help-cols">
        <div><h3>Amaç</h3><p>Düşmanlar koridorlardan ortadaki <b>Karargah</b>'a saldırır. Oyuncu sayısı kadar koridor açılır (1-4). Kuleler kur, yükselt, dalgaları durdur!</p>
        <h3>Ekonomi ve Gelişim</h3><p>Kulelerinin öldürdüğü her düşman sana altın ve tecrübe kazandırır. Dalga sonunda herkese bonus verilir. Dalgayı erken çağırmak ekstra altın kazandırır. Seviye atladıkça yeni kuleler ve hava saldırısı açılır, kulelerinin hasarı artar. Kuleler 3 seviye yükselir, 4. seviyede iki <b>uzmanlıktan</b> birini seçersin.</p>
        <h3>Karargah</h3><p>İmleci karargaha getirip menüyü aç: onar, zırh ekle, merkez topu kur veya takım arkadaşına altın gönder.</p>
        <h3>Kontroller</h3>
        <p><b>🎮 Xbox kolu:</b> Sol çubuk/D-pad imleç · A menü/inşa · B geri · LB/RB menüde gez · X hızlı yükselt (boş hücrede son kuleyi kurar) · Y hava saldırısı · Start sonraki dalga · RT hız · Back duraklat</p>
        <p><b>⌨ Klavye/Fare:</b> Fareyle hücre seç, tıkla · WASD/Oklar · Enter · Esc · U yükselt · X sat · F saldırı · N dalga · H hız · P duraklat · M ses · Sağ tık sürükle: kaydır · Tekerlek: yakınlaştır</p>
        <p><b>📱 Telefon:</b> Hücreye dokun → kule seç → İnşa Et. Kuleye dokun → yükselt/sat. Tek parmak kaydır, iki parmak yakınlaştır. ✈ ile hava saldırısı.</p>
        <h3>Çok oyunculu</h3><p><b>Tek Ekran:</b> Bilgisayara 4 kola kadar bağla, her kol A'ya basarak katılır.<br><b>Oda Kur:</b> TV/PC ekranında oda kur, telefonlar aynı Wi-Fi'da gösterilen adresi açıp kodla katılır. Ekrandaki kollar da aynı odaya katılabilir.</p></div>
        <div><h3>Kuleler</h3><div class="hl-grid">${towers}</div><h3>Düşmanlar</h3><div class="hl-grid">${enemies}</div></div>
      </div></div>`;
    $('[data-back]', this.ui).addEventListener('click', () => this.renderMenu());
  }

  async joinUrl() {
    if (!this.room || this.session.local) return '';
    const host = location.hostname;
    if ((host === 'localhost' || host === '127.0.0.1') && !this.lanIps) {
      try { const r = await fetch('/api/info'); const j = await r.json(); this.lanIps = j.ips || []; } catch { this.lanIps = []; }
    }
    const base = (host === 'localhost' || host === '127.0.0.1') && this.lanIps && this.lanIps.length ? `http://${this.lanIps[0]}:${location.port || 80}` : location.origin;
    return `${base}/?oda=${this.room.code}`;
  }

  renderLobby() {
    const r = this.room;
    if (!r) return;
    this.gameRoot.classList.add('hidden');
    const host = this.isHost();
    const connected = r.players.filter(p => p.connected);
    const n = connected.length;
    const slots = [0, 1, 2, 3].map(pid => {
      const p = r.players.find(x => x.pid === pid);
      if (!p) return `<div class="slot empty" style="--pc:${PLAYER_COLORS[pid]}"><div class="slot-c"></div><div><b>Boş</b><small>Kolda <b>A</b> · Telefondan kodla katıl</small></div></div>`;
      const mine = p.clientId === r.you;
      const lp = mine ? [...this.locals.values()].find(l => l.pid === p.pid) : null;
      const dev = lp ? lp.label : (p.connected ? 'Uzak cihaz' : 'Bağlantı yok');
      return `<div class="slot ${mine ? 'mine' : ''} ${p.connected ? '' : 'off'}" style="--pc:${p.color}"><div class="slot-c"></div><div><b>${esc(p.name)}</b><small>${dev}${mine ? ' · bu cihaz' : ''}</small></div>${lp ? `<button data-rm="${lp.localId}">✕</button>` : ''}</div>`;
    }).join('');
    const stages = STAGES.map(s => {
      const un = stageUnlocked(s.id) || !host;
      const st = profile.stars[s.id] || 0;
      const th = THEMES[s.theme];
      return `<button class="stage ${r.settings.stage === s.id ? 'sel' : ''}" data-stage="${s.id}" ${host && un ? '' : 'disabled'} style="--g1:${th.ground};--g2:${th.sky}">
        <b>${esc(s.name)}</b><small>${s.endless ? 'Sonsuz dalga' : s.waves + ' dalga'} · ${th.name}</small><span class="st">${un ? '★'.repeat(st) + '☆'.repeat(3 - st) : '🔒'}</span></button>`;
    }).join('');
    const diffs = DIFFICULTIES.map(d => `<button class="diff ${r.settings.difficulty === d.id ? 'sel' : ''}" data-diff="${d.id}" ${host ? '' : 'disabled'}>${d.name}</button>`).join('');
    const hasKbm = this.locals.has('kbm'), hasTouch = this.locals.has('touch');
    const lanes = n ? LANE_SETS[Math.min(4, n)].length : 0;
    this.ui.innerHTML = `<div class="screen lobby">
      <div class="panel-head"><button data-back>← Ayrıl</button><h2>${this.session.local ? 'Tek Ekran Oyunu' : 'Lobi'}</h2><div></div></div>
      ${this.session.local ? '' : `<div class="room-code"><span>ODA KODU</span><b>${r.code}</b><div class="join-url">Telefonlar aynı Wi-Fi'da şu adresi açsın:<br><code class="url">…</code></div></div>`}
      <div class="lobby-cols">
        <div>
          <h3>Oyuncular <small>${n}/4 · ${lanes} koridor açılacak</small></h3>
          <div class="slots">${slots}</div>
          <div class="join-btns">
            ${!hasKbm && !this.touch ? '<button data-join="kbm">⌨ Klavye/Fare ile katıl <small>(Enter)</small></button>' : ''}
            ${!hasTouch && this.touch ? '<button data-join="touch" class="primary">📱 Oyuna katıl</button>' : ''}
          </div>
          <p class="muted">🎮 Kol: <b>A</b> katıl · <b>B</b> ayrıl${host ? ' · <b>LB/RB</b> bölüm · <b>D-pad ↑↓</b> zorluk · <b>Start</b> başlat' : ''}</p>
        </div>
        <div>
          <h3>Bölüm ${host ? '' : '<small>(ev sahibi seçer)</small>'}</h3>
          <div class="stages">${stages}</div>
          <h3>Zorluk</h3><div class="diffs">${diffs}</div>
          ${host ? `<button class="big primary start" data-start ${n ? '' : 'disabled'}>▶ BAŞLAT</button>` : '<p class="wait">Ev sahibinin başlatması bekleniyor…</p>'}
        </div>
      </div></div>`;
    for (const l of this.locals.values()) l.attach(this.ui);
    $('[data-back]', this.ui).addEventListener('click', () => this.leave());
    this.ui.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => this.removeLocal(b.dataset.rm)));
    this.ui.querySelectorAll('[data-join]').forEach(b => b.addEventListener('click', () => this.addLocal(b.dataset.join)));
    this.ui.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => this.session.send({ t: 'settings', stage: Number(b.dataset.stage), difficulty: r.settings.difficulty })));
    this.ui.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => this.session.send({ t: 'settings', stage: r.settings.stage, difficulty: Number(b.dataset.diff) })));
    const sb = $('[data-start]', this.ui);
    if (sb) sb.addEventListener('click', () => this.startMatch());
    const urlEl = $('.url', this.ui);
    if (urlEl) this.joinUrl().then(u => { urlEl.textContent = u; });
  }
}

window.app = new App();

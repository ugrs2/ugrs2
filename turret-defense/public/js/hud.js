// Oyun içi arayüz: üst çubuk, oyuncu kartları, afişler, duraklatma ve sonuç ekranları.
import { STAGES, DIFFICULTIES, LANE_NAMES, TOWERS, ENEMIES, STRIKE } from '/shared/data.js';

const $ = (sel, el = document) => el.querySelector(sel);
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export class Hud {
  constructor(app, root) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.className = 'hud' + (app.touch ? ' touch' : '');
    root.appendChild(this.el);
    this.cards = new Map();
    this.last = {};
  }

  setup(init) {
    const stage = STAGES.find(s => s.id === init.stageId);
    const diff = DIFFICULTIES[init.difficulty];
    this.el.innerHTML = `
      <div class="topbar">
        <div class="tb-left"><div class="tb-stage">${esc(stage.name)} <small>${esc(diff.name)}</small></div>
          <div class="tb-wave">Dalga <b class="w">0</b><span class="tw">/${stage.waves || '∞'}</span></div></div>
        <div class="tb-center">
          <div class="hqbar"><div class="fill"></div><span class="txt"></span></div>
          <div class="tb-phase"><span class="ph"></span><button class="btn-next" data-a="next">▶ Başlat <small>+bonus</small></button></div>
        </div>
        <div class="tb-right">
          <button class="btn-speed" data-a="speed">1x</button>
          <button data-a="pause">❚❚</button>
          <button data-a="menu">☰</button>
        </div>
      </div>
      <div class="cards"></div>
      <div class="banner"><div class="b-title"></div><div class="b-sub"></div></div>
      <div class="actions"></div>
      <div class="helpbar"></div>
      <div class="overlay pause hidden"><div class="ov-box"><h2>Duraklatıldı</h2><button data-a="pause" class="big">▶ Devam</button></div></div>
      <div class="overlay gmenu hidden"><div class="ov-box"><h2>Menü</h2>
        <button data-a="sound" class="big">🔊 Ses</button>
        <button data-a="camera" class="big">🎥 Kamerayı sıfırla</button>
        ${this.app.isHost() ? '<button data-a="lobby" class="big">↩ Lobiye dön</button>' : ''}
        <button data-a="leave" class="big danger">✖ Oyundan çık</button>
        <button data-a="closemenu" class="big">Kapat</button></div></div>
      <div class="overlay result hidden"></div>`;
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      this.app.hudAction(b.dataset.a, b.dataset);
    });
    this.cards.clear();
    this.last = {};
    this.renderCards(init.players);
    this.renderHelp();
  }

  renderCards(players) {
    const box = $('.cards', this.el);
    box.innerHTML = '';
    this.cards.clear();
    for (const p of players) {
      const local = this.app.isLocalPid(p.pid);
      const c = document.createElement('div');
      c.className = 'card' + (local ? ' local' : '');
      c.style.setProperty('--pc', p.color);
      c.innerHTML = `<div class="c-top"><span class="c-name">${esc(p.name)}</span><span class="c-lane">${LANE_NAMES[p.lane]}</span></div>
        <div class="c-row"><span class="c-gold">💰 <b>0</b></span><span class="c-lv">Sv <b>1</b></span><span class="c-st">✈ <b>-</b></span></div>
        <div class="xpbar"><div></div></div>`;
      box.appendChild(c);
      this.cards.set(p.pid, { el: c, gold: $('.c-gold b', c), lv: $('.c-lv b', c), st: $('.c-st b', c), stEl: $('.c-st', c), xp: $('.xpbar div', c), v: {} });
    }
  }

  renderHelp() {
    const devs = new Set([...this.app.locals.values()].map(l => l.device));
    const parts = [];
    if (devs.has('pad')) parts.push('<span class="dev">🎮</span> <b>Sol çubuk/D-pad</b> imleç · <b>A</b> inşa/menü · <b>X</b> hızlı yükselt · <b>Y</b> hava saldırısı · <b>Start</b> dalga · <b>RT</b> hız · <b>Back</b> duraklat');
    if (devs.has('kbm')) parts.push('<span class="dev">⌨</span> <b>WASD/Oklar</b> · <b>Enter</b> menü · <b>U</b> yükselt · <b>X</b> sat · <b>F</b> saldırı · <b>N</b> dalga · <b>H</b> hız · <b>P</b> duraklat · <b>M</b> ses');
    if (!devs.size && !this.app.touch) parts.push('<span class="dev">📺</span> İzleyici ekranı · Koldan <b>A</b> ile ya da <b>Enter</b> ile oyuna katıl');
    $('.helpbar', this.el).innerHTML = parts.join('<br>');
    const act = $('.actions', this.el);
    const touchLocal = [...this.app.locals.values()].find(l => l.device === 'touch');
    act.innerHTML = touchLocal ? `<button data-a="strike" class="act-strike">✈<small>Saldırı</small></button><button data-a="camera" class="act-cam">🎥</button>` : '';
  }

  update(snap) {
    const L = this.last;
    const set = (k, v, fn) => { if (L[k] !== v) { L[k] = v; fn(v); } };
    set('w', snap.w, v => { $('.w', this.el).textContent = v; });
    const [hp, max] = snap.hq;
    set('hq', hp + '/' + max, () => {
      const f = Math.max(0, hp / max);
      const fill = $('.hqbar .fill', this.el);
      fill.style.width = (f * 100) + '%';
      fill.style.background = f > 0.5 ? 'linear-gradient(90deg,#2ecc71,#7bed9f)' : f > 0.25 ? 'linear-gradient(90deg,#f39c12,#f7c46c)' : 'linear-gradient(90deg,#e74c3c,#ff7b6b)';
      $('.hqbar .txt', this.el).textContent = `🏰 Karargah ${hp}/${max}`;
    });
    const ph = snap.ph === 'build' ? (snap.w === 0 ? `İlk dalga ${snap.tmr} sn içinde` : `Sonraki dalga: ${snap.tmr} sn`) : snap.ph === 'wave' ? 'Dalga sürüyor!' : '';
    set('ph', ph, v => { $('.ph', this.el).textContent = v; });
    const canNext = snap.ph === 'build' && this.app.hasLocal();
    set('next', canNext, v => { $('.btn-next', this.el).style.display = v ? '' : 'none'; });
    set('sp', snap.sp, v => { const b = $('.btn-speed', this.el); b.textContent = v + 'x'; b.classList.toggle('on', v > 1); });
    set('pz', snap.pz, v => { $('.overlay.pause', this.el).classList.toggle('hidden', !v); });

    for (const row of snap.p) {
      const [pid, gold, xp, level, need, , , st] = row;
      const c = this.cards.get(pid);
      if (!c) continue;
      if (c.v.gold !== gold) { c.v.gold = gold; c.gold.textContent = gold; }
      if (c.v.lv !== level) { c.v.lv = level; c.lv.textContent = level; }
      const xpw = Math.round(xp / need * 100);
      if (c.v.xp !== xpw) { c.v.xp = xpw; c.xp.style.width = xpw + '%'; }
      const sts = level < STRIKE.unlock ? '🔒' : st > 0 ? st + 's' : 'HAZIR';
      if (c.v.st !== sts) { c.v.st = sts; c.st.textContent = sts; c.stEl.classList.toggle('ready', sts === 'HAZIR'); }
    }
    const strikeBtn = $('.act-strike', this.el);
    if (strikeBtn) {
      const tl = [...this.app.locals.values()].find(l => l.device === 'touch');
      const st = tl && this.app.playerState(tl.pid);
      const ready = st && st.level >= STRIKE.unlock && st.strikeCd <= 0;
      strikeBtn.classList.toggle('ready', !!ready);
      strikeBtn.classList.toggle('armed', !!(tl && tl.strikeMode));
      const lbl = !st || st.level < STRIKE.unlock ? `Sv ${STRIKE.unlock}` : st.strikeCd > 0 ? st.strikeCd + 's' : (tl.strikeMode ? 'Hedef seç' : 'Saldırı');
      const small = strikeBtn.querySelector('small');
      if (small.textContent !== lbl) small.textContent = lbl;
    }
  }

  banner(title, sub = '', color = '#fff', dur = 2.4) {
    const b = $('.banner', this.el);
    $('.b-title', b).textContent = title;
    $('.b-sub', b).textContent = sub;
    b.style.setProperty('--bc', color);
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.bt);
    this.bt = setTimeout(() => b.classList.remove('show'), dur * 1000);
  }

  events(evs) {
    const app = this.app;
    for (const e of evs) {
      switch (e.k) {
        case 'w': {
          const nt = (e.nt || []).map(t => ENEMIES[t].name).join(', ');
          this.banner(e.name, nt ? `Yeni düşman: ${nt}` : (e.boss ? 'BOSS DALGASI' : ''), e.boss ? '#ff5252' : '#ffd54a');
          break;
        }
        case 'wc': app.toast(`Dalga ${e.w} temizlendi! Herkese +${e.g} altın`, '#7bed9f'); break;
        case 'lv': {
          const name = app.playerName(e.p);
          const un = (e.un || []).map(k => TOWERS[k].name);
          if (e.st) un.push('Hava Saldırısı');
          app.toast(`${name} seviye ${e.l}!${un.length ? ' Açıldı: ' + un.join(', ') : ''}`, app.playerColor(e.p), un.length ? 4 : 2.5);
          if (app.isLocalPid(e.p) && un.length) this.banner(`SEVİYE ${e.l}`, `${name}: ${un.join(', ')} açıldı`, app.playerColor(e.p), 2.2);
          break;
        }
        case 'x': if (app.isLocalPid(e.p)) { app.toast(e.text, app.playerColor(e.p)); app.audio.error(); } break;
        case 'm': app.toast(e.text, '#fff'); break;
        case 'gf': app.toast(`${app.playerName(e.p)} → ${app.playerName(e.to)}: ${e.g} altın hediye`, app.playerColor(e.p)); break;
        case 'hq': app.toast(`${app.playerName(e.p)} karargahı güçlendirdi`, app.playerColor(e.p)); break;
        case 'spd': app.toast(`Oyun hızı ${e.v}x`, '#fff', 1.2); break;
        case 'l': this.flash(); break;
      }
    }
  }

  flash() {
    this.el.classList.remove('hit');
    void this.el.offsetWidth;
    this.el.classList.add('hit');
  }

  toggleMenu(v) { $('.overlay.gmenu', this.el).classList.toggle('hidden', v === undefined ? undefined : !v); }

  showResult(r, isHost) {
    const ov = $('.overlay.result', this.el);
    const stage = STAGES.find(s => s.id === r.stageId);
    const stars = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
    const rows = r.players.slice().sort((a, b) => b.dmg - a.dmg).map(p => `<tr><td style="color:${this.app.playerColor(p.pid)}">${esc(p.name)}</td><td>${p.level}</td><td>${p.kills}</td><td>${p.built}</td><td>${p.dmg.toLocaleString('tr-TR')}</td></tr>`).join('');
    ov.innerHTML = `<div class="ov-box result-box ${r.win ? 'win' : 'lose'}">
      <h1>${r.win ? 'ZAFER!' : (stage.endless ? 'SAVAŞ BİTTİ' : 'YENİLGİ')}</h1>
      <div class="stars">${stars}</div>
      <p>${esc(stage.name)} · ${stage.endless ? `${r.wave}. dalgaya ulaşıldı` : `Dalga ${r.wave}/${stage.waves}`} · Karargah %${Math.round(r.hqFrac * 100)}</p>
      <table><tr><th>Oyuncu</th><th>Sv</th><th>Öldürme</th><th>Kule</th><th>Hasar</th></tr>${rows}</table>
      <p class="muted">Toplam öldürme ${r.kills} · Sızan düşman ${r.leaks}</p>
      ${r.stars ? `<p class="gain">+ Yıldızlar kaydedildi! Gelişim menüsünden kalıcı güçlendirme al.</p>` : ''}
      ${isHost ? '<button data-a="lobby" class="big primary">↩ Lobiye dön <small>(kolda A)</small></button>' : '<p class="muted">Ev sahibinin lobiye dönmesi bekleniyor…</p>'}
      <button data-a="leave" class="big">Ana menü</button></div>`;
    ov.classList.remove('hidden');
  }

  destroy() { this.el.remove(); }
}

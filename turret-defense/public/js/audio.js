// Küçük WebAudio sentezleyici: dosya gerektirmeyen ses efektleri.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.last = {};
    const unlock = () => { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('gamepadconnected', unlock);
  }
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }
  ok(name, gap) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return false;
    const t = this.ctx.currentTime;
    if (this.last[name] && t - this.last[name] < gap) return false;
    this.last[name] = t;
    return true;
  }
  tone(freq, dur, type = 'square', vol = 0.2, slide = 0, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noiseBurst(dur, vol = 0.3, freq = 1000, q = 1) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(60, t + dur); f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur);
  }
  shot(kind) {
    switch (kind) {
      case 'bullet': if (this.ok('bullet', 0.06)) this.noiseBurst(0.05, 0.12, 4000); break;
      case 'shell': case 'mortar': if (this.ok('shell', 0.1)) { this.noiseBurst(0.18, 0.25, 900); this.tone(90, 0.15, 'sine', 0.2, 0.5); } break;
      case 'flak': if (this.ok('flak', 0.08)) this.noiseBurst(0.08, 0.15, 2500); break;
      case 'missile': if (this.ok('missile', 0.1)) this.noiseBurst(0.35, 0.12, 1800, 4); break;
      case 'glob': if (this.ok('glob', 0.1)) this.tone(300, 0.15, 'sine', 0.15, 0.4); break;
    }
  }
  boom(big) { if (this.ok(big ? 'bigboom' : 'boom', big ? 0.1 : 0.07)) { this.noiseBurst(big ? 0.9 : 0.35, big ? 0.5 : 0.22, big ? 700 : 1200); if (big) this.tone(60, 0.6, 'sine', 0.35, 0.5); } }
  zap() { if (this.ok('zap', 0.08)) { this.tone(900, 0.12, 'sawtooth', 0.08, 0.3); this.noiseBurst(0.1, 0.1, 6000); } }
  snipe() { if (this.ok('snipe', 0.08)) { this.noiseBurst(0.12, 0.3, 6000); this.tone(1400, 0.1, 'square', 0.05, 0.3); } }
  rail() { if (this.ok('rail', 0.1)) { this.tone(200, 0.4, 'sawtooth', 0.15, 8); this.noiseBurst(0.3, 0.2, 5000); } }
  frost() { if (this.ok('frost', 0.12)) this.tone(1800, 0.25, 'sine', 0.05, 0.5); }
  grav() { if (this.ok('grav', 0.2)) this.tone(400, 0.8, 'sine', 0.25, 0.1); }
  kill() { if (this.ok('kill', 0.05)) this.tone(900 + Math.random() * 300, 0.06, 'square', 0.04, 1.5); }
  coin() { if (this.ok('coin', 0.1)) { this.tone(990, 0.08, 'square', 0.06); this.tone(1320, 0.12, 'square', 0.06, 0, 0.07); } }
  build() { if (this.ok('build', 0.05)) { this.tone(300, 0.08, 'triangle', 0.2); this.tone(450, 0.1, 'triangle', 0.2, 0, 0.06); } }
  upgrade() { if (this.ok('up', 0.05)) [523, 659, 784].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.15, 0, i * 0.06)); }
  level() { if (this.ok('lv', 0.1)) [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, 'square', 0.08, 0, i * 0.09)); }
  wave(boss) { if (this.ok('wave', 0.5)) { this.tone(boss ? 110 : 220, 0.6, 'sawtooth', 0.12, 1.01); this.tone(boss ? 147 : 330, 0.6, 'sawtooth', 0.1, 1.01, 0.25); } }
  leak() { if (this.ok('leak', 0.15)) { this.tone(120, 0.3, 'square', 0.2, 0.5); } }
  error() { if (this.ok('err', 0.1)) this.tone(160, 0.12, 'square', 0.1); }
  tick() { if (this.ok('tick', 0.03)) this.tone(1200, 0.02, 'square', 0.03); }
  open() { if (this.ok('open', 0.05)) this.tone(700, 0.05, 'triangle', 0.1, 1.5); }
  win() { if (this.ctx) [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.15, 0, i * 0.12)); }
  lose() { if (this.ctx) [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.4, 'sawtooth', 0.1, 0, i * 0.2)); }

  events(evs) {
    for (const e of evs) {
      switch (e.k) {
        case 'f': this.shot(e.p); break;
        case 'b': this.boom(e.p === 'strike' || e.r > 2); break;
        case 'r': this.snipe(); break;
        case 'rl': this.rail(); break;
        case 'c': this.zap(); break;
        case 'pu': this.frost(); break;
        case 'g': this.grav(); break;
        case 'k': if (e.b) this.boom(true); else this.kill(); break;
        case 'l': this.leak(); break;
        case 'bd': this.build(); break;
        case 'up': case 'hq': this.upgrade(); break;
        case 'sl': case 'in': this.coin(); break;
        case 'lv': this.level(); break;
        case 'w': this.wave(e.boss); break;
      }
    }
  }
}

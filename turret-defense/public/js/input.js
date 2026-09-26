// Xbox / standart oyun kolu ve klavye girişi.
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export class Gamepads {
  constructor() {
    this.prev = new Map();
    this.connected = new Set();
    window.addEventListener('gamepadconnected', (e) => this.connected.add(e.gamepad.index));
    window.addEventListener('gamepaddisconnected', (e) => this.connected.delete(e.gamepad.index));
  }
  poll() {
    const out = [];
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of list) {
      if (!gp || !gp.connected) continue;
      const prev = this.prev.get(gp.index) || [];
      const held = gp.buttons.map(b => b.pressed || b.value > 0.5);
      const pressed = new Set();
      held.forEach((h, i) => { if (h && !prev[i]) pressed.add(i); });
      this.prev.set(gp.index, held);
      let lx = gp.axes[0] || 0, ly = gp.axes[1] || 0;
      if (Math.hypot(lx, ly) < 0.35) { lx = 0; ly = 0; }
      // D-pad
      let dx = 0, dz = 0;
      if (held[BTN.LEFT]) dx = -1; else if (held[BTN.RIGHT]) dx = 1;
      if (held[BTN.UP]) dz = -1; else if (held[BTN.DOWN]) dz = 1;
      if (!dx && !dz && (lx || ly)) {
        if (Math.abs(lx) > Math.abs(ly) * 0.5) dx = Math.sign(lx);
        if (Math.abs(ly) > Math.abs(lx) * 0.5) dz = Math.sign(ly);
      }
      out.push({ index: gp.index, id: gp.id, pressed, held, dx, dz, mag: Math.max(Math.abs(lx), Math.abs(ly), dx || dz ? 1 : 0) });
    }
    return out;
  }
}

// Yön tekrarı: basılı tutulduğunda imleç adım adım hızlanarak ilerler
export class DirRepeat {
  constructor() { this.dir = ''; this.t = 0; this.n = 0; }
  step(dx, dz, dt, mag = 1) {
    const k = dx + ',' + dz;
    if (!dx && !dz) { this.dir = ''; return null; }
    if (k !== this.dir) { this.dir = k; this.t = 0.28; this.n = 0; return [dx, dz]; }
    this.t -= dt;
    if (this.t <= 0) {
      this.n++;
      this.t = Math.max(0.045, (this.n > 4 ? 0.06 : 0.1) / Math.max(0.6, mag));
      return [dx, dz];
    }
    return null;
  }
}

export class Keyboard {
  constructor() {
    this.queue = [];
    this.held = new Set();
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      this.held.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      this.queue.push({ code: e.code, key: e.key, repeat: e.repeat });
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }
  drain() { const q = this.queue; this.queue = []; return q; }
}

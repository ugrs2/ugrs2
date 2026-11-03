// Sunucuyla (WebSocket) ya da yerel simülasyonla konuşan oturum katmanı. Aynı mesaj API'si.
import { Room } from '/shared/room.js';

class Emitter {
  constructor() { this.handlers = new Set(); }
  onMessage(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  emit(m) { for (const h of this.handlers) h(m); }
}

export class NetSession extends Emitter {
  constructor() {
    super();
    this.local = false;
    this.ws = null;
    this.closed = false;
    this.queue = [];
    this.onStatus = () => {};
  }
  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        for (const m of this.queue) ws.send(JSON.stringify(m));
        this.queue = [];
        this.onStatus('open');
        resolve();
      };
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.emit(m); };
      ws.onerror = () => { if (!opened) reject(new Error('Sunucuya bağlanılamadı')); };
      ws.onclose = () => {
        if (this.closed) return;
        this.onStatus('closed');
        if (opened) setTimeout(() => this.reconnect(), 1500);
      };
    });
  }
  async reconnect() {
    if (this.closed) return;
    try { await this.connect(); this.onStatus('reconnected'); }
    catch { setTimeout(() => this.reconnect(), 2500); }
  }
  send(m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
    else this.queue.push(m);
  }
  close() { this.closed = true; if (this.ws) this.ws.close(); }
}

export class LocalSession extends Emitter {
  constructor() {
    super();
    this.local = true;
    this.room = new Room('YEREL', { snapEvery: 1 });
    this.client = { id: 1, send: (m) => queueMicrotask(() => this.emit(m)) };
    this.onStatus = () => {};
    let last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.room.tick(dt);
    }, 1000 / 30);
  }
  connect() { this.room.addClient(this.client); return Promise.resolve(); }
  send(m) {
    if (m.t === 'create' || m.t === 'join') return;
    this.room.onMessage(this.client, m);
  }
  close() { clearInterval(this.timer); }
}

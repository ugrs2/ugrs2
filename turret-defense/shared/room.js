// Oda: lobi + oyun yönetimi. Sunucuda (WebSocket istemcileriyle) ve yerel modda (sahte istemciyle) kullanılır.
import { Game } from './game.js';
import { STAGES, DIFFICULTIES, PLAYER_COLORS, PLAYER_NAMES, sanitizePerks } from './data.js';

export const MAX_PLAYERS = 4;

export class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.snapEvery = opts.snapEvery || 2;
    this.clients = new Map(); // id -> {id, send}
    this.hostId = null;
    this.players = []; // {pid, key, name, clientId, connected, perks}
    this.state = 'lobby';
    this.settings = { stage: 1, difficulty: 1 };
    this.game = null;
    this.tickCount = 0;
    this.forceFull = false;
    this.resultSent = false;
    this.emptySince = Date.now();
  }

  // ------------------------------------------------------------ istemciler
  addClient(client) {
    this.clients.set(client.id, client);
    if (this.hostId == null || !this.clients.has(this.hostId)) this.hostId = client.id;
    this.emptySince = 0;
    this.broadcastRoom();
    if (this.state === 'game' && this.game) {
      client.send(this.initMsg());
      this.forceFull = true;
      if (this.game.result) client.send({ t: 'end', result: this.game.result });
    }
  }

  removeClient(client) {
    this.clients.delete(client.id);
    for (const p of this.players) {
      if (p.clientId === client.id) { p.connected = false; p.clientId = null; }
    }
    if (this.state === 'lobby') this.players = this.players.filter(p => p.connected);
    if (this.hostId === client.id) {
      const next = this.clients.keys().next();
      this.hostId = next.done ? null : next.value;
    }
    if (!this.clients.size) this.emptySince = Date.now();
    this.broadcastRoom();
  }

  isEmpty() { return this.clients.size === 0; }

  send(clientId, msg) { const c = this.clients.get(clientId); if (c) c.send(msg); }
  broadcast(msg) { for (const c of this.clients.values()) c.send(msg); }

  roomMsg(clientId) {
    return {
      t: 'room', code: this.code, you: clientId, host: this.hostId, state: this.state,
      settings: this.settings,
      players: this.players.map(p => ({ pid: p.pid, name: p.name, color: PLAYER_COLORS[p.pid], connected: p.connected, clientId: p.clientId, local: p.localId })),
    };
  }
  broadcastRoom() { for (const c of this.clients.values()) c.send(this.roomMsg(c.id)); }

  initMsg() {
    const g = this.game;
    return {
      t: 'init', stageId: g.stage.id, difficulty: g.difficulty, template: g.stage.template, lanes: g.lanes, seed: g.seed,
      players: g.playerInfo(),
    };
  }

  // ------------------------------------------------------------ mesajlar
  onMessage(client, m) {
    if (!m || typeof m !== 'object') return;
    const isHost = client.id === this.hostId;
    switch (m.t) {
      case 'addPlayer': {
        const keyStr = String(m.key || '').slice(0, 64);
        const name = String(m.name || '').trim().slice(0, 16);
        let p = keyStr ? this.players.find(x => x.key === keyStr) : null;
        if (p && p.connected && p.clientId !== client.id) p = null; // anahtar başkasında aktif
        if (p) {
          p.clientId = client.id; p.connected = true; p.localId = m.localId;
          if (name) p.name = name;
        } else {
          if (this.players.length >= MAX_PLAYERS) { client.send({ t: 'error', text: 'Oda dolu (en fazla 4 oyuncu)' }); return; }
          const used = new Set(this.players.map(x => x.pid));
          let pid = 0; while (used.has(pid)) pid++;
          p = { pid, key: keyStr || `k${Math.random()}`, name: name || PLAYER_NAMES[pid], clientId: client.id, connected: true, perks: sanitizePerks(m.perks), localId: m.localId };
          this.players.push(p);
          this.players.sort((a, b) => a.pid - b.pid);
          if (this.state === 'game' && this.game && !this.game.players.has(pid)) {
            this.game.addPlayer({ pid, name: p.name, perks: p.perks });
            this.broadcast(this.initMsg());
            this.forceFull = true;
          }
        }
        client.send({ t: 'added', localId: m.localId, pid: p.pid });
        this.broadcastRoom();
        break;
      }
      case 'removePlayer': {
        const p = this.players.find(x => x.pid === m.pid && x.clientId === client.id);
        if (!p) return;
        if (this.state === 'lobby') this.players = this.players.filter(x => x !== p);
        else { p.connected = false; p.clientId = null; }
        this.broadcastRoom();
        break;
      }
      case 'rename': {
        const p = this.players.find(x => x.pid === m.pid && x.clientId === client.id);
        if (p) { p.name = String(m.name || '').trim().slice(0, 16) || p.name; this.broadcastRoom(); }
        break;
      }
      case 'settings': {
        if (!isHost || this.state !== 'lobby') return;
        if (STAGES.some(s => s.id === m.stage)) this.settings.stage = m.stage;
        if (DIFFICULTIES[m.difficulty]) this.settings.difficulty = m.difficulty;
        this.broadcastRoom();
        break;
      }
      case 'start': {
        if (!isHost || this.state !== 'lobby') return;
        const ps = this.players.filter(p => p.connected);
        if (!ps.length) { client.send({ t: 'error', text: 'En az bir oyuncu gerekli' }); return; }
        this.game = new Game({
          stageId: this.settings.stage, difficulty: this.settings.difficulty,
          players: ps.map(p => ({ pid: p.pid, name: p.name, perks: p.perks })),
        });
        this.players = ps;
        this.state = 'game';
        this.resultSent = false;
        this.forceFull = true;
        this.broadcast(this.initMsg());
        this.broadcastRoom();
        break;
      }
      case 'toLobby': {
        if (!isHost) return;
        this.state = 'lobby';
        this.game = null;
        this.players = this.players.filter(p => p.connected);
        this.broadcastRoom();
        break;
      }
      case 'in': {
        if (this.state !== 'game' || !this.game) return;
        const p = this.players.find(x => x.pid === m.pid);
        if (!p || p.clientId !== client.id) return;
        this.game.handle(m.pid, m);
        break;
      }
      case 'ping':
        client.send({ t: 'pong', ts: m.ts });
        break;
    }
  }

  // ------------------------------------------------------------ zaman
  tick(dt) {
    const g = this.game;
    if (this.state !== 'game' || !g) return;
    const steps = g.speed;
    for (let i = 0; i < steps; i++) g.update(dt);
    this.tickCount++;
    if (this.tickCount % this.snapEvery === 0 || (g.result && !this.resultSent)) {
      const snap = g.snapshot(this.forceFull);
      this.forceFull = false;
      this.broadcast(snap);
    }
    if (g.result && !this.resultSent) {
      this.resultSent = true;
      this.broadcast({ t: 'end', result: g.result });
    }
  }
}

export function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

// HTTP statik dosya sunucusu + WebSocket oyun sunucusu.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, makeCode } from '../shared/room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const TICK_HZ = 30;

const MOUNTS = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/')],
  ['/shared/', path.join(ROOT, 'shared/')],
  ['/', path.join(ROOT, 'public/')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch { res.writeHead(400); res.end(); return; }
  if (url === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ips: lanIps(), port: PORT, rooms: rooms.size }));
    return;
  }
  if (url === '/') url = '/index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.resolve(dir, '.' + url.slice(prefix.length - 1));
    if (!file.startsWith(dir)) break;
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('Bulunamadı'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  res.writeHead(404); res.end('Bulunamadı');
});

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  // Ev ağlarını öne al
  return out.sort((a, b) => (b.startsWith('192.168.') ? 1 : 0) - (a.startsWith('192.168.') ? 1 : 0));
}

const rooms = new Map();
let nextClientId = 1;

const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: { threshold: 1024 } });
wss.on('connection', (ws) => {
  const client = {
    id: nextClientId++,
    room: null,
    send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); },
  };
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.t === 'create') {
      if (client.room) client.room.removeClient(client);
      let code; do { code = makeCode(); } while (rooms.has(code));
      const room = new Room(code, { snapEvery: 2 });
      rooms.set(code, room);
      client.room = room;
      room.addClient(client);
      return;
    }
    if (m.t === 'join') {
      const room = rooms.get(String(m.code || '').toUpperCase());
      if (!room) { client.send({ t: 'error', text: 'Oda bulunamadı', fatal: true }); return; }
      if (client.room) client.room.removeClient(client);
      client.room = room;
      room.addClient(client);
      return;
    }
    if (client.room) client.room.onMessage(client, m);
  });
  ws.on('close', () => { if (client.room) client.room.removeClient(client); });
});

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const [code, room] of rooms) {
    try { room.tick(dt); } catch (e) { console.error('Oda hatası', code, e); }
    if (room.isEmpty() && Date.now() - room.emptySince > 5 * 60 * 1000) rooms.delete(code);
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => {
  console.log(`\n  KALE SAVUNMASI sunucusu çalışıyor\n`);
  console.log(`  Bu bilgisayar:   http://localhost:${PORT}`);
  for (const ip of lanIps()) console.log(`  Telefonlar için: http://${ip}:${PORT}`);
  console.log('');
});

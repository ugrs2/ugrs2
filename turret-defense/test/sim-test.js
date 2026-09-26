// Başsız simülasyon testi: basit bir bot ile tüm bölümleri oynatır, çökme ve denge kontrolü.
import { Game } from '../shared/game.js';
import { TOWERS, TOWER_ORDER, STAGES } from '../shared/data.js';
import { CELL, cellAt, HALF } from '../shared/map.js';

function botTurn(g, rnd) {
  for (const p of g.players.values()) {
    // Önce yükselt, sonra kur
    const mine = g.towers.filter(t => t.owner === p.pid);
    const up = mine.find(t => t.level < 3 && rnd() < 0.5);
    if (up) g.handle(p.pid, { a: 'up', id: up.id });
    const sp = mine.find(t => t.level === 3);
    if (sp && rnd() < 0.3) g.handle(p.pid, { a: 'spec', id: sp.id, s: rnd() < 0.5 ? 'A' : 'B' });
    const avail = TOWER_ORDER.filter(k => TOWERS[k].unlock <= p.level && TOWERS[k].cost <= p.gold);
    if (!avail.length) continue;
    const combat = avail.filter(k => !['mine', 'radar'].includes(k));
    const pick = combat.length ? combat : avail;
    const type = pick.sort((a, b) => TOWERS[b].cost - TOWERS[a].cost)[Math.floor(rnd() * Math.min(3, pick.length))];
    // Kendi koridoruna en çok yol kapsayan hücre
    const path = g.map.paths[p.lane];
    const range = TOWERS[type].range || 3;
    let best = null, bs = -1;
    for (let tries = 0; tries < 60; tries++) {
      const pt = path.pts[1 + Math.floor(rnd() * (path.pts.length - 1))];
      const x = Math.round(pt.x + (rnd() * 6 - 3)), z = Math.round(pt.z + (rnd() * 6 - 3));
      if (cellAt(g.map, x, z) !== CELL.EMPTY || g.towerAt.has(x * 1000 + z)) continue;
      let sc = 0;
      for (let dx = -Math.ceil(range); dx <= range; dx++) for (let dz = -Math.ceil(range); dz <= range; dz++) {
        if (dx * dx + dz * dz <= range * range && cellAt(g.map, x + dx, z + dz) === CELL.PATH) sc++;
      }
      if (sc > bs) { bs = sc; best = [x, z]; }
    }
    if (best && (SMART ? rnd() < 0.7 : true)) g.handle(p.pid, { a: 'build', type, x: best[0], z: best[1] });
    if (p.strikeCd <= 0 && g.enemies.length) { const e = g.enemies[0]; g.handle(p.pid, { a: 'strike', x: e.x, z: e.z }); }
    if (g.hq.hp < g.hq.maxHp * 0.5) g.handle(p.pid, { a: 'hq', u: 'repair' });
  }
}

const SMART = true;
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const players = Number(process.argv[2] || 0);
const stages = STAGES.map(s => s.id);
let fail = false;
for (const n of players ? [players] : [1, 2, 3, 4]) {
  for (const stageId of stages) {
    const g = new Game({ stageId, difficulty: 1, players: Array.from({ length: n }, (_, i) => ({ pid: i, name: 'Bot' + i })) });
    const dt = 1 / 30;
    let t = 0, maxE = 0, snapBytes = 0, snaps = 0;
    const limit = 60 * 60 * 2;
    while (!g.result && t < limit) {
      if (Math.floor(t * 30) % 30 === 0) botTurn(g, rnd);
      if (g.phase === 'build' && g.wave > 0 && g.timer < 12) g.handle(0, { a: 'next' });
      g.update(dt);
      t += dt;
      maxE = Math.max(maxE, g.enemies.length);
      if (Math.floor(t * 30) % 60 === 0) { snapBytes += JSON.stringify(g.snapshot()).length; snaps++; } else g.events.length = 0;
      for (const e of g.enemies) if (!Number.isFinite(e.x) || !Number.isFinite(e.hp)) { console.error('NaN enemy', e.type); fail = true; break; }
    }
    const r = g.result;
    console.log(`p=${n} stage=${stageId} ${r ? (r.win ? 'KAZANDI' : 'KAYBETTI') : 'SÜRE'} wave=${g.wave}/${g.totalWaves} hq=${Math.round(g.hq.hp)}/${g.hq.maxHp} towers=${g.towers.length} maxEnemies=${maxE} lv=${[...g.players.values()].map(p => p.level).join(',')} gold=${[...g.players.values()].map(p => Math.round(p.gold)).join(',')} avgSnap=${Math.round(snapBytes / Math.max(1, snaps))}B t=${Math.round(t)}s`);
  }
}
if (fail) process.exit(1);

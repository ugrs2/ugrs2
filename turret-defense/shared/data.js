// Oyun verileri: kuleler, düşmanlar, bölümler, kalıcı gelişimler.
// Hem sunucu (Node) hem tarayıcı tarafından kullanılır; saf veri + küçük yardımcılar.

export const PLAYER_COLORS = ['#ff4d4d', '#3d8bff', '#3ddc6a', '#ffd23d'];
export const PLAYER_NAMES = ['Kırmızı', 'Mavi', 'Yeşil', 'Sarı'];

// Oyuncu sayısına göre aktif koridorlar (0=K, 1=D, 2=G, 3=B)
export const LANE_SETS = {
  1: [0],
  2: [0, 2],
  3: [3, 0, 1],
  4: [0, 1, 2, 3],
};
export const LANE_NAMES = ['Kuzey', 'Doğu', 'Güney', 'Batı'];

export const DAMAGE_TYPES = {
  phys: 'Fiziksel',
  expl: 'Patlayıcı',
  fire: 'Ateş',
  ice: 'Buz',
  elec: 'Elektrik',
  poison: 'Zehir',
  energy: 'Enerji',
};

export const TARGET_MODES = ['İlk', 'Son', 'Güçlü', 'Yakın'];

// ---------------------------------------------------------------- KULELER
// kind: davranış tipi (sim tarafından yorumlanır)
// air/ground: hedefleyebildikleri
// unlock: gereken oyuncu seviyesi
// specs: 4. seviye uzmanlık seçenekleri (A / B)
export const TOWERS = {
  mg: {
    name: 'Makineli Tüfek', short: 'MKN', color: '#c9a227', unlock: 1, cost: 100,
    kind: 'proj', proj: 'bullet', projSpeed: 26, dmg: 8, rate: 5, range: 3.5,
    dtype: 'phys', ground: true, air: true,
    desc: 'Hızlı atış yapan ucuz, çok yönlü kule. Hava ve kara.',
    specs: {
      A: { name: 'Minigun', desc: 'Atış hızı x2.2', mods: { rate: 2.2, dmg: 0.9 } },
      B: { name: 'Zırh Delici', desc: 'Hasar x2.2, zırhı tamamen yok sayar', mods: { dmg: 2.2 }, set: { armorPierce: 1 } },
    },
  },
  cannon: {
    name: 'Top', short: 'TOP', color: '#8a8f99', unlock: 1, cost: 150,
    kind: 'proj', proj: 'shell', projSpeed: 13, dmg: 40, rate: 0.8, range: 4,
    dtype: 'expl', ground: true, air: false, splash: 1.2,
    desc: 'Alan hasarı veren gülle atar. Sadece kara.',
    specs: {
      A: { name: 'Ağır Top', desc: 'Hasar x2, geniş patlama, sersemletir', mods: { dmg: 2, splash: 1.4 }, set: { stun: 0.5 } },
      B: { name: 'İkiz Namlu', desc: 'Atış hızı x2', mods: { rate: 2 } },
    },
  },
  frost: {
    name: 'Buz Kulesi', short: 'BUZ', color: '#7fd8ff', unlock: 1, cost: 120,
    kind: 'pulse', dmg: 5, rate: 1.1, range: 2.8,
    dtype: 'ice', ground: true, air: true, slow: 0.45, slowDur: 1.6,
    desc: 'Çevresindeki tüm düşmanları yavaşlatan soğuk dalgası.',
    specs: {
      A: { name: 'Mutlak Sıfır', desc: 'Güçlü yavaşlatma, %15 dondurma şansı', mods: {}, set: { slow: 0.7, freezeChance: 0.15 } },
      B: { name: 'Buz Kristali', desc: 'Hasar x6, menzil +%25', mods: { dmg: 6, range: 1.25 } },
    },
  },
  sniper: {
    name: 'Keskin Nişancı', short: 'KNS', color: '#4f7f4a', unlock: 2, cost: 200,
    kind: 'hitscan', beam: 'tracer', dmg: 95, rate: 0.45, range: 8,
    dtype: 'phys', ground: true, air: true, armorPierce: 0.5, crit: 0.2, critMult: 2,
    desc: 'Çok uzun menzil, yüksek tekil hasar ve kritik vuruş.',
    specs: {
      A: { name: 'Suikastçı', desc: '%35 kritik, x4 kritik hasar', mods: {}, set: { crit: 0.35, critMult: 4 } },
      B: { name: 'Anti-Materyal', desc: 'Hasar x1.8, zırhı yok sayar, bosslara x1.5', mods: { dmg: 1.8 }, set: { armorPierce: 1, bossMult: 1.5 } },
    },
  },
  flak: {
    name: 'Uçaksavar', short: 'UÇS', color: '#5a6b8c', unlock: 2, cost: 150,
    kind: 'proj', proj: 'flak', projSpeed: 20, dmg: 24, rate: 2.2, range: 6,
    dtype: 'expl', ground: false, air: true, splash: 1.0,
    desc: 'Sadece hava birimlerine karşı güçlü parça tesirli atış.',
    specs: {
      A: { name: 'Patriot', desc: 'Güdümlü füze, hasar x2.5, menzil +%30', mods: { dmg: 2.5, range: 1.3 }, set: { proj: 'missile', projSpeed: 12 } },
      B: { name: 'Parça Tesiri', desc: 'Patlama alanı x2, atış hızı x1.5', mods: { splash: 2, rate: 1.5 } },
    },
  },
  flame: {
    name: 'Alev Silahı', short: 'ALV', color: '#ff7a1a', unlock: 3, cost: 180,
    kind: 'flame', dmg: 5, rate: 8, range: 2.6, cone: 0.6,
    dtype: 'fire', ground: true, air: false, burn: 8, burnDur: 2,
    desc: 'Koni şeklinde alev püskürtür, yakar. Kalabalıklara karşı.',
    specs: {
      A: { name: 'Napalm', desc: 'Yanma hasarı x3, süre x2', mods: {}, set: { burn: 24, burnDur: 4 } },
      B: { name: 'Plazma Alevi', desc: 'Hasar x2, menzil +%30, dirençleri yok sayar', mods: { dmg: 2, range: 1.3 }, set: { ignoreResist: true } },
    },
  },
  mine: {
    name: 'Altın Madeni', short: 'MDN', color: '#ffcc33', unlock: 3, cost: 250,
    kind: 'eco', income: 45, range: 0,
    dtype: 'phys', ground: false, air: false,
    desc: 'Her dalga sonunda sahibine altın üretir.',
    specs: {
      A: { name: 'Banka', desc: 'Gelir x2.2', mods: { income: 2.2 } },
      B: { name: 'Borsa', desc: 'Gelir x1.4 + altınının %6\'sı faiz (en çok 150)', mods: { income: 1.4 }, set: { interest: 0.06 } },
    },
  },
  tesla: {
    name: 'Tesla Bobini', short: 'TSL', color: '#6ae0ff', unlock: 4, cost: 220,
    kind: 'chain', dmg: 28, rate: 1.1, range: 3.6, chain: 3, chainRange: 2.2,
    dtype: 'elec', ground: true, air: true,
    desc: 'Düşmandan düşmana sekip zincirleme şimşek. Kalkanlara x2.',
    specs: {
      A: { name: 'Fırtına', desc: '8 hedefe sekme', mods: {}, set: { chain: 8 } },
      B: { name: 'Aşırı Yük', desc: 'Hasar x2.2 ve sersemletme', mods: { dmg: 2.2 }, set: { stun: 0.35 } },
    },
  },
  missile: {
    name: 'Roket Rampası', short: 'RKT', color: '#d9d9d9', unlock: 4, cost: 280,
    kind: 'proj', proj: 'missile', projSpeed: 11, dmg: 65, rate: 0.7, range: 6,
    dtype: 'expl', ground: true, air: true, splash: 1.0,
    desc: 'Güdümlü roket; hava ve kara, alan hasarı.',
    specs: {
      A: { name: 'Salvo', desc: 'Aynı anda 4 hedefe roket', mods: {}, set: { multishot: 4 } },
      B: { name: 'Taktik Nükleer', desc: 'Hasar x3, patlama x2, daha yavaş', mods: { dmg: 3, splash: 2, rate: 0.6 } },
    },
  },
  mortar: {
    name: 'Havan', short: 'HVN', color: '#6b5a3c', unlock: 5, cost: 260,
    kind: 'lob', proj: 'mortar', projSpeed: 9, dmg: 90, rate: 0.4, range: 9, minRange: 2,
    dtype: 'expl', ground: true, air: false, splash: 1.8,
    desc: 'Çok uzun menzilli topçu. Yakına ateş edemez.',
    specs: {
      A: { name: 'Misket Bombası', desc: 'Hasar x1.6, patlama x1.5', mods: { dmg: 1.6, splash: 1.5 } },
      B: { name: 'Yangın Bombası', desc: 'Vurduğu yerde 4sn yanan alan bırakır', mods: {}, set: { fireField: 30 } },
    },
  },
  poison: {
    name: 'Zehir Kulesi', short: 'ZHR', color: '#7bdc3a', unlock: 5, cost: 200,
    kind: 'proj', proj: 'glob', projSpeed: 9, dmg: 6, rate: 0.8, range: 3.8,
    dtype: 'poison', ground: true, air: false, splash: 1.4, poison: 16, poisonDur: 4,
    desc: 'Zehir bulutu: zırhı yok sayan kalıcı hasar, iyileşmeyi engeller.',
    specs: {
      A: { name: 'Veba', desc: 'Zehir hasarı x2.5', mods: {}, set: { poison: 40 } },
      B: { name: 'Asit', desc: 'Zırhı eritir, zehir x1.5', mods: {}, set: { poison: 24, shred: 1 } },
    },
  },
  laser: {
    name: 'Lazer', short: 'LZR', color: '#ff3d8b', unlock: 6, cost: 350,
    kind: 'beam', dmg: 32, rate: 10, range: 5, rampMax: 4, rampTime: 3,
    dtype: 'energy', ground: true, air: true,
    desc: 'Sürekli ışın. Aynı hedefte kaldıkça hasarı 4 katına çıkar.',
    specs: {
      A: { name: 'Prizma', desc: 'Işın 3 hedefe bölünür', mods: {}, set: { beams: 3 } },
      B: { name: 'Ölüm Işını', desc: 'Hasar x1.5, 8 kata kadar yükselir', mods: { dmg: 1.5 }, set: { rampMax: 8 } },
    },
  },
  radar: {
    name: 'Radar', short: 'RDR', color: '#3dffb0', unlock: 6, cost: 200,
    kind: 'aura', range: 3, reveal: 5.5, buffDmg: 0.2, buffRange: 0.1, buffRate: 0,
    dtype: 'phys', ground: false, air: false,
    desc: 'Yakındaki kulelere +%20 hasar, +%10 menzil. Görünmezleri açığa çıkarır.',
    specs: {
      A: { name: 'Komuta Merkezi', desc: '+%40 hasar, +%15 atış hızı', mods: {}, set: { buffDmg: 0.4, buffRate: 0.15 } },
      B: { name: 'Gözetleme', desc: 'Dev görüş, menzildeki düşmanlar +%25 hasar alır', mods: {}, set: { reveal: 10, mark: 0.25 } },
    },
  },
  rail: {
    name: 'Railgun', short: 'RAY', color: '#9d7bff', unlock: 7, cost: 450,
    kind: 'rail', beam: 'rail', dmg: 320, rate: 0.28, range: 10,
    dtype: 'energy', ground: true, air: true, armorPierce: 1,
    desc: 'Önündeki tüm düşmanları delip geçen manyetik mermi.',
    specs: {
      A: { name: 'Gauss', desc: 'Atış hızı x2.2', mods: { rate: 2.2 } },
      B: { name: 'Tekillik Topu', desc: 'Hasar x2.5, sersemletir', mods: { dmg: 2.5 }, set: { stun: 0.6 } },
    },
  },
  gravity: {
    name: 'Kara Delik', short: 'KDL', color: '#b04dff', unlock: 8, cost: 500,
    kind: 'grav', dmg: 60, rate: 0.18, range: 5, radius: 2, pull: 1.8,
    dtype: 'energy', ground: true, air: true,
    desc: 'Tekillik oluşturur: düşmanları geri çeker ve ezer.',
    specs: {
      A: { name: 'Olay Ufku', desc: 'Çekiş x2, hasar x2', mods: { dmg: 2, pull: 2 } },
      B: { name: 'Zaman Bükücü', desc: 'Alanı 3sn yavaşlatır ve sersemletir', mods: {}, set: { slow: 0.6, slowDur: 3, stun: 1 } },
    },
  },
};
export const TOWER_ORDER = ['mg', 'cannon', 'frost', 'sniper', 'flak', 'flame', 'mine', 'tesla', 'missile', 'mortar', 'poison', 'laser', 'radar', 'rail', 'gravity'];

export const LEVEL_MULT = { dmg: 1.4, range: 1.08, rate: 1.12, income: 1.5, splash: 1.1 };
export const MAX_TOWER_LEVEL = 4; // 4 = uzmanlık

export function upgradeCost(def, level) {
  // level: mevcut seviye; bir sonrakine geçiş maliyeti
  if (level === 1) return Math.round(def.cost * 0.75 / 5) * 5;
  if (level === 2) return Math.round(def.cost * 1.1 / 5) * 5;
  if (level === 3) return Math.round(def.cost * 1.8 / 5) * 5;
  return 0;
}
export const SELL_RATIO = 0.7;

// ---------------------------------------------------------------- DÜŞMANLAR
// wave: ilk görüldüğü dalga, cost: dalga bütçesindeki tehdit puanı
export const ENEMIES = {
  grunt: { name: 'Er', hp: 60, speed: 1.4, reward: 5, xp: 4, dmg: 1, size: 0.45, color: '#c0504d', wave: 1, cost: 1, group: 1 },
  runner: { name: 'Koşucu', hp: 38, speed: 2.7, reward: 5, xp: 4, dmg: 1, size: 0.38, color: '#e8a33d', wave: 2, cost: 1.1, group: 1 },
  swarm: { name: 'Sürü Böceği', hp: 16, speed: 2.1, reward: 1, xp: 1, dmg: 1, size: 0.25, color: '#9bbb3b', wave: 3, cost: 0.35, group: 8 },
  brute: { name: 'Zırhlı', hp: 190, speed: 1.0, armor: 6, reward: 12, xp: 9, dmg: 2, size: 0.55, color: '#7b8794', wave: 4, cost: 3, group: 1, resist: { phys: 0.8 } },
  drone: { name: 'Drone', hp: 70, speed: 1.9, reward: 8, xp: 6, dmg: 1, size: 0.4, color: '#4fc3f7', wave: 5, cost: 1.8, group: 2, flying: true },
  shield: { name: 'Kalkanlı', hp: 120, shield: 140, speed: 1.3, reward: 12, xp: 9, dmg: 2, size: 0.5, color: '#5c6bc0', wave: 6, cost: 3, group: 1 },
  healer: { name: 'Sağlıkçı', hp: 110, speed: 1.3, reward: 12, xp: 9, dmg: 1, size: 0.45, color: '#ffffff', wave: 7, cost: 3, group: 1, heal: 0.06 },
  splitter: { name: 'Bölünen', hp: 170, speed: 1.2, reward: 8, xp: 7, dmg: 2, size: 0.55, color: '#ab47bc', wave: 8, cost: 3, group: 1, split: { type: 'splitling', n: 3 } },
  splitling: { name: 'Parçacık', hp: 45, speed: 1.9, reward: 3, xp: 2, dmg: 1, size: 0.3, color: '#ce93d8', wave: 999, cost: 1, group: 1 },
  ghost: { name: 'Hayalet', hp: 95, speed: 2.0, reward: 11, xp: 9, dmg: 2, size: 0.45, color: '#b0bec5', wave: 10, cost: 3, group: 2, stealth: true },
  tank: { name: 'Tank', hp: 650, speed: 0.7, armor: 12, reward: 30, xp: 22, dmg: 5, size: 0.75, color: '#556b2f', wave: 11, cost: 8, group: 1, resist: { phys: 0.7, fire: 0.8 } },
  berserker: { name: 'Çılgın', hp: 230, speed: 1.2, reward: 14, xp: 11, dmg: 3, size: 0.5, color: '#d32f2f', wave: 12, cost: 4, group: 1, berserk: 1.6 },
  golem: { name: 'Buz Golemi', hp: 480, speed: 0.9, armor: 4, reward: 25, xp: 18, dmg: 4, size: 0.7, color: '#b3e5fc', wave: 14, cost: 7, group: 1, immuneSlow: true, resist: { ice: 0.1, fire: 1.6 } },
  bomber: { name: 'Bombardıman', hp: 380, speed: 1.1, armor: 5, reward: 24, xp: 18, dmg: 5, size: 0.65, color: '#37474f', wave: 15, cost: 7, group: 1, flying: true },
  summoner: { name: 'Çağırıcı', hp: 380, speed: 0.9, reward: 25, xp: 18, dmg: 3, size: 0.6, color: '#6a1b9a', wave: 16, cost: 7, group: 1, summon: { type: 'swarm', n: 2, every: 4 } },
  phaser: { name: 'Faz Kayıcı', hp: 260, speed: 1.3, reward: 18, xp: 14, dmg: 3, size: 0.5, color: '#00e5ff', wave: 18, cost: 5, group: 1, blink: { dist: 2.5, every: 4 }, resist: { energy: 0.5, elec: 0.5 } },
  // BOSSLAR
  titan: { name: 'TİTAN', hp: 5200, speed: 0.55, armor: 18, reward: 300, xp: 150, dmg: 20, size: 1.3, color: '#8d6e63', wave: 999, cost: 0, boss: true, immuneStun: true },
  mothership: { name: 'ANA GEMİ', hp: 4200, speed: 0.6, armor: 8, reward: 300, xp: 150, dmg: 20, size: 1.4, color: '#263238', wave: 999, cost: 0, boss: true, flying: true, immuneStun: true, summon: { type: 'drone', n: 2, every: 6 } },
  queen: { name: 'KRALİÇE', hp: 4600, speed: 0.6, armor: 6, reward: 300, xp: 150, dmg: 20, size: 1.2, color: '#880e4f', wave: 999, cost: 0, boss: true, immuneStun: true, regen: 0.01, summon: { type: 'swarm', n: 4, every: 3 } },
};
export const ENEMY_ORDER = Object.keys(ENEMIES);
export const BOSS_ORDER = ['titan', 'mothership', 'queen'];

// ---------------------------------------------------------------- BÖLÜMLER
export const THEMES = {
  grass: { name: 'Çayır', ground: '#4c8c3a', ground2: '#5a9c46', path: '#b89968', edge: '#3a6e2c', sky: '#8fd0ff', fog: '#a8dcff', deco: 'tree', light: 1.0 },
  desert: { name: 'Çöl', ground: '#d9b56c', ground2: '#e2c07a', path: '#a8844e', edge: '#b8934e', sky: '#ffd9a0', fog: '#ffe2b5', deco: 'cactus', light: 1.1 },
  snow: { name: 'Kar', ground: '#e8f0f7', ground2: '#f5f9fc', path: '#8aa0b4', edge: '#c3d3e0', sky: '#c9e2f5', fog: '#dcebf7', deco: 'pine', light: 1.0 },
  lava: { name: 'Volkan', ground: '#3b2f2f', ground2: '#463838', path: '#6d4c41', edge: '#ff5722', sky: '#401a12', fog: '#5a2618', deco: 'rock', light: 0.8 },
  night: { name: 'Gece', ground: '#2a3550', ground2: '#313d5c', path: '#5d6b8a', edge: '#1b2238', sky: '#0b1024', fog: '#151b33', deco: 'lamp', light: 0.55 },
  alien: { name: 'Yabancı Gezegen', ground: '#3d2a5c', ground2: '#473168', path: '#7a5aa6', edge: '#00e5ff', sky: '#1a0f2e', fog: '#2a1845', deco: 'crystal', light: 0.75 },
};

export const STAGES = [
  { id: 1, name: 'Yeşil Vadi', theme: 'grass', template: 'A', waves: 20, hp: 0.8, gold: 1.0, seed: 11 },
  { id: 2, name: 'Çöl Karakolu', theme: 'desert', template: 'B', waves: 25, hp: 1.0, gold: 1.0, seed: 23 },
  { id: 3, name: 'Donmuş Geçit', theme: 'snow', template: 'C', waves: 30, hp: 1.1, gold: 1.0, seed: 37 },
  { id: 4, name: 'Volkan Üssü', theme: 'lava', template: 'A', waves: 35, hp: 1.22, gold: 1.0, seed: 41 },
  { id: 5, name: 'Gece Şehri', theme: 'night', template: 'B', waves: 40, hp: 1.35, gold: 1.0, seed: 53 },
  { id: 6, name: 'Son Kale', theme: 'alien', template: 'C', waves: 50, hp: 1.5, gold: 1.0, seed: 67 },
  { id: 7, name: 'Sonsuz Savaş', theme: 'night', template: 'C', waves: 0, hp: 1.1, gold: 1.0, seed: 79, endless: true },
];

export const DIFFICULTIES = [
  { id: 0, name: 'Kolay', hp: 0.7, gold: 1.25, hq: 1.5 },
  { id: 1, name: 'Normal', hp: 1.0, gold: 1.0, hq: 1.0 },
  { id: 2, name: 'Zor', hp: 1.4, gold: 0.9, hq: 0.8 },
  { id: 3, name: 'Kabus', hp: 1.9, gold: 0.8, hq: 0.6 },
];

// ---------------------------------------------------------------- OYUNCU SEVİYESİ
export const MAX_PLAYER_LEVEL = 20;
export function xpToNext(level) { return Math.floor(80 * Math.pow(1.42, level - 1)); }
export const LEVEL_DMG_BONUS = 0.03; // seviye başına kule hasarı

export const STRIKE = { unlock: 2, cooldown: 45, delay: 1.2, radius: 2.6, dmg: 160 };

// ---------------------------------------------------------------- KARARGAH
export const HQ = {
  baseHp: 100,
  repair: { cost: 200, amount: 0.3 },
  armor: { costs: [250, 500, 900], reduce: 0.15 },
  gun: { costs: [300, 600, 1100], dmg: [0, 30, 70, 160], rate: 1.6, range: 5.5 },
};

// ---------------------------------------------------------------- KALICI GELİŞİM (yıldızlarla)
export const PERKS = {
  gold: { name: 'Hazine', desc: '+40 başlangıç altını', max: 5 },
  dmg: { name: 'Silah Sanayi', desc: '+%4 kule hasarı', max: 5 },
  cost: { name: 'Mühendislik', desc: '-%3 inşa maliyeti', max: 5 },
  hq: { name: 'Tahkimat', desc: '+10 karargah canı', max: 3 },
  xp: { name: 'Eğitim', desc: '+%10 tecrübe', max: 3 },
  air: { name: 'Hava Desteği', desc: 'Hava saldırısı +%15 hasar, -%10 bekleme', max: 3 },
};
export function perkCost(level) { return level + 1; } // bir sonraki seviyenin yıldız bedeli

export function sanitizePerks(p) {
  const out = {};
  for (const k of Object.keys(PERKS)) {
    const v = Math.floor(Number(p && p[k]) || 0);
    out[k] = Math.max(0, Math.min(PERKS[k].max, v));
  }
  return out;
}

export function starsFor(stage, win, hqFrac, wavesReached) {
  if (stage.endless) return Math.min(3, Math.floor(wavesReached / 10));
  if (!win) return 0;
  if (hqFrac >= 0.9) return 3;
  if (hqFrac >= 0.5) return 2;
  return 1;
}

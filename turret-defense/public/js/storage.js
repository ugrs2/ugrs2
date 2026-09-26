// Kalıcı profil: isim, cihaz anahtarı, kazanılan yıldızlar, gelişimler.
import { PERKS, perkCost, sanitizePerks, STAGES } from '/shared/data.js';

const KEY = 'kale-savunmasi-profil-v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export const profile = Object.assign({
  name: '',
  key: 'd' + Math.random().toString(36).slice(2, 10),
  stars: {},
  perks: {},
  sfx: true,
}, load());
profile.perks = sanitizePerks(profile.perks);

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* gizli sekme */ }
}
save();

export function totalStars() { return Object.values(profile.stars).reduce((a, b) => a + (b || 0), 0); }
export function spentStars() {
  let s = 0;
  for (const k in PERKS) for (let l = 0; l < profile.perks[k]; l++) s += perkCost(l);
  return s;
}
export function freeStars() { return totalStars() - spentStars(); }

export function buyPerk(k) {
  const lvl = profile.perks[k];
  if (lvl >= PERKS[k].max) return false;
  if (freeStars() < perkCost(lvl)) return false;
  profile.perks[k] = lvl + 1;
  save();
  return true;
}
export function resetPerks() { for (const k in PERKS) profile.perks[k] = 0; save(); }

export function recordStars(stageId, stars) {
  if ((profile.stars[stageId] || 0) < stars) { profile.stars[stageId] = stars; save(); return true; }
  return false;
}

export function stageUnlocked(stageId) {
  const i = STAGES.findIndex(s => s.id === stageId);
  if (i <= 0) return true;
  const st = STAGES[i];
  if (st.endless) return (profile.stars[3] || 0) > 0;
  return (profile.stars[STAGES[i - 1].id] || 0) > 0;
}
// Aynı cihazdaki birden fazla yerel oyuncu için ayrı anahtar
export function deviceKey(localId) { return profile.key + ':' + localId; }

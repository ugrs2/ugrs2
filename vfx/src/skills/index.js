import { seriAtis, taklaAtis, okYagmuru, olumAtisi } from './archer.js';
import { golgeAdimi, hancerYelpazesi, dumanBombasi, binKesik } from './assassin.js';
import { temelAtis, temelVurus, yaratikOlum, isabet } from './common.js';

/** vfx.cast(id, opts) ile çağrılan yetenek kayıtları. */
export const SKILLS = {
  // Okçu
  seriAtis: { name: 'Seri Atış', emoji: '🔫', role: 'okcu', fn: seriAtis },
  taklaAtis: { name: 'Takla Atış', emoji: '🤸', role: 'okcu', fn: taklaAtis, moves: true },
  okYagmuru: { name: 'Ok Yağmuru', emoji: '🏹', role: 'okcu', fn: okYagmuru },
  olumAtisi: { name: 'Ölüm Atışı', emoji: '💀', role: 'okcu', fn: olumAtisi },
  // Suikastçı
  golgeAdimi: { name: 'Gölge Adımı', emoji: '👤', role: 'suikastci', fn: golgeAdimi, moves: true },
  hancerYelpazesi: { name: 'Hançer Yelpazesi', emoji: '🔪', role: 'suikastci', fn: hancerYelpazesi },
  dumanBombasi: { name: 'Duman Bombası', emoji: '💨', role: 'suikastci', fn: dumanBombasi },
  binKesik: { name: 'Bin Kesik', emoji: '⚔️', role: 'suikastci', fn: binKesik, moves: true },
  // Genel
  temelAtis: { name: 'Temel Atış', emoji: '➶', role: 'genel', fn: temelAtis },
  temelVurus: { name: 'Temel Vuruş', emoji: '🗡️', role: 'genel', fn: temelVurus },
  yaratikOlum: { name: 'Yaratık Ölümü', emoji: '☠️', role: 'genel', fn: yaratikOlum },
  isabet: { name: 'İsabet', emoji: '✴️', role: 'genel', fn: isabet },
};

export { seriAtis, taklaAtis, okYagmuru, olumAtisi, golgeAdimi, hancerYelpazesi, dumanBombasi, binKesik, temelAtis, temelVurus, yaratikOlum, isabet };

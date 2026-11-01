/* js/main.js — [integration] açılış (boot) ve bağlama (SPEC.md §10)
 *
 * Sıra: SIM.engine.init() → diagram(#diagram-root, #map-legend) → device(#device-root)
 *       → inspector(#inspector-root) → controls → tour → URL hash (#tur, #tur-3).
 * Her adım kendi try/catch'i içinde: bir modül eksik ya da hatalıysa diğerleri çalışmaya devam eder.
 */
window.SIM = window.SIM || {};

(function (SIM) {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  function step(name, fn) {
    try { return fn(); }
    catch (e) {
      try { console.error('[SIM.main] ' + name + ' başlatılamadı:', e); } catch (x) { /* yut */ }
      return null;
    }
  }

  /** '#tur' → 0, '#tur-3' → 2 (bölüm 3), aksi halde -1. */
  function tourIndexFromHash(hash) {
    var m = /^#tur(?:-(\d+))?$/i.exec(String(hash || '').trim());
    if (!m) return -1;
    var n = m[1] ? parseInt(m[1], 10) - 1 : 0;
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function applyHash() {
    var idx = tourIndexFromHash(location.hash);
    if (idx < 0 || !SIM.tour || typeof SIM.tour.start !== 'function') return;
    if (SIM.tour.isActive && SIM.tour.isActive()) {
      if (typeof SIM.tour.goTo === 'function' && SIM.tour.current && SIM.tour.current() !== idx) SIM.tour.goTo(idx);
      return;
    }
    SIM.tour.start(idx);
  }

  async function boot() {
    if (SIM.booted) return;
    SIM.booted = true;
    document.documentElement.classList.add('sim-booting');

    // Tek dosyalık sürümde (dist/simulator.html) doküman bağlantıları bir üst klasöre göre çözülür.
    if (SIM.bundled && SIM.inspector) SIM.inspector.docsBase = '../../';

    if (SIM.engine && typeof SIM.engine.init === 'function') {
      try { await SIM.engine.init(); }
      catch (e) { try { console.error('[SIM.main] engine.init hata verdi:', e); } catch (x) { /* yut */ } }
    } else {
      try { console.error('[SIM.main] SIM.engine yok; simülasyon akışları çalışmayacak.'); } catch (x) { /* yut */ }
    }

    step('diagram', function () { if (SIM.diagram) SIM.diagram.mount(byId('diagram-root'), byId('map-legend')); });
    step('device', function () { if (SIM.device) SIM.device.mount(byId('device-root')); });
    step('inspector', function () { if (SIM.inspector) SIM.inspector.mount(byId('inspector-root')); });
    step('controls', function () { if (SIM.controls && SIM.controls.mount) SIM.controls.mount(); });
    step('tour', function () { if (SIM.tour && SIM.tour.mount) SIM.tour.mount(); });

    document.documentElement.classList.remove('sim-booting');
    document.documentElement.classList.add('sim-ready');
    SIM.ready = true;
    try { SIM.bus.emit('app:ready', {}); } catch (e) { /* yut */ }

    step('hash', applyHash);
    window.addEventListener('hashchange', function () { step('hashchange', applyHash); });
  }

  SIM.main = { boot: boot, tourIndexFromHash: tourIndexFromHash };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.SIM);

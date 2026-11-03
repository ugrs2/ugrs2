/* js/controls.js — [integration] SIM.controls (SPEC.md §10)
 *
 * - Üst bar (#sim-controls): hız (0,5× 1× 2× 4×), Duraklat/Devam, Adım modu + İleri (adım beklerken nabız atar),
 *   Arka plan trafiği anahtarı, Sıfırla. Klavye: Boşluk = duraklat/devam, → = ileri (adım modunda).
 * - Aksiyon çubuğu (#action-bar): hat renginde aksiyon çipleri (SIM.device API'si; clean room ve kampanya
 *   güncellemesi doğrudan SIM.engine.dispatch) + meşgul/kuyruk göstergesi.
 * - Anlatım şeridi (#narration): son 'narrate' metni, hat rozeti ve istasyon adı; adım modunda "İleri" butonu.
 * - Telefonda (< 820px): bir aksiyon başlayınca harita görünmüyorsa haritaya yumuşak kaydırma; harita
 *   görünürken yüzen "↑ Siteye dön" butonu.
 *
 * Ek API: SIM.controls.mount(), .runChip(id), .chips, .scrollToMap(force), .backToSite(), .togglePause(), .stepNext()
 * Yayınlanan ek bus olayı: 'controls:chip' { id, phase:'start'|'end', result? }
 */
window.SIM = window.SIM || {};

(function (SIM) {
  'use strict';

  var U = SIM.util, bus = SIM.bus, D = SIM.data;
  var SPEEDS = [0.5, 1, 2, 4];
  var KIND_LABEL = { ok: 'tamam', warn: 'uyarı', drop: 'atıldı', info: '' };

  var ICON_PATHS = {
    pause: '<path d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z" fill="currentColor" stroke="none"/>',
    play: '<path d="M7.5 5.2v13.6L18.6 12z" fill="currentColor" stroke="none"/>',
    next: '<path d="M6 5.5v13l9-6.5z" fill="currentColor" stroke="none"/><path d="M17.5 5.5v13"/>',
    reset: '<path d="M4.8 12a7.2 7.2 0 1 0 2.1-5.1"/><path d="M4.6 4.4v4.3h4.3"/>',
    up: '<path d="M12 19V5.5M6 11.5l6-6 6 6"/>',
    tour: '<rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M10 8v5l4.2-2.5z" fill="currentColor"/><path d="M8.5 20h7M12 16.5V20"/>'
  };

  var C = {
    mounted: false, el: {}, waiting: false, busy: false, queue: 0,
    flows: {}, topFlow: null, chipRuns: {}, scrollT: 0, lastNarr: null,
    backVisible: false, rafPending: false
  };

  /* ==================================================================
   * Yardımcılar
   * ================================================================== */
  function el() { return U.el.apply(null, arguments); }
  function icon(name, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.setAttribute('class', 'ct-ico' + (cls ? ' ' + cls : ''));
    s.innerHTML = ICON_PATHS[name] || '';
    return s;
  }
  function lineCode(line) { return (D && D.lines && D.lines[line] && D.lines[line].code) || '·'; }
  function lineName(line) { return (D && D.lines && D.lines[line] && D.lines[line].name) || ''; }
  function badge(line, size) {
    return el('span', { class: 'line-badge' + (size ? ' ' + size : ''), 'data-line': line, 'aria-hidden': 'true' }, lineCode(line));
  }
  function fmtSpeed(v) { return (v === 0.5 ? '0,5' : String(v)) + '×'; }
  function isPhone() { return U.breakpoint() === 'phone'; }
  function reducedMotion() {
    if (SIM.settings && SIM.settings.reducedMotion) return true;
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function state() { return SIM.state || {}; }
  function engine() { return SIM.engine && typeof SIM.engine.dispatch === 'function' ? SIM.engine : null; }
  function device() { return SIM.device && typeof SIM.device.go === 'function' ? SIM.device : null; }
  function safe(fn) {
    try { return Promise.resolve(fn()); }
    catch (e) {
      try { console.error('[SIM.controls]', e); } catch (x) { /* yut */ }
      return Promise.resolve({ ok: false, error: String(e && e.message || e) });
    }
  }
  function dispatch(action) {
    var e = engine();
    if (!e) return Promise.resolve({ ok: false, reason: 'motor yok' });
    return safe(function () { return e.dispatch(action); });
  }
  /** Motor boşalana kadar bekler (en fazla maxMs gerçek zaman). */
  function whenIdle(maxMs) {
    return new Promise(function (resolve) {
      var e = engine();
      if (!e || !e.isBusy()) { resolve(true); return; }
      var done = false;
      var off = bus.on('busy', function (p) {
        if (p && !p.busy && !done) { done = true; off(); clearTimeout(t); resolve(true); }
      });
      var t = setTimeout(function () { if (!done) { done = true; off(); resolve(false); } }, maxMs || 60000);
    });
  }

  /* ==================================================================
   * Aksiyon çipleri (SPEC §10)
   * ================================================================== */
  function currentRoute() { var d = device(); return d && d.route ? d.route() : { page: 'home' }; }
  function productForView() {
    var r = currentRoute();
    if (r.page === 'product' && r.sku) return r.sku;
    if (r.page === 'article' && r.articleId && D.articleById[r.articleId] && D.articleById[r.articleId].relatedSku) return D.articleById[r.articleId].relatedSku;
    return 'OTO-EV-001';
  }
  function productForCart() {
    var r = currentRoute();
    if (r.page === 'product' && r.sku) return r.sku;
    var u = state().user || {};
    if (u.sku && D.productBySku[u.sku]) return u.sku;
    return productForView();
  }

  function runCleanroom() {
    showInspector('cleanroom');
    return dispatch({ type: 'cleanroom_run' });
  }
  /** Demo değişikliği: Volta e-SUV (LI 101) CPM fiyatını 85 ↔ 95 ₺ arasında değiştirir. */
  function runCampaign() {
    showInspector('campaigns');
    var li = (state().lineItems || {})[101];
    var base = (D.lineItemById[101] && D.lineItemById[101].rate) || 85;
    var next = li && li.rate === base + 10 ? base : base + 10;
    return dispatch({ type: 'campaign_update', lineItemId: 101, patch: { rate: next } });
  }
  function runClick() {
    var d = device();
    if (!d) return Promise.resolve({ ok: false });
    var u = state().user || {};
    // Reklam henüz yükleniyorsa (kuyrukta ad_request varken) önce o akışların bitmesini bekle.
    if (!u.lastAd && engine() && engine().isBusy()) return whenIdle(30000).then(function () { return d.clickAd(); });
    return d.clickAd();
  }
  function showInspector(tab) {
    try { if (SIM.inspector && SIM.inspector.show) SIM.inspector.show(tab, { reveal: false }); } catch (e) { /* yut */ }
  }

  var CHIPS = [
    { id: 'consent', label: 'Rıza ver', line: 'privacy', title: 'KVKK banner’ında “Tümünü kabul et”: rıza kaydı + TC string',
      run: function () { return device().acceptConsent('all'); } },
    { id: 'article', label: 'Otomobil haberi oku', line: 'dmp', title: 'Otomobil haberini aç: page_view + mpu reklam isteği',
      run: function () { return device().go('article', { articleId: 'a-oto' }); } },
    { id: 'product', label: 'Ürüne bak', line: 'dmp', title: 'İlgili ürün sayfasını aç: product_view',
      run: function () { return device().go('product', { sku: productForView() }); } },
    { id: 'cart', label: 'Sepete ekle', line: 'dmp', title: 'Ürünü sepete ekle: add_to_cart',
      run: function () { return device().addToCart(productForCart()); } },
    { id: 'login', label: 'Giriş yap', line: 'dmp', title: 'Demo e-postasıyla giriş: SHA-256 hash → kimlik birleştirme',
      run: function () { return device().login(); } },
    { id: 'click', label: 'Reklama tıkla', line: 'measure', title: 'Son gösterilen reklama tıkla: /clk 302 → ölçüm',
      run: runClick },
    { id: 'purchase', label: 'Satın al', line: 'dmp', title: 'Sepetteki ürünleri satın al: purchase (tıklamadan sonraysa dönüşüm)',
      run: function () { return device().purchase(); } },
    { id: 'cleanroom', label: 'Clean room', line: 'cleanroom', title: 'Perakendeci X ile eşleştirmeyi çalıştır (k ≥ 50, ε = 0,5)',
      run: runCleanroom, engineOnly: true },
    { id: 'campaign', label: 'Kampanya güncelle', line: 'control', title: 'Volta e-SUV (LI 101) CPM fiyatını değiştir: Admin UI → PostgreSQL → CDC → karar motoru',
      run: runCampaign, engineOnly: true },
    { id: 'dsar', label: 'Verilerimi sil', line: 'privacy', title: 'KVKK silme talebi (DSAR): profil, idmap, arşiv, raporlar, clean room, ortaklar',
      run: function () { return device().requestDsar(); } }
  ];
  var CHIP_BY_ID = {};
  CHIPS.forEach(function (c) { CHIP_BY_ID[c.id] = c; });

  function runChip(id) {
    var def = CHIP_BY_ID[id];
    if (!def) return Promise.resolve({ ok: false, reason: 'bilinmeyen çip' });
    if (!def.engineOnly && !device()) return Promise.resolve({ ok: false, reason: 'cihaz yok' });
    var btn = C.el.chips && C.el.chips[id];
    C.chipRuns[id] = (C.chipRuns[id] || 0) + 1;
    syncChip(id);
    if (btn) { btn.classList.remove('is-fired'); void btn.offsetWidth; btn.classList.add('is-fired'); }
    try { bus.emit('controls:chip', { id: id, phase: 'start' }); } catch (e) { /* yut */ }
    scheduleMapScroll();
    return safe(def.run).then(function (res) {
      C.chipRuns[id] = Math.max(0, (C.chipRuns[id] || 1) - 1);
      syncChip(id);
      try { bus.emit('controls:chip', { id: id, phase: 'end', result: res }); } catch (e) { /* yut */ }
      return res;
    });
  }
  function syncChip(id) {
    var btn = C.el.chips && C.el.chips[id];
    if (!btn) return;
    var running = (C.chipRuns[id] || 0) > 0;
    btn.classList.toggle('is-running', running);
    btn.setAttribute('aria-busy', running ? 'true' : 'false');
  }
  function syncChipCounts() {
    if (!C.mounted) return;
    var u = state().user || {};
    var n = Array.isArray(u.cart) ? u.cart.length : 0;
    var cnt = C.el.cartCount;
    if (cnt) {
      cnt.textContent = String(n);
      cnt.hidden = n === 0;
      C.el.chips.purchase.setAttribute('aria-label', 'Satın al' + (n ? ' (sepette ' + n + ' ürün)' : ' (sepet boş)'));
    }
  }

  /* ==================================================================
   * Üst bar kontrolleri
   * ================================================================== */
  function buildSimControls(root) {
    U.clear(root);
    var E = C.el;

    // Hız
    E.speedBtns = {};
    var group = el('div', { class: 'btn-group ct-speed', role: 'group', 'aria-labelledby': 'ct-speed-label' });
    SPEEDS.forEach(function (v) {
      var b = el('button', {
        type: 'button', class: 'btn btn-sm ct-speed-btn', 'aria-pressed': 'false', 'data-speed': String(v),
        title: 'Simülasyon hızı ' + fmtSpeed(v),
        onclick: function () { SIM.setSetting('speed', v); }
      }, fmtSpeed(v));
      E.speedBtns[v] = b;
      group.appendChild(b);
    });
    var speed = el('div', { class: 'ct-field' }, el('span', { class: 'ct-label', id: 'ct-speed-label' }, 'Hız'), group);

    // Duraklat / Devam
    E.pauseIco = el('span', { class: 'ct-ico-wrap' });
    E.pauseText = el('span', { class: 'ct-btn-text' }, 'Duraklat');
    E.pause = el('button', {
      type: 'button', class: 'btn btn-sm ct-pause', id: 'ct-pause', 'aria-keyshortcuts': 'Space',
      title: 'Duraklat / devam et (Boşluk)', onclick: togglePause
    }, E.pauseIco, E.pauseText);

    // Adım modu + İleri
    E.step = el('button', {
      type: 'button', class: 'switch ct-switch', role: 'switch', id: 'ct-step', 'aria-checked': 'false',
      title: 'Adım modu: her hop öncesi “İleri” beklenir',
      onclick: function () { SIM.setSetting('stepMode', !SIM.settings.stepMode); }
    }, el('span', { class: 'ct-switch-label' }, 'Adım modu'));
    E.next = el('button', {
      type: 'button', class: 'btn btn-sm ct-next', id: 'ct-next', 'aria-keyshortcuts': 'ArrowRight',
      title: 'Sonraki hop (→)', disabled: true, onclick: stepNext
    }, el('span', { class: 'ct-btn-text' }, 'İleri'), icon('next'));
    var stepGroup = el('div', { class: 'ct-field ct-stepgroup' }, E.step, E.next);

    // Arka plan trafiği
    E.ambient = el('button', {
      type: 'button', class: 'switch ct-switch', role: 'switch', id: 'ct-ambient', 'aria-checked': 'true',
      title: 'Diğer ziyaretçilerin trafiği (raporlar ve soluk paketler)',
      onclick: function () { SIM.setSetting('ambient', !SIM.settings.ambient); }
    }, el('span', { class: 'ct-switch-label' }, 'Arka plan trafiği'));

    // Sıfırla
    E.reset = el('button', {
      type: 'button', class: 'btn btn-sm ct-reset', id: 'ct-reset', title: 'Simülasyonu başa al (durum, rıza, profil, raporlar)',
      onclick: doReset
    }, icon('reset'), el('span', { class: 'ct-btn-text' }, 'Sıfırla'));

    root.appendChild(speed);
    root.appendChild(el('span', { class: 'ct-sep', 'aria-hidden': 'true' }));
    root.appendChild(E.pause);
    root.appendChild(stepGroup);
    root.appendChild(el('span', { class: 'ct-sep', 'aria-hidden': 'true' }));
    root.appendChild(E.ambient);
    root.appendChild(E.reset);
    root.setAttribute('role', 'toolbar');
    root.setAttribute('aria-label', 'Simülasyon kontrolleri');
    // Telefonda bu satır yatay kayar: sona gelinmediyse sağ kenar soluklaşır (CSS .is-end).
    var syncEnd = function () { root.classList.toggle('is-end', root.scrollLeft + root.clientWidth >= root.scrollWidth - 2); };
    root.addEventListener('scroll', syncEnd, { passive: true });
    window.addEventListener('resize', syncEnd);
    setTimeout(syncEnd, 0);
  }

  function syncSettings() {
    if (!C.mounted) return;
    var s = SIM.settings, E = C.el;
    SPEEDS.forEach(function (v) { E.speedBtns[v].setAttribute('aria-pressed', s.speed === v ? 'true' : 'false'); });
    U.clear(E.pauseIco);
    E.pauseIco.appendChild(icon(s.paused ? 'play' : 'pause'));
    E.pauseText.textContent = s.paused ? 'Devam' : 'Duraklat';
    E.pause.classList.toggle('is-paused', !!s.paused);
    E.pause.title = s.paused ? 'Devam et (Boşluk)' : 'Duraklat (Boşluk)';
    E.step.setAttribute('aria-checked', s.stepMode ? 'true' : 'false');
    E.next.disabled = !s.stepMode;
    E.ambient.setAttribute('aria-checked', s.ambient ? 'true' : 'false');
    document.documentElement.classList.toggle('sim-paused', !!s.paused);
    document.documentElement.classList.toggle('sim-stepmode', !!s.stepMode);
    syncWaiting();
    syncStatus();
  }

  function togglePause() { SIM.setSetting('paused', !SIM.settings.paused); }
  function stepNext() {
    if (!SIM.settings.stepMode) return;
    if (SIM.settings.paused) SIM.setSetting('paused', false);
    if (U.stepNext) U.stepNext(); else bus.emit('step:next');
  }
  function doReset() {
    var e = engine();
    try { bus.emit('controls:reset', {}); } catch (x) { /* yut */ }
    if (e && typeof e.reset === 'function') safe(function () { return e.reset(); });
  }

  function syncWaiting() {
    if (!C.mounted) return;
    var w = !!(C.waiting && SIM.settings.stepMode);
    C.el.next.classList.toggle('is-waiting', w);
    C.el.narrNext.hidden = !SIM.settings.stepMode;
    C.el.narrNext.disabled = !w;
    C.el.narrNext.classList.toggle('is-waiting', w);
    C.el.narr.classList.toggle('is-waiting', w);
    C.el.narrHint.hidden = !w;
  }

  /* ==================================================================
   * Aksiyon çubuğu
   * ================================================================== */
  function buildActionBar(root) {
    U.clear(root);
    var E = C.el;
    E.statusDot = el('span', { class: 'ct-status-dot', 'aria-hidden': 'true' });
    E.statusText = el('span', { class: 'ct-status-text' }, 'Hazır');
    E.statusQueue = el('span', { class: 'ct-status-queue mono', hidden: true });
    E.status = el('div', { class: 'ct-status', role: 'status', 'aria-live': 'polite', 'data-state': 'idle' },
      E.statusDot, E.statusText, E.statusQueue);

    E.chips = {};
    var list = el('div', { class: 'ct-chips', role: 'group', 'aria-label': 'Ziyaretçi ve operatör aksiyonları' });
    CHIPS.forEach(function (c) {
      var b = el('button', {
        type: 'button', class: 'chip ct-chip', 'data-line': c.line, 'data-chip': c.id, id: 'ct-chip-' + c.id,
        title: c.title + ' · ' + lineName(c.line), 'aria-busy': 'false',
        onclick: function () { runChip(c.id); }
      }, badge(c.line, 'sm'), el('span', { class: 'ct-chip-label' }, c.label));
      if (c.id === 'purchase') {
        E.cartCount = el('span', { class: 'chip-count', hidden: true, 'aria-hidden': 'true' }, '0');
        b.appendChild(E.cartCount);
      }
      E.chips[c.id] = b;
      list.appendChild(b);
    });
    root.appendChild(E.status);
    root.appendChild(list);
  }

  function syncStatus() {
    if (!C.mounted) return;
    var E = C.el, s = SIM.settings;
    var st = 'idle', text = 'Hazır';
    if (s.paused) { st = 'paused'; text = 'Duraklatıldı'; }
    else if (C.waiting && s.stepMode) { st = 'waiting'; text = 'İleri bekleniyor'; }
    else if (C.busy) { st = 'busy'; text = 'Akış sürüyor'; }
    else if (s.stepMode) { st = 'idle'; text = 'Adım modu'; }
    E.status.setAttribute('data-state', st);
    if (E.statusText.textContent !== text) E.statusText.textContent = text;
    var q = C.busy ? C.queue : 0;
    E.statusQueue.hidden = q <= 0;
    E.statusQueue.textContent = q > 0 ? '+' + q + ' sırada' : '';
    E.status.title = C.topFlow ? 'Şu an: ' + C.topFlow.title : '';
  }

  /* ==================================================================
   * Anlatım şeridi
   * ================================================================== */
  function buildNarration(root) {
    U.clear(root);
    var E = C.el;
    E.narrBadge = el('span', { class: 'ct-narr-badge' });
    E.narrNode = el('span', { class: 'ct-narr-node' });
    E.narrKind = el('span', { class: 'ct-narr-kind', hidden: true });
    E.narrFlow = el('span', { class: 'ct-narr-flow' });
    E.narrText = el('p', { class: 'ct-narr-text' });
    E.narrHint = el('span', { class: 'ct-narr-hint', hidden: true }, 'ya da ', el('kbd', null, '→'));
    E.narrPaused = el('span', { class: 'ct-narr-paused', hidden: true }, 'Duraklatıldı');
    E.narrNext = el('button', {
      type: 'button', class: 'btn btn-sm btn-primary ct-narr-next', id: 'ct-narr-next', hidden: true, disabled: true,
      'aria-keyshortcuts': 'ArrowRight', title: 'Adım modu: paketi bir sonraki istasyona geçir (→)', onclick: stepNext
    }, el('span', null, 'İleri'), icon('next'));
    E.narrBody = el('div', { class: 'ct-narr-body' },
      el('div', { class: 'ct-narr-head' }, E.narrBadge, E.narrNode, E.narrKind, E.narrFlow),
      E.narrText);
    E.narr = el('div', { class: 'ct-narr', 'data-kind': 'idle' },
      E.narrBody, el('div', { class: 'ct-narr-side' }, E.narrPaused, E.narrNext, E.narrHint));
    root.appendChild(E.narr);
    showIdleNarration();
  }

  function showIdleNarration() {
    var E = C.el;
    E.narr.setAttribute('data-kind', 'idle');
    E.narr.removeAttribute('data-line');
    U.clear(E.narrBadge);
    E.narrBadge.appendChild(el('span', { class: 'ct-narr-idle-mark', 'aria-hidden': 'true' }));
    E.narrNode.textContent = 'Anlatım';
    E.narrKind.hidden = true;
    E.narrFlow.textContent = '';
    E.narrText.textContent = isPhone()
      ? 'Sitede gezinin ya da alttaki çiplerden birine dokunun: her aksiyon, hat üzerinde istasyondan istasyona giden paketler olarak burada anlatılır.'
      : 'Sitede gezinin ya da aksiyon çubuğundan bir çip seçin: her aksiyon, hat üzerinde istasyondan istasyona giden paketler olarak burada adım adım anlatılır.';
    C.lastNarr = null;
  }

  function onNarrate(p) {
    if (!C.mounted || !p || !p.text) return;
    var E = C.el;
    C.lastNarr = p;
    var line = p.line || (p.flowId && C.flows[p.flowId] && C.flows[p.flowId].line) || 'control';
    var node = p.nodeId && D.nodeById[p.nodeId] ? D.nodeById[p.nodeId] : null;
    var kind = p.kind || 'info';
    E.narr.setAttribute('data-kind', kind);
    E.narr.setAttribute('data-line', line);
    U.clear(E.narrBadge);
    E.narrBadge.appendChild(badge(line, 'sm'));
    E.narrBadge.appendChild(el('span', { class: 'sr-only' }, lineName(line) + ': '));
    E.narrNode.textContent = node ? node.label : lineName(line);
    var kl = KIND_LABEL[kind] || '';
    E.narrKind.hidden = !kl;
    E.narrKind.textContent = kl;
    E.narrKind.setAttribute('data-kind', kind);
    var fl = p.flowId && C.flows[p.flowId];
    E.narrFlow.textContent = fl ? fl.title : '';
    E.narrText.textContent = p.text;
    E.narrText.scrollTop = 0;
    if (!reducedMotion()) {
      E.narrBody.classList.remove('is-new');
      void E.narrBody.offsetWidth;
      E.narrBody.classList.add('is-new');
    }
  }

  /* ==================================================================
   * Telefon: haritaya kaydırma + "Siteye dön"
   * ================================================================== */
  function bottomInset() {
    var ab = document.getElementById('action-bar');
    var h = ab && isPhone() ? ab.getBoundingClientRect().height : 0;
    var t = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tour-card-h')) || 0;
    return h + (document.documentElement.classList.contains('tour-on') && isPhone() ? t : 0);
  }
  function mapVisibleRatio() {
    var dr = document.getElementById('diagram-root');
    if (!dr) return 1;
    var r = dr.getBoundingClientRect();
    var vh = window.innerHeight - bottomInset();
    var narr = document.getElementById('narration');
    var topInset = narr && isPhone() ? Math.max(0, narr.getBoundingClientRect().bottom) : 0;
    var vis = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, Math.min(topInset, vh)));
    var need = Math.max(1, Math.min(r.height, vh));
    return vis / need;
  }
  function scrollToMap(force) {
    var dr = document.getElementById('diagram-root');
    if (!dr) return false;
    if (!force && (!isPhone() || !SIM.settings.autoScroll)) return false;
    if (!force && mapVisibleRatio() >= 0.6) return false;
    var r = dr.getBoundingClientRect();
    // Telefonda anlatım şeridi haritanın üstünde (sticky); onu da göster.
    var narr = document.getElementById('narration');
    var above = narr && isPhone() ? narr.offsetHeight : 8;
    var top = Math.max(0, window.scrollY + r.top - above);
    window.scrollTo({ top: top, behavior: reducedMotion() ? 'auto' : 'smooth' });
    return true;
  }
  function scheduleMapScroll() {
    if (!isPhone() || !SIM.settings.autoScroll) return;
    clearTimeout(C.scrollT);
    C.scrollT = setTimeout(function () { scrollToMap(false); }, 280);
  }
  function backToSite() {
    var pane = document.getElementById('device-pane');
    if (!pane) return;
    var top = Math.max(0, window.scrollY + pane.getBoundingClientRect().top);
    window.scrollTo({ top: top, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  function buildBackButton() {
    var b = el('button', {
      type: 'button', class: 'btn ct-backtosite', id: 'ct-backtosite', hidden: true,
      onclick: backToSite
    }, icon('up'), el('span', null, 'Siteye dön'));
    var app = document.getElementById('app') || document.body;
    app.appendChild(b);
    C.el.back = b;
  }
  function syncBackButton() {
    C.rafPending = false;
    if (!C.mounted || !C.el.back) return;
    var show = false;
    if (isPhone()) {
      var mp = document.getElementById('map-pane'), dp = document.getElementById('device-pane');
      if (mp && dp) {
        var vh = window.innerHeight - bottomInset();
        var m = mp.getBoundingClientRect(), d = dp.getBoundingClientRect();
        var mapVis = Math.max(0, Math.min(m.bottom, vh) - Math.max(m.top, 0));
        show = mapVis > vh * 0.35 && d.bottom < vh * 0.5;
      }
    }
    if (show !== C.backVisible) {
      C.backVisible = show;
      C.el.back.hidden = !show;
    }
  }
  function onScroll() {
    if (C.rafPending) return;
    C.rafPending = true;
    requestAnimationFrame(syncBackButton);
  }

  /* ==================================================================
   * Klavye
   * ================================================================== */
  function isTyping(t) {
    if (!t || t === document.body) return false;
    var tag = (t.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') {
      var type = (t.getAttribute('type') || 'text').toLowerCase();
      return ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].indexOf(type) < 0 || type === 'range';
    }
    return !!t.isContentEditable;
  }
  /** Boşluk tuşu odaktaki öğede kendi işini mi yapmalı? Fareyle/dokunarak odaklanmış butonda hayır
   * (sunucu çipe tıklayıp Boşluk'a basınca çip yeniden tetiklenmesin, duraklasın); klavyeyle gelinmişse evet.
   * Not: Chromium keydown anında :focus-visible'ı zaten true yapar, bu yüzden modaliteyi kendimiz izleriz. */
  var SPACE_NATIVE = 'button, summary, a[href], input, [role="button"], [role="switch"], [role="tab"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="option"], .dv-viewport';
  function spaceIsNative(t) {
    if (!t || t === document.body || t === document.documentElement) return false;
    if (t === C.pointerFocus) return false;
    try { return t.matches(SPACE_NATIVE); } catch (e) { return false; }
  }
  function onPointerDown() { C.lastPointer = Date.now(); }
  function onFocusIn(e) { C.pointerFocus = Date.now() - (C.lastPointer || 0) < 800 ? e.target : null; }
  function onKeyDown(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (e.key === 'Tab') { C.pointerFocus = null; return; }
    if (isTyping(t)) return;
    if (e.key === ' ' || e.key === 'Spacebar') {
      // Klavyeyle odaklanmış bir kontrolde Boşluk kendi işini yapar (buton etkinleştirme, kaydırma).
      if (spaceIsNative(t)) return;
      e.preventDefault();
      C.spaceTaken = true;
      togglePause();
    } else if (e.key === 'ArrowRight') {
      if (!SIM.settings.stepMode) return;
      if (t && t.closest && t.closest('[role="tablist"],[role="radiogroup"],[role="slider"],[role="menu"],[role="listbox"],.dv-viewport')) return;
      e.preventDefault();
      stepNext();
    }
  }
  function onKeyUp(e) {
    if ((e.key === ' ' || e.key === 'Spacebar') && C.spaceTaken) {
      C.spaceTaken = false;
      e.preventDefault();
    }
  }

  /* ==================================================================
   * Bus
   * ================================================================== */
  function wire() {
    bus.on('settings', function () { syncSettings(); });
    bus.on('step:waiting', function (w) {
      C.waiting = !!w;
      syncWaiting();
      syncStatus();
    });
    bus.on('busy', function (p) {
      C.busy = !!(p && p.busy);
      C.queue = (p && p.queue) || 0;
      syncStatus();
    });
    bus.on('flow:start', function (p) {
      if (!p || !p.flowId) return;
      C.flows[p.flowId] = { title: p.title, line: p.line, parent: p.parentFlowId || null };
      if (!p.parentFlowId) C.topFlow = C.flows[p.flowId];
      var keys = Object.keys(C.flows);
      if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(function (k) { delete C.flows[k]; });
      syncStatus();
    });
    bus.on('flow:end', function (p) {
      if (p && C.flows[p.flowId] === C.topFlow) C.topFlow = null;
      syncStatus();
    });
    bus.on('narrate', onNarrate);
    bus.on('state', function (p) {
      var keys = (p && p.keys) || [];
      if (keys.indexOf('user') >= 0) syncChipCounts();
    });
    bus.on('reset', function () {
      C.flows = {};
      C.topFlow = null;
      C.waiting = false;
      if (C.mounted) { showIdleNarration(); syncWaiting(); syncStatus(); syncChipCounts(); }
    });
    bus.on('device:action', function () { scheduleMapScroll(); });
  }

  /* ==================================================================
   * mount
   * ================================================================== */
  function mount() {
    U = SIM.util; bus = SIM.bus; D = SIM.data;
    if (C.mounted) return;
    var sim = document.getElementById('sim-controls');
    var bar = document.getElementById('action-bar');
    var narr = document.getElementById('narration');
    if (!sim || !bar || !narr) { console.error('[SIM.controls] #sim-controls / #action-bar / #narration bulunamadı.'); return; }
    buildSimControls(sim);
    buildActionBar(bar);
    buildNarration(narr);
    buildBackButton();
    C.mounted = true;
    wire();
    var e = engine();
    if (e) { C.busy = e.isBusy(); C.queue = e.queueLength(); }
    C.waiting = !!(U.gateWaiting && U.gateWaiting());
    syncSettings();
    syncChipCounts();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    syncBackButton();
  }

  SIM.controls = {
    mount: mount,
    runChip: runChip,
    chips: CHIPS.map(function (c) { return { id: c.id, label: c.label, line: c.line }; }),
    scrollToMap: scrollToMap,
    backToSite: backToSite,
    togglePause: togglePause,
    stepNext: stepNext,
    whenIdle: whenIdle,
    mapVisibleRatio: mapVisibleRatio
  };
})(window.SIM);

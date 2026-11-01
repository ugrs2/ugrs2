/* js/tour.js — [integration] SIM.tour: 8 bölümlük Sunum Turu (SPEC.md §10)
 *
 * Her bölüm: başlık kartı (kısa açıklama + ilgili hat rozetleri), SIM.diagram.focus ile ilgili istasyonlar,
 * ilgili inspector sekmesi ve SIM.device / SIM.engine ile otomatik aksiyonlar (tamamlanması beklenir).
 * Kart #tour-overlay içinde: masaüstünde sol altta (cihaz sütununun altına oturur, cihaz çerçevesi yukarı
 * kısalır), telefonda aksiyon çubuğunun üstünde alt sayfa. Önceki / Sonraki / Çık + ilerleme durakları.
 * #tour-controls: "Sunum turunu başlat". URL hash #tur (veya #tur-3) açılışta turu başlatır.
 *
 * Bölümler önkoşullarını kendileri tamamlar (ör. rıza yoksa önce rıza verilir, silme talebinden sonra
 * simülasyon sıfırlanır), böylece ziyaretçi önceden ne yapmış olursa olsun çalışırlar. Bölüm 1 her zaman
 * simülasyonu sıfırlar ve bunu metninde söyler.
 *
 * Sonraki'ye bölüm çalışırken basılırsa: kalan senaryo adımları iptal edilir (motora gönderilmiş akışlar
 * biter), yeni bölüm onların ardından başlar.
 *
 * API: mount(), start(i=0), stop(), next(), prev(), goTo(i), isActive(), current(), chapters,
 *      runPromise() → mevcut bölümün çalışma sözü { ok, cancelled, check }.
 * Bus: 'tour:start' {index}, 'tour:chapter' {index,id}, 'tour:chapter:done' {index,id,ok,cancelled,check},
 *      'tour:end' {completed}
 */
window.SIM = window.SIM || {};

(function (SIM) {
  'use strict';

  var U = SIM.util, bus = SIM.bus, D = SIM.data;

  /* ==================================================================
   * Yardımcılar
   * ================================================================== */
  function st() { return SIM.state || {}; }
  function user() { return st().user || {}; }
  function profile() { var u = user(); var p = st().profiles || {}; return u.personId ? p[u.personId] || null : null; }
  function hasSeg(id) { var p = profile(); return !!(p && p.seg && p.seg[id] != null); }
  function dev() { return SIM.device && typeof SIM.device.go === 'function' ? SIM.device : null; }
  function eng() { return SIM.engine && typeof SIM.engine.dispatch === 'function' ? SIM.engine : null; }
  function isPhone() { return U.breakpoint() === 'phone'; }
  function el() { return U.el.apply(null, arguments); }

  function Cancelled() { this.cancelled = true; }

  /* ==================================================================
   * Bölümler
   * ================================================================== */
  var CHAPTERS = [
    {
      id: 'rıza', title: 'Ziyaret ve KVKK rızası', lines: ['privacy', 'dmp'], tab: 'flow', resetFirst: true,
      focus: ['browser', 'cmp', 'gateway', 'collector', 'kafka', 'flink'],
      text: [
        'Tur başlarken simülasyonu sıfırladık: siteye ilk kez gelen bir ziyaretçiyiz. Karar verilene kadar CMP zorunlu olmayan çerez yazdırmaz, olay toplatmaz.',
        '“Tümünü kabul et” ile TC string üretilir, 1. parti çerez (fpc) yazılır ve rıza kaydı Kafka’ya akar.'
      ],
      done: 'Rıza kaydedildi; fpc çerezi yazıldı.',
      run: async function (x) {
        await x.step('Rıza banner’ı gösteriliyor…', function () { return SIM.controls && SIM.controls.whenIdle ? SIM.controls.whenIdle(20000) : null; });
        await x.pause(1400);
        await x.step('Ziyaretçi “Tümünü kabul et”e dokunuyor…', function () { return dev().acceptConsent('all'); });
      },
      check: function () { return st().consent && st().consent.status === 'all' && !!user().fpc; }
    },
    {
      id: 'segment', title: 'Davranış → segment', lines: ['dmp'], tab: 'profile',
      focus: ['browser', 'gateway', 'collector', 'kafka', 'flink', 'identity', 'profile', 'segment', 'iceberg'],
      text: [
        'Ziyaretçi otomobil haberini okuyup Volta e-SUV sayfasına bakıyor. Her olay Collector → Kafka → Flink’ten geçip Aerospike’taki profile yazılır.',
        'Segment Motoru kuralı anında işler: 7 günde 2 otomobil görüntülemesi → 1001 · Otomobil İlgilisi – Sıcak.'
      ],
      done: 'Profil sekmesinde: 1001 segmentine girildi.',
      run: async function (x) {
        await x.ensureFresh();
        await x.ensureConsent();
        await x.step('Otomobil haberi açılıyor…', function () { return dev().go('article', { articleId: 'a-oto' }); });
        await x.pause(900);
        await x.step('Volta e-SUV ürün sayfası açılıyor…', function () { return dev().go('product', { sku: 'OTO-EV-001' }); });
      },
      check: function () { return hasSeg(1001); }
    },
    {
      id: 'kimlik', title: 'Giriş → kimlik birleştirme', lines: ['dmp'], tab: 'profile',
      focus: ['browser', 'gateway', 'collector', 'kafka', 'flink', 'identity', 'profile', 'segment'],
      text: [
        'Giriş yapılınca e-posta tarayıcıda SHA-256 ile hash’lenir; sunucuya yalnızca hem gider.',
        'Identity Graph bu hem’i mobil uygulamadan tanıdığı P-7Q2K kişisinde bulur ve kayıtları birleştirir: çerez, hem ve mobil kimlik artık tek profilde.'
      ],
      done: 'P-7Q2K ile birleşti; 2001 ve 2002 geldi.',
      run: async function (x) {
        await x.ensureFresh();
        await x.ensureConsent();
        await x.step('Demo e-postasıyla giriş yapılıyor…', function () { return dev().login(); });
      },
      check: function () { var u = user(); return !!u.loggedIn && u.personId === D.demoUser.seedPersonId && hasSeg(2001) && hasSeg(2002); }
    },
    {
      id: 'reklam', title: 'Reklam isteği ve birleşik açık artırma', lines: ['ad'], tab: 'decision',
      focus: ['browser', 'gateway', 'adapi', 'decision', 'identity', 'profile', 'tindex', 'fcap', 'ml', 'prebid', 'dsp', 'auction', 'cdn'],
      text: [
        'Haberdeki mpu alanı için karar motoru profili okur, adayları fcap, pacing ve ML skoruyla süzer; Prebid Server aynı anda DSP’lerden 120 ms içinde teklif toplar.',
        'Gölge fiyatlı garantili kampanyalar ve programatik teklifler tek first-price açık artırmada yarışır.'
      ],
      done: 'Reklam Kararı sekmesinde: adaylar ve gecikmeler.',
      run: async function (x) {
        await x.ensureFresh();
        await x.ensureConsent();
        x.mark('decisions', (st().decisions || []).length);
        await x.step('Otomobil haberi yeniden açılıyor: reklam isteği…', function () { return dev().go('article', { articleId: 'a-oto' }); });
      },
      check: function (x) {
        var d = st().decisions || [];
        var last = d[d.length - 1];
        return d.length > x.marked('decisions', 0) && !!last && !!last.personalized && !!last.winner;
      }
    },
    {
      id: 'olcum', title: 'Gösterim, tıklama, ölçüm', lines: ['measure', 'dmp'], tab: 'reports',
      focus: ['browser', 'tracking', 'kafka', 'flink', 'clickhouse', 'pacer', 'fcap', 'profile', 'segment'],
      text: [
        'Gösterim ve görünürlük beacon’ları Tracking → Kafka → Flink’ten geçer; tekrarlar ve geçersiz trafik ayıklanıp ClickHouse, Pacing ve fcap sayacına yazılır.',
        'Ziyaretçi reklama tıklayıp ürünü satın alıyor: bu satın alma dönüşüm olarak atfedilir.'
      ],
      done: 'Raporlar sekmesinde: tıklama ve dönüşüm.',
      run: async function (x) {
        await x.ensureFresh();
        await x.ensureConsent();
        await x.ensureAd();
        var r0 = st().reports && st().reports.totals ? st().reports.totals.clicks : 0;
        x.mark('clicks', r0);
        x.mark('orders', user().lastOrder ? user().lastOrder.orderId : null);
        await x.step('Ziyaretçi reklama tıklıyor…', function () { return dev().clickAd(); });
        await x.pause(700);
        var r = dev().route();
        var sku = r.page === 'product' && r.sku ? r.sku : 'OTO-EV-001';
        await x.step('Ürün sepete ekleniyor…', function () { return dev().addToCart(sku); });
        await x.pause(600);
        await x.step('Satın alma tamamlanıyor…', function () { return dev().purchase(); });
      },
      check: function (x) {
        var u = user();
        return !!u.clickedAd && !!u.lastOrder && u.lastOrder.orderId !== x.marked('orders', null);
      }
    },
    {
      id: 'cleanroom', title: 'Data Clean Room', lines: ['cleanroom'], tab: 'cleanroom',
      focus: ['partner', 'dcr', 'policy', 'iceberg', 'segment', 'profile'],
      text: [
        'Perakendeci X müşteri listesini hash’leyip şifreli yükler; eşleştirme attestation’lı bir TEE içinde yapılır.',
        'Politika k ≥ 50 eşiğini denetleyip ε = 0,5 gürültü ekler; dışarı yalnızca agrega rapor ve dışa aktarılamayan opak segment (9001) çıkar.'
      ],
      done: 'Eşleşme tamam; 9001 profile eklendi.',
      run: async function (x) {
        await x.ensureFresh();
        await x.ensureConsent();
        await x.ensureLogin();
        x.mark('runs', ((st().cleanroom || {}).runs || []).length);
        await x.step('Clean room eşleştirmesi çalışıyor…', function () { return eng().dispatch({ type: 'cleanroom_run' }); });
      },
      check: function (x) {
        var runs = ((st().cleanroom || {}).runs || []);
        return runs.length > x.marked('runs', 0) && hasSeg(9001);
      }
    },
    {
      id: 'kampanya', title: 'Kampanya güncelleme (kontrol düzlemi)', lines: ['control'], tab: 'campaigns',
      focus: ['admin', 'postgres', 'config', 'decision', 'tindex', 'clickhouse'],
      text: [
        'Admin UI’da Volta e-SUV’un CPM fiyatı değişiyor. Değişiklik PostgreSQL’e yazılır, CDC ile Config Stream’e düşer.',
        'Karar motoru yeni anlık görüntüyü kesintisiz devralır: sonraki istek yeni fiyatla karar verir.'
      ],
      done: 'Yeni config sürümü yayında.',
      run: async function (x) {
        var li = (st().lineItems || {})[101];
        var base = (D.lineItemById[101] && D.lineItemById[101].rate) || 85;
        var target = li && li.rate === base + 10 ? base : base + 10;
        x.mark('version', (st().config || {}).version || 0);
        x.mark('rate', target);
        await x.step('Volta e-SUV CPM fiyatı ' + U.fmtTL(li ? li.rate : base) + ' → ' + U.fmtTL(target) + ' yapılıyor…', function () {
          return eng().dispatch({ type: 'campaign_update', lineItemId: 101, patch: { rate: target } });
        });
      },
      check: function (x) {
        var li = (st().lineItems || {})[101];
        return ((st().config || {}).version || 0) > x.marked('version', 0) && !!li && li.rate === x.marked('rate');
      }
    },
    {
      id: 'dsar', title: 'Silme talebi (DSAR)', lines: ['privacy'], tab: 'profile',
      focus: ['browser', 'privacy', 'identity', 'kafka', 'flink', 'profile', 'iceberg', 'clickhouse', 'dcr', 'activation'],
      text: [
        'Ziyaretçi “Verilerimi sil” diyor (KVKK m.11). Silme; profil, idmap, olay arşivi, raporlar, clean room ve reklam ortaklarında birlikte uygulanır.',
        'Hash’li kimlikler suppression listesine girer: sonraki olaylar profillenmez.'
      ],
      done: 'Silme tamamlandı: 6/6 depo.',
      run: async function (x) {
        x.mark('dsar', (st().dsar || []).length);
        await x.step('Silme talebi gönderiliyor…', function () { return dev().requestDsar(); });
      },
      check: function (x) {
        var u = user(), list = st().dsar || [];
        var last = list[list.length - 1];
        return !!u.suppressed && (st().suppression || []).length > 0 && list.length > x.marked('dsar', 0) && !!last && last.status === 'done';
      }
    }
  ];

  /* ==================================================================
   * Durum
   * ================================================================== */
  var T = {
    mounted: false, active: false, index: 0, token: 0, chain: Promise.resolve(), runP: null,
    el: {}, min: false, selfReset: false, ro: null, marks: {}, startedAt: 0
  };

  /* ==================================================================
   * Bölüm çalıştırma bağlamı
   * ================================================================== */
  function makeCtx(token, idx) {
    var marks = T.marks[idx] = {};
    var notes = [];
    var x = {
      alive: function () { return T.active && T.token === token; },
      check: function () { if (!x.alive()) throw new Cancelled(); },
      step: async function (label, fn) {
        x.check();
        setRun('running', label);
        var r = await fn();
        x.check();
        return r;
      },
      pause: async function (ms) { x.check(); await U.wait(ms); x.check(); },
      mark: function (k, v) { marks[k] = v; },
      marked: function (k, d) { return Object.prototype.hasOwnProperty.call(marks, k) ? marks[k] : d; },
      note: function (text) { notes.push(text); setNote(notes.join(' ')); },
      ensureFresh: async function () {
        if (!user().suppressed) return;
        x.note('Önceki silme talebi bu ziyaretçiyi suppression listesine aldı; tur devam edebilsin diye simülasyon sıfırlandı.');
        await x.step('Simülasyon sıfırlanıyor…', function () { return resetEngine(); });
        await x.step('Rıza banner’ı gösteriliyor…', function () { return SIM.controls && SIM.controls.whenIdle ? SIM.controls.whenIdle(20000) : null; });
      },
      ensureConsent: async function () {
        var c = st().consent || {};
        if (c.status === 'all') return;
        x.note('Bu bölüm kişiselleştirme rızası gerektiriyor; önce “Tümünü kabul et” veriliyor.');
        await x.step('Önce rıza veriliyor…', function () { return dev().acceptConsent('all'); });
      },
      ensureLogin: async function () {
        if (user().loggedIn) return;
        x.note('Ziyaretçinin clean room eşleşmesine düşmesi için önce demo e-postasıyla giriş yapılıyor.');
        await x.step('Önce giriş yapılıyor…', function () { return dev().login(); });
      },
      ensureAd: async function () {
        if (user().lastAd) return;
        x.note('Henüz gösterilmiş bir reklam yok; önce otomobil haberi açılıp reklam isteği gönderiliyor.');
        await x.step('Önce reklam gösteriliyor…', function () { return dev().go('article', { articleId: 'a-oto' }); });
      }
    };
    return x;
  }

  function resetEngine() {
    var e = eng();
    if (!e || typeof e.reset !== 'function') return Promise.resolve();
    T.selfReset = true;
    var p;
    try { p = Promise.resolve(e.reset()); } catch (err) { p = Promise.resolve(); }
    T.selfReset = false;
    return p;
  }

  async function runChapter(idx, token) {
    var ch = CHAPTERS[idx];
    var x = makeCtx(token, idx);
    var result = { ok: false, cancelled: false, check: false, index: idx, id: ch.id };
    if (!x.alive()) { result.cancelled = true; return result; }
    if (!dev() || !eng()) {
      setRun('warn', 'Simülasyon modülleri yüklenemedi; bu bölüm otomatik oynatılamıyor.');
      return result;
    }
    try {
      await ch.run(x);
      x.check();
      // Motor kuyruğundaki ilgili akışlar (ör. ölçüm alt akışları) bitsin
      if (SIM.controls && SIM.controls.whenIdle) await SIM.controls.whenIdle(30000);
      x.check();
      var ok = false;
      try { ok = !!ch.check(x); } catch (e) { ok = false; }
      result.ok = true;
      result.check = ok;
      if (ok) setRun('done', ch.done);
      else setRun('warn', 'Beklenen durum tam oluşmadı; ↻ ile tekrar oynatın.');
    } catch (e) {
      if (e && e.cancelled) result.cancelled = true;
      else {
        try { console.error('[SIM.tour] bölüm hata verdi:', ch.id, e); } catch (z) { /* yut */ }
        if (x.alive()) setRun('warn', 'Bölüm oynatılırken bir hata oluştu; ↻ ile tekrar deneyin.');
      }
    }
    try { bus.emit('tour:chapter:done', { index: idx, id: ch.id, ok: result.ok, cancelled: result.cancelled, check: result.check }); } catch (e) { /* yut */ }
    return result;
  }

  /* ==================================================================
   * Kart
   * ================================================================== */
  var ICONS = {
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    min: '<path d="M6 12h12"/>',
    max: '<path d="M6 9.5l6 6 6-6"/>',
    prev: '<path d="M14.5 6l-6 6 6 6"/>',
    next: '<path d="M9.5 6l6 6-6 6"/>',
    replay: '<path d="M4.8 12a7.2 7.2 0 1 0 2.1-5.1"/><path d="M4.6 4.4v4.3h4.3"/>',
    tour: '<rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M10 8v5l4.2-2.5z" fill="currentColor"/><path d="M8.5 20h7M12 16.5V20"/>'
  };
  function icon(name) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.setAttribute('class', 'ct-ico');
    s.innerHTML = ICONS[name] || '';
    return s;
  }
  function lineBadge(line) {
    return el('span', { class: 'line-badge sm', 'data-line': line, 'aria-hidden': 'true' }, (D.lines[line] && D.lines[line].code) || '·');
  }

  function buildCard() {
    var E = T.el;
    E.stripe = el('div', { class: 'tr-stripe', 'aria-hidden': 'true' });
    E.num = el('span', { class: 'tr-num' });
    E.lines = el('span', { class: 'tr-lines' });
    E.eyebrowLabel = el('span', { class: 'eyebrow' }, 'Sunum turu');
    E.title = el('h2', { class: 'tr-title', id: 'tr-title' });
    E.minBtn = el('button', { type: 'button', class: 'tr-iconbtn tr-min', 'aria-label': 'Kartı küçült', title: 'Kartı küçült', 'aria-expanded': 'true', onclick: toggleMin }, icon('min'));
    E.closeBtn = el('button', { type: 'button', class: 'tr-iconbtn tr-close', 'aria-label': 'Turdan çık', title: 'Turdan çık (Esc)', onclick: function () { stop(); } }, icon('close'));
    var head = el('div', { class: 'tr-head' },
      el('div', { class: 'tr-head-text' }, el('p', { class: 'tr-eyebrow' }, E.lines, E.eyebrowLabel, E.num), E.title),
      el('div', { class: 'tr-head-btns' }, E.minBtn, E.closeBtn));

    E.text = el('div', { class: 'tr-textwrap', id: 'tr-text' });
    E.note = el('p', { class: 'tr-note', hidden: true });
    E.runText = el('span', { class: 'tr-run-text' });
    E.replay = el('button', { type: 'button', class: 'tr-iconbtn tr-replay', 'aria-label': 'Bölümü tekrar oynat', title: 'Bölümü tekrar oynat', onclick: replay }, icon('replay'));
    E.run = el('div', { class: 'tr-run', 'data-state': 'idle', role: 'status' },
      el('span', { class: 'tr-run-mark', 'aria-hidden': 'true' }), el('span', { class: 'tr-run-body' }, E.runText), E.replay);
    E.body = el('div', { class: 'tr-body' }, E.text, E.note, E.run);

    E.dots = el('div', { class: 'tr-dots', role: 'group', 'aria-label': 'Bölümler' });
    E.dotBtns = CHAPTERS.map(function (ch, i) {
      var b = el('button', {
        type: 'button', class: 'tr-dot', 'aria-label': 'Bölüm ' + (i + 1) + ': ' + ch.title, title: (i + 1) + '. ' + ch.title,
        onclick: function () { goTo(i); }
      });
      E.dots.appendChild(b);
      return b;
    });
    E.prev = el('button', { type: 'button', class: 'btn btn-sm btn-icon tr-prev', onclick: prev, 'aria-keyshortcuts': 'PageUp', 'aria-label': 'Önceki bölüm', title: 'Önceki bölüm (PageUp)' }, icon('prev'));
    E.nextText = el('span', { class: 'ct-btn-text' }, 'Sonraki');
    E.next = el('button', { type: 'button', class: 'btn btn-sm btn-primary tr-next', onclick: next, 'aria-keyshortcuts': 'PageDown' }, E.nextText, icon('next'));
    var foot = el('div', { class: 'tr-foot' }, E.dots, el('div', { class: 'tr-foot-btns' }, E.prev, E.next));

    E.live = el('p', { class: 'sr-only', 'aria-live': 'polite' });
    E.card = el('section', {
      class: 'tr-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'tr-title', 'aria-describedby': 'tr-text', tabindex: '-1'
    }, E.stripe, head, E.body, foot, E.live);
    E.card.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); stop(); }
    });
    return E.card;
  }

  function renderChapter() {
    var E = T.el, i = T.index, ch = CHAPTERS[i];
    U.clear(E.stripe);
    ch.lines.forEach(function (l) { E.stripe.appendChild(el('span', { 'data-line': l })); });
    E.num.textContent = (i + 1) + ' / ' + CHAPTERS.length;
    E.title.textContent = ch.title;
    U.clear(E.lines);
    ch.lines.forEach(function (l) {
      var b = lineBadge(l);
      b.title = D.lines[l] ? D.lines[l].name : l;
      E.lines.appendChild(b);
    });
    E.lines.appendChild(el('span', { class: 'sr-only' }, 'Hatlar: ' + ch.lines.map(function (l) { return D.lines[l] ? D.lines[l].name : l; }).join(', ') + '.'));
    U.clear(E.text);
    ch.text.forEach(function (t) { E.text.appendChild(el('p', { class: 'tr-text' }, t)); });
    setNote(null);
    E.dotBtns.forEach(function (b, k) {
      if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      b.classList.toggle('is-done', k < i);
    });
    E.prev.disabled = i === 0;
    var last = i === CHAPTERS.length - 1;
    E.nextText.textContent = last ? 'Turu bitir' : 'Sonraki';
    E.next.setAttribute('aria-label', last ? 'Turu bitir' : 'Sonraki bölüm: ' + CHAPTERS[i + 1].title);
    E.live.textContent = 'Bölüm ' + (i + 1) + ' / ' + CHAPTERS.length + ': ' + ch.title;
    if (E.body) E.body.scrollTop = 0;
    syncStartBtn();
  }

  function setRun(state, text) {
    var E = T.el;
    if (!E.run) return;
    E.run.setAttribute('data-state', state);
    E.runText.textContent = text || '';
    E.replay.hidden = state === 'running';
  }
  function setNote(text) {
    var E = T.el;
    if (!E.note) return;
    E.note.hidden = !text;
    E.note.textContent = text || '';
  }
  function toggleMin() {
    T.min = !T.min;
    var E = T.el;
    E.card.classList.toggle('is-min', T.min);
    E.minBtn.setAttribute('aria-expanded', T.min ? 'false' : 'true');
    E.minBtn.setAttribute('aria-label', T.min ? 'Kartı aç' : 'Kartı küçült');
    E.minBtn.title = T.min ? 'Kartı aç' : 'Kartı küçült';
    U.clear(E.minBtn);
    E.minBtn.appendChild(icon(T.min ? 'max' : 'min'));
    measure();
  }

  function measure() {
    var E = T.el;
    var h = T.active && E.card && E.card.isConnected ? Math.ceil(E.card.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--tour-card-h', h + 'px');
  }

  /* ==================================================================
   * Gezinme
   * ================================================================== */
  function applyChapterView(idx) {
    var ch = CHAPTERS[idx];
    try { if (SIM.diagram && SIM.diagram.focus) SIM.diagram.focus(ch.focus.slice()); } catch (e) { /* yut */ }
    try { if (SIM.inspector && SIM.inspector.show) SIM.inspector.show(ch.tab, { reveal: false }); } catch (e) { /* yut */ }
  }

  function goTo(idx, opts) {
    opts = opts || {};
    if (!T.mounted) mount();
    idx = Math.max(0, Math.min(CHAPTERS.length - 1, idx | 0));
    var wasActive = T.active;
    if (!T.active) open();
    T.index = idx;
    T.token += 1;
    var token = T.token;
    // Bölüm 1 her zaman temiz bir simülasyonla başlar: sıfırlama, beklemedeki akışları da iptal eder.
    // (Sıfırlama haritadaki odağı temizlediği için odak ondan sonra uygulanır.)
    var pre = CHAPTERS[idx].resetFirst ? resetEngine() : Promise.resolve();
    renderChapter();
    applyChapterView(idx);
    measure();
    setRun('running', T.runP && wasActive ? 'Önceki adımın akışı tamamlanıyor…' : 'Hazırlanıyor…');
    try { bus.emit('tour:chapter', { index: idx, id: CHAPTERS[idx].id }); } catch (e) { /* yut */ }
    try { if (history.replaceState && /^#tur/i.test(location.hash)) history.replaceState(null, '', '#tur-' + (idx + 1)); } catch (e) { /* yut */ }
    if (isPhone() && SIM.controls && SIM.controls.scrollToMap && idx > 0) setTimeout(function () { SIM.controls.scrollToMap(false); }, 120);

    var prevChain = T.chain;
    var p = Promise.all([prevChain, pre]).then(function () {
      if (T.token !== token || !T.active) return { ok: false, cancelled: true, index: idx, id: CHAPTERS[idx].id };
      return runChapter(idx, token);
    });
    T.chain = p.then(function () {}, function () {});
    T.runP = p;
    if (opts.focusCard && T.el.card) { try { T.el.card.focus({ preventScroll: true }); } catch (e) { /* yut */ } }
    return p;
  }

  function open() {
    var ov = document.getElementById('tour-overlay');
    if (!ov) return;
    U.clear(ov);
    T.el = {};
    ov.appendChild(buildCard());
    T.active = true;
    T.min = false;
    T.startedAt = Date.now();
    document.documentElement.classList.add('tour-on');
    if (typeof ResizeObserver === 'function') {
      T.ro = new ResizeObserver(function () { measure(); });
      T.ro.observe(T.el.card);
    }
    try { bus.emit('tour:start', { index: T.index }); } catch (e) { /* yut */ }
  }

  function start(idx) {
    if (!T.mounted) mount();
    var p = goTo(idx || 0, { focusCard: true });
    return p;
  }

  function stop(opts) {
    opts = opts || {};
    if (!T.active) return;
    T.active = false;
    T.token += 1;
    if (T.ro) { try { T.ro.disconnect(); } catch (e) { /* yut */ } T.ro = null; }
    var ov = document.getElementById('tour-overlay');
    if (ov) U.clear(ov);
    T.el = {};
    document.documentElement.classList.remove('tour-on');
    document.documentElement.style.setProperty('--tour-card-h', '0px');
    try { if (SIM.diagram && SIM.diagram.focus) SIM.diagram.focus(null); } catch (e) { /* yut */ }
    try { if (history.replaceState && /^#tur/i.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* yut */ }
    syncStartBtn();
    try { bus.emit('tour:end', { completed: !!opts.completed }); } catch (e) { /* yut */ }
    if (T.startBtn && opts.returnFocus !== false) { try { T.startBtn.focus({ preventScroll: true }); } catch (e) { /* yut */ } }
  }

  function next() {
    if (!T.active) return start(0);
    if (T.index >= CHAPTERS.length - 1) { stop({ completed: true }); return Promise.resolve({ ended: true }); }
    return goTo(T.index + 1);
  }
  function prev() {
    if (!T.active || T.index === 0) return Promise.resolve(null);
    return goTo(T.index - 1);
  }
  function replay() {
    if (!T.active) return Promise.resolve(null);
    return goTo(T.index);
  }

  /* ==================================================================
   * Başlat butonu (#tour-controls)
   * ================================================================== */
  function syncStartBtn() {
    var b = T.startBtn;
    if (!b) return;
    b.setAttribute('aria-pressed', T.active ? 'true' : 'false');
    T.startText.textContent = T.active ? 'Turu bitir' : 'Sunum turunu başlat';
    T.startKbd.textContent = T.active ? (T.index + 1) + '/' + CHAPTERS.length : '8 bölüm';
    b.title = T.active ? 'Sunum turundan çık' : 'Sunum turu: 8 bölümde uçtan uca senaryo (simülasyon sıfırlanır)';
  }

  function onKey(e) {
    if (!T.active || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target, tag = (t && t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
    if (e.key === 'PageDown') { e.preventDefault(); next(); }
    else if (e.key === 'PageUp') { e.preventDefault(); prev(); }
    else if (e.key === 'Escape') { stop(); }
  }

  /* ==================================================================
   * mount
   * ================================================================== */
  function mount() {
    U = SIM.util; bus = SIM.bus; D = SIM.data;
    if (T.mounted) return;
    T.mounted = true;
    var host = document.getElementById('tour-controls');
    if (host) {
      U.clear(host);
      T.startText = el('span', null, 'Sunum turunu başlat');
      T.startKbd = el('span', { class: 'tr-start-kbd' }, '8 bölüm');
      T.startBtn = el('button', {
        type: 'button', class: 'btn btn-sm tr-start', id: 'tr-start', 'aria-pressed': 'false',
        onclick: function () { if (T.active) stop(); else start(0); }
      }, icon('tour'), T.startText, T.startKbd);
      host.appendChild(T.startBtn);
      syncStartBtn();
    }
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', function () { if (T.active) measure(); });
    // Kullanıcı tur sırasında simülasyonu elle sıfırlarsa: senaryo durur, kart açık kalır, ↻ ile tekrar oynatılır.
    bus.on('reset', function () {
      if (!T.active) return;
      // Haritanın kendi 'reset' dinleyicisi odağı temizler; turdayken bölümün odağını geri koy.
      try { if (SIM.diagram && SIM.diagram.focus) SIM.diagram.focus(CHAPTERS[T.index].focus.slice()); } catch (e) { /* yut */ }
      if (T.selfReset) return;
      T.token += 1;
      var tok = T.token;
      T.chain = Promise.resolve();
      T.runP = null;
      setTimeout(function () {
        if (T.token === tok && T.active) setRun('idle', 'Simülasyon sıfırlandı. Bölümü baştan oynatmak için ↻, en baştan başlamak için 1. durağa dokunun.');
      }, 0);
    });
  }

  SIM.tour = {
    mount: mount,
    start: start,
    stop: function () { stop(); },
    next: next,
    prev: prev,
    goTo: function (i) { return goTo(i); },
    replay: replay,
    isActive: function () { return T.active; },
    current: function () { return T.index; },
    runPromise: function () { return T.runP || Promise.resolve(null); },
    chapters: CHAPTERS.map(function (c) { return { id: c.id, title: c.title, lines: c.lines.slice(), tab: c.tab, focus: c.focus.slice(), text: c.text.slice() }; })
  };
})(window.SIM);

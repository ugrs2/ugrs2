/* js/device.js — [device] SIM.device: kurgusal yayıncı sitesi "Gündem+" (gundem.example)
 * Sözleşme: SPEC.md §8. Klasik script; harici kütüphane yok.
 *
 * - Masaüstü/tablette telefon çerçevesi (çentik, durum çubuğu, adres çubuğu); telefonda (< 820px)
 *   çerçevesiz tam genişlik "tarayıcı kartı" (CSS ile).
 * - Ziyaretçi aksiyonları SIM.engine.dispatch ile motora gider; her API çağrısı motor kendi akışını
 *   bitirince çözülen bir Promise döndürür.
 * - Dinlenen olaylar: ad:loading, ad:rendered, device:navigate, state, reset, busy, flow:start.
 * - Yayınlanan olaylar: device:action {type, page?} (kullanıcı/API kaynaklı aksiyon başlarken),
 *   inspector:show {tab:'decision'} ("Neden bu reklam?").
 *
 * Ek API (SPEC'e ek): openConsent(), route(), unmount(); go(page, {silent:true}) dispatch etmeden gezinir.
 */
window.SIM = window.SIM || {};

(function (SIM) {
  'use strict';

  // core.js ve data.js bu dosyadan önce yüklenir; mount() yine de yeniden bağlar.
  var U = SIM.util || null, D = SIM.data || null, bus = SIM.bus || null;
  var NS = 'http://www.w3.org/2000/svg';

  var PAGES_OK = { home: 1, article: 1, product: 1, cart: 1, login: 1, privacy: 1 };
  var SLOT_OF_PAGE = { home: 'home', article: 'mpu' };
  var SLOT_SIZE = { mpu: [300, 250], home: [320, 100] };
  var STATIC_PATH = { home: '/', cart: '/sepet', login: '/giris', privacy: '/gizlilik' };
  var PAGE_NAME = { home: 'Ana sayfa', article: 'Haber', product: 'Ürün', cart: 'Sepet', login: 'Hesap', privacy: 'Gizlilik' };
  var CATS = ['otomobil', 'teknoloji', 'ekonomi', 'anne-bebek'];
  var CHOICES = { all: 1, necessary: 1, reject: 1 };
  var MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  var DSAR_LABELS = {
    profile: ['Profil', 'Aerospike'], idmap: ['Kimlik eşleştirme', 'idmap'], iceberg: ['Olay arşivi', 'Iceberg'],
    clickhouse: ['Reklam raporları', 'ClickHouse'], cleanroom: ['Clean room ortaklığı', 'Perakendeci X'], partners: ['Reklam ortakları', 'DSP · kitle listeleri']
  };
  var DSAR_ORDER = ['profile', 'idmap', 'iceberg', 'clickhouse', 'cleanroom', 'partners'];
  /** Programatik kazananlar için teklifçiye göre görsel ve vurgu rengi (kreatif paleti 'prog' temasından). */
  var BIDDER_ART = {
    alfa: { art: 'plane', accent: '#d9480f' },
    beta: { art: 'cup', accent: '#7a4a1f' },
    gama: { art: 'shield', accent: '#1d5fc9' },
    delta: { art: 'glasses', accent: '#0d7480' }
  };
  var PERKS = {
    otomobil: [['truck', 'Ön sipariş · teslimat 8–10 hafta'], ['check', 'Yetkili bayide test sürüşü'], ['shield', '8 yıl batarya garantisi']],
    teknoloji: [['truck', 'Ücretsiz kargo · ertesi gün teslim'], ['refund', '14 gün içinde koşulsuz iade'], ['shield', '2 yıl resmi garanti']],
    'anne-bebek': [['truck', 'Ücretsiz ve sigortalı kargo'], ['refund', '14 gün içinde koşulsuz iade'], ['check', 'Oto koltuğu adaptörü hediye']]
  };

  /* ==================================================================
   * İkonlar (24×24, çizgi)
   * ================================================================== */
  var ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
    reload: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    home: '<path d="M3.5 10.5 12 3.8l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-6h-5.6v6H5A1.5 1.5 0 0 1 3.5 19z"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>',
    bag: '<path d="M5.5 8.5h13l-1 11a1.8 1.8 0 0 1-1.8 1.6H8.3a1.8 1.8 0 0 1-1.8-1.6z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c.6-3.9 3.6-6 7.5-6s6.9 2.1 7.5 6"/>',
    shield: '<path d="M12 3.2 19.5 6v5.6c0 4.4-3.1 8-7.5 9.2-4.4-1.2-7.5-4.8-7.5-9.2V6z"/><path d="m8.8 12.2 2.3 2.3 4.3-4.6"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.6v.1"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    cross: '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>',
    arrow: '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>',
    chevron: '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="m6.5 7 .9 12.3a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5L17.5 7"/>',
    truck: '<path d="M3 6.5h11v9H3z"/><path d="M14 9.5h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    refund: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2.5 2.5M14 9l2 2"/>',
    cookie: '<path d="M20.5 12.5A8.5 8.5 0 1 1 11.5 3.5a3 3 0 0 0 4 3.5 3 3 0 0 0 5 5.5z"/><path d="M8.5 9.5v.1M8 14.5v.1M12.5 16.5v.1M12 11.5v.1"/>'
  };

  var STATUS_ICONS =
    '<rect x="0" y="9" width="3" height="4" rx=".8"/><rect x="4.5" y="6.5" width="3" height="6.5" rx=".8"/>' +
    '<rect x="9" y="4" width="3" height="9" rx=".8"/><rect x="13.5" y="1.5" width="3" height="11.5" rx=".8"/>' +
    '<path d="M30 12.8 27.6 10.2a3.4 3.4 0 0 1 4.8 0z"/><path d="M24.9 7.6a7.2 7.2 0 0 1 10.2 0l-1.5 1.6a5 5 0 0 0-7.2 0z"/>' +
    '<path d="M22.2 4.9a11 11 0 0 1 15.6 0l-1.5 1.6a8.8 8.8 0 0 0-12.6 0z"/>' +
    '<rect x="43" y="1.5" width="22" height="11" rx="3" fill="none" stroke="currentColor" stroke-opacity=".45"/>' +
    '<rect x="45" y="3.5" width="15" height="7" rx="1.6"/><path d="M66.5 5.2v3.6a1.8 1.8 0 0 0 0-3.6z" opacity=".45"/>';

  /* ==================================================================
   * Çizimler (kurgusal "fotoğraflar" ve reklam görselleri) — viewBox 0 0 160 90
   * ================================================================== */
  var ART = {
    suv: function (c) {
      return '<ellipse cx="82" cy="80" rx="64" ry="3.5" fill="' + c.shadow + '"/>' +
        '<path d="M20 66V52q0-6 5-7.5L28 43l8-12q2-2.5 6-2.5h62q5 0 8.5 3L125 43l11 2q8 1.5 8 9v12q0 3-3 3h-12a12 12 0 0 0-24 0H59a12 12 0 0 0-24 0H23q-3 0-3-3z" fill="' + c.body + '"/>' +
        '<path d="M38 43l5.5-8.5q1-1.5 3-1.5H62v10z" fill="' + c.glass + '"/>' +
        '<path d="M66 33h16v10H66z" fill="' + c.glass + '"/>' +
        '<path d="M86 33h17q3 0 5.5 2.5L116 43H86z" fill="' + c.glass + '"/>' +
        '<rect x="134" y="48.5" width="10" height="4" rx="2" fill="' + c.light + '"/>' +
        '<rect x="20" y="48" width="4" height="6" rx="1" fill="#e5484d"/>' +
        '<circle cx="47" cy="69" r="10" fill="' + c.wheel + '"/><circle cx="47" cy="69" r="4" fill="' + c.hub + '"/>' +
        '<circle cx="117" cy="69" r="10" fill="' + c.wheel + '"/><circle cx="117" cy="69" r="4" fill="' + c.hub + '"/>' +
        (c.bolt ? '<path d="M78 47l-6 9h5l-2 7 8-10h-5l2-6z" fill="' + c.bolt + '"/>' : '');
    },
    stroller: function (c) {
      return '<path d="M50 47a32 32 0 0 1 32-32v32z" fill="' + c.canopy + '"/>' +
        '<path d="M60 47a22 22 0 0 1 22-22" fill="none" stroke="' + c.rib + '" stroke-width="1.6"/>' +
        '<path d="M46 47h66q0 20-22 22H68q-22-2-22-22z" fill="' + c.body + '"/>' +
        '<path d="M108 47l15-28h10" fill="none" stroke="' + c.frame + '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M68 69l-11 10M90 69l11 10" stroke="' + c.frame + '" stroke-width="3.5" stroke-linecap="round"/>' +
        '<circle cx="56" cy="80" r="7" fill="' + c.wheelIn + '" stroke="' + c.frame + '" stroke-width="3"/>' +
        '<circle cx="102" cy="80" r="7" fill="' + c.wheelIn + '" stroke="' + c.frame + '" stroke-width="3"/>';
    },
    laptop: function (c) {
      return '<rect x="38" y="8" width="84" height="57" rx="5" fill="' + c.lid + '"/>' +
        '<rect x="42.5" y="12.5" width="75" height="48" rx="2" fill="' + c.screen + '"/>' +
        '<path d="M50 50l14-12 10 7 15-16 10 6 9-9" fill="none" stroke="' + c.line + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M50 55h58" stroke="' + c.line + '" stroke-opacity=".35" stroke-width="1.5"/>' +
        '<path d="M22 67h116l-6 9q-1 2-4 2H32q-3 0-4-2z" fill="' + c.base + '"/>' +
        '<rect x="70" y="67" width="20" height="2.6" rx="1.3" fill="' + c.notch + '"/>';
    },
    bag: function (c) {
      return '<rect x="94" y="40" width="34" height="40" rx="3" fill="' + c.box + '" transform="rotate(8 111 60)"/>' +
        '<path d="M66 34v-7a14 14 0 0 1 28 0v7" fill="none" stroke="' + c.handle + '" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M50 34h60l5 48q0 4-4 4H49q-4 0-4-4z" fill="' + c.bag + '"/>' +
        '<path d="M50 34h60l1 8H49z" fill="' + c.fold + '"/>' +
        '<path d="M80 74s-12-7-12-15a6.5 6.5 0 0 1 12-3.4A6.5 6.5 0 0 1 92 59c0 8-12 15-12 15z" fill="' + c.mark + '"/>';
    },
    card: function (c) {
      return '<rect x="46" y="12" width="90" height="57" rx="8" fill="' + c.back + '" transform="rotate(-9 91 40)"/>' +
        '<rect x="28" y="24" width="98" height="60" rx="8" fill="' + c.card + '"/>' +
        '<rect x="40" y="42" width="17" height="13" rx="3" fill="' + c.chip + '"/>' +
        '<path d="M65 43q3.5 5.5 0 11M70.5 40q6 8.5 0 17" fill="none" stroke="' + c.waves + '" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M104 41.5a5.5 5.5 0 0 1 10.6-1.6 4.4 4.4 0 0 1 .9 8.6h-11.8a3.6 3.6 0 0 1 .3-7z" fill="' + c.logo + '"/>' +
        '<rect x="40" y="66" width="18" height="4" rx="2" fill="' + c.num + '"/><rect x="62" y="66" width="18" height="4" rx="2" fill="' + c.num + '"/><rect x="84" y="66" width="18" height="4" rx="2" fill="' + c.num + '"/>';
    },
    app: function (c) {
      return '<rect x="56" y="5" width="48" height="82" rx="9" fill="' + c.phone + '" stroke="' + c.edge + '" stroke-width="1.5"/>' +
        '<rect x="59.5" y="9" width="41" height="74" rx="6" fill="' + c.screen + '"/>' +
        '<path d="M65.5 9h29a6 6 0 0 1 6 6v7h-41v-7a6 6 0 0 1 6-6z" fill="' + c.brand + '"/>' +
        '<path d="M76.5 15.5h7M80 12v7" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>' +
        '<rect x="64" y="27" width="32" height="17" rx="2" fill="' + c.img + '"/>' +
        '<rect x="64" y="48" width="30" height="3.2" rx="1.6" fill="' + c.line + '"/><rect x="64" y="54" width="24" height="3.2" rx="1.6" fill="' + c.line + '"/>' +
        '<rect x="64" y="62" width="32" height="3" rx="1.5" fill="' + c.line2 + '"/><rect x="64" y="68" width="28" height="3" rx="1.5" fill="' + c.line2 + '"/>' +
        '<rect x="96" y="22" width="52" height="20" rx="6" fill="' + c.bubble + '"/>' +
        '<circle cx="104" cy="32" r="3.4" fill="' + c.bubbleInk + '"/><rect x="111" y="27.5" width="30" height="3.2" rx="1.6" fill="' + c.bubbleInk + '"/>' +
        '<rect x="111" y="33.5" width="21" height="3" rx="1.5" fill="' + c.bubbleInk + '" opacity=".6"/>';
    },
    plane: function (c) {
      return '<circle cx="118" cy="30" r="16" fill="' + c.sun + '"/>' +
        '<path d="M22 32a7 7 0 0 1 13-3 5 5 0 0 1 4 9H22a3 3 0 0 1 0-6z" fill="' + c.cloud + '"/>' +
        '<path d="M0 74q10-5 20 0t20 0 20 0 20 0 20 0 20 0 20 0 20 0V90H0z" fill="' + c.sea + '"/>' +
        '<path d="M0 83q10-4 20 0t20 0 20 0 20 0 20 0 20 0 20 0 20 0" fill="none" stroke="' + c.wave + '" stroke-width="1.6"/>' +
        '<path d="M70 47l12-14h6l-6 13z" fill="' + c.plane + '" opacity=".6"/>' +
        '<path d="M30 51l-9-17h7l14 15z" fill="' + c.plane + '"/>' +
        '<path d="M22 56q-4-3 3-5l84-9q13-1.5 19 3-5 4.5-18 6.5l-84 8q-3 .3-4-3.5z" fill="' + c.plane + '"/>' +
        '<path d="M62 52l20 20h8l-10-21z" fill="' + c.plane + '"/>' +
        '<path d="M44 52.5l56-6" stroke="' + c.stripe + '" stroke-width="2" stroke-linecap="round"/>';
    },
    cup: function (c) {
      return '<ellipse cx="80" cy="77" rx="38" ry="7" fill="' + c.saucer + '"/>' +
        '<path d="M101 46h5a8 8 0 0 1 0 16h-7" fill="none" stroke="' + c.cup + '" stroke-width="4"/>' +
        '<path d="M54 40h48l-4 30q-1 5-6 5H64q-5 0-6-5z" fill="' + c.cup + '"/>' +
        '<ellipse cx="78" cy="40" rx="24" ry="4" fill="' + c.coffee + '"/>' +
        '<path d="M68 32q-5-6 0-12t0-12M78 32q-5-6 0-12t0-12M88 32q-5-6 0-12t0-12" fill="none" stroke="' + c.steam + '" stroke-width="2.4" stroke-linecap="round"/>';
    },
    shield: function (c) {
      return '<path d="M80 8l30 11v22c0 20-13 34-30 40-17-6-30-20-30-40V19z" fill="' + c.shield + '"/>' +
        '<path d="M80 16l22 8v17c0 15-9.5 26-22 31z" fill="' + c.shade + '"/>' +
        '<path d="M67 44l9 9 17-18" fill="none" stroke="' + c.check + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>';
    },
    glasses: function (c) {
      return '<path d="M44 20l5 9M58 15l1.5 9.5M72 20l-4 8.5" stroke="' + c.ray + '" stroke-width="2.4" stroke-linecap="round"/>' +
        '<rect x="30" y="36" width="42" height="30" rx="12" fill="' + c.lens + '" stroke="' + c.frame + '" stroke-width="4"/>' +
        '<rect x="88" y="36" width="42" height="30" rx="12" fill="' + c.lens + '" stroke="' + c.frame + '" stroke-width="4"/>' +
        '<path d="M72 46q8-6 16 0" fill="none" stroke="' + c.frame + '" stroke-width="4"/>' +
        '<path d="M30 42l-13-6M130 42l13-6" stroke="' + c.frame + '" stroke-width="4" stroke-linecap="round"/>';
    }
  };

  var SCENES = {
    otomobil: function () {
      return '<rect width="160" height="90" fill="#bcd6ec"/><rect width="160" height="26" fill="#a6c6e3"/>' +
        '<path d="M0 54l26-18 18 10 24-20 26 22 18-12 22 14 26-16v24H0z" fill="#8eaecb"/>' +
        '<path d="M68 26l-8 7 8-2.5 6 3.5zM26 36l-6 4 6-1.2 5 2.4z" fill="#f4f8fb"/>' +
        '<path d="M0 60q40-8 80-4t80 0V90H0z" fill="#eef4f9"/>' +
        '<rect y="71" width="160" height="12" fill="#5b6672"/>' +
        '<path d="M0 77h160" stroke="#eef4f9" stroke-width="1.2" stroke-dasharray="8 7"/>' +
        '<path d="M116 61l44-7v15z" fill="#fff6c9" opacity=".45"/>' +
        '<g transform="translate(30 31) scale(.62)">' + ART.suv({ body: '#1f4e66', glass: '#a6c6e3', light: '#ffe8a3', wheel: '#1b232b', hub: '#9aa6b2', shadow: 'rgba(0,0,0,.18)' }) + '</g>' +
        '<g fill="#ffffff"><circle cx="12" cy="12" r="1.2"/><circle cx="40" cy="20" r="1"/><circle cx="58" cy="8" r="1.4"/><circle cx="96" cy="16" r="1.1"/><circle cx="124" cy="9" r="1.3"/><circle cx="146" cy="24" r="1"/><circle cx="84" cy="36" r="1"/><circle cx="20" cy="46" r="1.2"/><circle cx="138" cy="44" r="1.1"/></g>';
    },
    teknoloji: function () {
      return '<rect width="160" height="90" fill="#121a26"/><circle cx="118" cy="24" r="42" fill="#18273b"/>' +
        '<path d="M0 30h34M0 37h20M138 60h22M146 66h14" stroke="#7ee0ff" stroke-opacity=".25" stroke-width="1.2"/>' +
        '<rect y="72" width="160" height="18" fill="#1d2838"/>' +
        '<g transform="translate(24 18) scale(.7)">' + ART.laptop({ lid: '#c9d0db', screen: '#0b1220', line: '#7ee0ff', base: '#aab3c0', notch: '#7d8794' }) + '</g>' +
        '<rect x="128" y="58" width="14" height="15" rx="2" fill="#2d3b50"/><path d="M142 61h3a3 3 0 0 1 0 6h-3" fill="none" stroke="#2d3b50" stroke-width="2"/>';
    },
    ekonomi: function () {
      var candles = [[14, 52, 64, 1], [28, 56, 66, 0], [42, 48, 60, 1], [56, 44, 56, 1], [70, 46, 54, 0], [84, 38, 50, 1], [98, 40, 48, 0], [112, 30, 44, 1], [126, 26, 38, 1], [140, 20, 32, 1]];
      var s = '<rect width="160" height="90" fill="#0e2240"/><path d="M0 22h160M0 44h160M0 66h160" stroke="#ffffff" stroke-opacity=".07"/>';
      candles.forEach(function (k) {
        var col = k[3] ? '#35c47a' : '#e5534b';
        s += '<path d="M' + (k[0] + 3) + ' ' + (k[1] - 5) + 'v' + (k[2] - k[1] + 10) + '" stroke="' + col + '" stroke-width="1"/>' +
          '<rect x="' + k[0] + '" y="' + k[1] + '" width="6" height="' + (k[2] - k[1]) + '" rx="1" fill="' + col + '"/>';
      });
      s += '<path d="M8 70L28 63 44 66 62 52 80 55 98 41 116 44 134 27 152 20" fill="none" stroke="#f2c14e" stroke-width="2.4" stroke-linejoin="round"/>' +
        '<path d="M0 90V78h10v-8h8v10h6V66h10v14h8v-6h10v6h12V68h8v12h10v-9h12v9h10V68h10v22z" fill="#0a1830"/>';
      return s;
    },
    'anne-bebek': function () {
      return '<rect width="160" height="90" fill="#fde9d8"/><circle cx="128" cy="24" r="14" fill="#f8c27a"/>' +
        '<path d="M0 64q40-14 80-6t80-4V90H0z" fill="#cfe6c0"/><path d="M0 76q50-10 100-2t60 0V90H0z" fill="#b6d8a4"/>' +
        '<rect x="24" y="44" width="4" height="22" fill="#8a6650"/><circle cx="26" cy="40" r="11" fill="#9fcf8f"/>' +
        '<g transform="translate(40 15) scale(.68)">' + ART.stroller({ canopy: '#e46a2e', rib: '#f6a77a', body: '#fff7f0', frame: '#3b2414', wheelIn: '#fde9d8' }) + '</g>';
    }
  };

  var PRODUCT_ART = {
    otomobil: { kind: 'suv', bg: '#e9f0f6', c: { body: '#24566f', glass: '#c9dceb', light: '#ffd36b', wheel: '#1b232b', hub: '#b5bfc9', shadow: 'rgba(0,0,0,.14)', bolt: '#3fd0c9' } },
    teknoloji: { kind: 'laptop', bg: '#eef0f4', c: { lid: '#2a2f3a', screen: '#0d1320', line: '#7ee0ff', base: '#c3c9d3', notch: '#8a93a0' } },
    'anne-bebek': { kind: 'stroller', bg: '#fff1e6', c: { canopy: '#e46a2e', rib: '#f6a77a', body: '#3b2414', frame: '#3b2414', wheelIn: '#fff3e8' } }
  };

  /* ==================================================================
   * Modül durumu
   * ================================================================== */
  function freshSlots() { return { mpu: { status: 'idle', ad: null }, home: { status: 'idle', ad: null } }; }
  var S = {
    mounted: false, root: null, el: {}, unsub: [], timers: [],
    route: { page: 'home' }, history: [],
    slots: freshSlots(),
    banner: { open: false, mode: 'initial' }, sheet: null,
    optimistic: [], collectors: [],
    loginUi: { phase: 'idle', email: null, localHash: null, revealed: false, error: null, draft: null },
    cartUi: { phase: 'idle', msg: null },
    dsarUi: { phase: 'idle', confirm: false },
    productUi: { added: null, t: 0 },
    busy: false, userScrolled: false, sig: '', refreshT: 0, toastT: 0, lastTime: '', visitSent: false, ro: null, urlTok: 0,
    scrollGoal: null, followSel: null
  };

  /* ==================================================================
   * Yardımcılar
   * ================================================================== */
  function h() { return U.el.apply(null, arguments); }
  function reduced() { return !!(SIM.settings && SIM.settings.reducedMotion); }
  function svgOf(viewBox, inner, cls, label, par) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', viewBox);
    if (cls) s.setAttribute('class', cls);
    if (par) s.setAttribute('preserveAspectRatio', par);
    if (label) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', label); }
    else { s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); }
    s.innerHTML = inner;
    return s;
  }
  function icon(name, cls) { return svgOf('0 0 24 24', ICONS[name] || '', 'dv-ico' + (cls ? ' ' + cls : '')); }
  function pad2(x) { return (x < 10 ? '0' : '') + x; }
  function ist(ts) {
    var d = new Date(ts + 3 * 3600 * 1000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }
  function dayKey(p) { return p.y * 400 + p.mo * 32 + p.d; }
  function longDate(ts) { var p = ist(ts); return p.d + ' ' + MONTHS[p.mo] + ' ' + p.y + ' ' + DAYS[p.wd]; }
  function hhmm(ts) { var p = ist(ts); return pad2(p.h) + ':' + pad2(p.mi); }
  function pubLabel(iso, short) {
    var ts = Date.parse(iso);
    if (!isFinite(ts)) return '';
    var now = U.nowSim();
    var a = ist(ts), b = ist(now);
    var mins = Math.round((now - ts) / 60000);
    if (short && mins >= 0 && mins < 60) return Math.max(1, mins) + ' dk önce';
    if (short && mins >= 60 && dayKey(a) === dayKey(b)) return Math.floor(mins / 60) + ' sa önce';
    if (dayKey(a) === dayKey(b)) return 'Bugün ' + hhmm(ts);
    if (dayKey(a) === dayKey(ist(now - 86400000))) return 'Dün ' + hhmm(ts);
    return a.d + ' ' + MONTHS[a.mo] + ', ' + hhmm(ts);
  }
  function tl(n) { return U.fmtTL(n, 0); }
  function catLabel(c) { return (D.categoryLabels && D.categoryLabels[c]) || (D.contextLabels && D.contextLabels[c]) || c; }
  function articleOfCat(c) {
    for (var i = 0; i < D.articles.length; i++) if (D.articles[i].category === c) return D.articles[i];
    return null;
  }
  function articleForSku(sku) {
    for (var i = 0; i < D.articles.length; i++) if (D.articles[i].relatedSku === sku) return D.articles[i];
    return null;
  }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toLocaleUpperCase('tr-TR');
  }
  function hexLum(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return 0.5;
    var n = parseInt(m[1], 16);
    var ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function contrast(a, b) { var x = hexLum(a), y = hexLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function bestInk(bg, candidates) {
    var best = candidates[0], score = 0;
    candidates.forEach(function (c) { var s = contrast(bg, c); if (s > score) { score = s; best = c; } });
    return best;
  }

  /* ---- motor erişimi ---- */
  function engine() { return SIM.engine && typeof SIM.engine.dispatch === 'function' ? SIM.engine : null; }
  function dispatch(action) {
    var e = engine();
    if (!e) return Promise.resolve({ ok: false, reason: 'motor yok' });
    try {
      return Promise.resolve(e.dispatch(action)).catch(function (err) {
        try { console.error('[SIM.device] dispatch hata verdi:', action && action.type, err); } catch (x) { /* yut */ }
        return { ok: false, error: String(err && err.message || err) };
      });
    } catch (err) {
      try { console.error('[SIM.device] dispatch hata verdi:', action && action.type, err); } catch (x) { /* yut */ }
      return Promise.resolve({ ok: false, error: String(err && err.message || err) });
    }
  }
  function userState() { var s = SIM.state; return (s && s.user) || {}; }
  function consentState() {
    var s = SIM.state;
    return (s && s.consent) || { status: 'unknown', tcString: null, purposes: {}, kvkkExplicit: false, at: null };
  }
  function engineCart() { var u = userState(); return Array.isArray(u.cart) ? u.cart : []; }
  function cartSkus() { return engineCart().concat(S.optimistic.map(function (o) { return o.sku; })); }
  function lastDsar() { var s = SIM.state; var arr = s && s.dsar; return arr && arr.length ? arr[arr.length - 1] : null; }
  function emitDeviceAction(type, page) {
    var p = { type: type };
    if (page) p.page = page;
    try { bus.emit('device:action', p); } catch (e) { /* yut */ }
  }

  /* ---- rota ---- */
  function normRoute(page, opts) {
    opts = opts || {};
    var r = { page: PAGES_OK[page] ? page : 'home' };
    if (r.page === 'article') {
      var a = D.articleById[opts.articleId];
      if (!a) { if (opts.articleId) console.warn('[SIM.device] bilinmeyen makale:', opts.articleId); a = D.articles[0]; }
      r.articleId = a.id;
    } else if (r.page === 'product') {
      var p = D.productBySku[opts.sku];
      if (!p) { if (opts.sku) console.warn('[SIM.device] bilinmeyen ürün:', opts.sku); p = D.products[0]; }
      r.sku = p.sku;
    }
    return r;
  }
  function sameRoute(a, b) { return a && b && a.page === b.page && a.articleId === b.articleId && a.sku === b.sku; }
  function routeInfo(r) {
    if (r.page === 'article') { var a = D.articleById[r.articleId]; return { page: 'article', articleId: a.id, path: a.path, category: a.category, slot: 'mpu' }; }
    if (r.page === 'product') { var p = D.productBySku[r.sku]; return { page: 'product', sku: p.sku, path: p.path, category: p.category, slot: null }; }
    if (r.page === 'home') return { page: 'home', path: '/', category: 'anasayfa', slot: 'home' };
    return { page: r.page, path: STATIC_PATH[r.page] || '/', category: null, slot: null };
  }
  /** Sayfa açılınca gönderilecek aksiyonlar (SPEC §6.2, §8). */
  function actionsFor(info) {
    var list = [];
    if (info.page === 'product') list.push({ type: 'product_view', sku: info.sku });
    else {
      var a = { type: 'page_view', page: info.page };
      if (info.page === 'article') a.articleId = info.articleId;
      list.push(a);
    }
    if (info.slot) list.push({ type: 'ad_request', slot: info.slot, category: info.category, path: info.path });
    return list;
  }
  function dispatchAll(list) { return Promise.all(list.map(dispatch)); }

  /* ==================================================================
   * İskelet (çerçeve, durum çubuğu, adres çubuğu, site, alt menü, katman)
   * ================================================================== */
  var TABS = [
    { id: 'home', label: 'Ana sayfa', icon: 'home' },
    { id: 'cats', label: 'Kategoriler', icon: 'grid' },
    { id: 'cart', label: 'Sepet', icon: 'bag' },
    { id: 'login', label: 'Hesap', icon: 'user' },
    { id: 'privacy', label: 'Gizlilik', icon: 'shield' }
  ];

  function build(root) {
    var E = S.el;
    root.classList.add('dv-host');
    E.time = h('span', { class: 'dv-status-time' }, '10:00');
    var status = h('div', { class: 'dv-status', 'aria-hidden': 'true' },
      E.time, h('span', { class: 'dv-island' }), svgOf('0 0 68 14', STATUS_ICONS, 'dv-status-icons'));

    E.back = h('button', { type: 'button', class: 'dv-chrome-btn dv-back', 'aria-label': 'Geri', title: 'Geri', onclick: onBack }, icon('back'));
    E.urlHost = h('span', { class: 'dv-url-host' }, D.site.domain);
    E.urlPath = h('span', { class: 'dv-url-path' }, '/');
    E.urlText = h('span', { class: 'dv-url-text', onscroll: urlMask }, E.urlHost, E.urlPath);
    E.url = h('div', { class: 'dv-url', title: 'https://' + D.site.domain + '/' },
      h('span', { class: 'dv-url-lock', title: 'Güvenli bağlantı (HTTPS)' }, icon('lock')), E.urlText);
    E.reload = h('button', { type: 'button', class: 'dv-chrome-btn dv-reload', 'aria-label': 'Sayfayı yenile', title: 'Yenile', onclick: onReload }, icon('reload'));
    E.chrome = h('div', { class: 'dv-chrome' }, E.back, E.url, E.reload, h('span', { class: 'dv-progress', 'aria-hidden': 'true' }));

    E.page = h('main', { class: 'dv-page' });
    E.site = h('div', { class: 'dv-site', lang: 'tr' }, masthead(), E.page, footer());
    E.viewport = h('div', { class: 'dv-viewport', role: 'region', 'aria-label': D.site.name + ' sitesi (' + D.site.domain + ')', tabindex: '0' }, E.site);
    E.tabbar = buildTabbar();
    E.layer = h('div', { class: 'dv-layer' });
    E.stage = h('div', { class: 'dv-stage' }, E.viewport, E.tabbar, E.layer);
    E.live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    E.screen = h('div', { class: 'dv-screen' }, status, E.chrome, E.stage, h('div', { class: 'dv-homebar', 'aria-hidden': 'true' }), E.live);
    E.device = h('div', { class: 'dv-device' }, E.screen);
    root.appendChild(E.device);

    var mark = function () { S.userScrolled = true; };
    E.viewport.addEventListener('wheel', mark, { passive: true });
    E.viewport.addEventListener('touchstart', mark, { passive: true });
    E.viewport.addEventListener('keydown', function (e) {
      if (/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/.test(e.key)) mark();
    });
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (S.sheet) { closeSheet(); e.stopPropagation(); }
      else if (S.banner.open && S.banner.mode === 'reopen') { closeBanner(); e.stopPropagation(); }
    });
    if (typeof ResizeObserver === 'function') {
      S.ro = new ResizeObserver(function () { layoutAds(); urlMask(); });
      S.ro.observe(E.viewport);
    } else {
      var onR = function () { layoutAds(); };
      window.addEventListener('resize', onR);
      S.unsub.push(function () { window.removeEventListener('resize', onR); });
    }
  }

  function masthead() {
    var logo = h('button', { type: 'button', class: 'dv-logo', 'aria-label': D.site.name + ' ana sayfa', onclick: function () { uiGo('home'); } },
      h('span', { class: 'dv-logo-word' }, 'Gündem'), h('span', { class: 'dv-logo-plus', 'aria-hidden': 'true' }, '+'));
    S.el.acct = h('button', { type: 'button', class: 'dv-mast-acct', onclick: function () { uiGo('login'); } });
    return h('header', { class: 'dv-mast' }, logo, h('span', { class: 'dv-mast-sp' }), S.el.acct);
  }

  function footer() {
    var link = function (label, fn) { return h('button', { type: 'button', class: 'dv-foot-link', onclick: fn }, label); };
    return h('footer', { class: 'dv-foot' },
      h('div', { class: 'dv-foot-brand' },
        h('span', { class: 'dv-logo dv-logo-sm', 'aria-hidden': 'true' }, h('span', { class: 'dv-logo-word' }, 'Gündem'), h('span', { class: 'dv-logo-plus' }, '+')),
        h('span', { class: 'dv-foot-tag' }, D.site.tagline || '')),
      h('div', { class: 'dv-foot-links' },
        link('Gizlilik ve çerezler', function () { uiGo('privacy'); }),
        link('Çerez tercihleri', function () { openBanner('reopen', true); }),
        link('Hesabım', function () { uiGo('login'); })),
      h('p', { class: 'dv-foot-legal' }, '© 2026 Gündem+ · ' + D.site.domain + ' — bu site simülasyon için kurgulanmıştır; haberler, markalar ve ürünler kurgusaldır.'));
  }

  function buildTabbar() {
    var nav = h('nav', { class: 'dv-tabbar', 'aria-label': D.site.name + ' menü' });
    S.el.tabs = {};
    TABS.forEach(function (t) {
      var btn = h('button', {
        type: 'button', class: 'dv-tab', 'data-tab': t.id,
        onclick: function () { if (t.id === 'cats') openCats(); else uiGo(t.id); }
      }, h('span', { class: 'dv-tab-ico' }, icon(t.icon)), h('span', { class: 'dv-tab-label' }, t.label));
      if (t.id === 'cart') {
        S.el.badge = h('span', { class: 'dv-badge', 'aria-hidden': 'true' });
        btn.querySelector('.dv-tab-ico').appendChild(S.el.badge);
        S.el.cartTab = btn;
      }
      S.el.tabs[t.id] = btn;
      nav.appendChild(btn);
    });
    return nav;
  }

  /* ---- adres çubuğu, sekmeler, rozet, hesap ---- */
  function refreshChrome() {
    if (!S.mounted) return;
    var E = S.el, r = S.route, info = routeInfo(r);
    var path = info.path || '/';
    if (E.urlPath.textContent !== path) {
      E.urlPath.textContent = path;
      E.url.title = 'https://' + D.site.domain + path;
      E.urlText.scrollLeft = 0;
      if (!reduced()) { E.urlText.classList.remove('is-new'); void E.urlText.offsetWidth; E.urlText.classList.add('is-new'); }
      urlMask();
      urlReveal();
    }
    E.back.disabled = !S.history.length;
    var activeTab = r.page === 'home' ? 'home' : (r.page === 'cart' ? 'cart' : (r.page === 'login' ? 'login' : (r.page === 'privacy' ? 'privacy' : (r.page === 'article' ? 'cats' : null))));
    if (S.sheet && S.sheet.kind === 'cats') activeTab = 'cats';
    Object.keys(E.tabs).forEach(function (id) {
      if (id === activeTab) E.tabs[id].setAttribute('aria-current', 'page');
      else E.tabs[id].removeAttribute('aria-current');
    });
    var n = cartSkus().length;
    var prev = E.badge.getAttribute('data-n');
    E.badge.textContent = n > 99 ? '99+' : String(n);
    E.badge.setAttribute('data-n', String(n));
    E.badge.hidden = n === 0;
    E.tabs.cart.setAttribute('aria-label', 'Sepet' + (n ? ', ' + n + ' ürün' : ', boş'));
    if (prev !== null && prev !== String(n) && n > 0) bumpBadge();

    var u = userState();
    U.clear(E.acct);
    if (u.loggedIn) {
      E.acct.classList.add('is-in');
      E.acct.appendChild(h('span', { class: 'dv-avatar', 'aria-hidden': 'true' }, initials(u.displayName || u.email)));
      E.acct.setAttribute('aria-label', 'Hesabım: ' + (u.displayName || u.email || ''));
    } else {
      E.acct.classList.remove('is-in');
      E.acct.appendChild(icon('user'));
      E.acct.appendChild(h('span', { class: 'dv-mast-acct-label' }, 'Giriş'));
      E.acct.setAttribute('aria-label', 'Giriş yap');
    }
  }

  /** Adres metni taşıyorsa hangi kenarın soluklaşacağını belirler (metin kırpılmaz, kaydırılabilir). */
  function urlMask() {
    var t = S.el.urlText;
    if (!t) return;
    var max = t.scrollWidth - t.clientWidth;
    t.classList.toggle('fade-r', max > 2 && t.scrollLeft < max - 2);
    t.classList.toggle('fade-l', max > 2 && t.scrollLeft > 2);
  }
  /** Uzun yol: gezinmeden kısa süre sonra adres çubuğunu sona kaydırıp tam yolu gösterir, sonra başa döner. */
  function urlReveal() {
    var t = S.el.urlText;
    var tok = ++S.urlTok;
    if (!t || reduced()) return;
    var later = function (fn, ms) { setTimeout(function () { if (tok === S.urlTok && S.mounted) fn(); }, ms); };
    var slide = function (to, dur, done) {
      var from = t.scrollLeft, start = 0;
      var step = function (now) {
        if (tok !== S.urlTok || !S.mounted) return;
        if (!start) start = now;
        var k = Math.min(1, (now - start) / dur);
        var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        t.scrollLeft = from + (to - from) * e;
        if (k < 1) requestAnimationFrame(step); else if (done) done();
      };
      requestAnimationFrame(step);
    };
    later(function () {
      var max = t.scrollWidth - t.clientWidth;
      if (max <= 4) return;
      slide(max, Math.min(1400, 500 + max * 6), function () { later(function () { slide(0, 600); }, 1800); });
    }, 650);
  }

  function bumpBadge() {
    var b = S.el.badge;
    if (!b || reduced()) return;
    b.classList.remove('is-bump'); void b.offsetWidth; b.classList.add('is-bump');
  }

  function announce(text) { if (S.el.live) S.el.live.textContent = text; }

  /* ==================================================================
   * Sayfa çizimi
   * ================================================================== */
  function pageSig() {
    var u = userState(), c = consentState(), r = S.route;
    switch (r.page) {
      case 'cart':
        return 'c|' + cartSkus().join(',') + '|' + (u.lastOrder ? u.lastOrder.orderId : '') + '|' + S.cartUi.phase + '|' + (S.cartUi.msg || '');
      case 'product':
        return 'p|' + cartSkus().filter(function (s) { return s === r.sku; }).length + '|' + (S.productUi.added === r.sku ? S.productUi.t : 0);
      case 'login':
        return 'l|' + !!u.loggedIn + '|' + (u.hem || '') + '|' + (u.email || '') + '|' + S.loginUi.phase + '|' + (S.loginUi.localHash || '') + '|' + (S.loginUi.error || '');
      case 'privacy':
        var d = lastDsar();
        return 'g|' + c.status + '|' + c.at + '|' + (c.tcString || '') + '|' + (u.fpc || '') + '|' + (u.hem || '') + '|' + (u.personId || '') + '|' +
          !!u.suppressed + '|' + (d ? d.id + JSON.stringify(d.stores) + d.status : '') + '|' + S.dsarUi.phase + '|' + S.dsarUi.confirm;
      default:
        return r.page + '|' + (r.articleId || '');
    }
  }

  var BUILDERS = {};

  function renderPage(opts) {
    if (!S.mounted) return;
    opts = opts || {};
    var E = S.el, r = S.route;
    var keep = E.viewport.scrollTop;
    U.clear(E.page);
    E.page.setAttribute('data-page', r.page);
    E.page.appendChild((BUILDERS[r.page] || BUILDERS.home)(r));
    S.sig = pageSig();
    if (opts.keepScroll) {
      E.viewport.scrollTop = keep;
      // yeniden çizim süren bir yumuşak kaydırmayı kesmesin: hedef hâlâ geçerliyse yeniden başlat
      var goal = S.scrollGoal;
      if (goal && Date.now() < goal.until) E.viewport.scrollTo({ top: goal.top, behavior: reduced() ? 'auto' : 'smooth' });
    } else {
      E.viewport.scrollTop = 0;
      S.scrollGoal = null;
    }
    if (opts.transition && !reduced()) {
      E.page.classList.remove('is-enter'); void E.page.offsetWidth; E.page.classList.add('is-enter');
    }
    layoutAds();
    if (S.followSel && !S.userScrolled) {
      var f = E.page.querySelector(S.followSel);
      if (f) revealEl(f, 'nearest');
    }
  }

  function scheduleRefresh() {
    if (S.refreshT) return;
    S.refreshT = setTimeout(function () {
      S.refreshT = 0;
      if (!S.mounted) return;
      refreshChrome();
      if (pageSig() !== S.sig) renderPage({ keepScroll: true });
    }, 30);
  }

  /* ---- ortak parçalar ---- */
  function kicker(cat, tag) {
    return h(tag || 'span', { class: 'dv-kicker', 'data-cat': cat }, catLabel(cat));
  }
  function photo(cat, cls, caption) {
    var fn = SCENES[cat] || SCENES.otomobil;
    var fig = h('figure', { class: 'dv-photo ' + (cls || '') },
      svgOf('0 0 160 90', fn(), 'dv-photo-svg', null, 'xMidYMid slice'));
    if (caption) fig.appendChild(h('figcaption', { class: 'dv-photo-cap' }, caption));
    return fig;
  }
  function productArt(p, cls) {
    var a = PRODUCT_ART[p.category] || PRODUCT_ART.teknoloji;
    return h('span', { class: 'dv-pthumb ' + (cls || ''), style: { '--pbg': a.bg } },
      svgOf('0 0 160 90', ART[a.kind](a.c), 'dv-pthumb-svg', null, 'xMidYMid meet'));
  }
  function meta(a, short) {
    return h('span', { class: 'dv-meta' },
      h('span', a.author), h('span', { class: 'dv-dot', 'aria-hidden': 'true' }, '·'),
      h('span', { class: 'nowrap' }, pubLabel(a.publishedAt, short)), h('span', { class: 'dv-dot', 'aria-hidden': 'true' }, '·'),
      h('span', { class: 'nowrap' }, a.readMin + ' dk okuma'));
  }
  function section(title, content, extra, cls) {
    return h('section', { class: 'dv-sec' + (cls ? ' ' + cls : '') },
      h('div', { class: 'dv-sec-head' }, h('h2', { class: 'dv-sec-h' }, title), extra || null), content);
  }
  function storyRow(a) {
    return h('article', { class: 'dv-row', 'data-cat': a.category },
      h('span', { class: 'dv-row-thumb' }, photo(a.category, 'dv-photo-sm')),
      h('div', { class: 'dv-row-main' },
        kicker(a.category),
        h('h3', { class: 'dv-row-h' }, h('button', { type: 'button', class: 'dv-stretch', onclick: function () { uiGo('article', { articleId: a.id }); } }, a.title)),
        meta(a, true)));
  }
  function productCard(p) {
    return h('article', { class: 'dv-pcard' },
      productArt(p),
      h('span', { class: 'dv-pcard-brand' }, p.brand),
      h('h3', { class: 'dv-pcard-h' }, h('button', { type: 'button', class: 'dv-stretch', onclick: function () { uiGo('product', { sku: p.sku }); } }, p.name)),
      h('span', { class: 'dv-pcard-price num' }, tl(p.priceTL)));
  }
  function catStrip(active) {
    var items = [{ id: null, label: 'Gündem' }].concat(CATS.map(function (c) { return { id: c, label: catLabel(c) }; }));
    return h('nav', { class: 'dv-catstrip', 'aria-label': 'Kategoriler' }, items.map(function (it) {
      return h('button', {
        type: 'button', class: 'dv-catstrip-btn', 'data-cat': it.id || 'home', 'aria-current': it.id === active ? 'page' : null,
        onclick: function () {
          if (!it.id) uiGo('home');
          else { var a = articleOfCat(it.id); if (a) uiGo('article', { articleId: a.id }); }
        }
      }, it.label);
    }));
  }
  function btn(label, cls, onclick, extra) {
    var attrs = { type: 'button', class: 'dv-btn ' + (cls || ''), onclick: onclick };
    if (extra) Object.keys(extra).forEach(function (k) { attrs[k] = extra[k]; });
    return h('button', attrs, label);
  }

  /* ---- Ana sayfa ---- */
  BUILDERS.home = function () {
    var now = U.nowSim();
    var lead = D.articles[0];
    var rest = D.articles.slice(1);
    var leadEl = h('article', { class: 'dv-lead', 'data-cat': lead.category },
      photo(lead.category, 'dv-photo-lead'),
      h('div', { class: 'dv-lead-body' },
        kicker(lead.category),
        h('h2', { class: 'dv-lead-h' }, h('button', { type: 'button', class: 'dv-stretch', onclick: function () { uiGo('article', { articleId: lead.id }); } }, lead.title)),
        h('p', { class: 'dv-lead-ex' }, lead.excerpt),
        meta(lead, true)));
    var eko = articleOfCat('ekonomi');
    var breaking = h('button', { type: 'button', class: 'dv-breaking', onclick: function () { if (eko) uiGo('article', { articleId: eko.id }); } },
      h('span', { class: 'dv-breaking-tag' }, 'Son dakika'),
      h('span', { class: 'dv-breaking-text' }, 'Faiz kararının ardından borsa günü %2,1 yükselişle kapattı'));
    var tiles = h('ul', { class: 'dv-cats' }, CATS.map(function (c) {
      var a = articleOfCat(c);
      return h('li', h('button', { type: 'button', class: 'dv-cat-tile', 'data-cat': c, onclick: function () { if (a) uiGo('article', { articleId: a.id }); } },
        h('span', { class: 'dv-cat-tile-name' }, catLabel(c)),
        h('span', { class: 'dv-cat-tile-sub' }, a ? '1 yeni haber' : '—')));
    }));
    var shop = h('ul', { class: 'dv-shop' }, D.products.map(function (p) { return h('li', productCard(p)); }));
    return h('div', { class: 'dv-home' },
      h('div', { class: 'dv-dateline' }, h('span', longDate(now)), h('span', { class: 'dv-dateline-upd nowrap' }, 'Güncellendi ' + hhmm(now))),
      catStrip(null),
      breaking,
      leadEl,
      adUnit('home'),
      section('Öne çıkanlar', h('ul', { class: 'dv-list' }, rest.map(function (a) { return h('li', storyRow(a)); }))),
      section('Kategoriler', tiles),
      section('Gündem+ Pazar', shop, h('span', { class: 'dv-sec-sub' }, 'Haberlerdeki ürünler'), 'dv-sec-shop'));
  };

  /* ---- Makale ---- */
  BUILDERS.article = function (r) {
    var a = D.articleById[r.articleId] || D.articles[0];
    var body = h('div', { class: 'dv-body' });
    var adAfter = Math.min(1, a.body.length - 1);
    a.body.forEach(function (para, i) {
      body.appendChild(h('p', { class: 'dv-p' }, para));
      if (i === adAfter) body.appendChild(adUnit('mpu'));
    });
    if (!a.body.length) body.appendChild(adUnit('mpu'));
    var related = null;
    var p = a.relatedSku ? D.productBySku[a.relatedSku] : null;
    if (p) {
      related = h('aside', { class: 'dv-related', 'aria-label': 'Haberde geçen ürün' },
        h('span', { class: 'dv-related-eyebrow' }, 'Haberde geçen ürün · Gündem+ Pazar'),
        h('div', { class: 'dv-related-card' },
          productArt(p, 'dv-pthumb-sm'),
          h('div', { class: 'dv-related-main' },
            h('span', { class: 'dv-pcard-brand' }, p.brand),
            h('h3', { class: 'dv-related-h' }, h('button', { type: 'button', class: 'dv-stretch', onclick: function () { uiGo('product', { sku: p.sku }); } }, p.name)),
            h('span', { class: 'dv-related-price num' }, tl(p.priceTL))),
          h('span', { class: 'dv-related-go', 'aria-hidden': 'true' }, icon('chevron'))));
    }
    var others = D.articles.filter(function (x) { return x.id !== a.id; });
    return h('article', { class: 'dv-article', 'data-cat': a.category },
      catStrip(a.category),
      h('header', { class: 'dv-art-head' },
        kicker(a.category),
        h('h1', { class: 'dv-h1' }, a.title),
        h('p', { class: 'dv-dek' }, a.excerpt),
        h('div', { class: 'dv-byline' },
          h('span', { class: 'dv-byline-av', 'aria-hidden': 'true' }, initials(a.author)),
          h('span', { class: 'dv-byline-txt' },
            h('span', { class: 'dv-byline-name' }, a.author),
            h('span', { class: 'dv-byline-meta' }, pubLabel(a.publishedAt) + ' · ' + a.readMin + ' dk okuma')))),
      photo(a.category, 'dv-photo-art', 'Temsili görsel · Gündem+'),
      body,
      related,
      section('Diğer haberler', h('ul', { class: 'dv-list' }, others.map(function (x) { return h('li', storyRow(x)); }))));
  };

  /* ---- Ürün ---- */
  BUILDERS.product = function (r) {
    var p = D.productBySku[r.sku] || D.products[0];
    var inCart = cartSkus().filter(function (s) { return s === p.sku; }).length;
    var justAdded = S.productUi.added === p.sku && (Date.now() - S.productUi.t) < 1800;
    var buy = h('button', { type: 'button', class: 'dv-btn dv-btn-brand dv-btn-block dv-buy' + (justAdded ? ' is-done' : ''), onclick: function () { doAddToCart(p.sku, 'ui'); } },
      icon(justAdded ? 'check' : 'bag'), justAdded ? 'Sepete eklendi' : 'Sepete ekle');
    var art = articleForSku(p.sku);
    var perks = (PERKS[p.category] || PERKS.teknoloji).map(function (pk) {
      return h('li', { class: 'dv-perk' }, icon(pk[0]), h('span', pk[1]));
    });
    return h('div', { class: 'dv-product' },
      h('nav', { class: 'dv-crumbs', 'aria-label': 'Konum' },
        h('button', { type: 'button', class: 'dv-crumb', onclick: function () { uiGo('home'); } }, 'Ana sayfa'),
        h('span', { class: 'dv-crumb-sep', 'aria-hidden': 'true' }, '›'),
        h('span', { class: 'dv-crumb is-static' }, 'Pazar'),
        h('span', { class: 'dv-crumb-sep', 'aria-hidden': 'true' }, '›'),
        h('span', { class: 'dv-crumb is-current', 'aria-current': 'page' }, catLabel(p.category))),
      productArt(p, 'dv-pthumb-lg'),
      h('div', { class: 'dv-pinfo' },
        h('span', { class: 'dv-pbrand' }, p.brand),
        h('h1', { class: 'dv-ptitle' }, p.name),
        h('p', { class: 'dv-pdesc' }, p.desc),
        h('div', { class: 'dv-price' },
          h('span', { class: 'dv-price-v num' }, tl(p.priceTL)),
          h('span', { class: 'dv-price-n' }, 'KDV dahil · SKU ' + p.sku)),
        buy,
        inCart ? h('p', { class: 'dv-incart' }, icon('check'),
          h('span', 'Sepetinizde ' + inCart + ' adet var.'),
          h('button', { type: 'button', class: 'dv-linkbtn', onclick: function () { uiGo('cart'); } }, 'Sepete git')) : null,
        h('ul', { class: 'dv-perks' }, perks)),
      art ? section('Haberlerde', h('ul', { class: 'dv-list' }, h('li', storyRow(art)))) : null);
  };

  /* ---- Sepet ---- */
  BUILDERS.cart = function () {
    var u = userState();
    var skus = cartSkus();
    var counts = {}, order = [];
    skus.forEach(function (s) { if (!counts[s]) { counts[s] = 0; order.push(s); } counts[s]++; });
    var total = 0;
    var wrap = h('div', { class: 'dv-cart' },
      h('h1', { class: 'dv-page-h' }, 'Sepetim', skus.length ? h('span', { class: 'dv-count num' }, skus.length + ' ürün') : null));

    if (S.cartUi.phase === 'working') {
      wrap.appendChild(h('div', { class: 'dv-card dv-state', role: 'status' },
        h('span', { class: 'dv-spinner', 'aria-hidden': 'true' }),
        h('div', h('strong', 'Ödemeniz işleniyor…'), h('p', { class: 'dv-small' }, 'Sipariş olayı (purchase) gönderiliyor.'))));
      return wrap;
    }
    if (!skus.length) {
      if (u.lastOrder) {
        wrap.appendChild(h('div', { class: 'dv-card dv-success' },
          h('span', { class: 'dv-success-ico', 'aria-hidden': 'true' }, icon('check')),
          h('h2', { class: 'dv-success-h' }, 'Siparişiniz alındı'),
          h('dl', { class: 'dv-dl' },
            h('dt', 'Sipariş no'), h('dd', { class: 'mono' }, u.lastOrder.orderId),
            h('dt', 'Tutar'), h('dd', { class: 'num' }, tl(u.lastOrder.revenueTL)),
            h('dt', 'Teslimat'), h('dd', '2–3 iş günü')),
          h('p', { class: 'dv-small' }, 'Bu bir simülasyon: ödeme alınmadı, e-posta gönderilmedi.'),
          btn('Alışverişe devam et', 'dv-btn-line dv-btn-block', function () { uiGo('home'); })));
      } else {
        wrap.appendChild(h('div', { class: 'dv-card dv-empty' },
          h('span', { class: 'dv-empty-ico', 'aria-hidden': 'true' }, icon('bag')),
          h('strong', 'Sepetiniz boş'),
          h('p', { class: 'dv-small' }, S.cartUi.msg === 'empty' ? 'Satın almak için önce sepete bir ürün ekleyin.' : 'Haberlerde gördüğünüz ürünler Gündem+ Pazar’da.')));
      }
      wrap.appendChild(section('Bunlar ilginizi çekebilir', h('ul', { class: 'dv-shop' }, D.products.map(function (p) { return h('li', productCard(p)); })), null, 'dv-sec-shop'));
      return wrap;
    }
    var list = h('ul', { class: 'dv-cart-list' }, order.map(function (sku) {
      var p = D.productBySku[sku];
      if (!p) return null;
      var line = p.priceTL * counts[sku];
      total += line;
      return h('li', { class: 'dv-cart-item' },
        productArt(p, 'dv-pthumb-xs'),
        h('div', { class: 'dv-cart-main' },
          h('span', { class: 'dv-pcard-brand' }, p.brand),
          h('button', { type: 'button', class: 'dv-cart-name', onclick: function () { uiGo('product', { sku: p.sku }); } }, p.name),
          h('span', { class: 'dv-cart-qty' }, counts[sku] + ' adet × ', h('span', { class: 'num' }, tl(p.priceTL)))),
        h('span', { class: 'dv-cart-line num' }, tl(line)));
    }));
    wrap.appendChild(list);
    wrap.appendChild(h('div', { class: 'dv-card dv-summary' },
      h('dl', { class: 'dv-dl dv-dl-sum' },
        h('dt', 'Ara toplam'), h('dd', { class: 'num' }, tl(total)),
        h('dt', 'Kargo'), h('dd', 'Ücretsiz'),
        h('dt', { class: 'is-total' }, 'Toplam'), h('dd', { class: 'is-total num' }, tl(total))),
      h('button', { type: 'button', class: 'dv-btn dv-btn-brand dv-btn-block dv-checkout', onclick: function () { doPurchase('ui'); } }, icon('card'), 'Satın al'),
      h('p', { class: 'dv-small' }, 'Ödeme adımı simülasyondur; kart bilgisi istenmez.')));
    return wrap;
  };

  /* ---- Giriş / Hesap ---- */
  function hashBox(email, hex, opts) {
    opts = opts || {};
    var norm = String(email || '').trim().toLowerCase();
    var full = h('span', { class: 'dv-hash-full mono' }, hex || '');
    var box = h('div', { class: 'dv-hash' + (hex ? '' : ' is-pending') },
      h('div', { class: 'dv-hash-step' },
        h('span', { class: 'dv-hash-k' }, '1 · Normalize'),
        h('span', { class: 'dv-hash-v mono' }, norm)),
      h('div', { class: 'dv-hash-step' },
        h('span', { class: 'dv-hash-k' }, '2 · SHA-256'),
        hex ? h('span', { class: 'dv-hash-v dv-hash-short mono' }, U.shortHash(hex)) : h('span', { class: 'dv-hash-v dv-hash-wait' }, h('span', { class: 'dv-spinner sm', 'aria-hidden': 'true' }), 'hesaplanıyor…')),
      hex ? full : null,
      h('p', { class: 'dv-hash-note' }, icon('lock'), h('span', opts.note || 'Hash tarayıcıda hesaplanır; sunucuya ham e-posta değil, yalnızca bu değer gider.')));
    if (hex && opts.reveal) scramble(full, hex);
    return box;
  }
  function scramble(el, hex) {
    if (reduced()) { el.textContent = hex; return; }
    var chars = '0123456789abcdef', start = performance.now(), dur = 750;
    function frame(t) {
      if (!el.isConnected) return;
      var k = Math.min(1, (t - start) / dur), n = Math.floor(hex.length * k), out = hex.slice(0, n);
      for (var i = n; i < hex.length; i++) out += chars.charAt((i * 7 + Math.floor(t / 40)) % 16);
      el.textContent = out;
      if (k < 1) requestAnimationFrame(frame); else el.textContent = hex;
    }
    requestAnimationFrame(frame);
  }

  BUILDERS.login = function () {
    var u = userState(), L = S.loginUi;
    var working = L.phase === 'working';
    if (u.loggedIn && !(working && !u.hem)) {
      var name = u.displayName || '';
      var first = name ? name.split(/\s+/)[0] : '';
      var reveal = !!(working && !L.revealed && u.hem);
      if (reveal) L.revealed = true;
      return h('div', { class: 'dv-account' },
        h('div', { class: 'dv-acct-head' },
          h('span', { class: 'dv-avatar dv-avatar-lg', 'aria-hidden': 'true' }, initials(name || u.email)),
          h('div', { class: 'dv-acct-id' },
            h('h1', { class: 'dv-page-h' }, first ? 'Hoş geldiniz, ' + first : 'Hoş geldiniz'),
            h('span', { class: 'dv-acct-mail' }, u.email || ''))),
        h('p', { class: 'dv-acct-status' + (working ? ' is-working' : ''), role: 'status' },
          working ? h('span', { class: 'dv-spinner sm', 'aria-hidden': 'true' }) : icon('check'),
          working ? 'Oturum açılıyor, kimlik bağlantısı gönderiliyor…' : 'Oturum açık'),
        h('h2', { class: 'dv-sub-h' }, 'Hash’li e-posta (hem)'),
        hashBox(u.email, u.hem, { reveal: reveal, note: 'Sunucuya ve reklam sistemine giden tek e-posta temsili bu SHA-256 değeridir.' }),
        h('div', { class: 'dv-acct-links' },
          btn('Gizlilik ve verilerim', 'dv-btn-line dv-btn-block', function () { uiGo('privacy'); }),
          btn('Gündem+ Pazar’a göz at', 'dv-btn-ghost dv-btn-block', function () { uiGo('home'); })));
    }
    var draft = L.draft != null ? L.draft : D.demoUser.email;
    var input = h('input', {
      id: 'dv-login-email', class: 'dv-input', type: 'email', name: 'email', autocomplete: 'off', spellcheck: 'false',
      inputmode: 'email', value: working ? (L.email || draft) : draft, 'aria-describedby': 'dv-login-note', 'aria-invalid': L.error ? 'true' : null,
      disabled: working, oninput: function (e) { L.draft = e.target.value; if (L.error) { L.error = null; } }
    });
    var form = h('form', {
      class: 'dv-login-form', novalidate: true,
      onsubmit: function (e) {
        e.preventDefault();
        if (L.phase === 'working') return;
        var v = String(input.value || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
          L.error = 'Geçerli bir e-posta adresi girin.';
          L.draft = input.value;
          renderPage({ keepScroll: true });
          var again = document.getElementById('dv-login-email');
          if (again) again.focus({ preventScroll: true });
          return;
        }
        L.error = null;
        doLogin(v, 'ui');
      }
    },
      h('label', { class: 'dv-label', for: 'dv-login-email' }, 'E-posta'),
      input,
      L.error ? h('p', { class: 'dv-error', role: 'alert' }, L.error) : null,
      h('p', { class: 'dv-hint' }, 'Demo hesabı: şifre gerekmez.'),
      h('button', { type: 'submit', class: 'dv-btn dv-btn-brand dv-btn-block dv-login-submit', disabled: working },
        working ? h('span', { class: 'dv-spinner sm on-brand', 'aria-hidden': 'true' }) : icon('key'), working ? 'Giriş yapılıyor…' : 'Giriş yap'),
      h('p', { class: 'dv-note', id: 'dv-login-note' }, icon('lock'),
        h('span', 'E-posta adresiniz tarayıcınızda küçük harfe çevrilip ', h('strong', 'SHA-256'), ' ile hash’lenir. Sunucuya ham e-posta değil, yalnızca bu hash gider.')));
    var reveal2 = !!(working && L.localHash && !L.revealed);
    if (reveal2) L.revealed = true;
    return h('div', { class: 'dv-login' },
      h('h1', { class: 'dv-page-h' }, 'Giriş yap'),
      h('p', { class: 'dv-lede' }, 'Gündem+ hesabınızla bültenlerinizi, kayıtlı haberlerinizi ve Pazar siparişlerinizi yönetin.'),
      form,
      working ? hashBox(L.email, L.localHash, { reveal: reveal2 }) : null);
  };

  /* ---- Gizlilik ---- */
  BUILDERS.privacy = function () {
    var c = consentState(), u = userState(), Lb = D.labels || {};
    var st = c.status || 'unknown';
    var pillCls = st === 'all' ? 'pill-ok' : (st === 'necessary' ? 'pill-warn' : (st === 'reject' ? 'pill-bad' : 'pill-muted'));
    var purposes = ['storage', 'measurement', 'profiling', 'personalizedAds'].map(function (k) {
      var on = !!(c.purposes && c.purposes[k]);
      return h('li', { class: 'dv-purpose' + (on ? ' is-on' : '') },
        h('span', { class: 'dv-purpose-ico', 'aria-hidden': 'true' }, icon(on ? 'check' : 'cross')),
        h('span', { class: 'dv-purpose-name' }, (Lb.consentPurposes && Lb.consentPurposes[k]) || k),
        h('span', { class: 'dv-purpose-v' }, on ? 'Açık' : 'Kapalı'));
    });
    var consentCard = h('section', { class: 'dv-card dv-consent-card', 'aria-labelledby': 'dv-pv-consent' },
      h('div', { class: 'dv-card-head' },
        h('h2', { class: 'dv-card-h', id: 'dv-pv-consent' }, 'Rıza durumunuz'),
        h('span', { class: pillCls }, (Lb.consentStatus && Lb.consentStatus[st]) || st)),
      h('ul', { class: 'dv-purposes' }, purposes),
      h('dl', { class: 'dv-dl' },
        h('dt', 'KVKK açık rıza'), h('dd', c.kvkkExplicit ? 'Verildi' : 'Verilmedi'),
        h('dt', 'Son güncelleme'), h('dd', { class: 'dv-tnum' }, c.at ? U.fmtDateTime(c.at) : '—'),
        c.tcString ? h('dt', 'TC string') : null, c.tcString ? h('dd', { class: 'mono dv-break' }, c.tcString) : null),
      h('button', { type: 'button', class: 'dv-btn dv-btn-line dv-btn-block dv-consent-open', onclick: function () { openBanner('reopen', true); } }, icon('cookie'), 'Rıza ayarlarını değiştir'));

    var d = lastDsar();
    var working = S.dsarUi.phase === 'working';
    var ids = h('dl', { class: 'dv-dl' },
      h('dt', '1P çerez (fpc)'), h('dd', { class: 'mono' }, u.fpc ? U.shortHash(u.fpc) : 'yok'),
      h('dt', 'Hash’li e-posta'), h('dd', { class: 'mono' }, u.hem ? U.shortHash(u.hem) : 'giriş yapılmadı'),
      h('dt', 'Profil (DMP)'), h('dd', { class: 'mono' }, u.personId || '—'));
    var dsarBlock = null;
    if (d) {
      var doneN = DSAR_ORDER.filter(function (k) { return d.stores && d.stores[k] === 'done'; }).length;
      dsarBlock = h('div', { class: 'dv-dsar' + (d.status === 'done' ? ' is-done' : ''), role: 'status' },
        h('div', { class: 'dv-dsar-head' },
          h('strong', d.status === 'done' ? 'Silme tamamlandı' : 'Silme talebi işleniyor'),
          h('span', { class: 'dv-dsar-id mono' }, d.id)),
        h('ul', { class: 'dv-dsar-list' }, DSAR_ORDER.map(function (k) {
          var s = d.stores ? d.stores[k] : null;
          var lbl = DSAR_LABELS[k] || [k, ''];
          return h('li', { class: 'dv-dsar-item is-' + (s === 'done' ? 'done' : 'pending') },
            s === 'done' ? h('span', { class: 'dv-dsar-ico', 'aria-hidden': 'true' }, icon('check')) : h('span', { class: 'dv-spinner sm', 'aria-hidden': 'true' }),
            h('span', { class: 'dv-dsar-name' }, lbl[0], h('span', { class: 'dv-dsar-tech' }, lbl[1])),
            h('span', { class: 'dv-dsar-v num' }, s === 'done' ? (d.doneAt && d.doneAt[k] ? U.fmtTime(d.doneAt[k]) : 'silindi') : 'bekliyor'));
        })),
        h('p', { class: 'dv-small' }, doneN + '/' + DSAR_ORDER.length + ' depo · ' +
          (d.status === 'done' ? 'Kimlikleriniz suppression listesinde: aynı çerez veya e-postayla dönseniz de profil yeniden oluşturulmaz.' : 'Yasal süre 30 gün, hedef 72 saat.')));
    }
    var actions;
    if (S.dsarUi.confirm && !working) {
      actions = h('div', { class: 'dv-confirm', role: 'group', 'aria-label': 'Silme onayı' },
        h('p', { class: 'dv-confirm-q' }, 'Profiliniz, kimlik eşleştirmeleriniz ve reklam ortaklarındaki kayıtlarınız silinecek. Onaylıyor musunuz?'),
        h('div', { class: 'dv-confirm-row' },
          h('button', { type: 'button', class: 'dv-btn dv-btn-danger dv-btn-block dv-dsar-yes', onclick: function () { doDsar('ui'); } }, icon('trash'), 'Evet, verilerimi sil'),
          btn('Vazgeç', 'dv-btn-line dv-btn-block', function () { S.dsarUi.confirm = false; renderPage({ keepScroll: true }); })));
    } else {
      actions = h('button', {
        type: 'button', class: 'dv-btn dv-btn-danger-line dv-btn-block dv-dsar-btn', disabled: working,
        onclick: function () { S.dsarUi.confirm = true; renderPage({ keepScroll: true }); var y = S.el.page.querySelector('.dv-dsar-yes'); if (y) y.focus({ preventScroll: true }); revealEl(S.el.page.querySelector('.dv-confirm'), 'nearest'); }
      }, working ? h('span', { class: 'dv-spinner sm', 'aria-hidden': 'true' }) : icon('trash'), working ? 'Talep gönderiliyor…' : 'Verilerimi sil');
    }
    var dataCard = h('section', { class: 'dv-card dv-data-card', 'aria-labelledby': 'dv-pv-data' },
      h('div', { class: 'dv-card-head' }, h('h2', { class: 'dv-card-h', id: 'dv-pv-data' }, 'Kişisel verileriniz')),
      h('p', { class: 'dv-small dv-intro' }, 'Gündem+ bu tarayıcıyı şu kimliklerle tanıyor:'),
      ids,
      dsarBlock,
      actions,
      h('p', { class: 'dv-small' }, 'KVKK m.11 kapsamındaki silme talebiniz profil, kimlik grafiği, olay arşivi, raporlar, clean room ve reklam ortaklarında birlikte uygulanır.'));
    return h('div', { class: 'dv-privacy' },
      h('h1', { class: 'dv-page-h' }, 'Gizlilik ve çerezler'),
      h('p', { class: 'dv-lede' }, 'Kişisel verileriniz KVKK kapsamında ve yalnızca izin verdiğiniz amaçlarla işlenir.'),
      consentCard, dataCard);
  };

  /* ==================================================================
   * Reklam alanları
   * ================================================================== */
  function adUnit(slotId) {
    var slot = D.slots[slotId] || { code: '', size: '' };
    var unit = h('section', { class: 'dv-ad dv-ad-' + slotId, 'data-slot': slotId, 'aria-label': 'Reklam alanı ' + (slot.size || '').replace('x', '×') });
    var why = h('button', {
      type: 'button', class: 'dv-ad-why', title: 'Neden bu reklam?', 'aria-label': 'Neden bu reklam?',
      onclick: function () { bus.emit('inspector:show', { tab: 'decision' }); }
    }, icon('info'), h('span', { class: 'dv-ad-why-t' }, 'Neden bu reklam?'));
    unit.appendChild(h('div', { class: 'dv-ad-head' }, h('span', { class: 'dv-ad-label' }, 'Reklam'), why));
    unit.appendChild(h('div', { class: 'dv-ad-body' }));
    fillSlot(unit, slotId, false);
    return unit;
  }

  function fillSlot(unit, slotId, animate) {
    var ss = S.slots[slotId] || { status: 'idle' };
    var body = unit.querySelector('.dv-ad-body');
    var size = SLOT_SIZE[slotId] || [300, 250];
    var slot = D.slots[slotId] || {};
    U.clear(body);
    unit.setAttribute('data-state', ss.status);
    unit.querySelector('.dv-ad-why').hidden = ss.status !== 'rendered';
    var box = h('div', { class: 'dv-ad-box', style: { '--w': size[0], '--h': size[1] } });
    var sizeTxt = (slot.size || '').replace('x', '×');
    if (ss.status === 'rendered' && ss.ad) {
      var click = h('button', { type: 'button', class: 'dv-ad-click', 'aria-label': adLabel(ss.ad), onclick: function () { doClickAd('ui', click); } },
        h('span', { class: 'dv-ad-stage' }, buildCreative(ss.ad, slotId)));
      box.appendChild(click);
      if (animate && !reduced()) box.classList.add('is-in');
    } else if (ss.status === 'loading') {
      box.classList.add('is-loading');
      box.appendChild(h('span', { class: 'dv-ad-skel', role: 'status' },
        h('span', { class: 'dv-ad-skel-t' }, 'Reklam yükleniyor…'),
        h('span', { class: 'dv-ad-skel-c mono' }, slot.code + ' · ' + sizeTxt)));
    } else {
      box.classList.add('is-idle');
      box.appendChild(h('span', { class: 'dv-ad-ph' },
        h('span', { class: 'dv-ad-ph-t' }, 'Reklam alanı'),
        h('span', { class: 'dv-ad-skel-c mono' }, slot.code + ' · ' + sizeTxt)));
    }
    body.appendChild(box);
    layoutAd(unit);
  }

  function adLabel(ad) {
    var cr = ad.creative || {};
    return 'Reklam: ' + (cr.brand || '') + ' — ' + (cr.headline || '') + '. ' + (cr.cta || '');
  }

  function layoutAd(unit) {
    var slotId = unit.getAttribute('data-slot');
    var size = SLOT_SIZE[slotId] || [300, 250];
    var body = unit.querySelector('.dv-ad-body');
    var box = unit.querySelector('.dv-ad-box');
    if (!body || !box) return;
    var w = body.clientWidth;
    if (!w) return;
    var s = Math.min(1, w / size[0]);
    box.style.setProperty('--s', s.toFixed(4));
  }
  function layoutAds() {
    if (!S.mounted) return;
    U.qsa('.dv-ad', S.el.page).forEach(layoutAd);
  }
  function currentAdUnit(slotId) { return S.mounted ? S.el.page.querySelector('.dv-ad[data-slot="' + slotId + '"]') : null; }
  function renderSlot(slotId, animate) {
    var unit = currentAdUnit(slotId);
    if (unit) fillSlot(unit, slotId, animate);
    return unit;
  }

  /* ---- kreatif ---- */
  function creativeArt(theme, bidder, pal) {
    var dark = hexLum(pal.bg) < 0.2;
    switch (theme) {
      case 'volta':
        return ART.suv({ body: pal.fg, glass: '#2b4b61', light: pal.accent, wheel: '#1d3a4f', hub: pal.accent, shadow: 'rgba(63,208,201,.28)', bolt: pal.accent }) +
          '<g fill="' + pal.muted + '" opacity=".55"><circle cx="14" cy="14" r="1.2"/><circle cx="34" cy="26" r="1"/><circle cx="130" cy="12" r="1.3"/><circle cx="150" cy="30" r="1"/><circle cx="96" cy="8" r="1"/></g>';
      case 'minik':
        return ART.stroller({ canopy: pal.accent, rib: '#f6a77a', body: pal.fg, frame: pal.fg, wheelIn: pal.bg });
      case 'nova':
        return ART.laptop({ lid: '#3a3f4b', screen: '#05070b', line: pal.accent, base: '#c6ccd6', notch: '#8b93a1' });
      case 'sepetim':
        return ART.bag({ bag: pal.accent, handle: pal.fg, fold: 'rgba(0,0,0,.14)', mark: pal.bg, box: pal.muted });
      case 'bulut':
        return ART.card({ card: pal.accent, back: '#9cbcf5', chip: '#f5d27a', waves: '#ffffff', logo: '#ffffff', num: 'rgba(255,255,255,.75)' });
      case 'house':
        return ART.app({ phone: '#05070a', edge: '#3a4350', screen: '#ffffff', brand: '#c8102e', img: '#d7dde5', line: '#3a4350', line2: '#aab3bf', bubble: pal.accent, bubbleInk: '#131922' });
      default:
        var b = BIDDER_ART[bidder] || BIDDER_ART.alfa;
        var acc = b.accent;
        if (b.art === 'cup') return ART.cup({ cup: acc, saucer: 'rgba(0,0,0,.12)', coffee: '#3b2414', steam: pal.muted });
        if (b.art === 'shield') return ART.shield({ shield: acc, shade: 'rgba(255,255,255,.16)', check: '#ffffff' });
        if (b.art === 'glasses') return ART.glasses({ frame: '#1d232b', lens: 'rgba(13,116,128,.16)', ray: acc });
        return ART.plane({ sun: '#f5a524', cloud: '#ffffff', sea: '#5aa9e6', wave: '#bfe0f7', plane: dark ? '#ffffff' : '#1d232b', stripe: acc });
    }
  }

  /** "8.499 ₺" gibi tutarlarda sayı ile para birimi aynı satırda kalsın. */
  function keepTL(t) { return String(t).replace(/(\d) ₺/g, '$1\u00a0₺'); }

  function buildCreative(ad, slotId) {
    var cr = ad.creative || {};
    var isProg = ad.source === 'prebid' || !!cr.programmatic;
    var theme = cr.theme || (isProg ? 'prog' : 'house');
    var themes = D.creativeThemes || {};
    var pal = themes[theme] || themes.prog || { bg: '#f3f4f6', fg: '#1d232b', accent: '#5a6878', muted: '#6b7480' };
    var bidder = cr.bidder || ad.bidder || null;
    var accent = pal.accent;
    if (isProg && BIDDER_ART[bidder]) accent = BIDDER_ART[bidder].accent;
    var ctaInk = bestInk(accent, ['#ffffff', pal.bg, pal.fg, '#111111']);
    var bidderName = cr.bidderName || (bidder && D.bidderById[bidder] ? D.bidderById[bidder].name : bidder);
    var li = ad.lineItemId != null ? D.lineItemById[ad.lineItemId] : null;
    var adomain = cr.adomain || (li && li.adomain) || (theme === 'house' ? D.site.domain : '');
    var markTxt = theme === 'house' ? 'G+' : initials(cr.brand || '').charAt(0);
    var markInk = bestInk(accent, ['#ffffff', pal.bg, pal.fg, '#111111']);
    var variant = slotId === 'home' ? 'banner' : 'mpu';
    var root = h('span', {
      class: 'dv-cr dv-cr-' + variant, 'data-theme': theme, 'data-source': ad.source || '',
      style: { '--cr-bg': pal.bg, '--cr-fg': pal.fg, '--cr-accent': accent, '--cr-muted': pal.muted, '--cr-cta-ink': ctaInk, '--cr-mark-ink': markInk }
    });
    var art = h('span', { class: 'dv-cr-art' }, svgOf('0 0 160 90', creativeArt(theme, bidder, pal), 'dv-cr-svg', null, 'xMidYMid meet'));
    var brand = h('span', { class: 'dv-cr-brand' },
      h('span', { class: 'dv-cr-mark' + (theme === 'house' ? ' is-house' : '') }, markTxt), h('span', { class: 'dv-cr-brand-t' }, cr.brand || ''));
    var tag = isProg ? h('span', { class: 'dv-cr-tag' }, 'Programatik · ' + (bidderName || 'DSP')) : null;
    var cta = h('span', { class: 'dv-cr-cta' }, cr.cta || 'İncele', svgOf('0 0 24 24', ICONS.arrow, 'dv-cr-cta-ico'));
    var dom = adomain ? h('span', { class: 'dv-cr-dom' }, adomain) : null;
    if (variant === 'mpu') {
      root.appendChild(h('span', { class: 'dv-cr-top' }, brand, tag));
      root.appendChild(art);
      root.appendChild(h('span', { class: 'dv-cr-copy' },
        h('span', { class: 'dv-cr-h' }, keepTL(cr.headline || '')),
        cr.body ? h('span', { class: 'dv-cr-b' }, keepTL(cr.body)) : null));
      root.appendChild(h('span', { class: 'dv-cr-foot' }, cta, dom));
    } else {
      if (tag) art.appendChild(tag);
      root.appendChild(art);
      root.appendChild(h('span', { class: 'dv-cr-main' },
        brand,
        h('span', { class: 'dv-cr-h' }, keepTL(cr.headline || '')),
        h('span', { class: 'dv-cr-foot' }, cta, dom)));
    }
    return root;
  }

  /* ==================================================================
   * Katman: rıza banner'ı, kategori sayfası, bildirim, dokunma efekti
   * ================================================================== */
  function openBanner(mode, focus) {
    if (!S.mounted) { S.banner = { open: true, mode: mode || 'initial' }; return; }
    closeSheet();
    S.banner = { open: true, mode: mode || 'initial' };
    var E = S.el;
    removeBannerNodes(true);
    var c = consentState();
    var Lb = D.labels || {};
    var reopen = S.banner.mode === 'reopen';
    var detailsId = 'dv-consent-details';
    var details = h('div', { class: 'dv-consent-details', id: detailsId, hidden: true },
      h('ul', { class: 'dv-consent-purposes' },
        h('li', h('strong', 'Zorunlu çerezler'), h('span', 'Oturum, güvenlik ve rıza kaydı. Her zaman açık.')),
        h('li', h('strong', 'Ölçüm ve analitik'), h('span', 'Ziyaret istatistikleri. Yalnızca “Tümünü kabul et” ile.')),
        h('li', h('strong', 'Profilleme'), h('span', 'İlgi alanı segmentleri (ör. otomobil, teknoloji). Açık rıza gerekir.')),
        h('li', h('strong', 'Kişiselleştirilmiş reklam'), h('span', 'Profilinize göre reklam ve reklam ortaklarıyla paylaşım. Açık rıza gerekir.'))),
      h('p', { class: 'dv-small' }, 'Veri sorumlusu: Gündem+ Medya (kurgusal). Reklam ortakları: ' +
        D.bidders.map(function (b) { return b.name; }).join(', ') + '. Kararınızı istediğiniz an Gizlilik sayfasından değiştirebilirsiniz.'));
    var toggle = h('button', {
      type: 'button', class: 'dv-linklike', 'aria-expanded': 'false', 'aria-controls': detailsId,
      onclick: function () {
        var open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        details.hidden = !open;
        toggle.textContent = open ? 'Ayrıntıları gizle' : 'Aydınlatma metni ve ayrıntılar';
      }
    }, 'Aydınlatma metni ve ayrıntılar');
    var choice = function (ch, cls) {
      return h('button', { type: 'button', class: 'dv-btn ' + cls, 'data-choice': ch, onclick: function () { doConsent(ch, 'ui'); } },
        (Lb.consentChoice && Lb.consentChoice[ch]) || ch);
    };
    var sheet = h('section', { class: 'dv-sheet dv-consent', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'dv-consent-title', 'aria-describedby': 'dv-consent-text' },
      h('span', { class: 'dv-sheet-grip', 'aria-hidden': 'true' }),
      reopen ? h('button', { type: 'button', class: 'dv-sheet-x', 'aria-label': 'Kapat', onclick: function () { closeBanner(); } }, icon('close')) : null,
      h('p', { class: 'dv-consent-eyebrow' }, icon('cookie'), 'KVKK · Çerez tercihleri'),
      h('h2', { class: 'dv-consent-h', id: 'dv-consent-title' }, reopen ? 'Tercihlerinizi güncelleyin' : 'Gizliliğinize saygı duyuyoruz'),
      h('p', { class: 'dv-consent-text', id: 'dv-consent-text' },
        'Sitenin çalışması için zorunlu çerezler kullanıyoruz. ',
        h('strong', 'Açık rızanız'), ' olursa çerezler ve benzeri teknolojilerle ziyaretinizi ölçer, ilgi alanlarınıza göre ',
        h('strong', 'profil'), ' oluşturur ve size ', h('strong', 'kişiselleştirilmiş reklam'), ' gösteririz.'),
      reopen ? h('p', { class: 'dv-consent-now' }, 'Şu anki tercih: ', h('strong', (Lb.consentStatus && Lb.consentStatus[c.status]) || c.status),
        c.at ? ' · ' + U.fmtDateTime(c.at) : '') : null,
      h('p', { class: 'dv-consent-links' }, toggle),
      details,
      h('div', { class: 'dv-consent-actions' },
        choice('all', 'dv-btn-solid'),
        choice('reject', 'dv-btn-solid'),
        choice('necessary', 'dv-btn-line dv-consent-wide')));
    var scrim = h('div', { class: 'dv-scrim' + (reopen ? ' is-click' : ''), onclick: reopen ? function () { closeBanner(); } : null });
    E.layer.appendChild(scrim);
    E.layer.appendChild(sheet);
    E.bannerNodes = [scrim, sheet];
    if (!reduced()) { sheet.classList.add('is-in'); scrim.classList.add('is-in'); }
    if (focus) {
      var first = sheet.querySelector('[data-choice="all"]');
      if (first) first.focus({ preventScroll: true });
    }
  }
  function removeBannerNodes(now) {
    var nodes = S.el.bannerNodes;
    S.el.bannerNodes = null;
    if (!nodes) return;
    nodes.forEach(function (n) {
      if (now || reduced()) { if (n.parentNode) n.parentNode.removeChild(n); return; }
      n.classList.remove('is-in');
      n.classList.add('is-out');
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 260);
    });
  }
  function closeBanner() {
    var wasFocusedInside = S.el.bannerNodes && S.el.bannerNodes[1] && S.el.bannerNodes[1].contains(document.activeElement);
    S.banner.open = false;
    if (!S.mounted) return;
    removeBannerNodes(false);
    if (wasFocusedInside && S.el.viewport) S.el.viewport.focus({ preventScroll: true });
  }

  function openCats() {
    if (!S.mounted) return;
    closeSheet();
    var list = h('ul', { class: 'dv-cat-list' }, CATS.map(function (c) {
      var a = articleOfCat(c);
      return h('li', h('button', {
        type: 'button', class: 'dv-cat-row', 'data-cat': c,
        onclick: function () { closeSheet(); if (a) uiGo('article', { articleId: a.id }); }
      },
        h('span', { class: 'dv-cat-row-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'dv-cat-row-main' },
          h('span', { class: 'dv-cat-row-name' }, catLabel(c)),
          h('span', { class: 'dv-cat-row-sub' }, a ? a.title : '')),
        icon('chevron')));
    }));
    var close = h('button', { type: 'button', class: 'dv-sheet-x', 'aria-label': 'Kapat', onclick: function () { closeSheet(); } }, icon('close'));
    var sheet = h('section', { class: 'dv-sheet dv-cats-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'dv-cats-title' },
      h('span', { class: 'dv-sheet-grip', 'aria-hidden': 'true' }),
      close,
      h('h2', { class: 'dv-sheet-h', id: 'dv-cats-title' }, 'Kategoriler'),
      list);
    var scrim = h('div', { class: 'dv-scrim is-click', onclick: function () { closeSheet(); } });
    S.el.layer.appendChild(scrim);
    S.el.layer.appendChild(sheet);
    if (!reduced()) { sheet.classList.add('is-in'); scrim.classList.add('is-in'); }
    S.sheet = { kind: 'cats', nodes: [scrim, sheet] };
    refreshChrome();
    var first = sheet.querySelector('.dv-cat-row');
    if (first) first.focus({ preventScroll: true });
  }
  function closeSheet() {
    if (!S.sheet) return;
    var nodes = S.sheet.nodes;
    var restore = nodes[1].contains(document.activeElement);
    S.sheet = null;
    nodes.forEach(function (n) {
      if (reduced()) { if (n.parentNode) n.parentNode.removeChild(n); return; }
      n.classList.remove('is-in'); n.classList.add('is-out');
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 240);
    });
    if (restore && S.el.tabs) S.el.tabs.cats.focus({ preventScroll: true });
    refreshChrome();
  }

  function clearToast() {
    if (!S.mounted) return;
    clearTimeout(S.toastT);
    var t = S.el.layer.querySelector('.dv-toast');
    if (t) t.parentNode.removeChild(t);
  }

  function toast(title, sub) {
    if (!S.mounted) return;
    var old = S.el.layer.querySelector('.dv-toast');
    if (old) old.parentNode.removeChild(old);
    var t = h('div', { class: 'dv-toast', role: 'status' }, h('strong', title), sub ? h('span', sub) : null);
    S.el.layer.appendChild(t);
    clearTimeout(S.toastT);
    S.toastT = setTimeout(function () {
      t.classList.add('is-out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, 2800);
  }

  /**
   * Site görünümünü (yalnızca iç kaydırma alanını; sayfanın kendisini asla) öğe görünecek şekilde kaydırır.
   * mode: 'center' (öğeyi ortala) | 'nearest' (en az kaydırma). Kaydırma yaptıysa true.
   */
  function revealEl(el, mode) {
    var vp = S.el.viewport;
    if (!vp || !el || !vp.contains(el)) return false;
    var vr = vp.getBoundingClientRect(), er = el.getBoundingClientRect();
    var mast = S.el.site.querySelector('.dv-mast');
    var top = (mast ? mast.offsetHeight : 0) + 8;
    if (er.top >= vr.top + top && er.bottom <= vr.bottom - 8) return false;
    var free = vr.height - top;
    var target;
    if (er.height >= free - 16) target = vp.scrollTop + (er.top - vr.top) - top;
    else if (mode === 'center') target = vp.scrollTop + (er.top - vr.top) - (top + (free - er.height) / 2);
    else if (er.top < vr.top + top) target = vp.scrollTop + (er.top - vr.top) - top - 4;
    else target = vp.scrollTop + (er.bottom - vr.bottom) + 14;
    target = Math.max(0, Math.min(target, vp.scrollHeight - vp.clientHeight));
    S.scrollGoal = { top: target, until: Date.now() + 900 };
    vp.scrollTo({ top: target, behavior: reduced() ? 'auto' : 'smooth' });
    return true;
  }

  /** API ile tetiklenen aksiyonlarda "parmak" dokunuşu: hedef öğe görünür yapılır ve bir dalga çizilir. */
  function tapFx(el) {
    if (!S.mounted || !el || !el.isConnected) return;
    var moved = revealEl(el, 'center');
    var run = function () {
      if (!el.isConnected) return;
      el.classList.add('is-tapped');
      setTimeout(function () { el.classList.remove('is-tapped'); }, 280);
      if (reduced()) return;
      var lr = S.el.layer.getBoundingClientRect(), er = el.getBoundingClientRect();
      if (!er.width) return;
      var dot = h('span', { class: 'dv-tap', 'aria-hidden': 'true', style: { left: (er.left + er.width / 2 - lr.left) + 'px', top: (er.top + er.height / 2 - lr.top) + 'px' } });
      S.el.layer.appendChild(dot);
      setTimeout(function () { if (dot.parentNode) dot.parentNode.removeChild(dot); }, 700);
    };
    if (moved && !reduced()) setTimeout(run, 380); else run();
  }

  function flyToCart(fromEl) {
    var E = S.el;
    if (!S.mounted || reduced() || !E.cartTab || typeof Element.prototype.animate !== 'function') return;
    var lr = E.layer.getBoundingClientRect();
    var src = fromEl && fromEl.isConnected ? fromEl.getBoundingClientRect() : E.viewport.getBoundingClientRect();
    var dst = E.cartTab.querySelector('.dv-tab-ico').getBoundingClientRect();
    if (!src.width || !dst.width) return;
    var x0 = src.left + src.width / 2 - lr.left, y0 = src.top + src.height / 2 - lr.top;
    var x1 = dst.left + dst.width / 2 - lr.left, y1 = dst.top + dst.height / 2 - lr.top;
    var dot = h('span', { class: 'dv-fly', 'aria-hidden': 'true', style: { left: x0 + 'px', top: y0 + 'px' } }, '+1');
    E.layer.appendChild(dot);
    var dx = x1 - x0, dy = y1 - y0;
    var anim = dot.animate([
      { transform: 'translate(-50%,-50%) translate(0,0) scale(1)', opacity: 1 },
      { transform: 'translate(-50%,-50%) translate(' + (dx * 0.45) + 'px,' + (dy * 0.45 - 46) + 'px) scale(.95)', opacity: 1, offset: 0.5 },
      { transform: 'translate(-50%,-50%) translate(' + dx + 'px,' + dy + 'px) scale(.4)', opacity: 0.4 }
    ], { duration: 680, easing: 'cubic-bezier(.45,0,.35,1)' });
    var done = function () { if (dot.parentNode) dot.parentNode.removeChild(dot); bumpBadge(); };
    anim.onfinish = done;
    anim.oncancel = done;
  }

  /* ==================================================================
   * Gezinme ve aksiyonlar
   * ================================================================== */
  function navigate(page, opts, how) {
    var r = normRoute(page, opts);
    if (!S.mounted) { S.route = r; return how.dispatch ? dispatchAll(actionsFor(routeInfo(r))) : Promise.resolve([]); }
    if (how.push && !sameRoute(S.route, r)) {
      S.history.push(S.route);
      if (S.history.length > 40) S.history.shift();
    }
    S.route = r;
    var slotId = SLOT_OF_PAGE[r.page];
    if (slotId && how.dispatch) S.slots[slotId] = { status: 'idle', ad: null };
    if (r.page !== 'login' && S.loginUi.phase !== 'working') S.loginUi.error = null;
    if (r.page !== 'privacy') S.dsarUi.confirm = false;
    if (r.page !== 'cart') S.cartUi.msg = null;
    S.userScrolled = false;
    S.followSel = null;
    S.scrollGoal = null;
    if (S.sheet) closeSheet();
    clearToast();
    renderPage({ transition: true });
    refreshChrome();
    announce((PAGE_NAME[r.page] || '') + ' sayfası açıldı: ' + D.site.domain + routeInfo(r).path);
    if (!how.dispatch) return Promise.resolve([]);
    return dispatchAll(actionsFor(routeInfo(r)));
  }

  function doGo(page, opts, src) {
    opts = opts || {};
    if (!PAGES_OK[page]) {
      try { console.warn('[SIM.device] bilinmeyen sayfa:', page); } catch (e) { /* yut */ }
      return Promise.resolve([]);
    }
    var silent = !!opts.silent;
    if (!silent && src !== 'engine') emitDeviceAction(page === 'product' ? 'product_view' : 'page_view', page);
    return navigate(page, opts, { dispatch: !silent, push: !opts.replace });
  }
  function uiGo(page, opts) { return doGo(page, opts, 'ui'); }

  function onBack() {
    if (!S.history.length) return;
    var prev = S.history.pop();
    emitDeviceAction(prev.page === 'product' ? 'product_view' : 'page_view', prev.page);
    navigate(prev.page, prev, { dispatch: true, push: false });
  }
  function onReload() {
    var r = S.route;
    emitDeviceAction(r.page === 'product' ? 'product_view' : 'page_view', r.page);
    navigate(r.page, r, { dispatch: true, push: false });
  }

  function doConsent(choice, src) {
    if (!CHOICES[choice]) {
      try { console.warn('[SIM.device] geçersiz rıza seçimi:', choice, '→ all'); } catch (e) { /* yut */ }
      choice = 'all';
    }
    emitDeviceAction('consent');
    if (S.mounted && S.banner.open && S.el.bannerNodes) {
      var b = S.el.bannerNodes[1].querySelector('[data-choice="' + choice + '"]');
      if (b) {
        b.classList.add('is-chosen');
        if (src === 'api') tapFx(b);
      }
      setTimeout(closeBanner, reduced() ? 0 : (src === 'api' ? 420 : 160));
    } else {
      S.banner.open = false;
    }
    var info = routeInfo(S.route);
    if (info.slot && S.slots[info.slot]) { S.slots[info.slot] = { status: 'idle', ad: null }; renderSlot(info.slot, false); }
    var list = [dispatch({ type: 'consent', choice: choice })].concat(actionsFor(info).map(dispatch));
    return Promise.all(list).then(function (res) { return res[0]; });
  }

  function doLogin(email, src) {
    email = (email == null || String(email).trim() === '') ? D.demoUser.email : String(email).trim();
    emitDeviceAction('login');
    if (S.mounted && S.route.page !== 'login') navigate('login', {}, { dispatch: false, push: true });
    var L = S.loginUi;
    L.phase = 'working'; L.email = email; L.localHash = null; L.revealed = false; L.error = null; L.draft = email;
    if (S.mounted) {
      renderPage({ keepScroll: true });
      if (src === 'api') tapFx(S.el.page.querySelector('.dv-login-submit'));
    }
    U.sha256Hex(email.toLowerCase()).then(function (hex) {
      if (S.loginUi.email !== email || S.loginUi.phase !== 'working') return;
      S.loginUi.localHash = hex;
      scheduleRefresh();
    });
    return dispatch({ type: 'login', email: email }).then(function (res) {
      if (S.loginUi.email === email) S.loginUi.phase = 'idle';
      scheduleRefresh();
      var u = userState();
      if (res && res.ok !== false && u.loggedIn) toast('Giriş yapıldı', u.displayName ? 'Hoş geldiniz, ' + u.displayName : email);
      return res;
    });
  }

  function doAddToCart(sku, src) {
    if (!sku) sku = (S.route.page === 'product' ? S.route.sku : null) || (D.products[0] && D.products[0].sku);
    var p = D.productBySku[sku];
    if (!p) {
      try { console.warn('[SIM.device] bilinmeyen ürün:', sku); } catch (e) { /* yut */ }
      return Promise.resolve({ ok: false, reason: 'bilinmeyen ürün' });
    }
    emitDeviceAction('add_to_cart');
    var action = { type: 'add_to_cart', sku: p.sku };
    var opt = { sku: p.sku, action: action };
    S.optimistic.push(opt);
    if (S.mounted) {
      var onPage = S.route.page === 'product' && S.route.sku === p.sku;
      var buyBtn = onPage ? S.el.page.querySelector('.dv-buy') : null;
      if (buyBtn && src === 'api') tapFx(buyBtn);
      flyToCart(buyBtn);
      S.productUi = { added: p.sku, t: Date.now() };
      refreshChrome();
      if (S.route.page === 'product' || S.route.page === 'cart') renderPage({ keepScroll: true });
      setTimeout(function () { if (S.productUi.added === p.sku) scheduleRefresh(); }, 1900);
      toast('Sepete eklendi', p.name);
    }
    return dispatch(action).then(function (res) {
      removeOptimistic(opt);
      scheduleRefresh();
      return res;
    });
  }
  function removeOptimistic(opt) {
    var i = S.optimistic.indexOf(opt);
    if (i >= 0) S.optimistic.splice(i, 1);
  }

  function doPurchase(src) {
    emitDeviceAction('purchase');
    if (S.mounted && S.route.page !== 'cart') navigate('cart', {}, { dispatch: false, push: true });
    var btnEl = S.mounted ? S.el.page.querySelector('.dv-checkout') : null;
    if (btnEl && src === 'api') tapFx(btnEl);
    S.cartUi = { phase: 'working', msg: null };
    var start = function () { if (S.mounted) renderPage({ keepScroll: true }); };
    if (btnEl && src === 'api' && !reduced()) setTimeout(function () { if (S.cartUi.phase === 'working') start(); }, 300); else start();
    return dispatch({ type: 'purchase' }).then(function (res) {
      S.cartUi = { phase: 'idle', msg: res && res.ok === false && !res.cancelled ? (res.reason === 'sepet boş' ? 'empty' : 'error') : null };
      if (S.mounted) {
        if (S.route.page === 'cart') renderPage({ keepScroll: true });
        refreshChrome();
        var u = userState();
        if (res && res.ok && u.lastOrder) toast('Siparişiniz alındı', u.lastOrder.orderId + ' · ' + tl(u.lastOrder.revenueTL));
      }
      return res;
    });
  }

  function doClickAd(src, el) {
    emitDeviceAction('ad_click');
    var slotId = SLOT_OF_PAGE[S.route.page];
    var adEl = el || (slotId && S.mounted ? S.el.page.querySelector('.dv-ad[data-slot="' + slotId + '"] .dv-ad-click') : null);
    if (adEl && src === 'api') tapFx(adEl);
    var ad = userState().lastAd || (slotId && S.slots[slotId] && S.slots[slotId].ad) || null;
    var cr = ad && ad.creative ? ad.creative : null;
    var landing = (cr && cr.landing) || {};
    if (S.mounted) {
      if (!ad) toast('Tıklanacak reklam yok', 'Önce bir reklam gösterilmeli.');
      else if (!landing.sku && !landing.page) toast('Reklamveren sitesi açılıyor', (cr.adomain || landing.title || 'reklamveren') + ' · /clk ile yönlendirme (simülasyon)');
    }
    var col = [];
    S.collectors.push(col);
    return dispatch({ type: 'ad_click' }).then(function (res) {
      var i = S.collectors.indexOf(col);
      if (i >= 0) S.collectors.splice(i, 1);
      return Promise.all(col).then(function () { return res; });
    });
  }

  function doDsar(src) {
    emitDeviceAction('dsar_delete');
    if (S.mounted && S.route.page !== 'privacy') navigate('privacy', {}, { dispatch: false, push: true });
    S.dsarUi = { phase: 'working', confirm: false };
    S.followSel = '.dv-dsar';
    if (S.mounted) {
      renderPage({ keepScroll: true });
      var b = S.el.page.querySelector('.dv-dsar-btn');
      if (b && src === 'api') tapFx(b); else revealEl(S.el.page.querySelector('.dv-data-card'), 'nearest');
    }
    return dispatch({ type: 'dsar_delete' }).then(function (res) {
      S.dsarUi = { phase: 'idle', confirm: false };
      if (S.mounted) {
        if (S.route.page === 'privacy') renderPage({ keepScroll: true });
        refreshChrome();
        if (res && res.ok) toast('Verileriniz silindi', DSAR_ORDER.length + '/' + DSAR_ORDER.length + ' depo · talep ' + ((res.dsar && res.dsar.id) || ''));
      }
      return res;
    });
  }

  /* ==================================================================
   * Motor olayları
   * ================================================================== */
  function onAdLoading(p) {
    if (!p || !S.slots[p.slot]) return;
    S.slots[p.slot] = { status: 'loading', ad: null };
    if (SLOT_OF_PAGE[S.route.page] === p.slot) {
      var unit = renderSlot(p.slot, false);
      if (unit && !S.userScrolled) revealEl(unit, 'nearest');
    }
  }
  function onAdRendered(p) {
    if (!p || !S.slots[p.slot]) return;
    S.slots[p.slot] = { status: 'rendered', ad: p };
    if (SLOT_OF_PAGE[S.route.page] === p.slot) {
      var unit = renderSlot(p.slot, true);
      if (unit && !S.userScrolled) revealEl(unit, 'nearest');
    }
  }
  function onNavigate(p) {
    if (!p || !PAGES_OK[p.page]) return;
    var prom = doGo(p.page, { articleId: p.articleId, sku: p.sku }, 'engine');
    S.collectors.forEach(function (c) { c.push(prom); });
  }
  var STATE_KEYS = { user: 1, consent: 1, dsar: 1, profiles: 1, idmap: 1 };
  function onState(p) {
    var keys = (p && p.keys) || [];
    var hit = false;
    for (var i = 0; i < keys.length; i++) if (STATE_KEYS[keys[i]]) { hit = true; break; }
    if (!hit) return;
    if (S.banner.open && S.banner.mode === 'initial' && consentState().status !== 'unknown') closeBanner();
    scheduleRefresh();
  }
  function onFlowStart(p) {
    var a = p && p.action;
    if (!a || a.type !== 'add_to_cart' || !S.optimistic.length) return;
    var idx = -1;
    for (var i = 0; i < S.optimistic.length; i++) { if (S.optimistic[i].action === a) { idx = i; break; } }
    if (idx < 0) for (var j = 0; j < S.optimistic.length; j++) { if (S.optimistic[j].sku === a.sku) { idx = j; break; } }
    if (idx >= 0) S.optimistic.splice(idx, 1);
    scheduleRefresh();
  }
  function onBusy(p) {
    S.busy = !!(p && p.busy);
    if (!S.mounted) return;
    S.el.chrome.classList.toggle('is-busy', S.busy);
    S.el.reload.setAttribute('aria-busy', S.busy ? 'true' : 'false');
  }
  function onReset() {
    S.history = [];
    S.route = { page: 'home' };
    S.slots = freshSlots();
    S.optimistic = [];
    S.collectors = [];
    S.loginUi = { phase: 'idle', email: null, localHash: null, revealed: false, error: null, draft: null };
    S.cartUi = { phase: 'idle', msg: null };
    S.dsarUi = { phase: 'idle', confirm: false };
    S.productUi = { added: null, t: 0 };
    if (S.mounted) {
      if (S.sheet) closeSheet();
      clearToast();
      renderPage({});
      refreshChrome();
      openBanner('initial', false);
    } else {
      S.banner = { open: true, mode: 'initial' };
    }
    dispatch({ type: 'visit' });
  }

  function tickClock() {
    if (!S.mounted) return;
    var t = U.fmtTime(U.nowSim()).slice(0, 5);
    if (t !== S.lastTime) { S.lastTime = t; S.el.time.textContent = t; }
  }

  /* ==================================================================
   * Genel API
   * ================================================================== */
  function mount(rootEl) {
    U = SIM.util; D = SIM.data; bus = SIM.bus;
    if (!U || !D || !bus) { console.error('[SIM.device] core.js / data.js yüklenmemiş.'); return; }
    rootEl = rootEl || document.getElementById('device-root');
    if (!rootEl) { console.error('[SIM.device] mount: kök öğe yok.'); return; }
    if (S.mounted) unmount();
    S.root = rootEl;
    S.el = {};
    U.clear(rootEl);
    build(rootEl);
    S.mounted = true;

    S.unsub.push(bus.on('ad:loading', onAdLoading));
    S.unsub.push(bus.on('ad:rendered', onAdRendered));
    S.unsub.push(bus.on('device:navigate', onNavigate));
    S.unsub.push(bus.on('state', onState));
    S.unsub.push(bus.on('reset', onReset));
    S.unsub.push(bus.on('busy', onBusy));
    S.unsub.push(bus.on('flow:start', onFlowStart));
    var timer = setInterval(tickClock, 1000);
    S.unsub.push(function () { clearInterval(timer); });

    renderPage({});
    refreshChrome();
    tickClock();
    var e = engine();
    if (e && typeof e.isBusy === 'function') onBusy({ busy: e.isBusy() });

    if (!S.visitSent) {
      S.visitSent = true;
      if (consentState().status === 'unknown') {
        openBanner('initial', false);
        dispatch({ type: 'visit' });
      } else {
        dispatch({ type: 'visit' });
        dispatchAll(actionsFor(routeInfo(S.route)));
      }
    } else if (S.banner.open) {
      openBanner(S.banner.mode, false);
    }
  }

  function unmount() {
    S.unsub.forEach(function (fn) { try { fn(); } catch (e) { /* yut */ } });
    S.unsub = [];
    if (S.ro) { try { S.ro.disconnect(); } catch (e) { /* yut */ } S.ro = null; }
    clearTimeout(S.toastT);
    clearTimeout(S.refreshT); S.refreshT = 0;
    S.urlTok++;
    if (S.root) { U.clear(S.root); S.root.classList.remove('dv-host'); }
    S.mounted = false;
    S.sheet = null;
  }

  SIM.device = {
    mount: mount,
    /** go(page, {articleId}|{sku}) → page_view/product_view (+ ad_request) dispatch eder. Ek: {silent:true} yalnızca gezinir. */
    go: function (page, opts) { return doGo(page, opts, 'api'); },
    acceptConsent: function (choice) { return doConsent(choice || 'all', 'api'); },
    login: function (email) { return doLogin(email, 'api'); },
    addToCart: function (sku) { return doAddToCart(sku, 'api'); },
    purchase: function () { return doPurchase('api'); },
    clickAd: function () { return doClickAd('api', null); },
    requestDsar: function () { return doDsar('api'); },
    // Ekler
    openConsent: function () { openBanner('reopen', false); },
    route: function () { var r = S.route; var info = routeInfo(r); return { page: r.page, articleId: r.articleId || null, sku: r.sku || null, path: info.path, slot: info.slot }; },
    isBannerOpen: function () { return !!S.banner.open; },
    unmount: unmount,
    _internal: { buildCreative: function (ad, slotId) { return buildCreative(ad, slotId); }, slots: function () { return S.slots; }, state: S }
  };
})(window.SIM);

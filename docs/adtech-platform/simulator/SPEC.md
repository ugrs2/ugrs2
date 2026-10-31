# Reklam Altyapısı Simülatörü — Teknik Şartname (SPEC)

Bu dosya, `docs/adtech-platform/` altındaki mimarinin **etkileşimli, animasyonlu bir sunum sitesi** olarak nasıl kodlanacağını tanımlar. Modüller farklı kişiler/ajanlar tarafından paralel yazılır; **bu dosyadaki isimler, kimlikler, olay adları ve veri şekilleri sözleşmedir** — değiştirmeyin, yalnızca ekleyin.

## 0. Amaç ve kullanıcı deneyimi

- Sunucu (kullanıcı) bu siteyi toplantıda projeksiyonda **ve** telefonda açıp mimariyi anlatacak.
- Sol tarafta kurgusal bir yayıncı sitesi (**Gündem+**, `gundem.example`) telefon çerçevesi içinde çalışır: ziyaretçi siteye girer, KVKK rıza banner'ını yanıtlar, haber okur, ürüne bakar, sepete ekler, giriş yapar, reklam görür, reklama tıklar, verilerinin silinmesini ister.
- Ortada **metro haritası** estetiğinde bir mimari haritası vardır: bileşenler "istasyon", veri akışları renkli "hat"lardır. Ziyaretçinin her aksiyonu, hat üzerinde hareket eden etiketli **paketler** (ör. `page_view`, `BidRequest`, `imp`) olarak istasyondan istasyona gider: Edge → Kafka → Flink → Identity → Aerospike → Segment ...
- Sağda **sistem içi görünüm** (inspector): Kafka mesajları, Aerospike profil kaydı, reklam kararı izi (adaylar, teklifler, açık artırma, gecikme şelalesi), ClickHouse raporları, kampanya yönetimi, clean room sonuçları, istasyon detayları.
- Hız ayarı, duraklat, **adım adım mod** (sunum için), arka plan trafiği, ve 8 bölümlük **Sunum Turu** (otomatik senaryo).
- Arayüz dili **Türkçe**. Gerçek marka/şirket adı kullanılmaz; tüm reklamveren, partner ve site adları kurgusaldır, alan adları `.example` uzantılıdır.

## 1. Dosyalar ve sahiplik

```
docs/adtech-platform/simulator/
  index.html            [foundation]   iskelet DOM, font linkleri, script/css sırası
  css/base.css          [foundation]   token'lar, tema, yerleşim, ortak bileşenler
  css/diagram.css       [diagram]
  css/device.css        [device]
  css/inspector.css     [inspector]
  css/controls.css      [integration]
  js/core.js            [foundation]   SIM.bus, SIM.util, SIM.settings
  js/data.js            [foundation]   SIM.data (tüm statik içerik)
  js/engine.js          [engine]       SIM.engine, SIM.state  (DOM'a DOKUNMAZ)
  js/diagram.js         [diagram]      SIM.diagram
  js/device.js          [device]       SIM.device
  js/inspector.js       [inspector]    SIM.inspector
  js/controls.js        [integration]  SIM.controls (üst bar, aksiyon çubuğu, anlatım şeridi)
  js/tour.js            [integration]  SIM.tour
  js/main.js            [integration]  açılış (boot) ve bağlama
  tools/bundle.mjs      [integration]  tek dosyalık sürüm üretir (dist/simulator.html)
```

Kurallar:
- **Klasik script** (`<script src defer>`), ES module **yok** — sayfa `file://` üzerinden de çalışmalı. Yükleme sırası: `core, data, engine, diagram, device, inspector, controls, tour, main`.
- Harici JS kütüphanesi **yok**. Yalnızca Google Fonts: `Barlow Condensed` (500,600,700), `IBM Plex Sans` (400,500,600), `IBM Plex Mono` (400,500). Fallback yığınları tanımlı olmalı.
- Her modül yalnızca kendi dosyalarına yazar. Global ad alanı: `window.SIM`. Her dosya `window.SIM = window.SIM || {}` ile başlar.
- Uzak resim/fetch yok. İkonlar inline SVG veya CSS.
- `alert/confirm/prompt` yok (sandbox'ta çalışmaz). Formlar `preventDefault` ile.
- Tarayıcı depolaması gerekmiyor; kullanılırsa try/catch içinde ve yalnızca kolaylık için.

## 2. DOM iskeleti (index.html — sabit id'ler)

```html
<body>
  <div id="app" class="app">
    <header id="topbar" class="topbar">
      <div class="brand">…başlık + hat rozetleri…</div>
      <div id="tour-controls"></div>      <!-- integration doldurur -->
      <div id="sim-controls"></div>       <!-- integration doldurur: hız, duraklat, adım modu, arka plan trafiği, sıfırla -->
    </header>
    <main class="stage">
      <section id="device-pane" class="pane pane-device" aria-label="Simüle edilen yayıncı sitesi">
        <div id="device-root"></div>
      </section>
      <section id="map-pane" class="pane pane-map" aria-label="Veri akış haritası">
        <div id="map-legend"></div>
        <div id="diagram-root"></div>
        <div id="narration" class="narration" aria-live="polite"></div>
      </section>
      <section id="inspector-pane" class="pane pane-inspector" aria-label="Sistem içi görünüm">
        <div id="inspector-root"></div>
      </section>
    </main>
    <nav id="action-bar" class="action-bar" aria-label="Ziyaretçi aksiyonları"></nav>
    <div id="tour-overlay"></div>
  </div>
</body>
```

Yerleşim (base.css):
- **≥ 1180px:** üst bar; altında `action-bar` tam genişlik bir satır; sahne 3 sütun: `360px | 1fr | 420px`, yükseklik ekranı doldurur (`height:100%` zinciri), her pane kendi içinde kayar.
- **820–1179px:** cihaz + harita yan yana (`340px | 1fr`), inspector altta tam genişlik.
- **< 820px (telefon):** tek sütun, sıra: üst bar (kompakt) → cihaz (max ~520px) → harita → inspector. `action-bar` **ekranın altına sabit** (yatay kayan çipler), `body` alt dolgusu buna göre. Sayfa yatay kaymaz; 16px kenar boşluğu.
- `prefers-reduced-motion`'a saygı: animasyonlar kısalır/kapanır (bkz. diagram).

## 3. Görsel tasarım (base.css token'ları)

Fikir: **metro haritası / şehir içi hat tabelası.** Bileşenler istasyon, akışlar renkli hat; başlıklar tabela harfi (Barlow Condensed), veri mono font.

```css
:root {
  /* yerleşim fikri: üç pano — site | metro haritası | sistem içi */
  --bg: #eceff3;  --surface: #ffffff;  --surface-2: #f5f7f9;
  --ink: #131922; --muted: #5a6573; --rule: #d3d9e0;
  --line-dmp: #7a3fe0; --line-ad: #1d6bd3; --line-measure: #0d8f83;
  --line-cleanroom: #d23a3a; --line-privacy: #c97a00; --line-control: #5a6878;
  --ok: #1a8f4c; --warn: #c27c00; --bad: #c8322f;
  --font-display: "Barlow Condensed", "Arial Narrow", "Roboto Condensed", sans-serif;
  --font-body: "IBM Plex Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --radius: 10px;
}
```
- Koyu tema: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` **ve** `:root[data-theme="dark"] {…}` içinde aynı token'lar yeniden tanımlanır (`--bg:#0c1219; --surface:#141c26; --surface-2:#1a2430; --ink:#e7ecf2; --muted:#93a0af; --rule:#283442;` hat renkleri bir ton açık: `#a07cff, #4d93ff, #27c0b1, #ff6767, #f2ac35, #8e9cad`), `color-scheme: dark`.
- `body` arka planı `var(--bg)`. Tüm renkler token'dan.
- Hat rozetleri: kare köşeli, hat renginde zemin, beyaz harf (D, A, Ö, C, R, K) — metro hat numarası gibi. Üst barda yan yana durur.
- Odak halkası görünür (`:focus-visible`), dokunma hedefleri ≥ 40px.
- Ortak sınıflar (base.css sağlar, modüller kullanır): `.btn`, `.btn-primary`, `.btn-ghost`, `.chip`, `.chip[data-line=dmp|ad|measure|cleanroom|privacy|control]`, `.line-badge[data-line=…]`, `.tabs`, `.tab[aria-selected=true]`, `.card`, `.kv` (anahtar-değer listesi), `.mono`, `.pill-ok/.pill-warn/.pill-bad`, `.sr-only`. Hat rengine erişim: `[data-line=dmp]{--lc:var(--line-dmp)}` vb. → bileşenler `var(--lc)` kullanır.

## 4. core.js — `SIM.bus`, `SIM.util`, `SIM.settings`

```js
SIM.settings = {
  speed: 1,            // 0.5 | 1 | 2 | 4
  paused: false,
  stepMode: false,     // true iken her hop öncesi SIM.util.gate() "İleri" bekler
  ambient: true,       // arka plan trafiği
  autoScroll: true,    // telefonda aksiyon sonrası haritaya kaydır
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
};
SIM.setSetting(key, value)  // değiştirir + bus.emit('settings', {key, value})

SIM.bus.on(evt, fn) -> unsubscribe()   SIM.bus.off(evt, fn)   SIM.bus.emit(evt, payload)
// emit, dinleyici hatalarını yakalar ve console.error ile raporlar (bir modülün hatası diğerlerini durdurmaz)

SIM.util = {
  wait(ms) -> Promise          // ms / speed kadar *duraklatılmamış* süre bekler; paused iken ilerlemez
  gate() -> Promise            // stepMode kapalıysa hemen çözülür; açıksa bus 'step:next' gelene kadar bekler
                               // beklerken bus.emit('step:waiting', true), çözülünce ('step:waiting', false)
  uid(prefix) -> string        // 'P-7Q2K' gibi kısa, okunur kimlik (Crockford base32, 4-6 karakter)
  sha256Hex(str) -> Promise<string>  // crypto.subtle varsa onu, yoksa saf JS SHA-256 fallback (fallback ŞART)
  shortHash(hex) -> 'a3f9…c41e'      // ilk 4 + … + son 4
  fmtInt(n) -> '1.234.567'           // tr-TR
  fmtTL(n, digits=2) -> '85,00 ₺'    // tr-TR
  fmtPct(x, digits=1) -> '%0,6'      // Türkçe yüzde biçimi (önde %)
  fmtMs(ms) -> '1,2 ms' / '118 ms'
  clamp(x,a,b), rand(a,b) (float), randInt(a,b), pick(arr), seeded(seed) -> () => [0,1)
  el(tag, attrs, ...children) -> HTMLElement   // küçük DOM yardımcısı (class, dataset, on* destekli)
  svg(tag, attrs, ...children) -> SVGElement
  nowSim() -> number             // SIM.state.simNow varsa onu, yoksa Date.now()
  fmtTime(ts) -> '10:04:31'       // Europe/Istanbul
};
```

## 5. data.js — `SIM.data` (statik içerik)

### 5.1 Hatlar
```js
lines: {
  dmp:       { id:'dmp',       code:'D', name:'Veri Hattı',          desc:'Davranış verisi → profil ve segment' },
  ad:        { id:'ad',        code:'A', name:'Reklam Hattı',        desc:'Reklam isteği → karar → açık artırma' },
  measure:   { id:'measure',   code:'Ö', name:'Ölçüm Hattı',         desc:'Gösterim/tıklama → rapor, pacing, fcap' },
  cleanroom: { id:'cleanroom', code:'C', name:'Clean Room Hattı',    desc:'Partner verisiyle gizlilik korumalı eşleşme' },
  privacy:   { id:'privacy',   code:'R', name:'Rıza & Gizlilik Hattı', desc:'Rıza sinyali ve silme talepleri' },
  control:   { id:'control',   code:'K', name:'Kontrol Hattı',       desc:'Kampanya ayarı → config → ad server' }
}
```

### 5.2 Bölgeler (zones)
`client: 'İstemci'`, `edge: 'Edge'`, `backbone: 'Event Backbone'`, `dmp: 'DMP'`, `ad: 'Ad Server'`, `analytics: 'Analitik'`, `cleanroom: 'Data Clean Room'`, `control: 'Kontrol Düzlemi'`, `privacy: 'Gizlilik'`.
Şekil: `zones: { client: { id:'client', label:'İstemci' }, … }`

### 5.3 İstasyonlar (nodes) — id'ler sabittir
Şekil: `{ id, label, sub, zone, hub?:bool, external?:bool, detail:{ what, why, tech, latency, scale, docs } }`
`detail` alanları 1–3 cümlelik Türkçe metinlerdir ve `docs/adtech-platform/*.md` ile tutarlı olmalıdır; `docs` ilgili md dosya adıdır (ör. `'02-ad-server.md'`).

| id | label | sub | zone | not |
|----|-------|-----|------|-----|
| browser | Tarayıcı | ziyaretçi cihazı | client | hub |
| cmp | CMP | KVKK rıza | client | |
| gateway | Edge Gateway | LB + WAF | edge | |
| collector | Collector | olay toplama | edge | |
| adapi | Ad API | reklam isteği | edge | |
| tracking | Tracking | imp / click | edge | |
| kafka | Kafka | event omurgası | backbone | hub |
| flink | Flink | stream işleme | backbone | hub |
| identity | Identity Graph | kimlik çözümleme | dmp | |
| profile | Profil Deposu | Aerospike | dmp | hub |
| segment | Segment Motoru | kural + batch | dmp | |
| activation | Aktivasyon | DSP · Meta · Google | dmp | |
| decision | Karar Motoru | < 30 ms | ad | hub |
| tindex | Targeting Index | bellek içi | ad | |
| fcap | Fcap + Pacing | filtreler | ad | |
| ml | ML Skor | pCTR · pCVR | ad | |
| auction | Açık Artırma | first-price | ad | |
| prebid | Prebid Server | header bidding | ad | |
| dsp | DSP'ler | OpenRTB 2.6 | ad | external |
| cdn | Kreatif CDN | display · VAST | ad | |
| clickhouse | ClickHouse | raporlar | analytics | |
| iceberg | Iceberg | lakehouse | analytics | |
| pacer | Pacing Kontrol | PID · 10 sn | analytics | |
| partner | Partner | Perakendeci X | cleanroom | external |
| dcr | Clean Room | TEE eşleştirme | cleanroom | |
| policy | Politika + DP | k ≥ 50 · ε | cleanroom | |
| admin | Admin UI | kampanya | control | |
| postgres | PostgreSQL | kontrol DB | control | |
| config | Config Stream | CDC → pod'lar | control | |
| privacy | Gizlilik Portalı | DSAR | privacy | |

### 5.4 Bağlantılar (edges) — id = `from-to`
Şekil: `{ id, from, to, lines:[lineId…], label }`. Paketler kenar üzerinde **her iki yönde** gidebilir. Motor yalnızca bu listedeki çiftler arasında `travel` çağırır.

| id | lines | label |
|----|-------|-------|
| cmp-browser | privacy | rıza banner'ı / TC string |
| browser-gateway | dmp, ad | HTTPS |
| gateway-collector | dmp | olay |
| gateway-adapi | ad | ad request |
| browser-tracking | measure | beacon |
| collector-kafka | dmp | raw.web_events |
| tracking-kafka | measure | ad.events |
| kafka-flink | dmp, measure, privacy | tüketim |
| flink-identity | dmp | kimlik çözümleme |
| identity-profile | dmp, ad, privacy | idmap |
| flink-segment | dmp | kural değerlendirme |
| segment-profile | dmp, cleanroom | üyelik yaz |
| flink-iceberg | dmp, measure, privacy | arşiv |
| flink-clickhouse | measure, privacy | rapor satırı |
| flink-pacer | measure | harcama sayacı |
| flink-profile | measure, privacy | fcap sayacı |
| adapi-decision | ad | karar isteği |
| decision-identity | ad | id → person |
| decision-profile | ad | profil oku |
| decision-tindex | ad | aday sorgusu |
| decision-fcap | ad | filtre |
| pacer-fcap | measure | throttle oranı |
| decision-ml | ad | skor |
| decision-prebid | ad | BidRequest |
| prebid-dsp | ad | OpenRTB |
| decision-auction | ad | direct adaylar |
| prebid-auction | ad | teklifler |
| auction-cdn | ad | kazanan kreatif |
| cdn-browser | ad | reklam yanıtı |
| decision-kafka | ad | ad.decisions (async) |
| segment-activation | dmp | segment push |
| activation-dsp | dmp | hashed kitle |
| iceberg-dcr | cleanroom | maruz kalma |
| partner-dcr | cleanroom | hash'li CRM |
| dcr-policy | cleanroom | eşleşen küme |
| policy-segment | cleanroom | opak segment |
| policy-partner | cleanroom | agrega rapor |
| admin-postgres | control | UPDATE |
| postgres-config | control | CDC delta |
| config-decision | control | snapshot swap |
| config-tindex | control | indeks yenile |
| clickhouse-admin | control | rapor sorgusu |
| browser-privacy | privacy | silme talebi |
| privacy-identity | privacy | kimlikleri bul |
| privacy-kafka | privacy | privacy.dsar |
| privacy-dcr | privacy | collab'dan çıkar |
| privacy-activation | privacy | ortaklardan sil |

### 5.5 Segmentler
Şekil: `{ id, name, kind:'realtime'|'batch'|'crm'|'clean_room'|'behavioral', line, rule, ttlDays, exportable, estimate }`
| id | name | kind | rule (insan okunur) | estimate |
|----|------|------|------|----------|
| 1001 | Otomobil İlgilisi – Sıcak | realtime | 7 gün içinde ≥ 2 otomobil içeriği/ürünü görüntüleme | 1840000 |
| 1002 | Teknoloji Meraklısı | realtime | 30 gün içinde ≥ 1 teknoloji içeriği/ürünü | 2930000 |
| 1003 | Sepeti Terk Eden | realtime | sepete ekleme var, 24 saat içinde satın alma yok | 412000 |
| 1004 | Alıcı – Son 30 Gün | realtime | 30 gün içinde satın alma | 618000 |
| 1005 | Reklama Tıklayan | behavioral | son 14 günde reklam tıklaması | 351000 |
| 1006 | Finans Okuru | realtime | 30 gün içinde ≥ 1 ekonomi içeriği | 1270000 |
| 2001 | Anne-Bebek İlgilisi | batch | mobil uygulamada son 90 gün bebek kategorisi (gece batch) | 982000 |
| 2002 | Sadakat: Gold | crm | CRM onboarding, sadakat seviyesi = gold | 121000 |
| 9001 | CR · Perakendeci X Bebek Ürünü Alıcıları | clean_room | clean room eşleşmesi; dışa aktarılamaz | 0 (çalıştırınca dolar) |

### 5.6 Line item'lar (kampanyalar) — markalar kurgusaldır
Şekil:
```js
{ id, name, advertiser, type:'sponsorship'|'standard'|'preferred_deal'|'price_priority'|'house', priority,
  pricing:'CPM'|'CPC'|'CPA', rate /* TL: CPM için 1000 gösterim başı, CPC tık başı, CPA dönüşüm başı */,
  targeting:{ segments:[…], contexts:[…], requiresConsent:bool },
  fcap:{ max, windowH } | null, goal:{ type:'impressions', qty } | null, budgetTL | null, pacing:'even'|'asap',
  baseCtr, baseCvr, seed:{ delivered, spentTL, clicks, conversions }, throttle /* 0..1, pacing izin olasılığı */,
  status:'active'|'paused',
  creative:{ brand, headline, body, cta, theme /* css tema anahtarı */, landing:{ title, sku? } } }
```
| id | name | advertiser | type/prio | pricing | rate | hedefleme | fcap | not |
|----|------|-----------|-----------|---------|------|-----------|------|-----|
| 101 | Volta e-SUV Lansman | Volta Otomotiv | standard / 4 | CPM | 85 | seg 1001 | 3 / 24s | goal 1.000.000 imp, seed delivered 412.300, throttle 0.78, garantili → gölge fiyat |
| 102 | Minik Adımlar – CR Kitlesi | Minik Adımlar | preferred_deal / 8 | CPM | 120 | seg 9001 | 4 / 24s | budget 250.000 TL |
| 103 | Nova 14 Dizüstü – Performans | TeknoPark | price_priority / 12 | CPC | 4.5 | seg 1002 | 5 / 24s | baseCtr 0.006 |
| 104 | Sepetim Geri Dönüş | Sepetim | price_priority / 12 | CPA | 60 | seg 1003 | 6 / 24s | baseCtr 0.009, baseCvr 0.04 |
| 105 | Bulut Bank Kredi Kartı | Bulut Bank | price_priority / 12 | CPM | 38 | context: ekonomi, otomobil; rıza gerekmez | — | kontekstüel |
| 106 | Minik Adımlar Sezon | Minik Adımlar | standard / 4 | CPM | 70 | seg 2001 | 3 / 24s | goal 400.000, seed 251.000, throttle 0.64 |
| 199 | Gündem+ Uygulamasını İndir | Gündem+ | house / 16 | CPM | 0 | — | — | doldurma |

### 5.7 Teklifçiler (Prebid Server adaptörleri)
```js
bidders: [
  { id:'alfa',  name:'DSP Alfa',  cpm:[22,48], latencyMs:[35,80],   idBoost:1.7, bidRate:0.9 },
  { id:'beta',  name:'DSP Beta',  cpm:[18,55], latencyMs:[50,105],  idBoost:1.5, bidRate:0.8 },
  { id:'gama',  name:'SSP Gama',  cpm:[15,40], latencyMs:[60,115],  idBoost:1.3, bidRate:0.7 },
  { id:'delta', name:'DSP Delta', cpm:[30,70], latencyMs:[105,190], idBoost:1.6, bidRate:0.85 }   // çoğu zaman timeout
],
bidderTimeoutMs: 120
```

### 5.8 Site içeriği (Gündem+)
```js
site: { name:'Gündem+', domain:'gundem.example' },
slots: { mpu: { id:'mpu', code:'/gundem/makale/mpu', size:'300x250', floorCpm:30 },
         home: { id:'home', code:'/gundem/anasayfa/banner', size:'320x100', floorCpm:22 } },
articles: [
  { id:'a-oto', category:'otomobil',  title:'Elektrikli SUV’larda kış menzili testi',      excerpt:'…', path:'/otomobil/elektrikli-suv-kis-menzili' },
  { id:'a-tek', category:'teknoloji', title:'Yeni nesil dizüstü işlemciler karşılaştırıldı', excerpt:'…', path:'/teknoloji/dizustu-islemci-karsilastirma' },
  { id:'a-eko', category:'ekonomi',   title:'Faiz kararı sonrası piyasalarda ilk gün',       excerpt:'…', path:'/ekonomi/faiz-karari-ilk-gun' },
  { id:'a-beb', category:'anne-bebek',title:'Bebek arabası seçerken 7 ipucu',                excerpt:'…', path:'/anne-bebek/bebek-arabasi-secimi' }
],
products: [
  { sku:'OTO-EV-001', name:'Volta e-SUV Long Range', category:'otomobil',  priceTL:1890000, path:'/pazar/volta-e-suv' },
  { sku:'TEK-LAP-014', name:'Nova 14 Dizüstü',       category:'teknoloji', priceTL:32999,   path:'/pazar/nova-14' },
  { sku:'BEB-ARB-007', name:'Minik Adımlar Travel Bebek Arabası', category:'anne-bebek', priceTL:8499, path:'/pazar/travel-bebek-arabasi' }
],
categoryLabels: { otomobil:'Otomobil', teknoloji:'Teknoloji', ekonomi:'Ekonomi', 'anne-bebek':'Anne & Bebek' }
```

### 5.9 Demo kimlik ve partner
```js
demoUser: { email:'ayse.yilmaz@posta.example',
            seedPersonId:'P-7Q2K', seedIds:[ { type:'maid', value:'idfa-4C1E-9A7B' } ],
            seedSegments:[2001, 2002], seedAttrs:{ ilkGorulme:'2026-07-14', cihaz:'iOS uygulama' } },
partner: { id:'perakendeci-x', name:'Perakendeci X', records:12400, publisherHems:48000, baseMatches:3180,
           epsilonPerRun:0.5, epsilonBudget:10, k:50, minSegment:1000 }
```
Partner listesi demo e-postasının hash'ini **içerir** (kullanıcı bu e-postayla giriş yaptıysa clean room sonrası 9001 segmentine düşer).

## 6. engine.js — `SIM.engine`, `SIM.state` (DOM'a dokunmaz)

### 6.1 API
```js
SIM.engine = {
  init() -> Promise          // SIM.state'i SIM.data'dan kurar (demo hash'leri için async), arka plan trafiğini başlatır
  reset() -> Promise         // durumu ilk haline döndürür, bus.emit('reset')
  dispatch(action) -> Promise // aksiyonu kuyruğa alır; KENDİ akışı bitince çözülür. Aksiyonlar sırayla işlenir.
  isBusy() -> bool, queueLength() -> number
  decide(ctx) -> trace        // saf karar fonksiyonu (test edilebilir); reklam akışı bunu kullanır
}
```
Ayrıca `bus.on('action', a => SIM.engine.dispatch(a))`.

### 6.2 Aksiyon tipleri (kesin)
```js
{ type:'visit' }                                  // ilk giriş: CMP banner'ı gelir
{ type:'consent', choice:'all'|'necessary'|'reject' }
{ type:'page_view', page:'home'|'article'|'product'|'cart'|'login'|'privacy', articleId?, sku? }
{ type:'product_view', sku }                      // ürün sayfası açıldığında (page_view yerine)
{ type:'add_to_cart', sku }
{ type:'purchase' }                               // sepetteki ürünler
{ type:'login', email }
{ type:'ad_request', slot:'mpu'|'home', category /* sayfa bağlamı */, path }
{ type:'ad_click' }                               // son gösterilen reklam
{ type:'cleanroom_run' }
{ type:'campaign_update', lineItemId, patch:{ status?, rate?, fcapMax? } }
{ type:'dsar_delete' }
{ type:'reset' }
```
Kurallar:
- `consent` durumu `unknown` iken gelen olay aksiyonları (page_view/product_view/add_to_cart/purchase/login/ad_request) **reddedilmez** ama KVKK gereği yalnızca zorunlu işleme yapılır: olay toplanmaz, reklam kontekstüel ve kimliksiz olur; anlatımda belirtilir.
- `ad_request` sonrası motor otomatik olarak gösterim (`imp`) ve ~1 sn sonra görünürlük (`viewable`) ölçüm akışını çalıştırır (aynı dispatch zinciri içinde, ad_request Promise'i bunlar bitince çözülür).
- `ad_click` → ölçüm akışı + reklamın `creative.landing` hedefine göre `bus.emit('device:navigate', {page:'product', sku})` (varsa).
- `purchase` → reklam tıklamasından sonra ise **dönüşüm** olarak atfedilir (ClickHouse'a conversion, CPA line item'ı faturalanır).

### 6.3 Yayınlanan bus olayları (kesin)
```js
'flow:start'      { flowId, action, title, line }
'flow:end'        { flowId, action }
'narrate'         { flowId, text, nodeId?, line?, kind:'info'|'ok'|'warn'|'drop', ts }
'kafka'           { topic, partition, offset, key, value /* obje */, ts }
'state'           { keys:[ 'user'|'consent'|'idmap'|'profiles'|'segments'|'lineItems'|'reports'|'kafka'|'decisions'|'cleanroom'|'dsar'|'config' ] }
'decision'        { trace }
'ad:rendered'     { slot, decisionId, source:'direct'|'prebid'|'house', lineItemId|null, bidder|null, priceCpm, creative }
'ad:loading'      { slot }
'segment:change'  { personId, added:[id], removed:[id] }
'identity:merge'  { from, into, ids:[…] }
'cleanroom:result'{ run }
'device:navigate' { page, articleId?, sku? }
'busy'            { busy:bool, queue:number }
'reset'           {}
```

### 6.4 `SIM.state` şekli (motor yazar, diğerleri yalnızca okur)
```js
{
  simNow,                                   // ms; 2026-10-31T10:00:00+03:00'dan başlar, gerçek zaman × speed ilerler
  user: { personId|null, fpc|null, hem|null, email|null, loggedIn, cart:[sku], lastAd|null, clickedAd|null, suppressed:bool, page },
  consent: { status:'unknown'|'all'|'necessary'|'reject', tcString|null,
             purposes:{ storage, measurement, profiling, personalizedAds }, kvkkExplicit, at|null },
  idmap: { 'fpc:…':'P-…', 'hem:…':'P-…', 'maid:…':'P-…' },
  profiles: { 'P-…': { personId, ids:{ 'fpc:…':ts }, seg:{ 1001: expireTs }, fcap:{ '101':{ count, windowStart } },
                       attrs:{ sehir:'İstanbul', cihaz:'mobil', dil:'tr' }, consent:{…}, counters:{ otomobil:[ts…], … }, ver, createdAt } },
  segments: { 1001:{ …data, estimate } },
  lineItems: { 101:{ …data, delivered, spentTL, clicks, conversions, throttle, status } },
  reports: { totals:{ requests, impressions, viewables, clicks, conversions, revenueTL }, byLineItem:{ 101:{ impressions, clicks, conversions, revenueTL } },
             qps, series:[…son 60 qps] },
  kafka: { offsets:{ topic:n }, log:[ mesaj… (en fazla 150, en yeni sonda) ] },
  decisions: [ trace… (en fazla 20, en yeni sonda) ],
  cleanroom: { epsilonBudget, epsilonUsed, runs:[ run… ] },
  suppression: [ hash… ],
  dsar: [ { id, at, stores:{ profile, idmap, iceberg, clickhouse, cleanroom, partners } } ],
  config: { version }
}
```
Arka plan trafiği (diğer ziyaretçiler): `reports.totals` ve line item `delivered` değerlerini gerçekçi küçük artışlarla büyütür, `qps` ~2.000–3.000 arası dalgalanır; kullanıcının kendi profili/segmentleri etkilenmez. `settings.ambient` false iken durur.

### 6.5 Karar izi (trace) şekli
```js
{ id, at, slot:{ id, size, floorCpm }, context:{ category, path }, personalized:bool, personId|null, segments:[id],
  candidates:[ { lineItemId, name, type, pricing, rate, pCtr, pCvr, ecpm, shadow?:bool,
                 status:'won'|'lost'|'filtered', reason } ],     // reason TR: 'hedefleme uymadı', 'rıza yok', 'fcap 3/3', 'pacing throttle', 'floor altı', 'durduruldu', 'en yüksek eCPM', 'daha düşük eCPM'
  bids:[ { bidder, name, cpm|null, latencyMs, withIds:bool, status:'won'|'lost'|'nobid'|'timeout' } ],
  winner:{ source:'direct'|'prebid'|'house', lineItemId|null, bidder|null, priceCpm, ecpm, reason },
  timings:[ { step, ms, parallel?:bool } ], serverMs, totalMs }
```
Karar kuralları: aday = aktif + hedefleme uyumlu (segment hedefi için kişiselleştirme rızası ve profil şart; kontekst hedefi sayfa kategorisi) → filtre: fcap, pacing (`throttle` olasılığı, istek id'sinden deterministik), bütçe → eCPM: `CPM: rate`, `CPC: rate × pCtr × 1000`, `CPA: rate × pCtr × pCvr × 1000`; garantili (`standard`) için **gölge fiyat** = `rate × (1 + teslimat açığı)`; pCtr = baseCtr × (segment eşleşmesi varsa 1.6). Programatik teklifler kimlikli istekte `idBoost` ile çarpılır; timeout (120 ms) aşan teklif elenir. Kazanan = floor üstü en yüksek eCPM (first-price). Hiçbiri yoksa house.
Gecikme: `Parse + rıza 0,3–0,6 ms`, `ID çözümleme 0,6–1,2`, `Profil okuma 0,8–1,6`, `Targeting index 0,4–0,9`, `Filtreler 0,3–0,6`, `ML skor 1,2–2,2`, `Header bidding (paralel) = min(max teklifçi gecikmesi, 120)`, `Açık artırma 0,2–0,4`, `Kreatif 0,4–0,8`. `serverMs` = paralel olmayanların toplamı (< 10 ms), `totalMs` = serverMs + header bidding.

### 6.6 Akışlar (hop dizileri) — `→` sıralı, `‖` paralel
Her hop: `await SIM.util.gate(); await SIM.diagram.travel({from,to,line,label})` (diagram yoksa `SIM.util.wait(600)`). Her önemli adımda `narrate`.
- **visit:** cmp→browser (`rıza banner'ı`, privacy).
- **consent:** browser→cmp (`karar`) → cmp→browser (`TC string`); `all` ise 1P çerez (`fpc`) yazılır ve rıza kaydı olay olarak: browser→gateway→collector→kafka (`consent_update`) → kafka→flink. `necessary/reject`: çerez yok, yalnızca rıza kaydı (kimliksiz).
- **olay (page_view/product_view/add_to_cart/purchase):** browser→gateway→collector (204) →kafka (`raw.web_events`) →flink (doğrula · rıza · bot · zenginleştir). Profilleme izni yoksa: flink→iceberg (agrega) ve bitir (`kind:'drop'`). Varsa: (flink→identity→profile `idmap`) ‖ (flink→iceberg) → flink→segment (kural) → segment→profile (üyelik değiştiyse `segment:change`) ; `enriched.events` mesajı.
- **login:** tarayıcıda SHA-256 (anlatımda kısa hash) → browser→gateway→collector→kafka (`identity_link {fpc, hem}`) →flink→identity → demo e-postası ise **birleştirme**: tohum kişi `P-7Q2K` (maid + segment 2001, 2002) ile mevcut kişi birleşir (`identity:merge`, `identity.merges` mesajı) → identity→profile. Diğer e-posta: yeni hem mevcut kişiye bağlanır.
- **ad_request:** browser→gateway→adapi→decision → (kişiselleştirme varsa: decision→identity ‖ decision→profile) ‖ (decision→prebid→dsp, sonra dsp→prebid→auction) ; decision→tindex → decision→fcap → decision→ml → decision→auction → auction→cdn → cdn→browser (`ad:rendered`) ; decision→kafka (`ad.decisions`, async). Ardından **ölçüm**.
- **ölçüm (imp/viewable):** browser→tracking (`imp` imzalı URL) →kafka (`ad.events`) →flink (dedup · IVT) → flink→clickhouse ‖ flink→pacer→fcap ‖ flink→profile (fcap +1, yalnızca direct ve kişiselleştirilmiş). Viewable: browser→tracking→kafka→flink→clickhouse.
- **ad_click:** browser→tracking (`/clk 302`) →kafka→flink → flink→clickhouse ‖ (rıza varsa flink→segment→profile: 1005).
- **cleanroom_run:** partner→dcr (`hash'li CRM 12.400`) ‖ iceberg→dcr (`maruz kalma + hem`) → dcr (TEE attestation ✓, eşleşme) → dcr→policy (k ≥ 50 ✓, ε=0,5 gürültü) → policy→partner (agrega rapor) ‖ policy→segment (opak segment 9001) → segment→profile (kullanıcı eşleştiyse).
- **campaign_update:** admin→postgres (`UPDATE line_items`) → postgres→config (`CDC v{n}`) → config→decision ‖ config→tindex; `config.version++`.
- **dsar_delete:** browser→privacy → privacy→identity (kimlikleri bul) → privacy→kafka (`privacy.dsar`) → kafka→flink → flink→profile ‖ flink→iceberg ‖ flink→clickhouse ‖ privacy→dcr ‖ privacy→activation; profil ve idmap silinir, hem/fpc **suppression** listesine eklenir; sonraki olaylar profillenmez.

Kafka konuları ve partition: `raw.web_events`(96), `enriched.events`(96), `ad.decisions`(128), `ad.events`(64), `dmp.segment_changes`(48), `identity.merges`(24), `config.adserver`(12), `privacy.dsar`(12). Partition = anahtarın hash'i mod partition sayısı; offset konu başına artar (gerçekçi büyük başlangıç değerleriyle, ör. 18.204.551).

Mesaj `value`'ları `05-veri-modeli.md`'deki Protobuf `EventEnvelope` şekline benzer JSON'dur (`event_id`, `event_time`, `tenant_id: 42`, `consent{…}`, `identity{…}`, `device{…}`, `context{…}`, ve olay yükü).

## 7. diagram.js — `SIM.diagram`

```js
SIM.diagram = {
  mount(rootEl, legendEl)
  travel({ from, to, line, label, size:'lg'|'sm' }) -> Promise   // paket animasyonu; bitince çözülür
  pulse(nodeId, { line, text })        // istasyon parlaması + kısa yüzen metin ("204", "+1 segment", "✓ k≥50")
  badge(nodeId, text|null)             // kalıcı küçük rozet (ör. Kafka offset, profil sayısı)
  ambient({ path:[nodeId…], line })    // soluk, etiketsiz arka plan paketi (await edilmez)
  focus(nodeIds|null)                  // diğerlerini soldur (tur için)
  setActiveLine(lineId|null)           // bir hattı vurgula (lejanttan tıklanınca da)
  select(nodeId)                       // istasyonu seçili göster
  relayout()                           // boyut değişince yeniden ölçekle
}
// Yayınlar: bus.emit('node:select', { nodeId })   (tıklama / dokunma / Enter)
```
- Tek bir inline `<svg>` (`viewBox` ile ölçeklenir). **İki yerleşim**: yatay (`wide`, en/boy > 1.1) ve dikey (`tall`, telefon). Koordinatlar diagram.js içindedir; konteyner oranına göre seçilir (ResizeObserver).
- Bölgeler: hafif dolgulu, kesik kenarlı, köşeli adlandırılmış alanlar (metro haritasındaki semtler gibi). İstasyonlar: hub'lar beyaz dolgulu kalın halka (aktarma istasyonu), diğerleri hat renginde halka; external istasyonlar kesik halka. Etiket Barlow Condensed, alt satır muted.
- Kenarlar: 45°/90° kırılımlı yollar; birden fazla hattı taşıyan kenar **paralel renkli şeritler** olarak çizilir (metro gibi).
- Paket: hat renginde yuvarlatılmış hap + beyaz etiket (mono, küçük), arkasında kısa iz; `getPointAtLength` ile yol üzerinde hareket; süre ≈ yol uzunluğuna bağlı 450–1100 ms / speed; `paused` iken durur. `reducedMotion`: hareket yok, kenar 300 ms vurgulanır ve hedef pulse olur.
- Tıklanabilir istasyonlar (`role="button"`, `tabindex=0`, `aria-label`), seçili istasyon vurgusu. Lejant (`#map-legend`): hat rozetleri + adları; tıklayınca `setActiveLine`.
- Harita konteyneri telefonda tam genişlik; yatay kaydırma gerekmez (dikey yerleşim).

## 8. device.js — `SIM.device`

```js
SIM.device = {
  mount(rootEl)
  go(page, opts) -> Promise          // { articleId } | { sku }; gezinir + ilgili aksiyonları dispatch eder; akışlar bitince çözülür
  acceptConsent(choice) -> Promise   // 'all' | 'necessary' | 'reject'
  login(email?) -> Promise           // varsayılan demo e-postası
  addToCart(sku) -> Promise, purchase() -> Promise, clickAd() -> Promise, requestDsar() -> Promise
}
```
- Masaüstünde telefon çerçevesi (çentik, tarayıcı adres çubuğu `gundem.example/…`, kilit ikonu). Telefonda çerçevesiz tam genişlik "tarayıcı kartı".
- Sayfalar: **Ana sayfa** (manşetler + 4 kategori + ürün vitrini + `home` reklam alanı), **Makale** (başlık, metin, `mpu` reklam alanı, ilgili ürün), **Ürün** (fiyat, Sepete ekle), **Sepet** (Satın al), **Giriş** (e-posta alanı, demo e-postası önceden dolu; "Giriş yap"), **Gizlilik** (rıza durumu, "Rıza ayarlarını değiştir", "Verilerimi sil").
- İlk açılışta `visit` dispatch edilir ve **KVKK rıza banner'ı** gösterilir: kısa aydınlatma metni + "Tümünü kabul et" / "Yalnızca zorunlu" / "Reddet". Karar verilene kadar diğer aksiyonlar banner'ın arkasında bekler (yine de tıklanırsa motor kurala göre işler).
- Sayfa açılınca: `page_view` (ürün sayfasında `product_view`), reklam alanı varsa ardından `ad_request` (category = sayfa kategorisi, ana sayfada `'anasayfa'`).
- Reklam alanı: `ad:loading` → iskelet animasyonu; `ad:rendered` → kurgusal kreatif (marka, başlık, metin, CTA, "Reklam" etiketi, sağ üstte ⓘ "Neden bu reklam?" → `bus.emit('inspector:show', {tab:'decision'})`). Kreatif tıklanınca `ad_click`. Programatik kazananda "Programatik · DSP Beta" etiketli genel kreatif; house'da Gündem+ uygulama reklamı.
- `device:navigate` olayını dinler. `reset` olayında başa döner (banner tekrar).
- Kendi alt gezinmesi: Ana sayfa · Kategoriler · Sepet (rozet) · Hesap/Giriş · Gizlilik.

## 9. inspector.js — `SIM.inspector`

```js
SIM.inspector = { mount(rootEl), show(tabId), selectNode(nodeId) }
// dinler: tüm motor olayları + 'node:select' + 'inspector:show' {tab}
```
Sekmeler (id → başlık):
- `flow` → **Akış**: anlatım zaman çizelgesi (saat, hat rozeti, istasyon, metin; `kind` renkli işaret), en yeni üstte, akış başlıkları grup ayırıcı.
- `kafka` → **Kafka**: mesaj listesi (konu çipi, `p{partition} · offset`, anahtar, açılır JSON), konu filtresi.
- `profile` → **Profil**: Aerospike kaydı (`dmp/profile` anahtarı, binler) JSON görünümü — son değişen alanlar 2 sn vurgulu; idmap tablosu; **identity graph** mini SVG (kişi düğümü + kimlik düğümleri; birleşmede animasyon); segment çipleri (ad, tür, bitiş tarihi). Profil yoksa nedenini söyler (rıza yok / henüz olay yok / silindi).
- `decision` → **Reklam Kararı**: son karar: özet (slot, bağlam, kişiselleştirme), adaylar tablosu (LI, tür, fiyatlama, eCPM, durum çipi, neden), teklifçiler tablosu (CPM, gecikme çubuğu, timeout çizgisi 120 ms), kazanan kartı, **gecikme şelalesi** (yatay çubuklar; paralel adım ayrı renk). Önceki kararlar arasında geçiş.
- `reports` → **Raporlar** (ClickHouse): özet kutucukları (istek/sn, gösterim, tıklama, CTR, gelir, doluluk), qps sparkline (son 60), line item tablosu (teslimat ilerleme çubuğu, gelir, CTR).
- `campaigns` → **Kampanyalar** (Admin UI): her line item için durum anahtarı, fiyat ve fcap alanları, "Kaydet ve yayınla" → `campaign_update`; config sürümü göstergesi.
- `cleanroom` → **Clean Room**: collaboration özeti (partner, amaç, k, ε bütçesi çubuğu), "Eşleştirmeyi çalıştır" → `cleanroom_run`, son çalıştırma: Venn (yayıncı 48.000 ∩ partner 12.400), gerçek vs DP gürültülü sayı, opak segment kartı (exportable=false), kullanıcının eşleşip eşleşmediği.
- `node` → **İstasyon**: seçili istasyonun `detail` alanları, bağlı hatlar, canlı sayaçlar (ör. Kafka için konu offset'leri, Profil için kayıt sayısı), dokümana referans.
- Telefonda sekmeler yatay kayan çip satırı. Sekme değişince içerik kayması korunur.

## 10. controls.js, tour.js, main.js (integration)

- **Üst bar:** başlık "Reklam Altyapısı Simülatörü", alt başlık "Bir ziyaretçinin verisi DMP, Ad Server ve Clean Room'da nasıl dolaşır?", hat rozetleri. `#sim-controls`: hız (0,5× 1× 2× 4×), Duraklat/Devam, Adım modu + "İleri" (adım beklerken nabız atar; klavye: Boşluk = duraklat, → = ileri), Arka plan trafiği anahtarı, Sıfırla.
- **Aksiyon çubuğu** (`#action-bar`): sık kullanılan aksiyon çipleri, hat renginde: "Rıza ver", "Otomobil haberi oku", "Ürüne bak", "Sepete ekle", "Giriş yap", "Reklama tıkla", "Satın al", "Clean room", "Kampanya güncelle", "Verilerimi sil". Çipler `SIM.device` API'sini çağırır (cihaz ekranı da eşzamanlı değişir). Meşgulken kuyruk sayısı gösterilir.
- **Anlatım şeridi** (`#narration`): son `narrate` metni, hat rozeti ve istasyon adıyla; adım modunda "İleri ▸" butonu burada da görünür.
- **Telefonda otomatik kaydırma:** cihazdan bir aksiyon başlayınca harita görünür değilse yumuşak kaydır; haritanın altında yüzen "↑ Siteye dön" butonu.
- **Sunum Turu** (`#tour-controls` + `#tour-overlay`): 8 bölüm — 1) Ziyaret ve KVKK rızası 2) Davranış → segment 3) Giriş → kimlik birleştirme 4) Reklam isteği ve birleşik açık artırma 5) Gösterim, tıklama, ölçüm 6) Data Clean Room 7) Kampanya güncelleme (kontrol düzlemi) 8) Silme talebi (DSAR). Her bölüm: başlık kartı (kısa açıklama, ilgili hat rozetleri), `diagram.focus` ile ilgili istasyonlar, cihaz API'si ile otomatik aksiyonlar, ilgili inspector sekmesine geçiş. Önceki/Sonraki/Çık; ilerleme göstergesi. URL hash `#tur` ile açılışta turu başlatır.
- **main.js:** `SIM.engine.init()` → mount'lar (`diagram`, `device`, `inspector`, `controls`, `tour`) → hash kontrolü. Herhangi bir modül eksikse diğerleri çalışmaya devam eder (try/catch).
- **tools/bundle.mjs:** `index.html`'i okuyup css/js dosyalarını satır içine gömer → `dist/simulator.html` (tek dosya, `file://` ve barındırma için).

## 11. Kalite ölçütleri
- Konsolda hata yok (1440×900 ve 390×844).
- Açılışta sayfa "dolu" görünür: harita çizili, arka plan trafiği akıyor, cihazda rıza banner'ı, inspector'da örnek içerik (raporlar dolu).
- Tüm metinler Türkçe ve doğru karakterlerle; teknik terimler dokümanla tutarlı.
- Animasyonlar akıcı (requestAnimationFrame), aynı anda 30+ paket takılmadan.
- Klavye ile kullanılabilir; `prefers-reduced-motion` desteklenir; kontrast iki temada da okunur.

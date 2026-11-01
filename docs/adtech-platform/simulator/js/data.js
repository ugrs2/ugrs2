/* data.js — [foundation] SIM.data: tüm statik içerik (SPEC.md §5)
 * Hatlar, bölgeler, istasyonlar (detay metinleriyle), bağlantılar, segmentler, line item'lar,
 * teklifçiler, Gündem+ site içeriği, demo kimlik ve clean room partneri.
 * Tüm marka, partner ve site adları kurgusaldır; alan adları .example uzantılıdır.
 */
if (typeof window === 'undefined') { globalThis.window = globalThis; }
window.SIM = window.SIM || {};

(function (SIM) {
  'use strict';

  var D = {};

  D.tenantId = 42;
  /** Simülasyon saatinin başlangıcı: 2026-10-31T10:00:00+03:00 */
  D.simStart = Date.parse('2026-10-31T10:00:00+03:00');

  /* ------------------------------------------------------------------
   * 5.1 Hatlar
   * ------------------------------------------------------------------ */
  D.lines = {
    dmp:       { id: 'dmp',       code: 'D', name: 'Veri Hattı',            desc: 'Davranış verisi → profil ve segment',            cssVar: '--line-dmp' },
    ad:        { id: 'ad',        code: 'A', name: 'Reklam Hattı',          desc: 'Reklam isteği → karar → açık artırma',           cssVar: '--line-ad' },
    measure:   { id: 'measure',   code: 'Ö', name: 'Ölçüm Hattı',           desc: 'Gösterim/tıklama → rapor, pacing, fcap',         cssVar: '--line-measure' },
    cleanroom: { id: 'cleanroom', code: 'C', name: 'Clean Room Hattı',      desc: 'Partner verisiyle gizlilik korumalı eşleşme',     cssVar: '--line-cleanroom' },
    privacy:   { id: 'privacy',   code: 'R', name: 'Rıza & Gizlilik Hattı', desc: 'Rıza sinyali ve silme talepleri',                 cssVar: '--line-privacy' },
    control:   { id: 'control',   code: 'K', name: 'Kontrol Hattı',         desc: 'Kampanya ayarı → config → ad server',            cssVar: '--line-control' }
  };
  /** Ek: hatların sabit gösterim sırası. */
  D.lineOrder = ['dmp', 'ad', 'measure', 'cleanroom', 'privacy', 'control'];

  /* ------------------------------------------------------------------
   * 5.2 Bölgeler
   * ------------------------------------------------------------------ */
  D.zones = {
    client:    { id: 'client',    label: 'İstemci',          line: null },
    edge:      { id: 'edge',      label: 'Edge',             line: null },
    backbone:  { id: 'backbone',  label: 'Event Backbone',   line: null },
    dmp:       { id: 'dmp',       label: 'DMP',              line: 'dmp' },
    ad:        { id: 'ad',        label: 'Ad Server',        line: 'ad' },
    analytics: { id: 'analytics', label: 'Analitik',         line: 'measure' },
    cleanroom: { id: 'cleanroom', label: 'Data Clean Room',  line: 'cleanroom' },
    control:   { id: 'control',   label: 'Kontrol Düzlemi',  line: 'control' },
    privacy:   { id: 'privacy',   label: 'Gizlilik',         line: 'privacy' }
  };

  /* ------------------------------------------------------------------
   * 5.3 İstasyonlar
   * ------------------------------------------------------------------ */
  D.nodes = [
    {
      id: 'browser', label: 'Tarayıcı', sub: 'ziyaretçi cihazı', zone: 'client', hub: true,
      detail: {
        what: 'Ziyaretçinin Gündem+ sayfasını açtığı cihaz. Sayfadaki collect.js davranış olaylarını toplar, ad tag reklam ister; gösterim ve tıklama beacon’ları da buradan çıkar.',
        why: 'Bütün akışlar burada başlar. 1. parti çerez (fpc) yayıncının kendi alan adından yazılır; e-posta sunucuya gitmeden önce burada normalize edilip SHA-256 ile hash’lenir.',
        tech: 'collect.js (< 15 KB gzip), navigator.sendBeacon ile toplu gönderim, CMP API (__tcfapi / KVKK callback), Prebid.js',
        latency: 'Olay gönderimi asenkron; reklam yanıtı header bidding ile tipik olarak 100–150 ms',
        scale: 'Ortalama 20 bin, tepe 60 bin reklam isteği/sn; istek başına ~3 olay',
        docs: '03-dmp.md'
      }
    },
    {
      id: 'cmp', label: 'CMP', sub: 'KVKK rıza', zone: 'client',
      detail: {
        what: 'Rıza yönetim platformu. KVKK aydınlatma metnini ve açık rıza banner’ını gösterir; kararı TCF 2.2 / GPP dizesi ve kvkk_explicit bayrağı olarak üretir.',
        why: 'Zorunlu olmayan çerezler rıza alınmadan yazılamaz ve “Reddet” en az “Kabul et” kadar kolay olmalıdır. Rıza sinyali her olayla birlikte taşınır; servisler merkezi bir yere sormaz.',
        tech: 'IAB TCF 2.2, GPP, KVKK banner callback’i; rıza kayıtları (zaman, metin sürümü, kanal) değiştirilemez şekilde saklanır',
        latency: 'İstemci tarafında, sayfa yüklenirken; ek ağ çağrısı yok',
        scale: 'Her yeni ziyaretçi ve her rıza değişikliği',
        docs: '07-gizlilik-ve-uyum.md'
      }
    },
    {
      id: 'gateway', label: 'Edge Gateway', sub: 'LB + WAF', zone: 'edge',
      detail: {
        what: 'Anycast + L7 yük dengeleyici. TLS’i sonlandırır, WAF ve rate limit uygular, isteği olay yoluna (Collector) ya da reklam yoluna (Ad API) yönlendirir.',
        why: 'Sıcak yolun ilk durağıdır; kötü niyetli trafiği ve ani yükü arka servislere ulaşmadan keser. Servisler arası trafik mTLS ile korunur.',
        tech: 'GeoDNS / Anycast, L7 LB + WAF, service mesh (SPIFFE kimlikleri, mTLS)',
        latency: 'TLS sonlandırma + LB ≈ 2 ms (p99)',
        scale: 'İstanbul (birincil) ve Ankara bölgelerinde aktif-aktif',
        docs: '06-altyapi-ve-teknoloji.md'
      }
    },
    {
      id: 'collector', label: 'Collector', sub: 'olay toplama', zone: 'edge',
      detail: {
        what: 'Durumsuz (stateless) Go servisi. Olayın şemasını doğrular, received_time ekler, tarayıcıya hemen 204 döner ve olayı raw.web_events konusuna yazar.',
        why: 'Tarayıcı işlemenin bitmesini beklemez. Kafka geçici olarak erişilemezse yerel disk tamponu sayesinde olay kaybolmaz.',
        tech: 'Go, Protobuf EventEnvelope, yerel disk tamponu, Schema Registry doğrulaması',
        latency: 'Senkron 204 yanıtı birkaç ms; Kafka yazımı asenkron',
        scale: 'Tepe ~270 MB/s olay hacmi; kabul edilen olay oranı SLO’su %99,99',
        docs: '01-genel-mimari.md'
      }
    },
    {
      id: 'adapi', label: 'Ad API', sub: 'reklam isteği', zone: 'edge',
      detail: {
        what: 'Ad Decision API. Reklam isteğini (ad unit, sayfa URL’i, rıza dizesi, 1P kimlikler) alır, GeoIP ve UA bilgisiyle zenginleştirip karar motoruna iletir.',
        why: 'Reklam yolunun girişidir ve yanıt her koşulda dönmelidir: profil okunamazsa bile kontekstüel bir karar verilir.',
        tech: 'Go / Rust, bellek içi GeoIP ve UA ayrıştırma, sıkı timeout + circuit breaker',
        latency: 'Parse + doğrulama + rıza ≈ 0,5 ms; GeoIP + UA ≈ 0,3 ms',
        scale: 'Ortalama 20 bin, tepe 60 bin istek/sn; başarılı yanıt SLO’su %99,95',
        docs: '02-ad-server.md'
      }
    },
    {
      id: 'tracking', label: 'Tracking', sub: 'imp / click', zone: 'edge',
      detail: {
        what: 'Gösterim, görünürlük ve tıklama beacon’larını karşılayan uç nokta. URL’ler HMAC-SHA256 ile imzalıdır; tıklama /clk üzerinden 302 ile hedefe yönlenir.',
        why: 'İmza sahte beacon’ı ve fiyat manipülasyonunu önler; yalnızca imzalı hedefe yönlendirme açık yönlendirme (open redirect) açığını kapatır.',
        tech: '/imp?d=<base64(payload)>&s=<HMAC>, /clk 302, ad.events konusu',
        latency: 'Beacon yanıtı birkaç ms; işleme Flink’te asenkron',
        scale: 'Her gösterim için en az iki beacon (imp + viewable)',
        docs: '02-ad-server.md'
      }
    },
    {
      id: 'kafka', label: 'Kafka', sub: 'event omurgası', zone: 'backbone', hub: true,
      detail: {
        what: 'Bütün olayların kalıcı, sıralı ve şemalı taşındığı omurga. DMP olayları ile reklam olayları aynı Protobuf şema altyapısını paylaşır.',
        why: 'Raporlama, atıflama ve segmentasyon aynı veriden beslenir; üreten ve tüketen servisler birbirinden bağımsız ölçeklenir.',
        tech: 'Apache Kafka (KRaft), Schema Registry (Protobuf); anahtar = tenant_id + person_id (yoksa cihaz kimliği)',
        latency: 'Yazma → tüketme arası tipik olarak onlarca ms',
        scale: '3 gün saklama, RF=3, zstd ile ~18 TB disk; raw.web_events 96, ad.decisions 128 partition',
        docs: '05-veri-modeli.md'
      }
    },
    {
      id: 'flink', label: 'Flink', sub: 'stream işleme', zone: 'backbone', hub: true,
      detail: {
        what: 'Olayları doğrular, rıza ve bot filtresinden geçirir, zenginleştirir (GeoIP, UA, içerik kategorisi). Reklam olaylarında dedup, IVT ve faturalama sayaçlarını yürütür.',
        why: 'Profilleme izni olmayan olay burada ayrılır ve yalnızca agrega analitiğe gider. Gerçek zamanlı segment kuralları Flink keyed state içinde değerlendirilir.',
        tech: 'Apache Flink: event-time, exactly-once, büyük keyed state; impression_id üzerinden 24 saatlik dedup',
        latency: 'Olay → profil üyeliği < 30 sn (p95)',
        scale: 'Saniyede yüz binlerce olay; consumer lag ve checkpoint süresi izlenir',
        docs: '01-genel-mimari.md'
      }
    },
    {
      id: 'identity', label: 'Identity Graph', sub: 'kimlik çözümleme', zone: 'dmp',
      detail: {
        what: 'fpc, maid, hem gibi kimlikleri tek bir person_id altında birleştirir. Gerçek zamanlı yolda idmap tablosu (id → person_id) her olayda okunur.',
        why: 'Login gibi deterministik bir bağlantı geldiğinde iki kişi anında birleştirilir ve identity.merges olayı yayınlanır. Hiçbir kritik işlev 3. parti çereze bağlı değildir.',
        tech: 'ID Resolution Service, Aerospike idmap seti, günlük Spark connected components (union-find)',
        latency: 'idmap okuması p99 < 1 ms',
        scale: 'Küme başına sınır (ör. 50 çerez, 10 MAID) dev kümeyi önler; 180 gün görülmeyen kimlik düşer',
        docs: '03-dmp.md'
      }
    },
    {
      id: 'profile', label: 'Profil Deposu', sub: 'Aerospike', zone: 'dmp', hub: true,
      detail: {
        what: 'Kişi profilinin tutulduğu KV deposu: kimlikler, segment üyelikleri (seg_id → bitiş zamanı), fcap sayaçları, öznitelikler ve son rıza durumu.',
        why: 'Ad server istek başına en fazla iki tek anahtarlı okuma yapar (idmap + profile); kişiselleştirme bu yüzden sıcak yolda gecikme yaratmaz.',
        tech: 'Aerospike (SSD + RAM indeksi); namespace dmp, set profile, anahtar “42:person_id”',
        latency: 'p99 < 1 ms; idmap + profile paralel ≈ 2 ms',
        scale: '100 milyon aktif profil ≈ 400 GB SSD + ~13 GB RAM indeks; 180 gün inaktivitede otomatik silme',
        docs: '05-veri-modeli.md'
      }
    },
    {
      id: 'segment', label: 'Segment Motoru', sub: 'kural + batch', zone: 'dmp',
      detail: {
        what: 'Segment DSL kurallarını gerçek zamanlı (Flink) ve batch (Spark / ClickHouse SQL) olarak değerlendirir; üyelik değişikliklerini profile ve dmp.segment_changes konusuna yazar.',
        why: 'Aynı DSL iki motorda çalışır, gece “reconcile” işi tutarlılığı sağlar. Clean room çıktısı da buraya dışa aktarılamayan opak segment olarak girer.',
        tech: 'Segment DSL → Flink keyed state / SQL; Theta Sketch ile milisaniyede erişim tahmini',
        latency: 'Gerçek zamanlı kural: saniyeler; batch: saatlik / günlük',
        scale: 'Olay türü → kural indeksi: her olayda yalnızca ilgili kurallar tetiklenir',
        docs: '03-dmp.md'
      }
    },
    {
      id: 'activation', label: 'Aktivasyon', sub: 'DSP · Meta · Google', zone: 'dmp',
      detail: {
        what: 'Segmentleri dış kanallara taşır: DSP’lere ID sync + segment push, sosyal ağ ve arama platformlarına hash’li e-posta ile kitle, SSP’lere deal ID.',
        why: 'Yalnızca açık rıza ve veri işleme sözleşmesi olan kişiler gönderilir. Clean room segmentleri (exportable = false) hiçbir koşulda dışarı çıkmaz.',
        tech: 'Segment push API, partner_id_map, Seller-Defined Audiences, Customer Match / Conversions API',
        latency: 'Asenkron; dakikalar ile saatler arası',
        scale: 'Kanal başına toplu (batch) gönderim; CRM kanallarında İYS kontrolü',
        docs: '03-dmp.md'
      }
    },
    {
      id: 'decision', label: 'Karar Motoru', sub: '< 30 ms', zone: 'ad', hub: true,
      detail: {
        what: 'Reklam kararını veren Go servisi: rıza kontrolü → kimlik ve profil okuma → aday çekme → filtreler → skorlama → birleşik açık artırma → kreatif yanıtı.',
        why: 'Sıcak yolda senkron veritabanı sorgusu ve senkron Kafka yazımı yoktur; karar olayı ad.decisions konusuna asenkron yazılır.',
        tech: 'Go; immutable config snapshot + atomic pointer swap, sync.Pool, sıkı timeout + circuit breaker',
        latency: 'Sunucu içi < 10 ms p50, < 30 ms p99',
        scale: 'İstek başına ~1,5 ms CPU; tepe 60 bin istek/sn için ~135 vCPU',
        docs: '02-ad-server.md'
      }
    },
    {
      id: 'tindex', label: 'Targeting Index', sub: 'bellek içi', zone: 'ad',
      detail: {
        what: 'Aktif line item’ların hedefleme ifadeleri DNF’e derlenip conjunction index ile bellekte tutulur; isteğin özellikleriyle aday listesi çekilir.',
        why: '100 binden fazla line item arasında aday bulma O(log n)’e yakın sürede biter. Güncellemeler kontrol düzleminden snapshot + delta olarak gelir.',
        tech: 'Conjunction index (Indexing Boolean Expressions, VLDB 2009), DNF derleyici',
        latency: 'Aday çekme < 1 ms',
        scale: '100 bin+ line item',
        docs: '02-ad-server.md'
      }
    },
    {
      id: 'fcap', label: 'Fcap + Pacing', sub: 'filtreler', zone: 'ad',
      detail: {
        what: 'Adayları frekans sınırına (ör. 24 saatte 3), pacing throttle olasılığına, bütçeye, marka güvenliğine ve rekabet ayrımına göre eler.',
        why: 'Throttle oranı config üzerinden gelir ve karar anında rand() < throttle ile uygulanır; merkezi, senkron bir sayaç okuması gerekmez.',
        tech: 'Profildeki saatlik kova sayaçları; iki aşamalı fcap güncellemesi (iyimser yerel sayaç + Flink ile kalıcı sayaç)',
        latency: 'Filtreler ≈ 1 ms (p99)',
        scale: 'Line item, kampanya ve reklamveren kapsamlı çoklu kural',
        docs: '02-ad-server.md'
      }
    },
    {
      id: 'ml', label: 'ML Skor', sub: 'pCTR · pCVR', zone: 'ad',
      detail: {
        what: 'Her aday için tıklama (pCTR) ve dönüşüm (pCVR) olasılığını tahmin eder; CPC ve CPA kampanyalar eCPM’e çevrilerek CPM kampanyalarla adil yarışır.',
        why: 'Model ad server prosesine gömülüdür, ağ çağrısı yoktur. Kalibrasyon (isotonic regression) olmadan farklı fiyatlama modelleri karşılaştırılamaz.',
        tech: 'LightGBM / küçük DNN, ONNX Runtime (in-process), Feature Store, MLflow',
        latency: '< 2 ms (adaylar toplu skorlanır)',
        scale: 'İstek başına onlarca aday',
        docs: '02-ad-server.md'
      }
    },
    {
      id: 'auction', label: 'Açık Artırma', sub: 'first-price', zone: 'ad',
      detail: {
        what: 'Direct line item’lar (eCPM), header bidding teklifleri ve deal’ler tek bir birleşik açık artırmada yarışır; floor üstündeki en yüksek eCPM kazanır.',
        why: 'Garantili line item’lar gölge fiyatla aynı açık artırmaya girer; böylece teslimat hedefi ile gelir aynı mekanizmada dengelenir.',
        tech: 'First-price, dinamik floor, rekabet ayrımı (adomain), nurl / burl / lurl bildirimleri',
        latency: 'Açık artırma + kreatif hazırlama ≈ 1 ms',
        scale: 'Her istekte direct ve programatik tüm katılımcılar',
        docs: '02-ad-server.md'
      }
    },
    {
      id: 'prebid', label: 'Prebid Server', sub: 'header bidding', zone: 'ad',
      detail: {
        what: 'Sunucu taraflı header bidding. OpenRTB 2.6 BidRequest’i (user.eids, user.data, schain, regs) teklifçilere paralel gönderir ve yanıtları toplar.',
        why: 'Programatik talep direct kampanyalarla aynı açık artırmada yarışır; bidder başına timeout ve traffic shaping gecikmeyi ve maliyeti sınırlar.',
        tech: 'Prebid Server (Go), 200+ bidder adaptörü, OpenRTB 2.6',
        latency: 'Bidder timeout 120 ms; profil okuma ve aday hesaplama bu sürede paralel yürür',
        scale: 'Simülasyonda istek başına 4 teklifçi',
        docs: '02-ad-server.md'
      }
    },
    {
      id: 'dsp', label: 'DSP\'ler', sub: 'OpenRTB 2.6', zone: 'ad', external: true,
      detail: {
        what: 'Dış talep tarafı platformları. BidRequest’e CPM teklifiyle ya da “teklif yok” ile yanıt verirler; kimlikli istekte teklifler belirgin şekilde yükselir.',
        why: 'Kimlik ve segment yalnızca rıza ve vendor izni varsa iletilir; yoksa istek kimliksizdir. Süreyi aşan teklif açık artırmaya giremez.',
        tech: 'OpenRTB 2.6 BidRequest / BidResponse, user.eids, Seller-Defined Audiences',
        latency: 'Yanıt 35–190 ms; 120 ms sonrası timeout',
        scale: 'Teklif oranı %70–90',
        docs: '02-ad-server.md'
      }
    },
    {
      id: 'cdn', label: 'Kreatif CDN', sub: 'display · VAST', zone: 'ad',
      detail: {
        what: 'Kazanan kreatifin markup’ını veya VAST XML’ini imzalı tracking URL’leriyle birlikte sayfaya ulaştırır.',
        why: 'Kreatifler yayından önce taranır ve onaylanır (malware, ağır kreatif, SSL); IAB LEAN sınırları sayfa performansını korur.',
        tech: 'Display (HTML5, SafeFrame), VAST 4.2 / 4.3, OM SDK (OMID) ile görünürlük',
        latency: 'Kreatif hazırlama 0,4–0,8 ms + uçtan teslim',
        scale: 'Statik varlıklar uç noktalarda önbellekte',
        docs: '02-ad-server.md'
      }
    },
    {
      id: 'clickhouse', label: 'ClickHouse', sub: 'raporlar', zone: 'analytics',
      detail: {
        what: 'Gerçek zamanlı raporlama veritabanı. Dedup ve IVT işaretli reklam olayları ads.ad_events tablosuna, saatlik agregalar ad_stats_hourly tablosuna yazılır.',
        why: 'Kampanya ekranları, gelir ve doluluk raporları ile “neden bu reklam” analizleri saniyeler içinde yanıtlanır.',
        tech: 'ReplicatedMergeTree, AggregatingMergeTree + materialized view, uniqCombined64 ile tekil erişim',
        latency: 'Olay → rapor tazeliği < 5 dk (SLO)',
        scale: 'Ham olaylar 90 gün (~70 TB), saatlik agrega 13 ay',
        docs: '05-veri-modeli.md'
      }
    },
    {
      id: 'iceberg', label: 'Iceberg', sub: 'lakehouse', zone: 'analytics',
      detail: {
        what: 'Bütün ham olayların açık formatlı arşivi. Batch segmentler, identity graph işi, ML eğitimi ve clean room’a giden maruz kalma verisi buradan beslenir.',
        why: 'Zaman yolculuğu ve şema evrimi sağlar. Silme taleplerinde row-level delete + compaction uygulanır.',
        tech: 'Apache Iceberg + S3 / MinIO, Spark + Trino',
        latency: 'Dakikalar (mikro-batch yazım)',
        scale: '~7,8 TB/gün ham olay; 13 ay saklama',
        docs: '06-altyapi-ve-teknoloji.md'
      }
    },
    {
      id: 'pacer', label: 'Pacing Kontrol', sub: 'PID · 10 sn', zone: 'analytics',
      detail: {
        what: 'Her ~10 saniyede bir, her line item için hedef teslimat eğrisini gerçekleşen teslimatla kıyaslar ve 0–1 arası bir throttle olasılığı üretir.',
        why: 'Garantili kampanyalar gün boyu dengeli teslim edilir. Flink harcama sayacı bütçenin %98’inde “soft stop”, %100’ünde “hard stop” sinyali verir.',
        tech: 'PID kontrolcü, control.pacing konusu (compacted), config stream ile pod’lara dağıtım',
        latency: 'Kontrol döngüsü ~10 sn',
        scale: 'Gün sonu teslimat doğruluğu hedefi %98–102',
        docs: '02-ad-server.md'
      }
    },
    {
      id: 'partner', label: 'Partner', sub: 'Perakendeci X', zone: 'cleanroom', external: true,
      detail: {
        what: 'Clean room ortaklığındaki perakendeci. 12.400 müşterisinin e-postasını kendi tarafında normalize edip SHA-256 ile hash’ler ve kendi anahtarıyla şifreleyerek yükler.',
        why: 'Partner hangi kişilerin eşleştiğini hiçbir zaman öğrenmez; yalnızca gürültülü agrega raporu ve opak segmentin yaklaşık büyüklüğünü görür.',
        tech: 'DCR Uploader CLI (normalize + hash), partnerin kendi KMS anahtarı',
        latency: 'Toplu yükleme (batch)',
        scale: 'Simülasyonda 12.400 kayıt',
        docs: '04-data-clean-room.md'
      }
    },
    {
      id: 'dcr', label: 'Clean Room', sub: 'TEE eşleştirme', zone: 'cleanroom',
      detail: {
        what: 'İzole VPC’deki gizli VM (TEE) içinde iki tarafın hash’li kimliklerini eşleştirir; gerçek kimlik yerine bu ortaklığa özgü opak match_id üretir.',
        why: 'Remote attestation ile partner hangi kodun çalıştığını doğrular; hiçbir taraf diğerinin eşleşmeyen kayıtlarını göremez. Ortaklık bitince anahtar imha edilir.',
        tech: 'AMD SEV-SNP / Intel TDX, TEE içi hash join (alternatif: ECDH-PSI), append-only imzalı denetim kaydı',
        latency: 'Toplu iş; dakikalar',
        scale: 'Yayıncının 48.000 hash’li e-postası ∩ partnerin 12.400 kaydı',
        docs: '04-data-clean-room.md'
      }
    },
    {
      id: 'policy', label: 'Politika + DP', sub: 'k ≥ 50 · ε', zone: 'cleanroom',
      detail: {
        what: 'Yalnızca iki tarafın onayladığı sorgu şablonlarını çalıştırır; her hücrede k ≥ 50 eşiğini uygular, sonuca diferansiyel gizlilik gürültüsü ekler ve ε bütçesinden düşer.',
        why: 'Satır seviyesinde çıktı yoktur: sonuç ya agrega rapordur ya da ad server içinde hedeflenebilen, dışa aktarılamayan opak segmenttir (en az 1.000 kişi).',
        tech: 'Şablon + kolon kuralları (join / dimension / aggregate_only), Laplace / Gauss gürültüsü, OpenDP',
        latency: 'Sorgu başına saniyeler',
        scale: 'Toplam ε bütçesi 10, çalıştırma başına 0,5; günde en fazla 50 sorgu',
        docs: '04-data-clean-room.md'
      }
    },
    {
      id: 'admin', label: 'Admin UI', sub: 'kampanya', zone: 'control',
      detail: {
        what: 'Kampanya operasyon ekibinin line item, kreatif, hedefleme ve bütçe yönettiği arayüz; raporları ClickHouse’tan okur.',
        why: 'Her değişiklik Management API üzerinden PostgreSQL’e yazılır ve değiştirilemez denetim kaydına (audit_log) düşer.',
        tech: 'React + TypeScript, REST (OpenAPI) + GraphQL, SSO (OIDC) + MFA + RBAC',
        latency: 'Kaydet → tüm pod’lara yayılım birkaç saniye',
        scale: 'Kiracı başına çok sayıda eşzamanlı operatör',
        docs: '01-genel-mimari.md'
      }
    },
    {
      id: 'postgres', label: 'PostgreSQL', sub: 'kontrol DB', zone: 'control',
      detail: {
        what: 'Kontrol düzleminin ilişkisel veritabanı: kiracı, reklamveren, kampanya, line item, kreatif, segment tanımı ve clean room ortaklıkları.',
        why: 'Ad server sıcak yolda bu veritabanını asla sorgulamaz; değişiklikler CDC ile config stream’e akar. Para değerleri float hatası olmasın diye micros olarak tutulur.',
        tech: 'PostgreSQL (primary + streaming replica), Debezium CDC, line_items.version ile optimistic versioning',
        latency: 'Yazma birkaç ms; reklam kararına etkisi yok',
        scale: 'Düşük hacim, ilişkisel, ACID',
        docs: '05-veri-modeli.md'
      }
    },
    {
      id: 'config', label: 'Config Stream', sub: 'CDC → pod\'lar', zone: 'control',
      detail: {
        what: 'PostgreSQL değişikliklerini CDC ile yakalar ve config.adserver konusu üzerinden her ad server pod’una snapshot + delta olarak dağıtır.',
        why: 'Pod’lar line item yapılandırmasını immutable snapshot olarak tutar ve atomic pointer swap ile kilitsiz geçer; karar sırasında okuma kesilmez.',
        tech: 'Debezium → Kafka (config.adserver, compacted) → pod içi snapshot',
        latency: 'Değişiklik → tüm pod’lar birkaç saniye',
        scale: 'Tüm bölgelere aynı sürüm yayınlanır',
        docs: '02-ad-server.md'
      }
    },
    {
      id: 'privacy', label: 'Gizlilik Portalı', sub: 'DSAR', zone: 'privacy',
      detail: {
        what: 'Veri sahibinin silme ve erişim taleplerini alır, kimliğini doğrular, bağlı tüm kimlikleri bulur ve privacy.dsar olayını yayınlar.',
        why: 'Silme profil, idmap, Iceberg, ClickHouse, clean room ve aktivasyon ortaklarında paralel yürür. Hash’li kimlikler suppression listesine girer; kişi eski çerezle dönse bile profil yeniden oluşmaz.',
        tech: 'DSAR pipeline, privacy.dsar konusu, suppression listesi, depo bazında tamamlanma kanıtı',
        latency: 'Talep → tüm depolardan silme < 30 gün (hedef 72 saat)',
        scale: 'KVKK: veri sahibi taleplerine 30 gün içinde yanıt',
        docs: '07-gizlilik-ve-uyum.md'
      }
    }
  ];

  /* ------------------------------------------------------------------
   * 5.4 Bağlantılar — id = from-to (paketler her iki yönde gidebilir)
   * ------------------------------------------------------------------ */
  function E(from, to, lines, label) { return { id: from + '-' + to, from: from, to: to, lines: lines, label: label }; }
  D.edges = [
    E('cmp', 'browser',        ['privacy'],                    'rıza banner\'ı / TC string'),
    E('browser', 'gateway',    ['dmp', 'ad'],                  'HTTPS'),
    E('gateway', 'collector',  ['dmp'],                        'olay'),
    E('gateway', 'adapi',      ['ad'],                         'ad request'),
    E('browser', 'tracking',   ['measure'],                    'beacon'),
    E('collector', 'kafka',    ['dmp'],                        'raw.web_events'),
    E('tracking', 'kafka',     ['measure'],                    'ad.events'),
    E('kafka', 'flink',        ['dmp', 'measure', 'privacy'],  'tüketim'),
    E('flink', 'identity',     ['dmp'],                        'kimlik çözümleme'),
    E('identity', 'profile',   ['dmp', 'ad', 'privacy'],       'idmap'),
    E('flink', 'segment',      ['dmp'],                        'kural değerlendirme'),
    E('segment', 'profile',    ['dmp', 'cleanroom'],           'üyelik yaz'),
    E('flink', 'iceberg',      ['dmp', 'measure', 'privacy'],  'arşiv'),
    E('flink', 'clickhouse',   ['measure', 'privacy'],         'rapor satırı'),
    E('flink', 'pacer',        ['measure'],                    'harcama sayacı'),
    E('flink', 'profile',      ['measure', 'privacy'],         'fcap sayacı'),
    E('adapi', 'decision',     ['ad'],                         'karar isteği'),
    E('decision', 'identity',  ['ad'],                         'id → person'),
    E('decision', 'profile',   ['ad'],                         'profil oku'),
    E('decision', 'tindex',    ['ad'],                         'aday sorgusu'),
    E('decision', 'fcap',      ['ad'],                         'filtre'),
    E('pacer', 'fcap',         ['measure'],                    'throttle oranı'),
    E('decision', 'ml',        ['ad'],                         'skor'),
    E('decision', 'prebid',    ['ad'],                         'BidRequest'),
    E('prebid', 'dsp',         ['ad'],                         'OpenRTB'),
    E('decision', 'auction',   ['ad'],                         'direct adaylar'),
    E('prebid', 'auction',     ['ad'],                         'teklifler'),
    E('auction', 'cdn',        ['ad'],                         'kazanan kreatif'),
    E('cdn', 'browser',        ['ad'],                         'reklam yanıtı'),
    E('decision', 'kafka',     ['ad'],                         'ad.decisions (async)'),
    E('segment', 'activation', ['dmp'],                        'segment push'),
    E('activation', 'dsp',     ['dmp'],                        'hashed kitle'),
    E('iceberg', 'dcr',        ['cleanroom'],                  'maruz kalma'),
    E('partner', 'dcr',        ['cleanroom'],                  'hash\'li CRM'),
    E('dcr', 'policy',         ['cleanroom'],                  'eşleşen küme'),
    E('policy', 'segment',     ['cleanroom'],                  'opak segment'),
    E('policy', 'partner',     ['cleanroom'],                  'agrega rapor'),
    E('admin', 'postgres',     ['control'],                    'UPDATE'),
    E('postgres', 'config',    ['control'],                    'CDC delta'),
    E('config', 'decision',    ['control'],                    'snapshot swap'),
    E('config', 'tindex',      ['control'],                    'indeks yenile'),
    E('clickhouse', 'admin',   ['control'],                    'rapor sorgusu'),
    E('browser', 'privacy',    ['privacy'],                    'silme talebi'),
    E('privacy', 'identity',   ['privacy'],                    'kimlikleri bul'),
    E('privacy', 'kafka',      ['privacy'],                    'privacy.dsar'),
    E('privacy', 'dcr',        ['privacy'],                    'collab\'dan çıkar'),
    E('privacy', 'activation', ['privacy'],                    'ortaklardan sil')
  ];

  /* ------------------------------------------------------------------
   * 5.5 Segmentler
   * kind: 'realtime' | 'batch' | 'crm' | 'clean_room' | 'behavioral'
   * Ek alanlar: logic (motor için makine okunur kural), consent (gereken amaçlar), taxonomy
   * ------------------------------------------------------------------ */
  D.segments = [
    { id: 1001, name: 'Otomobil İlgilisi – Sıcak', kind: 'realtime', line: 'dmp',
      rule: '7 gün içinde ≥ 2 otomobil içeriği/ürünü görüntüleme', ttlDays: 30, exportable: true, estimate: 1840000,
      logic: { type: 'count', categories: ['otomobil'], events: ['page_view', 'product_view'], min: 2, withinDays: 7 },
      consent: ['profiling', 'personalizedAds'], taxonomy: 'iab_audience_1_1:automotive' },
    { id: 1002, name: 'Teknoloji Meraklısı', kind: 'realtime', line: 'dmp',
      rule: '30 gün içinde ≥ 1 teknoloji içeriği/ürünü', ttlDays: 30, exportable: true, estimate: 2930000,
      logic: { type: 'count', categories: ['teknoloji'], events: ['page_view', 'product_view'], min: 1, withinDays: 30 },
      consent: ['profiling', 'personalizedAds'], taxonomy: 'iab_audience_1_1:technology' },
    { id: 1003, name: 'Sepeti Terk Eden', kind: 'realtime', line: 'dmp',
      rule: 'sepete ekleme var, 24 saat içinde satın alma yok', ttlDays: 3, exportable: true, estimate: 412000,
      logic: { type: 'cart_abandon', events: ['add_to_cart'], without: 'purchase', withinHours: 24 },
      consent: ['profiling', 'personalizedAds'], taxonomy: 'intent:cart_abandoner' },
    { id: 1004, name: 'Alıcı – Son 30 Gün', kind: 'realtime', line: 'dmp',
      rule: '30 gün içinde satın alma', ttlDays: 30, exportable: true, estimate: 618000,
      logic: { type: 'event', events: ['purchase'], min: 1, withinDays: 30 },
      consent: ['profiling', 'personalizedAds'], taxonomy: 'intent:recent_buyer' },
    { id: 1005, name: 'Reklama Tıklayan', kind: 'behavioral', line: 'dmp',
      rule: 'son 14 günde reklam tıklaması', ttlDays: 14, exportable: true, estimate: 351000,
      logic: { type: 'event', events: ['ad_click'], min: 1, withinDays: 14 },
      consent: ['profiling', 'personalizedAds'], taxonomy: 'engagement:ad_clicker' },
    { id: 1006, name: 'Finans Okuru', kind: 'realtime', line: 'dmp',
      rule: '30 gün içinde ≥ 1 ekonomi içeriği', ttlDays: 30, exportable: true, estimate: 1270000,
      logic: { type: 'count', categories: ['ekonomi'], events: ['page_view'], min: 1, withinDays: 30 },
      consent: ['profiling', 'personalizedAds'], taxonomy: 'iab_audience_1_1:personal_finance' },
    { id: 2001, name: 'Anne-Bebek İlgilisi', kind: 'batch', line: 'dmp',
      rule: 'mobil uygulamada son 90 gün bebek kategorisi (gece batch)', ttlDays: 90, exportable: true, estimate: 982000,
      logic: { type: 'batch', schedule: 'her gece 03:00', source: 'iceberg' },
      consent: ['profiling', 'personalizedAds'], taxonomy: 'iab_audience_1_1:parenting' },
    { id: 2002, name: 'Sadakat: Gold', kind: 'crm', line: 'dmp',
      rule: 'CRM onboarding, sadakat seviyesi = gold', ttlDays: 90, exportable: true, estimate: 121000,
      logic: { type: 'crm', source: 'crm_onboard', match: 'hem' },
      consent: ['profiling', 'personalizedAds'], taxonomy: 'crm:loyalty_gold' },
    { id: 9001, name: 'CR · Perakendeci X Bebek Ürünü Alıcıları', kind: 'clean_room', line: 'cleanroom',
      rule: 'clean room eşleşmesi; dışa aktarılamaz', ttlDays: 30, exportable: false, estimate: 0,
      logic: { type: 'clean_room', collaboration: 'collab_2026_perakendecix_q4', minSegment: 1000 },
      consent: ['profiling', 'personalizedAds'], taxonomy: 'clean_room:perakendeci-x' }
  ];

  /* ------------------------------------------------------------------
   * 5.6 Line item'lar (kampanyalar) — markalar kurgusaldır
   * Ek alanlar: adomain, flight {start,end} (gölge fiyat için teslimat açığı hesabı), dealId
   * ------------------------------------------------------------------ */
  D.lineItems = [
    {
      id: 101, name: 'Volta e-SUV Lansman', advertiser: 'Volta Otomotiv', adomain: 'volta.example',
      type: 'standard', priority: 4, pricing: 'CPM', rate: 85,
      targeting: { segments: [1001], contexts: [], requiresConsent: true },
      fcap: { max: 3, windowH: 24 }, goal: { type: 'impressions', qty: 1000000 }, budgetTL: 85000, pacing: 'even',
      baseCtr: 0.004, baseCvr: 0.002,
      seed: { delivered: 412300, spentTL: 35045.5, clicks: 1649, conversions: 12 },
      throttle: 0.78, status: 'active',
      flight: { start: '2026-10-10T00:00:00+03:00', end: '2026-11-20T23:59:59+03:00' },
      creative: {
        brand: 'Volta Otomotiv', headline: 'Volta e-SUV: kışın da 450 km+',
        body: 'Isı pompası ve 150 kW hızlı şarj. Test sürüşü randevunu şimdi al.',
        cta: 'Test sürüşü al', theme: 'volta',
        landing: { title: 'Volta e-SUV Long Range', sku: 'OTO-EV-001' }
      }
    },
    {
      id: 102, name: 'Minik Adımlar – CR Kitlesi', advertiser: 'Minik Adımlar', adomain: 'minikadimlar.example',
      type: 'preferred_deal', priority: 8, pricing: 'CPM', rate: 120, dealId: 'PD-4471-MINIK',
      targeting: { segments: [9001], contexts: [], requiresConsent: true },
      fcap: { max: 4, windowH: 24 }, goal: null, budgetTL: 250000, pacing: 'even',
      baseCtr: 0.005, baseCvr: 0.02,
      seed: { delivered: 0, spentTL: 0, clicks: 0, conversions: 0 },
      throttle: 1, status: 'active',
      flight: { start: '2026-10-25T00:00:00+03:00', end: '2026-12-31T23:59:59+03:00' },
      creative: {
        brand: 'Minik Adımlar', headline: 'Travel bebek arabasında sezon fırsatı',
        body: 'Tek elle katlanır, 7,2 kg. Perakendeci X mağazalarında ve online.',
        cta: 'Fırsatı gör', theme: 'minik',
        landing: { title: 'Minik Adımlar Travel Bebek Arabası', sku: 'BEB-ARB-007' }
      }
    },
    {
      id: 103, name: 'Nova 14 Dizüstü – Performans', advertiser: 'TeknoPark', adomain: 'teknopark.example',
      type: 'price_priority', priority: 12, pricing: 'CPC', rate: 4.5,
      targeting: { segments: [1002], contexts: [], requiresConsent: true },
      fcap: { max: 5, windowH: 24 }, goal: null, budgetTL: 60000, pacing: 'asap',
      baseCtr: 0.006, baseCvr: 0.015,
      seed: { delivered: 186400, spentTL: 5031, clicks: 1118, conversions: 17 },
      throttle: 1, status: 'active',
      flight: { start: '2026-10-01T00:00:00+03:00', end: '2026-11-30T23:59:59+03:00' },
      creative: {
        brand: 'TeknoPark', headline: 'Nova 14: 18 saat pil, 1,2 kg',
        body: 'Yeni nesil işlemciyle Nova 14 dizüstü 32.999 ₺. Ücretsiz kargo, ertesi gün teslim.',
        cta: 'İncele', theme: 'nova',
        landing: { title: 'Nova 14 Dizüstü', sku: 'TEK-LAP-014' }
      }
    },
    {
      id: 104, name: 'Sepetim Geri Dönüş', advertiser: 'Sepetim', adomain: 'sepetim.example',
      type: 'price_priority', priority: 12, pricing: 'CPA', rate: 60,
      targeting: { segments: [1003], contexts: [], requiresConsent: true },
      fcap: { max: 6, windowH: 24 }, goal: null, budgetTL: 40000, pacing: 'even',
      baseCtr: 0.009, baseCvr: 0.04,
      seed: { delivered: 97800, spentTL: 2100, clicks: 880, conversions: 35 },
      throttle: 1, status: 'active',
      flight: { start: '2026-09-15T00:00:00+03:00', end: '2026-12-31T23:59:59+03:00' },
      creative: {
        brand: 'Sepetim', headline: 'Sepetin seni bekliyor',
        body: 'Sepetindeki ürünler ayrıldı. Bugün tamamlarsan kargo bizden.',
        cta: 'Sepete dön', theme: 'sepetim',
        landing: { title: 'Sepetim — alışverişini tamamla', page: 'cart' }
      }
    },
    {
      id: 105, name: 'Bulut Bank Kredi Kartı', advertiser: 'Bulut Bank', adomain: 'bulutbank.example',
      type: 'price_priority', priority: 12, pricing: 'CPM', rate: 38,
      targeting: { segments: [], contexts: ['ekonomi', 'otomobil'], requiresConsent: false },
      fcap: null, goal: null, budgetTL: 120000, pacing: 'even',
      baseCtr: 0.0028, baseCvr: 0.005,
      seed: { delivered: 1284000, spentTL: 48792, clicks: 3595, conversions: 41 },
      throttle: 1, status: 'active',
      flight: { start: '2026-10-01T00:00:00+03:00', end: '2026-12-31T23:59:59+03:00' },
      creative: {
        brand: 'Bulut Bank', headline: 'Bulut Kart: ilk yıl aidatsız',
        body: 'Akaryakıt ve elektrikli şarj harcamalarında %5 bulut puan. Başvuru 3 dakika.',
        cta: 'Hemen başvur', theme: 'bulut',
        landing: { title: 'Bulut Kart başvurusu' }
      }
    },
    {
      id: 106, name: 'Minik Adımlar Sezon', advertiser: 'Minik Adımlar', adomain: 'minikadimlar.example',
      type: 'standard', priority: 4, pricing: 'CPM', rate: 70,
      targeting: { segments: [2001], contexts: [], requiresConsent: true },
      fcap: { max: 3, windowH: 24 }, goal: { type: 'impressions', qty: 400000 }, budgetTL: 28000, pacing: 'even',
      baseCtr: 0.004, baseCvr: 0.012,
      seed: { delivered: 251000, spentTL: 17570, clicks: 1004, conversions: 12 },
      throttle: 0.64, status: 'active',
      flight: { start: '2026-10-01T00:00:00+03:00', end: '2026-11-30T23:59:59+03:00' },
      creative: {
        brand: 'Minik Adımlar', headline: 'Sezonun en hafif bebek arabası',
        body: 'Travel sistem, 7,2 kg, tek elle katlanır. Şimdi 8.499 ₺.',
        cta: 'Ürünü incele', theme: 'minik',
        landing: { title: 'Minik Adımlar Travel Bebek Arabası', sku: 'BEB-ARB-007' }
      }
    },
    {
      id: 199, name: 'Gündem+ Uygulamasını İndir', advertiser: 'Gündem+', adomain: 'gundem.example',
      type: 'house', priority: 16, pricing: 'CPM', rate: 0,
      targeting: { segments: [], contexts: [], requiresConsent: false },
      fcap: null, goal: null, budgetTL: null, pacing: 'asap',
      baseCtr: 0.002, baseCvr: 0,
      seed: { delivered: 642000, spentTL: 0, clicks: 1284, conversions: 0 },
      throttle: 1, status: 'active',
      flight: { start: '2026-01-01T00:00:00+03:00', end: '2026-12-31T23:59:59+03:00' },
      creative: {
        brand: 'Gündem+', headline: 'Gündem+ artık cebinde',
        body: 'Son dakika bildirimleri ve çevrimdışı okuma. Uygulamayı ücretsiz indir.',
        cta: 'Uygulamayı indir', theme: 'house',
        landing: { title: 'Gündem+ uygulaması' }
      }
    }
  ];

  /** Ek: kreatif tema paleti (reklam görselinin kendi renkleri; iki temada da aynı kalır). */
  D.creativeThemes = {
    volta:   { bg: '#0f2a3d', fg: '#ffffff', accent: '#3fd0c9', muted: '#a9c4d4' },
    minik:   { bg: '#fff3e8', fg: '#3b2414', accent: '#e46a2e', muted: '#8a6650' },
    nova:    { bg: '#11131a', fg: '#f4f5f8', accent: '#7ee0ff', muted: '#a3a9b8' },
    sepetim: { bg: '#ffe9ec', fg: '#3a0f19', accent: '#d7263d', muted: '#8f4e5b' },
    bulut:   { bg: '#e8f1ff', fg: '#0d2350', accent: '#2b6fe8', muted: '#53648a' },
    house:   { bg: '#131922', fg: '#ffffff', accent: '#f2ac35', muted: '#a5afbb' },
    prog:    { bg: '#f3f4f6', fg: '#1d232b', accent: '#5a6878', muted: '#6b7480' }
  };

  /* ------------------------------------------------------------------
   * 5.7 Teklifçiler (Prebid Server adaptörleri)
   * Ek: creative — programatik kazanan için genel (kurgusal) kreatif
   * ------------------------------------------------------------------ */
  D.bidders = [
    { id: 'alfa',  name: 'DSP Alfa',  cpm: [22, 48], latencyMs: [35, 80],   idBoost: 1.7, bidRate: 0.9,
      creative: { brand: 'Rota Tatil', headline: 'Kış tatilinde erken rezervasyon', body: 'Uçak + otel paketlerinde %25’e varan indirim.', cta: 'Paketleri gör', theme: 'prog', adomain: 'rotatatil.example', landing: { title: 'rotatatil.example', external: true } } },
    { id: 'beta',  name: 'DSP Beta',  cpm: [18, 55], latencyMs: [50, 105],  idBoost: 1.5, bidRate: 0.8,
      creative: { brand: 'Kahve Durağı', headline: 'Yeni sezon filtre kahveler', body: 'İlk siparişte ücretsiz kargo ve 250 g hediye.', cta: 'Sipariş ver', theme: 'prog', adomain: 'kahvedur.example', landing: { title: 'kahvedur.example', external: true } } },
    { id: 'gama',  name: 'SSP Gama',  cpm: [15, 40], latencyMs: [60, 115],  idBoost: 1.3, bidRate: 0.7,
      creative: { brand: 'Mavi Sigorta', headline: 'Kasko teklifin 2 dakikada', body: 'Elektrikli araçlara özel batarya teminatı.', cta: 'Teklif al', theme: 'prog', adomain: 'mavisigorta.example', landing: { title: 'mavisigorta.example', external: true } } },
    { id: 'delta', name: 'DSP Delta', cpm: [30, 70], latencyMs: [105, 190], idBoost: 1.6, bidRate: 0.85,   // çoğu zaman timeout
      creative: { brand: 'Lumen Optik', headline: 'Mavi ışık filtreli camlar', body: 'Ekran başında göz yorgunluğuna karşı. Mağazada ücretsiz göz taraması.', cta: 'Randevu al', theme: 'prog', adomain: 'lumenoptik.example', landing: { title: 'lumenoptik.example', external: true } } }
  ];
  D.bidderTimeoutMs = 120;

  /** Ek: karar gecikme adımları (SPEC §6.5), ms aralıkları. */
  D.decisionSteps = [
    { step: 'Parse + rıza',            range: [0.3, 0.6] },
    { step: 'ID çözümleme',            range: [0.6, 1.2] },
    { step: 'Profil okuma',            range: [0.8, 1.6] },
    { step: 'Targeting index',         range: [0.4, 0.9] },
    { step: 'Filtreler',               range: [0.3, 0.6] },
    { step: 'ML skor',                 range: [1.2, 2.2] },
    { step: 'Header bidding (paralel)', range: null, parallel: true },
    { step: 'Açık artırma',            range: [0.2, 0.4] },
    { step: 'Kreatif',                 range: [0.4, 0.8] }
  ];

  /* ------------------------------------------------------------------
   * 5.8 Site içeriği (Gündem+)
   * ------------------------------------------------------------------ */
  D.site = { name: 'Gündem+', domain: 'gundem.example', tagline: 'Gündemin artısı' };

  D.slots = {
    mpu:  { id: 'mpu',  code: '/gundem/makale/mpu',      size: '300x250', floorCpm: 30 },
    home: { id: 'home', code: '/gundem/anasayfa/banner', size: '320x100', floorCpm: 22 }
  };

  D.articles = [
    {
      id: 'a-oto', category: 'otomobil', title: 'Elektrikli SUV’larda kış menzili testi',
      excerpt: 'Eksi 7 derecede, otoyol hızında ve kalorifer açıkken üç elektrikli SUV’u aynı rotada sürdük. Katalog menzili ile gerçek menzil arasındaki fark bazı modellerde yüzde 30’u aştı.',
      path: '/otomobil/elektrikli-suv-kis-menzili',
      author: 'Mert Kaya', readMin: 6, publishedAt: '2026-10-31T08:15:00+03:00', relatedSku: 'OTO-EV-001',
      body: [
        'Test için İstanbul–Bolu arasındaki 260 kilometrelik rotayı seçtik. Sabah sıcaklığı eksi 7 dereceydi; araçlar geceyi açık otoparkta geçirdi ve yola yüzde 100 şarjla çıktı. Hız sabitleyici 110 km/sa’e, iç sıcaklık 21 dereceye ayarlandı.',
        'Kış menzilini belirleyen en önemli etken batarya ön ısıtması oldu. Isı pompalı Volta e-SUV Long Range, katalogdaki 610 kilometrenin 452 kilometresini gerçekleştirdi. Isı pompası olmayan iki rakip modelde kayıp yüzde 32’ye kadar çıktı.',
        'Hızlı şarjda da soğuk batarya belirleyici. Ön ısıtma yapılmadan bağlanılan istasyonda şarj gücü ilk 10 dakikada 60 kW’ın üzerine çıkmadı; şarj durağı navigasyona girildiğinde batarya yolda hazırlandı ve güç 150 kW’a ulaştı.',
        'Önerimiz şu: kışın uzun yola çıkmadan önce aracı prizdeyken ön ısıtın, lastik basıncını kontrol edin ve şarj duraklarını navigasyona girerek planlayın. Böylece katalog değerine en yakın menzili elde edersiniz.'
      ]
    },
    {
      id: 'a-tek', category: 'teknoloji', title: 'Yeni nesil dizüstü işlemciler karşılaştırıldı',
      excerpt: 'Dört yeni nesil mobil işlemciyi aynı kasada, aynı güç limitiyle test ettik. Pil ömründe kazanan belli; performansta ise fark iş yüküne göre değişiyor.',
      path: '/teknoloji/dizustu-islemci-karsilastirma',
      author: 'Deniz Arslan', readMin: 8, publishedAt: '2026-10-30T17:40:00+03:00', relatedSku: 'TEK-LAP-014',
      body: [
        'Karşılaştırmada 14 inçlik, 1,2 kg ağırlığındaki Nova 14 dizüstünü referans kasa olarak kullandık. Her işlemci 28 W sürekli güç limitiyle çalıştı; ekran parlaklığı 150 nit’e sabitlendi.',
        'Ofis ve web tarama senaryosunda verimlilik çekirdekleri ağırlıklı mimariler öne çıktı: en iyi sonuç 18 saat 20 dakikalık pil ömrüyle geldi. Video düzenleme ve derleme testlerinde ise yüksek saat hızlı performans çekirdekleri yüzde 22’ye varan avantaj sağladı.',
        'Yerleşik yapay zekâ hızlandırıcıları (NPU) artık her modelde var, ancak bunları kullanan uygulama sayısı hâlâ sınırlı. Görüntülü görüşmede arka plan bulanıklaştırma ve gürültü engelleme NPU’ya devredildiğinde pil tüketimi yaklaşık yüzde 15 azaldı.',
        'Gün boyu taşınacak bir cihaz arıyorsanız verimlilik odaklı işlemciler, yoğun içerik üretimi içinse yüksek güç limitli modeller daha mantıklı bir tercih.'
      ]
    },
    {
      id: 'a-eko', category: 'ekonomi', title: 'Faiz kararı sonrası piyasalarda ilk gün',
      excerpt: 'Politika faizindeki 250 baz puanlık indirimin ardından borsa günü yükselişle tamamladı. Mevduat faizlerinde ilk düşüşler gelirken kredi tarafında bankaların adımları bekleniyor.',
      path: '/ekonomi/faiz-karari-ilk-gun',
      author: 'Selin Öztürk', readMin: 5, publishedAt: '2026-10-31T09:05:00+03:00', relatedSku: null,
      body: [
        'Beklentilere paralel gelen 250 baz puanlık indirim piyasalarda büyük ölçüde fiyatlanmıştı. Buna rağmen gün içinde bankacılık hisselerinde belirgin bir alım dalgası görüldü ve ana endeks günü yüzde 2,1 yükselişle kapattı.',
        'Mevduat tarafında bazı bankalar 32 günlük vadeli hesap oranlarını 100–150 baz puan aşağı çekti. Uzmanlar, kredi faizlerindeki düşüşün daha yavaş ve seçici olacağını, özellikle taşıt ve konut kredilerinde bankaların önce talebi izleyeceğini belirtiyor.',
        'Kredi kartlarında azami faiz oranları ayrıca belirlendiğinden kart kullanıcılarının karardan doğrudan etkilenmesi beklenmiyor. Yine de aidatsız ve puan ağırlıklı kart kampanyalarının artması öngörülüyor.',
        'Analistler, bir sonraki toplantıya kadar enflasyon verilerinin ve kur hareketlerinin yön belirleyici olacağı görüşünde.'
      ]
    },
    {
      id: 'a-beb', category: 'anne-bebek', title: 'Bebek arabası seçerken 7 ipucu',
      excerpt: 'Ağırlık, katlanma mekanizması, tekerlek yapısı ve oto koltuğu uyumu… Bebek arabası alırken çoğu ailenin sonradan fark ettiği yedi noktayı uzmanlara sorduk.',
      path: '/anne-bebek/bebek-arabasi-secimi',
      author: 'Elif Demir', readMin: 4, publishedAt: '2026-10-29T11:30:00+03:00', relatedSku: 'BEB-ARB-007',
      body: [
        'Ağırlığı hafife almayın: toplu taşıma ve apartman merdiveni kullanan aileler için 8 kg altı modeller günlük hayatı belirgin şekilde kolaylaştırıyor. Katlanma mekanizmasını mağazada tek elle deneyin; bebek kucağınızdayken ikinci eliniz boşta olmayacak.',
        'Tekerlekler yaşadığınız yere uygun olsun: Arnavut kaldırımı ve bozuk yollarda büyük, amortisörlü tekerlekler fark yaratır. Oto koltuğu uyumu (travel sistem) varsa uyuyan bebeği uyandırmadan arabadan araca taşıyabilirsiniz.',
        'Sırtlığın tam yatar konuma gelmesi yenidoğan için şart. Geniş güneşlik ve havalandırma penceresi yaz aylarında konforu artırır. Son olarak katlanmış ölçüyü not alın: arabanız bagaja sığmıyorsa diğer tüm avantajlar anlamını yitirir.',
        'Uzmanlar, mümkünse satın almadan önce arabayı birkaç gün denemeyi, ikinci el ürünlerde ise fren ve kilit mekanizmasını mutlaka kontrol etmeyi öneriyor.'
      ]
    }
  ];

  D.products = [
    { sku: 'OTO-EV-001',  name: 'Volta e-SUV Long Range',             category: 'otomobil',   priceTL: 1890000, path: '/pazar/volta-e-suv',
      brand: 'Volta Otomotiv', desc: '610 km menzil (WLTP), ısı pompası, 150 kW hızlı şarj.', lineItemId: 101 },
    { sku: 'TEK-LAP-014', name: 'Nova 14 Dizüstü',                    category: 'teknoloji',  priceTL: 32999,   path: '/pazar/nova-14',
      brand: 'TeknoPark', desc: '14 inç ekran, 1,2 kg, 18 saate varan pil ömrü.', lineItemId: 103 },
    { sku: 'BEB-ARB-007', name: 'Minik Adımlar Travel Bebek Arabası', category: 'anne-bebek', priceTL: 8499,    path: '/pazar/travel-bebek-arabasi',
      brand: 'Minik Adımlar', desc: '7,2 kg, tek elle katlanır, oto koltuğu uyumlu travel sistem.', lineItemId: 106 }
  ];

  D.categoryLabels = { otomobil: 'Otomobil', teknoloji: 'Teknoloji', ekonomi: 'Ekonomi', 'anne-bebek': 'Anne & Bebek' };
  /** Ek: ana sayfa bağlamı etiketi (ad_request category = 'anasayfa'). */
  D.contextLabels = { otomobil: 'Otomobil', teknoloji: 'Teknoloji', ekonomi: 'Ekonomi', 'anne-bebek': 'Anne & Bebek', anasayfa: 'Ana sayfa' };

  /* ------------------------------------------------------------------
   * 5.9 Demo kimlik ve partner
   * ------------------------------------------------------------------ */
  D.demoUser = {
    email: 'ayse.yilmaz@posta.example',
    seedPersonId: 'P-7Q2K', seedIds: [{ type: 'maid', value: 'idfa-4C1E-9A7B' }],
    seedSegments: [2001, 2002], seedAttrs: { ilkGorulme: '2026-07-14', cihaz: 'iOS uygulama' },
    displayName: 'Ayşe Yılmaz'
  };

  D.partner = {
    id: 'perakendeci-x', name: 'Perakendeci X', records: 12400, publisherHems: 48000, baseMatches: 3180,
    epsilonPerRun: 0.5, epsilonBudget: 10, k: 50, minSegment: 1000,
    // Ek alanlar (04-data-clean-room.md ile uyumlu)
    collaborationId: 'collab_2026_perakendecix_q4', purpose: 'kampanya_olcumleme_ve_aktivasyon',
    matching: 'tee_hash_join', keys: ['hem'], templates: ['overlap_report', 'audience_activation'],
    validFrom: '2026-10-01', validTo: '2027-01-31', delta: 1e-9, segmentId: 9001,
    includesDemoEmail: true   // partner listesi demo e-postasının hash'ini içerir
  };

  /* ------------------------------------------------------------------
   * Ek: Kafka konuları (SPEC §6.6, 05-veri-modeli.md §5.6)
   * ------------------------------------------------------------------ */
  D.topics = {
    'raw.web_events':      { id: 'raw.web_events',      partitions: 96,  line: 'dmp',       key: 'tenant+device',     retention: '3 gün',     startOffset: 18204551, desc: 'Collector çıkışı' },
    'enriched.events':     { id: 'enriched.events',     partitions: 96,  line: 'dmp',       key: 'tenant+person',     retention: '7 gün',     startOffset: 17950322, desc: 'Flink zenginleştirme çıkışı' },
    'ad.decisions':        { id: 'ad.decisions',        partitions: 128, line: 'ad',        key: 'tenant+request',    retention: '3 gün',     startOffset: 52811094, desc: 'Ad server asenkron karar kaydı' },
    'ad.events':           { id: 'ad.events',           partitions: 64,  line: 'measure',   key: 'tenant+impression', retention: '7 gün',     startOffset: 40377210, desc: 'Tracking: imp, viewable, click, conversion' },
    'dmp.segment_changes': { id: 'dmp.segment_changes', partitions: 48,  line: 'dmp',       key: 'tenant+person',     retention: '3 gün',     startOffset: 3120877,  desc: 'Segment üyelik değişiklikleri' },
    'identity.merges':     { id: 'identity.merges',     partitions: 24,  line: 'dmp',       key: 'tenant+person',     retention: '30 gün',    startOffset: 412009,   desc: 'Kişi birleştirme olayları' },
    'config.adserver':     { id: 'config.adserver',     partitions: 12,  line: 'control',   key: 'tenant',            retention: 'compacted', startOffset: 88214,    desc: 'Line item snapshot / delta' },
    'privacy.dsar':        { id: 'privacy.dsar',        partitions: 12,  line: 'privacy',   key: 'tenant+person',     retention: '30 gün',    startOffset: 10533,    desc: 'Silme / erişim talepleri' }
  };

  /* ------------------------------------------------------------------
   * Ek: Türkçe etiketler
   * ------------------------------------------------------------------ */
  D.labels = {
    consentStatus: { unknown: 'Henüz seçilmedi', all: 'Tümü kabul edildi', necessary: 'Yalnızca zorunlu', reject: 'Reddedildi' },
    consentChoice: { all: 'Tümünü kabul et', necessary: 'Yalnızca zorunlu', reject: 'Reddet' },
    consentPurposes: { storage: 'Cihazda bilgi saklama', measurement: 'Ölçüm ve analitik', profiling: 'Profilleme', personalizedAds: 'Kişiselleştirilmiş reklam' },
    segmentKind: { realtime: 'Gerçek zamanlı', batch: 'Batch', crm: 'CRM', clean_room: 'Clean room', behavioral: 'Davranışsal' },
    lineItemType: { sponsorship: 'Sponsorluk', standard: 'Standart (garantili)', preferred_deal: 'Preferred deal', price_priority: 'Price priority', house: 'House' },
    pricing: { CPM: 'CPM · 1.000 gösterim', CPC: 'CPC · tıklama', CPA: 'CPA · dönüşüm' },
    pacing: { even: 'Eşit', asap: 'Mümkün olan en hızlı' },
    status: { active: 'Aktif', paused: 'Durduruldu' },
    winnerSource: { direct: 'Direct', prebid: 'Programatik', house: 'House' },
    bidStatus: { won: 'kazandı', lost: 'kaybetti', nobid: 'teklif yok', timeout: 'zaman aşımı' },
    candidateStatus: { won: 'kazandı', lost: 'kaybetti', filtered: 'elendi' },
    narrateKind: { info: 'bilgi', ok: 'tamam', warn: 'uyarı', drop: 'atıldı' },
    idType: { fpc: '1P çerez', hem: 'hash’li e-posta', maid: 'mobil reklam kimliği' }
  };

  /* ------------------------------------------------------------------
   * Yardımcı haritalar
   * ------------------------------------------------------------------ */
  function indexBy(arr, key) {
    var m = {};
    for (var i = 0; i < arr.length; i++) m[arr[i][key]] = arr[i];
    return m;
  }
  D.nodeById = indexBy(D.nodes, 'id');
  D.edgeById = indexBy(D.edges, 'id');
  D.segmentById = indexBy(D.segments, 'id');
  D.lineItemById = indexBy(D.lineItems, 'id');
  D.bidderById = indexBy(D.bidders, 'id');
  D.articleById = indexBy(D.articles, 'id');
  D.productBySku = indexBy(D.products, 'sku');

  /** edgeBetween(a, b) -> { edge, reversed } | null  (reversed: paket edge.to → edge.from yönünde gider) */
  D.edgeBetween = function (a, b) {
    var e = D.edgeById[a + '-' + b];
    if (e) return { edge: e, reversed: false };
    e = D.edgeById[b + '-' + a];
    if (e) return { edge: e, reversed: true };
    return null;
  };

  /** Ek: bir istasyona bağlı kenarlar. */
  D.edgesOf = function (nodeId) {
    return D.edges.filter(function (e) { return e.from === nodeId || e.to === nodeId; });
  };
  /** Ek: bir istasyondan geçen hatlar (lineOrder sırasıyla). */
  D.linesOf = function (nodeId) {
    var set = {};
    D.edgesOf(nodeId).forEach(function (e) { e.lines.forEach(function (l) { set[l] = 1; }); });
    return D.lineOrder.filter(function (l) { return set[l]; });
  };

  /* Bütünlük denetimi (yalnızca uyarı) */
  (function selfCheck() {
    var problems = [];
    D.edges.forEach(function (e) {
      if (!D.nodeById[e.from]) problems.push('edge ' + e.id + ': bilinmeyen from');
      if (!D.nodeById[e.to]) problems.push('edge ' + e.id + ': bilinmeyen to');
      e.lines.forEach(function (l) { if (!D.lines[l]) problems.push('edge ' + e.id + ': bilinmeyen hat ' + l); });
    });
    D.nodes.forEach(function (n) { if (!D.zones[n.zone]) problems.push('node ' + n.id + ': bilinmeyen bölge'); });
    if (problems.length && typeof console !== 'undefined') console.warn('[SIM.data] tutarsızlık:', problems);
  })();

  SIM.data = D;
})(window.SIM);

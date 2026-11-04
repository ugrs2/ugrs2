# 8. Yol Haritası ve Ekip

## 8.1 Fazlar

Süreler, bu işe ayrılmış çekirdek bir ekip varsayımıyla kaba tahmindir ve Faz 0 sonunda netleşir. Her faz kendi başına değer üretir.

| Kilometre taşı | Tahmini süre (başlangıçtan) |
|----------------|-----------------------------|
| Doğrudan satış canlıda (Faz 1 sonu) | ~5–7 ay |
| RTB canlıda (Faz 2 sonu) | ~9–13 ay |
| Türkiye ağı (Faz 3 sonu) | ~14–19 ay |

```mermaid
gantt
    title AdTech Platformu - Fazlar
    dateFormat  YYYY-MM-DD
    axisFormat  %b %Y

    section Faz 0 - Keşif
    Pazar, gelir modeli, rakip analizi          :f0a, 2026-11-01, 60d
    Mimari doğrulama, yap/al kararı, PoC        :f0b, 2026-11-15, 45d

    section Faz 1 - Ad Server Pilotu
    Temel altyapı: Kafka, ClickHouse, K8s, CI/CD :f1a, 2027-01-01, 45d
    Kontrol düzlemi + Admin UI                   :f1b, 2027-01-15, 75d
    Karar motoru, targeting index, fcap (Aerospike) :f1c, 2027-02-01, 75d
    Pacing, tracking, GIVT filtresi, raporlama   :f1d, 2027-03-01, 75d
    Kontekstüel servis + kreatif optimizasyonu   :f1e, 2027-02-15, 75d

    section Faz 2 - Exchange ve RTB
    Ad Exchange + OpenRTB 2.6 (harici DSP'ler)   :f2a, 2027-05-15, 120d
    Prebid Server + header bidding               :f2b, 2027-06-01, 60d
    PMP / PG deal, dinamik floor                 :f2c, 2027-07-15, 75d
    DMP ilk sürüm: identity, profil, segmentler  :f2d, 2027-05-15, 120d

    section Faz 3 - DSP ve Türkiye Ağı
    Self-servis DSP + reklamveren paneli         :f3a, 2027-10-15, 150d
    Yayıncı onboarding + yayıncı paneli          :f3b, 2027-11-01, 90d
    Faturalama, ödeme, hakediş, mutabakat        :f3c, 2027-11-01, 120d
    Video (VAST 4, OMID), ML (pCTR, bid shading, SIVT) :f3d, 2027-12-01, 120d
    Ürün kataloğu, dinamik kreatif, atıflama     :f3e, 2027-12-15, 120d

    section Faz 4 - Global ve Clean Room
    Çok dil, çok para birimi, GDPR               :f4a, 2028-04-01, 120d
    AB bölgesi + satış ortakları                 :f4b, 2028-05-01, 120d
    Clean room: TEE, politika, DP, aktivasyon    :f4c, 2028-04-01, 180d
```

## 8.2 Faz Detayları

### Faz 0 — Keşif (≈ 1–2 ay)
- **Pazar ve gelir modeli:** Türkiye'de yayıncı ve reklamveren potansiyeli, komisyon (take rate) oranı, rakipler.
- **Mimari ve yap/al kararı:** Açık kaynak bileşenlerle (Prebid Server vb.) sıfırdan geliştirmenin karşılaştırması; sayaç deposu kararı (Aerospike / Redis, [9.4.4](09-exchange-ve-dsp.md#944-sayaç-deposu-karar-noktası)).
- **Ekip, bütçe ve takvim:** Faz 1 ve 2 için kesin kaynak ve tarih planı.
- **Çıktı:** İş planı ve onaylı mimari.

### Faz 1 — Ad Server Pilotu (≈ 4–5 ay)
- Temel altyapı: Kafka + Schema Registry + Protobuf olay sözleşmeleri, Collector + `collect.js` + CMP entegrasyonu (KVKK banner, TCF 2.2), Flink, ClickHouse, Iceberg, Kubernetes, gözlemlenebilirlik.
- **Kendi sitelerimizde** reklamveren / kampanya / line item / kreatif yönetimi (UI + API, yalnızca ad ops).
- Karar motoru: targeting index, öncelik katmanları, fcap, even pacing; kontekstüel hedefleme.
- Aerospike kümesi bu fazda kurulur: fcap sayaçları profil kaydının `fcap` alanında, anahtar olarak henüz identity graph olmadığı için doğrudan 1P cookie / MAID (`{tenant_id}:{id_type}:{id_value}`) kullanılır. Faz 2'de `person_id`'ye geçişte sayaçlar merge sırasında taşınır.
- Display kreatifler, imzalı tracking, dedup, GIVT filtresi (bot listesi, veri merkezi IP).
- Saatlik raporlama (ClickHouse), "neden bu reklam" debug aracı.
- **Kontekstüel servis** (Türkçe sınıflandırma, marka güvenliği, URL önbelleği): rızasız trafik ilk günden var, pilotun gelirini bu belirler ([2.10](02-ad-server.md#210-kontekstüel-hedefleme)).
- Kreatif optimizasyonu (Thompson sampling).
- **Çıktı:** Doğrudan satış kampanyaları kendi sitelerimizde canlı trafikte teslim ediliyor.

### Faz 2 — Exchange ve RTB (≈ 4–6 ay)
- Ad Exchange: ön filtre, traffic shaping, birinci fiyat açık artırma, `nurl` / `burl` / `lurl`, komisyon kaydı ([9.3](09-exchange-ve-dsp.md#93-ad-exchange)).
- OpenRTB 2.6 ile harici DSP'lerin bağlanması ([9.5](09-exchange-ve-dsp.md#95-openrtb-entegrasyon-sözleşmesi-harici-dspler)); Prebid.js / Prebid Server ile header bidding.
- PMP / PG deal'ler, dinamik floor, ads.txt / sellers.json / schain; pViewable modeli (vCPM ve dinamik floor için).
- **DMP ilk sürüm:** Identity graph (deterministik), `idmap`, profil kaydının tamamı (segment, attrs, consent); fcap anahtarlarının `person_id`'ye taşınması; gerçek zamanlı + batch segment motoru, Theta sketch ile erişim tahmini; segmentlerin teklif isteğine eklenmesi.
- **Çıktı:** Programatik gelir; 1P kitle hedefleme ve birleşik açık artırma.

### Faz 3 — DSP ve Türkiye Ağı (≈ 5–6 ay)
- **Kendi DSP'miz:** Teklif motoru, teklif stratejileri, bid shading, bütçe koruması; self-servis reklamveren paneli ([9.4](09-exchange-ve-dsp.md#94-kendi-dspmiz)).
- **Türkiye ağı:** Dış yayıncıların onboarding'i, yayıncı paneli ve getiri optimizasyonu ([2.9](02-ad-server.md#29-yayıncı-paneli-ve-ağa-katılım)).
- **Ödeme ve hakediş:** Defter, ön ödeme / kredi limiti, e-fatura, yayıncı hakedişi, IVT iadesi, mutabakat ([10](10-faturalama-ve-para-akisi.md)).
- **Video:** VAST 4.x, OM SDK ile görünürlük ölçümü.
- **ML ve kalite:** pCTR / pCVR modelleri, garantili teslimat için allocation plan, envanter forecast, SIVT ML modeli, yayıncı kalite puanı, marka güvenliği entegrasyonları.
- Dış aktivasyon: DSP segment push, Meta / Google hashed kitleler.
- Ürün kataloğu ve dinamik kreatif, atıflama modeli ([9.4.8–9.4.9](09-exchange-ve-dsp.md#948-ürün-kataloğu-ve-dinamik-kreatif)).
- Segment pazar yeri ve veri ücreti ([10.4](10-faturalama-ve-para-akisi.md#104-komisyon-ve-gelir-paylaşımı)).
- Sürekli holdout ve artımlılık raporu; yeterli veri birikince uplift modeli ([9.4.10](09-exchange-ve-dsp.md#9410-artımlılık-ve-uplift)). Erişim ve frekans planlama.
- **Çıktı:** İki taraflı pazar yeri: dış yayıncılar ve self-servis reklamverenler.

### Faz 4 — Global ve Clean Room (≈ 6+ ay)
- **Global:** Çok dil, çok para birimi (TRY / USD / EUR ve genişleme), GDPR uyumu (DPIA, AB temsilcisi), AB bölgesi ([6.2](06-altyapi-ve-teknoloji.md#62-dağıtım-topolojisi)), yurt dışı satış ortakları.
- **Clean room ve ileri ölçümleme:** Gizli VM üzerinde clean room, Uploader CLI, PSI; politika motoru, sorgu şablonları, DP bütçe yönetimi, audit; opak segment aktivasyonu, satış lift / incrementality, retail media kapalı döngü ölçümleme; lookalike ve propensity segmentleri.
- **Çıktı:** Yurt dışı pazar ve reklamverenlerle gizlilik korumalı veri işbirliği.

## 8.3 Bilinçli Olarak Ertelenenler
- Olasılıksal kimlik eşleştirme ve fingerprinting: ertelenmedi, **kapsam dışı** ([3.3](03-dmp.md#33-kimlik-çözümleme-identity-resolution))
- CTV / SSAI (Faz 4 sonrası)
- Self-servis reklamveren paneli Faz 3'e kadar yok (Faz 1–2: yalnızca operasyon ekibi)
- Çok para birimi: Faz 1–2'de TRY + USD (günlük TCMB kuru); EUR ve tam çok para birimi defteri Faz 3–4
- Çok bölgeli aktif-aktif: Faz 4'e kadar tek bölge + felaket kurtarma yedeği

## 8.4 Ekip Yapısı (Önerilen)

| Ekip | Rol | Kişi (yaklaşık) |
|------|-----|-----------------|
| **Ad Serving** | Go/Rust backend, düşük gecikme uzmanlığı | 4–6 |
| **Exchange & Programmatic** | Ad Exchange, OpenRTB, Prebid, harici DSP/SSP entegrasyonları | 3–4 |
| **DSP** | Teklif motoru, bid shading, reklamveren paneli | 3–4 |
| **Data Platform** | Kafka, Flink, ClickHouse, Iceberg | 3–4 |
| **DMP / Identity** | Identity graph, segment motoru | 3 |
| **ML** | CTR/CVR, IVT, forecast, bid shading, lookalike | 2–3 |
| **Billing / Finans Müh.** | Defter, faturalama, hakediş, mutabakat | 2 |
| **Clean Room / Privacy Eng.** | Kriptografi, TEE, DP | 2 |
| **Control Plane / Frontend** | Admin UI, yayıncı paneli, API | 3 |
| **SRE / Platform** | Kubernetes, gözlemlenebilirlik, güvenlik | 2–3 |
| **Ürün / Ad Ops / Hukuk / Finans** | Ürün yönetimi, kampanya ve yayıncı operasyonu, KVKK uyumu (DPO), vergi | 4–5 |

## 8.5 Başarı Metrikleri (KPI)

- **Fill rate** ve **eCPM** artışı (mevcut çözüme göre)
- Programatik gelir ve platform komisyon geliri
- Ağdaki yayıncı ve aktif reklamveren sayısı; bağlı harici DSP sayısı
- DSP bid rate, win rate ve timeout oranı
- 1P kimlik oranı (kimliği çözülmüş istek yüzdesi)
- Segment eşleşme oranı ve segmentli kampanyaların CTR/CVR farkı
- Garantili kampanyalarda teslimat doğruluğu (%98–102)
- IVT oranı
- Mutabakat farkı (aylık üç taraflı)
- Clean room collaboration sayısı ve ölçülen lift
- Altyapı maliyeti / 1000 istek

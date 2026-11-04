# 9. Ad Exchange ve DSP

[Ad Server](02-ad-server.md) bölümü yayıncı (arz) tarafını anlatır. Platform yalnızca kendi envanterini satan bir ad server değil, alıcı ile satıcıyı buluşturan bir **pazar yeri** olarak tasarlanır. Bu bölüm o pazar yerinin iki parçasını tanımlar:

- **Ad Exchange:** Yayıncının satışa açtığı her gösterimi gerçek zamanlı açık artırmaya çıkarır ve teklif isteğini DSP'lere dağıtır.
- **Kendi DSP'miz:** Reklamverenlerin self-servis panelden kampanya kurup her teklif isteğine fiyat verdiği talep tarafı ürünüdür.

Harici DSP'ler Exchange'e OpenRTB 2.6 ile bağlanır. Kendi DSP'miz de Exchange'e **harici bir DSP gibi** bağlanır.

## 9.1 Roller ve Sınırlar

| Bileşen | Taraf | Sorumluluk | Kim kullanır |
|---------|-------|-----------|--------------|
| **Ad Server + SSP** | Arz | Envanteri tanımlar, doğrudan kampanyaları yönetir, son kararı verir ([2](02-ad-server.md)) | Yayıncı, ad ops |
| **Ad Exchange** | Pazar yeri | Teklif isteğini dağıtır, açık artırmayı yürütür, komisyonu kaydeder | Platform |
| **DSP (bizim)** | Talep | Kampanya, hedefleme, bütçe ve teklif fiyatı | Reklamveren, ajans |
| **Harici DSP'ler** | Talep | Kendi kampanyaları için OpenRTB ile teklif verir | Dış alıcılar |

**Çıkar çatışması kuralları.** Exchange'i işleten taraf aynı zamanda bir DSP işletir. Harici alıcıların güveni için şu kurallar teknik olarak zorlanır:

1. Kendi DSP'miz Exchange'e diğer DSP'lerle **aynı API, aynı timeout ve aynı açık artırma kuralları** ile bağlanır; ayrıcalıklı bir yol yoktur.
2. DSP, başka DSP'lerin tekliflerini ve kaybetme fiyatlarını göremez. Yalnızca OpenRTB'nin her alıcıya verdiği sinyalleri (`lurl` kaybetme nedeni, kazandıysa ödenen fiyat) alır.
3. Exchange teklif logları ayrı bir veri alanında tutulur; DSP ekibinin erişimi IAM ile kapalıdır ve denetlenir.
4. Açık artırma kuralları (birinci fiyat, taban fiyat, eşitlik durumu) alıcılara yazılı olarak yayınlanır.

## 9.2 Uçtan Uca Akış

```mermaid
sequenceDiagram
    autonumber
    participant P as Sayfa / App
    participant AS as Ad Server (karar motoru)
    participant X as Ad Exchange
    participant OD as DSP (bizim)
    participant HD as Harici DSP'ler
    participant K as Kafka (async)

    P->>AS: Ad request
    AS->>AS: Rıza, profil, garantili aday line item'lar
    AS->>X: Teklif isteği (ad unit, floor, segmentler, schain, deal id)
    X->>X: Ön filtre: IVT, blok listesi, rıza, ads.txt
    X->>X: DSP seçimi (traffic shaping)
    par Paralel dağıtım (tmax ≈ 100 ms)
        X->>OD: OpenRTB BidRequest
        OD-->>X: BidResponse (fiyat + kreatif)
    and
        X->>HD: OpenRTB BidRequest
        HD-->>X: BidResponse listesi
    end
    X->>X: Birinci fiyat açık artırma + floor
    X-->>AS: Exchange kazananı (fiyat, kreatif, deal)
    AS->>AS: Birleşik açık artırma: garantili gölge fiyat vs Exchange kazananı vs Prebid
    AS-->>P: Kreatif + imzalı tracking URL'leri
    X--)K: rtb.auctions (async)
    P->>X: Render sonrası burl (faturalanabilir gösterim)
    X--)OD: nurl / lurl bildirimleri
```

- Exchange, ad server'ın [birleşik açık artırmasına](02-ad-server.md#235-birleşik-açık-artırma) **tek bir katılımcı** olarak girer; Prebid Server teklifleri ve doğrudan line item'lar ile **yayıncıya kalan net** değer üzerinden yarışır (Exchange kazananı `fiyat × (1 − take rate)` olarak).
- Garantili kampanya hedefinin gerisindeyse gölge fiyatı yüksek olur ve Exchange teklifini geçer. Bu, sunumdaki "dinamik tahsis" kuralının karşılığıdır.

## 9.3 Ad Exchange

### 9.3.1 Ön filtre
- **IVT (teklif öncesi):** Kontrol ad server'da bir kez yapılır ([2.6](02-ad-server.md#26-ivt-geçersiz-trafik-ve-marka-güvenliği)); şüpheli istek Exchange'e hiç gelmez. Exchange yeniden kontrol etmez, yalnızca ad server'ın `ivt_flag`'ini okur. Harici SSP'lerden gelen istekler için kendi itibar skorunu uygular.
- **Yetkili satıcı:** `ads.txt` / `app-ads.txt` ve `sellers.json` günlük bir tarama işiyle kontrol edilir; istek anında yalnızca önbellekteki "alan adı → yetkili mi" sonucu okunur. Yetkisizse istek reddedilir.
- **Blok listeleri:** Yayıncının rakip marka (`badv`), kategori (`bcat`) ve kreatif özellik (`battr`) blokları isteğe yazılır.
- **Rıza:** TCF / GPP dizesi ve KVKK açık rızası isteğe eklenir; vendor izni olmayan DSP'ye `user.eids` ve `user.data` gönderilmez ([7.2](07-gizlilik-ve-uyum.md#72-rıza-consent-sorumluluk-ve-akış)).

### 9.3.2 DSP seçimi (traffic shaping)
Her isteği her DSP'ye göndermek bant genişliği ve işlem maliyetini katlar; DSP'ler de kendilerine uymayan trafiği istemez.

- **Pretargeting:** Her DSP bağlantısı için kabul edilen ülke, format, boyut, cihaz ve deal listesi. Uymayan istek o DSP'ye gönderilmez.
- **QPS limiti:** DSP başına sözleşmedeki saniyelik istek sınırı; aşan kısım örneklenir.
- **Öğrenen kısma:** Son 24 saatte segment (ülke × format × ad unit) bazında teklif oranı ve kazanma oranı düşük olan DSP'ye o segmentten daha az istek gönderilir. Keşif için her zaman küçük bir pay (ör. %5) gönderilmeye devam eder.

### 9.3.3 Zaman yönetimi
- DSP'ye tanınan süre OpenRTB `tmax` alanıyla bildirilir: **varsayılan 100 ms**, yayıncı ve format bazında ayarlanabilir.
- Süresi dolan DSP beklenmez; geç gelen yanıt kayda "timeout" olarak geçer ve kısma skorunu düşürür.
- Hedef: ziyaretçi reklamı istekten itibaren **200 ms içinde** görür. Bütçe için bkz. [9.6](#96-gecikme-bütçesi).

### 9.3.4 Açık artırma
- **Mekanizma:** Birinci fiyat (kazanan kendi teklifini öder).
- **Taban fiyat:** Ad unit taban fiyatı ile Exchange'in dinamik taban fiyatının büyüğü. Yayıncının girdiği taban **net**tir; DSP'lere brüt olarak gider: `bidfloor` = net taban ÷ (1 − take rate). Taban altındaki teklifler elenir; kaybetme nedeni `lurl` ile bildirilir.
- **Deal'ler:** PG ve PMP deal'lerine ait teklifler (`pmp.deals`) önce kendi kuralıyla (sabit fiyat ya da deal floor) değerlendirilir; açık artırma teklifleri sonra gelir.
- **Para birimi:** Teklifler `bidcur` ile gelir; karşılaştırma günlük kurla tek para birimine (TRY) çevrilerek yapılır ([10.6](10-faturalama-ve-para-akisi.md#106-çok-para-birimi)).
- **Eşitlik:** Aynı fiyatta önce deal, sonra daha yüksek tarihsel görünürlük, sonra rastgele.
- **Aynı alıcı:** Bir DSP aynı gösterime birden çok seat ya da yolla teklif verirse seat + `adomain` ile tekilleştirilir; alıcı kendi fiyatını yükseltmez.

### 9.3.5 Bildirimler ve komisyon
- `nurl` (kazandı), `burl` (faturalanabilir: kreatif render edildi) ve `lurl` (kaybetti, nedeniyle) bildirimleri gönderilir. **Faturalama `burl` üzerinden yapılır**; kazanıp render edilmeyen gösterim faturalanmaz.
- **Komisyon (take rate):** Platformun geliri, kazanan fiyattan alınan paydır. Yayıncıya kalan = kazanan fiyat × (1 − take rate). Oran yayıncı sözleşmesinde tanımlıdır ve her açık artırma kaydında saklanır ([10.4](10-faturalama-ve-para-akisi.md#104-komisyon-ve-gelir-paylaşımı)).
- **Şeffaflık:** Exchange kendi düğümünü `source.schain` nesnesine ekler; ağdaki yayıncılar platformun `sellers.json` dosyasında listelenir.

## 9.4 Kendi DSP'miz

### 9.4.1 Teklif akışı
DSP her teklif isteği için şu beş adımı milisaniyeler içinde yapar (hedef p99 < 20 ms, Exchange'in `tmax`'ının çok altında):

| # | Adım | Nasıl |
|---|------|------|
| 1 | Teklif isteği gelir | OpenRTB 2.6 parse; rıza ve vendor izni kontrolü |
| 2 | Hedefleme eşleşmesi | Ad server ile **aynı** conjunction index kütüphanesi ([2.3.1](02-ad-server.md#231-targeting-index)); kitle bilgisi teklif isteğindeki `user.data` / deal ID'den okunur, profil deposuna gidilmez |
| 3 | Bütçe ve harcama hızı | Günlük / toplam bütçe, pacing throttle ([2.3.3](02-ad-server.md#233-pacing-bütçe--teslimat-hızı) ile aynı PID kontrolcü) |
| 4 | Frekans sınırı | Kullanıcı başına sayaç ([2.3.2](02-ad-server.md#232-frequency-capping) ile aynı kova yapısı); kapsamı için bkz. [9.4.6](#946-kimlik-kapsamı-kiracı-izolasyonu) |
| 5 | Fiyat ve yanıt | Teklif stratejisine göre fiyat + **bid shading**; kreatif seçimi; yanıt |

### 9.4.2 Teklif stratejileri

| Strateji | Teklif fiyatı (CPM) |
|----------|---------------------|
| Sabit CPM | `hedef_cpm` |
| Hedef CPC | `hedef_cpc × pCTR × 1000` |
| Hedef CPA | `hedef_cpa × pCTR × pCVR × 1000` |
| Maksimum dönüşüm (bütçe sınırlı) | Bütçeyi gün sonuna kadar harcayacak dinamik çarpan × beklenen değer |

- **Bid shading:** Birinci fiyat açık artırmada değerin tamamını teklif etmek fazla ödemek demektir. DSP, kazanma olasılığı eğrisini (geçmiş kazan/kaybet ve ödenen fiyatlardan) öğrenir ve beklenen artığı en büyükleyen fiyatı verir. Model yalnızca DSP'nin kendi kazanma/kaybetme verisiyle eğitilir (9.1 kural 2).
- pCTR / pCVR modelleri ad server'daki ONNX altyapısını paylaşır; kalibrasyon şarttır.

### 9.4.3 Bütçe koruması
- Harcama, teklif anında değil **`burl` (faturalanabilir gösterim) geldiğinde** gerçekleşir. Teklif ile gösterim arasında açıkta kalan tutar için "rezervasyon sayacı" tutulur; bütçe kontrolü `harcanan + rezerve < bütçe` ile yapılır. Rezervasyon `burl` gelince harcamaya döner, `lurl` gelince silinir. Kazanıp render edilmeyen gösterimde ikisi de gelmez; bu yüzden her rezervasyonun **süresi (TTL ≈ 1 saat)** vardır ve dolunca kendiliğinden düşer. Aksi halde bütçe yavaş yavaş kilitlenir.
- Gerçek zamanlı harcama sayacı Flink'te tutulur; %95'te kampanya kısılır, %100'de durur. Reklamverenin ön ödeme bakiyesi ya da kredi limiti de aynı kontrolden geçer ([10.3](10-faturalama-ve-para-akisi.md#103-harcama-ve-bakiye-kontrolü)).

### 9.4.4 Sayaç deposu (karar noktası)
Bütçe, rezervasyon ve frekans sayaçları için iki seçenek vardır:

| Seçenek | Artı | Eksi |
|---------|------|------|
| **Aerospike** (DMP ile aynı küme, ayrı `dsp` namespace) | Tek KV teknolojisi, SSD üzerinde büyük hacim, XDR ile çok bölge | Operasyonu daha uzmanlık ister |
| **Redis Cluster** (sunumdaki seçim) | Ekip aşinalığı, atomik `INCRBY` / Lua, hızlı başlangıç | RAM maliyeti; kalıcılık ve çok bölge zayıf |

**Öneri:** Faz 0 keşfinde karar verilir. Varsayılan Aerospike'tır, çünkü profil ve fcap zaten orada ([5.3](05-veri-modeli.md#53-profil-kaydı-aerospike)). Redis seçilirse yalnızca DSP'nin kısa ömürlü bütçe ve rezervasyon sayaçları için kullanılır; kalıcı sayaçlar Flink ve ClickHouse'tan yeniden kurulabilir olmalıdır.

### 9.4.5 Reklamveren paneli (self-servis)
- **Hesap:** Ajans → reklamveren hiyerarşisi, kullanıcı rolleri, ön ödeme veya kredi limiti ([10](10-faturalama-ve-para-akisi.md)).
- **Kampanya kurulumu:** Hedef, bütçe, tarih, teklif stratejisi, hedefleme (coğrafya, cihaz, içerik kategorisi, kitle).
- **Kitle seçimi:** İki tür kitle vardır. Yayıncının izin verdiği segmentler yalnızca o yayıncının envanterinde geçerlidir. Reklamverenin kendi kitleleri (retargeting pikseli, CRM listesi) ortak kimlikle ağ genelinde eşleşir ([9.4.7](#947-reklamveren-kitleleri-ve-retargeting)). Yayıncı segmenti kullanan kampanya, medya fiyatına ek olarak segment sahibine bir veri ücreti öder ([10.4](10-faturalama-ve-para-akisi.md#104-komisyon-ve-gelir-paylaşımı)). Kişi verisi DSP'ye geçmez; segment, yayıncının envanterinde deal veya curated segment olarak hedeflenir ([3.6](03-dmp.md#36-aktivasyon)). Rıza amaçları olmayan kişiler segmentte yer almaz.
- **Kreatif:** Yükleme, otomatik tarama ve onay akışı ([2.4](02-ad-server.md#24-kreatif-ve-formatlar)); önizleme.
- **Ölçüm:** Anlık rapor (ClickHouse), dönüşüm pikseli ve S2S Conversion API, atıflama penceresi.

### 9.4.6 Kimlik kapsamı (kiracı izolasyonu)
Kimlik `tenant_id:person_id` olarak tutulur ve kiracılar arası birleştirme varsayılan olarak kapalıdır ([1.4](01-genel-mimari.md#14-çok-kiracılılık-multi-tenancy)); 1P cookie da her yayıncının kendi alan adındadır. Aynı kişi iki yayıncıda iki ayrı kişidir. DSP'nin kullanıcı bazlı kuralları buna göre sınırlanır:

- **Frekans sınırı:** Varsayılan kapsam **yayıncı başına**dır (sayaç anahtarı: tenant + yayıncıdaki kimlik + kampanya). Ağ genelinde frekans sınırı yalnızca kullanıcının rıza verdiği ortak bir kimlik (`user.eids`: hashed email, UID2) taşıyan isteklerde uygulanır.
- **Kitleler ve opak segmentler:** Yayıncı segmentleri ve clean room segmentleri yalnızca kaynak yayıncının envanterinde hedeflenir ([4.7](04-data-clean-room.md#47-aktivasyon-akışı-opak-segment)).
- **Bütçe ve pacing** kişiye değil kampanyaya bağlı olduğu için ağ genelinde çalışır.

### 9.4.7 Reklamveren kitleleri ve retargeting
Örnek: Hepsiburada'da iPhone sayfasına bakan kullanıcıya, daha sonra ağdaki X haber sitesinde Hepsiburada reklamı göstermek. Yayıncı segmentlerinden farklı olarak bu kitle **reklamverene aittir**: reklamverenin kendi sitesinden / uygulamasından gelir ve yalnızca onun kampanyalarında kullanılır.

**Temel kısıt:** 1P cookie her sitenin kendi alan adındadır; Hepsiburada'daki cookie ile X'teki cookie birbirini tanımaz ve fingerprint ile birleştirme yapılmaz ([3.3](03-dmp.md#33-kimlik-çözümleme-identity-resolution)). Retargeting ancak iki sitede de **aynı kişiyi tanıyan ortak bir kimlik** varsa çalışır.

```mermaid
sequenceDiagram
    autonumber
    participant U as Kullanıcı
    participant HB as Hepsiburada (reklamveren)
    participant PX as Piksel / S2S API
    participant AUD as DSP kitle deposu
    participant X as X haber sitesi (yayıncı)
    participant AS as Ad Server + Exchange
    participant D as DSP (bizim)

    U->>HB: iPhone ürün sayfası (giriş yapmış)
    HB->>PX: product_view + ortak kimlik (hashed email / UID2) — HB'nin CMP'si bizi listeler, rıza var
    PX->>AUD: kitle: "HB · 30 gün iPhone bakanlar" ← id_hash
    U->>X: Haber okur (giriş yapmış)
    X->>AS: Reklam isteği + rıza dizesi + X profilindeki hashed email
    AS->>D: BidRequest, user.eids (yalnızca rıza + vendor izni varsa)
    D->>AUD: eids → hangi reklamveren kitlelerinde?
    AUD-->>D: HB iPhone kitlesi
    D-->>AS: Retargeting kampanyasından teklif
    AS-->>X: Kazanırsa Hepsiburada reklamı
```

**Bileşenler**
- **Retargeting pikseli ve S2S olay API'si:** Reklamverenin sitesine kurulur; reklamverenin CMP'si platformu listeler ve rıza varsa yüklenir. Olaylar: ürün görüntüleme, sepete ekleme, satın alma (satın alanları kitleden çıkarmak için). Mobilde SDK ya da MMP postback'i (MAID).
- **Kitle deposu:** DSP sayaç deposunda ayrı bir set: anahtar `{id_type}:{id_hash}` → `{audience_id: bitiş}`. Teklif anında istekteki her `user.eids` için tek okuma (istek başına en fazla 3 kimlik). Kitle tanımları kontrol düzleminde `dsp_audiences` tablosunda (reklamveren, kaynak, kural, TTL).
- **Kampanya hedeflemesi:** Kitle dahil / hariç (ör. son 30 günde bakıp almayanlar), recency, ürün bazlı dinamik kreatif.

**Kurallar**
- **Kimlik yalnızca izinle gelir:** X'te kullanıcının rızası ve platformun vendor izni yoksa `user.eids` gönderilmez ([7.2](07-gizlilik-ve-uyum.md#72-rıza-consent-sorumluluk-ve-akış)); eşleşme olmaz, teklif normal hedeflemeye döner.
- **Veri karışmaz:** Reklamveren kitlesi yayıncının profiline yazılmaz; X, kullanıcının Hepsiburada'yı ziyaret ettiğini öğrenmez. Eşleşme yalnızca DSP içinde, teklif anında olur. Kitle başka bir reklamverenin kampanyasında kullanılamaz.
- **Raporlama:** Kitle bazlı raporlarda hücre eşiği (k) uygulanır; yayıncıya kitle adı gösterilmez.
- **Frekans:** Ortak kimlik olduğu için retargeting kampanyasında ağ genelinde frekans sınırı uygulanabilir ([9.4.6](#946-kimlik-kapsamı-kiracı-izolasyonu)).
- **Saklama:** Kitle üyeliği TTL'li (varsayılan 30 gün); silme talebinde kitle deposu da silinir (7.3).

**Kapsam beklentisi** (oranlar örnektir, pilotta ölçülmelidir)

| Ortak kimlik | Nasıl | Kapsam |
|---|---|---|
| Giriş + hashed email / UID2 | Kullanıcı iki sitede de giriş yapmış | En temiz yol; haber sitelerinde giriş oranı düşük (kabaca %5–15) |
| Mobil uygulama (MAID) | Reklamveren uygulaması + yayıncı uygulaması; iOS'ta ATT izni | Uygulamada iyi, webde yok |
| Clean room | Reklamveren müşteri listesini yükler, yayıncının giriş yapmış kullanıcılarıyla eşleşir ([4.7](04-data-clean-room.md#47-aktivasyon-akışı-opak-segment)) | Günlük; yalnızca o yayıncının envanterinde |
| Platform alan adında 3P cookie (opsiyonel) | Piksel ve reklam etiketi `ads.<platform>` cookie'sini paylaşır, rızayla | Yalnızca Chrome; Safari, iOS ve Firefox engeller. Ek kapsamdır, hiçbir işlev buna bağlanmaz |

Ortak kimlik yoksa retargeting yapılmaz; kampanya kontekstüel hedeflemeye (ör. teknoloji / alışveriş haberleri) ya da yayıncının kendi kitlelerine döner. Satışta retargeting, geniş bir "her ziyaretçiyi takip et" ürünü olarak değil, **giriş yapmış ve uygulama kullanıcıları + Chrome'da ek kapsam** olarak konumlanmalıdır.

### 9.4.8 Ürün kataloğu ve dinamik kreatif
E-ticaret ve retail media reklamverenleri için reklamın içeriği kişiye ya da sayfaya göre seçilen **üründür**.

- **Feed alımı:** Reklamveren ürün feed'ini (XML / CSV / Google Merchant formatı ya da API) saatlik gönderir. Alanlar: SKU, ad, kategori, fiyat, indirimli fiyat, stok, görsel, URL. Ham feed Iceberg'e, teklif anında gereken ürün kartı Aerospike `catalog` setine (SKU → kart), görseller CDN'e gider.
- **Ürün seçimi (kişi için):** Retargeting kitlesindeki kişi için gösterilecek ürünler **piksel olayı geldiğinde** önceden hesaplanır ve kitle kaydına yazılır: son bakılan ürün, aynı kategoride benzerleri (ürün embedding'i + ANN), fiyatı düşenler öne. Stokta olmayan elenir. Teklif anında öneri modeli çalışmaz; kitle okumasıyla birlikte liste gelir.
- **Ürün seçimi (sayfa için, kimliksiz):** Sayfa embedding'i ile ürün embedding'i eşleştirilir ([2.10](02-ad-server.md#210-kontekstüel-hedefleme)); ör. kamp haberinde çadır ürünleri.
- **Kreatif şablonu:** HTML5 şablon + ürün alanları; tarayıcıda ürün kartıyla doldurulur. Onay **şablon bazındadır** (her ürün ayrı onaylanmaz). Stoku biten ya da fiyatı değişen ürün en geç bir sonraki feed güncellemesinde düşer.

### 9.4.9 Atıflama (dönüşümün hangi reklama yazılacağı)
- **Kaynaklar:** Piksel ve S2S Conversion API; mobilde MMP postback'leri.
- **Kural:** Varsayılan son temas (last-touch). Tıklama sonrası pencere 7 gün; görüntüleme sonrası pencere 1 gün ve yalnızca **görüntülenebilir** gösterimler için. Pencereler kampanyada değiştirilebilir.
- **Tekilleştirme:** Aynı `order_id` bir kez sayılır. Aynı dönüşümü başka kanallar da (Meta, Google) kendine yazabilir; bizim raporumuz platform görünümüdür. CPA faturasında hangi kaynağın esas alınacağı (bizim atıflamamız ya da reklamverenin MMP / analitik kaydı, S2S'deki `attributed_to` alanı) sözleşmede belirlenir.
- **Kimliksiz trafik:** Dönüşüm kişiye atanmaz; kampanya × gün düzeyinde modellenmiş dönüşüm üretilir ve sürekli holdout ile (9.4.10) kalibre edilir. Modellenmiş dönüşüm faturalamada kullanılmaz, yalnızca rapor ve optimizasyon içindir.
- **Model etiketleri:** pCVR modeli yalnızca deterministik atıflanmış dönüşümlerle eğitilir.

### 9.4.10 Artımlılık ve uplift
Retargeting ve satın alma olasılığı yüksek kitleler, reklam görmeseler de alacak olan kişileri hedefleme eğilimindedir; atıflama satışı reklama yazar ve reklamveren fazla öder.

- **Sürekli holdout:** Her kampanyada varsayılan olarak kullanıcıların %5'i (kimlik hash'iyle deterministik atanır) reklam görmez; bu kişiler için "burada gösterilecekti" kaydı (ghost ad) tutulur. Retargeting kampanyalarında varsayılan açıktır; reklamveren sözleşmeyle kapatabilir.
- **Ölçüm:** Test ve holdout grupları atama bazında karşılaştırılır (intent-to-treat, [4.5](04-data-clean-room.md#45-sorgu-şablonu-örneği--satış-lift-analizi) ile aynı yöntem); kampanya raporunda "artımlı dönüşüm" ve "artımlı ROAS" gösterilir.
- **Uplift modeli:** Dönüşüm olasılığını değil, **reklamla ve reklamsız dönüşüm olasılığı farkını** tahmin eder (iki modelli yaklaşım; eğitim verisi holdout'tan). Teklif bu farka göre ölçeklenir: zaten alacak (yüksek pCVR, düşük uplift) kullanıcıya düşük teklif verilir.
- **Ne zaman:** Uplift modeli için kampanya başına yeterli holdout dönüşümü birikmelidir; o zamana kadar holdout yalnızca ölçüm için kullanılır.

## 9.5 OpenRTB Entegrasyon Sözleşmesi (Harici DSP'ler)

- **Protokol:** OpenRTB 2.6, JSON (gzip) üzerinden HTTP/2 keep-alive; yüksek hacimli DSP'ler için Protobuf opsiyonel.
- **Onboarding:** Teknik test ortamı, örnek trafik, QPS ve pretargeting tanımı, sözleşme (ödeme vadesi, veri kullanımı, KVKK veri işleyen hükümleri).
- **Zorunlu alanlar:** `imp`, `site/app`, `device`, `regs` (GDPR/GPP), `source.schain`, `tmax`, `cur`; rıza varsa `user.eids`, `user.data`.
- **Yanıt kuralları:** `adomain` ve `crid` zorunlu (rekabet ayrımı ve kreatif denetimi için); `burl` desteği zorunlu.
- **İzleme:** DSP başına teklif oranı, timeout oranı, kazanma oranı, hata oranı panosu; eşik aşımında otomatik kısma.

## 9.6 Gecikme Bütçesi

| Adım | Hedef |
|------|-------|
| Ad server ön karar (rıza, profil, garantili adaylar) | ≤ 15 ms |
| Exchange ön filtre + DSP seçimi | ≤ 5 ms |
| DSP'lere dağıtım ve yanıtlar (`tmax`) | ≤ 100 ms |
| Açık artırma + birleşik karar + yanıt | ≤ 10 ms |
| Ağ (kullanıcı ↔ edge) ve kreatif yükleme | ~70 ms |
| **Toplam (istekten reklamın görünmesine)** | **≤ 200 ms** |

Sunucu içi doğrudan karar bütçesi (DSP beklemeden) [6.3](06-altyapi-ve-teknoloji.md#63-gecikme-bütçesi-ad-request-direct-karar)'te ayrıca tanımlıdır.

## 9.7 Veri ve Olaylar

| Topic | Anahtar | İçerik |
|-------|--------|--------|
| `rtb.auctions` | tenant+request | Açık artırma özeti: katılan DSP'ler, teklifler, kazanan, ödenen fiyat, take rate, kaybetme nedenleri |
| `rtb.bid_requests_sample` | tenant+request | Teklif isteklerinin %1 örneklemi (forecast ve DSP destek için) |
| `dsp.spend` | advertiser+campaign | DSP harcama ve rezervasyon olayları (bütçe sayaçları) |
| `dsp.audience_events` | advertiser+id_hash | Retargeting pikseli ve S2S olayları (kitle üyeliği) |
| `catalog.products` | advertiser+sku | Ürün feed'i güncellemeleri |
| `ad.conversions` | advertiser+order | Atıflanmış dönüşümler (tekilleştirme sonrası) |

- Exchange açık artırma kayıtları ClickHouse'ta `rtb_auctions` tablosuna yazılır (90 gün ham, saatlik agrega 25 ay). Bu tablo DSP ekibine kapalıdır (9.1).
- Kontrol düzleminde DSP için ayrı tablolar tutulur: `dsp_accounts`, `dsp_campaigns`, `dsp_creatives`, `dsp_bid_strategies`, `dsp_audiences`, `exchange_buyers` (harici DSP bağlantıları, QPS, pretargeting).

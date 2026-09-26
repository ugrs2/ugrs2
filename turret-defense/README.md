# 🏰 Kale Savunması — 4 Oyunculu Turret Defense (three.js)

Ortadaki **Karargah**'a 4 koridordan saldıran düşmanlara karşı kuleler kurup yükselttiğiniz, **1–4 kişilik** bir kule savunma oyunu.
Oyuncu sayısı kadar koridor açılır: 1 kişi → 1 koridor, 3 kişi → 3 koridor, 4 kişi → 4 koridor.

- **Tek ekran:** Bilgisayara 4 adede kadar Xbox (veya standart) kol bağlayın; her kol **A** ile katılır. Klavye+fare de bir oyuncu olabilir.
- **Telefonlar:** Bilgisayar/TV'de **Oda Kur** deyin, telefonlar aynı Wi-Fi'da ekrandaki adresi (`http://<ip>:8080/?oda=KOD`) açarak katılır. Her telefon kendi koridoruna odaklanan 3D görünüm ve dokunmatik menü alır. Kollar ve telefonlar aynı odada karışık oynayabilir.

## Çalıştırma

```bash
cd turret-defense
npm install
npm start          # http://localhost:8080
```

Sunucu açılınca telefonlar için yerel ağ adreslerini konsola yazar. `PORT=3000 npm start` ile port değiştirilebilir.

Simülasyon testi (bot 1–4 oyuncuyla tüm bölümleri oynar):

```bash
npm test
```

## Oyun içeriği

**15 kule** (her biri 3 seviye + 4. seviyede 2 uzmanlıktan biri = 30 uzmanlık):
Makineli Tüfek, Top, Buz Kulesi, Keskin Nişancı, Uçaksavar, Alev Silahı, Altın Madeni, Tesla Bobini, Roket Rampası, Havan, Zehir Kulesi, Lazer, Radar, Railgun, Kara Delik.

**18 düşman tipi + 3 boss**: Er, Koşucu, Sürü Böceği, Zırhlı, Drone (uçan), Kalkanlı, Sağlıkçı, Bölünen, Hayalet (görünmez), Tank, Çılgın, Buz Golemi, Bombardıman (uçan), Çağırıcı, Faz Kayıcı… Her 10. dalgada boss: **Titan**, **Ana Gemi** (uçan), **Kraliçe**.
Hasar türleri (fiziksel, patlayıcı, ateş, buz, elektrik, zehir, enerji), zırh, direnç, kalkan, yavaşlatma, sersemletme, yanma, zehir gibi mekanikler vardır.

**Gelişim ve ekonomi**
- Öldürmeler sahibine **altın + tecrübe** kazandırır; dalga sonu bonusu, dalgayı erken çağırma bonusu, altın madeni geliri.
- **Oyuncu seviyesi** (maç içi): her seviye kule hasarını artırır ve yeni kule tiplerini + hava saldırısını açar.
- **Karargah yükseltmeleri:** onarım, zırh, merkez topu; takım arkadaşına altın gönderme.
- **7 bölüm** (Çayır, Çöl, Kar, Volkan, Gece, Yabancı Gezegen, Sonsuz), 4 zorluk seviyesi. Bölüm bitince 1–3 **yıldız**.
- **Kalıcı gelişim:** yıldızlarla başlangıç altını, hasar, maliyet indirimi, karargah canı, tecrübe, hava desteği güçlendirmeleri (tarayıcıda saklanır).
- Özel dalgalar (her 5. dalga): Hava Saldırısı, Sürü İstilası, Zırhlı Tümen, Gölge Birliği, Kalkan Duvarı.

## Kontroller

| | Xbox kolu | Klavye/Fare | Telefon |
|---|---|---|---|
| İmleç | Sol çubuk / D-pad | WASD / Oklar / fare | Hücreye dokun |
| Menü / inşa | A | Enter / tık | Kule seç → **İnşa Et** |
| Geri | B | Esc | ✕ |
| Menüde gez | LB / RB | Q / E / 1-9 | dokun |
| Hızlı yükselt | X | U | kuleye dokun |
| Hava saldırısı | Y | F | ✈ düğmesi |
| Sonraki dalga | Start | N | ▶ Başlat |
| Hız 1x/2x | RT | H | 1x |
| Duraklat | Back | P | ❚❚ |

Lobide kol: **A** katıl, **B** ayrıl, **LB/RB** bölüm, **D-pad ↑↓** zorluk, **Start** başlat.

## Mimari

```
turret-defense/
  shared/        Hem sunucuda hem tarayıcıda çalışan kod
    data.js      Kuleler, düşmanlar, bölümler, gelişimler
    map.js       4 koridorlu harita üretimi, yol takibi
    game.js      Otoriter oyun simülasyonu (dalgalar, hasar, ekonomi)
    room.js      Lobi + oyun odası, anlık görüntü (snapshot) yayını
  server/index.js  Statik dosya sunucusu + WebSocket (ws)
  public/js/
    view.js      three.js sahnesi (instanced düşmanlar, gölgeler, kamera)
    models.js    Prosedürel low-poly modeller
    fx.js        Parçacık, ışın ve mermi efektleri
    controller.js  Oyuncu imleci ve menüler (kol/klavye/dokunmatik)
    hud.js, main.js, input.js, audio.js, session.js, storage.js
```

- Simülasyon sunucuda 30 Hz çalışır, istemcilere 15 Hz sıkıştırılmış anlık görüntü gönderilir; istemciler ara değerleme (interpolation) ile akıcı çizer.
- **Tek Ekranda Oyna** modunda aynı simülasyon doğrudan tarayıcıda çalışır (ağ yok).
- Telefon uyku moduna geçip bağlantı koparsa otomatik yeniden bağlanır ve aynı oyuncu yuvasına döner.

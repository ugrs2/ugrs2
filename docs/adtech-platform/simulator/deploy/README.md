# Simülatörü kendi sunucunuzda yayınlama (dış IP / alan adı)

Simülatör tamamen statik bir sitedir: veritabanı ya da arka uç gerekmez. Buradaki paket onu bir Linux sunucuda **nginx** ile yayınlar; isterseniz alan adı ve otomatik **HTTPS** (Caddy + Let's Encrypt) ekler.

| Dosya | Görevi |
|---|---|
| `kur.sh` | Tek komutla kurulum: gerekirse Docker'ı kurar, imajı üretir, servisi başlatır, `ufw` açıksa portu açar, adresi yazar |
| `Dockerfile` | Kaynak dosyalardan tek dosyalık sürümü üretir ve nginx imajına koyar; mimari dokümanları `/docs/` altına ekler |
| `nginx.conf` | Gzip, güvenlik başlıkları, `/saglik` sağlık kontrolü, dokümanları düz metin sunma |
| `docker-compose.yml` | HTTP kurulum (varsayılan port 80) |
| `docker-compose.https.yml` + `Caddyfile` | Alan adıyla HTTPS kurulum |

## 1. Hızlı kurulum (önerilen)

Gereken: Ubuntu/Debian (ya da Docker çalışan herhangi bir Linux), `git`, `curl`, root yetkisi.

```bash
git clone -b ccr-916e2c32-oqoxdo https://github.com/ugrs2/ugrs2.git
cd ugrs2/docs/adtech-platform/simulator
sudo ./deploy/kur.sh
```

Sonunda şöyle bir çıktı görürsünüz:

```
✔ Simülatör çalışıyor: http://203.0.113.10/
  Sunum turu:           http://203.0.113.10/#tur
```

- Farklı port: `sudo PORT=8080 ./deploy/kur.sh` → `http://SUNUCU_IP:8080/`
- PR `main`'e birleştikten sonra `-b ccr-916e2c32-oqoxdo` kısmını kaldırın.
- Repo gizliyse `git clone` sizden GitHub kullanıcı adı ve **Personal Access Token** ister. Alternatif: `docs/adtech-platform` klasörünü `scp -r` ile sunucuya kopyalayıp aynı komutları orada çalıştırın.

## 2. Dışarıdan açılması için (en sık takılınan yer)

Site sunucuda çalışsa bile dışarıdan açılmıyorsa sorun neredeyse her zaman güvenlik duvarıdır:

1. **Bulut sağlayıcının güvenlik duvarı:** AWS Security Group, GCP/Azure firewall kuralı, Hetzner/DigitalOcean Cloud Firewall vb. içinde **gelen (inbound) TCP 80** (HTTPS için ayrıca **443**, özel port kullandıysanız o port) açık olmalı.
2. **Sunucunun kendi güvenlik duvarı:** `kur.sh`, `ufw` etkinse portu kendisi açar. `firewalld` kullanıyorsanız:
   ```bash
   sudo firewall-cmd --permanent --add-port=80/tcp && sudo firewall-cmd --reload
   ```
3. Kontrol: sunucunun içinden `curl http://127.0.0.1/saglik` → `ok` dönmeli. Dönüyorsa ama dışarıdan açılmıyorsa sorun 1. maddededir.

## 3. Alan adı + HTTPS

1. Alan adınızın DNS'inde bir **A kaydı** oluşturup sunucunun dış IP'sine yönlendirin (ör. `simulator.ornek.com → 203.0.113.10`).
2. 80 ve 443 portlarını açın.
3. Kurun:
   ```bash
   sudo DOMAIN=simulator.ornek.com ./deploy/kur.sh
   ```
   Caddy sertifikayı Let's Encrypt'ten otomatik alır ve yeniler; HTTP istekleri HTTPS'e yönlendirilir.

### Sunumu şifreyle korumak (isteğe bağlı)

Linki bilen herkesin açmasını istemiyorsanız `Caddyfile` içindeki `basic_auth` bloğunu açın:

```bash
docker run --rm caddy:2.8.4-alpine caddy hash-password --plaintext 'GucluBirSifre'
# çıkan hash'i Caddyfile'da "sunum <hash>" satırına yazın, yorum işaretlerini kaldırın
sudo DOMAIN=simulator.ornek.com ./deploy/kur.sh
```

## 4. Docker olmadan (nginx ile)

Repodaki `dist/simulator.html` tek dosyalık, hazır sürümdür; Node.js gerekmez:

```bash
sudo apt-get install -y nginx
cd ugrs2/docs/adtech-platform/simulator
sudo cp dist/simulator.html /var/www/html/index.html
sudo systemctl reload nginx                              # http://SUNUCU_IP/
```
Kaynak dosyaları değiştirdiyseniz önce `node tools/bundle.mjs` ile (Node.js 18+) bu dosyayı yeniden üretin. Bu yolda İstasyon sekmesindeki "Doküman" bağlantıları açılmaz; gerekirse `docs/adtech-platform/*.md` dosyalarını sunucuda uygun yere kopyalayın.

Sadece birkaç dakikalık deneme için (kalıcı yayın için değil):
```bash
cd ugrs2/docs/adtech-platform/simulator/dist
python3 -m http.server 8080 --bind 0.0.0.0     # http://SUNUCU_IP:8080/simulator.html
```

## 5. Günlük işler

```bash
cd ugrs2/docs/adtech-platform/simulator/deploy
docker compose ps                    # durum (HEALTHY görünmeli)
docker compose logs -f --tail=50     # kayıtlar
docker compose down                  # durdur
git pull && sudo ./kur.sh            # güncelle ve yeniden yayınla
```
HTTPS kurulumunda komutları `env DOMAIN=simulator.ornek.com docker compose -f docker-compose.https.yml …` şeklinde çalıştırın (`kur.sh` çıktısında hazır yazılır).

## 6. Sorun giderme

| Belirti | Çözüm |
|---|---|
| `429 Too Many Requests` (Docker Hub) | `docker login` yapın ya da birkaç dakika sonra tekrar deneyin |
| Sunucu içinde açılıyor, dışarıdan açılmıyor | Bölüm 2: bulut güvenlik duvarında inbound port |
| HTTPS sertifikası alınamıyor | DNS A kaydı doğru IP'yi gösteriyor mu, 80 ve 443 dışarıya açık mı? `docker compose -f docker-compose.https.yml logs caddy` |
| Port 80 dolu | `sudo PORT=8080 ./deploy/kur.sh` ya da portu kullanan servisi durdurun (`sudo ss -ltnp \| grep :80`) |
| Fontlar farklı görünüyor | Sayfa Google Fonts'u ziyaretçinin tarayıcısından yükler; kurumsal ağ engelliyorsa sistem fontlarına düşer, site yine çalışır |

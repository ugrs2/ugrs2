#!/usr/bin/env bash
# Sunucuda nginx zaten kurulu ve 80 portunda çalışıyorsa: simülatörü varsayılan siteye yerleştirir.
# Docker gerekmez. Sunucuda tek satırla:
#
#   curl -fsSL https://raw.githubusercontent.com/ugrs2/ugrs2/ccr-916e2c32-oqoxdo/docs/adtech-platform/simulator/deploy/mevcut-nginx.sh | sudo bash
#
# Var olan index.html silinmez, tarihli bir yedeği alınır. Tekrar çalıştırmak sayfayı günceller.
set -euo pipefail

BRANCH="${BRANCH:-ccr-916e2c32-oqoxdo}"
RAW="https://raw.githubusercontent.com/ugrs2/ugrs2/$BRANCH/docs/adtech-platform/simulator/dist/simulator.html"
# İstasyon sekmesindeki "Doküman" bağlantıları GitHub'daki (Mermaid şemaları çizilmiş) dokümanlara gider
DOCS="https://github.com/ugrs2/ugrs2/blob/$BRANCH/docs/adtech-platform/"

if [ "$(id -u)" -ne 0 ]; then echo "root olarak çalıştırın: ... | sudo bash" >&2; exit 1; fi
command -v nginx >/dev/null 2>&1 || { echo "nginx bulunamadı. Kurun: apt-get install -y nginx (ya da deploy/kur.sh ile Docker kurulumu)" >&2; exit 1; }
command -v curl  >/dev/null 2>&1 || { echo "curl bulunamadı: apt-get install -y curl" >&2; exit 1; }

# Varsayılan sitenin kök klasörü (Debian/Ubuntu paketi: /var/www/html, nginx.org paketi: /usr/share/nginx/html)
ROOT=""
for f in /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf; do
  if [ -f "$f" ]; then
    ROOT="$(awk '$1=="root"{gsub(/;/,"",$2); print $2; exit}' "$f")"
    [ -n "$ROOT" ] && break
  fi
done
ROOT="${ROOT:-/var/www/html}"
echo "▸ Site klasörü: $ROOT"
mkdir -p "$ROOT"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
echo "▸ Simülatör indiriliyor…"
curl -fsSL "$RAW" -o "$tmp"
grep -q 'Reklam Altyapısı Simülatörü' "$tmp" || { echo "İndirilen dosya beklenen sayfa değil, iptal edildi." >&2; exit 1; }
sed -i "0,/<head>/s##<head><meta name=\"sim-docs-base\" content=\"$DOCS\">#" "$tmp"

if [ -f "$ROOT/index.html" ]; then
  yedek="$ROOT/index.html.yedek-$(date +%Y%m%d-%H%M%S)"
  cp -a "$ROOT/index.html" "$yedek"
  echo "▸ Eski index.html yedeklendi: $yedek"
fi
install -m 644 "$tmp" "$ROOT/index.html"

echo "▸ nginx ayarı kontrol ediliyor ve yeniden yükleniyor…"
nginx -t
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  nginx -s reload
fi

# Not: "set -o pipefail" altında "komut | grep -q" yanlış sonuç verebilir (grep erken çıkar, komut SIGPIPE alır);
# bu yüzden çıktılar önce değişkene alınır.
ufw_status="$(ufw status 2>/dev/null || true)"
if [[ "$ufw_status" == *"Status: active"* ]]; then
  ufw allow 80/tcp >/dev/null && echo "▸ ufw: 80/tcp açıldı"
fi

ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
[ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
served="$(curl -fsS --max-time 5 http://127.0.0.1/ 2>/dev/null || true)"
if [[ "$served" == *"Reklam Altyapısı Simülatörü"* ]]; then
  cat <<EOF

✔ Simülatör yayında: http://${ip:-SUNUCU_IP}/
  Sunum turu:        http://${ip:-SUNUCU_IP}/#tur
  Geri almak için yedek dosyayı $ROOT/index.html üzerine kopyalayın.
EOF
else
  echo "Sayfa $ROOT/index.html olarak kopyalandı ama http://127.0.0.1/ hâlâ başka bir sayfa gösteriyor." >&2
  echo "Varsayılan sitenin kökünü bulun: nginx -T | grep -E 'listen|root|index'" >&2
  exit 1
fi

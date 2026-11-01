#!/usr/bin/env bash
# Reklam Altyapısı Simülatörü — Linux sunucuya tek komutla kurulum
#
#   sudo ./deploy/kur.sh                          → http://SUNUCU_IP/
#   sudo PORT=8080 ./deploy/kur.sh                → http://SUNUCU_IP:8080/
#   sudo DOMAIN=demo.ornek.com ./deploy/kur.sh    → https://demo.ornek.com/  (DNS bu sunucuya yönlenmeli)
#
# Tekrar çalıştırmak güvenlidir: kodu güncelledikten sonra aynı komut imajı yeniden üretir.
set -euo pipefail

cd "$(dirname "$0")"

if [ "$(id -u)" -ne 0 ] && ! docker info >/dev/null 2>&1; then
  echo "Bu betiği sudo ile çalıştırın: sudo $0" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "▸ Docker bulunamadı, resmi kurulum betiğiyle kuruluyor…"
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose eklentisi bulunamadı. Kurun: apt-get install -y docker-compose-plugin" >&2
  exit 1
fi

if [ -n "${DOMAIN:-}" ]; then
  echo "▸ HTTPS kurulumu: $DOMAIN"
  compose="env DOMAIN=$DOMAIN docker compose -f docker-compose.https.yml"
  $compose up -d --build
  ports="80 443"
  health="http://127.0.0.1:80/"   # Caddy HTTP'yi HTTPS'e yönlendirir; yanıt gelmesi yeterli
  url="https://$DOMAIN/"
else
  PORT="${PORT:-80}"
  echo "▸ HTTP kurulumu: port $PORT"
  compose="docker compose"
  PORT="$PORT" $compose up -d --build
  ports="$PORT"
  health="http://127.0.0.1:$PORT/saglik"
  url_port=""
  [ "$PORT" != "80" ] && url_port=":$PORT"
fi

# Sunucu güvenlik duvarı (ufw etkinse) portları açar
ufw_status="$(ufw status 2>/dev/null || true)"   # "| grep -q" + pipefail SIGPIPE yüzünden yanlış sonuç verebilir
if [[ "$ufw_status" == *"Status: active"* ]]; then
  for p in $ports; do ufw allow "$p/tcp" >/dev/null && echo "▸ ufw: $p/tcp açıldı"; done
fi

echo -n "▸ Servis bekleniyor"
ok=""
for _ in $(seq 1 30); do
  if curl -s -o /dev/null --max-time 2 "$health"; then ok=1; break; fi
  echo -n "."; sleep 1
done
echo
if [ -z "$ok" ]; then
  echo "Servis yanıt vermedi. Kayıtlar: cd $(pwd) && $compose logs --tail=50" >&2
  exit 1
fi

if [ -z "${DOMAIN:-}" ]; then
  ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  [ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  url="http://${ip:-SUNUCU_IP}${url_port}/"
fi

cat <<EOF

✔ Simülatör çalışıyor: $url
  Sunum turu:           ${url}#tur

  Dışarıdan açılmıyorsa bulut sağlayıcınızın güvenlik grubunda / firewall'unda
  şu TCP portlarının gelen trafiğe açık olduğundan emin olun: $ports
  Durdurmak için:  cd $(pwd) && $compose down
EOF

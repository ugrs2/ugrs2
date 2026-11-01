#!/usr/bin/env bash
# Mevcut nginx'e simülatör için alan adlı bir HTTPS sitesi ekler:
# ayrı site klasörü + Let's Encrypt sertifikası (otomatik yenilenir) + HTTP→HTTPS yönlendirme.
#
#   curl -fsSL https://raw.githubusercontent.com/ugrs2/ugrs2/ccr-916e2c32-oqoxdo/docs/adtech-platform/simulator/deploy/nginx-https.sh | sudo DOMAIN=simulator.ornek.com bash
#
# Seçenekler (ortam değişkeni):
#   DOMAIN=…        zorunlu; DNS A kaydı bu sunucunun dış IP'sini göstermeli
#   EMAIL=…         Let's Encrypt hesabı yoksa bildirim e-postası (hesap varsa gerekmez)
#   DNS_KONTROL=0   DNS ön kontrolünü atla (ör. Cloudflare proxy arkasında)
#
# Güvenlik: başka sitelerin ayarlarına dokunmaz; aynı alan adı başka bir dosyada tanımlıysa durur;
# "nginx -t" başarısız olursa yaptığı değişikliği geri alır. Tekrar çalıştırmak sayfayı ve ayarı günceller.
set -euo pipefail

DOMAIN="${DOMAIN:-}"
BRANCH="${BRANCH:-ccr-916e2c32-oqoxdo}"
RAW="https://raw.githubusercontent.com/ugrs2/ugrs2/$BRANCH/docs/adtech-platform/simulator/dist/simulator.html"
DOCS="https://github.com/ugrs2/ugrs2/blob/$BRANCH/docs/adtech-platform/"
TS="$(date +%Y%m%d-%H%M%S)"

say()  { echo "▸ $*"; }
fail() { echo "✖ $*" >&2; exit 1; }

# ---------------------------------------------------------------- ön koşullar
[ "$(id -u)" -eq 0 ] || fail "root olarak çalıştırın: … | sudo DOMAIN=$DOMAIN bash"
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] \
  || fail "DOMAIN geçersiz ya da boş. Örnek: … | sudo DOMAIN=simulator.ornek.com bash"
command -v nginx >/dev/null 2>&1 || fail "nginx bulunamadı."
command -v curl  >/dev/null 2>&1 || fail "curl bulunamadı: apt-get install -y curl"

WEBROOT="/var/www/$DOMAIN"
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
BACKUP_DIR="/root/nginx-yedek/$TS"     # yedekler nginx'in okuduğu klasörlerin DIŞINDA tutulur

reload_nginx() {
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
    systemctl reload nginx
  else
    nginx -s reload
  fi
}

# Yeniden yükleme asenkron: yeni ayar eski işçi süreçler bitince devreye girer; kontroller birkaç kez denenir.
retry() {   # retry <deneme> <komut…>  → komut başarılı olana kadar 0,5 sn arayla dener
  local n="$1"; shift
  for _ in $(seq 1 "$n"); do "$@" && return 0; sleep 0.5; done
  return 1
}

# Not: "set -o pipefail" altında "komut | grep -q" yanlış sonuç verebilir (grep erken çıkar, komut SIGPIPE alır);
# bu yüzden komut çıktıları önce değişkene alınır.
NGINX_T="$(nginx -T 2>/dev/null || true)"
[ -n "$NGINX_T" ] || fail "'nginx -T' çalışmadı; önce mevcut nginx ayarını düzeltin (nginx -t)."

# Ayar dosyasının yeri: sites-enabled kullanılıyorsa sites-available + bağlantı, yoksa conf.d
if [[ "$NGINX_T" =~ include[[:space:]]+/etc/nginx/sites-enabled/ ]]; then
  CONF_AVAIL="/etc/nginx/sites-available/$DOMAIN.conf"
  CONF_ENABLED="/etc/nginx/sites-enabled/$DOMAIN.conf"
else
  CONF_AVAIL="/etc/nginx/conf.d/$DOMAIN.conf"
  CONF_ENABLED="$CONF_AVAIL"
fi
say "Ayar dosyası: $CONF_ENABLED"

# Aynı alan adı başka bir dosyada tanımlıysa dur (mevcut bir siteyi ezmemek için)
CONFLICTS="$(printf '%s\n' "$NGINX_T" | awk -v d="$DOMAIN" -v own="$CONF_ENABLED" '
  /^# configuration file /{ f=$4; sub(/:$/, "", f); next }
  /^[[:space:]]*#/ { next }
  { for (i=1; i<=NF; i++) if ($i=="server_name") {          # satırın neresinde olursa olsun (tek satırlık bloklar dahil)
      for (j=i+1; j<=NF; j++) { n=tolower($j); last=(n ~ /;/); sub(/;.*/, "", n)
        if (n==d && f!=own) print f
        if (last) break } } }' | sort -u)"
[ -z "$CONFLICTS" ] || fail "$DOMAIN zaten şu dosyada tanımlı: $CONFLICTS — çakışmamak için durdum."

# DNS ön kontrolü: sertifika alınabilmesi için alan adı bu sunucuyu göstermeli
if [ "${DNS_KONTROL:-1}" != "0" ]; then
  RESOLVED="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')"
  MYIP="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$RESOLVED" ] || fail "$DOMAIN için DNS A kaydı bulunamadı. Kaydı bu sunucunun IP'sine (${MYIP:-?}) yönlendirip tekrar deneyin."
  if [ -n "$MYIP" ] && [ "$RESOLVED" != "$MYIP" ]; then
    fail "$DOMAIN → $RESOLVED gösteriyor, bu sunucu ise $MYIP. Cloudflare kullanıyorsanız kaydı 'DNS only' (gri bulut) yapın ya da DNS_KONTROL=0 ile atlayın."
  fi
  say "DNS doğru: $DOMAIN → $RESOLVED"
fi

# IPv6 yalnızca nginx zaten IPv6'da dinliyorsa eklenir ("listen [::]" IPv6'sız sunucuda nginx'i başlatmaz)
SS_OUT="$(ss -ltn 2>/dev/null || true)"
V6=0; [[ "$SS_OUT" == *"[::]:80 "* || "$SS_OUT" == *"[::]:443 "* ]] && V6=1

# http2 sözdizimi nginx sürümüne göre ("http2 on;" 1.25.1 ve sonrası)
NGINX_VER="$(nginx -v 2>&1 | sed -n 's#.*nginx/\([0-9.]*\).*#\1#p')"
if [ "$(printf '%s\n%s\n' "1.25.1" "${NGINX_VER:-0}" | sort -V | head -1)" = "1.25.1" ]; then
  LISTEN_443="listen 443 ssl;"; LISTEN6_443="listen [::]:443 ssl;"; HTTP2_LINE="http2 on;"
else
  LISTEN_443="listen 443 ssl http2;"; LISTEN6_443="listen [::]:443 ssl http2;"; HTTP2_LINE=""
fi

# ---------------------------------------------------------------- site dosyaları
mkdir -p "$WEBROOT/.well-known/acme-challenge"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
say "Simülatör indiriliyor…"
curl -fsSL "$RAW" -o "$tmp"
grep -q 'Reklam Altyapısı Simülatörü' "$tmp" || fail "İndirilen dosya beklenen sayfa değil, iptal edildi."
sed -i "0,/<head>/s##<head><meta name=\"sim-docs-base\" content=\"$DOCS\">#" "$tmp"
install -m 644 "$tmp" "$WEBROOT/index.html"
say "Sayfa: $WEBROOT/index.html"

# ---------------------------------------------------------------- nginx ayarı (geri alınabilir)
PREV=""
if [ -e "$CONF_AVAIL" ]; then
  mkdir -p "$BACKUP_DIR"; cp -a "$CONF_AVAIL" "$BACKUP_DIR/"; PREV="$BACKUP_DIR/$(basename "$CONF_AVAIL")"
  say "Önceki ayar yedeklendi: $PREV"
fi

write_conf() {   # $1 = http | https
  local v6_80="" v6_443="" ssl_opts
  [ "$V6" = 1 ] && v6_80="listen [::]:80;" && v6_443="$LISTEN6_443"
  {
    echo "# $DOMAIN — Reklam Altyapısı Simülatörü (deploy/nginx-https.sh tarafından üretildi, $TS)"
    echo "server {"
    echo "    listen 80;"
    [ -n "$v6_80" ] && echo "    $v6_80"
    echo "    server_name $DOMAIN;"
    echo "    location ^~ /.well-known/acme-challenge/ { root $WEBROOT; default_type text/plain; }"
    if [ "$1" = https ]; then
      echo "    location / { return 301 https://\$host\$request_uri; }"
    else
      echo "    location / { root $WEBROOT; try_files \$uri \$uri/ /index.html; }"
    fi
    echo "}"
    if [ "$1" = https ]; then
      if [ -f /etc/letsencrypt/options-ssl-nginx.conf ]; then
        ssl_opts="    include /etc/letsencrypt/options-ssl-nginx.conf;"
        [ -f /etc/letsencrypt/ssl-dhparams.pem ] && ssl_opts="$ssl_opts
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
      else
        ssl_opts="    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;"
      fi
      cat <<EOF
server {
    $LISTEN_443
EOF
      [ -n "$v6_443" ] && echo "    $v6_443"
      [ -n "$HTTP2_LINE" ] && echo "    $HTTP2_LINE"
      cat <<EOF
    server_name $DOMAIN;

    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
$ssl_opts

    root $WEBROOT;
    index index.html;
    charset utf-8;
    gzip on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript image/svg+xml text/plain;

    location / {
        try_files \$uri \$uri/ /index.html;
        # nginx'te alt bloktaki add_header üst bloktakileri ezer; başlıkların hepsi burada.
        add_header Cache-Control "no-cache" always;
        add_header Strict-Transport-Security "max-age=15552000" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
    }
}
EOF
    fi
  } > "$CONF_AVAIL"
  [ "$CONF_AVAIL" = "$CONF_ENABLED" ] || ln -sfn "$CONF_AVAIL" "$CONF_ENABLED"
}

rollback() {
  echo "✖ nginx ayar testi başarısız; değişiklik geri alınıyor." >&2
  if [ -n "$PREV" ]; then
    cp -a "$PREV" "$CONF_AVAIL"
  else
    rm -f "$CONF_ENABLED" "$CONF_AVAIL"
  fi
  nginx -t >/dev/null 2>&1 && reload_nginx || true
  exit 1
}

apply_conf() {   # $1 = http | https
  mkdir -p "$(dirname "$CONF_AVAIL")" "$(dirname "$CONF_ENABLED")"
  write_conf "$1"
  if ! nginx -t; then rollback; fi
  reload_nginx
}

# ---------------------------------------------------------------- sertifika
if [ -s "$CERT_DIR/fullchain.pem" ] && [ -s "$CERT_DIR/privkey.pem" ]; then
  say "Sertifika zaten var: $CERT_DIR (yenilemeyi certbot üstleniyor)"
else
  if ! command -v certbot >/dev/null 2>&1; then
    say "certbot kuruluyor…"
    if command -v apt-get >/dev/null 2>&1; then
      DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot >/dev/null
    else
      fail "certbot bulunamadı ve apt-get yok; certbot'u kurup tekrar çalıştırın."
    fi
  fi

  say "Doğrulama için geçici HTTP ayarı yükleniyor…"
  apply_conf http

  # Yerel ön kontrol: ACME doğrulama dosyası bu alan adıyla sunuluyor mu?
  probe="sim-probe-$TS"
  echo ok > "$WEBROOT/.well-known/acme-challenge/$probe"
  probe_ok() { [ "$(curl -s --max-time 5 --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/.well-known/acme-challenge/$probe" || true)" = "ok" ]; }
  probe_result=0; retry 20 probe_ok || probe_result=1
  rm -f "$WEBROOT/.well-known/acme-challenge/$probe"
  [ "$probe_result" = 0 ] || fail "Doğrulama yolu yerelde sunulmuyor (http://$DOMAIN/.well-known/acme-challenge/). nginx -T çıktısını kontrol edin."

  EMAIL_ARGS=(--register-unsafely-without-email)
  if [ -n "${EMAIL:-}" ]; then
    EMAIL_ARGS=(-m "$EMAIL" --no-eff-email)
  elif compgen -G "/etc/letsencrypt/accounts/*/directory/*" >/dev/null; then
    EMAIL_ARGS=()   # mevcut Let's Encrypt hesabı kullanılır
  fi
  if command -v systemctl >/dev/null 2>&1; then HOOK="systemctl reload nginx"; else HOOK="nginx -s reload"; fi

  say "Let's Encrypt sertifikası alınıyor…"
  certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" \
    --non-interactive --agree-tos "${EMAIL_ARGS[@]}" --deploy-hook "$HOOK" \
    || fail "Sertifika alınamadı. DNS kaydını ve 80 portunun dışarıdan erişilebilir olduğunu kontrol edin. Site şu an HTTP olarak çalışıyor."
fi

say "HTTPS ayarı yükleniyor…"
apply_conf https

# ---------------------------------------------------------------- doğrulama
ufw_status="$(ufw status 2>/dev/null || true)"
if [[ "$ufw_status" == *"Status: active"* ]]; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; say "ufw: 80 ve 443 açık"
fi

https_ok() { [[ "$(curl -fsS --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" 2>/dev/null || true)" == *"Reklam Altyapısı Simülatörü"* ]]; }
redirect_ok() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/" || true)" = "301" ]; }
retry 20 https_ok || fail "HTTPS ayarı yüklendi ama https://$DOMAIN/ geçerli sertifikayla beklenen sayfayı döndürmedi."
retry 10 redirect_ok || echo "⚠ http://$DOMAIN/ adresi HTTPS'e 301 ile yönlendirmiyor." >&2

cat <<EOF

✔ Simülatör HTTPS ile yayında: https://$DOMAIN/
  Sunum turu:                  https://$DOMAIN/#tur
  Ayar: $CONF_AVAIL  ·  Sayfa: $WEBROOT/index.html
  Sertifika yenilemesini denemek için: certbot renew --dry-run
EOF

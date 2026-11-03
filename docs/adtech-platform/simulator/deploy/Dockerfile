# Reklam Altyapısı Simülatörü — sunucu imajı
# Derleme bağlamı docs/adtech-platform klasörüdür (dokümanlar da imaja girsin diye):
#   docker build -f simulator/deploy/Dockerfile -t reklam-simulator docs/adtech-platform

# 1) Kaynak dosyalardan tek dosyalık sürümü üret (dist/ repodaki eski kopyaya güvenmez)
FROM node:22-alpine AS build
WORKDIR /src
COPY simulator/index.html simulator/index.html
COPY simulator/css simulator/css
COPY simulator/js simulator/js
COPY simulator/3d.html simulator/3d.html
COPY simulator/tools simulator/tools
RUN node simulator/tools/bundle.mjs \
 && sed -i 's#<head>#<head><meta name="sim-docs-base" content="docs/">#' simulator/dist/simulator.html \
 && grep -q 'name="sim-docs-base"' simulator/dist/simulator.html \
 && sed -i 's#name="sim-docs-base" content="../../"#name="sim-docs-base" content="docs/"#; s#name="sim-2d-href" content="simulator.html"#name="sim-2d-href" content="./"#' simulator/dist/3d.html \
 && grep -q 'name="sim-2d-href" content="./"' simulator/dist/3d.html

# 2) nginx ile sun
FROM nginx:1.27-alpine
COPY simulator/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/simulator/dist/simulator.html /usr/share/nginx/html/index.html
COPY --from=build /src/simulator/dist/3d.html /usr/share/nginx/html/3d.html
# İstasyon sekmesindeki "Doküman" bağlantıları /docs/ altından açılır
COPY *.md /usr/share/nginx/html/docs/
COPY images /usr/share/nginx/html/docs/images
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/saglik >/dev/null || exit 1

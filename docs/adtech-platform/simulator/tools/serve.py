#!/usr/bin/env python3
"""tools/serve.py — yerel önizleme sunucusu (docs/adtech-platform klasörünü sunar).

`python -m http.server` Content-Type başlığına charset eklemez; tarayıcı .md dosyalarını
Windows-1252 sanıp Türkçe karakterleri bozar (ör. "bölüm" → "bÃ¶lÃ¼m"). Bu sunucu metin
dosyalarını charset=utf-8 ile, Markdown'ı nginx kurulumundaki gibi text/plain olarak sunar.

Kullanım:  python simulator/tools/serve.py [port]        (varsayılan 8000)
           → http://127.0.0.1:8000/simulator/   ·   http://127.0.0.1:8000/simulator/3d.html
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.md': 'text/plain; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8',
    }

    def end_headers(self):
        # önizlemede düzenlenen dosyalar hemen görünsün (tarayıcı eski yanıtı önbellekten göstermesin)
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, directory=str(ROOT)))
    # Windows konsolu (cp1254) bazı karakterleri yazamaz; çıktıyı UTF-8'e zorla
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    print(f'{ROOT} sunuluyor: http://127.0.0.1:{port}/simulator/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()

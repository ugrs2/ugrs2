#!/usr/bin/env node
/* tools/bundle.mjs — [integration] tek dosyalık sürüm üretir: dist/simulator.html
 *
 * index.html okunur; yerel <link rel="stylesheet" href="css/…"> etiketleri <style> olarak, yerel
 * <script src="js/…"> etiketleri sırası korunarak satır içine gömülür. Google Fonts bağlantıları kalır.
 * Script'ler `defer` davranışını korumak için </body> öncesine taşınır (DOM ayrıştırıldıktan sonra, sırayla).
 * Başa SIM.bundled = true eklenir: main.js İstasyon sekmesindeki doküman bağlantılarını ../../ önekine çevirir.
 *
 * Kullanım: node tools/bundle.mjs   (herhangi bir klasörden)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'index.html');
const OUT_DIR = join(ROOT, 'dist');
const OUT = join(OUT_DIR, 'simulator.html');

const isLocal = (href) => !/^(?:[a-z]+:)?\/\//i.test(href) && !/^data:/i.test(href);
const read = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error('Dosya bulunamadı: ' + rel);
  return readFileSync(p, 'utf8');
};

let html = readFileSync(SRC, 'utf8');
const inlined = { css: [], js: [] };

// 1) CSS: yerel stylesheet bağlantıları → <style>
html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, (tag) => {
  const m = /\bhref=["']([^"']+)["']/i.exec(tag);
  if (!m || !isLocal(m[1])) return tag; // Google Fonts vb. kalır
  const css = read(m[1]).replace(/<\/style/gi, '<\\/style');
  inlined.css.push(m[1]);
  return `<style data-src="${m[1]}">\n${css}\n</style>`;
});

// 2) JS: yerel script'ler sırayla toplanır, head'den çıkarılır
const scripts = [];
html = html.replace(/[ \t]*<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>[ \t]*\r?\n?/gi, (tag, a, src) => {
  if (!isLocal(src)) return tag;
  scripts.push(src);
  return '';
});
if (!scripts.length) throw new Error('index.html içinde yerel script bulunamadı');

const body = [
  '<script>window.SIM = window.SIM || {}; window.SIM.bundled = true;</script>',
  ...scripts.map((src) => {
    inlined.js.push(src);
    const js = read(src).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
    return `<script data-src="${src}">\n${js}\n</script>`;
  })
].join('\n');

if (!/<\/body>/i.test(html)) throw new Error('index.html içinde </body> yok');
html = html.replace(/<\/body>/i, body + '\n</body>');
html = html.replace(/<html([^>]*)>/i, (m, a) => `<html${a}>\n<!-- Tek dosyalık sürüm: tools/bundle.mjs ile index.html'den üretildi. Düzenlemeyin; kaynak dosyaları değiştirip yeniden üretin. -->`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`dist/simulator.html yazıldı (${kb} KB) · CSS: ${inlined.css.join(', ')} · JS: ${inlined.js.join(', ')}`);

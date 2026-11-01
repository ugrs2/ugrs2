import { SOUNDS } from './sounds.js';
import { rng, SR } from './dsp.js';

/**
 * Web Audio oynatıcısı — yüzlerce kahramanın aynı anda vurduğu sahneler için:
 *  - Sesler oyun açılırken matematikle üretilir (dosya yok) ya da hazır WAV'lar yüklenir.
 *  - Her sesin birkaç varyasyonu + rastgele perde sapması: tekrar robotik duyulmaz.
 *  - Aynı anda çalan ses sınırı (öncelikli), aynı sesin 35 ms içinde üst üste
 *    binmesini engelleme, kameraya uzaklığa göre kısma ve stereo yönlendirme.
 *  - Ana çıkışta sıkıştırıcı/limiter: toplu çatışmada kulak tırmalamaz.
 *
 *   const sfx = new SFXPlayer();
 *   sfx.unlock();                 // ilk dokunuşta sesi aç (iOS/Chrome kuralı)
 *   await sfx.preload();          // yükleme ekranında (ya da arka planda)
 *   sfx.play('kilicVurus', { position: mob.position });
 */
export class SFXPlayer {
  constructor({
    variants = 3, // her ses için kaç farklı varyasyon üretilsin
    maxVoices = 28, // aynı anda en fazla kaç ses
    volume = 0.8,
    refDistance = 8, // bu mesafeye kadar tam ses (dünya birimi)
    maxDistance = 45, // bu mesafeden sonra hiç ses yok
    panWidth = 18, // bu kadar sağ/sola uzaklıkta tam stereo
    seed = 1,
    context = null,
    lite = false, // mobil: yarı örnekleme hızı (22 kHz) + tek varyasyon -> ~4 kat az bellek
  } = {}) {
    this.lite = lite;
    if (lite) variants = 1;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.ctx = context || new AC();
    this.variants = variants;
    this.maxVoices = maxVoices;
    this.refDistance = refDistance;
    this.maxDistance = maxDistance;
    this.panWidth = panWidth;
    this.seed = seed;
    this.buffers = new Map();
    this.voices = [];
    this.recent = new Map();
    this.loops = new Map();
    this.listener = { x: 0, z: 0, rx: 1, rz: 0 };
    this.muted = false;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.2;
    this.master = this.ctx.createGain();
    this.master.gain.value = volume;
    this.master.connect(this.compressor).connect(this.ctx.destination);
  }

  /** Tarayıcılar sesi ancak bir kullanıcı etkileşiminden sonra açar. */
  unlock(target = globalThis) {
    const go = () => {
      if (this.ctx.state !== 'running') this.ctx.resume();
      const b = this.ctx.createBuffer(1, 1, SR);
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.ctx.destination);
      s.start();
      target.removeEventListener('pointerdown', go);
      target.removeEventListener('keydown', go);
      target.removeEventListener('touchend', go);
    };
    target.addEventListener('pointerdown', go);
    target.addEventListener('keydown', go);
    target.addEventListener('touchend', go);
  }

  set volume(v) {
    this.master.gain.value = v;
  }
  get volume() {
    return this.master.gain.value;
  }

  // ---------------------------------------------------------------------------
  // Üretim / yükleme
  // ---------------------------------------------------------------------------

  _toBuffer(data) {
    let rate = SR;
    if (this.lite) {
      const h = new Float32Array(data.length >> 1);
      for (let i = 0; i < h.length; i++) h[i] = 0.25 * (data[2 * i - 1] || 0) + 0.5 * data[2 * i] + 0.25 * data[2 * i + 1];
      data = h;
      rate = SR / 2;
    }
    const b = this.ctx.createBuffer(1, data.length, rate);
    b.copyToChannel(data, 0);
    return b;
  }

  /** Üretilmiş seslerin yaklaşık bellek kullanımı (MB). */
  memoryMB() {
    let n = 0;
    for (const list of this.buffers.values()) for (const b of list) n += b.length * 4;
    return n / 1048576;
  }

  /** Bir sesi şimdi üretir (gerekirse sadece 1 varyasyon). */
  bake(id, count = this.variants) {
    const def = SOUNDS[id];
    if (!def) throw new Error(`Bilinmeyen ses: ${id}`);
    const list = this.buffers.get(id) || [];
    const n = def.loop ? 1 : count;
    // 1 sn'den uzun seslerde tek varyasyon yeter (perde sapması zaten var) — bellek dostu
    while (list.length < n && !(list.length && list[0].duration > 1)) list.push(this._toBuffer(def.render(rng(this.seed * 1000 + list.length * 7919 + hash(id)))));
    this.buffers.set(id, list);
    return list;
  }

  /**
   * Tüm sesleri (ya da verilenleri) parça parça üretir; her ~8 ms'de bir
   * tarayıcıya nefes aldırır, oyun takılmaz. onProgress(0..1)
   */
  async preload(ids = Object.keys(SOUNDS), { onProgress = null, budgetMs = 8 } = {}) {
    let t0 = performance.now();
    for (let i = 0; i < ids.length; i++) {
      for (let v = 0; v < this.variants; v++) {
        const have = this.buffers.get(ids[i]);
        if ((have?.length ?? 0) > v || (have?.length && have[0].duration > 1)) continue;
        this.bake(ids[i], v + 1);
        if (performance.now() - t0 > budgetMs) {
          await new Promise((r) => setTimeout(r, 0));
          t0 = performance.now();
        }
      }
      onProgress?.((i + 1) / ids.length);
    }
  }

  /**
   * Hazır WAV dosyalarını yükler (vfx/sesler/*.wav). Üretmekten hızlıdır.
   * Dosya adı: <id>.wav (tek varyasyon).
   */
  async loadWavs(baseUrl, ids = Object.keys(SOUNDS)) {
    await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(`${baseUrl.replace(/\/$/, '')}/${id}.wav`);
          if (!res.ok) return;
          const b = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(id, [b]);
        } catch {
          /* yoksa sonra üretilir */
        }
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Dinleyici (kamera)
  // ---------------------------------------------------------------------------

  /** Dinleyici: kameranın baktığı yer noktası + ekranın sağ yönü. */
  setListener(x, z, rightX = 1, rightZ = 0) {
    const l = this.listener;
    l.x = x;
    l.z = z;
    const n = Math.hypot(rightX, rightZ) || 1;
    l.rx = rightX / n;
    l.rz = rightZ / n;
  }

  /** Three.js kamerasından: kameranın yere baktığı nokta + sağ vektörü. */
  setListenerFromCamera(camera, target) {
    const e = camera.matrixWorld.elements; // 0,1,2 = sağ vektör
    this.setListener(target.x, target.z, e[0], e[2]);
  }

  // ---------------------------------------------------------------------------
  // Çalma
  // ---------------------------------------------------------------------------

  /**
   * opts: position ({x,z} dünya — yoksa konumsuz/arayüz sesi), gain, delay (sn),
   *       rate (perde çarpanı), priority, pan (-1..1, konumu ezer), loop
   * Dönüş: { stop(fadeSn) } ya da null (sınır/uzaklık nedeniyle çalınmadıysa).
   */
  play(id, opts = {}) {
    if (this.muted) return null;
    const def = SOUNDS[id];
    if (!def) return null;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, opts.delay ?? 0);

    // uzaklık + yön
    let g = (opts.gain ?? 1) * def.gain;
    let pan = opts.pan ?? 0;
    if (opts.position) {
      const dx = opts.position.x - this.listener.x;
      const dz = opts.position.z - this.listener.z;
      const d = Math.hypot(dx, dz);
      const k = Math.max(0, Math.min(1, 1 - (d - this.refDistance) / (this.maxDistance - this.refDistance)));
      g *= k * k;
      if (opts.pan === undefined) pan = Math.max(-1, Math.min(1, (dx * this.listener.rx + dz * this.listener.rz) / this.panWidth)) * 0.75;
    }
    if (g < 0.015) return null;

    // aynı sesin üst üste binmesini sınırla
    const rec = this.recent.get(id) || [];
    let near = 0;
    for (let i = rec.length - 1; i >= 0; i--) {
      if (rec[i] < ctx.currentTime - 0.2) rec.splice(i, 1);
      else if (Math.abs(rec[i] - when) < 0.035) near++;
    }
    if (near >= def.limit) return null;

    // ses sınırı
    const prio = (opts.priority ?? 0) + def.priority;
    this.voices = this.voices.filter((v) => v.end > ctx.currentTime);
    // yeni sesin ilk 250 ms'sinde çalacak (planlanmış olanlar dahil) tüm sesler
    const overlapping = this.voices.filter((v) => v.start < when + 0.25 && v.end > when);
    if (overlapping.length >= this.maxVoices) {
      let low = null;
      for (const v of overlapping) if (!low || v.prio < low.prio || (v.prio === low.prio && v.g < low.g)) low = v;
      if (!low || low.prio > prio || (low.prio === prio && low.g >= g)) return null;
      low.stop(0.02);
    }

    const list = this.buffers.get(id) || this.bake(id, 1);
    const buffer = list[(Math.random() * list.length) | 0];
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!(opts.loop ?? def.loop);
    const rate = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * def.rate);
    src.playbackRate.value = rate;

    const amp = ctx.createGain();
    amp.gain.value = g;
    let node = src.connect(amp);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(this.master);
    src.start(when);

    const voice = {
      id,
      prio,
      g,
      start: when,
      end: src.loop ? Infinity : when + buffer.duration / rate,
      stop: (fade = 0.05) => {
        const t = Math.max(ctx.currentTime, voice.start);
        amp.gain.cancelScheduledValues(t);
        amp.gain.setValueAtTime(amp.gain.value, t);
        amp.gain.linearRampToValueAtTime(0, t + fade);
        try {
          src.stop(t + fade + 0.01);
        } catch {
          /* zaten durmuş */
        }
        voice.end = t + fade;
      },
    };
    src.onended = () => (voice.end = 0);
    this.voices.push(voice);
    rec.push(when);
    this.recent.set(id, rec);
    return voice;
  }

  /** Döngü sesini (yanma, rüzgâr, fırtına) isimle başlat/durdur. */
  startLoop(id, key = id, opts = {}) {
    this.stopLoop(key);
    const v = this.play(id, { ...opts, loop: true, priority: 5 });
    if (v) {
      v.end = Infinity;
      this.loops.set(key, v);
    }
    return v;
  }
  stopLoop(key, fade = 0.4) {
    const v = this.loops.get(key);
    if (v) v.stop(fade);
    this.loops.delete(key);
  }

  stopAll(fade = 0.05) {
    for (const v of this.voices) v.stop(fade);
    this.voices.length = 0;
    this.loops.clear();
  }
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

import * as THREE from 'three';

/**
 * GPU'ya giden tek bir "interleaved" instanced buffer + halka (ring) ayırıcı.
 *
 * Her efekt havuzu (parçacık, iz, kesik, zemin decal'i, mermi) bunu kullanır:
 *  - Kayıtlar sabit kapasiteli bir halkaya yazılır; eskiler sessizce ezilir.
 *  - Bir karede yazılan aralıklar birleştirilip sadece o kısım GPU'ya yüklenir
 *    (addUpdateRange) — her karede tüm buffer'ı göndermeyiz.
 *  - Simülasyon tamamen shader'da, zamanın analitik fonksiyonu olarak yapılır.
 *    CPU, kayıt yazıldıktan sonra o kayda bir daha dokunmaz.
 */
export class InstancedRing {
  constructor(stride, capacity) {
    this.stride = stride;
    this.capacity = capacity;
    this.array = new Float32Array(stride * capacity);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.array, stride, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    this.ends = new Float32Array(capacity); // her slotun bitiş zamanı (istatistik için)
    this.cursor = 0;
    this.used = 0; // şimdiye kadar kullanılan en yüksek slot + 1 (çizilen instance sayısı)
    this._ds = -1;
    this._de = -1;
    this._ranges = [];
  }

  attribute(size, offset) {
    return new THREE.InterleavedBufferAttribute(this.buffer, size, offset);
  }

  /** Bir slot ayırır ve array içindeki başlangıç offset'ini döndürür. */
  alloc(endTime) {
    const i = this.cursor;
    this.cursor = i + 1 === this.capacity ? 0 : i + 1;
    if (i + 1 > this.used) this.used = i + 1;

    if (this._ds < 0) {
      this._ds = i;
      this._de = i + 1;
    } else if (i === this._de) {
      this._de++;
    } else {
      this._ranges.push(this._ds, this._de);
      this._ds = i;
      this._de = i + 1;
    }
    this.ends[i] = endTime;
    return i * this.stride;
  }

  /** Bu karede yazılan aralıkları GPU'ya yüklenmek üzere işaretler. */
  flush(geometry) {
    if (this._ds < 0) return;
    this._ranges.push(this._ds, this._de);
    const r = this._ranges;
    const s = this.stride;
    for (let k = 0; k < r.length; k += 2) {
      this.buffer.addUpdateRange(r[k] * s, (r[k + 1] - r[k]) * s);
    }
    this.buffer.needsUpdate = true;
    r.length = 0;
    this._ds = -1;
    geometry.instanceCount = this.used;
  }

  countAlive(now) {
    let n = 0;
    const e = this.ends;
    for (let i = 0; i < this.used; i++) if (e[i] > now) n++;
    return n;
  }
}

/** Yeni bir InstancedBufferGeometry'yi taban geometriden kurar. */
export function instancedFrom(base, ring, layout) {
  const g = new THREE.InstancedBufferGeometry();
  if (base.index) g.setIndex(base.index);
  for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.attributes[name]);
  for (const [name, size, offset] of layout) g.setAttribute(name, ring.attribute(size, offset));
  g.instanceCount = 0;
  return g;
}

/**
 * Önceden çarpılmış (premultiplied) alfa karışımı:
 *   out = src.rgb + dst.rgb * (1 - src.a)
 * Shader alfa kanalına 0 yazarsa saf "additive" (parlama), >0 yazarsa normal
 * saydamlık (duman) elde edilir. Böylece hem parlayan hem koyu efektler tek
 * draw call'da çizilir.
 */
export const premultipliedBlend = {
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

export const DEAD_VERTEX = 'gl_Position = vec4(0.0, 0.0, 2.0, 1.0);';

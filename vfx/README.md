# Prosedürel Yetenek Efektleri (Three.js)

Üstten kameralı 3B açık dünya oyunu için **hiç doku/görsel dosyası kullanmayan**
yetenek efektleri. Her şey shader matematiğiyle (SDF, gürültü, analitik fizik) çizilir.
Yüzlerce kahramanın aynı anda yaratık kestiği sahneler için tasarlandı.

| Okçu | | Suikastçı | |
|---|---|---|---|
| 🔫 **Seri Atış** | Altın rün çemberi, ele toplanan enerji, 6 hızlı ok, kıvılcımlı isabetler | 👤 **Gölge Adımı** | Gölge girdabı, duman, art görüntüler, gölge çizgisi, hedefin arkasında belirip sırttan mor kesik |
| 🤸 **Takla Atış** | Toz halkası, geriye 360° takla (kahraman modeli döner), rüzgâr yayı, havada ters dururken 3'lü rüzgâr oku, iniş tozu | 🔪 **Hançer Yelpazesi** | Savurma kesiği, 72°'lik yelpazede takla atarak dönen 9 hançer, turkuaz izler |
| 🏹 **Ok Yağmuru** | Gökyüzüne 3 ok, dolan alan göstergesi, 36 ok yağar ve **yere saplanıp kalır**, toz ve halka | 💨 **Duman Bombası** | Kavisle uçan fitilli bomba, patlama flaşı, kabaran lavanta duman bulutu (~4,5 sn), içinde ışıltılar |
| 💀 **Ölüm Atışı** | Kızıl rün + içe akan enerji şarjı, geri tepme dalgası, delip geçen dev ok + çift sarmal kor, **kırmızı gözlü kafatası**, kızgın çatlaklı yanık izi, kamera sarsıntısı | ⚔️ **Bin Kesik** | Hedefe atılma, etrafında ışınlanan art görüntüler, 24 hilal kesik + düz ışık kesikleri, çapraz X + yatay halka finali |

Ayrıca: `temelAtis`, `temelVurus`, `yaratikOlum` (mor duman, ruh, saçılan altınlar), `isabet`.

## Demo

ES modülleri `file://` üzerinden çalışmaz; herhangi bir statik sunucu yeterli:

```bash
cd vfx
python3 -m http.server 8080      # veya: npx serve .
# http://localhost:8080/demo/
```

Klavye: **1-4** okçu, **5-8** suikastçı, **Boşluk** iki büyük yetenek birden.
Yaratığa tıklayınca hedef seçilir. **Toplu Test** 100+ kahramanın sürekli yetenek
kullandığı sahneyi açar; **Yavaş Çekim** efektleri incelemek için.

## Neden yüzlerce kahramanda akıcı?

* **Sabit 7 draw call.** Efekt sayısı ne olursa olsun: parçacıklar, zemin desenleri,
  kesikler, izler, oklar, hançerler, bombalar — her biri tek bir `InstancedMesh`.
* **Simülasyon GPU'da ve analitik.** Parçacığın konumu `p0 + v·(1−e^(−kt))/k − ½gt²`
  formülüyle vertex shader'da hesaplanır. CPU bir parçacığı yazdıktan sonra
  ona bir daha dokunmaz; kare başına parçacık döngüsü yoktur.
* **Tüm zaman çizelgesi cast anında yazılır.** Parçacık/mermi/kesiklerin başlangıç
  zamanı gelecekte olabilir; yeteneğin 2 saniyelik koreografisi tek seferde GPU'ya
  bırakılır, sonra bedavaya oynar.
* **Halka tampon + kısmi yükleme.** Sadece o karede yazılan aralıklar GPU'ya gider
  (`addUpdateRange`). Bellek sabittir; kapasite dolarsa en eski kayıt ezilir.
* **Ekran dışı eleme.** Kamerada görünmeyen kahramanın yeteneği hiç parçacık üretmez
  (isabet zamanları yine döner, oyun mantığı bozulmaz).
* **Tek blend modu.** Önceden çarpılmış alfa sayesinde parlayan (additive) ve koyu
  (duman) efektler aynı draw call'da karışır.
* **Kalite çarpanı.** `vfx.quality = 0.5` parçacık sayısını yarıya indirir (mobil).

Demo'daki ölçüm: 114 kahraman sürekli yetenek atarken efekt sisteminin CPU maliyeti
kare başına **~0,16 ms**, aynı anda ~3-4 bin aktif parçacık, 200-300 mermi.

## Oyuna entegrasyon

```js
import { VFXSystem } from './vfx/src/index.js';

const vfx = new VFXSystem({
  scene,
  camera,
  unit: 1,        // oyununuzda 1 metre kaç birim? (kahraman boyu ~1,3 m varsayılır)
  quality: 1,     // mobilde 0.5 – 0.6
});

function loop(dt) {
  // ... oyun güncellemesi, kamera yerleşimi ...
  vfx.update(dt);
  vfx.applyShake(camera); // kamerayı konumlandırdıktan sonra (sarsıntı kullanıyorsanız)
  renderer.render(scene, camera);
}

// Yetenek:
const res = vfx.cast('okYagmuru', {
  from: hero.position,           // kahramanın ayak konumu (dünya)
  target: monster.position,      // hedefin ayak konumu (dünya)
  caster: hero,                  // (ops.) Object3D — yön ve hareket animasyonu için
  shake: hero === myHero,        // (ops.) sarsıntıyı sadece oyuncunun kahramanına açın
  onHit: (hit, i) => showDamage(hit.position),   // her isabet anında
  onEnd: () => {},
});
// res = { duration, hits: [{ time, position }], endPosition?, area? }
```

`three` bare import'u kullanılır; bundler (Vite, webpack) ile doğrudan çalışır.
Bundler yoksa demo'daki gibi bir `importmap` ekleyin. Three.js r160+ gerekir
(r187 ile test edildi).

### Varsayımlar

* Kahraman modeli **+Z yönüne** bakar (`Object3D.lookAt` ile aynı kural) ve sahnenin
  (ya da dönüşümsüz bir grubun) doğrudan çocuğudur.
* `caster` verilirse **Takla Atış**, **Gölge Adımı** ve **Bin Kesik** kahramanı
  gerçekten hareket ettirir ve `endPosition` döner. Konumları sunucu/simülasyon
  yönetiyorsa `caster` vermeyin; efekt yine oynar, `res.endPosition`'ı kendiniz uygulayın.
* Kahramanlarınız `SkinnedMesh` ise art görüntülerin animasyonla birlikte oynamaması için
  `new VFXSystem({ ..., cloneFn: SkeletonUtils.clone })` verin
  (`import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'`).
* Zemin desenleri düz zemine (`target.y`) çizilir. Engebeli arazide desenler araziye
  gömülebilir; o durumda `polygonOffset` yetmezse desen yüksekliğini biraz artırın.

## Kendi efektinizi yazmak

Yetenekler sadece aşağıdaki yapı taşlarının zamanlanmış çağrılarıdır. Hızlar m/sn,
uzunluklar metre cinsindendir (`unit` ile otomatik ölçeklenir). Her çağrı `delay`
alır, böylece tüm koreografi tek fonksiyonda yazılır.

```js
import { SHAPE, DECAL, theme, impact } from './vfx/src/index.js';

const ICE = theme(0xbff4ff, 0x3a8bff);                    // hazır preset seti
const SHARD = { shape: SHAPE.SHARD, life: [0.5, 0.8], size: [0.15, 0.25], grow: 0.5,
                color: 0xe8fbff, colorEnd: 0x6fb8ff, alphaEnd: 0, gravity: 12, spin: [-10, 10] };

export function buzPatlamasi(vfx, { from, target }) {
  vfx.decal(DECAL.RUNE, target, { r0: 2, duration: 0.8, color: ICE.core, spin: 2 });
  vfx.converge(ICE.inflow, target, 20, { radius: 3, time: 0.5 });
  vfx.burst(SHARD, target, 25, { delay: 0.5, dir: { x: 0, y: 1, z: 0 }, spread: 1, speed: [5, 9] });
  impact(vfx, target, target, ICE, { delay: 0.5, size: 1.5 });
  return { duration: 1, hits: [{ time: 0.5, position: target }] };
}
```

| Yapı taşı | Ne yapar |
|---|---|
| `burst(preset, pos, n, { speed, dir, spread, flat, up, radius, delay, jitter, sizeMul })` | Noktadan patlama |
| `converge(preset, center, n, { radius, time, delay, jitter })` | Dışarıdan merkeze akan enerji (tam `time`'da varır) |
| `line(preset, a, b, n, { t0, t1, radius, speed })` | Çizgi boyunca zamana yayılmış parçacık |
| `decal(DECAL.X, pos, { r0, r1, duration, color, alpha, spin })` | Zemin deseni: `SHOCKWAVE`, `AOE`, `RUNE`, `SCORCH`, `SOFT`, `VORTEX` |
| `slash(center, { normal \| axisX+axisY, toward, radius, arc, width, duration, color, additive })` | Hilal kesik |
| `shoot('arrow' \| 'dagger' \| 'bomb', from, to, { speed \| duration, arc, stick, scale, pitchSpin, rollSpin, emissive, tint, trails })` | 3B mermi + izler, varış süresini döner |
| `trail(from, to, { duration, length, width, color, additive })` | Mermisiz ışık/gölge izi |
| `ghost(object3D, { color, opacity, duration, delay, position, quaternion })` | Solan art görüntü |
| `shake(şiddet, süre)`, `after(sn, fn)`, `tween(sn, fn(k), gecikme, bitince)` | Sarsıntı ve zamanlama |
| `isVisible(pos, r)`, `n(sayı)` | Ekran dışı kontrolü, kaliteye göre sayı |

### Parçacık preset alanları

```js
{
  shape: SHAPE.GLOW,   // GLOW, SPARK, RING, SMOKE, STAR, SKULL, SHARD, DOT
  life: [0.3, 0.5],    // saniye (sabit sayı ya da [min, max])
  size: [0.4, 0.6],    // metre, başlangıç
  grow: 0.2,           // bitiş boyutu = başlangıç × grow
  color: 0xffcc66, alpha: 1,         // başlangıç rengi
  colorEnd: 0xff4400, alphaEnd: 0,   // bitiş rengi
  drag: 2,             // 1/sn hava direnci
  gravity: 0,          // m/sn² (eksi: yükselir — duman)
  stretch: 0,          // SPARK: hız yönünde uzama (saniye)
  spin: [-2, 2],       // rad/sn dönüş
  rotate: true,        // false: rastgele başlangıç açısı yok (SKULL gibi)
  additive: 1,         // 1 parlama, 0 normal saydamlık (koyu duman)
}
```

## Dosyalar

```
vfx/
  src/
    VFXSystem.js            sistem, yapı taşları, zamanlayıcı, eleme, sarsıntı
    core/InstancedRing.js   halka tampon + kısmi GPU yükleme
    core/glsl.js            gürültü ve yörünge GLSL fonksiyonları
    pools/ParticlePool.js   parçacıklar (8 SDF şekli)
    pools/DecalPool.js      zemin desenleri (6 tür)
    pools/SlashPool.js      hilal kesikler
    pools/ProjectilePool.js 3B mermiler + ışık izleri
    geometry.js             prosedürel ok / hançer / bomba modelleri
    skills/archer.js        okçu yetenekleri
    skills/assassin.js      suikastçı yetenekleri
    skills/common.js        temalar, temel saldırılar, ölüm efekti
  demo/                     test sahnesi
```

## Performans ipuçları (mobil)

* `quality: 0.5` ve `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`.
  Mobilde asıl maliyet, büyük saydam parçacıkların üst üste çizilmesidir
  (özellikle Duman Bombası).
* Kapasiteleri sahnenize göre ayarlayın:
  `new VFXSystem({ capacity: { particles: 16384, arrows: 1024 } })`.
  Çizilen instance sayısı, kullanılan en yüksek slota kadar olduğundan büyük
  kapasite boşta maliyet getirmez.
* `vfx.stats()` aktif parçacık/mermi sayılarını verir.

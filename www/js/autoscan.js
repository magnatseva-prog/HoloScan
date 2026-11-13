// Пакетный режим: камера сама делает снимок, когда в рамке лежит новая карта,
// кадр не дрожит и резкий. Смотрим на уменьшенную копию рамки 4 раза в секунду.
// Пороги подобраны на тестовых снимках (tools/testset/harsh):
//   контуры: карта ≥ 21, стол/ткань/дерево ≤ 15;
//   «новая карта» (сетка 8×11): сдвиг той же карты ≤ 7, другая карта ≥ 19.5;
//   дрожание (сетка 16×22): сдвиг на ~2% кадра ≈ 12.
const W = 48, H = 66;
const SHARP = 18;
const NEW_CARD = 13;
const STILL = 5;
const HOLD = 3; // спокойных кадров подряд (≈0.75 с)

function gray(src, rect) {
  const c = gray.c ??= Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = gray.g ??= c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, W, H);
  const p = g.getImageData(0, 0, W, H).data, out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = p[i * 4] * 0.3 + p[i * 4 + 1] * 0.59 + p[i * 4 + 2] * 0.11;
  return out;
}
// средний модуль градиента: и резкость, и «есть ли в рамке что-то кроме стола»
function edges(a) {
  let s = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    s += Math.abs(a[i + 1] - a[i - 1]) + Math.abs(a[i + W] - a[i - W]);
  }
  return s / ((W - 2) * (H - 2));
}
// грубая сетка (усреднение блоков k×k) с нормализацией яркости и контраста —
// так автоэкспозиция камеры не выглядит как смена карты
function coarse(a, k) {
  const w = W / k, h = Math.floor(H / k), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += a[(y * k + dy) * W + x * k + dx];
    o[y * w + x] = s / (k * k);
  }
  let m = 0; for (const v of o) m += v; m /= o.length;
  let sd = 0; for (const v of o) sd += (v - m) ** 2; sd = Math.sqrt(sd / o.length) || 1;
  for (let i = 0; i < o.length; i++) o[i] = ((o[i] - m) / sd) * 40;
  return o;
}
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

// state: 'empty' (положи карту) | 'hold' (держи ровно) | 'same' (замени карту) | 'shot'
export function createAutoScan({ source, rect, onShot, onState, busy = () => false }) {
  let timer = null, prev = null, last = null, still = 0, state = '';
  const set = (s) => { if (s !== state) { state = s; onState?.(s); } };
  function tick() {
    const r = rect();
    if (!r || !source().videoWidth) return;
    const g = gray(source(), r);
    const fine = coarse(g, 3), sig = coarse(g, 6);
    const motion = prev ? diff(fine, prev) : 99;
    prev = fine;
    if (edges(g) < SHARP) { still = 0; return set('empty'); }
    if (last && diff(sig, last) < NEW_CARD) { still = 0; return set('same'); }
    if (motion > STILL) { still = 0; return set('hold'); }
    if (++still < HOLD || busy()) return set('hold');
    still = 0;
    last = sig;
    set('shot');
    onShot();
  }
  return {
    start() { if (!timer) { prev = null; timer = setInterval(tick, 250); } },
    stop() { clearInterval(timer); timer = null; set(''); },
    reset() { last = null; },
    _tick: tick, // для проверки без камеры
  };
}

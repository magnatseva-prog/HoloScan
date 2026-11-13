// Нейросетевое сравнение картинок: MobileNetV2 (ONNX Runtime, офлайн) превращает фото
// в вектор «смысла» картинки — форма, рисунок, композиция, — устойчивый к бликам и свету.
// Модель отдаёт карту признаков 1280×7×7; сворачиваем её сеткой 2×2 (окна 4×4 по углам),
// так сохраняется расположение деталей. База векторов — tools/build_embed.py; всё должно совпадать.
const ART = [0.08, 0.10, 0.92, 0.50];
const INNER = 0.05;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
export const W_ART = 2; // рисунок различает карты лучше, чем рамка и текст

let sessP;
function session() {
  sessP ??= (async () => {
    const ort = window.ort;
    ort.env.wasm.numThreads = 1; // в WebView нет SharedArrayBuffer
    // абсолютные адреса: ort подгружает загрузчик через import(), относительный путь там не работает
    const abs = (p) => new URL(p, location.href).href;
    ort.env.wasm.wasmPaths = { mjs: abs('vendor/ort/ort-wasm-simd-threaded.js'), wasm: abs('vendor/ort/ort-wasm-simd-threaded.wasm') };
    return ort.InferenceSession.create('models/mnv2_map.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  })();
  sessP.catch(() => { sessP = null; });
  return sessP;
}

let dbP;
export function embedDb() {
  dbP ??= Promise.all([
    fetch('data/emb.json').then((r) => r.json()),
    fetch('data/emb.bin').then((r) => r.arrayBuffer()),
    fetch('data/pca.bin').then((r) => r.arrayBuffer()),
  ]).then(([meta, bin, pca]) => {
    const dim = meta.dim, F = meta.feat || 1280, p = new Float32Array(pca);
    const muW = p.subarray(0, F), PW = p.subarray(F, F + dim * F);
    const o = F + dim * F;
    return {
      dim, F, ids: meta.ids, pos: new Map(meta.ids.map((id, i) => [id, i])), bin: new Int8Array(bin),
      muW, PW, muA: p.subarray(o, o + F), PA: p.subarray(o + F, o + F + dim * F),
    };
  });
  dbP.catch(() => { dbP = null; });
  return dbP;
}
export const warmEmbed = () => Promise.all([session(), embedDb()]).catch(() => {});

// фрагмент картинки → тензор 1×3×224×224 с нормализацией ImageNet
function tensorOf(src, sw, sh, box) {
  const c = document.createElement('canvas');
  c.width = c.height = 224;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, sw * box[0], sh * box[1], sw * (box[2] - box[0]), sh * (box[3] - box[1]), 0, 0, 224, 224);
  const px = g.getImageData(0, 0, 224, 224).data, N = 224 * 224;
  const out = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) {
    for (let ch = 0; ch < 3; ch++) out[ch * N + i] = (px[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
  }
  return out;
}

async function features(src, sw, sh, boxes) {
  const sess = await session();
  const data = new Float32Array(boxes.length * 3 * 224 * 224);
  boxes.forEach((b, k) => data.set(tensorOf(src, sw, sh, b), k * 3 * 224 * 224));
  const input = new window.ort.Tensor('float32', data, [boxes.length, 3, 224, 224]);
  const out = await sess.run({ [sess.inputNames[0]]: input });
  const v = out[sess.outputNames[0]].data; // N×1280×7×7
  return boxes.map((_, k) => grid2(v.subarray(k * 1280 * 49, (k + 1) * 1280 * 49)));
}

// 1280×7×7 → 5120: средние по окнам строк/столбцов [0..3] и [3..6] (как grid2 в build_embed.py)
function grid2(m) {
  const C = 1280, out = new Float32Array(C * 4);
  const win = [[0, 0], [0, 3], [3, 0], [3, 3]]; // (строка, столбец) начала окна 4×4
  for (let w = 0; w < 4; w++) {
    const [r0, c0] = win[w];
    for (let c = 0; c < C; c++) {
      let s = 0;
      const base = c * 49;
      for (let r = r0; r < r0 + 4; r++) for (let q = c0; q < c0 + 4; q++) s += m[base + r * 7 + q];
      out[w * C + c] = s / 16;
    }
  }
  return out;
}

function project(v, mu, P, dim) {
  const F = v.length, y = new Float32Array(dim);
  let n = 0;
  for (let j = 0; j < dim; j++) {
    let s = 0;
    const row = j * F;
    for (let i = 0; i < F; i++) s += P[row + i] * (v[i] - mu[i]);
    y[j] = s; n += s * s;
  }
  n = Math.sqrt(n) || 1;
  for (let j = 0; j < dim; j++) y[j] /= n;
  return y;
}

// Вектор фото (вся карта без краёв + рисунок) в пространстве базы.
export async function embedPhoto(src, sw = src.width, sh = src.height) {
  const db = await embedDb();
  const [w, a] = await features(src, sw, sh, [[INNER, INNER, 1 - INNER, 1 - INNER], ART]);
  const norm = (x) => { let n = 0; for (const t of x) n += t * t; n = Math.sqrt(n) || 1; return x.map((t) => t / n); };
  return { w: project(norm(w), db.muW, db.PW, db.dim), a: project(norm(a), db.muA, db.PA, db.dim) };
}

// Сходство с картой из базы: 0…1 (взвешенное среднее косинусов вся карта / рисунок).
export function simAt(db, q, i) {
  const d = db.dim, o = i * 2 * d, b = db.bin;
  let sw = 0, sa = 0;
  for (let j = 0; j < d; j++) { sw += q.w[j] * b[o + j]; sa += q.a[j] * b[o + d + j]; }
  return (sw + W_ART * sa) / 254 / (1 + W_ART);
}
export function simTo(q, other) {
  let sw = 0, sa = 0;
  for (let j = 0; j < q.w.length; j++) { sw += q.w[j] * other.w[j]; sa += q.a[j] * other.a[j]; }
  return (sw + W_ART * sa) / (1 + W_ART);
}
export const _debug = { features };

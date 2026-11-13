// Оценка состояния карты по фото (на телефоне, без интернета).
// Измеряем то, что по фото измеряется надёжно:
//   центровка — ширина рамки с каждой стороны (главный критерий PSA для лицевой стороны);
//   углы и края — белые потёртости там, где рамка цветная.
// Поверхность (царапины, вмятины) по фото не оцениваем — даём совет проверить самому.
// Результат — ориентир, а не официальная оценка.

const A = 480; // ширина, до которой уменьшаем фото для анализа

// Пороги PSA для центровки лицевой стороны (худшая сторона, в %)
const CENTER = [[55, 10], [60, 9], [65, 8], [70, 7], [75, 6], [80, 5], [85, 4], [101, 3]];
// Доля белых потёртостей (в %) → оценка
const CORNER = [[1, 10], [3, 9], [6, 8], [10, 7], [16, 6], [101, 5]];
const EDGE = [[0.6, 10], [1.5, 9], [3, 8], [5, 7], [8, 6], [101, 5]];
const gradeBy = (table, v) => table.find(([lim]) => v <= lim)[1];

function pixels(src, w, h, rot = 0) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  if (rot) { g.translate(w / 2, h / 2); g.rotate(rot); g.translate(-w / 2, -h / 2); }
  g.drawImage(src, 0, 0, w, h);
  return { c, d: g.getImageData(0, 0, w, h).data };
}
const at = (d, w, x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const medColor = (list) => [0, 1, 2].map((k) => median(list.map((c) => c[k])));
const luma = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
const sat = (c) => { const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; };

// Где на линии кончается фон и начинается карта (первые 3 подряд «не фон»)
function scanEdge(get, n, bg, T = 70) {
  let run = 0;
  for (let i = 0; i < n; i++) {
    if (dist(get(i), bg) > T) { if (++run >= 3) return i - 2; } else run = 0;
  }
  return null;
}

// Внешний контур карты: по 40 линиям с каждой стороны в средней части
function outerBox(d, w, h) {
  const band = [];
  for (let x = 0; x < w; x++) { band.push(at(d, w, x, 1), at(d, w, x, h - 2)); }
  for (let y = 0; y < h; y++) { band.push(at(d, w, 1, y), at(d, w, w - 2, y)); }
  const bg = medColor(band);
  const rows = [], cols = [];
  for (let k = 0; k < 40; k++) {
    const y = Math.round(h * (0.3 + 0.4 * (k / 39))), x = Math.round(w * (0.3 + 0.4 * (k / 39)));
    rows.push({ y, l: scanEdge((i) => at(d, w, i, y), w >> 1, bg), r: scanEdge((i) => at(d, w, w - 1 - i, y), w >> 1, bg) });
    cols.push({ x, t: scanEdge((i) => at(d, w, x, i), h >> 1, bg), b: scanEdge((i) => at(d, w, x, h - 1 - i), h >> 1, bg) });
  }
  const found = rows.filter((r) => r.l != null && r.r != null).length + cols.filter((c) => c.t != null && c.b != null).length;
  // наклон по левому краю: x = a·y + b
  const pts = rows.filter((r) => r.l != null);
  let slope = 0;
  if (pts.length > 10) {
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length, mx = pts.reduce((s, p) => s + p.l, 0) / pts.length;
    let num = 0, den = 0;
    for (const p of pts) { num += (p.y - my) * (p.l - mx); den += (p.y - my) ** 2; }
    slope = den ? num / den : 0;
  }
  return {
    bg, ok: found >= 50, slope,
    x0: median(rows.map((r) => r.l)), x1: w - 1 - median(rows.map((r) => r.r)),
    y0: median(cols.map((c) => c.t)), y1: h - 1 - median(cols.map((c) => c.b)),
  };
}

// Ширина рамки с одной стороны: от края карты внутрь до смены цвета рамки
function borderWidth(lineAt, len, max) {
  const widths = [], colors = [];
  for (let k = 0; k < 30; k++) {
    const t = 0.3 + 0.4 * (k / 29);
    const get = (i) => lineAt(t, i);
    const off = Math.max(2, Math.round(max * 0.12));
    const border = medColor([get(off), get(off + 1), get(off + 2)]);
    colors.push(border);
    // граница рамки — первый резкий перепад цвета (к плашке названия он бывает слабым,
    // поэтому сравниваем соседние пиксели, а не только с цветом рамки)
    let found = null;
    for (let i = off + 3; i < max - 2; i++) {
      const jump = dist(get(i + 1), get(i - 1));
      if (jump > 45 && dist(get(i + 2), border) > 35) { found = i; break; }
    }
    widths.push(found);
  }
  const good = widths.filter((x) => x != null);
  const m = median(widths);
  // разброс: если линии сильно расходятся — у карты нет обычной рамки (full art)
  const spread = good.length ? good.reduce((s, x) => s + Math.abs(x - m), 0) / good.length : 99;
  return { w: m, stable: good.length >= 18 && spread <= Math.max(2, m * 0.25), color: medColor(colors), good: good.length, spread: +spread.toFixed(1) };
}

// photo — снимок карты на тёмном фоне; ref — чистая картинка этой карты из базы (если узнали).
// С ref потёртостью считается только то, что белое на фото, но не белое на оригинале:
// у full art и карт с белыми элементами на рамке иначе не отличить рисунок от износа.
export function gradeCard(photo, ref = null) {
  // 1) края карты и наклон
  const sc = A / photo.width, H = Math.round(photo.height * sc);
  let { c, d } = pixels(photo, A, H);
  let box = outerBox(d, A, H);
  if (!box.ok) return { ok: false, reason: 'bg' };
  if (Math.abs(box.slope) > 0.004 && Math.abs(box.slope) < 0.15) {
    ({ c, d } = pixels(photo, A, H, Math.atan(box.slope)));
    box = outerBox(d, A, H);
    if (!box.ok) return { ok: false, reason: 'bg' };
  }
  const { x0, x1, y0, y1 } = box, cw = x1 - x0, ch = y1 - y0;
  const ar = cw / ch;
  if (cw < A * 0.5 || ar < 0.62 || ar > 0.8) return { ok: false, reason: 'frame' };

  // 2) рамка с четырёх сторон
  const px = (x, y) => at(d, A, Math.max(0, Math.min(A - 1, Math.round(x))), Math.max(0, Math.min(H - 1, Math.round(y))));
  const maxW = cw * 0.2, maxH = ch * 0.2;
  const L = borderWidth((t, i) => px(x0 + i, y0 + ch * t), cw, maxW);
  const R = borderWidth((t, i) => px(x1 - i, y0 + ch * t), cw, maxW);
  const T = borderWidth((t, i) => px(x0 + cw * t, y0 + i), ch, maxH);
  const B = borderWidth((t, i) => px(x0 + cw * t, y1 - i), ch, maxH);
  const sides = [L, R, T, B];
  const ok = (s) => s.stable && s.w > cw * 0.012;
  // У старых карт плашка названия заходит на рамку — тогда верх/низ не измерить, считаем только лево/право
  const lrOk = ok(L) && ok(R), tbOk = ok(T) && ok(B);
  const measurable = lrOk; // без боковой рамки — full art
  let centering = null;
  if (lrOk) {
    const lr = L.w / (L.w + R.w), tb = tbOk ? T.w / (T.w + B.w) : null;
    const worst = Math.max(lr, 1 - lr, ...(tbOk ? [tb, 1 - tb] : [])) * 100;
    centering = {
      lr: [Math.round(lr * 100), 100 - Math.round(lr * 100)],
      tb: tbOk ? [Math.round(tb * 100), 100 - Math.round(tb * 100)] : null,
      grade: gradeBy(CENTER, worst), px: { L: L.w, R: R.w, T: tbOk ? T.w : null, B: tbOk ? B.w : null },
    };
  }

  // 3) углы и края: белые потёртости на цветной рамке
  const border = medColor(sides.map((s) => s.color));
  const lightBorder = luma(border) > 185 && sat(border) < 0.2; // серебряная/белая рамка — потёртости не видны
  const isCard = (p) => dist(p, box.bg) > 70;
  const isWhite = (p) => luma(p) > 215 && sat(p) < 0.12;
  let refWhite = () => false;
  if (ref) {
    const { d: rd } = pixels(ref, Math.round(cw), Math.round(ch));
    const RW = Math.round(cw), RH = Math.round(ch);
    // окрестность 5×5: снимок и оригинал совпадают с точностью до пары пикселей
    refWhite = (x, y) => {
      const rx = Math.round(x - x0), ry = Math.round(y - y0);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = rx + dx, yy = ry + dy;
        if (xx < 0 || yy < 0 || xx >= RW || yy >= RH) continue;
        const i = (yy * RW + xx) * 4;
        if (rd[i + 3] < 128 || isWhite([rd[i], rd[i + 1], rd[i + 2]])) return true; // прозрачный угол оригинала — тоже не считаем
      }
      return false;
    };
  }
  // считаем только саму рамку: внутри неё бывают светлые линии и рисунок — это не потёртости
  const bw = measurable ? (L.w + R.w) / 2 * 0.75 : cw * 0.03;
  const inBorder = (x, y) => x - x0 < bw || x1 - x < bw || y - y0 < bw || y1 - y < bw;
  const wear = (xa, ya, xb, yb) => {
    let n = 0, white = 0;
    for (let y = Math.round(ya); y < yb; y++) for (let x = Math.round(xa); x < xb; x++) {
      if (!inBorder(x, y)) continue;
      const p = px(x, y);
      if (!isCard(p)) continue;
      n++; if (isWhite(p) && !refWhite(x, y)) white++;
    }
    return n ? (white / n) * 100 : 0;
  };
  // углы — только самый кончик (в рамке у некоторых карт белые плашки вроде «BASIC»),
  // края — внешние 0.7% (в нижней рамке бывает светлый текст копирайта)
  const s = Math.max(4, Math.min(cw * 0.05, bw)), e = Math.max(2, cw * 0.007);
  let corners = null, edges = null;
  // только у карт с ровной цветной рамкой: у full art рисунок доходит до края, светлые места — не потёртости
  if (!lightBorder && (measurable || ref)) {
    const cs = [wear(x0, y0, x0 + s, y0 + s), wear(x1 - s, y0, x1, y0 + s), wear(x0, y1 - s, x0 + s, y1), wear(x1 - s, y1 - s, x1, y1)];
    const es = [
      // отступ в 1 пиксель: самый внешний ряд — сглаженный контур, он светлее рамки
      wear(x0 + s, y0 + 1, x1 - s, y0 + 1 + e), wear(x1 - 1 - e, y0 + s, x1 - 1, y1 - s), // верх, право
      wear(x0 + s, y1 - 1 - e, x1 - s, y1 - 1), wear(x0 + 1, y0 + s, x0 + 1 + e, y1 - s), // низ, лево
    ];
    corners = { each: cs.map((v) => +v.toFixed(1)), grade: Math.min(...cs.map((v) => gradeBy(CORNER, v))) };
    edges = { each: es.map((v) => +v.toFixed(1)), grade: Math.min(...es.map((v) => gradeBy(EDGE, v))) };
  }

  // 4) итог: как у PSA — по самому слабому месту
  const parts = [centering?.grade, corners?.grade, edges?.grade].filter((x) => x != null);
  const overall = parts.length ? Math.min(...parts) : null;

  // картинка с разметкой: внешний контур, внутренняя рамка, углы
  const view = document.createElement('canvas');
  view.width = A; view.height = H;
  const g = view.getContext('2d');
  g.drawImage(c, 0, 0);
  g.lineWidth = 2;
  g.strokeStyle = '#3d9bff'; g.strokeRect(x0, y0, cw, ch);
  if (centering) {
    g.strokeStyle = '#35d07f';
    const tw = tbOk ? T.w : (L.w + R.w) / 2, bw2 = tbOk ? B.w : (L.w + R.w) / 2;
    g.strokeRect(x0 + L.w, y0 + tw, cw - L.w - R.w, ch - tw - bw2);
  }
  if (corners) {
    const col = (v) => (gradeBy(CORNER, v) >= 9 ? '#35d07f' : gradeBy(CORNER, v) >= 7 ? '#f5c84c' : '#ff5a5f');
    [[x0, y0], [x1 - s, y0], [x0, y1 - s], [x1 - s, y1 - s]].forEach(([x, y], k) => {
      g.strokeStyle = col(corners.each[k]); g.strokeRect(x, y, s, s);
    });
  }
  const crop = document.createElement('canvas');
  const m = cw * 0.04;
  crop.width = Math.round(cw + 2 * m); crop.height = Math.round(ch + 2 * m);
  crop.getContext('2d').drawImage(view, x0 - m, y0 - m, crop.width, crop.height, 0, 0, crop.width, crop.height);

  const th = document.createElement('canvas');
  th.width = 120; th.height = Math.round(crop.height * (120 / crop.width));
  th.getContext('2d').drawImage(crop, 0, 0, th.width, th.height);
  return {
    ok: true, centering, corners, edges, overall, lightBorder, fullArt: !measurable, withRef: !!ref,
    image: crop.toDataURL('image/jpeg', 0.85), thumb: th.toDataURL('image/jpeg', 0.75), debug: { box: { x0, x1, y0, y1 }, sides: sides.map(({ w, good, spread }) => ({ w, good, spread })) } };
}

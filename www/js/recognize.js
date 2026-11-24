// Распознавание карты по фото: OCR названия и номера (tesseract.js, офлайн),
// поиск в индексе TCGdex, выбор среди похожих по картинке.
import { loadIndex, norm, setOf, imgUrl, LANG_KEYS } from './api.js';
import { embedDb, embedPhoto, simAt, simTo } from './embed.js';

// Отдельный воркер на каждую область: название и номер читаются параллельно,
// и режим сегментации не надо переключать между вызовами.
export const cfg = { langPath: 'vendor/lang' };
// Латиница читается английской моделью (она в приложении); для азиатских карт
// модель скачивается один раз и кэшируется.
const OCR_LANG = { ja: 'jpn', ko: 'kor', 'zh-tw': 'chi_tra', 'zh-cn': 'chi_sim', th: 'tha' };
const REMOTE_OCR = 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@4.1.0';
export const ocrLangOf = (cardLang) => OCR_LANG[cardLang] || 'eng';
const workers = new Map();
// extra — дополнительные параметры tesseract (например, только цифры)
function worker(key, psm, lang = 'eng', extra = null) {
  key = `${key}:${lang}`;
  if (!workers.has(key)) {
    const local = lang === 'eng';
    const p = Tesseract.createWorker(lang, 1, {
      workerPath: 'vendor/worker.min.js',
      corePath: 'vendor/core',
      langPath: local ? cfg.langPath : REMOTE_OCR,
      workerBlobURL: false,
      gzip: false,
      cacheMethod: local ? 'none' : 'write', // своя модель лежит в приложении, чужую кэшируем
    }).then(async (w) => { await w.setParameters({ tessedit_pageseg_mode: psm, ...(extra || {}) }); w.psm = psm; return w; });
    p.catch(() => workers.delete(key));
    workers.set(key, p);
  }
  return workers.get(key);
}
const DIGITS = { tessedit_char_whitelist: '0123456789/' };
// воркеры поднимаются заранее: первый скан не ждёт загрузки моделей. Цифровые (углы с номером) — следом.
export const warmUp = (cardLang = 'en') => Promise.all([worker('head', '6', ocrLangOf(cardLang)), worker('bottom', '11')])
  .then(() => Promise.all([worker('digits', '11', 'eng', DIGITS), worker('digitsR', '11', 'eng', DIGITS)])).catch(() => {});

// ---------- работа с canvas ----------
// gray: 'luma' — обычная яркость; 'max' — самый яркий канал (тёмный текст на цветной плашке).
function crop(src, x, y, w, h, scale = 1, gray = false) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  if (gray) {
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    let min = 255, max = 0;
    for (let i = 0; i < p.length; i += 4) {
      const v = gray === 'max' ? Math.max(p[i], p[i + 1], p[i + 2]) : p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11;
      p[i] = v; if (v < min) min = v; if (v > max) max = v;
    }
    const k = 255 / Math.max(40, max - min);
    for (let i = 0; i < p.length; i += 4) {
      const v = (p[i] - min) * k;
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    g.putImageData(d, 0, 0);
  }
  return c;
}

function linesOf(data) {
  if (data.lines?.length) return data.lines;
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) out.push(l);
  return out;
}

async function ocr(canvas, key = 'full', psm = '3', lang = 'eng', extra = null) {
  const w = await worker(key, psm, lang, extra);
  if (w.psm !== psm) { await w.setParameters({ tessedit_pageseg_mode: psm }); w.psm = psm; }
  const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
  return { text: data.text || '', lines: linesOf(data) };
}

// ---------- нечёткое сравнение строк ----------
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);

// Триграммный индекс имён без пробелов: OCR часто склеивает слова и мусор
// («pjpiecharcadlp»), поэтому ищем имя как подстроку строки.
// Для иероглифов, каны и тайского имена короткие — берём биграммы.
const ASIAN = new Set(['ja', 'ko', 'zh-tw', 'zh-cn', 'th']);
const gramOf = (index) => (index.langs?.some((l) => ASIAN.has(l)) ? 2 : 3);
function trigrams(s, g = 3) {
  const out = new Set();
  for (let i = 0; i + g <= s.length; i++) out.add(s.slice(i, i + g));
  return out;
}
// Таблица имён: имя → id карт и языки, на которых оно так пишется. Кроме загруженного
// индекса берём имена со всех латинских языков из data/names.json — так испанская
// карта находится, даже если в настройках выбран английский.
const LATIN = ['en', 'es', 'fr', 'de', 'it', 'pt', 'es-mx', 'id'];
let metaP;
function metaDb() {
  metaP ??= Promise.all([
    fetch('data/names.json').then((r) => r.json()),
    fetch('data/hp.json').then((r) => r.json()),
  ]).then(([names, hp]) => ({ names, hp })).catch(() => ({ names: {}, hp: {} }));
  return metaP;
}
export const warmMeta = () => metaDb();
function nameTable(index, meta) {
  if (index.nt) return index.nt;
  const nt = new Map();
  const add = (n, id, lang) => {
    let e = nt.get(n);
    if (!e) nt.set(n, (e = { ids: new Set(), langs: new Set() }));
    e.ids.add(id); e.langs.add(lang);
  };
  for (const [n, list] of index.byName) for (const c of list) add(n, c.id, c.lang);
  const langs = [...LATIN, ...index.langs.filter((l) => ASIAN.has(l))];
  for (const l of langs) for (const [n, ids] of Object.entries(meta.names[l] || {})) for (const id of ids) add(n, id, l);
  return (index.nt = nt);
}
function nameIndex(index) {
  if (index.tri) return index.tri;
  const tri = new Map(), names = [], g = gramOf(index);
  for (const n of index.nt.keys()) {
    const flat = n.replace(/[^\p{L}\p{N}]/gu, '');
    if (flat.length < (g === 2 ? 2 : 4)) continue;
    const id = names.push({ n, flat, ntri: 0 }) - 1;
    const ts = trigrams(flat, g);
    names[id].ntri = ts.size;
    for (const t of ts) {
      if (!tri.has(t)) tri.set(t, []);
      tri.get(t).push(id);
    }
  }
  return (index.tri = { tri, names, g });
}
// лучшее сходство имени с любым окном строки той же длины (±1)
function subSim(line, flat) {
  if (line.length <= flat.length + 1) return sim(line, flat);
  let best = 0;
  for (let L = flat.length - 1; L <= flat.length + 1; L++) {
    for (let i = 0; i + L <= line.length; i++) {
      const s = sim(line.slice(i, i + L), flat);
      if (s > best) best = s;
    }
  }
  return best;
}

function findNames(index, lines, cardH, lang = 'en') {
  const { tri, names, g } = nameIndex(index);
  const scores = new Map();
  const consider = (text, weight) => {
    // «Pikachu@x», «Pikachu€X» — так OCR видит стилизованное «ex»
    const t = norm(text.replace(/[@€©®&]\s?[xX]\b/g, ' ex'));
    // строки правил («Pokémon ex rule», «regla de los Pokémon V») — не название
    if (/\b(rule|regla|knocked|cuando|when|retreat|retirada|weakness|debilidad|illus)\b/.test(t)) return;
    const flat = t.replace(/[^\p{L}]/gu, '');
    if (flat.length < (g === 2 ? 2 : 4)) return;
    const hits = new Map();
    for (const gr of trigrams(flat, g)) for (const id of tri.get(gr) || []) hits.set(id, (hits.get(id) || 0) + 1);
    for (const [id, h] of hits) {
      const nm = names[id];
      if (h < Math.max(g === 2 ? 1 : 2, nm.ntri * 0.35)) continue;
      const s = subSim(flat, nm.flat);
      // короткие имена совпадают случайно — для них нужна точность;
      // имена только с других языков (не выбранного и не английского) — тоже строже
      const e = index.nt.get(nm.n);
      const foreign = !e.langs.has(lang) && !e.langs.has('en');
      if (s < (nm.flat.length <= 5 ? 1 : nm.flat.length <= 7 ? 0.85 : 0.75) + (foreign ? 0.12 : 0)) continue;
      const sc = s * weight + nm.flat.length * 0.003;
      if ((scores.get(nm.n) || 0) < sc) scores.set(nm.n, sc);
    }
  };
  for (const l of lines) {
    const cy = l.bbox ? (l.bbox.y0 + l.bbox.y1) / 2 / cardH : 0;
    // название всегда в верхней части карты
    if (cy > 0.4) continue; // ниже — описание атак и правил, там встречаются слова вроде «rival»
    consider(l.text, cy < 0.22 ? 1 : 0.8);
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, score]) => ({ n, score }));
}

// "039/198", "TG12/TG30", "SV050/SV122"; правим типичные ошибки OCR (O→0, l→1).
function findNumber(text) {
  const fix = (s) => s.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S(?=\d)/g, '5');
  const t = text.replace(/[\\|]/g, '/');
  const re = /([A-Z]{0,3}[0-9OolI]{1,3})\s*\/\s*([A-Z]{0,3}[0-9OolI]{2,3})/g;
  let m, best = null;
  while ((m = re.exec(t))) {
    const a = m[1].match(/^([A-Z]*)(.*)$/), b = m[2].match(/^([A-Z]*)(.*)$/);
    const num = fix(a[2]), total = fix(b[2]);
    if (!/^\d+$/.test(num) || !/^\d+$/.test(total)) continue;
    const r = { prefix: a[1], num: +num, total: +total, raw: m[0] };
    if (r.total < 10 || r.total > 400) continue;
    if (!best || r.num <= r.total) best = r;
  }
  return best;
}

// HP — крупные цифры справа в заголовке: «HP 280», «PS 280», «KP 280», «280 PV».
function findHP(text) {
  const n = new Map();
  for (const m of text.matchAll(/(\d{2,3})/g)) {
    const v = +m[1];
    if (v % 10 || v < 30 || v > 400) continue;
    const label = /(HP|PS|KP|PV|PF)\s*$/i.test(text.slice(Math.max(0, m.index - 4), m.index));
    n.set(v, (n.get(v) || 0) + 1 + (label ? 2 : 0));
  }
  const best = [...n.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return best ? { hp: best[0], strong: best[1] >= 2 } : null; // два одинаковых прочтения или подпись «HP»
}

const SUFFIXES = new Set(['ex', 'gx', 'v', 'vmax', 'vstar', 'v union', 'break', 'lv x', 'prime', 'star', 'radiante']);
function suffixed(index, n) {
  index.suffixCache ??= new Map();
  if (!index.suffixCache.has(n)) {
    const out = [];
    for (const [m, e] of index.nt) {
      if (m.startsWith(`${n} `) && SUFFIXES.has(m.slice(n.length + 1))) out.push([m, e]);
    }
    index.suffixCache.set(n, out);
  }
  return index.suffixCache.get(n);
}


function localMatch(card, number) {
  const id = card.localId || '';
  const m = id.match(/^([A-Z]*)0*(\d+)/i);
  if (!m) return false;
  return +m[2] === number.num && (!number.prefix || m[1].toUpperCase() === number.prefix);
}

function setTotalMatch(index, card, number) {
  const s = setOf(index, card);
  if (!s?.cardCount) return true; // нет данных о сете — не отсекаем
  return s.cardCount.official === number.total || s.cardCount.total === number.total;
}

// ---------- сравнение картинок ----------
// Нейросеть (embed.js) даёт сходство 0…1; текст добавляет к нему бонусы в тех же единицах.
function loadImg(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}
export const BONUS = { name: 0.12, exact: 0.03, number: 0.16, hp: 0.05, hpStrong: 0.08, total: 0.04 };
// сходство картинки выше этого — почти наверняка та самая карта
export const SURE = { sim: 0.62, gap: 0.08 };
// Быстрый путь: картинка узнана однозначно — текст не читаем (перепечатки с тем же рисунком сюда не попадают: у них нет отрыва)
// Пары [сходство, отрыв]: подходит любая. Ошибки на стенде — с отрывом < 0.06, верные — от 0.1 и выше.
export const FAST = [[0.6, 0.12], [0.5, 0.17]];

function allSims(db, q) {
  const out = new Float32Array(db.ids.length);
  for (let i = 0; i < out.length; i++) out[i] = simAt(db, q, i);
  return out;
}
// индексы k лучших (из всех или из списка)
function topK(sims, k, among = null) {
  const best = [];
  const consider = (i) => {
    if (best.length < k || sims[i] > sims[best[best.length - 1]]) {
      best.push(i);
      best.sort((a, b) => sims[b] - sims[a]);
      if (best.length > k) best.pop();
    }
  };
  if (among) for (const i of among) consider(i);
  else for (let i = 0; i < sims.length; i++) consider(i);
  return best;
}

// ---------- поиск карты на фото ----------
// Карта редко лежит ровно по рамке: вокруг виден стол, она чуть повёрнута.
// Ищем её по отличию от цвета фона у краёв кадра, выравниваем наклон и обрезаем.
function cardMask(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const p = g.getImageData(0, 0, w, h).data;
  // цвет фона — медиана по рамке в 2 пикселя
  const border = [[], [], []];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x > 1 && x < w - 2 && y > 1 && y < h - 2) continue;
    const i = (y * w + x) * 4;
    for (let ch = 0; ch < 3; ch++) border[ch].push(p[i + ch]);
  }
  const med = border.map((a) => a.sort((x, y) => x - y)[a.length >> 1]);
  // фон пёстрый (или карта уже на весь кадр) — искать нечего
  const spread = border.map((a, ch) => a.reduce((s, v) => s + Math.abs(v - med[ch]), 0) / a.length);
  if (spread[0] + spread[1] + spread[2] > 60) return null;
  const m = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    m[j] = Math.abs(p[i] - med[0]) + Math.abs(p[i + 1] - med[1]) + Math.abs(p[i + 2] - med[2]) > 70 ? 1 : 0;
  }
  return m;
}
function maskBox(m, w, h) {
  const rows = [], cols = new Array(w).fill(0);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (m[y * w + x]) { n++; cols[x]++; }
    rows.push(n);
  }
  const first = (arr, lim) => arr.findIndex((v) => v > lim);
  const last = (arr, lim) => arr.length - 1 - [...arr].reverse().findIndex((v) => v > lim);
  const y0 = first(rows, w * 0.35), y1 = last(rows, w * 0.35), x0 = first(cols, h * 0.35), x1 = last(cols, h * 0.35);
  if (y0 < 0 || x0 < 0 || y1 <= y0 || x1 <= x0) return null;
  return { x0, y0, x1, y1 };
}
function findCard(src) {
  const w = 220, h = Math.round(src.height * (w / src.width));
  const m = cardMask(src, w, h);
  if (!m) return src;
  const box = maskBox(m, w, h);
  if (!box) return src;
  // наклон — по левому и правому краю в средней части карты
  const fit = (side) => {
    const pts = [];
    for (let y = Math.round(box.y0 + (box.y1 - box.y0) * 0.2); y < box.y0 + (box.y1 - box.y0) * 0.8; y++) {
      let x = side < 0 ? box.x0 - 3 : box.x1 + 3;
      const step = side < 0 ? 1 : -1;
      for (let k = 0; k < 30 && x >= 0 && x < w; k++, x += step) if (m[y * w + x] && m[y * w + x + step]) break;
      pts.push([y, x]);
    }
    const n = pts.length, my = pts.reduce((s, q) => s + q[0], 0) / n, mx = pts.reduce((s, q) => s + q[1], 0) / n;
    let num = 0, den = 0;
    for (const [y, x] of pts) { num += (y - my) * (x - mx); den += (y - my) ** 2; }
    return den ? num / den : 0;
  };
  let angle = Math.atan((fit(-1) + fit(1)) / 2);
  if (!Number.isFinite(angle) || Math.abs(angle) > 0.15) angle = 0;
  let img = src, box2 = box;
  if (Math.abs(angle) > 0.004) {
    const r = document.createElement('canvas');
    r.width = src.width; r.height = src.height;
    const g = r.getContext('2d');
    g.translate(r.width / 2, r.height / 2);
    g.rotate(angle); // край x = a·y + b; поворот на atan(a) делает его вертикальным
    g.drawImage(src, -src.width / 2, -src.height / 2);
    const rm = cardMask(r, w, h);
    const b = rm && maskBox(rm, w, h);
    if (b) { img = r; box2 = b; }
  }
  const k = src.width / w;
  const bw = (box2.x1 - box2.x0) * k, bh = (box2.y1 - box2.y0) * k;
  const ar = bw / bh;
  if (ar < 0.62 || ar > 0.82 || bw * bh < src.width * src.height * 0.4) return src;
  const out = document.createElement('canvas');
  out.width = Math.round(bw); out.height = Math.round(bh);
  out.getContext('2d').drawImage(img, box2.x0 * k, box2.y0 * k, bw, bh, 0, 0, out.width, out.height);
  return out;
}

// ---------- главный вход ----------
// card — canvas с фото карты (обрезанный по рамке). Возвращает {candidates, name, number, text}.
// opts.lang — язык карт из настроек (код TCGdex: en, es, ja…).
export async function recognize(card, onStage = () => {}, opts = {}) {
  onStage('st.load');
  const lang = opts.lang || 'en';
  const ocrLang = ocrLangOf(lang);
  const [index, meta] = await Promise.all([loadIndex(lang, onStage), metaDb()]);
  nameTable(index, meta);
  const T0 = performance.now(), mark = (k) => opts.debug && ((opts.debug.t ??= {})[k] = Math.round(performance.now() - T0));
  card = findCard(card);
  mark('find');
  const W = 900, H = Math.round(card.height * (W / card.width));
  const headCrop = (tw) => crop(card, card.width * 0.02, 0, card.width * 0.85, card.height * 0.17, tw / card.width, true);
  const merge = (a, b) => [...a, ...b].sort((x, y) => y.score - x.score).filter((x, i, arr) => arr.findIndex((y) => y.n === x.n) === i);

  const prefer = (id) => index.byId.get(`${lang}:${id}`) || index.byId.get(`en:${id}`) || LANG_KEYS.map((k) => index.byId.get(`${k}:${id}`)).find(Boolean);
  // Название (верхняя полоса) и номер (нижняя) читаем одновременно в двух воркерах — после нейросети:
  // если картинка узнана однозначно, текст не нужен вовсе.
  const read1 = () => Promise.all([
    ocr(headCrop(1000), 'head', '6', ocrLang).finally(() => mark('head1')),
    ocr(crop(card, 0, card.height * 0.86, card.width, card.height * 0.14, (opts.bw || 2000) / card.width, true), 'bottom', '11').finally(() => mark('bottom1')),
  ]);
  const read1P = opts.parallel === true ? read1() : null; // параллельно медленнее: воркеры и нейросеть делят процессор
  read1P?.catch(() => {});
  const visP = Promise.all([embedDb(), embedPhoto(card)]);
  let sims = null;

  if (opts.fast !== false) {
    const [db, q] = await visP;
    sims = allSims(db, q);
    mark('vis');
    const top = topK(sims, 8);
    const best = top[0], bestV = sims[best];
    // отрыв считаем от лучшей карты с другим рисунком: у одинаковых перепечаток он почти нулевой
    const other = top.find((i) => i !== best && sims[i] < bestV - 0.02);
    const twins = top.filter((i) => sims[i] >= bestV - 0.02).length;
    if (opts.debug) opts.debug.vis = [db.ids[best], +bestV.toFixed(3), other == null ? null : +(bestV - sims[other]).toFixed(3), twins];
    const gap = other == null ? 1 : bestV - sims[other];
    if (twins === 1 && (opts.fastRules || FAST).some(([sim, g]) => bestV >= sim && gap >= g)) {
      const c = prefer(db.ids[best]);
      if (c) {
        const candidates = [c, ...top.slice(1).map((i) => prefer(db.ids[i])).filter(Boolean)].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
        mark('done');
        return { candidates, sure: true, lang: c.lang, hp: null, name: c.name, number: null, text: '', head: '', bottom: '', fast: true };
      }
    }
  }

  onStage('st.read');
  const [h1, bottom] = await (read1P || read1());
  const head = { text: h1.text, lines: h1.lines.map((l) => ({ text: l.text })) };
  let names = findNames(index, head.lines, 1, lang);
  let text = `${head.text}\n${bottom.text}`;
  let number = findNumber(bottom.text);
  mark('read1');
  onStage('st.compare');
  let res = await evaluate();

  // Не уверены — второй масштаб названия (tesseract капризен к размеру букв),
  // а если нет и номера — ещё и вся карта целиком. Тоже параллельно.
  if (!res.sure) {
    onStage('st.read2');
    // номер: у новых карт внизу слева, у старых — справа; читаем углы крупно и только цифры
    const corner = (right) => crop(card, right ? card.width * 0.45 : 0, card.height * 0.8, card.width * 0.55, card.height * 0.2, 1400 / (card.width * 0.55), true);
    const [h2, full, numL, numR] = await Promise.all([
      ocr(headCrop(1600), 'head', '6', ocrLang).finally(() => mark('head2')),
      opts.full === true && (!number || !names.length) ? ocr(crop(card, 0, 0, card.width, card.height, W / card.width, true), 'bottom', '3').finally(() => mark('full2')) : null,
      !number ? ocr(corner(false), 'digits', '11', 'eng', DIGITS).then((r) => (mark('numL2'), r)) : null,
      !number ? ocr(corner(true), 'digitsR', '11', 'eng', DIGITS).then((r) => (mark('numR2'), r)) : null,
    ]);
    number ??= findNumber(`${numL?.text || ''}\n${numR?.text || ''}`);
    head.text += `\n${h2.text}`;
    text += `\n${h2.text}`;
    names = merge(names, findNames(index, h2.lines.map((l) => ({ text: l.text })), 1, lang));
    if (full) {
      text += `\n${full.text}`;
      if (!names.length || names[0].score < 0.85) names = merge(names, findNames(index, full.lines, H, lang));
      number ??= findNumber(full.text);
    }
    mark('read2');
    onStage('st.compare');
    res = await evaluate();
  }
  mark('done');
  return { ...res, name: names[0]?.n, number, text, head: head.text, bottom: bottom.text };

  // Кандидаты по тексту (имя, номер, HP) и по картинке → одна оценка на карту.
  async function evaluate() {
    // Язык карты — по тому, на каком языке так пишется прочитанное имя.
    const top = names[0] && index.nt.get(names[0].n);
    const foundLang = !top || names[0].score < 0.9 || top.langs.has(lang) || top.langs.has('en') ? lang : LANG_KEYS.find((l) => top.langs.has(l)) || lang;
    // по имени, плюс те же покемоны с приставками (ex, V, VMAX…) — мелкое «ex» OCR часто теряет
    const byName = new Set(), nameIds = new Set(), exactIds = new Set(top?.ids || []);
    for (const { n, score } of names) {
      if (score < names[0].score - 0.12) break;
      for (const e of [index.nt.get(n), ...suffixed(index, n).map(([, x]) => x)]) {
        for (const id of e.ids) {
          nameIds.add(id);
          const c = prefer(id);
          if (c) byName.add(c);
        }
      }
    }
    const byNum = new Set(number ? index.cards.filter((c) => localMatch(c, number) && setTotalMatch(index, c, number)) : []);
    const both = [...byName].filter((c) => byNum.has(c));
    // совпали и имя, и номер — других не нужно; иначе берём и тех и других и решаем по картинке
    let pool = both.length ? both : [...byName, ...(byNum.size <= 40 ? byNum : [])];
    // одинаковые id на двух языках — оставляем язык из настроек
    const byId = new Map();
    for (const c of pool) {
      const prev = byId.get(c.id);
      if (!prev || (c.lang === lang && prev.lang !== lang)) byId.set(c.id, c);
    }
    pool = [...byId.values()].filter((c) => c.image);
    const hpRead = findHP(head.text);
    const hpIds = new Set(hpRead ? meta.hp[hpRead.hp] || [] : []);
    const hpBonus = hpRead?.strong ? BONUS.hpStrong : BONUS.hp;

    const [db, q] = await visP;
    sims ??= allSims(db, q);
    const simOf = (id) => { const i = db.pos.get(id); return i == null ? null : sims[i]; };
    const score = new Map(); // id → {c, s (итог), v (картинка)}
    const put = (c, v, s) => { const p = score.get(c.id); if (!p || s > p.s) score.set(c.id, { c, v, s }); };
    // число карт в сете («/182») различает перепечатки с одинаковым рисунком, даже если сам номер прочитан с ошибкой
    const totalOk = (c) => !!number && !!setOf(index, c)?.cardCount && setTotalMatch(index, c, number);
    const bonus = (id, c = prefer(id)) => (nameIds.has(id) ? BONUS.name + (exactIds.has(id) ? BONUS.exact : 0) : 0) + (hpIds.has(id) ? hpBonus : 0)
      + (c && !byNum.has(c) && totalOk(c) ? BONUS.total : 0);

    // 1) кандидаты по тексту: сходство картинки плюс бонус за совпавшие имя, номер, HP
    let fetched = 0;
    await Promise.all(pool.map(async (c) => {
      let v = simOf(c.id);
      if (v == null && fetched++ < 6) {
        // карта новее базы — считаем её вектор по миниатюре
        try {
          const im = await loadImg(imgUrl(c, 'low'));
          v = simTo(q, await embedPhoto(im, im.naturalWidth, im.naturalHeight));
        } catch {}
      }
      v ??= 0.2;
      put(c, v, v + bonus(c.id, c) + (byNum.has(c) ? BONUS.number : 0));
    }));

    if (db.ids.length && !both.length) {
      // 2) самые похожие по картинке во всей базе — на случай, если текст прочитался неверно
      // 3) самые похожие среди карт с прочитанным HP
      const hpIdx = [...hpIds].map((id) => db.pos.get(id)).filter((x) => x != null);
      for (const i of [...topK(sims, 40), ...topK(sims, 30, hpIdx)]) {
        const c = prefer(db.ids[i]);
        if (c) put(c, sims[i], sims[i] + bonus(c.id, c));
      }
    }
    return finish();

    function finish() {
      const ranked = [...score.values()].sort((a, b) => b.s - a.s);
      if (opts.debug) opts.debug.scores = ranked.slice(0, 5).map((r) => [r.c.id, +r.s.toFixed(3), +r.v.toFixed(3)]);
      // Уверены, если совпали имя или номер, либо картинка очень похожа и заметно лучше остальных.
      const [best, second] = ranked;
      const sure = !!best && (nameIds.has(best.c.id) || byNum.has(best.c) || best.v >= SURE.sim || best.v - (second?.v ?? 0) >= SURE.gap);
      // карта на другом языке, чем в настройках, — показываем её в языке оригинала
      const candidates = ranked.slice(0, 12).map((r) => (foundLang !== r.c.lang && index.byId.get(`${foundLang}:${r.c.id}`)) || r.c);
      return { candidates, hp: hpRead?.hp || null, lang: foundLang, sure, visualOnly: !pool.length };
    }
  }
}
export const _debug = { crop, ocr, findNames, findNumber, findCard };

// TCGdex: каталог карт, сеты, цены. Списки кэшируем в IndexedDB на неделю.
const API = 'https://api.tcgdex.net/v2';
// Языки карт, которые есть в TCGdex (русских карт там нет)
export const CARD_LANGS = {
  en: 'English', fr: 'Français', de: 'Deutsch', it: 'Italiano', es: 'Español', 'es-mx': 'Español (México)',
  pt: 'Português', 'pt-br': 'Português (Brasil)', id: 'Bahasa Indonesia',
  ja: '日本語', ko: '한국어', 'zh-tw': '中文（繁體）', 'zh-cn': '中文（简体）', th: 'ไทย',
};
export const LANG_KEYS = Object.keys(CARD_LANGS);
const INDEX_TTL = 7 * 24 * 3600 * 1000;

// ---------- IndexedDB (простое key-value) ----------
let dbp;
function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('holoscan', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function kvGet(key) {
  try {
    const d = await db();
    return await new Promise((res) => {
      const q = d.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result);
      q.onerror = () => res(undefined);
    });
  } catch { return undefined; }
}
async function kvSet(key, val) {
  try {
    const d = await db();
    d.transaction('kv', 'readwrite').objectStore('kv').put(val, key);
  } catch {}
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

async function cached(key, url, ttl = INDEX_TTL) {
  const hit = await kvGet(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  try {
    const v = await getJSON(url);
    kvSet(key, { t: Date.now(), v });
    return v;
  } catch (e) {
    if (hit) return hit.v; // офлайн — старые данные лучше, чем ничего
    throw e;
  }
}

// ---------- нормализация текста ----------
// Любые алфавиты (латиница, кана, иероглифы, тайский); диакритику убираем.
export function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// ---------- индекс карт ----------
// Всегда английская база (самая полная, у неё картинки) плюс выбранный язык карт.
// cards: [{id, localId, name, image, lang, n (норм. имя)}]
// byName: Map<n, card[]>, sets: Map<lang:setId, set>, byId: Map<lang:id, card>
const indexes = new Map();
export function loadIndex(cardLang = 'en', onProgress) {
  const langs = [...new Set([cardLang, 'en'])];
  const key = langs.join(',');
  if (!indexes.has(key)) {
    const p = (async () => {
      const cards = [], byName = new Map(), sets = new Map(), byId = new Map();
      // Pokémon TCG Pocket — цифровая игра, таких карт в руках не бывает
      const pocket = new Set(await cached('series-tcgp', `${API}/en/series/tcgp`).then((x) => x.sets.map((s) => s.id)).catch(() => []));
      for (const lang of langs) {
        onProgress?.('st.db', { lang: CARD_LANGS[lang] || lang });
        const [list, setList] = await Promise.all([
          cached(`cards-${lang}`, `${API}/${lang}/cards`),
          cached(`sets-${lang}`, `${API}/${lang}/sets`),
        ]);
        for (const s of setList) sets.set(`${lang}:${s.id}`, s);
        for (const c of list) {
          if (pocket.has(c.id.slice(0, c.id.lastIndexOf('-')))) continue;
          const card = { ...c, lang, n: norm(c.name) };
          cards.push(card);
          byId.set(`${lang}:${c.id}`, card);
          if (!byName.has(card.n)) byName.set(card.n, []);
          byName.get(card.n).push(card);
        }
      }
      // у части карт нет картинки на своём языке — берём английскую с тем же id
      for (const c of cards) if (!c.image) c.image = byId.get(`en:${c.id}`)?.image;
      return { cards, byName, sets, byId, langs };
    })();
    p.catch(() => indexes.delete(key));
    indexes.set(key, p);
  }
  return indexes.get(key);
}

export function setOf(index, card) {
  const setId = card.id.slice(0, card.id.lastIndexOf('-'));
  return index.sets.get(`${card.lang}:${setId}`);
}

export function imgUrl(card, q = 'low') {
  return card?.image ? `${card.image}/${q}.webp` : 'img/back.svg';
}

// ---------- полная карточка с ценами ----------
const detailMem = new Map();
export async function cardDetail(lang, id, fresh = false) {
  const key = `${lang}:${id}`;
  if (!fresh && detailMem.has(key)) return detailMem.get(key);
  const p = fresh
    ? getJSON(`${API}/${lang}/cards/${encodeURIComponent(id)}`)
    : cached(`card-${key}`, `${API}/${lang}/cards/${encodeURIComponent(id)}`, 24 * 3600 * 1000);
  detailMem.set(key, p);
  p.catch(() => detailMem.delete(key));
  return p;
}

// ---------- варианты и цены ----------
export const VARIANTS = {
  normal: 'Обычная',
  holo: 'Холо',
  reverse: 'Реверс-холо',
  firstEdition: '1-е издание',
};

// цена для варианта в нужной валюте; null если нет данных
export function priceFor(detail, variant, currency = 'USD') {
  const p = detail?.pricing;
  if (!p) return null;
  const tp = p.tcgplayer, cm = p.cardmarket;
  const tpKeys = {
    normal: ['normal', 'unlimited', 'unlimitedNormal'],
    holo: ['holofoil', 'unlimitedHolofoil', 'holo'],
    reverse: ['reverse-holofoil', 'reverseHolofoil'],
    firstEdition: ['1st-edition-holofoil', '1stEditionHolofoil', '1st-edition-normal', '1stEditionNormal', '1st-edition'],
  }[variant] || [];
  const fromTp = () => {
    if (!tp) return null;
    for (const k of tpKeys) {
      const v = tp[k];
      const val = v && (v.marketPrice ?? v.midPrice ?? v.lowPrice);
      if (val != null) return { value: val, currency: tp.unit || 'USD', src: 'TCGplayer' };
    }
    return null;
  };
  const fromCm = () => {
    if (!cm) return null;
    const holo = variant === 'holo' || variant === 'reverse';
    // 0 у Cardmarket значит «нет данных», а не бесплатную карту
    const val = holo ? (cm['trend-holo'] || cm['avg-holo']) : (cm.trend || cm.avg);
    const v = val || cm.trend || cm.avg;
    return v > 0 ? { value: v, currency: cm.unit || 'EUR', src: 'Cardmarket' } : null;
  };
  const order = currency === 'EUR' ? [fromCm, fromTp] : [fromTp, fromCm];
  for (const f of order) { const r = f(); if (r) return r; }
  return null;
}

export function variantsOf(detail) {
  const v = detail?.variants || { normal: true };
  const list = Object.keys(VARIANTS).filter((k) => v[k]);
  return list.length ? list : ['normal'];
}

export function bestVariant(detail, currency) {
  const list = variantsOf(detail);
  return list.find((v) => priceFor(detail, v, currency)) || list[0];
}

// Курс EUR→USD (ЕЦБ через frankfurter.dev), раз в сутки; без сети — примерный.
let fx = 1.12;
cached('fx-eur-usd', 'https://api.frankfurter.dev/v1/latest?from=EUR&to=USD', 24 * 3600 * 1000)
  .then((d) => { if (d?.rates?.USD) fx = d.rates.USD; }).catch(() => {});
// цена в нужной валюте (пересчёт по курсу, если источник в другой)
export function toCurrency(p, cur) {
  if (!p) return 0;
  if (p.currency === cur) return p.value;
  return cur === 'USD' ? p.value * fx : p.value / fx;
}

export function fmtPrice(p) {
  if (!p) return '—';
  const sym = p.currency === 'EUR' ? '€' : '$';
  return `${sym}${p.value.toFixed(2)}`;
}

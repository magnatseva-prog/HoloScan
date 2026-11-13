// Запечатанные товары (бустеры, ETB, коробки, тины): каталог в data/sealed.json
// (строит tools/build_sealed.py из tcgcsv.com), свежие цены TCGplayer — по сету, раз в сутки.
import { norm } from './api.js';

let catP;
export function sealedCatalog() {
  catP ??= fetch('data/sealed.json').then((r) => r.json()).then((d) => {
    const groups = new Map(d.groups.map(([id, name, date]) => [id, { id, name, date }]));
    const items = d.items.map(([pid, gid, name, price]) => ({
      pid, gid, name, n: norm(name), price, set: groups.get(gid)?.name || '', date: groups.get(gid)?.date || '',
    }));
    // новые сеты первыми
    items.sort((a, b) => b.date.localeCompare(a.date) || (b.price || 0) - (a.price || 0));
    return { groups, items, byPid: new Map(items.map((i) => [i.pid, i])) };
  });
  catP.catch(() => { catP = null; });
  return catP;
}

export const sealedImg = (pid, size = 200) => `https://tcgplayer-cdn.tcgplayer.com/product/${pid}_${size}w.jpg`;

// Тип товара по названию — для фильтра-чипов
const KINDS = [
  ['box', /\bcase\b/i], // кейс из нескольких ETB или боксов — оптовая коробка
  ['etb', /elite trainer box/i],
  ['box', /booster box|booster bundle|display/i],
  ['pack', /booster pack|sleeved booster|blister|\bpack\b/i],
  ['tin', /\btin\b/i],
  ['collection', /collection|premium|box\b/i],
];
export function kindOf(name) {
  return KINDS.find(([, re]) => re.test(name))?.[0] || 'other';
}

export function searchSealed(cat, q, kind, limit = 80) {
  const words = norm(q).split(' ').filter(Boolean);
  const out = [];
  for (const it of cat.items) {
    if (kind && kindOf(it.name) !== kind) continue;
    if (words.length && !words.every((w) => it.n.includes(w) || norm(it.set).includes(w))) continue;
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

// Свежие цены сета: Map(productId → marketPrice). В браузере без CORS не выйдет — тогда
// остаются цены из каталога. В приложении запрос идёт нативно (CapacitorHttp).
const cache = new Map();
export async function sealedPrices(gid, fresh = false) {
  const key = `sealed-${gid}`;
  if (!fresh && cache.has(key)) return cache.get(key);
  const p = (async () => {
    try {
      const r = await fetch(`https://tcgcsv.com/tcgplayer/3/${gid}/prices`);
      const d = await r.json();
      const m = new Map();
      for (const x of d.results || []) {
        const v = x.marketPrice || x.midPrice;
        if (v) m.set(x.productId, Math.max(m.get(x.productId) || 0, v));
      }
      return m;
    } catch {
      const cat = await sealedCatalog();
      return new Map(cat.items.filter((i) => i.gid === gid && i.price).map((i) => [i.pid, i.price]));
    }
  })();
  cache.set(key, p);
  return p;
}

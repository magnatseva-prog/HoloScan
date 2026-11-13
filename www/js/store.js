// Коллекция и настройки — в localStorage телефона.
const KEY = 'holoscan.collection.v1';
const SET_KEY = 'holoscan.settings.v1';

function read(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// uiLang — язык интерфейса, cardLang — язык карт (код TCGdex)
export const settings = Object.assign({ currency: 'USD', firstFind: false, uiLang: 'en', cardLang: 'en', autoCollect: true }, read(SET_KEY, {}));
const settingsListeners = new Set();
export const onSettings = (f) => settingsListeners.add(f);
export function saveSettings() { write(SET_KEY, settings); settingsListeners.forEach((f) => f()); }

let items = read(KEY, []);
const listeners = new Set();
export const onChange = (f) => listeners.add(f);
function commit() { write(KEY, items); listeners.forEach((f) => f()); }

export const all = () => items;

// Карта: {id, lang, name, localId, setName, image, variant, price:{value,currency}, photo, binder, hist}
// Запечатанный товар: {kind: 'sealed', id: 'tcg:<productId>', pid, gid, name, setName, image, price, binder}
// Возвращает uid записи — по нему скан потом можно исправить или отменить.
export function add(item) {
  let same = items.find((i) => i.id === item.id && i.lang === item.lang && i.variant === item.variant && (i.binder || null) === (item.binder || null));
  if (same) { same.qty += 1; same.price = item.price ?? same.price; }
  else {
    same = {
      ...item, qty: 1, uid: crypto.randomUUID?.() || String(Date.now() + Math.random()), addedAt: Date.now(),
      hist: item.price ? [[today(), item.price.value]] : [],
    };
    items.unshift(same);
  }
  commit();
  return same.uid;
}
// минус одна штука (отмена скана)
export function removeOne(uid) {
  const it = items.find((i) => i.uid === uid);
  if (it) setQty(uid, it.qty - 1);
}
export function setQty(uid, qty) {
  items = qty > 0 ? items.map((i) => (i.uid === uid ? { ...i, qty } : i)) : items.filter((i) => i.uid !== uid);
  commit();
}
const today = () => new Date().toISOString().slice(0, 10);

// Новая цена записи; история цены (по дню, до 90 точек) нужна для «лидеров роста».
export function updatePrice(uid, price) {
  const it = items.find((i) => i.uid === uid);
  if (!it || !price) return;
  it.price = price; it.priceAt = Date.now();
  const h = (it.hist ??= []), d = today();
  if (h.at(-1)?.[0] === d) h.at(-1)[1] = price.value;
  else h.push([d, price.value]);
  if (h.length > 90) h.splice(0, h.length - 90);
}
export const flush = commit;
export function setBinder(uid, binder) {
  const it = items.find((i) => i.uid === uid);
  if (it) { it.binder = binder || null; commit(); }
}
// Изменение цены записи за последние days дней (null — нет истории).
export function priceChange(it, days) {
  const h = it.hist;
  if (!h?.length || !it.price) return null;
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const base = [...h].reverse().find(([d]) => d <= since) || h[0];
  return base[0] === today() ? null : it.price.value - base[1];
}

// ---------- история стоимости коллекции: один снимок в день ----------
const HIST_KEY = 'holoscan.history.v1';
let history = read(HIST_KEY, []);
export const valueHistory = () => history;
export function snapshot() {
  const t = totals(), d = today();
  const row = { d, USD: +(t.USD || 0).toFixed(2), EUR: +(t.EUR || 0).toFixed(2) };
  if (history.at(-1)?.d === d) history[history.length - 1] = row;
  else history.push(row);
  if (history.length > 730) history.splice(0, history.length - 730);
  write(HIST_KEY, history);
}
export function importHistory(rows) {
  const by = new Map(history.map((r) => [r.d, r]));
  for (const r of rows || []) if (!by.has(r.d)) by.set(r.d, r);
  history = [...by.values()].sort((a, b) => a.d.localeCompare(b.d));
  write(HIST_KEY, history);
}

// ---------- список желаний ----------
// {id, lang, name, localId, image, setName, target: число|null, currency, lastPrice, alerted}
const WISH_KEY = 'holoscan.wish.v1';
let wish = read(WISH_KEY, []);
const commitWish = () => { write(WISH_KEY, wish); listeners.forEach((f) => f()); };
export const wishlist = () => wish;
export const inWish = (id, lang) => wish.some((w) => w.id === id && w.lang === lang);
export function toggleWish(card) {
  if (inWish(card.id, card.lang)) wish = wish.filter((w) => !(w.id === card.id && w.lang === card.lang));
  else wish.unshift({ ...card, target: null, alerted: false, addedAt: Date.now() });
  commitWish();
}
export function updateWish(id, lang, patch) {
  const w = wish.find((x) => x.id === id && x.lang === lang);
  if (w) { Object.assign(w, patch); commitWish(); }
}
export function importWish(list) {
  for (const w of list || []) if (!inWish(w.id, w.lang)) wish.push(w);
  commitWish();
}

// ---------- папки ----------
const BIND_KEY = 'holoscan.binders.v1';
let binders = read(BIND_KEY, []);
const commitBinders = () => { write(BIND_KEY, binders); listeners.forEach((f) => f()); };
export const allBinders = () => binders;
export const BINDER_COLORS = ['#3d9bff', '#35d07f', '#f5c84c', '#ff5a5f', '#b06bff', '#ff8a3d'];
export function addBinder(name) {
  const b = { id: crypto.randomUUID?.() || String(Date.now()), name, color: BINDER_COLORS[binders.length % BINDER_COLORS.length] };
  binders.push(b);
  commitBinders();
  return b;
}
export function renameBinder(id, name) {
  const b = binders.find((x) => x.id === id);
  if (b) { b.name = name; commitBinders(); }
}
export function removeBinder(id) {
  binders = binders.filter((b) => b.id !== id);
  for (const i of items) if (i.binder === id) i.binder = null;
  write(KEY, items);
  commitBinders();
}
export function importBinders(list) {
  for (const b of list || []) if (!binders.some((x) => x.id === b.id)) binders.push(b);
  commitBinders();
}
// запись из облака (синхронизация) — как есть, с её uid
export function importItem(item) {
  if (!items.some((i) => i.uid === item.uid)) items.push({ ...item });
}

export function totals() {
  const t = {};
  for (const i of items) {
    if (!i.price) continue;
    t[i.price.currency] = (t[i.price.currency] || 0) + i.price.value * i.qty;
  }
  return t;
}
export const qtyOf = (id, lang) => items.filter((i) => i.id === id && i.lang === lang).reduce((s, i) => s + i.qty, 0);

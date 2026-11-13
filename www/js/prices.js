// Ежедневное обновление цен коллекции и списка желаний, снимок стоимости для графика,
// оповещения о снижении цены. Запускается при открытии приложения (фоном, раз в ~20 часов).
import * as store from './store.js';
import { cardDetail, priceFor, bestVariant } from './api.js';
import { sealedPrices } from './sealed.js';
import { t } from './i18n.js';

const LAST_KEY = 'holoscan.pricesAt';
const EVERY = 20 * 3600 * 1000;

const Notify = () => (window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.LocalNotifications : null);

// по 4 запроса одновременно, чтобы не душить сеть
async function pool(list, fn, n = 4) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) await fn(list[i++]).catch(() => {}); }));
}

let running = null;
export function refreshAll({ force = false, onProgress } = {}) {
  if (running) return running;
  let last = 0;
  try { last = +localStorage.getItem(LAST_KEY) || 0; } catch {}
  if (!force && Date.now() - last < EVERY) { store.snapshot(); return Promise.resolve(false); }
  running = (async () => {
    const cur = store.settings.currency;
    const items = store.all();
    const cards = items.filter((i) => i.kind !== 'sealed');
    const sealed = items.filter((i) => i.kind === 'sealed');
    let done = 0;
    const tick = () => onProgress?.(++done, cards.length + sealed.length);
    await pool(cards, async (i) => {
      const d = await cardDetail(i.lang, i.id, true);
      const p = priceFor(d, i.variant, cur);
      if (p) store.updatePrice(i.uid, p);
      tick();
    });
    // цены запечатанных — одним запросом на сет
    const groups = [...new Set(sealed.map((i) => i.gid))];
    await pool(groups, async (gid) => {
      const prices = await sealedPrices(gid, true);
      for (const i of sealed.filter((x) => x.gid === gid)) {
        const v = prices.get(i.pid);
        if (v) store.updatePrice(i.uid, { value: v, currency: 'USD', src: 'TCGplayer' });
        tick();
      }
    });
    store.flush();
    store.snapshot();
    await checkWishlist();
    try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch {}
    return true;
  })().finally(() => { running = null; });
  return running;
}

// Цены списка желаний; если цена упала до цели — уведомление (один раз на снижение).
export async function checkWishlist() {
  const cur = store.settings.currency;
  const hits = [];
  await pool(store.wishlist(), async (w) => {
    const d = await cardDetail(w.lang, w.id, true);
    const p = priceFor(d, bestVariant(d, cur), cur);
    if (!p) return;
    const reached = w.target != null && p.value <= w.target;
    if (reached && !w.alerted) hits.push({ w, p });
    store.updateWish(w.id, w.lang, { lastPrice: p, alerted: reached ? true : false });
  });
  if (hits.length) await notify(hits);
  return hits;
}

async function notify(hits) {
  const n = Notify();
  const fmt = (p) => `${p.currency === 'EUR' ? '€' : '$'}${p.value.toFixed(2)}`;
  if (!n) return;
  try {
    const perm = await n.checkPermissions();
    if (perm.display !== 'granted') return;
    await n.schedule({
      notifications: hits.map(({ w, p }, k) => ({
        id: (Date.now() % 1e6) + k,
        title: t('wish.alertTitle', { name: w.name }),
        body: t('wish.alertBody', { price: fmt(p), target: fmt({ value: w.target, currency: p.currency }) }),
      })),
    });
  } catch (e) { console.warn('notify', e); }
}

// Фоновая проверка (www/runners/prices.js) живёт в отдельной среде — передаём ей
// список желаний и тексты уведомлений на языке приложения.
const Runner = () => (window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.BackgroundRunner : null);
let syncTimer;
export function syncBackground() {
  const r = Runner();
  if (!r) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const wish = store.wishlist().filter((w) => w.target != null).map(({ id, lang, name, target }) => ({ id, lang, name, target }));
    r.dispatchEvent({
      label: 'com.holoscan.prices', event: 'syncWish',
      details: {
        wish, currency: store.settings.currency,
        texts: { title: t('wish.alertTitle', { name: '{name}' }), body: t('wish.alertBody', { price: '{price}', target: '{target}' }) },
      },
    }).catch((e) => console.warn('runner sync', e));
  }, 1500);
}

// Разрешение на уведомления — спрашиваем, когда человек впервые ставит целевую цену.
export async function askNotifyPermission() {
  const n = Notify();
  if (!n) return false;
  try {
    const p = await n.checkPermissions();
    if (p.display === 'granted') return true;
    return (await n.requestPermissions()).display === 'granted';
  } catch { return false; }
}

// Фоновая проверка цен (Capacitor Background Runner): работает, даже когда приложение закрыто.
// Отдельная среда без DOM и localStorage: список желаний приложение передаёт событием
// syncWish и он хранится в CapacitorKV. Раз в несколько часов срабатывает checkPrices.
const API = 'https://api.tcgdex.net/v2';

function readJSON(key, def) {
  try { return JSON.parse(CapacitorKV.get(key).value) ?? def; } catch (e) { return def; }
}

// упрощённая priceFor из js/api.js: рынок TCGplayer, иначе тренд Cardmarket
function priceOf(d, currency) {
  const tp = d && d.pricing && d.pricing.tcgplayer, cm = d && d.pricing && d.pricing.cardmarket;
  const fromTp = () => {
    if (!tp) return null;
    for (const k of ['holofoil', 'normal', 'reverse-holofoil', '1st-edition-holofoil']) {
      const v = tp[k] && (tp[k].marketPrice || tp[k].midPrice);
      if (v) return { value: v, currency: 'USD' };
    }
    return null;
  };
  const fromCm = () => (cm && (cm.trend || cm.avg) ? { value: cm.trend || cm.avg, currency: 'EUR' } : null);
  return currency === 'EUR' ? fromCm() || fromTp() : fromTp() || fromCm();
}

addEventListener('syncWish', (resolve, reject, args) => {
  try {
    CapacitorKV.set('wish', JSON.stringify(args.wish || []));
    CapacitorKV.set('currency', args.currency || 'USD');
    CapacitorKV.set('texts', JSON.stringify(args.texts || {}));
    resolve();
  } catch (e) { reject(e); }
});

addEventListener('checkPrices', async (resolve, reject) => {
  try {
    const wish = readJSON('wish', []).filter((w) => w.target != null);
    const currency = CapacitorKV.get('currency').value || 'USD';
    const texts = readJSON('texts', {});
    const alerted = readJSON('alerted', {});
    const notes = [];
    for (const w of wish) {
      const key = `${w.lang}:${w.id}`;
      const r = await fetch(`${API}/${w.lang}/cards/${encodeURIComponent(w.id)}`);
      if (!r.ok) continue;
      const p = priceOf(await r.json(), currency);
      if (!p) continue;
      const reached = p.value <= w.target;
      if (reached && !alerted[key]) {
        const sym = p.currency === 'EUR' ? '€' : '$';
        notes.push({
          id: 7000 + notes.length,
          title: (texts.title || '{name} dropped in price!').replace('{name}', w.name),
          body: (texts.body || 'Now {price} — your target was {target}.').replace('{price}', `${sym}${p.value.toFixed(2)}`).replace('{target}', `${sym}${Number(w.target).toFixed(2)}`),
          scheduleAt: new Date(Date.now() + 1000),
        });
      }
      alerted[key] = reached; // снова сообщим, только если цена поднимется и опять упадёт
    }
    CapacitorKV.set('alerted', JSON.stringify(alerted));
    if (notes.length) CapacitorNotifications.schedule(notes);
    resolve();
  } catch (e) { reject(e); }
});

// График цены отдельной карты. Полной истории по дням у TCGdex нет, поэтому берём
// средние Cardmarket за 30, 7 и 1 день плюс текущий тренд, а если карта в коллекции —
// ещё и нашу собственную историю её цены (store: hist, по дню).
import { t } from './i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function line(pts, W, H, color) {
  const vals = pts.map((p) => p.v), min = Math.min(...vals), max = Math.max(...vals), span = max - min || max * 0.1 || 1;
  // поля по бокам — чтобы подписи у крайних точек не обрезались
  const xy = pts.map((p, i) => [38 + (i / Math.max(1, pts.length - 1)) * (W - 76), H - 22 - ((p.v - min) / span) * (H - 44)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
    ${xy.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}"/>
      <text x="${x}" y="${H - 6}" text-anchor="middle">${esc(pts[i].l)}</text>
      <text x="${x}" y="${y - 8}" text-anchor="middle" class="v">${esc(pts[i].s)}</text>`).join('')}`;
}

// detail — ответ TCGdex, variant — выбранный вариант, item — запись коллекции (для своей истории)
export function trendHtml(detail, variant, item) {
  const cm = detail?.pricing?.cardmarket;
  const h = variant === 'holo' || variant === 'reverse' ? '-holo' : '';
  const eur = (v) => `€${v.toFixed(2)}`;
  const pick = (k) => { const v = cm?.[`${k}${h}`] || cm?.[k]; return v > 0 ? v : null; }; // 0 — «нет данных»
  const pts = [['avg30', t('trend.d30')], ['avg7', t('trend.d7')], ['avg1', t('trend.d1')], ['trend', t('trend.now')]]
    .map(([k, l]) => ({ v: pick(k), l })).filter((p) => p.v != null).map((p) => ({ ...p, s: eur(p.v) }));
  const own = (item?.hist || []).slice(-30).map(([d, v]) => ({ v, l: d.slice(5).replace('-', '.'), s: '' }));
  if (own.length >= 2) { own[0].s = `$${own[0].v.toFixed(2)}`; own.at(-1).s = `$${own.at(-1).v.toFixed(2)}`; }
  if (pts.length < 2 && own.length < 2) return '';
  const W = 320, H = 120;
  let change = '';
  if (pts.length >= 2) {
    const d = pts.at(-1).v - pts[0].v, pct = (d / pts[0].v) * 100;
    change = `<span class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% ${t('trend.vs30')}</span>`;
  }
  return `<div class="sec trend-h">${t('trend.title')} ${change}</div>
    ${pts.length >= 2 ? `<svg class="trend" viewBox="0 0 ${W} ${H}">${line(pts, W, H, 'var(--blue)')}</svg><p class="note">${t('trend.note')}</p>` : ''}
    ${own.length >= 2 ? `<div class="sec">${t('trend.own')}</div><svg class="trend" viewBox="0 0 ${W} ${H}">${line(own.filter((_, i, a) => a.length <= 6 || i % Math.ceil(a.length / 6) === 0 || i === a.length - 1), W, H, 'var(--green)')}</svg>` : ''}`;
}

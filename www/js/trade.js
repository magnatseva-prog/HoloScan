// Калькулятор обмена: что отдаю, что получаю, честно ли по ценам.
// ctx (из app.js): idx, search, tilePrice, cur, openPanel-подобные функции views.
import * as store from './store.js';
import { imgUrl, toCurrency } from './api.js';
import { t } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sym = (c) => (c === 'EUR' ? '€' : '$');
// обмен честный, если разница не больше 10% от большей стороны (и не больше $1 для мелочи)
const FAIR = 0.1;

let ctx;
const sides = { give: [], get: [] }; // элементы: {key, name, sub, img, price: {value, currency}|null}

function total(side) {
  const cur = ctx.cur();
  return sides[side].reduce((s, x) => s + toCurrency(x.price, cur), 0); // разные валюты — по курсу
}

function render() {
  const cur = ctx.cur(), give = total('give'), get = total('get');
  const diff = get - give, big = Math.max(give, get);
  const verdict = !sides.give.length || !sides.get.length ? `<p class="note center">${t('trade.hint')}</p>`
    : Math.abs(diff) <= Math.max(1, big * FAIR)
      ? `<div class="verdict fair">⚖ ${t('trade.fair')}</div>`
      : diff > 0 ? `<div class="verdict up">▲ ${t('trade.gain', { v: `${sym(cur)}${diff.toFixed(2)}` })}</div>`
        : `<div class="verdict down">▼ ${t('trade.lose', { v: `${sym(cur)}${(-diff).toFixed(2)}` })}</div>`;
  const side = (k) => `<div class="tside"><div class="sec">${t(`trade.${k}`)} <b>${sym(cur)}${total(k).toFixed(2)}</b></div>
    ${sides[k].map((x, i) => `<div class="titem2"><img src="${x.img}" alt=""><div><b>${esc(x.name)}</b><small>${esc(x.sub)}</small></div>
      <em>${x.price ? `${sym(x.price.currency)}${x.price.value.toFixed(2)}` : '—'}</em><button data-rm="${k}:${i}" aria-label="×">×</button></div>`).join('')}
    <button class="btn ghost wide" data-add="${k}">${t('trade.add')}</button></div>`;
  $('#panel-body').innerHTML = `${side('give')}${side('get')}<div class="tsum">${verdict}</div>
    ${sides.give.length || sides.get.length ? `<button class="btn ghost wide" id="t-clear">${t('trade.clear')}</button>` : ''}`;
  $('#panel-body').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => {
    const [k, i] = b.dataset.rm.split(':');
    sides[k].splice(+i, 1);
    render();
  }));
  $('#panel-body').querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => picker(b.dataset.add)));
  $('#t-clear')?.addEventListener('click', () => { sides.give = []; sides.get = []; render(); });
}

// Выбор карты: для «отдаю» сначала моя коллекция, поиск — по всему каталогу.
function picker(side) {
  const m = $('#modal');
  $('#modal-box').innerHTML = `<h3>${t(`trade.${side}`)}</h3>
    <input id="t-q" class="m-input" type="search" placeholder="${t('search.ph')}" autocomplete="off">
    <div class="tpick" id="t-res"></div>`;
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m) m.hidden = true; };
  const put = (x) => { sides[side].push(x); m.hidden = true; render(); };
  const show = async () => {
    const q = $('#t-q').value.trim();
    const mine = store.all().filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
    let cards = [];
    if (q.length >= 2) cards = ctx.search(await ctx.idx(), q, 30);
    const rows = [
      ...(side === 'give' || !q ? mine.map((i) => ({ mine: true, i })) : []),
      ...cards.map((c) => ({ c })),
    ];
    $('#t-res').innerHTML = rows.length ? rows.map((r, k) => {
      const name = r.i ? r.i.name : r.c.name, img = r.i ? (r.i.kind === 'sealed' ? r.i.image : imgUrl(r.i)) : imgUrl(r.c);
      const sub = r.i ? `${t('trade.mine')} · ${r.i.setName || ''}` : `#${r.c.localId} · ${r.c.lang.toUpperCase()}`;
      return `<button data-k="${k}"><img src="${img}" alt=""><span><b>${esc(name)}</b><small>${esc(sub)}</small></span></button>`;
    }).join('') : `<p class="note">${t('cat.none')}</p>`;
    $('#t-res').querySelectorAll('[data-k]').forEach((b) => (b.onclick = async () => {
      const r = rows[+b.dataset.k];
      if (r.i) return put({ name: r.i.name, sub: r.i.setName || '', img: r.i.kind === 'sealed' ? r.i.image : imgUrl(r.i), price: r.i.price });
      b.disabled = true;
      const p = await ctx.tilePrice(r.c);
      put({ name: r.c.name, sub: `#${r.c.localId} · ${r.c.lang.toUpperCase()}`, img: imgUrl(r.c), price: p });
    }));
  };
  let tm;
  $('#t-q').oninput = () => { clearTimeout(tm); tm = setTimeout(show, 250); };
  show();
  $('#t-q').focus();
}

export function openTrade(c) {
  ctx = c;
  c.openPanel(t('trade.title'), '', render);
}

// Экраны коллекции (график, лидеры роста, папки, желания) и каталога (сеты, запечатанные).
// app.js передаёт сюда общие функции через ctx: openCard, toast, idx, cur, renderGrid, tilePrice.
import * as store from './store.js';
import { setOf, imgUrl, fmtPrice } from './api.js';
import { t, plural } from './i18n.js';
import { sealedCatalog, sealedImg, searchSealed, kindOf, sealedPrices } from './sealed.js';
import { refreshAll, checkWishlist, askNotifyPermission, syncBackground } from './prices.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sym = (c) => (c === 'EUR' ? '€' : '$');
const money = (v, c) => `${v < 0 ? '−' : ''}${sym(c)}${Math.abs(v).toFixed(2)}`;
let ctx;

// миниатюра записи коллекции: у запечатанного товара — прямой адрес картинки
export const thumbOf = (i) => (i.kind === 'sealed' ? i.image : imgUrl(i));

// ---------- сегменты (вкладки внутри экрана) ----------
function segments(id, onPick) {
  const bar = $(`#${id}`);
  bar.onclick = (e) => {
    const b = e.target.closest('[data-seg]');
    if (!b) return;
    bar.querySelectorAll('[data-seg]').forEach((x) => x.classList.toggle('sel', x === b));
    const panes = bar.parentElement.querySelectorAll(':scope > .segpane');
    panes.forEach((p) => (p.hidden = !p.id.endsWith(`-${b.dataset.seg}`)));
    onPick(b.dataset.seg);
  };
}
const segOf = (id) => $(`#${id} .sel`)?.dataset.seg;

// ---------- маленькое окно ----------
function modal(html, bind) {
  const m = $('#modal');
  $('#modal-box').innerHTML = html;
  m.hidden = false;
  const close = () => (m.hidden = true);
  m.onclick = (e) => { if (e.target === m) close(); };
  bind?.(close);
  return close;
}
export const modalOpen = () => !$('#modal').hidden;
export const closeModal = () => ($('#modal').hidden = true);

function askText(title, value = '', placeholder = '') {
  return new Promise((res) => {
    modal(`<h3>${esc(title)}</h3><input id="m-in" class="m-input" value="${esc(value)}" placeholder="${esc(placeholder)}">
      <div class="row end"><button class="btn ghost" id="m-no">${t('modal.cancel')}</button><button class="btn" id="m-ok">${t('modal.save')}</button></div>`, (close) => {
      const inp = $('#m-in');
      inp.focus();
      const done = (v) => { close(); res(v); };
      $('#m-no').onclick = () => done(null);
      $('#m-ok').onclick = () => done(inp.value.trim() || null);
      inp.onkeydown = (e) => { if (e.key === 'Enter') $('#m-ok').click(); };
    });
  });
}
function confirmAsk(text) {
  return new Promise((res) => {
    modal(`<p>${esc(text)}</p><div class="row end"><button class="btn ghost" id="m-no">${t('modal.cancel')}</button><button class="btn danger" id="m-ok">${t('modal.ok')}</button></div>`, (close) => {
      $('#m-no').onclick = () => { close(); res(false); };
      $('#m-ok').onclick = () => { close(); res(true); };
    });
  });
}

// Выбор папки для записи коллекции
export function pickBinder(item) {
  const list = store.allBinders();
  modal(`<h3>${t('binders.move')}</h3>
    <div class="picklist">
      <button data-b="" class="${!item.binder ? 'sel' : ''}"><i style="background:var(--line)"></i>${t('binders.none')}</button>
      ${list.map((b) => `<button data-b="${b.id}" class="${item.binder === b.id ? 'sel' : ''}"><i style="background:${b.color}"></i>${esc(b.name)}</button>`).join('')}
      <button data-new="1" class="new">${t('binders.new')}</button>
    </div>`, (close) => {
    $('#modal-box').querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => {
      store.setBinder(item.uid, b.dataset.b);
      close();
      const name = store.allBinders().find((x) => x.id === b.dataset.b)?.name || t('binders.none');
      ctx.toast(t('binders.moved', { name }));
    }));
    $('#modal-box [data-new]').onclick = async () => {
      close();
      const name = await askText(t('binders.name'));
      if (!name) return;
      const b = store.addBinder(name);
      store.setBinder(item.uid, b.id);
      ctx.toast(t('binders.moved', { name }));
    };
  });
}

// ---------- коллекция ----------
let range = 30;
export function renderPortfolio() {
  const cur = ctx.cur();
  const items = store.all();
  const tot = store.totals();
  $('#worth').textContent = money(tot[cur] || 0, cur);
  const count = items.reduce((s, i) => s + i.qty, 0);
  const other = cur === 'USD' ? 'EUR' : 'USD';
  $('#worth-sub').textContent = plural(count) + (tot[other] ? t('coll.other', { v: money(tot[other], other), c: other }) : '');
  $('#refresh').hidden = !items.length;
  renderChart();
  const seg = segOf('coll-seg');
  if (seg === 'all') renderAll();
  else if (seg === 'binders') renderBinders();
  else renderWish();
}

function renderChart() {
  const cur = ctx.cur();
  const all = store.valueHistory();
  const since = range ? new Date(Date.now() - range * 864e5).toISOString().slice(0, 10) : '';
  const pts = all.filter((r) => r.d >= since).map((r) => r[cur] || 0);
  $('#ranges').innerHTML = [[7, '7D'], [30, '30D'], [90, '90D'], [0, t('chart.all')]]
    .map(([d, l]) => `<button data-r="${d}" class="${d === range ? 'sel' : ''}">${l}</button>`).join('');
  $('#ranges').querySelectorAll('button').forEach((b) => (b.onclick = () => { range = +b.dataset.r; renderChart(); }));
  const ch = $('#worth-change');
  if (pts.length < 2) {
    ch.textContent = '';
    $('#chart').innerHTML = `<div class="chart-soon">${t('chart.soon')}</div>`;
    return;
  }
  const first = pts[0], last = pts.at(-1), diff = last - first;
  const pct = first ? (diff / first) * 100 : 0;
  ch.className = `worth-change ${diff > 0.004 ? 'up' : diff < -0.004 ? 'down' : ''}`;
  ch.textContent = `${diff >= 0 ? '+' : ''}${money(diff, cur)} (${diff >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
  const W = 300, H = 80, min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * W, H - 6 - ((v - min) / span) * (H - 12)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const color = diff < -0.004 ? 'var(--red)' : 'var(--green)';
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line}L${W},${H}L0,${H}Z" fill="url(#cg)"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <circle cx="${xy.at(-1)[0]}" cy="${xy.at(-1)[1]}" r="3" fill="${color}"/></svg>`;
}

function row(i, { binderBtn = true } = {}) {
  const r = document.createElement('div');
  r.className = 'prow';
  const ch = store.priceChange(i, 7);
  const chTxt = ch && Math.abs(ch) >= 0.01 ? `<small class="${ch > 0 ? 'up' : 'down'}">${ch > 0 ? '▲' : '▼'} ${money(Math.abs(ch), i.price.currency)}</small>` : '';
  const b = i.binder && store.allBinders().find((x) => x.id === i.binder);
  const meta = i.kind === 'sealed'
    ? `<span class="lang">sealed</span> ${esc(i.setName)}`
    : `<span class="lang">${i.lang}</span> ${esc(i.setName)} · ${t(`var.${i.variant}`)}`;
  r.innerHTML = `<img src="${thumbOf(i)}" alt=""><button class="info"><div class="nm">${esc(i.name)}${i.localId ? ` #${esc(i.localId)}` : ''}</div>
      <div class="meta">${b ? `<i class="dot" style="background:${b.color}"></i>` : ''}${meta}</div></button>
    <div class="right"><div class="pr">${fmtPrice(i.price)}</div>${chTxt}
      <div class="qty">${binderBtn ? `<button class="bind" aria-label="${t('binders.move')}">⌂</button>` : ''}<button data-d="-1">−</button><span>${i.qty}</span><button data-d="1">+</button></div></div>`;
  r.querySelectorAll('[data-d]').forEach((x) => (x.onclick = () => { store.setQty(i.uid, i.qty + +x.dataset.d); renderPortfolio(); }));
  r.querySelector('.bind')?.addEventListener('click', () => pickBinder(i));
  r.querySelector('.info').onclick = () => (i.kind === 'sealed' ? openSealed(i.pid) : ctx.openItem(i));
  return r;
}

function renderAll() {
  const items = store.all();
  $('#pempty').hidden = items.length > 0;
  // лидеры роста и падения за 7 дней (по сумме с учётом количества)
  const moves = items.map((i) => ({ i, d: (store.priceChange(i, 7) || 0) * i.qty })).filter((m) => Math.abs(m.d) >= 0.01);
  const up = moves.filter((m) => m.d > 0).sort((a, b) => b.d - a.d).slice(0, 3);
  const down = moves.filter((m) => m.d < 0).sort((a, b) => a.d - b.d).slice(0, 3);
  $('#movers').innerHTML = up.length || down.length
    ? `<div class="sec">${t('movers.title')}</div><div class="movers">${[...up, ...down].map(({ i, d }) =>
      `<button data-u="${i.uid}" class="mover"><img src="${thumbOf(i)}" alt=""><span>${esc(i.name)}</span><b class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${money(d, i.price.currency)}</b></button>`).join('')}</div>`
    : '';
  $('#movers').querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => {
    const i = store.all().find((x) => x.uid === b.dataset.u);
    if (i) (i.kind === 'sealed' ? openSealed(i.pid) : ctx.openItem(i));
  }));
  $('#plist').replaceChildren(...items.map((i) => row(i)));
}

function renderBinders() {
  const el = $('#coll-binders');
  const list = store.allBinders();
  const items = store.all();
  const cur = ctx.cur();
  const stats = (id) => {
    const its = items.filter((i) => i.binder === id);
    return { n: its.reduce((s, i) => s + i.qty, 0), v: its.filter((i) => i.price?.currency === cur).reduce((s, i) => s + i.price.value * i.qty, 0) };
  };
  el.innerHTML = `${list.length ? '' : `<p class="note center">${t('binders.empty')}</p>`}
    <div class="binders">${list.map((b) => { const s = stats(b.id); return `<button class="binder" data-b="${b.id}" style="--c:${b.color}"><b>${esc(b.name)}</b><span>${t('binders.cards', { n: s.n })}</span><em>${money(s.v, cur)}</em></button>`; }).join('')}
    <button class="binder new" id="b-new">${t('binders.new')}</button></div>`;
  $('#b-new').onclick = async () => {
    const name = await askText(t('binders.name'));
    if (name) { store.addBinder(name); renderBinders(); }
  };
  el.querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => openBinder(b.dataset.b)));
}

function openBinder(id) {
  const b = store.allBinders().find((x) => x.id === id);
  if (!b) return;
  openPanel(b.name, `<button class="pill" id="b-menu">⋯</button>`, (body) => {
    const its = store.all().filter((i) => i.binder === id);
    body.innerHTML = its.length ? '' : `<p class="note center">${t('binders.emptyOne')}</p>`;
    const list = document.createElement('div');
    list.className = 'plist';
    list.replaceChildren(...its.map((i) => row(i)));
    body.append(list);
  });
  $('#b-menu').onclick = () => modal(`<div class="picklist">
      <button id="b-ren">${t('binders.rename')}</button><button id="b-del" class="danger">${t('binders.delete')}</button></div>`, (close) => {
    $('#b-ren').onclick = async () => {
      close();
      const name = await askText(t('binders.rename'), b.name);
      if (name) { store.renameBinder(id, name); openBinder(id); }
    };
    $('#b-del').onclick = async () => {
      close();
      if (await confirmAsk(t('binders.deleteAsk', { name: b.name }))) { store.removeBinder(id); closePanel(); renderPortfolio(); }
    };
  });
}

function renderWish() {
  const el = $('#coll-wish');
  const list = store.wishlist();
  if (!list.length) { el.innerHTML = `<p class="note center">${t('wish.empty')}</p>`; return; }
  el.innerHTML = `<div class="plist">${list.map((w, k) => `
    <div class="prow wish" data-k="${k}">
      <img src="${imgUrl(w)}" alt="">
      <button class="info"><div class="nm">${esc(w.name)} #${esc(w.localId)}</div><div class="meta"><span class="lang">${w.lang}</span> ${esc(w.setName || '')}</div>
        ${w.alerted ? `<div class="meta up">✓ ${t('wish.reached')}</div>` : ''}</button>
      <div class="right"><div class="pr">${fmtPrice(w.lastPrice)}</div>
        <label class="target">🔔<input type="number" inputmode="decimal" step="0.01" min="0" placeholder="${t('wish.target')}" value="${w.target ?? ''}"></label>
        <button class="heart on" aria-label="${t('wish.remove')}">♥</button></div>
    </div>`).join('')}</div>
    <p class="note center">${t('wish.notifyNote')}</p><button class="btn ghost wide" id="w-check">${t('wish.check')}</button>`;
  el.querySelectorAll('.wish').forEach((r) => {
    const w = list[+r.dataset.k];
    r.querySelector('.info').onclick = () => ctx.openItem(w);
    r.querySelector('.heart').onclick = () => { store.toggleWish(w); renderWish(); };
    r.querySelector('input').onchange = async (e) => {
      const v = parseFloat(e.target.value);
      store.updateWish(w.id, w.lang, { target: Number.isFinite(v) && v > 0 ? v : null, alerted: false });
      if (Number.isFinite(v)) await askNotifyPermission();
    };
  });
  $('#w-check').onclick = async (e) => {
    e.currentTarget.disabled = true;
    const hits = await checkWishlist();
    renderWish();
    if (hits.length) ctx.toast(t('wish.alertTitle', { name: hits[0].w.name }), 3000);
  };
}

// ---------- общая панель (сет, товар, папка) ----------
export function openPanel(title, act, fill) {
  $('#panel').hidden = false;
  $('#panel-title').textContent = title;
  $('#panel-act').innerHTML = act || '';
  $('#panel-body').scrollTop = 0;
  fill($('#panel-body'));
}
export function closePanel() { $('#panel').hidden = true; renderPortfolio(); }
export const panelOpen = () => !$('#panel').hidden;

// ---------- сеты ----------
const setIdOf = (cardId) => cardId.slice(0, cardId.lastIndexOf('-'));
function ownedIds() {
  return new Set(store.all().filter((i) => i.kind !== 'sealed').map((i) => i.id));
}
export async function renderSets() {
  const index = await ctx.idx();
  const lang = index.langs[0];
  const owned = ownedIds();
  const count = new Map();
  for (const id of owned) count.set(setIdOf(id), (count.get(setIdOf(id)) || 0) + 1);
  const setsOf = (l) => [...index.sets.entries()].filter(([k]) => k.startsWith(`${l}:`)).map(([, s]) => s);
  let sets = setsOf(lang);
  if (!sets.length) sets = setsOf('en');
  sets = sets.filter((s) => (s.cardCount?.total || 0) > 0).reverse(); // новые первыми
  const q = ($('#sq').value || '').toLowerCase();
  if (q) sets = sets.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  // сначала сеты, где уже что-то собрано
  sets.sort((a, b) => (count.get(b.id) ? 1 : 0) - (count.get(a.id) ? 1 : 0));
  $('#setlist').innerHTML = sets.slice(0, 250).map((s) => {
    const n = count.get(s.id) || 0, total = s.cardCount.total || s.cardCount.official; // мастер-сет: вместе с секретными
    const pct = Math.min(100, Math.round((n / total) * 100));
    return `<button class="setrow" data-s="${s.id}">
      <div class="setlogo">${s.logo ? `<img src="${s.logo}.webp" loading="lazy" alt="" onerror="this.remove()">` : ''}</div>
      <div class="setinfo"><b>${esc(s.name)}</b><span>${t('sets.owned', { n, total })}</span><div class="bar"><i style="width:${pct}%"></i></div></div>
      <em>${pct}%</em></button>`;
  }).join('');
  $('#setlist').querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => openSet(b.dataset.s)));
}

async function openSet(setId) {
  const index = await ctx.idx();
  const lang = index.langs[0];
  const L = index.sets.has(`${lang}:${setId}`) ? lang : 'en';
  const s = index.sets.get(`${L}:${setId}`);
  const cards = index.cards.filter((c) => c.lang === L && setIdOf(c.id) === setId);
  cards.sort((a, b) => (parseInt(a.localId, 10) || 0) - (parseInt(b.localId, 10) || 0) || a.localId.localeCompare(b.localId));
  let filter = 'all';
  openPanel(s?.name || setId, '', (body) => {
    const owned = ownedIds();
    const have = cards.filter((c) => owned.has(c.id));
    const total = cards.length || s?.cardCount?.total;
    body.innerHTML = `
      <div class="sethead">${s?.logo ? `<img src="${s.logo}.webp" alt="" onerror="this.remove()">` : ''}
        <div class="bar big"><i style="width:${Math.min(100, (have.length / total) * 100)}%"></i></div>
        <p>${t('sets.owned', { n: have.length, total })} · ${t('sets.missing', { n: Math.max(0, cards.length - have.length) })}</p>
        <p class="note" id="set-cost">${t('sets.counting')}</p></div>
      <div class="seg small" id="set-seg"><button data-f="all" class="sel">${t('sets.fAll')}</button><button data-f="owned">${t('sets.fOwned')}</button><button data-f="missing">${t('sets.fMissing')}</button></div>
      <div class="grid" id="set-grid"></div>`;
    const draw = () => {
      const list = filter === 'all' ? cards : cards.filter((c) => owned.has(c.id) === (filter === 'owned'));
      ctx.renderGrid($('#set-grid'), list).then(() => {
        $('#set-grid').querySelectorAll('.tile').forEach((el) => el.classList.toggle('missing', !owned.has(el._card.id)));
      });
    };
    $('#set-seg').onclick = (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      filter = b.dataset.f;
      $('#set-seg').querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
      draw();
    };
    draw();
    // сколько стоит добрать сет: цены недостающих карт подгружаются постепенно
    const missing = cards.filter((c) => !owned.has(c.id));
    let sum = 0, got = 0, cur = ctx.cur();
    Promise.all(missing.map((c) => ctx.tilePrice(c).then((p) => {
      got++;
      if (p && p.currency === cur) sum += p.value;
      const el = $('#set-cost');
      if (el) el.textContent = got < missing.length ? `${t('sets.complete', { p: money(sum, cur) })} …` : t('sets.complete', { p: money(sum, cur) });
    })));
    if (!missing.length) $('#set-cost').textContent = t('sets.done');
  });
}

// ---------- запечатанные ----------
let sealKind = '';
export async function renderSealed() {
  const cat = await sealedCatalog().catch(() => null);
  if (!cat) return;
  const kinds = ['', 'etb', 'box', 'pack', 'tin', 'collection'];
  $('#sealkinds').innerHTML = kinds.map((k) => `<button data-k="${k}" class="chip ${k === sealKind ? 'sel' : ''}">${t(`sealed.k.${k || 'all'}`)}</button>`).join('');
  $('#sealkinds').querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { sealKind = b.dataset.k; renderSealed(); }));
  const list = searchSealed(cat, $('#sealq').value || '', sealKind);
  const owned = new Map(store.all().filter((i) => i.kind === 'sealed').map((i) => [i.pid, i.qty]));
  $('#sealgrid').innerHTML = list.map((it) => `
    <button class="tile sealed" data-p="${it.pid}">
      <img loading="lazy" src="${sealedImg(it.pid)}" alt="">
      <div class="nm">${esc(it.name)}</div><div class="meta">${esc(it.set)}</div>
      <div class="pr">${it.price ? `$${it.price.toFixed(2)}` : '—'}</div>${owned.get(it.pid) ? `<div class="owned">${t('scan.incoll')} ${owned.get(it.pid)}</div>` : ''}
    </button>`).join('');
  $('#sealgrid').querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => openSealed(+b.dataset.p)));
}

export async function openSealed(pid) {
  const cat = await sealedCatalog();
  const it = cat.byPid.get(pid);
  if (!it) return;
  openPanel(t('seg.sealed'), '', (body) => {
    const qty = store.all().filter((i) => i.kind === 'sealed' && i.pid === pid).reduce((s, i) => s + i.qty, 0);
    body.innerHTML = `<img class="hero sealedhero" src="${sealedImg(pid, 400)}" alt="">
      <div class="title-row"><h2>${esc(it.name)}</h2><div class="pr" id="s-price">${it.price ? `$${it.price.toFixed(2)}` : '—'}</div></div>
      <div class="chips"><span class="chip">${esc(it.set)}</span><span class="chip">${t(`sealed.k.${kindOf(it.name)}`)}</span></div>
      <p class="note">${t('sealed.price')}</p>
      <div class="actions"><button class="btn" id="s-add">${t('sealed.add')}</button><button class="btn ghost" disabled>${t('sheet.qty', { n: qty })}</button></div>`;
    let price = it.price;
    sealedPrices(it.gid).then((m) => {
      const v = m.get(pid);
      if (v) { price = v; const el = $('#s-price'); if (el) el.textContent = `$${v.toFixed(2)}`; }
    });
    $('#s-add').onclick = () => {
      store.add({
        kind: 'sealed', id: `tcg:${pid}`, lang: 'en', variant: 'sealed', pid, gid: it.gid, name: it.name, setName: it.set,
        image: sealedImg(pid), price: price ? { value: price, currency: 'USD', src: 'TCGplayer' } : null,
      });
      store.snapshot();
      ctx.toast(t('sealed.added', { name: it.name }));
      openSealed(pid);
    };
  });
}

// ---------- обновление цен (кнопка и автоматически раз в сутки) ----------
async function refresh(force) {
  const b = $('#refresh');
  b.disabled = true;
  await refreshAll({ force, onProgress: (n, total) => (b.textContent = t('coll.refreshingN', { n, total })) });
  b.disabled = false;
  b.textContent = t('coll.refresh');
  renderPortfolio();
  if (force) ctx.toast(t('coll.refreshed'));
}

export function initViews(c) {
  ctx = c;
  segments('coll-seg', () => renderPortfolio());
  segments('cat-seg', (s) => { if (s === 'sets') renderSets(); if (s === 'sealed') renderSealed(); if (s === 'packs') ctx.renderPacks?.(); });
  $('#panel-close').onclick = closePanel;
  let tq, ts;
  $('#sq').oninput = () => { clearTimeout(tq); tq = setTimeout(renderSets, 250); };
  $('#sealq').oninput = () => { clearTimeout(ts); ts = setTimeout(renderSealed, 250); };
  $('#refresh').onclick = () => refresh(true);
  // коллекция поменялась — обновим снимок стоимости за сегодня
  store.onChange(() => { store.snapshot(); syncBackground(); });
  store.onSettings(syncBackground);
  syncBackground();
  setTimeout(() => refresh(false), 4000); // фоном, когда всё остальное уже загрузилось
}

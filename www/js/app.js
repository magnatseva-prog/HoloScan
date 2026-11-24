import { loadIndex, loadScanIndex, norm, setOf, imgUrl, cardDetail, priceFor, variantsOf, bestVariant, fmtPrice, CARD_LANGS, LANG_KEYS } from './api.js';
import { recognize, warmUp, warmIndex } from './recognize.js';
import { warmEmbed } from './embed.js';
import * as store from './store.js';
import { t, setLang, plural, dateLocale, UI_LANGS } from './i18n.js';
import * as sync from './sync.js';
import * as tutorial from './tutorial.js';
import * as views from './views.js';
import { createAutoScan } from './autoscan.js';
import { trendHtml } from './trend.js';
import { openTrade } from './trade.js';
import { gradeCard } from './grade.js';
import { initGradeView, renderGradeView, showGrade } from './gradeview.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cur = () => store.settings.currency;
const st = store.settings;

// ---------- тема: как в системе / светлая / тёмная ----------
st.theme ??= 'auto';
const darkMq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = st.theme === 'dark' || (st.theme === 'auto' && darkMq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#15120e' : '#f4efe4');
}
darkMq.addEventListener?.('change', applyTheme);
applyTheme();

// язык карт «auto» из прошлых версий больше не бывает
if (!CARD_LANGS[st.cardLang]) st.cardLang = 'en';
st.uiLang ??= 'en';
setLang(st.uiLang);
const idx = () => loadIndex(st.cardLang);
// для сканов и экрана карты — все языки (карта могла быть японской при английских настройках)
const sidx = () => loadScanIndex(st.cardLang);

function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), ms);
}

// ---------- навигация ----------
function go(where) {
  if (where === 'scan') return openScanner('scan');
  if (where === 'trade') return openTrade({ idx, search, tilePrice, cur, openPanel: views.openPanel });
  closeScanner();
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `v-${where}`));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.go === where));
  if (where === 'portfolio') renderPortfolio();
  if (where === 'grade') renderGradeView();
  scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b) go(b.dataset.go);
});

// ---------- настройки ----------
function renderSettings() {
  const opt = (key, val, label) => `<button data-k="${key}" data-v="${val}" class="${String(st[key]) === String(val) ? 'sel' : ''}">${label}</button>`;
  const u = sync.currentUser();
  const account = u
    ? `<div class="account"><img src="${esc(u.photo)}" alt="" onerror="this.style.visibility='hidden'"><div><b>${esc(u.name || u.email)}</b><small>${esc(u.email)}</small><small class="ok">✓ ${t('acc.synced')}</small></div></div>
       <button class="btn ghost" id="acc-out">${t('acc.signout')}</button>`
    : `<p class="note">${t('acc.note')}</p><button class="btn google" id="acc-in"><span class="g">G</span>${t('acc.signin')}</button>`;
  $('#settings-body').innerHTML = `
    <div class="sec">${t('acc.title')}</div>${account}
    <div class="sec">${t('set.appLang')}</div>
    <div class="variants">${Object.entries(UI_LANGS).map(([k, v]) => opt('uiLang', k, v)).join('')}</div>
    <div class="sec">${t('set.cardLang')}</div>
    <div class="variants">${LANG_KEYS.map((k) => opt('cardLang', k, CARD_LANGS[k])).join('')}</div>
    <p class="note">${t('set.cardLangNote')}</p>
    <div class="sec">${t('set.theme')}</div>
    <div class="variants">${opt('theme', 'auto', t('theme.auto'))}${opt('theme', 'light', t('theme.light'))}${opt('theme', 'dark', t('theme.dark'))}</div>
    <div class="sec">${t('set.currency')}</div>
    <div class="variants">${opt('currency', 'USD', '$ USD · TCGplayer')}${opt('currency', 'EUR', '€ EUR · Cardmarket')}</div>
    <div class="sec">${t('set.auto')}</div>
    <div class="variants">${opt('autoCollect', true, t('set.yes'))}${opt('autoCollect', false, t('set.no'))}</div>
    <p class="note">${t('set.autoNote')}</p>
    <button class="btn ghost wide" id="set-tutorial">${t('set.tutorial')}</button>`;
  $('#set-tutorial').onclick = () => { $('#settings').hidden = true; openTutorial(); };
  $('#acc-in')?.addEventListener('click', async (e) => {
    if (!sync.available()) return toast(t('acc.web'), 3000);
    e.currentTarget.disabled = true;
    try { await sync.signIn(); } catch (err) { console.error(err); toast(t('acc.fail'), 3000); }
    renderSettings();
  });
  $('#acc-out')?.addEventListener('click', async () => { await sync.signOut(); renderSettings(); });
  $('#settings-body').querySelectorAll('button[data-k]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.k, v = b.dataset.v;
    st[k] = v === 'true' ? true : v === 'false' ? false : v;
    store.saveSettings();
    if (k === 'uiLang') { setLang(v); refreshAll(); }
    if (k === 'cardLang') { warmUp(v); initCatalog(); }
    if (k === 'theme') applyTheme();
    if (k === 'currency') { priceCache.clear(); renderGrid($('#grid'), lastResults); renderPortfolio(); }
    renderSettings();
  }));
}
$('#settings-btn').onclick = () => { renderSettings(); $('#settings').hidden = false; };
$('#settings-close').onclick = () => ($('#settings').hidden = true);

// смена языка интерфейса — перерисовываем всё, что строится из кода
function refreshAll() {
  $('#cat-status').textContent = $('#q').value.trim() ? '' : t('cat.popular');
  renderGrid($('#grid'), lastResults);
  renderPortfolio();
  renderTray();
}

// ---------- плитки с ленивой подгрузкой цен ----------
const priceCache = new Map();
async function tilePrice(card) {
  const key = `${card.lang}:${card.id}`;
  if (!priceCache.has(key)) {
    priceCache.set(key, cardDetail(card.lang, card.id).then((d) => priceFor(d, bestVariant(d, cur()), cur())).catch(() => null));
  }
  return priceCache.get(key);
}
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    tilePrice(e.target._card).then((p) => { e.target.querySelector('.pr').textContent = fmtPrice(p); });
  }
}, { rootMargin: '200px' });

function tile(card, index, onPick) {
  const s = setOf(index, card);
  const b = document.createElement('button');
  b.className = 'tile';
  const owned = store.qtyOf(card.id, card.lang);
  b.innerHTML = `<img loading="lazy" src="${imgUrl(card)}" alt="">
    <div class="nm">${esc(card.name)}</div>
    <div class="meta">#${esc(card.localId)} · <span class="lang">${card.lang}</span> ${esc(s?.name || '')}</div>
    <div class="pr">…</div>${owned ? `<div class="owned">${t('scan.incoll')} ${owned}</div>` : ''}`;
  b._card = card;
  b.onclick = () => onPick(card);
  io.observe(b);
  return b;
}

let lastResults = [];
async function renderGrid(el, cards, onPick = (c) => openCard({ card: c })) {
  const index = await idx();
  el.replaceChildren(...cards.map((c) => tile(c, index, onPick)));
}

// Карты выбранного языка показываем первыми, английские — после.
function search(index, q, limit = 60) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const nums = words.filter((w) => /^\d+$/.test(w)).map(Number);
  const text = words.filter((w) => !/^\d+$/.test(w)).join(' ');
  const out = [];
  for (let i = index.cards.length - 1; i >= 0 && out.length < 400; i--) {
    const c = index.cards[i];
    if (text && !c.n.includes(text)) continue;
    if (nums.length && !nums.includes(parseInt(c.localId, 10))) continue;
    if (!c.image) continue;
    out.push(c);
  }
  const mine = (c) => (c.lang === st.cardLang ? 1 : 0);
  out.sort((a, b) => mine(b) - mine(a) || (b.n.startsWith(text) - a.n.startsWith(text)) || (b.n === text) - (a.n === text));
  return out.slice(0, limit);
}

// ---------- каталог ----------
let catalogGen = 0;
async function initCatalog() {
  const gen = ++catalogGen;
  const status = $('#cat-status');
  let index;
  try {
    index = await loadIndex(st.cardLang, (key, p) => (status.textContent = t(key, p)));
    // всё тяжёлое для сканера грузим заранее, чтобы первый скан не ждал
    warmUp(st.cardLang);
    warmEmbed();
    setTimeout(() => warmIndex(st.cardLang), 1200); // после каталога, чтобы не тормозить первый экран
  } catch (e) {
    status.textContent = t('cat.fail');
    return;
  }
  if (gen !== catalogGen) return;
  const showDefault = () => {
    // у самых свежих сетов цен ещё нет — показываем популярных покемонов
    lastResults = ['charizard', 'pikachu', 'umbreon', 'mewtwo', 'gengar', 'eevee'].flatMap((n) => search(index, n, 8));
    status.textContent = t('cat.popular');
    renderGrid($('#grid'), lastResults);
  };
  showDefault();
  let timer;
  $('#q').oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = $('#q').value.trim();
      if (!q) return showDefault();
      lastResults = search(index, q);
      status.textContent = lastResults.length ? t('cat.found', { n: `${lastResults.length}${lastResults.length === 60 ? '+' : ''}` }) : t('cat.none');
      renderGrid($('#grid'), lastResults);
    }, 250);
  };
}

// ---------- карточка / экран совпадения ----------
let sheetState = null;
async function openCard(state) {
  sheetState = { ...state };
  $('#sheet').hidden = false;
  $('#sheet-title').textContent = t(state.photo ? 'sheet.result' : 'sheet.card');
  await renderSheet();
}
$('#sheet-close').onclick = () => { $('#sheet').hidden = true; sheetState = null; };

// Та же карта на другом языке: из индекса, а если язык не загружен — прямо из TCGdex.
async function cardInLang(index, card, lang) {
  const known = index.byId.get(`${lang}:${card.id}`);
  if (known) return known;
  const d = await cardDetail(lang, card.id).catch(() => null);
  if (!d?.name) return null;
  return { id: d.id, localId: d.localId, name: d.name, image: d.image || card.image, lang, n: norm(d.name), setName: d.set?.name };
}

async function renderSheet() {
  const s = sheetState;
  if (!s) return;
  const body = $('#sheet-body');
  const index = await sidx();
  const card = s.card;
  if (!card) {
    body.innerHTML = `${s.photo ? `<img class="hero" src="${s.photo}">` : ''}
      <p class="empty">${t('sheet.fail')}</p>
      <div class="row"><button class="btn" id="to-manual">${t('sheet.manual')}</button></div>
      ${s.debug ? `<div class="debug">${esc(s.debug)}</div>` : ''}`;
    $('#to-manual').onclick = openManual;
    return;
  }
  const set = setOf(index, card);
  let detail = s.detailFor === `${card.lang}:${card.id}` ? s.detail : null;
  const head = s.photo
    ? `<div class="compare"><div><img src="${s.photo}">${t('sheet.yours')}</div><div class="ours"><img src="${imgUrl(card, 'high')}">${t('sheet.match')}</div></div>`
    : `<img class="hero" src="${imgUrl(card, 'high')}">`;
  const alts = (s.candidates || []).length > 1
    ? `<div class="alts-h"><span>${t('sheet.others')}</span><button id="to-manual">${t('sheet.notright')}</button></div>
       <div class="alts">${s.candidates.map((c, i) => `<button data-i="${i}" class="${c === card ? 'sel' : ''}"><img src="${imgUrl(c)}" loading="lazy"></button>`).join('')}</div>`
    : s.photo ? `<div class="alts-h"><span></span><button id="to-manual">${t('sheet.notright')}</button></div>` : '';
  const total = set?.cardCount?.official;
  const warn = s.scanItem?.status === 'unsure' ? `<div class="warn">⚠ ${t('sheet.unsure')}</div>` : '';
  body.innerHTML = `${head}${warn}${alts}
    <div class="title-row"><h2>${esc(card.name)} #${esc(card.localId)}</h2><div class="pr" id="d-price"><span class="spin"></span></div>
      <button class="heart ${store.inWish(card.id, card.lang) ? 'on' : ''}" id="d-wish" aria-label="${t('wish.add')}">${store.inWish(card.id, card.lang) ? '♥' : '♡'}</button></div>
    <div class="chips"><span class="chip" id="d-set">${esc(set?.name || card.setName || '—')}</span><span class="chip">#${esc(card.localId)}${total ? ` / ${total}` : ''}</span><span class="chip" id="d-rarity">…</span></div>
    <label class="langsel"><span>${t('sheet.lang')}</span><select id="d-lang">${LANG_KEYS.map((l) => `<option value="${l}" ${l === card.lang ? 'selected' : ''}>${CARD_LANGS[l]}</option>`).join('')}</select></label>
    <div class="sec">${t('sheet.variant')}</div><div class="variants" id="d-vars"><span class="spin"></span></div>
    <div class="sec">${t('sheet.prices')}</div><div class="prices" id="d-prices"><div><span>${t('sheet.loading')}</span><span></span></div></div>
    <div class="actions"><button class="btn" id="d-collect">${t('sheet.collect')}</button><button class="btn ghost" id="d-owned" disabled>${t('sheet.qty', { n: store.qtyOf(card.id, card.lang) })}</button></div>
    <div class="note" id="d-note"></div>
    <button class="btn ghost wide" id="d-grade">${t('grade.this')}</button>
    <div id="d-trend"></div>
    ${s.debug ? `<details class="debug"><summary>${t('sheet.read')}</summary>${esc(s.debug)}</details>` : ''}`;

  const choose = (c) => {
    if (s.scanItem?.status === 'unsure') confirmScan(s.scanItem);
    sheetState.card = c;
    sheetState.variant = null;
    if (s.scanItem) { s.scanItem.card = c; s.scanItem.variant = null; s.scanItem.candidates = s.candidates; renderTray(); }
    renderSheet();
  };
  body.querySelectorAll('.alts button').forEach((b) => (b.onclick = () => choose(s.candidates[+b.dataset.i])));
  $('#to-manual')?.addEventListener('click', openManual);
  $('#d-grade').onclick = () => { $('#sheet').hidden = true; openScanner('grade', card); };
  $('#d-wish').onclick = () => {
    store.toggleWish({ id: card.id, lang: card.lang, name: card.name, localId: card.localId, image: card.image, setName: set?.name || card.setName || '' });
    const on = store.inWish(card.id, card.lang);
    $('#d-wish').classList.toggle('on', on);
    $('#d-wish').textContent = on ? '♥' : '♡';
    if (on) toast(t('wish.added'));
  };
  $('#d-lang').onchange = async (e) => {
    const other = await cardInLang(index, card, e.target.value);
    if (!other) { e.target.value = card.lang; return toast(t('sheet.nolang')); }
    // та же карта на другом языке; в списке вариантов меняем её тоже
    if (s.candidates) s.candidates = s.candidates.map((c) => (c === card ? other : c));
    choose(other);
  };

  try {
    detail ??= await cardDetail(card.lang, card.id);
  } catch {
    $('#d-prices').innerHTML = `<div><span>${t('sheet.noconn')}</span><span></span></div>`;
    $('#d-price').textContent = '—';
  }
  if (sheetState?.card !== card) return; // пока грузили, выбрали другую
  s.detail = detail; s.detailFor = `${card.lang}:${card.id}`;
  const variant = s.variant || bestVariant(detail, cur());
  s.variant = variant;
  if (s.scanItem) { s.scanItem.variant = variant; s.scanItem.detail = detail; s.scanItem.detailFor = s.detailFor; renderTray(); }
  const price = priceFor(detail, variant, cur());
  if (s.scanItem) {
    if (s.scanItem.pendingCollect && !s.scanItem.collUid) { s.scanItem.pendingCollect = false; collectScan(s.scanItem, index); }
    syncCollected(s.scanItem, index);
  }
  $('#d-price').textContent = fmtPrice(price);
  $('#d-rarity').textContent = detail?.rarity || '—';
  if (detail?.set?.name) $('#d-set').textContent = detail.set.name;
  $('#d-vars').innerHTML = variantsOf(detail).map((v) => `<button data-v="${v}" class="${v === variant ? 'sel' : ''}">${t(`var.${v}`)}</button>`).join('');
  $('#d-vars').querySelectorAll('button').forEach((b) => (b.onclick = () => { s.variant = b.dataset.v; renderSheet(); }));

  const rows = [];
  const tp = detail?.pricing?.tcgplayer, cm = detail?.pricing?.cardmarket;
  const tpKey = { normal: 'normal', holo: 'holofoil', reverse: 'reverse-holofoil', firstEdition: '1st-edition-holofoil' }[variant];
  const tv = tp?.[tpKey];
  if (tv) {
    const f = (v) => (v > 0 ? `$${v.toFixed(2)}` : '—');
    rows.push([t('pr.tpMarket'), f(tv.marketPrice)], [t('pr.tpRange'), `${f(tv.lowPrice)} / ${f(tv.highPrice)}`]);
  }
  if (cm) {
    const h = variant === 'holo' || variant === 'reverse' ? '-holo' : '';
    const f = (v) => (v > 0 ? `€${v.toFixed(2)}` : '—');
    rows.push([t('pr.cmTrend'), f(cm[`trend${h}`] || cm.trend)], [t('pr.cmAvg30'), f(cm[`avg30${h}`] || cm.avg30)]);
  }
  $('#d-prices').innerHTML = rows.length
    ? rows.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('')
    : `<div><span>${t('sheet.noprices')}</span><span></span></div>`;
  const upd = tp?.updated || cm?.updated;
  $('#d-note').textContent = upd ? t('sheet.updated', { d: new Date(upd).toLocaleDateString(dateLocale()) }) : '';
  const own = store.all().find((i) => i.id === card.id && i.lang === card.lang && i.variant === variant);
  $('#d-trend').innerHTML = trendHtml(detail, variant, own);

  const btn = $('#d-collect');
  const inColl = () => s.scanItem?.collUid;
  btn.textContent = t(inColl() ? 'sheet.inColl' : 'sheet.collect');
  btn.onclick = () => {
    if (s.scanItem?.status === 'unsure') confirmScan(s.scanItem);
    if (s.scanItem && !inColl()) collectScan(s.scanItem, index);
    else store.add({
      id: card.id, lang: card.lang, name: card.name, localId: card.localId, setName: set?.name || detail?.set?.name || '',
      image: card.image, variant, price, photo: s.thumb || null,
    });
    renderTray();
    btn.textContent = t('sheet.inColl');
    $('#d-owned').textContent = t('sheet.qty', { n: store.qtyOf(card.id, card.lang) });
    toast(t('sheet.addedToast', { name: card.name }));
  };
}

// ---------- скан ↔ коллекция ----------
const collKey = (item) => `${item.card.lang}:${item.card.id}:${item.variant}`;
function scanEntry(item, index) {
  const c = item.card;
  return {
    id: c.id, lang: c.lang, name: c.name, localId: c.localId, setName: setOf(index, c)?.name || item.detail?.set?.name || '',
    image: c.image, variant: item.variant, price: priceFor(item.detail, item.variant, cur()), photo: item.thumb,
  };
}
function collectScan(item, index) {
  item.collUid = store.add(scanEntry(item, index));
  item.collKey = collKey(item);
  item.collected = true;
}
// карту в скане поправили (другой кандидат, язык, вариант) — меняем и запись в коллекции
function syncCollected(item, index) {
  if (!item.collUid || item.collKey === collKey(item)) return;
  if (item.detailFor !== `${item.card.lang}:${item.card.id}`) return; // цены новой карты ещё не загружены
  store.removeOne(item.collUid);
  collectScan(item, index);
  renderTray();
}

// Человек сам выбрал или подтвердил карту — скан засчитывается как обычный.
function confirmScan(item) {
  item.status = 'ok';
  item.sure = true;
  item.pendingCollect = st.autoCollect; // добавим, когда загрузятся цены выбранной карты
}

// ---------- ручной поиск (из экрана совпадения) ----------
function openManual() {
  $('#manual').hidden = false;
  $('#mq').value = sheetState?.card?.name || sheetState?.guess || '';
  runManual();
  $('#mq').focus();
}
async function runManual() {
  const index = await idx();
  renderGrid($('#mgrid'), search(index, $('#mq').value, 40), (c) => {
    $('#manual').hidden = true;
    const s = sheetState;
    s.candidates = [c, ...(s.candidates || []).filter((x) => x !== c)];
    s.card = c; s.variant = null;
    if (s.scanItem) {
      if (s.scanItem.status !== 'ok') confirmScan(s.scanItem);
      s.scanItem.card = c; s.scanItem.candidates = s.candidates; renderTray();
    }
    renderSheet();
  });
}
let mt;
$('#mq').oninput = () => { clearTimeout(mt); mt = setTimeout(runManual, 250); };
$('#manual-close').onclick = () => ($('#manual').hidden = true);

// ---------- сканер ----------
let stream = null;
const scans = [];

// mode: 'scan' — распознавание, 'grade' — оценка состояния (card — если карта уже известна)
let scanMode = 'scan', gradeTarget = null;
async function openScanner(mode = 'scan', card = null) {
  scanMode = mode;
  gradeTarget = card;
  $('#scanner').hidden = false;
  $('#scanner').classList.toggle('grading', mode === 'grade');
  $('#grade-banner').hidden = mode !== 'grade';
  $('#grade-banner').textContent = t('grade.banner');
  warmUp(st.cardLang);
  updateBadge();
  const msg = $('#cam-msg');
  msg.hidden = true;
  if (stream) return syncAuto();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false,
    });
    const v = $('#video');
    v.srcObject = stream;
    await v.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() || {};
    $('#torch').hidden = !caps.torch;
    if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    syncAuto();
  } catch (e) {
    msg.hidden = false;
    msg.textContent = t('scan.nocam');
  }
}
function closeScanner() {
  $('#scanner').hidden = true;
  auto.stop();
  stream?.getTracks().forEach((tr) => tr.stop());
  stream = null;
  torchOn = false;
  $('#torch').classList.remove('on');
}
$('#scan-close').onclick = () => go('catalog');

let torchOn = false;
$('#torch').onclick = async () => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  torchOn = !torchOn;
  await track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => (torchOn = false));
  $('#torch').classList.toggle('on', torchOn);
};

// Область рамки в координатах видео (учитываем object-fit: cover); pad — запас по краям.
function guideRect(pad = 0) {
  const v = $('#video');
  if (!v.videoWidth) return null;
  const vr = v.getBoundingClientRect(), gr = $('#guide').getBoundingClientRect();
  const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight);
  const offX = (vr.width - v.videoWidth * scale) / 2, offY = (vr.height - v.videoHeight * scale) / 2;
  const padX = gr.width * pad, padY = gr.height * pad;
  return {
    sx: (gr.left - padX - vr.left - offX) / scale, sy: (gr.top - padY - vr.top - offY) / scale,
    sw: (gr.width + padX * 2) / scale, sh: (gr.height + padY * 2) / scale,
  };
}
// Кадр рамки с запасом 6%: карту потом найдём на кадре сами и выровняем.
function grabGuide() {
  const r = guideRect(0.06);
  if (!r) return null;
  const c = document.createElement('canvas');
  c.width = Math.round(r.sw); c.height = Math.round(r.sh);
  c.getContext('2d').drawImage($('#video'), r.sx, r.sy, r.sw, r.sh, 0, 0, c.width, c.height);
  return c;
}

function shoot() {
  if (scanMode === 'grade') {
    // для оценки нужен фон вокруг карты — берём рамку с большим запасом
    const r = guideRect(0.15);
    if (!r) return toast(t('scan.notready'));
    const c = document.createElement('canvas');
    c.width = Math.round(r.sw); c.height = Math.round(r.sh);
    c.getContext('2d').drawImage($('#video'), r.sx, r.sy, r.sw, r.sh, 0, 0, c.width, c.height);
    $('.viewfinder').classList.remove('flash'); void $('.viewfinder').offsetWidth; $('.viewfinder').classList.add('flash');
    return runGrade(c);
  }
  const c = grabGuide();
  if (!c) return toast(t('scan.notready'));
  $('.viewfinder').classList.remove('flash'); void $('.viewfinder').offsetWidth; $('.viewfinder').classList.add('flash');
  navigator.vibrate?.(25);
  addScan(c);
}
$('#shutter').onclick = shoot;

// ---------- пакетный режим ----------
const auto = createAutoScan({
  source: () => $('#video'),
  rect: () => guideRect(0),
  onShot: shoot,
  busy: () => scans.filter((x) => x.status === 'proc').length >= 2, // не копим очередь
  onState: (s) => {
    const h = $('#auto-hint');
    h.hidden = !s;
    h.textContent = s ? t(`auto.${s}`) : '';
    h.className = `auto-hint ${s}`;
  },
});
// автоскан включён всегда: карта в рамке снимается сама, кнопка — для ручного снимка
function syncAuto() {
  if (stream && !$('#scanner').hidden && scanMode === 'scan') auto.start(); else auto.stop();
}

$('#gallery').onchange = async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  const bmp = await createImageBitmap(f).catch(() => null);
  if (!bmp) return toast(t('scan.badphoto'));
  // обрезаем по пропорциям карты по центру
  const ar = 63 / 88;
  let w = bmp.width, h = bmp.height;
  if (w / h > ar) w = h * ar; else h = w / ar;
  const c = document.createElement('canvas');
  c.width = Math.round(w); c.height = Math.round(h);
  c.getContext('2d').drawImage(bmp, (bmp.width - w) / 2, (bmp.height - h) / 2, w, h, 0, 0, c.width, c.height);
  addScan(c);
};

// ---------- оценка состояния ----------
function loadCors(url) {
  return new Promise((res) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}
// Узнаём карту (чтобы взять её чистую картинку как эталон), потом оцениваем.
async function runGrade(canvas) {
  const known = gradeTarget;
  go('grade');
  views.openPanel(t('grade.title'), '', (body) => { body.innerHTML = `<div class="empty"><span class="spin"></span><p>${t('grade.working')}</p></div>`; });
  let card = known;
  if (!card) {
    try {
      const r = await recognize(canvas, () => {}, { lang: st.cardLang });
      if (r.sure) card = r.candidates[0];
    } catch (e) { console.warn('grade: recognize', e); }
  }
  // эталон: крупная картинка, если не загрузилась — обычная
  const ref = card ? (await loadCors(imgUrl(card, 'high'))) || (await loadCors(imgUrl(card, 'low'))) : null;
  showGrade(gradeCard(canvas, ref), card, null);
}
$('#grade-shoot').onclick = () => openScanner('grade');
$('#grade-gallery').onchange = async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  const bmp = await createImageBitmap(f).catch(() => null);
  if (!bmp) return toast(t('scan.badphoto'));
  // фото целиком: вокруг карты нужен фон
  const W = Math.min(1600, bmp.width), H = Math.round(bmp.height * (W / bmp.width));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.getContext('2d').drawImage(bmp, 0, 0, W, H);
  gradeTarget = null;
  runGrade(c);
};

function thumbOf(canvas, w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = Math.round(canvas.height * (w / canvas.width));
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

let queue = Promise.resolve();
function addScan(canvas) {
  const item = { uid: Date.now() + Math.random(), status: 'proc', stage: t('st.proc'), photo: thumbOf(canvas, 420), thumb: thumbOf(canvas, 120) };
  scans.unshift(item);
  renderTray();
  queue = queue.then(async () => {
    try {
      const r = await recognize(canvas, (key, p) => { item.stage = t(key, p); renderTray(); }, { lang: st.cardLang });
      const index = await sidx();
      // имя прочиталось на другом языке (испанская карта при английских настройках) — берём эту версию
      if (r.candidates[0] && r.lang !== r.candidates[0].lang) {
        const other = await cardInLang(index, r.candidates[0], r.lang);
        if (other) r.candidates[0] = other;
      }
      item.candidates = r.candidates;
      item.card = r.candidates[0] || null;
      item.guess = r.name || '';
      item.sure = r.sure;
      item.debug = `OCR: ${r.text.replace(/\s+/g, ' ').slice(0, 400)}\nName: ${r.name || '—'} · No.: ${r.number ? `${r.number.num}/${r.number.total}` : '—'} · HP: ${r.hp || '—'} · ${r.lang}${r.sure ? '' : ' · unsure'}`;
      item.status = !item.card ? 'err' : r.sure ? 'ok' : 'unsure';
      renderTray(); // карту показываем сразу, цену догружаем отдельно — следующий скан сеть не ждёт
      if (item.card) finishScan(item, index);
    } catch (e) {
      console.error(e);
      item.status = 'err';
      item.debug = String(e?.message || e);
    }
    renderTray();
  });
}

// цена и добавление в коллекцию — вне очереди распознавания
async function finishScan(item, index) {
  const card = item.card;
  const detail = await cardDetail(card.lang, card.id).catch(() => null);
  if (item.card !== card) return; // пока грузилось, человек выбрал другую карту
  item.detail = detail;
  item.detailFor = `${card.lang}:${card.id}`;
  item.variant = bestVariant(detail, cur());
  // неуверенный скан не попадает в коллекцию сам — сначала пусть проверят
  if (item.status === 'ok') {
    if (st.autoCollect) collectScan(item, index);
    if (!st.firstFind) celebrate();
  }
  renderTray();
}

function renderTray() {
  const tray = $('#tray');
  $('#collect-all').hidden = !scans.some((s) => s.status === 'ok' && !s.collUid);
  if (!scans.length) {
    tray.innerHTML = `<div class="tray-hint">${t('scan.hint')}</div>`;
    return;
  }
  tray.replaceChildren(...scans.map((s) => {
    const b = document.createElement('button');
    b.className = `titem ${s.status === 'err' ? 'err' : s.status === 'unsure' ? 'unsure' : ''}`;
    let txt;
    if (s.status === 'proc') txt = `<div class="nm"><span class="spin"></span> ${esc(s.stage)}</div>`;
    else if (s.status === 'err') txt = `<div class="nm">${t('scan.unknown')}</div><div class="st">${t('scan.tapfind')}</div>`;
    else {
      const p = priceFor(s.detail, s.variant, cur());
      const stt = s.collected ? t('scan.incoll') : s.status === 'unsure' ? `⚠ ${t('scan.check')}` : t('scan.new');
      txt = `<div class="nm">${esc(s.card.name)} · ${esc(s.card.localId)}</div><div class="pr">${fmtPrice(p)}</div><div class="st">${stt}</div>`;
    }
    b.innerHTML = `<img src="${s.card ? imgUrl(s.card) : s.thumb}"><div class="txt">${txt}</div><span class="x">×</span>`;
    b.querySelector('.x').onclick = (e) => {
      e.stopPropagation();
      if (s.collUid) { store.removeOne(s.collUid); toast(t('scan.removed')); }
      scans.splice(scans.indexOf(s), 1);
      renderTray();
    };
    b.onclick = () => {
      if (s.status === 'proc') return;
      openCard({ card: s.card, candidates: s.candidates, photo: s.photo, thumb: s.thumb, scanItem: s, variant: s.variant, detail: s.detail, detailFor: s.card && `${s.card.lang}:${s.card.id}`, debug: s.debug, guess: s.guess });
    };
    return b;
  }));
}

$('#collect-all').onclick = async () => {
  const index = await sidx();
  let n = 0;
  for (const s of scans) {
    if (s.status !== 'ok' || s.collUid) continue; // неуверенные — только вручную
    collectScan(s, index); n++;
  }
  renderTray();
  toast(t('scan.added', { n }));
};

function updateBadge() {
  const n = store.all().reduce((s, i) => s + i.qty, 0);
  $('#coll-badge').hidden = !n;
  $('#coll-badge').textContent = n;
}
store.onChange(updateBadge);

function celebrate() {
  st.firstFind = true;
  store.saveSettings();
  const el = $('#celebrate');
  el.hidden = false;
  const close = () => (el.hidden = true);
  el.onclick = close;
  setTimeout(close, 2600);
}

// ---------- коллекция (views.js) ----------
const renderPortfolio = () => views.renderPortfolio();
store.onChange(() => { if ($('#v-portfolio').classList.contains('active')) renderPortfolio(); });

// запись коллекции или списка желаний → экран карты
async function openItem(i) {
  const index = await sidx();
  const card = index.byId.get(`${i.lang}:${i.id}`) || { ...i, n: norm(i.name) };
  openCard({ card, variant: i.variant });
}

// ---------- кнопка «назад» на Android ----------
function back() {
  if (tutorial.isOpen()) return tutorial.back(), true;
  if (views.modalOpen()) return views.closeModal(), true;
  if (!$('#celebrate').hidden) return ($('#celebrate').hidden = true), true;
  if (!$('#manual').hidden) return ($('#manual').hidden = true), true;
  if (!$('#settings').hidden) return ($('#settings').hidden = true), true;
  if (!$('#sheet').hidden) return $('#sheet-close').click(), true;
  if (views.panelOpen()) return views.closePanel(), true;
  if (!$('#scanner').hidden) return go('catalog'), true;
  if (!$('#v-catalog').classList.contains('active')) return go('catalog'), true;
  return false;
}
window.Capacitor?.Plugins?.App?.addListener('backButton', () => {
  if (!back()) window.Capacitor.Plugins.App.exitApp();
});

// вход сохраняется между запусками: подтягиваем коллекцию из облака
sync.onUser(() => {
  renderPortfolio();
  updateBadge();
  if (!$('#settings').hidden) renderSettings();
});
sync.init();

// После обучения язык карт мог поменяться — перезагружаем каталог под него.
function openTutorial() {
  const was = st.cardLang, wasUi = st.uiLang;
  tutorial.showTutorial(() => {
    if (st.uiLang !== wasUi) refreshAll();
    if (st.cardLang !== was) { warmUp(st.cardLang); initCatalog(); }
  });
}

views.initViews({ openCard, openItem, toast, idx, cur, renderGrid, tilePrice });
initGradeView({ openPanel: views.openPanel, openCard, toast, tilePrice, shootGrade: () => openScanner('grade') });
initCatalog();
if (!st.tutorialDone) openTutorial();

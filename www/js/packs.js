// Открытие паков: выбираешь бустер сета, надрываешь его свайпом и по одной открываешь 10 карт.
// Карты настоящие (data/packs.json, tools/build_packs.py), шансы редкостей — примерные, как в бустерах.
// Анимации — CSS (css/app.css, раздел «паки»), звуки синтезируются WebAudio, файлов нет.
import { t } from './i18n.js';
import { cardDetail, priceFor, fmtPrice, toCurrency } from './api.js';
import * as store from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let ctx, dataP, packs = [], serieSel = 'all';

const SERIES = { me: 'Mega Evolution', sv: 'Scarlet & Violet', swsh: 'Sword & Shield', sm: 'Sun & Moon', xy: 'XY', bw: 'Black & White' };
// шанс редкого слота (нормируется по тем уровням, что есть в сете)
const RARE_SLOT = { R: 0.64, DR: 0.17, UR: 0.06, IR: 0.08, SIR: 0.03, HR: 0.015 };
const GOD_PACK = 1 / 250; // редкий «божественный» пак: все последние карты — дорогие
export const TIER_NAME = { C: 'Common', U: 'Uncommon', R: 'Rare', DR: 'Double Rare', UR: 'Ultra Rare', IR: 'Illustration Rare', SIR: 'Special Illustration Rare', HR: 'Hyper Rare' };
const RANK = { C: 0, U: 1, R: 2, DR: 3, UR: 4, IR: 4, SIR: 5, HR: 6 };
const img = (p, localId, q = 'high') => `${p.img}/${localId}/${q}.webp`;

export function initPacks(c) {
  ctx = c;
  dataP = null;
}
const loadData = () => (dataP ??= fetch('data/packs.json').then((r) => r.json()).then((d) => (packs = d.packs)));

// ---------- пак: общая разметка для витрины и для открытия ----------
function packHtml(p, cls = '') {
  const [c1, c2] = p.colors;
  return `<div class="pack ${cls}" style="--c1:${c1};--c2:${c2};--art:url('${img(p, p.cover)}')">
    <div class="pack-cap"><div class="pack-crimp"></div><span class="pack-tag">${esc(t('packs.cards'))}</span></div>
    <div class="pack-body">
      <div class="pack-art"></div><div class="pack-foil"></div>
      ${p.logo ? `<img class="pack-logo" src="${p.logo}.webp" alt="" onerror="this.src='${p.logo}.png'">` : `<b class="pack-name">${esc(p.name)}</b>`}
      <div class="pack-brand"><span class="logo-mark"></span>HoloScan Booster</div>
      <div class="pack-crimp bottom"></div>
    </div>
    <div class="tear-line"><i></i></div>
  </div>`;
}

// ---------- витрина ----------
export async function renderPacks() {
  const pane = $('#cat-packs');
  if (!pane.dataset.ready) pane.innerHTML = `<div class="status">${t('st.load')}</div>`;
  await loadData().catch(() => { pane.innerHTML = `<div class="empty">${t('cat.fail')}</div>`; throw new Error('packs'); });
  pane.dataset.ready = 1;
  const chips = [['all', t('seg.all')], ...Object.entries(SERIES).filter(([k]) => packs.some((p) => p.serie === k))]
    .map(([k, v]) => `<button class="chip ${serieSel === k ? 'sel' : ''}" data-serie="${k}">${esc(v)}</button>`).join('');
  const list = packs.filter((p) => serieSel === 'all' || p.serie === serieSel);
  pane.innerHTML = `
    <div class="packs-hero"><b>${t('packs.title')}</b><span>${t('packs.sub')}</span></div>
    <div class="chips scroll">${chips}</div>
    <div class="pack-grid">${list.map((p) => `<button class="pack-pick" data-pack="${p.id}">${packHtml(p, 'mini')}<span>${esc(p.name)}</span></button>`).join('')}</div>
    <p class="note center">${t('packs.note')}</p>`;
  pane.querySelectorAll('[data-serie]').forEach((b) => (b.onclick = () => { serieSel = b.dataset.serie; renderPacks(); }));
  pane.querySelectorAll('[data-pack]').forEach((b) => (b.onclick = () => openPack(packs.find((p) => p.id === b.dataset.pack))));
  // наклон паков за пальцем — витрина живая
  pane.querySelectorAll('.pack-pick').forEach((b) => {
    const pk = b.querySelector('.pack');
    b.onpointermove = (e) => {
      const r = b.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      pk.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 14}deg)`;
      pk.style.setProperty('--mx', `${(x + 0.5) * 100}%`);
    };
    b.onpointerleave = () => { pk.style.transform = ''; };
  });
}

// ---------- что выпало ----------
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function rollTier(p, weights) {
  const avail = Object.entries(weights).filter(([k]) => p.tiers[k]?.length);
  let r = Math.random() * avail.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of avail) if ((r -= w) <= 0) return k;
  return avail[0]?.[0] || 'R';
}
function roll(p) {
  const card = (tier, extra = {}) => {
    const [localId, name, holo] = pick(p.tiers[tier]);
    return { tier, localId, name, id: `${p.id}-${localId}`, holo: !!holo || RANK[tier] >= 2, ...extra };
  };
  const god = Math.random() < GOD_PACK && (p.tiers.IR || p.tiers.SIR);
  const out = [];
  for (let i = 0; i < 4; i++) out.push(card('C'));
  for (let i = 0; i < 3; i++) out.push(card('U'));
  // два слота «реверс-холо»: обычная карта с голографическим фоном, изредка — Illustration Rare
  for (let i = 0; i < 2; i++) {
    if (god) out.push(card(p.tiers.IR ? 'IR' : 'DR'));
    else if (p.tiers.IR && Math.random() < 0.09) out.push(card('IR'));
    else {
      const t2 = Math.random() < 0.7 ? 'C' : Math.random() < 0.75 ? 'U' : 'R';
      out.push(card(p.tiers[t2] ? t2 : 'C', { reverse: true, holo: true }));
    }
  }
  out.push(card(god ? rollTier(p, { SIR: 2, HR: 1, UR: 1 }) : rollTier(p, RARE_SLOT)));
  // одинаковые карты в одном паке бывают, но редко — заменим повтор среди обычных
  for (let i = 0; i < 7; i++) for (let j = 0; j < i; j++) if (out[i].id === out[j].id) out[i] = card(out[i].tier);
  return { cards: out, god: !!god };
}
const variantOf = (c) => (c.reverse ? 'reverse' : c.holo ? 'holo' : 'normal');

// ---------- звук: синтез без файлов ----------
let actx = null;
const soundOn = () => { try { return localStorage.getItem('holoscan.packSound') !== '0'; } catch { return true; } };
function audio() {
  if (!soundOn()) return null;
  try { actx ??= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; } catch { return null; }
}
function noise(dur, f0, f1, vol = 0.25) {
  const a = audio(); if (!a) return;
  const n = a.sampleRate * dur, buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 1.5;
  const src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
  bp.type = 'bandpass'; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(f0, a.currentTime); bp.frequency.exponentialRampToValueAtTime(f1, a.currentTime + dur);
  g.gain.value = vol; src.buffer = buf; src.connect(bp).connect(g).connect(a.destination); src.start();
}
function chime(notes, step = 0.09, vol = 0.12) {
  const a = audio(); if (!a) return;
  notes.forEach((f, i) => {
    const o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime + i * step;
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
    o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + 1);
  });
}
const SFX = {
  tear: () => noise(0.45, 900, 4200, 0.35),
  whoosh: () => noise(0.18, 2200, 600, 0.18),
  flip: () => noise(0.12, 3000, 1500, 0.12),
  charge: () => chime([392, 523], 0.12, 0.06),
  rare: (rank) => chime([523, 659, 784, 1047, 1319, 1568].slice(0, 2 + rank), 0.08, 0.13),
};
const buzz = (ms) => navigator.vibrate?.(ms);

// ---------- открытие ----------
let state = null;
function openPack(p) {
  const el = $('#pack-open');
  const [c1, c2] = p.colors;
  el.style.setProperty('--c1', c1); el.style.setProperty('--c2', c2);
  el.innerHTML = `
    <div class="po-bg"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="po-top">
      <button class="icon-btn" id="po-close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <b>${esc(p.name)}</b>
      <button class="icon-btn" id="po-sound" aria-label="${esc(t('packs.sound'))}">${soundIcon()}</button>
    </div>
    <div class="po-stage" id="po-stage">${packHtml(p, 'big enter')}</div>
    <div class="po-hint" id="po-hint"><span class="swipe-demo"></span>${t('packs.swipe')}</div>`;
  el.hidden = false;
  document.body.classList.add('no-scroll');
  state = { p, ...roll(p), i: -1, revealed: false, prices: [], done: false };
  // цены грузим сразу, пока человек рвёт пак
  state.cards.forEach((c, k) => {
    state.prices[k] = cardDetail('en', c.id).then((d) => priceFor(d, variantOf(c), ctx.cur()) || priceFor(d, 'holo', ctx.cur()) || priceFor(d, 'normal', ctx.cur())).catch(() => null);
  });
  state.cards.forEach((c) => { const im = new Image(); im.src = img(p, c.localId); }); // картинки — заранее
  $('#po-close').onclick = closePack;
  $('#po-sound').onclick = (e) => {
    try { localStorage.setItem('holoscan.packSound', soundOn() ? '0' : '1'); } catch {}
    e.currentTarget.innerHTML = soundIcon();
  };
  const pack = $('#po-stage .pack');
  setTimeout(() => pack.classList.remove('enter'), 900);
  setTimeout(() => SFX.whoosh(), 80);
  armTear(pack);
}
const soundIcon = () => (soundOn()
  ? '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>'
  : '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/></svg>');

export function packOpen() { return !$('#pack-open').hidden; }
export function closePack() {
  const el = $('#pack-open');
  el.hidden = true; el.innerHTML = '';
  document.body.classList.remove('no-scroll');
  state = null;
}

// Надрыв: ведёшь пальцем вдоль верха — по шву бежит светящаяся линия; дошёл до конца — пак открыт.
// Простой тап тоже работает: линия пробегает сама.
function armTear(pack) {
  const line = pack.querySelector('.tear-line i');
  let x0 = null, best = 0, done = false, lastSpark = 0;
  const set = (v) => { best = Math.max(best, v); line.style.transform = `scaleX(${best})`; };
  const spark = (e) => {
    const now = performance.now();
    if (now - lastSpark < 40) return;
    lastSpark = now;
    const r = pack.getBoundingClientRect(), s = document.createElement('i');
    s.className = 'spark';
    s.style.left = `${Math.min(Math.max(e.clientX - r.left, 0), r.width)}px`;
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * 60}px`);
    s.style.setProperty('--dy', `${-20 - Math.random() * 40}px`);
    pack.querySelector('.tear-line').append(s);
    setTimeout(() => s.remove(), 600);
  };
  const finish = () => {
    if (done) return;
    done = true;
    set(1);
    tear(pack);
  };
  pack.onpointerdown = (e) => {
    x0 = e.clientX;
    pack.setPointerCapture(e.pointerId);
    pack.classList.add('grab');
  };
  pack.onpointermove = (e) => {
    if (x0 == null || done) return;
    const w = pack.getBoundingClientRect().width;
    set(Math.min(1, Math.abs(e.clientX - x0) / (w * 0.8)));
    spark(e);
    if (best > 0.15 && Math.random() < 0.3) noise(0.05, 2500, 3500, 0.06);
    if (best >= 1) finish();
  };
  pack.onpointerup = () => {
    pack.classList.remove('grab');
    if (done) return;
    if (best < 0.08) { // тап — анимируем разрыв сами
      let v = 0;
      const step = () => { v += 0.08; set(v); if (v < 1) requestAnimationFrame(step); else finish(); };
      step();
    } else if (best > 0.6) finish();
    x0 = null;
  };
}

function tear(pack) {
  SFX.tear(); buzz(30);
  $('#po-hint').classList.add('gone');
  pack.classList.add('torn');
  pack.onpointerdown = pack.onpointermove = pack.onpointerup = null;
  // вспышка из шва, крышка улетает, пак уезжает вниз — из него поднимается стопка
  setTimeout(() => {
    const stage = $('#po-stage');
    stage.insertAdjacentHTML('beforeend', `<div class="stack" id="po-stack">${state.cards.map((c, k) => `
      <div class="pcard" data-k="${k}" style="--k:${k};--z:${100 - k}">
        <div class="pcard-in">
          <div class="pcard-back"><span class="logo-mark"></span></div>
          <div class="pcard-face tier-${c.tier} ${c.holo ? 'is-holo' : ''} ${c.reverse ? 'is-reverse' : ''}">
            <img src="${img(state.p, c.localId)}" alt="" draggable="false"><div class="holo"></div><div class="glare"></div>
          </div>
        </div>
      </div>`).join('')}</div>
      <div class="po-count" id="po-count"></div>`);
    pack.classList.add('away');
    const stack = $('#po-stack');
    requestAnimationFrame(() => stack.classList.add('rise'));
    setTimeout(() => { pack.remove(); armStack(); }, 900);
  }, 420);
}

// ---------- стопка: тап — перевернуть, ещё тап или свайп — убрать ----------
function armStack() {
  const stage = $('#po-stage');
  const hint = $('#po-hint');
  hint.innerHTML = t('packs.tap'); hint.classList.remove('gone');
  updateCount();
  let sx = null, sy = null, moved = false;
  stage.onpointerdown = (e) => { sx = e.clientX; sy = e.clientY; moved = false; };
  stage.onpointermove = (e) => {
    if (sx == null) return;
    const top = current();
    if (!top) return;
    // наклон открытой карты за пальцем — голограмма переливается
    if (state.revealed) tilt(top, e);
    const dx = e.clientX - sx;
    if (state.revealed && Math.abs(dx) > 12) { moved = true; top.style.translate = `${dx}px 0`; top.style.rotate = `${dx / 18}deg`; }
  };
  stage.onpointerup = (e) => {
    const dx = sx == null ? 0 : e.clientX - sx;
    sx = null;
    if (!current()) return;
    if (state.busy) return;
    if (!state.revealed) reveal();
    else if (!moved || Math.abs(dx) > 70) dismiss(dx >= 0 ? 1 : -1);
    else { const c = current(); c.style.translate = ''; c.style.rotate = ''; }
  };
  // наклон телефона — тоже переливает голограмму
  window.addEventListener('deviceorientation', onTiltDevice);
}
function onTiltDevice(e) {
  if (!state?.revealed) return;
  const c = current();
  if (!c || e.gamma == null) return;
  const x = Math.max(-1, Math.min(1, e.gamma / 30)), y = Math.max(-1, Math.min(1, (e.beta - 40) / 30));
  setTilt(c, x, y);
}
const current = () => (state ? $(`#po-stack .pcard[data-k="${Math.max(state.i, 0)}"]`) : null);
function tilt(card, e) {
  const r = card.getBoundingClientRect();
  setTilt(card, ((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
}
function setTilt(card, x, y) {
  const inner = card.querySelector('.pcard-in');
  inner.style.setProperty('--rx', `${-y * 12}deg`);
  inner.style.setProperty('--ry', `${180 + x * 14}deg`);
  inner.style.setProperty('--mx', `${50 + x * 50}%`);
  inner.style.setProperty('--my', `${50 + y * 50}%`);
}

function updateCount() {
  const n = state.cards.length - Math.max(state.i + (state.revealed ? 1 : 0), 0);
  $('#po-count').textContent = n ? t('packs.left', { n }) : '';
}

async function reveal() {
  if (state.i < 0) state.i = 0;
  const k = state.i, c = state.cards[k], el = current(), rank = RANK[c.tier];
  state.busy = true;
  const last = k === state.cards.length - 1;
  // дорогая карта «заряжается»: свечение цвета редкости, дрожь — и только потом переворот
  if (rank >= 3 || (last && state.god)) {
    el.classList.add('charge', `glow-${c.tier}`);
    SFX.charge(); buzz([20, 60, 20]);
    await wait(rank >= 5 ? 1300 : 900);
  }
  el.classList.add('flip');
  SFX.flip();
  if (rank >= 2) el.classList.add('special');
  await wait(380);
  if (rank >= 3) {
    burst(c.tier, rank);
    SFX.rare(rank); buzz(rank >= 5 ? [40, 40, 80] : 40);
  }
  if (last && state.god) showBanner(t('packs.god'));
  priceTag(el, k);
  state.revealed = true;
  state.busy = false;
  updateCount();
  if (k === 0) $('#po-hint').innerHTML = t('packs.next');
}
async function priceTag(el, k) {
  const c = state.cards[k];
  el.insertAdjacentHTML('beforeend', `<div class="ptag"><b>${esc(c.name)}</b><span class="tier-chip t-${c.tier}">${esc(c.reverse ? 'Reverse Holo' : TIER_NAME[c.tier])}</span><em>…</em></div>`);
  const p = await state.prices[k];
  const em = el.querySelector('.ptag em');
  if (em) em.textContent = p ? fmtPrice(p) : '—';
}
function dismiss(dir) {
  const el = current();
  el.classList.add('gone'); el.style.setProperty('--dir', dir);
  el.style.translate = ''; el.style.rotate = '';
  SFX.whoosh();
  state.revealed = false;
  if (state.i >= state.cards.length - 1) { setTimeout(summary, 350); return; }
  state.i++;
  updateCount();
  setTimeout(() => el.remove(), 500);
}

function burst(tier, rank) {
  const stage = $('#po-stage');
  const b = document.createElement('div');
  b.className = `burst-fx glow-${tier}`;
  b.innerHTML = `<div class="rays"></div>${Array.from({ length: 14 + rank * 6 }, () => {
    const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 140;
    return `<i style="--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--s:${0.5 + Math.random()};--d:${Math.random() * 0.25}s"></i>`;
  }).join('')}`;
  stage.prepend(b);
  setTimeout(() => b.remove(), 2600);
}
function showBanner(text) {
  const b = document.createElement('div');
  b.className = 'po-banner';
  b.textContent = text;
  $('#pack-open').append(b);
  setTimeout(() => b.remove(), 2400);
}

// ---------- итог ----------
async function summary() {
  window.removeEventListener('deviceorientation', onTiltDevice);
  const stage = $('#po-stage');
  stage.onpointerdown = stage.onpointermove = stage.onpointerup = null;
  $('#po-hint').classList.add('gone');
  $('#po-count').textContent = '';
  const prices = await Promise.all(state.prices);
  const cur = ctx.cur();
  const vals = prices.map((p) => (p ? toCurrency(p, cur) : 0));
  const total = vals.reduce((a, b) => a + b, 0);
  const best = vals.indexOf(Math.max(...vals));
  const fmt = (v) => fmtPrice({ value: v, currency: cur });
  stage.innerHTML = `
    <div class="po-sum">
      <div class="sum-head"><span>${t('packs.total')}</span><b>${fmt(total)}</b></div>
      <div class="sum-grid">${state.cards.map((c, k) => `
        <button class="sum-card tier-${c.tier} ${k === best ? 'best' : ''}" data-k="${k}" style="--k:${k}">
          <img src="${img(state.p, c.localId, 'low')}" alt="">
          ${k === best && vals[k] ? `<span class="best-tag">${t('packs.best')}</span>` : ''}
          <em>${prices[k] ? fmtPrice(prices[k]) : '—'}</em>
        </button>`).join('')}</div>
      <div class="sum-acts">
        <button class="btn wide" id="po-add">${t('packs.addAll')}</button>
        <div class="row"><button class="btn ghost" id="po-again">${t('packs.again')}</button><button class="btn ghost" id="po-choose">${t('packs.choose')}</button></div>
      </div>
    </div>`;
  if (total > 0) SFX.rare(1);
  stage.querySelectorAll('.sum-card').forEach((b) => (b.onclick = () => {
    const c = state.cards[+b.dataset.k];
    ctx.openCard?.({ id: c.id, lang: 'en', name: c.name, localId: c.localId, image: `${state.p.img}/${c.localId}` });
  }));
  $('#po-add').onclick = (e) => {
    const setName = state.p.name;
    state.cards.forEach((c, k) => store.add({
      id: c.id, lang: 'en', name: c.name, localId: c.localId, setName, image: `${state.p.img}/${c.localId}`,
      variant: variantOf(c), price: prices[k] || null,
    }));
    ctx.toast(t('packs.added', { n: state.cards.length }));
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = `✓ ${t('packs.added', { n: state.cards.length })}`;
  };
  $('#po-again').onclick = () => openPack(state.p);
  $('#po-choose').onclick = closePack;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

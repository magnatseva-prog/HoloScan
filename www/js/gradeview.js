// Экран «Оценка»: советы по съёмке, история оценок и экран результата.
// Сама оценка — grade.js; снимок делает сканер в режиме оценки (app.js).
import { t } from './i18n.js';
import { imgUrl, fmtPrice } from './api.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KEY = 'holoscan.grades.v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v.slice(0, 30))); } catch {} };

let ctx;
export function initGradeView(c) { ctx = c; }

const color = (g) => (g >= 9 ? 'var(--green)' : g >= 7 ? 'var(--gold)' : 'var(--red)');
const badge = (g, big) => `<div class="grade-badge${big ? ' big' : ''}" style="--g:${color(g ?? 0)}">${g ?? '—'}</div>`;

export function renderGradeView() {
  $('#grade-tips').innerHTML = ['grade.tip1', 'grade.tip2', 'grade.tip3', 'grade.tip4'].map((k) => `<li>${t(k)}</li>`).join('');
  const list = read();
  $('#grade-hist-h').hidden = !list.length;
  $('#grade-hist').innerHTML = list.map((g, k) => `
    <button class="prow grow" data-k="${k}"><img src="${g.thumb}" alt="">
      <div class="info"><div class="nm">${esc(g.name || t('grade.unknown'))}</div><div class="meta">${new Date(g.at).toLocaleDateString()}</div></div>
      ${badge(g.result.overall)}</button>`).join('');
  $('#grade-hist').querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => {
    const g = read()[+b.dataset.k];
    showGrade(g.result, g.card, g.thumb, false);
  }));
}

function row(label, value, g, note = '') {
  return `<div class="grow-row"><div><b>${label}</b><small>${value}</small>${note ? `<small class="muted">${note}</small>` : ''}</div>${badge(g)}</div>`;
}

// result — из gradeCard; card — узнанная карта (или null)
export function showGrade(result, card, image, save = true) {
  if (!result.ok) {
    ctx.openPanel(t('grade.title'), '', (body) => {
      body.innerHTML = `<p class="empty">${t(result.reason === 'bg' ? 'grade.errBg' : 'grade.errFrame')}</p>
        <button class="btn wide" id="g-again">${t('grade.again')}</button>`;
      $('#g-again').onclick = () => ctx.shootGrade();
    });
    return;
  }
  // в историю — без большой картинки, только миниатюра (хранилище телефона не резиновое)
  if (save) write([{ at: Date.now(), result: { ...result, image: undefined, debug: undefined }, thumb: result.thumb, card, name: card?.name || '' }, ...read()]);
  const c = result.centering, cor = result.corners, edg = result.edges;
  ctx.openPanel(t('grade.title'), '', (body) => {
    body.innerHTML = `
      <div class="grade-top">${badge(result.overall, true)}<div>
        <h2>${result.overall ? t('grade.estimate', { g: result.overall }) : t('grade.noEstimate')}</h2>
        <p class="note">${t('grade.disclaimer')}</p></div></div>
      ${card ? `<button class="grade-card" id="g-card"><img src="${imgUrl(card)}" alt=""><span><b>${esc(card.name)} #${esc(card.localId)}</b><small id="g-price">…</small></span></button>` : ''}
      <img class="grade-img" src="${result.image || image}" alt="">
      <p class="note center">${t('grade.legend')}</p>
      <div class="grow-list">
        ${row(t('grade.centering'), c ? `${t('grade.lr')} ${c.lr[0]}/${c.lr[1]}${c.tb ? ` · ${t('grade.tb')} ${c.tb[0]}/${c.tb[1]}` : ''}` : t('grade.na'), c?.grade, c && !c.tb ? t('grade.tbNa') : !c ? t('grade.fullArt') : '')}
        ${row(t('grade.corners'), cor ? cor.each.map((v) => `${v}%`).join(' · ') : t('grade.na'), cor?.grade, !cor ? t(result.lightBorder ? 'grade.light' : 'grade.noRef') : t('grade.wearNote'))}
        ${row(t('grade.edges'), edg ? edg.each.map((v) => `${v}%`).join(' · ') : t('grade.na'), edg?.grade, !edg ? t(result.lightBorder ? 'grade.light' : 'grade.noRef') : '')}
        <div class="grow-row"><div><b>${t('grade.surface')}</b><small>${t('grade.surfaceNote')}</small></div>${badge(null)}</div>
      </div>
      ${!result.withRef ? `<p class="note">${t('grade.noRefNote')}</p>` : ''}
      <button class="btn ghost wide" id="g-again">${t('grade.again')}</button>`;
    $('#g-again').onclick = () => ctx.shootGrade();
    if (card) {
      $('#g-card').onclick = () => ctx.openCard({ card });
      ctx.tilePrice(card).then((p) => { const el = $('#g-price'); if (el) el.textContent = `${t('grade.raw')}: ${fmtPrice(p)}`; });
    }
  });
  renderGradeView();
}

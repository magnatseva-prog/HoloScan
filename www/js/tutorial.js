// Обучение при первом запуске: 5 экранов. Повторить можно из настроек.
import { t, setLang, UI_LANGS } from './i18n.js';
import { settings, saveSettings } from './store.js';
import { CARD_LANGS } from './api.js';
import { FREE_SCANS } from './billing.js';

const $ = (s) => document.querySelector(s);
const QUICK_LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja'];

// картинки экранов — из CSS, без внешних файлов
const ART = {
  hello: '<div class="tut-art hello"><div class="tut-card c1"></div><div class="tut-card c2"></div><div class="tut-card c3"></div><div class="tut-price">$12.40</div></div>',
  frame: '<div class="tut-art frame"><div class="tut-phone"><div class="tut-guide"><div class="tut-card in"></div></div><div class="tut-shutter"></div></div></div>',
  tips: '<div class="tut-art tips"><div class="tut-tip ok"><div class="tut-card sm"></div><b>✓</b></div><div class="tut-tip bad"><div class="tut-card sm glare"></div><b>✕</b></div><div class="tut-tip bad"><div class="tut-card sm tilt"></div><b>✕</b></div></div>',
  coll: '<div class="tut-art coll"><div class="tut-row"><div class="tut-card xs"></div><span></span><b>$4.83</b></div><div class="tut-row"><div class="tut-card xs c2"></div><span></span><b>$0.14</b></div><div class="tut-row"><div class="tut-card xs c3"></div><span></span><b>$21.90</b></div></div>',
};

let step = 0, onDone = null;

function slides() {
  return [
    {
      art: ART.hello, title: t('tut.1t'), text: t('tut.1d'),
      extra: `<div class="tut-langs ui">${Object.entries(UI_LANGS).map(([k, v]) => `<button data-ui="${k}" class="${settings.uiLang === k ? 'sel' : ''}">${v}</button>`).join('')}</div>`,
    },
    { art: ART.frame, title: t('tut.2t'), text: t('tut.2d') },
    { art: ART.tips, title: t('tut.3t'), text: t('tut.3d') },
    {
      art: `<div class="tut-langs">${QUICK_LANGS.map((l) => `<button data-l="${l}" class="${settings.cardLang === l ? 'sel' : ''}">${CARD_LANGS[l]}</button>`).join('')}</div>`,
      title: t('tut.4t'), text: t('tut.4d'),
    },
    { art: ART.coll, title: t('tut.5t'), text: t('tut.5d', { n: FREE_SCANS }) },
  ];
}

function render() {
  const all = slides(), s = all[step], last = step === all.length - 1;
  $('#tutorial').innerHTML = `
    <button class="tut-skip" id="tut-skip">${last ? '' : t('tut.skip')}</button>
    <div class="tut-body">${s.art}<h2>${s.title}</h2><p>${s.text}</p>${s.extra || ''}</div>
    <div class="tut-dots">${all.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
    <button class="btn wide" id="tut-next">${last ? t('tut.start') : t('tut.next')}</button>`;
  $('#tut-next').onclick = () => (last ? close() : (step++, render()));
  $('#tut-skip').onclick = close;
  $('#tutorial').querySelectorAll('[data-ui]').forEach((b) => (b.onclick = () => {
    settings.uiLang = b.dataset.ui;
    saveSettings();
    setLang(b.dataset.ui);
    render();
  }));
  $('#tutorial').querySelectorAll('[data-l]').forEach((b) => (b.onclick = () => {
    settings.cardLang = b.dataset.l;
    saveSettings();
    render();
  }));
}

function close() {
  $('#tutorial').hidden = true;
  settings.tutorialDone = true;
  saveSettings();
  onDone?.();
}

export const isOpen = () => !$('#tutorial').hidden;
export function back() {
  if (step > 0) { step--; render(); } else close();
}

// done — что сделать после (например, перезагрузить каталог, если сменили язык карт)
export function showTutorial(done) {
  step = 0;
  onDone = done;
  $('#tutorial').hidden = false;
  render();
}

// Скриншоты приложения для README: node tools/screenshots.mjs
// Запускает локальный сервер, открывает приложение в установленном Edge (мобильный экран),
// проходит по экранам и сохраняет PNG в docs/screenshots. Коллекция — демо (реальные карты и цены,
// история стоимости дорисована, чтобы был виден график).
import { spawn } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const OUT0 = `${ROOT}docs/screenshots`;
const PORT = 5318, URL0 = `http://localhost:${PORT}/`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

cpSync(`${ROOT}tools/testimg`, `${ROOT}www/test`, { recursive: true });
cpSync(`${ROOT}tools/testset`, `${ROOT}www/test`, { recursive: true });
const server = spawn('python', ['-m', 'http.server', String(PORT), '--directory', `${ROOT}www`], { stdio: 'ignore' });
await sleep(1500);

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-first-run', '--disable-extensions'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('pageerror', e.message));

const imgsLoaded = () => page.waitForFunction(() => [...document.images].filter((i) => i.offsetParent).every((i) => i.complete), { timeout: 30000 }).catch(() => {});
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);

// демо-коллекция: те же карты в версии на языке скриншотов; цены настоящие, история дорисована
const INTL = ['sv03.5-006', 'sv08-238', 'swsh12-186', 'sv02-244', 'sv06-130', 'sv01-039'];
const JA = ['SV2a-201', 'SV2a-025', 'S12-110', 'SV2a-006', 'SV6-081', 'SV2a-151'];
const LANGS = {
  en: { card: 'en', cur: 'USD' }, ru: { card: 'en', cur: 'USD' }, ja: { card: 'ja', cur: 'EUR', ids: JA },
  es: { card: 'es', cur: 'EUR' }, fr: { card: 'fr', cur: 'EUR' }, de: { card: 'de', cur: 'EUR' },
  it: { card: 'it', cur: 'EUR' }, pt: { card: 'pt', cur: 'EUR' },
};
const api = (l, id) => fetch(`https://api.tcgdex.net/v2/${l}/cards/${id}`).then((r) => r.json()).catch(() => null);
const day = (k) => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
const FX = 1.1;

async function demoFor({ card, cur, ids = INTL }) {
  const items = [];
  for (const [k, id] of ids.entries()) {
    const d = await api(card, id), en = card === 'ja' ? null : await api('en', id);
    const tp = en?.pricing?.tcgplayer;
    const usd = tp && (tp.holofoil?.marketPrice || tp.normal?.marketPrice || tp['reverse-holofoil']?.marketPrice);
    const eur = d?.pricing?.cardmarket?.trend || d?.pricing?.cardmarket?.avg || (usd ? usd / FX : 1);
    const value = +(cur === 'USD' ? usd || eur * FX : eur).toFixed(2);
    items.push({
      uid: `demo${k}`, id, lang: card, name: d.name, localId: d.localId, setName: d.set.name,
      variant: d.variants?.holo ? 'holo' : 'normal', qty: k === 5 ? 3 : 1, image: d.image,
      price: { value, currency: cur, src: cur === 'USD' ? 'TCGplayer' : 'Cardmarket' },
      hist: [[day(8), +(value * [0.86, 1.12, 0.95, 0.9, 1.04, 1.3][k]).toFixed(2)], [day(0), value]],
    });
  }
  const total = items.reduce((s, i) => s + i.price.value * i.qty, 0);
  const history = [...Array(30)].map((_, k) => {
    const v = +(total * (0.82 + 0.18 * (k / 29) + 0.03 * Math.sin(k / 2.3))).toFixed(2);
    return { d: day(29 - k), USD: cur === 'USD' ? v : +(v * FX).toFixed(2), EUR: cur === 'EUR' ? v : +(v / FX).toFixed(2) };
  });
  return { items, data: { 'holoscan.collection.v1': items, 'holoscan.history.v1': history } };
}

async function fresh(settings, data = {}) {
  await page.goto(URL0, { waitUntil: 'domcontentloaded' });
  await page.evaluate((st, dt) => {
    localStorage.clear();
    localStorage.setItem('holoscan.settings.v1', JSON.stringify(st));
    localStorage.setItem('holoscan.pricesAt', String(Date.now()));
    for (const [k, v] of Object.entries(dt)) localStorage.setItem(k, JSON.stringify(v));
  }, settings, data);
  await page.goto(URL0, { waitUntil: 'networkidle2' });
  await sleep(2500);
}

const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LANGS);
for (const L of want) {
const cfg = LANGS[L];
const { items, data: demoData } = await demoFor(cfg);
const OUT = `${OUT0}/${L}`;
mkdirSync(OUT, { recursive: true });
const shot = async (name) => { await sleep(600); await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 86 }); console.log('✓', L, name); };
const base = { tutorialDone: true, uiLang: L, cardLang: cfg.card, currency: cfg.cur, firstFind: true };
let scanSrc = '/test/es__sv02-244.png';
if (!['en', 'ru', 'es'].includes(L)) {
  const buf = Buffer.from(await (await fetch(`${items[3].image}/high.png`)).arrayBuffer());
  writeFileSync(`${ROOT}www/test/scan_${L}.png`, buf); scanSrc = `/test/scan_${L}.png`;
}

// 1. обучение
await fresh({ uiLang: L, cardLang: cfg.card, currency: cfg.cur });
await shot('01-welcome');

// 2. каталог
await fresh(base, demoData);
await imgsLoaded();
await shot('02-catalog');

// 3. скан: фото карты на деревянном столе через «галерею»
await click('.scan-tab');
await sleep(800);
await page.evaluate(async (src) => {
  const im = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
  const W = 900, H = 1257, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const wood = g.createLinearGradient(0, 0, W, H); wood.addColorStop(0, '#6b4a2f'); wood.addColorStop(1, '#8a6240');
  g.fillStyle = wood; g.fillRect(0, 0, W, H);
  g.translate(W / 2, H / 2); g.rotate(-0.03); g.filter = 'brightness(0.95)';
  const cw = W * 0.86; g.drawImage(im, -cw / 2, -cw * im.height / im.width / 2, cw, cw * im.height / im.width);
  const blob = await (await fetch(c.toDataURL('image/jpeg', 0.9))).blob();
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'card.jpg', { type: 'image/jpeg' }));
  const inp = document.querySelector('#gallery'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
}, scanSrc);
await page.waitForFunction(() => document.querySelector('.titem .pr'), { timeout: 60000 });
await click('.titem');
await sleep(3000);
await imgsLoaded();
await shot('03-scan-result');

// 4. коллекция: график, лидеры изменений
await fresh(base, demoData);
await click('.tabs [data-go=portfolio]');
await sleep(1500);
await imgsLoaded();
await shot('04-collection');

// 5. карта: цены и динамика
await page.evaluate(() => document.querySelector('#plist .prow .info').click());
await sleep(3500);
await page.evaluate(() => document.querySelector('.title-row').scrollIntoView({ block: 'start' }));
await shot('05-card-prices');

// 6. сеты с прогрессом
await fresh(base, demoData);
await page.evaluate(() => document.querySelector('#cat-seg [data-seg=sets]').click());
await sleep(2000);
await page.evaluate(() => document.querySelector('.setrow').click());
await sleep(5000);
await imgsLoaded();
await shot('06-set-progress');

// 7. запечатанные товары
await page.evaluate(() => document.querySelector('#panel-close').click());
await page.evaluate(() => document.querySelector('#cat-seg [data-seg=sealed]').click());
await sleep(2500);
await imgsLoaded();
await shot('07-sealed');

// 8. AI-оценка: карта на тёмном фоне, чуть смещённая центровка
await fresh(base, demoData);
await click('.tabs [data-go=grade]');
await sleep(500);
await page.evaluate(async () => {
  const im = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = '/test/es__bw6-7.png'; });
  const cw = 700, ch = Math.round(700 * im.height / im.width);
  const card = document.createElement('canvas'); card.width = cw; card.height = ch;
  const cg = card.getContext('2d'); cg.drawImage(im, 0, 0, cw, ch);
  const tmp = document.createElement('canvas'); tmp.width = cw; tmp.height = ch; tmp.getContext('2d').drawImage(card, 0, 0);
  const p = cg.getImageData(Math.round(cw * 0.02), Math.round(ch * 0.5), 1, 1).data, b = cw * 0.04;
  cg.save(); cg.beginPath(); cg.rect(b, b, cw - 2 * b, ch - 2 * b); cg.clip();
  cg.fillStyle = `rgb(${p[0]},${p[1]},${p[2]})`; cg.fillRect(0, 0, cw, ch);
  cg.drawImage(tmp, b, b, cw - 2 * b, ch - 2 * b, b + 0.01 * cw, b, cw - 2 * b, ch - 2 * b); cg.restore();
  const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
  const g = c.getContext('2d'); g.fillStyle = '#1b1e24'; g.fillRect(0, 0, 900, 1200); g.drawImage(card, 100, (1200 - ch) / 2);
  const blob = await (await fetch(c.toDataURL('image/jpeg', 0.92))).blob();
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'g.jpg', { type: 'image/jpeg' }));
  const inp = document.querySelector('#grade-gallery'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
});
await page.waitForFunction(() => document.querySelector('.grade-top'), { timeout: 60000 });
await sleep(2500);
await shot('08-grading');
await page.evaluate(() => document.querySelector('.grow-list').scrollIntoView({ block: 'center' }));
await shot('09-grading-details');

// 10. калькулятор обмена
await fresh(base, demoData);
await click('#trade-btn');
await sleep(500);
for (const [side, pick] of [['give', 0], ['give', 4], ['get', 2]]) {
  await page.evaluate((s) => document.querySelector(`[data-add=${s}]`).click(), side);
  await sleep(600);
  await page.evaluate((k) => document.querySelectorAll('#t-res [data-k]')[k].click(), pick);
  await sleep(1200);
}
await imgsLoaded();
await shot('10-trade');
}

await browser.close();
server.kill();
rmSync(`${ROOT}www/test`, { recursive: true, force: true });
console.log('готово');

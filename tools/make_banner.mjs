// Баннер для README: node tools/make_banner.mjs → docs/banner.png (1600×820).
// Рисуется как HTML в headless Edge, чтобы шрифты и стиль были те же, что в приложении.
// Скриншоты берёт из docs/screenshots/en (их снимает tools/screenshots.mjs).
import { writeFileSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const shot = (n) => `../docs/screenshots/en/${n}.jpg`;
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../www/css/app.css">
<style>
  body { margin: 0; width: 1600px; height: 820px; overflow: hidden; background: var(--bg); position: relative; }
  .dots { position: absolute; inset: 0; background-image: radial-gradient(#17130e1f 1.6px, transparent 1.6px); background-size: 26px 26px; }
  .left { position: absolute; left: 96px; top: 140px; width: 700px; }
  .logo { font-size: 86px; gap: 26px; letter-spacing: -3px; }
  .logo-mark { width: 62px; height: 84px; border-width: 4px; border-radius: 12px; box-shadow: 14px -8px 0 -4px var(--sun), 14px -8px 0 0 var(--ink); }
  h1 { font: 800 50px/1.12 var(--display); letter-spacing: -1.5px; margin: 40px 0 26px; }
  h1 mark { background: var(--sun); padding: 0 10px; border: 3px solid var(--ink); border-radius: 12px; box-shadow: 4px 4px 0 var(--ink); }
  ul { list-style: none; padding: 0; margin: 0; font: 600 25px/1.75 var(--body); color: #4d4231; }
  ul li::before { content: '✦ '; color: var(--blue); }
  .pills { display: flex; gap: 14px; margin-top: 36px; }
  .pills span { font: 800 24px/1 var(--display); padding: 14px 24px; border: 3px solid var(--ink); border-radius: 999px; box-shadow: 4px 4px 0 var(--ink); }
  .free { background: var(--mint); } .and { background: var(--blue); color: #fff; }
  .ph { position: absolute; width: 290px; border: 4px solid var(--ink); border-radius: 40px; padding: 10px; background: var(--ink); box-shadow: 10px 10px 0 var(--ink); }
  .ph img { width: 100%; display: block; border-radius: 30px; }
</style>
<div class="dots"></div>
<div class="left">
  <div class="logo"><span class="logo-mark"></span>HoloScan</div>
  <h1>Scan any Pokémon card.<br>See what it’s <mark>worth.</mark></h1>
  <ul><li>On-device AI recognition · 25,000+ cards</li><li>TCGplayer &amp; Cardmarket prices · 14 languages</li><li>AI grading · collection value tracker</li></ul>
  <div class="pills"><span class="free">100% free</span><span class="and">Android app</span></div>
</div>
<div class="ph" style="left:860px; top:110px; transform: rotate(-6deg)"><img src="${shot('04-collection')}"></div>
<div class="ph" style="left:1070px; top:60px; z-index:2"><img src="${shot('03-scan-result')}"></div>
<div class="ph" style="left:1280px; top:120px; transform: rotate(6deg)"><img src="${shot('08-grading')}"></div>`;
const tmp = `${ROOT}tools/_banner.html`;
writeFileSync(tmp, html);
const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--allow-file-access-from-files'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 820 });
await p.goto(`file:///${tmp}`, { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: `${ROOT}docs/banner.png` });
await b.close();
rmSync(tmp);
console.log('ok docs/banner.png');

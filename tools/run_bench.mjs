// Прогон стенда точности в headless Edge: node tools/run_bench.mjs [harsh] [--opts '{"x":1}']
// Копирует tools/testset в www/test, запускает bench.run() и печатает итог и медленные/ошибочные карты.
import { spawn } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const harsh = process.argv.includes('harsh');
const opts = JSON.parse(process.argv.find((a) => a.startsWith('{')) || '{}');
const PORT = 5320;
cpSync(`${ROOT}tools/testset`, `${ROOT}www/test`, { recursive: true });
const server = spawn('python', ['-m', 'http.server', String(PORT), '--directory', `${ROOT}www`], { stdio: 'ignore' });
await sleep(1200);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', protocolTimeout: 1800000 });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await p.evaluate(() => { localStorage.setItem('holoscan.settings.v1', JSON.stringify({ tutorialDone: true, uiLang: 'en', cardLang: 'en', firstFind: true })); });
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle2' });
await sleep(1500);
const summary = await p.evaluate((h, o) => import('/test/bench.js').then((m) => m.run({ harsh: h, opts: o })), harsh, opts);
const rows = await p.evaluate(() => window.__bench.rows);
for (const r of rows) if (r[2] !== 'OK') console.log(r.slice(0, 7).join(' | '), JSON.stringify(r[7]), JSON.stringify(r[8]));
const fast = rows.filter((r) => r[4] === 'fast');
console.log('быстрый путь:', fast.length, 'из', rows.length, ', ошибок в нём:', fast.filter((r) => r[2] !== 'OK').length);

const ms = rows.map((r) => r[1]).sort((a, b) => a - b);
console.log('медиана', ms[ms.length >> 1], 'мс; p90', ms[Math.floor(ms.length * 0.9)], 'мс');
console.log(summary);
await b.close(); server.kill();
rmSync(`${ROOT}www/test`, { recursive: true, force: true }); // не запускать одновременно с tools/screenshots.mjs

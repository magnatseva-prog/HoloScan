// Стенд точности: из чистых картинок карт делает «фото» и прогоняет recognize().
// Запуск в странице приложения: await import('/test/bench.js').then(m => m.run())
// Результат копится в window.__bench (прогон долгий, читать частями).
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function load(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

export function photo(im, r, W = 760) {
  const H = Math.round(W * 88 / 63);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bgs = ['#8a6a48', '#3a3a3a', '#c9c2b8', '#2c3e50', '#6b4f3a'];
  g.fillStyle = bgs[Math.floor(r() * bgs.length)];
  g.fillRect(0, 0, W, H);
  g.save();
  g.translate(W / 2 + (r() - 0.5) * W * 0.04, H / 2 + (r() - 0.5) * H * 0.04);
  g.rotate((r() - 0.5) * 0.12);
  g.filter = `blur(${(0.4 + r() * 1.1).toFixed(2)}px) brightness(${(0.8 + r() * 0.3).toFixed(2)})`;
  const cw = W * (0.84 + r() * 0.13);
  g.drawImage(im, -cw / 2, -cw * im.height / im.width / 2, cw, cw * im.height / im.width);
  g.restore();
  // блик
  const gx = r() * W, gy = r() * H;
  const gr = g.createRadialGradient(gx, gy, 0, gx, gy, W * 0.3);
  gr.addColorStop(0, `rgba(255,255,255,${(r() * 0.35).toFixed(2)})`);
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  return c;
}

export async function run({ filter = () => true, opts = {}, harsh = false } = {}) {
  const { recognize, warmUp } = await import(`/js/recognize.js`);
  await warmUp();
  const clean = await fetch('/test/list.json').then((x) => x.json());
  // harsh: готовые «жёсткие» снимки из tools/testset/harsh (блик, топлоадер, перспектива, JPEG)
  const langOf = Object.fromEntries(clean.map((f) => f.replace('.png', '').split('__').reverse()));
  const list = (harsh ? await fetch('/test/harsh/list.json').then((x) => x.json()) : clean).filter(filter);
  const out = window.__bench = { done: false, ok: 0, top3: 0, n: 0, ms: 0, sure: 0, sureWrong: 0, rows: [] };
  for (const f of list) {
    let lang, id, c;
    if (harsh) {
      id = f.replace('.jpg', '').split('__')[1];
      lang = langOf[id] || 'es';
      const im = await load(`/test/harsh/${f}`);
      c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      c.getContext('2d').drawImage(im, 0, 0);
    } else {
      [lang, id] = f.replace('.png', '').split('__');
      const r = rng([...f].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0);
      c = photo(await load(`/test/${f}`), r);
    }
    const t = performance.now();
    let res;
    const dbg = {};
    try { res = await recognize(c, () => {}, { lang, debug: dbg, ...opts }); } catch (e) { res = { candidates: [], err: String(e) }; }
    const ms = performance.now() - t;
    const ids = res.candidates.map((x) => x.id);
    const hit = ids[0] === id, in3 = ids.slice(0, 3).includes(id);
    out.n++; out.ms += ms; out.ok += hit; out.top3 += in3;
    if (res.sure) { out.sure++; out.sureWrong += !hit; }
    out.rows.push([f, Math.round(ms), hit ? 'OK' : in3 ? 'top3' : 'MISS', ids[0] || '—', res.sure ? 'sure' : '?', res.name || '', res.number?.raw || '', dbg.scores]);
  }
  out.done = true;
  out.summary = `${out.ok}/${out.n} точно, ${out.top3}/${out.n} в первой тройке, ${Math.round(out.ms / out.n)} мс; уверенных ${out.sure}, из них неверных ${out.sureWrong}`;
  return out.summary;
}

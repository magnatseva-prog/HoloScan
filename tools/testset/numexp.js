// Эксперимент: как надёжнее читать номер карты «039/198» на жёстких снимках.
// Запуск: await import('/test/numexp.js').then((m) => m.run())
const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });

function crop(src, x, y, w, h, scale, mode) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  let min = 255, max = 0;
  for (let i = 0; i < p.length; i += 4) { const v = p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11; p[i] = v; if (v < min) min = v; if (v > max) max = v; }
  const k = 255 / Math.max(40, max - min);
  // mode 'bin' — порог Оцу-подобный: среднее значение
  let mean = 0; for (let i = 0; i < p.length; i += 4) mean += p[i]; mean /= p.length / 4;
  for (let i = 0; i < p.length; i += 4) {
    let v = (p[i] - min) * k;
    if (mode === 'bin') v = p[i] < mean - 10 ? 0 : 255;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  return c;
}

const RE = /([A-Z]{0,3}\d{1,3})\s*\/\s*([A-Z]{0,3}\d{2,3})/;

export async function run() {
  const { _debug } = await import('/js/recognize.js');
  const list = await fetch('/test/harsh/list.json').then((r) => r.json());
  const mk = async (psm, white) => {
    const w = await Tesseract.createWorker('eng', 1, { workerPath: 'vendor/worker.min.js', corePath: 'vendor/core', langPath: 'vendor/lang', workerBlobURL: false, gzip: false, cacheMethod: 'none' });
    await w.setParameters({ tessedit_pageseg_mode: psm, ...(white ? { tessedit_char_whitelist: white } : {}) });
    return w;
  };
  const free = await mk('11'), dig = await mk('11', '0123456789/'), dig6 = await mk('6', '0123456789/');
  const half = (w, c, side, y0, scale = 4) => w.recognize(crop(c, side ? c.width * 0.45 : 0, c.height * y0, c.width * 0.55, c.height * (1 - y0), scale)).then((r) => r.data.text);
  const strat = {
    wide4: async (c) => `${await half(dig, c, 0, 0.78)}
${await half(dig, c, 1, 0.78)}`,
    wide3: async (c) => `${await half(dig, c, 0, 0.8, 3)}
${await half(dig, c, 1, 0.8, 3)}`,
    wide4free: async (c) => `${await half(free, c, 0, 0.78)}
${await half(free, c, 1, 0.78)}`,
    base: async (c) => (await free.recognize(crop(c, 0, c.height * 0.86, c.width, c.height * 0.14, 2000 / c.width))).data.text,
    halvesDig: async (c) => {
      const L = (await dig.recognize(crop(c, 0, c.height * 0.88, c.width * 0.5, c.height * 0.12, 1400 / (c.width * 0.5)))).data.text;
      const R = (await dig.recognize(crop(c, c.width * 0.5, c.height * 0.88, c.width * 0.5, c.height * 0.12, 1400 / (c.width * 0.5)))).data.text;
      return `${L}\n${R}`;
    },
    halvesDig6: async (c) => {
      const L = (await dig6.recognize(crop(c, 0, c.height * 0.89, c.width * 0.45, c.height * 0.1, 1400 / (c.width * 0.45)))).data.text;
      const R = (await dig6.recognize(crop(c, c.width * 0.55, c.height * 0.89, c.width * 0.45, c.height * 0.1, 1400 / (c.width * 0.45)))).data.text;
      return `${L}\n${R}`;
    },
    halvesBin: async (c) => {
      const L = (await dig.recognize(crop(c, 0, c.height * 0.88, c.width * 0.5, c.height * 0.12, 1400 / (c.width * 0.5), 'bin'))).data.text;
      const R = (await dig.recognize(crop(c, c.width * 0.5, c.height * 0.88, c.width * 0.5, c.height * 0.12, 1400 / (c.width * 0.5), 'bin'))).data.text;
      return `${L}\n${R}`;
    },
  };
  const score = Object.fromEntries(Object.keys(strat).map((k) => [k, { ok: 0, any: 0 }]));
  const out = window.__num = { done: false, n: 0, score, rows: [] };
  for (const f of list) {
    const id = f.replace('.jpg', '').split('__')[1];
    const want = parseInt(id.slice(id.lastIndexOf('-') + 1).replace(/^[A-Z]+/i, ''), 10);
    const im = await load(`/test/harsh/${f}`);
    let c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0);
    c = _debug.findCard(c);
    const row = [f];
    for (const [k, fn] of Object.entries(strat)) {
      const txt = await fn(c);
      const m = txt.replace(/[\\|]/g, '/').match(RE);
      const got = m ? parseInt(m[1].replace(/^[A-Z]+/, ''), 10) : null;
      if (m) score[k].any++;
      if (got === want) score[k].ok++;
      row.push(`${k}:${m ? m[0] : '-'}`);
    }
    out.rows.push(row.join(' '));
    out.n++;
  }
  out.done = true;
  return score;
}

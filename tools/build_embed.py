"""Нейросетевые «отпечатки» всех карт для офлайн-распознавания в приложении.

Модель — MobileNetV2 без последних слоёв (tools/models/mnv2_map.onnx, она же в www/models):
отдаёт карту признаков 1280×7×7. Сворачиваем её сеткой 2×2 (четыре перекрывающихся окна 4×4)
→ вектор 5120: так сохраняется, где что на карте, и похожие карты различаются лучше
(на тесте +2% против простого среднего).
Для каждой карты два вектора: вся карта (без 5% по краям) и область рисунка.
Векторы сжимаются PCA до DIM измерений и в int8.

Выход:
  www/data/emb.bin   — int8, на карту 2×DIM байт (сначала вся карта, потом рисунок);
  www/data/emb.json  — {"dim", "feat", "ids": [...]};
  www/data/pca.bin   — float32: mu_w(F), P_w(DIM×F), mu_a(F), P_a(DIM×F), F = 5120.
Предобработка и свёртка должны совпадать с www/js/embed.js.
Повторный запуск считает только новые карты: PCA и готовые векторы лежат в %LOCALAPPDATA%/HoloScan.
"""
import io
import json
import os
import random
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'www' / 'data'
# кэш вне OneDrive: переписывается часто
CDIR = Path(os.environ.get('LOCALAPPDATA', ROOT / 'tools')) / 'HoloScan'
CACHE, PCA_CACHE = CDIR / 'embcache_grid.npz', CDIR / 'pca_grid.npz'
API = 'https://api.tcgdex.net/v2'
LANGS = ('en', 'es', 'fr', 'de', 'it', 'pt', 'es-mx', 'pt-br', 'id', 'ja', 'zh-tw', 'zh-cn', 'th', 'ko')
DIM = 256
FEAT = 5120
PCA_SAMPLE = 4000
ART = (0.08, 0.10, 0.92, 0.50)
INNER = 0.05
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)

sess = ort.InferenceSession(str(ROOT / 'tools' / 'models' / 'mnv2_map.onnx'))


def get(url, raw=False):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'HoloScan-embed-builder'})
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
            return data if raw else json.loads(data)
        except Exception:
            if attempt == 4:
                raise
            time.sleep(3 * (attempt + 1))


def crop(im, box):
    W, H = im.size
    return im.crop((int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H)))


def tensor(im):
    im = im.convert('RGB').resize((224, 224), Image.BILINEAR)
    return ((np.asarray(im, np.float32) / 255 - MEAN) / STD).transpose(2, 0, 1)


def views(data):
    im = Image.open(io.BytesIO(data)).convert('RGB')
    return tensor(crop(im, (INNER, INNER, 1 - INNER, 1 - INNER))), tensor(crop(im, ART))


def grid2(m):
    """N×1280×7×7 → N×5120: средние по окнам [0:4]×[0:4], [0:4]×[3:7], [3:7]×[0:4], [3:7]×[3:7]."""
    v = np.concatenate([m[:, :, :4, :4].mean((2, 3)), m[:, :, :4, 3:].mean((2, 3)),
                        m[:, :, 3:, :4].mean((2, 3)), m[:, :, 3:, 3:].mean((2, 3))], 1)
    return v / (np.linalg.norm(v, axis=1, keepdims=True) + 1e-9)


def run(batch):
    return grid2(sess.run(None, {'input': np.stack(batch)})[0])


def project(X, mu, P):
    Y = (X - mu) @ P.T
    return Y / (np.linalg.norm(Y, axis=1, keepdims=True) + 1e-9)


def main():
    pocket = {s['id'] for s in get(f'{API}/en/series/tcgp')['sets']}
    url = {}
    for lang in LANGS:  # английская картинка в приоритете
        for c in get(f'{API}/{lang}/cards'):
            if c.get('image') and c['id'] not in url and c['id'].rsplit('-', 1)[0] not in pocket:
                url[c['id']] = c['image']
    CDIR.mkdir(parents=True, exist_ok=True)

    def fetch(cid):
        try:
            return cid, views(get(f'{url[cid]}/low.webp', raw=True))
        except Exception:
            return cid, None

    def features(ids):
        """id → (вектор всей карты, вектор рисунка), по пачкам по 64"""
        out, bw, ba, bid = {}, [], [], []

        def flush():
            if bid:
                for cid, w, a in zip(bid, run(bw), run(ba)):
                    out[cid] = (w, a)
                bw.clear(); ba.clear(); bid.clear()
        with ThreadPoolExecutor(32) as ex:
            for k, (cid, v) in enumerate(ex.map(fetch, ids), 1):
                if v:
                    bid.append(cid); bw.append(v[0]); ba.append(v[1])
                if len(bid) >= 64:
                    flush()
                if k % 2000 == 0:
                    print(f'  {k}/{len(ids)}', flush=True)
        flush()
        return out

    # 1) базис PCA — по случайной выборке карт (один раз, потом переиспользуется)
    if PCA_CACHE.exists():
        z = np.load(PCA_CACHE)
        muW, PW, muA, PA = z['muW'], z['PW'], z['muA'], z['PA']
        sample = {}
    else:
        random.seed(7)
        print('PCA: считаю выборку', flush=True)
        sample = features(random.sample(list(url), min(PCA_SAMPLE, len(url))))
        W = np.stack([v[0] for v in sample.values()]); A = np.stack([v[1] for v in sample.values()])
        fit = lambda X: (X.mean(0), np.linalg.svd(X - X.mean(0), full_matrices=False)[2][:DIM])
        (muW, PW), (muA, PA) = fit(W), fit(A)
        np.savez(PCA_CACHE, muW=muW, PW=PW, muA=muA, PA=PA)

    # 2) все карты: сразу проецируем и храним только сжатые векторы
    have = {}
    if CACHE.exists():
        z = np.load(CACHE)
        have = {i: (w, a) for i, w, a in zip(z['ids'], z['w'], z['a'])}
    for cid, (w, a) in sample.items():
        have[cid] = (project(w[None], muW, PW)[0].astype(np.float16), project(a[None], muA, PA)[0].astype(np.float16))
    todo = [i for i in url if i not in have]
    print(f'карт: {len(url)}, новых: {len(todo)}', flush=True)

    def save():
        ids = list(have)
        tmp = CACHE.with_suffix('.tmp.npz')
        np.savez(tmp, ids=np.array(ids), w=np.stack([have[i][0] for i in ids]), a=np.stack([have[i][1] for i in ids]))
        os.replace(tmp, CACHE)

    for k in range(0, len(todo), 2000):
        part = features(todo[k:k + 2000])
        for cid, (w, a) in part.items():
            have[cid] = (project(w[None], muW, PW)[0].astype(np.float16), project(a[None], muA, PA)[0].astype(np.float16))
        save()
        print(f'{min(k + 2000, len(todo))}/{len(todo)}', flush=True)
    save()

    ids = sorted(i for i in have if i in url)
    q = lambda X: np.clip(np.round(X.astype(np.float32) * 254), -127, 127).astype(np.int8)  # компоненты почти всегда < 0.5
    Wq = q(np.stack([have[i][0] for i in ids])); Aq = q(np.stack([have[i][1] for i in ids]))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'emb.bin').write_bytes(np.concatenate([Wq, Aq], axis=1).tobytes())
    (OUT / 'emb.json').write_text(json.dumps({'dim': DIM, 'feat': FEAT, 'ids': ids}, separators=(',', ':')))
    (OUT / 'pca.bin').write_bytes(b''.join(x.astype(np.float32).tobytes() for x in (muW, PW, muA, PA)))
    print(f'готово: {len(ids)} карт, emb.bin {len(ids) * 2 * DIM / 1e6:.1f} МБ')


if __name__ == '__main__':
    sys.exit(main())

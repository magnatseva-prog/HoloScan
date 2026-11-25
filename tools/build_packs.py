"""Данные для открытия паков: www/data/packs.json.

Для основных сетов (Mega Evolution, Scarlet & Violet, Sword & Shield, Sun & Moon, XY, Black & White)
карты раскладываются по уровням редкости; для обложки пака берутся два цвета из логотипа сета
и рисунок самой редкой карты. Редкости — один запрос к TCGdex на каждую редкость.

Формат: {"packs": [{id, name, serie, logo, colors: [c1, c2], cover, img, tiers: {T: [[localId, name, holo]]}}]}
Уровни: C, U, R (rare / holo rare), DR (ex, V, VMAX, radiant…), UR (full art), IR, SIR, HR.
"""
import colorsys
import io
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'www' / 'data' / 'packs.json'
API = 'https://api.tcgdex.net/v2/en'
SERIES = ('me', 'sv', 'swsh', 'sm', 'xy', 'bw')
SKIP = {'mee', 'mep', 'svp', 'sve', 'mfb', 'swshp', 'fut2020', 'cel25cc', 'smp', 'det1', 'xyp', 'xy0', 'xya', 'dc1', 'bwp', 'dv1', 'rc', '30th-c'}
TIER = {
    'Common': 'C', 'Uncommon': 'U',
    'Rare': 'R', 'Rare Holo': 'R', 'Holo Rare': 'R', 'Rare PRIME': 'R', 'LEGEND': 'R', 'Rare Holo LV.X': 'R',
    'Double rare': 'DR', 'Holo Rare V': 'DR', 'Holo Rare VMAX': 'DR', 'Holo Rare VSTAR': 'DR', 'Radiant Rare': 'DR',
    'Amazing Rare': 'DR', 'ACE SPEC Rare': 'DR', 'Shiny rare': 'DR', 'Black White Rare': 'DR',
    'Ultra Rare': 'UR', 'Full Art Trainer': 'UR', 'Shiny Ultra Rare': 'UR', 'Shiny rare V': 'UR', 'Shiny rare VMAX': 'UR', 'Mega Attack Rare': 'UR',
    'Illustration rare': 'IR', 'Classic Collection': 'IR',
    'Special illustration rare': 'SIR', 'Secret Rare': 'SIR',
    'Hyper rare': 'HR', 'Mega Hyper Rare': 'HR',
}
HOLO = {'Rare Holo', 'Holo Rare', 'Rare Holo LV.X', 'Rare PRIME', 'LEGEND'}
ORDER = ['SIR', 'IR', 'UR', 'DR', 'HR', 'R']  # обложка: полноформатные иллюстрации смотрятся лучше золотых карт


def get(url, raw=False):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'HoloScan-packs-builder'})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            return data if raw else json.loads(data)
        except Exception:
            if attempt == 4:
                raise
            time.sleep(3 * (attempt + 1))


def colors(logo_url):
    """Два насыщенных цвета логотипа (самый частый и самый непохожий на него)."""
    try:
        im = Image.open(io.BytesIO(get(logo_url + '.png', raw=True))).convert('RGBA').resize((80, 40))
    except Exception:
        return ['#ff5a36', '#ffd447']
    buckets = {}
    for r, g, b, a in im.getdata():
        if a < 200:
            continue
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if s < 0.35 or l < 0.18 or l > 0.85:
            continue
        k = round(h * 18) % 18
        buckets.setdefault(k, []).append((r, g, b))
    if not buckets:
        return ['#3d4a66', '#c9a646']
    ranked = sorted(buckets.items(), key=lambda kv: -len(kv[1]))
    avg = lambda px: '#%02x%02x%02x' % tuple(round(sum(p[i] for p in px) / len(px)) for i in range(3))
    c1 = ranked[0]
    far = max(ranked[1:] or [c1], key=lambda kv: min(abs(kv[0] - c1[0]), 18 - abs(kv[0] - c1[0])) * min(len(kv[1]), 60))
    return [avg(c1[1]), avg(far[1])]


def main():
    rarity = {}
    for r, tier in TIER.items():
        for c in get(f'{API}/cards?rarity=eq:{urllib.parse.quote(r)}'):
            rarity[c['id']] = (tier, r in HOLO)
    print('карт с редкостью:', len(rarity), flush=True)
    packs = []
    for serie in SERIES:
        for s in get(f'{API}/series/{serie}')['sets']:
            if s['id'] in SKIP or s['cardCount']['official'] < 60:
                continue
            full = get(f'{API}/sets/{s["id"]}')
            tiers, img = {}, None
            for c in full['cards']:
                t = rarity.get(c['id'])
                if not t or not c.get('image'):
                    continue
                img = img or c['image'][: c['image'].rfind('/')]
                tiers.setdefault(t[0], []).append([c['localId'], c['name'], 1 if t[1] else 0])
            if not tiers.get('C') or not tiers.get('U'):
                continue  # без обычных карт это не бустер (подарочные и специальные наборы)
            top = next((tiers[k] for k in ORDER if tiers.get(k)), tiers['C'])
            cover = top[len(top) // 2][0]
            packs.append({
                'id': s['id'], 'name': full['name'], 'serie': serie, 'logo': full.get('logo'),
                'release': full.get('releaseDate'), 'colors': colors(full['logo']) if full.get('logo') else ['#ff5a36', '#ffd447'],
                'cover': cover, 'img': img, 'tiers': tiers,
            })
            print(s['id'], full['name'], {k: len(v) for k, v in tiers.items()}, flush=True)
    packs.sort(key=lambda p: p.get('release') or '', reverse=True)
    OUT.write_text(json.dumps({'packs': packs}, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    print('packs.json', len(packs), 'паков,', round(OUT.stat().st_size / 1e3), 'КБ')


if __name__ == '__main__':
    main()

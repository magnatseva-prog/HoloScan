"""Каталог запечатанных товаров Pokémon (бустеры, ETB, коробки, тины) с ценами TCGplayer.

Источник — tcgcsv.com (ежедневная бесплатная выгрузка каталога TCGplayer, категория 3 = Pokémon).
Запечатанный товар = продукт без поля «Number» (у отдельных карт оно есть).
Выход: www/data/sealed.json —
  {"updated": "...", "groups": [[groupId, name, publishedOn], ...],
   "items": [[productId, groupId, name, marketPrice], ...]}
Картинка: https://tcgplayer-cdn.tcgplayer.com/product/{productId}_200w.jpg
Свежие цены приложение берёт тем же адресом tcgcsv.com/tcgplayer/3/{groupId}/prices.
"""
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'www' / 'data' / 'sealed.json'
BASE = 'https://tcgcsv.com/tcgplayer/3'
# мусор, который не является коллекционным товаром
SKIP = ('code card', 'online code', 'digital')


def get(url):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'HoloScan-sealed-builder'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())['results']
        except Exception:
            time.sleep(2 * (attempt + 1))
    return []


def group(g):
    products, prices = get(f"{BASE}/{g['groupId']}/products"), get(f"{BASE}/{g['groupId']}/prices")
    price = {}
    for p in prices:  # у товара бывает несколько подтипов, берём максимум рыночной
        v = p.get('marketPrice') or p.get('midPrice')
        if v:
            price[p['productId']] = max(price.get(p['productId'], 0), v)
    out = []
    for p in products:
        if any(e.get('name') == 'Number' for e in p.get('extendedData') or []):
            continue
        name = p.get('name') or ''
        if any(s in name.lower() for s in SKIP):
            continue
        out.append([p['productId'], g['groupId'], name, round(price.get(p['productId'], 0), 2) or None])
    return out


def main():
    groups = get(f'{BASE}/groups')
    with ThreadPoolExecutor(8) as ex:
        items = [i for part in ex.map(group, groups) for i in part]
    data = {
        'updated': time.strftime('%Y-%m-%d'),
        'groups': [[g['groupId'], g['name'], (g.get('publishedOn') or '')[:10]] for g in groups],
        'items': items,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'групп: {len(groups)}, товаров: {len(items)}, с ценой: {sum(1 for i in items if i[3])}, {OUT.stat().st_size / 1e6:.2f} МБ')


if __name__ == '__main__':
    sys.exit(main())

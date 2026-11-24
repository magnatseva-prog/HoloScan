"""Компактный список карт на всех языках TCGdex для распознавания: www/data/cards.json.

Приложение грузит из сети только английский и основной язык (каталог), а этот файл даёт
распознаванию все остальные: японские, корейские, китайские, тайские карты узнаются без выбора языка.

Формат: {"langs": {lang: {"sets": [[setId, name, official, total, imgBase]], "cards": [[id, localId, name, img]]}}}
img: 1 — картинка по шаблону imgBase/localId, 0 — нет картинки, строка — свой адрес.
Карты Pokémon TCG Pocket (серия tcgp) пропускаем — в руках их не бывает.
"""
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'www' / 'data' / 'cards.json'
API = 'https://api.tcgdex.net/v2'
LANGS = ('en', 'fr', 'de', 'it', 'es', 'es-mx', 'pt', 'pt-br', 'id', 'ja', 'ko', 'zh-tw', 'zh-cn', 'th')


def get(url):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'HoloScan-index-builder'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except Exception:
            if attempt == 4:
                raise
            time.sleep(3 * (attempt + 1))


def main():
    pocket = {s['id'] for s in get(f'{API}/en/series/tcgp')['sets']}
    out = {}
    for lang in LANGS:
        cards = get(f'{API}/{lang}/cards')
        sets = get(f'{API}/{lang}/sets')
        set_of = lambda cid: cid[:cid.rfind('-')]
        base = {}
        for c in cards:
            img, lid = c.get('image'), c.get('localId', '')
            if img and img.endswith('/' + lid):
                base.setdefault(set_of(c['id']), img[: -len(lid) - 1])
        rows = []
        for c in cards:
            sid = set_of(c['id'])
            if sid in pocket:
                continue
            img, lid = c.get('image'), c.get('localId', '')
            code = 0 if not img else 1 if base.get(sid) and img == f"{base[sid]}/{lid}" else img
            rows.append([c['id'], lid, c['name'], code])
        srows = [[s['id'], s['name'], (s.get('cardCount') or {}).get('official'), (s.get('cardCount') or {}).get('total'), base.get(s['id'], '')]
                 for s in sets if s['id'] not in pocket]
        out[lang] = {'sets': srows, 'cards': rows}
        print(lang, len(rows), 'карт,', len(srows), 'сетов', flush=True)
    OUT.write_text(json.dumps({'langs': out}, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    print('cards.json', round(OUT.stat().st_size / 1e6, 2), 'МБ')


if __name__ == '__main__':
    main()

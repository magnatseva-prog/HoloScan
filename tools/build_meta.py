"""Данные для распознавания, которые кладутся в приложение:

www/data/hp.json    — {"280": ["sv02-244", ...]} — HP у всех карт (крупные цифры читаются надёжнее всего);
www/data/names.json — {"es": {"clodsire de paldea ex": ["sv02-130", ...]}, ...} — имена на всех языках,
                      чтобы испанскую карту находило, даже если в настройках выбран английский.
Нормализация имён должна совпадать с norm() в www/js/api.js.
"""
import json
import re
import sys
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'www' / 'data'
API = 'https://api.tcgdex.net/v2'
LANGS = ['en', 'fr', 'de', 'it', 'es', 'es-mx', 'pt', 'pt-br', 'id', 'ja', 'ko', 'zh-tw', 'zh-cn', 'th']
# у азиатских карт свои сеты и id, HP для них берём отдельно
HP_LANGS = ['en', 'ja', 'zh-tw', 'th', 'ko', 'id']


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'HoloScan-meta-builder'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def norm(s):
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(ch for ch in s if not unicodedata.category(ch).startswith('M'))
    s = re.sub(r'[^\w ]+|_', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def main():
    pocket = {s['id'] for s in get(f'{API}/en/series/tcgp')['sets']}
    is_pocket = lambda cid: cid.rsplit('-', 1)[0] in pocket

    names = {}
    for lang in LANGS:
        by = {}
        for c in get(f'{API}/{lang}/cards'):
            if is_pocket(c['id']):
                continue
            by.setdefault(norm(c['name']), []).append(c['id'])
        names[lang] = by
        print(lang, len(by), flush=True)

    jobs = [(lang, hp) for lang in HP_LANGS for hp in range(10, 410, 10)]
    hp_map = {}
    with ThreadPoolExecutor(12) as ex:
        for (lang, hp), cards in zip(jobs, ex.map(lambda j: get(f'{API}/{j[0]}/cards?hp=eq:{j[1]}'), jobs)):
            ids = hp_map.setdefault(str(hp), set())
            ids.update(c['id'] for c in cards if not is_pocket(c['id']))
    hp_map = {k: sorted(v) for k, v in hp_map.items() if v}
    print('hp ids:', sum(len(v) for v in hp_map.values()))

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'hp.json').write_text(json.dumps(hp_map, separators=(',', ':')))
    (OUT / 'names.json').write_text(json.dumps(names, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    for f in ('hp.json', 'names.json'):
        print(f, round((OUT / f).stat().st_size / 1e6, 2), 'MB')


if __name__ == '__main__':
    sys.exit(main())

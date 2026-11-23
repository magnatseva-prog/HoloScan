"""Иконка и заставка HoloScan для Android (перезаписывает ресурсы Capacitor)."""
from pathlib import Path

from PIL import Image, ImageDraw

RES = Path(__file__).resolve().parent.parent / 'android' / 'app' / 'src' / 'main' / 'res'
BG = (244, 239, 228)      # бумага
SUN = (255, 212, 71)
INK = (23, 19, 14)
RED = (255, 90, 54)
PAPER = (255, 253, 248)


def card_layer(big, w, h, fill, rot, dx, dy, window=True):
    """Карта с чернильной обводкой и окошком под рисунок, повёрнутая на rot градусов."""
    lay = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    x0, y0 = (big - w) / 2 + dx, (big - h) / 2 + dy
    sh = big * 0.03  # жёсткая тень
    d.rounded_rectangle((x0 + sh, y0 + sh, x0 + w + sh, y0 + h + sh), radius=w * 0.14, fill=INK)
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=w * 0.14, fill=fill, outline=INK, width=round(big * 0.028))
    if window:
        m = w * 0.16
        d.rounded_rectangle((x0 + m, y0 + h * 0.14, x0 + w - m, y0 + h * 0.52), radius=w * 0.06, fill=PAPER, outline=INK, width=round(big * 0.018))
        d.rounded_rectangle((x0 + m, y0 + h * 0.64, x0 + w * 0.62, y0 + h * 0.71), radius=w * 0.03, fill=INK)
    return lay.rotate(rot, resample=Image.BICUBIC, center=(big / 2 + dx, big / 2 + dy))


def mark(size, bg=True):
    """Значок: на жёлтом скруглённом квадрате две карты — бумажная сзади, киноварная спереди."""
    big = size * 4
    out = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    if bg:
        ImageDraw.Draw(out).rounded_rectangle((0, 0, big - 1, big - 1), radius=big * 0.24, fill=SUN)
    w, h = big * 0.40, big * 0.56
    out.alpha_composite(card_layer(big, w, h, PAPER, -14, big * 0.09, -big * 0.02, window=False))
    out.alpha_composite(card_layer(big, w, h, RED, 9, -big * 0.06, big * 0.02))
    return out.resize((size, size), Image.LANCZOS)


def main():
    for folder, s in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        ic = mark(s)
        for name in ('ic_launcher.png', 'ic_launcher_round.png'):
            ic.save(RES / f'mipmap-{folder}' / name)
        fg = Image.new('RGBA', (round(s * 2.25), round(s * 2.25)), (0, 0, 0, 0))
        inner = mark(round(s * 1.3), bg=False)
        fg.paste(inner, ((fg.width - inner.width) // 2, (fg.height - inner.height) // 2), inner)
        fg.save(RES / f'mipmap-{folder}' / 'ic_launcher_foreground.png')
    (RES / 'values' / 'ic_launcher_background.xml').write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FFD447</color>\n</resources>\n')
    logo = mark(220)
    for p in RES.glob('drawable*/splash.png'):
        w, h = Image.open(p).size
        sp = Image.new('RGB', (w, h), BG)
        lg = logo.resize((min(w, h) // 4,) * 2, Image.LANCZOS)
        sp.paste(lg, ((w - lg.width) // 2, (h - lg.height) // 2), lg)
        sp.save(p)


if __name__ == '__main__':
    main()

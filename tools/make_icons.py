"""Иконка и заставка HoloScan для Android (перезаписывает ресурсы Capacitor)."""
import math
from pathlib import Path

from PIL import Image, ImageDraw

RES = Path(__file__).resolve().parent.parent / 'android' / 'app' / 'src' / 'main' / 'res'
BG = (15, 20, 32)
STOPS = [(255, 94, 168), (255, 210, 76), (76, 240, 176), (61, 155, 255), (176, 107, 255), (255, 94, 168)]


def conic(size):
    im = Image.new('RGB', (size, size))
    px = im.load()
    c = size / 2
    for y in range(size):
        for x in range(size):
            t = ((math.atan2(y - c, x - c) / (2 * math.pi)) + 0.5) * (len(STOPS) - 1)
            i = min(int(t), len(STOPS) - 2)
            f = t - i
            px[x, y] = tuple(round(STOPS[i][k] * (1 - f) + STOPS[i + 1][k] * f) for k in range(3))
    return im


def mark(size):
    """Голографический квадрат с тёмной «картой» внутри."""
    big = size * 4
    im = conic(big)
    d = ImageDraw.Draw(im)
    m = big * 0.3
    d.rounded_rectangle((m, big * 0.22, big - m, big * 0.78), radius=big * 0.05, fill=BG)
    d.rounded_rectangle((m + big * 0.06, big * 0.3, big - m - big * 0.06, big * 0.52), radius=big * 0.02, fill=(61, 155, 255))
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=big * 0.22, fill=255)
    out = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)


def main():
    for folder, s in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        ic = mark(s)
        for name in ('ic_launcher.png', 'ic_launcher_round.png'):
            ic.save(RES / f'mipmap-{folder}' / name)
        fg = Image.new('RGBA', (round(s * 2.25), round(s * 2.25)), (0, 0, 0, 0))
        inner = mark(round(s * 1.3))
        fg.paste(inner, ((fg.width - inner.width) // 2, (fg.height - inner.height) // 2), inner)
        fg.save(RES / f'mipmap-{folder}' / 'ic_launcher_foreground.png')
    (RES / 'values' / 'ic_launcher_background.xml').write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0F1420</color>\n</resources>\n')
    logo = mark(220)
    for p in RES.glob('drawable*/splash.png'):
        w, h = Image.open(p).size
        sp = Image.new('RGB', (w, h), BG)
        lg = logo.resize((min(w, h) // 4,) * 2, Image.LANCZOS)
        sp.paste(lg, ((w - lg.width) // 2, (h - lg.height) // 2), lg)
        sp.save(p)


if __name__ == '__main__':
    main()

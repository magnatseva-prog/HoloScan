"""Баннер для README: docs/banner.png — логотип, слоган и три экрана в рамках телефонов.
Скриншоты берёт из docs/screenshots/en (их снимает tools/screenshots.mjs)."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from make_icons import mark

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'docs' / 'screenshots' / 'en'
W, H = 1600, 820
FONT = 'C:/Windows/Fonts/segoeuib.ttf'
FONT_R = 'C:/Windows/Fonts/segoeui.ttf'


def phone(path, width):
    """Скриншот в рамке телефона со скруглёнными углами."""
    shot = Image.open(path).convert('RGB')
    sw = width - 24
    shot = shot.resize((sw, round(shot.height * sw / shot.width)), Image.LANCZOS)
    ph = shot.height + 24
    body = Image.new('RGBA', (width, ph), (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    d.rounded_rectangle((0, 0, width - 1, ph - 1), radius=44, fill=(30, 36, 50, 255), outline=(70, 82, 105, 255), width=3)
    m = Image.new('L', shot.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, shot.width - 1, shot.height - 1), radius=34, fill=255)
    body.paste(shot, (12, 12), m)
    return body


def main():
    bg = Image.new('RGB', (W, H), (15, 20, 32))
    # мягкие цветные пятна, как голографический блик
    glow = Image.new('RGB', (W, H), (15, 20, 32))
    g = ImageDraw.Draw(glow)
    for (x, y, r, c) in [(1180, 160, 380, (61, 155, 255)), (1450, 650, 330, (176, 107, 255)), (300, 760, 300, (76, 240, 176))]:
        g.ellipse((x - r, y - r, x + r, y + r), fill=c)
    bg = Image.blend(bg, glow.filter(ImageFilter.GaussianBlur(160)), 0.35)

    canvas = bg.convert('RGBA')
    d = ImageDraw.Draw(canvas)
    logo = mark(120)
    canvas.paste(logo, (90, 170), logo)
    d.text((232, 168), 'HoloScan', font=ImageFont.truetype(FONT, 104), fill=(61, 155, 255))
    d.text((94, 330), 'Scan any Pokémon card.', font=ImageFont.truetype(FONT, 54), fill=(232, 237, 246))
    d.text((94, 396), 'See what it’s worth.', font=ImageFont.truetype(FONT, 54), fill=(232, 237, 246))
    small = ImageFont.truetype(FONT_R, 29)
    for k, line in enumerate(['On-device AI recognition · 25,000+ cards',
                              'TCGplayer & Cardmarket prices · 14 languages',
                              'AI grading · collection value tracker']):
        d.text((96, 488 + k * 42), line, font=small, fill=(139, 151, 173))
    pill = ImageFont.truetype(FONT, 26)
    label = 'Android app'
    tw = d.textlength(label, font=pill)
    d.rounded_rectangle((94, 640, 94 + tw + 64, 696), radius=28, fill=(61, 155, 255))
    d.text((126, 650), label, font=pill, fill=(255, 255, 255))

    # три телефона веером справа
    for k, (name, x, y, rot) in enumerate([('04-collection', 860, 120, 6), ('03-scan-result', 1060, 60, 0), ('08-grading', 1270, 120, -6)]):
        p = phone(SHOTS / f'{name}.jpg', 300)
        shadow = Image.new('RGBA', (p.width + 80, p.height + 80), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle((40, 50, p.width + 40, p.height + 40), radius=44, fill=(0, 0, 0, 150))
        shadow = shadow.filter(ImageFilter.GaussianBlur(22))
        shadow.paste(p, (40, 40), p)
        r = shadow.rotate(rot, resample=Image.BICUBIC, expand=True)
        canvas.alpha_composite(r, (x - 40, y - 40))
    canvas.convert('RGB').save(ROOT / 'docs' / 'banner.png', optimize=True)
    print('ok', (ROOT / 'docs' / 'banner.png').stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    main()

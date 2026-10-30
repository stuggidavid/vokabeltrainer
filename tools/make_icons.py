"""Erzeugt die App-Icons in ../icons. Aufruf: python tools/make_icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
FONT = "C:/Windows/Fonts/arialbd.ttf"


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    s = size * 4  # hochauflösend zeichnen, dann verkleinern (glatte Kanten)
    img = Image.new("RGB", (s, s), "#6c5ce7")
    d = ImageDraw.Draw(img)
    # sanfter Farbverlauf
    for y in range(s):
        t = y / s
        d.line([(0, y), (s, y)], fill=(int(108 + 34 * t), int(92 + 32 * t), int(231 + 24 * t)))
    pad = s * (0.22 if maskable else 0.14)
    # zwei Karteikarten
    back = [pad + s * 0.08, pad, s - pad, s - pad - s * 0.12]
    front = [pad, pad + s * 0.12, s - pad - s * 0.08, s - pad]
    d.rounded_rectangle(back, radius=s * 0.06, fill="#ffc83d")
    d.rounded_rectangle(front, radius=s * 0.06, fill="#ffffff")
    font = ImageFont.truetype(FONT, int(s * (0.26 if maskable else 0.32)))
    cx, cy = (front[0] + front[2]) / 2, (front[1] + front[3]) / 2
    d.text((cx, cy), "Aa", font=font, fill="#6c5ce7", anchor="mm")
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    draw_icon(180).save(OUT / "apple-touch-icon.png")
    draw_icon(192).save(OUT / "icon-192.png")
    draw_icon(512).save(OUT / "icon-512.png")
    draw_icon(512, maskable=True).save(OUT / "icon-maskable-512.png")
    print("Icons gespeichert in", OUT)

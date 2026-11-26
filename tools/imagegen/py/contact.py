#!/usr/bin/env python3
"""Render a labelled contact sheet.

usage: contact.py <out.png> <items.json> [cols] [cell]
items: [{"id","path","label","status","tiling","alpha"}...]
Tileables are shown as a 2x2 tiled mosaic; RGBA assets are split-composited (dark | light) to expose fringes.
"""
from __future__ import annotations

import json
import sys

from PIL import Image, ImageDraw, ImageFont

STATUS_COLORS = {'approved': (70, 200, 110), 'rejected': (230, 70, 70), 'pending': (200, 180, 80)}


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in ('C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf'):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def fit(im: Image.Image, cell: int) -> Image.Image:
    im = im.copy()
    im.thumbnail((cell, cell), Image.Resampling.LANCZOS)
    return im


def render_cell(item: dict, cell: int) -> Image.Image:
    im = Image.open(item['path'])
    canvas = Image.new('RGB', (cell, cell), (24, 24, 28))
    if item.get('tiling'):
        t = im.convert('RGB').resize((cell // 2, cell // 2), Image.Resampling.LANCZOS)
        for ix in range(2):
            for iy in range(2):
                canvas.paste(t, (ix * (cell // 2), iy * (cell // 2)))
    elif im.mode == 'RGBA':
        t = fit(im, cell)
        dark = Image.new('RGB', (cell, cell), (26, 26, 38))
        light = Image.new('RGB', (cell, cell), (214, 214, 206))
        half = Image.new('L', (cell, cell), 0)
        ImageDraw.Draw(half).rectangle((cell // 2, 0, cell, cell), fill=255)
        bg = Image.composite(light, dark, half)
        ox, oy = (cell - t.size[0]) // 2, (cell - t.size[1]) // 2
        bg.paste(t, (ox, oy), t)
        canvas = bg
    else:
        t = fit(im.convert('RGB'), cell)
        canvas.paste(t, ((cell - t.size[0]) // 2, (cell - t.size[1]) // 2))
    return canvas


def main() -> None:
    out, items_path = sys.argv[1:3]
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    cell = int(sys.argv[4]) if len(sys.argv) > 4 else 256
    items = json.load(open(items_path, encoding='utf8'))
    font = load_font(13)
    pad, label_h = 8, 34
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (cell + pad) + pad, rows * (cell + label_h + pad) + pad), (12, 12, 14))
    d = ImageDraw.Draw(sheet)
    for i, item in enumerate(items):
        r, c = divmod(i, cols)
        x, y = pad + c * (cell + pad), pad + r * (cell + label_h + pad)
        try:
            sheet.paste(render_cell(item, cell), (x, y))
        except Exception as e:  # missing/corrupt output — keep the grid readable
            d.rectangle((x, y, x + cell, y + cell), outline=(230, 70, 70))
            d.text((x + 6, y + 6), f'ERR {e}', fill=(230, 70, 70), font=font)
        col = STATUS_COLORS.get(item.get('status', 'pending'), (200, 200, 200))
        d.rectangle((x, y + cell, x + cell, y + cell + label_h), fill=(20, 20, 24))
        d.text((x + 4, y + cell + 2), item['id'][:34], fill=col, font=font)
        d.text((x + 4, y + cell + 18), item.get('label', '')[:42], fill=(150, 150, 160), font=font)
    sheet.save(out)
    print(out)


if __name__ == '__main__':
    main()

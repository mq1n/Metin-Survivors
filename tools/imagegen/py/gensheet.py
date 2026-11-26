#!/usr/bin/env python3
"""Contact sheet for one `gen` id: the references, then every variant, each shown on black and on a mid-grey checker.

usage: gensheet.py <out.png> <items.json> [cell]
items.json: {"title": str,
             "refs": [{"path", "label"}],
             "variants": [{"path", "label", "sub", "status": "pass|warn|fail|error", "blend": "add|alpha|opaque"}]}
blend: add = sprite on black composited additively (how the engine blends it), alpha = alpha-over, opaque = pasted.
Row 1 = on black, row 2 = on a mid-grey checker (exposes a lifted black floor, halos and fringes).
"""
from __future__ import annotations

import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

STATUS = {'pass': (90, 210, 120), 'warn': (230, 190, 70), 'fail': (235, 80, 70), 'error': (235, 80, 70), 'ref': (150, 180, 235)}


def font(size: int) -> ImageFont.ImageFont:
    for p in ('C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf'):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def checker(cell: int, sq: int = 16) -> np.ndarray:
    y, x = np.mgrid[0:cell, 0:cell]
    v = np.where(((x // sq) + (y // sq)) % 2 == 0, 96, 128).astype(np.float32) / 255.0
    return np.dstack([v, v, v])


def fit(im: Image.Image, cell: int) -> Image.Image:
    s = min(cell / im.width, cell / im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.Resampling.LANCZOS)


def render(path: str, blend: str, cell: int, bg: np.ndarray) -> Image.Image:
    im = Image.open(path)
    im = im.convert('RGBA') if im.mode in ('RGBA', 'LA', 'P') else im.convert('RGB')
    im = fit(im, cell)
    arr = np.asarray(im).astype(np.float32) / 255.0
    out = bg.copy()
    h, w = arr.shape[:2]
    oy, ox = (cell - h) // 2, (cell - w) // 2
    region = out[oy : oy + h, ox : ox + w]
    rgb = arr[..., :3]
    if arr.shape[2] == 4:
        a = arr[..., 3:4]
        region[:] = rgb * a + region * (1.0 - a)
    elif blend == 'add':
        region[:] = np.clip(region + rgb, 0.0, 1.0)
    else:
        region[:] = rgb
    return Image.fromarray((np.clip(out, 0, 1) * 255.0 + 0.5).astype(np.uint8))


def main() -> None:
    out, items_path = sys.argv[1], sys.argv[2]
    cell = int(sys.argv[3]) if len(sys.argv) > 3 else 320
    items = json.load(open(items_path, encoding='utf8'))
    cols = [dict(c, kind='ref') for c in items.get('refs', [])] + [dict(c, kind='var') for c in items.get('variants', [])]
    if not cols:
        raise SystemExit('nothing to show')
    pad, head, title_h = 8, 40, 30
    W = pad + len(cols) * (cell + pad)
    H = title_h + head + 2 * (cell + pad) + pad
    sheet = Image.new('RGB', (W, H), (12, 12, 14))
    d = ImageDraw.Draw(sheet)
    f_title, f_lab, f_sub = font(18), font(15), font(12)
    d.text((pad, 6), items.get('title', ''), fill=(240, 220, 160), font=f_title)
    black = np.zeros((cell, cell, 3), np.float32)
    chk = checker(cell)
    for i, c in enumerate(cols):
        x = pad + i * (cell + pad)
        col = STATUS['ref'] if c['kind'] == 'ref' else STATUS.get(c.get('status', 'pass'), (200, 200, 200))
        d.text((x + 2, title_h), str(c.get('label', ''))[:44], fill=col, font=f_lab)
        d.text((x + 2, title_h + 19), str(c.get('sub', ''))[:52], fill=(160, 160, 170), font=f_sub)
        y0 = title_h + head
        for r, bg in enumerate((black, chk)):
            y = y0 + r * (cell + pad)
            try:
                if not c.get('path'):
                    raise FileNotFoundError(c.get('sub') or 'no image')
                sheet.paste(render(c['path'], c.get('blend', 'add'), cell, bg), (x, y))
            except Exception as e:  # keep the sheet readable when one variant failed
                d.rectangle((x, y, x + cell - 1, y + cell - 1), outline=STATUS['fail'])
                d.text((x + 6, y + 6), f'ERR {e}'[:60], fill=STATUS['fail'], font=f_sub)
            if i == 0:
                cap = 'on black' if r == 0 else 'on grey checker'
                tw = int(d.textlength(cap, font=f_sub))
                d.rectangle((x, y + cell - 18, x + tw + 8, y + cell - 1), fill=(12, 12, 14))
                d.text((x + 4, y + cell - 16), cap, fill=(170, 170, 180), font=f_sub)
    sheet.save(out)
    print(out)


if __name__ == '__main__':
    main()

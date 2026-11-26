#!/usr/bin/env python3
"""PACK mode (docs/ART.md s9): one generated 2 x 2 sheet carries FOUR DIFFERENT icon ids; this module cuts it into one raw per id.

  python tools/imagegen/py/pack.py slice <sheet.png> <outdir> [--n 4] [--mode tile|cutout] [--names a,b,c,d]
      -> <outdir>/cell_<i>.png (i = 1..n, reading order: top-left, top-right, bottom-left, bottom-right; all the same square size),
         <outdir>/slice.json (last stdout line too), <outdir>/slice.png (the sheet with the cut lines and every cell box drawn)
  python tools/imagegen/py/pack.py contact <out.png> <items.json>
      -> review sheet, one row per pack variant: the slice overlay + the four built icons (items: see contact())

How a sheet is cut (the robust variant of the grade-sheet gutter search in iconkit.split_grid):
  1. foreground: the real alpha channel when the sheet has one (cut-outs), else the colour distance to the median of the sheet's
     border ring (stencils on black, opaque or keyed cut-outs). Specks are dropped.
  2. objects: the foreground is merged with a round dilation of ~1.2 % of the side and labelled, so an icon whose parts float apart
     (a ring + a sword, two earrings) is ONE object, while two icons separated by a gutter wider than 2.4 % never merge.
  3. cut lines: the widest blank run of the row / column profile near the sheet's midlines (a model's sheet is rarely even); the
     midline itself when there is no blank run. They only decide which quadrant an object belongs to.
  4. an object goes to the quadrant of its centre of mass; its pixels are copied from the sheet (NOT a rectangle of the sheet), so a
     blade tip that pokes past the midline stays with its icon. An object with >= 20 % of its pixels on the other side of a cut
     (two touching icons, or one drawn across the gutter) FAILS the cells it touches; the other cells stay usable.
  5. every usable cell becomes a square raw of ONE common size (the biggest object + 8 % margin per side, >= 256), background-filled
     with the sheet's own background (transparent / the border colour), the object centred: the per-id post chain then sees
     identical framing for all ids of the pack. A cell that is empty, or cropped by the sheet border, FAILS.
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

CELL_NAMES = ('top-left', 'top-right', 'bottom-left', 'bottom-right')
PAD_FRAC = 0.08          # margin kept around the biggest object in the common cell canvas (per side)
MERGE_FRAC = 0.012       # round dilation radius that merges the parts of one icon (fraction of the short side)
SPECK_FRAC = 0.00012     # components below this share of the sheet area are specks
CROSS_FRAC = 0.20        # share of an object's pixels beyond a cut that makes it "cross the gutter"
THRESH = {'tile': 48.0, 'cutout': 36.0}   # colour distance (0..441) to the sheet background that counts as foreground


def load_sheet(path: str):
    """-> (rgb float32 HxWx3, alpha float32 HxW | None, mode 'alpha' | 'colour'). A sheet counts as transparent when >5 % of
    its pixels are (almost) fully transparent."""
    im = Image.open(path)
    has_alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
    arr = np.asarray(im.convert('RGBA')).astype(np.float32) / 255.0
    rgb, a = arr[..., :3], arr[..., 3]
    if has_alpha and float((a < 0.1).mean()) > 0.05:
        return rgb, a, 'alpha'
    return rgb, None, 'colour'


def border_colour(rgb: np.ndarray) -> np.ndarray:
    H, W = rgb.shape[:2]
    b = max(4, int(min(H, W) * 0.015))
    ring = np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3), rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
    return np.median(ring, axis=0)


def foreground(rgb: np.ndarray, a: np.ndarray | None, kind: str):
    """-> (bool HxW foreground without specks, background colour float 3 | None)."""
    H, W = rgb.shape[:2]
    if a is not None:
        fg, bg = a > 0.15, None
    else:
        bg = border_colour(rgb)
        d = np.sqrt(((rgb - bg) ** 2).sum(axis=2)) * 255.0
        fg = d > THRESH.get(kind, 40.0)
    lab, n = ndi.label(fg, structure=np.ones((3, 3), bool))
    notes: list[str] = []
    if n:
        sizes = ndi.sum(fg, lab, index=np.arange(1, n + 1))
        small = np.isin(lab, np.where(sizes < max(24.0, SPECK_FRAC * H * W))[0] + 1)
        fg = fg & ~small
        # a model sometimes draws cell borders / a frame / divider lines despite the prompt: a thin object that spans >= 80 % of the sheet
        # cannot be an icon (an icon fits one cell), so it is removed instead of gluing the four cells together
        for i, sl in enumerate(ndi.find_objects(lab), start=1):
            if sl is None or sizes[i - 1] < max(24.0, SPECK_FRAC * H * W):
                continue
            bh, bw = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
            if (bw >= 0.8 * W or bh >= 0.8 * H) and sizes[i - 1] < 0.12 * bw * bh:
                fg = fg & ~(lab == i)
                notes.append(f'a divider / frame line ({bw}x{bh} px) spanning the sheet was removed')
    return fg, bg, notes


def find_gutter(profile: np.ndarray, centre: int, span: int):
    """-> (cut index, clean). The middle of the widest blank run of `profile` within centre +- span; (centre, False) when none."""
    lo, hi = max(centre - span, 1), min(centre + span, len(profile) - 1)
    blank = profile[lo:hi] <= 0.002 * max(float(profile.max()), 1.0)
    best, run, start = (0, 0), 0, 0
    for i, v in enumerate(blank):
        if v:
            if run == 0:
                start = i
            run += 1
            if run > best[1]:
                best = (start, run)
        else:
            run = 0
    if best[1] >= 2:
        return lo + best[0] + best[1] // 2, True
    return centre, False


def analyse(rgb: np.ndarray, a: np.ndarray | None, mode: str, n: int, kind: str = 'tile') -> dict:
    """Find the objects, the cut lines and the cell of every object. Returns the working state (masks included)."""
    H, W = rgb.shape[:2]
    fg, bg, fgnotes = foreground(rgb, a, kind)
    r = max(3, int(round(MERGE_FRAC * min(H, W))))
    region = ndi.distance_transform_edt(~fg) <= r          # round dilation of the foreground
    lab, nl = ndi.label(region, structure=np.ones((3, 3), bool))
    ycut, ycl = find_gutter(fg.sum(axis=1).astype(np.float32), H // 2, int(H * 0.2))
    xcut, xcl = find_gutter(fg.sum(axis=0).astype(np.float32), W // 2, int(W * 0.2))
    cells = [dict(index=i + 1, cell=CELL_NAMES[i], objs=[], fails=[], warns=[], infos=[]) for i in range(4)]
    objs = []
    yy, xx = np.nonzero(fg)
    lab_fg = lab[yy, xx]
    order = np.argsort(lab_fg, kind='stable')
    yy, xx, lab_fg = yy[order], xx[order], lab_fg[order]
    bounds = np.searchsorted(lab_fg, np.arange(1, nl + 2))
    for li in range(1, nl + 1):
        ys, xs = yy[bounds[li - 1] : bounds[li]], xx[bounds[li - 1] : bounds[li]]
        if len(ys) == 0:
            continue
        cy, cx = float(ys.mean()), float(xs.mean())
        q = (1 if cy >= ycut else 0) * 2 + (1 if cx >= xcut else 0)
        quads = {}
        for qy in (0, 1):
            for qx in (0, 1):
                share = float((((ys >= ycut) == bool(qy)) & ((xs >= xcut) == bool(qx))).mean())
                if share > 0:
                    quads[qy * 2 + qx] = share
        spans = [qq for qq, s in quads.items() if s >= CROSS_FRAC]
        o = dict(label=li, area=int(len(ys)), bbox=[int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], quad=q, spans=sorted(set(spans) | {q}) if len(spans) > 1 else [q],
                 leak=round(1.0 - quads.get(q, 1.0), 3))
        objs.append(o)
        cells[q]['objs'].append(o)
    return dict(H=H, W=W, fg=fg, bg=bg, notes=fgnotes, lab=lab, cuts=dict(x=int(xcut), y=int(ycut), cleanX=bool(xcl), cleanY=bool(ycl)), cells=cells, objs=objs, mergeR=r)


def judge(st: dict, n: int) -> None:
    """Mark every cell ok / failed (reasons) and collect warnings. Cells beyond n only get an info when they hold content."""
    H, W = st['H'], st['W']
    for c in st['cells']:
        c['area'] = sum(o['area'] for o in c['objs'])
        if c['index'] > n:
            if c['objs']:
                c['infos'].append(f"content in the unused cell {c['index']} ignored")
            continue
        for o in c['objs']:
            if len(o['spans']) > 1:
                names = ' + '.join(CELL_NAMES[s] for s in o['spans'])
                for s in o['spans']:
                    cc = st['cells'][s]
                    msg = f'an object crosses the gutter between {names}'
                    if s < n and msg not in cc['fails']:
                        cc['fails'].append(msg)
            elif o['leak'] > 0.0:
                c['warns'].append(f"{o['leak'] * 100:.0f}% of an object leaks past the cut line (kept with its icon)")
            x0, y0, x1, y1 = o['bbox']
            if x0 <= 1 or y0 <= 1 or x1 >= W - 2 or y1 >= H - 2:
                c['fails'].append('an object touches the sheet border (cropped)')
        if not c['objs']:
            c['fails'].append('empty cell (nothing drawn)')
        elif len(c['objs']) > 1:
            c['infos'].append(f"{len(c['objs'])} separate parts")
    # layout check: an empty cell while another cell holds two separate main icons means the model did not draw a 2 x 2 sheet
    # (e.g. a row of four): the cells that hold several main objects cannot be trusted. (A legit two-part icon, like a pair of
    # earrings, only trips this when another cell is empty too - that pack needs a reroll anyway.)
    biggest = max([o['area'] for o in st['objs']] + [1])
    empties = [c for c in st['cells'][:n] if not c['objs']]
    if empties:
        for c in st['cells'][:n]:
            mains = [o for o in c['objs'] if o['area'] >= 0.25 * biggest]
            if len(mains) >= 2 and not c['fails']:
                c['fails'].append('layout is not a 2x2 sheet: two separate icons share this cell while another cell is empty')
    areas = [c['area'] for c in st['cells'][:n] if c['area'] > 0 and not c['fails']]
    if len(areas) >= 3:
        med = float(np.median(areas))
        for c in st['cells'][:n]:
            if c['area'] and not c['fails'] and c['area'] < 0.2 * med:
                c['warns'].append(f"much smaller than the other cells ({c['area']} px vs median {med:.0f})")
    for c in st['cells'][:n]:
        c['ok'] = not c['fails']


def cell_canvas(st: dict, n: int) -> int:
    """Common square canvas side: the biggest usable object + 2 x PAD_FRAC, >= 256, multiple of 8."""
    big = 0
    for c in st['cells'][:n]:
        if c.get('ok'):
            lab, r = st['lab'], st['mergeR']
            m = np.isin(lab, [o['label'] for o in c['objs']])
            ys, xs = np.nonzero(m)
            big = max(big, int(max(ys.max() - ys.min() + 1, xs.max() - xs.min() + 1)))
    side = int(math.ceil(big / (1.0 - 2.0 * PAD_FRAC))) if big else 256
    return max(256, (side + 7) // 8 * 8)


def render_cell(rgb: np.ndarray, a: np.ndarray | None, st: dict, c: dict, side: int) -> Image.Image:
    labs = [o['label'] for o in c['objs']]
    m = np.isin(st['lab'], labs)
    ys, xs = np.nonzero(m)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    h, w = y1 - y0, x1 - x0
    oy, ox = (side - h) // 2, (side - w) // 2
    mm = m[y0:y1, x0:x1]
    if a is not None:
        out = np.zeros((side, side, 4), np.float32)
        patch = np.zeros((h, w, 4), np.float32)
        patch[..., :3] = np.where(mm[..., None], rgb[y0:y1, x0:x1], 0.0)
        patch[..., 3] = np.where(mm, a[y0:y1, x0:x1], 0.0)
        out[oy : oy + h, ox : ox + w] = patch
    else:
        out = np.empty((side, side, 3), np.float32)
        out[:] = st['bg']
        out[oy : oy + h, ox : ox + w] = np.where(mm[..., None], rgb[y0:y1, x0:x1], st['bg'])
    return Image.fromarray((np.clip(out, 0, 1) * 255.0 + 0.5).astype(np.uint8), 'RGBA' if a is not None else 'RGB')


def font(size: int):
    for p in ('C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf'):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def overlay(rgb: np.ndarray, a: np.ndarray | None, st: dict, n: int, names: list[str], out: str, long: int = 640) -> None:
    H, W = st['H'], st['W']
    s = min(1.0, long / max(H, W))
    base = np.zeros((H, W, 3), np.float32)
    if a is not None:  # transparent sheet over a grey checker so haze / fringes show
        yy, xx = np.mgrid[0:H, 0:W]
        chk = np.where(((xx // 24) + (yy // 24)) % 2 == 0, 0.32, 0.42).astype(np.float32)
        base = np.dstack([chk, chk, chk]) * (1 - a[..., None]) + rgb * a[..., None]
    else:
        base = rgb
    im = Image.fromarray((np.clip(base, 0, 1) * 255.0 + 0.5).astype(np.uint8)).resize((max(1, round(W * s)), max(1, round(H * s))), Image.Resampling.LANCZOS)
    d = ImageDraw.Draw(im)
    f = font(13)
    xc, yc = round(st['cuts']['x'] * s), round(st['cuts']['y'] * s)
    cut_col = (80, 220, 255)
    d.line([(xc, 0), (xc, im.height)], fill=cut_col if st['cuts']['cleanX'] else (255, 170, 60), width=1)
    d.line([(0, yc), (im.width, yc)], fill=cut_col if st['cuts']['cleanY'] else (255, 170, 60), width=1)
    for c in st['cells']:
        i = c['index'] - 1
        if i >= n:
            col = (110, 110, 110)
        else:
            col = (90, 210, 120) if c.get('ok') else (235, 80, 70)
        for o in c['objs']:
            x0, y0, x1, y1 = [round(v * s) for v in o['bbox']]
            d.rectangle((x0, y0, x1, y1), outline=col, width=2)
        tx, ty = (4 if i % 2 == 0 else xc + 4), (4 if i < 2 else yc + 4)
        label = f"{c['index']} {names[i] if i < len(names) else ''}"[:34] + ('' if c.get('ok', i >= n) else ' FAIL')
        d.rectangle((tx - 2, ty - 1, tx + int(d.textlength(label, font=f)) + 3, ty + 15), fill=(10, 10, 12))
        d.text((tx, ty), label, fill=col, font=f)
    im.save(out)


def slice_sheet(sheet: str, outdir: str, n: int = 4, kind: str = 'tile', names: list[str] | None = None) -> dict:
    if not 1 <= n <= 4:
        raise ValueError('a pack holds 1-4 cells')
    os.makedirs(outdir, exist_ok=True)
    rgb, a, mode = load_sheet(sheet)
    st = analyse(rgb, a, mode, n, kind)
    judge(st, n)
    side = cell_canvas(st, n)
    cells = []
    for c in st['cells'][:n]:
        entry = dict(index=c['index'], cell=c['cell'], ok=bool(c['ok']), reason='; '.join(c['fails']) or None, warnings=c['warns'] + c['infos'], area=c['area'],
                     objects=len(c['objs']), bbox=None, file=None)
        if c['objs']:
            boxes = [o['bbox'] for o in c['objs']]
            entry['bbox'] = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
        if c['ok']:
            p = os.path.join(outdir, f"cell_{c['index']}.png")
            render_cell(rgb, a, st, c, side).save(p)
            entry['file'] = p.replace('\\', '/')
        cells.append(entry)
    spare = [dict(index=c['index'], infos=c['infos']) for c in st['cells'][n:] if c['infos']]
    ov = os.path.join(outdir, 'slice.png')
    overlay(rgb, a, st, n, names or [], ov)
    report = dict(sheet=sheet.replace('\\', '/'), w=st['W'], h=st['H'], mode=mode, kind=kind, n=n, bg=None if st['bg'] is None else [round(float(v), 4) for v in st['bg']],
                  cuts=st['cuts'], notes=st['notes'], cell_size=side, mergeRadius=st['mergeR'], cells=cells, spare=spare, overlay=ov.replace('\\', '/'),
                  failed=[c['index'] for c in cells if not c['ok']])
    with open(os.path.join(outdir, 'slice.json'), 'w', encoding='utf8') as fh:
        json.dump(report, fh, indent=1)
    return report


def contact(out: str, items: dict) -> None:
    """items: {"title": str, "rows": [{"label": str, "overlay": path|None, "cells": [{"path": path|None, "label": str, "status": "pass|warn|fail|error"}]}]}.
    One row per pack variant: the slice overlay on the left, then every built icon on black and on a grey checker."""
    status_col = {'pass': (90, 210, 120), 'warn': (230, 190, 70), 'fail': (235, 80, 70), 'error': (235, 80, 70)}
    T, pad, head = 176, 8, 34
    f_t, f_l = font(16), font(12)
    rows = items.get('rows', [])
    ncell = max([len(r.get('cells', [])) for r in rows] + [1])
    ov_w = 360
    W = pad + ov_w + pad + ncell * (T + pad)
    H = head + len(rows) * (2 * T + 3 * pad + 18) + pad
    sheet = Image.new('RGB', (W, H), (12, 12, 14))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 8), items.get('title', ''), fill=(240, 220, 160), font=f_t)
    yy, xx = np.mgrid[0:T, 0:T]
    chk = np.where(((xx // 16) + (yy // 16)) % 2 == 0, 96, 128).astype(np.uint8)
    chk_im = Image.fromarray(np.dstack([chk, chk, chk]))
    for ri, row in enumerate(rows):
        y = head + ri * (2 * T + 3 * pad + 18)
        d.text((pad, y), str(row.get('label', ''))[:60], fill=(200, 200, 210), font=f_l)
        if row.get('overlay') and os.path.exists(row['overlay']):
            ov = Image.open(row['overlay']).convert('RGB')
            ov.thumbnail((ov_w, 2 * T + pad))
            sheet.paste(ov, (pad, y + 18))
        for ci, c in enumerate(row.get('cells', [])):
            x = pad + ov_w + pad + ci * (T + pad)
            col = status_col.get(c.get('status', 'pass'), (200, 200, 200))
            d.text((x + 2, y), str(c.get('label', ''))[:30], fill=col, font=f_l)
            for r, bgim in enumerate((Image.new('RGB', (T, T), (0, 0, 0)), chk_im)):
                yy0 = y + 18 + r * (T + pad)
                tile = bgim.copy()
                p = c.get('path')
                if p and os.path.exists(p):
                    im = Image.open(p).convert('RGBA')
                    im.thumbnail((T, T), Image.Resampling.LANCZOS)
                    tile.paste(im, ((T - im.width) // 2, (T - im.height) // 2), im)
                else:
                    ImageDraw.Draw(tile).text((6, 6), 'no image', fill=col, font=f_l)
                sheet.paste(tile, (x, yy0))
    sheet.save(out)


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0] not in ('slice', 'contact'):
        raise SystemExit(__doc__)
    if args[0] == 'contact':
        contact(args[1], json.load(open(args[2], encoding='utf8')))
        print(args[1])
        return
    opts = {'--n': '4', '--mode': 'tile', '--names': ''}
    pos = []
    it = iter(args[1:])
    for t in it:
        if t in opts:
            opts[t] = next(it)
        else:
            pos.append(t)
    rep = slice_sheet(pos[0], pos[1], int(opts['--n']), opts['--mode'], [s for s in opts['--names'].split(',') if s])
    print(json.dumps(rep))


if __name__ == '__main__':
    main()

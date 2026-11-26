#!/usr/bin/env python3
"""Machine gates for icons (docs/ART.md s5/s10; REPORT C4). Read-only on the images; writes sheets + a report.

usage: gates.py <items.json> <outdir> [--profile tools/imagegen/gates.json]
items.json: {"collection": "skills", "source": "build", "items": [{"id", "path", "form": "tile"|"cutout"|"legacy",
             "glyph": "<glyph mask png>" | null, "pairOk": [ids]}]}
Prints one JSON report on stdout and writes <outdir>/<collection>_report.json and readability sheets
<outdir>/<collection>_48_64_<n>.png (every icon at 48 and 64 px on three grounds: #0d0a08 night, #2a2219 slot plate, #8a8a80 grey).

Gates (thresholds in gates.json, defaults below):
  corner   tile/cutout: max alpha of the four corner blocks (8 px at 256) <= corner/255
  ring     cutout: max alpha inside the outer 3 % ring <= ring/255 (nothing cropped or touching the edge)
  fill     cutout: long side of the alpha box within [fillMin, fillMax] of the canvas
  luma     cutout: interior (contour excluded) mean luma >= lumaFloor OR mean HSV value >= valueFloor (reads on a dark
           slot at 48 px; a saturated red/blue object passes on value)
  glyph    tile: |glyph luma - ground luma| >= glyphContrast (uses the glyph mask the octile op saves)
  dup      pairwise 24x24 luma correlation <= dup unless the pair is in pairOk (tiles: on the glyph mask)
  hue      collections with huePerBand: at most huePerBand icons per 40 degree band of dominant hue (warn)
"""
from __future__ import annotations

import colorsys
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

LUMA = np.array([0.299, 0.587, 0.114])
DEFAULTS = {
    'corner': 5,
    'ring': 8,
    'dup': 0.75,
    'fillMin': 0.70,
    'fillMax': 0.93,
    'lumaFloor': 90,
    'valueFloor': 150,
    'glyphContrast': 70,
    'huePerBand': 0,
}


def font(size: int):
    for p in ('C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/arial.ttf'):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()


def load(path: str) -> np.ndarray:
    im = Image.open(path)
    im = im.convert('RGBA')
    return np.asarray(im).astype(np.float64) / 255.0


def vec24(arr: np.ndarray) -> np.ndarray:
    im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).resize((24, 24), Image.Resampling.BOX)
    v = np.asarray(im).astype(np.float64).ravel()
    v = v - v.mean()
    n = np.linalg.norm(v)
    return v / n if n > 1e-6 else v


def metrics(item: dict, prof: dict) -> dict:
    a = load(item['path'])
    H, W = a.shape[:2]
    rgb, al = a[..., :3], a[..., 3]
    form = item.get('form', 'cutout')
    L = rgb @ LUMA
    m: dict = {'w': W, 'h': H}
    b = max(2, round(W * 8 / 256))
    m['corner'] = round(float(max(al[:b, :b].max(), al[:b, -b:].max(), al[-b:, :b].max(), al[-b:, -b:].max())) * 255, 1)
    r = max(2, round(W * 0.03))
    ring = np.ones((H, W), bool)
    ring[r:-r, r:-r] = False
    m['ring'] = round(float(al[ring].max()) * 255, 1)
    ys, xs = np.where(al > 0.05)
    m['fill'] = round(float(max(ys.max() - ys.min() + 1, xs.max() - xs.min() + 1)) / W, 3) if len(ys) else 0.0
    w = al if form != 'legacy' else np.ones_like(al)
    m['luma'] = round(float((L * w).sum() / max(w.sum(), 1e-6)) * 255, 1)
    # interior (contour excluded): luma and HSV value — a saturated red/blue object has a low luma but reads on a dark slot
    from scipy import ndimage as ndi

    core = ndi.binary_erosion(al > 0.99, iterations=max(2, round(W * 0.025))) if form != 'legacy' else np.ones_like(al, bool)
    if core.sum() > 50:
        m['lumaIn'] = round(float(L[core].mean()) * 255, 1)
        m['valueIn'] = round(float(rgb.max(-1)[core].mean()) * 255, 1)
    # dominant hue (alpha-weighted, saturated pixels only)
    hsv = np.array([colorsys.rgb_to_hsv(*p) for p in rgb.reshape(-1, 3)[:: max(1, (H * W) // 6000)]])
    ww = w.reshape(-1)[:: max(1, (H * W) // 6000)]
    sel = (hsv[:, 1] > 0.25) & (hsv[:, 2] > 0.2) & (ww > 0.5)
    if sel.sum() > 20:
        ang = hsv[sel, 0] * 2 * np.pi
        m['hue'] = round(float(np.degrees(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean())) % 360), 1)
    else:
        m['hue'] = None
    glyph = None
    if form == 'tile' and item.get('glyph') and os.path.exists(item['glyph']):
        g = np.asarray(Image.open(item['glyph']).convert('L')).astype(np.float64) / 255.0
        if g.shape != L.shape:
            g = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((W, H), Image.Resampling.BILINEAR)).astype(np.float64) / 255.0
        glyph = g
        inner = al > 0.99
        gl, gr = (g > 0.6) & inner, (g < 0.05) & inner
        # ground = well pixels away from the glyph and away from the rim
        d = r * 4
        well = np.zeros_like(inner)
        well[d:-d, d:-d] = True
        gr &= well
        if gl.any() and gr.any():
            m['glyphContrast'] = round(abs(float(L[gl].mean() - L[gr].mean())) * 255, 1)
        m['glyphCover'] = round(float((g > 0.5).mean()), 3)
        m['_vec'] = vec24(g)
    elif form == 'legacy':
        m['_vec'] = vec24(L)
    else:
        m['_vec'] = vec24(L * al + 0.5 * (1 - al))
    return m


def judge(item: dict, m: dict, prof: dict) -> tuple[list[str], list[str]]:
    fails, warns = [], []
    form = item.get('form', 'cutout')
    if form in ('tile', 'cutout') and m['corner'] > prof['corner']:
        fails.append(f'corner alpha {m["corner"]} > {prof["corner"]}')
    if form == 'cutout':
        if m['ring'] > prof['ring']:
            fails.append(f'edge ring alpha {m["ring"]} > {prof["ring"]} (cropped or touching the border)')
        if not (prof['fillMin'] <= m['fill'] <= prof['fillMax']):
            fails.append(f'fill {m["fill"]} outside {prof["fillMin"]}..{prof["fillMax"]}')
    if form in ('cutout', 'legacy') and prof.get('lumaFloor'):
        lum, val = m.get('lumaIn', m['luma']), m.get('valueIn', 0.0)
        if lum < prof['lumaFloor'] and val < prof.get('valueFloor', 150):
            fails.append(f'interior luma {lum} < {prof["lumaFloor"]} and value {val} < {prof.get("valueFloor", 150)} (dark on dark)')
    if form == 'tile':
        if 'glyphContrast' not in m:
            warns.append('no glyph mask (cannot check the glyph contrast)')
        elif m['glyphContrast'] < prof['glyphContrast']:
            fails.append(f'glyph contrast {m["glyphContrast"]} < {prof["glyphContrast"]}')
    return fails, warns


def sheet(items: list[dict], dst: Path, title: str) -> None:
    grounds = [(13, 10, 8), (42, 34, 25), (138, 138, 128)]
    cell_w = 48 * 3 + 64 * 3 + 7 * 4
    f = font(11)
    rows = len(items)
    im = Image.new('RGB', (cell_w + 230, rows * 72 + 30), (18, 15, 12))
    d = ImageDraw.Draw(im)
    d.text((6, 6), title, fill=(230, 210, 160), font=f)
    for i, it in enumerate(items):
        y = 26 + i * 72
        icon = Image.open(it['path']).convert('RGBA')
        x = 6
        for sz in (48, 64):
            s = icon.resize((sz, sz), Image.Resampling.LANCZOS)
            for g in grounds:
                bg = Image.new('RGB', (sz, sz), g)
                bg.paste(s, (0, 0), s)
                im.paste(bg, (x, y + (64 - sz)))
                x += sz + 4
        col = (230, 90, 80) if it.get('fails') else (220, 200, 90) if it.get('warns') else (110, 210, 120)
        d.text((x + 6, y + 4), it['id'][:30], fill=col, font=f)
        d.text((x + 6, y + 20), '; '.join(it.get('fails') or it.get('warns') or ['ok'])[:34], fill=(170, 165, 150), font=f)
        d.text((x + 6, y + 36), (it.get('why') or '')[:34], fill=(170, 165, 150), font=f)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst)


def main() -> None:
    args = sys.argv[1:]
    prof_path = None
    if '--profile' in args:
        i = args.index('--profile')
        prof_path = args[i + 1]
        del args[i : i + 2]
    items_path, outdir = args[0], Path(args[1])
    spec = json.loads(Path(items_path).read_text(encoding='utf-8'))
    coll = spec.get('collection', 'icons')
    prof = dict(DEFAULTS)
    if prof_path and os.path.exists(prof_path):
        p = json.loads(Path(prof_path).read_text(encoding='utf-8'))
        prof.update(p.get('default', {}))
        prof.update(p.get('collections', {}).get(coll, {}))
    items = [it for it in spec['items'] if os.path.exists(it['path'])]
    missing = [it['id'] for it in spec['items'] if not os.path.exists(it['path'])]
    results = []
    for it in items:
        m = metrics(it, prof)
        fails, warns = judge(it, m, prof)
        results.append({**it, 'metrics': m, 'fails': fails, 'warns': warns})
    # duplicates
    pairs = []
    for i in range(len(results)):
        for j in range(i + 1, len(results)):
            a, b = results[i], results[j]
            if a['metrics']['_vec'].shape != b['metrics']['_vec'].shape:
                continue
            r = float(a['metrics']['_vec'] @ b['metrics']['_vec'])
            if r > prof['dup'] - 0.1:
                pairs.append({'a': a['id'], 'b': b['id'], 'r': round(r, 3)})
            if r > prof['dup'] and b['id'] not in (a.get('pairOk') or []) and a['id'] not in (b.get('pairOk') or []):
                a['fails'].append(f'looks like {b["id"]} (r {r:.2f})')
                b['fails'].append(f'looks like {a["id"]} (r {r:.2f})')
    # clusters of near-duplicates (calibration view)
    parent = {r['id']: r['id'] for r in results}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for p in pairs:
        if p['r'] > prof['dup']:
            parent[find(p['a'])] = find(p['b'])
    groups: dict[str, list[str]] = {}
    for r in results:
        groups.setdefault(find(r['id']), []).append(r['id'])
    clusters = sorted([g for g in groups.values() if len(g) > 1], key=len, reverse=True)
    # hue bands
    bands: dict[int, list[str]] = {}
    for r in results:
        h = r['metrics'].get('hue')
        if h is not None:
            bands.setdefault(int(h // 40), []).append(r['id'])
    if prof.get('huePerBand'):
        for k, ids in bands.items():
            if len(ids) > prof['huePerBand']:
                for r in results:
                    if r['id'] in ids:
                        r['warns'].append(f'hue band {k * 40}-{k * 40 + 40} shared by {len(ids)} icons')
    for r in results:
        r['metrics'].pop('_vec', None)
    outdir.mkdir(parents=True, exist_ok=True)
    sheets = []
    per = 24
    for n, i in enumerate(range(0, len(results), per), 1):
        dst = outdir / f'{coll}_48_64_{n}.png'
        sheet(results[i : i + per], dst, f'{coll} - {spec.get("source", "")} - 48 px | 64 px on night / slot plate / grey')
        sheets.append(str(dst).replace('\\', '/'))
    report = {
        'collection': coll,
        'source': spec.get('source'),
        'profile': prof,
        'n': len(results),
        'missing': missing,
        'failed': sorted(r['id'] for r in results if r['fails']),
        'clusters': clusters,
        'pairs': sorted(pairs, key=lambda p: -p['r'])[:60],
        'hueBands': {f'{k * 40}-{k * 40 + 40}': v for k, v in sorted(bands.items())},
        'results': results,
        'sheets': sheets,
    }
    (outdir / f'{coll}_report.json').write_text(json.dumps(report, indent=1), encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('collection', 'n', 'missing', 'failed', 'clusters', 'sheets')} | {'pairsTop': report['pairs'][:10], 'report': str(outdir / f'{coll}_report.json').replace('\\', '/')}))


if __name__ == '__main__':
    main()

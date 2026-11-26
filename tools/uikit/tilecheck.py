"""Seam + band check of the kit v1 tileable materials (uk_board, uk_rust, uk_stone, uk_lattice).

Usage:  python tools/uikit/tilecheck.py [--out .research/ui_core/B-kit/tiles]
Reads the shipped WebPs through apps/game/public/assets/manifest/textures.json, writes a 2x2 tiling of each (the seam
must be invisible) and prints: wrap-seam ratio (edge-pair difference / typical neighbour difference, 1.0 = invisible),
mean luma, mean saturation (HSV, 0..255) and luma std. Board anchors (Target board_base measured luma 25.5 / sat 34 /
std 8.6; our band luma 20-32, sat 25-50, std 6-12) apply to the board tile composited with the kit veil (kit.css).
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PUB = os.path.join(ROOT, 'apps', 'game', 'public')
IDS = ['uk_board', 'uk_rust', 'uk_stone', 'uk_lattice']


def seam_ratio(a: np.ndarray) -> float:
    g = a.astype(np.float32).mean(axis=2)
    # wrap seam (last column vs first) against the typical neighbour difference inside the tile
    sx = np.abs(g[:, -1] - g[:, 0]).mean()
    sy = np.abs(g[-1, :] - g[0, :]).mean()
    nx = np.abs(np.diff(g, axis=1)).mean()
    ny = np.abs(np.diff(g, axis=0)).mean()
    return float(((sx / max(nx, 1e-6)) + (sy / max(ny, 1e-6))) / 2)


def stats(a: np.ndarray, veil=None):
    rgb = a.astype(np.float32)
    if veil is not None:
        r, g, b, al = veil
        rgb = rgb * (1 - al) + np.array([r, g, b], dtype=np.float32) * al
    luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0) * 255
    return float(luma.mean()), float(sat.mean()), float(luma.std())


def main() -> int:
    out = '.research/ui_core/B-kit/tiles'
    if '--out' in sys.argv:
        out = sys.argv[sys.argv.index('--out') + 1]
    os.makedirs(out, exist_ok=True)
    man = json.load(open(os.path.join(PUB, 'assets', 'manifest', 'textures.json'), encoding='utf-8'))
    tex = man.get('textures', man)
    bad = 0
    for i in IDS:
        e = tex.get(i)
        if not e:
            print(f'{i}: not in manifest')
            bad += 1
            continue
        im = Image.open(os.path.join(PUB, e['url'])).convert('RGB')
        a = np.array(im)
        r = seam_ratio(a)
        l, s, sd = stats(a)
        line = f'{i}: {im.size[0]}x{im.size[1]} seam={r:.2f} luma={l:.1f} sat={s:.1f} std={sd:.1f}'
        if i == 'uk_board':
            # kit.css lays rgba(23,22,21,.36) over the tile
            l2, s2, sd2 = stats(a, (23, 22, 21, 0.36))
            line += f'  | with kit veil luma={l2:.1f} sat={s2:.1f} std={sd2:.1f}'
        print(line + ('  OK' if r <= 1.3 else '  SEAM > 1.3'))
        if r > 1.3:
            bad += 1
        w, h = im.size
        sheet = Image.new('RGB', (w * 2, h * 2))
        for y in range(2):
            for x in range(2):
                sheet.paste(im, (x * w, y * h))
        sheet.save(os.path.join(out, f'{i}_2x2.png'))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())

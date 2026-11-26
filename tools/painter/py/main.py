"""painter python stages. Usage: python main.py <sheet|bake> --key value ..."""
from __future__ import annotations

import argparse
import json
import sys

sys.path.insert(0, __import__('os').path.dirname(__file__))


def parse_size(s: str) -> tuple[int, int]:
    w, h = s.lower().split('x')
    return int(w), int(h)


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('sheet')
    s.add_argument('--mesh', required=True)
    s.add_argument('--out', required=True)
    s.add_argument('--views', default='left,right,front,back,top,3q')
    s.add_argument('--canvas', default='1536x1024')
    s.add_argument('--guide', default='clay', choices=['clay', 'albedo'])
    s.add_argument('--bg', default=None)
    s.add_argument('--ss', type=int, default=2)
    pb = sub.add_parser('probe-bg')
    pb.add_argument('--image', required=True)
    b = sub.add_parser('bake')
    b.add_argument('--mesh', required=True)
    b.add_argument('--work', required=True)
    b.add_argument('--painted', required=True)
    b.add_argument('--out', required=True)
    b.add_argument('--tex', type=int, default=0)
    b.add_argument('--ss', type=int, default=2)
    b.add_argument('--facing-power', type=float, default=4.0)
    b.add_argument('--no-align', action='store_true')
    b.add_argument('--webp-quality', type=int, default=92)
    b.add_argument('--target-median', type=float, default=0.46)
    b.add_argument('--max-gain', type=float, default=1.45)
    a = ap.parse_args()
    if a.cmd == 'sheet':
        from sheetlib import build_sheet
        res = build_sheet(a.mesh, a.out, a.views.split(','), parse_size(a.canvas), a.guide, a.bg, a.ss)
        print(json.dumps(res))
    elif a.cmd == 'probe-bg':
        import numpy as np
        from PIL import Image
        from sheetlib import BG_CANDIDATES
        im = np.asarray(Image.open(a.image).convert('RGB'), dtype=np.float32)
        border = np.concatenate([im[:12].reshape(-1, 3), im[-12:].reshape(-1, 3), im[:, :12].reshape(-1, 3), im[:, -12:].reshape(-1, 3)])
        med = np.median(border, axis=0)
        best = min(BG_CANDIDATES, key=lambda c: float(np.linalg.norm(np.array(c, dtype=np.float32) - med)))
        print(json.dumps(dict(bg='#%02x%02x%02x' % best)))
    elif a.cmd == 'bake':
        from bakelib import run_bake
        res = run_bake(a)
        print(json.dumps(res))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Assemble square part images into a cols×rows sheet.

usage: compose.py <out.png> <cols> <rows> <cell> <part1.png> <part2.png> ...
Each part is resized (Lanczos) to cell×cell and pasted in row-major order on a black canvas.
"""
from __future__ import annotations

import sys

from PIL import Image


def main() -> None:
    out, cols, rows, cell = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    parts = sys.argv[5:]
    if len(parts) != cols * rows:
        raise SystemExit(f'expected {cols * rows} parts, got {len(parts)}')
    sheet = Image.new('RGB', (cols * cell, rows * cell), (0, 0, 0))
    for i, p in enumerate(parts):
        im = Image.open(p).convert('RGB').resize((cell, cell), Image.Resampling.LANCZOS)
        sheet.paste(im, ((i % cols) * cell, (i // cols) * cell))
    sheet.save(out)
    print(out)


if __name__ == '__main__':
    main()

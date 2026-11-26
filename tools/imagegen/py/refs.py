#!/usr/bin/env python3
"""Prepare reference images for `codex exec -i` (dev only; the prepared PNGs never ship).

usage: refs.py <out_dir> <src> [<src> ...]

For each source Pillow can open (png/jpg/webp/bmp) writes <out_dir>/<stem>.<hash8>.png — an RGB view that
shows the element the way it reads in game — and prints one JSON list on stdout:
  [{"src", "out", "w", "h", "mode", "view", "stretch"}]

view:
  rgb         alpha unused (opaque or near-opaque everywhere) -> the colour channels as they are
  over-black  the form lives in alpha and the colour is light (glows, additive particles) -> rgb * alpha on black
  over-grey   the form lives in alpha and the colour is dark (black smoke, soot) -> composited over light grey,
              otherwise the model would be shown a black square
stretch: gain applied to very dim rgb/over-black views (99.5th luminance percentile < 0.2 -> scaled to 0.85), else 1.
Views are capped at 2048 px on the long side. Cached by content hash + PREP_VERSION (an existing output is reused).
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import sys
import time

import numpy as np
from PIL import Image

PREP_VERSION = b'refprep-1'
LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float32)
MAX_SIDE = 2048


def prepare(src: str, out_dir: str) -> dict:
    data = open(src, 'rb').read()
    digest = hashlib.sha256(data + PREP_VERSION).hexdigest()[:8]
    stem = re.sub(r'[^A-Za-z0-9_-]+', '_', os.path.splitext(os.path.basename(src))[0]).strip('_')[:48] or 'ref'
    out = os.path.join(out_dir, f'{stem}.{digest}.png')
    meta_path = out + '.json'
    if os.path.exists(out) and os.path.exists(meta_path):
        with open(meta_path, encoding='utf8') as f:
            meta = json.load(f)
        meta['src'] = src
        return meta

    im = Image.open(io.BytesIO(data))
    im.load()
    mode = im.mode
    rgba = np.asarray(im.convert('RGBA')).astype(np.float32) / 255.0
    rgb, a = rgba[..., :3], rgba[..., 3]
    lum = rgb @ LUMA
    if (a < 0.9).mean() <= 0.005:
        view, kind = rgb, 'rgb'
    else:
        lum_w = float((lum * a).sum() / max(float(a.sum()), 1e-6))  # alpha-weighted brightness of the element colour
        if lum_w < 0.2:
            view, kind = rgb * a[..., None] + 0.72 * (1.0 - a[..., None]), 'over-grey'
        else:
            view, kind = rgb * a[..., None], 'over-black'
    stretch = 1.0
    if kind != 'over-grey':
        p = float(np.percentile(view @ LUMA, 99.5))
        if 1e-4 < p < 0.2:
            stretch = round(0.85 / p, 3)
            view = view * stretch
    out_im = Image.fromarray((np.clip(view, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8))
    if max(out_im.size) > MAX_SIDE:
        s = MAX_SIDE / max(out_im.size)
        out_im = out_im.resize((max(1, round(out_im.width * s)), max(1, round(out_im.height * s))), Image.Resampling.LANCZOS)
    os.makedirs(out_dir, exist_ok=True)
    meta = {'src': src, 'out': out, 'w': out_im.width, 'h': out_im.height, 'mode': mode, 'view': kind, 'stretch': stretch}
    # several gen runs may prepare the same reference at once: write to a private temp name, then rename
    tmp = f'{out}.{os.getpid()}.tmp'
    out_im.save(tmp, 'PNG')
    with open(meta_path + f'.{os.getpid()}.tmp', 'w', encoding='utf8') as f:
        json.dump(meta, f, indent=1)
    for src_tmp, dst in ((tmp, out), (meta_path + f'.{os.getpid()}.tmp', meta_path)):
        for attempt in range(20):
            try:
                os.replace(src_tmp, dst)
                break
            except PermissionError:  # Windows: the target is open in another process (codex attaching it)
                if attempt == 19:
                    if os.path.exists(dst):  # an identical file from a concurrent run is already in place
                        os.remove(src_tmp)
                        break
                    raise
                time.sleep(0.1)
    return meta


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    out_dir, srcs = sys.argv[1], sys.argv[2:]
    print(json.dumps([prepare(s, out_dir) for s in srcs]))


if __name__ == '__main__':
    main()

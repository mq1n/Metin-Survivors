#!/usr/bin/env python3
"""Chroma-key a flat magenta (#FF00FF) background to real alpha (for engines without transparent output, e.g. Gemini).

  python tools/imagegen/py/keymagenta.py <in> <out.png>

Alpha comes from the colour distance to pure magenta (soft ramp, so anti-aliased edges keep partial alpha), then the
magenta spill is removed from semi-transparent edge pixels (green channel floor) and fully transparent texels get black RGB.
"""
from __future__ import annotations

import sys

import numpy as np
from PIL import Image


def key(src: str, dst: str) -> None:
    im = Image.open(src).convert("RGB")
    a = np.asarray(im).astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # distance to magenta in a magenta-sensitive space: magenta = high r, high b, low g
    mag = np.clip(np.minimum(r, b) - g, 0.0, 1.0)  # 1 for pure magenta, 0 for neutral / green / non-magenta hues
    dist = 1.0 - mag
    t0, t1 = 0.18, 0.55  # dist below t0 = background, above t1 = opaque subject
    alpha = np.clip((dist - t0) / (t1 - t0), 0.0, 1.0)
    # despill: pull the magenta cast out of edge pixels (r, b down toward g where the pixel was partly background)
    spill = (1.0 - alpha)[..., None]
    rgb = a.copy()
    lim = np.maximum(g, 0.0)
    rgb[..., 0] = r - (r - np.maximum(lim, r * alpha)) * spill[..., 0]
    rgb[..., 2] = b - (b - np.maximum(lim, b * alpha)) * spill[..., 0]
    rgb[alpha <= 0.0] = 0.0
    out = np.dstack([np.clip(rgb, 0, 1), alpha])
    Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), "RGBA").save(dst)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    key(sys.argv[1], sys.argv[2])
    print(sys.argv[2])

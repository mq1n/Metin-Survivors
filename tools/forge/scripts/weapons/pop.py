"""python pop.py <in.webp|png> <out.webp> [sat=1.15] [gamma=0.7] [sharp=1.0]
Hero albedo clarity pass on a painter cache texture (run on the gain-1.0 bake): saturation boost about luminance, a shadow-lifting
luminance gamma (dark outfits stop collapsing into a blob; bright skin barely moves, so no chalk), then a gentle unsharp mask to fight the
view-blend softness of the projection bake. Hue is preserved (luminance-ratio scaling)."""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
kv = dict(a.split('=') for a in sys.argv[3:])
sat, gam, sharp = float(kv.get('sat', 1.15)), float(kv.get('gamma', 0.7)), float(kv.get('sharp', 1.0))

W = np.array([0.2126, 0.7152, 0.0722], np.float32)
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(np.float32) / 255.0
lum = (a @ W)[..., None]
a = np.clip(lum + (a - lum) * sat, 0, 1)
lum2 = (a @ W)[..., None]
tgt = np.power(np.maximum(lum2, 1e-4), gam)
a = a * (tgt / np.maximum(lum2, 1e-4))
mx = a.max(axis=-1, keepdims=True)
a = a / np.maximum(1.0, mx)  # keep inside gamut, hue preserved
out = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
if sharp > 0:
    out = out.filter(ImageFilter.UnsharpMask(radius=2.0, percent=int(90 * sharp), threshold=2))
out.save(dst, quality=94, method=6)
print(dst, out.size)

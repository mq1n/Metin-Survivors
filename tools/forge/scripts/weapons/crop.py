"""python crop.py <out.png> <height> img1 img2 ...  — crop each image to its non-background bbox, scale to height, tile horizontally."""
import sys
from PIL import Image
import numpy as np
out, h = sys.argv[1], int(sys.argv[2])
ims = []
for f in sys.argv[3:]:
    im = Image.open(f).convert('RGB')
    a = np.array(im).astype(int)
    bg = a[5, 5]
    d = np.abs(a - bg).sum(axis=2) > 60
    ys, xs = np.where(d)
    if len(xs) == 0:
        ims.append(im)
        continue
    ims.append(im.crop((max(0, xs.min() - 8), max(0, ys.min() - 8), xs.max() + 8, ys.max() + 8)))
ims = [i.resize((max(1, int(i.width * h / i.height)), h), Image.LANCZOS) for i in ims]
W = sum(i.width for i in ims)
s = Image.new('RGB', (W, h), (30, 30, 34))
x = 0
for i in ims:
    s.paste(i, (x, 0))
    x += i.width
s.save(out)
print(out, s.size)

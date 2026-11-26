"""python montage.py <out.png> <cols> <tile_w> <label?> img1 img2 ...   — grid contact sheet (resizes each tile to tile_w, keeps aspect)."""
import sys
from PIL import Image, ImageDraw
out, cols, tw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
imgs = []
for f in files:
    label = None
    if '::' in f:
        f, label = f.split('::', 1)
    im = Image.open(f).convert('RGB')
    th = int(im.height * tw / im.width)
    im = im.resize((tw, th), Image.LANCZOS)
    if label:
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, 8 + 7 * len(label), 16], fill=(0, 0, 0))
        d.text((4, 2), label, fill=(255, 255, 255))
    imgs.append(im)
rows = (len(imgs) + cols - 1) // cols
th = max(i.height for i in imgs)
sheet = Image.new('RGB', (cols * tw, rows * th), (20, 20, 24))
for i, im in enumerate(imgs):
    sheet.paste(im, ((i % cols) * tw, (i // cols) * th))
sheet.save(out)
print(out, sheet.size)

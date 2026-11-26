#!/usr/bin/env python3
"""Image composition helpers for builders and critics (dev only, never shipped).

  python tools/qa/compose.py grid --out sheet.png --cols 3 --width 640 [--labels] a.png b.png c.png
      contact sheet; --labels prints each file's stem above its tile
  python tools/qa/compose.py ab --a old.png --b new.png --out pair.png --key key.json [--width 960] [--swap auto|0|1]
      BLIND pair for a critic: the two images are shuffled to LEFT/RIGHT (labels "LEFT"/"RIGHT" only); which source went
      where is written to key.json — the builder keeps the key, the critic only ever sees pair.png
  python tools/qa/compose.py crop --in big.png --out crop.png --box x,y,w,h
  python tools/qa/compose.py stats --in shot.png
      mean luminance, contrast, saturation and the 6 dominant colours (quick sanity numbers for palettes)
  python tools/qa/compose.py diff --a old.png --b new.png [--box x,y,w,h] [--out heat.png]
      regression check: mean absolute pixel difference (mad_pct = % of full scale), max, share of changed pixels (> 8/255)
  python tools/qa/compose.py measure --in shot.png [--box x,y,w,h] [--ppm 67.4 --norm 17.4] [--near '#rrggbb' --de 4]
      numbers for zone gates (tools/qa/zonecheck.ts): mean_luma, mean_saturation, dark_frac (luma < 10), hf (high-frequency
      energy relative to the mean luma, measured after resizing the crop from --ppm to --norm pixels per metre so ours and
      a reference crop are compared at the same ground scale), fine (pixel-scale / 2-4 px energy: screen-door dither reads
      high), flat_frac (featureless pixels: void / fog wall), near_frac (pixels within ΔE76 --de of --near)
(numpy is needed by diff/measure only)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageStat


def _font(size: int) -> ImageFont.ImageFont:
    for f in ("C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/arial.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def _fit(im: Image.Image, width: int) -> Image.Image:
    if im.width == width:
        return im
    h = max(1, round(im.height * width / im.width))
    return im.resize((width, h), Image.LANCZOS)


def grid(files: list[str], out: str, cols: int, width: int, labels: bool) -> None:
    ims = [_fit(Image.open(f).convert("RGB"), width) for f in files]
    lab_h = 26 if labels else 0
    rows = (len(ims) + cols - 1) // cols
    cell_h = max(im.height for im in ims) + lab_h
    sheet = Image.new("RGB", (cols * width + (cols - 1) * 6, rows * cell_h + (rows - 1) * 6), (12, 12, 14))
    d = ImageDraw.Draw(sheet)
    fnt = _font(16)
    for i, (f, im) in enumerate(zip(files, ims)):
        x = (i % cols) * (width + 6)
        y = (i // cols) * (cell_h + 6)
        if labels:
            d.text((x + 6, y + 4), Path(f).stem[:80], fill=(240, 220, 160), font=fnt)
        sheet.paste(im, (x, y + lab_h))
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(out)


def ab(a: str, b: str, out: str, key: str, width: int, swap_opt: str = "auto") -> None:
    # --swap auto: random side; 0: a LEFT / b RIGHT; 1: b LEFT / a RIGHT (reuse one orientation for every pair of a round,
    # so the critic sees the same version on the same side everywhere)
    if swap_opt in ("0", "1"):
        swap = swap_opt == "1"
    else:
        seed = int(hashlib.sha256(f"{a}|{b}|{time.time_ns()}|{os.getpid()}".encode()).hexdigest()[:8], 16)
        swap = random.Random(seed).random() < 0.5
    left, right = (b, a) if swap else (a, b)
    ims = [_fit(Image.open(p).convert("RGB"), width) for p in (left, right)]
    h = max(im.height for im in ims)
    sheet = Image.new("RGB", (width * 2 + 12, h + 34), (12, 12, 14))
    d = ImageDraw.Draw(sheet)
    fnt = _font(20)
    for i, (name, im) in enumerate(zip(("LEFT", "RIGHT"), ims)):
        x = i * (width + 12)
        d.text((x + 8, 6), name, fill=(240, 220, 160), font=fnt)
        sheet.paste(im, (x, 34))
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    Path(key).parent.mkdir(parents=True, exist_ok=True)
    Path(key).write_text(json.dumps({"LEFT": left, "RIGHT": right, "a": a, "b": b, "swap": 1 if swap else 0}, indent=1))
    print(json.dumps({"pair": out, "key": key}))


def crop(src: str, out: str, box: str) -> None:
    x, y, w, h = (int(v) for v in box.split(","))
    Image.open(src).crop((x, y, x + w, y + h)).save(out)
    print(out)


def stats(src: str) -> None:
    im = Image.open(src).convert("RGB")
    small = im.resize((256, max(1, round(256 * im.height / im.width))))
    hsv = small.convert("HSV")
    lum = ImageStat.Stat(small.convert("L"))
    sat = ImageStat.Stat(hsv.split()[1])
    pal = small.quantize(6, method=Image.Quantize.MEDIANCUT)
    counts = sorted(pal.getcolors() or [], reverse=True)
    p = pal.getpalette() or []
    cols = [("#%02x%02x%02x" % tuple(p[i * 3:i * 3 + 3]), round(c / (small.width * small.height), 3)) for c, i in counts]
    print(json.dumps({"mean_luma": round(lum.mean[0], 1), "contrast_std": round(lum.stddev[0], 1),
                      "mean_saturation": round(sat.mean[0], 1), "dominant": cols}))


def _box(s: str | None) -> tuple[int, int, int, int] | None:
    if not s:
        return None
    x, y, w, h = (int(round(float(v))) for v in s.split(","))
    return x, y, w, h


def _open_rgb(src: str, box: tuple[int, int, int, int] | None) -> Image.Image:
    im = Image.open(src).convert("RGB")
    if box:
        x, y, w, h = box
        im = im.crop((max(0, x), max(0, y), min(im.width, x + w), min(im.height, y + h)))
    return im


def _luma(arr):  # ITU-R 601 luma, same weights as PIL "L"
    return arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114


def _boxmean(a, r: int):
    """mean over a (2r+1)^2 window (edge-padded), float64 integral image"""
    import numpy as np

    p = np.pad(a.astype(np.float64), r + 1, mode="edge")
    c = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return (s / (k * k))[: a.shape[0], : a.shape[1]]


def _lab(arr):
    import numpy as np

    c = arr / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    x = (c[..., 0] * 0.4124 + c[..., 1] * 0.3576 + c[..., 2] * 0.1805) / 0.95047
    y = c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722
    z = (c[..., 0] * 0.0193 + c[..., 1] * 0.1192 + c[..., 2] * 0.9505) / 1.08883

    def f(t):
        return np.where(t > 0.008856, np.cbrt(t), 7.787 * t + 16.0 / 116.0)

    fx, fy, fz = f(x), f(y), f(z)
    return np.stack([116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)], axis=-1)


def diff(a: str, b: str, box: str | None, out: str | None) -> int:
    import numpy as np

    bx = _box(box)
    A = np.asarray(_open_rgb(a, bx), dtype=np.float32)
    B = np.asarray(_open_rgb(b, bx), dtype=np.float32)
    if A.shape != B.shape:
        print(json.dumps({"error": f"size mismatch {A.shape} vs {B.shape}"}))
        return 1
    d = np.abs(A - B)
    px = d.max(axis=2)
    print(json.dumps({"mad_pct": round(float(d.mean()) / 255 * 100, 4), "max": int(px.max()),
                      "changed_frac": round(float((px > 8).mean()), 5)}))
    if out:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.clip(px * 4, 0, 255).astype(np.uint8)).save(out)
    return 0


def measure(src: str, box: str | None, ppm: float | None, norm: float | None, near: str | None, de: float) -> None:
    import numpy as np
    from PIL import ImageFilter

    im = _open_rgb(src, _box(box))
    A = np.asarray(im, dtype=np.float32)
    L = _luma(A)
    mean_l = float(L.mean())
    sat = float(np.asarray(im.convert("HSV"), dtype=np.float32)[..., 1].mean())
    # high-frequency energy at a common ground scale: resize ppm -> norm px/m, then |L - blur(L)| relative to the mean
    sm = im
    if ppm and norm and abs(ppm - norm) > 1e-6:
        k = norm / ppm
        sm = im.resize((max(8, round(im.width * k)), max(8, round(im.height * k))), Image.LANCZOS)
    Ls = np.asarray(sm.convert("L"), dtype=np.float32)
    Lb = np.asarray(sm.convert("L").filter(ImageFilter.GaussianBlur(1.5)), dtype=np.float32)
    hf_abs = float(np.abs(Ls - Lb).mean())
    # pixel-scale vs 2-4 px energy at full resolution (screen-door dither / stipple is all pixel-scale)
    lim = Image.fromarray(np.clip(L, 0, 255).astype(np.uint8))
    l1 = np.asarray(lim.filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float32)
    l3 = np.asarray(lim.filter(ImageFilter.GaussianBlur(2.5)), dtype=np.float32)
    e1 = float(np.abs(L - l1).mean())
    e2 = float(np.abs(l1 - l3).mean())
    # featureless pixels: 5x5 local luma std below 1.2 (flat fog / void reads as zero texture)
    var = np.maximum(_boxmean(L * L, 2) - _boxmean(L, 2) ** 2, 0)
    res = {"w": im.width, "h": im.height, "mean_luma": round(mean_l, 1), "contrast_std": round(float(L.std()), 1),
           "mean_saturation": round(sat, 1), "dark_frac": round(float((L < 10).mean()), 4),
           "hf": round(hf_abs / max(mean_l, 1.0), 4), "hf_abs": round(hf_abs, 3),
           "fine": round(e1 / max(e2, 1e-3), 3), "flat_frac": round(float((np.sqrt(var) < 1.2).mean()), 4)}
    if near:
        h = near.lstrip("#")
        ref = np.array([[[int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)]]], dtype=np.float32)
        dE = np.sqrt(((_lab(A) - _lab(ref)) ** 2).sum(axis=-1))
        res["near_frac"] = round(float((dE < de).mean()), 4)
        # void / fog wall: featureless AND close to the colour (calm ground is not featureless; fogged texture is not flat)
        res["flat_near_frac"] = round(float(((np.sqrt(var) < 1.2) & (dE < max(de, 12.0))).mean()), 4)
    print(json.dumps(res))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("grid")
    g.add_argument("--out", required=True)
    g.add_argument("--cols", type=int, default=3)
    g.add_argument("--width", type=int, default=640)
    g.add_argument("--labels", action="store_true")
    g.add_argument("files", nargs="+")
    p = sub.add_parser("ab")
    p.add_argument("--a", required=True)
    p.add_argument("--b", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--key", required=True)
    p.add_argument("--width", type=int, default=960)
    p.add_argument("--swap", default="auto", choices=["auto", "0", "1"])
    c = sub.add_parser("crop")
    c.add_argument("--in", dest="src", required=True)
    c.add_argument("--out", required=True)
    c.add_argument("--box", required=True)
    s = sub.add_parser("stats")
    s.add_argument("--in", dest="src", required=True)
    df = sub.add_parser("diff")
    df.add_argument("--a", required=True)
    df.add_argument("--b", required=True)
    df.add_argument("--box")
    df.add_argument("--out")
    m = sub.add_parser("measure")
    m.add_argument("--in", dest="src", required=True)
    m.add_argument("--box")
    m.add_argument("--ppm", type=float)
    m.add_argument("--norm", type=float)
    m.add_argument("--near")
    m.add_argument("--de", type=float, default=4.0)
    a = ap.parse_args(argv)
    if a.cmd == "grid":
        grid(a.files, a.out, a.cols, a.width, a.labels)
    elif a.cmd == "ab":
        ab(a.a, a.b, a.out, a.key, a.width, a.swap)
    elif a.cmd == "crop":
        crop(a.src, a.out, a.box)
    elif a.cmd == "diff":
        return diff(a.a, a.b, a.box, a.out)
    elif a.cmd == "measure":
        measure(a.src, a.box, a.ppm, a.norm, a.near, a.de)
    else:
        stats(a.src)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

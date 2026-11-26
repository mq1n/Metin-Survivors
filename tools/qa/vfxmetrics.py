#!/usr/bin/env python3
"""VFX screen metrics for builders and critics (dev only, never shipped). Pairs with tools/qa/vfxstage.ts (--base).

  python tools/qa/vfxmetrics.py coverage --a base.png --b fx.png [--thr 12] [--box x,y,w,h] [--out heat.png]
      what an effect adds to a frame: changed_pct (share of pixels whose max channel moved > thr/255), bbox of the
      changed region (+ bbox_pct of the frame), mean luma delta over the changed pixels and over the frame, the share
      of pixels pushed to white (luma >= 250 in b but not in a), and the 1080p rule check (no single event may change
      more than 25 % of a 1920x1080 game-camera frame; white-out share should stay under 1 %)
  python tools/qa/vfxmetrics.py selftest
      checks `coverage` on two synthetic images (a known 100x50 patch)
Prints JSON. numpy + Pillow.
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np
from PIL import Image


def _load(path: str, box: tuple[int, int, int, int] | None) -> np.ndarray:
    im = Image.open(path).convert("RGB")
    if box:
        x, y, w, h = box
        im = im.crop((x, y, x + w, y + h))
    return np.asarray(im, dtype=np.int16)


def _luma(a: np.ndarray) -> np.ndarray:
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def coverage_arrays(a: np.ndarray, b: np.ndarray, thr: int = 12) -> dict:
    if a.shape != b.shape:
        raise SystemExit(f"size mismatch {a.shape} vs {b.shape}")
    d = np.abs(b - a).max(axis=2)
    mask = d > thr
    n = int(mask.sum())
    h, w = mask.shape
    la, lb = _luma(a), _luma(b)
    dl = lb - la
    out: dict = {
        "size": [w, h],
        "thr": thr,
        "changed_pct": round(100.0 * n / mask.size, 3),
        "mean_luma_delta_frame": round(float(dl.mean()), 3),
        "mean_luma_delta_changed": round(float(dl[mask].mean()), 3) if n else 0.0,
        "mean_abs_delta_changed": round(float(d[mask].mean()), 3) if n else 0.0,
        "white_pct": round(100.0 * float(((lb >= 250) & (la < 250)).sum()) / mask.size, 3),
        "bbox": None,
        "bbox_pct": 0.0,
    }
    if n:
        ys, xs = np.nonzero(mask)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
        out["bbox"] = [x0, y0, x1 - x0 + 1, y1 - y0 + 1]
        out["bbox_pct"] = round(100.0 * (x1 - x0 + 1) * (y1 - y0 + 1) / mask.size, 3)
    # rule of thumb from the VFX audit (REPORT §3 C5): one event <= 25 % of a 1080p frame, no white-out
    scale = (1920 * 1080) / float(mask.size)
    out["changed_pct_1080p"] = round(out["changed_pct"] / scale, 3) if mask.size != 1920 * 1080 else out["changed_pct"]
    out["ok_coverage"] = out["changed_pct"] <= 25.0
    out["ok_whiteout"] = out["white_pct"] < 1.0
    return out


def coverage(a: str, b: str, thr: int, box: str | None, out: str | None) -> dict:
    bx = tuple(int(v) for v in box.split(",")) if box else None
    A, B = _load(a, bx), _load(b, bx)  # type: ignore[arg-type]
    res = coverage_arrays(A, B, thr)
    if out:
        d = np.abs(B - A).max(axis=2).astype(np.float32)
        heat = np.clip(d * 3, 0, 255).astype(np.uint8)
        rgb = np.stack([heat, (heat * 0.6).astype(np.uint8), np.zeros_like(heat)], axis=2)
        Image.fromarray(rgb).save(out)
        res["heat"] = out
    return res


def selftest() -> dict:
    a = np.full((200, 400, 3), 60, dtype=np.int16)
    b = a.copy()
    b[20:70, 30:130] = 200  # 100 x 50 patch = 5000 px = 6.25 % of 80000
    r = coverage_arrays(a, b, 12)
    ok = r["changed_pct"] == 6.25 and r["bbox"] == [30, 20, 100, 50] and r["mean_luma_delta_changed"] == 140.0
    c = a.copy()
    c[0:200, 0:400] = 255  # full white-out
    r2 = coverage_arrays(a, c, 12)
    ok2 = r2["changed_pct"] == 100.0 and r2["white_pct"] == 100.0 and not r2["ok_coverage"] and not r2["ok_whiteout"]
    return {"patch": r, "whiteout": r2, "pass": bool(ok and ok2)}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="vfxmetrics")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("coverage")
    c.add_argument("--a", required=True, help="frame without the effect (vfxstage --base)")
    c.add_argument("--b", required=True, help="frame with the effect")
    c.add_argument("--thr", type=int, default=12)
    c.add_argument("--box")
    c.add_argument("--out")
    sub.add_parser("selftest")
    args = ap.parse_args(argv)
    if args.cmd == "coverage":
        print(json.dumps(coverage(args.a, args.b, args.thr, args.box, args.out), indent=1))
    else:
        r = selftest()
        print(json.dumps(r, indent=1))
        return 0 if r["pass"] else 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

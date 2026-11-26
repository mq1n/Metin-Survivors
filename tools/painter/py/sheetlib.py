"""Clay turnaround sheet + geometry passes."""
from __future__ import annotations

import json
import os

import cv2
import numpy as np
from PIL import Image

from common import (Mesh, ViewLayout, ViewPass, downsample, hex_to_rgb, load_mesh, make_layout, render_pass, save_png)

CLAY = np.array([0.80, 0.76, 0.70], dtype=np.float32)


BG_CANDIDATES = [(255, 0, 255), (0, 255, 255), (0, 255, 0), (255, 255, 0)]


def pick_bg(mesh: Mesh, forced: str | None) -> tuple[int, int, int]:
    if forced:
        return hex_to_rgb(forced)
    cands = BG_CANDIDATES
    cols = []
    for p in mesh.prims:
        if p.texture is not None:
            a = np.asarray(p.texture.resize((64, 64)), dtype=np.float32).reshape(-1, 3)
            cols.append(a)
    if not cols:
        return cands[0]
    a = np.concatenate(cols)
    best, bd = cands[0], -1.0
    for c in cands:
        d = np.linalg.norm(a - np.array(c, dtype=np.float32), axis=1)
        s = float(np.percentile(d, 3))
        if s > bd:
            best, bd = c, s
    return best


def sample_texture(tex: Image.Image, uv: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """bilinear sample (uv in 0..1, v down as glTF) -> [H,W,3] float 0..1"""
    t = np.asarray(tex, dtype=np.float32) / 255.0
    h, w = t.shape[:2]
    mx = (uv[..., 0] * w - 0.5).astype(np.float32)
    my = (uv[..., 1] * h - 0.5).astype(np.float32)
    out = cv2.remap(t, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    out[~mask] = 0
    return out


def masked_blur(v: np.ndarray, m: np.ndarray, sigma: float) -> np.ndarray:
    mf = m.astype(np.float32)
    num = cv2.GaussianBlur(v * mf, (0, 0), sigma)
    den = cv2.GaussianBlur(mf, (0, 0), sigma)
    return num / np.maximum(den, 1e-4)


def clay_shade(vp: ViewPass, layout: ViewLayout, guide: str, mesh: Mesh) -> tuple[np.ndarray, np.ndarray]:
    """returns (rgb [H,W,3] float, alpha [H,W]) at the pass' supersampled resolution"""
    cam = layout.camera(vp.name)
    m = vp.mask
    n = vp.nrm
    nv = np.stack([n @ cam.right, n @ cam.up, n @ cam.d], axis=-1)  # view-space normal (z toward camera)
    L = np.array([-0.45, 0.62, 0.64], dtype=np.float32)
    L /= np.linalg.norm(L)
    ndl = np.clip(nv @ L, 0, 1)
    wrap = np.clip((nv @ L) * 0.5 + 0.5, 0, 1)
    hemi = n[..., 1] * 0.5 + 0.5  # world-up sky light
    shade = 0.26 + 0.50 * ndl ** 0.9 + 0.22 * wrap ** 2 * 0.5 + 0.20 * hemi
    # screen-space AO from the depth buffer: pixels deeper than their neighbourhood are occluded (radii scale with model size)
    u = max(mesh.height, 0.2) / 0.87
    scale = layout.scale * vp.ss
    z = np.where(m, vp.depth, 0).astype(np.float32)
    ao = np.zeros_like(z)
    for rad_m, k in ((0.012 * u, 0.8), (0.03 * u, 0.6), (0.07 * u, 0.4)):
        s = max(1.0, rad_m * scale)
        zb = masked_blur(z, m, s)
        ao += np.clip((z - zb) / rad_m, 0, 1) * k
    ao = np.clip(1.0 - ao * 0.42, 0.35, 1.0)
    base = np.broadcast_to(CLAY, nv.shape).copy()
    if guide == 'albedo':
        for p in mesh.prims:
            if p.texture is None or p.uv is None:
                continue
            sel = vp.prim == p.index
            if sel.any():
                base[sel] = sample_texture(p.texture, vp.uv, m)[sel]
    rgb = base * (shade * ao)[..., None]
    # subtle outline: silhouette + depth discontinuities
    dz_thr = 0.028 * u
    dz = np.zeros_like(z)
    zz = np.where(m, vp.depth, np.nan)
    for dy, dx in ((0, 1), (1, 0)):
        a = np.roll(zz, (dy, dx), axis=(0, 1))
        dz = np.fmax(dz, np.abs(zz - a))
        a = np.roll(zz, (-dy, -dx), axis=(0, 1))
        dz = np.fmax(dz, np.abs(zz - a))
    edge_depth = (np.nan_to_num(dz, nan=0.0) > dz_thr) & m
    er = cv2.erode(m.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    edge_sil = m & ~er
    edge = (edge_depth | edge_sil).astype(np.float32)
    k = max(1, int(round(vp.ss * 0.8)))
    edge = cv2.GaussianBlur(cv2.dilate(edge, np.ones((k, k), np.uint8)), (0, 0), 0.6 * vp.ss)
    edge = np.clip(edge * 1.0, 0, 1)[..., None] * 0.55
    rgb = rgb * (1 - edge) + (rgb * 0.18) * edge
    return np.clip(rgb, 0, 1), m.astype(np.float32)


def render_sheet(mesh: Mesh, layout: ViewLayout, passes: dict[str, ViewPass], guide: str) -> np.ndarray:
    W, H = layout.canvas
    bg = np.array(layout.bg, dtype=np.float32) / 255.0
    img = np.zeros((H, W, 3), dtype=np.float32) + bg
    for name, vp in passes.items():
        rgb, a = clay_shade(vp, layout, guide, mesh)
        rgb = downsample(rgb * a[..., None], vp.ss)
        a = downsample(a, vp.ss)
        ss_rgb = rgb  # premultiplied
        img = ss_rgb + img * (1 - a[..., None])
    return img


def write_passes(layout: ViewLayout, passes: dict[str, ViewPass], out_dir: str) -> None:
    """UV pass (R=u, G=v, B=depth), view-space normal pass and a labelled preview; plus the raw float data."""
    W, H = layout.canvas
    ss = next(iter(passes.values())).ss
    uvp = np.zeros((H, W, 3), dtype=np.float32)
    nrm = np.zeros((H, W, 3), dtype=np.float32)
    dep = np.zeros((H, W), dtype=np.float32)
    raw = {}
    for name, vp in passes.items():
        cam = layout.camera(name)
        r = layout.views[name]['rect']
        x0, y0, x1, y1 = int(r[0]), int(r[1]), int(r[0] + r[2]) + 1, int(r[1] + r[3]) + 1
        m = downsample(vp.mask.astype(np.float32), ss) > 0.5
        uv = downsample(vp.uv, ss)
        n = vp.nrm
        nv = np.stack([n @ cam.right, n @ cam.up, n @ cam.d], axis=-1)
        nv = downsample(nv, ss)
        d = downsample(np.where(vp.mask, vp.depth, 0).astype(np.float32), ss)
        dmin, dmax = (float(d[m].min()), float(d[m].max())) if m.any() else (0.0, 1.0)
        dn = np.where(m, 1 - (d - dmin) / max(dmax - dmin, 1e-6), 0)
        sl = (slice(max(y0, 0), min(y1, H)), slice(max(x0, 0), min(x1, W)))
        uvp[sl][m[sl]] = np.concatenate([uv[sl][m[sl]], dn[sl][m[sl], None]], axis=1)
        nrm[sl][m[sl]] = (nv[sl][m[sl]] * 0.5 + 0.5)
        dep[sl][m[sl]] = dn[sl][m[sl]]
        raw[f'{name}_uv'] = uv.astype(np.float16)
        raw[f'{name}_nrm'] = nv.astype(np.float16)
        raw[f'{name}_depth'] = d.astype(np.float32)
    save_png(uvp, os.path.join(out_dir, 'pass_uv.png'))
    save_png(nrm, os.path.join(out_dir, 'pass_normal.png'))
    save_png(np.repeat(dep[..., None], 3, axis=2), os.path.join(out_dir, 'pass_depth.png'))
    np.savez_compressed(os.path.join(out_dir, 'passes.npz'), **raw)


def build_sheet(mesh_dir: str, out_dir: str, views: list[str], canvas: tuple[int, int], guide: str, bg: str | None, ss: int = 2) -> dict:
    mesh = load_mesh(mesh_dir)
    os.makedirs(out_dir, exist_ok=True)
    bgc = pick_bg(mesh, bg)
    layout = make_layout(mesh, views, canvas, bgc)
    passes = {n: render_pass(mesh, layout, n, ss) for n in views}
    img = render_sheet(mesh, layout, passes, guide)
    save_png(img, os.path.join(out_dir, 'sheet.png'))
    write_passes(layout, passes, out_dir)
    json.dump(layout.to_json(), open(os.path.join(out_dir, 'layout.json'), 'w'), indent=1)
    return dict(canvas=list(canvas), bg=list(bgc), scale=layout.scale, views=views)

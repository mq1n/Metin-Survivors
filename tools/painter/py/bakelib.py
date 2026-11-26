"""Projection bake: painted turnaround sheet -> UV texture(s). Texel-space inverse projection with depth test."""
from __future__ import annotations

import json
import os

import cv2
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

from alignlib import crop_rect, fit_view, painted_foreground
from common import Mesh, ViewLayout, ViewPass, downsample, load_mesh, render_pass, save_png
from raster import rasterize


def sample_points(img: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """bilinear samples at pixel-index coords (x,y) (1-D arrays); cv2.remap needs bounded map dims, so lay the points out 1024 wide"""
    n = len(x)
    rows = (n + 1023) // 1024
    mx = np.zeros(rows * 1024, dtype=np.float32)
    my = np.zeros(rows * 1024, dtype=np.float32)
    mx[:n] = x
    my[:n] = y
    out = cv2.remap(img, mx.reshape(rows, 1024), my.reshape(rows, 1024), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return out.reshape(rows * 1024, *img.shape[2:])[:n]


def load_painted(path: str, canvas: tuple[int, int]) -> np.ndarray:
    im = Image.open(path).convert('RGB')
    if im.size != canvas:
        ar_a, ar_b = im.size[0] / im.size[1], canvas[0] / canvas[1]
        if abs(ar_a - ar_b) / ar_b > 0.03:
            raise RuntimeError(f'painted image {im.size} has a different aspect than the sheet {canvas}')
        im = im.resize(canvas, Image.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def uv_raster(p, T: int):
    xy = p.uv.astype(np.float64) * T
    tri, bary, _ = rasterize(xy, np.zeros(len(xy)), p.idx, T, T, eps=2e-4)
    return tri, bary


def edge_reliability(vp: ViewPass, u: float, ss: int) -> np.ndarray:
    """distance (in canvas px) to the nearest silhouette / depth discontinuity, at the pass' resolution"""
    m = vp.mask
    zz = np.where(m, vp.depth, np.nan)
    dz = np.zeros(m.shape, dtype=np.float32)
    for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
        a = np.roll(zz, (dy, dx), axis=(0, 1))
        dz = np.fmax(dz, np.abs(zz - a))
    edge = ((np.nan_to_num(dz, nan=0.0) > 0.02 * u) | ~m).astype(np.uint8)
    dist = cv2.distanceTransform(1 - edge, cv2.DIST_L2, 3)
    return dist / ss


class Source:
    """The painted sheet: its layout, our geometry passes, per-view affine fits and the painted image."""

    def __init__(self, mesh: Mesh, work: str, painted_path: str, ss: int, u: float, align: bool):
        self.layout = ViewLayout.from_json(json.load(open(os.path.join(work, 'layout.json'))))
        self.ss = ss
        self.painted = load_painted(painted_path, self.layout.canvas)
        self.fg = painted_foreground(self.painted, self.layout.bg)
        # eroded foreground so samples never reach the flat background
        self.fg_er = cv2.erode(self.fg.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
        self.names = list(self.layout.views)
        self.passes = {n: render_pass(mesh, self.layout, n, ss) for n in self.names}
        self.transforms: dict[str, np.ndarray] = {}
        self.report: dict = {}
        for n in self.names:
            m_ours = downsample(self.passes[n].mask.astype(np.float32), ss) > 0.5
            fit = fit_view(m_ours, self.fg, crop_rect(self.layout, n, 28), allow=align)
            self.transforms[n] = fit['A']
            self.report[n] = dict(iou_before=round(fit['iou0'], 4), iou_after=round(fit['iou1'], 4), aligned=fit['used'], A=np.round(fit['A'], 3).tolist())
        # per-view lookups reused by every primitive
        self.dmin = {n: cv2.erode(np.where(vp.mask, vp.depth, 1e9).astype(np.float32), np.ones((5, 5), np.uint8)) for n, vp in self.passes.items()}
        self.rel = {n: edge_reliability(vp, u, ss) for n, vp in self.passes.items()}


def run_bake(a) -> dict:
    mesh = load_mesh(a.mesh)
    ss = a.ss
    u = max(mesh.height, 0.2) / 0.87
    src = Source(mesh, a.work, a.painted, ss, u, not a.no_align)
    report: dict = dict(views=src.report)
    out_files = []
    prim_stats = []
    for p in mesh.prims:
        if p.uv is None or p.texture is None and not a.tex:
            continue
        T = a.tex or (p.texture.size[0] if p.texture else 1024)
        tri, bary = uv_raster(p, T)
        cov = tri >= 0
        ys, xs = np.nonzero(cov)
        t = tri[ys, xs]
        b = bary[ys, xs]
        P = (p.pos[p.idx[t, 0]] * b[:, :1] + p.pos[p.idx[t, 1]] * b[:, 1:2] + p.pos[p.idx[t, 2]] * b[:, 2:3]).astype(np.float64)
        Nn = (p.nrm[p.idx[t, 0]] * b[:, :1] + p.nrm[p.idx[t, 1]] * b[:, 1:2] + p.nrm[p.idx[t, 2]] * b[:, 2:3]).astype(np.float64)
        Nn /= np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-9)
        N = len(P)
        S = np.zeros((N, 3), dtype=np.float64)
        Wt = np.zeros(N, dtype=np.float64)
        Wmax = np.zeros(N, dtype=np.float64)
        best_view = np.full(N, -1, dtype=np.int8)
        contrib = []
        for n in src.names:
            vp = src.passes[n]
            facing = Nn @ src.layout.views[n]['d']
            xy, z = src.layout.project_px(n, P, ss)
            ix = np.clip(np.floor(xy[:, 0]).astype(np.int64), 0, vp.depth.shape[1] - 1)
            iy = np.clip(np.floor(xy[:, 1]).astype(np.int64), 0, vp.depth.shape[0] - 1)
            vis = z <= src.dmin[n][iy, ix] + 0.007 * u
            wr = np.clip(src.rel[n][iy, ix] / 7.0, 0, 1)
            wf = np.clip((facing - 0.12) / 0.88, 0, 1) ** a.facing_power
            Am = src.transforms[n]
            px = xy[:, 0] / ss
            py = xy[:, 1] / ss
            qx = (Am[0, 0] * px + Am[0, 1] * py + Am[0, 2]).astype(np.float32)
            qy = (Am[1, 0] * px + Am[1, 1] * py + Am[1, 2]).astype(np.float32)
            col = sample_points(src.painted, qx - 0.5, qy - 0.5)
            inside = sample_points(src.fg_er, qx - 0.5, qy - 0.5)
            w = wf * wr * np.clip(inside, 0, 1) * vis
            contrib.append((w, col))
            Wmax = np.maximum(Wmax, w)
        # winner-biased blend: ignore weak contributors so views don't ghost into each other
        for vi, (w, col) in enumerate(contrib):
            ww = np.where(w >= 0.30 * Wmax, w, 0.0)
            S += ww[:, None] * col
            Wt += ww
            sel = (w >= Wmax) & (w > 0)
            best_view[sel] = vi
        seen = Wt > 0.01
        colour = np.zeros((N, 3), dtype=np.float64)
        colour[seen] = S[seen] / Wt[seen, None]
        # unseen texels: nearest seen surface points in 3D (k=6), slightly darkened (underside / inner limbs)
        if (~seen).any() and seen.any():
            tree = cKDTree(P[seen])
            dd, ii = tree.query(P[~seen], k=6)
            wk = 1.0 / (dd + 1e-4)
            wk /= wk.sum(axis=1, keepdims=True)
            filled = (colour[seen][ii] * wk[..., None]).sum(axis=1)
            colour[~seen] = filled * 0.86
        img = np.zeros((T, T, 3), dtype=np.float32)
        img[ys, xs] = colour.astype(np.float32)
        # push-pull dilation outside the islands (so filtering/mipmaps never see junk)
        img = dilate_fill(img, cov, 12)
        prim_stats.append(dict(prim=p.index, T=T, covered=int(cov.sum()), seen_frac=round(float(seen.mean()), 4)))
        out = a.out if len(mesh.prims) == 1 or p.index == 0 else a.out.replace('.png', f'_p{p.index}.png')
        # reprojection check (before levels): render the new texture back into each sheet view and compare with the painted sheet
        report['recon'] = recon_check(mesh, src.layout, src.passes, {p.index: img}, src.painted, src.fg, src.transforms, ss, os.path.dirname(a.out))
        img, lv = apply_levels(img, cov, a.target_median, a.max_gain)
        report.setdefault('levels', {})[str(p.index)] = lv
        save_png(img, out)
        Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out.replace('.png', '.webp'), quality=a.webp_quality, method=6)
        out_files.append(out)
        # coverage / dominant-view diagnostics
        diag = np.zeros((T, T, 3), dtype=np.float32)
        palette = np.array([[1, .2, .2], [.2, 1, .2], [.3, .3, 1], [1, 1, .2], [1, .2, 1], [.2, 1, 1], [1, .6, .2], [.6, .3, 1], [.6, .6, .6], [1, 1, 1]], dtype=np.float32)
        dv = np.where(seen, best_view, -1)
        diag[ys, xs] = np.where((dv >= 0)[:, None], palette[np.clip(dv, 0, len(palette) - 1)], 0.15)
        save_png(diag, os.path.join(os.path.dirname(a.out), f'diag_views_p{p.index}.png'))
    report['prims'] = prim_stats
    report['files'] = out_files
    return report


def apply_levels(img: np.ndarray, valid: np.ndarray, target_median: float, max_gain: float = 1.45) -> tuple[np.ndarray, dict]:
    """Albedo normalisation: lift the median luminance of covered texels towards `target_median` (the engine multiplies the vertex AO shade
    on top, ~0.7 on average). The gain is capped (dark-outfit characters stay dark) and highlights are rolled off on the brightest CHANNEL
    so hue is preserved (per-channel clipping turned warm skin yellow-green). target_median <= 0 disables."""
    if target_median <= 0:
        return img, dict(gain=1.0)
    y = img[valid] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    med = float(np.percentile(y, 50))
    g = float(np.clip(target_median / max(med, 1e-3), 0.85, max_gain))
    out = img * g
    mx = out.max(axis=-1, keepdims=True)
    knee = 0.80
    comp = np.where(mx > knee, knee + (1 - knee) * np.tanh((mx - knee) / (1 - knee)), mx)
    out = out * (comp / np.maximum(mx, 1e-6))
    return np.clip(out, 0, 1).astype(np.float32), dict(gain=round(g, 3), median_before=round(med, 3))


def dilate_fill(img: np.ndarray, valid: np.ndarray, px: int) -> np.ndarray:
    """fill invalid pixels near valid ones by iterative dilation (average of valid neighbours)"""
    out = img.copy()
    v = valid.copy().astype(np.float32)
    k = np.ones((3, 3), np.float32)
    for _ in range(px):
        num = cv2.filter2D(out * v[..., None], -1, k, borderType=cv2.BORDER_REPLICATE)
        den = cv2.filter2D(v, -1, k, borderType=cv2.BORDER_REPLICATE)
        new = (den > 0) & (v == 0)
        if not new.any():
            break
        out[new] = num[new] / den[new, None]
        v[new] = 1
    return out


def recon_check(mesh: Mesh, layout: ViewLayout, passes: dict[str, ViewPass], tex: dict[int, np.ndarray], painted: np.ndarray, fg: np.ndarray, tr: dict[str, np.ndarray], ss: int, out_dir: str) -> dict:
    W, H = layout.canvas
    recon = np.zeros((H, W, 3), dtype=np.float32) + np.array(layout.bg, dtype=np.float32) / 255.0
    errs = {}
    for n, vp in passes.items():
        m = vp.mask
        col = np.zeros(vp.tri.shape + (3,), dtype=np.float32)
        for pi, img in tex.items():
            sel = vp.prim == pi
            if not sel.any():
                continue
            T = img.shape[0]
            mx = (vp.uv[..., 0] * T - 0.5).astype(np.float32)
            my = (vp.uv[..., 1] * T - 0.5).astype(np.float32)
            samp = cv2.remap(img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            col[sel] = samp[sel]
        a = downsample(m.astype(np.float32), ss)
        c = downsample(col * m[..., None], ss)
        recon = c + recon * (1 - a[..., None])
        # error inside our silhouette, against the (aligned) painted sheet
        Am = tr[n]
        gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
        qx = Am[0, 0] * gx + Am[0, 1] * gy + Am[0, 2]
        qy = Am[1, 0] * gx + Am[1, 1] * gy + Am[1, 2]
        ap = cv2.remap(painted, qx, qy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        inner = cv2.erode((a > 0.99).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
        if inner.any():
            lo = cv2.GaussianBlur(c / np.maximum(a[..., None], 1e-3), (0, 0), 3)
            lp = cv2.GaussianBlur(ap, (0, 0), 3)
            errs[n] = round(float(np.abs(lo - lp)[inner].mean()), 4)
    save_png(recon, os.path.join(out_dir, 'recon.png'))
    return dict(mean_abs_err_lowfreq=errs)

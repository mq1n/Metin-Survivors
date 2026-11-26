#!/usr/bin/env python3
"""Post-processing pipeline for generated images.

usage: post.py <job.json> <raw.png> <outdir>

Applies job["post"] ops in order (resize, tile, flatten, grade, alpha, trim, bleed, normal, ...),
writes <outdir>/<id>.webp (+ <id>_n.webp normal map, <id>.tilecheck.png for tileables) and prints a
JSON build report on stdout. Pure numpy/scipy/Pillow, no network, deterministic.
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float32)


@dataclass
class State:
    rgb: np.ndarray  # H,W,3 float32 0..1 (straight alpha)
    a: np.ndarray | None = None  # H,W float32 0..1
    normal: np.ndarray | None = None  # H,W,3 float32 0..1
    notes: list[str] = field(default_factory=list)
    tile: dict | None = None
    tiling: bool = False


# ---------------------------------------------------------------- helpers
def hex_rgb(s: str) -> np.ndarray:
    s = s.lstrip('#')
    return np.array([int(s[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def smoothstep(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb @ LUMA


def to_pil(st: State) -> Image.Image:
    rgb8 = np.clip(st.rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)
    if st.a is None:
        return Image.fromarray(rgb8)
    a8 = np.clip(st.a * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb8, a8]))


def from_pil(im: Image.Image, st: State) -> None:
    arr = np.asarray(im).astype(np.float32) / 255.0
    st.rgb = np.ascontiguousarray(arr[..., :3])
    st.a = np.ascontiguousarray(arr[..., 3]) if im.mode == 'RGBA' else None



# seam ratios above this are visible; below it the generator's own tiling is kept untouched
SEAM_HEAL_THRESHOLD = 1.2
# ---------------------------------------------------------------- tiling
def seam_ratio(arr: np.ndarray) -> tuple[float, float]:
    """Wrap-seam error relative to the typical neighbour difference (1.0 = invisible). Returns (horizontal, vertical)."""
    out = []
    for sigma in (1.0, 5.0):
        g = ndi.gaussian_filter(arr, sigma=(sigma, sigma, 0), mode='wrap')
        wh = np.abs(g[:, 0] - g[:, -1]).mean()
        ih = np.abs(g[:, 1:] - g[:, :-1]).mean()
        wv = np.abs(g[0] - g[-1]).mean()
        iv = np.abs(g[1:] - g[:-1]).mean()
        out.append((wh / max(ih, 1e-5), wv / max(iv, 1e-5)))
    return (float(max(o[0] for o in out)), float(max(o[1] for o in out)))


def _cyclic_cut(E: np.ndarray, lo: int, hi: int) -> np.ndarray:
    """Min-cost vertical path x(y) in [lo,hi), |dx|<=1 per row, closing cyclically (top row joins bottom row)."""
    H = E.shape[0]
    Eb = E[:, lo:hi]
    wb = hi - lo
    inf = 1e18
    ar = np.arange(wb)
    best_cost, best_path = inf, None
    for s in np.unique(np.linspace(0, wb - 1, 14).astype(int)):
        cost = np.full(wb, inf)
        cost[s] = Eb[0, s]
        back = np.zeros((H, wb), np.int8)
        for y in range(1, H):
            left = np.concatenate(([inf], cost[:-1]))
            right = np.concatenate((cost[1:], [inf]))
            stack = np.stack([left, cost, right])
            k = stack.argmin(0)
            cost = stack[k, ar] + Eb[y]
            back[y] = k - 1
        cands = [x for x in (s - 1, s, s + 1) if 0 <= x < wb]
        xe = min(cands, key=lambda x: cost[x])
        if cost[xe] < best_cost:
            best_cost = cost[xe]
            path = np.zeros(H, np.int32)
            x = xe
            for y in range(H - 1, -1, -1):
                path[y] = x
                if y > 0:
                    x = x + int(back[y][x])
            best_path = path
    assert best_path is not None
    return best_path + lo


def _band_cut_axis(arr: np.ndarray, ov: float, feather: float) -> np.ndarray:
    """Overlap-and-cut: make `arr` wrap-continuous horizontally with no duplicated content.

    The last `O` columns (tail) are spliced onto the first `O` columns (head) along a min-error,
    cyclic cut; the tail is then dropped, so the width shrinks by O and out[W'-1] → out[0] are
    adjacent columns of the original image.
    """
    H, W, _ = arr.shape
    O = max(8, int(W * ov))
    Wp = W - O
    head, tail = arr[:, :O], arr[:, Wp:]
    E = ((head - tail) ** 2).sum(axis=2)
    E = ndi.gaussian_filter(E, sigma=(1.5, 1.5), mode=('wrap', 'nearest'))
    path = _cyclic_cut(E, int(O * 0.12), int(O * 0.88))
    xs = np.arange(O)[None, :]
    M = (xs >= path[:, None]).astype(np.float32)  # 1 = head side (right of the cut)
    M = ndi.gaussian_filter1d(M, sigma=feather, axis=1, mode='nearest')[..., None]
    band = tail * (1.0 - M) + head * M
    return np.concatenate([band, arr[:, O:Wp]], axis=1)


def make_tileable(rgb: np.ndarray, ov: float, feather: float) -> np.ndarray:
    out = _band_cut_axis(rgb, ov, feather)
    return np.transpose(_band_cut_axis(np.transpose(out, (1, 0, 2)), ov, feather), (1, 0, 2))


def op_tile(st: State, heal: str = 'auto', feather: float = 2.5, maxRatio: float = 1.3, overlap: float = 0.12) -> None:
    """Measure the wrap seam; when it is visible, heal both axes by overlap-and-cut (size shrinks by the overlap,
    later resize ops bring it back to the target size)."""
    before = seam_ratio(st.rgb)
    st.tiling = True
    healed = False
    after = before
    if heal == 'force' or (heal == 'auto' and max(before) > SEAM_HEAL_THRESHOLD):
        best_rgb, best = st.rgb, before
        for ov in (overlap * 0.6, overlap, overlap * 1.7):
            cand = make_tileable(st.rgb, ov, feather).astype(np.float32)
            r = seam_ratio(cand)
            if max(r) < max(best):
                best_rgb, best = cand, r
            if max(best) <= min(maxRatio, 1.15):
                break
        healed = best_rgb is not st.rgb
        st.rgb, after = best_rgb, best
    st.tile = {'before': {'h': round(before[0], 3), 'v': round(before[1], 3)}, 'after': {'h': round(after[0], 3), 'v': round(after[1], 3)}, 'healed': healed}
    if max(after) > maxRatio:
        st.notes.append(f'tile seam ratio {max(after):.2f} > {maxRatio}')


def op_flatten(st: State, strength: float = 0.6, sigma: float | None = None, wrap: bool | None = None) -> None:
    """Divide out low-frequency luminance. Before `tile` it uses reflect borders, after it wraps."""
    H, W, _ = st.rgb.shape
    sigma = sigma or W / 8.0
    L = luma(st.rgb)
    if wrap is None:  # already seamless (or tile op already ran) → wrap; otherwise reflect so no seam is created
        wrap = st.tiling or max(seam_ratio(st.rgb)) <= SEAM_HEAL_THRESHOLD
    mode = 'wrap' if wrap else 'reflect'
    low = ndi.gaussian_filter(L, sigma=sigma, mode=mode)
    gain = np.clip((L.mean() / np.maximum(low, 1e-3)) ** strength, 0.6, 1.6)
    st.rgb = np.clip(st.rgb * gain[..., None], 0.0, 1.0)



def _resize_tileable(st: State, w: int, h: int) -> None:
    """Resize a tileable image with wrap padding so the seam stays continuous (stretches to w×h)."""
    H0, W0 = st.rgb.shape[:2]
    sx, sy = w / W0, h / H0
    pad = max(8, int(round(24 / min(sx, sy))))
    rgb = np.pad(st.rgb, ((pad, pad), (pad, pad), (0, 0)), mode='wrap')
    im = Image.fromarray(np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8))
    im = im.resize((round((W0 + 2 * pad) * sx), round((H0 + 2 * pad) * sy)), Image.Resampling.LANCZOS)
    ox, oy = round(pad * sx), round(pad * sy)
    st.rgb = np.asarray(im.crop((ox, oy, ox + w, oy + h))).astype(np.float32) / 255.0

# ---------------------------------------------------------------- generic ops
def op_resize(st: State, w: int, h: int | None = None, mode: str = 'cover', focus: list | None = None) -> None:
    h = h or w
    if st.tiling and mode in ('cover', 'exact'):
        return _resize_tileable(st, w, h)
    im = to_pil(st)
    if im.mode == 'RGBA':
        im = im.convert('RGBa')
    W0, H0 = im.size
    if mode == 'exact':
        im = im.resize((w, h), Image.Resampling.LANCZOS)
    elif mode == 'fit':  # longer side = w, keep aspect (non-square output)
        s = w / max(W0, H0)
        im = im.resize((max(1, round(W0 * s)), max(1, round(H0 * s))), Image.Resampling.LANCZOS)
    elif mode == 'contain':
        s = min(w / W0, h / H0)
        nw, nh = max(1, round(W0 * s)), max(1, round(H0 * s))
        im = im.resize((nw, nh), Image.Resampling.LANCZOS)
        if im.mode == 'RGBa':
            canvas = Image.new('RGBa', (w, h), (0, 0, 0, 0))
        else:
            edge = np.asarray(im).reshape(-1, 3).mean(0).astype(np.uint8)
            canvas = Image.new('RGB', (w, h), tuple(int(c) for c in edge))
        canvas.paste(im, ((w - nw) // 2, (h - nh) // 2))
        im = canvas
    else:  # cover
        s = max(w / W0, h / H0)
        nw, nh = max(w, round(W0 * s)), max(h, round(H0 * s))
        im = im.resize((nw, nh), Image.Resampling.LANCZOS)
        fx, fy = (focus or [0.5, 0.5])[:2]
        x0 = int(round((nw - w) * fx))
        y0 = int(round((nh - h) * fy))
        im = im.crop((x0, y0, x0 + w, y0 + h))
    if im.mode == 'RGBa':
        im = im.convert('RGBA')
    from_pil(im, st)


def op_crop(st: State, x: float, y: float, w: float, h: float) -> None:
    H, W, _ = st.rgb.shape
    x0, y0, x1, y1 = round(x * W), round(y * H), round((x + w) * W), round((y + h) * H)
    st.rgb = st.rgb[y0:y1, x0:x1]
    if st.a is not None:
        st.a = st.a[y0:y1, x0:x1]


def op_grade(st: State, saturation: float = 1.0, contrast: float = 1.0, gamma: float = 1.0, brightness: float = 1.0, tint: str | None = None, tintAmount: float = 0.0) -> None:
    c = st.rgb
    L = luma(c)[..., None]
    c = L + (c - L) * saturation
    c = (c - 0.5) * contrast + 0.5
    c = np.clip(c, 0, 1) ** (1.0 / gamma) * brightness
    if tint:
        c = c * (1 - tintAmount) + (hex_rgb(tint) / 255.0) * tintAmount * (L / max(L.mean(), 1e-3)).clip(0, 2)
    st.rgb = np.clip(c, 0, 1)


def op_alpha(st: State, key: str = 'auto', t0: float = 55.0, t1: float = 120.0, erode: float = 1.0, feather: float = 0.7, despill: float = 1.0, minIsland: int = 24, onlyIfOpaque: bool = False) -> None:
    if onlyIfOpaque:
        if st.a is not None:
            st.notes.append('info: kept the generator alpha channel')
            return
        st.notes.append('raw came back opaque (no alpha channel): chroma-keyed from the border colour instead')
    px = st.rgb * 255.0
    H, W, _ = px.shape
    if key == 'auto':
        b = np.concatenate([px[:4].reshape(-1, 3), px[-4:].reshape(-1, 3), px[:, :4].reshape(-1, 3), px[:, -4:].reshape(-1, 3)])
        K = np.median(b, axis=0)
    else:
        K = hex_rgb(key)
    st.notes.append(f'info: key color {K.astype(int).tolist()}')
    d = np.sqrt(((px - K) ** 2).sum(axis=2))
    a_raw = smoothstep((d - t0) / (t1 - t0))
    # drop tiny opaque specks (dust the generator leaves in the background)
    solid = a_raw > 0.5
    lab, n = ndi.label(solid)
    if n:
        sizes = ndi.sum(solid, lab, index=np.arange(1, n + 1))
        small = np.isin(lab, np.where(sizes < minIsland)[0] + 1)
        a_raw = np.where(small, 0.0, a_raw)
    # recover foreground colour of soft edge pixels: P = a*S + (1-a)*K
    soft = (a_raw > 0.0) & (a_raw < 0.999)
    S = px.copy()
    aa = np.maximum(a_raw, 0.08)[..., None]
    S[soft] = ((px - (1 - a_raw[..., None]) * K) / aa)[soft]
    S = np.clip(S, 0, 255)
    # key-channel spill suppression near edges
    if despill > 0:
        kch = np.where(K > 128)[0]
        nch = np.where(K <= 128)[0]
        if len(kch) and len(nch):
            ring = ndi.binary_dilation(a_raw < 0.999, iterations=3) & (a_raw > 0.0)
            ref = S[..., nch].max(axis=2)
            for c in kch:
                over = np.maximum(S[..., c] - ref, 0.0)
                S[..., c] = np.where(ring, S[..., c] - despill * over, S[..., c])
    a = a_raw
    for _ in range(int(round(erode))):
        a = ndi.grey_erosion(a, footprint=ndi.generate_binary_structure(2, 1))
    if feather > 0:
        a = ndi.gaussian_filter(a, sigma=feather)
    st.rgb = (S / 255.0).astype(np.float32)
    st.a = np.clip(a, 0, 1).astype(np.float32)
    if st.a.mean() > 0.995:
        st.notes.append('alpha: nothing keyed out (mean alpha > 0.995)')


def op_trim(st: State, pad: int = 4, square: bool = False, thresh: float | None = None, padFrac: float | None = None, center: bool = False) -> None:
    """Crop to the content box. With alpha: alpha > thresh (0.03). Without alpha (sprites on black): luminance >
    thresh (4/255). padFrac sets the pad as a fraction of the box's longer side. center (with square): the content box
    itself is centred on the square canvas and surrounding source pixels are kept where they exist."""
    if st.a is None:
        if thresh is None and padFrac is None and not center:
            return  # legacy: trim is an alpha-only op unless asked for explicitly
        mask = luma(st.rgb) > (4.0 / 255.0 if thresh is None else thresh)
    else:
        mask = st.a > (0.03 if thresh is None else thresh)
    ys, xs = np.where(mask)
    if len(ys) == 0:
        return
    H, W = mask.shape
    if padFrac is not None:
        pad = int(round(max(ys.max() - ys.min() + 1, xs.max() - xs.min() + 1) * padFrac))
    if square and center:
        cy0, cy1, cx0, cx1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
        s = max(cy1 - cy0, cx1 - cx0) + 2 * pad
        oy, ox = cy0 - (s - (cy1 - cy0)) // 2, cx0 - (s - (cx1 - cx0)) // 2
        sy0, sy1, sx0, sx1 = max(oy, 0), min(oy + s, H), max(ox, 0), min(ox + s, W)
        rgb = np.zeros((s, s, 3), np.float32)
        rgb[sy0 - oy : sy1 - oy, sx0 - ox : sx1 - ox] = st.rgb[sy0:sy1, sx0:sx1]
        if st.a is not None:
            a = np.zeros((s, s), np.float32)
            a[sy0 - oy : sy1 - oy, sx0 - ox : sx1 - ox] = st.a[sy0:sy1, sx0:sx1]
            st.a = a
        st.rgb = rgb
        return
    y0, y1, x0, x1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, H), max(xs.min() - pad, 0), min(xs.max() + pad + 1, W)
    st.rgb = st.rgb[y0:y1, x0:x1]
    if st.a is None:
        if square:
            h, w = st.rgb.shape[:2]
            s = max(h, w)
            rgb = np.zeros((s, s, 3), np.float32)
            rgb[(s - h) // 2 : (s - h) // 2 + h, (s - w) // 2 : (s - w) // 2 + w] = st.rgb
            st.rgb = rgb
        return
    st.a = st.a[y0:y1, x0:x1]
    if square:
        h, w = st.a.shape
        s = max(h, w)
        py, px = (s - h) // 2, (s - w) // 2
        rgb = np.zeros((s, s, 3), np.float32)
        a = np.zeros((s, s), np.float32)
        rgb[py : py + h, px : px + w] = st.rgb
        a[py : py + h, px : px + w] = st.a
        st.rgb, st.a = rgb, a


def op_bleed(st: State, solid: float = 0.5) -> None:
    if st.a is None:
        return
    src = st.a > solid
    if src.all() or not src.any():
        return
    _, idx = ndi.distance_transform_edt(~src, return_indices=True)
    filled = st.rgb[idx[0], idx[1]]
    st.rgb = np.where((st.a > 0.9)[..., None], st.rgb, np.where((st.a > 0.02)[..., None], st.rgb, filled)).astype(np.float32)


def op_normal(st: State, strength: float = 2.5, blur: float = 1.0, detail: float = 0.5, size: int | None = None) -> None:
    L = luma(st.rgb)
    if size and size != L.shape[0]:
        im = Image.fromarray((L * 255).astype(np.uint8)).resize((size, size), Image.Resampling.LANCZOS)
        L = np.asarray(im).astype(np.float32) / 255.0
    # multi-scale height: fine detail + medium relief, wrap-aware so the normal map tiles as well
    h = ndi.gaussian_filter(L, blur, mode='wrap') * (1 - detail) + ndi.gaussian_filter(L, blur * 4, mode='wrap') * detail
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx, ny, nz = -dx * strength * 8.0, dy * strength * 8.0, np.ones_like(h)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.dstack([nx * inv, ny * inv, nz * inv]) * 0.5 + 0.5
    st.normal = n.astype(np.float32)


def op_vignette(st: State, strength: float = 0.5, color: str = '#0b0806', inner: float = 0.55) -> None:
    H, W, _ = st.rgb.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / 1.4142
    m = smoothstep((r - inner) / (1.0 - inner)) * strength
    st.rgb = st.rgb * (1 - m[..., None]) + (hex_rgb(color) / 255.0) * m[..., None]


def op_sharpen(st: State, amount: float = 0.4, radius: float = 1.0) -> None:
    blur = ndi.gaussian_filter(st.rgb, sigma=(radius, radius, 0))
    st.rgb = np.clip(st.rgb + (st.rgb - blur) * amount, 0, 1)


def op_symmetrize(st: State, axis: str = 'xy') -> None:
    H, W, _ = st.rgb.shape
    for arr_name in ('rgb', 'a'):
        arr = getattr(st, arr_name)
        if arr is None:
            continue
        out = arr.copy()
        if 'x' in axis:
            out[:, W // 2 :] = out[:, : W - W // 2][:, ::-1]
        if 'y' in axis:
            out[H // 2 :] = out[: H - H // 2][::-1]
        setattr(st, arr_name, out)


# ---------------------------------------------------------------- VFX sprite ops
def op_neutral(st: State, amount: float = 1.0) -> None:
    """Desaturate towards luminance (VFX sprites are tinted at runtime); luminance itself is unchanged."""
    L = luma(st.rgb)[..., None]
    st.rgb = np.clip(st.rgb + (L - st.rgb) * amount, 0.0, 1.0).astype(np.float32)


def border_ring(arr: np.ndarray, frac: float = 0.04) -> np.ndarray:
    H, W = arr.shape[:2]
    b = max(2, int(round(min(H, W) * frac)))
    return np.concatenate([arr[:b].reshape(-1), arr[-b:].reshape(-1), arr[b:-b, :b].reshape(-1), arr[b:-b, -b:].reshape(-1)])


def op_blackpoint(st: State, level: float | str = 'auto', knee: float | None = None, normalize: bool = True, white: float = 1.0) -> None:
    """Crush the background of a sprite on black to true 0. auto: the border ring gives the background level (median)
    and its noise (robust sigma from the median→p75 spread); floor = median + 4 sigma + half a level. The floor is
    subtracted through a smoothstep knee (>= 3 levels, >= 2 sigma) so faint tails fade continuously instead of being
    clipped; colour ratios are preserved. normalize scales the 99.9th percentile of the brightest channel up to
    `white` (never darkens, gain <= 4). Anything left below one 8-bit level is set to exactly 0."""
    L = luma(st.rgb)
    if level == 'auto':
        p50, p75 = (float(v) for v in np.percentile(border_ring(L), [50, 75]))
        sigma = max(p75 - p50, 0.0) / 0.674
        floor = p50 + 4.0 * sigma + 0.5 / 255.0
        if floor > 40.0 / 255.0:
            st.notes.append(f'blackpoint: the border is not dark (floor {floor * 255:.0f}/255) — content or haze reaches the edge; floor capped at 40')
            floor = 40.0 / 255.0
        k = knee if knee is not None else max(3.0 / 255.0, 2.0 * sigma)
    else:
        floor = float(level)
        k = knee if knee is not None else 3.0 / 255.0
    sub = np.maximum(L - floor, 0.0)
    Ln = sub * smoothstep(sub / k) / max(1.0 - floor, 1e-3)
    rgb = st.rgb * np.where(L > 1e-6, Ln / np.maximum(L, 1e-6), 0.0)[..., None]
    gain = 1.0
    if normalize:
        p = float(np.percentile(rgb.max(axis=2), 99.9))
        if 0.02 < p < white:
            gain = min(white / p, 4.0)
            rgb = rgb * gain
    rgb[rgb.max(axis=2) < 1.0 / 255.0] = 0.0
    st.rgb = np.clip(rgb, 0.0, 1.0).astype(np.float32)
    st.notes.append(f'info: blackpoint floor {floor * 255:.1f}/255, gain {gain:.2f}')


def _srgb_lin(x: np.ndarray) -> np.ndarray:
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def _srgb_enc(x: np.ndarray) -> np.ndarray:
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.maximum(x, 0.0), 1 / 2.4) - 0.055)


def op_gain(st: State, rgb: float = 1.0, alpha: float = 1.0, ground: float | None = None) -> None:
    """Scale the stored (display-space) colour and / or the alpha by a constant, clipped to 0..1. `blackpoint` peak-normalises every
    sprite, while authored sprite peaks often sit around 0.05-0.5.
    `ground` (display luma of the surface the sprite is added to, e.g. 0.22): the client adds the texture to the frame buffer in GAMMA space
    (display values add), our renderer adds in LINEAR light, which swallows dim texels (a texel of 0.1 adds 0.1 there, but only ~0.04 here over
    a 0.22 ground). With `ground` the scaled value v is replaced by the texel that adds the same display amount in linear light:
    enc(lin(min(ground + v, 1)) - lin(ground)). Put it after neutral / blackpoint and before resize / edgefade / webp."""
    c = np.clip(st.rgb * float(rgb), 0.0, 1.0)
    if ground is not None:
        g = float(ground)
        c = _srgb_enc(np.maximum(_srgb_lin(np.minimum(g + c, 1.0)) - float(_srgb_lin(np.float64(g))), 0.0))
    st.rgb = np.clip(c, 0.0, 1.0).astype(np.float32)
    if st.a is not None and float(alpha) != 1.0:
        st.a = np.clip(st.a * float(alpha), 0.0, 1.0).astype(np.float32)
    st.notes.append(f'info: gain rgb {float(rgb):.3f} alpha {float(alpha):.3f}' + (f' ground {float(ground):.2f}' if ground is not None else ''))


# Profile matching (applies the `q` luminance curve table of a job).
# `q[i]` = the display-space effective value (max colour channel x alpha, or luma for own-colour sprites) that the original texture EXCEEDS on the
# fraction PROFILE_U[i] of its area (q[0] = its peak, q[-1] = its darkest texel); a non-increasing list. Fixed grid, dense near the peak.
PROFILE_U = (0.0, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0)


def ground_transfer(v: np.ndarray, ground: float) -> np.ndarray:
    """T(v): the sprite value whose LINEAR-light add over a surface of display luma `ground` shows what the client's gamma-space add of
    the texel `v` shows (display values add there, clipped at 1): enc(lin(min(ground + v, 1)) - lin(ground)). Same mapping as op_gain `ground`."""
    g = float(ground)
    if g <= 0.0:
        return np.clip(v, 0.0, 1.0)
    return _srgb_enc(np.maximum(_srgb_lin(np.minimum(g + np.asarray(v, dtype=np.float64), 1.0)) - float(_srgb_lin(np.float64(g))), 0.0))


def area_above(v: np.ndarray) -> np.ndarray:
    """per texel: the fraction of ALL texels brighter than it (ties count half), in 0..1 - the rank a quantile map needs"""
    flat = v.reshape(-1)
    srt = np.sort(flat)
    lo = np.searchsorted(srt, flat, side='left')
    hi = np.searchsorted(srt, flat, side='right')
    return ((flat.size - (lo + hi) / 2.0) / flat.size).reshape(v.shape)


def op_tonefit(st: State, q: list, ground: float = 0.22, cap: float = 3.0, mode: str = 'max', eps: float = 2.0 / 255.0, ramp: float = 0.1, smooth: float = 0.25) -> None:
    """Fit the sprite's tone curve to the original texture's luminance profile (not to its total light): a rank-preserving remap so that the
    AREA above every brightness level matches the original's - peak, the 10 / 25 / 50 % coverage, the mean - after the linear-light transfer
    T(v) (`ground`: display luma of the surface the sprite is added to, 0 = no transfer, plain display-space match). A uniform `gain`
    cannot do this: the generator fills the frame and peak-normalises, so the fuller shape has many times the original's lit area at the
    same peak. `q` = the original's quantile table (PROFILE_U), `mode` 'max' = max colour channel (neutral sprites, tinted at runtime),
    'luma' (own-colour sprites). Texels <= `eps` stay black (a quantile map never invents support; a sprite thinner than the original is
    reported: it needs its shape regenerated, not a tone curve), the dimmest `ramp` of the support fades in so no step appears at its
    border, and no texel is lifted by more than `cap` x. The 8-bit originals have plateaus (one level over 15 % of the area) that would turn a
    smooth halo into a terrace, so the curve is blended with a straight ramp to the same peak (`smooth`, 0 = the exact rank map). Colour ratios are kept. Alpha sprites are left alone (their light is coverage, a
    different transfer). Put it after neutral / blackpoint (and glow / blur), before resize / edgefade / webp."""
    if st.a is not None:
        st.notes.append('tonefit: skipped (alpha sprite)')
        return
    qq = np.asarray(q, dtype=np.float64)
    u = np.asarray(PROFILE_U, dtype=np.float64)
    if qq.shape != u.shape:
        raise ValueError(f'tonefit q needs {u.size} values (PROFILE_U), got {qq.size}')
    tq = np.minimum.accumulate(ground_transfer(np.clip(qq, 0.0, 1.0), ground))  # non-increasing target values per area fraction
    rgb = st.rgb.astype(np.float64)
    v = rgb.max(axis=2) if mode == 'max' else luma(rgb)
    sup = v > eps
    ps = float(sup.mean())
    if ps <= 0.0:
        return
    f = np.interp(area_above(v), u, tq)
    top = float(np.percentile(v[sup], 99.9))
    f_top = float(np.interp(0.001 * ps, u, tq))       # the target value at the sprite's own 99.9th percentile
    f = (1.0 - float(smooth)) * f + float(smooth) * v * (f_top / max(top, 1e-6))
    kv = max(float(np.percentile(v[sup], ramp * 100.0)), 2.0 * eps)
    w = smoothstep((v - eps) / (kv - eps))
    out = np.minimum(f * w, float(cap) * v)
    out[~sup] = 0.0
    out = np.clip(out, 0.0, 1.0)
    st.rgb = np.clip(rgb * np.where(sup, out / np.maximum(v, 1e-6), 0.0)[..., None], 0.0, 1.0).astype(np.float32)
    pt = float(np.interp(2.0 * eps, tq[::-1], u[::-1])) if tq[0] > 2.0 * eps else 0.0   # area the original lights above ~4/255 (T-space)
    st.notes.append(f'info: tonefit ground {float(ground):.2f} cap {float(cap):.1f}: lit area sprite {ps * 100:.0f}% vs original {pt * 100:.0f}%, mean {float(v.mean()):.3f} -> {float(out.mean()):.3f}')
    if ps < 0.8 * pt:
        st.notes.append(f'tonefit: support deficit - the sprite lights {ps * 100:.0f}% of its frame, the original {pt * 100:.0f}%: a tone curve cannot widen it (regenerate the shape)')


def op_blur(st: State, sigma: float = 0.01) -> None:
    """Gaussian blur (sigma = fraction of the shorter side) of the colour and the alpha: softens the crisp cauliflower / fibre detail the
    generator draws where the original is a smooth smudge. Put it before tonefit (the tone curve restores the level) and before resize."""
    s = max(0.3, float(sigma) * min(st.rgb.shape[:2]))
    st.rgb = np.clip(ndi.gaussian_filter(st.rgb, sigma=(s, s, 0)), 0.0, 1.0).astype(np.float32)
    if st.a is not None:
        st.a = np.clip(ndi.gaussian_filter(st.a, sigma=s), 0.0, 1.0).astype(np.float32)
    st.notes.append(f'info: blur sigma {s:.1f}px')


def op_edgefade(st: State, width: float = 0.03) -> None:
    """Fade the outer `width` of each side to exactly 0 (smoothstep): RGB for sprites without alpha (additive),
    alpha otherwise — nothing bleeds at the quad edges under bilinear/mip sampling."""
    H, W = st.rgb.shape[:2]

    def ramp(n: int) -> np.ndarray:
        i = np.arange(n, dtype=np.float32)
        return smoothstep(np.minimum(i, n - 1 - i) / max(1.0, n * width))

    m = (ramp(H)[:, None] * ramp(W)[None, :]).astype(np.float32)
    target = st.a if st.a is not None else luma(st.rgb)
    lost = float((target * (1.0 - m)).sum() / max(float(target.sum()), 1e-6))
    if lost > 0.02:
        st.notes.append(f'edgefade: {lost * 100:.1f}% of the sprite sits in the faded {width * 100:.0f}% border (content touches the edge)')
    if st.a is not None:
        st.a = (st.a * m).astype(np.float32)
    else:
        st.rgb = (st.rgb * m[..., None]).astype(np.float32)


def op_glow(st: State, sigma: float = 0.02, amount: float = 0.8, gamma: float = 1.0, normalize: bool = True, round: float = 0.0) -> None:
    """Soft body around thin detail (VFX sprites): out = in + amount * gaussian(in, sigma * shorter side), then the 99.9th percentile is
    brought back to the input's. Hairline strands gain a broad soft band (brush-stroke bodies) while the fine streaks stay readable; a
    lower `gamma` (< 1) afterwards lifts the dim body. Run on the full-resolution raw, before resize."""
    H, W = st.rgb.shape[:2]
    s = max(0.5, float(sigma) * min(H, W))
    peak0 = float(np.percentile(st.rgb.max(axis=2), 99.9))
    blur = ndi.gaussian_filter(st.rgb, sigma=(s, s, 0))
    out = st.rgb + float(amount) * blur
    if normalize:
        p = float(np.percentile(out.max(axis=2), 99.9))
        if p > 1e-6:
            out = out * (peak0 / p)
    out = np.clip(out, 0.0, 1.0)
    if gamma != 1.0:
        out = np.power(out, float(gamma))
    if round > 0.0:
        # `round` = radius (fraction of the half size) where a radial fade to 0 ends; it starts at 0.84 of that: the wide blur never bleeds into the square's corners
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        rr = np.hypot((yy - (H - 1) / 2.0) / (H / 2.0), (xx - (W - 1) / 2.0) / (W / 2.0))
        out = out * (1.0 - smoothstep((rr - float(round) * 0.84) / (float(round) * 0.16)))[..., None]
    st.rgb = out.astype(np.float32)
    st.notes.append(f'info: glow sigma {s:.1f}px amount {float(amount):.2f} gamma {float(gamma):.2f}')


def op_spinblur(st: State, angle: float = 10.0, steps: int = 9, cx: float = 0.5, cy: float = 0.5) -> None:
    """Rotational (angular) motion blur around (cx, cy): the mean of the image turned through -angle/2 .. +angle/2 degrees, i.e. the long-exposure
    smear of a sprite that spins very fast (high-speed whirls spin at -1000 deg/s). Blur is along the rotation, so spiral arms stretch along
    their length and their blunt ends dissolve. Brightness is the mean (not the sum)."""
    H, W = st.rgb.shape[:2]
    n = max(2, int(steps))
    angs = np.linspace(-float(angle) / 2.0, float(angle) / 2.0, n)
    # rotate about an arbitrary centre: pad so the centre sits in the middle of the canvas, rotate, crop back
    off_x = (0.5 - float(cx)) * W
    off_y = (0.5 - float(cy)) * H
    acc = np.zeros_like(st.rgb, dtype=np.float32)
    base = ndi.shift(st.rgb, (off_y, off_x, 0), order=1, mode='constant', cval=0.0) if (off_x or off_y) else st.rgb
    for a in angs:
        acc += ndi.rotate(base, float(a), axes=(1, 0), reshape=False, order=1, mode='constant', cval=0.0)
    acc /= n
    if off_x or off_y:
        acc = ndi.shift(acc, (-off_y, -off_x, 0), order=1, mode='constant', cval=0.0)
    st.rgb = np.clip(acc, 0.0, 1.0).astype(np.float32)
    st.notes.append(f'info: spinblur {float(angle):.1f} deg x{n}')


OPS = {
    'resize': op_resize,
    'crop': op_crop,
    'tile': op_tile,
    'flatten': op_flatten,
    'grade': op_grade,
    'alpha': op_alpha,
    'trim': op_trim,
    'bleed': op_bleed,
    'normal': op_normal,
    'vignette': op_vignette,
    'sharpen': op_sharpen,
    'symmetrize': op_symmetrize,
    'neutral': op_neutral,
    'blackpoint': op_blackpoint,
    'gain': op_gain,
    'tonefit': op_tonefit,
    'blur': op_blur,
    'edgefade': op_edgefade,
    'glow': op_glow,
    'spinblur': op_spinblur,
}

# icon pipeline v2 ops (py/iconkit.py, docs/ART.md s5): glyph, octile, matte, fit, outline, shadow
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from iconkit import OPS as _ICON_OPS  # noqa: E402

for _name, _fn in _ICON_OPS.items():
    OPS.setdefault(_name, _fn)


# ---------------------------------------------------------------- encode
def save_webp(path: str, arr: np.ndarray, a: np.ndarray | None, quality: int, lossless: bool) -> int:
    rgb8 = np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)
    if a is None:
        im = Image.fromarray(rgb8)
    else:
        a8 = np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8)
        im = Image.fromarray(np.dstack([rgb8, a8]))
    kw = dict(quality=quality, method=6, lossless=lossless)
    if a is not None:
        kw.update(exact=True, alpha_quality=100)
    im.save(path, 'WEBP', **kw)
    return os.path.getsize(path)


def band_error(src_rgb: np.ndarray, src_a: np.ndarray | None, path: str) -> float:
    """99th-percentile |decoded - source| (0..255 levels) over dim, smooth gradients — where lossy blocks/steps show
    once a sprite is tinted, scaled up and bloomed. Premultiplied by alpha for RGBA."""
    dec = np.asarray(Image.open(path).convert('RGBA' if src_a is not None else 'RGB')).astype(np.float32) / 255.0
    S = luma(src_rgb) * (src_a if src_a is not None else 1.0)
    D = luma(dec[..., :3]) * (dec[..., 3] if src_a is not None else 1.0)
    gy, gx = np.gradient(ndi.gaussian_filter(S, 1.0))
    m = (S > 1.0 / 255.0) & (S < 0.35) & (np.hypot(gx, gy) < 0.012)
    if m.sum() < 256:
        return 0.0
    return float(np.percentile(np.abs(D - S)[m], 99) * 255.0)


def save_main(path: str, st: State, quality: int, lossless: bool | str, max_band: float) -> tuple[int, bool, str | None]:
    """Encode the main output. lossless='auto': lossy unless it bands (band_error > max_band) or lossless costs
    <= 1.25x the lossy bytes. Returns (bytes, lossless_used, note)."""
    if lossless != 'auto':
        return save_webp(path, st.rgb, st.a, quality, bool(lossless)), bool(lossless), None
    lossy = save_webp(path, st.rgb, st.a, quality, False)
    band = band_error(st.rgb, st.a, path)
    ll_path = path + '.ll.webp'
    ll = save_webp(ll_path, st.rgb, st.a, quality, True)
    use_ll = band > max_band or ll <= lossy * 1.25
    if use_ll:
        os.replace(ll_path, path)
    else:
        os.remove(ll_path)
    note = f'info: webp {"lossless" if use_ll else f"q{quality}"} (lossy band p99 {band:.1f}/255 vs limit {max_band}; lossy {lossy / 1024:.0f}KB, lossless {ll / 1024:.0f}KB)'
    return (ll if use_ll else lossy), use_ll, note


def main() -> None:
    job_path, raw_path, outdir = sys.argv[1:4]
    job = json.load(open(job_path, encoding='utf8'))
    os.makedirs(outdir, exist_ok=True)
    im = Image.open(raw_path)
    has_a = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
    im = im.convert('RGBA') if has_a else im.convert('RGB')
    st = State(rgb=np.zeros((1, 1, 3), np.float32))
    from_pil(im, st)
    if st.a is not None and st.a.min() > 0.99:
        st.a = None  # opaque RGBA → treat as RGB

    wq, lossless, nq, max_band = None, False, None, 3.0
    for spec in job['post']:
        spec = dict(spec)
        op = spec.pop('op')
        if op == 'webp':
            wq = spec.get('quality')
            ll = spec.get('lossless', False)
            lossless = 'auto' if ll == 'auto' else bool(ll)
            max_band = float(spec.get('maxBand', 3.0))
            nq = spec.get('normalQuality')
            continue
        OPS[op](st, **spec)

    jid = job['id']
    has_alpha = st.a is not None
    quality = wq if wq is not None else (90 if has_alpha else 84)
    main_path = os.path.join(outdir, f'{jid}.webp')
    nbytes, used_lossless, enc_note = save_main(main_path, st, quality, lossless, max_band)
    if enc_note:
        st.notes.append(enc_note)
    report: dict = {'id': jid, 'w': int(st.rgb.shape[1]), 'h': int(st.rgb.shape[0]), 'alpha': has_alpha, 'main': main_path, 'bytes': nbytes, 'notes': st.notes}
    if used_lossless:
        report['lossless'] = True
    if st.normal is not None:
        npath = os.path.join(outdir, f'{jid}_n.webp')
        report['normal'] = npath
        report['normalBytes'] = save_webp(npath, st.normal, None, nq if nq is not None else 88, False)
    # icon v2: rank-band tile variants (<id>__<band>.webp), the glyph mask for the gates, the icon form
    for band, (vrgb, va) in (getattr(st, 'variants', None) or {}).items():
        vpath = os.path.join(outdir, f'{jid}__{band}.webp')
        vbytes, _, _ = save_main(vpath, State(rgb=vrgb, a=va), quality, lossless, max_band)
        report.setdefault('variants', {})[band] = {'path': vpath, 'bytes': vbytes}
    if getattr(st, 'glyph', None) is not None:
        gpath = os.path.join(outdir, f'{jid}.glyph.png')
        Image.fromarray(np.clip(st.glyph * 255.0 + 0.5, 0, 255).astype(np.uint8)).save(gpath)
        report['glyph'] = gpath
    if getattr(st, 'form', None):
        report['form'] = st.form
    if st.tiling:
        # verify on the decoded output (lossy encode must not reintroduce a seam)
        dec = np.asarray(Image.open(main_path).convert('RGB')).astype(np.float32) / 255.0
        final = seam_ratio(dec)
        tile = st.tile or {'before': {'h': 0, 'v': 0}, 'after': {'h': 0, 'v': 0}, 'healed': False}
        tile['final'] = {'h': round(final[0], 3), 'v': round(final[1], 3)}
        report['tile'] = tile
        t = Image.open(main_path).convert('RGB')
        s = min(t.size[0], 512)
        t = t.resize((s, s), Image.Resampling.LANCZOS)
        chk = Image.new('RGB', (s * 2, s * 2))
        for ix in range(2):
            for iy in range(2):
                chk.paste(t, (ix * s, iy * s))
        chk.save(os.path.join(outdir, f'{jid}.tilecheck.png'))
        if max(final) > float(next((o.get('maxRatio', 1.3) for o in job['post'] if o['op'] == 'tile'), 1.3)) * 1.1:
            report['notes'].append(f'FINAL seam ratio {max(final):.2f} above limit')
    with open(os.path.join(outdir, f'{jid}.json'), 'w', encoding='utf8') as f:
        json.dump(report, f, indent=1)
    print(json.dumps(report))


if __name__ == '__main__':
    main()

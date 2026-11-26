#!/usr/bin/env python3
"""Icon pipeline v2 post ops (docs/ART.md s5). Registered into post.py OPS; also runnable standalone for tuning:

  python tools/imagegen/py/iconkit.py <job.json> <raw.png> <outdir>     (same contract as post.py)

Ops
  glyph    raw pictogram (white stencil on black, or a real-alpha raw) -> clean alpha mask in st.a, rgb white
  octile   compose the octagonal ARPG skill tile (v5 look, warrior_a r4): chamfered octagon, warm BRONZE frame (outer dark outline
           #211408, bevelled bronze band ~#6b5531 lit from the upper left, thin dark inner line; ~10.5 % of the side), fine-grain
           mottled ground in the family/grade colour, ONE flat IVORY pictogram (#fff3ce on warm grounds: a thin dark outline, NO
           bevel / emboss / grain / drop shadow; narrow gaps of the stencil - the pictogram's inner details - are painted as thin
           BROWN interior lines like the original's 1 px pictogram detail; flat dark ink on cool/bright grounds). Grade escalation
           (no thorns / shards): ground olive -> orange -> crimson -> dark crimson, p gilded rim, and the PICTOGRAM ITSELF grows:
           with `grid: 2` the raw is a 2x2 sheet of the same symbol drawn at grade n / m / g / p (row-major) and every band gets its
           own cell; without a grid (single stencil) the glyph gets bolder per grade (+stroke weight, +scale) as a stand-in.
           Renders the grade-1 tile as the main output and the other bands into st.variants -> post.py writes <id>__<band>.webp.
           Deterministic (seeded by the id).
  matte    harden a generated alpha: drop haze below `lo`, steepen the edge, remove specks
  fit      trim to the alpha box and place the object on a square canvas: long side = fill x size, kept inside the margin
  outline  crisp dark contour around the alpha silhouette (px at the current size)
  shadow   short soft drop/contact shadow behind the object (offset down-right, light from the upper left)
Dimensions follow our 256 px octagonal tile spec.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float32)

# Rank-band ground colours per family (mirrors tools/imagegen/src/defs/iconStyle.ts TILE_FAMILIES; authored band medians
# were warm #6a5223 / #6b3802 / #521810, cool #bddbd6 / #c5cbff / #dec7ff, bright #f7e99c / #ffcba5 / #ffb2b8 - ours are
# shifted and re-saturated so they are reminiscent, not copied). n = ranks 1-3, m = M1-M2, g = G1-G2, p = P (gilded rim).
# v5 look (warrior_a r4, critic feedback on v4): the v4 grey taupe frame, 2-tone bevel, ridge veins and grain made the glyphs read
# as carved marble medallions. v5 material: WARM BRONZE frame (band ~#6b5531, outline #211408), FLAT IVORY glyph (#fff3ce)
# with a thin dark outline, thin BROWN interior lines (the stencil's narrow gaps), no bevel / texture / shadow. Grade growth comes
# from the pictogram itself (grid sheets, see op_octile) and from the ground colour, rim tint and gilding - no thorns / shards.
FAMILIES: dict[str, dict] = {
    'warm': {
        'ground': {'n': '#6f5b2a', 'm': '#733f0f', 'g': '#52190f', 'p': '#44130e'},
        'glyph': {'n': '#fff3ce', 'm': '#ffebc4', 'g': '#ffe2ba', 'p': '#ffe8b4'},
        'shade': None,       # v5: flat - no 2-tone bevel on the glyph
        'ridge': None,       # v5: no engraved ridge veins
        'interior': '#7a5628',   # thin interior detail lines (narrow stencil gaps)
        'contour': '#241508', 'mode': 'light',
    },
    'cool': {
        'ground': {'n': '#b4d6cc', 'm': '#bac3f0', 'g': '#d6c0f0', 'p': '#c9b0ea'},
        'glyph': {'n': '#20403c', 'm': '#121a4a', 'g': '#26103a', 'p': '#1e0a30'}, 'shade': None, 'ridge': None, 'contour': None, 'mode': 'dark',
    },
    'guild': {
        'ground': {'n': '#3b352e', 'm': '#3b352e', 'g': '#3b352e', 'p': '#3b352e'},
        'glyph': '#e6dccb', 'shade': None, 'ridge': None, 'interior': '#6a5d4c', 'contour': '#0e0b08', 'mode': 'light',
    },
    'bright': {
        'ground': {'n': '#efdf92', 'm': '#f6c39c', 'g': '#f2a7ae', 'p': '#f09aa4'},
        'glyph': {'n': '#4a3f0a', 'm': '#40120a', 'g': '#3e0a0c', 'p': '#360810'}, 'shade': None, 'ridge': None, 'contour': None, 'mode': 'dark',
    },
}
# frame (v5): thin bronze lip, dark outline (#211408), bevelled BRONZE band (lit from the upper left), thin dark inner line.
# 10.4 % of the side (~12.5 % frame thickness leaves the interior for the glyph).
RIM = {'lip': '#8d7444', 'line': '#211408', 'band': '#6b5531', 'bandLight': '#94794a', 'bandDark': '#46371f', 'inner': '#271a0b'}
RIM_P = {'lip': '#e0be5a', 'line': '#241606', 'band': '#b58a2e', 'bandLight': '#eccb6c', 'bandDark': '#74501a', 'inner': '#2a1a06'}
GEO3 = {'lip': 0.012, 'line': 0.016, 'band': 0.064, 'inner': 0.012, 'contour': 0.020, 'drop': 0.0, 'gap': 0.014}  # fractions of the side
# per-band stand-in growth when the raw is a SINGLE stencil (no grid): stroke weight (fraction of the side), scale gain. A grid raw
# has its own glyph per band.
GRADE = {
    'n': {'grow': 0.000, 'gain': 1.00, 'shade': 0.0, 'ridges': 0},
    'm': {'grow': 0.003, 'gain': 1.02, 'shade': 0.0, 'ridges': 0},
    'g': {'grow': 0.006, 'gain': 1.04, 'shade': 0.0, 'ridges': 0},
    'p': {'grow': 0.008, 'gain': 1.04, 'shade': 0.0, 'ridges': 0},
}
GRID_RIDGES = {'n': 0, 'm': 0, 'g': 0, 'p': 0}
FILL_GAIN = 1.17  # the 10.4 % frame leaves ~0.79 of the tile as the well; job `fill` 0.8 -> glyph long side ~0.74 of the tile (target ~0.72-0.8)
BANDS = ('n', 'm', 'g', 'p')


def hexf(s: str) -> np.ndarray:
    s = s.lstrip('#')
    return np.array([int(s[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0


def sstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb @ LUMA


def seed_of(text: str) -> int:
    return int(hashlib.sha256(text.encode('utf8')).hexdigest()[:8], 16)


def resize_f(arr: np.ndarray, w: int, h: int) -> np.ndarray:
    """Lanczos resize of a float 0..1 array (H,W) or (H,W,C) through 16-bit-ish PIL float mode per channel."""
    if arr.ndim == 2:
        return np.asarray(Image.fromarray(arr.astype(np.float32), mode='F').resize((w, h), Image.Resampling.LANCZOS), dtype=np.float32)
    return np.dstack([resize_f(arr[..., c], w, h) for c in range(arr.shape[2])])


# ---------------------------------------------------------------- glyph mask
def op_glyph(st, lo: float = 0.22, hi: float = 0.6, minIsland: int = 60, invert: str = 'auto', close: int = 0) -> None:
    """White-on-black stencil (or a real-alpha raw) -> alpha mask; rgb set to white. invert auto: a light border means the
    model drew a dark glyph on a light ground -> invert first."""
    if st.a is not None and st.a.min() < 0.5:
        m = st.a * np.clip(luma(st.rgb) / max(float(np.percentile(luma(st.rgb)[st.a > 0.5], 90)) if (st.a > 0.5).any() else 1.0, 1e-3), 0, 1)
    else:
        L = luma(st.rgb)
        H, W = L.shape
        b = max(4, int(min(H, W) * 0.03))
        border = np.concatenate([L[:b].ravel(), L[-b:].ravel(), L[:, :b].ravel(), L[:, -b:].ravel()])
        bmed = float(np.median(border))
        if 0.12 < bmed < 0.5 or float(np.std(border)) > 0.12:
            # not a stencil on a flat black/white ground: e.g. an old painted 128 px icon raw still in raw/<id>.png
            st.notes.append(f'glyph: the raw is not a stencil on a flat ground (border luma {bmed:.2f}, std {float(np.std(border)):.2f}) - regenerate it')
        if invert == 'yes' or (invert == 'auto' and bmed > 0.5):
            L = 1.0 - L
            st.notes.append('info: glyph drawn dark on light - inverted')
        floor = float(np.percentile(np.concatenate([L[:b].ravel(), L[-b:].ravel()]), 90))
        m = sstep((L - max(lo, floor + 0.05)) / max(hi - lo, 1e-3))
    solid = m > 0.5
    lab, n = ndi.label(solid)
    if n:
        sizes = ndi.sum(solid, lab, index=np.arange(1, n + 1))
        keep = np.isin(lab, np.where(sizes >= minIsland * (m.shape[0] / 1024.0) ** 2)[0] + 1)
        near = ndi.binary_dilation(keep, iterations=2)
        m = np.where(near, m, 0.0)
    if close:
        m = ndi.grey_closing(m, size=(close, close))
    st.a = m.astype(np.float32)
    st.rgb = np.ones(st.rgb.shape, np.float32)
    cover = float((m > 0.5).mean())
    st.notes.append(f'info: glyph coverage {cover:.3f} of the raw')
    if cover < 0.01:
        st.notes.append('glyph: almost empty (nothing light on the dark ground)')


# ---------------------------------------------------------------- ground texture
def _value_noise(rng: np.random.Generator, size: int, cells: int) -> np.ndarray:
    g = rng.random((cells + 3, cells + 3)).astype(np.float32)
    big = resize_f(g, size + 3 * size // cells, size + 3 * size // cells)
    o = size // cells
    return big[o : o + size, o : o + size]


def per_band(v, band: str):
    """A family value that is either one thing or one thing per band."""
    return v[band] if isinstance(v, dict) else v


def ground_field(size: int, seed: int) -> np.ndarray:
    """Fine-grain mottled field 0..1 (per-pixel parchment/rust noise drawn at 256 px): little low-frequency
    variation, most energy at 4-16 px, a few dark pits and light flecks. No large blotches, no vignette."""
    rng = np.random.default_rng(seed)
    f = np.zeros((size, size), np.float32)
    for cells, w in ((4, 0.12), (12, 0.22), (28, 0.30), (56, 0.24), (96, 0.12)):
        f += w * _value_noise(rng, size, cells)
    f = (f - f.mean()) / max(float(f.std()), 1e-6)
    f = 0.5 + 0.17 * f
    pits = _value_noise(rng, size, 44)
    f -= 0.30 * sstep((pits - 0.80) / 0.08)
    flecks = _value_noise(rng, size, 60)
    f += 0.16 * sstep((flecks - 0.84) / 0.07)
    return np.clip(f, 0.0, 1.0)


def ground_rgb(field: np.ndarray, base: np.ndarray, amp: float = 0.9) -> np.ndarray:
    """Colour-map the value field around `base`: shadows darker and a little warmer / more saturated, lights paler."""
    t = (field[..., None] - 0.5) * amp  # about -0.45..0.45
    warm_dark = np.array([1.0, 0.9, 0.78], np.float32)
    rgb = np.where(t < 0, base * (1 + 1.25 * t) * (1 + (warm_dark - 1) * (-2 * t)), base * (1 + 1.1 * t) + 0.05 * t)
    return np.clip(rgb, 0, 1).astype(np.float32)


# ---------------------------------------------------------------- octagon
def octagon_dist(size: int, chamfer: float) -> tuple[np.ndarray, np.ndarray]:
    """Inside distance (px) to the chamfered-square boundary and the index of the nearest edge (0..7)."""
    c = (size - 1) / 2.0
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    x, y = xx - c, yy - c
    H = size / 2.0
    k = chamfer * size
    d = np.stack([H - x, H - y, H + x, H + y, (2 * H - k - x - y) / np.sqrt(2), (2 * H - k + x - y) / np.sqrt(2), (2 * H - k + x + y) / np.sqrt(2), (2 * H - k - x + y) / np.sqrt(2)])
    return d.min(0), d.argmin(0)


# outward normals of the 8 edges in image coords (x right, y down): right, bottom, left, top, br, bl, tl, tr
_NORMALS = np.array([[1, 0], [0, 1], [-1, 0], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071], [0.7071, -0.7071]], np.float32)
_LIGHT = np.array([-0.7071, -0.7071], np.float32)  # from the upper left


# ---------------------------------------------------------------- painted glyph details
def dilate_soft(m: np.ndarray, r: float) -> np.ndarray:
    """Round dilation of a soft mask by r px (anti-aliased)."""
    if r <= 0.05:
        return m
    dist = ndi.distance_transform_edt(m < 0.5)
    return np.maximum(m, sstep(r + 0.5 - dist)).astype(np.float32)


def thin(mask: np.ndarray) -> np.ndarray:
    """Zhang-Suen thinning of a boolean mask (vectorised) -> 1 px skeleton."""
    img = np.pad(mask.astype(np.uint8), 1)
    for _ in range(80):
        changed = False
        for step in (0, 1):
            P = [np.roll(img, sh, (0, 1)) for sh in ((1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1))]  # P2..P9 clockwise from N
            p2, p3, p4, p5, p6, p7, p8, p9 = P
            nb = sum(P)
            seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            tr = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8))
            if step == 0:
                c = (p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0)
            else:
                c = (p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0)
            rem = (img == 1) & (nb >= 2) & (nb <= 6) & (tr == 1) & c
            if rem.any():
                img[rem] = 0
                changed = True
        if not changed:
            break
    return img[1:-1, 1:-1].astype(bool)


def ridge_lines(m: np.ndarray, count: int, size: int) -> np.ndarray:
    """Engraved ridge lines through the THICK parts of the glyph (blade fullers, banner folds, the crease of a mass): the
    skeleton of the glyph restricted to where the stroke is thick, the `count` strongest connected pieces, tapering to
    nothing where the stroke thins out. Returns 0..1 line alpha (about 1.5 px wide at 256)."""
    out = np.zeros_like(m)
    if count <= 0:
        return out
    solid = m > 0.5
    dt = ndi.distance_transform_edt(solid)
    t0 = 0.024 * size
    cand = thin(solid) & (dt >= t0)
    if not cand.any():
        return out
    st8 = np.ones((3, 3), bool)
    lab, n = ndi.label(cand, structure=st8)
    comps = []
    for i in range(1, n + 1):
        c = lab == i
        if int(ndi.binary_fill_holes(c).sum() - c.sum()) > 0.0004 * size * size:
            continue  # a loop around a hole of the glyph (reads as a double outline, not a crease)
        ys, xs = np.nonzero(c)
        ext = float(np.hypot(ys.max() - ys.min(), xs.max() - xs.min()))
        if ext < 0.09 * size:
            continue
        comps.append((len(ys) * float(dt[c].mean()), c))
    comps.sort(key=lambda t: -t[0])
    taper = np.clip((dt - t0) / (0.008 * size) + 0.35, 0.0, 1.0)  # fades the line out where the stroke narrows
    for _, c in comps[:count]:
        out = np.maximum(out, c * taper)
    out = ndi.gaussian_filter(out, 0.8)
    return sstep((out - 0.12) / 0.28) * solid


def render_tile(mask: np.ndarray, fam: dict, band: str, field: np.ndarray, size: int, chamfer: float, rim: dict, geo: dict, grade: dict, grown: bool) -> tuple[np.ndarray, np.ndarray]:
    """geo = GEO3 fractions scaled to px. Layers: ground, flat painted glyph (hard dark keyline, tiny hard drop edge, hard
    2-tone shade on the lower-right edges, engraved ridge lines), thin taupe frame. `grown`: the mask already belongs to this
    band (grid raw) - otherwise it is made bolder per grade as a stand-in."""
    d, edge = octagon_dist(size, chamfer)
    r1 = geo['lip']
    r2 = r1 + geo['line']
    r3 = r2 + geo['band']
    r4 = r3 + geo['inner']
    base = hexf(per_band(fam['ground'], band))
    # talents_yacha r2: opt-in ground mottle boost per band via env ICONKIT_GROUND_BOOST="g=1.45" (default 1.0 = unchanged for every other builder).
    # The crimson band g has the lowest mottle contrast (luma std ~16 vs target ~23); a boost > 1 raises it. Unset env = no behaviour change.
    boost = 1.0
    for part in os.environ.get('ICONKIT_GROUND_BOOST', '').split(','):
        if part.strip().startswith(band + '='):
            try:
                boost = float(part.split('=')[1])
            except ValueError:
                pass
    rgb = ground_rgb(field, base, (0.9 if fam['mode'] == 'light' else 0.5) * boost)
    cw = geo['contour']
    if fam['mode'] == 'light':
        m = mask if grown else dilate_soft(mask, grade['grow'] * size)
        # v5: FLAT ivory pictogram, thin dark outline, NO shadow / bevel / grain. Narrow gaps of the stencil (its inner detail:
        # muscle lines, blade fullers, cracks) are painted as thin brown interior lines, like the original's pictogram detail.
        dist_out = ndi.distance_transform_edt(m < 0.5)
        key = sstep(cw + 0.8 - dist_out) * (m < 0.98)
        gr = geo.get('gap', 0.0)
        solid_b = m > 0.5
        if gr >= 1.0:  # morphological closing with a disk of radius gr: what it adds is a narrow gap / small hole of the stencil
            dil = ndi.distance_transform_edt(~solid_b) <= gr
            closed = ndi.distance_transform_edt(dil) > gr
        else:
            closed = solid_b
        gap = ndi.gaussian_filter((closed & ~solid_b).astype(np.float32), 0.7) * (m < 0.98)
        con = hexf(fam['contour'])
        rgb = rgb * (1 - key[..., None]) + con * key[..., None]
        if fam.get('interior'):
            ic = hexf(fam['interior'])
            rgb = rgb * (1 - gap[..., None]) + ic * gap[..., None]
        gc = hexf(per_band(fam['glyph'], band))
        body = np.broadcast_to(gc, rgb.shape).copy()
        if fam.get('shade') is not None:
            s = max(1, int(round(grade['shade'] * size)))
            shade = m * (1.0 - np.roll(np.roll(m, -s, 0), -s, 1))  # interior band facing lower right
            sc = hexf(per_band(fam['shade'], band))
            body = body * (1 - shade[..., None]) + sc * shade[..., None]
        if fam.get('ridge'):
            rl = ridge_lines(m, grade['ridges'], size)
            body = body * (1 - 0.88 * rl[..., None]) + hexf(fam['ridge']) * 0.88 * rl[..., None]
        rgb = rgb * (1 - m[..., None]) + body * m[..., None]
    else:
        # dark ink on a pale ground (passive Ward / Boost families): flat ink, a thin light lip to the lower right
        m = mask if grown else dilate_soft(mask, grade['grow'] * size)
        ink = hexf(per_band(fam['glyph'], band))
        hl = ndi.gaussian_filter(np.roll(np.roll(m, max(1, int(round(geo['drop']))), 0), max(1, int(round(geo['drop']))), 1), 0.8)
        rgb = np.clip(rgb * (1 + 0.20 * hl[..., None] * (1 - m[..., None])), 0, 1)
        rgb = rgb * (1 - m[..., None]) + ink * m[..., None]
    # frame (v5): bronze lip, dark outline, bevelled bronze band (lit from the upper left), thin dark inner line
    n = _NORMALS[edge]
    lit = -(n[..., 0] * _LIGHT[0] + n[..., 1] * _LIGHT[1])
    bc, bl, bd = hexf(rim['band']), hexf(rim['bandLight']), hexf(rim['bandDark'])
    if band in ('m', 'g') and fam['mode'] == 'light':
        tint = np.clip(base * 1.5, 0, 1)  # the stone picks up a little of the grade colour
        bc, bl, bd = [0.88 * x + 0.12 * tint for x in (bc, bl, bd)]
    tb = np.clip((d - r2) / max(r3 - r2, 1e-3), 0, 1)
    shade_f = lit * np.cos(np.pi * tb) * 0.62
    band_rgb = np.where(shade_f[..., None] > 0, bc + (bl - bc) * shade_f[..., None], bc + (bc - bd) * shade_f[..., None])
    band_rgb = np.clip(band_rgb + (field[..., None] - 0.5) * 0.16, 0, 1)
    lip_rgb = np.clip(hexf(rim['lip']) * (1 + 0.22 * lit[..., None]) + (field[..., None] - 0.5) * 0.08, 0, 1)
    w_lip = 1 - sstep(d - r1 + 0.5)
    w_line = sstep(d - r1 + 0.5) * (1 - sstep(d - r2 + 0.5))
    w_band = sstep(d - r2 + 0.5) * (1 - sstep(d - r3 + 0.5))
    w_in = (sstep(d - r3 + 0.5) * (1 - sstep(d - r4 + 0.5))) * 0.85
    rest = 1 - (w_lip + w_line + w_band + w_in)
    rgb = rgb * rest[..., None] + lip_rgb * w_lip[..., None] + hexf(rim['line']) * w_line[..., None] + band_rgb * w_band[..., None] + hexf(rim['inner']) * w_in[..., None]
    a = sstep(d + 0.5)
    return np.clip(rgb, 0, 1).astype(np.float32), a.astype(np.float32)


def _gutter(profile: np.ndarray, centre: int, span: int) -> int:
    """Index of the middle of the widest blank run of `profile` within centre +- span (the gutter between two cells of a sheet);
    the centre itself when nothing is blank there."""
    lo, hi = max(centre - span, 1), min(centre + span, len(profile) - 1)
    blank = profile[lo:hi] < 0.004 * max(float(profile.max()), 1e-6)
    best, run, start = (0, 0), 0, 0
    for i, v in enumerate(blank):
        if v:
            if run == 0:
                start = i
            run += 1
            if run > best[1]:
                best = (start, run)
        else:
            run = 0
    return lo + best[0] + best[1] // 2 if best[1] >= 2 else centre


def split_grid(a: np.ndarray, grid: int, nbands: int) -> list[np.ndarray]:
    """A g x g sheet of the same pictogram at grade n, m, g, p (row-major) -> per-band masks cropped to ONE common box (the
    union of the cells' content boxes in cell coordinates), so the core of the symbol keeps its place and size across grades.
    The cell borders are the blank gutters found near the midlines (a model's sheet is rarely exactly even)."""
    H, W = a.shape
    solid = (a > 0.08).astype(np.float32)
    ys_cut = [0] + [_gutter(solid.sum(1), round(H * i / grid), H // 8) for i in range(1, grid)] + [H]
    xs_cut = [0] + [_gutter(solid.sum(0), round(W * i / grid), W // 8) for i in range(1, grid)] + [W]
    cells = [a[ys_cut[r] : ys_cut[r + 1], xs_cut[c] : xs_cut[c + 1]] for r in range(grid) for c in range(grid)][:nbands]
    # per-cell content box measured from the cell's own centre, then ONE common window (same size in every cell) around it
    boxes = []
    for c in cells:
        ys, xs = np.where(c > 0.08)
        if len(ys):
            boxes.append((ys.min(), ys.max(), xs.min(), xs.max(), c.shape))
    if not boxes:
        raise ValueError('octile: empty grid cells')
    out = []
    for c in cells:
        ys, xs = np.where(c > 0.08)
        out.append((c, (ys.min(), ys.max(), xs.min(), xs.max()) if len(ys) else None))
    # common box in cell-local coordinates: union of the boxes, each cell offset-corrected to its own cell origin
    y0, y1 = min(b[0] for b in boxes), max(b[1] for b in boxes)
    x0, x1 = min(b[2] for b in boxes), max(b[3] for b in boxes)
    h, w = y1 - y0 + 1, x1 - x0 + 1
    crops = []
    for c, _ in out:
        pad = np.zeros((max(c.shape[0], y1 + 1), max(c.shape[1], x1 + 1)), np.float32)
        pad[: c.shape[0], : c.shape[1]] = c
        crops.append(pad[y0 : y0 + h, x0 : x0 + w])
    return crops


def op_octile(st, family: str = 'warm', size: int = 256, fill: float = 0.8, chamfer: float = 0.125, bands: list | None = None, seed: str | None = None, centre: list | None = None, grid: int = 0) -> None:
    """Glyph mask (st.a from `glyph`) -> octagon skill tile at `size`; rank-band variants into st.variants. `fill` = share of
    the tile well taken by the glyph's long side (x FILL_GAIN, shrunk automatically when the chamfer would clip it).
    grid=2: the raw is a 2x2 sheet of the same symbol at grade n/m/g/p (row-major): each band gets its own cell."""
    if family not in FAMILIES:
        raise ValueError(f'octile: unknown family {family!r} (warm|cool|guild|bright)')
    if st.a is None:
        op_glyph(st)
    fam = FAMILIES[family]
    bands = list(bands or BANDS)
    geo = {k: v * size for k, v in GEO3.items()}
    frame = geo['lip'] + geo['line'] + geo['band'] + geo['inner']
    well = size - 2 * frame
    if grid:
        crops = split_grid(st.a, int(grid), len(bands))
        if len(crops) < len(bands):
            raise ValueError(f'octile: grid {grid} has {len(crops)} cells for {len(bands)} bands')
        crops = crops[: len(bands)]
    else:
        m0 = st.a
        ys, xs = np.where(m0 > 0.08)
        if len(ys) == 0:
            raise ValueError('octile: empty glyph mask')
        crops = [m0[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]] * len(bands)
    h, w = crops[0].shape
    d, _ = octagon_dist(size, chamfer)
    inner = frame + geo['contour'] + 2
    cx0, cy0 = (centre or [0, 0])
    f0 = min(fill * FILL_GAIN, 0.97)

    def place(crop: np.ndarray, f: float) -> tuple[np.ndarray, float]:
        s = f * well / max(h, w)
        nh, nw = max(1, round(h * s)), max(1, round(w * s))
        mm = np.clip(resize_f(crop, nw, nh), 0, 1)
        canvas = np.zeros((size, size), np.float32)
        y0, x0 = int(round(size / 2 + cy0 * size - nh / 2)), int(round(size / 2 + cx0 * size - nw / 2))
        canvas[max(y0, 0) : y0 + nh, max(x0, 0) : x0 + nw] = mm[max(-y0, 0) : size - y0, max(-x0, 0) : size - x0]
        return canvas, float((canvas * (d < inner)).sum() / max(canvas.sum(), 1e-6))

    gains = {b: (1.0 if grid else GRADE[b]['gain']) for b in bands}
    f = f0
    clipped = 0.0
    for _ in range(10):  # the diagonal chamfer clips wide square glyphs: shrink until nothing reaches the frame (all bands)
        placed = {b: place(c, f * gains[b]) for b, c in zip(bands, crops)}
        clipped = max(v[1] for v in placed.values())
        if clipped <= 0.002:
            break
        f *= 0.96
    if clipped > 0.002:
        st.notes.append(f'octile: {clipped * 100:.1f}% of the glyph reaches the frame (lower fill or a narrower glyph)')
    field = ground_field(size, seed_of(seed or 'tile'))
    renders = {}
    canv = {}
    for b in bands:
        canvas = placed[b][0] * sstep((d - inner + 2) / 2)
        canv[b] = canvas
        grade = dict(GRADE[b])
        if grid:
            grade['ridges'] = GRID_RIDGES[b]
        # skills_sura r3: opt-in env ICONKIT_P_RIM=bronze keeps the SAME bronze frame at band p (keeps the frame constant across grades; the
        # ground and the glyph carry it; critic: the gilded p rim reads as a flat yellow 'legendary' border). Unset env = unchanged for everyone.
        p_gilded = b == 'p' and os.environ.get('ICONKIT_P_RIM', '') != 'bronze'
        renders[b] = render_tile(canvas, fam, b, field, size, chamfer, RIM_P if p_gilded else RIM, geo, grade, bool(grid))
    main_band = bands[0]
    st.rgb, st.a = renders[main_band]
    st.variants = {b: renders[b] for b in bands[1:]}
    st.glyph = canv[main_band]
    st.glyphs = canv
    st.form = 'tile'
    st.notes.append(f'info: octile v5 {family} fill {fill} (eff {f:.2f}){" grid " + str(grid) if grid else ""} glyph coverage {float((canv[main_band] > 0.5).mean()):.3f} of the tile, bands {",".join(bands)}')


# ---------------------------------------------------------------- cut-out ops
def op_matte(st, lo: float = 0.18, hi: float = 0.6, minIsland: int = 40) -> None:
    if st.a is None:
        return
    a = sstep((st.a - lo) / max(hi - lo, 1e-3))
    solid = a > 0.5
    lab, n = ndi.label(solid)
    if n:
        sizes = ndi.sum(solid, lab, index=np.arange(1, n + 1))
        biggest = sizes.max()
        keep = np.isin(lab, np.where(sizes >= max(minIsland, 0.002 * biggest))[0] + 1)
        a = np.where(ndi.binary_dilation(keep, iterations=2), a, 0.0)
    st.a = a.astype(np.float32)


def op_fit(st, size: int = 256, fill: float = 0.84, margin: float = 0.06, offset: list | None = None, thresh: float = 0.05) -> None:
    """Trim to the alpha box, scale so the long side = fill x size, centre (+ offset fractions), never past the margin."""
    if st.a is None:
        raise ValueError('fit: needs alpha (run alpha/matte first)')
    ys, xs = np.where(st.a > thresh)
    if len(ys) == 0:
        raise ValueError('fit: empty alpha')
    rgb = st.rgb[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    a = st.a[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    h, w = a.shape
    s = min(fill * size / max(h, w), (1 - 2 * margin) * size / max(h, w))
    nh, nw = max(1, round(h * s)), max(1, round(w * s))
    pm = rgb * a[..., None]
    pm2 = np.clip(resize_f(pm, nw, nh), 0, 1)
    a2 = np.clip(resize_f(a, nw, nh), 0, 1)
    rgb2 = np.where(a2[..., None] > 1e-4, pm2 / np.maximum(a2[..., None], 1e-4), 0)
    ox, oy = (offset or [0.0, 0.0])
    y0, x0 = int(round((size - nh) / 2 + oy * size)), int(round((size - nw) / 2 + ox * size))
    m = int(round(margin * size))
    y0, x0 = min(max(y0, m), size - m - nh), min(max(x0, m), size - m - nw)
    out_rgb = np.zeros((size, size, 3), np.float32)
    out_a = np.zeros((size, size), np.float32)
    out_rgb[y0 : y0 + nh, x0 : x0 + nw] = np.clip(rgb2, 0, 1)
    out_a[y0 : y0 + nh, x0 : x0 + nw] = a2
    st.rgb, st.a = out_rgb, out_a
    st.form = 'cutout'
    st.notes.append(f'info: fit long side {max(nh, nw) / size:.3f} of {size}')


def op_outline(st, width: float = 4.0, color: str = '#1a1210', opacity: float = 1.0) -> None:
    if st.a is None:
        return
    dist = ndi.distance_transform_edt(st.a < 0.5)
    ring = sstep(width + 0.5 - dist) * opacity
    a_new = np.maximum(st.a, ring)
    c = hexf(color)
    # object over outline (straight alpha "over")
    out_rgb = (st.rgb * st.a[..., None] + c * ring[..., None] * (1 - st.a[..., None])) / np.maximum(a_new[..., None], 1e-4)
    st.rgb, st.a = np.clip(out_rgb, 0, 1).astype(np.float32), a_new.astype(np.float32)


def op_shadow(st, dx: float = 0.016, dy: float = 0.024, blur: float = 0.012, opacity: float = 0.5, color: str = '#0b0806') -> None:
    if st.a is None:
        return
    H = st.a.shape[0]
    sh = np.roll(np.roll(st.a, int(round(dy * H)), 0), int(round(dx * H)), 1)
    sh = ndi.gaussian_filter(sh, blur * H) * opacity
    a_new = st.a + sh * (1 - st.a)
    c = hexf(color)
    out_rgb = (st.rgb * st.a[..., None] + c * (sh * (1 - st.a))[..., None]) / np.maximum(a_new[..., None], 1e-4)
    st.rgb, st.a = np.clip(out_rgb, 0, 1).astype(np.float32), np.clip(a_new, 0, 1).astype(np.float32)


OPS = {'glyph': op_glyph, 'octile': op_octile, 'matte': op_matte, 'fit': op_fit, 'outline': op_outline, 'shadow': op_shadow}


def main() -> None:
    """Standalone: run the job's post chain with post.py + these ops (for tuning before the ops are registered)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import post  # noqa: E402

    for k, v in OPS.items():
        post.OPS.setdefault(k, v)
    post.main()


if __name__ == '__main__':
    main()

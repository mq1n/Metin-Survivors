#!/usr/bin/env python3
"""Self-test of the icon v2 ops (py/iconkit.py): python tools/imagegen/py/test_iconkit.py  -> prints OK or raises."""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import iconkit  # noqa: E402
import post  # noqa: E402


def stencil(size: int = 512) -> np.ndarray:
    yy, xx = np.mgrid[0:size, 0:size] / size
    m = ((np.abs(xx - 0.5) < 0.06) & (np.abs(yy - 0.5) < 0.32)) | ((np.abs(yy - 0.62) < 0.04) & (np.abs(xx - 0.5) < 0.18))
    return np.dstack([m, m, m]).astype(np.float32)


def test_tile() -> None:
    st = post.State(rgb=stencil())
    iconkit.op_glyph(st)
    assert st.a is not None and 0.02 < float((st.a > 0.5).mean()) < 0.2, 'glyph mask coverage'
    iconkit.op_octile(st, family='warm', bands=['n', 'm', 'g', 'p'], seed='icon_test')
    assert st.rgb.shape == (256, 256, 3) and st.a.shape == (256, 256)
    for blk in (st.a[:8, :8], st.a[:8, -8:], st.a[-8:, :8], st.a[-8:, -8:]):
        assert blk.max() < 5 / 255, 'chamfered corners must be transparent'
    assert st.a[128, 128] > 0.99 and st.a[128, 2] > 0.5, 'tile body opaque'
    assert set(st.variants) == {'m', 'g', 'p'}, 'rank-band variants'
    assert st.form == 'tile' and st.glyph.shape == (256, 256)
    g = st.glyph > 0.5
    L = st.rgb @ iconkit.LUMA
    ground = (~iconkit.ndi.binary_dilation(g, iterations=10)) & (st.a > 0.99)
    ground[:40], ground[-40:], ground[:, :40], ground[:, -40:] = False, False, False, False
    assert L[g].mean() - L[ground].mean() > 0.3, 'cream glyph reads on the warm ground'
    # same glyph, different ground per band
    assert abs(float(st.variants['g'][0][ground].mean() - st.rgb[ground].mean())) > 0.02


def test_v5_flat_ivory_bronze_and_grid() -> None:
    # bronze frame (v5: ~10 % of the side per edge; target ~12.5 %), flat ivory glyph, no marble / bevel layers
    frame = sum(iconkit.GEO3[k] for k in ('lip', 'line', 'band', 'inner'))
    assert 0.09 < frame < 0.125, frame
    assert iconkit.FAMILIES['warm']['shade'] is None and iconkit.FAMILIES['warm']['ridge'] is None
    assert abs(iconkit.hexf(iconkit.FAMILIES['warm']['glyph']['n']) - iconkit.hexf('#fff3ce')).max() < 0.02, 'ivory'
    band = iconkit.hexf(iconkit.RIM['band'])
    assert band[0] > band[1] > band[2] and band[0] - band[2] > 0.15, 'warm bronze, not grey pewter'
    # the glyph body is ONE flat colour (no grain): a fat bar with a thin gap cut into it
    sz = 256
    flat = np.zeros((sz, sz), np.float32)
    flat[70:190, 50:206] = 1.0
    flat[125:130, 60:196] = 0.0  # a thin interior gap (the stencil's inner detail)
    stf = post.State(rgb=np.dstack([flat, flat, flat]))
    iconkit.op_glyph(stf)
    iconkit.op_octile(stf, family='warm', bands=['n'], seed='flat_test')
    gl = stf.glyph > 0.97
    core = iconkit.ndi.binary_erosion(gl, iterations=6)
    cols = stf.rgb[core]
    assert cols.std(0).max() < 0.012, f'flat ivory body {cols.std(0)}'
    ys, xs = np.where(gl)
    cy, cx = int(ys.mean()), int(xs.mean())
    line = stf.rgb[cy - 1 : cy + 2, cx - 20 : cx + 20].reshape(-1, 3).mean(0)
    assert iconkit.luma(line) < iconkit.luma(cols.mean(0)) - 0.25, 'the thin interior gap shows as a darker brown line'
    # a thick bar gets an engraved ridge line through its middle, a thin stroke none
    size = 256
    bar = np.zeros((size, size), np.float32)
    bar[110:146, 40:216] = 1.0
    r = iconkit.ridge_lines(bar, 2, size)
    assert r[120:136, 60:200].max() > 0.5 and r[:100].max() < 0.01 and r[150:].max() < 0.01, 'ridge line runs along the bar centre'
    thin = np.zeros((size, size), np.float32)
    thin[124:132, 40:216] = 1.0
    assert iconkit.ridge_lines(thin, 2, size).max() < 0.01, 'no ridge through thin strokes'
    # 2 x 2 grade sheet: every band gets its own cell; grade 4 is the richest and the core keeps its place
    n = 512
    sheet = np.zeros((n, n), np.float32)
    h = n // 2
    for k, extra in enumerate((0, 1, 2, 3)):
        r0, c0 = (k // 2) * h, (k % 2) * h
        sheet[r0 + 110 : r0 + 146, c0 + 60 : c0 + 196] = 1.0  # the core bar of every grade
        for e in range(extra):
            sheet[r0 + 40 + e * 30 : r0 + 62 + e * 30, c0 + 80 : c0 + 176] = 1.0  # grade-specific extra strokes
    st = post.State(rgb=np.dstack([sheet, sheet, sheet]))
    iconkit.op_glyph(st)
    iconkit.op_octile(st, family='warm', bands=['n', 'm', 'g', 'p'], seed='grid_test', grid=2)
    cov = [float((st.glyphs[b] > 0.5).sum()) for b in 'nmgp']
    assert cov[0] < cov[1] < cov[2] < cov[3], f'each grade draws more of the symbol {cov}'
    assert set(st.variants) == {'m', 'g', 'p'}
    for fam in ('cool', 'bright', 'guild'):
        st2 = post.State(rgb=stencil())
        iconkit.op_glyph(st2)
        iconkit.op_octile(st2, family=fam, bands=['n', 'm', 'g', 'p'], seed='fam_' + fam)
        assert st2.rgb.shape == (256, 256, 3) and set(st2.variants) == {'m', 'g', 'p'}


def test_grid_gutters_follow_the_sheet() -> None:
    # a model's 2x2 sheet is rarely even: the right column starts at x=300 and the lower row at y=290; a glyph of cell 1 reaches past
    # the midline (x 240-262) without touching the gutter, which must still be found
    n = 512
    sheet = np.zeros((n, n), np.float32)
    sheet[100:150, 70:262] = 1.0           # cell 1 (reaches x=262, past the midline 256)
    sheet[100:150, 330:470] = 1.0          # cell 2
    sheet[330:380, 70:230] = 1.0           # cell 3
    sheet[330:380, 330:470] = 1.0          # cell 4
    cells = iconkit.split_grid(sheet, 2, 4)
    assert len(cells) == 4 and all(c.shape == cells[0].shape for c in cells), [c.shape for c in cells]
    assert cells[0].sum() > cells[1].sum() > 0, 'cell 1 keeps its whole bar, cell 2 its own'
    assert abs(float(cells[0].sum()) - 50 * 192) < 5, 'nothing of cell 1 was cut at the midline'


def test_cutout() -> None:
    size = 600
    yy, xx = np.mgrid[0:size, 0:size] / size
    a = (((xx - 0.5) ** 2 + (yy - 0.5) ** 2) < 0.12).astype(np.float32)
    st = post.State(rgb=np.dstack([a * 0.8, a * 0.2, a * 0.2]).astype(np.float32), a=a)
    iconkit.op_matte(st)
    iconkit.op_fit(st, size=256, fill=0.84, offset=[-0.01, -0.015])
    iconkit.op_outline(st, width=4)
    iconkit.op_shadow(st)
    assert st.a.shape == (256, 256) and st.form == 'cutout'
    r = 8
    ring = np.ones((256, 256), bool)
    ring[r:-r, r:-r] = False
    assert st.a[ring].max() <= 8 / 255, f'nothing in the outer 3 % ring (got {st.a[ring].max() * 255:.1f})'
    ys, xs = np.where(st.a > 0.05)
    assert 0.8 < (ys.max() - ys.min() + 1) / 256 < 0.95


if __name__ == '__main__':
    test_tile()
    test_v5_flat_ivory_bronze_and_grid()
    test_grid_gutters_follow_the_sheet()
    test_cutout()
    print('OK')

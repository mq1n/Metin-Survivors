#!/usr/bin/env python3
"""Self-checks for the VFX post ops in post.py (synthetic images, exact assertions).

usage: python tools/imagegen/py/test_post.py      (exit 0 = all pass; also run by `bun test` via src/post.test.ts)
"""
from __future__ import annotations

import os
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post  # noqa: E402

rng = np.random.default_rng(7)


def state(rgb: np.ndarray, a: np.ndarray | None = None) -> post.State:
    return post.State(rgb=rgb.astype(np.float32), a=None if a is None else a.astype(np.float32))


def sprite(n: int = 256, floor: float = 12 / 255) -> np.ndarray:
    """Grey noisy floor + a bright warm blob + a faint tail: a typical 'pure black' generator output."""
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    r = np.hypot(xx - n / 2, yy - n / 2) / (n / 2)
    L = floor + rng.normal(0, 1.5 / 255, (n, n)) + 0.75 * np.exp(-((r / 0.25) ** 2)) + 0.12 * np.exp(-((r / 0.6) ** 2))
    rgb = np.clip(np.dstack([L * 1.1, L, L * 0.8]), 0, 1)
    return rgb


def test_neutral_keeps_luminance() -> None:
    rgb = rng.random((32, 32, 3))
    st = state(rgb)
    post.op_neutral(st)
    assert np.allclose(st.rgb[..., 0], st.rgb[..., 1]) and np.allclose(st.rgb[..., 1], st.rgb[..., 2])
    assert np.allclose(post.luma(st.rgb), np.clip(post.luma(rgb.astype(np.float32)), 0, 1), atol=1e-5)


def test_blackpoint_crushes_floor_keeps_tail_and_normalises() -> None:
    st = state(sprite())
    post.op_neutral(st)
    post.op_blackpoint(st)
    L = post.luma(st.rgb)
    ring = post.border_ring(L)
    assert ring.max() == 0.0, f'border not black: {ring.max()}'
    assert (L == 0).mean() > 0.3, 'background was not crushed to true black'
    n = L.shape[0]
    assert L[n // 2, int(n * 0.75)] > 0.0, 'faint tail was clipped away'
    assert abs(np.percentile(st.rgb.max(axis=2), 99.9) - 1.0) < 1e-3, 'peak not normalised to 1'
    assert any(x.startswith('info: blackpoint floor') for x in st.notes)


def test_blackpoint_preserves_hue_with_keep_color() -> None:
    st = state(sprite())
    post.op_blackpoint(st, normalize=False)
    c = st.rgb[128, 128]
    assert c[0] > c[1] > c[2], 'warm colour ratio lost'


def test_gain_scales_colour_and_alpha_and_clips() -> None:
    st = state(np.full((8, 8, 3), 0.8), np.full((8, 8), 0.5))
    post.op_gain(st, rgb=0.25, alpha=0.5)
    assert np.allclose(st.rgb, 0.2) and np.allclose(st.a, 0.25), 'rgb / alpha not scaled'
    post.op_gain(st, rgb=10.0)
    assert st.rgb.max() == 1.0 and np.allclose(st.a, 0.25), 'rgb must clip at 1 and leave alpha alone'
    add = state(np.full((4, 4, 3), 0.6))
    post.op_gain(add, rgb=0.5, alpha=0.1)  # an additive sprite has no alpha: alpha is ignored
    assert add.a is None and np.allclose(add.rgb, 0.3)


def test_gain_ground_matches_gamma_space_add() -> None:
    v = np.linspace(0.0, 0.7, 15)
    st = state(np.dstack([np.full((1, 15), 0.0)] * 3) + v[None, :, None])
    post.op_gain(st, rgb=1.0, ground=0.25)
    out = st.rgb[0, :, 0].astype(np.float64)
    g = float(post._srgb_lin(np.float64(0.25)))
    added = post._srgb_enc(g + post._srgb_lin(out)) - 0.25          # what our linear add shows over a 0.25 ground
    assert np.allclose(added, np.minimum(v, 0.75), atol=2e-3), 'linear-light add of the re-mapped texel does not equal the gamma-space add'
    assert np.all(np.diff(out) >= 0) and out[0] == 0.0, 'mapping must be monotone and keep black black'
    assert out[5] > v[5], 'dim texels must be lifted (linear light swallows them)'


def test_edgefade_zero_edges_untouched_interior() -> None:
    st = state(np.ones((200, 100, 3)))
    post.op_edgefade(st, width=0.03)
    assert st.rgb[0].max() == 0 and st.rgb[-1].max() == 0 and st.rgb[:, 0].max() == 0 and st.rgb[:, -1].max() == 0
    assert np.all(st.rgb[10:-10, 5:-5] == 1.0), 'interior beyond the fade band changed'
    assert any(x.startswith('edgefade:') for x in st.notes), 'content in the band should be reported'
    sa = state(np.ones((64, 64, 3)), np.ones((64, 64)))
    post.op_edgefade(sa)
    assert sa.a[0].max() == 0 and np.all(sa.rgb == 1.0), 'with alpha only alpha fades'


def test_trim_center_square_on_black() -> None:
    rgb = np.zeros((300, 400, 3))
    rgb[40:80, 250:330] = 0.8  # off-centre content
    st = state(rgb)
    post.op_trim(st, square=True, center=True, padFrac=0.1, thresh=4 / 255)
    h, w = st.rgb.shape[:2]
    assert h == w == 80 + 2 * 8, (h, w)
    ys, xs = np.where(post.luma(st.rgb) > 0.1)
    assert abs((ys.min() + ys.max()) / 2 - (h - 1) / 2) <= 0.5 and abs((xs.min() + xs.max()) / 2 - (w - 1) / 2) <= 0.5


def test_trim_legacy_noop_without_alpha() -> None:
    rgb = np.zeros((50, 60, 3))
    rgb[10:20, 10:20] = 1
    st = state(rgb)
    post.op_trim(st)
    assert st.rgb.shape == (50, 60, 3)


def test_alpha_only_if_opaque() -> None:
    a = np.zeros((64, 64))
    a[16:48, 16:48] = 1
    st = state(np.ones((64, 64, 3)) * 0.5, a)
    post.op_alpha(st, onlyIfOpaque=True)
    assert np.array_equal(st.a, a.astype(np.float32)) and 'info: kept the generator alpha channel' in st.notes
    rgb = np.zeros((64, 64, 3))
    rgb[...] = [1, 0, 1]
    rgb[20:44, 20:44] = [0.2, 0.6, 0.3]
    st2 = state(rgb)
    post.op_alpha(st2, onlyIfOpaque=True)
    assert st2.a is not None and st2.a[0, 0] < 0.05 and st2.a[32, 32] > 0.95
    assert any('chroma-keyed' in x for x in st2.notes)


def test_bleed_soft_sprite() -> None:
    a = np.zeros((64, 64))
    a[24:40, 24:40] = 0.3  # soft sprite: never above 0.5
    rgb = np.zeros((64, 64, 3))
    rgb[24:40, 24:40] = [0.9, 0.8, 0.7]
    st = state(rgb, a)
    post.op_bleed(st)  # default solid 0.5: nothing to bleed from
    assert st.rgb[0, 0].max() == 0
    post.op_bleed(st, solid=0.15)
    assert np.allclose(st.rgb[0, 0], [0.9, 0.8, 0.7]), 'transparent texels should carry the sprite colour'


def test_glow_widens_thin_detail_and_keeps_peak() -> None:
    n = 128
    rgb = np.zeros((n, n, 3), np.float32)
    rgb[:, n // 2] = 0.9  # a one-pixel line
    st = state(rgb)
    post.op_glow(st, sigma=0.04, amount=2.0, round=0.97)
    L = post.luma(st.rgb)
    assert (L[n // 2] > 0.02).sum() > 3 * (rgb[n // 2, :, 0] > 0.02).sum(), 'the line should have gained a soft body'
    assert abs(float(np.percentile(st.rgb.max(axis=2), 99.9)) - 0.9) < 0.12, 'peak is renormalised to the input peak'
    assert L[0, 0] == 0 and L[-1, -1] == 0, 'round mask: nothing in the corners'


def test_spinblur_smears_along_the_rotation() -> None:
    n = 129
    rgb = np.zeros((n, n, 3), np.float32)
    rgb[n // 2 - 2 : n // 2 + 3, n // 2 + 40 : n // 2 + 46] = 1.0  # a small blob on the +x axis
    st = state(rgb)
    post.op_spinblur(st, angle=30.0, steps=11)
    L = post.luma(st.rgb)
    yy, xx = np.nonzero(L > 0.02)
    ang = np.degrees(np.arctan2(yy - n // 2, xx - n // 2))
    assert ang.max() - ang.min() > 20, 'the blob is spread over an arc'
    assert np.allclose(np.hypot(yy - n // 2, xx - n // 2).std(), 0, atol=4), 'blur stays on the circle (radius preserved)'
    assert L.max() < 0.6, 'mean (not sum): brightness drops'


def _blob(n: int, sigma: float, peak: float) -> np.ndarray:
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    r = np.hypot(xx - n / 2, yy - n / 2) / (n / 2)
    return peak * np.exp(-((r / sigma) ** 2))


def _table(v: np.ndarray) -> list:
    flat = np.asarray(v, dtype=np.float64).reshape(-1)
    return [float(np.quantile(flat, 1.0 - u)) for u in post.PROFILE_U]


def test_area_above_is_the_rank_from_the_top() -> None:
    v = np.array([[0.0, 0.2], [0.4, 0.4]])
    a = post.area_above(v)
    assert np.allclose(a, [[0.875, 0.625], [0.25, 0.25]]), a   # (N - (below + at-or-below) / 2) / N: ties count half
    assert a.max() <= 1.0 and a.min() >= 0.0


def test_tonefit_matches_the_original_coverage_not_just_its_light() -> None:
    n = 128
    orig = _blob(n, 0.55, 0.45)                       # a wide, dim original (peak 0.45)
    q = _table(orig)
    full = _blob(n, 0.80, 1.0)                        # the generator's version: same shape class, much fuller and peak white
    st = state(np.dstack([full] * 3))
    post.op_tonefit(st, q=q, ground=0.0, cap=4.0, smooth=0.0, ramp=0.0)
    out = st.rgb.max(axis=2).astype(np.float64)
    for lv in (0.05, 0.1, 0.25, 0.4):
        want, got = float((orig > lv).mean()), float((out > lv).mean())
        assert abs(got - want) <= 0.03, f'area above {lv}: {got:.3f} vs {want:.3f}'
    assert abs(np.percentile(out, 99.9) - np.percentile(orig, 99.9)) < 0.03, 'peak not matched'
    assert abs(out.mean() - orig.mean()) / orig.mean() < 0.08, 'mean not matched'
    assert any(x.startswith('info: tonefit') for x in st.notes) and not any('deficit' in x for x in st.notes)
    # a uniform gain that matches the mean leaves the peak far too low: the point of the op
    g = state(np.dstack([full] * 3))
    post.op_gain(g, rgb=float(orig.mean() / full.mean()))
    assert float(g.rgb.max()) < float(orig.max()) * 0.9 or float((g.rgb.max(axis=2) > 0.25).mean()) > float((orig > 0.25).mean()) + 0.05, 'the uniform gain should miss the profile'


def test_tonefit_keeps_black_black_hue_and_order() -> None:
    n = 96
    full = _blob(n, 0.6, 1.0)
    rgb = np.dstack([full * 1.0, full * 0.8, full * 0.5])
    rgb[full < 0.02] = 0.0
    st = state(rgb)
    post.op_tonefit(st, q=_table(_blob(n, 0.4, 0.5)), ground=0.0)
    out = st.rgb.astype(np.float64)
    assert (out[full < 0.02] == 0).all(), 'a quantile map never invents support'
    m = full > 0.3
    ratio = out[..., 1][m] / np.maximum(out[..., 0][m], 1e-6)
    assert np.allclose(ratio, 0.8, atol=0.02), 'colour ratio changed'
    v = out.max(axis=2)
    order = np.argsort(full.reshape(-1))
    assert (np.diff(v.reshape(-1)[order]) >= -1e-4).all(), 'rank order of the texels changed'


def test_tonefit_reports_support_deficit_and_skips_alpha() -> None:
    n = 96
    thin = _blob(n, 0.12, 1.0)
    st = state(np.dstack([thin] * 3))
    post.op_tonefit(st, q=_table(_blob(n, 0.7, 0.5)), ground=0.0)
    assert any('support deficit' in x for x in st.notes), st.notes
    a = state(np.dstack([thin] * 3), a=np.ones((n, n)))
    before = a.rgb.copy()
    post.op_tonefit(a, q=_table(_blob(n, 0.7, 0.5)), ground=0.0)
    assert np.array_equal(a.rgb, before) and any('skipped' in x for x in a.notes)


def test_tonefit_ground_transfer_brightens_dim_texels() -> None:
    v = np.array([0.05, 0.1, 0.4])
    t = post.ground_transfer(v, 0.25)
    assert np.all(t > v) and abs(float(t[1]) - 0.25) < 0.03, t   # T(0.1) = 0.25 over a 0.25 ground (texture builder notes)
    assert np.allclose(post.ground_transfer(v, 0.0), v)


def test_save_main_auto_and_explicit() -> None:
    with tempfile.TemporaryDirectory() as d:
        st = state(sprite())
        post.op_neutral(st)
        post.op_blackpoint(st)
        p = os.path.join(d, 'a.webp')
        n, ll, note = post.save_main(p, st, 90, 'auto', 3.0)
        assert os.path.getsize(p) == n and note and note.startswith('info: webp ') and not os.path.exists(p + '.ll.webp')
        n2, ll2, note2 = post.save_main(os.path.join(d, 'b.webp'), st, 90, True, 3.0)
        assert ll2 is True and note2 is None
        n3, ll3, _ = post.save_main(os.path.join(d, 'c.webp'), st, 90, False, 3.0)
        assert ll3 is False


def main() -> None:
    tests = [(k, v) for k, v in globals().items() if k.startswith('test_') and callable(v)]
    for name, fn in tests:
        fn()
        print(f'ok   {name}')
    print(f'{len(tests)} post.py checks passed')


if __name__ == '__main__':
    main()

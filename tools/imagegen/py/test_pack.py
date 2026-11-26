#!/usr/bin/env python3
"""Self-test of PACK mode slicing (py/pack.py): python tools/imagegen/py/test_pack.py  -> prints OK or raises.
Synthetic 2 x 2 sheets are drawn with PIL; nothing here touches the real pipeline directories."""
from __future__ import annotations

import os
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import iconkit  # noqa: E402
import pack  # noqa: E402
import post  # noqa: E402

S = 1024


def tile_sheet() -> Image.Image:
    """Four different white stencils on black; uneven gutters: the right column starts at ~560, the lower row at ~520, and the
    bar of cell 1 reaches past the midline (x 480-540) without touching the gutter."""
    im = Image.new('RGB', (S, S), (0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle((150, 100, 230, 420), fill='white')                      # cell 1: bar
    d.rectangle((250, 250, 540, 290), fill='white')                      # cell 1: arm reaching past x = 512 (the midline)
    d.ellipse((620, 100, 880, 360), outline='white', width=40)           # cell 2: ring
    d.rectangle((120, 640, 480, 720), fill='white')                      # cell 3: cross
    d.rectangle((260, 580, 340, 900), fill='white')
    d.polygon([(700, 900), (900, 900), (800, 640)], fill='white')        # cell 4: triangle
    return im


def blade(d: ImageDraw.ImageDraw, tip: tuple[int, int], hilt: tuple[int, int], col, w: int) -> None:
    d.line([hilt, tip], fill=col, width=w)


def cutout_sheet(bg: tuple | None) -> Image.Image:
    """Four coloured objects on a transparent (bg None) or flat opaque sheet; the sword of cell 1 pokes 24 px past the midline."""
    mode = 'RGBA' if bg is None else 'RGB'
    im = Image.new(mode, (S, S), (0, 0, 0, 0) if bg is None else bg)
    d = ImageDraw.Draw(im)
    blade(d, (536, 90), (120, 440), (200, 205, 215, 255) if bg is None else (200, 205, 215), 46)      # sword, tip at x=536 (past the midline 512)
    d.ellipse((600, 120, 880, 400), fill=(190, 40, 50, 255) if bg is None else (190, 40, 50))        # stone
    d.rectangle((150, 600, 400, 900), fill=(60, 120, 200, 255) if bg is None else (60, 120, 200))     # armour block
    d.polygon([(640, 880), (900, 880), (770, 620)], fill=(220, 180, 40, 255) if bg is None else (220, 180, 40))
    return im


def run(im: Image.Image, n: int = 4, kind: str = 'tile', names=None):
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, 'sheet.png')
        im.save(p)
        out = os.path.join(td, 'out')
        rep = pack.slice_sheet(p, out, n, kind, names or ['a', 'b', 'c', 'd'])
        cells = {}
        for c in rep['cells']:
            if c['file']:
                with Image.open(c['file']) as f:
                    cells[c['index']] = f.copy()
        assert os.path.exists(os.path.join(out, 'slice.png')) and os.path.exists(os.path.join(out, 'slice.json'))
        return rep, cells


def test_tile_pack_four_equal_cells() -> None:
    rep, cells = run(tile_sheet())
    assert rep['failed'] == [] and rep['mode'] == 'colour' and len(cells) == 4, rep
    sizes = {im.size for im in cells.values()}
    assert len(sizes) == 1 and next(iter(sizes))[0] == next(iter(sizes))[1], f'one common square canvas, got {sizes}'
    assert rep['cell_size'] % 8 == 0 and rep['cell_size'] >= 256
    # every cell raw keeps ONLY its own object, centred, on black: the geometry the per-id post chain sees is identical
    for i, im in cells.items():
        a = np.asarray(im.convert('L')).astype(np.float32) / 255.0
        ys, xs = np.where(a > 0.5)
        assert len(ys) > 5000, f'cell {i} not empty'
        cy, cx = (ys.min() + ys.max()) / 2, (xs.min() + xs.max()) / 2
        assert abs(cy - im.height / 2) < 3 and abs(cx - im.width / 2) < 3, f'cell {i} object centred ({cx:.0f},{cy:.0f})'
        # nothing of another cell leaked in: the object bbox stays inside the canvas minus the margin
        assert ys.min() >= 0.05 * im.height and xs.min() >= 0.05 * im.width and ys.max() <= 0.95 * im.height and xs.max() <= 0.95 * im.width
    # the arm of cell 1 that reaches past the sheet midline (x 512..540) is still part of cell 1: bar 81x321 + arm 291x41
    a1 = np.asarray(cells[1].convert('L')) > 128
    assert abs(int(a1.sum()) - (81 * 321 + 291 * 41)) < 300, f'cell 1 kept its whole bar + arm ({int(a1.sum())} px)'
    assert rep['cells'][0]['bbox'][2] >= 539, rep['cells'][0]['bbox']


def test_transparent_cutout_pack_keeps_alpha_and_tip() -> None:
    rep, cells = run(cutout_sheet(None), kind='cutout')
    assert rep['mode'] == 'alpha' and rep['failed'] == [], rep
    for i, im in cells.items():
        assert im.mode == 'RGBA'
        a = np.asarray(im)[..., 3]
        assert a[0, 0] == 0 and a[-1, -1] == 0 and a.max() == 255
        assert (a > 0).sum() > 8000
    # the sword's tip (x up to 536, 24 px past the midline) is whole in cell 1: its bbox spans the full diagonal
    ys, xs = np.where(np.asarray(cells[1])[..., 3] > 128)
    assert (xs.max() - xs.min()) >= 400 - 30 and (ys.max() - ys.min()) >= 350 - 30
    assert not any('crosses' in (c['reason'] or '') for c in rep['cells'])


def test_opaque_flat_background_is_kept_for_the_alpha_key() -> None:
    bg = (40, 120, 110)
    rep, cells = run(cutout_sheet(bg), kind='cutout')
    assert rep['mode'] == 'colour' and rep['failed'] == []
    assert all(abs(rep['bg'][i] - bg[i] / 255) < 0.01 for i in range(3)), rep['bg']
    # the existing cut-out chain (alpha key auto -> matte -> fit) keys the object out of the cell raw from its own border colour
    im = cells[3]
    px = np.asarray(im.convert('RGB')).astype(np.float32) / 255.0
    assert np.abs(px[0, 0] - np.array(bg) / 255.0).max() < 0.01, 'cell border = the sheet background'
    st = post.State(rgb=px)
    post.op_alpha(st, key='auto', onlyIfOpaque=True)
    iconkit.op_matte(st)
    iconkit.op_fit(st, size=256, fill=0.84, margin=0.09)
    assert st.a.shape == (256, 256) and st.a[128, 128] > 0.9 and st.a[:8].max() < 0.05


def test_touching_icons_fail_only_their_cells() -> None:
    im = tile_sheet()
    d = ImageDraw.Draw(im)
    d.rectangle((215, 330, 700, 360), fill='white')       # a bridge joins the bar of cell 1 and the ring of cell 2 across the gutter
    rep, cells = run(im)
    assert rep['failed'] == [1, 2], rep['failed']
    assert 'crosses the gutter' in rep['cells'][0]['reason'] and 'crosses the gutter' in rep['cells'][1]['reason']
    assert set(cells) == {3, 4}, 'the other two stay usable'


def test_empty_and_cropped_cells_fail() -> None:
    im = tile_sheet()
    d = ImageDraw.Draw(im)
    d.rectangle((600, 90, 900, 380), fill='black')        # wipe cell 2
    d.rectangle((700, 700, 905, S), fill='white')         # cell 4 runs off the sheet border
    rep, cells = run(im)
    assert rep['failed'] == [2, 4], rep['failed']
    assert 'empty' in rep['cells'][1]['reason'] and 'border' in rep['cells'][3]['reason']
    assert set(cells) == {1, 3}


def test_divider_lines_and_frames_do_not_glue_the_cells() -> None:
    im = tile_sheet()
    d = ImageDraw.Draw(im)
    d.line([(540, 0), (540, S)], fill='white', width=5)          # a cell divider the model drew despite the prompt
    d.line([(0, 500), (S, 500)], fill='white', width=5)
    d.rectangle((2, 2, S - 3, S - 3), outline='white', width=4)  # and a frame around the whole sheet
    rep, cells = run(im)
    assert rep['failed'] == [] and set(cells) == {1, 2, 3, 4}, rep['failed']
    assert any('divider' in n for n in rep['notes']), rep['notes']


def test_a_row_of_four_is_not_mistaken_for_a_2x2_sheet() -> None:
    im = Image.new('RGB', (S, S), (0, 0, 0))
    d = ImageDraw.Draw(im)
    for i in range(4):  # four icons in ONE row: two land in each upper quadrant, the lower row is empty
        d.rectangle((40 + i * 245, 400, 40 + i * 245 + 170, 570), fill='white')
    rep, cells = run(im)
    assert rep['failed'] == [1, 2, 3, 4], rep['failed']
    assert 'layout is not a 2x2 sheet' in rep['cells'][0]['reason'] and 'empty' in rep['cells'][2]['reason']
    assert cells == {}


def test_padded_pack_ignores_the_unused_cells() -> None:
    rep, cells = run(tile_sheet(), n=3)
    assert rep['n'] == 3 and len(rep['cells']) == 3 and rep['failed'] == [] and set(cells) == {1, 2, 3}
    assert any('unused cell 4' in i for s in rep['spare'] for i in s['infos']), rep['spare']
    rep2, cells2 = run(tile_sheet(), n=2)
    assert set(cells2) == {1, 2}


def test_cell_raws_run_through_the_existing_tile_post() -> None:
    rep, cells = run(tile_sheet())
    tiles = []
    for i in sorted(cells):
        st = post.State(rgb=np.asarray(cells[i].convert('RGB')).astype(np.float32) / 255.0)
        iconkit.op_glyph(st)
        iconkit.op_octile(st, family='warm', bands=['n'], seed=f'pack_{i}')
        assert st.rgb.shape == (256, 256, 3) and st.form == 'tile'
        for blk in (st.a[:8, :8], st.a[:8, -8:], st.a[-8:, :8], st.a[-8:, -8:]):
            assert blk.max() < 5 / 255, 'chamfered corners transparent on every cell'
        tiles.append(st)
    # identical frame geometry: the alpha silhouette of the four tiles is the same octagon
    for t in tiles[1:]:
        assert np.abs(t.a - tiles[0].a).max() < 1e-6
    # four different symbols
    cov = [float((t.glyph > 0.5).mean()) for t in tiles]
    assert len({round(c, 3) for c in cov}) == 4, cov


def test_cell_raws_run_through_the_existing_cutout_post() -> None:
    rep, cells = run(cutout_sheet(None), kind='cutout')
    for i in sorted(cells):
        a = np.asarray(cells[i]).astype(np.float32) / 255.0
        st = post.State(rgb=a[..., :3], a=a[..., 3])
        post.op_alpha(st, key='auto', onlyIfOpaque=True)
        iconkit.op_matte(st)
        iconkit.op_fit(st, size=256, fill=0.84, margin=0.09)
        iconkit.op_outline(st, width=4)
        iconkit.op_shadow(st)
        assert st.a.shape == (256, 256) and st.form == 'cutout'
        ring = np.ones((256, 256), bool)
        ring[8:-8, 8:-8] = False
        assert st.a[ring].max() <= 8 / 255, f'cell {i}: nothing in the outer 3 % ring'


if __name__ == '__main__':
    test_tile_pack_four_equal_cells()
    test_transparent_cutout_pack_keeps_alpha_and_tip()
    test_opaque_flat_background_is_kept_for_the_alpha_key()
    test_touching_icons_fail_only_their_cells()
    test_empty_and_cropped_cells_fail()
    test_divider_lines_and_frames_do_not_glue_the_cells()
    test_a_row_of_four_is_not_mistaken_for_a_2x2_sheet()
    test_padded_pack_ignores_the_unused_cells()
    test_cell_raws_run_through_the_existing_tile_post()
    test_cell_raws_run_through_the_existing_cutout_post()
    print('OK')

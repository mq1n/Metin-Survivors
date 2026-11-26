"""Vectorised numpy triangle rasteriser (z-buffer, barycentrics). Used for orthographic views AND for UV-space (texel) rasterisation."""
from __future__ import annotations

import numpy as np


def rasterize(xy: np.ndarray, z: np.ndarray, tris: np.ndarray, W: int, H: int, chunk: int = 900_000, eps: float = 1e-5, tri_ids: np.ndarray | None = None):
    """xy: [V,2] pixel coords (pixel centre of texel (i,j) is (i+.5, j+.5)); z: [V] smaller = nearer; tris: [T,3] int.

    returns (tri [H,W] int32 (-1 = empty), bary [H,W,3] float32, depth [H,W] float32 (inf where empty)).
    `tri_ids` (optional, [T]) is written into the id buffer instead of the triangle index.
    """
    xy = xy.astype(np.float64)
    z = z.astype(np.float64)
    a = xy[tris[:, 0]]
    b = xy[tris[:, 1]]
    c = xy[tris[:, 2]]
    det = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1])
    x0 = np.floor(np.minimum(np.minimum(a[:, 0], b[:, 0]), c[:, 0]) - 0.5).astype(np.int64)
    x1 = np.ceil(np.maximum(np.maximum(a[:, 0], b[:, 0]), c[:, 0]) - 0.5).astype(np.int64)
    y0 = np.floor(np.minimum(np.minimum(a[:, 1], b[:, 1]), c[:, 1]) - 0.5).astype(np.int64)
    y1 = np.ceil(np.maximum(np.maximum(a[:, 1], b[:, 1]), c[:, 1]) - 0.5).astype(np.int64)
    x0 = np.clip(x0, 0, W - 1)
    x1 = np.clip(x1, 0, W - 1)
    y0 = np.clip(y0, 0, H - 1)
    y1 = np.clip(y1, 0, H - 1)
    bw = x1 - x0 + 1
    bh = y1 - y0 + 1
    ok = (np.abs(det) > 1e-12) & (bw > 0) & (bh > 0)
    # triangles fully off-screen collapse to a clipped 1px bbox; the inside test rejects them
    ids = np.nonzero(ok)[0]
    cnt = (bw * bh)[ids]

    zbuf = np.full(H * W, np.inf, dtype=np.float64)
    idbuf = np.full(H * W, -1, dtype=np.int64)
    # chunk over triangles so the candidate arrays stay bounded
    cum = np.cumsum(cnt)
    start = 0
    n = len(ids)
    while start < n:
        base = cum[start - 1] if start > 0 else 0
        end = int(np.searchsorted(cum, base + chunk, side='right'))
        end = max(end, start + 1)
        end = min(end, n)
        sel = ids[start:end]
        cc = cnt[start:end]
        tot = int(cc.sum())
        rep = np.repeat(np.arange(len(sel)), cc)
        first = np.cumsum(cc) - cc
        local = np.arange(tot) - first[rep]
        t = sel[rep]
        w_ = bw[t]
        px = x0[t] + local % w_
        py = y0[t] + local // w_
        cx = px + 0.5
        cy = py + 0.5
        ax = a[t, 0]
        ay = a[t, 1]
        d = det[t]
        l1 = ((cx - ax) * (c[t, 1] - ay) - (c[t, 0] - ax) * (cy - ay)) / d
        l2 = ((b[t, 0] - ax) * (cy - ay) - (cx - ax) * (b[t, 1] - ay)) / d
        l0 = 1.0 - l1 - l2
        inside = (l0 >= -eps) & (l1 >= -eps) & (l2 >= -eps)
        t = t[inside]
        px = px[inside]
        py = py[inside]
        zz = l0[inside] * z[tris[t, 0]] + l1[inside] * z[tris[t, 1]] + l2[inside] * z[tris[t, 2]]
        pix = py * W + px
        # nearest per pixel within the chunk
        order = np.lexsort((t, zz, pix))
        pix = pix[order]
        zz = zz[order]
        t = t[order]
        firstmask = np.ones(len(pix), dtype=bool)
        firstmask[1:] = pix[1:] != pix[:-1]
        pix = pix[firstmask]
        zz = zz[firstmask]
        t = t[firstmask]
        better = zz < zbuf[pix] - 1e-12
        # exact ties keep the earlier (lower id) triangle: already resolved by lexsort within chunk; across chunks keep first
        pix = pix[better]
        zbuf[pix] = zz[better]
        idbuf[pix] = t[better]
        start = end

    tri = idbuf.reshape(H, W)
    covered = tri >= 0
    bary = np.zeros((H, W, 3), dtype=np.float32)
    if covered.any():
        ys, xs = np.nonzero(covered)
        t = tri[ys, xs]
        cx = xs + 0.5
        cy = ys + 0.5
        d = det[t]
        l1 = ((cx - a[t, 0]) * (c[t, 1] - a[t, 1]) - (c[t, 0] - a[t, 0]) * (cy - a[t, 1])) / d
        l2 = ((b[t, 0] - a[t, 0]) * (cy - a[t, 1]) - (cx - a[t, 0]) * (b[t, 1] - a[t, 1])) / d
        l0 = 1.0 - l1 - l2
        bary[ys, xs, 0] = l0
        bary[ys, xs, 1] = l1
        bary[ys, xs, 2] = l2
    depth = zbuf.reshape(H, W).astype(np.float32)
    out_tri = tri.astype(np.int32)
    if tri_ids is not None:
        m = out_tri >= 0
        out_tri[m] = tri_ids[out_tri[m]]
    return out_tri, bary, depth


def gather(attr: np.ndarray, idx: np.ndarray, tri: np.ndarray, bary: np.ndarray) -> np.ndarray:
    """interpolate per-vertex `attr` [V,C] over triangles `idx` [T,3] at pixels (tri [...], bary [...,3]); empty pixels -> 0."""
    m = tri >= 0
    out = np.zeros(tri.shape + (attr.shape[1],), dtype=np.float32)
    if m.any():
        t = tri[m]
        v = idx[t]  # [N,3]
        bb = bary[m]
        out[m] = (attr[v[:, 0]] * bb[:, :1] + attr[v[:, 1]] * bb[:, 1:2] + attr[v[:, 2]] * bb[:, 2:3]).astype(np.float32)
    return out

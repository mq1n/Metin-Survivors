"""Per-view alignment of a painted sheet to our render: foreground masks, IoU, affine ECC fit."""
from __future__ import annotations

import cv2
import numpy as np

from common import ViewLayout


def painted_foreground(img: np.ndarray, bg: tuple[int, int, int], thr: float = 70.0) -> np.ndarray:
    """img float 0..1 [H,W,3]; foreground = pixels clearly different from the flat background colour."""
    d = np.linalg.norm(img * 255.0 - np.array(bg, dtype=np.float32), axis=-1)
    m = (d > thr).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    # drop specks: keep components above a small area
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    keep = np.zeros(n, dtype=bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= 150
    return keep[lab]


def iou(a: np.ndarray, b: np.ndarray) -> float:
    u = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum() / u) if u else 0.0


def crop_rect(layout: ViewLayout, name: str, margin: int) -> tuple[int, int, int, int]:
    W, H = layout.canvas
    r = layout.views[name]['rect']
    x0 = max(int(r[0]) - margin, 0)
    y0 = max(int(r[1]) - margin, 0)
    x1 = min(int(r[0] + r[2]) + margin + 1, W)
    y1 = min(int(r[1] + r[3]) + margin + 1, H)
    return x0, y0, x1, y1


def fit_view(ours: np.ndarray, painted: np.ndarray, rect: tuple[int, int, int, int], allow: bool = True) -> dict:
    """ours/painted: bool masks (canvas). Returns {iou0, iou1, A (2x3 mapping our px -> painted px), used}."""
    x0, y0, x1, y1 = rect
    mo = ours[y0:y1, x0:x1]
    mp = painted[y0:y1, x0:x1]
    iou0 = iou(mo, mp)
    A = np.array([[1, 0, 0], [0, 1, 0]], dtype=np.float32)
    res = dict(iou0=iou0, iou1=iou0, A=A, used=False)
    if not allow or mo.sum() < 100 or mp.sum() < 100:
        return res
    to = cv2.GaussianBlur(mo.astype(np.float32), (0, 0), 3.0)
    ti = cv2.GaussianBlur(mp.astype(np.float32), (0, 0), 3.0)
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        _, warp = cv2.findTransformECC(to, ti, warp, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), None, 5)
    except cv2.error:
        return res
    # warp is in crop coords (x_crop -> x_crop'); convert to canvas coords: p' = W (p - o) + o
    Wm = warp.astype(np.float64)
    o = np.array([x0, y0], dtype=np.float64)
    Acv = np.zeros((2, 3), dtype=np.float64)
    Acv[:, :2] = Wm[:, :2]
    Acv[:, 2] = Wm[:, 2] + o - Wm[:, :2] @ o
    # sanity: near-identity
    sc = np.linalg.svd(Acv[:, :2], compute_uv=False)
    if sc.min() < 0.88 or sc.max() > 1.12 or np.abs(Wm[:, 2]).max() > 45:
        return res
    # evaluate: warp the painted mask back to our frame (painted(A p) as a function of p)
    warped = cv2.warpAffine(mp.astype(np.uint8), warp, (mp.shape[1], mp.shape[0]), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP) > 0
    iou1 = iou(mo, warped)
    if iou1 > iou0 + 0.004:
        res.update(iou1=iou1, A=Acv.astype(np.float32), used=True)
    return res

"""Shared helpers: mesh dump loading, orthographic cameras, view layout (shelf packing), image utils."""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

from raster import gather, rasterize


@dataclass
class Prim:
    index: int
    name: str
    pos: np.ndarray  # [V,3] f32
    nrm: np.ndarray  # [V,3]
    uv: np.ndarray | None  # [V,2]
    col: np.ndarray | None  # [V,3] shade
    idx: np.ndarray  # [T,3] int64
    texture: Image.Image | None


@dataclass
class Mesh:
    prims: list[Prim]
    bounds_min: np.ndarray
    bounds_max: np.ndarray
    extras: dict = field(default_factory=dict)

    @property
    def height(self) -> float:
        return float(self.bounds_max[1] - self.bounds_min[1])


def load_mesh(d: str) -> Mesh:
    meta = json.load(open(os.path.join(d, 'meta.json')))
    prims = []
    for pm in meta['prims']:
        i = pm['index']
        f = lambda n, dt, c: np.fromfile(os.path.join(d, n), dtype=dt).reshape(-1, c)
        pos = f(f'p{i}_pos.f32', np.float32, 3)
        nrm = f(f'p{i}_nrm.f32', np.float32, 3)
        uv = f(f'p{i}_uv.f32', np.float32, 2) if pm['hasUv'] else None
        col = f(f'p{i}_col.f32', np.float32, 3) if pm['hasColor'] else None
        idx = f(f'p{i}_idx.u32', np.uint32, 3).astype(np.int64)
        tex = Image.open(os.path.join(d, pm['texture'])).convert('RGB') if pm['texture'] else None
        prims.append(Prim(i, pm['name'], pos, nrm, uv, col, idx, tex))
    return Mesh(prims, np.array(meta['bounds']['min'], dtype=np.float64), np.array(meta['bounds']['max'], dtype=np.float64), meta.get('extras', {}))


def _norm(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def view_defs(mesh_height: float) -> dict[str, dict]:
    """name -> {dir: unit vector from model toward the camera, up: world up hint}. Character faces +Z, +X = character's left."""
    az = math.radians(35.0)   # 3/4 views: 35 deg off the front axis, towards the character's left (+X)
    pitch = math.radians(50.0)  # game camera looks down ~55 deg
    def three_q(sign_x: float, sign_z: float):
        return _norm((sign_x * math.sin(az) * math.cos(pitch), math.sin(pitch), sign_z * math.cos(az) * math.cos(pitch)))
    return {
        'left': dict(dir=_norm((1, 0, 0)), up=(0, 1, 0)),
        'right': dict(dir=_norm((-1, 0, 0)), up=(0, 1, 0)),
        'front': dict(dir=_norm((0, 0, 1)), up=(0, 1, 0)),
        'back': dict(dir=_norm((0, 0, -1)), up=(0, 1, 0)),
        'top': dict(dir=_norm((0, 1, 0)), up=(0, 0, 1)),
        'bottom': dict(dir=_norm((0, -1, 0)), up=(0, 0, 1)),
        '3q': dict(dir=three_q(1, 1), up=(0, 1, 0)),      # front-left, from above: the game-camera view
        '3q_back': dict(dir=three_q(-1, -1), up=(0, 1, 0)),  # rear-right, from above
        '3q_r': dict(dir=three_q(-1, 1), up=(0, 1, 0)),
        '3q_back_l': dict(dir=three_q(1, -1), up=(0, 1, 0)),
    }


@dataclass
class Camera:
    name: str
    d: np.ndarray       # unit vector model -> camera
    right: np.ndarray
    up: np.ndarray

    @staticmethod
    def make(name: str, d, up_hint) -> 'Camera':
        d = _norm(d)
        fwd = -d
        right = np.cross(fwd, np.asarray(up_hint, dtype=np.float64))
        right = _norm(right)
        up = np.cross(right, fwd)
        return Camera(name, d, right, _norm(up))

    def project(self, p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """world [N,3] -> (screen xy in metres [N,2] with +y up, depth z [N] smaller = nearer)"""
        p = p.astype(np.float64)
        return np.stack([p @ self.right, p @ self.up], axis=1), -(p @ self.d)


@dataclass
class ViewLayout:
    """Where each view lives on the sheet canvas. xy_px = ((sx - ox) * scale, (oy - sy) * scale) + rect origin."""
    canvas: tuple[int, int]
    scale: float                      # px per metre (common to all views)
    bg: tuple[int, int, int]
    views: dict[str, dict]            # name -> {rect:[x,y,w,h], ox, oy (screen-metre origin), d, right, up}

    def to_json(self) -> dict:
        return dict(canvas=list(self.canvas), scale=self.scale, bg=list(self.bg), views={k: {**v, 'd': list(map(float, v['d'])), 'right': list(map(float, v['right'])), 'up': list(map(float, v['up']))} for k, v in self.views.items()})

    @staticmethod
    def from_json(j: dict) -> 'ViewLayout':
        views = {k: {**v, 'd': np.array(v['d']), 'right': np.array(v['right']), 'up': np.array(v['up'])} for k, v in j['views'].items()}
        return ViewLayout(tuple(j['canvas']), j['scale'], tuple(j['bg']), views)

    def camera(self, name: str) -> Camera:
        v = self.views[name]
        return Camera(name, v['d'], v['right'], v['up'])

    def project_px(self, name: str, p: np.ndarray, ss: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
        """world [N,3] -> (sheet pixel xy [N,2] (float, canvas coords * ss), depth z)"""
        v = self.views[name]
        cam = self.camera(name)
        sxy, z = cam.project(p)
        x = (sxy[:, 0] - v['ox']) * self.scale + v['rect'][0]
        y = (v['oy'] - sxy[:, 1]) * self.scale + v['rect'][1]
        return np.stack([x, y], axis=1) * ss, z


def view_extents(mesh: Mesh, cam: Camera) -> tuple[float, float, float, float]:
    allp = np.concatenate([p.pos for p in mesh.prims], axis=0)
    sxy, _ = cam.project(allp)
    return float(sxy[:, 0].min()), float(sxy[:, 0].max()), float(sxy[:, 1].min()), float(sxy[:, 1].max())


def solve_rows(ext_m: dict[str, tuple[float, float]], W: int, H: int, pad: float, gap: float, max_rows: int = 3):
    """Pick a row assignment maximising the common scale s (px/m). Rect = extent*s + 2*pad. Returns (s, rows) with rows = list[list[name]]."""
    names = list(ext_m)
    n = len(names)
    best = (-1.0, None)
    for nrows in range(1, min(max_rows, n) + 1):
        for code in range(nrows ** n):
            rows: list[list[str]] = [[] for _ in range(nrows)]
            c = code
            for nm in names:
                rows[c % nrows].append(nm)
                c //= nrows
            if any(len(r) == 0 for r in rows):
                continue
            s_w = min((W - 2 * pad * len(r) - gap * (len(r) - 1)) / sum(ext_m[k][0] for k in r) for r in rows)
            s_h = (H - 2 * pad * nrows - gap * (nrows - 1)) / sum(max(ext_m[k][1] for k in r) for r in rows)
            s = min(s_w, s_h)
            if s > best[0]:
                best = (s, rows)
    assert best[1] is not None
    return best[0], best[1]


# 'top'/'bottom' may be laid out with the long axis horizontal (nose right) when that packs larger
_ROT_UP = {'top': (1, 0, 0), 'bottom': (-1, 0, 0)}


def make_layout(mesh: Mesh, view_names: list[str], canvas: tuple[int, int], bg: tuple[int, int, int], pad: int = 14, gap: int = 18) -> ViewLayout:
    defs = view_defs(mesh.height)
    W, H = canvas
    best = None
    variants = [()]
    flips = [n for n in view_names if n in _ROT_UP]
    if flips:
        variants = [tuple(v) for v in __import__('itertools').product([False, True], repeat=len(flips))]
    for variant in variants:
        rot = {n for n, f in zip(flips, variant) if f}
        cams = {n: Camera.make(n, defs[n]['dir'], _ROT_UP[n] if n in rot else defs[n]['up']) for n in view_names}
        ext = {n: view_extents(mesh, cams[n]) for n in view_names}
        ext_m = {n: (e[1] - e[0], e[3] - e[2]) for n, e in ext.items()}
        s, rows = solve_rows(ext_m, W, H, pad, gap)
        if best is None or s > best[0]:
            best = (s, rows, cams, ext, ext_m)
    scale, rows, cams, ext, ext_m = best
    scale *= 0.995
    row_h = [max(ext_m[k][1] for k in r) * scale + 2 * pad for r in rows]
    total_h = sum(row_h)
    vgap = (H - total_h) / (len(rows) + 1)
    views = {}
    y = vgap
    for r, rh in zip(rows, row_h):
        widths = [ext_m[k][0] * scale + 2 * pad for k in r]
        hgap = (W - sum(widths)) / (len(r) + 1)
        x = hgap
        for k, w in zip(r, widths):
            h = ext_m[k][1] * scale + 2 * pad
            rect = [x, y + (rh - h) / 2, w, h]
            views[k] = dict(rect=rect, ox=ext[k][0] - pad / scale, oy=ext[k][3] + pad / scale, d=cams[k].d, right=cams[k].right, up=cams[k].up)
            x += w + hgap
        y += rh + vgap
    order = [k for k in view_names if k in views]
    return ViewLayout(canvas, scale, bg, {k: views[k] for k in order})


@dataclass
class ViewPass:
    """Rasterised geometry of one view at supersample `ss` on the full canvas."""
    name: str
    ss: int
    tri: np.ndarray      # [H,W] int32 id into the concatenated triangle list (-1 empty)
    prim: np.ndarray     # [H,W] int8 prim index (-1 empty)
    bary: np.ndarray     # [H,W,3]
    depth: np.ndarray    # [H,W] float32 (inf empty)
    pos: np.ndarray      # [H,W,3] world position
    nrm: np.ndarray      # [H,W,3] world normal (unit)
    uv: np.ndarray       # [H,W,2]

    @property
    def mask(self) -> np.ndarray:
        return self.tri >= 0


def render_pass(mesh: Mesh, layout: ViewLayout, name: str, ss: int = 2) -> ViewPass:
    W, H = layout.canvas[0] * ss, layout.canvas[1] * ss
    # concatenate prims into one triangle soup (z-buffer across prims)
    xys, zs, tris, owner, offs = [], [], [], [], 0
    for p in mesh.prims:
        xy, z = layout.project_px(name, p.pos, ss)
        xys.append(xy); zs.append(z)
        tris.append(p.idx + offs)
        owner.append(np.full(len(p.idx), p.index, dtype=np.int8))
        offs += len(p.pos)
    xy = np.concatenate(xys); z = np.concatenate(zs); tri_all = np.concatenate(tris); own = np.concatenate(owner)
    tri, bary, depth = rasterize(xy, z, tri_all, W, H)
    pos_all = np.concatenate([p.pos for p in mesh.prims])
    nrm_all = np.concatenate([p.nrm for p in mesh.prims])
    uv_all = np.concatenate([p.uv if p.uv is not None else np.zeros((len(p.pos), 2), np.float32) for p in mesh.prims])
    pos = gather(pos_all, tri_all, tri, bary)
    nrm = gather(nrm_all, tri_all, tri, bary)
    n = np.linalg.norm(nrm, axis=-1, keepdims=True)
    nrm = np.where(n > 1e-9, nrm / np.maximum(n, 1e-9), 0).astype(np.float32)
    uv = gather(uv_all, tri_all, tri, bary)
    prim = np.where(tri >= 0, own[np.clip(tri, 0, None)], -1).astype(np.int8)
    return ViewPass(name, ss, tri, prim, bary, depth, pos, nrm, uv)


def downsample(img: np.ndarray, ss: int) -> np.ndarray:
    if ss == 1:
        return img
    h, w = img.shape[:2]
    return img.reshape(h // ss, ss, w // ss, ss, *img.shape[2:]).mean(axis=(1, 3))


def save_png(arr: np.ndarray, path: str) -> None:
    a = np.clip(arr, 0, 1) if arr.dtype.kind == 'f' else arr
    if a.dtype.kind == 'f':
        a = (a * 255 + 0.5).astype(np.uint8)
    Image.fromarray(a).save(path)


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

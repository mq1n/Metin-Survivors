"""Composition helpers shared by the music tracks (arpeggiators, runs, fills, humanised rolls)."""
from __future__ import annotations

import numpy as np

from .music import Song


def arp(chord, order, start_beat: float, step: float = 0.5, dur: float | None = None, vel=0.7, accent=(1.0, 0.8, 0.9, 0.8)):
    """Arpeggio over `chord` (list of midi). order: list of indices into chord (cycled per step). vel scalar or list."""
    out = []
    for i, idx in enumerate(order):
        v = (vel[i % len(vel)] if isinstance(vel, (list, tuple)) else vel) * accent[i % len(accent)]
        out.append(dict(beat=start_beat + i * step, midi=chord[idx % len(chord)] + 12 * (idx // len(chord)), dur=dur or step * 3, vel=min(v, 1.0), mods=set()))
    return out


def run(scale, i0: int, i1: int, start_beat: float, step: float = 0.125, vel=(0.5, 0.85), dur: float | None = None, shape: float = 1.0):
    """Scale run between indices of `scale` (a list of midi); vel ramps between the two values."""
    idxs = list(range(i0, i1 + (1 if i1 >= i0 else -1), 1 if i1 >= i0 else -1))
    n = len(idxs)
    out = []
    for k, ix in enumerate(idxs):
        u = k / max(n - 1, 1)
        v = vel[0] + (vel[1] - vel[0]) * (u ** shape)
        out.append(dict(beat=start_beat + k * step, midi=scale[ix], dur=dur or max(step * 6, 0.5), vel=v, mods=set()))
    return out


def roll(song: Song, track: str, fn, start_beat: float, length: float, step: float = 0.25, v0: float = 0.4, v1: float = 0.95, **kw):
    """Crescendo drum roll."""
    n = int(round(length / step))
    for i in range(n):
        u = i / max(n - 1, 1)
        song.hit(track, fn, start_beat + i * step, v0 + (v1 - v0) * u, **kw)


def euclid(k: int, n: int, rot: int = 0) -> str:
    """Euclidean rhythm as 'x'/'.' string."""
    pat = [0] * n
    for i in range(k):
        pat[(i * n) // k] = 1
    pat = pat[-rot:] + pat[:-rot] if rot else pat
    return "".join("x" if p else "." for p in pat)


def chord_at(prog, bar: int):
    """prog = list per bar (cycled)."""
    return prog[bar % len(prog)]

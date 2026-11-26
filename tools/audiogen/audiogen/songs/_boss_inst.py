"""Local instruments shared by the boss / victory / defeat stingers (built only from dsp + instruments primitives)."""
from __future__ import annotations

import numpy as np

from .. import dsp
from .. import instruments as I
from ..dsp import midi2hz


def stab(vel=0.8, rng=None, notes=(), dur=0.18, release=0.09, bright=1.0, attack=0.012):
    """Tutti brass stab (use via S.hit): a stack of brass voices, short and hard."""
    rng = rng or np.random.default_rng(31)
    parts = [I.brass_note(float(midi2hz(m)), dur, vel=vel, attack=attack, release=release, rng=rng, vib_depth=0.0, bright=bright)
             for m in notes]
    out = np.zeros(max(len(p) for p in parts))
    for p in parts:
        out[: len(p)] += p
    return dsp.fade(out / np.sqrt(len(parts)) * 1.15, 0.0, 0.01)


def riser(freq, dur, vel=0.8, rng=None, f_from=300.0, f_to=9000.0, tonal=0.45):
    """Noise sweep (band-pass climbing f_from -> f_to, quadratic swell) plus a rising saw/sine siren starting at `freq`."""
    rng = rng or np.random.default_rng(32)
    n = dsp.nsamp(dur)
    u = np.linspace(0.0, 1.0, n)
    nz = rng.standard_normal(n)
    fc = f_from * (f_to / f_from) ** (u ** 1.4)
    y = dsp.sweep_filter(nz, "bp", fc, 1.1, hop=64) * (u ** 2.2) * 1.6
    f = freq * 6.0 ** (u ** 1.6)
    ph = dsp.phase_of(f)
    sir = 0.6 * dsp.wt_read("saw", ph, f) + 0.4 * np.sin(2 * np.pi * ph)
    sir = dsp.lp(sir, 5000.0) * (u ** 2.6)
    y = y + tonal * sir
    return dsp.fade(y, 0.02, 0.01) * (0.4 + 0.6 * vel) * 0.6


def rev_cym(vel=0.8, rng=None, dur=2.0):
    """Reverse cymbal swell that ends exactly on the next downbeat (use via S.hit)."""
    y = dsp.reverse(I.cymbal(dur=dur, vel=vel, rng=rng, size=1.4))
    u = np.linspace(0, 1, y.shape[-1])
    return y * (0.25 + 0.75 * u ** 1.5)

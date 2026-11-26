"""Extra sounds requested by Content (content/sfx_requests.json): bell toll, bow draw, smoke bomb, talisman flutter, claw rend."""
from __future__ import annotations

import numpy as np

from . import dsp
from . import instruments as I
from .dsp import SR, TAU, nsamp, tvec, rng_for
from .sfx_lib import Canvas, click, env_exp, finalize, mono_room, noise_hit, punch, ring, sfx, thump, whoosh, pentatonic_hz


@sfx("sfx_bell_toll", 2, level_db=-3, group="holy")
def bell_toll(v):
    r = rng_for("btl", v)
    f = [196.0, 174.6][v]
    c = Canvas(4.5)
    c.add(I.bell(f, 4.0, 1.0, "temple", r, 1.1), 0, 0.8)
    c.add(I.bell(f * 2.0, 2.5, 0.8, "hand", r), 0.01, 0.22)
    c.add(I.bell(f * 3.01, 1.8, 0.7, "chime", r), 0.02, 0.1)
    c.add(click(r, 0.006, 1200, None, 0.002), 0, 0.6)
    c.add(noise_hit(r, 0.2, 800, 5000, 0.04, "pink"), 0, 0.35)  # clapper strike
    c.add(thump(f * 0.5, f * 0.35, 0.8, 0.1, 0.3, drive=1.3), 0, 0.4)
    return finalize(mono_room(c.out(), "hall", 0.3, tail=1.5))


@sfx("sfx_bow_draw", 2, level_db=-5, group="ranged")
def bow_draw(v):
    r = rng_for("bdr", v)
    c = Canvas(1.0)
    n = nsamp(0.3)
    t = tvec(n)
    # wood + sinew creak while drawing: rising, wobbling band of noise and a thin squeal
    fc = 300 * 2.4 ** (t / 0.3)
    creak = dsp.sweep_filter(r.standard_normal(n), "bp", fc * (1 + 0.08 * dsp.smooth_noise(n, r, 18.0)), 4.0, hop=16) * dsp.env([(0, 0), (0.05, 0.5), (0.3, 1.0, 1.4)], n)
    c.add(creak * (0.6 + 0.4 * np.abs(np.sin(TAU * 21 * t))), 0, 0.5)
    c.add(dsp.lp(np.sin(TAU * np.cumsum(520 * 1.6 ** (t / 0.3)) / SR), 2500) * dsp.env([(0, 0), (0.1, 0.4), (0.3, 0.7), (0.31, 0)], n), 0, 0.06)
    # release
    tr = 0.3 + 0.02 * v
    c.add(click(r, 0.003, 1500, 6000, 0.0015), tr, 0.6)
    c.add(thump(190 + 20 * v, 95, 0.14, 0.02, 0.04, drive=1.3), tr, 0.6)
    c.add(ring([150 + 12 * v, 305, 470, 640], [0.14, 0.08, 0.05, 0.03], 0.3, r, [1, 0.7, 0.4, 0.25], glide=(1.1, 0.03)), tr, 0.7)
    c.add(whoosh(r, 0.2, 3200, 9000, q=2.6, peak=0.25, air=0.1), tr + 0.012, 0.3)
    return finalize(punch(c.out()))


@sfx("sfx_smoke_bomb", 2, level_db=-3, group="movement")
def smoke_bomb(v):
    r = rng_for("smk", v)
    c = Canvas(1.8)
    n = nsamp(1.4)
    t = tvec(n)
    c.add(click(r, 0.008, 1800, None, 0.003), 0, 0.7)  # clay shell cracks
    c.add(noise_hit(r, 0.15, 1500, 7000, 0.03), 0, 0.5)
    c.add(thump(130, 50, 0.4, 0.05, 0.15, drive=1.5), 0.005, 0.8)  # poof
    fc = 4500 * (0.1) ** np.clip(t / 0.5, 0, 1) + 300
    puff = dsp.sweep_filter(r.standard_normal(n), "lp", fc, 0.8, hop=24) * dsp.env([(0, 0), (0.01, 1), (0.25, 0.6), (1.4, 1e-4, "exp")], n)
    c.add(puff, 0.005, 0.8)
    hiss = dsp.butter_hp(r.standard_normal(n), 3500, 2) * dsp.env([(0, 0), (0.08, 1), (0.9, 0.2), (1.4, 1e-4, "exp")], n)
    c.add(hiss, 0.01, 0.22 + 0.04 * v)
    c.add(I.moktak(0.5, 0.5, r), 0.0, 0.2)
    return finalize(mono_room(punch(c.out()), "small", 0.18, tail=0.5))


@sfx("sfx_talisman_flutter", 2, level_db=-6, group="projectile")
def talisman_flutter(v):
    r = rng_for("tfl", v)
    c = Canvas(0.9)
    for k in range(3):  # three paper slips fluttering past
        t0 = 0.05 * k
        n = nsamp(0.4)
        flap = dsp.butter_bp(r.standard_normal(n), 1500 + 300 * k, 7500, 2) * (0.5 + 0.5 * np.sin(TAU * (38 + 12 * k + 6 * v) * tvec(n) + k)) ** 2
        c.add(flap * dsp.env([(0, 0), (0.06, 1), (0.4, 0.0, 1.2)], n), t0, 0.45)
    c.add(whoosh(r, 0.35, 1400, 6500, q=2.0, peak=0.4, air=0.3), 0, 0.35)
    for k, hz in enumerate(pentatonic_hz(84, [0, 2, 4][: 2 + v])):
        c.add(I.bell(hz, 0.5, 0.6, "chime", r), 0.12 + 0.05 * k, 0.22)
    c.add(ring([3951, 5274], [0.2, 0.15], 0.3, r, split=3), 0.1, 0.1)
    return finalize(mono_room(c.out(), "small", 0.14, tail=0.3))


@sfx("sfx_claw_rend", 2, level_db=-3, group="beast")
def claw_rend(v):
    r = rng_for("crd", v)
    c = Canvas(0.9)
    for k in range(3):
        c.add(whoosh(r, 0.12, 1700 + 250 * k, 6800, q=1.8, peak=0.35, air=0.3), 0.04 * k, 0.65 - 0.1 * k)
    # wet tearing: gritty band-pass noise, amplitude-chopped at ~90 Hz and swept downward
    n = nsamp(0.35)
    t = tvec(n)
    fc = 2600 * (0.35) ** (t / 0.35)
    tear = dsp.sweep_filter(r.standard_normal(n), "bp", fc, 2.2, hop=16) * (0.5 + 0.5 * np.sign(np.sin(TAU * (85 + 15 * v) * t + 6 * dsp.smooth_noise(n, r, 25.0)))) * dsp.env([(0, 0), (0.02, 1), (0.35, 1e-4, "exp")], n)
    c.add(dsp.lp(tear, 6000), 0.05, 0.85)
    c.add(thump(190, 85, 0.12, 0.025, 0.045, drive=1.5), 0.06, 0.5)
    c.add(noise_hit(r, 0.3, 200, 1800, 0.08, "pink"), 0.06, 0.6)
    c.add(click(r, 0.004, 2000, None, 0.0015), 0.05, 0.5)
    return finalize(punch(c.out()))

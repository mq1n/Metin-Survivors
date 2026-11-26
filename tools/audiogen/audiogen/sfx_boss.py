"""Boss attack-pattern SFX and a few extra feedback sounds the simulation requests by name."""
from __future__ import annotations

import numpy as np

from . import dsp
from . import instruments as I
from .dsp import SR, TAU, nsamp, tvec, rng_for
from .sfx_lib import (Canvas, click, env_exp, finalize, mono_room, noise_hit, punch, ring, sfx, thump, voice, whoosh, pentatonic_hz)


@sfx("sfx_boss_slam", 1, level_db=0, group="boss")
def boss_slam(v):
    r = rng_for("bsl", v)
    c = Canvas(2.6)
    c.add(voice(r, 0.3, 80, 52, "a", "o", breath=0.3, rasp=1.0, attack=0.02, peak_t=0.08, tilt=2300, formant_shift=0.85), 0.0, 0.5)
    c.add(thump(75, 24, 1.8, 0.14, 0.55, drive=2.0), 0.28, 1.0)
    c.add(click(r, 0.01, 600, None, 0.004), 0.28, 0.9)
    c.add(noise_hit(r, 1.6, None, 300, 0.45, "brown"), 0.28, 0.9)
    c.add(noise_hit(r, 0.3, 300, 3500, 0.07, "pink"), 0.28, 0.5)
    c.add(dsp.hp(dsp.crackle(nsamp(1.0), r, 110, 4.0), 450) * np.exp(-tvec(nsamp(1.0)) / 0.35), 0.32, 0.5)
    for k in range(5):
        f = r.uniform(110, 340)
        c.add(ring([f, f * 2.2], [0.08, 0.04], 0.15, r), 0.34 + r.uniform(0, 0.8), r.uniform(0.1, 0.3))
    return finalize(mono_room(punch(dsp.saturate(c.out(), 1.25)), "small", 0.22, tail=0.7))


@sfx("sfx_boss_land", 1, level_db=-1, group="boss")
def boss_land(v):
    r = rng_for("bld", v)
    c = Canvas(1.6)
    c.add(thump(68, 25, 1.2, 0.12, 0.38, drive=2.0), 0, 0.6)
    c.add(click(r, 0.008, 600, None, 0.003), 0, 0.9)
    c.add(noise_hit(r, 1.0, None, 320, 0.3, "brown"), 0, 0.7)
    c.add(noise_hit(r, 0.35, 250, 3500, 0.08, "pink"), 0, 1.0)
    c.add(dsp.hp(dsp.crackle(nsamp(0.8), r, 90, 4.0), 450) * np.exp(-tvec(nsamp(0.8)) / 0.3), 0.03, 0.9)
    for k in range(4):
        f = r.uniform(140, 420)
        c.add(ring([f, f * 2.2, f * 3.9], [0.09, 0.05, 0.03], 0.18, r), r.uniform(0.04, 0.4), r.uniform(0.2, 0.45))
    return finalize(mono_room(punch(dsp.saturate(c.out(), 1.2)), "small", 0.2, tail=0.5))


@sfx("sfx_boss_charge", 1, level_db=-1, group="boss")
def boss_charge(v):
    r = rng_for("bch", v)
    c = Canvas(1.6)
    c.add(voice(r, 0.7, 62, 92, "a", "o", breath=0.3, rasp=1.0, attack=0.1, am_hz=26, am_depth=0.5, peak_t=0.35, tilt=2400, formant_shift=0.85), 0, 0.8)
    c.add(whoosh(r, 1.0, 140, 1100, q=1.1, peak=0.7, air=0.5, rise=1.8), 0.1, 0.9)
    for k, t0 in enumerate([0.25, 0.45, 0.62, 0.76, 0.88]):
        c.add(thump(85 - 4 * k, 36, 0.3, 0.05, 0.1, drive=1.6), t0, 0.6 + 0.08 * k)
        c.add(noise_hit(r, 0.12, 120, 900, 0.03, "pink"), t0, 0.3)
    return finalize(mono_room(punch(c.out()), "small", 0.14, tail=0.3))


@sfx("sfx_boss_volley", 1, level_db=-3, group="boss")
def boss_volley(v):
    r = rng_for("bvo", v)
    c = Canvas(1.0)
    for k in range(4):
        t0 = 0.1 * k
        c.add(whoosh(r, 0.22, 900 + 200 * k, 5200, q=1.8, peak=0.4, air=0.3), t0, 0.7)
        n = nsamp(0.22)
        t = tvec(n)
        f = (420 + 80 * k) * (2.0 ** (t / 0.22))
        c.add(dsp.fm(f, 1.5, 1.2 * np.exp(-t / 0.1), n) * np.exp(-t / 0.12), t0, 0.28)
        c.add(thump(160, 80, 0.12, 0.02, 0.05), t0, 0.35)
    return finalize(mono_room(c.out(), "small", 0.12, tail=0.3))


@sfx("sfx_boss_summon", 1, level_db=-2, group="boss")
def boss_summon(v):
    r = rng_for("bsm", v)
    c = Canvas(2.4)
    n = nsamp(1.4)
    t = tvec(n)
    drone = dsp.supersaw(55 * (1 + 0.5 * t / 1.4), n, voices=4, spread_cents=20, rng=r)
    drone = dsp.sweep_filter(drone, "lp", 120 + 900 * (t / 1.4) ** 1.5, 1.2, hop=48) * dsp.env([(0, 0), (0.9, 1, 1.6), (1.4, 0, 1.0)], n)
    c.add(drone, 0, 0.6)
    c.add(I.vowel_morph(r.standard_normal(n), "u", "o", 1.2) * dsp.env([(0, 0), (1.0, 1, 2.0), (1.4, 0, 1)], n), 0, 0.3)
    c.add(thump(110, 34, 0.8, 0.1, 0.3, drive=1.7), 1.0, 0.9)
    c.add(I.gong(120, 2.0, 0.9, r, wash=0.5), 1.0, 0.45)
    c.add(ring([220, 311, 466, 622], [0.7, 0.6, 0.5, 0.4], 0.8, r, split=2.0), 1.0, 0.12)
    return finalize(mono_room(punch(c.out()), "cave", 0.3, tail=0.8))


@sfx("sfx_boss_ring", 1, level_db=-2, group="boss")
def boss_ring(v):
    r = rng_for("brn", v)
    d = 0.9
    n = nsamp(d)
    t = tvec(n)
    c = Canvas(1.4)
    c.add(thump(75, 28, 0.9, 0.1, 0.3, drive=1.7), 0, 1.0)
    fc = 3600 * (0.08) ** np.clip(t / 0.6, 0, 1) + 120
    c.add(dsp.sweep_filter(r.standard_normal(n), "bp", fc, 1.3, hop=24) * dsp.env([(0, 0), (0.03, 1), (d, 0, 0.6)], n), 0, 0.8)
    c.add(ring([330, 495, 742, 1100], [0.4, 0.35, 0.3, 0.25], 0.6, r, split=1.6), 0, 0.12)
    c.add(click(r, 0.006, 800, None, 0.003), 0, 0.6)
    return finalize(mono_room(punch(dsp.saturate(c.out(), 1.2)), "small", 0.2, tail=0.5))


@sfx("sfx_boss_meteor", 1, level_db=-1, group="boss")
def boss_meteor(v):
    r = rng_for("bmt", v)
    d = 1.1
    n = nsamp(d)
    t = tvec(n)
    c = Canvas(2.8)
    f = 1900 * (0.3) ** (t / d)
    w = np.sin(TAU * np.cumsum(f) / SR) + 0.4 * np.sin(TAU * 2 * np.cumsum(f) / SR)
    c.add(w * dsp.env([(0, 0), (0.2, 0.4, 1.2), (d, 1.0, 1.6)], n), 0, 0.18)
    c.add(dsp.sweep_filter(r.standard_normal(n), "bp", f * 1.2, 1.4, hop=24) * dsp.env([(0, 0), (d, 1.0, 1.7)], n), 0, 0.3)
    c.add(dsp.butter_lp(dsp.pink(n, r), 300, 4) * dsp.env([(0, 0), (d, 1.0, 1.8)], n), 0, 0.5)
    # impact
    c.add(thump(80, 26, 1.8, 0.12, 0.55, drive=1.9), d, 1.0)
    c.add(click(r, 0.01, 600, None, 0.004), d, 0.9)
    c.add(noise_hit(r, 1.6, None, 280, 0.5, "brown"), d, 0.9)
    c.add(dsp.hp(dsp.crackle(nsamp(1.2), r, 140, 4.0), 400) * np.exp(-tvec(nsamp(1.2)) / 0.45), d, 0.5)
    return finalize(mono_room(punch(dsp.saturate(c.out(), 1.25)), "hall", 0.28, tail=1.0))


@sfx("sfx_boss_nova", 1, level_db=-1, group="boss")
def boss_nova(v):
    r = rng_for("bnv", v)
    c = Canvas(2.2)
    n = nsamp(0.5)
    t = tvec(n)
    # charge-up
    f = 180 * (4.0 ** (t / 0.5))
    c.add(dsp.fm(f, 2.0, 1.0 + 2.0 * t / 0.5, n) * dsp.env([(0, 0), (0.45, 1, 1.8), (0.5, 0.2)], n), 0, 0.3)
    c.add(dsp.reverse(noise_hit(r, 0.5, 400, 7000, 0.2, "pink")), 0, 0.4)
    # burst
    c.add(thump(100, 30, 1.2, 0.1, 0.4, drive=1.8), 0.5, 1.0)
    c.add(noise_hit(r, 0.8, None, 3000, 0.25, "white"), 0.5, 0.7)
    c.add(click(r, 0.008, 700, None, 0.003), 0.5, 0.8)
    c.add(ring([523, 784, 1175, 1760], [0.9, 0.8, 0.6, 0.5], 1.2, r, split=2.0), 0.5, 0.12)
    c.add(whoosh(r, 0.7, 3500, 400, q=1.2, peak=0.1, air=0.3, shape=0.9), 0.5, 0.35)
    return finalize(mono_room(punch(dsp.saturate(c.out(), 1.25)), "hall", 0.28, tail=0.9))


@sfx("sfx_boss_teleport", 1, level_db=-4, group="boss")
def boss_teleport(v):
    r = rng_for("btp", v)
    c = Canvas(1.2)
    c.add(dsp.reverse(whoosh(r, 0.3, 5000, 500, q=2.0, peak=0.5, air=0.3)), 0, 0.6)
    n = nsamp(0.12)
    t = tvec(n)
    c.add(dsp.fm(1200 * (0.3 ** (t / 0.12)), 2.0, 2.0 * np.exp(-t / 0.05), n) * np.exp(-t / 0.05), 0.28, 0.4)
    c.add(thump(110, 40, 0.5, 0.06, 0.18, drive=1.5), 0.3, 0.8)
    c.add(whoosh(r, 0.4, 600, 6000, q=2.0, peak=0.4, air=0.3), 0.32, 0.5)
    c.add(ring([1760, 2637, 3520], [0.3, 0.25, 0.2], 0.4, r, split=3), 0.32, 0.12)
    return finalize(mono_room(punch(c.out()), "small", 0.18, tail=0.4))


@sfx("sfx_boss_breath", 1, level_db=-1, group="boss")
def boss_breath(v):
    r = rng_for("bbr", v)
    d = 1.7
    n = nsamp(d)
    t = tvec(n)
    c = Canvas(2.4)
    roar = dsp.butter_lp(dsp.pink(n, r), 2400, 4) * (1 + 0.4 * dsp.smooth_noise(n, r, 35.0)) * dsp.env([(0, 0), (0.25, 1, 1.4), (1.3, 0.8), (d, 0, "exp")], n)
    c.add(roar, 0, 0.9)
    fc = 300 * (4000 / 300) ** np.clip(t / 0.6, 0, 1)
    c.add(dsp.sweep_filter(r.standard_normal(n), "bp", fc, 1.0, hop=24) * dsp.env([(0, 0), (0.2, 1, 1.4), (1.2, 0.5), (d, 0, "exp")], n), 0, 0.6)
    c.add(voice(r, 1.4, 70, 50, "a", "o", breath=0.3, rasp=1.0, attack=0.1, am_hz=24, am_depth=0.5, peak_t=0.3, tilt=2300, formant_shift=0.85), 0, 0.5)
    c.add(thump(100, 44, 0.5, 0.08, 0.2, drive=1.5), 0, 0.6)
    c.add(dsp.hp(dsp.crackle(n, r, 160, 2.5), 1000) * dsp.env([(0, 0.3), (0.3, 1), (d, 0, 1.2)], n), 0.1, 0.4)
    return finalize(mono_room(punch(c.out()), "small", 0.16, tail=0.5))


@sfx("sfx_revive", 1, level_db=-2, group="reward")
def revive(v):
    r = rng_for("rev", v)
    c = Canvas(3.0)
    pad = I.pad([float(dsp.midi2hz(m)) for m in (55, 62, 67, 71, 74)], 1.8, kind="choir", vel=0.7, attack=0.5, release=1.0, rng=r)
    c.add(pad.mean(0), 0, 0.4)
    c.add(whoosh(r, 0.8, 400, 9000, q=2.0, peak=0.9, air=0.2, rise=1.6), 0, 0.35)
    for k, hz in enumerate(pentatonic_hz(67, [0, 2, 4, 5, 7, 9, 10, 12])):
        c.add(I.bell(hz, 1.4, 0.8, "glass", r, 0.9), 0.55 + 0.06 * k, 0.34)
    c.add(thump(90, 40, 0.9, 0.12, 0.3, drive=1.5), 0.55, 0.8)
    c.add(I.gong(196, 2.5, 0.8, r, wash=0.4), 0.55, 0.3)
    c.add(dsp.bp(dsp.crackle(nsamp(1.4), r, 90, 1.0), 8000, 2.0) * np.exp(-tvec(nsamp(1.4)) / 0.5), 0.55, 0.25)
    return finalize(mono_room(punch(c.out()), "air", 0.4, tail=1.2))


@sfx("sfx_awaken", 1, level_db=-1, group="reward")
def awaken(v):
    r = rng_for("awk", v)
    c = Canvas(2.8)
    n = nsamp(0.7)
    t = tvec(n)
    c.add(whoosh(r, 0.7, 300, 12000, q=1.8, peak=0.95, air=0.2, rise=1.7), 0, 0.4)
    c.add(dsp.fm(220 * (3.0 ** (t / 0.7)), 2.0, 1.0 + 2.0 * t / 0.7, n) * dsp.env([(0, 0), (0.65, 1, 1.8), (0.7, 0.2)], n), 0, 0.22)
    c.add(thump(100, 34, 1.2, 0.1, 0.4, drive=1.7), 0.7, 0.95)
    c.add(I.gong(160, 3.0, 1.0, r, wash=0.5), 0.7, 0.5)
    for k, hz in enumerate(pentatonic_hz(79, [0, 2, 4, 5, 7, 9, 11, 12])):
        c.add(I.bell(hz, 1.6, 0.85, "glass", r, 1.0), 0.7 + 0.04 * k, 0.4)
    pad = I.pad([float(dsp.midi2hz(m)) for m in (67, 74, 79, 83)], 1.6, kind="choir", vel=0.8, attack=0.3, release=1.0, rng=r)
    c.add(pad.mean(0), 0.65, 0.35)
    c.add(dsp.bp(dsp.crackle(nsamp(1.4), r, 130, 1.0), 7500, 2.0) * np.exp(-tvec(nsamp(1.4)) / 0.5), 0.7, 0.3)
    return finalize(mono_room(punch(c.out()), "air", 0.4, tail=1.2))


@sfx("sfx_hit_flesh_heavy", 2, level_db=-2, group="hit")
def hit_flesh_heavy(v):
    r = rng_for("hfh", v)
    pitch = [0.78, 0.7][v]
    n = nsamp(0.5)
    t = tvec(n)
    c = Canvas(0.55)
    c.add(click(r, 0.005, 1800), 0, 0.5)
    c.add(thump(170 * pitch, 55 * pitch, 0.4, 0.06, 0.16, drive=2.0), 0, 1.0)
    c.add(thump(65, 36, 0.5, 0.15, 0.2, drive=1.4), 0, 0.5)
    c.add(noise_hit(r, 0.35, 150, 1500, 0.1, "pink"), 0, 0.8)
    fc = 800 * pitch * (260 / 800) ** np.clip(t / 0.18, 0, 1)
    c.add(dsp.sweep_filter(r.standard_normal(n), "bp", fc, 3.0, hop=16) * np.exp(-t / 0.08), 0.005, 0.6)
    c.add(noise_hit(r, 0.12, 250, 3500, 0.03, "pink"), 0.02, 0.4)  # crunch
    out = dsp.saturate(c.out() * 1.15, 1.3)
    return finalize(punch(out))

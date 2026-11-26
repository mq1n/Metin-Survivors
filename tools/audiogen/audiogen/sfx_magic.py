"""Magic / skill SFX: fire, lightning, dark, holy, poison, wind, explosions, impacts, dash, buffs, beasts."""
from __future__ import annotations

import numpy as np

from . import dsp
from . import instruments as I
from .dsp import SR, TAU, nsamp, tvec, rng_for
from .sfx_lib import (Canvas, click, env_exp, finalize, mono_room, noise_hit, periodic_noise, punch, ring, sfx, thump, voice, whoosh, pentatonic_hz)


def _circ_crackle(n, rng, density, decay_ms):
    """Circularly-periodic crackle (for loops)."""
    imp = np.zeros(n)
    cnt = rng.poisson(density * n / SR)
    pos = rng.integers(0, n, cnt)
    np.add.at(imp, pos, rng.uniform(0.2, 1.0, cnt) ** 2.0 * rng.choice([-1, 1], cnt))
    k = np.exp(-np.arange(n) / (SR * decay_ms / 1000.0))
    k[int(SR * decay_ms * 7 / 1000) :] = 0
    return np.fft.irfft(np.fft.rfft(imp) * np.fft.rfft(k), n)


# =========================================================================== fire
@sfx("sfx_fire_cast", 2, level_db=-3, group="fire")
def fire_cast(v):
    r = rng_for("fc", v)
    d = 0.9 + 0.1 * v
    n = nsamp(d)
    t = tvec(n)
    c = Canvas(1.5)
    roar = dsp.butter_lp(dsp.pink(n, r), 2000, 4) * (1 + 0.35 * dsp.smooth_noise(n, r, 40.0))
    roar = roar * dsp.env([(0, 0), (0.18, 1, 1.4), (0.5, 0.75), (d, 0.0, "exp")], n)
    c.add(roar, 0, 0.8)
    fc = 330 * (3400 / 330) ** np.clip(t / 0.5, 0, 1)
    sw = dsp.sweep_filter(r.standard_normal(n), "bp", fc, 1.0, hop=24) * dsp.env([(0, 0), (0.12, 1, 1.4), (0.5, 0.4), (d, 0.0, "exp")], n)
    c.add(sw, 0, 0.6)
    c.add(thump(112, 46, 0.4, 0.07, 0.16, drive=1.5), 0, 0.7)
    cr = dsp.hp(dsp.crackle(n, r, 140, 2.5), 1100) * dsp.env([(0, 0.2), (0.15, 1), (d, 0, 1.2)], n)
    c.add(cr, 0.05, 0.45)
    return finalize(mono_room(punch(c.out()), "small", 0.16, tail=0.4))


@sfx("sfx_burn_tick", 3, level_db=-9, group="fire")
def burn_tick(v):
    r = rng_for("bt", v)
    n = nsamp(0.28)
    c = Canvas(0.3)
    c.add(dsp.hp(dsp.crackle(n, r, 160, 2.0), 900) * np.exp(-tvec(n) / 0.09), 0, 0.7)
    c.add(noise_hit(r, 0.2, 700, 4500, 0.06, "pink"), 0, 0.4)
    c.add(thump(140 + 30 * v, 70, 0.1, 0.02, 0.05), 0, 0.3)
    return finalize(c.out())


@sfx("sfx_fire_burn_loop", 1, level_db=-9, loop=True, group="fire", kind="ambience")
def fire_burn_loop(v):
    r = rng_for("fbl", v)
    T = 2.4
    n = nsamp(T)
    base = periodic_noise(r, T, 160, 5200, -0.3)
    mod = 0.55 + 0.45 * np.clip(periodic_noise(r, T, 2, 30) * 0.5, -1, 1)
    flame = base * mod
    flame = dsp.butter_hp(flame, 220, 2)
    pops = dsp.hp(_circ_crackle(n, r, 55, 3.0), 700) * 1.4
    rumble = periodic_noise(r, T, 40, 260) * 0.4
    y = flame * 0.55 + pops * 0.5 + rumble * 0.5
    # exact periodicity: all components are circular, so no cross-fade is required
    return y / (np.abs(y).max() + 1e-9) * 0.85


# =========================================================================== lightning
@sfx("sfx_lightning_cast", 2, level_db=-3, group="lightning")
def lightning_cast(v):
    r = rng_for("lic", v)
    d = 0.5 + 0.05 * v
    n = nsamp(d)
    t = tvec(n)
    c = Canvas(0.9)
    f = 3600 * (0.12) ** np.clip(t / 0.38, 0, 1)
    gate = 0.5 + 0.5 * np.sign(np.sin(TAU * (80 + 25 * v) * t + 0.4 * np.sin(TAU * 7 * t)))
    gate = dsp.lp(gate, 900)
    tone = dsp.osc("saw", f, n) * gate
    tone = dsp.bp(tone, 1800, 0.6) * 1.6 + dsp.osc("square", f * 0.5, n) * gate * 0.3
    tone = dsp.saturate(tone, 2.0)
    tone *= dsp.env([(0, 0), (0.01, 1), (0.3, 0.7), (d, 0, 1.2)], n)
    c.add(tone, 0, 0.6)
    cr = dsp.hp(dsp.crackle(n, r, 420, 0.9), 2200) * dsp.env([(0, 1), (d, 0.1)], n)
    c.add(cr, 0, 0.7)
    c.add(click(r, 0.004, 1500, None, 0.002), 0, 0.7)
    c.add(noise_hit(r, 0.18, 3500, None, 0.05), 0.0, 0.4)
    c.add(thump(140, 70, 0.3, 0.04, 0.12, drive=1.4), 0, 0.35)
    return finalize(mono_room(punch(c.out()), "small", 0.12, tail=0.3))


@sfx("sfx_lightning_strike", 2, level_db=-1, group="lightning")
def lightning_strike(v):
    r = rng_for("lis", v)
    c = Canvas(2.4)
    c.add(click(r, 0.012, 800, None, 0.004), 0, 1.0)
    c.add(noise_hit(r, 0.2, 1500, 9000, 0.04), 0, 0.9)
    c.add(dsp.hp(dsp.crackle(nsamp(0.4), r, 500, 1.0), 1800) * np.exp(-tvec(nsamp(0.4)) / 0.1), 0.0, 0.7)
    # electrical buzz tail
    n = nsamp(0.7)
    t = tvec(n)
    buzz = dsp.bp(dsp.osc("saw", 118 + 12 * v, n), 1500, 0.7) * (1 + np.sin(TAU * 95 * t)) * 0.5 * np.exp(-t / 0.18)
    c.add(dsp.saturate(buzz, 2.0), 0.01, 0.35)
    # thunder
    c.add(thump(80, 32, 1.4, 0.15, 0.45, drive=1.6), 0.03, 0.9)
    c.add(noise_hit(r, 1.7, None, 230, 0.55, "brown"), 0.03, 1.0)
    c.add(noise_hit(r, 0.9, 150, 900, 0.3, "pink"), 0.05, 0.4)
    out = dsp.saturate(c.out(), 1.2)
    return finalize(mono_room(punch(out), "hall", 0.28, tail=1.0))


# =========================================================================== dark / holy / poison / wind
@sfx("sfx_dark_cast", 2, level_db=-3, group="dark")
def dark_cast(v):
    r = rng_for("dkc", v)
    d = 1.0 + 0.1 * v
    n = nsamp(d)
    t = tvec(n)
    c = Canvas(1.6)
    f = 61.7 * (0.82 ** (t / d))
    drone = dsp.supersaw(f * (1 + 0.004 * np.sin(TAU * 6 * t)), n, voices=4, spread_cents=18, rng=r)
    drone = dsp.sweep_filter(drone, "lp", 900 * (0.2 ** (t / d)) + 90, 1.4, hop=48) * dsp.env([(0, 0), (0.35, 1, 1.4), (0.8, 0.8), (d, 0, 1.2)], n)
    c.add(drone, 0, 0.6)
    tri = dsp.osc("saw", f * 1.4142, n) * 0.0
    # whisper: noise through morphing vowel, rising swell
    wh = I.vowel_morph(r.standard_normal(n), "o", "u", d * 0.8) * dsp.env([(0, 0), (d * 0.6, 1, 2.0), (d, 0, 1.0)], n)
    c.add(wh, 0, 0.35)
    c.add(dsp.reverse(noise_hit(r, 0.5, 400, 4000, 0.15, "pink")), 0, 0.35)  # reversed swell into the hit
    c.add(thump(130, 34, 0.55, 0.09, 0.22, drive=1.7), d * 0.55, 0.8)
    c.add(ring([220, 311.1 + 6 * v, 466], [0.5, 0.4, 0.3], 0.6, r, [1, 0.7, 0.5], split=1.8), d * 0.45, 0.14)
    return finalize(mono_room(punch(c.out()), "cave", 0.3, tail=0.6))


@sfx("sfx_holy_chime", 2, level_db=-5, group="holy")
def holy_chime(v):
    r = rng_for("hch", v)
    c = Canvas(2.4)
    steps = [[12, 14, 16, 19], [11, 14, 16, 18]][v]
    for k, hz in enumerate(pentatonic_hz(60, steps)):
        c.add(I.bell(hz, 1.2, 0.8 - 0.05 * k, "glass", r, 0.9), 0.07 * k, 0.55)
        c.add(I.bell(hz * 2.0, 0.8, 0.5, "chime", r), 0.07 * k + 0.01, 0.12)
    pad = I.pad([float(dsp.midi2hz(m)) for m in (72, 76, 79, 83)], 0.9, kind="glass", vel=0.6, attack=0.4, release=0.8, rng=r)
    c.add(pad.mean(0), 0.0, 0.18)
    n = nsamp(0.6)
    sp = dsp.bp(dsp.crackle(n, r, 70, 1.0), 7000, 2.0) * dsp.env([(0, 1), (0.6, 0)], n)
    c.add(sp, 0.1, 0.3)
    out = c.out()
    return finalize(mono_room(out, "air", 0.35, tail=1.0))


@sfx("sfx_poison_hiss", 2, level_db=-6, group="poison")
def poison_hiss(v):
    r = rng_for("poi", v)
    d = 0.85
    n = nsamp(d)
    t = tvec(n)
    c = Canvas(1.0)
    hiss = dsp.butter_bp(r.standard_normal(n), 3200, 9000, 3) * dsp.env([(0, 0), (0.06, 1, 0.8), (0.45, 0.8), (d, 0, 1.4)], n)
    hiss *= 1 + 0.25 * dsp.smooth_noise(n, r, 25.0)
    c.add(hiss, 0, 0.5)
    # bubbles
    for k in range(7 + 2 * v):
        tt = r.uniform(0.02, 0.7)
        f0 = r.uniform(250, 500)
        m = nsamp(0.05)
        tb = tvec(m)
        b = np.sin(TAU * np.cumsum(f0 * (1 + 2.0 * tb / 0.05)) / SR) * np.exp(-tb / 0.014)
        c.add(dsp.bp(b, 900, 1.0), tt, r.uniform(0.15, 0.4))
    c.add(noise_hit(r, 0.4, 150, 700, 0.12, "pink"), 0.0, 0.3)
    return finalize(c.out())


@sfx("sfx_wind_gust", 2, level_db=-4, group="wind")
def wind_gust(v):
    r = rng_for("wnd", v)
    d = 1.3 + 0.2 * v
    n = nsamp(d)
    t = tvec(n)
    c = Canvas(1.8)
    x = dsp.pink(n, r)
    fc = 380 + 520 * np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.2
    y = dsp.sweep_filter(x, "bp", fc, 2.0, hop=32) + 0.6 * dsp.sweep_filter(x, "bp", fc * 1.9, 2.5, hop=32)
    y *= dsp.env([(0, 0), (d * 0.4, 1, 1.5), (d, 0, 1.2)], n) * (1 + 0.2 * dsp.smooth_noise(n, r, 9.0))
    c.add(y, 0, 0.8)
    c.add(dsp.butter_hp(r.standard_normal(n), 4000, 2) * dsp.env([(0, 0), (d * 0.35, 1, 1.6), (d, 0, 1.2)], n), 0, 0.12)
    return finalize(c.out())


# =========================================================================== explosions / slam / dash
@sfx("sfx_explosion_small", 2, level_db=-1, group="explosion")
def explosion_small(v):
    r = rng_for("exs", v)
    c = Canvas(1.4)
    n = nsamp(0.8)
    t = tvec(n)
    c.add(thump(120 - 15 * v, 38, 0.8, 0.07, 0.24, drive=1.8), 0, 1.0)
    fc = 7000 * (0.06) ** np.clip(t / 0.4, 0, 1)
    burst = dsp.sweep_filter(r.standard_normal(n), "lp", fc, 0.8, hop=24) * np.exp(-t / 0.22)
    c.add(burst, 0, 0.9)
    c.add(click(r, 0.006, 900, None, 0.002), 0, 0.7)
    c.add(dsp.hp(dsp.crackle(n, r, 160, 3.0), 500) * np.exp(-t / 0.25), 0.04, 0.5)
    c.add(noise_hit(r, 0.6, None, 400, 0.2, "brown"), 0.02, 0.6)
    out = dsp.saturate(c.out(), 1.3)
    return finalize(mono_room(punch(out), "small", 0.28, tail=0.6))


@sfx("sfx_explosion_large", 1, level_db=0, group="explosion")
def explosion_large(v):
    r = rng_for("exl", v)
    c = Canvas(3.6)
    n = nsamp(2.0)
    t = tvec(n)
    c.add(thump(90, 26, 2.0, 0.12, 0.7, drive=1.9), 0, 1.0)
    fc = 5500 * (0.04) ** np.clip(t / 0.9, 0, 1)
    burst = dsp.sweep_filter(r.standard_normal(n), "lp", fc, 0.9, hop=32) * np.exp(-t / 0.5)
    c.add(burst, 0, 0.9)
    c.add(click(r, 0.01, 700, None, 0.004), 0, 0.8)
    c.add(noise_hit(r, 2.4, None, 260, 0.8, "brown"), 0.03, 1.0)
    c.add(dsp.hp(dsp.crackle(n, r, 130, 4.0), 400) * np.exp(-t / 0.7), 0.1, 0.5)
    for k in range(5):  # secondary debris thumps
        c.add(thump(r.uniform(70, 130), 35, 0.3, 0.05, 0.1, drive=1.4), r.uniform(0.25, 1.4), r.uniform(0.15, 0.35))
    out = dsp.saturate(c.out(), 1.3)
    return finalize(mono_room(punch(out), "hall", 0.35, tail=1.4))


@sfx("sfx_ground_slam", 2, level_db=-1, group="explosion")
def ground_slam(v):
    r = rng_for("gsl", v)
    c = Canvas(1.4)
    c.add(thump(95 - 10 * v, 30, 1.1, 0.13, 0.35, drive=2.0), 0, 1.0)
    c.add(click(r, 0.006, 600, None, 0.003), 0, 0.8)
    c.add(noise_hit(r, 0.9, None, 330, 0.28, "brown"), 0, 0.9)
    c.add(noise_hit(r, 0.3, 250, 3500, 0.06, "pink"), 0, 0.9)
    n = nsamp(0.7)
    c.add(dsp.hp(dsp.crackle(n, r, 100, 4.0), 450) * np.exp(-tvec(n) / 0.25), 0.04, 0.8)
    for k in range(4):
        f = r.uniform(110, 330)
        c.add(ring([f, f * 2.2], [0.08, 0.04], 0.15, r), r.uniform(0.05, 0.5), r.uniform(0.1, 0.3))
    return finalize(mono_room(punch(dsp.saturate(c.out(), 1.2)), "small", 0.2, tail=0.5))


@sfx("sfx_dash_whoosh", 3, level_db=-5, group="movement")
def dash_whoosh(v):
    r = rng_for("dsh", v)
    d = 0.28 + 0.03 * v
    c = Canvas(0.5)
    c.add(whoosh(r, d, 400 + 60 * v, 5200, q=1.5, peak=0.3, air=0.35, rise=1.4), 0, 1.0)
    n = nsamp(d)
    flutter = dsp.butter_hp(r.standard_normal(n), 1800, 2) * (0.5 + 0.5 * np.sign(np.sin(TAU * 52 * tvec(n)))) * dsp.env([(0, 0), (d * 0.3, 1), (d, 0)], n)
    c.add(dsp.lp(flutter, 6000), 0, 0.16)
    c.add(noise_hit(r, 0.05, 300, 2500, 0.012), 0, 0.5)
    c.add(thump(160, 80, 0.15, 0.03, 0.06), 0, 0.3)
    return finalize(c.out())


# =========================================================================== buffs / summons / aura / shock
@sfx("sfx_buff_cast", 1, level_db=-5, group="buff")
def buff_cast(v):
    r = rng_for("buf", v)
    c = Canvas(1.6)
    for k, hz in enumerate(pentatonic_hz(55, [7, 9, 11, 14])):
        c.add(I.bell(hz, 0.9, 0.7, "glass", r, 0.8), 0.06 * k, 0.4)
    c.add(whoosh(r, 0.5, 500, 5000, q=2.5, peak=0.7, air=0.2), 0, 0.35)
    c.add(thump(110, 70, 0.4, 0.1, 0.18, drive=1.3), 0.1, 0.35)
    pad = I.pad([float(dsp.midi2hz(m)) for m in (67, 71, 74)], 0.8, kind="warm", vel=0.6, attack=0.3, release=0.7, rng=r, cutoff_open=4000)
    c.add(pad.mean(0), 0.05, 0.22)
    return finalize(mono_room(c.out(), "air", 0.28, tail=0.7))


@sfx("sfx_summon_cast", 1, level_db=-4, group="buff")
def summon_cast(v):
    r = rng_for("smn", v)
    c = Canvas(2.0)
    n = nsamp(0.9)
    sp = I.vowel_morph(r.standard_normal(n), "u", "a", 0.7) * dsp.env([(0, 0), (0.6, 1, 2.0), (0.9, 0, 1.0)], n)
    c.add(sp, 0, 0.5)
    c.add(dsp.reverse(I.gong(180, 1.0, 0.8, r, wash=0.6)), 0, 0.3)
    c.add(I.gong(180, 1.4, 0.9, r, wash=0.5), 0.8, 0.5)
    c.add(I.bell(float(dsp.midi2hz(79)), 1.2, 0.8, "glass", r), 0.8, 0.3)
    c.add(thump(100, 40, 0.5, 0.1, 0.2, drive=1.4), 0.8, 0.7)
    return finalize(mono_room(c.out(), "hall", 0.3, tail=0.9))


@sfx("sfx_shockwave", 1, level_db=-2, group="explosion")
def shockwave(v):
    r = rng_for("shk", v)
    d = 0.9
    n = nsamp(d)
    t = tvec(n)
    c = Canvas(1.4)
    c.add(thump(70, 28, 0.9, 0.14, 0.3, drive=1.7), 0, 1.0)
    fc = 3000 * (0.06) ** np.clip(t / 0.5, 0, 1)
    c.add(dsp.sweep_filter(r.standard_normal(n), "bp", fc + 150, 1.2, hop=24) * dsp.env([(0, 0), (0.05, 1), (d, 0, 0.5)], n), 0, 0.8)
    c.add(click(r, 0.005, 700, None, 0.003), 0, 0.7)
    c.add(noise_hit(r, 0.8, None, 280, 0.22, "brown"), 0, 0.7)
    return finalize(mono_room(punch(dsp.saturate(c.out(), 1.2)), "small", 0.22, tail=0.5))


@sfx("sfx_aura_loop", 1, level_db=-12, loop=True, group="buff", kind="ambience")
def aura_loop(v):
    r = rng_for("aur", v)
    T = 2.0
    n = nsamp(T)
    t = tvec(n)
    y = np.zeros(n)
    for f, a in [(110.0, 0.5), (165.0, 0.35), (220.0, 0.3), (330.0, 0.2)]:
        # f * T must be an integer for periodicity
        f = round(f * T) / T
        y += a * np.sin(TAU * f * t + r.uniform(0, 6)) * (0.7 + 0.3 * np.sin(TAU * (round(r.uniform(2, 5)) / T) * t + r.uniform(0, 6)))
    y += 0.35 * periodic_noise(r, T, 500, 3000) * (0.5 + 0.5 * np.sin(TAU * 2.0 / T * t))
    y += 0.2 * periodic_noise(r, T, 3000, 9000) * (0.5 + 0.5 * np.sin(TAU * 3.0 / T * t + 1))
    return y / (np.abs(y).max() + 1e-9) * 0.8


@sfx("sfx_ice_cast", 2, level_db=-4, group="ice")
def ice_cast(v):
    r = rng_for("icc", v)
    c = Canvas(1.2)
    n = nsamp(0.5)
    c.add(whoosh(r, 0.45, 1500, 9000, q=2.5, peak=0.55, air=0.3), 0, 0.45)
    for k, hz in enumerate(pentatonic_hz(72, [0, 2, 3, 5, 7][: 4 + v])):
        c.add(I.bell(hz, 0.7, 0.8, "chime", r), 0.03 * k + 0.05, 0.3)
    c.add(ring([r.uniform(4000, 9000) for _ in range(6)], [0.12] * 6, 0.3, r), 0.02, 0.12)
    c.add(click(r, 0.006, 3000, None, 0.003), 0, 0.5)
    c.add(thump(160, 80, 0.2, 0.04, 0.08), 0, 0.3)
    return finalize(mono_room(c.out(), "air", 0.25, tail=0.6))


@sfx("sfx_ice_shatter", 2, level_db=-4, group="ice")
def ice_shatter(v):
    r = rng_for("ics", v)
    c = Canvas(1.2)
    c.add(click(r, 0.01, 1500, None, 0.003), 0, 0.9)
    c.add(noise_hit(r, 0.1, 3000, 10000, 0.02), 0, 0.6)
    for k in range(18):
        tt = (r.uniform(0, 1) ** 1.5) * 0.7
        c.add(ring([r.uniform(2500, 11000)], [r.uniform(0.05, 0.2)], 0.25, r), tt, r.uniform(0.05, 0.2))
    c.add(thump(150, 60, 0.2, 0.03, 0.08, drive=1.3), 0, 0.4)
    return finalize(mono_room(c.out(), "small", 0.2, tail=0.4))


# =========================================================================== beasts / specials
@sfx("sfx_wolf_howl", 1, level_db=-3, group="beast")
def wolf_howl(v):
    r = rng_for("wlf", v)
    c = Canvas(3.0)
    y = voice(r, 2.0, 360, 300, "o", "u", breath=0.22, attack=0.18, f0_mid=560, vib_hz=5.4, vib_cents=34, tilt=2900, glide_shape=0.85, peak_t=0.5, shimmer=0.03, formant_shift=1.0)
    c.add(y, 0, 1.0)
    c.add(voice(r, 1.9, 372, 310, "u", "o", breath=0.25, attack=0.2, f0_mid=575, vib_hz=5.0, vib_cents=30, tilt=2800, glide_shape=0.85, peak_t=0.5), 0.07, 0.55)
    c.add(noise_hit(r, 1.8, 600, 3500, 0.7, "pink"), 0, 0.05)
    return finalize(mono_room(c.out(), "hall", 0.4, tail=1.0))


@sfx("sfx_claw_slash", 2, level_db=-4, group="beast")
def claw_slash(v):
    r = rng_for("clw", v)
    c = Canvas(0.5)
    for k in range(3):
        c.add(whoosh(r, 0.13, 1500 + 200 * k, 6500, q=1.8, peak=0.35, air=0.3), 0.045 * k, 0.8 - 0.1 * k)
        c.add(noise_hit(r, 0.05, 3500, None, 0.012), 0.045 * k + 0.05, 0.25)
    c.add(thump(180, 90, 0.15, 0.03, 0.06), 0.06, 0.35)
    return finalize(c.out())


@sfx("sfx_dragon_roar", 1, level_db=0, group="beast")
def resounding_bellow(v):
    r = rng_for("drg", v)
    c = Canvas(3.2)
    y = voice(r, 2.2, 62, 48, "a", "o", breath=0.25, rasp=1.0, attack=0.15, f0_mid=100, am_hz=29, am_depth=0.5, tilt=2300, formant_shift=0.8, peak_t=0.5, glide_shape=0.8, bw_scale=1.4)
    c.add(y, 0, 1.0)
    c.add(voice(r, 1.8, 96, 70, "a", "e", breath=0.3, rasp=0.8, attack=0.2, am_hz=33, am_depth=0.4, tilt=3000, formant_shift=1.1, peak_t=0.5, f0_mid=150), 0.15, 0.55)
    c.add(thump(80, 28, 1.5, 0.15, 0.5, drive=1.6), 0, 0.7)
    c.add(I.gong(150, 2.2, 0.7, r, wash=0.4), 0.0, 0.18)
    c.add(noise_hit(r, 2.0, 1500, 7000, 0.7, "pink"), 0.1, 0.12)
    return finalize(mono_room(punch(dsp.saturate(c.out(), 1.2)), "hall", 0.3, tail=1.1))


@sfx("sfx_talisman_throw", 2, level_db=-5, group="projectile")
def talisman_throw(v):
    r = rng_for("tal", v)
    c = Canvas(0.6)
    n = nsamp(0.3)
    flap = dsp.butter_bp(r.standard_normal(n), 1800, 7000, 2) * (0.5 + 0.5 * np.sin(TAU * (34 + 8 * v) * tvec(n))) ** 2 * dsp.env([(0, 0), (0.05, 1), (0.3, 0, 1.2)], n)
    c.add(flap, 0, 0.7)
    c.add(whoosh(r, 0.28, 1200, 5200, q=2.0, peak=0.35, air=0.3), 0, 0.5)
    c.add(ring([2637, 3951], [0.18, 0.12], 0.25, r, split=2), 0.03, 0.12)
    c.add(I.bell(float(dsp.midi2hz(84 + 2 * v)), 0.4, 0.6, "chime", r), 0.04, 0.2)
    return finalize(c.out())


@sfx("sfx_projectile_whoosh", 3, level_db=-8, group="projectile")
def projectile_whoosh(v):
    r = rng_for("prj", v)
    d = 0.22 + 0.03 * v
    c = Canvas(0.4)
    c.add(whoosh(r, d, 900 + 150 * v, 3800, q=1.9, peak=0.5, air=0.25, f_mid=2800), 0, 1.0)
    return finalize(c.out())


@sfx("sfx_magnet", 1, level_db=-5, group="pickup")
def magnet(v):
    r = rng_for("mag", v)
    d = 0.9
    n = nsamp(d)
    c = Canvas(1.4)
    c.add(whoosh(r, d, 300, 7000, q=1.6, peak=0.75, air=0.4, rise=1.6), 0, 0.8)
    for k, hz in enumerate(pentatonic_hz(79, [0, 2, 4, 5, 7, 9])):
        c.add(I.bell(hz, 0.5, 0.6 + 0.05 * k, "glass", r), 0.35 + 0.085 * k, 0.25)
    c.add(thump(120, 70, 0.3, 0.06, 0.12), 0.0, 0.25)
    return finalize(mono_room(c.out(), "air", 0.22, tail=0.5))

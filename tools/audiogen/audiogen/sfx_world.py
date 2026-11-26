"""World SFX: pickups, level-up, economy, chests, Metin stones, bosses, forge."""
from __future__ import annotations

import numpy as np

from . import dsp
from . import instruments as I
from .dsp import SR, TAU, nsamp, tvec, rng_for
from .sfx_lib import (Canvas, click, env_exp, finalize, mono_room, noise_hit, periodic_noise, punch, ring, sfx, thump, voice, whoosh, pentatonic_hz)


# =========================================================================== xp gem ladder (G major pentatonic)
XP_STEPS = [0, 1, 2, 3, 4, 5, 6, 7]  # G5 A5 B5 D6 E6 G6 A6 B6


@sfx("sfx_xp_pickup", 8, level_db=-12, group="pickup")
def xp_pickup(v):
    r = rng_for("xp", v)
    hz = pentatonic_hz(79, [XP_STEPS[v]])[0]  # G5 = 79
    c = Canvas(0.5)
    c.add(I.bell(hz, 0.34, 0.85, "glass", r, 0.85 + 0.03 * v), 0, 0.75)
    c.add(I.bell(hz * 2.0, 0.2, 0.7, "chime", r), 0.004, 0.18)
    c.add(noise_hit(r, 0.02, 4000, None, 0.004), 0, 0.15)
    return finalize(mono_room(c.out(), "small", 0.1, tail=0.15))


@sfx("sfx_yeop_pickup", 3, level_db=-8, group="pickup")
def yeop_pickup(v):
    r = rng_for("yg", v)
    c = Canvas(0.6)
    base = [3100, 3350, 2900][v]
    for k, (dt, p, g) in enumerate([(0.0, 1.0, 1.0), (0.055 + 0.01 * v, 1.09, 0.8)]):
        c.add(ring([base * p, base * p * 1.51, base * p * 2.37, base * p * 3.4], [0.18, 0.13, 0.09, 0.06], 0.35, r, [1, 0.6, 0.45, 0.25], split=2.5), dt, g * 0.6)
        c.add(click(r, 0.003, 4000, None, 0.0012), dt, 0.35 * g)
        c.add(thump(900, 500, 0.04, 0.01, 0.015), dt, 0.1)
    c.add(noise_hit(r, 0.15, 5500, 11000, 0.04), 0.0, 0.1)
    return finalize(mono_room(c.out(), "small", 0.12, tail=0.2))


@sfx("sfx_yeop_pile", 1, level_db=-5, group="pickup")
def yeop_pile(v):
    r = rng_for("ygp", v)
    c = Canvas(1.6)
    for k in range(10):
        tt = (k / 10.0) ** 1.2 * 0.55 + r.uniform(0, 0.02)
        base = r.uniform(2700, 3700)
        c.add(ring([base, base * 1.51, base * 2.37, base * 3.4], [0.2, 0.14, 0.1, 0.06], 0.4, r, [1, 0.6, 0.45, 0.25], split=2.5), tt, r.uniform(0.3, 0.6))
        c.add(click(r, 0.003, 4000, None, 0.0012), tt, 0.25)
    c.add(noise_hit(r, 0.7, 5000, 12000, 0.2), 0.0, 0.12)
    c.add(I.bell(float(dsp.midi2hz(91)), 1.0, 0.6, "glass", r), 0.5, 0.2)
    return finalize(mono_room(c.out(), "small", 0.18, tail=0.4))


@sfx("sfx_potion", 2, level_db=-6, group="pickup")
def potion(v):
    r = rng_for("pot", v)
    c = Canvas(1.2)
    # cork pop
    n = nsamp(0.06)
    t = tvec(n)
    pop = np.sin(TAU * np.cumsum(950 * (0.28) ** (t / 0.04)) / SR) * np.exp(-t / 0.015)
    c.add(pop, 0, 0.8)
    c.add(click(r, 0.004, 1500, None, 0.0015), 0, 0.3)
    # glug glug glug
    for k in range(3 + v):
        tt = 0.1 + 0.11 * k
        m = nsamp(0.09)
        tb = tvec(m)
        f = (230 + 40 * k) * (1 + 1.1 * tb / 0.09)
        g = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-tb / 0.04) * np.minimum(1, tb / 0.006)
        c.add(dsp.bp(g, 600, 0.9) + g * 0.3, tt, 0.5)
    c.add(noise_hit(r, 0.5, 600, 3000, 0.14, "pink"), 0.1, 0.1)
    c.add(I.bell(float(dsp.midi2hz(91 + 2 * v)), 0.7, 0.7, "glass", r), 0.5 + 0.1 * v, 0.2)
    return finalize(mono_room(c.out(), "small", 0.18, tail=0.4))


@sfx("sfx_chest_open", 1, level_db=-2, group="reward")
def chest_open(v):
    r = rng_for("cho", v)
    c = Canvas(2.6)
    # creaking hinge: low saw with wandering lowpass + friction noise
    n = nsamp(0.7)
    t = tvec(n)
    f = 85 * (1 + 0.5 * dsp.smooth_noise(n, r, 9.0) * 0.4) * (1.35 ** (t / 0.7))
    creak = dsp.osc("saw", f, n)
    creak = I.vowel_morph(creak, "o", "e", 0.6, bw_scale=0.8) * dsp.env([(0, 0), (0.08, 1), (0.6, 0.7), (0.7, 0)], n)
    c.add(creak, 0.0, 0.45)
    c.add(dsp.butter_bp(r.standard_normal(n), 1500, 4500, 2) * dsp.env([(0, 0), (0.1, 1), (0.6, 0.3), (0.7, 0)], n) * (0.5 + 0.5 * dsp.smooth_noise(n, r, 30.0)), 0, 0.12)
    # latch + thump
    c.add(I.rim_click(0.8, 1.3, r), 0.02, 0.5)
    c.add(I.moktak(0.8, 0.8, r), 0.72, 0.7)
    c.add(thump(130, 55, 0.3, 0.05, 0.12, drive=1.4), 0.72, 0.7)
    c.add(noise_hit(r, 0.15, 200, 2000, 0.04, "pink"), 0.72, 0.4)
    # magic shimmer + coins
    for k, hz in enumerate(pentatonic_hz(67, [0, 2, 4, 5, 7, 9, 11])):
        c.add(I.bell(hz, 1.2, 0.7, "glass", r, 0.9), 0.85 + 0.07 * k, 0.28)
    pad = I.pad([float(dsp.midi2hz(m)) for m in (67, 71, 74, 78)], 1.1, kind="glass", vel=0.6, attack=0.4, release=0.9, rng=r)
    c.add(pad.mean(0), 0.85, 0.2)
    for k in range(6):
        base = r.uniform(2800, 3800)
        tt = 1.0 + r.uniform(0, 0.5)
        c.add(ring([base, base * 1.51, base * 2.37], [0.2, 0.14, 0.1], 0.4, r, [1, 0.6, 0.4], split=2), tt, 0.18)
    return finalize(mono_room(c.out(), "hall", 0.28, tail=1.0))


@sfx("sfx_level_up", 1, level_db=-1, group="reward")
def level_up(v):
    r = rng_for("lvl", v)
    c = Canvas(3.2)
    # rising pentatonic arpeggio (G major pentatonic), plucked-bell blend
    notes = pentatonic_hz(67, [0, 2, 4, 5, 7, 9, 10, 12])
    for k, hz in enumerate(notes):
        t0 = 0.075 * k
        c.add(I.bell(hz, 1.1 if k < 7 else 2.2, 0.85, "glass", r, 1.0), t0, 0.5 if k < 7 else 0.7)
        c.add(I.pluck(hz, 0.5, vel=0.7, t60=0.7, body="harp", rng=r, bright=0.7), t0, 0.28)
    # triumphant chord under the last note
    for k, m in enumerate((79, 83, 86, 91)):
        c.add(I.bell(float(dsp.midi2hz(m)), 2.2, 0.7, "glass", r, 0.8), 0.6 + 0.012 * k, 0.28)
    c.add(whoosh(r, 0.65, 800, 11000, q=2.2, peak=0.95, air=0.15, rise=1.5), 0.0, 0.45)
    c.add(thump(95, 40, 0.9, 0.12, 0.3, drive=1.6), 0.6, 0.75)
    c.add(I.gong(196, 2.2, 0.8, r, wash=0.4), 0.6, 0.12)
    pad = I.pad([float(dsp.midi2hz(m)) for m in (67, 71, 74, 79)], 1.8, kind="warm", vel=0.7, attack=0.5, release=1.0, rng=r, cutoff_open=3500)
    c.add(pad.mean(0), 0.3, 0.2)
    sp = dsp.bp(dsp.crackle(nsamp(1.2), r, 90, 1.0), 8000, 2.0) * np.exp(-tvec(nsamp(1.2)) / 0.5)
    c.add(sp, 0.6, 0.25)
    return finalize(mono_room(punch(c.out()), "air", 0.4, tail=1.4))


# =========================================================================== Metin stones
@sfx("sfx_metin_warning", 1, level_db=-2, group="metin")
def metin_warning(v):
    r = rng_for("mwr", v)
    d = 2.0
    n = nsamp(d)
    t = tvec(n)
    c = Canvas(d + 0.1)
    f = 2300 * (0.24) ** (t / d) * (1 + 0.006 * np.sin(TAU * 7 * t) + 0.003 * dsp.smooth_noise(n, r, 12))
    w = np.sin(TAU * np.cumsum(f) / SR) + 0.45 * np.sin(TAU * 2 * np.cumsum(f) / SR + 0.5) + 0.3 * np.sin(TAU * 3 * np.cumsum(f) / SR)
    w2 = np.sin(TAU * np.cumsum(f * 1.0119) / SR)
    whistle = (w + 0.6 * w2) * dsp.env([(0, 0), (0.3, 0.35, 1.2), (d * 0.85, 1.0, 1.6), (d, 0.9, 1.0)], n)
    whistle += 0.35 * dsp.bp(r.standard_normal(n), 1.0, 1.0) * 0.0
    air = dsp.sweep_filter(r.standard_normal(n), "bp", f * 1.3, 1.5, hop=24) * dsp.env([(0, 0), (0.3, 0.2), (d * 0.85, 1.0, 1.6), (d, 1.0)], n)
    c.add(whistle, 0, 0.5)
    c.add(air, 0, 0.35)
    rumble = dsp.butter_lp(dsp.pink(n, r), 220, 4) * dsp.env([(0, 0), (d * 0.5, 0.3, 1.5), (d, 1.0, 1.8)], n)
    c.add(rumble, 0, 0.9)
    c.add(dsp.supersaw(55 * (1.12 ** (t / d)), n, 3, 14, r) * dsp.env([(0, 0), (d * 0.4, 0.2), (d, 0.9, 1.6)], n) * 0.3, 0, 0.0)
    out = punch(c.out(), thresh_db=-20.0, ratio=2.0)
    return finalize(out, fade_ms=40)


@sfx("sfx_metin_impact", 1, level_db=0, group="metin")
def metin_impact(v):
    r = rng_for("mim", v)
    c = Canvas(4.5)
    n = nsamp(3.0)
    t = tvec(n)
    c.add(thump(84, 24, 3.0, 0.14, 1.0, drive=2.0), 0, 1.0)
    c.add(click(r, 0.012, 500, None, 0.005), 0, 1.0)
    fc = 6500 * (0.03) ** np.clip(t / 1.2, 0, 1)
    c.add(dsp.sweep_filter(r.standard_normal(n), "lp", fc, 0.9, hop=32) * np.exp(-t / 0.6), 0, 0.85)
    c.add(noise_hit(r, 3.2, None, 240, 1.1, "brown"), 0.02, 1.0)
    # crystalline stone ring (inharmonic, long)
    freqs = [r.uniform(400, 5200) for _ in range(9)]
    c.add(ring(freqs, [r.uniform(0.7, 1.8) for _ in freqs], 2.5, r, [r.uniform(0.3, 1) for _ in freqs], split=2.0), 0.0, 0.1)
    c.add(dsp.hp(dsp.crackle(n, r, 190, 4.5), 350) * np.exp(-t / 0.9), 0.05, 0.5)
    for k in range(7):
        c.add(thump(r.uniform(65, 130), 32, 0.35, 0.05, 0.12, drive=1.5), r.uniform(0.2, 1.8), r.uniform(0.15, 0.4))
    out = dsp.saturate(c.out(), 1.35)
    return finalize(mono_room(punch(out), "cave", 0.38, tail=1.6))


@sfx("sfx_metin_pulse", 1, level_db=-12, loop=True, group="metin", kind="ambience")
def metin_pulse(v):
    r = rng_for("mpl", v)
    T = 2.4
    n = nsamp(T)
    t = tvec(n)
    k = lambda f: round(f * T) / T
    pulse = 0.55 + 0.45 * np.sin(TAU * (2.0 / T) * t - np.pi / 2) ** 2
    y = 0.8 * np.sin(TAU * k(55.0) * t) + 0.5 * np.sin(TAU * k(110.0) * t + 0.4) + 0.35 * np.sin(TAU * k(164.6) * t + 1.1) + 0.2 * np.sin(TAU * k(329.2) * t)
    y *= pulse
    for f, a in [(659.0, 0.12), (989.0, 0.09), (1433.0, 0.06)]:
        y += a * np.sin(TAU * k(f) * t + r.uniform(0, 6)) * (0.5 + 0.5 * np.sin(TAU * (round(r.uniform(2, 6)) / T) * t + r.uniform(0, 6)))
    y += 0.25 * periodic_noise(r, T, 600, 2400) * pulse
    y = dsp.saturate(y * 0.8, 1.4)
    return y / (np.abs(y).max() + 1e-9) * 0.85


# =========================================================================== lava (WP AG-03)
LAVA_T = 4.8  # loop period in seconds (a 96 kbps mono CBR encode of it is ~58 kB)


@sfx("sfx_lava_bubble_loop", 1, level_db=-10, loop=True, group="lava", kind="ambience")
def lava_bubble_loop(v):
    """Positional bed for lava edges (AU-02): the thick magma body rumbling under a slow swell, a quiet simmering hiss, and viscous bubbles --
    small quick 'blip's, medium 'bloop's and a few big slow 'gloop's -- each a rising sine blob with a soft pop. Exactly periodic: the bed is
    circular band-limited noise under whole-cycle envelopes and every bubble is mixed in with wrap-around, so no cross-fade is needed."""
    r = rng_for("lvb", v)
    T = LAVA_T
    n = nsamp(T)
    t = tvec(n)
    # the magma body: low, brownish, breathing over two whole cycles
    body = periodic_noise(r, T, 26, 170, -0.6)
    breath = 0.7 + 0.3 * np.sin(TAU * (2.0 / T) * t + r.uniform(0, TAU))
    body = body * breath
    # simmer: a soft hiss that comes and goes
    simmer = periodic_noise(r, T, 1500, 5200, -0.2)
    simmer = simmer * (0.45 + 0.55 * np.clip(0.5 + 0.5 * periodic_noise(r, T, 0.4, 3.5) * 0.6, 0, 1)) * 0.5
    bubbles = np.zeros(n)

    def put(sig, at, gain):
        idx = (at + np.arange(len(sig))) % n  # wrap around the loop end
        bubbles[idx] += sig * gain  # a bubble never overlaps itself (sig is much shorter than the loop), so plain fancy indexing is exact

    def bubble(f0, d, rise, pop):
        m = nsamp(d)
        tt = tvec(m)
        f = f0 * (1.0 + rise * (tt / d) ** 0.8)
        y = np.sin(TAU * np.cumsum(f) / SR) + 0.28 * np.sin(2 * TAU * np.cumsum(f) / SR)
        e = (1.0 - np.exp(-tt / 0.004)) * np.exp(-tt / (0.38 * d))
        y = y * e
        if pop > 0:  # the film bursts: a soft, low-passed puff just before the blob dies
            k = nsamp(0.035)
            nz = dsp.butter_lp(dsp.butter_bp(r.standard_normal(k), 600, 2600, 2), 3200, 2) * env_exp(k, 0.009, 0.002)
            y[-k:] += nz[: min(k, m)] * pop if m >= k else 0
        return dsp.fade(y, 0.002, 0.012)

    # 15 bubbles, jittered on an even grid so they never clump into a rhythm: (frequency range Hz, length s, pitch rise, pop, level)
    kinds = [((230, 420), 0.075, 0.9, 0.0, 0.5)] * 7 + [((110, 200), 0.15, 1.1, 0.12, 0.75)] * 5 + [((52, 90), 0.28, 1.3, 0.0, 1.0)] * 3
    r.shuffle(kinds)
    for k, (fr, d, rise, pop, lvl) in enumerate(kinds):
        at = int(((k + r.uniform(0.15, 0.85)) / len(kinds)) * n)
        put(bubble(r.uniform(*fr), d, rise, pop), at, lvl * r.uniform(0.75, 1.0))
    y = body * 0.3 + simmer * 0.2 + bubbles * 0.9
    pad = nsamp(0.25)  # the oversampling filter of saturate() rings at the ends of a buffer: run it on the periodically extended loop
    y = dsp.saturate(np.concatenate([y[-pad:], y, y[:pad]]) * 0.9, 1.3)[pad:-pad]
    y = y - y.mean()
    return y / (np.abs(y).max() + 1e-9) * 0.85


@sfx("sfx_metin_awaken", 1, level_db=0, group="metin")
def metin_awaken(v):
    r = rng_for("maw", v)
    c = Canvas(4.0)
    y = voice(r, 2.6, 66, 52, "a", "o", breath=0.3, rasp=1.0, attack=0.25, f0_mid=108, am_hz=27, am_depth=0.55, tilt=2400, formant_shift=0.85, peak_t=0.6, glide_shape=0.8, bw_scale=1.3)
    c.add(y, 0, 1.0)
    c.add(voice(r, 2.2, 140, 100, "ae", "a", breath=0.35, rasp=0.9, attack=0.3, am_hz=41, am_depth=0.5, tilt=3200, f0_mid=210, peak_t=0.7, formant_shift=1.0), 0.2, 0.5)
    c.add(thump(90, 30, 1.6, 0.12, 0.55, drive=1.7), 0, 0.8)
    # crystal shriek (stone awakening)
    n = nsamp(2.0)
    t = tvec(n)
    f = 1300 * (1 + 0.5 * np.sin(np.pi * np.clip(t / 2.0, 0, 1)))
    sh = dsp.fm(f, 2.01, 2.2 * np.exp(-t / 0.8) + 0.3, n) * dsp.env([(0, 0), (0.4, 0.6, 1.4), (1.2, 1), (2.0, 0, 1.0)], n)
    c.add(sh, 0.3, 0.14)
    freqs = [r.uniform(500, 4800) for _ in range(8)]
    c.add(ring(freqs, [r.uniform(0.6, 1.5) for _ in freqs], 2.0, r, split=2.5), 0.5, 0.05)
    c.add(noise_hit(r, 2.2, 1200, 8000, 0.8, "pink"), 0.4, 0.1)
    out = dsp.saturate(c.out(), 1.3)
    return finalize(mono_room(punch(out), "hall", 0.33, tail=1.2))


@sfx("sfx_metin_shatter", 1, level_db=-1, group="metin")
def metin_shatter(v):
    r = rng_for("msh", v)
    c = Canvas(3.2)
    c.add(click(r, 0.012, 1200, None, 0.004), 0, 1.0)
    c.add(noise_hit(r, 0.25, 2500, 12000, 0.05), 0, 0.8)
    c.add(thump(120, 38, 0.8, 0.08, 0.28, drive=1.7), 0, 0.9)
    c.add(noise_hit(r, 1.2, None, 400, 0.4, "brown"), 0, 0.6)
    for k in range(70):
        tt = (r.uniform(0, 1) ** 1.6) * 1.3
        f = r.uniform(1800, 10500)
        c.add(ring([f, f * 1.0 + r.uniform(40, 200)], [r.uniform(0.05, 0.4)] * 2, 0.5, r, split=0), tt, r.uniform(0.04, 0.2) * (1 - 0.4 * tt / 1.3))
    for k in range(7):  # heavier crystal chunks
        f = r.uniform(500, 1500)
        c.add(ring([f, f * 2.76, f * 5.4], [0.3, 0.15, 0.08], 0.5, r, [1, 0.6, 0.3], split=1.2), (r.uniform(0, 1) ** 1.4) * 0.8, r.uniform(0.1, 0.25))
    c.add(dsp.hp(dsp.crackle(nsamp(1.4), r, 220, 3.0), 600) * np.exp(-tvec(nsamp(1.4)) / 0.5), 0.05, 0.4)
    c.add(whoosh(r, 0.9, 6000, 700, q=1.4, peak=0.1, air=0.3), 0.05, 0.25)
    out = dsp.saturate(c.out(), 1.2)
    return finalize(mono_room(punch(out), "hall", 0.3, tail=1.2))


# =========================================================================== bosses
@sfx("sfx_boss_spawn", 1, level_db=0, group="boss")
def boss_spawn(v):
    r = rng_for("bsp", v)
    c = Canvas(4.5)
    # two low horns (open fifth) swelling, plus taiko hit + gong + reversed cymbal
    c.add(I.brass_note(82.4, 2.6, 0.9, attack=0.45, release=0.8, rng=r, vib_depth=6, bright=0.9, growl=0.15), 0.0, 0.8)
    c.add(I.brass_note(123.5, 2.6, 0.85, attack=0.5, release=0.8, rng=r, vib_depth=6, bright=0.9, growl=0.1), 0.05, 0.6)
    c.add(I.brass_note(55.0, 2.6, 0.9, attack=0.4, release=0.8, rng=r, vib_depth=4, bright=0.6), 0.0, 0.5)
    c.add(dsp.reverse(I.cymbal(1.4, 0.8, r)), 0.9, 0.5)
    c.add(I.taiko(60, 1.0, 1.6, 1.3, r), 1.25, 1.0)
    c.add(I.taiko(60, 0.95, 1.6, 1.3, r), 1.25 + 0.5, 0.9)
    c.add(I.gong(98, 3.0, 1.0, r, wash=0.6), 1.25, 0.8)
    c.add(thump(70, 28, 1.2, 0.1, 0.4, drive=1.7), 1.25, 0.8)
    out = dsp.saturate(c.out() * 0.8, 1.2)
    return finalize(mono_room(punch(out), "hall", 0.35, tail=1.2))


@sfx("sfx_boss_roar", 2, level_db=0, group="boss")
def boss_roar(v):
    r = rng_for("brr", v)
    c = Canvas(3.6)
    f = [74, 62][v]
    y = voice(r, 2.0, f * 1.1, f * 0.6, "a", "o" if v == 0 else "e", breath=0.3, rasp=1.0, attack=0.12, f0_mid=f * 1.7, am_hz=31 + 4 * v, am_depth=0.5, tilt=2600, formant_shift=0.9, peak_t=0.5, glide_shape=0.7, bw_scale=1.3)
    c.add(y, 0, 1.0)
    c.add(voice(r, 1.6, f * 2.1, f * 1.3, "ae", "a", breath=0.35, rasp=0.9, attack=0.15, am_hz=44, am_depth=0.5, tilt=3300, f0_mid=f * 3.2, peak_t=0.5), 0.1, 0.5)
    c.add(thump(90, 32, 1.2, 0.1, 0.4, drive=1.6), 0, 0.6)
    c.add(noise_hit(r, 1.6, 500, 6000, 0.6, "pink"), 0.1, 0.1)
    out = dsp.saturate(c.out(), 1.4)
    return finalize(mono_room(punch(out), "hall", 0.3, tail=1.2))


@sfx("sfx_boss_phase", 1, level_db=-2, group="boss")
def boss_phase(v):
    r = rng_for("bph", v)
    c = Canvas(2.4)
    c.add(I.taiko(65, 1.0, 1.6, 1.2, r), 0.0, 1.0)
    c.add(I.gong(110, 2.2, 0.9, r, wash=0.5), 0.0, 0.7)
    c.add(voice(r, 1.0, 85, 60, "a", "o", breath=0.3, rasp=0.9, attack=0.1, am_hz=30, am_depth=0.5, tilt=2500, formant_shift=0.88, peak_t=0.25, f0_mid=120), 0.1, 0.8)
    c.add(whoosh(r, 0.6, 400, 6000, q=1.6, peak=0.9, air=0.3), 0.0, 0.35)
    return finalize(mono_room(punch(dsp.saturate(c.out(), 1.3)), "hall", 0.28, tail=0.8))


@sfx("sfx_boss_death", 1, level_db=0, group="boss")
def boss_death(v):
    r = rng_for("bdt", v)
    c = Canvas(5.0)
    c.add(voice(r, 2.2, 90, 40, "a", "u", breath=0.3, rasp=0.9, attack=0.05, am_hz=22, am_depth=0.55, tilt=2400, formant_shift=0.85, f0_mid=110, peak_t=0.3, glide_shape=0.9), 0.0, 0.8)
    c.add(thump(80, 24, 3.0, 0.15, 1.0, drive=1.9), 1.0, 1.0)
    c.add(noise_hit(r, 3.0, None, 260, 1.0, "brown"), 1.0, 0.9)
    c.add(dsp.hp(dsp.crackle(nsamp(2.5), r, 150, 4.0), 400) * np.exp(-tvec(nsamp(2.5)) / 0.8), 1.0, 0.5)
    for k in range(8):
        c.add(thump(r.uniform(60, 120), 30, 0.4, 0.06, 0.15, drive=1.5), 1.0 + r.uniform(0.1, 1.8), r.uniform(0.2, 0.4))
    c.add(I.gong(80, 4.0, 1.0, r, wash=0.5), 1.0, 0.5)
    c.add(I.bell(float(dsp.midi2hz(79)), 3.0, 0.8, "temple", r), 2.2, 0.15)
    return finalize(mono_room(punch(dsp.saturate(c.out(), 1.2)), "cave", 0.35, tail=1.5))


# =========================================================================== forge (blacksmith)
@sfx("sfx_forge_success", 1, level_db=-3, group="forge")
def forge_success(v):
    r = rng_for("fgs", v)
    c = Canvas(2.4)
    for k in range(2):  # two hammer strikes on the anvil
        t0 = 0.0 + 0.32 * k
        c.add(ring([1250, 1250 * 2.76, 1250 * 5.4, 1250 * 8.9], [0.5, 0.25, 0.14, 0.08], 0.7, r, [1, 0.8, 0.5, 0.3], split=1.5), t0, 0.5)
        c.add(click(r, 0.004, 2500, None, 0.0015), t0, 0.6)
        c.add(thump(220, 90, 0.2, 0.03, 0.08, drive=1.5), t0, 0.7)
    t1 = 0.7
    for k, hz in enumerate(pentatonic_hz(72, [0, 2, 4, 5, 7])):
        c.add(I.bell(hz, 1.4, 0.8, "glass", r, 0.9), t1 + 0.08 * k, 0.4)
    c.add(whoosh(r, 0.5, 1000, 10000, q=2.2, peak=0.9, air=0.2), t1 - 0.05, 0.3)
    c.add(dsp.bp(dsp.crackle(nsamp(1.0), r, 120, 1.0), 6500, 2.0) * np.exp(-tvec(nsamp(1.0)) / 0.4), t1, 0.25)
    return finalize(mono_room(punch(c.out()), "small", 0.25, tail=0.8))


@sfx("sfx_forge_fail", 1, level_db=-3, group="forge")
def forge_fail(v):
    r = rng_for("fgf", v)
    c = Canvas(1.6)
    c.add(ring([420, 420 * 2.76, 420 * 5.4], [0.12, 0.06, 0.03], 0.3, r, [1, 0.7, 0.4]), 0, 0.5)
    c.add(thump(160, 60, 0.3, 0.04, 0.12, drive=1.6), 0, 0.9)
    c.add(click(r, 0.004, 2000), 0, 0.5)
    c.add(noise_hit(r, 0.5, 1200, 6000, 0.14), 0.04, 0.35)  # crack/hiss
    n = nsamp(0.7)
    t = tvec(n)
    f = 220 * (0.5) ** (t / 0.7)
    buz = dsp.lp(dsp.osc("square", f, n), 900) * dsp.env([(0, 0), (0.02, 1), (0.5, 0.5), (0.7, 0)], n)
    c.add(buz, 0.15, 0.3)
    c.add(dsp.hp(dsp.crackle(nsamp(0.5), r, 90, 3.0), 700) * np.exp(-tvec(nsamp(0.5)) / 0.15), 0.08, 0.4)
    return finalize(mono_room(punch(c.out()), "small", 0.15, tail=0.4))


@sfx("sfx_run_start", 1, level_db=-3, group="reward")
def run_start(v):
    r = rng_for("rst", v)
    c = Canvas(3.0)
    c.add(I.gong(150, 3.0, 0.9, r, wash=0.5), 0.0, 0.7)
    c.add(I.taiko(75, 1.0, 1.4, 1.2, r), 0.0, 0.9)
    c.add(I.taiko(75, 0.8, 1.2, 1.0, r), 0.32, 0.7)
    c.add(whoosh(r, 0.5, 500, 5000, q=1.5, peak=0.6, air=0.3), 0.0, 0.3)
    for k, hz in enumerate(pentatonic_hz(67, [0, 2, 4])):
        c.add(I.bell(hz, 1.4, 0.8, "glass", r), 0.5 + 0.1 * k, 0.3)
    return finalize(mono_room(punch(c.out()), "hall", 0.3, tail=1.0))


@sfx("sfx_essence_pick", 1, level_db=-3, group="reward")
def essence_pick(v):
    r = rng_for("ess", v)
    c = Canvas(2.4)
    c.add(I.bell(220.0, 2.4, 0.9, "temple", r), 0.0, 0.5)
    c.add(thump(100, 45, 0.5, 0.08, 0.2, drive=1.4), 0.0, 0.7)
    c.add(whoosh(r, 0.4, 600, 8000, q=2.0, peak=0.6, air=0.2), 0.0, 0.3)
    for k, hz in enumerate(pentatonic_hz(79, [0, 2, 4, 6])):
        c.add(I.bell(hz, 1.2, 0.8, "glass", r), 0.08 + 0.06 * k, 0.3)
    return finalize(mono_room(punch(c.out()), "hall", 0.3, tail=1.0))

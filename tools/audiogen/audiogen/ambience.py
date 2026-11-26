"""Zone ambience beds (AG-01): four seamless 48 s mono loops, one per zone, from the same DSP toolkit as the SFX.

    amb_yeonmu       breeze in leaves, sparse distant birds, faint river murmur
    amb_suryeon   dry steppe wind, banner flaps, far war drums every ~12 s, crows
    amb_seori        cold hollow wind, snow hiss, distant ice creaks, rare gusts
    amb_daeryeol   low rumble, lava bubbling, crackle, steam hiss

Every bed is *exactly* N-periodic by construction, so the loop seam is mathematically continuous before the codec:
  * continuous layers are synthesised in the frequency domain (random phases on integer harmonics of 1 / 48 s) and
    modulated by periodic envelopes (the same trick as sfx_lib.periodic_noise);
  * events (birds, drums, creaks, bubbles ...) are placed with wrap-around (``put``), so a tail that runs past 48 s
    continues at 0 s;
  * filters run on a circularly padded copy (``cf``), reverbs are convolved and folded back (``creverb``).
The rendered bed is normalised to TARGET_LUFS (integrated, BS.1770, as audiogen.qa measures it). build.py rotates the
loop to the quietest, flattest wrap point before the MP3 encode (a rotation of a periodic signal is the same loop).

    python -m audiogen.ambience [--only amb_x]     # render to .research/audio/wav/ambience and print statistics
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import signal as sps

from . import dsp
from .dsp import SR, TAU, nsamp, rng_for, tvec
from .sfx_lib import env_exp, noise_hit, thump, voice

T = 48.0
N = nsamp(T)  # 2,116,800 samples
TARGET_LUFS = -28.0
PAD = nsamp(3.0)

_F = np.fft.rfftfreq(N, 1.0 / SR)


@dataclass
class Bed:
    id: str
    fn: object
    desc: str
    kind: str = "ambience"


BEDS: dict[str, Bed] = {}
_LOG: list[dict] = []  # events a bed placed (kind, time, duration, analysis band): written into the render info for QA and notes


def log(kind, t, dur, lo, hi):
    _LOG.append(dict(kind=kind, t=round(float(t), 2), dur=round(float(dur), 2), lo=lo, hi=hi))


def bed(id: str, desc: str):
    def deco(fn):
        BEDS[id] = Bed(id, fn, desc)
        return fn

    return deco


# --------------------------------------------------------------------------- periodic building blocks
def _unit(y):
    return y / (np.sqrt(np.mean(y * y)) + 1e-12)


def pshape(r, pts):
    """N-periodic noise whose amplitude spectrum follows pts = [(Hz, dB), ...] (piece-wise linear in log f / dB, zero outside)."""
    fx = np.array([p[0] for p in pts], dtype=float)
    dbs = np.array([p[1] for p in pts], dtype=float)
    mag = np.zeros_like(_F)
    inside = (_F >= fx[0]) & (_F <= fx[-1])
    mag[inside] = 10 ** (np.interp(np.log(_F[inside]), np.log(fx), dbs) / 20.0)
    spec = mag * np.exp(1j * r.uniform(0, TAU, _F.size))
    return _unit(np.fft.irfft(spec, N))


def pmod(r, lo, hi):
    """Slow / fast periodic random modulator, zero mean, unit std (band lo..hi Hz)."""
    band = (_F >= lo) & (_F <= hi)
    spec = np.zeros(_F.size, dtype=complex)
    spec[band] = np.exp(1j * r.uniform(0, TAU, band.sum()))
    y = np.fft.irfft(spec, N)
    return (y - y.mean()) / (y.std() + 1e-12)


def gust(r, lo, hi, depth=1.0, bias=0.0):
    """Periodic gust curve in (0, 1)."""
    return 0.5 + 0.5 * np.tanh(depth * (pmod(r, lo, hi) + bias))


def grain(r, lo, hi, sharp=0.9):
    """Positive spiky (log-normal) periodic envelope with mean ~1: granular rustle / burble."""
    y = np.clip(pmod(r, lo, hi), -3.0, 2.0)  # bounded: a rustle grain is a swell, never a click
    return np.exp(sharp * y - 0.5 * sharp * sharp)


def cf(x, fn):
    """Apply a causal filter circularly (the result is N-periodic up to filter-memory precision)."""
    xp = np.concatenate([x[-PAD:], x, x[:PAD]])
    return np.asarray(fn(xp))[PAD : PAD + N]


def csweep(x, kind, fc, q, hop=64):
    xp = np.concatenate([x[-PAD:], x, x[:PAD]])
    fp = np.concatenate([fc[-PAD:], fc, fc[:PAD]])
    return dsp.sweep_filter(xp, kind, fp, q, hop=hop)[PAD : PAD + N]


def creverb(x, name, wet, dry=1.0):
    """Circular convolution reverb (mono): convolve, fold the tail back onto the start."""
    ir = dsp.reverb_ir(name)
    w = 0.5 * (sps.fftconvolve(x, ir[0]) + sps.fftconvolve(x, ir[1]))
    return dry * x + wet * dsp.loop_fold(w, N)


def put(buf, x, t, g=1.0):
    """Add event x at time t seconds with wrap-around."""
    i = int(round(t * SR)) % N
    L = len(x)
    m = min(L, N - i)
    buf[i : i + m] += g * x[:m]
    if m < L:
        buf[: L - m] += g * x[m:]


def times_from(r, count, activity):
    """`count` event times (s) drawn with probability proportional to the periodic activity curve."""
    cdf = np.cumsum(activity)
    idx = np.searchsorted(cdf, r.random(count) * cdf[-1])
    return np.sort(np.minimum(idx, N - 1)) / SR


def lull(g, t0, span, dur):
    """Start time within t0 +- span (s) where the periodic gust curve g is calmest over `dur`: calls sit in the lulls."""
    k = nsamp(dur)
    cs = np.concatenate([[0.0], np.cumsum(np.concatenate([g, g[:k]]))])
    cand = (np.arange(nsamp(t0 - span), nsamp(t0 + span), 441) % N)
    m = (cs[cand + k] - cs[cand]) / k
    return float(cand[int(np.argmin(m))] / SR)


def impulses(r, count, activity, spread=1.0):
    """Periodic impulse train (random times by activity, log-normal amplitudes, random sign)."""
    out = np.zeros(N)
    pos = np.minimum(np.searchsorted(np.cumsum(activity), r.random(count) * activity.sum()), N - 1)
    amp = np.exp(spread * r.standard_normal(count)) * r.choice([-1.0, 1.0], count)
    np.add.at(out, pos, amp)
    return out


def circ_conv(x, kernel):
    k = np.zeros(N)
    k[: len(kernel)] = kernel
    return np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(k), N)


def rms_n(x):
    return _unit(x)


def at_db(x, d):
    return x * 10 ** (d / 20.0)


def peak_to(x, d):
    """Scale so the event layer's peak sits at d dB relative to a unit-RMS continuous layer."""
    return x * (10 ** (d / 20.0) / (np.abs(x).max() + 1e-12))


def lp(x, fc, order=2):
    return cf(x, lambda z: dsp.butter_lp(z, fc, order))


def hp(x, fc, order=2):
    return cf(x, lambda z: dsp.butter_hp(z, fc, order))


def bp(x, lo, hi, order=2):
    return cf(x, lambda z: dsp.butter_bp(z, lo, hi, order))


# --------------------------------------------------------------------------- event voices
def chirp(f0, f1, dur, harm=0.22, fm_hz=0.0, fm_dep=0.0, curve=0.8):
    n = nsamp(dur)
    t = tvec(n)
    u = np.clip(t / dur, 0, 1)
    f = f0 * (f1 / f0) ** (u**curve)
    if fm_hz > 0:
        f = f * (1 + fm_dep * np.sin(TAU * fm_hz * t))
    ph = TAU * np.cumsum(f) / SR
    y = np.sin(ph) + harm * np.sin(2 * ph + 0.3) + harm * 0.25 * np.sin(3 * ph + 1.1)
    return y * np.sin(np.pi * u) ** 1.6


def song_warble(r):
    """Small songbird: a run of 9-15 short chirps whose pitch wanders; amplitude swells and fades."""
    k = int(r.integers(9, 16))
    base = r.uniform(3000, 4200)
    t = 0.0
    out = np.zeros(nsamp(1.6))
    for i in range(k):
        dur = r.uniform(0.035, 0.075)
        up = r.random() < 0.5
        f0 = base * r.uniform(0.85, 1.15)
        f1 = f0 * (r.uniform(1.15, 1.45) if up else r.uniform(0.65, 0.88))
        a = np.sin(np.pi * (i + 0.5) / k) ** 0.8
        c = chirp(f0, f1, dur, 0.25, fm_hz=r.uniform(20, 55), fm_dep=r.uniform(0.0, 0.03))
        s = nsamp(t)
        out[s : s + len(c)] += c * a
        t += dur + r.uniform(0.012, 0.035)
    return out[: nsamp(t + 0.05)]


def whistle_triad(r):
    """Clear three-note whistle (tu-tu-tuuu)."""
    base = r.uniform(2300, 2900)
    out = np.zeros(nsamp(1.4))
    t = 0.0
    for dur, f0, f1, vib in ((0.17, 1.0, 1.1, 0), (0.17, 1.08, 1.2, 0), (0.46, 1.32, 0.92, 16)):
        c = chirp(base * f0, base * f1, dur, 0.12, fm_hz=vib, fm_dep=0.02 if vib else 0, curve=0.9)
        s = nsamp(t)
        out[s : s + len(c)] += c
        t += dur + 0.11
    return out[: nsamp(t)]


def cuckoo(r):
    base = r.uniform(640, 780)
    out = np.zeros(nsamp(1.0))
    for i, (ratio, dur) in enumerate(((1.0, 0.27), (0.8, 0.31))):
        n = nsamp(dur)
        tt = tvec(n)
        f = base * ratio * (1 + 0.012 * np.exp(-tt / 0.05))
        ph = TAU * np.cumsum(f) / SR
        y = (np.sin(ph) + 0.18 * np.sin(2 * ph)) * (np.sin(np.pi * np.clip(tt / dur, 0, 1)) ** 0.9)
        s = nsamp(0.0 + i * 0.38)
        out[s : s + n] += y
    return out[: nsamp(0.72)]


def chip_run(r):
    out = np.zeros(nsamp(0.8))
    t = 0.0
    for _ in range(int(r.integers(3, 6))):
        c = chirp(r.uniform(3600, 4300), r.uniform(4800, 5800), 0.04, 0.2, curve=0.7)
        s = nsamp(t)
        out[s : s + len(c)] += c * r.uniform(0.7, 1.0)
        t += r.uniform(0.1, 0.17)
    return out[: nsamp(t)]


def war_drum(r, size=1.0):
    d = 1.5
    n = nsamp(d)
    t = tvec(n)
    f = 52 * size ** -0.2 + 62 * np.exp(-t / 0.055)
    ph = TAU * np.cumsum(f) / SR
    body = (np.sin(ph) + 0.4 * np.sin(2 * ph + 0.6)) * env_exp(n, 0.3 * size, 0.003)
    skin = dsp.butter_bp(r.standard_normal(n), 140, 900, 2) * env_exp(n, 0.09, 0.0008) * 0.9
    shell = (np.sin(TAU * 176 * t + 0.4) + 0.5 * np.sin(TAU * 263 * t)) * np.exp(-t / 0.22) * 0.45
    return body + skin + shell


def crow_caw(r, f0=500.0, dur=0.3):
    return voice(r, dur, f0 * 1.1, f0 * 0.74, "a", "o", breath=0.28, rasp=0.9, attack=0.012, am_hz=r.uniform(58, 82), am_depth=0.4,
                 formant_shift=1.5, tilt=4600, peak_t=dur * 0.25, glide_shape=0.8, bw_scale=1.2)


def ice_creak(r, dur, fa, fb):
    n = nsamp(dur)
    u = np.clip(tvec(n) / dur, 0, 1)
    rate = 58 * (1 + 0.28 * dsp.smooth_noise(n, r, 9.0)) * (1.15 - 0.45 * u)
    saw = 2 * ((np.cumsum(rate) / SR) % 1.0) - 1
    fc = fa * (fb / fa) ** u
    y = dsp.sweep_filter(saw, "bp", fc, 9.0, hop=32)
    y = y + 0.4 * dsp.sweep_filter(saw, "bp", fc * 1.97, 7.0, hop=32)
    e = np.sin(np.pi * u) ** 1.4 * (0.65 + 0.35 * dsp.smooth_noise(n, r, 14.0))
    return y * e


def bubble(r, f0, dur, rise, tone=0.3):
    n = nsamp(dur)
    t = tvec(n)
    u = np.clip(t / dur, 0, 1)
    f = f0 * (1 + rise * u**0.6)
    ph = TAU * np.cumsum(f) / SR
    y = np.sin(ph) + tone * np.sin(2 * ph + 0.5)
    e = (1 - np.exp(-t / 0.007)) * np.exp(-t / (dur * 0.34)) * (0.5 + 0.5 * np.cos(np.pi * np.clip((u - 0.78) / 0.22, 0, 1)))
    return y * e


# --------------------------------------------------------------------------- the beds
@bed("amb_yeonmu", "breeze in leaves, sparse distant birds, faint river murmur")
def amb_yeonmu(R):
    g1 = gust(R("g1"), 0.03, 0.18)
    g2 = gust(R("g2"), 0.05, 0.30)
    # air body: soft low-mid breath that swells with the gusts
    body = pshape(R("body"), [(70, -40), (140, -12), (350, 0), (900, -6), (1800, -20), (3500, -46)]) * (0.3 + 0.7 * g1)
    # leaves: granular HF rustle, louder in the gusts
    leaves = pshape(R("leaf"), [(900, -40), (1800, -10), (3200, -2), (4800, 0), (7500, -8), (11000, -26), (14000, -50)])
    leaves = leaves * (0.2 + 0.8 * g2) * grain(R("leafg"), 3, 22, 0.7)
    leaves2 = pshape(R("leaf2"), [(2400, -40), (4200, -3), (6000, 0), (9000, -8), (13000, -32)]) * (0.15 + 0.85 * g1**2) * grain(R("leafg2"), 6, 30, 0.75)
    # river: constant broadband murmur plus a few burbling narrow bands
    river = pshape(R("riv"), [(110, -34), (250, -6), (600, 0), (1300, -5), (2600, -18), (5000, -42)]) * (0.85 + 0.15 * pmod(R("rivm"), 0.1, 0.5))
    burble = np.zeros(N)
    for i, fc in enumerate((330, 520, 780, 1150, 1700)):
        burble += pshape(R("bur", i), [(fc * 0.8, -34), (fc, 0), (fc * 1.25, -34)]) * grain(R("burg", i), 2, 9, 0.85)
    # birds: a handful of phrases, placed by hand so they never crowd the seam or each other
    birds = np.zeros(N)
    plan = [(3.2, "warble"), (9.5, "cuckoo"), (16.4, "chip"), (21.0, "triad"), (27.6, "warble"), (33.8, "cuckoo"), (38.9, "chip"), (44.1, "triad")]
    for i, (t0, kind) in enumerate(plan):
        rr = R("bird", i)
        ev = {"warble": song_warble, "cuckoo": cuckoo, "chip": chip_run, "triad": whistle_triad}[kind](rr)
        kg = {"warble": 1.7, "chip": 1.9, "cuckoo": 1.0, "triad": 0.85}[kind]
        tt = lull(0.5 * (g1 + g2), t0, 2.2, len(ev) / SR)
        log(kind, tt, len(ev) / SR, *{"warble": (2800, 6500), "cuckoo": (500, 1000), "chip": (3300, 6500), "triad": (2000, 3600)}[kind])
        put(birds, ev / (np.abs(ev).max() + 1e-9), tt, kg * rr.uniform(0.85, 1.0))
    birds = lp(birds, 5200, 2)
    birds = creverb(birds, "air", wet=1.1, dry=0.45)
    mix = 1.0 * rms_n(body) + 0.42 * rms_n(leaves) + 0.15 * rms_n(leaves2) + 0.3 * rms_n(river) + 0.12 * rms_n(burble) + birds * 2.5
    return mix


@bed("amb_suryeon", "dry steppe wind, banner flaps, far war drums every ~12 s, crows")
def amb_suryeon(R):
    g1 = gust(R("g1"), 0.03, 0.2, depth=1.25)
    g2 = gust(R("g2"), 0.05, 0.28, depth=1.1)
    wind = pshape(R("wind"), [(60, -40), (120, -10), (320, 0), (800, -3), (1700, -9), (3200, -18), (6000, -34), (10000, -52)]) * (0.36 + 0.64 * g1**1.2)
    dust = pshape(R("dust"), [(1500, -40), (3000, -8), (5200, 0), (8000, -10), (12000, -32)]) * (0.15 + 0.85 * g1**2.2)
    # hollow whistle through the stalks: a narrow resonance whose pitch rides the gust
    wh_src = pshape(R("whs"), [(150, -30), (1500, 0), (6000, -30)])
    fc = 620 + 760 * g2
    whistle = csweep(wh_src, "bp", fc, 6.5) * (0.05 + 0.95 * g1**2.4)
    # banner flaps: irregular flutter that only wakes up in the strong gusts
    flut = np.maximum(0.0, 0.35 + 0.65 * pmod(R("fl"), 6, 17)) ** 1.6
    strong = np.maximum(0.0, g1 - 0.42) / 0.58
    flap_src = pshape(R("flap"), [(180, -30), (420, -4), (900, 0), (2200, -6), (4200, -26)])
    flap = flap_src * flut * strong**1.2
    # plus two or three distinct cloth snaps
    snaps = np.zeros(N)
    for i, t0 in enumerate((6.4, 19.8, 31.2, 42.6)):
        rr = R("snap", i)
        n = nsamp(rr.uniform(0.9, 1.7))
        tt = tvec(n)
        am = np.maximum(0.0, np.sin(TAU * rr.uniform(8.5, 12.5) * tt * (1 - 0.25 * tt / (n / SR)) + rr.uniform(0, 6))) ** 3
        sig = dsp.butter_bp(rr.standard_normal(n), 380, 2200, 2) * am * env_exp(n, 0.55, 0.01)
        put(snaps, sig, t0, rr.uniform(0.6, 1.0))
    # far war drums: a boom, then a weaker answer, every 12 s
    drums = np.zeros(N)
    for k in range(4):
        rr = R("drum", k)
        t0 = 3.0 + 12.0 * k
        log("drum", t0, 1.2, 50, 250)
        put(drums, war_drum(rr, 1.0), t0, 1.0)
        put(drums, war_drum(rr, 0.8), t0 + 0.64, 0.5)
        if k % 2 == 1:
            put(drums, war_drum(rr, 0.7), t0 + 1.08, 0.38)
    drums = lp(drums, 900, 2)
    drums = creverb(drums, "cave", wet=1.0, dry=0.45)
    drums = peak_to(drums, 5.0)  # far, but a clear low beat
    # crows
    crows = np.zeros(N)
    for i, (t0, count, f0) in enumerate(((8.0, 3, 560), (29.4, 4, 500), (43.0, 1, 600))):
        rr = R("crow", i)
        tc = lull(g1, t0, 2.5, 0.5 + 0.55 * count)
        log("crow", tc, 0.5 + 0.55 * count, 500, 3000)
        for j in range(count):
            put(crows, crow_caw(rr, f0 * rr.uniform(0.94, 1.06), rr.uniform(0.26, 0.36)), tc + j * rr.uniform(0.44, 0.58), rr.uniform(0.7, 1.0))
    crows = lp(crows, 4200, 2)
    crows = creverb(crows, "air", wet=1.0, dry=0.4)
    crows = peak_to(crows, 1.6)
    return 1.0 * rms_n(wind) + 0.3 * rms_n(dust) + 0.28 * rms_n(whistle) + 0.5 * rms_n(flap) + 0.22 * snaps / (np.abs(snaps).max() + 1e-9) + drums * 1.9 + crows * 9.5


@bed("amb_seori", "cold hollow wind, snow hiss, distant ice creaks, rare gusts")
def amb_seori(R):
    g1 = gust(R("g1"), 0.02, 0.1, depth=0.9)
    g2 = gust(R("g2"), 0.04, 0.2)
    # two rare gusts shape the whole bed
    genv = np.zeros(N)
    for t0, d in ((10.5, 6.2), (34.5, 5.6)):
        n = nsamp(d)
        put(genv, np.sin(np.pi * np.linspace(0, 1, n)) ** 2.2, t0, 1.0)
    cold = pshape(R("cold"), [(45, -36), (90, -8), (220, 0), (520, -5), (1100, -14), (2600, -28), (5000, -46)]) * (0.35 + 0.4 * g1 + 0.9 * genv)
    # hollow ice-valley whistle: pitch lifts with the gusts
    wsrc = pshape(R("whs"), [(150, -30), (1200, 0), (5000, -30)])
    fc = 330 + 340 * g2 + 760 * genv
    whistle = csweep(wsrc, "bp", fc, 8.0) * (0.12 + 0.55 * g1 + 1.2 * genv)
    gust_air = pshape(R("gair"), [(900, -40), (1800, -4), (3000, 0), (5200, -16), (8000, -40)]) * genv**1.4
    snow = pshape(R("snow"), [(3000, -40), (5500, -6), (8000, 0), (11500, -6), (15000, -30)]) * (0.55 + 0.25 * g2 + 0.5 * genv) * (0.85 + 0.15 * grain(R("snowg"), 3, 14, 0.6))
    # a faint glassy sheen from frozen branches
    sheen = np.zeros(N)
    for i, fz in enumerate((1860, 2490, 3110)):
        am = gust(R("sh", i), 0.05, 0.25, depth=1.4, bias=-0.3) ** 2
        sheen += np.sin(TAU * round(fz * T) / T * tvec(N) + R("shp", i).uniform(0, 6)) * am
    # distant ice creaks
    creaks = np.zeros(N)
    for i, (t0, d, fa, fb) in enumerate(((5.0, 1.8, 1250, 760), (17.6, 2.3, 820, 1180), (24.2, 1.5, 1400, 900), (30.0, 2.1, 760, 1050), (41.3, 2.6, 1100, 700))):
        rr = R("creak", i)
        log("creak", t0, d, int(min(fa, fb) * 0.8), int(max(fa, fb) * 1.2))
        put(creaks, ice_creak(rr, d, fa, fb), t0, rr.uniform(0.7, 1.0))
    creaks = lp(creaks, 3600, 2)
    creaks = creverb(creaks, "cave", wet=1.1, dry=0.35)
    creaks = peak_to(creaks, 3.2)
    # two deep ice settles
    booms = np.zeros(N)
    for i, t0 in enumerate((21.5, 45.4)):
        rr = R("boom", i)
        log("boom", t0, 1.5, 30, 120)
        put(booms, thump(74, 36, 1.7, 0.28, 0.5), t0, 1.0)
        put(booms, noise_hit(rr, 0.12, 300, 2600, 0.03, "pink"), t0, 0.22)
    booms = creverb(lp(booms, 420, 2), "cave", wet=0.8, dry=0.6)
    booms = peak_to(booms, 1.2)
    return 1.0 * rms_n(cold) + 0.5 * rms_n(whistle) + 0.22 * rms_n(gust_air) + 0.38 * rms_n(snow) + 0.06 * sheen + creaks * 3.4 + booms * 0.5


@bed("amb_daeryeol", "low rumble, lava bubbling, crackle, steam hiss")
def amb_daeryeol(R):
    act = np.exp(0.65 * np.clip(pmod(R("act"), 0.03, 0.25), -2.0, 2.0))  # ember activity: bubbling and crackle come in clusters
    wob = 0.72 + 0.28 * gust(R("wob"), 0.06, 0.4)
    rumble = pshape(R("rum"), [(26, -34), (45, -6), (75, 0), (125, -4), (240, -16), (480, -40)]) * wob
    # distant tremors
    tremor = np.zeros(N)
    for t0, d in ((13.8, 5.0), (38.0, 4.2)):
        put(tremor, np.sin(np.pi * np.linspace(0, 1, nsamp(d))) ** 2, t0, 1.0)
    rumble = rumble * (1.0 + 0.9 * tremor)
    # upper harmonics so a phone speaker still carries the rumble
    harm = bp(dsp.saturate(lp(rumble, 130, 2) * 1.6, 3.0), 140, 520, 2) * wob
    # bubbling: many small blups, a few fat ones
    bub = np.zeros(N)
    rr = R("bub")
    for t0 in times_from(rr, 150, act):
        put(bub, bubble(rr, float(np.exp(rr.uniform(np.log(95), np.log(280)))), rr.uniform(0.07, 0.16), rr.uniform(0.9, 1.7)), t0, float(np.exp(rr.uniform(np.log(0.14), np.log(0.6)))))
    for t0 in times_from(R("bubL"), 15, act):
        rl = R("bubL", int(t0 * 1000))
        put(bub, bubble(rl, float(np.exp(rl.uniform(np.log(52), np.log(100)))), rl.uniform(0.22, 0.38), rl.uniform(0.7, 1.3), tone=0.45), t0, rl.uniform(0.55, 1.0))
    bub = bp(bub, 60, 950, 2)
    bub = creverb(bub, "cave", wet=0.22, dry=1.0)
    # crackle (embers), band-limited below the click detector's 6 kHz, plus a few spits
    rc = R("crk")
    kern = np.exp(-np.arange(nsamp(0.02)) / (SR * 0.0022))
    crk = circ_conv(impulses(rc, int(20 * T), act, 0.8), kern)
    crk = bp(crk, 700, 4200, 2)
    spit = np.zeros(N)
    for i, t0 in enumerate(times_from(R("spt"), 22, act)):
        rs = R("spt", i)
        n = nsamp(0.07)
        ev = dsp.butter_lp(rs.standard_normal(n), 2600, 2) * env_exp(n, 0.011, 0.0008)
        ev = ev + 0.7 * thump(rs.uniform(130, 190), 70, 0.07, 0.02, 0.02)
        put(spit, ev, t0, rs.uniform(0.4, 1.0))
    spit = creverb(lp(spit, 3600, 2), "cave", wet=0.3, dry=1.0)
    # steam: breathy puffs on a thin constant hiss
    puffs = np.full(N, 0.16)
    for i, (t0, d) in enumerate(((2.0, 3.4), (9.6, 4.6), (17.0, 3.0), (24.4, 4.4), (31.0, 3.6), (38.3, 4.8), (44.6, 3.2))):
        puffs_ev = np.sin(np.pi * np.linspace(0, 1, nsamp(d))) ** 1.6
        put(puffs, puffs_ev, t0, 0.8)
    steam = pshape(R("stm"), [(1800, -40), (3000, -6), (5500, 0), (9500, -5), (13000, -22), (16000, -46)]) * puffs * (0.9 + 0.1 * grain(R("stmg"), 5, 30, 0.5))
    steam_lo = pshape(R("stml"), [(400, -40), (900, -4), (1500, 0), (2600, -6), (4000, -12), (6000, -30)]) * puffs**1.5
    # liquid slosh: the mid-range body of the lava, so the bed survives small speakers
    slosh = pshape(R("slo"), [(220, -34), (480, -3), (850, 0), (1500, -6), (2600, -20), (4500, -42)]) * grain(R("slog"), 2, 11, 0.8) * (act / act.mean())
    return 0.4 * rms_n(rumble) + 0.45 * rms_n(harm) + 0.34 * rms_n(slosh) + bub * 0.55 / (np.abs(bub).max() + 1e-9) * 4.5 + peak_to(crk, 1.4) * 0.9 + peak_to(spit, 2.0) * 0.6 + 0.3 * rms_n(steam) + 0.14 * rms_n(steam_lo)


# --------------------------------------------------------------------------- render
def render(bed_id: str, verbose: bool = False) -> tuple[np.ndarray, dict]:
    """Render one bed -> (mono float64 array of exactly N samples at TARGET_LUFS, info dict)."""
    d = BEDS[bed_id]
    _LOG.clear()
    R = lambda *k: rng_for("amb", bed_id, *k)  # noqa: E731
    x = np.asarray(d.fn(R), dtype=float)
    if x.shape != (N,) or not np.all(np.isfinite(x)):
        raise RuntimeError(f"{bed_id}: bad render {x.shape}")
    x = x - x.mean()
    x = hp(x, 30.0, 2)
    for _ in range(3):  # LUFS is not linear in the gate: iterate to the target
        l0 = dsp.lufs_integrated(x)
        x = x * dsp.db2lin(TARGET_LUFS - l0)
    info = dict(id=bed_id, samples=int(x.shape[0]), duration=x.shape[0] / SR, lufs=dsp.lufs_integrated(x), peak_db=float(dsp.lin2db(np.abs(x).max())),
                rms_db=float(dsp.lin2db(dsp.rms(x))), desc=d.desc, events=list(_LOG), wrap_sigma=closure_sigma(x))
    if info["wrap_sigma"] > 5.0:
        raise RuntimeError(f"{bed_id}: the bed is not N-periodic (wrap step = {info['wrap_sigma']:.1f} sigma)")
    return x, info


def closure_sigma(x) -> float:
    """Size of the step across the wrap in units of the std of all sample steps. A periodic bed gives a draw of the ordinary step
    distribution (< ~4); a bed with a real discontinuity at the seam gives tens."""
    return float(abs(x[0] - x[-1]) / (np.std(np.diff(x)) + 1e-12))


def main(argv=None):
    import argparse
    import json
    import time

    from .build import WAV_DIR, _write_wav

    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None)
    a = ap.parse_args(argv)
    out = WAV_DIR / "ambience"
    for bid in BEDS:
        if a.only and a.only not in bid:
            continue
        t = time.time()
        x, info = render(bid)
        _write_wav(out / f"{bid}.wav", x)
        (out / f"{bid}.json").write_text(json.dumps(info, indent=1))
        print(f"{bid:16s} {info['duration']:.2f}s LUFS {info['lufs']:.2f} peak {info['peak_db']:.1f} dBFS  ({time.time() - t:.1f}s)")


if __name__ == "__main__":
    main()

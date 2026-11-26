"""Instrument models: plucked strings (Karplus-Strong), breathy flute, bowed strings, pads/brass, drums, gongs, bells.

Every function returns a mono float64 array unless documented otherwise. All are deterministic given ``rng``.
"""
from __future__ import annotations

import numpy as np
from scipy import signal as sps

from . import dsp
from .dsp import SR, NYQ, TAU, nsamp, tvec, osc, lp, hp, bp, filt, env, white, pink, db2lin


# --------------------------------------------------------------------------- generic helpers
def modal(freqs, amps, t60s, dur, rng=None, split_hz=0.0, rise=None, phases="rand", attack=0.0003, glide=None):
    """Modal (additive, exponentially decaying) synthesis. t60s: seconds to -60 dB per mode.
    split_hz: detune each mode into a beating pair. rise: per-mode attack time constants (soft blooms).
    glide: (ratio_start, tau) every mode starts at ratio_start*f and falls to f with time constant tau."""
    rng = rng or np.random.default_rng(3)
    n = nsamp(dur)
    t = tvec(n)
    out = np.zeros(n)
    for i, (f, a, d) in enumerate(zip(freqs, amps, t60s)):
        if f >= NYQ * 0.95 or a == 0:
            continue
        ph0 = rng.uniform(0, TAU) if phases == "rand" else 0.0
        e = 10.0 ** (-3.0 * t / max(d, 1e-3))
        if rise is not None:
            e = e * (1 - np.exp(-t / max(rise[i], 1e-4)))
        else:
            e = e * np.minimum(1.0, t / attack) if attack > 0 else e
        if glide is not None:
            fi = f * (1 + (glide[0] - 1) * np.exp(-t / glide[1]))
            ph = TAU * np.cumsum(fi) / SR + ph0
        else:
            ph = TAU * f * t + ph0
        if split_hz > 0:
            sp = split_hz * (0.5 + rng.uniform(0, 1))
            s = 0.5 * (np.sin(ph) + np.sin(ph + TAU * sp * t + rng.uniform(0, TAU)))
        else:
            s = np.sin(ph)
        out += a * s * e
    return dsp.fade(out, 0.0, min(0.04, dur * 0.25))


def _tail_fade(x, ms=12.0):
    return dsp.fade(x, 0.0, ms / 1000.0)


# --------------------------------------------------------------------------- plucked strings
BODY_PRESETS = {
    "gayageum": [("ls", 140, 0.7, 3.0), ("peak", 270, 1.8, 4.5), ("peak", 620, 1.5, 2.0), ("peak", 1900, 1.2, 1.5), ("hs", 7000, 0.7, -3.0)],
    "guzheng": [("ls", 120, 0.7, 1.5), ("peak", 480, 1.6, 3.5), ("peak", 1500, 1.2, 2.0), ("peak", 3600, 1.0, 2.5), ("hs", 9000, 0.7, -2.0)],
    "harp": [("ls", 100, 0.7, 2.0), ("peak", 350, 1.4, 2.5), ("hs", 8000, 0.7, -2.5)],
    "bass": [("ls", 90, 0.7, 3.0), ("peak", 180, 1.6, 3.5), ("hs", 3000, 0.7, -6.0)],
    "lute": [("peak", 240, 1.8, 3.5), ("peak", 900, 1.2, 2.5), ("hs", 6000, 0.7, -4.0)],
    "none": [],
}


def apply_body(x, body: str):
    for kind, fc, q, g in BODY_PRESETS[body]:
        x = dsp.filt(x, kind, fc, q, g)
    return x


def _ks_core(f0: float, n: int, exc: np.ndarray, t60: float, damp: float) -> np.ndarray:
    """Block-vectorised Karplus-Strong loop: y[i] = x[i] + g * (taps . y[i-N-j])."""
    D = SR / f0
    N = int(np.floor(D)) - 1
    frac = D - np.floor(D)
    N = max(N, 2)
    taps = np.convolve([damp, 1 - 2 * damp, damp], [1 - frac, frac])  # lags N..N+3
    g = 10.0 ** (-3.0 / (t60 * f0))
    g = min(g, 0.99995)
    y = np.zeros(n + N + 8)
    off = N + 4  # leading zeros so negative lags read 0
    ex = exc[:N] if len(exc) >= N else np.pad(exc, (0, N - len(exc)))
    y[off : off + N] = ex
    t0, t1, t2, t3 = taps * g
    pos = off + N
    end = off + n
    while pos < end:
        m = min(N, end - pos)
        y[pos : pos + m] = (
            t0 * y[pos - N : pos - N + m]
            + t1 * y[pos - N - 1 : pos - N - 1 + m]
            + t2 * y[pos - N - 2 : pos - N - 2 + m]
            + t3 * y[pos - N - 3 : pos - N - 3 + m]
        )
        pos += m
    return y[off : off + n]


def pluck(freq: float, dur: float, vel: float = 0.8, t60: float = 3.0, bright: float = 0.55, pick: float = 0.17, damp: float = 0.12,
          noise_mix: float = 0.35, bend=None, vib_depth: float = 0.0, vib_rate: float = 5.8, vib_delay: float = 0.25, body: str = "gayageum",
          rng=None, click: float = 0.35, sat: float = 1.2) -> np.ndarray:
    """Karplus-Strong plucked string. bend: list of (t, semitones) breakpoints (pitch offset curve, linear in time; offsets
    are relative to `freq`, e.g. [(0,-1.5),(0.18,0)] = struck flat then pushed up to pitch -- gayageum/guzheng 'sigimsae')."""
    rng = rng or np.random.default_rng(9)
    n_out = nsamp(dur)
    ratio = None
    if bend or vib_depth > 0:
        t = tvec(n_out)
        semis = np.zeros(n_out)
        if bend:
            ts = [p[0] for p in bend]
            vs = [p[1] for p in bend]
            semis += np.interp(t, ts, vs)
        if vib_depth > 0:
            on = np.clip((t - vib_delay) / 0.4, 0, 1)
            semis += (vib_depth / 100.0) * on * np.sin(TAU * vib_rate * t)
        ratio = 2.0 ** (semis / 12.0)
    n_render = n_out if ratio is None else int(n_out * (ratio.max() + 0.05) + 64)
    D = SR / freq
    N = max(int(np.floor(D)) - 1, 2)
    # excitation: displaced-string triangle blended with filtered noise
    p = max(2, int(pick * N))
    tri = np.concatenate([np.linspace(0, 1, p), np.linspace(1, 0, max(N - p, 2))])[:N]
    tri -= tri.mean()
    tri /= np.abs(tri).max()
    nz = rng.uniform(-1, 1, N)
    bright_eff = np.clip(bright * (0.55 + 0.6 * vel), 0.02, 1.0)
    c = 0.97 * (1 - bright_eff)
    nz = sps.lfilter([1 - c], [1, -c], nz)
    nz /= np.abs(nz).max() + 1e-9
    exc = (1 - noise_mix) * tri + noise_mix * nz
    comb_d = max(1, int(pick * N * 0.5))
    exc = exc - 0.6 * np.concatenate([np.zeros(comb_d), exc[:-comb_d]])
    exc /= np.abs(exc).max() + 1e-9
    exc *= 0.4 + 0.9 * vel
    y = _ks_core(freq, n_render, exc, t60, damp)
    if click > 0:
        nclk = nsamp(0.006)
        ck = dsp.bp(rng.standard_normal(nclk), min(3500 * (0.6 + vel), 9000), 0.8) * np.exp(-np.arange(nclk) / (SR * 0.0012))
        y[:nclk] += click * vel * 0.5 * ck * (np.abs(exc).max())
    if ratio is not None:
        y = dsp.resample_curve(y, ratio)
        y = dsp.pad_to(y, n_out)
    y = apply_body(y, body)
    if sat > 0:
        y = dsp.saturate(y, sat) if np.abs(y).max() > 0 else y
    return _tail_fade(y, 25.0)


def strum(freqs, dur, spread=0.035, vels=None, rng=None, **kw):
    """Rolled chord (harp-like), returns mono. spread: seconds between strings."""
    rng = rng or np.random.default_rng(2)
    n = nsamp(dur + spread * len(freqs))
    out = np.zeros(n)
    for i, f in enumerate(freqs):
        v = (vels[i] if vels else 0.7) * rng.uniform(0.88, 1.0)
        s = pluck(f, dur, vel=v, rng=rng, **kw)
        dsp.mix_into(out, s, nsamp(i * spread))
    return out


# --------------------------------------------------------------------------- wind (daegeum-like breathy flute)
def flute(freq: float, dur: float, vel: float = 0.7, vib_rate: float = 5.1, vib_depth: float = 14.0, vib_delay: float = 0.28,
          breath: float = 0.32, buzz: float = 0.25, scoop: float = 0.4, glide_from: float | None = None, glide_t: float = 0.09,
          attack: float = 0.06, release: float = 0.16, tone: float = 1.0, rng=None, overblow: float = 0.0, pitch_curve=None, contour: float = 0.14) -> np.ndarray:
    """Breathy bamboo flute: harmonic tone + band-limited breath noise + membrane buzz, delayed vibrato, onset chiff.
    pitch_curve: optional per-sample multiplier array (len must equal output length) for ornaments."""
    rng = rng or np.random.default_rng(4)
    n = nsamp(dur + release)
    t = tvec(n)
    f = np.full(n, float(freq))
    if glide_from is not None:
        f = dsp.glide_curve(n, glide_from, freq, glide_t, 0.6)
    # onset scoop: starts flat then rises into pitch
    f = f * 2.0 ** (-scoop * 0.4 * np.exp(-t / 0.05) / 12.0 * 1.0)
    f = f * dsp.vib(n, vib_rate, vib_depth, vib_delay, 0.35, rng, jitter=0.18)
    f = f * (1 + 0.0015 * dsp.smooth_noise(n, rng, 3.0))  # breath instability
    if pitch_curve is not None:
        f = f * dsp.pad_to(np.asarray(pitch_curve), n)
    ph = dsp.phase_of(f)
    # amplitude env: soft attack, light wander
    a_env = dsp.adsr(dur, attack, 0.08, 0.85, release, a_curve=0.8)
    a_env = dsp.pad_to(a_env, n)
    a_env = a_env * (1 + 0.07 * dsp.smooth_noise(n, rng, 4.0))
    if contour > 0:  # phrasing hump: gentle swell towards ~40% of the note, then ease off
        u = np.clip(t / max(dur, 1e-3), 0, 1)
        a_env = a_env * (1 - contour + contour * np.sin(np.pi * u ** 0.7) ** 0.8)
    # harmonic series (flute: strong fundamental, 2nd, weaker upper); `tone` brightens
    hmax = int(min(14, NYQ * 0.9 // max(freq * 1.05, 1)))
    amps = np.array([1.0, 0.62, 0.30, 0.17, 0.10, 0.06, 0.04, 0.03, 0.02, 0.015, 0.01, 0.008, 0.006, 0.005])[:hmax]
    k = np.arange(1, hmax + 1)
    amps = amps * (tone ** (k - 1)) * (1 + 0.8 * vel * (k > 1) * 0.3)
    # overblown register: reduce fundamental
    if overblow > 0:
        amps[0] *= (1 - 0.6 * overblow)
        if hmax > 1:
            amps[1] *= 1 + 0.5 * overblow
    tone_sig = np.zeros(n)
    for hi, a in enumerate(amps):
        tone_sig += a * np.sin(TAU * (hi + 1) * ph + hi * 0.3)
    tone_sig /= amps.sum() * 0.55
    # membrane buzz (daegeum 'cheong'): random-amplitude upper harmonics
    if buzz > 0:
        mod = 0.5 + 0.5 * dsp.smooth_noise(n, rng, 160.0) / 1.0
        hb = np.zeros(n)
        for hi in range(5, min(hmax, 12)):
            hb += np.sin(TAU * (hi + 1) * ph + rng.uniform(0, 6.28)) / (hi + 1)
        tone_sig += buzz * 1.6 * hb * mod
    # breath noise: concentrated around the harmonics
    nz = rng.standard_normal(n)
    nz1 = dsp.bp(nz, min(freq * 3.2, 9000), 1.4)
    nz2 = dsp.bp(nz, min(freq * 1.5, 6000), 1.1)
    nz = dsp.lp((nz1 + 0.6 * nz2) * (0.55 + 0.45 * vel), 7500, 0.7, order=2)
    breath_env = a_env * (0.5 + 0.5 * np.exp(-t / 0.12))
    sig = tone_sig * a_env + nz * breath_env * breath * 0.55
    # chiff at onset
    nc = nsamp(0.045)
    chiff = dsp.bp(rng.standard_normal(nc), min(freq * 4.5, 9000), 1.0) * np.exp(-np.arange(nc) / (SR * 0.012))
    sig[:nc] += chiff * 0.4 * vel * (0.5 + breath)
    sig = dsp.hp(sig, 90.0)
    sig = dsp.peakeq(sig, 1100, 1.0, 2.0)
    return dsp.fade(sig, 0.002, 0.02) * (0.55 + 0.45 * vel) * 0.8


# --------------------------------------------------------------------------- bowed strings
def bowed(freq: float, dur: float, vel: float = 0.7, kind: str = "haegeum", vib_rate: float = 5.6, vib_depth: float = 18.0,
          vib_delay: float = 0.2, attack: float = 0.09, release: float = 0.18, glide_from: float | None = None, glide_t: float = 0.10,
          rng=None, bow_noise: float = 0.18, voices: int = 1, pitch_curve=None, scratch: float = 0.0) -> np.ndarray:
    """Bowed string: stick-slip sawtooth through body resonances. kind: haegeum (nasal, thin) | cello | bass | viola."""
    rng = rng or np.random.default_rng(6)
    n = nsamp(dur + release)
    t = tvec(n)
    f = np.full(n, float(freq))
    if glide_from is not None:
        f = dsp.glide_curve(n, glide_from, freq, glide_t, 0.55)
    f = f * dsp.vib(n, vib_rate, vib_depth, vib_delay, 0.4, rng, jitter=0.2)
    f = f * (1 + 0.0012 * dsp.smooth_noise(n, rng, 5.0))
    if pitch_curve is not None:
        f = f * dsp.pad_to(np.asarray(pitch_curve), n)
    spread = {"haegeum": 6.0, "cello": 7.0, "bass": 8.0, "viola": 8.0}.get(kind, 6.0)
    y = np.zeros(n)
    nv = max(1, voices)
    for v in range(nv):
        det = 0.0 if nv == 1 else (v / (nv - 1) * 2 - 1) * spread
        ph0 = rng.uniform()
        y += osc("saw", f * 2 ** (det / 1200.0), n, ph0)
    y /= np.sqrt(nv)
    a_env = dsp.pad_to(dsp.adsr(dur, attack, 0.12, 0.88, release, a_curve=0.9), n)
    a_env = a_env * (1 + 0.05 * dsp.smooth_noise(n, rng, 6.0))
    # bow-pressure brightness: opens with velocity, a little more at onset
    cutoff = np.clip((1100 if kind in ("cello", "bass") else 2200) * (0.7 + 0.9 * vel) * (1 + 0.5 * np.exp(-t / 0.25)), 300, 9000)
    if kind == "bass":
        cutoff = cutoff * 0.55
    y = dsp.sweep_filter(y, "lp", cutoff, 0.9, hop=64)
    if kind == "haegeum":
        y = dsp.peakeq(y, 1250, 2.2, 6.0)  # nasal coconut-resonator formants
        y = dsp.peakeq(y, 2500, 2.0, 4.0)
        y = dsp.peakeq(y, 520, 1.5, 2.0)
        y = dsp.hp(y, 160)
    elif kind in ("cello", "viola"):
        y = dsp.peakeq(y, 240, 2.0, 4.0)
        y = dsp.peakeq(y, 560, 2.0, 3.5)
        y = dsp.peakeq(y, 1500, 1.5, 2.5)
    elif kind == "bass":
        y = dsp.peakeq(y, 110, 1.6, 4.0)
        y = dsp.peakeq(y, 300, 1.6, 2.0)
    # bow noise (rosin hiss)
    nz = dsp.hp(rng.standard_normal(n), 1500) * 0.3
    nz = dsp.lp(nz, 7000)
    y = y + nz * bow_noise * 0.35 * (0.4 + vel)
    if scratch > 0:
        nsc = nsamp(0.09)
        y[:nsc] += dsp.bp(rng.standard_normal(nsc), 2200, 1.0) * scratch * np.exp(-np.arange(nsc) / (SR * 0.03)) * 0.5
    y = y * a_env
    return dsp.fade(y, 0.002, 0.02) * (0.5 + 0.5 * vel) * 0.55


# --------------------------------------------------------------------------- pads / brass / choir
def pad(freqs, dur: float, kind: str = "strings", vel: float = 0.7, attack: float = 0.8, release: float = 1.2, rng=None,
        cutoff_open: float = 2200.0, cutoff_closed: float = 500.0, voices: int = 5, spread: float = 11.0, motion: float = 0.5) -> np.ndarray:
    """Chord pad. freqs: list of note frequencies. kind: strings | warm | brass | dark | glass | choir | organ.
    Returns stereo (2, n)."""
    rng = rng or np.random.default_rng(7)
    n = nsamp(dur + release)
    t = tvec(n)
    out = np.zeros((2, n))
    for fi, f in enumerate(freqs):
        pan_p = (fi / max(1, len(freqs) - 1) * 2 - 1) * 0.45 if len(freqs) > 1 else 0.0
        v = np.zeros((2, n))
        if kind in ("strings", "warm", "dark", "brass"):
            wob = 1 + 0.0012 * dsp.smooth_noise(n, rng, 0.35) * motion
            sp = spread * (1.5 if kind == "brass" else 1.0)
            v = dsp.supersaw(f * wob, n, voices=voices, spread_cents=sp, rng=rng, stereo=True)
            if kind == "warm":
                v = v * 0.7 + 0.3 * np.stack([osc("tri", f, n)] * 2)
        elif kind == "organ":
            m = np.zeros(n)
            for h, a in zip([1, 2, 3, 4, 6, 8], [1, 0.7, 0.5, 0.35, 0.2, 0.12]):
                if f * h < NYQ * 0.9:
                    m += a * np.sin(TAU * h * f * t + rng.uniform(0, 6))
            v = np.stack([m, m]) * 0.5
        elif kind == "glass":
            m = np.zeros(n)
            for h, a in zip([1, 2, 3, 4.01, 5.02, 6.03], [1, 0.5, 0.35, 0.2, 0.12, 0.08]):
                if f * h < NYQ * 0.9:
                    wob = 1 + 0.003 * dsp.smooth_noise(n, rng, 0.5)
                    m += a * np.sin(TAU * np.cumsum(f * h * wob) / SR + rng.uniform(0, 6)) * (0.6 + 0.4 * np.sin(TAU * rng.uniform(0.2, 0.7) * t + rng.uniform(0, 6)))
            v = np.stack([m, m]) * 0.5
        elif kind == "choir":
            m = dsp.supersaw(f * (1 + 0.003 * dsp.smooth_noise(n, rng, 0.5)) * dsp.vib(n, 5.0, 12, 0.3, 0.8, rng, 0.3), n, voices=4, spread_cents=14, rng=rng)
            vowel = rng.choice(["a", "o", "u"])
            m = vowel_filter(m, vowel)
            v = np.stack([m, m])
        # filter envelope
        a_env = dsp.pad_to(dsp.adsr(dur, attack, 0.3, 0.9, release, a_curve=1.1), n)
        if kind != "organ" and kind != "glass" and kind != "choir":
            co_env = cutoff_closed + (cutoff_open - cutoff_closed) * np.clip(a_env, 0, 1) ** 1.3 * (0.6 + 0.4 * vel)
            vm = np.stack([dsp.sweep_filter(v[0], "lp", co_env, 0.7, hop=128), dsp.sweep_filter(v[1], "lp", co_env, 0.7, hop=128)])
        else:
            vm = v
        if kind == "brass":
            vm = np.stack([dsp.peakeq(vm[0], 700, 1.2, 3.5), dsp.peakeq(vm[1], 700, 1.2, 3.5)])
        l, r = dsp.pan_gains(pan_p)
        out[0] += vm[0] * a_env * (l + 0.5)
        out[1] += vm[1] * a_env * (r + 0.5)
    out /= np.sqrt(max(1, len(freqs))) * 1.5
    return out * (0.4 + 0.6 * vel)


_VOWELS = {
    "a": ([800, 1150, 2900], [90, 110, 170], [1.0, 0.6, 0.25]),
    "o": ([450, 800, 2830], [70, 80, 130], [1.0, 0.55, 0.15]),
    "u": ([325, 700, 2530], [60, 70, 110], [1.0, 0.4, 0.1]),
    "e": ([400, 1600, 2700], [70, 100, 150], [1.0, 0.5, 0.2]),
    "i": ([270, 2140, 2950], [60, 90, 150], [1.0, 0.4, 0.2]),
    "ae": ([660, 1720, 2410], [80, 100, 140], [1.0, 0.5, 0.2]),
    "uh": ([520, 1190, 2390], [80, 100, 140], [1.0, 0.5, 0.2]),
}


def vowel_filter(x, vowel: str = "a", shift: float = 1.0):
    fs, bws, gs = _VOWELS[vowel]
    out = np.zeros_like(x)
    for f, bw, g in zip(fs, bws, gs):
        out += g * dsp.bp(x, f * shift, f * shift / bw)
    return out * 1.2


def brass_note(freq: float, dur: float, vel: float = 0.8, attack: float = 0.06, release: float = 0.2, rng=None, vib_depth: float = 8.0,
               bright: float = 1.0, growl: float = 0.0, glide_from: float | None = None, mute: float = 0.0) -> np.ndarray:
    """Monophonic brass/horn-like note (saw stack through swelling lowpass + formants). Returns mono."""
    rng = rng or np.random.default_rng(8)
    n = nsamp(dur + release)
    t = tvec(n)
    f = np.full(n, float(freq))
    if glide_from is not None:
        f = dsp.glide_curve(n, glide_from, freq, 0.12, 0.6)
    f = f * dsp.vib(n, 5.2, vib_depth, 0.35, 0.5, rng, 0.2)
    y = np.zeros(n)
    for d in (-5, 0, 6):
        y += osc("saw", f * 2 ** (d / 1200.0), n, rng.uniform())
    y /= 3
    if growl > 0:
        y *= 1 - growl * 0.5 * (1 + np.sin(TAU * 52 * t))
    a_env = dsp.pad_to(dsp.adsr(dur, attack, 0.12, 0.85, release, a_curve=1.3), n)
    co = (300 + 3500 * bright * (0.35 + 0.65 * vel) * np.clip(a_env, 0, 1) ** 1.5) * (1 + 0.15 * np.exp(-t / 0.08))
    y = dsp.sweep_filter(y, "lp", co, 1.0, hop=64)
    y = dsp.peakeq(y, 520, 1.3, 4.0)
    y = dsp.peakeq(y, 1250, 1.2, 3.0)
    y = dsp.hp(y, 70)
    if mute > 0:
        y = dsp.bp(y, 1400, 0.8) * mute + y * (1 - mute)
    y = dsp.saturate(y * 1.3, 1.0)
    return dsp.fade(y * a_env, 0.001, 0.02) * (0.5 + 0.5 * vel) * 0.7


def sub_bass(freq: float, dur: float, vel: float = 0.8, attack: float = 0.01, release: float = 0.12, drive: float = 1.3, harm: float = 0.25, glide_from=None, rng=None) -> np.ndarray:
    n = nsamp(dur + release)
    f = np.full(n, float(freq)) if glide_from is None else dsp.glide_curve(n, glide_from, freq, 0.06, 0.6)
    ph = dsp.phase_of(f)
    y = np.sin(TAU * ph) + harm * np.sin(TAU * 2 * ph + 0.4) + harm * 0.4 * np.sin(TAU * 3 * ph)
    a = dsp.pad_to(dsp.adsr(dur, attack, 0.1, 0.8, release), n)
    y = dsp.saturate(y * 0.7, drive) * a
    return dsp.fade(y, 0.001, 0.015) * (0.5 + 0.5 * vel)


# --------------------------------------------------------------------------- drums
def _env_exp(n, tau):
    return np.exp(-np.arange(n) / (SR * tau))


def _membrane(f, dur, ratios, amps, t60s, drop=0.35, drop_tau=0.025, rng=None, size=1.0):
    n = nsamp(dur)
    t = tvec(n)
    out = np.zeros(n)
    rng = rng or np.random.default_rng(1)
    for r, a, d in zip(ratios, amps, t60s):
        fi = f * r * (1 + drop * np.exp(-t / drop_tau))
        ph = TAU * np.cumsum(fi) / SR + rng.uniform(0, TAU)
        out += a * np.sin(ph) * 10 ** (-3 * t / (d * size))
    return out


def taiko(freq: float = 82.0, vel: float = 0.9, dur: float = 1.4, size: float = 1.0, rng=None, rim: float = 0.0, tight: float = 0.0) -> np.ndarray:
    """Large Japanese/Korean-style low drum: pitch-dropping membrane modes + stick attack + sub thump."""
    rng = rng or np.random.default_rng(10)
    n = nsamp(dur)
    ratios = [1.0, 1.593, 2.136, 2.296, 2.653, 2.918]
    amps = [1.0, 0.55, 0.32, 0.26, 0.16, 0.12]
    t60s = [0.55, 0.32, 0.22, 0.2, 0.15, 0.12]
    body = _membrane(freq, dur, ratios, amps, t60s, drop=0.55 * (0.6 + 0.4 * vel), drop_tau=0.03, rng=rng, size=size * (1 - 0.5 * tight))
    sub = np.sin(TAU * np.cumsum(freq * 0.5 * (1 + 0.45 * np.exp(-tvec(n) / 0.04))) / SR) * _env_exp(n, 0.2 * size * (1 - 0.4 * tight))
    # stick / skin attack
    na = nsamp(0.06)
    nz = rng.standard_normal(na)
    atk = dsp.lp(dsp.bp(nz, 1700 * (0.7 + 0.5 * vel), 0.9), 5500) * _env_exp(na, 0.007)
    atk += dsp.lp(nz, 600) * _env_exp(na, 0.02) * 0.7
    atk *= 0.55
    thump = np.zeros(n)
    thump[:na] = atk
    y = body * 0.9 + sub * 0.9 * (0.5 + 0.5 * vel) + thump * (0.5 + 1.1 * vel)
    if rim > 0:  # rim/kara hit (wood click)
        rm = modal([900, 1650, 2700], [1, 0.6, 0.4], [0.03, 0.02, 0.015], 0.1, rng)
        dsp.mix_into(y, rm, 0, rim)
    y = dsp.peakeq(y, 210, 1.0, 3.0)
    y = dsp.saturate(y * 1.4, 1.2)
    y = dsp.hp(y, 28, 0.7)
    return dsp.fade(y, 0.0004, 0.05) * (0.45 + 0.55 * vel) * 0.8


def buk(freq: float = 118.0, vel: float = 0.8, dur: float = 0.55, rng=None) -> np.ndarray:
    """Korean barrel drum: shorter, drier mid-low thud."""
    rng = rng or np.random.default_rng(11)
    n = nsamp(dur)
    body = _membrane(freq, dur, [1.0, 1.6, 2.2, 2.9], [1.0, 0.45, 0.25, 0.15], [0.22, 0.13, 0.09, 0.07], drop=0.5, drop_tau=0.02, rng=rng)
    na = nsamp(0.04)
    atk = dsp.bp(rng.standard_normal(na), 1400, 0.8) * _env_exp(na, 0.006)
    atk += dsp.lp(rng.standard_normal(na), 450) * _env_exp(na, 0.012)
    y = body
    dsp.mix_into(y, atk, 0, 0.9 * (0.4 + vel))
    y = dsp.peakeq(y, 180, 1.2, 3.0)
    y = dsp.saturate(y * 1.3, 1.0)
    y = dsp.hp(y, 40)
    return dsp.fade(y, 0.0004, 0.03) * (0.45 + 0.55 * vel) * 0.85


def janggu_low(vel=0.8, dur=0.7, rng=None):
    """'Kung' stroke of the hourglass drum (large head, mallet): soft, boomy."""
    rng = rng or np.random.default_rng(12)
    n = nsamp(dur)
    body = _membrane(96.0, dur, [1.0, 1.5, 2.1], [1.0, 0.4, 0.2], [0.45, 0.2, 0.12], drop=0.3, drop_tau=0.04, rng=rng)
    na = nsamp(0.03)
    atk = dsp.lp(rng.standard_normal(na), 700) * _env_exp(na, 0.008)
    dsp.mix_into(body, atk, 0, 0.7 * vel)
    y = dsp.peakeq(body, 150, 1.0, 3.0)
    return dsp.fade(dsp.saturate(y * 1.2, 1.0), 0.0005, 0.05) * (0.45 + 0.55 * vel) * 0.8


def janggu_high(vel=0.8, dur=0.35, rng=None, stick="deok"):
    """'Deok'/'tta' stroke on the small head with bamboo stick: dry, bright, crisp."""
    rng = rng or np.random.default_rng(13)
    n = nsamp(dur)
    base = 310.0 if stick == "deok" else 420.0
    body = _membrane(base, dur, [1.0, 1.52, 2.38, 3.1], [1.0, 0.55, 0.35, 0.2], [0.11, 0.07, 0.05, 0.04], drop=0.12, drop_tau=0.01, rng=rng)
    na = nsamp(0.03)
    atk = dsp.bp(rng.standard_normal(na), 3200, 0.7) * _env_exp(na, 0.003)
    dsp.mix_into(body, atk, 0, 0.9 * (0.4 + vel))
    y = dsp.peakeq(body, 900, 1.2, 3.0)
    return dsp.fade(y, 0.0003, 0.02) * (0.4 + 0.6 * vel) * 0.8


def frame_drum(freq: float = 175.0, vel: float = 0.7, dur: float = 0.5, slap: float = 0.5, jingle: float = 0.5, rng=None) -> np.ndarray:
    rng = rng or np.random.default_rng(14)
    n = nsamp(dur)
    body = _membrane(freq, dur, [1.0, 1.7, 2.3], [1.0, 0.4, 0.2], [0.2, 0.1, 0.07], drop=0.35, drop_tau=0.015, rng=rng)
    na = nsamp(0.05)
    sl = dsp.bp(rng.standard_normal(na), 1100, 0.9) * _env_exp(na, 0.01) * slap
    dsp.mix_into(body, sl, 0, 0.8)
    if jingle > 0:
        nj = nsamp(0.18)
        jg = modal(rng.uniform(5200, 9800, 6), rng.uniform(0.3, 1, 6), rng.uniform(0.06, 0.15, 6), 0.2, rng)
        dsp.mix_into(body, dsp.hp(jg, 4000), 0, jingle * 0.22 * vel)
    y = dsp.hp(body, 45)
    return dsp.fade(dsp.saturate(y, 1.0), 0.0004, 0.03) * (0.4 + 0.6 * vel) * 0.8


def rim_click(vel=0.7, pitch=1.0, rng=None):
    rng = rng or np.random.default_rng(15)
    y = modal([820 * pitch, 1630 * pitch, 2540 * pitch, 3700 * pitch], [1, 0.8, 0.55, 0.3], [0.04, 0.03, 0.02, 0.015], 0.12, rng)
    na = nsamp(0.01)
    c = dsp.hp(rng.standard_normal(na), 2500) * _env_exp(na, 0.0015)
    dsp.mix_into(y, c, 0, 0.8)
    return dsp.fade(y, 0.0002, 0.015) * (0.3 + 0.7 * vel) * 0.7


def moktak(vel=0.7, pitch=1.0, rng=None):
    """Wooden temple block (hollow, rounded)."""
    rng = rng or np.random.default_rng(16)
    y = modal([640 * pitch, 1390 * pitch, 2260 * pitch, 3300 * pitch], [1, 0.55, 0.3, 0.12], [0.09, 0.05, 0.035, 0.02], 0.2, rng, glide=(1.06, 0.01))
    na = nsamp(0.008)
    dsp.mix_into(y, dsp.bp(rng.standard_normal(na), 2200, 1.0) * _env_exp(na, 0.002), 0, 0.5)
    return dsp.fade(y, 0.0002, 0.02) * (0.3 + 0.7 * vel) * 0.8


def shaker(vel=0.6, dur=0.12, rng=None, bright=1.0):
    rng = rng or np.random.default_rng(17)
    n = nsamp(dur)
    nz = dsp.hp(rng.standard_normal(n), 4500 * bright)
    e = np.minimum(1, np.arange(n) / (SR * 0.012)) * _env_exp(n, dur * 0.35)
    return dsp.fade(nz * e, 0.0, dur * 0.3) * (0.2 + 0.4 * vel)


def gong(freq: float = 190.0, dur: float = 6.0, vel: float = 0.8, rng=None, wash: float = 0.5, bloom: float = 0.35) -> np.ndarray:
    """Jing/tam-tam like gong: inharmonic modes with beating pairs and blooming upper modes (non-linear swell)."""
    rng = rng or np.random.default_rng(18)
    ratios = np.array([0.5, 1.0, 1.51, 2.04, 2.63, 3.21, 3.97, 4.62, 5.43, 6.31, 7.4, 8.9])
    amps = np.array([0.5, 1.0, 0.8, 0.6, 0.5, 0.4, 0.33, 0.27, 0.2, 0.16, 0.12, 0.08])
    t60s = np.array([5.2, 6.0, 4.4, 3.8, 3.1, 2.6, 2.2, 1.8, 1.4, 1.1, 0.8, 0.6]) * (dur / 6.0) ** 0.35
    rises = (0.01 + bloom * np.arange(len(ratios)) / len(ratios) * 0.9) * np.array([0.1, 0.2, 0.5, 0.8, 1.0, 1.2, 1.5, 1.6, 1.8, 1.8, 1.8, 1.8])
    y = modal(freq * ratios, amps * (0.6 + 0.4 * vel), t60s, dur, rng, split_hz=1.6, rise=rises)
    if wash > 0:
        n = nsamp(dur)
        t = tvec(n)
        w = dsp.bp(rng.standard_normal(n), freq * 3.4, 0.6)
        w = w * (1 - np.exp(-t / 0.35)) * 10 ** (-3 * t / (dur * 0.7))
        y += w * wash * 0.35
    n = len(y)
    na = nsamp(0.03)
    y[:na] += dsp.bp(rng.standard_normal(na), 900, 0.8) * _env_exp(na, 0.006) * 0.5 * vel
    y = dsp.hp(y, 40)
    return dsp.fade(y, 0.0004, 0.4) * 0.7


def bell(freq: float = 440.0, dur: float = 4.0, vel: float = 0.8, kind: str = "temple", rng=None, brightness: float = 1.0) -> np.ndarray:
    """Struck bell. kind: temple (low, hummy, long) | hand (small bright) | glass (FM-ish crystal) | chime (thin metal tube)."""
    rng = rng or np.random.default_rng(19)
    if kind == "temple":
        ratios = [0.5, 1.0, 1.183, 1.506, 2.0, 2.514, 2.662, 3.01, 4.166, 5.433, 6.796]
        amps = [0.7, 1.0, 0.7, 0.55, 0.5, 0.35, 0.3, 0.25, 0.15, 0.1, 0.06]
        t60 = [dur * 1.0, dur * 0.95, dur * 0.7, dur * 0.6, dur * 0.5, dur * 0.4, dur * 0.35, dur * 0.3, dur * 0.2, dur * 0.12, dur * 0.08]
        y = modal(np.array(ratios) * freq, np.array(amps) * np.where(np.arange(len(amps)) > 3, brightness, 1), t60, dur, rng, split_hz=0.8)
        na = nsamp(0.02)
        y[:na] += dsp.bp(rng.standard_normal(na), freq * 3, 1.0) * _env_exp(na, 0.004) * 0.4 * vel
    elif kind == "hand":
        ratios = [1.0, 2.32, 4.25, 6.63, 9.38]
        amps = [1.0, 0.6, 0.4, 0.25, 0.12]
        t60 = [dur, dur * 0.6, dur * 0.4, dur * 0.25, dur * 0.15]
        y = modal(np.array(ratios) * freq, np.array(amps), t60, dur, rng, split_hz=0.6)
    elif kind == "glass":
        n = nsamp(dur)
        t = tvec(n)
        idx = (3.2 * vel * brightness) * np.exp(-t / 0.18) + 0.25 * vel
        car = dsp.fm(freq, 3.5, idx, n)
        car2 = dsp.fm(freq * 2.0, 1.0, idx * 0.4, n)
        y = car * np.exp(-3 * t / dur * 1.2) + 0.35 * car2 * np.exp(-3 * t / (dur * 0.5))
        y = y + 0.2 * np.sin(TAU * freq * 4.01 * t) * np.exp(-3 * t / (dur * 0.25))
        y[: nsamp(0.003)] *= np.linspace(0, 1, nsamp(0.003))
    elif kind == "chime":
        ratios = [1.0, 2.76, 5.4, 8.93, 13.34]
        amps = [1.0, 0.5, 0.3, 0.15, 0.08]
        t60 = [dur, dur * 0.55, dur * 0.3, dur * 0.18, dur * 0.1]
        y = modal(np.array(ratios) * freq, amps, t60, dur, rng, split_hz=0.4)
    else:
        raise ValueError(kind)
    return dsp.fade(y, 0.0003, min(0.3, dur * 0.2)) * (0.45 + 0.55 * vel) * 0.8


def cymbal(dur=2.5, vel=0.7, rng=None, size=1.0, hi=1.0):
    rng = rng or np.random.default_rng(20)
    n = nsamp(dur)
    t = tvec(n)
    nz = dsp.hp(rng.standard_normal(n), 5200 * hi, order=2)
    parts = rng.uniform(3200, 11000, 18) * hi
    mdl = modal(parts, rng.uniform(0.2, 1, 18), rng.uniform(0.5, 1.5, 18) * dur * 0.5, dur, rng)
    e = np.minimum(1, t / 0.002) * (0.55 * 10 ** (-3 * t / (dur * 0.6)) + 0.45 * 10 ** (-3 * t / (dur * 1.1)))
    y = (nz * 0.8 + mdl * 0.25) * e
    return dsp.fade(y, 0, 0.1) * (0.2 + 0.4 * vel) * size


def kick(vel=0.9, freq=52.0, dur=0.5, rng=None):
    rng = rng or np.random.default_rng(21)
    n = nsamp(dur)
    t = tvec(n)
    f = freq * (1 + 2.8 * np.exp(-t / 0.018))
    y = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    na = nsamp(0.012)
    y[:na] += dsp.bp(rng.standard_normal(na), 2500, 0.8) * _env_exp(na, 0.003) * 0.6
    return dsp.fade(dsp.saturate(y, 1.4), 0.0003, 0.03) * (0.4 + 0.6 * vel)


# --------------------------------------------------------------------------- voices (formant synthesis, for SFX)
def glottal(f0_curve, n: int, rng, tilt: float = 3500.0, jitter: float = 0.01, shimmer: float = 0.06, breath: float = 0.05):
    """Voice source: band-limited pulse-ish saw with spectral tilt + jitter/shimmer + aspiration noise."""
    f0 = np.broadcast_to(np.asarray(f0_curve, dtype=float), (n,)).copy()
    f0 = f0 * (1 + jitter * dsp.smooth_noise(n, rng, 40.0))
    s = osc("saw", f0, n, rng.uniform())
    s = dsp.lp(s, tilt, 0.6)
    s = s * (1 + shimmer * dsp.smooth_noise(n, rng, 30.0))
    if breath > 0:
        s = s + breath * dsp.bp(rng.standard_normal(n), 2200, 0.5) * 0.6
    return s


def vowel_morph(x, v_from: str, v_to: str, t_morph: float, hop: int = 32, shift: float = 1.0, bw_scale: float = 1.0):
    """Time-varying parallel formant filter morphing between two vowels."""
    n = x.shape[-1]
    t = np.arange(n) / SR
    u = np.clip(t / max(t_morph, 1e-3), 0, 1)
    f0s, b0s, g0s = _VOWELS[v_from]
    f1s, b1s, g1s = _VOWELS[v_to]
    freqs = [(a + (b - a) * u) * shift for a, b in zip(f0s, f1s)]
    bws = [(a + (b - a) * u) * bw_scale for a, b in zip(b0s, b1s)]
    gains = [(a + b) / 2 for a, b in zip(g0s, g1s)]
    return dsp.formants(x, freqs, bws, gains, hop=hop) * 1.3

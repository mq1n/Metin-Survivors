"""Core DSP toolkit for Metin Survivors audio synthesis.

Conventions
-----------
* Sample rate is fixed at 44.1 kHz (``SR``).
* Mono signals are 1-D float64 arrays; stereo signals are ``(2, n)`` arrays.
* Everything is deterministic: every random source takes an ``rng`` (see ``rng_for``).
* All durations are seconds, all frequencies Hz, levels in linear amplitude unless ``db`` is in the name.
"""
from __future__ import annotations

import zlib
from functools import lru_cache

import numpy as np
from scipy import ndimage
from scipy import signal as sps

SR = 44100
NYQ = SR / 2
TAU = 2.0 * np.pi


# --------------------------------------------------------------------------- basics
def nsamp(sec: float) -> int:
    return int(round(sec * SR))


def tvec(n: int) -> np.ndarray:
    return np.arange(n) / SR


def db2lin(db: float) -> float:
    return 10.0 ** (db / 20.0)


def lin2db(x):
    return 20.0 * np.log10(np.maximum(x, 1e-12))


def midi2hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69.0) / 12.0)


def hz2midi(f):
    return 69.0 + 12.0 * np.log2(np.asarray(f, dtype=float) / 440.0)


_NOTE_BASE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def note(name: str) -> int:
    """'C#4' -> 61 (MIDI). Flats with 'b'."""
    n = _NOTE_BASE[name[0]]
    i = 1
    while i < len(name) and name[i] in "#b":
        n += 1 if name[i] == "#" else -1
        i += 1
    return n + 12 * (int(name[i:]) + 1)


def rng_for(*parts) -> np.random.Generator:
    """Deterministic generator from arbitrary hashable parts (names, ints)."""
    s = "|".join(str(p) for p in parts).encode()
    return np.random.default_rng(zlib.crc32(s) ^ 0x9E3779B1)


def pad_to(x: np.ndarray, n: int) -> np.ndarray:
    if x.shape[-1] >= n:
        return x[..., :n]
    out = np.zeros(x.shape[:-1] + (n,))
    out[..., : x.shape[-1]] = x
    return out


def rms(x) -> float:
    x = np.asarray(x)
    return float(np.sqrt(np.mean(x * x))) if x.size else 0.0


def peak(x) -> float:
    return float(np.max(np.abs(x))) if np.size(x) else 0.0


def normalize_peak(x, target_db=-1.0):
    p = peak(x)
    return x if p < 1e-9 else x * (db2lin(target_db) / p)


def mix_into(dst: np.ndarray, src: np.ndarray, start: int = 0, gain: float = 1.0):
    """Add src into dst at sample offset (both mono, or both (2,n)); clips to dst length."""
    if src.ndim != dst.ndim:
        if dst.ndim == 2 and src.ndim == 1:
            src = np.stack([src, src])
        else:
            raise ValueError("mix_into: dim mismatch")
    n = src.shape[-1]
    if start < 0:
        src = src[..., -start:]
        n = src.shape[-1]
        start = 0
    n = min(n, dst.shape[-1] - start)
    if n <= 0:
        return dst
    dst[..., start : start + n] += src[..., :n] * gain
    return dst


# --------------------------------------------------------------------------- oscillators
_TS = 8192
_LEVELS = 10


@lru_cache(maxsize=None)
def _tables(kind: str) -> np.ndarray:
    """Band-limited wavetable mip-maps: shape (levels, TS+1). Level L is safe for f in [20*2^L, 20*2^(L+1))."""
    x = np.arange(_TS) / _TS
    out = np.zeros((_LEVELS, _TS + 1))
    for lv in range(_LEVELS):
        f_hi = 20.0 * 2 ** (lv + 1)
        H = int(min(NYQ // f_hi, 400))
        H = max(H, 1)
        k = np.arange(1, H + 1)
        if kind == "saw":
            a = (-1.0) ** (k + 1) / k
        elif kind == "square":
            a = np.where(k % 2 == 1, 1.0 / k, 0.0)
        elif kind == "tri":
            a = np.where(k % 2 == 1, ((-1.0) ** ((k - 1) // 2)) / (k * k.astype(float)), 0.0)
        elif kind == "sine":
            a = np.where(k == 1, 1.0, 0.0)
        else:
            raise ValueError(kind)
        tab = np.zeros(_TS)
        # chunked outer product to limit memory
        for c0 in range(0, H, 100):
            kk = k[c0 : c0 + 100]
            tab += (a[c0 : c0 + 100, None] * np.sin(TAU * kk[:, None] * x[None, :])).sum(0)
        tab /= max(np.max(np.abs(tab)), 1e-9)
        out[lv, :_TS] = tab
        out[lv, _TS] = tab[0]
    return out


def _levels_for(freq) -> np.ndarray:
    f = np.maximum(np.asarray(freq, dtype=float), 20.0)
    return np.clip(np.floor(np.log2(f / 20.0)), 0, _LEVELS - 1).astype(np.int64)


def phase_of(freq, n: int | None = None, phase0: float = 0.0) -> np.ndarray:
    """Phase in cycles for a (possibly time-varying) frequency."""
    f = np.asarray(freq, dtype=float)
    if f.ndim == 0:
        if n is None:
            raise ValueError("n required for scalar freq")
        return phase0 + (np.arange(n) * float(f)) / SR
    cs = np.cumsum(f) / SR
    return phase0 + np.concatenate(([0.0], cs[:-1]))


def wt_read(kind: str, phase: np.ndarray, freq) -> np.ndarray:
    T = _tables(kind)
    lv = _levels_for(freq)
    x = (phase % 1.0) * _TS
    i0 = x.astype(np.int64)
    fr = x - i0
    flat = T.ravel()
    base = lv * (_TS + 1) if lv.ndim else int(lv) * (_TS + 1)
    return flat[base + i0] * (1.0 - fr) + flat[base + i0 + 1] * fr


def osc(kind: str, freq, n: int | None = None, phase0: float = 0.0, pw: float = 0.5) -> np.ndarray:
    """Band-limited oscillator. kind: sine|saw|square|tri|pulse (pw = duty)."""
    f = np.asarray(freq, dtype=float)
    if f.ndim == 1 and n is None:
        n = f.shape[0]
    ph = phase_of(f, n, phase0)
    if kind == "sine":
        return np.sin(TAU * ph)
    if kind == "pulse":
        y = wt_read("saw", ph, f) - wt_read("saw", ph - pw, f)
        return y * 0.5
    return wt_read(kind, ph, f)


def supersaw(freq, n: int, voices: int = 5, spread_cents: float = 12.0, rng=None, kind: str = "saw", stereo: bool = False):
    """Detuned oscillator stack. Mono (sum) or stereo (voices fanned across the field)."""
    rng = rng or np.random.default_rng(1)
    f = np.asarray(freq, dtype=float)
    if f.ndim == 0:
        f = np.full(n, float(f))
    dets = np.linspace(-spread_cents, spread_cents, voices) if voices > 1 else np.zeros(1)
    dets = dets + rng.uniform(-0.15, 0.15, voices) * spread_cents / max(1, voices - 1) * 2
    if stereo:
        out = np.zeros((2, n))
    else:
        out = np.zeros(n)
    for i, d in enumerate(dets):
        v = osc(kind, f * 2 ** (d / 1200.0), n, rng.uniform())
        if stereo:
            p = (i / max(1, voices - 1)) * 2 - 1 if voices > 1 else 0.0
            l, r = pan_gains(p * 0.8)
            out[0] += v * l
            out[1] += v * r
        else:
            out += v
    return out / np.sqrt(voices)


def pan_gains(p: float):
    """Constant-power pan, p in [-1, 1]."""
    a = (np.clip(p, -1, 1) + 1) * np.pi / 4
    return float(np.cos(a)), float(np.sin(a))


def pan(x: np.ndarray, p: float = 0.0) -> np.ndarray:
    l, r = pan_gains(p)
    return np.stack([x * l, x * r])


def to_stereo(x: np.ndarray) -> np.ndarray:
    return x if x.ndim == 2 else np.stack([x, x])


def to_mono(x: np.ndarray) -> np.ndarray:
    return x if x.ndim == 1 else x.mean(0)


# --------------------------------------------------------------------------- noise
def white(n: int, rng) -> np.ndarray:
    return rng.standard_normal(n)


def noise_color(n: int, rng, alpha: float) -> np.ndarray:
    """Noise with power spectrum ~ f^alpha (alpha=-1 pink, -2 brown, +1 blue, +2 violet). Unit RMS."""
    m = n + (n & 1)
    spec = np.fft.rfft(rng.standard_normal(m))
    f = np.arange(spec.shape[0], dtype=float)
    f[0] = 1.0
    spec *= f ** (alpha / 2.0)
    spec[0] = 0.0
    y = np.fft.irfft(spec, m)[:n]
    return y / (np.sqrt(np.mean(y * y)) + 1e-12)


def pink(n: int, rng):
    return noise_color(n, rng, -1.0)


def brown(n: int, rng):
    return noise_color(n, rng, -2.0)


def blue(n: int, rng):
    return noise_color(n, rng, 1.0)


def smooth_noise(n: int, rng, rate_hz: float, depth: float = 1.0) -> np.ndarray:
    """Slow random wander in [-depth, depth] (lowpassed noise at rate_hz), unit-peak-ish."""
    x = rng.standard_normal(n)
    sos = sps.butter(2, min(rate_hz, NYQ * 0.9) / NYQ, output="sos")
    y = sps.sosfilt(sos, x)
    y /= (np.max(np.abs(y)) + 1e-12)
    return y * depth


def crackle(n: int, rng, density_hz: float, decay_ms: float = 3.0, amp_spread: float = 1.0) -> np.ndarray:
    """Random impulse train (pops) with short exponential decays. Used for fire/ice/rubble."""
    out = np.zeros(n)
    count = rng.poisson(density_hz * n / SR)
    if count == 0:
        return out
    pos = rng.integers(0, n, count)
    amp = rng.uniform(0.2, 1.0, count) ** (1.0 + amp_spread) * rng.choice([-1, 1], count)
    np.add.at(out, pos, amp)
    k = np.exp(-np.arange(int(SR * decay_ms * 6 / 1000) + 2) / (SR * decay_ms / 1000))
    return np.convolve(out, k, mode="full")[:n]


# --------------------------------------------------------------------------- envelopes
def env(points, n: int | None = None, shape="lin") -> np.ndarray:
    """Multi-segment envelope. points = [(t, v[, shape]), ...]; the optional shape applies to the segment *ending* at that
    point: 'lin' | 'exp' (geometric interpolation, values must be >0) | 'cos' | float p (u**p curve, p<1 fast-start)."""
    pts = [tuple(p) for p in points]
    total = pts[-1][0]
    if n is None:
        n = nsamp(total)
    out = np.full(n, float(pts[-1][1]))
    t = np.arange(n) / SR
    first = pts[0]
    if first[0] > 0:
        out[: min(n, nsamp(first[0]))] = first[1]
    for (t0, v0, *_), (t1, v1, *sh) in zip(pts[:-1], pts[1:]):
        s = sh[0] if sh else shape
        i0, i1 = nsamp(t0), min(n, nsamp(t1))
        if i1 <= i0:
            continue
        u = np.clip((t[i0:i1] - t0) / max(t1 - t0, 1e-9), 0.0, 1.0)
        if s == "lin":
            seg = v0 + (v1 - v0) * u
        elif s == "exp":
            a, b = max(v0, 1e-5), max(v1, 1e-5)
            seg = a * (b / a) ** u
            if v1 == 0 and u.size:
                seg = seg * (1 - u ** 8)  # land on true zero
        elif s == "cos":
            seg = v0 + (v1 - v0) * (0.5 - 0.5 * np.cos(np.pi * u))
        else:
            seg = v0 + (v1 - v0) * u ** float(s)
        out[i0:i1] = seg
    return out


def adsr(dur: float, a: float = 0.01, d: float = 0.1, s: float = 0.7, r: float = 0.2, a_curve=0.6, d_curve="exp") -> np.ndarray:
    """ADSR: attack to 1, decay (exp) to s, hold until dur, release (exp-ish) to 0 over r. Length = dur + r."""
    pts = [(0.0, 0.0), (a, 1.0, a_curve)]
    if d > 0:
        pts.append((a + d, max(s, 1e-4), d_curve))
    hold_to = max(dur, a + d)
    pts.append((hold_to, max(s, 1e-4), "lin"))
    pts.append((hold_to + r, 0.0, "exp"))
    return env(pts)


def exp_decay(n: int, tau: float, floor_db: float | None = None) -> np.ndarray:
    return np.exp(-np.arange(n) / (SR * tau))


def decay_t60(n: int, t60: float) -> np.ndarray:
    """Envelope that falls 60 dB over t60 seconds."""
    return 10.0 ** (-3.0 * np.arange(n) / (SR * t60))


def fade(x: np.ndarray, fin: float = 0.0, fout: float = 0.0, curve: str = "cos") -> np.ndarray:
    n = x.shape[-1]
    y = x.copy()
    if fin > 0:
        m = min(n, nsamp(fin))
        u = np.arange(m) / max(m, 1)
        y[..., :m] *= (0.5 - 0.5 * np.cos(np.pi * u)) if curve == "cos" else u
    if fout > 0:
        m = min(n, nsamp(fout))
        u = np.arange(m) / max(m, 1)
        y[..., n - m :] *= ((0.5 + 0.5 * np.cos(np.pi * u)) if curve == "cos" else (1 - u))
    return y


def vib(n: int, rate: float, depth_cents: float, delay: float = 0.0, ramp: float = 0.3, rng=None, jitter: float = 0.0) -> np.ndarray:
    """Frequency multiplier curve for vibrato (with delayed onset and optional rate/depth jitter)."""
    t = np.arange(n) / SR
    on = np.clip((t - delay) / max(ramp, 1e-3), 0.0, 1.0)
    if rng is not None and jitter > 0:
        rate_c = rate * (1 + jitter * smooth_noise(n, rng, 0.7))
        ph = np.cumsum(rate_c) / SR
        dep = depth_cents * (1 + 0.5 * jitter * smooth_noise(n, rng, 0.9))
    else:
        ph = rate * t
        dep = depth_cents
    return 2.0 ** (dep * on * np.sin(TAU * ph) / 1200.0)


def glide_curve(n: int, f_start: float, f_end: float, t_glide: float, shape: float = 0.5) -> np.ndarray:
    """Frequency curve gliding f_start -> f_end in t_glide seconds (shape<1: fast then slow) then holding."""
    t = np.arange(n) / SR
    u = np.clip(t / max(t_glide, 1e-6), 0, 1)
    return f_start * (f_end / f_start) ** (u ** shape)


# --------------------------------------------------------------------------- filters
def _rbj(kind: str, fc, q, gain_db=0.0):
    fc = float(np.clip(fc, 5.0, NYQ * 0.98))
    w0 = TAU * fc / SR
    cw, sw = np.cos(w0), np.sin(w0)
    q = max(q, 0.05)
    alpha = sw / (2 * q)
    A = 10 ** (gain_db / 40.0)
    if kind == "lp":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "hp":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "bp":  # constant 0 dB peak gain
        b = [alpha, 0, -alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "notch":
        b = [1, -2 * cw, 1]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "ap":
        b = [1 - alpha, -2 * cw, 1 + alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "peak":
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == "ls":
        sq = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + sq), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sq)]
        a = [(A + 1) + (A - 1) * cw + sq, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sq]
    elif kind == "hs":
        sq = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + sq), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sq)]
        a = [(A + 1) - (A - 1) * cw + sq, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sq]
    else:
        raise ValueError(kind)
    b = np.array(b, dtype=float)
    a = np.array(a, dtype=float)
    return np.hstack([b / a[0], np.array([1.0, a[1] / a[0], a[2] / a[0]])])


def _apply_sos(x, sos):
    sos = np.atleast_2d(sos)
    return sps.sosfilt(sos, x, axis=-1)


def filt(x, kind: str, fc: float, q: float = 0.7071, gain_db: float = 0.0, order: int = 1):
    """RBJ biquad (lp/hp/bp/notch/ap/peak/ls/hs), cascaded `order` times."""
    sos = np.tile(_rbj(kind, fc, q, gain_db), (order, 1))
    return _apply_sos(x, sos)


def lp(x, fc, q=0.7071, order=1):
    return filt(x, "lp", fc, q, order=order)


def hp(x, fc, q=0.7071, order=1):
    return filt(x, "hp", fc, q, order=order)


def bp(x, fc, q=1.0, order=1):
    return filt(x, "bp", fc, q, order=order)


def peakeq(x, fc, q, gain_db):
    return filt(x, "peak", fc, q, gain_db)


def lowshelf(x, fc, gain_db, q=0.7071):
    return filt(x, "ls", fc, q, gain_db)


def highshelf(x, fc, gain_db, q=0.7071):
    return filt(x, "hs", fc, q, gain_db)


def butter_lp(x, fc, order=4):
    return sps.sosfilt(sps.butter(order, min(fc, NYQ * 0.98) / NYQ, "low", output="sos"), x, axis=-1)


def butter_hp(x, fc, order=4):
    return sps.sosfilt(sps.butter(order, max(fc, 5) / NYQ, "high", output="sos"), x, axis=-1)


def butter_bp(x, lo, hi, order=3):
    return sps.sosfilt(sps.butter(order, [max(lo, 5) / NYQ, min(hi, NYQ * 0.98) / NYQ], "band", output="sos"), x, axis=-1)


def dc_block(x, fc=20.0):
    return butter_hp(x, fc, 2)


def sweep_filter(x, kind: str, fc_curve, q=0.8, hop: int = 32, gain_db=0.0, order: int = 1):
    """Time-varying biquad. fc_curve/q: scalar or per-sample array. State carried across blocks (zipper-free for
    smooth sweeps). Mono input."""
    n = x.shape[-1]
    fc_curve = np.broadcast_to(np.asarray(fc_curve, dtype=float), (n,))
    q_curve = np.broadcast_to(np.asarray(q, dtype=float), (n,))
    out = np.empty(n)
    zi = np.zeros((order, 2))
    for s0 in range(0, n, hop):
        s1 = min(n, s0 + hop)
        mid = (s0 + s1) // 2
        sos = np.tile(_rbj(kind, fc_curve[mid], q_curve[mid], gain_db), (order, 1))
        out[s0:s1], zi = sps.sosfilt(sos, x[s0:s1], zi=zi)
    return out


def formants(x, freqs, bws, gains=None, hop: int = 32):
    """Parallel resonant bandpass bank (vocal tract). freqs/bws: lists of scalars or per-sample arrays (Hz)."""
    out = np.zeros_like(x)
    n = x.shape[-1]
    for i, (f, bw) in enumerate(zip(freqs, bws)):
        fa = np.broadcast_to(np.asarray(f, dtype=float), (n,))
        ba = np.broadcast_to(np.asarray(bw, dtype=float), (n,))
        g = 1.0 if gains is None else gains[i]
        out += g * sweep_filter(x, "bp", fa, fa / np.maximum(ba, 20.0), hop=hop)
    return out


# --------------------------------------------------------------------------- non-linear
def saturate(x, drive=2.0, os: int = 2):
    """tanh soft clip, oversampled to tame aliasing; output level ~ preserved."""
    if os > 1:
        up = sps.resample_poly(x, os, 1, axis=-1)
        y = np.tanh(up * drive) / np.tanh(drive)
        return sps.resample_poly(y, 1, os, axis=-1)[..., : x.shape[-1]]
    return np.tanh(x * drive) / np.tanh(drive)


def asym_saturate(x, drive=2.0, bias=0.2):
    y = np.tanh(x * drive + bias) - np.tanh(bias)
    return y / (np.max(np.abs(y)) + 1e-9) * peak(x)


def foldback(x, thresh=0.6):
    """Wavefolder."""
    y = x.copy()
    for _ in range(4):
        y = np.where(y > thresh, 2 * thresh - y, y)
        y = np.where(y < -thresh, -2 * thresh - y, y)
    return y


def bitcrush(x, bits=8, hold=1):
    q = 2.0 ** (bits - 1)
    y = np.round(x * q) / q
    if hold > 1:
        y = np.repeat(y[::hold], hold)[: x.shape[-1]]
    return y


def fm(carrier_hz, ratio: float, index, n: int | None = None, mod_phase0: float = 0.0, car_phase0: float = 0.0, fb_ratio=None):
    """Two-operator phase-modulation FM. index may be an array (envelope). Returns carrier output."""
    f = np.asarray(carrier_hz, dtype=float)
    if f.ndim == 1 and n is None:
        n = f.shape[0]
    pm = phase_of(f * ratio if f.ndim else f * ratio, n, mod_phase0)
    mod = np.sin(TAU * pm)
    pc = phase_of(f, n, car_phase0)
    # band-limit: cap the modulation index so significant sidebands stay below ~0.92*Nyquist (no aliasing)
    idx_cap = np.maximum((0.92 * NYQ - f) / np.maximum(f * ratio, 1.0) - 1.0, 0.05)
    return np.sin(TAU * pc + np.minimum(np.asarray(index), idx_cap) * mod)


# --------------------------------------------------------------------------- time-domain tools
def resample_curve(x: np.ndarray, ratio, oversample: int = 2) -> np.ndarray:
    """Variable-rate playback. ratio: scalar or per-output-sample array (1.0 = original speed). Output length is
    determined by the ratio array (or len(x)/ratio for scalar)."""
    if oversample > 1:
        xs = sps.resample_poly(x, oversample, 1)
    else:
        xs = x
    r = np.asarray(ratio, dtype=float)
    if r.ndim == 0:
        n_out = int(len(xs) / (r * oversample) * oversample)
        pos = np.arange(n_out) * r * oversample
    else:
        pos = np.concatenate(([0.0], np.cumsum(r[:-1]))) * oversample
    pos = pos[pos < len(xs) - 1]
    return np.interp(pos, np.arange(len(xs)), xs)


def pitch_shift_resample(x, semitones):
    return resample_curve(x, 2 ** (semitones / 12.0))


def delay_samples(x, d: int):
    if d <= 0:
        return x
    return np.concatenate([np.zeros(x.shape[:-1] + (d,)), x], axis=-1)


def reverse(x):
    return x[..., ::-1].copy()


def echo(x, time: float, fb: float = 0.4, mix: float = 0.3, taps: int = 6, damp_hz: float = 4000.0, stereo_offset: float = 0.0):
    """Feedback delay realised as a damped FIR tap series. Mono in; mono out (or stereo if stereo_offset)."""
    d = nsamp(time)
    n = x.shape[-1]
    wet = np.zeros(n + d * taps)
    cur = x
    for k in range(1, taps + 1):
        cur = lp(cur, damp_hz) * fb
        wet[d * k : d * k + n] += cur
    wet = wet[: n + d * taps]
    out = np.concatenate([x, np.zeros(d * taps)]) * (1 - mix * 0) + wet * mix
    return out


def chorus(x, rate=0.35, depth_ms=3.0, base_ms=14.0, mix=0.5, voices=2, rng=None):
    """Modulated-delay chorus. Mono -> stereo (2,n)."""
    rng = rng or np.random.default_rng(5)
    n = x.shape[-1]
    t = np.arange(n) / SR
    idx = np.arange(n)
    outs = []
    for ch in range(2):
        acc = np.zeros(n)
        for v in range(voices):
            ph = rng.uniform(0, TAU)
            d = (base_ms + depth_ms * np.sin(TAU * rate * (1 + 0.17 * (v + ch)) * t + ph + ch * np.pi / 2)) * SR / 1000.0
            pos = np.clip(idx - d, 0, n - 1)
            acc += np.interp(pos, idx, x)
        outs.append(acc / voices)
    wet = np.stack(outs)
    return to_stereo(x) * (1 - mix) + wet * mix


def stereo_widen(x2, width=1.3):
    m = (x2[0] + x2[1]) * 0.5
    s = (x2[0] - x2[1]) * 0.5 * width
    return np.stack([m + s, m - s])


def haas(x, ms=12.0, side=1):
    d = nsamp(ms / 1000.0)
    x2 = to_stereo(x)
    out = x2.copy()
    ch = 1 if side > 0 else 0
    out[ch] = np.concatenate([np.zeros(d), x2[ch]])[: x2.shape[-1]]
    return out


def tremolo(x, rate, depth, phase=0.0):
    t = np.arange(x.shape[-1]) / SR
    return x * (1 - depth * 0.5 * (1 - np.cos(TAU * rate * t + phase)))


def convolve(x, ir):
    return sps.fftconvolve(x, ir, mode="full")


# --------------------------------------------------------------------------- reverb (generated impulse responses)
def make_ir(rt60: float = 2.0, predelay: float = 0.015, hf_ratio: float = 0.45, lf_ratio: float = 1.0, early: float = 0.5,
            width: float = 1.0, build: float = 0.03, low_cut: float = 120.0, high_cut: float = 9000.0, seed: int = 11,
            tail_db: float = -70.0, shimmer: float = 0.0) -> np.ndarray:
    """Stereo reverb impulse response (2, n). Frequency-dependent decay via 4 bands, decorrelated channels, early
    reflections. rt60 = mid-band RT60; hf_ratio scales RT60 above ~4 kHz, lf_ratio below 250 Hz."""
    rng = np.random.default_rng(seed)
    length = int(SR * (rt60 * 1.15 + predelay + 0.1))
    t = np.arange(length) / SR
    ir = np.zeros((2, length))
    bands = [(0, 250, lf_ratio), (250, 1200, 1.0), (1200, 4000, 0.5 * (1 + hf_ratio)), (4000, NYQ * 0.95, hf_ratio)]
    pd = nsamp(predelay)
    for ch in range(2):
        noise = rng.standard_normal(length)
        acc = np.zeros(length)
        for lo, hi, ratio in bands:
            if lo == 0:
                band = sps.sosfilt(sps.butter(2, hi / NYQ, "low", output="sos"), noise)
            elif hi >= NYQ * 0.9:
                band = sps.sosfilt(sps.butter(2, lo / NYQ, "high", output="sos"), noise)
            else:
                band = sps.sosfilt(sps.butter(2, [lo / NYQ, hi / NYQ], "band", output="sos"), noise)
            band = band * (10.0 ** (-3.0 * np.maximum(t - predelay, 0) / (rt60 * ratio)))
            acc += band
        buildup = 1.0 - np.exp(-np.maximum(t - predelay, 0) / max(build, 1e-3))
        acc *= buildup
        acc[:pd] = 0
        # early reflections
        er = np.zeros(length)
        nrefl = 14
        times = predelay + np.sort(rng.uniform(0.002, 0.075, nrefl)) * (0.6 + 0.4 * min(rt60, 3))
        for k, tt in enumerate(times):
            i = int(tt * SR)
            if i < length:
                er[i] += rng.choice([-1, 1]) * (0.9 ** k) * rng.uniform(0.5, 1.0)
        er = lp(er, 7000)
        ir[ch] = acc * 0.06 + er * early * 0.35
    # decorrelate / width
    if width < 1.0:
        m = ir.mean(0)
        ir = m * (1 - width) + ir * width
    ir = np.stack([sps.sosfilt(sps.butter(2, low_cut / NYQ, "high", output="sos"), ir[c]) for c in range(2)])
    ir = np.stack([sps.sosfilt(sps.butter(2, min(high_cut, NYQ * 0.95) / NYQ, "low", output="sos"), ir[c]) for c in range(2)])
    if shimmer > 0:  # subtle modulated tail brightness
        ir *= 1 + shimmer * np.sin(TAU * 0.4 * t)
    # normalise by energy so wet level is comparable across presets
    e = np.sqrt(np.sum(ir ** 2) / 2)
    ir = ir / (e + 1e-12) * 1.2
    # fade tail
    fl = nsamp(0.05)
    ir[:, -fl:] *= np.linspace(1, 0, fl)
    return ir


_IR_CACHE: dict = {}


def reverb_ir(name: str) -> np.ndarray:
    presets = {
        "room": dict(rt60=0.45, predelay=0.004, hf_ratio=0.5, early=0.9, build=0.006, low_cut=150, high_cut=9000, seed=21),
        "small": dict(rt60=0.9, predelay=0.008, hf_ratio=0.55, early=0.8, build=0.01, low_cut=140, high_cut=10000, seed=22),
        "plate": dict(rt60=1.7, predelay=0.012, hf_ratio=0.8, early=0.25, build=0.015, low_cut=160, high_cut=12000, seed=23),
        "hall": dict(rt60=2.8, predelay=0.026, hf_ratio=0.42, early=0.5, build=0.03, low_cut=110, high_cut=8500, seed=24),
        "cathedral": dict(rt60=4.6, predelay=0.04, hf_ratio=0.35, early=0.4, build=0.05, low_cut=100, high_cut=7500, seed=25),
        "cave": dict(rt60=3.6, predelay=0.03, hf_ratio=0.3, lf_ratio=1.25, early=0.6, build=0.04, low_cut=90, high_cut=6000, seed=26),
        "air": dict(rt60=3.2, predelay=0.02, hf_ratio=0.75, early=0.2, build=0.04, low_cut=250, high_cut=14000, seed=27),
        "slap": dict(rt60=0.28, predelay=0.012, hf_ratio=0.5, early=1.0, build=0.004, low_cut=200, high_cut=9000, seed=28),
        "arena": dict(rt60=1.5, predelay=0.02, hf_ratio=0.45, early=0.8, build=0.02, low_cut=120, high_cut=8000, seed=29),
    }
    if name not in _IR_CACHE:
        _IR_CACHE[name] = make_ir(**presets[name])
    return _IR_CACHE[name]


def reverb(x, name: str = "hall", wet: float = 0.3, dry: float = 1.0, keep_length: bool = False, tail: float | None = None):
    """Convolution reverb. x mono or stereo -> stereo. Returns dry*x + wet*reverb(x), extended by the IR tail."""
    ir = reverb_ir(name) if isinstance(name, str) else name
    x2 = to_stereo(x)
    n = x2.shape[-1]
    if keep_length:
        out_n = n
    else:
        out_n = n + (ir.shape[-1] if tail is None else min(ir.shape[-1], nsamp(tail)))
    # stereo in: L->IR[0], R->IR[1] (true stereo approximated by cross terms)
    wet_sig = np.zeros((2, n + ir.shape[-1] - 1))
    if x.ndim == 1:
        wet_sig[0] = sps.fftconvolve(x, ir[0])
        wet_sig[1] = sps.fftconvolve(x, ir[1])
    else:
        wet_sig[0] = sps.fftconvolve(x2[0], ir[0]) * 0.7 + sps.fftconvolve(x2[1], ir[1]) * 0.3
        wet_sig[1] = sps.fftconvolve(x2[1], ir[1]) * 0.7 + sps.fftconvolve(x2[0], ir[0]) * 0.3
    out = np.zeros((2, out_n))
    m = min(out_n, wet_sig.shape[-1])
    out[:, :m] += wet_sig[:, :m] * wet
    m2 = min(out_n, n)
    out[:, :m2] += x2[:, :m2] * dry
    return out


# --------------------------------------------------------------------------- dynamics
def _blocks(x_abs: np.ndarray, hop: int, how="max") -> np.ndarray:
    n = x_abs.shape[-1]
    nb = -(-n // hop)
    padded = np.zeros(nb * hop)
    padded[:n] = x_abs
    r = padded.reshape(nb, hop)
    return r.max(1) if how == "max" else np.sqrt((r * r).mean(1))


def compress(x, thresh_db=-18.0, ratio=3.0, attack_ms=10.0, release_ms=120.0, knee_db=6.0, makeup_db=0.0, hop=32, sidechain=None,
             detector="rms"):
    """Feed-forward compressor (block-rate gain computer, python recursion over blocks). Stereo-linked."""
    x = np.asarray(x)
    det_src = x if sidechain is None else sidechain
    mono = np.abs(det_src).max(0) if det_src.ndim == 2 else np.abs(det_src)
    lvl = _blocks(mono, hop, "max" if detector == "peak" else "rms")
    lv_db = lin2db(lvl)
    over = lv_db - thresh_db
    if knee_db > 0:
        gr = np.where(over < -knee_db / 2, 0.0, np.where(over > knee_db / 2, over * (1 - 1 / ratio), ((over + knee_db / 2) ** 2) / (2 * knee_db) * (1 - 1 / ratio)))
    else:
        gr = np.where(over > 0, over * (1 - 1 / ratio), 0.0)
    a = np.exp(-hop / (SR * attack_ms / 1000.0))
    r = np.exp(-hop / (SR * release_ms / 1000.0))
    sm = np.empty_like(gr)
    prev = 0.0
    for i, g in enumerate(gr):
        c = a if g > prev else r
        prev = c * prev + (1 - c) * g
        sm[i] = prev
    gain = 10.0 ** ((-sm + makeup_db) / 20.0)
    gain_s = np.repeat(gain, hop)[: x.shape[-1]]
    # light smoothing to remove steps
    gain_s = ndimage.uniform_filter1d(gain_s, size=hop, mode="nearest")
    return x * gain_s


def limiter(x, ceiling_db=-1.5, lookahead_ms=4.0, release_ms=80.0, hop=64):
    """Look-ahead brickwall (sample-peak) limiter. Guarantees |y| <= ceiling. Stereo-linked."""
    ceil = db2lin(ceiling_db)
    x = np.asarray(x)
    mono = np.abs(x).max(0) if x.ndim == 2 else np.abs(x)
    need = np.minimum(1.0, ceil / np.maximum(mono, 1e-9))
    if need.min() >= 1.0:
        return x
    W = max(3, int(SR * lookahead_ms / 1000.0)) | 1
    nb = -(-need.shape[0] // hop)
    padded = np.ones(nb * hop)
    padded[: need.shape[0]] = need
    bmin = padded.reshape(nb, hop).min(1)
    rel = np.exp(-hop / (SR * release_ms / 1000.0))
    out_b = np.empty(nb)
    prev = 1.0
    for i, g in enumerate(bmin):
        prev = g if g < prev else min(g, 1.0 - (1.0 - prev) * rel)
        out_b[i] = prev
    g_s = np.repeat(out_b, hop)[: need.shape[0]]
    g_s = ndimage.minimum_filter1d(g_s, size=W * 2 + 1, mode="nearest")
    g_s = ndimage.uniform_filter1d(g_s, size=W * 2 + 1, mode="nearest")
    y = x * g_s
    return np.clip(y, -ceil, ceil)


def soft_clip_peaks(x, ceiling_db=-1.0):
    c = db2lin(ceiling_db)
    return np.tanh(x / c) * c


# --------------------------------------------------------------------------- loudness (ITU-R BS.1770)
def _k_weight(x2, fs=SR):
    # pre-filter (high shelf) + RLB high-pass, coefficients for 48k re-derived for fs via bilinear design
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = np.tan(np.pi * f0 / fs)
    Vh = 10 ** (G / 20)
    Vb = Vh ** 0.4996667741545416
    a0 = 1 + K / Q + K * K
    b = np.array([(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0])
    a = np.array([1.0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0])
    f1, Q1 = 38.13547087602444, 0.5003270373238773
    K1 = np.tan(np.pi * f1 / fs)
    a0 = 1 + K1 / Q1 + K1 * K1
    b2 = np.array([1.0, -2.0, 1.0])
    a2 = np.array([1.0, 2 * (K1 * K1 - 1) / a0, (1 - K1 / Q1 + K1 * K1) / a0])
    y = sps.lfilter(b, a, x2, axis=-1)
    return sps.lfilter(b2, a2, y, axis=-1)


def lufs_integrated(x2, fs=SR) -> float:
    """Integrated loudness (BS.1770-4, gated). x2 mono or (2,n)."""
    x2 = to_stereo(np.asarray(x2))
    y = _k_weight(x2, fs)
    blk = int(0.4 * fs)
    hop = int(0.1 * fs)
    n = y.shape[-1]
    if n < blk:
        return float(-0.691 + 10 * np.log10(np.sum(np.mean(y * y, axis=-1)) + 1e-12))
    starts = np.arange(0, n - blk + 1, hop)
    cs = np.concatenate([np.zeros((2, 1)), np.cumsum(y * y, axis=-1)], axis=-1)
    ms = (cs[:, starts + blk] - cs[:, starts]) / blk
    z = ms.sum(0)
    l = -0.691 + 10 * np.log10(z + 1e-12)
    gated = z[l > -70]
    if gated.size == 0:
        return -70.0
    rel = -0.691 + 10 * np.log10(gated.mean()) - 10
    gated2 = z[l > rel]
    if gated2.size == 0:
        return -70.0
    return float(-0.691 + 10 * np.log10(gated2.mean()))


def true_peak_db(x, os=4) -> float:
    up = sps.resample_poly(np.asarray(x), os, 1, axis=-1)
    return float(lin2db(np.max(np.abs(up))))


# --------------------------------------------------------------------------- loop helpers
def loop_fold(x, loop_len: int):
    """Fold the tail (samples beyond loop_len) back onto the start so the result loops seamlessly."""
    out = x[..., :loop_len].copy()
    tail = x[..., loop_len:]
    while tail.shape[-1] > 0:
        m = min(tail.shape[-1], loop_len)
        out[..., :m] += tail[..., :m]
        tail = tail[..., m:]
    return out


def crossfade_loop(x, fade_samples: int):
    """Make a free-running sound loop by cross-fading its end into its start (for ambient/drones). Returns an array
    shortened by fade_samples that loops without a click."""
    n = x.shape[-1]
    f = fade_samples
    head = x[..., :f]
    tail = x[..., n - f :]
    u = np.linspace(0, 1, f)
    w_in = np.sin(u * np.pi / 2)
    w_out = np.cos(u * np.pi / 2)
    out = x[..., : n - f].copy()
    out[..., :f] = head * w_in + tail * w_out
    return out

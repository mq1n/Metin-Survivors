"""SFX building blocks + registry. Sound definitions live in sfx_defs.py and register through @sfx(...)."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import signal as sps

from . import dsp
from . import instruments as I
from .dsp import SR, NYQ, TAU, nsamp, tvec


# --------------------------------------------------------------------------- registry
@dataclass
class SfxDef:
    id: str
    fn: object
    variants: int = 1
    kind: str = "sfx"  # sfx | ambience
    loop: bool = False
    level_db: float = 0.0  # relative perceived loudness target (0 = loud/important, -6 = quieter UI etc.)
    stereo: bool = False
    group: str = ""  # category for the sound board
    pitch_ladder: bool = False


REG: dict[str, SfxDef] = {}


def sfx(id: str, variants: int = 1, level_db: float = 0.0, loop: bool = False, stereo: bool = False, group: str = "", kind: str = "sfx"):
    def deco(fn):
        REG[id] = SfxDef(id, fn, variants, kind, loop, level_db, stereo, group or id.split("_")[1])
        return fn

    return deco


def file_ids(d: SfxDef) -> list[str]:
    if d.variants == 1:
        return [d.id]
    return [f"{d.id}_{i + 1:02d}" for i in range(d.variants)]


# --------------------------------------------------------------------------- canvas
class Canvas:
    def __init__(self, dur: float, stereo: bool = False):
        self.n = nsamp(dur)
        self.buf = np.zeros((2, self.n)) if stereo else np.zeros(self.n)

    def add(self, sig, t: float = 0.0, gain: float = 1.0):
        s = np.asarray(sig)
        if self.buf.ndim == 2 and s.ndim == 1:
            s = np.stack([s, s])
        elif self.buf.ndim == 1 and s.ndim == 2:
            s = s.mean(0)
        dsp.mix_into(self.buf, s, nsamp(t), gain)
        return self

    def out(self):
        return self.buf


# --------------------------------------------------------------------------- primitives
def env_exp(n: int, tau: float, attack: float = 0.0004) -> np.ndarray:
    t = np.arange(n) / SR
    e = np.exp(-t / tau)
    if attack > 0:
        e = e * np.minimum(1.0, t / attack)
    m = int(min(n * 0.4, SR * 0.12))  # taper the end so truncated decays never click
    if m > 1:
        e[-m:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(m) / m)
    return e


def thump(f_start: float, f_end: float, dur: float, tau_f: float = 0.04, decay: float = 0.15, drive: float = 1.0, attack: float = 0.0005) -> np.ndarray:
    n = nsamp(dur)
    t = tvec(n)
    f = f_end + (f_start - f_end) * np.exp(-t / tau_f)
    y = np.sin(TAU * np.cumsum(f) / SR) * env_exp(n, decay, attack)
    if drive > 1.0:
        y = dsp.saturate(y, drive)
    return y


def noise_hit(rng, dur: float, lo: float | None, hi: float | None, tau: float, color: str = "white", attack: float = 0.0004, order: int = 2) -> np.ndarray:
    n = nsamp(dur)
    x = {"white": lambda: rng.standard_normal(n), "pink": lambda: dsp.pink(n, rng), "brown": lambda: dsp.brown(n, rng)}[color]()
    if lo and hi:
        x = dsp.butter_bp(x, lo, hi, order)
    elif hi:
        x = dsp.butter_lp(x, hi, order * 2)
    elif lo:
        x = dsp.butter_hp(x, lo, order * 2)
    return x * env_exp(n, tau, attack)


def whoosh(rng, dur: float, f0: float, f1: float, q: float = 1.8, peak: float = 0.45, shape: float = 0.8, color: str = "pink", rise: float = 1.7, fall: float = 0.75, air: float = 0.25, f_mid: float | None = None) -> np.ndarray:
    """Noise through a sweeping resonant band-pass with an asymmetric swoosh envelope (+ a quieter octave-up band)."""
    n = nsamp(dur)
    x = dsp.pink(n, rng) if color == "pink" else rng.standard_normal(n)
    t = tvec(n)
    u = np.clip(t / dur, 0, 1)
    if f_mid is None:
        fc = f0 * (f1 / f0) ** (u ** shape)
    else:  # up then down (Doppler pass-by)
        fc = np.where(u < 0.5, f0 * (f_mid / f0) ** ((u * 2) ** shape), f_mid * (f1 / f_mid) ** ((np.clip(u - 0.5, 0, 1) * 2) ** shape))
    y = dsp.sweep_filter(x, "bp", fc, q, hop=24)
    y2 = dsp.sweep_filter(x, "bp", np.minimum(fc * 2.1, 14000), q * 0.8, hop=24) * air
    e = dsp.env([(0, 0), (dur * peak, 1, rise), (dur, 0, fall)], n)
    return (y + y2) * e * 1.3


def ring(freqs, decays, dur: float, rng, amps=None, split: float = 0.0, glide=None, attack: float = 0.0002) -> np.ndarray:
    amps = amps if amps is not None else np.ones(len(freqs))
    return I.modal(freqs, amps, decays, dur, rng, split_hz=split, glide=glide, attack=attack)


def click(rng, dur: float = 0.004, lo: float = 2500, hi: float | None = None, tau: float = 0.0012) -> np.ndarray:
    n = nsamp(dur)
    x = rng.standard_normal(n)
    x = dsp.butter_hp(x, lo, 2)
    if hi:
        x = dsp.butter_lp(x, hi, 2)
    return x * env_exp(n, tau, 0.00005)


def periodic_noise(rng, period: float, lo: float, hi: float, slope: float = 0.0) -> np.ndarray:
    """Exactly periodic band-limited noise (random phases on integer harmonics of 1/period)."""
    n = nsamp(period)
    spec = np.zeros(n // 2 + 1, dtype=complex)
    f = np.arange(spec.shape[0]) * SR / n
    band = (f >= lo) & (f <= hi)
    mag = np.ones(band.sum()) * (np.maximum(f[band], 1.0) / 1000.0) ** slope
    spec[band] = mag * np.exp(1j * rng.uniform(0, TAU, band.sum()))
    y = np.fft.irfft(spec, n)
    return y / (np.sqrt(np.mean(y * y)) + 1e-12)


def voice(rng, dur: float, f0_start: float, f0_end: float, v_from: str, v_to: str, breath: float = 0.08, rasp: float = 0.0, vib_hz: float = 0.0,
          vib_cents: float = 0.0, attack: float = 0.012, decay_tau: float | None = None, am_hz: float = 0.0, am_depth: float = 0.0,
          formant_shift: float = 1.0, glide_shape: float = 0.7, tilt: float = 3200.0, release: float = 0.05, shimmer: float = 0.08,
          peak_t: float | None = None, f0_mid: float | None = None, bw_scale: float = 1.0) -> np.ndarray:
    """Formant-synthesised vocalisation (grunts, yelps, wails, roars)."""
    n = nsamp(dur)
    t = tvec(n)
    u = np.clip(t / dur, 0, 1)
    if f0_mid is None:
        f0 = f0_start * (f0_end / f0_start) ** (u ** glide_shape)
    else:
        f0 = np.where(u < 0.5, f0_start * (f0_mid / f0_start) ** ((u * 2) ** glide_shape), f0_mid * (f0_end / f0_mid) ** ((np.clip(u - 0.5, 0, 1) * 2) ** glide_shape))
    if vib_hz > 0:
        f0 = f0 * dsp.vib(n, vib_hz, vib_cents, 0.1, 0.25, rng, 0.2)
    src = I.glottal(f0, n, rng, tilt=tilt, jitter=0.012, shimmer=shimmer, breath=breath)
    if am_hz > 0:
        src = src * (1 - am_depth * 0.5 * (1 + np.sin(TAU * am_hz * t)))
    y = I.vowel_morph(src, v_from, v_to, dur * 0.85, shift=formant_shift, bw_scale=bw_scale)
    if breath > 0:
        nz = dsp.bp(rng.standard_normal(n), 2400 * formant_shift, 0.6) * breath * 1.6
        y = y + nz * np.exp(-t / (dur * 0.5))
    if rasp > 0:
        y = dsp.saturate(y * (1 + rasp * 3), 1.0 + rasp * 2.5)
    pk = dur * 0.3 if peak_t is None else peak_t
    if decay_tau is None:
        e = dsp.env([(0, 0), (min(attack, pk), 1, 0.7), (pk, 1.0), (dur, 0, 1.3)], n)
    else:
        e = dsp.env([(0, 0), (attack, 1, 0.7)], n) * np.exp(-np.maximum(t - attack, 0) / decay_tau)
        e = e * np.clip((dur - t) / max(release, 1e-3), 0, 1)
    return y * e


def pentatonic_hz(root_midi: int, steps) -> list[float]:
    scale = [0, 2, 4, 7, 9]
    out = []
    for s in steps:
        octv, k = divmod(s, 5)
        out.append(float(dsp.midi2hz(root_midi + scale[k] + 12 * octv)))
    return out



def mono_room(x, name="room", wet=0.18, tail=None):
    r = dsp.reverb(x, name, wet=wet, dry=1.0, tail=tail)
    return r.mean(0)


def punch(x, amt: float = 1.0, thresh_db=-16.0, ratio=3.0):
    return dsp.compress(x, thresh_db, ratio, 1.0, 55.0, hop=16, detector="peak") * dsp.db2lin(amt)


def mid_fraction(x, split: float = 150.0) -> float:
    """Share of the signal energy above `split` Hz (small speakers/phones cannot reproduce much below ~150 Hz)."""
    x = x if x.ndim == 1 else x.mean(0)
    f, P = sps.welch(x, SR, nperseg=min(4096, max(256, x.shape[-1] // 2)))
    return float(P[f > split].sum() / (P.sum() + 1e-30))


def speaker_balance(x, target: float = 0.25, split: float = 150.0, max_cut_db: float = 14.0):
    """Translate to small speakers: when too little energy sits above `split` Hz the sub-band is shelved down (2 dB steps, up to
    `max_cut_db`) and a little of its harmonic content is restored at 150-700 Hz (psychoacoustic bass). Because every file is
    peak-normalised afterwards, trimming the sub makes the audible mids louder."""
    if x.ndim != 1:
        return np.stack([speaker_balance(c, target, split, max_cut_db) for c in x])
    cut = 0.0
    y = x
    while mid_fraction(y, split) < target and cut < max_cut_db:
        cut += 2.0
        y = dsp.lowshelf(x, split, -cut)
    if cut > 0:
        sub = dsp.butter_lp(x, split, 4)
        pk = float(np.abs(sub).max()) + 1e-9
        s = sub / pk
        h = np.tanh(2.5 * s) + 0.5 * (np.abs(s) - np.abs(s).mean())
        h = dsp.butter_bp(h, split * 0.9, 700, 2)
        y = y + h * pk * 0.22 * (1 - 10 ** (-cut / 20))
    return y


def finalize(x, hp_hz: float = 22.0, peak_db: float = -1.3, trim_db: float = -66.0, fade_ms: float = 6.0, lp_hz: float | None = 17500.0, fade_in_ms: float = 0.25, balance: bool = True) -> np.ndarray:
    """Common clean-up: DC/subsonic block, tail trim, short fade-in/out, peak-normalise."""
    x = np.asarray(x, dtype=float)
    x = dsp.butter_hp(x, hp_hz, 2)
    if balance:
        x = speaker_balance(x)
    if lp_hz:
        x = dsp.butter_lp(x, lp_hz, 2)
    pk = np.abs(x).max() if x.ndim == 1 else np.abs(x).max()
    if pk < 1e-9:
        raise ValueError("silent sfx")
    env = np.abs(x) if x.ndim == 1 else np.abs(x).max(0)
    idx = np.nonzero(env > pk * 10 ** (trim_db / 20))[0]
    end = int(idx[-1]) + 1 if idx.size else x.shape[-1]
    x = x[..., :end]
    x = dsp.fade(x, fade_in_ms / 1000.0, fade_ms / 1000.0, "lin")
    x = x * (dsp.db2lin(peak_db) / (np.abs(x).max() + 1e-12))
    return x

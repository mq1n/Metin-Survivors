"""Music engine: beat-based sequencer + per-track mix buses + seamless-loop mastering.

Usage sketch::

    song = Song("menu", bpm=84, bars=32)
    song.track("gayageum", pan=-0.3, gain_db=-3, reverb={"hall": 0.25}, eq=[("hp", 120)])
    for beat, midi, dur, vel in parse_notes("D4:1 F4:.5 G4:.5 A4:2", start_beat=0):
        song.note("gayageum", I.pluck, beat, midi, dur, vel, t60=2.5)
    audio = song.render()     # (2, loop_len) float64, loops sample-accurately

Positions are in beats (quarter notes) from the start of the loop. Notes whose release runs past the loop end wrap
around to the beginning (that is what makes the loop seamless).
"""
from __future__ import annotations

import re
import zlib
from contextlib import contextmanager
from dataclasses import dataclass, field

import numpy as np
from scipy import fft as sfft
from scipy import ndimage
from scipy import signal as sps

from . import dsp
from .dsp import SR, nsamp, midi2hz, note as note_midi


# --------------------------------------------------------------------------- note-name mini language
_TOK = re.compile(r"^(?P<name>[A-Ga-g][#b]?-?\d|r|-)(?::(?P<dur>[\d./]+))?(?:@(?P<vel>[\d.]+))?(?P<mods>(?:\^[a-z]+)*)$")


def _num(s: str) -> float:
    if "/" in s:
        a, b = s.split("/")
        return float(a) / float(b)
    return float(s)


def parse_notes(text: str, start_beat: float = 0.0, default_dur: float = 1.0, default_vel: float = 0.75):
    """'D4:1 F4:.5 r:.5 G4:1.5@0.9 | A4:2^acc' -> list of dicts {beat, midi, dur, vel, mods:set}. 'r' = rest, '|' ignored.
    '-' extends the previous note by its default duration. Durations in beats (fractions like 1/3 allowed)."""
    out = []
    beat = start_beat
    for tok in text.replace("\n", " ").split():
        if tok == "|":
            continue
        m = _TOK.match(tok)
        if not m:
            raise ValueError(f"bad token {tok!r}")
        dur = _num(m.group("dur")) if m.group("dur") else default_dur
        name = m.group("name")
        if name == "-":
            if out:
                out[-1]["dur"] += dur
            beat += dur
            continue
        if name != "r":
            out.append(dict(beat=beat, midi=note_midi(name[0].upper() + name[1:]), dur=dur,
                            vel=float(m.group("vel")) if m.group("vel") else default_vel,
                            mods=set(x for x in m.group("mods").split("^") if x)))
        beat += dur
    return out


def transpose(notes, semis):
    return [dict(n, midi=n["midi"] + semis) for n in notes]


def shift(notes, beats):
    return [dict(n, beat=n["beat"] + beats) for n in notes]


def scale_midi(root: str, steps, octaves=(0, 1, 2)):
    r = note_midi(root)
    return [r + s + 12 * o for o in octaves for s in steps]


# Pentatonic / modal pitch sets (semitones from root)
SCALES = {
    "maj_pent": [0, 2, 4, 7, 9],
    "min_pent": [0, 3, 5, 7, 10],
    "yo": [0, 2, 5, 7, 9],
    "in": [0, 1, 5, 7, 8],
    "hirajoshi": [0, 2, 3, 7, 8],
    "pyeongjo": [0, 2, 5, 7, 9],  # D E G A B-like (Korean pyeongjo ~ yo-like pentatonic)
    "gyemyeonjo": [0, 3, 5, 7, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "major": [0, 2, 4, 5, 7, 9, 11],
}


# --------------------------------------------------------------------------- track
@dataclass
class Track:
    name: str
    pan: float = 0.0
    gain_db: float = 0.0
    reverb: dict = field(default_factory=dict)  # preset -> send amount (0..1)
    eq: list = field(default_factory=list)  # [("hp", 120), ("peak", 800, 1.0, 3.0), ("lp", 9000), ("ls", 120, 3)...]
    sat: float = 0.0
    duck: tuple | None = None  # (trigger_track, depth_db, release_ms)
    comp: dict | None = None
    width: float = 1.0
    buf: np.ndarray | None = None
    gain_pts: list | None = None  # [(beat, db)] automation
    pre_fx: object = None  # optional callable(stereo)->stereo
    layers: dict = field(default_factory=dict)  # tag -> (2,n) buffer with only what Song.layer(tag) added to this track (AG-02: calm variants)


class Song:
    def __init__(self, name: str, bpm: float, bars: int, beats_per_bar: int = 4, tail: float = 7.0, seed: int = 1):
        self.name = name
        self.bpm = float(bpm)
        self.bars = bars
        self.bpb = beats_per_bar
        self.spb = 60.0 / bpm
        self.total_beats = bars * beats_per_bar
        self.loop_len = nsamp(self.total_beats * self.spb)
        self.tail = nsamp(tail)
        self.n = self.loop_len + self.tail
        self.tracks: dict[str, Track] = {}
        self.seed = seed
        self.rng = dsp.rng_for("song", name, seed)
        self._cache: dict = {}
        self._layer: str | None = None
        self.master_eq: list = []
        self.master_reverb: dict = {}
        self.master_comp = dict(thresh_db=-20.0, ratio=2.0, attack_ms=25.0, release_ms=220.0, makeup_db=0.0)

    # -------- geometry
    def beat_sec(self, beat: float) -> float:
        return beat * self.spb

    def bar_beat(self, bar: float, beat: float = 0.0) -> float:
        return bar * self.bpb + beat

    @property
    def duration(self) -> float:
        return self.loop_len / SR

    # -------- tracks
    def track(self, name: str, **kw) -> Track:
        tr = Track(name, **kw)
        tr.buf = np.zeros((2, self.n))
        self.tracks[name] = tr
        return tr

    @contextmanager
    def layer(self, tag: str):
        """Everything placed inside `with song.layer("perc"):` is also kept in a separate per-track buffer (Track.layers[tag]). The
        normal mix is unchanged (the notes still go to the track buffer, same rng draws, same order); apply_calm() can subtract the
        layer again, which removes e.g. a gong or a riser that shares a track with tonal notes."""
        prev, self._layer = self._layer, tag
        try:
            yield
        finally:
            self._layer = prev

    def add(self, track: str, sig: np.ndarray, beat: float, gain: float = 1.0, pan: float | None = None, jitter_ms: float = 0.0):
        tr = self.tracks[track]
        t = beat * self.spb
        if jitter_ms > 0:
            t += self.rng.normal(0, jitter_ms / 1000.0)
        start = int(round(t * SR))
        s = sig
        if s.ndim == 1:
            p = tr.pan if pan is None else pan
            l, r = dsp.pan_gains(p)
            s = np.stack([s * l, s * r])
        elif pan is not None and pan != 0:
            l, r = dsp.pan_gains(pan)
            s = np.stack([s[0] * (l * 1.41), s[1] * (r * 1.41)])
        dsp.mix_into(tr.buf, s, start, gain)
        if self._layer is not None:
            lb = tr.layers.get(self._layer)
            if lb is None:
                lb = tr.layers[self._layer] = np.zeros_like(tr.buf)
            dsp.mix_into(lb, s, start, gain)

    def note(self, track: str, inst, beat: float, midi: float, dur_beats: float, vel: float = 0.75, pan: float | None = None,
             gain: float = 1.0, jitter_ms: float = 6.0, vel_jitter: float = 0.07, **kw):
        """Render an instrument note and place it. inst(freq, dur_sec, vel=..., rng=..., **kw) -> mono or stereo array."""
        v = float(np.clip(vel * (1 + self.rng.uniform(-vel_jitter, vel_jitter)), 0.05, 1.0))
        sig = inst(float(midi2hz(midi)), dur_beats * self.spb, vel=v, rng=np.random.default_rng(self.rng.integers(1 << 31)), **kw)
        self.add(track, sig, beat, gain, pan, jitter_ms)

    def chord(self, track: str, midis, beat: float, dur_beats: float, vel: float = 0.7, gain: float = 1.0, **kw):
        """Place a pad chord (instruments.pad: list of freqs -> stereo)."""
        from . import instruments as I
        freqs = [float(midi2hz(m)) for m in midis]
        sig = I.pad(freqs, dur_beats * self.spb, vel=vel, rng=np.random.default_rng(self.rng.integers(1 << 31)), **kw)
        self.add(track, sig, beat, gain, None, 0.0)

    def notes(self, track: str, inst, notes, **kw):
        for nt in notes:
            extra = {}
            self.note(track, inst, nt["beat"], nt["midi"], nt["dur"], nt["vel"], **{**kw, **extra})

    def hit(self, track: str, fn, beat: float, vel: float = 0.8, variants: int = 4, pan: float | None = None, gain: float = 1.0,
            jitter_ms: float = 3.0, **kw):
        """Percussive one-shot (cached round-robin variants so patterns don't machine-gun)."""
        v = float(np.clip(vel * (1 + self.rng.uniform(-0.05, 0.05)), 0.05, 1.0))
        vq = round(v * 10) / 10
        k = (getattr(fn, "__name__", str(fn)), vq, tuple(sorted(kw.items())), int(self.rng.integers(variants)))
        if k not in self._cache:
            self._cache[k] = fn(vel=vq, rng=np.random.default_rng(zlib.crc32(repr(k).encode())), **kw)
        self.add(track, self._cache[k], beat, gain, pan, jitter_ms)

    def pattern(self, track: str, fn, text: str, bar: float, vel_map=None, step_beats: float = 0.25, pan: float | None = None, gain: float = 1.0,
                jitter_ms: float = 3.0, variants: int = 4, **kw):
        """Step pattern: 'x.x. X.o.' (characters per step; '.' = rest; X loud, x medium, o soft, g ghost). Spaces ignored."""
        vm = vel_map or {"X": 1.0, "x": 0.8, "o": 0.6, "g": 0.38}
        steps = [c for c in text if c not in " |"]
        for i, c in enumerate(steps):
            if c in vm:
                self.hit(track, fn, bar * self.bpb + i * step_beats, vm[c], pan=pan, gain=gain, jitter_ms=jitter_ms, variants=variants, **kw)

    def automate(self, track: str, pts):
        """Gain automation in dB: pts = [(beat, db), ...] (linear in dB between points, holds ends)."""
        self.tracks[track].gain_pts = pts

    # -------- mixdown
    def _fx_chain(self, x, eq):
        for e in eq:
            kind, fc, *rest = e
            q = rest[0] if rest else 0.7071
            g = rest[1] if len(rest) > 1 else 0.0
            if kind in ("ls", "hs"):
                x = np.stack([dsp.filt(x[c], kind, fc, 0.7071, rest[0] if rest else 0.0) for c in range(2)])
            else:
                x = np.stack([dsp.filt(x[c], kind, fc, q, g) for c in range(2)])
        return x

    def _env_follow(self, x, hop=64, atk_ms=4.0, rel_ms=140.0):
        m = np.abs(x).max(0) if x.ndim == 2 else np.abs(x)
        nb = -(-m.shape[0] // hop)
        pad = np.zeros(nb * hop)
        pad[: m.shape[0]] = m
        b = pad.reshape(nb, hop).max(1)
        a = np.exp(-hop / (SR * atk_ms / 1000.0))
        r = np.exp(-hop / (SR * rel_ms / 1000.0))
        out = np.empty(nb)
        prev = 0.0
        for i, v in enumerate(b):
            c = a if v > prev else r
            prev = c * prev + (1 - c) * v
            out[i] = prev
        e = np.repeat(out, hop)[: m.shape[0]]
        return e

    def mixdown(self, verbose=False) -> np.ndarray:
        master = np.zeros((2, self.n))
        wet_buses: dict[str, np.ndarray] = {}
        for name, tr in self.tracks.items():
            x = tr.buf
            if np.abs(x).max() < 1e-9:
                continue
            if tr.pre_fx:
                x = tr.pre_fx(x)
            if tr.eq:
                x = self._fx_chain(x, tr.eq)
            if tr.sat > 0:
                x = dsp.saturate(x, tr.sat)
            if tr.comp:
                x = dsp.compress(x, **tr.comp)
            if tr.width != 1.0:
                x = dsp.stereo_widen(x, tr.width)
            g = dsp.db2lin(tr.gain_db)
            x = x * g
            if tr.gain_pts:
                bt = np.array([p[0] for p in tr.gain_pts]) * self.spb * SR
                dbs = np.array([p[1] for p in tr.gain_pts])
                curve = dsp.db2lin(np.interp(np.arange(self.n), bt, dbs))
                x = x * curve
            if tr.duck:
                trig, depth_db, rel = tr.duck
                e = self._env_follow(self.tracks[trig].buf, atk_ms=3.0, rel_ms=rel)
                e = e / (e.max() + 1e-9)
                x = x * (1 - (1 - dsp.db2lin(-depth_db)) * np.clip(e * 1.6, 0, 1))
            for rv, amt in tr.reverb.items():
                if rv not in wet_buses:
                    wet_buses[rv] = np.zeros((2, self.n))
                wet_buses[rv] += x * amt
            master += x
            if verbose:
                print(f"  track {name}: peak {dsp.peak(x):.3f} rms {dsp.rms(x):.4f}")
        for rv, bus in wet_buses.items():
            w = dsp.reverb(bus, rv, wet=1.0, dry=0.0, keep_length=True)
            master += w
        for rv, amt in self.master_reverb.items():
            master += dsp.reverb(master, rv, wet=amt, dry=0.0, keep_length=True)
        return master

    def render(self, verbose=False, loop: bool = True) -> np.ndarray:
        """Mix and master-bus process.
        loop=True : fold the tail onto the start (seamless loop) -> (2, loop_len).
        loop=False: one-shot (stinger): keep the natural tail, trim trailing silence -> (2, n)."""
        m = self.mixdown(verbose)
        if not loop:
            x = m
            if self.master_eq:
                x = self._fx_chain(x, self.master_eq)
            if self.master_comp:
                x = dsp.compress(x, **self.master_comp)
            env = np.abs(x).max(0)
            idx = np.nonzero(env > 10 ** (-60 / 20) * env.max())[0]
            end = int(idx[-1]) + 1 if idx.size else x.shape[-1]
            end = min(end, x.shape[-1])
            return dsp.fade(x[:, :end], 0.0, min(0.25, end / SR * 0.2))
        loop = dsp.loop_fold(m, self.loop_len)
        loop = periodic(loop, lambda x: self._fx_chain(x, self.master_eq) if self.master_eq else x)
        if self.master_comp:
            loop = periodic(loop, lambda x: dsp.compress(x, **self.master_comp))
        return loop


# --------------------------------------------------------------------------- calm variant (AG-02)
def soften_sos(spec: dict):
    """The RBJ chain of a CALM 'soften' spec exactly as Song._fx_chain used to run it from tr.eq: high shelf (Hz, dB), then low-pass (Hz), Q 0.7071."""
    rows = []
    if "hs" in spec:
        rows.append(dsp._rbj("hs", spec["hs"][0], 0.7071, spec["hs"][1]))
    if "lp" in spec:
        rows.append(dsp._rbj("lp", spec["lp"], 0.7071, 0.0))
    return np.vstack(rows) if rows else None


def soften_zero_phase(buf: np.ndarray, loop_len: int, spec: dict, pad_sec: float = 0.25) -> np.ndarray:
    """Apply a CALM soften spec (hs / lp) to a track buffer ((2, n), n = loop_len + tail) as a ZERO-PHASE filter: the magnitude |H(f)| of the very
    same RBJ biquad chain multiplied onto the buffer's FFT, no phase. The causal biquads delay the filtered voices by their group delay (2.7-3.5
    samples at the cut-offs the zone songs use), which would offset the calm stem from the combat mix at the sample level; this does not (the
    long-term spectrum is the same). The filter is non-causal: the little response BEFORE sample 0 (pre-ringing of notes that start at the loop
    start) is added at the loop end, where it belongs in a seamless loop; the response after the buffer end (below the tail's noise floor) is dropped.
    Linear (the song is mixed linearly up to the track 'sat'), so it commutes with the track's pre_fx and EQ."""
    sos = soften_sos(spec)
    if sos is None:
        return buf
    n = buf.shape[-1]
    pad = min(nsamp(pad_sec), loop_len)
    nfft = 2 * sfft.next_fast_len((n + 2 * pad + 1) // 2, real=True)  # even, so the rfft bins are k * pi / (nfft / 2)
    _, h = sps.sosfreqz(sos, worN=np.linspace(0.0, np.pi, nfft // 2 + 1))
    y = sfft.irfft(sfft.rfft(buf, nfft, axis=-1) * np.abs(h), nfft, axis=-1)
    out = y[..., :n].copy()
    out[..., loop_len - pad : loop_len] += y[..., nfft - pad :]
    return out


# Sample-level alignment of a calm stem with its combat mix (the AR-02 cross-fade sums both decks at the same offset): the lag (samples) of the
# calm band signal against the combat one, per band; the allowed |lag| per band. 0 samples in the mid / high bands (where the softened leads live),
# +-1 in the low band (bass / pad: the correlation there is weak and the plain mix differs most).
ALIGN_BANDS = (("low", 40.0, 300.0, 1), ("mid", 300.0, 1500.0, 0), ("high", 1500.0, 6000.0, 0))


def band_lag(a: np.ndarray, b: np.ndarray, maxlag: int = 12):
    """(lag, r): the shift L in samples (-maxlag..maxlag) that maximises the normalised cross-correlation of a[t] and b[t + L]; positive = b is late
    against a. r is that correlation coefficient."""
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    best, bl = -2.0, 0
    for lag in range(-maxlag, maxlag + 1):
        x, y = (a[: n - lag], b[lag:]) if lag >= 0 else (a[-lag:], b[: n + lag])
        c = float(np.dot(x, y) / (np.linalg.norm(x) * np.linalg.norm(y) + 1e-20))
        if c > best:
            best, bl = c, lag
    return bl, best


def stem_alignment(calm: np.ndarray, combat: np.ndarray, seg_s: float = 30.0, start_s: float = 10.0, min_r: float = 0.3) -> dict:
    """Band-wise sample lag of a calm stem against its combat mix (arrays (2, n) or (n,), equal length), measured on 30 s of the loop (from 10 s, or the
    whole signal when it is shorter): zero-phase 4th-order band-pass of both, then band_lag. A band whose correlation stays under min_r (no shared
    content, e.g. a pure tone test signal has nothing at 1.5-6 kHz) is reported with lag None and does not count. ok = every measured band is inside
    its limit. Returns {"bands": {name: dict(lag, r, limit, ok)}, "ok": bool}."""
    ma = calm if calm.ndim == 1 else calm.mean(0)
    mb = combat if combat.ndim == 1 else combat.mean(0)
    n = min(len(ma), len(mb))
    i0 = int(start_s * SR)
    i1 = i0 + int(seg_s * SR)
    if n < i1:
        i0, i1 = 0, min(n, int(seg_s * SR))
    out, ok = {}, True
    for name, lo, hi, limit in ALIGN_BANDS:
        sos = sps.butter(4, [lo / (SR / 2), min(hi, SR / 2 * 0.98) / (SR / 2)], "band", output="sos")
        lag, r = band_lag(sps.sosfiltfilt(sos, ma[i0:i1]), sps.sosfiltfilt(sos, mb[i0:i1]))
        if r < min_r:
            out[name] = dict(lag=None, r=round(r, 4), limit=limit, ok=True)
            continue
        out[name] = dict(lag=int(lag), r=round(r, 4), limit=limit, ok=bool(abs(lag) <= limit))
        ok = ok and out[name]["ok"]
    return dict(bands=out, ok=bool(ok))


def format_alignment(al) -> str:
    """'low 0 (r 0.84) / mid 0 (r 0.99) / high 0 (r 0.98)' for a stem_alignment result (None -> 'n/a')."""
    if not al:
        return "n/a"
    return " / ".join(f"{k} {v['lag'] if v['lag'] is not None else '-'} (r {v['r']:.2f})" for k, v in al["bands"].items())


def apply_calm(S: Song, mute=(), layers=(), trim_db=None, soften=None, space: float = 1.0) -> dict:
    """Turn a fully built Song into its calm variant WITHOUT touching a note: every kept note is the same sample-exact buffer content as in
    the combat mix (same tempo, bars, key, rng draws, micro-timing), so the two stems can be cross-faded in sync.

      mute     tracks removed whole: percussion, brass, risers / booms / reverse cymbals, harsh basses
      layers   Song.layer() tags subtracted from every track (percussive bits that share a track with tonal notes)
      trim_db  {track: dB} added to the track gain (rebalance what is left)
      soften   {track: dict(lp=Hz, hs=(Hz, dB), sat=max)} extra low-pass / high-shelf cut / less saturation on the lead voices. The lp / hs
               are applied ZERO-PHASE on the track buffer (soften_zero_phase: the magnitude of the RBJ hs / lp chain on the buffer's FFT, no
               group delay), never as causal biquads in the track EQ: those delay the softened voices by 2.7-3.5 samples and the calm stem
               would no longer be sample-aligned with the combat mix (a partial comb in the cross-fade)
      space    x the reverb sends of every kept track (the same notes in a bigger room)

    Call it on the Song returned by the zone's build(), then S.render() / master_loop() as for the combat mix. Returns a report of what
    was removed (peak of the removed signal) and what is left."""
    trim_db, soften = dict(trim_db or {}), dict(soften or {})
    bad = [n for n in (*mute, *trim_db, *soften) if n not in S.tracks]
    if bad:
        raise KeyError(f"apply_calm: unknown track(s) {bad} in song {S.name!r} (tracks: {', '.join(S.tracks)})")
    rep: dict = dict(muted={}, layers={}, kept=[], trim_db=trim_db, soften={k: {a: (list(b) if isinstance(b, tuple) else b) for a, b in v.items()} for k, v in soften.items()}, space=space, soften_phase="zero")
    for tag in layers:
        found = False
        for name, tr in S.tracks.items():
            lb = tr.layers.get(tag)
            if lb is None or name in mute:
                continue
            found = True
            rep["layers"][f"{tag}@{name}"] = float(np.abs(lb).max())
            tr.buf -= lb
        if not found and not any(tag in tr.layers for tr in S.tracks.values()):
            raise KeyError(f"apply_calm: layer {tag!r} was never filled in song {S.name!r}")
    for name in mute:
        tr = S.tracks[name]
        rep["muted"][name] = float(np.abs(tr.buf).max())
        tr.buf[...] = 0.0
    for name, tr in S.tracks.items():
        if tr.duck and tr.duck[0] in mute:
            tr.duck = None  # the ducking trigger is gone: the pad no longer pumps
        if name in mute:
            continue
        tr.gain_db += trim_db.get(name, 0.0)
        sp = soften.get(name)
        if sp:
            if "hs" in sp or "lp" in sp:  # zero-phase on the buffer (before pre_fx / EQ / sat: all linear except sat, which stays after it)
                tr.buf = soften_zero_phase(tr.buf, S.loop_len, sp)
            if "sat" in sp:
                tr.sat = min(tr.sat, sp["sat"])
        if tr.reverb and space != 1.0:
            tr.reverb = {k: v * space for k, v in tr.reverb.items()}
        if float(np.abs(tr.buf).max()) > 1e-9:
            rep["kept"].append(name)
    return rep


def periodic(x, fn, pad_sec: float = 2.5):
    """Run fn on a periodically-extended copy of x so stateful processors (filters, compressors) are seamless at the seam."""
    p = nsamp(pad_sec)
    p = min(p, x.shape[-1])
    ext = np.concatenate([x[..., -p:], x, x[..., :p]], axis=-1)
    y = fn(ext)
    return y[..., p : p + x.shape[-1]]


def master_loop(loop, target_lufs: float = -16.0, ceiling_db: float = -1.5, drive_db_max: float = 18.0, soft: float = 0.0):
    """Gain-stage a loop to the target integrated loudness with a periodic look-ahead limiter. Returns (audio, info)."""
    gain_db = target_lufs - dsp.lufs_integrated(loop)
    y = loop
    info = {}
    for _ in range(6):
        y = periodic(loop * dsp.db2lin(gain_db), lambda x: dsp.limiter(x, ceiling_db, 3.0, 90.0))
        l = dsp.lufs_integrated(y)
        err = target_lufs - l
        if abs(err) < 0.05:
            break
        gain_db += err
        if gain_db > drive_db_max:
            break
    info["lufs"] = dsp.lufs_integrated(y)
    info["gain_db"] = gain_db
    info["peak_db"] = float(dsp.lin2db(np.abs(y).max()))
    return y, info


def master_oneshot(x, target_lufs: float = -16.0, ceiling_db: float = -1.5):
    """Normalise a one-shot (stinger) to the target integrated loudness without exceeding the ceiling."""
    gain_db = target_lufs - dsp.lufs_integrated(x)
    y = dsp.limiter(x * dsp.db2lin(gain_db), ceiling_db, 3.0, 90.0)
    for _ in range(4):
        err = target_lufs - dsp.lufs_integrated(y)
        if abs(err) < 0.1:
            break
        gain_db += err
        y = dsp.limiter(x * dsp.db2lin(gain_db), ceiling_db, 3.0, 90.0)
    return y, {"lufs": dsp.lufs_integrated(y), "gain_db": gain_db, "peak_db": float(dsp.lin2db(np.abs(y).max()))}

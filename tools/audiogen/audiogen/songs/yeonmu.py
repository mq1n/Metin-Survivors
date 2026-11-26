"""Yeonmu Plains -- zone 1 theme. G major-pentatonic world (G A B D E, Mixolydian F as bass colour), 112 BPM, 48 bars (102.857 s).

Pastoral but driving: gayageum/guzheng rolling 3+3+2 eighth-note arpeggios are the engine, daegeum flute sings the theme,
haegeum answers in the B sections, frame drum + buk groove with moktak/rim off-beats and shaker 16ths, plucked bass walks.

Form (bars):  Intro 0-3 | A 4-11 | B 12-19 (lifted to D major) | Break 20-27 (solo, then re-build) | A2 28-35 | B2 36-43 | Outro 44-47
The outro hangs on D7 (V) so that bar 0 (G) resolves it when the loop wraps.

Leitmotif: the menu motif M1 (A4 D5 C5 A4 | G4 A4 C5, D dorian-pentatonic) mapped step-for-step onto the G major pentatonic
ladder gives  D5 | G5 E5 D5 | B4 D5 E5  -- that is exactly the head of the A theme here (rhythm turned into 3+3+2).

Main theme A (flute):  [D5] G5 E5 D5 | B4 D5 E5 | E5 G5 B5 | A5 G5 E5 D5 E5 || G5 E5 G5 | B5 A5 F#5 | E5 G5 A5 | D6 A5 [E5]
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

from .. import dsp
from .. import instruments as I
from ..comp import roll
from ..dsp import SR, midi2hz, nsamp
from ..music import Song, parse_notes, transpose, shift, _TOK, _num

ID = "mus_yeonmu"
LOOP = True

# AG-02 calm variant (music.apply_calm): same notes, tempo, bars and key; no percussion (frame drum, buk, janggu, moktak, rim, shaker,
# cymbal, taiko, gong) and no riser; the plucked arpeggios, pad, bells and the breeze carry it, the flute / haegeum lead is softened.
CALM = dict(
    mute=("perc_low", "perc_hi", "shaker", "gong", "fx"),
    trim_db={"gayageum": -1.5, "guzheng": -2.0, "bass": -3.0, "pad": 2.0, "wind": 3.0, "bells": 1.0},
    soften={"flute": dict(hs=(2600, -3.0), lp=3800), "flute_hi": dict(lp=3600), "haegeum": dict(hs=(2200, -3.0), lp=3600),
            "gayageum": dict(lp=5200), "guzheng": dict(lp=4800)},
    space=1.2,
)

BPM = 112
BARS = 48
BPB = 4

# ----------------------------------------------------------------------------- harmony
# r: root pitch class, iv: arpeggio intervals (colour tones included), bass: bass pitch, pad: close voice-led voicing
CH = {
    "G": dict(r=7, iv=(0, 4, 7, 9), bass=43, pad=[50, 55, 59, 62, 67]),
    "Dx": dict(r=2, iv=(0, 2, 4, 7), bass=42, rt=38, pad=[50, 54, 57, 62, 66]),  # D/F#
    "Em": dict(r=4, iv=(0, 3, 7, 10), bass=40, pad=[52, 55, 59, 62, 67]),
    "C": dict(r=0, iv=(0, 2, 4, 7), bass=36, pad=[52, 55, 60, 64, 67]),
    "Bm": dict(r=11, iv=(0, 3, 7, 10), bass=35, pad=[50, 54, 59, 62, 66]),
    "D": dict(r=2, iv=(0, 2, 4, 7), bass=38, pad=[50, 54, 57, 62, 66]),
    "A": dict(r=9, iv=(0, 2, 4, 7), bass=45, pad=[49, 52, 57, 61, 64]),
    "Am": dict(r=9, iv=(0, 3, 7, 10), bass=45, pad=[52, 57, 60, 64, 67]),
    "Dsus": dict(r=2, iv=(0, 2, 5, 7), bass=38, pad=[50, 55, 57, 62, 64]),
    "D7": dict(r=2, iv=(0, 4, 7, 10), bass=38, pad=[50, 54, 57, 60, 66]),
}

PROG = (
    ["G", "Em", "C", ("Dsus", "D")]  # intro 0-3
    + ["G", "Dx", "Em", "C", "G", "Bm", "C", ("D", "A")]  # A 4-11 (A on beats 3-4 = V of D, pivot into B)
    + ["D", "A", "Bm", "G", "D", "A", ("G", "A"), "D"]  # B 12-19 (D major)
    + ["G", "Em", "C", "D", "Em", "C", "Am", ("Dsus", "D")]  # break 20-27
    + ["G", "Dx", "Em", "C", "G", "Bm", "C", ("D", "A")]  # A2 28-35
    + ["D", "A", "Bm", "G", "D", "A", ("G", "A"), "D"]  # B2 36-43
    + ["G", "C", "Am", "D7"]  # outro 44-47 (hangs on the dominant)
)
assert len(PROG) == BARS

SCALE_G = {7, 9, 11, 0, 2, 4, 6}  # G major
SCALE_D = {2, 4, 6, 7, 9, 11, 1}  # D major


def key_scale(bar: int):
    return SCALE_D if (12 <= bar < 20 or 36 <= bar < 44) else SCALE_G


def bar_segs(bar: int):
    p = PROG[bar]
    if isinstance(p, tuple):
        return [(p[0], 0.0, 2.0), (p[1], 2.0, 2.0)]
    return [(p, 0.0, 4.0)]


def chord_at(beat: float) -> str:
    bar = min(int(beat // BPB), BARS - 1)
    b = beat - bar * BPB
    segs = bar_segs(bar)
    for ch, b0, d in segs:
        if b0 - 1e-9 <= b < b0 + d - 1e-9:
            return ch
    return segs[-1][0]


def ladder(ch: str, center: int = 57, n: int = 10):
    """Ascending chord-tone ladder starting on the chord root nearest `center`."""
    c = CH[ch]
    base = c["r"] + 12 * round((center - c["r"]) / 12)
    out = sorted(base + iv + 12 * o for o in (0, 1, 2, 3) for iv in c["iv"])
    return out[:n]


def pent(base_midis, octaves=4):
    return [m + 12 * o for o in range(octaves) for m in base_midis]


PENT_G = pent((55, 57, 59, 62, 64))  # G3 A3 B3 D4 E4 ...
PENT_D = pent((50, 52, 54, 57, 59))  # D3 E3 F#3 A3 B3 ...

# ----------------------------------------------------------------------------- dynamics (0..1 over bars)
DYN_BARS = [0, 3.5, 4, 11.5, 12, 19.5, 20, 23.5, 24, 27.5, 28, 35.5, 36, 43.5, 44, 47.5, 48]
DYN_VALS = [0.30, 0.46, 0.60, 0.70, 0.84, 0.88, 0.32, 0.38, 0.46, 0.86, 0.92, 0.94, 1.00, 1.00, 0.50, 0.26, 0.30]


def dyn(beat: float) -> float:
    return float(np.interp(beat / BPB, DYN_BARS, DYN_VALS))


def dv(beat: float, lo: float = 0.55) -> float:
    """Dynamic scale in [lo, 1] (for lead instruments that should not drop as far as the accompaniment)."""
    return lo + (1.0 - lo) * dyn(beat)


# ----------------------------------------------------------------------------- melodic material (bar strings; '|' per bar)
INTRO_FL = "r:4 | r:4 | D5:2 G5:2 | E5:2 r:1 D5:1"
A_FL = """
G5:1.5 E5:1.5 D5:1 | B4:1.5 D5:1.5 E5:1 | E5:1 G5:1 B5:2^trilld | A5:1.5 G5:.5 E5:1 D5:.5 E5:.5 |
G5:1.5^grace E5:1.5 G5:1 | B5:1.5 A5:1.5 F#5:1^fall | E5:1.5 G5:1.5 A5:1 | D6:2^trill A5:1 r:.5 E5:.5
"""
B_FL = """
F#5:1 A5:1 D6:2 | C#6:1.5 B5:.5 A5:1 r:1 | B5:1 D6:1 F#6:1.5 E6:.5 | D6:2 B5:1 G5:1^fall |
F#5:1 A5:1 D6:1 E6:1 | E6:2 C#6:1 A5:1 | B5:1.5 D6:.5 E6:1 C#6:1 | D6:3^trill r:1
"""
HAEGEUM_B = """
D5:2 E5:2 | C#5:3 E5:1 | D5:1.5 F#5:1.5 E5:1 | D5:2 B4:2 |
A4:2 D5:1 F#5:1 | C#5:2 E5:2 | D5:2 C#5:2 | D5:4
"""
BREAK_SOLO = """
D5:1 G5:1.5 E5:1.5 | B4:1.5 D5:1.5 E5:1 | G5:1 A5:.5 G5:.5 E5:1 D5:1 | A4:1 D5:1 F#5:1 A5:1
"""
BREAK_FL = "r:4 | r:4 | E5:2 A5:2 | A5:1.5 G5:.5 F#5:1 D5:1"  # bars 24-27
BREAK_HAE = "B4:4 | C5:2 E5:2 | E5:4 | D5:4"  # bars 24-27
A2_FL = """
G5:1.5^grace E5:1.5 D5:1 | B4:1.5 D5:1 E5:.5 F#5:1 | E5:1 G5:1 B5:2^trilld | A5:1.5 G5:.5 E5:1 D5:.5 E5:.5 |
G5:1.5 E5:1.5 G5:1 | B5:1.5 A5:1.5 F#5:1 | E5:1 G5:1 A5:1 B5:1^fall | D6:2^trill A5:1 r:.5 E5:.5
"""
B2_FL = """
F#5:1 A5:1^grace D6:2 | C#6:1.5 B5:.5 A5:1 C#6:.5 E6:.5 | F#6:1.5 E6:.5 D6:1 B5:1 | D6:2 B5:1 G5:1^fall |
A5:1 D6:1 F#6:2^trill | E6:2 C#6:1 E6:1 | B5:1 D6:1 E6:1 C#6:1 | D6:4^trill
"""
OUTRO_FL = "G5:2 E5:1 D5:1 | E5:2 D5:1 E5:1 | A5:2 G5:1 E5:1 | F#5:3.5 r:.5"


def parse_bars(text: str, start_bar: int, default_vel: float = 0.75):
    """Parse a '|'-separated bar string; assert every bar is exactly 4 beats. Adds 'bar' to each note."""
    out = []
    parts = [p for p in text.replace("\n", " ").split("|")]
    parts = [p for p in parts if p.strip()]
    for i, part in enumerate(parts):
        tot = 0.0
        for tok in part.split():
            m = _TOK.match(tok)
            if not m:
                raise ValueError(f"bad token {tok!r}")
            if m.group("name") == "-":
                tot += _num(m.group("dur")) if m.group("dur") else 1.0
                continue
            tot += _num(m.group("dur")) if m.group("dur") else 1.0
        assert abs(tot - BPB) < 1e-6, f"bar {start_bar + i}: {part!r} sums to {tot}"
        for nt in parse_notes(part, (start_bar + i) * BPB, default_vel=default_vel):
            nt["bar"] = start_bar + i
            out.append(nt)
    return out


# ----------------------------------------------------------------------------- custom instruments
def _sm(x, ms=5.0):
    k = max(1, int(SR * ms / 1000.0))
    return ndimage.uniform_filter1d(x, k, mode="nearest")


def flute_o(freq, dur, vel=0.7, rng=None, orn=(), **kw):
    """Daegeum with folk ornaments: ('trill', start_frac, semis, rate_hz) | ('grace', semis, secs) | ('fall', semis, secs) | ('scoop', semis, secs)."""
    rel = kw.get("release", 0.16)
    n = nsamp(dur + rel) + 4096
    t = np.arange(n) / SR
    semis = np.zeros(n)
    for o in orn:
        k = o[0]
        if k == "trill":
            _, frac, iv, rate = o
            t0 = frac * dur
            gate = (((t - t0) * rate) % 1.0 >= 0.5) & (t >= t0) & (t <= dur)
            semis += iv * _sm(gate.astype(float), 5.0)
        elif k == "grace":
            _, iv, gd = o
            semis += iv * _sm((t < gd).astype(float), 7.0)
        elif k == "fall":
            _, iv, tf = o
            u = np.clip((t - (dur - tf)) / (tf + 0.12), 0.0, 1.0)
            semis -= iv * u ** 1.5
        elif k == "scoop":
            _, iv, ts = o
            semis -= iv * (1.0 - np.clip(t / ts, 0.0, 1.0)) ** 1.5
    curve = 2.0 ** (semis / 12.0) if orn else None
    return I.flute(freq, dur, vel=vel, rng=rng, pitch_curve=curve, **kw)


def haegeum(freq, dur, vel=0.7, rng=None, slide=-2.0, **kw):
    if slide:
        kw["glide_from"] = freq * 2.0 ** (slide / 12.0)
    return I.bowed(freq, dur, vel=vel, rng=rng, kind="haegeum", **kw)


def bass_pluck(freq, dur, vel=0.8, rng=None, t60=0.9, sub=0.5, bright=0.3):
    """Plucked electric/acoustic-style bass: Karplus-Strong with bass body + a quiet sine/sub layer for weight."""
    y = I.pluck(freq, dur, vel=vel, rng=rng, t60=t60, bright=bright, pick=0.22, damp=0.18, noise_mix=0.2, body="bass", click=0.2, sat=1.3)
    s = I.sub_bass(freq, dur, vel=vel, release=0.06, drive=1.0, harm=0.12, rng=rng)
    n = max(len(y), len(s))
    out = np.zeros(n)
    out[: len(y)] += y
    out[: len(s)] += sub * s * np.exp(-np.arange(len(s)) / SR / (0.45 * dur + 0.12))  # the sub dies away like the pluck instead of sustaining
    return out


def wind(vel=0.5, rng=None, dur=10.0, lo=380.0, hi=1500.0, fade=3.5):
    """Slow meadow breeze: band-passed noise with a drifting centre frequency and gusting level (stereo, decorrelated)."""
    n = nsamp(dur)
    t = np.arange(n) / SR
    env = np.minimum(1.0, t / fade) * np.minimum(1.0, (dur - t) / fade)
    out = np.zeros((2, n))
    for c in range(2):
        fc = lo + (hi - lo) * (0.5 + 0.5 * dsp.smooth_noise(n, rng, 0.22))
        y = dsp.sweep_filter(rng.standard_normal(n), "bp", fc, 0.9, hop=128)
        out[c] = y * (0.55 + 0.45 * dsp.smooth_noise(n, rng, 0.16)) * env
    out /= np.abs(out).max() + 1e-9
    return out * (0.3 + 0.5 * vel)


def swell(vel=0.7, rng=None, dur=1.9, lo=1400.0, hi=9500.0):
    """Rising noise swell (reverse-cymbal style) that peaks at its very end; place so that it ends on the downbeat."""
    n = nsamp(dur)
    nz = rng.standard_normal(n)
    fc = np.geomspace(lo, hi, n)
    y = dsp.sweep_filter(nz, "bp", fc, 0.7, hop=64)
    env = (np.arange(n) / n) ** 2.4
    y = y * env
    y = y / (np.abs(y).max() + 1e-9)
    return dsp.fade(y, 0.05, 0.004) * (0.25 + 0.5 * vel)


# ----------------------------------------------------------------------------- bass patterns
# (beat, role, dur_beats, vel): roles R root, F fifth, T third, O octave, A approach to next bar's root, R2 root of the 2nd half chord
TRES = [(0, "R", 1.4, 0.95), (1.5, "F", 1.3, 0.62), (3, "A", 0.9, 0.7)]
WALK = [(0, "R", 0.95, 0.95), (1, "F", 0.9, 0.6), (2, "T", 0.95, 0.72), (3, "A", 0.9, 0.7)]
BOUNCE = [(0, "R", 0.9, 0.95), (1, "O", 0.45, 0.55), (1.5, "F", 0.45, 0.62), (2, "R", 0.9, 0.78), (3, "O", 0.45, 0.55), (3.5, "A", 0.45, 0.72)]
GAL = [(0, "R", 0.45, 0.95), (0.5, "R", 0.22, 0.5), (0.75, "O", 0.22, 0.6), (1.5, "F", 0.45, 0.65), (2, "R", 0.45, 0.88), (2.5, "R", 0.22, 0.5), (2.75, "O", 0.22, 0.6), (3, "A", 0.9, 0.72)]
SPARSE = [(0, "R", 3.5, 0.8)]
SPLIT = [(0, "R", 0.95, 0.95), (1, "T", 0.9, 0.6), (2, "R2", 0.95, 0.85), (3, "A", 0.9, 0.7)]


def bass_note(ch, role, bar, last):
    c = CH[ch]
    R = c["bass"]
    rt = c.get("rt", R)  # chord root pitch (differs from the bass note on slash chords)
    if role in ("R", "R2"):
        return R
    if role == "F":
        return rt + 7 if rt + 7 <= 47 else rt - 5
    if role == "T":
        third = rt + (3 if c["iv"][1] == 3 else 4)
        return third if third <= 50 else third - 12
    if role == "O":
        return rt + 12
    if role == "A":
        nxt_bar = (bar + 1) % BARS
        target = CH[bar_segs(nxt_bar)[0][0]]["bass"]
        sc = key_scale(bar) | key_scale(nxt_bar)
        order = (1, 2, -1, -2) if last >= target else (-1, -2, 1, 2)  # step into the next root from the side we are on
        for d in order:
            m = target + d
            if m % 12 in sc and m != last:
                return m
        return target - 2
    raise ValueError(role)


# ----------------------------------------------------------------------------- build
def build() -> Song:
    S = Song("yeonmu", bpm=BPM, bars=BARS, seed=111)
    sp = S.spb

    S.track("pad", gain_db=-11.0, reverb={"hall": 0.3}, eq=[("hp", 110), ("lp", 5200)], duck=("perc_low", 2.2, 220), width=1.5)
    S.track("gayageum", pan=-0.42, gain_db=-6.5, reverb={"plate": 0.15, "hall": 0.18}, eq=[("hp", 110)])
    S.track("guzheng", pan=0.45, gain_db=-9.0, reverb={"plate": 0.22, "hall": 0.2}, eq=[("hp", 220), ("peak", 3600, 1.0, -2.5)])
    S.track("flute", pan=0.05, gain_db=-2.5, reverb={"hall": 0.32, "plate": 0.1}, eq=[("hp", 150), ("peak", 3200, 0.9, -3.0), ("lp", 7200)])
    S.track("flute_hi", pan=0.25, gain_db=-10.0, reverb={"hall": 0.4}, eq=[("hp", 400), ("lp", 5800)])
    S.track("haegeum", pan=-0.28, gain_db=-7.5, reverb={"hall": 0.3}, eq=[("hp", 180), ("peak", 2500, 1.0, -2.0)])
    S.track("bells", pan=0.35, gain_db=-12.5, reverb={"air": 0.5, "hall": 0.2}, eq=[("hp", 300)])
    S.track("bass", gain_db=-7.0, eq=[("hp", 38)], sat=0.8)
    S.track("perc_low", gain_db=-3.5, reverb={"arena": 0.16}, eq=[("hp", 30)])
    S.track("perc_hi", pan=0.22, gain_db=-7.5, reverb={"plate": 0.2}, eq=[("hp", 250)])
    S.track("shaker", pan=-0.35, gain_db=-11.5, eq=[("hp", 3500)])
    S.track("gong", gain_db=-14.0, reverb={"hall": 0.4})
    S.track("fx", gain_db=-16.0, reverb={"hall": 0.3})
    S.track("wind", gain_db=-21.0, reverb={"hall": 0.2}, eq=[("hp", 250), ("lp", 4200)])
    S.master_comp = dict(thresh_db=-15.0, ratio=1.5, attack_ms=30.0, release_ms=260.0, makeup_db=0.0)

    # ------------------------------------------------------------------ pad
    for bar in range(BARS):
        segs = bar_segs(bar)
        for si, (ch, b0, d) in enumerate(segs):
            beat = bar * BPB + b0
            last = si == len(segs) - 1
            v = 0.34 + 0.5 * dyn(beat)
            kind = "warm"
            att, rel = 0.55, 1.1
            if 20 <= bar < 24:
                kind, v, att, rel = "glass", 0.46, 0.9, 1.6
            elif bar < 4 or bar >= 44:
                kind, att, rel = "strings", 0.9, 1.4
            S.chord("pad", CH[ch]["pad"], beat, d + (0.0 if bar == BARS - 1 else (0.8 if last else 0.15)), vel=v, kind=kind, attack=att, release=rel if bar < BARS - 1 else 0.9, voices=6, spread=9.0,
                    cutoff_open=2600 if bar >= 4 else 1800, cutoff_closed=550)

    # ------------------------------------------------------------------ bass
    def bass_bar(bar, pat, vscale=1.0, t60=0.9, sub=0.5):
        segs = bar_segs(bar)
        last = CH[segs[0][0]]["bass"]
        for beat_in, role, d, v in pat:
            beat = bar * BPB + beat_in
            ch = chord_at(beat)
            if role == "R2":
                ch = segs[-1][0]
            m = bass_note(ch, role, bar, last)
            last = m
            S.note("bass", bass_pluck, beat, m, d, min(v * vscale * (0.62 + 0.38 * dyn(beat)), 1.0), t60=t60, sub=sub, jitter_ms=3.0)

    def sparse_bar(bar, d_end=0.3, v=0.8):
        for ch, b0, d in bar_segs(bar):
            m = CH[ch]["bass"]
            S.note("bass", bass_pluck, bar * BPB + b0, m, d - d_end, v * (0.62 + 0.38 * dyn(bar * BPB)), t60=1.4, sub=0.6, jitter_ms=3.0)

    for bar in range(0, 2):  # intro: soft sine roots only
        S.note("bass", I.sub_bass, bar * BPB, CH[bar_segs(bar)[0][0]]["bass"], 3.8, 0.5, attack=0.08, release=0.5)
    for bar in range(2, 4):
        sparse_bar(bar, v=0.7)
    for bar in range(4, 12):
        bass_bar(bar, SPLIT if isinstance(PROG[bar], tuple) else TRES)
    for bar in range(12, 20):
        bass_bar(bar, SPLIT if isinstance(PROG[bar], tuple) else WALK, vscale=1.0)
    for bar in range(20, 24):
        sparse_bar(bar, d_end=0.5, v=0.65)
    for bar in range(24, 28):
        bass_bar(bar, SPLIT if isinstance(PROG[bar], tuple) else WALK, vscale=0.9)
    for bar in range(28, 36):
        bass_bar(bar, SPLIT if isinstance(PROG[bar], tuple) else BOUNCE)
    for bar in range(36, 44):
        bass_bar(bar, SPLIT if isinstance(PROG[bar], tuple) else GAL)
    for bar in range(44, 48):
        sparse_bar(bar, d_end=0.4, v=0.75 - 0.08 * (bar - 44))

    # ------------------------------------------------------------------ plucked arpeggio engine
    ACC8 = [1.0, 0.66, 0.76, 0.96, 0.62, 0.74, 0.92, 0.64]  # 3+3+2 accents
    P_A1 = [0, 2, 3, 1, 3, 4, 2, 3]
    P_A2 = [0, 3, 4, 2, 3, 5, 4, 2]
    P_B1 = [0, 2, 4, 1, 3, 5, 2, 4]
    P_B2 = [0, 4, 3, 1, 5, 4, 2, 5]
    P_FILL = [0, 2, 3, 1, 2, 4, 5, 7]

    def arp_bar(track, bar, pat, center, vel, t60, dur_b, body, bright, pick, step=0.5, start=0.0, accent=ACC8, jit=4.0, **kw):
        for i, idx in enumerate(pat):
            beat = bar * BPB + start + i * step
            ch = chord_at(beat)
            m = ladder(ch, center, 11)[idx]
            v = vel * accent[i % len(accent)] * (0.3 + 0.7 * dyn(beat)) * 1.25
            S.note(track, I.pluck, beat, m, dur_b, min(v, 1.0), t60=t60, bright=bright, body=body, pick=pick, jitter_ms=jit, click=0.22, **kw)

    def gz1(bar, pat, center=55, vel=0.7, **kw):
        arp_bar("gayageum", bar, pat, center, vel, 1.5, 2.2, "gayageum", 0.5, 0.2, **kw)

    def gz2(bar, pat, center=64, vel=0.55, step=0.5, start=0.5, accent=(1.0,), **kw):
        arp_bar("guzheng", bar, pat, center, vel, 1.2, 1.8, "guzheng", 0.65, 0.12, step=step, start=start, accent=accent, **kw)

    def tremolo(track, beat, midi, dur_b, v0, v1, step=0.0625):
        body = "gayageum" if track == "gayageum" else "guzheng"
        n = int(round(dur_b / step))
        for k in range(n):
            u = k / max(n - 1, 1)
            S.note(track, I.pluck, beat + k * step, midi, 0.9, v0 + (v1 - v0) * u, t60=1.0, bright=0.6, body=body, pick=0.15, jitter_ms=2.0, vel_jitter=0.12)

    def gliss(beat0, scale, i0, i1, v0=0.5, v1=0.85, step=0.125, track="guzheng", t60=1.3):
        n = abs(i1 - i0) + 1
        for k in range(n):
            ix = i0 + k if i1 >= i0 else i0 - k
            u = k / max(n - 1, 1)
            S.note(track, I.pluck, beat0 + k * step, scale[ix], 1.6, v0 + (v1 - v0) * u, t60=t60, bright=0.65, body="guzheng", pick=0.12, jitter_ms=1.5, click=0.22)

    # --- intro: slow arpeggios (quarter notes), 8ths from bar 2
    for bar in (0, 1):
        pat = [0, 2, 3, 4] if bar == 0 else [0, 2, 4, 3]
        for k, idx in enumerate(pat):
            beat = bar * BPB + k
            ch = chord_at(beat)
            S.note("gayageum", I.pluck, beat, ladder(ch, 55, 11)[idx], 3.0, 0.5 + 0.03 * k, t60=2.4, bright=0.45, body="gayageum", pick=0.2,
                   bend=[(0, -1.0), (0.16, 0.0)] if k == 0 else None, vib_depth=20 if k == 0 else 0)
    gz1(2, P_A1, vel=0.5)
    gz1(3, [0, 2, 3, 1, 3, 4, 5, 7], vel=0.58)
    # guzheng: rake landing on G at the loop start, flourish out of the intro
    gliss(0.0, PENT_G, 5, 14, 0.45, 0.8, step=0.0625)
    gliss(3 * BPB + 2.5, PENT_G, 4, 11, 0.45, 0.8, step=0.125)

    # --- A (4-11): gayageum engine; guzheng sparkles on phrase ends
    for bar in range(4, 12):
        if bar % 4 == 3:
            gz1(bar, P_FILL)
        else:
            gz1(bar, P_A1 if bar % 2 == 0 else P_A2)
    for bar in (7, 11):
        ch = chord_at(bar * BPB + 3)
        L = ladder(ch, 65, 8)
        S.note("guzheng", I.pluck, bar * BPB + 3.0, L[4 if bar == 7 else 3], 1.5, 0.62, t60=2.0, bright=0.65, body="guzheng", bend=[(0, -1.5), (0.18, 0.0)], vib_depth=30)
    for bar in (5, 9):
        gz2(bar, [3, 5], start=3.0, step=0.5, vel=0.42)
    for bar in (8, 9, 10):
        gz2(bar, [1, 3, 2, 4], vel=0.36)

    # --- B (12-19): richer (guzheng joins on the off-beats), phrase fills
    for bar in range(12, 20):
        if bar % 4 == 3:
            gz1(bar, P_FILL, center=57)
        else:
            gz1(bar, P_B1 if bar % 2 == 0 else P_B2, center=57, vel=0.74)
        if bar % 4 != 3:
            gz2(bar, [1, 3, 2, 4] if bar % 2 == 0 else [2, 4, 3, 5], vel=0.5)
    gliss(15 * BPB + 2.5, PENT_D, 7, 15, 0.5, 0.9, step=0.125)
    gliss(19 * BPB + 2.0, PENT_D, 3, 17, 0.4, 0.9, step=0.1)

    # --- break (20-27): gayageum + guzheng call-and-response solo, then re-build
    solo = parse_bars(BREAK_SOLO, 20)
    for nt in solo:
        long_ = nt["dur"] >= 1.0
        track = "gayageum" if nt["bar"] in (20, 21) else "guzheng"
        if (nt["bar"], round(nt["beat"] - nt["bar"] * BPB, 2)) in ((21, 3.0), (23, 3.0)):
            tremolo(track, nt["beat"], nt["midi"], nt["dur"], 0.3 if nt["bar"] == 21 else 0.35, 0.55 if nt["bar"] == 21 else 0.85)
            continue
        S.note(track, I.pluck, nt["beat"], nt["midi"], nt["dur"] + 1.0, 0.55,
               t60=2.4, bright=0.5, body="gayageum" if track == "gayageum" else "guzheng", pick=0.18,
               bend=[(0, -1.2), (0.14, 0.0)] if long_ else None, vib_depth=24 if long_ else 0, jitter_ms=8.0)
    # soft tremolo-ish re-plucks under the held solo notes (very sparse)
    for bar in (20, 21, 22, 23):
        ch = chord_at(bar * BPB)
        L = ladder(ch, 52, 8)
        S.note("gayageum", I.pluck, bar * BPB, L[0], 3.5, 0.42, t60=3.0, bright=0.4, body="gayageum", pick=0.2)
        S.note("gayageum", I.pluck, bar * BPB + 2.0, L[2], 2.5, 0.34, t60=2.6, bright=0.4, body="gayageum", pick=0.2)
    gliss(20 * BPB, PENT_G, 12, 3, 0.45, 0.2, step=0.1)  # falling rake from the previous peak
    gliss(23 * BPB + 2.5, PENT_G, 4, 13, 0.4, 0.8, step=0.125)
    for bar in range(24, 28):
        if bar == 27:
            gz1(bar, P_FILL, center=57, vel=0.7)
        else:
            gz1(bar, P_A1 if bar % 2 == 0 else P_A2, center=55, vel=0.66)
        if bar >= 26:
            gz2(bar, [1, 3, 2, 4], vel=0.45)
    gliss(27 * BPB + 3.0, PENT_G, 4, 15, 0.5, 1.0, step=0.0625)

    # --- A2 (28-35): gayageum higher + guzheng off-beats from the first bar
    for bar in range(28, 36):
        if bar % 4 == 3:
            gz1(bar, P_FILL, center=57, vel=0.78)
        else:
            gz1(bar, [P_A2, P_B1, P_B2, P_A1][bar % 4] if bar % 4 < 3 else P_A1, center=57, vel=0.76)
        if bar % 4 != 3:
            gz2(bar, [2, 4, 3, 5], vel=0.5)
        else:
            gz2(bar, [3, 5, 4, 6], vel=0.5, start=0.5)
    gliss(31 * BPB + 3.0, PENT_G, 6, 15, 0.5, 0.9, step=0.0625)
    gliss(35 * BPB + 2.5, PENT_D, 7, 17, 0.5, 0.95, step=0.1)

    # --- B2 (36-43): everything; guzheng gallop 8th+16th+16th pairs on the off-beats
    for bar in range(36, 44):
        if bar % 4 == 3:
            gz1(bar, P_FILL, center=57 if bar < 40 else 60, vel=0.82)
        else:
            gz1(bar, P_B1 if bar % 2 == 0 else P_B2, center=57 if bar < 40 else 60, vel=0.8)
        if bar % 4 != 3:
            pairs = [(2, 4), (3, 5), (2, 4), (4, 6)] if bar % 2 == 0 else [(3, 5), (4, 6), (3, 5), (5, 7)]
            for k, (a, b) in enumerate(pairs):
                for off, idx in ((0.5, a), (0.75, b)):
                    beat = bar * BPB + k + off
                    ch = chord_at(beat)
                    S.note("guzheng", I.pluck, beat, ladder(ch, 64, 8)[idx], 1.6, 0.5 * (0.3 + 0.7 * dyn(beat)) * 1.25 * (1.0 if off == 0.5 else 0.8),
                           t60=1.1, bright=0.6, body="guzheng", pick=0.12, jitter_ms=3.0, click=0.22)
        else:
            gz2(bar, [3, 5, 4, 6], vel=0.55)
    gliss(39 * BPB + 3.0, PENT_D, 7, 17, 0.5, 0.95, step=0.0625)
    gliss(43 * BPB + 2.5, PENT_D, 5, 19, 0.5, 1.0, step=0.1)

    # --- outro (44-47): arpeggios thin out, last beat a rising D7 rake that lands on G at bar 0
    gz1(44, P_A1, vel=0.55)
    gz1(45, [0, 2, 3, 4], vel=0.5, step=1.0)
    gz1(46, [0, 3, 4], vel=0.46, step=1.0 + 0.0)
    ch = "D7"
    L = ladder(ch, 57, 12)
    S.note("gayageum", I.pluck, 47 * BPB, L[0], 3.0, 0.45, t60=3.0, bright=0.4, body="gayageum", pick=0.2)
    S.note("gayageum", I.pluck, 47 * BPB + 1.5, L[2], 2.0, 0.4, t60=2.6, bright=0.4, body="gayageum", pick=0.2)
    for k, ix in enumerate([2, 3, 4, 5, 6, 7, 8]):  # rising D7 rake, ends on D6 (the fifth of G) so it does not rub against the arrival
        S.note("guzheng", I.pluck, 47 * BPB + 3.0 + k * 0.14, L[ix], 1.5, 0.4 + 0.07 * k, t60=1.5, bright=0.65, body="guzheng", pick=0.12, jitter_ms=1.5, click=0.22)

    # ------------------------------------------------------------------ flute (daegeum)
    def orn_for(mods, midi, bar, dur):
        out = []
        sc = key_scale(bar)
        for md in mods:
            if md == "trill":
                iv = next(d for d in (1, 2, 3) if (midi + d) % 12 in sc)
                out.append(("trill", 0.45 if dur < 3 else 0.55, iv, 8.5))
            elif md == "trilld":
                iv = next(d for d in (1, 2, 3) if (midi - d) % 12 in sc)
                out.append(("trill", 0.45, -iv, 8.0))
            elif md == "grace":
                iv = next(d for d in (1, 2, 3) if (midi + d) % 12 in sc)
                out.append(("grace", iv, 0.055))
            elif md == "fall":
                out.append(("fall", 2.5, 0.25))
            elif md == "scoop":
                out.append(("scoop", 1.6, 0.11))
        return out

    def put_flute(track, notes, vel_mult=1.0, octave=0, inst=flute_o, breath=0.32, tone=1.0, vib=15, release=0.18, min_midi=0, max_midi=999, **kw):
        for nt in notes:
            m = nt["midi"] + octave
            if m < min_midi or m > max_midi:
                continue
            mods = nt["mods"]
            orn = orn_for(mods, nt["midi"], nt["bar"], nt["dur"]) if inst is flute_o else ()
            extra = dict(kw)
            if "grace" in mods:
                extra["attack"] = 0.03
            if inst is flute_o:
                extra["orn"] = orn
            S.note(track, inst, nt["beat"], m, nt["dur"] * 0.97, min(nt["vel"] * vel_mult * dv(nt["beat"]), 1.0), vib_depth=vib * (2.0 if "vib" in mods else 1.0),
                   breath=breath, tone=tone, release=release, **extra)

    put_flute("flute", parse_bars(INTRO_FL, 0, 0.62), 0.9, breath=0.42, attack=0.25)
    put_flute("flute", parse_bars(A_FL, 4, 0.78), 1.0, scoop=0.55)
    put_flute("flute", parse_bars(B_FL, 12, 0.82), 1.0, breath=0.3, tone=0.9, vib=17, buzz=0.14)
    put_flute("flute", parse_bars(BREAK_FL, 24, 0.7), 0.95, breath=0.34, attack=0.12)
    a2 = parse_bars(A2_FL, 28, 0.84)
    put_flute("flute", a2, 1.0, breath=0.3, vib=18, scoop=0.5)
    put_flute("flute_hi", a2, 0.55, octave=12, max_midi=96, breath=0.25, tone=0.8, vib=12, attack=0.1)
    b2 = parse_bars(B2_FL, 36, 0.88)
    put_flute("flute", b2, 1.0, breath=0.3, tone=0.92, vib=19, buzz=0.14)
    put_flute("flute_hi", [n for n in b2 if n["bar"] >= 40], 0.5, octave=12, max_midi=96, breath=0.25, tone=0.8, vib=12, attack=0.1)
    put_flute("flute", parse_bars(OUTRO_FL, 44, 0.55), 0.85, breath=0.42, attack=0.2, release=0.5)

    # ------------------------------------------------------------------ haegeum
    def put_hae(notes, vel_mult=1.0, octave=0, slide=-2.0, vib=22, attack=0.28, release=0.3):
        for nt in notes:
            S.note("haegeum", haegeum, nt["beat"], nt["midi"] + octave, nt["dur"], min(nt["vel"] * vel_mult * dv(nt["beat"], 0.6), 1.0), slide=slide,
                   vib_depth=vib, attack=attack, release=release, voices=2)

    put_hae(parse_bars(HAEGEUM_B, 12, 0.7))
    put_hae(parse_bars(BREAK_HAE, 24, 0.55), attack=0.5, release=0.5)
    put_hae(a2, 0.78, octave=-12, slide=-1.0, attack=0.15)
    put_hae(b2, 0.82, octave=-12, slide=-1.0, attack=0.15)

    # ------------------------------------------------------------------ bells / chimes
    def bell(beat, midi, vel=0.5, dur=4.0, kind="glass", **kw):
        S.note("bells", I.bell, beat, midi, dur, vel * (0.6 + 0.4 * dyn(beat)), kind=kind, **kw)

    bell(0, 91, 0.55, 5.0)
    bell(1 * BPB + 2, 83, 0.4, 4.0)
    bell(2 * BPB + 1.5, 88, 0.4, 4.0)
    bell(3 * BPB + 0, 86, 0.4, 4.0)
    for bar, notes in ((6, [(2, 95)]), (7, [(3.0, 86), (3.5, 88)]), (9, [(2.5, 90)]), (10, [(0, 88), (2, 91)]), (11, [(0, 93)])):
        for b, m in notes:
            bell(bar * BPB + b, m, 0.4, 3.5)
    for bar in (12, 16):
        bell(bar * BPB, 86, 0.55, 5.0)
        bell(bar * BPB + 2, 93, 0.38, 4.0)
    for bar in (14, 18):
        for k, m in enumerate([86, 90, 93, 98]):
            bell(bar * BPB + 3.0 + k * 0.25 - 0.0, m, 0.35, 3.0, kind="chime")
    S.note("bells", I.bell, 20 * BPB, 43, 7.0, 0.6, kind="temple", gain=1.0)
    # break bells: a quiet glass-bell reading of the M1G motif (D G E D | B D)
    for beat, m in [(22 * BPB + 0, 86), (22 * BPB + 1, 91), (22 * BPB + 2.5, 88), (23 * BPB + 0, 86), (23 * BPB + 1.5, 83), (23 * BPB + 3, 86)]:
        bell(beat, m, 0.45, 4.5)
    for bar in (24, 26):
        bell(bar * BPB + 2, 90, 0.4, 3.5)
    for k, m in enumerate([86, 88, 91, 93, 95]):
        bell(27 * BPB + 2.5 + k * 0.3, m, 0.4, 3.0, kind="chime")
    for bar in (28, 32, 36, 40):
        for k, m in enumerate([79, 83, 86, 91]):
            bell(bar * BPB + 0.0 + k * 0.5, m, 0.34, 3.5)
        if bar in (28, 36):
            S.note("bells", I.bell, bar * BPB, 98, 5.0, 0.35, kind="chime", gain=1.0)
    for bar in (30, 34, 38, 42):
        bell(bar * BPB + 2.0, 93, 0.36, 3.5)
        bell(bar * BPB + 3.0, 98, 0.3, 3.0)
    for beat, m in [(44 * BPB, 91), (44 * BPB + 2, 88), (45 * BPB + 1, 86), (46 * BPB + 0, 93), (46 * BPB + 2.5, 88), (47 * BPB + 1, 86)]:
        bell(beat, m, 0.38, 5.0)

    # ------------------------------------------------------------------ gong
    # tuned so the inharmonic modes (x1.51 = a fifth, x2.04 = octave, x2.63 = fourth) stay inside the G / D harmony
    S.note("gong", I.gong, 0.0, 55, 8.0, 0.7)
    S.note("gong", I.gong, 20 * BPB, 55, 8.0, 0.6)
    S.note("gong", I.gong, 28 * BPB, 55, 9.0, 0.95)
    S.note("gong", I.gong, 36 * BPB, 50, 9.0, 0.8)
    S.note("gong", I.gong, 44 * BPB, 55, 9.0, 0.55)

    # ------------------------------------------------------------------ percussion
    def pat(track, fn, text, bar, vm, scale=1.0, **kw):
        d = scale * (0.4 + 0.6 * dyn(bar * BPB))
        S.pattern(track, fn, text, bar, vel_map={k: v * d for k, v in vm.items()}, **kw)

    for bar in range(2, 4):  # intro heartbeat
        S.hit("perc_low", I.frame_drum, bar * BPB + 0, 0.42, freq=196.0)
        S.hit("perc_low", I.frame_drum, bar * BPB + 2, 0.32, freq=196.0)
    for bar in range(2, 4):
        pat("shaker", I.shaker, "x.g.o.g.x.g.o.g.", bar, {"x": 0.30, "o": 0.2, "g": 0.14})

    def groove_A(bar, strong=1.0, gallop=False):
        pat("perc_low", I.buk, "X.....g.x.....g.", bar, {"X": 0.62, "x": 0.46, "g": 0.2}, scale=strong, freq=98.0)
        pat("perc_low", I.frame_drum, "....x.......x...", bar, {"x": 0.5}, scale=strong, freq=196.0, jingle=0.7)
        pat("perc_hi", I.rim_click, "..g...o...g...o.", bar, {"o": 0.3, "g": 0.2})
        pat("shaker", I.shaker, "xgogxgogxgogxgog", bar, {"x": 0.38, "o": 0.28, "g": 0.18})
        if bar % 2 == 1:
            S.hit("perc_hi", I.moktak, bar * BPB + 3.5, 0.42 * (0.55 + 0.45 * dyn(bar * BPB)), pitch=1.0)
        if gallop:
            pat("perc_hi", I.janggu_high, "x.oox.oox.oox.oo", bar, {"x": 0.4, "o": 0.28}, stick="deok")

    def fill(bar, big=False, tonic=98.0):
        b = bar * BPB
        S.hit("perc_low", I.buk, b + 3.0, 0.55, freq=tonic)
        for k, (ofs, fq, v) in enumerate([(3.0, 150.0, 0.5), (3.5, 123.0, 0.62), (3.75, 110.0, 0.7)] if big else [(3.5, 140.0, 0.5), (3.75, 120.0, 0.6)]):
            S.hit("perc_low", I.taiko, b + ofs, v, freq=fq, size=0.55)
        for k in range(4):
            S.hit("perc_hi", I.janggu_high, b + 2.5 + k * 0.25, 0.3 + 0.1 * k, stick="tta")

    for bar in range(4, 12):
        groove_A(bar)
        if bar in (7, 11):
            fill(bar)
        if bar >= 8:
            pat("perc_hi", I.janggu_high, "o.o.o.o.o.o.o.o.", bar, {"o": 0.2}, stick="deok")
    # B: lifts (janggu 8ths, taiko accent on phrase starts)
    for bar in range(12, 20):
        pat("perc_low", I.buk, "X.....g.x...x.g.", bar, {"X": 0.7, "x": 0.5, "g": 0.22}, freq=73.4)
        pat("perc_low", I.frame_drum, "....x.g.....x...", bar, {"x": 0.55, "g": 0.2}, freq=196.0, jingle=0.8)
        pat("perc_hi", I.janggu_high, "o.o.o.o.o.o.o.o.", bar, {"o": 0.3}, stick="deok")
        pat("perc_hi", I.rim_click, "..g...o...g...o.", bar, {"o": 0.3, "g": 0.2})
        pat("shaker", I.shaker, "xgogxgogxgogxgog", bar, {"x": 0.42, "o": 0.3, "g": 0.2})
        if bar % 2 == 1:
            S.hit("perc_hi", I.moktak, bar * BPB + 3.5, 0.45, pitch=1.0)
        if bar in (12, 16):
            S.hit("perc_low", I.taiko, bar * BPB, 0.85, freq=73.4, size=1.0)
        if bar in (15, 19):
            fill(bar, tonic=73.4)
    # break: heartbeat only from bar 22, then re-build
    for bar in (22, 23):
        S.hit("perc_low", I.frame_drum, bar * BPB + 0, 0.3, freq=196.0)
        S.hit("perc_low", I.frame_drum, bar * BPB + 2, 0.24, freq=196.0)
    for bar in range(24, 28):
        pat("perc_low", I.buk, "X.......x.......", bar, {"X": 0.55, "x": 0.42}, freq=98.0)
        pat("perc_low", I.frame_drum, "....x.......x...", bar, {"x": 0.42}, freq=196.0, jingle=0.7)
        pat("shaker", I.shaker, "xgogxgogxgogxgog", bar, {"x": 0.34, "o": 0.25, "g": 0.16})
        if bar >= 26:
            pat("perc_hi", I.rim_click, "o.o.o.o.o.o.o.o.", bar, {"o": 0.28})
    roll(S, "perc_low", I.frame_drum, 27 * BPB + 2.0, 2.0, step=0.125, v0=0.3, v1=0.85, freq=196.0)
    roll(S, "perc_low", I.taiko, 27 * BPB + 3.0, 1.0, step=0.25, v0=0.35, v1=0.95, freq=98.0, size=0.6)
    S.hit("fx", swell, 28 * BPB - 1.9 * BPM / 60.0, 0.9, dur=1.9, variants=1)
    # meadow breeze: from the outro (bar 44) through the loop seam into the intro, and under the break
    S.hit("wind", wind, 44 * BPB, 0.5, dur=15.2, variants=1, jitter_ms=0.0)
    S.hit("wind", wind, 20 * BPB, 0.5, dur=13.0, variants=1, jitter_ms=0.0)
    S.hit("perc_hi", I.cymbal, 28 * BPB, 0.8, dur=3.0, size=1.0)
    S.hit("perc_low", I.taiko, 28 * BPB, 1.0, freq=98.0, size=1.3)
    # A2: gallop janggu, taiko accents on phrase heads, fills
    for bar in range(28, 36):
        groove_A(bar, strong=1.1, gallop=True)
        if bar % 4 == 0:
            S.hit("perc_low", I.taiko, bar * BPB, 0.8, freq=98.0, size=1.0)
        if bar in (31, 35):
            fill(bar, big=(bar == 35))
    # B2: drive
    for bar in range(36, 44):
        pat("perc_low", I.buk, "X.....g.x...x.g.", bar, {"X": 0.75, "x": 0.52, "g": 0.24}, freq=73.4)
        pat("perc_low", I.frame_drum, "....x.g.....x.g.", bar, {"x": 0.58, "g": 0.2}, freq=196.0, jingle=0.9)
        pat("perc_hi", I.janggu_high, "x.oox.oox.oox.oo", bar, {"x": 0.42, "o": 0.3}, stick="deok")
        pat("perc_hi", I.rim_click, "..g...o...g...o.", bar, {"o": 0.32, "g": 0.2})
        pat("shaker", I.shaker, "xgogxgogxgogxgog", bar, {"x": 0.46, "o": 0.33, "g": 0.22})
        if bar % 2 == 1:
            S.hit("perc_hi", I.moktak, bar * BPB + 3.5, 0.48, pitch=1.0)
        if bar % 4 == 0:
            S.hit("perc_low", I.taiko, bar * BPB, 0.9, freq=73.4, size=1.0)
        if bar % 4 == 3 and bar != 43:
            fill(bar, big=True, tonic=73.4)
    S.hit("perc_hi", I.cymbal, 36 * BPB, 0.7, dur=3.0, size=0.9)
    S.hit("perc_low", I.taiko, 36 * BPB, 1.0, freq=73.4, size=1.3)
    roll(S, "perc_low", I.taiko, 43 * BPB + 2.0, 2.0, step=0.125, v0=0.4, v1=0.95, freq=98.0, size=0.6)
    # outro: gentle frame drum fades, nothing in the last bar (hang on the dominant)
    for bar in range(44, 47):
        S.hit("perc_low", I.frame_drum, bar * BPB, 0.34 - 0.06 * (bar - 44), freq=196.0)
        if bar < 46:
            S.hit("perc_low", I.frame_drum, bar * BPB + 2, 0.24, freq=196.0)
        pat("shaker", I.shaker, "x.g.o.g.x.g.o.g.", bar, {"x": 0.26, "o": 0.17, "g": 0.12}, scale=1.0 - 0.25 * (bar - 44))

    # ------------------------------------------------------------------ dynamic arc: per-track gain automation (dB around the mean level)
    def auto(track, k):
        S.automate(track, [(b * BPB, (v - 0.75) * k) for b, v in zip(DYN_BARS, DYN_VALS)])

    for name, k in (("pad", 10), ("gayageum", 13), ("guzheng", 12), ("flute", 8), ("flute_hi", 8), ("haegeum", 10), ("bells", 8),
                    ("bass", 10), ("perc_low", 13), ("perc_hi", 13), ("shaker", 13)):
        auto(name, k)
    return S

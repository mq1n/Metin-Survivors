"""Zone 3 -- Seori Mountain ("Miho in the Snow").  E hirajoshi / minor-pentatonic colour, 78 BPM, 36 bars (110.77 s) loop.

Cold, airy, melancholy but still moving: a breathy daegeum-like flute sings a slow theme built from rising fourths over
hollow open-fifth / sus2 harmony; glass bells, harp plucks and a cold glass+string pad paint the snow, a whistling wind bed
breathes underneath, and a heartbeat taiko + hand drums grow into a real combat pulse in B and C.

Form (bars):  Intro 0-3 | A 4-11 | B 12-19 | C 20-27 | A' 28-31 | Outro 32-35 (hangs on the Bsus dominant, bar 0 resolves it)
Harmony (2 bars per chord): Em9 Cmaj7 | Em9 Cmaj7 Dsus2 Bsus | Am9 Cmaj7 G6 Bsus | Cmaj7 Dsus2 Em9 Am9+Bsus | Em9 Cmaj7 | Dsus2 Bsus
Theme (flute, bars 4-11):  (B4) E5 . G5 F#5 | E5 B5 . A5 G5 | G5 C6 . B5 A5 | G5 . E5 ...   -- up-a-fourth pick-ups, arch to E6.
Menu leitmotif M1 appears transposed (+2: B4 E5 D5 B4 | A4 B4 D5) as bells in A' and, stretched, in the outro.
"""
from __future__ import annotations

import numpy as np
from scipy import signal as sps

from .. import dsp
from .. import instruments as I
from ..comp import run, roll
from ..dsp import SR, nsamp, tvec
from ..music import Song, parse_notes

ID = "mus_seori"
LOOP = True

# AG-02 calm variant (music.apply_calm): same notes, no percussion. The fx track mixes tonal bells with the gong, the noise risers and the
# reverse cymbal; those are tagged with S.layer("perc") below so the calm mix can lift them out of the shared track again.
CALM = dict(
    mute=("perc_low", "perc_hi"),
    layers=("perc",),
    trim_db={"bass": -2.0, "pad": 1.5, "wind": 1.0, "harp": -1.0},
    soften={"flute": dict(hs=(2800, -2.0), lp=3600), "flute2": dict(lp=3600), "bells": dict(lp=6500), "chimes": dict(lp=7000)},
    space=1.15,
)

# --------------------------------------------------------------------------- harmony
CH = {  # bass root, low string voicing, glass voicing, pitch classes available to harp/bell figures
    "Em9": dict(bass=40, low=[52, 59, 67], glass=[64, 71, 76, 78], pcs=[4, 7, 11, 2, 6]),
    "Cmaj7": dict(bass=36, low=[52, 59, 67], glass=[60, 67, 71, 76], pcs=[0, 4, 7, 11, 2]),
    "Dsus2": dict(bass=38, low=[50, 57, 64], glass=[62, 69, 74, 76], pcs=[2, 4, 9, 11]),
    "Bsus": dict(bass=35, low=[52, 59, 66], glass=[59, 66, 71, 76], pcs=[11, 4, 6, 9]),
    "Am9": dict(bass=33, low=[57, 64, 71], glass=[57, 64, 72, 76], pcs=[9, 0, 4, 11, 7]),
    "G6": dict(bass=43, low=[55, 62, 64], glass=[55, 62, 71, 76], pcs=[7, 11, 2, 4, 9]),
}
FORM = [  # (chord, first bar, number of bars)
    ("Em9", 0, 2), ("Cmaj7", 2, 2),
    ("Em9", 4, 2), ("Cmaj7", 6, 2), ("Dsus2", 8, 2), ("Bsus", 10, 2),
    ("Am9", 12, 2), ("Cmaj7", 14, 2), ("G6", 16, 2), ("Bsus", 18, 2),
    ("Cmaj7", 20, 2), ("Dsus2", 22, 2), ("Em9", 24, 2), ("Am9", 26, 1), ("Bsus", 27, 1),
    ("Em9", 28, 2), ("Cmaj7", 30, 2),
    ("Dsus2", 32, 2), ("Bsus", 34, 2),
]
PROG = [None] * 36
for _c, _s, _n in FORM:
    for _b in range(_s, _s + _n):
        PROG[_b] = _c

# bass approach tone (played on the last beat of a chord) towards the next chord root; None = straight step
APPROACH = {
    ("Em9", "Cmaj7"): 38, ("Cmaj7", "Dsus2"): 40, ("Dsus2", "Bsus"): 36, ("Bsus", "Am9"): None, ("Am9", "Cmaj7"): 40,
    ("Cmaj7", "G6"): 38, ("G6", "Bsus"): 42, ("Bsus", "Cmaj7"): None, ("Dsus2", "Em9"): None, ("Em9", "Am9"): 38,
    ("Am9", "Bsus"): None, ("Bsus", "Em9"): None, ("Cmaj7", "Em9"): 43,
}

# --------------------------------------------------------------------------- melodic material
FLUTE_A = """
E5:2.5@.72^sc G5:.5@.6 F#5:1@.64 | E5:1@.62 B5:2@.8^trillh A5:.5@.62 G5:.5@.6 |
G5:1@.62 C6:2@.8 B5:.5@.62 A5:.5@.58 | G5:2@.66 E5:1.5@.55^fall r:.5 |
A5:1.5@.66 B5:.5@.62 D6:2@.82^ob | E6:1.5@.88^ob D6:.5@.7 B5:1@.65 F#5:1@.58 |
B5:2@.76 A5:.5@.6 G5:.5@.58 F#5:1@.58 | F#5:3@.62^fall r:1
"""
FLUTE_B = """
A4:1@.62 D5:1@.66 E5:1.5@.7 D5:.5@.62 | C5:1@.64 B4:1@.6 A4:2@.62^fall |
G4:1@.62 C5:1@.66 E5:1.5@.72 D5:.5@.62 | B4:1@.62 C5:.5@.6 D5:.5@.62 E5:2@.72^trill |
D5:1@.66 G5:1@.7 A5:1.5@.75 G5:.5@.65 | E5:1.5@.7 D5:.5@.62 B4:2@.64^fall |
B4:1@.66 E5:1@.72 F#5:1.5@.78 E5:.5@.68 | F#5:1@.74 G5:1@.78 B5:2@.86^trillh
"""
FLUTE_C = """
C6:2.5@.84^sc D6:.5@.7 E6:1@.88 | G6:2@.92^ob E6:.5@.75 D6:.5@.7 C6:1@.72 |
A5:1@.72 D6:2@.85 E6:1@.85 | F#6:1.5@.88 E6:.5@.76 D6:1@.74 A5:1@.66 |
B5:1@.76 E6:2@.9^trill G6:.5@.86 F#6:.5@.8 | G6:1.5@.96^ob F#6:.5@.82 E6:1@.82 B5:1@.7 |
C6:1.5@.82 B5:.5@.72 A5:2@.76^fall | B5:2@.72 A5:1@.62 F#5:1@.56^fall
"""
FLUTE2_C = """
C6:1@.6 F#6:2@.68 G6:1@.68 | A6:1.5@.66 G6:.5@.58 F#6:1@.58 C6:1@.52 |
D6:1@.6 G6:2@.7 B6:.5@.66 A6:.5@.62 | B6:1.5@.72 A6:.5@.62 G6:1@.62 D6:1@.56 |
E6:1.5@.64 D6:.5@.56 C6:2@.58^fall | D6:2@.5^fall
"""
FLUTE_A2 = """
B5:2@.6^sc G5:1@.5 F#5:1@.5 | E5:2.5@.56^trill F#5:.5@.5 G5:1@.5 |
C6:2.5@.6^trill B5:.5@.5 G5:1@.46 | E5:3@.45^fall r:1
"""
FLUTE_OUT = """
A5:2.5@.5 G5:.5@.44 F#5:1@.44 | E5:3@.42^fall r:1 | B5:2@.4 A5:1@.36 r:1 | F#5:3.5@.3
"""
M1_FRAG = "B5:1@.34 E6:1@.36 D6:1@.34 B5:1@.32 | A5:1@.3 B5:1@.32 D6:2@.34"  # menu leitmotif +2 semitones (bars 30-31)
M1_OUT = "B5:2@.3 E6:2@.32 D6:2@.3 B5:2@.28 | A5:2@.26 B5:2@.26 D6:4@.28"  # stretched x2 over the outro (bars 32-35)

CELL_A = {  # hemiola bell cells (3 notes/bar, 4/3 beats apart), two bars per chord
    "Em9": [83, 88, 91, 90, 88, 83], "Cmaj7": [79, 84, 88, 91, 88, 83],
    "Dsus2": [81, 86, 88, 86, 83, 81], "Bsus": [83, 88, 90, 88, 83, 78],
}
B_BELLS = {  # counter-melody over the flute in B (relative to the chord start)
    12: "r:2 C6:1@.46 D6:1@.4 | E6:1.5@.5 r:.5 B5:1@.4 A5:1@.4",
    14: "r:2 E6:1@.46 D6:1@.4 | C6:2@.46 G6:2@.5",
    16: "r:2.5 D6:.5@.4 E6:1@.46 | G6:2@.5 E6:1@.42 D6:1@.4",
    18: "r:2 B5:.5@.4 E6:.5@.44 F#6:1@.5 | B6:1.5@.55 A6:.5@.5 F#6:1@.5 r:1",
}
LADDER = [76, 78, 79, 83, 84, 88, 90, 91, 95, 96, 100]  # E F# G B C pentatonic (hirajoshi-ish) ladder for bell-tree runs

# strong-beat consonance table used by the offline analysis (chord -> allowed pitch classes)
CHORD_PCS = {
    "Em9": {4, 6, 7, 11, 2}, "Cmaj7": {0, 4, 7, 11, 2}, "Dsus2": {2, 4, 9, 11, 6}, "Bsus": {11, 4, 6, 9},
    "Am9": {9, 0, 4, 11, 7, 2}, "G6": {7, 11, 2, 4, 9},
}


# --------------------------------------------------------------------------- local instruments
def _shaped_noise(n: int, rng, fc, sigma: float, nperseg: int = 2048) -> np.ndarray:
    """White noise shaped by a gaussian band (std `sigma` octaves) whose centre `fc` (Hz, per sample) moves in time (STFT mask)."""
    hop = nperseg // 4
    x = rng.standard_normal(n)
    f, tf, Z = sps.stft(x, fs=SR, nperseg=nperseg, noverlap=nperseg - hop, boundary="zeros", padded=True)
    idx = np.clip((tf * SR).astype(int), 0, n - 1)
    fcf = np.asarray(fc, dtype=float)[idx]
    lf = np.log2(np.maximum(f, 15.0))[:, None]
    m = np.exp(-0.5 * ((lf - np.log2(fcf)[None, :]) / sigma) ** 2)
    _, y = sps.istft(Z * m, fs=SR, nperseg=nperseg, noverlap=nperseg - hop, boundary=True)
    if len(y) < n:
        y = np.pad(y, (0, n - len(y)))
    y = y[:n]
    return y / (y.std() + 1e-12)


def wind(freq, dur, vel=0.6, rng=None, lo=420.0, hi=1100.0, sigma=0.8, whistle=0.0, flutter=0.35, rise=0.4, fall=0.45):
    """Mountain wind gust: broad noise band that slowly sweeps lo->hi (Hz), swells in and out, optional tonal whistle at `freq`."""
    rng = rng or np.random.default_rng(31)
    n = nsamp(dur)
    u = tvec(n) / dur
    sweep = 0.5 - 0.5 * np.cos(np.pi * u)
    fc = lo * (hi / lo) ** sweep * 2.0 ** (0.35 * dsp.smooth_noise(n, rng, 0.3))
    env = np.interp(u, [0.0, rise, 1.0 - fall, 1.0], [0.0, 1.0, 1.0, 0.0])
    env = env * env * (3.0 - 2.0 * env)
    out = np.zeros((2, n))
    for c in range(2):
        y = _shaped_noise(n, rng, fc, sigma)
        if whistle > 0:
            wf = freq * 2.0 ** (0.02 * dsp.smooth_noise(n, rng, 0.4))
            w = _shaped_noise(n, rng, wf, 0.012, nperseg=4096)
            wa = (0.5 + 0.5 * dsp.smooth_noise(n, rng, 0.35)) ** 2
            y = y + whistle * 2.2 * w * wa
        gust = 1.0 + flutter * dsp.smooth_noise(n, rng, 0.5)
        out[c] = dsp.lp(y, 5200.0, 0.7) * env * gust
    return out * (0.12 * vel)


def riser(freq, dur, vel=0.7, rng=None, f0=700.0, f1=9000.0, sigma=0.9, power=2.0, down=False, shimmer=0.4):
    """Icy noise riser (or exhale if down=True) with a thin glassy whine on top. Stereo."""
    rng = rng or np.random.default_rng(32)
    n = nsamp(dur)
    t = tvec(n)
    u = t / dur
    if down:
        fc = f1 * (f0 / f1) ** u
        env = (1.0 - u) ** power * np.minimum(1.0, t / 0.015)
    else:
        fc = f0 * (f1 / f0) ** u
        env = u ** power
        env[-nsamp(0.02):] *= np.linspace(1.0, 0.0, nsamp(0.02))
    out = np.zeros((2, n))
    for c in range(2):
        out[c] = _shaped_noise(n, rng, fc, sigma) * env * 0.55
    if shimmer > 0:
        glide = 2.0 ** ((-7 if down else 7) / 12.0 * u)
        trem = 0.65 + 0.35 * np.sin(2 * np.pi * np.cumsum(5.0 + 8.0 * u) / SR)
        for c, mult in enumerate((2.0, 3.0)):
            ph = 2 * np.pi * np.cumsum(freq * mult * glide * (1.0 + 0.002 * c)) / SR
            out[c] += shimmer * 0.16 * np.sin(ph) * env * trem
    return out * (0.5 * vel)


def rev_bell(freq, dur, vel=0.7, rng=None, kind="glass", brightness=0.8):
    """Reversed bell: swells up to a clean cut exactly `dur` after its start (place it so the swell lands on a downbeat)."""
    x = I.bell(freq, dur, vel, kind=kind, rng=rng, brightness=brightness)
    return dsp.fade(dsp.reverse(x), 0.0, 0.004)


def rev_cymbal(freq, dur, vel=0.7, rng=None):
    x = I.cymbal(dur, vel, rng, 1.0, 0.8)
    return dsp.fade(dsp.reverse(x), 0.0, 0.01)


def _echo_fx(spb, tl=0.75, tr=1.0, fb=0.42, mix=0.28, damp=3800.0, taps=5):
    """Dual-delay stereo echo (dotted-eighth left, quarter right) as a track pre-fx."""
    def fx(x):
        n = x.shape[-1]
        m = x.mean(0)
        wl = dsp.echo(m, tl * spb, fb, 1.0, taps, damp)[:n] - m
        wr = dsp.echo(m, tr * spb, fb, 1.0, taps, damp)[:n] - m
        return x + mix * np.stack([wl, wr])
    return fx


def _flute_curve(n, dur_s, mods):
    """Per-sample pitch multiplier for ornaments: ^fall (drop at the end), ^trill / ^trillh (whole / half-step trill, last 45%)."""
    t = np.arange(n) / SR
    semi = np.zeros(n)
    if "fall" in mods:
        t0 = max(dur_s - 0.4, dur_s * 0.55)
        semi += -1.7 * np.clip((t - t0) / 0.4, 0.0, 1.0) ** 2
    if "trill" in mods or "trillh" in mods:
        step = 1.0 if "trillh" in mods else 2.0
        t0 = dur_s * 0.55
        ph = (t - t0) * 7.2
        tr = np.where((t > t0) & ((ph % 1.0) > 0.5), step, 0.0)
        k = np.ones(260) / 260.0
        semi += np.convolve(tr, k, mode="same")
    return 2.0 ** (semi / 12.0)


# --------------------------------------------------------------------------- helpers
def pool(pcs, lo, hi):
    return [m for m in range(lo, hi + 1) if m % 12 in pcs]


def pick(pl, i):
    return pl[i % len(pl)] + 12 * (i // len(pl))


def section_of(bar):
    return "intro" if bar < 4 else "A" if bar < 12 else "B" if bar < 20 else "C" if bar < 28 else "A2" if bar < 32 else "out"


def build() -> Song:
    S = Song("seori", bpm=78, bars=36, seed=333)
    spb = S.spb
    bpb = 4

    # ------------------------------------------------------------------ tracks / mix
    S.master_comp = dict(thresh_db=-13.0, ratio=1.7, attack_ms=30.0, release_ms=300.0, makeup_db=0.0)
    S.track("wind", gain_db=-3.0, reverb={"air": 0.30}, eq=[("hp", 160), ("lp", 7500)], width=1.25)
    S.track("pad", gain_db=-12, reverb={"hall": 0.30}, eq=[("hp", 110), ("lp", 7000)], duck=("perc_low", 2.5, 300))
    S.track("flute", pan=0.04, gain_db=-4.5, reverb={"hall": 0.30, "air": 0.16}, eq=[("hp", 230), ("hs", 6000, -3.5), ("lp", 4500)])
    S.track("flute2", pan=-0.2, gain_db=-11.5, reverb={"hall": 0.35, "air": 0.25}, eq=[("hp", 400), ("lp", 4200), ("lp", 4800)])
    S.track("bells", pan=0.22, gain_db=-13.5, reverb={"air": 0.45, "hall": 0.15}, eq=[("hp", 350), ("hs", 7000, -2.5)], pre_fx=_echo_fx(spb))
    S.track("chimes", pan=-0.25, gain_db=-15, reverb={"air": 0.5}, eq=[("hp", 600), ("peak", 3600, 1.0, -3.0), ("lp", 9500)])
    S.track("harp", pan=-0.32, gain_db=-11, reverb={"plate": 0.2, "hall": 0.2}, eq=[("hp", 150)], pre_fx=_echo_fx(spb, 0.75, 1.5, 0.35, 0.18))
    S.track("bass", gain_db=-15, eq=[("hp", 32)], sat=0.5, duck=("perc_low", 2.0, 200))
    S.track("perc_low", gain_db=-8, reverb={"arena": 0.15}, eq=[("hp", 30)])
    S.track("perc_hi", pan=0.15, gain_db=-16, reverb={"plate": 0.2})
    S.track("fx", gain_db=-13, reverb={"hall": 0.3, "air": 0.3})
    # dynamic arc (beats: intro 0-16 | A 16-48 | B 48-80 | C 80-112 | A' 112-128 | out 128-144)
    S.automate("pad", [(0, 0), (16, 0), (48, -0.5), (80, 2.5), (110, 2.5), (116, -1.0), (128, -1.0), (144, 0)])
    S.automate("wind", [(0, 6), (10, 5), (16, 2), (40, 1), (48, -1), (76, 0), (80, 3), (108, 3), (112, 1), (128, 3), (144, 6)])
    S.automate("bass", [(0, -8), (14, -8), (16, 0), (48, 0), (80, 2), (112, 2), (116, -2), (128, -3), (144, -6)])
    S.automate("flute", [(0, 0), (16, -3.5), (46, -3.5), (50, -1), (78, -1), (82, 0), (110, 0), (116, -3), (128, -3), (134, -6), (144, -9)])
    S.automate("bells", [(0, 0), (78, 0), (82, 1.5), (110, 1.5), (114, 0)])
    S.automate("harp", [(0, 0), (78, 0), (82, 1.5), (110, 1.5), (114, 0)])
    S.automate("perc_low", [(0, 0), (78, 0), (82, 1.5), (110, 1.5), (114, 0)])

    # ------------------------------------------------------------------ flute (daegeum-like lead)
    def play_flute(track, text, start_bar, vel_mul=1.0, role="lead", **over):
        for nt in parse_notes(text, start_bar * bpb):
            dur_b = nt["dur"] * 0.97
            mods = nt["mods"]
            tone = float(np.clip(0.78 - (nt["midi"] - 76) * 0.03, 0.25, 0.8))  # thinner harmonics higher up: no harsh 2-5 kHz
            kw = dict(vib_depth=9, vib_rate=4.7, vib_delay=0.5, breath=0.42 if nt["midi"] < 84 else 0.34, buzz=0.12, attack=0.1, release=0.28,
                      contour=0.16, tone=tone)
            if role == "second":
                kw.update(overblow=0.25, tone=min(tone, 0.42), breath=0.2, buzz=0.03, vib_depth=12, vib_delay=0.6)
            if "ob" in mods:
                kw.update(overblow=0.2, breath=kw["breath"] + 0.08)
            if "sc" in mods:
                kw.update(scoop=1.6)
            kw.update(over)
            dur_s = dur_b * spb
            if mods & {"fall", "trill", "trillh"}:
                kw["pitch_curve"] = _flute_curve(nsamp(dur_s + kw["release"]), dur_s, mods)
            S.note(track, I.flute, nt["beat"], nt["midi"], dur_b, min(nt["vel"] * vel_mul, 1.0), jitter_ms=8, vel_jitter=0.04, **kw)

    S.note("flute", I.flute, 3 * bpb + 3, 71, 0.97, 0.5, jitter_ms=4, vib_depth=6, breath=0.5, attack=0.18, release=0.3)  # pick-up B4
    play_flute("flute", FLUTE_A, 4)
    play_flute("flute", FLUTE_B, 12)
    play_flute("flute", FLUTE_C, 20)
    play_flute("flute", FLUTE_A2, 28, breath=0.5)
    play_flute("flute", FLUTE_OUT, 32, breath=0.55, release=0.45)
    play_flute("flute2", FLUTE2_C, 22, role="second")

    # ------------------------------------------------------------------ pads (glass + cold strings)
    sec_vg = {"intro": 0.42, "A": 0.5, "B": 0.55, "C": 0.66, "A2": 0.48, "out": 0.38}
    sec_vs = {"A": 0.5, "B": 0.5, "C": 0.62, "A2": 0.42, "out": 0.3}
    sec_co = {"A": 1500, "B": 2000, "C": 3200, "A2": 1400, "out": 1000}
    for chord, s, nb in FORM:
        c = CH[chord]
        b0 = s * bpb
        sec = section_of(s)
        dur = nb * bpb + 0.5
        att = 2.2 if nb > 1 else 1.4
        S.chord("pad", c["glass"], b0, dur, vel=sec_vg[sec], kind="glass", attack=att, release=2.4)
        if sec != "intro" and not (sec == "out" and chord == "Bsus"):
            S.chord("pad", c["low"], b0, dur, vel=sec_vs[sec], kind="strings", attack=att + 0.2, release=2.2, voices=5, spread=9.0,
                    cutoff_open=sec_co[sec], cutoff_closed=330)
        if sec == "C":  # shimmering octave of the glass voicing at the climax
            S.chord("pad", [m + 12 for m in c["glass"][1:]], b0, dur, vel=0.34, kind="glass", attack=att, release=2.4)

    # ------------------------------------------------------------------ bells
    # intro: single glass notes
    for beat, midi, vel in [(0, 88, .55), (2.5, 83, .38), (5.5, 91, .4), (7, 90, .34), (8, 84, .5), (10.5, 79, .35), (12.5, 88, .4), (14, 83, .3)]:
        S.note("bells", I.bell, beat, midi, 6.0, vel, kind="glass", brightness=0.85)
    S.note("fx", I.bell, 0, 52, 8.0, 0.4, kind="temple", brightness=0.7)

    # A: hemiola cells, 3 notes per bar at 4/3-beat spacing
    for chord, s, nb in FORM:
        sec = section_of(s)
        if sec in ("A", "A2") and chord in CELL_A:
            cell = CELL_A[chord]
            if sec == "A2":
                cell = cell[::-1]
            vmul = 0.85 if s < 8 else 1.0
            if sec == "A2":
                vmul = 0.8
            for k, m in enumerate(cell):
                bar = s + k // 3
                pos = (k % 3) * 4.0 / 3.0
                S.note("bells", I.bell, bar * bpb + pos, m, 3.5, 0.34 * vmul * (1.0, 0.8, 0.86)[k % 3], kind="glass", brightness=0.9, jitter_ms=2.0)
    # B: counter-melody
    for s, text in B_BELLS.items():
        for nt in parse_notes(text, s * bpb):
            S.note("bells", I.bell, nt["beat"], nt["midi"], 5.0, nt["vel"], kind="glass", brightness=0.95, jitter_ms=4)
    # C: triplet arpeggio underneath the lead
    c_idx = [[1, 3, 5, 6, 5, 3], [2, 4, 6, 7, 6, 4]]
    for chord, s, nb in FORM:
        if section_of(s) != "C":
            continue
        pl = pool(CH[chord]["pcs"], 67, 88)
        for bi in range(nb):
            bar = s + bi
            idxs = c_idx[(bar - s) % 2]
            for k, ix in enumerate(idxs):
                if bar >= 26 and k >= 4:
                    continue
                v = 0.3 * (1.0, 0.72, 0.8, 0.9, 0.7, 0.76)[k] * (1.0 if bar >= 24 else 0.85)
                S.note("bells", I.bell, bar * bpb + k * 2.0 / 3.0, pick(pl, ix), 3.0, v, kind="glass", brightness=0.8, jitter_ms=2.0)
    # M1 leitmotif in A' and stretched in the outro
    for nt in parse_notes(M1_FRAG, 30 * bpb):
        S.note("bells", I.bell, nt["beat"], nt["midi"], 5.0, nt["vel"], kind="glass", brightness=0.9)
    for nt in parse_notes(M1_OUT, 32 * bpb):
        S.note("bells", I.bell, nt["beat"], nt["midi"], 7.0, nt["vel"], kind="glass", brightness=0.8)

    # ------------------------------------------------------------------ chimes: bell-tree runs
    def tree(start, i0, i1, step=1.0 / 6.0, v0=0.3, v1=0.6):
        for nt in run(LADDER, i0, i1, start, step, (v0, v1)):
            S.note("chimes", I.bell, nt["beat"], nt["midi"], 3.0, nt["vel"], kind="chime", jitter_ms=2.0)
    tree(11 * bpb + 2.5, 0, 8, v0=0.25, v1=0.55)
    tree(19 * bpb + 2.5, 2, 10, v0=0.3, v1=0.7)
    tree(23 * bpb + 3.0, 2, 10, step=0.125, v0=0.3, v1=0.75)
    tree(25 * bpb + 3.5, 10, 2, step=1.0 / 6.0, v0=0.55, v1=0.3)
    tree(27 * bpb + 2.5, 10, 2, step=1.0 / 5.0, v0=0.6, v1=0.22)
    tree(31 * bpb + 2.0, 8, 0, step=0.25, v0=0.3, v1=0.15)
    # chimes: spaced sparkle in C
    for bar in (20, 22, 24, 26):
        for k, ix in enumerate([5, 7, 8]):
            S.note("chimes", I.bell, bar * bpb + 1.0 + k * 0.5, LADDER[ix], 3.0, 0.3 + 0.05 * k, kind="chime", jitter_ms=3.0)

    # ------------------------------------------------------------------ harp
    # A: sparse drops from bar 6, A': sparse again
    a_idx = [(3, 5), (2, 4), (4, 6), (3, 5), (5, 7), (4, 2)]
    for bar in list(range(6, 12)) + list(range(28, 32)):
        chord = PROG[bar]
        pl = pool(CH[chord]["pcs"], 64, 88)
        i1, i2 = a_idx[bar % len(a_idx)]
        v = 0.5 if bar < 28 else 0.4
        S.note("harp", I.pluck, bar * bpb + 2.0, pick(pl, i1), 3.0, v, t60=3.2, bright=0.5, body="harp", pick=0.2)
        S.note("harp", I.pluck, bar * bpb + 3.5, pick(pl, i2), 3.0, v * 0.85, t60=3.0, bright=0.5, body="harp", pick=0.2)
    # B and C: 3-3-2 eighth-note ostinato
    vel332 = (1.0, 0.55, 0.62, 0.92, 0.55, 0.62, 0.88, 0.5)
    pat = [[0, 2, 4, 1, 3, 5, 4, 2], [0, 3, 5, 2, 4, 6, 5, 3]]
    for chord, s, nb in FORM:
        sec = section_of(s)
        if sec not in ("B", "C"):
            continue
        lo, hi, shift = (55, 84, 0) if sec == "B" else (59, 91, 2)
        pl = pool(CH[chord]["pcs"], lo, hi)
        for bi in range(nb):
            bar = s + bi
            ix = pat[(bar - s) % 2]
            base = 0.5 if sec == "B" else 0.6
            for k in range(8):
                v = base * vel332[k]
                bend = [(0, -1.0), (0.12, 0.0)] if (k == 0 and (bar - s) == 0 and bar % 4 == 0) else None
                S.note("harp", I.pluck, bar * bpb + k * 0.5, pick(pl, ix[k] + shift), 2.4, v, t60=2.4, bright=0.55, body="harp", pick=0.18, jitter_ms=3.0, bend=bend)
    # a harp-like gliss into B and C
    for nt in run(pool([4, 7, 11, 2, 6, 9, 0], 64, 90), 0, 9, 11 * bpb + 3.0, 0.125, (0.35, 0.6)):
        S.note("harp", I.pluck, nt["beat"], nt["midi"], 2.0, nt["vel"], t60=2.0, bright=0.6, body="harp", pick=0.15)

    # ------------------------------------------------------------------ bass (soft sine)
    def bass(beat, midi, dur, vel):
        S.note("bass", I.sub_bass, beat, midi, dur, vel, attack=0.03, release=0.3, harm=0.3, drive=1.1, jitter_ms=2.0)

    for i, (chord, s, nb) in enumerate(FORM):
        root = CH[chord]["bass"]
        sec = section_of(s)
        nxt = FORM[(i + 1) % len(FORM)][0]
        appr = APPROACH.get((chord, nxt))
        for bi in range(nb):
            bar = s + bi
            b0 = bar * bpb
            last = bi == nb - 1
            if sec == "intro":
                if bi == 0:
                    bass(b0, root, 7.6, 0.4 if s == 0 else 0.34)
            elif sec in ("A", "A2"):
                bass(b0, root, 3.8 if bi == 0 else 2.8, 0.55 if sec == "A" else 0.46)
                if last and appr is not None and bar != 27:
                    bass(b0 + 3.0, appr, 0.9, 0.38)
            elif sec == "B":
                bass(b0, root, 1.4, 0.62)
                bass(b0 + 1.5, root + 7, 1.2, 0.45)
                bass(b0 + 3.0, root, 0.9, 0.46)
                if last and appr is not None:
                    bass(b0 + 3.5, appr, 0.5, 0.42)
            elif sec == "C":
                bass(b0, root, 1.3, 0.7)
                bass(b0 + 1.5, root + 7, 0.4, 0.5)
                bass(b0 + 2.0, root, 1.0, 0.62)
                bass(b0 + 3.0, root + 12, 0.45, 0.48)
                bass(b0 + 3.5, appr if (last and appr is not None) else root, 0.45, 0.5)
            else:  # outro: long hanging roots
                if bi == 0:
                    bass(b0, root, 7.6, 0.4 if chord == "Dsus2" else 0.33)

    # ------------------------------------------------------------------ cello (low-mid body, soft bowed)
    def cello(beat, midi, dur, vel, depth=10):
        S.note("pad", I.bowed, beat, midi, dur, vel, kind="cello", attack=0.7, release=1.0, vib_depth=depth, vib_delay=0.6, bow_noise=0.2, jitter_ms=6.0)

    for chord, s, nb in FORM:
        root = CH[chord]["bass"] + 12
        sec = section_of(s)
        if sec == "A":
            cello(s * bpb, root, nb * bpb - 0.2, 0.58 if s < 8 else 0.66)
        elif sec == "A2":
            cello(s * bpb, root, nb * bpb - 0.2, 0.4)
        elif sec == "B":
            for bi in range(nb):
                cello((s + bi) * bpb, root if bi == 0 else root + 7, 3.7, 0.52)
        elif sec == "C":
            for bi in range(nb):
                cello((s + bi) * bpb, root, 3.7, 0.6, depth=15)

    # ------------------------------------------------------------------ percussion
    E2, B2 = 82.41, 123.47

    def lub(beat, vel, freq=E2, tight=0.5, size=0.8):
        S.hit("perc_low", I.taiko, beat, vel, freq=freq, tight=tight, size=size)

    def dub(beat, vel):
        S.hit("perc_low", I.frame_drum, beat, vel, freq=110.0, jingle=0.2)

    for bar in range(3, 4):
        S.hit("perc_low", I.frame_drum, bar * bpb + 2, 0.25, freq=82.0, jingle=0.0)  # a faint pulse before the theme enters
    for bar in range(4, 8):  # A1: distant single pulse
        if bar % 2 == 0:
            lub(bar * bpb, 0.4, tight=0.7, size=0.6)
    for bar in range(8, 12):  # A2: heartbeat
        lub(bar * bpb, 0.55)
        dub(bar * bpb + 0.5, 0.3)
        if bar % 2 == 1:
            lub(bar * bpb + 2, 0.3, tight=0.7, size=0.6)
    for bar in range(12, 20):  # B: lub-dub twice per bar + 3-3-2 hand drum + offbeat shaker
        b = bar * bpb
        lub(b, 0.8)
        dub(b + 0.5, 0.36)
        lub(b + 2, 0.58)
        dub(b + 2.5, 0.3)
        S.hit("perc_hi", I.buk, b + 1.5, 0.5, freq=118.0)
        S.hit("perc_hi", I.buk, b + 3.0, 0.5, freq=118.0)
        if bar % 2 == 1:
            S.hit("perc_hi", I.janggu_high, b + 3.75, 0.35, stick="deok")
        S.pattern("perc_hi", I.shaker, ".x.x.x.x", bar, vel_map={"x": 0.3}, step_beats=0.5)
        S.hit("perc_hi", I.rim_click, b + 1.0, 0.2)
        S.hit("perc_hi", I.rim_click, b + 3.5, 0.24)
        if bar % 4 == 3:
            S.hit("perc_hi", I.moktak, b + 2.75, 0.45, pitch=1.0)
    for bar in range(20, 28):  # C: full
        b = bar * bpb
        lub(b, 1.0, tight=0.2, size=1.0)
        S.hit("perc_low", I.taiko, b + 1.5, 0.66, freq=B2, size=0.7)
        lub(b + 2, 0.82, tight=0.3)
        S.hit("perc_low", I.taiko, b + 3.0, 0.62, freq=110.0, size=0.7)
        S.hit("perc_low", I.taiko, b + 3.5, 0.58, freq=E2, size=0.8)
        if bar % 2 == 0:
            S.hit("perc_low", I.janggu_low, b + 0.75, 0.5)
        S.pattern("perc_hi", I.janggu_high, "o.o.o.oo", bar, vel_map={"o": 0.55}, step_beats=0.5, stick="deok")
        S.pattern("perc_hi", I.shaker, "xxxxxxxxxxxxxxxx", bar, vel_map={"x": 0.24}, step_beats=0.25)
        S.hit("perc_hi", I.rim_click, b + 1.5, 0.3)
        S.hit("perc_hi", I.rim_click, b + 3.5, 0.3)
        if bar % 4 == 3:
            S.hit("perc_hi", I.moktak, b + 2.75, 0.5)
    for bar in range(28, 32):  # A': back to a single heartbeat, thinning
        if bar % 2 == 0:
            lub(bar * bpb, 0.45, tight=0.7, size=0.6)
            dub(bar * bpb + 0.5, 0.22)
    for bar in (32, 33):
        S.hit("perc_low", I.frame_drum, bar * bpb, 0.28, freq=82.0, jingle=0.0)
    # fills
    roll(S, "perc_low", I.frame_drum, 11 * bpb + 3.0, 1.0, step=0.25, v0=0.25, v1=0.55, freq=110.0, jingle=0.1)
    roll(S, "perc_low", I.taiko, 19 * bpb + 2.0, 2.0, step=0.25, v0=0.35, v1=0.95, freq=E2, size=0.6)
    roll(S, "perc_hi", I.janggu_high, 19 * bpb + 3.0, 1.0, step=0.125, v0=0.3, v1=0.7, stick="deok")
    roll(S, "perc_low", I.taiko, 27 * bpb + 2.0, 2.0, step=0.125, v0=0.4, v1=1.0, freq=E2, size=0.6)
    S.hit("perc_low", I.taiko, 28 * bpb, 0.9, freq=61.74, size=1.4)

    # ------------------------------------------------------------------ wind bed, risers, temple bells
    gusts = [  # (beat, dur in beats, lo Hz, hi Hz, vel, whistle midi, whistle amount); 6-beat overlaps keep the bed continuous
        (136, 18, 380, 1000, 0.5, 76, 0.5),
        (4, 18, 900, 450, 0.45, 83, 0.35),
        (16, 18, 350, 800, 0.36, 0, 0.0),
        (28, 18, 500, 1200, 0.42, 88, 0.25),
        (40, 18, 300, 700, 0.38, 0, 0.0),
        (52, 18, 600, 1500, 0.46, 91, 0.3),
        (64, 18, 900, 500, 0.5, 0, 0.0),
        (76, 18, 500, 1300, 0.55, 83, 0.3),
        (88, 18, 1400, 400, 0.55, 0, 0.0),
        (100, 18, 350, 900, 0.5, 76, 0.3),
        (112, 18, 1400, 450, 0.4, 0, 0.0),
        (124, 18, 350, 700, 0.34, 0, 0.0),
    ]
    for beat, dur_b, lo, hi, vel, wm, wa in gusts:
        S.note("wind", wind, beat, wm or 76, dur_b, vel, jitter_ms=0.0, lo=lo, hi=hi, whistle=wa, rise=0.5, fall=0.5)

    with S.layer("perc"):
        S.note("fx", riser, 3 * bpb, 83, 4.0, 0.35, jitter_ms=0.0, f0=600, f1=6500, power=2.2)
        S.note("fx", riser, 11 * bpb - 2, 88, 6.0, 0.6, jitter_ms=0.0, f0=700, f1=8500)
    S.note("fx", rev_bell, 12 * bpb - 4, 88, 4.0, 0.55, jitter_ms=0.0)
    with S.layer("perc"):
        S.note("fx", riser, 18 * bpb, 91, 8.0, 0.75, jitter_ms=0.0, f0=500, f1=9500, power=2.4)
        S.note("fx", rev_cymbal, 20 * bpb - 5, 0, 5.0, 0.7, jitter_ms=0.0)
    S.note("fx", rev_bell, 20 * bpb - 4, 91, 4.0, 0.6, jitter_ms=0.0)
    with S.layer("perc"):
        S.note("fx", riser, 27 * bpb + 2, 83, 6.0, 0.55, jitter_ms=0.0, f0=300, f1=7000, down=True, power=1.6)
    S.note("fx", I.bell, 12 * bpb, 52, 7.0, 0.5, kind="temple", brightness=0.8)
    with S.layer("perc"):
        S.note("fx", I.gong, 20 * bpb, 52, 9.0, 0.85)
    S.note("fx", I.bell, 20 * bpb, 59, 7.0, 0.55, kind="temple", brightness=0.8)
    S.note("fx", I.bell, 28 * bpb, 52, 7.0, 0.45, kind="temple", brightness=0.7)
    return S

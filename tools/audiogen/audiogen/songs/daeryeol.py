"""Daeryeol -- Zone 4 theme ("Alev Krali'nin Yolu", the road to the Pyre King and the Scarlet Wyrm).

D phrygian-dominant / double-harmonic (D Eb F# G A Bb C#), 92 BPM, 42 bars = 109.57 s loop.
Colour: minor-second clusters (D-Eb), tritones (A-Eb), heavy taiko ensemble, brass-like pads, snarling brass theme.

Form (bars): Intro 0-3 | A 4-11 | B 12-19 | Break+build 20-25 | A2 26-33 | B2 34-39 | Outro 40-41 (hit, hanging drone -> Intro).

Main theme (brass, A): X = D4. Eb4 F#4 Eb4 D4  /  Y = A3. Bb3 A3  (the 'A Bb A' cell is the dominant-b9 clash itself).
X is sequenced up the scale (Eb F# G F# Eb ; G A Bb A G) and Y closes every phrase on the dominant.
The menu leitmotif M1 (A4 D5 C5 A4 | G4 A4 C5) is quoted by the haegeum in the break with its C bent to C#/Bb.
"""
from __future__ import annotations

import numpy as np

from .. import dsp
from .. import instruments as I
from ..dsp import SR, nsamp, tvec, midi2hz
from ..music import Song, parse_notes

ID = "mus_daeryeol"
LOOP = True

# AG-02 calm variant (music.apply_calm): same notes, tempo, bars and key; no percussion (taiko ensemble, perc_hi / perc_far, anvil and
# chains, cymbals, gong, booms and risers) and no brass (the brass pad cluster and the snarling brass lead); the dark pad, choir, haegeum
# (it doubles the theme), bass, temple bells, embers and the rumble stay, the haegeum softened. The growling bowed bass sits out too.
CALM = dict(
    mute=("perc_low", "perc_hi", "perc_far", "metal", "gong", "cym", "fx", "pad_brass", "lead", "lead_lo", "bass_snarl"),
    trim_db={"choir": -1.0, "haegeum": 1.0, "pad_dark": 2.0, "bass": 1.0},
    soften={"haegeum": dict(hs=(2200, -3.0), lp=3400), "choir": dict(lp=3000)},
    space=1.1,
)

BPM = 92
NBARS = 42
BPB = 4
SEC = ["intro"] * 4 + ["A"] * 8 + ["B"] * 8 + ["brk"] * 6 + ["A2"] * 8 + ["B2"] * 6 + ["out"] * 2

# --------------------------------------------------------------------------- harmony
# low = dark pad (+choir pedal), top = brass pad cluster; root = bass root (MIDI)
CH = {
    "D5":   dict(root=38, low=[38, 45, 50], top=[57, 62, 69]),         # D A D  (power chord, no third)
    "D":    dict(root=38, low=[38, 45, 50], top=[57, 62, 63, 69]),     # Dm(b9) w/o third: D4-Eb4 minor-2nd cluster
    "Eb":   dict(root=39, low=[39, 46], top=[58, 62, 63, 67]),         # Ebmaj7 (D in the chord: D-Eb cluster)
    "Gm":   dict(root=43, low=[43, 50], top=[58, 62, 67, 70]),
    "Bb":   dict(root=34, low=[34, 46], top=[58, 62, 65, 70]),
    "Co":   dict(root=37, low=[37, 43], top=[58, 61, 64, 67]),         # C#dim7 (= rootless A7b9)
    "A7":   dict(root=33, low=[33, 45], top=[55, 58, 61, 64]),         # A7(b9): A-Bb clash against the bass
    "D5b6": dict(root=38, low=[38, 45, 50], top=[57, 58, 62, 69]),     # D5 with Bb (b6): A3-Bb3 cluster
}
PROG = (
    ["D5", "D", "Eb", "Co"]                                       # intro 0-3
    + ["D", "D", "Eb", "Eb", "Co", "Co", "D5b6", "A7"]            # A 4-11
    + ["D", "Eb", "D", "Eb", "Gm", "Bb", "Co", "A7"]              # B 12-19
    + ["D5", "D", "Eb", "Co", "A7", "A7"]                         # break 20-25
    + ["D", "D", "Eb", "Eb", "Gm", "Bb", "Co", "A7"]              # A2 26-33
    + ["D", "Eb", "D", "Eb", "Co", "A7"]                          # B2 34-39
    + ["D5b6", "D5"]                                              # outro 40-41
)
assert len(PROG) == NBARS and len(SEC) == NBARS

# taiko tunings (Hz)
BIG = 55.0       # o-daiko, A1 (a fifth under the tonic, tritone to Eb)
BIG_LO = 49.0    # G1, section impacts
HI = 110.0
HI2 = 146.8
MID = {"D5": 73.4, "D": 73.4, "Eb": 77.8, "Gm": 98.0, "Bb": 58.3, "Co": 69.3, "A7": 110.0, "D5b6": 73.4}

# --------------------------------------------------------------------------- melodic material (bar, text)
THEME_A = [
    (4, "D4:1.5@.95^sc Eb4:.5 F#4:1 Eb4:.5 D4:.5"),
    (5, "A3:1.5 Bb3:.5 A3:1.5 r:.5"),
    (6, "Eb4:1.5^sc F#4:.5 G4:1 F#4:.5 Eb4:.5"),
    (7, "Bb4:1.5 G4:.5 Eb4:1 D4:1"),
    (8, "C#4:1.5^sc D4:.5 E4:1 D4:.5 C#4:.5"),
    (9, "Bb3:1.5 A3:.5 G3:1.5 Bb3:.5"),
    (10, "D4:1.5@.95^sc Eb4:.5 F#4:1 Eb4:.5 D4:.5"),
    (11, "A3:1 Bb3:1 A3:2"),
]
THEME_A2 = [
    (26, "D4:1.5@.95^sc Eb4:.5 F#4:1 Eb4:.5 D4:.5"),
    (27, "A4:1.5^sc Bb4:.5 A4:1 G4:.5 F#4:.5"),
    (28, "Eb4:1 F#4:.5 G4:.5 Bb4:1.5 G4:.5"),
    (29, "Bb4:1.5 G4:.5 Eb4:1 D4:1"),
    (30, "G4:1.5^sc A4:.5 Bb4:1 A4:.5 G4:.5"),
    (31, "D5:1.5^sc C5:.5 Bb4:1 A4:.5 G4:.5"),
    (32, "C#5:1.5^sc D5:.5 E5:1 D5:.5 C#5:.5"),
    (33, "A4:1 Bb4:1 A4:1 Bb4:.5 A4:.5"),
]
INTRO_X = [
    (2, "D4:2 Eb4:1 F#4:1"),
    (3, "Eb4:1.5 D4:.5 C#4:2"),
]
B_BRASS = [
    (13, "Eb4:.5 F#4:.5 G4:.5 F#4:.5 Eb4:1 D4:1"),
    (15, "Bb3:1 D4:.5 Eb4:.5 G4:1 F#4:.5 Eb4:.5"),
    (17, "F4:1 D4:1 Bb3:1 C4:.5 D4:.5"),
    (19, "A3:1 Bb3:1 A3:1 Bb3:.5 A3:.5"),
]
B_HAE = [
    (12, "A5:2.5^wd G5:.5 F#5:1"),
    (14, "A5:1.5^sc Bb5:.5 A5:1 F#5:.5 Eb5:.5"),
    (16, "Bb5:2^wd A5:.5 G5:.5 Bb5:1"),
    (18, "D6:1.5^wd C#6:.5 Bb5:1 G5:.5 E5:.5"),
    (19, "A5:1^sc Bb5:1 A5:2^tr"),
]
A_HAE = [  # keening counter-line over the A theme
    (5, "A5:4^fl"),
    (7, "Bb5:4"),
    (9, "G5:4^fl"),
    (11, "A5:1.5^sc Bb5:.5 A5:2^tr"),
]
B2_BRASS = [
    (34, "D4:1@.95 Eb4:.5 F#4:.5 A4:1.5 Bb4:.5"),
    (35, "A4:1 G4:.5 F#4:.5 Eb4:1 D4:1"),
    (36, "A4:1.5^sc Bb4:.5 D5:1 C#5:.5 Bb4:.5"),
    (37, "Eb5:1.5^sc F#5:.5 G5:1 F#5:.5 Eb5:.5"),
    (38, "C#4:.5 E4:.5 G4:.5 Bb4:.5 G4:.5 E4:.5 C#4:.5 r:.5"),
    (39, "A4:1 Bb4:1 A4:1.5 r:.5"),
]
BREAK_M1 = [(21, "A4:2 D5:1 C#5:.5 A4:.5"), (22, "G4:1.5 A4:.5 Bb4:2")]   # leitmotif M1, bent
BUILD_BRASS = [
    (23, "A3:.5 Bb3:.5 A3:1 C#4:.5 D4:.5 C#4:1"),
    (24, "E4:.5 F4:.5 E4:1 G4:.5 Ab4:.5 G4:1"),
    (25, "Bb3:.5 C#4:.5 E4:.5 G4:.5 Bb4:1.5 r:.5"),
]


# --------------------------------------------------------------------------- local instruments
def anvil(freq, dur=1.4, vel=0.8, rng=None, ring=1.0):
    """Struck anvil / iron plate: inharmonic modes with beating pairs, hard transient, low thunk."""
    rng = rng or np.random.default_rng(31)
    ratios = np.array([1.0, 1.47, 2.09, 2.78, 3.86, 5.12, 6.9, 9.3])
    amps = np.array([1.0, 0.75, 0.6, 0.5, 0.38, 0.25, 0.16, 0.1])
    t60 = np.array([1.0, 0.75, 0.55, 0.4, 0.3, 0.2, 0.14, 0.09]) * ring
    f = freq * ratios * (1 + rng.uniform(-0.006, 0.006, ratios.size))
    y = I.modal(f, amps * (0.55 + 0.45 * vel), t60, dur, rng, split_hz=2.2) / 2.0
    na = nsamp(0.02)
    y[:na] += dsp.bp(rng.standard_normal(na), 3200.0, 0.8) * np.exp(-np.arange(na) / (SR * 0.004)) * 0.45 * (0.4 + vel)
    y += I.modal([freq * 0.5], [0.35], [0.16], dur, rng)
    y = dsp.hp(y, 160.0)
    return dsp.fade(y, 0.0002, 0.04) * (0.4 + 0.6 * vel) * 0.8


def chain(vel=0.7, dur=0.55, rng=None, links=10):
    """Rattle of iron chain links (a handful of tiny metallic clinks)."""
    rng = rng or np.random.default_rng(32)
    y = np.zeros(nsamp(dur))
    pos = np.sort(rng.uniform(0.0, dur * 0.65, links))
    for i, p in enumerate(pos):
        f0 = rng.uniform(1500.0, 3800.0)
        c = I.modal([f0, f0 * 2.31, f0 * 3.77], [1.0, 0.55, 0.3], [0.06, 0.04, 0.025], 0.18, rng)
        a = (0.4 + 0.6 * rng.uniform()) * (1.0 - 0.5 * i / links)
        dsp.mix_into(y, c, nsamp(p), a)
    y = dsp.hp(y, 900.0)
    return dsp.fade(y, 0.001, 0.08) * (0.3 + 0.7 * vel) * 0.35


def choir(freq, dur, vel=0.7, rng=None, v_from="u", v_to="o", t_morph=None, attack=2.0, release=2.0, voices=4, spread=16.0, shift=1.0):
    """Low formant 'ooh/aah' choir drone: detuned saw stack through a morphing vowel filter bank, chorus-widened."""
    rng = rng or np.random.default_rng(33)
    n = nsamp(dur + release)
    f = freq * dsp.vib(n, 4.9, 12.0, 0.6, 1.0, rng, 0.25) * (1 + 0.0025 * dsp.smooth_noise(n, rng, 0.4))
    src = dsp.supersaw(f, n, voices=voices, spread_cents=spread, rng=rng)
    src = dsp.lp(src, 2600.0)
    y = I.vowel_morph(src, v_from, v_to, t_morph or dur, hop=256, shift=shift)
    a = dsp.pad_to(dsp.adsr(dur, attack, 0.2, 0.92, release, a_curve=1.0), n)
    y = dsp.chorus(y * a, rate=0.22, depth_ms=2.4, base_ms=17.0, mix=0.55, voices=2, rng=rng)
    return y * (0.4 + 0.6 * vel) * 0.9


def chord_pad(freqs, dur, vel=0.7, attack=0.8, release=1.2, rng=None, cutoff_open=2200.0, cutoff_closed=500.0, voices=5, spread=14.0,
              motion=0.5, kind="brass", hop=256):
    """Brass-like / dark chord pad. Same sound as instruments.pad(), but the swelling low-pass runs once on the summed chord
    (not once per note), which is ~3x cheaper. Returns stereo."""
    rng = rng or np.random.default_rng(7)
    n = nsamp(dur + release)
    nf = len(freqs)
    out = np.zeros((2, n))
    for fi, f in enumerate(freqs):
        pan_p = (fi / max(1, nf - 1) * 2 - 1) * 0.45 if nf > 1 else 0.0
        wob = 1 + 0.0012 * dsp.smooth_noise(n, rng, 0.35) * motion
        v = dsp.supersaw(f * wob, n, voices=voices, spread_cents=spread * (1.5 if kind == "brass" else 1.0), rng=rng, stereo=True)
        l, r = dsp.pan_gains(pan_p)
        out[0] += v[0] * (l + 0.5)
        out[1] += v[1] * (r + 0.5)
    a_env = dsp.pad_to(dsp.adsr(dur, attack, 0.3, 0.9, release, a_curve=1.1), n)
    co_env = cutoff_closed + (cutoff_open - cutoff_closed) * np.clip(a_env, 0, 1) ** 1.3 * (0.6 + 0.4 * vel)
    out = np.stack([dsp.sweep_filter(out[0], "lp", co_env, 0.7, hop=hop), dsp.sweep_filter(out[1], "lp", co_env, 0.7, hop=hop)])
    if kind == "brass":
        out = np.stack([dsp.peakeq(out[0], 700, 1.2, 3.5), dsp.peakeq(out[1], 700, 1.2, 3.5)])
    out = out * a_env / (np.sqrt(max(1, nf)) * 1.5)
    return out * (0.4 + 0.6 * vel)


def hae(freq, dur, vel=0.8, rng=None, scoop=0.0, scoop_t=0.16, fall=0.0, fall_t=0.45, trill=0.0, trill_rate=10.5, trill_t0=0.2, **kw):
    """Haegeum with expressive pitch contour: scoop (semitones below, rising into the note), fall-off at the end and a
    legato bowed trill (alternating with the note `trill` semitones above, from trill_t0 to the end of the note)."""
    rel = kw.get("release", 0.18)
    n = nsamp(dur + rel)
    t = tvec(n)
    semis = np.zeros(n)
    if scoop:
        semis += scoop * np.clip(1.0 - t / scoop_t, 0.0, 1.0) ** 1.5
    if fall:
        semis += fall * np.clip((t - max(dur - fall_t, 0.0)) / (fall_t + rel), 0.0, 1.0) ** 2
    if trill:
        gate = np.clip((t - trill_t0) / 0.12, 0.0, 1.0) * np.clip((dur - t) / 0.1, 0.0, 1.0)
        semis += trill * 0.5 * (1.0 + np.tanh(3.0 * np.sin(2 * np.pi * trill_rate * np.clip(t - trill_t0, 0.0, None)))) * gate
    return I.bowed(freq, dur, vel=vel, rng=rng, kind="haegeum", pitch_curve=2.0 ** (semis / 12.0), **kw)


def boom(vel=1.0, dur=2.6, rng=None, f0=46.0):
    """Sub impact: pitch-dropping sine boom with a low noise thud."""
    rng = rng or np.random.default_rng(34)
    n = nsamp(dur)
    t = tvec(n)
    f = f0 * (1.0 + 1.6 * np.exp(-t / 0.07))
    ph = np.cumsum(f) / SR
    y = np.sin(2 * np.pi * ph) * np.exp(-t / 0.75) + 0.5 * np.sin(2 * np.pi * ph * 2.0 + 0.7) * np.exp(-t / 0.3)
    y += dsp.lp(rng.standard_normal(n), 380.0) * np.exp(-t / 0.18) * 0.9
    y = dsp.saturate(y, 1.5)
    return dsp.fade(y, 0.0005, 0.25) * (0.4 + 0.6 * vel) * 0.8


def riser(vel=0.8, dur=4.5, rng=None, f_lo=250.0, f_hi=7000.0):
    """Noise riser: band-pass sweeping up with a cubic swell, decorrelated L/R."""
    rng = rng or np.random.default_rng(35)
    n = nsamp(dur)
    u = tvec(n) / dur
    fc = f_lo * (f_hi / f_lo) ** (u ** 1.6)
    out = np.zeros((2, n))
    for c in range(2):
        y = dsp.sweep_filter(rng.standard_normal(n), "bp", fc, 1.4, hop=64)
        out[c] = y / (np.sqrt(np.mean(y * y)) + 1e-9) * u ** 2.2
    return dsp.fade(out, 0.05, 0.02) * (0.3 + 0.7 * vel) * 0.35


def rev_cymbal(vel=0.7, dur=2.8, rng=None):
    """Reversed cymbal swell (peaks exactly at its end)."""
    y = I.cymbal(dur=dur, vel=vel, rng=rng, size=1.0, hi=0.85)
    return dsp.reverse(y)


def rumble(vel=0.7, dur=10.0, rng=None, shape="flat"):
    """Magma rumble: brown noise below ~150 Hz with slow amplitude wander (flat | swell | decay)."""
    rng = rng or np.random.default_rng(36)
    n = nsamp(dur)
    u = tvec(n) / dur
    out = np.zeros((2, n))
    for c in range(2):
        b = dsp.butter_lp(dsp.brown(n, rng), 150.0, 3)
        out[c] = b * (0.65 + 0.35 * dsp.smooth_noise(n, rng, 0.45))
    env = {"flat": np.ones(n), "swell": u ** 1.7, "decay": (1 - u) ** 1.3}[shape]
    return dsp.fade(out * env, 1.2 if shape != "swell" else 0.5, 0.6) * vel * 0.9


# --------------------------------------------------------------------------- patterns (beat, drum, vel); O big, M mid, K mid+rim, H hi, h hi-ghost
PAT_A0 = [(0, "O", 1.0), (0, "M", 0.8), (1.5, "H", 0.4), (2, "K", 0.95), (3, "h", 0.35), (3.5, "H", 0.6), (3.75, "H", 0.5)]
PAT_A1 = [(0, "O", 1.0), (0, "M", 0.7), (0.75, "h", 0.4), (1.5, "O", 0.65), (2, "K", 0.95), (2.5, "M", 0.55), (2.75, "H", 0.55), (3.5, "M", 0.65), (3.75, "H", 0.7)]
PAT_B0 = [(0, "O", 1.0), (0.5, "H", 0.5), (1, "K", 0.85), (1.25, "h", 0.4), (1.5, "H", 0.5), (2, "O", 0.9), (2.5, "H", 0.5), (3, "K", 0.9), (3.25, "h", 0.4), (3.5, "H", 0.6), (3.75, "H", 0.5)]
PAT_B1 = [(0, "O", 1.0), (0.5, "H", 0.5), (1, "K", 0.85), (1.5, "M", 0.6), (1.75, "H", 0.5), (2, "O", 0.9), (2, "M", 0.6), (2.5, "H", 0.5), (3, "K", 0.9), (3.25, "M", 0.55), (3.5, "H", 0.7), (3.75, "M", 0.8)]
PAT_A2_0 = [(0, "O", 1.0), (0, "M", 0.9), (0.5, "H", 0.3), (1, "H", 0.35), (1.5, "O", 0.6), (2, "K", 1.0), (2, "O", 0.5), (2.5, "H", 0.35), (2.75, "H", 0.45), (3, "H", 0.4), (3.5, "M", 0.7), (3.75, "H", 0.6)]
PAT_A2_1 = [(0, "O", 1.0), (0, "M", 0.8), (0.5, "H", 0.3), (0.75, "h", 0.4), (1, "H", 0.35), (1.5, "H", 0.5), (1.75, "M", 0.5), (2, "K", 1.0), (2, "O", 0.55), (2.5, "M", 0.6), (2.75, "M", 0.55), (3, "H", 0.45), (3.25, "H", 0.4), (3.5, "M", 0.75), (3.75, "H", 0.75)]
PAT_B2_0 = [(0, "O", 1.0), (0, "M", 0.8), (0.5, "H", 0.55), (0.75, "h", 0.4), (1, "K", 0.95), (1.5, "O", 0.7), (1.75, "H", 0.5), (2, "O", 1.0), (2.5, "H", 0.55), (2.75, "h", 0.4), (3, "K", 1.0), (3.25, "M", 0.55), (3.5, "H", 0.7), (3.75, "M", 0.85)]
PAT_B2_1 = [(0, "O", 1.0), (0, "M", 0.8), (0.5, "H", 0.55), (1, "K", 0.95), (1.25, "M", 0.5), (1.5, "O", 0.75), (1.75, "H", 0.6), (2, "O", 1.0), (2, "M", 0.7), (2.5, "M", 0.6), (2.75, "H", 0.55), (3, "K", 1.0), (3.25, "H", 0.5), (3.5, "M", 0.75), (3.75, "O", 0.8)]

RUN_DOWN = [146.8, 116.5, 98.0, 77.8]                          # D3 Bb2 G2 Eb2 tom run
RUN6 = [165.0, 146.8, 130.8, 116.5, 98.0, 77.8]


def build() -> Song:
    S = Song("daeryeol", bpm=BPM, bars=NBARS, seed=444)
    T = lambda bar, beat=0.0: bar * BPB + beat      # noqa: E731
    spb = S.spb

    # ------------------------------------------------------------ tracks
    S.track("pad_dark", gain_db=-12.0, reverb={"hall": 0.25}, eq=[("hp", 50), ("lp", 1800)], duck=("perc_low", 5.0, 300), width=1.3)
    S.track("pad_brass", gain_db=-11.5, reverb={"cathedral": 0.3}, eq=[("hp", 170), ("peak", 320, 1.0, -2.0), ("lp", 5200)], duck=("perc_low", 7.0, 300), width=1.6)
    S.track("choir", gain_db=-4.0, reverb={"cathedral": 0.4}, eq=[("hp", 70), ("lp", 3600)], duck=("perc_low", 4.0, 280), width=1.5)
    S.track("lead", gain_db=-5.0, reverb={"hall": 0.2, "arena": 0.08}, eq=[("hp", 110), ("lp", 7500)])
    S.track("lead_lo", pan=-0.08, gain_db=-8.0, reverb={"hall": 0.2}, eq=[("hp", 90), ("lp", 5500)])
    S.track("haegeum", pan=-0.2, gain_db=-7.0, reverb={"hall": 0.3, "plate": 0.12}, eq=[("hp", 260), ("peak", 3000, 1.0, -2.5), ("lp", 7500)])
    S.track("bass", gain_db=-16.0, eq=[("hp", 38), ("hp", 38)], sat=1.0, duck=("perc_low", 3.0, 150))
    S.track("bass_snarl", gain_db=-13.0, eq=[("hp", 70), ("lp", 1800)], sat=1.5)
    S.track("perc_low", gain_db=-2.5, reverb={"arena": 0.16, "cave": 0.1}, eq=[("hp", 42), ("hp", 42)],
            comp=dict(thresh_db=-6.0, ratio=3.0, attack_ms=10.0, release_ms=120.0))
    S.track("perc_hi", pan=0.12, gain_db=-8.0, reverb={"plate": 0.15, "arena": 0.1}, eq=[("hp", 90)])
    S.track("perc_far", gain_db=-6.0, reverb={"cave": 0.5}, eq=[("hp", 42), ("lp", 700)])
    S.track("metal", gain_db=-5.0, reverb={"plate": 0.25, "hall": 0.15}, eq=[("hp", 400), ("lp", 9500)])
    S.track("bell", gain_db=-9.0, reverb={"cathedral": 0.35}, eq=[("hp", 60)])
    S.track("gong", gain_db=-8.0, reverb={"hall": 0.4}, eq=[("hp", 60)])
    S.track("cym", gain_db=-11.0, reverb={"plate": 0.2}, eq=[("hp", 700), ("lp", 10000)])
    S.track("fx", gain_db=-12.0, reverb={"hall": 0.15}, eq=[("hp", 40), ("hp", 40)])
    S.track("embers", gain_db=-11.0, eq=[("hp", 500), ("lp", 5500)])
    S.track("rumble", gain_db=-18.0, eq=[("hp", 25), ("lp", 220)])
    S.master_comp = dict(thresh_db=-12.0, ratio=1.8, attack_ms=30.0, release_ms=250.0, makeup_db=0.0)
    # ensemble dynamics (dB over the whole band, per section): quiet intro, stripped break, building to the A2/B2 climax.
    # The curve ends where it starts (-8 dB) so the loop seam is continuous.
    LEV_BASE = [(0, -8), (8, -9), (12, -9), (15.5, -5.5), (16, -1), (46, -1), (47.8, -0.5), (48, 0.5), (79.9, 0.5), (81.5, -8), (88, -8), (92, -9),
                (96, -5), (100, -1), (103.5, 2.5), (104, 3), (134, 3), (136, 4), (160, 4), (163, -6), (168, -8)]
    # the same curve with two short "stops" (everything drops ~14 dB for the last 8th before the A2 downbeat and the outro hit)
    LEV = [(0, -8), (8, -9), (12, -9), (15.5, -5.5), (16, -1), (46, -1), (47.8, -0.5), (48, 0.5), (79.9, 0.5), (81.5, -8), (88, -8), (92, -9),
           (96, -5), (100, -1), (103.3, 2), (103.5, -12), (103.9, -12), (103.98, 3), (104, 3), (134, 3), (136, 4), (159.3, 4),
           (159.5, -12), (159.9, -12), (159.98, 4), (160, 4), (163, -6), (168, -8)]
    for tn in S.tracks:
        if tn not in ("embers", "rumble", "bell"):
            S.automate(tn, list(LEV_BASE if tn in ("cym", "fx") else LEV))

    # ------------------------------------------------------------ helpers
    def play_brass(track, items, shift=0, vel=0.8, vmul=1.0, growl=0.28, bright=0.9, attack=0.045, release=0.22, jitter=7.0, vib_depth=7.0, **kw):
        for bar, text in items:
            for nt in parse_notes(text, T(bar), default_vel=vel):
                m = nt["midi"] + shift
                k = dict(kw)
                if "sc" in nt["mods"]:
                    k["glide_from"] = float(midi2hz(m - 1))
                S.note(track, I.brass_note, nt["beat"], m, nt["dur"] * 0.97, min(1.0, nt["vel"] * vmul), growl=growl, bright=bright,
                       attack=attack, release=release, vib_depth=vib_depth * (1.8 if nt["dur"] >= 1.5 else 1.0), jitter_ms=jitter, **k)

    def play_hae(items, shift=0, vel=0.8, vmul=1.0, attack=0.12, vib=28.0, scratch=0.45, noise=0.28, **kw):
        for bar, text in items:
            for nt in parse_notes(text, T(bar), default_vel=vel):
                k = dict(kw)
                if "sc" in nt["mods"]:
                    k["scoop"] = -2.0
                if "wd" in nt["mods"]:
                    k["scoop"] = -5.0
                    k["scoop_t"] = 0.3
                if "fl" in nt["mods"]:
                    k["fall"] = -2.5
                if "tr" in nt["mods"]:
                    k["trill"] = 1.0
                    k["fall"] = -2.0
                S.note("haegeum", hae, nt["beat"], nt["midi"] + shift, nt["dur"] * 0.98, min(1.0, nt["vel"] * vmul), attack=attack, release=0.3,
                       vib_depth=vib, vib_rate=6.1, vib_delay=0.12, bow_noise=noise, scratch=scratch, voices=2, jitter_ms=7.0, **k)

    def choir_note(beat, dur, midi, vel, v0="u", v1="o", **kw):
        S.note("choir", choir, beat, midi, dur, vel, v_from=v0, v_to=v1, t_morph=dur * 0.75 * spb, jitter_ms=0.0, **kw)

    def pad_chord(track, midis, beat, dur, vel=0.7, **kw):
        sig = chord_pad([float(midi2hz(m)) for m in midis], dur * spb, vel=vel, rng=np.random.default_rng(S.rng.integers(1 << 31)), **kw)
        S.add(track, sig, beat)

    def drum(d, beat, vel, chord, vs=1.0, far=False):
        v = float(min(1.0, vel * vs))
        if far:
            S.hit("perc_far", I.taiko, beat, v, freq=(BIG if d == "O" else MID[chord] if d in "MK" else HI), size=1.4 if d == "O" else 0.9,
                  dur=2.0 if d == "O" else 1.2)
        elif d == "O":
            S.hit("perc_low", I.taiko, beat, v, freq=BIG, size=1.5, dur=2.4)
        elif d == "M":
            S.hit("perc_low", I.taiko, beat, v, freq=MID[chord], size=1.0, dur=1.6)
        elif d == "K":
            S.hit("perc_low", I.taiko, beat, v, freq=MID[chord], size=0.9, dur=1.4, rim=0.7)
        elif d == "H":
            S.hit("perc_hi", I.taiko, beat, v, freq=HI, size=0.5, dur=0.8, tight=0.4)
        elif d == "h":
            S.hit("perc_hi", I.taiko, beat, v, freq=HI2, size=0.4, dur=0.6, tight=0.6)

    def play_pat(bar, pat, chord, vs=1.0, until=4.0):
        for beat, d, v in pat:
            if beat < until:
                drum(d, T(bar, beat), v, chord, vs)

    def run_fill(bar, beat0, freqs, v0, v1, step=0.25, track="perc_hi", size=0.55):
        n = len(freqs)
        for i, f in enumerate(freqs):
            S.hit(track, I.taiko, T(bar, beat0) + i * step, v0 + (v1 - v0) * i / max(n - 1, 1), freq=f, size=size, dur=0.8, tight=0.3)

    def roll_fill(bar, beat0, n, v0, v1, fa=110.0, fb=98.0, step=0.25, track="perc_hi", size=0.6):
        for i in range(n):
            S.hit(track, I.taiko, T(bar, beat0) + i * step, v0 + (v1 - v0) * (i / max(n - 1, 1)) ** 1.2, freq=(fa if i % 2 == 0 else fb), size=size, dur=0.8, tight=0.3)

    def anv(beat, vel, midi=74, pan=0.0, ring=1.0):
        S.note("metal", anvil, beat, midi, 1.4 / spb, vel, pan=pan, ring=ring, jitter_ms=3.0)

    def gong(beat, vel, midi=50, dur=9.0):
        S.note("gong", I.gong, beat, midi, dur, vel, jitter_ms=0.0)

    def impact(beat, vel, big=True, cym=True, bm=True):
        if big:
            S.hit("perc_low", I.taiko, beat, vel, freq=BIG_LO, size=1.8, dur=3.0, jitter_ms=0.0)
            S.hit("perc_low", I.taiko, beat - 0.06, vel * 0.45, freq=BIG, size=1.2, dur=1.4, jitter_ms=0.0)  # flam
        if bm:
            S.hit("fx", boom, beat, vel, dur=2.6, jitter_ms=0.0)
        if cym:
            S.hit("cym", I.cymbal, beat, min(1.0, vel), dur=4.0, size=1.0, hi=0.9, jitter_ms=0.0)

    # ------------------------------------------------------------ harmony beds: segments for A / B / A2 / B2
    segs = []
    i = 0
    while i < NBARS:
        j = i
        while j + 1 < NBARS and PROG[j + 1] == PROG[i] and SEC[j + 1] == SEC[i]:
            j += 1
        segs.append((i, j - i + 1, PROG[i]))
        i = j + 1

    STAB_EVEN = [(0.0, 0.9, 0.9), (1.5, 0.75, 0.65), (3.0, 0.6, 0.7)]
    STAB_ODD = [(0.0, 0.9, 0.9), (2.0, 0.75, 0.65), (3.5, 0.5, 0.7)]
    for b0, nb, ch in segs:
        sec = SEC[b0]
        if sec not in ("A", "B", "A2", "B2"):
            continue
        beat0 = T(b0)
        dur = nb * BPB
        low, top = CH[ch]["low"], CH[ch]["top"]
        if sec == "A":
            pad_chord("pad_dark", low, beat0, dur + 0.4, vel=0.5, kind="dark", attack=1.2, release=1.8, cutoff_open=1400, cutoff_closed=280, voices=5, spread=10)
            pad_chord("pad_brass", top, beat0, dur + 0.4, vel=0.52, kind="brass", attack=1.5, release=2.0, cutoff_open=2700, cutoff_closed=380, voices=5, spread=14)
        elif sec == "A2":
            pad_chord("pad_dark", low, beat0, dur + 0.4, vel=0.62, kind="dark", attack=0.8, release=1.4, cutoff_open=1800, cutoff_closed=400, voices=5, spread=10)
            pad_chord("pad_brass", top, beat0, dur + 0.4, vel=0.62, kind="brass", attack=1.0, release=1.6, cutoff_open=3200, cutoff_closed=450, voices=5, spread=14)
            for bar in range(b0, b0 + nb):                    # pickup stab on the last 8th of every bar
                pad_chord("pad_brass", top, T(bar, 3.5), 0.5, vel=0.7, kind="brass", attack=0.03, release=0.35, cutoff_open=3600, cutoff_closed=900, voices=5, spread=16)
        else:   # B / B2: one chord per bar, sustained bed + stabs
            hot = sec == "B2"
            stop = b0 == 39                       # last bar of B2: beds end on the 4th beat's "&" (the stop before the outro hit)
            pad_chord("pad_dark", low, beat0, dur - 0.5 if stop else dur + 0.3, vel=0.7 if hot else 0.55, kind="dark", attack=0.35, release=0.15 if stop else 0.7, cutoff_open=1900 if hot else 1700, cutoff_closed=350, voices=5, spread=10)
            pad_chord("pad_brass", top, beat0, dur - 0.5 if stop else dur + 0.3, vel=0.45 if hot else 0.3, kind="brass", attack=0.3, release=0.15 if stop else 0.6, cutoff_open=3000, cutoff_closed=500, voices=5, spread=14)
            for bar in range(b0, b0 + nb):
                pat = STAB_EVEN if bar % 2 == 0 else STAB_ODD
                for sb, sd, sv in pat:
                    if bar == 39 and sb >= 3.5:      # the stop before the outro hit
                        continue
                    pad_chord("pad_brass", top, T(bar, sb), sd, vel=sv * (0.9 if hot else 0.68), kind="brass", attack=0.03, release=0.3,
                              cutoff_open=3800, cutoff_closed=900, voices=5, spread=16)

    # A: pickup stabs in the second half of the section (they push into B)
    for bar in range(8, 12):
        pad_chord("pad_brass", CH[PROG[bar]]["top"], T(bar, 3.5), 0.5, vel=0.55, kind="brass", attack=0.03, release=0.35, cutoff_open=3200, cutoff_closed=900, voices=5, spread=16)
    # arrival stabs: the full brass cluster hits on the downbeat of A and A2 (the swelling beds fade in underneath)
    pad_chord("pad_brass", CH["D"]["top"], T(4), 2.0, vel=0.75, kind="brass", attack=0.03, release=1.4, cutoff_open=3800, cutoff_closed=700, voices=5, spread=16)
    pad_chord("pad_brass", CH["D"]["top"], T(26), 2.5, vel=1.0, kind="brass", attack=0.03, release=1.6, cutoff_open=4200, cutoff_closed=800, voices=5, spread=16)

    # ---- intro pads (explicit)
    pad_chord("pad_dark", CH["D5"]["low"], 0, 16.5, vel=0.34, kind="dark", attack=2.4, release=2.6, cutoff_open=800, cutoff_closed=240, voices=5, spread=10)
    pad_chord("pad_dark", CH["Eb"]["low"], T(2), 6.0, vel=0.26, kind="dark", attack=2.6, release=2.0, cutoff_open=700, cutoff_closed=220, voices=4, spread=10)
    pad_chord("pad_brass", CH["Eb"]["top"], T(2), 4.5, vel=0.3, kind="brass", attack=3.0, release=1.5, cutoff_open=1500, cutoff_closed=300, voices=5, spread=14)
    pad_chord("pad_brass", CH["Co"]["top"], T(3), 4.0, vel=0.42, kind="brass", attack=2.8, release=1.6, cutoff_open=1900, cutoff_closed=300, voices=5, spread=14)

    # ---- break pads: strip, then swell into A2
    pad_chord("pad_dark", CH["D5"]["low"], T(20), 16.4, vel=0.42, kind="dark", attack=3.5, release=1.5, cutoff_open=900, cutoff_closed=240, voices=5, spread=10)
    pad_chord("pad_dark", CH["A7"]["low"], T(24), 7.5, vel=0.8, kind="dark", attack=6.5, release=0.15, cutoff_open=2200, cutoff_closed=260, voices=5, spread=10)
    pad_chord("pad_brass", CH["D"]["top"], T(21), 4.5, vel=0.3, kind="brass", attack=3.0, release=1.5, cutoff_open=1300, cutoff_closed=300, voices=5, spread=14)
    pad_chord("pad_brass", CH["Eb"]["top"], T(22), 4.5, vel=0.5, kind="brass", attack=3.5, release=1.4, cutoff_open=1900, cutoff_closed=300, voices=5, spread=14)
    pad_chord("pad_brass", CH["Co"]["top"], T(23), 4.4, vel=0.66, kind="brass", attack=3.6, release=1.2, cutoff_open=2600, cutoff_closed=300, voices=5, spread=15)
    pad_chord("pad_brass", CH["A7"]["top"], T(24), 7.5, vel=0.95, kind="brass", attack=7.0, release=0.15, cutoff_open=3800, cutoff_closed=300, voices=5, spread=16)

    # ---- outro pads: D5(b6) hit, then the hanging drone that wraps into the intro
    pad_chord("pad_brass", CH["D5b6"]["top"], T(40), 4.0, vel=0.9, kind="brass", attack=0.05, release=3.5, cutoff_open=4000, cutoff_closed=1200, voices=5, spread=16)
    pad_chord("pad_dark", CH["D5b6"]["low"], T(40), 4.0, vel=0.7, kind="dark", attack=0.1, release=1.6, cutoff_open=2000, cutoff_closed=500, voices=5, spread=10)
    pad_chord("pad_dark", CH["D5"]["low"], T(41), 4.0, vel=0.5, kind="dark", attack=0.6, release=3.0, cutoff_open=900, cutoff_closed=260, voices=5, spread=10)

    # ------------------------------------------------------------ choir drone (the "ooh")
    choir_note(0, 16.5, 50, 0.5, "u", "o", attack=2.5, release=2.5)               # D3 pedal
    choir_note(0, 16.5, 57, 0.32, "u", "u", attack=3.0, release=2.5)              # A3
    choir_note(T(1), 12.5, 51, 0.28, "u", "o", attack=3.0, release=2.0)           # Eb3 creeps in -> D/Eb beating
    choir_note(T(4), 32.5, 50, 0.38, "o", "a", attack=1.5, release=2.0)           # A: D3 pedal, vowel opens
    choir_note(T(4), 32.5, 57, 0.3, "o", "a", attack=2.0, release=2.0)
    choir_note(T(11), 4.5, 58, 0.3, "o", "o", attack=0.8, release=1.5)            # Bb3 against A3 in the dominant bar
    choir_note(T(16), 16.5, 50, 0.34, "o", "a", attack=1.5, release=1.5)          # B: second half only
    choir_note(T(16), 16.5, 62, 0.26, "o", "a", attack=2.5, release=1.5)
    choir_note(T(20), 16.4, 50, 0.55, "u", "o", attack=3.5, release=1.5)          # break: D pedal ...
    choir_note(T(21), 12.4, 51, 0.38, "u", "o", attack=3.0, release=1.5)          # ... with Eb creeping against it
    choir_note(T(24), 7.5, 57, 0.8, "o", "a", attack=6.0, release=0.15)           # build: A + Bb + C# swell
    choir_note(T(24), 7.5, 58, 0.7, "o", "a", attack=6.2, release=0.15)
    choir_note(T(24), 7.5, 61, 0.6, "o", "a", attack=6.4, release=0.15)
    choir_note(T(26), 32.5, 50, 0.55, "a", "a", attack=0.6, release=1.5)          # A2: open "aah" pedal
    choir_note(T(26), 32.5, 57, 0.42, "a", "a", attack=0.8, release=1.5)
    choir_note(T(26), 32.5, 62, 0.4, "a", "o", attack=1.0, release=1.5)
    choir_note(T(34), 23.5, 50, 0.6, "a", "a", attack=0.4, release=0.25)          # B2 (ends on the stop)
    choir_note(T(34), 23.5, 62, 0.45, "a", "a", attack=0.6, release=0.25)
    choir_note(T(34), 23.5, 69, 0.35, "a", "a", attack=0.8, release=0.25)
    choir_note(T(40), 8.0, 50, 0.6, "a", "u", attack=0.2, release=3.5)            # outro: hanging drone -> intro
    choir_note(T(40), 8.0, 57, 0.45, "a", "u", attack=0.2, release=3.5)
    choir_note(T(41), 4.0, 51, 0.25, "u", "u", attack=1.5, release=3.5)

    # ------------------------------------------------------------ bass
    def bass_note(beat, midi, dur, vel, release=0.14, attack=0.012, track="bass", **kw):
        S.note(track, I.sub_bass, beat, midi, dur, vel, attack=attack, release=release, drive=1.7, harm=0.32, jitter_ms=3.0, **kw)

    # intro: sub drone D2 with Eb2 against it
    S.note("bass", I.sub_bass, 0.0, 38, 16.0, 0.42, attack=1.5, release=2.5, drive=1.4, harm=0.3, jitter_ms=0.0)
    S.note("bass", I.sub_bass, T(2), 39, 6.0, 0.3, attack=2.0, release=1.5, drive=1.4, harm=0.3, jitter_ms=0.0)
    # A
    BASS_A = {
        4: [(0, 38, 1.8, 0.9), (2, 38, 1.4, 0.8), (3.5, 39, 0.5, 0.6)],
        5: [(0, 38, 1.8, 0.85), (2, 45, 1.0, 0.7), (3, 38, 0.9, 0.7)],
        6: [(0, 39, 1.8, 0.9), (2, 39, 1.4, 0.8), (3.5, 38, 0.5, 0.6)],
        7: [(0, 39, 1.8, 0.85), (2, 46, 1.0, 0.7), (3, 39, 0.9, 0.7)],
        8: [(0, 37, 1.8, 0.9), (2, 43, 1.4, 0.75), (3.5, 37, 0.5, 0.6)],
        9: [(0, 37, 1.0, 0.85), (1.5, 37, 0.5, 0.6), (2, 43, 1.5, 0.8), (3.5, 38, 0.5, 0.7)],
        10: [(0, 38, 1.8, 0.95), (2, 38, 1.0, 0.8), (3, 34, 0.9, 0.75)],
        11: [(0, 33, 1.8, 0.95), (2, 34, 1.0, 0.8), (3, 33, 0.9, 0.8)],      # A Bb A in the bass too
    }
    for bar, lst in BASS_A.items():
        for bt, m, d, v in lst:
            bass_note(T(bar, bt), m, d, v)
            if bar >= 8 and bt in (0, 2):                    # the bowed bass snarl joins in the second half of A
                S.note("bass_snarl", I.bowed, T(bar, bt), m + 12, d * 0.9, 0.55 * v, kind="bass", attack=0.04, release=0.15, vib_depth=0.0, bow_noise=0.1, jitter_ms=3.0)
    # B: eighth-note pulse with octave jumps; pickup into the next chord every 4th bar
    for bar in range(12, 20):
        r = CH[PROG[bar]]["root"]
        for k in range(8):
            m = r + (12 if k in (3, 7) else 0)
            if bar in (15, 19) and k >= 6:
                m = r - 1 if k == 6 else r + 1
            bass_note(T(bar, k * 0.5), m, 0.42, 0.9 if k in (0, 4) else 0.68, release=0.1)
    # break
    S.note("bass", I.sub_bass, T(20), 38, 12.0, 0.42, attack=0.8, release=1.5, drive=1.4, harm=0.3, jitter_ms=0.0)
    S.note("bass", I.sub_bass, T(23), 37, 4.0, 0.55, attack=0.3, release=0.5, drive=1.5, harm=0.3, jitter_ms=0.0)
    for k in range(8):                                                          # A pedal, quarter -> eighth pulse
        bass_note(T(24, k * 0.5), 33, 0.42, 0.7 + 0.04 * k, release=0.1)
    for k in range(7):                                                          # last 8th stays empty: the stop before A2
        bass_note(T(25, k * 0.5), 33, 0.42, 0.95, release=0.1)
    # A2: heavier, with gallop
    for bar in range(26, 34):
        r = CH[PROG[bar]]["root"]
        pat = [(0, r, 1.25, 1.0), (1.5, r, 0.5, 0.7), (2, r, 1.0, 0.9), (3, r, 0.5, 0.75), (3.5, r + 12, 0.5, 0.65)]
        if bar == 33:
            pat = [(0, 33, 1.0, 1.0), (1, 34, 1.0, 0.9), (2, 33, 1.0, 0.95), (3, 34, 0.5, 0.85), (3.5, 33, 0.5, 0.95)]
        for bt, m, d, v in pat:
            bass_note(T(bar, bt), m, d, v)
            if bar >= 28 and bt in (0, 2):
                S.note("bass_snarl", I.bowed, T(bar, bt), m + 12, d * 0.9, 0.7 * v, kind="bass", attack=0.03, release=0.12, vib_depth=0.0, bow_noise=0.1, jitter_ms=3.0)
    # B2: eighth pulse, octave jumps, bowed snarl
    for bar in range(34, 40):
        r = CH[PROG[bar]]["root"]
        for k in range(7 if bar == 39 else 8):                                  # bar 39: the last 8th stays empty (stop)
            m = r + (12 if k in (3, 7) else 0)
            if bar == 39:
                m = 33 + (1 if k % 4 == 2 else 0)
            bass_note(T(bar, k * 0.5), m, 0.42, 1.0 if k in (0, 4) else 0.75, release=0.1)
            if k % 2 == 0:
                S.note("bass_snarl", I.bowed, T(bar, k * 0.5), m + 12, 0.4, 0.55 if k in (0, 4) else 0.4, kind="bass", attack=0.02, release=0.1, vib_depth=0.0, bow_noise=0.1, jitter_ms=3.0)
    # outro
    S.note("bass", I.sub_bass, T(40), 26, 6.0, 1.0, attack=0.01, release=1.5, drive=1.8, harm=0.35, jitter_ms=0.0)
    S.note("bass", I.sub_bass, T(40), 38, 4.0, 0.9, attack=0.01, release=1.2, drive=1.7, harm=0.35, jitter_ms=0.0)
    S.note("bass", I.sub_bass, T(41), 38, 4.0, 0.42, attack=1.0, release=2.5, drive=1.4, harm=0.3, jitter_ms=0.0)

    # ------------------------------------------------------------ lead (brass theme) and counter-voices
    # intro foreshadow: the X motif, augmented, distant
    play_brass("lead", INTRO_X, vel=0.38, bright=0.45, growl=0.1, attack=0.25, release=0.6, vib_depth=0)
    # A
    play_brass("lead", THEME_A, vel=0.85, growl=0.3)
    play_hae(A_HAE, vel=0.5, attack=0.6, vib=30.0, scratch=0.2, noise=0.2)
    # B: haegeum calls, brass answers
    play_hae(B_HAE, vel=0.85)
    play_brass("lead", B_BRASS, vel=0.9, growl=0.34)
    # break: leitmotif M1 in the haegeum (bent), brass Y-sequence build
    play_hae(BREAK_M1, vel=0.5, attack=0.2, vib=26.0, scratch=0.15, noise=0.2)
    play_brass("lead", BUILD_BRASS, vel=0.7, growl=0.35, bright=1.0)
    S.note("haegeum", hae, T(24), 81, 4.0, 0.55, scoop=-7.0, scoop_t=1.5, attack=0.6, release=0.2, vib_depth=34.0, vib_rate=6.4, bow_noise=0.34, scratch=0.5, voices=2, jitter_ms=3.0)
    S.note("haegeum", hae, T(25), 82, 3.5, 0.85, scoop=-3.0, scoop_t=0.4, trill=-1.0, trill_t0=1.2, fall=-3.0, attack=0.4, release=0.2, vib_depth=34.0, vib_rate=6.4, bow_noise=0.34, scratch=0.5, voices=2, jitter_ms=3.0)
    # A2: theme in octaves
    play_brass("lead", THEME_A2, vel=0.95, growl=0.32)
    play_brass("lead_lo", THEME_A2, shift=-12, vel=0.85, growl=0.42, bright=0.7)
    play_hae([(b, t) for b, t in THEME_A2 if b <= 30], shift=12, vel=0.7, attack=0.1, vib=26.0, scratch=0.35)
    play_hae([(b, t) for b, t in THEME_A2 if b > 30], vel=0.7, attack=0.1, vib=26.0, scratch=0.35)
    # B2: fanfare, three-octave stack; haegeum on top
    play_brass("lead", B2_BRASS, vel=1.0, growl=0.34, bright=1.0)
    play_brass("lead_lo", B2_BRASS, shift=-12, vel=0.9, growl=0.45, bright=0.7)
    play_hae([(b, t) for b, t in B2_BRASS if b not in (37, 38)], shift=12, vel=0.9, attack=0.08, vib=30.0, scratch=0.5, noise=0.35)
    play_hae([(37, "Eb6:1.5^sc F#6:.5 G6:1 F#6:.5 Eb6:.5"), (38, "Bb5:.5 C#6:.5 E6:.5 G6:.5 Bb5:2^fl")], vel=0.95, attack=0.05, vib=32.0, scratch=0.5, noise=0.35)
    # outro: the final D, a low brass groan and a keening A
    S.note("lead", I.brass_note, T(40), 62, 3.5, 1.0, growl=0.4, bright=1.0, attack=0.04, release=0.5, glide_from=float(midi2hz(61)), jitter_ms=2.0)
    S.note("lead_lo", I.brass_note, T(40), 50, 4.0, 0.95, growl=0.5, bright=0.7, attack=0.05, release=0.6, jitter_ms=2.0)
    S.note("haegeum", hae, T(40), 81, 4.0, 0.7, scoop=-2.0, fall=-3.0, attack=0.1, release=0.6, vib_depth=34.0, vib_rate=6.2, bow_noise=0.3, scratch=0.4, voices=2, jitter_ms=2.0)

    # ------------------------------------------------------------ percussion
    # intro: distant heartbeat
    for bar in range(0, 4):
        v = 0.3 + 0.07 * bar
        drum("O", T(bar, 0.0), v, "D", far=True)
        drum("M", T(bar, 0.75), v * 0.7, "D", far=True)
        if bar >= 1:
            drum("O", T(bar, 2.0), v * 0.8, "D", far=True)
            drum("M", T(bar, 2.75), v * 0.55, "D", far=True)
    for i in range(4):                                  # soft hand-roll into the downbeat of A
        S.hit("perc_far", I.taiko, T(3, 3.0) + i * 0.25, 0.25 + 0.1 * i, freq=HI, size=0.8, dur=1.0)
    # A
    for bar in range(4, 12):
        chord = PROG[bar]
        pat = PAT_A0 if (bar - 4) % 2 == 0 else PAT_A1
        vs = 0.92 if bar < 6 else 1.0
        if bar == 7:
            play_pat(bar, pat, chord, vs, until=3.0)
            run_fill(bar, 3.0, RUN_DOWN, 0.5, 0.8)
        elif bar == 11:
            play_pat(bar, PAT_A0, chord, vs, until=2.0)
            roll_fill(bar, 2.0, 8, 0.35, 1.0)
            drum("O", T(bar, 3.5), 0.8, chord)
        else:
            play_pat(bar, pat, chord, vs)
    # B
    for bar in range(12, 20):
        chord = PROG[bar]
        pat = PAT_B0 if (bar - 12) % 2 == 0 else PAT_B1
        if bar == 15:
            play_pat(bar, pat, chord, until=2.5)
            run_fill(bar, 2.5, RUN6, 0.5, 0.95)
        elif bar == 19:
            play_pat(bar, PAT_B0, chord, until=2.0)
            roll_fill(bar, 2.0, 8, 0.45, 1.0, fa=HI, fb=HI2)
            drum("O", T(bar, 2.0), 0.85, chord)
            drum("O", T(bar, 3.0), 0.95, chord)
        else:
            play_pat(bar, pat, chord)
    # break: one huge hit, then sparse heartbeat, then the roll build
    drum("O", T(20), 1.0, "D5")
    for bar, v in ((21, 0.42), (22, 0.5)):
        drum("O", T(bar, 0.0), v, "D", far=True)
        drum("M", T(bar, 0.75), v * 0.7, "D", far=True)
        drum("O", T(bar, 2.0), v * 0.85, "D", far=True)
        drum("M", T(bar, 2.75), v * 0.6, "D", far=True)
    for k in range(4):                                                         # bar 23: quarter-note BIG
        drum("O", T(23, k), 0.5 + 0.07 * k, "Co", vs=1.0)
        drum("h", T(23, k + 0.5), 0.3 + 0.04 * k, "Co")
    for k in range(8):                                                         # bar 24: eighths alternate BIG / mid
        S.hit("perc_low", I.taiko, T(24, k * 0.5), 0.5 + 0.045 * k, freq=(BIG if k % 2 == 0 else HI), size=1.2 if k % 2 == 0 else 0.7, dur=1.4)
    for k in range(14):                                                        # bar 25: 16th roll, last 8th empty (stop)
        S.hit("perc_hi", I.taiko, T(25, k * 0.25), 0.55 + 0.4 * (k / 13.0), freq=[HI, 98.0, 73.4][k % 3], size=0.7, dur=1.0, tight=0.2)
    for k in range(4):
        drum("O", T(25, k), 0.8 + 0.05 * k, "A7")
    # A2
    for bar in range(26, 34):
        chord = PROG[bar]
        pat = PAT_A2_0 if (bar - 26) % 2 == 0 else PAT_A2_1
        if bar == 29:
            play_pat(bar, pat, chord, until=3.0)
            run_fill(bar, 3.0, RUN_DOWN, 0.6, 0.9)
        elif bar == 33:
            play_pat(bar, PAT_A2_0, chord, until=2.0)
            roll_fill(bar, 2.0, 8, 0.45, 1.0, fa=HI, fb=HI2)
            drum("O", T(bar, 2.0), 0.9, chord)
            drum("O", T(bar, 3.0), 1.0, chord)
        else:
            play_pat(bar, pat, chord)
    # B2
    for bar in range(34, 40):
        chord = PROG[bar]
        pat = PAT_B2_0 if (bar - 34) % 2 == 0 else PAT_B2_1
        if bar == 35:
            play_pat(bar, pat, chord, until=3.0)
            run_fill(bar, 3.0, RUN_DOWN, 0.6, 0.95)
        elif bar == 37:
            play_pat(bar, PAT_B2_0, chord, until=2.0)
            roll_fill(bar, 2.0, 8, 0.5, 1.0, fa=HI, fb=HI2)
            drum("O", T(bar, 2.0), 0.9, chord)
            drum("O", T(bar, 3.0), 1.0, chord)
        elif bar == 39:
            for k in range(14):                                                # full-bar roll, stop on the last 8th
                S.hit("perc_hi", I.taiko, T(39, k * 0.25), 0.55 + 0.45 * (k / 13.0), freq=[HI, 98.0, 73.4, HI2][k % 4], size=0.7, dur=1.0, tight=0.2)
            for k in range(4):
                drum("O", T(39, k * 1.0), 0.85 + 0.05 * k, "A7")
        else:
            play_pat(bar, pat, chord)
    # outro hit + heartbeat that continues into the intro
    impact(T(40), 1.0)
    drum("M", T(40), 1.0, "D5b6")
    drum("K", T(40, 0.0), 0.8, "D5b6")
    drum("O", T(40, 2.0), 0.6, "D5b6")
    drum("O", T(41, 2.0), 0.4, "D", far=True)
    drum("M", T(41, 2.75), 0.28, "D", far=True)

    # ------------------------------------------------------------ metal
    # A: iron on the 4th beat of odd bars, deep clang on section/phrase starts
    for bar in range(4, 12):
        r = CH[PROG[bar]]["root"]
        if bar in (4, 8):
            anv(T(bar), 0.6, midi=r + 24, ring=1.4)
        if bar % 2 == 1:
            anv(T(bar, 3.0), 0.45, midi=r + 36, pan=0.3 if bar % 4 == 1 else -0.3)
    # B: off-beat anvils, alternating sides
    for bar in range(12, 20):
        r = CH[PROG[bar]]["root"]
        anv(T(bar, 1.5), 0.5, midi=r + 36, pan=-0.35)
        anv(T(bar, 3.5), 0.6, midi=r + 36, pan=0.35)
        if bar in (14, 18):
            anv(T(bar), 0.65, midi=r + 24, ring=1.4)
    # break: distant tinks, then the build
    anv(T(21, 2.0), 0.35, midi=74, pan=0.25)
    anv(T(22, 2.0), 0.4, midi=75, pan=-0.25)
    for k in (0, 2):
        anv(T(23, k), 0.45, midi=73)
    for k in range(4):
        anv(T(24, k), 0.45 + 0.07 * k, midi=[73, 75, 73, 76][k], pan=(-0.3, 0.3)[k % 2])
    for k in range(7):
        anv(T(25, k * 0.5), 0.6 + 0.05 * k, midi=[76, 74][k % 2] + (k // 4) * 2, pan=(-0.3, 0.3)[k % 2], ring=0.7)
    S.hit("metal", chain, T(25, 1.0), 0.8, dur=0.9, links=14)
    # A2: iron on every backbeat + off-beat
    for bar in range(26, 34):
        r = CH[PROG[bar]]["root"]
        anv(T(bar, 1.0), 0.6, midi=r + 36, pan=-0.3, ring=0.8)
        anv(T(bar, 3.0), 0.7, midi=r + 36, pan=0.3, ring=0.8)
        if bar % 2 == 1:
            anv(T(bar, 3.5), 0.5, midi=r + 48, pan=-0.2, ring=0.6)
        if bar in (26, 30):
            anv(T(bar), 0.7, midi=r + 24, ring=1.5)
    # B2: eighth-note iron
    for bar in range(34, 40):
        r = CH[PROG[bar]]["root"]
        for k in range(7 if bar == 39 else 8):
            anv(T(bar, k * 0.5), (0.7 if k % 2 else 0.5), midi=r + 36 + (12 if k % 4 == 3 else 0), pan=(-0.35, 0.35)[k % 2], ring=0.6)
        if bar in (34, 36):
            anv(T(bar), 0.8, midi=r + 24, ring=1.6)
    # outro: the big clang and a chain rattle
    anv(T(40), 0.9, midi=50 + 24, ring=1.8)
    S.hit("metal", chain, T(40, 0.1), 0.7, dur=0.9, links=14)
    # ------------------------------------------------------------ bells
    S.note("bell", I.bell, T(20), 50, 9.0, 0.8, kind="temple", jitter_ms=0.0)
    S.note("bell", I.bell, T(22), 51, 9.0, 0.7, kind="temple", jitter_ms=0.0)
    S.note("bell", I.bell, T(23), 50, 6.0, 0.7, kind="temple", jitter_ms=0.0)
    S.note("bell", I.bell, T(2), 50, 9.0, 0.5, kind="temple", jitter_ms=0.0)
    S.note("bell", I.bell, T(40), 50, 12.0, 0.9, kind="temple", jitter_ms=0.0)
    S.note("bell", I.bell, T(40), 51, 10.0, 0.7, kind="temple", jitter_ms=0.0)

    # ------------------------------------------------------------ gong / cymbals / fx
    gong(T(0), 0.55)
    gong(T(4), 0.85)
    gong(T(12), 0.9)
    gong(T(20), 0.7)
    gong(T(26), 1.0)
    gong(T(26), 0.8, midi=51)
    gong(T(34), 1.0)
    gong(T(40), 1.0)
    gong(T(40), 0.7, midi=51)
    for bar, v in ((4, 0.6), (12, 0.7), (26, 1.0), (30, 0.5), (34, 1.0), (36, 0.7), (38, 0.7), (40, 0.9)):
        S.hit("cym", I.cymbal, T(bar), v, dur=3.5 if bar != 26 else 4.5, size=1.0, hi=0.9)
    for beat, v, d in ((T(4), 0.35, 2.4), (T(12), 0.6, 2.8), (T(26), 1.0, 3.4), (T(34), 0.9, 2.8), (T(40), 0.7, 2.4)):
        S.hit("cym", rev_cymbal, beat - d / spb, v, dur=d, jitter_ms=0.0)
    # impacts (boom + big drum flam) at section starts
    impact(T(4), 0.7, cym=False)
    impact(T(12), 0.8, cym=False)
    impact(T(20), 0.9, cym=False)
    impact(T(26), 1.0, cym=False)
    impact(T(34), 1.0, cym=False)
    # risers
    S.hit("fx", riser, T(10, 0.0), 0.5, dur=7.5 * spb, jitter_ms=0.0)
    S.hit("fx", riser, T(24, 0.0), 0.95, dur=7.5 * spb, jitter_ms=0.0)
    S.hit("fx", riser, T(32, 0.0), 0.75, dur=7.5 * spb, jitter_ms=0.0)
    S.hit("fx", riser, T(38, 0.0), 0.85, dur=7.5 * spb, jitter_ms=0.0)
    # rumble beds
    S.hit("rumble", rumble, T(0), 0.5, dur=16 * spb, shape="flat", jitter_ms=0.0)
    S.hit("rumble", rumble, T(20), 0.7, dur=24 * spb, shape="swell", jitter_ms=0.0)
    S.hit("rumble", rumble, T(40), 0.7, dur=8 * spb, shape="decay", jitter_ms=0.0)

    # ------------------------------------------------------------ embers (fire crackle bed): irregular clustered pops, section-weighted
    erng = dsp.rng_for("daeryeol", "embers")
    pool = []
    for _ in range(14):
        n = nsamp(0.03)
        c = dsp.bp(erng.standard_normal(n), erng.uniform(700.0, 3200.0), erng.uniform(1.2, 3.0)) * np.exp(-np.arange(n) / (SR * erng.uniform(0.002, 0.008)))
        pool.append(c / (np.abs(c).max() + 1e-9))
    dens = {"intro": 0.7, "A": 0.3, "B": 0.2, "brk": 0.6, "A2": 0.25, "B2": 0.15, "out": 0.6}
    lam_max = 3.5          # clusters per second at density 1.0
    t = 0.0
    total = S.loop_len / SR
    while True:
        t += erng.exponential(1.0 / lam_max)
        if t >= total:
            break
        bar = min(int(t / (spb * BPB)), NBARS - 1)
        if erng.uniform() > dens[SEC[bar]]:
            continue
        tt = t
        pan = float(erng.uniform(-0.8, 0.8))
        for j in range(1 + int(erng.integers(0, 4))):          # a cluster of 1-4 pops, decaying
            S.add("embers", pool[int(erng.integers(len(pool)))], tt / spb, gain=float(erng.uniform(0.1, 1.0) ** 2.5) * 0.7 ** j, pan=pan)
            tt += erng.uniform(0.02, 0.14)

    return S

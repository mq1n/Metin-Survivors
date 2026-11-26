"""Suryeon Valley -- zone 2 theme ("Orc Warbands of the Valley"). A minor-pentatonic with Phrygian colour (A C D E G + Bb), 100 BPM, 44 bars.

Form (bars): Intro 0-3 (drums + overtone drone, crescendo) | A 4-11 (cello ostinato, low daegeum theme) | B 12-19 (haegeum howls, walking bass)
| C 20-27 (half-time HEAVY: slow taiko, brass, big gong, M1 augmented in the horns) | A' 28-35 (theme varied/doubled, extra percussion)
| B' 36-41 (full band, M1 quoted high) | Outro 42-43 (drums only, pickup roll that lands on the Intro downbeat).

Theme (daegeum): A3 -- E4 E4 C4 | D4 C4 A3 | A3 D4 E4 G4 E4 | Bb3 A3 (the Bb3 is the deliberate b2 rub against the A drone; it sighs down to A).
Leitmotif M1 (A D C A | G A C) returns augmented in the low horns (bars 20-23), inverted in the horns (24-27) and rhythmically
transformed up an octave in the haegeum (bars 36-37).
"""
from __future__ import annotations

import numpy as np

from .. import dsp
from .. import instruments as I
from ..comp import euclid, roll
from ..dsp import TAU, nsamp, tvec
from ..music import Song, parse_notes, transpose

ID = "mus_suryeon"
LOOP = True

# AG-02 calm variant (music.apply_calm): same notes, tempo, bars and key; no percussion (taiko, drums, perc_hi, gong, war grunts, swells)
# and no brass (the brass pad and the horns); the khoomei drone, pads, cello, strings, pizzicato, bass and the daegeum / haegeum lead
# stay, the lead and the cello ostinato softened.
CALM = dict(
    mute=("brass", "horn", "taiko", "drums", "perc_hi", "fx", "gong", "grunt"),
    trim_db={"cello": -2.0, "bass": -2.0, "pad": 2.0, "strings": 2.0, "drone": 1.0, "pizz": -1.0},
    soften={"daegeum": dict(hs=(2800, -3.0), lp=4200), "haegeum": dict(lp=3800), "cello": dict(lp=3200, sat=0.2), "pizz": dict(lp=2800)},
    space=1.2,
)

BPB = 4
BAR_SEC = 4 * 60.0 / 100.0
# AG-03 loop seam: the Intro downbeat (a taiko hit and the section gong) used to sit on sample 0, so the broadband stick / mallet attack started
# exactly at the wrap and the decoded MP3 measured step 0.69 / HF x4.1 there (qa.seam_metrics). The two strikes now land DOWNBEAT_LAG beats later
# (12 ms at 100 BPM, a laid-back hit that nobody hears as a timing change), so the wrap point itself is the quiet drone / reverb tail of the
# outro pickup. Same notes, same rng draws; the calm stem has neither strike, so it is unchanged. The lag alone is NOT what makes the shipped seam
# clean: the plain MP3 encode of this WAV still measures step 0.225 / HF x2.338 on the decoded file (the encoder's start / end effects at a quiet,
# low-frequency loop start). It is the 1 ms raised-cosine edge fade of build.encode_music_loop_staged (used by `encode --stage` and by the full
# `encode`) that brings the decoded seam to 0.043 / 0.057 (qa.seam_metrics).
DOWNBEAT_LAG = 0.02

# ----------------------------------------------------------------------------------------------- harmony
#            Intro                A (4-11)                                  B (12-19)                              C (20-27)
PROG = (
    ["Am"] * 4
    + ["Am", "Am", "Dm", "Am", "Am", "Am", "Gm", "Bb/E"]
    + ["Am", "C", "Bb", "Am", "Dm", "Gm", "Bb", "E"]
    + ["Am", "Am", "Gm", "Bb", "Am", "C", "Bb", "E"]
    #   A' (28-35)                                  B' (36-41)                       Outro (42-43)
    + ["Am", "Am", "Dm", "Am", "Am", "C", "Gm", "Bb/E"]
    + ["Am", "C", "Bb", "Gm", "Bb", "E"]
    + ["Am", "Am"]
)
assert len(PROG) == 44

CELLO_ROOT = {"Am": 45, "Bb": 46, "Gm": 43, "Dm": 50, "C": 48, "E": 40}
BASS_ROOT = {"Am": 33, "Bb": 34, "Gm": 31, "Dm": 38, "C": 36, "E": 40}
# upper triads of the pads, voice-led by step (Am -> Bb: F/Bb/D then back down F->E, Bb->A, D->C = Phrygian sigh)
PAD_U = {"Am": [52, 57, 60], "Dm": [53, 57, 62], "Gm": [55, 58, 62], "Bb": [53, 58, 62], "C": [52, 55, 60], "E": [52, 57, 60]}
PAD_BRASS = {"Am": [45, 52, 57, 60], "Dm": [50, 57, 62, 65], "Gm": [43, 50, 55, 58], "Bb": [46, 53, 58, 62], "C": [48, 55, 60, 64], "E": [40, 52, 57, 60]}
PZ = {"Am": [57, 64], "Dm": [57, 62], "Gm": [55, 62], "Bb": [58, 65], "C": [60, 67], "E": [52, 57]}
# ostinato accent triples (offsets from root at 8th steps 0, 3, 6), two alternating cells per chord. Cell 2 of Am traces M1's head (A D C)
OST_A = {
    "Am": [(0, 3, 7), (0, 5, 3)],
    "Dm": [(0, 7, 10), (0, 7, 5)],
    "Gm": [(0, 3, 7), (0, 7, 10)],
    "Bb": [(0, 7, 12), (0, 4, 7)],
    "C": [(0, 7, 4), (0, 7, 12)],
    "E": [(0, 5, 8), (0, 5, 3)],
}
FIFTH = {"E": 5}
WALK = {"Am": (0, 7, 12, 10), "Dm": (0, 7, 12, 10), "Gm": (0, 7, 12, 10), "Bb": (0, 7, 12, 7), "C": (0, 7, 12, 7), "E": (0, 5, 8, 5)}
TF = {"A1": 55.0, "D2": 73.42, "E2": 82.41, "G2": 98.0, "A2": 110.0, "D3": 146.83, "E3": 164.81, "A3": 220.0}

# ----------------------------------------------------------------------------------------------- melodies
# daegeum (low flute) main theme, A section (bars 4-11)
THEME_A1 = "A3:1.5 E4:.5 E4:1 C4:1 | D4:1.5 C4:.5 A3:2 | A3:1 D4:.5 E4:.5 G4:1 E4:1 | Bb3:1.5 A3:2.5^d"
THEME_A2 = "A3:1 A3:.5 E4:.5 E4:1 C4:1 | D4:1 E4:1 G4:1 A4:1 | A4:1.5 G4:.5 D4:1 C4:1 | D4:2^t C4:1 A3:1"
# A' (28-31): varied, with an upward pickup and a different answering bar
THEME_A3 = "A3:1.5 E4:.5 E4:.5 G4:.5 A4:1 | G4:1 E4:.5 D4:.5 C4:1 A3:1 | A3:1 D4:.5 E4:.5 G4:1 E4:1 | Bb3:1.5 A3:2.5^d"
# haegeum answers in A' (28-31)
HAEG_A3 = "r:4 | r:2 E5:1^h C5:1 | r:4 | r:2 A5:2^w^f"
# haegeum, section B
HAEG_B1 = "E5:2.5^w G5:.5 E5:1 | G5:1.5 E5:.5 D5:1 C5:1 | D5:1.5^h F5:.5 F5:1 E5:1 | r:4"
HAEG_B2 = "A5:3^w G5:1 | G5:2 F5:1 D5:1 | F5:1.5^h E5:.5 D5:1 Bb4:1 | E5:4^g"
DG_B_ANSWER = "A3:1.5 E4:.5 E4:1 C4:1^d"  # bar 15: the daegeum answers the howl with the theme hook
# haegeum, section C (heavy): lament over the march
HAEG_C1 = "r:4 | r:2 E5:2^w | D5:4^w | C5:2 D5:2"  # bars 20-23 (low, dark lament; the swoop into D5 starts from E4)
HAEG_C2 = "E5:2^w C5:2 | C5:1.5 D5:.5 E5:2^f | D5:2 F5:2^h | E6:3^w^g r:1"  # bars 24-27 (the last wail leaps up an octave+ into A')
# horns: M1 augmented (A D C A | G A C -> x2) then inverted
HORN_1 = "A2:4 | D3:2 C3:1 A2:1 | G2:3 A2:1 | C3:4"
HORN_2 = "A2:4 | E2:2 G2:1 A2:1 | C3:3 A2:1 | G2:4"
# B' haegeum: M1 quoted up an octave, rhythmically transformed
HAEG_BP = "A5:1 D6:.5 C6:.5 A5:1 G5:1 | A5:1 C6:1 E6:2^h | D5:1.5^w F5:.5 G5:1 F5:1 | G5:2 D5:1 Bb4:1 | Bb5:1.5^h A5:.5 F5:1 D5:1 | E6:4^w^g"

DG = dict(breath=0.5, buzz=0.4, tone=0.9, vib_depth=12, scoop=0.7, attack=0.08, release=0.22, growl=0.3)
HG = dict(kind="haegeum", voices=2, attack=0.13, vib_depth=28, vib_rate=5.9, vib_delay=0.3, bow_noise=0.22, scratch=0.12)


# ----------------------------------------------------------------------------------------------- custom instruments
def daegeum(freq, dur, vel=0.7, rng=None, mods=(), release=0.22, growl=0.0, **kw):
    """Low daegeum phrase wrapper around instruments.flute. mods: t = trill to the upper tone (second half of the note), d = sighing fall at the end.
    growl: depth of a ~48 Hz flutter-tongue amplitude roughness that blooms after the attack (the 'growling breath')."""
    n = nsamp(dur + release)
    t = tvec(n)
    semis = np.zeros(n)
    if "t" in mods:
        t0 = dur * 0.45
        on = np.clip((t - t0) / 0.06, 0.0, 1.0) * (t < dur + 0.04)
        semis += 2.0 * on * 0.5 * (1.0 + np.tanh(5.0 * np.sin(TAU * 8.5 * np.maximum(t - t0, 0.0))))
    if "d" in mods:
        semis += -1.6 * np.clip((t - (dur - 0.3)) / 0.3, 0.0, 1.0)
    curve = 2.0 ** (semis / 12.0) if np.any(semis) else None
    y = I.flute(freq, dur, vel=vel, rng=rng, pitch_curve=curve, release=release, **kw)
    if growl > 0:
        r = rng or np.random.default_rng(34)
        ph = TAU * np.cumsum(48.0 * (1.0 + 0.08 * dsp.smooth_noise(len(y), r, 2.0))) / dsp.SR + r.uniform(0, TAU)
        bloom = np.clip((tvec(len(y)) - 0.12) / 0.25, 0.0, 1.0)
        y = y * (1.0 - growl * 0.5 * bloom * (1.0 + np.sin(ph)))
    return y


def khoomei(freq, dur, vel=0.7, rng=None, harm=((0.0, 6),), attack=2.0, release=2.0, bw=0.42, boost=8.0, tilt=1.4, sub=0.35):
    """Overtone-singing drone: harmonic stack on `freq` with a narrow moving formant that whistles one harmonic at a time.
    harm: [(t_sec, harmonic_number), ...] -- the formant glides (0.35 s) to each harmonic at its time stamp."""
    rng = rng or np.random.default_rng(31)
    n = nsamp(dur + release)
    t = tvec(n)
    f = freq * dsp.vib(n, 4.4, 6.0, 0.6, 1.2, rng, 0.25) * (1 + 0.0015 * dsp.smooth_noise(n, rng, 0.5))
    ph = dsp.phase_of(f)
    hc = np.full(n, float(harm[0][1]))
    prev = float(harm[0][1])
    for ts, h in harm[1:]:
        u = np.clip((t - ts) / 0.35, 0.0, 1.0)
        hc = hc + (h - prev) * (u * u * (3 - 2 * u))
        prev = float(h)
    fc = hc * freq
    bwh = bw * freq
    y = np.zeros(n)
    k = 1
    while k * freq < 3600 and k <= 40:
        g = 1.0 + boost * np.exp(-0.5 * ((k * f - fc) / bwh) ** 2)
        y += (k ** -tilt) * g * np.sin(TAU * k * ph + 0.7 * k)
        k += 1
    y += sub * np.sin(TAU * 0.5 * ph)
    env = dsp.pad_to(dsp.adsr(dur, attack, 0.5, 0.92, release, a_curve=1.0), n)
    y = y * env
    return y / (np.abs(y).max() + 1e-9) * 0.5 * (0.4 + 0.6 * vel)


def howl(freq, dur, vel=0.7, rng=None, mods=(), release=0.4, **kw):
    """Haegeum 'orc horn' cry. mods: w = wide war-cry swoop from a minor 7th below, h = scoop from a 4th below, s = small slide,
    f = fall-off wail (a 4th down), g = fall-off wail (a 5th down)."""
    n = nsamp(dur + release)
    t = tvec(n)
    pts = None
    if "w" in mods:
        tr = min(0.6, dur * 0.4)
        pts = [(0.0, -10.0), (0.08, -9.4), (tr, 0.0)]
    elif "h" in mods:
        tr = min(0.32, dur * 0.3)
        pts = [(0.0, -5.0), (0.04, -4.6), (tr, 0.0)]
    elif "s" in mods:
        pts = [(0.0, -1.8), (0.14, 0.0)]
    fall = -5.0 if "f" in mods else (-7.0 if "g" in mods else 0.0)
    if fall:
        pts = pts or [(0.0, 0.0)]
        t0 = max(pts[-1][0] + 0.05, dur - 0.55)
        pts = pts + [(t0, 0.0), (dur + release * 0.85, fall)]
    curve = None
    if pts:
        curve = 2.0 ** (np.interp(t, [p[0] for p in pts], [p[1] for p in pts]) / 12.0)
    return I.bowed(freq, dur, vel=vel, rng=rng, pitch_curve=curve, release=release, **kw)


def grunt(vel=0.7, rng=None, freq=98.0, dur=0.32):
    """Low guttural 'HOH' of the war-band (glottal source through an 'o' vowel, falling pitch, percussive envelope)."""
    rng = rng or np.random.default_rng(32)
    n = nsamp(dur)
    t = tvec(n)
    f0 = freq * (0.86 + 0.34 * np.exp(-t / 0.07))
    src = I.glottal(f0, n, rng, tilt=2200.0, jitter=0.02, shimmer=0.1, breath=0.2)
    y = I.vowel_filter(src, "o")
    y = y * np.minimum(1.0, t / 0.012) * np.exp(-t / 0.11)
    y = dsp.saturate(dsp.peakeq(y, 300, 1.0, 3.0) * 1.2, 1.2)
    y = dsp.hp(y, 70.0)
    y = dsp.fade(y, 0.0, 0.05)
    return y / (np.abs(y).max() + 1e-9) * 0.55 * (0.4 + 0.6 * vel)


def rev_swell(vel=0.7, rng=None, dur=2.4):
    """Riser: reversed cymbal + rising filtered noise, ends on its peak (place so it ends on the downbeat)."""
    rng = rng or np.random.default_rng(33)
    n = nsamp(dur)
    cy = dsp.reverse(I.cymbal(dur=dur * 1.35, vel=vel, rng=rng, size=1.0, hi=0.85))[-n:]
    cy = dsp.lp(cy, 6000.0, 0.7, order=2)
    nz = dsp.pink(n, rng)
    t = np.arange(n) / n
    co = 250.0 * (4500.0 / 250.0) ** (t ** 1.2)
    nz = dsp.sweep_filter(nz, "lp", co, 0.9, hop=64) * (t ** 2.4)
    y = (cy * 0.55 + nz * 0.9) * (t ** 1.4)
    return dsp.fade(y, 0.0, 0.02) * (0.4 + 0.6 * vel) * 1.1


def valley_echo(x):
    """Haegeum bus: ping-pong valley echo (quarter left, dotted quarter right), darker each repeat."""
    n = x.shape[-1]
    left = dsp.echo(x[0], 0.60, fb=0.38, mix=0.5, taps=5, damp_hz=2600.0)[:n]
    right = dsp.echo(x[1], 0.90, fb=0.38, mix=0.5, taps=4, damp_hz=2600.0)[:n]
    return np.stack([left, right])


def pad_sig(freqs, dur, kind="dark", vel=0.6, attack=1.1, release=1.6, rng=None, voices=4, spread=10.0, cutoff_open=1000.0, cutoff_closed=260.0, motion=0.5):
    """Same sound as instruments.pad for the saw-stack kinds (dark/brass), but all chord tones are summed before the (shared) cutoff sweep, so
    only two sweep filters run per chord instead of 2 x len(freqs). Linear filter + shared envelope => identical result, ~3x faster."""
    rng = rng or np.random.default_rng(7)
    n = nsamp(dur + release)
    sp = spread * (1.5 if kind == "brass" else 1.0)
    acc = np.zeros((2, n))
    for fi, f in enumerate(freqs):
        pan_p = (fi / max(1, len(freqs) - 1) * 2 - 1) * 0.45 if len(freqs) > 1 else 0.0
        wob = 1 + 0.0012 * dsp.smooth_noise(n, rng, 0.35) * motion
        v = dsp.supersaw(f * wob, n, voices=voices, spread_cents=sp, rng=rng, stereo=True)
        l, r = dsp.pan_gains(pan_p)
        acc[0] += v[0] * (l + 0.5)
        acc[1] += v[1] * (r + 0.5)
    a_env = dsp.pad_to(dsp.adsr(dur, attack, 0.3, 0.9, release, a_curve=1.1), n)
    co = cutoff_closed + (cutoff_open - cutoff_closed) * np.clip(a_env, 0, 1) ** 1.3 * (0.6 + 0.4 * vel)
    out = np.stack([dsp.sweep_filter(acc[c], "lp", co, 0.7, hop=256) for c in range(2)])
    if kind == "brass":
        out = np.stack([dsp.peakeq(out[c], 700, 1.2, 3.5) for c in range(2)])
    return out * a_env / (np.sqrt(max(1, len(freqs))) * 1.5) * (0.4 + 0.6 * vel)

# section loudness arc in dB (beats): quiet crescendo intro, A, B a bit up, C heaviest, A' back a little, B' fullest, outro ebbs into the intro
ARC = [(0, -4.5), (8, -4.0), (15.5, -2.5), (16, -1.5), (44, -0.5), (47.5, -0.5), (48, 0.0), (79, 0.5), (80, 3.0), (111.5, 3.0), (112, 0.0),
       (143, 1.0), (144, 2.5), (167.5, 3.0), (168, -0.5), (172, -2.5), (176, -4.5)]
INTRO, A, B, C, A2, B2, OUT = (0, 16), (16, 48), (48, 80), (80, 112), (112, 144), (144, 168), (168, 176)
# per-track extra dB windows (start_beat, end_beat, dB), 0.5-beat ramps
EXTRA = {
    "taiko": [(*C, 1.5), (*OUT, 3.0)],
    "drums": [(*OUT, 3.0)],
    "strings": [(*C, 1.5)],
    "brass": [(*C, 1.0)],
    "horn": [(*C, 4.0), (*B2, 2.0)],
    "gong": [(*C, 2.0)],
    "bass": [(*C, -1.0)],
    "haegeum": [(*B, 3.0), (*A2, 2.0), (*B2, 1.5)],
    "daegeum": [(*B2, -5.0)],
}
GAIN = dict(drone=-10.0, pad=-12.5, brass=-10.5, horn=-9.0, cello=-5.5, strings=-11.0, bass=-11.0, pizz=-12.0, daegeum=-5.0, haegeum=-5.5,
            taiko=-5.5, drums=-5.5, perc_hi=-7.0, fx=-15.0, gong=-6.0, grunt=-10.0)


def _win_val(b, a, e, db):
    if b <= a - 0.5 or b >= e + 0.5:
        return 0.0
    if b < a:
        return db * (b - (a - 0.5)) / 0.5
    if b > e:
        return db * ((e + 0.5) - b) / 0.5
    return db


def apply_arc(S):
    """Same section curve on every track + per-track extra windows (gain automation in dB)."""
    for name in S.tracks:
        wins = EXTRA.get(name, [])
        xs = sorted(set([float(p[0]) for p in ARC] + [float(v) for a, e, _ in wins for v in (a - 0.5, a, e, e + 0.5)]))
        arc = np.interp(xs, [p[0] for p in ARC], [p[1] for p in ARC])
        S.automate(name, [(x, float(av + sum(_win_val(x, a, e, db) for a, e, db in wins))) for x, av in zip(xs, arc)])


# ----------------------------------------------------------------------------------------------- composition
def _hseq(seq, per_bar=1.0):
    return tuple((i * per_bar * BAR_SEC, float(h)) for i, h in enumerate(seq))


def build() -> Song:
    S = Song("suryeon", bpm=100, bars=44, seed=222)
    S.track("drone", gain_db=GAIN["drone"], reverb={"cave": 0.28}, eq=[("hp", 40), ("lp", 5200)], duck=("taiko", 1.5, 300))
    S.track("pad", gain_db=GAIN["pad"], reverb={"hall": 0.3}, eq=[("hp", 150), ("lp", 4200)], duck=("taiko", 2.5, 260))
    S.track("brass", gain_db=GAIN["brass"], reverb={"hall": 0.28, "cave": 0.08}, eq=[("hp", 80), ("lp", 4800)], duck=("taiko", 2.0, 320))
    S.track("horn", pan=0.04, gain_db=GAIN["horn"], reverb={"hall": 0.3}, eq=[("hp", 60), ("lp", 4200)])
    S.track("cello", pan=-0.25, gain_db=GAIN["cello"], reverb={"arena": 0.1}, eq=[("hp", 55), ("peak", 2800, 1.0, -2.0)], sat=0.6)
    S.track("strings", pan=0.18, gain_db=GAIN["strings"], reverb={"hall": 0.3}, eq=[("hp", 60), ("lp", 5000)])
    S.track("bass", gain_db=GAIN["bass"], eq=[("hp", 32), ("lp", 1800)], sat=0.9)
    S.track("pizz", pan=0.3, gain_db=GAIN["pizz"], reverb={"plate": 0.15}, eq=[("hp", 90), ("lp", 3500)])
    S.track("daegeum", pan=0.1, gain_db=GAIN["daegeum"], reverb={"cave": 0.22, "plate": 0.08}, eq=[("hp", 110), ("lp", 6500)])
    S.track("haegeum", pan=-0.1, gain_db=GAIN["haegeum"], reverb={"hall": 0.3}, eq=[("hp", 200), ("peak", 2500, 1.0, -3.0), ("hs", 2200, -4.0), ("lp", 7000)], pre_fx=valley_echo)
    S.track("taiko", gain_db=GAIN["taiko"], reverb={"arena": 0.16, "cave": 0.08}, eq=[("hp", 30)])
    S.track("drums", gain_db=GAIN["drums"], reverb={"arena": 0.16}, eq=[("hp", 40)])
    S.track("perc_hi", gain_db=GAIN["perc_hi"], reverb={"plate": 0.2}, eq=[("hp", 400)])
    S.track("fx", gain_db=GAIN["fx"], reverb={"hall": 0.3})
    S.track("gong", gain_db=GAIN["gong"], reverb={"hall": 0.4})
    S.track("grunt", gain_db=GAIN["grunt"], reverb={"cave": 0.3})

    def ch_at(bar, beat_in):
        c = PROG[bar].split("/")
        return c[0] if (len(c) == 1 or beat_in < 2.0) else c[1]

    def chords(bar):
        c = PROG[bar].split("/")
        return [(0.0, c[0], 4.0)] if len(c) == 1 else [(0.0, c[0], 2.0), (2.0, c[1], 2.0)]

    # -------------------------------------------------------------- percussion helpers
    def T(beat, key, vel, size=1.0, **kw):
        S.hit("taiko", I.taiko, beat, vel, freq=TF[key], size=size, **kw)

    def BK(beat, vel, f=110.0, pan=-0.12):
        S.hit("drums", I.buk, beat, vel, freq=f, pan=pan)

    def JL(beat, vel):
        S.hit("drums", I.janggu_low, beat, vel, pan=0.1)

    def FD(beat, vel, f=220.0, pan=0.0, jingle=0.5):
        S.hit("drums", I.frame_drum, beat, vel, freq=f, pan=pan, jingle=jingle)

    def RC(beat, vel, pitch=1.0, pan=0.35):
        S.hit("perc_hi", I.rim_click, beat, vel, pitch=pitch, pan=pan)

    def MK(beat, vel, pitch=1.0, pan=-0.35):
        S.hit("perc_hi", I.moktak, beat, vel, pitch=pitch, pan=pan)

    def JH(beat, vel, pan=0.2):
        S.hit("perc_hi", I.janggu_high, beat, vel, stick="deok", pan=pan)

    def hemiola3(bar, vel=0.38, flip=1):
        for i, (off, m) in enumerate(((0.0, 1.0), (4 / 3, 0.7), (8 / 3, 0.8))):
            FD(bar * BPB + off, vel * m, 220.0, pan=(-0.4 if i % 2 == 0 else 0.4) * flip)

    def hemiola5(bar, vel=0.3):
        for i in range(5):
            FD(bar * BPB + i * 0.8, vel * (1.0 if i == 0 else 0.75), 165.0, pan=0.45)

    def rim_euclid(bar, k, n=16, rot=0, vel=0.26, pitch=1.0):
        for i, c in enumerate(euclid(k, n, rot)):
            if c == "x":
                RC(bar * BPB + i * 4.0 / n, vel * (1.0 if i % 4 == 0 else 0.8), pitch)

    def tom_run(beat, keys, step, v0, v1, size=0.6, tight=0.4):
        for i, k in enumerate(keys):
            u = i / max(len(keys) - 1, 1)
            T(beat + i * step, k, v0 + (v1 - v0) * u, size, tight=tight)

    def swell(end_beat, beats=4.0, vel=0.7):
        S.hit("fx", rev_swell, end_beat - beats, vel, dur=beats * 0.6)

    # -------------------------------------------------------------- bass helpers
    def bass_sustain(bar, vel=0.55, sub=0.4, attack=0.25):
        for beat0, ch, length in chords(bar):
            r = BASS_ROOT[ch]
            S.note("bass", I.bowed, bar * BPB + beat0, r, length - 0.2, vel, kind="bass", attack=attack, release=0.4, vib_depth=6, bow_noise=0.1, jitter_ms=4)
            S.note("bass", I.sub_bass, bar * BPB + beat0, r, length - 0.3, sub, attack=0.05, release=0.3, harm=0.3, jitter_ms=3)

    def bass_pluck(beat, midi, vel, dur=1.2):
        S.note("bass", I.pluck, beat, midi, dur, vel, t60=0.95, bright=0.5, body="bass", pick=0.3, damp=0.2, noise_mix=0.2, click=0.2, sat=1.4, jitter_ms=4)

    def bass_walk(bar, vel=0.7):
        ch = PROG[bar]
        nxt = PROG[bar + 1].split("/")[0] if bar + 1 < 44 else "Am"
        r = BASS_ROOT[ch]
        offs = list(WALK[ch])
        notes = [r + o for o in offs]
        if bar % 2 == 1:  # approach the next root by a semitone from the side we come from
            nr = BASS_ROOT[nxt]
            cand = nr + 12 * round((notes[2] - nr) / 12.0)
            side = 1 if notes[2] >= cand else -1
            for d in (side, -side, 2 * side, -2 * side):  # approach by a semitone/tone, staying inside A C D E G + Bb (+F)
                if (cand + d) % 12 in (9, 10, 0, 2, 4, 5, 7):
                    notes[3] = cand + d
                    break
        for i, (m, v) in enumerate(zip(notes, (1.0, 0.65, 0.8, 0.7))):
            bass_pluck(bar * BPB + i, m, vel * v)
        S.note("bass", I.sub_bass, bar * BPB, r, 1.6, vel * 0.55, attack=0.04, release=0.2, harm=0.3, jitter_ms=3)

    def bass_tresillo(bar, vel=0.7):
        for beat0, ch, length in chords(bar):
            r = BASS_ROOT[ch]
            for off, v in ((0.0, 1.0), (1.5, 0.75), (3.0, 0.85)):
                if beat0 <= off < beat0 + length:
                    bass_pluck(bar * BPB + off, r, vel * v, 1.0)

    # -------------------------------------------------------------- ostinatos
    def ostinato_a(bar, vel=1.0, double=0.0):
        for s in range(8):
            bi = s * 0.5
            ch = ch_at(bar, bi)
            r = CELLO_ROOT[ch]
            cell = OST_A[ch][bar % 2]
            if s == 0:
                off, v, acc = cell[0], 1.0, True
            elif s == 3:
                off, v, acc = cell[1], 0.85, True
            elif s == 6:
                off, v, acc = cell[2], 0.9, True
            elif s == 7 and ch == "Am" and bar % 2 == 1:
                off, v, acc = 1, 0.62, False  # Bb neighbour: the b2 rub, resolved by the next bar's A
            else:
                off, v, acc = 0, (0.5 if s % 2 else 0.58), False
            S.note("cello", I.bowed, bar * BPB + bi, r + off, 0.6 if acc else 0.46, v * vel, kind="cello", attack=0.012, release=0.07,
                   vib_depth=0, scratch=0.22 if acc else 0.0, bow_noise=0.2, jitter_ms=3)
            if double and acc:
                S.note("cello", I.bowed, bar * BPB + bi, r + off + 12, 0.5, v * vel * double, kind="viola", attack=0.012, release=0.07,
                       vib_depth=0, scratch=0.15, bow_noise=0.2, jitter_ms=4)

    def ostinato_b(bar, vel=1.0, push=False):
        ch = PROG[bar]
        r = CELLO_ROOT[ch]
        offs = [0, 0, 12, 0, FIFTH.get(ch, 7), 0, 12, 0]
        vs = [1.0, 0.5, 0.8, 0.5, 0.9, 0.5, 0.8, 0.58]
        for s in range(8):
            acc = vs[s] > 0.7
            S.note("cello", I.bowed, bar * BPB + s * 0.5, r + offs[s], 0.6 if acc else 0.46, vs[s] * vel, kind="cello", attack=0.012, release=0.07,
                   vib_depth=0, scratch=0.22 if acc else 0.0, bow_noise=0.2, jitter_ms=3)
        if push:  # 16th pick-up into the next bar
            S.note("cello", I.bowed, bar * BPB + 3.75, r + 12, 0.25, 0.7 * vel, kind="cello", attack=0.01, release=0.05, vib_depth=0, jitter_ms=2)

    def pizz_stabs(bar, vel=0.6):
        for off, v in ((0.0, 1.0), (1.5, 0.8), (3.0, 0.9)):
            ch = ch_at(bar, off)
            for j, m in enumerate(PZ[ch]):
                S.note("pizz", I.pluck, bar * BPB + off, m, 1.2, vel * v, t60=0.8, bright=0.65, body="bass", pick=0.25, damp=0.2,
                       pan=(-0.2 + 0.5 * j), jitter_ms=4)

    def pad_chord(track, midis, beat, dur_beats, **kw):
        S.add(track, pad_sig([float(dsp.midi2hz(m)) for m in midis], dur_beats * S.spb, rng=np.random.default_rng(S.rng.integers(1 << 31)), **kw), beat)

    def dark_pad(bar, vel):
        for beat0, ch, length in chords(bar):
            pad_chord("pad", PAD_U[ch], bar * BPB + beat0, length + 1.0, kind="dark", vel=vel, attack=1.1, release=1.6, voices=4, spread=10.0,
                      cutoff_open=1000, cutoff_closed=260)

    def brass_pad(bar, vel, attack=1.6, length=None):
        for beat0, ch, ln in chords(bar):
            pad_chord("brass", PAD_BRASS[ch], bar * BPB + beat0, (length or ln) + 0.5, kind="brass", vel=vel, attack=attack, release=1.2, voices=4,
                      spread=8.0, cutoff_open=1700, cutoff_closed=320)

    def play_dg(text, start_bar, vel=0.8, **kw):
        for nt in parse_notes(text, start_bar * BPB, default_vel=vel):
            S.note("daegeum", daegeum, nt["beat"], nt["midi"], nt["dur"] * 0.97, nt["vel"], mods=nt["mods"], jitter_ms=9, **{**DG, **kw})

    def play_hg(text, start_bar, vel=0.8, semis=0, **kw):
        for nt in transpose(parse_notes(text, start_bar * BPB, default_vel=vel), semis):
            S.note("haegeum", howl, nt["beat"], nt["midi"], nt["dur"], nt["vel"], mods=nt["mods"], jitter_ms=12, **{**HG, **kw})

    def play_horn(text, start_bar, vel=0.8, fifth=0.0, octave=0.0):
        for nt in parse_notes(text, start_bar * BPB, default_vel=vel):
            kw = dict(attack=0.3, release=0.7, growl=0.3, vib_depth=6, bright=0.75)
            S.note("horn", I.brass_note, nt["beat"], nt["midi"], nt["dur"], nt["vel"], jitter_ms=8, **kw)
            if fifth:
                S.note("horn", I.brass_note, nt["beat"], nt["midi"] + 7, nt["dur"], nt["vel"] * fifth, jitter_ms=8, **kw)
            if octave:
                S.note("horn", I.brass_note, nt["beat"], nt["midi"] + 12, nt["dur"], nt["vel"] * octave, jitter_ms=8, **kw)

    # ============================================================================ DRONE (overtone-singing, one note per section)
    for beat, dur, vel, att, harm in (
        (0, 16, 0.6, 4.6, _hseq([4, 6, 7, 6])),
        (16, 32, 0.45, 1.6, _hseq([4, 6, 7, 6, 6, 8, 7, 6])),
        (48, 32, 0.5, 1.6, _hseq([6, 7, 8, 7, 6, 7, 12, 8])),
        (80, 32, 0.6, 1.8, _hseq([3, 4, 4, 6, 4, 6, 3, 4])),
        (112, 32, 0.45, 1.6, _hseq([4, 6, 7, 8, 7, 6, 8, 12])),
        (144, 24, 0.5, 1.6, _hseq([6, 8, 7, 8, 12, 8])),
        (168, 8, 0.5, 1.6, _hseq([6, 4])),
    ):
        S.note("drone", khoomei, beat, 45, dur, vel, jitter_ms=0.0, harm=harm, attack=att, release=2.2)

    # ============================================================================ GONGS (section starts)
    for bar, v in ((0, 0.7), (4, 0.5), (12, 0.65), (20, 1.0), (28, 0.9), (36, 0.85)):
        S.note("gong", I.gong, bar * BPB + (DOWNBEAT_LAG if bar == 0 else 0.0), 45, 12.0, v, jitter_ms=0.0)

    # ============================================================================ INTRO (0-3): drums + drone, crescendo
    T(DOWNBEAT_LAG, "A1", 0.72, 1.3, jitter_ms=0.0)
    T(2, "E2", 0.40)
    T(4, "A1", 0.50, 1.2)
    T(6, "E2", 0.42)
    T(7.5, "E2", 0.30, 0.6)
    hemiola3(1, 0.22)
    for bar, tv, fv in ((2, (0.62, 0.45, 0.50), 0.35), (3, (0.78, 0.60, 0.68), 0.45)):
        b = bar * BPB
        for off, v in zip((0.0, 1.5, 3.0), tv):
            T(b + off, "A1" if off == 0 else "E2", v, 1.2 if off == 0 else 1.0)
        hemiola3(bar, fv, flip=1 if bar == 2 else -1)
        rim_euclid(bar, 5, rot=bar, vel=0.22 + 0.06 * (bar - 2))
        JL(b + 2.0, 0.35 + 0.1 * (bar - 2))
    BK(13, 0.5)
    BK(15.5, 0.5, 165.0)
    S.hit("grunt", grunt, 8.0, 0.45, freq=98.0)
    S.hit("grunt", grunt, 12.0, 0.55, freq=98.0)
    roll(S, "taiko", I.taiko, 15.0, 1.0, step=0.25, v0=0.5, v1=0.95, freq=TF["E2"], size=0.5, tight=0.5)
    S.note("bass", I.bowed, 8, 33, 8.0, 0.5, kind="bass", attack=2.6, release=0.6, vib_depth=6, jitter_ms=0.0)
    S.note("bass", I.sub_bass, 8, 33, 7.8, 0.5, attack=2.4, release=0.5, harm=0.3, jitter_ms=0.0)
    pad_chord("pad", PAD_U["Am"], 8.0, 9.0, kind="dark", vel=0.45, attack=3.0, release=1.8, voices=4, spread=10.0, cutoff_open=900, cutoff_closed=240)

    # ============================================================================ A (4-11): ostinato + low daegeum theme
    for bar in range(4, 12):
        k = bar - 4
        b = bar * BPB
        ostinato_a(bar, vel=0.8 + 0.03 * k)
        bass_sustain(bar, vel=0.55, sub=0.4)
        if k >= 4:
            dark_pad(bar, 0.5)
            bass_tresillo(bar, 0.5)
        # taiko tresillo-ish gallop, buk 'snare', janggu kung on beat 3
        T(b, "A1", 0.95, 1.2)
        T(b + 1.5, "E2", 0.60)
        T(b + 3.0, "E2", 0.65)
        if k % 2 == 1:
            T(b + 2.5, "A2", 0.45, 0.8)
        BK(b + 1.0, 0.55, 110.0)
        JL(b + 2.0, 0.5)
        BK(b + 3.5, 0.55, 164.8)
        if k >= 2:
            hemiola3(bar, 0.38, flip=1 if k % 2 == 0 else -1)
            rim_euclid(bar, 5, rot=k % 4)
        if k % 2 == 1:
            MK(b + 3.75, 0.4, 1.3)
    tom_run(7 * BPB + 3.0, ["E3", "A2", "E2", "E2"], 0.25, 0.5, 0.85, size=0.6)
    play_dg(THEME_A1, 4, 0.82)
    play_dg(THEME_A2, 8, 0.86)
    # transition 11 -> 12: tom fill, riser, howl pick-up
    tom_run(11 * BPB + 2.0, ["E3", "A2", "E3", "A2", "E2", "E2", "A1", "A1"], 0.25, 0.5, 0.95, size=0.6)
    for i, v in enumerate((0.4, 0.45, 0.5, 0.55)):
        BK(11 * BPB + 2.0 + i * 0.5, v, 164.8 if i % 2 else 110.0)
    swell(12 * BPB, 4.0, 0.7)
    play_hg("r:2.5 E5:1.5^h", 11, 0.55)
    play_hg("r:2 E5:2^w^g", 7, 0.4)  # far-off howl over the end of the first theme phrase

    # ============================================================================ B (12-19): haegeum howls, walking bass, thicker drums
    for bar in range(12, 20):
        k = bar - 12
        b = bar * BPB
        ostinato_b(bar, vel=0.9, push=(k % 4 == 3))
        bass_walk(bar, vel=0.72)
        S.note("bass", I.bowed, b, BASS_ROOT[PROG[bar]], 3.8, 0.35, kind="bass", attack=0.3, release=0.4, vib_depth=6, jitter_ms=4)
        pizz_stabs(bar, 0.6)
        dark_pad(bar, 0.6)
        T(b, "A1", 1.0, 1.2)
        T(b + 1.0, "E2", 0.5)
        T(b + 1.5, "E2", 0.6)
        T(b + 3.0, "E2", 0.7)
        JL(b + 2.0, 0.55)
        BK(b + 3.5, 0.55, 164.8)
        if k % 2 == 1:
            T(b + 2.5, "A2", 0.5, 0.8)
            T(b + 3.75, "E3", 0.4, 0.5, tight=0.5)
        hemiola3(bar, 0.4, flip=1 if k % 2 == 0 else -1)
        rim_euclid(bar, 7, rot=k % 4, vel=0.26)
        for i in range(8):
            S.hit("perc_hi", I.shaker, b + i * 0.5, 0.4 if i % 2 == 0 else 0.25, pan=0.35)
        for off, v in ((0.5, 0.45), (1.75, 0.4), (3.25, 0.45)):
            JH(b + off, v)
        if k % 2 == 1:
            MK(b + 3.25, 0.4, 1.0)
    tom_run(15 * BPB + 3.0, ["E3", "A2", "E3", "A2"], 0.25, 0.5, 0.9, size=0.6)
    play_hg(HAEG_B1, 12, 0.82)
    play_hg(HAEG_B2, 16, 0.86)
    play_dg(DG_B_ANSWER, 15, 0.85)
    play_dg("E4:2 D4:1 C4:1", 19, 0.6)
    # 19 -> 20: roll into a stop-time breath, then the heavy section
    roll(S, "taiko", I.taiko, 19 * BPB, 3.5, step=0.25, v0=0.4, v1=1.0, freq=TF["E2"], size=0.5, tight=0.5)
    for i in range(7):
        JH(19 * BPB + 1.0 + i * 0.5, 0.35 + 0.06 * i)
    swell(20 * BPB - 0.5, 4.0, 0.9)

    # ============================================================================ C (20-27): half-time HEAVY
    for bar in range(20, 28):
        k = bar - 20
        b = bar * BPB
        ch = PROG[bar]
        # slow-beat taiko
        T(b, "A1", 1.0, 1.35)
        T(b + 2.0, "E2", 0.85, 1.1)
        if k % 2 == 0:
            T(b + 3.5, "A2", 0.42, 0.7)
        else:
            T(b + 1.5, "E2", 0.5)
            T(b + 3.0, "A2", 0.45, 0.8)
            T(b + 3.5, "E3", 0.4, 0.6, tight=0.5)
        JL(b, 0.6)
        JL(b + 2.0, 0.6)
        BK(b + 1.0, 0.32, 110.0)
        BK(b + 3.0, 0.36, 164.8)
        hemiola3(bar, 0.3, flip=1 if k % 2 == 0 else -1)
        RC(b + 3.5, 0.3, 1.0)
        MK(b + 1.5, 0.3, 1.0)
        if k % 2 == 0:
            S.hit("grunt", grunt, b, 0.7, freq=98.0)
        S.hit("grunt", grunt, b + 2.0, 0.6, freq=110.0)
        # sustained strings + sub
        S.note("strings", I.bowed, b, CELLO_ROOT[ch], 3.9, 0.62, kind="cello", attack=0.9, release=0.8, vib_depth=22, vib_delay=0.4, voices=3, bow_noise=0.15, jitter_ms=5)
        S.note("strings", I.bowed, b, CELLO_ROOT[ch] + (5 if ch == "E" else 7), 3.9, 0.45, kind="cello", attack=1.1, release=0.8, vib_depth=22, vib_delay=0.5, voices=3, bow_noise=0.15, jitter_ms=5)
        S.note("bass", I.bowed, b, BASS_ROOT[ch], 3.9, 0.6, kind="bass", attack=0.5, release=0.5, vib_depth=6, bow_noise=0.1, jitter_ms=3)
        S.note("bass", I.sub_bass, b, BASS_ROOT[ch] if ch != "E" else 28, 3.8, 0.6, attack=0.04, release=0.3, harm=0.3, jitter_ms=2)
    brass_pad(20, 0.65, attack=1.8, length=8.0)
    for bar in range(22, 28):
        brass_pad(bar, 0.6 + 0.04 * (bar - 22), attack=1.4)
    for bar in range(20, 28):  # ghostly choir an octave up, one chord per bar
        for beat0, ch, ln in chords(bar):
            S.chord("pad", [x + 12 for x in PAD_U[ch]], bar * BPB + beat0, ln + 1.0, vel=0.38 + 0.01 * (bar - 20), kind="choir", attack=1.4, release=1.4)
    play_horn(HORN_1, 20, 0.85, fifth=0.5)
    play_horn(HORN_2, 24, 0.9, octave=0.4)
    play_hg(HAEG_C1, 20, 0.78)
    play_hg(HAEG_C2, 24, 0.84)
    # riser into A': the ostinato returns on the last bar, drums accelerate
    ostinato_a(27, vel=0.9)
    bass_tresillo(27, 0.7)
    for i in range(8):
        T(27 * BPB + 1.0 + i * 0.25, "E2", 0.4 + 0.07 * i, 0.5, tight=0.5)
    roll(S, "taiko", I.taiko, 27 * BPB + 3.0, 1.0, step=0.125, v0=0.5, v1=1.0, freq=TF["A2"], size=0.5, tight=0.6)
    swell(28 * BPB, 4.0, 0.9)

    # ============================================================================ A' (28-35): ostinato back, doubled theme, extra percussion
    for bar in range(28, 36):
        k = bar - 28
        b = bar * BPB
        ostinato_a(bar, vel=0.95, double=0.5)
        bass_sustain(bar, vel=0.5, sub=0.4)
        bass_tresillo(bar, 0.6)
        dark_pad(bar, 0.6)
        T(b, "A1", 1.0, 1.2)
        T(b + 1.5, "E2", 0.65)
        T(b + 3.0, "E2", 0.7)
        T(b + 2.5, "A2", 0.5, 0.8)
        if k % 2 == 1:
            T(b + 3.5, "E3", 0.45, 0.5, tight=0.5)
            T(b + 3.75, "E3", 0.4, 0.5, tight=0.5)
        BK(b + 1.0, 0.58, 110.0)
        JL(b + 2.0, 0.5)
        BK(b + 3.5, 0.58, 164.8)
        hemiola3(bar, 0.4, flip=1 if k % 2 == 0 else -1)
        hemiola5(bar, 0.3)
        rim_euclid(bar, 7 if k % 2 else 5, rot=k % 4, vel=0.27)
        for i in range(16):
            S.hit("perc_hi", I.shaker, b + i * 0.25, 0.38 if i % 4 == 0 else (0.28 if i % 2 == 0 else 0.18), pan=-0.3)
        for off, v in ((0.5, 0.5), (1.75, 0.45), (2.25, 0.4), (3.25, 0.5)):
            JH(b + off, v)
        MK(b + 3.25 if k % 2 == 0 else b + 1.25, 0.45, 1.2)
    play_dg(THEME_A3, 28, 0.84)
    play_hg(HAEG_A3, 28, 0.75)
    play_dg(THEME_A2, 32, 0.9)
    play_hg(THEME_A2, 32, 0.82, semis=12, attack=0.1)
    brass_pad(34, 0.45)
    brass_pad(35, 0.5)
    tom_run(31 * BPB + 3.0, ["E3", "A2", "E3", "A2"], 0.25, 0.5, 0.95, size=0.6)
    tom_run(35 * BPB + 1.0, ["E3", "A2", "E3", "A2", "E3", "A2", "E2", "E2", "E2", "A1", "A1", "A1"], 0.25, 0.45, 1.0, size=0.6)
    swell(36 * BPB, 4.0, 0.8)

    # ============================================================================ B' (36-41): full band
    for bar in range(36, 42):
        k = bar - 36
        b = bar * BPB
        ostinato_b(bar, vel=1.0, push=(k % 2 == 1))
        bass_walk(bar, vel=0.75)
        S.note("bass", I.bowed, b, BASS_ROOT[PROG[bar]], 3.8, 0.4, kind="bass", attack=0.3, release=0.4, vib_depth=6, jitter_ms=4)
        pizz_stabs(bar, 0.7)
        dark_pad(bar, 0.65)
        brass_pad(bar, 0.5, attack=1.0)
        T(b, "A1", 1.0, 1.25)
        T(b + 1.0, "E2", 0.6)
        T(b + 1.5, "E2", 0.65)
        T(b + 2.5, "A2", 0.5, 0.8)
        T(b + 3.0, "E2", 0.75)
        T(b + 3.5, "E3", 0.45, 0.5, tight=0.5)
        JL(b + 2.0, 0.6)
        BK(b + 3.5, 0.58, 164.8)
        hemiola3(bar, 0.42, flip=1 if k % 2 == 0 else -1)
        hemiola5(bar, 0.32)
        rim_euclid(bar, 7, rot=k % 4, vel=0.28)
        for i in range(16):
            S.hit("perc_hi", I.shaker, b + i * 0.25, 0.4 if i % 4 == 0 else (0.3 if i % 2 == 0 else 0.2), pan=-0.3)
        for off, v in ((0.5, 0.5), (1.75, 0.45), (2.25, 0.4), (3.25, 0.5)):
            JH(b + off, v)
        MK(b + 1.25, 0.45, 1.2)
        if k % 2 == 0:
            S.hit("grunt", grunt, b, 0.55, freq=98.0)
    play_hg(HAEG_BP, 36, 0.86)
    play_horn("Bb2:4 | E2:4", 40, 0.8)  # horn call: the Bb -> E tritone, resolved by the A drone at the loop start
    play_dg("A3:4 | C4:4 | Bb3:4 | r:4 | Bb3:4 | E3:4", 36, 0.72)
    play_dg("A4:1.5 G4:.5 D4:1 C4:1", 39, 0.7)  # hook fragment over the Gm bar
    tom_run(41 * BPB + 1.5, ["E3", "A2", "E3", "A2", "E2", "A1"], 0.25, 0.6, 1.0, size=0.7)
    tom_run(39 * BPB + 3.0, ["E3", "A2", "E3", "A2"], 0.25, 0.55, 1.0, size=0.6)

    # ============================================================================ OUTRO (42-43): drums only, pickup into the Intro downbeat
    b = 42 * BPB
    T(b, "A1", 0.8, 1.2)
    T(b + 2.0, "E2", 0.5)
    T(b + 3.5, "E3", 0.35, 0.5, tight=0.5)
    BK(b + 1.0, 0.4, 110.0)
    BK(b + 3.0, 0.4, 164.8)
    JL(b + 2.0, 0.4)
    hemiola3(42, 0.4)
    hemiola5(42, 0.25)
    rim_euclid(42, 5, rot=1, vel=0.24)
    b = 43 * BPB
    T(b, "A1", 0.7, 1.2)
    T(b + 1.0, "E2", 0.45)
    T(b + 2.0, "E2", 0.6)
    hemiola3(43, 0.38, flip=-1)
    BK(b + 1.0, 0.45, 110.0)
    for i, (k_, v) in enumerate((("E3", 0.45), ("A2", 0.5), ("E3", 0.58), ("A2", 0.66), ("E2", 0.78), ("E2", 0.9))):
        T(b + 2.5 + i * 0.25, k_, v, 0.55, tight=0.5)

    apply_arc(S)
    return S

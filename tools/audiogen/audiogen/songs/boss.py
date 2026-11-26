"""Boss battle theme -- "Kızıl Kapı" (Crimson Gate). E minor / phrygian-touched, 150 BPM, 38 bars (60.8 s) loop.

Form: Intro (2, hits + riser) | A (8, drive groove + haegeum ostinato, brass call) | B (8, the theme on horns, drums tighten)
      | C (8: 4-bar breakdown with the leitmotif M1 in augmentation, 4-bar riser build) | A' (8, theme varied/octave-up, full power)
      | D (4, climax + fills, stop-time pickup straight into the Intro hits).

Main theme (brass, written an octave higher than it sounds on the horns; flute plays it as written):
    B4 E5 G5 B5 | A5 G5 E5 C5 | D5 G5 B5 D6 | A5 F#5 D5 A4 || B4 E5 G5 B5 | C6 B5 G5 E5 | E5 A5 C6 E6 D6 | B5 A5 F#5 D#5
Leitmotif M1 (menu: A4 D5 C5 A4 | G4 A4 C5) shows up transposed to B E D B | A B D -- slow in the breakdown, in 8ths at the climax.

Zone variants (WP AG-03): build(zone) is the SAME song (same seed, same groove, same brass theme, 38 bars = 60.8 s, sample-exact equal length to
mus_boss) with the upper doubling of the tune -- the flute / haegeum layer, tagged "tune" with Song.layer() -- lifted out (music.apply_calm
layers=) and replaced by the zone's own lead voice playing (a) the zone's motif over the first drive bars (2-5) and again over A' (26-29), where the
progression is the same Em Em C D, and (b) the boss tune at the places the flute used to play it. The motifs are the zone songs' main themes
carried into this E-minor world, bar by bar over Em Em C D:
    yeonmu       daegeum + gayageum        D5 G5 E5 D5 | B4 D5 E5 | E5 G5 B5 | A5 G5 E5 D5 E5            (the plains theme, G major pentatonic = E minor pentatonic)
    suryeon   cello + haegeum howl      E4 -- B4 B4 G4 | A4 G4 F4 E4 | E4 A4 B4 D5 B4 | F#4 E4        (the valley theme a fifth up, the b2 sigh F -> E)
    seori        airy flute + glass bell   B4 E5 . G5 F#5 | E5 B5 . A5 G5 | G5 C6 . B5 A5 | G5 . E5      (rising fourths over open fifths)
    daeryeol   growling brass + haegeum  E4 F4 A4 F4 E4 | B3 C4 B3 | F4 A4 B4 A4 F4 | A4 G#4 F#4 E4    (phrygian-dominant cells: X sequenced, the Y 'B C B' clash)
build() with no zone is untouched (the layer tag is bookkeeping): mus_boss renders bit-identical to before.
"""
from __future__ import annotations

from .. import instruments as I
from ..comp import arp, run, roll
from ..dsp import midi2hz
from ..music import Song, apply_calm, parse_notes
from ._boss_inst import stab, riser, rev_cym

ID = "mus_boss"
LOOP = True

# ---------------------------------------------------------------- harmony
PROG = (
    ["Em", "Em"]                                                  # 0-1  intro
    + ["Em", "Em", "C", "D", "Em", "Em", "F", "B"]                # 2-9  A
    + ["Em", "C", "G", "D", "Em", "C", "Am", "B"]                 # 10-17 B
    + ["Em", "Em", "Am", "Bm"]                                    # 18-21 breakdown
    + ["Em", "G", "Am", "F"]                                      # 22-25 riser build (bar 25 splits F | B)
    + ["Em", "Em", "C", "D", "Em", "C", "F", "B"]                 # 26-33 A'
    + ["Em", "G", "F", "B"]                                       # 34-37 D
)
SPLIT = {25: [(0.0, "F"), (2.0, "B")]}
assert len(PROG) == 38

BASS = {"Em": 40, "C": 36, "G": 43, "D": 38, "F": 41, "B": 35, "Am": 33, "Bm": 35}
STAB = {
    "Em": [52, 59, 64, 67, 71], "C": [48, 55, 60, 64, 67], "D": [50, 57, 62, 66, 69], "G": [55, 59, 62, 67, 71],
    "F": [53, 57, 60, 65, 69], "B": [47, 54, 59, 63, 66], "Am": [45, 57, 60, 64, 69], "Bm": [47, 54, 59, 62, 66],
}
STAB_BIG = {"Em": [40, 52, 59, 64, 67, 71, 76], "B": [35, 47, 54, 59, 63, 66, 71]}
PADV = {  # deliberately spiced voicings (b9 / maj7 / b7 clusters); the pad is low in the mix and ducks under the taiko
    "Em": [40, 47, 53, 59, 64], "C": [36, 48, 55, 59, 64], "G": [43, 50, 55, 59, 66], "D": [38, 50, 57, 60, 66],
    "F": [41, 53, 57, 60, 64], "B": [35, 47, 54, 57, 63], "Am": [45, 52, 57, 60, 64], "Bm": [35, 47, 54, 62, 66],
}
OST = {  # haegeum ostinato cell: [root, fifth, menacing neighbour, third/colour]
    "Em": [64, 71, 65, 67], "C": [60, 67, 62, 64], "D": [62, 69, 64, 66], "F": [65, 72, 67, 69],
    "B": [59, 66, 60, 63], "G": [55, 62, 57, 59], "Am": [57, 64, 59, 60], "Bm": [59, 66, 60, 62],
}
OSTP = (
    [0, 0, 1, 0, 2, 0, 1, 0, 0, 0, 1, 0, 3, 0, 1, 3],
    [0, 0, 1, 0, 3, 0, 1, 0, 0, 0, 1, 2, 0, 3, 1, 3],
)
OSTACC = [1.0, 0.5, 0.55, 0.85, 0.6, 0.5, 0.85, 0.5, 0.95, 0.5, 0.55, 0.85, 0.6, 0.85, 0.55, 0.65]
ARPN = {
    "Em": [52, 59, 64, 67, 71, 76], "C": [48, 55, 60, 64, 67, 72], "G": [55, 59, 62, 67, 71, 74], "D": [50, 57, 62, 66, 69, 74],
    "F": [53, 57, 60, 65, 69, 72], "B": [47, 54, 59, 63, 66, 71], "Am": [57, 60, 64, 69, 72, 76], "Bm": [47, 54, 59, 62, 66, 71],
}
ARPO = [0, 2, 4, 2, 3, 2, 4, 5, 0, 2, 4, 2, 5, 4, 3, 2]
PENT = [52, 55, 57, 59, 62, 64, 67, 69, 71, 74, 76, 79, 81, 83, 86, 88]  # E minor pentatonic ladder from E3
PHRYG = [64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84, 86, 88, 89]  # E phrygian ladder from E4
PENT_B = [47, 49, 51, 54, 56, 59, 61, 63, 66, 68, 71, 73, 75, 78, 80, 83, 85, 87]  # B major pentatonic ladder (for runs over the B / D# chords)

# ---------------------------------------------------------------- melodies (one string per bar, 4 beats each)
CALL_A2 = [  # bars 6-9: brass call
    "E4:.75 E4:.75 G4:.5 B4:1.5 A4:.5",
    "G4:.75 G4:.75 E4:.5 F4:1 E4:1",
    "A4:.75 A4:.75 C5:.5 F5:1.5 E5:.5",
    "D#5:1 F#5:1 B5:2",
]
THEME_B = [  # bars 10-17: played as written by the flute, an octave lower by the horns
    "B4:1.5 E5:.5 G5:1 B5:1",
    "A5:1.5 G5:.5 E5:1 C5:1",
    "D5:.5 G5:.5 B5:1 D6:2",
    "A5:1 F#5:1 D5:1 A4:1",
    "B4:1.5 E5:.5 G5:1 B5:1",
    "C6:1.5 B5:.5 G5:1 E5:1",
    "E5:.5 A5:.5 C6:1 E6:1.5 D6:.5",
    "B5:1.5 A5:.5 F#5:1 D#5:1",
]
M1_BREAK = [  # bars 18-21: M1 (B E D B | A B D) in augmentation
    "B4:4",
    "E5:2 D5:1 B4:1",
    "A4:3 B4:1",
    "D5:4",
]
THEME_AP = [  # bars 26-33: varied, higher
    "B4:.5 B4:.5 E5:.5 G5:.5 B5:2",
    "B5:1 A5:.5 G5:.5 F5:1 E5:1",
    "E5:.5 G5:.5 C6:1 B5:.5 A5:.5 G5:1",
    "A5:1.5 F#5:.5 D5:1 F#5:1",
    "G5:.5 B5:.5 E6:1.5 D6:.5 B5:1",
    "C6:1.5 B5:.5 G5:1 E5:1",
    "A5:1 C6:1 F6:1.5 E6:.5",
    "D#6:1 B5:1 F#5:1 D#5:1",
]
CLIMAX_D = [  # bars 34-37
    "B5:.5 E6:.5 D6:.5 B5:.5 A5:.5 B5:.5 D6:1",
    "G5:.5 B5:.5 D6:1 B5:.5 A5:.5 G5:1",
    "A5:1 C6:1 F6:2",
    "B5:1.5 A5:.5 F#5:1 B5:.5 D#6:.5",
]
V = {"X": 1.0, "x": 0.78, "o": 0.56, "g": 0.32, "t": 0.2}

# ---------------------------------------------------------------- AG-03 zone variants
ZONES = ("yeonmu", "suryeon", "seori", "daeryeol")


def variant_id(zone: str) -> str:
    return f"mus_{zone}_boss"


MOTIF = {  # bars 2-5 (and 26-29): Em | Em | C | D, one string per bar of 4 beats
    "yeonmu": ["D5:.5 G5:1 E5:.5 D5:1 B4:1", "B4:1 D5:1 E5:2", "E5:1 G5:1 B5:2", "A5:1 G5:.5 E5:.5 D5:1 E5:1"],
    "suryeon": ["E4:1.5 B4:.5 B4:1 G4:1", "A4:1 G4:1 F4:.5 E4:1.5", "E4:.5 A4:.5 B4:1 D5:1 B4:1", "F#4:1.5 E4:2.5"],
    "seori": ["B4:1 E5:1.5 G5:.5 F#5:1", "E5:1 B5:1.5 A5:.5 G5:1", "G5:1 C6:1.5 B5:.5 A5:1", "G5:1.5 E5:2.5"],
    "daeryeol": ["E4:1 F4:.5 A4:.5 F4:1 E4:1", "B3:1.5 C4:.5 B3:2", "F4:1 A4:.5 B4:.5 A4:1 F4:1", "A4:1 G#4:.5 F#4:.5 E4:2"],
}
# how far the zone voice sits from the flute it replaces when it plays the boss tune (semitones)
DOUBLE_SHIFT = {"yeonmu": 0, "suryeon": -12, "seori": 0, "daeryeol": -12}


def build(zone: str | None = None) -> Song:
    """zone=None: the shared boss theme (mus_boss). zone in ZONES: its mus_<zone>_boss variant (see the module docstring)."""
    if zone is not None and zone not in ZONES:
        raise KeyError(f"unknown zone {zone!r}; zones: {', '.join(ZONES)}")
    S = Song("boss", bpm=150, bars=38, seed=555)
    S.track("perc_low", gain_db=-9.0, reverb={"arena": 0.14}, eq=[("hp", 48)])
    S.track("perc_mid", pan=-0.12, gain_db=-10.0, reverb={"arena": 0.18}, eq=[("hp", 60)])
    S.track("perc_hi", pan=0.3, gain_db=-13.0, reverb={"plate": 0.15})
    S.track("hat", pan=0.38, gain_db=-17.0, reverb={"plate": 0.1})
    S.track("cym", pan=0.12, gain_db=-12.0, reverb={"hall": 0.2}, eq=[("hp", 400)], width=1.4)
    S.track("gong", gain_db=-10.0, reverb={"hall": 0.3})
    S.track("bass", gain_db=-12.0, eq=[("hp", 38)], sat=1.1, duck=("perc_low", 2.5, 110))
    S.track("bass2", gain_db=-18.0, eq=[("hp", 55), ("lp", 1800)], reverb={"room": 0.05})
    S.track("pad", gain_db=-17.0, reverb={"hall": 0.35}, eq=[("hp", 70), ("lp", 5500)], duck=("perc_low", 3.5, 140), width=1.6)
    S.track("brasspad", gain_db=-15.0, reverb={"hall": 0.3}, eq=[("hp", 120), ("lp", 4500)], duck=("perc_low", 2.5, 140), width=1.5)
    S.track("brass", gain_db=-7.5, reverb={"hall": 0.16, "arena": 0.12}, eq=[("hp", 110), ("peak", 2800, 1.0, -2.0), ("lp", 7500)])
    S.track("lead", pan=0.04, gain_db=-4.0, reverb={"hall": 0.2, "plate": 0.08}, eq=[("hp", 120), ("peak", 3000, 1.0, -2.0), ("lp", 7000)])
    S.track("lead2", pan=-0.14, gain_db=-11.0, reverb={"hall": 0.2}, eq=[("hp", 90), ("lp", 5000)])
    S.track("flute", pan=0.22, gain_db=-9.5, reverb={"hall": 0.3, "plate": 0.1}, eq=[("hp", 200), ("lp", 9000)])
    S.track("haeg", pan=-0.42, gain_db=-5.5, reverb={"plate": 0.12}, eq=[("hp", 180), ("lp", 5200)])
    S.track("haeg_lead", pan=0.3, gain_db=-10.0, reverb={"hall": 0.28}, eq=[("hp", 220), ("lp", 6000)])
    S.track("guzheng", pan=0.5, gain_db=-13.0, reverb={"plate": 0.2, "hall": 0.18}, eq=[("hp", 220)])
    S.track("gayageum", pan=-0.5, gain_db=-15.5, reverb={"plate": 0.18}, eq=[("hp", 110)])
    S.track("bells", pan=0.2, gain_db=-11.0, reverb={"air": 0.4, "hall": 0.2}, eq=[("hp", 150)])
    S.track("fx", gain_db=-9.0, reverb={"air": 0.2}, eq=[("hp", 200)], width=1.3)

    # dynamic arc (dB per bar, applied to the rhythm section / accompaniment; leads and one-shots carry their own dynamics)
    ARC = {}
    for b in range(38):
        ARC[b] = (0.0 if b < 2 else -1.5 if b < 6 else -0.5 if b < 10 else 0.5 if b < 18 else -2.0 if b < 22
                  else {22: -3.0, 23: -2.0, 24: -1.0, 25: 0.0}.get(b, 0.0) if b < 26 else 1.5 if b < 34 else 2.5)

    def arc_track(name, extra_cb=0.0, use_arc=True):
        pts = []
        for b in range(38):
            v = (ARC[b] if use_arc else 0.0) + (extra_cb if 18 <= b < 22 else 0.0)
            if b > 0:
                pts.append((b * 4 - 0.01, pts[-1][1]))
            pts.append((b * 4, v))
        S.automate(name, pts)

    for nm, extra in (("perc_low", -3.0), ("bass", 1.0), ("bass2", 1.0)):
        arc_track(nm, extra)
    for nm in ("perc_mid", "perc_hi", "hat", "haeg", "brass", "gayageum", "guzheng", "pad", "brasspad"):
        arc_track(nm)
    for nm, db in (("flute", -3.0), ("haeg_lead", -2.0), ("bells", -2.0)):  # the melodic voices step back inside the breakdown
        arc_track(nm, db, use_arc=False)

    # ------------------------------------------------------------ helpers
    def ch_at(bar, step=0):
        if bar in SPLIT:
            c = SPLIT[bar][0][1]
            for off, name in SPLIT[bar]:
                if off <= step * 0.25 + 1e-9:
                    c = name
            return c
        return PROG[bar]

    def stabs(bar, steps, level=1.0, dur_acc=0.2, dur_short=0.13):
        for step, v in steps.items():
            n = tuple(STAB[ch_at(bar, step)])
            S.hit("brass", stab, bar * 4 + step * 0.25, min(v * level, 1.0), notes=n, dur=dur_acc if v >= 0.9 else dur_short)

    def tom_fill(bar, s0, n=4, v0=0.6, v1=0.95, freqs=(196.0, 164.8, 146.8, 123.5), step=0.25):
        for i in range(n):
            S.hit("perc_mid", I.taiko, bar * 4 + s0 * 0.25 + i * step, v0 + (v1 - v0) * i / max(n - 1, 1), freq=freqs[i % len(freqs)], size=0.7, tight=0.5)

    def ostinato(bar, variant, vel=0.7, shift=0, upto=16):
        pat_ = OSTP[variant]
        for st in range(upto):
            cell = OST[ch_at(bar, st)]
            S.note("haeg", I.bowed, bar * 4 + st * 0.25, cell[pat_[st]] + shift, 0.2, vel * OSTACC[st], kind="haegeum",
                   attack=0.004, release=0.03, vib_depth=0.0, bow_noise=0.1, jitter_ms=2.0, vel_jitter=0.05)

    def bass_pulse(bar, shape, v0=0.8, dur=0.42):
        vels = [1.0, 0.6, 0.85, 0.6, 0.9, 0.6, 0.85, 0.65]
        for i in range(8):
            r = BASS[ch_at(bar, i * 2)] + shape[i]
            S.note("bass", I.sub_bass, bar * 4 + i * 0.5, r, dur, v0 * vels[i], attack=0.006, release=0.07, harm=0.35, jitter_ms=2.0)

    def bass_16(bar, v0=0.8):
        for i in range(16):
            r = BASS[ch_at(bar, i)] + (12 if i in (6, 14) else 0)
            S.note("bass", I.sub_bass, bar * 4 + i * 0.25, r, 0.2, v0 * (1.0 if i % 4 == 0 else 0.62), attack=0.004, release=0.04, harm=0.35, jitter_ms=1.5)

    def bass2_q(bar, v0=0.7, upto=4):
        for q in range(upto):
            S.note("bass2", I.bowed, bar * 4 + q, BASS[ch_at(bar, q * 4)] + 12, 0.8, v0 * (1.0 if q % 2 == 0 else 0.8), kind="bass", attack=0.02,
                   release=0.06, vib_depth=0.0, voices=2)

    def pad_span(b0, b1, kind="dark", vel=0.6, track="pad", dur_extra=0.4, **kw):
        bar = b0
        while bar < b1:
            c = PROG[bar]
            n = 1
            while bar + n < b1 and PROG[bar + n] == c and bar + n not in SPLIT and bar not in SPLIT:
                n += 1
            if bar in SPLIT:
                for off, name in SPLIT[bar]:
                    S.chord(track, PADV[name], bar * 4 + off, 2.0 + dur_extra, vel=vel, kind=kind, **kw)
            else:
                S.chord(track, PADV[c], bar * 4, n * 4.0 + dur_extra, vel=vel, kind=kind, **kw)
            bar += n

    def put_bars(lines, start_bar, fn, vel=0.8):
        for k, text in enumerate(lines):
            tot = sum(float(tok.split(":")[1]) for tok in text.split())
            assert abs(tot - 4.0) < 1e-6, (start_bar + k, text, tot)
            fn(start_bar + k, parse_notes(text, (start_bar + k) * 4, default_vel=vel))

    def lim(m, top=84):
        while m > top:
            m -= 12
        return m

    def trem(track, midi, start, length, v0=0.45, v1=0.8, step=0.125, t60=0.9):
        n = int(round(length / step))
        for i in range(n):
            u = i / max(n - 1, 1)
            S.note(track, I.pluck, start + i * step, midi, 0.5, v0 + (v1 - v0) * u, t60=t60, bright=0.75, body="guzheng", pick=0.12, jitter_ms=1.5)

    def gliss(start, i0, i1, v0=0.5, v1=0.9, step=0.125, scale=PENT, t60=1.5):
        for nt in run(scale, i0, i1, start, step, (v0, v1)):
            S.note("guzheng", I.pluck, nt["beat"], nt["midi"], 2.0, nt["vel"], t60=t60, bright=0.72, body="guzheng", pick=0.12, jitter_ms=1.5)

    def shriek(beat, midi, dur, vel=0.8, rise=7, track="haeg_lead"):
        S.note(track, I.bowed, beat, midi, dur, vel, kind="haegeum", glide_from=float(midi2hz(midi - rise)), glide_t=0.32,
               vib_depth=45, vib_rate=6.5, scratch=0.5, voices=2, attack=0.05, release=0.25, jitter_ms=3.0)

    def crash(beat, vel=0.9, dur=3.2, size=1.1):
        S.hit("cym", I.cymbal, beat, vel, dur=dur, size=size, variants=2)

    def hats(bar, vel=0.55):
        for s in (2, 6, 10, 14):
            S.hit("hat", I.cymbal, bar * 4 + s * 0.25, vel * (1.0 if s != 14 else 1.2), dur=0.18, size=0.5, hi=1.4)

    # ============================================================ INTRO  bars 0-1 : hits + riser
    S.hit("perc_low", I.taiko, 0, 1.0, freq=55.0, size=1.5, variants=1)
    S.hit("perc_low", I.taiko, 0, 0.95, freq=82.4, size=1.1, rim=0.3, variants=1)
    S.note("gong", I.gong, 0, 52, 9.0, 1.0)
    crash(0, 1.0, 3.8, 1.25)
    S.note("bass", I.sub_bass, 0, 28, 3.2, 0.95, attack=0.004, release=0.5, harm=0.4)
    S.hit("brass", stab, 0, 1.0, notes=tuple(STAB_BIG["Em"]), dur=0.9, release=0.5, variants=1)
    S.note("flute", I.flute, 0, 88, 2.5, 0.7, vib_depth=22, breath=0.3, attack=0.05, release=0.5, tone=1.1)  # D#6 of the last bar resolves here
    for step, v in ((3, 0.8), (6, 0.82), (8, 1.0), (11, 0.8), (14, 0.9)):
        S.hit("perc_low", I.taiko, step * 0.25, v, freq=82.4, size=1.0, tight=0.2)
    for step, v in ((6, 0.85), (8, 1.0), (14, 0.95)):
        S.hit("brass", stab, step * 0.25, v, notes=tuple(STAB["Em"]), dur=0.2)
    for step in (2, 10):
        S.hit("perc_hi", I.rim_click, step * 0.25, 0.55)
    for i, v in enumerate((0.55, 0.62, 0.7, 0.82)):  # bar 1: 8th taiko, then a 16th tom roll
        S.hit("perc_low", I.taiko, 4 + i * 0.5, v, freq=82.4, size=1.0, tight=0.3)
    roll(S, "perc_mid", I.taiko, 6.0, 2.0, step=0.25, v0=0.45, v1=1.0, freq=123.5, size=0.7, tight=0.5)
    for st in range(16):
        S.hit("perc_hi", I.rim_click, 4 + st * 0.25, 0.15 + 0.35 * st / 15)
    ostinato(1, 0, vel=0.55)
    for i in range(8):
        S.note("bass", I.sub_bass, 4 + i * 0.5, 40, 0.42, 0.45 + 0.05 * i, attack=0.006, release=0.07, harm=0.35)
    S.note("fx", riser, 2.0, 164.8, 6.0, 0.9)
    S.hit("fx", rev_cym, 6.0, 0.85, dur=2.0, variants=1)
    S.chord("pad", PADV["Em"], 0, 8.4, vel=0.8, kind="dark", attack=1.2, release=0.8, voices=5, spread=14.0, cutoff_open=1800, cutoff_closed=300)
    shriek(6.0, 83, 2.0, 0.65, rise=12)

    # ============================================================ A  bars 2-9 : drive groove
    LOW_A = ["X..x..x.X..x.x..", "X..x..x.X..xx.x."]
    BUK_A = "ogogxgogogogxgog"
    SP1 = {0: 1.0, 3: 0.8, 6: 0.8, 8: 0.95, 11: 0.8, 13: 0.8}
    SP2 = {0: 1.0, 6: 0.85, 8: 0.95, 10: 0.8, 12: 0.9, 14: 0.9}
    BASS_SH = {
        0: [0, 0, 12, 0, 0, 0, 12, 0],
        1: [0, 0, 12, 0, 0, 0, 12, 1],
    }
    crash(8, 0.9, 3.4)
    S.hit("perc_low", I.taiko, 8, 1.0, freq=55.0, size=1.4, variants=1)
    for bar in range(2, 10):
        lv = 0.88 if bar < 6 else 1.0
        S.pattern("perc_low", I.taiko, LOW_A[bar % 2], bar, vel_map={k: v * lv for k, v in V.items()}, jitter_ms=2.0, freq=82.4, size=1.0, tight=0.25)
        S.pattern("perc_mid", I.buk, BUK_A, bar, vel_map={k: v * lv for k, v in V.items()}, jitter_ms=2.0, freq=123.5)
        S.pattern("perc_hi", I.rim_click, "..o...o...o...o.", bar, vel_map={"o": 0.45 * lv}, jitter_ms=2.0)
        S.pattern("perc_hi", I.shaker, "tgxgtgxgtgxgtgxg", bar, vel_map={k: v * (0.7 if bar < 4 else 1.0) for k, v in V.items()}, jitter_ms=1.5)
        if bar >= 6:
            hats(bar, 0.45)
        bass_pulse(bar, BASS_SH[1 if bar in (3, 7) else 0], v0=0.78 * lv)
        ostinato(bar, bar % 2, vel=0.72 * lv)
        if bar >= 6:
            bass2_q(bar, 0.7)
        if bar >= 4:
            stabs(bar, SP2 if bar in (5, 9) else SP1, level=lv)
    # fills / call & response
    tom_fill(5, 12)
    tom_fill(9, 8, n=8, v0=0.5, v1=1.0, freqs=(196.0, 164.8, 146.8, 123.5), step=0.25)
    for (b, i0, i1) in ((5, 2, 12), (7, 3, 13)):
        gliss(b * 4 + 2.75, i0, i1, 0.5, 0.85, step=0.1)
    gliss(9 * 4 + 2.0, 5, 16, 0.55, 1.0, step=0.1, scale=PENT_B)
    shriek(5 * 4 + 2.0, 81, 1.6, 0.8)
    shriek(9 * 4 + 2.0, 83, 1.9, 0.9)
    # brass call (bars 6-9) with a flute shadow on the last bar
    put_bars(CALL_A2, 6, lambda bar, ns: [S.note("lead", I.brass_note, n["beat"], n["midi"], n["dur"] * 0.92, 0.82, attack=0.03, release=0.14, vib_depth=10, bright=1.0)
                                          for n in ns], vel=0.82)
    with S.layer("tune"):
        put_bars(CALL_A2[2:3], 8, lambda bar, ns: [S.note("flute", I.flute, n["beat"], n["midi"] + 12, n["dur"] * 0.92, 0.7, vib_depth=16, breath=0.28, attack=0.03, release=0.1)
                                                   for n in ns], vel=0.7)
    with S.layer("tune"):
        put_bars(CALL_A2[3:], 9, lambda bar, ns: [S.note("flute", I.flute, n["beat"], n["midi"], n["dur"] * 0.96, 0.7, vib_depth=16, breath=0.28, attack=0.03, release=0.1)
                                                  for n in ns], vel=0.7)
    pad_span(2, 10, "dark", 0.6, attack=0.3, release=0.5, voices=5, spread=14.0, cutoff_open=1900, cutoff_closed=350)
    S.note("gong", I.gong, 2 * 4, 52, 7.0, 0.7)
    crash(6 * 4, 0.6, 2.6, 0.9)
    S.hit("perc_low", I.taiko, 6 * 4, 1.0, freq=55.0, size=1.4, variants=1)

    # ============================================================ B  bars 10-17 : the theme
    LOW_B = "X.o.x.o.X.o.xxo."
    SP_B = {0: 1.0, 8: 0.9}
    crash(10 * 4, 1.0, 3.8, 1.2)
    S.note("gong", I.gong, 10 * 4, 52, 9.0, 0.95)
    S.hit("perc_low", I.taiko, 10 * 4, 1.0, freq=55.0, size=1.5, variants=1)
    for bar in range(10, 18):
        S.pattern("perc_low", I.taiko, LOW_B, bar, vel_map=V, jitter_ms=1.5, freq=82.4, size=0.9, tight=0.6)
        S.pattern("perc_mid", I.buk, "ogogxgogogogxgog", bar, vel_map={k: v * 0.75 for k, v in V.items()}, jitter_ms=1.5, freq=123.5)
        S.pattern("perc_hi", I.janggu_high, "....x.......x..g", bar, vel_map=V, jitter_ms=1.5, stick="tta")
        S.pattern("perc_hi", I.shaker, "tgxgtgxgtgxgtgxg", bar, vel_map=V, jitter_ms=1.5)
        hats(bar, 0.55)
        bass_pulse(bar, [0, 0, 12, 0, 7, 0, 12, 0], v0=0.8)
        bass2_q(bar, 0.65)
        # tight haegeum chops on the 8ths (pedal ostinato at half density)
        for k in range(8):
            cell = OST[ch_at(bar, k * 2)]
            S.note("haeg", I.bowed, bar * 4 + k * 0.5, cell[(0, 1, 0, 3)[k % 4]], 0.4, 0.5 * (1.0 if k % 2 == 0 else 0.7), kind="haegeum", attack=0.01, release=0.05, vib_depth=0.0, bow_noise=0.1)
        # gayageum 16th arpeggio
        for nt in arp(ARPN[ch_at(bar)], ARPO, bar * 4, step=0.25, vel=0.62, accent=(1.0, 0.6, 0.8, 0.6)):
            S.note("gayageum", I.pluck, nt["beat"], nt["midi"], 1.6, nt["vel"], t60=1.4, bright=0.5, body="gayageum", pick=0.2)
    tom_fill(13, 12)
    tom_fill(17, 8, n=8, v0=0.5, v1=1.0, step=0.25)
    # theme: horns (an octave below written) + flute as written
    put_bars(THEME_B, 10, lambda bar, ns: [S.note("lead", I.brass_note, n["beat"], n["midi"] - 12, n["dur"] * (0.96 if n["dur"] >= 1 else 0.9), 0.86,
                                                   attack=0.035, release=0.16, vib_depth=14, bright=1.0) for n in ns], vel=0.86)
    with S.layer("tune"):
        put_bars(THEME_B, 10, lambda bar, ns: [S.note("flute", I.flute, n["beat"], n["midi"], n["dur"] * 0.96, 0.78, vib_depth=15, breath=0.26, attack=0.04, release=0.12, tone=1.05, jitter_ms=8)
                                               for n in ns], vel=0.78)
    pad_span(10, 18, "brass", 0.62, track="brasspad", attack=0.15, release=0.4, voices=5, spread=10.0, cutoff_open=2200, cutoff_closed=500)
    pad_span(10, 18, "dark", 0.5, attack=0.3, release=0.5, voices=5, spread=14.0, cutoff_open=1900, cutoff_closed=350)
    # answers in the long notes
    gliss(12 * 4 + 2.0, 6, 14, 0.45, 0.85, step=0.11)
    gliss(16 * 4 + 2.0, 8, 15, 0.45, 0.9, step=0.1)
    shriek(13 * 4 + 3.0, 81, 1.0, 0.7, rise=5)
    for b in (11, 15):
        S.note("bells", I.bell, b * 4 + 3, 88 - (0 if b == 11 else 5), 3.0, 0.5, kind="glass")

    # ============================================================ C  bars 18-25 : breakdown + riser build
    S.note("gong", I.gong, 18 * 4, 52, 9.0, 0.75)
    S.note("bells", I.bell, 18 * 4, 40, 7.0, 0.8, kind="temple", gain=1.3)
    S.note("bells", I.bell, 20 * 4, 45, 6.0, 0.7, kind="temple", gain=1.2)
    # bass + sparse drums
    BCB = {0: 1.0, 3: 0.7, 6: 0.7, 10: 0.85, 13: 0.6}
    for bar in range(18, 22):
        for st, v in BCB.items():
            if bar >= 20 or st != 13:
                S.note("bass", I.sub_bass, bar * 4 + st * 0.25, BASS[PROG[bar]] + (0 if bar != 21 else 12 * (st == 13)), 0.55 if st else 1.2, 0.72 * v, attack=0.01, release=0.12, harm=0.4)
    for bar, steps in ((18, ((0, 1.0), (10, 0.6))), (19, ((0, 0.9), (6, 0.55), (10, 0.7))), (20, ((0, 1.0), (3, 0.7), (8, 0.85), (11, 0.65))),
                       (21, ((0, 1.0), (4, 0.7), (8, 0.8), (12, 1.0), (14, 0.8)))):
        for st, v in steps:
            S.hit("perc_low", I.taiko, bar * 4 + st * 0.25, v * 0.9, freq=82.4, size=1.2, tight=0.1)
    for bar in range(18, 22):
        S.hit("perc_hi", I.rim_click, bar * 4 + 2.0, 0.3)
        S.hit("perc_hi", I.rim_click, bar * 4 + 3.0, 0.3)
    # M1 in augmentation: flute, with the cello drone beneath it
    put_bars(M1_BREAK, 18, lambda bar, ns: [S.note("flute", I.flute, n["beat"], n["midi"], n["dur"] * 0.98, 0.62, vib_depth=20, breath=0.38, attack=0.12, release=0.3, tone=0.9, jitter_ms=10)
                                            for n in ns], vel=0.62)
    S.note("haeg_lead", I.bowed, 18 * 4, 52, 8.0, 0.55, kind="cello", attack=0.6, release=0.6, vib_depth=15)
    S.note("haeg_lead", I.bowed, 20 * 4, 57, 4.0, 0.58, kind="cello", attack=0.4, release=0.4, vib_depth=18)
    S.note("haeg_lead", I.bowed, 21 * 4, 59, 4.4, 0.65, kind="cello", attack=0.4, release=0.4, vib_depth=22)
    pad_span(18, 22, "dark", 0.7, attack=0.8, release=0.8, voices=5, spread=16.0, cutoff_open=1500, cutoff_closed=260)
    for k, m in enumerate((88, 83, 79, 76)):
        S.note("bells", I.bell, 19 * 4 + 3 + k * 0.25, m, 3.0, 0.4, kind="glass")
    # gayageum sigimsae: struck flat then pushed up to pitch / wailing vibrato (the breakdown's ornaments)
    S.note("gayageum", I.pluck, 19 * 4 + 2, 59, 3.0, 0.62, t60=3.0, bright=0.45, body="gayageum", bend=[(0.0, -1.6), (0.2, 0.0)], vib_depth=30, vib_rate=5.8)
    S.note("gayageum", I.pluck, 20 * 4 + 1.5, 64, 3.0, 0.62, t60=3.0, bright=0.45, body="gayageum", bend=[(0.0, -1.6), (0.2, 0.0)], vib_depth=34, vib_rate=6.0)
    S.note("gayageum", I.pluck, 21 * 4 + 2, 66, 3.0, 0.7, t60=2.6, bright=0.5, body="gayageum", bend=[(0.0, -2.0), (0.2, 0.0)], vib_depth=38, vib_rate=6.2)
    # the build: B pedal
    for bar in range(22, 26):
        b0 = bar * 4
        eighth = bar < 24
        r = 35
        if eighth:
            for i in range(8):
                S.note("bass", I.sub_bass, b0 + i * 0.5, r + (12 if i % 4 == 2 else 0), 0.42, 0.55 + 0.04 * i + 0.1 * (bar - 22), attack=0.006, release=0.07, harm=0.4)
        else:
            for i in range(15 if bar == 25 else 16):
                S.note("bass", I.sub_bass, b0 + i * 0.25, r + (12 if i % 4 == 2 else 0), 0.2, (0.7 if bar == 24 else 0.82) * (1.0 if i % 4 == 0 else 0.65), attack=0.004, release=0.04, harm=0.4)
        ostinato(bar, bar % 2, vel=0.5 + 0.1 * (bar - 22), shift=12 if bar >= 24 else 0, upto=15 if bar == 25 else 16)
        step = 4 if bar < 24 else (2 if bar == 24 else 1)  # quarter stabs -> 8ths -> 16ths
        for st in range(0, 16, step):
            if bar == 25 and st == 15:  # breath before the drop
                continue
            S.hit("brass", stab, b0 + st * 0.25, min(0.55 + 0.1 * (bar - 22) + 0.2 * st / 16, 1.0), notes=tuple(STAB[ch_at(bar, st)]), dur=0.12 if step < 4 else 0.2)
    # drums for the build: 8th taiko + buk, then 16th rolls
    for bar in (22, 23):
        for i in range(8):
            S.hit("perc_low", I.taiko, bar * 4 + i * 0.5, 0.5 + 0.06 * i + 0.14 * (bar - 22), freq=82.4, size=1.0, tight=0.35)
        for i in range(8):
            S.hit("perc_mid", I.buk, bar * 4 + i * 0.5 + 0.25, 0.3 + 0.05 * i + 0.1 * (bar - 22), freq=123.5)
        S.pattern("perc_hi", I.rim_click, "o.o.o.o.o.o.o.o.", bar, vel_map={"o": 0.3 + 0.12 * (bar - 22)}, jitter_ms=1.5)
    roll(S, "perc_low", I.taiko, 24 * 4, 4.0, step=0.25, v0=0.55, v1=0.8, freq=82.4, size=0.9, tight=0.5)
    roll(S, "perc_mid", I.taiko, 25 * 4, 3.75, step=0.25, v0=0.8, v1=1.0, freq=123.5, size=0.8, tight=0.5)
    roll(S, "perc_low", I.taiko, 25 * 4, 3.75, step=0.25, v0=0.75, v1=1.0, freq=82.4, size=0.9, tight=0.5)
    for i, f in enumerate((164.8, 196.0, 246.9)):
        S.hit("perc_mid", I.taiko, 25 * 4 + 3.0 + i * 0.25, 0.95, freq=f, size=0.6, tight=0.6)
    S.pattern("perc_hi", I.shaker, "xxxxxxxxxxxxxxxx", 24, vel_map={"x": 0.5}, jitter_ms=1.0)
    S.pattern("perc_hi", I.shaker, "xxxxxxxxxxxxxxx.", 25, vel_map={"x": 0.8}, jitter_ms=1.0)
    S.note("fx", riser, 22 * 4, 123.5, 16.0, 1.0, f_to=10000.0)
    S.hit("fx", rev_cym, 25 * 4, 1.0, dur=1.6, variants=1)
    S.hit("fx", rev_cym, 24 * 4, 0.7, dur=1.6, variants=2)
    pad_span(22, 26, "dark", 0.75, attack=0.4, release=0.4, voices=5, spread=18.0, cutoff_open=2600, cutoff_closed=400)
    pad_span(22, 26, "brass", 0.62, track="brasspad", attack=0.2, release=0.3, voices=5, spread=12.0, cutoff_open=2800, cutoff_closed=500)
    gliss(24 * 4 + 1.0, 0, 15, 0.45, 0.9, step=0.125)
    gliss(25 * 4 + 1.0, 4, 15, 0.7, 1.0, step=0.0625, t60=1.2)
    # rising flute trill on the b2 (B5 <-> C6)
    for i in range(16):
        S.note("flute", I.flute, 24 * 4 + i * 0.25, 83 + (i % 2), 0.23, 0.55 + 0.02 * i, attack=0.012, release=0.04, vib_depth=0, breath=0.22, jitter_ms=2.0)
    for i in range(15):
        S.note("flute", I.flute, 25 * 4 + i * 0.25, 86 + ((i % 2) * (1 if i < 8 else 2)), 0.23, 0.72 + 0.015 * i, attack=0.012, release=0.04, vib_depth=0, breath=0.22, jitter_ms=2.0)
    shriek(24 * 4 + 0.5, 78, 3.4, 0.75, rise=12)

    # ============================================================ A'  bars 26-33 : full power, theme varied / octave-up
    LOW_AP = "X.ox..x.X.ox.xoo"
    crash(26 * 4, 1.0, 4.0, 1.3)
    S.note("gong", I.gong, 26 * 4, 52, 9.0, 1.0)
    S.note("bells", I.bell, 26 * 4, 52, 7.0, 0.8, kind="temple", gain=1.2)
    S.hit("perc_low", I.taiko, 26 * 4, 1.0, freq=55.0, size=1.5, variants=1)
    S.hit("perc_low", I.taiko, 26 * 4, 0.9, freq=82.4, size=1.1, rim=0.3, variants=1)
    for bar in range(26, 34):
        S.pattern("perc_low", I.taiko, LOW_AP, bar, vel_map=V, jitter_ms=1.5, freq=82.4, size=1.0, tight=0.3)
        S.pattern("perc_mid", I.taiko, "o.o.X.o.o.o.X.o.", bar, vel_map=V, jitter_ms=1.5, freq=164.8, size=0.6, tight=0.7)
        S.pattern("perc_mid", I.buk, BUK_A, bar, vel_map=V, jitter_ms=1.5, freq=123.5)
        S.pattern("perc_hi", I.janggu_high, "....x.......x..g", bar, vel_map=V, jitter_ms=1.5, stick="tta")
        S.pattern("perc_hi", I.rim_click, "..o...o...o...o.", bar, vel_map={"o": 0.5}, jitter_ms=1.5)
        S.pattern("perc_hi", I.shaker, "xgxgxgxgxgxgxgxg", bar, vel_map={"x": 0.55, "g": 0.3}, jitter_ms=1.0)
        hats(bar, 0.65)
        if bar >= 30:
            bass_16(bar, 0.82)
        else:
            bass_pulse(bar, BASS_SH[1 if bar in (27, 31) else 0], v0=0.85)
        bass2_q(bar, 0.78)
        ostinato(bar, bar % 2, vel=0.7)
        stabs(bar, SP2 if bar in (29, 33) else SP1, level=1.0)
        if bar % 2 == 0 and bar != 26:
            crash(bar * 4, 0.7, 2.8, 1.0)
    tom_fill(29, 12)
    tom_fill(33, 8, n=8, v0=0.55, v1=1.0, step=0.25)
    pad_span(26, 34, "dark", 0.7, attack=0.3, release=0.5, voices=5, spread=16.0, cutoff_open=2200, cutoff_closed=380)
    pad_span(26, 34, "brass", 0.7, track="brasspad", attack=0.12, release=0.35, voices=5, spread=11.0, cutoff_open=2600, cutoff_closed=500)
    # melody: horns at written pitch (top notes folded an octave down) + a thick octave-below layer, flute and haegeum on top
    put_bars(THEME_AP, 26, lambda bar, ns: [S.note("lead", I.brass_note, n["beat"], lim(n["midi"]), n["dur"] * (0.96 if n["dur"] >= 1 else 0.9), 0.92,
                                                    attack=0.03, release=0.15, vib_depth=14, bright=1.0) for n in ns], vel=0.92)
    put_bars(THEME_AP, 26, lambda bar, ns: [S.note("lead2", I.brass_note, n["beat"], lim(n["midi"]) - 12, n["dur"] * (0.96 if n["dur"] >= 1 else 0.9), 0.85,
                                                    attack=0.04, release=0.15, vib_depth=12, bright=0.9) for n in ns], vel=0.85)
    with S.layer("tune"):
        put_bars(THEME_AP, 26, lambda bar, ns: [S.note("flute", I.flute, n["beat"], n["midi"], n["dur"] * 0.96, 0.88, vib_depth=18, breath=0.24, attack=0.03, release=0.1, tone=1.1, jitter_ms=6)
                                                for n in ns], vel=0.88)
    with S.layer("tune"):
        put_bars(THEME_AP, 26, lambda bar, ns: [S.note("haeg_lead", I.bowed, n["beat"], lim(n["midi"], 88), n["dur"] * 0.97, 0.7, kind="haegeum", attack=0.03, release=0.12, vib_depth=22, voices=2, jitter_ms=5)
                                                for n in ns], vel=0.7)
    # guzheng: tremolo under the long notes, runs between phrases
    trem("guzheng", 83, 26 * 4 + 2, 2.0)
    trem("guzheng", 81, 29 * 4 + 0, 1.5, 0.5, 0.85)
    trem("guzheng", 88, 30 * 4 + 1, 1.5, 0.5, 0.85)
    trem("guzheng", 89, 32 * 4 + 2, 1.5, 0.55, 0.9)
    trem("guzheng", 79, 28 * 4 + 0.5, 1.0, 0.4, 0.7)
    gliss(29 * 4 + 2.5, 3, 15, 0.5, 0.95, step=0.09)
    gliss(31 * 4 + 2.5, 15, 5, 0.9, 0.5, step=0.09, scale=PHRYG)
    gliss(33 * 4 + 1.5, 5, 17, 0.6, 1.0, step=0.08, scale=PENT_B)
    shriek(29 * 4 + 3.0, 81, 1.0, 0.8, rise=5)
    shriek(33 * 4 + 0.0, 71, 1.0, 0.7, rise=12)

    # ============================================================ D  bars 34-37 : climax + fills, pickup into bar 0
    LOW_D = "XxoxXxoxXxoxXxox"
    # (crash on the downbeat of every D bar is placed in the loop below)
    S.note("gong", I.gong, 34 * 4, 52, 9.0, 0.85)
    S.note("bells", I.bell, 34 * 4, 52, 7.0, 0.8, kind="temple", gain=1.2)
    S.hit("perc_low", I.taiko, 34 * 4, 1.0, freq=55.0, size=1.5, variants=1)
    for bar in range(34, 38):
        last = bar == 37
        if not last:
            S.pattern("perc_low", I.taiko, LOW_D, bar, vel_map=V, jitter_ms=1.2, freq=82.4, size=1.0, tight=0.4)
            S.pattern("perc_mid", I.taiko, "o.o.X.o.o.o.X.o.", bar, vel_map=V, jitter_ms=1.2, freq=164.8, size=0.6, tight=0.7)
            S.pattern("perc_mid", I.buk, "xgxgxgxgxgxgxgxg", bar, vel_map=V, jitter_ms=1.2, freq=123.5)
            S.pattern("perc_hi", I.janggu_high, "....x.......x.x.", bar, vel_map=V, jitter_ms=1.2, stick="tta")
            S.pattern("perc_hi", I.shaker, "xxxxxxxxxxxxxxxx", bar, vel_map={"x": 0.55}, jitter_ms=1.0)
            hats(bar, 0.75)
            bass_16(bar, 0.88)
            ostinato(bar, bar % 2, vel=0.76, shift=0)
            stabs(bar, {0: 1.0, 2: 0.7, 3: 0.85, 6: 0.85, 8: 0.95, 10: 0.7, 11: 0.85, 14: 0.9}, level=1.0)
            bass2_q(bar, 0.85)
        crash(bar * 4, 1.0 if bar == 34 else 0.85, 3.8 if bar == 34 else 2.8, 1.25 if bar == 34 else 1.0)
    tom_fill(35, 12, n=4, v0=0.7, v1=1.0)
    tom_fill(36, 8, n=8, v0=0.6, v1=1.0, step=0.25)
    # bar 37: stop-time. hit on the one, unison punches, a tom run, then a pickup (3.0, 3.5) into bar 0
    b = 37 * 4
    S.hit("perc_low", I.taiko, b, 1.0, freq=55.0, size=1.5, variants=1)
    S.hit("perc_low", I.taiko, b, 0.9, freq=82.4, size=1.0, tight=0.2)
    S.hit("brass", stab, b, 1.0, notes=tuple(STAB_BIG["B"]), dur=0.55, release=0.3, variants=1)
    S.note("bass", I.sub_bass, b, 35, 1.8, 0.95, attack=0.005, release=0.2, harm=0.4)
    for bt, v in ((1.0, 0.9), (1.75, 0.85)):
        S.hit("perc_low", I.taiko, b + bt, v, freq=82.4, size=1.0, tight=0.2)
        S.hit("brass", stab, b + bt, v, notes=tuple(STAB["B"]), dur=0.15)
        S.note("bass", I.sub_bass, b + bt, 35, 0.3, 0.8, attack=0.004, release=0.05, harm=0.4)
    for i, f in enumerate((246.9, 220.0, 196.0, 164.8, 146.8, 123.5)):
        S.hit("perc_mid", I.taiko, b + 2.0 + i * 0.25, 0.7 + 0.05 * i, freq=f, size=0.6, tight=0.6)
    for bt in (3.0, 3.5):
        S.hit("perc_low", I.taiko, b + bt, 1.0, freq=82.4, size=1.0, tight=0.2)
        S.hit("perc_mid", I.taiko, b + bt, 0.9, freq=123.5, size=0.8, tight=0.4)
        S.hit("brass", stab, b + bt, 1.0, notes=tuple(STAB["B"]), dur=0.14)
        S.note("bass", I.sub_bass, b + bt, 35, 0.3, 0.85, attack=0.004, release=0.05, harm=0.4)
    S.pattern("perc_hi", I.shaker, "xxxxxxxxxxxxxxxx", 37, vel_map={"x": 0.7}, jitter_ms=1.0)
    S.hit("fx", rev_cym, 37 * 4 + 2.0, 0.85, dur=1.6, variants=1)
    pad_span(34, 38, "dark", 0.75, attack=0.25, release=0.5, voices=5, spread=18.0, cutoff_open=2600, cutoff_closed=420)
    pad_span(34, 38, "brass", 0.7, track="brasspad", attack=0.1, release=0.3, voices=5, spread=12.0, cutoff_open=2800, cutoff_closed=500)
    put_bars(CLIMAX_D, 34, lambda bar, ns: [S.note("lead", I.brass_note, n["beat"], lim(n["midi"]), n["dur"] * (0.95 if n["dur"] >= 1 else 0.88), 0.95,
                                                    attack=0.025, release=0.12, vib_depth=12, bright=1.0) for n in ns], vel=0.95)
    put_bars(CLIMAX_D, 34, lambda bar, ns: [S.note("lead2", I.brass_note, n["beat"], lim(n["midi"]) - 12, n["dur"] * (0.95 if n["dur"] >= 1 else 0.88), 0.88,
                                                    attack=0.03, release=0.12, vib_depth=10, bright=0.9) for n in ns], vel=0.88)
    with S.layer("tune"):
        put_bars(CLIMAX_D, 34, lambda bar, ns: [S.note("flute", I.flute, n["beat"], n["midi"], n["dur"] * 0.95, 0.9, vib_depth=18, breath=0.22, attack=0.025, release=0.1, tone=1.1, jitter_ms=4)
                                                for n in ns], vel=0.9)
    with S.layer("tune"):
        put_bars(CLIMAX_D, 34, lambda bar, ns: [S.note("haeg_lead", I.bowed, n["beat"], lim(n["midi"], 88), n["dur"] * 0.96, 0.72, kind="haegeum", attack=0.025, release=0.1, vib_depth=22, voices=2, jitter_ms=3)
                                                for n in ns], vel=0.72)
    trem("guzheng", 88, 34 * 4 + 0, 1.0, 0.5, 0.85)
    trem("guzheng", 89, 36 * 4 + 2, 2.0, 0.55, 0.95)
    gliss(35 * 4 + 2.5, 3, 15, 0.55, 1.0, step=0.09)
    gliss(37 * 4 + 0.75, 16, 6, 0.9, 0.55, step=0.1, scale=PENT_B)
    shriek(36 * 4 + 2.0, 89, 1.6, 0.8, rise=3)

    if zone is not None:
        zone_layer(S, zone, put_bars, lim)
    return S


# ---------------------------------------------------------------- AG-03: the zone voice
def zone_layer(S: Song, zone: str, put_bars, lim) -> dict:
    """Lift the flute / haegeum doubling of the tune (Song.layer "tune") out of the finished boss Song and put the zone's lead voice in its place:
    the zone motif over bars 2-5 and 26-29, the boss tune where the flute used to double it (bars 8-9 call, 10-17 theme, 30-33, 34-37 climax)."""
    S.track("zlead", pan=0.2, gain_db=-8.5, reverb={"hall": 0.3, "plate": 0.08}, eq=[("hp", 130), ("lp", 8200)])
    S.track("zlead2", pan=-0.22, gain_db=-12.5, reverb={"hall": 0.28, "plate": 0.06}, eq=[("hp", 150), ("lp", 7800)])
    rep = apply_calm(S, layers=("tune",))

    def note(track, inst, n, vel, shift=0, dur_mul=0.96, dur=None, **kw):
        S.note(track, inst, n["beat"], n["midi"] + shift, n["dur"] * dur_mul if dur is None else dur, vel, **kw)

    def lead(ns, vel, shift=0):
        """Play the notes `ns` (a motif, shift = semitones from the written pitch; or the boss tune the flute used to double) with the zone's voice."""
        for n in ns:
            long_ = n["dur"] >= 1.5
            if zone == "yeonmu":  # daegeum (breathy bamboo with the buzzing membrane) + a gayageum pluck on every note
                note("zlead", I.flute, n, vel, shift, vib_depth=17, breath=0.4, buzz=0.42, tone=0.85, attack=0.035, release=0.12, jitter_ms=7)
                note("zlead2", I.pluck, n, vel * 0.85, shift, dur=1.6, t60=1.7, bright=0.62, pick=0.18, body="gayageum", jitter_ms=3)
                if long_:
                    note("zlead2", I.pluck, dict(n, beat=n["beat"] + 0.5), vel * 0.5, shift + 12, dur=1.4, t60=1.4, bright=0.7, pick=0.15, body="gayageum")
            elif zone == "suryeon":  # low cello howl, the haegeum wails on the long notes (the valley's sigh)
                note("zlead", I.bowed, n, vel, shift, 0.97, kind="cello", attack=0.05, release=0.12, vib_depth=24, vib_delay=0.15, bow_noise=0.22, voices=2, scratch=0.12, jitter_ms=8)
                if long_:
                    note("zlead2", I.bowed, n, vel * 0.8, shift + 12, 0.97, kind="haegeum", glide_from=float(midi2hz(n["midi"] + shift + 10)), glide_t=0.16,
                         attack=0.06, release=0.18, vib_depth=42, vib_rate=6.2, scratch=0.4, voices=2, jitter_ms=6)
            elif zone == "seori":  # airy flute with a cold glass bell on every note that can ring
                note("zlead", I.flute, n, vel * 0.95, shift, breath=0.55, buzz=0.12, vib_depth=11, tone=0.9, attack=0.05, release=0.16, jitter_ms=9)
                if n["dur"] >= 0.75:
                    note("zlead2", I.bell, n, vel * 0.55, shift + 12, dur=min(n["dur"] * 1.8, 3.2), kind="glass", jitter_ms=4)
            else:  # daeryeol: a growling brass reed and the haegeum screaming over it
                note("zlead", I.brass_note, n, vel, shift, 0.95, attack=0.03, release=0.12, vib_depth=11, bright=1.3, growl=0.55, jitter_ms=5)
                note("zlead2", I.bowed, n, vel * 0.75, shift + 12 if long_ else shift, 0.96, kind="haegeum", attack=0.03, release=0.1, vib_depth=45, vib_rate=6.4, scratch=0.55, voices=2, jitter_ms=4)

    sh = DOUBLE_SHIFT[zone]
    put_bars(MOTIF[zone], 2, lambda bar, ns: lead(ns, 0.8), vel=0.8)
    put_bars(MOTIF[zone], 26, lambda bar, ns: lead(ns, 0.86), vel=0.86)
    put_bars(CALL_A2[2:3], 8, lambda bar, ns: lead([dict(n, midi=n["midi"] + 12) for n in ns], 0.7, sh), vel=0.7)
    put_bars(CALL_A2[3:], 9, lambda bar, ns: lead(ns, 0.7, sh), vel=0.7)
    put_bars(THEME_B, 10, lambda bar, ns: lead(ns, 0.78, sh), vel=0.78)
    put_bars(THEME_AP[4:], 30, lambda bar, ns: lead([dict(n, midi=lim(n["midi"])) for n in ns], 0.9, sh), vel=0.9)
    put_bars(CLIMAX_D, 34, lambda bar, ns: lead([dict(n, midi=lim(n["midi"])) for n in ns], 0.92, sh), vel=0.92)
    return rep

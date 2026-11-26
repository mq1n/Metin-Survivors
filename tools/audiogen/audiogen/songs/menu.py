"""Menu theme -- "Ejderha Tanrisi'nin Salonu" (Sky Sovereign's Hall). D dorian-pentatonic, 84 BPM, 32 bars (~91.4 s) loop.

Form: Intro (4) | A (8) | B (8) | A' (8) | Outro (4, hangs on the dominant and wraps into the Intro).
Motif M1 (A4 D5 C5 A4 | G4 A4 C5) returns throughout the soundtrack in different guises.
"""
from __future__ import annotations

from .. import instruments as I
from ..comp import arp, run, roll
from ..dsp import midi2hz
from ..music import Song, parse_notes, transpose, shift

ID = "mus_menu"
LOOP = True

CH = {
    "Dm": [50, 57, 62, 65, 69],
    "C": [48, 55, 60, 64, 67],
    "F": [53, 57, 60, 65, 69],
    "Am": [45, 57, 60, 64, 67],
    "G": [43, 55, 62, 67, 69],
    "Asus": [45, 52, 57, 62, 64],
    "Bb": [46, 53, 58, 62, 65],
}
ARP = {
    "Dm": [50, 57, 62, 65, 69, 74],
    "C": [48, 55, 60, 64, 67, 72],
    "F": [53, 60, 65, 69, 72, 77],
    "Am": [45, 57, 60, 64, 69, 72],
    "G": [43, 55, 62, 67, 69, 74],
    "Asus": [45, 57, 62, 64, 69, 74],
    "Bb": [46, 58, 62, 65, 70, 74],
}
BASS = {"Dm": 38, "C": 36, "F": 41, "Am": 33, "G": 43, "Asus": 33, "Bb": 34}

PROG = (
    ["Dm", "Dm", "C", "Am"]  # intro
    + ["Dm", "C", "F", "Am", "Dm", "C", "F", "Am"]  # A
    + ["F", "G", "Am", "Dm", "F", "C", "G", "Asus"]  # B
    + ["Dm", "C", "F", "Am", "Dm", "C", "F", "Am"]  # A'
    + ["Bb", "C", "G", "Asus"]  # outro
)

PENT = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84, 86, 89]  # D F G A C pentatonic ladder from D4

FLUTE_A = """
A4:2 D5:1 C5:.5 A4:.5 | G4:1.5 A4:.5 C5:2 | D5:2 C5:1 A4:1 | C5:1 A4:1 E5:2 |
A4:1.5 D5:.5 F5:1 E5:1 | D5:1.5 C5:.5 G4:2 | A4:1 C5:1 D5:1 F5:1 | E5:3 r:1
"""
FLUTE_B = """
C6:2 A5:1 F5:1 | G5:1.5 A5:.5 D6:2 | C6:1 A5:1 E5:1 A5:1 | D6:2 C6:1 A5:1 |
F6:1.5 E6:.5 D6:1 C6:1 | D6:1 C6:1 G5:2 | A5:1 D6:1 E6:2 | E6:2 D6:1 A5:1
"""
HAEGEUM_B = """
A4:4 | D5:4 | E5:4 | F5:2 D5:2 | C5:4 | E5:4 | D5:4 | A4:4
"""

BELL_MOTIF = "A5:1 D6:1 C6:2"


def build() -> Song:
    S = Song("menu", bpm=84, bars=32, seed=3)
    S.track("pad", gain_db=-9.5, reverb={"hall": 0.35}, eq=[("hp", 90), ("lp", 6000)], duck=("perc_low", 2.5, 260))
    S.track("gayageum", pan=-0.28, gain_db=-5.5, reverb={"plate": 0.2, "hall": 0.2}, eq=[("hp", 100)])
    S.track("guzheng", pan=0.32, gain_db=-8, reverb={"plate": 0.25, "hall": 0.2}, eq=[("hp", 200)])
    S.track("flute", pan=0.08, gain_db=-4.0, reverb={"hall": 0.38, "plate": 0.1}, eq=[("hp", 150)])
    S.track("haegeum", pan=-0.12, gain_db=-7.5, reverb={"hall": 0.35}, eq=[("hp", 180)])
    S.track("bells", pan=0.2, gain_db=-12, reverb={"air": 0.5, "hall": 0.2}, eq=[("hp", 300)])
    S.track("bass", gain_db=-9, eq=[("hp", 35)], sat=1.0)
    S.track("perc_low", gain_db=-6, reverb={"arena": 0.2}, eq=[("hp", 30)])
    S.track("perc_hi", pan=0.15, gain_db=-12, reverb={"plate": 0.22})
    S.track("gong", gain_db=-13, reverb={"hall": 0.4})
    S.automate("pad", [(0, 0), (16, 0), (17, 1.5), (48, 1.5), (49, 3.0), (80, 3.0), (96, 3.0), (112, 0.5), (128, 0.0)])

    bpb = 4

    # ---- pad: one chord per bar, overlapped
    for bar, ch in enumerate(PROG):
        v = 0.55 if (bar < 4 or bar >= 28) else (0.7 if bar < 12 else 0.85)
        S.chord("pad", CH[ch], bar * bpb, 5.0, vel=v, kind="strings", attack=1.1, release=1.6, voices=7, spread=9.0, cutoff_open=2400, cutoff_closed=450)

    # ---- bass from bar 12 (B) to 27
    for bar in range(12, 28):
        r = BASS[PROG[bar]]
        v = 0.7 if bar < 20 else 0.8
        S.note("bass", I.sub_bass, bar * bpb, r, 3.0, v, attack=0.02, release=0.2)
        if bar % 2 == 1:
            S.note("bass", I.sub_bass, bar * bpb + 3, r + 7, 0.9, v * 0.8)
    # outro bass: thin last held roots
    for bar in range(28, 32):
        S.note("bass", I.sub_bass, bar * bpb, BASS[PROG[bar]], 3.8, 0.55)

    # ---- gayageum
    pA = [0, 2, 4, 2, 3, 2, 4, 5]
    pB = [0, 3, 2, 4, 3, 5, 4, 2]
    # intro: sparse, soft, bends
    for bar in range(0, 4):
        ch = ARP[PROG[bar]]
        S.note("gayageum", I.pluck, bar * bpb, ch[0], 3.5, 0.55, t60=3.2, bright=0.45, body="gayageum", bend=[(0, -1.0), (0.18, 0.0)] if bar % 2 == 0 else None, vib_depth=22 if bar % 2 == 0 else 0)
        S.note("gayageum", I.pluck, bar * bpb + 1.5, ch[2], 2.5, 0.5, t60=2.8, bright=0.45)
        S.note("gayageum", I.pluck, bar * bpb + 2.5, ch[4], 2.0, 0.45, t60=2.4, bright=0.45)
    for bar in range(4, 28):
        ch = ARP[PROG[bar]]
        order = pA if bar % 2 == 0 else pB
        vel = 0.62 if bar < 12 else (0.7 if bar < 20 else 0.78)
        for nt in arp(ch, order, bar * bpb, step=0.5, vel=vel, accent=(1.0, 0.75, 0.85, 0.7)):
            S.note("gayageum", I.pluck, nt["beat"], nt["midi"], 2.4, nt["vel"], t60=2.2, bright=0.5, body="gayageum", pick=0.2)
        # a shaped bend/vibrato note on the first beat of every 4th bar
        if bar % 4 == 3:
            S.note("gayageum", I.pluck, bar * bpb + 3.0, ch[4], 1.5, 0.7, t60=2.5, bend=[(0, -1.6), (0.2, 0.0)], vib_depth=35, vib_rate=5.8)
    for bar in range(28, 32):
        ch = ARP[PROG[bar]]
        for k, ix in enumerate([0, 2, 4]):
            S.note("gayageum", I.pluck, bar * bpb + k * 1.0, ch[ix], 3.0, 0.5 - bar * 0.0, t60=3.0, bright=0.42)

    # ---- guzheng: glissando flourishes and high sparkles
    def gliss(start_beat, i0, i1, vel0=0.5, vel1=0.8, step=0.125):
        for nt in run(PENT, i0, i1, start_beat, step, (vel0, vel1)):
            S.note("guzheng", I.pluck, nt["beat"], nt["midi"], 2.2, nt["vel"], t60=2.0, bright=0.7, body="guzheng", pick=0.12, jitter_ms=2.0)

    gliss(11 * bpb + 2.5, 0, 9)
    gliss(19 * bpb + 2.5, 0, 11, 0.5, 0.9)
    gliss(27 * bpb + 2.0, 11, 1, 0.8, 0.45, 0.14)
    for bar in (8, 16, 24):  # arpeggio sprinkles
        for k in range(4):
            S.note("guzheng", I.pluck, bar * bpb + 2 + k * 0.5, PENT[3 + k + (bar // 8)], 2.0, 0.5 + 0.05 * k, t60=2.0, bright=0.7, body="guzheng")

    # ---- flute melody
    fa = parse_notes(FLUTE_A, 4 * bpb)
    for nt in fa:
        S.note("flute", I.flute, nt["beat"], nt["midi"], nt["dur"] * 0.97, nt["vel"] * 0.95, vib_depth=15, breath=0.34, jitter_ms=8)
    fb = parse_notes(FLUTE_B, 12 * bpb, default_vel=0.82)
    for nt in fb:
        S.note("flute", I.flute, nt["beat"], nt["midi"], nt["dur"] * 0.97, nt["vel"], vib_depth=18, breath=0.3, buzz=0.22, tone=1.05)
    fa2 = parse_notes(FLUTE_A, 20 * bpb, default_vel=0.85)
    for nt in transpose(fa2, 12):
        S.note("flute", I.flute, nt["beat"], nt["midi"], nt["dur"] * 0.97, nt["vel"], vib_depth=18, breath=0.3, tone=1.0)
    # intro: a lone, slow reading of the motif's first phrase (very soft)
    intro = parse_notes("A4:2 D5:2 | C5:4", 1 * bpb, default_vel=0.5)
    for nt in intro:
        S.note("flute", I.flute, nt["beat"], nt["midi"], nt["dur"] * 0.98, nt["vel"], vib_depth=12, breath=0.45, attack=0.25)
    # outro: fragment fades, last note hangs on E (dominant colour) and wraps to the intro
    outro = parse_notes("D5:2 F5:1 E5:1 | E5:4 | A5:3 r:1 | E5:3.5", 28 * bpb, default_vel=0.55)
    for nt in outro:
        S.note("flute", I.flute, nt["beat"], nt["midi"], nt["dur"] * 0.98, nt["vel"], vib_depth=14, breath=0.4, release=0.5, attack=0.2)

    # ---- haegeum
    for nt in parse_notes(HAEGEUM_B, 12 * bpb, default_vel=0.7):
        S.note("haegeum", I.bowed, nt["beat"], nt["midi"], nt["dur"], nt["vel"], kind="haegeum", attack=0.35, release=0.4, vib_depth=22,
               glide_from=float(midi2hz(nt["midi"] - 2)), voices=2)
    for nt in parse_notes(FLUTE_A, 20 * bpb, default_vel=0.72):
        S.note("haegeum", I.bowed, nt["beat"], nt["midi"], nt["dur"] * 0.98, nt["vel"], kind="haegeum", attack=0.18, release=0.3, vib_depth=20, voices=2)

    # ---- bells
    for nt in parse_notes("D6:1 r:1 A5:1 r:1 | F6:2 r:2 | E6:1.5 r:2.5 | C6:3", 0.0, default_vel=0.5):
        S.note("bells", I.bell, nt["beat"], nt["midi"], 5.0, nt["vel"], kind="glass", brightness=0.9)
    for bar in (11, 19, 27):
        for k, m in enumerate([86, 81, 79, 74]):
            S.note("bells", I.bell, bar * bpb + 3 + k * 0.25, m, 3.5, 0.5, kind="glass")
    for nt in parse_notes("A6:2 r:2 | E6:2 r:2 | D6:1 F6:1 A6:2 | r:4", 29 * bpb, default_vel=0.45):
        S.note("bells", I.bell, nt["beat"], nt["midi"], 6.0, nt["vel"], kind="glass")
    # temple bell on section downbeats
    for bar in (12, 20):
        S.note("bells", I.bell, bar * bpb, 50, 7.0, 0.7, kind="temple", gain=1.4)

    # ---- gong
    S.note("gong", I.gong, 0.0, 50, 8.0, 0.85)
    S.note("gong", I.gong, 12 * bpb, 50, 9.0, 0.9)
    S.note("gong", I.gong, 20 * bpb, 50, 9.0, 1.0)
    S.note("gong", I.gong, 28 * bpb, 50, 9.0, 0.7)

    # ---- percussion
    # intro heartbeat (soft frame drum) from bar 3
    for bar in range(2, 4):
        S.hit("perc_low", I.frame_drum, bar * bpb + 0, 0.4, freq=110.0)
        S.hit("perc_low", I.frame_drum, bar * bpb + 2, 0.3, freq=110.0)
    # A: buk on 1 & 3, moktak sparkle
    for bar in range(4, 12):
        S.hit("perc_low", I.buk, bar * bpb + 0, 0.55, freq=110.0)
        S.hit("perc_low", I.buk, bar * bpb + 2, 0.42, freq=110.0)
        if bar % 2 == 1:
            S.hit("perc_hi", I.moktak, bar * bpb + 3.5, 0.5, pitch=1.0)
        S.hit("perc_hi", I.rim_click, bar * bpb + 1.5, 0.25)
    # B: taiko + janggu groove
    for bar in range(12, 20):
        b = bar * bpb
        S.hit("perc_low", I.taiko, b + 0, 0.9, freq=73.4)
        S.hit("perc_low", I.taiko, b + 1.5, 0.55, freq=110.0, size=0.6)
        S.hit("perc_low", I.taiko, b + 2, 0.7, freq=73.4)
        S.hit("perc_low", I.taiko, b + 3.5, 0.5, freq=110.0, size=0.6)
        S.pattern("perc_hi", I.janggu_high, "..o...o...o.o...", bar, vel_map={"o": 0.55}, stick="deok")
        S.pattern("perc_hi", I.shaker, "x.x.x.x.x.x.x.x.", bar, vel_map={"x": 0.4})
    for bar in range(12, 20):
        S.hit("perc_low", I.janggu_low, bar * bpb + 0.75, 0.6)
    # A': driving
    for bar in range(20, 28):
        b = bar * bpb
        S.hit("perc_low", I.taiko, b + 0, 1.0, freq=73.4)
        S.hit("perc_low", I.taiko, b + 1, 0.6, freq=73.4, size=0.8)
        S.hit("perc_low", I.taiko, b + 1.5, 0.6, freq=110.0, size=0.6)
        S.hit("perc_low", I.taiko, b + 2, 0.85, freq=73.4)
        S.hit("perc_low", I.taiko, b + 3, 0.6, freq=110.0, size=0.7)
        S.hit("perc_low", I.taiko, b + 3.5, 0.7, freq=73.4, size=0.8)
        S.pattern("perc_hi", I.janggu_high, "o.o.o.o.o.o.oo.o", bar, vel_map={"o": 0.6}, stick="deok")
        S.pattern("perc_hi", I.shaker, "xxxxxxxxxxxxxxxx", bar, vel_map={"x": 0.3})
        S.hit("perc_hi", I.rim_click, b + 1.5, 0.45)
        S.hit("perc_hi", I.rim_click, b + 3.5, 0.45)
    # fills at section ends
    roll(S, "perc_low", I.taiko, 19 * bpb + 3, 1.0, step=0.125, v0=0.5, v1=1.0, freq=73.4, size=0.5)
    roll(S, "perc_low", I.taiko, 27 * bpb + 2.0, 2.0, step=0.125, v0=0.45, v1=1.0, freq=73.4, size=0.5)
    S.hit("perc_low", I.taiko, 20 * bpb, 1.0, freq=55.0, size=1.5)
    # B downbeat drop and outro: gentle frame drum
    for bar in range(28, 32):
        S.hit("perc_low", I.frame_drum, bar * bpb, 0.32, freq=110.0)
        if bar < 31:
            S.hit("perc_low", I.frame_drum, bar * bpb + 2, 0.25, freq=110.0)
    return S

"""Victory stinger -- "Zafer Borusu" (Trumpets of Triumph). D major-pentatonic, 120 BPM, 3 bars (6.0 s) + 2.6 s tail, one-shot.

Beats 0-8 : pp -> ff build. Horns climb a rising D-major arpeggio sequence (D4 F#4 A4 | F#4 A4 B4 | A4 B4 D5 | D5 F#5 A5 A5 A5), the stack grows
            (lead -> + fifth below -> + octave below) while a 16th taiko roll swells, a siren/riser and reverse cymbal rush in, and the
            guzheng sweeps up the pentatonic ladder into the downbeat.
Beat 8    : the arrival -- full open D chord (D A D F# A D) on horns + brass/string pads, taiko + gong + crash, rolled guzheng chord, glass-bell shimmer.
            The chord is held and left to ring out in the hall.
"""
from __future__ import annotations

from .. import instruments as I
from ..comp import roll, run
from ..music import Song, parse_notes
from ._boss_inst import riser, rev_cym

ID = "mus_victory"
LOOP = False

PENT_D = [50, 52, 54, 57, 59, 62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]  # D major pentatonic ladder from D3 (D E F# A B)
CELLS = [  # (notes, velocity) -- each cell 2 beats; they start on the notes of the D triad (D, F#, A, D')
    ("D4:.5 F#4:.5 A4:1", 0.56),
    ("F#4:.5 A4:.5 B4:1", 0.64),
    ("A4:.5 B4:.5 D5:1", 0.76),
    ("D5:.5 F#5:.5 A5:.5 A5:.25 A5:.25", 0.9),
]
FINAL_CHORD = [50, 57, 62, 66, 69, 74]  # D3 A3 D4 F#4 A4 D5 (open voicing)


def build() -> Song:
    S = Song("victory", bpm=120, bars=3, tail=2.6, seed=557)
    S.master_comp = None  # keep the pp -> ff arc intact (the pipeline's limiter/normaliser does the rest)
    S.track("perc_low", gain_db=-6.5, reverb={"arena": 0.2}, eq=[("hp", 38)])
    S.track("perc_hi", pan=0.15, gain_db=-14.0, reverb={"plate": 0.2})
    S.track("cym", pan=0.1, gain_db=-11.0, reverb={"hall": 0.25}, eq=[("hp", 400)])
    S.track("gong", gain_db=-9.0, reverb={"hall": 0.3})
    S.track("bass", gain_db=-11.0, eq=[("hp", 34)], sat=1.1)
    S.track("horn", pan=0.0, gain_db=-4.5, reverb={"hall": 0.28, "plate": 0.08}, eq=[("hp", 120), ("peak", 3000, 1.0, -2.0), ("lp", 7500)])
    S.track("horn2", pan=-0.18, gain_db=-9.0, reverb={"hall": 0.28}, eq=[("hp", 100), ("lp", 6000)])
    S.track("horn3", pan=0.18, gain_db=-10.5, reverb={"hall": 0.28}, eq=[("hp", 70), ("lp", 5000)])
    S.track("brasspad", gain_db=-14.5, reverb={"hall": 0.35}, eq=[("hp", 110), ("lp", 5000)])
    S.track("strings", gain_db=-14.0, reverb={"hall": 0.4}, eq=[("hp", 80), ("lp", 5500)])
    S.track("flute", pan=0.1, gain_db=-9.5, reverb={"hall": 0.32, "plate": 0.1}, eq=[("hp", 250)])
    S.track("guzheng", pan=0.32, gain_db=-13.0, reverb={"plate": 0.22, "hall": 0.25}, eq=[("hp", 220)])
    S.track("bells", pan=0.2, gain_db=-10.0, reverb={"air": 0.5, "hall": 0.25}, eq=[("hp", 300)])
    S.track("fx", gain_db=-10.0, reverb={"air": 0.2}, eq=[("hp", 200)])
    # quiet-to-loud arc: everything starts ~13 dB down and swells into the arrival at beat 8
    arc = [(0, -13.0), (2, -11.0), (4, -8.0), (6, -5.0), (7.9, -2.5), (7.96, 0.0), (12, 0.0)]
    for nm in ("perc_low", "perc_hi", "horn", "horn2", "horn3", "flute", "guzheng", "bass", "brasspad", "strings"):
        S.automate(nm, arc)

    # ---- the climb: horns (lead, fifth below from beat 2, octave below from beat 4)
    for k, (text, v) in enumerate(CELLS):
        for n in parse_notes(text, k * 2.0, default_vel=v):
            d = n["dur"] * (0.96 if n["dur"] >= 0.5 else 0.85)
            S.note("horn", I.brass_note, n["beat"], n["midi"], d, v, attack=0.05 - 0.012 * k, release=0.12, vib_depth=9, bright=0.9 + 0.05 * k, jitter_ms=3.0)
            if k >= 1:
                S.note("horn2", I.brass_note, n["beat"], n["midi"] - 7, d, v * 0.9, attack=0.05, release=0.12, vib_depth=8, bright=0.85, jitter_ms=3.0)
            if k >= 2:
                S.note("horn3", I.brass_note, n["beat"], n["midi"] - 12, d, v * 0.9, attack=0.05, release=0.12, vib_depth=8, bright=0.8, jitter_ms=3.0)
    # flute shadows the last two cells an octave up
    for k in (2, 3):
        for n in parse_notes(CELLS[k][0], k * 2.0, default_vel=0.6):
            S.note("flute", I.flute, n["beat"], n["midi"] + 12, n["dur"] * 0.9, 0.55 + 0.08 * (k - 2), vib_depth=14, breath=0.26, attack=0.03, release=0.1, tone=1.1, jitter_ms=4.0)

    # ---- drums: soft 16th roll swelling over 8 beats, phrase accents on 2/4/6, shaker/rim pulse for the last bar
    roll(S, "perc_low", I.taiko, 0.0, 7.75, step=0.25, v0=0.16, v1=0.92, freq=73.4, size=0.9, tight=0.4)
    for b, v in ((2.0, 0.55), (4.0, 0.68), (6.0, 0.82)):
        S.hit("perc_low", I.taiko, b, v, freq=73.4, size=1.1, tight=0.1)
    for st in range(16):
        S.hit("perc_hi", I.rim_click, 4.0 + st * 0.25, 0.2 + 0.4 * st / 15)
    roll(S, "perc_hi", I.shaker, 6.0, 2.0, step=0.125, v0=0.25, v1=0.85)

    # ---- riser / reverse cymbal into the arrival
    S.note("fx", riser, 2.0, 146.8, 6.0, 0.9, f_to=10000.0, tonal=0.5)
    S.hit("fx", rev_cym, 5.0, 0.9, dur=1.5, variants=1)

    # ---- pads and bass: strings swell from the start, drone D
    S.chord("strings", [38, 45, 50, 54, 57], 0.0, 8.0, vel=0.7, kind="strings", attack=3.2, release=0.6, voices=5, spread=10.0, cutoff_open=2400, cutoff_closed=380)
    S.note("bass", I.sub_bass, 0.0, 38, 7.8, 0.5, attack=0.8, release=0.3, harm=0.4)

    # ---- shimmer before the hit
    for i, m in enumerate((74, 78, 81, 86)):
        S.note("bells", I.bell, 0.0 + i * 0.5, m + 12, 4.0, 0.25 + 0.06 * i, kind="glass")
    # ---- guzheng glissando up into the downbeat
    for nt in run(PENT_D, 2, 15, 6.4, 0.125, (0.45, 1.0)):
        S.note("guzheng", I.pluck, nt["beat"], nt["midi"], 2.0, nt["vel"], t60=1.8, bright=0.72, body="guzheng", pick=0.12, jitter_ms=1.5)

    # ---- ARRIVAL (beat 8): taiko + gong + crash, full open D major
    b = 8.0
    S.hit("perc_low", I.taiko, b, 1.0, freq=36.7, size=1.6, variants=1)
    S.hit("perc_low", I.taiko, b, 1.0, freq=73.4, size=1.3, rim=0.3, variants=1)
    S.note("gong", I.gong, b, 50, 8.0, 1.0)
    S.hit("cym", I.cymbal, b, 1.0, dur=3.6, size=1.25, variants=1)
    S.note("bells", I.bell, b, 50, 6.0, 0.8, kind="temple", gain=1.2)
    for i, m in enumerate(FINAL_CHORD):  # horns on the open chord
        tr = "horn" if i == 5 else "horn2" if i in (2, 3, 4) else "horn3"
        S.note(tr, I.brass_note, b, m, 4.3, 0.98 if i == 5 else 0.88, attack=0.03, release=0.9, vib_depth=10, bright=1.0, jitter_ms=2.0)
    S.chord("brasspad", FINAL_CHORD, b, 4.4, vel=0.9, kind="brass", attack=0.05, release=2.4, voices=5, spread=12.0, cutoff_open=3000, cutoff_closed=600)
    S.chord("strings", [38, 50, 57, 62, 66, 69, 74], b, 4.4, vel=0.85, kind="strings", attack=0.08, release=2.6, voices=5, spread=10.0, cutoff_open=3000, cutoff_closed=600)
    S.note("bass", I.sub_bass, b, 38, 4.3, 0.95, attack=0.01, release=0.9, harm=0.4)
    S.note("bass", I.sub_bass, b, 26, 4.3, 0.7, attack=0.01, release=0.9, harm=0.2)
    for i, m in enumerate(FINAL_CHORD):  # rolled guzheng chord
        S.note("guzheng", I.pluck, b + i * 0.07, m + 12 if i < 4 else m, 3.0, 0.95 - 0.04 * i, t60=3.0, bright=0.6, body="guzheng", pick=0.15, jitter_ms=1.0)
    S.note("flute", I.flute, b, 86, 4.3, 0.7, vib_depth=22, breath=0.26, attack=0.06, release=0.9, tone=1.1)
    # glass-bell shimmer: rising arpeggio, then sparkles
    for i, m in enumerate((86, 90, 93, 98, 93, 90)):
        S.note("bells", I.bell, b + 0.05 + i * 0.125, m, 4.0, 0.62 - 0.05 * i, kind="glass")
    for bt, m, v in ((9.0, 88, 0.45), (9.5, 93, 0.4), (10.0, 90, 0.4), (10.5, 86, 0.36), (11.0, 93, 0.32), (11.5, 98, 0.28)):
        S.note("bells", I.bell, bt, m, 3.5, v, kind="glass")
    # triumphant heartbeat afterwards, fading
    for bt, v in ((9.5, 0.5), (10.5, 0.4), (11.5, 0.3)):
        S.hit("perc_low", I.taiko, bt, v, freq=73.4, size=1.2, tight=0.1)
    return S

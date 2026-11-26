"""Defeat stinger -- "Kapanan Gözler" (Closing Eyes). E minor / phrygian lament, 84 BPM, 2 bars (5.7 s) + 2.2 s tail, one-shot.

Lament: the flute sighs down B4 - A4 - G4 - F#4 (parallel fifths over a cello bass E - D - C - B: the descending Andalusian bass), each note
arriving half a beat late as a suspension (B over D, A over C, G over B) and gliding down from the previous pitch (sigimsae).
A gong + low taiko open it, two more heartbeats slow down, a gayageum string falls out of tune, and the piece never resolves: it dies away
on a hollow B / F# fifth drone in a cave reverb.
"""
from __future__ import annotations

import numpy as np

from .. import dsp
from .. import instruments as I
from ..dsp import midi2hz
from ..music import Song

ID = "mus_defeat"
LOOP = False


def sigh_flute(freq, dur, vel=0.7, rng=None, fall=1.0, fall_start=0.6, release=0.35, **kw):
    """Daegeum-like flute whose pitch sags by `fall` semitones over the last part of the note (a sigh)."""
    n = dsp.nsamp(dur + release)
    u = np.clip((np.arange(n) / dsp.SR - fall_start * dur) / max(dur * (1 - fall_start) + release, 1e-3), 0.0, 1.0)
    curve = 2.0 ** (-fall * u ** 1.4 / 12.0)
    return I.flute(freq, dur, vel=vel, rng=rng, pitch_curve=curve, release=release, **kw)


def build() -> Song:
    S = Song("defeat", bpm=84, bars=2, tail=2.2, seed=558)
    S.master_comp = None  # keep the opening impact vs. the quiet lament intact
    S.track("perc_low", gain_db=-3.5, reverb={"cave": 0.28}, eq=[("hp", 36), ("lp", 8000)])
    S.track("gong", gain_db=-4.0, reverb={"cave": 0.3})
    S.track("flute", pan=0.06, gain_db=-8.0, reverb={"cave": 0.42, "plate": 0.08}, eq=[("hp", 180), ("lp", 8500)])
    S.track("cello", pan=-0.1, gain_db=-8.0, reverb={"cave": 0.3}, eq=[("hp", 70), ("lp", 3500)])
    S.track("pluck", pan=-0.25, gain_db=-9.5, reverb={"cave": 0.35, "plate": 0.1}, eq=[("hp", 110)])
    S.track("drone", gain_db=-12.0, reverb={"cave": 0.4}, eq=[("hp", 45), ("lp", 4000)])
    S.track("bass", gain_db=-13.0, eq=[("hp", 34)], sat=1.1)
    S.automate("drone", [(0, -8.0), (4, -3.0), (6, 0.0), (8.0, -4.0), (11.0, -40.0)])
    S.automate("cello", [(0, 0.0), (7.0, 0.0), (11.0, -24.0)])
    S.automate("bass", [(0, 0.0), (7.0, 0.0), (11.0, -30.0)])

    # ---- opening: gong + low taiko (heart beat 1), cello and drone swell underneath
    S.note("gong", I.gong, 0.0, 40, 9.0, 1.0)
    S.hit("perc_low", I.taiko, 0.0, 1.0, freq=55.0, size=1.5, variants=1)
    S.hit("perc_low", I.taiko, 0.0, 0.7, freq=41.2, size=1.8, variants=1)
    # ---- two more heartbeats, slowing down and fading
    S.hit("perc_low", I.taiko, 2.0, 0.62, freq=55.0, size=1.4, tight=0.1, variants=1)
    S.hit("perc_low", I.taiko, 4.4, 0.42, freq=55.0, size=1.4, tight=0.1, variants=1)

    # ---- cello lament bass: E D C B, each a bar-half long, overlapping
    for beat, m, v in ((0.0, 52, 0.62), (2.0, 50, 0.6), (4.0, 48, 0.58), (6.0, 47, 0.62)):
        S.note("cello", I.bowed, beat, m, 2.4 if beat < 6 else 4.4, v, kind="cello", attack=0.45, release=0.7, vib_depth=18, vib_rate=5.2, voices=2, jitter_ms=3.0)
    # ---- daegeum lament: B A G F# (suspensions: each arrives half a beat after the bass change, gliding down)
    notes = [(0.5, 71, 2.0, 0.55, None), (2.5, 69, 2.0, 0.6, 71), (4.5, 67, 2.0, 0.58, 69), (6.5, 66, 2.8, 0.55, 67)]
    for beat, m, d, v, prev in notes:
        S.note("flute", sigh_flute, beat, m, d, v, fall=0.9 if beat < 6 else 1.6, fall_start=0.55 if beat < 6 else 0.4,
               vib_depth=22, vib_delay=0.35, breath=0.4, buzz=0.3, attack=0.16, tone=0.95, scoop=0.6,
               glide_from=float(midi2hz(prev)) if prev else None, glide_t=0.3, jitter_ms=8.0)
    # ---- gayageum string falling out of tune (sigimsae bend, down)
    S.note("pluck", I.pluck, 2.0, 59, 4.0, 0.7, t60=3.2, bright=0.45, body="gayageum", bend=[(0.0, 0.0), (0.12, 0.0), (2.0, -3.0)], vib_depth=0)
    S.note("pluck", I.pluck, 4.5, 52, 4.0, 0.55, t60=3.6, bright=0.4, body="gayageum", bend=[(0.0, 0.0), (0.15, -0.2), (2.2, -4.0)], vib_depth=0)

    # ---- the unresolved drone: E fifth first, then a hollow B / F# fifth that fades out in the cave
    S.chord("drone", [40, 47, 52], 0.0, 5.0, vel=0.6, kind="dark", attack=1.2, release=1.8, voices=5, spread=12.0, cutoff_open=900, cutoff_closed=220)
    S.chord("drone", [35, 42, 47, 54], 5.0, 6.0, vel=0.7, kind="dark", attack=1.8, release=3.0, voices=5, spread=12.0, cutoff_open=1000, cutoff_closed=240)
    S.note("bass", I.sub_bass, 5.6, 35, 5.5, 0.55, attack=0.9, release=1.8, harm=0.3)
    return S

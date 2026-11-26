"""Combat SFX: melee swings/hits, ranged, player voice, enemy deaths/attacks."""
from __future__ import annotations

import numpy as np

from . import dsp
from . import instruments as I
from .dsp import SR, TAU, nsamp, tvec, rng_for
from .sfx_lib import (Canvas, click, env_exp, finalize, mono_room, noise_hit, punch, ring, sfx, thump, voice, whoosh, pentatonic_hz)


# =========================================================================== melee swings
@sfx("sfx_sword_swing_light", 3, level_db=-6, group="melee")
def sword_swing_light(v):
    r = rng_for("swl", v)
    f0, f1, d = [(620, 3400, 0.26), (820, 4300, 0.23), (540, 3000, 0.29)][v]
    c = Canvas(0.5)
    c.add(whoosh(r, d, f0, f1, q=1.7, peak=0.42, air=0.35), 0, 0.95)
    tp = d * 0.42
    c.add(ring([2350 * (1 + 0.06 * v), 3900, 6150], [0.08, 0.05, 0.03], 0.16, r, [1, 0.6, 0.35]), tp - 0.01, 0.10)
    c.add(noise_hit(r, 0.09, 5200, None, 0.022), tp - 0.02, 0.18)
    c.add(thump(150, 90, 0.18, 0.08, 0.06), tp, 0.18)
    return finalize(c.out())


@sfx("sfx_sword_swing_heavy", 2, level_db=-3, group="melee")
def sword_swing_heavy(v):
    r = rng_for("swh", v)
    f0, f1, d = [(230, 1800, 0.5), (280, 1500, 0.46)][v]
    c = Canvas(0.8)
    c.add(whoosh(r, d, f0, f1, q=1.15, peak=0.5, air=0.5, rise=1.9), 0, 1.0)
    c.add(thump(115, 52, 0.4, 0.14, 0.16, drive=1.3), d * 0.42, 0.55)
    c.add(noise_hit(r, 0.35, None, 700, 0.12, "pink"), d * 0.35, 0.6)
    c.add(ring([1900, 3300, 5200], [0.12, 0.08, 0.05], 0.2, r, [1, 0.6, 0.4]), d * 0.4, 0.08)
    return finalize(punch(c.out()))


@sfx("sfx_dagger", 2, level_db=-6, group="melee")
def dagger(v):
    r = rng_for("dag", v)
    c = Canvas(0.3)
    d = 0.13 + 0.02 * v
    c.add(whoosh(r, d, 1800, 7500, q=2.2, peak=0.5, air=0.3), 0, 0.85)
    c.add(click(r, 0.003, 3000), d * 0.5, 0.35)
    c.add(thump(260, 120, 0.1, 0.03, 0.05), d * 0.5, 0.3)
    c.add(ring([3400 + 400 * v, 5600], [0.06, 0.04], 0.1, r), d * 0.5, 0.08)
    return finalize(c.out())


# =========================================================================== hits
@sfx("sfx_hit_flesh", 3, level_db=-3, group="hit")
def hit_flesh(v):
    r = rng_for("hf", v)
    pitch = [1.0, 0.86, 1.18][v]
    n = nsamp(0.4)
    t = tvec(n)
    c = Canvas(0.4)
    c.add(click(r, 0.004, 2200), 0, 0.85)
    c.add(thump(200 * pitch, 72 * pitch, 0.25, 0.045, 0.1, drive=1.7), 0, 0.8)
    c.add(noise_hit(r, 0.25, 220, 1900, 0.07, "pink"), 0, 0.85)
    fc = 950 * pitch * (350 / 950) ** np.clip(t / 0.12, 0, 1)
    sq = dsp.sweep_filter(r.standard_normal(n), "bp", fc, 3.5, hop=16) * np.exp(-t / 0.05)
    c.add(sq, 0.004, 0.55)
    c.add(noise_hit(r, 0.06, 2800, 7500, 0.012), 0.002, 0.9)
    if v == 2:
        c.add(ring([2800, 4500], [0.05, 0.03], 0.08, r), 0.001, 0.08)  # blade edge on the sharper variant
    out = dsp.saturate(c.out() * 1.1, 1.2)
    return finalize(punch(out))


@sfx("sfx_hit_armor", 2, level_db=-3, group="hit")
def hit_armor(v):
    r = rng_for("ha", v)
    base = [1080, 930][v]
    c = Canvas(0.55)
    c.add(click(r, 0.003, 3500), 0, 0.5)
    c.add(ring([base, base * 2.76, base * 5.4, base * 8.93, base * 12.9], [0.28, 0.14, 0.08, 0.045, 0.025], 0.5, r, [1, 0.8, 0.5, 0.33, 0.2], split=1.5), 0, 0.55)
    c.add(thump(230, 100, 0.12, 0.03, 0.05, drive=1.4), 0, 0.8)
    c.add(noise_hit(r, 0.2, 2200, 6000, 0.04), 0.004, 0.35)
    return finalize(punch(c.out()))


@sfx("sfx_hit_stone", 2, level_db=-3, group="hit")
def hit_stone(v):
    r = rng_for("hs", v)
    base = [380, 310][v]
    c = Canvas(0.5)
    c.add(ring([base, base * 2.4, base * 4.3, base * 6.6], [0.07, 0.045, 0.03, 0.02], 0.25, r, [1, 0.7, 0.45, 0.3], glide=(1.05, 0.01)), 0, 1.4)
    c.add(thump(160, 62, 0.22, 0.03, 0.09, drive=1.8), 0, 0.55)
    c.add(click(r, 0.004, 1800), 0, 0.9)
    c.add(noise_hit(r, 0.18, 500, 2800, 0.05), 0, 0.9)
    c.add(dsp.crackle(nsamp(0.3), r, 90, 4.0) * np.exp(-tvec(nsamp(0.3)) / 0.1) * 0.8, 0.03, 0.6)
    return finalize(punch(dsp.saturate(c.out(), 1.2)))


@sfx("sfx_crit", 2, level_db=-1, group="hit")
def crit(v):
    r = rng_for("crit", v)
    c = Canvas(1.2)
    # flesh impact core
    c.add(click(r, 0.004, 2000), 0, 0.6)
    c.add(thump(220, 62, 0.35, 0.05, 0.16, drive=1.9), 0, 1.0)
    c.add(noise_hit(r, 0.2, 250, 2200, 0.06, "pink"), 0, 0.7)
    c.add(thump(70, 38, 0.5, 0.2, 0.25, drive=1.3), 0.01, 0.6)
    # bright "ting" (pentatonic fifth) + rising shing
    root = [88, 93][v]  # E6 / A6
    c.add(I.bell(float(dsp.midi2hz(root)), 0.9, 0.9, "glass", r), 0.012, 0.28)
    c.add(I.bell(float(dsp.midi2hz(root + 7)), 0.8, 0.8, "glass", r), 0.045, 0.2)
    c.add(whoosh(r, 0.16, 2500, 11000, q=2.5, peak=0.7, air=0.2), 0.0, 0.35)
    c.add(ring([2900, 4700, 7300], [0.14, 0.09, 0.06], 0.3, r, [1, 0.6, 0.4]), 0.0, 0.12)
    out = dsp.saturate(c.out(), 1.1)
    return finalize(mono_room(punch(out), "small", 0.18, tail=0.4))


# =========================================================================== ranged
@sfx("sfx_bow_shot", 2, level_db=-5, group="ranged")
def bow_shot(v):
    r = rng_for("bow", v)
    c = Canvas(0.5)
    c.add(click(r, 0.003, 1500, 6000, 0.0015), 0, 0.5)
    c.add(thump(190 + 20 * v, 95, 0.14, 0.02, 0.04, drive=1.3), 0, 0.7)
    c.add(ring([150 + 12 * v, 305, 470, 640], [0.14, 0.08, 0.05, 0.03], 0.3, r, [1, 0.7, 0.4, 0.25], glide=(1.1, 0.03)), 0, 0.6)
    c.add(noise_hit(r, 0.05, 900, 3500, 0.012), 0, 0.5)
    c.add(whoosh(r, 0.17, 3200, 9000, q=2.6, peak=0.25, air=0.1), 0.012, 0.28)
    return finalize(punch(c.out()))


@sfx("sfx_arrow_hit", 2, level_db=-4, group="ranged")
def arrow_hit(v):
    r = rng_for("arh", v)
    c = Canvas(0.45)
    c.add(ring([260 + 30 * v, 640, 1150, 1900], [0.06, 0.04, 0.03, 0.02], 0.15, r, [1, 0.7, 0.45, 0.3]), 0, 1.0)
    c.add(thump(200, 85, 0.12, 0.02, 0.05, drive=1.4), 0, 0.45)
    c.add(click(r, 0.003, 2000, None, 0.001), 0, 0.9)
    # shaft quiver
    n = nsamp(0.3)
    t = tvec(n)
    q = np.sin(TAU * np.cumsum(430 * (1 + 0.04 * np.exp(-t / 0.08))) / SR) * np.exp(-t / 0.09) * (1 + 0.6 * np.sin(TAU * 38 * t))
    c.add(q, 0.012, 0.16)
    c.add(noise_hit(r, 0.1, 1000, 4500, 0.02), 0, 0.4)
    return finalize(punch(c.out()))


# =========================================================================== player voice (formant synthesis)
def _hurt(v, female):
    r = rng_for("hurt_f" if female else "hurt_m", v)
    f0a, f0b = ((300, 220), (330, 250), (280, 200))[v] if female else ((150, 105), (170, 120), (135, 95))[v]
    vf, vt = [("uh", "o"), ("ae", "uh"), ("a", "o")][v]
    d = [0.26, 0.22, 0.3][v]
    c = Canvas(0.6)
    y = voice(r, d, f0a, f0b, vf, vt, breath=0.12, rasp=0.5, attack=0.006, decay_tau=0.11, formant_shift=1.17 if female else 1.0, tilt=3600 if female else 3000, peak_t=0.03)
    c.add(y, 0.012, 1.0)
    c.add(thump(170, 70, 0.14, 0.03, 0.06, drive=1.5), 0, 0.5)
    c.add(noise_hit(r, 0.05, 1500, 5000, 0.01), 0, 0.3)
    return finalize(punch(c.out()))


@sfx("sfx_player_hurt_m", 3, level_db=-3, group="player")
def hurt_m(v):
    return _hurt(v, False)


@sfx("sfx_player_hurt_f", 3, level_db=-3, group="player")
def hurt_f(v):
    return _hurt(v, True)


def _death(female):
    r = rng_for("death_f" if female else "death_m", 0)
    c = Canvas(1.8)
    y = voice(r, 0.95, 330 if female else 175, 150 if female else 62, "a", "u", breath=0.2, rasp=0.45, attack=0.01, f0_mid=270 if female else 150,
              formant_shift=1.17 if female else 1.0, vib_hz=6.0, vib_cents=18, peak_t=0.12, tilt=3300, glide_shape=0.8)
    c.add(y, 0.02, 1.0)
    c.add(voice(r, 0.5, 0.0 + (240 if female else 130), 90 if female else 55, "o", "u", breath=0.3, rasp=0.2, attack=0.05, peak_t=0.12), 0.55, 0.4)
    c.add(thump(150, 45, 0.5, 0.08, 0.25, drive=1.5), 0.0, 0.6)
    c.add(noise_hit(r, 0.8, None, 1200, 0.25, "brown"), 0.35, 0.35)  # body fall rumble
    c.add(thump(90, 40, 0.4, 0.06, 0.18, drive=1.5), 0.85, 0.5)  # hit the ground
    c.add(noise_hit(r, 0.15, 300, 2500, 0.04, "pink"), 0.85, 0.4)
    return finalize(mono_room(punch(c.out()), "small", 0.22, tail=0.5))


@sfx("sfx_player_death_m", 1, level_db=0, group="player")
def death_m(v):
    return _death(False)


@sfx("sfx_player_death_f", 1, level_db=0, group="player")
def death_f(v):
    return _death(True)


# =========================================================================== enemy death by race
@sfx("sfx_death_animal", 2, level_db=-4, group="death")
def death_animal(v):
    r = rng_for("dan", v)
    f0 = [620, 480][v]
    c = Canvas(0.6)
    y = voice(r, 0.36, f0, f0 * 0.45, "ae", "o", breath=0.15, rasp=0.5, attack=0.004, f0_mid=f0 * 1.4, glide_shape=0.6, vib_hz=18, vib_cents=40, peak_t=0.05, tilt=4200, shimmer=0.15)
    c.add(y, 0, 1.0)
    c.add(noise_hit(r, 0.1, 1500, 5000, 0.03), 0, 0.25)
    c.add(thump(130, 60, 0.2, 0.04, 0.09, drive=1.4), 0.25, 0.35)
    return finalize(punch(c.out()))


@sfx("sfx_death_orc", 2, level_db=-4, group="death")
def death_orc(v):
    r = rng_for("dor", v)
    f0 = [98, 82][v]
    c = Canvas(0.8)
    y = voice(r, 0.5, f0 * 1.15, f0 * 0.62, "a", "o", breath=0.18, rasp=0.9, attack=0.02, am_hz=36 + 6 * v, am_depth=0.45, peak_t=0.1, tilt=2700, formant_shift=0.88, bw_scale=1.3)
    c.add(y, 0.01, 1.0)
    c.add(thump(120, 45, 0.3, 0.05, 0.12, drive=1.5), 0.35, 0.7)
    c.add(noise_hit(r, 0.25, 200, 2000, 0.07, "pink"), 0.36, 0.5)
    return finalize(punch(c.out()))


@sfx("sfx_death_mystic", 1, level_db=-3, group="death")
def death_mystic(v):
    r = rng_for("dmy", v)
    c = Canvas(2.4)
    y = voice(r, 1.3, 520, 300, "o", "u", breath=0.35, rasp=0.0, attack=0.12, f0_mid=860, vib_hz=6.2, vib_cents=45, tilt=2600, glide_shape=0.9, peak_t=0.4, shimmer=0.02)
    c.add(y, 0, 0.9)
    c.add(voice(r, 1.2, 560, 330, "u", "o", breath=0.3, attack=0.15, f0_mid=905, vib_hz=5.6, vib_cents=40, tilt=2400, peak_t=0.4), 0.03, 0.7)  # chorus voice
    c.add(whoosh(r, 1.3, 400, 3500, q=1.0, peak=0.5, air=0.5, color="pink"), 0.1, 0.35)
    c.add(I.bell(1760, 1.0, 0.5, "glass", r), 0.9, 0.12)
    out = c.out()
    out = mono_room(out, "hall", 0.55, tail=1.2)
    return finalize(out)


@sfx("sfx_death_ice", 2, level_db=-4, group="death")
def death_ice(v):
    r = rng_for("dic", v)
    c = Canvas(1.0)
    c.add(click(r, 0.008, 1800, None, 0.003), 0, 0.9)
    c.add(noise_hit(r, 0.12, 2500, 9000, 0.025), 0, 0.6)
    c.add(ring([2300, 3150, 4700, 6900, 9100], [0.25, 0.18, 0.12, 0.09, 0.06], 0.45, r, [1, 0.8, 0.5, 0.35, 0.2], split=3), 0.004, 0.2)
    # tinkling shards
    for k in range(8 + 3 * v):
        tt = 0.04 + r.uniform(0, 0.45) ** 1.3
        c.add(ring([r.uniform(3200, 11000)], [r.uniform(0.04, 0.16)], 0.2, r), tt, r.uniform(0.04, 0.13))
    c.add(thump(140, 70, 0.2, 0.03, 0.08, drive=1.3), 0, 0.5)
    c.add(noise_hit(r, 0.3, 300, 1800, 0.08, "pink"), 0.02, 0.25)  # crunch
    return finalize(mono_room(punch(c.out()), "small", 0.2, tail=0.4))


@sfx("sfx_death_fire", 2, level_db=-4, group="death")
def death_fire(v):
    r = rng_for("dfi", v)
    c = Canvas(1.0)
    c.add(noise_hit(r, 0.7, 2200, None, 0.18, "white"), 0, 0.4)
    c.add(noise_hit(r, 0.4, 800, 3500, 0.12, "pink"), 0, 0.5)
    c.add(thump(100, 50, 0.3, 0.06, 0.1, drive=1.3), 0, 0.6)
    n = nsamp(0.6)
    cr = dsp.hp(dsp.crackle(n, r, 110 + 40 * v, 2.5), 900) * np.exp(-tvec(n) / 0.25)
    c.add(cr, 0.02, 0.5)
    c.add(whoosh(r, 0.5, 400, 2600, q=1.1, peak=0.2, air=0.3), 0, 0.35)
    return finalize(punch(c.out()))


@sfx("sfx_death_golem", 2, level_db=-2, group="death")
def death_golem(v):
    r = rng_for("dgo", v)
    c = Canvas(1.6)
    c.add(thump(95, 36, 0.8, 0.12, 0.3, drive=1.6), 0, 1.0)
    c.add(noise_hit(r, 1.1, None, 280, 0.35, "brown"), 0, 0.9)
    c.add(noise_hit(r, 0.3, 300, 3000, 0.07, "pink"), 0, 0.5)
    # falling stones: random knocks with decreasing density
    for k in range(13):
        tt = 0.08 + (r.uniform(0, 1) ** 1.8) * 0.95
        f = r.uniform(140, 620)
        c.add(ring([f, f * 2.3, f * 4.1], [0.06, 0.035, 0.02], 0.15, r, [1, 0.6, 0.3], glide=(1.04, 0.008)) , tt, r.uniform(0.15, 0.5) * (1 - tt * 0.5))
    n = nsamp(1.0)
    c.add(dsp.hp(dsp.crackle(n, r, 120, 5.0), 400) * np.exp(-tvec(n) / 0.35), 0.05, 0.45)
    return finalize(mono_room(punch(c.out()), "small", 0.25, tail=0.7))


@sfx("sfx_death_undead", 2, level_db=-4, group="death")
def death_undead(v):
    r = rng_for("dud", v)
    c = Canvas(0.9)
    for k in range(10):
        tt = (r.uniform(0, 1) ** 1.3) * 0.55
        c.add(I.moktak(0.5 + 0.4 * r.uniform(), 1.15 + 0.7 * r.uniform(), r), tt, r.uniform(0.2, 0.6))
    c.add(thump(130, 60, 0.2, 0.03, 0.09, drive=1.4), 0, 0.5)
    c.add(noise_hit(r, 0.4, 1500, 5000, 0.08), 0, 0.2)
    return finalize(punch(c.out()))


@sfx("sfx_death_generic", 2, level_db=-7, group="death")
def death_generic(v):
    r = rng_for("dge", v)
    c = Canvas(0.5)
    c.add(thump(160 - 20 * v, 55, 0.22, 0.04, 0.08, drive=1.3), 0, 0.8)
    c.add(noise_hit(r, 0.22, 500, 3000, 0.05, "pink"), 0, 0.6)
    c.add(whoosh(r, 0.25, 1200, 400, q=1.0, peak=0.15, air=0.2), 0, 0.3)
    return finalize(c.out())


# =========================================================================== enemy attacks
@sfx("sfx_enemy_swipe", 2, level_db=-7, group="enemy")
def enemy_swipe(v):
    r = rng_for("esw", v)
    c = Canvas(0.4)
    c.add(whoosh(r, 0.15, 900, 4200, q=1.6, peak=0.4, air=0.35), 0, 0.8)
    c.add(whoosh(r, 0.11, 1300, 5200, q=1.8, peak=0.4, air=0.3), 0.09 + 0.02 * v, 0.55)  # second claw
    c.add(noise_hit(r, 0.05, 3500, None, 0.01), 0.04, 0.2)
    return finalize(c.out())


@sfx("sfx_enemy_bite", 2, level_db=-6, group="enemy")
def enemy_bite(v):
    r = rng_for("ebi", v)
    c = Canvas(0.35)
    c.add(noise_hit(r, 0.04, 1200, 5000, 0.01), 0, 0.8)
    c.add(noise_hit(r, 0.05, 800, 4000, 0.012), 0.07, 0.8)  # snap-snap
    c.add(ring([420 + 40 * v, 980, 1700], [0.04, 0.03, 0.02], 0.1, r), 0, 0.3)
    c.add(ring([420 + 40 * v, 980, 1700], [0.04, 0.03, 0.02], 0.1, r), 0.07, 0.3)
    c.add(thump(160, 80, 0.1, 0.02, 0.04), 0.07, 0.4)
    c.add(whoosh(r, 0.1, 600, 2400, q=1.4, peak=0.3, air=0.2), 0, 0.2)
    return finalize(c.out())


@sfx("sfx_enemy_whoosh_heavy", 2, level_db=-5, group="enemy")
def enemy_whoosh_heavy(v):
    r = rng_for("ewh", v)
    d = 0.5 + 0.06 * v
    c = Canvas(0.9)
    c.add(whoosh(r, d, 160, 1100, q=1.1, peak=0.5, air=0.55, rise=2.0), 0, 1.0)
    c.add(thump(90, 48, 0.35, 0.12, 0.14, drive=1.3), d * 0.45, 0.55)
    c.add(noise_hit(r, 0.3, None, 500, 0.1, "pink"), d * 0.4, 0.5)
    return finalize(punch(c.out()))


@sfx("sfx_enemy_magic_cast", 2, level_db=-6, group="enemy")
def enemy_magic_cast(v):
    r = rng_for("emc", v)
    c = Canvas(0.7)
    n = nsamp(0.45)
    t = tvec(n)
    f = 300 * (2.2 + 0.4 * v) ** (t / 0.45) * (1 + 0.02 * np.sin(TAU * 18 * t))
    tone = dsp.fm(f, 1.5, 1.8 * np.exp(-t / 0.25), n) * dsp.env([(0, 0), (0.3, 1, 1.5), (0.45, 0, 1)], n)
    c.add(tone, 0, 0.5)
    c.add(whoosh(r, 0.4, 500, 3500, q=2.0, peak=0.7, air=0.2), 0, 0.5)
    c.add(ring([880, 1320, 1760], [0.25, 0.2, 0.15], 0.4, r, split=2), 0.4, 0.15)
    return finalize(mono_room(c.out(), "small", 0.2, tail=0.3))


@sfx("sfx_enemy_slam", 1, level_db=-2, group="enemy")
def enemy_slam(v):
    r = rng_for("esl", v)
    c = Canvas(1.0)
    c.add(thump(105, 38, 0.6, 0.1, 0.22, drive=1.7), 0, 0.8)
    c.add(noise_hit(r, 0.5, 120, 1500, 0.15, "pink"), 0, 0.9)
    c.add(click(r, 0.005, 1200), 0, 0.7)
    c.add(dsp.hp(dsp.crackle(nsamp(0.5), r, 80, 4.0), 500) * np.exp(-tvec(nsamp(0.5)) / 0.15), 0.03, 0.7)
    return finalize(punch(c.out()))


@sfx("sfx_telegraph", 1, level_db=-8, group="enemy")
def telegraph(v):
    r = rng_for("tel", v)
    n = nsamp(0.55)
    t = tvec(n)
    f = 170 * 1.5 ** (t / 0.55)
    tone = dsp.fm(f, 2.0, 0.8, n) * (0.5 + 0.5 * np.sin(TAU * 12 * t * (1 + t))) * dsp.env([(0, 0), (0.08, 1), (0.45, 0.8), (0.55, 0)], n)
    c = Canvas(0.6)
    c.add(dsp.lp(tone, 1800), 0, 0.8)
    c.add(whoosh(r, 0.5, 300, 1200, q=1.5, peak=0.8, air=0.2), 0, 0.25)
    return finalize(c.out())

"""UI SFX: lacquered-wood ticks, soft metal chimes, plucked confirmations, card sounds."""
from __future__ import annotations

import numpy as np

from . import dsp
from . import instruments as I
from .dsp import SR, TAU, nsamp, tvec, rng_for
from .sfx_lib import (Canvas, click, env_exp, finalize, mono_room, noise_hit, punch, ring, sfx, thump, whoosh, pentatonic_hz)


@sfx("sfx_ui_click", 3, level_db=-9, group="ui")
def ui_click(v):
    r = rng_for("uic", v)
    p = [1.0, 1.06, 0.94][v]
    c = Canvas(0.2)
    c.add(ring([1550 * p, 2780 * p, 4300 * p], [0.05, 0.03, 0.02], 0.1, r, [1, 0.6, 0.3], glide=(1.04, 0.008)), 0, 0.7)
    c.add(thump(330 * p, 170 * p, 0.06, 0.01, 0.025), 0, 0.55)
    c.add(noise_hit(r, 0.015, 2500, 8000, 0.004), 0, 0.3)
    return finalize(c.out())


@sfx("sfx_ui_hover", 2, level_db=-16, group="ui")
def ui_hover(v):
    r = rng_for("uih", v)
    p = [1.0, 1.12][v]
    c = Canvas(0.12)
    c.add(ring([2350 * p, 3520 * p], [0.035, 0.02], 0.08, r, [1, 0.5]), 0, 0.6)
    c.add(noise_hit(r, 0.02, 3500, 9000, 0.005), 0, 0.2)
    return finalize(c.out())


@sfx("sfx_ui_open", 1, level_db=-9, group="ui")
def ui_open(v):
    r = rng_for("uio", v)
    c = Canvas(0.7)
    c.add(whoosh(r, 0.22, 500, 3800, q=1.5, peak=0.55, air=0.3), 0, 0.5)
    c.add(I.pluck(float(dsp.midi2hz(79)), 0.45, vel=0.7, t60=0.5, body="harp", rng=r, bright=0.6), 0.07, 0.5)
    c.add(I.pluck(float(dsp.midi2hz(86)), 0.45, vel=0.6, t60=0.5, body="harp", rng=r, bright=0.6), 0.13, 0.4)
    c.add(thump(220, 130, 0.12, 0.03, 0.05), 0.04, 0.3)
    return finalize(mono_room(c.out(), "small", 0.12, tail=0.2))


@sfx("sfx_ui_close", 1, level_db=-10, group="ui")
def ui_close(v):
    r = rng_for("uicl", v)
    c = Canvas(0.5)
    c.add(whoosh(r, 0.18, 3200, 500, q=1.5, peak=0.4, air=0.3, shape=0.9), 0, 0.45)
    c.add(I.pluck(float(dsp.midi2hz(74)), 0.35, vel=0.6, t60=0.4, body="harp", rng=r, bright=0.5), 0.05, 0.45)
    c.add(thump(200, 110, 0.1, 0.03, 0.04), 0.03, 0.3)
    return finalize(mono_room(c.out(), "small", 0.1, tail=0.15))


@sfx("sfx_ui_confirm", 1, level_db=-7, group="ui")
def ui_confirm(v):
    r = rng_for("uicf", v)
    c = Canvas(0.8)
    c.add(I.pluck(float(dsp.midi2hz(79)), 0.5, vel=0.8, t60=0.7, body="harp", rng=r, bright=0.65), 0.0, 0.6)
    c.add(I.pluck(float(dsp.midi2hz(86)), 0.6, vel=0.85, t60=0.9, body="harp", rng=r, bright=0.7), 0.075, 0.6)
    c.add(I.bell(float(dsp.midi2hz(91)), 0.7, 0.6, "glass", r), 0.075, 0.18)
    c.add(ring([1550, 2780], [0.04, 0.02], 0.08, r), 0, 0.3)
    c.add(thump(250, 130, 0.08, 0.02, 0.03), 0, 0.3)
    return finalize(mono_room(c.out(), "small", 0.14, tail=0.3))


@sfx("sfx_ui_back", 1, level_db=-10, group="ui")
def ui_back(v):
    r = rng_for("uibk", v)
    c = Canvas(0.5)
    c.add(I.pluck(float(dsp.midi2hz(81)), 0.3, vel=0.7, t60=0.5, body="harp", rng=r, bright=0.55), 0.0, 0.5)
    c.add(I.pluck(float(dsp.midi2hz(74)), 0.4, vel=0.7, t60=0.6, body="harp", rng=r, bright=0.55), 0.07, 0.5)
    c.add(ring([1250, 2200], [0.04, 0.02], 0.08, r), 0, 0.3)
    return finalize(mono_room(c.out(), "small", 0.1, tail=0.2))


@sfx("sfx_ui_error", 1, level_db=-7, group="ui")
def ui_error(v):
    r = rng_for("uie", v)
    c = Canvas(0.5)
    for k in range(2):
        t0 = 0.11 * k
        n = nsamp(0.13)
        t = tvec(n)
        buz = dsp.lp(dsp.osc("square", 118 - 14 * k, n), 700) * np.exp(-t / 0.07)
        c.add(dsp.lp(dsp.osc("square", 190 - 20 * k, n), 1600) * np.exp(-t / 0.07), t0, 0.5)
        c.add(buz, t0, 0.35)
        c.add(thump(160 - 20 * k, 85, 0.12, 0.02, 0.05, drive=1.3), t0, 0.45)
        c.add(ring([310 - 30 * k, 520, 880], [0.05, 0.03, 0.02], 0.1, r), t0, 0.5)
    return finalize(c.out())


@sfx("sfx_ui_tab", 2, level_db=-13, group="ui")
def ui_tab(v):
    r = rng_for("uit", v)
    p = [1.0, 1.08][v]
    c = Canvas(0.2)
    c.add(ring([1900 * p, 3100 * p], [0.04, 0.025], 0.1, r, [1, 0.5]), 0, 0.6)
    c.add(whoosh(r, 0.08, 1200, 3500, q=1.8, peak=0.3, air=0.2), 0, 0.2)
    c.add(thump(300, 170, 0.05, 0.01, 0.02), 0, 0.3)
    return finalize(c.out())


@sfx("sfx_ui_toggle_on", 1, level_db=-11, group="ui")
def ui_toggle_on(v):
    r = rng_for("uton", v)
    c = Canvas(0.25)
    c.add(ring([1550, 2780], [0.04, 0.025], 0.1, r), 0, 0.5)
    c.add(I.bell(float(dsp.midi2hz(91)), 0.2, 0.6, "chime", r), 0.025, 0.3)
    return finalize(c.out())


@sfx("sfx_ui_toggle_off", 1, level_db=-12, group="ui")
def ui_toggle_off(v):
    r = rng_for("utof", v)
    c = Canvas(0.25)
    c.add(ring([1250, 2250], [0.04, 0.025], 0.1, r), 0, 0.5)
    c.add(I.bell(float(dsp.midi2hz(79)), 0.2, 0.5, "chime", r), 0.025, 0.25)
    return finalize(c.out())


@sfx("sfx_ui_equip", 2, level_db=-7, group="ui")
def ui_equip(v):
    r = rng_for("ueq", v)
    c = Canvas(0.6)
    c.add(ring([2100, 2100 * 2.76, 2100 * 5.4], [0.12, 0.06, 0.03], 0.25, r, [1, 0.6, 0.3]), 0, 0.4)
    c.add(noise_hit(r, 0.12, 600, 3500, 0.03, "pink"), 0, 0.5)  # leather / cloth
    c.add(thump(180, 90, 0.12, 0.03, 0.05, drive=1.3), 0, 0.5)
    c.add(click(r, 0.004, 2500), 0, 0.4)
    return finalize(mono_room(c.out(), "small", 0.12, tail=0.2))


@sfx("sfx_ui_purchase", 1, level_db=-7, group="ui")
def ui_purchase(v):
    r = rng_for("upu", v)
    c = Canvas(0.9)
    for k, (dt, p) in enumerate([(0.0, 1.0), (0.06, 1.09), (0.12, 0.94)]):
        base = 3200 * p
        c.add(ring([base, base * 1.51, base * 2.37], [0.18, 0.12, 0.08], 0.35, r, [1, 0.6, 0.4], split=2), dt, 0.5)
        c.add(click(r, 0.003, 4000, None, 0.0012), dt, 0.3)
    c.add(I.pluck(float(dsp.midi2hz(86)), 0.5, vel=0.8, t60=0.7, body="harp", rng=r, bright=0.7), 0.2, 0.4)
    return finalize(mono_room(c.out(), "small", 0.14, tail=0.3))


@sfx("sfx_ui_unlock", 1, level_db=-4, group="ui")
def ui_unlock(v):
    r = rng_for("uun", v)
    c = Canvas(2.0)
    c.add(I.gong(196, 2.0, 0.8, r, wash=0.4), 0, 0.4)
    c.add(thump(110, 50, 0.4, 0.08, 0.16, drive=1.3), 0, 0.5)
    for k, hz in enumerate(pentatonic_hz(72, [0, 2, 4, 5, 7, 9])):
        c.add(I.bell(hz, 1.3, 0.8, "glass", r), 0.1 + 0.07 * k, 0.35)
    c.add(whoosh(r, 0.45, 800, 9000, q=2.0, peak=0.9, air=0.2), 0.0, 0.3)
    return finalize(mono_room(punch(c.out()), "hall", 0.28, tail=0.9))


# =========================================================================== cards (level-up / essence)
@sfx("sfx_card_hover", 2, level_db=-12, group="card")
def card_hover(v):
    r = rng_for("cdh", v)
    p = [1.0, 1.1][v]
    c = Canvas(0.2)
    c.add(whoosh(r, 0.09, 1500, 4500, q=1.6, peak=0.5, air=0.2), 0, 0.35)  # lacquered card slide
    c.add(ring([2600 * p, 3900 * p], [0.05, 0.03], 0.12, r, [1, 0.5]), 0.02, 0.4)
    c.add(I.bell(float(dsp.midi2hz(88 + 2 * v)), 0.2, 0.5, "chime", r), 0.02, 0.18)
    return finalize(c.out())


@sfx("sfx_card_pick", 1, level_db=-3, group="card")
def card_pick(v):
    r = rng_for("cdp", v)
    c = Canvas(1.4)
    c.add(thump(240, 100, 0.22, 0.03, 0.09, drive=1.6), 0, 0.9)  # wooden stamp
    c.add(I.moktak(0.9, 0.55, r), 0, 0.8)
    c.add(click(r, 0.004, 1800, None, 0.002), 0, 0.5)
    c.add(whoosh(r, 0.2, 1500, 9000, q=2.0, peak=0.7, air=0.2), 0.02, 0.3)
    for k, hz in enumerate(pentatonic_hz(79, [0, 2, 4])):
        c.add(I.bell(hz, 1.0, 0.85, "glass", r, 0.9), 0.04 + 0.05 * k, 0.4)
    c.add(dsp.bp(dsp.crackle(nsamp(0.6), r, 80, 1.0), 7000, 2.0) * np.exp(-tvec(nsamp(0.6)) / 0.25), 0.1, 0.25)
    return finalize(mono_room(punch(c.out()), "small", 0.22, tail=0.6))


@sfx("sfx_card_reroll", 1, level_db=-5, group="card")
def card_reroll(v):
    r = rng_for("cdr", v)
    c = Canvas(1.0)
    # card shuffle flaps accelerating
    t0 = 0.0
    gap = 0.075
    for k in range(9):
        c.add(noise_hit(r, 0.035, 1800, 7500, 0.009), t0, 0.5 + 0.2 * r.uniform())
        c.add(I.rim_click(0.4, 0.8 + 0.5 * r.uniform(), r), t0 + 0.004, 0.18)
        t0 += gap
        gap *= 0.88
    c.add(whoosh(r, 0.5, 600, 5200, q=1.8, peak=0.7, air=0.2), 0.0, 0.25)
    c.add(I.bell(float(dsp.midi2hz(86)), 0.6, 0.7, "glass", r), 0.55, 0.35)
    c.add(I.bell(float(dsp.midi2hz(91)), 0.8, 0.7, "glass", r), 0.62, 0.35)
    return finalize(mono_room(c.out(), "small", 0.16, tail=0.4))


@sfx("sfx_card_banish", 1, level_db=-5, group="card")
def card_banish(v):
    r = rng_for("cdb", v)
    c = Canvas(1.0)
    n = nsamp(0.7)
    t = tvec(n)
    c.add(dsp.butter_hp(dsp.pink(n, r), 500, 2) * dsp.env([(0, 0), (0.06, 1), (0.7, 0, 1.4)], n), 0, 0.35)
    c.add(dsp.hp(dsp.crackle(n, r, 150, 2.0), 1000) * np.exp(-t / 0.25), 0.02, 0.5)
    c.add(whoosh(r, 0.4, 3500, 400, q=1.5, peak=0.2, air=0.3, shape=0.9), 0.0, 0.4)
    c.add(thump(150, 60, 0.25, 0.05, 0.1, drive=1.3), 0.0, 0.5)
    c.add(I.bell(float(dsp.midi2hz(67)), 0.6, 0.5, "chime", r), 0.1, 0.12)
    return finalize(mono_room(c.out(), "small", 0.12, tail=0.2))

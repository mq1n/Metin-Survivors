// Player feedback FxSpecs (common VFX target `player-feedback`; owner: the player-feedback builder). r1 2026-10-19 rebuilt hit.player /
// player.evade / player.shield as data on shipped sprites; r2 2026-10-20 (this file) answers the blind critic of r1: pale additive
// layers vanished on snow (every body gets an ALPHA-blended saturated twin), the hit was one coral sunburst for every element (now one
// sprite family per element), the evade's ghost was a small puff and the shield a knee-high saucer (both are body-height SCREEN
// billboards now: an upright card is foreshortened to half its height by the game camera, a screen card keeps its full size).


//
// Frame: +Z = the blow direction (SpawnOpts.dirX/dirZ = away from the attacker), -Z therefore faces the attacker. The route spawns
// at the hero chest (ground + 1.0 m), so `lift` is 0 and ground elements sit at y = -1.0. Everything is `follow: true` (the
// hero keeps moving during the 0.3-0.5 s) and ground-anchored / body-height, one hero shape per event, saturated colour.
// Ground clipping rule used throughout: a SCREEN quad of half height hh centred at chest + y never dips under the floor when
// 1.0 + y >= 0.55 * hh (the camera looks down at ~60 deg), an UPRIGHT quad needs 1.0 + y >= hh.
import type { ArtTex, ColorCurve, FxSpec, ParticleSpec } from '../../spec/types';
import {
  ART_BALL,
  ART_CROUCH,
  ART_SPIKEEGG,
  ART_BAND,
  ART_DUST,
  ART_FLAREORB,
  ART_GLINT,
  ART_HIT_BOLT,
  ART_HIT_FLAME,
  ART_HIT_HOLY,
  ART_HIT_ICE,
  ART_HIT_INK,
  ART_HIT_TOXIC,
  ART_HIT_TWIRL,
  ART_HITSLASH,
  ART_PIP,
  ART_RAYSTAR,
  ART_SMOKEBALL,
  ART_ORB,
  ART_PUFF,
  ART_RIMDISC,
  ART_SLASH,
  ART_SPARK,
  ART_WIND,
} from './art';

type Base = Pick<ParticleSpec, 'note' | 'life' | 'half' | 'color' | 'tex' | 'blend'> & Partial<Omit<ParticleSpec, 'kind'>>;

/** one-shot burst element: a single sprite born at t0 (rate spike + max), screen-facing unless overridden */
export function burst(b: Base): ParticleSpec {
  return { kind: 'particle', cycle: 0.05, max: 1, rate: [0, 60], billboard: 'screen', ...b };
}

/** ground-lying sprite born once (the floor footprint of an event) */
function flat(b: Omit<Base, 'billboard'>): ParticleSpec {
  return burst({ ...b, billboard: 'ground', attach: b.attach ?? true });
}

/** `n` thin streaks thrown along the blow (stretch billboards) */
function streaks(note: string, n: number, speed: number, color: ColorCurve, life = 0.24, half = 0.26): ParticleSpec {
  return burst({
    note,
    cycle: 0.08,
    max: n,
    rate: [0, 1400],
    life: [0, life],
    shape: { kind: 'sphere', radius: 0.14 },
    at: [0, 0.1, -0.5],
    dir: { z: [0, 1] },
    jitter: [0.0014, 0.0009, 0.0014],
    vel: [0, speed],
    half: [0, half],
    scale: [[0, 0.24, 1, 0.1], [0, 1.6, 1, 0.9]],
    color,
    air: [0, 0.12],
    billboard: 'stretch',
    blend: 'add',
    bright: 1.5,
    clamp: 1.2,
    tex: 'streakSoft',
  });
}

// ---------------------------------------------------------------------------------------------------------- hit.player

// streaks) + red digits. Ours keeps that blow vocabulary but (a) one SPRITE FAMILY PER ELEMENT (the hits target's vfx_hit_* set), (b)
// every colour is also drawn as an ALPHA body (a saturated, darker twin: additive red / blue / green goes pale on snow), (c) a floor
// flare under the blow so the event is ground-anchored, (d) the hero model itself is flashed by render/hero.ts (rim), never a sprite.

/** half size (m) of the impact-star card: the sprite's rays reach ~42 % of the card width each way, so 1.9 m gives a ~2.4 m star at chest height (r3 first
 *  pass: half 1.5 measured 1.8 m wide at the game camera, the critic asked for ~2.5 m) */
const STAR_HALF = 1.9;

interface HitLook {
  id: string;
  desc: string;
  elem: string;
  /** the element's main sprite (additive hot) + its size and colour keys */
  main: { tex: ArtTex; half: number; color: ColorCurve; bright?: number; rot?: readonly [number, number] };
  /** the alpha twin of the main sprite: the saturated darker body */
  body: { tex: ArtTex; half: number; color: ColorCurve };
  /** hot core puff under the main sprite */
  core: ColorCurve;
  /** streak sparks along the blow, floor flare, embers */
  streak: ColorCurve;
  flare: ColorCurve;
  ember: { color: ColorCurve; gravity: number; rise: number; n: number };
  /** extra element-specific elements */
  extra: ParticleSpec[];
}

/** the same colour curve with every alpha multiplied by k */
function alphaScaled(c: ColorCurve, k: number): number[] {
  return c.map((v, i) => (i % 3 === 2 ? Math.min(1, v * k) : v));
}

function hitSpec(l: HitLook): FxSpec {
  return {
    id: l.id,
    desc: l.desc,
    behavior: 'selfBuff',
    ref: {},
    size: 'radius',
    base: 1,
    dur: 0.5,
    lift: 0,
    follow: true,
    elements: [
      burst({
        note: `${l.elem} ray star, alpha twin (r3): the same crisp rays as a saturated DARK body under the light, so the star keeps its shape and hue on snow / pale stone where additive rays only add white`,
        life: [0, 0.3],
        at: [0, 0.12, -0.7],
        half: [0, STAR_HALF],
        scale: [0, 0.3, 0.16, 0.95, 1, 1.12],
        color: alphaScaled(l.body.color, 0.9),
        rotation: { start: [0, 360], spin: 26, randomDir: true },
        blend: 'alpha',
        attach: true,
        tex: ART_RAYSTAR,
      }),
      burst({
        note: `${l.elem} IMPACT STAR (r3, the one hero shape of the hit): crisp fine-ray sunburst. vfx_player_feedback_ray_star: a hard white-hot core and about 36 sharp rays, ~2.6 m wide at chest height on the side that was struck, pops in 0.05 s and fades by 0.26 s`,
        life: [0, 0.3],
        at: [0, 0.12, -0.7],
        half: [0, STAR_HALF],
        scale: [0, 0.3, 0.16, 0.95, 1, 1.12],
        color: l.core,
        bright: 1.7,
        clamp: 1.1,
        occlude: 0.5,
        rotation: { start: [0, 360], spin: 26, randomDir: true },
        blend: 'add',
        attach: true,
        tex: ART_RAYSTAR,
      }),
      burst({
        note: 'the hard core: a small four-point flare, hot white-yellow for the first 0.06 s (a spark, not a wash: half 0.42 m)',
        life: [0, 0.11],
        at: [0, 0.12, -0.7],
        half: [0, 0.42],
        scale: [0, 0.5, 0.3, 1, 1, 0.8],
        color: [0, 0xfffff0, 1, 0.5, 0xffd890, 0.8, 1, 0xff6a30, 0],
        blend: 'add',
        bright: 1.3,
        clamp: 1.1,
        attach: true,
        tex: ART_FLAREORB,
      }),
      burst({
        note: `${l.elem} smoke body (alpha): the SECONDARY layer of r3, a small saturated lumpy cloud (half ${(l.body.half * 0.28).toFixed(2)} m) under the star that keeps the element hue on snow`,
        life: [0, 0.32],
        at: [0, 0.02, -0.62],
        half: [0, l.body.half * 0.28],
        scale: [0, 0.55, 0.3, 1, 1, 1.15],
        color: alphaScaled(l.body.color, 0.8),
        rotation: { start: [0, 360], spin: 30, randomDir: true },
        blend: 'alpha',
        attach: true,
        tex: ART_SMOKEBALL,
      }),
      burst({
        note: `element sprite (${l.elem}), secondary: the material of the blow (flame / ice / ink ...) in additive light, smaller than the star (half ${(l.main.half * 0.62).toFixed(2)} m) and shorter-lived`,
        life: [0, 0.22],
        at: [0, 0.05, -0.64],
        half: [0, l.main.half * 0.62],
        scale: [0, 0.45, 0.3, 0.92, 1, 1.0],
        color: l.main.color,
        rotation: { start: l.main.rot ?? [0, 360] },
        blend: 'add',
        bright: l.main.bright ?? 1.5,
        clamp: 1,
        occlude: 0.45,
        attach: true,
        tex: l.main.tex,
      }),
      flat({
        note: 'floor flare under the blow: a short radial spike flash on the ground (the event is ground-anchored, readable from above)',
        life: [0, 0.26],
        at: [0, -0.97, -0.55],
        half: [0, 0.95],
        scale: [0, 0.4, 0.3, 0.9, 1, 1.05],
        color: l.flare,
        rotation: { start: [0, 360] },
        blend: 'add',
        clamp: 1,
        tex: { art: 'vfx_rayring_ground_burst_a', fallback: 'raysSoft' },
      }),
      ...l.extra,
      streaks('half_ring_rainbow_line -> streakSoft (stretch): sparks thrown along the blow direction', 7, 8.5, l.streak),
      burst({
        note: 'embers / flecks flung off the hit',
        cycle: 0.08,
        max: l.ember.n,
        rate: [0, 800],
        life: [0, 0.42],
        shape: { kind: 'sphere', radius: 0.12 },
        at: [0, 0, -0.5],
        dir: { y: [0, l.ember.rise], z: [0, 0.7] },
        jitter: [0.001, 0.0006, 0.001],
        vel: [0, 2.6],
        gravity: [0, l.ember.gravity],
        half: [0, 0.075],
        scale: [0, 1, 1, 0.5],
        color: l.ember.color,
        air: [0, 0.03],
        rotation: { start: [0, 360], spin: 200, randomDir: true },
        blend: 'add',
        clamp: 1.2,
        tex: 'ember',
      }),
    ],
  };
}

/** physical: the ray star + a secondary set of three tapered streaks crossing the struck side (click yy / up). r3 dropped the thick crescent pair:
 *  it was a second soft shape the size of the star's cloud, and the critic read the hit as a blob on one flank. */
const PHYS_SLASH: ParticleSpec[] = [
  burst({
    note: 'click yy / up: three tapered streaks with flying sparks, white-hot at the start, crossing under the star (secondary, half 1.3 m)',
    life: [0, 0.2],
    at: [0, 0.2, -0.55],
    half: [0, 1.3],
    scale: [0, 0.55, 0.25, 1, 1, 1.12],
    color: [0, 0xffe0c0, 0.9, 0.3, 0xff5a34, 0.8, 1, 0xa01018, 0],
    blend: 'add',
    bright: 1.3,
    clamp: 1.1,
    attach: true,
    tex: ART_HITSLASH,
  }),
];

export const HIT_PLAYER: FxSpec = hitSpec({
  id: 'hit.player',
  elem: 'physical',
  desc: 'Player damaged (physical): a crisp fine-ray impact star (hard hot core, ~2.6 m wide at chest height) on the side that was hit with a small crimson cloud and a streak fan as secondary layers, a dark alpha twin of the rays (keeps its hue on snow), a floor flare, streak sparks along the blow, embers. dir = blow direction (away from the attacker).',
  main: { tex: ART_SPARK, half: 1.25, color: [0, 0xff5a38, 1, 0.45, 0xe83a26, 0.75, 1, 0x7a1010, 0], bright: 1.2 },
  body: { tex: ART_HIT_INK, half: 1.3, color: [0, 0xb81018, 0.97, 0.4, 0x84101a, 0.85, 1, 0x3c080c, 0] },
  core: [0, 0xff9a60, 1, 0.4, 0xff4a28, 0.9, 1, 0xa02010, 0],
  streak: [0, 0xffc890, 1, 0.3, 0xff6038, 0.9, 1, 0x8a1818, 0],
  flare: [0, 0xff8860, 0.9, 0.4, 0xd02c1c, 0.55, 1, 0x701010, 0],
  ember: { color: [0, 0xffa060, 1, 0.5, 0xff4020, 0.8, 1, 0x501008, 0], gravity: 9, rise: 0.9, n: 5 },
  extra: PHYS_SLASH,
});

/** the element family: same event, different material (fire flame + rising embers, ice crystals + frost ring, lightning zig-zags, dark ink splash,
 *  poison blob + drips, holy gold halo, wind teal twirl). Played by the route by `element` (route.ts HIT_BY_ELEMENT). */
export const HIT_FIRE: FxSpec = hitSpec({
  id: 'sk.gen.pf_hit_fire',
  elem: 'fire',
  desc: 'Player damaged (fire): an orange flame puff on the side that was hit, a dark-red alpha body, rising embers, a scorched floor flare.',
  main: { tex: ART_HIT_FLAME, half: 1.25, color: [0, 0xffb040, 1, 0.4, 0xff6a14, 0.9, 1, 0xa02808, 0], bright: 1.15, rot: [-12, 12] },
  body: { tex: ART_HIT_FLAME, half: 1.25, color: [0, 0xd03808, 0.97, 0.45, 0x9c2408, 0.8, 1, 0x3c0c04, 0] },
  core: [0, 0xffd060, 1, 0.4, 0xff7a20, 0.9, 1, 0xb03008, 0],
  streak: [0, 0xfff0b0, 1, 0.3, 0xff9030, 0.9, 1, 0x8a2008, 0],
  flare: [0, 0xffa040, 0.9, 0.4, 0xe05010, 0.55, 1, 0x781c08, 0],
  ember: { color: [0, 0xffd080, 1, 0.5, 0xff6a20, 0.85, 1, 0x501808, 0], gravity: -3, rise: 1.2, n: 9 },
  extra: [
    burst({
      note: 'flame tongues licking up the struck side (second flame sprite, narrower, rising)',
      t0: 0.03,
      life: [0, 0.3],
      at: [0, 0.35, -0.5],
      dir: { y: [0, 1] },
      vel: [0, 1.2],
      half: [[0, 0.55], [0, 0.85]],
      scale: [[0, 0.6, 0.3, 1, 1, 0.8], [0, 0.5, 0.3, 1, 1, 1.2]],
      color: [0, 0xffe090, 0.9, 0.4, 0xff7020, 0.7, 1, 0x801808, 0],
      blend: 'add',
      clamp: 1.1,
      attach: true,
      tex: ART_HIT_FLAME,
    }),
  ],
});

export const HIT_ICE: FxSpec = hitSpec({
  id: 'sk.gen.pf_hit_ice',
  elem: 'ice',
  desc: 'Player damaged (ice): a cluster of pale-blue crystals bursts on the side that was hit, a deep-blue alpha body, a frost ring on the floor, cold glints.',
  main: { tex: ART_HIT_ICE, half: 1.25, color: [0, 0xb8eaff, 1, 0.4, 0x78c8ff, 0.9, 1, 0x3a78e0, 0], bright: 1.15, rot: [-18, 18] },
  body: { tex: ART_HIT_ICE, half: 1.25, color: [0, 0x2070d8, 1, 0.45, 0x1c58b0, 0.85, 1, 0x102860, 0] },
  core: [0, 0xf0ffff, 1, 0.4, 0x9ae0ff, 0.9, 1, 0x2870c8, 0],
  streak: [0, 0xf0ffff, 1, 0.3, 0x80d0ff, 0.9, 1, 0x2060c0, 0],
  flare: [0, 0xa0e4ff, 0.9, 0.4, 0x3a90e0, 0.55, 1, 0x1c4090, 0],
  ember: { color: [0, 0xe8ffff, 1, 0.5, 0x88d0ff, 0.85, 1, 0x2a60c0, 0], gravity: 4, rise: 0.6, n: 6 },
  extra: [
    flat({
      note: 'frost ring spreading on the floor under the blow (ground-anchored)',
      life: [0, 0.36],
      at: [0, -0.97, -0.3],
      half: [0, 1.5],
      scale: [0, 0.35, 0.3, 0.9, 1, 1.1],
      color: [0, 0xc8f2ff, 0.8, 0.4, 0x58b4ff, 0.5, 1, 0x1c5cd0, 0],
      blend: 'add',
      clamp: 1,
      tex: ART_BAND,
    }),
    flat({
      note: 'alpha twin of the frost ring (deep blue): holds on snow',
      life: [0, 0.4],
      at: [0, -0.97, -0.3],
      half: [0, 1.5],
      scale: [0, 0.35, 0.3, 0.9, 1, 1.1],
      color: [0, 0x2468c8, 0.7, 0.4, 0x1c54a8, 0.5, 1, 0x0c2860, 0],
      blend: 'alpha',
      tex: ART_BAND,
    }),
  ],
});

export const HIT_BOLT: FxSpec = hitSpec({
  id: 'sk.gen.pf_hit_bolt',
  elem: 'lightning',
  desc: 'Player damaged (lightning): yellow-white zig-zag bolts flicker across the side that was hit, a dark-gold alpha body, a hot four-point flare, a floor flare.',
  main: { tex: ART_HIT_BOLT, half: 1.4, color: [0, 0xfff8a0, 1, 0.4, 0xffd830, 0.9, 1, 0xd89010, 0], bright: 1.4 },
  body: { tex: ART_HIT_BOLT, half: 1.4, color: [0, 0xa87806, 1, 0.45, 0x8a6008, 0.85, 1, 0x403004, 0] },
  core: [0, 0xfffbc0, 1, 0.4, 0xffd840, 0.9, 1, 0xc88808, 0],
  streak: [0, 0xffffe8, 1, 0.3, 0xffe050, 0.9, 1, 0xc08008, 0],
  flare: [0, 0xffe860, 0.9, 0.4, 0xe0a010, 0.55, 1, 0x785008, 0],
  ember: { color: [0, 0xffffc0, 1, 0.5, 0xffd040, 0.85, 1, 0x705008, 0], gravity: 6, rise: 0.5, n: 6 },
  extra: [
    burst({
      note: 'second bolt flicker (re-strike): another rotation of the zig-zag sprite a beat later',
      t0: 0.06,
      life: [0, 0.14],
      at: [0, 0.2, -0.55],
      half: [0, 1.2],
      scale: [0, 0.8, 1, 1],
      color: [0, 0xffffff, 0.95, 0.5, 0xfff080, 0.7, 1, 0xd89010, 0],
      rotation: { start: [90, 180] },
      blend: 'add',
      bright: 1.6,
      clamp: 1.1,
      attach: true,
      tex: ART_HIT_BOLT,
    }),
    burst({
      note: 'four-point flare at the strike point',
      life: [0, 0.2],
      at: [0, 0.15, -0.6],
      half: [0, 0.7],
      scale: [0, 0.5, 0.25, 1, 1, 0.8],
      color: [0, 0xfffff0, 1, 0.4, 0xffe870, 0.8, 1, 0xd89010, 0],
      blend: 'add',
      clamp: 1.1,
      attach: true,
      tex: ART_FLAREORB,
    }),
  ],
});

export const HIT_DARK: FxSpec = hitSpec({
  id: 'sk.gen.pf_hit_dark',
  elem: 'dark',
  desc: 'Player damaged (dark): a violet ink splash on the side that was hit over a near-black alpha body, dark motes, a violet floor flare.',
  main: { tex: ART_HIT_INK, half: 1.5, color: [0, 0xd8a8ff, 0.95, 0.4, 0x9a50ff, 0.8, 1, 0x4a1cb0, 0], bright: 1.4 },
  body: { tex: ART_HIT_INK, half: 1.45, color: [0, 0x2a1068, 1, 0.5, 0x1c0a48, 0.9, 1, 0x0c0420, 0] },
  core: [0, 0xe0c0ff, 1, 0.4, 0xa060ff, 0.9, 1, 0x4a1cb0, 0],
  streak: [0, 0xe8d0ff, 1, 0.3, 0xa868ff, 0.9, 1, 0x4a1cb0, 0],
  flare: [0, 0xb878ff, 0.9, 0.4, 0x6a2cd8, 0.55, 1, 0x2c1070, 0],
  ember: { color: [0, 0xd8b0ff, 1, 0.5, 0x8a48f0, 0.85, 1, 0x30106a, 0], gravity: -1, rise: 1.0, n: 7 },
  extra: [
    burst({
      note: 'ink wisps curling up off the struck side (alpha smoke, violet-black)',
      t0: 0.04,
      life: [0, 0.36],
      at: [0, 0.35, -0.5],
      dir: { y: [0, 1] },
      vel: [0, 0.9],
      half: [0, 0.55],
      scale: [0, 0.5, 1, 1.3],
      color: [0, 0x3a1880, 0.7, 0.5, 0x24104c, 0.45, 1, 0x100620, 0],
      rotation: { start: [0, 360], spin: 40, randomDir: true },
      blend: 'alpha',
      attach: true,
      tex: ART_PUFF,
    }),
  ],
});

export const HIT_POISON: FxSpec = hitSpec({
  id: 'sk.gen.pf_hit_poison',
  elem: 'poison',
  desc: 'Player damaged (poison): a lime toxic splash on the side that was hit over a dark-green alpha body, drips falling, a green floor flare.',
  main: { tex: ART_HIT_TOXIC, half: 1.3, color: [0, 0xb8ff70, 1, 0.4, 0x80e038, 0.9, 1, 0x3c9020, 0], bright: 1.15 },
  body: { tex: ART_HIT_TOXIC, half: 1.3, color: [0, 0x2c8020, 1, 0.45, 0x1c5c18, 0.85, 1, 0x0c2c0c, 0] },
  core: [0, 0xf0ffc0, 1, 0.4, 0xa8f060, 0.9, 1, 0x3c8c20, 0],
  streak: [0, 0xf0ffc8, 1, 0.3, 0x98e850, 0.9, 1, 0x2c7818, 0],
  flare: [0, 0xb0f868, 0.9, 0.4, 0x48b028, 0.55, 1, 0x1c5014, 0],
  ember: { color: [0, 0xd8ff90, 1, 0.5, 0x78d838, 0.85, 1, 0x1c5010, 0], gravity: 12, rise: 0.4, n: 8 },
  extra: [],
});

export const HIT_HOLY: FxSpec = hitSpec({
  id: 'sk.gen.pf_hit_holy',
  elem: 'holy',
  desc: 'Player damaged (holy): a gold halo with a hot centre on the side that was hit, an amber alpha body, glints, a gold floor flare.',
  main: { tex: ART_HIT_HOLY, half: 1.3, color: [0, 0xffe890, 1, 0.4, 0xffc840, 0.9, 1, 0xc88810, 0], bright: 1.2, rot: [0, 0] },
  body: { tex: ART_HIT_HOLY, half: 1.3, color: [0, 0xb87810, 1, 0.45, 0x906008, 0.85, 1, 0x403004, 0] },
  core: [0, 0xfff8c0, 1, 0.4, 0xffd048, 0.9, 1, 0xc08010, 0],
  streak: [0, 0xfffbd8, 1, 0.3, 0xffd860, 0.9, 1, 0xb87810, 0],
  flare: [0, 0xffe070, 0.9, 0.4, 0xe0a818, 0.55, 1, 0x785008, 0],
  ember: { color: [0, 0xfffbd0, 1, 0.5, 0xffd860, 0.85, 1, 0x705008, 0], gravity: -2, rise: 1.0, n: 7 },
  extra: [],
});

export const HIT_WIND: FxSpec = hitSpec({
  id: 'sk.gen.pf_hit_wind',
  elem: 'wind',
  desc: 'Player damaged (wind): a teal twirl of air on the side that was hit over a deep-teal alpha body, thin cutting streaks, a pale floor flare.',
  main: { tex: ART_HIT_TWIRL, half: 1.35, color: [0, 0xa0ffe8, 1, 0.4, 0x50e0c8, 0.9, 1, 0x20a090, 0], bright: 1.15 },
  body: { tex: ART_HIT_TWIRL, half: 1.35, color: [0, 0x1c8878, 1, 0.45, 0x146458, 0.85, 1, 0x083028, 0] },
  core: [0, 0xf0fffa, 1, 0.4, 0x80f0d8, 0.9, 1, 0x20a090, 0],
  streak: [0, 0xf0fffa, 1, 0.3, 0x70f0d8, 0.9, 1, 0x189080, 0],
  flare: [0, 0x90f8e0, 0.9, 0.4, 0x30c0a8, 0.55, 1, 0x106058, 0],
  ember: { color: [0, 0xe8fffa, 1, 0.5, 0x80f0d8, 0.85, 1, 0x207060, 0], gravity: 2, rise: 0.8, n: 6 },
  extra: [],
});

/** element index (sim ELEMENT_PALETTE order: physical, fire, ice, lightning, dark, poison, holy, wind) -> hit spec id */
export const HIT_BY_ELEMENT: readonly string[] = [
  'hit.player',
  HIT_FIRE.id,
  HIT_ICE.id,
  HIT_BOLT.id,
  HIT_DARK.id,
  HIT_POISON.id,
  HIT_HOLY.id,
  HIT_WIND.id,
];

/** every hit variant (registered through SELF_SPECS besides the classic `hit.player` slot) */
export const HIT_VARIANTS: FxSpec[] = [HIT_FIRE, HIT_ICE, HIT_BOLT, HIT_DARK, HIT_POISON, HIT_HOLY, HIT_WIND];


// ---------------------------------------------------------------------------------------------------------- player.evade






export const EVADE: FxSpec = {
  id: 'player.evade',
  desc: 'Player dodged: a crouched, side-stepping afterimage of the fighter (deep teal body, cyan light, speed streaks) peels off the hero and slides out diagonally, a fainter copy a beat later, mint wisps on the floor, skid puffs, glints. dir = blow direction.',
  behavior: 'selfBuff',
  ref: {},
  size: 'radius',
  base: 1,
  dur: 0.5,
  lift: 0,
  follow: true,
  elements: [
    burst({
      note: 'afterimage 1, alpha body (deep teal): the crouched fighter peeling off the body and sliding out to the dodge side + along the blow (the ROUTE pins the frame to the screen: local +x = screen-left, local +z = up the screen; b < 0 mirrors x AND the sprite, so the figure always faces its motion)',
      life: [0, 0.42],
      at: [0.75, 0.12, 0],
      dir: { x: [0, 0.93], z: [0, 0.32] },
      vel: [0, 4.2],
      air: [0, 0.025],
      half: [0, 1.3],
      scale: [0, 0.82, 0.2, 1, 1, 1.05],
      color: [0, 0x0e5f82, 0.95, 0.35, 0x0c5272, 0.8, 1, 0x082e46, 0],
      blend: 'alpha',
      tex: ART_CROUCH,
    }),
    burst({
      note: 'afterimage 1, second alpha copy a hair larger: doubles the body so the figure reads as a translucent solid, not fine lines (esp. on snow)',
      life: [0, 0.4],
      at: [0.75, 0.12, 0],
      dir: { x: [0, 0.93], z: [0, 0.32] },
      vel: [0, 4.2],
      air: [0, 0.025],
      half: [0, 1.36],
      scale: [0, 0.82, 0.2, 1, 1, 1.05],
      color: [0, 0x1678a2, 0.8, 0.35, 0x126a90, 0.6, 1, 0x082e46, 0],
      blend: 'alpha',
      tex: ART_CROUCH,
    }),
    burst({
      note: 'afterimage 1 (additive cyan): the lit body and the speed streaks over the dark body (occlude keeps them readable on snow)',
      life: [0, 0.4],
      at: [0.75, 0.12, 0],
      dir: { x: [0, 0.93], z: [0, 0.32] },
      vel: [0, 4.2],
      air: [0, 0.025],
      half: [0, 1.3],
      scale: [0, 0.82, 0.2, 1, 1, 1.05],
      color: [0, 0xc8f4ff, 0.95, 0.3, 0x70d8ff, 0.8, 0.7, 0x38a4ff, 0.45, 1, 0x2878ff, 0],
      blend: 'add',
      bright: 1.6,
      clamp: 1,
      occlude: 0.5,
      tex: ART_CROUCH,
    }),
    burst({
      note: 'afterimage 2: a fainter copy a beat later and nearer the body, so the slip reads as a motion (alpha + additive)',
      t0: 0.07,
      life: [0, 0.32],
      at: [0.55, 0.12, 0],
      dir: { x: [0, 0.93], z: [0, 0.32] },
      vel: [0, 3.2],
      air: [0, 0.025],
      half: [0, 1.22],
      scale: [0, 0.85, 0.2, 1, 1, 1.04],
      color: [0, 0x1678a2, 0.6, 0.3, 0x126a90, 0.42, 1, 0x082e46, 0],
      blend: 'alpha',
      tex: ART_CROUCH,
    }),
    burst({
      note: 'afterimage 2 (additive)',
      t0: 0.07,
      life: [0, 0.3],
      at: [0.55, 0.12, 0],
      dir: { x: [0, 0.93], z: [0, 0.32] },
      vel: [0, 3.2],
      air: [0, 0.025],
      half: [0, 1.22],
      scale: [0, 0.85, 0.2, 1, 1, 1.04],
      color: [0, 0xa8e8ff, 0.7, 0.3, 0x60c8ff, 0.5, 1, 0x2878ff, 0],
      blend: 'add',
      bright: 1.3,
      clamp: 1,
      occlude: 0.4,
      tex: ART_CROUCH,
    }),
    burst({
      note: '',
      cycle: 0.08,
      max: 3,
      rate: [0, 600],
      life: [0, 0.3],
      shape: { kind: 'box', box: [0.4, 0, 0.5] },
      at: [0.3, -0.9, 0],
      dir: { x: [0, 0.93], z: [0, 0.32] },
      jitter: [0.0004, 0, 0.0004],
      vel: [0, 3.6],
      half: [0, 0.75],
      scale: [[0, 0.6, 1, 1.2], [0, 0.6, 1, 0.45]],
      color: [0, 0xb0ffe4, 0.85, 0.4, 0x50e0b4, 0.55, 1, 0x1ca080, 0],
      air: [0, 0.07],
      billboard: 'stretch',
      blend: 'add',
      bright: 1.2,
      clamp: 1,
      occlude: 0.4,
      tex: { art: 'vfx_player_feedback_haste_wisp', fallback: 'wisp' },
    }),
    burst({
      note: 'the ground wisps as a deep-mint alpha twin (snow)',
      cycle: 0.08,
      max: 3,
      rate: [0, 600],
      life: [0, 0.32],
      shape: { kind: 'box', box: [0.4, 0, 0.5] },
      at: [0.3, -0.92, 0],
      dir: { x: [0, 0.93], z: [0, 0.32] },
      jitter: [0.0004, 0, 0.0004],
      vel: [0, 3.2],
      half: [0, 0.78],
      scale: [[0, 0.6, 1, 1.2], [0, 0.6, 1, 0.45]],
      color: [0, 0x20a070, 0.6, 0.5, 0x187a58, 0.4, 1, 0x0c4434, 0],
      air: [0, 0.07],
      billboard: 'stretch',
      blend: 'alpha',
      tex: { art: 'vfx_player_feedback_haste_wisp', fallback: 'wisp' },
    }),
    burst({
      note: 'skid dust: two pale puffs at the feet drifting backwards (alpha)',
      cycle: 0.08,
      max: 2,
      rate: [0, 300],
      life: [0, 0.4],
      at: [0, -0.92, 0],
      dir: { z: [0, -1] },
      jitter: [0.0004, 0, 0.0002],
      vel: [0, 1.2],
      half: [0, 0.45],
      scale: [0, 0.5, 1, 1.2],
      color: [0, 0xb8d8d0, 0.45, 0.5, 0x90b8b0, 0.28, 1, 0x688880, 0],
      air: [0, 0.1],
      rotation: { start: [0, 360] },
      blend: 'alpha',
      tex: ART_DUST,
    }),
    burst({
      note: '2-star glints twinkling on the afterimage',
      cycle: 0.1,
      max: 4,
      rate: [0, 500],
      life: [0, 0.34],
      shape: { kind: 'ellipse', radius: 0.8 },
      at: [0.9, 0.15, 0.2],
      adv: 'outer',
      vel: [0, 0.004],
      half: [0, 0.22],
      scale: [0, 0.4, 0.3, 1, 1, 0.3],
      color: [0, 0xe8fffc, 1, 0.5, 0x8ff8ff, 0.8, 1, 0x3a9cff, 0],
      blend: 'add',
      clamp: 1.2,
      tex: ART_GLINT,
    }),
  ],
};

// ---------------------------------------------------------------------------------------------------------- player.shield






export const SHIELD: FxSpec = {
  id: 'player.shield',
  desc: 'Hit absorbed: an upright EGG of sharp spikes (3hosin starburst, ~2.5 m wide, body height) in saturated blue flashes round the hero with a pulse copy a beat later, a soft sphere glow, a footprint ring on the floor, a hot orb and ripple where the blow landed, glints. dir = blow direction.',
  behavior: 'selfBuff',
  ref: {},
  size: 'radius',
  base: 1,
  dur: 0.5,
  lift: 0,
  follow: true,
  elements: [
    burst({
      note: 'white_sphere (#003eff, a 0.29): a soft round blue alpha glow filling the egg so it reads as a protective volume (kept low: the r2 flat disc was the complaint)',
      life: [0, 0.4],
      at: [0, 0.3, 0],
      half: [0, 1.3],
      scale: [0, 0.8, 0.25, 1, 1, 1.05],
      color: [0, 0x1c4ce0, 0.34, 0.3, 0x183fc4, 0.3, 1, 0x0c2480, 0],
      blend: 'alpha',
      attach: true,
      tex: ART_ORB,
    }),
    burst({
      note: 'gyeokgong_triple_loop_2 -> vfx_player_feedback_spike_egg, alpha body (deep saturated blue): the starburst egg keeps its shape and hue on snow where additive spikes only add white',
      life: [0, 0.42],
      at: [0, 0.3, 0],
      half: [[0, 2.3], [0, 1.55]],
      scale: [0, 0.78, 0.2, 1, 1, 1.05],
      color: [0, 0x1048e0, 1, 0.3, 0x0c3cc8, 0.95, 0.65, 0x0a30a0, 0.7, 1, 0x061a60, 0],
      blend: 'alpha',
      attach: true,
      tex: ART_SPIKEEGG,
    }),
    burst({
      note: 'the same egg, second alpha copy (a hair larger, a beat later): doubles the body of the thin spikes',
      t0: 0.03,
      life: [0, 0.4],
      at: [0, 0.3, 0],
      half: [[0, 2.38], [0, 1.6]],
      scale: [0, 0.78, 0.2, 1, 1, 1.05],
      color: [0, 0x2058f0, 0.8, 0.3, 0x1848d8, 0.7, 1, 0x0a2a90, 0],
      blend: 'alpha',
      attach: true,
      tex: ART_SPIKEEGG,
    }),
    burst({
      note: 'the egg, additive pale blue: the hot edges of the spikes (blue, not white; occlude darkens what is behind so it holds on snow)',
      life: [0, 0.4],
      at: [0, 0.3, 0],
      half: [[0, 2.3], [0, 1.55]],
      scale: [0, 0.8, 0.2, 1, 1, 1.05],
      color: [0, 0xe0f0ff, 0.95, 0.25, 0x88c0ff, 0.85, 0.65, 0x4890ff, 0.5, 1, 0x1c3cd8, 0],
      blend: 'add',
      bright: 1.5,
      clamp: 1,
      occlude: 0.55,
      attach: true,
      tex: ART_SPIKEEGG,
    }),
    burst({
      note: 'the pulse: a larger fainter egg expanding a beat later (3hosin_loop breathes; this is the absorb carried outward)',
      t0: 0.08,
      life: [0, 0.3],
      at: [0, 0.3, 0],
      half: [[0, 2.42], [0, 1.62]],
      scale: [0, 0.8, 1, 1.25],
      color: [0, 0x9cd0ff, 0.7, 0.4, 0x5aa0ff, 0.45, 1, 0x1c3cd8, 0],
      blend: 'add',
      bright: 1.2,
      clamp: 1,
      occlude: 0.4,
      attach: true,
      tex: ART_SPIKEEGG,
    }),
    flat({
      note: 'footprint of the shield on the floor (alpha, deep blue): a soft thick ring that holds on snow',
      life: [0, 0.4],
      at: [0, -0.98, 0],
      half: [0, 1.7],
      scale: [0, 0.6, 0.35, 1, 1, 1.1],
      color: [0, 0x1048d8, 0.85, 0.4, 0x0c38b8, 0.6, 1, 0x081c70, 0],
      blend: 'alpha',
      tex: ART_BAND,
    }),
    flat({
      note: 'footprint ring (additive): the lit edge of the same ring',
      life: [0, 0.4],
      at: [0, -0.98, 0],
      half: [0, 1.7],
      scale: [0, 0.6, 0.35, 1, 1, 1.1],
      color: [0, 0x70b0ff, 0.6, 0.4, 0x3a78ff, 0.4, 1, 0x1c5cff, 0],
      blend: 'add',
      clamp: 1,
      occlude: 0.4,
      tex: ART_BAND,
    }),
    burst({
      note: 'impact: a hot orb with a ring core where the blow landed (the attacker side of the egg)',
      life: [0, 0.22],
      at: [0, 0.2, -1.0],
      half: [0, 0.55],
      scale: [0, 0.5, 0.25, 1, 1, 0.9],
      color: [0, 0xd8ecff, 1, 0.35, 0x78c0ff, 0.8, 1, 0x2a70ff, 0],
      blend: 'add',
      bright: 1.2,
      clamp: 1.1,
      occlude: 0.5,
      attach: true,
      tex: ART_FLAREORB,
    }),
    burst({
      note: 'ripple: a small halo ring spreading from the impact point (alpha, so it reads on snow)',
      life: [0, 0.3],
      at: [0, 0.2, -1.0],
      half: [0, 0.7],
      scale: [0, 0.2, 0.3, 0.7, 1, 1.0],
      color: [0, 0x1c54e8, 0.9, 0.5, 0x1444b8, 0.55, 1, 0x081c70, 0],
      blend: 'alpha',
      attach: true,
      tex: ART_BAND,
    }),
    burst({
      note: '2-star -> vfx_glint_halo_pin: five cyan glints riding the spike tips',
      cycle: 0.1,
      max: 5,
      rate: [0, 700],
      life: [0, 0.36],
      shape: { kind: 'ellipse', radius: 1.2, edge: true },
      at: [0, 0.3, 0],
      half: [0, 0.24],
      scale: [0, 0.4, 0.3, 1, 1, 0.3],
      color: [0, 0xe8ffff, 1, 0.5, 0x58e0ff, 0.8, 1, 0x1c78ff, 0],
      blend: 'add',
      clamp: 1.2,
      attach: true,
      tex: ART_GLINT,
    }),
  ],
};

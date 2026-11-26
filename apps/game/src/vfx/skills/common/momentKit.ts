// MOMENT KIT: spec constructors with the contract of each moment kind already filled in, and the few element recipes the shared and the
// class moments (skills/common/moments.ts, skills/<class>/moments.ts) have in common. Pure data: no three.js, nothing registered here.
//
// A MOMENT is a hand look the skill-logic redesign made the sim emit (DESIGN section 7 (4)); every moment spec is flagged `moment: true` so a
// live generated family never drops it (vfx/skills/families.ts resolveSkillSpecs) and so the caster-darkening guard reads it
// (vfx/__tests__/noCasterDarkening.test.ts). Three kinds, one per sim emit path:
//
//   markerSpec  a row on the mirrored projectile table (companions.spawnMarker, ProjKind.Marker): tracked, loops until the sim frees the row.
//               The sim hands `scale` = the row radius: k = scale, `base` 1 m, so every length is authored for k = 1 (metres).
//               Contract = `summon` (track, loop, size mult).
//   burstSpec   an event (`bus.vfx`): one-shot at a point, the sim hands `scale` (metres, `base` 1 so k = scale), `duration`, the facing
//               (dirX, dirZ; the spec's +Z), and the `element` (0..7) that tints a `tint: true` spec. Contract = `selfBuff` (event, radius).
//   lineSpec    a line event (`bus.vfxLine`): origin = the first point, target = the second; elements use `place: 'along' | 'target'` or `travel`.
//               The sim hands `scale` 1 (k = 1) and the visible `duration`. Contract = `chain` (line, needsTarget, size mult).
//
// HERO RULE (user rule 2026-10-26, README "Readability"): nothing here darkens the hero. Every element is ADDITIVE (`blend: 'add'`, the
// default; an additive element cannot darken), no `occlude`, and bright stacks carry `clamp`. The hero guard (vfx/heroGuard.ts) already fades
// every VFX material inside the screen ellipse of the local hero, so a look centred on the hero is dimmed there by the engine.
import type { ColorCurve, Curve, ElementSpec, FxSpec, ParticleSpec, SpecRef, SurfaceSpec, TexSrc, Vec3 } from '../../spec/types';

/** the fields every moment constructor takes */
interface MomentBase {
  /** `sk.gen.<name>` (shared) or `sk.<skillId>.<part>` (class moment) */
  id: string;
  /** one-line look description (>= 10 chars; the gallery and the README text) */
  desc: string;
  
  ref: SpecRef;
  elements: readonly ElementSpec[];
  /** nominal length s (informational for one-shots; the default loop length of a marker) */
  dur?: number;
  /** neutral template: the sim's `element` argument multiplies every colour key by that palette's main colour (author keys white / pale) */
  tint?: boolean;
  /** gallery hints */
  demo?: FxSpec['demo'];
}

/** a marker row look (tracked, loops until the row is freed). `scale` is the row radius: author for k = 1 (base 1 m). */
export function markerSpec(o: MomentBase & { fadeOut?: number; lift?: number }): FxSpec {
  return {
    id: o.id,
    desc: o.desc,
    behavior: 'summon',
    ref: o.ref,
    size: 'mult',
    base: 1,
    dur: o.dur ?? 2,
    elements: o.elements,
    // a freed marker (ward broke, window over) must be gone almost at once: the break / burst moment takes over
    fadeOut: o.fadeOut ?? 0.25,
    ...(o.lift !== undefined ? { lift: o.lift } : {}),
    ...(o.tint === true ? { tint: true } : {}),
    moment: true,
    ...(o.demo !== undefined ? { demo: o.demo } : {}),
  };
}

/** an event look (`bus.vfx`). `scale` is in metres (k = scale / 1), +Z of the spec = the event's facing. */
export function burstSpec(o: MomentBase): FxSpec {
  return {
    id: o.id,
    desc: o.desc,
    behavior: 'selfBuff',
    ref: o.ref,
    size: 'radius',
    base: 1,
    dur: o.dur ?? 0.6,
    elements: o.elements,
    ...(o.tint === true ? { tint: true } : {}),
    moment: true,
    ...(o.demo !== undefined ? { demo: o.demo } : {}),
  };
}

/** a line look (`bus.vfxLine`): the first point is the origin, the second the target. `scale` is 1 (k = 1). */
export function lineSpec(o: MomentBase): FxSpec {
  return {
    id: o.id,
    desc: o.desc,
    behavior: 'chain',
    ref: o.ref,
    size: 'mult',
    base: 1,
    dur: o.dur ?? 0.5,
    elements: o.elements,
    ...(o.tint === true ? { tint: true } : {}),
    moment: true,
    demo: { target: 5, ...o.demo },
  };
}

// ---------------------------------------------------------------------------------------------------- element recipes

/** a ground ring / disc band (additive surface): `r0..r1` is the band, `life` the period of a loop (a marker) or the length of a one-shot */
export function ringBand(note: string, o: {
  r0: number;
  r1: number;
  life: number;
  color: ColorCurve;
  /** uniform scale over the life (a loop breathes, a burst expands) */
  scale?: Curve;
  t0?: number;
  loop?: boolean;
  y?: number;
  tex?: TexSrc;
  soft?: number;
  /** fraction 0..0.5 of a partial arc that fades in / out at its two ends (no hard cut edges) */
  softU?: number;
  bright?: number;
  clamp?: number;
  span?: number;
  a0?: number;
  /** turn about +Y over the life, deg */
  spin?: Curve;
  minTier?: 0 | 1 | 2 | 3;
}): SurfaceSpec {
  return {
    kind: 'surface',
    note,
    ...(o.t0 !== undefined ? { t0: o.t0 } : {}),
    life: o.life,
    ...(o.loop === true ? { loop: true } : {}),
    shape: { kind: 'arc', r0: o.r0, r1: o.r1, span: o.span ?? 360, ...(o.a0 !== undefined ? { a0: o.a0 } : {}) },
    at: [0, o.y ?? 0.07, 0],
    ...(o.scale !== undefined ? { scale: o.scale } : {}),
    ...(o.spin !== undefined ? { spin: o.spin } : {}),
    color: o.color,
    blend: 'add',
    tex: o.tex ?? 'glowStrip',
    soft: o.soft ?? 0.6,
    ...(o.softU !== undefined ? { softU: o.softU } : {}),
    ...(o.bright !== undefined ? { bright: o.bright } : {}),
    ...(o.clamp !== undefined ? { clamp: o.clamp } : {}),
    ...(o.minTier !== undefined ? { minTier: o.minTier } : {}),
  };
}

/**
 * Light motes / wisps drifting up from a ring of radius `radius` round the origin (loops: `loops: 0`; they ride the marker when `attach`).
 * `rise` m/s upward, `life` s, `rate` per second, quad half size `half` m.
 */
export function risingMotes(note: string, o: {
  radius: number;
  rate: number;
  max: number;
  life: number;
  rise: number;
  half: number;
  color: ColorCurve;
  tex?: TexSrc;
  /** sprite spin deg/s */
  spin?: number;
  edge?: boolean;
  y?: number;
  billboard?: ParticleSpec['billboard'];
  bright?: number;
  clamp?: number;
  minTier?: 0 | 1 | 2 | 3;
  loops?: number;
  attach?: boolean;
}): ParticleSpec {
  return {
    kind: 'particle',
    note,
    cycle: 1,
    loops: o.loops ?? 0,
    max: o.max,
    rate: [0, o.rate],
    life: [0, o.life],
    shape: { kind: 'ellipse', radius: o.radius, edge: o.edge !== false },
    at: [0, o.y ?? 0.1, 0],
    dir: { y: [0, 100] },
    vel: [0, o.rise / 100],
    half: [0, o.half],
    scale: [0, 0.7, 0.3, 1, 1, 0.8],
    color: o.color,
    billboard: o.billboard ?? 'screen',
    rotation: { start: [0, 360], ...(o.spin !== undefined ? { spin: o.spin, randomDir: true } : {}) },
    ...(o.attach !== false ? { attach: true } : {}),
    blend: 'add',
    tex: o.tex ?? 'wisp',
    ...(o.bright !== undefined ? { bright: o.bright } : {}),
    ...(o.clamp !== undefined ? { clamp: o.clamp } : {}),
    ...(o.minTier !== undefined ? { minTier: o.minTier } : {}),
  };
}

/** one burst of `n` short streaks / sparks flung outward from `at` (a one-shot emitter): speed m/s, life s, length (half) m */
export function sparkBurst(note: string, o: {
  n: number;
  at: Vec3;
  speed: number;
  life: number;
  length: number;
  width?: number;
  color: ColorCurve;
  t0?: number;
  tex?: TexSrc;
  gravity?: number;
  /** emitter shape radius */
  radius?: number;
  bright?: number;
  clamp?: number;
  billboard?: ParticleSpec['billboard'];
  minTier?: 0 | 1 | 2 | 3;
  /** emission bias (local frame, unitless, added to the outward direction): `{ z: [0, 60] }` flings the sparks toward +Z */
  dir?: ParticleSpec['dir'];
}): ParticleSpec {
  return {
    kind: 'particle',
    note,
    ...(o.t0 !== undefined ? { t0: o.t0 } : {}),
    cycle: 0.1,
    max: o.n,
    rate: [0, 1000],
    life: [0, o.life],
    shape: { kind: 'sphere', radius: o.radius ?? 0.06 },
    adv: 'outer',
    at: o.at,
    ...(o.dir !== undefined ? { dir: o.dir } : {}),
    vel: [0, o.speed / 100],
    half: [[0, o.width ?? 0.03], [0, o.length]],
    scale: [0, 1, 1, 0.5],
    color: o.color,
    ...(o.gravity !== undefined ? { gravity: [0, o.gravity] } : {}),
    billboard: o.billboard ?? 'stretch',
    blend: 'add',
    tex: o.tex ?? 'streakHard',
    ...(o.bright !== undefined ? { bright: o.bright } : {}),
    ...(o.clamp !== undefined ? { clamp: o.clamp } : {}),
    ...(o.minTier !== undefined ? { minTier: o.minTier } : {}),
  };
}

/** a single camera-facing flash (one particle): `half` m, `life` s, held at `at` */
export function flash(note: string, o: {
  at: Vec3;
  half: number;
  life: number;
  color: ColorCurve;
  tex?: TexSrc;
  /** size over life: [from, to] multiplier */
  grow?: readonly [number, number];
  t0?: number;
  bright?: number;
  clamp?: number;
  billboard?: ParticleSpec['billboard'];
  spin?: number;
}): ParticleSpec {
  return {
    kind: 'particle',
    note,
    ...(o.t0 !== undefined ? { t0: o.t0 } : {}),
    cycle: Math.max(0.1, o.life),
    max: 1,
    rate: [0, 1000],
    life: [0, o.life],
    at: o.at,
    half: [0, o.half],
    scale: [0, o.grow?.[0] ?? 1, 1, o.grow?.[1] ?? 1],
    color: o.color,
    billboard: o.billboard ?? 'screen',
    ...(o.spin !== undefined ? { rotation: { start: [0, 360], spin: o.spin, randomDir: true } } : {}),
    blend: 'add',
    tex: o.tex ?? 'glow',
    ...(o.bright !== undefined ? { bright: o.bright } : {}),
    ...(o.clamp !== undefined ? { clamp: o.clamp } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------- fix round 2 (vfx critic X1 / X3)

/**
 * The ALPHA-blended twin of a ground ring (vfx critic X3: additive light cannot show on snow / pale stone, so every marker ring and big ground ring
 * gets a saturated twin that DRAWS ITS OWN COLOUR over the ground). Same band recipe as `ringBand`; pass a mid-luminance saturated colour
 * (Rec.709 luma >= 0.45: such an alpha element has pull 0 in noCasterDarkening, it can never darken a hero, and the ring sits outside the hero ellipse).
 */
export function alphaRing(note: string, o: Parameters<typeof ringBand>[1]): SurfaceSpec {
  const r = ringBand(note, o);
  const { clamp: _clamp, bright: _bright, ...rest } = r;
  void _clamp;
  void _bright;
  return { ...rest, blend: 'alpha' };
}

/**
 * A thin ring-only roar for the base-kit / awakening nova of a buff skill (vfx critic X1: the shared `vfx_nova` -> shock.wave drew a FILLED cream disc
 * under every cast and whited the hero out). Event, k = the nova radius (m), ~0.45 s: a thin bright ring racing out over the ground (clamp 0.6), a
 * fainter ring behind it, an ALPHA twin in the deep colour so it shows on snow, and a spray of streaks along the ground. Fixed colours per skill.
 * `main` / `pale` / `deep` are the ring, its hot edge and the alpha twin colour (deep must be luma >= 0.45).
 */
export function novaRing(o: {
  id: string;
  desc: string;
  ref: SpecRef;
  main: number;
  pale: number;
  deep: number;
  /** streak count (default 14) */
  sparks?: number;
  /** extra elements (skill flavour) */
  extra?: readonly ElementSpec[];
}): FxSpec {
  return burstSpec({
    id: o.id,
    desc: o.desc,
    ref: o.ref,
    dur: 0.5,
    elements: [
      ringBand('roar ring: a thin bright ring racing out over the ground', {
        r0: 0.93, r1: 1.0, life: 0.5, scale: [0, 0.12, 0.35, 0.78, 1, 1], clamp: 0.6, soft: 0.5, y: 0.09,
        color: [0, o.pale, 0.9, 0.5, o.main, 0.6, 1, o.main, 0],
      }),
      ringBand('second ring: a fainter ring a beat behind', {
        t0: 0.07, r0: 0.9, r1: 0.97, life: 0.48, scale: [0, 0.1, 0.4, 0.7, 1, 0.94], clamp: 0.6, soft: 0.7, y: 0.08,
        color: [0, o.main, 0.5, 1, o.main, 0],
      }),
      alphaRing('alpha twin: the same ring in a deep colour so it holds on snow', {
        r0: 0.92, r1: 1.0, life: 0.5, scale: [0, 0.12, 0.35, 0.78, 1, 1], soft: 0.6, y: 0.06,
        color: [0, o.deep, 0.55, 0.6, o.deep, 0.4, 1, o.deep, 0],
      }),
      sparkBurst('ground streaks: short streaks flung out along the ring', {
        n: o.sparks ?? 14, at: [0, 0.1, 0], radius: 0.25, speed: 2.4, life: 0.4, length: 0.09, width: 0.012, clamp: 0.8,
        color: [0, o.pale, 1, 0.5, o.main, 0.7, 1, o.main, 0],
      }),
      ...(o.extra ?? []),
    ],
  });
}

/**
 * One light plate / mote ORBITING the origin at `radius` m, height `y`, one lap per `period` s (attach: true, so it rides the marker). A particle keeps its birth
 * position, so the orbit is a moving EMITTER (`path` x / z curves over the cycle) that drops very short-lived quads (life 0.09 s, 50 / s): to the eye a small body
 * circling the hero. `phase` 0..1 starts the lap at that fraction; `dir` -1 turns the other way. Authored for k = 1 like every marker element.
 */
export function orbiter(note: string, o: {
  radius: number;
  y: number;
  period: number;
  phase?: number;
  dir?: 1 | -1;
  half: number;
  color: ColorCurve;
  tex?: TexSrc;
  blend?: 'add' | 'alpha';
  bright?: number;
  clamp?: number;
  /** vertical bob (m) over the lap */
  bob?: number;
  minTier?: 0 | 1 | 2 | 3;
  spin?: number;
}): ParticleSpec {
  const N = 16;
  const xs: number[] = [];
  const zs: number[] = [];
  const ys: number[] = [];
  const ph = (o.phase ?? 0) * Math.PI * 2;
  const dir = o.dir ?? 1;
  for (let i = 0; i <= N; i++) {
    const a = ph + (dir * i * Math.PI * 2) / N;
    const t = (i / N) * o.period;
    xs.push(t, Math.round(Math.cos(a) * o.radius * 1000) / 1000);
    zs.push(t, Math.round(Math.sin(a) * o.radius * 1000) / 1000);
    ys.push(t, Math.round(Math.sin(a * 2 + 1) * (o.bob ?? 0) * 1000) / 1000);
  }
  return {
    kind: 'particle',
    note,
    cycle: o.period,
    loops: 0,
    max: 6,
    rate: [0, 50],
    life: [0, 0.09],
    at: [0, o.y, 0],
    path: { x: xs, z: zs, ...(o.bob ? { y: ys } : {}) },
    half: [0, o.half],
    scale: [0, 1, 1, 1],
    color: o.color,
    billboard: 'screen',
    rotation: { start: [0, 360], ...(o.spin !== undefined ? { spin: o.spin, randomDir: true } : {}) },
    attach: true,
    blend: o.blend ?? 'add',
    tex: o.tex ?? 'shard0',
    ...(o.bright !== undefined ? { bright: o.bright } : {}),
    ...(o.clamp !== undefined ? { clamp: o.clamp } : {}),
    ...(o.minTier !== undefined ? { minTier: o.minTier } : {}),
  };
}

/**
 * A kill-fed WINDOW marker (vfx critic section 7: berserk / blood frenzy / crimson / indigo showed nothing after the cast): a pulsing ring on the ground in the skill colour with
 * an ALPHA twin (snow), rim tongues rising from the ring, embers drifting off it and a small crown of embers hovering ABOVE the head (nothing on the body). The marker lives
 * exactly as long as the buff and the sim lengthens it with every kill (hooks.killPulse). `deep` must be luma >= 0.45.
 */
export function windowLoop(o: { id: string; desc: string; ref: SpecRef; main: number; pale: number; deep: number; ember: number }): FxSpec {
  return markerSpec({
    id: o.id,
    desc: o.desc,
    ref: o.ref,
    dur: 1.6,
    elements: [
      ringBand('window ring: a bright ring pulsing on the ground', {
        r0: 0.8, r1: 0.95, life: 0.9, loop: true, scale: [0, 0.97, 0.5, 1.05, 1, 0.97], clamp: 1, soft: 0.5, y: 0.06, bright: 1.3,
        color: [0, o.main, 0.6, 0.5, o.pale, 0.95, 1, o.main, 0.6],
      }),
      alphaRing('alpha twin of the window ring: a deep colour that holds on snow', {
        r0: 0.78, r1: 0.97, life: 0.9, loop: true, scale: [0, 0.97, 0.5, 1.05, 1, 0.97], soft: 0.5, y: 0.045,
        color: [0, o.deep, 0.55, 0.5, o.deep, 0.72, 1, o.deep, 0.55],
      }),
      {
        kind: 'particle',
        note: 'tufts role: tongues rising from the rim of the ring (upright cards, additive)',
        cycle: 1,
        loops: 0,
        max: 12,
        rate: [0, 10],
        life: [0, 0.8],
        shape: { kind: 'ellipse', radius: 0.88, edge: true },
        at: [0, 0.05, 0],
        dir: { y: [0, 100] },
        vel: [0, 0.006],
        half: [[0, 0.15], [0, 0.3]],
        scale: [0, 0.6, 0.3, 1, 1, 0.5],
        color: [0, o.pale, 0, 0.2, o.main, 0.5, 1, o.deep, 0],
        billboard: 'upright',
        attach: true,
        blend: 'add',
        tex: 'tufts',
        clamp: 0.9,
        minTier: 1,
      },
      risingMotes('embers: motes drifting off the ring', {
        radius: 0.9, rate: 7, max: 11, life: 1.3, rise: 0.7, half: 0.07, tex: 'ember', spin: 40, clamp: 1,
        color: [0, o.pale, 0, 0.15, o.ember, 0.95, 1, o.deep, 0],
      }),
      risingMotes('crown: a small ring of motes hovering above the head, nothing on the body', {
        radius: 0.3, rate: 6, max: 8, life: 1.0, rise: 0.2, half: 0.06, tex: 'ember', spin: 90, y: 2.05, clamp: 1, minTier: 1,
        color: [0, 0xffffff, 0, 0.2, o.ember, 0.95, 1, o.main, 0],
      }),
    ],
  });
}

/** the kill pulse of a kill-fed window (event, k = 1, 0.35 s, <= 3 a second): a quick ring flaring at the feet and a few sparks thrown up */
export function killPulse(o: { id: string; desc: string; ref: SpecRef; main: number; pale: number }): FxSpec {
  return burstSpec({
    id: o.id,
    desc: o.desc,
    ref: o.ref,
    dur: 0.4,
    elements: [
      ringBand('pulse ring: a bright ring flaring from the feet', {
        r0: 0.7, r1: 0.9, life: 0.3, scale: [0, 0.8, 1, 1.5], clamp: 0.9, soft: 0.6, y: 0.07,
        color: [0, o.pale, 0.8, 0.5, o.main, 0.5, 1, o.main, 0],
      }),
      sparkBurst('sparks: a few sparks thrown up', {
        n: 8, at: [0, 0.2, 0], radius: 0.4, speed: 1.6, life: 0.4, length: 0.08, width: 0.02, gravity: 3, clamp: 1, dir: { y: [0, 90] },
        color: [0, o.pale, 1, 0.5, o.main, 0.8, 1, o.main, 0],
      }),
    ],
  });
}

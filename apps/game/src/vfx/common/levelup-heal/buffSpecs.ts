
// 10kwaesok), buff.shield (Blessing 3hosin), buff.stealth. Wrapped into PresetDefs of the same ids by ./presets.ts.

import type { FxSpec, ParticleSpec } from '../../spec/types';
import {
  ART_DOUBLE_RING, ART_GLINT, ART_GLOW, ART_HALO_RING, ART_HAZE, ART_RUNE_RING, ART_SMOKE_LUMP, ART_SMOKE_PUFF, ART_SMOKE_RING, ART_STAR,
  ART_SWIRL_ARCS, ART_SWIRL_RING, ART_VORTEX_SMOKE, ART_WIND,
} from './art';
import { one } from './levelSpecs';

/**
 * A looping floor sprite that never blinks (r1: "the haste and shield floor rings are gone by t2.00": the old one was born, lived
 * exactly one cycle and respawned at alpha 0 on the cycle boundary). A ring lives 2.6 s and fades in and out over 0.6 s; a new one is
 * born every 2 s so consecutive rings cross-fade with a constant sum; the `intro` twin (alpha a -> 0 over the first 0.6 s) covers the
 * first fade-in. `spin` should be a multiple of 22.5 deg/s so a ring born 2 s later lines up with its predecessor on an 8 / 16-fold pattern.
 * Returns [ring A, ring B, intro ring].
 *
 * TWO interleaved emitters (A at 0 s, B at 2 s, each cycle 4 s, `max: 1`) instead of one emitter of cycle 2 s / max 2 (r2 first build):
 * the host scales the emission by `fx.density` (0.5 on the low tier) and the old 0.04 s burst then never reached one whole birth
 * (accumulator 0.76 < 1 at 1/60 s steps), so on the low tier the loop rings were gone after the intro (measured: low_final haste_t1.00
 * 0.03 % of the frame changed). The births now come from a 0.1 s window (rate 40 / s: 2 births at density 0.5, ~10 at density 1, ring
 * buffer of 1 = each birth replaces the previous one a few ms old: one ring on every tier), and `max: 1` keeps one alive ring per
 * emitter at every density (round(max x density) is 1 for 0.5 - 1.3).
 */
export function loopRing(note: string, half: number, hex: readonly [number, number, number], a: number, tex: ParticleSpec['tex'], blend: 'add' | 'alpha', extra: Partial<ParticleSpec> = {}): ParticleSpec[] {
  const L = 2.6;
  const F = 0.6;
  const base = { billboard: 'ground' as const, attach: true, blend, tex, half: [0, half] as number[], ...extra };
  const ring = (which: string, t0: number): ParticleSpec =>
    ({
      kind: 'particle',
      note: `${note} (loop ${which}: one ring every 4 s, 2.6 s long, cross-fading with the other emitter)`,
      t0,
      cycle: 4.0,
      loops: 0,
      max: 1,
      rate: [0, 40, 0.1, 40, 0.11, 0],
      life: [0, L],
      scale: [0, 0.97, 0.5, 1.0, 1, 0.97],
      color: [0, hex[0], 0, F / L, hex[1], a, 1 - F / L, hex[1], a, 1, hex[2], 0],
      ...base,
    }) as ParticleSpec;
  return [
    ring('A', 0),
    ring('B', 2.0),
    one({
      note: `${note} (intro twin: covers the first fade-in)`,
      life: [0, F],
      scale: [0, 0.97, 1, 0.98],
      color: [0, hex[1], a, 1, hex[1], 0],
      ...base,
    }),
  ];
}

/** Swiftness (10kwaesok): a turning ring of swirling arcs + the round swirling-scroll medallion on the floor, green wind wisps rising round the legs, 2-star sparks streaking up */
export const HASTE: FxSpec = {
  id: 'buff.haste',
  desc: 'Swiftness aura: turning green floor medallion, swirling arc ring, wind wisps, and rising sparks',
  behavior: 'persistentAura',
  ref: {},
  size: 'radius',
  base: 1.2,
  dur: 12,
  elements: [
    ...loopRing('kwaesok (alpha body): green floor glow', 1.95, [0x14902c, 0x14902c, 0x14902c], 0.68, ART_HAZE, 'alpha'),
    ...loopRing('kwaesok: swirling arcs ring turning on the floor', 1.85, [0x40f070, 0x40f070, 0x28c050], 1.0, ART_SWIRL_ARCS, 'add', { rotation: { start: [0, 0], spin: -45 }, bright: 1.9, occlude: 0.3, clamp: 1.25 }),
    ...loopRing('kwaesok 2: the round swirling-scroll medallion on the floor (twin swirling dragons / scrolls), static so the cross-fading rings stay aligned', 1.75, [0xd8ffa8, 0xb8ff98, 0x78e878], 1.0, ART_SWIRL_RING, 'add', { rotation: { start: [0, 0] }, bright: 2.6, occlude: 0.4, clamp: 1.2 }),
    {
      kind: 'particle',
      note: 'wind: soft green speed wisps rising round the legs',
      cycle: 0.5,
      loops: 0,
      max: 10,
      rate: [0, 20],
      life: [0, 0.55],
      shape: { kind: 'ellipse', radius: 0.85, edge: true },
      at: [0, 0.15, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.016],
      half: [[0, 0.1], [0, 0.65]],
      scale: [[0, 0.8, 1, 1], [0, 0.9, 1, 0.6]],
      color: [0, 0x90ffa8, 0, 0.2, 0x70f090, 0.8, 1, 0x40d068, 0],
      billboard: 'upright',
      rotation: { start: [90, 90] },
      attach: true,
      blend: 'add',
      bright: 1.4,
      tex: ART_WIND,
    },
    {
      kind: 'particle',
      note: '2-star: green sparks streaking up',
      cycle: 0.5,
      loops: 0,
      max: 12,
      rate: [0, 24],
      life: [0, 0.5],
      shape: { kind: 'ellipse', radius: 0.8, edge: false },
      at: [0, 0.2, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.02, 1, 0.034],
      half: [0, 0.2],
      scale: [0, 0.7, 1, 0.3],
      color: [0, 0xe8ffe0, 0, 0.2, 0xb0ffb8, 1, 1, 0x40d068, 0],
      billboard: 'screen',
      rotation: { start: [0, 90], spin: 60, randomDir: true },
      blend: 'add',
      tex: ART_STAR,
    },
  ],
};

/** Blessing (3hosin): a turning blue rune ring on the floor, soft blue pulses, upright soft rings, star sparks orbiting */
export const SHIELD: FxSpec = {
  id: 'buff.shield',
  desc: 'Ward aura: turning blue rune ring on the floor, breathing halo rings, and orbiting star sparks',
  behavior: 'persistentAura',
  ref: {},
  size: 'radius',
  base: 1.5,
  dur: 12,
  elements: [
    ...loopRing('white_sphere (alpha body): deep blue glow on the floor', 1.55, [0x2848c8, 0x2848c8, 0x2848c8], 0.42, ART_HAZE, 'alpha'),
    ...loopRing('roundpattern_1 copy: engraved blue rune ring turning on the floor', 1.45, [0x85d0ff, 0x85d0ff, 0x60a0ff], 0.85, ART_RUNE_RING, 'add', { rotation: { start: [0, 0], spin: 22.5 }, bright: 1.5, clamp: 1.2 }),
    ...loopRing('twin outline ring hugging the rune ring', 1.62, [0x70a8ff, 0x70a8ff, 0x4878ff], 0.6, ART_DOUBLE_RING, 'add', { bright: 1.2 }),
    {
      kind: 'particle',
      note: 'gyeokgong_triple_loop: soft halo ring standing round the body, breathing',
      cycle: 1.2,
      loops: 0,
      max: 2,
      rate: [0, 20],
      life: [0, 1.2],
      at: [0, 0.95, 0],
      half: [[0, 1.2], [0, 1.2]],
      scale: [0, 0.8, 0.5, 1.0, 1, 0.9],
      color: [0, 0x4878ff, 0, 0.3, 0x5a88ff, 0.45, 0.7, 0x4870f0, 0.3, 1, 0x3050d8, 0],
      billboard: 'screen',
      attach: true,
      blend: 'add',
      bright: 1.3,
      tex: ART_HALO_RING,
    },
    {
      kind: 'particle',
      note: '2-star: sparks orbiting the body (sphere r 1 m)',
      cycle: 1.0,
      loops: 0,
      max: 10,
      rate: [0, 12],
      life: [0, 1.1],
      shape: { kind: 'sphere', radius: 1.05, edge: true },
      at: [0, 0.95, 0],
      half: [0, 0.2],
      scale: [0, 0.6, 0.3, 1, 1, 0.4],
      color: [0, 0xffffff, 0, 0.2, 0xc8f0ff, 1, 1, 0x40a8ff, 0],
      billboard: 'screen',
      rotation: { start: [0, 90], spin: 40, randomDir: true },
      attach: true,
      blend: 'add',
      tex: ART_STAR,
    },
    {
      kind: 'particle',
      note: 'w_ring: one soft flash ring when the shield is cast',
      cycle: 0.1,
      max: 1,
      rate: [0, 60],
      life: [0, 0.5],
      half: [0, 1.5],
      scale: [0, 0.4, 0.6, 1.5, 1, 1.9],
      color: [0, 0xc8e8ff, 0.9, 0.5, 0x7fa8ff, 0.5, 1, 0x4060e0, 0],
      billboard: 'ground',
      attach: true,
      blend: 'add',
      tex: ART_HALO_RING,
    },
  ],
};


export const STEALTH: FxSpec = {
  id: 'buff.stealth',
  desc: 'Stealth: a dark violet smoke burst thrown wide round the body, a ragged smoke ring and a vortex on the floor, violet glints rising as the hero fades',
  behavior: 'selfBuff',
  ref: {},
  size: 'radius',
  base: 1.2,
  dur: 1.0,
  follow: true,
  elements: [
    {
      kind: 'particle',
      note: 'dark violet smoke puffs thrown out round the body (a wide ring, 3 m across)',
      cycle: 0.2,
      max: 14,
      rate: [0, 70],
      life: [0.35, 0.65],
      shape: { kind: 'ellipse', radius: 0.35, edge: true },
      at: [0, 0.8, 0],
      adv: 'outer',
      dir: { y: [0, 8] },
      vel: [0, 0.03],
      half: [0, 0.62],
      scale: [0, 0.5, 1, 1.6],
      color: [0, 0x4a3a78, 0.75, 0.5, 0x3a2c62, 0.55, 1, 0x2a2048, 0],
      air: [0, 0.05],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 40, randomDir: true },
      blend: 'alpha',
      tex: ART_SMOKE_LUMP,
    },
    {
      kind: 'particle',
      note: 'lighter violet smoke wisps (add) over the dark puffs',
      cycle: 0.2,
      max: 8,
      rate: [0, 40],
      life: [0.35, 0.6],
      shape: { kind: 'ellipse', radius: 0.35, edge: true },
      at: [0, 0.8, 0],
      adv: 'outer',
      vel: [0, 0.03],
      half: [0, 0.7],
      scale: [0, 0.5, 1, 1.5],
      color: [0, 0xb8a0ff, 0.5, 0.5, 0x9078e0, 0.34, 1, 0x6850c0, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 60, randomDir: true },
      blend: 'add',
      tex: ART_SMOKE_PUFF,
    },
    one({
      note: 'smoky floor ring: ragged dark violet smoke ring running out to 2.2 m',
      life: [0, 0.85],
      half: [0, 1.6],
      scale: [0, 0.4, 0.5, 1.15, 1, 1.4],
      color: [0, 0x6a52b8, 0.75, 0.5, 0x5a44a0, 0.5, 1, 0x403078, 0],
      billboard: 'ground',
      attach: true,
      blend: 'alpha',
      tex: ART_SMOKE_RING,
    }),
    one({
      note: 'violet vortex on the floor: curling smoke arms turning, hugging the feet',
      life: [0, 0.9],
      half: [0, 1.4],
      scale: [0, 0.5, 0.4, 1.0, 1, 1.15],
      color: [0, 0xb090ff, 0.5, 0.5, 0x8a68e8, 0.34, 1, 0x5a40b0, 0],
      billboard: 'ground',
      rotation: { start: [0, 0], spin: 90 },
      attach: true,
      blend: 'add',
      occlude: 0.2,
      tex: ART_VORTEX_SMOKE,
    }),
    {
      kind: 'particle',
      note: 'violet glints rising through the smoke',
      t0: 0.05,
      cycle: 0.5,
      max: 12,
      rate: [0, 26],
      life: [0, 0.8],
      shape: { kind: 'ellipse', radius: 0.9, edge: false },
      at: [0, 0.3, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.02, 1, 0.03],
      half: [0, 0.22],
      scale: [0, 0.6, 0.3, 1, 1, 0.3],
      color: [0, 0xffffff, 0, 0.2, 0xe0c8ff, 1, 1, 0x9060ff, 0],
      billboard: 'screen',
      rotation: { start: [0, 90], spin: 60, randomDir: true },
      blend: 'add',
      tex: ART_GLINT,
    },
    one({
      note: 'chest flash as the hero blinks out',
      life: [0, 0.25],
      half: [0, 1.0],
      scale: [0, 0.4, 0.3, 1, 1, 1.1],
      at: [0, 0.9, 0],
      color: [0, 0xe8d8ff, 0.7, 0.3, 0xb8a0ff, 0.45, 1, 0x7050d0, 0],
      billboard: 'screen',
      attach: true,
      blend: 'add',
      clamp: 1.1,
      tex: ART_GLOW,
    }),
  ],
};

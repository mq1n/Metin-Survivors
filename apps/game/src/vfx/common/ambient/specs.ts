

//

// critic read near-opaque cauliflower billows still at full density at 0.45 s. r3: the body is a VERY TRANSLUCENT, FINELY GRANULAR veil (vfx_ambient_dust_grain_sheet: thousands of fine grains,
// dense centre, sparse grains at a ragged rim; alpha is the brightest channel of the sprite), peak colour alpha ~0.5, full only until ~0.3 s, gone by ~0.5 s. A faint cool SHADOW underlay (the same

// snow and pale stone; the sprite is NEUTRAL, so the colour of a puff is exactly the authored key x the zone tint (`tint: true`, dustFeed.ts / dustTint.ts).
// Ground clipping: a screen-facing quad of half size h whose centre is lower than 0.57 h dips below the floor at the 55 deg game camera (the spec particle shader has no soft-depth
// fade), so every puff is lifted to y >= 0.57 x its peak half size.
import type { FxSpec, ParticleSpec } from '../../spec/types';
import { AMBIENT_ART_SPECS, ART_DUST_GRAIN } from './art';
import { DUST_AUTHORED } from './dustTint';

/** the authored near-white of the foot dust (what an untinted gallery spawn shows); the zone tint multiplies it down to the zone's lit tone */
const AU = DUST_AUTHORED;
/** it a little greyer as the puff thins out (a thin dust veil is greyer than its dense core) */
const AU_MID = 0xf1f3e6;
const AU_END = 0xe4e7d6;
/** the cool soft shadow underlay (x the zone tint): blue-grey, darker than the lit powder by ~0.4 so a white-blue puff keeps an edge on snow */
const SH = 0x6578a6;
const SH_END = 0x586a92;

// -------------------------------------------------------------------------------------------------- dust
const DUST: FxSpec = {
  id: 'sk.gen.dust',
  desc: '',
  behavior: 'selfBuff',
  ref: {},
  size: 'radius',
  base: 1,
  dur: 0.55,
  tint: true,
  elements: [
    {
      kind: 'particle',
      note: 'soft shadow underlay: the same granular veil, larger, cool blue-grey, alpha <= 0.3: gives the lit powder an edge on a pale floor (snow) without a body darker than the floor',
      cycle: 0.2,
      max: 1,
      rate: [0, 8],
      life: [0, 0.46],
      shape: { kind: 'sphere', radius: 0.12 },
      at: [0, 0.5, 0],
      dir: { y: [0, 14], z: [0, -90] },
      jitter: [0.05, 0.01, 0.05],
      vel: [0, 0.007],
      half: [0, 0.9],
      scale: [0, 0.5, 0.6, 0.97, 1, 1.05],
      color: [0, SH, 0, 0.14, SH, 0.7, 0.62, SH_END, 0.52, 1, SH_END, 0],
      gravity: [0, 0.3],
      air: [0, 0.07],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 8, randomDir: true },
      blend: 'alpha',
      tex: ART_DUST_GRAIN,
      frames: { fps: 0.001, random: true },
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.2,
      max: 3,
      rate: [0, 16],
      life: [0, 0.46],
      shape: { kind: 'sphere', radius: 0.14 },
      at: [0, 0.46, 0],
      dir: { y: [0, 22], z: [0, -100] },
      jitter: [0.06, 0.01, 0.06],
      vel: [0, 0.008],
      half: [0, 0.64],
      scale: [0, 0.45, 0.6, 0.97, 1, 1.05],
      
      color: [0, AU, 0, 0.12, AU, 0.95, 0.62, AU_MID, 0.75, 1, AU_END, 0],
      gravity: [0, 0.3],
      air: [0, 0.07],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 14, randomDir: true },
      blend: 'alpha',
      tex: ART_DUST_GRAIN,
      frames: { fps: 0.001, random: true },
    },
    {
      kind: 'particle',
      note: '',
      t0: 0.04,
      cycle: 0.2,
      max: 2,
      rate: [0, 12],
      life: [0, 0.4],
      shape: { kind: 'sphere', radius: 0.12 },
      at: [0, 0.34, 0],
      dir: { y: [0, 20], z: [0, -100] },
      jitter: [0.1, 0.01, 0.05],
      vel: [0, 0.014],
      half: [0, 0.46],
      scale: [0, 0.5, 0.6, 0.96, 1, 1.05],
      color: [0, AU, 0, 0.14, AU, 0.8, 0.6, AU_MID, 0.6, 1, AU_END, 0],
      gravity: [0, 0.4],
      air: [0, 0.08],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 24, randomDir: true },
      blend: 'alpha',
      tex: ART_DUST_GRAIN,
      frames: { fps: 0.001, random: true },
    },
    {
      kind: 'particle',
      note: 'grit: a few small grain puffs flung back and sinking (gravity), tiny, in the body tone (clods of the floor, never dark pebbles)',
      cycle: 0.12,
      max: 4,
      rate: [0, 36],
      life: [0, 0.4],
      shape: { kind: 'sphere', radius: 0.1 },
      at: [0, 0.3, 0],
      dir: { y: [0, 60], z: [0, -100] },
      jitter: [0.08, 0.02, 0.04],
      vel: [0, 0.011],
      half: [0, 0.1],
      scale: [0, 0.7, 1, 1.2],
      color: [0, AU_MID, 0.8, 0.5, AU_MID, 0.6, 1, AU_END, 0],
      gravity: [0, 2.4],
      air: [0, 0.08],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 90, randomDir: true },
      blend: 'alpha',
      tex: ART_DUST_GRAIN,
      frames: { fps: 0.001, random: true },
    },
  ],
};

// -------------------------------------------------------------------------------------------------- running dust

function cloud(note: string, n: number, half: number, alpha: number, life: number, lift: number, key: number = AU, keyEnd: number = AU_END): ParticleSpec {
  return {
    kind: 'particle',
    note,
    cycle: 0.5,
    max: n,
    rate: [0, 80, 0.14, 80, 0.15, 0],
    life: [0, life],
    shape: { kind: 'sphere', radius: 0.28 },
    // centre height >= 0.57 x the peak half size: the lower edge of the screen-facing quad stays above the floor (no hard horizontal cut)
    at: [0, lift, 0],
    dir: { y: [0, 30], z: [0, -150] },
    jitter: [0.06, 0.02, 0.05],
    vel: [0, 0.011],
    half: [0, half],
    scale: [0, 0.45, 0.55, 0.96, 1, 1.1],
    // running_dust: #4c483f -> #6c6a65 a0.63 -> #979797 a0 under a #ffe775 tint = a pale yellow-grey dust; ours: the same family as the foot dust, a translucent veil, thinning out
    color: [0, key, 0, 0.12, key, alpha, 0.55, key, alpha * 0.75, 1, keyEnd, 0],
    air: [0, 0.02, 0.12, 0.1],
    billboard: 'screen',
    rotation: { start: [0, 360], spin: 40, randomDir: true },
    blend: 'alpha',
    tex: ART_DUST_GRAIN,
    frames: { fps: 0.001, random: true },
  };
}

const RUNNING_DUST: FxSpec = {
  id: 'sk.gen.running_dust',
  desc: '',
  behavior: 'selfBuff',
  ref: {},
  size: 'radius',
  base: 1,
  dur: 0.9,
  tint: true,
  elements: [
    cloud('soft shadow underlay of the cloud: the same granular veil, larger and cool blue-grey, alpha <= 0.4', 4, 0.8, 0.4, 0.5, 0.72, SH, SH_END),
    cloud('vfx_ambient_dust_grain_sheet: the granular body of the cloud, 8 puffs in the first 0.14 s thrown up and back, visible peak ~1.1 m each, peak alpha 0.5', 8, 0.62, 0.95, 0.46, 0.62),
    cloud('dust grain second layer: a larger, fainter veil of the same grain behind and above the cloud (the cloud is deeper than one sprite)', 4, 0.9, 0.6, 0.7, 0.8),
    {
      kind: 'particle',
      note: '',
      cycle: 0.15,
      max: 5,
      rate: [0, 36],
      life: [0, 0.7],
      shape: { kind: 'sphere', radius: 0.14 },
      at: [0, 0.3, 0],
      dir: { y: [0, 80], z: [0, -90] },
      jitter: [0.07, 0.02, 0.05],
      vel: [0, 0.011],
      half: [0, 0.1],
      scale: [0, 0.8, 1, 1],
      color: [0, 0xd8d0b4, 0.7, 0.7, 0xd8d0b4, 0.6, 1, 0xd8d0b4, 0],
      gravity: [0, 14],
      air: [0, 0.01, 0.2, 0.03],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 420, randomDir: true },
      blend: 'alpha',
      tex: ART_DUST_GRAIN,
      frames: { fps: 0.001, random: true },
    },
  ],
};

export const specs: FxSpec[] = [
  DUST,
  RUNNING_DUST,
  ...AMBIENT_ART_SPECS,
];

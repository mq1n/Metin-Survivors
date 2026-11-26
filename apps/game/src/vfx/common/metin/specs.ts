// Metin stone corruption loops (common VFX target `metin`; owner: the metin builder): the 9 colour sets x 4 HP stages as persistent-aura FxSpecs.
// The one-shot specs (drop, crash, blow, laser, break, splash) live in ./specsEvent.ts. Spec format + workflow: ../../spec/README.md;
// ids are the contract (../README.md).
import type { ArtTex, ColorCurve, FxSpec, ParticleSpec } from '../../spec/types';
import { ART_DISC_DIM, ART_PIP, ART_RING_RAGGED, ART_SMOKE_MASS, METIN_ART_SPECS } from './art';
import { EVENT_SPECS, el } from './specsEvent';



export const METIN_LOOP_SETS = ['green', 'aqua', 'blue', 'orange', 'pink', 'purple', 'whitepurple', 'whitered', 'yellow'] as const;

export type MetinLoopSet = (typeof METIN_LOOP_SETS)[number];

export type MetinLoopStage = 1 | 2 | 3 | 4;

interface LoopPalette {
  /** central column (stage 4 dense column / stage 1 thin swirl), wisp ring (ellipse), puff shell (sphere) */
  core: number;
  halo: number;
  puff: number;
  /** stage 1 core colour when it differs (white sets) */
  core1?: number;
  /** colour every element fades to (puff of whitepurple fades to grey) */
  end: number;
  puffEnd?: number;
  
  a: readonly [number, number, number];
  /** hue (deg) / saturation used by metinLoopId to match a rune colour */
  hue: number;
  sat: number;
}


const LOOP_PALETTES: Record<MetinLoopSet, LoopPalette> = {
  green: { core: 0x36f172, halo: 0x26c55a, puff: 0x37f474, end: 0x006124, a: [1, 1, 1], hue: 138, sat: 0.78 },
  aqua: { core: 0x3be6e9, halo: 0x29bbbd, puff: 0x3debee, end: 0x005557, a: [1, 1, 1], hue: 181, sat: 0.75 },
  blue: { core: 0x394deb, halo: 0x2839c0, puff: 0x3b4fee, end: 0x000a59, a: [1, 1, 1], hue: 233, sat: 0.76 },
  orange: { core: 0xfa993e, halo: 0xc27228, puff: 0xfa993e, end: 0x5c2c00, a: [0.69, 1, 0.76], hue: 29, sat: 0.75 },
  pink: { core: 0xf244ca, halo: 0xba2c9a, puff: 0xf244ca, end: 0x540041, a: [0.72, 1, 0.78], hue: 313, sat: 0.72 },
  purple: { core: 0x853de9, halo: 0x682bbd, puff: 0x883fed, end: 0x240057, a: [1, 1, 1], hue: 265, sat: 0.74 },
  whitepurple: { core: 0x853de9, halo: 0x682bbd, puff: 0xf5f5f5, core1: 0xfcf9ff, end: 0x240057, puffEnd: 0x575757, a: [1, 1, 0.76], hue: 268, sat: 0.3 },
  whitered: { core: 0xf2f2f2, halo: 0xff0000, puff: 0xff0000, core1: 0xfff45a, end: 0x540000, a: [0.7, 0.3, 0.74], hue: 0, sat: 0.75 },
  yellow: { core: 0xfcfc3d, halo: 0xc3c327, puff: 0xfcfc3d, end: 0x5e5e00, a: [0.67, 1, 0.77], hue: 55, sat: 0.76 },
};



function dim(hex: number, k: number): number {
  return (Math.round(((hex >> 16) & 255) * k) << 16) | (Math.round(((hex >> 8) & 255) * k) << 8) | Math.round((hex & 255) * k);
}

function loopColor(mid: number, end: number, peakT: number, peak: number): ColorCurve {
  return [0, dim(mid, 0.55), 0, 0.18, dim(mid, 0.9), peak * 0.6, peakT, mid, Math.min(1, peak), 1, end, 0];
}

/** pools of sprites per layer: ONE random frame per particle (several different filament shapes, no repeats side by side) */
const WISP_SET: ArtTex = { art: ['vfx_metin_wisp_curl', 'vfx_wisp_smoke_threads_a', 'vfx_metin_wisp_curl', 'vfx_wisp_tangle_a', 'vfx_curl_s_thin_a'], fallback: 'wisp' };
/** the stage-4 swirling core: the swirl ball and the curl cloud (one random frame per puff) */
const CORE_SET: ArtTex = { art: ['vfx_wisp_swirl_ball_a', 'vfx_metin_wisp_curl'], fallback: 'wisp' };
const CLOUD_SET: ArtTex = { art: ['vfx_cloud_puff_mottled_a', 'vfx_smoke_puff_faint_a'], fallback: 'cloud' };









function loopElements(p: LoopPalette, stage: MetinLoopStage): ParticleSpec[] {
  const out: ParticleSpec[] = [];
  const A = p.a;
  const s = stage;
  const deep = dim(p.halo, 0.62);
  
  out.push(
    el({
      note: '',
      loops: 0,
      cycle: 1.2,
      max: 2,
      rate: [0, 2],
      life: [0, 1.6],
      at: [0, -0.28, 0],
      half: [0, 0.9 + 0.22 * s],
      scale: [0, 0.8, 0.5, 1, 1, 1.08],
      color: [0, p.halo, 0, 0.3, p.halo, (0.2 + 0.07 * s) * A[1], 0.7, p.halo, (0.16 + 0.05 * s) * A[1], 1, p.end, 0],
      bright: 1.3,
      billboard: 'ground',
      attach: true,
      blend: 'add',
      tex: ART_DISC_DIM,
    }),
  );
  // --- alpha body: the smoke keeps its colour on snow (deep rune colour, low alpha) ---
  out.push(
    el({
      note: 'curling corruption smoke as an alpha body in the deep rune colour: a coloured haze hugging the stone that survives bright floors',
      loops: 0,
      cycle: 0.5,
      max: 4 + 2 * s,
      rate: [0, 2.2 + 1.6 * s],
      life: [0, 1.25],
      shape: { kind: 'ellipse', radius: 0.4 },
      at: [0, 0.35, 0],
      dir: { y: [0, 1] },
      vel: [0, 0.5 + 0.08 * s],
      half: [0, 0.5 + 0.06 * s],
      scale: [0, 0.6, 0.5, 1.05, 1, 1.25],
      color: [0, deep, 0, 0.22, deep, (0.2 + 0.07 * s) * A[1], 0.7, deep, 0.14 * A[1], 1, dim(p.end, 0.8), 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 30, randomDir: true },
      attach: true,
      blend: 'alpha',
      tex: ART_SMOKE_MASS,
    }),
  );
  // --- the tail of curling wisps (stage 1 = the thin tail; denser and taller with the stage) ---
  out.push(
    el({
      note: '',
      loops: 0,
      cycle: 0.5,
      max: 5 + 3 * s,
      rate: [0, 2.4 + 1.9 * s],
      life: [0, 1.15 + 0.12 * s],
      shape: { kind: 'ellipse', radius: 0.46 },
      at: [0, 0.2, 0],
      dir: { y: [0, 1] },
      vel: [0, 0.78 + 0.14 * s],
      half: [0, 0.5 + 0.05 * s],
      scale: [0, 0.55, 0.45, 1, 1, 1.2],
      color: [0, dim(p.core1 ?? p.core, 0.6), 0, 0.16, p.core1 ?? p.core, (0.55 + 0.1 * s) * A[0], 0.6, p.halo, (0.5 + 0.1 * s) * A[1], 1, p.end, 0],
      bright: 1.5,
      occlude: 0.18,
      clamp: 1.25,
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 55, randomDir: true },
      swirl: [0, s === 1 ? 6 : 2.5],
      attach: true,
      blend: 'add',
      tex: WISP_SET,
      frames: { fps: 0.001, random: true },
    }),
  );
  // --- puff shell hugging the stone body (stage 2+) ---
  if (s >= 2) {
    out.push(
      el({
        note: '',
        loops: 0,
        cycle: 0.5,
        max: 6 + 3 * s,
        rate: [0, 5 + 2.5 * s],
        life: [0, 0.72],
        shape: { kind: 'ellipse', radius: 0.5, edge: true },
        at: [0, 0.25, 0],
        dir: { y: [0, 1] },
        vel: [0, 0.65],
        half: [0, 0.6],
        scale: [0, 0.55, 0.55, 1, 1, 0.9],
        color: [0, dim(p.puff, 0.55), 0, 0.2, p.puff, (0.35 + 0.1 * s) * A[2], 0.62, p.halo, (0.28 + 0.08 * s) * A[2], 1, p.puffEnd ?? p.end, 0],
        bright: 1.4,
        occlude: 0.2,
        clamp: 1.2,
        billboard: 'screen',
        rotation: { start: [0, 360], spin: 105, randomDir: true },
        attach: true,
        blend: 'add',
        tex: CLOUD_SET,
        frames: { fps: 0.001, random: true },
      }),
    );
  }
  // --- the smoke-ring core (stage 3: dim, 4: the big swirling column) ---
  if (s >= 3) {
    out.push(
      el({
        note: s === 3 ? 'dim swirling smoke ring above the stone' : 'the big swirling core column rising off the stone',
        loops: 0,
        cycle: 0.5,
        max: s === 3 ? 4 : 6,
        rate: [0, s === 3 ? 4 : 7],
        life: [0, 0.95],
        shape: { kind: 'box', box: [0.25, 0, 0.25] },
        at: [0, 0.55, 0],
        dir: { y: [0, 1] },
        vel: [0, s === 3 ? 0.7 : 0.95],
        half: [0, s === 3 ? 0.62 : 0.8],
        scale: [0, 0.6, 0.45, 1, 1, 0.85],
        color: [0, dim(p.core, 0.55), 0, 0.18, p.core, (s === 3 ? 0.5 : 0.82) * A[0], 0.6, p.core, (s === 3 ? 0.4 : 0.66) * A[0], 1, p.end, 0],
        bright: 1.5,
        occlude: 0.2,
        clamp: 1.25,
        billboard: 'screen',
        rotation: { start: [0, 360], spin: 65, randomDir: true },
        attach: true,
        blend: 'add',
        tex: s === 3 ? ART_RING_RAGGED : CORE_SET,
        ...(s === 4 ? { frames: { fps: 0.001, random: true } } : {}),
      }),
    );
  }
  // --- stage 4: a second, taller filament layer + rising sparks of rune light ---
  if (s >= 4) {
    out.push(
      el({
        note: 'stage 4 column: tall thin filaments streaming well above the stone',
        loops: 0,
        cycle: 0.5,
        max: 7,
        rate: [0, 5],
        life: [0, 1.7],
        shape: { kind: 'ellipse', radius: 0.35 },
        at: [0, 0.8, 0],
        dir: { y: [0, 1] },
        vel: [0, 1.15],
        half: [[0, 0.32], [0, 0.85]],
        scale: [0, 0.6, 0.5, 1, 1, 1.15],
        color: [0, dim(p.core, 0.5), 0, 0.15, p.core, 0.7 * A[0], 0.6, p.halo, 0.5 * A[1], 1, p.end, 0],
        bright: 1.4,
        occlude: 0.12,
        billboard: 'upright',
        attach: true,
        blend: 'add',
        tex: { art: 'vfx_curl_s_thin_a', fallback: 'wisp' },
      }),
      el({
        note: 'sparks of rune light lifting off the stone',
        loops: 0,
        cycle: 0.5,
        max: 14,
        rate: [0, 9],
        life: [0, 1.3],
        shape: { kind: 'ellipse', radius: 0.5 },
        at: [0, 0.3, 0],
        dir: { y: [0, 1] },
        vel: [0, 1.3],
        half: [0, 0.07],
        scale: [0, 1, 0.5, 1, 1, 0.3],
        color: [0, p.core1 ?? p.core, 1, 0.6, p.core, 0.8, 1, p.halo, 0],
        bright: 1.8,
        billboard: 'screen',
        attach: true,
        blend: 'add',
        tex: ART_PIP,
      }),
    );
  }
  return out;
}

/** ChamferCyl04 (stone body bone of race 8001) height above the stone's feet, metres (measured on the reference). */
const LOOP_LIFT = 0.85;

function loopId(set: MetinLoopSet, stage: MetinLoopStage): string {
  return set === 'green' ? `sk.gen.metin_loop${stage}` : `sk.gen.metin_loop${stage}.${set}`;
}

function loopSpec(set: MetinLoopSet, stage: MetinLoopStage): FxSpec {  return {
    id: loopId(set, stage),
    desc: `Metin smoke stage ${stage} (${set}): rift stone ${set} smoke wisps curling up around the stone body`,
    behavior: 'persistentAura',
    ref: {},
    size: 'radius',
    base: 1,
    dur: 1,
    lift: LOOP_LIFT,
    fadeOut: 0.5,
    elements: loopElements(LOOP_PALETTES[set], stage),
  };
}

const STAGES: readonly MetinLoopStage[] = [1, 2, 3, 4];

const LOOPS: FxSpec[] = METIN_LOOP_SETS.flatMap((set) => STAGES.map((stage) => loopSpec(set, stage)));

/** Smallest angle between two hues, degrees. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}





export function metinLoopId(rgb: number, stage: MetinLoopStage): string {
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;
  const sat = max > 0 ? c / max : 0;
  if (sat < 0.12) return loopId('whitepurple', stage);
  let hue = c === 0 ? 0 : max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  hue = (hue * 60 + 360) % 360;
  let best: MetinLoopSet = 'green';
  let bestD = Infinity;
  for (const set of METIN_LOOP_SETS) {
    const p = LOOP_PALETTES[set];
    const d = hueGap(hue, p.hue) / 180 + 0.6 * Math.abs(sat - p.sat);
    if (d < bestD) {
      bestD = d;
      best = set;
    }
  }
  return loopId(best, stage);
}

export const specs: FxSpec[] = [...EVENT_SPECS, ...LOOPS, ...METIN_ART_SPECS];

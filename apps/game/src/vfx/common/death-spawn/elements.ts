// Death + spawn FxSpec element builders (common VFX target `death-spawn`; owner: the death-spawn builder). Rebuilt r1 (2026-10-19), reworked r2


//   death  = a SMALL burst of translucent dark plum-maroon smoke puffs thrown up from a hip-height box, ~0.5 s, alpha blended,
//            no flash, no ring, no ground decal: the corpse stays readable (elite / boss: the same smoke, bigger, with chunks flung out of the
//            silhouette and a slow tail rising on)
//   appear = a near-black violet smoky vortex (an OPAQUE ragged mass, spiral strands on it) with feathered edges lying close to the ground, a dim
//            rim that opens, shrinks and ends as a thin pale broken ring at ~0.5 s, a few orange-red specks sucked in
//   corrupt = monster_change: dirty grey smoke puffs thrown out of a dark ground patch + a turning ragged ring (no vortex)
// Lengths are metres for a scale-1 body (k = 1: the route sizes the spec from the creature's radius, route.ts `puffScale`).
// Billboard axes: for SCREEN quads the first scale / half curve sizes the texture's vertical axis (spec/README "ground quads ...").
import type { ColorCurve, FxSpec, ParticleSpec, Vec3 } from '../../spec/types';
import { ART_DUST_BLOT, ART_GRIME, ART_LIT_RING, ART_RING_RAGGED, ART_SMOKE_GRAIN, ART_SMOKE_SOFT, ART_SPECK, ART_VORTEX_ARCS, ART_VORTEX_DISC, ART_VORTEX_MASS, ART_VORTEX_STRANDS } from './art';

// ---------------------------------------------------------------------------------------------------------------- death

interface DieOpts {
  /** puffs of the soft body layer / the maroon core layer / the granular layer */
  soft: number;
  core: number;
  grain: number;
  /** quad half size of a puff (m) */
  half: number;
  /** emit box, full extents (m) */
  box: Vec3;
  /** emitter height above the feet (m): the hip */
  lift: number;
  
  up: number;
  /** puff life range over the emission window (s) */
  life: readonly [number, number];
  /** peak alpha of the body layer */
  alpha: number;
  /** start time of the whole burst (s) */
  t0?: number;
  /** draw in front of the body (big bodies hide the cloud inside their own volume) */
  front?: boolean;
  /** lumps flung sideways out of the cloud (elite / boss: they break the silhouette) */
  fling?: number;
}

/** plum-maroon -> dark maroon fade of one puff; `a` = peak alpha */
function puffColor(a: number, hi: number, mid: number, lo: number): ColorCurve {
  return [0, hi, 0, 0.1, hi, a, 0.42, mid, a * 0.82, 1, lo, 0];
}

function bodySmoke(o: DieOpts): ParticleSpec {
  return {
    kind: 'particle',
    note: '',
    t0: o.t0,
    cycle: 0.06,
    max: o.soft,
    rate: [0, 900],
    life: [0, o.life[0], 0.06, o.life[1]],
    shape: { kind: 'box', box: o.box },
    at: [0, o.lift, 0],
    adv: 'outer',
    dir: { y: [0, o.up] },
    jitter: [0.05, 0, 0.05],
    vel: [0, 0.01],
    half: [0, o.half],
    scale: [0, 0.6, 1, 1.25],
    color: puffColor(o.alpha, 0x56183c, 0x44102e, 0x34102a),
    gravity: [0, 0.6],
    air: [0, 0, 0.2, 0.06],
    billboard: 'screen',
    rotation: { start: [0, 360], spin: 40, randomDir: true },
    blend: 'alpha',
    tex: ART_SMOKE_SOFT,
    frames: { fps: 0.001, random: true },
    front: o.front === true ? true : undefined,
  };
}

function coreSmoke(o: DieOpts): ParticleSpec {
  return {
    kind: 'particle',
    note: '',
    t0: o.t0,
    cycle: 0.06,
    max: o.core,
    rate: [0, 600],
    life: [0, o.life[0] * 0.88, 0.06, o.life[1] * 0.85],
    shape: { kind: 'box', box: [o.box[0] * 0.75, o.box[1] * 0.7, o.box[2] * 0.75] },
    at: [0, o.lift, 0],
    adv: 'outer',
    dir: { y: [0, o.up * 0.85] },
    jitter: [0.05, 0, 0.05],
    vel: [0, 0.009],
    half: [0, o.half * 0.72],
    scale: [0, 0.7, 1, 1.2],
    color: puffColor(o.alpha * 0.72, 0x400e28, 0x2e0a1e, 0x180610),
    gravity: [0, 0.6],
    air: [0, 0, 0.2, 0.12],
    billboard: 'screen',
    rotation: { start: [0, 360], spin: 40, randomDir: true },
    blend: 'alpha',
    tex: ART_DUST_BLOT,
    frames: { fps: 0.001, random: true },
    front: o.front === true ? true : undefined,
  };
}

function grainSmoke(o: DieOpts): ParticleSpec {
  return {
    kind: 'particle',
    note: 'dust copy grain: speckled dusty clumps (alpha) so the cloud edge is grainy, not an airbrushed ball',
    t0: o.t0,
    cycle: 0.06,
    max: o.grain,
    rate: [0, 600],
    life: [0, o.life[0] * 0.9, 0.06, o.life[1] * 0.92],
    shape: { kind: 'box', box: o.box },
    at: [0, o.lift, 0],
    adv: 'outer',
    dir: { y: [0, o.up * 1.1] },
    jitter: [0.08, 0, 0.08],
    vel: [0, 0.01],
    half: [0, o.half * 0.95],
    scale: [0, 0.7, 1, 1.3],
    color: puffColor(o.alpha * 0.62, 0x5c1c42, 0x44142e, 0x260c1c),
    gravity: [0, 0.6],
    air: [0, 0, 0.2, 0.1],
    billboard: 'screen',
    rotation: { start: [0, 360], spin: 55, randomDir: true },
    blend: 'alpha',
    tex: ART_SMOKE_GRAIN,
    front: o.front === true ? true : undefined,
  };
}

/** lumps of the same smoke flung sideways out of the cloud: elite / boss clouds must break the body's silhouette, not dye its middle */
function flingSmoke(n: number, o: DieOpts, speed: number, shell: number, alpha: number, size: number): ParticleSpec {
  return {
    kind: 'particle',
    note: 'elite / boss: dark dust lumps thrown OUT of the cloud (adv outer from a shell round the body) so the smoke has a lumpy detached silhouette beyond the outline',
    t0: o.t0 !== undefined ? o.t0 : 0.02,
    cycle: 0.08,
    max: n,
    rate: [0, 500],
    life: [0, o.life[0] * 1.05, 0.08, o.life[1] * 1.1],
    shape: { kind: 'sphere', radius: shell, edge: true },
    at: [0, o.lift + 0.05, 0],
    adv: 'outer',
    dir: { y: [0, o.up * 0.3] },
    vel: [0, speed],
    half: [0, o.half * size],
    scale: [0, 0.55, 1, 1.35],
    color: puffColor(alpha, 0x56183c, 0x44102e, 0x34102a),
    gravity: [0, 0.6],
    air: [0, 0, 0.3, 0.1],
    billboard: 'screen',
    rotation: { start: [0, 360], spin: 60, randomDir: true },
    blend: 'alpha',
    tex: ART_SMOKE_SOFT,
    frames: { fps: 0.001, random: true },
    front: true,
    minTier: 1,
  };
}

/** a skirt of dust thrown out along the floor round the body (elite / boss: the weight of the fall; puffs, not a ring) */
function skirtSmoke(n: number, o: DieOpts, speed: number, alpha: number, size: number): ParticleSpec {
  return {
    kind: 'particle',
    note: 'elite / boss: low dust billows thrown outward along the floor from the feet (a skirt of puffs, never a ring or a decal)',
    t0: o.t0 !== undefined ? o.t0 + 0.03 : 0.05,
    cycle: 0.1,
    max: n,
    rate: [0, 400],
    life: [0, o.life[0] * 1.1, 0.1, o.life[1] * 1.2],
    shape: { kind: 'sphere', radius: o.box[0] * 0.5, edge: true },
    at: [0, 0.25, 0],
    adv: 'outer',
    dir: { y: [0, 8] },
    vel: [0, speed],
    half: [0, o.half * size],
    scale: [0, 0.5, 1, 1.4],
    color: puffColor(alpha, 0x501836, 0x3a102a, 0x1e0816),
    gravity: [0, 0],
    air: [0, 0, 0.2, 0.12],
    billboard: 'screen',
    rotation: { start: [0, 360], spin: 45, randomDir: true },
    blend: 'alpha',
    tex: ART_SMOKE_SOFT,
    frames: { fps: 0.001, random: true },
    minTier: 1,
  };
}

/** a slow rising tail of dark smoke (bosses / elites only): the same smoke, just longer and taller */
function tailSmoke(n: number, half: number, rise: number, life: number, alpha: number, t0: number, lift: number, spread: number): ParticleSpec {
  return {
    kind: 'particle',
    note: 'elite / boss death: the same dark plum smoke, a few big slow lumps rising on after the burst (visible 0.5 - 1.0 s)',
    t0,
    cycle: 0.14,
    max: n,
    rate: [0, 300],
    life: [0, life, 0.14, life * 1.2],
    shape: { kind: 'box', box: [spread, 0.4, spread] },
    at: [0, lift, 0],
    adv: 'outer',
    dir: { y: [0, rise] },
    jitter: [0.06, 0, 0.06],
    vel: [0, 0.01],
    half: [0, half],
    scale: [0, 0.5, 1, 1.45],
    color: [0, 0x501a3a, 0, 0.2, 0x421430, alpha, 0.6, 0x30102a, alpha * 0.78, 1, 0x1e0818, 0],
    gravity: [0, -0.1],
    air: [0, 0, 0.5, 0.04],
    billboard: 'screen',
    rotation: { start: [0, 360], spin: 25, randomDir: true },
    blend: 'alpha',
    tex: ART_DUST_BLOT,
    frames: { fps: 0.001, random: true },
    front: true,
    minTier: 1,
  };
}

export interface DieSpecOpts extends Partial<DieOpts> {
  /** boss tail puffs (0 = none) */
  tail?: number;
  /** tail puff life as a share of the burst's longest puff life (default 1.4) */
  tailLife?: number;
  /** tail emit box width (m) */
  tailSpread?: number;
  /** second burst after this delay (s), 0 = none */
  again?: number;
  /** flung lumps: speed (m/s per k), emit shell radius (m), alpha, size share of `half` */
  flingSpeed?: number;
  flingShell?: number;
  flingAlpha?: number;
  flingSize?: number;
  /** skirt puffs thrown along the floor (0 = none) + speed / alpha / size share */
  skirt?: number;
  skirtSpeed?: number;
  skirtAlpha?: number;
  skirtSize?: number;
}

const DIE_BASE: DieOpts = {
  soft: 8,
  core: 3,
  grain: 3,
  half: 1.2,
  box: [0.4, 0.3, 0.4],
  lift: 0.55,
  up: 165,
  life: [0.34, 0.5],
  alpha: 0.58,
};

export function dieSpec(id: string, desc: string, o: DieSpecOpts = {}): FxSpec {
  const d: DieOpts = { ...DIE_BASE, ...o };
  const els: ParticleSpec[] = [bodySmoke(d), coreSmoke(d), grainSmoke({ ...d, grain: d.grain })];
  if (d.fling && d.fling > 0) els.push(flingSmoke(d.fling, d, o.flingSpeed ?? 0.016, o.flingShell ?? d.box[0] * 0.3, o.flingAlpha ?? d.alpha * 0.9, o.flingSize ?? 0.55));
  if (o.skirt && o.skirt > 0) els.push(skirtSmoke(o.skirt, d, o.skirtSpeed ?? 0.012, o.skirtAlpha ?? d.alpha * 0.8, o.skirtSize ?? 0.5));
  if (o.again && o.again > 0) {
    const d2: DieOpts = { ...d, t0: o.again, soft: Math.ceil(d.soft * 0.5), core: Math.ceil(d.core * 0.5), grain: Math.ceil(d.grain * 0.5), half: d.half * 1.05, alpha: d.alpha * 0.55, up: d.up * 0.8 };
    els.push(bodySmoke(d2), coreSmoke(d2));
  }
  if (o.tail && o.tail > 0) els.push(tailSmoke(o.tail, d.half * 0.95, d.up * 0.6, d.life[1] * (o.tailLife ?? 1.4), d.alpha * 0.8, 0.1, d.lift + 0.2, o.tailSpread ?? 0.7));
  return {
    id,
    desc,
    behavior: 'selfBuff',
    ref: {},
    size: 'radius',
    base: 1,
    dur: 0.6,
    elements: els,
  };
}

// --------------------------------------------------------------------------------------------------------------- appear

interface AppearOpts {
  /** vortex colours: strands (violet / crimson, the spiral arcs), core (near-black mass), rim (the lit ring) */
  strands: number;
  core: number;
  rim: number;
  /** red specks drawn sucked into the vortex */
  specks: number;
  /** half size of the vortex disc, m */
  half: number;
  /** extra smoke puffs collapsing into the centre */
  puffs: number;
  /** peak alpha of the dark mass / strands layer */
  alpha: number;
  /** peak alpha of the lit ring (first pass) */
  rimAlpha?: number;
  /** elite: a few dark smoke lumps boiling up out of the vortex centre */
  rise?: number;
  /** elite: a second, pink lit ring after the first */
  twin?: boolean;
  /** the band-spawn whisper: arcs + a small dark mass + the lit ring (3 particles) */
  lite?: boolean;
  
  upright?: boolean;
}

/** linear mix of two 0xRRGGBB colours */
function mix(a: number, b: number, t: number): number {
  const ch = (sh: number): number => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}








function appearElements(o: AppearOpts): ParticleSpec[] {
  const ra = o.rimAlpha ?? 0.8;
  const arms = mix(o.core, o.strands, 0.85);
  const dark = mix(o.core, o.strands, 0.3);
  const up = o.upright !== false;
  const bb: 'screen' | 'ground' = up ? 'screen' : 'ground';
  // standing disc: centre at hip height, the lowest edge just above the floor; ground decal: lying on the floor
  const y0 = up ? o.half * 0.5 : 0.05;
  const dy = up ? 0.014 : 0.006;
  const ring2 = mix(o.rim, 0x7a48d8, 0.35);
  const arcs: ParticleSpec = {
    kind: 'particle',
    note: 'monster_appear t0.1: a TRANSLUCENT dark spiral of three or four broken concentric arcs, ragged smoky edges, the floor shows between them (alpha)',
    cycle: 0.2,
    max: 1,
    rate: [0, 40],
    life: [0, 0.46],
    at: [0, y0 + dy * 3, 0],
    half: [0, o.half * 1.02],
    scale: [0, 0.55, 0.3, 0.95, 1, 1.16],
    color: [0, dark, 0, 0.08, dark, Math.min(0.96, o.alpha * 0.98), 0.45, dark, o.alpha * 0.82, 1, dark, 0],
    billboard: bb,
    rotation: { start: [0, 360], spin: -330 },
    blend: 'alpha',
    tex: ART_VORTEX_ARCS,
  };
  const arcs2: ParticleSpec = {
    kind: 'particle',
    note: 'monster_appear t0.1: a second layer of ragged smoky strands turning the other way (alpha): the arcs are thick smoky bands, not hairlines',
    t0: 0.02,
    cycle: 0.2,
    max: 1,
    rate: [0, 40],
    life: [0, 0.42],
    at: [0, y0 + dy * 2, 0],
    half: [0, o.half * 1.0],
    scale: [0, 0.7, 0.3, 1.0, 1, 1.12],
    color: [0, dark, 0, 0.12, dark, o.alpha * 0.68, 0.5, dark, o.alpha * 0.5, 1, dark, 0],
    billboard: bb,
    rotation: { start: [0, 360], spin: 210 },
    blend: 'alpha',
    tex: ART_VORTEX_STRANDS,
  };
  const mass: ParticleSpec = {
    kind: 'particle',
    note: 'monster_appear dust copy + dark disc (alpha): the arcs thicken into a dense near-black violet smoke mass with a ragged feathered edge (starts translucent at 0.05 s, densest 0.2-0.35 s, gone by 0.5 s)',
    t0: 0.05,
    cycle: 0.2,
    max: 1,
    rate: [0, 40],
    life: [0, 0.46],
    at: [0, y0, 0],
    half: [0, o.half * 0.92],
    scale: [0, 0.66, 0.35, 1, 1, 1.1],
    color: [0, o.core, 0, 0.14, o.core, o.alpha * 0.4, 0.36, o.core, o.alpha * 0.9, 0.64, o.core, o.alpha * 0.76, 0.9, o.core, o.alpha * 0.18, 1, o.core, 0],
    billboard: bb,
    rotation: { start: [0, 360], spin: 36, randomDir: true },
    blend: 'alpha',
    tex: ART_VORTEX_MASS,
  };
  const disc: ParticleSpec = {
    kind: 'particle',
    note: 'monster_appear disc (alpha): the spiral density turning inside the mass: ragged strands round a dense middle, feathered broken edge, no outline',
    t0: 0.09,
    cycle: 0.2,
    max: 1,
    rate: [0, 40],
    life: [0, 0.4],
    at: [0, y0 + dy, 0],
    half: [0, o.half * 0.98],
    scale: [0, 0.74, 0.4, 1, 1, 0.9],
    color: [0, arms, 0, 0.25, arms, o.alpha * 0.6, 0.65, arms, o.alpha * 0.48, 1, arms, 0],
    billboard: bb,
    rotation: { start: [0, 360], spin: 170 },
    blend: 'alpha',
    tex: ART_VORTEX_DISC,
  };
  const puffs: ParticleSpec = {
    kind: 'particle',
    note: 'dust copy (dark violet, alpha): grainy smoke puffs collapsing toward the centre from a ring (adv inner): the hazy ragged halo round the mass',
    cycle: 0.14,
    max: o.puffs,
    rate: [0, 300],
    life: [0, 0.3, 0.1, 0.44],
    shape: { kind: 'sphere', radius: o.half * 0.8, edge: true },
    at: [0, up ? y0 : 0.18, 0],
    adv: 'inner',
    vel: [0, 0.8],
    half: [0, o.half * 0.38],
    scale: [0, 0.6, 1, 1.1],
    color: [0, o.core, 0, 0.2, o.core, o.alpha * 0.56, 0.7, o.core, o.alpha * 0.36, 1, o.core, 0],
    air: [0, 0, 0.5, 0.06],
    billboard: 'screen',
    rotation: { start: [0, 360], spin: 40, randomDir: true },
    blend: 'alpha',
    tex: ART_DUST_BLOT,
    frames: { fps: 0.001, random: true },
  };
  const ring1: ParticleSpec = {
    kind: 'particle',
    note: '',
    t0: 0.2,
    cycle: 0.1,
    max: 1,
    rate: [0, 30],
    life: [0, 0.4],
    at: [0, y0 + dy * 5, 0],
    half: [0, o.half * 0.92],
    scale: [0, 0.54, 0.35, 0.96, 1, 1.3],
    color: [0, o.rim, 0, 0.1, o.rim, Math.min(1, ra * 1.15), 0.4, o.rim, ra * 0.62, 0.75, o.rim, ra * 0.1, 1, o.rim, 0],
    billboard: bb,
    rotation: { start: [0, 360], spin: 480 },
    blend: 'add',
    occlude: 0.55,
    clamp: 1,
    tex: ART_LIT_RING,
  };
  const ringTwo: ParticleSpec = {
    kind: 'particle',
    note: 'appearbluecircle second pass (t0 0.16 s, alpha .58): the faint pale-lavender ring (1.2 - 1.4 x the mass) left when the mass is gone; alpha blended so it also reads on snow',
    t0: 0.3,
    cycle: 0.1,
    max: 1,
    rate: [0, 30],
    life: [0, 0.4],
    at: [0, y0 + dy * 6, 0],
    half: [0, o.half * 0.92],
    scale: [0, 0.86, 1, 1.46],
    color: [0, ring2, 0, 0.25, ring2, ra * 0.78, 0.7, ring2, ra * 0.5, 1, ring2, 0],
    billboard: bb,
    rotation: { start: [0, 360], spin: -300 },
    blend: 'alpha',
    occlude: 1,
    clamp: 1,
    tex: ART_LIT_RING,
  };
  const specks: ParticleSpec = {
    kind: 'particle',
    note: '',
    cycle: 0.34,
    max: o.specks,
    rate: [0, 220, 0.05, 60, 0.34, 30],
    life: [0, 0.3, 0.34, 0.4],
    shape: { kind: 'sphere', radius: o.half * 1.05, edge: true },
    at: [0, up ? y0 : 0.3, 0],
    adv: 'inner',
    vel: [0, 1.5],
    half: [0, 0.1],
    scale: [0, 1, 1, 0.7],
    color: [0, 0xff8a40, 1, 0.7, 0xff4a1c, 1, 1, 0xd82208, 0],
    billboard: 'screen',
    front: true,
    blend: 'alpha',
    tex: ART_SPECK,
    minTier: 1,
  };
  if (o.lite) return [arcs, { ...mass, color: [0, o.core, 0, 0.14, o.core, o.alpha * 0.45, 0.36, o.core, Math.min(1, o.alpha * 1.05), 0.66, o.core, o.alpha * 0.92, 1, o.core, 0] }, ring1];
  const els: ParticleSpec[] = [arcs, arcs2, mass, disc, puffs, ring1, ringTwo, specks];
  // a count of 0 drops the element
  for (let i = els.length - 1; i >= 0; i--) if ((els[i] as ParticleSpec).max <= 0) els.splice(i, 1);
  if (o.twin) {
    els.push({
      ...ring1,
      note: 'elite: a second lit ring, pink, a beat after the first',
      t0: 0.34,
      scale: [0, 0.5, 0.4, 0.9, 1, 1.22],
      color: [0, 0xe890b8, 0, 0.1, 0xe890b8, ra * 0.8, 0.5, 0xe890b8, ra * 0.6, 1, 0xe890b8, 0],
      rotation: { start: [0, 360], spin: -420 },
      minTier: 1,
    });
  }
  if (o.rise && o.rise > 0) {
    els.push({
      kind: 'particle',
      note: 'elite: a few dark smoke lumps boiling up out of the vortex centre (the elite appears out of the smoke, not out of a pool)',
      t0: 0.12,
      cycle: 0.1,
      max: o.rise,
      rate: [0, 120],
      life: [0, 0.38, 0.1, 0.5],
      shape: { kind: 'sphere', radius: o.half * 0.22 },
      at: [0, up ? y0 : 0.2, 0],
      dir: { y: [0, 80] },
      vel: [0, 0.01],
      half: [0, o.half * 0.3],
      scale: [0, 0.5, 1, 1.25],
      color: [0, mix(o.core, o.strands, 0.25), 0, 0.2, mix(o.core, o.strands, 0.25), o.alpha * 0.55, 0.7, o.core, o.alpha * 0.35, 1, o.core, 0],
      air: [0, 0, 0.4, 0.08],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 40, randomDir: true },
      blend: 'alpha',
      tex: ART_DUST_BLOT,
      frames: { fps: 0.001, random: true },
      minTier: 1,
    });
  }
  return els;
}

export function appearSpec(id: string, desc: string, o: Partial<AppearOpts> = {}, dur = 0.7): FxSpec {
  const a: AppearOpts = { strands: 0x40185e, core: 0x1c0828, rim: 0xb070f8, specks: 12, half: 1.15, puffs: 5, alpha: 0.96, rimAlpha: 0.68, ...o };
  return {
    id,
    desc,
    behavior: 'selfBuff',
    ref: {},
    size: 'radius',
    base: 1,
    dur,
    elements: appearElements(a),
  };
}

// --------------------------------------------------------------------------------------------------------------- corrupt

interface CorruptOpts {
  /** cold violet-grey smoke colour (the corrupted body's dark indigo grade, crowd corruption block) and the dark patch colour */
  smoke: number;
  patch: number;
  /** half size of the ground patch, m */
  half: number;
  /** smoke puffs thrown out of the patch */
  puffs: number;
}






function corruptElements(o: CorruptOpts): ParticleSpec[] {
  const light = mix(o.smoke, 0xb4acc8, 0.5);
  const ringc = mix(o.patch, o.smoke, 0.25);
  return [
    {
      kind: 'particle',
      note: 'monster_change: scattered dark grime lumps lying on the ground the smoke comes out of (alpha, broken cluster of smoke clumps: no disc, no spiral)',
      cycle: 0.2,
      max: 2,
      rate: [0, 120],
      life: [0, 0.6],
      at: [0, 0.05, 0],
      half: [0, o.half * 0.9],
      scale: [0, 0.55, 0.2, 1, 0.7, 0.95, 1, 0.8],
      color: [0, o.patch, 0, 0.1, o.patch, 0.92, 0.6, o.patch, 0.62, 1, o.patch, 0],
      billboard: 'ground',
      rotation: { start: [0, 360], spin: 24, randomDir: true },
      blend: 'alpha',
      tex: ART_GRIME,
    },
    {
      kind: 'particle',
      note: 'monster_change: a column of dark cold violet-grey smoke: big dirty puffs thrown UP out of the patch (adv outer, taller than the creature), billowing 0.6 -> 1.5 x',
      cycle: 0.12,
      max: o.puffs + 1,
      rate: [0, 400],
      life: [0, 0.46, 0.12, 0.68],
      shape: { kind: 'sphere', radius: o.half * 0.2 },
      at: [0, 0.2, 0],
      adv: 'outer',
      dir: { y: [0, 230] },
      vel: [0, 0.01],
      half: [0, o.half * 0.66],
      scale: [0, 0.6, 1, 1.5],
      color: [0, o.smoke, 0, 0.1, o.smoke, 0.88, 0.45, mix(o.smoke, o.patch, 0.5), 0.72, 1, o.patch, 0],
      gravity: [0, -0.2],
      air: [0, 0, 0.2, 0.08],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 50, randomDir: true },
      blend: 'alpha',
      tex: ART_DUST_BLOT,
      frames: { fps: 0.001, random: true },
    },
    {
      kind: 'particle',
      note: 'monster_change: dust thrown OUT along the floor in every direction (adv outer, low): lighter dirty wisps against the dark column',
      t0: 0.03,
      cycle: 0.1,
      max: o.puffs + 1,
      rate: [0, 500],
      life: [0, 0.36, 0.1, 0.55],
      shape: { kind: 'sphere', radius: o.half * 0.14, edge: true },
      at: [0, 0.22, 0],
      adv: 'outer',
      dir: { y: [0, 6] },
      vel: [0, 0.02],
      half: [0, o.half * 0.5],
      scale: [0, 0.5, 1, 1.4],
      color: [0, light, 0, 0.12, light, 0.62, 0.5, o.smoke, 0.45, 1, o.patch, 0],
      air: [0, 0, 0.2, 0.1],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 40, randomDir: true },
      blend: 'alpha',
      tex: ART_SMOKE_SOFT,
      frames: { fps: 0.001, random: true },
    },
    {
      kind: 'particle',
      note: 'monster_change: a turning ragged smoke ring opening outward along the ground (alpha, dark so it reads on stone, snow and grass): the ring is dirty smoke, not a hoop',
      t0: 0.03,
      cycle: 0.1,
      max: 1,
      rate: [0, 30],
      life: [0, 0.58],
      at: [0, 0.07, 0],
      half: [0, o.half * 1.0],
      scale: [0, 0.45, 0.45, 1.3, 1, 1.85],
      color: [0, ringc, 0, 0.12, ringc, 1, 0.55, ringc, 0.82, 1, o.smoke, 0],
      billboard: 'ground',
      rotation: { start: [0, 360], spin: 120 },
      blend: 'alpha',
      tex: ART_RING_RAGGED,
    },
    {
      kind: 'particle',
      note: 'monster_change: the turning line ring, lit: a cold violet glow riding the dark smoke ring (additive, clamped, so the ring also reads on grass and on snow where dark smoke alone is dull)',
      t0: 0.06,
      cycle: 0.1,
      max: 1,
      rate: [0, 30],
      life: [0, 0.5],
      at: [0, 0.09, 0],
      half: [0, o.half * 1.0],
      scale: [0, 0.5, 0.45, 1.25, 1, 1.8],
      color: [0, 0x665cac, 0, 0.14, 0x665cac, 0.42, 0.6, 0x665cac, 0.26, 1, 0x665cac, 0],
      billboard: 'ground',
      rotation: { start: [0, 360], spin: -140 },
      blend: 'add',
      occlude: 0.5,
      clamp: 1,
      tex: ART_RING_RAGGED,
    },
    {
      kind: 'particle',
      note: 'monster_change: a few speckled dust clumps (grain) hanging in the smoke',
      cycle: 0.1,
      max: 3,
      rate: [0, 300],
      life: [0, 0.36, 0.1, 0.5],
      shape: { kind: 'sphere', radius: o.half * 0.2 },
      at: [0, 0.3, 0],
      adv: 'outer',
      dir: { y: [0, 60] },
      vel: [0, 0.008],
      half: [0, o.half * 0.44],
      scale: [0, 0.7, 1, 1.25],
      color: [0, mix(o.smoke, 0xa098b8, 0.35), 0, 0.14, mix(o.smoke, 0xa098b8, 0.35), 0.5, 1, o.smoke, 0],
      air: [0, 0, 0.2, 0.1],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 60, randomDir: true },
      blend: 'alpha',
      tex: ART_SMOKE_GRAIN,
    },
    {
      kind: 'particle',
      note: 'the corrupted creatures carry lilac embers (crowd corruption block): four cold lilac specks drifting up out of the smoke',
      t0: 0.04,
      cycle: 0.4,
      max: 4,
      rate: [0, 120],
      life: [0, 0.34, 0.4, 0.46],
      shape: { kind: 'sphere', radius: o.half * 0.32 },
      at: [0, 0.2, 0],
      dir: { y: [0, 100] },
      vel: [0, 0.01],
      half: [0, 0.08],
      scale: [0, 1, 1, 0.6],
      color: [0, 0xc4b0ff, 1, 0.7, 0x8c70ff, 1, 1, 0x5a40c0, 0],
      billboard: 'screen',
      front: true,
      blend: 'alpha',
      tex: ART_SPECK,
      minTier: 1,
    },
  ];
}

export function corruptSpec(id: string, desc: string, o: Partial<CorruptOpts> = {}, dur = 0.7): FxSpec {
  const c: CorruptOpts = { smoke: 0x443f58, patch: 0x131019, half: 1.0, puffs: 5, ...o };
  return {
    id,
    desc,
    behavior: 'selfBuff',
    ref: {},
    size: 'radius',
    base: 1,
    dur,
    elements: corruptElements(c),
  };
}

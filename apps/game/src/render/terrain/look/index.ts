// Zone look registry: `lookFor(zoneId)` -> the art-direction data of that zone (unknown zones get Yeonmu's).
// `resolveBiome(zoneId, biome)` -> the zone's BiomePreset with the look's render-only `biome` override applied; every
// render call site (app/run.ts, the terrain gallery, dev demos) passes its biome through it, so zone builders tune fog /
// sky / sun / ambient / particles in look/<zone>.ts and never edit data/content/zones.json.
// A0-LOOK: NEUTRAL_GRADE / DEFAULT_CORRUPTION and resolveGrade / resolveCorruption / loopsOf give every optional post / arc /
// corruption / ambientLoops field its neutral value (see the "A0-LOOK" block below); PL-03a: render/terrain/arc.ts reads `arc` (arcKeysOf).
import type { BiomePreset } from '../../../data/schema';
import { DAERYEOL_LOOK } from './daeryeol';
import { SURYEON_LOOK } from './suryeon';
import { SEORI_LOOK } from './seori';
import type { ArcKey, BiomeLook, CorruptionLook, GradeSpec, ZoneLook } from './types';
import { YEONMU_LOOK } from './yeonmu';

export type {
  ArcKey,
  BiomeLook,
  BlendStyle,
  CalmStyle,
  CliffStyle,
  CorruptionLook,
  CoverLook,
  DecalKind,
  DecalSpec,
  EdgeLook,
  GradeSpec,
  LiquidLook,
  MedallionSpec,
  OcclusionLook,
  PoolSpec,
  PostLook,
  ReadabilityLook,
  RockLook,
  RockMatStyle,
  SealSpec,
  TerrainStyle,
  TreeShadowLook,
  ZoneLook,
  ZoneTargets,
} from './types';

const LOOKS: Record<string, ZoneLook> = {
  yeonmu: YEONMU_LOOK,
  suryeon: SURYEON_LOOK,
  seori: SEORI_LOOK,
  daeryeol: DAERYEOL_LOOK,
};

export function lookFor(zone: string): ZoneLook {
  return LOOKS[zone] ?? YEONMU_LOOK;
}

/** The zone's own look, or undefined for a zone without one (no Yeonmu fallback). */
export function findLook(zone: string): ZoneLook | undefined {
  return LOOKS[zone];
}

/**
 * Render biome of a zone: `biome` (the content preset) with `look.biome` merged over it field by field. Returns the
 * input object itself when the zone has no override, so callers that compare identity keep working. Render-only: the
 * terrain field / sim keep using the content preset (layout, seed, relief and liquid are never overridden).
 */
export function resolveBiome(zoneId: string, biome: BiomePreset): BiomePreset {
  return applyBiomeLook(biome, findLook(zoneId)?.biome);
}

/** `resolveBiome` for an explicit override (absent → the input object itself). */
export function applyBiomeLook(biome: BiomePreset, o: BiomeLook | undefined): BiomePreset {
  if (!o) return biome;
  const out: BiomePreset = {
    ...biome,
    fog: merge(biome.fog, o.fog),
    sky: merge(biome.sky, o.sky),
    sun: merge(biome.sun, o.sun),
    ambient: merge(biome.ambient, o.ambient),
  };
  if (o.particles !== undefined) out.particles = o.particles;
  if (o.water?.color !== undefined && biome.water) out.water = { ...biome.water, color: o.water.color };
  return out;
}

// ---- A0-LOOK: neutral values + resolvers for the optional fields (post.grade, corruption, ambientLoops) -------------------------

/** A GradeSpec with every field present: what the composite pass is fed (PL-01) and what the arc blends (PL-03a / PL-04). */
export type ResolvedGrade = Required<GradeSpec>;
/** A CorruptionLook with every field present. */
export type ResolvedCorruption = Required<CorruptionLook>;

/**
 * The identity grade: lift 0, gamma 1, gain [1, 1, 1], shadow / highlight amounts 0 (the tints are white and inert at amount 0),
 * balance 0, contrast 1, pivot 0.18 (linear mid grey), saturation 1. Frozen; `resolveGrade` hands out fresh copies.
 */
export const NEUTRAL_GRADE: Readonly<ResolvedGrade> = Object.freeze({
  lift: 0,
  gamma: 1,
  gain: Object.freeze([1, 1, 1]) as unknown as [number, number, number],
  shadowTint: '#ffffff',
  shadowAmt: 0,
  highlightTint: '#ffffff',
  highlightAmt: 0,
  balance: 0,
  contrast: 1,
  pivot: 0.18,
  saturation: 1,
});

/**
 * How the world looks at full corruption when a zone's look has no `corruption` of its own (PL-04): 15 % of the saturation and
 * 10 % of the shadow fill lost, shadows toward a bruised violet, haze toward a grey-violet. Frozen; `resolveCorruption` hands out
 * fresh copies.
 */
export const DEFAULT_CORRUPTION: Readonly<ResolvedCorruption> = Object.freeze({
  desaturate: 0.15,
  darken: 0.1,
  shadowTint: '#5b4a7a',
  haze: '#6a5a7e',
});

const finite = (v: number | undefined | null, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const hex = (v: string | undefined | null, d: string): string => (typeof v === 'string' && v.length > 0 ? v : d);

/**
 * `GradeSpec` -> every field present. An absent (undefined / null / non-finite) field takes its NEUTRAL_GRADE value on its own, so
 * `resolveGrade(undefined)` is the identity and a spec that names only `saturation` changes only that. An explicit 0 is a value.
 * Always a fresh object with a fresh `gain` array (the input and NEUTRAL_GRADE are never aliased).
 */
export function resolveGrade(g?: GradeSpec | null): ResolvedGrade {
  const n = NEUTRAL_GRADE;
  const gg = g?.gain;
  const gainOk = Array.isArray(gg) && gg.length === 3 && gg.every((c) => typeof c === 'number' && Number.isFinite(c));
  return {
    lift: finite(g?.lift, n.lift),
    gamma: finite(g?.gamma, n.gamma),
    gain: gainOk ? [gg[0] as number, gg[1] as number, gg[2] as number] : [n.gain[0], n.gain[1], n.gain[2]],
    shadowTint: hex(g?.shadowTint, n.shadowTint),
    shadowAmt: finite(g?.shadowAmt, n.shadowAmt),
    highlightTint: hex(g?.highlightTint, n.highlightTint),
    highlightAmt: finite(g?.highlightAmt, n.highlightAmt),
    balance: finite(g?.balance, n.balance),
    contrast: finite(g?.contrast, n.contrast),
    pivot: finite(g?.pivot, n.pivot),
    saturation: finite(g?.saturation, n.saturation),
  };
}

/**
 * `ZoneLook.corruption` -> every field present, each absent field taking its DEFAULT_CORRUPTION value (a zone with no tint of its
 * own still reacts to corruption). An explicit 0 turns a channel off. Always a fresh object.
 */
export function resolveCorruption(c?: CorruptionLook | null): ResolvedCorruption {
  const d = DEFAULT_CORRUPTION;
  return {
    desaturate: finite(c?.desaturate, d.desaturate),
    darken: finite(c?.darken, d.darken),
    shadowTint: hex(c?.shadowTint, d.shadowTint),
    haze: hex(c?.haze, d.haze),
  };
}

/**
 * The extra ambient VFX loops of a zone: `look.ambientLoops` in order, de-duplicated, empty ids dropped; [] when the look has none.
 * It never contains `biome.particles` (the zone's primary loop, which the caller spawns first and de-duplicates against). A fresh
 * array each call.
 */
export function loopsOf(look: Partial<ZoneLook> | null | undefined): string[] {
  const out: string[] = [];
  for (const id of look?.ambientLoops ?? []) if (typeof id === 'string' && id.length > 0 && !out.includes(id)) out.push(id);
  return out;
}

/**
 * The run arc of a look (PL-03a): `look.arc` with the keys whose `t` is not a finite number dropped, sorted by `t` (a stable sort: of two
 * keys at the same `t` the later one wins); [] when the look has none. A fresh array each call; the keys themselves are the look's own
 * objects (render/terrain/arc.ts reads them and never writes).
 */
export function arcKeysOf(look: Partial<ZoneLook> | null | undefined): ArcKey[] {
  const keys = (look?.arc ?? []).filter((k): k is ArcKey => k !== null && typeof k === 'object' && typeof k.t === 'number' && Number.isFinite(k.t));
  return keys.sort((a, b) => a.t - b.t);
}

/** shallow merge that ignores keys explicitly set to undefined */
function merge<T extends object>(base: T, over: Partial<T> | undefined): T {
  if (!over) return { ...base };
  const out = { ...base };
  for (const k of Object.keys(over) as Array<keyof T>) {
    const v = over[k];
    if (v !== undefined) out[k] = v as T[keyof T];
  }
  return out;
}

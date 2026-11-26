// Zones core A2: pure helpers that turn a zone look's `rocks` block into the per-group material inputs of the rock system
// (rocks.ts): the resolved style of a kind, the group key, the C1 lift with the group's override, the stone tuning. No three.js.
import type { RockKind } from '../../world/layoutTypes';
import type { CliffStyle, RockLook, RockMatStyle } from '../terrain/look/types';
import type { RockOpts } from './rockGeom';
import type { StoneLift, StoneTune } from './rockMaterials';

/** The style of a rock kind: `rocks.all` with `rocks.kind[kind]` over it; undefined when the look has neither. */
export function rockStyleFor(look: RockLook | undefined, kind: RockKind): RockMatStyle | undefined {
  if (!look) return undefined;
  const a = look.all;
  const k = look.kind?.[kind];
  if (!a && !k) return undefined;
  return { ...a, ...k };
}

/** The mesh knobs (relief / roughness) of a kind from `look.rocks`; undefined when the look sets neither (the default meshes). */
export function rockMeshOpts(look: RockLook | undefined, kind: RockKind): RockOpts | undefined {
  if (!look || (look.relief === undefined && look.rough === undefined)) return undefined;
  const pick = (v: number | Partial<Record<RockKind, number>> | undefined): number | undefined => (typeof v === 'number' ? v : v?.[kind]);
  const relief = pick(look.relief);
  const rough = pick(look.rough);
  if (relief === undefined && rough === undefined) return undefined;
  return { relief, rough };
}

/** Stable key of a (texture, style) material group: the same inputs always share one batch, any difference splits it. */
export function rockGroupKey(texId: string, style: RockMatStyle | undefined): string {
  if (!style) return texId;
  const keys = Object.keys(style).sort() as Array<keyof RockMatStyle>;
  return `${texId}|${keys.map((k) => `${k}=${JSON.stringify(style[k])}`).join(';')}`;
}

/**
 * The C1 lift of a group: style.cliff's floor / aoMin / rimFill, each replaced by the group's own value when it sets one
 * (a boulder that keeps its dark cracks sets `aoMin: 0.5, floor: 0.12`). Null when nothing is left to lift.
 */
export function rockLift(cliff: CliffStyle | undefined, style: RockMatStyle | undefined, sky: [number, number, number]): StoneLift | null {
  const floor = style?.floor ?? cliff?.floor ?? 0;
  const aoMin = style?.aoMin ?? cliff?.aoMin ?? 0;
  const rimFill = style?.rimFill ?? cliff?.rimFill ?? 0;
  const own = style !== undefined && (style.floor !== undefined || style.aoMin !== undefined || style.rimFill !== undefined);
  // without a cliff block (and without an own value) the rocks were never lifted
  if (!cliff && !own) return null;
  if (floor <= 0 && aoMin <= 0 && rimFill <= 0) return null;
  return { floor, aoMin, rimFill, sky };
}

/** The stone tuning of a group, or null when it asks for nothing (the shader keeps the old code path). */
export function rockTune(style: RockMatStyle | undefined): StoneTune | null {
  if (!style) return null;
  if (style.contrast === undefined && style.dirt === undefined && style.normal === undefined && style.saturation === undefined && !style.geo) return null;
  return { contrast: style.contrast ?? 1, dirt: style.dirt ?? 0, normal: style.normal ?? 0.9, saturation: style.saturation ?? 1, ...(style.geo ? { geo: true } : {}) };
}

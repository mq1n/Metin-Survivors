// Bakes the "light pools" of a zone (lantern / brazier / bonfire glows on the ground) into one RGBA8 texture covering the
// whole domain at 1 m per texel. RGB = linear colour * intensity / 2 (the shader multiplies by 2), A = flicker amplitude.
// The terrain shader adds albedo * pool as emissive, so the glow follows the ground colour and ignores shadows.
//
// Two kinds of emitter: a prop (the spec is `pools[<prop id>]`, radius in metres x the prop's scale) and, since ROCK-01, a placed rock
// (the spec is `pools['rock:<kind>']`, e.g. 'rock:crystal': every rock of that kind lights the ground, radius = spec.radius x the
// rock's footprint, the larger of its two horizontal sizes in metres; so radius 3 gives a 3 m skirt round a 1 m crystal and the pools
// of a cluster overlap into one). A zone without a 'rock:*' key bakes exactly the texture it always did.
import { Color } from 'three';
import type { TerrainField } from '../../world/terrainField';
import type { PoolSpec } from './look/types';

export const POOL_RES = 512;

/**
 * One light emitter of a zone: a placed prop whose id has a pool spec, or (ROCK-01) a placed rock whose kind has a `rock:<kind>` spec. The
 * bake stamps `spec` round (x, z) out to `radius` metres; PL-05's flares read the same list (render/terrain/flares.ts) to put a glow at the
 * light. `y` is the base height of the placement, `height` the rock's height in metres (0 for a prop), `scale` the prop's scale (1 for a rock).
 */
export interface PoolEmitter {
  kind: 'prop' | 'rock';
  /** the key of the spec in `pools` (the prop id, or `rock:<kind>`) */
  key: string;
  spec: PoolSpec;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  height: number;
  /** metres to the end of the falloff (already times the prop's scale / the rock's footprint) */
  radius: number;
}

/** The pool key of a rock kind: `pools[rockPoolKey('crystal')]` is `pools['rock:crystal']`. */
export function rockPoolKey(kind: string): string {
  return `rock:${kind}`;
}

const ROCK_PREFIX = 'rock:';

/**
 * The emitters of a zone's light pools, props first (layout order) then rocks (only when the look has a `rock:*` key and the radius is
 * positive): exactly what `bakePools` stamps, in the order it stamps them. PL-05 (flares.ts) reads it too.
 */
export function poolEmitters(field: TerrainField, pools: Record<string, PoolSpec>): PoolEmitter[] {
  const out: PoolEmitter[] = [];
  for (const p of field.layout.props) {
    const spec = pools[p.id];
    if (!spec) continue;
    out.push({ kind: 'prop', key: p.id, spec, x: p.x, y: p.y, z: p.z, yaw: p.yaw, scale: p.scale, height: 0, radius: spec.radius * p.scale });
  }
  // ROCK-01: rock-kind pools, only looked at when the zone look has a 'rock:*' key
  let rockKeys = false;
  for (const k of Object.keys(pools)) {
    if (k.startsWith(ROCK_PREFIX)) {
      rockKeys = true;
      break;
    }
  }
  if (rockKeys) {
    for (const r of field.layout.rocks) {
      const key = ROCK_PREFIX + r.kind;
      const spec = pools[key];
      if (!spec) continue;
      const radius = spec.radius * Math.max(r.sx, r.sz);
      if (radius > 0) out.push({ kind: 'rock', key, spec, x: r.x, y: r.y, z: r.z, yaw: r.yaw, scale: 1, height: r.sy, radius });
    }
  }
  return out;
}

export function bakePools(field: TerrainField, pools: Record<string, PoolSpec>, res = POOL_RES): Uint8Array {
  const half = field.size / 2;
  const texel = field.size / res;
  const rgb = new Float32Array(res * res * 3);
  const flick = new Float32Array(res * res);
  const col = new Color();
  /** one emitter: the skirt + hot core falloff of `spec` centred on (px, pz) out to r metres */
  const stamp = (spec: PoolSpec, px: number, pz: number, r: number): void => {
    col.set(spec.color);
    const i0 = Math.max(0, Math.floor((px - r + half) / texel));
    const i1 = Math.min(res - 1, Math.ceil((px + r + half) / texel));
    const j0 = Math.max(0, Math.floor((pz - r + half) / texel));
    const j1 = Math.min(res - 1, Math.ceil((pz + r + half) / texel));
    for (let j = j0; j <= j1; j++) {
      const z = -half + (j + 0.5) * texel;
      for (let i = i0; i <= i1; i++) {
        const x = -half + (i + 0.5) * texel;
        const t = Math.hypot(x - px, z - pz) / r;
        if (t >= 1) continue;
        // broad smooth skirt plus a tighter hot core around the flame
        const skirt = (1 - t * t) * (1 - t * t);
        const core = 0.45 * Math.exp(-(t * 3.2) * (t * 3.2));
        const k = (skirt + core) * spec.intensity * 0.5;
        const o = j * res + i;
        rgb[o * 3] = (rgb[o * 3] as number) + col.r * k;
        rgb[o * 3 + 1] = (rgb[o * 3 + 1] as number) + col.g * k;
        rgb[o * 3 + 2] = (rgb[o * 3 + 2] as number) + col.b * k;
        flick[o] = Math.max(flick[o] as number, (spec.flicker ?? 0) * Math.min(1, skirt + core));
      }
    }
  };
  for (const e of poolEmitters(field, pools)) stamp(e.spec, e.x, e.z, e.radius);
  const data = new Uint8Array(res * res * 4);
  for (let o = 0; o < res * res; o++) {
    data[o * 4] = Math.round(Math.min(1, rgb[o * 3] as number) * 255);
    data[o * 4 + 1] = Math.round(Math.min(1, rgb[o * 3 + 1] as number) * 255);
    data[o * 4 + 2] = Math.round(Math.min(1, rgb[o * 3 + 2] as number) * 255);
    data[o * 4 + 3] = Math.round(Math.min(1, flick[o] as number) * 255);
  }
  return data;
}

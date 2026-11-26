// Liquid bake: everything the surface shaders need, derived once from the TerrainField grids.
//   heightTex  R16F  terrain height minus liquid level (m); < 0 = under liquid (relative values keep half-float precision at the shore)
//   flowTex    RGBA8 R,G flow (m/s / MAX_FLOW, signed) · B obstacle foam mask · A signed shore distance (m / SD_RANGE, + = inside)
//   surface    flat tiles at `level` covering the wet area only (static, one draw call)
//   decal      terrain-conforming tiles around the shore (wet band / lava glow / frost rim)
import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, NoColorSpace, RGBAFormat, RedFormat, UnsignedByteType } from 'three';
import { fbm, smoothPath } from '../../../world/noise';
import type { TerrainField } from '../../../world/terrainField';

/** flow speeds above this (m/s) saturate in the 8-bit flow map */
export const MAX_FLOW = 3;
/** signed shore distance is stored as ±SD_RANGE metres */
export const SD_RANGE = 8;

const TILE = 8;

export interface TileMesh {
  positions: Float32Array;
  index: Uint32Array;
}

export interface LiquidBake {
  level: number;
  /** grid nodes per axis (texture size) */
  n: number;
  /** half of the domain size (m) */
  half: number;
  heightTex: DataTexture;
  flowTex: DataTexture;
  surface: TileMesh;
  decal: TileMesh;
  /** number of grid nodes under the liquid */
  wetNodes: number;
  dispose(): void;
}

export interface BakeOptions {
  /** quads per 8 m surface tile edge (1 = flat sheet, 4 = vertex-animated lava) */
  surfaceQuads: number;
  /** how far (m) outside the shore the decal mesh reaches */
  decalReach: number;
  /** decal lift above the terrain (m) */
  decalLift: number;
  /**
   * C3 (look.liquidLook.water.taper): metres from each stream's first point over which the liquid narrows to nothing (the
   * shallow edges dry out first, so the source tapers instead of ending square-cut). Render-only: the sim keeps its own
   * surface classes. 0 / absent = off.
   */
  taper?: number;
  /** debug / before-after pairs only: the pre-B2 triangulation of the draped decal (other diagonal than the terrain mesh) */
  legacySplit?: boolean;
}

/**
 * C3: raises the liquid-relative height near each stream source so the channel's shallow edges fall dry first and the
 * liquid surface narrows to a point at the source. Render-only (the bake's own copy of the heights).
 */
function taperSources(rel: Float32Array, n: number, half: number, field: TerrainField, taper: number): void {
  for (const s of field.layout.streams) {
    const pts = smoothPath(s.pts, 6);
    let along = 0;
    const hw = Math.max(0.5, s.halfWidth);
    const reach = hw * 1.7 + 2;
    for (let k = 0; k < pts.length - 1 && along < taper; k++) {
      const a = pts[k] as [number, number];
      const b = pts[k + 1] as [number, number];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-4) continue;
      const i0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - reach + half));
      const i1 = Math.min(n - 1, Math.ceil(Math.max(a[0], b[0]) + reach + half));
      const j0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - reach + half));
      const j1 = Math.min(n - 1, Math.ceil(Math.max(a[1], b[1]) + reach + half));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const idx = j * n + i;
          const r = rel[idx] as number;
          if (r >= 0) continue;
          const x = i - half;
          const z = j - half;
          let t = ((x - a[0]) * dx + (z - a[1]) * dz) / (len * len);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = a[0] + dx * t - x;
          const qz = a[1] + dz * t - z;
          if (qx * qx + qz * qz > reach * reach) continue;
          const u = Math.min(1, (along + t * len) / taper);
          // u = 0 at the source (dry), 1 at the end of the taper (unchanged); quadratic ease
          const lift = (1 - u) * (1 - u) * (-r + 0.25);
          rel[idx] = Math.max(r, r + lift);
        }
      }
      along += len;
    }
  }
}

export function bakeLiquid(field: TerrainField, level: number, opts: BakeOptions): LiquidBake | null {
  // `bed` = ground without bridge decks: liquid flows visibly under bridges
  const { n, bed: heights } = field.grid;
  const half = field.size / 2;
  const count = n * n;

  const rel = new Float32Array(count);
  for (let i = 0; i < count; i++) rel[i] = (heights[i] as number) - level;
  if ((opts.taper ?? 0) > 0) taperSources(rel, n, half, field, opts.taper as number);
  let wet = 0;
  for (let i = 0; i < count; i++) if ((rel[i] as number) < 0) wet++;
  if (wet === 0) return null;

  // --- height texture (half float) -------------------------------------------------------------------------------
  const half16 = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    const r = rel[i] as number;
    half16[i] = DataUtils.toHalfFloat(r < -48 ? -48 : r > 48 ? 48 : r);
  }
  const heightTex = new DataTexture(half16, n, n, RedFormat, HalfFloatType);
  heightTex.magFilter = heightTex.minFilter = LinearFilter;
  heightTex.wrapS = heightTex.wrapT = ClampToEdgeWrapping;
  heightTex.generateMipmaps = false;
  heightTex.colorSpace = NoColorSpace;
  heightTex.needsUpdate = true;

  // --- flow field ------------------------------------------------------------------------------------------------
  const fx = new Float32Array(count);
  const fz = new Float32Array(count);
  const best = new Float32Array(count).fill(Infinity);
  for (const s of field.layout.streams) {
    const pts = smoothPath(s.pts, 6);
    const hw = Math.max(0.5, s.halfWidth);
    const reach = hw * 1.7 + 2;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k] as [number, number];
      const b = pts[k + 1] as [number, number];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-4) continue;
      const tx = dx / len;
      const tz = dz / len;
      const i0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - reach + half));
      const i1 = Math.min(n - 1, Math.ceil(Math.max(a[0], b[0]) + reach + half));
      const j0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - reach + half));
      const j1 = Math.min(n - 1, Math.ceil(Math.max(a[1], b[1]) + reach + half));
      for (let j = j0; j <= j1; j++) {
        const z = j - half;
        for (let i = i0; i <= i1; i++) {
          const x = i - half;
          let t = ((x - a[0]) * tx + (z - a[1]) * tz) / len;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = a[0] + dx * t - x;
          const qz = a[1] + dz * t - z;
          const d = Math.sqrt(qx * qx + qz * qz);
          if (d > reach) continue;
          const across = d / hw;
          const idx = j * n + i;
          if (across >= (best[idx] as number)) continue;
          best[idx] = across;
          // bank friction: fastest mid-channel, a slow crawl at the banks, nothing beyond 1.7 half-widths
          const prof = across < 1 ? 0.38 + 0.62 * (1 - across * across) : Math.max(0, 1 - (across - 1) / 0.7) * 0.38;
          const v = s.speed * prof;
          fx[idx] = tx * v;
          fz[idx] = tz * v;
        }
      }
    }
  }
  // standing liquid (lakes, pools, off-channel) slowly swirls: curl of a smooth potential
  const seed = field.seed;
  const e = 3;
  for (let j = 0; j < n; j++) {
    const z = j - half;
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      if ((rel[idx] as number) >= 0.5) continue;
      const x = i - half;
      const free = (best[idx] as number) >= 2 ? 1 : (best[idx] as number) <= 1 ? 0 : (best[idx] as number) - 1;
      if (free <= 0) continue;
      const dpsiZ = fbm(x / 36, (z + e) / 36, seed + 61, 2) - fbm(x / 36, (z - e) / 36, seed + 61, 2);
      const dpsiX = fbm((x + e) / 36, z / 36, seed + 61, 2) - fbm((x - e) / 36, z / 36, seed + 61, 2);
      fx[idx] = (fx[idx] as number) + (dpsiZ / (2 * e)) * 9 * free;
      fz[idx] = (fz[idx] as number) - (dpsiX / (2 * e)) * 9 * free;
    }
  }

  // --- obstacle foam (rocks standing in the liquid) ----------------------------------------------------------------
  const obst = new Float32Array(count);
  for (const r of field.layout.rocks) {
    const rad = Math.max(r.sx, r.sz) * 0.5;
    const ground = field.bedHeightAt(r.x, r.z);
    if (ground > level + 0.35 || r.y + r.sy < level) continue;
    const reach = rad + 1.4;
    const i0 = Math.max(0, Math.floor(r.x - reach + half));
    const i1 = Math.min(n - 1, Math.ceil(r.x + reach + half));
    const j0 = Math.max(0, Math.floor(r.z - reach + half));
    const j1 = Math.min(n - 1, Math.ceil(r.z + reach + half));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i - half - r.x;
        const dz = j - half - r.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        let v = 1 - (d - rad * 0.8) / (reach - rad * 0.8);
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        v = v * v * (3 - 2 * v);
        const idx = j * n + i;
        if (v > (obst[idx] as number)) obst[idx] = v;
      }
    }
  }

  // --- signed shore distance ---------------------------------------------------------------------------------------
  const dist = shoreDistance(rel, n);

  const flow = new Uint8Array(count * 4);
  const kF = 127 / MAX_FLOW;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    flow[o] = Math.max(0, Math.min(255, Math.round(127.5 + (fx[i] as number) * kF)));
    flow[o + 1] = Math.max(0, Math.min(255, Math.round(127.5 + (fz[i] as number) * kF)));
    flow[o + 2] = Math.round((obst[i] as number) * 255);
    const sd = (rel[i] as number) < 0 ? (dist[i] as number) : -(dist[i] as number);
    flow[o + 3] = Math.max(0, Math.min(255, Math.round(127.5 + (sd / SD_RANGE) * 127.5)));
  }
  const flowTex = new DataTexture(flow, n, n, RGBAFormat, UnsignedByteType);
  flowTex.magFilter = flowTex.minFilter = LinearFilter;
  flowTex.wrapS = flowTex.wrapT = ClampToEdgeWrapping;
  flowTex.generateMipmaps = false;
  flowTex.colorSpace = NoColorSpace;
  flowTex.needsUpdate = true;

  // --- geometry ----------------------------------------------------------------------------------------------------
  const tiles = Math.ceil((n - 1) / TILE);
  const surfaceTiles: number[] = [];
  const decalTiles: number[] = [];
  const reachM = opts.decalReach;
  for (let tz = 0; tz < tiles; tz++) {
    for (let tx = 0; tx < tiles; tx++) {
      const i0 = Math.max(0, tx * TILE - 1);
      const i1 = Math.min(n - 1, tx * TILE + TILE + 1);
      const j0 = Math.max(0, tz * TILE - 1);
      const j1 = Math.min(n - 1, tz * TILE + TILE + 1);
      let anyWet = false;
      let nearShore = false;
      for (let j = j0; j <= j1 && !anyWet; j++) {
        for (let i = i0; i <= i1; i++) {
          if ((rel[j * n + i] as number) < 0.06) {
            anyWet = true;
            break;
          }
        }
      }
      if (anyWet) surfaceTiles.push(tx, tz);
      // decal: any dry node within reach of the liquid; tile footprint padded by the reach
      const p = Math.ceil(reachM);
      const pi0 = Math.max(0, tx * TILE - p);
      const pi1 = Math.min(n - 1, tx * TILE + TILE + p);
      const pj0 = Math.max(0, tz * TILE - p);
      const pj1 = Math.min(n - 1, tz * TILE + TILE + p);
      for (let j = pj0; j <= pj1 && !nearShore; j += 2) {
        for (let i = pi0; i <= pi1; i += 2) {
          if ((rel[j * n + i] as number) < 0) {
            nearShore = true;
            break;
          }
        }
      }
      if (nearShore) decalTiles.push(tx, tz);
    }
  }

  const surface = buildTiles(surfaceTiles, opts.surfaceQuads, n, half, () => level, false);
  // the decal drapes over the terrain mesh: it takes the terrain's triangulation (B2), see buildTiles
  const decal = buildTiles(decalTiles, TILE, n, half, (x, z) => field.bedHeightAt(x, z) + opts.decalLift, opts.legacySplit !== true);

  return {
    level,
    n,
    half,
    heightTex,
    flowTex,
    surface,
    decal,
    wetNodes: wet,
    dispose() {
      heightTex.dispose();
      flowTex.dispose();
    },
  };
}

/** Euclidean-ish distance (m) from every node to the zero crossing of `rel`, seeded with sub-cell crossing estimates. */
function shoreDistance(rel: Float32Array, n: number): Float32Array {
  const count = n * n;
  const d = new Float32Array(count).fill(1e9);
  const cross = (a: number, b: number): number => {
    // distance from the node with value a to the zero crossing towards b (opposite sign), in cells
    const da = Math.abs(a);
    return da / (da + Math.abs(b));
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const a = rel[idx] as number;
      const wetA = a < 0;
      let m = d[idx] as number;
      if (i + 1 < n) {
        const b = rel[idx + 1] as number;
        if (b < 0 !== wetA) {
          m = Math.min(m, cross(a, b));
          d[idx + 1] = Math.min(d[idx + 1] as number, cross(b, a));
        }
      }
      if (j + 1 < n) {
        const b = rel[idx + n] as number;
        if (b < 0 !== wetA) {
          m = Math.min(m, cross(a, b));
          d[idx + n] = Math.min(d[idx + n] as number, cross(b, a));
        }
      }
      d[idx] = m;
    }
  }
  const D = 1.4142;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      let m = d[idx] as number;
      if (i > 0) m = Math.min(m, (d[idx - 1] as number) + 1);
      if (j > 0) {
        m = Math.min(m, (d[idx - n] as number) + 1);
        if (i > 0) m = Math.min(m, (d[idx - n - 1] as number) + D);
        if (i < n - 1) m = Math.min(m, (d[idx - n + 1] as number) + D);
      }
      d[idx] = m;
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const idx = j * n + i;
      let m = d[idx] as number;
      if (i < n - 1) m = Math.min(m, (d[idx + 1] as number) + 1);
      if (j < n - 1) {
        m = Math.min(m, (d[idx + n] as number) + 1);
        if (i < n - 1) m = Math.min(m, (d[idx + n + 1] as number) + D);
        if (i > 0) m = Math.min(m, (d[idx + n - 1] as number) + D);
      }
      d[idx] = m;
    }
  }
  return d;
}

/**
 * Grid mesh over the listed 8 m tiles (`tiles` = flat tx,tz pairs) with `quads` quads per tile edge. `draped` meshes lie on
 * the terrain a few centimetres above it (the shore decal): they split every quad along the SAME diagonal as the terrain
 * mesh (a to d, terrain.ts gridIndex / TerrainField.heightAt). With the other diagonal the two surfaces differ over every
 * twisted quad (a rocky bank, a bridge abutment) by more than the lift, and half a quad of the decal sank into the ground:
 * the dark parallelograms next to bridge ends. Flat meshes (the liquid surface) keep their old split.
 */
function buildTiles(tiles: number[], quads: number, n: number, half: number, yAt: (x: number, z: number) => number, draped: boolean): TileMesh {
  const nt = tiles.length / 2;
  const vpt = (quads + 1) * (quads + 1);
  const positions = new Float32Array(nt * vpt * 3);
  const index = new Uint32Array(nt * quads * quads * 6);
  const step = TILE / quads;
  const maxX = n - 1 - half;
  let v = 0;
  let k = 0;
  for (let t = 0; t < nt; t++) {
    const x0 = (tiles[t * 2] as number) * TILE - half;
    const z0 = (tiles[t * 2 + 1] as number) * TILE - half;
    const base = v;
    for (let j = 0; j <= quads; j++) {
      for (let i = 0; i <= quads; i++) {
        const x = Math.min(x0 + i * step, maxX);
        const z = Math.min(z0 + j * step, maxX);
        positions[v * 3] = x;
        positions[v * 3 + 1] = yAt(x, z);
        positions[v * 3 + 2] = z;
        v++;
      }
    }
    for (let j = 0; j < quads; j++) {
      for (let i = 0; i < quads; i++) {
        const a = base + j * (quads + 1) + i;
        if (draped) {
          // terrain split: (a, d, b) and (a, c, d) with b = a + 1 (+x), c = a + quads + 1 (+z), d = c + 1
          index[k++] = a;
          index[k++] = a + quads + 2;
          index[k++] = a + 1;
          index[k++] = a;
          index[k++] = a + quads + 1;
          index[k++] = a + quads + 2;
        } else {
          index[k++] = a;
          index[k++] = a + quads + 1;
          index[k++] = a + 1;
          index[k++] = a + 1;
          index[k++] = a + quads + 1;
          index[k++] = a + quads + 2;
        }
      }
    }
  }
  return { positions, index };
}

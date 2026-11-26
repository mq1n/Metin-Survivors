// Bakes the static sun lighting of a zone into one RGBA8 texture covering the whole domain (0.5 m texels):
//   R = sun visibility (terrain horizon shadows + tree / rock / prop / wall cast shadows)
//   G = ambient occlusion (valleys, cliff feet, under canopies, around props)
//   B = liquid proximity (blurred liquid mask → wet shore / lava glow / ice frost in the terrain shader)
//   A = cliff-foot proximity (zones core C1, only when `footWidth` > 0; otherwise 255 as before)
// The sun is static per biome, so this replaces dynamic shadow casting for everything except the hero/crowd.
// Zones core B1 (`opts.trees`): tree shadows are the projected crown silhouette (treeShadow.ts) instead of a capsule per tree,
// rasterised at the full resolution of the bake (a finer `res` than the terrain horizon grid) and composited after the blur.
import { smoothstep } from '../../world/noise';
import { PROP_DEFS } from '../../world/props';
import { SURFACE } from '../../world/layoutTypes';
import { TREE_DIMS } from '../../world/trees';
import type { TerrainField } from '../../world/terrainField';
import type { TreeSpecies } from '../../world/layoutTypes';
import type { TreeStyle } from '../vegetation/treeCommon';
import { rasterTreeShadows, smoothBytes, type TreeShadowMasks } from './treeShadow';

export interface BakedLight {
  res: number;
  /** RGBA8, row-major, row 0 = z −size/2 */
  data: Uint8Array;
}

/** B1: crown-silhouette tree shadows (look.shadow.trees resolved by terrain.ts: the foliage masks and the tree style added) */
export interface TreeShadowBake {
  /** same generation switches as the tree system (snowy zones draw snow pines) */
  style: TreeStyle;
  /** darkness of full leaf cover, 0..1 (default 0.62) */
  strength?: number;
  /** per-species multiplier on `strength` (e.g. { bare: 0.55 }) */
  species?: Partial<Record<TreeSpecies, number>>;
  /** extra smoothing passes on the rasterised crown (each ~ 1 texel; default 0: the leaf outlines are anti-aliased as drawn) */
  edge?: number;
  /** strength of today's soft capsule kept under the silhouette as a penumbra (default 0 = none) */
  capsule?: number;
  /** multiplier on the ambient occlusion stamped under every crown (default 1) */
  ao?: number;
  /**
   * share of the OTHER baked sun shadows (terrain horizon, rocks, props, walls) kept, 0..1 (default 1): lets a zone raise the
   * tree shadow to full strength (`shadow.baked` 1) without making everything else baked darker than it was tuned
   */
  others?: number;
  /** alpha masks of the foliage card textures (absent = a procedural leaf blob) */
  masks?: TreeShadowMasks;
}

/**
 * Settle (yeonmu): the contact shadow of the loose rocks (boulder / slab / spire; the outcrop and ledge wall blocks keep the old bake).
 * The old bake kept a rock's cast shadow and AO under its own body, so a
 * boulder on lit grass looked pasted on; these multipliers (all default 1 / 0 = the bake as it was) let a zone throw it out.
 */
export interface RockShadowBake {
  /** multiplier on the length of the cast shadow (default 1) */
  reach?: number;
  /** multiplier on the width of the cast shadow (default 1) */
  width?: number;
  /**
   * multiplier on the strength of the cast shadow, capped at full (default 1). With any `rocks` option the rock shadows are kept
   * out of `trees.others`: the strength is the final darkness (0.78 x strength)
   */
  strength?: number;
  /** metres the ambient-occlusion halo grows beyond the rock's footprint (default 0) */
  halo?: number;
  /** multiplier on the strength of the ambient-occlusion halo, capped at full (default 1) */
  ao?: number;
}

export interface BakeLightOptions {
  /** C2 (look.shadow.soft): metres of blur on the baked sun visibility and AO (0 = the old hard bake) */
  soft?: number;
  /** C1 (look.style.cliff.foot.width): metres of the scree band at the foot of steep faces, baked into A (0 = A stays 255) */
  footWidth?: number;
  /** B1: tree shadows from the crown silhouette (absent = the capsule + painted-lobe stand-in as before) */
  trees?: TreeShadowBake;
  /** settle: stronger / longer contact shadows of the loose rocks (absent = the bake as it was) */
  rocks?: RockShadowBake;
}

/** Triangle-ish blur of `radius` metres (two box passes) on a res × res buffer covering `size` metres. */
function softBlur(src: Float32Array, res: number, size: number, metres: number): Float32Array {
  const r = Math.max(1, Math.round((metres * res) / size / 2));
  return boxBlur(boxBlur(src, res, r), res, r);
}

/**
 * Cliff-foot proximity on the n × n terrain grid: steep cells (the shader's cliff threshold) blurred over `width`
 * metres, kept only where the ground is concave (the foot of a wall, not its crest). 0..1.
 */
function footMask(field: TerrainField, heights: Float32Array, n: number, width: number): Float32Array {
  const k1 = field.size / n;
  const steep = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const hx = (heights[j * n + Math.min(n - 1, i + 1)] as number) - (heights[j * n + Math.max(0, i - 1)] as number);
      const hz = (heights[Math.min(n - 1, j + 1) * n + i] as number) - (heights[Math.max(0, j - 1) * n + i] as number);
      const g = Math.sqrt(hx * hx + hz * hz) / (2 * k1);
      // the shader's cliff weight starts at 1 - N.y = 0.1 (slope 0.48) and is full at 0.27 (slope 0.94)
      steep[j * n + i] = smoothstep(0.48, 0.94, g);
    }
  }
  const r = Math.max(1, Math.round(width / k1 / 2));
  const near = boxBlur(boxBlur(steep, n, r), n, r);
  const wide = boxBlur(boxBlur(heights, n, r), n, r);
  const out = new Float32Array(n * n);
  for (let o = 0; o < n * n; o++) {
    const concave = smoothstep(0.05, 0.6, (wide[o] as number) - (heights[o] as number));
    out[o] = Math.min(1, (near[o] as number) * 2.4) * concave * (1 - (steep[o] as number));
  }
  return out;
}

interface Sun {
  /** horizontal unit direction towards the sun */
  hx: number;
  hz: number;
  /** cot(elevation): ground distance travelled per metre of height */
  cot: number;
  /** tan(elevation) */
  tan: number;
}

function sunFrom(dir: { x: number; y: number; z: number }): Sun {
  const h = Math.sqrt(dir.x * dir.x + dir.z * dir.z) || 1e-6;
  const y = Math.max(0.2, dir.y);
  return { hx: dir.x / h, hz: dir.z / h, cot: h / y, tan: y / h };
}

class Raster {
  readonly vis: Float32Array;
  readonly ao: Float32Array;

  constructor(
    readonly res: number,
    readonly half: number,
  ) {
    this.vis = new Float32Array(res * res).fill(1);
    this.ao = new Float32Array(res * res).fill(1);
  }

  /** multiplies `buf` by (1 - strength·falloff) inside the soft disc */
  stamp(buf: Float32Array, cx: number, cz: number, r: number, soft: number, strength: number): void {
    const k = this.res / (this.half * 2);
    const R = r + soft;
    const i0 = Math.max(0, Math.floor((cx - R + this.half) * k));
    const i1 = Math.min(this.res - 1, Math.ceil((cx + R + this.half) * k));
    const j0 = Math.max(0, Math.floor((cz - R + this.half) * k));
    const j1 = Math.min(this.res - 1, Math.ceil((cz + R + this.half) * k));
    for (let j = j0; j <= j1; j++) {
      const z = (j + 0.5) / k - this.half;
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) / k - this.half;
        const d = Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz));
        if (d >= R) continue;
        const f = 1 - smoothstep(Math.max(0, r - soft), R, d);
        const o = j * this.res + i;
        const v = 1 - strength * f;
        if (v < (buf[o] as number)) buf[o] = v;
      }
    }
  }

  /** capsule from a→b made of overlapping discs */
  capsule(buf: Float32Array, ax: number, az: number, bx: number, bz: number, r0: number, r1: number, soft: number, strength: number): void {
    const len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    const steps = Math.max(1, Math.ceil(len / (Math.min(r0, r1) * 0.6 + 0.2)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.stamp(buf, ax + (bx - ax) * t, az + (bz - az) * t, r0 + (r1 - r0) * t, soft, strength);
    }
  }
}

function boxBlur(src: Float32Array, n: number, radius: number): Float32Array {
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  const w = radius * 2 + 1;
  for (let j = 0; j < n; j++) {
    let acc = 0;
    for (let i = -radius; i <= radius; i++) acc += src[j * n + Math.min(n - 1, Math.max(0, i))] as number;
    for (let i = 0; i < n; i++) {
      tmp[j * n + i] = acc / w;
      acc += (src[j * n + Math.min(n - 1, i + radius + 1)] as number) - (src[j * n + Math.max(0, i - radius)] as number);
    }
  }
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -radius; j <= radius; j++) acc += tmp[Math.min(n - 1, Math.max(0, j)) * n + i] as number;
    for (let j = 0; j < n; j++) {
      out[j * n + i] = acc / w;
      acc += (tmp[Math.min(n - 1, j + radius + 1) * n + i] as number) - (tmp[Math.max(0, j - radius) * n + i] as number);
    }
  }
  return out;
}

const HORIZON_STEPS = [1.5, 3, 5, 8, 12, 17, 24, 32, 42, 55, 70];

/** per target texel: the lower source node and the blend towards the next one, for a res-texel axis over an n-node grid */
function axisMap(res: number, n: number): { i0: Int32Array; f: Float32Array } {
  const i0 = new Int32Array(res);
  const f = new Float32Array(res);
  for (let t = 0; t < res; t++) {
    const u = ((t + 0.5) / res) * n - 0.5;
    const k = Math.max(0, Math.min(n - 2, Math.floor(u)));
    i0[t] = k;
    f[t] = Math.max(0, Math.min(1, u - k));
  }
  return { i0, f };
}

export function bakeLight(field: TerrainField, sunDir: { x: number; y: number; z: number }, res = 1024, opts: BakeLightOptions = {}): BakedLight {
  const half = field.size / 2;
  const sun = sunFrom(sunDir);
  // B1: the terrain / prop / rock shadows and the AO are low frequency: they stay at the 1024 grid (0.5 m) whatever `res` is, and
  // only the crown silhouettes are rasterised at the finer `res` (the final pass upsamples the rest)
  const lowRes = opts.trees ? Math.min(res, 1024) : res;
  const r = new Raster(lowRes, half);

  // --- terrain: horizon shadows + concavity AO at the 1 m grid resolution (lowRes/2), then upsampled ------------------------
  const n = lowRes / 2;
  const tv = new Float32Array(n * n);
  const heights = new Float32Array(n * n);
  const k1 = field.size / n;
  for (let j = 0; j < n; j++) {
    const z = -half + (j + 0.5) * k1;
    for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * k1;
      const h0 = field.bedHeightAt(x, z);
      heights[j * n + i] = h0;
      let sh = 0;
      for (const t of HORIZON_STEPS) {
        const px = x + sun.hx * t;
        const pz = z + sun.hz * t;
        if (px < -half || px > half || pz < -half || pz > half) break;
        const excess = field.bedHeightAt(px, pz) - (h0 + t * sun.tan);
        if (excess > 0) {
          const s = smoothstep(0, 0.9 + t * 0.05, excess);
          if (s > sh) sh = s;
          if (sh > 0.98) break;
        }
      }
      tv[j * n + i] = 1 - 0.92 * sh;
    }
  }
  const blurred = boxBlur(heights, n, 3);
  const tao = new Float32Array(n * n);
  for (let o = 0; o < n * n; o++) {
    const conc = (blurred[o] as number) - (heights[o] as number);
    tao[o] = 1 - Math.min(0.55, Math.max(0, conc * 0.32));
  }
  const sample = (src: Float32Array, i: number, j: number): number => {
    const u = ((i + 0.5) / lowRes) * n - 0.5;
    const v = ((j + 0.5) / lowRes) * n - 0.5;
    const iu = Math.max(0, Math.min(n - 2, Math.floor(u)));
    const jv = Math.max(0, Math.min(n - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - iu));
    const fv = Math.max(0, Math.min(1, v - jv));
    const a = (src[jv * n + iu] as number) * (1 - fu) + (src[jv * n + iu + 1] as number) * fu;
    const b = (src[(jv + 1) * n + iu] as number) * (1 - fu) + (src[(jv + 1) * n + iu + 1] as number) * fu;
    return a * (1 - fv) + b * fv;
  };
  for (let j = 0; j < lowRes; j++) {
    for (let i = 0; i < lowRes; i++) {
      r.vis[j * lowRes + i] = sample(tv, i, j);
      r.ao[j * lowRes + i] = sample(tao, i, j);
    }
  }

  // --- trees -------------------------------------------------------------------------------------------------------
  // B1: with `opts.trees` the crown shadow is rasterised from the real crown below (after the blur); the capsule stays only as
  // the optional faint penumbra under it
  const tcfg = opts.trees;
  const capK = tcfg ? tcfg.capsule ?? 0 : 1;
  const aoK = tcfg ? tcfg.ao ?? 1 : 1;
  for (const t of field.layout.trees) {
    const d = TREE_DIMS[t.species];
    const H = d.height * t.scale;
    const R = d.crownRadius * t.scale;
    const hc = (d.crownBase * t.scale + H) * 0.5;
    const tipX = t.x - sun.hx * H * sun.cot;
    const tipZ = t.z - sun.hz * H * sun.cot;
    const cx = t.x - sun.hx * hc * sun.cot;
    const cz = t.z - sun.hz * hc * sun.cot;
    const dense = t.species === 'pine' || t.species === 'snowpine' ? 0.7 : t.species === 'bare' || t.species === 'charred' ? 0.28 : 0.62;
    // trunk shadow (thin) + crown shadow, crown elongated towards the tip
    if (capK > 0) {
      r.capsule(r.vis, t.x, t.z, cx, cz, 0.28 * t.scale, 0.3 * t.scale, 0.25, 0.5 * capK);
      r.capsule(r.vis, cx, cz, (cx + tipX) * 0.5, (cz + tipZ) * 0.5, R * 0.95, R * 0.55, 0.9 + 0.04 * H, dense * capK);
    }
    if (aoK > 0) r.stamp(r.ao, t.x, t.z, R * 0.7, R * 0.9, dense * 0.55 * aoK);
  }

  // --- rocks -------------------------------------------------------------------------------------------------------
  // with look.shadow.rocks the rock shadows go into their own buffer: `trees.others` and the soft blur are applied to the rest, then the
  // two are merged, so a zone can give the rocks a real contact shadow whatever it keeps of the other baked shadows
  const rs = opts.rocks;
  const rockVis = rs ? new Float32Array(lowRes * lowRes).fill(1) : r.vis;
  for (const k of field.layout.rocks) {
    if (k.kind === 'pebbles') {
      r.stamp(r.ao, k.x, k.z, Math.max(k.sx, k.sz) * 0.5, 0.3, 0.25);
      continue;
    }
    const w = Math.max(k.sx, k.sz) * 0.5;
    // the knobs are for the loose stones; the wall blocks (outcrop / ledge: 8-15 m wide) keep the old shadow, the old AO and `others`
    const loose = rs !== undefined && (k.kind === 'boulder' || k.kind === 'slab' || k.kind === 'spire');
    const ks = loose ? rs : undefined;
    const reach = k.sy * 0.8 * sun.cot * (ks?.reach ?? 1);
    const wk = ks?.width ?? 1;
    r.capsule(loose ? rockVis : r.vis, k.x, k.z, k.x - sun.hx * reach, k.z - sun.hz * reach, w * 0.85 * wk, w * 0.5 * wk, 0.35 + w * 0.12, Math.min(1, 0.78 * (ks?.strength ?? 1)));
    r.stamp(r.ao, k.x, k.z, w * 0.9, w * 0.9 + 0.5 + (ks?.halo ?? 0), Math.min(1, 0.6 * (ks?.ao ?? 1)));
  }

  // --- props + walls -----------------------------------------------------------------------------------------------
  for (const p of field.layout.props) {
    const def = PROP_DEFS[p.id];
    if (!def) continue;
    const H = def.height * p.scale;
    const R = def.radius * p.scale * 0.8;
    const reach = H * sun.cot;
    const tx = p.x - sun.hx * reach;
    const tz = p.z - sun.hz * reach;
    // props also cast the dynamic sun shadow near the camera, so the baked one is a lighter stand-in shaped like the
    // silhouette (slender props: thin shaft widening to the cap / lamp at the tip; squat props: a short blob), not a puddle
    if (H > R * 3) r.capsule(r.vis, p.x, p.z, tx, tz, R * 0.3, R * 0.6, 0.3 + 0.02 * H, 0.35);
    else r.capsule(r.vis, p.x, p.z, tx, tz, R * 0.8, R * 0.55, 0.4 + 0.03 * H, 0.6);
    r.stamp(r.ao, p.x, p.z, R, R * 0.6 + 0.8, 0.5);
  }
  for (const w of field.layout.walls) {
    const reach = w.height * sun.cot;
    r.capsule(r.vis, w.x0, w.z0, w.x1, w.z1, 0.5, 0.5, 0.3, 0.2);
    const ax = w.x0 - sun.hx * reach;
    const az = w.z0 - sun.hz * reach;
    const bx = w.x1 - sun.hx * reach;
    const bz = w.z1 - sun.hz * reach;
    r.capsule(r.vis, (w.x0 + ax) * 0.5, (w.z0 + az) * 0.5, (w.x1 + bx) * 0.5, (w.z1 + bz) * 0.5, reach * 0.5, reach * 0.5, 0.4, 0.55);
  }

  // --- liquid proximity (B) ----------------------------------------------------------------------------------------
  let mask: Float32Array = new Float32Array(n * n);
  const surf = field.grid.surface;
  const gn = field.grid.n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gi = Math.min(gn - 1, Math.round(((i + 0.5) / n) * (gn - 1)));
      const gj = Math.min(gn - 1, Math.round(((j + 0.5) / n) * (gn - 1)));
      const s = surf[gj * gn + gi] as number;
      mask[j * n + i] = s === SURFACE.LAVA || s === SURFACE.DEEP || s === SURFACE.SHALLOW || s === SURFACE.ICE ? 1 : 0;
    }
  }
  mask = boxBlur(boxBlur(boxBlur(mask, n, 2), n, 2), n, 2);

  // --- C2: soft baked shadows (blur of the sun visibility and AO) ---------------------------------------------------
  const soft = opts.soft ?? 0;
  const vis = soft > 0 ? softBlur(r.vis, lowRes, field.size, soft) : r.vis;
  const othersK = tcfg?.others ?? 1;
  if (othersK !== 1) for (let o = 0; o < vis.length; o++) vis[o] = 1 - othersK * (1 - (vis[o] as number));
  if (rs) {
    const rv = soft > 0 ? softBlur(rockVis, lowRes, field.size, soft) : rockVis;
    for (let o = 0; o < vis.length; o++) if ((rv[o] as number) < (vis[o] as number)) vis[o] = rv[o] as number;
  }
  const ao = soft > 0 ? softBlur(r.ao, lowRes, field.size, soft) : r.ao;
  // --- C1: cliff-foot proximity (A) -----------------------------------------------------------------------------------
  const footWidth = opts.footWidth ?? 0;
  const foot = footWidth > 0 ? footMask(field, heights, n, footWidth) : null;

  // --- B1: crown-silhouette tree shadows (after the blur: the crown outline keeps its own crispness) ---------------------------
  let treeDark: Uint8Array | null = null;
  if (tcfg && field.layout.trees.length > 0) {
    treeDark = rasterTreeShadows({
      trees: field.layout.trees,
      style: tcfg.style,
      sun: sunDir,
      size: field.size,
      res,
      heightAt: (x, z) => field.bedHeightAt(x, z),
      strength: tcfg.strength ?? 0.62,
      species: tcfg.species,
      masks: tcfg.masks,
    });
    smoothBytes(treeDark, res, tcfg.edge ?? 0);
  }

  const data = new Uint8Array(res * res * 4);
  if (lowRes === res) {
    for (let o = 0; o < res * res; o++) {
      const i = o % res;
      const j = (o - i) / res;
      let sv = Math.min(1, vis[o] as number);
      if (treeDark) sv = Math.min(sv, 1 - (treeDark[o] as number) / 255);
      data[o * 4] = Math.round(sv * 255);
      data[o * 4 + 1] = Math.round(Math.min(1, ao[o] as number) * 255);
      data[o * 4 + 2] = Math.round(Math.min(1, sample(mask, i, j) * 1.4) * 255);
      data[o * 4 + 3] = foot ? Math.round(Math.min(1, Math.max(0, sample(foot, i, j))) * 255) : 255;
    }
    return { res, data };
  }
  // finer than the shadow / AO grid (B1): bilinear upsample of vis / AO (lowRes grid) and of the liquid / foot masks (n grid),
  // the crown silhouettes already live at `res`
  const mL = axisMap(res, lowRes);
  const mN = axisMap(res, n);
  const bil = (src: Float32Array, nn: number, m: { i0: Int32Array; f: Float32Array }, i: number, j: number): number => {
    const iu = m.i0[i] as number;
    const fu = m.f[i] as number;
    const jv = m.i0[j] as number;
    const fv = m.f[j] as number;
    const q = jv * nn + iu;
    const a = (src[q] as number) * (1 - fu) + (src[q + 1] as number) * fu;
    const b = (src[q + nn] as number) * (1 - fu) + (src[q + nn + 1] as number) * fu;
    return a * (1 - fv) + b * fv;
  };
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const o = j * res + i;
      let sv = Math.min(1, bil(vis, lowRes, mL, i, j));
      if (treeDark) sv = Math.min(sv, 1 - (treeDark[o] as number) / 255);
      data[o * 4] = Math.round(sv * 255);
      data[o * 4 + 1] = Math.round(Math.min(1, bil(ao, lowRes, mL, i, j)) * 255);
      data[o * 4 + 2] = Math.round(Math.min(1, bil(mask, n, mN, i, j) * 1.4) * 255);
      data[o * 4 + 3] = foot ? Math.round(Math.min(1, Math.max(0, bil(foot, n, mN, i, j))) * 255) : 255;
    }
  }
  return { res, data };
}

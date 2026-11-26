// Outfit utilities: the piece environment and `cover` (garments as clipped offsets of the body's own skin parts, so every
// piece fits any build/sex and keeps the source part's bone for skinning).
import { type Aabb, type Quat, type Vec3, qfromTo } from '../../../core/math.ts';
import type { Part } from '../../../core/sdf/body.ts';
import type { Sdf } from '../../../core/sdf/node.ts';
import { Offset, SmoothIntersect, SmoothSubtract } from '../../../core/sdf/ops.ts';
import { RoundedBox } from '../../../core/sdf/primitives.ts';
import type { Anatomy } from '../anatomy.ts';
import type { Ctx } from '../kit/ctx.ts';
import type { LimbEnv } from '../kit/limbs.ts';
import type { PieceSpec } from '../params.ts';

export interface PieceEnv {
  ctx: Ctx;
  a: Anatomy;
  i: number;
  spec: PieceSpec;
  /** material key (palette name) */
  mat: string;
  /** tags for this piece: unique piece tag first (paint order = piece order), then material key and extras */
  tag(...extra: string[]): string[];
  /** unique tag marking this piece's gold/edge trim */
  trimTag: string;
  n(key: string, def: number): number;
  s(key: string, def: string): string;
  b(key: string, def: boolean): boolean;
}

export function makeEnv(ctx: Ctx, spec: PieceSpec, i: number, defMat: string): PieceEnv {
  const o = spec.o ?? {};
  const mat = spec.mat ?? defMat;
  return {
    ctx,
    a: ctx.a,
    i,
    spec,
    mat,
    tag: (...extra) => [`p${i}`, ...extra],
    trimTag: `t${i}`,
    n: (k, d) => (typeof o[k] === 'number' ? (o[k] as number) : d),
    s: (k, d) => (typeof o[k] === 'string' ? (o[k] as string) : d),
    b: (k, d) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d),
  };
}

const overlaps = (a: Aabb, b: Aabb): boolean =>
  a.min[0] <= b.max[0] && a.max[0] >= b.min[0] && a.min[1] <= b.max[1] && a.max[1] >= b.min[1] && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];

export interface CoverOpts {
  /** clip region (garment is kept inside it) */
  clip?: Sdf;
  /** blend into the body (m) */
  w?: number;
  /** extra tags (feature) */
  extra?: string[];
  grip?: number;
  /** edge slabs: thin regions of the clip where gold trim is painted */
  trim?: Sdf[];
  /** only parts passing the predicate */
  filter?: (p: Part) => boolean;
  /** force every garment part onto this bone (e.g. a pauldron cap on the clavicle) */
  bone?: string;
  /** suffix for part names */
  name?: string;
  /** rounding of the clip edge (smooth-intersect width) */
  edge?: number;
  /** raised rim along the clip boundary: height above the garment and width (m) */
  lip?: { h: number; w: number };
  /** paint-only trim along the clip boundary (width m): follows any clip shape, unlike axis slabs */
  trimEdge?: number;
}

/** garment = every matching skin part inflated by `ext`, clipped; tags = piece tag + extras */
export function cover(e: PieceEnv, prefixes: string[], ext: number, o: CoverOpts = {}): void {
  const parts = e.ctx.body.parts.filter((p) => p.stage === 'base' && p.tags?.includes('skin') && prefixes.some((pre) => p.name.startsWith(pre)) && (!o.filter || o.filter(p)));
  const cb = o.clip?.bounds();
  for (const p of parts) {
    const off: Sdf = new Offset(p.sdf, ext);
    if (cb && !overlaps(off.bounds(), cb)) continue;
    const sdf: Sdf = o.clip ? new SmoothIntersect([off, o.clip], o.edge ?? 0.003) : off;
    e.ctx.add(`${e.spec.id}${o.name ?? ''}_${p.name}`, sdf, o.bone ?? p.bone, { tags: e.tag(e.mat, ...(o.extra ?? [])), w: o.w ?? 0.004, ...(o.grip !== undefined ? { grip: o.grip } : {}) });
    if (o.trimEdge && o.clip) {
      const tb = o.clip.bounds();
      const tm: Sdf = new Offset(p.sdf, ext + (o.lip?.h ?? 0) + 0.003);
      if (overlaps(tm.bounds(), tb)) {
        const band: Sdf = new SmoothSubtract(o.clip, [{ node: new Offset(o.clip, -o.trimEdge), w: 0.002 }]);
        e.ctx.mark(`${e.spec.id}${o.name ?? ''}_trimEdge_${p.name}`, new SmoothIntersect([tm, band], 0.001), [e.trimTag]);
      }
    }
    if (o.lip && o.clip) {
      // flange: a thin band just inside the clip boundary, raised by `lip.h`
      const band: Sdf = new SmoothSubtract(o.clip, [{ node: new Offset(o.clip, -o.lip.w), w: 0.002 }]);
      const rim: Sdf = new SmoothIntersect([new Offset(p.sdf, ext + o.lip.h), band], 0.0025);
      e.ctx.add(`${e.spec.id}${o.name ?? ''}_lip_${p.name}`, rim, o.bone ?? p.bone, { tags: e.tag(e.mat, ...(o.extra ?? [])), w: o.w ?? 0.004, ...(o.grip !== undefined ? { grip: o.grip } : {}) });
    }
    if (o.trim) {
      for (const [k, slab] of o.trim.entries()) {
        const tb = slab.bounds();
        const tm: Sdf = new Offset(p.sdf, ext + 0.003);
        if (!overlaps(tm.bounds(), tb)) continue;
        e.ctx.mark(`${e.spec.id}${o.name ?? ''}_trim${k}_${p.name}`, new SmoothIntersect([tm, slab], 0.001), [e.trimTag]);
      }
    }
  }
}

/** a raised band that follows the limb surface: skin parts matching `prefixes` inflated by `ext`, clipped to a thin slab (half-width `hw` m) at axis position u */
export function ridge(e: PieceEnv, prefixes: string[], env: LimbEnv, side: 'l' | 'r', u: number, hw: number, ext: number, name: string, o: { bone?: string; extra?: string[] } = {}): void {
  const du = hw / env.len;
  cover(e, prefixes, ext, { filter: (p) => p.name.endsWith(side), clip: slabAxis(env, u - du, u + du, hw * 0.5), name, w: 0.003, grip: 1.3, edge: hw * 0.6, ...(o.bone ? { bone: o.bone } : {}), ...(o.extra ? { extra: o.extra } : {}) });
}

/** horizontal slab y0..y1 (infinite in x/z) */
export const slabY = (y0: number, y1: number, round = 0.002): Sdf => new RoundedBox([0, (y0 + y1) / 2, 0], [2, (y1 - y0) / 2, 2], round);

/** slab perpendicular to a limb axis between u0 and u1 */
export function slabAxis(env: LimbEnv, u0: number, u1: number, round = 0.002): Sdf {
  const a = env.at(u0), b = env.at(u1);
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const half = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2;
  const d = env.dir((u0 + u1) / 2);
  // rotate local +Z onto the axis
  const q = qZ(d);
  return new RoundedBox(mid, [2, 2, half], round, q);
}

function qZ(d: Vec3): Quat {
  return qfromTo([0, 0, 1], d);
}

/** a box clip in world space (centre, half extents) */
export const boxClip = (c: Vec3, h: Vec3, round = 0.002): Sdf => new RoundedBox(c, h, round);

/** clip A minus a cutter, smooth */
export const clipMinus = (a: Sdf, cutters: Sdf[], w = 0.004): Sdf => new SmoothSubtract(a, cutters.map((node) => ({ node, w })));

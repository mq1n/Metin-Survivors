// Fur coat builder shared by the frost giants: shoot rays at the body SDF to find root spots, then lay jittered shaggy locks.
import { type Vec3, vadd, vnorm, vscale, vsub } from '../../core/math.ts';
import type { Rng } from '../../core/rng.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import type { Ctx } from '../humanoid/index.ts';
import { frame, lock, surfaceAlong } from './kit.ts';

export type BoneFn = string | ((p: Vec3) => string);

export interface Spot {
  p: Vec3;
  n: Vec3;
}

export interface Ray {
  o: Vec3;
  dir: Vec3;
}

/** surface points + normals along rays shot from inside the body */
export function spotsOf(base: Sdf, rays: Ray[]): Spot[] {
  const out: Spot[] = [];
  for (const r of rays) {
    const hit = surfaceAlong(base, r.o, r.dir, 1.4);
    if (!hit) continue;
    out.push({ p: hit.p, n: base.grad(hit.p[0], hit.p[1], hit.p[2], 0.012) });
  }
  return out;
}

export interface LockSpec {
  dir: Vec3;
  len: number;
  w: number;
  flat?: number;
  curl?: number;
  tipW?: number;
  segs?: 2 | 3;
  inset?: number;
  /** direction-jitter strength (default 0.42) */
  jit?: number;
  /** extra tags (default ['fur']) */
  tags?: string[];
  /** blend into the body (m) */
  blend?: number;
}

/** fur coat: remembers the rng and a part counter; every lock becomes one body part skinned to `bone` */
export class Coat {
  private n = 0;
  constructor(readonly ctx: Ctx, readonly base: Sdf, readonly rng: Rng, private readonly kLen = 1, private readonly kDens = 1) {}

  /** ring count scaled by the density multiplier */
  count(n: number): number {
    return Math.max(3, Math.round(n * this.kDens));
  }

  lock(region: string, bone: BoneFn, s: Spot, o: LockSpec): void {
    const j = (): number => this.rng.range(-1, 1);
    // jitter the growth direction (strand-level irregularity); the root sits a little under the skin so it fuses
    const side = frame(o.dir, s.n).x;
    const dir = vnorm(vadd(vadd(o.dir, vscale(side, (o.jit ?? 0.42) * j())), vscale(s.n, 0.14 * j())));
    const root: Vec3 = vsub(s.p, vscale(s.n, o.inset ?? 0.02));
    // a few strays are longer so the hem is ragged, not a clean fringe
    const stray = this.rng.next() < 0.14 ? 1.22 : 1;
    const len = o.len * this.kLen * (0.72 + 0.5 * this.rng.next()) * stray;
    const sdf = lock(root, {
      dir, len, w: o.w * (0.85 + 0.3 * this.rng.next()), flat: o.flat ?? 0.85, facing: s.n, curl: o.curl ?? 0.85,
      tipW: o.tipW ?? Math.max(o.w * 0.4, 0.022), segs: o.segs ?? 3,
    });
    const b = typeof bone === 'function' ? bone(s.p) : bone;
    this.ctx.add(`fur_${region}_${this.n++}`, sdf, b, { tags: o.tags ?? ['fur'], w: o.blend ?? 0.016, grip: 1 });
  }

  /**
   * Rows of locks around a limb between A and B: row `u` (0..1 along the limb) shoots `count` radial rays about the axis, rows
   * staggered by half a step. Growth = along the limb * axisPull + surface normal * grow + gravity * 0.34.
   */
  rings(region: string, bone: BoneFn, A: Vec3, B: Vec3, sxSide: 1 | -1, rows: { u: number; len: number; w: number }[], count: number, grow: number, axisPull = 0.8, spec: Partial<LockSpec> = {}): void {
    const axis = vnorm(vsub(B, A));
    const fr = frame(axis, [sxSide, 0, 0]);
    rows.forEach((row, ri) => {
      const o: Vec3 = [A[0] + (B[0] - A[0]) * row.u, A[1] + (B[1] - A[1]) * row.u, A[2] + (B[2] - A[2]) * row.u];
      const c = this.count(count);
      const rays: Ray[] = [];
      for (let i = 0; i < c; i++) {
        const phi = (Math.PI * 2 * (i + 0.5 + (ri % 2) * 0.5)) / c;
        rays.push({ o, dir: [fr.x[0] * Math.cos(phi) + fr.z[0] * Math.sin(phi), fr.x[1] * Math.cos(phi) + fr.z[1] * Math.sin(phi), fr.x[2] * Math.cos(phi) + fr.z[2] * Math.sin(phi)] });
      }
      for (const sp of spotsOf(this.base, rays)) {
        const g = vnorm(vadd(vadd(vscale(axis, axisPull), vscale(sp.n, grow)), vscale([0, -1, 0], 0.34)));
        this.lock(region, bone, sp, { dir: g, len: row.len, w: row.w, ...spec });
      }
    });
  }
}

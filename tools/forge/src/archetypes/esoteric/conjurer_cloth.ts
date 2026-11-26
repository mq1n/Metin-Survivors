// Authored hanging cloth for the conjurer: a thin closed slab (front sheet + back sheet + edge strips) whose top edge follows a rail and
// whose body hangs straight down under gravity. The geometry is authored in the IDLE pose's world space (so a sleeve drape hangs
// vertically from a forearm that points forward) and converted to the rest pose by the inverse of the bone's idle transform; rigidly
// skinned to the bone it then reproduces the authored shape in the idle clip and swings with the arm in the others.
import { PoseCtx } from '../../core/anim/clip.ts';
import { type Quat, type Vec3, qinv, qrotate, vadd, vcross, vdot, vnorm, vscale, vsub } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { ClipSpec } from '../../core/anim/clip.ts';
import type { Authored } from './conjurer_strips.ts';

/** world idle transform of every bone, from the finished clip list (the clip `idle` at t = 0) */
export function idleFrames(sk: Skeleton, clips: ClipSpec[]): { rot: Quat[]; pos: Vec3[] } {
  const idle = clips.find((c) => c.name === 'idle');
  if (!idle) throw new Error('conjurer: no idle clip');
  const c = new PoseCtx(sk, 0, 0, idle.duration);
  idle.pose(c);
  return sk.fk(c.pose);
}

/** map an idle-world point into the rest pose of `bone` (rigid skinning to that bone then lands it back on the authored point) */
export function toRest(sk: Skeleton, frames: { rot: Quat[]; pos: Vec3[] }, bone: string): (p: Vec3) => Vec3 {
  const i = sk.idx(bone);
  const R = qinv(frames.rot[i]!);
  const pos = frames.pos[i]!;
  const rest = sk.restPos(bone);
  return (p) => vadd(rest, qrotate(R, vsub(p, pos)));
}

export interface ClothSpec {
  bone: string;
  /** top rail (idle world points, along the sheet) */
  rail: Vec3[];
  /** hang direction (unit) */
  hang: Vec3;
  /** drop per rail point (m) */
  depth: number[];
  /** outward side the front faces (world, any length) */
  outward: Vec3;
  /** the lower edge moves this far along the sheet normal (m): two panels spreading apart make a hanging pouch */
  spread: number;
  /** sideways pleats: amplitude (m) and count along the rail */
  ripple: number;
  folds: number;
  phase?: number;
  /** slab thickness (m) */
  t: number;
  /** idle world -> rest */
  toRest: (p: Vec3) => Vec3;
}

/** grid rows down the drop */
const NV = 2;

export function addCloth(out: Authored, c: ClothSpec): void {
  const nu = c.rail.length - 1;
  const W = nu + 1;
  const P: Vec3[][] = [];
  const N: Vec3[] = [];
  for (let i = 0; i <= nu; i++) {
    const a = c.rail[Math.max(i - 1, 0)]!, b = c.rail[Math.min(i + 1, nu)]!;
    let n = vnorm(vcross(vsub(b, a), c.hang));
    if (vdot(n, c.outward) < 0) n = vscale(n, -1);
    N.push(n);
    const col: Vec3[] = [];
    for (let j = 0; j <= NV; j++) {
      const h = j / NV;
      const wave = c.ripple * Math.sin((i / nu) * Math.PI * 2 * c.folds + (c.phase ?? 0) + h * 1.3) * h ** 0.8;
      col.push(vadd(vadd(c.rail[i]!, vscale(c.hang, c.depth[i]! * h)), vscale(n, wave + c.spread * h ** 1.2)));
    }
    P.push(col);
  }
  const push = (p: Vec3, n: Vec3): number => {
    const k = out.positions.length / 3;
    const q = c.toRest(p);
    out.positions.push(q[0], q[1], q[2]);
    // normals rotate with the same rigid map: transform the direction by (toRest(p + n) - toRest(p))
    const r = c.toRest(vadd(p, n));
    const d = vnorm(vsub(r, q));
    out.normals.push(d[0], d[1], d[2]);
    out.skin.push([{ bone: c.bone, w: 1 }]);
    return k;
  };
  const tri = (a: number, b: number, d: number, want: Vec3): void => {
    // orient the triangle (a, b, d) so its geometric normal agrees with `want` (checked in rest space)
    const pa = pos(out, a), pb = pos(out, b), pd = pos(out, d);
    const wantRest = vsub(c.toRest(vadd(c.rail[0]!, want)), c.toRest(c.rail[0]!));
    const nrm = vcross(vsub(pb, pa), vsub(pd, pa));
    if (vdot(nrm, wantRest) >= 0) out.indices.push(a, b, d);
    else out.indices.push(a, d, b);
  };
  const h2 = c.t / 2;
  // front (outward) and back sheets
  for (const side of [1, -1] as const) {
    const base: number[][] = [];
    for (let i = 0; i <= nu; i++) {
      const col: number[] = [];
      for (let j = 0; j <= NV; j++) col.push(push(vadd(P[i]![j]!, vscale(N[i]!, h2 * side)), vscale(N[i]!, side)));
      base.push(col);
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < NV; j++) {
        const a = base[i]![j]!, b = base[i + 1]![j]!, d = base[i]![j + 1]!, e = base[i + 1]![j + 1]!;
        const want = vscale(N[i]!, side);
        tri(a, b, d, want);
        tri(b, e, d, want);
      }
    }
  }
  // edge strips (flat shaded): top, bottom, first and last column
  const strip = (pa: Vec3, pb: Vec3, na: Vec3, nb: Vec3, outward: Vec3): void => {
    const q: number[] = [
      push(vadd(pa, vscale(na, h2)), outward), push(vadd(pa, vscale(na, -h2)), outward),
      push(vadd(pb, vscale(nb, h2)), outward), push(vadd(pb, vscale(nb, -h2)), outward),
    ];
    tri(q[0]!, q[2]!, q[1]!, outward);
    tri(q[2]!, q[3]!, q[1]!, outward);
  };
  const up = vscale(c.hang, -1);
  for (let i = 0; i < nu; i++) {
    strip(P[i]![0]!, P[i + 1]![0]!, N[i]!, N[i + 1]!, up);
    strip(P[i]![NV]!, P[i + 1]![NV]!, N[i]!, N[i + 1]!, c.hang);
  }
  const tl = vnorm(vsub(c.rail[0]!, c.rail[1]!)), tr = vnorm(vsub(c.rail[nu]!, c.rail[nu - 1]!));
  for (let j = 0; j < NV; j++) {
    strip(P[0]![j]!, P[0]![j + 1]!, N[0]!, N[0]!, tl);
    strip(P[nu]![j]!, P[nu]![j + 1]!, N[nu]!, N[nu]!, tr);
  }
  void W;
}

function pos(out: Authored, i: number): Vec3 {
  return [out.positions[i * 3]!, out.positions[i * 3 + 1]!, out.positions[i * 3 + 2]!];
}

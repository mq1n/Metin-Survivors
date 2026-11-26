// Limb envelopes: where the arms/legs are and how thick (muscle bulges included), so garments and armour fit the body.
// u runs 0..1 along shoulder->elbow->wrist (arms) or hip->knee->ankle (legs).
import { type Quat, type Vec3, qfromTo, vlerp, vnorm, vsub } from '../../../core/math.ts';
import type { Sdf } from '../../../core/sdf/node.ts';
import { SmoothIntersect } from '../../../core/sdf/ops.ts';
import { RoundedBox } from '../../../core/sdf/primitives.ts';
import { profileAt, tube } from '../../../core/sdf/shapes.ts';
import type { Anatomy } from '../anatomy.ts';
import type { Side } from '../params.ts';
import { Loft, type Station } from './loft.ts';

export type Limb = 'arm' | 'leg';

const prof = (p: readonly (readonly [number, number])[], t: number): number => profileAt(p, t);

export interface LimbEnv {
  /** world position of the axis at u */
  at(u: number): Vec3;
  /** envelope radius (body surface incl. muscle bulge) at u */
  r(u: number): number;
  /** fraction of u where the middle joint (elbow/knee) is */
  uMid: number;
  /** bone name for u (upper or lower segment) given side letter */
  bone(u: number, n: 'l' | 'r'): string;
  /** unit axis direction at u */
  dir(u: number): Vec3;
  len: number;
}

export function limbEnv(a: Anatomy, sx: Side, limb: Limb): LimbEnv {
  const j = a.side(sx);
  const s = a.s;
  const mus = a.b.muscle;
  if (limb === 'arm') {
    const A = j.shoulder, B = j.elbow, C = j.wrist;
    const l1 = Math.hypot(...vsub(B, A)), l2 = Math.hypot(...vsub(C, B));
    const uMid = l1 / (l1 + l2);
    const ur = a.r.upperArm, fr = a.r.forearm;
    const bul = (0.012 + 0.012 * mus) * s;
    const up: [number, number][] = [[0, ur * 1.04 + 0.02 * s], [0.12, ur * 1.1 + 0.014 * s], [0.38, ur * 1.1 + bul], [0.7, ur * 0.94], [1, a.r.elbow * 1.06]];
    const fa: [number, number][] = [[0, fr * 1.04], [0.22, fr * 1.12 + 0.01 * s], [0.62, fr * 0.8], [1, a.r.wrist * 1.0]];
    const at = (u: number): Vec3 => (u <= uMid ? vlerp(A, B, u / uMid) : vlerp(B, C, (u - uMid) / (1 - uMid)));
    return {
      at,
      r: (u) => (u <= uMid ? prof(up, u / uMid) : prof(fa, (u - uMid) / (1 - uMid))),
      uMid,
      bone: (u, n) => (u <= uMid + 0.03 ? `upper_arm_${n}` : `forearm_${n}`),
      dir: (u) => (u <= uMid ? vnorm(vsub(B, A)) : vnorm(vsub(C, B))),
      len: l1 + l2,
    };
  }
  const A = j.hip, B = j.knee, C = j.ankle;
  const l1 = Math.hypot(...vsub(B, A)), l2 = Math.hypot(...vsub(C, B));
  const uMid = l1 / (l1 + l2);
  const tr = a.r.thigh, cr = a.r.calf;
  const th: [number, number][] = [[0, tr * 1.04], [0.28, tr * 1.08 + 0.012 * s], [0.7, tr * 0.86], [1, a.r.knee * 1.12]];
  const sh: [number, number][] = [[0, a.r.knee * 1.05], [0.2, cr * 1.0 + 0.012 * s], [0.34, cr * 1.0 + (0.018 + 0.012 * mus) * s], [0.65, cr * 0.76], [1, a.r.ankle * 1.1]];
  const at = (u: number): Vec3 => {
    const v = u <= uMid ? vlerp(A, B, u / uMid) : vlerp(B, C, (u - uMid) / (1 - uMid));
    return v;
  };
  return {
    at,
    r: (u) => (u <= uMid ? prof(th, u / uMid) : prof(sh, (u - uMid) / (1 - uMid))),
    uMid,
    bone: (u, n) => (u <= uMid + 0.02 ? `thigh_${n}` : `shin_${n}`),
    dir: (u) => (u <= uMid ? vnorm(vsub(B, A)) : vnorm(vsub(C, B))),
    len: l1 + l2,
  };
}

/** a tube following the limb between u0 and u1 with radius = envelope + ext (ext may vary with u) */
export function limbTube(env: LimbEnv, u0: number, u1: number, ext: number | ((u: number) => number), opts: { segments?: number; w?: number } = {}): Sdf {
  const n = opts.segments ?? Math.max(3, Math.ceil(((u1 - u0) * env.len) / 0.05));
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) pts.push(env.at(u0 + ((u1 - u0) * i) / n));
  const e = typeof ext === 'number' ? () => ext : ext;
  return tube(pts, (t) => {
    const u = u0 + (u1 - u0) * t;
    return env.r(u) + e(u);
  }, { segments: n, w: opts.w ?? 0.015 });
}

/** the same tube with flat, crisp ends: intersected with a slab perpendicular to the axis */
export function limbBand(env: LimbEnv, u0: number, u1: number, ext: number | ((u: number) => number), opts: { segments?: number; edge?: number; round?: number } = {}): Sdf {
  const pad = 0.03;
  const du = pad / env.len;
  const t = limbTube(env, Math.max(u0 - du, 0), Math.min(u1 + du, 1), ext, opts.segments !== undefined ? { segments: opts.segments + 1 } : {});
  const a = env.at(u0), b = env.at(u1);
  const mid = vlerp(a, b, 0.5);
  const half = Math.hypot(...vsub(b, a)) / 2;
  const q: Quat = qfromTo([0, 0, 1], vnorm(vsub(b, a)));
  const slab = new RoundedBox(mid, [0.5, 0.5, half], opts.round ?? 0.004, q);
  return new SmoothIntersect([t, slab], opts.edge ?? 0.004);
}

/** vertical torso shell (clipped to [y0, y1]) following the body stations, offset by ext(y) in x and z */
export function torsoShell(a: Anatomy, y0: number, y1: number, ext: number | ((y: number) => number), opts: { scaleX?: number; scaleZ?: number; n?: number } = {}): { sdf: Sdf; bone: string }[] {
  const e = typeof ext === 'number' ? () => ext : ext;
  const sxs = opts.scaleX ?? 1, szs = opts.scaleZ ?? 1;
  const st: Station[] = a.torso.map((q) => ({ y: q.y, rx: q.rx * sxs + e(q.y), rz: q.rz * szs + e(q.y), cz: q.cz ?? 0, n: opts.n ?? (q.n ?? 2) }));
  const cuts: { lo: number; hi: number; bone: string }[] = [
    { lo: -Infinity, hi: a.spine[1] + 0.04 * a.s, bone: 'pelvis' },
    { lo: a.spine[1] - 0.05 * a.s, hi: a.chest[1] + 0.045 * a.s, bone: 'spine' },
    { lo: a.chest[1] - 0.05 * a.s, hi: Infinity, bone: 'chest' },
  ];
  const out: { sdf: Sdf; bone: string }[] = [];
  for (const c of cuts) {
    const lo = Math.max(c.lo, y0), hi = Math.min(c.hi, y1);
    if (hi - lo < 0.004) continue;
    out.push({ sdf: new Loft(st, { range: [lo, hi] }), bone: c.bone });
  }
  return out;
}

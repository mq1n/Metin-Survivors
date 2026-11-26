// The barbarian's war club: a gnarled tree-limb with a bulbous head, riveted iron bands, ring of bone spikes and a leather-wrapped
// grip. Modelled in the REST hand frame of the right hand (kit.ts `hp`: m toward the body centre, y up, z along the grip axis) and
// rigid-skinned to the wrist bone, so the IK-aimed hand carries it. Reference metres scaled by the body scale `a.s`.
import type { Vec3 } from '../../core/math.ts';
import { Ellipsoid, RoundCone, Sphere, Torus } from '../../core/sdf/primitives.ts';
import { tube } from '../../core/sdf/shapes.ts';
import type { Anatomy, Ctx } from '../humanoid/index.ts';
import { handRef, hp, rigid } from '../humans/kit.ts';
import { spikeSdf } from './barbarian-kit.ts';

export interface ClubOpts {
  size?: number;
  mats?: { wood?: string; wrap?: string; iron?: string; bone?: string };
}

/** overall reach of the club along the grip axis from the palm (reference metres): used by the clip author */
export const CLUB_LEN = 1.12;

export function addClub(ctx: Ctx, a: Anatomy, o: ClubOpts = {}): void {
  const h = handRef(a, 'r');
  const s = a.s * (o.size ?? 1);
  const m = o.mats ?? {};
  const wood = ctx.piece(m.wood ?? 'leather3', { trim: 'none' });
  const wrap = ctx.piece(m.wrap ?? 'leather2', { trim: 'none' });
  const iron = ctx.piece(m.iron ?? 'plate', { trim: 'none' });
  const bone = ctx.piece(m.bone ?? 'bone', { trim: 'none' });
  const P = (mm: number, y: number, z: number): Vec3 => hp(h, mm * s, y * s, z * s);
  const bn = h.bone;

  // ---- shaft + bulbous head as one swept tube (z = distance along the club from the palm)
  const zs = [-0.11, 0.02, 0.2, 0.4, 0.56, 0.68, 0.8, 0.92, 1.02, 1.1];
  const rs = [0.034, 0.027, 0.026, 0.032, 0.05, 0.082, 0.1, 0.096, 0.07, 0.034];
  // slight gnarl: the centre line wanders a little off the grip axis
  const wob: [number, number][] = [[0, 0], [0, 0], [0.004, 0.003], [0.008, -0.004], [0.006, 0.01], [0.002, 0.012], [-0.006, 0.006], [-0.008, 0.0], [-0.004, -0.006], [0, 0]];
  const path = zs.map((z, i) => P(wob[i]![0], wob[i]![1], z));
  const prof = rs.map((r, i) => [i / (rs.length - 1), r * s] as [number, number]);
  rigid(ctx, 'club_body', tube(path, prof, { segments: 20, w: 0.012 * s }), bn, [wood.tag], 0.01 * s);

  // ---- knots / burls
  const knots: [number, number, number, number, number][] = [
    [0.022, 0.012, 0.3, 0.04, 0.05], [-0.03, -0.02, 0.5, 0.046, 0.055], [-0.07, 0.05, 0.78, 0.045, 0.05], [0.07, -0.05, 0.9, 0.05, 0.045], [0.02, 0.085, 0.66, 0.04, 0.04],
  ];
  knots.forEach(([mm, y, z, rx, rz], i) => rigid(ctx, `club_knot${i}`, new Ellipsoid(P(mm, y, z), [rx * s, rx * 0.9 * s, rz * s]), bn, [wood.tag], 0.012 * s));

  // ---- leather-wrapped grip with raised turns, and a wrist loop of cord
  rigid(ctx, 'club_wrap', new RoundCone(P(0, 0, -0.045), P(0, 0, 0.19), 0.0335 * s, 0.0335 * s), bn, [wrap.tag], 0.004 * s);
  for (let i = 0; i < 4; i++) {
    rigid(ctx, `club_turn${i}`, new Torus(P(0, 0, -0.02 + i * 0.055), 0.0345 * s, 0.0075 * s, [0, 0, 1]), bn, [wrap.tag], 0.003 * s);
  }
  rigid(ctx, 'club_pommel', new Ellipsoid(P(0, 0, -0.125), [0.038 * s, 0.038 * s, 0.03 * s]), bn, [iron.tag], 0.004 * s);
  // trailing leather thong off the butt
  rigid(ctx, 'club_thong', new RoundCone(P(0.02, 0, -0.12), P(0.05, -0.1, -0.2), 0.011 * s, 0.006 * s), bn, [wrap.tag], 0.004 * s);

  // ---- riveted iron bands + studs
  const bands: [number, number, number][] = [[0.585, 0.063, 0.012], [0.8, 0.108, 0.013], [0.975, 0.092, 0.012]];
  for (const [z, R, r] of bands) {
    rigid(ctx, `club_band${z}`, new Torus(P(0, 0, z), R * s, r * s, [0, 0, 1]), bn, [iron.tag], 0.004 * s);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + (z > 0.7 ? 0.2 : 0);
      rigid(ctx, `club_stud${z}_${i}`, new Sphere(P(Math.cos(t) * (R + r * 0.5), Math.sin(t) * (R + r * 0.5), z), 0.0165 * s), bn, [iron.tag], 0.003 * s);
    }
  }

  // ---- ring of bone spikes (two staggered rows) + tip spike
  const rows: [number, number, number, number, number][] = [[0.7, 0.085, 0.17, 0.021, 0], [0.88, 0.1, 0.205, 0.022, Math.PI / 6]];
  for (const [z, rIn, rOut, r0, off] of rows) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + off + 0.15 * (z > 0.8 ? 1 : 0);
      const c = Math.cos(t), sn = Math.sin(t);
      rigid(ctx, `club_spike${z}_${i}`, spikeSdf(P(c * rIn * 0.8, sn * rIn * 0.8, z - 0.01), P(c * rOut, sn * rOut, z + 0.05), r0 * s, 0.0042 * s), bn, [bone.tag], 0.004 * s);
    }
  }
  rigid(ctx, 'club_tip', spikeSdf(P(0, 0, 1.03), P(0.005, 0.01, 1.2), 0.032 * s, 0.006 * s), bn, [bone.tag], 0.004 * s);
}

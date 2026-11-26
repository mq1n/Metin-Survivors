// Club of frozen wood: a gnarled, knotted branch with broken twig stubs and embedded ice crystals, held in the right hand.
// Built in the weapon frame of the hand (weapon +Y along the haft = hand +Z at rest; see humanoid README "Hand frame") and
// skinned to the wrist bone, so wherever the pose solver puts the fist the club follows rigidly. Tags: 'wood', 'ice', 'core'.
import { type Vec3, qfromBasis, vadd, vnorm, vscale } from '../../core/math.ts';
import type { Rng } from '../../core/rng.ts';
import { tube } from '../../core/sdf/shapes.ts';
import type { Ctx } from '../humanoid/index.ts';
import { chunk, crystal, el, orient, rc } from './kit.ts';

export interface ClubOpts {
  /** overall size multiplier (default 1 = 1.3 m) */
  scale?: number;
  /** side the club is held on (default right) */
  side?: 'r' | 'l';
}

export function addClub(ctx: Ctx, rng: Rng, o: ClubOpts = {}): void {
  const a = ctx.a;
  const side = o.side ?? 'r';
  const sx = side === 'l' ? 1 : -1;
  const k = (o.scale ?? 1) * (a.s / 1.19);
  const palm = a.side(sx).palm;
  // weapon frame: X = flat normal, Y = haft (hand +Z at rest), Z = edge side (hand -X for the right hand)
  const X: Vec3 = side === 'r' ? [0, -1, 0] : [0, 1, 0];
  const Y: Vec3 = [0, 0, 1];
  const Z: Vec3 = side === 'r' ? [-1, 0, 0] : [1, 0, 0];
  const P = (x: number, y: number, z: number): Vec3 => [palm[0] + (X[0] * x + Y[0] * y + Z[0] * z) * k, palm[1] + (X[1] * x + Y[1] * y + Z[1] * z) * k, palm[2] + (X[2] * x + Y[2] * y + Z[2] * z) * k];
  const D = (x: number, y: number, z: number): Vec3 => vnorm([X[0] * x + Y[0] * y + Z[0] * z, X[1] * x + Y[1] * y + Z[1] * z, X[2] * x + Y[2] * y + Z[2] * z]);
  const bone = `wrist_${side}`;
  const WOOD = { tags: ['wood'], w: 0.02, grip: 2 };
  const ICE = ['ice', 'club'];

  // haft: a slightly crooked branch, thin at the grip, swelling into a knobbly head
  const path: Vec3[] = [P(0, -0.26, 0), P(0.012, 0.0, -0.01), P(0.0, 0.34, 0.016), P(-0.016, 0.66, 0.0), P(0.012, 0.88, -0.014), P(0, 1.06, 0)];
  const radius = (t: number): number => {
    const keys: [number, number][] = [[0, 0.036], [0.12, 0.031], [0.3, 0.036], [0.55, 0.05], [0.76, 0.085], [0.9, 0.118], [1, 0.1]];
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, r0] = keys[i]!, [t1, r1] = keys[i + 1]!;
      if (t <= t1) return (r0 + ((r1 - r0) * (t - t0)) / (t1 - t0)) * k;
    }
    return keys[keys.length - 1]![1] * k;
  };
  ctx.add('club_haft', tube(path, radius, { segments: 7, w: 0.03 * k }), bone, WOOD);

  // knots / gnarls swelling out of the head and the shaft
  const knots: { y: number; x: number; z: number; r: Vec3 }[] = [
    { y: 0.5, x: 0.045, z: 0.01, r: [0.05, 0.065, 0.05] },
    { y: 0.72, x: -0.07, z: -0.03, r: [0.06, 0.075, 0.058] },
    { y: 0.9, x: 0.08, z: 0.05, r: [0.07, 0.08, 0.066] },
    { y: 0.96, x: -0.05, z: -0.085, r: [0.062, 0.07, 0.062] },
    { y: 0.82, x: 0.02, z: -0.09, r: [0.05, 0.06, 0.05] },
    { y: -0.2, x: 0.0, z: 0.0, r: [0.05, 0.05, 0.05] },
  ];
  knots.forEach((kn, i) => ctx.add(`club_knot_${i}`, el(P(kn.x, kn.y, kn.z), [kn.r[0] * k, kn.r[1] * k, kn.r[2] * k], qfromBasis(X, Y, Z)), bone, { ...WOOD, w: 0.025 }));
  // broken twig stubs
  const stubs: [number, Vec3, number][] = [[0.62, [0.7, 0.3, 0.2], 0.1], [0.84, [-0.8, 0.25, -0.1], 0.12], [0.93, [0.2, 0.2, 0.95], 0.1], [0.46, [-0.2, 0.4, -0.9], 0.08]];
  stubs.forEach(([y, d, l], i) => {
    const dir = D(...d);
    const b = P(0, y, 0);
    const tip = vadd(b, vscale(dir, l * k));
    ctx.add(`club_stub_${i}`, rc(b, tip, 0.026 * k, 0.016 * k), bone, { ...WOOD, w: 0.012 });
    ctx.add(`club_stubcap_${i}`, el(tip, [0.02 * k, 0.02 * k, 0.02 * k]), bone, { ...WOOD, w: 0.008 });
  });

  // frozen head: hewn ice cap on the end + crystals thrusting out of the knotty head
  ctx.add('club_icecap', chunk(P(0, 1.07, 0), [0.1 * k, 0.085 * k, 0.1 * k], rng, { planes: 10, cut: [0.76, 0.94], rot: orient(D(0, 1, 0)) }), bone, { tags: ICE, w: 0.008, grip: 2 });
  const cr: { at: Vec3; ax: Vec3; r: number; len: number; tip: number }[] = [
    { at: P(0, 1.12, 0), ax: D(0, 1, 0), r: 0.04, len: 0.06, tip: 0.14 },
    { at: P(0.06, 0.98, 0.0), ax: D(1, 0.7, 0.2), r: 0.032, len: 0.09, tip: 0.1 },
    { at: P(-0.05, 0.86, 0.055), ax: D(-0.4, 0.5, 1), r: 0.03, len: 0.08, tip: 0.1 },
    { at: P(-0.06, 0.78, -0.05), ax: D(-0.8, 0.45, -0.7), r: 0.028, len: 0.07, tip: 0.09 },
    { at: P(0.03, 0.9, -0.08), ax: D(0.3, 0.6, -1), r: 0.026, len: 0.06, tip: 0.085 },
  ];
  cr.forEach((c, i) => ctx.add(`club_crystal_${i}`, crystal(c.at, c.ax, { r: c.r * k, len: c.len * k, tip: c.tip * k, twist: i * 0.7, jit: { rng, tilt: 0.07 }, round: 0.0015 }), bone, { tags: ICE, w: 0.006, grip: 2 }));
  // small glowing gem trapped in the ice
  ctx.late('core_club', el(P(0.0, 1.08, 0.06), [0.022 * k, 0.03 * k, 0.022 * k]), bone, { tags: ['core'], w: 0.002 });
}

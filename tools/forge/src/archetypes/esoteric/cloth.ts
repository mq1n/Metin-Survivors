// Cloth / strap helpers shared by the monk and zealot garments (ascetic_*.ts, zealot_*.ts). SDF cloth cannot be thinner than ~1.3 cm at the
// 8 mm crowd voxel, so panels are curved Plates (cylindrical shell patches) and strips are flattened round cones: both read as folded cloth
// with a visible edge, and both hang from a swinging skirt / cape bone.
import { type Vec3, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { RoundCone, Sphere, Torus } from '../../core/sdf/primitives.ts';
import { flatCone, tube } from '../../core/sdf/shapes.ts';
import { Plate, type PieceEnv, type PlateOpts } from '../humanoid/index.ts';
import { torsoPoint } from '../orc/pieces.ts';

/** a curved cloth panel hanging from `top` down by `len` (world metres), facing `nrm`; `half` = half width along the arc */
export interface PanelOpts {
  top: Vec3;
  len: number;
  half: number;
  nrm: Vec3;
  /** curvature radius (0 = flat); > 0 wraps around something behind the panel */
  R?: number;
  t?: number;
  /** + narrows toward the top (flare to the hem), - the opposite */
  taper?: number;
  /** hem dip at the middle (metres) */
  bow?: number;
  edgeThin?: number;
  round?: number;
  /** hang direction (default straight down) */
  down?: Vec3;
}

export function panel(o: PanelOpts): Plate {
  const down = vnorm(o.down ?? [0, -1, 0]);
  const c: Vec3 = vadd(o.top, vscale(down, o.len / 2));
  const po: PlateOpts = {
    o: c, nrm: o.nrm, up: vscale(down, -1), hu: o.half, hv: o.len / 2, R: o.R ?? 0, t: o.t ?? 0.016, round: o.round ?? 0.005,
    taper: o.taper ?? 0, bow: o.bow ?? 0, edgeThin: o.edgeThin ?? 0.8,
  };
  return new Plate(po);
}

/** flat tapered strip (ribbon / rag / tassel): `facing` = flat-face normal */
export const strip = (base: Vec3, tip: Vec3, wBase: number, wTip: number, flat = 0.3, facing: Vec3 = [0, 0, 1]): Sdf => flatCone(base, tip, wBase, wTip, flat, facing);

/** a ring of cord / cloth around a limb at `at` with axis `dir` */
export const ring = (at: Vec3, dir: Vec3, R: number, r: number): Sdf => new Torus(at, R, r, dir);

/** round bead / knuckle shorthand */
export const bar = (a: Vec3, b: Vec3, ra: number, rb = ra): Sdf => new RoundCone(a, b, ra, rb);

/** point on a quadratic bezier */
export const bez = (a: Vec3, b: Vec3, c: Vec3, t: number): Vec3 => vlerp(vlerp(a, b, t), vlerp(b, c, t), t);

export const sub = vsub;

/** paint-tag helper for pieces: material tags plus an optional feature tag */
export const tagsOf = (e: PieceEnv, ...x: string[]): string[] => e.tag(e.mat, ...x);

export interface BeadLoopOpts {
  /** cord radius (metres, already scaled) */
  r: number;
  /** big bead radius (metres, already scaled; 0 = none) */
  bead?: number;
  /** number of big beads along the loop */
  beads?: number;
  /** vertical drop of the loop below the neck base (metres) */
  drop: number;
  /** half chest arc 0..1 where the loop leaves the neck */
  spread?: number;
  /** minimum clearance (metres) between the cord surface and the torso under it once the loop has left the neck */
  clear?: number;
  /** neck-base offset (metres, positive = lower) */
  y?: number;
  /** name prefix */
  name?: string;
  /** bone (default chest) */
  bone?: string;
}

const smooth01 = (x: number): number => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * A prayer-bead loop hanging from the neck over the chest. A chain of small spheres melts into decimation shards at the crowd voxel size, and
 * anything closer than ~1.6 cm to the body webs over, so the loop is ONE smooth cord tube with a few big beads on it that is half-embedded at
 * the neck and hangs free of the torso (>= `clear`) below it. A hunched torso leaves the loop even further out (it hangs straight down
 * from the neck front). The Painter paints the individual beads on the cord.
 */
export function beadLoop(e: PieceEnv, o: BeadLoopOpts): void {
  const a = e.a;
  const spread = o.spread ?? 0.72;
  const yN = a.neck[1] - (o.y ?? 0.03 * a.s);
  const clear = o.clear ?? 0.026 * a.s;
  const zN = torsoPoint(a, yN, 0, 0)[2];
  const at = (t: number): Vec3 => {
    const k = Math.abs(t);
    const y = yN - o.drop * (1 - k ** 2.1);
    const P = torsoPoint(a, y, t * spread, 0);
    const c = o.r * 0.4 + (o.r + clear - o.r * 0.4) * smooth01((1 - k) / 0.45);
    // free hang: straight down from the neck front, never into the chest
    const zFree = zN + 0.01 * a.s + (o.r + 0.012 * a.s) * (1 - k);
    return [P[0] * (1 + 0.1 * (1 - k)), P[1], Math.max(P[2] + c, k < 0.85 ? zFree : -Infinity)];
  };
  const M = 14;
  const pts: Vec3[] = [];
  for (let i = 0; i <= M; i++) pts.push(at((i / M) * 2 - 1));
  const bone = o.bone ?? 'chest';
  e.ctx.add(`${e.spec.id}_${o.name ?? 'cord'}`, tube(pts, [[0, o.r], [1, o.r]], { segments: M * 2, w: o.r * 0.5 }), bone, { tags: e.tag(e.mat), w: 0.004, grip: 1.3 });
  const nb = o.beads ?? 0;
  const br = o.bead ?? 0;
  for (let i = 0; i < nb && br > 0; i++) {
    const t = nb === 1 ? 0 : ((i + 0.5) / nb) * 1.7 - 0.85;
    e.ctx.add(`${e.spec.id}_${o.name ?? 'cord'}Bead${i}`, new Sphere(at(t), br), bone, { tags: e.tag(e.mat, 'bead'), w: 0.003, grip: 1.3 });
  }
}

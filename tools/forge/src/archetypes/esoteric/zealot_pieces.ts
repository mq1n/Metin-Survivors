// Zealot (hunched zealot) garments and anatomy: a long robe skirt cut into a few big clean points over a darker pointed under-robe, bell
// sleeves ending in three big points (bare gaunt forearms below), a pointed mantle over the hunched shoulders, a big-bead bandolier,
// wrist bandages, a rope belt and long curved claws. PieceSpec.build functions (`{ id, mat, build: zigSkirt, o: {...} }`) plus a body hook.
// Every cloth edge is a saw-tooth cut of a solid shell: few, large, clean points that keep their shape through crowd decimation (thin
// hanging strips melt into shards at the 8 mm voxel and read as noise at game distance).
import { type Vec3, vadd, vcross, vdot, vnorm, vscale, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { FnSdf, type Sdf } from '../../core/sdf/node.ts';
import { SmoothIntersect } from '../../core/sdf/ops.ts';
import { Ellipsoid, Sphere, Torus } from '../../core/sdf/primitives.ts';
import { flatCone, tube } from '../../core/sdf/shapes.ts';
import { Loft, type Ctx, type PieceEnv, cover, limbEnv, limbTube, slabAxis, slabY } from '../humanoid/index.ts';
import { ridge } from '../humanoid/outfit/util.ts';
import { sectorWedge } from '../humanoid/outfit/soft.ts';
import { horn } from '../orc/kit.ts';

const BOTH = [1, -1] as const;
const L = (sx: 1 | -1): 'l' | 'r' => (sx === 1 ? 'l' : 'r');
const sstep = (x: number): number => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

interface SawOpts {
  /** centre of the hem ring at notch depth */
  o: Vec3;
  /** direction the teeth point (skirt: down) */
  dir: Vec3;
  /** reference direction across the axis where phi = 0 */
  ref: Vec3;
  count: number;
  /** tooth-unit offset of the first tooth tip from `ref` */
  phase: number;
  /** notch-to-tip length */
  depth: number;
  /** hem radius (sets the field's Lipschitz scale) */
  R: number;
  /** per-tooth length noise 0..1 */
  jag: number;
  /** per-tooth sideways skew of the tip (fraction of a tooth) */
  skew: number;
  rng: Rng;
  /** optional per-tooth length multipliers (index 0 = the tooth at phase) */
  lens?: number[];
}

/**
 * Saw-tooth hem cutter: keeps the side behind the hem line, whose teeth are straight-edged V points around the `dir` axis. Intersect it
 * with a solid shell to get a clean pointed edge.
 */
function sawCut(o: SawOpts): Sdf {
  const d = vnorm(o.dir);
  const rf = vnorm(vsub(o.ref, vscale(d, vdot(o.ref, d))));
  const sd = vcross(d, rf);
  const n = o.count;
  const len: number[] = [], sk: number[] = [];
  for (let i = 0; i < n; i++) {
    len.push(o.depth * (o.lens?.[i] ?? 1) * (1 - o.jag * o.rng.next()));
    sk.push((o.rng.next() * 2 - 1) * o.skew);
  }
  const slope = Math.max(...len) / ((Math.PI * o.R) / n);
  const k = 1 / Math.sqrt(1 + slope * slope);
  return new FnSdf((x, y, z) => {
    const q: Vec3 = [x - o.o[0], y - o.o[1], z - o.o[2]];
    const t = vdot(q, d);
    const phi = Math.atan2(vdot(q, sd), vdot(q, rf));
    const u = (phi / (Math.PI * 2)) * n - o.phase;
    const r = Math.round(u);
    const i = ((r % n) + n) % n;
    const f = u - r;
    const s = sk[i]!;
    const tri = f < s ? (s - f) / (s + 0.5) : (f - s) / (0.5 - s);
    return (t - len[i]! * (1 - tri)) * k;
  }, { min: [o.o[0] - 2, o.o[1] - 2, o.o[2] - 2], max: [o.o[0] + 2, o.o[1] + 2, o.o[2] + 2] }, 1);
}

/**
 * Long robe skirt with a saw-tooth hem: a solid flared shell from the waist whose hem is cut into `count` big points (notches at `notch`,
 * tips `depth` lower), split into the four swinging skirt sectors. Stack two (an outer robe and a longer, darker under-robe with the
 * teeth offset by half a tooth) for light/dark banding. o: notch, depth, count, phase, flare, grow (radial offset), jag, skew
 */
export function zigSkirt(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const rng = new Rng(`${a.p.seed}/zig${e.i}`);
  const flare = e.n('flare', 0.8);
  const grow = e.n('grow', 0) * s;
  const notch = e.n('notch', 0.56) * s;
  const depth = e.n('depth', 0.22) * s;
  const bottom = notch - depth - 0.03 * s;
  const waist = a.spine[1] + 0.02 * s;
  const hipY = a.side(1).hip[1];
  const T = new Loft(a.torso);
  const wst = T.at(waist);
  const hp = T.at(a.pelvis[1] - 0.02 * s);
  const ext = 0.012 * s + grow;
  const span = hipY - bottom;
  const shell = new Loft([
    { y: bottom, rx: 0.26 * s * flare + 0.02 * s + grow, rz: 0.22 * s * flare + 0.02 * s + grow, cz: -0.005 * s, n: 2.15 },
    { y: bottom + span * 0.33, rx: 0.22 * s * flare + 0.012 * s + grow, rz: 0.19 * s * flare + 0.012 * s + grow, cz: -0.004 * s, n: 2.1 },
    { y: bottom + span * 0.7, rx: 0.195 * s * Math.max(flare, 0.9) + 0.01 * s + grow, rz: 0.15 * s * Math.max(flare, 0.9) + 0.01 * s + grow, cz: -0.002 * s, n: 2.2 },
    { y: a.pelvis[1] - 0.02 * s, rx: hp.rx + ext, rz: hp.rz + ext, cz: hp.cz, n: 2.3 },
    { y: waist, rx: wst.rx + ext, rz: wst.rz + ext, cz: wst.cz, n: 2.4 },
  ]);
  const cut = sawCut({
    o: [0, notch, -0.004 * s], dir: [0, -1, 0], ref: [0, 0, 1], count: Math.round(e.n('count', 6)), phase: e.n('phase', 0), depth,
    R: 0.24 * s * flare, jag: e.n('jag', 0.25), skew: e.n('skew', 0.12), rng,
  });
  const skirt = new SmoothIntersect([shell, cut], 0.004);
  if (a.p.rig?.skirt) {
    const sectors: [string, number][] = [['skirt_f', 0], ['skirt_b', Math.PI], ['skirt_l', Math.PI / 2], ['skirt_r', -Math.PI / 2]];
    for (const [bone, ang] of sectors) {
      const part = new SmoothIntersect([skirt, sectorWedge(ang, (Math.PI / 4) * 1.35), slabY(bottom - 0.01, hipY - 0.02 * s)], 0.003);
      e.ctx.add(`${e.spec.id}_${bone}`, part, bone, { tags: e.tag(e.mat, 'skirt'), w: 0.008 });
    }
    e.ctx.add(`${e.spec.id}_hip`, new SmoothIntersect([skirt, slabY(hipY - 0.03 * s, waist)], 0.002), 'pelvis', { tags: e.tag(e.mat), w: 0.006 });
  } else {
    e.ctx.add(`${e.spec.id}_skirt`, skirt, 'pelvis', { tags: e.tag(e.mat, 'skirt'), w: 0.008 });
  }
}

/**
 * Bell sleeves: a loose sleeve from the shoulder that flares past the elbow into a wide bell whose rim is cut into three big points (the
 * longest hangs on the outside); the gaunt bare forearm comes out of it. o: loose (sleeve fullness), flare (bell radius), end (notch u
 * along the arm), depth (tooth length, metres x s)
 */
export function bellSleeves(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const loose = e.n('loose', 1);
  const flare = e.n('flare', 1);
  const uN = e.n('end', 0.62);
  const depth = e.n('depth', 0.12) * s;
  for (const sx of BOTH) {
    const rng = new Rng(`${a.p.seed}/bell${e.i}${sx}`);
    const env = limbEnv(a, sx, 'arm');
    const uT = Math.min(uN + (depth / env.len) * 1.15, 0.97);
    const ext = (u: number): number => s * (0.008 + 0.008 * loose * sstep((u - 0.1) / 0.3)) + flare * 0.062 * s * sstep((u - 0.42) / (uT - 0.42)) ** 1.3;
    const um = env.uMid;
    const R = env.r(uN) + ext(uN);
    const cut = sawCut({
      o: env.at(uN), dir: env.dir(uN), ref: [sx, -0.2, -0.35], count: 3, phase: 0, depth, R, jag: 0.15, skew: 0.1, rng, lens: [1.25, 0.8, 0.9],
    });
    const ranges: [number, number][] = [[0.02, um + 0.06], [um - 0.04, uT]];
    ranges.forEach(([u0, u1], k) => {
      const tube = limbTube(env, u0, u1, ext, { w: 0.012 });
      e.ctx.add(`${e.spec.id}_sleeve${k}_${L(sx)}`, k === 1 ? new SmoothIntersect([tube, cut], 0.003) : tube, env.bone((u0 + u1) / 2, L(sx)), { tags: e.tag(e.mat), w: 0.008 });
    });
    cover(e, ['delt_'], 0.012 * s, { filter: (p) => p.name.endsWith(L(sx)), clip: slabAxis(env, 0, 0.1, 0.003), w: 0.006 });
  }
}

/**
 * Pointed mantle over the hunched shoulders: the upper torso and shoulder caps covered by a thick shell whose lower edge is cut into big
 * points (one over each shoulder, two on the chest framing the bead loop, two on the back), with a cloth bundle under it on the upper
 * spine that exaggerates the hunch. o: ext (thickness), notch (below the neck base, x s), depth, count, phase, hump (bundle size)
 */
export function pointMantle(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const rng = new Rng(`${a.p.seed}/mantle${e.i}`);
  const ext = e.n('ext', 0.026) * s;
  const yTop = a.torso[a.torso.length - 1]!.y + 0.01 * s;
  const notch = a.neck[1] - e.n('notch', 0.1) * s;
  const depth = e.n('depth', 0.16) * s;
  const st = new Loft(a.torso).at(notch);
  const cut = sawCut({
    o: [0, notch, st.cz], dir: [0, -1, 0], ref: [0, 0, 1], count: Math.round(e.n('count', 6)), phase: e.n('phase', 0.5), depth,
    R: Math.max(st.rx, st.rz) + ext, jag: e.n('jag', 0.2), skew: e.n('skew', 0.1), rng,
  });
  const clip = new SmoothIntersect([slabY(notch - depth - 0.02 * s, yTop), cut], 0.003);
  cover(e, ['torso_', 'pec_', 'lat_', 'trap_', 'clavicle_', 'delt_'], ext, { clip, w: 0.008 });
  const k = e.n('hump', 1);
  if (k > 0) {
    const c: Vec3 = [0, a.neck[1] - 0.05 * s, a.neck[2] - 0.085 * s];
    e.ctx.add(`${e.spec.id}_hump`, new SmoothIntersect([new Ellipsoid(c, [0.15 * s * k, 0.1 * s * k, 0.12 * s * k]), clip], 0.004), 'chest', { tags: e.tag(e.mat), w: 0.035 });
  }
}

/**
 * Bead bandolier: a heavy string of big beads slung from the left shoulder across the chest and the hunched back to the right hip, so the
 * beads read from the top-down game camera. The loop lies in a tilted plane through the torso; each sample is marched in from outside
 * until it rests `clear` above every torso / garment part already built (arms excluded), then the radius is smoothed. List it after the
 * garments it rests on. o: tilt (deg from horizontal), y (loop centre below the neck base, x s), bead (radius x s), beads, cord (x s), clear
 * (x s), cordMat (palette key of the cord, default leather)
 */
export function beadSash(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const tilt = (e.n('tilt', 50) * Math.PI) / 180;
  const cy = a.neck[1] - e.n('y', 0.3) * s;
  const st = new Loft(a.torso).at(cy);
  const C: Vec3 = [st.cx, cy, st.cz];
  const cord = e.n('cord', 0.018) * s;
  const clear = cord + e.n('clear', 0.008) * s;
  const solid = e.ctx.body.parts.filter((p) => p.stage !== 'mark' && !/^(upperarm|forearm|wrist|hand|clavicle|finger|thumb)/.test(p.bone));
  const field = (p: Vec3): number => {
    let d = Infinity;
    for (const pt of solid) {
      const b = pt.sdf.bounds();
      if (p[0] < b.min[0] - clear || p[1] < b.min[1] - clear || p[2] < b.min[2] - clear || p[0] > b.max[0] + clear || p[1] > b.max[1] + clear || p[2] > b.max[2] + clear) continue;
      d = Math.min(d, pt.sdf.d(p[0], p[1], p[2]));
    }
    return d;
  };
  // in-plane axes: w = front, u = up toward the left shoulder
  const u: Vec3 = [Math.cos(tilt), Math.sin(tilt), 0];
  const w: Vec3 = [0, 0, 1];
  const N = 28;
  const dirs: Vec3[] = [];
  const rho: number[] = [];
  for (let i = 0; i < N; i++) {
    const phi = (i / N) * Math.PI * 2;
    const dir = vnorm(vadd(vscale(w, Math.cos(phi)), vscale(u, Math.sin(phi))));
    let t = 0.7 * s;
    while (t > 0.02 && field(vadd(C, vscale(dir, t))) > clear) t -= 0.004;
    dirs.push(dir);
    rho.push(t + 0.004);
  }
  const raw = rho.slice();
  for (let i = 0; i < N; i++) rho[i] = Math.max(raw[i]!, (raw[(i + N - 1) % N]! + 2 * raw[i]! + raw[(i + 1) % N]!) / 4);
  const pts = dirs.map((d, i) => vadd(C, vscale(d, rho[i]!)));
  // upper half (shoulder side) rides the chest, lower half the spine
  const upper: Vec3[] = [], lower: Vec3[] = [];
  for (let i = 0; i <= N; i++) {
    const p = pts[i % N]!;
    (i <= N / 2 ? upper : lower).push(p);
    if (i === N / 2) lower.push(p);
  }
  // a dark cord (cordMat) so the big bone beads read as separate beads
  const cordTags = e.tag(e.s('cordMat', 'leather'));
  e.ctx.add(`${e.spec.id}_cordU`, tube(upper, [[0, cord], [1, cord]], { segments: upper.length * 2, w: cord * 0.5 }), 'chest', { tags: cordTags, w: 0.004, grip: 1.3 });
  e.ctx.add(`${e.spec.id}_cordL`, tube(lower, [[0, cord], [1, cord]], { segments: lower.length * 2, w: cord * 0.5 }), 'spine', { tags: cordTags, w: 0.004, grip: 1.3 });
  const nb = Math.round(e.n('beads', 9));
  const br = e.n('bead', 0.042) * s;
  for (let k = 0; k < nb; k++) {
    const f = ((k + 0.5) / nb) * N;
    const i0 = Math.floor(f) % N, i1 = (i0 + 1) % N;
    const q = f - Math.floor(f);
    const d = vnorm(vadd(vscale(dirs[i0]!, 1 - q), vscale(dirs[i1]!, q)));
    const r = rho[i0]! * (1 - q) + rho[i1]! * q;
    const c = vadd(C, vscale(d, r + (br - cord) * 0.6));
    e.ctx.add(`${e.spec.id}_bead${k}`, new Sphere(c, br), f < N / 2 ? 'chest' : 'spine', { tags: e.tag(e.mat, 'bead'), w: 0.003, grip: 1.3 });
  }
}

/** forearm bandages from below the sleeve to the knuckles: a smooth wrap with a few raised turns. o: from */
export function wristWraps(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const u0 = e.n('from', 0.62);
  for (const sx of BOTH) {
    const env = limbEnv(a, sx, 'arm');
    cover(e, ['forearm_', 'flexor_'], 0.012 * s, { filter: (p) => p.name.endsWith(L(sx)), clip: slabAxis(env, u0, 0.985, 0.004), w: 0.005, grip: 1.2 });
    for (const [u, k] of [[u0 + 0.02, 1.2], [(u0 + 0.955) / 2, 1], [0.955, 1.2]] as [number, number][]) {
      ridge(e, ['forearm_', 'flexor_'], env, L(sx), u, 0.0075 * s * k, 0.019 * s, `_turn${u.toFixed(2)}`);
    }
  }
}

/** a thick rope belt: two twisted turns with a knotted end hanging down the front. o: y, r (rope radius x s) */
export function ropeBelt(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const y = a.spine[1] + e.n('y', -0.07) * s;
  const rr = e.n('r', 0.0125) * s;
  const grow = e.n('grow', 0.022) * s;
  const st = new Loft(a.torso).at(y);
  for (let k = 0; k < 2; k++) {
    const yy = y + (k - 0.5) * 2.1 * rr;
    const q = new Loft(a.torso).at(yy);
    e.ctx.add(`${e.spec.id}_turn${k}`, new Torus([q.cx, yy, q.cz], Math.sqrt(q.rx * q.rz) + grow, rr, [0, 1, 0]), 'spine', { tags: e.tag(e.mat), w: 0.006, grip: 1.2 });
  }
  const bone = a.p.rig?.skirt ? 'skirt_f' : 'pelvis';
  const top: Vec3 = [-0.05 * s, y - 0.01 * s, st.cz + st.rz + grow + 0.012 * s];
  const tip: Vec3 = [-0.06 * s, y - 0.3 * s, st.cz + st.rz + grow + 0.05 * s];
  e.ctx.add(`${e.spec.id}_tailA`, flatCone(top, tip, rr * 1.3, rr * 0.9, 0.75, [1, 0, 0]), bone, { tags: e.tag(e.mat), w: 0.005 });
  e.ctx.add(`${e.spec.id}_knot`, new Sphere(tip, rr * 2), bone, { tags: e.tag(e.mat), w: 0.005 });
}

export interface ClawOpts {
  /** claw length multiplier */
  len?: number;
  /** curl toward the palm (0..1) */
  curl?: number;
  /** claws per hand (default 4) */
  count?: number;
  /** base thickness multiplier */
  thick?: number;
}

/**
 * Long curved finger claws for both hands (late parts: not displaced, crisp). Rigid on the wrist bone (the crowd rig has no finger bones):
 * the claws continue the fingers and curl toward the palm; one thumb claw hooks the other way.
 */
export function clawHands(o: ClawOpts = {}): (ctx: Ctx) => void {
  return (ctx) => {
    const a = ctx.a;
    const s = a.s;
    const len = (o.len ?? 1) * 0.17 * s;
    const curl = o.curl ?? 0.6;
    const n = o.count ?? 4;
    const th = o.thick ?? 1;
    for (const sx of BOTH) {
      const j = a.side(sx);
      const dir = vnorm(vsub(j.fingerTip, j.wrist));
      const M: Vec3 = vnorm(vsub([-sx, 0, 0], vscale(dir, -sx * dir[0])));
      const F: Vec3 = vnorm(vsub([0, 0, 1], vadd(vscale(dir, dir[2]), vscale(M, M[2]))));
      const hw = a.r.palmW;
      for (let i = 0; i < n; i++) {
        const lat = (i - (n - 1) / 2) * hw * (1.7 / n) * 1.2;
        const lenK = 1 - 0.12 * Math.abs(i - (n - 1) / 2) + (i === 1 ? 0.12 : 0);
        const base: Vec3 = vadd(vadd(j.fingerTip, vscale(dir, -0.02 * s)), vscale(F, lat));
        const L0 = len * lenK;
        const mid: Vec3 = vadd(vadd(base, vscale(dir, L0 * 0.6)), vscale(M, L0 * 0.12 * curl));
        const tip: Vec3 = vadd(vadd(vadd(base, vscale(dir, L0 * 0.84)), vscale(M, L0 * 0.55 * curl)), vscale(F, lat * 0.25));
        ctx.late(`claw${i}_${L(sx)}`, horn(base, mid, tip, 0.0145 * s * th, 0.0042 * s * th, 0.005), `wrist_${L(sx)}`, { tags: ['claw'], w: 0.002 });
      }
      // thumb claw
      const tb: Vec3 = vadd(vadd(j.thumb, vscale(dir, 0.03 * s)), vscale(F, hw * 0.4));
      const tm: Vec3 = vadd(vadd(tb, vscale(dir, len * 0.3)), vscale(F, len * 0.28));
      const tt: Vec3 = vadd(vadd(tb, vscale(dir, len * 0.45)), vscale(F, len * 0.5));
      ctx.late(`clawT_${L(sx)}`, horn(tb, tm, tt, 0.013 * s * th, 0.004 * s * th, 0.005), `wrist_${L(sx)}`, { tags: ['claw'], w: 0.002 });
    }
  };
}

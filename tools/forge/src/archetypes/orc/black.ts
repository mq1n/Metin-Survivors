// Black orc kit: bevelled slab pauldrons (+ bone spikes, leather straps), chain belt / bandolier, tusked head with a bone crest.
// Everything is model-specific (black_orc only); the shared orc kit (kit.ts, pieces.ts, props.ts) is imported, never edited here.
import { type Aabb, type Vec3, vadd, vnorm, vscale } from '../../core/math.ts';
import { Sdf } from '../../core/sdf/node.ts';
import { Ellipsoid, RoundedBox, Torus } from '../../core/sdf/primitives.ts';
import { flatCone, tube } from '../../core/sdf/shapes.ts';
import { type Anatomy, type Ctx, Loft, type PieceEnv, type Key, type Pose, V, basePose, limbBand, limbEnv } from '../humanoid/index.ts';
import { type OrcStyle, gp, grip } from './anim.ts';
import { type OrcHeadOpts, orcHead } from './head.ts';
import { type Frame, type WFrame, rc, spike } from './kit.ts';
import { torsoPoint } from './pieces.ts';
import { chopAxes, stance, sweepAxes } from './styles.ts';

const BOTH = [1, -1] as const;
const L = (sx: 1 | -1): 'l' | 'r' => (sx === 1 ? 'l' : 'r');
const sstep = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// ---------------------------------------------------------------------------------------------------------------------
/**
 * BevelPlate: a polygon outline (local y,z plane of `f`) extruded along the local x axis with a chamfered edge: the half thickness
 * rises from `hEdge` at the outline to `hMid` over `bevel` metres, plus an optional `crown` bulge over `crownR` metres. Crisp
 * forged-slab silhouettes (pauldrons, flanges) that a rounded box cannot give.
 */
export class BevelPlate extends Sdf {
  private n: number;
  private px: Float64Array;
  private py: Float64Array;
  private hmax: number;
  constructor(
    private f: Frame,
    outline: [number, number][],
    private hEdge: number,
    private hMid: number,
    private bevel: number,
    private round = 0.004,
    private crown = 0,
    private crownR = 0.15,
  ) {
    super();
    this.n = outline.length;
    this.px = Float64Array.from(outline.map((p) => p[0]));
    this.py = Float64Array.from(outline.map((p) => p[1]));
    this.hmax = hMid + crown;
    this.lip = Math.min(3, 1.25 + (1.5 * (hMid - hEdge)) / bevel + (crown > 0 ? (1.5 * crown) / crownR : 0));
  }

  private d2(y: number, z: number): number {
    const n = this.n, px = this.px, py = this.py;
    let dmin = Infinity;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = px[j]!, ay = py[j]!, bx = px[i]!, by = py[i]!;
      const ex = bx - ax, ey = by - ay;
      const wx = y - ax, wy = z - ay;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
      const dx = wx - ex * t, dy = wy - ey * t;
      const dd = dx * dx + dy * dy;
      if (dd < dmin) dmin = dd;
      if (ay > z !== by > z && y < ((bx - ax) * (z - ay)) / (by - ay) + ax) inside = !inside;
    }
    const d = Math.sqrt(dmin);
    return inside ? -d : d;
  }

  d(x: number, y: number, z: number): number {
    const o = this.f.o;
    const dx = x - o[0], dy = y - o[1], dz = z - o[2];
    const lx = dx * this.f.x[0] + dy * this.f.x[1] + dz * this.f.x[2];
    const ly = dx * this.f.y[0] + dy * this.f.y[1] + dz * this.f.y[2];
    const lz = dx * this.f.z[0] + dy * this.f.z[1] + dz * this.f.z[2];
    const sd = this.d2(ly, lz);
    let h = this.hEdge;
    if (sd < 0) {
      h += (this.hMid - this.hEdge) * sstep(-sd / this.bevel);
      if (this.crown > 0) h += this.crown * sstep(-sd / this.crownR);
    }
    const r = this.round;
    const d2 = sd + r;
    const hh = Math.max(h - r, 1e-4);
    const dxn = Math.abs(lx) - hh;
    const ox = d2 > 0 ? d2 : 0, oy = dxn > 0 ? dxn : 0;
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(d2, dxn), 0) - r;
  }

  protected computeBounds(): Aabb {
    let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      y0 = Math.min(y0, this.px[i]!); y1 = Math.max(y1, this.px[i]!);
      z0 = Math.min(z0, this.py[i]!); z1 = Math.max(z1, this.py[i]!);
    }
    const pad = this.round + 0.004;
    const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      const lx = c & 1 ? this.hmax + pad : -this.hmax - pad;
      const ly = c & 2 ? y1 + pad : y0 - pad;
      const lz = c & 4 ? z1 + pad : z0 - pad;
      for (let k = 0; k < 3; k++) {
        const w = this.f.o[k]! + this.f.x[k]! * lx + this.f.y[k]! * ly + this.f.z[k]! * lz;
        mn[k] = Math.min(mn[k]!, w); mx[k] = Math.max(mx[k]!, w);
      }
    }
    return { min: mn, max: mx };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// slab pauldrons: main slab tilted outward-down over the deltoid + a hinged drop slab on the arm; spikes (bone) and straps (leather)
// are separate pieces (one material per piece) sharing the same frame.
interface PF {
  sx: 1 | -1;
  k: number;
  sh: Vec3;
  c: Vec3;
  nrm: Vec3;
  along: Vec3;
  fwd: Vec3;
}

function pframe(e: PieceEnv, sx: 1 | -1): PF {
  const a = e.a;
  const k = a.s * e.n('size', 1);
  const tilt = e.n('tilt', 0.62);
  const sh = a.side(sx).shoulder;
  const nrm: Vec3 = [sx * Math.sin(tilt), Math.cos(tilt), 0];
  const along: Vec3 = [sx * Math.cos(tilt), -Math.sin(tilt), 0];
  const c: Vec3 = [sh[0] + sx * e.n('out', 0.08) * k, sh[1] + e.n('lift', 0.1) * k, sh[2] + e.n('fwd', -0.005) * k];
  return { sx, k, sh, c, nrm, along, fwd: [0, 0, 1] };
}

/** point on / above the main slab: `u` along the slope (outward-down), `v` front (+) / back (-), `h` along the normal */
const onSlab = (f: PF, u: number, v: number, h = 0): Vec3 => [
  f.c[0] + (f.along[0] * u + f.nrm[0] * h) * f.k,
  f.c[1] + (f.along[1] * u + f.nrm[1] * h) * f.k,
  f.c[2] + v * f.k,
];

const SLAB_OUTLINE: [number, number][] = [[-0.16, -0.14], [-0.13, -0.18], [0.14, -0.18], [0.2, -0.12], [0.2, 0.1], [0.16, 0.18], [-0.13, 0.18], [-0.16, 0.14]];
const CAP_OUTLINE: [number, number][] = [[-0.08, -0.1], [0.06, -0.13], [0.17, 0], [0.06, 0.13], [-0.08, 0.1]];

/** slab pauldrons: stepped bevelled iron slabs over the shoulders (base slab + raised cap slab + hinged drop flap), rivets. o: size, tilt, lift, out, fwd */
export function slabPauldron(e: PieceEnv): void {
  for (const sx of BOTH) {
    const n = L(sx);
    const f = pframe(e, sx);
    const k = f.k;
    const sc = (o: [number, number][]): [number, number][] => o.map(([u, v]) => [u * k, v * k]);
    const fr: Frame = { o: f.c, x: f.nrm, y: f.along, z: f.fwd };
    e.ctx.add(`${e.spec.id}_slab_${n}`, new BevelPlate(fr, sc(SLAB_OUTLINE), 0.024 * k, 0.04 * k, 0.05 * k, 0.006 * k, 0.012 * k, 0.12 * k), `clavicle_${n}`, { tags: e.tag(e.mat), w: 0.006, grip: 1.8 });
    // raised cap slab (second tier)
    const c2 = onSlab(f, 0.03, 0, 0.05);
    e.ctx.add(`${e.spec.id}_cap_${n}`, new BevelPlate({ o: c2, x: f.nrm, y: f.along, z: f.fwd }, sc(CAP_OUTLINE), 0.016 * k, 0.034 * k, 0.04 * k, 0.005 * k, 0.014 * k, 0.1 * k), `clavicle_${n}`, { tags: e.tag(e.mat), w: 0.006, grip: 1.8 });
    // iron collar round the upper arm under the slab (ties the plate to the limb)
    const env = limbEnv(e.a, sx, 'arm');
    e.ctx.add(`${e.spec.id}_collar_${n}`, limbBand(env, 0.2, 0.3, 0.03 * e.a.s, { edge: 0.004, round: 0.006 }), `upper_arm_${n}`, { tags: e.tag(e.mat), w: 0.005, grip: 1.6 });
    // rivets on the slab corners
    for (const [u, v] of [[-0.1, -0.12], [-0.1, 0.12], [0.15, -0.12], [0.15, 0.12]] as [number, number][]) {
      e.ctx.add(`${e.spec.id}_rv_${n}_${u}_${v}`, new Ellipsoid(onSlab(f, u, v, 0.06), [0.024 * k, 0.024 * k, 0.024 * k]), `clavicle_${n}`, { tags: e.tag(e.mat), w: 0.004, grip: 1.8 });
    }
  }
}

/** bone spikes bolted to the slabs (separate material); same frame options as slabPauldron. o: size, tilt, lift, out, fwd, spike (length multiplier) */
export function slabSpikes(e: PieceEnv): void {
  const sp = e.n('spike', 1);
  for (const sx of BOTH) {
    const n = L(sx);
    const f = pframe(e, sx);
    const k = f.k;
    const defs: { u: number; v: number; dir: Vec3; len: number; r: number }[] = [
      { u: 0.04, v: 0, dir: vnorm([f.nrm[0] + f.along[0] * 0.12, f.nrm[1] + f.along[1] * 0.12, 0]), len: 0.24, r: 0.05 },
      { u: 0.07, v: 0.11, dir: vnorm([f.nrm[0] + f.along[0] * 0.3, f.nrm[1] + f.along[1] * 0.3, 0.32]), len: 0.16, r: 0.036 },
      { u: 0.07, v: -0.11, dir: vnorm([f.nrm[0] + f.along[0] * 0.3, f.nrm[1] + f.along[1] * 0.3, -0.32]), len: 0.16, r: 0.036 },
    ];
    defs.forEach((d, i) => {
      const base = onSlab(f, d.u, d.v, 0.085);
      const tip = vadd(base, vscale(d.dir, d.len * k * sp));
      e.ctx.add(`${e.spec.id}_spk${i}_${n}`, spike(base, tip, d.r * k, 0.006 * k), `clavicle_${n}`, { tags: e.tag(e.mat, 'horn'), w: 0.008, grip: 1.8 });
    });
  }
}

/** leather straps: a buckled band round each upper arm under the drop slab + a strap hanging from the slab edge. o: size, tilt, lift, out, fwd */
export function pauldronStraps(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  for (const sx of BOTH) {
    const n = L(sx);
    const env = limbEnv(a, sx, 'arm');
    e.ctx.add(`${e.spec.id}_band_${n}`, limbBand(env, 0.4, 0.5, 0.026 * s, { edge: 0.004, round: 0.006 }), `upper_arm_${n}`, { tags: e.tag(e.mat), w: 0.004, grip: 1.6 });
    const ub = env.at(0.45);
    const r = env.r(0.45) + 0.03 * s;
    e.ctx.add(`${e.spec.id}_buckle_${n}`, new RoundedBox([ub[0] + sx * r * 0.2, ub[1], ub[2] + r * 0.96], [0.04 * s, 0.045 * s, 0.014 * s], 0.008 * s), `upper_arm_${n}`, { tags: e.tag(e.mat), w: 0.003, grip: 1.6 });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
/**
 * A bead chain: a smooth tube whose radius pulses along the path, one bulge per link. At crowd triangle budgets individual link holes
 * shred into slivers; fat smooth bulges survive the decimator and read as links (the Painter draws the rings).
 */
function beadChain(e: PieceEnv, pts: Vec3[], r0: number, amp: number, links: number, bone: string, name: string): void {
  const sdf = tube(pts, (t) => r0 * (1 + amp * Math.cos(Math.PI * 2 * links * t)), { segments: Math.max(8, links * 4), w: r0 * 0.35 });
  e.ctx.add(`${e.spec.id}_${name}`, sdf, bone, { tags: e.tag(e.mat), w: 0.004, grip: 1.3 });
}

/** iron chain wrapped round the waist (+ chest bandolier and two hanging lengths) with a heavy buckle. o: r (tube radius), amp, count, bcount, bandolier, hang */
export function chainBelt(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const T = new Loft(a.torso);
  const yw = a.spine[1] - 0.02 * s;
  const st = T.at(yw);
  const r0 = e.n('r', 0.034) * s;
  const amp = e.n('amp', 0.28);
  const ring: Vec3[] = [];
  const NP = 20;
  for (let i = 0; i <= NP; i++) {
    const ph = (i / NP) * Math.PI * 2;
    const sp = Math.sin(ph), cp = Math.cos(ph);
    const rx = st.rx + 0.04 * s, rz = st.rz + 0.04 * s;
    const r = (rx * rz) / Math.hypot(rz * sp, rx * cp);
    ring.push([sp * r, yw, st.cz + cp * r]);
  }
  beadChain(e, ring, r0, amp, e.n('count', 14), 'spine', 'waist');
  if (e.b('bandolier', true)) {
    const yTop = a.torso[a.torso.length - 3]!.y + 0.01 * s;
    const yBot = yw - 0.03 * s;
    const pts: Vec3[] = [];
    const M = 9;
    for (let k = 0; k <= M; k++) {
      const t = k / M;
      pts.push(torsoPoint(a, yTop + (yBot - yTop) * t, 0.8 - 1.6 * t, 0.038 * s));
    }
    beadChain(e, pts, r0 * 0.85, amp, e.n('bcount', 8), 'chest', 'band');
  }
  const hang = e.n('hang', 2);
  for (let h = 0; h < hang; h++) {
    const sx = h === 0 ? 1 : -1;
    const x0 = sx * 0.2 * s;
    const z0 = torsoPoint(a, yw, x0 / st.rx, 0.07 * s)[2];
    const pts: Vec3[] = [];
    for (let k = 0; k <= 4; k++) pts.push([x0 + sx * 0.01 * s * k, yw - 0.03 * s - k * 0.07 * s, z0 + 0.01 * s * k]);
    beadChain(e, pts, r0 * 0.75, amp, 4, 'pelvis', `hang${h}`);
  }
  // belt buckle: a heavy iron plate + boss on the front of the belt chain
  const bk = torsoPoint(a, yw, 0, 0.06 * s);
  e.ctx.add(`${e.spec.id}_buckle`, new RoundedBox(bk, [0.066 * s, 0.054 * s, 0.022 * s], 0.014 * s), 'spine', { tags: e.tag(e.mat), w: 0.004, grip: 1.3 });
  e.ctx.add(`${e.spec.id}_boss`, new Ellipsoid([bk[0], bk[1], bk[2] + 0.018 * s], [0.03 * s, 0.03 * s, 0.024 * s]), 'spine', { tags: e.tag(e.mat), w: 0.003, grip: 1.3 });
}

// ---------------------------------------------------------------------------------------------------------------------
/** crimson loin cloth: three broad flaps hanging over the front of the kilt + three over the back, swinging with the skirt bones. o: len, ext, top */
export function loinCloth(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const y0 = a.pelvis[1] + e.n('top', 0.06) * s;
  const ext = e.n('ext', 0.075) * s;
  const k = e.n('len', 1);
  const st = new Loft(a.torso).at(y0);
  const skf = a.p.rig?.skirt ? 'skirt_f' : 'pelvis';
  const skb = a.p.rig?.skirt ? 'skirt_b' : 'pelvis';
  [-1, 0, 1].forEach((i) => {
    const x = i * 0.12 * s;
    const b = torsoPoint(a, y0, x / st.rx, ext);
    const tip: Vec3 = [x * 1.03, y0 - (i === 0 ? 0.46 : 0.36) * s * k, b[2] + 0.04 * s];
    e.ctx.add(`${e.spec.id}_f${i + 1}`, flatCone(b, tip, 0.062 * s, 0.045 * s, 0.3, [0, 0, 1]), skf, { tags: e.tag(e.mat), w: 0.006 });
  });
  [-1, 0, 1].forEach((i) => {
    const x = i * 0.11 * s;
    const b = torsoPoint(a, y0, x / st.rx, ext * 0.7, true);
    const tip: Vec3 = [x * 1.03, y0 - (i === 0 ? 0.44 : 0.36) * s * k, b[2] - 0.04 * s];
    e.ctx.add(`${e.spec.id}_b${i + 1}`, flatCone(b, tip, 0.058 * s, 0.045 * s, 0.3, [0, 0, 1]), skb, { tags: e.tag(e.mat), w: 0.006 });
  });
}

/** orc head + a bone crest of back-swept spikes along the skull midline. `crest` = spike length multiplier (0 = none) */
export function blackHead(opts: OrcHeadOpts & { crest?: number }): (ctx: Ctx) => void {
  const base = orcHead(opts);
  const crest = opts.crest ?? 1;
  return (ctx) => {
    base(ctx);
    if (crest <= 0) return;
    const a: Anatomy = ctx.a;
    const k = a.s * a.hs * (opts.scale ?? 1);
    const sk = a.skull;
    const H = (dx: number, dy: number, dz: number): Vec3 => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
    const cr = opts.cranium ?? 1;
    const zs = [0.035, -0.005, -0.045, -0.082, -0.112];
    zs.forEach((z, i) => {
      const t = (z + 0.03) / (0.098 * cr);
      const y = 0.026 + 0.088 * cr * Math.sqrt(Math.max(0, 1 - t * t));
      const nrm = vnorm([0, Math.sqrt(Math.max(0.05, 1 - t * t)), t]);
      const len = (0.05 + 0.03 * Math.sin((i / 4) * Math.PI)) * crest;
      const b = H(0, y - 0.008, z);
      const tip: Vec3 = [b[0], b[1] + (nrm[1] * len + 0.006) * k, b[2] + (nrm[2] * len - 0.02 - 0.012 * i) * k];
      ctx.late(`crest${i}`, spike(b, tip, (0.016 - 0.0015 * i) * k, 0.003 * k), 'head', { tags: ['tusk'], w: 0.004 });
    });
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// war mace: leather-wrapped ash haft, iron collars, a socketed iron ball head with an equator band, two staggered rings of five long
// spikes and a top spike. Dimensions are metres at the nominal body scale (1.62), scaled with the body and `o.size`.
/** paint tags of the mace materials (the `propTags` result of the model satisfies this) */
export interface MaceTags {
  metal: string[];
  haft: string[];
  wrap: string[];
}

export function mace(ctx: Ctx, f: WFrame, t: MaceTags, o: { size?: number } = {}): void {
  const K = (f.s / 1.62) * (o.size ?? 1);
  const P = (x: number, y: number, z: number): Vec3 => f.p(x * K, y * K, z * K);
  const add = (name: string, sdf: Sdf, tags: string[], w = 0.004): void => {
    ctx.add(`prop_${name}`, sdf, f.bone, { tags, w, grip: 1.5 });
  };
  const up = f.d(0, 1, 0);
  add('haft', rc(P(0, -0.17, 0), P(0, 1.1, 0), 0.052 * K, 0.046 * K), t.haft);
  add('wrap', rc(P(0, -0.12, 0), P(0, 0.34, 0), 0.066 * K, 0.066 * K), t.wrap, 0.003);
  add('pommel', new Ellipsoid(P(0, -0.2, 0), [0.08 * K, 0.075 * K, 0.08 * K]), t.metal);
  add('collar0', new Torus(P(0, 0.64, 0), 0.058 * K, 0.017 * K, up), t.metal, 0.003);
  add('socket', rc(P(0, 0.96, 0), P(0, 1.14, 0), 0.07 * K, 0.1 * K), t.metal, 0.004);
  // head: iron ball + equator band
  const hc = 1.34, hr = 0.2;
  add('ball', new Ellipsoid(P(0, hc, 0), [hr * K, hr * 1.08 * K, hr * K]), t.metal, 0.005);
  add('band', new Torus(P(0, hc, 0), (hr + 0.012) * K, 0.022 * K, up), t.metal, 0.004);
  // spikes: two staggered rings of five + top + a stub underneath, all radiating from the ball centre
  const ring = (n: number, elev: number, phase: number, len: number, base: number, tag: string): void => {
    for (let i = 0; i < n; i++) {
      const ph = phase + (i / n) * Math.PI * 2;
      const d: Vec3 = [Math.cos(elev) * Math.cos(ph), Math.sin(elev), Math.cos(elev) * Math.sin(ph)];
      const b = P(d[0] * (hr - 0.03), hc + d[1] * (hr - 0.03), d[2] * (hr - 0.03));
      const tip = P(d[0] * (hr + len), hc + d[1] * (hr + len), d[2] * (hr + len));
      add(`${tag}${i}`, spike(b, tip, base * K, 0.008 * K), t.metal, 0.005);
    }
  };
  ring(5, 0.55, 0.3, 0.2, 0.055, 'sa');
  ring(5, -0.5, 0.3 + Math.PI / 5, 0.2, 0.055, 'sb');
  add('tip', spike(P(0, hc + hr - 0.04, 0), P(0, hc + hr + 0.28, 0), 0.07 * K, 0.009 * K), t.metal, 0.006);
  add('stub', spike(P(0, hc - hr + 0.04, 0), P(0, hc - hr - 0.12, 0), 0.05 * K, 0.008 * K), t.metal, 0.006);
}

// ---------------------------------------------------------------------------------------------------------------------
type V3 = [number, number, number];

/** giant mace: low knuckle-dragging carry, overhead smash (attack, ground impact at 0.6 s) and a backhand sweep (attack2, front-centre pass at 0.58 s) */
export function maceStyle(): OrcStyle {
  const c0 = chopAxes(0.5, -0.2);
  const idle: Pose = Object.assign(basePose(), stance(0.2, 0.08, 0.09), {
    sp: [0.2, -0.12, 0] as V3,
    head: [-0.22, 0, 0] as V3,
    hip: [0, 0.08, 0] as V3,
    r: grip(V(-0.42, -0.3, 0.32), c0.b, c0.edge, 1),
    l: { ...grip(V(0.38, -0.4, 0.12), V(0, -0.2, 1), V(1, 0, 0), 0.5) },
  });
  const run1 = chopAxes(0.7, -0.22);
  const wind = chopAxes(2.45);
  const smash = chopAxes(0.2);
  const attack: Key[] = [
    { t: 0, p: {} },
    { t: 0.46, ease: 'out', p: { r: gp(V(-0.26, 0.52, -0.12), wind.b, wind.edge), sp: [-0.28, -0.35, 0.08], hip: [0, -0.3, 0], root: V(0, 0.0, -0.1), head: [-0.3, 0, 0], shr: 0.2, shl: 0.1, fl: V(0.2, 0, 0.0), fr: V(-0.2, 0, -0.2), l: gp(V(0.44, 0.1, 0.1), V(0.2, 0.4, 1), V(1, 0, 0), 0.2) } },
    { t: 0.6, ease: 'in', p: { r: gp(V(-0.08, -0.12, 0.5), smash.b, smash.edge), sp: [0.52, 0.32, -0.05], hip: [0, 0.3, 0], root: V(0, -0.26, 0.32), head: [0.2, 0, 0], fl: V(0.2, 0, 0.4), fr: V(-0.2, 0, -0.14), l: gp(V(0.4, -0.35, 0.1), undefined, undefined, 0.6) } },
    { t: 0.85, ease: 'smooth', p: { root: V(0, -0.27, 0.32) } },
    { t: 1.4, ease: 'smooth', p: { ...idle } },
  ];
  const w2 = sweepAxes(1.1, 0.2, -1);
  const s2 = sweepAxes(-1.0, -0.05, -1);
  const s3 = sweepAxes(-1.6, -0.1, -1);
  const attack2: Key[] = [
    { t: 0, p: {} },
    { t: 0.5, ease: 'out', p: { r: gp(V(0.2, 0.1, 0.34), w2.b, w2.edge), sp: [0.1, 0.8, 0.12], hip: [0, 0.5, 0], root: V(0, -0.1, -0.06), fl: V(0.2, 0, 0.1), fr: V(-0.2, 0, -0.16), l: gp(V(0.44, 0.0, 0.2), undefined, undefined, 0.3) } },
    { t: 0.66, ease: 'in', p: { r: gp(V(-0.34, -0.1, 0.42), s2.b, s2.edge), sp: [0.2, -0.65, -0.08], hip: [0, -0.5, 0], root: V(0, -0.15, 0.18), fl: V(0.2, 0, 0.22), fr: V(-0.2, 0, -0.1) } },
    { t: 0.9, ease: 'out', p: { r: gp(V(-0.5, -0.12, 0.24), s3.b, s3.edge), sp: [0.24, -0.85, 0] } },
    { t: 1.3, ease: 'smooth', p: { ...idle } },
  ];
  return {
    cfg: {}, idle,
    walk: { r: gp(V(-0.42, -0.26, 0.32)) },
    run: { r: gp(V(-0.44, -0.18, 0.28), run1.b, run1.edge) },
    attack, attackDur: 1.4, attackHit: 0.6, attack2, attack2Dur: 1.3, attack2Hit: 0.58, weight: 1.5, death: 'forward',
    gait: { walk: { T: 1.3, sweep: 0.58, stomp: 0.05, lean: 0.1 }, run: { T: 0.82, sweep: 0.92, stomp: 0.06 } },
  };
}

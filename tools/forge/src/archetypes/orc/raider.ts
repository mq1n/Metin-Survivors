// Scout / fighter additions to the orc kit (models orc_scout, orc_fighter): leaf-shaped goblin ears over `orcHead`, a shaggy fur
// mantle that survives the decimator, and a swept hair crest. Geometry follows the humanoid conventions (world rest pose, +Z forward,
// +X = character's left, every part skinned to the bone that carries the surface).
import { type Vec3, vcross, vnorm, vscale, vsub } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { flatCone, tube } from '../../core/sdf/shapes.ts';
import { type Ctx, Loft, type PieceEnv } from '../humanoid/index.ts';
import type { AddOpts } from '../humanoid/kit/ctx.ts';
import { type OrcHeadOpts, orcHead } from './head.ts';
import { type Frame, Slab } from './kit.ts';
import { torsoPoint } from './pieces.ts';

export interface LeafEarOpts {
  /** length multiplier (1 = 0.17 head metres) */
  len?: number;
  /** width multiplier */
  wid?: number;
  /** ear axis (out, up, back) in the head frame; mirrored per side */
  dir?: Vec3;
  /** thickness multiplier */
  thick?: number;
  /** roll of the plate about the ear axis (rad): 0 = vertical leaf facing forward, larger = flatter wing that reads from above */
  roll?: number;
}

/** leaf outline in (along, across) fractions of (length, half width): rounded upper helix, pointed tip, smaller lower lobe */
const LEAF: [number, number][] = [
  [-0.1, 0.3], [0.04, 0.64], [0.2, 0.98], [0.42, 1.0], [0.62, 0.78], [0.82, 0.44], [1.0, 0.14],
  [0.9, -0.1], [0.74, -0.34], [0.54, -0.56], [0.34, -0.68], [0.16, -0.58], [0.0, -0.38], [-0.1, -0.2],
];

/** two big leaf ears (flat plates on the ear bones), tagged `ear` / `ear_inner` for the orc paint */
export function leafEars(ctx: Ctx, o: LeafEarOpts = {}): void {
  const a = ctx.a;
  const k = a.s * a.hs;
  const sk = a.skull;
  const L = 0.17 * k * (o.len ?? 1);
  const W = 0.056 * k * (o.wid ?? 1);
  const dir0 = o.dir ?? [0.88, 0.42, -0.22];
  const th = o.thick ?? 1;
  const cr = Math.cos(o.roll ?? 0.5), sr = Math.sin(o.roll ?? 0.5);
  for (const sx of [1, -1] as const) {
    const n = sx === 1 ? 'l' : 'r';
    const base: Vec3 = [sk[0] + sx * 0.074 * k, sk[1] - 0.012 * k, sk[2] - 0.012 * k];
    const y = vnorm([dir0[0] * sx, dir0[1], dir0[2]]);
    // in-plane "across" axis ~ up, thickness axis ~ forward; the plate is rolled about the ear axis toward a flat wing (same sense on both sides)
    const z0 = vnorm(vsub([0, 1, 0], vscale(y, y[1])));
    const x0 = vnorm(vcross(y, z0));
    const z = vnorm([z0[0] * cr - sx * x0[0] * sr, z0[1] * cr - sx * x0[1] * sr, z0[2] * cr - sx * x0[2] * sr]);
    const x = vnorm(vcross(y, z));
    const f: Frame = { o: base, x, y, z };
    const outline = LEAF.map(([u, v]) => [u * L, v * W] as [number, number]);
    const half = (ly: number, lz: number): number => {
      const u = Math.min(1, Math.max(0, ly / L));
      const edge = Math.min(1, Math.abs(lz) / W);
      return (0.0062 + 0.0042 * (1 - u) + 0.003 * (1 - edge)) * k * th;
    };
    const bone = a.layout.ears ? `ear_${n}` : 'head';
    ctx.add(`leaf_${n}`, new Slab(f, outline, half, 0.0028 * k, 0.02 * k), bone, { tags: ['skin', 'head', 'ear'], w: 0.012 });
    // inner ear: a smaller concha painted darker (paint-only region, thick enough to cover both faces)
    const inner = LEAF.map(([u, v]) => [(0.42 + (u - 0.42) * 0.62) * L, (0.06 + (v - 0.06) * 0.58) * W] as [number, number]);
    ctx.mark(`leafin_${n}`, new Slab(f, inner, () => 0.02 * k, 0.002 * k, 0.03 * k), ['ear_inner']);
  }
}

/** `orcHead` with its thin cone ears replaced by `leafEars` */
export function goblinHead(head: OrcHeadOpts, ears: LeafEarOpts = {}): (ctx: Ctx) => void {
  const base = orcHead(head);
  return (ctx) => {
    // the same context minus every `ear_*` part orcHead adds
    const filtered: Ctx = Object.create(ctx, {
      add: { value: (name: string, sdf: Sdf, bone: string, o?: AddOpts): Ctx => (name.startsWith('ear_') ? ctx : ctx.add(name, sdf, bone, o)) },
    });
    base(filtered);
    leafEars(ctx, ears);
  };
}

/**
 * fur mantle: a thick shell over the shoulders / upper chest / upper back (inflated torso loft, so it reads as a bulky collar from
 * every side and from above) with rows of overlapping flat tufts hanging from its hem. o: shell (thickness x3 cm, 0 = tufts only),
 * drop (how far the hem hangs, x3 cm), rows, tufts per row, len, wid
 */
export function furMantle(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const rng = new Rng(`${a.p.seed}/mantle${e.i}`);
  const rows = e.n('rows', 2);
  const n = e.n('tufts', 20);
  const lenK = e.n('len', 1);
  const widK = e.n('wid', 1);
  const shell = e.n('shell', 1);
  const drop = e.n('drop', 1);
  const T = a.torso;
  const ext = 0.03 * s * shell;
  const yTop = T[9]!.y + 0.004 * s;
  const yHem = T[6]!.y - 0.03 * s * drop;
  const bone = 'chest';
  if (shell > 0) {
    const st = T.slice(5).map((q) => ({ y: q.y, rx: q.rx + ext, rz: q.rz + ext, cz: q.cz, n: q.n }));
    e.ctx.add(`${e.spec.id}_shell`, new Loft(st, { range: [yHem, yTop] }), bone, { tags: e.tag(e.mat, 'fur'), w: 0.012, grip: 1.2 });
  }
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < n; i++) {
      const ang = ((i + 0.5 * (row % 2)) / n) * Math.PI * 2 + rng.range(-0.05, 0.05);
      const sa = Math.sin(ang), ca = Math.cos(ang);
      const back = ca < -0.3;
      const base = torsoPoint(a, yHem + 0.025 * s - row * 0.03 * s, sa * 0.97, ext * 0.8 + row * 0.012 * s, ca < 0);
      // side tufts stay short: the upper arm hangs there
      const len = (0.1 + 0.05 * row + 0.05 * rng.next()) * s * lenK * (back ? 1.3 : 1) * (1 - 0.5 * Math.max(0, Math.abs(sa) - 0.6) / 0.4);
      const out = 0.04 * s * rng.range(0.8, 1.3);
      const tip: Vec3 = [base[0] + sa * out, base[1] - len, base[2] + ca * out - (back ? 0.012 * s : 0)];
      const w = 0.036 * s * widK * rng.range(0.85, 1.2);
      e.ctx.add(`${e.spec.id}_m${row}_${i}`, flatCone(base, tip, w, w * 0.2, 0.55, [sa, 0.15, ca]), bone, { tags: e.tag(e.mat, 'fur'), w: 0.012 });
    }
  }
}

/** swept-back hair crest from brow to nape plus a hanging tail (skinned to the head); o: tufts, h (height), tail (length) */
export function crestHair(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const n = e.n('tufts', 7);
  const h = e.n('h', 1);
  const tl = e.n('tail', 1);
  const rng = new Rng(`${a.p.seed}/crest${e.i}`);
  // the cranium ellipsoid of orcHead: centre (0, 0.026, -0.03) k, radii (., 0.088, 0.098) k
  const top = (z: number): number => 0.026 + 0.088 * Math.sqrt(Math.max(0, 1 - ((z + 0.03) / 0.098) ** 2));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const z = 0.065 - 0.15 * t;
    const base: Vec3 = [0, sk[1] + (top(z) - 0.012) * k, sk[2] + z * k];
    const rise = (0.07 + 0.06 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * h;
    const tip: Vec3 = [rng.range(-0.006, 0.006) * k, base[1] + rise * k, base[2] - (0.045 + 0.03 * t) * k];
    e.ctx.add(`${e.spec.id}_c${i}`, flatCone(base, tip, 0.034 * k, 0.007 * k, 0.55, [1, 0, 0]), 'head', { tags: e.tag(e.mat, 'hair'), w: 0.01 });
  }
  const p0: Vec3 = [0, sk[1] + (top(-0.08) - 0.02) * k, sk[2] - 0.075 * k];
  const p1: Vec3 = [0, p0[1] - 0.09 * k * tl, p0[2] - 0.075 * k * tl];
  const p2: Vec3 = [0, p1[1] - 0.12 * k * tl, p1[2] - 0.03 * k * tl];
  e.ctx.add(`${e.spec.id}_tail`, tube([p0, p1, p2], [[0, 0.03 * k], [0.55, 0.026 * k], [1, 0.008 * k]], { segments: 4, w: 0.01 }), 'head', { tags: e.tag(e.mat, 'hair'), w: 0.01 });
}

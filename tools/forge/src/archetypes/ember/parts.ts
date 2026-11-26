// Ember part builders: obsidian shards, flame crests, horns, tusks and recessed lava cores that grow out of the humanoid body.
// All take the humanoid `Ctx` (afterBody / afterOutfit hooks) and add tagged, bone-bound SDF parts. Units: metres, anatomy-relative
// (scaled by `a.s` / head scale `k = a.s * a.hs`).
import { type Vec3, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Ellipsoid, RoundedBox } from '../../core/sdf/primitives.ts';
import { tube } from '../../core/sdf/shapes.ts';
import { Loft, type Ctx, type Side } from '../humanoid/index.ts';
import { Shard, type ShardOpts } from './shard.ts';

export const BOTH = [1, -1] as Side[];
export const SIDE = (sx: Side): 'l' | 'r' => (sx === 1 ? 'l' : 'r');

/** paint identity of a family of shards: the reserved piece tag and an optional glowing-tip tag (paint-only mark on the last part of each shard) */
export interface ShardStyle {
  tag: string;
  tip?: string;
  /** fraction of the shard length that is marked as the hot tip (default 0.34) */
  tipFrac?: number;
}

/** add one shard growing from `base` toward `tip` */
export function shard(ctx: Ctx, name: string, bone: string, base: Vec3, tip: Vec3, wu: number, wv: number, st: ShardStyle, o: ShardOpts & { w?: number; grip?: number } = {}): void {
  ctx.add(name, new Shard(base, tip, wu, wv, o), bone, { tags: [st.tag], w: o.w ?? 0.008, grip: o.grip ?? 1.6 });
  if (st.tip) {
    const f = 1 - (st.tipFrac ?? 0.34);
    const tu = o.tu ?? wu * 0.08, tv = o.tv ?? wv * 0.08;
    const hw = wu + (tu - wu) * f, hh = wv + (tv - wv) * f;
    const mb = vlerp(base, tip, f);
    ctx.mark(`${name}_tip`, new Shard(mb, vadd(tip, vscale(vnorm(vsub(tip, base)), 0.004)), hw + 0.0025, hh + 0.0025, { ...(o.side ? { side: o.side } : {}), tu: tu + 0.002, tv: tv + 0.002, root: 0, round: 0.002, ...(o.bow ? { bow: o.bow * (1 - f) } : {}) }), [st.tip]);
  }
}

/** head-local helper: (dx, dy, dz) in head units around the skull centre */
export function headAt(ctx: Ctx): (dx: number, dy: number, dz: number) => Vec3 {
  const a = ctx.a;
  const k = a.s * a.hs;
  const sk = a.skull;
  return (dx, dy, dz) => [sk[0] + dx * k, sk[1] + dy * k, sk[2] + dz * k];
}

export interface CrestOpts {
  /** number of tongues along the crown (default 6) */
  count?: number;
  /** size multiplier (default 1) */
  size?: number;
  /** how far back the blades sweep (radians from vertical at the nape, default 1.15) */
  sweep?: number;
}

/** swept-back flame crest running from the brow over the crown to the nape: curved tapering tongues (round section, so they never read as flat cards) */
export function crest(ctx: Ctx, st: ShardStyle, o: CrestOpts = {}): void {
  const H = headAt(ctx);
  const k = ctx.a.s * ctx.a.hs;
  const n = o.count ?? 6;
  const size = o.size ?? 1;
  const sweep = o.sweep ?? 1.15;
  // crown path (y, z) in head units from the forehead to the nape
  const path: [number, number][] = [[0.07, 0.074], [0.105, 0.04], [0.118, -0.005], [0.112, -0.05], [0.094, -0.088], [0.066, -0.11], [0.04, -0.118]];
  const tongue = (name: string, base: Vec3, tip: Vec3, bend: Vec3, r0: number): void => {
    const mid = vadd(vlerp(base, tip, 0.5), bend);
    ctx.add(name, tube([base, mid, tip], [[0, r0], [0.5, r0 * 0.66], [1, 0.0042 * k]], { segments: 5, w: 0.008 }), 'head', { tags: [st.tag], w: 0.012, grip: 1.6 });
    if (st.tip) ctx.mark(`${name}_tip`, tube([vlerp(mid, tip, 0.2), vadd(tip, vscale(vnorm(vsub(tip, base)), 0.004))], [[0, r0 * 0.5 + 0.0025], [1, 0.0065 * k]], { segments: 4, w: 0.004 }), [st.tip]);
  };
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const f = t * (path.length - 1);
    const j = Math.min(Math.floor(f), path.length - 2);
    const u = f - j;
    const y = path[j]![0] + (path[j + 1]![0] - path[j]![0]) * u;
    const z = path[j]![1] + (path[j + 1]![1] - path[j]![1]) * u;
    const len = (0.085 + 0.13 * Math.sin(Math.PI * (0.15 + 0.7 * t))) * size;
    const phi = 0.12 + (sweep - 0.12) * t;
    const jitter = (i % 2 === 0 ? 1 : -1) * 0.012;
    const base = H(jitter, y - 0.012, z);
    const tip = H(jitter * 0.4, y - 0.012 + Math.cos(phi) * len, z - Math.sin(phi) * len);
    // the tongue curls back toward its tip (and sways sideways a little, alternating)
    tongue(`crest${i}`, base, tip, [(i % 2 === 0 ? 1 : -1) * 0.012 * k * size, 0, -0.03 * k * size], 0.021 * k * size);
  }
  // two side flames sweeping back over the ears
  for (const sx of BOTH) {
    const base = H(sx * 0.07, 0.07, -0.02);
    const tip = H(sx * 0.1, 0.13 * size + 0.05, -0.14 * size - 0.02);
    tongue(`crestSide_${SIDE(sx)}`, base, tip, [sx * 0.012 * k, 0.012 * k, -0.01 * k], 0.019 * k * size);
  }
}

export interface HornOpts {
  /** length multiplier */
  len?: number;
  /** thickness multiplier */
  thick?: number;
  /** curve upward (1) or forward (0..-1) */
  rise?: number;
}

/** brow horns: curved tapered tubes from the outer brow up and back */
export function browHorns(ctx: Ctx, tag: string, o: HornOpts = {}): void {
  const H = headAt(ctx);
  const k = ctx.a.s * ctx.a.hs;
  const len = o.len ?? 1;
  const th = o.thick ?? 1;
  const rise = o.rise ?? 1;
  for (const sx of BOTH) {
    const b = H(sx * 0.052, 0.058, 0.058);
    const m = H(sx * 0.11 * len + sx * 0.01, 0.075 + 0.03 * rise, 0.035);
    const t = H(sx * 0.125 * len, 0.075 + 0.1 * rise * len, -0.045 * len);
    ctx.add(`browHorn_${SIDE(sx)}`, tube([b, m, t], [[0, 0.02 * k * th], [0.55, 0.0145 * k * th], [1, 0.0055 * k]], { segments: 4, w: 0.006 }), 'head', { tags: [tag], w: 0.01, grip: 1.6 });
  }
}

/** lower-jaw tusks curving up past the lip line */
export function tusks(ctx: Ctx, tag: string, size = 1): void {
  const H = headAt(ctx);
  const k = ctx.a.s * ctx.a.hs;
  for (const sx of BOTH) {
    const b = H(sx * 0.03, -0.088, 0.068);
    const m = H(sx * 0.04, -0.062, 0.1);
    const t = H(sx * 0.037, -0.02 * size - 0.014, 0.108);
    ctx.add(`tusk_${SIDE(sx)}`, tube([b, m, t], [[0, 0.0105 * k], [0.6, 0.0075 * k], [1, 0.0016 * k]], { segments: 3, w: 0.004 }), 'head', { tags: [tag], w: 0.004, grip: 1.6 });
  }
}

export interface CragOpts {
  size?: number;
  /** spikes per shoulder (default 4) */
  count?: number;
}

/** shoulder crags: a fan of faceted shards on each deltoid, leaning out/up/back */
export function shoulderCrags(ctx: Ctx, st: ShardStyle, o: CragOpts = {}): void {
  const a = ctx.a;
  const s = a.s;
  const size = o.size ?? 1;
  const n = o.count ?? 4;
  for (const sx of BOTH) {
    const sh = a.side(sx).shoulder;
    for (let j = 0; j < n; j++) {
      const t = n === 1 ? 0.5 : j / (n - 1);
      const base = vadd(sh, [sx * (0.015 + 0.04 * t) * s, (0.05 - 0.02 * t) * s, (0.03 - 0.07 * t) * s]);
      const dir = vnorm([sx * (0.35 + 0.55 * t), 0.85 - 0.35 * t, 0.1 - 0.6 * t]);
      const len = (0.17 + 0.12 * Math.sin(Math.PI * (0.2 + 0.7 * t))) * s * size;
      const tip = vadd(base, vscale(dir, len));
      shard(ctx, `crag${j}_${SIDE(sx)}`, `clavicle_${SIDE(sx)}`, base, tip, (0.036 - 0.006 * t) * s * size, (0.026 - 0.004 * t) * s * size, st, { side: [1, 0, 0.3], tu: 0.006 * s, tv: 0.005 * s, w: 0.012, root: 0.04 * s });
    }
  }
}

/** dorsal ridge: spikes down the spine, biggest between the shoulder blades */
export function dorsalSpikes(ctx: Ctx, st: ShardStyle, o: { count?: number; size?: number } = {}): void {
  const a = ctx.a;
  const s = a.s;
  const T = new Loft(a.torso);
  const n = o.count ?? 6;
  const size = o.size ?? 1;
  const y0 = a.chest[1] + 0.18 * s, y1 = a.spine[1] - 0.04 * s;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const y = y0 + (y1 - y0) * t;
    const q = T.at(y);
    const base: Vec3 = [0, y, q.cz - q.rz * 0.9];
    const len = (0.2 - 0.09 * t) * s * size;
    const lean = 0.7 + 0.2 * t;
    const tip: Vec3 = [0, y + Math.cos(lean) * len * 0.9, base[2] - Math.sin(lean) * len];
    shard(ctx, `dorsal${i}`, i < n / 2 ? 'chest' : 'spine', base, tip, (0.032 - 0.01 * t) * s * size, 0.016 * s * size, st, { side: [1, 0, 0], tu: 0.004 * s, tv: 0.003 * s, w: 0.014, root: 0.04 * s });
  }
}

/** elbow spikes + two blade fins along each forearm (swept back toward the elbow) */
export function forearmSpikes(ctx: Ctx, st: ShardStyle, size = 1): void {
  const a = ctx.a;
  const s = a.s;
  for (const sx of BOTH) {
    const j = a.side(sx);
    const n = SIDE(sx);
    const eb = vadd(j.elbow, [sx * 0.02 * s, 0.005 * s, -0.03 * s]);
    shard(ctx, `elbowSpike_${n}`, `forearm_${n}`, eb, vadd(eb, [sx * 0.07 * s * size, 0.03 * s * size, -0.15 * s * size]), 0.034 * s * size, 0.024 * s * size, st, { side: [0, 1, 0], tu: 0.005 * s, tv: 0.004 * s, w: 0.012, root: 0.04 * s });
    const dir = vnorm(vsub(j.wrist, j.elbow));
    for (const [u, ln] of [[0.62, 0.2], [0.82, 0.15]] as [number, number][]) {
      const c = vlerp(j.elbow, j.wrist, u);
      const base = vadd(c, [sx * 0.042 * s, 0, -0.012 * s]);
      const tip = vadd(vadd(base, vscale(dir, -ln * s * size)), [sx * 0.045 * s * size, 0.0, -0.01 * s]);
      shard(ctx, `forearmFin${u}_${n}`, `forearm_${n}`, base, tip, 0.024 * s * size, 0.01 * s * size, st, { side: [0, 1, 0], tu: 0.004 * s, tv: 0.003 * s, w: 0.01, root: 0.02 * s });
    }
  }
}

/** knee spikes and shin fins */
export function legSpikes(ctx: Ctx, st: ShardStyle, size = 1): void {
  const a = ctx.a;
  const s = a.s;
  for (const sx of BOTH) {
    const j = a.side(sx);
    const n = SIDE(sx);
    const kb = vadd(j.knee, [sx * 0.012 * s, 0.01 * s, a.r.knee * 0.85]);
    shard(ctx, `kneeSpike_${n}`, `shin_${n}`, kb, vadd(kb, [sx * 0.01 * s, 0.05 * s * size, 0.12 * s * size]), 0.03 * s * size, 0.022 * s * size, st, { side: [1, 0, 0], tu: 0.005 * s, tv: 0.004 * s, w: 0.012, root: 0.04 * s });
    const c = vlerp(j.knee, j.ankle, 0.55);
    for (const k2 of [-1, 1]) {
      const base = vadd(c, [sx * 0.045 * s, k2 * 0.03 * s, -0.045 * s]);
      shard(ctx, `shinFin${k2}_${n}`, `shin_${n}`, base, vadd(base, [sx * 0.05 * s * size, k2 * 0.02 * s - 0.01 * s, -0.11 * s * size]), 0.022 * s * size, 0.009 * s * size, st, { side: [0, 1, 0], tu: 0.004 * s, tv: 0.003 * s, w: 0.01, root: 0.02 * s });
    }
  }
}

/** a recessed chest core: carves a socket into the chest front (the carved surface is tagged `coreTag` for glow) + a crystal inside */
export function coreRecess(ctx: Ctx, coreTag: string, o: { size?: number; y?: number } = {}): void {
  const a = ctx.a;
  const s = a.s;
  const size = o.size ?? 1;
  const T = new Loft(a.torso);
  const y = o.y ?? a.chest[1] + 0.03 * s;
  const q = T.at(y);
  const zf = q.cz + q.rz;
  ctx.cut('coreSocket', new Ellipsoid([0, y, zf + 0.008 * s], [0.04 * s * size, 0.054 * s * size, 0.032 * s]), 'chest', { tags: [coreTag], w: 0.008 });
  shard(ctx, 'coreCrystal', 'chest', [0, y, zf - 0.03 * s], [0, y + 0.01 * s, zf + 0.002 * s], 0.022 * s * size, 0.022 * s * size, { tag: coreTag }, { tu: 0.01 * s, tv: 0.01 * s, w: 0.004, root: 0.02 * s });
}

/** a small clenched-fist knuckle row (3 shards on the back of each hand, pointing outward and slightly forward) */
export function knuckleShards(ctx: Ctx, st: ShardStyle, size = 1): void {
  const a = ctx.a;
  const s = a.s;
  for (const sx of BOTH) {
    const j = a.side(sx);
    const n = SIDE(sx);
    for (let f = -1; f <= 1; f++) {
      const base = vadd(j.knuckle, [sx * 0.012 * s, 0.0, f * a.r.palmW * 0.55]);
      const tip = vadd(base, [sx * 0.07 * s * size, -0.012 * s, f * 0.012 * s + 0.012 * s]);
      shard(ctx, `knuckle${f}_${n}`, `wrist_${n}`, base, tip, 0.016 * s * size, 0.012 * s * size, st, { side: [0, 0, 1], tu: 0.003 * s, tv: 0.003 * s, w: 0.008, root: 0.02 * s });
    }
  }
}

/** chunky fists: a rounded block over each (mitten) hand so the fist reads big and square from every angle */
export function fists(ctx: Ctx, size = 1): void {
  const a = ctx.a;
  const s = a.s;
  for (const sx of BOTH) {
    const j = a.side(sx);
    const n = SIDE(sx);
    const bone = `wrist_${n}`;
    const c = vlerp(j.palm, j.fingerTip, 0.5);
    const half: Vec3 = [a.r.palmT * 1.05 * size + 0.006 * s, Math.abs(j.palm[1] - j.fingerTip[1]) * 0.56, a.r.palmW * 0.62 * size];
    const cx = c[0] + sx * 0.004 * s, cz = c[2] + 0.004 * s;
    ctx.add(`fist_${n}`, new RoundedBox([cx, c[1], cz], half, 0.016 * s), bone, { tags: ['skin', 'hand'], w: 0.012, grip: 1.3 });
    // four curled finger rolls across the bottom of the fist + a thumb wedge on the +Z side
    for (let f = 0; f < 4; f++) {
      const z = cz + (f - 1.5) * ((half[2] * 2) / 4.2);
      ctx.add(`fistFinger${f}_${n}`, new Ellipsoid([cx, c[1] - half[1] * 0.78, z], [half[0] * 1.02, half[1] * 0.3, half[2] * 0.27]), bone, { tags: ['skin', 'hand'], w: 0.008, grip: 1.3 });
    }
    ctx.add(`fistThumb_${n}`, new Ellipsoid([cx - sx * half[0] * 0.15, c[1] + half[1] * 0.3, cz + half[2] * 0.95], [half[0] * 0.8, half[1] * 0.42, half[2] * 0.36]), bone, { tags: ['skin', 'hand'], w: 0.01, grip: 1.3 });
  }
}

/** a spur on each heel pointing back and up */
export function heelSpurs(ctx: Ctx, st: ShardStyle, size = 1): void {
  const a = ctx.a;
  const s = a.s;
  for (const sx of BOTH) {
    const j = a.side(sx);
    const n = SIDE(sx);
    const base = vadd(j.heel, [0, 0.03 * s, 0.012 * s]);
    shard(ctx, `heelSpur_${n}`, `foot_${n}`, base, vadd(base, [sx * 0.012 * s, 0.05 * s * size, -0.1 * s * size]), 0.022 * s * size, 0.016 * s * size, st, { side: [1, 0, 0], tu: 0.005 * s, tv: 0.004 * s, w: 0.008, root: 0.02 * s });
  }
}

/** three claws on each foot, pointing forward from the toe tips */
export function toeClaws(ctx: Ctx, st: ShardStyle, size = 1): void {
  const a = ctx.a;
  const s = a.s;
  for (const sx of BOTH) {
    const j = a.side(sx);
    const n = SIDE(sx);
    for (let f = -1; f <= 1; f++) {
      const base = vadd(j.toeTip, [sx * f * a.r.footW * 0.3, 0.012 * s, -0.012 * s]);
      const tip = vadd(base, [sx * f * 0.012 * s, -0.006 * s, 0.075 * s * size]);
      shard(ctx, `toeClaw${f}_${n}`, `toe_${n}`, base, tip, 0.015 * s * size, 0.011 * s * size, st, { side: [1, 0, 0], tu: 0.002 * s, tv: 0.002 * s, w: 0.006, root: 0.02 * s });
    }
  }
}

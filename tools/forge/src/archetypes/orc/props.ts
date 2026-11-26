// Held props for orcs and monks, built as SDF parts skinned rigidly to the wrist bone (the pipeline's hand frame: weapon +Y along
// the haft, +Z = edge side, see kit.ts `weaponFrame`). Everything is chunky on purpose: voxel 8-9 mm and a 4.5k-tri budget cannot
// carry thin sheets, and chunky reads better from the 22 m game camera anyway.
import { type Vec3, qaxis, qmul, qx, vadd, vlerp, vscale } from '../../core/math.ts';
import type { Sdf } from '../../core/sdf/node.ts';
import { Ellipsoid, RoundCone, Sphere, Torus } from '../../core/sdf/primitives.ts';
import type { Ctx } from '../humanoid/index.ts';
import { type Frame, type WFrame, Slab, el, feather, frameOf, horn, rbox, rc, spike } from './kit.ts';
import { flatCone, tube } from '../../core/sdf/shapes.ts';
import { plume } from './plumes.ts';

/** paint pieces of a prop: one per material (palette keys picked by the model) */
export interface PropMats {
  metal: string;
  haft: string;
  wrap: string;
  bone?: string;
  cloth?: string;
  glow?: string;
}

interface Tags {
  metal: string[];
  haft: string[];
  wrap: string[];
  bone: string[];
  cloth: string[];
  glow: string[];
  /** trim tags (edge highlight on metal) */
  edge: string;
}

/** reserve paint pieces for a prop (call from the afterOutfit hook) */
export function propTags(ctx: Ctx, m: PropMats): Tags {
  const metal = ctx.piece(m.metal, { trim: 'none' });
  const haft = ctx.piece(m.haft, { trim: 'none' });
  const wrap = ctx.piece(m.wrap, { trim: 'none' });
  const bone = ctx.piece(m.bone ?? 'bone', { trim: 'none' });
  const cloth = ctx.piece(m.cloth ?? 'cloth', { trim: 'none' });
  const glow = ctx.piece(m.glow ?? 'bone', { trim: 'none' });
  return {
    metal: [metal.tag], haft: [haft.tag], wrap: [wrap.tag], bone: [bone.tag], cloth: [cloth.tag], glow: [glow.tag, 'glow'], edge: metal.trimTag,
  };
}

const add = (ctx: Ctx, f: WFrame, name: string, sdf: Sdf, tags: string[], w = 0.004, grip = 1.5): void => {
  ctx.add(`prop_${name}`, sdf, f.bone, { tags, w, grip });
};

/** plain haft: a tapered round cone along the weapon Y axis plus a leather-wrapped grip section and a pommel knob */
function haft(ctx: Ctx, f: WFrame, t: Tags, y0: number, y1: number, r: number, wrapFrom = -0.12, wrapTo = 0.12, knob = true): void {
  const s = f.s;
  add(ctx, f, 'haft', rc(f.p(0, y0 * s, 0), f.p(0, y1 * s, 0), r * s, r * 0.94 * s), t.haft);
  // grip wrap: three rings + sleeve
  add(ctx, f, 'wrap', rc(f.p(0, wrapFrom * s, 0), f.p(0, wrapTo * s, 0), r * 1.22 * s, r * 1.22 * s), t.wrap, 0.003);
  if (knob) add(ctx, f, 'pommel', new Ellipsoid(f.p(0, (y0 - 0.005) * s, 0), [r * 1.6 * s, r * 1.5 * s, r * 1.6 * s]), t.metal, 0.004);
}

// ---------------------------------------------------------------------------------------------------------------------
// short hatchet (orc scout): bearded single-bit head (sharp toe, hooked beard), a spike on the back, leather-wrapped haft.
// The blade plane is weapon Y/X (edge along weapon +X = world down in the bind pose): the broad faces look sideways, so the left / right
// turnaround views of the Painter sheet see them head-on (a blade lying flat is only seen at grazing angles and bakes as mud).
export function hatchet(ctx: Ctx, f: WFrame, t: Tags, o: { size?: number } = {}): void {
  const s = f.s * (o.size ?? 1);
  haft(ctx, f, t, -0.12, 0.5, 0.024, -0.1, 0.1);
  const fr: Frame = edgeXFrame(f);
  // head: flared cheek, sharp toe up, convex edge toward +X, beard hooking down with a notch under it (that notch is what reads as an axe); outline in (y, edge)
  const yc = 0.4 * s;
  const P = (dy: number, e: number): [number, number] => [yc + dy * s, e * s];
  const outline: [number, number][] = [P(0.065, -0.04), P(0.085, 0.04), P(0.14, 0.12), P(0.2, 0.215), P(0.15, 0.275), P(0.06, 0.3), P(-0.05, 0.3), P(-0.16, 0.265), P(-0.245, 0.17), P(-0.185, 0.11), P(-0.085, 0.05), P(-0.065, -0.04), P(0, -0.06)];
  const sdf = new Slab(fr, outline, (_y, e) => (0.03 - 0.024 * Math.min(1, Math.max(0, (e - 0.04 * s) / (0.2 * s)))) * s, 0.004 * s, 0.032 * s);
  add(ctx, f, 'blade', sdf, t.metal, 0.005);
  // back spike, angled up
  add(ctx, f, 'spike', spike(f.p(-0.03 * s, yc, 0), f.p(-0.19 * s, yc + 0.04 * s, 0), 0.026 * s, 0.004 * s), t.metal, 0.006);
  // cap over the haft top
  add(ctx, f, 'cap', new Ellipsoid(f.p(0, 0.51 * s, 0), [0.03 * s, 0.03 * s, 0.03 * s]), t.metal);
}

// ---------------------------------------------------------------------------------------------------------------------
// big cleaver (orc fighter): heavy falchion-style chopper - straight toothed spine, clip point, deep belly, thick wedge section (edge along weapon +X, see hatchet)
export function cleaver(ctx: Ctx, f: WFrame, t: Tags, o: { size?: number } = {}): void {
  const s = f.s * (o.size ?? 1);
  haft(ctx, f, t, -0.13, 0.3, 0.026, -0.1, 0.12);
  const fr: Frame = edgeXFrame(f);
  const yb = 0.27 * s;
  const Q = (dy: number, e: number): [number, number] => [yb + dy * s, e * s];
  const outline: [number, number][] = [
    Q(0.0, -0.03), Q(0.15, -0.03), Q(0.175, -0.052), Q(0.205, -0.03), Q(0.26, -0.03), Q(0.285, -0.052), Q(0.315, -0.03), Q(0.4, -0.03), Q(0.54, -0.015),
    Q(0.64, 0.035), Q(0.69, 0.095), Q(0.63, 0.15), Q(0.52, 0.205), Q(0.36, 0.24), Q(0.2, 0.245), Q(0.07, 0.2), Q(0.0, 0.12), Q(-0.015, 0.05),
  ];
  const sdf = new Slab(fr, outline, (_y, e) => (0.028 - 0.022 * Math.min(1, Math.max(0, e / (0.22 * s)))) * s, 0.004 * s, 0.04 * s);
  add(ctx, f, 'blade', sdf, t.metal, 0.005);
  // rivets along both flats, cross guard stub at the ferrule
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) add(ctx, f, `rivet${i}_${side}`, new Ellipsoid(f.p(0.02 * s, yb + (0.06 + 0.12 * i) * s, 0.03 * s * side), [0.014 * s, 0.014 * s, 0.012 * s]), t.metal, 0.003);
  }
  add(ctx, f, 'guard', rc(f.p(-0.045 * s, 0.285 * s, 0), f.p(0.075 * s, 0.285 * s, 0), 0.022 * s, 0.022 * s), t.metal, 0.004);
}

// ---------------------------------------------------------------------------------------------------------------------
// scimitar (orc general): heavy sabre - broad belly, clip point, curving BACK away from the cutting edge; spiked quillons, spiked pommel, wrapped grip.
// The flat faces look along the weapon +Z axis (world +-X at the bind pose, so the Painter side views see them face-on) and the cutting edge is the weapon +X side.
export function scimitar(ctx: Ctx, f: WFrame, t: Tags, o: { size?: number } = {}): void {
  const s = f.s * (o.size ?? 1);
  haft(ctx, f, t, -0.1, 0.2, 0.022, -0.07, 0.15, false);
  add(ctx, f, 'pommel', new Sphere(f.p(0, -0.13 * s, 0), 0.04 * s), t.metal, 0.004);
  add(ctx, f, 'pommelSpike', spike(f.p(0, -0.15 * s, 0), f.p(0, -0.28 * s, 0), 0.026 * s, 0.004 * s), t.metal, 0.004);
  const fr: Frame = { o: f.p(0, 0, 0), x: f.d(0, 0, 1), y: f.d(0, 1, 0), z: f.d(1, 0, 0) };
  const yb = 0.22 * s;
  const L = 1.0 * s;
  const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
  // the blade curves BACK, away from the cutting edge (+z): the convex edge leads the swing
  const bend = (u: number): number => -0.21 * s * u * u;
  const belly: [number, number][] = [[0, 0.052], [0.12, 0.066], [0.3, 0.1], [0.5, 0.126], [0.7, 0.14], [0.84, 0.12], [0.94, 0.072], [1, 0.004]];
  const wEdge = (u: number): number => {
    for (let i = 1; i < belly.length; i++) {
      const [u1, w1] = belly[i]!;
      if (u <= u1) {
        const [u0, w0] = belly[i - 1]!;
        return (w0 + ((w1 - w0) * (u - u0)) / (u1 - u0)) * s;
      }
    }
    return belly[belly.length - 1]![1] * s;
  };
  // spine: plain curve with one shallow swage (false edge) near the tip
  const zSpine = (u: number): number => bend(u) - 0.02 * s + (u > 0.78 ? 0.012 * s * Math.min(1, (u - 0.78) / 0.1) : 0);
  const N = 26;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) pts.push([yb + (i / N) * L, zSpine(i / N)]);
  pts.push([yb + L, bend(1)]);
  for (let i = N - 1; i >= 0; i--) pts.push([yb + (i / N) * L, bend(i / N) + wEdge(i / N)]);
  const sdf = new Slab(fr, pts, (y, z) => {
    const u = clamp01((y - yb) / L);
    const z0 = bend(u) - 0.02 * s, z1 = bend(u) + wEdge(u);
    const k = clamp01((z - z0) / Math.max(z1 - z0, 0.02 * s));
    return (0.03 - 0.025 * k) * s * (1 - 0.4 * clamp01((u - 0.85) / 0.15));
  }, 0.004 * s, 0.032 * s);
  add(ctx, f, 'blade', sdf, t.metal, 0.005);
  // cross guard with spiked quillons curling toward the blade, ferrule
  add(ctx, f, 'guard', rc(f.p(-0.13 * s, yb, 0), f.p(0.13 * s, yb, 0), 0.021 * s, 0.021 * s), t.metal, 0.004);
  for (const sg of [-1, 1]) add(ctx, f, `quillon${sg}`, horn(f.p(sg * 0.11 * s, yb, 0), f.p(sg * 0.165 * s, yb + 0.045 * s, 0), f.p(sg * 0.16 * s, yb + 0.12 * s, 0), 0.024 * s, 0.005 * s, 0.01), t.metal, 0.004);
  add(ctx, f, 'ferrule', rc(f.p(0, yb - 0.03 * s, 0), f.p(0, yb + 0.03 * s, 0), 0.03 * s, 0.026 * s), t.metal, 0.004);
}

// ---------------------------------------------------------------------------------------------------------------------
// great axe (orc lord): two-handed ash haft (right hand at the origin, left hand at +0.45 ref m) with leather grips and a butt spike,
// a huge crescent double bit (open window between the haft and the cutting arc, horn tips, notched edge), iron eye / collars / langets,
// skull bosses and a spear point on top.
/** crescent outline in the (y, z) blade plane: outer cutting arc from the top attach point over the apex to the bottom one, inner arc back (leaves a window against the haft) */
function crescent(sign: 1 | -1, ym: number, hy: number, zOut: number, zIn: number, s: number, notches: boolean): [number, number][] {
  const pts: [number, number][] = [];
  const N = 18;
  const zA = 0.05;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    let z = zA + (zOut - zA) * Math.pow(Math.sin(Math.PI * u), 0.85);
    if (notches && i > 3 && i < N - 3 && i % 3 === 0) z -= 0.035;
    pts.push([(ym + hy * Math.cos(Math.PI * u)) * s, sign * z * s]);
  }
  for (let i = N - 2; i >= 2; i--) {
    const u = i / N;
    pts.push([(ym + hy * 0.78 * Math.cos(Math.PI * u)) * s, sign * (zA + (zIn - zA) * Math.pow(Math.sin(Math.PI * u), 0.9)) * s]);
  }
  return pts;
}

export function greatAxe(ctx: Ctx, f: WFrame, t: Tags, o: { size?: number } = {}): void {
  const s = f.s * (o.size ?? 1);
  const ym = 0.78; // head centre along the haft (ref m)
  // haft: ash shaft, leather grips for both hands, pommel and butt spike
  add(ctx, f, 'haft', rc(f.p(0, -0.34 * s, 0), f.p(0, (ym + 0.2) * s, 0), 0.036 * s, 0.033 * s), t.haft);
  add(ctx, f, 'wrap', rc(f.p(0, -0.16 * s, 0), f.p(0, 0.1 * s, 0), 0.045 * s, 0.045 * s), t.wrap, 0.003);
  add(ctx, f, 'wrap2', rc(f.p(0, 0.22 * s, 0), f.p(0, 0.46 * s, 0), 0.045 * s, 0.045 * s), t.wrap, 0.003);
  add(ctx, f, 'pommel', new Ellipsoid(f.p(0, -0.36 * s, 0), [0.058 * s, 0.05 * s, 0.058 * s]), t.metal, 0.004);
  add(ctx, f, 'butt', spike(f.p(0, -0.38 * s, 0), f.p(0, -0.56 * s, 0), 0.042 * s, 0.006 * s), t.metal, 0.006);
  // iron collars above / below the grips and langets running down from the head
  for (const y of [0.16, 0.52]) add(ctx, f, `collar${y}`, new Torus(f.p(0, y * s, 0), 0.052 * s, 0.015 * s, f.d(0, 1, 0)), t.metal, 0.004);
  for (const sx of [1, -1]) add(ctx, f, `langet${sx}`, rc(f.p(sx * 0.034 * s, (ym - 0.16) * s, 0), f.p(sx * 0.034 * s, (ym - 0.5) * s, 0), 0.015 * s, 0.011 * s), t.metal, 0.004);
  const fr: Frame = frameOf(f);
  // front bit (+z, edge side): big crescent; back bit (-z): smaller crescent
  const thick = (zOut: number) => (_y: number, z: number): number => {
    const k = Math.min(1, Math.max(0, (Math.abs(z) / s - 0.05) / (zOut - 0.05)));
    return (0.04 - 0.032 * Math.pow(k, 0.9)) * s;
  };
  add(ctx, f, 'bitF', new Slab(fr, crescent(1, ym, 0.34, 0.5, 0.2, s, true), thick(0.5), 0.005 * s, 0.05 * s), t.metal, 0.006);
  add(ctx, f, 'bitB', new Slab(fr, crescent(-1, ym, 0.26, 0.34, 0.15, s, false), thick(0.34), 0.005 * s, 0.05 * s), t.metal, 0.006);
  // eye block around the haft, top spear point, skull bosses on both faces
  add(ctx, f, 'eye', new Ellipsoid(f.p(0, ym * s, 0), [0.07 * s, 0.2 * s, 0.09 * s], f.q), t.metal, 0.008);
  add(ctx, f, 'top', spike(f.p(0, (ym + 0.16) * s, 0), f.p(0, (ym + 0.46) * s, 0), 0.046 * s, 0.006 * s), t.metal, 0.006);
  for (const sx of [1, -1]) add(ctx, f, `boss${sx}`, new Ellipsoid(f.p(sx * 0.065 * s, ym * s, 0.045 * s), [0.05 * s, 0.07 * s, 0.062 * s], f.q), t.bone, 0.006);
}

// ---------------------------------------------------------------------------------------------------------------------
// totem staff (orc shaman): gnarled staff topped by a huge horned beast skull (open maw, glowing eyes), a glowing orb in a bone cradle,
// plumes and rags hanging from the curled horns
export function totemStaff(ctx: Ctx, f: WFrame, t: Tags, o: { size?: number } = {}): void {
  const s = f.s * (o.size ?? 1);
  // thick gnarled shaft, ground-length so it reads as planted
  haft(ctx, f, t, -1.16, 0.8, 0.034, -0.1, 0.1, false);
  add(ctx, f, 'foot', rc(f.p(0, -1.2 * s, 0), f.p(0, -1.02 * s, 0), 0.03 * s, 0.05 * s), t.metal, 0.004);
  for (const y of [-0.55, 0.3, 0.6]) add(ctx, f, `lash${y}`, rc(f.p(0, (y - 0.04) * s, 0), f.p(0, (y + 0.04) * s, 0), 0.05 * s, 0.05 * s), t.wrap, 0.004);
  // knotty bulges
  add(ctx, f, 'knotA', el(f.p(0.012 * s, -0.22 * s, 0.01 * s), [0.055 * s, 0.08 * s, 0.05 * s]), t.haft, 0.01);
  add(ctx, f, 'knotB', el(f.p(-0.012 * s, 0.08 * s, -0.01 * s), [0.05 * s, 0.07 * s, 0.05 * s]), t.haft, 0.01);
  const yc = 1.0;
  // staff-axis point (collar, cup) and skull-local point: the skull is pitched forward (snout down) about its centre
  const qa = (x: number, y: number, z: number): Vec3 => f.p(x * s, (yc + y) * s, z * s);
  const pitch = 0.3, cp = Math.cos(pitch), sp = Math.sin(pitch);
  const q = (x: number, y: number, z: number): Vec3 => f.p(x * s, (yc + y * cp - z * sp) * s, (y * sp + z * cp) * s);
  // oriented ellipsoid in skull axes (x lateral, y up, z snout)
  const rq = qmul(f.q, qx(pitch));
  const E = (x: number, y: number, z: number, rx: number, ry: number, rz: number): Sdf => new Ellipsoid(q(x, y, z), [rx * s, ry * s, rz * s], rq);
  const bone = (name: string, sdf: Sdf, w = 0.008): void => add(ctx, f, name, sdf, t.bone, w);
  // lashed collar + bone ring under the skull
  add(ctx, f, 'collar', rc(qa(0, -0.27, 0), qa(0, -0.06, -0.02), 0.05 * s, 0.075 * s), t.wrap, 0.006);
  add(ctx, f, 'collarRing', new Torus(qa(0, -0.13, -0.01), 0.07 * s, 0.015 * s, f.d(0, 1, 0)), t.bone, 0.004);
  // ---- the skull: snout forward, jaw hanging open
  bone('cranium', E(0, 0.03, -0.03, 0.12, 0.11, 0.13), 0.012);
  bone('brow', E(0, 0.075, 0.07, 0.115, 0.05, 0.07), 0.012);
  for (const sx of [-1, 1]) bone(`cheek${sx}`, E(sx * 0.085, -0.01, 0.075, 0.045, 0.045, 0.075));
  bone('muzzle', rc(q(0, 0.0, 0.09), q(0, -0.03, 0.22), 0.07 * s, 0.055 * s));
  bone('nose', E(0, -0.03, 0.235, 0.058, 0.045, 0.045));
  bone('jaw', rc(q(0, -0.08, 0.0), q(0, -0.15, 0.17), 0.05 * s, 0.034 * s));
  bone('chin', E(0, -0.155, 0.19, 0.05, 0.028, 0.045));
  for (const sx of [-1, 1]) bone(`fang${sx}`, spike(q(sx * 0.045, -0.06, 0.17), q(sx * 0.05, -0.13, 0.185), 0.024 * s, 0.006 * s), 0.004);
  // deep eye sockets carved into the bone, a glowing eye in each
  for (const sx of [-1, 1]) {
    ctx.cut(`prop_socket${sx}`, new Sphere(q(sx * 0.08, 0.04, 0.122), 0.044 * s), f.bone, { tags: t.bone, w: 0.006 });
    ctx.late(`prop_eye${sx}`, new Sphere(q(sx * 0.076, 0.04, 0.1), 0.028 * s), f.bone, { tags: t.glow, w: 0.002 });
  }
  // lyre horns sweeping out and up either side of the orb (blunt tips: anything under ~2 voxels shatters in the mesher)
  for (const sx of [-1, 1]) {
    const P = ([[0.1, 0.08, -0.03], [0.22, 0.1, -0.06], [0.31, 0.2, -0.06], [0.34, 0.33, -0.05], [0.32, 0.44, -0.03]] as const).map(([x, y, z]) => q(sx * x, y, z));
    bone(`horn${sx}`, tube(P, [[0, 0.06 * s], [0.35, 0.05 * s], [0.75, 0.036 * s], [1, 0.02 * s]], { segments: 8, w: 0.012 * s }), 0.01);
  }
  // glowing orb seated in a bone cup on the crown
  bone('cup', rc(q(0, 0.1, -0.04), q(0, 0.2, -0.04), 0.05 * s, 0.075 * s), 0.01);
  add(ctx, f, 'orb', new Sphere(q(0, 0.3, -0.04), 0.075 * s), t.glow, 0.006);
  // two bundles of long feathers tied to each horn
  for (const sx of [-1, 1]) {
    for (const [dx, dz, len, hw] of [[0.26, -0.06, 0.5, 0.05], [0.29, 0.0, 0.38, 0.045]] as const) {
      add(ctx, f, `plume${sx}_${dz}`, feather(q(sx * dx, 0.15, dz), q(sx * (dx + 0.04), 0.15 - len, dz - 0.04), hw * s, 0.022 * s, f.d(1, 0, 0)), t.cloth, 0.006);
    }
  }
  void vadd; void vscale; void flatCone; void plume;
}

// ---------------------------------------------------------------------------------------------------------------------
// monk spear (ascetic): long shaft, leaf blade, red tassel
export function monkSpear(ctx: Ctx, f: WFrame, t: Tags, o: { size?: number } = {}): void {
  const s = f.s * (o.size ?? 1);
  haft(ctx, f, t, -0.5, 1.7, 0.021, -0.1, 0.1, false);
  const fr = frameOf(f);
  const yb = 1.66 * s;
  const outline: [number, number][] = [
    [yb, 0.0],
    [yb + 0.08 * s, 0.045 * s],
    [yb + 0.22 * s, 0.062 * s],
    [yb + 0.4 * s, 0.03 * s],
    [yb + 0.5 * s, 0.0],
    [yb + 0.4 * s, -0.03 * s],
    [yb + 0.22 * s, -0.062 * s],
    [yb + 0.08 * s, -0.045 * s],
  ];
  add(ctx, f, 'blade', new Slab(fr, outline, (y) => (0.022 - 0.014 * Math.min(1, Math.max(0, (y - yb) / (0.5 * s)))) * s, 0.003 * s, 0.024 * s), t.metal, 0.005);
  add(ctx, f, 'socket', new RoundCone(f.p(0, yb - 0.06 * s, 0), f.p(0, yb + 0.02 * s, 0), 0.03 * s, 0.026 * s), t.metal, 0.004);
  // tassel
  add(ctx, f, 'tassel', new RoundCone(f.p(0.02 * s, yb - 0.04 * s, 0), f.p(0.06 * s, yb - 0.3 * s, -0.04 * s), 0.03 * s, 0.012 * s), t.cloth, 0.004);
  add(ctx, f, 'butt', spike(f.p(0, -0.5 * s, 0), f.p(0, -0.62 * s, 0), 0.026 * s, 0.01 * s), t.metal, 0.004);
}

void rbox; void rc;

/** slab frame for blades whose cutting edge lies along weapon +X (outline plane = weapon Y/X, thickness along weapon Z): hatchet, cleaver */
function edgeXFrame(f: WFrame): Frame {
  return { o: f.p(0, 0, 0), x: f.d(0, 0, 1), y: f.d(0, 1, 0), z: f.d(1, 0, 0) };
}

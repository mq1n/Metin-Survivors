// Arthropod key points. Metres, +Z forward, +Y up, +X = the creature's LEFT. Left side is authored; the right mirrors X.
// Everything is derived from the params so variants of a family share one anatomy.
import { type Vec3, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import type { BeetleParams, ScorpionParams } from './params.ts';

/** One walking leg. `foot` exists for 3-bone legs (beetle); 2-bone legs (scorpion) end at `tip` with a rigid tarsus. */
export interface LegSpec {
  id: string;
  side: 1 | -1;
  row: number;
  parent: string;
  upper: string;
  lower: string;
  foot?: string;
  hip: Vec3;
  knee: Vec3;
  ankle: Vec3;
  tip: Vec3;
}

export interface PalpSpec {
  side: 1 | -1;
  shoulder: Vec3;
  elbow: Vec3;
  wrist: Vec3;
  /** unit direction the hand points along (ground plane) */
  hand: Vec3;
  /** palm centre and radii (along hand, lateral, vertical) */
  palm: Vec3;
  palmR: Vec3;
  /** fixed finger path (base .. tip) */
  fixed: Vec3[];
  /** moving finger path (pivot .. tip) at the rest opening */
  moving: Vec3[];
  pivot: Vec3;
}

export interface ScorpionAnatomy {
  family: 'scorpion';
  s: number;
  p: ScorpionParams;
  chest: Vec3;
  back: Vec3;
  prosoma: { c: Vec3; r: Vec3; frontC: Vec3; frontR: Vec3 };
  plates: { z: number; y: number; hw: number; ry: number; rz: number }[];
  tail: Vec3[];
  tailR: number[];
  telson: { c: Vec3; r: number; sting: Vec3[]; stingR: number[] };
  /** centre of the tail arch (for outward normals) */
  arch: Vec3;
  palps: PalpSpec[];
  legs: LegSpec[];
}

export interface BeetleAnatomy {
  family: 'beetle';
  s: number;
  p: BeetleParams;
  chest: Vec3;
  head: Vec3;
  back: Vec3;
  elytraHinge: Vec3;
  pronotum: { c: Vec3; r: Vec3 };
  elytra: { c: Vec3; r: Vec3 };
  abdomen: { c: Vec3; r: Vec3 };
  skull: { c: Vec3; r: Vec3 };
  eye: { c: Vec3; r: Vec3 };
  antenna: Vec3[];
  mandible: { path: Vec3[]; r: number[] };
  horn: { path: Vec3[]; r: number[] };
  crystals: { base: Vec3; dir: Vec3; len: number; r: number; bone: 'crest_f' | 'crest_m' | 'crest_r'; kind: 'main' | 'side' }[];
  legs: LegSpec[];
}

export type Anatomy = ScorpionAnatomy | BeetleAnatomy;

const mirror = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];

export function scorpionAnatomy(p: ScorpionParams): ScorpionAnatomy {
  const s = p.scale;
  const st = p.stance;
  const bw = p.bodyWidth;
  const bl = p.bodyLength;
  const V = (x: number, y: number, z: number): Vec3 => [x * s, y * st * s, z * s];
  // ---- body: prosoma (carapace) + 7 mesosoma plates
  const prosoma = {
    c: V(0, 0.29, 0.17),
    r: [0.27 * bw * s, 0.122 * st * s, 0.27 * s] as Vec3,
    frontC: V(0, 0.278, 0.35),
    frontR: [0.17 * bw * s, 0.078 * st * s, 0.13 * s] as Vec3,
  };
  const hws = [0.27, 0.278, 0.272, 0.255, 0.23, 0.2, 0.165];
  const plates = hws.map((hw, k) => ({
    z: (-0.08 - 0.09 * bl * k) * s,
    y: (0.298 - 0.004 * k) * st * s,
    hw: hw * bw * s,
    ry: (0.118 - 0.004 * k) * st * s,
    rz: 0.068 * bl * s,
  }));
  const zEnd = plates[6]!.z - plates[6]!.rz;

  // ---- metasoma: arching tail, joints J1..J6 (YZ plane). Tail bones sit at J1..J5.
  const tl = p.tailLength;
  const ta = p.tailArch;
  const base: Vec3 = [0, 0.29 * st * s, zEnd + 0.03 * s];
  const rel: [number, number][] = [[0.12, -0.12], [0.19, -0.04], [0.19, 0.06], [0.14, 0.14], [0.05, 0.16]];
  const tail: Vec3[] = [base];
  for (const [dy, dz] of rel) {
    const last = tail[tail.length - 1]!;
    tail.push([0, last[1] + dy * tl * ta * s, last[2] + dz * tl * s]);
  }
  const tailR = [0.092, 0.086, 0.079, 0.072, 0.065, 0.058].map((r) => r * p.tailThick * s);
  const j6 = tail[5]!;
  const dir5 = vnorm(vsub(tail[5]!, tail[4]!));
  const tc: Vec3 = vadd(j6, vscale(dir5, 0.05 * s));
  const stingPts: Vec3[] = [
    vadd(tc, [0, 0.0, 0.015 * s]),
    vadd(tc, [0, 0.015 * s, 0.1 * s]),
    vadd(tc, [0, 0.0, 0.2 * s]),
    vadd(tc, [0, -0.07 * s, 0.275 * s]),
    vadd(tc, [0, -0.17 * s, 0.305 * s]),
  ];
  const telson = { c: tc, r: 0.082 * p.tailThick * s, sting: stingPts, stingR: [0.058, 0.05, 0.04, 0.026, 0.006].map((r) => r * p.tailThick * s) };
  const arch: Vec3 = [0, (tail[2]![1] + tail[3]![1]) * 0.5 - 0.02 * s, (tail[2]![2] + tail[4]![2]) * 0.5 + 0.03 * s];

  // ---- pedipalps (pincers): big and chunky, the silhouette read from the game camera
  const cs = p.clawSize;
  const open = p.clawOpen;
  const palps: PalpSpec[] = [];
  {
    const S = V(0.2 * bw, 0.272, 0.4);
    const rel2 = (v: Vec3): Vec3 => vadd(S, vscale(v, cs * s));
    const E = rel2([0.2, -0.02, 0.1]);
    const W = rel2([0.26, -0.03, 0.22]);
    const hand = vnorm([-0.36, 0, 0.93]);
    const palm = vadd(W, vscale(hand, 0.125 * cs * s));
    // palm radii: [lateral, vertical, along the hand]
    const palmR: Vec3 = [0.125 * cs * s, 0.09 * cs * s * st, 0.165 * cs * s];
    const side: Vec3 = [hand[2], 0, -hand[0]]; // lateral, pointing outward (+x for the left side)
    const along = (t: number, lat: number, yy = 0): Vec3 => vadd(vadd(W, vscale(hand, t * cs * s)), vadd(vscale(side, lat * cs * s), [0, yy * s, 0]));
    // fixed finger: outer, sweeps inward; moving finger: inner, hinged at the palm front, tip near the fixed tip
    const fixed: Vec3[] = [along(0.18, 0.06), along(0.3, 0.095), along(0.4, 0.09), along(0.49, 0.054), along(0.56, 0.005)];
    const pivot = along(0.2, -0.076);
    const gap = 0.18 * open;
    const moving: Vec3[] = [pivot, along(0.31, -0.12 - gap * 0.25), along(0.41, -0.132 - gap * 0.55), along(0.5, -0.11 - gap * 0.8), along(0.555, -0.05 - gap)];
    palps.push({ side: 1, shoulder: S, elbow: E, wrist: W, hand, palm, palmR, fixed, moving, pivot });
    const m = (v: Vec3): Vec3 => mirror(v);
    palps.push({ side: -1, shoulder: m(S), elbow: m(E), wrist: m(W), hand: m(hand), palm: m(palm), palmR, fixed: fixed.map(m), moving: moving.map(m), pivot: m(pivot) });
  }

  // ---- legs: 4 rows; rest chains hip -> knee -> ankle -> tip (2-bone legs: femur hip..knee, tibia knee..tip)
  const hipZ = [0.3, 0.185, 0.07, -0.05];
  const legDef: { hx: number; kx: number; kz: number; kh: number; ax: number; az: number; tx: number; tz: number }[] = [
    { hx: 0.23, kx: 0.46, kz: 0.46, kh: 0.42, ax: 0.6, az: 0.6, tx: 0.65, tz: 0.67 },
    { hx: 0.26, kx: 0.52, kz: 0.3, kh: 0.44, ax: 0.68, az: 0.37, tx: 0.73, tz: 0.41 },
    { hx: 0.26, kx: 0.52, kz: -0.03, kh: 0.44, ax: 0.68, az: -0.13, tx: 0.73, tz: -0.18 },
    { hx: 0.22, kx: 0.46, kz: -0.26, kh: 0.41, ax: 0.58, az: -0.48, tx: 0.63, tz: -0.57 },
  ];
  const legs: LegSpec[] = [];
  for (const sd of [1, -1] as const) {
    legDef.forEach((d, row) => {
      const mk = (x: number, y: number, z: number): Vec3 => [sd * x * s, y, z * s];
      const hip = mk(d.hx * bw, 0.215 * st * s, hipZ[row]!);
      const knee = mk(d.kx * Math.sqrt(bw), d.kh * st * s, d.kz);
      const ankle = mk(d.ax, 0.13 * s, d.az);
      const tip = mk(d.tx, 0.006 * s, d.tz);
      const name = `${sd === 1 ? 'l' : 'r'}${row + 1}`;
      legs.push({ id: name, side: sd, row, parent: 'chest', upper: `${name}_femur`, lower: `${name}_tibia`, hip, knee, ankle, tip });
    });
  }
  return {
    family: 'scorpion', s, p,
    chest: prosoma.c,
    back: V(0, 0.28, -0.06),
    prosoma, plates, tail, tailR, telson, arch, palps, legs,
  };
}

export function beetleAnatomy(p: BeetleParams): BeetleAnatomy {
  const s = p.scale;
  const st = p.stance;
  const bw = p.bodyWidth;
  const bl = p.bodyLength;
  const bh = p.bodyHeight;
  const V = (x: number, y: number, z: number): Vec3 => [x * s, y * s, z * s];
  const lift = (st - 1) * 0.2;
  const Y = (y: number): number => y + lift;
  const chest = V(0, Y(0.3), 0.22);
  const head = V(0, Y(0.26), 0.47);
  const back = V(0, Y(0.3), -0.02);
  const elytraHinge = V(0, Y(0.43), 0.1);
  const pronotum = { c: V(0, Y(0.335), 0.27), r: V(0.245 * bw, 0.11 * bh, 0.2) };
  const elytra = { c: V(0.125 * bw, Y(0.31), -0.17 * bl - 0.01), r: V(0.168 * bw, 0.19 * bh, 0.4 * bl) };
  const abdomen = { c: V(0, Y(0.235), -0.29 * bl), r: V(0.2 * bw, 0.11 * bh, 0.3 * bl) };
  const skull = { c: V(0, Y(0.265), 0.6), r: V(0.14, 0.1, 0.15) };
  const eye = { c: V(0.105, Y(0.318), 0.655), r: V(0.054, 0.052, 0.062) };
  const antenna: Vec3[] = [V(0.07, Y(0.37), 0.7), V(0.12, Y(0.46), 0.78), V(0.17, Y(0.53), 0.84), V(0.21, Y(0.56), 0.88), V(0.24, Y(0.56), 0.91)];
  const mg = p.mandible;
  const mandible = {
    path: [V(0.09, Y(0.21), 0.68), V(0.17, Y(0.19), 0.68 + 0.14 * mg), V(0.15, Y(0.17), 0.68 + 0.3 * mg), V(0.07, Y(0.17), 0.68 + 0.4 * mg)],
    r: [0.056, 0.046, 0.03, 0.006].map((r) => r * s),
  };
  const hl = p.hornLength;
  const hz = (z: number): number => 0.52 + (z - 0.52) * hl;
  const hornPath: Vec3[] = [V(0.13, Y(0.4), 0.52), V(0.22, Y(0.46), hz(0.68)), V(0.27, Y(0.52), hz(0.88)), V(0.21, Y(0.52), hz(1.05)), V(0.1, Y(0.48), hz(1.18))];
  const horn = { path: hornPath, r: [0.07, 0.058, 0.044, 0.03, 0.004].map((r) => r * s) };

  // dorsal fan: a tall centre line fanning front->rear, with outward-leaning pairs on both sides (the 3/4-top camera silhouette)
  const crystals: BeetleAnatomy['crystals'] = [];
  const n = Math.max(3, Math.round(p.crystals));
  const ch = p.crystalHeight;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const z = 0.2 - t * 0.64 * bl;
    const a = 0.55 - t * 1.1; // lean: forward at the front, backward at the rear
    const hump = Math.sin(Math.PI * (0.08 + 0.84 * t));
    const len = (0.24 + 0.34 * hump) * ch;
    const r = (0.04 + 0.032 * hump) * s;
    const bone = t < 0.33 ? 'crest_f' : t < 0.7 ? 'crest_m' : 'crest_r';
    crystals.push({ base: V(0, Y(0.41) - 0.03 * (1 - hump), z), dir: vnorm([0, Math.cos(a), Math.sin(a)]), len: len * s, r, bone, kind: 'main' });
    if (i > 0 && i < n - 1) {
      for (const sx of [1, -1]) {
        const lean = 0.62 + 0.25 * (1 - hump);
        crystals.push({ base: V(sx * 0.085 * bw, Y(0.4) - 0.02 * (1 - hump), z + 0.015), dir: vnorm([sx * Math.sin(lean), Math.cos(lean) * Math.cos(a * 0.7), Math.cos(lean) * Math.sin(a * 0.7)]), len: len * 0.74 * s, r: r * 0.78, bone, kind: 'side' });
      }
    }
  }

  const legs: LegSpec[] = [];
  const rows = [
    { z: 0.3, hx: 0.18, kx: 0.46, kz: 0.46, ax: 0.63, az: 0.68, tx: 0.69, tz: 0.84 },
    { z: 0.085, hx: 0.2, kx: 0.5, kz: 0.12, ax: 0.69, az: 0.17, tx: 0.75, tz: 0.22 },
    { z: -0.15, hx: 0.19, kx: 0.45, kz: -0.28, ax: 0.61, az: -0.52, tx: 0.66, tz: -0.65 },
  ];
  for (const sd of [1, -1] as const) {
    rows.forEach((d, row) => {
      const mk = (x: number, y: number, z: number): Vec3 => [sd * x * s, y * s, z * s];
      const name = `${sd === 1 ? 'l' : 'r'}${row + 1}`;
      const hip = mk(d.hx * bw, Y(0.215), d.z);
      const knee = mk(d.kx, Y(0.43) + 0.02 * st, d.kz);
      const ankle = mk(d.ax, 0.11 + lift * 0.4, d.az);
      const tip = mk(d.tx, 0.008, d.tz);
      legs.push({ id: name, side: sd, row, parent: 'chest', upper: `${name}_femur`, lower: `${name}_tibia`, foot: `${name}_tarsus`, hip, knee, ankle, tip });
    });
  }
  return { family: 'beetle', s, p, chest, head, back, elytraHinge, pronotum, elytra, abdomen, skull, eye, antenna, mandible, horn, crystals, legs };
}

export function computeAnatomy(p: ScorpionParams | BeetleParams): ScorpionAnatomy | BeetleAnatomy {
  return p.family === 'scorpion' ? scorpionAnatomy(p) : beetleAnatomy(p);
}

export { vlerp, mirror };

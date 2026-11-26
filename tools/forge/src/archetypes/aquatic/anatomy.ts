// Aquatic key points (metres, +Z forward, +Y up, +X = the animal's LEFT). Orca/killer-whale mass hovering ~0.28 m above the
// ground on two paddle-fins; the spine rises toward the flukes so the tail rides high. Everything is derived from the params

// arm-like pectoral fins reaching the ground) — dimensions only, the geometry is original.
import type { Vec3 } from '../../core/math.ts';
import { smoothstep } from '../../core/math.ts';
import type { AquaticParams } from './params.ts';

export interface Station {
  z: number;
  cy: number;
  hw: number;
  hh: number;
  /** half length of the slice ellipsoid along z */
  hl: number;
  /** nose-up pitch of the slice (radians) following the rising spine */
  pitch: number;
  bone: string;
}

export interface FinRest {
  /** shoulder, elbow, wrist (ground contact), paddle tip */
  S: Vec3;
  E: Vec3;
  W: Vec3;
  T: Vec3;
}

export interface Anatomy {
  s: number;
  p: AquaticParams;
  stations: Station[];
  chest: Vec3;
  neck: Vec3;
  head: Vec3;
  hinge: Vec3;
  spine: Vec3;
  tail1: Vec3;
  tail2: Vec3;
  tail3: Vec3;
  fluke: Vec3;
  /** left pectoral fin (mirror X for right) */
  pec: FinRest;
  /** left pelvic fin: root and tip */
  pel: { P0: Vec3; P1: Vec3 };
  dorsal: { d1: Vec3; d2: Vec3; tip: Vec3 };
  /** left fluke lobe pivot + tip */
  lobe: { L0: Vec3; L1: Vec3 };
  /** mouth line height (closed jaws meet here) */
  mouthY: number;
  /** interpolated torso centre / half extents at z */
  at(z: number): { cy: number; hw: number; hh: number };
  /** bone that owns torso slice at z */
  boneAt(z: number): string;
  /** nose tip */
  noseZ: number;
}

export function computeAnatomy(p: AquaticParams): Anatomy {
  const s = p.scale;
  const V = (x: number, y: number, z: number): Vec3 => [x * s, y * s, z * s];
  const joints = {
    chest: V(0, 0.69, 0.3),
    neck: V(0, 0.7, 0.6),
    head: V(0, 0.72, 0.8),
    hinge: V(0, 0.585, 0.78),
    spine: V(0, 0.68, -0.3),
    tail1: V(0, 0.69, -0.72),
    tail2: V(0, 0.73, -1.08),
    tail3: V(0, 0.8, -1.38),
    fluke: V(0, 0.87, -1.62),
  };

  // [z, centre y, half width, half height]
  const prof: [number, number, number, number][] = [
    [0.8, 0.72, 0.34, 0.34],
    [0.64, 0.71, 0.4, 0.38],
    [0.46, 0.7, 0.45, 0.405],
    [0.28, 0.69, 0.475, 0.415],
    [0.08, 0.68, 0.465, 0.415],
    [-0.14, 0.68, 0.435, 0.4],
    [-0.36, 0.68, 0.385, 0.365],
    [-0.58, 0.69, 0.315, 0.315],
    [-0.8, 0.7, 0.27, 0.285],
    [-1.0, 0.72, 0.215, 0.245],
    [-1.18, 0.75, 0.17, 0.2],
    [-1.36, 0.79, 0.13, 0.165],
    [-1.52, 0.83, 0.095, 0.13],
    [-1.66, 0.86, 0.065, 0.095],
  ];
  const at = (z: number): { cy: number; hw: number; hh: number } => {
    const zz = z / s;
    if (zz >= prof[0]![0]) return { cy: prof[0]![1] * s, hw: prof[0]![2] * s, hh: prof[0]![3] * s };
    const last = prof[prof.length - 1]!;
    if (zz <= last[0]) return { cy: last[1] * s, hw: last[2] * s, hh: last[3] * s };
    for (let i = 0; i < prof.length - 1; i++) {
      const a = prof[i]!, b = prof[i + 1]!;
      if (zz <= a[0] && zz >= b[0]) {
        const t = smoothstep(0, 1, (a[0] - zz) / (a[0] - b[0]));
        const m = (k: 1 | 2 | 3): number => (a[k]! + (b[k]! - a[k]!) * t) * s;
        return { cy: m(1), hw: m(2), hh: m(3) };
      }
    }
    return { cy: last[1] * s, hw: last[2] * s, hh: last[3] * s };
  };
  const boneAt = (z: number): string => {
    if (z >= joints.neck[2]) return 'neck';
    if (z >= joints.spine[2]) return 'chest';
    if (z >= joints.tail1[2]) return 'spine';
    if (z >= joints.tail2[2]) return 'tail1';
    if (z >= joints.tail3[2]) return 'tail2';
    if (z >= joints.fluke[2]) return 'tail3';
    return 'fluke';
  };
  const stations: Station[] = prof.map(([z, cy, hw, hh], i) => {
    const nx = prof[Math.min(i + 1, prof.length - 1)]!, pv = prof[Math.max(i - 1, 0)]!;
    const slope = (pv[1] - nx[1]) / (pv[0] - nx[0]); // dy/dz (negative where the spine rises toward the tail)
    const gap = Math.abs((pv[0] - nx[0]) / 2);
    return { z: z * s, cy: cy * s, hw: hw * s, hh: hh * s, hl: Math.max(gap * 0.95, 0.1) * s, pitch: Math.atan(slope), bone: boneAt(z * s) };
  });

  const fin = p.finSpan;
  const pec: FinRest = {
    S: V(0.4, 0.52, 0.36),
    E: V(0.4 + 0.3 * fin, 0.4, 0.34),
    W: V(0.4 + 0.38 * fin, 0.05, 0.2),
    T: V(0.4 + 0.6 * fin, 0.03, -0.04),
  };
  return {
    s,
    p,
    stations,
    ...joints,
    pec,
    pel: { P0: V(0.27, 0.4, -0.48), P1: V(0.55, 0.22, -0.66) },
    dorsal: { d1: V(0, 1.0, -0.2), d2: V(0, 1.26, -0.38), tip: V(0, 1.5, -0.66) },
    lobe: { L0: V(0.07, 0.87, -1.64), L1: V(0.8, 0.95, -2.04) },
    mouthY: 0.585 * s,
    at,
    boneAt,
    noseZ: 1.39 * s,
  };
}

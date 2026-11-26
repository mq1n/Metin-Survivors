
// (barrel torso, shoulder hump over the front legs, columnar limbs, plantigrade paws, head carried low, stub tail) —
// dimensions only, geometry is original. Everything is authored for scale 1 = hump height ~1.35 m and multiplied by `scale`.
import { type Vec3, qx, qrotate } from '../../core/math.ts';
import type { UrsineParams } from './params.ts';

export interface Station {
  name: string;
  bone: 'pelvis' | 'spine' | 'chest';
  z: number;
  y: number;
  hw: number;
  hh: number;
  /** half length along z */
  hl: number;
}

export interface Anatomy {
  s: number;
  p: UrsineParams;
  stations: Station[];
  /** top of the hump (back line at the highest point, before fur) */
  humpTop: number;
  pelvis: Vec3;
  spine: Vec3;
  chest: Vec3;
  neck: Vec3;
  /** head bone (occiput pivot) */
  head: Vec3;
  /** skull centre: head-local origin of every head part */
  skull: Vec3;
  /** head pitch in the rest pose (radians, nose down positive) */
  headPitch: number;
  /** head-local metres -> model space */
  headToWorld(v: Vec3): Vec3;
  /** left clavicle pivot */
  clav: Vec3;
  /** left front leg (mirror X for right) */
  front: { shoulder: Vec3; elbow: Vec3; wrist: Vec3 };
  /** left hind leg */
  hind: { hip: Vec3; stifle: Vec3; hock: Vec3; ball: Vec3 };
  tail: Vec3[];
  tailR: number[];
}

export function computeAnatomy(p: UrsineParams): Anatomy {
  const s = p.scale;
  const L = p.bodyLength, G = p.girth, Ll = p.legLength;
  const lift = (Ll - 1) * 0.35;
  const zc = 0.3;
  const zz = (z0: number): number => (z0 > zc ? z0 : zc + (z0 - zc) * L);
  const hump = p.hump;

  const stations: Station[] = [
    { name: 'rump', bone: 'pelvis', z: zz(-0.72), y: 0.85 + lift, hw: 0.255 * G, hh: 0.285, hl: 0.2 },
    { name: 'hips', bone: 'pelvis', z: zz(-0.52), y: 0.865 + lift, hw: 0.29 * G, hh: 0.33, hl: 0.21 },
    { name: 'loin', bone: 'spine', z: zz(-0.3), y: 0.87 + lift, hw: 0.285 * G, hh: 0.315, hl: 0.21 },
    { name: 'belly', bone: 'spine', z: zz(-0.06), y: 0.85 + lift, hw: 0.3 * G, hh: 0.33, hl: 0.22 },
    { name: 'ribs', bone: 'chest', z: 0.16, y: 0.88 + lift, hw: 0.315 * G, hh: 0.36, hl: 0.24 },
    { name: 'chest', bone: 'chest', z: 0.38, y: 0.9 + lift, hw: 0.3 * G, hh: 0.37, hl: 0.22 },
    { name: 'brisket', bone: 'chest', z: 0.56, y: 0.86 + lift, hw: 0.23 * G, hh: 0.31, hl: 0.16 },
  ];
  const humpTop = 1.24 + lift + 0.04 * hump;

  const headPitch = 0.3;
  const skull: Vec3 = [0, 1.07 + lift, 0.97];
  const head: Vec3 = [0, 1.1 + lift, 0.85];
  const q = qx(headPitch);
  const headToWorld = (v: Vec3): Vec3 => {
    const r = qrotate(q, [v[0] * p.headScale, v[1] * p.headScale, v[2] * p.headScale]);
    return [(skull[0] + r[0]) * s, (skull[1] + r[1]) * s, (skull[2] + r[2]) * s];
  };

  const front = {
    shoulder: [0.27, 0.99 + lift, 0.42] as Vec3,
    elbow: [0.335, 0.58 + lift * 0.6, 0.27] as Vec3,
    wrist: [0.3, 0.165, 0.45] as Vec3,
  };
  const hz = zz(-0.6);
  const hind = {
    hip: [0.245, 0.85 + lift, hz] as Vec3,
    stifle: [0.3, 0.5 + lift * 0.6, hz + 0.14] as Vec3,
    hock: [0.25, 0.175, hz - 0.1] as Vec3,
    ball: [0.26, 0.05, hz + 0.1] as Vec3,
  };

  const tb: Vec3 = [0, stations[0]!.y + 0.06, stations[0]!.z - 0.14];
  const tl = p.tailLength;
  const tail: Vec3[] = [tb, [0, tb[1] - 0.025 * tl, tb[2] - 0.08 * tl], [0, tb[1] - 0.085 * tl, tb[2] - 0.16 * tl]];
  const tailR = [0.075, 0.06, 0.03];

  const sc = (v: Vec3): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
  return {
    s,
    p,
    stations: stations.map((st) => ({ ...st, z: st.z * s, y: st.y * s, hw: st.hw * s, hh: st.hh * s, hl: st.hl * s })),
    humpTop: humpTop * s,
    pelvis: sc([0, stations[1]!.y + 0.01, hz]),
    spine: sc([0, stations[3]!.y + 0.04, stations[3]!.z + 0.05]),
    chest: sc([0, stations[5]!.y + 0.06, 0.3]),
    neck: sc([0, 1.13 + lift, 0.58]),
    head: sc(head),
    skull: sc(skull),
    headPitch,
    headToWorld,
    clav: sc([0.1, 1.2 + lift, 0.4]),
    front: { shoulder: sc(front.shoulder), elbow: sc(front.elbow), wrist: sc(front.wrist) },
    hind: { hip: sc(hind.hip), stifle: sc(hind.stifle), hock: sc(hind.hock), ball: sc(hind.ball) },
    tail: tail.map(sc),
    tailR: tailR.map((r) => r * s),
  };
}

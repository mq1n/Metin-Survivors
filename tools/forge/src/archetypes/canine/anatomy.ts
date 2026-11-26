// Canine key points. Everything is derived from CanineParams so variants share one anatomy.

// wide shoulders, long digitigrade hind legs, huge paws, long hanging tail) — dimensions only, geometry is original.
import type { Vec3 } from '../../core/math.ts';
import type { CanineParams } from './params.ts';

export interface Station {
  name: string;
  /** bone this torso slice follows */
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
  p: CanineParams;
  stations: Station[];
  /** back line height at the withers */
  withersY: number;
  pelvis: Vec3;
  spine: Vec3;
  chest: Vec3;
  neck: Vec3;
  head: Vec3;
  jaw: Vec3;
  /** left front leg (mirror X for right) */
  front: { shoulder: Vec3; elbow: Vec3; wrist: Vec3; toe: Vec3 };
  /** left hind leg */
  hind: { hip: Vec3; stifle: Vec3; hock: Vec3; fetlock: Vec3; toe: Vec3 };
  tail: Vec3[];
  tailR: number[];
  /** fan tails (see CanineParams.tails): 4 points each, bones at points 0 and 2, fan angle theta (rad) */
  extraTails: { path: Vec3[]; theta: number }[];
  /** head pitch (radians, nose down positive) in rest pose */
  headPitch: number;
}

export function computeAnatomy(p: CanineParams): Anatomy {
  const s = p.scale;
  const L = p.bodyLength;
  const lift = (p.legLength - 1) * 0.2;
  const zc = 0.30;
  const zz = (z0: number): number => (z0 > zc ? z0 : zc + (z0 - zc) * L);
  const hump = p.hump;
  const drop = 0.045 * p.crouch;
  const cd = p.chestDepth, cw = p.chestWidth;

  const stations: Station[] = [
    { name: 'rump', bone: 'pelvis', z: zz(-0.50), y: 0.61 - drop + lift, hw: 0.088, hh: 0.12, hl: 0.14 },
    { name: 'hips', bone: 'pelvis', z: zz(-0.37), y: 0.625 - drop + lift, hw: 0.108, hh: 0.15, hl: 0.15 },
    { name: 'loin', bone: 'spine', z: zz(-0.21), y: 0.61 - drop + lift, hw: 0.1, hh: 0.13, hl: 0.15 },
    { name: 'flank', bone: 'spine', z: zz(-0.05), y: 0.605 - drop + lift + hump * 0.01, hw: 0.112, hh: 0.14 * cd, hl: 0.15 },
    { name: 'ribs', bone: 'chest', z: zz(0.10), y: 0.60 - drop + lift + hump * 0.02, hw: 0.138 * cw, hh: 0.175 * cd + hump * 0.01, hl: 0.16 },
    { name: 'chest', bone: 'chest', z: 0.26, y: 0.60 - drop + lift + hump * 0.03, hw: 0.148 * cw, hh: 0.195 * cd + hump * 0.02, hl: 0.16 },
    { name: 'front', bone: 'chest', z: 0.40, y: 0.615 - drop + lift + hump * 0.03, hw: 0.122 * cw, hh: 0.16 * cd, hl: 0.12 },
  ];

  const withersY = stations[5]!.y + stations[5]!.hh;

  const neckLen = p.neckLength;
  const neck: Vec3 = [0, 0.68 - drop + lift + hump * 0.04, 0.42];
  // head carried low-ish (stalking), nose down
  const head: Vec3 = [0, neck[1] + 0.03 * neckLen, neck[2] + 0.22 * neckLen];
  const headPitch = 0.26;
  const jaw: Vec3 = [0, head[1] - 0.05 * p.headScale, head[2] + 0.03 * p.headScale];

  const legL = p.legLength;
  const front = {
    shoulder: [0.115, 0.62 - drop + lift + hump * 0.02, 0.31] as Vec3,
    elbow: [0.122, 0.39 * legL + lift * 0.4, 0.15 - 0.02 * p.crouch] as Vec3,
    wrist: [0.115, 0.155 * legL, 0.3 + 0.015 * p.crouch] as Vec3,
    toe: [0.115, 0.0, 0.44] as Vec3,
  };
  const hz = zz(-0.38);
  const hind = {
    hip: [0.104, 0.64 - drop + lift, hz] as Vec3,
    stifle: [0.124, (0.43 - 0.02 * p.crouch) * legL + lift * 0.5, hz + 0.075 + 0.03 * p.crouch] as Vec3,
    hock: [0.106, (0.272 + 0.01 * p.crouch) * legL, hz - 0.085 - 0.03 * p.crouch] as Vec3,
    fetlock: [0.102, 0.065 * p.paw, hz - 0.045] as Vec3,
    toe: [0.102, 0.0, hz + 0.075] as Vec3,
  };

  // tail: base on the rump, hanging back/down (reference tail hangs to hock height then flicks back); curl lifts the far end
  const tb: Vec3 = [0, stations[0]!.y + 0.03, stations[0]!.z - 0.04];
  const tl = p.tailLength;
  const curl = p.tailCurl;
  const base: [number, number][] = [
    [0, 0],
    [-0.12, -0.065],
    [-0.23, -0.17],
    [-0.35, -0.26],
    [-0.5, -0.30],
  ];
  const lifts = [0, 0.03, 0.15, 0.32, 0.5];
  const tail: Vec3[] = base.map(([dz, dy], i) => [0, tb[1] + dy * tl + curl * lifts[i]! * (0.5 + 0.5 * tl), tb[2] + dz * tl]);
  const tailR = [0.044, 0.08, 0.104, 0.086, 0.042, 0.006].map((r) => r * p.tailThick);

  const sc = (v: Vec3): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
  const extraTails: { path: Vec3[]; theta: number }[] = [];
  const nT = p.tails ?? 1;
  if (nT > 1) {
    const half = (nT - 1) / 2;
    const step = 2.4 / half;
    for (let j = -half; j <= half; j++) {
      if (j === 0) continue;
      const theta = j * step * 0.5;
      const psi0 = 0.3 + 0.35 * (1 - Math.abs(j) / half) + (Math.abs(j) % 2 === 0 ? 0.32 : 0);
      const path: Vec3[] = [[0, tb[1] + 0.01, tb[2] - 0.01]];
      const L = 0.4 * tl;
      for (let i = 1; i <= 3; i++) {
        const psi = psi0 + 0.1 * i - 0.05 * i * i * 0.5;
        const prev = path[i - 1]!;
        path.push([prev[0] + L * Math.sin(theta) * Math.cos(psi), prev[1] + L * Math.sin(psi), prev[2] - L * Math.cos(theta) * Math.cos(psi)]);
      }
      extraTails.push({ path: path.map(sc), theta });
    }
  }
  return {
    s,
    p,
    stations: stations.map((st) => ({ ...st, z: st.z * s, y: st.y * s, hw: st.hw * s, hh: st.hh * s, hl: st.hl * s })),
    withersY: withersY * s,
    pelvis: sc([0, stations[1]!.y + 0.02, stations[1]!.z]),
    spine: sc([0, stations[3]!.y + 0.01, stations[3]!.z]),
    chest: sc([0, stations[5]!.y + 0.02, stations[5]!.z - 0.02]),
    neck: sc(neck),
    head: sc(head),
    jaw: sc(jaw),
    front: { shoulder: sc(front.shoulder), elbow: sc(front.elbow), wrist: sc(front.wrist), toe: sc(front.toe) },
    hind: { hip: sc(hind.hip), stifle: sc(hind.stifle), hock: sc(hind.hock), fetlock: sc(hind.fetlock), toe: sc(hind.toe) },
    tail: tail.map(sc),
    tailR: tailR.map((r) => r * s),
    extraTails,
    headPitch,
  };
}

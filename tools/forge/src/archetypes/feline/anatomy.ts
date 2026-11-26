// Feline key points. Metres, +Z forward, +Y up, +X = the animal's LEFT. Everything derives from FelineParams so tiger / fire tiger /

// huge forepaws, long ringed tail) — dimensions only, geometry is original.
import type { Vec3 } from '../../core/math.ts';
import type { FelineParams } from './params.ts';

export interface Station {
  name: string;
  bone: 'pelvis' | 'spine' | 'chest';
  z: number;
  y: number;
  hw: number;
  hh: number;
  hl: number;
}

export interface Anatomy {
  s: number;
  p: FelineParams;
  stations: Station[];
  /** top of the shoulder blades */
  withersY: number;
  pelvis: Vec3;
  spine: Vec3;
  chest: Vec3;
  neck: Vec3;
  head: Vec3;
  jaw: Vec3;
  front: { shoulder: Vec3; elbow: Vec3; wrist: Vec3; fetlock: Vec3; toe: Vec3 };
  hind: { hip: Vec3; stifle: Vec3; hock: Vec3; fetlock: Vec3; toe: Vec3 };
  tail: Vec3[];
  tailR: number[];
  /** number of tail bones */
  tailBones: number;
  headPitch: number;
}

export function computeAnatomy(p: FelineParams): Anatomy {
  const s = p.scale;
  const L = p.bodyLength;
  const lift = (p.legLength - 1) * 0.3;
  const zc = 0.4;
  const zz = (z0: number): number => (z0 > zc ? z0 : zc + (z0 - zc) * L);
  const dropF = 0.075 * p.crouch;
  const dropR = 0.02 * p.crouch;
  const cd = p.chestDepth, cw = p.chestWidth;
  const sr = p.shoulderRise;

  const stations: Station[] = [
    { name: 'rump', bone: 'pelvis', z: zz(-0.93), y: 0.74 - dropR + lift, hw: 0.225, hh: 0.225, hl: 0.2 },
    { name: 'hips', bone: 'pelvis', z: zz(-0.72), y: 0.78 - dropR + lift, hw: 0.285, hh: 0.27, hl: 0.21 },
    { name: 'loin', bone: 'spine', z: zz(-0.43), y: 0.75 - dropR * 0.5 + lift, hw: 0.235, hh: 0.235, hl: 0.22 },
    { name: 'flank', bone: 'spine', z: zz(-0.17), y: 0.72 - dropF * 0.3 + lift, hw: 0.255, hh: 0.25 * cd, hl: 0.22 },
    { name: 'ribs', bone: 'chest', z: zz(0.1), y: 0.71 - dropF * 0.55 + lift, hw: 0.305 * cw, hh: 0.31 * cd, hl: 0.22 },
    { name: 'chest', bone: 'chest', z: 0.36, y: 0.7 - dropF * 0.8 + lift, hw: 0.315 * cw, hh: 0.34 * cd, hl: 0.22 },
    { name: 'front', bone: 'chest', z: 0.55, y: 0.72 - dropF + lift, hw: 0.25 * cw, hh: 0.27 * cd, hl: 0.15 },
  ];

  const st5 = stations[5]!;
  const withersY = st5.y + st5.hh + 0.07 * sr;

  const neckLen = p.neckLength;
  const neck: Vec3 = [0, 0.78 - dropF * 0.85 + lift, 0.6];
  const head: Vec3 = [0, neck[1] - 0.045 - 0.03 * neckLen, neck[2] + 0.3 * neckLen];
  const headPitch = 0.26 + 0.12 * p.crouch;
  const hs = p.headScale;
  const jaw: Vec3 = [0, head[1] - 0.075 * hs, head[2] - 0.025 * hs];

  const legL = p.legLength;
  const front = {
    shoulder: [0.2, 0.78 - dropF + lift, 0.4] as Vec3,
    elbow: [0.235, 0.43 * legL + lift * 0.5 - dropF * 0.3, 0.255 - 0.03 * p.crouch] as Vec3,
    wrist: [0.205, 0.168 * legL, 0.375 + 0.03 * p.crouch] as Vec3,
    fetlock: [0.205, 0.062 * p.paw, 0.47 + 0.03 * p.crouch] as Vec3,
    toe: [0.205, 0, 0.62] as Vec3,
  };
  const hz = zz(-0.7);
  const hind = {
    hip: [0.2, 0.78 - dropR + lift, hz] as Vec3,
    stifle: [0.255, (0.5 - 0.03 * p.crouch) * legL + lift * 0.5, hz + 0.2 + 0.03 * p.crouch] as Vec3,
    hock: [0.215, (0.27 + 0.01 * p.crouch) * legL, hz - 0.12 - 0.04 * p.crouch] as Vec3,
    fetlock: [0.208, 0.07 * p.paw, hz - 0.055] as Vec3,
    toe: [0.208, 0, hz + 0.1] as Vec3,
  };

  // tail: leaves the rump low, sweeps back in a soft S; curl lifts the far end
  const tb: Vec3 = [0, stations[0]!.y + 0.05, stations[0]!.z - 0.1];
  const tl = p.tailLength;
  const curl = p.tailCurl;
  const base: [number, number][] = [
    [0, 0],
    [-0.17, -0.025],
    [-0.36, -0.11],
    [-0.58, -0.2],
    [-0.79, -0.2],
    [-0.98, -0.09],
  ];
  const lifts = [0, 0.02, 0.1, 0.24, 0.46, 0.74];
  const tail: Vec3[] = base.map(([dz, dy], i) => [0, tb[1] + dy * tl + curl * lifts[i]! * (0.6 + 0.4 * tl), tb[2] + dz * tl]);
  const tailR = [0.072, 0.082, 0.079, 0.07, 0.06, 0.05, 0.044].map((r) => r * p.tailThick);

  const sc = (v: Vec3): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
  return {
    s,
    p,
    stations: stations.map((st) => ({ ...st, z: st.z * s, y: st.y * s, hw: st.hw * s, hh: st.hh * s, hl: st.hl * s })),
    withersY: withersY * s,
    pelvis: sc([0, stations[1]!.y + 0.02, stations[1]!.z]),
    spine: sc([0, stations[3]!.y + 0.01, stations[3]!.z]),
    chest: sc([0, st5.y + 0.02, st5.z - 0.03]),
    neck: sc(neck),
    head: sc(head),
    jaw: sc(jaw),
    front: { shoulder: sc(front.shoulder), elbow: sc(front.elbow), wrist: sc(front.wrist), fetlock: sc(front.fetlock), toe: sc(front.toe) },
    hind: { hip: sc(hind.hip), stifle: sc(hind.stifle), hock: sc(hind.hock), fetlock: sc(hind.fetlock), toe: sc(hind.toe) },
    tail: tail.map(sc),
    tailR: tailR.map((r) => r * s),
    tailBones: p.kind === 'boss' ? 6 : 5,
    headPitch,
  };
}

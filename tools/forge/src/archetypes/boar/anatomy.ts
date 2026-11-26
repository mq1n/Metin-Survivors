
// deep barrel, short strong legs, big low-carried wedge head) — dimensions only, geometry is original. Everything is scaled by params.scale.
import type { Vec3 } from '../../core/math.ts';
import type { BoarParams } from './params.ts';

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
  /** head-local unit length in metres (head parts are modelled at scale 1 and multiplied by this) */
  hs: number;
  p: BoarParams;
  stations: Station[];
  /** top of the back at the withers (without bristles) */
  withersY: number;
  pelvis: Vec3;
  spine: Vec3;
  chest: Vec3;
  neck: Vec3;
  head: Vec3;
  jaw: Vec3;
  maneF: Vec3;
  maneR: Vec3;
  /** left front leg (mirror X for right) */
  front: { shoulder: Vec3; elbow: Vec3; wrist: Vec3; fetlock: Vec3 };
  /** left hind leg */
  hind: { hip: Vec3; stifle: Vec3; hock: Vec3; fetlock: Vec3 };
  tail: Vec3[];
  tailR: number[];
  /** head pitch (radians, nose down positive) in the rest pose */
  headPitch: number;
}

/** the head is modelled ~30 % bigger than a literal pig head: the oversized skull + tusks is what reads at the game camera */
const HEAD_SCALE = 1.3;

export function computeAnatomy(p: BoarParams): Anatomy {
  const s = p.scale;
  const sc = (v: Vec3): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

  const stations: Station[] = [
    { name: 'rump', bone: 'pelvis', z: -0.46, y: 0.47, hw: 0.13, hh: 0.14, hl: 0.14 },
    { name: 'hips', bone: 'pelvis', z: -0.34, y: 0.5, hw: 0.168, hh: 0.165, hl: 0.14 },
    { name: 'loin', bone: 'spine', z: -0.2, y: 0.515, hw: 0.168, hh: 0.17, hl: 0.14 },
    { name: 'flank', bone: 'spine', z: -0.06, y: 0.53, hw: 0.188, hh: 0.19, hl: 0.15 },
    { name: 'ribs', bone: 'chest', z: 0.08, y: 0.545, hw: 0.208, hh: 0.205, hl: 0.16 },
    { name: 'chest', bone: 'chest', z: 0.22, y: 0.55, hw: 0.212, hh: 0.21, hl: 0.16 },
    { name: 'front', bone: 'chest', z: 0.36, y: 0.53, hw: 0.17, hh: 0.18, hl: 0.12 },
  ];
  const chestSt = stations[5]!;
  const withersY = chestSt.y + chestSt.hh;

  const neck: Vec3 = [0, 0.58, 0.3];
  const head: Vec3 = [0, 0.5, 0.56];
  const headPitch = 0.14;
  // jaw hinge: below / behind the cheek, in head-local (0, -0.07, 0.05)
  const c = Math.cos(headPitch), sn = Math.sin(headPitch);
  const jl: Vec3 = [0, -0.07, 0.05];
  const jaw: Vec3 = [0, head[1] + (jl[1] * c - jl[2] * sn) * HEAD_SCALE, head[2] + (jl[1] * sn + jl[2] * c) * HEAD_SCALE];

  const front = {
    shoulder: [0.165, 0.54, 0.24] as Vec3,
    elbow: [0.185, 0.345, 0.17] as Vec3,
    wrist: [0.16, 0.165, 0.245] as Vec3,
    fetlock: [0.16, 0.075, 0.255] as Vec3,
  };
  const hind = {
    hip: [0.15, 0.5, -0.34] as Vec3,
    stifle: [0.19, 0.35, -0.24] as Vec3,
    hock: [0.15, 0.2, -0.375] as Vec3,
    fetlock: [0.15, 0.078, -0.345] as Vec3,
  };

  // thin tail: out of the rump, an S-curve down and a little to the back, ending in a tassel
  const tail: Vec3[] = [
    [0, 0.56, -0.6],
    [0, 0.58, -0.68],
    [0, 0.53, -0.74],
    [0, 0.45, -0.765],
    [0, 0.37, -0.77],
  ];
  const tailR = [0.026, 0.021, 0.017, 0.013, 0.01];

  return {
    s,
    hs: HEAD_SCALE * s,
    p,
    stations: stations.map((st) => ({ ...st, z: st.z * s, y: st.y * s, hw: st.hw * s, hh: st.hh * s, hl: st.hl * s })),
    withersY: withersY * s,
    pelvis: sc([0, 0.5, -0.34]),
    spine: sc([0, 0.53, -0.06]),
    chest: sc([0, 0.55, 0.2]),
    neck: sc(neck),
    head: sc(head),
    jaw: sc(jaw),
    maneF: sc([0, 0.73, 0.1]),
    maneR: sc([0, 0.68, -0.25]),
    front: { shoulder: sc(front.shoulder), elbow: sc(front.elbow), wrist: sc(front.wrist), fetlock: sc(front.fetlock) },
    hind: { hip: sc(hind.hip), stifle: sc(hind.stifle), hock: sc(hind.hock), fetlock: sc(hind.fetlock) },
    tail: tail.map(sc),
    tailR: tailR.map((r) => r * s),
    headPitch,
  };
}

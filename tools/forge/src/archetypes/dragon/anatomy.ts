// Dragon anatomy: numbers only. Metres, +Y up, +Z forward, +X = the creature's left, origin on the ground between the feet.
// Everything is authored for scale 1 (horn tips ~6.5 m up, wing span 11.3 m at rest) and multiplied by `p.scale`.
import { type Vec3, qx, qrotate } from '../../core/math.ts';
import type { DragonParams } from './params.ts';

export interface Station {
  name: string;
  bone: string;
  z: number;
  y: number;
  hw: number;
  hh: number;
  hl: number;
}

export interface WingPts {
  /** shoulder, elbow, wrist (fingers emanate from the wrist), finger knuckles + tips, hip attachment of the trailing edge */
  S: Vec3; E: Vec3; W: Vec3;
  K1: Vec3; T1: Vec3; K2: Vec3; T2: Vec3; T3: Vec3; T4: Vec3; H: Vec3;
}

export interface Anatomy {
  p: DragonParams;
  s: number;
  pelvis: Vec3; spine: Vec3; chest: Vec3;
  /** neck1..neck4 joint positions */
  neck: Vec3[];
  head: Vec3; jaw: Vec3; muzzle: Vec3;
  /** tail1..tail6 joint positions + the tip */
  tail: Vec3[];
  tailTip: Vec3;
  stations: Station[];
  front: { shoulder: Vec3; elbow: Vec3; wrist: Vec3; ball: Vec3 };
  hind: { hip: Vec3; stifle: Vec3; hock: Vec3; ball: Vec3 };
  /** left wing (+x); the right wing mirrors it */
  wing: WingPts;
  /** head pitch (radians, positive = snout down) */
  headPitch: number;
  /** resolved head scale multiplier */
  hs: number;
  /** head-local (+z forward from the occiput) -> world */
  headW(v: Vec3): Vec3;
  /** neck centre line (control points + radii) used by body and dorsal plates */
  neckPath: { pts: Vec3[]; r: number[] };
  tailPath: { pts: Vec3[]; r: number[] };
}

export function computeAnatomy(p: DragonParams): Anatomy {
  const s = p.scale;
  const V = (x: number, y: number, z: number): Vec3 => [x * s, y * s, z * s];

  const stations: Station[] = (
    [
      ['rump', 'pelvis', -3.1, 2.8, 0.7, 0.78, 0.7],
      ['hip', 'pelvis', -2.25, 2.85, 1.0, 1.0, 0.85],
      ['loin', 'spine', -1.15, 2.85, 0.72, 0.86, 0.8],
      ['mid', 'spine', -0.05, 2.95, 0.82, 0.98, 0.85],
      ['ribs', 'chest', 0.95, 3.05, 1.0, 1.16, 0.85],
      ['chest', 'chest', 1.9, 3.1, 0.94, 1.16, 0.85],
      ['brisket', 'chest', 2.5, 3.15, 0.7, 0.98, 0.6],
    ] as const
  ).map(([name, bone, z, y, hw, hh, hl]) => ({ name, bone, z: z * s, y: y * s, hw: hw * s, hh: hh * s, hl: hl * s }));

  const neck: Vec3[] = [V(0, 3.7, 2.6), V(0, 4.3, 3.4), V(0, 5.0, 4.1), V(0, 5.55, 4.7)];
  const head = V(0, 5.85, 5.3);
  const tail: Vec3[] = [V(0, 2.75, -3.2), V(0, 2.4, -4.4), V(0.3, 1.9, -5.6), V(1.0, 1.4, -6.6), V(2.0, 1.0, -7.4), V(3.1, 0.75, -7.9)];
  const tailTip = V(4.15, 0.65, -7.75);
  const headPitch = 0.5;
  const hs = p.headScale ?? 1.6;
  const headW = (v: Vec3): Vec3 => {
    const r = qrotate(qx(headPitch), v);
    return [head[0] + r[0] * s * hs, head[1] + r[1] * s * hs, head[2] + r[2] * s * hs];
  };

  return {
    p,
    s,
    pelvis: V(0, 2.85, -2.25),
    spine: V(0, 2.95, -0.6),
    chest: V(0, 3.1, 1.35),
    neck,
    head,
    jaw: headW([0, -0.15, 0.33]),
    muzzle: headW([0, -0.12, 1.78]),
    tail,
    tailTip,
    stations,
    front: { shoulder: V(1.05, 2.6, 1.5), elbow: V(1.5, 1.6, 0.85), wrist: V(1.3, 0.8, 1.7), ball: V(1.3, 0.26, 2.15) },
    hind: { hip: V(1.15, 2.85, -2.25), stifle: V(1.65, 1.75, -1.35), hock: V(1.35, 1.05, -2.8), ball: V(1.35, 0.3, -2.15) },
    wing: {
      S: V(0.9, 4.1, 0.8),
      E: V(2.6, 5.45, 0.0),
      W: V(4.8, 5.95, 1.5),
      K1: V(6.3, 6.1, 0.4),
      T1: V(7.8, 5.0, -1.3),
      K2: V(5.8, 5.6, -0.3),
      T2: V(7.0, 4.4, -2.8),
      T3: V(5.4, 4.4, -3.6),
      T4: V(3.5, 4.0, -3.8),
      H: V(1.3, 3.4, -3.2),
    },
    headPitch,
    hs,
    headW,
    neckPath: {
      pts: [V(0, 3.45, 2.0), ...neck, head],
      r: [0.78, 0.66, 0.55, 0.5, 0.47, 0.46].map((r) => r * s),
    },
    tailPath: {
      pts: [V(0, 2.8, -2.9), ...tail, tailTip],
      r: [0.62, 0.56, 0.46, 0.36, 0.27, 0.19, 0.12, 0.05].map((r) => r * s),
    },
  };
}

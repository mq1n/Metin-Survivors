// Golem anatomy: every joint of the rest pose, authored directly in metres (+Z forward, +X = character's left).
// Bones keep the humanoid contract names (root pelvis spine chest neck head clavicle_ upper_arm_ forearm_ wrist_ hand_
// thigh_ shin_ foot_ toe_, sockets head hand_r hand_l back chest muzzle) plus two golem bones: `core` (the glowing chest crystal:
// pulses / flares) and `ridge` (dorsal spike cluster that lags the torso). 28 joints, no fingers: fists are rigid slabs.
// Elbows and knees are RESOLVED by two-bone IK from the shoulder/wrist and hip/ankle (the bend direction is the rest pole), so
// the pose solver in rig.ts reproduces the rest pose with exactly identity rotations.
import { twoBoneIK } from '../../core/anim/ik.ts';
import { type Vec3, vlen, vnorm, vscale, vsub } from '../../core/math.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';

/** every joint of one side is given for the character's LEFT (+X); the right side mirrors it */
export interface GolemShape {
  /** sole to crown, metres */
  H: number;
  pelvis: Vec3;
  spine: Vec3;
  chest: Vec3;
  neck: Vec3;
  /** head pivot (base of the skull) */
  head: Vec3;
  skull: Vec3;
  clav: Vec3;
  shoulder: Vec3;
  /** nominal elbow: only the two segment lengths are used (the bend plane comes from `armPole`) */
  elbow: Vec3;
  wrist: Vec3;
  /** fist centre (hand socket) */
  palm: Vec3;
  hip: Vec3;
  /** nominal knee: only the segment lengths are used (bend toward `legPole`) */
  knee: Vec3;
  ankle: Vec3;
  ball: Vec3;
  /** glowing chest crystal pivot */
  core: Vec3;
  /** dorsal ridge pivot */
  ridge: Vec3;
  /** back / muzzle sockets */
  back: Vec3;
  muzzle: Vec3;
  /** rest elbow bend direction for the left arm (mirrored for the right) */
  armPole?: Vec3;
  /** rest knee bend direction */
  legPole?: Vec3;
}

/** glacier golem: compact hunched mass, massive shoulders, huge fists hanging in front of thick stumpy legs */
export const ICE_SHAPE: GolemShape = {
  H: 3.0,
  pelvis: [0, 1.18, 0],
  spine: [0, 1.62, 0.1],
  chest: [0, 2.04, 0.26],
  neck: [0, 2.44, 0.5],
  head: [0, 2.5, 0.66],
  skull: [0, 2.74, 0.8],
  clav: [0.28, 2.3, 0.3],
  shoulder: [0.98, 2.14, 0.32],
  elbow: [1.08, 1.56, 0.5],
  wrist: [1.12, 1.04, 0.8],
  palm: [1.14, 0.8, 0.88],
  hip: [0.42, 1.1, 0],
  knee: [0.42, 0.64, 0.08],
  ankle: [0.42, 0.3, -0.02],
  ball: [0.42, 0.13, 0.42],
  core: [0, 2.12, 0.74],
  ridge: [0, 2.5, -0.3],
  back: [0, 2.4, -0.62],
  muzzle: [0, 2.66, 1.1],
};

/** magma golem: upright and wide, plate-armoured: narrow waist, huge layered pauldrons, thick column limbs, spiked fists */
export const FIRE_SHAPE: GolemShape = {
  H: 2.8,
  pelvis: [0, 1.2, 0],
  spine: [0, 1.55, 0.04],
  chest: [0, 1.92, 0.08],
  neck: [0, 2.38, 0.18],
  head: [0, 2.48, 0.24],
  skull: [0, 2.66, 0.3],
  clav: [0.32, 2.2, 0.12],
  shoulder: [1.0, 2.1, 0.04],
  elbow: [1.06, 1.52, 0.1],
  wrist: [1.04, 0.92, 0.2],
  palm: [1.04, 0.7, 0.24],
  hip: [0.34, 1.18, 0],
  knee: [0.36, 0.7, 0.07],
  ankle: [0.36, 0.2, -0.02],
  ball: [0.36, 0.08, 0.3],
  core: [0, 1.92, 0.36],
  ridge: [0, 2.3, -0.24],
  back: [0, 2.2, -0.34],
  muzzle: [0, 2.56, 0.6],
};

const mir = (p: Vec3, sx: 1 | -1): Vec3 => [p[0] * sx, p[1], p[2]];
const dist = (a: Vec3, b: Vec3): number => vlen(vsub(a, b));

/** the shape with exact elbows / knees (two-bone IK with the rest pole), so rig.ts rests at identity */
export function resolveShape(sh: GolemShape): GolemShape {
  const armPole = sh.armPole ?? [0.3, 0, -1];
  const legPole = sh.legPole ?? [0.08, 0, 1];
  const elbow = twoBoneIK(sh.shoulder, sh.wrist, dist(sh.shoulder, sh.elbow), dist(sh.elbow, sh.wrist), armPole).mid;
  const knee = twoBoneIK(sh.hip, sh.ankle, dist(sh.hip, sh.knee), dist(sh.knee, sh.ankle), legPole).mid;
  return { ...sh, elbow, knee, armPole, legPole };
}

/** rest bend directions of the resolved shape (what rig.ts keeps as the identity pole) */
export function restPoles(sh: GolemShape): { arm: Vec3; leg: Vec3 } {
  const perp = (a: Vec3, mid: Vec3, b: Vec3): Vec3 => {
    const ax = vnorm(vsub(b, a));
    const e = vsub(mid, a);
    const d = e[0] * ax[0] + e[1] * ax[1] + e[2] * ax[2];
    return vnorm(vsub(e, vscale(ax, d)));
  };
  return { arm: perp(sh.shoulder, sh.elbow, sh.wrist), leg: perp(sh.hip, sh.knee, sh.ankle) };
}

export const SOCKETS = { head: 'head', hand_r: 'hand_r', hand_l: 'hand_l', back: 'back', chest: 'chest', muzzle: 'muzzle' } as const;

/** 28-bone golem skeleton (identity rest rotations) from a resolved shape */
export function golemSkeleton(sh: GolemShape): Skeleton {
  const b: BoneSpec[] = [
    { name: 'root', parent: null, pos: [0, 0, 0] },
    { name: 'pelvis', parent: 'root', pos: sh.pelvis },
    { name: 'spine', parent: 'pelvis', pos: sh.spine },
    { name: 'chest', parent: 'spine', pos: sh.chest },
    { name: 'neck', parent: 'chest', pos: sh.neck },
    { name: 'head', parent: 'neck', pos: sh.head },
    { name: 'muzzle', parent: 'head', pos: sh.muzzle, helper: true },
    { name: 'back', parent: 'chest', pos: sh.back, helper: true },
    { name: 'core', parent: 'chest', pos: sh.core },
    { name: 'ridge', parent: 'chest', pos: sh.ridge },
  ];
  for (const sx of [1, -1] as const) {
    const n = sx === 1 ? 'l' : 'r';
    b.push(
      { name: `clavicle_${n}`, parent: 'chest', pos: mir(sh.clav, sx) },
      { name: `upper_arm_${n}`, parent: `clavicle_${n}`, pos: mir(sh.shoulder, sx) },
      { name: `forearm_${n}`, parent: `upper_arm_${n}`, pos: mir(sh.elbow, sx) },
      { name: `wrist_${n}`, parent: `forearm_${n}`, pos: mir(sh.wrist, sx) },
      { name: `hand_${n}`, parent: `wrist_${n}`, pos: mir(sh.palm, sx), helper: true },
    );
  }
  for (const sx of [1, -1] as const) {
    const n = sx === 1 ? 'l' : 'r';
    b.push(
      { name: `thigh_${n}`, parent: 'pelvis', pos: mir(sh.hip, sx) },
      { name: `shin_${n}`, parent: `thigh_${n}`, pos: mir(sh.knee, sx) },
      { name: `foot_${n}`, parent: `shin_${n}`, pos: mir(sh.ankle, sx) },
      { name: `toe_${n}`, parent: `foot_${n}`, pos: mir(sh.ball, sx) },
    );
  }
  return new Skeleton(b);
}

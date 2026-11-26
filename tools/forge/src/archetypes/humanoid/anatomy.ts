// Anatomy: every joint position and body-station number for one parameter set (metres, +Z forward, +X = character's left).
// The numbers describe a stylised, slightly heroic adult (big hands/feet, broad shoulders, ~7.4 heads) at the reference
// height; `build` multipliers and the sex blend reshape them. Rest pose = A-pose (arms ~17° out), identity bone rotations.
import { type Vec3, mix, smoothstep } from './mathx.ts';
import { DEFAULT_BUILD, DEFAULT_FACE, type Build, type FaceParams, type HumanoidParams, type Side } from './params.ts';
import type { Station } from './kit/loft.ts';
import type { RigLayout } from './skeleton.ts';

export interface SideJoints {
  sx: Side;
  clav: Vec3;
  shoulder: Vec3;
  elbow: Vec3;
  wrist: Vec3;
  /** palm centre (grip centre / hand socket) */
  palm: Vec3;
  /** knuckle line centre (finger bone pivot) */
  knuckle: Vec3;
  /** thumb base (CMC) and tip direction anchor */
  thumb: Vec3;
  fingerTip: Vec3;
  hip: Vec3;
  knee: Vec3;
  ankle: Vec3;
  ball: Vec3;
  toeTip: Vec3;
  heel: Vec3;
}

export interface Anatomy {
  p: HumanoidParams;
  b: Build;
  face: FaceParams;
  fem: number;
  /** metres per reference metre */
  s: number;
  /** sole to skull top */
  H: number;
  pelvis: Vec3;
  spine: Vec3;
  chest: Vec3;
  neck: Vec3;
  head: Vec3;
  /** head scale (1 = reference head height 0.235 m * s) */
  hs: number;
  /** skull centre */
  skull: Vec3;
  torso: Station[];
  /** torso centre line z offset at height y (lean + natural S-curve) */
  spineZ: (y: number) => number;
  /** forward-bend a point on the upper body (hunch) */
  bend: (p: Vec3) => Vec3;
  sides: { l: SideJoints; r: SideJoints };
  side: (sx: Side) => SideJoints;
  /** limb radii (metres) */
  r: {
    neck: number;
    upperArm: number;
    elbow: number;
    forearm: number;
    wrist: number;
    thigh: number;
    knee: number;
    calf: number;
    ankle: number;
    palmW: number;
    palmT: number;
    handLen: number;
    footW: number;
    footLen: number;
  };
  lengths: { upperArm: number; forearm: number; thigh: number; shin: number };
  /** secondary-chain layout (filled in by the skeleton builder) */
  layout: RigLayout;
}

export function computeAnatomy(p: HumanoidParams): Anatomy {
  const fem = p.sex === 'f' ? 1 : 0;
  const b: Build = { ...DEFAULT_BUILD, ...(p.build ?? {}) };
  const face: FaceParams = { ...DEFAULT_FACE, ...(p.face ?? {}) };
  const refH = mix(1.76, 1.69, fem);
  const f = (m: number, w: number): number => mix(m, w, fem);

  // ---- vertical landmarks (reference metres)
  const legLen = b.legLength;
  const ankleY = 0.085;
  const kneeY = ankleY + (0.495 - ankleY) * legLen;
  const hipY = ankleY + (0.915 - ankleY) * legLen;
  const dLeg = hipY - 0.915; // shift of everything above the hips (reference metres)
  const s = p.bodyHeight / (refH + dLeg);
  const Y = (y: number): number => (y + dLeg) * s;
  const pelvisY = 0.935;
  const lean = b.lean;
  const yp = (pelvisY + dLeg) * s;
  const bend = (q: Vec3): Vec3 => {
    if (lean === 0) return q;
    const dy = q[1] - yp;
    if (dy <= 0) return q;
    const k = smoothstep(0, 0.65 * s, dy);
    const th = lean * k;
    // swing the point forward about the pelvis (rotation, height preserved ~ cos)
    const r = dy;
    return [q[0], yp + r * Math.cos(th), q[2] + r * Math.sin(th)];
  };
  const spineZ = (y: number): number => bend([0, y, 0])[2] + 0.004 * Math.sin(((y - yp) / s) * 4);

  const pelvis = bend([0, Y(pelvisY), 0]);
  const spine = bend([0, Y(1.065), 0.004 * s]);
  const chest = bend([0, Y(1.225), 0]);
  const neck = bend([0, Y(1.455), -0.012 * s]);
  const hs = b.head * (p.head === 'wolf' ? 1.05 : 1) * f(1, 0.97);
  const headH = 0.235 * s * hs; // chin to crown
  const crown = p.bodyHeight;
  const skullC = bend([0, crown - headH * 0.5, b.headForward * s]);
  const headJoint: Vec3 = [0, skullC[1] - headH * 0.30, skullC[2] - 0.012 * s];

  // ---- torso stations (reference metres, sex blend), bent
  const sh = b.shoulder, ch = b.chest, wa = b.waist, hp = b.hips;
  const st = (y: number, rx: number, rz: number, cz = 0, n = 2.4): Station => {
    const q = bend([0, Y(y), cz * s]);
    return { y: q[1], rx: rx * s, rz: rz * s, cz: q[2], n };
  };
  const torso: Station[] = [
    st(0.790, f(0.152, 0.150) * hp, f(0.108, 0.104) * hp, 0, 2.2),
    st(0.880, f(0.166, 0.170) * hp, f(0.114, 0.116) * hp, -0.002, 2.3),
    st(0.960, f(0.158, 0.165) * hp, f(0.108, 0.108) * hp, 0, 2.3),
    st(1.040, f(0.143, 0.112) * wa, f(0.098, 0.088) * wa, 0.002, 2.5),
    st(1.120, f(0.150, 0.118) * mix(wa, ch, 0.5), f(0.103, 0.092) * mix(wa, ch, 0.5), 0.004, 2.5),
    st(1.210, f(0.172, 0.142) * ch, f(0.114, 0.100) * ch, 0.005, 2.6),
    st(1.300, f(0.196, 0.152) * ch * mix(1, sh, 0.5), f(0.123, 0.104) * ch, 0.004, 2.7),
    st(1.375, f(0.200, 0.158) * sh, f(0.114, 0.096) * ch, -0.004, 2.7),
    st(1.425, f(0.150, 0.118) * mix(1, sh, 0.5), f(0.092, 0.078), -0.012, 2.4),
    st(1.462, f(0.070, 0.056) * b.neck, f(0.072, 0.058) * b.neck, -0.012, 2.1),
  ];

  // ---- arms (A-pose)
  const shoulderW = f(0.212, 0.168) * sh;
  const uaLen = f(0.300, 0.274) * b.armLength * s;
  const faLen = f(0.262, 0.238) * b.armLength * s;
  const spread = b.armSpread;
  const mkSide = (sx: Side): SideJoints => {
    const clav = bend([sx * 0.032 * s, Y(1.428), 0.022 * s]);
    const shoulder = bend([sx * shoulderW * s, Y(1.398), -0.004 * s]);
    const ua: Vec3 = [Math.sin(spread) * sx, -Math.cos(spread), 0.06];
    const elbow: Vec3 = [shoulder[0] + ua[0] * uaLen, shoulder[1] + ua[1] * uaLen, shoulder[2] + ua[2] * uaLen];
    const fs = spread * 0.55 + 0.03;
    const fa: Vec3 = [Math.sin(fs) * sx, -Math.cos(fs) * 0.93, 0.34];
    const fl = Math.hypot(fa[0], fa[1], fa[2]);
    const wrist: Vec3 = [elbow[0] + (fa[0] / fl) * faLen, elbow[1] + (fa[1] / fl) * faLen, elbow[2] + (fa[2] / fl) * faLen];
    const hl = f(0.185, 0.165) * b.hands * s; // wrist -> fingertip
    const dir: Vec3 = [fa[0] / fl, fa[1] / fl, fa[2] / fl];
    // the hand continues the forearm direction, rolled slightly into a relaxed curl: palm centre ~0.4 of the hand length
    const palm: Vec3 = [wrist[0] + dir[0] * hl * 0.32 - sx * 0.004 * s, wrist[1] + dir[1] * hl * 0.32, wrist[2] + dir[2] * hl * 0.32];
    const knuckle: Vec3 = [wrist[0] + dir[0] * hl * 0.5, wrist[1] + dir[1] * hl * 0.5, wrist[2] + dir[2] * hl * 0.5];
    const thumb: Vec3 = [wrist[0] + dir[0] * hl * 0.16 - sx * 0.003 * s, wrist[1] + dir[1] * hl * 0.16, wrist[2] + dir[2] * hl * 0.16 + 0.02 * s * b.hands];
    const fingerTip: Vec3 = [wrist[0] + dir[0] * hl, wrist[1] + dir[1] * hl, wrist[2] + dir[2] * hl];
    // legs
    const stance = b.stance;
    const hipX = f(0.094, 0.098) * b.hips * 0.9;
    const hip: Vec3 = [sx * hipX * s, Y(0.915), 0];
    const knee: Vec3 = [sx * (hipX * 0.99 + (stance - 1) * 0.02) * s, kneeY * s, 0.012 * s];
    const ankle: Vec3 = [sx * (hipX * 1.04 + (stance - 1) * 0.04) * s, ankleY * s, -0.004 * s];
    const fl2 = f(1, 0.95) * b.feet;
    const ball: Vec3 = [ankle[0] + sx * 0.002 * s, 0.036 * s, 0.168 * s * fl2];
    const toeTip: Vec3 = [ankle[0] + sx * 0.003 * s, 0.022 * s, 0.258 * s * fl2];
    const heel: Vec3 = [ankle[0], 0.05 * s, -0.07 * s * fl2];
    return { sx, clav, shoulder, elbow, wrist, palm, knuckle, thumb, fingerTip, hip, knee, ankle, ball, toeTip, heel };
  };
  const l = mkSide(1), r = mkSide(-1);

  const mus = b.muscle;
  const radii = {
    neck: f(0.060, 0.047) * b.neck * s * (1 + 0.1 * mus),
    upperArm: f(0.050, 0.039) * b.arms * s * (1 + 0.12 * mus),
    elbow: f(0.043, 0.034) * b.arms * s,
    forearm: f(0.044, 0.034) * b.forearms * s * (1 + 0.08 * mus),
    wrist: f(0.030, 0.024) * b.forearms * s,
    thigh: f(0.086, 0.080) * b.legs * b.hips * s * (1 + 0.06 * mus),
    knee: f(0.056, 0.049) * b.legs * s,
    calf: f(0.058, 0.050) * b.calves * s * (1 + 0.08 * mus),
    ankle: f(0.037, 0.031) * b.calves * s,
    palmW: f(0.044, 0.037) * b.hands * s,
    palmT: f(0.017, 0.014) * b.hands * s,
    handLen: f(0.185, 0.165) * b.hands * s,
    footW: f(0.043, 0.037) * b.feet * s,
    footLen: f(0.27, 0.245) * b.feet * s,
  };
  const lengths = { upperArm: uaLen, forearm: faLen, thigh: (hipY - kneeY) * s, shin: (kneeY - ankleY) * s };

  return {
    p, b, face, fem, s, H: p.bodyHeight, pelvis, spine, chest, neck, head: headJoint, hs, skull: skullC, torso,
    spineZ, bend, sides: { l, r }, side: (sx) => (sx === 1 ? l : r), r: radii, lengths,
    layout: { skirt: null, hair: null, scarf: null, cape: null, tail: null, ears: null },
  };
}

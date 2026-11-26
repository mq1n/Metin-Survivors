// silver_vow_archer: same frame as the soldier, leather brigandine, short recurved bow + back quiver; ranged attack = draw and loose.
import type { Vec3 } from '../../../core/math.ts';
import type { ClipSpec } from '../../../core/anim/clip.ts';
import type { Skeleton } from '../../../core/skin/skeleton.ts';
import type { Anatomy, HumanoidParams, PieceSpec, Pose } from '../../../archetypes/humanoid/index.ts';
import { V } from '../../../archetypes/humanoid/index.ts';
import {
  type GaitSpec, actionClip, damped, deathClip, gaitClip, grip, hang, hitClip, idleClip, inChest, makeEnv, poseOf, ramp, spawnClip, speedsOf, stance,
} from '../../../archetypes/humans/anim.ts';
import { type BowOpts, type BowState, addBow, addQuiver, bowRig } from '../../../archetypes/humans/bow.ts';
import { lamellarVest } from '../../../archetypes/humans/pieces.ts';
import type { HumanModel } from '../../../archetypes/humans/rigx.ts';
import { OATH_FACE, OATH_PALETTE, OATH_SKIN } from './common.ts';

const BOW: BowOpts = { hand: 'l', string: 0.0105, mats: { wood: 'leather3', leather: 'leather2', cloth: 'cloth', metal: 'plate', fletch: 'sash' } };

/** seconds into `attack` when the arrow leaves the string (= the game's projectile spawn / `hit`) */
const RELEASE = 0.5;

function bowState(clip: string, t: number): BowState {
  if (clip !== 'attack') return { draw: 0, arrow: 0 };
  const arrow = t < RELEASE ? ramp(t, 0.04, 0.14, 'out') : 0;
  if (t < 0.14) return { draw: 0, arrow };
  if (t < RELEASE) return { draw: 1, arrow };
  // string snaps back past its rest line and rings out
  return { draw: -0.06 * damped(t - RELEASE, 7, 12), arrow };
}

const ARCHER_WALK: GaitSpec = { T: 1.0, duty: 0.62, sweep: 0.56, lift: 0.1, bob: 0.014, lean: 0.03, twist: 0.1, armSwing: 0.07, armHeld: 0.25, heldSide: 'l', headStab: 0.7 };
const ARCHER_RUN: GaitSpec = { T: 0.6, duty: 0.4, sweep: 0.9, lift: 0.19, bob: 0.035, lean: 0.16, twist: 0.18, hipYaw: 0.22, armSwing: 0.14, armHeld: 0.25, heldSide: 'l', headStab: 0.6, run: true, crouch: 0.02, stomp: 0.01, width: 0.42, reach: 1.0,
  carry: { l: grip(V(0.34, -0.12, 0.3), V(0.35, 0.9, 0.3), V(-0.5, 0, 1), 1), sp: [0.05, -0.08, 0] } };

function archerClips(clips: ClipSpec[], a: Anatomy, sk: Skeleton): ClipSpec[] {
  void clips;
  // bow vertical in the lowered left hand, right hand loose by the hip
  const idle: Pose = poseOf(stance(0.12, 0.1, 0.02), {
    sp: [0.04, -0.12, 0], hip: [0, 0.05, 0], head: [0, 0.12, 0],
    r: hang('r', 0.5, V(-0.23, -0.28, 0.1)),
    l: grip(V(0.36, -0.1, 0.26), V(0.35, 0.9, 0.2), V(-0.5, 0, 1), 1),
    poleR: V(-0.4, -0.5, -0.8), poleL: V(0.8, -0.5, -0.3),
  });
  const env = makeEnv(a, sk, idle, {}, { flow: 1 });
  const walk = ARCHER_WALK, run = ARCHER_RUN;

  // ---- attack: raise + nock, draw, anchor, loose. Hand targets are authored in the upright, forward-facing body frame (chest joint
  // origin, reference metres, shoulders taken from the anatomy so every reach is solvable) and mapped to the chest frame for the torso
  // yaw of each key.
  const yawNock = -0.45, yawDraw = -0.85;
  const sh = (n: 1 | -1, yaw: number): Vec3 => {
    const p = a.side(n).shoulder, c = a.chest;
    return inChest([(p[0] - c[0]) / a.s, (p[1] - c[1]) / a.s, (p[2] - c[2]) / a.s], -yaw);
  };
  const add = (p: Vec3, x: number, y: number, z: number): Vec3 => [p[0] + x, p[1] + y, p[2] + z];
  const L = (yaw: number, g: Vec3, axis = V(0, 1, 0.05), palm = V(-0.06, 0, 1), curl = 1) => grip(inChest(g, yaw), inChest(axis, yaw), inChest(palm, yaw), curl);
  const R = (yaw: number, g: Vec3, axis = V(0, 1, 0.1), palm = V(1, 0, 0.2), curl = 0.55) => grip(inChest(g, yaw), inChest(axis, yaw), inChest(palm, yaw), curl);
  const bowNock = add(sh(1, yawNock), 0, -0.05, 0.4);
  const nockPt = add(bowNock, 0, 0, -0.225);
  const bowDraw = add(sh(1, yawDraw), 0, -0.02, 0.57);
  const anchor = V(-0.09, 0.285, 0.07);
  const stanceDraw = { fl: V(0.18, 0, 0.12), fr: V(-0.18, 0, -0.12), root: V(0, -0.045, 0) };
  return [
    idleClip(env, { dur: 2.8, look: 0.16 }),
    gaitClip(env, 'walk', walk),
    gaitClip(env, 'run', run),
    actionClip(env, {
      name: 'attack', dur: 1.15, hit: RELEASE,
      keys: [
        { t: 0, p: {} },
        // raise the bow, nock: draw hand reaches the string
        { t: 0.16, ease: 'smooth', p: { sp: [0.02, yawNock, 0], hip: [0, 0, 0], head: [0.02, 0.18, 0], l: L(yawNock, bowNock), r: R(yawNock, nockPt), poleR: inChest(V(-0.5, -0.5, -0.5), yawNock), poleL: inChest(V(0.3, -1, -0.2), yawNock), root: V(0, -0.02, 0), fl: V(0.15, 0, 0.11), fr: V(-0.15, 0, -0.11) } },
        // full draw: bow arm straight at the target, string hand at the jaw, elbow out in line with the arrow
        { t: 0.44, ease: 'smooth', p: { sp: [-0.03, yawDraw, 0.03], hip: [0, 0, 0], head: [0, 0.34, -0.1], l: L(yawDraw, bowDraw), r: R(yawDraw, anchor, V(0, 1, 0.15), V(1, 0, 0.25), 0.6), poleR: inChest(V(-1, -0.3, -0.5), yawDraw), poleL: inChest(V(0.3, -1, -0.2), yawDraw), ...stanceDraw } },
        { t: 0.5, ease: 'smooth', p: { r: R(yawDraw, add(anchor, -0.005, -0.005, -0.006), V(0, 1, 0.15), V(1, 0, 0.25), 0.6) } },
        // loose: string hand flicks back past the ear, bow kicks forward
        { t: 0.58, ease: 'out', p: { sp: [0.0, yawDraw + 0.05, 0.02], l: L(yawDraw, add(bowDraw, 0, 0.01, 0.03)), r: R(yawDraw, V(-0.2, 0.28, -0.07), V(0, 1, -0.2), V(1, 0, 0.1), 0.1) } },
        { t: 0.8, ease: 'smooth', p: { sp: [0.03, -0.3, 0.0], hip: [0, 0, 0], head: [0, 0.12, 0], l: L(-0.3, add(sh(1, -0.3), 0, -0.1, 0.4)), r: R(-0.3, V(-0.22, -0.05, 0.15), V(0, 0.2, 1), V(1, 0, 0), 0.4), ...stanceDraw, root: V(0, -0.025, 0) } },
        { t: 1.15, ease: 'smooth', p: { ...idle } },
      ],
    }),
    hitClip(env, { dur: 0.5, recoil: -0.3, twist: 0.25, drop: 0.05, shove: 0.12 }),
    deathClip(env, { dur: 1.8, fall: 'back', topple: 0.4 }),
    spawnClip(env, [
      { t: 0, p: { root: V(0, -0.3, 0), sp: [0.45, -0.2, 0], head: [0.3, 0, 0], fl: V(0.14, 0, 0.1), fr: V(-0.14, 0, -0.1) } },
      { t: 0.5, ease: 'smooth', p: { root: V(0, -0.16, 0), sp: [0.25, -0.2, 0], head: [0.1, 0.2, 0] } },
      { t: 0.85, ease: 'out', p: { ...idle, root: V(0, 0.01, 0), sp: [-0.06, -0.2, 0], head: [-0.1, 0.2, 0] } },
      { t: 1.2, ease: 'smooth', p: { ...idle } },
    ], 1.2),
  ];
}

export function archerParams(): HumanoidParams {
  const outfit: PieceSpec[] = [
    { id: 'trousers', mat: 'cloth2', o: { baggy: 0.1, end: 0.9 } },
    { id: 'wraps', mat: 'leather', o: { where: 'shin', rings: 5, trim: 'none' } },
    { id: 'boots', mat: 'leather2', o: { start: 0.8 } },
    { id: 'tunic', mat: 'cloth', o: { sleeve: 0.65, collar: 'v', hem: 0.14 } },
    { id: 'lamellarVest', mat: 'leather', build: lamellarVest, o: { pattern: 'scale', rows: 4, top: -0.05, yoke: false, trim: 'trim' } },
    { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.32, y: -0.04, trim: 'none' } },
    { id: 'vambrace', mat: 'leather', o: { from: 0.5, trim: 'none' } },
    { id: 'pauldron', mat: 'leather', o: { lames: 1, size: 0.65, pattern: 'scale', trim: 'trim' } },
    { id: 'headband', mat: 'sash', o: { tails: true } },
  ];
  return {
    id: 'silver_vow_archer', kind: 'creature', seed: 'silver_vow_archer', sex: 'm', bodyHeight: 1.68,
    build: { shoulder: 0.98, chest: 0.95, waist: 0.88, legs: 1.04, muscle: 0.4, head: 1.0, neck: 0.95 },
    face: OATH_FACE,
    skin: OATH_SKIN, hair: { style: 'topknot', color: '#1c1612' },
    outfit, palette: OATH_PALETTE, style: 'none',
    tris: 4800, voxel: 0.008, texture: 512, liteHands: true, speed: speedsOf(ARCHER_WALK, ARCHER_RUN, 1.68),
    hooks: {
      afterOutfit: (ctx) => {
        addBow(ctx, ctx.a, BOW);
        addQuiver(ctx, ctx.a, { len: 0.58, arrows: 7, mats: { leather: 'leather2', cloth: 'sash', fletch: 'sash', wood: 'leather3' } });
      },
      clips: archerClips,
    },
  };
}

export const archer: HumanModel = { params: archerParams, rig: (a) => bowRig(a, BOW, bowState) };

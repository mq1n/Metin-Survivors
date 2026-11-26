// silver_vow_soldier: lamellar vest, cloth-wrap helm, spear and round shield.
import type { ClipSpec } from '../../../core/anim/clip.ts';
import type { Skeleton } from '../../../core/skin/skeleton.ts';
import type { Anatomy, HumanoidParams, PieceSpec, Pose } from '../../../archetypes/humanoid/index.ts';
import { V } from '../../../archetypes/humanoid/index.ts';
import { type GaitSpec, actionClip, deathClip, gaitClip, grip, hitClip, idleClip, makeEnv, poseOf, spawnClip, speedsOf, stance } from '../../../archetypes/humans/anim.ts';
import { lamellarVest, wrapHelm } from '../../../archetypes/humans/pieces.ts';
import { addShield, addSpear } from '../../../archetypes/humans/props.ts';
import type { HumanModel } from '../../../archetypes/humans/rigx.ts';
import { OATH_FACE, OATH_PALETTE, OATH_SKIN } from './common.ts';

const SOLDIER_WALK: GaitSpec = { T: 1.0, duty: 0.62, sweep: 0.56, lift: 0.1, bob: 0.014, lean: 0.03, twist: 0.1, armSwing: 0.06, headStab: 0.7 };
const SOLDIER_RUN: GaitSpec = { T: 0.62, duty: 0.4, sweep: 0.9, lift: 0.19, bob: 0.035, lean: 0.14, twist: 0.2, hipYaw: 0.22, armSwing: 0.1, headStab: 0.6, run: true, crouch: 0.02, stomp: 0.01, width: 0.42, reach: 1.0,
  carry: { r: grip(V(-0.2, -0.18, 0.24), V(0.05, 0.3, 0.95), V(0.4, -0.85, 0.2), 1), sp: [0.05, -0.2, 0] } };

function soldierClips(clips: ClipSpec[], a: Anatomy, sk: Skeleton): ClipSpec[] {
  void clips;
  // spear in the right hand (couched forward-up), round shield strapped to the left forearm held across the chest
  const idle: Pose = poseOf(stance(0.13, 0.12, 0.035), {
    sp: [0.05, -0.3, 0], hip: [0, 0.1, 0], head: [0, 0.2, 0],
    r: grip(V(-0.21, -0.12, 0.27), V(0.1, 0.42, 0.9), V(0.4, -0.85, 0.2), 1),
    l: grip(V(0.06, -0.02, 0.4), V(0, 1, 0), V(0, 0, -1), 0.8),
    poleR: V(-0.5, -0.5, -0.6), poleL: V(0.8, -0.5, -0.2),
  });
  const env = makeEnv(a, sk, idle, {}, { flow: 0.9 });
  const walk = SOLDIER_WALK, run = SOLDIER_RUN;
  return [
    idleClip(env, { dur: 2.6, look: 0.1 }),
    gaitClip(env, 'walk', walk),
    gaitClip(env, 'run', run),
    actionClip(env, {
      name: 'attack', dur: 0.95, hit: 0.4,
      keys: [
        { t: 0, p: {} },
        // coil: spear pulled back, weight on the rear foot, shield forward
        { t: 0.2, ease: 'out', p: { r: { g: V(-0.2, -0.1, 0.0), b: V(0.05, 0.15, 1), e: V(-0.4, 0.8, -0.2) }, sp: [0.0, -0.55, 0], hip: [0, -0.35, 0], root: V(0, -0.07, -0.05), fl: V(0.13, 0, 0.1), fr: V(-0.13, 0, -0.22) } },
        // thrust: long step forward, arm fully extended, spear level
        { t: 0.4, ease: 'in', p: { r: { g: V(-0.1, -0.12, 0.56), b: V(0, 0.05, 1) }, sp: [0.22, 0.05, 0], hip: [0, 0.45, 0], root: V(0, -0.15, 0.16), fl: V(0.14, 0, 0.44), fr: V(-0.13, 0, -0.18), head: [0, 0.1, 0] } },
        { t: 0.55, ease: 'out', p: { r: { g: V(-0.1, -0.12, 0.6) }, root: V(0, -0.14, 0.17) } },
        { t: 0.95, ease: 'smooth', p: { ...idle } },
      ],
    }),
    hitClip(env, { dur: 0.5, recoil: -0.3, twist: 0.2, drop: 0.05, shove: 0.12 }),
    deathClip(env, { dur: 1.9, fall: 'back', topple: 0.45 }),
    spawnClip(env, [
      { t: 0, p: { root: V(0, -0.3, 0), sp: [0.45, -0.3, 0], head: [0.3, 0, 0], fl: V(0.14, 0, 0.1), fr: V(-0.14, 0, -0.1) } },
      { t: 0.5, ease: 'smooth', p: { root: V(0, -0.16, 0), sp: [0.25, -0.3, 0], head: [0.1, 0.2, 0] } },
      { t: 0.85, ease: 'out', p: { ...idle, root: V(0, 0.01, 0), sp: [-0.06, -0.3, 0], head: [-0.1, 0.2, 0] } },
      { t: 1.2, ease: 'smooth', p: { ...idle } },
    ], 1.2),
  ];
}

export function soldierParams(): HumanoidParams {
  const outfit: PieceSpec[] = [
    { id: 'trousers', mat: 'cloth2', o: { baggy: 0.1, end: 0.9 } },
    { id: 'wraps', mat: 'cloth', o: { where: 'shin', rings: 6, trim: 'none' } },
    { id: 'boots', mat: 'leather2', o: { start: 0.8 } },
    { id: 'tunic', mat: 'cloth', o: { sleeve: 0.5, collar: 'v', hem: 0.08 } },
    { id: 'lamellarVest', mat: 'lacquer', build: lamellarVest, o: { pattern: 'scale', rows: 6, trim: 'trim' } },
    { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.3, y: -0.05, trim: 'none' } },
    { id: 'tassets', mat: 'lacquer', o: { count: 9, len: 0.2, flare: 0.3, trim: 'trim', pattern: 'scale' } },
    { id: 'pauldron', mat: 'lacquer', o: { lames: 2, size: 0.8, pattern: 'scale', trim: 'trim' } },
    { id: 'vambrace', mat: 'leather', o: { from: 0.58, trim: 'none' } },
    { id: 'wrapHelm', mat: 'cloth', build: wrapHelm, o: { wraps: 3, knotSide: 1, tail: 0.18, trim: 'sash' } },
  ];
  return {
    id: 'silver_vow_soldier', kind: 'creature', seed: 'silver_vow_soldier', sex: 'm', bodyHeight: 1.75,
    build: { shoulder: 1.04, chest: 1.0, waist: 0.92, legs: 1.0, muscle: 0.55, head: 1.0, neck: 0.95 },
    face: OATH_FACE,
    skin: OATH_SKIN, hair: { style: 'none', color: '#1c1612' },
    outfit, palette: OATH_PALETTE, style: 'none',
    rig: { skirt: true },
    tris: 4800, voxel: 0.008, texture: 512, liteHands: true, speed: speedsOf(SOLDIER_WALK, SOLDIER_RUN, 1.75),
    hooks: {
      afterOutfit: (ctx) => {
        addSpear(ctx, ctx.a, { hand: 'r', mats: { wood: 'leather3', metal: 'plate', cloth: 'sash' } });
        addShield(ctx, ctx.a, { hand: 'l', r: 0.27, mats: { wood: 'cloth', metal: 'plate', cloth: 'sash' } });
      },
      clips: soldierClips,
    },
  };
}

export const soldier: HumanModel = { params: soldierParams };

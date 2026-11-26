// silver_vow_captain: armoured commander. Steel plate over white cloth, spiked gold-edged pauldrons, red sash + short red mantle,
// kabuto-style helm with a gold crest, heavy up-curved sabre. Melee attack = overhead cleave.
import type { ClipSpec } from '../../../core/anim/clip.ts';
import type { Skeleton } from '../../../core/skin/skeleton.ts';
import type { Anatomy, HumanoidParams, PieceSpec, Pose } from '../../../archetypes/humanoid/index.ts';
import { V } from '../../../archetypes/humanoid/index.ts';
import { type GaitSpec, actionClip, deathClip, gaitClip, grip, hitClip, idleClip, makeEnv, poseOf, spawnClip, speedsOf, stance } from '../../../archetypes/humans/anim.ts';
import { addBlade } from '../../../archetypes/humans/blades.ts';
import type { HumanModel } from '../../../archetypes/humans/rigx.ts';
import { OATH_FACE, OATH_PALETTE, OATH_SKIN } from './common.ts';

const BODY_H = 1.83;
const CAPTAIN_WALK: GaitSpec = { T: 1.05, duty: 0.62, sweep: 0.58, lift: 0.1, bob: 0.016, lean: 0.03, twist: 0.1, armSwing: 0.07, armHeld: 0.3, headStab: 0.7, stomp: 0.006 };
const CAPTAIN_RUN: GaitSpec = { T: 0.66, duty: 0.4, sweep: 0.9, lift: 0.18, bob: 0.034, lean: 0.12, twist: 0.2, hipYaw: 0.2, armSwing: 0.12, armHeld: 0.3, headStab: 0.6, run: true, crouch: 0.02, stomp: 0.02, width: 0.42, reach: 1.0,
  carry: { r: grip(V(-0.22, -0.15, 0.22), V(0.1, 0.55, 0.85), V(0.9, 0.1, 0.1), 1), sp: [0.05, -0.15, 0] } };

function captainClips(clips: ClipSpec[], a: Anatomy, sk: Skeleton): ClipSpec[] {
  void clips;
  // sabre upright in the right hand beside the shoulder, left fist on the belt
  const idle: Pose = poseOf(stance(0.14, 0.08, 0.03), {
    sp: [0.03, -0.1, 0], hip: [0, 0.05, 0], head: [0, 0.1, 0],
    r: grip(V(-0.22, -0.05, 0.26), V(0.15, 0.95, 0.3), V(0.9, 0.1, 0.1), 1),
    l: grip(V(0.2, -0.2, 0.1), V(0, 0, 1), V(-1, 0, 0), 1),
    poleR: V(-0.6, -0.5, -0.5), poleL: V(0.8, -0.4, -0.4),
  });
  const env = makeEnv(a, sk, idle, {}, { flow: 0.8 });
  const blade = (g: ReturnType<typeof V>, axis: ReturnType<typeof V>) => grip(g, axis, V(0.9, 0.1, 0.1), 1);
  return [
    idleClip(env, { dur: 3.0, look: 0.08, breath: 0.02 }),
    gaitClip(env, 'walk', CAPTAIN_WALK),
    gaitClip(env, 'run', CAPTAIN_RUN),
    actionClip(env, {
      name: 'attack', dur: 1.05, hit: 0.4, flow: 0.15,
      keys: [
        { t: 0, p: {} },
        // anticipation: lean back, blade high behind the head, left arm forward for balance
        { t: 0.22, ease: 'out', p: { r: blade(V(-0.2, 0.52, -0.12), V(0.1, 0.55, -0.85)), l: grip(V(0.3, 0.1, 0.35), V(0, 0, 1), V(-1, 0, 0), 0.6), sp: [-0.3, -0.45, 0], hip: [0, -0.3, 0], head: [-0.1, 0.35, 0], root: V(0, -0.04, -0.04), fl: V(0.15, 0, 0.05), fr: V(-0.15, 0, -0.2) } },
        // cleave: step in, body folds forward, blade chops down in front
        { t: 0.4, ease: 'in', p: { r: blade(V(-0.12, 0.05, 0.6), V(0, -0.5, 0.85)), l: grip(V(0.28, -0.1, 0.0), V(0, 0, 1), V(-1, 0, 0), 1), sp: [0.35, 0.25, 0], hip: [0, 0.3, 0], head: [0.15, -0.2, 0], root: V(0, -0.12, 0.15), fl: V(0.15, 0, 0.42), fr: V(-0.15, 0, -0.15) } },
        { t: 0.55, ease: 'out', p: { r: blade(V(-0.15, -0.2, 0.62), V(0.05, -0.7, 0.7)), root: V(0, -0.13, 0.16) } },
        { t: 1.05, ease: 'smooth', p: { ...idle } },
      ],
    }),
    hitClip(env, { dur: 0.5, recoil: -0.25, twist: 0.18, drop: 0.04, shove: 0.1 }),
    deathClip(env, { dur: 2.0, fall: 'back', topple: 0.5 }),
    spawnClip(env, [
      { t: 0, p: { root: V(0, -0.3, 0), sp: [0.45, -0.2, 0], head: [0.3, 0, 0], fl: V(0.14, 0, 0.1), fr: V(-0.14, 0, -0.1) } },
      { t: 0.55, ease: 'smooth', p: { root: V(0, -0.15, 0), sp: [0.25, -0.2, 0], head: [0.1, 0.2, 0] } },
      { t: 0.9, ease: 'out', p: { ...idle, root: V(0, 0.01, 0), sp: [-0.1, -0.1, 0], head: [-0.12, 0.1, 0] } },
      { t: 1.3, ease: 'smooth', p: { ...idle } },
    ], 1.3),
  ];
}

export function captainParams(): HumanoidParams {
  const outfit: PieceSpec[] = [
    { id: 'trousers', mat: 'cloth2', o: { baggy: 0.1, end: 0.9 } },
    { id: 'boots', mat: 'leather2', o: { start: 0.55 } },
    { id: 'greaves', mat: 'plate', o: { cop: 1, trim: 'trim' } },
    { id: 'tunic', mat: 'cloth', o: { sleeve: 0.7, collar: 'v', hem: 0.1 } },
    { id: 'cuirass', mat: 'plate', o: { style: 'plate', bands: 3, emblem: 1, emblemMat: 'gold', straps: true, trim: 'trim' } },
    { id: 'tassets', mat: 'plate', o: { count: 9, len: 0.24, flare: 0.35, trim: 'trim' } },
    { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.4, y: -0.03, trim: 'none' } },
    { id: 'pauldron', mat: 'plate', o: { lames: 3, size: 1.25, spike: 0.5, spikeMat: 'gold', trim: 'trim' } },
    { id: 'vambrace', mat: 'plate', o: { from: 0.5, cop: true, trim: 'trim' } },
    { id: 'collar', mat: 'plate', o: { height: 0.07, flare: 0.03, trim: 'trim' } },
    { id: 'helm', mat: 'plate', o: { style: 'kabuto', crest: true, crestMat: 'gold', trim: 'trim' } },
    { id: 'cape', mat: 'sash', o: {} },
  ];
  return {
    id: 'silver_vow_captain', kind: 'creature', seed: 'silver_vow_captain', sex: 'm', bodyHeight: BODY_H,
    build: { shoulder: 1.18, chest: 1.12, waist: 0.95, legs: 1.0, muscle: 0.75, head: 1.0, neck: 1.0 },
    face: { ...OATH_FACE, jaw: 0.7, brow: 0.65 },
    skin: OATH_SKIN, hair: { style: 'none', color: '#1c1612' },
    outfit, palette: OATH_PALETTE, style: 'none',
    rig: { skirt: true, capeBones: 3 },
    tris: 4800, voxel: 0.008, texture: 512, liteHands: true, speed: speedsOf(CAPTAIN_WALK, CAPTAIN_RUN, BODY_H),
    hooks: {
      afterOutfit: (ctx) => {
        addBlade(ctx, ctx.a, { hand: 'r', mats: { metal: 'plate', leather: 'leather2', gold: 'gold' } });
      },
      clips: captainClips,
    },
  };
}

export const captain: HumanModel = { params: captainParams };

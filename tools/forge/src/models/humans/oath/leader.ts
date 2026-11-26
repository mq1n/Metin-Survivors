// silver_vow_leader: battle-sorceress captain. Dark indigo split robe (nine cloth panels) over armoured boots, silver corset + small
// pauldrons, crimson hip sash, gold flame-leaf crown, a long braid, and an open casting hand (real fingers) with a glowing spell orb
// (extra bone `orb`, see leader_parts.ts). Attack = authored cast: coil, charge the orb, thrust the palm; the orb leaves the hand at
// the hit time (0.55 s). attack2 = two-handed summoning sweep (the boss's oath_call falls back to it).
import type { PoseCtx } from '../../../core/anim/clip.ts';
import type { ClipSpec } from '../../../core/anim/clip.ts';
import type { Vec3 } from '../../../core/math.ts';
import type { Skeleton } from '../../../core/skin/skeleton.ts';
import type { Anatomy, Hand, HumanoidParams, PieceSpec, Pose } from '../../../archetypes/humanoid/index.ts';
import { V } from '../../../archetypes/humanoid/index.ts';
import {
  type GaitSpec, actionClip, deathClip, gaitClip, gaitSpeedOf, grip, hitClip, idleClip, makeEnv, poseOf, ramp, spawnClip, stance,
} from '../../../archetypes/humans/anim.ts';
import type { ExtraBone, HumanModel, HumanRig } from '../../../archetypes/humans/rigx.ts';
import { OATH_FACE, OATH_PALETTE } from './common.ts';
import { addOrb, battleSkirt, crown, flareSleeves, openHand, orbGeo, trimBody } from './leader_parts.ts';

const BODY_H = 1.56;
const LEG = 1.06;
/** body scale of the humanoid builder for this height / leg length (female reference 1.69 m) */
const S = BODY_H / (1.69 + (0.085 + 0.83 * LEG - 0.915));
const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const RELEASE = 0.55; // seconds into `attack`: the orb leaves the hand (= the game's projectile spawn)

const LEADER_WALK: GaitSpec = { T: 1.0, duty: 0.62, sweep: 0.58, lift: 0.09, bob: 0.012, lean: 0.02, twist: 0.08, armSwing: 0.05, armHeld: 0.2, heldSide: 'r', headStab: 0.8 };
const LEADER_RUN: GaitSpec = {
  T: 0.6, duty: 0.4, sweep: 0.98, lift: 0.16, bob: 0.028, lean: 0.1, twist: 0.12, hipYaw: 0.18, armSwing: 0.12, armHeld: 0.2, heldSide: 'r', headStab: 0.7, run: true, crouch: 0.02, width: 0.4, reach: 1.0,
};

// ------------------------------------------------------------------------------------------------ hand helpers
type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** hand from the palm normal and the finger direction (chest frame); the thumb axis (= grip axis) follows from the side */
function handOf(side: 'l' | 'r', g: V3, fingers: V3, palm: V3, curl = 0.15): Hand {
  const f = norm(fingers);
  const d = palm[0] * f[0] + palm[1] * f[1] + palm[2] * f[2];
  const n = norm([palm[0] - f[0] * d, palm[1] - f[1] * d, palm[2] - f[2] * d]);
  const t = side === 'r' ? cross(f, n) : cross(n, f);
  return grip(g, t, n, curl);
}

const READY_R = handOf('r', V(-0.31, -0.1, 0.3), V(-0.25, 0.1, 1), V(0.25, 1, 0.25), 0.12);
const HIP_L = handOf('l', V(0.2, -0.3, 0.06), V(0.2, -1, 0.35), V(-1, 0.1, 0), 0.5);

// ------------------------------------------------------------------------------------------------ orb animation
interface OrbState {
  /** uniform scale (0.001 = gone) */
  scale: number;
  /** distance of the orb centre from the palm along the palm normal (m, reference) */
  push: number;
  /** spin angle (rad) */
  spin: number;
}

const TAU = Math.PI * 2;
const IDLE_ORB = 1.0;

function orbState(clip: string, t: number, u: number): OrbState {
  const base: OrbState = { scale: IDLE_ORB, push: 0.12, spin: u * TAU };
  switch (clip) {
    case 'idle':
      return { scale: IDLE_ORB + 0.04 * Math.sin(u * TAU * 2), push: 0.12, spin: u * TAU };
    case 'walk':
    case 'run':
      return { scale: IDLE_ORB * 0.9, push: 0.115, spin: u * TAU * 2 };
    case 'attack': {
      // charge: the orb swells while the hand draws back, thrust, release at RELEASE (flies off along the palm normal), reform
      const grow = ramp(t, 0.02, 0.3, 'out');
      const swell = ramp(t, 0.3, RELEASE, 'smooth');
      const gone = ramp(t, RELEASE, RELEASE + 0.1, 'in');
      const flight = ramp(t, RELEASE, RELEASE + 0.16, 'in');
      const reform = ramp(t, 0.82, 1.15, 'smooth');
      let scale = IDLE_ORB + (1.0 - IDLE_ORB) * grow + 0.5 * swell;
      scale = t < RELEASE ? scale : scale * (1 - gone) + 0.001;
      if (t >= 0.82) scale = Math.max(scale, 0.001) + (IDLE_ORB - 0.001) * reform;
      return { scale: Math.max(scale, 0.001), push: 0.12 + 0.015 * swell + 0.5 * flight * (1 - gone), spin: t * TAU * (1.2 + 3 * swell) };
    }
    case 'attack2': {
      const grow = ramp(t, 0.05, 0.55, 'smooth');
      const fade = ramp(t, 0.8, 1.05, 'smooth');
      return { scale: IDLE_ORB + (1.3 - IDLE_ORB) * grow - (1.3 - IDLE_ORB) * fade, push: 0.12 + 0.08 * grow, spin: t * TAU * 2.5 };
    }
    case 'hit':
      return { scale: IDLE_ORB * (0.6 + 0.4 * ramp(t, 0.1, 0.5, 'smooth')), push: 0.12, spin: base.spin * 3 };
    case 'death':
      return { scale: Math.max(IDLE_ORB * (1 - ramp(t, 0, 0.35, 'in')), 0.001), push: 0.12, spin: t * TAU * 2 };
    case 'spawn':
      return { scale: Math.max(IDLE_ORB * ramp(t, 0.35, 1.2, 'smooth'), 0.001), push: 0.12, spin: t * TAU * 2 };
    default:
      return base;
  }
}

function orbRig(a: Anatomy): HumanRig {
  const g = orbGeo(a, 'r');
  const extra: ExtraBone[] = [{ name: 'orb', parent: 'wrist_r', pos: g.rest }];
  const palmOff: Vec3 = [g.palm[0] - g.wrist[0], g.palm[1] - g.wrist[1], g.palm[2] - g.wrist[2]];
  const restOff: Vec3 = [g.rest[0] - g.wrist[0], g.rest[1] - g.wrist[1], g.rest[2] - g.wrist[2]];
  /** scale the pitch of a skirt bone: the stock drive streams the long back panel out like a flag in a run */
  const damp = (c: PoseCtx, bone: string, k: number): void => {
    const q = c.pose.rot[c.skel.idx(bone)]!;
    c.set(bone, 2 * Math.atan2(q[0], q[3]) * k, 0, 0);
  };
  const animate = (c: PoseCtx, clip: string): void => {
    damp(c, 'skirt_b', 0.5);
    damp(c, 'skirt_f', 0.8);
    const st = orbState(clip, c.t, c.u);
    // wrist-local, rest-aligned axes: +X is the right palm normal, -Y points to the fingertips
    const push = st.push * a.s / 0.9;
    c.move('orb', palmOff[0] + push - restOff[0], palmOff[1] - 0.01 * a.s - restOff[1], palmOff[2] + 0.015 * a.s - restOff[2]);
    c.set('orb', 0, st.spin, 0);
    c.scale('orb', st.scale);
  };
  return {
    merge: { toe_l: 'foot_l', toe_r: 'foot_r' },
    extra, animate,
    tweak: (def, parts) => {
      const an = parts.anatomy, s = an.s;
      def.radius = 0.34;
      // spend the triangle budget where the camera looks: face, the casting hand (thin fingers), the other hand
      def.mesh.focus = [
        { c: an.skull, r: 0.2 * s, gain: 3.4 },
        { c: an.side(-1).palm, r: 0.13 * s, gain: 4.5 },
        { c: an.side(1).palm, r: 0.12 * s, gain: 2.8 },
      ];
    },
  };
}

// ------------------------------------------------------------------------------------------------ clips
function leaderClips(clips: ClipSpec[], a: Anatomy, sk: Skeleton): ClipSpec[] {
  void clips;
  const idle: Pose = poseOf(stance(0.1, 0.07, 0.015), {
    sp: [0.02, 0.12, 0], hip: [0, -0.06, 0.02], head: [0.0, -0.05, 0],
    r: READY_R, l: HIP_L,
    poleR: V(-0.6, -0.6, -0.4), poleL: V(0.9, -0.15, -0.6),
  });
  const env = makeEnv(a, sk, idle, {}, { flow: 1.3 });
  const ready = (g: V3, fingers: V3, palm: V3, curl = 0.1): Hand => handOf('r', g, fingers, palm, curl);
  return [
    idleClip(env, { dur: 3.2, look: 0.08, breath: 0.018 }),
    gaitClip(env, 'walk', { ...LEADER_WALK, carry: { r: READY_R, l: HIP_L, sp: [0, 0.1, 0] } }),
    gaitClip(env, 'run', { ...LEADER_RUN, carry: { r: handOf('r', V(-0.26, -0.02, 0.26), V(-0.1, 0.4, 1), V(0.4, 1, 0.1), 0.15), l: handOf('l', V(0.22, -0.22, 0.1), V(0.1, -1, 0.3), V(-1, 0, 0), 0.5), sp: [0.04, 0.05, 0] } }),
    actionClip(env, {
      name: 'attack', dur: 1.15, hit: RELEASE, flow: 1.2,
      keys: [
        { t: 0, p: {} },
        // draw back: hand to the shoulder, palm turned forward, torso coils to the right, weight back
        { t: 0.22, ease: 'smooth', p: { r: ready(V(-0.2, 0.1, 0.1), V(0.1, 1, 0.3), V(0.3, 0.2, 1), 0.12), l: handOf('l', V(0.28, 0.0, 0.26), V(0.3, 0.8, 0.8), V(-0.6, 0.5, 0.4), 0.2), sp: [-0.06, -0.3, 0], hip: [0, -0.15, 0.02], head: [-0.02, 0.2, 0], root: V(0, -0.045, -0.04), fl: V(0.12, 0, 0.0), fr: V(-0.12, 0, -0.16), poleR: V(-0.6, -0.2, -0.5), poleL: V(0.5, -0.4, -0.5) } },
        // hold + charge (small shiver)
        { t: 0.38, ease: 'smooth', p: { r: ready(V(-0.19, 0.12, 0.08), V(0.1, 1, 0.25), V(0.3, 0.2, 1), 0.05), sp: [-0.08, -0.36, 0], hip: [0, -0.18, 0.02], root: V(0, -0.05, -0.05) } },
        // thrust: arm snaps out, palm forward, fingers up and spread, torso uncoils, front foot steps in
        { t: RELEASE, ease: 'in', p: { r: ready(V(-0.22, 0.1, 0.5), V(0.0, 1, 0.12), V(-0.15, 0.4, 1), 0.0), l: handOf('l', V(0.28, -0.12, -0.02), V(0.3, -0.6, 0.6), V(-0.7, 0.4, 0.2), 0.4), sp: [0.16, 0.12, 0], hip: [0, 0.08, 0.02], head: [0.04, -0.15, 0], root: V(0, -0.1, 0.12), fl: V(0.12, 0, 0.3), fr: V(-0.12, 0, -0.12), poleR: V(-0.8, -0.5, -0.2), poleL: V(0.8, -0.2, -0.5) } },
        { t: 0.75, ease: 'out', p: { r: ready(V(-0.22, 0.1, 0.54), V(0.0, 1, 0.1), V(-0.15, 0.4, 1), 0.0), root: V(0, -0.11, 0.13) } },
        { t: 1.15, ease: 'smooth', p: { ...idle } },
      ],
    }),
    actionClip(env, {
      name: 'attack2', dur: 1.3, flow: 1.4,
      keys: [
        { t: 0, p: {} },
        // raise both arms: call the wind
        { t: 0.4, ease: 'smooth', p: { r: ready(V(-0.28, 0.5, 0.2), V(-0.2, 1, 0.3), V(0.5, 0.2, 1), 0.1), l: handOf('l', V(0.28, 0.46, 0.18), V(0.2, 1, 0.3), V(-0.5, 0.2, 1), 0.1), sp: [-0.14, 0, 0], head: [-0.15, 0, 0], root: V(0, 0.0, -0.02), fl: V(0.13, 0, 0.0), fr: V(-0.13, 0, -0.06) } },
        { t: 0.6, ease: 'smooth', p: { r: ready(V(-0.28, 0.54, 0.22), V(-0.2, 1, 0.3), V(0.5, 0.2, 1), 0.05), l: handOf('l', V(0.28, 0.5, 0.2), V(0.2, 1, 0.3), V(-0.5, 0.2, 1), 0.05) } },
        // sweep down and across: command
        { t: 0.9, ease: 'in', p: { r: ready(V(-0.1, -0.1, 0.46), V(0.4, 0.1, 1), V(0, 1, 0.2), 0.1), l: handOf('l', V(0.3, -0.1, 0.4), V(-0.1, 0.1, 1), V(0, 1, 0.2), 0.1), sp: [0.2, 0.0, 0], head: [0.05, 0, 0], root: V(0, -0.08, 0.1), fl: V(0.12, 0, 0.26), fr: V(-0.12, 0, -0.1) } },
        { t: 1.3, ease: 'smooth', p: { ...idle } },
      ],
    }),
    hitClip(env, { dur: 0.55, recoil: -0.3, twist: 0.2, drop: 0.04, shove: 0.12 }),
    deathClip(env, { dur: 1.9, fall: 'back', topple: 0.45 }),
    spawnClip(env, [
      { t: 0, p: { root: V(0, -0.3, 0), sp: [0.4, -0.1, 0], head: [0.3, 0, 0], fl: V(0.1, 0, 0.1), fr: V(-0.1, 0, -0.1) } },
      { t: 0.6, ease: 'smooth', p: { root: V(0, -0.1, 0), sp: [0.15, 0.05, 0], head: [0.1, 0.1, 0] } },
      { t: 1.0, ease: 'out', p: { ...idle, root: V(0, 0.01, 0), sp: [-0.06, 0.1, 0], head: [-0.06, -0.05, 0] } },
      { t: 1.4, ease: 'smooth', p: { ...idle } },
    ], 1.4),
  ];
}

// ------------------------------------------------------------------------------------------------ params
const PALETTE = {
  ...OATH_PALETTE,
  cloth: '#4a62b0', cloth2: '#e6dfd0', cloth3: '#2a2730', sash: '#c2372d', leather2: '#2a1c16',
  plate: '#c4ccd8', plate2: '#8e97a6', plateHi: '#f2f5f9', gold: '#e2b84f', trim: '#b3302a', paper: '#efe6c8',
};

export function leaderParams(): HumanoidParams {
  const outfit: PieceSpec[] = [
    { id: 'trousers', mat: 'cloth3', o: { baggy: 0.08, end: 0.92, trim: 'none' } },
    { id: 'boots', mat: 'leather2', o: { start: 0.3, trim: 'plate2' } },
    { id: 'greaves', mat: 'plate2', o: { cop: 1, trim: 'trim' } },
    { id: 'tunic', mat: 'cloth', o: { sleeve: 0, collar: 'crew', hem: 0.1, trim: 'cloth2' } },
    { id: 'battleSkirt', mat: 'cloth', build: battleSkirt, o: { flare: 1, trim: 'cloth2' } },
    { id: 'flareSleeves', mat: 'cloth2', build: flareSleeves, o: { wide: 0.03, trim: 'trim' } },
    { id: 'cuirass', mat: 'plate', o: { style: 'plate', bands: 2, emblem: 0.9, emblemMat: 'gold', trim: 'trim' } },
    { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.55, y: -0.07, width: 0.055, trim: 'none' } },
    { id: 'pauldron', mat: 'plate', o: { lames: 2, size: 0.8, trim: 'trim' } },
    { id: 'collar', mat: 'cloth2', o: { height: 0.075, flare: 0.03, trim: 'trim' } },
    { id: 'crown', mat: 'gold', build: crown, o: { rise: 1.45, trim: 'none' } },
  ];
  return {
    id: 'silver_vow_leader', kind: 'creature', seed: 'silver_vow_leader', sex: 'f', bodyHeight: BODY_H,
    build: { shoulder: 0.9, chest: 0.92, waist: 0.8, hips: 0.95, legs: 1.0, muscle: 0.1, head: 1.12, neck: 0.95, legLength: LEG, hands: 1.2, bust: 0.25 },
    face: { ...OATH_FACE, jaw: 0.2, brow: 0.22, nose: 0.4, lips: 0.7, eyes: 1.2, cheeks: 0.7, slant: 0.28 },
    skin: { base: '#e0bc9a', shade: '#b48a68', lip: '#b8605a', eye: '#2a1a10', brow: '#2a1a14' }, hair: { style: 'braid', color: '#241a18', highlight: '#4a3a34', volume: 1.3 },
    outfit, palette: PALETTE, style: 'none',
    glow: { color: '#9ff4ff', tags: ['glow'] },
    rig: { skirt: true, hairBones: 2 },
    tris: 4900, voxel: 0.0055, texture: 1024, liteHands: true, speed: { walk: r3(gaitSpeedOf(LEADER_WALK, S)), run: r3(gaitSpeedOf(LEADER_RUN, S)) },
    hooks: {
      afterBody: (ctx) => {
        // lats: a slim armoured torso would read as a barrel; mouth slit + nostril wings: at this voxel size they are deep pits that the
        // clay sheet shades black, so the paint grows a dark moustache under the nose
        trimBody(ctx, (n) => n.startsWith('lat_') || n === 'mouth' || n.startsWith('nose_ala'));
        openHand(ctx, -1);
        openHand(ctx, 1, { splay: 0.1, curl: 0.45, thick: 1.15 });
      },
      afterOutfit: (ctx) => {
        const p = ctx.piece('plateHi');
        addOrb(ctx, ctx.a, 'r', [p.tag, 'glow']);
      },
      clips: leaderClips,
    },
  };
}

export const leader: HumanModel = { params: leaderParams, rig: orbRig };

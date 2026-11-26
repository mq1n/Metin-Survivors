// Plagued family (Seori): infected villager, rusted-armour soldier, hooded archer, bone-crowned war-chief.
// Built on the crowd humanoid pipeline (archetypes/humans/rigx.ts -> humanoid archetype + giant/pipeline buildCrowd).
// Look: sickly grey-green flesh, boils/tumours, filthy bandages, rusted iron. Base albedo is pale so the per-enemy tints
// (#c8506a / #a8c0a0 / #d8708a) multiply cleanly; the Painter repaint adds the final surface.
import type { ClipSpec } from '../../core/anim/clip.ts';
import { type Vec3, vadd, vnorm, vscale } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import { SmoothSubtract } from '../../core/sdf/ops.ts';
import { Ellipsoid, RoundCone, Sphere, Torus } from '../../core/sdf/primitives.ts';
import { flatCone } from '../../core/sdf/shapes.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy, Ctx, HumanoidParams, PieceEnv, PieceSpec, Pose } from '../../archetypes/humanoid/index.ts';
import { V } from '../../archetypes/humanoid/index.ts';
import { type GaitSpec, actionClip, deathClip, gaitClip, gaitSpeedOf, grip, hang, hitClip, idleClip, makeEnv, poseOf, spawnClip, stance } from '../../archetypes/humans/anim.ts';
import { type BowOpts, type BowState, addBow, addQuiver, bowRig } from '../../archetypes/humans/bow.ts';
import { handRef, hp, leaf, rigid, rod } from '../../archetypes/humans/kit.ts';
import type { HumanModel } from '../../archetypes/humans/rigx.ts';

const SKIN = { base: '#97a285', shade: '#58634b', lip: '#5b3d3b', eye: '#d6e65c', brow: '#2b3024' };
const PALETTE = {
  cloth: '#8a8064', cloth2: '#615a46', rag: '#a39a7c', leather: '#4f3b2a', leather2: '#33271c', plate: '#7a6249', plate2: '#5b4a39',
  bone: '#d1c8aa', boil: '#b8a56c', wrap: '#cbc3a6', iron: '#6f726e', wood: '#4a3a2b', black: '#1a171a', gold: '#a8883a',
};

/** hand-authored ground speed for a gait at the body scale used by the model */
const speedOf = (h: number, walk: GaitSpec, run: GaitSpec): { walk: number; run: number } => {
  const s = h / 1.76;
  return { walk: Number(gaitSpeedOf(walk, s).toFixed(3)), run: Number(gaitSpeedOf(run, s).toFixed(3)) };
};

// ------------------------------------------------------------------------------------------------ shared geometry
/** boils / tumours: soft spheres on the back, shoulders, neck and upper arms, with a pale head (tag `boil`) */
function addBoils(ctx: Ctx, count: number, seed: string, o: { size?: number; back?: boolean } = {}): void {
  const a = ctx.a, s = a.s;
  const rng = new Rng(seed);
  const piece = ctx.piece('boil');
  for (let i = 0; i < count; i++) {
    const st = a.torso[1 + Math.floor(rng.next() * (a.torso.length - 2))]!;
    const th = o.back === false ? rng.range(-1.4, 1.4) : rng.range(0.4, 5.9);
    const r = (0.03 + 0.026 * rng.next()) * (o.size ?? 1) * s;
    const c: Vec3 = [(st.cx ?? 0) + st.rx * Math.sin(th) * 0.97, st.y, (st.cz ?? 0) + st.rz * Math.cos(th) * 0.97];
    ctx.add(`boil${i}`, new Ellipsoid(c, [r, r * 0.9, r * 0.8]), 'chest', { tags: [piece.tag, 'boil'], w: 0.012 * s });
  }
  for (const sx of [1, -1] as const) {
    const j = a.side(sx);
    const sd = sx === 1 ? 'l' : 'r';
    for (let i = 0; i < 2; i++) {
      const t = 0.25 + 0.4 * rng.next();
      const c: Vec3 = [j.shoulder[0] + (j.elbow[0] - j.shoulder[0]) * t + sx * 0.04 * s, j.shoulder[1] + (j.elbow[1] - j.shoulder[1]) * t, j.shoulder[2] + (j.elbow[2] - j.shoulder[2]) * t - 0.02 * s];
      const r = (0.02 + 0.014 * rng.next()) * (o.size ?? 1) * s;
      ctx.add(`boil_arm_${sd}${i}`, new Sphere(c, r), `upper_arm_${sd}`, { tags: [piece.tag, 'boil'], w: 0.01 * s });
    }
  }
}

/** mummy-style bandage wraps around the head with a trailing end; `eye` leaves one eye covered by a diagonal band */
function bandages(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs;
  const sk = a.skull;
  const bands: [number, number, number][] = [[-0.08, 0.082, 0.1], [-0.055, 0.089, -0.12], [0.062, 0.096, 0.15], [0.082, 0.088, -0.1], [0.0, 0.098, 0.95]];
  bands.forEach(([dy, R, tilt], i) => {
    const sh = Math.sin(tilt);
    e.ctx.add(`${e.spec.id}_band${i}`, new Torus([sk[0], sk[1] + dy * k, sk[2] - 0.004 * k], R * k, 0.0155 * k, [sh, 1, -0.1 * sh]), 'head', { tags: e.tag(e.mat, 'wrap'), w: 0.004, grip: 1.5 });
  });
  const c: Vec3 = [0.075 * k, sk[1] + 0.03 * k, sk[2] - 0.075 * k];
  e.ctx.add(`${e.spec.id}_tailA`, flatCone(c, [c[0] + 0.05 * k, c[1] - 0.26 * k, c[2] - 0.03 * k], 0.026 * k, 0.012 * k, 0.28, [1, 0, 0]), 'head', { tags: e.tag(e.mat, 'strip'), w: 0.004 });
  e.ctx.add(`${e.spec.id}_tailB`, flatCone([-0.06 * k, c[1] - 0.03 * k, c[2] + 0.01 * k], [-0.1 * k, c[1] - 0.2 * k, c[2] - 0.02 * k], 0.022 * k, 0.01 * k, 0.28, [1, 0, 0]), 'head', { tags: e.tag(e.mat, 'strip'), w: 0.004 });
}

/** ragged hood: a cowl dome with a face opening, a back drape and torn strips */
function raggedHood(e: PieceEnv): void {
  const { a } = e;
  const k = a.s * a.hs, s = a.s;
  const sk = a.skull;
  const dome = new Ellipsoid([sk[0], sk[1] + 0.012 * k, sk[2] - 0.016 * k], [0.12 * k, 0.13 * k, 0.138 * k]);
  const face = new Ellipsoid([sk[0], sk[1] - 0.018 * k, sk[2] + 0.1 * k], [0.078 * k, 0.088 * k, 0.085 * k]);
  e.ctx.add(`${e.spec.id}_hood`, new SmoothSubtract(dome, [{ node: face, w: 0.006 * k }]), 'head', { tags: e.tag(e.mat, 'hood'), w: 0.006, grip: 1.5 });
  const b: Vec3 = [0, sk[1] - 0.05 * k, sk[2] - 0.1 * k];
  e.ctx.add(`${e.spec.id}_drape`, flatCone(b, [0, b[1] - 0.2 * s, b[2] - 0.05 * s], 0.13 * k, 0.1 * k, 0.28, [1, 0, 0]), 'neck', { tags: e.tag(e.mat, 'strip'), w: 0.006 });
  for (const sx of [-1, 1]) {
    e.ctx.add(`${e.spec.id}_tatter${sx}`, flatCone([sx * 0.1 * k, sk[1] - 0.03 * k, sk[2] + 0.02 * k], [sx * 0.12 * k, sk[1] - 0.2 * k, sk[2] - 0.01 * k], 0.03 * k, 0.012 * k, 0.28, [1, 0, 0]), 'head', { tags: e.tag(e.mat, 'strip'), w: 0.004 });
  }
}

/** crown of bone spikes + two skull horns, riveted to a ring */
function addBoneCrown(ctx: Ctx, a: Anatomy, mat: string): void {
  const k = a.s * a.hs;
  const sk = a.skull;
  const bone = ctx.piece(mat);
  const y = sk[1] + 0.07 * k;
  rigid(ctx, 'crown_ring', new Torus([sk[0], y, sk[2] - 0.004 * k], 0.098 * k, 0.015 * k, [0, 1, 0]), 'head', [bone.tag], 0.004);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const th = (-1.1 + (i / (n - 1)) * 2.2) * Math.PI * 0.62; // open at the back
    const base: Vec3 = [sk[0] + Math.sin(th) * 0.098 * k, y, sk[2] + Math.cos(th) * 0.098 * k - 0.004 * k];
    const h = (0.07 + 0.06 * Math.cos(i * 1.7) ** 2) * k * (i === 4 ? 1.5 : 1);
    const tip: Vec3 = [base[0] * 0.98 + Math.sin(th) * 0.014 * k, base[1] + h, base[2] + Math.cos(th) * 0.014 * k];
    rigid(ctx, `crown_spike${i}`, rod(base, tip, 0.017 * k, 0.003 * k), 'head', [bone.tag], 0.004);
  }
  for (const sx of [1, -1]) {
    const base: Vec3 = [sk[0] + sx * 0.1 * k, y + 0.012 * k, sk[2] - 0.03 * k];
    const mid: Vec3 = [base[0] + sx * 0.09 * k, base[1] + 0.05 * k, base[2] - 0.05 * k];
    const tip: Vec3 = [mid[0] + sx * 0.05 * k, mid[1] + 0.14 * k, mid[2] - 0.07 * k];
    rigid(ctx, `crown_horn${sx}a`, rod(base, mid, 0.022 * k, 0.016 * k), 'head', [bone.tag], 0.004);
    rigid(ctx, `crown_horn${sx}b`, rod(mid, tip, 0.016 * k, 0.003 * k), 'head', [bone.tag], 0.004);
  }
}

interface SwordOpts {
  /** blade length / half width / half thickness (m) */
  len: number;
  halfW: number;
  halfT: number;
  /** grip length behind the fist (m) */
  hilt?: number;
  /** number of bites out of the cutting edges */
  notches?: number;
  mats: { metal: string; wood: string; cloth: string };
  /** cleaver-style broad tip (leader) */
  broad?: boolean;
}

/** notched, rusted sword held in the right fist: blade along the grip axis (+Z), flat faces lateral, edges up / down */
function addSword(ctx: Ctx, a: Anatomy, o: SwordOpts): void {
  const h = handRef(a, 'r');
  const s = a.s;
  const metal = ctx.piece(o.mats.metal), wood = ctx.piece(o.mats.wood), cloth = ctx.piece(o.mats.cloth);
  const hilt = (o.hilt ?? 0.12) * s, len = o.len * s, hw = o.halfW * s, ht = o.halfT * s;
  const face: Vec3 = [-h.sx, 0, 0];
  rigid(ctx, 'sword_grip', rod(hp(h, 0, 0, -hilt), hp(h, 0, 0, 0.07 * s), 0.0195 * s, 0.0195 * s), h.bone, [wood.tag]);
  rigid(ctx, 'sword_pommel', new Sphere(hp(h, 0, 0, -hilt - 0.01 * s), 0.03 * s), h.bone, [metal.tag]);
  rigid(ctx, 'sword_guard', rod(hp(h, 0, -0.095 * s, 0.085 * s), hp(h, 0, 0.095 * s, 0.085 * s), 0.016 * s, 0.016 * s), h.bone, [metal.tag]);
  rigid(ctx, 'sword_wrap', rod(hp(h, 0, 0, -0.03 * s), hp(h, 0, 0, 0.06 * s), 0.0225 * s, 0.0225 * s), h.bone, [cloth.tag]);
  const z0 = 0.09 * s;
  rigid(ctx, 'sword_blade', leaf(hp(h, 0, 0, z0), hp(h, 0, 0, z0 + len), hw, ht, face), h.bone, [metal.tag], 0.003);
  rigid(ctx, 'sword_spine', rod(hp(h, 0, 0.0, z0 + 0.02 * s), hp(h, 0, 0.0, z0 + len * 0.92), ht * 1.25, ht * 0.6), h.bone, [metal.tag], 0.003);
  if (o.broad) rigid(ctx, 'sword_tipmass', new Ellipsoid(hp(h, 0, 0, z0 + len * 0.78), [ht * 1.3, hw * 0.78, len * 0.2], [0, 0, 0, 1]), h.bone, [metal.tag], 0.004);
  for (let i = 0; i < (o.notches ?? 0); i++) {
    const z = z0 + len * (0.28 + 0.13 * i + 0.03 * Math.sin(i * 5));
    const side = i % 2 === 0 ? 1 : -1;
    ctx.cut(`sword_notch${i}`, new Sphere(hp(h, 0, side * hw * 0.98, z), hw * 0.34), h.bone, { tags: [metal.tag], w: 0.002 });
  }
}

// ------------------------------------------------------------------------------------------------ blighted_villager
function manClips(clips: ClipSpec[], a: Anatomy, sk: Skeleton): ClipSpec[] {
  void clips;
  const idle: Pose = poseOf(stance(0.11, 0.05, 0.03), { sp: [0.2, 0.05, 0.05], hip: [0, 0, 0.04], head: [-0.05, 0.12, 0.16], r: hang('r', 0.5, V(-0.25, -0.36, 0.14)), l: hang('l', 0.75, V(0.24, -0.34, 0.12)), shr: 0.05, shl: -0.02 });
  const env = makeEnv(a, sk, idle, {}, { flow: 1.1 });
  const walk: GaitSpec = { T: 1.3, duty: 0.64, sweep: 0.36, lift: 0.07, bob: 0.01, lean: 0.1, twist: 0.12, armSwing: 0.1, headStab: 0.25, loll: 0.1, drag: 0.5, limp: { leg: 'l', short: 0.35, dip: 0.04 }, hipYaw: 0.1 };
  const run: GaitSpec = { T: 0.72, duty: 0.4, sweep: 0.78, lift: 0.16, bob: 0.04, lean: 0.38, twist: 0.3, hipYaw: 0.2, armSwing: 0.22, headStab: 0.2, loll: 0.15, run: true, crouch: 0.05, width: 0.4, reach: 1.0 };
  void speedOf;
  return [
    idleClip(env, { dur: 3.0, breath: 0.03, look: 0.14, shift: 0.012 }),
    gaitClip(env, 'walk', walk),
    gaitClip(env, 'run', run),
    actionClip(env, {
      name: 'attack', dur: 1.1, hit: 0.44,
      keys: [
        { t: 0, p: {} },
        // both clawed hands rise over the head, torso thrown back
        { t: 0.3, ease: 'out', p: { r: { g: V(-0.2, 0.55, 0.05), b: V(0, 0.4, 0.9), c: 0.1 }, l: { g: V(0.2, 0.5, 0.05), b: V(0, 0.4, 0.9), c: 0.1 }, sp: [-0.2, 0.0, 0], head: [-0.2, 0, 0], root: V(0, -0.02, -0.08) } },
        // lurch: claws rake down in front, whole body falls into the strike
        { t: 0.44, ease: 'in', p: { r: { g: V(-0.16, -0.05, 0.62), b: V(0, -0.3, 0.95), c: 0.1 }, l: { g: V(0.16, -0.05, 0.62), b: V(0, -0.3, 0.95), c: 0.1 }, sp: [0.7, 0.1, 0], head: [0.2, 0, 0], root: V(0, -0.12, 0.2), fl: V(0.12, 0, 0.42) } },
        { t: 0.62, ease: 'out', p: { r: { g: V(-0.18, -0.2, 0.55), c: 0.2 }, l: { g: V(0.18, -0.2, 0.55), c: 0.2 }, root: V(0, -0.1, 0.18) } },
        { t: 1.1, ease: 'smooth', p: { ...idle } },
      ],
    }),
    hitClip(env, { dur: 0.55, recoil: -0.4, twist: 0.3, drop: 0.07, shove: 0.12 }),
    deathClip(env, { dur: 2.0, fall: 'front', topple: 0.5, flail: 0.6, stagger: 0.2 }),
    spawnClip(env, [
      { t: 0, p: { root: V(0, -0.55, 0), sp: [1.0, 0, 0], head: [0.5, 0, 0], fl: V(0.16, 0, 0.12), fr: V(-0.16, 0, 0.16), r: { g: V(-0.26, -0.3, 0.45), c: 0.3 }, l: { g: V(0.26, -0.3, 0.45), c: 0.3 } } },
      { t: 0.7, ease: 'smooth', p: { root: V(0, -0.25, 0), sp: [0.7, 0, 0], head: [0.3, 0, 0] } },
      { t: 1.3, ease: 'out', p: { ...idle, head: [-0.1, 0.1, 0.1] } },
      { t: 1.7, ease: 'smooth', p: { ...idle } },
    ], 1.7),
  ];
}

export function manParams(): HumanoidParams {
  const outfit: PieceSpec[] = [
    { id: 'trousers', mat: 'cloth2', o: { baggy: 0.3, end: 0.8 } },
    { id: 'wraps', mat: 'wrap', o: { where: 'shin', rings: 7, start: 0.3 } },
    { id: 'robe', mat: 'cloth', o: { hem: 0.35, open: 0.4, flare: 0.8, collar: 'crew' } },
    { id: 'sash', mat: 'leather', o: { tails: 2, tail: 0.38, y: -0.04, knot: true } },
    { id: 'wraps', mat: 'wrap', o: { where: 'forearm', rings: 4 } },
    { id: 'bandages', mat: 'wrap', build: bandages },
  ];
  const walk = { T: 1.3, duty: 0.64, sweep: 0.36 } as GaitSpec;
  const run = { T: 0.72, duty: 0.4, sweep: 0.78 } as GaitSpec;
  return {
    id: 'blighted_villager', kind: 'creature', seed: 'blighted_villager', sex: 'm', bodyHeight: 1.7,
    build: { shoulder: 0.92, chest: 0.9, waist: 0.88, legs: 0.95, arms: 0.95, forearms: 1.05, muscle: 0.15, neck: 0.85, hands: 1.2, lean: 0.2, headForward: 0.05, head: 1.05, armLength: 1.06, stance: 0.9 },
    face: { jaw: 0.3, brow: 0.55, nose: 0.5, lips: 0.25, eyes: 0.9, cheeks: 0.2 },
    skin: SKIN, hair: { style: 'none', color: '#2a2620' }, outfit, palette: PALETTE, style: 'none', rig: { skirt: true },
    speed: speedOf(1.7, walk, run),
    tris: 4800, voxel: 0.008, texture: 1024, liteHands: true,
    hooks: { afterBody: (ctx) => addBoils(ctx, 9, 'blighted_villager', { size: 1.0 }), clips: manClips },
  };
}

// ------------------------------------------------------------------------------------------------ blighted_swordsman
function warriorClips(clips: ClipSpec[], a: Anatomy, sk: Skeleton): ClipSpec[] {
  void clips;
  const idle: Pose = poseOf(stance(0.13, 0.08, 0.05), { sp: [0.2, 0.08, 0.03], hip: [0, 0.08, 0.02], head: [0.1, -0.1, 0.1], r: grip(V(-0.2, -0.22, 0.3), V(0.02, -0.4, 0.92), V(0.92, 0.3, 0), 0.95), l: hang('l', 0.6, V(0.27, -0.4, 0.1)) });
  const env = makeEnv(a, sk, idle, {}, { flow: 0.8 });
  const walk: GaitSpec = { T: 1.05, duty: 0.62, sweep: 0.5, lift: 0.1, bob: 0.014, lean: 0.07, twist: 0.12, armSwing: 0.06, headStab: 0.5, loll: 0.05, limp: { leg: 'r', short: 0.2, dip: 0.03 }, drag: 0.2 };
  const run: GaitSpec = { T: 0.66, duty: 0.4, sweep: 0.84, lift: 0.17, bob: 0.034, lean: 0.24, twist: 0.2, hipYaw: 0.2, armSwing: 0.12, headStab: 0.4, run: true, crouch: 0.03, stomp: 0.01, width: 0.42, reach: 1.0,
    carry: { r: grip(V(-0.2, -0.16, 0.34), V(0.05, -0.2, 0.98), V(0.92, 0.3, 0), 1) } };
  return [
    idleClip(env, { dur: 2.8, breath: 0.022, look: 0.1 }),
    gaitClip(env, 'walk', walk),
    gaitClip(env, 'run', run),
    actionClip(env, {
      name: 'attack', dur: 1.0, hit: 0.42,
      keys: [
        { t: 0, p: {} },
        { t: 0.26, ease: 'out', p: { r: { g: V(-0.2, 0.5, -0.08), b: V(0, 0.85, 0.5), c: 1 }, sp: [-0.3, 0.4, 0], hip: [0, 0.2, 0], root: V(0, -0.04, -0.07), fl: V(0.13, 0, 0.1), fr: V(-0.13, 0, -0.2) } },
        { t: 0.42, ease: 'in', p: { r: { g: V(-0.12, 0.0, 0.6), b: V(0, -0.25, 0.95), c: 1 }, sp: [0.45, -0.45, 0], hip: [0, -0.3, 0], root: V(0, -0.14, 0.16), fl: V(0.14, 0, 0.44), fr: V(-0.13, 0, -0.16), head: [0.12, 0.1, 0] } },
        { t: 0.58, ease: 'out', p: { r: { g: V(-0.12, -0.1, 0.62) }, root: V(0, -0.13, 0.17) } },
        { t: 1.0, ease: 'smooth', p: { ...idle } },
      ],
    }),
    hitClip(env, { dur: 0.5, recoil: -0.35, twist: 0.25, drop: 0.05, shove: 0.12 }),
    deathClip(env, { dur: 1.9, fall: 'back', topple: 0.45 }),
    spawnClip(env, [
      { t: 0, p: { root: V(0, -0.6, 0), sp: [0.9, 0, 0], head: [0.4, 0, 0], fl: V(0.15, 0, 0.2), fr: V(-0.15, 0, -0.1), r: { g: V(-0.25, -0.35, 0.4), b: V(0, -0.3, 0.9), c: 1 } } },
      { t: 0.7, ease: 'smooth', p: { root: V(0, -0.28, 0), sp: [0.55, 0, 0], head: [0.25, 0, 0] } },
      { t: 1.25, ease: 'out', p: { ...idle, root: V(0, 0.01, 0), head: [-0.1, -0.1, 0.1] } },
      { t: 1.6, ease: 'smooth', p: { ...idle } },
    ], 1.6),
  ];
}

export function warriorParams(): HumanoidParams {
  const outfit: PieceSpec[] = [
    { id: 'trousers', mat: 'cloth2', o: { baggy: 0.15, end: 0.9 } },
    { id: 'wraps', mat: 'wrap', o: { where: 'shin', rings: 6 } },
    { id: 'boots', mat: 'leather2', o: { start: 0.7 } },
    { id: 'tunic', mat: 'cloth', o: { sleeve: 0.6, collar: 'v', hem: 0.12 } },
    { id: 'cuirass', mat: 'plate', o: { style: 'plate', bands: 2, ridge: true, low: -0.02, straps: true, strapMat: 'leather' } },
    { id: 'tassets', mat: 'plate2', o: { count: 6, len: 0.2, flare: 0.3 } },
    { id: 'pauldron', mat: 'plate', o: { lames: 3, size: 1.25 } },
    { id: 'vambrace', mat: 'leather', o: { from: 0.55 } },
    { id: 'belt', mat: 'leather2', o: { y: -0.03 } },
    { id: 'bandages', mat: 'wrap', build: bandages },
  ];
  const walk = { T: 1.05, duty: 0.62, sweep: 0.5 } as GaitSpec;
  const run = { T: 0.66, duty: 0.4, sweep: 0.84 } as GaitSpec;
  return {
    id: 'blighted_swordsman', kind: 'creature', seed: 'blighted_swordsman', sex: 'm', bodyHeight: 1.8,
    build: { shoulder: 1.06, chest: 1.0, waist: 0.92, legs: 1.0, muscle: 0.5, neck: 0.95, hands: 1.1, lean: 0.2, headForward: 0.05, armLength: 1.04 },
    face: { jaw: 0.5, brow: 0.6, nose: 0.5, lips: 0.3, eyes: 0.9, cheeks: 0.3 },
    skin: SKIN, hair: { style: 'none', color: '#2a2620' }, outfit, palette: PALETTE, style: 'none',
    speed: speedOf(1.8, walk, run),
    tris: 4800, voxel: 0.008, texture: 1024, liteHands: true,
    hooks: {
      afterBody: (ctx) => addBoils(ctx, 5, 'blighted_swordsman', { size: 0.9 }),
      afterOutfit: (ctx) => addSword(ctx, ctx.a, { len: 0.82, halfW: 0.036, halfT: 0.012, notches: 3, mats: { metal: 'iron', wood: 'wood', cloth: 'wrap' } }),
      clips: warriorClips,
    },
  };
}

// ------------------------------------------------------------------------------------------------ blighted_archer
function archerBow(): BowOpts {
  return { hand: 'l', arrow: 0.62, mats: { wood: 'wood', leather: 'leather', cloth: 'wrap', metal: 'iron', fletch: 'black' } };
}

const bowState = (clip: string, t: number): BowState => {
  if (clip === 'attack') {
    const draw = t < 0.12 ? 0 : t < 0.5 ? (t - 0.12) / 0.38 : t < 0.56 ? -0.12 * Math.sin(((t - 0.5) / 0.06) * Math.PI) : 0;
    const arrow = t < 0.5 ? 1 : t < 0.95 ? 0 : (t - 0.95) / 0.1;
    return { draw: Math.max(-0.2, Math.min(1, draw)), arrow: Math.max(0, Math.min(1, arrow)) };
  }
  return { draw: 0, arrow: clip === 'death' || clip === 'hit' ? 1 : 1 };
};

function archerClips(clips: ClipSpec[], a: Anatomy, sk: Skeleton): ClipSpec[] {
  void clips;
  // bow carried low in the left hand, right hand loose; torso hunched
  const idle: Pose = poseOf(stance(0.12, 0.06, 0.04), { sp: [0.22, 0.1, 0.03], hip: [0, 0.05, 0], head: [0.12, -0.1, 0.1], l: grip(V(0.22, -0.2, 0.3), V(0.1, 0.95, 0.2), V(0, 0, 1), 0.95), r: hang('r', 0.6, V(-0.24, -0.34, 0.1)) });
  const env = makeEnv(a, sk, idle, {}, { flow: 1.0 });
  const walk: GaitSpec = { T: 1.1, duty: 0.62, sweep: 0.46, lift: 0.09, bob: 0.014, lean: 0.08, twist: 0.12, armSwing: 0.06, headStab: 0.4, loll: 0.06, limp: { leg: 'l', short: 0.2, dip: 0.025 } };
  const run: GaitSpec = { T: 0.68, duty: 0.4, sweep: 0.8, lift: 0.17, bob: 0.034, lean: 0.24, twist: 0.2, armSwing: 0.1, headStab: 0.4, run: true, crouch: 0.03, width: 0.42, reach: 1.0,
    carry: { l: grip(V(0.22, -0.12, 0.3), V(0.1, 0.9, 0.3), V(0, 0, 1), 1) } };
  return [
    idleClip(env, { dur: 2.8, breath: 0.024, look: 0.12 }),
    gaitClip(env, 'walk', walk),
    gaitClip(env, 'run', run),
    actionClip(env, {
      name: 'attack', dur: 1.3, hit: 0.5,
      keys: [
        { t: 0, p: {} },
        // turn side-on, throw the bow arm out toward the target, hook the string
        { t: 0.16, ease: 'out', p: { sp: [0.08, -1.0, 0], hip: [0, -0.35, 0], head: [0.0, 1.0, 0], l: { g: V(0.5, 0.12, 0.08), b: V(0, 1, 0.05), e: V(0, 0, -1), c: 1 }, r: { g: V(0.3, 0.14, 0.02), b: V(0.1, 0.2, 1), e: V(0, 1, 0), c: 0.8 }, root: V(0, -0.05, 0), fl: V(0.14, 0, 0.3), fr: V(-0.14, 0, -0.3) } },
        // full draw: string hand at the cheek
        { t: 0.5, ease: 'smooth', p: { sp: [0.06, -1.05, 0], hip: [0, -0.35, 0], head: [0.0, 1.05, 0], l: { g: V(0.52, 0.12, 0.08), b: V(0, 1, 0.05), e: V(0, 0, -1), c: 1 }, r: { g: V(0.0, 0.24, 0.1), b: V(0.1, 0.2, 1), e: V(0, 1, 0), c: 0.8 }, root: V(0, -0.05, 0), fl: V(0.14, 0, 0.3), fr: V(-0.14, 0, -0.3) } },
        // release: the draw arm snaps back, the bow arm recoils
        { t: 0.58, ease: 'out', p: { r: { g: V(-0.2, 0.22, 0.04), c: 0.3 }, l: { g: V(0.5, 0.13, 0.08) } } },
        { t: 1.3, ease: 'smooth', p: { ...idle } },
      ],
    }),
    hitClip(env, { dur: 0.5, recoil: -0.4, twist: 0.25, drop: 0.05, shove: 0.12 }),
    deathClip(env, { dur: 1.9, fall: 'back', topple: 0.4 }),
    spawnClip(env, [
      { t: 0, p: { root: V(0, -0.6, 0), sp: [0.9, 0, 0], head: [0.4, 0, 0], fl: V(0.15, 0, 0.2), fr: V(-0.15, 0, -0.1) } },
      { t: 0.7, ease: 'smooth', p: { root: V(0, -0.28, 0), sp: [0.55, 0, 0], head: [0.25, 0, 0] } },
      { t: 1.25, ease: 'out', p: { ...idle, root: V(0, 0.01, 0), head: [-0.1, -0.1, 0.1] } },
      { t: 1.6, ease: 'smooth', p: { ...idle } },
    ], 1.6),
  ];
}

export function archerParams(): HumanoidParams {
  const outfit: PieceSpec[] = [
    { id: 'trousers', mat: 'cloth2', o: { baggy: 0.2, end: 0.9 } },
    { id: 'wraps', mat: 'wrap', o: { where: 'shin', rings: 6 } },
    { id: 'boots', mat: 'leather2', o: { start: 0.7 } },
    { id: 'tunic', mat: 'cloth', o: { sleeve: 1, collar: 'v', hem: 0.2, baggy: 0.5 } },
    { id: 'belt', mat: 'leather', o: { y: -0.03, pouches: 1 } },
    { id: 'vambrace', mat: 'leather', o: { from: 0.5 } },
    { id: 'hood', mat: 'cloth2', build: raggedHood },
  ];
  const walk = { T: 1.1, duty: 0.62, sweep: 0.46 } as GaitSpec;
  const run = { T: 0.68, duty: 0.4, sweep: 0.8 } as GaitSpec;
  return {
    id: 'blighted_archer', kind: 'creature', seed: 'blighted_archer', sex: 'm', bodyHeight: 1.75,
    build: { shoulder: 0.95, chest: 0.92, waist: 0.88, legs: 1.0, muscle: 0.25, neck: 0.9, hands: 1.15, lean: 0.24, headForward: 0.06, armLength: 1.05 },
    face: { jaw: 0.3, brow: 0.5, nose: 0.55, lips: 0.25, eyes: 0.9, cheeks: 0.15 },
    skin: SKIN, hair: { style: 'none', color: '#2a2620' }, outfit, palette: PALETTE, style: 'none',
    speed: speedOf(1.75, walk, run),
    tris: 4800, voxel: 0.008, texture: 1024, liteHands: true,
    hooks: {
      afterBody: (ctx) => addBoils(ctx, 6, 'blighted_archer', { size: 0.9 }),
      afterOutfit: (ctx) => {
        addBow(ctx, ctx.a, archerBow());
        addQuiver(ctx, ctx.a, { mats: { leather: 'leather2', cloth: 'wrap', fletch: 'black', wood: 'black', metal: 'iron' }, arrows: 7, len: 0.52, side: 1 });
      },
      clips: archerClips,
    },
  };
}

// ------------------------------------------------------------------------------------------------ blighted_marshal
function leaderClips(clips: ClipSpec[], a: Anatomy, sk: Skeleton): ClipSpec[] {
  void clips;
  const idle: Pose = poseOf(stance(0.18, 0.1, 0.06), { sp: [0.16, 0.1, 0.03], hip: [0, 0.08, 0.02], head: [0.04, -0.12, 0.05], r: grip(V(-0.24, -0.24, 0.34), V(0.0, -0.3, 0.95), V(0.92, 0.3, 0), 1), l: grip(V(0.26, -0.28, 0.16), V(0, -0.2, 1), V(-1, 0, 0), 0.9), shr: 0.05, shl: 0.05 });
  const env = makeEnv(a, sk, idle, {}, { flow: 0.7 });
  const walk: GaitSpec = { T: 1.15, duty: 0.64, sweep: 0.55, lift: 0.1, bob: 0.016, lean: 0.05, twist: 0.14, armSwing: 0.05, headStab: 0.7, stomp: 0.012 };
  const run: GaitSpec = { T: 0.68, duty: 0.4, sweep: 0.88, lift: 0.18, bob: 0.036, lean: 0.2, twist: 0.2, hipYaw: 0.18, armSwing: 0.1, headStab: 0.6, run: true, crouch: 0.03, stomp: 0.02, width: 0.46, reach: 1.0,
    carry: { r: grip(V(-0.22, -0.18, 0.36), V(0.05, -0.1, 0.99), V(0.92, 0.3, 0), 1) } };
  return [
    idleClip(env, { dur: 3.0, breath: 0.026, look: 0.08, shift: 0.01 }),
    gaitClip(env, 'walk', walk),
    gaitClip(env, 'run', run),
    actionClip(env, {
      name: 'attack', dur: 1.35, hit: 0.62,
      keys: [
        { t: 0, p: {} },
        // huge overhead wind-up
        { t: 0.4, ease: 'out', p: { r: { g: V(-0.22, 0.6, -0.12), b: V(0, 0.9, 0.4), c: 1 }, l: { g: V(0.1, 0.4, 0.0), b: V(0, 0.5, 0.8), c: 0.6 }, sp: [-0.4, 0.45, 0], hip: [0, 0.25, 0], root: V(0, -0.05, -0.1), fl: V(0.15, 0, 0.12), fr: V(-0.16, 0, -0.26) } },
        // crushing downward cleave
        { t: 0.62, ease: 'in', p: { r: { g: V(-0.1, -0.05, 0.62), b: V(0, -0.35, 0.93), c: 1 }, l: { g: V(0.14, -0.1, 0.45), b: V(0, -0.3, 0.9), c: 0.6 }, sp: [0.6, -0.5, 0], hip: [0, -0.35, 0], root: V(0, -0.2, 0.2), fl: V(0.16, 0, 0.5), fr: V(-0.16, 0, -0.18), head: [0.15, 0.1, 0] } },
        { t: 0.82, ease: 'out', p: { root: V(0, -0.18, 0.2) } },
        { t: 1.35, ease: 'smooth', p: { ...idle } },
      ],
    }),
    hitClip(env, { dur: 0.45, recoil: -0.22, twist: 0.15, drop: 0.03, shove: 0.07 }),
    deathClip(env, { dur: 2.2, fall: 'front', topple: 0.7, stagger: 0.1, thick: 0.14 }),
    spawnClip(env, [
      { t: 0, p: { root: V(0, -0.7, 0), sp: [0.85, 0, 0], head: [0.4, 0, 0], fl: V(0.18, 0, 0.25), fr: V(-0.18, 0, -0.1) } },
      { t: 0.8, ease: 'smooth', p: { root: V(0, -0.3, 0), sp: [0.5, 0, 0], head: [0.2, 0, 0] } },
      { t: 1.4, ease: 'out', p: { ...idle, root: V(0, 0.01, 0), sp: [-0.1, 0.1, 0], head: [-0.2, -0.12, 0.05] } },
      { t: 1.9, ease: 'smooth', p: { ...idle } },
    ], 1.9),
  ];
}

export function leaderParams(): HumanoidParams {
  const outfit: PieceSpec[] = [
    { id: 'trousers', mat: 'cloth2', o: { baggy: 0.2, end: 0.9 } },
    { id: 'boots', mat: 'leather2', o: { start: 0.65 } },
    { id: 'greaves', mat: 'plate2', o: { from: 0.14, to: 0.5, cop: 1.3 } },
    { id: 'tunic', mat: 'cloth', o: { sleeve: 0.4, collar: 'crew', hem: 0.15 } },
    { id: 'cuirass', mat: 'plate', o: { style: 'plate', bands: 3, ridge: true, low: -0.03, straps: true, strapMat: 'leather' } },
    { id: 'tassets', mat: 'plate2', o: { count: 8, len: 0.26, flare: 0.35 } },
    { id: 'pauldron', mat: 'plate', o: { lames: 3, size: 1.55, spike: 1, spikeMat: 'bone' } },
    { id: 'vambrace', mat: 'plate2', o: { from: 0.45, cop: 1 } },
    { id: 'belt', mat: 'leather2', o: { y: -0.03 } },
  ];
  const walk = { T: 1.15, duty: 0.64, sweep: 0.55 } as GaitSpec;
  const run = { T: 0.68, duty: 0.4, sweep: 0.88 } as GaitSpec;
  return {
    id: 'blighted_marshal', kind: 'creature', seed: 'blighted_marshal', sex: 'm', bodyHeight: 2.1,
    build: { shoulder: 1.28, chest: 1.22, waist: 1.08, hips: 1.05, legs: 1.1, arms: 1.25, forearms: 1.25, muscle: 1.05, neck: 1.2, hands: 1.35, head: 0.9, lean: 0.18, headForward: 0.05, armLength: 1.06, stance: 1.2 },
    face: { jaw: 0.8, brow: 0.9, nose: 0.4, lips: 0.2, eyes: 0.85, cheeks: 0.4 },
    skin: SKIN, hair: { style: 'none', color: '#2a2620' }, outfit, palette: PALETTE, style: 'none',
    speed: speedOf(2.1, walk, run),
    tris: 4900, voxel: 0.0085, texture: 1024, liteHands: true,
    hooks: {
      afterBody: (ctx) => addBoils(ctx, 7, 'blighted_marshal', { size: 1.2 }),
      afterOutfit: (ctx) => {
        addBoneCrown(ctx, ctx.a, 'bone');
        addSword(ctx, ctx.a, { len: 1.28, halfW: 0.075, halfT: 0.018, hilt: 0.2, notches: 5, broad: true, mats: { metal: 'iron', wood: 'wood', cloth: 'wrap' } });
      },
      clips: leaderClips,
    },
  };
}

export const models: HumanModel[] = [
  { params: manParams },
  { params: warriorParams },
  { params: { archer: archerParams }.archer, rig: (a) => bowRig(a, archerBow(), bowState) },
  { params: leaderParams },
];

void vadd; void vnorm; void vscale; void RoundCone;

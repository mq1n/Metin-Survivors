// living_blaze: hunched obsidian brute - cracked basalt plates with lava veins, flame crest, brow horns, tusks, shard crags, bare spiked fists.
import type { ClipSpec } from '../../core/anim/clip.ts';
import { custom } from '../../core/paint/layers.ts';
import { type PaintVertex, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { type GiantParams } from '../../archetypes/giant/pipeline.ts';
import { HEAVY_RUN, HEAVY_WALK, type GaitSpec, type HeavyKit, action, authoredSpeeds, deathClip, hitClip, kick, locomotion, patchPose, recoil, spawnClip } from '../../archetypes/giant/heavy.ts';
import { type Anatomy, type HumanoidParams, type Key, type Pose, V, basePose, computeAnatomy } from '../../archetypes/humanoid/index.ts';
import { browHorns, coreRecess, crest, dorsalSpikes, fists, forearmSpikes, heelSpurs, knuckleShards, legSpikes, shoulderCrags, toeClaws } from '../../archetypes/ember/parts.ts';
import { demonHead } from '../../archetypes/ember/head.ts';
import { crackAlbedo, crackEmissive, flameHeat, glowRegion } from '../../archetypes/ember/glow.ts';

const HEIGHT = 2.0;

/** kit (poses in chest-frame reference metres; root / feet in world metres scaled by s) */
function livingBlazeKit(s: number): HeavyKit {
  const idle = patchPose(basePose(), {
    root: V(0, -0.05 * s, 0),
    fl: V(0.05 * s, 0, 0.14 * s),
    fr: V(-0.05 * s, 0, -0.12 * s),
    hip: [0, 0.12, 0],
    sp: [0.12, -0.14, 0],
    head: [0.1, 0.08, 0],
    r: { g: V(-0.31, -0.3, 0.38), b: V(0, 0.1, 1), e: V(-1, 0, 0), c: 1 },
    l: { g: V(0.31, -0.34, 0.34), b: V(0, 0.1, 1), e: V(1, 0, 0), c: 1 },
    poleR: V(-0.8, -0.3, -0.6),
    poleL: V(0.8, -0.3, -0.6),
  });
  const walk: GaitSpec = { ...HEAVY_WALK, T: 1.0, sweep: 0.6, stomp: 0.03, sway: 0.04, lean: 0.06, armSwing: 0.14 };
  const run: GaitSpec = { ...HEAVY_RUN, T: 0.64, sweep: 0.92, lean: 0.2, armSwing: 0.2 };
  return {
    idle,
    walk,
    run,
    walkArms: { r: { g: V(-0.32, -0.32, 0.34) }, l: { g: V(0.32, -0.36, 0.3) } },
    runArms: { r: { g: V(-0.3, -0.28, 0.34), c: 1 }, l: { g: V(0.3, -0.28, 0.34), c: 1 } },
    idleDur: 2.6,
    breath: 1.25,
  };
}

const backToIdle = (k: HeavyKit): Key['p'] => ({
  root: k.idle.root, sp: k.idle.sp, hip: k.idle.hip, head: k.idle.head, fl: k.idle.fl, fr: k.idle.fr,
  r: { g: k.idle.r.g, b: k.idle.r.b, e: k.idle.r.e, c: k.idle.r.c }, l: { g: k.idle.l.g, b: k.idle.l.b, e: k.idle.l.e, c: k.idle.l.c },
});

function livingBlazeClips(s: number, kit: HeavyKit): (a: Anatomy, sk: Skeleton) => ClipSpec[] {
  // attack: both fists rise behind the head, hammer down (hit 0.62)
  const smash: Key[] = [
    { t: 0, p: {} },
    { t: 0.16, ease: 'smooth', p: { root: V(0, -0.1 * s, -0.03 * s), sp: [0.05, 0, 0], head: [-0.1, 0, 0], r: { g: V(-0.32, 0.02, 0.2) }, l: { g: V(0.32, 0.02, 0.2) } } },
    { t: 0.52, ease: 'inout3', p: { root: V(0, -0.04 * s, -0.1 * s), sp: [-0.34, 0.04, 0], head: [-0.05, 0, 0], hip: [-0.08, 0, 0], fl: V(0.1 * s, 0, 0.16 * s), fr: V(-0.1 * s, 0, -0.16 * s), r: { g: V(-0.22, 0.66, -0.12), b: V(0, 0.8, 0.5), c: 1 }, l: { g: V(0.22, 0.66, -0.12), b: V(0, 0.8, 0.5), c: 1 } } },
    { t: 0.62, ease: 'in', p: { root: V(0, -0.2 * s, 0.14 * s), sp: [0.6, 0, 0], head: [-0.3, 0, 0], hip: [0.1, 0, 0], fl: V(0.1 * s, 0, 0.3 * s), fr: V(-0.1 * s, 0, 0.0), r: { g: V(-0.24, -0.5, 0.55), b: V(0, -0.5, 1), c: 1 }, l: { g: V(0.24, -0.5, 0.55), b: V(0, -0.5, 1), c: 1 } } },
    { t: 0.8, ease: 'out', p: { root: V(0, -0.17 * s, 0.14 * s) } },
    { t: 1.5, ease: 'smooth', p: backToIdle(kit) },
  ];
  // attack2: coil away, haymaker hook with the right fist (hit 0.5)
  const hook: Key[] = [
    { t: 0, p: {} },
    { t: 0.3, ease: 'smooth', p: { root: V(0, -0.1 * s, -0.06 * s), sp: [0.14, -0.72, 0], hip: [0, -0.4, 0], head: [-0.05, 0.5, 0], fl: V(0.1 * s, 0, 0.16 * s), fr: V(-0.08 * s, 0, -0.14 * s), r: { g: V(-0.52, -0.05, -0.34), b: V(-0.5, 0, 1), c: 1 }, l: { g: V(0.1, -0.22, 0.34), c: 1 } } },
    { t: 0.5, ease: 'in', p: { root: V(0, -0.12 * s, 0.14 * s), sp: [0.3, 0.8, -0.05], hip: [0, 0.4, 0], head: [-0.1, -0.45, 0], fl: V(0.06 * s, 0, 0.34 * s), fr: V(-0.12 * s, 0, -0.08 * s), r: { g: V(0.12, -0.12, 0.62), b: V(0.4, 0, 1), c: 1 }, l: { g: V(0.4, -0.3, 0.2), c: 1 } } },
    { t: 0.68, ease: 'out', p: { sp: [0.36, 0.95, -0.05], hip: [0, 0.48, 0] } },
    { t: 1.3, ease: 'smooth', p: backToIdle(kit) },
  ];
  const slam = (P: Pose, t: number): Pose => {
    const r = recoil(t, 0.62, 5.5, 8);
    P.root = [P.root[0], P.root[1] + 0.035 * s * r, P.root[2]];
    P.sp = [P.sp[0] - 0.05 * r, P.sp[1], P.sp[2]];
    return P;
  };
  const swing = (P: Pose, t: number): Pose => {
    const r = kick(t, 0.5, 9);
    P.root = [P.root[0], P.root[1] - 0.02 * s * r, P.root[2]];
    return P;
  };
  return (a: Anatomy, sk: Skeleton): ClipSpec[] => [
    ...locomotion(a, sk, kit),
    action('attack', a, sk, kit, smash, 1.5, 0.62, slam),
    hitClip(a, sk, kit, { k: 1.1 }),
    deathClip(a, sk, kit, { dur: 2.2, fall: 'back' }),
    spawnClip(a, sk, kit, { dur: 1.6 }),
    action('attack2', a, sk, kit, hook, 1.3, 0.5, swing),
  ];
}

export function livingBlaze(): GiantParams {
  const base: HumanoidParams = {
    id: 'living_blaze', kind: 'creature', seed: 'living_blaze', sex: 'm', bodyHeight: HEIGHT,
    build: { shoulder: 1.48, chest: 1.42, waist: 1.2, hips: 1.18, arms: 1.55, forearms: 1.65, legs: 1.32, calves: 1.28, neck: 1.15, hands: 1.9, feet: 1.55, head: 1.32, legLength: 0.8, armLength: 1.26, muscle: 1.3, lean: 0.34, headForward: 0.1, stance: 1.38, armSpread: 0.45 },
    face: { jaw: 1, brow: 1, nose: 0.2, lips: 0.2, eyes: 0.7, cheeks: 0.8, slant: 0.4, ears: 0.15 },
    skin: { base: '#3a1d19', shade: '#160a0a', lip: '#ff6a14', eye: '#ffb020', brow: '#0d090a', mark: '#ff7a1a' },
    hair: { style: 'none', color: '#1a1214' },
    outfit: [
      { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.46, trim: 'none' } },
      { id: 'cuisse', mat: 'plate', o: { trim: 'lava' } },
      { id: 'greaves', mat: 'plate', o: { cop: 1.4, trim: 'lava' } },
      { id: 'boots', mat: 'plate', o: { start: 0.5, toeUp: 0.5, trim: 'lava' } },
      { id: 'vambrace', mat: 'plate', o: { flare: 1.1, from: 0.3, trim: 'lava' } },
      { id: 'pauldron', mat: 'plate', o: { lames: 3, size: 1.35, spike: 0, trim: 'lava' } },
    ],
    palette: { sash: '#8a2812', plate: '#1d1b26', plateHi: '#6a6485', lava: '#ff6a18', obsidian: '#1f181c', flame: '#ff7a18', core: '#ffb830' },
    style: 'claw',
    rig: { skirt: true },
    mesh: { voxel: 0.0085, tris: 4700 }, texture: 512, liteHands: true,
  };
  const anat = computeAnatomy(base);
  base.mesh = {
    ...base.mesh,
    focus: [
      { c: anat.skull, r: 0.3 * anat.s, gain: 3.4 },
      { c: anat.side(1).palm, r: 0.16 * anat.s, gain: 1.8 },
      { c: anat.side(-1).palm, r: 0.16 * anat.s, gain: 1.8 },
    ],
  };
  const kit = livingBlazeKit(anat.s);
  base.speed = authoredSpeeds(anat, kit);
  const tags = { obs: '', flame: '', core: '' };
  const TIP = 'hotTip';
  const PLATES = [2, 3, 4, 5, 6];
  const BIG_BONES = ['pelvis', 'spine', 'chest', 'neck', 'thigh_l', 'thigh_r', 'clavicle_l', 'clavicle_r'];
  base.hooks = {
    head: (ctx) => {
      const obs = ctx.piece('obsidian'), fl = ctx.piece('flame'), core = ctx.piece('core');
      tags.obs = obs.tag; tags.flame = fl.tag; tags.core = core.tag;
      demonHead({ brow: 1.15, jaw: 1.1, tusk: 1.5, gape: 1.3, earTag: obs.tag })(ctx);
    },
    afterBody: (ctx) => {
      const st = { tag: tags.obs, tip: TIP };
      crest(ctx, { tag: tags.flame }, { count: 7, size: 1.4 });
      browHorns(ctx, tags.obs, { len: 1.1, thick: 1.15 });
      shoulderCrags(ctx, st, { size: 1.15, count: 4 });
      dorsalSpikes(ctx, st, { count: 6 });
      forearmSpikes(ctx, st, 1.1);
      legSpikes(ctx, st, 1.1);
      heelSpurs(ctx, st, 1.2);
      fists(ctx, 1.15);
      knuckleShards(ctx, st, 1.25);
      toeClaws(ctx, st, 1.7);
      coreRecess(ctx, tags.core, { size: 1 });
    },
    paint: (p, a) => {
      const plateM = (v: PaintVertex): number => {
        let m = 0;
        for (const i of PLATES) m = Math.max(m, v.region(`p${i}`, 0.004));
        return m;
      };
      const faceFree = (v: PaintVertex): number => (1 - 0.9 * v.region('eye', 0.01)) * (1 - 0.95 * v.region('lipline', 0.012)) * (1 - 0.8 * v.region('head', 0.01));
      const bigW = (v: PaintVertex): number => Math.min(1, BIG_BONES.reduce((s, b) => s + v.bone(b), 0));
      const skinM = (v: PaintVertex): number => v.region('skin', 0.006) * (1 - plateM(v)) * faceFree(v);
      // three crack scales: big molten plates on the trunk and thighs, medium on the limbs, hairlines on the armour plates
      const skinCrust = { crust: rgb('#2e1a17'), crustHi: rgb('#6a3f35') };
      const plateCrust = { crust: rgb('#1a1922'), crustHi: rgb('#5d5878') };
      const crackBig = { freq: 3.4, width: 0.1, warp: 0.34, mask: (v: PaintVertex) => skinM(v) * bigW(v) };
      const crackLimb = { freq: 6.2, width: 0.085, warp: 0.3, fine: 2.4, mask: (v: PaintVertex) => skinM(v) * (1 - bigW(v)) };
      const crackPlate = { freq: 7.5, width: 0.04, warp: 0.3, mask: (v: PaintVertex) => plateM(v) };
      const tipGlow = glowRegion(TIP, { heat: 0.7, soft: 0.006, gain: 0.9 });
      const flame = glowRegion(tags.flame, { heat: flameHeat(a.skull[1] + 0.02, a.H + 0.1, 0.3, 0.86), soft: 0.004, gain: 1.1 });
      const core = glowRegion(tags.core, { heat: 0.62, soft: 0.005, gain: 1.0 });
      const face = custom('faceTone', (v) => {
        const m = v.region('head', 0.01) * (1 - v.region('eye', 0.01)) * (1 - v.region('lipline', 0.012)) * (1 - v.region('tusk', 0.004));
        if (m <= 0) return;
        const hot = v.region('cheek', 0.03) * 0.6 + v.region('nose', 0.02) * 0.3;
        const brow = v.region('brow', 0.012);
        let c = mixRgb(rgb('#3c1812'), rgb('#9a3416'), hot);
        c = mixRgb(c, rgb('#140c0c'), 0.8 * brow);
        v.color = mixRgb(v.color, c, 0.9 * m);
      });
      const ivory = custom('ivory', (v) => {
        const m = v.region('tusk', 0.003);
        if (m > 0) v.color = mixRgb(v.color, rgb('#e8ddc0'), 0.95 * m);
      });
      const eye = glowRegion('eye', { heat: 0.85, soft: 0.002, gain: 1.5 });
      const mouth = glowRegion('lipline', { heat: 0.7, soft: 0.004, gain: 1.0 });
      const trims = PLATES.map((i) => glowRegion(`t${i}`, { heat: 0.6, soft: 0.004, gain: 1.0 }));
      p.albedo.push(
        crackAlbedo({ ...crackBig, ...skinCrust }), crackAlbedo({ ...crackLimb, ...skinCrust }), crackAlbedo({ ...crackPlate, ...plateCrust }),
        face, ivory, tipGlow.albedo, flame.albedo, core.albedo, eye.albedo, mouth.albedo, ...trims.map((t) => t.albedo),
      );
      p.emissive = [
        crackEmissive({ ...crackBig, gain: 1.0, bleed: 0.05 }), crackEmissive({ ...crackLimb, gain: 0.9, bleed: 0.04 }), crackEmissive({ ...crackPlate, gain: 0.55, bleed: 0.0 }),
        tipGlow.emissive, flame.emissive, core.emissive, eye.emissive, mouth.emissive, ...trims.map((t) => t.emissive),
      ];
      return p;
    },
    clips: (_c, a, sk) => livingBlazeClips(a.s, kit)(a, sk),
  };
  return { hp: base, lite: true };
}

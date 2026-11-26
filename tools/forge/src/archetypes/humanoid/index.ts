// Humanoid archetype entry point: parametric body + layered outfit + hair + skeleton + weapon-style clips -> ModelData.
//
// STABLE SURFACE (heroes, humanoid enemies and bosses build on this; see tools/forge/README.md "Humanoid archetype"):
//   buildHumanoid(params)            whole pipeline -> ModelData (heroes use exactly this)
//   humanoidDef(params)              the intermediate pieces (anatomy, skeleton, ctx, paint, clips) for custom pipelines
//   params:   HumanoidParams, Build, FaceParams, HairParams, PieceSpec, HumanoidHooks, RigOpts, DEFAULT_BUILD, DEFAULT_FACE
//   anatomy:  computeAnatomy, Anatomy, SideJoints         skeleton: makeSkeleton, SOCKETS, RigLayout, Chain
//   body:     buildBody(ctx, {head, liteHands}), buildHead, buildHumanHead, buildWolfHead
//   kit:      Ctx, Loft, Plate, limbEnv/limbTube/limbBand/torsoShell, frameQ/frameBasis
//   outfit:   PIECES, registerPiece, applyOutfit, buildHair, cover/slabY/slabAxis/boxClip/clipMinus (+ PieceEnv)
//   paint:    makePaint, HumanoidPaint, pieceLayers helpers
//   anim:     makeClips, STYLES, StyleDef, Key, evalKeys, locoPose helpers, Pose/Hand/applyPose/basePose/blendPose, V
import type { FocusRegion } from '../../core/mesh/simplify.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import type { ClipSpec } from '../../core/anim/clip.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { type Anatomy, computeAnatomy } from './anatomy.ts';
import { AUTHORED_SPEED, makeClips } from './anim/clips.ts';
import { buildBody } from './body.ts';
import { type HeroDef, buildHero } from './build.ts';
import { Ctx } from './kit/ctx.ts';
import { type AppliedPiece, applyOutfit } from './outfit/index.ts';
import { type HumanoidPaint, makePaint } from './paint.ts';
import type { HumanoidParams } from './params.ts';
import { SOCKETS, makeSkeleton } from './skeleton.ts';

export type { HumanoidParams, HumanoidHooks, MeshOverrides, PieceSpec, Build, FaceParams, HairParams, WeaponStyle, RigOpts, Palette, SkinPalette, HairStyle, Side } from './params.ts';
export { DEFAULT_BUILD, DEFAULT_FACE, mirrorV, sideName } from './params.ts';
export { type Anatomy, type SideJoints, computeAnatomy } from './anatomy.ts';
export { type Chain, type RigLayout, SOCKETS, makeSkeleton, rigLayout } from './skeleton.ts';
export { type BodyOpts, buildBody } from './body.ts';
export { buildHead, buildHumanHead, buildWolfHead } from './head.ts';
export { Ctx, frameBasis, frameQ } from './kit/ctx.ts';
export { Loft, type Station } from './kit/loft.ts';
export { Plate, type PlateOpts } from './kit/plate.ts';
export { type LimbEnv, limbBand, limbEnv, limbTube, torsoShell } from './kit/limbs.ts';
export { PIECES, type AppliedPiece, applyOutfit, registerPiece } from './outfit/index.ts';
export { buildHair } from './outfit/hair.ts';
export { type PieceEnv, boxClip, clipMinus, cover, makeEnv, slabAxis, slabY } from './outfit/util.ts';
export { type HumanoidPaint, makePaint } from './paint.ts';
export { AUTHORED_SPEED, type Key, STYLES, type StyleDef, chainsOf, evalKeys, gaitSpeed, makeClips } from './anim/clips.ts';
export { type E3, type Hand, type Pose, type SolveCfg, V, applyPose, basePose, blendPose, clonePose } from './anim/rig.ts';
export { type HeroDef, buildHero } from './build.ts';

export interface HumanoidParts {
  anatomy: Anatomy;
  skeleton: Skeleton;
  ctx: Ctx;
  pieces: AppliedPiece[];
  paint: HumanoidPaint;
  clips: ClipSpec[];
  def: HeroDef;
}

/** Assemble everything up to (not including) the mesh/bake pipeline. Custom pipelines can inspect or modify it before `buildHero(parts.def)`. */
export function humanoidDef(p: HumanoidParams, opts?: BuildOpts): HumanoidParts {
  const a = computeAnatomy(p);
  const rig = p.rig ?? {};
  const { skeleton, layout } = makeSkeleton(a, rig);
  a.layout = layout;
  const ctx = new Ctx(a, skeleton, layout, p.seed);
  buildBody(ctx, { ...(p.hooks?.head ? { head: p.hooks.head } : {}), ...(p.liteHands ? { liteHands: true } : {}) });
  p.hooks?.afterBody?.(ctx);
  const applied = applyOutfit(ctx, p.hair, p.outfit);
  p.hooks?.afterOutfit?.(ctx);
  const pieces = [...applied, ...ctx.extraPieces];
  let paint = makePaint(a, p, pieces);
  if (p.hooks?.paint) paint = p.hooks.paint(paint, a);
  let clips = [...makeClips(a, skeleton, p.style, '', p.styles)];
  if (p.styleB) clips.push(...makeClips(a, skeleton, p.styleB, '_b', p.styles));
  if (p.hooks?.clips) clips = p.hooks.clips(clips, a, skeleton);
  const s = a.s;
  const focus: FocusRegion[] = p.mesh?.focus ?? [
    { c: a.skull, r: 0.24 * s, gain: 2.6 },
    { c: a.side(1).palm, r: 0.14 * s, gain: 1.8 },
    { c: a.side(-1).palm, r: 0.14 * s, gain: 1.8 },
  ];
  const tex = opts?.texture !== undefined ? opts.texture : p.texture ?? 1024;
  const def: HeroDef = {
    id: p.id,
    kind: p.kind,
    skeleton,
    body: ctx.body,
    paint: { albedo: paint.albedo, shade: paint.shade, ...(paint.emissive ? { emissive: paint.emissive } : {}), size: tex > 0 ? tex : 0 },
    clips,
    mesh: {
      voxel: p.mesh?.voxel ?? (p.voxel ?? 0.0055) * Math.max(0.9, s),
      tris: p.mesh?.tris ?? p.tris ?? 10500,
      focus,
      relax: p.mesh?.relax ?? 1,
      normalStep: p.mesh?.normalStep ?? 0.006 * s,

    },
    skin: p.mesh?.skin ?? { tau: 0.014 * s, smooth: 6 },
    sockets: { ...SOCKETS },
    seed: p.seed,
    material: { roughness: 0.78, metallic: 0 },
    extras: {
      speed: p.speed ?? { walk: Number((AUTHORED_SPEED.walk * s).toFixed(3)), run: Number((AUTHORED_SPEED.run * s).toFixed(3)) },
      humanoid: { sex: p.sex, tier: p.tier ?? 0, style: p.style, ...(p.styleB ? { styleB: p.styleB } : {}), handFrame: 'palm +X(r) / -X(l), fingers -Y, thumb +Z, grip axis Z' },
      ...(p.extras ?? {}),
    },
  };
  return { anatomy: a, skeleton, ctx, pieces, paint, clips, def };
}

export async function buildHumanoid(p: HumanoidParams, log: (s: string) => void = () => {}, opts?: BuildOpts): Promise<ModelData> {
  return buildHero(humanoidDef(p, opts).def, log);
}

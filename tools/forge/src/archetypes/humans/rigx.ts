// Crowd-humanoid build wrapper: runs the shared humanoid pipeline (`humanoidDef`), then
//   * prunes leaf bones (muzzle, thumbs ...) so the 30-bone humanoid leaves room for chains / prop bones under the 32-joint crowd budget,
//   * appends extra bones (bow string, quiver flap, ...) with their own animation hook,
//   * lets the model tweak the definition (mesh settings, minimum component size) before the mesh/bake stage.
// The clips are authored against the FULL skeleton (the shared IK solver needs every bone); the wrapper evaluates them on a
// full-skeleton PoseCtx per frame and copies the kept bones into the pruned one.
import { PoseCtx, type ClipSpec } from '../../core/anim/clip.ts';
import { type Quat, type Vec3, QIDENT, qfromTo, qinv, qmul, vnorm, vsub } from '../../core/math.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';
import { type Anatomy, type HeroDef, type HumanoidParams, humanoidDef, type HumanoidParts } from '../humanoid/index.ts';
import { buildCrowd } from '../giant/pipeline.ts';

/** a bone added on top of the humanoid skeleton (rigid prop parts, strings, flaps) */
export interface ExtraBone {
  name: string;
  parent: string;
  /** world rest position of the joint */
  pos: Vec3;
  helper?: boolean;
}

export interface HumanRig {
  /** extra bones to remove (their parts are re-skinned to the mapped bone, e.g. `toe_l: 'foot_l'`) on top of DEFAULT_MERGE (helper sockets muzzle/back/hand_x + thumbs). */
  merge?: Record<string, string>;
  /** extra bones appended after the humanoid ones */
  extra?: ExtraBone[];
  /**
   * animate the extra bones: called for every sampled frame after the humanoid bones were copied. `full` holds the pose of the
   * complete humanoid skeleton (for IK targets such as the draw hand), `c` is the output context of the pruned skeleton.
   */
  animate?: (c: PoseCtx, clip: string, full: PoseCtx, fullSk: Skeleton) => void;
  /** adjust the definition (mesh settings...) just before the mesh stage */
  tweak?: (def: HeroDef, parts: HumanoidParts) => void;
}

export const DEFAULT_MERGE: Record<string, string> = {
  muzzle: 'head', back: 'chest', hand_l: 'wrist_l', hand_r: 'wrist_r', thumb_l: 'fingers_l', thumb_r: 'fingers_r',
};

/** one buildable human enemy: parameters (+ optional rig changes) */
export interface HumanModel {
  params: () => HumanoidParams;
  rig?: (a: Anatomy) => HumanRig;
}

/** rotation that makes a bone with rest direction `restDir` (world) point at `targetDir`, in the bone's parent frame (identity rest rotations) */
export function aimLocal(parentWorld: Quat, restDir: Vec3, targetDir: Vec3): Quat {
  const w = qfromTo(vnorm(restDir), vnorm(targetDir));
  return qmul(qinv(parentWorld), w);
}

/** the pruned / extended hero definition (everything up to the mesh stage); also used by debugging scripts */
export function prepareHuman(p: HumanoidParams, rigOf?: (a: Anatomy) => HumanRig, opts?: BuildOpts): HeroDef {
  const parts = humanoidDef(p, opts);
  const rig: HumanRig = rigOf?.(parts.anatomy) ?? {};
  const def = parts.def;
  const fullSk = parts.skeleton;
  const merge: Record<string, string> = { ...DEFAULT_MERGE, ...(rig.merge ?? {}) };

  // 1. re-skin parts of dropped bones
  for (const part of def.body.parts) {
    if (part.bone && merge[part.bone]) part.bone = merge[part.bone]!;
  }
  // 2. pruned skeleton (+ extra bones). A dropped bone's children are re-parented to its nearest kept ancestor.
  const keepParent = (name: string): string | null => {
    let cur = fullSk.bones[fullSk.idx(name)]!.parent;
    while (cur !== null && merge[cur]) cur = fullSk.bones[fullSk.idx(cur)]!.parent;
    return cur;
  };
  const bones: BoneSpec[] = [];
  for (const b of fullSk.bones) {
    if (merge[b.name]) continue;
    bones.push({ name: b.name, parent: keepParent(b.name), pos: b.pos, ...(b.helper ? { helper: true } : {}) });
  }
  for (const e of rig.extra ?? []) bones.push({ name: e.name, parent: e.parent, pos: e.pos, ...(e.helper ? { helper: true } : {}) });
  const sk = new Skeleton(bones);
  const kept = bones.filter((b) => !(rig.extra ?? []).some((e) => e.name === b.name)).map((b) => ({ n: sk.idx(b.name), f: fullSk.idx(b.name) }));

  // 3. clips: evaluate on the full skeleton, copy kept bones
  const wrap = (c: ClipSpec): ClipSpec => ({
    ...c,
    pose: (ctx) => {
      const full = new PoseCtx(fullSk, ctx.t, ctx.u, ctx.duration);
      c.pose(full);
      for (const { n, f } of kept) {
        ctx.pose.rot[n] = full.pose.rot[f] ?? QIDENT;
        ctx.pose.pos[n] = [...full.pose.pos[f]!] as Vec3;
      }
      if (full.pose.scale) {
        ctx.pose.scale ??= sk.bones.map(() => [1, 1, 1] as Vec3);
        for (const { n, f } of kept) ctx.pose.scale[n] = [...full.pose.scale[f]!] as Vec3;
      }
      rig.animate?.(ctx, c.name, full, fullSk);
    },
  });
  def.clips = def.clips.map(wrap);
  def.skeleton = sk;
  for (const [k, v] of Object.entries(def.sockets)) if (merge[v]) delete def.sockets[k];
  rig.tweak?.(def, parts);
  return def;
}

export async function buildHuman(p: HumanoidParams, rigOf?: (a: Anatomy) => HumanRig, log: (s: string) => void = () => {}, opts?: BuildOpts): Promise<ModelData> {
  return buildCrowd(prepareHuman(p, rigOf, opts), log);
}

export { vsub };

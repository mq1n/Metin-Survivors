// Esoteric builder (monks, zealots, priests): the orc crowd pipeline (humanoid body -> lite skeleton -> regularised decimation) plus
// optional extra deforming bones for floating accessories (talisman rings) and a few build overrides (footprint radius, small
// floating components). The humanoid and orc directories are imported, never edited.
import { type ClipSpec, type PoseCtx } from '../../core/anim/clip.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';
import { type Anatomy, type HeroDef, humanoidDef } from '../humanoid/index.ts';
import { buildCrowd } from '../orc/build.ts';
import { type OrcParams, reduceSkeleton, remapClips } from '../orc/index.ts';

export interface EsoParams extends OrcParams {
  /** extra deforming bones appended after the humanoid rig (parents must already exist; positions are world rest positions) */
  extraBones?: (a: Anatomy) => BoneSpec[];
  /** pose the extra bones: called after every clip's own pose on the final skeleton */
  extraPose?: (clip: string, c: PoseCtx, a: Anatomy) => void;
  /** footprint radius (m); default derives it from the rest-pose bounds, which a forward-pointing prop inflates */
  radius?: number;
  /** keep floating components down to this many (pre-decimation) triangles (default 60) */
  minComponentTris?: number;
  /** extra skeleton bones dropped like the lite thumbs/fingers (their geometry re-binds to the nearest kept ancestor, their tracks vanish) */
  dropBones?: string[];
  /** alternate crowd builder (default `buildCrowd`): receives the finished def (skeleton incl. extra bones, clips) and the anatomy */
  crowd?: (def: HeroDef, log: (s: string) => void, a: Anatomy) => Promise<ModelData>;
}

const LITE_DROP = ['thumb_l', 'fingers_l', 'thumb_r', 'fingers_r'];

/** keep the first clip of each name: a style special named like a built-in clip (`spawn`) replaces the built-in one */
export function firstOfEach(clips: ClipSpec[]): ClipSpec[] {
  return clips.filter((c, i) => clips.findIndex((x) => x.name === c.name) === i);
}

export async function buildEso(p: EsoParams, log: (s: string) => void = () => {}, opts?: BuildOpts): Promise<ModelData> {
  const parts = humanoidDef(p.hp, opts);
  const def = parts.def;
  const full = parts.skeleton;
  const a = parts.anatomy;
  const dropNames = [...(p.lite ? LITE_DROP : []), ...(p.dropBones ?? [])].filter((n, i, all) => full.has(n) && all.indexOf(n) === i);
  const drop = dropNames;
  const keptAncestor = (name: string): string => {
    let q = full.bones[full.idx(name)]!.parent;
    while (q && drop.includes(q)) q = full.bones[full.idx(q)]!.parent;
    return q ?? 'root';
  };
  for (const part of parts.ctx.body.parts) {
    if (drop.includes(part.bone)) part.bone = keptAncestor(part.bone);
  }
  const reduced = drop.length ? reduceSkeleton(full, drop) : full;
  const extra = p.extraBones?.(a) ?? [];
  def.skeleton = extra.length ? new Skeleton([...reduced.bones, ...extra]) : reduced;
  let clips: ClipSpec[] = drop.length ? remapClips(def.clips, full, reduced) : def.clips;
  if (p.extraPose) {
    const ep = p.extraPose;
    clips = clips.map((spec) => ({
      ...spec,
      pose: (c: PoseCtx): void => {
        spec.pose(c);
        ep(spec.name, c, a);
      },
    }));
  }
  def.clips = clips;
  if (p.radius !== undefined) def.radius = p.radius;
  if (p.minComponentTris !== undefined) def.mesh.minComponentTris = p.minComponentTris;
  return p.crowd ? p.crowd(def, log, a) : buildCrowd(def, log);
}

// Orc / brute / esoteric builder: the humanoid archetype (body, outfit, paint, IK clips) plus the crowd-skeleton reduction
// (finger/thumb bones dropped, -4 joints so robes/banners fit the 32-joint budget) and the pipeline glue used by every model in
// `models/orc` and `models/esoteric`. The humanoid directory is imported, never edited.
import { type ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { Skeleton } from '../../core/skin/skeleton.ts';
import type { FocusRegion } from '../../core/mesh/simplify.ts';
import { type HumanoidParams, humanoidDef } from '../humanoid/index.ts';
import { type OrcStyle, RUN, WALK, gaitSpeed, orcClips } from './anim.ts';
import { buildCrowd } from './build.ts';

export interface OrcParams {
  hp: HumanoidParams;
  /** crowd skeleton: drop the finger / thumb bones (their geometry follows the wrist) */
  lite?: boolean;
  /** animation style: replaces the humanoid clips with `orcClips` and publishes the authored ground speeds */
  style?: OrcStyle;
  /** triangle-density focus (default: head r 0.3 s x4, palms r 0.14 s x1.8); explicit `hp.mesh.focus` wins */
  focus?: { head?: number; headR?: number; hands?: number; extra?: FocusRegion[] };
}

const LITE_DROP = ['thumb_l', 'fingers_l', 'thumb_r', 'fingers_r'];

/** copy of `full` without the `drop` bones (order preserved, so parents still precede children) */
export function reduceSkeleton(full: Skeleton, drop: readonly string[]): Skeleton {
  const gone = new Set(drop);
  const parentOf = (name: string): string | null => {
    let p = full.bones[full.idx(name)]!.parent;
    while (p && gone.has(p)) p = full.bones[full.idx(p)]!.parent;
    return p;
  };
  return new Skeleton(full.bones.filter((b) => !gone.has(b.name)).map((b) => ({ ...b, parent: parentOf(b.name) })));
}

/** clips authored on the full skeleton, replayed onto the reduced one (tracks of dropped bones vanish) */
export function remapClips(clips: ClipSpec[], full: Skeleton, reduced: Skeleton): ClipSpec[] {
  const map = reduced.names.map((n) => full.idx(n));
  return clips.map((spec) => ({
    ...spec,
    pose: (c: PoseCtx): void => {
      const fc = new PoseCtx(full, c.t, c.u, c.duration);
      spec.pose(fc);
      for (let i = 0; i < map.length; i++) {
        const j = map[i]!;
        c.pose.rot[i] = fc.pose.rot[j]!;
        c.pose.pos[i] = [...fc.pose.pos[j]!];
      }
      if (fc.pose.scale) {
        c.pose.scale = reduced.bones.map((_, i) => [...fc.pose.scale![map[i]!]!] as [number, number, number]);
      }
    },
  }));
}

export async function buildOrc(p: OrcParams, log: (s: string) => void = () => {}, opts?: BuildOpts): Promise<ModelData> {
  const parts = humanoidDef(p.hp, opts);
  const def = parts.def;
  const a = parts.anatomy;
  if (!p.hp.mesh?.focus) {
    const f = p.focus ?? {};
    def.mesh.focus = [
      { c: a.skull, r: (f.headR ?? 0.3) * a.s, gain: f.head ?? 4 },
      { c: a.side(1).palm, r: 0.14 * a.s, gain: f.hands ?? 1.8 },
      { c: a.side(-1).palm, r: 0.14 * a.s, gain: f.hands ?? 1.8 },
      ...(f.extra ?? []),
    ];
  }
  if (p.style) {
    def.clips = orcClips(a, parts.skeleton, p.style);
    if (!p.hp.speed) {
      const g = p.style.gait ?? {};
      def.extras = { ...(def.extras ?? {}), speed: { walk: Number((gaitSpeed({ ...WALK, ...g.walk }) * a.s).toFixed(3)), run: Number((gaitSpeed({ ...RUN, ...g.run }) * a.s).toFixed(3)) } };
    }
  }
  if (p.lite) {
    const full = parts.skeleton;
    const drop = LITE_DROP.filter((n) => full.has(n));
    const reduced = reduceSkeleton(full, drop);
    for (const part of parts.ctx.body.parts) {
      if (drop.includes(part.bone)) part.bone = `wrist_${part.bone.endsWith('_l') ? 'l' : 'r'}`;
    }
    def.skeleton = reduced;
    def.clips = remapClips(def.clips, full, reduced);
  }
  return buildCrowd(def, log);
}

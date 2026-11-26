// Ember knight family (blaze_knight crowd elite, pyre_king boss): humanoid body + lacquered ember plate + baked-in flame sword.
// Built ON the humanoid archetype (import only) and the giant crowd pipeline pieces (regularised decimation, lite 26-joint skeleton).
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { LITE_DROP, reduceSkeleton, remapClips } from '../giant/pipeline.ts';
import { type HumanoidParams, humanoidDef } from '../humanoid/index.ts';
import type { HumanoidParts } from '../humanoid/index.ts';
import { type MeshGroup, buildEmberCrowd } from './build.ts';

export type { MeshGroup } from './build.ts';

export interface EmberSpec {
  hp: HumanoidParams;
  /** drop finger / thumb bones (fists are static meshes holding the sword) */
  lite: boolean;
  /** footprint radius written to the GLB (the sword would inflate the automatic estimate) */
  radius: number;
  /** parts meshed on their own budget (the baked sword) */
  groups: MeshGroup[];
  /** extras merged into the GLB scene extras */
  extras?: Record<string, unknown>;
  /** last look at the assembled parts before the mesh pipeline (retime clips, add extras ...) */
  post?: (parts: HumanoidParts) => void;
}

export async function buildEmber(spec: EmberSpec, log: (s: string) => void = () => {}, opts?: BuildOpts): Promise<ModelData> {
  const parts = humanoidDef(spec.hp, opts);
  const def = parts.def;
  if (spec.lite) {
    const full = parts.skeleton;
    const drop = LITE_DROP.filter((n) => full.has(n));
    const reduced = reduceSkeleton(full, drop);
    for (const part of parts.ctx.body.parts) {
      if (drop.includes(part.bone)) part.bone = `wrist_${part.bone.endsWith('_l') ? 'l' : 'r'}`;
    }
    def.skeleton = reduced;
    def.clips = remapClips(def.clips, full, reduced);
  }
  def.radius = spec.radius;
  def.extras = { ...(def.extras ?? {}), ...(spec.extras ?? {}) };
  spec.post?.(parts);
  return buildEmberCrowd(def, spec.groups, log);
}

export type { HumanoidParams };

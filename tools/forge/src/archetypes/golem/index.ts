// Golem archetype entry: hard-surface slab body (ice / fire variants) on the golem skeleton, golem pose solver clips, paint
// stack with emissive glow, built through the hard-surface crowd pipeline (build.ts).
import type { ModelData, ModelKind } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { Body } from '../../core/sdf/body.ts';
import type { HeroDef } from '../humanoid/index.ts';
import { FIRE_SHAPE, ICE_SHAPE, SOCKETS, golemSkeleton, resolveShape } from './anatomy.ts';
import { type GolemStyle, golemClips } from './anim.ts';
import { buildHard } from './build.ts';
import { buildFireBody } from './fire.ts';
import { buildIceBody } from './ice.ts';
import { firePaint, icePaint } from './paint.ts';
import { GolemRig } from './rig.ts';

export type GolemVariant = 'ice' | 'fire';

export interface GolemParams {
  id: string;
  kind: ModelKind;
  seed: string | number;
  variant: GolemVariant;
  /** gait + clip timings (see anim.ts) */
  style: GolemStyle;
  /** surface-nets cell (m) */
  voxel?: number;
  tris?: number;
  /** baked texture size (CLI --tex overrides) */
  texture?: number;
  /** crease angle (deg) of the split normals, decimator normal weight (see build.ts) */
  crease?: number;
  normalWeight?: number;
  extras?: Record<string, unknown>;
}

export function golemDef(p: GolemParams, opts?: BuildOpts): HeroDef {
  const shape = resolveShape(p.variant === 'ice' ? ICE_SHAPE : FIRE_SHAPE);
  const skeleton = golemSkeleton(shape);
  const body = new Body();
  if (p.variant === 'ice') buildIceBody(body, shape);
  else buildFireBody(body, shape);
  const paint = p.variant === 'ice' ? icePaint() : firePaint();
  const rig = new GolemRig(skeleton);
  const anim = golemClips(rig, p.style, p.variant);
  const tex = opts?.texture !== undefined ? opts.texture : p.texture ?? 1024;
  return {
    id: p.id,
    kind: p.kind,
    skeleton,
    body,
    paint: { albedo: paint.albedo, shade: paint.shade, emissive: paint.emissive, size: tex > 0 ? tex : 0 },
    clips: anim.clips,
    mesh: {
      voxel: p.voxel ?? 0.01,
      tris: p.tris ?? 4800,
      focus: [
        { c: shape.skull, r: 0.4, gain: 2 },
        { c: shape.core, r: 0.45, gain: 1.6 },
      ],
      relax: 0,
      normalStep: 0.004,
    },
    skin: { tau: 0.008, smooth: 3 },
    sockets: { ...SOCKETS },
    seed: p.seed,
    material: { roughness: 0.62, metallic: 0 },
    extras: { golem: { variant: p.variant }, speed: anim.speed, ...(p.extras ?? {}) },
  };
}

export async function buildGolem(p: GolemParams, log: (s: string) => void = () => {}, opts?: BuildOpts): Promise<ModelData> {
  const def = golemDef(p, opts);
  return buildHard(def, log, { ...(p.crease !== undefined ? { crease: p.crease } : {}), ...(p.normalWeight !== undefined ? { normalWeight: p.normalWeight } : {}) });
}

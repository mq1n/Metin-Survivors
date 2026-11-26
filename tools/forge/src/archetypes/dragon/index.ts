import { type CreatureDef, buildCreature } from '../../core/build.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { computeAnatomy } from './anatomy.ts';
import { makeClips } from './anim.ts';
import { SKIN_TAU, makeBody } from './body.ts';
import { makePaint } from './paint.ts';
import type { DragonParams } from './params.ts';
import { SOCKETS, makeSkeleton } from './skeleton.ts';

export type { DragonParams, DragonPalette } from './params.ts';

/** Assemble a CreatureDef for the forge pipeline from dragon parameters. */
export function dragonDef(p: DragonParams): CreatureDef {
  const a = computeAnatomy(p);
  const skeleton = makeSkeleton(a);
  const { body, membranes } = makeBody(a);
  const s = a.s;
  const env = process.env;
  return {
    id: p.id,
    kind: p.kind,
    skeleton,
    body,
    paint: makePaint(a, membranes, p.texture ?? 2048),
    clips: makeClips(a, skeleton),
    mesh: {
      voxel: Number(env.DRAGON_VOXEL ?? p.voxel ?? 0.03) * s,
      tris: Number(env.DRAGON_TRIS ?? p.tris ?? 14600),
      focus: [{ c: a.headW([0, 0, 0.8]), r: 2.6 * s, gain: 3 }],
      relax: 2,
      normalStep: 0.05 * s,
      minComponentTris: 60,
    },
    skin: { tau: SKIN_TAU * s, smooth: 5 },
    sockets: { ...SOCKETS },
    radius: p.radius ?? 2.6 * s,
    material: { roughness: 0.78, metallic: 0 },
    // authored ground speed = stride sweep / (duty x cycle): walk 2.3 m / (0.62 x 1.25 s), run 2.15 m / (0.4 x 1.0 s); breath window = special1 fire time
    extras: { speed: { walk: Number((2.97 * s).toFixed(2)), run: Number((5.4 * s).toFixed(2)) }, breath: { start: 1.0, end: 3.6 }, flyHeight: Number((2.7 * s).toFixed(2)) },
    seed: p.seed,
  };
}

export async function buildDragon(p: DragonParams, log?: (s: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const q = opts?.texture === undefined ? p : { ...p, texture: opts.texture };
  const { model } = await buildCreature(dragonDef(q), log);
  return model;
}

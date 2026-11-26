import { buildCreature, type CreatureDef } from '../../core/build.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { computeAnatomy } from './anatomy.ts';
import { makeClips } from './anim.ts';
import { makeBody } from './body.ts';
import { makePaint } from './paint.ts';
import type { UrsineParams } from './params.ts';
import { SOCKETS, makeSkeleton } from './skeleton.ts';

export type { UrsineParams } from './params.ts';

/** Assemble a CreatureDef for the forge pipeline from ursine parameters. */
export function ursineDef(p: UrsineParams): CreatureDef {
  const a = computeAnatomy(p);
  const skeleton = makeSkeleton(a);
  const body = makeBody(a, skeleton);
  const clips = makeClips(a, skeleton);
  return {
    id: p.id,
    kind: p.kind,
    skeleton,
    body,
    paint: makePaint(a, p.texture ?? 1024),
    clips: clips.clips,
    mesh: {
      voxel: (p.voxel ?? 0.0072) * Math.max(0.75, a.s),
      tris: p.tris ?? 4700,
      focus: [{ c: a.headToWorld([0, -0.03, 0.12]), r: 0.34 * a.s, gain: 2.1 }],
      relax: 2,
      normalStep: 0.016 * a.s,
      minComponentTris: 60,
    },
    skin: { tau: 0.022 * a.s, smooth: 5 },
    sockets: { ...SOCKETS },
    // authored ground speeds (stance sweep / (duty x cycle)); the game scales playback by speed / authored speed
    extras: { speed: clips.speed },
    seed: p.seed,
  };
}

export async function buildUrsine(p: UrsineParams, log?: (s: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const { model } = await buildCreature(ursineDef(opts?.texture === undefined ? p : { ...p, texture: opts.texture }), log);
  return model;
}

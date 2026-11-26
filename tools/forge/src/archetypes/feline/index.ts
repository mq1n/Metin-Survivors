import { buildCreature, type CreatureDef } from '../../core/build.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { computeAnatomy } from './anatomy.ts';
import { gaitSpeeds, makeClips } from './anim.ts';
import { makeBody } from './body.ts';
import { makePaint } from './paint.ts';
import type { FelineParams } from './params.ts';
import { SOCKETS, makeSkeleton } from './skeleton.ts';

export type { FelineParams, FelinePalette } from './params.ts';

/** Assemble a CreatureDef for the forge pipeline from feline parameters. */
export function felineDef(p: FelineParams): CreatureDef {
  const a = computeAnatomy(p);
  const skeleton = makeSkeleton(a);
  const body = makeBody(a);
  const hs = p.headScale * a.s;
  return {
    id: p.id,
    kind: p.kind,
    skeleton,
    body,
    paint: makePaint(a, p.texture ?? 1024),
    clips: makeClips(a, skeleton),
    mesh: {
      voxel: p.voxel ?? 0.0085 * Math.max(0.8, a.s),
      tris: p.tris ?? (p.kind === 'boss' ? 13500 : 4800),
      focus: [{ c: [a.head[0], a.head[1] - 0.02 * hs, a.head[2] + 0.12 * hs], r: 0.42 * a.s, gain: 2.3 }],
      relax: 2,
      normalStep: 0.016 * a.s,
      minComponentTris: 60,
    },
    skin: { tau: 0.02 * a.s, smooth: 5 },
    sockets: { ...SOCKETS },
    extras: { speed: { walk: Number(gaitSpeeds(a).walk.toFixed(3)), run: Number(gaitSpeeds(a).run.toFixed(3)) } },
    seed: p.seed,
  };
}

export async function buildFeline(p: FelineParams, log?: (s: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const { model } = await buildCreature(felineDef(opts?.texture === undefined ? p : { ...p, texture: opts.texture }), log);
  return model;
}

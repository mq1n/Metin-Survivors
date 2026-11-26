import { buildCreature, type CreatureDef } from '../../core/build.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { computeAnatomy } from './anatomy.ts';
import { makeClips } from './anim.ts';
import { makeBody } from './body.ts';
import { makePaint } from './paint.ts';
import type { CanineParams } from './params.ts';
import { SOCKETS, makeSkeleton } from './skeleton.ts';

export type { CanineParams } from './params.ts';

/** Assemble a CreatureDef for the forge pipeline from canine parameters. */
export function canineDef(p: CanineParams): CreatureDef {
  const a = computeAnatomy(p);
  const skeleton = makeSkeleton(a);
  const body = makeBody(a, skeleton);
  const hs = p.headScale * a.s;
  return {
    id: p.id,
    kind: p.kind,
    skeleton,
    body,
    paint: makePaint(a, p.texture ?? 1024),
    clips: makeClips(a, skeleton),
    mesh: {
      voxel: (p.voxel ?? 0.0065) * Math.max(0.75, a.s),
      tris: p.tris ?? 4700,
      focus: [{ c: [a.head[0], a.head[1], a.head[2] + 0.1 * hs], r: 0.3 * a.s, gain: 2.2 }],
      relax: 2,
      normalStep: 0.014 * a.s,
      minComponentTris: 60,
    },
    skin: { tau: 0.016 * a.s, smooth: 5 },
    sockets: { ...SOCKETS },
    // authored ground speed = stride sweep / (duty x cycle): walk 0.37 m / (0.64 x 0.867 s), run 0.70 m / (0.36 x 0.6 s)
    extras: { speed: { walk: Number((0.667 * a.s).toFixed(3)), run: Number((3.24 * a.s).toFixed(3)) } },
    seed: p.seed,
  };
}

export async function buildCanine(p: CanineParams, log?: (s: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const { model } = await buildCreature(canineDef(opts?.texture === undefined ? p : { ...p, texture: opts.texture }), log);
  return model;
}

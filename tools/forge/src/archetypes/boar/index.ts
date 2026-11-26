import { buildCreature, type CreatureDef } from '../../core/build.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { computeAnatomy } from './anatomy.ts';
import { authoredSpeeds, makeClips } from './anim.ts';
import { makeBody } from './body.ts';
import { makePaint } from './paint.ts';
import type { BoarParams } from './params.ts';
import { SOCKETS, makeSkeleton } from './skeleton.ts';

export type { BoarParams } from './params.ts';

/** Assemble a CreatureDef for the forge pipeline from boar parameters. */
export function boarDef(p: BoarParams): CreatureDef {
  const a = computeAnatomy(p);
  const skeleton = makeSkeleton(a);
  const body = makeBody(a);
  const speeds = authoredSpeeds(a);
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
      focus: [
        { c: [a.head[0], a.head[1] - 0.02 * a.s, a.head[2] + 0.14 * a.s], r: 0.28 * a.s, gain: 2.2 },
        { c: [a.head[0], a.head[1] - 0.09 * a.s, a.head[2] + 0.3 * a.s], r: 0.22 * a.s, gain: 3.0 },
        ...[-1, 1].map((sx) => ({ c: [sx * 0.17 * a.s, a.head[1] - 0.02 * a.s, a.head[2] + 0.29 * a.s] as [number, number, number], r: 0.17 * a.s, gain: 3.5 })),
      ],
      relax: 2,
      normalStep: 0.014 * a.s,
      minComponentTris: 40,
    },
    skin: { tau: 0.016 * a.s, smooth: 5 },
    sockets: { ...SOCKETS },
    extras: { speed: { walk: Number(speeds.walk.toFixed(3)), run: Number(speeds.run.toFixed(3)) } },
    seed: p.seed,
  };
}

export async function buildBoar(p: BoarParams, log?: (s: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const { model } = await buildCreature(boarDef(opts?.texture === undefined ? p : { ...p, texture: opts.texture }), log);
  return model;
}

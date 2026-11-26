import { buildCreature, type CreatureDef } from '../../core/build.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { computeAnatomy } from './anatomy.ts';
import { authoredSpeeds, makeClips } from './anim.ts';
import { makeBody } from './body.ts';
import { makePaint } from './paint.ts';
import type { AquaticParams } from './params.ts';
import { SOCKETS, makeSkeleton } from './skeleton.ts';

export type { AquaticParams, AquaticPalette } from './params.ts';

/** Assemble a CreatureDef for the forge pipeline from aquatic parameters. */
export function aquaticDef(p: AquaticParams): CreatureDef {
  const a = computeAnatomy(p);
  const skeleton = makeSkeleton(a);
  const body = makeBody(a);
  const s = a.s;
  return {
    id: p.id,
    kind: p.kind,
    skeleton,
    body,
    paint: makePaint(a, p.texture ?? 1024),
    clips: makeClips(a, skeleton),
    mesh: {
      voxel: (p.voxel ?? 0.009) * Math.max(0.75, s),
      tris: p.tris ?? 4900,
      focus: [
        { c: [0, 0.52 * s, 1.15 * s], r: 0.32 * s, gain: 5 },
        { c: [0, 0.78 * s, 1.0 * s], r: 0.55 * s, gain: 2.2 },
        { c: [0.85 * s, 0.12 * s, 0.15 * s], r: 0.5 * s, gain: 2.0 },
        { c: [-0.85 * s, 0.12 * s, 0.15 * s], r: 0.5 * s, gain: 2.0 },
        { c: [0, 0.9 * s, -1.8 * s], r: 0.6 * s, gain: 2.0 },
      ],
      relax: 2,
      normalStep: 0.014 * s,
      minComponentTris: 12,
    },
    skin: { tau: 0.028 * s, smooth: 8 },
    sockets: { ...SOCKETS },
    radius: 0.8 * s,
    extras: { speed: authoredSpeeds(s) },
    seed: p.seed,
  };
}

export async function buildAquatic(p: AquaticParams, log?: (s: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const { model } = await buildCreature(aquaticDef(opts?.texture === undefined ? p : { ...p, texture: opts.texture }), log);
  return model;
}

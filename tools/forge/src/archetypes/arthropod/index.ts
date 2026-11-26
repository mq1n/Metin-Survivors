import { buildCreature, type CreatureDef } from '../../core/build.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { computeAnatomy } from './anatomy.ts';
import { beetleClips } from './anim_beetle.ts';
import { scorpionClips } from './anim_scorpion.ts';
import { beetleBody } from './body_beetle.ts';
import { scorpionBody } from './body_scorpion.ts';
import { beetlePaint } from './paint_beetle.ts';
import { scorpionPaint } from './paint_scorpion.ts';
import type { ArthropodParams } from './params.ts';
import { makeSkeleton, sockets } from './skeleton.ts';

export type { ArthropodParams, BeetleParams, ScorpionParams } from './params.ts';

/** Assemble a CreatureDef for the forge pipeline from arthropod parameters. */
export function arthropodDef(p: ArthropodParams): CreatureDef {
  const a = computeAnatomy(p);
  const skeleton = makeSkeleton(a);
  const s = a.s;
  const common = { id: p.id, kind: p.kind, skeleton, sockets: sockets(a), seed: p.seed, skin: { tau: 0.012 * s, smooth: 4 } };
  if (a.family === 'scorpion') {
    const t = a.telson.sting[4]!;
    return {
      ...common,
      body: scorpionBody(a),
      paint: scorpionPaint(a, p.texture ?? 1024),
      clips: scorpionClips(a, skeleton),
      mesh: {
        voxel: (p.voxel ?? 0.011) * Math.max(0.75, s),
        tris: p.tris ?? 4950,
        focus: [
          { c: [0, 0.22 * s, 0.8 * s], r: 0.5 * s, gain: 1.9 },
          { c: [t[0], t[1], t[2]], r: 0.28 * s, gain: 1.7 },
        ],
        relax: 2,
        normalStep: 0.006 * s,
        minComponentTris: 12,
      },
      // authored ground speed = mean stride sweep / (duty x cycle): walk 0.325 / (0.6 x 0.7 s), run 0.41 / (0.52 x 0.36 s)
      extras: { speed: { walk: Number(((0.325 / (0.6 * 0.7)) * s).toFixed(3)), run: Number(((0.41 / (0.52 * 0.36)) * s).toFixed(3)) } },
    };
  }
  const head = a.skull.c;
  return {
    ...common,
    body: beetleBody(a),
    paint: beetlePaint(a, p.texture ?? 1024),
    clips: beetleClips(a, skeleton),
    mesh: {
      voxel: (p.voxel ?? 0.0105) * Math.max(0.75, s),
      tris: p.tris ?? 4950,
      focus: [
        { c: [head[0], head[1] + 0.1 * s, head[2] + 0.2 * s], r: 0.45 * s, gain: 1.9 },
      ],
      relax: 2,
      normalStep: 0.006 * s,
      minComponentTris: 12,
    },
    // walk 0.26 / (0.62 x 0.7 s), run 0.433 / (0.5 x 0.34 s)
    extras: { speed: { walk: Number(((0.26 / (0.62 * 0.7)) * s).toFixed(3)), run: Number(((0.433 / (0.5 * 0.34)) * s).toFixed(3)) } },
  };
}

export async function buildArthropod(p: ArthropodParams, log?: (s: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const { model } = await buildCreature(arthropodDef(opts?.texture === undefined ? p : { ...p, texture: opts.texture }), log);
  return model;
}

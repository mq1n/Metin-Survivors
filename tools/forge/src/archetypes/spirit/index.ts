import { buildCreature, type CreatureDef } from '../../core/build.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { makeFireClips, makeIceClips } from './anim.ts';
import { makeCorpseClips } from './animCorpse.ts';
import { CORPSE_SOCKETS, corpseAnatomy, corpseBody, corpseSkeleton } from './corpse.ts';
import { corpsePaint } from './corpsePaint.ts';
import { FIRE_SOCKETS, fireAnatomy, fireBody, fireSkeleton } from './fire.ts';
import { firePaint } from './firePaint.ts';
import { ICE_SOCKETS, iceAnatomy, iceBody, iceSkeleton } from './ice.ts';
import { icePaint } from './icePaint.ts';
import type { SpiritParams, SpiritVariant } from './params.ts';

export type { SpiritKind, SpiritParams } from './params.ts';

function iceVariant(p: SpiritParams): SpiritVariant {
  const a = iceAnatomy(p.scale);
  const skeleton = iceSkeleton(a);
  const body = iceBody(a, p.seed);
  const s = p.scale;
  return {
    skeleton,
    body,
    paint: icePaint(p.texture ?? 1024),
    clips: makeIceClips(a, skeleton),
    mesh: {
      voxel: (p.voxel ?? 0.0075) * Math.max(0.8, s),
      tris: p.tris ?? 4700,
      focus: [{ c: [skeleton.restPos('head')[0], skeleton.restPos('head')[1] + 0.02 * s, skeleton.restPos('head')[2] + 0.06 * s], r: 0.3 * s, gain: 2.1 }],
      relax: 1,
      normalStep: 0.007 * s,
      minComponentTris: 12,
    },
    sockets: { ...ICE_SOCKETS },
    speed: { walk: 1.1 * s, run: 2.8 * s },
    normalLift: 0.35,
  };
}

function corpseVariant(p: SpiritParams): SpiritVariant {
  const a = corpseAnatomy(p.scale);
  const skeleton = corpseSkeleton(a);
  const body = corpseBody(a, p.seed);
  const s = p.scale;
  const hp = skeleton.restPos('head');
  return {
    skeleton,
    body,
    paint: corpsePaint(p.texture ?? 1024),
    clips: makeCorpseClips(a, skeleton),
    mesh: {
      voxel: (p.voxel ?? 0.0065) * Math.max(0.8, s),
      tris: p.tris ?? 4900,
      focus: [{ c: [hp[0], hp[1] + 0.0, hp[2] + 0.07 * s], r: 0.26 * s, gain: 2.4 }],
      relax: 2,
      normalStep: 0.01 * s,
      minComponentTris: 12,
    },
    sockets: { ...CORPSE_SOCKETS },
    speed: { walk: 0.9 * s, run: 2.6 * s },
    normalLift: 0.25,
  };
}

function fireVariant(p: SpiritParams): SpiritVariant {
  const a = fireAnatomy(p.scale);
  const skeleton = fireSkeleton(a);
  const body = fireBody(a, p.seed);
  const s = p.scale;
  const hp = skeleton.restPos('head');
  return {
    skeleton,
    body,
    paint: firePaint(p.texture ?? 1024),
    clips: makeFireClips(a, skeleton),
    mesh: {
      voxel: (p.voxel ?? 0.0075) * Math.max(0.8, s),
      tris: p.tris ?? 4800,
      focus: [{ c: [hp[0], hp[1] + 0.05 * s, hp[2] + 0.05 * s], r: 0.3 * s, gain: 2.0 }],
      relax: 2,
      normalStep: 0.012 * s,
      minComponentTris: 12,
    },
    sockets: { ...FIRE_SOCKETS },
    speed: { walk: 1.2 * s, run: 3.0 * s },
    normalLift: 0.7,
  };
}
function variantFor(p: SpiritParams): SpiritVariant {
  switch (p.kind) {
    case 'ice': return iceVariant(p);
    case 'fire': return fireVariant(p);
    case 'corpse': return corpseVariant(p);
    default: throw new Error(`spirit kind ${p.kind} not implemented`);
  }
}

/** Assemble the CreatureDef for the forge pipeline. */
export function spiritDef(p: SpiritParams): { def: CreatureDef; variant: SpiritVariant } {
  const v = variantFor(p);
  const def: CreatureDef = {
    id: p.id,
    kind: 'creature',
    skeleton: v.skeleton,
    body: v.body,
    paint: v.paint,
    clips: v.clips,
    mesh: v.mesh,
    skin: { tau: 0.014 * p.scale, smooth: 4 },
    sockets: v.sockets,
    extras: { speed: v.speed, hover: true },
    seed: p.seed,
    ...(v.radius !== undefined ? { radius: v.radius } : {}),
  };
  return { def, variant: v };
}

/** Pull normals toward world up so the opaque Lambert material reads as self-lit (glow) instead of side-shaded. */
function liftNormals(normals: Float32Array, k: number): void {
  if (k <= 0) return;
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i]! * (1 - k), y = normals[i + 1]! * (1 - k) + k, z = normals[i + 2]! * (1 - k);
    const l = Math.hypot(x, y, z) || 1;
    normals[i] = x / l; normals[i + 1] = y / l; normals[i + 2] = z / l;
  }
}

export async function buildSpirit(p: SpiritParams, log?: (s: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const { def, variant } = spiritDef(opts?.texture === undefined ? p : { ...p, texture: opts.texture });
  const { model } = await buildCreature(def, log);
  liftNormals(model.normals, variant.normalLift);
  return model;
}

// DEV-only procedural stand-ins that obey the FORGE GLB contract (ARCHITECTURE §5.1). Dynamically imported by
// engine/assets.ts under import.meta.env.DEV only — never import this module from production code.
import type { Texture } from 'three';
import type { ModelKind } from '../data/assetManifest';
import type { PlaceholderModel } from '../engine/assets';
import { buildCreature, type Archetype } from './placeholders/creatures';
import { makeHero } from './placeholders/heroes';
import { inferPlan } from './placeholders/infer';
import { makeMetin } from './placeholders/metin';
import { makePickup } from './placeholders/pickups';
import { makeProp } from './placeholders/props';
import { makePlaceholderTexture as makeTexture } from './placeholders/textures';
import { makeWeapon } from './placeholders/weapons';

/** Infers a sensible procedural model from the id (and the kind hint); deterministic per id. */
export async function makePlaceholderModel(id: string, hint?: ModelKind): Promise<PlaceholderModel> {
  const plan = inferPlan(id, hint);
  switch (plan.type) {
    case 'creature':
      return buildCreature(id, plan.kind, { seed: plan.seed, archetype: plan.archetype, variant: plan.variant });
    case 'hero':
      return makeHero(id, plan);
    case 'weapon':
      return makeWeapon(id, plan.weapon, plan.seed);
    case 'metin':
      return makeMetin(id, plan.seed);
    case 'pickup':
      return makePickup(id, plan.item);
    case 'prop':
      return makeProp(id, plan.prop, plan.seed);
  }
}

/** Quadruped (default) test creature with idle/walk/attack/death + the rest of the clip set. */
export function makeTestCreature(opts: { seed?: number; archetype?: Archetype; bones?: number; tint?: string } = {}): PlaceholderModel {
  return buildCreature('test_creature', opts.archetype === 'boss' ? 'boss' : 'creature', { seed: opts.seed ?? 1, archetype: opts.archetype ?? 'quadruped', tint: opts.tint, bones: opts.bones });
}

/** Small tileable/gradient texture: grass-ish for terrain ids, themed for dirt/sand/snow/stone/bark/vfx ids, neutral otherwise. */
export function makePlaceholderTexture(id: string): Texture {
  return makeTexture(id);
}

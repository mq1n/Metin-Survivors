// Outfit registry: piece id -> builder + default material key. Pieces are applied in spec order (inner to outer);
// hair is piece 0.
import type { Ctx } from '../kit/ctx.ts';
import type { HairParams, PieceSpec } from '../params.ts';
import { ARMOR } from './armor.ts';
import { buildHair } from './hair.ts';
import { MAGIC } from './magic.ts';
import { SOFT } from './soft.ts';
import { type PieceEnv, makeEnv } from './util.ts';

type PieceFn = (e: PieceEnv) => void;

export const PIECES: Record<string, { fn: PieceFn; mat: string }> = {
  tunic: { fn: SOFT.tunic, mat: 'cloth' },
  trousers: { fn: SOFT.trousers, mat: 'cloth2' },
  sash: { fn: SOFT.sash, mat: 'sash' },
  belt: { fn: SOFT.belt, mat: 'leather' },
  robe: { fn: SOFT.robe, mat: 'cloth' },
  wraps: { fn: SOFT.wraps, mat: 'cloth2' },
  boots: { fn: SOFT.boots, mat: 'leather' },
  sandals: { fn: SOFT.sandals, mat: 'leather' },
  gloves: { fn: SOFT.gloves, mat: 'leather' },
  scarf: { fn: SOFT.scarf, mat: 'sash' },
  cape: { fn: SOFT.cape, mat: 'cloth' },
  tail: { fn: SOFT.tail, mat: 'fur' },
  mantle: { fn: SOFT.mantle, mat: 'fur' },
  headband: { fn: SOFT.headband, mat: 'sash' },
  mask: { fn: SOFT.mask, mat: 'cloth' },
  hood: { fn: SOFT.hood, mat: 'cloth' },
  talismans: { fn: SOFT.talismans, mat: 'paper' },
  beads: { fn: SOFT.beads, mat: 'bone' },
  pauldron: { fn: ARMOR.pauldron, mat: 'plate' },
  vambrace: { fn: ARMOR.vambrace, mat: 'plate' },
  greaves: { fn: ARMOR.greaves, mat: 'plate' },
  cuisse: { fn: ARMOR.cuisse, mat: 'plate' },
  cuirass: { fn: ARMOR.cuirass, mat: 'plate' },
  tassets: { fn: ARMOR.tassets, mat: 'plate' },
  collar: { fn: ARMOR.collar, mat: 'plate' },
  helm: { fn: ARMOR.helm, mat: 'plate' },
  horns: { fn: ARMOR.horns, mat: 'bone' },
  gauntlets: { fn: ARMOR.gauntlets, mat: 'plate' },
  backpiece: { fn: ARMOR.backpiece, mat: 'plate' },
  runes: { fn: MAGIC.runes, mat: 'rune' },
  tattoo: { fn: MAGIC.tattoo, mat: 'ink' },
};

/** register a piece builder globally (archetype users call this at import time) */
export function registerPiece(id: string, fn: PieceFn, mat = 'cloth'): void {
  if (PIECES[id]) throw new Error(`outfit piece '${id}' already registered`);
  PIECES[id] = { fn, mat };
}

export interface AppliedPiece {
  /** piece index (hair = 0, outfit pieces from 1) */
  i: number;
  id: string;
  mat: string;
  o: NonNullable<PieceSpec['o']>;
}

/** build hair + every outfit piece into the context; returns the applied piece list for the paint stage */
export function applyOutfit(ctx: Ctx, hair: HairParams, outfit: PieceSpec[]): AppliedPiece[] {
  const applied: AppliedPiece[] = [{ i: 0, id: `hair_${hair.style}`, mat: 'hair', o: {} }];
  buildHair(ctx, hair);
  outfit.forEach((spec, k) => {
    const def = spec.build ? { fn: spec.build, mat: spec.defMat ?? 'cloth' } : PIECES[spec.id];
    if (!def) throw new Error(`unknown outfit piece '${spec.id}'`);
    const e = makeEnv(ctx, spec, k + 1, def.mat);
    def.fn(e);
    applied.push({ i: k + 1, id: spec.id, mat: e.mat, o: spec.o ?? {} });
  });
  return applied;
}

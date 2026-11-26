// Ember knight family registry (auto-discovered): blaze_knight pyre_king.
import { buildEmber } from '../../archetypes/emberknight/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { pyreKing } from './pyre_king.ts';
import { blazeKnight } from './blaze_knight.ts';

const defs = [blazeKnight(), pyreKing()];

export const registry: ModelEntry[] = defs.map((d) => ({ id: d.hp.id, kind: d.hp.kind, build: (log, opts) => buildEmber(d, log, opts) }));

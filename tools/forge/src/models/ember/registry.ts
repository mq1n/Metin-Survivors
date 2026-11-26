// Ember family registry (auto-discovered): living_blaze blaze_knight pyre_king.
import { buildGiant } from '../../archetypes/giant/pipeline.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { livingBlaze } from './living_blaze.ts';

const defs = [livingBlaze()];

export const registry: ModelEntry[] = defs.map((p) => ({ id: p.hp.id, kind: p.hp.kind, build: (log, opts) => buildGiant(p, log, opts) }));

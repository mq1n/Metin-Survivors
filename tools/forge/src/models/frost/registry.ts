// Frost family registry (auto-discovered): yeti, frost_revenant.
import { buildGiant } from '../../archetypes/giant/pipeline.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { frostRevenant } from './frost_revenant.ts';
import { yeti } from './yeti.ts';

export const registry: ModelEntry[] = [yeti(), frostRevenant()].map((p) => ({ id: p.hp.id, kind: p.hp.kind, build: (log, opts) => buildGiant(p, log, opts) }));

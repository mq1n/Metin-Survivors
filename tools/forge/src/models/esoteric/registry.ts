// Esoteric family registry (auto-discovered): ascetic zealot conjurer.
import { buildEso } from '../../archetypes/esoteric/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { esoParams } from './params.ts';

export const registry: ModelEntry[] = esoParams().map((p) => ({ id: p.hp.id, kind: p.hp.kind, build: (log, opts) => buildEso(p, log, opts) }));

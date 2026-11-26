// Orc family registry (auto-discovered): orc_scout orc_fighter orc_sorcerer orc_general black_orc orc_lord.
import { buildOrc } from '../../archetypes/orc/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { orcParams } from './params.ts';

export const registry: ModelEntry[] = orcParams().map((p) => ({ id: p.hp.id, kind: p.hp.kind, build: (log, opts) => buildOrc(p, log, opts) }));

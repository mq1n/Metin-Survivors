// Boar family registry. Auto-discovered by src/models/index.ts (any src/models/<family>/registry.ts exporting `registry`).
import type { BoarParams } from '../../archetypes/boar/index.ts';
import { buildBoar } from '../../archetypes/boar/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { boar } from './boar.ts';

const entry = (p: BoarParams): ModelEntry => ({ id: p.id, kind: p.kind, build: (log, opts) => buildBoar(p, log, opts) });

export const registry: ModelEntry[] = [boar].map(entry);

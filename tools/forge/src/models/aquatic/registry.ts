// Aquatic family registry. Auto-discovered by src/models/index.ts (any src/models/<family>/registry.ts exporting `registry`).
import type { AquaticParams } from '../../archetypes/aquatic/index.ts';
import { buildAquatic } from '../../archetypes/aquatic/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { glacierOrca } from './glacier_orca.ts';

const aquatic = (p: AquaticParams): ModelEntry => ({ id: p.id, kind: p.kind, build: (log, opts) => buildAquatic(p, log, opts) });

export const registry: ModelEntry[] = [glacierOrca].map(aquatic);

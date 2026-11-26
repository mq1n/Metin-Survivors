// Dragon family registry (auto-discovered by src/models/index.ts).
import { buildDragon } from '../../archetypes/dragon/index.ts';
import type { DragonParams } from '../../archetypes/dragon/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { scarletWyrm } from './scarlet_wyrm.ts';

const dragon = (p: DragonParams): ModelEntry => ({ id: p.id, kind: p.kind, build: (log, opts) => buildDragon(p, log, opts) });

export const registry: ModelEntry[] = [scarletWyrm].map(dragon);

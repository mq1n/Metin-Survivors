// Spirit family registry (floating / ghostly forms). Auto-discovered by src/models/index.ts.
import { buildSpirit } from '../../archetypes/spirit/index.ts';
import type { SpiritParams } from '../../archetypes/spirit/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { shamblingCorpse } from './shambling_corpse.ts';
import { ashWisp } from './ash_wisp.ts';
import { frostWisp } from './frost_wisp.ts';

const spirit = (p: SpiritParams): ModelEntry => ({ id: p.id, kind: 'creature', build: (log, opts) => buildSpirit(p, log, opts) });

export const registry: ModelEntry[] = [shamblingCorpse, frostWisp, ashWisp].map(spirit);

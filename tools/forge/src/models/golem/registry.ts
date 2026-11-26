// Golem family registry (auto-discovered): ice_golem, lava_troll.
import { buildGolem } from '../../archetypes/golem/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { lavaTroll } from './lava_troll.ts';
import { iceGolem } from './ice_golem.ts';

export const registry: ModelEntry[] = [iceGolem(), lavaTroll()].map((p) => ({ id: p.id, kind: p.kind, build: (log, opts) => buildGolem(p, log, opts) }));

// Hero family registry (auto-discovered): 36 hero models, built by the humanoid archetype.
import { buildHumanoid } from '../../archetypes/humanoid/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { heroParams } from './params.ts';

export const registry: ModelEntry[] = heroParams().map((p) => ({ id: p.id, kind: p.kind, build: (log, opts) => buildHumanoid(p, log, opts) }));

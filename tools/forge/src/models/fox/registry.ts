import { buildFoxWarrior } from '../../archetypes/foxwarrior/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { miho } from './miho.ts';

export const registry: ModelEntry[] = [{ id: miho.humanoid.id, kind: 'boss', build: (log, opts) => buildFoxWarrior(miho, log, opts) }];

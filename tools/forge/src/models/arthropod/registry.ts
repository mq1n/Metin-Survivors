// Arthropod family registry (auto-discovered by src/models/index.ts).
import type { ArthropodParams } from '../../archetypes/arthropod/index.ts';
import { buildArthropod } from '../../archetypes/arthropod/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { rimeBeetle } from './rime_beetle.ts';
import { scorpion } from './scorpion.ts';

const arthropod = (p: ArthropodParams): ModelEntry => ({ id: p.id, kind: p.kind, build: (log, opts) => buildArthropod(p, log, opts) });

export const registry: ModelEntry[] = [scorpion, rimeBeetle].map(arthropod);

// Feline family registry (tiger, fire tiger, snow lion, tiger god). Auto-discovered by src/models/index.ts.
import type { FelineParams } from '../../archetypes/feline/index.ts';
import { buildFeline } from '../../archetypes/feline/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { blazeTiger } from './blaze_tiger.ts';
import { snowLion } from './snow_lion.ts';
import { tiger } from './tiger.ts';
import { tigerGod } from './tiger_god.ts';

const feline = (p: FelineParams): ModelEntry => ({ id: p.id, kind: p.kind, build: (log, opts) => buildFeline(p, log, opts) });

export const registry: ModelEntry[] = [tiger, blazeTiger, snowLion, tigerGod].map(feline);

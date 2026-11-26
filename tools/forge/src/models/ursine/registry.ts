// Ursine family registry. Auto-discovered by src/models/index.ts (any src/models/<family>/registry.ts exporting `registry`).
import type { UrsineParams } from '../../archetypes/ursine/index.ts';
import { buildUrsine } from '../../archetypes/ursine/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { bear } from './bear.ts';

const ursine = (p: UrsineParams): ModelEntry => ({ id: p.id, kind: p.kind, build: (log, opts) => buildUrsine(p, log, opts) });

export const registry: ModelEntry[] = [bear].map(ursine);

// Model registry with auto-discovery: every `src/models/<family>/registry.ts` that exports `registry: ModelEntry[]` is collected here.
// Parallel authors never edit this file: create your own family folder + registry.ts (see README "Adding a family").
import { join } from 'node:path';
import type { ModelEntry } from '../core/registry.ts';

async function collect(): Promise<ModelEntry[]> {
  const dir = import.meta.dir;
  const files = [...new Bun.Glob('*/registry.ts').scanSync({ cwd: dir })].sort();
  const all: ModelEntry[] = [];
  const seen = new Map<string, string>();
  for (const f of files) {
    let mod: { registry?: ModelEntry[] };
    try {
      mod = (await import(join(dir, f))) as { registry?: ModelEntry[] };
    } catch (e) {
      // one author's broken work-in-progress must not block everyone else's builds
      console.warn(`[forge] WARNING: family '${f.split('/')[0]}' failed to load and is skipped: ${(e as Error).message}`);
      continue;
    }
    if (!Array.isArray(mod.registry)) {
      console.warn(`[forge] WARNING: ${f} must export \`registry: ModelEntry[]\`; skipped`);
      continue;
    }
    for (const e of mod.registry) {
      const prev = seen.get(e.id);
      if (prev) throw new Error(`duplicate model id '${e.id}' in ${f} and ${prev}`);
      seen.set(e.id, f);
      all.push(e);
    }
  }
  return all;
}

export const registry: ModelEntry[] = await collect();

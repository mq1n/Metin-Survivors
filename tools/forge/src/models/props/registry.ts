// Static props family (kind 'prop'): architecture, orc camp, ice/fire dressing.
// Auto-collects every sibling `<id>.ts` that exports `prop: PropDef` (one file per model; a broken WIP file is skipped with a warning).
import { join } from 'node:path';
import type { ModelEntry } from '../../core/registry.ts';
import { type PropDef, propEntry } from '../../archetypes/prop/index.ts';

async function collect(): Promise<ModelEntry[]> {
  const dir = import.meta.dir;
  const files = [...new Bun.Glob('*.ts').scanSync({ cwd: dir })].filter((f) => f !== 'registry.ts').sort();
  const out: ModelEntry[] = [];
  for (const f of files) {
    try {
      const mod = (await import(join(dir, f))) as { prop?: PropDef };
      if (mod.prop) out.push(propEntry(mod.prop));
    } catch (e) {
      console.warn(`[forge] props: ${f} failed to load and is skipped: ${(e as Error).message}`);
    }
  }
  return out;
}

export const registry: ModelEntry[] = await collect();

// Human enemies (auto-discovered): Silver Vow soldiers/archers/captains/mage-captains, barbarians, executioner, plagued villagers.
// Every `*.ts` file in this folder that exports `models: HumanModel[]` contributes its models (one file per family, no shared list to edit);
// each model is built through `buildHuman` (crowd humanoid pipeline with skeleton pruning, see archetypes/humans/rigx.ts).
import { join } from 'node:path';
import { type HumanModel, buildHuman } from '../../archetypes/humans/rigx.ts';
import type { ModelEntry } from '../../core/registry.ts';

async function collect(): Promise<HumanModel[]> {
  // family files are runtime-discovered (glob), so a static import list would defeat the "no shared file to edit" rule
  const dir = import.meta.dir;
  const files = [...new Bun.Glob('*.ts').scanSync({ cwd: dir })].filter((f) => f !== 'registry.ts').sort();
  const out: HumanModel[] = [];
  for (const f of files) {
    try {
      const mod = (await import(join(dir, f))) as { models?: HumanModel[] };
      if (Array.isArray(mod.models)) out.push(...mod.models);
    } catch (e) {
      // a half-finished family file must not block the other families
      console.warn(`[forge] WARNING: humans/${f} failed to load and is skipped: ${(e as Error).message}`);
    }
  }
  return out;
}

const models = await collect();

export const registry: ModelEntry[] = models.map((m) => {
  const p = m.params();
  return { id: p.id, kind: p.kind, build: (log, opts) => buildHuman(m.params(), m.rig, log, opts) };
});

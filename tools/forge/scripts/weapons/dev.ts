// bun scripts/weapons/dev.ts <id|prefix*>... [--tex=N] [--tilt=18] [--roll=35]

// tilted, lifted) for the viewer / gauntlet.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { displayCopy } from '../../src/archetypes/weapon/frame.ts';
import type { Hand } from '../../src/archetypes/weapon/frame.ts';
import { buildGlb } from '../../src/core/export/glb.ts';
import { repoRoot } from '../../src/core/export/manifest.ts';
import { registry } from '../../src/models/index.ts';

const args = process.argv.slice(2);
const kv = Object.fromEntries(args.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => a.slice(2).split('=') as [string, string]));
const ids = args.filter((a) => !a.startsWith('--'));
const tmp = join(repoRoot(), '.research', 'forge', 'tmp');
mkdirSync(tmp, { recursive: true });
const sel = registry.filter((e) => e.kind === 'weapon' && ids.some((w) => (w.endsWith('*') ? e.id.startsWith(w.slice(0, -1)) : e.id === w)));
if (!sel.length) throw new Error('no weapon matches ' + ids.join(','));
for (const e of sel) {
  const t0 = performance.now();
  const model = await e.build((s) => console.log(s), kv.tex !== undefined ? { texture: Number(kv.tex) } : undefined);
  const glb = await buildGlb(model);
  writeFileSync(join(tmp, `${e.id}.glb`), glb);
  const hand = ((model.extras?.weapon as { hand?: Hand } | undefined)?.hand ?? 'r') as Hand;
  const d = displayCopy(model, hand, { tilt: kv.tilt ? Number(kv.tilt) : undefined, roll: kv.roll ? Number(kv.roll) : undefined });
  writeFileSync(join(tmp, `${e.id}.d.glb`), await buildGlb(d));
  console.log(`${e.id}: ${model.indices.length / 3} tris, ${(glb.length / 1024).toFixed(1)} KB, ${Math.round(performance.now() - t0)} ms`);
}

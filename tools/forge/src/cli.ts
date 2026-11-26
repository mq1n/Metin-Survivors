// bun tools/forge/src/cli.ts <command>
//   list                         registered model ids


import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGlb } from './core/export/glb.ts';
import { repoRoot, writeModelAsset } from './core/export/manifest.ts';
import { stoneLantern } from './examples/stoneLantern.ts';
import { registry } from './models/index.ts';

const examples: Record<string, () => import('./core/model.ts').ModelData> = { stone_lantern: stoneLantern };

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--') && !a.includes('=')));
const kv = Object.fromEntries(rest.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => a.slice(2).split('=') as [string, string]));
const args = rest.filter((a) => !a.startsWith('--'));

async function main(): Promise<void> {
  if (cmd === 'list' || !cmd) {
    for (const e of registry) console.log(`${e.kind}/${e.id}`);
    return;
  }
  if (cmd === 'build') {
    const wants = args.flatMap((x) => x.split(',')).filter(Boolean);
    if (wants.length === 0) wants.push('all');
    const matches = (id: string, w: string): boolean => (w === 'all' ? true : w.endsWith('*') ? id.startsWith(w.slice(0, -1)) : id === w);
    const sel = registry.filter((e) => wants.some((w) => matches(e.id, w)));
    if (sel.length === 0) throw new Error(`no model matches ${wants.join(',')}`);
    const tmp = join(repoRoot(), '.research', 'forge', 'tmp');
    mkdirSync(tmp, { recursive: true });
    for (const e of sel) {
      const t0 = performance.now();
      console.log(`building ${e.id}`);
      const model = await e.build((s) => console.log(s), kv.tex !== undefined ? { texture: Number(kv.tex) } : undefined);
      const glb = await buildGlb(model, { quantizePositions: flags.has('--quantize') });
      writeFileSync(join(tmp, `${e.id}.glb`), glb);
      let shipped = '';
      if (flags.has('--ship')) shipped = ` -> ${writeModelAsset(model, glb).asset.url}`;
      console.log(`  ${e.id}: ${model.indices.length / 3} tris, ${model.skin?.skeleton.count ?? 0} bones, ${model.clips.length} clips, ${(glb.length / 1024).toFixed(1)} KB, ${Math.round(performance.now() - t0)} ms${shipped}`);
    }
    return;
  }
  if (cmd === 'example') {
    const make = examples[args[0] ?? ''];
    if (!make) throw new Error(`examples: ${Object.keys(examples).join(', ')}`);
    const tmp = join(repoRoot(), '.research', 'forge', 'tmp');
    mkdirSync(tmp, { recursive: true });
    const model = make();
    const glb = await buildGlb(model);
    writeFileSync(join(tmp, `${model.id}.glb`), glb);
    console.log(`  ${model.id}: ${model.indices.length / 3} tris, ${(glb.length / 1024).toFixed(1)} KB (not shipped)`);
    return;
  }
  throw new Error(`unknown command ${cmd}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

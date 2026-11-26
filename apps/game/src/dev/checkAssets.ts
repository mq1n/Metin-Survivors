// Release gate: every asset id the content references must exist in public/assets/manifest.json.
// Usage (after `bun tools/pipeline/manifest.ts`):  bun apps/game/src/dev/checkAssets.ts [--warn]
// Prints one line per missing reference grouped by asset kind; exits 1 when anything is missing (0 with --warn).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { content, validateContent, type AssetIndex } from '../data/loader';

const manifestPath = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'public', 'assets', 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`missing ${manifestPath} — run \`bun tools/pipeline/manifest.ts\` first`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<'models' | 'icons' | 'textures' | 'audio', Record<string, unknown>>;
const assets: AssetIndex = {
  models: new Set(Object.keys(manifest.models)),
  icons: new Set(Object.keys(manifest.icons)),
  textures: new Set(Object.keys(manifest.textures)),
  audio: new Set(Object.keys(manifest.audio)),
};
const report = validateContent(content, { assets, strict: true });
const missing = [...report.errors, ...report.warnings].filter((m) => /not in the asset index/i.test(m));
const rest = report.errors.filter((m) => !missing.includes(m));
const groups = new Map<string, string[]>();
for (const m of missing) {
  const kind = /model/i.test(m) ? 'models' : /icon/i.test(m) ? 'icons' : /texture/i.test(m) ? 'textures' : /audio|sound|music/i.test(m) ? 'audio' : 'other';
  const list = groups.get(kind) ?? [];
  list.push(m);
  groups.set(kind, list);
}
for (const [kind, list] of groups) {
  console.log(`\n## ${kind} (${list.length})`);
  for (const m of list) console.log(`  ${m}`);
}
if (rest.length > 0) {
  console.log(`\n## other content errors (${rest.length})`);
  for (const m of rest) console.log(`  ${m}`);
}
console.log(`\n${missing.length} missing asset references, ${rest.length} other errors`);
process.exit(missing.length + rest.length > 0 && !process.argv.includes('--warn') ? 1 : 0);

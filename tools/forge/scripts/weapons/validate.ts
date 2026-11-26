// bun scripts/weapons/validate.ts <glb>...   — Khronos glTF-Validator (errors/warnings/info counts) for built weapon GLBs
import { readFileSync } from 'node:fs';
import validator from 'gltf-validator';

let bad = 0;
for (const f of process.argv.slice(2)) {
  const bytes = new Uint8Array(readFileSync(f));
  const r = await validator.validateBytes(bytes, { uri: f, ignoredIssues: ['UNUSED_OBJECT'], maxIssues: 50 });
  const { numErrors, numWarnings, numInfos } = r.issues;
  console.log(`${f.split(/[\\/]/).pop()}: errors ${numErrors}, warnings ${numWarnings}, infos ${numInfos}`);
  if (numErrors || numWarnings) {
    bad++;
    for (const m of r.issues.messages.slice(0, 8)) console.log(`   ${m.severity} ${m.code} ${m.pointer ?? ''} ${m.message}`);
  }
}
process.exit(bad ? 1 : 0);

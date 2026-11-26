// C4 ratchet: the shared marbled crack texture (PAT.cracks, S4 in the VFX audit) stays registered for the skill domain
// but is on its way out of vfx/common/**. Today's uses are allow-listed per file; a builder may only remove them, never
// add new ones (lower the number here when a rebuild drops one).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../common/', import.meta.url));
const ALLOWED: Record<string, number> = {
  'boss/presets.ts': 2,
  'death-spawn/presets.ts': 2,
  'metin/presets.ts': 2,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('vfx/common uses no marbled crack stamp (PAT.cracks)', () => {
  it('only the allow-listed legacy uses remain', () => {
    const over: string[] = [];
    for (const f of walk(ROOT)) {
      const rel = relative(ROOT, f).replace(/\\/g, '/');
      const n = (readFileSync(f, 'utf8').match(/PAT\.cracks\b/g) ?? []).length;
      if (n > (ALLOWED[rel] ?? 0)) over.push(`${rel}: ${n} (allowed ${ALLOWED[rel] ?? 0})`);
    }
    expect(over).toEqual([]);
  });
});

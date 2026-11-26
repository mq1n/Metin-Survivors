// The README id table is the contract with content authors (data/loader.test.ts parses it too): it must equal the registry.
// Skill spec presets (`sk.*`) are documented by their FxSpec metadata instead (see skillSpecs.test.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VARIANT_NAMES } from '../palette';
import { PRESETS } from '../presets';
import { ensureAllSkillVfx } from '../skills/loader';

// the class specs are lazy chunks (vfx/skills/loader.ts): load them all before this file reads the registry
await ensureAllSkillVfx();

interface Row {
  ids: string[];
  variants: boolean | null;
}

function parseReadme(): Row[] {
  const text = readFileSync(new URL('../presets/README.md', import.meta.url), 'utf8');
  const rows: Row[] = [];
  let vCol = -1;
  let inTable = false;
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) {
      inTable = false;
      const m = line.match(/`ambient\.\w+`/g);
      if (m) for (const id of m) rows.push({ ids: [id.slice(1, -1)], variants: false });
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells[0] === 'id') {
      vCol = cells.indexOf('V');
      inTable = true;
      continue;
    }
    if (!inTable || cells[0]?.startsWith('---')) continue;
    const ids = [...(cells[0] ?? '').matchAll(/`([a-z0-9_.]+)`/g)].map((m) => m[1] as string).filter((id) => !id.endsWith('.'));
    if (ids.length === 0) continue;
    rows.push({ ids, variants: vCol >= 0 ? cells[vCol] === 'V' : false });
  }
  return rows;
}

describe('preset registry ≡ README', () => {
  const rows = parseReadme();
  const documented = new Map<string, boolean>();
  for (const r of rows) for (const id of r.ids) documented.set(id, r.variants === true);
  const registry = new Map(PRESETS.map((p) => [p.id, p]));

  it('has unique ids', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  it('implements every documented id', () => {
    const missing = [...documented.keys()].filter((id) => !registry.has(id));
    expect(missing).toEqual([]);
  });

  it('documents every implemented id (sk.* excluded)', () => {
    const extra = PRESETS.map((p) => p.id).filter((id) => !id.startsWith('sk.') && !documented.has(id));
    expect(extra).toEqual([]);
  });

  it('variant flags match the V column', () => {
    const wrong: string[] = [];
    for (const [id, v] of documented) {
      const def = registry.get(id);
      if (def && (def.variants === true) !== v) wrong.push(id);
    }
    expect(wrong).toEqual([]);
  });

  it('gives every target-needing loop/one-shot a gallery demo target', () => {
    const bad = PRESETS.filter((p) => p.needsTarget === true && p.demo?.target === undefined).map((p) => p.id);
    expect(bad).toEqual([]);
  });

  it('knows every variant suffix', () => {
    expect(VARIANT_NAMES.length).toBeGreaterThanOrEqual(18);
  });
});

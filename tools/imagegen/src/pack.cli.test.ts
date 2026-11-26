// `icons --pack --dry` through the real CLI against the real content / hints / refmap: nothing is generated, nothing is written.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadHints, readCollectionDefs } from './iconjobs';

const CLI = join(import.meta.dir, 'cli.ts');
const run = (...args: string[]): { code: number; out: string; err: string } => {
  const p = Bun.spawnSync(['bun', CLI, ...args], { stdout: 'pipe', stderr: 'pipe' });
  return { code: p.exitCode ?? -1, out: p.stdout.toString(), err: p.stderr.toString() };
};
const ids = (c: 'talents' | 'gear' | 'stones', n: number): string[] => [...new Set(readCollectionDefs(c).map((d) => d.icon!).filter(Boolean))].slice(0, n);

describe('icons --pack --dry (CLI)', () => {
  // every CLI call prepares the reference images through python (about 1-3 s)
  const T = 90_000;
  test('talents: one pack of four ids, cell -> id map, numbered images, the exact message, no engine call', () => {
    const four = ids('talents', 4);
    const r = run('icons', '--collection', 'talents', '--gen', '--ids', four.join(','), '--pack', '--dry', '--variants', '3');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/=== PACK pack_talents_[0-9a-f]{8} {2}\(talents, tile, 4 of 4 cells used/);
    four.forEach((id, i) => {
      expect(r.out).toContain(`cell ${i + 1} `);
      expect(r.out).toContain(id);
    });
    expect(r.out).toContain('cell 1 (TOP-LEFT) = ');
    expect(r.out).toContain('cell 4 (BOTTOM-RIGHT) = ');
    expect(r.out).toContain('Call image_gen EXACTLY ONCE.');
    expect(r.out).toContain('[dry] 4 id(s) -> 1 pack(s) (4 cells)');
    expect(r.out).toContain('3 variant(s) each => 3 image(s) (instead of 12)');
  }, T);
  test('9 ids: two full packs + the lone remainder as a single job; remainder pad: 10 ids -> a padded pack of 2', () => {
    const nine = ids('talents', 9);
    const a = run('icons', '--collection', 'talents', '--gen', '--ids', nine.join(','), '--pack', '--dry');
    expect(a.code).toBe(0);
    expect(a.out.match(/=== PACK /g)).toHaveLength(2);
    expect(a.out).toContain(`=== SINGLE ${nine[8]} `);
    const ten = run('icons', '--collection', 'talents', '--gen', '--ids', ids('talents', 10).join(','), '--pack', '--dry');
    expect(ten.out.match(/=== PACK /g)).toHaveLength(3);
    expect(ten.out).toContain('2 of 4 cells used');
    expect(ten.out).toContain('(padded pack: cells 3-4 are explicitly empty');
    const single = run('icons', '--collection', 'talents', '--gen', '--ids', ids('talents', 10).join(','), '--pack', '--dry', '--remainder', 'single');
    expect(single.out.match(/=== PACK /g)).toHaveLength(2);
    expect(single.out.match(/=== SINGLE /g)).toHaveLength(2);
  }, T);
  test('cut-outs: stones pack with a transparent request; --json prints the ref list and the cell map', () => {
    const four = ids('stones', 4);
    const r = run('icons', '--collection', 'stones', '--gen', '--ids', four.join(','), '--pack', '--dry', '--json', '--refs-per-cell', '1');
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out) as { pack: string; form: string; cells: { id: string; images: number[] }[]; refs: { src: string }[]; prompt: string }[];
    expect(j).toHaveLength(1);
    expect(j[0]!.form).toBe('cutout');
    expect(j[0]!.cells.map((c) => c.id)).toEqual(four);
    expect(j[0]!.refs.length).toBeLessThanOrEqual(4);
    expect(j[0]!.prompt).toContain('request a transparent background from the tool');
  }, T);
  test('skills with grades keep their grade sheet: --pack refuses them', () => {
    const hints = loadHints('skills');
    const withGrades = Object.keys(hints).find((k) => hints[k]!.grades?.length);
    if (!withGrades) return;
    const r = run('icons', '--collection', 'skills', '--gen', '--ids', withGrades, '--pack', '--dry');
    // a lone id is a single job (the normal grade-sheet gen), two ids hit the refusal
    expect(r.code).toBe(0);
    expect(r.out).toContain('2 x 2 SHEET');
    const two = Object.keys(hints).filter((k) => hints[k]!.grades?.length).slice(0, 2);
    if (two.length === 2) {
      const r2 = run('icons', '--collection', 'skills', '--gen', '--ids', two.join(','), '--pack', '--dry');
      expect(r2.code).toBe(1);
      expect(r2.err).toContain('GRADE sheet');
    }
  }, T);
  test('unknown ids are reported', () => {
    const r = run('icons', '--collection', 'talents', '--gen', '--ids', 'icon_talent_nope_1,icon_talent_nope_2', '--pack', '--dry');
    expect(r.code).toBe(1);
    expect(r.err).toContain('not in talents');
  }, T);
});

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { iconJobV2, type IconDef, type IconHint } from './iconjobs';
import { legacyIconJobsText } from './icons';
import { PACK_CELLS } from './defs/packStyle';
import { capRefs, groupPacks, packIdFor, planPackFrom } from './iconpack';
import { JOBS_DIR } from './paths';
import { soloPrompt } from './codex';
import { toSessionJob } from './runner';

const talent = (n: number, extra: Partial<IconDef> = {}): IconDef => ({ id: `t${n}`, icon: `icon_talent_zz_pack_${n}`, name: { en: `Test Talent ${n}` }, classId: 'warrior', doctrine: 'a', row: 0, col: n, tree: 'warrior_a', ...extra });
const REF = (id: string, f: string): string => `.research/prep/icons/ref/${id}/${f}`;
const thint = (n: number, refs: number): IconHint => ({
  subject: `Test Talent ${n}: the talent number ${n}`,
  glyph: `glyph concept number ${n} drawn bold`,
  refs: Array.from({ length: refs }, (_, i) => REF(`zz${n}`, `ref_${n}_${i}.png`)),
});
const four = (refs = 2): { def: IconDef; hint: IconHint }[] => [1, 2, 3, 4].map((n) => ({ def: talent(n), hint: thint(n, refs) }));

describe('pack grouping', () => {
  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `id${i}`);
  test('packs of 4 in order; a remainder of 2-3 becomes one padded pack, 1 becomes a single job', () => {
    expect(groupPacks(ids(8))).toEqual({ packs: [ids(8).slice(0, 4), ids(8).slice(4)], singles: [] });
    expect(groupPacks(ids(9)).singles).toEqual(['id8']);
    expect(groupPacks(ids(9)).packs).toHaveLength(2);
    expect(groupPacks(ids(10)).packs.map((p) => p.length)).toEqual([4, 4, 2]);
    expect(groupPacks(ids(11)).packs.map((p) => p.length)).toEqual([4, 4, 3]);
    expect(groupPacks(ids(3))).toEqual({ packs: [ids(3)], singles: [] });
    expect(groupPacks(ids(1))).toEqual({ packs: [], singles: ['id0'] });
    expect(groupPacks([])).toEqual({ packs: [], singles: [] });
  });
  test('remainder single keeps every pack full and sends the rest to single jobs', () => {
    const g = groupPacks(ids(11), 'single');
    expect(g.packs.map((p) => p.length)).toEqual([4, 4]);
    expect(g.singles).toEqual(['id8', 'id9', 'id10']);
  });
  test('duplicates are dropped, order is kept', () => {
    expect(groupPacks(['a', 'b', 'a', 'c', 'd']).packs).toEqual([['a', 'b', 'c', 'd']]);
  });
  test('pack id is deterministic, order-sensitive and a valid job id', () => {
    const a = packIdFor('talents', ['x', 'y', 'z']);
    expect(a).toBe(packIdFor('talents', ['x', 'y', 'z']));
    expect(a).not.toBe(packIdFor('talents', ['y', 'x', 'z']));
    expect(a).toMatch(/^pack_talents_[0-9a-f]{8}$/);
    expect(a).toMatch(/^[a-z0-9_]+$/);
  });
});

describe('pack prompt composition (tiles)', () => {
  const plan = planPackFrom('talents', four());
  test('one sheet message: the cells in reading order, each with its own subject and glyph, the shared style once', () => {
    expect(plan.form).toBe('tile');
    expect(plan.n).toBe(4);
    const g = plan.job.goal!;
    const at = (s: string): number => g.indexOf(s);
    expect(at('cell 1 (TOP-LEFT)')).toBeGreaterThanOrEqual(0);
    expect(at('cell 1 (TOP-LEFT)')).toBeLessThan(at('cell 2 (TOP-RIGHT)'));
    expect(at('cell 2 (TOP-RIGHT)')).toBeLessThan(at('cell 3 (BOTTOM-LEFT)'));
    expect(at('cell 3 (BOTTOM-LEFT)')).toBeLessThan(at('cell 4 (BOTTOM-RIGHT)'));
    for (const n of [1, 2, 3, 4]) {
      expect(g).toContain(`"Test Talent ${n}"`);
      expect(g).toContain(`glyph concept number ${n} drawn bold`);
      expect(g).toContain(`the talent number ${n}`);
    }
    // the style block is said ONCE
    expect(g.match(/WHITE stencil pictograms on a pure black background/g)).toHaveLength(1);
    expect(g.match(/at least 1\/30 of the sheet wide/g)).toHaveLength(1);
    expect(g).toContain('FOUR DIFFERENT pictograms');
    expect(g).not.toContain('grade 2'); // never the grade-sheet wording
    expect(g).not.toContain('grows with');
    expect(plan.job.background).toBe('black');
    expect(plan.job.post).toEqual([]);
    expect(plan.job.aspect).toBe('square');
  });
  test('the sheet message the engine gets: ONE image_gen call, the image list with the explicit cell mapping, then the goal', () => {
    const msg = soloPrompt(toSessionJob(plan.job, plan.job.refs!.map((r) => (typeof r === 'string' ? { path: r } : { path: r.path, role: r.role }))));
    expect(msg).toContain('Call image_gen EXACTLY ONCE.');
    expect(msg).toContain(`{"${plan.packId}": "<absolute path of the generated image>"}`);
    expect(msg.indexOf('Attached images:')).toBeLessThan(msg.indexOf('Goal: a 2 x 2 SHEET'));
    expect(msg).toContain('- Image 1 = reference for the TOP-LEFT cell ("Test Talent 1") only:');
    expect(msg).toContain('- Image 3 = reference for the TOP-RIGHT cell ("Test Talent 2") only:');
    expect(msg).toContain('- Image 8 = reference for the BOTTOM-RIGHT cell ("Test Talent 4") only:');
  });
  test('every id keeps its own single job (post chain without a grid), the ref roles of the single job are kept in the mapping', () => {
    for (const [i, c] of plan.cells.entries()) {
      expect(c.id).toBe(`icon_talent_zz_pack_${i + 1}`);
      expect(c.cell).toBe(PACK_CELLS[i]!);
      expect(c.job).toEqual(iconJobV2('talents', talent(i + 1), thint(i + 1, 2))!);
      expect((c.job.post.find((o) => o.op === 'octile') as { grid?: number }).grid).toBeUndefined();
    }
    expect(plan.refs[0]!.role).toContain('the TOP-LEFT cell ("Test Talent 1") only: the original game');
  });
});

describe('pack reference mapping', () => {
  test('two refs per cell: Image 1-2 = cell 1, 3-4 = cell 2 ...; primary first', () => {
    const plan = planPackFrom('talents', four(2));
    expect(plan.refs).toHaveLength(8);
    expect(plan.cells.map((c) => c.images)).toEqual([[1, 2], [3, 4], [5, 6], [7, 8]]);
    expect(plan.refs.map((r) => r.cells)).toEqual([[0], [0], [1], [1], [2], [2], [3], [3]]);
    expect(plan.refs[0]!.path).toBe(REF('zz1', 'ref_1_0.png'));
    expect(plan.refs[1]!.path).toBe(REF('zz1', 'ref_1_1.png'));
  });
  test('the cap lowers the per-cell count to 1 (primary refs) when the sheet would carry too many images', () => {
    const plan = planPackFrom('talents', four(2), { maxRefs: 6 });
    expect(plan.refs).toHaveLength(4);
    expect(plan.perCell).toBe(1);
    expect(plan.refs.map((r) => r.path)).toEqual([1, 2, 3, 4].map((n) => REF(`zz${n}`, `ref_${n}_0.png`)));
    expect(plan.dropped).toHaveLength(4);
    expect(planPackFrom('talents', four(2), { refsPerCell: 1 }).refs).toHaveLength(4);
    expect(planPackFrom('talents', four(3)).refs).toHaveLength(8); // 2 per cell by default even when an id has 3
  });
  test('an image shared by several cells is attached once and names every cell', () => {
    const shared = REF('shared', 'doctrine.png');
    const defs = [1, 2, 3, 4].map((n) => ({ def: talent(n), hint: { ...thint(n, 0), refs: [shared, REF(`zz${n}`, `own_${n}.png`)] } }));
    const plan = planPackFrom('talents', defs);
    expect(plan.refs).toHaveLength(5);
    expect(plan.refs[0]!.cells).toEqual([0, 1, 2, 3]);
    expect(plan.refs[0]!.role).toContain('the TOP-LEFT cell ("Test Talent 1") and the TOP-RIGHT cell ("Test Talent 2") and the BOTTOM-LEFT cell');
    expect(plan.cells.map((c) => c.images[0])).toEqual([1, 1, 1, 1]);
  });
  test('a hard ceiling applies even when maxRefs is raised', () => {
    const cells = planPackFrom('talents', four(3), { maxRefs: 99, refsPerCell: 3 }).cells;
    expect(capRefs(cells, 3, 99).unique).toBeLessThanOrEqual(12);
    expect(capRefs(cells, 3, 2).unique).toBe(2);
  });
  test('ids without any ref still pack (no refs attached, no mapping lines)', () => {
    const plan = planPackFrom('talents', four(0).map((x) => ({ ...x, hint: { ...x.hint, refs: [] } })));
    // hint.refs [] falls back to the prep refmap, which has nothing for these synthetic ids
    expect(plan.refs).toHaveLength(0);
    expect(plan.job.refs).toBeUndefined();
  });
});

describe('pack: grades, forms, padding', () => {
  test('skills with grades keep their grade sheet: packing them is refused unless forced', () => {
    const sk: IconDef = { id: 'sk', icon: 'icon_skill_zz_pack', name: { en: 'Zz Skill' }, classId: 'warrior', doctrine: 'a' };
    const withGrades: IconHint = { subject: 's', glyph: 'g', grades: ['grade two adds a stroke', 'grade three adds more', 'grade four adds the most'] };
    expect(() => planPackFrom('skills', [{ def: sk, hint: withGrades }])).toThrow(/GRADE sheet/);
    const forced = planPackFrom('skills', [{ def: sk, hint: withGrades }], { forcePack: true });
    expect((forced.cells[0]!.job.post.find((o) => o.op === 'octile') as { grid?: number }).grid).toBeUndefined();
    expect(forced.cells[0]!.job.goal).not.toContain('2 x 2 SHEET');
  });
  test('cut-outs: transparent sheet, silhouette + palette per cell, rendering block once', () => {
    const gear = (n: number, slot: string, id: string): { def: IconDef; hint: IconHint } => ({
      def: { id: `g${n}`, icon: id, name: { en: `Gear ${n}` }, slot, tier: 1, classes: ['warrior'] },
      hint: { subject: `Gear ${n}: a test item ${n}`, silhouette: `silhouette rule ${n}`, palette: [`colour ${n}a`, `colour ${n}b`] },
    });
    const plan = planPackFrom('gear', [gear(1, 'weapon', 'icon_gear_warrior_weapon_sword_zz1'), gear(2, 'armor', 'icon_gear_zz2'), gear(3, 'helmet', 'icon_gear_zz3')]);
    expect(plan.form).toBe('cutout');
    expect(plan.n).toBe(3);
    expect(plan.job.background).toBe('transparent');
    const g = plan.job.goal!;
    expect(g).toContain('silhouette rule 1');
    expect(g).toContain('silhouette rule 3');
    expect(g).toContain('colour 2a, colour 2b');
    expect(g).toContain('cell 4 (BOTTOM-RIGHT) = EMPTY: leave this cell completely transparent');
    expect(g.match(/hand-painted like a classic MMORPG item icon/g)).toHaveLength(1);
    expect(g).not.toContain('Composition: a single one-handed sword on the diagonal'); // hint silhouette replaces the family template
    expect(plan.cells[0]!.job.post.some((o) => o.op === 'fit')).toBe(true);
    expect(soloPrompt(toSessionJob(plan.job))).toContain('request a transparent background from the tool');
  });
  test('padded tile pack names the empty cells', () => {
    const plan = planPackFrom('talents', four().slice(0, 2));
    expect(plan.n).toBe(2);
    expect(plan.job.goal).toContain('cell 3 (BOTTOM-LEFT) = EMPTY: leave this cell completely black');
    expect(plan.job.goal).toContain('cell 4 (BOTTOM-RIGHT) = EMPTY');
  });
  test('tiles and cut-outs never share a sheet', () => {
    const mix = [...four().slice(0, 2), { def: { id: 'g', icon: 'icon_talent_zz_mix', name: { en: 'Mixed' } } as IconDef, hint: { subject: 'x', silhouette: 'y', form: 'cutout' as const } }];
    expect(() => planPackFrom('talents', mix)).toThrow(/cannot mix tile and cut-out/);
  });
  test('1-4 ids only', () => {
    expect(() => planPackFrom('talents', [])).toThrow();
    expect(() => planPackFrom('talents', [...four(), four()[0]!])).toThrow();
  });
});

describe('what pack mode must not change', () => {
  const def: IconDef = { id: 'sk_test', icon: 'icon_skill_test_grid', name: { en: 'Test Cut' }, classId: 'warrior', doctrine: 'a' };
  const hint: IconHint = {
    subject: 'Test Cut: three slashes',
    glyph: 'three long parallel slash strokes on the diagonal',
    grades: ['a fourth parallel slash stroke joins the three', 'a fifth parallel slash stroke and thicker strokes', 'six parallel slash strokes and a second ring'],
  };
  test('the skill grade-sheet job is byte-identical to the one captured before pack mode existed', () => {
    const golden = readFileSync(join(import.meta.dir, '__fixtures__', 'grade_sheet_job.json'), 'utf8');
    expect(JSON.stringify(iconJobV2('skills', def, hint), null, 1) + '\n').toBe(golden);
  });
  test('`icons --legacy --dry` text equals the checked-in jobs/icons.jsonl', () => {
    const file = join(JOBS_DIR, 'icons.jsonl');
    if (!existsSync(file)) return;
    expect(legacyIconJobsText()).toBe(readFileSync(file, 'utf8'));
  });
});

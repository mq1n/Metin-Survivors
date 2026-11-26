import { describe, expect, test } from 'bun:test';
import { iconJobV2, type IconDef, type IconHint } from './iconjobs';

const def: IconDef = { id: 'sk_test', icon: 'icon_skill_test_grid', name: { en: 'Test Cut' }, classId: 'warrior', doctrine: 'a' };
const hint: IconHint = {
  subject: 'Test Cut: three slashes',
  glyph: 'three long parallel slash strokes on the diagonal',
  grades: ['a fourth parallel slash stroke joins the three', 'a fifth parallel slash stroke and thicker strokes', 'six parallel slash strokes and a second ring'],
};

describe('icon grade-growth (grid) jobs', () => {
  test('hint.grades makes one 2x2 sheet job that the post chain cuts per band', () => {
    const j = iconJobV2('skills', def, hint)!;
    expect(j.goal).toContain('2 x 2 SHEET');
    expect(j.goal).toContain('cell 1 = grade 1');
    expect(j.goal).toContain('a fifth parallel slash stroke');
    const oct = j.post.find((o) => o.op === 'octile') as { grid?: number; bands?: string[] };
    expect(oct.grid).toBe(2);
    expect(oct.bands).toEqual(['n', 'm', 'g', 'p']);
  });

  test('without grades the job stays a single stencil (no grid)', () => {
    const j = iconJobV2('skills', def, { ...hint, grades: undefined })!;
    expect(j.goal).not.toContain('2 x 2 SHEET');
    expect((j.post.find((o) => o.op === 'octile') as { grid?: number }).grid).toBeUndefined();
  });

  test('a grid job on a one-band tile is ignored (grades need the 4 skill bands)', () => {
    const j = iconJobV2('skills', def, { ...hint, bands: ['n'] })!;
    expect((j.post.find((o) => o.op === 'octile') as { grid?: number }).grid).toBeUndefined();
  });
});

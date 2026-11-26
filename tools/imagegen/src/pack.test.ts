// End-to-end proof of PACK mode with SYNTHETIC sheets (no engine call): sheet -> slice -> per-id post -> checks -> per-id metadata.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateVariant } from './gates';
import { defaultGenOptions, vDir, genDir, type GenVariant } from './gen';
import { planPackFrom } from './iconpack';
import type { IconDef, IconHint } from './iconjobs';
import { genPack, readPackMeta, reservePack, type PackCellMeta } from './pack';
import { CONTACT, GEN, PY, RESEARCH } from './paths';
import type { JobSpec } from './types';

const tmp = mkdtempSync(join(tmpdir(), 'ms-pack-test-'));
const created: string[] = [];

function py(code: string, ...args: string[]): void {
  const p = Bun.spawnSync(['python', '-c', code, ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`python failed: ${p.stderr.toString().slice(-400)}`);
}
const PRE = `import sys; sys.path.insert(0, ${JSON.stringify(PY.replaceAll('\\', '/'))}); import test_pack as T; from PIL import Image, ImageDraw; `;

function sheet(name: string, code: string): string {
  const out = join(tmp, name);
  py(PRE + code + "; im.save(sys.argv[1])", out);
  return out;
}

/** Remove everything the tests wrote: gen dirs / contact sheets / gates of the throw-away ids and of their packs (also stale ones of an aborted run). */
function cleanup(removeTmp: boolean): void {
  const mine = (name: string): boolean => name.includes('zz_packtest') || created.some((c) => name.includes(c));
  const rm = (p: string): void => {
    try {
      rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* a lingering handle: the next run's beforeAll removes it */
    }
  };
  for (const [dir, test] of [
    [GEN, mine],
    [CONTACT, mine],
    [join(RESEARCH, 'gates', 'talents'), mine],
    [join(RESEARCH, 'gates', 'gear'), mine],
  ] as const) {
    if (existsSync(dir)) for (const f of readdirSync(dir)) if (test(f) || (dir === GEN && /^pack_(talents|gear)_/.test(f) && staleSynthetic(join(dir, f)))) rm(join(dir, f));
  }
  if (removeTmp) rm(tmp);
}
/** A pack dir whose job.json names a zz_packtest id (leftover of an aborted run). */
function staleSynthetic(dir: string): boolean {
  try {
    return readdirSync(dir).some((v) => existsSync(join(dir, v, 'job.json')) && readFileSync(join(dir, v, 'job.json'), 'utf8').includes('zz_packtest'));
  } catch {
    return false;
  }
}

// 120 s like afterAll: the cleanup walks the gen dirs of every throw-away id; under the parallel root `bun run test` it took 6-11 s (bun's hook default is 5 s)
beforeAll(() => cleanup(false), 120_000);
afterAll(() => cleanup(true), 120_000);

const refPng = join(tmp, 'ref.png');
py("from PIL import Image; Image.new('RGB', (64, 64), (120, 90, 40)).save(__import__('sys').argv[1])", refPng);

describe('pack e2e (synthetic sheets)', () => {
  test('tiles: good sheet + a sheet with an empty cell -> per-id variants, metadata, one id to reroll', async () => {
    const defs: { def: IconDef; hint: IconHint }[] = [1, 2, 3, 4].map((n) => ({
      def: { id: `t${n}`, icon: `icon_talent_zz_packtest_${n}`, name: { en: `Pack Test ${n}` }, classId: 'warrior', doctrine: 'a', row: n % 5, col: n, tree: 'warrior_a' },
      hint: { subject: `Pack Test ${n}: test`, glyph: `test glyph ${n}`, refs: [refPng] },
    }));
    const plan = planPackFrom('talents', defs);
    created.push(plan.packId, ...plan.ids);
    const good = sheet('tile_good.png', 'im = T.tile_sheet()');
    const bad = sheet('tile_bad.png', "im = T.tile_sheet(); ImageDraw.Draw(im).rectangle((600, 90, 900, 380), fill='black')");
    const res = await genPack(plan, { ...defaultGenOptions, variants: 2, cell: 160 }, [good, bad]);

    expect(res.ks).toEqual([1, 2]);
    expect(res.reroll).toEqual([]); // v1 of every id is usable
    expect(res.cells.map((c) => c.id)).toEqual(plan.ids);
    expect(existsSync(join(CONTACT, `gen_${plan.packId}.png`))).toBe(true);
    expect(res.sheets[0]!.slice!.failed).toEqual([]);
    expect(res.sheets[1]!.slice!.failed).toEqual([2]);

    for (const [i, cell] of plan.cells.entries()) {
      const id = cell.id;
      const v1 = vDir(id, 1);
      // the id's own single job, its cell raw, the build, the near-duplicate check, the contact sheet
      expect(JSON.parse(readFileSync(join(v1, 'job.json'), 'utf8')) as JobSpec).toEqual(cell.job);
      expect(existsSync(join(v1, 'raw.png'))).toBe(true);
      expect(existsSync(join(v1, 'build', `${id}.webp`))).toBe(true);
      expect(existsSync(join(CONTACT, `gen_${id}.png`))).toBe(true);
      const meta = JSON.parse(readFileSync(join(v1, 'meta.json'), 'utf8')) as GenVariant;
      expect(meta.k).toBe(1);
      expect(meta.w).toBe(256);
      expect(meta.pack).toEqual({ packId: plan.packId, cell: i + 1, cellName: cell.cell, ids: plan.ids });
      const pm = readPackMeta(id, 1) as PackCellMeta;
      expect(pm.packId).toBe(plan.packId);
      expect(pm.cell).toBe(i + 1);
      expect(pm.ids).toEqual(plan.ids);
      expect(pm.sheet).toContain(`${plan.packId}/v1/raw.png`);
      expect(pm.images.map((x) => x.n)).toEqual(cell.images);
      expect(pm.slice.ok).toBe(true);
      expect(pm.slice.cell_size).toBeGreaterThanOrEqual(256);
      expect(readFileSync(join(v1, 'prompt.txt'), 'utf8')).toContain('cell 1 (TOP-LEFT)');
    }
    // v2: the empty cell 2 is reported, the other three are usable
    const failed = plan.cells[1]!.id;
    expect(existsSync(join(vDir(failed, 2), 'raw.png'))).toBe(false);
    const fm = JSON.parse(readFileSync(join(vDir(failed, 2), 'meta.json'), 'utf8')) as GenVariant;
    expect(fm.error).toContain('empty cell');
    expect(fm.build).toBeNull();
    for (const i of [0, 2, 3]) expect(existsSync(join(vDir(plan.cells[i]!.id, 2), 'build', `${plan.cells[i]!.id}.webp`))).toBe(true);
    expect(res.cells[1]!.usable).toEqual([1]);
    // a pack that loses its only usable variant lists the id for a reroll
    const res2 = await genPack(plan, { ...defaultGenOptions, variants: 1, cell: 160 }, [bad]);
    expect(res2.ks).toEqual([3]); // numbering continues, common to all four ids
    expect(res2.reroll).toEqual([failed]);
    expect(res2.cells[0]!.usable).toEqual([3]);
    // `gates` / `pick` read the per-id variant exactly as for an ordinary gen variant
    const gate = await gateVariant(plan.cells[0]!.id, 1);
    expect(gate).not.toBeNull();
    expect(existsSync(gate!.report)).toBe(true);
  }, 180_000);

  test('cut-outs on a transparent sheet: four RGBA 256 px builds, alpha kept, per-id metadata', async () => {
    const mk = (n: number, slot: string, id: string): { def: IconDef; hint: IconHint } => ({
      def: { id: `g${n}`, icon: id, name: { en: `Pack Gear ${n}` }, slot, tier: 1, classes: ['warrior'] },
      hint: { subject: `Pack Gear ${n}: test item`, silhouette: `shape ${n}`, palette: 'steel', refs: [refPng] },
    });
    const plan = planPackFrom('gear', [mk(1, 'weapon', 'icon_gear_warrior_weapon_sword_zzpacktest1'), mk(2, 'bracelet', 'icon_gear_zz_packtest_2'), mk(3, 'helmet', 'icon_gear_zz_packtest_3'), mk(4, 'shield', 'icon_gear_zz_packtest_4')]);
    created.push(plan.packId, ...plan.ids);
    const s = sheet('cut.png', 'im = T.cutout_sheet(None)');
    const res = await genPack(plan, { ...defaultGenOptions, variants: 1, cell: 160 }, [s]);
    expect(res.reroll).toEqual([]);
    expect(res.sheets[0]!.slice!.mode).toBe('alpha');
    for (const cell of plan.cells) {
      const meta = JSON.parse(readFileSync(join(vDir(cell.id, 1), 'meta.json'), 'utf8')) as GenVariant;
      expect(meta.alpha).toBe(true);
      expect(meta.w).toBe(256);
      expect(meta.pack?.packId).toBe(plan.packId);
      expect(readdirSync(join(vDir(cell.id, 1), 'build')).some((f) => f.endsWith('.webp'))).toBe(true);
      expect(meta.gates).toEqual([]); // the single-icon gates ran on the built cell and passed
    }
    // a cell that fails a gate (a near-black object: the item-icon luma floor) is reported for a reroll, the other three stay usable
    const dark = sheet('cut_dark.png', "im = T.cutout_sheet(None); ImageDraw.Draw(im).ellipse((600, 120, 880, 400), fill=(14, 14, 28, 255))");
    const res2 = await genPack(plan, { ...defaultGenOptions, variants: 1, cell: 160 }, [dark]);
    expect(res2.ks).toEqual([2]);
    expect(res2.reroll).toEqual([plan.cells[1]!.id]);
    expect(res2.cells[1]!.variants[0]!.gates!.length).toBeGreaterThan(0);
    expect(res2.cells[1]!.variants[0]!.build).not.toBeNull(); // built, but not usable: pick would refuse it without --waive
    for (const i of [0, 2, 3]) expect(res2.cells[i]!.usable).toEqual([2]);
  }, 180_000);

  test('variant numbers are common to the pack and its ids: the next free k above every existing variant', () => {
    const defs = [1, 2].map((n) => ({ def: { id: `x${n}`, icon: `icon_talent_zz_packtest_k${n}`, name: { en: `K ${n}` } } as IconDef, hint: { subject: 's', glyph: 'g' } }));
    const plan = planPackFrom('talents', defs);
    created.push(plan.packId, ...plan.ids);
    mkdirSync(vDir(plan.ids[1]!, 5), { recursive: true });
    const r = reservePack(plan, 2);
    expect(r.ks).toEqual([6, 7]);
    for (const id of [plan.packId, ...plan.ids]) for (const k of r.ks) expect(existsSync(vDir(id, k))).toBe(true);
    expect(reservePack(plan, 1).ks).toEqual([8]);
  });
});

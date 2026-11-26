import { describe, expect, it } from 'vitest';
import { content as realContent } from '../data/loader';
import { fixtureContent } from './__fixtures__/content';
import { freshSave } from './__fixtures__/testkit';
import { validateMetaContent } from './contentCheck';
import { dropTableFor } from './drops';
import { CLASS_IDS, type MetaContent } from './types';
import { parseCodexCondition } from './unlocks';

const clone = (): MetaContent => structuredClone(fixtureContent);

/** The fixture deliberately carries three "bad" entries (garbage codex unlock, unmapped effect, bogus skillMod stat). */
function cleaned(): MetaContent {
  const c = clone();
  c.story.codex = c.story.codex.filter((e) => e.id !== 'codex_garbage');
  for (const t of c.talents) {
    for (const n of t.nodes) {
      if (n.effect?.kind === 'weirdUnknownKind') delete n.effect;
      if (n.effect?.kind.startsWith('skillMod:')) delete n.effect.params.bogus;
      if (!n.perPoint && !n.effect) n.perPoint = { damage: 0.01 };
    }
  }
  return c;
}

describe('validateMetaContent', () => {
  it('accepts well-formed content', () => {
    expect(validateMetaContent(cleaned())).toEqual([]);
  });

  it('flags exactly the deliberate fixture problems otherwise', () => {
    const problems = validateMetaContent(fixtureContent);
    expect(problems.some((p) => p.includes('codex_garbage'))).toBe(true);
    expect(problems.some((p) => p.includes("'weirdUnknownKind'"))).toBe(true);
    expect(problems.some((p) => p.includes("skillMod param 'bogus' is not an UpgradeStat"))).toBe(true);
    expect(problems.filter((p) => !/codex_garbage|weirdUnknownKind|'bogus'/.test(p))).toEqual([]);
  });

  it('catches malformed effect params', () => {
    const c = cleaned();
    const node = c.talents.flatMap((t) => t.nodes).find((n) => n.effect?.kind === 'startLevel');
    if (!node?.effect) throw new Error('fixture');
    node.effect.params = { value: Number.NaN };
    const sm = c.talents.flatMap((t) => t.nodes).find((n) => n.effect?.kind.startsWith('skillMod:'));
    if (!sm?.effect) throw new Error('fixture');
    sm.effect.params = { toString: 1 };
    const p = validateMetaContent(c);
    expect(p.some((x) => x.includes("effect 'startLevel' needs a numeric params.value"))).toBe(true);
    expect(p.some((x) => x.includes("skillMod param 'toString' is not an UpgradeStat"))).toBe(true);
  });

  it('catches blacksmith misconfiguration', () => {
    const c = cleaned();
    c.balance.blacksmith.successRate = [1, 0.9, 0.95, 0.5, 0.4, 0.3, 0.2, 0.1];
    c.balance.blacksmith.yeopCost = [1, 2, 3];
    const p = validateMetaContent(c);
    expect(p.some((x) => x.includes('successRate needs 9'))).toBe(true);
    expect(p.some((x) => x.includes('must not increase (index 2)'))).toBe(true);
    expect(p.some((x) => x.includes('yeopCost needs 9'))).toBe(true);
  });

  it('catches talent tree defects', () => {
    const c = cleaned();
    const tree = c.talents.find((t) => t.id === 'ninja_a');
    if (!tree) throw new Error('fixture');
    tree.nodes = tree.nodes.filter((n) => n.row < 3); // 3 rows, capacity 27
    const first = tree.nodes[0];
    if (first) first.requires = 'ghost';
    tree.milestones = [{ at: 10 }];
    const p = validateMetaContent(c);
    expect(p.some((x) => x.includes('ninja_a: needs 5 rows'))).toBe(true);
    expect(p.some((x) => x.includes('capacity 27 < 30'))).toBe(true);
    expect(p.some((x) => x.includes('requires unknown node ghost'))).toBe(true);
    expect(p.some((x) => x.includes('milestones must be at 10/20/30, got 10'))).toBe(true);
    const c2 = cleaned();
    const t2 = c2.talents.find((t) => t.id === 'yacha_b');
    if (!t2) throw new Error('fixture');
    for (const n of t2.nodes) if (n.row === 0) n.max = 1; // 3 points above row 1: it can never open
    expect(validateMetaContent(c2).some((x) => x.includes('yacha_b: row 1 can never unlock'))).toBe(true);
    const c3 = cleaned();
    c3.talents = c3.talents.filter((t) => t.id !== 'wolfman_b');
    expect(validateMetaContent(c3)).toContain('talent tree wolfman_b missing');
  });

  it('catches gear / zone / codex reference errors', () => {
    const c = cleaned();
    const g = c.gear[0];
    if (!g) throw new Error('fixture');
    g.source = { zone: 'atlantis', chance: 0 };
    const w = c.gear.find((x) => x.id === 'seori_weapon_ninja');
    if (w) w.source = { zone: 'seori', boss: 'yeonmu_boss1', chance: 0.3 };
    const seori = c.zones.find((z) => z.id === 'seori');
    if (seori) seori.unlock = { zone: 'daeryeol' }; // seori ← daeryeol ← seori: cycle
    c.story.codex.push({ id: 'codex_bad_zone', title: { tr: 'x', en: 'x' }, text: { tr: 'x', en: 'x' }, unlock: 'clear:narnia' });
    const p = validateMetaContent(c);
    expect(p.some((x) => x.includes('source.zone atlantis is unknown'))).toBe(true);
    expect(p.some((x) => x.includes('source.chance must be in (0,1]'))).toBe(true);
    expect(p.some((x) => x.includes('does not appear in zone seori'))).toBe(true);
    expect(p.some((x) => x.includes('unlock chain has a cycle'))).toBe(true);
    expect(p.some((x) => x.includes('codex_bad_zone: unknown zone narnia'))).toBe(true);
  });

  it('catches codex unlock strings outside the grammar or pointing at nothing (hard:, boss:, level:)', () => {
    const c = cleaned();
    const add = (id: string, unlock: string): number => c.story.codex.push({ id, title: { tr: 'x', en: 'x' }, text: { tr: 'x', en: 'x' }, unlock });
    add('codex_bad_hard', 'hard:narnia');
    add('codex_bad_boss', 'boss:nobody');
    add('codex_bad_level', 'level:abc');
    add('codex_bad_class', 'class:paladin');
    add('codex_bad_kind', 'defeat:wolf');
    add('codex_ok_long_tail', 'kills:25000');
    const p = validateMetaContent(c);
    expect(p).toContain('codex codex_bad_hard: unknown zone narnia');
    expect(p).toContain('codex codex_bad_boss: unknown boss nobody');
    for (const id of ['codex_bad_level', 'codex_bad_class', 'codex_bad_kind']) expect(p.some((x) => x.includes(`codex ${id}: unlock`) && x.includes('not in the meta grammar')), id).toBe(true);
    expect(p.some((x) => x.includes('codex_ok_long_tail'))).toBe(false);
  });

  it('catches a class that can never fill a slot', () => {
    const c = cleaned();
    c.gear = c.gear.filter((g) => !(g.slot === 'shoes'));
    expect(validateMetaContent(c)).toContain('class warrior: no gear can ever drop for slot shoes');
  });

  it('accepts the optional roguelite fields (absent = off = today; present and valid = fine)', () => {
    const c = cleaned();
    expect(validateMetaContent(c)).toEqual([]);
    const z = c.zones[0];
    const e = c.empires[0];
    if (!z || !e) throw new Error('fixture');
    z.xpMul = 1.25;
    z.final.hpMul = 0.8;
    z.hard = { awakenMul: 0.5, eliteEveryMul: 0.75, finalEnrageMul: 0.9 };
    e.edict = { rerolls: 0, banishes: 2, skips: 1 };
    c.balance.hard = { ...c.balance.hard, awakenMul: 0.67, eliteEveryMul: 0.75, finalEnrageMul: 0.8 };
    c.balance.overflow = { shards: true, boon: true, shardsByRarity: [2, 3, 4, 5, 6], skipRefund: 1 };
    c.balance.chest = { eliteDrop: 0.06, cards: 4 };
    expect(validateMetaContent(c)).toEqual([]);
  });

  it('catches malformed roguelite fields the meta layer would bank or multiply', () => {
    const c = cleaned();
    const z = c.zones[0];
    const e = c.empires[1];
    if (!z || !e) throw new Error('fixture');
    z.xpMul = 0;
    z.final.hpMul = Number.NaN;
    z.hard = { finalEnrageMul: -1 };
    e.edict = { skips: 3, rerolls: 0.5 };
    c.balance.hard = { ...c.balance.hard, awakenMul: 0 };
    c.balance.overflow = { shardsByRarity: [2, 3, 4, -5, 6], skipRefund: 99 };
    c.balance.chest = { eliteDrop: 1.5 };
    const p = validateMetaContent(c);
    expect(p).toContain(`zone ${z.id}: xpMul must be a finite number > 0`);
    expect(p).toContain(`zone ${z.id}: final.hpMul must be a finite number > 0`);
    expect(p).toContain(`zone ${z.id}: hard.finalEnrageMul must be a finite number > 0`);
    expect(p).toContain(`empire ${e.id}: edict.skips must be an integer 0..2`);
    expect(p).toContain(`empire ${e.id}: edict.rerolls must be an integer 0..2`);
    expect(p).toContain('balance.hard.awakenMul must be a finite number > 0');
    expect(p).toContain('balance.overflow.shardsByRarity must be 5 integers 0..99 (one per rarity)');
    expect(p).toContain('balance.overflow.skipRefund must be an integer 0..20');
    expect(p).toContain('balance.chest.eliteDrop must be in [0, 1]');
    c.balance.overflow = { shardsByRarity: [2, 3, 4] };
    expect(validateMetaContent(c)).toContain('balance.overflow.shardsByRarity must be 5 integers 0..99 (one per rarity)');
  });
});

describe('dropTableFor', () => {
  it('lists zone → boss encounters → zone-level pieces with chances and ownership', () => {
    const s = freshSave();
    s.classes.warrior.collection.push('yeonmu_weapon_warrior');
    const t = dropTableFor(s, fixtureContent, 'warrior');
    const yeonmu = t.filter((x) => x.zone === 'yeonmu');
    expect(yeonmu.map((x) => `${x.kind}:${x.key}`)).toEqual(['boss:yeonmu_boss1', 'boss:yeonmu_boss2', 'boss:yeonmu_final', 'zone:yeonmu']);
    expect(yeonmu[0]?.entries.map((e) => [e.def.id, e.owned, e.chance])).toEqual([
      ['yeonmu_armor_warrior', false, 0.3],
      ['yeonmu_weapon_warrior', true, 0.3],
    ]);
    expect(t.map((x) => x.zone)).toEqual([...t.map((x) => x.zone)].sort((a, b) => ['yeonmu', 'suryeon', 'seori', 'daeryeol'].indexOf(a) - ['yeonmu', 'suryeon', 'seori', 'daeryeol'].indexOf(b)));
    expect(dropTableFor(s, fixtureContent, 'ninja')[0]?.entries.map((e) => e.def.id)).toEqual(['yeonmu_armor_ninja', 'yeonmu_weapon_ninja']);
  });

  it('hard mode shows the boosted (capped) chance', () => {
    const t = dropTableFor(freshSave(), fixtureContent, 'warrior', 'hard');
    expect(t[0]?.entries[0]?.chance).toBeCloseTo(0.45);
    const final = t.find((x) => x.key === 'yeonmu_final');
    expect(final?.entries[0]?.chance).toBe(0.75);
  });
});

describe('the shipped codex (MT-04)', () => {
  it('has no meta-level problems', () => {
    expect(validateMetaContent(realContent)).toEqual([]);
  });

  it('every unlock string parses and refers to a zone, boss, metin or class that exists', () => {
    const zones = new Set(realContent.zones.map((z) => z.id));
    const bosses = new Set(realContent.bosses.map((b) => b.id));
    const metins = new Set(realContent.metins.map((m) => m.id));
    const seen = new Set<string>();
    for (const e of realContent.story.codex) {
      expect(seen.has(e.id), `duplicate ${e.id}`).toBe(false);
      seen.add(e.id);
      const c = parseCodexCondition(e.unlock);
      expect(c.kind, `${e.id}: '${e.unlock}'`).not.toBe('unknown');
      if (c.kind === 'enter' || c.kind === 'clear') expect(zones.has(c.zone), `${e.id}: zone ${c.zone}`).toBe(true);
      if (c.kind === 'boss') expect(bosses.has(c.boss), `${e.id}: boss ${c.boss}`).toBe(true);
      if (c.kind === 'metin') expect(metins.has(c.metin), `${e.id}: metin ${c.metin}`).toBe(true);
      if (c.kind === 'class') expect(CLASS_IDS.includes(c.classId), `${e.id}: class`).toBe(true);
      if (c.kind === 'level' || c.kind === 'wins' || c.kind === 'runs' || c.kind === 'kills') {
        expect(Number.isInteger(c.n) && c.n > 0, `${e.id}: threshold ${c.n}`).toBe(true);
      }
    }
  });
});

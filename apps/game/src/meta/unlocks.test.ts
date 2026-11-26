import { describe, expect, it } from 'vitest';
import { content as realContent } from '../data/loader';
import { fixtureContent } from './__fixtures__/content';
import { freshSave } from './__fixtures__/testkit';
import { seededRng } from './rng';
import { emptyZoneStats, newProfile, normalizeSave } from './save';
import {
  canStartRun,
  codexConditionMet,
  codexEntries,
  isHardUnlocked,
  isZoneUnlocked,
  newCodexUnlocks,
  parseCodexCondition,
  recomputeUnlocks,
  zoneRequirement,
  zoneStatuses,
} from './unlocks';
import type { MetaContent, SaveData } from './types';

const C = fixtureContent;

function cleared(s: SaveData, zone: string, difficulty: 'normal' | 'hard' = 'normal'): SaveData {
  const z = (s.stats.zones[zone] ??= {});
  z[difficulty] = { ...emptyZoneStats(), runs: 1, clears: 1 };
  return s;
}

describe('zone chain + hard mode', () => {
  it('new profile: only the first zone, no hard', () => {
    const s = freshSave();
    expect(s.unlocks.zones).toEqual(['yeonmu']);
    expect(s.unlocks.hard).toEqual([]);
    expect(canStartRun(s, C, 'yeonmu', 'normal')).toEqual({ ok: true });
    expect(canStartRun(s, C, 'yeonmu', 'hard')).toEqual({ ok: false, reason: 'hardLocked' });
    expect(canStartRun(s, C, 'suryeon', 'normal')).toEqual({ ok: false, reason: 'zoneLocked' });
    expect(canStartRun(s, C, 'atlantis', 'normal')).toEqual({ ok: false, reason: 'unknownZone' });
  });

  it('beating zone N on normal opens zone N+1 and hard N', () => {
    const s = cleared(freshSave(), 'yeonmu');
    expect(isZoneUnlocked(s, C, 'suryeon')).toBe(true);
    expect(isZoneUnlocked(s, C, 'seori')).toBe(false);
    expect(isHardUnlocked(s, 'yeonmu')).toBe(true);
    expect(isHardUnlocked(s, 'suryeon')).toBe(false);
    expect(canStartRun(s, C, 'yeonmu', 'hard')).toEqual({ ok: true });
    const u = recomputeUnlocks(s, C);
    expect(u.zones).toEqual(['yeonmu', 'suryeon']);
    expect(u.hard).toEqual(['yeonmu']);
  });

  it('a hard clear alone does not skip the chain', () => {
    const s = cleared(freshSave(), 'yeonmu', 'hard');
    expect(isZoneUnlocked(s, C, 'suryeon')).toBe(false);
  });

  it('honours an explicit unlock requirement (incl. hard-clear gates)', () => {
    const content: MetaContent = structuredClone(C);
    const seori = content.zones.find((z) => z.id === 'seori');
    if (!seori) throw new Error('fixture');
    seori.unlock = { zone: 'suryeon', difficulty: 'hard' };
    expect(zoneRequirement(content, 'seori')).toEqual({ zone: 'suryeon', difficulty: 'hard' });
    const s = cleared(cleared(freshSave(), 'yeonmu'), 'suryeon');
    expect(isZoneUnlocked(s, content, 'seori')).toBe(false);
    cleared(s, 'suryeon', 'hard');
    expect(isZoneUnlocked(s, content, 'seori')).toBe(true);
  });

  it('without an unlock field the previous zone by order gates it', () => {
    const content: MetaContent = structuredClone(C);
    for (const z of content.zones) delete z.unlock;
    content.zones.reverse(); // array order must not matter, `order` does
    expect(zoneRequirement(content, 'yeonmu')).toBeNull();
    expect(zoneRequirement(content, 'seori')).toEqual({ zone: 'suryeon', difficulty: 'normal' });
  });

  it('zoneStatuses lists the chain in order', () => {
    const st = zoneStatuses(cleared(freshSave(), 'yeonmu'), C);
    expect(st.map((z) => [z.zone.id, z.unlocked, z.hardUnlocked, z.cleared.normal])).toEqual([
      ['yeonmu', true, true, true],
      ['suryeon', true, false, false],
      ['seori', false, false, false],
      ['daeryeol', false, false, false],
    ]);
  });

  it('recompute heals lost flags and a newly added zone, keeps unknown ids', () => {
    const s = cleared(cleared(freshSave(), 'yeonmu'), 'suryeon');
    s.unlocks = { zones: ['legacy_zone'], hard: [], codex: [] };
    const u = recomputeUnlocks(s, C);
    expect(u.zones).toEqual(['yeonmu', 'suryeon', 'seori', 'legacy_zone']);
    expect(u.hard).toEqual(['yeonmu', 'suryeon']);
  });

  it('normalizeSave re-derives unlocks from stats', () => {
    const s = cleared(freshSave(), 'yeonmu');
    s.unlocks = { zones: [], hard: [], codex: [] };
    const n = normalizeSave(JSON.parse(JSON.stringify(s)), C);
    expect(n.unlocks.zones).toEqual(['yeonmu', 'suryeon']);
    expect(n.unlocks.hard).toEqual(['yeonmu']);
  });
});

describe('codex', () => {
  it('parses the unlock grammar', () => {
    expect(parseCodexCondition('')).toEqual({ kind: 'always' });
    expect(parseCodexCondition('always')).toEqual({ kind: 'always' });
    expect(parseCodexCondition('enter:yeonmu')).toEqual({ kind: 'enter', zone: 'yeonmu' });
    expect(parseCodexCondition('zone:yeonmu')).toEqual({ kind: 'enter', zone: 'yeonmu' });
    expect(parseCodexCondition('clear:seori')).toEqual({ kind: 'clear', zone: 'seori', difficulty: 'normal' });
    expect(parseCodexCondition('hard:seori')).toEqual({ kind: 'clear', zone: 'seori', difficulty: 'hard' });
    expect(parseCodexCondition('boss:horyeong')).toEqual({ kind: 'boss', boss: 'horyeong' });
    expect(parseCodexCondition('metin:sorrow')).toEqual({ kind: 'metin', metin: 'sorrow' });
    expect(parseCodexCondition('class:wolfman')).toEqual({ kind: 'class', classId: 'wolfman' });
    expect(parseCodexCondition('class:paladin')).toMatchObject({ kind: 'unknown' });
    expect(parseCodexCondition('wins:3')).toEqual({ kind: 'wins', n: 3 });
    expect(parseCodexCondition('level:abc')).toMatchObject({ kind: 'unknown' });
    expect(parseCodexCondition('frobnicate:7')).toMatchObject({ kind: 'unknown' });
    expect(parseCodexCondition('nonsense')).toMatchObject({ kind: 'unknown' });
  });

  it('a new profile has only the always-unlocked entry', () => {
    expect(freshSave().unlocks.codex).toEqual(['codex_start']);
  });

  it('unlocks entries as the stats cross each condition, never the unknown kind', () => {
    const s = freshSave();
    expect(newCodexUnlocks(s, C)).toEqual([]);
    s.stats.zones.yeonmu = { normal: { ...emptyZoneStats(), runs: 1, clears: 1 } };
    s.stats.bossKills.yeonmu_boss1 = 1;
    s.stats.metinKinds.yeonmu_metin = 4;
    s.stats.classes.ninja.runs = 1;
    s.stats.wins = 3;
    expect(newCodexUnlocks(s, C).sort()).toEqual(
      ['codex_boss', 'codex_class_ninja', 'codex_clear_yeonmu', 'codex_enter_yeonmu', 'codex_metin', 'codex_wins3'].sort(),
    );
    s.stats.zones.yeonmu = { ...s.stats.zones.yeonmu, hard: { ...emptyZoneStats(), runs: 1, clears: 1 } };
    expect(newCodexUnlocks(s, C)).toContain('codex_hard_yeonmu');
    expect(newCodexUnlocks(s, C)).not.toContain('codex_garbage');
    expect(codexConditionMet(s, { kind: 'unknown', raw: 'x' })).toBe(false);
  });
});

describe('codex view', () => {
  it('lists every entry in content order with live unlock state', () => {
    const s = freshSave();
    const v = codexEntries(s, C);
    expect(v.map((e) => e.entry.id)).toEqual(C.story.codex.map((e) => e.id));
    expect(v.filter((e) => e.unlocked).map((e) => e.entry.id)).toEqual(['codex_start']);
    s.stats.bossKills.yeonmu_boss1 = 2;
    const after = codexEntries(s, C);
    expect(after.find((e) => e.entry.id === 'codex_boss')).toMatchObject({ unlocked: true, condition: { kind: 'boss', boss: 'yeonmu_boss1' } });
    expect(after.find((e) => e.entry.id === 'codex_garbage')?.unlocked).toBe(false);
  });
});

describe('the long-tail codex feats (MT-04)', () => {
  const feats = realContent.story.codex.filter((e) => e.id.startsWith('codex_lore_feat_'));
  const fresh = (): SaveData => newProfile(realContent, { now: 1_700_000_000_000, rng: seededRng(1), name: 'Real' });
  const unlockedBy = (mutate: (s: SaveData) => void): string[] => {
    const s = fresh();
    mutate(s);
    return newCodexUnlocks(s, realContent).filter((id) => id.startsWith('codex_lore_feat_'));
  };

  it('ships 13 feats in the Lore list (codex_lore_ ids, after the existing lore, before the bestiary), tr + en, unique', () => {
    expect(feats).toHaveLength(13);
    const ids = realContent.story.codex.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const last = (pred: (id: string) => boolean): number => ids.map(pred).lastIndexOf(true);
    const firstBestiary = ids.findIndex((id) => /^codex_(enemy|boss|metin)_/.test(id));
    expect(Math.min(...feats.map((f) => ids.indexOf(f.id)))).toBeGreaterThan(last((id) => id.startsWith('codex_lore_') && !id.startsWith('codex_lore_feat_')) - 1);
    expect(Math.max(...feats.map((f) => ids.indexOf(f.id)))).toBeLessThan(firstBestiary);
    for (const f of feats) {
      expect(f.title.tr.length, f.id).toBeGreaterThan(2);
      expect(f.title.en.length, f.id).toBeGreaterThan(2);
      expect(f.text.tr.length, f.id).toBeGreaterThan(80);
      expect(f.text.en.length, f.id).toBeGreaterThan(80);
      expect(f.text.tr.length, f.id).toBeLessThan(700);
    }
  });

  it('every feat uses the existing grammar and points at something that exists', () => {
    const zones = new Set(realContent.zones.map((z) => z.id));
    const metins = new Set(realContent.metins.map((m) => m.id));
    const kinds = feats.map((f) => parseCodexCondition(f.unlock));
    for (const [i, c] of kinds.entries()) {
      expect(c.kind, feats[i]?.unlock).not.toBe('unknown');
      if (c.kind === 'clear') expect(zones.has(c.zone), c.zone).toBe(true);
      if (c.kind === 'metin') expect(metins.has(c.metin), c.metin).toBe(true);
    }
    // one Hard clear per zone, plus milestones
    const hard = kinds.flatMap((c) => (c.kind === 'clear' && c.difficulty === 'hard' ? [c.zone] : []));
    expect(hard.sort()).toEqual([...zones].sort());
    expect(kinds.filter((c) => c.kind === 'kills' || c.kind === 'wins' || c.kind === 'level' || c.kind === 'runs')).toHaveLength(8);
  });

  it('none is unlocked by a new profile', () => {
    expect(unlockedBy(() => {})).toEqual([]);
  });

  it('unlock on their threshold and not one step before', () => {
    const table: [string, (s: SaveData, n: number) => void, number][] = [
      ['codex_lore_feat_wins_10', (s, n) => (s.stats.wins = n), 10],
      ['codex_lore_feat_wins_25', (s, n) => (s.stats.wins = n), 25],
      ['codex_lore_feat_kills_25k', (s, n) => (s.stats.kills = n), 25_000],
      ['codex_lore_feat_kills_100k', (s, n) => (s.stats.kills = n), 100_000],
      ['codex_lore_feat_kills_500k', (s, n) => (s.stats.kills = n), 500_000],
      ['codex_lore_feat_level_50', (s, n) => (s.stats.bestLevel = n), 50],
      ['codex_lore_feat_level_70', (s, n) => (s.stats.bestLevel = n), 70],
      ['codex_lore_feat_runs_50', (s, n) => (s.stats.runs = n), 50],
    ];
    for (const [id, set, n] of table) {
      expect(unlockedBy((s) => set(s, n - 1)), `${id} at ${n - 1}`).not.toContain(id);
      expect(unlockedBy((s) => set(s, n)), `${id} at ${n}`).toContain(id);
    }
    // the milestone ladders open in order
    expect(unlockedBy((s) => (s.stats.kills = 100_000))).toEqual(['codex_lore_feat_kills_25k', 'codex_lore_feat_kills_100k']);
  });

  it('a Hard clear opens that zone only, and a Normal clear opens none of them; the rare Metin opens its feat', () => {
    for (const z of realContent.zones) {
      const only = unlockedBy((s) => {
        s.stats.zones[z.id] = { hard: { ...emptyZoneStats(), runs: 1, clears: 1 } };
      });
      expect(only, z.id).toEqual([`codex_lore_feat_hard_${z.id}`]);
      expect(unlockedBy((s) => (s.stats.zones[z.id] = { normal: { ...emptyZoneStats(), runs: 1, clears: 1 } })), z.id).toEqual([]);
    }
    expect(unlockedBy((s) => (s.stats.metinKinds['metin_slaughter'] = 1))).toEqual(['codex_lore_feat_metin_slaughter']);
  });

  it('an old profile that already met them gets them silently on load (no payout without a settle), once', () => {
    const s = fresh();
    s.stats.kills = 120_000;
    s.stats.bestLevel = 71;
    const loaded = normalizeSave(JSON.parse(JSON.stringify(s)), realContent, { rng: seededRng(2) });
    expect(loaded.unlocks.codex).toEqual(expect.arrayContaining(['codex_lore_feat_kills_25k', 'codex_lore_feat_kills_100k', 'codex_lore_feat_level_50', 'codex_lore_feat_level_70']));
    expect(newCodexUnlocks(loaded, realContent)).toEqual([]);
    expect(loaded.bank).toEqual(s.bank);
  });
});

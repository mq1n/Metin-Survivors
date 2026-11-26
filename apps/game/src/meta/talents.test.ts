import { describe, expect, it } from 'vitest';
import { fixtureContent } from './__fixtures__/content';
import { NOW, freshSave, makeRun, richSave } from './__fixtures__/testkit';
import { summarizeSave } from './cloud';
import { exportMsav, importMsav } from './msav';
import { doctrineId, indexContent } from './content';
import { seededRng } from './rng';
import { emptyZoneStats, normalizeSave } from './save';
import { MetaService } from './service';
import { MemoryStore } from './storage';
import {
  CUMULATIVE_XP,
  MAX_TALENT_CAP,
  MAX_TALENT_POINTS,
  ROW_GATE,
  TALENT_CAP_PER_HARD_ZONE,
  allocateTalent,
  availablePoints,
  capNextZone,
  earnedPoints,
  milestonesReached,
  pointsForXp,
  refundTalent,
  respecTalents,
  sanitizeTreePoints,
  spentTotal,
  talentCap,
  talentCapView,
  talentPointCost,
  talentProgress,
  treePointsOf,
  treeView,
  treeViolation,
  xpForPoints,
} from './talents';
import type { SaveData } from './types';

const C = fixtureContent;

function withPoints(points: number): SaveData {
  const s = freshSave();
  s.classes.warrior.xp = xpForPoints(points);
  return s;
}

function alloc(s: SaveData, node: string, key: 'a' | 'b' = 'a'): SaveData {
  const r = allocateTalent(s, C, 'warrior', key, node);
  if (!r.ok) throw new Error(`alloc ${node} failed: ${r.reason}`);
  return r.save;
}

/** Greedy legal fill of one tree up to `n` points (row-rank, col order). */
function fill(s: SaveData, key: 'a' | 'b', n: number): SaveData {
  let cur = s;
  let spent = 0;
  const tree = indexContent(C).trees.get(doctrineId('warrior', key));
  if (!tree) throw new Error('no tree');
  let progressed = true;
  while (spent < n && progressed) {
    progressed = false;
    for (const rank of tree.byRank) {
      for (const node of rank) {
        if (spent >= n) break;
        const r = allocateTalent(cur, C, 'warrior', key, node.id);
        if (r.ok) {
          cur = r.save;
          spent++;
          progressed = true;
        }
      }
    }
  }
  return cur;
}

describe('talent point curve', () => {
  it('is monotonic, capped at 40 and round-trips through xp', () => {
    expect(MAX_TALENT_POINTS).toBe(40);
    for (let n = 1; n <= MAX_TALENT_POINTS; n++) {
      expect(talentPointCost(n)).toBeGreaterThan(talentPointCost(n - 1 || 1) - 1);
      expect(pointsForXp(xpForPoints(n))).toBe(n);
      expect(pointsForXp(xpForPoints(n) - 1)).toBe(n - 1);
    }
    expect(pointsForXp(-5)).toBe(0);
    expect(pointsForXp(Number.NaN)).toBe(0);
    expect(pointsForXp(1e12)).toBe(40);
    expect(xpForPoints(99)).toBe(CUMULATIVE_XP[40]);
  });

  it('first point arrives quickly, the full 40 takes a long haul', () => {
    expect(xpForPoints(1)).toBeLessThanOrEqual(300);
    expect(xpForPoints(40)).toBeGreaterThan(50_000);
    expect(xpForPoints(40)).toBeLessThan(90_000);
  });

  it('reports progress inside a point', () => {
    const mid = xpForPoints(3) + Math.floor(talentPointCost(4) / 2);
    const p = talentProgress(mid);
    expect(p.points).toBe(3);
    expect(p.next).toBe(xpForPoints(4));
    expect(p.fraction).toBeGreaterThan(0.45);
    expect(p.fraction).toBeLessThan(0.55);
    expect(talentProgress(1e12)).toMatchObject({ points: 40, next: null, fraction: 1 });
  });
});

describe('allocate / refund rules', () => {
  it('needs an available point', () => {
    const s = freshSave();
    expect(allocateTalent(s, C, 'warrior', 'a', 'r0c0')).toEqual({ ok: false, reason: 'noPoints' });
  });

  it('rejects unknown tree / node', () => {
    const s = withPoints(5);
    expect(allocateTalent(s, C, 'warrior', 'a', 'nope')).toEqual({ ok: false, reason: 'unknownNode' });
    const bad = { ...C, talents: [] };
    expect(allocateTalent(s, bad, 'warrior', 'a', 'r0c0')).toEqual({ ok: false, reason: 'unknownTree' });
  });

  it('enforces node max and does not mutate the input', () => {
    let s = withPoints(10);
    const before = structuredClone(s);
    for (let i = 0; i < 3; i++) s = alloc(s, 'r0c0');
    expect(allocateTalent(s, C, 'warrior', 'a', 'r0c0')).toEqual({ ok: false, reason: 'maxed' });
    expect(before.classes.warrior.talents).toEqual({});
    expect(treePointsOf(s.classes.warrior, 'warrior_a').r0c0).toBe(3);
  });

  it('a row unlocks after 5 points per row above it', () => {
    let s = withPoints(40);
    expect(allocateTalent(s, C, 'warrior', 'a', 'r1c0')).toMatchObject({ ok: false, reason: 'rowLocked' });
    for (let i = 0; i < 3; i++) s = alloc(s, 'r0c0');
    for (let i = 0; i < 1; i++) s = alloc(s, 'r0c2');
    expect(allocateTalent(s, C, 'warrior', 'a', 'r1c0')).toMatchObject({ ok: false, reason: 'rowLocked' }); // only 4 above
    s = alloc(s, 'r0c2');
    s = alloc(s, 'r1c0'); // 5 above
    // row 2 needs 10 above
    expect(allocateTalent(s, C, 'warrior', 'a', 'r2c0')).toMatchObject({ ok: false, reason: 'rowLocked' });
    s = alloc(s, 'r1c0');
    s = alloc(s, 'r1c0');
    s = alloc(s, 'r1c2');
    s = alloc(s, 'r1c2'); // 5 + 5 = 10 above row 2
    s = alloc(s, 'r2c0');
    expect(treePointsOf(s.classes.warrior, 'warrior_a').r2c0).toBe(1);
  });

  it('honours `requires`', () => {
    let s = withPoints(40);
    for (let i = 0; i < 3; i++) s = alloc(s, 'r0c0');
    for (let i = 0; i < 2; i++) s = alloc(s, 'r0c2');
    expect(allocateTalent(s, C, 'warrior', 'a', 'r1c1')).toEqual({ ok: false, reason: 'requiresLocked', blocker: 'r0c1' });
    s = alloc(s, 'r0c1');
    expect(allocateTalent(s, C, 'warrior', 'a', 'r1c1').ok).toBe(true);
  });

  it('cannot spend more than earned, across both trees', () => {
    let s = withPoints(2);
    s = alloc(s, 'r0c0', 'a');
    s = alloc(s, 'r0c0', 'b');
    expect(availablePoints(s.classes.warrior)).toBe(0);
    expect(allocateTalent(s, C, 'warrior', 'b', 'r0c1')).toEqual({ ok: false, reason: 'noPoints' });
  });

  it('refund refuses to break the row gate or a prerequisite, allows leaf refunds', () => {
    let s = withPoints(40);
    for (let i = 0; i < 3; i++) s = alloc(s, 'r0c0');
    for (let i = 0; i < 2; i++) s = alloc(s, 'r0c1');
    s = alloc(s, 'r1c1'); // requires r0c1, row gate 5 satisfied
    // r0 would drop to 4 points above row 1 → violation
    expect(refundTalent(s, C, 'warrior', 'a', 'r0c0')).toMatchObject({ ok: false, reason: 'dependency', blocker: 'r1c1' });
    expect(refundTalent(s, C, 'warrior', 'a', 'r0c1')).toMatchObject({ ok: false, reason: 'dependency' });
    expect(refundTalent(s, C, 'warrior', 'a', 'r1c0')).toEqual({ ok: false, reason: 'nothingToRefund' });
    const r = refundTalent(s, C, 'warrior', 'a', 'r1c1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(treePointsOf(r.save.classes.warrior, 'warrior_a').r1c1).toBeUndefined();
      expect(spentTotal(r.save.classes.warrior)).toBe(5);
      // the freed point is available again
      expect(availablePoints(r.save.classes.warrior)).toBe(35);
    }
  });

  it('respec is free and per tree or per class', () => {
    let s = withPoints(10);
    s = alloc(s, 'r0c0', 'a');
    s = alloc(s, 'r0c1', 'b');
    const a = respecTalents(s, 'warrior', 'a');
    expect(spentTotal(a.classes.warrior)).toBe(1);
    expect(respecTalents(s, 'warrior').classes.warrior.talents).toEqual({});
    expect(availablePoints(respecTalents(s, 'warrior').classes.warrior)).toBe(10);
    // untouched original
    expect(spentTotal(s.classes.warrior)).toBe(2);
  });

  it('every produced allocation is a legal tree', () => {
    const s = fill(withPoints(40), 'a', 40);
    const idx = indexContent(C).trees.get('warrior_a');
    expect(idx).toBeDefined();
    if (idx) expect(treeViolation(idx, treePointsOf(s.classes.warrior, 'warrior_a'))).toBeNull();
    expect(spentTotal(s.classes.warrior)).toBe(40);
  });
});

describe('milestones and view', () => {
  it('reports milestones at 10/20/30 points spent in the tree', () => {
    const tree = C.talents.find((t) => t.id === 'warrior_a');
    if (!tree) throw new Error('fixture');
    expect(milestonesReached(tree, 9)).toHaveLength(0);
    expect(milestonesReached(tree, 10).map((m) => m.at)).toEqual([10]);
    expect(milestonesReached(tree, 30).map((m) => m.at)).toEqual([10, 20, 30]);
  });

  it('tree view marks row locks, requires, affordability and refundability', () => {
    let s = withPoints(40);
    for (let i = 0; i < 3; i++) s = alloc(s, 'r0c0');
    for (let i = 0; i < 2; i++) s = alloc(s, 'r0c2');
    const v = treeView(C, s.classes.warrior, 'warrior', 'a');
    expect(v).not.toBeNull();
    if (!v) return;
    const node = (id: string) => v.nodes.find((n) => n.node.id === id);
    expect(node('r0c0')).toMatchObject({ state: 'maxed', canRefund: true, canAllocate: false });
    expect(node('r0c1')).toMatchObject({ state: 'available', canAllocate: true });
    expect(node('r1c0')).toMatchObject({ state: 'available' });
    expect(node('r1c1')).toMatchObject({ state: 'requiresLocked', canAllocate: false });
    expect(node('r2c0')).toMatchObject({ state: 'rowLocked' });
    expect(v.rows[1]).toMatchObject({ needed: ROW_GATE, have: 5, unlocked: true });
    expect(v.rows[2]).toMatchObject({ needed: 2 * ROW_GATE, have: 5, unlocked: false });
    expect(v.milestones.map((m) => m.reached)).toEqual([false, false, false]);
    const nopoints = treeView(C, freshSave().classes.warrior, 'warrior', 'a');
    expect(nopoints?.nodes.find((n) => n.node.id === 'r0c0')?.state).toBe('noPoints');
  });
});

describe('sanitizeTreePoints', () => {
  const idx = indexContent(C).trees.get('warrior_a');
  if (!idx) throw new Error('fixture');

  it('keeps a legal allocation intact', () => {
    const raw = { r0c0: 3, r0c1: 2, r1c0: 2 };
    const out = sanitizeTreePoints(idx, raw, 40);
    expect(out.points).toEqual(raw);
    expect(out.used).toBe(7);
  });

  it('drops locked rows, unknown nodes, over-max and garbage', () => {
    const raw = { r4c0: 3, r0c0: 99, ghost: 4, r0c1: 'x', r0c2: -2 };
    const out = sanitizeTreePoints(idx, raw, 40);
    expect(out.points).toEqual({ r0c0: 3 });
    expect(out.used).toBe(3);
  });

  it('respects the budget and resolves a later `requires`', () => {
    const out = sanitizeTreePoints(idx, { r0c0: 3, r0c1: 3, r0c2: 3, r1c1: 3 }, 4);
    expect(out.used).toBe(4);
    expect(Object.values(out.points).reduce((a, b) => a + b, 0)).toBe(4);
    const full = sanitizeTreePoints(idx, { r1c1: 3, r0c1: 1, r0c0: 3, r0c2: 1 }, 40);
    expect(full.points.r1c1).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// MT-02: every zone cleared on Hard raises the talent cap by 2 (40 -> 48); the cap derives from save.stats.zones

const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'] as const;

/** A copy of `s` whose stats say `zones` were cleared on Hard (and on Normal, which Hard needs). */
function hardCleared(s: SaveData, zones: readonly string[]): SaveData {
  const out = structuredClone(s);
  for (const z of zones) {
    const entry = (out.stats.zones[z] ??= {});
    entry.normal ??= { ...emptyZoneStats(), runs: 1, clears: 1 };
    entry.hard = { ...emptyZoneStats(), runs: 1, clears: 1 };
  }
  return out;
}

/** `hardCleared` + warrior XP worth `points` talent points (the 41st..48th need the extended curve). */
function capSave(zones: readonly string[], points: number): SaveData {
  const s = hardCleared(freshSave(), zones);
  s.classes.warrior.xp = CUMULATIVE_XP[points] as number;
  return s;
}

const roundTrip = (raw: unknown, repairs: string[] = []): SaveData => normalizeSave(JSON.parse(JSON.stringify(raw)), C, { now: NOW, rng: seededRng(1), repairs });

describe('talent cap (MT-02)', () => {
  it('is 40 with no hard clear, +2 per zone cleared on Hard, never above 48', () => {
    expect(MAX_TALENT_CAP).toBe(48);
    expect(TALENT_CAP_PER_HARD_ZONE).toBe(2);
    expect(talentCap(freshSave())).toBe(MAX_TALENT_POINTS);
    expect(ZONES.map((_, i) => talentCap(hardCleared(freshSave(), ZONES.slice(0, i + 1))))).toEqual([42, 44, 46, 48]);
    // a fifth zone (or a stray id in the stats) cannot lift it past the maximum
    expect(talentCap(hardCleared(freshSave(), [...ZONES, 'atlantis', 'valhalla']))).toBe(48);
  });

  it('counts a zone once, only for a Hard clear', () => {
    const s = freshSave();
    s.stats.zones = {
      yeonmu: { normal: { ...emptyZoneStats(), runs: 9, clears: 9 }, hard: { ...emptyZoneStats(), runs: 5, clears: 0 } }, // Hard tried, never cleared
      suryeon: { normal: { ...emptyZoneStats(), runs: 3, clears: 3 } }, // Normal only
      seori: { hard: { ...emptyZoneStats(), runs: 7, clears: 4 } }, // four Hard clears of ONE zone
    };
    expect(talentCap(s)).toBe(42);
    expect(talentCap({ stats: { ...s.stats, zones: {} } })).toBe(40);
  });

  it('extends the point curve to 48 with the same cost function', () => {
    expect(CUMULATIVE_XP).toHaveLength(MAX_TALENT_CAP + 1);
    for (let n = MAX_TALENT_POINTS + 1; n <= MAX_TALENT_CAP; n++) {
      expect(CUMULATIVE_XP[n]).toBe((CUMULATIVE_XP[n - 1] as number) + talentPointCost(n));
      expect(talentPointCost(n)).toBeGreaterThan(talentPointCost(n - 1));
    }
    // the first 40 are exactly as before
    expect(xpForPoints(40)).toBe(CUMULATIVE_XP[40]);
    expect(xpForPoints(99)).toBe(CUMULATIVE_XP[40]);
    expect(xpForPoints(99, 48)).toBe(CUMULATIVE_XP[48]);
    expect(xpForPoints(44, 48)).toBe(CUMULATIVE_XP[44]);
    expect(xpForPoints(44)).toBe(CUMULATIVE_XP[40]);
  });

  it('pointsForXp / talentProgress / earnedPoints / availablePoints take an optional cap (default 40 = today)', () => {
    const xp = CUMULATIVE_XP[46] as number;
    expect(pointsForXp(xp)).toBe(40);
    expect(pointsForXp(xp, 40)).toBe(40);
    expect(pointsForXp(xp, 44)).toBe(44);
    expect(pointsForXp(xp, 48)).toBe(46);
    expect(pointsForXp(1e12, 48)).toBe(48);
    expect(pointsForXp(1e12, 99)).toBe(48); // beyond the maximum
    expect(pointsForXp(1e12, Number.NaN)).toBe(40); // garbage falls back to the base cap
    expect(pointsForXp(-1, 48)).toBe(0);
    for (let n = 1; n <= MAX_TALENT_CAP; n++) {
      expect(pointsForXp(CUMULATIVE_XP[n] as number, 48)).toBe(n);
      expect(pointsForXp((CUMULATIVE_XP[n] as number) - 1, 48)).toBe(n - 1);
    }
    expect(talentProgress(1e12)).toMatchObject({ points: 40, next: null, fraction: 1 });
    expect(talentProgress(1e12, 44)).toMatchObject({ points: 44, next: null, fraction: 1 });
    const mid = talentProgress((CUMULATIVE_XP[41] as number) + 10, 44);
    expect(mid).toMatchObject({ points: 41, next: CUMULATIVE_XP[42], floor: CUMULATIVE_XP[41] });
    expect(mid.fraction).toBeGreaterThan(0);
    // at the default cap the same XP still reads "full"
    expect(talentProgress((CUMULATIVE_XP[41] as number) + 10)).toMatchObject({ points: 40, next: null });

    const cs = withPoints(0).classes.warrior;
    cs.xp = xp;
    expect(earnedPoints(cs)).toBe(40);
    expect(earnedPoints(cs, 44)).toBe(44);
    expect(availablePoints(cs)).toBe(40);
    expect(availablePoints(cs, 48)).toBe(46);
    cs.talents = { warrior_a: { r0c0: 3 } };
    expect(availablePoints(cs, 44)).toBe(41);
  });

  it('never takes a point away: a higher cap only adds', () => {
    for (const xp of [0, 1, 250, CUMULATIVE_XP[12] as number, CUMULATIVE_XP[39] as number, CUMULATIVE_XP[40] as number, (CUMULATIVE_XP[40] as number) + 1, 5e6]) {
      for (const cap of [40, 42, 44, 46, 48]) expect(pointsForXp(xp, cap)).toBeGreaterThanOrEqual(pointsForXp(xp));
    }
  });

  it('allocateTalent stops at the save-derived cap: 40 plain, 44 after two Hard clears, 48 after four', () => {
    const spendAll = (s: SaveData): SaveData => fill(fill(s, 'a', 45), 'b', 45);
    // no Hard clear: XP for 48 points still pays exactly 40 (as today)
    const plain = spendAll(capSave([], 48));
    expect(spentTotal(plain.classes.warrior)).toBe(40);
    expect(allocateTalent(plain, C, 'warrior', 'b', 'r0c1')).toEqual({ ok: false, reason: 'noPoints' });
    // two Hard clears
    const two = spendAll(capSave(['yeonmu', 'suryeon'], 48));
    expect(spentTotal(two.classes.warrior)).toBe(44);
    expect(availablePoints(two.classes.warrior, talentCap(two))).toBe(0);
    expect(allocateTalent(two, C, 'warrior', 'b', 'r0c1')).toEqual({ ok: false, reason: 'noPoints' });
    // all four
    const four = spendAll(capSave(ZONES, 48));
    expect(spentTotal(four.classes.warrior)).toBe(48);
    expect(allocateTalent(four, C, 'warrior', 'b', 'r0c1')).toEqual({ ok: false, reason: 'noPoints' });
  });

  it('a Hard clear that raises the cap releases the XP that had piled up above the old cap', () => {
    let s = capSave([], 46); // XP worth 46 points, cap 40
    s = fill(fill(s, 'a', 45), 'b', 45);
    expect(spentTotal(s.classes.warrior)).toBe(40);
    expect(allocateTalent(s, C, 'warrior', 'b', 'r0c1')).toMatchObject({ ok: false, reason: 'noPoints' });
    const after = hardCleared(s, ['yeonmu']); // cap 42
    expect(allocateTalent(after, C, 'warrior', 'b', 'r0c1').ok).toBe(true);
    // refunds and respec work the same at the higher cap
    const full = fill(fill(hardCleared(s, ['yeonmu', 'suryeon']), 'a', 45), 'b', 45);
    expect(spentTotal(full.classes.warrior)).toBe(44);
    expect(availablePoints(respecTalents(full, 'warrior').classes.warrior, talentCap(full))).toBe(44);
  });

  it('treeView prices availability against the cap it is given', () => {
    const s = fill(capSave(['yeonmu', 'suryeon'], 48), 'a', 40);
    const cs = s.classes.warrior;
    const free = (cap?: number): number | undefined => treeView(C, cs, 'warrior', 'a', cap)?.nodes.filter((n) => n.canAllocate).length;
    expect(free()).toBe(0); // default 40: nothing left to spend
    expect(free(40)).toBe(0);
    expect(free(talentCap(s))).toBeGreaterThan(0);
    expect(treeView(C, cs, 'warrior', 'b', 44)?.nodes.find((n) => n.node.id === 'r0c0')?.state).toBe('available');
    expect(treeView(C, cs, 'warrior', 'b')?.nodes.find((n) => n.node.id === 'r0c0')?.state).toBe('noPoints');
  });

  it('names the next zone to clear on Hard (first in order, none at the maximum)', () => {
    expect(capNextZone(freshSave(), C)).toBe('yeonmu');
    expect(capNextZone(hardCleared(freshSave(), ['yeonmu', 'suryeon']), C)).toBe('seori');
    // a zone whose Hard is already open wins over an earlier one that is still locked
    const gap = hardCleared(freshSave(), ['yeonmu']);
    gap.stats.zones.seori = { normal: { ...emptyZoneStats(), runs: 2, clears: 1 } };
    expect(capNextZone(gap, C)).toBe('seori');
    expect(capNextZone(hardCleared(freshSave(), ZONES.slice(0, 3)), C)).toBe('daeryeol');
    expect(capNextZone(hardCleared(freshSave(), ZONES), C)).toBeNull();
    expect(talentCapView(freshSave(), C)).toEqual({ cap: 40, base: 40, max: 48, perZone: 2, hardZones: 0, nextZone: 'yeonmu', zones: [] });
    expect(talentCapView(hardCleared(freshSave(), ['yeonmu', 'suryeon']), C)).toMatchObject({ cap: 44, hardZones: 2, nextZone: 'seori', zones: ['yeonmu', 'suryeon'] });
    expect(talentCapView(hardCleared(freshSave(), ZONES), C)).toMatchObject({ cap: 48, hardZones: 4, nextZone: null });
  });
});

describe('talent cap and the save (MT-02)', () => {
  /** 2 Hard clears, XP for 44 points, all 44 spent (24 in tree a, 20 in tree b). */
  function profile44(): SaveData {
    return fill(fill(capSave(['yeonmu', 'suryeon'], 44), 'a', 24), 'b', 20);
  }

  it('2 Hard clears + 44 spent points survive normalizeSave and summarizeSave unchanged', () => {
    const s = profile44();
    expect(spentTotal(s.classes.warrior)).toBe(44);
    const repairs: string[] = [];
    const once = roundTrip(s, repairs);
    expect(repairs).toEqual([]);
    expect(once.classes.warrior.talents).toEqual(s.classes.warrior.talents);
    expect(spentTotal(once.classes.warrior)).toBe(44);
    expect(summarizeSave(s).talentPoints).toBe(44);
    expect(summarizeSave(once)).toEqual({ ...summarizeSave(s), zonesUnlocked: once.unlocks.zones.length });
    // and again (a reload after a reload)
    expect(roundTrip(once)).toEqual(once);
  });

  it('the same profile without Hard clears is clamped to 40 exactly as today (tree a first)', () => {
    const raw = JSON.parse(JSON.stringify(profile44())) as SaveData;
    raw.stats.zones = {};
    const repairs: string[] = [];
    const back = roundTrip(raw, repairs);
    expect(spentTotal(back.classes.warrior)).toBe(40);
    expect(Object.values(treePointsOf(back.classes.warrior, 'warrior_a')).reduce((a, b) => a + b, 0)).toBe(24);
    expect(Object.values(treePointsOf(back.classes.warrior, 'warrior_b')).reduce((a, b) => a + b, 0)).toBe(16);
    expect(repairs).toEqual(['warrior: talents warrior_b clamped 20→16']);
    expect(summarizeSave(back).talentPoints).toBe(40);
  });

  it('derives the cap from the SANITISED stats (junk Hard clears do not count)', () => {
    const raw = JSON.parse(JSON.stringify(profile44())) as SaveData;
    const stats = raw.stats as unknown as { zones: Record<string, unknown> };
    stats.zones = { yeonmu: { hard: { clears: 'many' } }, suryeon: { hard: { clears: -3 } }, seori: { hard: null } };
    expect(spentTotal(roundTrip(raw).classes.warrior)).toBe(40);
    stats.zones = { yeonmu: { hard: { clears: 2.7 } }, suryeon: { hard: { clears: 1 } } };
    expect(spentTotal(roundTrip(raw).classes.warrior)).toBe(44);
  });

  it('keeps testkit saves and a plain pre-upgrade profile exactly as they were', () => {
    const old = capSave([], 40);
    for (const z of ZONES) old.stats.zones[z] = { normal: { ...emptyZoneStats(), runs: 4, clears: 2 } };
    old.classes.warrior.xp = 3_000_000; // piled-up XP of a long-time player
    const spent = fill(fill(old, 'a', 30), 'b', 10);
    expect(spentTotal(spent.classes.warrior)).toBe(40);
    for (const s of [freshSave(), richSave({ xp: xpForPoints(25), yeop: 500, shards: 9 }), richSave({ xp: 1e9 }), spent]) {
      const a = roundTrip(s);
      expect(roundTrip(a)).toEqual(a); // idempotent
      expect(a.classes).toEqual(s.classes); // nothing moved
      expect(earnedPoints(a.classes.warrior, talentCap(a))).toBe(Math.min(40, pointsForXp(s.classes.warrior.xp)));
    }
    // the piled-up XP of a player with no Hard clear is worth 40, not 48
    expect(summarizeSave(roundTrip(spent)).talentPoints).toBe(40);
  });
});

describe('talent cap through the service and the file formats (MT-02)', () => {
  const open = (store: MemoryStore): Promise<MetaService> => MetaService.open({ content: C, store, rng: seededRng(77), now: () => NOW, channel: null });

  it('Hard clears -> spending to 44 -> reload from the store and an .msav round trip keep every point', async () => {
    const store = new MemoryStore();
    const svc = await open(store);
    svc.save.classes.warrior.xp = CUMULATIVE_XP[48] as number; // a long-time player: XP for 48 points, cap 40
    for (const zone of ['yeonmu', 'suryeon']) {
      const out = svc.settle(makeRun({ zone, difficulty: 'hard', victory: true }), { submit: false });
      expect(out.summary.talentXp.cap).toBeGreaterThan(out.summary.talentXp.capBefore);
    }
    expect(talentCap(svc.save)).toBe(44);
    for (let n = 0; n < 60; n++) {
      const key = n % 2 === 0 ? 'a' : 'b';
      const node = treeView(C, svc.save.classes.warrior, 'warrior', key, talentCap(svc.save))?.nodes.find((x) => x.canAllocate);
      if (!node) continue;
      expect(svc.allocateTalent('warrior', key, node.node.id).ok).toBe(true);
    }
    expect(spentTotal(svc.save.classes.warrior)).toBe(44);
    // the cap holds: a node that is open and not maxed still refuses for want of points
    const stuck = (['a', 'b'] as const).flatMap((k) => (treeView(C, svc.save.classes.warrior, 'warrior', k, 44)?.nodes ?? []).filter((x) => x.state === 'noPoints').map((x) => [k, x.node.id] as const));
    const first = stuck[0];
    if (!first) throw new Error('every open node is maxed');
    expect(svc.allocateTalent('warrior', first[0], first[1])).toEqual({ ok: false, reason: 'noPoints' });
    await svc.flush();
    // reload: the store record goes through normalizeSave
    const again = await open(store);
    expect(spentTotal(again.save.classes.warrior)).toBe(44);
    expect(again.save.classes.warrior.talents).toEqual(svc.save.classes.warrior.talents);
    // export / import
    const back = importMsav(exportMsav(svc.save), C, { now: NOW, rng: seededRng(5) });
    expect(back.repairs).toEqual([]);
    expect(spentTotal(back.save.classes.warrior)).toBe(44);
    expect(summarizeSave(back.save).talentPoints).toBe(44);
  });
});

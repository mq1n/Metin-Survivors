// Gallery scenarios: run end modal + results screen (owner: B10 runend-results), plus run results whose settlement is
// fabricated (rich victory with drops + unlocks + records, defeat, abandoned, failed settle) by patching `meta.settle`
// for specific seeds, so the real `settleOnce` path runs with controllable outcomes (moved from the old dev/mockRun.ts).
import type { ContentDB } from '../../../data/schema';
import type { MetaService, SettleOutcome } from '../../../meta';
import { talentXpFor, type SettlementSummary } from '../../../meta/settle';
import { CUMULATIVE_XP, pointsForXp } from '../../../meta/talents';
import type { RunResult } from '../../../sim/run';
import { mockRequest, mockRunResult } from '../mock';
import { inRun, type Scenario } from '../scenarioKit';

export const order = 120;

export const SEED_RICH = 9001;
export const SEED_DEFEAT = 9002;
export const SEED_ABANDONED = 9003;
export const SEED_FAILED = 9004;

export function richRunResult(content: ContentDB): RunResult {
  const zone = content.zones[1] ?? content.zones[0];
  return mockRunResult(content, {
    seed: SEED_RICH,
    zone: zone?.id ?? 'yeonmu',
    time: 905,
    kills: 4210,
    elitesKilled: 33,
    level: 38,
    yeop: 31820,
    yeopLeft: 18420,
    shards: 11,
    metinsBroken: 7,
    chestsOpened: 6,
    bossesKilled: (zone?.bosses ?? []).slice(0, 3).map((b) => b.boss),
    damageTaken: 12840,
    runOptions: { density: 2, health: 1.5, damage: 1, speed: 1.25 },
    rewardMul: 1.65,
  });
}

/** A defeat is the whole party down (runTone): the lone hero has to be dead, or the report reads as an abandoned run. */
const fallen = (level: number, kills: number, yeop: number): RunResult['players'] => [{ index: 0, level, kills, yeop, alive: false }];

export function defeatRunResult(content: ContentDB): RunResult {
  return mockRunResult(content, { seed: SEED_DEFEAT, victory: false, time: 402, kills: 1480, level: 22, bossesKilled: [], metinsBroken: 3, chestsOpened: 2, damageDealt: 3_100_000, damageTaken: 9120, elitesKilled: 9, yeop: 9100, yeopLeft: 4200, shards: 4, players: fallen(22, 1480, 9100) });
}

/** Co-op defeat: two players, so the run-end offers "Back to lobby" instead of "Try again". */
export function coopRunResult(content: ContentDB): RunResult {
  const base = defeatRunResult(content);
  return {
    ...base,
    players: [
      { index: 0, level: 22, kills: 900, yeop: 4_600, alive: false },
      { index: 1, level: 20, kills: 580, yeop: 4_500, alive: false },
    ],
  };
}

export function abandonedRunResult(content: ContentDB): RunResult {
  return mockRunResult(content, { seed: SEED_ABANDONED, victory: false, time: 38, kills: 61, level: 3, bossesKilled: [], metinsBroken: 0, metinsAwakened: 0, chestsOpened: 0, damageDealt: 12_800, damageTaken: 120, elitesKilled: 0, yeop: 210, yeopLeft: 210, shards: 0, damageBySkill: mockRunResult(content).damageBySkill.slice(0, 1).map((m) => ({ ...m, damage: 12_800 })) });
}

export function failedRunResult(content: ContentDB): RunResult {
  return mockRunResult(content, { seed: SEED_FAILED, victory: false, time: 633, kills: 2400, players: fallen(30, 2400, 20000) });
}

function summaryFor(meta: MetaService, run: RunResult, kind: 'rich' | 'defeat' | 'abandoned'): SettlementSummary {
  const content = meta.content;
  const xp = talentXpFor(content, run);
  const before = (CUMULATIVE_XP[kind === 'rich' ? 9 : 14] ?? 0) + (kind === 'rich' ? 90 : 160);
  const after = before + xp.total;
  const pointsBefore = pointsForXp(before);
  const pointsAfter = pointsForXp(after);
  const gear = content.gear.filter((g) => g.classes.includes(run.classId));
  const zoneGear = gear.filter((g) => g.source.zone === run.zone);
  const pick = (i: number): string => (zoneGear[i] ?? gear[i] ?? gear[0])?.id ?? '';
  const ix = (i: number): string => zoneGear[i]?.source.boss ?? '';
  const drops: SettlementSummary['drops'] =
    kind === 'rich'
      ? [
          { gearId: pick(0), isNew: true, shards: 0, autoEquipped: true, guaranteed: false, source: { kind: 'boss', key: ix(0) } },
          { gearId: pick(2), isNew: true, shards: 0, autoEquipped: false, guaranteed: true, source: { kind: 'boss', key: ix(2) } },
          { gearId: pick(1), isNew: false, shards: 6, autoEquipped: false, guaranteed: false, source: { kind: 'boss', key: ix(1) } },
          { gearId: pick(3), isNew: true, shards: 0, autoEquipped: false, guaranteed: false, source: { kind: 'zone', key: run.zone } },
          { gearId: pick(5), isNew: false, shards: 4, autoEquipped: false, guaranteed: false, source: { kind: 'zone', key: run.zone } },
        ]
      : [];
  const shards = kind === 'abandoned' ? 0 : run.shards;
  const dup = drops.reduce((s, d) => s + d.shards, 0);
  return {
    runId: `mock-${run.seed}`,
    zone: run.zone,
    difficulty: run.difficulty,
    classId: run.classId,
    doctrine: run.doctrine,
    victory: run.victory,
    time: run.time,
    level: run.level,
    kills: run.kills,
    score: kind === 'rich' ? 482_310 : kind === 'defeat' ? 91_240 : 1_380,
    talentXp: { ...xp, before, after, pointsBefore, pointsAfter, pointsGained: pointsAfter - pointsBefore, available: Math.max(0, pointsAfter - 9), cap: 40, capBefore: 40, capNext: content.zones[0]?.id ?? null },
    bank: { yeop: Math.round(run.yeopLeft * (run.difficulty === 'hard' ? 1.5 : 1)), shards, duplicateShards: dup, yeopTotal: 107_450 + run.yeopLeft, shardsTotal: 70 + shards + dup },
    drops,
    pity: { before: 3, after: 0 },
    unlocks: kind === 'rich' ? { zones: [content.zones[2]?.id ?? 'seori'], hard: [content.zones[1]?.id ?? 'suryeon'], codex: ['a', 'b', 'c'] } : { zones: [], hard: [], codex: [] },
    records: kind === 'rich' ? { score: true, level: true, time: true } : { score: false, level: false, time: false },
  };
}

const patched = new WeakSet<MetaService>();

/** Patches `meta.settle` so the mock seeds return fabricated summaries (and a delayed leaderboard outcome). Idempotent. */
export function installMockSettle(meta: MetaService): void {
  if (patched.has(meta)) return;
  patched.add(meta);
  const orig = meta.settle.bind(meta);
  meta.settle = (run, opts) => {
    if (run.seed === SEED_FAILED) throw new Error('mock settle failure');
    const kind = run.seed === SEED_RICH ? 'rich' : run.seed === SEED_DEFEAT ? 'defeat' : run.seed === SEED_ABANDONED ? 'abandoned' : null;
    if (!kind) return orig(run, opts);
    const summary = summaryFor(meta, run, kind);
    const submit: SettleOutcome['submit'] = new Promise((resolve) => {
      window.setTimeout(() => {
        if (kind === 'rich') resolve({ kind: 'submitted', result: { id: 1, score: summary.score, status: 'ok', mode: 'solo', flags: [], duplicate: false, best: true, bestScore: summary.score, rank: 37, weekRank: 5, classRank: 12 } });
        else if (kind === 'defeat') resolve({ kind: 'queued' });
        else resolve({ kind: 'skipped', reason: 'disabled' });
      }, 1600);
    });
    return { summary, submit };
  };
}

export const scenarios: Scenario[] = [
  {
    id: 'runEnd',
    label: 'Run end · victory',
    run: (g) => {
      inRun(g, { t: 918 });
      g.store.setSimModal(mockRequest('runEnd', g.content, { result: mockRunResult(g.content) }));
    },
  },
  {
    id: 'runEnd-defeat',
    label: 'Run end · defeat',
    run: (g) => {
      inRun(g, { t: 402 });
      g.store.setSimModal(mockRequest('runEnd', g.content, { result: mockRunResult(g.content, { victory: false, time: 402, kills: 1480, level: 22, bossesKilled: [], metinsBroken: 3, damageDealt: 3_100_000, players: fallen(22, 1480, 9100) }) }));
    },
  },
  {
    id: 'results',
    label: 'Results screen',
    run: (g) => {
      g.store.setResult(mockRunResult(g.content));
      g.store.setScreen('results');
    },
  },
  {
    id: 'runEnd-rich',
    label: 'Run end · drops, unlocks, records',
    run: (g) => {
      installMockSettle(g.meta);
      inRun(g, { t: 905 });
      g.store.setSimModal(mockRequest('runEnd', g.content, { result: richRunResult(g.content) }));
    },
  },
  {
    id: 'runEnd-defeat2',
    label: 'Run end · defeat (fabricated)',
    run: (g) => {
      installMockSettle(g.meta);
      inRun(g, { t: 402 });
      g.store.setSimModal(mockRequest('runEnd', g.content, { result: defeatRunResult(g.content) }));
    },
  },
  {
    id: 'runEnd-abandoned',
    label: 'Run end · abandoned',
    run: (g) => {
      installMockSettle(g.meta);
      inRun(g, { t: 38 });
      g.store.setSimModal(mockRequest('runEnd', g.content, { result: abandonedRunResult(g.content) }));
    },
  },
  {
    id: 'runEnd-failed',
    label: 'Run end · settle failed',
    run: (g) => {
      installMockSettle(g.meta);
      inRun(g, { t: 633 });
      g.store.setSimModal(mockRequest('runEnd', g.content, { result: failedRunResult(g.content) }));
    },
  },
  {
    id: 'runEnd-coop',
    label: 'Run end · co-op defeat',
    run: (g) => {
      installMockSettle(g.meta);
      inRun(g, { t: 402 });
      g.store.setSimModal(mockRequest('runEnd', g.content, { result: coopRunResult(g.content) }));
    },
  },
  {
    id: 'results-rich',
    label: 'Results · rich',
    run: (g) => {
      installMockSettle(g.meta);
      g.store.setResult(richRunResult(g.content));
      g.store.setScreen('results');
    },
  },
];

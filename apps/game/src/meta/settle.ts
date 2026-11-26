// Run settlement: applies a finished run (sim/run.ts RunResult) to the save — talent XP, banked Yeop + Metin
// shards, gear drops, stats/records, unlocks (zone chain, hard mode, codex; a newly unlocked feat pays shards once) —
// and returns the summary the results screen renders. Pure: (save, run) → { save', summary }.

import { computeScore, type RunStats } from '@ms/shared/api';
import type { ClassId, Difficulty, DoctrineKey } from '../data/schema';
import type { RunResult } from '../sim/run';
import { computeMetaBonuses } from './bonuses';
import { indexContent } from './content';
import { type DropEvent, rollGearDrops } from './drops';
import { MAX_CURRENCY, emptyZoneStats } from './save';
import { randomId, systemRng } from './rng';
import { capNextZone, pointsForXp, spentTotal, talentCap } from './talents';
import type { MetaContent, MetaRng, SaveData } from './types';
import { newCodexUnlocks, parseCodexCondition, recomputeUnlocks } from './unlocks';

/** Talent XP bonus per zone step: zone index i (by order) multiplies XP by 1 + ZONE_XP_STEP × i. */
export const ZONE_XP_STEP = 0.3;
/** Run clock beyond this many seconds past the run length is ignored for talent XP (enraged-final overtime cap). */
const OVERTIME_CAP = 300;
const MAX_XP = 1_000_000_000;

/** Shards a codex feat pays the first time it unlocks (MT-04): a zone / hard clear or a boss kill is "big". */
export const CODEX_SHARDS_BIG = 10;
/** ... any other effort-gated feat (metin broken, class played, level / wins / runs / kills milestones). */
export const CODEX_SHARDS_BASE = 5;
/**
 * Bestiary pages (codex_enemy_ / codex_boss_ / codex_metin_) open by seeing or killing the thing, 114 of them on the first
 * run in a zone: they are discovery, not feats, and pay nothing (at 5 each they would be ~37 % of a campaign's shards,
 * against the 15 % budget of T10).
 */
const BESTIARY_PAGE = /^codex_(?:enemy|boss|metin)_/;

/**
 * Shards one codex entry pays when it unlocks: 0 for the free reveals (always / enter / zone, bestiary pages, unknown
 * strings), 10 for clear: / hard: / boss:, 5 for metin: / class: / level: / wins: / runs: / kills:.
 */
export function codexPayout(entry: { readonly id: string; readonly unlock: string }): number {
  if (BESTIARY_PAGE.test(entry.id)) return 0;
  switch (parseCodexCondition(entry.unlock).kind) {
    case 'clear':
    case 'boss':
      return CODEX_SHARDS_BIG;
    case 'metin':
    case 'class':
    case 'level':
    case 'wins':
    case 'runs':
    case 'kills':
      return CODEX_SHARDS_BASE;
    default:
      return 0;
  }
}

/** One codex feat that paid shards in this settlement. */
export interface CodexPaid {
  id: string;
  shards: number;
}

export interface TalentXpBreakdown {
  time: number;
  kills: number;
  elites: number;
  bosses: number;
  metins: number;
  victory: number;
  subtotal: number;
  zoneMult: number;
  /** reward multiplier (hard mode × Run Options, RunResult.rewardMul); name kept for the results screen */
  difficultyMult: number;
  total: number;
}

export function zoneXpMultiplier(content: MetaContent, zoneId: string): number {
  const i = indexContent(content).zonesOrdered.findIndex((z) => z.id === zoneId);
  return 1 + ZONE_XP_STEP * Math.max(0, i);
}

const nonNeg = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

/** Run Options can raise the reward at most ×2 on top of the hard-mode reward (data/loader.ts: runOptions.rewardMax ≤ 2). */
const MAX_OPTIONS_REWARD = 2;

/**
 * Reward multiplier applied to banked Yeop, shards and talent XP: `RunResult.rewardMul` (hard-mode reward × Run
 * Options reward, set by the sim). Clamped to what the content can legitimately produce (co-op guests receive the
 * result from the host over the network); a missing/garbage value falls back to the hard-mode reward alone.
 */
export function rewardMultiplier(content: MetaContent, run: RunResult): number {
  const hard = run.difficulty === 'hard' ? content.balance.hard.reward : 1;
  const m = run.rewardMul;
  if (!Number.isFinite(m) || m <= 0) return hard;
  return Math.min(m, hard * MAX_OPTIONS_REWARD);
}

/** Talent XP from BalanceConfig.talentXp × zone × reward multiplier (PLAN §3.8). */
export function talentXpFor(content: MetaContent, run: RunResult): TalentXpBreakdown {
  const t = content.balance.talentXp;
  const seconds = Math.min(nonNeg(run.time), content.balance.runLength + OVERTIME_CAP);
  const time = (t.perMinute * seconds) / 60;
  const kills = t.perKill * nonNeg(run.kills);
  const elites = t.perElite * nonNeg(run.elitesKilled);
  const bosses = t.perBoss * run.bossesKilled.length;
  const metins = t.perMetin * nonNeg(run.metinsBroken);
  const victory = run.victory ? t.victory : 0;
  const subtotal = time + kills + elites + bosses + metins + victory;
  const zoneMult = zoneXpMultiplier(content, run.zone);
  const difficultyMult = rewardMultiplier(content, run);
  return { time, kills, elites, bosses, metins, victory, subtotal, zoneMult, difficultyMult, total: Math.round(subtotal * zoneMult * difficultyMult) };
}

/** The leaderboard/score stats of a run (same shape the API validates; score weights live in @ms/shared). */
export function runStatsOf(run: RunResult): RunStats {
  return {
    kills: Math.floor(nonNeg(run.kills)),
    elites: Math.floor(nonNeg(run.elitesKilled)),
    bosses: run.bossesKilled.length,
    metins: Math.floor(nonNeg(run.metinsBroken)),
    level: Math.max(1, Math.floor(nonNeg(run.level))),
    yeop: Math.floor(nonNeg(run.yeop)),
  };
}

export function scoreOf(run: RunResult): number {
  return computeScore(runStatsOf(run), { victory: run.victory, duration: nonNeg(run.time), difficulty: run.difficulty });
}

export interface SettlementSummary {
  runId: string;
  zone: string;
  difficulty: Difficulty;
  classId: ClassId;
  doctrine: DoctrineKey;
  victory: boolean;
  time: number;
  level: number;
  kills: number;
  score: number;
  talentXp: TalentXpBreakdown & {
    /** class XP before / after */
    before: number;
    after: number;
    pointsBefore: number;
    pointsAfter: number;
    pointsGained: number;
    /** unspent points after settlement */
    available: number;
    /** the class's talent cap after this run (40, +2 per zone cleared on Hard, at most 48; MT-02) */
    cap: number;
    /** the cap before this run: `cap > capBefore` when this run was a first Hard clear */
    capBefore: number;
    /** zone id whose Hard clear raises the cap next (null at 48 or with nothing left to clear) */
    capNext: string | null;
  };
  bank: {
    yeop: number;
    /** shards from the run (hard reward applied), excluding duplicate conversions */
    shards: number;
    /** shards from duplicate gear conversions */
    duplicateShards: number;
    yeopTotal: number;
    shardsTotal: number;
  };
  drops: DropEvent[];
  pity: { before: number; after: number };
  /** newly unlocked this run */
  unlocks: { zones: string[]; hard: string[]; codex: string[] };
  /**
   * Codex feats unlocked by this run that paid shards (MT-04, content order): paid once per entry, on top of
   * `bank.shards` (banked into `bank.shardsTotal`, not multiplied by hard mode / Run Options). Always set by settleRun;
   * optional so hand-built summaries (dev scenarios) keep compiling.
   */
  codexPaid?: CodexPaid[];
  records: { score: boolean; level: boolean; time: boolean };
}

export interface SettleResult {
  save: SaveData;
  summary: SettlementSummary;
}

const newOnly = (before: readonly string[], after: readonly string[]): string[] => after.filter((x) => !before.includes(x));

export function settleRun(save: SaveData, content: MetaContent, run: RunResult, rng: MetaRng = systemRng, now: number = Date.now()): SettleResult {
  const reward = rewardMultiplier(content, run);
  const stats = runStatsOf(run);
  const score = scoreOf(run);
  const xp = talentXpFor(content, run);
  const yeop = Math.round(nonNeg(run.yeopLeft) * reward);
  const shards = Math.round(nonNeg(run.shards) * reward);
  const time = nonNeg(run.time);

  // 1. class XP + currencies + stats on a working copy
  let cur = structuredClone(save);
  const cls = cur.classes[run.classId];
  const xpBefore = cls.xp;
  const capBefore = talentCap(save);
  const pointsBefore = pointsForXp(xpBefore, capBefore);
  cls.xp = Math.min(MAX_XP, xpBefore + xp.total);
  cur.bank.yeop = Math.min(MAX_CURRENCY, cur.bank.yeop + yeop);
  cur.bank.shards = Math.min(MAX_CURRENCY, cur.bank.shards + shards);

  const st = cur.stats;
  const zoneEntry = (st.zones[run.zone] ??= {});
  const zs = (zoneEntry[run.difficulty] ??= emptyZoneStats());
  const records = {
    score: score > st.bestScore,
    level: stats.level > st.bestLevel,
    time: run.victory && (zs.bestTime === 0 || time < zs.bestTime),
  };
  st.runs += 1;
  if (run.victory) st.wins += 1;
  else st.deaths += 1;
  st.kills += stats.kills;
  st.elites += stats.elites;
  st.bosses += stats.bosses;
  st.metins += stats.metins;
  st.playTime += time;
  st.yeopEarned += yeop;
  st.shardsEarned += shards;
  st.bestScore = Math.max(st.bestScore, score);
  st.bestLevel = Math.max(st.bestLevel, stats.level);
  zs.runs += 1;
  if (run.victory) {
    zs.clears += 1;
    zs.bestTime = zs.bestTime === 0 ? time : Math.min(zs.bestTime, time);
  }
  zs.bestScore = Math.max(zs.bestScore, score);
  zs.bestLevel = Math.max(zs.bestLevel, stats.level);
  const cs = st.classes[run.classId];
  cs.runs += 1;
  if (run.victory) cs.wins += 1;
  cs.bestScore = Math.max(cs.bestScore, score);
  for (const boss of run.bossesKilled) st.bossKills[boss] = (st.bossKills[boss] ?? 0) + 1;
  for (const metin of run.metinTypesBroken ?? []) st.metinKinds[metin] = (st.metinKinds[metin] ?? 0) + 1;

  // 2. gear drops (luck from the loadout the run was played with)
  const luck = computeMetaBonuses(cur, content, { classId: run.classId, doctrine: run.doctrine }).stats.luck ?? 0;
  const shardsBeforeDrops = cur.bank.shards;
  const rolled = rollGearDrops(
    cur,
    content,
    { zone: run.zone, classId: run.classId, difficulty: run.difficulty, victory: run.victory, time, bossesKilled: run.bossesKilled, luck },
    rng,
  );
  cur = rolled.save;
  const duplicateShards = cur.bank.shards - shardsBeforeDrops;

  // 3. unlocks derived from the updated stats
  const before = save.unlocks;
  cur.unlocks = recomputeUnlocks(cur, content);
  const codexNew = newCodexUnlocks(cur, content);
  cur.unlocks.codex = [...cur.unlocks.codex, ...codexNew];
  // a feat pays when it is first added to the unlock list; the list is persisted, so a later settle never pays it again
  const codexById = new Map(content.story.codex.map((e) => [e.id, e] as const));
  const codexPaid: CodexPaid[] = [];
  for (const id of codexNew) {
    const entry = codexById.get(id);
    const paid = entry ? codexPayout(entry) : 0;
    if (paid > 0) codexPaid.push({ id, shards: paid });
  }
  const codexShards = codexPaid.reduce((n, c) => n + c.shards, 0);
  cur.bank.shards = Math.min(MAX_CURRENCY, cur.bank.shards + codexShards);
  cur.stats.shardsEarned += codexShards; // `st` points at the pre-drop save: rollGearDrops returned a copy
  cur.profile.updated = now;

  // the stats above already carry this run's clear, so a first Hard clear of a zone has lifted the cap by now and the XP
  // that piled up above the old cap is paid in full
  const cap = talentCap(cur);
  const pointsAfter = pointsForXp(cur.classes[run.classId].xp, cap);
  const summary: SettlementSummary = {
    runId: randomId(rng, 22),
    zone: run.zone,
    difficulty: run.difficulty,
    classId: run.classId,
    doctrine: run.doctrine,
    victory: run.victory,
    time,
    level: stats.level,
    kills: stats.kills,
    score,
    talentXp: {
      ...xp,
      before: xpBefore,
      after: cur.classes[run.classId].xp,
      pointsBefore,
      pointsAfter,
      pointsGained: pointsAfter - pointsBefore,
      available: Math.max(0, pointsAfter - spentTotal(cur.classes[run.classId])),
      cap,
      capBefore,
      capNext: capNextZone(cur, content),
    },
    bank: { yeop, shards, duplicateShards, yeopTotal: cur.bank.yeop, shardsTotal: cur.bank.shards },
    drops: rolled.drops,
    pity: rolled.pity,
    unlocks: {
      zones: newOnly(before.zones, cur.unlocks.zones),
      hard: newOnly(before.hard, cur.unlocks.hard),
      codex: newOnly(before.codex, cur.unlocks.codex),
    },
    codexPaid,
    records,
  };
  return { save: cur, summary };
}

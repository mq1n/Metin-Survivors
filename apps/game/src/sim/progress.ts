// XP curve, level-ups → card modals, victory/defeat resolution and the RunResult.

import { DEFEAT_DELAY, DT, VICTORY_DELAY } from './constants';
import { openLevelUp, openRunEnd } from './cards';
import { MAX_SKILL_RANK } from '../data/schema';
import type { RunResult } from './run';
import type { PlayerState } from './stores';
import type { World } from './world';

/** xp needed to go from `level` to `level + 1` (BalanceConfig.xpCurve: base + growth·n + accel·n²) */
export function xpToNext(w: World, level: number): number {
  const c = w.balance.xpCurve;
  return Math.max(1, c.base + c.growth * level + c.accel * level * level);
}

/** grant xp (already multiplied by the player's xpGain) and queue level-ups */
export function grantXp(w: World, p: PlayerState, amount: number): void {
  p.xp += amount;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.pendingLevels++;
    p.xpNext = xpToNext(w, p.level);
    w.bus.levelUp(p.index, p.level);
  }
}

/** open level-up modals for players with pending levels, then resolve the end of the run */
export function updateProgress(w: World): void {
  for (const p of w.players) {
    if (p.pendingLevels > 0 && p.alive && !w.modals.some((m) => m.player === p.index && m.kind === 'levelUp')) {
      p.pendingLevels--;
      openLevelUp(w, p, p.level - p.pendingLevels);
    }
  }
  if (w.over) return;
  if (w.endTimer < 0) {
    if (w.allDead()) {
      w.endTimer = DEFEAT_DELAY;
      w.endVictory = false;
      w.bus.story('defeat', w.zone.id);
    }
    return;
  }
  w.endTimer -= DT;
  if (w.endTimer <= 0) finishRun(w);
}

/** called by the boss system when the final boss dies */
export function beginVictory(w: World): void {
  if (w.endTimer >= 0 && w.endVictory) return;
  w.endTimer = VICTORY_DELAY;
  w.endVictory = true;
  w.bus.story('victory', w.zone.id);
}

function finishRun(w: World): void {
  w.over = true;
  w.victory = w.endVictory;
  const result = buildResult(w, w.endVictory);
  w.result = result;
  w.bus.runEnd(w.victory);
  openRunEnd(w, result);
}

/** the next boss still to come at run time `t` (the HUD's rule): the scheduled ones, then the final boss; null once that one arrived */
export function nextBossAt(w: World, t: number): { id: string; inSec: number } | null {
  for (const b of w.spawner.bosses) if (b.at > t) return { id: b.boss, inSec: b.at - t };
  const f = w.zone.final;
  return t < f.at ? { id: f.boss, inSec: f.at - t } : null;
}

export type DeathRecord = Pick<RunResult, 'killedBy' | 'killedAt' | 'nextBoss'>;

/**
 * DT-01: where a fallen hero's run ended: killedAt (always, once it really died), killedBy (when the source was told) and the next
 * boss at that moment. {} for a hero that is alive, was revived, or was dropped without a blow (a co-op guest that left).
 */
export function deathRecord(w: World, p: PlayerState): DeathRecord {
  if (p.alive || p.killedAt < 0) return {};
  const out: DeathRecord = { killedAt: p.killedAt };
  if (p.killedBy !== '') out.killedBy = p.killedBy;
  const next = nextBossAt(w, p.killedAt);
  if (next) out.nextBoss = next;
  return out;
}

/** the party's defeat record: the hero that fell last (the blow that ended the run); nothing on a victory or while a hero still stands */
function partyDeathRecord(w: World, victory: boolean): DeathRecord {
  if (victory || !w.allDead()) return {};
  let last: PlayerState | undefined;
  for (const p of w.players) if (p.killedAt >= 0 && (!last || p.killedAt > last.killedAt)) last = p;
  return last ? deathRecord(w, last) : {};
}

export function buildResult(w: World, victory: boolean): RunResult {
  const cfg = w.config;
  let level = 1;
  let yeop = 0;
  let yeopLeft = 0;
  let shards = 0;
  const bySkill = new Map<string, { rank: number; damage: number }>();
  for (const p of w.players) {
    level = Math.max(level, p.level);
    yeop += p.yeopEarned;
    yeopLeft += p.yeop;
    shards += p.shards;
    for (const s of p.skills) {
      const cur = bySkill.get(s.def.id);
      if (cur) {
        cur.damage += s.damage;
        cur.rank = Math.max(cur.rank, s.rank);
      } else {
        bySkill.set(s.def.id, { rank: s.rank, damage: s.damage });
      }
    }
  }
  const bossesKilled = w.tally.bossesKilled.slice();
  const damageBySkill = [...bySkill.entries()]
    .map(([skillId, v]) => ({ skillId, rank: Math.min(v.rank, MAX_SKILL_RANK), damage: v.damage }))
    .sort((a, b) => b.damage - a.damage);
  const minutes = w.time / 60;
  const tx = w.balance.talentXp;
  const talentXp =
    minutes * tx.perMinute +
    w.tally.kills * tx.perKill +
    w.tally.elitesKilled * tx.perElite +
    bossesKilled.length * tx.perBoss +
    w.tally.metinsBroken * tx.perMetin +
    (victory ? tx.victory : 0);
  return {
    victory,
    time: w.time,
    kills: w.tally.kills,
    elitesKilled: w.tally.elitesKilled,
    level,
    yeop,
    yeopLeft,
    shards,
    metinsBroken: w.tally.metinsBroken,
    metinTypesBroken: w.tally.metinIds.slice(),
    metinsAwakened: w.tally.metinsAwakened,
    bossesKilled,
    chestsOpened: w.tally.chestsOpened,
    maxCorruption: w.maxCorruption,
    damageTaken: w.tally.damageTaken,
    damageDealt: w.tally.damageDealt,
    damageBySkill,
    zone: cfg.zone,
    difficulty: cfg.difficulty,
    classId: cfg.classId,
    doctrine: cfg.doctrine,
    seed: cfg.seed,
    talentXp: Math.round(talentXp * w.diff.reward),
    runOptions: { ...w.options },
    rewardMul: w.diff.reward,
    players: w.players.map((p) => ({ index: p.index, level: p.level, kills: p.kills, yeop: p.yeopEarned, alive: p.alive })),
    ...partyDeathRecord(w, victory),
  };
}

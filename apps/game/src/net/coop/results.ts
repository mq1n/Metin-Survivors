// Per-player RunResult for co-op. The sim's own `buildResult` describes the whole party (every hero's yeop / shards /
// kills summed, the host's class). Meta settlement and the leaderboard must see ONE player's run, so each client gets:
//   * own: class/doctrine, level, kills, yeop earned / left, shards, skills damage meter, damage taken, talent XP
//   * shared by the party: run time, victory, elites, bosses, metins, chests, corruption, party damage dealt, zone/difficulty/seed
// `players` keeps the whole party's breakdown (its length > 1 is how the client tags the leaderboard submission as co-op).

import { MAX_SKILL_RANK, type ClassId, type DoctrineKey } from '../../data/schema';
import { buildResult as buildPartyResult, deathRecord } from '../../sim/progress';
import { DEFAULT_RUN_OPTIONS, type RunResult } from '../../sim/run';
import type { World } from '../../sim/world';
import { CLASS_IDS, DIFFICULTIES, DOCTRINE_KEYS, isOneOf } from '@ms/shared';

/** One hero's settlement view of the run (host side; `playerIndex` is the host world index). */
export function buildPlayerResult(w: World, victory: boolean, playerIndex: number): RunResult {
  const full = buildPartyResult(w, victory);
  const p = w.players[playerIndex];
  if (!p) return full;
  // the death record is the hero's own (killer, moment, next boss), not the party's last one
  const { killedBy: _killedBy, killedAt: _killedAt, nextBoss: _nextBoss, ...party } = full;
  const damageBySkill = p.skills
    .map((s) => ({ skillId: s.def.id, rank: Math.min(s.rank, MAX_SKILL_RANK), damage: s.damage }))
    .sort((a, b) => b.damage - a.damage);
  const tx = w.balance.talentXp;
  const talentXp =
    (w.time / 60) * tx.perMinute +
    p.kills * tx.perKill +
    w.tally.elitesKilled * tx.perElite +
    party.bossesKilled.length * tx.perBoss +
    w.tally.metinsBroken * tx.perMetin +
    (victory ? tx.victory : 0);
  return {
    ...party,
    level: p.level,
    kills: p.kills,
    yeop: p.yeopEarned,
    yeopLeft: p.yeop,
    shards: p.shards,
    damageTaken: p.damageTaken,
    damageBySkill,
    classId: p.classId,
    doctrine: p.doctrine,
    talentXp: Math.round(talentXp * w.diff.reward),
    ...(victory ? {} : deathRecord(w, p)),
  };
}

// ---------------------------------------------------------------------------
// JSON wire form (the relay caps `event` frames at 4096 chars, so the form is compact)

export interface WireResult {
  v: boolean;
  t: number;
  k: number;
  el: number;
  lv: number;
  y: number;
  yl: number;
  sh: number;
  mb: number;
  /** metin types broken: id → count */
  mt: Record<string, number>;
  ma: number;
  bk: string[];
  ch: number;
  mc: number;
  dt: number;
  dd: number;
  /** damage meter: [skillId, rank, damage][] */
  ds: [string, number, number][];
  z: string;
  df: string;
  c: string;
  d: string;
  sd: number;
  tx: number;
  /** run options sliders: density, health, damage, speed */
  ro: [number, number, number, number];
  /** reward multiplier */
  rm: number;
  /** party: [index, level, kills, yeop, alive 0/1][] */
  pl: [number, number, number, number, number][];
  /** DT-01 (all three optional: absent on a victory, a hero still standing and results of older hosts): killed by, killed at (s), next boss [id, seconds away] */
  kb?: string;
  kt?: number;
  nb?: [string, number];
}

export function encodeResult(r: RunResult): WireResult {
  const mt: Record<string, number> = {};
  for (const id of r.metinTypesBroken ?? []) mt[id] = (mt[id] ?? 0) + 1;
  const death: Pick<WireResult, 'kb' | 'kt' | 'nb'> = {};
  // a tag the decoder would refuse (too long, odd characters) is dropped, never sliced: a cut id names nothing in the report's name tables
  const kb = tag(r.killedBy);
  if (kb) death.kb = kb;
  if (typeof r.killedAt === 'number' && Number.isFinite(r.killedAt)) death.kt = Math.round(r.killedAt * 100) / 100;
  const nb = r.nextBoss ? tag(r.nextBoss.id) : undefined;
  if (r.nextBoss && nb) death.nb = [nb, Math.round(r.nextBoss.inSec * 100) / 100];
  return {
    v: r.victory,
    t: Math.round(r.time * 100) / 100,
    k: r.kills,
    el: r.elitesKilled,
    lv: r.level,
    y: Math.round(r.yeop),
    yl: Math.round(r.yeopLeft),
    sh: Math.round(r.shards),
    mb: r.metinsBroken,
    mt,
    ma: r.metinsAwakened,
    bk: r.bossesKilled,
    ch: r.chestsOpened,
    mc: Math.round(r.maxCorruption * 1000) / 1000,
    dt: Math.round(r.damageTaken),
    dd: Math.round(r.damageDealt),
    ds: r.damageBySkill.slice(0, 12).map((s) => [s.skillId, s.rank, Math.round(s.damage)]),
    z: r.zone,
    df: r.difficulty,
    c: r.classId,
    d: r.doctrine,
    sd: r.seed >>> 0,
    tx: r.talentXp,
    ro: [r.runOptions.density, r.runOptions.health, r.runOptions.damage, r.runOptions.speed],
    rm: Math.round(r.rewardMul * 1000) / 1000,
    pl: r.players.map((p) => [p.index, p.level, p.kills, Math.round(p.yeop), p.alive ? 1 : 0]),
    ...death,
  };
}

/** the longest id the wire carries ('boss:' / 'metin:' / 'hazard:' prefixes included); TAG's 48-char id plus the 7-char 'hazard:' prefix is 55 */
const KILLER_MAX = 64;
/** a killer or boss tag: an id, optionally behind a 'boss:' / 'metin:' / 'hazard:' prefix (the report looks it up in its name tables) */
const TAG = /^(?:(?:boss|metin|hazard):)?[A-Za-z0-9_.-]{1,48}$/;

/** the one rule both ends share: the encoder sends a tag only when this accepts it, the decoder reads a tag only when this accepts it */
function tag(v: unknown): string | undefined {
  return typeof v === 'string' && v.length <= KILLER_MAX && TAG.test(v) ? v : undefined;
}

function num(v: unknown, max = 1e12): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
}

/** Validates and expands a wire result; null when it is not one. */
export function decodeResult(d: unknown): RunResult | null {
  if (typeof d !== 'object' || d === null) return null;
  const w = d as Partial<WireResult> & Record<string, unknown>;
  if (typeof w.z !== 'string' || w.z.length > 48 || !isOneOf(DIFFICULTIES, w.df) || !isOneOf(CLASS_IDS, w.c) || !isOneOf(DOCTRINE_KEYS, w.d)) return null;
  const metinTypesBroken: string[] = [];
  if (typeof w.mt === 'object' && w.mt !== null) {
    for (const [id, n] of Object.entries(w.mt)) for (let i = 0; i < Math.min(200, num(n)); i++) metinTypesBroken.push(id);
  }
  const damageBySkill = Array.isArray(w.ds)
    ? w.ds
        .filter((s): s is [string, number, number] => Array.isArray(s) && typeof s[0] === 'string')
        .map((s) => ({ skillId: s[0], rank: Math.min(MAX_SKILL_RANK, num(s[1], 99)), damage: num(s[2]) }))
    : [];
  const players = Array.isArray(w.pl)
    ? w.pl
        .filter((p): p is [number, number, number, number, number] => Array.isArray(p))
        .map((p) => ({ index: num(p[0], 3), level: num(p[1], 9999), kills: num(p[2]), yeop: num(p[3]), alive: p[4] === 1 }))
    : [];
  const killedBy = tag(w.kb);
  const nextId = Array.isArray(w.nb) ? tag(w.nb[0]) : undefined;
  return {
    victory: w.v === true,
    time: num(w.t, 1e6),
    kills: Math.floor(num(w.k)),
    elitesKilled: Math.floor(num(w.el)),
    level: Math.max(1, Math.floor(num(w.lv, 9999))),
    yeop: Math.floor(num(w.y)),
    yeopLeft: Math.floor(num(w.yl)),
    shards: Math.floor(num(w.sh)),
    metinsBroken: Math.floor(num(w.mb)),
    metinTypesBroken,
    metinsAwakened: Math.floor(num(w.ma)),
    bossesKilled: Array.isArray(w.bk) ? w.bk.filter((b): b is string => typeof b === 'string').slice(0, 64) : [],
    chestsOpened: Math.floor(num(w.ch)),
    maxCorruption: num(w.mc, 1),
    damageTaken: num(w.dt),
    damageDealt: num(w.dd),
    damageBySkill,
    zone: w.z,
    difficulty: w.df,
    classId: w.c as ClassId,
    doctrine: w.d as DoctrineKey,
    seed: num(w.sd, 0xffffffff),
    talentXp: Math.floor(num(w.tx)),
    runOptions: {
      density: num(w.ro?.[0], 8) || 1,
      health: num(w.ro?.[1], 8) || 1,
      damage: num(w.ro?.[2], 8) || 1,
      speed: num(w.ro?.[3], 8) || 1,
    },
    rewardMul: num(w.rm, 100) || 1,
    players,
    ...(killedBy ? { killedBy } : {}),
    ...(typeof w.kt === 'number' && Number.isFinite(w.kt) ? { killedAt: num(w.kt, 1e6) } : {}),
    ...(nextId && Array.isArray(w.nb) ? { nextBoss: { id: nextId, inSec: num(w.nb[1], 1e6) } } : {}),
  };
}

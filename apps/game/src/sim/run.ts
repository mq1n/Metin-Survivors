// Run lifecycle types: RunConfig (input) → World → RunResult (output for results screen, leaderboard, talent XP).

import type { BalanceConfig, ClassId, Difficulty, DoctrineKey, EmpireId, Sex, StatMods, UpgradeStat } from '../data/schema';
import type { RunOptionSlider, RunOptionsConfig } from '../data/loader';

/** Persistent-progression bonuses resolved by META (gear + blacksmith + talents + collection) before the run. */
export interface MetaBonuses {
  /** pre-summed additive StatMods from gear/talents/etc. */
  stats: StatMods;
  /** start the run at this level (talent perk); default 1 */
  startLevel?: number;
  /** extra skill ids granted at run start (talent-milestone ultimates, kind 'ultimate' → own free slot) */
  extraSkills?: string[];
  /** per-skill permanent modifiers from talents, as pct fractions per UpgradeStat (e.g. {damage: 0.1}) */
  skillMods?: Record<string, Partial<Record<UpgradeStat, number>>>;
  /** extra rerolls / banishes / skips on top of BalanceConfig */
  rerolls?: number;
  banishes?: number;
  skips?: number;
}

export const EMPTY_META: MetaBonuses = { stats: {} };

/** pre-run difficulty sliders (multipliers, 1 = off; limits and reward weights live in balance.runOptions) */
export interface RunOptions {
  /** spawn rate and maximum alive count */
  density: number;
  /** enemy, boss and stone hit points */
  health: number;
  /** enemy and boss damage */
  damage: number;
  /** enemy and boss movement and projectile speed */
  speed: number;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = { density: 1, health: 1, damage: 1, speed: 1 };

const RUN_OPTION_KEYS = ['density', 'health', 'damage', 'speed'] as const;

function isSlider(v: unknown): v is RunOptionSlider {
  return (
    typeof v === 'object' &&
    v !== null &&
    'min' in v &&
    'max' in v &&
    'step' in v &&
    'rewardWeight' in v &&
    typeof v.min === 'number' &&
    typeof v.max === 'number' &&
    typeof v.step === 'number' &&
    typeof v.rewardWeight === 'number'
  );
}

function isRunOptionsConfig(v: unknown): v is RunOptionsConfig {
  return (
    typeof v === 'object' &&
    v !== null &&
    'rewardMax' in v &&
    typeof v.rewardMax === 'number' &&
    'density' in v &&
    isSlider(v.density) &&
    'health' in v &&
    isSlider(v.health) &&
    'damage' in v &&
    isSlider(v.damage) &&
    'speed' in v &&
    isSlider(v.speed)
  );
}

/** the Run Options table of the balance config (balance.json `runOptions`); throws when the content has none */
export function runOptionsTable(balance: BalanceConfig): RunOptionsConfig {
  const table: unknown = Reflect.get(balance, 'runOptions');
  if (!isRunOptionsConfig(table)) throw new Error('balance.runOptions is missing or malformed');
  return table;
}

/** slider values clamped to their limits (missing / non-finite → 1) */
export function clampRunOptions(opts: Partial<RunOptions> | undefined, table: RunOptionsConfig): RunOptions {
  const out: RunOptions = { ...DEFAULT_RUN_OPTIONS };
  for (const k of RUN_OPTION_KEYS) {
    const v = opts?.[k];
    const s = table[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) ? Math.min(s.max, Math.max(s.min, v)) : 1;
  }
  return out;
}

/** reward multiplier of the sliders: min(rewardMax, 1 + Σ rewardWeight·(value − 1)); the hard-mode reward multiplies on top */
export function runOptionsReward(opts: Partial<RunOptions> | undefined, table: RunOptionsConfig): number {
  const v = clampRunOptions(opts, table);
  let sum = 1;
  for (const k of RUN_OPTION_KEYS) sum += table[k].rewardWeight * (v[k] - 1);
  return Math.min(table.rewardMax, sum);
}

/** Additional co-op heroes (index 1..3). Player 0 comes from RunConfig itself. */
export interface CoopPlayerInit {
  classId: ClassId;
  doctrine: DoctrineKey;
  sex: Sex;
  empire: EmpireId;
  meta: MetaBonuses;
}

export interface RunConfig {
  /** ZoneDef.id */
  zone: string;
  difficulty: Difficulty;
  classId: ClassId;
  doctrine: DoctrineKey;
  sex: Sex;
  empire: EmpireId;
  seed: number;
  meta: MetaBonuses;
  coop?: CoopPlayerInit[];
  /** Run Options sliders (default: all 1) */
  runOptions?: Partial<RunOptions>;
}

export interface SkillDamageStat {
  skillId: string;
  rank: number;
  damage: number;
}

export interface RunResult {
  victory: boolean;
  /**
   * the run clock when the results opened: world.time = seconds of unpaused play (modals / pause never advance it), the
   * very number the HUD timer shows; it includes the 1.6 s defeat / 3.2 s victory outro. The Great Metin's final starts at
   * zone.final.at (900), so a victory is > 900 and a defeat can be anywhere.
   */
  time: number;
  kills: number;
  elitesKilled: number;
  /** highest player level */
  level: number;
  /** yeop collected during the run (banked by META; includes yeop spent on chests) */
  yeop: number;
  yeopLeft: number;
  /** metin shards earned */
  shards: number;
  metinsBroken: number;
  /** MetinDef ids, one entry per broken metin */
  metinTypesBroken: string[];
  metinsAwakened: number;
  /** boss ids killed, in order (META rolls gear drops from BossDef.loot + GearDef.source) */
  bossesKilled: string[];
  chestsOpened: number;
  maxCorruption: number;
  damageTaken: number;
  damageDealt: number;
  /** damage meter, sorted descending */
  damageBySkill: SkillDamageStat[];
  zone: string;
  difficulty: Difficulty;
  classId: ClassId;
  doctrine: DoctrineKey;
  seed: number;
  /** talent XP per BalanceConfig.talentXp (informational; META may recompute) */
  talentXp: number;
  /** the sliders the run was played with (clamped) */
  runOptions: RunOptions;
  /** total reward multiplier applied to yeop, shards and talent xp: hard-mode reward × Run Options reward (META / leaderboard use this) */
  rewardMul: number;
  /** per-player breakdown (co-op) */
  players: { index: number; level: number; kills: number; yeop: number; alive: boolean }[];
  /**
   * DT-01, a hero that fell: what dealt the killing blow: an EnemyDef id, 'boss:<id>', 'metin:<id>' or 'hazard:<kind>'. Absent when the
   * source is not known, on a victory, for a hero still standing, for a hero dropped without a blow (a co-op guest that left) and in results
   * made before the field existed. It is NOT tied to how the run ended: a run abandoned after the hero fell (a co-op host quitting with its
   * own hero already down, CoopHost.dispose) keeps the record, and one abandoned with the hero still standing has none. The defeat header
   * of the report therefore follows the run's tone (victory / defeat / abandon), never the presence of this field.
   */
  killedBy?: string;
  /** DT-01, a hero that fell: the run clock (s) when the hero fell, i.e. `time` without the defeat outro; present even when `killedBy` is not (same presence rule as `killedBy`) */
  killedAt?: number;
  /** DT-01, a hero that fell: the next scheduled boss at `killedAt` (`inSec` seconds away); absent once the last one (the final boss) had arrived, plus the cases of `killedBy` */
  nextBoss?: { id: string; inSec: number };
}

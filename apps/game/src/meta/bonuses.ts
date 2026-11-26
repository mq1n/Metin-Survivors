// MetaBonuses for a run (consumed by sim/run.ts RunConfig.meta): talent stats/effects of the chosen doctrine tree +
// equipped gear incl. +N blacksmith bonuses. Pure function of (save, content, run selection).
//
// The empire bonus is NOT part of `bonuses.stats`: the sim applies it itself from RunConfig.empire / CoopPlayerInit.empire
// (sim/player.ts createPlayer), so every co-op peer builds the same hero from the lobby loadout. It is reported in
// `breakdown.empire` only (armory character sheet). Adding it here too applied it twice (Saehwa +10% max HP gave +21%).
//
// Talent effect conventions (TalentNode.effect = { kind, params }, ranked: effective value = param × points):
//   startLevel            { value }   -> MetaBonuses.startLevel = 1 + Σ value × rank
//   rerolls | banishes | skips { value } -> MetaBonuses.rerolls / banishes / skips += value × rank
//   skillMod:<skillId>    { <UpgradeStat>: fraction }   -> MetaBonuses.skillMods[skillId][stat] += fraction × rank
//   extraSkill:<skillId>  {}          -> MetaBonuses.extraSkills += skillId (once rank ≥ 1)
// Unmapped kinds are reported in `breakdown.unmappedEffects` (never silently applied).
//
// Sky Sovereign's Favour (MT-01): when the context names a zone + difficulty that this profile has never cleared, every
// failed attempt there adds +3 % damage and +3 % max HP (cap +15 %) to `bonuses.stats` (and reports it in
// `breakdown.favour`). The first clear ends it. A context without zone / difficulty (armory sheet, settlement luck) gets none.

import type { ClassId, Difficulty, DoctrineKey, EmpireId, StatMods, UpgradeStat } from '../data/schema';
import type { MetaBonuses } from '../sim/run';
import { doctrineId, indexContent } from './content';
import { equippedPieces, gearStats } from './gear';
import { addStatMods, sumStatMods } from './statMods';
import { milestonesReached, sumPoints, treePointsOf } from './talents';
import type { MetaContent, SaveData } from './types';

export interface BonusContext {
  classId: ClassId;
  doctrine: DoctrineKey;
  empire?: EmpireId;
  /** with `difficulty`: the zone the run is for; enables Sky Sovereign's Favour (MT-01). Absent = no favour. */
  zone?: string;
  difficulty?: Difficulty;
}

/** Sky Sovereign's Favour: damage + max HP fraction per failed attempt at a zone / difficulty not yet cleared (MT-01). */
export const FAVOUR_PER_FAIL = 0.03;
/** ... and the most it ever adds (reached after five failed attempts). */
export const FAVOUR_CAP = 0.15;

/**
 * Sky Sovereign's Favour for a zone + difficulty as a fraction (0 .. FAVOUR_CAP): `FAVOUR_PER_FAIL` per attempt recorded in
 * `save.stats.zones[zone][difficulty].runs` while that zone / difficulty has no clear, 0 once it has one (or no attempt yet).
 * Pure; tolerant of damaged stats (negative / fractional / non-finite counts). The run screens (RP-01 / RP-02) show it.
 */
export function favourFor(save: SaveData, zone: string, difficulty: Difficulty): number {
  if (!Object.hasOwn(save.stats.zones, zone)) return 0;
  const zs = save.stats.zones[zone]?.[difficulty];
  if (!zs || Number(zs.clears) > 0) return 0;
  const runs = Math.floor(Number(zs.runs));
  if (!(runs > 0)) return 0;
  // 4 decimals: 0.03 x n without float dust (the value travels in CoopPlayerInit.meta and shows as a percentage)
  return Math.min(FAVOUR_CAP, Math.round(FAVOUR_PER_FAIL * Math.min(runs, 1000) * 1e4) / 1e4);
}

/**
 * The BonusContext for a run selection (the app's `metaBonuses` hook). In a co-op room the app hands it the selection with the
 * ROOM's zone and difficulty (app.ts startRun), so every client computes its OWN favour for the zone being played.
 */
export function bonusContextFor(sel: { classId: ClassId; doctrine: DoctrineKey; empire?: EmpireId | undefined; zone: string; difficulty: Difficulty }): BonusContext {
  const ctx: BonusContext = { classId: sel.classId, doctrine: sel.doctrine, zone: sel.zone, difficulty: sel.difficulty };
  if (sel.empire) ctx.empire = sel.empire;
  return ctx;
}

export interface BonusBreakdown {
  empire: StatMods;
  talents: StatMods;
  gear: StatMods;
  /** Sky Sovereign's Favour (MT-01): `{ damage, maxHpPct }` while the context's zone / difficulty is uncleared, else `{}` */
  favour: StatMods;
  /** milestone ids reached in the chosen tree, as `<doctrineId>@<at>` */
  milestones: string[];
  /** talent effects whose kind this layer does not map (id + kind), for diagnostics / UI tooltips */
  unmappedEffects: { node: string; kind: string }[];
}

export interface BonusDetail {
  bonuses: MetaBonuses;
  breakdown: BonusBreakdown;
}

const UPGRADE_STATS: Record<UpgradeStat, true> = {
  damage: true,
  cooldown: true,
  area: true,
  count: true,
  duration: true,
  speed: true,
  pierce: true,
  knockback: true,
  tick: true,
  range: true,
  statusChance: true,
  statusPower: true,
  heal: true,
};

export function isUpgradeStat(k: string): k is UpgradeStat {
  return Object.hasOwn(UPGRADE_STATS, k);
}

export function computeMetaBonusDetail(save: SaveData, content: MetaContent, ctx: BonusContext): BonusDetail {
  const idx = indexContent(content);
  const cs = save.classes[ctx.classId];
  const empireMods: StatMods = {};
  const talentMods: StatMods = {};
  const gearMods: StatMods = {};
  const favourMods: StatMods = {};
  const unmapped: BonusBreakdown['unmappedEffects'] = [];
  const milestoneIds: string[] = [];

  const bonuses: MetaBonuses = { stats: {} };
  let startLevelBonus = 0;
  let rerolls = 0;
  let banishes = 0;
  let skips = 0;
  const extraSkills: string[] = [];
  const skillMods: Record<string, Partial<Record<UpgradeStat, number>>> = {};

  if (ctx.empire) addStatMods(empireMods, idx.empires.get(ctx.empire)?.bonus);

  const did = doctrineId(ctx.classId, ctx.doctrine);
  const tree = idx.trees.get(did);
  if (cs && tree) {
    const points = treePointsOf(cs, did);
    for (const [nodeId, p] of Object.entries(points)) {
      const node = tree.nodes.get(nodeId);
      if (!node || !(p > 0)) continue;
      const rank = Math.min(p, node.max);
      addStatMods(talentMods, node.perPoint, rank);
      const eff = node.effect;
      if (!eff) continue;
      const value = eff.params.value ?? 0;
      if (eff.kind === 'startLevel') startLevelBonus += value * rank;
      else if (eff.kind === 'rerolls') rerolls += value * rank;
      else if (eff.kind === 'banishes') banishes += value * rank;
      else if (eff.kind === 'skips') skips += value * rank;
      else if (eff.kind.startsWith('skillMod:')) {
        const skillId = eff.kind.slice('skillMod:'.length);
        const mods = (skillMods[skillId] ??= {});
        for (const [stat, v] of Object.entries(eff.params)) {
          if (isUpgradeStat(stat) && Number.isFinite(v)) mods[stat] = (mods[stat] ?? 0) + v * rank;
        }
      } else if (eff.kind.startsWith('extraSkill:')) {
        const skillId = eff.kind.slice('extraSkill:'.length);
        if (!extraSkills.includes(skillId)) extraSkills.push(skillId);
      } else unmapped.push({ node: nodeId, kind: eff.kind });
    }
    for (const m of milestonesReached(tree.tree, sumPoints(points))) {
      milestoneIds.push(`${did}@${m.at}`);
      if (m.skill && !extraSkills.includes(m.skill)) extraSkills.push(m.skill);
    }
  }

  if (cs) for (const piece of equippedPieces(save, content, ctx.classId)) addStatMods(gearMods, gearStats(piece.def, piece.plus));

  if (ctx.zone !== undefined && ctx.difficulty !== undefined) {
    const favour = favourFor(save, ctx.zone, ctx.difficulty);
    if (favour > 0) {
      favourMods.damage = favour;
      favourMods.maxHpPct = favour;
    }
  }

  // empire stays out of the run bonuses (the sim adds it from the run config, see the header)
  bonuses.stats = sumStatMods(talentMods, gearMods, favourMods);
  if (startLevelBonus > 0) bonuses.startLevel = 1 + Math.round(startLevelBonus);
  if (extraSkills.length > 0) bonuses.extraSkills = extraSkills;
  if (Object.keys(skillMods).length > 0) bonuses.skillMods = skillMods;
  if (rerolls > 0) bonuses.rerolls = Math.round(rerolls);
  if (banishes > 0) bonuses.banishes = Math.round(banishes);
  if (skips > 0) bonuses.skips = Math.round(skips);

  return {
    bonuses,
    breakdown: { empire: empireMods, talents: talentMods, gear: gearMods, favour: favourMods, milestones: milestoneIds, unmappedEffects: unmapped },
  };
}

export function computeMetaBonuses(save: SaveData, content: MetaContent, ctx: BonusContext): MetaBonuses {
  return computeMetaBonusDetail(save, content, ctx).bonuses;
}

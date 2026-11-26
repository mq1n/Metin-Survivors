
// BalanceConfig.blacksmith, indexed by the CURRENT plus level). Failure consumes the materials only — the item and
// its level are kept. The RNG is injected so tests (and any replay) are deterministic.
//
// Blessing Scroll (MT-03): an optional extra on a step it can improve: +15 points of success chance (capped at 100 %) for 3x
// the attempt's Yeop, the shard cost unchanged. It is the late-meta Yeop sink and it spends SPARE Yeop only:
//  - it opens once the normal campaign is complete (the last zone by `order` cleared on Normal): until then Yeop is the binding
//    resource of the climb and a 3x price would only slow the gear down (24 paired campaigns: -22..-30 % refined gear);
//  - even then it reads only over spare Yeop (`ScrollSide.spare`): the Yeop that is left after it must still pay every plain
//    attempt the bank's shards allow. A blessed attempt costs 3y and uses one of the n = floor(shards / s) attempts the shards
//    pay for, so it displaces no plain attempt only when bank >= 3y + (n - 1)y = (n + 2)y. Without this the switch turned late
//    Yeop into idle shards (35 paired late-meta campaigns: -3 to -6 refined +N against plain play, because Yeop, not shards, was
//    still the binding resource of the hard phase);
//  - it refuses a step it cannot improve (+0 -> +1 is already certain): it never charges 3x for 0 points.
// A refusal spends nothing, draws no rng and leaves the profile untouched. The roll is the same single `rng.next()` draw with or
// without the scroll, and nothing about the save changes (the scroll's Yeop lands in the existing `stats.blacksmith.yeopSpent`).

import { indexContent } from './content';
import { clampPlus, MAX_PLUS, plusOf, usableBy } from './gear';
import type { ClassId } from '../data/schema';
import type { Fail, MetaContent, MetaRng, SaveData } from './types';
import { fail } from './types';
import { clearsOf } from './unlocks';

/** +15 points of success chance (a fraction: 0.15), capped at 100 % */
export const BLESSING_RATE_BONUS = 0.15;
/** the scroll's Yeop price: this many times the attempt's own Yeop */
export const BLESSING_YEOP_MULT = 3;

export interface UpgradeOptions {
  /** read a Blessing Scroll over this attempt (default false) */
  blessing?: boolean;
}

/** One side of a quote: what the plain attempt (`base`) or the attempt under a Blessing Scroll (`scroll`) would cost and give. */
export interface QuoteSide {
  /** success probability 0..1 */
  rate: number;
  yeop: number;
  canAfford: boolean;
}

export interface ScrollSide extends QuoteSide {
  shards: number;
  /** success chance the scroll adds, 0..1 (0 when the plain chance is already 100 %) */
  gain: number;
  /** false when the scroll adds nothing (the plain chance is already 100 %): it would only burn Yeop */
  useful: boolean;
  /** false until the normal campaign is complete (`scrollUnlocked`): the scroll is the late-meta Yeop sink, not part of the climb */
  available: boolean;
  /**
   * The bank holds spare Yeop for this scroll: bank.yeop >= `reserve`. A blessed attempt then displaces no plain attempt, because
   * the Yeop that is left still pays the other n - 1 attempts the shards allow (see the file header).
   */
  spare: boolean;
  /** how many plain attempts the bank's shards pay for at this step: floor(shards / step shards), 0 when the shards fall short */
  plainAttempts: number;
  /** the Yeop the bank must hold for the scroll to be spare: the step's Yeop x (plainAttempts + 2) */
  reserve: number;
  /** Yeop missing to `reserve`, 0 when `spare` */
  spareShort: number;
}

export interface UpgradeQuote {
  from: number;
  to: number;
  /** success probability 0..1 of the attempt asked for (`blessed` says which) */
  rate: number;
  /** Yeop of the attempt asked for */
  yeop: number;
  shards: number;
  /** can the bank pay the attempt asked for (the scroll's 3x Yeop when `blessed`) */
  canAfford: boolean;
  /** the quote was asked for with `{ blessing: true }`: rate and yeop above are the scroll's */
  blessed: boolean;
  /** the plain attempt, always present */
  base: QuoteSide & { shards: number };
  /** the same attempt under a Blessing Scroll, always present, so a UI can show both side by side */
  scroll: ScrollSide;
}

export type BlacksmithFailure =
  | 'unknownClass'
  | 'unknownGear'
  | 'classMismatch'
  | 'notOwned'
  | 'maxed'
  | 'badConfig'
  | 'noYeop'
  | 'noShards'
  /** a Blessing Scroll was asked for before the normal campaign is complete */
  | 'scrollLocked'
  /** a Blessing Scroll was asked for on a step it cannot improve (the plain chance is already 100 %) */
  | 'scrollUseless'
  /** a Blessing Scroll was asked for with Yeop that plain attempts still need (`ScrollSide.spare` is false) */
  | 'scrollNotSpare';

/**
 * Is the Blessing Scroll on offer? Once the normal campaign is complete: the last zone (by `order`) has been cleared on Normal at
 * least once. Hard clears do not count (a profile cannot reach them without it) and nothing is stored: it is read off the stats.
 */
export function scrollUnlocked(save: SaveData, content: MetaContent): boolean {
  const zones = indexContent(content).zonesOrdered;
  const last = zones[zones.length - 1];
  return last !== undefined && clearsOf(save, last.id, 'normal') > 0;
}

function costsAt(content: MetaContent, plus: number): { rate: number; yeop: number; shards: number } | null {
  const b = content.balance.blacksmith;
  const rate = b.successRate[plus];
  const yeop = b.yeopCost[plus];
  const shards = b.shardCost[plus];
  if (rate === undefined || yeop === undefined || shards === undefined) return null;
  if (!Number.isFinite(rate) || !Number.isFinite(yeop) || !Number.isFinite(shards)) return null;
  return { rate: Math.max(0, Math.min(1, rate)), yeop: Math.max(0, Math.round(yeop)), shards: Math.max(0, Math.round(shards)) };
}

/** A chance with the scroll's points added and the float noise rounded off (0.55 + 0.15 is 0.7000000000000001 in doubles). */
export function blessedRate(rate: number): number {
  return Math.min(1, Math.round((rate + BLESSING_RATE_BONUS) * 1e6) / 1e6);
}

/**
 * What the next upgrade of an owned piece costs and how likely it is. The quote always carries both sides (`base` and `scroll`);
 * `{ blessing: true }` makes the headline numbers the scroll's, and is refused (`scrollLocked` / `scrollUseless`) where the scroll
 * cannot be read at all. Whether the bank can pay it (`canAfford`) and whether that Yeop is spare (`scroll.spare`) are read off
 * the quote; `attemptUpgrade` refuses a scroll that is unaffordable or not spare.
 */
export function quoteUpgrade(
  save: SaveData,
  content: MetaContent,
  classId: ClassId,
  gearId: string,
  opts: UpgradeOptions = {},
): { ok: true; quote: UpgradeQuote } | Fail<BlacksmithFailure> {
  const cs = save.classes[classId];
  if (!cs) return fail('unknownClass');
  const def = indexContent(content).gear.get(gearId);
  if (!def) return fail('unknownGear');
  if (!usableBy(def, classId)) return fail('classMismatch');
  if (!cs.collection.includes(gearId)) return fail('notOwned');
  const from = plusOf(cs, gearId);
  if (from >= MAX_PLUS) return fail('maxed');
  const c = costsAt(content, from);
  if (!c) return fail('badConfig');
  const enoughShards = save.bank.shards >= c.shards;
  const scrollRate = blessedRate(c.rate);
  const scrollYeop = c.yeop * BLESSING_YEOP_MULT;
  const plainAttempts = c.shards > 0 ? Math.floor(save.bank.shards / c.shards) : 0;
  const reserve = c.yeop * (plainAttempts + 2);
  const base = { rate: c.rate, yeop: c.yeop, shards: c.shards, canAfford: save.bank.yeop >= c.yeop && enoughShards };
  const scroll: ScrollSide = {
    rate: scrollRate,
    yeop: scrollYeop,
    shards: c.shards,
    canAfford: save.bank.yeop >= scrollYeop && enoughShards,
    gain: Math.max(0, scrollRate - c.rate),
    useful: scrollRate > c.rate,
    available: scrollUnlocked(save, content),
    spare: save.bank.yeop >= reserve,
    plainAttempts,
    reserve,
    spareShort: Math.max(0, reserve - save.bank.yeop),
  };
  const blessed = opts.blessing === true;
  if (blessed && !scroll.available) return fail('scrollLocked');
  if (blessed && !scroll.useful) return fail('scrollUseless');
  const pick = blessed ? scroll : base;
  return {
    ok: true,
    quote: { from, to: from + 1, rate: pick.rate, yeop: pick.yeop, shards: c.shards, canAfford: pick.canAfford, blessed, base, scroll },
  };
}

export type UpgradeResult =
  | {
      ok: true;
      save: SaveData;
      success: boolean;
      from: number;
      to: number;
      /** the chance this roll was made against (the blessed one when the scroll was read) */
      rate: number;
      /** a Blessing Scroll was read over this attempt */
      blessed: boolean;
      spent: { yeop: number; shards: number };
    }
  | Fail<BlacksmithFailure>;

/**
 * One refining attempt. Materials are always consumed; the level rises only on success. `{ blessing: true }` reads a Blessing
 * Scroll over it: +15 points of chance (cap 100 %) for 3x the Yeop. It is refused with `scrollLocked` before the normal campaign
 * is complete, with `scrollUseless` on a step that is already certain, with `noYeop` / `noShards` when the bank cannot pay it,
 * and with `scrollNotSpare` when that Yeop is still needed by plain attempts (checked last). Every refusal spends nothing and
 * draws nothing from the rng.
 */
export function attemptUpgrade(save: SaveData, content: MetaContent, classId: ClassId, gearId: string, rng: MetaRng, opts: UpgradeOptions = {}): UpgradeResult {
  const q = quoteUpgrade(save, content, classId, gearId, opts);
  if (!q.ok) return q;
  const { quote } = q;
  if (save.bank.yeop < quote.yeop) return fail('noYeop');
  if (save.bank.shards < quote.shards) return fail('noShards');
  if (quote.blessed && !quote.scroll.spare) return fail('scrollNotSpare');
  const success = rng.next() < quote.rate;
  const next = structuredClone(save);
  next.bank.yeop -= quote.yeop;
  next.bank.shards -= quote.shards;
  next.stats.blacksmith.attempts += 1;
  next.stats.blacksmith.yeopSpent += quote.yeop;
  next.stats.blacksmith.shardsSpent += quote.shards;
  const to = success ? clampPlus(quote.to) : quote.from;
  if (success) {
    next.classes[classId].plus[gearId] = to;
    next.stats.blacksmith.successes += 1;
  }
  return { ok: true, save: next, success, from: quote.from, to, rate: quote.rate, blessed: quote.blessed, spent: { yeop: quote.yeop, shards: quote.shards } };
}

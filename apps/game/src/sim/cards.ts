// Card offers: level-up (new skill / skill rank-up / passive / passive rank-up / fallback), metin essence
// (spirit stones + trinkets), chests. Rarity rolls from BalanceConfig.rarityWeights shifted by luck.
// Modals pause the sim; answers are chooseCard / reroll / banish / skip.
//
// Awakening pacts (R1, OF-01; balance.pacts, rank 0 / absent = off = the offers below exactly as before): a skill's last rank-up
// (G2 -> P, the awakening) is offered, and lands, only while the skill's PACT PASSIVE (pacts.byBehavior[skill behaviour]) is owned
// at rank >= pacts.rank. Without it the skill stops at G2 and the card that takes it to G2 carries `needs` (the passive id); a
// passive card carries `pact.awakens` (the owned, not yet awakened skills whose pact the card moves toward being met). Every
// skill follows ITS behaviour: basic skills and the talent-milestone ultimates (kind 'ultimate', their own slot) included.
// The other passives (no behaviour maps to them) stay free, so the passive slots become a trade-off.
//
// Overflow cards (R6, OF-03; balance.overflow, absent or both switches off = the heal / yeop fallbacks below exactly as before):
// when the pools run dry the offer is filled with the fallback cards. With the overflow rules on, the yeop filler becomes a SHARDS
// card (Metin shards by rarity, banked at the run's end through p.shards), a build that can be offered nothing new (every skill and
// passive slot is full, or what is left is owned / banished) gets the stacking Sky Sovereign's BOON (+damage, +max hp per pick,
// unlimited, run-only: one entry in p.fixed per pick), the heal
// fallback is offered only below 45 % hp, and a skipped offer refunds overflow.skipRefund shards.
//
// Chest sizes and boss milestones (R7 / R11, OF-04; balance.chest, absent = the offers below exactly as before): an ordinary chest
// offers balance.chest.cards cards (absent = cardsPerLevel). With chest.bossMilestone on, a boss reward is not "a chest with an epic
// floor" but the run's build beat: three epic+ cards, never a filler - ONE AWAKENING (a ready pact; else the rank-up of the
// lowest-ranked skill), ONE ESSENCE card (spirit stone or trinket) and ONE level-up card. All of it is built by the host, for each
// living hero from that hero's own build (co-op unchanged: the modal and its cards travel like any other).
//
// The Sky Sovereign's Bargain (EV-02a; the shrine event of sim/runEvents.ts): `openBargain` pushes a free 'chest' modal whose source is
// BARGAIN_SOURCE for the hero that channelled the shrine. It is the one modal that can be REFUSED for nothing: `skipOffer` closes it
// without spending the hero's skip budget, and the co-op auto-pick timer refuses it instead of taking the first card (a curse is never
// taken for an absent player). The offered cards are `bargainOffer` (EV-02b): the three bargains, each a BOON for the hero who picks it
// paid for by a CURSE for the rest of the run - fury (+25 % damage / monsters 15 % faster, party-wide), cunning (+1 reroll and +1 banish /
// -10 % max hp, own hero) and fortune (the next 2 chests free / elites 25 % more often, party-wide). The table is `BARGAINS` below; a
// curse that changes the shared world says so (`Card.bargain.party`), skipping applies nothing.

import type { BehaviorKind, OverflowConfig, PassiveDef, Rarity, SkillDef, StatMods, StoneDef, TrinketDef } from '../data/schema';
import { MAX_SKILL_RANK, RARITIES, RARITY_MULT, resolveChest, resolveOverflow } from '../data/schema';
import { healPlayer } from './combat';
import { DT, MAX_SKILL_SLOTS } from './constants';
import { HealSource } from './events';
import type { RunResult } from './run';
import type { Rng } from './rng';
import { addSkill, applySkillLine, rollLine } from './skills';
import { addBoon, boonCount } from './stats';
import { EnemyFlag, type PassiveInstance, type PlayerState, type SkillInstance } from './stores';
import type { Card, CardLine, ModalKind, ModalRequest } from './types';
import type { World } from './world';

/** how strongly one luck point tilts the rarity weights toward rarer tiers */
const LUCK_SHIFT = 5;

/** trinket rank granted by a *new* trinket card of each rarity */
const TRINKET_RANK_BY_RARITY = [1, 1, 2, 2, 3];

export function rollRarity(rng: Rng, weights: Record<Rarity, number>, luck: number, floor = 0): Rarity {
  const w = RARITIES.map((r, i) => (i < floor ? 0 : weights[r] * (1 + Math.max(0, luck) * i * LUCK_SHIFT)));
  const idx = rng.weighted(w);
  return RARITIES[idx < 0 ? Math.min(floor, RARITIES.length - 1) : idx] as Rarity;
}

function rarityIdx(r: Rarity): number {
  return RARITIES.indexOf(r);
}

/**
 * convert StatMods entries into display lines, scaled by `mult`. Object-valued mods (vsRace / resist) become one line per
 * entry with the stat `<key>:<sub>` (e.g. `vsRace:ice`, `resist:fire`); the UI labels every line with `stat.<stat>`, so
 * each of those composite keys has its own i18n entry (i18n/parts/gameplay.*.json).
 */
export function modsToLines(mods: StatMods, mult: number): CardLine[] {
  const lines: CardLine[] = [];
  for (const key of Object.keys(mods) as (keyof StatMods)[]) {
    const v = mods[key];
    if (typeof v === 'number') {
      lines.push({ stat: key, mode: key === 'projectiles' || key === 'pierce' || key === 'revives' || key === 'maxHp' || key === 'armor' || key === 'regen' ? 'flat' : 'pct', value: v * mult });
    } else if (v && typeof v === 'object') {
      for (const [sub, sv] of Object.entries(v)) {
        if (typeof sv === 'number') lines.push({ stat: `${key}:${sub}`, mode: 'pct', value: sv * mult });
      }
    }
  }
  return lines;
}

function activeSlotCount(p: PlayerState): number {
  let n = 0;
  for (const s of p.skills) if (!s.basic && !s.ultimate) n++;
  return n;
}

/** the pact rules of this run (balance.pacts); null = pacts off (rank 0 or absent) */
interface PactRule {
  /** the rank the pact passive must be owned at */
  rank: number;
  /** weight multiplier of a ready awakening card in chest / boss offers */
  readyWeight: number;
  by: Partial<Record<BehaviorKind, string>>;
}

function pactRule(w: World): PactRule | null {
  const c = w.balance.pacts;
  if (!c || c.rank === undefined || !(c.rank > 0)) return null;
  return { rank: c.rank, readyWeight: c.readyWeight ?? 1, by: c.byBehavior ?? {} };
}

/**
 * the pact passive `def` still lacks: the passive id while it is not owned at pacts.rank (capped at that passive's own max rank);
 * null = nothing missing (the pact is met, or the behaviour has no pact passive)
 */
function pactNeed(w: World, rule: PactRule, p: PlayerState, def: SkillDef): string | null {
  const id = rule.by[def.behavior];
  if (id === undefined) return null;
  const owned = p.passives.find((x) => x.id === id);
  const need = Math.min(rule.rank, w.ix.passives.get(id)?.maxRank ?? rule.rank);
  return owned && owned.rank >= need ? null : id;
}

/** the rank a skill may be raised to: `want`, held back at G2 while its pact is unmet */
function pactCap(w: World, p: PlayerState, s: SkillInstance, want: number): number {
  const rank = Math.min(MAX_SKILL_RANK, want);
  if (rank < MAX_SKILL_RANK) return rank;
  const rule = pactRule(w);
  return rule && pactNeed(w, rule, p, s.def) !== null ? MAX_SKILL_RANK - 1 : rank;
}

/** ids of the owned skills (not yet awakened) whose unmet pact is on passive `id`: what a card for that passive moves forward */
function pactAwakens(w: World, rule: PactRule, p: PlayerState, id: string): string[] {
  const out: string[] = [];
  for (const s of p.skills) {
    if (s.rank >= MAX_SKILL_RANK || rule.by[s.def.behavior] !== id) continue;
    if (pactNeed(w, rule, p, s.def) !== null) out.push(s.def.id);
  }
  return out;
}

interface Pools {
  newSkills: SkillDef[];
  skillUps: SkillInstance[];
  newPassives: PassiveDef[];
  passiveUps: PassiveInstance[];
}

function collectPools(w: World, p: PlayerState): Pools {
  const ix = w.ix;
  const cls = ix.classes.get(p.classId);
  const doctrine = cls ? (p.doctrine === 'a' ? cls.doctrines[0] : cls.doctrines[1]) : undefined;
  const owned = new Set(p.skills.map((s) => s.def.id));
  const newSkills: SkillDef[] = [];
  if (activeSlotCount(p) < w.balance.maxActiveSkills && w.skillSlots.length < MAX_SKILL_SLOTS) {
    const ids = new Set<string>(doctrine ? doctrine.skills : []);
    for (const id of ids) {
      const d = ix.skills.get(id);
      if (d && d.kind === 'active' && !owned.has(id) && !p.banished.has(id)) newSkills.push(d);
    }
    for (const d of ix.commonSkills) if (!owned.has(d.id) && !p.banished.has(d.id) && !ids.has(d.id)) newSkills.push(d);
  }
  // a skill at G2 whose pact passive is missing stops there: its awakening is not offered until the passive is owned
  const rule = pactRule(w);
  const skillUps = p.skills.filter(
    (s) => s.rank < MAX_SKILL_RANK && !p.banished.has(s.def.id) && !(rule !== null && s.rank === MAX_SKILL_RANK - 1 && pactNeed(w, rule, p, s.def) !== null),
  );
  const ownedPassives = new Set(p.passives.map((x) => x.id));
  const newPassives: PassiveDef[] = [];
  if (p.passives.length < w.balance.maxPassives) {
    for (const d of w.content.passives) if (!ownedPassives.has(d.id) && !p.banished.has(d.id)) newPassives.push(d);
  }
  const passiveUps = p.passives.filter((x) => {
    const d = ix.passives.get(x.id);
    return d !== undefined && x.rank < d.maxRank && !p.banished.has(x.id);
  });
  return { newSkills, skillUps, newPassives, passiveUps };
}

function rollSkillLines(w: World, def: SkillDef, rarity: Rarity, count: number): CardLine[] {
  const pool = def.upgrades.slice();
  const rng = w.rng.cards;
  const lines: CardLine[] = [];
  const mult = RARITY_MULT[rarity];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const k = rng.int(pool.length);
    const [line] = pool.splice(k, 1);
    if (line) lines.push(rollLine(line, mult));
  }
  return lines;
}

function skillUpCard(w: World, s: SkillInstance, rarity: Rarity, needs: string | null = null): Card {
  const nLines = 1 + Math.floor(rarityIdx(rarity) / 2);
  const rank = s.rank + 1;
  const card: Card = {
    kind: 'skillUp',
    id: s.def.id,
    rarity,
    rank,
    maxRank: MAX_SKILL_RANK,
    awakening: rank >= MAX_SKILL_RANK,
    lines: rollSkillLines(w, s.def, rarity, nLines),
    amount: 0,
    slot: s.slot,
    replaces: null,
  };
  // the G2 card of a skill whose pact is unmet reads "awakens with <passive>"; the field is only written when something is missing
  if (needs !== null) card.needs = needs;
  return card;
}

function newSkillCard(w: World, def: SkillDef, rarity: Rarity): Card {
  return {
    kind: 'newSkill',
    id: def.id,
    rarity,
    rank: 0,
    maxRank: MAX_SKILL_RANK,
    awakening: false,
    // rare+ finds come with bonus upgrade lines already applied
    lines: rollSkillLines(w, def, rarity, Math.floor(rarityIdx(rarity) / 2)),
    amount: 0,
    slot: -1,
    replaces: null,
  };
}

function passiveCard(def: PassiveDef, rank: number, rarity: Rarity, isNew: boolean): Card {
  return {
    kind: isNew ? 'newPassive' : 'passiveUp',
    id: def.id,
    rarity,
    rank,
    maxRank: def.maxRank,
    awakening: false,
    lines: modsToLines(def.perRank, RARITY_MULT[rarity]),
    amount: 0,
    slot: -1,
    replaces: null,
  };
}

function healCard(rarity: Rarity): Card {
  return { kind: 'heal', id: '', rarity, rank: 0, maxRank: 0, awakening: false, lines: [], amount: Math.min(1, 0.25 * RARITY_MULT[rarity]), slot: -1, replaces: null };
}

function yeopCard(p: PlayerState, rarity: Rarity): Card {
  return { kind: 'yeop', id: '', rarity, rank: 0, maxRank: 0, awakening: false, lines: [], amount: Math.round((30 + 6 * p.level) * RARITY_MULT[rarity]), slot: -1, replaces: null };
}

// ---------------------------------------------------------------------------
// Overflow cards (R6, OF-03)

/** the filler kinds a dry pool is topped up with, in offer order; none is generated twice in one offer */
type FallbackKind = 'heal' | 'yeop' | 'shards' | 'boon';

/** with the overflow rules on, the heal fallback is only offered to a hero below this fraction of max hp */
const OVERFLOW_HEAL_BELOW = 0.45;

/** the rarity the Boon card is always drawn at (its gains do not scale with rarity: every pick is the same blessing) */
const BOON_RARITY: Rarity = 'legendary';

/** the overflow rules of this run (balance.overflow over its defaults); null while both switches are off = the fallbacks as ever */
function overflowRule(w: World): OverflowConfig | null {
  if (!w.balance.overflow) return null;
  const rule = resolveOverflow(w.balance.overflow);
  return rule.shards || rule.boon ? rule : null;
}

/**
 * nothing new can be offered, only ranks: no skill and no passive the hero could still take. That is a full slot bar, OR a free slot
 * with nothing left to fill it (every candidate owned or banished) - the same pools as the level-up offer (collectPools), so a hero
 * who banished skills of a seven-skill doctrine is not stuck below a sixth slot that can never be filled.
 */
function nothingNewToOffer(w: World, p: PlayerState): boolean {
  const pools = collectPools(w, p);
  return pools.newSkills.length === 0 && pools.newPassives.length === 0;
}

/** the fallback kinds this hero may be offered now, in order (no overflow rules = heal, yeop: today) */
function fallbackKinds(w: World, p: PlayerState): FallbackKind[] {
  const rule = overflowRule(w);
  if (rule === null) return ['heal', 'yeop'];
  const kinds: FallbackKind[] = [];
  if (p.hp < p.hpMax * OVERFLOW_HEAL_BELOW) kinds.push('heal');
  if (rule.boon && nothingNewToOffer(w, p)) kinds.push('boon');
  kinds.push(rule.shards ? 'shards' : 'yeop');
  return kinds;
}

/** shards a shards card of `rarity` pays */
function shardsFor(rule: OverflowConfig, rarity: Rarity): number {
  return Math.max(0, Math.round(rule.shardsByRarity[rarityIdx(rarity)] ?? 0));
}

function shardsCard(rule: OverflowConfig, rarity: Rarity): Card {
  return { kind: 'shards', id: '', rarity, rank: 0, maxRank: 0, awakening: false, lines: [], amount: shardsFor(rule, rarity), slot: -1, replaces: null };
}

/** the Sky Sovereign's Boon: `rank` = the stack it becomes when picked (the boons the hero holds + 1), `lines` = what one pick adds */
function boonCard(p: PlayerState, rule: OverflowConfig): Card {
  const lines: CardLine[] = [];
  if (rule.boonDamage > 0) lines.push({ stat: 'damage', mode: 'pct', value: rule.boonDamage });
  if (rule.boonHp > 0) lines.push({ stat: 'maxHpPct', mode: 'pct', value: rule.boonHp });
  return { kind: 'boon', id: '', rarity: BOON_RARITY, rank: boonCount(p) + 1, maxRank: 0, awakening: false, lines, amount: 0, slot: -1, replaces: null };
}

/** what one Boon pick adds to the hero's always-on stats */
function boonMods(rule: OverflowConfig): StatMods {
  const mods: StatMods = {};
  if (rule.boonDamage > 0) mods.damage = rule.boonDamage;
  if (rule.boonHp > 0) mods.maxHpPct = rule.boonHp;
  return mods;
}

function fallbackCard(w: World, p: PlayerState, kind: FallbackKind, rarity: Rarity): Card {
  switch (kind) {
    case 'heal':
      return healCard(rarity);
    case 'shards':
      return shardsCard(resolveOverflow(w.balance.overflow), rarity);
    case 'boon':
      return boonCard(p, resolveOverflow(w.balance.overflow));
    default:
      return yeopCard(p, rarity);
  }
}

/**
 * Top `cards` up to `count` with fallback cards, at most one of each kind (and none of `skip`). A rarity is rolled before each try,
 * also for the try that finds nothing left (the rng stream the offers always consumed).
 */
function fillFallbacks(w: World, p: PlayerState, cards: Card[], count: number, floor: number, skip?: ReadonlySet<string>): void {
  const kinds = fallbackKinds(w, p);
  while (cards.length < count) {
    const rarity = rollRarity(w.rng.cards, w.balance.rarityWeights, p.stats.luck, floor);
    const kind = kinds.find((k) => !cards.some((c) => c.kind === k) && !skip?.has(k));
    if (kind === undefined) break;
    cards.push(fallbackCard(w, p, kind, rarity));
  }
}

/** a queued newSkill / newPassive card that no longer fits its slots turns into this: shards (overflow rules on) or yeop */
function grantOverflowReward(w: World, p: PlayerState, rarity: Rarity): void {
  const rule = overflowRule(w);
  if (rule !== null && rule.shards) {
    p.shards += shardsFor(rule, rarity);
    return;
  }
  const amount = yeopCard(p, rarity).amount;
  p.yeop += amount;
  p.yeopEarned += amount;
}

export interface OfferOpts {
  count: number;
  /** lowest rarity index that may be rolled (chests) */
  rarityFloor?: number;
  /** ids that must not appear */
  exclude?: ReadonlySet<string>;
  /** fallback card kinds ('heal' | 'yeop' | 'shards' | 'boon') that must not be generated (already shown in the offer) */
  excludeFallback?: ReadonlySet<string>;
  /** chest / boss offers: a ready awakening card is weighted x balance.pacts.readyWeight (no effect while pacts are off) */
  awakenBoost?: boolean;
}

/** Build an offer for the level-up pool (skills + passives, fallbacks heal / yeop / shards / boon). Never offers duplicates. */
export function buildOffer(w: World, p: PlayerState, opts: OfferOpts): Card[] {
  const rng = w.rng.cards;
  const pools = collectPools(w, p);
  const used = new Set<string>(opts.exclude ?? []);
  const cards: Card[] = [];
  const luck = p.stats.luck;
  const floor = opts.rarityFloor ?? 0;
  const early = activeSlotCount(p) < 3;
  const rule = pactRule(w);
  const readyWeight = rule !== null && opts.awakenBoost === true ? rule.readyWeight : 1;
  for (let n = 0; n < opts.count; n++) {
    const rarity = rollRarity(rng, w.balance.rarityWeights, luck, floor);
    const ns = pools.newSkills.filter((d) => !used.has(d.id));
    const su = pools.skillUps.filter((s) => !used.has(s.def.id));
    const np = pools.newPassives.filter((d) => !used.has(d.id));
    const pu = pools.passiveUps.filter((x) => !used.has(x.id));
    // a G2 skill still in the pool has its pact met, so its rank-up is a ready awakening card: x readyWeight in chest / boss offers
    // (the skill-up category weight grows with it, so the card's own chance is x readyWeight against the rest of the offer)
    const nReady = readyWeight > 1 ? su.reduce((k, s) => k + (s.rank === MAX_SKILL_RANK - 1 ? 1 : 0), 0) : 0;
    const suWeight = nReady > 0 ? (3.2 * (su.length - nReady + nReady * readyWeight)) / su.length : 3.2;
    const weights = [ns.length > 0 ? (early ? 5 : 2.4) : 0, su.length > 0 ? suWeight : 0, np.length > 0 ? 1.8 : 0, pu.length > 0 ? 2.2 : 0];
    const cat = rng.weighted(weights);
    if (cat < 0) break;
    let card: Card;
    if (cat === 0) {
      card = newSkillCard(w, rng.pick(ns), rarity);
    } else if (cat === 1) {
      const s = nReady > 0 ? (su[rng.weighted(su.map((x) => (x.rank === MAX_SKILL_RANK - 1 ? readyWeight : 1)))] as SkillInstance) : rng.pick(su);
      card = skillUpCard(w, s, rarity, rule !== null && s.rank + 1 === MAX_SKILL_RANK - 1 ? pactNeed(w, rule, p, s.def) : null);
    } else if (cat === 2) {
      card = passiveCard(rng.pick(np), 1, rarity, true);
    } else {
      const inst = rng.pick(pu);
      const def = w.ix.passives.get(inst.id) as PassiveDef;
      card = passiveCard(def, inst.rank + 1, rarity, false);
    }
    if (rule !== null && (card.kind === 'newPassive' || card.kind === 'passiveUp')) {
      const awakens = pactAwakens(w, rule, p, card.id);
      if (awakens.length > 0) card.pact = { awakens };
    }
    used.add(card.id);
    cards.push(card);
  }
  // fallbacks: heal then yeop, at most one of each per offer (overflow rules: heal when hurt, the Boon on a full build, shards)
  fillFallbacks(w, p, cards, opts.count, floor, opts.excludeFallback);
  return cards;
}

function stoneRange(def: StoneDef): [number, number] {
  return def.slot === 'weapon' ? [0, 2] : [3, 5];
}

function trinketSlot(def: TrinketDef): number {
  return def.slot === 'bracelet' ? 0 : def.slot === 'necklace' ? 1 : 2;
}

/**
 * Metin essence: 3 cards of spirit stones / trinkets (new, upgrade, or replace when the slot is full). The rarity floor is rare (an
 * awakened metin) or uncommon, unless the caller names one (the boss milestone asks for epic).
 */
export function buildEssenceOffer(w: World, p: PlayerState, awakened: boolean, count = 3, rarityFloor?: number): Card[] {
  const rng = w.rng.cards;
  const floor = rarityFloor ?? (awakened ? 2 : 1);
  const cards: Card[] = [];
  const used = new Set<string>();
  const stones = w.content.stones;
  const trinkets = w.content.trinkets;
  for (let n = 0; n < count; n++) {
    const rarity = rollRarity(rng, w.balance.rarityWeights, p.stats.luck, floor);
    const ri = rarityIdx(rarity);
    const stoneOpts: Card[] = [];
    for (const def of stones) {
      if (used.has(def.id)) continue;
      const [lo, hi] = stoneRange(def);
      let owned = -1;
      let free = -1;
      let weakest = lo;
      for (let s = lo; s <= hi; s++) {
        const cur = p.stones[s];
        if (!cur) {
          if (free < 0) free = s;
        } else {
          if (cur.id === def.id) owned = s;
          const wk = p.stones[weakest];
          if (!wk || cur.level < wk.level) weakest = s;
        }
      }
      if (owned >= 0) {
        const cur = p.stones[owned];
        if (!cur || cur.level >= def.maxLevel) continue;
        const level = Math.min(def.maxLevel, Math.max(cur.level + 1, ri));
        stoneOpts.push({ kind: 'stoneUp', id: def.id, rarity, rank: level, maxRank: def.maxLevel, awakening: false, lines: modsToLines(def.perLevel, level + 1), amount: 0, slot: owned, replaces: null });
      } else if (free >= 0) {
        const level = Math.min(def.maxLevel, ri);
        stoneOpts.push({ kind: 'stone', id: def.id, rarity, rank: level, maxRank: def.maxLevel, awakening: false, lines: modsToLines(def.perLevel, level + 1), amount: 0, slot: free, replaces: null });
      } else {
        const old = p.stones[weakest];
        const level = Math.min(def.maxLevel, ri);
        stoneOpts.push({
          kind: 'stone', id: def.id, rarity, rank: level, maxRank: def.maxLevel, awakening: false,
          lines: modsToLines(def.perLevel, level + 1), amount: 0, slot: weakest,
          replaces: old ? { kind: 'stone', id: old.id, level: old.level, slot: weakest } : null,
        });
      }
    }
    const trinketOpts: Card[] = [];
    for (const def of trinkets) {
      if (used.has(def.id)) continue;
      const slot = trinketSlot(def);
      const cur = p.trinkets[slot];
      if (cur && cur.id === def.id) {
        if (cur.rank >= def.maxRank) continue;
        const rank = Math.min(def.maxRank, cur.rank + 1 + (ri >= 3 ? 1 : 0));
        trinketOpts.push({ kind: 'trinketUp', id: def.id, rarity, rank, maxRank: def.maxRank, awakening: false, lines: modsToLines(numericMods(def.perRank), rank), amount: 0, slot, replaces: null });
      } else {
        const rank = Math.min(def.maxRank, TRINKET_RANK_BY_RARITY[ri] ?? 1);
        trinketOpts.push({
          kind: 'trinket', id: def.id, rarity, rank, maxRank: def.maxRank, awakening: false, lines: modsToLines(numericMods(def.perRank), rank), amount: 0, slot,
          replaces: cur ? { kind: 'trinket', id: cur.id, level: cur.rank, slot } : null,
        });
      }
    }
    const all = stoneOpts.length + trinketOpts.length;
    if (all === 0) break;
    const pickStone = rng.next() < stoneOpts.length / all;
    const card = pickStone ? rng.pick(stoneOpts) : rng.pick(trinketOpts);
    used.add(card.id);
    cards.push(card);
  }
  fillFallbacks(w, p, cards, count, floor);
  return cards;
}

/** trinket perRank record (arbitrary keys) as a StatMods-shaped object for line display */
function numericMods(rec: Record<string, number>): StatMods {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = v;
  return out as StatMods;
}

// ---------------------------------------------------------------------------
// Modal lifecycle

function pushModal(w: World, kind: ModalKind, p: PlayerState, cards: Card[], extra: Partial<ModalRequest>): ModalRequest {
  const interactive = kind === 'levelUp' || kind === 'essence';
  const m: ModalRequest = {
    id: w.nextModalId++,
    kind,
    player: p.index,
    cards,
    canReroll: interactive && p.rerolls > 0,
    canBanish: kind === 'levelUp' && p.banishes > 0,
    canSkip: interactive && p.skips > 0,
    rerolls: p.rerolls,
    banishes: p.banishes,
    skips: p.skips,
    level: p.level,
    source: '',
    free: false,
    awakened: false,
    waited: 0,
    result: null,
    ...extra,
  };
  w.modals.push(m);
  return m;
}

function syncBudgets(m: ModalRequest, p: PlayerState): void {
  m.rerolls = p.rerolls;
  m.banishes = p.banishes;
  m.skips = p.skips;
  const interactive = m.kind === 'levelUp' || m.kind === 'essence';
  m.canReroll = interactive && p.rerolls > 0;
  m.canBanish = m.kind === 'levelUp' && p.banishes > 0;
  m.canSkip = interactive && p.skips > 0;
}

export function openLevelUp(w: World, p: PlayerState, level: number): ModalRequest {
  const cards = buildOffer(w, p, { count: w.balance.cardsPerLevel });
  return pushModal(w, 'levelUp', p, cards, { level });
}

export function openEssence(w: World, p: PlayerState, metinId: string, awakened: boolean): ModalRequest {
  const cards = buildEssenceOffer(w, p, awakened);
  return pushModal(w, 'essence', p, cards, { source: metinId, awakened });
}

/** the rarity floor of a boss reward: epic */
const BOSS_FLOOR = 3;

/** the offer is built on this many cards: awakening / rank-up, essence, level-up */
const MILESTONE_CARDS = 3;

/** fallback kinds a milestone never fills a free slot with (the Boon is a real build card and may, on a build with nothing left to rank) */
const MILESTONE_NO_FILLER: ReadonlySet<string> = new Set<string>(['heal', 'yeop', 'shards']);

/** the skills of lowest rank among `ups` (all of them when the ranks are equal) */
function lowestRanked(ups: readonly SkillInstance[]): SkillInstance[] {
  let low = MAX_SKILL_RANK;
  for (const s of ups) if (s.rank < low) low = s.rank;
  return ups.filter((s) => s.rank === low);
}

/**
 * The boss reward as a build milestone (chest.bossMilestone): [build card, essence card, level-up card], every card epic+ and none
 * a filler. The build card is a ready awakening (a skill at G2 whose pact is met; with the pacts off every G2 skill is ready), else
 * the rank-up of the lowest-ranked skill (a tie is the rng's pick). A card whose pool is dry (every skill at P, no stone or
 * trinket left to take) is replaced by one more level-up card; a build with nothing left at all gets what a dry chest gets.
 */
function buildBossMilestone(w: World, p: PlayerState): Card[] {
  const rng = w.rng.cards;
  const cards: Card[] = [];
  const used = new Set<string>();
  const rule = pactRule(w);
  const rarity = (): Rarity => rollRarity(rng, w.balance.rarityWeights, p.stats.luck, BOSS_FLOOR);

  // 1. the awakening, else the lowest-ranked skill
  const ups = collectPools(w, p).skillUps;
  const ready = ups.filter((s) => s.rank === MAX_SKILL_RANK - 1);
  const pool = ready.length > 0 ? ready : lowestRanked(ups);
  if (pool.length > 0) {
    const s = rng.pick(pool);
    cards.push(skillUpCard(w, s, rarity(), rule !== null && s.rank + 1 === MAX_SKILL_RANK - 1 ? pactNeed(w, rule, p, s.def) : null));
    used.add(s.def.id);
  }

  // 2. one essence card (stone or trinket), epic+; the offer's own fallbacks (no id) are not a reward
  const essence = buildEssenceOffer(w, p, true, 1, BOSS_FLOOR).find((c) => c.id !== '');
  if (essence) {
    cards.push(essence);
    used.add(essence.id);
  }

  // 3. level-up cards from the ordinary pool (one, or more when an earlier slot could not be filled), epic+
  const levelUps = buildOffer(w, p, { count: MILESTONE_CARDS - cards.length, rarityFloor: BOSS_FLOOR, exclude: used, excludeFallback: new Set(['heal', 'yeop', 'shards', 'boon']) });
  cards.push(...levelUps);

  // a build with little left to offer: the Boon (a stacking build card), never heal / yeop / shards ...
  if (cards.length < MILESTONE_CARDS) fillFallbacks(w, p, cards, MILESTONE_CARDS, BOSS_FLOOR, MILESTONE_NO_FILLER);
  // ... unless there is nothing at all: then it is what a dry chest gets
  if (cards.length === 0) fillFallbacks(w, p, cards, MILESTONE_CARDS, BOSS_FLOOR);
  return cards;
}

/**
 * chest / boss reward: a pick-one offer, no reroll/banish/skip. A chest offers balance.chest.cards cards (rare+); a boss reward is
 * the same offer at epic+ - or, with balance.chest.bossMilestone, the three-card build milestone (`buildBossMilestone`)
 */
export function openChest(w: World, p: PlayerState, boss: string | null): ModalRequest {
  const chest = resolveChest(w.balance);
  const cards =
    boss !== null && chest.bossMilestone
      ? buildBossMilestone(w, p)
      : buildOffer(w, p, { count: chest.cards, rarityFloor: boss ? BOSS_FLOOR : 2, awakenBoost: true });
  return pushModal(w, boss ? 'bossReward' : 'chest', p, cards, { source: boss ?? '', free: boss !== null });
}

// ---------------------------------------------------------------------------
// Sky Sovereign's Bargain (EV-02a)

/** `ModalRequest.source` of the shrine's modal (a 'chest' modal: free, skippable for nothing, no reroll / banish) */
export const BARGAIN_SOURCE = 'bargain';

/** is `m` the shrine's offer: refusing it is free and a timeout refuses it (see `skipOffer` / `tickModalWait`) */
export function isBargainModal(m: ModalRequest): boolean {
  return m.kind === 'chest' && m.source === BARGAIN_SOURCE;
}

// ---- the three bargains (EV-02b) ----------------------------------------------------------------------------------------------
//
// A bargain is a real choice: power NOW against a lasting cost. The boon is the picker's own; the curse lasts for the rest of the run
// and says whose it is - `party: true` = it changes the shared world (every hero meets the faster monsters / the extra elites, also a
// hero who joins later), no `party` = only the picker pays. Every number is in `BARGAINS`, the one table the cards, the effects and
// the strings (i18n/parts/up_events.*.json) are written against; nothing here draws a random number.
//   fury     boon +25 % damage                          curse monsters move 15 % faster (party-wide)
//   cunning  boon +1 reroll and +1 banish               curse -10 % max hp (own hero)
//   fortune  boon the next 2 chests you open are free   curse elites come 25 % more often (party-wide)
// How each one is carried out:
//   * boons: `p.fixed` (the always-on mods, run-only like the Boon), the reroll / banish budgets, and for the chests a per-hero counter
//     (`freeChestsLeft` / `takeFreeChest`, read by pickups.ts: a free chest costs nothing and does not climb the price ladder);
//   * party curses: the elite pace is a run modifier (`World.setEventMods`, RS-01: `eliteEvery`); there is no run modifier for the pace
//     of the monsters, so the sweep `tickBargainPace` (called every tick by runEvents.ts `updateRunEvent`, after the spawner and before
//     the next movement) multiplies the `baseSpeed` of every creature once and marks it (`PACED_FLAG`). Metin rows do not move and bosses
//     keep their tuned pace (their rage already has its own speed cap), so neither is touched;
//   * own curses: another entry of `p.fixed` (`maxHpPct`).
// Two heroes taking the same bargain pay twice (the party curses stack); one hero takes at most one (the shrine is used once per hero).

export type BargainId = 'fury' | 'cunning' | 'fortune';

/** the offer order: the first card is the one an unattended pick (the balance bot) takes */
export const BARGAIN_IDS: readonly BargainId[] = ['fury', 'cunning', 'fortune'];

export interface BargainDef {
  /** the hero's own gain */
  boon: { damage?: number; rerolls?: number; banishes?: number; freeChests?: number };
  /** what the run pays: `enemySpeed` = +share of the monsters' pace, `maxHpPct` = share of the picker's max hp, `eliteMore` = +share of elites (frequency) */
  curse: { enemySpeed?: number; maxHpPct?: number; eliteMore?: number };
  /** the curse changes the shared world: every hero of a co-op party pays */
  party: boolean;
}

export const BARGAINS: Readonly<Record<BargainId, BargainDef>> = {
  fury: { boon: { damage: 0.25 }, curse: { enemySpeed: 0.15 }, party: true },
  cunning: { boon: { rerolls: 1, banishes: 1 }, curse: { maxHpPct: -0.1 }, party: false },
  fortune: { boon: { freeChests: 2 }, curse: { eliteMore: 0.25 }, party: true },
};

/**
 * `EnemyStore.flags` bit the pace sweep marks a creature with once its `baseSpeed` carries the pace curse. The bits of `EnemyFlag`
 * (1..64) are taken, this is the last free one of the u8 column (kept in step by a test); a row that dies and is reused starts from 0.
 */
export const PACED_FLAG = 128;

/** the id the fortune curse files its elite factor under (`World.setEventMods`) */
export const BARGAIN_MODS_ID = 'bargain';

interface WorldCurses {
  /** the factor every PACED creature's baseSpeed carries now (1 = no pace curse) */
  pace: number;
  /** how many fortune bargains were taken (the elite factor stacks) */
  fortunes: number;
}

const CURSES = new WeakMap<World, WorldCurses>();
const TAKEN = new WeakMap<PlayerState, BargainId[]>();
const FREE_CHESTS = new WeakMap<PlayerState, number>();

function cursesOf(w: World): WorldCurses {
  let c = CURSES.get(w);
  if (c === undefined) {
    c = { pace: 1, fortunes: 0 };
    CURSES.set(w, c);
  }
  return c;
}

function bargainDef(id: string): BargainDef | undefined {
  return (BARGAIN_IDS as readonly string[]).includes(id) ? BARGAINS[id as BargainId] : undefined;
}

/** the shrine card of bargain `id` (i18n keys `bargain.<id>.name` / `.boon` / `.curse`, `bargain.party`) */
function bargainCard(id: BargainId): Card {
  const def = BARGAINS[id];
  return {
    kind: 'bargain',
    id,
    rarity: 'epic',
    rank: 0,
    maxRank: 0,
    awakening: false,
    lines: [],
    amount: 0,
    slot: -1,
    replaces: null,
    bargain: def.party ? { boon: `bargain.${id}.boon`, curse: `bargain.${id}.curse`, party: true } : { boon: `bargain.${id}.boon`, curse: `bargain.${id}.curse` },
  };
}

/** the bargains hero `p` took this run, in order (empty = none) */
export function bargainsTaken(p: PlayerState): readonly BargainId[] {
  return TAKEN.get(p) ?? [];
}

/** free chests hero `p` still has (fortune's boon) */
export function freeChestsLeft(p: PlayerState): number {
  return FREE_CHESTS.get(p) ?? 0;
}

/** spend one of hero `p`'s free chests; false = none left (the chest is paid for as usual) */
export function takeFreeChest(p: PlayerState): boolean {
  const left = FREE_CHESTS.get(p) ?? 0;
  if (left <= 0) return false;
  FREE_CHESTS.set(p, left - 1);
  return true;
}

/** the factor the monsters' pace carries from the bargains of this run (1 = none) */
export function bargainPace(w: World): number {
  return CURSES.get(w)?.pace ?? 1;
}

/** scale the pace of every creature that does not carry the pace curse yet and mark it (metin rows and bosses are left alone) */
function paceNewRows(w: World, factor: number): void {
  const e = w.enemies;
  const skip = EnemyFlag.Metin | EnemyFlag.Boss | PACED_FLAG;
  for (let i = 0; i < e.count; i++) {
    const fl = e.flags[i] as number;
    if ((fl & skip) !== 0) continue;
    e.baseSpeed[i] = (e.baseSpeed[i] as number) * factor;
    e.flags[i] = fl | PACED_FLAG;
  }
}

/**
 * The fury curse follows every creature of the run: once per tick (runEvents.ts `updateRunEvent`, after the spawner) the creatures
 * spawned since the last tick get the pace. Nothing at all while no bargain raised it.
 */
export function tickBargainPace(w: World): void {
  const c = CURSES.get(w);
  if (c !== undefined && c.pace !== 1) paceNewRows(w, c.pace);
}

/** raise the monsters' pace by `share` (0.15 = 15 % faster) from now on: the creatures on the field now and every one spawned later */
function raisePace(w: World, share: number): void {
  const c = cursesOf(w);
  const ratio = 1 + share;
  const e = w.enemies;
  // the creatures that already carry the old factor are brought to the new one ...
  for (let i = 0; i < e.count; i++) {
    if (((e.flags[i] as number) & PACED_FLAG) !== 0) e.baseSpeed[i] = (e.baseSpeed[i] as number) * ratio;
  }
  c.pace *= ratio;
  // ... and the rest get the whole of it
  paceNewRows(w, c.pace);
}

function addFixed(p: PlayerState, mods: StatMods): void {
  p.fixed.push({ ...mods });
  p.statsDirty = true;
}

/** the modals of hero `p` that are still open show the budgets as they are now (skips free shrine bargains) */
function syncOpenBudgets(w: World, p: PlayerState): void {
  for (const m of w.modals) if (m.player === p.index && m.kind !== 'runEnd' && !isBargainModal(m)) syncBudgets(m, p);
}

/**
 * Carry out a bargain card for hero `p`: the boon and the curse together, for the rest of the run. An id the table does not know
 * (a placeholder, a card from a newer build) does nothing.
 */
function applyBargain(w: World, p: PlayerState, card: Card): void {
  const id = card.id;
  const def = bargainDef(id);
  if (def === undefined) return;
  const { boon, curse } = def;
  if (boon.damage !== undefined) addFixed(p, { damage: boon.damage });
  if (boon.rerolls !== undefined) p.rerolls += boon.rerolls;
  if (boon.banishes !== undefined) p.banishes += boon.banishes;
  if (boon.freeChests !== undefined) FREE_CHESTS.set(p, freeChestsLeft(p) + boon.freeChests);
  if (curse.maxHpPct !== undefined) addFixed(p, { maxHpPct: curse.maxHpPct });
  if (curse.enemySpeed !== undefined) raisePace(w, curse.enemySpeed);
  if (curse.eliteMore !== undefined) {
    const c = cursesOf(w);
    c.fortunes++;
    // 25 % more elites = 1 / 1.25 of the interval between them, once per fortune taken
    w.setEventMods(BARGAIN_MODS_ID, { eliteEvery: (1 / (1 + curse.eliteMore)) ** c.fortunes });
  }
  const list = TAKEN.get(p);
  if (list === undefined) TAKEN.set(p, [id as BargainId]);
  else list.push(id as BargainId);
  if (boon.rerolls !== undefined || boon.banishes !== undefined) syncOpenBudgets(w, p);
}

/**
 * The cards of one shrine offer, `count` of them (at most the three bargains, in the order of BARGAIN_IDS). Draws no random number.
 */
function bargainOffer(_w: World, _p: PlayerState, count: number): Card[] {
  return BARGAIN_IDS.slice(0, Math.max(0, count)).map(bargainCard);
}

/**
 * The Sky Sovereign's Bargain modal of hero `p`: `runEvents.kinds.bargain.offers` cards, free, skippable (one free refusal, shown as the
 * hero's single skip: it never touches `p.skips`), no reroll and no banish. Built by the host for each hero that channelled the shrine
 * (co-op: the modal travels to its hero like any other).
 */
export function openBargain(w: World, p: PlayerState): ModalRequest {
  const cards = bargainOffer(w, p, w.ix.runEvents.kinds.bargain.offers);
  return pushModal(w, 'chest', p, cards, { source: BARGAIN_SOURCE, free: true, canSkip: true, rerolls: 0, banishes: 0, skips: 1 });
}

export function openRunEnd(w: World, result: RunResult): ModalRequest {
  const p = w.players[0] as PlayerState;
  return pushModal(w, 'runEnd', p, [], { result });
}

function findModal(w: World, player: number): number {
  return w.modals.findIndex((m) => m.player === player && m.kind !== 'runEnd');
}

/**
 * The passive/skill/stone/trinket cards of queued modals are snapshots; they are re-resolved against the live state here.
 * Returns whether the card still lands as an awakening (`card.awakening`, except a pact-held rank-up that stopped at G2).
 */
function applyCardNow(w: World, p: PlayerState, card: Card): boolean {
  const ix = w.ix;
  const bal = w.balance;
  let awakening = card.awakening;
  switch (card.kind) {
    case 'newSkill': {
      const def = ix.skills.get(card.id);
      if (!def) break;
      const owned = p.skills.find((s) => s.def.id === def.id);
      if (owned) {
        // the same skill was taken by an earlier queued pick: this one becomes a rank-up
        owned.rank = pactCap(w, p, owned, owned.rank + 1);
        for (const line of card.lines) applySkillLine(owned, line);
      } else if (activeSlotCount(p) >= bal.maxActiveSkills || w.skillSlots.length >= MAX_SKILL_SLOTS) {
        grantOverflowReward(w, p, card.rarity);
      } else {
        const s = addSkill(w, p, def, 0);
        for (const line of card.lines) applySkillLine(s, line);
      }
      break;
    }
    case 'skillUp': {
      const s = w.skillSlots[card.slot];
      if (s && s.owner === p.index) {
        // two queued offers built from the same state can both carry the G2 card: the second pick would reach P without the
        // pact, so the pact holds the skill at G2 (the card's lines still apply, it just is not an awakening)
        const want = Math.min(MAX_SKILL_RANK, Math.max(s.rank + 1, card.rank));
        s.rank = pactCap(w, p, s, want);
        if (s.rank < want) awakening = false;
        for (const line of card.lines) applySkillLine(s, line);
      }
      break;
    }
    case 'newPassive':
    case 'passiveUp': {
      const def = ix.passives.get(card.id);
      if (!def) break;
      const inst = p.passives.find((x) => x.id === card.id);
      if (inst) {
        inst.rank = Math.min(def.maxRank, Math.max(inst.rank + 1, card.rank));
        inst.power += RARITY_MULT[card.rarity];
      } else if (card.kind === 'passiveUp') {
        break;
      } else if (p.passives.length >= bal.maxPassives) {
        grantOverflowReward(w, p, card.rarity);
      } else {
        p.passives.push({ id: card.id, rank: 1, power: RARITY_MULT[card.rarity] });
      }
      p.statsDirty = true;
      break;
    }
    case 'heal':
      healPlayer(w, p, p.hpMax * card.amount, HealSource.Card);
      break;
    case 'yeop':
      p.yeop += card.amount;
      p.yeopEarned += card.amount;
      break;
    case 'stone':
    case 'stoneUp': {
      const def = ix.stones.get(card.id);
      if (!def) break;
      const [lo, hi] = stoneRange(def);
      let owned = -1;
      let free = -1;
      let weakest = lo;
      for (let s = lo; s <= hi; s++) {
        const cur = p.stones[s];
        if (!cur) {
          if (free < 0) free = s;
        } else {
          if (cur.id === def.id) owned = s;
          const wk = p.stones[weakest];
          if (!wk || cur.level < wk.level) weakest = s;
        }
      }
      const cur = owned >= 0 ? p.stones[owned] : null;
      if (cur) {
        p.stones[owned] = { id: def.id, level: Math.min(def.maxLevel, Math.max(cur.level + 1, card.rank)) };
      } else {
        // the slot chosen when the offer opened, if it is still empty / still holds the stone it was going to replace
        const want = p.stones[card.slot];
        const valid = card.slot >= lo && card.slot <= hi && (!want || want.id === card.replaces?.id);
        p.stones[valid ? card.slot : free >= 0 ? free : weakest] = { id: def.id, level: Math.min(def.maxLevel, card.rank) };
      }
      p.statsDirty = true;
      break;
    }
    case 'trinket':
    case 'trinketUp': {
      const def = ix.trinkets.get(card.id);
      if (!def) break;
      const slot = trinketSlot(def);
      const cur = p.trinkets[slot];
      const rank = cur && cur.id === def.id ? Math.max(cur.rank + 1, card.rank) : card.rank;
      p.trinkets[slot] = { id: def.id, rank: Math.min(def.maxRank, rank) };
      p.statsDirty = true;
      break;
    }
    case 'shards':
      // banked at the run's end with the rest of the run's shards (RunResult.shards <- p.shards)
      p.shards += Number.isFinite(card.amount) ? Math.max(0, Math.round(card.amount)) : 0;
      break;
    case 'boon':
      // Sky Sovereign's Boon: one more always-on entry in p.fixed for the rest of this run (the picker's own, unlimited)
      addBoon(p, boonMods(resolveOverflow(bal.overflow)));
      break;
    case 'bargain':
      // the shrine's bargain: its boon for this hero and its curse for the rest of the run (an unknown id does nothing)
      applyBargain(w, p, card);
      break;
    default:
      break;
  }
  return awakening;
}

/** apply a card to the player */
export function applyCard(w: World, p: PlayerState, card: Card): void {
  const awakening = applyCardNow(w, p, card);
  p.lastPickRarity = card.rarity;
  w.bus.cardPick(p.index, card.kind, card.id, card.rarity, card.rank, awakening);
  w.bus.sfx(awakening ? 'sfx_awaken' : 'sfx_card_pick', p.x, p.z, 0.7);
}

export function chooseCard(w: World, player: number, index: number): boolean {
  const mi = findModal(w, player);
  if (mi < 0) return false;
  const m = w.modals[mi] as ModalRequest;
  const card = m.cards[index];
  const p = w.players[player];
  if (!card || !p) return false;
  applyCard(w, p, card);
  w.modals.splice(mi, 1);
  return true;
}

export function rerollOffer(w: World, player: number): boolean {
  const mi = findModal(w, player);
  const p = w.players[player];
  if (mi < 0 || !p) return false;
  const m = w.modals[mi] as ModalRequest;
  if ((m.kind !== 'levelUp' && m.kind !== 'essence') || p.rerolls <= 0) return false;
  p.rerolls--;
  const prev = new Set(m.cards.map((c) => c.id).filter((id) => id !== ''));
  let cards =
    m.kind === 'levelUp'
      ? buildOffer(w, p, { count: w.balance.cardsPerLevel, exclude: prev })
      : buildEssenceOfferExcluding(w, p, m, prev);
  if (cards.length < Math.min(m.cards.length, 3)) {
    cards = m.kind === 'levelUp' ? buildOffer(w, p, { count: w.balance.cardsPerLevel }) : buildEssenceOffer(w, p, m.awakened);
  }
  m.cards = cards;
  m.waited = 0;
  syncOpenBudgets(w, p);
  return true;
}

function buildEssenceOfferExcluding(w: World, p: PlayerState, m: ModalRequest, prev: ReadonlySet<string>): Card[] {
  const awakened = m.awakened;
  // essence offers cannot exclude by id directly; roll up to a few times until the ids differ from the previous set
  let best = buildEssenceOffer(w, p, awakened);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!best.some((c) => prev.has(c.id))) return best;
    best = buildEssenceOffer(w, p, awakened);
  }
  return best;
}

export function banishCard(w: World, player: number, index: number): boolean {
  const mi = findModal(w, player);
  const p = w.players[player];
  if (mi < 0 || !p) return false;
  const m = w.modals[mi] as ModalRequest;
  const card = m.cards[index];
  if (m.kind !== 'levelUp' || !card || p.banishes <= 0 || card.id === '') return false;
  p.banishes--;
  p.banished.add(card.id);
  const others = new Set(m.cards.map((c) => c.id));
  const shownFallbacks = new Set(m.cards.filter((c) => c.id === '').map((c) => c.kind));
  const repl = buildOffer(w, p, { count: 1, exclude: others, excludeFallback: shownFallbacks });
  const first = repl[0];
  if (first) m.cards[index] = first;
  else m.cards.splice(index, 1);
  if (m.cards.length === 0) m.cards.push(healCard('common'));
  syncOpenBudgets(w, p);
  return true;
}

export function skipOffer(w: World, player: number): boolean {
  const mi = findModal(w, player);
  const p = w.players[player];
  if (mi < 0 || !p) return false;
  const m = w.modals[mi] as ModalRequest;
  // the shrine's offer is refused for nothing: no skip spent, no refund, no card applied
  if (isBargainModal(m)) {
    w.modals.splice(mi, 1);
    return true;
  }
  if ((m.kind !== 'levelUp' && m.kind !== 'essence') || p.skips <= 0) return false;
  p.skips--;
  // overflow rules: passing on an offer is not for nothing, it refunds shards
  const rule = overflowRule(w);
  if (rule !== null && rule.shards) p.shards += rule.skipRefund;
  w.modals.splice(mi, 1);
  syncOpenBudgets(w, p);
  return true;
}

/** while modals are pending: advance the co-op auto-pick timer on each player's frontmost visible modal */
export function tickModalWait(w: World): void {
  if (!Number.isFinite(w.autoPickAfter)) return;
  // Only each player's frontmost non-runEnd modal is visible to them; queued modals behind it wait at 0 until shown.
  let seenPlayers = 0;
  const active: ModalRequest[] = [];
  for (let i = 0; i < w.modals.length; i++) {
    const m = w.modals[i] as ModalRequest;
    if (m.kind === 'runEnd') continue;
    const bit = 1 << m.player;
    if ((seenPlayers & bit) !== 0) continue;
    seenPlayers |= bit;
    active.push(m);
  }
  for (let i = 0; i < active.length; i++) {
    const m = active[i] as ModalRequest;
    m.waited += DT;
    if (m.waited < w.autoPickAfter) continue;
    // a shrine offer nobody answered is refused (a curse is never taken for an absent player); every other modal takes its first card
    if (isBargainModal(m)) {
      const idx = w.modals.indexOf(m);
      if (idx >= 0) w.modals.splice(idx, 1);
    } else if (!chooseCard(w, m.player, 0)) {
      // Defensive fallback if an offer somehow had no cards so the party can never deadlock on a modal.
      const idx = w.modals.indexOf(m);
      if (idx >= 0) w.modals.splice(idx, 1);
    }
  }
}

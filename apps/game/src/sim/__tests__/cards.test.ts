// Card offers, rarity rolls, essence offers, card application and the modal lifecycle (cards.ts).

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import type { ContentDB, Rarity, StoneDef, UpgradeLine } from '../../data/schema';
import { DEFAULT_RUN_EVENTS, MAX_SKILL_RANK, RARITIES, RARITY_MULT } from '../../data/schema';
import { dictionaries } from '../../i18n/i18n';
import {
  BARGAINS,
  BARGAIN_IDS,
  PACED_FLAG,
  applyCard,
  buildEssenceOffer,
  bargainPace,
  bargainsTaken,
  buildOffer,
  freeChestsLeft,
  openBargain,
  openChest,
  openEssence,
  openLevelUp,
  openRunEnd,
  rollRarity,
  type BargainId,
  type OfferOpts,
} from '../cards';
import { DT, MAX_SKILL_SLOTS } from '../constants';
import { HealSource } from '../events';
import { addSkill } from '../skills';
import { stampHit } from '../skills/common';
import { buildResult, grantXp } from '../progress';
import { buildPlayerResult, decodeResult, encodeResult } from '../../net/coop/results';
import { hurtPlayer, HurtKind } from '../combat';
import { hud as buildHud } from '../hud';
import type { RunResult } from '../run';
import type { CoopPlayerInit } from '../run';
import { Rng } from '../rng';
import { boonCount, refreshStats } from '../stats';
import { spawnPickup } from '../pickups';
import { EnemyFlag, PickupKind, UPGRADE_STATS, type PassiveInstance, type PlayerState, type SkillInstance } from '../stores';
import type { Card, CardKind, ModalRequest } from '../types';
import { createWorld, type World } from '../world';
import { collect, findNonFinite, freezeSchedules, giveSkill, makeWorld, NO_INPUT, player, runTicks, spawn } from './helpers';

// ---------------------------------------------------------------------------
// helpers

const ri = (r: Rarity): number => RARITIES.indexOf(r);

const LEVEL_UP_KINDS: readonly CardKind[] = ['newSkill', 'skillUp', 'newPassive', 'passiveUp', 'heal', 'yeop'];
const ESSENCE_KINDS: readonly CardKind[] = ['stone', 'stoneUp', 'trinket', 'trinketUp', 'heal', 'yeop'];

function mkCard(over: Partial<Card> & Pick<Card, 'kind'>): Card {
  return { id: '', rarity: 'common', rank: 0, maxRank: 0, awakening: false, lines: [], amount: 0, slot: -1, replaces: null, ...over };
}

/** `n` consecutive offers from the same world (the cards rng advances between calls) */
function scan(w: World, p: PlayerState, n: number, opts: Partial<OfferOpts> = {}): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < n; i++) out.push(...buildOffer(w, p, { count: w.balance.cardsPerLevel, ...opts }));
  return out;
}

function scanEssence(w: World, p: PlayerState, n: number, awakened = false): Card[][] {
  const out: Card[][] = [];
  for (let i = 0; i < n; i++) out.push(buildEssenceOffer(w, p, awakened));
  return out;
}

function realIds(cards: readonly Card[]): string[] {
  return cards.map((c) => c.id).filter((id) => id !== '');
}

/** content tweak: only skill-up cards can be rolled (no passives, no free skill slot) */
function onlySkillUps(c: ContentDB): void {
  c.passives = [];
  c.balance.maxActiveSkills = 0;
}

/** content tweak: only new-passive / passive-up cards can be rolled */
function onlyPassives(c: ContentDB): void {
  c.balance.maxActiveSkills = 0;
}

function maxAllSkills(p: PlayerState): void {
  for (const s of p.skills) s.rank = MAX_SKILL_RANK;
}

function expectedLineValue(up: UpgradeLine, mult: number): number {
  const v = up.base * mult;
  return up.mode === 'flat' && (up.stat === 'count' || up.stat === 'pierce') ? Math.max(1, Math.round(v)) : v;
}

const COOP_HERO: CoopPlayerInit = { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', meta: { stats: {} } };

function coopWorld(): World {
  return makeWorld({ config: { coop: [COOP_HERO] } });
}

function modalOf(w: World): ModalRequest {
  const m = w.modal;
  if (!m) throw new Error('expected a pending modal');
  return m;
}

function cloneStone(base: StoneDef, id: string, over: Partial<StoneDef> = {}): StoneDef {
  return { ...structuredClone(base), id, ...over };
}

// ---------------------------------------------------------------------------
// rollRarity

describe('rollRarity', () => {
  const WEIGHTS: Record<Rarity, number> = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };

  function histogram(luck: number, floor = 0, n = 60000, seed = 99, weights: Record<Rarity, number> = WEIGHTS): number[] {
    const rng = new Rng(seed);
    const h = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const k = ri(rollRarity(rng, weights, luck, floor));
      h[k] = (h[k] ?? 0) + 1;
    }
    return h;
  }

  it('matches the configured weights at luck 0', () => {
    const n = 60000;
    const h = histogram(0, 0, n);
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    RARITIES.forEach((r, i) => {
      const p = WEIGHTS[r] / total;
      const sigma = Math.sqrt((p * (1 - p)) / n);
      expect(Math.abs((h[i] as number) / n - p), r).toBeLessThan(5 * sigma);
    });
  });

  it('shifts toward rarer tiers as luck rises: legendary/epic share up, common share down (monotonic)', () => {
    const luckLevels = [0, 0.1, 0.25, 0.5, 1, 2, 5];
    const n = 60000;
    const hs = luckLevels.map((l) => histogram(l, 0, n));
    for (let k = 1; k < hs.length; k++) {
      const prev = hs[k - 1] as number[];
      const cur = hs[k] as number[];
      expect(cur[0], `common share must fall at luck ${luckLevels[k]}`).toBeLessThan(prev[0] as number);
      expect(cur[3], `epic share must rise at luck ${luckLevels[k]}`).toBeGreaterThan(prev[3] as number);
      expect(cur[4], `legendary share must rise at luck ${luckLevels[k]}`).toBeGreaterThan(prev[4] as number);
    }
  });

  it('luck has a real effect: legendary share at luck 1 is at least double the luck-0 share', () => {
    const base = histogram(0, 0, 80000)[4] as number;
    const lucky = histogram(1, 0, 80000)[4] as number;
    expect(lucky).toBeGreaterThan(2 * base);
  });

  it('treats negative luck as zero luck', () => {
    expect(histogram(-3, 0, 20000)).toEqual(histogram(0, 0, 20000));
  });

  it('never returns a rarity below the floor, and still returns every tier at or above it', () => {
    for (let floor = 0; floor < RARITIES.length; floor++) {
      for (const luck of [0, 1]) {
        const h = histogram(luck, floor, 6000, 5);
        for (let i = 0; i < floor; i++) expect(h[i], `floor ${floor} luck ${luck} tier ${i}`).toBe(0);
        if (floor <= 3) for (let i = floor; i < RARITIES.length; i++) expect(h[i], `floor ${floor} tier ${i} reachable`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps relative weights above the floor (rare:epic:legendary ≈ 10:4:1 at luck 0, floor 2)', () => {
    const n = 60000;
    const h = histogram(0, 2, n);
    expect((h[2] as number) / n).toBeCloseTo(10 / 15, 1);
    expect((h[3] as number) / n).toBeCloseTo(4 / 15, 1);
    expect((h[4] as number) / n).toBeCloseTo(1 / 15, 1);
  });

  it('returns the floor tier when every eligible weight is zero (and clamps a floor past legendary)', () => {
    const rng = new Rng(3);
    const zero: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    expect(rollRarity(rng, zero, 0, 0)).toBe('common');
    expect(rollRarity(rng, zero, 2, 2)).toBe('rare');
    expect(rollRarity(rng, WEIGHTS, 0, 5)).toBe('legendary');
    expect(rollRarity(rng, WEIGHTS, 0, 9)).toBe('legendary');
  });

  it('never rolls a tier whose weight is zero', () => {
    const onlyUncommon: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 0, epic: 0, legendary: 0 };
    const rng = new Rng(8);
    for (let i = 0; i < 500; i++) expect(rollRarity(rng, onlyUncommon, 3, 0)).toBe('uncommon');
    const noLegend: Record<Rarity, number> = { ...WEIGHTS, legendary: 0 };
    for (let i = 0; i < 3000; i++) expect(rollRarity(rng, noLegend, 10, 0)).not.toBe('legendary');
  });

  it('is deterministic for a given seed', () => {
    expect(histogram(0.7, 1, 4000, 123)).toEqual(histogram(0.7, 1, 4000, 123));
  });
});

// ---------------------------------------------------------------------------
// buildOffer: structure and pools

describe('buildOffer pools', () => {
  it('opens cardsPerLevel cards and honours a changed cardsPerLevel', () => {
    for (const n of [1, 3, 4, 5]) {
      const w = makeWorld({ content: (c) => (c.balance.cardsPerLevel = n) });
      const m = openLevelUp(w, player(w), 2);
      expect(m.cards).toHaveLength(n);
    }
  });

  it('never offers duplicate ids (or two heal / two yeop fallbacks) within one offer', () => {
    const w = makeWorld();
    const p = player(w);
    for (let i = 0; i < 300; i++) {
      const offer = buildOffer(w, p, { count: 5 });
      expect(offer).toHaveLength(5);
      const ids = realIds(offer);
      expect(new Set(ids).size).toBe(ids.length);
      expect(offer.filter((c) => c.kind === 'heal').length).toBeLessThanOrEqual(1);
      expect(offer.filter((c) => c.kind === 'yeop').length).toBeLessThanOrEqual(1);
      for (const c of offer) expect(LEVEL_UP_KINDS).toContain(c.kind);
    }
  });

  it('honours opts.exclude', () => {
    const w = makeWorld();
    const p = player(w);
    const exclude = new Set(['bladewheel', 'fury_aura', 'lunge', 'sword_arc', 'haste', 'fury', 'holy_armor']);
    for (const c of scan(w, p, 200, { exclude })) expect(exclude.has(c.id)).toBe(false);
  });

  it('offers newSkill only from the doctrine list + common pool, never owned skills (doctrine a)', () => {
    const w = makeWorld();
    const p = player(w);
    const allowed = new Set(['bladewheel', 'fury_aura', 'lunge', 'aura_sword', 'war_leap', 'arc_of_might', 'will_to_live', 'venom_pool']);
    const seen = new Set<string>();
    for (const c of scan(w, p, 300)) if (c.kind === 'newSkill') seen.add(c.id);
    for (const id of seen) expect(allowed.has(id), id).toBe(true);
    // every allowed skill is reachable
    expect([...seen].sort()).toEqual([...allowed].sort());
  });

  it('offers newSkill only from the doctrine list + common pool (doctrine b)', () => {
    const w = makeWorld({ config: { doctrine: 'b' } });
    const p = player(w);
    const allowed = new Set([
      'sky_blades', 'chain_lightning', 'sword_circle', 'frost_cleave', 'phantom_blades', 'soul_beam',
      'arc_of_might', 'will_to_live', 'venom_pool',
    ]);
    const seen = new Set<string>();
    for (const c of scan(w, p, 300)) if (c.kind === 'newSkill') seen.add(c.id);
    expect([...seen].sort()).toEqual([...allowed].sort());
  });

  it('ignores non-active and unknown ids that appear in the doctrine list', () => {
    const w = makeWorld({
      content: (c) => {
        const cls = c.classes[0];
        cls?.doctrines[0].skills.push('spirit_bolt', 'no_such_skill');
      },
    });
    const p = player(w);
    for (const c of scan(w, p, 300)) {
      expect(c.id).not.toBe('spirit_bolt');
      expect(c.id).not.toBe('no_such_skill');
    }
  });

  it('stops offering newSkill once active slots reach maxActiveSkills (basics and ultimates do not count)', () => {
    const w = makeWorld({
      content: (c) => {
        c.balance.maxActiveSkills = 3;
        const leap = c.skills.find((s) => s.id === 'war_leap');
        if (leap) leap.kind = 'ultimate';
      },
    });
    const p = player(w);
    const hasNew = (): boolean => scan(w, p, 150).some((c) => c.kind === 'newSkill');
    // sword_arc (basic) + lightning_trio (active) = 1 active slot
    expect(hasNew()).toBe(true);
    // an ultimate does not take an active slot
    giveSkill(w, 'war_leap');
    expect(p.skills.find((s) => s.def.id === 'war_leap')?.ultimate).toBe(true);
    expect(hasNew()).toBe(true);
    giveSkill(w, 'bladewheel');
    expect(hasNew()).toBe(true);
    for (const c of scan(w, p, 150)) if (c.kind === 'newSkill') expect(['bladewheel', 'war_leap', 'lightning_trio']).not.toContain(c.id);
    giveSkill(w, 'fury_aura'); // third active
    const full = scan(w, p, 300);
    expect(full.some((c) => c.kind === 'newSkill')).toBe(false);
    // the owned skills still level up
    expect(full.some((c) => c.kind === 'skillUp')).toBe(true);
  });

  it('never offers banished skills (new or rank-up), banished passives, or common-pool skills', () => {
    const w = makeWorld();
    const p = player(w);
    for (const id of ['bladewheel', 'sword_arc', 'haste', 'arc_of_might', 'fury']) p.banished.add(id);
    const cards = scan(w, p, 400);
    for (const c of cards) expect(p.banished.has(c.id), `${c.kind}:${c.id}`).toBe(false);
    // the other pool entries are unaffected
    expect(cards.some((c) => c.id === 'lightning_trio' && c.kind === 'skillUp')).toBe(true);
    expect(cards.some((c) => c.id === 'fury_aura')).toBe(true);
  });

  it('draws the rarity of every card from the weights shifted by luck, never below rarityFloor', () => {
    const w = makeWorld();
    const p = player(w);
    for (const floor of [1, 2, 3, 4]) {
      for (const c of scan(w, p, 80, { rarityFloor: floor })) expect(ri(c.rarity)).toBeGreaterThanOrEqual(floor);
    }
    // high luck yields more epic+ cards than none
    const lucky = makeWorld({ config: { meta: { stats: { luck: 2 } } } });
    const plain = makeWorld();
    const epicPlus = (x: World): number => scan(x, player(x), 400).filter((c) => ri(c.rarity) >= 3).length;
    expect(player(lucky).stats.luck).toBeCloseTo(2);
    expect(epicPlus(lucky)).toBeGreaterThan(epicPlus(plain) * 2);
  });

  it('rolls an offer deterministically for a fixed seed', () => {
    const offerOf = (seed: number): string => {
      const w = makeWorld({ config: { seed } });
      return JSON.stringify(buildOffer(w, player(w), { count: 3 }));
    };
    expect(offerOf(77)).toBe(offerOf(77));
    expect(offerOf(77)).not.toBe(offerOf(78));
  });
});

// ---------------------------------------------------------------------------
// buildOffer: skill cards

describe('skill cards', () => {
  it('skillUp rolls 1/1/2/2/3 distinct lines for common..legendary, scaled by RARITY_MULT', () => {
    const w = makeWorld({ content: onlySkillUps });
    const p = player(w);
    const byRarity = new Map<Rarity, Card[]>();
    for (const floor of [0, 3, 4]) {
      for (const c of scan(w, p, 120, { rarityFloor: floor })) {
        if (c.kind !== 'skillUp') continue;
        byRarity.set(c.rarity, [...(byRarity.get(c.rarity) ?? []), c]);
      }
    }
    for (const r of RARITIES) expect(byRarity.get(r)?.length ?? 0, `${r} skillUp cards seen`).toBeGreaterThan(0);
    for (const [rarity, cards] of byRarity) {
      const mult = RARITY_MULT[rarity];
      const nLines = 1 + Math.floor(ri(rarity) / 2);
      for (const c of cards) {
        const def = w.ix.skills.get(c.id);
        expect(def).toBeDefined();
        expect(c.lines).toHaveLength(nLines);
        expect(new Set(c.lines.map((l) => `${l.stat}:${l.mode}`)).size).toBe(nLines);
        for (const line of c.lines) {
          const up = def?.upgrades.find((u) => u.stat === line.stat && u.mode === line.mode);
          expect(up, `${c.id}:${line.stat} must come from the skill's upgrade pool`).toBeDefined();
          expect(line.mode).toBe((up as UpgradeLine).mode);
          expect(line.value).toBeCloseTo(expectedLineValue(up as UpgradeLine, mult), 9);
        }
      }
    }
  });

  it('flat count/pierce lines are rounded (min 1) after the rarity multiplier', () => {
    const w = makeWorld({
      content: (c) => {
        onlySkillUps(c);
        // only flat integer lines in the pool so that every roll exercises the rounding
        for (const s of c.skills) if (s.id === 'sword_arc' || s.id === 'lightning_trio') s.upgrades = [{ stat: 'count', base: 1, mode: 'flat' }, { stat: 'pierce', base: 1, mode: 'flat' }];
      },
    });
    const p = player(w);
    const expected: Record<Rarity, number> = { common: 1, uncommon: 1, rare: 2, epic: 2, legendary: 3 }; // 1 × {1, 1.35, 1.7, 2.1, 2.6}, rounded
    const seen = new Set<Rarity>();
    for (const floor of [0, 3, 4]) {
      for (const c of scan(w, p, 80, { rarityFloor: floor })) {
        if (c.kind !== 'skillUp') continue;
        seen.add(c.rarity);
        for (const line of c.lines) {
          expect(Number.isInteger(line.value)).toBe(true);
          expect(line.value).toBe(expected[c.rarity]);
        }
      }
    }
    expect(seen.size).toBe(RARITIES.length);
  });

  it('pct lines are not rounded and cooldown/tick lines stay positive ("reduce by")', () => {
    const w = makeWorld({ content: onlySkillUps });
    const p = player(w);
    for (const c of scan(w, p, 150, { rarityFloor: 4 })) {
      if (c.kind !== 'skillUp') continue;
      for (const line of c.lines) {
        expect(line.value).toBeGreaterThan(0);
        if (line.mode === 'pct') {
          const up = w.ix.skills.get(c.id)?.upgrades.find((u) => u.stat === line.stat && u.mode === line.mode) as UpgradeLine;
          expect(line.value).toBeCloseTo(up.base * RARITY_MULT.legendary, 9);
        }
      }
    }
  });

  it('skillUp cards carry the next rank, the skill slot and the rank cap; awakening only on rank 6 → 7', () => {
    const w = makeWorld({ content: onlySkillUps });
    const p = player(w);
    const arc = p.skills.find((s) => s.def.id === 'sword_arc');
    const cut = p.skills.find((s) => s.def.id === 'lightning_trio');
    if (!arc || !cut) throw new Error('starting skills missing');
    arc.rank = 6;
    cut.rank = 5;
    const cards = scan(w, p, 60).filter((c) => c.kind === 'skillUp');
    const arcCards = cards.filter((c) => c.id === 'sword_arc');
    const cutCards = cards.filter((c) => c.id === 'lightning_trio');
    expect(arcCards.length).toBeGreaterThan(0);
    expect(cutCards.length).toBeGreaterThan(0);
    for (const c of arcCards) {
      expect(c.rank).toBe(7);
      expect(c.maxRank).toBe(MAX_SKILL_RANK);
      expect(c.awakening).toBe(true);
      expect(c.slot).toBe(arc.slot);
      expect(c.replaces).toBeNull();
    }
    for (const c of cutCards) {
      expect(c.rank).toBe(6);
      expect(c.awakening).toBe(false);
      expect(c.slot).toBe(cut.slot);
    }
  });

  it('a skill at the maximum rank (P) is not offered again; maxing everything leaves only fallbacks', () => {
    const w = makeWorld({ content: onlySkillUps });
    const p = player(w);
    const arc = p.skills.find((s) => s.def.id === 'sword_arc');
    if (arc) arc.rank = MAX_SKILL_RANK;
    const cards = scan(w, p, 60);
    expect(cards.some((c) => c.id === 'sword_arc')).toBe(false);
    expect(cards.some((c) => c.id === 'lightning_trio' && c.kind === 'skillUp')).toBe(true);
    maxAllSkills(p);
    for (const c of scan(w, p, 40)) expect(['heal', 'yeop']).toContain(c.kind);
  });

  it('newSkill cards start at rank 0 with no awakening and (rare+) bonus lines: 0/0/1/1/2 lines', () => {
    const w = makeWorld({
      content: (c) => {
        c.passives = [];
        c.balance.maxActiveSkills = 6;
      },
    });
    const p = player(w);
    maxAllSkills(p); // no skillUp noise: only newSkill cards can be rolled
    const seen = new Set<Rarity>();
    for (const floor of [0, 2, 3, 4]) {
      for (const c of scan(w, p, 80, { rarityFloor: floor })) {
        if (c.kind !== 'newSkill') continue;
        seen.add(c.rarity);
        expect(c.rank).toBe(0);
        expect(c.maxRank).toBe(MAX_SKILL_RANK);
        expect(c.awakening).toBe(false);
        expect(c.slot).toBe(-1);
        expect(c.replaces).toBeNull();
        expect(c.lines).toHaveLength(Math.floor(ri(c.rarity) / 2));
        const def = w.ix.skills.get(c.id);
        for (const line of c.lines) {
          const up = def?.upgrades.find((u) => u.stat === line.stat && u.mode === line.mode) as UpgradeLine;
          expect(line.value).toBeCloseTo(expectedLineValue(up, RARITY_MULT[c.rarity]), 9);
        }
      }
    }
    expect(seen.size).toBe(RARITIES.length);
  });
});

// ---------------------------------------------------------------------------
// buildOffer: passives and fallbacks

describe('passive cards', () => {
  it('newPassive: rank 1, maxRank from the def, lines = perRank × RARITY_MULT (armor flat, pct otherwise)', () => {
    const w = makeWorld({ content: onlyPassives });
    const p = player(w);
    maxAllSkills(p);
    const seen = new Set<string>();
    const rarities = new Set<Rarity>();
    for (const floor of [0, 3, 4]) {
      for (const c of scan(w, p, 80, { rarityFloor: floor })) {
        if (c.kind !== 'newPassive') continue;
        seen.add(c.id);
        rarities.add(c.rarity);
        const def = w.ix.passives.get(c.id);
        if (!def) throw new Error(`unknown passive ${c.id}`);
        expect(c.rank).toBe(1);
        expect(c.maxRank).toBe(def.maxRank);
        expect(c.awakening).toBe(false);
        const stats = Object.keys(def.perRank);
        expect(c.lines.map((l) => l.stat).sort()).toEqual(stats.sort());
        for (const line of c.lines) {
          const base = Object.entries(def.perRank).find(([stat]) => stat === line.stat)?.[1];
          expect(typeof base).toBe('number');
          expect(line.value).toBeCloseTo(Number(base) * RARITY_MULT[c.rarity], 9);
          if (line.stat === 'armor') expect(line.mode).toBe('flat');
          if (line.stat === 'maxHpPct') expect(line.mode).toBe('pct');
        }
      }
    }
    expect(seen.size).toBe(8); // every fixture passive is reachable
    expect(rarities.size).toBe(RARITIES.length);
  });

  it('passiveUp: next rank, scaled lines; maxed passives are not offered', () => {
    const w = makeWorld({ content: onlyPassives });
    const p = player(w);
    maxAllSkills(p);
    p.passives.push({ id: 'haste', rank: 2, power: 2 }, { id: 'holy_armor', rank: 5, power: 5 });
    p.banished.add('sovereign_blood');
    const cards = scan(w, p, 200, { rarityFloor: 2 });
    const ups = cards.filter((c) => c.kind === 'passiveUp');
    expect(ups.length).toBeGreaterThan(0);
    for (const c of ups) {
      expect(c.id).toBe('haste');
      expect(c.rank).toBe(3);
      expect(c.maxRank).toBe(5);
      expect(c.lines).toHaveLength(1);
      expect(c.lines[0]?.stat).toBe('moveSpeed');
      expect(c.lines[0]?.value).toBeCloseTo(0.04 * RARITY_MULT[c.rarity], 9);
    }
    expect(cards.some((c) => c.id === 'holy_armor')).toBe(false);
    // owned passives are never offered as new
    expect(cards.some((c) => c.kind === 'newPassive' && (c.id === 'haste' || c.id === 'holy_armor'))).toBe(false);
  });

  it('respects maxPassives: a full passive bag only gets rank-ups, never new passives', () => {
    const w = makeWorld({
      content: (c) => {
        onlyPassives(c);
        c.balance.maxPassives = 2;
      },
    });
    const p = player(w);
    maxAllSkills(p);
    expect(scan(w, p, 60).some((c) => c.kind === 'newPassive')).toBe(true);
    p.passives.push({ id: 'haste', rank: 1, power: 1 }, { id: 'fury', rank: 5, power: 5 });
    const cards = scan(w, p, 120);
    expect(cards.some((c) => c.kind === 'newPassive')).toBe(false);
    expect(cards.some((c) => c.kind === 'passiveUp' && c.id === 'haste')).toBe(true);
    // fury is maxed, so nothing else from the passive pool is possible
    expect(cards.filter((c) => c.id !== '' && c.id !== 'haste')).toHaveLength(0);
  });
});

describe('fallback cards', () => {
  function emptyPoolWorld(extra?: (c: ContentDB) => void): World {
    const w = makeWorld({
      content: (c) => {
        onlySkillUps(c);
        extra?.(c);
      },
    });
    maxAllSkills(player(w));
    return w;
  }

  it('offers exactly one heal then one yeop when every pool is empty (offer shrinks below count)', () => {
    const w = emptyPoolWorld();
    const p = player(w);
    for (let i = 0; i < 20; i++) {
      const offer = buildOffer(w, p, { count: 3 });
      expect(offer.map((c) => c.kind)).toEqual(['heal', 'yeop']);
    }
    expect(buildOffer(w, p, { count: 1 }).map((c) => c.kind)).toEqual(['heal']);
    expect(buildOffer(w, p, { count: 5 }).map((c) => c.kind)).toEqual(['heal', 'yeop']);
  });

  it('fills the remaining slots of a partially full pool with heal first, then yeop', () => {
    const w = makeWorld({ content: onlySkillUps });
    const p = player(w); // pool: 2 skillUps (sword_arc, lightning_trio)
    for (let i = 0; i < 20; i++) {
      const offer = buildOffer(w, p, { count: 4 });
      expect(offer.map((c) => c.kind)).toEqual(['skillUp', 'skillUp', 'heal', 'yeop']);
    }
    expect(buildOffer(w, p, { count: 3 }).map((c) => c.kind)).toEqual(['skillUp', 'skillUp', 'heal']);
  });

  it('heal amount = min(1, 0.25 × rarity multiplier) of max hp; yeop = round((30 + 6 × level) × multiplier)', () => {
    const w = emptyPoolWorld();
    const p = player(w);
    p.level = 7;
    const rarities = new Set<Rarity>();
    for (const floor of [0, 2, 3, 4]) {
      for (let i = 0; i < 60; i++) {
        for (const c of buildOffer(w, p, { count: 2, rarityFloor: floor })) {
          rarities.add(c.rarity);
          const mult = RARITY_MULT[c.rarity];
          if (c.kind === 'heal') expect(c.amount).toBeCloseTo(Math.min(1, 0.25 * mult), 9);
          else expect(c.amount).toBe(Math.round((30 + 6 * 7) * mult));
          expect(c.id).toBe('');
          expect(c.lines).toEqual([]);
          expect(c.slot).toBe(-1);
          expect(c.replaces).toBeNull();
        }
      }
    }
    expect(rarities.size).toBe(RARITIES.length);
  });

  it('fallback cards respect the rarity floor as well', () => {
    const w = emptyPoolWorld();
    for (const c of buildOffer(w, player(w), { count: 2, rarityFloor: 3 })) expect(ri(c.rarity)).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// applyCard

describe('applyCard', () => {
  it('newSkill adds the skill at rank 0 and accumulates the rolled lines', () => {
    const w = makeWorld();
    const p = player(w);
    const before = p.skills.length;
    applyCard(
      w,
      p,
      mkCard({
        kind: 'newSkill',
        id: 'bladewheel',
        rarity: 'epic',
        maxRank: MAX_SKILL_RANK,
        lines: [
          { stat: 'damage', mode: 'pct', value: 0.3 },
          { stat: 'count', mode: 'flat', value: 2 },
        ],
      }),
    );
    expect(p.skills).toHaveLength(before + 1);
    const s = p.skills[p.skills.length - 1];
    expect(s?.def.id).toBe('bladewheel');
    expect(s?.rank).toBe(0);
    expect(s?.owner).toBe(0);
    expect(w.skillSlots[s?.slot ?? -1]).toBe(s);
    expect(s?.upg[UPGRADE_STATS.indexOf('damage')]?.pct).toBeCloseTo(0.3);
    expect(s?.upg[UPGRADE_STATS.indexOf('count')]?.flat).toBe(2);
  });

  it('skillUp sets the rank (capped at P) and accumulates pct and flat lines', () => {
    const w = makeWorld();
    const p = player(w);
    const s = giveSkill(w, 'bladewheel', 2);
    const card = mkCard({
      kind: 'skillUp',
      id: 'bladewheel',
      rank: 3,
      maxRank: MAX_SKILL_RANK,
      slot: s.slot,
      lines: [
        { stat: 'damage', mode: 'pct', value: 0.15 },
        { stat: 'cooldown', mode: 'pct', value: 0.1 },
        { stat: 'count', mode: 'flat', value: 1 },
      ],
    });
    applyCard(w, p, card);
    expect(s.rank).toBe(3);
    applyCard(w, p, card);
    expect(s.upg[UPGRADE_STATS.indexOf('damage')]?.pct).toBeCloseTo(0.3);
    expect(s.upg[UPGRADE_STATS.indexOf('cooldown')]?.pct).toBeCloseTo(0.2);
    expect(s.upg[UPGRADE_STATS.indexOf('count')]?.flat).toBe(2);
    applyCard(w, p, mkCard({ kind: 'skillUp', id: 'bladewheel', rank: 12, slot: s.slot }));
    expect(s.rank).toBe(MAX_SKILL_RANK);
  });

  it('skillUp for a rank-6 skill awakens it (rank P, cardPick awakening + awaken sfx)', () => {
    const w = makeWorld({ content: onlySkillUps });
    const p = player(w);
    const arc = p.skills.find((s) => s.def.id === 'sword_arc');
    if (!arc) throw new Error('missing basic');
    arc.rank = 6;
    const card = scan(w, p, 50).find((c) => c.id === 'sword_arc' && c.kind === 'skillUp');
    expect(card?.awakening).toBe(true);
    w.bus.clear();
    applyCard(w, p, card as Card);
    expect(arc.rank).toBe(MAX_SKILL_RANK);
    const pick = w.events.find((e) => e.t === 'cardPick');
    expect(pick).toMatchObject({ t: 'cardPick', kind: 'skillUp', id: 'sword_arc', rank: 7, awakening: true });
    expect(w.events.some((e) => e.t === 'sfx' && e.id === 'sfx_awaken')).toBe(true);
  });

  it('skillUp ignores a card whose slot belongs to another player', () => {
    const w = coopWorld();
    const p0 = player(w, 0);
    const p1 = player(w, 1);
    const s0 = giveSkill(w, 'bladewheel', 1, 0);
    applyCard(w, p1, mkCard({ kind: 'skillUp', id: 'bladewheel', rank: 2, slot: s0.slot, lines: [{ stat: 'damage', mode: 'pct', value: 0.5 }] }));
    expect(s0.rank).toBe(1);
    expect(s0.upg[0]?.pct).toBe(0);
    applyCard(w, p0, mkCard({ kind: 'skillUp', id: 'bladewheel', rank: 2, slot: s0.slot }));
    expect(s0.rank).toBe(2);
  });

  it('newPassive adds a rank-1 instance with power = RARITY_MULT and the stats follow after a refresh', () => {
    const w = makeWorld();
    const p = player(w);
    const baseArmor = p.stats.armor;
    applyCard(w, p, mkCard({ kind: 'newPassive', id: 'holy_armor', rarity: 'rare', rank: 1, maxRank: 5 }));
    expect(p.passives).toEqual([{ id: 'holy_armor', rank: 1, power: RARITY_MULT.rare }]);
    expect(p.statsDirty).toBe(true);
    refreshStats(p, w.content, w.ix);
    expect(p.stats.armor).toBeCloseTo(baseArmor + 6 * RARITY_MULT.rare, 6);
  });

  it('passiveUp raises the rank and accumulates power (Σ RARITY_MULT of the picked cards)', () => {
    const w = makeWorld();
    const p = player(w);
    const baseArmor = p.stats.armor;
    applyCard(w, p, mkCard({ kind: 'newPassive', id: 'holy_armor', rarity: 'common', rank: 1, maxRank: 5 }));
    applyCard(w, p, mkCard({ kind: 'passiveUp', id: 'holy_armor', rarity: 'rare', rank: 2, maxRank: 5 }));
    applyCard(w, p, mkCard({ kind: 'passiveUp', id: 'holy_armor', rarity: 'legendary', rank: 3, maxRank: 5 }));
    const inst = p.passives[0];
    expect(inst?.rank).toBe(3);
    expect(inst?.power).toBeCloseTo(RARITY_MULT.common + RARITY_MULT.rare + RARITY_MULT.legendary, 9);
    refreshStats(p, w.content, w.ix);
    expect(p.stats.armor).toBeCloseTo(baseArmor + 6 * (1 + 1.7 + 2.6), 6);
    expect(p.passives).toHaveLength(1);
  });

  it('passiveUp for a passive the player does not own is a no-op', () => {
    const w = makeWorld();
    const p = player(w);
    applyCard(w, p, mkCard({ kind: 'passiveUp', id: 'haste', rarity: 'epic', rank: 2, maxRank: 5 }));
    expect(p.passives).toEqual([]);
  });

  it('heal restores a fraction of max hp (clamped) and reports a Card heal event', () => {
    const w = makeWorld();
    const p = player(w);
    p.hp = 20;
    w.bus.clear();
    applyCard(w, p, mkCard({ kind: 'heal', amount: 0.25 }));
    expect(p.hp).toBeCloseTo(20 + 0.25 * p.hpMax, 6);
    const ev = w.events.find((e) => e.t === 'heal');
    expect(ev).toMatchObject({ t: 'heal', player: 0, source: HealSource.Card });
    applyCard(w, p, mkCard({ kind: 'heal', amount: 1 }));
    expect(p.hp).toBe(p.hpMax);
  });

  it('yeop adds to the purse and to the earned total', () => {
    const w = makeWorld();
    const p = player(w);
    p.yeop = 10;
    p.yeopEarned = 10;
    applyCard(w, p, mkCard({ kind: 'yeop', amount: 44 }));
    expect(p.yeop).toBe(54);
    expect(p.yeopEarned).toBe(54);
  });

  it('stone / stoneUp write the slot with the card rank as the level and mark the stats dirty', () => {
    const w = makeWorld();
    const p = player(w);
    applyCard(w, p, mkCard({ kind: 'stone', id: 'piercing', rank: 1, maxRank: 4, slot: 1 }));
    expect(p.stones[1]).toEqual({ id: 'piercing', level: 1 });
    expect(p.statsDirty).toBe(true);
    refreshStats(p, w.content, w.ix);
    expect(p.stats.damage).toBeCloseTo(1 + 0.04 * 2, 6); // perLevel × (level + 1)
    expect(p.stats.pierce).toBe(2);
    applyCard(w, p, mkCard({ kind: 'stoneUp', id: 'piercing', rank: 3, maxRank: 4, slot: 1 }));
    expect(p.stones[1]).toEqual({ id: 'piercing', level: 3 });
    refreshStats(p, w.content, w.ix);
    expect(p.stats.damage).toBeCloseTo(1 + 0.04 * 4, 6);
    // replacing: a different stone overwrites the slot
    applyCard(w, p, mkCard({ kind: 'stone', id: 'deadly', rank: 0, maxRank: 4, slot: 1, replaces: { kind: 'stone', id: 'piercing', level: 3, slot: 1 } }));
    expect(p.stones[1]).toEqual({ id: 'deadly', level: 0 });
    expect(p.stones.filter((s) => s !== null)).toHaveLength(1);
  });

  it('trinket / trinketUp write the slot with the card rank and mark the stats dirty', () => {
    const w = makeWorld();
    const p = player(w);
    applyCard(w, p, mkCard({ kind: 'trinket', id: 'shield', rank: 2, maxRank: 3, slot: 2 }));
    expect(p.trinkets[2]).toEqual({ id: 'shield', rank: 2 });
    refreshStats(p, w.content, w.ix);
    expect(p.stats.shieldMax).toBe(24);
    applyCard(w, p, mkCard({ kind: 'trinketUp', id: 'shield', rank: 3, maxRank: 3, slot: 2 }));
    expect(p.trinkets[2]).toEqual({ id: 'shield', rank: 3 });
    refreshStats(p, w.content, w.ix);
    expect(p.stats.shieldMax).toBe(36);
    expect(p.trinkets[0]).toBeNull();
    expect(p.trinkets[1]).toBeNull();
  });

  it('records the last pick rarity and emits cardPick + the pick sfx', () => {
    const w = makeWorld();
    const p = player(w);
    w.bus.clear();
    applyCard(w, p, mkCard({ kind: 'yeop', rarity: 'epic', amount: 5, rank: 0 }));
    expect(p.lastPickRarity).toBe('epic');
    expect(w.events.find((e) => e.t === 'cardPick')).toMatchObject({ player: 0, kind: 'yeop', id: '', rarity: 'epic', rank: 0, awakening: false });
    expect(w.events.some((e) => e.t === 'sfx' && e.id === 'sfx_card_pick')).toBe(true);
  });

  it('a picked passive is visible in the player stats after the next tick (statsDirty path)', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const p = player(w);
    const speed = p.stats.moveSpeed;
    applyCard(w, p, mkCard({ kind: 'newPassive', id: 'haste', rarity: 'common', rank: 1, maxRank: 5 }));
    runTicks(w, 1);
    expect(p.statsDirty).toBe(false);
    expect(p.stats.moveSpeed).toBeCloseTo(speed * 1.04, 6);
  });
});

// ---------------------------------------------------------------------------
// essence offers (spirit stones / trinkets)

describe('essence offers', () => {
  it('only stone/trinket cards (or fallbacks), unique ids, rarity floor uncommon (rare when awakened)', () => {
    const w = makeWorld();
    const p = player(w);
    for (const awakened of [false, true]) {
      const floor = awakened ? 2 : 1;
      const kinds = new Set<CardKind>();
      for (const offer of scanEssence(w, p, 150, awakened)) {
        expect(offer).toHaveLength(3);
        const ids = realIds(offer);
        expect(new Set(ids).size).toBe(ids.length);
        for (const c of offer) {
          expect(ESSENCE_KINDS).toContain(c.kind);
          expect(ri(c.rarity)).toBeGreaterThanOrEqual(floor);
          kinds.add(c.kind);
        }
      }
      expect(kinds.has('stone')).toBe(true);
      expect(kinds.has('trinket')).toBe(true);
    }
  });

  it('honours the card count argument', () => {
    const w = makeWorld();
    const p = player(w);
    expect(buildEssenceOffer(w, p, false, 2)).toHaveLength(2);
    expect(buildEssenceOffer(w, p, false, 5)).toHaveLength(5);
  });

  it('new stones go into the first free slot of their range (weapon 0-2, armor 3-5) without replacing anything', () => {
    const w = makeWorld({ content: (c) => (c.trinkets = []) });
    const p = player(w);
    const kinds = new Set<string>();
    for (const offer of scanEssence(w, p, 120)) {
      for (const c of offer) {
        if (c.kind === 'heal' || c.kind === 'yeop') continue;
        const def = w.ix.stones.get(c.id);
        expect(def).toBeDefined();
        expect(c.kind).toBe('stone');
        expect(c.slot).toBe(def?.slot === 'weapon' ? 0 : 3);
        expect(c.replaces).toBeNull();
        expect(c.rank).toBe(Math.min(def?.maxLevel ?? 0, ri(c.rarity)));
        expect(c.maxRank).toBe(def?.maxLevel);
        expect(c.lines.length).toBeGreaterThan(0);
        kinds.add(c.id);
      }
    }
    expect(kinds.size).toBe(5);
  });

  it('stone lines show perLevel × (level + 1)', () => {
    const w = makeWorld({ content: (c) => (c.trinkets = []) });
    const p = player(w);
    for (const offer of scanEssence(w, p, 120, true)) {
      for (const c of offer) {
        if (c.id !== 'piercing') continue;
        expect(c.lines.find((l) => l.stat === 'damage')?.value).toBeCloseTo(0.04 * (c.rank + 1), 9);
        expect(c.lines.find((l) => l.stat === 'pierce')?.value).toBeCloseTo(1 * (c.rank + 1), 9);
        expect(c.lines.find((l) => l.stat === 'pierce')?.mode).toBe('flat');
      }
    }
  });

  it('later stones use the next free slot; an owned stone becomes a stoneUp for its own slot', () => {
    const w = makeWorld({ content: (c) => (c.trinkets = []) });
    const p = player(w);
    p.stones[0] = { id: 'piercing', level: 1 };
    p.stones[3] = { id: 'evasion', level: 0 };
    const seen = new Set<string>();
    for (const offer of scanEssence(w, p, 200)) {
      for (const c of offer) {
        if (c.kind === 'heal' || c.kind === 'yeop') continue;
        seen.add(`${c.id}:${c.kind}:${c.slot}`);
        if (c.id === 'piercing') {
          expect(c.kind).toBe('stoneUp');
          expect(c.slot).toBe(0);
          expect(c.rank).toBe(Math.min(4, Math.max(2, ri(c.rarity))));
          expect(c.replaces).toBeNull();
        } else if (c.id === 'evasion') {
          expect(c.kind).toBe('stoneUp');
          expect(c.slot).toBe(3);
          expect(c.rank).toBe(Math.min(4, Math.max(1, ri(c.rarity))));
        } else if (c.id === 'life') {
          expect(c.kind).toBe('stone');
          expect(c.slot).toBe(4);
          expect(c.replaces).toBeNull();
        } else {
          expect(c.kind).toBe('stone');
          expect(c.slot).toBe(1);
          expect(c.replaces).toBeNull();
        }
      }
    }
    expect([...seen].sort()).toEqual(
      ['beast_hunter:stone:1', 'deadly:stone:1', 'evasion:stoneUp:3', 'life:stone:4', 'piercing:stoneUp:0'].sort(),
    );
  });

  it('a stone at its max level is not offered again', () => {
    const w = makeWorld({ content: (c) => (c.trinkets = []) });
    const p = player(w);
    p.stones[0] = { id: 'piercing', level: 4 };
    for (const offer of scanEssence(w, p, 150)) for (const c of offer) expect(c.id).not.toBe('piercing');
  });

  it('a full slot range offers a replacement of the weakest stone, with `replaces` filled in', () => {
    const w = makeWorld({
      content: (c) => {
        c.trinkets = [];
        const base = c.stones[0] as StoneDef;
        c.stones = c.stones.filter((s) => s.slot === 'weapon');
        c.stones.push(cloneStone(base, 'extra_stone', { perLevel: { damage: 0.05 } }));
      },
    });
    const p = player(w);
    p.stones[0] = { id: 'piercing', level: 2 };
    p.stones[1] = { id: 'deadly', level: 0 }; // weakest
    p.stones[2] = { id: 'beast_hunter', level: 3 };
    const shapes = new Set<string>();
    for (const offer of scanEssence(w, p, 150)) {
      expect(offer).toHaveLength(3);
      for (const c of offer) {
        if (c.id === 'extra_stone') {
          expect(c.kind).toBe('stone');
          expect(c.slot).toBe(1);
          expect(c.replaces).toEqual({ kind: 'stone', id: 'deadly', level: 0, slot: 1 });
          expect(c.rank).toBe(Math.min(4, ri(c.rarity)));
          shapes.add('replace');
        } else {
          expect(c.kind).toBe('stoneUp');
          expect(c.replaces).toBeNull();
          const slot = p.stones.findIndex((s) => s?.id === c.id);
          expect(c.slot).toBe(slot);
          const cur = p.stones[slot]?.level ?? 0;
          expect(c.rank).toBe(Math.min(4, Math.max(cur + 1, ri(c.rarity))));
          shapes.add(`up${slot}`);
        }
      }
    }
    expect([...shapes].sort()).toEqual(['replace', 'up0', 'up1', 'up2']);
  });

  it('picking a replace card swaps the stone in the slot and updates the stats', () => {
    const w = makeWorld({
      content: (c) => {
        c.trinkets = [];
        const base = c.stones[0] as StoneDef;
        c.stones = c.stones.filter((s) => s.slot === 'weapon');
        c.stones.push(cloneStone(base, 'extra_stone', { perLevel: { damage: 0.05 } }));
      },
    });
    const p = player(w);
    p.stones[0] = { id: 'piercing', level: 3 };
    p.stones[1] = { id: 'deadly', level: 1 };
    p.stones[2] = { id: 'beast_hunter', level: 3 };
    let card: Card | undefined;
    for (let i = 0; i < 100 && !card; i++) card = buildEssenceOffer(w, p, true).find((c) => c.id === 'extra_stone');
    expect(card?.replaces).toEqual({ kind: 'stone', id: 'deadly', level: 1, slot: 1 });
    applyCard(w, p, card as Card);
    expect(p.stones[1]?.id).toBe('extra_stone');
    expect(p.stones[1]?.level).toBe(card?.rank);
    expect(p.stones[0]?.id).toBe('piercing');
    expect(p.stones[2]?.id).toBe('beast_hunter');
  });

  it('new trinkets land in their slot (bracelet 0, necklace 1, earring 2); rank follows rarity 1/1/2/2/3', () => {
    const w = makeWorld({ content: (c) => (c.stones = []) });
    const p = player(w);
    const slotOf: Record<string, number> = { bracelet: 0, necklace: 1, earring: 2 };
    const rankOf: Record<Rarity, number> = { common: 1, uncommon: 1, rare: 2, epic: 2, legendary: 3 };
    const rarities = new Set<Rarity>();
    const ids = new Set<string>();
    for (const awakened of [false, true]) {
      for (const offer of scanEssence(w, p, 150, awakened)) {
        for (const c of offer) {
          if (c.kind === 'heal' || c.kind === 'yeop') continue;
          const def = w.ix.trinkets.get(c.id);
          expect(c.kind).toBe('trinket');
          expect(c.slot).toBe(slotOf[def?.slot ?? 'bracelet']);
          expect(c.replaces).toBeNull();
          expect(c.rank).toBe(Math.min(def?.maxRank ?? 0, rankOf[c.rarity]));
          expect(c.maxRank).toBe(def?.maxRank);
          rarities.add(c.rarity);
          ids.add(c.id);
        }
      }
    }
    expect(ids.size).toBe(6);
    expect(rarities.size).toBeGreaterThanOrEqual(4);
  });

  it('trinket in the same slot: same id → trinketUp (+1 rank, +2 at epic+), other id → replace', () => {
    const w = makeWorld({ content: (c) => (c.stones = []) });
    const p = player(w);
    p.trinkets[0] = { id: 'lifesteal', rank: 1 };
    const seen = new Set<string>();
    for (const offer of scanEssence(w, p, 200)) {
      for (const c of offer) {
        if (c.kind === 'heal' || c.kind === 'yeop') continue;
        const def = w.ix.trinkets.get(c.id);
        if (c.id === 'lifesteal') {
          expect(c.kind).toBe('trinketUp');
          expect(c.slot).toBe(0);
          expect(c.rank).toBe(Math.min(3, 1 + 1 + (ri(c.rarity) >= 3 ? 1 : 0)));
          expect(c.replaces).toBeNull();
          seen.add('up');
        } else if (c.id === 'thorns') {
          expect(c.kind).toBe('trinket');
          expect(c.slot).toBe(0);
          expect(c.replaces).toEqual({ kind: 'trinket', id: 'lifesteal', level: 1, slot: 0 });
          seen.add('replace');
        } else {
          expect(def?.slot).not.toBe('bracelet');
          expect(c.replaces).toBeNull();
        }
      }
    }
    expect([...seen].sort()).toEqual(['replace', 'up']);
  });

  it('a trinket at max rank is not offered as an upgrade', () => {
    const w = makeWorld({ content: (c) => (c.stones = []) });
    const p = player(w);
    p.trinkets[0] = { id: 'lifesteal', rank: 3 };
    for (const offer of scanEssence(w, p, 150)) for (const c of offer) expect(c.id).not.toBe('lifesteal');
  });

  it('trinket lines scale with rank (perRank × rank)', () => {
    const w = makeWorld({ content: (c) => (c.stones = []) });
    const p = player(w);
    for (const offer of scanEssence(w, p, 150, true)) {
      for (const c of offer) {
        if (c.id !== 'poison_chance') continue;
        const chance = c.lines.find((l) => l.stat === 'chance');
        expect(chance?.value).toBeCloseTo(0.08 * c.rank, 9);
      }
    }
  });

  it('falls back to heal + yeop when nothing is offerable (no content, or everything maxed)', () => {
    const empty = makeWorld({
      content: (c) => {
        c.stones = [];
        c.trinkets = [];
      },
    });
    for (const awakened of [false, true]) {
      const offer = buildEssenceOffer(empty, player(empty), awakened);
      expect(offer.map((c) => c.kind)).toEqual(['heal', 'yeop']);
      for (const c of offer) expect(ri(c.rarity)).toBeGreaterThanOrEqual(awakened ? 2 : 1);
    }
    const maxed = makeWorld({
      content: (c) => {
        c.stones = c.stones.slice(0, 1);
        c.trinkets = c.trinkets.slice(0, 1);
      },
    });
    const p = player(maxed);
    p.stones[0] = { id: 'piercing', level: 4 };
    p.trinkets[0] = { id: 'lifesteal', rank: 3 };
    expect(buildEssenceOffer(maxed, p, false).map((c) => c.kind)).toEqual(['heal', 'yeop']);
  });

  it('a short pool gives a short offer topped up with heal then yeop', () => {
    const w = makeWorld({
      content: (c) => {
        c.stones = c.stones.slice(0, 1);
        c.trinkets = [];
      },
    });
    const kinds = buildEssenceOffer(w, player(w), false).map((c) => c.kind);
    expect(kinds).toEqual(['stone', 'heal', 'yeop']);
  });

  it('picking essence cards applies them: stone and trinket slots, stats follow', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const p = player(w);
    const m = openEssence(w, p, 'metin_lament', true);
    expect(m.kind).toBe('essence');
    expect(m.source).toBe('metin_lament');
    expect(m.awakened).toBe(true);
    expect(m.cards.length).toBe(3);
    const first = m.cards[0] as Card;
    expect(w.chooseCard(0)).toBe(true);
    if (first.kind === 'stone' || first.kind === 'stoneUp') expect(p.stones[first.slot]).toEqual({ id: first.id, level: first.rank });
    else if (first.kind === 'trinket' || first.kind === 'trinketUp') expect(p.trinkets[first.slot]).toEqual({ id: first.id, rank: first.rank });
    expect(w.modals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// chest / boss reward offers

describe('chest and boss reward modals', () => {
  it('chest: epic-free floor of rare, kind chest, not free, no reroll/banish/skip', () => {
    const w = makeWorld();
    const p = player(w);
    for (let i = 0; i < 60; i++) {
      const m = openChest(w, p, null);
      expect(m.kind).toBe('chest');
      expect(m.free).toBe(false);
      expect(m.source).toBe('');
      expect(m.cards).toHaveLength(w.balance.cardsPerLevel);
      for (const c of m.cards) expect(ri(c.rarity)).toBeGreaterThanOrEqual(2);
      expect([m.canReroll, m.canBanish, m.canSkip]).toEqual([false, false, false]);
      w.modals.length = 0;
    }
  });

  it('bossReward: epic+ floor, free, source = boss id, no reroll/banish/skip', () => {
    const w = makeWorld();
    const p = player(w);
    for (let i = 0; i < 60; i++) {
      const m = openChest(w, p, 'boss_horyeong');
      expect(m.kind).toBe('bossReward');
      expect(m.free).toBe(true);
      expect(m.source).toBe('boss_horyeong');
      for (const c of m.cards) expect(ri(c.rarity)).toBeGreaterThanOrEqual(3);
      expect([m.canReroll, m.canBanish, m.canSkip]).toEqual([false, false, false]);
      w.modals.length = 0;
    }
  });

  it('chest cards are level-up kinds without duplicate ids', () => {
    const w = makeWorld();
    const p = player(w);
    for (let i = 0; i < 100; i++) {
      const m = openChest(w, p, i % 2 === 0 ? null : 'boss_ork_chief');
      const ids = realIds(m.cards);
      expect(new Set(ids).size).toBe(ids.length);
      for (const c of m.cards) expect(LEVEL_UP_KINDS).toContain(c.kind);
      w.modals.length = 0;
    }
  });

  it('reroll / banish / skip are rejected on chest modals and leave the budgets alone', () => {
    const w = makeWorld();
    const p = player(w);
    const m = openChest(w, p, null);
    const ids = m.cards.map((c) => c.id);
    expect(w.reroll()).toBe(false);
    expect(w.banish(0)).toBe(false);
    expect(w.skip()).toBe(false);
    expect(m.cards.map((c) => c.id)).toEqual(ids);
    expect([p.rerolls, p.banishes, p.skips]).toEqual([3, 2, 2]);
    expect(w.modals).toHaveLength(1);
    expect(w.chooseCard(0)).toBe(true);
    expect(w.modals).toHaveLength(0);
  });

  it('boss rewards: picking applies the card exactly like a level-up pick', () => {
    const w = makeWorld({ content: onlySkillUps });
    const p = player(w);
    const arc = p.skills.find((s) => s.def.id === 'sword_arc');
    const cut = p.skills.find((s) => s.def.id === 'lightning_trio');
    const m = openChest(w, p, 'boss_horyeong');
    const target = m.cards.find((c) => c.kind === 'skillUp') as Card;
    const idx = m.cards.indexOf(target);
    const s = target.id === 'sword_arc' ? arc : cut;
    expect(s?.rank).toBe(0);
    expect(w.chooseCard(idx)).toBe(true);
    expect(s?.rank).toBe(1);
    expect(s?.upg.some((u) => u.pct !== 0 || u.flat !== 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// modal lifecycle

describe('level-up modal lifecycle', () => {
  it('grantXp → next tick opens a levelUp modal with cardsPerLevel cards and the full budgets', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const p = player(w);
    grantXp(w, p, p.xpNext);
    expect(p.level).toBe(2);
    expect(p.pendingLevels).toBe(1);
    expect(w.modal).toBeNull();
    w.step([NO_INPUT]);
    const m = modalOf(w);
    expect(m.kind).toBe('levelUp');
    expect(m.player).toBe(0);
    expect(m.level).toBe(2);
    expect(m.cards).toHaveLength(3);
    expect([m.rerolls, m.banishes, m.skips]).toEqual([3, 2, 2]);
    expect([m.canReroll, m.canBanish, m.canSkip]).toEqual([true, true, true]);
    expect(m.free).toBe(false);
    expect(m.waited).toBe(0);
    expect(p.pendingLevels).toBe(0);
  });

  it('ids increase monotonically across modals', () => {
    const w = makeWorld();
    const p = player(w);
    const a = openLevelUp(w, p, 2);
    const b = openLevelUp(w, p, 3);
    const c = openRunEnd(w, w.buildResult(false));
    expect(b.id).toBeGreaterThan(a.id);
    expect(c.id).toBeGreaterThan(b.id);
  });

  it('several pending level-ups open one after another (level = level reached), never two at once', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const p = player(w);
    grantXp(w, p, 26.76); // 10.55 + 16.2 → two levels
    expect(p.level).toBe(3);
    expect(p.pendingLevels).toBe(2);
    w.step([NO_INPUT]);
    expect(w.modals).toHaveLength(1);
    expect(modalOf(w).level).toBe(2);
    expect(w.chooseCard(0)).toBe(true);
    expect(w.modals).toHaveLength(0);
    w.step([NO_INPUT]);
    expect(w.modals).toHaveLength(1);
    expect(modalOf(w).level).toBe(3);
    expect(w.chooseCard(0)).toBe(true);
    w.step([NO_INPUT]);
    expect(w.modals).toHaveLength(0);
    expect(p.pendingLevels).toBe(0);
  });

  it('a talent start level opens the opening card modals at construction', () => {
    const w = makeWorld({ config: { meta: { stats: {}, startLevel: 3 } } });
    const p = player(w);
    expect(p.level).toBe(3);
    expect(w.modals).toHaveLength(1);
    expect(modalOf(w).kind).toBe('levelUp');
    expect(modalOf(w).level).toBe(2);
    w.chooseCard(0);
    w.step([NO_INPUT]);
    expect(modalOf(w).level).toBe(3);
  });

  it('chooseCard applies the card, removes the modal and rejects bad indices / players', () => {
    const w = makeWorld();
    const p = player(w);
    const m = openLevelUp(w, p, 2);
    const n = m.cards.length;
    expect(w.chooseCard(n)).toBe(false);
    expect(w.chooseCard(-1)).toBe(false);
    expect(w.chooseCard(0, 1)).toBe(false); // no such player
    expect(w.modals).toHaveLength(1);
    const card = m.cards[0] as Card;
    w.bus.clear();
    expect(w.chooseCard(0)).toBe(true);
    expect(w.modals).toHaveLength(0);
    expect(w.events.find((e) => e.t === 'cardPick')).toMatchObject({ player: 0, kind: card.kind, id: card.id, rarity: card.rarity });
    expect(w.chooseCard(0)).toBe(false); // nothing pending any more
  });

  it('answering a level-up card applies it end-to-end (new skill / skill rank-up / new passive)', () => {
    const kindsApplied = new Set<CardKind>();
    for (let seed = 1; seed <= 40; seed++) {
      const w = makeWorld({ config: { seed } });
      const p = player(w);
      const m = openLevelUp(w, p, 2);
      const card = m.cards[0] as Card;
      const nSkills = p.skills.length;
      const nPass = p.passives.length;
      w.chooseCard(0);
      if (card.kind === 'newSkill') {
        expect(p.skills).toHaveLength(nSkills + 1);
        expect(p.skills[nSkills]?.def.id).toBe(card.id);
      } else if (card.kind === 'skillUp') {
        expect(w.skillSlots[card.slot]?.rank).toBe(card.rank);
      } else if (card.kind === 'newPassive') {
        expect(p.passives).toHaveLength(nPass + 1);
        expect(p.passives[nPass]).toEqual({ id: card.id, rank: 1, power: RARITY_MULT[card.rarity] });
      } else {
        expect.unreachable(`unexpected first-level-up card kind ${card.kind}`);
      }
      kindsApplied.add(card.kind);
    }
    expect([...kindsApplied].sort()).toEqual(['newPassive', 'newSkill', 'skillUp']);
  });
});

describe('reroll', () => {
  it('consumes a reroll, replaces the offer with new ids, resets the wait timer and syncs the budgets', () => {
    const w = makeWorld();
    const p = player(w);
    const m = openLevelUp(w, p, 2);
    m.waited = 7;
    for (let k = 1; k <= 3; k++) {
      const prev = new Set(realIds(m.cards));
      expect(w.reroll()).toBe(true);
      expect(p.rerolls).toBe(3 - k);
      expect(m.rerolls).toBe(3 - k);
      expect(m.canReroll).toBe(3 - k > 0);
      expect(m.waited).toBe(0);
      expect(m.cards).toHaveLength(3);
      for (const c of m.cards) if (c.id !== '') expect(prev.has(c.id), `${c.id} was in the previous offer`).toBe(false);
      m.waited = 1;
    }
    const after = m.cards.map((c) => c.id);
    expect(w.reroll()).toBe(false);
    expect(p.rerolls).toBe(0);
    expect(m.cards.map((c) => c.id)).toEqual(after);
    expect(w.modals).toHaveLength(1);
  });

  it('falls back to an unrestricted offer when excluding the previous ids would starve it', () => {
    const w = makeWorld({ content: onlySkillUps });
    const p = player(w);
    const m = openLevelUp(w, p, 2);
    expect(m.cards.map((c) => c.kind)).toEqual(['skillUp', 'skillUp', 'heal']);
    expect(w.reroll()).toBe(true);
    expect(m.cards).toHaveLength(3);
    expect(m.cards.map((c) => c.kind)).toEqual(['skillUp', 'skillUp', 'heal']);
    expect(p.rerolls).toBe(2);
  });

  it('reroll offers keep the new/old guarantees: no duplicates, no banished ids', () => {
    const w = makeWorld({ content: (c) => (c.balance.rerollsPerRun = 40) });
    const p = player(w);
    p.banished.add('bladewheel');
    const m = openLevelUp(w, p, 2);
    for (let i = 0; i < 40; i++) {
      expect(w.reroll()).toBe(true);
      const ids = realIds(m.cards);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain('bladewheel');
    }
  });

  it('essence reroll replaces the offer, avoids the previous ids with a large pool, and uses a reroll', () => {
    const w = makeWorld({
      content: (c) => {
        c.balance.rerollsPerRun = 25;
        c.trinkets = [];
        const base = c.stones[0] as StoneDef;
        for (let i = 0; i < 40; i++) c.stones.push(cloneStone(base, `clone_${i}`));
      },
    });
    const p = player(w);
    const m = openEssence(w, p, 'metin_avarice', false);
    let overlapping = 0;
    for (let i = 0; i < 25; i++) {
      const prev = new Set(realIds(m.cards));
      expect(w.reroll()).toBe(true);
      expect(m.cards).toHaveLength(3);
      for (const c of m.cards) expect(ESSENCE_KINDS).toContain(c.kind);
      if (m.cards.some((c) => prev.has(c.id))) overlapping++;
    }
    expect(p.rerolls).toBe(0);
    // the picker retries a few times to avoid the previous ids: with 45 stone defs overlaps must be rare
    expect(overlapping).toBeLessThanOrEqual(2);
  });

  it('reroll targets the first modal that belongs to the requesting player (co-op)', () => {
    const w = coopWorld();
    const p0 = player(w, 0);
    const p1 = player(w, 1);
    openLevelUp(w, p0, 2);
    const m1 = openLevelUp(w, p1, 2);
    const before = m1.cards.map((c) => c.id);
    expect(w.reroll(1)).toBe(true);
    expect(p1.rerolls).toBe(2);
    expect(p0.rerolls).toBe(3);
    expect(m1.cards.map((c) => c.id)).not.toEqual(before);
    expect(w.modals[0]?.rerolls).toBe(3);
  });
});

describe('banish', () => {
  it('banishes the card id for the rest of the run, refills the slot, and updates the budgets', () => {
    const w = makeWorld();
    const p = player(w);
    const m = openLevelUp(w, p, 2);
    const target = m.cards[1] as Card;
    const others = [m.cards[0], m.cards[2]].map((c) => (c as Card).id);
    expect(target.id).not.toBe('');
    expect(w.banish(1)).toBe(true);
    expect(p.banishes).toBe(1);
    expect(m.banishes).toBe(1);
    expect(m.canBanish).toBe(true);
    expect(p.banished.has(target.id)).toBe(true);
    expect(m.cards).toHaveLength(3);
    expect([(m.cards[0] as Card).id, (m.cards[2] as Card).id]).toEqual(others);
    const repl = m.cards[1] as Card;
    expect(repl.id).not.toBe(target.id);
    expect(others).not.toContain(repl.id);
    // never offered again, in any later offer
    for (const c of scan(w, p, 300)) expect(c.id).not.toBe(target.id);
    // second banish uses the last charge
    expect(w.banish(0)).toBe(true);
    expect(p.banishes).toBe(0);
    expect(m.canBanish).toBe(false);
    expect(w.banish(0)).toBe(false);
    expect(p.banishes).toBe(0);
  });

  it('banishing an owned skill removes it from the rank-up pool too', () => {
    const w = makeWorld({ content: onlySkillUps });
    const p = player(w);
    p.banished.add('sword_arc');
    const cards = scan(w, p, 100);
    expect(cards.some((c) => c.id === 'sword_arc')).toBe(false);
    expect(cards.some((c) => c.id === 'lightning_trio')).toBe(true);
  });

  it('heal / yeop cards cannot be banished (no charge spent)', () => {
    const w = makeWorld({
      content: (c) => {
        onlySkillUps(c);
      },
    });
    const p = player(w);
    maxAllSkills(p);
    const m = openLevelUp(w, p, 2);
    expect(m.cards.map((c) => c.kind)).toEqual(['heal', 'yeop']);
    expect(w.banish(0)).toBe(false);
    expect(w.banish(1)).toBe(false);
    expect(p.banishes).toBe(2);
    expect(p.banished.size).toBe(0);
  });

  it('rejects banish with no charges, an invalid index, or on essence modals', () => {
    const w = makeWorld({ content: (c) => (c.balance.banishesPerRun = 0) });
    const p = player(w);
    const m = openLevelUp(w, p, 2);
    expect(m.canBanish).toBe(false);
    expect(w.banish(0)).toBe(false);
    const w2 = makeWorld();
    const p2 = player(w2);
    openLevelUp(w2, p2, 2);
    expect(w2.banish(9)).toBe(false);
    expect(p2.banishes).toBe(2);
    w2.modals.length = 0;
    const e = openEssence(w2, p2, 'metin_lament', false);
    expect(e.canBanish).toBe(false);
    expect(w2.banish(0)).toBe(false);
    expect(p2.banishes).toBe(2);
  });

  it('never leaves two heal (or two yeop) cards in the offer when the pool is exhausted', () => {
    // pool: sword_arc + lightning_trio rank-ups and the heal fallback
    const w = makeWorld({ content: onlySkillUps });
    const p = player(w);
    const m = openLevelUp(w, p, 2);
    expect(m.cards.map((c) => c.kind)).toEqual(['skillUp', 'skillUp', 'heal']);
    expect(w.banish(0)).toBe(true);
    expect(m.cards.filter((c) => c.kind === 'heal').length).toBeLessThanOrEqual(1);
    expect(m.cards.filter((c) => c.kind === 'yeop').length).toBeLessThanOrEqual(1);
    const ids = realIds(m.cards);
    expect(new Set(ids).size).toBe(ids.length);
    expect(m.cards.length).toBeGreaterThan(0);
  });
});

describe('skip', () => {
  it('discards the offer without applying anything and spends one skip', () => {
    const w = makeWorld();
    const p = player(w);
    openLevelUp(w, p, 2);
    const skillsBefore = p.skills.length;
    w.bus.clear();
    expect(w.skip()).toBe(true);
    expect(p.skips).toBe(1);
    expect(w.modals).toHaveLength(0);
    expect(p.skills).toHaveLength(skillsBefore);
    expect(p.passives).toHaveLength(0);
    expect(w.events.some((e) => e.t === 'cardPick')).toBe(false);
  });

  it('is rejected with no skips left; canSkip tracks the budget', () => {
    const w = makeWorld({ content: (c) => (c.balance.skipsPerRun = 1) });
    const p = player(w);
    const a = openLevelUp(w, p, 2);
    expect(a.canSkip).toBe(true);
    expect(w.skip()).toBe(true);
    const b = openLevelUp(w, p, 3);
    expect(b.canSkip).toBe(false);
    expect(b.skips).toBe(0);
    expect(w.skip()).toBe(false);
    expect(w.modals).toHaveLength(1);
  });

  it('is allowed on essence modals but not on chest / bossReward / runEnd modals', () => {
    const w = makeWorld();
    const p = player(w);
    const e = openEssence(w, p, 'metin_lament', false);
    expect(e.canSkip).toBe(true);
    expect(e.canReroll).toBe(true);
    expect(w.skip()).toBe(true);
    expect(w.modals).toHaveLength(0);
    openChest(w, p, null);
    expect(w.skip()).toBe(false);
    w.modals.length = 0;
    openChest(w, p, 'boss_horyeong');
    expect(w.skip()).toBe(false);
    w.modals.length = 0;
    openRunEnd(w, w.buildResult(true));
    expect(w.skip()).toBe(false);
    expect(w.reroll()).toBe(false);
    expect(w.banish(0)).toBe(false);
    expect(w.chooseCard(0)).toBe(false);
    expect(w.modals).toHaveLength(1);
  });

  it('meta bonuses extend the reroll / banish / skip budgets', () => {
    const w = makeWorld({ config: { meta: { stats: {}, rerolls: 2, banishes: 1, skips: 3 } } });
    const p = player(w);
    expect([p.rerolls, p.banishes, p.skips]).toEqual([5, 3, 5]);
    const m = openLevelUp(w, p, 2);
    expect([m.rerolls, m.banishes, m.skips]).toEqual([5, 3, 5]);
  });
});

describe('modals freeze the sim', () => {
  it('step() only clears the events while a modal is open; time, tick, enemies and the spawner stand still', () => {
    const w = makeWorld();
    const p = player(w);
    runTicks(w, 30);
    spawn(w, 'wolf', 10, 0, { spawnTime: 0 });
    const t0 = w.time;
    const tick0 = w.tick;
    const acc0 = w.spawner.acc;
    const wolfX = w.enemies.x[0];
    const hp0 = p.hp;
    openLevelUp(w, p, 2);
    w.bus.shake(1, 1);
    expect(w.events.length).toBeGreaterThan(0);
    w.step([NO_INPUT]);
    expect(w.events).toHaveLength(0);
    runTicks(w, 300, { moveX: 1, moveZ: 0 });
    expect(w.time).toBe(t0);
    expect(w.tick).toBe(tick0);
    expect(w.spawner.acc).toBe(acc0);
    expect(w.enemies.x[0]).toBe(wolfX);
    expect(p.hp).toBe(hp0);
    expect(p.x).toBeCloseTo(player(w).x);
    // answering resumes the sim
    w.chooseCard(0);
    w.step([NO_INPUT]);
    expect(w.tick).toBe(tick0 + 1);
    expect(w.time).toBeCloseTo(t0 + DT, 9);
  });

  it('the hero does not move while frozen, and moves again afterwards', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const p = player(w);
    openLevelUp(w, p, 2);
    runTicks(w, 120, { moveX: 1, moveZ: 0 });
    expect(p.x).toBe(0);
    w.chooseCard(0);
    runTicks(w, 30, { moveX: 1, moveZ: 0 });
    expect(p.x).toBeGreaterThan(0.5);
  });

  it('a single-player modal never auto-picks (autoPickAfter is Infinity)', () => {
    const w = makeWorld();
    expect(w.autoPickAfter).toBe(Infinity);
    openLevelUp(w, player(w), 2);
    runTicks(w, 3000);
    expect(w.modals).toHaveLength(1);
  });
});

describe('co-op auto-pick', () => {
  it('a two-player world waits 20 s per modal, then picks card 0 for each pending player', () => {
    const w = coopWorld();
    expect(w.players).toHaveLength(2);
    expect(w.autoPickAfter).toBe(20);
    freezeSchedules(w);
    const p0 = player(w, 0);
    const p1 = player(w, 1);
    const m0 = openLevelUp(w, p0, 2);
    const m1 = openLevelUp(w, p1, 2);
    const first0 = { ...(m0.cards[0] as Card) };
    const first1 = { ...(m1.cards[0] as Card) };
    const t0 = w.time;
    runTicks(w, 19 * 60);
    expect(w.modals).toHaveLength(2);
    expect(m0.waited).toBeCloseTo(19, 1);
    // both modals auto-pick on the same tick, 20 s after they opened
    let ticks = 19 * 60;
    const picks: { player: number; kind: string; id: string; rarity: string }[] = [];
    while (w.modals.length > 0 && ticks < 25 * 60) {
      picks.push(...collect(w, 1, ['cardPick']));
      ticks++;
    }
    expect(ticks).toBeGreaterThanOrEqual(20 * 60 - 1);
    expect(ticks).toBeLessThanOrEqual(20 * 60 + 1);
    expect(w.modals).toHaveLength(0);
    expect(picks).toHaveLength(2);
    const byPlayer = new Map(picks.map((e) => [e.player, e]));
    expect(byPlayer.get(0)).toMatchObject({ kind: first0.kind, id: first0.id, rarity: first0.rarity });
    expect(byPlayer.get(1)).toMatchObject({ kind: first1.kind, id: first1.id, rarity: first1.rarity });
    // the sim clock was frozen the whole time ...
    expect(w.time).toBe(t0);
    // ... and resumes once everything is answered
    runTicks(w, 10);
    expect(w.time).toBeGreaterThan(t0);
  });

  it('each player has an independent timer; a reroll restarts only that player\'s wait', () => {
    const w = coopWorld();
    freezeSchedules(w);
    const p0 = player(w, 0);
    const p1 = player(w, 1);
    const m0 = openLevelUp(w, p0, 2);
    const m1 = openLevelUp(w, p1, 2);
    runTicks(w, 15 * 60);
    expect(w.reroll(0)).toBe(true);
    expect(m0.waited).toBe(0);
    expect(m1.waited).toBeCloseTo(15, 1);
    runTicks(w, 6 * 60); // 21 s since the start: player 1 auto-picked, player 0 still waiting (6 s)
    expect(w.modals).toHaveLength(1);
    expect(w.modals[0]?.player).toBe(0);
    expect(m0.waited).toBeCloseTo(6, 1);
    runTicks(w, 15 * 60); // 21 s after the reroll
    expect(w.modals).toHaveLength(0);
  });

  it('players can answer their own modal while another player\'s modal is first in the queue', () => {
    const w = coopWorld();
    const p0 = player(w, 0);
    const p1 = player(w, 1);
    const m0 = openLevelUp(w, p0, 2);
    openLevelUp(w, p1, 2);
    expect(w.modal).toBe(m0);
    expect(w.chooseCard(0, 1)).toBe(true);
    expect(w.modals).toEqual([m0]);
    expect(w.chooseCard(0, 1)).toBe(false);
    expect(w.chooseCard(0, 0)).toBe(true);
    expect(w.modals).toHaveLength(0);
  });

  it('a custom autoPickAfter is respected and runEnd modals are never auto-picked', () => {
    const w = coopWorld();
    freezeSchedules(w);
    w.autoPickAfter = 2;
    openLevelUp(w, player(w, 0), 2);
    openRunEnd(w, w.buildResult(false));
    runTicks(w, 119);
    expect(w.modals).toHaveLength(2);
    runTicks(w, 3);
    expect(w.modals).toHaveLength(1);
    expect(w.modals[0]?.kind).toBe('runEnd');
    expect(w.modals[0]?.waited).toBe(0);
    runTicks(w, 600);
    expect(w.modals).toHaveLength(1);
  });

  it('auto-pick also resolves essence modals', () => {
    const w = coopWorld();
    freezeSchedules(w);
    w.autoPickAfter = 1;
    openEssence(w, player(w, 1), 'metin_lament', false);
    const picks = collect(w, 90, ['cardPick']);
    expect(w.modals).toHaveLength(0);
    expect(picks).toHaveLength(1);
    expect(picks[0]?.player).toBe(1);
  });

  it('budgets are per player', () => {
    const w = coopWorld();
    const p0 = player(w, 0);
    const p1 = player(w, 1);
    openLevelUp(w, p1, 2);
    expect(w.banish(0, 1)).toBe(true);
    expect(w.skip(1)).toBe(true);
    expect([p0.banishes, p0.skips, p0.rerolls]).toEqual([2, 2, 3]);
    expect([p1.banishes, p1.skips]).toEqual([1, 1]);
    expect(p1.banished.size).toBe(1);
    expect(p0.banished.size).toBe(0);
  });

  it('a queued second modal for the same player waits at 0 until frontmost and never expires to force-pick a rerolled first modal', () => {
    const w = coopWorld();
    freezeSchedules(w);
    const p0 = player(w, 0);
    const m0 = openLevelUp(w, p0, 2);
    const m1 = openLevelUp(w, p0, 3);
    runTicks(w, 15 * 60);
    expect(m0.waited).toBeCloseTo(15, 1);
    expect(m1.waited).toBe(0);
    // Reroll resets m0's timer to 0; m1 is still queued behind m0 and must stay at 0.
    expect(w.reroll(0)).toBe(true);
    expect(m0.waited).toBe(0);
    expect(m1.waited).toBe(0);
    // 6 s later (21 s total since open): m0 must still be open at ~6 s and m1 still at 0.
    runTicks(w, 6 * 60);
    expect(w.modals).toEqual([m0, m1]);
    expect(m0.waited).toBeCloseTo(6, 1);
    expect(m1.waited).toBe(0);
    // Once m0 auto-picks (~14 s later), m1 becomes frontmost and gets its own full 20 s timer.
    runTicks(w, 15 * 60);
    expect(w.modals).toEqual([m1]);
    expect(m1.waited).toBeLessThan(2);
    runTicks(w, 20 * 60);
    expect(w.modals).toHaveLength(0);
  });

  it('a valid four-player party can acquire more than 32 combined skills without overflowing skillSlots', () => {
    const w = makeWorld({ config: { coop: [COOP_HERO, COOP_HERO, COOP_HERO] } });
    expect(w.players).toHaveLength(4);
    const extraSkills = w.content.skills.filter((s) => s.kind !== 'basic');
    expect(extraSkills.length).toBeGreaterThanOrEqual(8);
    // Give each of the 4 players 8 additional skills on top of their starting skills (= 36+ total slots > 32).
    for (let pi = 0; pi < 4; pi++) {
      const p = player(w, pi);
      let added = 0;
      for (const def of extraSkills) {
        if (added >= 8) break;
        if (p.skills.some((s) => s.def.id === def.id)) continue;
        addSkill(w, p, def, 1);
        added++;
      }
      expect(p.skills.length).toBeGreaterThanOrEqual(9);
    }
    expect(w.skillSlots.length).toBeGreaterThanOrEqual(36);
    // Stepping the world with 36+ slots exercises hitStamp & updateSkills safely.
    expect(() => runTicks(w, 10)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// offers are snapshots: several modals can be queued from the same state
// (a boss kill + a level-up in one tick; an awakened metin opens two essence offers back to back)

describe('queued modals built from the same state', () => {
  it('two queued offers that both rank up the same skill advance its rank twice', () => {
    const w = makeWorld({ content: onlySkillUps });
    const p = player(w);
    const levelUp = openLevelUp(w, p, 2);
    const chest = openChest(w, p, null);
    const arc = p.skills.find((s) => s.def.id === 'sword_arc');
    const idxIn = (m: ModalRequest): number => m.cards.findIndex((c) => c.kind === 'skillUp' && c.id === 'sword_arc');
    expect(idxIn(levelUp)).toBeGreaterThanOrEqual(0);
    expect(idxIn(chest)).toBeGreaterThanOrEqual(0);
    expect(w.chooseCard(idxIn(levelUp))).toBe(true);
    expect(arc?.rank).toBe(1);
    expect(w.chooseCard(idxIn(chest))).toBe(true);
    expect(arc?.rank).toBe(2);
  });

  it('picking the same new skill from two queued offers never creates a second instance', () => {
    const w = makeWorld({
      content: (c) => {
        c.passives = [];
        c.skills = c.skills.filter((s) => s.classId !== 'common');
        const cls = c.classes[0];
        if (cls) cls.doctrines[0].skills = ['lightning_trio', 'bladewheel'];
      },
    });
    const p = player(w);
    maxAllSkills(p);
    const levelUp = openLevelUp(w, p, 2);
    const chest = openChest(w, p, null);
    const idxIn = (m: ModalRequest): number => m.cards.findIndex((c) => c.kind === 'newSkill' && c.id === 'bladewheel');
    expect(idxIn(levelUp)).toBeGreaterThanOrEqual(0);
    expect(idxIn(chest)).toBeGreaterThanOrEqual(0);
    w.chooseCard(idxIn(levelUp));
    w.chooseCard(idxIn(chest));
    expect(p.skills.filter((s) => s.def.id === 'bladewheel')).toHaveLength(1);
  });

  it('picking the same new passive from two queued offers never creates a second instance', () => {
    const w = makeWorld({
      content: (c) => {
        onlyPassives(c);
        c.passives = c.passives.filter((d) => d.id === 'haste');
      },
    });
    const p = player(w);
    maxAllSkills(p);
    const levelUp = openLevelUp(w, p, 2);
    const chest = openChest(w, p, null);
    const idxIn = (m: ModalRequest): number => m.cards.findIndex((c) => c.kind === 'newPassive' && c.id === 'haste');
    expect(idxIn(levelUp)).toBeGreaterThanOrEqual(0);
    expect(idxIn(chest)).toBeGreaterThanOrEqual(0);
    w.chooseCard(idxIn(levelUp));
    w.chooseCard(idxIn(chest));
    expect(p.passives.filter((x) => x.id === 'haste')).toHaveLength(1);
  });

  it('two essence offers in a row: the second pick does not silently overwrite the first stone', () => {
    const w = makeWorld({
      content: (c) => {
        c.trinkets = [];
        c.stones = c.stones.filter((s) => s.id === 'piercing' || s.id === 'deadly');
      },
    });
    const p = player(w);
    const first = openEssence(w, p, 'metin_lament', true);
    const second = openEssence(w, p, 'metin_lament', true);
    const idxOf = (m: ModalRequest, id: string): number => m.cards.findIndex((c) => c.id === id);
    expect(idxOf(first, 'piercing')).toBeGreaterThanOrEqual(0);
    expect(idxOf(second, 'deadly')).toBeGreaterThanOrEqual(0);
    w.chooseCard(idxOf(first, 'piercing'));
    w.chooseCard(idxOf(second, 'deadly'));
    const owned = p.stones.flatMap((s) => (s ? [s.id] : [])).sort();
    expect(owned).toEqual(['deadly', 'piercing']);
  });
});

// ---------------------------------------------------------------------------
// awakening pacts (R1, OF-01): balance.pacts

/** every BehaviorKind -> a fixture passive (the shipped table's shape on the 8 passives the fixture has: holy_armor and ghostly_grasp stay free) */
const TEST_PACTS: Record<string, string> = {
  meleeArc: 'fury',
  cone: 'fury',
  spinAura: 'haste',
  orbit: 'haste',
  persistentAura: 'eyes',
  skyStrike: 'eyes',
  dash: 'focus',
  groundZone: 'focus',
  selfBuff: 'focus',
  beam: 'focus',
  chain: 'focus',
  projectile: 'fortune',
  homingProjectile: 'fortune',
  leap: 'sovereign_blood',
  shockwave: 'sovereign_blood',
  summon: 'sovereign_blood',
};

function withPacts(c: ContentDB, over: Record<string, unknown> = {}): void {
  c.balance.pacts = { rank: 2, readyWeight: 2, byBehavior: { ...TEST_PACTS }, ...over } as ContentDB['balance']['pacts'];
}

/** only skill-up cards can be rolled (no new skills, no new passives) and the pacts are on */
function pactsSkillUps(c: ContentDB, over: Record<string, unknown> = {}): void {
  c.balance.maxActiveSkills = 0;
  c.balance.maxPassives = 0;
  withPacts(c, over);
}

/** only passive cards can be rolled (no new skills) and the pacts are on */
function pactsPassives(c: ContentDB): void {
  c.balance.maxActiveSkills = 0;
  withPacts(c);
}

const own = (p: PlayerState, id: string, rank: number): void => {
  p.passives.push({ id, rank, power: rank });
};

function skillOf(p: PlayerState, id: string): SkillInstance {
  const s = p.skills.find((x) => x.def.id === id);
  if (!s) throw new Error(`skill '${id}' missing`);
  return s;
}

describe('awakening pacts: the skill-up pool', () => {
  it('no P without the pact: a G2 skill is not offered its awakening, the other skills still rank up', () => {
    const w = makeWorld({ content: (c) => pactsSkillUps(c) });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 6;
    skillOf(p, 'lightning_trio').rank = 3;
    const cards = scan(w, p, 80);
    expect(cards.some((c) => c.id === 'sword_arc' && c.kind === 'skillUp')).toBe(false);
    expect(cards.some((c) => c.awakening)).toBe(false);
    expect(cards.some((c) => c.id === 'lightning_trio' && c.kind === 'skillUp')).toBe(true);
  });

  it('a passive below pacts.rank is not enough (rank 1 of 2), the pact passive at pacts.rank is', () => {
    const w = makeWorld({ content: (c) => pactsSkillUps(c) });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 6;
    skillOf(p, 'lightning_trio').rank = 6;
    own(p, 'fury', 1);
    expect(scan(w, p, 60).some((c) => c.awakening)).toBe(false);
    (p.passives[0] as PassiveInstance).rank = 2;
    const cards = scan(w, p, 60);
    for (const id of ['sword_arc', 'lightning_trio']) {
      const aw = cards.filter((c) => c.id === id);
      expect(aw.length, id).toBeGreaterThan(0);
      for (const c of aw) {
        expect(c.kind).toBe('skillUp');
        expect(c.rank).toBe(7);
        expect(c.awakening).toBe(true);
        expect('needs' in c).toBe(false);
      }
    }
  });

  it('P with the pact: choosing the card awakens the skill (cardPick awakening + awaken sfx)', () => {
    const w = makeWorld({ content: (c) => pactsSkillUps(c) });
    const p = player(w);
    const arc = skillOf(p, 'sword_arc');
    arc.rank = 6;
    own(p, 'fury', 2);
    const card = scan(w, p, 60).find((c) => c.id === 'sword_arc' && c.kind === 'skillUp');
    expect(card?.awakening).toBe(true);
    w.bus.clear();
    applyCard(w, p, card as Card);
    expect(arc.rank).toBe(MAX_SKILL_RANK);
    expect(w.events.find((e) => e.t === 'cardPick')).toMatchObject({ kind: 'skillUp', id: 'sword_arc', rank: 7, awakening: true });
    expect(w.events.some((e) => e.t === 'sfx' && e.id === 'sfx_awaken')).toBe(true);
  });

  it('the G2 card carries needs: <passive> while the pact is missing, and only the G2 card', () => {
    const w = makeWorld({ content: (c) => pactsSkillUps(c) });
    const p = player(w);
    const arc = skillOf(p, 'sword_arc');
    giveSkill(w, 'bladewheel', 5);
    giveSkill(w, 'lunge', 2);
    arc.rank = 5;
    const cards = scan(w, p, 80).filter((c) => c.kind === 'skillUp');
    const arcCards = cards.filter((c) => c.id === 'sword_arc');
    const spinCards = cards.filter((c) => c.id === 'bladewheel');
    const lungeCards = cards.filter((c) => c.id === 'lunge');
    expect(arcCards.length).toBeGreaterThan(0);
    for (const c of arcCards) {
      expect(c.rank).toBe(6);
      expect(c.awakening).toBe(false);
      expect(c.needs).toBe('fury');
    }
    expect(spinCards.length).toBeGreaterThan(0);
    for (const c of spinCards) {
      expect(c.rank).toBe(6);
      expect(c.needs).toBe('haste');
    }
    expect(lungeCards.length).toBeGreaterThan(0);
    for (const c of lungeCards) {
      expect(c.rank).toBe(3);
      expect('needs' in c).toBe(false);
    }
    // the pact is met: the same G2 card no longer carries the field
    own(p, 'fury', 2);
    const met = scan(w, p, 80).filter((x) => x.id === 'sword_arc');
    expect(met.length).toBeGreaterThan(0);
    for (const c of met) expect('needs' in c).toBe(false);
  });

  it('a skill held at G2 waits there; the pact passive releases it', () => {
    const w = makeWorld({ content: (c) => pactsSkillUps(c) });
    const p = player(w);
    const arc = skillOf(p, 'sword_arc');
    arc.rank = 5;
    const g2 = scan(w, p, 60).find((c) => c.id === 'sword_arc');
    applyCard(w, p, g2 as Card);
    expect(arc.rank).toBe(6);
    expect(scan(w, p, 60).some((c) => c.id === 'sword_arc')).toBe(false);
    own(p, 'fury', 2);
    expect(scan(w, p, 60).some((c) => c.id === 'sword_arc' && c.awakening)).toBe(true);
  });

  it('a behaviour without a pact entry is free (the loader rejects such content; the sim does not trap the skill)', () => {
    const w = makeWorld({
      content: (c) => {
        pactsSkillUps(c);
        delete (c.balance.pacts?.byBehavior as Record<string, string>).meleeArc;
      },
    });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 6;
    expect(scan(w, p, 60).some((c) => c.id === 'sword_arc' && c.awakening)).toBe(true);
  });

  it('the pact passive is capped at its own maxRank', () => {
    const w = makeWorld({
      content: (c) => {
        pactsSkillUps(c);
        const fury = c.passives.find((x) => x.id === 'fury');
        if (fury) fury.maxRank = 1;
      },
    });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 6;
    own(p, 'fury', 1);
    expect(scan(w, p, 60).some((c) => c.id === 'sword_arc' && c.awakening)).toBe(true);
  });

  it('every skill follows its own behaviour: basic skills and talent ultimates included', () => {
    const w = makeWorld({
      content: (c) => {
        pactsSkillUps(c);
        const leap = c.skills.find((x) => x.id === 'war_leap');
        if (!leap) throw new Error('fixture skill missing');
        c.skills.push({ ...structuredClone(leap), id: 'ult_leap', kind: 'ultimate' });
      },
    });
    const p = player(w);
    const ult = giveSkill(w, 'ult_leap', 6);
    expect(ult.ultimate).toBe(true);
    skillOf(p, 'sword_arc').rank = 6; // the basic skill (meleeArc)
    skillOf(p, 'lightning_trio').rank = 4;
    let cards = scan(w, p, 80);
    expect(cards.some((c) => c.id === 'ult_leap')).toBe(false);
    expect(cards.some((c) => c.id === 'sword_arc')).toBe(false);
    own(p, 'sovereign_blood', 2); // the leap pact
    cards = scan(w, p, 80);
    expect(cards.some((c) => c.id === 'ult_leap' && c.awakening)).toBe(true);
    expect(cards.some((c) => c.id === 'sword_arc')).toBe(false); // still waiting for fury
    // the G2 card of the ultimate reads needs: sovereign_blood while the passive is missing
    ult.rank = 5;
    p.passives.length = 0;
    const g2 = scan(w, p, 80).filter((c) => c.id === 'ult_leap');
    expect(g2.length).toBeGreaterThan(0);
    for (const c of g2) expect(c.needs).toBe('sovereign_blood');
  });

  it('a banished pact passive, or no free passive slot, leaves the skill at G2 (the trade-off is real)', () => {
    const w = makeWorld({
      content: (c) => {
        pactsPassives(c);
        c.balance.maxPassives = 2;
      },
    });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 6;
    skillOf(p, 'lightning_trio').rank = 6;
    // two free passives fill the two passive slots: 'fury' can never be bought
    for (const id of ['holy_armor', 'ghostly_grasp']) own(p, id, 1);
    const cards = scan(w, p, 120);
    expect(cards.some((c) => c.id === 'fury')).toBe(false);
    expect(cards.some((c) => c.awakening)).toBe(false);
    // banishing the pact passive cancels the pact the same way
    const w2 = makeWorld({ content: (c) => pactsPassives(c) });
    const p2 = player(w2);
    skillOf(p2, 'sword_arc').rank = 6;
    p2.banished.add('fury');
    const cards2 = scan(w2, p2, 120);
    expect(cards2.some((c) => c.id === 'fury')).toBe(false);
    expect(cards2.some((c) => c.id === 'sword_arc')).toBe(false);
  });
});

describe('awakening pacts: passive cards', () => {
  it('a passive card carries pact.awakens = the owned skills that map to it; free passives carry nothing', () => {
    const w = makeWorld({ content: (c) => pactsPassives(c) });
    const p = player(w);
    giveSkill(w, 'bladewheel', 2);
    giveSkill(w, 'lunge', 1);
    const cards = scan(w, p, 200).filter((c) => c.kind === 'newPassive');
    const fury = cards.find((c) => c.id === 'fury');
    const haste = cards.find((c) => c.id === 'haste');
    const focus = cards.find((c) => c.id === 'focus');
    const eyes = cards.find((c) => c.id === 'eyes'); // no owned skill maps to it
    const free = cards.find((c) => c.id === 'holy_armor');
    expect(fury?.pact).toEqual({ awakens: ['sword_arc', 'lightning_trio'] });
    expect(haste?.pact).toEqual({ awakens: ['bladewheel'] });
    expect(focus?.pact).toEqual({ awakens: ['lunge'] });
    expect(eyes).toBeDefined();
    expect(free).toBeDefined();
    expect('pact' in (eyes as Card)).toBe(false);
    expect('pact' in (free as Card)).toBe(false);
  });

  it('a passive-up card lists the skills it still unlocks; once the pact is met, or the skill awakened, it lists nothing', () => {
    const w = makeWorld({ content: (c) => pactsPassives(c) });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 6;
    own(p, 'fury', 1);
    const up1 = scan(w, p, 200).find((c) => c.kind === 'passiveUp' && c.id === 'fury');
    expect(up1?.rank).toBe(2);
    expect(up1?.pact).toEqual({ awakens: ['sword_arc', 'lightning_trio'] });
    // an already awakened skill is no longer listed
    skillOf(p, 'lightning_trio').rank = MAX_SKILL_RANK;
    expect(scan(w, p, 200).find((c) => c.kind === 'passiveUp' && c.id === 'fury')?.pact).toEqual({ awakens: ['sword_arc'] });
    // the pact is met at rank 2: later ranks add stats only
    (p.passives[0] as PassiveInstance).rank = 2;
    const up3 = scan(w, p, 200).find((c) => c.kind === 'passiveUp' && c.id === 'fury');
    expect(up3?.rank).toBe(3);
    expect('pact' in (up3 as Card)).toBe(false);
  });

  it('the pact fields survive the co-op wire (cards go out whole as JSON)', () => {
    const w = makeWorld({ content: (c) => pactsPassives(c) });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 4;
    const passive = scan(w, p, 200).find((c) => c.id === 'fury' && c.kind === 'newPassive') as Card;
    expect(passive.pact?.awakens).toContain('sword_arc');
    expect(JSON.parse(JSON.stringify(passive))).toEqual(passive);
    skillOf(p, 'sword_arc').rank = 5;
    const g2 = scan(w, p, 200).find((c) => c.id === 'sword_arc' && c.kind === 'skillUp') as Card;
    expect(g2.needs).toBe('fury');
    expect(JSON.parse(JSON.stringify(g2))).toEqual(g2);
  });
});

describe('awakening pacts: switched off', () => {
  it('rank 0 = today: the same offers, the same rng stream and no pact fields, with or without a pacts block', () => {
    const run = (content: (c: ContentDB) => void): { offers: string; rng: number } => {
      const w = makeWorld({ content, config: { seed: 4242 } });
      const p = player(w);
      skillOf(p, 'sword_arc').rank = 6;
      skillOf(p, 'lightning_trio').rank = 5;
      giveSkill(w, 'bladewheel', 4);
      const offers: Card[] = [];
      for (let i = 0; i < 40; i++) offers.push(...buildOffer(w, p, { count: 3 }), ...buildOffer(w, p, { count: 3, rarityFloor: 2, awakenBoost: true }));
      return { offers: JSON.stringify(offers), rng: w.rng.cards.next() };
    };
    const none = run(() => undefined);
    const rank0 = run((c) => withPacts(c, { rank: 0, readyWeight: 9 }));
    const absentRank = run((c) => {
      c.balance.pacts = { byBehavior: { ...TEST_PACTS } } as ContentDB['balance']['pacts'];
    });
    expect(rank0).toEqual(none);
    expect(absentRank).toEqual(none);
    expect(none.offers).not.toContain('"needs"');
    expect(none.offers).not.toContain('"pact"');
    // and today's awakening is there: arc at G2 gets its P card without any passive
    expect(none.offers).toContain('"awakening":true');
  });

  it('rank 0: a queued second G2 card still reaches P (no pact to hold it back)', () => {
    const w = makeWorld({ content: onlySkillUps });
    const p = player(w);
    const arc = skillOf(p, 'sword_arc');
    arc.rank = 5;
    applyCard(w, p, mkCard({ kind: 'skillUp', id: 'sword_arc', rank: 6, slot: arc.slot }));
    applyCard(w, p, mkCard({ kind: 'skillUp', id: 'sword_arc', rank: 6, slot: arc.slot }));
    expect(arc.rank).toBe(MAX_SKILL_RANK);
  });
});

describe('awakening pacts: picking cards', () => {
  it('two queued offers that both carry the G2 card: the second pick stays at G2 without the pact and is not an awakening', () => {
    const w = makeWorld({ content: (c) => pactsSkillUps(c) });
    const p = player(w);
    const arc = skillOf(p, 'sword_arc');
    arc.rank = 5;
    const levelUp = openLevelUp(w, p, 2);
    const chest = openChest(w, p, null);
    const idxIn = (m: ModalRequest): number => m.cards.findIndex((c) => c.kind === 'skillUp' && c.id === 'sword_arc');
    expect(idxIn(levelUp)).toBeGreaterThanOrEqual(0);
    expect(idxIn(chest)).toBeGreaterThanOrEqual(0);
    expect(levelUp.cards[idxIn(levelUp)]?.needs).toBe('fury');
    w.bus.clear();
    expect(w.chooseCard(idxIn(levelUp))).toBe(true);
    expect(arc.rank).toBe(6);
    // the second card is a snapshot of the same G2 rank-up: it re-resolves against the live state
    const second = chest.cards[idxIn(chest)] as Card;
    expect(second.rank).toBe(6);
    expect(w.chooseCard(idxIn(chest))).toBe(true);
    expect(arc.rank).toBe(6);
    const picks = w.events.filter((e) => e.t === 'cardPick');
    expect(picks).toHaveLength(2);
    expect(picks.every((e) => e.t === 'cardPick' && !e.awakening)).toBe(true);
  });

  it('a stale awakening card (built with the pact, applied without it) holds at G2 and is not announced as an awakening', () => {
    const w = makeWorld({ content: (c) => pactsSkillUps(c) });
    const p = player(w);
    const arc = skillOf(p, 'sword_arc');
    arc.rank = 6;
    w.bus.clear();
    applyCard(w, p, mkCard({ kind: 'skillUp', id: 'sword_arc', rank: 7, awakening: true, slot: arc.slot }));
    expect(arc.rank).toBe(6);
    expect(w.events.find((e) => e.t === 'cardPick')).toMatchObject({ kind: 'skillUp', awakening: false });
    expect(w.events.some((e) => e.t === 'sfx' && e.id === 'sfx_awaken')).toBe(false);
    own(p, 'fury', 2);
    w.bus.clear();
    applyCard(w, p, mkCard({ kind: 'skillUp', id: 'sword_arc', rank: 7, awakening: true, slot: arc.slot }));
    expect(arc.rank).toBe(MAX_SKILL_RANK);
    expect(w.events.find((e) => e.t === 'cardPick')).toMatchObject({ awakening: true });
  });

  it('a new-skill card that turns into a rank-up (the skill was taken by an earlier pick) is held at G2 too', () => {
    const w = makeWorld({ content: (c) => pactsSkillUps(c) });
    const p = player(w);
    const arc = skillOf(p, 'sword_arc');
    arc.rank = 6;
    applyCard(w, p, mkCard({ kind: 'newSkill', id: 'sword_arc', slot: -1 }));
    expect(arc.rank).toBe(6);
    own(p, 'fury', 2);
    applyCard(w, p, mkCard({ kind: 'newSkill', id: 'sword_arc', slot: -1 }));
    expect(arc.rank).toBe(MAX_SKILL_RANK);
  });

  it('picking the pact passive releases the waiting skill end to end (modal -> card -> awakening)', () => {
    const w = makeWorld({
      content: (c) => {
        pactsPassives(c);
        // keep only the pact passive in the pool so the offer is deterministic
        c.passives = c.passives.filter((x) => x.id === 'fury');
      },
    });
    const p = player(w);
    const arc = skillOf(p, 'sword_arc');
    arc.rank = 6;
    skillOf(p, 'lightning_trio').rank = MAX_SKILL_RANK;
    for (const level of [2, 3]) {
      const m = openLevelUp(w, p, level);
      const idx = m.cards.findIndex((c) => c.id === 'fury');
      expect(idx, `fury offered at level ${level}`).toBeGreaterThanOrEqual(0);
      expect(m.cards[idx]?.pact).toEqual({ awakens: ['sword_arc'] });
      expect(w.chooseCard(idx)).toBe(true);
    }
    expect(p.passives.find((x) => x.id === 'fury')?.rank).toBe(2);
    const m3 = openLevelUp(w, p, 4);
    const aw = m3.cards.find((c) => c.id === 'sword_arc');
    expect(aw).toMatchObject({ kind: 'skillUp', rank: 7, awakening: true });
    expect(w.chooseCard(m3.cards.indexOf(aw as Card))).toBe(true);
    expect(arc.rank).toBe(MAX_SKILL_RANK);
  });
});

describe('awakening pacts: chest and boss offers', () => {
  /** how often the ready awakening card of sword_arc is in a chest / boss / level-up offer */
  function readyShare(readyWeight: number, kind: 'chest' | 'boss' | 'levelUp', n = 500): number {
    const w = makeWorld({
      content: (c) => {
        pactsSkillUps(c, { readyWeight });
        const fury = c.passives.find((x) => x.id === 'fury');
        if (fury) fury.maxRank = 2; // no passive-up card in the pool: every card is a skill-up
      },
      config: { seed: 77 },
    });
    const p = player(w);
    for (const id of ['bladewheel', 'lunge', 'war_leap', 'sky_blades', 'chain_lightning']) giveSkill(w, id, 2);
    skillOf(p, 'sword_arc').rank = 6;
    own(p, 'fury', 2);
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const m = kind === 'levelUp' ? openLevelUp(w, p, 2) : openChest(w, p, kind === 'boss' ? 'boss_x' : null);
      if (m.cards.some((c) => c.id === 'sword_arc' && c.awakening)) hits++;
      w.modals.length = 0;
    }
    return hits / n;
  }

  it('chest and boss offers weight a ready awakening card x readyWeight; level-ups do not', () => {
    const base = readyShare(1, 'chest');
    expect(base).toBeGreaterThan(0.35); // 3 of 6 skills: about one half
    expect(base).toBeLessThan(0.65);
    expect(readyShare(4, 'chest')).toBeGreaterThan(base + 0.15);
    expect(readyShare(4, 'boss')).toBeGreaterThan(readyShare(1, 'boss') + 0.15);
    // level-up offers are not weighted: the same offers, whatever readyWeight says
    expect(readyShare(4, 'levelUp')).toBe(readyShare(1, 'levelUp'));
  });

  it('a ready card is still one card: no duplicates, and an offer without a ready skill is unchanged by readyWeight', () => {
    const offers = (readyWeight: number): string => {
      const w = makeWorld({ content: (c) => pactsSkillUps(c, { readyWeight }), config: { seed: 5 } });
      const p = player(w);
      giveSkill(w, 'bladewheel', 3);
      skillOf(p, 'sword_arc').rank = 6; // waits for fury, which is not owned: no ready card
      const out: Card[] = [];
      for (let i = 0; i < 30; i++) out.push(...buildOffer(w, p, { count: 3, rarityFloor: 2, awakenBoost: true }));
      return JSON.stringify(out);
    };
    expect(offers(8)).toBe(offers(1));
    const w = makeWorld({ content: (c) => pactsSkillUps(c, { readyWeight: 6 }) });
    const p = player(w);
    giveSkill(w, 'bladewheel', 6);
    skillOf(p, 'sword_arc').rank = 6;
    own(p, 'fury', 2);
    own(p, 'haste', 2);
    for (let i = 0; i < 100; i++) {
      const ids = realIds(buildOffer(w, p, { count: 3, awakenBoost: true }));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('awakening pacts: co-op, hard and run options', () => {
  function coopPacts(): World {
    const w = coopWorld();
    w.balance.pacts = { rank: 2, readyWeight: 2, byBehavior: { ...TEST_PACTS } } as typeof w.balance.pacts;
    w.balance.maxActiveSkills = 0;
    w.balance.maxPassives = 0;
    return w;
  }

  it('each hero has their own pacts: one hero is held at G2 while the other awakens', () => {
    const w = coopPacts();
    const [a, b] = [player(w, 0), player(w, 1)];
    for (const p of [a, b]) for (const s of p.skills) s.rank = 6;
    own(a, 'fury', 2);
    expect(scan(w, a, 60).some((c) => c.awakening)).toBe(true);
    expect(scan(w, b, 60).some((c) => c.awakening)).toBe(false);
    // the host builds the offers: the modal of hero b is plain data that reaches the guest whole
    const m = openLevelUp(w, b, 2);
    expect(JSON.parse(JSON.stringify(m.cards))).toEqual(m.cards);
  });

  it('a late-joining guest starts with no pact passives: nothing is inherited from the host', () => {
    const w = coopPacts();
    own(player(w, 0), 'fury', 5);
    const guest = player(w, 1);
    expect(guest.passives).toHaveLength(0);
    for (const s of guest.skills) s.rank = 5;
    const g2 = scan(w, guest, 120).filter((c) => c.kind === 'skillUp' && c.rank === 6);
    expect(g2.length).toBeGreaterThan(0);
    for (const c of g2) expect(c.needs).toBeDefined();
  });

  it('hard difficulty does not change the pacts', () => {
    const w = makeWorld({ content: (c) => pactsSkillUps(c), config: { difficulty: 'hard' } });
    const p = player(w);
    const arc = skillOf(p, 'sword_arc');
    arc.rank = 5;
    expect(scan(w, p, 40).find((c) => c.id === 'sword_arc')?.needs).toBe('fury');
    arc.rank = 6;
    expect(scan(w, p, 40).some((c) => c.id === 'sword_arc')).toBe(false);
    own(p, 'fury', 2);
    expect(scan(w, p, 40).some((c) => c.id === 'sword_arc' && c.awakening)).toBe(true);
  });

  it('a level-up with the pacts on opens a modal that holds the sim, and never offers a pact-less awakening', () => {
    const w = makeWorld({ content: (c) => withPacts(c) });
    freezeSchedules(w);
    const p = player(w);
    for (const s of p.skills) s.rank = 6;
    grantXp(w, p, 1e5);
    runTicks(w, 2);
    expect(w.modal?.kind).toBe('levelUp');
    for (const c of modalOf(w).cards) expect(c.awakening).toBe(false);
    const before = w.tick;
    runTicks(w, 5);
    expect(w.tick).toBe(before); // the open modal holds the sim
  });
});

// ---------------------------------------------------------------------------
// Overflow cards (R6, OF-03): shards instead of yeop, the stacking Sky Sovereign's Boon on a full build, heal only when hurt, skip refunds

const OVERFLOW_ON = { shards: true, boon: true, skipRefund: 1 };

/** every pool is empty and every skill / passive slot is full (the hero's skills are all at P) */
function dryFullWorld(overflow: Record<string, unknown> | null = OVERFLOW_ON, extra?: (c: ContentDB) => void): World {
  const w = makeWorld({
    content: (c) => {
      c.balance.maxActiveSkills = 0;
      c.balance.maxPassives = 0;
      if (overflow) c.balance.overflow = overflow as ContentDB['balance']['overflow'];
      extra?.(c);
    },
  });
  maxAllSkills(player(w));
  return w;
}

/** the kinds of `n` consecutive offers */
function kindsOf(w: World, p: PlayerState, n: number, opts: Partial<OfferOpts> = {}): CardKind[][] {
  const out: CardKind[][] = [];
  for (let i = 0; i < n; i++) out.push(buildOffer(w, p, { count: w.balance.cardsPerLevel, ...opts }).map((c) => c.kind));
  return out;
}

describe('overflow cards: the offers', () => {
  it('a full build with dry pools gets the Boon and shards, never a yeop card', () => {
    const w = dryFullWorld();
    const p = player(w);
    for (const kinds of kindsOf(w, p, 60)) expect(kinds).toEqual(['boon', 'shards']);
  });

  it('the shards card pays the per-rarity table (2..6), has no id and no lines; the rarity floor holds', () => {
    const w = dryFullWorld();
    const p = player(w);
    const seen = new Set<Rarity>();
    for (const floor of [0, 2, 3, 4]) {
      for (let i = 0; i < 80; i++) {
        const offer = buildOffer(w, p, { count: 3, rarityFloor: floor });
        const sh = offer.find((c) => c.kind === 'shards') as Card;
        expect(sh).toBeDefined();
        expect(ri(sh.rarity)).toBeGreaterThanOrEqual(floor);
        expect(sh.amount).toBe([2, 3, 4, 5, 6][ri(sh.rarity)]);
        expect(sh.id).toBe('');
        expect(sh.lines).toEqual([]);
        expect(sh.slot).toBe(-1);
        expect(sh.replaces).toBeNull();
        seen.add(sh.rarity);
      }
    }
    expect(seen.size).toBe(RARITIES.length);
  });

  it('shardsByRarity, boonDamage and boonHp come from balance.overflow', () => {
    const w = dryFullWorld({ ...OVERFLOW_ON, shardsByRarity: [1, 1, 1, 1, 9], boonDamage: 0.05, boonHp: 0.04 });
    const p = player(w);
    for (let i = 0; i < 40; i++) {
      const [boon, sh] = buildOffer(w, p, { count: 3 }) as [Card, Card];
      expect(sh.amount).toBe(sh.rarity === 'legendary' ? 9 : 1);
      expect(boon.lines).toEqual([
        { stat: 'damage', mode: 'pct', value: 0.05 },
        { stat: 'maxHpPct', mode: 'pct', value: 0.04 },
      ]);
    }
  });

  it('the Boon card has no id, a fixed rarity, no amount, and carries the stack it becomes as its rank', () => {
    const w = dryFullWorld();
    const p = player(w);
    const boon = buildOffer(w, p, { count: 3 })[0] as Card;
    expect(boon).toMatchObject({ kind: 'boon', id: '', rarity: 'legendary', rank: 1, maxRank: 0, awakening: false, amount: 0, slot: -1, replaces: null });
    expect(boon.lines.map((l) => l.stat)).toEqual(['damage', 'maxHpPct']);
    applyCard(w, p, boon);
    applyCard(w, p, boon);
    expect((buildOffer(w, p, { count: 3 })[0] as Card).rank).toBe(3);
  });

  it('the Boon waits while a skill or a passive slot can still be filled', () => {
    // free passive slots and real passive content the hero can take: passive cards, no Boon
    const openPassive = dryFullWorld(OVERFLOW_ON, (c) => {
      c.balance.maxPassives = 6;
    });
    const hero = player(openPassive);
    for (const kinds of kindsOf(openPassive, hero, 30)) {
      expect(kinds).not.toContain('boon');
      expect(kinds).toContain('newPassive');
    }
    // free skill slots and real skills the hero can take: skill cards, no Boon (the passive bar is full)
    const openSkill = dryFullWorld(OVERFLOW_ON, (c) => {
      c.balance.maxActiveSkills = 6;
    });
    const caster = player(openSkill);
    for (const kinds of kindsOf(openSkill, caster, 30)) {
      expect(kinds).not.toContain('boon');
      expect(kinds).toContain('newSkill');
    }
  });

  it('the Boon is gated on "nothing new can be offered", not on literal slot counts', () => {
    // passive slots free but no passive content (nothing to take): the Boon and shards, as on a full bar
    const noPassives = dryFullWorld(OVERFLOW_ON, (c) => {
      c.balance.maxPassives = 6;
      c.passives = [];
    });
    for (const kinds of kindsOf(noPassives, player(noPassives), 30)) expect(kinds).toEqual(['boon', 'shards']);
    // skill slots free but every skill banished (the hero spent its banishes): the same
    const bannedSkills = dryFullWorld(OVERFLOW_ON, (c) => {
      c.balance.maxActiveSkills = 6;
    });
    const hero = player(bannedSkills);
    for (const d of bannedSkills.content.skills) if (d.kind === 'active') hero.banished.add(d.id);
    for (const kinds of kindsOf(bannedSkills, hero, 30)) expect(kinds).toEqual(['boon', 'shards']);
    // passive slots free but every passive banished: the same
    const bannedPassives = dryFullWorld(OVERFLOW_ON, (c) => {
      c.balance.maxPassives = 6;
    });
    const hero2 = player(bannedPassives);
    for (const d of bannedPassives.content.passives) hero2.banished.add(d.id);
    for (const kinds of kindsOf(bannedPassives, hero2, 30)) expect(kinds).toEqual(['boon', 'shards']);
  });

  it('a slot bar that is not full but has nothing left to fill it (every candidate banished) is offered the Boon', () => {
    const w = makeWorld({
      content: (c) => {
        c.balance.maxPassives = 0;
        c.balance.overflow = OVERFLOW_ON as ContentDB['balance']['overflow'];
      },
    });
    const p = player(w);
    maxAllSkills(p);
    const owned = new Set(p.skills.map((x) => x.def.id));
    const free = w.content.skills.filter((d) => d.kind === 'active' && !owned.has(d.id)).map((d) => d.id);
    expect(free.length).toBeGreaterThan(0);
    // while a candidate is left the offer is skill cards (no Boon) ...
    for (const kinds of kindsOf(w, p, 20)) expect(kinds).not.toContain('boon');
    // ... and once every candidate is banished the Boon takes its place, though the slot bar is not full
    for (const id of free) p.banished.add(id);
    expect(p.skills.filter((s) => !s.basic && !s.ultimate).length).toBeLessThan(w.balance.maxActiveSkills);
    for (const kinds of kindsOf(w, p, 20)) expect(kinds).toEqual(['boon', 'shards']);
  });

  it('a pool that is nearly dry is topped up with the overflow cards as well', () => {
    const w = makeWorld({
      content: (c) => {
        onlySkillUps(c);
        c.balance.maxPassives = 0;
        c.balance.overflow = OVERFLOW_ON as ContentDB['balance']['overflow'];
      },
    });
    const p = player(w); // two skill rank-ups in the pool, slots full
    for (const kinds of kindsOf(w, p, 20, { count: 4 })) expect(kinds).toEqual(['skillUp', 'skillUp', 'boon', 'shards']);
  });

  it('heal stays a fallback below 45 % hp only (a healthy hero is never offered it)', () => {
    const w = dryFullWorld();
    const p = player(w);
    p.hpMax = 100;
    p.hp = 100;
    for (const kinds of kindsOf(w, p, 30, { count: 4 })) expect(kinds).not.toContain('heal');
    p.hp = 45; // exactly 45 %: not below
    for (const kinds of kindsOf(w, p, 30, { count: 4 })) expect(kinds).not.toContain('heal');
    p.hp = 44;
    for (const kinds of kindsOf(w, p, 30, { count: 4 })) expect(kinds).toEqual(['heal', 'boon', 'shards']);
    p.hp = 1;
    expect(kindsOf(w, p, 1, { count: 2 })[0]).toEqual(['heal', 'boon']);
  });

  it('only-shards content: shards replace yeop, heal only when hurt, no Boon', () => {
    const w = dryFullWorld({ shards: true, boon: false, skipRefund: 0 });
    const p = player(w);
    for (const kinds of kindsOf(w, p, 20)) expect(kinds).toEqual(['shards']);
    p.hp = p.hpMax * 0.2;
    for (const kinds of kindsOf(w, p, 20)) expect(kinds).toEqual(['heal', 'shards']);
  });

  it('only-boon content: yeop stays the last fallback', () => {
    const w = dryFullWorld({ shards: false, boon: true });
    const p = player(w);
    for (const kinds of kindsOf(w, p, 20)) expect(kinds).toEqual(['boon', 'yeop']);
  });

  it('the essence offer falls back the same way when the stones and trinkets are exhausted', () => {
    const noGear = (c: ContentDB): void => {
      c.stones = [];
      c.trinkets = [];
    };
    const w = dryFullWorld(OVERFLOW_ON, noGear);
    for (const offer of scanEssence(w, player(w), 20)) expect(offer.map((c) => c.kind)).toEqual(['boon', 'shards']);
    const off = dryFullWorld(null, noGear);
    for (const offer of scanEssence(off, player(off), 5)) expect(offer.map((c) => c.kind)).toEqual(['heal', 'yeop']);
  });

  it('chest and boss rewards on a dry build are the overflow cards too (never filler)', () => {
    const w = dryFullWorld();
    const p = player(w);
    const chest = openChest(w, p, null);
    expect(chest.cards.map((c) => c.kind)).toEqual(['boon', 'shards']);
    expect(ri((chest.cards[1] as Card).rarity)).toBeGreaterThanOrEqual(2);
    w.modals.length = 0;
    const boss = openChest(w, p, 'boss_x');
    expect(boss.cards.map((c) => c.kind)).toEqual(['boon', 'shards']);
    expect(ri((boss.cards[1] as Card).rarity)).toBeGreaterThanOrEqual(3);
  });

  it('absent overflow, or both switches off: heal then yeop exactly as before, the same rng stream', () => {
    const run = (overflow: Record<string, unknown> | null): { kinds: string[]; rng: unknown } => {
      const w = dryFullWorld(overflow);
      const p = player(w);
      p.hp = p.hpMax; // healthy: the old fallback still offers the heal
      const kinds: string[] = [];
      for (let i = 0; i < 25; i++) for (const c of buildOffer(w, p, { count: 3, rarityFloor: i % 3 })) kinds.push(`${c.kind}:${c.rarity}:${c.amount}`);
      return { kinds, rng: w.rng.cards.getState() };
    };
    const absent = run(null);
    expect(absent.kinds.some((k) => k.startsWith('heal:'))).toBe(true);
    expect(absent.kinds.some((k) => k.startsWith('yeop:'))).toBe(true);
    expect(absent.kinds.some((k) => k.startsWith('shards:') || k.startsWith('boon:'))).toBe(false);
    expect(run({ shards: false, boon: false, skipRefund: 3 })).toEqual(absent);
    expect(run({})).toEqual(absent);
  });

  it('banish: the overflow cards are fillers (no id), they cannot be banished and the replacement never doubles one', () => {
    const w = dryFullWorld();
    const p = player(w);
    const m = openLevelUp(w, p, 2);
    expect(m.cards.map((c) => c.kind)).toEqual(['boon', 'shards']);
    expect(w.banish(0)).toBe(false);
    expect(w.banish(1)).toBe(false);
    expect(p.banishes).toBe(2);
    expect(p.banished.size).toBe(0);
    // a banish elsewhere in the offer never duplicates a shown overflow card
    const w2 = makeWorld({
      content: (c) => {
        onlySkillUps(c);
        c.balance.maxPassives = 0;
        c.balance.overflow = OVERFLOW_ON as ContentDB['balance']['overflow'];
      },
    });
    const p2 = player(w2);
    const m2 = openLevelUp(w2, p2, 2);
    expect(m2.cards.map((c) => c.kind)).toEqual(['skillUp', 'skillUp', 'boon']);
    expect(w2.banish(0)).toBe(true);
    expect(m2.cards.filter((c) => c.kind === 'boon')).toHaveLength(1);
    expect(m2.cards.filter((c) => c.kind === 'shards').length).toBeLessThanOrEqual(1);
  });

  it('reroll of a dry offer is a fresh overflow offer', () => {
    const w = dryFullWorld();
    const p = player(w);
    const m = openLevelUp(w, p, 2);
    expect(w.reroll()).toBe(true);
    expect(m.cards.map((c) => c.kind)).toEqual(['boon', 'shards']);
    expect(p.rerolls).toBe(2);
  });
});

describe('overflow cards: picking them', () => {
  it('a shards card banks its shards in p.shards (not in yeop), tells the bus and the run result carries them', () => {
    const w = dryFullWorld();
    const p = player(w);
    const m = openLevelUp(w, p, 2);
    const i = m.cards.findIndex((c) => c.kind === 'shards');
    const amount = (m.cards[i] as Card).amount;
    expect(amount).toBeGreaterThanOrEqual(2);
    const yeop = p.yeop;
    const earned = p.yeopEarned;
    w.bus.clear();
    expect(w.chooseCard(i)).toBe(true);
    expect(p.shards).toBe(amount);
    expect(p.yeop).toBe(yeop);
    expect(p.yeopEarned).toBe(earned);
    expect(w.modals).toHaveLength(0);
    expect(w.events.find((e) => e.t === 'cardPick')).toMatchObject({ player: 0, kind: 'shards', id: '' });
    expect(buildResult(w, true).shards).toBe(amount);
    expect(buildResult(w, false).shards).toBe(amount);
  });

  it('shards accumulate over picks; a malformed amount banks nothing', () => {
    const w = dryFullWorld();
    const p = player(w);
    applyCard(w, p, mkCard({ kind: 'shards', amount: 4 }));
    applyCard(w, p, mkCard({ kind: 'shards', amount: 6 }));
    applyCard(w, p, mkCard({ kind: 'shards', amount: -5 }));
    applyCard(w, p, mkCard({ kind: 'shards', amount: Number.NaN }));
    expect(p.shards).toBe(10);
  });

  it('the Boon stacks without a limit: +3 % damage and +2 % max hp per pick, hp grows with the maximum', () => {
    const w = dryFullWorld();
    const p = player(w);
    refreshStats(p, w.content, w.ix);
    const dmg0 = p.stats.damage;
    const hpMax0 = p.stats.maxHp;
    const classHp = (w.ix.classes.get(p.classId) as { base: { maxHp: number } }).base.maxHp; // max hp% adds to the class base, on top of the empire's
    p.hp = p.hpMax;
    expect(boonCount(p)).toBe(0);
    const fixed0 = p.fixed.length;
    for (let n = 1; n <= 40; n++) {
      const boon = buildOffer(w, p, { count: 3 })[0] as Card;
      expect(boon.kind).toBe('boon');
      applyCard(w, p, boon);
      expect(p.statsDirty).toBe(true);
      refreshStats(p, w.content, w.ix);
      expect(boonCount(p)).toBe(n);
      expect(p.stats.damage).toBeCloseTo(dmg0 + 0.03 * n, 9);
      expect(p.stats.maxHp).toBeCloseTo(hpMax0 + classHp * 0.02 * n, 6);
      expect(p.hp).toBeCloseTo(p.hpMax, 6);
    }
    expect(p.fixed).toHaveLength(fixed0 + 40);
  });

  it("a Boon picked through the modal is applied once and survives a stats refresh from scratch", () => {
    const w = dryFullWorld();
    const p = player(w);
    refreshStats(p, w.content, w.ix);
    const base = p.stats.damage;
    const m = openLevelUp(w, p, 2);
    expect(w.chooseCard(m.cards.findIndex((c) => c.kind === 'boon'))).toBe(true);
    refreshStats(p, w.content, w.ix);
    refreshStats(p, w.content, w.ix);
    expect(p.stats.damage).toBeCloseTo(base + 0.03, 9);
    expect(boonCount(p)).toBe(1);
  });

  it('a configured boonDamage of 0 adds no damage (the max hp part still stacks)', () => {
    const w = dryFullWorld({ ...OVERFLOW_ON, boonDamage: 0, boonHp: 0.1 });
    const p = player(w);
    refreshStats(p, w.content, w.ix);
    const dmg = p.stats.damage;
    const hpMax = p.stats.maxHp;
    const classHp = (w.ix.classes.get(p.classId) as { base: { maxHp: number } }).base.maxHp;
    applyCard(w, p, mkCard({ kind: 'boon' }));
    refreshStats(p, w.content, w.ix);
    expect(p.stats.damage).toBeCloseTo(dmg, 9);
    expect(p.stats.maxHp).toBeCloseTo(hpMax + classHp * 0.1, 6);
  });

  it('a picked Boon keeps working through a revive and a real death (death changes nothing about the stack)', () => {
    const w = dryFullWorld();
    const p = player(w);
    p.fixed.push({ revives: 1 });
    for (let i = 0; i < 10; i++) applyCard(w, p, mkCard({ kind: 'boon' }));
    refreshStats(p, w.content, w.ix);
    const hpMax = p.hpMax;
    expect(hpMax).toBeGreaterThan(100);
    p.iframes = 0;
    hurtPlayer(w, 0, hpMax * 10, p.x, p.z, 0, HurtKind.Melee);
    expect(p.alive).toBe(true); // the revive
    expect(p.hp).toBeCloseTo(hpMax * 0.5, 6);
    expect(boonCount(p)).toBe(10);
    p.iframes = 0;
    hurtPlayer(w, 0, hpMax * 10, p.x, p.z, 0, HurtKind.Melee);
    expect(p.alive).toBe(false);
    applyCard(w, p, mkCard({ kind: 'boon' }));
    refreshStats(p, w.content, w.ix);
    expect(p.alive).toBe(false);
    expect(boonCount(p)).toBe(11);
  });

  it('a queued newSkill / newPassive that no longer fits turns into shards instead of yeop (yeop when the switch is off)', () => {
    const w = dryFullWorld();
    const p = player(w);
    const yeop = p.yeop;
    applyCard(w, p, mkCard({ kind: 'newPassive', id: 'fury', rarity: 'epic', rank: 1 }));
    expect(p.passives).toHaveLength(0);
    expect(p.shards).toBe(5);
    applyCard(w, p, mkCard({ kind: 'newSkill', id: 'bladewheel', rarity: 'rare', rank: 0 }));
    expect(p.shards).toBe(5 + 4);
    expect(p.yeop).toBe(yeop);
    const off = dryFullWorld(null);
    const q = player(off);
    applyCard(off, q, mkCard({ kind: 'newPassive', id: 'fury', rarity: 'epic', rank: 1 }));
    expect(q.shards).toBe(0);
    expect(q.yeop).toBe(Math.round((30 + 6 * q.level) * RARITY_MULT.epic));
  });

  it('with the pools dry the whole modal flow runs: level-up opens, the sim is held, the pick resolves', () => {
    const w = dryFullWorld();
    freezeSchedules(w);
    const p = player(w);
    grantXp(w, p, 1e5);
    runTicks(w, 2);
    expect(w.modal?.kind).toBe('levelUp');
    expect(modalOf(w).cards.map((c) => c.kind)).toEqual(['boon', 'shards']);
    const tick = w.tick;
    runTicks(w, 5);
    expect(w.tick).toBe(tick); // the open modal holds the sim
    expect(w.chooseCard(0)).toBe(true);
    expect(boonCount(p)).toBe(1);
  });
});

describe('overflow cards: skip', () => {
  it('a skipped level-up refunds skipRefund shards (1) and spends the skip', () => {
    const w = dryFullWorld();
    const p = player(w);
    const m = openLevelUp(w, p, 2);
    const skips = p.skips;
    expect(m.canSkip).toBe(true);
    expect(w.skip()).toBe(true);
    expect(p.shards).toBe(1);
    expect(p.skips).toBe(skips - 1);
    expect(w.modals).toHaveLength(0);
    // no skips left: nothing is refunded
    p.skips = 0;
    openLevelUp(w, p, 3);
    expect(w.skip()).toBe(false);
    expect(p.shards).toBe(1);
  });

  it('the refund follows balance.overflow.skipRefund and needs the shards switch', () => {
    const w3 = dryFullWorld({ ...OVERFLOW_ON, skipRefund: 3 });
    openLevelUp(w3, player(w3), 2);
    w3.skip();
    expect(player(w3).shards).toBe(3);
    for (const ov of [null, { shards: true, boon: true, skipRefund: 0 }, { shards: false, boon: true, skipRefund: 5 }, { shards: false, boon: false, skipRefund: 5 }]) {
      const w = dryFullWorld(ov);
      openLevelUp(w, player(w), 2);
      expect(w.skip()).toBe(true);
      expect(player(w).shards).toBe(0);
    }
  });

  it('an essence offer refunds as well; a chest or boss reward cannot be skipped (no refund)', () => {
    const w = dryFullWorld();
    const p = player(w);
    openEssence(w, p, 'metin_lament', false);
    expect(w.skip()).toBe(true);
    expect(p.shards).toBe(1);
    p.skips = 1;
    openChest(w, p, null);
    expect(w.skip()).toBe(false);
    expect(p.shards).toBe(1);
    expect(p.skips).toBe(1);
  });
});

describe('overflow cards: co-op', () => {
  function coopDry(): World {
    return makeWorld({
      config: { coop: [COOP_HERO] },
      content: (c) => {
        c.balance.maxActiveSkills = 0;
        c.balance.maxPassives = 0;
        c.balance.overflow = OVERFLOW_ON as ContentDB['balance']['overflow'];
      },
    });
  }

  it('each hero is offered, picks and is credited on its own: a guest shard pick reaches the guest result, not the host', () => {
    const w = coopDry();
    const host = player(w, 0);
    const guest = player(w, 1);
    maxAllSkills(host);
    maxAllSkills(guest);
    const m = openLevelUp(w, guest, 2);
    expect(m.player).toBe(1);
    expect(m.cards.map((c) => c.kind)).toEqual(['boon', 'shards']);
    // the host builds the offer, the guest receives the cards whole (JSON) and answers with an index
    const onWire = JSON.parse(JSON.stringify(m.cards)) as Card[];
    expect(onWire).toEqual(m.cards);
    const si = onWire.findIndex((c) => c.kind === 'shards');
    const amount = (onWire[si] as Card).amount;
    expect(w.chooseCard(si, 1)).toBe(true);
    expect(guest.shards).toBe(amount);
    expect(host.shards).toBe(0);
    // the result the guest settles with (its own shards), over the relay wire
    const own = buildPlayerResult(w, true, 1);
    expect(own.shards).toBe(amount);
    expect(buildPlayerResult(w, true, 0).shards).toBe(0);
    const text = JSON.stringify(encodeResult(own));
    expect(text.length).toBeLessThan(1500);
    expect((decodeResult(JSON.parse(text)) as RunResult).shards).toBe(amount);
    // the HUD field the mirrors read
    expect(buildHud(w, 1).shards).toBe(amount);
  });

  it("the Boon gate is per hero: a guest with nothing left to take gets the Boon, a host with a free slot and candidates does not", () => {
    const w = makeWorld({
      config: { coop: [COOP_HERO] },
      content: (c) => {
        c.balance.maxPassives = 0;
        c.balance.overflow = OVERFLOW_ON as ContentDB['balance']['overflow'];
      },
    });
    const host = player(w, 0);
    const guest = player(w, 1);
    maxAllSkills(host);
    maxAllSkills(guest);
    // the guest banished every skill it could still take (its own banish list); the host still has candidates and free slots
    const owned = new Set(guest.skills.map((x) => x.def.id));
    for (const d of w.content.skills) if (d.kind === 'active' && !owned.has(d.id)) guest.banished.add(d.id);
    const mg = openLevelUp(w, guest, 2);
    expect(mg.player).toBe(1);
    expect(mg.cards.map((c) => c.kind)).toEqual(['boon', 'shards']);
    const mh = openLevelUp(w, host, 2);
    expect(mh.cards.map((c) => c.kind)).not.toContain('boon');
    expect(mh.cards.some((c) => c.kind === 'newSkill')).toBe(true);
    // the card travels whole to the guest and lands on the guest only
    const onWire = JSON.parse(JSON.stringify(mg.cards)) as Card[];
    expect(onWire).toEqual(mg.cards);
    expect(w.chooseCard(0, 1)).toBe(true);
    expect(boonCount(guest)).toBe(1);
    expect(boonCount(host)).toBe(0);
  });

  it("a Boon is the picker's own: the other hero's stats are untouched, a skip refunds the skipper only", () => {
    const w = coopDry();
    const host = player(w, 0);
    const guest = player(w, 1);
    refreshStats(host, w.content, w.ix);
    refreshStats(guest, w.content, w.ix);
    const hostDmg = host.stats.damage;
    const guestDmg = guest.stats.damage;
    applyCard(w, guest, mkCard({ kind: 'boon' }));
    refreshStats(host, w.content, w.ix);
    refreshStats(guest, w.content, w.ix);
    expect(host.stats.damage).toBeCloseTo(hostDmg, 9);
    expect(guest.stats.damage).toBeCloseTo(guestDmg + 0.03, 9);
    expect(boonCount(host)).toBe(0);
    expect(boonCount(guest)).toBe(1);
    openLevelUp(w, host, 2);
    expect(w.skip(0)).toBe(true);
    expect(host.shards).toBe(1);
    expect(guest.shards).toBe(0);
  });

  it('a late joiner starts without boons: the offer stack comes from the joiner own build', () => {
    const w = coopDry();
    const host = player(w, 0);
    for (let i = 0; i < 5; i++) applyCard(w, host, mkCard({ kind: 'boon' }));
    const late = player(w, 1);
    expect(boonCount(late)).toBe(0);
    maxAllSkills(late);
    expect((buildOffer(w, late, { count: 3 })[0] as Card).rank).toBe(1);
    maxAllSkills(host);
    expect((buildOffer(w, host, { count: 3 })[0] as Card).rank).toBe(6);
  });
});

describe('overflow cards: the run end', () => {
  it('hard difficulty: the picked shards are part of RunResult.shards at the end of the run', () => {
    const w = makeWorld({
      config: { difficulty: 'hard' },
      content: (c) => {
        c.balance.maxActiveSkills = 0;
        c.balance.maxPassives = 0;
        c.balance.overflow = OVERFLOW_ON as ContentDB['balance']['overflow'];
      },
    });
    const p = player(w);
    maxAllSkills(p);
    const shown = buildOffer(w, p, { count: 3 }).find((c) => c.kind === 'shards') as Card;
    applyCard(w, p, shown);
    applyCard(w, p, shown);
    const r = buildResult(w, true);
    expect(r.shards).toBe(shown.amount * 2);
    expect(r.rewardMul).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// OF-04: the chest size comes from balance.chest.cards, boss rewards are build milestones (balance.chest.bossMilestone)

const ESSENCE_ONLY_KINDS: readonly CardKind[] = ['stone', 'stoneUp', 'trinket', 'trinketUp'];
const REAL_LEVEL_UP_KINDS: readonly CardKind[] = ['newSkill', 'skillUp', 'newPassive', 'passiveUp'];
const FILLER_KINDS: readonly CardKind[] = ['heal', 'yeop', 'shards', 'boon'];

/** content tweak: the boss reward is the three-card build milestone */
function milestoneOn(c: ContentDB): void {
  c.balance.chest = { ...c.balance.chest, bossMilestone: true };
}

/** content tweak: pacts on (fury / haste / ... as in the pact tests) and the milestone on */
function pactsAndMilestone(c: ContentDB): void {
  withPacts(c);
  milestoneOn(c);
}

/** the opened reward (the modal is removed again so the next one can be opened on the same world) */
function reward(w: World, p: PlayerState, boss: string | null = 'boss_horyeong'): ModalRequest {
  const m = openChest(w, p, boss);
  w.modals.length = 0;
  return m;
}

describe('chest size from balance.chest.cards (OF-04)', () => {
  it('absent: a chest offers cardsPerLevel cards, whatever cardsPerLevel is', () => {
    for (const n of [2, 3, 4]) {
      const w = makeWorld({ content: (c) => void (c.balance.cardsPerLevel = n) });
      expect(w.balance.chest).toBeUndefined();
      for (let i = 0; i < 20; i++) expect(reward(w, player(w), null).cards, `cardsPerLevel ${n}`).toHaveLength(n);
    }
  });

  it('chest.cards (1..4) is the size of an ordinary chest; level-ups keep cardsPerLevel', () => {
    for (const n of [1, 2, 3, 4]) {
      const w = makeWorld({ content: (c) => void (c.balance.chest = { cards: n }) });
      const p = player(w);
      for (let i = 0; i < 20; i++) {
        const m = reward(w, p, null);
        expect(m.kind).toBe('chest');
        expect(m.cards, `chest.cards ${n}`).toHaveLength(n);
        for (const c of m.cards) expect(ri(c.rarity)).toBeGreaterThanOrEqual(2);
      }
      const lvl = openLevelUp(w, p, 2);
      expect(lvl.cards).toHaveLength(w.balance.cardsPerLevel);
    }
  });

  it('chest.cards wins over cardsPerLevel, and the offer never repeats an id', () => {
    const w = makeWorld({ content: (c) => ((c.balance.cardsPerLevel = 3), (c.balance.chest = { cards: 4 })) });
    const p = player(w);
    for (let i = 0; i < 60; i++) {
      const m = reward(w, p, null);
      expect(m.cards).toHaveLength(4);
      const ids = realIds(m.cards);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("today's boss offer (no milestone) is the chest offer at epic+, of the same size", () => {
    const w = makeWorld({ content: (c) => void (c.balance.chest = { cards: 4 }) });
    const m = reward(w, player(w));
    expect(m.kind).toBe('bossReward');
    expect(m.cards).toHaveLength(4);
    for (const c of m.cards) expect(ri(c.rarity)).toBeGreaterThanOrEqual(3);
  });
});

describe('boss rewards as build milestones (OF-04)', () => {
  it('three epic+ cards in a fixed order: rank-up / awakening, essence, level-up; no filler, no duplicate ids', () => {
    const w = makeWorld({ content: milestoneOn });
    const p = player(w);
    for (let i = 0; i < 120; i++) {
      const m = openChest(w, p, 'boss_horyeong');
      expect(m.kind).toBe('bossReward');
      expect(m.free).toBe(true);
      expect(m.source).toBe('boss_horyeong');
      expect([m.canReroll, m.canBanish, m.canSkip]).toEqual([false, false, false]);
      expect(m.cards).toHaveLength(3);
      const [build, essence, levelUp] = m.cards as [Card, Card, Card];
      expect(build.kind).toBe('skillUp');
      expect(ESSENCE_ONLY_KINDS).toContain(essence.kind);
      expect(REAL_LEVEL_UP_KINDS).toContain(levelUp.kind);
      for (const c of m.cards) {
        expect(FILLER_KINDS, `${c.kind} is a filler`).not.toContain(c.kind);
        expect(c.id).not.toBe('');
        expect(ri(c.rarity), `${c.kind} ${c.id} ${c.rarity}`).toBeGreaterThanOrEqual(3);
      }
      const ids = realIds(m.cards);
      expect(new Set(ids).size).toBe(ids.length);
      // mixed kinds: a skill card, an essence card and a (skill or passive) level-up card
      expect(new Set(m.cards.map((c) => c.kind)).size).toBeGreaterThanOrEqual(2);
      w.modals.length = 0;
    }
  });

  it('with no pact ready the first card is the rank-up of the lowest-ranked skill', () => {
    const w = makeWorld({ content: pactsAndMilestone });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 6; // G2: the awakening waits for fury, which is not owned
    skillOf(p, 'lightning_trio').rank = 2;
    giveSkill(w, 'bladewheel', 4);
    for (let i = 0; i < 40; i++) {
      const [first] = reward(w, p).cards as [Card];
      expect(first).toMatchObject({ kind: 'skillUp', id: 'lightning_trio', rank: 3, awakening: false });
    }
    // equal ranks: either skill, the rng's choice
    skillOf(p, 'lightning_trio').rank = 4;
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) seen.add((reward(w, p).cards[0] as Card).id);
    expect([...seen].sort()).toEqual(['bladewheel', 'lightning_trio']);
  });

  it('a ready pact is the first card, an awakening, however low the other skills are', () => {
    const w = makeWorld({ content: pactsAndMilestone });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 6;
    skillOf(p, 'lightning_trio').rank = 0;
    own(p, 'fury', 2);
    for (let i = 0; i < 60; i++) {
      const [first] = reward(w, p).cards as [Card];
      expect(first).toMatchObject({ kind: 'skillUp', id: 'sword_arc', rank: MAX_SKILL_RANK, awakening: true });
      expect('needs' in first).toBe(false);
    }
  });

  it('two ready pacts: the awakening is either of them', () => {
    const w = makeWorld({ content: pactsAndMilestone });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 6;
    skillOf(p, 'lightning_trio').rank = 6;
    giveSkill(w, 'bladewheel', 1);
    own(p, 'fury', 2);
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const first = reward(w, p).cards[0] as Card;
      expect(first.awakening).toBe(true);
      seen.add(first.id);
    }
    expect([...seen].sort()).toEqual(['lightning_trio', 'sword_arc']);
  });

  it('pacts off: every G2 skill is ready, its rank-up is the awakening', () => {
    const w = makeWorld({ content: milestoneOn });
    expect(w.balance.pacts).toBeUndefined();
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 6;
    for (let i = 0; i < 30; i++) expect(reward(w, p).cards[0]).toMatchObject({ kind: 'skillUp', id: 'sword_arc', awakening: true });
  });

  it('the G1 -> G2 rank-up of the lowest skill carries `needs` while its pact is missing', () => {
    const w = makeWorld({ content: pactsAndMilestone });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 5;
    skillOf(p, 'lightning_trio').rank = 5;
    for (let i = 0; i < 20; i++) {
      const [first] = reward(w, p).cards as [Card];
      expect(first.rank).toBe(MAX_SKILL_RANK - 1);
      expect(first.awakening).toBe(false);
      expect(typeof first.needs).toBe('string');
      expect(first.needs).toBeTruthy();
    }
  });

  it('a banished skill is never the rank-up', () => {
    const w = makeWorld({ content: milestoneOn });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 3;
    skillOf(p, 'lightning_trio').rank = 0;
    p.banished.add('lightning_trio');
    for (let i = 0; i < 40; i++) {
      const m = reward(w, p);
      expect(m.cards[0]).toMatchObject({ kind: 'skillUp', id: 'sword_arc' });
      expect(realIds(m.cards)).not.toContain('lightning_trio');
    }
  });

  it('the essence card is a spirit stone or a trinket, epic+, that picking puts into the hero', () => {
    const w = makeWorld({ content: milestoneOn });
    const p = player(w);
    const kinds = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const c = reward(w, p).cards[1] as Card;
      expect(ESSENCE_ONLY_KINDS).toContain(c.kind);
      expect(ri(c.rarity)).toBeGreaterThanOrEqual(3);
      expect(c.lines.length).toBeGreaterThan(0);
      kinds.add(c.kind);
    }
    expect(kinds.has('stone')).toBe(true);
    expect(kinds.has('trinket')).toBe(true);
    // picking it: the stone / trinket lands in a slot
    for (let i = 0; i < 12; i++) {
      const fresh = makeWorld({ content: milestoneOn, config: { seed: 100 + i } });
      const hero = player(fresh);
      const m = openChest(fresh, hero, 'boss_horyeong');
      const essence = m.cards[1] as Card;
      expect(fresh.chooseCard(1)).toBe(true);
      const held = [...hero.stones, ...hero.trinkets].filter((x) => x && x.id === essence.id);
      expect(held, `${essence.kind} ${essence.id}`).toHaveLength(1);
    }
  });

  it('picking the awakening card awakens the skill and plays the awaken cue', () => {
    const w = makeWorld({ content: pactsAndMilestone });
    const p = player(w);
    const arc = skillOf(p, 'sword_arc');
    arc.rank = 6;
    own(p, 'fury', 2);
    openChest(w, p, 'boss_horyeong');
    w.bus.clear();
    expect(w.chooseCard(0)).toBe(true);
    expect(arc.rank).toBe(MAX_SKILL_RANK);
    expect(w.events.find((e) => e.t === 'cardPick')).toMatchObject({ kind: 'skillUp', id: 'sword_arc', awakening: true });
    expect(w.events.some((e) => e.t === 'sfx' && e.id === 'sfx_awaken')).toBe(true);
    expect(w.modals).toHaveLength(0);
  });

  it('every card of the milestone can be picked: skill rank, essence slot and level-up land in the hero', () => {
    const snap = (p: PlayerState): string =>
      JSON.stringify([p.skills.map((s) => [s.def.id, s.rank]), p.passives.map((x) => [x.id, x.rank]), p.stones, p.trinkets]);
    for (const index of [0, 1, 2]) {
      const w = makeWorld({ content: milestoneOn, config: { seed: 40 + index } });
      const p = player(w);
      const m = openChest(w, p, 'boss_horyeong');
      const card = m.cards[index] as Card;
      const before = snap(p);
      expect(w.chooseCard(index)).toBe(true);
      expect(snap(p), `${card.kind} ${card.id}`).not.toBe(before);
      expect(w.modals).toHaveLength(0);
    }
  });

  it('stones and trinkets all taken: one more level-up card instead, still three real cards', () => {
    const w = makeWorld({
      content: (c) => {
        milestoneOn(c);
        c.stones = [];
        c.trinkets = [];
      },
    });
    const p = player(w);
    for (let i = 0; i < 60; i++) {
      const m = reward(w, p);
      expect(m.cards).toHaveLength(3);
      expect(m.cards[0]?.kind).toBe('skillUp');
      for (const c of m.cards) {
        expect(REAL_LEVEL_UP_KINDS).toContain(c.kind);
        expect(ri(c.rarity)).toBeGreaterThanOrEqual(3);
      }
      const ids = realIds(m.cards);
      expect(new Set(ids).size).toBe(3);
    }
  });

  it('every skill at P: no skill-up card, the other cards are real ones', () => {
    const w = makeWorld({ content: milestoneOn });
    const p = player(w);
    maxAllSkills(p);
    for (let i = 0; i < 60; i++) {
      const m = reward(w, p);
      expect(m.cards.length).toBeGreaterThanOrEqual(2);
      for (const c of m.cards) {
        expect(c.kind).not.toBe('skillUp');
        expect(FILLER_KINDS).not.toContain(c.kind);
      }
      expect(ESSENCE_ONLY_KINDS).toContain((m.cards[0] as Card).kind);
    }
  });

  it('a dry build (every slot full, every skill at P): the Boon next to the essence, never heal / yeop / shards', () => {
    const w = dryFullWorld(OVERFLOW_ON, milestoneOn);
    const p = player(w);
    p.hp = 1; // hurt: the ordinary dry chest would offer the heal as well
    for (let i = 0; i < 30; i++) {
      const m = reward(w, p);
      expect(ESSENCE_ONLY_KINDS).toContain((m.cards[0] as Card).kind);
      expect(m.cards.map((c) => c.kind).slice(1)).toEqual(['boon']);
    }
    // nothing to take at all: the Boon alone
    const bare = dryFullWorld(OVERFLOW_ON, (c) => {
      milestoneOn(c);
      c.stones = [];
      c.trinkets = [];
    });
    expect(reward(bare, player(bare)).cards.map((c) => c.kind)).toEqual(['boon']);
  });

  it('a build with nothing at all left and no overflow rules gets what a dry chest gets (the last resort)', () => {
    const w = dryFullWorld(null, (c) => {
      milestoneOn(c);
      c.stones = [];
      c.trinkets = [];
    });
    const p = player(w);
    expect(reward(w, p).cards.map((c) => c.kind)).toEqual(['heal', 'yeop']);
  });

  it('chest.cards does not change the milestone, and an ordinary chest is not a milestone', () => {
    const w = makeWorld({ content: (c) => void (c.balance.chest = { bossMilestone: true, cards: 4 }) });
    const p = player(w);
    for (let i = 0; i < 20; i++) {
      expect(reward(w, p).cards).toHaveLength(3);
      const chest = reward(w, p, null);
      expect(chest.kind).toBe('chest');
      expect(chest.cards).toHaveLength(4);
    }
    const plain = makeWorld({ content: milestoneOn });
    const kinds = new Set<string>();
    for (let i = 0; i < 80; i++) for (const c of reward(plain, player(plain), null).cards) kinds.add(c.kind);
    // a plain chest still rolls the level-up pool only (rare+): it never contains an essence card
    for (const k of ESSENCE_ONLY_KINDS) expect(kinds.has(k), k).toBe(false);
  });

  it('is deterministic per seed and draws only from the cards stream', () => {
    const run = (): { cards: Card[]; rng: Record<string, unknown> } => {
      const w = makeWorld({ content: milestoneOn, config: { seed: 4242 } });
      const p = player(w);
      const streams = (): Record<string, unknown> => Object.fromEntries(Object.entries(w.rng).map(([k, v]) => [k, (v as { getState(): unknown }).getState()]));
      const before = streams();
      const cards = openChest(w, p, 'boss_horyeong').cards;
      const after = streams();
      for (const k of Object.keys(before)) if (k !== 'cards') expect(after[k], `stream ${k}`).toEqual(before[k]);
      expect(after.cards).not.toEqual(before.cards);
      return { cards, rng: after };
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(a.cards)).toBe(JSON.stringify(b.cards));
    expect(a.rng).toEqual(b.rng);
  });

  it('hard difficulty and Run Options at their maximum: the same composition', () => {
    const w = makeWorld({ content: milestoneOn, config: { difficulty: 'hard', runOptions: { density: 3, health: 3, damage: 3, speed: 3 } } });
    const p = player(w);
    for (let i = 0; i < 40; i++) {
      const m = reward(w, p);
      expect(m.cards.map((c) => c.kind)[0]).toBe('skillUp');
      expect(ESSENCE_ONLY_KINDS).toContain((m.cards[1] as Card).kind);
      expect(m.cards).toHaveLength(3);
    }
  });

  it('a high luck shifts the rarity but the epic floor holds', () => {
    const w = makeWorld({ content: milestoneOn });
    const p = player(w);
    p.stats.luck = 1;
    const seen = new Set<Rarity>();
    for (let i = 0; i < 120; i++) for (const c of reward(w, p).cards) seen.add(c.rarity);
    expect([...seen].sort()).toEqual(['epic', 'legendary']);
  });
});

describe('bossMilestone off = today (OF-04)', () => {
  /** the boss offers of 40 consecutive rewards, and where the cards stream stands afterwards */
  function bossOffers(c?: (c: ContentDB) => void): { offers: string; state: unknown } {
    const w = makeWorld({ content: c, config: { seed: 31 } });
    const p = player(w);
    skillOf(p, 'sword_arc').rank = 6;
    const out: Card[][] = [];
    for (let i = 0; i < 40; i++) out.push(reward(w, p).cards);
    return { offers: JSON.stringify(out), state: w.rng.cards.getState() };
  }

  it('absent, false and a chest block without the flag are the same offers and the same rng stream', () => {
    const absent = bossOffers();
    const off = bossOffers((c) => void (c.balance.chest = { bossMilestone: false }));
    const other = bossOffers((c) => void (c.balance.chest = { eliteDrop: 0.2 }));
    expect(off).toEqual(absent);
    expect(other).toEqual(absent);
    const on = bossOffers(milestoneOn);
    expect(on.offers).not.toBe(absent.offers);
  });

  it("false is buildOffer(cardsPerLevel cards, epic floor, awakening boost) exactly: today's boss offer", () => {
    const direct = makeWorld({ config: { seed: 77 } });
    const viaChest = makeWorld({ content: (c) => void (c.balance.chest = { bossMilestone: false }), config: { seed: 77 } });
    for (let i = 0; i < 25; i++) {
      const want = buildOffer(direct, player(direct), { count: direct.balance.cardsPerLevel, rarityFloor: 3, awakenBoost: true });
      expect(reward(viaChest, player(viaChest)).cards).toEqual(want);
    }
    expect(viaChest.rng.cards.getState()).toEqual(direct.rng.cards.getState());
  });

  it('the flag changes boss rewards only: ordinary chests, level-ups and essence offers are bit for bit the same', () => {
    const offers = (c?: (c: ContentDB) => void): string => {
      const w = makeWorld({ content: c, config: { seed: 8 } });
      const p = player(w);
      const out: unknown[] = [];
      for (let i = 0; i < 20; i++) {
        out.push(reward(w, p, null).cards, openLevelUp(w, p, 2 + i).cards, openEssence(w, p, 'metin_lament', i % 2 === 0).cards);
        w.modals.length = 0;
      }
      return JSON.stringify(out);
    };
    expect(offers(milestoneOn)).toBe(offers());
  });
});

describe('boss milestones: co-op (OF-04)', () => {
  it('every hero is offered a milestone of its own build, built on the host; a hero with a ready pact gets the awakening', () => {
    const w = makeWorld({ content: pactsAndMilestone, config: { coop: [COOP_HERO] } });
    const host = player(w, 0);
    const guest = player(w, 1);
    const hostSkill = host.skills[0] as SkillInstance;
    hostSkill.rank = 6;
    const pactId = w.balance.pacts?.byBehavior?.[hostSkill.def.behavior];
    if (!pactId) throw new Error(`no pact passive for ${hostSkill.def.behavior}`);
    own(host, pactId, 2);
    openChest(w, host, 'boss_horyeong');
    openChest(w, guest, 'boss_horyeong');
    expect(w.modals.map((m) => m.player).sort()).toEqual([0, 1]);
    for (const m of w.modals) {
      const hero = player(w, m.player);
      expect(m.kind).toBe('bossReward');
      expect(m.cards).toHaveLength(3);
      for (const c of m.cards) expect(FILLER_KINDS).not.toContain(c.kind);
      const first = m.cards[0] as Card;
      expect(
        hero.skills.some((s) => s.def.id === first.id),
        `hero ${m.player} ranks up one of its own skills`,
      ).toBe(true);
    }
    const hostOffer = w.modals.find((m) => m.player === 0) as ModalRequest;
    expect(hostOffer.cards[0]).toMatchObject({ id: hostSkill.def.id, awakening: true });
    const guestFirst = (w.modals.find((m) => m.player === 1) as ModalRequest).cards[0] as Card;
    expect(guestFirst.awakening).toBe(false);
    // each hero answers its own modal
    expect(w.chooseCard(0, 1)).toBe(true);
    expect(w.modals.map((m) => m.player)).toEqual([0]);
  });

  it('the co-op auto-pick timer takes the first card: the awakening / rank-up', () => {
    const w = makeWorld({ content: milestoneOn, config: { coop: [COOP_HERO] } });
    w.autoPickAfter = 0.5;
    const guest = player(w, 1);
    const m = openChest(w, guest, 'boss_horyeong');
    const first = m.cards[0] as Card;
    const rankBefore = guest.skills.find((s) => s.def.id === first.id)?.rank ?? -1;
    for (let i = 0; i < Math.ceil(0.5 / DT) + 2; i++) w.step([NO_INPUT, NO_INPUT]);
    expect(w.modals.filter((x) => x.player === 1)).toHaveLength(0);
    expect(guest.skills.find((s) => s.def.id === first.id)?.rank).toBe(rankBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// The Sky Sovereign's Bargain: the three bargains (EV-02b). The shrine of runEvents.ts opens `openBargain`; every card is a boon for the picker
// paid for by a curse for the rest of the run - fury (+25 % damage / monsters 15 % faster, party-wide), cunning (+1 reroll and +1 banish /
// -10 % max hp, own hero), fortune (the next 2 chests free / elites 25 % more often, party-wide). Skipping applies nothing.

/** a quiet world (no spawns, no elites, no metins, no bosses) with its first hero */
function bargainWorld(over: Parameters<typeof makeWorld>[0] = {}): { w: World; p: PlayerState } {
  const w = makeWorld(over);
  freezeSchedules(w);
  return { w, p: player(w) };
}

/** open the shrine's offer for `p` and take bargain `id` */
function takeBargain(w: World, p: PlayerState, id: BargainId): void {
  const m = openBargain(w, p);
  const i = m.cards.findIndex((c) => c.id === id);
  expect(i, `the offer holds ${id}`).toBeGreaterThanOrEqual(0);
  expect(w.chooseCard(i, p.index)).toBe(true);
}

/** the part of the world a bargain must leave alone when it is refused: every stream, the heroes, the field */
function fingerprint(w: World): string {
  return JSON.stringify([
    Object.values(w.rng).map((r) => r.getState()),
    w.players.map((p) => [p.x, p.z, p.hp, p.hpMax, p.rerolls, p.banishes, p.skips, p.fixed.length, p.stats.damage]),
    w.enemies.count,
    Array.from(w.enemies.baseSpeed.slice(0, w.enemies.count)),
    w.mods,
  ]);
}

const speedOf = (w: World, row: number): number => w.enemies.baseSpeed[row] as number;

/** chest at (1, 0), next to a hero standing at the origin; runs until it has opened or `ticks` passed */
function dropChestAt(w: World, x: number, z: number, tier = 0): void {
  spawnPickup(w, PickupKind.Chest, x, z, 0, tier, 0);
}

describe('bargains: the offer', () => {
  it('offers fury, cunning and fortune, in that order, as epic bargain cards with the boon / curse keys and the party flag where the curse is the world\'s', () => {
    const { w, p } = bargainWorld();
    const m = openBargain(w, p);
    expect(m.cards.map((c) => c.id)).toEqual(['fury', 'cunning', 'fortune']);
    expect(BARGAIN_IDS).toEqual(['fury', 'cunning', 'fortune']);
    for (const c of m.cards) {
      expect(c).toMatchObject({ kind: 'bargain', rarity: 'epic', lines: [], amount: 0, slot: -1, replaces: null });
      expect(c.bargain).toMatchObject({ boon: `bargain.${c.id}.boon`, curse: `bargain.${c.id}.curse` });
    }
    expect(m.cards.map((c) => c.bargain?.party)).toEqual([true, undefined, true]);
    expect('party' in ((m.cards[1] as Card).bargain as object)).toBe(false);
    expect(BARGAIN_IDS.map((id) => BARGAINS[id].party)).toEqual([true, false, true]);
  });

  it('the strings exist in both languages and carry the numbers of the table', () => {
    const en = dictionaries.en;
    const tr = dictionaries.tr;
    const keys = ['bargain.party', ...BARGAIN_IDS.flatMap((id) => [`bargain.${id}.name`, `bargain.${id}.boon`, `bargain.${id}.curse`])];
    for (const k of keys) {
      expect(en[k], `en ${k}`).toBeTruthy();
      expect(tr[k], `tr ${k}`).toBeTruthy();
    }
    const pct = (v: number): string => `${Math.round(Math.abs(v) * 100)}%`;
    // Turkish writes the percent sign in front
    const trPct = (v: number): string => `%${Math.round(Math.abs(v) * 100)}`;
    expect(en['bargain.fury.boon']).toContain(pct(BARGAINS.fury.boon.damage as number));
    expect(en['bargain.fury.curse']).toContain(pct(BARGAINS.fury.curse.enemySpeed as number));
    expect(en['bargain.cunning.curse']).toContain(pct(BARGAINS.cunning.curse.maxHpPct as number));
    expect(en['bargain.fortune.curse']).toContain(pct(BARGAINS.fortune.curse.eliteMore as number));
    expect(en['bargain.fortune.boon']).toContain(String(BARGAINS.fortune.boon.freeChests));
    expect(tr['bargain.fury.boon']).toContain(trPct(BARGAINS.fury.boon.damage as number));
    expect(tr['bargain.fury.curse']).toContain(trPct(BARGAINS.fury.curse.enemySpeed as number));
    expect(tr['bargain.cunning.curse']).toContain(trPct(BARGAINS.cunning.curse.maxHpPct as number));
    expect(tr['bargain.fortune.curse']).toContain(trPct(BARGAINS.fortune.curse.eliteMore as number));
    expect(tr['bargain.fortune.boon']).toContain(String(BARGAINS.fortune.boon.freeChests));
  });

  it('draws no random number, and a shorter offer is the first cards of the table (never more than three)', () => {
    for (const [offers, ids] of [
      [1, ['fury']],
      [2, ['fury', 'cunning']],
      [3, ['fury', 'cunning', 'fortune']],
      [5, ['fury', 'cunning', 'fortune']],
    ] as const) {
      const { w, p } = bargainWorld({
        content: (c) => {
          c.runEvents = structuredClone(DEFAULT_RUN_EVENTS);
          c.runEvents.kinds.bargain.offers = offers;
        },
      });
      const before = Object.values(w.rng).map((r) => r.getState());
      expect(openBargain(w, p).cards.map((c) => c.id)).toEqual(ids);
      expect(Object.values(w.rng).map((r) => r.getState())).toEqual(before);
    }
  });

  it('PACED_FLAG is the free bit of the u8 flags column: no EnemyFlag member shares it', () => {
    const members = [EnemyFlag.Boss, EnemyFlag.Elite, EnemyFlag.Leader, EnemyFlag.Metin, EnemyFlag.Invuln, EnemyFlag.Pinned, EnemyFlag.Phased];
    for (const m of members) expect(m & PACED_FLAG).toBe(0);
    expect(PACED_FLAG).toBe(128);
    expect(members.reduce((a, m) => a | m, PACED_FLAG)).toBe(255);
  });
});

describe('bargains: skip and unknown cards apply nothing', () => {
  it('skipping the offer changes no stat, budget, modifier, pace or free chest, and the world runs on exactly as a world that never saw the shrine', () => {
    const a = bargainWorld({ config: { seed: 21 } });
    const b = bargainWorld({ config: { seed: 21 } });
    for (const w of [a.w, b.w]) {
      spawn(w, 'wolf', 20, 0);
      spawn(w, 'bear', -20, 4);
    }
    openBargain(a.w, a.p);
    expect(a.w.skip()).toBe(true);
    expect(a.w.modals).toHaveLength(0);
    expect(bargainsTaken(a.p)).toEqual([]);
    expect(freeChestsLeft(a.p)).toBe(0);
    expect(bargainPace(a.w)).toBe(1);
    expect(fingerprint(a.w)).toBe(fingerprint(b.w));
    runTicks(a.w, 300);
    runTicks(b.w, 300);
    expect(fingerprint(a.w)).toBe(fingerprint(b.w));
  });

  it('the co-op timer refuses the offer: nothing is picked, nothing applied', () => {
    const w = coopWorld();
    freezeSchedules(w);
    const p1 = player(w, 1);
    const before = fingerprint(w);
    openBargain(w, p1);
    const picks: number[] = [];
    for (let i = 0; i < 20 * 60 + 5; i++) {
      w.step([NO_INPUT, NO_INPUT]);
      for (const e of w.events) if (e.t === 'cardPick') picks.push(e.player);
    }
    expect(w.modals).toHaveLength(0);
    expect(picks).toEqual([]);
    expect(bargainsTaken(p1)).toEqual([]);
    expect(bargainPace(w)).toBe(1);
    expect(w.mods.eliteEvery).toBe(1);
    expect(p1.fixed.length).toBe(JSON.parse(before)[1][1][7]);
  });

  it('a card of the shrine whose id the table does not know (a placeholder) grants and costs nothing', () => {
    const { w, p } = bargainWorld();
    spawn(w, 'wolf', 20, 0);
    const before = fingerprint(w);
    applyCard(w, p, mkCard({ kind: 'bargain', id: 'bargain_placeholder_1', bargain: { boon: 'x', curse: 'y' } }));
    applyCard(w, p, mkCard({ kind: 'bargain', id: '', bargain: { boon: 'x', curse: 'y' } }));
    expect(fingerprint(w)).toBe(before);
    expect(bargainsTaken(p)).toEqual([]);
  });
});

describe('bargain: fury', () => {
  it('+25 % damage for the picker, kept for the rest of the run', () => {
    const { w, p } = bargainWorld();
    refreshStats(p, w.content, w.ix);
    const dmg0 = p.stats.damage;
    takeBargain(w, p, 'fury');
    expect(p.statsDirty).toBe(true);
    refreshStats(p, w.content, w.ix);
    expect(p.stats.damage).toBeCloseTo(dmg0 + 0.25, 9);
    expect(bargainsTaken(p)).toEqual(['fury']);
    // a level-up, a long fight, another stat refresh: still there
    runTicks(w, 600);
    refreshStats(p, w.content, w.ix);
    expect(p.stats.damage).toBeCloseTo(dmg0 + 0.25, 9);
  });

  it('the curse: every creature on the field and every one spawned later moves 15 % faster; metin rows and bosses keep their pace', () => {
    const { w, p } = bargainWorld();
    const wolf = spawn(w, 'wolf', 20, 0);
    const elite = spawn(w, 'bear', -20, 0, { tier: 1 });
    const boss = spawn(w, 'boss_horyeong', 0, 30, { tier: 3 });
    const stone = spawn(w, 'wolf', 0, -30);
    w.enemies.flags[stone] = (w.enemies.flags[stone] as number) | EnemyFlag.Metin;
    const before = [wolf, elite, boss, stone].map((r) => speedOf(w, r));
    takeBargain(w, p, 'fury');
    expect(bargainPace(w)).toBeCloseTo(1.15, 9);
    expect(speedOf(w, wolf)).toBeCloseTo((before[0] as number) * 1.15, 4);
    expect(speedOf(w, elite)).toBeCloseTo((before[1] as number) * 1.15, 4);
    expect(speedOf(w, boss)).toBe(before[2]);
    expect(speedOf(w, stone)).toBe(before[3]);
    expect((w.enemies.flags[wolf] as number) & PACED_FLAG).toBe(PACED_FLAG);
    expect((w.enemies.flags[boss] as number) & PACED_FLAG).toBe(0);
    expect((w.enemies.flags[stone] as number) & PACED_FLAG).toBe(0);
    // a creature spawned after the pick gets it on the next tick (before it can take a step), once
    const late = spawn(w, 'jackal', 25, 5);
    const lateBase = speedOf(w, late);
    w.step([NO_INPUT]);
    expect(speedOf(w, late)).toBeCloseTo(lateBase * 1.15, 4);
    const once = speedOf(w, late);
    runTicks(w, 120);
    expect(speedOf(w, late)).toBe(once);
    expect(speedOf(w, wolf)).toBeCloseTo((before[0] as number) * 1.15, 4);
  });

  it('the pace shows in the speed the creature really walks at', () => {
    const slow = bargainWorld({ config: { seed: 9 } });
    const fast = bargainWorld({ config: { seed: 9 } });
    for (const w of [slow.w, fast.w]) {
      player(w).hp = player(w).hpMax = 1e9;
      spawn(w, 'wolf', 25, 0);
    }
    takeBargain(fast.w, fast.p, 'fury');
    runTicks(slow.w, 30);
    runTicks(fast.w, 30);
    expect(fast.w.enemies.speed[0]).toBeCloseTo((slow.w.enemies.speed[0] as number) * 1.15, 3);
    const walked = (w: World): number => 25 - (w.enemies.x[0] as number);
    expect(walked(fast.w) / walked(slow.w)).toBeGreaterThan(1.1);
  });

  it('two heroes taking fury pay twice: the pace stacks on the creatures already marked and on later ones', () => {
    const w = coopWorld();
    freezeSchedules(w);
    const wolf = spawn(w, 'wolf', 20, 0);
    const base = speedOf(w, wolf);
    takeBargain(w, player(w, 0), 'fury');
    takeBargain(w, player(w, 1), 'fury');
    expect(bargainPace(w)).toBeCloseTo(1.15 * 1.15, 9);
    expect(speedOf(w, wolf)).toBeCloseTo(base * 1.15 * 1.15, 4);
    const late = spawn(w, 'jackal', 25, 5);
    const lateBase = speedOf(w, late);
    w.step([NO_INPUT, NO_INPUT]);
    expect(speedOf(w, late)).toBeCloseTo(lateBase * 1.15 * 1.15, 4);
  });

  it('party-wide: the guest takes fury, the host hero meets the faster monsters but gains no damage', () => {
    const w = coopWorld();
    freezeSchedules(w);
    const host = player(w, 0);
    const guest = player(w, 1);
    refreshStats(host, w.content, w.ix);
    refreshStats(guest, w.content, w.ix);
    const [d0, d1] = [host.stats.damage, guest.stats.damage];
    const wolf = spawn(w, 'wolf', 20, 0);
    const base = speedOf(w, wolf);
    takeBargain(w, guest, 'fury');
    refreshStats(host, w.content, w.ix);
    refreshStats(guest, w.content, w.ix);
    expect(host.stats.damage).toBe(d0);
    expect(guest.stats.damage).toBeCloseTo(d1 + 0.25, 9);
    expect(speedOf(w, wolf)).toBeCloseTo(base * 1.15, 4);
    expect(bargainsTaken(host)).toEqual([]);
    expect(bargainsTaken(guest)).toEqual(['fury']);
  });

  it('a hero that falls and comes back keeps the boon; the pace goes on', () => {
    const { w, p } = bargainWorld();
    takeBargain(w, p, 'fury');
    p.fixed.push({ revives: 1 });
    refreshStats(p, w.content, w.ix);
    const dmg = p.stats.damage;
    hurtPlayer(w, 0, p.hpMax * 10, p.x, p.z, 0, HurtKind.Melee);
    expect(p.alive).toBe(true); // the revive took it
    expect(p.stats.damage).toBe(dmg);
    const late = spawn(w, 'wolf', 20, 0);
    const base = speedOf(w, late);
    w.step([NO_INPUT]);
    expect(speedOf(w, late)).toBeCloseTo(base * 1.15, 4);
  });

  it('a modal freezes the sweep with the clock: nothing is paced while the sim is paused, everything once it runs again', () => {
    const { w, p } = bargainWorld();
    takeBargain(w, p, 'fury');
    openLevelUp(w, p, 2);
    const late = spawn(w, 'wolf', 20, 0);
    const base = speedOf(w, late);
    runTicks(w, 30);
    expect(speedOf(w, late)).toBe(base);
    expect(w.chooseCard(0)).toBe(true);
    w.step([NO_INPUT]);
    expect(speedOf(w, late)).toBeCloseTo(base * 1.15, 4);
  });

  it('hard mode and the Run Options sliders at their top: the pace is 15 % on top of whatever the creature already had, nothing goes non-finite', () => {
    for (const config of [{ difficulty: 'hard' as const }, { runOptions: { speed: 3, density: 3, health: 3, damage: 3 } }]) {
      const { w, p } = bargainWorld({ config });
      const wolf = spawn(w, 'wolf', 20, 0);
      const base = speedOf(w, wolf);
      takeBargain(w, p, 'fury');
      expect(speedOf(w, wolf)).toBeCloseTo(base * 1.15, 4);
      runTicks(w, 240);
      expect(findNonFinite(w)).toBeNull();
    }
  });

  it('the run ends with the curse on: the result is built, nothing is non-finite', () => {
    const { w, p } = bargainWorld();
    takeBargain(w, p, 'fury');
    spawn(w, 'wolf', 20, 0);
    hurtPlayer(w, 0, p.hpMax * 10, p.x, p.z, 0, HurtKind.Melee);
    runTicks(w, 600);
    expect(w.over).toBe(true);
    const r = buildResult(w, false);
    expect(r.victory).toBe(false);
    expect(findNonFinite(w)).toBeNull();
    expect(bargainPace(w)).toBeCloseTo(1.15, 9);
    runTicks(w, 10);
  });
});

describe('bargain: cunning', () => {
  it('+1 reroll and +1 banish, -10 % max hp for the picker only; hp follows the new maximum down', () => {
    const w = coopWorld();
    freezeSchedules(w);
    const host = player(w, 0);
    const guest = player(w, 1);
    for (const h of [host, guest]) {
      refreshStats(h, w.content, w.ix);
      h.hp = h.hpMax;
    }
    const pct0 = guest.fixed.reduce((a, m) => a + (m.maxHpPct ?? 0), 0);
    const [hostMax, guestMax] = [host.hpMax, guest.hpMax];
    const [rr, bb] = [guest.rerolls, guest.banishes];
    const [hostRr, hostBb] = [host.rerolls, host.banishes];
    takeBargain(w, guest, 'cunning');
    expect(guest.rerolls).toBe(rr + 1);
    expect(guest.banishes).toBe(bb + 1);
    refreshStats(guest, w.content, w.ix);
    refreshStats(host, w.content, w.ix);
    expect(guest.hpMax).toBeCloseTo((guestMax * (1 + pct0 - 0.1)) / (1 + pct0), 4);
    expect(guest.hpMax).toBeLessThan(guestMax);
    expect(guest.hp).toBe(guest.hpMax);
    // the host hero pays nothing and gains nothing; nothing of the world changed
    expect(host.hpMax).toBe(hostMax);
    expect(host.rerolls).toBe(hostRr);
    expect(host.banishes).toBe(hostBb);
    expect(bargainPace(w)).toBe(1);
    expect(w.mods.eliteEvery).toBe(1);
    expect(bargainsTaken(guest)).toEqual(['cunning']);
  });

  it('the curse holds for the rest of the run: other stat refreshes, a revive and a long fight keep -10 % max hp', () => {
    const { w, p } = bargainWorld();
    refreshStats(p, w.content, w.ix);
    const max0 = p.hpMax;
    const pct0 = p.fixed.reduce((a, m) => a + (m.maxHpPct ?? 0), 0);
    takeBargain(w, p, 'cunning');
    p.fixed.push({ revives: 1 });
    refreshStats(p, w.content, w.ix);
    const max1 = (max0 * (1 + pct0 - 0.1)) / (1 + pct0);
    expect(p.hpMax).toBeCloseTo(max1, 4);
    hurtPlayer(w, 0, p.hpMax * 10, p.x, p.z, 0, HurtKind.Melee);
    expect(p.alive).toBe(true);
    runTicks(w, 600);
    p.statsDirty = true;
    refreshStats(p, w.content, w.ix);
    expect(p.hpMax).toBeCloseTo(max1, 4);
  });

  it('the reroll and banish really work: a level-up already waiting behind the offer shows the new budgets, and spending them is allowed', () => {
    const { w, p } = bargainWorld();
    p.rerolls = 0;
    p.banishes = 0;
    openBargain(w, p);
    const lv = openLevelUp(w, p, 2);
    expect([lv.canReroll, lv.canBanish, lv.rerolls, lv.banishes]).toEqual([false, false, 0, 0]);
    expect(w.chooseCard(1)).toBe(true); // the bargain modal is the hero's first
    expect(p.rerolls).toBe(1);
    expect(p.banishes).toBe(1);
    expect([lv.canReroll, lv.canBanish, lv.rerolls, lv.banishes]).toEqual([true, true, 1, 1]);
    expect(w.reroll()).toBe(true);
    expect(p.rerolls).toBe(0);
    expect(w.banish(0)).toBe(true);
    expect(p.banishes).toBe(0);
  });
});

describe('bargain: fortune', () => {
  it('the next 2 chests are free: no yeop, no climb of the price ladder, the lock does not apply; the third is paid at the first price', () => {
    const { w, p } = bargainWorld();
    p.yeop = 0;
    takeBargain(w, p, 'fortune');
    expect(freeChestsLeft(p)).toBe(2);
    const opened: number[] = [];
    for (let k = 0; k < 2; k++) {
      dropChestAt(w, 1, 0);
      const ev = collect(w, 3, ['chestOpen']);
      expect(ev).toHaveLength(1);
      opened.push(ev[0]?.cost ?? -1);
      expect(w.modal?.kind).toBe('chest');
      expect(w.chooseCard(0)).toBe(true);
    }
    expect(opened).toEqual([0, 0]);
    expect(freeChestsLeft(p)).toBe(0);
    expect(p.yeop).toBe(0);
    expect(p.chestsOpened).toBe(0);
    expect(w.tally.chestsOpened).toBe(2);
    // the third chest is an ordinary one: locked without yeop, paid with it, at the FIRST price of the ladder
    dropChestAt(w, 1, 0);
    runTicks(w, 90);
    expect(w.modal).toBeNull();
    p.yeop = 100;
    const ev = collect(w, 3, ['chestOpen']);
    expect(ev[0]?.cost).toBe(Math.round(w.balance.chestCost.base));
    expect(p.chestsOpened).toBe(1);
    expect(p.yeop).toBe(100 - Math.round(w.balance.chestCost.base));
  });

  it('boss and event chests are free anyway and keep the hero\'s free chests', () => {
    const { w, p } = bargainWorld();
    takeBargain(w, p, 'fortune');
    dropChestAt(w, 1, 0, 1);
    const ev = collect(w, 3, ['chestOpen']);
    expect(ev[0]?.cost).toBe(0);
    expect(freeChestsLeft(p)).toBe(2);
    expect(w.chooseCard(0)).toBe(true);
  });

  it('own boon: only the hero who took it has free chests', () => {
    const w = coopWorld();
    freezeSchedules(w);
    const host = player(w, 0);
    const guest = player(w, 1);
    host.yeop = 0;
    guest.yeop = 0;
    host.x = host.px = 0;
    host.z = host.pz = 0;
    guest.x = guest.px = 40;
    guest.z = guest.pz = 0;
    takeBargain(w, guest, 'fortune');
    expect([freeChestsLeft(host), freeChestsLeft(guest)]).toEqual([0, 2]);
    dropChestAt(w, 1, 0);
    dropChestAt(w, 41, 0);
    runTicks(w, 90);
    // the guest's chest opened for nothing, the host's stays locked
    expect(w.modals.map((m) => m.player)).toEqual([1]);
    expect(freeChestsLeft(guest)).toBe(1);
    expect(w.pickups.count).toBe(1);
    expect(w.pickups.x[0]).toBeCloseTo(1, 5);
  });

  it('the curse: elites come 25 % more often - the countdown to the next elite runs 1.25 x as fast - for every hero and for the rest of the run', () => {
    const rate = (w: World): number => {
      w.spawner.eliteT = 100;
      w.step([NO_INPUT, ...w.players.slice(1).map(() => NO_INPUT)]);
      return 100 - w.spawner.eliteT;
    };
    const plain = bargainWorld();
    const cursed = coopWorld();
    freezeSchedules(cursed);
    const per = rate(plain.w);
    expect(per).toBeCloseTo(DT, 9);
    takeBargain(cursed, player(cursed, 1), 'fortune');
    expect(cursed.mods.eliteEvery).toBeCloseTo(0.8, 9);
    expect(rate(cursed) / per).toBeCloseTo(1.25, 6);
    // later, after a long stretch of play
    runTicks(cursed, 1200);
    expect(cursed.mods.eliteEvery).toBeCloseTo(0.8, 9);
    expect(rate(cursed) / per).toBeCloseTo(1.25, 6);
  });

  it('the elite factor stacks with a second fortune, with hard mode and with another event (Golden Hour) and is removed by nothing but the run', () => {
    const { w, p } = bargainWorld({ config: { difficulty: 'hard' } });
    const base = w.mods.eliteEvery;
    takeBargain(w, p, 'fortune');
    expect(w.mods.eliteEvery).toBeCloseTo(base * 0.8, 9);
    takeBargain(w, p, 'fortune');
    expect(w.mods.eliteEvery).toBeCloseTo(base * 0.64, 9);
    expect(freeChestsLeft(p)).toBe(4);
    w.setEventMods('goldenHour', { eliteEvery: 0.5, yeop: 2 });
    expect(w.mods.eliteEvery).toBeCloseTo(base * 0.64 * 0.5, 9);
    w.clearEventMods('goldenHour');
    expect(w.mods.eliteEvery).toBeCloseTo(base * 0.64, 9);
  });

  it('fortune is not fury: the monsters\' pace and the hero\'s stats stay as they were', () => {
    const { w, p } = bargainWorld();
    refreshStats(p, w.content, w.ix);
    const wolf = spawn(w, 'wolf', 20, 0);
    const [base, dmg, hp] = [speedOf(w, wolf), p.stats.damage, p.hpMax];
    takeBargain(w, p, 'fortune');
    runTicks(w, 30);
    refreshStats(p, w.content, w.ix);
    expect([speedOf(w, wolf), p.stats.damage, p.hpMax]).toEqual([base, dmg, hp]);
    expect(bargainPace(w)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SIM-05: global skill slot capacity (MAX_SKILL_SLOTS = 64) & 4-player veteran party

describe('SIM-05: 4-player veteran skill slots and global MAX_SKILL_SLOTS cap', () => {
  it('supports 4 veteran heroes (basic + 3 ultimates + 6 actives = 40 skill slots), level-up offers, auto-pick, hit stamps >= 32, and settlement', () => {
    const ultsFor = (classId: string, doctrine: 'a' | 'b'): string[] =>
      content.skills.filter((s) => s.kind === 'ultimate' && s.classId === classId && s.doctrine === doctrine).map((s) => s.id);

    const w0Ults = ultsFor('warrior', 'a');
    const w1Ults = ultsFor('warrior', 'b');
    const w2Ults = ultsFor('ninja', 'a');
    const w3Ults = ultsFor('shaman', 'a');
    expect([w0Ults.length, w1Ults.length, w2Ults.length, w3Ults.length]).toEqual([3, 3, 3, 3]);

    const w = createWorld(
      {
        zone: 'yeonmu',
        difficulty: 'normal',
        classId: 'warrior',
        doctrine: 'a',
        sex: 'm',
        empire: 'saehwa',
        seed: 42,
        meta: { stats: {}, extraSkills: w0Ults },
        coop: [
          { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'saehwa', meta: { stats: {}, extraSkills: w1Ults } },
          { classId: 'ninja', doctrine: 'a', sex: 'f', empire: 'saehwa', meta: { stats: {}, extraSkills: w2Ults } },
          { classId: 'shaman', doctrine: 'a', sex: 'm', empire: 'saehwa', meta: { stats: {}, extraSkills: w3Ults } },
        ],
      },
      content,
    );
    freezeSchedules(w);
    w.enemies.clear();
    w.spawner.alive = 0;

    // 4 heroes × (1 basic + 1 starter active + 3 ultimates) = 20 slots at run start
    expect(w.players).toHaveLength(4);
    expect(w.skillSlots).toHaveLength(20);
    for (const p of w.players) expect(p.skills).toHaveLength(5);

    const inputs = w.players.map(() => NO_INPUT);
    let autoPicked = 0;
    // drive real level-up offers until every hero has all 6 active skills (10 skills each = 40 global slots)
    for (let round = 0; round < 120 && w.skillSlots.length < 40; round++) {
      for (const p of w.players) {
        const activeCount = p.skills.filter((s) => !s.basic && !s.ultimate).length;
        if (activeCount >= w.balance.maxActiveSkills) continue;
        const m = openLevelUp(w, p, p.level + 1);
        const newIdx = m.cards.findIndex((c) => c.kind === 'newSkill');
        if (newIdx >= 0) {
          if (autoPicked < 4 && newIdx === 0) {
            // exercise the real tickModalWait auto-pick path on some modals
            m.waited = w.autoPickAfter;
            w.step(inputs);
            autoPicked++;
          } else {
            expect(w.chooseCard(newIdx, p.index)).toBe(true);
          }
        } else {
          expect(w.chooseCard(0, p.index)).toBe(true);
        }
      }
    }

    expect(w.skillSlots).toHaveLength(40);
    for (const p of w.players) expect(p.skills).toHaveLength(10);

    // exercise hit-stamp table at slots >= 32 (39 and MAX_SKILL_SLOTS - 1)
    const enemyRow = spawn(w, 'wild_dog', 4, 0);
    w.time = 10;
    expect(stampHit(w, enemyRow, 39, 0.5)).toBe(true);
    expect(stampHit(w, enemyRow, 39, 0.5)).toBe(false);
    expect(stampHit(w, enemyRow, MAX_SKILL_SLOTS - 1, 0.5)).toBe(true);
    expect(stampHit(w, enemyRow, MAX_SKILL_SLOTS - 1, 0.5)).toBe(false);
    w.time = 11;
    expect(stampHit(w, enemyRow, 39, 0.5)).toBe(true);
    expect(stampHit(w, enemyRow, MAX_SKILL_SLOTS - 1, 0.5)).toBe(true);

    // verify settlement (world result + per-player co-op results) with 40 skill slots across 4 players
    const res = buildResult(w, true);
    expect(res.players).toHaveLength(4);
    expect(findNonFinite(w)).toBeNull();
    for (const p of w.players) {
      const pr = buildPlayerResult(w, true, p.index);
      expect(pr.damageBySkill).toHaveLength(10);
      expect(Number.isFinite(pr.damageDealt)).toBe(true);
    }
  });

  it('never offers or crashes on newSkill when global MAX_SKILL_SLOTS is reached (manual pick and auto-pick)', () => {
    const w = coopWorld();
    freezeSchedules(w);
    const p = player(w, 0);
    const def = w.ix.skills.get('bladewheel');
    if (!def) throw new Error('missing bladewheel');

    // saturate global w.skillSlots to MAX_SKILL_SLOTS
    while (w.skillSlots.length < MAX_SKILL_SLOTS) addSkill(w, p, def, 0);
    expect(w.skillSlots).toHaveLength(MAX_SKILL_SLOTS);

    // buildOffer must not offer any newSkill card once global capacity is full
    const offered = scan(w, p, 100);
    expect(offered.some((c) => c.kind === 'newSkill')).toBe(false);

    // applying a stale/pre-queued newSkill card falls back to overflow reward without throwing
    const yeopBefore = p.yeop;
    expect(() => applyCard(w, p, mkCard({ kind: 'newSkill', id: 'fury_aura', rarity: 'rare', maxRank: MAX_SKILL_RANK }))).not.toThrow();
    expect(w.skillSlots).toHaveLength(MAX_SKILL_SLOTS);
    expect(p.yeop).toBeGreaterThan(yeopBefore);

    // same safety through co-op tickModalWait auto-pick
    const yeopBeforeAuto = p.yeop;
    const staleModal: ModalRequest = {
      id: ++w.nextModalId,
      kind: 'levelUp',
      player: p.index,
      cards: [mkCard({ kind: 'newSkill', id: 'lunge', rarity: 'epic', maxRank: MAX_SKILL_RANK })],
      canReroll: false,
      canBanish: false,
      canSkip: false,
      rerolls: 0,
      banishes: 0,
      skips: 0,
      level: 2,
      source: '',
      free: false,
      awakened: false,
      waited: w.autoPickAfter,
      result: null,
    };
    w.modals.push(staleModal);
    expect(() => w.step([NO_INPUT, NO_INPUT])).not.toThrow();
    expect(w.modals).toHaveLength(0);
    expect(w.skillSlots).toHaveLength(MAX_SKILL_SLOTS);
    expect(p.yeop).toBeGreaterThan(yeopBeforeAuto);
  });
});

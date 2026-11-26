import { describe, expect, it } from 'vitest';
import { FIXTURE_ZONE_IDS, fixtureContent } from './__fixtures__/content';
import { freshSave } from './__fixtures__/testkit';
import { BLESSING_RATE_BONUS, BLESSING_YEOP_MULT, attemptUpgrade, quoteUpgrade, scrollUnlocked, type UpgradeOptions } from './blacksmith';
import { seededRng } from './rng';
import { MetaService } from './service';
import { MemoryStore } from './storage';
import type { MetaRng, SaveData } from './types';

const C = fixtureContent;
const B = C.balance.blacksmith;
const ID = 'yeonmu_weapon_warrior';

const LAST_ZONE = FIXTURE_ZONE_IDS[FIXTURE_ZONE_IDS.length - 1] as string;

/** `clears` Normal / Hard clears of a zone, the way settleRun records them. */
function setClears(s: SaveData, zone: string, normal: number, hard = 0): void {
  const z = (n: number) => ({ runs: n, clears: n, bestScore: 0, bestTime: 0, bestLevel: 0 });
  s.stats.zones[zone] = { ...(normal > 0 ? { normal: z(normal) } : {}), ...(hard > 0 ? { hard: z(hard) } : {}) };
}

/**
 * Warrior owning the weapon at +plus with plenty of materials. `campaign` says whether the normal campaign is complete (the last
 * zone cleared on Normal), which is what opens the Blessing Scroll; the plain tests do not care, the scroll tests need it true.
 */
function smithSave(plus: number, yeop = 1e9, shards = 1e6, campaign = true): SaveData {
  const s = freshSave();
  s.classes.warrior.collection.push(ID);
  s.classes.warrior.gear.weapon = ID;
  if (plus > 0) s.classes.warrior.plus[ID] = plus;
  s.bank.yeop = yeop;
  s.bank.shards = shards;
  if (campaign) setClears(s, LAST_ZONE, 1);
  return s;
}

const fixed = (v: number): MetaRng => ({ next: () => v });

describe('quote', () => {
  it('reads rate and costs by the current level', () => {
    for (let plus = 0; plus < 9; plus++) {
      const q = quoteUpgrade(smithSave(plus), C, 'warrior', ID);
      expect(q).toMatchObject({ ok: true, quote: { from: plus, to: plus + 1, rate: B.successRate[plus], yeop: B.yeopCost[plus], shards: B.shardCost[plus], canAfford: true } });
    }
  });

  it('declining success rates, rising costs (classic progression curve)', () => {
    for (let i = 1; i < B.successRate.length; i++) {
      expect(B.successRate[i] as number).toBeLessThan(B.successRate[i - 1] as number);
      expect(B.yeopCost[i] as number).toBeGreaterThan(B.yeopCost[i - 1] as number);
    }
  });

  it('flags affordability and refuses invalid targets', () => {
    expect(quoteUpgrade(smithSave(0, 10, 0), C, 'warrior', ID)).toMatchObject({ ok: true, quote: { canAfford: false } });
    expect(quoteUpgrade(smithSave(9), C, 'warrior', ID)).toEqual({ ok: false, reason: 'maxed' });
    expect(quoteUpgrade(freshSave(), C, 'warrior', ID)).toEqual({ ok: false, reason: 'notOwned' });
    expect(quoteUpgrade(smithSave(0), C, 'ninja', ID)).toEqual({ ok: false, reason: 'classMismatch' });
    expect(quoteUpgrade(smithSave(0), C, 'warrior', 'nope')).toEqual({ ok: false, reason: 'unknownGear' });
    const broken = { ...C, balance: { ...C.balance, blacksmith: { ...B, shardCost: [] } } };
    expect(quoteUpgrade(smithSave(0), broken, 'warrior', ID)).toEqual({ ok: false, reason: 'badConfig' });
  });
});

describe('attempt', () => {
  it('success raises the level and spends exactly the quoted materials', () => {
    const s = smithSave(2, 100_000, 100);
    const r = attemptUpgrade(s, C, 'warrior', ID, fixed(0));
    expect(r).toMatchObject({ ok: true, success: true, from: 2, to: 3, spent: { yeop: B.yeopCost[2], shards: B.shardCost[2] } });
    if (!r.ok) return;
    expect(r.save.classes.warrior.plus[ID]).toBe(3);
    expect(r.save.bank.yeop).toBe(100_000 - (B.yeopCost[2] as number));
    expect(r.save.bank.shards).toBe(100 - (B.shardCost[2] as number));
    expect(r.save.stats.blacksmith).toMatchObject({ attempts: 1, successes: 1 });
    expect(s.classes.warrior.plus[ID]).toBe(2); // input untouched
  });

  it('failure consumes materials only: the item and its level are kept', () => {
    const s = smithSave(5, 100_000, 100);
    const r = attemptUpgrade(s, C, 'warrior', ID, fixed(0.999999));
    expect(r).toMatchObject({ ok: true, success: false, from: 5, to: 5 });
    if (!r.ok) return;
    expect(r.save.classes.warrior.plus[ID]).toBe(5);
    expect(r.save.classes.warrior.collection).toContain(ID);
    expect(r.save.classes.warrior.gear.weapon).toBe(ID);
    expect(r.save.bank.yeop).toBe(100_000 - (B.yeopCost[5] as number));
    expect(r.save.bank.shards).toBe(100 - (B.shardCost[5] as number));
    expect(r.save.stats.blacksmith).toMatchObject({ attempts: 1, successes: 0, yeopSpent: B.yeopCost[5], shardsSpent: B.shardCost[5] });
  });

  it('refuses without enough Yeop or shards and spends nothing', () => {
    expect(attemptUpgrade(smithSave(3, 0, 100), C, 'warrior', ID, fixed(0))).toEqual({ ok: false, reason: 'noYeop' });
    expect(attemptUpgrade(smithSave(3, 1e9, 0), C, 'warrior', ID, fixed(0))).toEqual({ ok: false, reason: 'noShards' });
    expect(attemptUpgrade(smithSave(9), C, 'warrior', ID, fixed(0))).toEqual({ ok: false, reason: 'maxed' });
  });

  it('the roll is `rng < rate` (edge: exactly the rate fails)', () => {
    const rate = B.successRate[4] as number;
    expect(attemptUpgrade(smithSave(4), C, 'warrior', ID, fixed(rate - 1e-9))).toMatchObject({ success: true });
    expect(attemptUpgrade(smithSave(4), C, 'warrior', ID, fixed(rate))).toMatchObject({ success: false });
  });

  it('is deterministic for a given seed', () => {
    const run = (seed: number): boolean[] => {
      const rng = seededRng(seed);
      const out: boolean[] = [];
      let s = smithSave(5);
      for (let i = 0; i < 50; i++) {
        const r = attemptUpgrade(s, C, 'warrior', ID, rng);
        if (!r.ok) break;
        out.push(r.success);
        s = r.save;
      }
      return out;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it('observed success frequency matches the configured rate at every level (seeded, 10 000 trials each)', () => {
    const N = 10_000;
    for (let plus = 0; plus < 9; plus++) {
      const rate = B.successRate[plus] as number;
      const rng = seededRng(1000 + plus);
      const base = smithSave(plus);
      let wins = 0;
      for (let i = 0; i < N; i++) {
        const r = attemptUpgrade(base, C, 'warrior', ID, rng);
        if (r.ok && r.success) wins++;
      }
      const sigma = Math.sqrt((rate * (1 - rate)) / N);
      expect(Math.abs(wins / N - rate)).toBeLessThanOrEqual(4 * sigma + 1e-12);
    }
  }, 60_000);

  it('climbing +0 → +9 takes about Σ 1/rate attempts on average', () => {
    const rng = seededRng(2024);
    const expected = B.successRate.reduce((a, p) => a + 1 / p, 0);
    const CLIMBS = 400;
    let attempts = 0;
    for (let c = 0; c < CLIMBS; c++) {
      let s = smithSave(0);
      for (;;) {
        const r = attemptUpgrade(s, C, 'warrior', ID, rng);
        if (!r.ok) {
          expect(r.reason).toBe('maxed');
          break;
        }
        attempts++;
        s = r.save;
      }
      expect(s.classes.warrior.plus[ID]).toBe(9);
    }
    expect(Math.abs(attempts / CLIMBS - expected)).toBeLessThan(2.5);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------
// Blessing Scroll (MT-03): +15 points of success chance (cap 100 %) for 3x the attempt's yeop, shards unchanged.

const blessedRate = (plus: number): number => Math.min(1, Math.round(((B.successRate[plus] as number) + 0.15) * 1e6) / 1e6);
/** an rng that counts its draws */
function counting(v: number): MetaRng & { draws: number } {
  const r = { draws: 0, next: () => (r.draws++, v) };
  return r;
}

describe('Blessing Scroll: quote', () => {
  it('names the numbers of the rule', () => {
    expect(BLESSING_RATE_BONUS).toBe(0.15);
    expect(BLESSING_YEOP_MULT).toBe(3);
  });

  it('a plain quote carries the scroll side by side: +15 points, 3x yeop, the same shards', () => {
    for (let plus = 0; plus < 9; plus++) {
      const q = quoteUpgrade(smithSave(plus), C, 'warrior', ID);
      if (!q.ok) throw new Error('quote');
      const base = B.successRate[plus] as number;
      expect(q.quote).toMatchObject({ blessed: false, rate: base, yeop: B.yeopCost[plus], shards: B.shardCost[plus] });
      expect(q.quote.base).toMatchObject({ rate: base, yeop: B.yeopCost[plus], canAfford: true });
      expect(q.quote.scroll.rate).toBeCloseTo(blessedRate(plus), 9);
      expect(q.quote.scroll.yeop).toBe(3 * (B.yeopCost[plus] as number));
      expect(q.quote.scroll.shards).toBe(B.shardCost[plus]);
      expect(q.quote.scroll.gain).toBeCloseTo(blessedRate(plus) - base, 9);
      expect(q.quote.scroll.canAfford).toBe(true);
      expect(q.quote.scroll.available).toBe(true);
    }
  });

  it('{ blessing: true } makes the headline numbers the blessed ones (on every step the scroll can improve: +1..+8)', () => {
    for (let plus = 1; plus < 9; plus++) {
      const q = quoteUpgrade(smithSave(plus), C, 'warrior', ID, { blessing: true });
      if (!q.ok) throw new Error('quote');
      expect(q.quote).toMatchObject({ blessed: true, from: plus, to: plus + 1, yeop: 3 * (B.yeopCost[plus] as number), shards: B.shardCost[plus] });
      expect(q.quote.rate).toBeCloseTo(blessedRate(plus), 9);
      // the plain side is still there for the UI
      expect(q.quote.base.rate).toBe(B.successRate[plus]);
      expect(q.quote.base.yeop).toBe(B.yeopCost[plus]);
    }
  });

  it('caps at 100 %: the scroll is useful only below it', () => {
    const at = (plus: number) => {
      const q = quoteUpgrade(smithSave(plus), C, 'warrior', ID);
      if (!q.ok) throw new Error('quote');
      return q.quote.scroll;
    };
    expect(at(0)).toMatchObject({ rate: 1, gain: 0, useful: false }); // +0 -> +1 is already certain
    expect(at(1)).toMatchObject({ rate: 1, useful: true }); // 90 % + 15 points is capped at 100
    expect(at(1).gain).toBeCloseTo(0.1, 9);
    expect(at(2)).toMatchObject({ rate: 0.95, useful: true }); // 80 % + 15 points
    expect(at(8).rate).toBeCloseTo(0.27, 9); // 12 % + 15 points
  });

  it('the rates stay clean decimals (no 0.7000000000000001)', () => {
    const q = quoteUpgrade(smithSave(4), C, 'warrior', ID, { blessing: true });
    if (!q.ok) throw new Error('quote');
    expect(q.quote.rate).toBe(0.7); // 55 % + 15 points
  });

  it('affordability is judged per side: the scroll needs 3x the yeop, shards are shared', () => {
    const need = B.yeopCost[3] as number; // 3500
    const s = smithSave(3, 3 * need - 1, 100);
    const q = quoteUpgrade(s, C, 'warrior', ID);
    if (!q.ok) throw new Error('quote');
    expect(q.quote.base.canAfford).toBe(true);
    expect(q.quote.scroll.canAfford).toBe(false);
    expect(q.quote.canAfford).toBe(true); // headline = the plain attempt
    const b = quoteUpgrade(s, C, 'warrior', ID, { blessing: true });
    if (!b.ok) throw new Error('quote');
    expect(b.quote.canAfford).toBe(false);
    // exactly 3x is enough
    const e = quoteUpgrade(smithSave(3, 3 * need, 100), C, 'warrior', ID, { blessing: true });
    if (!e.ok) throw new Error('quote');
    expect(e.quote.canAfford).toBe(true);
    // no shards: neither side
    const n = quoteUpgrade(smithSave(3, 1e9, 0), C, 'warrior', ID);
    if (!n.ok) throw new Error('quote');
    expect(n.quote.base.canAfford).toBe(false);
    expect(n.quote.scroll.canAfford).toBe(false);
  });

  it('still refuses invalid targets with the scroll asked for', () => {
    expect(quoteUpgrade(smithSave(9), C, 'warrior', ID, { blessing: true })).toEqual({ ok: false, reason: 'maxed' });
    expect(quoteUpgrade(freshSave(), C, 'warrior', ID, { blessing: true })).toEqual({ ok: false, reason: 'notOwned' });
  });
});

describe('Blessing Scroll: attempt', () => {
  it('turns a roll between the plain and the blessed chance into a success, for 3x yeop and the same shards', () => {
    const plus = 4;
    const base = B.successRate[plus] as number;
    const roll = fixed(base + 0.05); // 0.60: misses 55 %, hits 70 %
    const plain = attemptUpgrade(smithSave(plus), C, 'warrior', ID, roll);
    expect(plain).toMatchObject({ ok: true, success: false, blessed: false });
    const s = smithSave(plus, 100_000, 100);
    const r = attemptUpgrade(s, C, 'warrior', ID, roll, { blessing: true });
    expect(r).toMatchObject({ ok: true, success: true, blessed: true, from: plus, to: plus + 1, spent: { yeop: 3 * (B.yeopCost[plus] as number), shards: B.shardCost[plus] } });
    if (!r.ok) return;
    expect(r.rate).toBe(0.7);
    expect(r.save.classes.warrior.plus[ID]).toBe(plus + 1);
    expect(r.save.bank.yeop).toBe(100_000 - 3 * (B.yeopCost[plus] as number));
    expect(r.save.bank.shards).toBe(100 - (B.shardCost[plus] as number));
    expect(r.save.stats.blacksmith).toMatchObject({ attempts: 1, successes: 1, yeopSpent: 3 * (B.yeopCost[plus] as number), shardsSpent: B.shardCost[plus] });
    expect(s.bank.yeop).toBe(100_000); // input untouched
  });

  it('a failed blessed attempt costs the scroll too and keeps the item and its level', () => {
    const r = attemptUpgrade(smithSave(5, 1e6, 100), C, 'warrior', ID, fixed(0.999999), { blessing: true });
    expect(r).toMatchObject({ ok: true, success: false, blessed: true, from: 5, to: 5, spent: { yeop: 3 * (B.yeopCost[5] as number), shards: B.shardCost[5] } });
    if (!r.ok) return;
    expect(r.save.classes.warrior.plus[ID]).toBe(5);
    expect(r.save.classes.warrior.collection).toContain(ID);
    expect(r.save.bank.yeop).toBe(1e6 - 3 * (B.yeopCost[5] as number));
  });

  it('the roll is `rng < blessed rate` (edge: exactly the blessed rate fails)', () => {
    const rate = blessedRate(4);
    expect(attemptUpgrade(smithSave(4), C, 'warrior', ID, fixed(rate - 1e-9), { blessing: true })).toMatchObject({ success: true });
    expect(attemptUpgrade(smithSave(4), C, 'warrior', ID, fixed(rate), { blessing: true })).toMatchObject({ success: false });
  });

  it('at the cap the scroll cannot fail: a roll just under 1 still succeeds', () => {
    expect(attemptUpgrade(smithSave(1), C, 'warrior', ID, fixed(0.999999), { blessing: true })).toMatchObject({ success: true, rate: 1 });
    expect(attemptUpgrade(smithSave(1), C, 'warrior', ID, fixed(0.999999))).toMatchObject({ success: false });
  });

  it('refuses without 3x the yeop (or the shards) and spends nothing; the plain attempt is still allowed', () => {
    const need = B.yeopCost[3] as number;
    const poor = smithSave(3, 3 * need - 1, 100);
    expect(attemptUpgrade(poor, C, 'warrior', ID, fixed(0), { blessing: true })).toEqual({ ok: false, reason: 'noYeop' });
    expect(poor.bank.yeop).toBe(3 * need - 1);
    expect(attemptUpgrade(poor, C, 'warrior', ID, fixed(0))).toMatchObject({ ok: true, success: true, blessed: false });
    expect(attemptUpgrade(smithSave(3, 1e9, 0), C, 'warrior', ID, fixed(0), { blessing: true })).toEqual({ ok: false, reason: 'noShards' });
    expect(attemptUpgrade(smithSave(9), C, 'warrior', ID, fixed(0), { blessing: true })).toEqual({ ok: false, reason: 'maxed' });
    // 100 shards pay 20 plain attempts of the +3 step (5 each): the scroll is spare from y x (20 + 2) = 77 000 Yeop
    expect(attemptUpgrade(smithSave(3, 77_000, 100), C, 'warrior', ID, fixed(0), { blessing: true })).toMatchObject({ ok: true, blessed: true });
  });

  it('draws the rng exactly once, with or without the scroll (HASH-EQ: the off path is unchanged)', () => {
    const a = counting(0.3);
    attemptUpgrade(smithSave(3), C, 'warrior', ID, a);
    const b = counting(0.3);
    attemptUpgrade(smithSave(3), C, 'warrior', ID, b, { blessing: true });
    const c = counting(0.3);
    attemptUpgrade(smithSave(3, 0, 100), C, 'warrior', ID, c, { blessing: true }); // refused: no draw
    expect([a.draws, b.draws, c.draws]).toEqual([1, 1, 0]);
  });

  it('{ blessing: false } and no options are the same attempt, roll for roll', () => {
    const run = (opts?: { blessing: boolean }): boolean[] => {
      const rng = seededRng(7);
      const out: boolean[] = [];
      let s = smithSave(5);
      for (let i = 0; i < 40; i++) {
        const r = opts ? attemptUpgrade(s, C, 'warrior', ID, rng, opts) : attemptUpgrade(s, C, 'warrior', ID, rng);
        if (!r.ok) break;
        out.push(r.success);
        s = r.save;
      }
      return out;
    };
    expect(run({ blessing: false })).toEqual(run());
  });

  it('observed success frequency matches the blessed rate at every step it can improve (seeded, 10 000 trials each)', () => {
    const N = 10_000;
    for (let plus = 1; plus < 9; plus++) {
      const rate = blessedRate(plus);
      const rng = seededRng(5000 + plus);
      const base = smithSave(plus);
      let wins = 0;
      for (let i = 0; i < N; i++) {
        const r = attemptUpgrade(base, C, 'warrior', ID, rng, { blessing: true });
        if (r.ok && r.success) wins++;
      }
      const sigma = Math.sqrt((rate * (1 - rate)) / N);
      expect(Math.abs(wins / N - rate)).toBeLessThanOrEqual(4 * sigma + 1e-12);
    }
  }, 60_000);

  it('climbing +0 -> +9 with the scroll on every step it can improve takes fewer attempts, and spends the yeop it should', () => {
    const climb = (blessing: boolean): { attempts: number; yeop: number } => {
      const rng = seededRng(99);
      let attempts = 0;
      let yeop = 0;
      for (let c = 0; c < 200; c++) {
        let s = smithSave(0);
        for (;;) {
          // the first step (+0 -> +1) is certain: the scroll refuses it, the plain attempt takes it
          const r = attemptUpgrade(s, C, 'warrior', ID, rng, { blessing: blessing && (s.classes.warrior.plus[ID] ?? 0) >= 1 });
          if (!r.ok) break;
          attempts++;
          yeop += r.spent.yeop;
          s = r.save;
        }
      }
      return { attempts: attempts / 200, yeop: yeop / 200 };
    };
    const plain = climb(false);
    const scroll = climb(true);
    expect(scroll.attempts).toBeLessThan(plain.attempts - 3);
    expect(scroll.yeop).toBeGreaterThan(plain.yeop * 1.5); // a sink, not a discount
  }, 60_000);
});

describe('Blessing Scroll: the normal campaign opens it (the late-meta Yeop sink, not part of the climb)', () => {
  const opened = (save: SaveData): boolean => scrollUnlocked(save, C);

  it('is closed until the LAST zone by order is cleared on Normal: one zone short, Hard clears and no clears all keep it shut', () => {
    const s = smithSave(4, 1e9, 1e6, false);
    expect(opened(s)).toBe(false);
    // every zone but the last cleared on Normal: one short
    FIXTURE_ZONE_IDS.slice(0, -1).forEach((z) => setClears(s, z, 3));
    expect(opened(s)).toBe(false);
    // the last zone cleared on Hard only (cannot happen in play, but the rule reads Normal)
    setClears(s, LAST_ZONE, 0, 2);
    expect(opened(s)).toBe(false);
    // the clear itself opens it
    setClears(s, LAST_ZONE, 1);
    expect(opened(s)).toBe(true);
    // and it stays open
    setClears(s, LAST_ZONE, 5, 2);
    expect(opened(s)).toBe(true);
  });

  it('the quote says so on the scroll side, whatever the bank holds; the plain side is untouched', () => {
    const shut = quoteUpgrade(smithSave(4, 1e9, 1e6, false), C, 'warrior', ID);
    const open = quoteUpgrade(smithSave(4), C, 'warrior', ID);
    if (!shut.ok || !open.ok) throw new Error('quote');
    expect(shut.quote.scroll).toMatchObject({ available: false, useful: true, canAfford: true });
    expect(open.quote.scroll).toMatchObject({ available: true, useful: true, canAfford: true });
    expect(shut.quote.base).toEqual(open.quote.base);
    expect(shut.quote).toMatchObject({ blessed: false, rate: open.quote.rate, yeop: open.quote.yeop });
  });

  it('a locked scroll is refused with scrollLocked by quote and attempt: nothing spent, no rng draw, the profile untouched', () => {
    const s = smithSave(4, 100_000, 100, false);
    const before = structuredClone(s);
    expect(quoteUpgrade(s, C, 'warrior', ID, { blessing: true })).toEqual({ ok: false, reason: 'scrollLocked' });
    const rng = counting(0);
    expect(attemptUpgrade(s, C, 'warrior', ID, rng, { blessing: true })).toEqual({ ok: false, reason: 'scrollLocked' });
    expect(rng.draws).toBe(0);
    expect(s).toEqual(before);
    // the plain attempt on the same save is not affected
    expect(attemptUpgrade(s, C, 'warrior', ID, counting(0))).toMatchObject({ ok: true, success: true, blessed: false });
  });

  it('the lock comes first: no Yeop, no shards or a certain step do not turn it into another reason', () => {
    expect(attemptUpgrade(smithSave(4, 0, 100, false), C, 'warrior', ID, fixed(0), { blessing: true })).toEqual({ ok: false, reason: 'scrollLocked' });
    expect(attemptUpgrade(smithSave(4, 1e9, 0, false), C, 'warrior', ID, fixed(0), { blessing: true })).toEqual({ ok: false, reason: 'scrollLocked' });
    expect(attemptUpgrade(smithSave(0, 1e9, 100, false), C, 'warrior', ID, fixed(0), { blessing: true })).toEqual({ ok: false, reason: 'scrollLocked' });
    // invalid targets keep their own reason
    expect(attemptUpgrade(smithSave(9, 1e9, 100, false), C, 'warrior', ID, fixed(0), { blessing: true })).toEqual({ ok: false, reason: 'maxed' });
  });

  it('it never charges 3x for 0 points: a step it cannot improve (+0 -> +1) is refused with scrollUseless, even with the campaign done', () => {
    const s = smithSave(0, 1e6, 100);
    const before = structuredClone(s);
    expect(quoteUpgrade(s, C, 'warrior', ID, { blessing: true })).toEqual({ ok: false, reason: 'scrollUseless' });
    const rng = counting(0);
    expect(attemptUpgrade(s, C, 'warrior', ID, rng, { blessing: true })).toEqual({ ok: false, reason: 'scrollUseless' });
    expect(rng.draws).toBe(0);
    expect(s).toEqual(before);
    // the plain +0 -> +1 goes through at the plain price
    expect(attemptUpgrade(s, C, 'warrior', ID, fixed(0))).toMatchObject({ ok: true, success: true, blessed: false, spent: { yeop: B.yeopCost[0] } });
  });

  it('a step the scroll improves only a little (+1: 90 % -> 100 %) is still offered: it is useful, just a poor trade', () => {
    expect(attemptUpgrade(smithSave(1), C, 'warrior', ID, fixed(0.5), { blessing: true })).toMatchObject({ ok: true, blessed: true, rate: 1 });
  });
});

describe('Blessing Scroll: spare Yeop only (it never takes the Yeop of a plain attempt)', () => {
  const y = (plus: number): number => B.yeopCost[plus] as number;
  const sh = (plus: number): number => B.shardCost[plus] as number;
  const scrollOf = (s: SaveData) => {
    const q = quoteUpgrade(s, C, 'warrior', ID);
    if (!q.ok) throw new Error('quote');
    return q.quote.scroll;
  };

  it("reads the reserve off the step: the Yeop of every plain attempt the shards pay for, plus the scroll's extra 2y", () => {
    // +4: 5 500 Yeop and 8 shards a step; 20 shards pay 2 plain attempts -> reserve 5 500 x (2 + 2) = 22 000
    const s = scrollOf(smithSave(4, 22_000, 20));
    expect(s).toMatchObject({ plainAttempts: 2, reserve: y(4) * 4, spare: true, spareShort: 0 });
    // 100 shards pay 12 plain attempts -> 5 500 x 14
    expect(scrollOf(smithSave(4, 1e9, 100))).toMatchObject({ plainAttempts: 12, reserve: y(4) * 14 });
  });

  it('the boundary: one Yeop under the reserve is not spare (refused), exactly the reserve is', () => {
    const reserve = y(4) * (Math.floor(20 / sh(4)) + 2);
    const under = smithSave(4, reserve - 1, 20);
    expect(scrollOf(under)).toMatchObject({ spare: false, spareShort: 1, canAfford: true });
    const before = structuredClone(under);
    const rng = counting(0);
    expect(attemptUpgrade(under, C, 'warrior', ID, rng, { blessing: true })).toEqual({ ok: false, reason: 'scrollNotSpare' });
    expect(rng.draws).toBe(0);
    expect(under).toEqual(before);
    // the plain attempt on the same save is allowed
    expect(attemptUpgrade(under, C, 'warrior', ID, counting(0))).toMatchObject({ ok: true, blessed: false });
    const at = smithSave(4, reserve, 20);
    expect(scrollOf(at)).toMatchObject({ spare: true, spareShort: 0 });
    expect(attemptUpgrade(at, C, 'warrior', ID, fixed(0), { blessing: true })).toMatchObject({ ok: true, blessed: true, spent: { yeop: 3 * y(4), shards: sh(4) } });
  });

  it('with shards for no plain attempt (n = 0) the reserve is 2y and the shard refusal comes first', () => {
    const s = smithSave(4, 1e9, sh(4) - 1);
    expect(scrollOf(s)).toMatchObject({ plainAttempts: 0, reserve: 2 * y(4), spare: true, canAfford: false });
    expect(attemptUpgrade(s, C, 'warrior', ID, fixed(0), { blessing: true })).toEqual({ ok: false, reason: 'noShards' });
    // exactly one plain attempt of shards: n = 1, reserve 3y = the scroll's own price
    expect(scrollOf(smithSave(4, 3 * y(4), sh(4)))).toMatchObject({ plainAttempts: 1, reserve: 3 * y(4), spare: true });
    expect(scrollOf(smithSave(4, 3 * y(4) - 1, sh(4)))).toMatchObject({ plainAttempts: 1, spare: false, spareShort: 1 });
  });

  it('the order of the reasons: invalid target, locked, useless, noYeop, noShards, then scrollNotSpare', () => {
    const blessed: UpgradeOptions = { blessing: true };
    const run = (s: SaveData) => attemptUpgrade(s, C, 'warrior', ID, fixed(0), blessed);
    // every refusal below also lacks spare Yeop: the earlier reason wins
    expect(run(smithSave(9, 0, 0, false))).toEqual({ ok: false, reason: 'maxed' });
    expect(run(smithSave(4, 0, 0, false))).toEqual({ ok: false, reason: 'scrollLocked' });
    expect(run(smithSave(0, 0, 0))).toEqual({ ok: false, reason: 'scrollUseless' });
    expect(run(smithSave(4, 3 * y(4) - 1, 1e6))).toEqual({ ok: false, reason: 'noYeop' }); // spare is also false
    expect(run(smithSave(4, 1e6, sh(4) - 1))).toEqual({ ok: false, reason: 'noShards' });
    expect(run(smithSave(4, 3 * y(4), 1e6))).toEqual({ ok: false, reason: 'scrollNotSpare' }); // pays the scroll, not the other attempts
  });

  it('is judged whatever the lock says: the quote carries the spare side before the campaign is done (the UI shows locked first)', () => {
    expect(scrollOf(smithSave(4, 1e9, 20, false))).toMatchObject({ available: false, spare: true });
    expect(scrollOf(smithSave(4, 1000, 20, false))).toMatchObject({ available: false, spare: false });
  });

  it('what the rule promises: an allowed scroll leaves Yeop for every other plain attempt the shards pay for; a refused one would not', () => {
    const rng = seededRng(31);
    let allowed = 0;
    let refused = 0;
    for (let i = 0; i < 4000; i++) {
      const plus = 1 + Math.floor(rng.next() * 8);
      const yeop = Math.floor(rng.next() * y(plus) * 40);
      const shards = Math.floor(rng.next() * sh(plus) * 12);
      const s = smithSave(plus, yeop, shards);
      const n = Math.floor(shards / sh(plus));
      const r = attemptUpgrade(s, C, 'warrior', ID, fixed(0.99), { blessing: true });
      if (r.ok) {
        allowed++;
        // n - 1 plain attempts remain by shards, and the Yeop left still pays all of them
        expect(Math.floor(r.save.bank.shards / sh(plus))).toBe(n - 1);
        expect(r.save.bank.yeop).toBeGreaterThanOrEqual(y(plus) * (n - 1));
      } else if (r.reason === 'scrollNotSpare') {
        refused++;
        // the scroll was payable (3y, shards for one), but it would take Yeop that a plain attempt could use
        expect(yeop).toBeGreaterThanOrEqual(3 * y(plus));
        expect(n).toBeGreaterThanOrEqual(1);
        expect(yeop - 3 * y(plus)).toBeLessThan(y(plus) * (n - 1));
      }
    }
    expect(allowed).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
  });

  it('climbing with the scroll on spare Yeop only is never slower than plain play on the same rolls (every plain attempt still happens)', () => {
    // one rich campaign-end bank (Yeop is spare), the same rng for both arms: blessed attempts only add chance, they take no plain attempt
    const climb = (blessing: boolean): number => {
      const rng = seededRng(77);
      let total = 0;
      for (let c = 0; c < 150; c++) {
        let s = smithSave(1, 400_000, 220);
        for (;;) {
          const q = quoteUpgrade(s, C, 'warrior', ID);
          if (!q.ok) break; // +9: nothing left to refine
          const sc = q.quote.scroll;
          const r = attemptUpgrade(s, C, 'warrior', ID, rng, { blessing: blessing && sc.available && sc.spare && sc.useful });
          if (!r.ok) break;
          s = r.save;
        }
        total += s.classes.warrior.plus[ID] ?? 0;
      }
      return total / 150;
    };
    const plain = climb(false);
    const scroll = climb(true);
    expect(scroll).toBeGreaterThanOrEqual(plain);
  }, 60_000);
});

describe('Blessing Scroll: through the meta service', () => {
  async function open(): Promise<MetaService> {
    const svc = await MetaService.open({ content: C, store: new MemoryStore(), rng: seededRng(5), now: () => 1_700_000_000_000, channel: null });
    const s = svc.save;
    s.classes.warrior.collection.push(ID);
    s.bank.yeop = 100_000;
    s.bank.shards = 50;
    return svc;
  }

  it('upgradeGear forwards the scroll, commits the spend and keeps a refused scroll off the profile', async () => {
    const svc = await open();
    setClears(svc.save, LAST_ZONE, 1);
    const plain0 = svc.upgradeGear('warrior', ID, { next: () => 0 });
    expect(plain0).toMatchObject({ ok: true, blessed: false, spent: { yeop: B.yeopCost[0] } });
    const r = svc.upgradeGear('warrior', ID, { next: () => 0 }, { blessing: true });
    expect(r).toMatchObject({ ok: true, success: true, blessed: true, spent: { yeop: 3 * (B.yeopCost[1] as number) } });
    expect(svc.save.bank.yeop).toBe(100_000 - (B.yeopCost[0] as number) - 3 * (B.yeopCost[1] as number));
    // a refused scroll leaves the profile untouched
    svc.save.bank.yeop = 1;
    const rev = svc.revision;
    expect(svc.upgradeGear('warrior', ID, { next: () => 0 }, { blessing: true })).toEqual({ ok: false, reason: 'noYeop' });
    expect(svc.revision).toBe(rev);
  });

  it('a locked scroll is refused through the service too (revision, bank and stats unchanged); the clear of the last zone opens it', async () => {
    const svc = await open();
    const rev = svc.revision;
    const snap = structuredClone(svc.save);
    expect(svc.upgradeGear('warrior', ID, { next: () => 0 }, { blessing: true })).toEqual({ ok: false, reason: 'scrollLocked' });
    // one zone short is still locked
    FIXTURE_ZONE_IDS.slice(0, -1).forEach((z) => setClears(svc.save, z, 1));
    expect(svc.upgradeGear('warrior', ID, { next: () => 0 }, { blessing: true })).toEqual({ ok: false, reason: 'scrollLocked' });
    expect(svc.revision).toBe(rev);
    expect(svc.save.bank).toEqual(snap.bank);
    expect(svc.save.stats.blacksmith).toEqual(snap.stats.blacksmith);
    // the plain attempt works the whole time
    expect(svc.upgradeGear('warrior', ID, { next: () => 0 })).toMatchObject({ ok: true, blessed: false });
    // the clear opens it
    setClears(svc.save, LAST_ZONE, 1);
    expect(svc.upgradeGear('warrior', ID, { next: () => 0 }, { blessing: true })).toMatchObject({ ok: true, blessed: true });
  });

  it('a scroll over Yeop the plain attempts still need is refused through the service with nothing committed; spare Yeop reads it', async () => {
    const svc = await open();
    setClears(svc.save, LAST_ZONE, 1);
    // the +0 -> +1 step is certain: take it plain, then face +1 -> +2 (1 000 Yeop, 2 shards a step): 49 shards left -> 24 plain attempts
    expect(svc.upgradeGear('warrior', ID, { next: () => 0 })).toMatchObject({ ok: true, blessed: false });
    const n = Math.floor(svc.save.bank.shards / (B.shardCost[1] as number));
    svc.save.bank.yeop = 3 * (B.yeopCost[1] as number); // pays the scroll, not the other n - 1 attempts
    const rev = svc.revision;
    const snap = structuredClone(svc.save);
    expect(svc.upgradeGear('warrior', ID, { next: () => 0 }, { blessing: true })).toEqual({ ok: false, reason: 'scrollNotSpare' });
    expect(svc.revision).toBe(rev);
    expect(svc.save.bank).toEqual(snap.bank);
    expect(svc.save.stats.blacksmith).toEqual(snap.stats.blacksmith);
    svc.save.bank.yeop = (B.yeopCost[1] as number) * (n + 2);
    expect(svc.upgradeGear('warrior', ID, { next: () => 0 }, { blessing: true })).toMatchObject({ ok: true, blessed: true });
  });
});


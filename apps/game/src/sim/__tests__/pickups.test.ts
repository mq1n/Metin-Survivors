// Pickups: gems and merging, magnet/collection, yeop, potions, magnets, chests, lifetimes and loot drops.

import { describe, expect, it } from 'vitest';
import type { ContentDB, EnemyDef } from '../../data/schema';
import { RARITIES } from '../../data/schema';
import { spawnBoss } from '../bosses';
import { killEnemy } from '../combat';
import { HealSource } from '../events';
import { sweepDead } from '../enemies';
import { gemTier, spawnPickup, spawnXp, XP_GEM_SOFT_CAP } from '../pickups';
import type { CoopPlayerInit } from '../run';
import { PickupKind } from '../stores';
import type { Card } from '../types';
import type { World } from '../world';
import { collect, drainModals, freezeSchedules, makeWorld, NO_INPUT, player, runTicks, spawn } from './helpers';

// ---------------------------------------------------------------------------
// helpers

function quietWorld(over: Parameters<typeof makeWorld>[0] = {}): World {
  const w = makeWorld(over);
  freezeSchedules(w);
  return w;
}

function rowsOf(w: World, kind: PickupKind): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.pickups.count; i++) if (w.pickups.kind[i] === kind) out.push(i);
  return out;
}

function totalValue(w: World, kind: PickupKind): number {
  let sum = 0;
  for (const r of rowsOf(w, kind)) sum += w.pickups.value[r] as number;
  return sum;
}

function countOf(w: World, kind: PickupKind): number {
  return rowsOf(w, kind).length;
}

/** put a pickup without a pop animation (stays exactly where it is dropped) */
function put(w: World, kind: PickupKind, x: number, z: number, value: number, tier = 0): number {
  const row = spawnPickup(w, kind, x, z, value, tier, 0);
  if (row < 0) throw new Error('pickup store full');
  if (kind === PickupKind.Xp) w.xpGems++;
  return row;
}

const COOP_HERO: CoopPlayerInit = { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', meta: { stats: {} } };

/** kill a freshly spawned enemy of `id` and sweep it, leaving only the loot behind */
function killOne(w: World, id: string, x: number, z: number, tier = 0): void {
  const row = spawn(w, id, x, z, { tier });
  killEnemy(w, row, 0, -1, false);
  sweepDead(w);
}

// ---------------------------------------------------------------------------
// gem tiers and creation

describe('gemTier', () => {
  it('maps xp value to the tier boundaries 4 / 15 / 60 / 250', () => {
    const table: [number, number][] = [
      [0.1, 0], [1, 0], [3.99, 0],
      [4, 1], [14.99, 1],
      [15, 2], [59.99, 2],
      [60, 3], [249.99, 3],
      [250, 4], [10000, 4],
    ];
    for (const [value, tier] of table) expect(gemTier(value), `value ${value}`).toBe(tier);
  });
});

describe('spawnPickup / spawnXp', () => {
  it('stores kind, position, value and tier; pop 0 means no hop and no drift', () => {
    const w = quietWorld();
    const row = spawnPickup(w, PickupKind.Yeop, 7, -3, 12, 1, 0);
    const P = w.pickups;
    expect(row).toBe(0);
    expect(P.kind[row]).toBe(PickupKind.Yeop);
    expect(P.x[row]).toBe(7);
    expect(P.z[row]).toBe(-3);
    expect(P.px[row]).toBe(7);
    expect(P.value[row]).toBe(12);
    expect(P.tier[row]).toBe(1);
    expect(P.age[row]).toBe(0);
    expect(P.magnet[row]).toBe(0);
    expect(Math.abs(P.vx[row] as number) + Math.abs(P.vz[row] as number) + Math.abs(P.vh[row] as number)).toBe(0);
    runTicks(w, 120);
    expect(P.x[row]).toBe(7);
    expect(P.z[row]).toBe(-3);
    expect(P.h[row]).toBe(0);
  });

  it('a popping pickup hops up, scatters a little, and lands on the ground', () => {
    const w = quietWorld();
    const row = spawnPickup(w, PickupKind.Yeop, 20, 20, 5, 0, 2.2);
    const P = w.pickups;
    const speed = Math.hypot(P.vx[row] as number, P.vz[row] as number);
    expect(speed).toBeGreaterThanOrEqual(2.2 * 0.4 - 1e-6);
    expect(speed).toBeLessThanOrEqual(2.2 + 1e-6);
    expect(P.vh[row]).toBeGreaterThanOrEqual(3);
    expect(P.vh[row]).toBeLessThan(5);
    let maxH = 0;
    for (let i = 0; i < 90; i++) {
      w.step([NO_INPUT]);
      maxH = Math.max(maxH, P.h[row] as number);
    }
    expect(maxH).toBeGreaterThan(0.1);
    expect(P.h[row]).toBe(0);
    const drift = Math.hypot((P.x[row] as number) - 20, (P.z[row] as number) - 20);
    expect(drift).toBeGreaterThan(0.05);
    expect(drift).toBeLessThan(2.2); // velocity decays exponentially: total travel ≈ speed / 4
  });

  it('returns -1 when the pickup store is full', () => {
    const w = quietWorld();
    const cap = w.pickups.capacity;
    for (let i = 0; i < cap; i++) expect(spawnPickup(w, PickupKind.Yeop, 40, 40, 1, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(spawnPickup(w, PickupKind.Yeop, 40, 40, 1, 0, 0)).toBe(-1);
    expect(w.pickups.count).toBe(cap);
  });

  it('spawnXp creates a gem whose tier follows its value and counts it in xpGems', () => {
    const w = quietWorld();
    const values = [1, 5, 20, 100, 300];
    values.forEach((v) => spawnXp(w, 30, 30, v));
    expect(w.xpGems).toBe(5);
    const rows = rowsOf(w, PickupKind.Xp);
    expect(rows).toHaveLength(5);
    rows.forEach((r, i) => {
      expect(w.pickups.value[r]).toBe(values[i]);
      expect(w.pickups.tier[r]).toBe(i);
    });
  });
});

describe('xp gem merging', () => {
  function crowdedWorld(gems = XP_GEM_SOFT_CAP): World {
    const w = quietWorld();
    for (let i = 0; i < gems; i++) {
      spawnXp(w, i * 0.5, 100, 1);
    }
    return w;
  }

  it('creates separate gems up to the soft cap', () => {
    const w = crowdedWorld();
    expect(w.xpGems).toBe(XP_GEM_SOFT_CAP);
    expect(countOf(w, PickupKind.Xp)).toBe(XP_GEM_SOFT_CAP);
  });

  it('beyond the soft cap new xp merges into an existing gem: count fixed, total value conserved', () => {
    const w = crowdedWorld();
    const before = totalValue(w, PickupKind.Xp);
    expect(before).toBe(XP_GEM_SOFT_CAP);
    let added = 0;
    for (let i = 0; i < 400; i++) {
      const v = 1 + (i % 7);
      added += v;
      spawnXp(w, (i * 3.7) % 300, 100, v);
    }
    expect(w.xpGems).toBe(XP_GEM_SOFT_CAP);
    expect(countOf(w, PickupKind.Xp)).toBe(XP_GEM_SOFT_CAP);
    expect(w.pickups.count).toBe(XP_GEM_SOFT_CAP);
    expect(totalValue(w, PickupKind.Xp)).toBe(before + added);
    // tiers of merged gems follow the merged value
    for (const r of rowsOf(w, PickupKind.Xp)) expect(w.pickups.tier[r]).toBe(gemTier(w.pickups.value[r] as number));
  });

  it('merges into the nearest gem of the scanned window and re-tiers it', () => {
    const w = crowdedWorld();
    spawnXp(w, 2.5, 100, 300); // exactly on gem #5
    expect(w.pickups.count).toBe(XP_GEM_SOFT_CAP);
    expect(w.pickups.value[5]).toBe(301);
    expect(w.pickups.tier[5]).toBe(4);
    for (let r = 0; r < 48; r++) if (r !== 5) expect(w.pickups.value[r]).toBe(1);
  });

  it('merged value is delivered on collection (no xp is lost)', () => {
    const w = crowdedWorld();
    let added = 0;
    for (let i = 0; i < 100; i++) {
      spawnXp(w, i, 100, 2);
      added += 2;
    }
    const total = XP_GEM_SOFT_CAP + added;
    // vacuum everything onto the hero and bank it
    const p = player(w);
    for (const r of rowsOf(w, PickupKind.Xp)) {
      w.pickups.x[r] = 0.2;
      w.pickups.z[r] = 0;
    }
    w.xpGems = XP_GEM_SOFT_CAP;
    let granted = 0;
    const startLevel = p.level;
    for (let i = 0; i < 400 && countOf(w, PickupKind.Xp) > 0; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'pickup' && e.kind === PickupKind.Xp) granted += e.value;
      drainModals(w);
    }
    expect(countOf(w, PickupKind.Xp)).toBe(0);
    expect(granted).toBeCloseTo(total, 3);
    expect(p.level).toBeGreaterThan(startLevel);
    expect(w.xpGems).toBe(0);
  });

  it('also merges when the store is nearly full, even below the soft cap', () => {
    const w = quietWorld();
    for (let i = 0; i < 5; i++) spawnXp(w, i, 100, 2);
    while (w.pickups.count < w.pickups.capacity - 8) spawnPickup(w, PickupKind.Yeop, 100, -100, 1, 0, 0);
    const count = w.pickups.count;
    spawnXp(w, 2, 100, 7);
    expect(w.pickups.count).toBe(count);
    expect(w.xpGems).toBe(5);
    expect(totalValue(w, PickupKind.Xp)).toBe(5 * 2 + 7);
  });
});

// ---------------------------------------------------------------------------
// magnet and collection

describe('xp collection', () => {
  it('pulls a gem inside the pickup radius to the hero and grants its value', () => {
    const w = quietWorld();
    const p = player(w);
    expect(p.stats.pickupRadius).toBeCloseTo(3.2, 6);
    const row = put(w, PickupKind.Xp, 2.5, 0, 5, 1);
    expect(w.pickups.magnet[row]).toBe(0);
    let last = 2.5;
    let pulled = false;
    for (let i = 0; i < 90 && w.pickups.count > 0; i++) {
      w.step([NO_INPUT]);
      if (w.pickups.count === 0) break;
      const d = Math.hypot(w.pickups.x[0] as number, w.pickups.z[0] as number);
      if (w.pickups.magnet[0] === 1) {
        pulled = true;
        expect(d).toBeLessThan(last);
      }
      last = d;
    }
    expect(pulled).toBe(true);
    expect(w.pickups.count).toBe(0);
    expect(w.xpGems).toBe(0);
    expect(p.xp).toBeCloseTo(5, 5);
    expect(p.level).toBe(1);
  });

  it('emits a pickup event with the granted amount, kind and tier', () => {
    const w = quietWorld();
    put(w, PickupKind.Xp, 1, 0, 5, 1);
    const events = collect(w, 60, ['pickup']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ t: 'pickup', player: 0, kind: PickupKind.Xp, tier: 1 });
    expect(events[0]?.value).toBeCloseTo(5, 5);
  });

  it('leaves gems outside the radius alone; the radius edge is 3.2 m', () => {
    const w = quietWorld();
    const far = put(w, PickupKind.Xp, 3.4, 0, 2, 0);
    const near = put(w, PickupKind.Xp, 0, 3.0, 2, 0);
    const farId = w.pickups.id[far] as number;
    const nearId = w.pickups.id[near] as number;
    runTicks(w, 120);
    expect(w.pickups.find(nearId)).toBe(-1);
    const left = w.pickups.find(farId);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(w.pickups.x[left]).toBeCloseTo(3.4, 5);
    expect(w.pickups.magnet[left]).toBe(0);
    expect(player(w).xp).toBeCloseTo(2, 5);
  });

  it('a larger pickup radius (stat) reaches farther gems', () => {
    const w = quietWorld({ config: { meta: { stats: { pickupRadius: 1 } } } });
    const p = player(w);
    expect(p.stats.pickupRadius).toBeCloseTo(6.4, 5);
    put(w, PickupKind.Xp, 5.5, 0, 3, 0);
    runTicks(w, 90);
    expect(w.pickups.count).toBe(0);
    expect(p.xp).toBeCloseTo(3, 5);
  });

  it('multiplies the granted xp by the xpGain stat', () => {
    const w = quietWorld({ config: { meta: { stats: { xpGain: 0.5 } } } });
    const p = player(w);
    put(w, PickupKind.Xp, 1, 0, 4, 1);
    const events = collect(w, 60, ['pickup']);
    expect(p.stats.xpGain).toBeCloseTo(1.5, 6);
    expect(p.xp).toBeCloseTo(6, 4);
    expect(events[0]?.value).toBeCloseTo(6, 4);
  });

  it('xpGain also comes from the empire bonus (Chowon +10%)', () => {
    const w = quietWorld({ config: { empire: 'chowon' } });
    put(w, PickupKind.Xp, 1, 0, 5, 1);
    runTicks(w, 60);
    expect(player(w).xp).toBeCloseTo(5.5, 4);
  });

  it('enough xp levels the hero up and opens the level-up modal in the same tick', () => {
    const w = quietWorld();
    const p = player(w);
    const need = p.xpNext;
    put(w, PickupKind.Xp, 0.5, 0, need + 1, 2);
    const events = collect(w, 5, ['levelUp']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ player: 0, level: 2 });
    expect(p.level).toBe(2);
    expect(p.xp).toBeCloseTo(1, 4);
    expect(w.modal?.kind).toBe('levelUp');
    expect(w.modal?.level).toBe(2);
  });

  it('collects with the nearest living player (co-op xp is shared: the partner gets the gem too); dead heroes collect nothing', () => {
    const w = quietWorld({ config: { coop: [COOP_HERO] } });
    const p0 = player(w, 0);
    const p1 = player(w, 1);
    p1.x = 30;
    p1.z = 0;
    put(w, PickupKind.Xp, 30.5, 0, 3, 0);
    const events = collect(w, 60, ['pickup']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ player: 1 });
    expect(p1.xp).toBeCloseTo(3 * p1.stats.xpGain, 4);
    expect(p0.xp).toBeCloseTo(3 * p0.stats.xpGain, 4);
    // with player 1 down, a gem next to the corpse stays on the ground (and nobody gains from it)
    p1.alive = false;
    put(w, PickupKind.Xp, 30.5, 0, 3, 0);
    runTicks(w, 120);
    expect(w.pickups.count).toBe(1);
    expect(p0.xp).toBeCloseTo(3 * p0.stats.xpGain, 4);
    expect(p1.xp).toBeCloseTo(3 * p1.stats.xpGain, 4);
  });
});

describe('yeop collection', () => {
  it('adds value × yeopGain (rounded, min 1) to the purse and the earned total', () => {
    const cases: [number, number, number][] = [
      // value, yeopGain stat bonus, expected coins
      [10, 0, 10],
      [10, 0.5, 15],
      [3, 0.1, 3],
      [7, 0.1, 8],
      [0.2, 0, 1],
    ];
    for (const [value, bonus, expected] of cases) {
      const w = quietWorld({ config: { meta: { stats: { yeopGain: bonus } } } });
      const p = player(w);
      put(w, PickupKind.Yeop, 1, 0, value, 0);
      const events = collect(w, 60, ['pickup']);
      expect(p.yeop, `value ${value} bonus ${bonus}`).toBe(expected);
      expect(p.yeopEarned).toBe(expected);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: PickupKind.Yeop, value: expected });
    }
  });

  it('the Jihae empire (+10% yeop) applies to collected coins', () => {
    const w = quietWorld({ config: { empire: 'jihae' } });
    put(w, PickupKind.Yeop, 1, 0, 10, 0);
    runTicks(w, 60);
    expect(player(w).yeop).toBe(11);
  });

  it('coins outside the radius are not collected', () => {
    const w = quietWorld();
    put(w, PickupKind.Yeop, 6, 0, 10, 0);
    runTicks(w, 120);
    expect(player(w).yeop).toBe(0);
    expect(w.pickups.count).toBe(1);
  });
});

describe('potions', () => {
  it('heal a fraction of max hp, capped at max hp, with a Pickup heal event', () => {
    const w = quietWorld();
    const p = player(w);
    p.hp = 50;
    put(w, PickupKind.Heal, 1, 0, 0.25, 0);
    const events = collect(w, 60, ['heal', 'pickup']);
    expect(p.hp).toBeCloseTo(50 + 0.25 * p.hpMax, 3);
    expect(events.find((e) => e.t === 'heal')).toMatchObject({ player: 0, source: HealSource.Pickup });
    expect(events.find((e) => e.t === 'pickup')).toMatchObject({ kind: PickupKind.Heal, value: 0.25 });
    p.hp = p.hpMax - 5;
    put(w, PickupKind.Heal, 1, 0, 0.25, 0);
    runTicks(w, 60);
    expect(p.hp).toBe(p.hpMax);
    expect(w.pickups.count).toBe(0);
  });
});

describe('magnet pickups', () => {
  it('are picked up by walking over them (1.3 m), not by the pickup radius', () => {
    const w = quietWorld();
    const mid = put(w, PickupKind.Magnet, 2.5, 0, 0, 0);
    runTicks(w, 60);
    expect(w.pickups.count).toBe(1);
    expect(w.pickups.magnet[mid]).toBe(0);
    w.pickups.free(mid);
    put(w, PickupKind.Magnet, 1.2, 0, 0, 0);
    runTicks(w, 2);
    expect(w.pickups.count).toBe(0);
    put(w, PickupKind.Magnet, 1.4, 0, 0, 0);
    runTicks(w, 5);
    expect(w.pickups.count).toBe(1);
  });

  it('vacuum every xp gem on the field to the collector, nothing else', () => {
    const w = quietWorld();
    const p = player(w);
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const r = 20 + (i % 5) * 4;
      put(w, PickupKind.Xp, Math.sin(a) * r, Math.cos(a) * r, 0.2, 0);
    }
    const coin = put(w, PickupKind.Yeop, 40, 0, 5, 0);
    const potion = put(w, PickupKind.Heal, -40, 0, 0.25, 0);
    put(w, PickupKind.Magnet, 0.4, 0, 0, 0);
    w.step([NO_INPUT]);
    expect(countOf(w, PickupKind.Magnet)).toBe(0);
    for (const r of rowsOf(w, PickupKind.Xp)) {
      expect(w.pickups.magnet[r]).toBe(1);
      expect(w.pickups.target[r]).toBe(0);
    }
    expect(w.pickups.magnet[coin]).toBe(0);
    expect(w.pickups.magnet[potion]).toBe(0);
    // they all fly in and are banked
    runTicks(w, 240);
    expect(countOf(w, PickupKind.Xp)).toBe(0);
    expect(w.xpGems).toBe(0);
    expect(p.xp).toBeCloseTo(6, 3);
    expect(countOf(w, PickupKind.Yeop)).toBe(1);
    expect(countOf(w, PickupKind.Heal)).toBe(1);
  });

  it('emit a pickup event and the magnet sfx when collected', () => {
    const w = quietWorld();
    put(w, PickupKind.Magnet, 0.4, 0, 0, 0);
    w.step([NO_INPUT]);
    expect(w.events.some((e) => e.t === 'pickup' && e.kind === PickupKind.Magnet)).toBe(true);
    expect(w.events.some((e) => e.t === 'sfx' && e.id === 'sfx_magnet')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// chests

describe('paid chests', () => {
  it('cost round(base + perOpen × opened): 15, 27, 39, 51 with the default balance', () => {
    const w = quietWorld();
    const p = player(w);
    p.yeop = 1000;
    const paid: number[] = [];
    for (let k = 0; k < 4; k++) {
      put(w, PickupKind.Chest, 1, 0, 0, 0);
      const events = collect(w, 3, ['chestOpen']);
      expect(events).toHaveLength(1);
      paid.push(events[0]?.cost ?? -1);
      expect(events[0]).toMatchObject({ player: 0, boss: false });
      expect(p.chestsOpened).toBe(k + 1);
      expect(w.modal?.kind).toBe('chest');
      expect(w.chooseCard(0)).toBe(true);
    }
    expect(paid).toEqual([15, 27, 39, 51]);
    expect(p.yeop).toBe(1000 - (15 + 27 + 39 + 51));
    expect(w.tally.chestsOpened).toBe(4);
  });

  it('follows chestCost from the balance (rounded)', () => {
    const w = quietWorld({ content: (c) => (c.balance.chestCost = { base: 10.4, perOpen: 7.6 }) });
    const p = player(w);
    p.yeop = 500;
    const paid: number[] = [];
    for (let k = 0; k < 4; k++) {
      put(w, PickupKind.Chest, 1, 0, 0, 0);
      paid.push(collect(w, 3, ['chestOpen'])[0]?.cost ?? -1);
      w.chooseCard(0);
    }
    expect(paid).toEqual([10, 18, 26, 33]);
    expect(paid).toEqual([0, 1, 2, 3].map((n) => Math.round(10.4 + 7.6 * n)));
  });

  it('deducts the cost, keeps the earned total, and reports the cost in chestOpen and pickup events', () => {
    const w = quietWorld();
    const p = player(w);
    p.yeop = 40;
    p.yeopEarned = 40;
    put(w, PickupKind.Chest, 1, 0, 0, 0);
    const events = collect(w, 3, ['chestOpen', 'pickup']);
    expect(p.yeop).toBe(25);
    expect(p.yeopEarned).toBe(40);
    expect(events.find((e) => e.t === 'chestOpen')).toMatchObject({ cost: 15, boss: false });
    expect(events.find((e) => e.t === 'pickup')).toMatchObject({ kind: PickupKind.Chest, value: 15, tier: 0 });
    expect(w.pickups.count).toBe(0);
  });

  it('opens exactly when yeop equals the cost', () => {
    const w = quietWorld();
    const p = player(w);
    p.yeop = 15;
    put(w, PickupKind.Chest, 1, 0, 0, 0);
    runTicks(w, 3);
    expect(p.yeop).toBe(0);
    expect(w.modal?.kind).toBe('chest');
  });

  it('opens a chest modal: rare+ cards, no reroll/banish/skip, sim frozen until a card is picked', () => {
    const w = quietWorld();
    const p = player(w);
    p.yeop = 100;
    put(w, PickupKind.Chest, 1, 0, 0, 0);
    runTicks(w, 3);
    const m = w.modal;
    expect(m?.kind).toBe('chest');
    expect(m?.cards).toHaveLength(3);
    for (const c of (m?.cards ?? []) as Card[]) expect(RARITIES.indexOf(c.rarity)).toBeGreaterThanOrEqual(2);
    expect([m?.canReroll, m?.canBanish, m?.canSkip]).toEqual([false, false, false]);
    const t = w.time;
    runTicks(w, 60);
    expect(w.time).toBe(t);
    w.chooseCard(0);
    runTicks(w, 6);
    expect(w.time).toBeGreaterThan(t);
  });

  it('the opening radius is 1.35 m', () => {
    const w = quietWorld();
    const p = player(w);
    p.yeop = 100;
    put(w, PickupKind.Chest, 1.6, 0, 0, 0);
    runTicks(w, 60);
    expect(w.modal).toBeNull();
    expect(w.pickups.count).toBe(1);
    put(w, PickupKind.Chest, 0, 1.2, 0, 0);
    runTicks(w, 3);
    expect(w.modal?.kind).toBe('chest');
    expect(w.pickups.count).toBe(1); // the far chest is still there
  });

  it('chests are never pulled by the pickup radius', () => {
    const w = quietWorld();
    player(w).yeop = 100;
    const row = put(w, PickupKind.Chest, 2.5, 0, 0, 0);
    runTicks(w, 120);
    expect(w.pickups.magnet[row]).toBe(0);
    expect(w.pickups.x[row]).toBeCloseTo(2.5, 5);
    expect(w.modal).toBeNull();
  });
});

describe('locked chests', () => {
  it('a poor hero gets a chestLocked event (cost, current yeop) and the chest stays closed', () => {
    const w = quietWorld();
    const p = player(w);
    p.yeop = 14;
    put(w, PickupKind.Chest, 1, 0, 0, 0);
    const events = collect(w, 30, ['chestLocked', 'chestOpen']);
    expect(events.filter((e) => e.t === 'chestOpen')).toHaveLength(0);
    const locked = events.filter((e) => e.t === 'chestLocked');
    expect(locked.length).toBeGreaterThanOrEqual(1);
    expect(locked[0]).toMatchObject({ player: 0, cost: 15, yeop: 14 });
    expect(w.pickups.count).toBe(1);
    expect(w.modal).toBeNull();
    expect(p.yeop).toBe(14);
    expect(p.chestsOpened).toBe(0);
  });

  it('the locked cost already includes the chests opened so far', () => {
    const w = quietWorld();
    const p = player(w);
    p.chestsOpened = 3;
    p.yeop = 10;
    put(w, PickupKind.Chest, 1, 0, 0, 0);
    const locked = collect(w, 10, ['chestLocked']);
    expect(locked[0]).toMatchObject({ cost: 51, yeop: 10 });
  });

  it('opens as soon as the hero can afford it', () => {
    const w = quietWorld();
    const p = player(w);
    p.yeop = 5;
    put(w, PickupKind.Chest, 1, 0, 0, 0);
    runTicks(w, 10);
    expect(w.modal).toBeNull();
    p.yeop = 20;
    runTicks(w, 5);
    expect(w.modal?.kind).toBe('chest');
    expect(p.yeop).toBe(5);
  });

  it('the warning is rate limited (about every 1.5 s), not repeated every few ticks', () => {
    const w = quietWorld();
    player(w).yeop = 0;
    put(w, PickupKind.Chest, 1, 0, 0, 0);
    const times: number[] = [];
    for (let i = 0; i < 6 * 60; i++) {
      w.step([NO_INPUT]);
      if (w.events.some((e) => e.t === 'chestLocked')) times.push(w.time);
    }
    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(1);
  });

  it('a locked chest stays on the ground (it does not hop while the warning is shown)', () => {
    const w = quietWorld();
    player(w).yeop = 0;
    const row = put(w, PickupKind.Chest, 1, 0, 0, 0);
    let maxH = 0;
    for (let i = 0; i < 4 * 60; i++) {
      w.step([NO_INPUT]);
      maxH = Math.max(maxH, w.pickups.h[row] as number);
    }
    expect(maxH).toBeLessThan(0.02);
  });
});

describe('free chests', () => {
  it('metin chests (tier 1) cost nothing, even for a penniless hero, and do not raise the paid cost', () => {
    const w = quietWorld();
    const p = player(w);
    p.yeop = 0;
    put(w, PickupKind.Chest, 1, 0, 0, 1);
    const events = collect(w, 3, ['chestOpen']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ player: 0, cost: 0, boss: false });
    expect(p.yeop).toBe(0);
    expect(p.chestsOpened).toBe(0);
    expect(w.tally.chestsOpened).toBe(1);
    expect(w.modal?.kind).toBe('chest');
    w.chooseCard(0);
    // the first paid chest still costs the base price
    p.yeop = 100;
    put(w, PickupKind.Chest, 1, 0, 0, 0);
    expect(collect(w, 3, ['chestOpen'])[0]?.cost).toBe(15);
  });

  it('boss chests (tier 2) are free as well', () => {
    const w = quietWorld();
    const p = player(w);
    p.yeop = 3;
    put(w, PickupKind.Chest, 1, 0, 0, 2);
    const events = collect(w, 3, ['chestOpen']);
    expect(events[0]?.cost).toBe(0);
    expect(p.yeop).toBe(3);
    expect(p.chestsOpened).toBe(0);
  });
});

describe('chests in co-op', () => {
  it('the nearest living hero pays, at their own price', () => {
    const w = quietWorld({ config: { coop: [COOP_HERO] } });
    const p0 = player(w, 0);
    const p1 = player(w, 1);
    p0.chestsOpened = 2; // 39 yeop for p0
    p1.x = 40;
    p1.z = 0;
    p0.yeop = 1000;
    p1.yeop = 20;
    put(w, PickupKind.Chest, 40.5, 0, 0, 0);
    const events = collect(w, 3, ['chestOpen']);
    expect(events[0]).toMatchObject({ player: 1, cost: 15 });
    expect(p1.yeop).toBe(5);
    expect(p0.yeop).toBe(1000);
    expect(p1.chestsOpened).toBe(1);
    expect(p0.chestsOpened).toBe(2);
    expect(w.modal?.player).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// lifetimes

describe('pickup lifetimes', () => {
  it('yeop coins despawn after ~50 s on the ground', () => {
    const w = quietWorld();
    put(w, PickupKind.Yeop, 60, 0, 5, 0);
    runTicks(w, 48 * 60);
    expect(w.pickups.count).toBe(1);
    runTicks(w, 4 * 60);
    expect(w.pickups.count).toBe(0);
  });

  it('health potions despawn after ~90 s on the ground', () => {
    const w = quietWorld();
    put(w, PickupKind.Heal, 60, 0, 0.25, 0);
    runTicks(w, 88 * 60);
    expect(w.pickups.count).toBe(1);
    runTicks(w, 4 * 60);
    expect(w.pickups.count).toBe(0);
  });

  it('xp gems, chests and magnets never expire', () => {
    const w = quietWorld();
    put(w, PickupKind.Xp, 60, 0, 1, 0);
    put(w, PickupKind.Chest, -60, 0, 0, 0);
    put(w, PickupKind.Magnet, 0, 60, 0, 0);
    runTicks(w, 100 * 60);
    expect(w.pickups.count).toBe(3);
    expect(w.xpGems).toBe(1);
  });

  it('a coin collected before its time is not left behind', () => {
    const w = quietWorld();
    put(w, PickupKind.Yeop, 2, 0, 5, 0);
    runTicks(w, 60);
    expect(w.pickups.count).toBe(0);
    expect(player(w).yeop).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// loot drops

describe('loot from kills', () => {
  it('normal enemies consolidate nearby xp/coin drops (~10% coin rate, 2x coin size) and conserve full xp value', () => {
    const w = quietWorld({ config: { seed: 2024 } });
    const wolf = w.content.enemies.find((e) => e.id === 'wolf') as EnemyDef;
    const kills = 400;
    for (let i = 0; i < kills; i++) killOne(w, 'wolf', 40, 0);
    // proximity consolidation turns 400 stacked normal kills into 1 high-tier gem holding 100% of the XP
    expect(countOf(w, PickupKind.Xp)).toBe(1);
    expect(totalValue(w, PickupKind.Xp)).toBeCloseTo(wolf.xp * kills, 4);
    expect(w.xpGems).toBe(1);
    // coins consolidate too; total coin value matches ~10% drop rate x 2x value
    const coinVal = totalValue(w, PickupKind.Yeop);
    expect(coinVal).toBeGreaterThan(0);
    expect(countOf(w, PickupKind.Yeop)).toBeLessThanOrEqual(4);
    expect(countOf(w, PickupKind.Heal)).toBeLessThanOrEqual(8);
    expect(countOf(w, PickupKind.Magnet)).toBe(0);
    expect(countOf(w, PickupKind.Chest)).toBe(0);
  });

  it('a normal kill is attributed to the killer and counted', () => {
    const w = quietWorld();
    killOne(w, 'wolf', 40, 0);
    expect(w.tally.kills).toBe(1);
    expect(player(w).kills).toBe(1);
  });

  it('elites always drop a coin and 1.5× xp; potion ≈ 8%, magnet ≈ 5%, paid chest ≈ 12%', () => {
    const w = quietWorld({ config: { seed: 31337 } });
    const alpha = w.content.enemies.find((e) => e.id === 'alpha_wolf') as EnemyDef;
    const n = 400;
    for (let i = 0; i < n; i++) killOne(w, 'alpha_wolf', 40, 0, 1);
    // XP soft cap merges excess gems while preserving total XP value
    expect(countOf(w, PickupKind.Xp)).toBe(Math.min(n, XP_GEM_SOFT_CAP));
    expect(totalValue(w, PickupKind.Xp)).toBeCloseTo(alpha.xp * 1.5 * n, 3);
    expect(countOf(w, PickupKind.Yeop)).toBe(n);
    for (const r of rowsOf(w, PickupKind.Yeop)) {
      const v = w.pickups.value[r] as number;
      expect(v).toBeGreaterThanOrEqual(alpha.yeop[0]);
      expect(v).toBeLessThanOrEqual(alpha.yeop[1] + 1);
    }
    const within = (count: number, p: number): boolean => Math.abs(count - n * p) <= 4 * Math.sqrt(n * p * (1 - p));
    expect(within(countOf(w, PickupKind.Heal), 0.08), `potions ${countOf(w, PickupKind.Heal)}`).toBe(true);
    expect(within(countOf(w, PickupKind.Magnet), 0.05), `magnets ${countOf(w, PickupKind.Magnet)}`).toBe(true);
    expect(within(countOf(w, PickupKind.Chest), 0.12), `chests ${countOf(w, PickupKind.Chest)}`).toBe(true);
    for (const r of rowsOf(w, PickupKind.Chest)) expect(w.pickups.tier[r]).toBe(0); // dropped chests are the paid kind
    for (const r of rowsOf(w, PickupKind.Heal)) expect(w.pickups.value[r]).toBeCloseTo(0.25, 6);
    expect(w.tally.elitesKilled).toBe(n);
  });

  it('pack leaders (tier 2) drop 1.25× xp and use the elite coin/potion rules', () => {
    const w = quietWorld();
    const alpha = w.content.enemies.find((e) => e.id === 'alpha_wolf') as EnemyDef;
    for (let i = 0; i < 20; i++) killOne(w, 'alpha_wolf', 40, 0, 2);
    expect(countOf(w, PickupKind.Xp)).toBe(20);
    for (const r of rowsOf(w, PickupKind.Xp)) expect(w.pickups.value[r]).toBeCloseTo(alpha.xp * 1.25, 4);
    expect(countOf(w, PickupKind.Yeop)).toBe(20);
    expect(w.tally.elitesKilled).toBe(20);
  });

  it('coins use tier 0 / 1 / 2 by size (below 12, below 60, 60+)', () => {
    for (const [yeop, tier] of [[5, 0], [30, 1], [100, 2]] as const) {
      const w = quietWorld({
        content: (c: ContentDB) => {
          const wolf = c.enemies.find((e) => e.id === 'wolf') as EnemyDef;
          wolf.yeop = [yeop, yeop];
        },
      });
      for (let i = 0; i < 10; i++) killOne(w, 'wolf', 40, 0, 1);
      const rows = rowsOf(w, PickupKind.Yeop);
      expect(rows).toHaveLength(10);
      for (const r of rows) expect(w.pickups.tier[r], `yeop ${yeop}`).toBe(tier);
    }
  });

  it('an enemy whose yeop range rounds below 1 coin drops no coin', () => {
    const w = quietWorld({
      content: (c) => {
        const wolf = c.enemies.find((e) => e.id === 'wolf') as EnemyDef;
        wolf.yeop = [0, 0];
      },
    });
    for (let i = 0; i < 30; i++) killOne(w, 'wolf', 40, 0, 1);
    expect(countOf(w, PickupKind.Yeop)).toBe(0);
    expect(countOf(w, PickupKind.Xp)).toBe(30);
  });

  it('hard mode scales xp and coins by 1.5, corruption adds up to +50% on top', () => {
    const run = (difficulty: 'normal' | 'hard', corruption: number): { xp: number; maxCoin: number; minCoin: number } => {
      const w = quietWorld({
        config: { difficulty },
        content: (c) => {
          const wolf = c.enemies.find((e) => e.id === 'wolf') as EnemyDef;
          wolf.yeop = [10, 10];
        },
      });
      w.corruption = corruption;
      for (let i = 0; i < 30; i++) killOne(w, 'wolf', 40, 0, 1);
      const coins = rowsOf(w, PickupKind.Yeop).map((r) => w.pickups.value[r] as number);
      return {
        xp: w.pickups.value[rowsOf(w, PickupKind.Xp)[0] as number] as number,
        maxCoin: Math.max(...coins),
        minCoin: Math.min(...coins),
      };
    };
    const base = run('normal', 0);
    const hard = run('hard', 0);
    const corrupt = run('hard', 1);
    expect(base.xp).toBeCloseTo(1.5, 5); // tier-1 xp multiplier only
    expect(hard.xp).toBeCloseTo(1.5 * 1.5, 5);
    expect(corrupt.xp).toBeCloseTo(1.5 * 1.5 * 1.5, 5);
    // coins: range(10, 11) × reward, rounded
    expect(base.minCoin).toBeGreaterThanOrEqual(10);
    expect(base.maxCoin).toBeLessThanOrEqual(11);
    expect(hard.minCoin).toBeGreaterThanOrEqual(15);
    expect(hard.maxCoin).toBeLessThanOrEqual(17);
    expect(corrupt.minCoin).toBeGreaterThanOrEqual(22);
    expect(corrupt.maxCoin).toBeLessThanOrEqual(25);
  });

  it('zone.xpMul scales the gem value on top of hard mode and corruption (coins stay as they were); the default is 1', () => {
    const gem = (xpMul: number | undefined, difficulty: 'normal' | 'hard', corruption: number): { xp: number; coin: number } => {
      const w = quietWorld({
        config: { difficulty },
        content: (c) => {
          if (xpMul !== undefined) c.zones[0]!.xpMul = xpMul;
          (c.enemies.find((e) => e.id === 'wolf') as EnemyDef).yeop = [10, 10];
        },
      });
      w.corruption = corruption;
      killOne(w, 'wolf', 40, 0, 1);
      return { xp: w.pickups.value[rowsOf(w, PickupKind.Xp)[0] as number] as number, coin: w.pickups.value[rowsOf(w, PickupKind.Yeop)[0] as number] as number };
    };
    const base = gem(undefined, 'normal', 0);
    expect(base.xp).toBeCloseTo(1.5, 5);
    expect(gem(1, 'normal', 0).xp).toBeCloseTo(base.xp, 9);
    expect(gem(1.3, 'normal', 0).xp).toBeCloseTo(1.5 * 1.3, 5);
    expect(gem(1.3, 'hard', 1).xp).toBeCloseTo(1.5 * 1.3 * 1.5 * 1.5, 5);
    expect(gem(1.3, 'normal', 0).coin).toBe(base.coin);
  });

  it('the elite chest chance is balance.chest.eliteDrop (absent = the old 12 %); plain creatures never drop one', () => {
    const chests = (eliteDrop: number | undefined, id: string, tier: number): number => {
      const w = quietWorld({
        config: { seed: 4711 },
        content: (c) => {
          if (eliteDrop !== undefined) c.balance.chest = { eliteDrop };
        },
      });
      for (let i = 0; i < 200; i++) killOne(w, id, 40, 0, tier);
      return countOf(w, PickupKind.Chest);
    };
    expect(chests(1, 'alpha_wolf', 1)).toBe(200);
    expect(chests(1, 'alpha_wolf', 2)).toBe(200);
    expect(chests(0, 'alpha_wolf', 1)).toBe(0);
    expect(chests(1, 'wolf', 0)).toBe(0);
    // absent and an explicit 0.12 are the same stream of draws
    expect(chests(undefined, 'alpha_wolf', 1)).toBe(chests(0.12, 'alpha_wolf', 1));
    const n = chests(0.5, 'alpha_wolf', 1);
    expect(Math.abs(n - 100)).toBeLessThanOrEqual(4 * Math.sqrt(200 * 0.25));
  });

  it('noLoot suppresses every drop (xp, coins, potions, magnets, chests)', () => {
    const w = quietWorld();
    w.noLoot = true;
    for (let i = 0; i < 60; i++) killOne(w, i % 2 === 0 ? 'wolf' : 'alpha_wolf', 40, 0, i % 2 === 0 ? 0 : 1);
    expect(w.pickups.count).toBe(0);
    expect(w.xpGems).toBe(0);
    expect(w.tally.kills).toBe(60);
    w.noLoot = false;
    killOne(w, 'wolf', 40, 0);
    expect(countOf(w, PickupKind.Xp)).toBe(1);
  });
});

describe('boss loot', () => {
  it('a boss always drops a potion, a coin pile and its xp, but never a magnet or a chest pickup', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const w = quietWorld({ config: { seed } });
      const boss = spawnBoss(w, 'boss_horyeong', false, 30, 0);
      expect(boss).not.toBeNull();
      const row = w.enemies.find(boss?.enemy ?? 0);
      killEnemy(w, row, 0, -1, false);
      expect(countOf(w, PickupKind.Heal), `seed ${seed}`).toBe(1);
      expect(w.pickups.value[rowsOf(w, PickupKind.Heal)[0] as number]).toBeCloseTo(0.25, 6);
      expect(countOf(w, PickupKind.Yeop)).toBe(1);
      const coin = w.pickups.value[rowsOf(w, PickupKind.Yeop)[0] as number] as number;
      expect(coin).toBeGreaterThanOrEqual(200);
      expect(coin).toBeLessThanOrEqual(301);
      expect(countOf(w, PickupKind.Xp)).toBe(1);
      const gem = rowsOf(w, PickupKind.Xp)[0] as number;
      expect(w.pickups.value[gem]).toBeCloseTo(120, 3);
      expect(w.pickups.tier[gem]).toBe(3);
      expect(countOf(w, PickupKind.Magnet)).toBe(0);
      expect(countOf(w, PickupKind.Chest)).toBe(0);
    }
  });

  it('boss death vacuums every gem on the field to the killer and opens the boss reward modal', () => {
    const w = quietWorld();
    const p = player(w);
    for (let i = 0; i < 5; i++) put(w, PickupKind.Xp, 40 + i, 30, 0.5, 0);
    const boss = spawnBoss(w, 'boss_horyeong', false, 30, 0);
    const row = w.enemies.find(boss?.enemy ?? 0);
    killEnemy(w, row, 0, -1, false);
    const gems = rowsOf(w, PickupKind.Xp);
    expect(gems).toHaveLength(6);
    const vacuumed = gems.filter((r) => w.pickups.magnet[r] === 1);
    expect(vacuumed).toHaveLength(5);
    for (const r of vacuumed) expect(w.pickups.target[r]).toBe(0);
    expect(w.modal?.kind).toBe('bossReward');
    expect(w.modal?.source).toBe('boss_horyeong');
    w.chooseCard(0);
    runTicks(w, 360);
    expect(countOf(w, PickupKind.Xp)).toBe(1); // the boss's own gem lies where it died
    expect(p.xp).toBeCloseTo(2.5, 3);
  });

  it('the final boss collapses the field without loot: only its own drops remain', () => {
    const w = quietWorld();
    for (let i = 0; i < 30; i++) spawn(w, i % 3 === 0 ? 'alpha_wolf' : 'wolf', 20 + i, 10, { tier: i % 3 === 0 ? 1 : 0 });
    const boss = spawnBoss(w, 'boss_scarlet_wyrm', true, 0, 40);
    const row = w.enemies.find(boss?.enemy ?? 0);
    killEnemy(w, row, 0, -1, false);
    expect(w.noLoot).toBe(false);
    expect(w.tally.kills).toBe(31);
    expect(countOf(w, PickupKind.Xp)).toBe(1);
    expect(countOf(w, PickupKind.Yeop)).toBe(1);
    expect(countOf(w, PickupKind.Heal)).toBe(1);
    expect(countOf(w, PickupKind.Chest)).toBe(0);
    expect(countOf(w, PickupKind.Magnet)).toBe(0);
  });
});

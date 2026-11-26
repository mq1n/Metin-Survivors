// Pickups: XP gems (merge beyond the soft cap), yeop, potions, magnets, chests; loot drops; magnet + collection.

import { freeChestsLeft, openChest, takeFreeChest } from './cards';
import { healPlayer } from './combat';
import { DT } from './constants';
import { HealSource } from './events';
import { grantXp } from './progress';
import { spawnable } from './spawner';
import { PickupKind, type PlayerState } from './stores';
import type { World } from './world';

/** gems beyond this count merge into existing ones (total capacity is 1200 pickups) */
export const XP_GEM_SOFT_CAP = 90;
/** nearby un-magnetized normal-mob drops within this radius (m) consolidate into an existing orb/coin to prevent ground clutter */
export const DROP_CONSOLIDATE_RADIUS = 3.5;
const COLLECT_RADIUS = 0.9;
const CHEST_RADIUS = 1.35;
const YEOP_LIFETIME = 50;
const POTION_LIFETIME = 90;
const GRAVITY = 16;
const MERGE_SCAN = 48;

export function gemTier(value: number): number {
  return value < 4 ? 0 : value < 15 ? 1 : value < 60 ? 2 : value < 250 ? 3 : 4;
}

function coinTier(value: number): number {
  return value < 12 ? 0 : value < 60 ? 1 : 2;
}

/**
 * Add `value` to the nearest live pickup of `kind` (scans a rotating window of `scan` rows). Used when the store is (nearly) full so
 * xp and gold are never lost; false when no pickup of that kind is in the window.
 */
function mergeNearest(w: World, kind: PickupKind, x: number, z: number, value: number, tierOf: (v: number) => number, scan = MERGE_SCAN): boolean {
  const P = w.pickups;
  const n = P.count;
  if (n <= 0) return false;
  let best = -1;
  let bestD = Infinity;
  let cursor = w.mergeCursor % n;
  for (let k = 0; k < Math.min(n, scan); k++) {
    if (P.kind[cursor] === kind) {
      const d = ((P.x[cursor] as number) - x) ** 2 + ((P.z[cursor] as number) - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = cursor;
      }
    }
    cursor = (cursor + 1) % n;
  }
  w.mergeCursor = cursor;
  if (best < 0) return false;
  const v = (P.value[best] as number) + value;
  P.value[best] = v;
  P.tier[best] = tierOf(v);
  return true;
}

/** create a pickup with a small pop; returns the row or -1 when the store is full (xp and gold merge into a neighbour instead of vanishing) */
export function spawnPickup(w: World, kind: PickupKind, x: number, z: number, value: number, tier: number, pop = 2.2): number {
  const P = w.pickups;
  const r = P.alloc();
  if (r < 0) {
    // the store is full: the whole store is searched for a neighbour of the same kind
    if (kind === PickupKind.Xp) mergeNearest(w, kind, x, z, value, gemTier, P.count);
    else if (kind === PickupKind.Yeop) mergeNearest(w, kind, x, z, value, coinTier, P.count);
    return -1;
  }
  const rng = w.rng.loot;
  const a = rng.angle();
  const s = pop * (0.4 + rng.next() * 0.6);
  P.kind[r] = kind;
  P.x[r] = x;
  P.z[r] = z;
  P.px[r] = x;
  P.pz[r] = z;
  P.vx[r] = Math.sin(a) * s;
  P.vz[r] = Math.cos(a) * s;
  P.h[r] = 0.01;
  P.vh[r] = pop > 0 ? 3 + rng.next() * 2 : 0;
  P.value[r] = value;
  P.tier[r] = tier;
  P.age[r] = 0;
  P.magnet[r] = 0;
  return r;
}

/** pop speed (m/s) of an event chest: it hops out of the dead creature and slides v / 4 m (the damping of `updatePickups`) */
const EVENT_CHEST_POP = 1.5;
/** metres between the rings of the resting-point sweep, and how far it looks before it gives up and uses the nearest hero's spot */
const REST_STEP = 0.5;
const REST_MAX = 24;
/** the dry ground a chest likes to have round it (a hero opens it from CHEST_RADIUS away, so it can stand clear of the lava) */
const REST_CLEARANCE = 1;
/** a ring of the sweep holds a candidate about every this many metres (at least 8) */
const REST_ARC = 0.5;

function dryAround(w: World, x: number, z: number, clearance: number): boolean {
  if (!spawnable(w, x, z)) return false;
  if (clearance <= 0) return true;
  return spawnable(w, x + clearance, z) && spawnable(w, x - clearance, z) && spawnable(w, x, z + clearance) && spawnable(w, x, z - clearance);
}

const rest = { x: 0, z: 0 };

/**
 * Where a chest dropped at (x, z) can rest: (x, z) itself when it is spawnable ground, else the nearest spawnable point found by a
 * deterministic sweep of rings round it (no random number: the pool of the creature that died in lava, on a deep-water edge or in a
 * blocker pocket is no place to leave a reward). The first pass wants REST_CLEARANCE of dry ground round the point, the second any
 * spawnable point; within a ring the candidate nearest to the nearest living hero wins. When the sweep finds nothing within REST_MAX
 * metres it falls back to the nearest living hero's own spot (when that is spawnable), else keeps (x, z). Returns the shared scratch.
 */
function chestRestPoint(w: World, x: number, z: number): { x: number; z: number } {
  rest.x = x;
  rest.z = z;
  if (spawnable(w, x, z)) return rest;
  let hx = 0;
  let hz = 0;
  let hd = Infinity;
  for (const p of w.players) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < hd) {
      hd = d;
      hx = p.x;
      hz = p.z;
    }
  }
  const hero = hd < Infinity;
  const limit = w.arenaRadius - 1.5;
  for (const clearance of [REST_CLEARANCE, 0]) {
    for (let r = REST_STEP; r <= REST_MAX + 1e-9; r += REST_STEP) {
      const n = Math.max(8, Math.ceil((2 * Math.PI * r) / REST_ARC));
      let best = Infinity;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 2 * Math.PI;
        const cx = x + Math.sin(a) * r;
        const cz = z + Math.cos(a) * r;
        if (Math.hypot(cx, cz) > limit || !dryAround(w, cx, cz, clearance)) continue;
        const d = hero ? Math.hypot(cx - hx, cz - hz) : 0;
        if (d < best) {
          best = d;
          rest.x = cx;
          rest.z = cz;
        }
      }
      if (best < Infinity) return rest;
    }
  }
  if (hero && spawnable(w, hx, hz)) {
    rest.x = hx;
    rest.z = hz;
    return rest;
  }
  rest.x = x;
  rest.z = z;
  return rest;
}

/**
 * A chest dropped by a run event (Champion Hunt, RS-03) where the champion fell, on spawnable ground. `tier` 1 / 2 chests are free
 * (tier 0 costs yeop). Creatures walk on lava, so the drop point can be IN lava, in deep water or a blocker: it is first moved to the
 * nearest spawnable point (`chestRestPoint`, no random number; a spawnable drop point is kept as it is). The pop slide is cancelled
 * when it would still end on blocked ground (a cliff edge, lava, deep water): a chest nobody can walk to is lost. Returns the pickup
 * row, -1 when the store is full.
 */
export function dropEventChest(w: World, x: number, z: number, tier: number): number {
  const at = chestRestPoint(w, x, z);
  const r = spawnPickup(w, PickupKind.Chest, at.x, at.z, 0, tier, EVENT_CHEST_POP);
  if (r < 0) return -1;
  const P = w.pickups;
  if (!spawnable(w, (P.x[r] as number) + (P.vx[r] as number) / 4, (P.z[r] as number) + (P.vz[r] as number) / 4)) {
    P.vx[r] = 0;
    P.vz[r] = 0;
  }
  return r;
}

/** drop an XP gem; beyond the soft cap the value merges into the nearest existing gem */
export function spawnXp(w: World, x: number, z: number, value: number): void {
  const P = w.pickups;
  if (w.xpGems >= XP_GEM_SOFT_CAP || P.count >= P.capacity - 8) {
    if (mergeNearest(w, PickupKind.Xp, x, z, value, gemTier)) return;
    if (mergeNearest(w, PickupKind.Xp, x, z, value, gemTier, P.count)) return;
  }
  const r = spawnPickup(w, PickupKind.Xp, x, z, value, gemTier(value), 1.6);
  if (r >= 0) w.xpGems++;
}

/**
 * Consolidates `value` into an existing un-magnetized pickup of `kind` within `maxDist` metres so packs of dying mobs
 * leave a few readable high-tier orbs/heaps instead of dozens of tiny overlapping drops.
 */
function mergeWithin(w: World, kind: PickupKind, x: number, z: number, value: number, tierOf: (v: number) => number, maxDist: number): boolean {
  const P = w.pickups;
  const n = P.count;
  if (n <= 0) return false;
  const maxD2 = maxDist * maxDist;
  let best = -1;
  let bestD = maxD2;
  for (let i = 0; i < n; i++) {
    if (P.kind[i] !== kind || P.magnet[i] === 1) continue;
    const dx = (P.x[i] as number) - x;
    const dz = (P.z[i] as number) - z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= bestD) {
      bestD = d2;
      best = i;
    }
  }
  if (best < 0) return false;
  const v = (P.value[best] as number) + value;
  P.value[best] = v;
  P.tier[best] = tierOf(v);
  P.age[best] = 0;
  return true;
}

/** loot for a dead non-metin enemy row */
export function dropLoot(w: World, row: number, killer: number): void {
  const e = w.enemies;
  const def = w.typeDefs[e.type[row] as number];
  if (!def || w.noLoot) return;
  const rng = w.rng.loot;
  const x = e.x[row] as number;
  const z = e.z[row] as number;
  const tier = e.eliteTier[row] as number;
  const reward = w.diff.reward * (1 + 0.5 * w.corruption);
  const mods = w.mods;
  const xpVal = def.xp * reward * (tier === 1 ? 1.5 : tier === 2 ? 1.25 : 1) * mods.xp;
  // Consolidate nearby normal-mob XP gems into one richer gem to sharply cut ground drop clutter while conserving 100% of XP.
  if (tier > 0 || !mergeWithin(w, PickupKind.Xp, x, z, xpVal, gemTier, DROP_CONSOLIDATE_RADIUS)) {
    spawnXp(w, x, z, xpVal);
  }
  // Reduced normal-mob coin frequency (12%, 2.5x value = 100% Yeop parity) + proximity consolidation keeps ground clean without starving Yeop.
  const yeopChance = tier >= 1 ? 1 : 0.12;
  if (rng.next() < yeopChance) {
    const mult = tier >= 1 ? 1 : 2.5;
    const amount = rng.range(def.yeop[0], def.yeop[1] + 1) * reward * mods.yeop * mult;
    if (amount >= 1) {
      const rounded = Math.round(amount);
      if (tier > 0 || !mergeWithin(w, PickupKind.Yeop, x, z, rounded, coinTier, DROP_CONSOLIDATE_RADIUS)) {
        spawnPickup(w, PickupKind.Yeop, x, z, rounded, coinTier(rounded));
      }
    }
  }
  const potionChance = tier === 3 ? 1 : tier >= 1 ? 0.08 : 0.002;
  if (rng.next() < potionChance) spawnPickup(w, PickupKind.Heal, x, z, 0.25, 0);
  if (tier >= 1 && tier < 3 && rng.next() < 0.05) spawnPickup(w, PickupKind.Magnet, x, z, 0, 0);
  // the elite chest chance is w.mods.eliteDrop (balance.chest.eliteDrop, default 0.12, x event factors): one draw either way
  if (tier >= 1 && tier < 3 && rng.next() < mods.eliteDrop) spawnPickup(w, PickupKind.Chest, x, z, 0, 0);
}

export function updatePickups(w: World): void {
  const P = w.pickups;
  const players = w.players;
  const bal = w.balance;
  for (let i = P.count - 1; i >= 0; i--) {
    P.px[i] = P.x[i] as number;
    P.pz[i] = P.z[i] as number;
    const age = (P.age[i] as number) + DT;
    P.age[i] = age;
    const kind = P.kind[i] as number;
    if ((kind === PickupKind.Yeop && age > YEOP_LIFETIME) || (kind === PickupKind.Heal && age > POTION_LIFETIME)) {
      P.free(i);
      continue;
    }
    // pop arc
    let h = P.h[i] as number;
    if (h > 0 || (P.vh[i] as number) !== 0) {
      let vh = (P.vh[i] as number) - GRAVITY * DT;
      h += vh * DT;
      if (h <= 0) {
        h = 0;
        vh = 0;
      }
      P.h[i] = h;
      P.vh[i] = vh;
    }
    let x = P.x[i] as number;
    let z = P.z[i] as number;
    const magnetised = P.magnet[i] === 1;
    if (!magnetised) {
      const vx = P.vx[i] as number;
      const vz = P.vz[i] as number;
      if (vx !== 0 || vz !== 0) {
        x += vx * DT;
        z += vz * DT;
        const damp = Math.exp(-4 * DT);
        P.vx[i] = Math.abs(vx) < 0.01 ? 0 : vx * damp;
        P.vz[i] = Math.abs(vz) < 0.01 ? 0 : vz * damp;
        P.x[i] = x;
        P.z[i] = z;
      }
    }

    // nearest living player
    let best = -1;
    let bestD = Infinity;
    for (let pi = 0; pi < players.length; pi++) {
      const p = players[pi] as PlayerState;
      if (!p.alive) continue;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = pi;
      }
    }
    if (best < 0) continue;
    const p = players[best] as PlayerState;
    const dist = Math.sqrt(bestD);
    const collectable = kind === PickupKind.Xp || kind === PickupKind.Yeop || kind === PickupKind.Heal;

    if (collectable && !magnetised && dist <= p.stats.pickupRadius && h <= 0.6) {
      P.magnet[i] = 1;
      P.target[i] = best;
      P.vx[i] = 6;
    }
    if (P.magnet[i] === 1) {
      const tp = players[P.target[i] as number];
      const t = tp && tp.alive ? tp : p;
      const speed = Math.min(30, (P.vx[i] as number) + 46 * DT);
      P.vx[i] = speed;
      const dx = t.x - x;
      const dz = t.z - z;
      const d = Math.hypot(dx, dz) || 1;
      const step = Math.min(d, speed * DT);
      x += (dx / d) * step;
      z += (dz / d) * step;
      P.x[i] = x;
      P.z[i] = z;
      if (Math.hypot(t.x - x, t.z - z) <= COLLECT_RADIUS) collect(w, i, players.indexOf(t) < 0 ? best : players.indexOf(t));
      continue;
    }
    if (kind === PickupKind.Magnet && dist <= COLLECT_RADIUS + 0.4) {
      collect(w, i, best);
      continue;
    }
    if (kind === PickupKind.Chest && dist <= CHEST_RADIUS) {
      const tier = P.tier[i] as number;
      // an ordinary chest is paid for by its price ladder, unless the hero holds a free chest (the Bargain of fortune, EV-02b)
      const cost = tier === 0 && freeChestsLeft(p) === 0 ? Math.round(bal.chestCost.base + bal.chestCost.perOpen * p.chestsOpened) : 0;
      if (p.yeop >= cost) {
        collect(w, i, best);
      } else {
        const cd = (P.lockCd[i] as number) - DT;
        P.lockCd[i] = cd;
        if (cd <= 0) {
          P.lockCd[i] = 1.5;
          w.bus.chestLocked(best, cost, p.yeop);
        }
      }
    }
  }
}

function collect(w: World, row: number, pi: number): void {
  const P = w.pickups;
  const p = w.players[pi] as PlayerState;
  const kind = P.kind[row] as number;
  const value = P.value[row] as number;
  const tier = P.tier[row] as number;
  const x = P.x[row] as number;
  const z = P.z[row] as number;
  P.free(row);
  switch (kind) {
    case PickupKind.Xp: {
      w.xpGems = Math.max(0, w.xpGems - 1);
      const amount = value * p.stats.xpGain;
      grantXp(w, p, amount);
      // co-op XP is shared: every other living hero receives the full gem (each with their own xpGain), no pickup event
      if (w.players.length > 1) {
        for (const other of w.players) {
          if (other !== p && other.alive) grantXp(w, other, value * other.stats.xpGain);
        }
      }
      w.bus.pickup(pi, kind, amount, x, z, tier);
      break;
    }
    case PickupKind.Yeop: {
      const amount = Math.max(1, Math.round(value * p.stats.yeopGain));
      p.yeop += amount;
      p.yeopEarned += amount;
      w.bus.pickup(pi, kind, amount, x, z, tier);
      break;
    }
    case PickupKind.Heal:
      healPlayer(w, p, p.hpMax * value, HealSource.Pickup);
      w.bus.pickup(pi, kind, value, x, z, tier);
      break;
    case PickupKind.Magnet: {
      // vacuum every gem on the field
      for (let i = 0; i < P.count; i++) {
        if (P.kind[i] === PickupKind.Xp && P.magnet[i] === 0) {
          P.magnet[i] = 1;
          P.target[i] = pi;
          P.vx[i] = 10;
        }
      }
      w.bus.pickup(pi, kind, 0, x, z, 0);
      w.bus.sfx('sfx_magnet', x, z);
      break;
    }
    case PickupKind.Chest: {
      // a free chest (the Bargain of fortune, EV-02b) costs nothing and does not climb the price ladder of the chests that follow
      const free = tier === 0 && takeFreeChest(p);
      const cost = tier === 0 && !free ? Math.round(w.balance.chestCost.base + w.balance.chestCost.perOpen * p.chestsOpened) : 0;
      p.yeop -= cost;
      if (tier === 0 && !free) p.chestsOpened++;
      w.tally.chestsOpened++;
      w.bus.chestOpen(pi, x, z, false, cost);
      w.bus.pickup(pi, kind, cost, x, z, tier);
      openChest(w, p, null);
      break;
    }
    default:
      break;
  }
}

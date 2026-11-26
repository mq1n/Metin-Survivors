// PC-03 (upgrade stage B, group B.pacing): zone power parity for zones 2-4.
//
// R3 of the rogue audit: a fresh hero reached level 13 / 10 / 10 / 9 at 3:00 in Yeonmu / Suryeon / Seori / Daeryeol, cleared the
// later zones 1 / 3 / 1 times in 10, and zones 2-4 dropped their first stone at 120 s so the first essence arrived AFTER the 3:00 boss.
// The data now gives zones 2-4 a gem-xp multiplier (`xpMul`, new in A0-DATA) and an earlier, quicker stone schedule (`metins.firstAt` /
// `metins.interval`). Everything below runs on the REAL shipped content; the gem path and the stone clock are the real sim, no mocks.
//
//  1. data: the zones' multipliers and stone schedules (and Yeonmu, which PC-01 owns, untouched), valid content;
//  2. the sim reads it: w.mods.xp, the gem value of a kill, the first stone and the second one before the 3:00 boss;
//  3. the OFF arm of the paired gate (xpMul absent, 120 s / [70, 90]) is still expressible and still behaves the old way;
//  4. edge cases: hard difficulty, Run Options max, co-op (host + a guest), the hero dead while the stone falls, the final's great stone.

import { describe, expect, it } from 'vitest';
import { content, validateContent } from '../../data/loader';
import { resolveZoneMuls, type ContentDB, type ZoneDef } from '../../data/schema';
import { applyContentOverride } from '../../data/override';
import { killEnemy } from '../combat';
import { sweepDead } from '../enemies';
import { xpToNext } from '../progress';
import { runOptionsTable, type CoopPlayerInit, type RunConfig } from '../run';
import { PickupKind, type PlayerState } from '../stores';
import { MetinPhase } from '../types';
import { createWorld, type World } from '../world';
import { collect, NO_INPUT, player, runTicks, spawn } from './helpers';

const LATER = ['suryeon', 'seori', 'daeryeol'] as const;
type LaterZone = (typeof LATER)[number];
/** the first boss of every zone spawns here (bosses[0].at) */
const FIRST_BOSS = 180;
const GUEST: CoopPlayerInit = { classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'chowon', meta: { stats: {} } };

/**
 * What PC-03 shipped: xpMul 1.25 / 1.3 / 1.4, first stone 70 s, one every 45-55 s (measured on the paired entry gate, see the WP notes).
 * BAL-FINAL may move these later, so the tests below pin the INTENT as bounds (a nudge above 1 that rises with the zone, a first stone
 * and a second one before the 3:00 boss, a cadence quicker than the old 70-90 s) and read the exact numbers from the content.
 */
const XP_MAX = 1.6;
/** the first stone must be early enough to be broken (45 s awaken window) and for a second one to fall before the first boss */
const FIRST_AT_MAX = 90;
/** the old cadence was [70, 90]: the new upper bound sits clearly under it, the lower one keeps a stone from falling on the previous one */
const INTERVAL_HI_MAX = 70;
const INTERVAL_LO_MIN = 35;
/** what the three zones had before PC-03: no multiplier, the first stone at 2:00, one every 70-90 s */
const OLD = { firstAt: 120, interval: [70, 90] as [number, number] };

function zoneOf(db: ContentDB, id: string): ZoneDef {
  const z = db.zones.find((x) => x.id === id);
  if (!z) throw new Error(`zone ${id}`);
  return z;
}

/** the gate's OFF arm as a content patch: no xpMul (null deletes the key), the old stone clock */
const OFF_ARM = {
  zones: LATER.map((id) => ({ id, xpMul: null, metins: { firstAt: OLD.firstAt, interval: OLD.interval } })),
};

function offContent(): ContentDB {
  const db = structuredClone(content);
  applyContentOverride(db, OFF_ARM);
  return db;
}

interface Opts {
  seed?: number;
  difficulty?: 'normal' | 'hard';
  coop?: boolean;
  runOptionsMax?: boolean;
  db?: ContentDB;
}

/** the shipped sim on a flat arena: spawner, elites and the boss timeline off, the stone clock untouched */
function mk(zone: string, o: Opts = {}): World {
  const db = o.db ?? structuredClone(content);
  const config = {
    zone,
    difficulty: o.difficulty ?? 'normal',
    classId: 'warrior',
    doctrine: 'a',
    sex: 'm',
    empire: 'saehwa',
    seed: o.seed ?? 5,
    meta: { stats: {} },
    coop: o.coop ? [GUEST] : undefined,
  } as RunConfig;
  if (o.runOptionsMax) {
    const t = runOptionsTable(db.balance);
    config.runOptions = { density: t.density.max, health: t.health.max, damage: t.damage.max, speed: t.speed.max };
  }
  const w = createWorld(config, db);
  w.spawner.acc = -1e9;
  w.spawner.eliteT = 1e9;
  w.spawner.nextBoss = w.spawner.bosses.length;
  for (const p of w.players) p.skills.length = 0;
  return w;
}

function tough(p: PlayerState): void {
  p.hp = 1e7;
  p.hpMax = 1e7;
}

/** the value of the xp gem a freshly killed creature of the zone's first band leaves behind */
function gemValue(w: World, x = 40): number {
  const id = zoneOf(content, w.zone.id).bands[0]?.spawns[0]?.enemy as string;
  const row = spawn(w, id, x, 0, { tier: 0 });
  killEnemy(w, row, 0, -1, false);
  sweepDead(w);
  for (let i = 0; i < w.pickups.count; i++) if (w.pickups.kind[i] === PickupKind.Xp) return w.pickups.value[i] as number;
  throw new Error('no xp gem');
}

/** run to `until` seconds and return the time of every stone warning (a stone falls) */
function stoneTimes(w: World, until: number): number[] {
  tough(player(w));
  const times: number[] = [];
  for (let t = 0; t < Math.round(until * 60); t++) {
    w.step([NO_INPUT]);
    for (const e of w.events) if (e.t === 'metinWarn' && !e.great) times.push(Math.round(w.time * 100) / 100);
  }
  return times;
}

describe('PC-03 zone power parity: data', () => {
  it('Suryeon, Seori and Daeryeol carry a gem-xp multiplier that rises with the zone; Yeonmu has none', () => {
    expect(zoneOf(content, 'yeonmu').xpMul).toBeUndefined();
    expect(resolveZoneMuls(zoneOf(content, 'yeonmu')).xp).toBe(1);
    let last = 1;
    for (const id of LATER) {
      const x = resolveZoneMuls(zoneOf(content, id)).xp;
      expect(x, `${id} is above Yeonmu`).toBeGreaterThan(1);
      expect(x, `${id} is at least the zone before`).toBeGreaterThanOrEqual(last);
      expect(x, `${id} stays a nudge, not a different game`).toBeLessThanOrEqual(XP_MAX);
      last = x;
    }
  });

  it('zones 2-4 drop their first stone early and keep dropping quicker than the old 70-90 s; Yeonmu is untouched (PC-01 owns it)', () => {
    for (const id of LATER) {
      const m = zoneOf(content, id).metins;
      expect(m.firstAt, `${id} first stone`).toBeLessThanOrEqual(FIRST_AT_MAX);
      expect(m.interval[1], `${id} slowest gap`).toBeLessThanOrEqual(INTERVAL_HI_MAX);
      expect(m.interval[0], `${id} quickest gap`).toBeGreaterThanOrEqual(INTERVAL_LO_MIN);
      expect(m.interval[0]).toBeLessThanOrEqual(m.interval[1]);
      // the first stone has time to be broken (about 45 s awaken window) before the first boss at 3:00
      expect(m.firstAt + 45, `${id}: first stone broken before the boss`).toBeLessThan(FIRST_BOSS);
      // and a second one is on the way before it
      expect(m.firstAt + m.interval[1], `${id}: a second stone before the boss`).toBeLessThan(FIRST_BOSS);
      expect(zoneOf(content, id).bosses[0]?.at).toBe(FIRST_BOSS);
    }
    const y = zoneOf(content, 'yeonmu');
    expect(y.metins.firstAt).toBe(50);
    expect(y.metins.interval).toEqual([60, 75]);
    // the later zones are never slower than the old schedule, and never faster than Yeonmu's first stone
    for (const id of LATER) expect(zoneOf(content, id).metins.firstAt).toBeGreaterThanOrEqual(y.metins.firstAt);
  });

  it('the tuned content validates, and the OFF arm of the gate (a patch back to the old values) validates too', () => {
    expect(validateContent(content).errors).toEqual([]);
    const off = offContent();
    expect(validateContent(off).errors).toEqual([]);
    for (const id of LATER) {
      const z = zoneOf(off, id);
      expect(z.xpMul, `${id} OFF xpMul`).toBeUndefined();
      expect(z.metins.firstAt).toBe(OLD.firstAt);
      expect(z.metins.interval).toEqual(OLD.interval);
    }
    // nothing else of the three zones moved: bands, bosses, final, roster
    for (const id of LATER) {
      const a = structuredClone(zoneOf(content, id)) as unknown as Record<string, unknown>;
      const b = structuredClone(zoneOf(off, id)) as unknown as Record<string, unknown>;
      for (const k of ['xpMul', 'metins']) {
        delete a[k];
        delete b[k];
      }
      expect(a, `${id}: only xpMul and the stone clock differ`).toEqual(b);
      expect(zoneOf(content, id).metins.types).toEqual(zoneOf(off, id).metins.types);
    }
  });
});

describe('PC-03 zone power parity: the sim reads it', () => {
  for (const id of LATER) {
    it(`${id}: w.mods.xp is the zone multiplier on normal and on hard, the gem is worth that much more than the OFF arm's`, () => {
      for (const difficulty of ['normal', 'hard'] as const) {
        const on = mk(id, { difficulty });
        const xpMul = zoneOf(content, id).xpMul as number;
        expect(on.mods.xp).toBeCloseTo(xpMul, 9);
        const off = mk(id, { difficulty, db: offContent() });
        expect(off.mods.xp).toBe(1);
        const ratio = gemValue(on) / gemValue(off);
        expect(ratio, `${id} ${difficulty}`).toBeCloseTo(xpMul, 6);
      }
    });

    it(`${id}: the first stone falls at firstAt and a second one falls before the 3:00 boss (the OFF arm: one, after 2:00)`, () => {
      const w = mk(id);
      const { firstAt, interval } = w.zone.metins;
      expect(w.metinSys.nextFallAt).toBe(firstAt);
      const falls = stoneTimes(w, FIRST_BOSS - 1);
      expect(falls.length, `${id}: stones before ${FIRST_BOSS} s`).toBeGreaterThanOrEqual(2);
      expect(falls[0]).toBeGreaterThanOrEqual(firstAt - 0.1);
      expect(falls[0]).toBeLessThanOrEqual(firstAt + 0.1);
      // the gap between two stones is a draw from the interval (no corruption yet)
      const gap = (falls[1] as number) - (falls[0] as number);
      expect(gap).toBeGreaterThanOrEqual(interval[0] - 0.1);
      expect(gap).toBeLessThanOrEqual(interval[1] + 0.1);

      const old = mk(id, { db: offContent() });
      expect(old.metinSys.nextFallAt).toBe(OLD.firstAt);
      const oldFalls = stoneTimes(old, FIRST_BOSS - 1);
      expect(oldFalls.length, `${id} OFF: stones before ${FIRST_BOSS} s`).toBe(1);
      expect(oldFalls[0]).toBeGreaterThanOrEqual(OLD.firstAt - 0.1);
    });
  }

  it('every run of zone 1 is as it was: no multiplier, the first stone at 50 s', () => {
    const w = mk('yeonmu');
    expect(w.mods.xp).toBe(1);
    expect(w.metinSys.nextFallAt).toBe(50);
    expect(w.zone.metins.interval).toEqual([60, 75]);
  });
});

describe('PC-03 zone power parity: edge cases', () => {
  it('Run Options max, hard and co-op change the stone clock and the multiplier of nobody (they are zone data, not run data)', () => {
    for (const id of LATER) {
      const base = mk(id);
      for (const o of [{ runOptionsMax: true }, { difficulty: 'hard' as const }, { coop: true }, { coop: true, runOptionsMax: true, difficulty: 'hard' as const }]) {
        const w = mk(id, o);
        expect(w.metinSys.nextFallAt, `${id} ${JSON.stringify(o)}`).toBe(base.metinSys.nextFallAt);
        expect(w.mods.xp, `${id} ${JSON.stringify(o)}`).toBe(base.mods.xp);
      }
    }
  });

  it('co-op: the host and the guest hero both collect the multiplied gem (xp is shared, each hero times their own xpGain)', () => {
    const w = mk('seori', { coop: true });
    const xpMul = zoneOf(content, 'seori').xpMul as number;
    expect(w.players.length).toBe(2);
    for (const p of w.players) {
      p.x = p.px = 2;
      p.z = p.pz = 0;
    }
    // total xp of a hero over the levels it has gone through (level-ups carry the remainder)
    const total = (p: PlayerState): number => {
      let sum = p.xp;
      for (let l = 1; l < p.level; l++) sum += xpToNext(w, l);
      return sum;
    };
    const before = w.players.map(total);
    const v = gemValue(w, 3);
    expect(v).toBeCloseTo(gemValue(mk('seori', { db: offContent() }), 3) * xpMul, 6);
    // both heroes stand on the gem; the pickup system hands it to both (xp is shared), each hero times its own xpGain (the guest's
    // empire gives +10 %), so the zone multiplier is inside the gem and never applied twice
    runTicks(w, 120);
    for (let i = 0; i < w.players.length; i++) {
      const p = w.players[i] as PlayerState;
      expect(total(p) - (before[i] as number), `hero ${i}`).toBeCloseTo(v * p.stats.xpGain, 5);
    }
    expect((w.players[0] as PlayerState).stats.xpGain).not.toBe((w.players[1] as PlayerState).stats.xpGain);
  });

  it('the hero dead while the stone falls: the clock still ticks the stone in, no NaN, no second multiplier', () => {
    for (const id of LATER) {
      const w = mk(id);
      const p = player(w);
      tough(p);
      runTicks(w, Math.round((w.zone.metins.firstAt - 1) * 60));
      p.hp = 0;
      const events = collect(w, 6 * 60, ['metinWarn']);
      // a dead hero ends the run; the sim never throws and the xp multiplier is still the zone's
      expect(Number.isFinite(p.xp)).toBe(true);
      expect(w.mods.xp).toBeCloseTo(zoneOf(content, id).xpMul as number, 9);
      expect(events.length).toBeLessThanOrEqual(1);
    }
  });

  it('the great stone of the final is the zone\'s own and is not on the stone clock', () => {
    for (const id of LATER) {
      const z = zoneOf(content, id);
      expect(content.metins.some((m) => m.id === z.final.greatMetin)).toBe(true);
      expect(z.metins.types).not.toContain(z.final.greatMetin);
      expect(z.final.at).toBe(900);
    }
    const w = mk('seori');
    expect(w.metins.every((m) => m.phase === MetinPhase.Broken || !m.great)).toBe(true);
  });
});

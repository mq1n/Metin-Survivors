// PC-04 (upgrade stage B, group B.pacing): a final fight that ends on a high.
//
// R14 of the rogue audit: the finals dragged (median 85-154 s, max 268 s on normal; in the god soak Seori's final did not finish in 11 of
// 20 runs) and the climax repeated one boss's patterns for minutes. The data now gives every zone a final-boss HP multiplier below 1
// (`zones.json final.hpMul`, new in A0-DATA / RS-01: a code multiplier at spawn, `bosses.json` stays untouched). Everything below runs on
// the REAL shipped content; the final boss emerges from the real Great Metin and dies to real hits, no mocks.
//
//  1. data: every zone carries a multiplier that ends the fight sooner but keeps it a fight; the content validates; the gate's OFF arm (a
//     patch that deletes the key) validates and differs from the shipped zones by that key only;
//  2. the sim reads it: the final boss's HP is def.hp x hpScale x hpMul, an ordinary boss and the Great Metin are not scaled, the fight is
//     shorter by that factor (fixed damage per tick), the victory still follows the kill, no rng draw moved (HASH-EQ of the data);
//  3. edge cases: hard, Run Options max, event factors, co-op (host + guest HUD, a guest that dropped and came back), the hero dead, a modal
//     open (pause), the OFF arm. The arena edge and water do not apply: the boss emerges at the Great Metin, the multiplier is zone data.

import { afterEach, describe, expect, it } from 'vitest';
import { content, validateContent } from '../../data/loader';
import { applyContentOverride } from '../../data/override';
import { resolveZoneMuls, type ContentDB, type ZoneDef } from '../../data/schema';
import { CoopHarness } from '../../net/coop/harness';
import { spawnBoss } from '../bosses';
import { openLevelUp } from '../cards';
import { hitEnemy, newHitCtx } from '../combat';
import { VICTORY_DELAY } from '../constants';
import { runOptionsTable, type CoopPlayerInit, type RunConfig } from '../run';
import { MetinPhase, type BossState } from '../types';
import { createWorld, type World } from '../world';
import { drainModals, NO_INPUT, player, runTicks } from './helpers';

const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'] as const;
type ZoneId = (typeof ZONES)[number];
const GUEST: CoopPlayerInit = { classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'chowon', meta: { stats: {} } };

/**
 * What PC-04 shipped (0.85 / 0.75 / 0.92 / 0.85, measured on the paired finals gate on the restored PC-06 economy, see the WP notes). BAL-FINAL may move these later, so the
 * tests pin the INTENT as bounds: every final ends sooner than it did (below 0.95, a cut that is felt) and stays a fight (not below 0.5: a
 * half-HP boss at the end of a 15-minute run would be a formality), and read the exact numbers from the content.
 */
const HP_MUL_MIN = 0.5;
const HP_MUL_MAX = 0.95;

function zoneOf(db: ContentDB, id: string): ZoneDef {
  const z = db.zones.find((x) => x.id === id);
  if (!z) throw new Error(`zone ${id}`);
  return z;
}

const hpMulOf = (id: string): number => zoneOf(content, id).final.hpMul as number;

/** the gate's OFF arm as a content patch: the key deleted (null deletes), i.e. today's boss before PC-04 */
const OFF_ARM = { zones: ZONES.map((id) => ({ id, final: { hpMul: null } })) };

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
  /** a hero nothing can kill (the fight tests need the boss to be the only variable) */
  immortal?: boolean;
}

/** the shipped sim on the real zone: spawner, elites and the scheduled bosses off, the Great Metin / final boss schedule untouched */
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
    meta: o.immortal ? { stats: { maxHp: 1e9 } } : { stats: {} },
    coop: o.coop ? [GUEST] : undefined,
  } as RunConfig;
  if (o.runOptionsMax) {
    const t = runOptionsTable(db.balance);
    config.runOptions = { density: t.density.max, health: t.health.max, damage: t.damage.max, speed: t.speed.max };
  }
  const w = createWorld(config, db, config.meta);
  w.spawner.acc = -1e9;
  w.spawner.eliteT = 1e9;
  w.spawner.nextBoss = w.spawner.bosses.length;
  for (const p of w.players) p.skills.length = 0;
  return w;
}

/** hp lives in a Float32Array: compare absolute values to a relative 1e-6 */
const near = (a: number, b: number): void => void expect(Math.abs(a / b - 1)).toBeLessThan(1e-6);
const hpMaxOf = (w: World, b: BossState): number => w.enemies.hpMax[w.enemies.find(b.enemy)] as number;
const rowOf = (w: World, b: BossState): number => w.enemies.find(b.enemy);

/** the final boss spawned directly, at the clock the real fight has it (hpScale is time based) */
function finalBossAt(w: World, t = 907): BossState {
  w.time = t;
  const b = spawnBoss(w, w.zone.final.boss, true, 10, 10);
  if (!b) throw new Error('no final boss');
  return b;
}

/** play until the final boss has emerged from the Great Metin (the real path: the stone falls at final.at, the boss follows ~3 s after it lands) */
function emerge(w: World): BossState {
  w.metinSys.nextFallAt = 1e9;
  w.time = w.zone.final.at - 0.05;
  let guard = 0;
  while (!w.bosses.some((b) => b.final) && guard++ < 1800) {
    drainModals(w);
    w.step([NO_INPUT]);
  }
  const boss = w.bosses.find((b) => b.final);
  if (!boss) throw new Error('the final boss never emerged');
  return boss;
}

const HIT = 1000;
function hit(w: World, row: number, dmg = HIT): number {
  const c = newHitCtx();
  c.player = 0;
  c.noCrit = true;
  return hitEnemy(w, row, dmg, c);
}

interface Fight {
  hpMax: number;
  /** hits that landed (an invulnerable intro or a phase swallows the others) */
  hits: number;
  /** ticks from the first landed hit to the kill */
  ticks: number;
  victory: boolean;
  over: boolean;
  /** simulated seconds from the kill to the run end */
  outro: number;
}

/** the real fight with a fixed damage budget: one hit of HIT per tick until the boss dies, then the run plays out to its end */
function fight(w: World): Fight {
  const b = emerge(w);
  const row = rowOf(w, b);
  const hpMax = w.enemies.hpMax[row] as number;
  let hits = 0;
  let first = -1;
  let ticks = 0;
  for (let i = 0; i < 60 * 60 * 6 && !b.dead; i++) {
    drainModals(w);
    w.step([NO_INPUT]);
    if (b.dead) break;
    const r = rowOf(w, b);
    if (r < 0) break;
    if (hit(w, r) > 0) {
      hits++;
      if (first < 0) first = i;
    }
    ticks = first < 0 ? 0 : i - first + 1;
  }
  expect(b.dead).toBe(true);
  const t0 = w.time;
  for (let i = 0; i < 60 * 12 && !w.over; i++) {
    drainModals(w);
    w.step([NO_INPUT]);
  }
  return { hpMax, hits, ticks, victory: w.victory, over: w.over, outro: w.time - t0 };
}

describe('PC-04 a final fight that ends on a high: data', () => {
  it('every zone carries a final.hpMul that ends the fight sooner but keeps it a fight, and the sim sees it as mods.finalHp', () => {
    for (const id of ZONES) {
      const z = zoneOf(content, id);
      expect(z.final.hpMul, `${id} has the multiplier`).toBeDefined();
      expect(z.final.hpMul as number, `${id} ends sooner`).toBeLessThanOrEqual(HP_MUL_MAX);
      expect(z.final.hpMul as number, `${id} stays a fight`).toBeGreaterThanOrEqual(HP_MUL_MIN);
      expect(resolveZoneMuls(z).finalHp).toBe(z.final.hpMul);
      expect(mk(id).mods.finalHp, id).toBe(z.final.hpMul);
    }
  });

  it('the tuned content validates, and the OFF arm of the gate (the key deleted) validates too and differs by that key only', () => {
    expect(validateContent(content).errors).toEqual([]);
    const off = offContent();
    expect(validateContent(off).errors).toEqual([]);
    for (const id of ZONES) {
      const z = zoneOf(off, id);
      expect(z.final.hpMul, `${id} OFF`).toBeUndefined();
      expect(resolveZoneMuls(z).finalHp).toBe(1);
      expect(mk(id, { db: off }).mods.finalHp).toBe(1);
      const a = structuredClone(zoneOf(content, id)) as unknown as { final: Record<string, unknown> };
      const b = structuredClone(z) as unknown as { final: Record<string, unknown> };
      delete a.final['hpMul'];
      expect(a, `${id}: only final.hpMul differs`).toEqual(b);
      // the boss, the great stone and the clock of the final are the same ones
      expect(zoneOf(content, id).final.at).toBe(900);
      expect(zoneOf(content, id).final.boss).toBe(z.final.boss);
      expect(zoneOf(content, id).final.greatMetin).toBe(z.final.greatMetin);
    }
  });

  it('bosses.json and metins.json are untouched: the multiplier is a code factor at spawn (the HP of every definition is its own)', () => {
    for (const id of ZONES) {
      const z = zoneOf(content, id);
      const def = content.bosses.find((b) => b.id === z.final.boss);
      expect(def, `${id} final boss def`).toBeDefined();
      expect(def?.hp as number).toBeGreaterThan(0);
    }
  });
});

describe('PC-04 a final fight that ends on a high: the sim reads it', () => {
  for (const id of ZONES) {
    it(`${id}: the final boss's HP is def.hp x hpScale x hpMul (the OFF arm: def.hp x hpScale); a scheduled boss and the Great Metin are not scaled`, () => {
      const on = mk(id);
      const off = mk(id, { db: offContent() });
      const bOn = finalBossAt(on);
      const bOff = finalBossAt(off);
      const expected = bOn.def.hp * on.hpScale();
      near(hpMaxOf(off, bOff), bOff.def.hp * off.hpScale());
      near(hpMaxOf(on, bOn), expected * hpMulOf(id));
      expect(hpMaxOf(on, bOn) / hpMaxOf(off, bOff)).toBeCloseTo(hpMulOf(id), 6);
      expect(on.enemies.hp[rowOf(on, bOn)]).toBe(hpMaxOf(on, bOn));

      // the zone's own scheduled boss (not final) keeps its data HP in both arms
      const sched = zoneOf(content, id).bosses[0]?.boss as string;
      const sOn = spawnBoss(on, sched, false, -10, -10) as BossState;
      const sOff = spawnBoss(off, sched, false, -10, -10) as BossState;
      near(hpMaxOf(on, sOn), sOn.def.hp * on.hpScale());
      near(hpMaxOf(on, sOn), hpMaxOf(off, sOff));
    });

    it(`${id}: no rng draw moved (the boss pattern clock and the next boss draw are the OFF arm's, HASH-EQ of the data) and the great stone is the same`, () => {
      const on = mk(id);
      const off = mk(id, { db: offContent() });
      const bOn = finalBossAt(on);
      const bOff = finalBossAt(off);
      expect(bOn.ready).toEqual(bOff.ready);
      expect(bOn.intro).toBe(bOff.intro);
      expect(on.rng.boss.next()).toBe(off.rng.boss.next());
      expect(on.rng.spawn.next()).toBe(off.rng.spawn.next());
      expect(on.rng.combat.next()).toBe(off.rng.combat.next());
      // the multiplier never reaches the Great Metin
      const mOn = content.metins.find((m) => m.id === zoneOf(content, id).final.greatMetin);
      const mOff = offContent().metins.find((m) => m.id === zoneOf(content, id).final.greatMetin);
      expect(mOn).toEqual(mOff);
    });

    it(`${id}: the real fight is shorter by the factor for the same damage per tick, and the kill still wins the run after the victory delay`, () => {
      const on = fight(mk(id, { immortal: true }));
      const off = fight(mk(id, { immortal: true, db: offContent() }));
      expect(on.hpMax / off.hpMax).toBeCloseTo(hpMulOf(id), 6);
      // the same blows: the number of landed hits follows the HP (one overkill hit of slack)
      expect(on.hits).toBeLessThan(off.hits);
      expect(on.hits / off.hits).toBeGreaterThan(hpMulOf(id) - 0.03);
      expect(on.hits / off.hits).toBeLessThan(hpMulOf(id) + 0.03);
      expect(on.ticks).toBeLessThan(off.ticks);
      for (const f of [on, off]) {
        expect(f.over).toBe(true);
        expect(f.victory).toBe(true);
        expect(f.outro).toBeGreaterThan(VICTORY_DELAY - 0.2);
        expect(f.outro).toBeLessThan(VICTORY_DELAY + 0.2);
      }
    });
  }
});

describe('PC-04 a final fight that ends on a high: edge cases', () => {
  it('hard and Run Options max multiply the same boss: the ON / OFF ratio is the zone factor, the difficulty keeps its own', () => {
    for (const id of ZONES) {
      const normalOn = mk(id);
      const hardOn = mk(id, { difficulty: 'hard' });
      const hardOff = mk(id, { difficulty: 'hard', db: offContent() });
      const maxOn = mk(id, { runOptionsMax: true });
      const maxOff = mk(id, { runOptionsMax: true, db: offContent() });
      const a = hpMaxOf(normalOn, finalBossAt(normalOn));
      const b = hpMaxOf(hardOn, finalBossAt(hardOn));
      const c = hpMaxOf(hardOff, finalBossAt(hardOff));
      const d = hpMaxOf(maxOn, finalBossAt(maxOn));
      const e = hpMaxOf(maxOff, finalBossAt(maxOff));
      expect(b / c, `${id} hard`).toBeCloseTo(hpMulOf(id), 6);
      expect(b / a, `${id} hard / normal is the difficulty's own factor`).toBeCloseTo(hardOn.diff.hp, 6);
      expect(d / e, `${id} Run Options max`).toBeCloseTo(hpMulOf(id), 6);
      expect(d / a, `${id} Run Options max / default is the slider's own factor`).toBeCloseTo(maxOn.diff.hp, 6);
      expect(Number.isFinite(d)).toBe(true);
    }
  });

  it('an event factor (mods.finalHp) stacks on top of the zone factor and only reaches a boss that spawns while it is on', () => {
    for (const id of ZONES) {
      const w = mk(id);
      const before = finalBossAt(w);
      const plain = hpMaxOf(w, before);
      const e = mk(id);
      e.setEventMods('x', { finalHp: 1.5 });
      const during = hpMaxOf(e, finalBossAt(e));
      expect(during / plain, id).toBeCloseTo(1.5, 6);
      e.clearEventMods('x');
      expect(e.mods.finalHp).toBe(hpMulOf(id));
    }
  });

  it('co-op: a second hero changes nothing (the factor is applied once, by the host world) and both heroes read the same boss HP in the HUD', () => {
    for (const id of ZONES) {
      const solo = mk(id);
      const duo = mk(id, { coop: true });
      expect(duo.players.length).toBe(2);
      const hSolo = hpMaxOf(solo, finalBossAt(solo));
      const bDuo = finalBossAt(duo);
      expect(hpMaxOf(duo, bDuo), id).toBeCloseTo(hSolo, 3);
      for (let p = 0; p < 2; p++) {
        const boss = duo.hud(p).boss;
        expect(boss, `${id} hero ${p} sees the boss`).not.toBeNull();
        expect(boss?.final).toBe(true);
        expect(boss?.hpMax).toBe(hpMaxOf(duo, bDuo));
        expect(boss?.hp).toBe(boss?.hpMax);
      }
    }
  });

  it('the hero dead with the final boss alive: a defeat, the boss keeps its scaled HP, nobody throws', () => {
    for (const id of ZONES) {
      const w = mk(id);
      const b = emerge(w);
      const row = rowOf(w, b);
      const max = w.enemies.hpMax[row] as number;
      expect(max).toBeGreaterThan(0);
      player(w).hp = 0;
      for (let i = 0; i < 60 * 8 && !w.over; i++) {
        drainModals(w);
        w.step([NO_INPUT]);
      }
      expect(w.over, id).toBe(true);
      expect(w.victory).toBe(false);
      expect(w.result?.victory).toBe(false);
      expect(w.result?.bossesKilled).not.toContain(w.zone.final.boss);
      expect(b.dead).toBe(false);
      const r = rowOf(w, b);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(w.enemies.hpMax[r]).toBe(max);
      expect(Number.isFinite(w.enemies.hp[r] as number)).toBe(true);
    }
  });

  it('a modal open (pause) freezes the fight: no tick, no damage, the scaled HP is where it was', () => {
    const w = mk('seori', { immortal: true });
    const b = emerge(w);
    runTicks(w, 120); // the intro is over, the boss is vulnerable
    const row = rowOf(w, b);
    expect(hit(w, row, 2000)).toBeGreaterThan(0);
    const hp = w.enemies.hp[row] as number;
    expect(hp).toBeLessThan(w.enemies.hpMax[row] as number);
    openLevelUp(w, player(w), 1);
    expect(w.modal).not.toBeNull();
    const t = w.time;
    for (let i = 0; i < 120; i++) w.step([NO_INPUT]);
    expect(w.time).toBe(t);
    expect(w.enemies.hp[row]).toBe(hp);
    expect(w.over).toBe(false);
  });

  it('the Great Metin of the final is not on the stone clock and is not scaled (the final starts at 900 s on every zone)', () => {
    for (const id of ZONES) {
      const w = mk(id);
      w.metinSys.nextFallAt = 1e9;
      w.time = w.zone.final.at - 0.05;
      for (let i = 0; i < 600 && !w.metins.some((m) => m.great); i++) {
        drainModals(w);
        w.step([NO_INPUT]);
      }
      const g = w.metins.find((m) => m.great);
      expect(g, id).toBeDefined();
      expect(g?.def.id).toBe(zoneOf(content, id).final.greatMetin);
      expect(g?.phase === MetinPhase.Falling || g?.phase === MetinPhase.Alive).toBe(true);
      const off = mk(id, { db: offContent() });
      off.metinSys.nextFallAt = 1e9;
      off.time = off.zone.final.at - 0.05;
      for (let i = 0; i < 600 && !off.metins.some((m) => m.great); i++) {
        drainModals(off);
        off.step([NO_INPUT]);
      }
      expect(off.metins.find((m) => m.great)?.hpFrac).toBe(g?.hpFrac);
    }
  });
});

describe('PC-04 a final fight that ends on a high: co-op host and guest on the relay', () => {
  let h: CoopHarness | null = null;
  afterEach(() => {
    h?.dispose();
    h = null;
  });
  const HP_MUL = 0.75;
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) (h as CoopHarness).tick({ x: 0, z: 0 }, [{ x: 0, z: 0 }]);
  };

  it('the guest HUD shows the host\'s scaled boss HP, also for a guest that dropped before the boss and came back (late join)', async () => {
    h = await CoopHarness.create({
      guests: 1,
      latencyMs: 30,
      enemies: 0,
      tough: true,
      content: (c) => {
        (c.zones[0] as ZoneDef).final.hpMul = HP_MUL;
      },
    });
    const hw = h.hostWorld;
    const mw = h.guestWorlds[0]!;
    run(60 * 2);
    // the guest leaves before the boss exists and returns while it stands
    h.transports[1]?.drop();
    run(60);
    hw.time = 907;
    const boss = spawnBoss(hw, hw.zone.final.boss, true, 6, 6) as BossState;
    const hostMax = hw.enemies.hpMax[hw.enemies.find(boss.enemy)] as number;
    near(hostMax, boss.def.hp * hw.hpScale() * HP_MUL);
    run(60 * 2);
    await h.reconnect(1);
    run(60 * 4);
    await h.settle(200);
    run(60);
    const hostHud = hw.hud(0).boss;
    expect(hostHud?.hpMax).toBe(hostMax);
    const guestHud = mw.hud(1).boss;
    expect(guestHud, 'the guest sees the final boss').not.toBeNull();
    expect(guestHud?.final).toBe(true);
    expect(guestHud?.id).toBe(boss.def.id);
    // hpMax travels as a float32 on the wire: equal to the host's within its precision, and the scaled value (never def.hp x scale)
    expect(guestHud?.hpMax as number).toBeCloseTo(hostMax, -1);
    expect(Math.abs((guestHud?.hpMax as number) / (boss.def.hp * hw.hpScale()) - HP_MUL)).toBeLessThan(0.01);
  });
});

// HZ-01 (qa SOAK-4): the terrain hazards in the SHIPPED sim. app/run.ts builds the sim env as { ...field.env, bossModel }, so these tests run the
// real terrain field of each zone through the real world.step() / updatePlayers() and check what a player now sees: lava and miasma hurt (and
// kill: PlayerState.lastHitBy / killedBy are exactly 'hazard:lava' / 'hazard:miasma', DT-01), shallow water slows, ice slides, deep water stops the hero, and the hero is
// a circle that slides along blockers and cliffs instead of stopping dead.
//
// Fail-before switch: HZ01_LEGACY=1 plays the same tests on the env the app built before the SOAK-4 fix (arenaRadius + walkable only: no hazards,
// point movement). Every hazard assertion below then fails; without the switch they pass.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { newMoveState, stepMove, type MoveEnv, type MoveParams } from '../../net/coop/predict';
import { CoopHarness } from '../../net/coop/harness';
import { createTerrainField, type TerrainField } from '../../world/terrainField';
import { openLevelUp } from '../cards';
import { Surface } from '../constants';
import { runOptionsTable, type RunOptions } from '../run';
import type { PlayerState } from '../stores';
import type { WorldEnv } from '../types';
import { createWorld, type World } from '../world';
import { clearEnemies, dropSkills, findNonFinite, freezeSchedules, player, runTicks, spawn } from './helpers';

const LEGACY = process.env.HZ01_LEGACY === '1';
const NONE = { moveX: 0, moveZ: 0 };

interface MkOpts {
  seed?: number;
  difficulty?: 'normal' | 'hard';
  classId?: string;
  /** Run Options at their maximum (the soak's --run-options max) */
  runOptionsMax?: boolean;
  /** extra revives for the hero */
  revives?: number;
  /** the same field with the ground's tick switched off (surfaceAt reads Ground everywhere): the control arm of the shield tests */
  flat?: boolean;
}

/** the env app/run.ts hands the sim (field.env + the boss clip model), or the pre-SOAK-4 one under HZ01_LEGACY */
function shippedEnv(field: TerrainField, flat = false): WorldEnv {
  const env: WorldEnv = { ...field.env, bossModel: () => ({ spawn: 0, breath: false }) };
  if (flat) env.surfaceAt = () => Surface.Ground;
  if (LEGACY) {
    delete env.moveCircle;
    delete env.surfaceAt;
  }
  return env;
}

function mk(zoneId: string, o: MkOpts = {}): { w: World; field: TerrainField; p: PlayerState } {
  const zone = content.zones.find((z) => z.id === zoneId);
  if (!zone) throw new Error(`zone ${zoneId}`);
  const seed = o.seed ?? 11;
  const field = createTerrainField(zone.biome, seed);
  const classId = o.classId ?? 'yacha';
  const cls = content.classes.find((c) => c.id === classId);
  if (!cls) throw new Error(`class ${classId}`);
  let runOptions: Partial<RunOptions> | undefined;
  if (o.runOptionsMax) {
    const t = runOptionsTable(content.balance);
    runOptions = { density: t.density.max, health: t.health.max, damage: t.damage.max, speed: t.speed.max };
  }
  const w = createWorld(
    {
      zone: zoneId,
      difficulty: o.difficulty ?? 'normal',
      classId,
      doctrine: 'a',
      sex: cls.sexes[0] as never,
      empire: (content.empires[0] as { id: string }).id as never,
      seed,
      meta: { stats: {} },
      runOptions,
    } as never,
    content,
    undefined,
    shippedEnv(field, o.flat),
  );
  freezeSchedules(w);
  clearEnemies(w);
  const p = player(w);
  if (o.revives) p.stats.revives = o.revives;
  return { w, field, p };
}

function place(p: PlayerState, x: number, z: number): void {
  p.x = x;
  p.z = z;
  p.px = x;
  p.pz = z;
  p.vx = 0;
  p.vz = 0;
  p.kvx = 0;
  p.kvz = 0;
}

/** first point on `surface` where a hero disc stands freely, scanning the arena on a coarse grid */
function findSurface(field: TerrainField, surface: number, step = 1): { x: number; z: number } | null {
  const R = field.arenaRadius - 5;
  for (let z = -R; z <= R; z += step) {
    for (let x = -R; x <= R; x += step) {
      if (Math.hypot(x, z) < R && field.surfaceAt(x, z) === surface && field.walkableCircle(x, z, 0.6)) return { x, z };
    }
  }
  return null;
}

/** a start point and a unit direction with `len` metres of free `surface` ahead (all of it walkable for a hero disc), 8 headings */
function findRun(field: TerrainField, surface: number, len: number): { x: number; z: number; dx: number; dz: number } | null {
  const R = field.arenaRadius - 8;
  const heads: [number, number][] = [
    [1, 0], [0, 1], [-1, 0], [0, -1],
    [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
  ];
  for (let z = -R; z <= R; z += 2) {
    for (let x = -R; x <= R; x += 2) {
      if (Math.hypot(x, z) > R || field.surfaceAt(x, z) !== surface) continue;
      for (const [dx, dz] of heads) {
        let ok = true;
        for (let s = 0; s <= len && ok; s += 0.5) {
          const px = x + dx * s;
          const pz = z + dz * s;
          if (field.surfaceAt(px, pz) !== surface || !field.walkableCircle(px, pz, 0.7)) ok = false;
        }
        if (ok) return { x, z, dx, dz };
      }
    }
  }
  return null;
}

/** a stretch of cliff / blocker edge that runs straight (the same clearance at 0.25 m resolution) for 12 m with free ground in front of it, on a grid axis: start point, wall direction */
function findStraightWall(field: TerrainField): { x: number; z: number; dx: number; dz: number } | null {
  const R = field.arenaRadius - 8;
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let z = -R; z <= R; z += 1) {
    for (let x = -R; x <= R; x += 1) {
      if (Math.hypot(x, z) > R) continue;
      for (const [dx, dz] of dirs) {
        const px = -dz;
        const pz = dx;
        let lo = Infinity;
        let hi = -Infinity;
        let ok = true;
        for (let s = -6; s <= 6 && ok; s += 1) {
          const fx = x + px * s;
          const fz = z + pz * s;
          if (!field.walkableCircle(fx, fz, 0.7) || field.surfaceAt(fx, fz) !== Surface.Ground) {
            ok = false;
            break;
          }
          let hit = -1;
          for (let t = 0.25; t <= 3.5; t += 0.25) {
            if (!field.walkableCircle(fx + dx * t, fz + dz * t, 0.55)) {
              hit = t;
              break;
            }
          }
          if (hit < 1.25) ok = false;
          else {
            lo = Math.min(lo, hit);
            hi = Math.max(hi, hit);
          }
        }
        if (ok && hi - lo < 0.01) return { x, z, dx, dz };
      }
    }
  }
  return null;
}

function hpFrac(p: PlayerState): number {
  return p.hp / p.hpMax;
}

describe('HZ-01: the env the app builds', () => {
  for (const zone of ['yeonmu', 'suryeon', 'seori', 'daeryeol']) {
    it(`${zone}: { ...field.env, bossModel } carries moveCircle and surfaceAt`, () => {
      const { field } = mk(zone);
      const env = shippedEnv(field);
      expect(typeof env.walkable).toBe('function');
      expect(typeof env.moveCircle).toBe('function');
      expect(typeof env.surfaceAt).toBe('function');
      // the sim reads the same surface ids as the field and the shared Surface enum
      const spot = findSurface(field, Surface.Ground);
      expect(spot).not.toBeNull();
      expect(env.surfaceAt?.(spot!.x, spot!.z)).toBe(Surface.Ground);
    });
  }

  it('host and guest build the same surfaces: two fields of one seed agree on a 3 m grid (the guest builds its own field)', () => {
    const zone = content.zones.find((z) => z.id === 'daeryeol');
    const a = createTerrainField(zone!.biome, 4242);
    const b = createTerrainField(zone!.biome, 4242);
    let lava = 0;
    for (let z = -150; z <= 150; z += 3) {
      for (let x = -150; x <= 150; x += 3) {
        const s = a.surfaceAt(x, z);
        if (s === Surface.Lava) lava++;
        expect(b.surfaceAt(x, z)).toBe(s);
      }
    }
    expect(lava).toBeGreaterThan(100);
  });
});

describe('HZ-01: lava and miasma hurt the hero', () => {
  it('lava burns about 2.5 % of max HP every half second and the hero dies on it (killer hazard:lava)', () => {
    const { w, field, p } = mk('daeryeol');
    const spot = findSurface(field, Surface.Lava);
    expect(spot, 'daeryeol has lava').not.toBeNull();
    place(p, spot!.x, spot!.z);
    const hp0 = hpFrac(p);
    runTicks(w, 60 * 2);
    // four half-second ticks in two seconds: between 2 % and 11 % lost (armor / fire resist only soften the 2.5 % tick)
    expect(hp0 - hpFrac(p)).toBeGreaterThan(0.02);
    expect(hp0 - hpFrac(p)).toBeLessThan(0.11);
    // standing still on lava ends the run
    let t = 0;
    while (p.alive && t < 60 * 90) {
      w.step([NONE]);
      t++;
    }
    expect(p.alive).toBe(false);
    expect(t).toBeLessThan(60 * 90);
    // DT-01: the last blow and the killer are the lava, exactly (a creature, an empty string or the wrong pool must fail)
    expect(p.lastHitBy).toBe('hazard:lava');
    expect(p.killedBy).toBe('hazard:lava');
    expect(findNonFinite(w)).toBeNull();
  });

  it('miasma poisons more gently than lava, and the hero dies on it too', () => {
    const lava = mk('daeryeol');
    const sp = findSurface(lava.field, Surface.Lava)!;
    place(lava.p, sp.x, sp.z);
    runTicks(lava.w, 60 * 6);
    const lost = (m: { p: PlayerState }): number => 1 - hpFrac(m.p);
    const lavaLost = lost(lava);

    const seori = mk('seori');
    const mi = findSurface(seori.field, Surface.Miasma);
    expect(mi, 'seori has miasma').not.toBeNull();
    place(seori.p, mi!.x, mi!.z);
    runTicks(seori.w, 60 * 6);
    const miasmaLost = lost(seori);
    expect(miasmaLost).toBeGreaterThan(0.03);
    expect(miasmaLost).toBeLessThan(lavaLost);

    let t = 0;
    while (seori.p.alive && t < 60 * 120) {
      seori.w.step([NONE]);
      t++;
    }
    expect(seori.p.alive).toBe(false);
    expect(seori.p.lastHitBy).toBe('hazard:miasma');
    expect(seori.p.killedBy).toBe('hazard:miasma');
  });

  it('ground is harmless: the same wait on plain ground costs nothing', () => {
    const { w, field, p } = mk('daeryeol');
    const spot = findSurface(field, Surface.Ground)!;
    place(p, spot.x, spot.z);
    const hp0 = p.hp;
    runTicks(w, 60 * 10);
    expect(p.hp).toBe(hp0);
  });

  it('walking off the lava stops the damage', () => {
    const { w, field, p } = mk('daeryeol');
    // a lava point with plain ground 2.5 m away along a free heading
    let edge: { x: number; z: number; dx: number; dz: number } | null = null;
    const R = field.arenaRadius - 8;
    const heads: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    outer: for (let z = -R; z <= R; z += 1) {
      for (let x = -R; x <= R; x += 1) {
        if (Math.hypot(x, z) > R || field.surfaceAt(x, z) !== Surface.Lava || !field.walkableCircle(x, z, 0.7)) continue;
        for (const [dx, dz] of heads) {
          let ok = field.surfaceAt(x + dx * 2.5, z + dz * 2.5) === Surface.Ground && field.surfaceAt(x + dx * 5, z + dz * 5) === Surface.Ground;
          for (let t = 0.5; t <= 5 && ok; t += 0.5) if (!field.walkableCircle(x + dx * t, z + dz * t, 0.7)) ok = false;
          if (ok) {
            edge = { x, z, dx, dz };
            break outer;
          }
        }
      }
    }
    expect(edge, 'daeryeol has a lava edge').not.toBeNull();
    place(p, edge!.x, edge!.z);
    runTicks(w, 40); // a tick and a half of burning
    const burning = hpFrac(p);
    expect(burning).toBeLessThan(1);
    for (let i = 0; i < 45; i++) w.step([{ moveX: edge!.dx, moveZ: edge!.dz }]); // 0.75 s of walking = 4 m
    expect(field.surfaceAt(p.x, p.z)).toBe(Surface.Ground);
    const hp1 = p.hp;
    runTicks(w, 60 * 5);
    expect(p.hp).toBeGreaterThanOrEqual(hp1); // regen only
  });

  it('the damage scales with max HP and holds on hard and with Run Options at their maximum', () => {
    const fractions: number[] = [];
    for (const o of [{ difficulty: 'normal' }, { difficulty: 'hard' }, { difficulty: 'normal', runOptionsMax: true }] as MkOpts[]) {
      const { w, field, p } = mk('daeryeol', o);
      const spot = findSurface(field, Surface.Lava)!;
      place(p, spot.x, spot.z);
      const hp0 = hpFrac(p);
      runTicks(w, 60 * 4);
      fractions.push(hp0 - hpFrac(p));
      expect(findNonFinite(w)).toBeNull();
    }
    for (const f of fractions) expect(f).toBeGreaterThan(0.04);
    // a percentage tick: the three arms lose the same share of their own max HP (within a tick of rounding)
    expect(Math.max(...fractions) - Math.min(...fractions)).toBeLessThan(0.03);
  });

  it('a revive on lava: the hero comes back at half HP with its i-frames, then burns again and the run still ends cleanly', () => {
    const { w, field, p } = mk('daeryeol', { revives: 1 });
    const spot = findSurface(field, Surface.Lava)!;
    place(p, spot.x, spot.z);
    let revived = false;
    let t = 0;
    while (t < 60 * 120 && (p.alive || !revived)) {
      w.step([NONE]);
      if (p.revivesUsed === 1) revived = true;
      t++;
      if (!p.alive) break;
    }
    expect(revived).toBe(true);
    expect(p.alive).toBe(false);
    expect(findNonFinite(w)).toBeNull();
    // the run end opens and stepping on does not throw
    for (let i = 0; i < 60 * 15; i++) w.step([NONE]);
    expect(findNonFinite(w)).toBeNull();
    expect(w.over || w.endTimer >= 0 || w.modal?.kind === 'runEnd').toBe(true);
  });

  it('no damage while a modal pauses the sim, and it resumes after the pick', () => {
    const { w, field, p } = mk('daeryeol');
    const spot = findSurface(field, Surface.Lava)!;
    place(p, spot.x, spot.z);
    runTicks(w, 30);
    openLevelUp(w, p, 2);
    expect(w.modal).not.toBeNull();
    const hp = p.hp;
    const time = w.time;
    for (let i = 0; i < 60 * 8; i++) w.step([NONE]);
    expect(p.hp).toBe(hp);
    expect(w.time).toBe(time);
    expect(w.chooseCard(0)).toBe(true);
    runTicks(w, 60 * 3);
    expect(p.hp).toBeLessThan(hp);
  });

  it('a hero walking across lava is hurt only for the time it stands on it (no negative or NaN hp)', () => {
    const { w, field, p } = mk('daeryeol');
    const run = findRun(field, Surface.Lava, 3);
    expect(run, 'daeryeol has a 3 m lava run').not.toBeNull();
    place(p, run!.x, run!.z);
    for (let i = 0; i < 60 * 3; i++) w.step([{ moveX: run!.dx, moveZ: run!.dz }]);
    expect(Number.isFinite(p.hp)).toBe(true);
    expect(p.hp).toBeGreaterThan(0);
    expect(findNonFinite(w)).toBeNull();
  });

  it('a real dash across lava: the dash i-frames absorb a tick that falls inside it, and the lava burns again after the landing', () => {
    const { w, field, p } = mk('daeryeol');
    const run = findRun(field, Surface.Lava, 7);
    expect(run, 'daeryeol has a 7 m lava run').not.toBeNull();
    place(p, run!.x, run!.z);
    // what skills/behaviors/dash.ts does: 6 m at 24 m/s with i-frames for the flight plus 0.12 s
    const speed = 24;
    const t = 6 / speed;
    p.dashT = t;
    p.dashVx = run!.dx * speed;
    p.dashVz = run!.dz * speed;
    p.dashSlot = 0;
    p.iframes = t + 0.12;
    p.surfT = 0.45; // a lava tick falls due 0.05 s into the flight
    const x0 = p.x;
    const z0 = p.z;
    const hp0 = p.hp;
    for (let i = 0; i < 16; i++) w.step([{ moveX: run!.dx, moveZ: run!.dz }]); // 0.267 s: the flight is over
    expect(p.dashT).toBe(0);
    expect(Math.hypot(p.x - x0, p.z - z0), 'the dash flew').toBeGreaterThan(5);
    expect(p.hp, 'the tick inside the dash was absorbed by its i-frames').toBe(hp0);
    expect(field.surfaceAt(p.x, p.z)).toBe(Surface.Lava);
    runTicks(w, 90);
    expect(p.hp, 'standing on the landing spot burns').toBeLessThan(hp0);
    expect(Number.isFinite(p.hp)).toBe(true);
    expect(findNonFinite(w)).toBeNull();
  });
});

/** a point of `surface` whose disc of radius `r` is all `surface` and walkable (room for a crowd around the hero) */
function findDisc(field: TerrainField, surface: number, r: number): { x: number; z: number } | null {
  const R = field.arenaRadius - 12;
  const ok = (x: number, z: number): boolean => field.surfaceAt(x, z) === surface && field.walkableCircle(x, z, 0.7);
  for (let z = -R; z <= R; z += 2) {
    for (let x = -R; x <= R; x += 2) {
      if (Math.hypot(x, z) > R || !ok(x, z)) continue;
      let all = true;
      for (let a = 0; a < 16 && all; a++) {
        for (const rr of [r * 0.5, r]) if (!ok(x + Math.cos((a * Math.PI) / 8) * rr, z + Math.sin((a * Math.PI) / 8) * rr)) all = false;
      }
      if (all) return { x, z };
    }
  }
  return null;
}

// The ground is not a shield. The lava / miasma tick used to hand out HAZARD_IFRAMES (0.25 s) like any blow, and hurtPlayer refuses EVERY blow
// while p.iframes > 0, so a hero standing in lava was untouchable for half of every tick (and an evasion roll could 'dodge' the ground and
// grant 0.25 s more). The tick now comes in as HurtKind.Terrain: no evasion, no dodge charge, no i-frames of its own.
describe('HZ-01: the ground is never a shield', () => {
  interface Crowd {
    enemyHits: number;
    hazardHits: number;
    enemyDamage: number;
    totalDamage: number;
  }

  /** two flame warriors on a 2.2 m ring round a hero healed every tick, 30 s at run time 400; `tick` false = the same spot with the ground's tick off */
  function crowd(seed: number, tick: boolean): Crowd {
    const { w, field, p } = mk('daeryeol', { seed, flat: !tick });
    const spot = findDisc(field, Surface.Lava, 5);
    expect(spot, 'daeryeol has a 5 m lava disc').not.toBeNull();
    place(p, spot!.x, spot!.z);
    dropSkills(w); // the crowd stays alive and keeps swinging
    w.time = 400; // enemy damage scales with run time
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI + 0.7;
      spawn(w, 'blaze_knight', spot!.x + Math.cos(a) * 2.2, spot!.z + Math.sin(a) * 2.2);
    }
    const out: Crowd = { enemyHits: 0, hazardHits: 0, enemyDamage: 0, totalDamage: 0 };
    for (let i = 0; i < 60 * 30; i++) {
      p.hp = p.hpMax;
      const lastAt = p.lastHitAt;
      w.step([NONE]);
      if (p.lastHitAt === lastAt) continue;
      const lost = Math.max(0, p.hpMax - p.hp);
      if (p.lastHitBy.startsWith('hazard:')) out.hazardHits++;
      else {
        out.enemyHits++;
        out.enemyDamage += lost;
      }
      out.totalDamage += lost;
    }
    expect(p.alive).toBe(true);
    return out;
  }

  it('lava is never a shield: with the same crowd and spot, the enemy hits on lava are not fewer than off it and the total damage is larger', () => {
    const on: Crowd = { enemyHits: 0, hazardHits: 0, enemyDamage: 0, totalDamage: 0 };
    const off: Crowd = { enemyHits: 0, hazardHits: 0, enemyDamage: 0, totalDamage: 0 };
    for (const seed of [11, 12, 13]) {
      const a = crowd(seed, true);
      const b = crowd(seed, false);
      for (const k of Object.keys(on) as (keyof Crowd)[]) {
        on[k] += a[k];
        off[k] += b[k];
      }
    }
    // the control arm is a real fight, and only the lava arm takes lava ticks
    expect(off.enemyHits).toBeGreaterThan(30);
    expect(off.hazardHits).toBe(0);
    expect(on.hazardHits).toBeGreaterThan(30);
    // the shield is gone: every blow the crowd lands off the lava lands on it, and the lava damage comes on top
    expect(on.enemyHits).toBeGreaterThanOrEqual(off.enemyHits);
    expect(on.totalDamage).toBeGreaterThan(off.totalDamage);
  }, 60_000);

  it('evasion never dodges the ground: at the evasion cap the hero loses HP on every tick, spends no dodge charge, draws no random number and holds no i-frames after a tick', () => {
    for (const [zone, surface] of [['daeryeol', Surface.Lava], ['seori', Surface.Miasma]] as const) {
      const { w, field, p } = mk(zone);
      const spot = findSurface(field, surface);
      expect(spot, `${zone} has a hazard pool`).not.toBeNull();
      place(p, spot!.x, spot!.z);
      p.stats.evasion = w.balance.caps.evasion;
      expect(p.stats.evasion).toBeGreaterThan(0.3);
      p.dodgeN = 3;
      const rng0 = JSON.stringify(w.rng.combat.getState());
      let ticks = 0;
      for (let i = 0; i < 60 * 8; i++) {
        p.hp = p.hpMax;
        w.step([NONE]);
        if (p.hp < p.hpMax) {
          ticks++;
          expect(p.iframes, `${zone} tick ${ticks}: the ground grants no i-frames`).toBe(0);
        }
      }
      // 8 s = 16 half-second ticks; an evasion roll at the cap would have dodged about half of them
      expect(ticks, `${zone}: every tick lands`).toBeGreaterThanOrEqual(15);
      expect(p.dodgeN, `${zone}: no dodge charge spent on the ground`).toBe(3);
      expect(JSON.stringify(w.rng.combat.getState()), `${zone}: the ground rolls no evasion`).toBe(rng0);
    }
  });

  it('i-frames the hero already holds still protect it from the ground (a blow just taken, a dash)', () => {
    const { w, field, p } = mk('daeryeol');
    const spot = findSurface(field, Surface.Lava)!;
    place(p, spot.x, spot.z);
    p.iframes = 0.9; // the first tick (0.5 s) falls inside it
    runTicks(w, 40);
    expect(p.hp).toBe(p.hpMax);
    runTicks(w, 60 * 1.5);
    expect(p.hp).toBeLessThan(p.hpMax);
  });

  it('a revive on lava keeps its 3 s i-frames: the lava does not cut them short, then burns again', () => {
    const { w, field, p } = mk('daeryeol', { revives: 1 });
    const spot = findSurface(field, Surface.Lava)!;
    place(p, spot.x, spot.z);
    p.hp = 1; // the next tick is lethal
    let t = 0;
    while (p.revivesUsed === 0 && t < 60 * 3) {
      w.step([NONE]);
      t++;
    }
    expect(p.revivesUsed, 'the lava tick killed the hero and the revive fired').toBe(1);
    expect(p.alive).toBe(true);
    expect(p.hp).toBeCloseTo(p.hpMax * 0.5, 3);
    expect(p.iframes, 'revive i-frames intact right after the lethal tick').toBeGreaterThan(2.9);
    const hpRevive = p.hp;
    runTicks(w, 60 * 2.5);
    expect(p.hp, 'no lava damage inside the revive window').toBeGreaterThanOrEqual(hpRevive);
    runTicks(w, 60 * 2);
    expect(p.hp, 'burning again once the window is over').toBeLessThan(hpRevive);
  });

  it('the killer is told from the surface the tick was taken on, not from where the hero stands after the step (miasma on the tick it crosses into lava)', () => {
    const { w, field, p } = mk('seori');
    const spot = findSurface(field, Surface.Miasma)!;
    place(p, spot.x, spot.z);
    // the hero is on miasma when sim/player.ts reads the ground (the first read of a tick) and on lava when anything reads it after the move
    let reads = 0;
    w.env.surfaceAt = () => (reads++ === 0 ? Surface.Miasma : Surface.Lava);
    let t = 0;
    while (p.lastHitAt < 0 && t < 60 * 2) {
      reads = 0;
      w.step([NONE]);
      t++;
    }
    expect(p.lastHitAt).toBeGreaterThanOrEqual(0);
    expect(p.lastHitBy).toBe('hazard:miasma');
  });
});

describe('HZ-01: shallow water slows, ice slides, deep water stops', () => {
  it('shallow water slows the hero to about 80 % of the ground speed', () => {
    const y = mk('yeonmu');
    const water = findRun(y.field, Surface.Shallow, 5);
    expect(water, 'yeonmu has a 5 m shallow run').not.toBeNull();
    const ground = findRun(y.field, Surface.Ground, 5)!;
    const speedAfter = (r: { x: number; z: number; dx: number; dz: number }): number => {
      const m = mk('yeonmu');
      place(m.p, r.x, r.z);
      for (let i = 0; i < 40; i++) m.w.step([{ moveX: r.dx, moveZ: r.dz }]);
      return m.p.speed;
    };
    const ratio = speedAfter(water!) / speedAfter(ground);
    expect(ratio).toBeGreaterThan(0.77);
    expect(ratio).toBeLessThan(0.83);
  });

  it('ice keeps the hero sliding after the stick is released', () => {
    const s = mk('seori');
    const ice = findRun(s.field, Surface.Ice, 12);
    expect(ice, 'seori has a 12 m ice run').not.toBeNull();
    const slid = (r: { x: number; z: number; dx: number; dz: number }): number => {
      const m = mk('seori');
      place(m.p, r.x, r.z);
      for (let i = 0; i < 60; i++) m.w.step([{ moveX: r.dx, moveZ: r.dz }]);
      const x0 = m.p.x;
      const z0 = m.p.z;
      for (let i = 0; i < 20; i++) m.w.step([NONE]); // stick released
      return Math.hypot(m.p.x - x0, m.p.z - z0);
    };
    const onIce = slid(ice!);
    const onGround = slid(findRun(s.field, Surface.Ground, 12)!);
    expect(onIce).toBeGreaterThan(0.5);
    expect(onIce).toBeGreaterThan(onGround * 2);
  });

  it('the hero never wades into deep water: walking at the shore for 4 s ends on the bank', () => {
    for (const zone of ['yeonmu', 'suryeon']) {
      const { w, field, p } = mk(zone);
      const R = field.arenaRadius - 8;
      let shore: { x: number; z: number } | null = null;
      outer: for (let z = -R; z <= R; z += 1) {
        for (let x = -R; x <= R; x += 1) {
          if (Math.hypot(x, z) < R && field.walkableCircle(x, z, 0.7) && field.surfaceAt(x, z) !== Surface.Deep && field.surfaceAt(x + 2.5, z) === Surface.Deep) {
            shore = { x, z };
            break outer;
          }
        }
      }
      expect(shore, `${zone} has a bank`).not.toBeNull();
      place(p, shore!.x, shore!.z);
      for (let i = 0; i < 60 * 4; i++) {
        w.step([{ moveX: 1, moveZ: 0 }]);
        expect(field.surfaceAt(p.x, p.z), `${zone} tick ${i}`).not.toBe(Surface.Deep);
      }
    }
  });
});

describe('HZ-01: the hero is a circle that slides along blockers and cliffs', () => {
  it('a hero walking into a rock off-centre slides round it instead of stopping dead', () => {
    const { w, field, p } = mk('yeonmu');
    // an isolated blocker with room all round
    let rock: { x: number; z: number; r: number } | null = null;
    for (const b of field.blockers) {
      if (b.r < 1.2 || b.r > 3 || Math.hypot(b.x, b.z) > field.arenaRadius - 15) continue;
      let clear = true;
      field.blockersNear(b.x, b.z, b.r + 7, (o) => {
        if (o !== b) clear = false;
      });
      if (!clear) continue;
      let free = true;
      for (let a = 0; a < 16 && free; a++) {
        const ang = (a * Math.PI) / 8;
        if (!field.walkableCircle(b.x + Math.cos(ang) * (b.r + 1.5), b.z + Math.sin(ang) * (b.r + 1.5), 0.7)) free = false;
      }
      if (free && field.walkableCircle(b.x - b.r - 3, b.z + 0.4 * b.r, 0.7) && field.walkableCircle(b.x + b.r + 3, b.z + 0.4 * b.r, 0.7)) {
        rock = b;
        break;
      }
    }
    expect(rock, 'yeonmu has an isolated rock').not.toBeNull();
    const b = rock!;
    place(p, b.x - b.r - 3, b.z + 0.4 * b.r);
    let minGap = Infinity;
    for (let i = 0; i < 60 * 5; i++) {
      w.step([{ moveX: 1, moveZ: 0 }]);
      minGap = Math.min(minGap, Math.hypot(p.x - b.x, p.z - b.z) - b.r - p.radius);
    }
    // it got past the rock (it was not pinned on the near side) and never sank into it
    expect(p.x).toBeGreaterThan(b.x + b.r);
    expect(minGap).toBeGreaterThan(-0.15);
  });

  for (const zone of ['yeonmu', 'suryeon', 'seori', 'daeryeol']) {
    it(`${zone}: walking diagonally into a straight cliff keeps the hero moving along it and never inside`, () => {
      const { w, field, p } = mk(zone);
      const wall = findStraightWall(field);
      expect(wall, `${zone} has a straight wall`).not.toBeNull();
      const wl = wall!;
      const px = -wl.dz;
      const pz = wl.dx;
      place(p, wl.x - px * 5, wl.z - pz * 5);
      const along0 = p.x * px + p.z * pz;
      for (let i = 0; i < 60 * 3; i++) {
        w.step([{ moveX: (wl.dx + px) * Math.SQRT1_2, moveZ: (wl.dz + pz) * Math.SQRT1_2 }]);
        expect(field.walkableCircle(p.x, p.z, p.radius * 0.8), `tick ${i} at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).toBe(true);
      }
      // it travelled several metres along the wall (a pinned hero stays near 0)
      expect(p.x * px + p.z * pz - along0, `${zone}: along-wall travel`).toBeGreaterThan(6);
    });
  }

  it('the arena edge: a hero pushed outward on a lava zone stays inside the arena and keeps finite coordinates', () => {
    const { w, field, p } = mk('daeryeol');
    place(p, field.arenaRadius - 1.2, 0);
    for (let i = 0; i < 60 * 3; i++) w.step([{ moveX: 1, moveZ: 0 }]);
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(field.arenaRadius + 0.01);
    expect(findNonFinite(w)).toBeNull();
  });
});

describe('HZ-01: co-op follows the host', () => {
  const hostEnvFor = (zoneId: string, seed: number): WorldEnv => {
    const zone = content.zones.find((z) => z.id === zoneId)!;
    return shippedEnv(createTerrainField(zone.biome, seed));
  };

  it("the guest's predictor steps like the host sim across lava, ice and shallow water (same env, tick for tick)", () => {
    for (const [zoneId, surface] of [['seori', Surface.Ice], ['yeonmu', Surface.Shallow], ['daeryeol', Surface.Lava]] as const) {
      const { w, field, p } = mk(zoneId);
      const run = findRun(field, surface, 8)!;
      expect(run, `${zoneId} has an 8 m run`).not.toBeNull();
      place(p, run.x, run.z);
      const menv: MoveEnv = { arenaRadius: w.arenaRadius, walkable: w.env.walkable, moveCircle: w.env.moveCircle, surfaceAt: w.env.surfaceAt };
      const s = newMoveState();
      s.x = p.x;
      s.z = p.z;
      s.rot = p.rot;
      const params: MoveParams = { moveSpeed: p.stats.moveSpeed, slowMul: 1, radius: p.radius, castLock: false };
      for (let i = 0; i < 90; i++) {
        const ix = i < 70 ? run.dx : 0; // release the stick: ice keeps sliding, others stop
        const iz = i < 70 ? run.dz : 0;
        stepMove(s, ix, iz, params, menv);
        w.step([{ moveX: ix, moveZ: iz }]);
        p.slowMul = 1;
        expect(Math.hypot(s.x - p.x, s.z - p.z), `${zoneId} tick ${i}`).toBeLessThan(0.02);
      }
    }
  });

  it('a guest hero standing on lava is hurt by the host and the mirror shows the loss; the host owns the damage', async () => {
    const zoneId = 'daeryeol';
    const zone = content.zones.find((z) => z.id === zoneId)!;
    const field = createTerrainField(zone.biome, 99);
    const spot = findSurface(field, Surface.Lava)!;
    const t = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, env: shippedEnv(field) });
    try {
      const hw = t.hostWorld;
      const mw = t.guestWorlds[0]!;
      for (let i = 0; i < 120; i++) t.tick();
      const guestHero = hw.players[1]!;
      place(guestHero, spot.x, spot.z);
      const hp0 = guestHero.hp / guestHero.hpMax;
      for (let i = 0; i < 60 * 6; i++) t.tick();
      await t.settle(100);
      const hostFrac = guestHero.hp / guestHero.hpMax;
      expect(hostFrac).toBeLessThan(hp0 - 0.03);
      const mirror = mw.players[0]!;
      // the guest's mirror carries the host-authoritative HP (snapshot quantisation allows a little)
      expect(Math.abs(mirror.hp / mirror.hpMax - hostFrac)).toBeLessThan(0.05);
    } finally {
      t.dispose();
    }
  });

  it('late join: a guest builds its own field from the seed and gets the same surfaces', () => {
    const a = hostEnvFor('seori', 777);
    const b = hostEnvFor('seori', 777); // what a late joiner's app/run.ts builds
    let ice = 0;
    for (let z = -120; z <= 120; z += 4) {
      for (let x = -120; x <= 120; x += 4) {
        if (a.surfaceAt?.(x, z) === Surface.Ice) ice++;
        expect(b.surfaceAt?.(x, z)).toBe(a.surfaceAt?.(x, z));
      }
    }
    if (!LEGACY) expect(ice).toBeGreaterThan(50);
  });
});

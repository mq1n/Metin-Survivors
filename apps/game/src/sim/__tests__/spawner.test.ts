// Spawner: band ramping, alive cap, ring placement, packs, elites, relocation, difficulty/time scaling, bosses.

import { describe, expect, it } from 'vitest';
import type { ContentDB, TimeBand, ZoneDef } from '../../data/schema';
import { cloneContent, fixtureConfig } from '../__fixtures__/content';
import { fixtureZone } from '../__fixtures__/zone';
import { killEnemy } from '../combat';
import { CAP, DT, ENEMY_SOFT_CAP, RELOCATE_DIST, SPAWN_RING_MAX, SPAWN_RING_MIN } from '../constants';
import { sweepDead } from '../enemies';
import type { CoopPlayerInit, RunConfig } from '../run';
import { bandAt, rampAt } from '../spawner';
import { EnemyFlag } from '../stores';
import { createWorld, type World } from '../world';
import { clearEnemies, findNonFinite, freezeEnemies, freezeSchedules, makeWorld, NO_INPUT, player, runTicks, spawn, typeOf } from './helpers';

// ---------------------------------------------------------------------------
// helpers

const BANDS = fixtureZone.bands;

function zoneOf(c: ContentDB): ZoneDef {
  return c.zones[0] as ZoneDef;
}

/** only the regular band spawner runs: no metin falls, no scheduled boss, no elites */
function onlyBands(w: World): void {
  freezeSchedules(w);
  w.spawner.acc = 0.5;
}

interface Born {
  tick: number;
  time: number;
  enemy: number;
  type: number;
  x: number;
  z: number;
  tier: number;
  source: number;
  hpMax: number;
  dmgMul: number;
  flags: number;
  hpScale: number;
  dmgScale: number;
}

/** step `ticks` ticks (enemies optionally frozen in place) and record every enemySpawn together with the new row's stats */
function runSpawning(w: World, ticks: number, freeze = true): Born[] {
  const out: Born[] = [];
  for (let i = 0; i < ticks; i++) {
    if (freeze) freezeEnemies(w);
    w.step([NO_INPUT]);
    for (const e of w.events) {
      if (e.t !== 'enemySpawn') continue;
      const row = w.enemies.find(e.enemy);
      out.push({
        tick: w.tick,
        time: w.time,
        enemy: e.enemy,
        type: e.type,
        x: e.x,
        z: e.z,
        tier: e.tier,
        source: e.source,
        hpMax: row >= 0 ? (w.enemies.hpMax[row] as number) : NaN,
        dmgMul: row >= 0 ? (w.enemies.dmgMul[row] as number) : NaN,
        flags: row >= 0 ? (w.enemies.flags[row] as number) : 0,
        hpScale: w.hpScale(),
        dmgScale: w.dmgScale(),
      });
    }
  }
  return out;
}

/** expected enemies born in [t0, t1] by integrating the ramped band rate (× multiplier) */
function expectedBirths(t0: number, t1: number, mult = 1): number {
  let sum = 0;
  const h = 0.01;
  for (let t = t0; t < t1; t += h) sum += rampAt(BANDS, t).rate * h * mult;
  return sum;
}

function dist(x: number, z: number, cx = 0, cz = 0): number {
  return Math.hypot(x - cx, z - cz);
}

/** every band: constant rate / maxAlive, single wolves only (so counts are exact) */
function flatBands(rate: number, maxAlive: number, singles = true): (c: ContentDB) => void {
  return (c) => {
    for (const b of zoneOf(c).bands) {
      b.rate = rate;
      b.maxAlive = maxAlive;
      if (singles) b.spawns = [{ enemy: 'wolf', weight: 1 }];
    }
  };
}

function singleWolves(c: ContentDB): void {
  for (const b of zoneOf(c).bands) b.spawns = [{ enemy: 'wolf', weight: 1 }];
}

// ---------------------------------------------------------------------------
// bandAt / rampAt

describe('bandAt', () => {
  it('picks the last band whose `from` has been reached, with the progress fraction through that band', () => {
    const a = bandAt(BANDS, 0);
    expect(a.band.from).toBe(0);
    expect(a.next?.from).toBe(120);
    expect(a.f).toBe(0);

    const b = bandAt(BANDS, 60);
    expect(b.band.from).toBe(0);
    expect(b.f).toBeCloseTo(0.5, 9);

    const c = bandAt(BANDS, 119.999);
    expect(c.band.from).toBe(0);
    expect(c.f).toBeCloseTo(1, 4);

    const d = bandAt(BANDS, 120);
    expect(d.band.from).toBe(120);
    expect(d.next?.from).toBe(300);
    expect(d.f).toBe(0);

    const e = bandAt(BANDS, 210);
    expect(e.band.from).toBe(120);
    expect(e.f).toBeCloseTo(0.5, 9);
  });

  it('the last band has no next band and its fraction clamps to 1 past its end', () => {
    const inside = bandAt(BANDS, 840);
    expect(inside.band.from).toBe(780);
    expect(inside.next).toBeUndefined();
    expect(inside.f).toBeCloseTo(0.5, 9);
    const past = bandAt(BANDS, 5000);
    expect(past.band.from).toBe(780);
    expect(past.next).toBeUndefined();
    expect(past.f).toBe(1);
  });

  it('clamps before the first band and treats degenerate (< 1 s) bands as one second long', () => {
    const before = bandAt(BANDS, -30);
    expect(before.band.from).toBe(0);
    expect(before.f).toBe(0);
    const tiny: TimeBand[] = [
      { from: 10, to: 10, rate: 1, maxAlive: 1, spawns: [] },
      { from: 10.5, to: 20, rate: 2, maxAlive: 2, spawns: [] },
    ];
    expect(bandAt(tiny, 10).f).toBe(0);
    expect(bandAt(tiny, 10.4).f).toBeCloseTo(0.4, 9);
    expect(bandAt(tiny, 10.4).band.rate).toBe(1);
    expect(bandAt(tiny, 10.5).band.rate).toBe(2);
  });
});

describe('rampAt', () => {
  it('interpolates rate and maxAlive linearly toward the next band across the band span', () => {
    const table: [number, number, number][] = [
      [0, 2.2, 70],
      [60, 3.1, 105],
      [120, 4, 140],
      [210, 5.25, 200],
      [300, 6.5, 260],
      [420, 7.75, 330],
      [540, 9, 400],
      [660, 10.5, 460],
      [780, 12, 520],
    ];
    for (const [t, rate, maxAlive] of table) {
      const r = rampAt(BANDS, t);
      expect(r.rate, `rate @${t}`).toBeCloseTo(rate, 9);
      expect(r.maxAlive, `maxAlive @${t}`).toBeCloseTo(maxAlive, 9);
    }
  });

  it('holds the last band flat (no next band to ramp toward)', () => {
    for (const t of [780, 840, 899.9, 900, 2000]) {
      expect(rampAt(BANDS, t)).toEqual({ rate: 12, maxAlive: 520 });
    }
  });

  it('is continuous across band boundaries and never decreases over the fixture run', () => {
    for (const boundary of [120, 300, 540, 780]) {
      const before = rampAt(BANDS, boundary - 1e-6);
      const at = rampAt(BANDS, boundary);
      expect(before.rate).toBeCloseTo(at.rate, 4);
      expect(before.maxAlive).toBeCloseTo(at.maxAlive, 3);
    }
    let prev = rampAt(BANDS, 0);
    for (let t = 1; t <= 900; t++) {
      const cur = rampAt(BANDS, t);
      expect(cur.rate).toBeGreaterThanOrEqual(prev.rate - 1e-9);
      expect(cur.maxAlive).toBeGreaterThanOrEqual(prev.maxAlive - 1e-9);
      prev = cur;
    }
  });
});

describe('createSpawner', () => {
  it('starts with a half-enemy credit, the first elite at 40 s and no boss spawned yet', () => {
    const w = makeWorld();
    expect(w.spawner.acc).toBe(0.5);
    expect(w.spawner.eliteT).toBe(40);
    expect(w.spawner.nextBoss).toBe(0);
    expect(w.spawner.alive).toBe(0);
  });

  it('sorts private copies of the bands and the boss schedule without touching the ContentDB', () => {
    const w = makeWorld({
      content: (c) => {
        const z = zoneOf(c);
        z.bands.reverse();
        z.bosses.reverse();
      },
    });
    expect(w.spawner.bands.map((b) => b.from)).toEqual([0, 120, 300, 540, 780]);
    expect(w.spawner.bosses.map((b) => b.at)).toEqual([180, 480]);
    expect(zoneOf(w.content).bands.map((b) => b.from)).toEqual([780, 540, 300, 120, 0]);
    expect(zoneOf(w.content).bosses.map((b) => b.at)).toEqual([480, 180]);
    expect(w.spawner.bands).not.toBe(zoneOf(w.content).bands);
  });
});

// ---------------------------------------------------------------------------
// spawn flow

describe('spawn rate', () => {
  it('delivers the first enemy once the 0.5 credit plus rate × dt reaches 1 (~14 ticks at 2.2/s)', () => {
    const w = makeWorld({ content: singleWolves });
    onlyBands(w);
    const born = runSpawning(w, 40);
    expect(born.length).toBeGreaterThan(0);
    const first = born[0] as Born;
    expect(first.tick).toBeGreaterThanOrEqual(13);
    expect(first.tick).toBeLessThanOrEqual(15);
    expect(first.source).toBe(0);
    expect(first.tier).toBe(0);
  });

  it('births over 30 s track the integral of the ramped rate (packs borrow from the same credit)', () => {
    const w = makeWorld({ config: { seed: 4242 } });
    onlyBands(w);
    const born = runSpawning(w, 30 * 60);
    const expected = 0.5 + expectedBirths(0, 30);
    // the credit left over at the end lies in (-13, 3): the largest pack takes 14 at once
    expect(born.length).toBeGreaterThan(expected - 4);
    expect(born.length).toBeLessThan(expected + 14);
    expect(w.spawner.alive).toBe(born.length);
  });

  it('keeps spawning at the ramped rate later in the run (windows at 100 s and 540 s)', () => {
    for (const [start, seed] of [[100, 11], [540, 12]] as const) {
      const w = makeWorld({ config: { seed } });
      onlyBands(w);
      w.time = start;
      const born = runSpawning(w, 10 * 60);
      const expected = 0.5 + expectedBirths(start, start + 10);
      expect(born.length, `window @${start}`).toBeGreaterThan(expected - 4);
      expect(born.length, `window @${start}`).toBeLessThan(expected + 15);
    }
  });

  it('single-enemy tables give exact per-second counts (no pack overshoot)', () => {
    const w = makeWorld({ content: flatBands(6, 1000), config: { seed: 3 } });
    onlyBands(w);
    const born = runSpawning(w, 20 * 60);
    expect(born.length).toBeGreaterThanOrEqual(0.5 + 6 * 20 - 1);
    expect(born.length).toBeLessThanOrEqual(0.5 + 6 * 20 + 1);
  });

  it('a later band spawns faster than an earlier one', () => {
    const count = (start: number): number => {
      const w = makeWorld({ content: singleWolves, config: { seed: 21 } });
      onlyBands(w);
      w.time = start;
      return runSpawning(w, 600).length;
    };
    const early = count(0);
    const mid = count(300);
    const late = count(780);
    expect(mid).toBeGreaterThan(early * 2);
    expect(late).toBeGreaterThan(mid);
  });

  it('hard mode multiplies the spawn count by hard.count (1.25)', () => {
    const born = (difficulty: 'normal' | 'hard'): number => {
      const w = makeWorld({ content: singleWolves, config: { difficulty, seed: 9 } });
      onlyBands(w);
      return runSpawning(w, 20 * 60).length;
    };
    const normal = born('normal');
    const hard = born('hard');
    expect(normal).toBeGreaterThanOrEqual(0.5 + expectedBirths(0, 20) - 1);
    expect(normal).toBeLessThanOrEqual(0.5 + expectedBirths(0, 20) + 1);
    expect(hard).toBeGreaterThanOrEqual(0.5 + expectedBirths(0, 20, 1.25) - 1);
    expect(hard).toBeLessThanOrEqual(0.5 + expectedBirths(0, 20, 1.25) + 1);
    expect(hard / normal).toBeGreaterThan(1.15);
    expect(hard / normal).toBeLessThan(1.35);
  });

  it('corruption raises the spawn rate by 1 + 0.6 × corruption', () => {
    const born = (corruption: number): number => {
      const w = makeWorld({ content: singleWolves, config: { seed: 9 } });
      onlyBands(w);
      w.corruption = corruption;
      return runSpawning(w, 10 * 60).length;
    };
    const calm = born(0);
    const corrupt = born(1);
    // corruption decays slowly while no metin stands (0.004 / s): the mean multiplier over 10 s is ~1.59
    expect(corrupt / calm).toBeGreaterThan(1.45);
    expect(corrupt / calm).toBeLessThan(1.65);
  });

  it('spawns nothing while every player is dead', () => {
    const w = makeWorld();
    onlyBands(w);
    player(w).alive = false;
    expect(runSpawning(w, 300, false)).toHaveLength(0);
    expect(w.spawner.alive).toBe(0);
  });

  it('band spawns are marked source 0 (single) / 1 (pack); both are announced with enemySpawn events', () => {
    const w = makeWorld({ config: { seed: 31 } });
    onlyBands(w);
    const born = runSpawning(w, 30 * 60);
    const sources = new Set(born.map((b) => b.source));
    expect(sources.has(0)).toBe(true);
    expect(sources.has(1)).toBe(true);
    expect([...sources].every((s) => s === 0 || s === 1)).toBe(true);
  });

  it('the alive counter matches the live creature rows through kills and sweeps', () => {
    const w = makeWorld();
    freezeSchedules(w);
    for (let i = 0; i < 10; i++) spawn(w, 'wolf', 20 + i, 0);
    expect(w.aliveEnemies()).toBe(10);
    killEnemy(w, 2, 0, -1, false);
    killEnemy(w, 5, 0, -1, false);
    expect(w.aliveEnemies()).toBe(8); // dying rows are no longer counted
    sweepDead(w);
    expect(w.enemies.count).toBe(8);
    expect(w.aliveEnemies()).toBe(8);
    clearEnemies(w);
    expect(w.aliveEnemies()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// alive cap

describe('alive cap', () => {
  function maxAliveOver(w: World, ticks: number): number {
    let max = 0;
    for (let i = 0; i < ticks; i++) {
      freezeEnemies(w);
      w.step([NO_INPUT]);
      max = Math.max(max, w.spawner.alive);
    }
    return max;
  }

  it('alive never exceeds the band maxAlive and reaches it (normal difficulty)', () => {
    const w = makeWorld({ content: flatBands(10, 20) });
    onlyBands(w);
    expect(maxAliveOver(w, 600)).toBe(20);
    expect(w.spawner.alive).toBe(20);
    expect(w.enemies.count).toBe(20);
  });

  it('hard mode scales the cap by hard.count', () => {
    const w = makeWorld({ content: flatBands(10, 20), config: { difficulty: 'hard' } });
    onlyBands(w);
    expect(maxAliveOver(w, 600)).toBe(25); // round(20 × 1.25)
  });

  it('corruption raises the cap by 15% per full corruption', () => {
    const w = makeWorld({ content: flatBands(10, 20) });
    onlyBands(w);
    w.corruption = 1;
    expect(maxAliveOver(w, 400)).toBe(23); // round(20 × 1.15)
  });

  it('follows the ramped maxAlive between bands', () => {
    const w = makeWorld({
      content: (c) => {
        const z = zoneOf(c);
        singleWolves(c);
        z.bands.forEach((b, i) => {
          b.rate = 40;
          b.maxAlive = 20 * (i + 1);
        });
      },
    });
    onlyBands(w);
    w.time = 60; // halfway through band 0 → cap ≈ 30
    runSpawning(w, 300);
    const cap = Math.round(rampAt(w.spawner.bands, w.time).maxAlive);
    expect(cap).toBeGreaterThanOrEqual(30);
    expect(w.spawner.alive).toBeGreaterThanOrEqual(cap - 1);
    expect(w.spawner.alive).toBeLessThanOrEqual(cap);
  });

  it('is capped at 600 enemies however large maxAlive and difficulty are', () => {
    for (const difficulty of ['normal', 'hard'] as const) {
      const w = makeWorld({ content: flatBands(400, 5000), config: { difficulty } });
      onlyBands(w);
      expect(maxAliveOver(w, 300), difficulty).toBe(ENEMY_SOFT_CAP);
      expect(w.enemies.count).toBe(ENEMY_SOFT_CAP);
    }
  });

  it('packs may overshoot the cap by at most one pack, but no spawn starts once alive ≥ cap', () => {
    const w = makeWorld({
      content: (c) => {
        for (const b of zoneOf(c).bands) {
          b.rate = 12;
          b.maxAlive = 30;
          b.spawns = [{ enemy: 'jackal', weight: 1, group: { members: ['jackal'], size: [8, 14] } }];
        }
      },
    });
    onlyBands(w);
    let max = 0;
    for (let i = 0; i < 900; i++) {
      freezeEnemies(w);
      const before = w.spawner.alive;
      w.step([NO_INPUT]);
      const spawned = w.events.some((e) => e.t === 'enemySpawn');
      if (spawned) expect(before, `spawn began at alive ${before}`).toBeLessThan(30);
      max = Math.max(max, w.spawner.alive);
    }
    expect(max).toBeGreaterThanOrEqual(30);
    expect(max).toBeLessThanOrEqual(30 + 13);
    expect(w.enemies.count).toBeLessThanOrEqual(CAP.enemies);
  });
});

// ---------------------------------------------------------------------------
// ring placement

describe('ring placement', () => {
  it('single enemies spawn 31–38 m from the hero, all around', () => {
    const w = makeWorld({ content: flatBands(20, 400) });
    onlyBands(w);
    const born = runSpawning(w, 600);
    expect(born.length).toBeGreaterThan(150);
    let minD = Infinity;
    let maxD = 0;
    const quadrants = new Set<string>();
    for (const b of born) {
      const d = dist(b.x, b.z);
      expect(d).toBeGreaterThanOrEqual(SPAWN_RING_MIN - 1e-6);
      expect(d).toBeLessThanOrEqual(SPAWN_RING_MAX + 1e-6);
      minD = Math.min(minD, d);
      maxD = Math.max(maxD, d);
      quadrants.add(`${Math.sign(b.x)}${Math.sign(b.z)}`);
    }
    expect(minD).toBeLessThan(SPAWN_RING_MIN + 1.5);
    expect(maxD).toBeGreaterThan(SPAWN_RING_MAX - 1.5);
    expect(quadrants.size).toBe(4);
  });

  it('the ring follows the hero when it walks away from the origin', () => {
    const w = makeWorld({ content: flatBands(20, 400) });
    onlyBands(w);
    const p = player(w);
    p.x = -50;
    p.z = 40;
    const born = runSpawning(w, 300);
    expect(born.length).toBeGreaterThan(50);
    for (const b of born) {
      const d = dist(b.x, b.z, p.x, p.z);
      expect(d).toBeGreaterThanOrEqual(SPAWN_RING_MIN - 1e-6);
      expect(d).toBeLessThanOrEqual(SPAWN_RING_MAX + 1e-6);
    }
  });

  it('co-op: every spawn is centred on one of the living heroes and both get their share', () => {
    const coop: CoopPlayerInit = { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', meta: { stats: {} } };
    const w = makeWorld({ content: flatBands(20, 400), config: { coop: [coop] } });
    onlyBands(w);
    const p0 = player(w, 0);
    const p1 = player(w, 1);
    p0.x = 60;
    p0.z = 0;
    p1.x = -40;
    p1.z = 0;
    const born = runSpawning(w, 240);
    expect(born.length).toBeGreaterThan(40);
    let near0 = 0;
    let near1 = 0;
    for (const b of born) {
      const d0 = dist(b.x, b.z, p0.x, p0.z);
      const d1 = dist(b.x, b.z, p1.x, p1.z);
      const on0 = d0 >= SPAWN_RING_MIN - 1e-6 && d0 <= SPAWN_RING_MAX + 1e-6;
      const on1 = d1 >= SPAWN_RING_MIN - 1e-6 && d1 <= SPAWN_RING_MAX + 1e-6;
      expect(on0 || on1).toBe(true);
      if (on0) near0++;
      if (on1) near1++;
    }
    expect(near0).toBeGreaterThan(born.length * 0.25);
    expect(near1).toBeGreaterThan(born.length * 0.25);
  });

  it('never spawns outside the arena, even with the hero at its edge', () => {
    const w = makeWorld({ content: flatBands(20, 400) });
    onlyBands(w);
    const p = player(w);
    p.x = 135;
    p.z = 0;
    const born = runSpawning(w, 300);
    expect(born.length).toBeGreaterThan(50);
    const limit = w.arenaRadius - 1.5;
    for (const b of born) expect(dist(b.x, b.z)).toBeLessThanOrEqual(limit + 1e-6);
    const onRing = born.filter((b) => {
      const d = dist(b.x, b.z, p.x, p.z);
      return d >= SPAWN_RING_MIN - 1e-6 && d <= SPAWN_RING_MAX + 1e-6;
    });
    expect(onRing.length / born.length).toBeGreaterThan(0.95);
  });

  it('respects the walkable hook of the environment', () => {
    const content = cloneContent();
    flatBands(20, 400)(content);
    const w = createWorld(fixtureConfig(), content, undefined, { walkable: (_x, z) => z >= 0 });
    onlyBands(w);
    const born = runSpawning(w, 300);
    expect(born.length).toBeGreaterThan(50);
    let ring = 0;
    for (const b of born) {
      expect(b.z).toBeGreaterThanOrEqual(0);
      const d = dist(b.x, b.z);
      if (d >= SPAWN_RING_MIN - 1e-6 && d <= SPAWN_RING_MAX + 1e-6) ring++;
    }
    expect(ring / born.length).toBeGreaterThan(0.95);
  });
});

// ---------------------------------------------------------------------------
// packs

describe('packs', () => {
  function packWorld(group: NonNullable<TimeBand['spawns'][number]['group']>, enemy = 'wolf', seed = 77): World {
    const w = makeWorld({
      config: { seed },
      content: (c) => {
        for (const b of zoneOf(c).bands) b.spawns = [{ enemy, weight: 1, group }];
      },
    });
    onlyBands(w);
    return w;
  }

  function byTick(born: Born[]): Born[][] {
    const groups = new Map<number, Born[]>();
    for (const b of born) groups.set(b.tick, [...(groups.get(b.tick) ?? []), b]);
    return [...groups.values()];
  }

  it('a pack spawns a tier-2 leader (source 1) plus `size` members in the configured range', () => {
    const w = packWorld({ leader: 'alpha_wolf', members: ['wolf'], size: [4, 7] });
    const born = runSpawning(w, 40 * 60);
    const packs = byTick(born);
    expect(packs.length).toBeGreaterThanOrEqual(8);
    const sizes = new Set<number>();
    const wolf = typeOf(w, 'wolf');
    const alpha = typeOf(w, 'alpha_wolf');
    for (const pack of packs) {
      const [leader, ...members] = pack as [Born, ...Born[]];
      expect(leader.tier).toBe(2);
      expect(leader.type).toBe(alpha);
      expect(leader.source).toBe(1);
      expect(members.length).toBeGreaterThanOrEqual(4);
      expect(members.length).toBeLessThanOrEqual(7);
      sizes.add(members.length);
      for (const m of members) {
        expect(m.tier).toBe(0);
        expect(m.type).toBe(wolf);
        expect(m.source).toBe(1);
        // members scatter 1–3.5 m around the leader
        const d = dist(m.x, m.z, leader.x, leader.z);
        expect(d).toBeGreaterThanOrEqual(1 - 1e-6);
        expect(d).toBeLessThanOrEqual(3.5 + 1e-6);
      }
      // the leader itself sits on the spawn ring
      expect(dist(leader.x, leader.z)).toBeGreaterThanOrEqual(SPAWN_RING_MIN - 1e-6);
      expect(dist(leader.x, leader.z)).toBeLessThanOrEqual(SPAWN_RING_MAX + 1e-6);
    }
    expect(sizes.size).toBeGreaterThanOrEqual(2);
  });

  it('pack leaders are tougher: hp × 2.2, damage × 1.15 (on top of time/difficulty scaling)', () => {
    const w = packWorld({ leader: 'alpha_wolf', members: ['wolf'], size: [4, 7] });
    const born = runSpawning(w, 30 * 60);
    const alphaHp = w.content.enemies.find((e) => e.id === 'alpha_wolf')?.hp ?? 0;
    const wolfHp = w.content.enemies.find((e) => e.id === 'wolf')?.hp ?? 0;
    let leaders = 0;
    for (const b of born) {
      if (b.tier === 2) {
        leaders++;
        expect(b.hpMax).toBeCloseTo(alphaHp * b.hpScale * 2.2, 3);
        expect(b.dmgMul).toBeCloseTo(b.dmgScale * 1.15, 4);
      } else {
        expect(b.hpMax).toBeCloseTo(wolfHp * b.hpScale, 3);
        expect(b.dmgMul).toBeCloseTo(b.dmgScale, 4);
      }
    }
    expect(leaders).toBeGreaterThanOrEqual(5);
  });

  it('a leaderless pack is made of members only, all within the size range, scattered around one spawn point', () => {
    const w = packWorld({ members: ['jackal'], size: [8, 14] }, 'jackal');
    const born = runSpawning(w, 40 * 60);
    const packs = byTick(born);
    expect(packs.length).toBeGreaterThanOrEqual(3);
    const jackal = typeOf(w, 'jackal');
    for (const pack of packs) {
      expect(pack.length).toBeGreaterThanOrEqual(8);
      expect(pack.length).toBeLessThanOrEqual(14);
      for (const b of pack) {
        expect(b.tier).toBe(0);
        expect(b.type).toBe(jackal);
        expect(b.source).toBe(1);
        // centre on the ring ± the 3.5 m scatter
        expect(dist(b.x, b.z)).toBeGreaterThanOrEqual(SPAWN_RING_MIN - 3.5 - 1e-6);
        expect(dist(b.x, b.z)).toBeLessThanOrEqual(SPAWN_RING_MAX + 3.5 + 1e-6);
      }
      // all members of one pack stay within ~7 m of each other
      const first = pack[0] as Born;
      for (const b of pack) expect(dist(b.x, b.z, first.x, first.z)).toBeLessThanOrEqual(7 + 1e-6);
    }
  });

  it('members are drawn from the member list; an empty list falls back to the entry enemy', () => {
    const mixed = packWorld({ members: ['wolf', 'jackal'], size: [6, 6] }, 'fox');
    const types = new Set(runSpawning(mixed, 30 * 60).map((b) => b.type));
    expect([...types].sort()).toEqual([typeOf(mixed, 'wolf'), typeOf(mixed, 'jackal')].sort());

    const fallback = packWorld({ members: [], size: [3, 3] }, 'fox');
    const born = runSpawning(fallback, 20 * 60);
    const fox = typeOf(fallback, 'fox');
    expect(born.length).toBeGreaterThan(0);
    for (const b of born) expect(b.type).toBe(fox);
    for (const pack of byTick(born)) expect(pack).toHaveLength(3);
  });

  it('a pack draws its whole size from the spawn credit', () => {
    const w = packWorld({ members: ['wolf'], size: [10, 10] });
    const born = runSpawning(w, 30 * 60);
    // 0.5 + ∫ rate over 30 s, in units of ten-enemy packs
    const expected = 0.5 + expectedBirths(0, 30);
    expect(born.length % 10).toBe(0);
    expect(born.length).toBeGreaterThan(expected - 4);
    expect(born.length).toBeLessThan(expected + 10);
  });
});

// ---------------------------------------------------------------------------
// elites

describe('elites', () => {
  /** world at time `t` whose regular spawns are parked; the elite timer is armed for the first tick */
  function eliteWorld(t: number, seed = 5): World {
    const w = makeWorld({ config: { seed } });
    freezeSchedules(w);
    w.time = t;
    w.spawner.eliteT = 0.01;
    return w;
  }

  it('spawns an elite (tier 1, source 5, Elite flag, hp × 3, damage × 1.3) from the band pool', () => {
    const w = eliteWorld(130);
    const born = runSpawning(w, 3).filter((b) => b.source === 5);
    expect(born).toHaveLength(1);
    const e = born[0] as Born;
    expect(e.tier).toBe(1);
    expect(e.type).toBe(typeOf(w, 'alpha_wolf'));
    expect(e.flags & EnemyFlag.Elite).toBe(EnemyFlag.Elite);
    const hp = w.content.enemies.find((d) => d.id === 'alpha_wolf')?.hp ?? 0;
    expect(e.hpMax).toBeCloseTo(hp * e.hpScale * 3, 2);
    expect(e.dmgMul).toBeCloseTo(e.dmgScale * 1.3, 4);
    const d = dist(e.x, e.z);
    expect(d).toBeGreaterThanOrEqual(SPAWN_RING_MIN - 1e-6);
    expect(d).toBeLessThanOrEqual(SPAWN_RING_MAX + 1e-6);
  });

  it('repeats every `every` seconds of the current band (60 s in band 1)', () => {
    const w = eliteWorld(130);
    const born = runSpawning(w, 3700).filter((b) => b.source === 5);
    expect(born).toHaveLength(2);
    const gap = ((born[1] as Born).tick - (born[0] as Born).tick) / 60;
    expect(gap).toBeGreaterThan(59.9);
    expect(gap).toBeLessThan(60.1);
  });

  it('uses the band-specific cadence (50 s in band 2) and its larger pool', () => {
    const w = eliteWorld(310);
    const types = new Set<number>();
    for (let i = 0; i < 40; i++) {
      w.spawner.eliteT = 0.01;
      for (const b of runSpawning(w, 2)) if (b.source === 5) types.add(b.type);
      expect(w.spawner.eliteT).toBeCloseTo(50, 1);
    }
    expect([...types].sort()).toEqual([typeOf(w, 'alpha_wolf'), typeOf(w, 'elder_bear')].sort());
  });

  it('corruption shortens the interval to every / (1 + 0.3 × corruption)', () => {
    const calm = eliteWorld(130);
    runSpawning(calm, 2);
    expect(calm.spawner.eliteT).toBeCloseTo(60, 1);
    const corrupt = eliteWorld(130);
    corrupt.corruption = 1;
    runSpawning(corrupt, 2);
    expect(corrupt.spawner.eliteT).toBeCloseTo(60 / 1.3, 1);
  });

  it('bands without an elite pool spawn none and re-check every 5 s; the first band that has one starts the cadence', () => {
    const w = eliteWorld(100);
    const born = runSpawning(w, 25 * 60).filter((b) => b.source === 5);
    expect(born.length).toBeGreaterThanOrEqual(1);
    const first = born[0] as Born;
    expect(first.time).toBeGreaterThanOrEqual(120);
    expect(first.time).toBeLessThanOrEqual(125.2);
    const stillBand0 = eliteWorld(100);
    expect(runSpawning(stillBand0, 1)).toHaveLength(0);
    expect(stillBand0.spawner.eliteT).toBe(5);
  });

  it('an empty elite pool spawns nothing and retries in 5 s', () => {
    const w = makeWorld({
      content: (c) => {
        for (const b of zoneOf(c).bands) b.elites = { every: 60, pool: [] };
      },
    });
    freezeSchedules(w);
    w.time = 130;
    w.spawner.eliteT = 0.01;
    expect(runSpawning(w, 2).filter((b) => b.source === 5)).toHaveLength(0);
    expect(w.spawner.eliteT).toBeCloseTo(5, 1);
  });

  it('is held back while the field is saturated (alive ≥ soft cap + 20), then retried in 5 s', () => {
    const w = eliteWorld(130);
    w.spawner.alive = ENEMY_SOFT_CAP + 20;
    expect(runSpawning(w, 2).filter((b) => b.source === 5)).toHaveLength(0);
    expect(w.spawner.eliteT).toBeCloseTo(5, 1);
    w.spawner.alive = ENEMY_SOFT_CAP + 19;
    w.spawner.eliteT = 0.01;
    expect(runSpawning(w, 2).filter((b) => b.source === 5)).toHaveLength(1);
  });

  it('the first elite of a run comes no earlier than the first band that defines a pool (none in the opening 120 s)', () => {
    const w = makeWorld({ config: { seed: 17, meta: { stats: { maxHp: 1e6 } } } });
    w.spawner.acc = -1e9; // no regular spawns, but the default 40 s elite timer
    w.metinSys.nextFallAt = 1e9;
    w.metinSys.finalStarted = true;
    w.spawner.nextBoss = w.spawner.bosses.length;
    const born = runSpawning(w, 130 * 60).filter((b) => b.source === 5);
    expect(born.length).toBeGreaterThanOrEqual(1);
    expect((born[0] as Born).time).toBeGreaterThanOrEqual(120);
  });
});

// ---------------------------------------------------------------------------
// relocation of far enemies

describe('relocation', () => {
  function stepUntilMoved(w: World, handle: number, maxTicks: number): number {
    const x0 = w.enemies.x[w.enemies.find(handle)] as number;
    for (let i = 1; i <= maxTicks; i++) {
      freezeEnemies(w);
      w.step([NO_INPUT]);
      const row = w.enemies.find(handle);
      if (row < 0) return -1;
      if (Math.abs((w.enemies.x[row] as number) - x0) > 5) return i;
    }
    return 0;
  }

  it('enemies farther than 58 m from every hero are moved to the 31–38 m ring within 20 ticks', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const row = spawn(w, 'wolf', 70, 0);
    const handle = w.enemies.id[row] as number;
    freezeEnemies(w);
    const ticks = stepUntilMoved(w, handle, 25);
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThanOrEqual(20);
    const r = w.enemies.find(handle);
    expect(r).toBeGreaterThanOrEqual(0);
    const x = w.enemies.x[r] as number;
    const z = w.enemies.z[r] as number;
    expect(dist(x, z)).toBeGreaterThanOrEqual(SPAWN_RING_MIN - 1e-3);
    expect(dist(x, z)).toBeLessThanOrEqual(SPAWN_RING_MAX + 1e-3);
    // relocation is a teleport: the render interpolation start point follows
    expect(w.enemies.px[r]).toBeCloseTo(x, 3);
    expect(w.enemies.pz[r]).toBeCloseTo(z, 3);
    // the enemy keeps its identity and the alive counter does not change
    expect(w.aliveEnemies()).toBe(1);
  });

  it('every enemy beyond RELOCATE_DIST is relocated; enemies inside it stay put', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const far: number[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      far.push(w.enemies.id[spawn(w, 'wolf', Math.sin(a) * 75, Math.cos(a) * 75)] as number);
    }
    const near = spawn(w, 'wolf', RELOCATE_DIST - 2, 0);
    const nearHandle = w.enemies.id[near] as number;
    for (let i = 0; i < 25; i++) {
      freezeEnemies(w);
      w.step([NO_INPUT]);
    }
    for (const h of far) {
      const r = w.enemies.find(h);
      expect(r).toBeGreaterThanOrEqual(0);
      const d = dist(w.enemies.x[r] as number, w.enemies.z[r] as number);
      expect(d).toBeGreaterThanOrEqual(SPAWN_RING_MIN - 1e-3);
      expect(d).toBeLessThanOrEqual(SPAWN_RING_MAX + 1e-3);
    }
    const nr = w.enemies.find(nearHandle);
    expect(w.enemies.x[nr]).toBeCloseTo(RELOCATE_DIST - 2, 3);
  });

  it('bosses and pinned enemies are never relocated', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const boss = spawn(w, 'wolf', 80, 0, { tier: 3 });
    const pinned = spawn(w, 'wolf', -80, 0, { flags: EnemyFlag.Pinned });
    const bossHandle = w.enemies.id[boss] as number;
    const pinnedHandle = w.enemies.id[pinned] as number;
    for (let i = 0; i < 60; i++) {
      freezeEnemies(w);
      w.step([NO_INPUT]);
    }
    expect(dist(w.enemies.x[w.enemies.find(bossHandle)] as number, 0)).toBeGreaterThan(70);
    expect(w.enemies.x[w.enemies.find(pinnedHandle)]).toBeCloseTo(-80, 3);
  });
});

// ---------------------------------------------------------------------------
// difficulty and time scaling

describe('hp/damage scaling', () => {
  it('normal difficulty at t = 0: base hp and damage', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const row = spawn(w, 'wolf', 10, 0);
    expect(w.enemies.hpMax[row]).toBeCloseTo(20, 4);
    expect(w.enemies.hp[row]).toBeCloseTo(20, 4);
    expect(w.enemies.dmgMul[row]).toBeCloseTo(1, 5);
    expect(w.hpScale()).toBe(1);
    expect(w.dmgScale()).toBe(1);
  });

  it('after 5 minutes hp is ×(1 + 0.16 × 5) = 1.8 and damage ×(1 + 0.09 × 5) = 1.45', () => {
    const w = makeWorld();
    freezeSchedules(w);
    w.time = 300;
    expect(w.hpScale()).toBeCloseTo(1.8, 9);
    expect(w.dmgScale()).toBeCloseTo(1.45, 9);
    const row = spawn(w, 'wolf', 10, 0);
    expect(w.enemies.hpMax[row]).toBeCloseTo(20 * 1.8, 3);
    expect(w.enemies.dmgMul[row]).toBeCloseTo(1.45, 5);
  });

  it('scaling is linear in time', () => {
    const w = makeWorld();
    for (const minutes of [0, 1, 2.5, 10, 15]) {
      w.time = minutes * 60;
      expect(w.hpScale()).toBeCloseTo(1 + 0.16 * minutes, 9);
      expect(w.dmgScale()).toBeCloseTo(1 + 0.09 * minutes, 9);
    }
  });

  it('hard mode multiplies hp ×1.6 and damage ×1.4; they combine with the time scaling', () => {
    const w = makeWorld({ config: { difficulty: 'hard' } });
    freezeSchedules(w);
    const a = spawn(w, 'wolf', 10, 0);
    expect(w.enemies.hpMax[a]).toBeCloseTo(32, 3);
    expect(w.enemies.dmgMul[a]).toBeCloseTo(1.4, 5);
    w.time = 300;
    const b = spawn(w, 'wolf', 12, 0);
    expect(w.enemies.hpMax[b]).toBeCloseTo(20 * 1.8 * 1.6, 3);
    expect(w.enemies.dmgMul[b]).toBeCloseTo(1.45 * 1.4, 5);
  });

  it('enemies the spawner creates at ~5 minutes carry the time-scaled hp and damage', () => {
    const w = makeWorld({ content: singleWolves });
    onlyBands(w);
    w.time = 299.5;
    const born = runSpawning(w, 120);
    expect(born.length).toBeGreaterThan(5);
    for (const b of born) {
      expect(b.hpMax).toBeCloseTo(20 * b.hpScale, 3);
      expect(b.dmgMul).toBeCloseTo(b.dmgScale, 4);
      expect(b.hpScale).toBeGreaterThan(1.79);
      expect(b.hpScale).toBeLessThan(1.82);
    }
  });

  it('hard mode multiplies kill rewards (xp ×1.5) on top of the corruption bonus', () => {
    const xpOfKill = (difficulty: 'normal' | 'hard', corruption: number): number => {
      const w = makeWorld({ config: { difficulty } });
      freezeSchedules(w);
      w.corruption = corruption;
      const row = spawn(w, 'wolf', 30, 0);
      killEnemy(w, row, 0, -1, false);
      for (let i = 0; i < w.pickups.count; i++) if (w.pickups.kind[i] === 0) return w.pickups.value[i] as number;
      throw new Error('no xp gem dropped');
    };
    expect(xpOfKill('normal', 0)).toBeCloseTo(1, 5);
    expect(xpOfKill('hard', 0)).toBeCloseTo(1.5, 5);
    expect(xpOfKill('normal', 0.5)).toBeCloseTo(1.25, 5);
    expect(xpOfKill('hard', 0.5)).toBeCloseTo(1.875, 5);
  });
});

// ---------------------------------------------------------------------------
// bosses

interface BossSpawn {
  id: string;
  final: boolean;
  x: number;
  z: number;
  time: number;
  enemy: number;
}

describe('scheduled bosses', () => {
  /** spawner, metin, elites parked; the boss schedule stays armed; the hero cannot die */
  function bossWorld(extra?: (c: ContentDB) => void, config: Partial<RunConfig> = {}): World {
    const w = makeWorld({ config: { meta: { stats: { maxHp: 1e6 } }, ...config }, content: extra });
    w.spawner.acc = -1e9;
    w.spawner.eliteT = 1e9;
    w.metinSys.nextFallAt = 1e9;
    w.metinSys.finalStarted = true;
    return w;
  }

  function bossEvents(w: World, ticks: number): BossSpawn[] {
    const out: BossSpawn[] = [];
    for (let i = 0; i < ticks; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'bossSpawn') out.push({ id: e.bossId, final: e.final, x: e.x, z: e.z, time: w.time, enemy: e.enemy });
    }
    return out;
  }

  it('does not spawn a boss before its scheduled time, and spawns it on the first tick at or after it', () => {
    const w = bossWorld();
    w.time = 179.9;
    expect(bossEvents(w, 5)).toHaveLength(0); // 179.9 → 179.98
    expect(w.bosses).toHaveLength(0);
    const spawned = bossEvents(w, 3);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.id).toBe('boss_horyeong');
    expect(spawned[0]?.final).toBe(false);
    expect(spawned[0]?.time).toBeGreaterThanOrEqual(180);
    expect(spawned[0]?.time).toBeLessThan(180 + 2 * DT);
    expect(w.bosses).toHaveLength(1);
    expect(w.spawner.nextBoss).toBe(1);
  });

  it('spawns each scheduled boss exactly once', () => {
    const w = bossWorld();
    w.time = 179.9;
    const first = bossEvents(w, 10 * 60);
    expect(first.map((b) => b.id)).toEqual(['boss_horyeong']);
    expect(w.bosses.filter((b) => b.def.id === 'boss_horyeong')).toHaveLength(1);
    w.time = 479.95;
    const second = bossEvents(w, 10 * 60);
    expect(second.map((b) => b.id)).toEqual(['boss_ork_chief']);
    expect(w.spawner.nextBoss).toBe(2);
    expect(bossEvents(w, 600)).toHaveLength(0);
  });

  it('catches up on every missed boss in schedule order when time jumps past several of them', () => {
    const w = bossWorld((c) => zoneOf(c).bosses.reverse());
    w.time = 700;
    const spawned = bossEvents(w, 2);
    expect(spawned.map((b) => b.id)).toEqual(['boss_horyeong', 'boss_ork_chief']);
    expect(w.spawner.nextBoss).toBe(2);
    expect(w.bosses).toHaveLength(2);
  });

  it('boss spawns come with a tier-3 enemySpawn (source 3), the Boss flag, and a bossIntro story event', () => {
    const w = bossWorld();
    w.time = 179.99;
    const events: string[] = [];
    let bossRow = -1;
    for (let i = 0; i < 3; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) {
        if (e.t === 'enemySpawn' && e.tier === 3) {
          expect(e.source).toBe(3);
          expect(e.type).toBe(typeOf(w, 'boss_horyeong'));
          bossRow = w.enemies.find(e.enemy);
        }
        if (e.t === 'story') events.push(`${e.kind}:${e.ref}`);
      }
    }
    expect(bossRow).toBeGreaterThanOrEqual(0);
    expect((w.enemies.flags[bossRow] as number) & EnemyFlag.Boss).toBe(EnemyFlag.Boss);
    expect(w.enemies.eliteTier[bossRow]).toBe(3);
    expect(events).toContain('bossIntro:boss_horyeong');
  });

  it('bosses arrive 22–30 m from the hero', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = makeWorld({ config: { seed, meta: { stats: { maxHp: 1e6 } } } });
      freezeSchedules(w);
      w.spawner.nextBoss = 0;
      w.time = 179.99;
      const spawned = bossEvents(w, 2);
      expect(spawned).toHaveLength(1);
      const b = spawned[0] as BossSpawn;
      expect(dist(b.x, b.z)).toBeGreaterThanOrEqual(22 - 1e-6);
      expect(dist(b.x, b.z)).toBeLessThanOrEqual(30 + 1e-6);
    }
  });

  it('boss hp carries the time scaling (and the hard multiplier) of the moment it arrives', () => {
    for (const [difficulty, mult] of [['normal', 1], ['hard', 1.6]] as const) {
      const w = bossWorld(undefined, { difficulty });
      w.time = 179.99;
      const spawned = bossEvents(w, 2);
      const row = w.enemies.find((spawned[0] as BossSpawn).enemy);
      expect(w.hpScale()).toBeCloseTo((1 + 0.16 * 3) * mult, 3);
      expect(w.enemies.hpMax[row]).toBeCloseTo(3500 * w.hpScale(), 0);
    }
  });

  it('bosses are not subject to the alive cap', () => {
    const w = bossWorld();
    w.spawner.alive = ENEMY_SOFT_CAP + 100;
    w.time = 179.99;
    expect(bossEvents(w, 2)).toHaveLength(1);
  });

  it('a boss still arrives on time while the band spawner is running', () => {
    const w = bossWorld();
    w.spawner.acc = 3;
    w.spawner.alive = 0;
    w.time = 179.99;
    const spawned = bossEvents(w, 2);
    expect(spawned.map((b) => b.id)).toEqual(['boss_horyeong']);
  });
});

describe('after the final time', () => {
  it('the spawn rate drops to 55% once zone.final.at has passed', () => {
    const births = (start: number): number => {
      const w = makeWorld({ content: singleWolves, config: { seed: 6 } });
      onlyBands(w);
      w.time = start;
      return runSpawning(w, 10 * 60).length;
    };
    const before = births(889.5);
    const after = births(900);
    // 12/s before, 12 × 0.55 = 6.6/s after (both inside the flat last band)
    expect(before).toBeGreaterThanOrEqual(0.5 + 12 * 10 - 3);
    expect(before).toBeLessThanOrEqual(0.5 + 12 * 10 + 3);
    expect(after).toBeGreaterThanOrEqual(0.5 + 6.6 * 10 - 3);
    expect(after).toBeLessThanOrEqual(0.5 + 6.6 * 10 + 3);
    expect(after / before).toBeGreaterThan(0.45);
    expect(after / before).toBeLessThan(0.65);
  });

  it('the cap itself is not reduced by the final phase', () => {
    const w = makeWorld({ content: flatBands(40, 50) });
    onlyBands(w);
    w.time = 905;
    runSpawning(w, 600);
    expect(w.spawner.alive).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// determinism

describe('determinism', () => {
  it('the same seed spawns the same enemies at the same places; another seed does not', () => {
    const trace = (seed: number): string => {
      const w = makeWorld({ config: { seed } });
      onlyBands(w);
      return JSON.stringify(runSpawning(w, 600).map((b) => [b.tick, b.type, +b.x.toFixed(4), +b.z.toFixed(4), b.tier]));
    };
    expect(trace(5)).toBe(trace(5));
    expect(trace(5)).not.toBe(trace(6));
  });

  it('runs a stretch of the real flow (spawner + AI + hero skills) without non-finite state', () => {
    const w = makeWorld({ config: { seed: 99 } });
    onlyBands(w);
    runTicks(w, 1200);
    expect(w.enemies.count).toBeGreaterThan(0);
    expect(findNonFinite(w)).toBeNull();
  });
});

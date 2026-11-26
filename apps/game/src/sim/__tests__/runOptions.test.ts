// Run Options (density / health / damage / speed sliders), their reward multiplier, and boss escort packs.

import { describe, expect, it } from 'vitest';
import type { ContentDB } from '../../data/schema';
import { cloneContent } from '../__fixtures__/content';
import { Surface } from '../constants';
import { spawnBoss } from '../bosses';
import { clampRunOptions, DEFAULT_RUN_OPTIONS, runOptionsReward, runOptionsTable } from '../run';
import { ProjKind } from '../stores';
import type { World } from '../world';
import { createWorld } from '../world';
import { fixtureConfig } from '../__fixtures__/content';
import { clearEnemies, freezeSchedules, makeWorld, NO_INPUT, player, runTicks, spawn } from './helpers';

const table = runOptionsTable(cloneContent().balance);

describe('runOptionsReward', () => {
  it('is 1 with no sliders moved and linear in each slider', () => {
    expect(runOptionsReward(undefined, table)).toBe(1);
    expect(runOptionsReward(DEFAULT_RUN_OPTIONS, table)).toBe(1);
    expect(runOptionsReward({ density: 2 }, table)).toBeCloseTo(1 + 0.25, 9);
    expect(runOptionsReward({ health: 2 }, table)).toBeCloseTo(1 + 0.2, 9);
    expect(runOptionsReward({ damage: 2 }, table)).toBeCloseTo(1 + 0.3, 9);
    expect(runOptionsReward({ speed: 2 }, table)).toBeCloseTo(1 + 0.2, 9);
    expect(runOptionsReward({ density: 1.5, health: 1.5, damage: 1.5, speed: 1.5 }, table)).toBeCloseTo(1 + 0.5 * (0.25 + 0.2 + 0.3 + 0.2), 9);
  });

  it('is capped at rewardMax', () => {
    expect(runOptionsReward({ density: 3, health: 3, damage: 3, speed: 3 }, table)).toBe(table.rewardMax);
  });

  it('clamps values to the slider limits and ignores junk', () => {
    expect(clampRunOptions({ density: 9, health: 0.2, damage: Number.NaN, speed: 2.5 }, table)).toEqual({ density: 3, health: 1, damage: 1, speed: 2.5 });
    expect(runOptionsReward({ density: 9 }, table)).toBeCloseTo(1 + 0.25 * 2, 9);
  });

  it('asking for options on content without a table fails loudly', () => {
    const c: ContentDB = cloneContent();
    Reflect.deleteProperty(c.balance, 'runOptions');
    expect(() => createWorld(fixtureConfig({ runOptions: { density: 2 } }), c)).toThrow(/runOptions/);
    expect(() => createWorld(fixtureConfig(), c)).not.toThrow();
  });
});

describe('options in play', () => {
  it('health scales enemy hp, damage scales enemy damage (stacking with hard mode)', () => {
    const base = makeWorld();
    const tough = makeWorld({ config: { runOptions: { health: 2, damage: 2.5 } } });
    const hard = makeWorld({ config: { difficulty: 'hard', runOptions: { health: 2, damage: 2.5 } } });
    const hpOf = (w: World): number => w.enemies.hpMax[spawn(w, 'wolf', 20, 0)] as number;
    expect(hpOf(tough) / hpOf(base)).toBeCloseTo(2, 5);
    expect(hpOf(hard) / hpOf(base)).toBeCloseTo(2 * 1.6, 5);
    expect(tough.dmgScale() / base.dmgScale()).toBeCloseTo(2.5, 9);
    expect(hard.dmgScale() / base.dmgScale()).toBeCloseTo(2.5 * 1.4, 9);
  });

  it('speed scales movement and hostile projectile speed', () => {
    const slow = makeWorld();
    const fast = makeWorld({ config: { runOptions: { speed: 2 } } });
    const speedOf = (w: World): number => w.enemies.baseSpeed[spawn(w, 'wolf', 20, 0)] as number;
    expect(speedOf(fast) / speedOf(slow)).toBeCloseTo(2, 5);

    const boltSpeed = (w: World): number => {
      freezeSchedules(w);
      clearEnemies(w);
      player(w).hp = player(w).hpMax = 1e9;
      spawn(w, 'spitter', 0, 9);
      for (let i = 0; i < 240; i++) {
        w.step([NO_INPUT]);
        const P = w.projectiles;
        for (let k = 0; k < P.count; k++) if (P.kind[k] === ProjKind.Hostile) return Math.hypot(P.vx[k] as number, P.vz[k] as number);
      }
      throw new Error('the spitter never fired');
    };
    expect(boltSpeed(fast) / boltSpeed(slow)).toBeCloseTo(2, 3);
  });

  it('density multiplies the spawn rate and the alive cap', () => {
    const flat = (c: ContentDB): void => {
      for (const b of c.zones[0]!.bands) {
        b.rate = 4;
        b.maxAlive = 120;
        b.spawns = [{ enemy: 'wolf', weight: 1 }];
      }
    };
    const born = (density: number): number => {
      const w = makeWorld({ content: flat, config: { runOptions: { density } } });
      freezeSchedules(w);
      w.spawner.acc = 0.5;
      const p = player(w);
      p.hp = p.hpMax = 1e9;
      let n = 0;
      for (let i = 0; i < 60 * 12; i++) {
        w.step([NO_INPUT]);
        for (const e of w.events) if (e.t === 'enemySpawn') n++;
      }
      return n;
    };
    const one = born(1);
    expect(one).toBeGreaterThan(30);
    expect(born(2) / one).toBeGreaterThan(1.8);
    expect(born(2) / one).toBeLessThan(2.2);
  });

  it('the reward multiplier folds into the difficulty reward and the run result', () => {
    const w = makeWorld({ config: { difficulty: 'hard', runOptions: { density: 2, damage: 2, health: 99, speed: 1.5 } } });
    const expected = 1.5 * Math.min(2, 1 + 0.25 * 1 + 0.2 * 2 + 0.3 * 1 + 0.2 * 0.5);
    expect(w.diff.reward).toBeCloseTo(expected, 9);
    const r = w.buildResult(false);
    expect(r.rewardMul).toBeCloseTo(expected, 9);
    expect(r.runOptions).toEqual({ density: 2, health: 3, damage: 2, speed: 1.5 });
    const plain = makeWorld().buildResult(false);
    expect(plain.rewardMul).toBe(1);
    expect(plain.runOptions).toEqual(DEFAULT_RUN_OPTIONS);
  });

  it('the multiplier scales the talent xp of the result like the difficulty reward', () => {
    const xp = (opts: { density: number } | undefined): number => {
      const w = makeWorld({ config: { runOptions: opts } });
      w.time = 300;
      return w.buildResult(false).talentXp;
    };
    expect(xp({ density: 3 }) / xp(undefined)).toBeCloseTo(1.5, 1);
  });
});

describe('boss escorts', () => {
  function escortWorld(escorts: string[], env?: Parameters<typeof makeWorld>[0]): World {
    const w = makeWorld({
      ...env,
      content: (c) => {
        const boss = c.bosses.find((b) => b.id === 'boss_horyeong');
        if (boss) boss.escorts = escorts;
      },
    });
    freezeSchedules(w);
    clearEnemies(w);
    return w;
  }

  function bornAround(w: World, ticks: number): { id: string; x: number; z: number; source: number }[] {
    const out: { id: string; x: number; z: number; source: number }[] = [];
    const take = (): void => {
      for (const e of w.events) {
        if (e.t === 'enemySpawn') out.push({ id: w.typeDefs[e.type]?.id ?? '?', x: e.x, z: e.z, source: e.source });
      }
    };
    take(); // spawns made outside step() (the boss and its escorts) are still in the bus
    for (let i = 0; i < ticks; i++) {
      w.step([NO_INPUT]);
      take();
    }
    return out;
  }

  it('pour around the boss on arrival: ~12 creatures split over the listed kinds, on a ring 4-7.5 m out', () => {
    const w = escortWorld(['jackal', 'wolf']);
    const b = spawnBoss(w, 'boss_horyeong', false, 20, 20);
    expect(b).not.toBeNull();
    const born = bornAround(w, 1).filter((s) => s.source === 3 && s.id !== 'boss_horyeong');
    expect(born.length).toBe(12);
    expect(born.filter((s) => s.id === 'jackal').length).toBe(6);
    expect(born.filter((s) => s.id === 'wolf').length).toBe(6);
    for (const s of born) {
      const d = Math.hypot(s.x - 20, s.z - 20);
      expect(d).toBeGreaterThanOrEqual(4 - 1e-6);
      expect(d).toBeLessThanOrEqual(7.5 + 1e-6);
    }
  });

  it('a single escort kind gets up to 6 members; four kinds get 3 each', () => {
    const one = escortWorld(['wolf']);
    spawnBoss(one, 'boss_horyeong', false, 20, 20);
    expect(bornAround(one, 1).filter((s) => s.id === 'wolf').length).toBe(6);
    const four = escortWorld(['wolf', 'jackal', 'fox', 'bear']);
    spawnBoss(four, 'boss_horyeong', false, 20, 20);
    const born = bornAround(four, 1).filter((s) => s.source === 3 && s.id !== 'boss_horyeong');
    expect(born.length).toBe(12);
    for (const id of ['wolf', 'jackal', 'fox', 'bear']) expect(born.filter((s) => s.id === id).length).toBe(3);
  });

  it('bosses without escorts bring nobody; unknown ids are skipped', () => {
    const none = escortWorld([]);
    spawnBoss(none, 'boss_horyeong', false, 20, 20);
    expect(bornAround(none, 1).filter((s) => s.id !== 'boss_horyeong').length).toBe(0);
    const bad = escortWorld(['no_such_beast', 'wolf']);
    spawnBoss(bad, 'boss_horyeong', false, 20, 20);
    expect(bornAround(bad, 1).filter((s) => s.id === 'wolf').length).toBe(6);
  });

  it('respect terrain: nobody lands on lava, deep water or unwalkable ground', () => {
    const w = escortWorld(['jackal', 'wolf'], { env: { surfaceAt: (x) => (x > 22 ? Surface.Lava : Surface.Ground), walkable: (_x, z) => z < 24 } });
    spawnBoss(w, 'boss_horyeong', false, 20, 20);
    const born = bornAround(w, 1).filter((s) => s.source === 3 && s.id !== 'boss_horyeong');
    expect(born.length).toBeGreaterThan(4);
    for (const s of born) {
      expect(s.x).toBeLessThanOrEqual(22);
      expect(s.z).toBeLessThan(24);
    }
  });

  it('density scales the pack (by its square root); the alive limit stops it', () => {
    const w = makeWorld({
      config: { runOptions: { density: 3 } },
      content: (c) => {
        const boss = c.bosses.find((b) => b.id === 'boss_horyeong');
        if (boss) boss.escorts = ['wolf'];
      },
    });
    freezeSchedules(w);
    clearEnemies(w);
    spawnBoss(w, 'boss_horyeong', false, 20, 20);
    expect(bornAround(w, 1).filter((s) => s.id === 'wolf').length).toBe(Math.round(6 * Math.sqrt(3)));
    const crowded = escortWorld(['wolf']);
    crowded.spawner.alive = 640;
    spawnBoss(crowded, 'boss_horyeong', false, 20, 20);
    expect(bornAround(crowded, 1).filter((s) => s.id === 'wolf').length).toBe(0);
  });

  it('the boss summon pattern calls its own escort kinds instead of the band roster', () => {
    const w = escortWorld(['fox']);
    const b = spawnBoss(w, 'boss_horyeong', false, 20, 20);
    if (!b) throw new Error('no boss');
    const idx = b.def.patterns.findIndex((p) => p.kind === 'summon');
    expect(idx).toBeGreaterThanOrEqual(0);
    b.def.patterns.forEach((_, i) => (b.ready[i] = i === idx ? 0 : 1e9));
    b.def.phases.forEach((ph) => (ph.patterns = ['summon']));
    const born = bornAround(w, 600).filter((s) => s.source === 4);
    expect(born.length).toBeGreaterThan(0);
    for (const s of born) expect(s.id).toBe('fox');
  });
});

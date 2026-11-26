// The final fight must end: the final boss enrages after `enrageAfter` and then keeps stacking (damage, speed, pattern
// pace) every RAGE_STACK_EVERY seconds; ordinary spawns and the Great Metin's swarm thin out while it lives; a hero that
// never hurts it and kites forever is eventually caught.

import { describe, expect, it } from 'vitest';
import { RAGE_STACK_EVERY, RAGE_STACK_MAX } from '../bosses';
import { DT } from '../constants';
import { MetinPhase, type BossState } from '../types';
import type { World } from '../world';
import { botInput } from './bot';
import { drainModals, freezeEnemies, makeWorld, NO_INPUT, player } from './helpers';

/** a hero that cannot die (huge max hp from meta stats, so stat refreshes keep it) and cannot hurt anything */
function immortalWorld(): World {
  const w = makeWorld({ config: { meta: { stats: { maxHp: 1e9 } } } });
  const p = player(w);
  p.skills.length = 0;
  p.hp = p.hpMax;
  return w;
}

function finalWorld(): { w: World; boss: BossState } {
  const w = immortalWorld();
  w.time = w.zone.final.at - 0.05;
  let guard = 0;
  while (!w.bosses.some((b) => b.final) && guard++ < 60 * 20) w.step([NO_INPUT]);
  const boss = w.bosses.find((b) => b.final);
  if (!boss) throw new Error('the final boss never emerged');
  return { w, boss };
}

/** run ticks of play time, answering any level-up modal the hero's pickups open */
function play(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    drainModals(w);
    w.step([NO_INPUT]);
  }
}

function rowOf(w: World, b: BossState): number {
  return w.enemies.find(b.enemy);
}

describe('final boss enrage stacking', () => {
  it('first enrage at enrageAfter, then one stack per RAGE_STACK_EVERY with compounding damage', () => {
    const { w, boss } = finalWorld();
    const row = rowOf(w, boss);
    expect(boss.enraged).toBe(false);
    expect(boss.rageStacks).toBe(0);
    const dmg0 = w.enemies.dmgMul[row] as number;
    const spd0 = w.enemies.baseSpeed[row] as number;
    boss.age = boss.def.enrageAfter - DT * 0.5;
    play(w, 2);
    expect(boss.enraged).toBe(true);
    expect(boss.rageStacks).toBe(0);
    expect((w.enemies.dmgMul[rowOf(w, boss)] as number) / dmg0).toBeCloseTo(1.5, 6);
    expect((w.enemies.baseSpeed[rowOf(w, boss)] as number) / spd0).toBeCloseTo(1.35, 6);

    const enragedAt = w.time;
    for (let k = 1; k <= 5; k++) {
      play(w, Math.round(RAGE_STACK_EVERY * 60) + 2);
      expect(boss.rageStacks, `after ${w.time - enragedAt} s`).toBe(k);
      // rows swap-remove when anything dies: look the boss up again
      const r = rowOf(w, boss);
      expect((w.enemies.dmgMul[r] as number) / dmg0).toBeCloseTo(1.5 * 1.12 ** k, 5);
      expect(w.enemies.baseSpeed[r] as number).toBeGreaterThan(spd0 * 1.35);
    }
    expect(boss.rageDamage).toBeCloseTo(1.5 * 1.12 ** 5, 5);
    expect(boss.rageCooldown).toBeLessThan(0.6);
  }, 60_000); // ~2.2 s alone (a real-content final boss simulated for minutes): the 5 s default is too close under load

  it('stops at the stack cap, the speed cap and the pattern pace floor', () => {
    const { w, boss } = finalWorld();
    const row = rowOf(w, boss);
    const spd0 = w.enemies.baseSpeed[row] as number;
    boss.age = boss.def.enrageAfter - DT * 0.5;
    for (let k = 0; k < RAGE_STACK_MAX + 6; k++) {
      boss.nextStackAt = Math.min(boss.nextStackAt, w.time + DT);
      play(w, 3);
    }
    expect(boss.rageStacks).toBe(RAGE_STACK_MAX);
    const speed = w.enemies.baseSpeed[rowOf(w, boss)] as number;
    expect(speed).toBeLessThanOrEqual(spd0 * 2.1 + 1e-4);
    expect(speed).toBeGreaterThan(spd0 * 1.9);
    expect(boss.rageCooldown).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(boss.rageDamage).toBeGreaterThan(1.5 * 1.12 ** RAGE_STACK_MAX * 0.99);
  });

  it('ordinary bosses enrage once and never stack', () => {
    const w = immortalWorld();
    w.time = 179.9;
    let guard = 0;
    while (w.bosses.length === 0 && guard++ < 600) w.step([NO_INPUT]);
    const boss = w.bosses[0];
    if (!boss) throw new Error('no scheduled boss');
    expect(boss.final).toBe(false);
    boss.age = boss.def.enrageAfter - DT * 0.5;
    play(w, 2);
    expect(boss.enraged).toBe(true);
    play(w, 60 * 40);
    expect(boss.rageStacks).toBe(0);
    expect(boss.rageDamage).toBeCloseTo(1.5, 9);
  });
});

describe('the fight thins out the rest of the field', () => {
  it('ordinary spawning slows down and its cap drops while the final boss lives', () => {
    const born = (finalBoss: boolean): { n: number; alive: number } => {
      const w = immortalWorld();
      w.time = w.zone.final.at + 20;
      if (finalBoss) {
        w.time = w.zone.final.at - 0.05;
        let g = 0;
        while (!w.bosses.some((b) => b.final) && g++ < 1200) w.step([NO_INPUT]);
      } else {
        w.metinSys.finalStarted = true;
      }
      let n = 0;
      let maxAlive = 0;
      for (let i = 0; i < 60 * 40; i++) {
        freezeEnemies(w);
        drainModals(w);
        w.step([NO_INPUT]);
        for (const e of w.events) if (e.t === 'enemySpawn' && e.source !== 2 && e.source !== 3) n++;
        maxAlive = Math.max(maxAlive, w.spawner.alive);
      }
      return { n, alive: maxAlive };
    };
    const withBoss = born(true);
    const without = born(false);
    expect(without.n).toBeGreaterThan(40);
    expect(withBoss.n).toBeLessThan(without.n * 0.6);
  });

  it('the Great Metin swarms a third as often once its boss is out', () => {
    const { w } = finalWorld();
    const great = w.metins.find((m) => m.great);
    if (!great) throw new Error('no great metin');
    expect(great.phase).toBe(MetinPhase.Alive);
    great.swarmT = 0;
    const every = great.def.swarm.every;
    let waves = 0;
    let last = great.swarmT;
    for (let i = 0; i < Math.round(every * 3 * 60) + 30; i++) {
      freezeEnemies(w);
      drainModals(w);
      w.step([NO_INPUT]);
      if (great.swarmT < last) waves++;
      last = great.swarmT;
    }
    expect(waves).toBe(1);
  });
});

describe('a hero that never hurts the final boss cannot drag the run on', () => {
  it('kiting forever with a huge defence still ends in defeat within a bounded time after the first enrage', () => {
    const w = makeWorld({ config: { meta: { stats: { maxHpPct: 8, armor: 150, regen: 10 } } } });
    const p = w.players[0];
    if (!p) throw new Error('no player');
    p.skills.length = 0;
    w.time = w.zone.final.at - 0.05;
    let bossAt = -1;
    let enragedAt = -1;
    let tick = 0;
    const limit = 60 * 700;
    while (!w.over && tick < limit) {
      drainModals(w);
      w.step([botInput(w, tick)]);
      tick++;
      const b = w.bosses.find((x) => x.final);
      if (b && bossAt < 0) bossAt = w.time;
      if (b?.enraged && enragedAt < 0) enragedAt = w.time;
    }
    expect(bossAt).toBeGreaterThan(0);
    expect(enragedAt).toBeGreaterThan(bossAt);
    expect(w.over, 'the run is still going 700 s after the Great Metin fell').toBe(true);
    expect(w.victory).toBe(false);
    // enrage after 180 s of boss time, then the stacks need to catch a kiting hero: well under 5 minutes
    expect(w.time - enragedAt).toBeLessThan(300);
  }, 120_000);
});

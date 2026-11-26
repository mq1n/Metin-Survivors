
// below each threshold (group size waveSizeMin..Max, distance waveRingMin..Max).

import { describe, expect, it } from 'vitest';
import { EnemyFlag } from '../stores';
import { MetinPhase } from '../types';
import type { World } from '../world';
import { collect, makeWorld, NO_INPUT, player, runTicks } from './helpers';

function waveWorld(): World {
  const w = makeWorld({
    content: (c) => {
      for (const def of c.metins) {
        def.modifier = 'flicker';
        def.swarm.every = 1e6;
        def.awakenAfter = 1e6;
        def.modParams = { ...def.modParams, wave_99: 1, wave_90: 2, wave_50: 3, waveSizeMin: 4, waveSizeMax: 4, waveRingMin: 5, waveRingMax: 9 };
      }
    },
  });
  w.spawner.acc = -1e9;
  w.spawner.eliteT = 1e9;
  w.spawner.nextBoss = w.spawner.bosses.length;
  w.metinSys.nextFallAt = 0;
  const p = player(w);
  p.hp = p.hpMax = 1e9;
  p.skills.length = 0;
  runTicks(w, 1);
  const m = w.metins[0];
  if (!m) throw new Error('no metin');
  for (let i = 0; i < 400 && m.phase === MetinPhase.Falling; i++) w.step([NO_INPUT]);
  for (let i = 0; i < 120; i++) {
    const row = w.enemies.find(m.enemy);
    if (row >= 0 && ((w.enemies.flags[row] as number) & EnemyFlag.Invuln) === 0) break;
    w.step([NO_INPUT]);
  }
  return w;
}

function setHpFrac(w: World, frac: number): void {
  const m = w.metins[0];
  if (!m) throw new Error('no metin');
  const row = w.enemies.find(m.enemy);
  w.enemies.hp[row] = (w.enemies.hpMax[row] as number) * frac;
}

describe('metin hp waves', () => {
  it('pours one pack per crossed threshold, sized and placed by the stone params', () => {
    const w = waveWorld();
    const m = w.metins[0];
    if (!m) throw new Error('no metin');
    expect(m.waveIdx).toBe(0);

    setHpFrac(w, 0.95);
    const first = collect(w, 1, ['enemySpawn']).filter((s) => s.source === 2);
    expect(first.length).toBe(4); // wave_99 = 1 group of 4
    for (const s of first) {
      const d = Math.hypot(s.x - m.x, s.z - m.z);
      expect(d).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(d).toBeLessThanOrEqual(9 + 1e-6);
    }
    // one pack: all members within a narrow angular wedge of each other
    const angles = first.map((s) => Math.atan2(s.x - m.x, s.z - m.z));
    const a0 = angles[0] as number;
    for (const a of angles) expect(Math.abs(Math.atan2(Math.sin(a - a0), Math.cos(a - a0)))).toBeLessThanOrEqual(0.91);
    expect(m.waveIdx).toBe(1);

    // a big hit crosses 90 / 80 / 70 / 60 / 50 % in one go: wave_90 (2 groups) + wave_50 (3 groups) = 20 creatures
    setHpFrac(w, 0.45);
    const second = collect(w, 1, ['enemySpawn']).filter((s) => s.source === 2);
    expect(second.length).toBe(20);
    expect(m.waveIdx).toBe(6);

    // thresholds only fire once
    setHpFrac(w, 0.46);
    expect(collect(w, 30, ['enemySpawn']).filter((s) => s.source === 2).length).toBe(0);
  });

  it('does nothing for thresholds without a group count', () => {
    const w = waveWorld();
    setHpFrac(w, 0.75); // crosses 99, 90 (waves exist) and 80 (none)
    const born = collect(w, 1, ['enemySpawn']).filter((s) => s.source === 2);
    expect(born.length).toBe(12);
    setHpFrac(w, 0.62); // 70, 60: no group counts
    expect(collect(w, 1, ['enemySpawn']).filter((s) => s.source === 2).length).toBe(0);
  });
});

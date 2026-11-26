// Terrain hooks (WorldEnv), fear, and the HUD extras that are not covered by the per-system suites.

import { describe, expect, it } from 'vitest';
import { Surface } from '../constants';
import { applyStatus } from '../combat';
import { StatusIdx } from '../stores';
import { hud } from '../hud';
import { clearEnemies, collect, freezeSchedules, makeWorld, player, runTicks, spawn } from './helpers';

const RIGHT = { moveX: 1, moveZ: 0 };

describe('hero movement against terrain', () => {
  it('slides along nothing: a walkable() wall stops the hero', () => {
    const w = makeWorld({ env: { walkable: (x) => x < 10 } });
    freezeSchedules(w);
    runTicks(w, 600, RIGHT);
    expect(player(w).x).toBeLessThan(10);
    expect(player(w).x).toBeGreaterThan(8);
  });

  it('uses moveCircle when the env provides it', () => {
    let calls = 0;
    const w = makeWorld({
      env: {
        moveCircle: (_x0, _z0, x1, z1, _r, out) => {
          calls++;
          out.x = Math.min(x1, 5);
          out.z = z1;
          return x1 <= 5;
        },
      },
    });
    freezeSchedules(w);
    runTicks(w, 400, RIGHT);
    expect(calls).toBeGreaterThan(300);
    expect(player(w).x).toBeCloseTo(5, 5);
  });

  it('shallow water slows the hero to about 80 %', () => {
    const ground = makeWorld();
    const water = makeWorld({ env: { surfaceAt: () => Surface.Shallow } });
    for (const w of [ground, water]) {
      freezeSchedules(w);
      runTicks(w, 90, RIGHT);
    }
    const ratio = player(water).speed / player(ground).speed;
    expect(ratio).toBeGreaterThan(0.78);
    expect(ratio).toBeLessThan(0.82);
  });

  it('ice keeps the hero sliding after the stick is released', () => {
    const ground = makeWorld();
    const ice = makeWorld({ env: { surfaceAt: () => Surface.Ice } });
    for (const w of [ground, ice]) {
      freezeSchedules(w);
      runTicks(w, 120, RIGHT);
      runTicks(w, 12);
    }
    expect(player(ice).speed).toBeGreaterThan(player(ground).speed * 2);
  });

  it('lava burns the hero every half second, miasma poisons more gently, ground does neither', () => {
    const lost = (surface: number): number => {
      const w = makeWorld({ env: { surfaceAt: () => surface } });
      freezeSchedules(w);
      const p = player(w);
      const hp0 = p.hp;
      runTicks(w, 200);
      return (hp0 - p.hp) / p.hpMax;
    };
    const lava = lost(Surface.Lava);
    const miasma = lost(Surface.Miasma);
    expect(lost(Surface.Ground)).toBe(0);
    expect(lava).toBeGreaterThan(0.05);
    expect(miasma).toBeGreaterThan(0.025);
    expect(miasma).toBeLessThan(lava);
  });
});

describe('enemies and spawns respect the terrain', () => {
  it('walkable() walls keep chasing enemies out', () => {
    const inBand = (x: number): boolean => x > 4 && x < 6;
    const w = makeWorld({ env: { walkable: (x) => !inBand(x) } });
    freezeSchedules(w);
    clearEnemies(w);
    const row = spawn(w, 'wolf', 8, 0);
    for (let i = 0; i < 600; i++) {
      w.step([{ moveX: 0, moveZ: 0 }]);
      expect(inBand(w.enemies.x[row] as number)).toBe(false);
    }
    expect(w.enemies.x[row]).toBeGreaterThanOrEqual(6);
  });

  it('ring spawns never land on lava or deep water', () => {
    const w = makeWorld({ env: { surfaceAt: (x) => (x > 0 ? Surface.Lava : x < -20 ? Surface.Deep : Surface.Ground) } });
    const p = player(w);
    p.hpMax = p.hp = 1e9;
    const spawns = collect(w, 60 * 40, ['enemySpawn']);
    expect(spawns.length).toBeGreaterThan(20);
    for (const s of spawns) {
      expect(s.x).toBeLessThanOrEqual(0);
      expect(s.x).toBeGreaterThanOrEqual(-20);
    }
  });

  it('metins fall on spawnable ground only', () => {
    const w = makeWorld({ env: { surfaceAt: (x) => (x > 0 ? Surface.Lava : Surface.Ground) } });
    // no ordinary spawns, but the metin schedule keeps running
    w.spawner.acc = -1e9;
    w.spawner.eliteT = 1e9;
    w.spawner.nextBoss = w.spawner.bosses.length;
    runTicks(w, 60 * 130);
    expect(w.metins.length).toBeGreaterThanOrEqual(1);
    for (const m of w.metins) expect(m.x).toBeLessThanOrEqual(0);
  });
});

describe('fear', () => {
  it('frightened enemies run away and do not attack', () => {
    const w = makeWorld();
    freezeSchedules(w);
    clearEnemies(w);
    const p = player(w);
    const row = spawn(w, 'wolf', 3, 0);
    const hp0 = p.hp;
    applyStatus(w, row, StatusIdx.Fear, 2, 0, -1, false);
    runTicks(w, 60);
    expect(w.enemies.x[row] as number).toBeGreaterThan(5);
    expect(p.hp).toBe(hp0);
    // fear wears off and the wolf comes back
    runTicks(w, 60 * 6);
    expect(Math.hypot(w.enemies.x[row] as number, w.enemies.z[row] as number)).toBeLessThan(6);
  });
});

describe('hud extras', () => {
  it('reports the hero position, a sorted damage meter and a live dps', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const p = player(w);
    for (let i = 0; i < 6; i++) spawn(w, 'wolf', 3 + i, 1 + i * 0.4);
    runTicks(w, 60 * 6);
    const h = hud(w, 0);
    expect(h.px).toBe(p.x);
    expect(h.pz).toBe(p.z);
    expect(h.dmg.length).toBeGreaterThan(0);
    expect(h.dmg.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < h.dmg.length; i++) expect((h.dmg[i - 1] as { damage: number }).damage).toBeGreaterThanOrEqual((h.dmg[i] as { damage: number }).damage);
    expect(w.tally.damageDealt).toBeGreaterThan(0);
    expect(h.dps).toBeGreaterThanOrEqual(0);
    expect(h.dps).toBeLessThan(w.tally.damageDealt);
  });
});

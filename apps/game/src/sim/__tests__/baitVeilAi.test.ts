// Skill-logic M5 (DESIGN §4): the creature AI side of bait and veil. A bait pulls MOVEMENT toward its point (attack choice and range still
// use the hero), bosses ignore it, elites use half its radius, the kill switch turns it off. A veiled hero is dropped as a target by
// every non-boss creature: it re-picks a non-veiled hero within 16 m (co-op), else walks to a bait or stands; bosses keep the target.

import { describe, expect, it } from 'vitest';
import type { CoopPlayerInit } from '../run';
import { EnemyState, ProjKind, type PlayerState } from '../stores';
import type { World } from '../world';
import { clearEnemies, dropSkills, freezeSchedules, makeWorld, player, runTicks, spawn } from './helpers';

const PARTNER: CoopPlayerInit = { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', meta: { stats: {} } };

/** hero(es) parked, no skills, no spawner: only the creature under test acts */
function field(opts: { coop?: boolean; bait?: boolean } = {}): World {
  const w = makeWorld({
    config: opts.coop ? { coop: [PARTNER] } : undefined,
    content: (c) => {
      if (opts.bait === false) c.balance.triggers = { bait: false };
    },
  });
  freezeSchedules(w);
  clearEnemies(w);
  for (let i = 0; i < w.players.length; i++) {
    dropSkills(w, i);
    const p = player(w, i);
    p.x = p.px = 0;
    p.z = p.pz = 0;
    p.hp = p.hpMax = 1e5;
  }
  return w;
}

function pos(w: World, row: number): { x: number; z: number } {
  return { x: w.enemies.x[row] as number, z: w.enemies.z[row] as number };
}

function dist(a: { x: number; z: number }, x: number, z: number): number {
  return Math.hypot(a.x - x, a.z - z);
}

function hostileBolts(w: World): number {
  let n = 0;
  for (let i = 0; i < w.projectiles.count; i++) if (w.projectiles.kind[i] === ProjKind.Hostile) n++;
  return n;
}

const ARCHETYPES: [string, string][] = [
  ['wolf', 'chase'],
  ['jackal', 'swarm'],
  ['spitter', 'ranged'],
  ['boar_charger', 'charger'],
  ['bear', 'tank'],
  ['fox', 'skirmisher'],
];

describe('veil: a veiled hero is dropped as a target', () => {
  for (const [id, ai] of ARCHETYPES) {
    it(`${ai} (${id}): stands idle and never attacks while the hero is veiled, acts normally without the veil`, () => {
      const veiled = field();
      const p = player(veiled);
      const a = spawn(veiled, id, 4, 0);
      const start = pos(veiled, a);
      p.veilT = 4;
      runTicks(veiled, 120);
      expect(dist(pos(veiled, a), start.x, start.z)).toBeLessThan(0.15);
      expect(p.hp).toBe(p.hpMax);
      expect(hostileBolts(veiled)).toBe(0);

      const open = field();
      const b = spawn(open, id, 4, 0);
      runTicks(open, 120);
      const hero = player(open);
      const acted = dist(pos(open, b), start.x, start.z) > 0.6 || hero.hp < hero.hpMax || hostileBolts(open) > 0;
      expect(acted).toBe(true);
    });
  }

  it('once the veil ends the creature goes for the hero again', () => {
    const w = field();
    const p = player(w);
    const a = spawn(w, 'wolf', 8, 0);
    p.veilT = 1;
    runTicks(w, 60);
    expect(dist(pos(w, a), 8, 0)).toBeLessThan(0.15);
    runTicks(w, 120);
    expect(dist(pos(w, a), 0, 0)).toBeLessThan(6);
  });

  it('a creature mid-attack (wound up before the veil) still lands its blow', () => {
    const w = field();
    const p = player(w);
    const a = spawn(w, 'wolf', 1.2, 0);
    // run until the wolf is winding up, then veil the hero: the strike resolves (the cast iframes of the real veil cover it)
    for (let i = 0; i < 120 && w.enemies.state[a] !== EnemyState.Windup; i++) w.step([{ moveX: 0, moveZ: 0 }]);
    expect(w.enemies.state[a]).toBe(EnemyState.Windup);
    p.veilT = 3;
    p.iframes = 0;
    runTicks(w, 40);
    expect(p.hp).toBeLessThan(p.hpMax);
    // ...and it starts nothing new while the veil stands
    const hp = p.hp;
    runTicks(w, 100);
    expect(p.veilT).toBeGreaterThan(0);
    expect(p.hp).toBe(hp);
  });

  it('bosses (elite tier 3) ignore the veil', () => {
    const w = field();
    const p = player(w);
    const a = spawn(w, 'wolf', 6, 0);
    w.enemies.eliteTier[a] = 3;
    p.veilT = 5;
    runTicks(w, 120);
    expect(dist(pos(w, a), 0, 0)).toBeLessThan(3);
  });

  it('co-op: the creature re-picks a non-veiled hero within 16 m, else it loses the target', () => {
    const near = field({ coop: true });
    player(near, 0).veilT = 5;
    const ally = player(near, 1);
    ally.x = ally.px = 10;
    ally.z = ally.pz = 0;
    const a = spawn(near, 'wolf', 0, 3);
    runTicks(near, 60);
    // it walks toward the ally (+x), not the veiled hero at the origin
    expect(pos(near, a).x).toBeGreaterThan(1.5);

    const far = field({ coop: true });
    player(far, 0).veilT = 5;
    const ally2 = player(far, 1);
    ally2.x = ally2.px = 30;
    ally2.z = ally2.pz = 0;
    const b = spawn(far, 'wolf', 0, 3);
    runTicks(far, 60);
    expect(dist(pos(far, b), 0, 3)).toBeLessThan(0.15);
  });

  it('both heroes veiled: nobody to re-pick, the creature stands', () => {
    const w = field({ coop: true });
    player(w, 0).veilT = 5;
    const ally = player(w, 1);
    ally.veilT = 5;
    ally.x = ally.px = 5;
    const a = spawn(w, 'wolf', 0, 3);
    runTicks(w, 60);
    expect(dist(pos(w, a), 0, 3)).toBeLessThan(0.15);
  });
});

describe('bait: pulls movement only', () => {
  for (const [id, ai] of ARCHETYPES) {
    if (id === 'boar_charger') continue; // covered below: it charges from range
    it(`${ai} (${id}): walks to the bait and stops within ~1.2 m of it`, () => {
      const w = field();
      const a = spawn(w, id, 3, 9);
      w.addBait(0, 12, 8, 20);
      const hero0 = dist(pos(w, a), 0, 0);
      runTicks(w, 360);
      const at = pos(w, a);
      expect(dist(at, 0, 12)).toBeLessThan(2.2);
      expect(dist(at, 0, 0)).toBeGreaterThan(hero0 * 0.7);
    });
  }

  it('charger: pulled toward the bait while the hero is out of its charge range', () => {
    const w = field();
    const a = spawn(w, 'boar_charger', 3, 14);
    w.addBait(0, 18, 8, 20);
    runTicks(w, 240);
    expect(dist(pos(w, a), 0, 18)).toBeLessThan(3);
  });

  it('attack choice and range still use the hero: a ranged creature in range of the hero shoots while it is lured', () => {
    const w = field();
    const a = spawn(w, 'spitter', 0, 6);
    w.addBait(6, 9, 8, 20);
    runTicks(w, 150);
    const p = player(w);
    expect(hostileBolts(w) > 0 || p.hp < p.hpMax).toBe(true);
    void a;
  });

  it('a melee attacker already next to the hero stays (the bait never shields an adjacent attacker)', () => {
    const w = field();
    const p = player(w);
    const a = spawn(w, 'wolf', 1.2, 0);
    w.addBait(0, 12, 20, 20);
    runTicks(w, 90);
    expect(dist(pos(w, a), 0, 0)).toBeLessThan(2);
    expect(p.hp).toBeLessThan(p.hpMax);
  });

  it('elites use half the radius, bosses ignore baits', () => {
    const w = field();
    // bait 12 m north, radius 8: a creature 6.5 m from it is inside r, an elite (r/2 = 4) is not
    const normal = spawn(w, 'wolf', 3, 5.5);
    const elite = spawn(w, 'wolf', -3, 5.5, { tier: 1 });
    const boss = spawn(w, 'wolf', 0, 5.5);
    w.enemies.eliteTier[boss] = 3;
    w.addBait(0, 12, 8, 20);
    runTicks(w, 60);
    expect(pos(w, normal).z).toBeGreaterThan(5.5 + 1.5); // went north to the bait
    expect(pos(w, elite).z).toBeLessThan(5.5 - 0.5); // toward the hero
    expect(pos(w, boss).z).toBeLessThan(5.5 - 0.5);
  });

  it('the nearest covering bait wins, expiry returns the creature to the hero', () => {
    const w = field();
    const a = spawn(w, 'wolf', 0, 7);
    w.addBait(0, 12, 8, 1);
    runTicks(w, 50);
    expect(pos(w, a).z).toBeGreaterThan(8);
    runTicks(w, 200);
    expect(w.baits.count).toBe(0);
    expect(pos(w, a).z).toBeLessThan(5);
  });

  it('the kill switch (balance.triggers.bait false): addBait adds nothing and creatures ignore the point', () => {
    const w = field({ bait: false });
    const a = spawn(w, 'wolf', 3, 9);
    expect(w.addBait(0, 12, 8, 20)).toBe(false);
    runTicks(w, 120);
    expect(dist(pos(w, a), 0, 0)).toBeLessThan(8);
  });
});

describe('veil + bait', () => {
  it('a creature that lost the hero walks to a covering bait and stops there; outside the bait it stands', () => {
    const w = field();
    const p = player(w);
    p.veilT = 8;
    const inside = spawn(w, 'wolf', 3, 7);
    const outside = spawn(w, 'wolf', -12, 0);
    w.addBait(0, 10, 6, 20);
    runTicks(w, 240);
    expect(dist(pos(w, inside), 0, 10)).toBeLessThan(2.2);
    expect(dist(pos(w, outside), -12, 0)).toBeLessThan(0.15);
    expect(p.hp).toBe(p.hpMax);
  });

  it('determinism: two same-seed worlds with a veil, baits and a crowd stay bit-identical', () => {
    const run = (): string => {
      const w = field();
      const p = player(w);
      for (let i = 0; i < 24; i++) spawn(w, i % 3 === 0 ? 'spitter' : 'wolf', Math.sin(i) * 9, Math.cos(i * 1.7) * 9);
      w.addBait(5, 5, 7, 4);
      p.veilT = 3;
      let h = 0;
      for (let t = 0; t < 600; t++) {
        w.step([{ moveX: 0, moveZ: 0 }]);
        for (let r = 0; r < w.enemies.count; r += 3) h = (h * 31 + Math.round((w.enemies.x[r] as number) * 100) + Math.round((w.enemies.z[r] as number) * 100)) | 0;
      }
      return `${h}:${(p as PlayerState).hp.toFixed(2)}`;
    };
    expect(run()).toBe(run());
  });
});

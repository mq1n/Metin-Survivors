// Skill-logic M7 (DESIGN §4): the small riders — fear vulnerability, cone missing-HP / leech, zone damage scale, Dispel purge
// (bolts, purgedUntil, corruptionPass, corrupted-cluster placement) — plus the hurt ring that hurtPlayer feeds.

import { describe, expect, it } from 'vitest';
import type { MetinDef, SkillDef, SkillParams, ZoneDef } from '../../data/schema';
import { hitEnemy, hurtPlayer, HurtKind, newHitCtx } from '../combat';
import { castNow } from '../skills';
import { pickClusterTarget, spawnProjectile, spawnZone } from '../skills/common';
import { ProjKind, StatusIdx, ZoneKind, type PlayerState, type SkillInstance } from '../stores';
import { MetinPhase, type MetinState } from '../types';
import type { World } from '../world';
import { applyStatus } from '../combat';
import { clearEnemies, dropSkills, freezeEnemies, freezeSchedules, giveSkill, makeWorld, NO_INPUT, player, runTicks, spawn } from './helpers';

/** quiet world, hero 0 at the origin owning `skillId` patched with `params`; the skill is parked (cd huge) unless cast by hand */
function lab(skillId: string, params: Partial<SkillParams> = {}, patch?: (d: SkillDef) => void): { w: World; p: PlayerState; s: SkillInstance } {
  const w = makeWorld({
    content: (c) => {
      const d = c.skills.find((x) => x.id === skillId) as SkillDef;
      d.params = { ...d.params, ...params };
      patch?.(d);
    },
  });
  freezeSchedules(w);
  clearEnemies(w);
  dropSkills(w);
  const p = player(w);
  p.x = p.px = 0;
  p.z = p.pz = 0;
  const s = giveSkill(w, skillId);
  s.cd = 1e9;
  return { w, p, s };
}

describe('fear vulnerability', () => {
  it('a creature under Fear takes 15 % more from a hit; Freeze (x1.2) and Fear stack', () => {
    const { w } = lab('sword_arc');
    const hit = (status: number[]): number => {
      const row = spawn(w, 'bear', 40, 0);
      w.enemies.hp[row] = 1e9;
      w.enemies.hpMax[row] = 1e9;
      for (const k of status) applyStatus(w, row, k, 5, 1, -1, false);
      const c = newHitCtx();
      c.player = 0;
      c.noCrit = true;
      return hitEnemy(w, row, 100, c);
    };
    const plain = hit([]);
    expect(hit([StatusIdx.Fear])).toBeCloseTo(plain * 1.15, 4);
    expect(hit([StatusIdx.Freeze])).toBeCloseTo(plain * 1.2, 4);
    expect(hit([StatusIdx.Fear, StatusIdx.Freeze])).toBeCloseTo(plain * 1.15 * 1.2, 4);
  });
});

describe('cone: missing-HP scaling and leech', () => {
  const NO_STATUS = (d: SkillDef): void => {
    delete d.params.status;
  };

  function fire(hpFrac: number, params: Partial<SkillParams>): { dealt: number; healed: number; p: PlayerState } {
    const { w, p, s } = lab('frost_cleave', params, NO_STATUS);
    const row = spawn(w, 'bear', 0, 3);
    freezeEnemies(w);
    w.enemies.hp[row] = 1e9;
    w.enemies.hpMax[row] = 1e9;
    p.hp = p.hpMax * hpFrac;
    const hp0 = p.hp;
    w.hash.rebuild(w.enemies);
    expect(castNow(w, p, s)).toBe(true);
    let dealt = 0;
    for (const e of w.events) if (e.t === 'damage' && !e.crit) dealt += e.amount;
    return { dealt, healed: p.hp - hp0, p };
  }

  it('missing: damage x (1 + missing x missing-HP fraction)', () => {
    const full = fire(1, { missing: 2 });
    const half = fire(0.5, { missing: 2 });
    const none = fire(0.5, {});
    // a crit-free hit: the same skill without `missing` is the baseline at any HP
    expect(none.dealt).toBeGreaterThan(0);
    expect(full.dealt).toBeCloseTo(none.dealt, 3);
    expect(half.dealt).toBeCloseTo(none.dealt * 2, 3);
  });

  it('leech: a share of the damage dealt returns as HP, capped at 15 % max HP + heal; none without the key', () => {
    const none = fire(0.5, { damage: 60 });
    expect(none.healed).toBe(0);
    const a = fire(0.5, { damage: 60, leech: 25 });
    expect(a.healed).toBeCloseTo(Math.min(a.dealt * 0.25, a.p.hpMax * 0.15), 3);
    expect(a.healed).toBeGreaterThan(0);
    // a huge hit is capped
    const big = fire(0.2, { damage: 5000, leech: 100 });
    expect(big.healed).toBeCloseTo(big.p.hpMax * 0.15, 3);
    const withHeal = fire(0.2, { damage: 5000, leech: 100, heal: 20 });
    expect(withHeal.healed).toBeCloseTo(withHeal.p.hpMax * 0.15 + 20, 3);
  });

  it('a cone without the keys is unchanged', () => {
    const a = fire(1, {});
    const b = fire(0.3, {});
    expect(a.dealt).toBeCloseTo(b.dealt, 6);
    expect(a.healed).toBe(0);
  });
});

describe('zone damage scale (ZoneStore.mul)', () => {
  function zoneDamage(mul: number): number {
    const { w, p, s } = lab('venom_pool', {}, (d) => delete d.params.status);
    runTicks(w, 1); // resolves s.fp
    const row = spawn(w, 'bear', 0, 0);
    freezeEnemies(w);
    w.enemies.hp[row] = 1e9;
    w.enemies.hpMax[row] = 1e9;
    const z = spawnZone(w, { kind: ZoneKind.Circle, team: 0, x: 0, z: 0, radius: 3, dur: 2, tick: 0.5, damage: 0, preset: 'vfx_venom_pool', element: 0, owner: p.index, skill: s.slot });
    if (mul > 0) w.zones.mul[z] = mul;
    let total = 0;
    for (let i = 0; i < 60; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'damage' && e.skill === s.slot && !e.crit) total += e.amount;
    }
    return total;
  }

  it('a ticking zone with mul 0.5 hits for half; unset (0) reads as 1', () => {
    const full = zoneDamage(0);
    expect(full).toBeGreaterThan(0);
    expect(zoneDamage(0.5)).toBeCloseTo(full * 0.5, 3);
    expect(zoneDamage(1)).toBeCloseTo(full, 6);
  });
});

describe('hurt ring', () => {
  it('hurtPlayer records post-armor damage before the shield; evaded and iframe blows record nothing', () => {
    const { w, p } = lab('sword_arc');
    p.shield = 1e6;
    p.iframes = 0;
    hurtPlayer(w, 0, 40, 3, 0, 0, HurtKind.Melee);
    expect(p.hurtN).toBe(1);
    expect(p.hurtA[0]).toBeGreaterThan(0);
    expect(p.hurtA[0]).toBeLessThanOrEqual(40);
    expect(p.hp).toBe(p.hpMax); // fully soaked by the shield, yet recorded
    // inside the i-frames after the blow: refused, nothing recorded
    hurtPlayer(w, 0, 40, 3, 0, 0, HurtKind.Melee);
    expect(p.hurtN).toBe(1);
    // evasion
    p.iframes = 0;
    p.stats.evasion = 1;
    hurtPlayer(w, 0, 40, 3, 0, 0, HurtKind.Melee);
    expect(p.hurtN).toBe(1);
  });
});

describe('Dispel purge', () => {
  function sigil(): { w: World; p: PlayerState; s: SkillInstance; z: number } {
    const { w, p, s } = lab('venom_pool', { purge: 6 }, (d) => delete d.params.status);
    runTicks(w, 1);
    const z = spawnZone(w, { kind: ZoneKind.Circle, team: 0, x: 0, z: 0, radius: 3, dur: 3, tick: 0.45, damage: 0, preset: 'vfx_venom_pool', element: 0, owner: p.index, skill: s.slot });
    return { w, p, s, z };
  }
  const bolt = (w: World, x: number, z: number): number =>
    spawnProjectile(w, { kind: ProjKind.Hostile, x, z, vx: 0, vz: 0, radius: 0.3, life: 9, damage: 1, element: 0, owner: 0, skill: 255, pierce: 0, preset: 'p_bolt' });

  it('hostile bolts inside the sigil dissolve, bolts outside and player bolts stay', () => {
    const { w } = sigil();
    bolt(w, 1, 1);
    bolt(w, 0, 2.5);
    bolt(w, 8, 0);
    spawnProjectile(w, { kind: ProjKind.Bolt, x: 1, z: 0, vx: 0, vz: 0, radius: 0.3, life: 9, damage: 1, element: 0, owner: 0, skill: 0, pierce: 0, preset: 'p_bolt' });
    expect(w.projectiles.count).toBe(4);
    runTicks(w, 2);
    expect(w.projectiles.count).toBe(2);
    const kinds = Array.from({ length: w.projectiles.count }, (_, i) => w.projectiles.kind[i]);
    expect(kinds.sort()).toEqual([ProjKind.Bolt, ProjKind.Hostile].sort());
  });

  it('creatures inside are stamped purgedUntil = now + purge on every zone tick; outside ones are not', () => {
    const { w } = sigil();
    const inside = spawn(w, 'bear', 1, 0);
    const outside = spawn(w, 'wolf', 9, 0);
    freezeEnemies(w);
    w.enemies.hp[inside] = 1e9;
    runTicks(w, 40);
    expect(w.enemies.purgedUntil[inside] as number).toBeGreaterThan(w.time + 5);
    expect(w.enemies.purgedUntil[inside] as number).toBeLessThanOrEqual(w.time + 6 + 1e-3);
    expect(w.enemies.purgedUntil[outside]).toBe(0);
  });

  it('a skill without purge never stamps or dissolves', () => {
    const { w, p, s } = lab('venom_pool', {}, (d) => delete d.params.status);
    runTicks(w, 1);
    spawnZone(w, { kind: ZoneKind.Circle, team: 0, x: 0, z: 0, radius: 3, dur: 3, tick: 0.45, damage: 0, preset: 'vfx_venom_pool', element: 0, owner: p.index, skill: s.slot });
    const inside = spawn(w, 'bear', 1, 0);
    bolt(w, 1, 1);
    freezeEnemies(w);
    w.enemies.hp[inside] = 1e9;
    runTicks(w, 40);
    expect(w.enemies.purgedUntil[inside]).toBe(0);
    expect(w.projectiles.count).toBe(1);
  });

  it('placement prefers the metin-corrupted cluster (a corrupted neighbour counts double) only when asked', () => {
    const { w } = lab('venom_pool');
    // cluster A: 4 plain wolves near (10, 0); cluster B: 3 corrupted wolves near (0, 10)
    const a = [0, 1, 2, 3].map((i) => spawn(w, 'wolf', 10 + (i % 2) * 0.8, (i >> 1) * 0.8));
    const b = [0, 1, 2].map((i) => spawn(w, 'wolf', i * 0.8, 10));
    for (const r of b) w.enemies.corrupted[r] = 0.6;
    freezeEnemies(w);
    w.hash.rebuild(w.enemies);
    const plain = pickClusterTarget(w, 0, 0, 20);
    expect(a).toContain(plain);
    w.hash.rebuild(w.enemies);
    const dispel = pickClusterTarget(w, 0, 0, 20, true);
    expect(b).toContain(dispel);
  });
});

describe('Dispel purge vs metin corruption', () => {
  const SORROW = 'metin_lament';

  function metinLab(): { w: World; m: MetinState } {
    const w = makeWorld({
      content: (c) => {
        const zone = c.zones[0] as ZoneDef;
        zone.metins.types = [SORROW];
        zone.metins.interval = [1e6, 1e6];
        for (const d of c.metins as MetinDef[]) d.swarm.every = 1e9;
      },
    });
    w.spawner.acc = -1e9;
    w.spawner.eliteT = 1e9;
    w.spawner.nextBoss = w.spawner.bosses.length;
    for (const q of w.players) q.skills.length = 0;
    w.metinSys.nextFallAt = 0;
    runTicks(w, 1);
    const m = w.metins[0] as MetinState;
    for (let i = 0; i < 400 && m.phase === MetinPhase.Falling; i++) w.step([NO_INPUT]);
    expect(m.phase).toBe(MetinPhase.Alive);
    const p = player(w);
    p.hp = p.hpMax = 1e6;
    p.x = p.px = m.x + 40;
    p.z = p.pz = m.z + 10;
    return { w, m };
  }

  it('corruption (and so its speed / damage bonus) stays 0 while purgedUntil is in the future, then returns', () => {
    const { w, m } = metinLab();
    const row = spawn(w, 'wolf', m.x + 5, m.z);
    const id = w.enemies.id[row] as number;
    freezeEnemies(w);
    runTicks(w, 8);
    const E = w.enemies;
    expect(E.corrupted[E.find(id)]).toBeCloseTo(0.6, 5);
    E.purgedUntil[E.find(id)] = w.time + 1;
    runTicks(w, 8);
    expect(E.corrupted[E.find(id)]).toBe(0);
    runTicks(w, 70);
    expect(E.corrupted[E.find(id)]).toBeCloseTo(0.6, 5);
  });
});

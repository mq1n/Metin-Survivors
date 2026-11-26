// DT-01: the defeat report can say what killed the hero and where the run ended on the boss timeline.
//   * hurtPlayer records PlayerState.lastHitBy / lastHitAt on every blow that takes hit points; the real death (no revive left) freezes
//     it into killedBy / killedAt
//   * RunResult.killedBy / killedAt / nextBoss are filled by sim/progress.ts at the end of a lost run
// Every killer route of the shipped sim is played through the real systems (creature melee, a ranged creature's bolt, every boss pattern,
// a metin's aura / ring / impact, the lava and miasma under the hero), plus the bookkeeping edges (revive, ward, pause, abandon, co-op).

import { describe, expect, it } from 'vitest';
import shippedBosses from '../../data/content/bosses.json';
import type { BossDef, MetinDef } from '../../data/schema';
import { spawnBoss } from '../bosses';
import { hurtPlayer, HurtKind } from '../combat';
import { DEFEAT_DELAY, DT, Surface } from '../constants';
import { openLevelUp } from '../cards';
import { buildResult, deathRecord, nextBossAt } from '../progress';
import { runOptionsTable, type RunOptions } from '../run';
import { spawnProjectile, spawnZone } from '../skills/common';
import { ElementIdx, EnemyState, ProjKind, TelegraphAct, TelegraphShape, ZoneKind, type PlayerState } from '../stores';
import { addTelegraph } from '../telegraph';
import { MetinPhase, type WorldEnv } from '../types';
import type { World } from '../world';
import { freezeSchedules, makeWorld, NO_INPUT, player, runTicks, spawn, type TestWorldOpts } from './helpers';

const SORROW = 'metin_lament';

/** a quiet fixture world: no spawner, bosses or metins on their own, no hero skills, a one-hit-point hero (any landed blow kills) */
function quiet(o: TestWorldOpts = {}, hp = 1): World {
  const w = makeWorld(o);
  freezeSchedules(w);
  w.enemies.clear();
  w.spawner.alive = 0;
  const p = player(w);
  p.skills.length = 0;
  p.hp = p.hpMax = hp;
  p.x = p.px = 0;
  p.z = p.pz = 0;
  return w;
}

/** step until hero `i` is down (or `max` ticks); returns the ticks used */
function untilDown(w: World, i = 0, max = 60 * 60): number {
  const p = player(w, i);
  let n = 0;
  while (p.alive && n < max) {
    w.step([NO_INPUT]);
    n++;
  }
  return n;
}

/** a lethal blow dealt straight into hurtPlayer from a spot where nothing stands */
function strike(w: World, kind: number = HurtKind.Melee, srcEnemy = 0, x = 60, z = 60, element = 0, pi = 0): void {
  hurtPlayer(w, pi, 1e6, x, z, element, kind, srcEnemy);
}

describe('DT-01 hurtPlayer: lastHitBy / lastHitAt', () => {
  it('start empty: nothing recorded before the first blow', () => {
    const w = quiet();
    const p = player(w);
    expect([p.lastHitBy, p.lastHitAt, p.killedBy, p.killedAt]).toEqual(['', -1, '', -1]);
    expect(deathRecord(w, p)).toEqual({});
  });

  it('a creature that names itself is recorded by its EnemyDef id, at the run clock of the blow', () => {
    const w = quiet({}, 1000);
    const row = spawn(w, 'wolf', 2, 0);
    runTicks(w, 30);
    const p = player(w);
    expect(hurtPlayer(w, 0, 5, 2, 0, 0, HurtKind.Melee, w.enemies.id[row] as number)).toBe(true);
    expect(p.lastHitBy).toBe('wolf');
    expect(p.lastHitAt).toBeCloseTo(w.time, 9);
    expect(p.killedAt).toBe(-1);
  });

  it('a boss is recorded as boss:<id>; the creature that struck is read before its own thorns kill it', () => {
    const w = quiet({}, 1000);
    const p = player(w);
    p.stats.thorns = 1e6;
    const b = spawnBoss(w, 'boss_horyeong', false, 2, 0);
    expect(b).not.toBeNull();
    hurtPlayer(w, 0, 5, 2, 0, 0, HurtKind.Melee, b!.enemy);
    expect(p.lastHitBy).toBe('boss:boss_horyeong');
    const wolfRow = spawn(w, 'wolf', -2, 0);
    const wolf = w.enemies.id[wolfRow] as number;
    p.iframes = 0;
    hurtPlayer(w, 0, 5, -2, 0, 0, HurtKind.Melee, wolf);
    expect(w.enemies.find(wolf) < 0 || w.enemies.state[wolfRow] === EnemyState.Dying).toBe(true);
    expect(p.lastHitBy).toBe('wolf');
  });

  it('the latest landed blow wins; a blow a ward or the evasion roll took entirely hurts nobody', () => {
    const w = quiet({}, 1000);
    const p = player(w);
    const a = spawn(w, 'wolf', 2, 0);
    const b = spawn(w, 'bear', -2, 0);
    hurtPlayer(w, 0, 5, 2, 0, 0, HurtKind.Melee, w.enemies.id[a] as number);
    p.iframes = 0;
    p.shield = 1e6; // the trinket shield soaks everything: no hit points taken
    hurtPlayer(w, 0, 5, -2, 0, 0, HurtKind.Melee, w.enemies.id[b] as number);
    expect(p.lastHitBy).toBe('wolf');
    p.shield = 0;
    p.iframes = 0;
    hurtPlayer(w, 0, 5, -2, 0, 0, HurtKind.Melee, w.enemies.id[b] as number);
    expect(p.lastHitBy).toBe('bear');
  });

  it('a blow whose source cannot be told leaves lastHitBy empty (never a stale earlier killer)', () => {
    const w = quiet({}, 1000);
    const p = player(w);
    const a = spawn(w, 'wolf', 2, 0);
    hurtPlayer(w, 0, 5, 2, 0, 0, HurtKind.Melee, w.enemies.id[a] as number);
    expect(p.lastHitBy).toBe('wolf');
    p.iframes = 0;
    hurtPlayer(w, 0, 5, 40, 40, 0, HurtKind.Projectile);
    expect(p.lastHitBy).toBe('');
    p.iframes = 0;
    hurtPlayer(w, 0, 5, 40, 40, 0, HurtKind.Hazard);
    expect(p.lastHitBy).toBe('');
  });
});

describe('DT-01 killer per source, through the real systems', () => {
  it('a melee creature: the wolf that bites the last hit point', () => {
    const w = quiet();
    spawn(w, 'wolf', 1.5, 0);
    expect(untilDown(w)).toBeLessThan(60 * 20);
    const p = player(w);
    expect(p.killedBy).toBe('wolf');
    expect(p.killedAt).toBeGreaterThan(0);
    expect(p.killedAt).toBeLessThanOrEqual(w.time + 1e-9);
  });

  it('the same on hard with the Run Options at their maximum', () => {
    const t = runOptionsTable(makeWorld().balance);
    const max: Partial<RunOptions> = { density: t.density.max, health: t.health.max, damage: t.damage.max, speed: t.speed.max };
    const w = quiet({ config: { difficulty: 'hard', runOptions: max } });
    spawn(w, 'bear', 1.5, 0);
    untilDown(w);
    expect(player(w).killedBy).toBe('bear');
  });

  it('a ranged creature: the bolt is traced back to the spitter, not to the bear standing beside it', () => {
    const w = quiet();
    const shooter = spawn(w, 'spitter', 7, 0);
    const decoy = spawn(w, 'bear', 7.8, 0.6);
    w.enemies.state[decoy] = EnemyState.Recover;
    w.enemies.aiT[decoy] = 1e9;
    untilDown(w);
    expect(player(w).alive).toBe(false);
    expect(w.enemies.id[shooter]).toBeGreaterThan(0);
    expect(player(w).killedBy).toBe('spitter');
  });

  it('an aura creature (fixture plague_rat strikes by aura): named by its own spot', () => {
    const w = quiet();
    spawn(w, 'plague_rat', 1.2, 0);
    untilDown(w);
    expect(player(w).killedBy).toBe('plague_rat');
  });

  /**
   * Every pattern kind of data/content/bosses.json that can hurt a hero ('summon' and 'enrage' only change the fight). The fixture boss does not
   * own all of them, so each is built from scratch on it (one phase, one pattern, no melee attack, no escorts); the params are tightened so the
   * pattern reaches a hero `heroX` m from the origin. The shipped bosses use the same kinds with their own numbers.
   */
  const DAMAGING_PATTERNS: [kind: BossDef['patterns'][number]['kind'], params: Record<string, number>, heroX: number][] = [
    ['slam', { radius: 3, atPlayer: 1 }, 8],
    ['charge', { length: 14, width: 2.6, speed: 16 }, 8],
    ['volley', { count: 5, spread: 0.6, speed: 9 }, 3],
    ['ring', { count: 14, speed: 7 }, 3],
    ['meteor', { count: 6, interval: 0.2, radius: 3.5, spread: 1, delay: 0.5 }, 8],
    ['breath', { length: 14, angle: 1.4, duration: 3, tick: 0.3 }, 6],
    ['nova', { radius: 14 }, 6],
    // lands ON the hero (range 1 = a one-metre hop): the landing spot is an f64 point the f32 boss row only approximates (the DT-01 r1 defect)
    ['teleport', { range: 1, radius: 3.5 }, 8],
  ];

  for (const [pattern, params, heroX] of DAMAGING_PATTERNS) {
    it(`a boss pattern (${pattern}): boss:boss_horyeong, on every seed`, () => {
      for (const seed of [1, 2, 3, 4]) {
        const w = quiet({
          config: { seed },
          content: (c) => {
            const d = c.bosses.find((b) => b.id === 'boss_horyeong') as BossDef;
            d.phases = [{ hpPct: 1, patterns: [pattern] }];
            d.patterns = [{ id: pattern, kind: pattern, cooldown: 1, windup: 0.4, params }];
            d.attacks = [];
            d.escorts = [];
          },
        });
        const p = player(w);
        p.x = p.px = heroX;
        spawnBoss(w, 'boss_horyeong', false, pattern === 'teleport' ? 0 : -4, 0);
        untilDown(w, 0, 60 * 40);
        expect(p.alive, `${pattern} seed ${seed} never reached the hero`).toBe(false);
        expect(p.killedBy, `${pattern} seed ${seed}`).toBe('boss:boss_horyeong');
      }
    });
  }

  it('the table above covers every pattern kind the shipped bosses use, summon and enrage aside', () => {
    const shipped = new Set(shippedBosses.flatMap((b) => b.patterns.map((x) => x.kind)));
    shipped.delete('summon');
    shipped.delete('enrage');
    expect([...shipped].sort()).toEqual(DAMAGING_PATTERNS.map(([kind]) => kind).sort());
  });

  it('a boss telegraph that resolves on its own (no striker handle): the nearest boss, none when no boss stands', () => {
    const w = quiet();
    spawnBoss(w, 'boss_horyeong', false, -6, 0);
    addTelegraph(w, { shape: TelegraphShape.Circle, x: 0, z: 0, radius: 3, dur: 0.2, owner: 1, act: TelegraphAct.Impact, damage: 100, element: 0 });
    untilDown(w, 0, 60);
    expect(player(w).killedBy).toBe('boss:boss_horyeong');

    const bare = quiet();
    addTelegraph(bare, { shape: TelegraphShape.Circle, x: 0, z: 0, radius: 3, dur: 0.2, owner: 1, act: TelegraphAct.Impact, damage: 100, element: 0 });
    untilDown(bare, 0, 60);
    expect(player(bare).alive).toBe(false);
    expect(player(bare).killedBy).toBe('');
    expect(player(bare).killedAt).toBeGreaterThan(0);
  });

  /** a world with the first stone about to fall, its modifier set; returns the landed stone */
  function metinWorld(mod: MetinDef['modifier'], params: Record<string, number>, hp = 1000): { w: World; m: NonNullable<World['metins'][number]> } {
    const w = quiet(
      {
        content: (c) => {
          c.zones[0]!.metins.types = [SORROW];
          c.zones[0]!.metins.interval = [1e6, 1e6];
          for (const d of c.metins) {
            d.swarm.every = 1e9;
            d.awakenAfter = 1e6;
          }
          const sorrow = c.metins.find((d) => d.id === SORROW) as MetinDef;
          sorrow.modifier = mod;
          sorrow.modParams = params;
        },
      },
      hp,
    );
    w.metinSys.finalStarted = false;
    w.metinSys.nextFallAt = 0;
    runTicks(w, 1);
    const m = w.metins[0];
    if (!m) throw new Error('no metin fell');
    player(w).x = player(w).px = m.x + 40;
    for (let i = 0; i < 400 && m.phase === MetinPhase.Falling; i++) w.step([NO_INPUT]);
    expect(m.phase).toBe(MetinPhase.Alive);
    return { w, m };
  }

  it('a metin damage aura: metin:<id>', () => {
    const { w, m } = metinWorld('damageAura', { radius: 13, dps: 40 });
    const p = player(w);
    p.hp = p.hpMax = 1;
    p.x = p.px = m.x + 9;
    p.z = p.pz = m.z;
    untilDown(w, 0, 60 * 10);
    expect(p.alive).toBe(false);
    expect(p.killedBy).toBe(`metin:${SORROW}`);
  });

  it('a metin fire ring (a ground field, struck from a blob on the ring): metin:<id>', () => {
    const { w, m } = metinWorld('fireRing', { radius: 13, ringRadius: 6, blob: 1.1, damage: 40 });
    const p = player(w);
    p.hp = p.hpMax = 1;
    p.x = p.px = m.x + 6;
    p.z = p.pz = m.z;
    untilDown(w, 0, 60 * 10);
    expect(p.alive).toBe(false);
    expect(p.killedBy).toBe(`metin:${SORROW}`);
  });

  it('the impact of a falling metin: metin:<id>', () => {
    const w = quiet(
      {
        content: (c) => {
          c.zones[0]!.metins.types = [SORROW];
          c.zones[0]!.metins.interval = [1e6, 1e6];
          for (const d of c.metins) d.swarm.every = 1e9;
        },
      },
      1,
    );
    w.metinSys.finalStarted = false;
    w.metinSys.nextFallAt = 0;
    runTicks(w, 1);
    const m = w.metins[0];
    if (!m) throw new Error('no metin fell');
    const p = player(w);
    p.x = p.px = m.x + 0.5;
    p.z = p.pz = m.z;
    untilDown(w, 0, 60 * 10);
    expect(p.alive).toBe(false);
    expect(p.killedBy).toBe(`metin:${SORROW}`);
  });

  it('a hostile ground zone: its metin, or hazard:zone when it belongs to nobody', () => {
    const w = quiet();
    spawnZone(w, { kind: ZoneKind.Circle, team: 1, x: 5, z: 0, radius: 3, dur: 100, tick: 0.2, damage: 50, preset: 'vfx_hazard', element: ElementIdx.Poison, owner: 0, skill: 255 });
    const p = player(w);
    p.x = p.px = 5;
    untilDown(w, 0, 60 * 5);
    expect(p.killedBy).toBe('hazard:zone');
  });

  /** the terrain the app hands the sim: `surface` under the whole arena */
  const floor = (surface: number): WorldEnv => ({ arenaRadius: 100, surfaceAt: () => surface });

  it('lava under the hero: hazard:lava (stub env with surfaceAt)', () => {
    const w = quiet({ env: floor(Surface.Lava) }, 40);
    untilDown(w, 0, 60 * 30);
    const p = player(w);
    expect(p.alive).toBe(false);
    expect(p.killedBy).toBe('hazard:lava');
  });

  it('miasma under the hero: hazard:miasma', () => {
    const w = quiet({ env: floor(Surface.Miasma) }, 40);
    untilDown(w, 0, 60 * 60);
    expect(player(w).alive).toBe(false);
    expect(player(w).killedBy).toBe('hazard:miasma');
  });

  it('shallow water and ice hurt nobody and record nothing; an env without surfaceAt has no hazards at all', () => {
    for (const env of [floor(Surface.Shallow), floor(Surface.Ice), floor(Surface.Deep), { arenaRadius: 100 }]) {
      const w = quiet({ env }, 100);
      runTicks(w, 60 * 12);
      const p = player(w);
      expect(p.hp).toBe(100);
      expect([p.lastHitBy, p.lastHitAt]).toEqual(['', -1]);
    }
  });

  it('stepping off the lava does not leave a stale hazard: the next creature blow is the killer', () => {
    let surface: number = Surface.Lava;
    const w = quiet({ env: { arenaRadius: 100, surfaceAt: () => surface } }, 10000);
    runTicks(w, 60 * 2);
    expect(player(w).lastHitBy).toBe('hazard:lava');
    surface = Surface.Ground;
    const p = player(w);
    p.hp = p.hpMax = 1;
    spawn(w, 'wolf', 1.5, 0);
    untilDown(w);
    expect(p.killedBy).toBe('wolf');
  });
});

describe('DT-01 death bookkeeping', () => {
  it('a revive is not a death: killedAt stays unset, the final death names the final killer', () => {
    const w = quiet();
    const p = player(w);
    p.stats.revives = 1;
    const first = spawn(w, 'wolf', 2, 0);
    strike(w, HurtKind.Melee, w.enemies.id[first] as number);
    expect(p.alive).toBe(true);
    expect(p.revivesUsed).toBe(1);
    expect(p.lastHitBy).toBe('wolf');
    expect([p.killedBy, p.killedAt]).toEqual(['', -1]);
    expect(deathRecord(w, p)).toEqual({});
    w.enemies.clear(); // the wolf would keep biting
    runTicks(w, 60 * 4); // past the 3 s revive i-frames
    p.x = p.px = 0;
    p.iframes = 0;
    const bear = spawn(w, 'bear', 2, 0);
    p.hp = 1;
    strike(w, HurtKind.Melee, w.enemies.id[bear] as number);
    expect(p.alive).toBe(false);
    expect(p.killedBy).toBe('bear');
    expect(p.killedAt).toBeCloseTo(w.time, 9);
  });

  it('a hero dropped without a blow (co-op guest left) has no death record, even with an older blow on file', () => {
    const w = quiet({}, 1000);
    const p = player(w);
    const row = spawn(w, 'wolf', 2, 0);
    hurtPlayer(w, 0, 5, 2, 0, 0, HurtKind.Melee, w.enemies.id[row] as number);
    p.alive = false;
    p.hp = 0;
    expect(p.killedAt).toBe(-1);
    expect(deathRecord(w, p)).toEqual({});
  });

  it('a modal that holds the clock does not move the moment of the death (the run clock counts unpaused play only)', () => {
    const w = quiet({}, 1000);
    const p = player(w);
    runTicks(w, 60 * 3);
    const row = spawn(w, 'wolf', 2, 0);
    hurtPlayer(w, 0, 5, 2, 0, 0, HurtKind.Melee, w.enemies.id[row] as number);
    const hitAt = p.lastHitAt;
    openLevelUp(w, p, 2);
    expect(w.modal).not.toBeNull();
    const t0 = w.time;
    runTicks(w, 600);
    expect(w.time).toBe(t0);
    expect(p.lastHitAt).toBe(hitAt);
    p.iframes = 0;
    p.hp = 1;
    strike(w, HurtKind.Melee, w.enemies.id[row] as number);
    expect(p.killedAt).toBe(t0);
  });

  it('feature bookkeeping draws no random number: the combat stream is untouched by recording a blow', () => {
    const a = quiet({}, 1000);
    const b = quiet({}, 1000);
    const ra = spawn(a, 'wolf', 2, 0);
    const rb = spawn(b, 'wolf', 2, 0);
    // hurtPlayer's own rolls (evasion) are the same in both; the resolver adds none
    hurtPlayer(a, 0, 5, 2, 0, 0, HurtKind.Melee, a.enemies.id[ra] as number);
    hurtPlayer(b, 0, 5, 40, 40, 0, HurtKind.Melee, 0); // unresolvable source: the scans run, nothing is recorded
    expect(a.rng.combat.next()).toBe(b.rng.combat.next());
    expect(a.enemies.id[rb]).toBeDefined();
  });
});

describe('DT-01 RunResult: killedBy / killedAt / nextBoss', () => {
  // fixture zone: bosses at 180 (horyeong) and 480 (ork chief), the final at 900 (red dragon)
  it('nextBoss follows the boss timeline: before and after each slot, then the final, then nothing', () => {
    const w = quiet();
    expect(nextBossAt(w, 0)).toEqual({ id: 'boss_horyeong', inSec: 180 });
    expect(nextBossAt(w, 100)).toEqual({ id: 'boss_horyeong', inSec: 80 });
    expect(nextBossAt(w, 179.5)?.id).toBe('boss_horyeong');
    expect(nextBossAt(w, 180)).toEqual({ id: 'boss_ork_chief', inSec: 300 });
    expect(nextBossAt(w, 300)).toEqual({ id: 'boss_ork_chief', inSec: 180 });
    expect(nextBossAt(w, 480)).toEqual({ id: 'boss_scarlet_wyrm', inSec: 420 });
    expect(nextBossAt(w, 899)).toEqual({ id: 'boss_scarlet_wyrm', inSec: 1 });
    expect(nextBossAt(w, 900)).toBeNull();
    expect(nextBossAt(w, 1200)).toBeNull();
  });

  it('a defeat carries killer, moment and the next boss; the moment is the blow, not the end of the outro', () => {
    for (const [t, next, inSec] of [[100, 'boss_horyeong', 80], [200, 'boss_ork_chief', 280], [600, 'boss_scarlet_wyrm', 300]] as const) {
      const w = quiet();
      w.time = t;
      const row = spawn(w, 'wolf', 2, 0);
      strike(w, HurtKind.Melee, w.enemies.id[row] as number);
      const r = buildResult(w, false);
      expect(r.killedBy).toBe('wolf');
      expect(r.killedAt).toBeCloseTo(t, 9);
      expect(r.nextBoss?.id).toBe(next);
      expect(r.nextBoss?.inSec).toBeCloseTo(inSec, 9);
    }
  });

  it('the full flow: death, the outro, the run-end result and its modal', () => {
    const w = quiet();
    spawn(w, 'wolf', 1.5, 0);
    for (let i = 0; i < 60 * 60 && !w.over; i++) w.step([NO_INPUT]);
    expect(w.over).toBe(true);
    expect(w.victory).toBe(false);
    const r = w.result!;
    expect(r.killedBy).toBe('wolf');
    expect(r.killedAt).toBe(player(w).killedAt);
    expect(r.time - (r.killedAt as number)).toBeGreaterThanOrEqual(DEFEAT_DELAY - 2 * DT);
    expect(r.time - (r.killedAt as number)).toBeLessThanOrEqual(DEFEAT_DELAY + 3 * DT);
    expect(r.nextBoss?.id).toBe('boss_horyeong');
    expect(r.nextBoss?.inSec).toBeCloseTo(180 - (r.killedAt as number), 9);
    const modal = w.modals.find((m) => m.kind === 'runEnd');
    expect(modal && 'result' in modal ? modal.result : null).toBe(r);
  });

  it('an unnamed killer still ends the run on the timeline: killedAt and nextBoss without killedBy', () => {
    const w = quiet();
    w.time = 50;
    strike(w, HurtKind.Projectile, 0, 70, 70);
    const r = buildResult(w, false);
    expect(r.killedBy).toBeUndefined();
    expect('killedBy' in r).toBe(false);
    expect(r.killedAt).toBeCloseTo(50, 9);
    expect(r.nextBoss).toEqual({ id: 'boss_horyeong', inSec: 130 });
  });

  it('a victory, a run abandoned with the hero still standing and a run with a hero still standing carry none of the three', () => {
    const w = quiet({}, 1000);
    const row = spawn(w, 'wolf', 2, 0);
    hurtPlayer(w, 0, 5, 2, 0, 0, HurtKind.Melee, w.enemies.id[row] as number);
    for (const r of [buildResult(w, false), buildResult(w, true)]) {
      expect('killedBy' in r || 'killedAt' in r || 'nextBoss' in r).toBe(false);
    }
    const dead = quiet();
    strike(dead, HurtKind.Melee, dead.enemies.id[spawn(dead, 'wolf', 2, 0)] as number);
    const won = buildResult(dead, true);
    expect('killedBy' in won || 'killedAt' in won || 'nextBoss' in won).toBe(false);
  });

  it('the record follows the hero, not how the run ended: a run abandoned after the hero fell keeps it (RunResult.killedBy doc)', () => {
    const w = quiet();
    w.time = 100;
    strike(w, HurtKind.Melee, w.enemies.id[spawn(w, 'wolf', 2, 0)] as number);
    expect(player(w).alive).toBe(false);
    // `false` is how an abandon (pause menu -> quit) and a defeat both reach buildResult: the fallen hero is on file either way
    const left = buildResult(w, false);
    expect([left.killedBy, left.killedAt, left.nextBoss?.id]).toEqual(['wolf', 100, 'boss_horyeong']);
    // and a victory never carries one, even with the hero down
    expect('killedBy' in buildResult(w, true) || 'killedAt' in buildResult(w, true) || 'nextBoss' in buildResult(w, true)).toBe(false);
  });

  it('after the final boss had arrived nextBoss is absent (killedBy and killedAt stay)', () => {
    const w = quiet();
    w.time = 950;
    strike(w, HurtKind.Melee, spawnBoss(w, 'boss_scarlet_wyrm', true, 3, 0)!.enemy);
    const r = buildResult(w, false);
    expect(r.killedBy).toBe('boss:boss_scarlet_wyrm');
    expect(r.killedAt).toBeCloseTo(950, 9);
    expect('nextBoss' in r).toBe(false);
  });

  it('co-op: the party result names the hero that fell last; a hero still standing means no record', () => {
    const w = quiet({ config: { coop: [{ classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'chowon', meta: { stats: {} } }] } });
    const [a, b] = [player(w, 0), player(w, 1)] as [PlayerState, PlayerState];
    for (const p of [a, b]) p.hp = p.hpMax = 1;
    w.time = 40;
    strike(w, HurtKind.Melee, w.enemies.id[spawn(w, 'bear', 1, 0)] as number, 60, 60, 0, 1);
    expect(b.alive).toBe(false);
    expect(buildResult(w, false).killedAt).toBeUndefined(); // hero 0 still stands: the run is not lost
    w.time = 70;
    strike(w, HurtKind.Melee, w.enemies.id[spawn(w, 'wolf', 1, 1)] as number, 60, 60, 0, 0);
    const r = buildResult(w, false);
    expect(r.killedBy).toBe('wolf');
    expect(r.killedAt).toBeCloseTo(70, 9);
    expect(deathRecord(w, b).killedBy).toBe('bear');
    expect(deathRecord(w, b).killedAt).toBeCloseTo(40, 9);
  });
});

describe('DT-01 hazard routes the sim shipped without', () => {
  it('ProjKind.Hostile rows with no shooter alive record nothing rather than a guess', () => {
    const w = quiet();
    spawnProjectile(w, { kind: ProjKind.Hostile, x: 3, z: 0, vx: -6, vz: 0, radius: 0.4, life: 3, damage: 50, element: 0, owner: 0, skill: 255, pierce: 0, preset: 'vfx_enemy_bolt' });
    untilDown(w, 0, 60 * 5);
    expect(player(w).alive).toBe(false);
    expect(player(w).killedBy).toBe('');
  });
});

// Full-run headless autoplayer: a bot kites in circles, collects pickups, walks to metins, fights bosses and picks the
// first card of every offer. Asserts global invariants over the whole run.

import { beforeAll, describe, expect, it } from 'vitest';
import type { StatMods } from '../../data/schema';
import { CAP, ENEMY_SOFT_CAP } from '../constants';
import { EnemyFlag } from '../stores';
import type { World } from '../world';
import { runBot } from './bot';
import { findNonFinite, makeWorld } from './helpers';

interface Observed {
  maxAlive: number;
  maxEnemyRows: number;
  maxProjectiles: number;
  maxPickups: number;
  maxZones: number;
  maxTelegraphs: number;
  nonFinite: string | null;
  metinsSeen: Set<string>;
  bossesSeen: Set<string>;
  corruptedSeen: boolean;
  modalsSeen: Set<string>;
}

interface Run {
  w: World;
  obs: Observed;
  ticks: number;
}

/** a sturdier hero (meta bonuses) so the bot reliably reaches the final fight on every JS engine */
const SEASONED: StatMods = { maxHpPct: 4, armor: 80, regen: 6, damage: 0.6 };

function observe(seed: number, difficulty: 'normal' | 'hard', maxSeconds: number, stats: StatMods = {}): Run {
  const w = makeWorld({ config: { seed, difficulty, meta: { stats } } });
  const obs: Observed = {
    maxAlive: 0,
    maxEnemyRows: 0,
    maxProjectiles: 0,
    maxPickups: 0,
    maxZones: 0,
    maxTelegraphs: 0,
    nonFinite: null,
    metinsSeen: new Set(),
    bossesSeen: new Set(),
    corruptedSeen: false,
    modalsSeen: new Set(),
  };
  const run = runBot(w, maxSeconds, (world, tick) => {
    obs.maxAlive = Math.max(obs.maxAlive, world.spawner.alive);
    obs.maxEnemyRows = Math.max(obs.maxEnemyRows, world.enemies.count);
    obs.maxProjectiles = Math.max(obs.maxProjectiles, world.projectiles.count);
    obs.maxPickups = Math.max(obs.maxPickups, world.pickups.count);
    obs.maxZones = Math.max(obs.maxZones, world.zones.count);
    obs.maxTelegraphs = Math.max(obs.maxTelegraphs, world.telegraphs.count);
    for (const m of world.metins) obs.metinsSeen.add(m.def.id);
    for (const b of world.bosses) obs.bossesSeen.add(b.def.id);
    if (world.modal) obs.modalsSeen.add(world.modal.kind);
    if (tick % 30 === 0) {
      if (obs.nonFinite === null) obs.nonFinite = findNonFinite(world);
      if (!obs.corruptedSeen) {
        for (let i = 0; i < world.enemies.count; i++) {
          if ((world.enemies.corrupted[i] as number) > 0) {
            obs.corruptedSeen = true;
            break;
          }
        }
      }
    }
  });
  return { w, obs, ticks: run.ticks };
}

const LONG = 240_000;

describe('autoplayer: full 15-minute run (normal, seasoned hero)', () => {
  let run: Run;
  beforeAll(() => {
    run = observe(1234, 'normal', 1500, SEASONED);
  }, LONG);

  it('the run ends (victory or defeat) well within the time budget', () => {
    const { w, ticks } = run;
    expect(w.over).toBe(true);
    expect(w.result).not.toBeNull();
    expect(ticks / 60).toBeLessThan(1500);
    expect(w.modals.some((m) => m.kind === 'runEnd')).toBe(true);
  });

  it('never produces NaN/Infinity in any store or player field', () => {
    expect(run.obs.nonFinite).toBeNull();
    expect(findNonFinite(run.w)).toBeNull();
  });

  it('respects the entity caps', () => {
    const { obs } = run;
    expect(obs.maxEnemyRows).toBeLessThanOrEqual(CAP.enemies);
    expect(obs.maxAlive).toBeLessThanOrEqual(ENEMY_SOFT_CAP + 60);
    expect(obs.maxProjectiles).toBeLessThanOrEqual(CAP.projectiles);
    expect(obs.maxPickups).toBeLessThanOrEqual(CAP.pickups);
    expect(obs.maxZones).toBeLessThanOrEqual(CAP.zones);
    expect(obs.maxTelegraphs).toBeLessThanOrEqual(CAP.telegraphs);
    // the field actually fills up
    expect(obs.maxAlive).toBeGreaterThan(150);
  });

  it('levels into a sane range for a 15-minute run', () => {
    const result = run.w.result;
    expect(result?.level).toBeGreaterThanOrEqual(25);
    expect(result?.level).toBeLessThanOrEqual(100);
    expect(result?.kills).toBeGreaterThan(2000);
  });

  it('metins fall, corrupt, awaken and get broken', () => {
    const { obs } = run;
    const result = run.w.result;
    expect(obs.metinsSeen.size).toBeGreaterThanOrEqual(2);
    expect(obs.metinsSeen.has('metin_great')).toBe(true);
    expect(obs.corruptedSeen).toBe(true);
    expect(result?.metinsBroken).toBeGreaterThanOrEqual(3);
    expect(result?.metinTypesBroken.length).toBe(result?.metinsBroken);
    expect(result?.maxCorruption).toBeGreaterThan(0.15);
    expect(obs.modalsSeen.has('essence')).toBe(true);
  });

  it('bosses spawn on schedule and the final boss ends the run in victory', () => {
    const { obs } = run;
    const result = run.w.result;
    expect(obs.bossesSeen.has('boss_horyeong')).toBe(true);
    expect(obs.bossesSeen.has('boss_ork_chief')).toBe(true);
    expect(obs.bossesSeen.has('boss_scarlet_wyrm')).toBe(true);
    expect(result?.victory).toBe(true);
    expect(result?.bossesKilled).toEqual(['boss_horyeong', 'boss_ork_chief', 'boss_scarlet_wyrm']);
    expect(obs.modalsSeen.has('bossReward')).toBe(true);
    expect(obs.modalsSeen.has('levelUp')).toBe(true);
    expect(obs.modalsSeen.has('chest')).toBe(true);
  });

  it('reports a complete RunResult', () => {
    const result = run.w.result;
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.time).toBeGreaterThan(900);
    expect(result.time).toBeLessThan(1400);
    expect(result.yeop).toBeGreaterThan(0);
    expect(result.yeopLeft).toBeGreaterThan(0);
    expect(result.shards).toBeGreaterThan(0);
    expect(result.chestsOpened).toBeGreaterThan(0);
    expect(result.damageDealt).toBeGreaterThan(100000);
    expect(result.damageBySkill.length).toBeGreaterThanOrEqual(5);
    const dmg = result.damageBySkill.map((s) => s.damage);
    expect([...dmg].sort((a, b) => b - a)).toEqual(dmg);
    expect(result.zone).toBe('fx_plains');
    expect(result.players).toHaveLength(1);
    expect(result.talentXp).toBeGreaterThan(0);
  });

  it('leaves no metin hit-rows behind that point at dead metins', () => {
    const { w } = run;
    for (let i = 0; i < w.enemies.count; i++) {
      if (((w.enemies.flags[i] as number) & EnemyFlag.Metin) === 0) continue;
      const owner = w.metins.find((m) => m.enemy === w.enemies.id[i]);
      expect(owner).toBeDefined();
    }
  });
});

describe('autoplayer: determinism', () => {
  it('the same seed gives bit-identical outcomes; a different seed differs', () => {
    const a = observe(77, 'normal', 420, SEASONED);
    const b = observe(77, 'normal', 420, SEASONED);
    const c = observe(78, 'normal', 420, SEASONED);
    const snap = (w: World): string =>
      JSON.stringify({
        t: w.time,
        k: w.tally.kills,
        d: w.tally.damageDealt,
        p: w.players.map((p) => [p.x, p.z, p.hp, p.level, p.xp, p.yeop]),
        e: Array.from(w.enemies.x.subarray(0, w.enemies.count)),
        rng: w.rng.combat.getState(),
      });
    expect(snap(a.w)).toBe(snap(b.w));
    expect(snap(a.w)).not.toBe(snap(c.w));
  }, LONG);
});

describe('autoplayer: plain hero and hard difficulty', () => {
  it('a plain hero run ends and keeps every invariant (it may well die early)', () => {
    const { w, obs } = observe(1234, 'normal', 1500);
    expect(w.over).toBe(true);
    expect(obs.nonFinite).toBeNull();
    expect(obs.bossesSeen.has('boss_horyeong') || w.time < 180).toBe(true);
    expect(obs.maxEnemyRows).toBeLessThanOrEqual(CAP.enemies);
    expect(w.result?.time).toBeGreaterThan(60);
  }, LONG);

  it('hard mode runs to completion without invariant violations', () => {
    const { w, obs } = observe(4242, 'hard', 1500, SEASONED);
    expect(w.over).toBe(true);
    expect(obs.nonFinite).toBeNull();
    expect(obs.maxEnemyRows).toBeLessThanOrEqual(CAP.enemies);
    expect(obs.maxAlive).toBeLessThanOrEqual(ENEMY_SOFT_CAP + 60);
    expect(w.result?.difficulty).toBe('hard');
  }, LONG);
});

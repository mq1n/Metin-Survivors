// The sim against the REAL content (data/content/*.json via data/loader): one class per zone is played by the autoplayer
// bot with a very strong hero, so each run reaches the zone's final fight: scheduled bosses with escorts, metin waves,
// the Great Metin, the final boss and victory. Also one hard-mode run with every Run Option raised.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import type { ClassId } from '../../data/schema';
import { CAP } from '../constants';
import { createWorld, type World } from '../world';
import { clampRunOptions, runOptionsReward, runOptionsTable, type RunOptions } from '../run';
import { runBot } from './bot';
import { findNonFinite } from './helpers';

const GOD = { maxHpPct: 8, armor: 150, regen: 10, damage: 3 };
const LONG = 280_000;

interface Observed {
  maxAlive: number;
  nonFinite: string | null;
  modals: Set<string>;
  escortSpawns: number;
}

function play(zone: string, classId: ClassId, difficulty: 'normal' | 'hard', runOptions?: Partial<RunOptions>): { w: World; obs: Observed } {
  const cls = content.classes.find((c) => c.id === classId);
  if (!cls) throw new Error(`unknown class ${classId}`);
  const w = createWorld({ zone, difficulty, classId, doctrine: 'a', sex: cls.sexes[0] ?? 'm', empire: 'saehwa', seed: 7, meta: { stats: GOD }, runOptions }, content);
  const obs: Observed = { maxAlive: 0, nonFinite: null, modals: new Set(), escortSpawns: 0 };
  runBot(w, 1700, (world, tick) => {
    obs.maxAlive = Math.max(obs.maxAlive, world.spawner.alive);
    if (world.modal) obs.modals.add(world.modal.kind);
    for (const e of world.events) if (e.t === 'enemySpawn' && e.source === 3) obs.escortSpawns++;
    if (tick % 600 === 0 && obs.nonFinite === null) obs.nonFinite = findNonFinite(world);
  });
  return { w, obs };
}

const CASES: [string, ClassId][] = [
  ['yeonmu', 'warrior'],
  ['suryeon', 'ninja'],
  ['seori', 'yacha'],
  ['daeryeol', 'shaman'],
];

describe('real content: a full run per zone', () => {
  for (const [zoneId, classId] of CASES) {
    it(`${zoneId} / ${classId}: bosses with escorts, metins, final boss, victory`, () => {
      const zone = content.zones.find((z) => z.id === zoneId);
      if (!zone) throw new Error(`unknown zone ${zoneId}`);
      const { w, obs } = play(zoneId, classId, 'normal');
      const r = w.result;
      expect(r, 'the run produced a result').not.toBeNull();
      if (!r) return;
      // eslint-disable-next-line no-console
      console.log(`${zoneId}/${classId}: victory=${r.victory} t=${r.time.toFixed(0)} lvl=${r.level} kills=${r.kills} metins=${r.metinsBroken}/${r.metinsAwakened} bosses=${r.bossesKilled.length} chests=${r.chestsOpened} maxAlive=${obs.maxAlive}`);
      expect(obs.nonFinite).toBeNull();
      expect(obs.maxAlive).toBeLessThanOrEqual(CAP.enemies);
      expect(r.victory).toBe(true);
      expect(r.zone).toBe(zoneId);
      // every scheduled boss and the final boss fell, the final boss last
      for (const b of zone.bosses) expect(r.bossesKilled).toContain(b.boss);
      expect(r.bossesKilled[r.bossesKilled.length - 1]).toBe(zone.final.boss);
      // escorts: any boss with an escort list brought them
      const escorted = [...zone.bosses.map((b) => b.boss), zone.final.boss].filter((id) => (content.bosses.find((b) => b.id === id)?.escorts?.length ?? 0) > 0);
      if (escorted.length > 0) expect(obs.escortSpawns).toBeGreaterThanOrEqual(6 * escorted.length * 0.5);
      for (const kind of ['levelUp', 'bossReward', 'chest']) expect(obs.modals.has(kind), kind).toBe(true);
      expect(r.rewardMul).toBe(1);
      expect(r.runOptions).toEqual({ density: 1, health: 1, damage: 1, speed: 1 });
      expect(r.yeop).toBeGreaterThan(1000);
      expect(r.damageDealt).toBeGreaterThan(r.kills);
    }, LONG);
  }
});

describe('real content: hard mode with every Run Option raised', () => {
  it('stays finite and bounded, and reports the stacked reward multiplier', () => {
    const table = runOptionsTable(content.balance);
    const asked = { density: 2, health: 1.5, damage: 1.25, speed: 1.25 };
    const { w, obs } = play('yeonmu', 'warrior', 'hard', asked);
    const r = w.result ?? w.buildResult(false);
    expect(obs.nonFinite).toBeNull();
    expect(obs.maxAlive).toBeLessThanOrEqual(CAP.enemies);
    expect(r.runOptions).toEqual(clampRunOptions(asked, table));
    expect(r.rewardMul).toBeCloseTo(content.balance.hard.reward * runOptionsReward(asked, table), 9);
    expect(r.rewardMul).toBeGreaterThan(content.balance.hard.reward);
    expect(r.time).toBeGreaterThan(120);
  }, LONG);
});

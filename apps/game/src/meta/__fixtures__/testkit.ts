// Shared helpers for meta tests.

import type { ClassId } from '../../data/schema';
import type { RunResult } from '../../sim/run';
import { newProfile } from '../save';
import { seededRng } from '../rng';
import type { SaveData } from '../types';
import { fixtureContent } from './content';

export const NOW = 1_700_000_000_000;

export function freshSave(seed = 1): SaveData {
  return newProfile(fixtureContent, { now: NOW, rng: seededRng(seed), name: 'Tester' });
}

/** A hard-mode run carries the hard reward the way the sim reports it (`rewardMul`). */
export function makeRun(over: Partial<RunResult> = {}): RunResult {
  const difficulty = over.difficulty ?? 'normal';
  return {
    victory: false,
    time: 600,
    kills: 500,
    elitesKilled: 10,
    level: 30,
    yeop: 4000,
    yeopLeft: 1200,
    shards: 6,
    metinsBroken: 4,
    metinTypesBroken: ['yeonmu_metin', 'yeonmu_metin', 'yeonmu_metin', 'yeonmu_metin'],
    metinsAwakened: 1,
    bossesKilled: [],
    chestsOpened: 3,
    maxCorruption: 0.4,
    damageTaken: 1000,
    damageDealt: 100000,
    damageBySkill: [],
    zone: 'yeonmu',
    difficulty,
    classId: 'warrior' as ClassId,
    doctrine: 'a',
    seed: 12345,
    talentXp: 0,
    runOptions: { density: 1, health: 1, damage: 1, speed: 1 },
    rewardMul: difficulty === 'hard' ? fixtureContent.balance.hard.reward : 1,
    players: [{ index: 0, level: 30, kills: 500, yeop: 4000, alive: false }],
    ...over,
  };
}

/** A save with a given amount of class XP / currencies for the warrior. */
export function richSave(opts: { xp?: number; yeop?: number; shards?: number } = {}): SaveData {
  const s = freshSave();
  s.classes.warrior.xp = opts.xp ?? 0;
  s.bank.yeop = opts.yeop ?? 0;
  s.bank.shards = opts.shards ?? 0;
  return s;
}

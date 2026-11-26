// Shared helpers for sim tests (headless, fixture content).

import type { ContentDB } from '../../data/schema';
import { cloneContent, fixtureConfig } from '../__fixtures__/content';
import { spawnEnemy, type SpawnOpts } from '../enemies';
import type { RunConfig } from '../run';
import { addSkill } from '../skills';
import { EnemyState, type PlayerInput, type PlayerState, type SkillInstance } from '../stores';
import type { SimEventType, SimEvent } from '../events';
import type { WorldEnv } from '../types';
import { createWorld, type World } from '../world';

export interface TestWorldOpts {
  config?: Partial<RunConfig>;
  /** mutate a private clone of the fixture content before the world is created */
  content?: (c: ContentDB) => void;
  /** terrain hooks (walkable / moveCircle / surfaceAt / arenaRadius) */
  env?: WorldEnv;
}

/** a fresh world on the fixture content; the content clone is private to the test */
export function makeWorld(opts: TestWorldOpts = {}): World {
  const content = cloneContent();
  opts.content?.(content);
  const config = fixtureConfig(opts.config);
  return createWorld(config, content, config.meta, opts.env);
}

export function typeOf(w: World, id: string): number {
  const t = w.ix.typeIndex.get(id);
  if (t === undefined) throw new Error(`unknown enemy type '${id}'`);
  return t;
}

/** spawn an enemy that is immediately active (no spawn animation) */
export function spawn(w: World, id: string, x: number, z: number, opts: SpawnOpts = {}): number {
  const row = spawnEnemy(w, typeOf(w, id), x, z, { spawnTime: 0, ...opts });
  if (row < 0) throw new Error('enemy store full');
  return row;
}

export function player(w: World, i = 0): PlayerState {
  return w.players[i] as PlayerState;
}

/** remove every enemy row (does not touch spawner counters beyond `alive`) */
export function clearEnemies(w: World): void {
  w.enemies.clear();
  w.spawner.alive = 0;
}

/** stop the spawner / metin / boss schedules so a test controls the field */
export function freezeSchedules(w: World): void {
  w.spawner.acc = -1e9;
  w.spawner.eliteT = 1e9;
  w.spawner.nextBoss = w.spawner.bosses.length;
  w.metinSys.nextFallAt = 1e9;
  w.metinSys.finalStarted = true;
}

export const NO_INPUT: PlayerInput = { moveX: 0, moveZ: 0 };

export function runTicks(w: World, n: number, input: PlayerInput = NO_INPUT): void {
  for (let i = 0; i < n; i++) w.step([input]);
}

/** run n ticks and return deep copies of the events whose type is in `types` (events are pooled) */
export function collect<T extends SimEventType>(w: World, n: number, types: readonly T[], input: PlayerInput = NO_INPUT): Extract<SimEvent, { t: T }>[] {
  const out: Extract<SimEvent, { t: T }>[] = [];
  for (let i = 0; i < n; i++) {
    w.step([input]);
    for (const e of w.events) {
      if ((types as readonly string[]).includes(e.t)) out.push({ ...e } as Extract<SimEvent, { t: T }>);
    }
  }
  return out;
}

/** answer every pending non-final modal by picking the first card */
export function drainModals(w: World): number {
  let n = 0;
  while (w.modal && w.modal.kind !== 'runEnd' && n < 1000) {
    w.chooseCard(0, w.modal.player);
    n++;
  }
  return n;
}

export function giveSkill(w: World, id: string, rank = 0, playerIndex = 0): SkillInstance {
  const def = w.ix.skills.get(id);
  if (!def) throw new Error(`unknown skill '${id}'`);
  return addSkill(w, player(w, playerIndex), def, rank);
}

/** remove all skills of a player (keeps the global slot table consistent by leaving instances in w.skillSlots) */
export function dropSkills(w: World, playerIndex = 0): void {
  player(w, playerIndex).skills.length = 0;
}

/** put every living enemy into a stunned-but-alive pose so the AI cannot interfere with a unit test */
export function freezeEnemies(w: World): void {
  const e = w.enemies;
  for (let i = 0; i < e.count; i++) {
    e.state[i] = EnemyState.Recover;
    e.aiT[i] = 1e9;
  }
}

/** scan all stores for NaN/Infinity */
export function findNonFinite(w: World): string | null {
  const checks: [string, ArrayLike<number>, number][] = [
    ['enemy.x', w.enemies.x, w.enemies.count],
    ['enemy.z', w.enemies.z, w.enemies.count],
    ['enemy.hp', w.enemies.hp, w.enemies.count],
    ['enemy.rot', w.enemies.rot, w.enemies.count],
    ['enemy.scale', w.enemies.scale, w.enemies.count],
    ['enemy.animT', w.enemies.animT, w.enemies.count],
    ['proj.x', w.projectiles.x, w.projectiles.count],
    ['proj.z', w.projectiles.z, w.projectiles.count],
    ['proj.damage', w.projectiles.damage, w.projectiles.count],
    ['pickup.x', w.pickups.x, w.pickups.count],
    ['pickup.z', w.pickups.z, w.pickups.count],
    ['pickup.value', w.pickups.value, w.pickups.count],
    ['zone.x', w.zones.x, w.zones.count],
    ['zone.z', w.zones.z, w.zones.count],
    ['zone.radius', w.zones.radius, w.zones.count],
    ['tele.x', w.telegraphs.x, w.telegraphs.count],
    ['tele.z', w.telegraphs.z, w.telegraphs.count],
  ];
  for (const [name, arr, n] of checks) {
    for (let i = 0; i < n; i++) if (!Number.isFinite(arr[i] as number)) return `${name}[${i}] = ${arr[i]}`;
  }
  for (const p of w.players) {
    for (const [k, v] of Object.entries({ x: p.x, z: p.z, hp: p.hp, hpMax: p.hpMax, xp: p.xp, yeop: p.yeop, rot: p.rot })) {
      if (!Number.isFinite(v)) return `player${p.index}.${k} = ${v}`;
    }
  }
  return null;
}

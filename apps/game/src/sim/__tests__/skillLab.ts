// Shared lab for the skill-logic tests that run on the REAL content (data/content/*.json): a quiet world of any class, the skills under study
// (only those + the class basic), scripted trigger fields, a state hash. Not a test file.

import { content } from '../../data/loader';
import type { ClassId, ContentDB, SkillDef, TriggerKind } from '../../data/schema';
import { spawnBoss } from '../bosses';
import { hurtPlayer, HurtKind } from '../combat';
import { spawnEnemy, type SpawnOpts } from '../enemies';
import type { CoopPlayerInit } from '../run';
import { addSkill } from '../skills';
import { spawnProjectile } from '../skills/common';
import { ProjKind, type PlayerInput, type PlayerState, type SkillInstance } from '../stores';
import { createWorld, type World } from '../world';
import { botInput } from './bot';
import { drainModals } from './helpers';

export const ZONE_OF: Record<string, string> = { warrior: 'yeonmu', ninja: 'suryeon', yacha: 'seori', shaman: 'daeryeol', wolfman: 'yeonmu' };

export const PARTNER: CoopPlayerInit = { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', meta: { stats: {} } };

export const NO_MOVE: PlayerInput = { moveX: 0, moveZ: 0 };

export interface RealOpts {
  classId?: ClassId | 'common';
  doctrine?: 'a' | 'b';
  seed?: number;
  stats?: Record<string, number>;
  coop?: CoopPlayerInit[];
  /** keep the spawner / metin / boss schedules running (default: a quiet field) */
  live?: boolean;
  /** content override (a private clone with patched numbers); default the shipped content */
  db?: ContentDB;
}

/** a world on the real content; by default a quiet field (schedules frozen, no creatures) */
export function realWorld(o: RealOpts = {}): World {
  const classId: ClassId = o.classId === undefined || o.classId === 'common' ? 'warrior' : o.classId;
  const cls = content.classes.find((c) => c.id === classId);
  const w = createWorld(
    {
      zone: ZONE_OF[classId] ?? 'yeonmu',
      difficulty: 'normal',
      classId,
      doctrine: o.doctrine ?? 'a',
      sex: cls?.sexes[0] ?? 'm',
      empire: 'saehwa',
      seed: o.seed ?? 11,
      meta: { stats: o.stats ?? {} },
      ...(o.coop ? { coop: o.coop } : {}),
    },
    o.db ?? content,
  );
  if (!o.live) {
    w.spawner.acc = -1e9;
    w.spawner.eliteT = 1e9;
    w.spawner.nextBoss = w.spawner.bosses.length;
    w.metinSys.nextFallAt = 1e9;
    w.metinSys.finalStarted = true;
    w.enemies.clear();
    w.spawner.alive = 0;
  }
  return w;
}

export function hero(w: World, i = 0): PlayerState {
  const p = w.players[i];
  if (!p) throw new Error(`no hero ${i}`);
  return p;
}

export function def(id: string): SkillDef {
  const d = content.skills.find((s) => s.id === id);
  if (!d) throw new Error(`no skill ${id}`);
  return d;
}

/** keep only the class basic of hero `pi` and give the ids (rank 0..7), ready to fire (cd 0) */
export function only(w: World, ids: string[], rank = 0, pi = 0): SkillInstance[] {
  const p = hero(w, pi);
  const basic = p.skills[0];
  p.skills.length = 0;
  if (basic) p.skills.push(basic);
  return ids.map((id) => {
    const s = addSkill(w, p, w.ix.skills.get(id) ?? def(id), rank);
    s.cd = 0;
    return s;
  });
}

/** n creatures of real enemy `id` on a ring of radius r around hero `pi` */
export function ringOf(w: World, id: string, n: number, r: number, pi = 0, opts: SpawnOpts = {}): number[] {
  const t = w.ix.typeIndex.get(id);
  if (t === undefined) throw new Error(`no enemy ${id}`);
  const p = hero(w, pi);
  const rows: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    rows.push(spawnEnemy(w, t, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, { spawnTime: 0, ...opts }));
  }
  return rows;
}

/** re-index the enemy hash and drop the per-tick ctx cache so a gate read sees the scripted field */
export function refresh(w: World): void {
  w.hash.rebuild(w.enemies);
  for (const p of w.players) p.ctx.tick = -1;
}

/** hit the hero for `frac` of its max HP (post-armor is smaller) through the real hurtPlayer; the iframes are cleared again */
export function wound(w: World, pi: number, frac: number): void {
  const p = hero(w, pi);
  const evasion = p.stats.evasion;
  p.stats.evasion = 0; // a dodged blow records nothing: the lab wants the blow to land
  p.iframes = 0;
  hurtPlayer(w, pi, p.hpMax * frac, 3, 0, 0, HurtKind.Melee);
  p.iframes = 0;
  p.stats.evasion = evasion;
}

/**
 * Script ONE plain trigger kind true on a field that is otherwise empty (hero 0 at the origin). `n` = the spec's pinned count.
 * pinned also makes engaged true, boss also makes elite true (the sim's own definitions), nothing else leaks.
 */
export function scriptKind(w: World, kind: Exclude<TriggerKind, 'lethal'>, n = 5): void {
  const p = hero(w, 0);
  switch (kind) {
    case 'engaged':
      ringOf(w, 'wild_dog', 4, 6);
      break;
    case 'pinned':
      ringOf(w, 'wild_dog', n, 2.5);
      break;
    case 'hurt':
      wound(w, 0, 0.2);
      p.hp = p.hpMax;
      break;
    case 'danger':
      p.hp = p.hpMax * 0.3;
      break;
    case 'elite':
      ringOf(w, 'wolf', 1, 8, 0, { tier: 1 });
      break;
    case 'boss':
      spawnBoss(w, 'boss_horyeong', false, 0, 12);
      break;
    case 'volley':
      for (const x of [4, -4]) {
        spawnProjectile(w, { kind: ProjKind.Hostile, x, z: 0, vx: 0, vz: 0, radius: 0.3, life: 30, damage: 1, element: 0, owner: 0, skill: 255, pierce: 0, preset: 'p_bolt' });
      }
      break;
    case 'ally': {
      const a = hero(w, 1);
      a.x = a.px = 6;
      a.z = a.pz = 0;
      a.hp = a.hpMax * 0.4;
      break;
    }
  }
  refresh(w);
}

export function step(w: World, n: number, input: PlayerInput = NO_MOVE): void {
  for (let i = 0; i < n; i++) {
    drainModals(w);
    w.step([input, ...w.players.slice(1).map(() => NO_MOVE)]);
  }
}

/** bot-driven steps (hero 0 kites, the others idle) */
export function stepBot(w: World, n: number, from = 0): void {
  for (let i = 0; i < n; i++) {
    drainModals(w);
    w.step([botInput(w, from + i), ...w.players.slice(1).map(() => NO_MOVE)]);
  }
}

/** FNV hash of the gameplay state (heroes, creatures, projectile rows, tallies, bait list) at 1/1000 resolution */
export function stateHash(w: World): number {
  let h = 2166136261 >>> 0;
  const mix = (v: number): void => {
    h = Math.imul(h ^ (Math.round(v * 1000) | 0), 16777619) >>> 0;
  };
  for (const p of w.players) {
    mix(p.x);
    mix(p.z);
    mix(p.hp);
    mix(p.ward);
    mix(p.veilT);
    mix(p.dodgeN);
    mix(p.xp);
    mix(p.kills);
    for (const s of p.skills) {
      mix(s.cd);
      mix(s.damage);
      mix(s.armedT);
    }
  }
  const e = w.enemies;
  for (let i = 0; i < e.count; i++) {
    mix(e.x[i] as number);
    mix(e.z[i] as number);
    mix(e.hp[i] as number);
  }
  const P = w.projectiles;
  for (let i = 0; i < P.count; i++) {
    mix(P.x[i] as number);
    mix(P.z[i] as number);
    mix(P.kind[i] as number);
    mix(P.life[i] as number);
  }
  mix(w.tally.damageDealt);
  mix(w.tally.damageTaken);
  mix(w.baits.count);
  mix(w.corpses.count);
  return h;
}

/** rows of the projectile table with this kind (and skill slot when given) */
export function rowsOf(w: World, kind: ProjKind, slot = -1): number[] {
  const P = w.projectiles;
  const out: number[] = [];
  for (let i = 0; i < P.count; i++) if (P.kind[i] === kind && (slot < 0 || P.skill[i] === slot)) out.push(i);
  return out;
}

/** every shipped skill that carries a trigger (the gated skills) */
export function gatedSkills(): SkillDef[] {
  return content.skills.filter((s) => s.trigger !== undefined);
}

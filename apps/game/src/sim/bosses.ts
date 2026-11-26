// Bosses: scheduled arrivals (ZoneDef.bosses), phases by hp fraction, generic BossPatternKind implementations with
// telegraphs, enrage after `enrageAfter`, and the final boss that emerges from the Great Metin (victory on kill).

import type { BossDef, BossPattern } from '../data/schema';
import { openChest } from './cards';
import { hurtPlayer, HurtKind, killEnemy, pushPlayer } from './combat';
import { DT, PLAYER_RADIUS, SPAWN_RING_MAX } from './constants';
import { evictLowPriorityEnemy, spawnEnemy } from './enemies';
import { breakGreatMetin } from './metins';
import { beginVictory } from './progress';
import { spawnProjectile } from './skills/common';
import { bandAt, pickSpawnable, ringPosition, spawnable, type Pos } from './spawner';
import { addTelegraph } from './telegraph';
import { AnimClip, EnemyFlag, EnemyState, PickupKind, ProjKind, TelegraphAct, TelegraphShape, type PlayerState } from './stores';
import type { BossState } from './types';
import { elementOfRaces } from './combat';
import type { World } from './world';

export interface BossSystem {
  nextId: number;
}

export function createBossSystem(_w: World): BossSystem {
  return { nextId: 1 };
}

/** default arrival; a boss whose model has a longer `spawn` clip waits for it (WorldEnv.bossModel), up to INTRO_MAX */
const INTRO_TIME = 1.6;
const INTRO_MAX = 4;
/** the final boss gains another enrage stack this often (s) after its first enrage, up to RAGE_STACK_MAX stacks */
export const RAGE_STACK_EVERY = 12;
export const RAGE_STACK_MAX = 24;
/** total speed multiplier (first enrage included) and pattern-cooldown floor the stacks may reach */
const RAGE_SPEED_CAP = 2.1;
const RAGE_COOLDOWN_FLOOR = 0.3;
/** escort packs stop pouring once this many creatures are alive */
const ESCORT_ALIVE_LIMIT = 640;
const BOSS_RING_MIN = 22;
const pos: Pos = { x: 0, z: 0 };
const tpPos: Pos = { x: 0, z: 0 };

function param(p: BossPattern, key: string, dflt: number): number {
  return p.params[key] ?? dflt;
}

/** normalise a phase threshold given as a fraction (0..1) or percent (0..100) */
function phaseFrac(v: number): number {
  return v > 1 ? v / 100 : v;
}

export function spawnBoss(w: World, bossId: string, final: boolean, x?: number, z?: number): BossState | null {
  const def = w.ix.bosses.get(bossId);
  const ti = w.ix.typeIndex.get(bossId);
  if (!def || ti === undefined) return null;
  if (w.enemies.count >= w.enemies.capacity && !evictLowPriorityEnemy(w)) return null;
  let sx = x;
  let sz = z;
  if (sx === undefined || sz === undefined) {
    const np = w.nearestPlayer(0, 0);
    const p = w.players[np < 0 ? 0 : np] as PlayerState;
    ringPosition(w, p.x, p.z, BOSS_RING_MIN, Math.max(BOSS_RING_MIN + 2, SPAWN_RING_MAX - 8), pos);
    sx = pos.x;
    sz = pos.z;
  }
  const info = w.env.bossModel?.(def.model) ?? null;
  const intro = info ? Math.min(INTRO_MAX, Math.max(INTRO_TIME, info.spawn)) : INTRO_TIME;
  const row = spawnEnemy(w, ti, sx, sz, {
    tier: 3,
    spawnTime: intro,
    source: 3,
    flags: EnemyFlag.Invuln | (final ? EnemyFlag.Pinned : 0),
    // zone.final.hpMul (and event factors) scale the FINAL boss only; every other boss keeps its data HP
    hpMul: final ? w.mods.finalHp : 1,
  });
  if (row < 0) return null;
  const e = w.enemies;
  e.atk[row] = 0;
  const b: BossState = {
    id: w.bossSys.nextId++,
    def,
    typeIndex: ti,
    enemy: e.id[row] as number,
    phase: 0,
    age: 0,
    intro,
    breathSpecial1: info?.breath === true,
    enraged: false,
    final,
    ready: def.patterns.map(() => w.time + intro + 1 + w.rng.boss.next() * 1.5),
    pattern: null,
    patternT: 0,
    patIdx: -1,
    a: 0,
    b: 0,
    c: 0,
    dirX: 0,
    dirZ: 1,
    gap: intro + 1,
    dead: false,
    rageDamage: 1,
    rageSpeed: 1,
    rageCooldown: 1,
    rageStacks: 0,
    nextStackAt: Infinity,
  };
  w.bosses.push(b);
  w.bus.bossSpawn(b.id, e.id[row] as number, def.id, sx, sz, final);
  if (!final) w.bus.story('bossIntro', def.id);
  w.bus.shake(0.5, 0.8);
  pourEscorts(w, def, sx, sz);
  return b;
}

/** escort pack: BossDef.escorts, ~12 creatures split over the listed kinds (3..6 each, scaled by the density slider) on a ring around the boss */
function pourEscorts(w: World, def: BossDef, bx: number, bz: number): void {
  const escorts = def.escorts;
  if (!escorts || escorts.length === 0) return;
  const perKind = Math.round(Math.min(6, Math.max(3, 12 / escorts.length)) * Math.sqrt(w.diff.count));
  const rng = w.rng.boss;
  for (const id of escorts) {
    const ti = w.ix.typeIndex.get(id);
    if (ti === undefined) continue;
    for (let k = 0; k < perKind; k++) {
      if (w.spawner.alive >= ESCORT_ALIVE_LIMIT) return;
      for (let attempt = 0; attempt < 4; attempt++) {
        const a = rng.angle();
        const r = 4 + rng.next() * 3.5;
        const x = bx + Math.sin(a) * r;
        const z = bz + Math.cos(a) * r;
        if (!spawnable(w, x, z)) continue;
        spawnEnemy(w, ti, x, z, { source: 3, spawnTime: INTRO_TIME * 0.6 });
        break;
      }
    }
  }
}

/** seconds between the final boss's rage stacks: RAGE_STACK_EVERY x w.mods.finalEnrage (hard muls, events; < 1 = sooner). Other bosses never stack. */
function stackEvery(w: World, b: BossState): number {
  return b.final ? RAGE_STACK_EVERY * w.mods.finalEnrage : RAGE_STACK_EVERY;
}

export function bossOfRow(w: World, handle: number): BossState | undefined {
  for (const b of w.bosses) if (b.enemy === handle) return b;
  return undefined;
}

/**
 * The final fight must end: after its first enrage the final boss keeps getting angrier every RAGE_STACK_EVERY seconds
 * (+12% damage, +3% speed up to a cap, 5% faster patterns), so a hero that kites forever or out-sustains it is
 * eventually caught and out-damaged. Ordinary bosses enrage once.
 */
function stackRage(w: World, b: BossState, row: number): void {
  const e = w.enemies;
  b.rageStacks++;
  b.nextStackAt = w.time + stackEvery(w, b);
  const speedMul = Math.min(RAGE_SPEED_CAP / b.rageSpeed, 1.03);
  const cooldownMul = Math.max(RAGE_COOLDOWN_FLOOR / b.rageCooldown, 0.95);
  b.rageSpeed *= speedMul;
  b.rageDamage *= 1.12;
  b.rageCooldown *= cooldownMul;
  e.baseSpeed[row] = (e.baseSpeed[row] as number) * speedMul;
  e.dmgMul[row] = (e.dmgMul[row] as number) * 1.12;
  w.bus.vfx('vfx_boss_enrage', e.x[row] as number, e.z[row] as number, 0, 1, 4, 0.8, 1);
  w.bus.shake(0.35, 0.4);
}

function enrage(w: World, b: BossState, row: number, speedMul: number, damageMul: number, cooldownMul: number): void {
  const e = w.enemies;
  b.enraged = true;
  b.nextStackAt = w.time + stackEvery(w, b);
  b.rageSpeed *= speedMul;
  b.rageDamage *= damageMul;
  b.rageCooldown *= cooldownMul;
  e.baseSpeed[row] = (e.baseSpeed[row] as number) * speedMul;
  e.dmgMul[row] = (e.dmgMul[row] as number) * damageMul;
  w.bus.bossPhase(b.id, b.def.id, b.phase, hpFraction(w, row), true);
  w.bus.vfx('vfx_boss_enrage', e.x[row] as number, e.z[row] as number, 0, 1, 4, 1.2, 1);
  w.bus.shake(0.6, 0.6);
  w.bus.sfx('sfx_boss_roar', e.x[row] as number, e.z[row] as number);
}

function hpFraction(w: World, row: number): number {
  const e = w.enemies;
  return Math.max(0, (e.hp[row] as number) / Math.max(1, e.hpMax[row] as number));
}

export function updateBosses(w: World): void {
  const e = w.enemies;
  for (let i = w.bosses.length - 1; i >= 0; i--) {
    const b = w.bosses[i] as BossState;
    const row = e.find(b.enemy);
    if (row < 0 || b.dead) {
      w.bosses.splice(i, 1);
      continue;
    }
    if (e.state[row] === EnemyState.Dying) continue;
    b.age += DT;
    // intro: untargetable while it arrives
    if (b.age >= b.intro && ((e.flags[row] as number) & EnemyFlag.Invuln) !== 0) {
      e.flags[row] = (e.flags[row] as number) & ~EnemyFlag.Invuln;
    }
    if (b.age < b.intro) continue;

    if (!b.enraged && b.age >= b.def.enrageAfter) enrage(w, b, row, 1.35, 1.5, 0.6);
    else if (b.final && b.enraged && w.time >= b.nextStackAt && b.rageStacks < RAGE_STACK_MAX) stackRage(w, b, row);

    // phases
    const frac = hpFraction(w, row);
    let phase = 0;
    const phases = b.def.phases;
    for (let k = 0; k < phases.length; k++) if (frac <= phaseFrac((phases[k] as { hpPct: number }).hpPct)) phase = k;
    if (phase !== b.phase) {
      b.phase = phase;
      w.bus.bossPhase(b.id, b.def.id, phase, frac, false);
      w.bus.shake(0.4, 0.5);
      for (let k = 0; k < b.ready.length; k++) b.ready[k] = Math.min(b.ready[k] as number, w.time + 1.2 + k * 0.4);
    }

    const target = w.players[e.target[row] as number] as PlayerState;
    if (!target || !target.alive) {
      if (b.pattern) endPattern(w, b, row);
      continue;
    }
    if (b.pattern) {
      runPattern(w, b, row, target);
      continue;
    }
    if (e.state[row] !== EnemyState.Move) continue;
    b.gap -= DT;
    if (b.gap > 0) continue;
    pickPattern(w, b, row, target);
  }
}

function pickPattern(w: World, b: BossState, row: number, target: PlayerState): void {
  const e = w.enemies;
  const phaseDef = b.def.phases[b.phase] ?? b.def.phases[0];
  if (!phaseDef) return;
  const dist = Math.hypot(target.x - (e.x[row] as number), target.z - (e.z[row] as number));
  const cands: number[] = [];
  const fallback: number[] = [];
  for (const id of phaseDef.patterns) {
    const idx = b.def.patterns.findIndex((p) => p.id === id);
    if (idx < 0 || (b.ready[idx] as number) > w.time) continue;
    const pat = b.def.patterns[idx] as BossPattern;
    fallback.push(idx);
    if (pat.kind === 'charge' && dist < 4) continue;
    if (pat.kind === 'breath' && dist > param(pat, 'length', 8) + 3) continue;
    if (pat.kind === 'slam' && param(pat, 'atPlayer', 0) === 0 && dist > param(pat, 'radius', 4) + 4) continue;
    cands.push(idx);
  }
  const pool = cands.length > 0 ? cands : fallback;
  if (pool.length === 0) {
    b.gap = 0.4;
    return;
  }
  const idx = w.rng.boss.pick(pool);
  beginPattern(w, b, row, idx, target);
}

function bossDamage(w: World, row: number, p: BossPattern, key = 'damage', dflt = 1.4): number {
  const e = w.enemies;
  const def = w.typeDefs[e.type[row] as number];
  return (def?.damage ?? 10) * (e.dmgMul[row] as number) * param(p, key, dflt);
}

function beginPattern(w: World, b: BossState, row: number, idx: number, target: PlayerState): void {
  const e = w.enemies;
  const pat = b.def.patterns[idx] as BossPattern;
  const x = e.x[row] as number;
  const z = e.z[row] as number;
  const handle = e.id[row] as number;
  const dx = target.x - x;
  const dz = target.z - z;
  const d = Math.hypot(dx, dz) || 1;
  b.pattern = pat;
  b.patIdx = idx;
  b.patternT = 0;
  b.a = 0;
  b.b = 0;
  b.c = 0;
  b.dirX = dx / d;
  b.dirZ = dz / d;
  e.state[row] = EnemyState.Windup;
  e.stateT[row] = 0;
  e.atk[row] = 255;
  e.dirX[row] = b.dirX;
  e.dirZ[row] = b.dirZ;
  e.animT[row] = 0;
  // the pattern's clip: kinds alternate special1/special2; a model with its fire breath in special1 keeps special1 for the
  // breath and moves the others onto special2/special3, so no other pattern plays its breath clip
  const kindIdx = ['slam', 'charge', 'volley', 'summon', 'ring', 'breath', 'meteor', 'nova', 'teleport', 'enrage'].indexOf(pat.kind);
  if (b.breathSpecial1) e.animClip[row] = pat.kind === 'breath' ? AnimClip.Special1 : kindIdx % 2 === 0 ? AnimClip.Special2 : AnimClip.Special3;
  else e.animClip[row] = kindIdx % 2 === 0 ? AnimClip.Special1 : AnimClip.Special2;
  const element = elementOfRaces(b.def.race);
  const rot = Math.atan2(b.dirX, b.dirZ);
  const W = Math.max(0.2, pat.windup);
  const preset = pat.vfx ?? 'vfx_boss_slam';
  w.bus.enemyAttack(handle, e.type[row] as number, 0, x, z, b.dirX, b.dirZ);
  if (pat.sfx) w.bus.sfx(pat.sfx, x, z);
  switch (pat.kind) {
    case 'slam': {
      const radius = param(pat, 'radius', 4.5);
      const atPlayer = param(pat, 'atPlayer', 0) > 0;
      const tx = atPlayer ? target.x : x;
      const tz = atPlayer ? target.z : z;
      addTelegraph(w, { shape: TelegraphShape.Circle, x: tx, z: tz, radius, dur: W, follow: atPlayer ? 0 : handle, owner: 1, act: TelegraphAct.Impact, damage: bossDamage(w, row, pat), knock: param(pat, 'knockback', 4), element, preset });
      break;
    }
    case 'charge': {
      const length = param(pat, 'length', 12);
      const width = param(pat, 'width', 2.6);
      addTelegraph(w, { shape: TelegraphShape.Line, x, z, rot, length, width, dur: W, follow: handle, owner: 1, act: TelegraphAct.Visual, element });
      break;
    }
    case 'volley': {
      const spread = param(pat, 'spread', 0.9);
      addTelegraph(w, { shape: TelegraphShape.Cone, x, z, rot, radius: 14, width: spread, dur: W, follow: handle, owner: 1, act: TelegraphAct.Visual, element });
      break;
    }
    case 'ring':
      addTelegraph(w, { shape: TelegraphShape.Circle, x, z, radius: 3.2, dur: W, follow: handle, owner: 1, act: TelegraphAct.Visual, element });
      break;
    case 'breath': {
      const length = param(pat, 'length', 9);
      const angle = param(pat, 'angle', 1);
      addTelegraph(w, { shape: TelegraphShape.Cone, x, z, rot, radius: length, width: angle, dur: W + param(pat, 'duration', 2), follow: handle, owner: 1, act: TelegraphAct.Visual, element });
      break;
    }
    case 'nova': {
      const radius = param(pat, 'radius', 9);
      const inner = param(pat, 'inner', 0);
      addTelegraph(w, {
        shape: inner > 0 ? TelegraphShape.Ring : TelegraphShape.Circle,
        x, z, radius, length: inner, dur: W, follow: handle, owner: 1, act: TelegraphAct.Impact,
        damage: bossDamage(w, row, pat), knock: param(pat, 'knockback', 5), element, preset,
      });
      break;
    }
    case 'teleport': {
      // destination near the hero, away from the boss
      const range = param(pat, 'range', 5);
      // only onto ground a creature can stand on (a landing inside a cliff / tree would pin the boss there for good); with no fit
      // around the hero it stays where it is (the telegraph marks the stomp at its own feet)
      if (pickSpawnable(w, w.rng.boss, target.x, target.z, range, range, tpPos, 8)) {
        b.a = tpPos.x;
        b.b = tpPos.z;
      } else {
        b.a = e.x[row] as number;
        b.b = e.z[row] as number;
      }
      addTelegraph(w, { shape: TelegraphShape.Circle, x: b.a, z: b.b, radius: param(pat, 'radius', 3.5), dur: W, owner: 1, act: TelegraphAct.Visual, element });
      break;
    }
    default:
      break;
  }
}

/**
 * A boss never rests on ground it cannot leave: the AI reverts every step that ends in blocked ground, so a boss that ended a
 * charge or a landing there would stay for good. Move it to the nearest spot a creature can stand on (rings of 1.5 m, up to 24 m).
 */
function settleOnGround(w: World, row: number): void {
  const e = w.enemies;
  const x = e.x[row] as number;
  const z = e.z[row] as number;
  if (spawnable(w, x, z)) return;
  const limit = w.arenaRadius - 0.5;
  for (let r = 1.5; r <= 24; r += 1.5) {
    const steps = Math.max(8, Math.round(r * 2.2));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * 6.283185307179586;
      const nx = x + Math.sin(a) * r;
      const nz = z + Math.cos(a) * r;
      if (Math.hypot(nx, nz) <= limit && spawnable(w, nx, nz)) {
        e.x[row] = nx;
        e.z[row] = nz;
        e.px[row] = nx;
        e.pz[row] = nz;
        return;
      }
    }
  }
}

function endPattern(w: World, b: BossState, row: number): void {
  const e = w.enemies;
  // a boss that died inside its own pattern (hero thorns run inside hurtPlayer) stays dying: the pattern state must not revive it
  if (e.state[row] === EnemyState.Dying) {
    b.pattern = null;
    b.patIdx = -1;
    return;
  }
  settleOnGround(w, row);
  const pat = b.pattern;
  if (pat && b.patIdx >= 0) b.ready[b.patIdx] = w.time + pat.cooldown * b.rageCooldown;
  b.pattern = null;
  b.patIdx = -1;
  b.gap = (0.5 + w.rng.boss.next() * 0.9) * b.rageCooldown;
  e.state[row] = EnemyState.Move;
  e.stateT[row] = 0;
  e.atk[row] = 0;
  e.animClip[row] = AnimClip.Run;
  e.animT[row] = 0;
}

function turnToward(b: BossState, tx: number, tz: number, x: number, z: number, rate: number): void {
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.hypot(dx, dz) || 1;
  const want = Math.atan2(dx / d, dz / d);
  const cur = Math.atan2(b.dirX, b.dirZ);
  let diff = want - cur;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const a = cur + Math.max(-rate * DT, Math.min(rate * DT, diff));
  b.dirX = Math.sin(a);
  b.dirZ = Math.cos(a);
}

function runPattern(w: World, b: BossState, row: number, target: PlayerState): void {
  const e = w.enemies;
  const pat = b.pattern as BossPattern;
  b.patternT += DT;
  const t = b.patternT;
  const W = Math.max(0.2, pat.windup);
  const x = e.x[row] as number;
  const z = e.z[row] as number;
  const element = elementOfRaces(b.def.race);
  e.rot[row] = Math.atan2(b.dirX, b.dirZ);

  switch (pat.kind) {
    case 'slam':
    case 'nova':
      // the telegraph resolves the hit; stay planted for a short recovery
      if (t >= W + 0.45) endPattern(w, b, row);
      break;

    case 'charge': {
      const length = param(pat, 'length', 12);
      const speed = param(pat, 'speed', 16) * w.options.speed;
      if (t < W) {
        turnToward(b, target.x, target.z, x, z, 1.5);
        e.dirX[row] = b.dirX;
        e.dirZ[row] = b.dirZ;
        break;
      }
      if (b.c === 0) {
        b.c = 1;
        e.state[row] = EnemyState.Dash;
        e.animClip[row] = AnimClip.Run;
        e.animT[row] = 0;
        b.a = 0; // travelled
        b.b = 0; // hit flag
      }
      if (b.c === 1) {
        const step = Math.min(speed * DT, length - b.a);
        const nx = x + b.dirX * step;
        const nz = z + b.dirZ * step;
        // the dash stops at the first step that would end on ground a creature cannot stand on (cliff, tree, water, arena edge)
        if (Math.hypot(nx, nz) > w.arenaRadius - 0.5 || !spawnable(w, nx, nz)) {
          b.a = length;
        } else {
          e.x[row] = nx;
          e.z[row] = nz;
          b.a += step;
        }
        const width = param(pat, 'width', 2.6) / 2 + PLAYER_RADIUS;
        if (b.b === 0 && Math.hypot(target.x - (e.x[row] as number), target.z - (e.z[row] as number)) <= width + (e.radius[row] as number) * 0.4) {
          b.b = 1;
          hurtPlayer(w, target.index, bossDamage(w, row, pat), x, z, element, HurtKind.Melee, e.id[row] as number);
          // the hero's thorns can kill the boss inside that hit: it stays dying (no pattern state may overwrite Dying)
          if (e.state[row] === EnemyState.Dying) break;
          pushPlayer(target, x, z, 3);
        }
        if (b.a >= length - 1e-3) {
          b.c = 2;
          b.patternT = W; // recovery measured from here
          e.state[row] = EnemyState.Windup;
        }
      } else if (t >= W + 0.7) {
        endPattern(w, b, row);
      }
      break;
    }

    case 'volley': {
      const waves = Math.max(1, Math.round(param(pat, 'waves', 1)));
      const interval = param(pat, 'interval', 0.4);
      if (t < W) {
        turnToward(b, target.x, target.z, x, z, 2.5);
        break;
      }
      const due = Math.floor((t - W) / interval + 1e-6);
      while (b.b <= due && b.b < waves) {
        const count = Math.max(1, Math.round(param(pat, 'count', 5)));
        const spread = param(pat, 'spread', 0.9);
        const speed = param(pat, 'speed', 9) * w.options.speed;
        const radius = param(pat, 'radius', 0.4);
        const dmg = bossDamage(w, row, pat, 'damage', 0.8);
        const dx = target.x - x;
        const dz = target.z - z;
        const base = Math.atan2(dx, dz);
        for (let k = 0; k < count; k++) {
          const a = base + (count === 1 ? 0 : (k / (count - 1) - 0.5) * spread);
          spawnProjectile(w, { kind: ProjKind.Hostile, x: x + Math.sin(a) * 1.4, z: z + Math.cos(a) * 1.4, vx: Math.sin(a) * speed, vz: Math.cos(a) * speed, radius, life: 2.2, damage: dmg, element, owner: 0, skill: 255, pierce: 0, preset: pat.vfx ?? 'vfx_boss_bolt' });
        }
        w.bus.sfx(pat.sfx ?? 'sfx_boss_volley', x, z);
        b.b++;
      }
      if (b.b >= waves && t >= W + (waves - 1) * interval + 0.5) endPattern(w, b, row);
      break;
    }

    case 'ring': {
      const waves = Math.max(1, Math.round(param(pat, 'waves', 2)));
      const interval = 0.55;
      if (t < W) break;
      const due = Math.floor((t - W) / interval + 1e-6);
      while (b.b <= due && b.b < waves) {
        const count = Math.max(4, Math.round(param(pat, 'count', 14)));
        const speed = param(pat, 'speed', 7) * w.options.speed;
        const radius = param(pat, 'radius', 0.4);
        const dmg = bossDamage(w, row, pat, 'damage', 0.7);
        const off = (b.b % 2) * (Math.PI / count);
        for (let k = 0; k < count; k++) {
          const a = off + (k / count) * Math.PI * 2;
          spawnProjectile(w, { kind: ProjKind.Hostile, x: x + Math.sin(a) * 1.6, z: z + Math.cos(a) * 1.6, vx: Math.sin(a) * speed, vz: Math.cos(a) * speed, radius, life: 3.2, damage: dmg, element, owner: 0, skill: 255, pierce: 0, preset: pat.vfx ?? 'vfx_boss_bolt' });
        }
        w.bus.vfx('vfx_boss_ring', x, z, 0, 1, 3, 0.5, element);
        w.bus.sfx(pat.sfx ?? 'sfx_boss_ring', x, z);
        b.b++;
      }
      if (b.b >= waves && t >= W + (waves - 1) * interval + 0.5) endPattern(w, b, row);
      break;
    }

    case 'summon': {
      if (t < W) break;
      if (b.b === 0) {
        b.b = 1;
        const count = Math.max(1, Math.round(param(pat, 'count', 6)));
        const band = bandAt(w.spawner.bands, w.time).band;
        const rng = w.rng.boss;
        // the boss calls its own escort kinds when it has any, else whatever the current time band spawns
        const ids: string[] = b.def.escorts && b.def.escorts.length > 0 ? b.def.escorts.slice() : [];
        if (ids.length === 0) {
          for (const s of band.spawns) {
            if (s.group) ids.push(...s.group.members);
            else ids.push(s.enemy);
          }
        }
        if (ids.length > 0 && w.spawner.alive < 640) {
          for (let k = 0; k < count; k++) {
            const ti = w.ix.typeIndex.get(rng.pick(ids));
            if (ti === undefined) continue;
            // on ground a creature can stand on, else this summon is skipped (it would stand inside a tree / cliff until killed)
            if (pickSpawnable(w, rng, x, z, 3, 6, tpPos, 6)) spawnEnemy(w, ti, tpPos.x, tpPos.z, { source: 4, spawnTime: 0.6 });
          }
        }
        w.bus.vfx(pat.vfx ?? 'vfx_boss_summon', x, z, 0, 1, 5, 0.8, element);
        w.bus.sfx(pat.sfx ?? 'sfx_boss_summon', x, z);
      }
      if (t >= W + 0.6) endPattern(w, b, row);
      break;
    }

    case 'breath': {
      const length = param(pat, 'length', 9);
      const angle = param(pat, 'angle', 1);
      const duration = param(pat, 'duration', 2);
      const tick = Math.max(0.1, param(pat, 'tick', 0.3));
      if (t < W) {
        turnToward(b, target.x, target.z, x, z, 1.2);
        break;
      }
      // follow the hero slowly while breathing
      turnToward(b, target.x, target.z, x, z, 0.7);
      e.dirX[row] = b.dirX;
      e.dirZ[row] = b.dirZ;
      b.a -= DT;
      if (b.a <= 0) {
        b.a += tick;
        const dmg = bossDamage(w, row, pat, 'damage', 0.5);
        const rot = Math.atan2(b.dirX, b.dirZ);
        const half = angle / 2;
        for (let pi = 0; pi < w.players.length; pi++) {
          const p = w.players[pi] as PlayerState;
          if (!p.alive) continue;
          const dx = p.x - x;
          const dz = p.z - z;
          const d = Math.hypot(dx, dz);
          if (d > length + PLAYER_RADIUS) continue;
          const cos = d < 0.4 ? 1 : (dx * Math.sin(rot) + dz * Math.cos(rot)) / d;
          if (cos >= Math.cos(Math.min(Math.PI, half + Math.atan2(PLAYER_RADIUS, Math.max(d, 0.5))))) {
            hurtPlayer(w, pi, dmg, x, z, element, HurtKind.Hazard, e.id[row] as number);
          }
        }
        w.bus.vfx(pat.vfx ?? 'vfx_boss_breath', x, z, b.dirX, b.dirZ, length, tick + 0.1, element);
      }
      if (t >= W + duration) endPattern(w, b, row);
      break;
    }

    case 'meteor': {
      const count = Math.max(1, Math.round(param(pat, 'count', 8)));
      const interval = Math.max(0.1, param(pat, 'interval', 0.35));
      const radius = param(pat, 'radius', 2.6);
      const spread = param(pat, 'spread', 9);
      const delay = param(pat, 'delay', 1);
      if (t < W) break;
      const due = Math.floor((t - W) / interval + 1e-6);
      while (b.b <= due && b.b < count) {
        const rng = w.rng.boss;
        const first = b.b === 0;
        const a = rng.angle();
        const r = first ? 0 : Math.sqrt(rng.next()) * spread;
        const tx = target.x + Math.sin(a) * r;
        const tz = target.z + Math.cos(a) * r;
        if (Math.hypot(tx, tz) < w.arenaRadius) {
          addTelegraph(w, { shape: TelegraphShape.Circle, x: tx, z: tz, radius, dur: delay, owner: 1, act: TelegraphAct.Impact, damage: bossDamage(w, row, pat, 'damage', 1.1), knock: 2, element, preset: pat.vfx ?? 'vfx_meteor_impact' });
        }
        b.b++;
      }
      if (b.b >= count && t >= W + (count - 1) * interval + 0.5) endPattern(w, b, row);
      break;
    }

    case 'teleport': {
      if (t < W) break;
      if (b.c === 0) {
        b.c = 1;
        w.bus.vfx('vfx_boss_vanish', x, z, 0, 1, 3, 0.5, element);
        e.x[row] = b.a;
        e.z[row] = b.b;
        e.px[row] = b.a;
        e.pz[row] = b.b;
        const radius = param(pat, 'radius', 3.5);
        const dmg = bossDamage(w, row, pat, 'damage', 1.2);
        for (let pi = 0; pi < w.players.length; pi++) {
          const p = w.players[pi] as PlayerState;
          if (!p.alive) continue;
          if (Math.hypot(p.x - b.a, p.z - b.b) <= radius + PLAYER_RADIUS) {
            hurtPlayer(w, pi, dmg, b.a, b.b, element, HurtKind.Melee, e.id[row] as number);
            pushPlayer(p, b.a, b.b, 4);
          }
        }
        w.bus.vfx(pat.vfx ?? 'vfx_boss_land', b.a, b.b, 0, 1, radius, 0.5, element);
        w.bus.shake(0.5, 0.35);
        w.bus.sfx(pat.sfx ?? 'sfx_boss_land', b.a, b.b);
      }
      if (t >= W + 0.5) endPattern(w, b, row);
      break;
    }

    case 'enrage': {
      if (t < W) break;
      if (b.c === 0) {
        b.c = 1;
        if (!b.enraged) enrage(w, b, row, param(pat, 'speedMul', 1.3), param(pat, 'damageMul', 1.4), param(pat, 'cooldownMul', 0.7));
      }
      if (t >= W + 0.4) endPattern(w, b, row);
      break;
    }

    default:
      endPattern(w, b, row);
      break;
  }
}

/** called when a boss row dies */
export function onBossRowDied(w: World, row: number, killer: number): void {
  const e = w.enemies;
  const b = bossOfRow(w, e.id[row] as number);
  if (!b) return;
  b.dead = true;
  b.pattern = null;
  const x = e.x[row] as number;
  const z = e.z[row] as number;
  w.bus.bossDeath(b.id, b.def.id, x, z, b.final);
  w.bus.shake(1, 0.8);
  w.tally.bossesKilled.push(b.def.id);
  // vacuum every gem and drop a heart-shaped reward
  const P = w.pickups;
  for (let i = 0; i < P.count; i++) {
    if (P.kind[i] === PickupKind.Xp && P.magnet[i] === 0) {
      P.magnet[i] = 1;
      P.target[i] = killer >= 0 ? killer : 0;
      P.vx[i] = 8;
    }
  }
  if (b.def.loot.chest && !b.final) {
    for (const p of w.players) if (p.alive) openChest(w, p, b.def.id);
  }
  if (b.final) {
    breakGreatMetin(w);
    // everything else collapses with the final boss
    w.noLoot = true;
    for (let i = 0; i < e.count; i++) {
      if (i === row) continue;
      if (((e.flags[i] as number) & (EnemyFlag.Metin | EnemyFlag.Boss)) !== 0) continue;
      if (e.state[i] !== EnemyState.Dying) killEnemy(w, i, -1, -1, false);
    }
    w.noLoot = false;
    beginVictory(w);
  }
}

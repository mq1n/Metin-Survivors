// Combat core: damage to enemies/players, statuses, knockback, kills, healing, player death/revive.
// Damage to an enemy = base (skill × player multipliers) × crit × race/boss × resist × weaken. Player damage taken =
// enemy dmg × time scale × attack mul × (1 − elemental resist) × (1 − armor/(armor+K)) — min 1.

import type { RaceTag } from '../data/schema';
import { DT, HAZARD_IFRAMES, KNOCK_DECAY, PLAYER_IFRAMES } from './constants';
import { HealSource } from './events';
import { dropLoot, spawnXp } from './pickups';
import {
  AffixId,
  EnemyFlag,
  EnemyState,
  ELEMENTS,
  ElementIdx,
  StatusBit,
  LOOT_XP_ONLY,
  StatusIdx,
  TelegraphAct,
  ZoneKind,
  type PlayerState,
} from './stores';
import { onBossRowDied } from './bosses';
import { onMetinRowDied } from './metins';
import { enemyDefOf, METIN_ROW_TYPE, spawnSplitCopies } from './enemies';
import { onKill } from './skills/hooks';
import { absorbWard, clearShells, oathSave, refillWard, slipBlow, wardDrains } from './skills/shell';
import type { World } from './world';

export interface HitCtx {
  /** owning player, -1 = none (environment / thorns on behalf of nobody) */
  player: number;
  /** global skill slot, -1 = none */
  skill: number;
  /** ElementIdx */
  element: number;
  /** knockback impulse (m of travel for mass 1) pushing AWAY from (sx, sz) */
  knock: number;
  sx: number;
  sz: number;
  /** StatusIdx or -1 */
  statusKind: number;
  statusChance: number;
  /** slow/weaken: fraction; poison/burn/bleed: dps as fraction of hit damage */
  statusPower: number;
  statusDuration: number;
  noCrit: boolean;
  /** suppress trinket procs (chain / crit burst recursion guard) */
  noProc: boolean;
}

export function newHitCtx(): HitCtx {
  return {
    player: -1, skill: -1, element: 0, knock: 0, sx: 0, sz: 0, statusKind: -1, statusChance: 0, statusPower: 0,
    statusDuration: 0, noCrit: false, noProc: false,
  };
}

export function resetHitCtx(c: HitCtx): HitCtx {
  c.player = -1;
  c.skill = -1;
  c.element = 0;
  c.knock = 0;
  c.sx = 0;
  c.sz = 0;
  c.statusKind = -1;
  c.statusChance = 0;
  c.statusPower = 0;
  c.statusDuration = 0;
  c.noCrit = false;
  c.noProc = false;
  return c;
}

const procCtx = newHitCtx();

/** damage multiplier on a creature under Fear (next to the Freeze x1.2) */
const FEAR_VULN = 1.15;


/** element hostile attacks of a creature carry, derived from its race tags */
export function elementOfRaces(tags: readonly RaceTag[]): number {
  for (const t of tags) {
    if (t === 'fire' || t === 'dragon') return ElementIdx.Fire;
    if (t === 'ice') return ElementIdx.Ice;
    if (t === 'undead' || t === 'devil' || t === 'esoteric') return ElementIdx.Dark;
    if (t === 'insect') return ElementIdx.Poison;
  }
  return ElementIdx.Physical;
}

// ---------------------------------------------------------------------------
// Enemies

/**
 * Apply a hit. `base` is the final per-hit damage of the skill (player multipliers included, crit not yet).
 * Returns the damage dealt (0 when the target cannot be hit).
 */
export function hitEnemy(w: World, row: number, base: number, c: HitCtx): number {
  const e = w.enemies;
  if (e.state[row] === EnemyState.Dying) return 0;
  const flags = e.flags[row] as number;
  if ((flags & (EnemyFlag.Invuln | EnemyFlag.Phased)) !== 0) return 0;
  const p = c.player >= 0 ? w.players[c.player] : undefined;
  const isMetin = (flags & EnemyFlag.Metin) !== 0;
  const boss = e.eliteTier[row] === 3;
  const type = e.type[row] as number;
  let dmg = base;
  let crit = false;
  if (p) {
    const s = p.stats;
    if (!c.noCrit && s.critChance > 0 && w.rng.combat.next() < s.critChance) {
      crit = true;
      dmg *= s.critMul;
    }
    if (!isMetin) dmg *= p.raceMul[type] ?? 1;
    if (boss) dmg *= 1 + s.vsBoss;
  }
  if (!isMetin) {
    const def = w.typeDefs[type];
    const resist = def?.resist?.[ELEMENTS[c.element] ?? 'physical'];
    if (resist) dmg *= Math.max(0.1, 1 - resist);
    const st = e.status[row] as number;
    if ((st & StatusBit.Weaken) !== 0) dmg *= 1 + (e.statP[row * 8 + StatusIdx.Weaken] as number);
    if ((st & StatusBit.Freeze) !== 0) dmg *= 1.2;
    // creatures in panic take more from everything (every fear source: Fear, night terror, dragon roar, wolf's howl)
    if ((st & StatusBit.Fear) !== 0) dmg *= FEAR_VULN;
    // a warded elite (EL-02) shrugs off part of every blow while it is healthy
    if (e.affix[row] === AffixId.Warded) dmg *= wardedMul(w, row);
  }
  if (dmg < 0.25) dmg = 0.25;
  return applyDamage(w, row, dmg, crit, c, p, isMetin, boss);
}

function applyDamage(w: World, row: number, dmg: number, crit: boolean, c: HitCtx, p: PlayerState | undefined, isMetin: boolean, boss: boolean): number {
  const e = w.enemies;
  const hp = (e.hp[row] as number) - dmg;
  e.hp[row] = hp;
  e.flash[row] = 1;
  if (c.player >= 0) e.lastHitter[row] = c.player;
  w.tally.damageDealt += dmg;
  // decayed damage dealt (player.ts decays it): the dragon coil picks the ally with the most
  if (p) p.dmgRecent += dmg;
  if (c.skill >= 0) {
    const si = w.skillSlots[c.skill];
    if (si) si.damage += dmg;
  }
  const x = e.x[row] as number;
  const z = e.z[row] as number;
  const killed = hp <= 0;
  w.bus.damage(x, z, dmg, crit, c.element, e.id[row] as number, c.player, c.skill, killed, false, boss);

  if (p) {
    const ls = p.stats.lifesteal;
    if (ls > 0) lifestealHeal(w, p, dmg * ls);
  }
  if (!isMetin && !killed) {
    // statuses from the skill
    if (c.statusKind >= 0 && c.statusChance > 0 && w.rng.combat.next() < c.statusChance) {
      applyStatusFromHit(w, row, c.statusKind, c.statusDuration, c.statusPower, dmg, c.skill, boss);
    }
    if (p && !c.noProc) {
      const s = p.stats;
      if (s.stunChance > 0 && w.rng.combat.next() < s.stunChance) applyStatus(w, row, StatusIdx.Stun, s.stunDuration, 1, -1, boss);
      if (s.slowChance > 0 && w.rng.combat.next() < s.slowChance) applyStatus(w, row, StatusIdx.Slow, s.slowDuration, s.slowPower, -1, boss);
      if (s.poisonChance > 0 && w.rng.combat.next() < s.poisonChance) applyStatus(w, row, StatusIdx.Poison, s.poisonDuration, s.poisonPower * dmg, -1, boss);
    }
    if (c.knock > 0) knockEnemy(w, row, c.knock, c.sx, c.sz, boss);
  }
  if (p && !c.noProc) procs(w, row, dmg, crit, c, p, x, z);
  if (killed) killEnemy(w, row, c.player, c.skill, crit);
  return dmg;
}

/**
 * Damage multiplier of a warded elite (EL-02, affixes.json params.warded): `1 - reduction` while its HP is above `above` of its max,
 * 1 from there down. Read from the HP before the blow, so a blow that crosses the line is still reduced.
 */
function wardedMul(w: World, row: number): number {
  const p = w.ix.affixes.params.warded;
  const e = w.enemies;
  return (e.hp[row] as number) > (e.hpMax[row] as number) * p.above ? 1 - p.reduction : 1;
}

/** chain-hit and crit-burst trinket procs (never recursive) */
function procs(w: World, row: number, dmg: number, crit: boolean, c: HitCtx, p: PlayerState, x: number, z: number): void {
  const s = p.stats;
  if (s.chainChance > 0 && w.rng.combat.next() < s.chainChance) {
    const e = w.enemies;
    const target = w.hash.nearest(e, x, z, 6, e.id[row] as number);
    if (target >= 0) {
      resetHitCtx(procCtx);
      procCtx.player = c.player;
      procCtx.skill = c.skill;
      procCtx.element = c.element;
      procCtx.noProc = true;
      procCtx.noCrit = true;
      w.bus.vfxLine('vfx_chain_link', x, z, e.x[target] as number, e.z[target] as number, 1, 0.2, c.element);
      hitEnemy(w, target, dmg * s.chainDamage, procCtx);
    }
  }
  if (crit && s.critBurstRadius > 0 && s.critBurstDamage > 0) {
    const n = w.hash.queryCircle(w.enemies, x, z, s.critBurstRadius, w.qb);
    resetHitCtx(procCtx);
    procCtx.player = c.player;
    procCtx.skill = c.skill;
    procCtx.element = c.element;
    procCtx.noProc = true;
    procCtx.noCrit = true;
    procCtx.knock = 0.6;
    procCtx.sx = x;
    procCtx.sz = z;
    const tid = w.enemies.id[row] as number;
    const bdmg = dmg * s.critBurstDamage;
    w.bus.vfx('vfx_crit_burst', x, z, 0, 1, s.critBurstRadius, 0.3, c.element);
    for (let i = 0; i < n; i++) {
      const r = w.qb[i] as number;
      if (w.enemies.id[r] === tid) continue;
      hitEnemy(w, r, bdmg, procCtx);
    }
  }
}

export function knockEnemy(w: World, row: number, impulse: number, fromX: number, fromZ: number, boss: boolean): void {
  const e = w.enemies;
  const def = w.typeDefs[e.type[row] as number];
  const mass = Math.max(0.3, def?.mass ?? 1);
  let k = impulse / mass;
  if (boss) k *= 0.12;
  if (e.state[row] === EnemyState.Dash || e.state[row] === EnemyState.Leap) k *= 0.3;
  let dx = (e.x[row] as number) - fromX;
  let dz = (e.z[row] as number) - fromZ;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) {
    dx = 0;
    dz = 1;
  } else {
    dx /= d;
    dz /= d;
  }
  let vx = (e.kvx[row] as number) + dx * k * KNOCK_DECAY;
  let vz = (e.kvz[row] as number) + dz * k * KNOCK_DECAY;
  const m = Math.hypot(vx, vz);
  const max = 42;
  if (m > max) {
    vx = (vx / m) * max;
    vz = (vz / m) * max;
  }
  e.kvx[row] = vx;
  e.kvz[row] = vz;
}

/**
 * Apply a status. DoT kinds expect `power` already as dps (absolute); slow/weaken as a fraction.
 * Bosses shrug off hard crowd control (stun/freeze/fear ×0.25).
 */
export function applyStatus(w: World, row: number, kind: number, duration: number, power: number, skill: number, boss: boolean): void {
  const e = w.enemies;
  if ((e.flags[row] as number) & EnemyFlag.Metin) return;
  let dur = duration;
  if (boss && (kind === StatusIdx.Stun || kind === StatusIdx.Freeze || kind === StatusIdx.Fear)) dur *= 0.25;
  if (dur <= 0) return;
  const i = row * 8 + kind;
  if ((e.statT[i] as number) < dur) e.statT[i] = dur;
  if ((e.statP[i] as number) < power) e.statP[i] = power;
  e.statSkill[i] = skill < 0 ? 255 : skill;
  e.status[row] = (e.status[row] as number) | (1 << kind);
}

function applyStatusFromHit(w: World, row: number, kind: number, duration: number, power: number, dmg: number, skill: number, boss: boolean): void {
  const dot = kind === StatusIdx.Poison || kind === StatusIdx.Burn || kind === StatusIdx.Bleed;
  applyStatus(w, row, kind, duration, dot ? power * dmg : power, skill, boss);
}

const DOT_INTERVAL = 0.5;

/** decay statuses and apply damage-over-time */
export function updateStatuses(w: World): void {
  const e = w.enemies;
  const n = e.count;
  const status = e.status;
  for (let row = 0; row < n; row++) {
    const st = status[row] as number;
    if (st === 0) {
      e.dotT[row] = 0;
      continue;
    }
    if (e.state[row] === EnemyState.Dying) continue;
    let dps = 0;
    let dotSkill = 255;
    let dotElement = ElementIdx.Physical;
    let dotDominant = 0;
    let mask = st;
    const base = row * 8;
    for (let k = 0; k < 8; k++) {
      const bit = 1 << k;
      if ((st & bit) === 0) continue;
      const t = (e.statT[base + k] as number) - DT;
      if (t <= 0) {
        e.statT[base + k] = 0;
        e.statP[base + k] = 0;
        mask &= ~bit;
        continue;
      }
      e.statT[base + k] = t;
      if (k === StatusIdx.Poison || k === StatusIdx.Burn || k === StatusIdx.Bleed) {
        const d = e.statP[base + k] as number;
        dps += d;
        if (d > dotDominant) {
          dotDominant = d;
          dotSkill = e.statSkill[base + k] as number;
          dotElement = k === StatusIdx.Poison ? ElementIdx.Poison : k === StatusIdx.Burn ? ElementIdx.Fire : ElementIdx.Physical;
        }
      }
    }
    status[row] = mask;
    if (dps > 0) {
      const dt = (e.dotT[row] as number) + DT;
      if (dt >= DOT_INTERVAL) {
        e.dotT[row] = 0;
        dotDamage(w, row, dps * dt, dotElement, dotSkill === 255 ? -1 : dotSkill);
      } else {
        e.dotT[row] = dt;
      }
    } else {
      e.dotT[row] = 0;
    }
  }
}

function dotDamage(w: World, row: number, amount: number, element: number, skill: number): void {
  const e = w.enemies;
  let dmg = amount;
  const def = w.typeDefs[e.type[row] as number];
  const resist = def?.resist?.[ELEMENTS[element] ?? 'physical'];
  if (resist) dmg *= Math.max(0.1, 1 - resist);
  if (e.affix[row] === AffixId.Warded) dmg *= wardedMul(w, row);
  if (dmg <= 0) return;
  const hp = (e.hp[row] as number) - dmg;
  e.hp[row] = hp;
  w.tally.damageDealt += dmg;
  const owner = e.lastHitter[row] as number;
  const dp = w.players[owner];
  if (dp) dp.dmgRecent += dmg; // a burn / poison ally counts for the dragon's host pick
  if (skill >= 0) {
    const si = w.skillSlots[skill];
    if (si) si.damage += dmg;
  }
  const boss = e.eliteTier[row] === 3;
  const killed = hp <= 0;
  w.bus.damage(e.x[row] as number, e.z[row] as number, dmg, false, element, e.id[row] as number, owner, skill, killed, true, boss);
  if (killed) {
    killEnemy(w, row, owner, skill, false);

  }
}

/** mark an enemy dead: events, kill counters, loot and boss/metin hooks. The row is removed at the end of the tick. */
export function killEnemy(w: World, row: number, killer: number, skill: number, crit: boolean): void {
  const e = w.enemies;
  if (e.state[row] === EnemyState.Dying) return;
  const flags = e.flags[row] as number;
  e.state[row] = EnemyState.Dying;
  e.stateT[row] = 0;
  e.hp[row] = 0;
  const isMetin = (flags & EnemyFlag.Metin) !== 0;
  const type = isMetin ? METIN_ROW_TYPE : (e.type[row] as number);
  w.bus.enemyDeath(e.id[row] as number, type, e.x[row] as number, e.z[row] as number, e.rot[row] as number, e.scale[row] as number, e.eliteTier[row] as number, killer, skill, crit);
  if (isMetin) {
    onMetinRowDied(w, row, killer);
    return;
  }
  w.spawner.alive--;
  w.tally.kills++;
  const kp = w.players[killer];
  if (kp) {
    kp.kills++;
    onKill(w, kp, e.x[row] as number, e.z[row] as number, (flags & EnemyFlag.Boss) !== 0);
  }
  if (e.eliteTier[row] === 1 || e.eliteTier[row] === 2) w.tally.elitesKilled++;
  if ((flags & EnemyFlag.Boss) !== 0) onBossRowDied(w, row, killer);
  if (e.lootTier[row] === LOOT_XP_ONLY) dropXpOnly(w, row);
  else dropLoot(w, row, killer);
  // a splitting elite (EL-02) leaves its copies behind; not in the final collapse (w.noLoot: the run is won, nothing new may stand up)
  if (e.affix[row] === AffixId.Splitting && !w.noLoot) spawnSplitCopies(w, row);
}

/** the loot of a splitting elite's copy: the XP of a plain creature of its type (dropLoot's xp line) and nothing else: no yeop, potion, magnet or chest roll */
function dropXpOnly(w: World, row: number): void {
  const def = w.typeDefs[w.enemies.type[row] as number];
  if (!def || w.noLoot) return;
  spawnXp(w, w.enemies.x[row] as number, w.enemies.z[row] as number, def.xp * w.diff.reward * (1 + 0.5 * w.corruption) * w.mods.xp);
}

// ---------------------------------------------------------------------------
// Players

/**
 * lifesteal is rate-limited to a fraction of max hp per second. A live ward of a `drain` skill (Obsidian Bulwark) takes the stolen
 * life first (through the same budget), so attacking keeps the bubble up even at full HP.
 */
function lifestealHeal(w: World, p: PlayerState, amount: number): void {
  if (!p.alive) return;
  const drain = p.ward > 0 && wardDrains(w, p);
  if (p.hp >= p.hpMax && !drain) return;
  let heal = Math.min(amount, p.healBudget);
  if (heal <= 0) return;
  p.healBudget -= heal;
  if (drain) heal = refillWard(w, p, heal);
  if (heal > 0) healPlayer(w, p, heal, HealSource.Lifesteal);
}

export function healPlayer(w: World, p: PlayerState, amount: number, source: number): void {
  if (!p.alive || amount <= 0) return;
  const before = p.hp;
  p.hp = Math.min(p.hpMax, p.hp + amount);
  const gained = p.hp - before;
  if (gained > 0.05 && source !== HealSource.Regen) w.bus.heal(p.index, gained, source);
}

/**
 * kind: 0 melee, 1 projectile, 2 hazard tick (a damage aura, a boss breath), 3 terrain tick.
 * A terrain tick (HZ-01: the lava / miasma under the hero, sim/player.ts) is the ground, not a blow: it never rolls evasion, never spends a
 * dodge charge and never hands out i-frames, so standing in lava cannot cancel the crowd's blows. It still honours the i-frames the hero
 * already has (dash, revive, a blow just taken).
 */
export const enum HurtKind {
  Melee = 0,
  Projectile = 1,
  Hazard = 2,
  Terrain = 3,
}

// ---------------------------------------------------------------------------
// Who landed the blow (DT-01). hurtPlayer receives a source position, a kind and, for creature melee only, the striker's handle;
// everything else is told from the stores, from what stands exactly where the blow came from (every system passes its own spot).
// Nothing here draws a random number or changes the sim: the result only feeds PlayerState.lastHitBy / killedBy.

/** a creature's tag: its EnemyDef id, 'boss:<id>' for a boss; '' for a row without a def (a metin hit-row) */
function enemyTag(w: World, row: number): string {
  const def = enemyDefOf(w, row);
  if (!def) return '';
  return w.ix.bosses.has(def.id) ? `boss:${def.id}` : def.id;
}

/** a reasonable bound for how far a shooter walks while its bolt flies (m/s) */
const SHOOTER_DRIFT = 4;
const SHOOTER_REACH_MAX = 14;

/** the creature that fired a bolt from (ox, oz): the nearest ranged creature or boss, within `reach` */
function shooterNear(w: World, ox: number, oz: number, reach: number): string {
  const e = w.enemies;
  let best = -1;
  let bestD = reach * reach;
  for (let row = 0; row < e.count; row++) {
    if (e.state[row] === EnemyState.Dying) continue;
    const def = enemyDefOf(w, row);
    if (!def) continue;
    if (!w.ix.bosses.has(def.id) && !def.attacks.some((a) => a.kind === 'ranged')) continue;
    const dx = (e.x[row] as number) - ox;
    const dz = (e.z[row] as number) - oz;
    const d = dx * dx + dz * dz;
    if (d <= bestD) {
      bestD = d;
      best = row;
    }
  }
  return best >= 0 ? enemyTag(w, best) : '';
}

/** the boss nearest to (x, z) */
function bossNear(w: World, x: number, z: number): string {
  const e = w.enemies;
  let best = -1;
  let bestD = Infinity;
  for (const b of w.bosses) {
    const row = e.find(b.enemy);
    if (row < 0) continue;
    const dx = (e.x[row] as number) - x;
    const dz = (e.z[row] as number) - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = row;
    }
  }
  return best >= 0 ? enemyTag(w, best) : '';
}

function metinTag(w: World, id: number): string {
  for (const m of w.metins) if (m.id === id) return `metin:${m.def.id}`;
  return '';
}

/** the tag of whatever dealt a blow that landed on `p` (see PlayerState.lastHitBy); '' when it cannot be told */
function blowSource(w: World, kind: number, srcX: number, srcZ: number, element: number, srcEnemy: number): string {
  // 0 the ground: sim/player.ts hurts the hero with a terrain tick for the surface it stood on when the tick was taken; the element names it
  // (fire = lava, poison = miasma), so a hero that stepped off the pool on that very tick is still told right
  if (kind === HurtKind.Terrain) return element === ElementIdx.Fire ? 'hazard:lava' : 'hazard:miasma';
  // 1 a creature or boss that named itself (melee strikes)
  if (srcEnemy !== 0) {
    const row = w.enemies.find(srcEnemy);
    if (row >= 0) {
      const tag = enemyTag(w, row);
      if (tag !== '') return tag;
    }
  }
  // 2 a metin: its impact, its damage aura and its ground fields all strike from the metin's own spot
  for (const m of w.metins) if (m.x === srcX && m.z === srcZ) return `metin:${m.def.id}`;
  // 4 a creature striking from where it stands: an aura, a boss breath, a boss landing. The rows are Float32 while a caller may hand over the
  // f64 spot it computed (the teleport landing, bosses.ts), so the source is rounded to float32 first, as the bolt step below does
  const e = w.enemies;
  const sx = Math.fround(srcX);
  const sz = Math.fround(srcZ);
  for (let row = 0; row < e.count; row++) {
    if (e.x[row] !== sx || e.z[row] !== sz) continue;
    const tag = enemyTag(w, row);
    if (tag !== '') return tag;
  }
  // 5 a hostile bolt: the shooter is told from the bolt's spot at birth (position minus its flight)
  if (kind === HurtKind.Projectile) {
    const P = w.projectiles;
    const fx = Math.fround(srcX);
    const fz = Math.fround(srcZ);
    for (let i = 0; i < P.count; i++) {
      if (P.hostile[i] !== 1 || P.x[i] !== fx || P.z[i] !== fz) continue;
      const age = P.age[i] as number;
      return shooterNear(w, fx - (P.vx[i] as number) * age, fz - (P.vz[i] as number) * age, Math.min(SHOOTER_REACH_MAX, 2.5 + SHOOTER_DRIFT * age));
    }
    return '';
  }
  // 6 a resolving telegraph (a boss slam, a meteor): it follows its owner, or belongs to a boss
  const T = w.telegraphs;
  for (let i = 0; i < T.count; i++) {
    if (T.act[i] === TelegraphAct.Visual || T.x[i] !== srcX || T.z[i] !== srcZ) continue;
    const follow = T.follow[i] as number;
    if (follow !== 0) {
      const row = e.find(follow);
      if (row >= 0) return enemyTag(w, row);
    }
    if (T.owner[i] === 1) return bossNear(w, srcX, srcZ);
    return '';
  }
  // 7 a hostile ground zone (a metin's fire ring or poison field, a slam's lingering pool)
  const Z = w.zones;
  for (let i = 0; i < Z.count; i++) {
    if (Z.team[i] !== 1) continue;
    const ring = Z.kind[i] === ZoneKind.FireRing;
    const here = ring
      ? Math.abs(Math.hypot(srcX - (Z.x[i] as number), srcZ - (Z.z[i] as number)) - (Z.radius[i] as number)) < 0.02
      : Z.x[i] === srcX && Z.z[i] === srcZ;
    if (!here) continue;
    return metinTag(w, Z.src[i] as number) || 'hazard:zone';
  }
  return '';
}

/** the handle of the creature that fired the hostile bolt standing at (srcX, srcZ) (ai.ts stamps it on a vampiric shooter's bolts), 0 = unknown */
function boltShooter(w: World, srcX: number, srcZ: number): number {
  const P = w.projectiles;
  const fx = Math.fround(srcX);
  const fz = Math.fround(srcZ);
  for (let i = 0; i < P.count; i++) {
    if (P.hostile[i] === 1 && P.x[i] === fx && P.z[i] === fz) return P.target[i] as number;
  }
  return 0;
}

/**
 * Vampiric (EL-02, affixes.json params.vampiric.heal): the striker heals `heal` x the damage that reached the hero's HP (after armor,
 * ward and shield: a blow a ward soaked heals nothing; an overkill counts the HP the hero had left). The striker is `srcEnemy` for a
 * melee blow, a charge, a leap landing, a breath and an aura; a hostile bolt carries its shooter's handle in `target`. It never heals
 * above its max HP, and a dying striker heals nothing.
 */
function vampiricHeal(w: World, srcEnemy: number, srcX: number, srcZ: number, dealt: number): void {
  const e = w.enemies;
  const handle = srcEnemy !== 0 ? srcEnemy : boltShooter(w, srcX, srcZ);
  const row = e.find(handle);
  if (row < 0 || e.affix[row] !== AffixId.Vampiric || e.state[row] === EnemyState.Dying) return;
  e.hp[row] = Math.min(e.hpMax[row] as number, (e.hp[row] as number) + dealt * w.ix.affixes.params.vampiric.heal);
}

/**
 * Damage a player. `amount` is pre-mitigation (already time-scaled by the caller). Returns true if damage went through.
 * Dash/leap/revive i-frames and evasion nullify the hit.
 */
export function hurtPlayer(w: World, pi: number, amount: number, srcX: number, srcZ: number, element: number, kind: number, srcEnemy = 0): boolean {
  const p = w.players[pi];
  if (!p || !p.alive || p.iframes > 0) return false;
  const s = p.stats;
  // dodge charges (Swallow's Gait) slip the next blows before the evasion roll; hazard and terrain ticks never spend one
  if (p.dodgeN > 0 && kind !== HurtKind.Hazard && kind !== HurtKind.Terrain) {
    slipBlow(w, p, srcX, srcZ, element);
    return false;
  }
  // the ground is not dodged: a terrain tick skips the evasion roll (no rng.combat draw) and so grants no i-frames through it
  if (kind !== HurtKind.Terrain && s.evasion > 0 && w.rng.combat.next() < s.evasion) {
    p.iframes = 0.25;
    w.bus.playerHit(pi, 0, 1, p.x, p.z, srcX, srcZ, element, p.hp);
    return false;
  }
  const bal = w.balance;
  let dmg = amount * (1 - (s.resist[element] ?? 0));
  dmg *= 1 - s.armor / (s.armor + bal.armorK);
  if (dmg < 1) dmg = 1;
  // the hurt ring (trigger kinds hurt / danger): post-armor, BEFORE any ward / shield soaks it
  p.pushHurt(w.time, dmg);
  // thorns answer the blow as it landed, whatever the ward and the shield soak
  const landed = dmg;
  let result = 0;
  // order: armor / resist -> ward -> trinket shield -> HP
  if (p.ward > 0) {
    dmg = absorbWard(w, p, dmg, srcX, srcZ, element);
    // result 3 = soaked by a ward (the shell's own `sk.gen.ward_hit` is the look; the trinket shield keeps result 2)
    if (dmg <= 0) result = 3;
  }
  if (dmg > 0 && p.shield > 0) {
    const absorbed = Math.min(p.shield, dmg);
    p.shield -= absorbed;
    dmg -= absorbed;
    p.shieldCd = 4;
    if (dmg <= 0) result = 2;
  }
  // the War Oath: a killing blow is undone before any revive (the skill is spent, not a revive)
  if (p.lethalSlot >= 0 && p.hp - dmg <= 0 && oathSave(w, p, srcX, srcZ, element)) return false;
  // DT-01: who landed it, read before the thorns below can kill the striker (a blow a ward or shield soaked entirely hurt nobody)
  if (dmg > 0) {
    p.lastHitBy = blowSource(w, kind, srcX, srcZ, element, srcEnemy);
    p.lastHitAt = w.time;
  }
  // what the blow takes from the hero's HP (an overkill takes only what was left)
  const dealt = dmg < p.hp ? dmg : p.hp;
  p.hp -= dmg;
  // a vampiric elite (EL-02) heals by a share of that; srcEnemy is the striker of a melee-like blow, a hostile bolt tells its shooter
  if (dealt > 0 && (srcEnemy !== 0 || kind === HurtKind.Projectile)) vampiricHeal(w, srcEnemy, srcX, srcZ, dealt);
  // a terrain tick leaves p.iframes alone (it is 0 here: the early return above held anything else), so lava is never a shield
  if (kind !== HurtKind.Terrain) p.iframes = kind === HurtKind.Hazard ? HAZARD_IFRAMES : PLAYER_IFRAMES;
  p.flash = 1;
  p.sinceHit = 0;
  p.damageTaken += dmg;
  w.tally.damageTaken += dmg;
  w.bus.playerHit(pi, dmg, result, p.x, p.z, srcX, srcZ, element, Math.max(0, p.hp));
  if (kind === HurtKind.Melee && s.thorns > 0 && srcEnemy !== 0) {
    const row = w.enemies.find(srcEnemy);
    if (row >= 0) {
      resetHitCtx(procCtx);
      procCtx.player = pi;
      procCtx.noProc = true;
      procCtx.noCrit = true;
      procCtx.element = ElementIdx.Physical;
      hitEnemy(w, row, (landed + amount * 0.25) * s.thorns, procCtx);
    }
  }
  if (p.hp <= 0) playerDown(w, p);
  return true;
}

function playerDown(w: World, p: PlayerState): void {
  if (p.revivesUsed < p.stats.revives) {
    p.revivesUsed++;
    p.hp = p.hpMax * 0.5;
    p.iframes = 3;
    p.flash = 1;
    w.bus.playerRevive(p.index, p.x, p.z, p.stats.revives - p.revivesUsed);
    w.bus.vfx('vfx_revive', p.x, p.z, 0, 1, 7, 0.9, ElementIdx.Holy);
    w.bus.sfx('sfx_revive', p.x, p.z);
    // shockwave clears space around the hero
    const n = w.hash.queryCircle(w.enemies, p.x, p.z, 8, w.qb);
    resetHitCtx(procCtx);
    procCtx.knock = 5;
    procCtx.sx = p.x;
    procCtx.sz = p.z;
    for (let i = 0; i < n; i++) {
      const r = w.qb[i] as number;
      knockEnemy(w, r, 5, p.x, p.z, w.enemies.eliteTier[r] === 3);
    }
    return;
  }
  p.hp = 0;
  p.alive = false;
  // DT-01: the defeat report names the last blow that landed (a revive above is not a death: only this branch records one)
  p.killedBy = p.lastHitBy;
  p.killedAt = w.time;
  clearShells(w, p);
  p.clip = 'death';
  p.clipT = 0;
  p.vx = 0;
  p.vz = 0;
  w.bus.playerDeath(p.index, p.x, p.z);
}

/** push a player away from a point */
export function pushPlayer(p: PlayerState, fromX: number, fromZ: number, impulse: number): void {
  // a steady shell (Graniteform): nothing moves the hero
  if (p.steadyT > 0) return;
  let dx = p.x - fromX;
  let dz = p.z - fromZ;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) {
    dx = 0;
    dz = 1;
  } else {
    dx /= d;
    dz /= d;
  }
  p.kvx += dx * impulse * KNOCK_DECAY;
  p.kvz += dz * impulse * KNOCK_DECAY;
}

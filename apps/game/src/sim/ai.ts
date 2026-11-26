// Enemy AI: movement per EnemyDef.ai (chase, ranged kiting, charger windup+dash, swarm weave, tank, skirmisher
// hit-and-run), attacks per AttackKind (melee, ranged, charge, leap, explode, aura, breath), separation, statuses,
// knockback integration and relocation of far-away enemies.

import type { EnemyAttack, EnemyDef } from '../data/schema';
import { elementOfRaces, hurtPlayer, HurtKind, killEnemy } from './combat';
import { DT, MAX_ATTACKS, PLAYER_RADIUS, RELOCATE_DIST, SPAWN_RING_MAX, SPAWN_RING_MIN } from './constants';
import { ringPosition, spawnable, type Pos } from './spawner';
import { spawnProjectile } from './skills/common';
import { addTelegraph } from './telegraph';
import {
  AffixId,
  AnimClip,
  EnemyFlag,
  EnemyState,
  ProjKind,
  StatusBit,
  StatusIdx,
  TelegraphAct,
  TelegraphShape,
  type EnemyStore,
  type PlayerState,
} from './stores';
import type { World } from './world';

const TAU = Math.PI * 2;
const RECOVER_TIME = 0.4;
const SEP_STRENGTH = 0.5;
const KIND_INDEX: Record<EnemyAttack['kind'], number> = { melee: 0, ranged: 1, charge: 2, leap: 3, explode: 4, aura: 5, breath: 6 };
const relocPos: Pos = { x: 0, z: 0 };

/**
 * Write the position of a row: inside the arena, and never onto ground the terrain refuses (slide along an axis, else stay on the
 * previous point). Every branch that moves a creature goes through here: a knockback integrated for a stunned or boss-pattern row
 * used to skip the terrain check and left creatures standing inside cliffs and trees for good (every later step is reverted).
 */
function placeOnGround(w: World, row: number, x: number, z: number): void {
  const e = w.enemies;
  const rr = Math.hypot(x, z);
  const limit = w.arenaRadius - 0.5;
  if (rr > limit) {
    x = (x / rr) * limit;
    z = (z / rr) * limit;
  }
  const walkable = w.env.walkable;
  if (walkable) {
    // the store keeps Float32: test the value that will be stored (a double that is walkable can round onto a blocked cell edge,
    // and the creature then sits on a blocked point whose every slide candidate is blocked too)
    x = Math.fround(x);
    z = Math.fround(z);
    if (!walkable(x, z)) {
      // terrain says no: slide along an axis or stay put
      const ox = e.px[row] as number;
      const oz = e.pz[row] as number;
      if (walkable(x, oz)) z = oz;
      else if (walkable(ox, z)) x = ox;
      else if (walkable(ox, oz)) {
        x = ox;
        z = oz;
      } else if (nudgeOut(walkable, ox, oz, nudgePos)) {
        // it already stands on ground it cannot leave (a rounding edge, a spawn that predates the check): step out by at most 1 m
        x = nudgePos.x;
        z = nudgePos.z;
      } else {
        x = ox;
        z = oz;
      }
    }
  }
  e.x[row] = x;
  e.z[row] = z;
}

const nudgePos: Pos = { x: 0, z: 0 };

/** nearest walkable point within 1 m of (x, z) (8 directions, 0.3 / 0.6 / 1 m), written to `out`; false when there is none */
function nudgeOut(walkable: (x: number, z: number) => boolean, x: number, z: number, out: Pos): boolean {
  for (const r of [0.3, 0.6, 1]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const nx = Math.fround(x + Math.sin(a) * r);
      const nz = Math.fround(z + Math.cos(a) * r);
      if (walkable(nx, nz)) {
        out.x = nx;
        out.z = nz;
        return true;
      }
    }
  }
  return false;
}

function setAnim(e: EnemyStore, row: number, clip: number): void {
  if (e.animClip[row] !== clip) {
    e.animClip[row] = clip;
    e.animT[row] = 0;
  }
}

function turnTo(e: EnemyStore, row: number, want: number, rate: number): void {
  let d = want - (e.rot[row] as number);
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  e.rot[row] = (e.rot[row] as number) + d * Math.min(1, rate * DT);
}

/** Attack rate of a row: 1, or 1 + params.swift.attackRate for a swift elite (EL-02). */
function attackRate(w: World, row: number): number {
  return w.enemies.affix[row] === AffixId.Swift ? 1 + w.ix.affixes.params.swift.attackRate : 1;
}

/**
 * The cooldown that makes an attack cycle (windup + cooldown) `rate` times as fast: (windup + cooldown) / rate - windup. The windup
 * itself stays as it is, so every telegraph keeps the time a hero needs to read it; the whole gain comes out of the cooldown.
 */
function hastened(cooldown: number, windup: number, rate: number): number {
  return rate === 1 ? cooldown : Math.max(0, (windup + cooldown) / rate - windup);
}

/** damage of an attack for this row */
function attackDamage(w: World, row: number, def: EnemyDef, atk: EnemyAttack): number {
  const e = w.enemies;
  return def.damage * (e.dmgMul[row] as number) * atk.damageMul * (1 + 0.42 * (e.corrupted[row] as number));
}

export function updateEnemies(w: World): void {
  const e = w.enemies;
  const n = e.count;
  const players = w.players;
  const single = players.length === 1;
  const walkable = w.env.walkable;
  const t = w.time;
  const tick = w.tick;
  for (let row = 0; row < n; row++) {
    e.px[row] = e.x[row] as number;
    e.pz[row] = e.z[row] as number;
    e.prot[row] = e.rot[row] as number;
    const state = e.state[row] as number;
    if (state === EnemyState.Dying) continue;
    const flash = e.flash[row] as number;
    if (flash > 0) e.flash[row] = Math.max(0, flash - DT * 5);
    e.animT[row] = (e.animT[row] as number) + DT;
    e.stateT[row] = (e.stateT[row] as number) + DT;
    const flags = e.flags[row] as number;
    if ((flags & EnemyFlag.Metin) !== 0) continue;

    const def = w.typeDefs[e.type[row] as number];
    if (!def) continue;

    // target selection
    let ti = e.target[row] as number;
    if (single) ti = 0;
    else if ((row + tick) % 20 === 0 || !(players[ti] as PlayerState).alive) {
      const np = w.nearestPlayer(e.x[row] as number, e.z[row] as number);
      if (np >= 0) ti = np;
    }
    e.target[row] = ti;
    let tp = players[ti] as PlayerState;
    // veil (DESIGN M5): a non-boss creature drops a veiled hero. It re-picks a non-veiled hero within trig.veilRepick, else it
    // has no target: no new attack, it walks to a bait or stands (attacks already wound up and bolts in flight still land).
    let lost = false;
    if (tp.veilT > 0 && e.eliteTier[row] !== 3 && (flags & EnemyFlag.Boss) === 0) {
      const alt = repickUnveiled(w, e.x[row] as number, e.z[row] as number);
      if (alt >= 0) {
        ti = alt;
        tp = players[alt] as PlayerState;
      } else {
        lost = true;
      }
    }

    // knockback integration
    let x = e.x[row] as number;
    let z = e.z[row] as number;
    const kvx = e.kvx[row] as number;
    const kvz = e.kvz[row] as number;
    if (kvx !== 0 || kvz !== 0) {
      x += kvx * DT;
      z += kvz * DT;
      const decay = Math.exp(-9 * DT);
      e.kvx[row] = Math.abs(kvx) < 0.05 ? 0 : kvx * decay;
      e.kvz[row] = Math.abs(kvz) < 0.05 ? 0 : kvz * decay;
    }

    // bosses in a pattern are driven by the boss system
    if ((flags & EnemyFlag.Boss) !== 0 && e.atk[row] === 255 && state !== EnemyState.Move && state !== EnemyState.Spawn) {
      placeOnGround(w, row, x, z);
      continue;
    }

    const st = e.status[row] as number;
    const stunned = (st & (StatusBit.Stun | StatusBit.Freeze)) !== 0;
    if (stunned) {
      if (state !== EnemyState.Stunned) {
        e.state[row] = EnemyState.Stunned;
        e.stateT[row] = 0;
        e.atk[row] = 0;
      }
      setAnim(e, row, AnimClip.Idle);
      placeOnGround(w, row, x, z);
      continue;
    }
    if (state === EnemyState.Stunned) {
      e.state[row] = EnemyState.Move;
      e.stateT[row] = 0;
    }

    // current speed from base × slow × corruption
    let speed = e.baseSpeed[row] as number;
    if ((st & StatusBit.Slow) !== 0) speed *= 1 - Math.min(0.8, e.statP[row * 8 + StatusIdx.Slow] as number);
    const corr = e.corrupted[row] as number;
    if (corr > 0) speed *= 1 + 0.42 * corr;
    // a swift elite (EL-02) runs params.swift.speed faster, whatever slows it
    if (e.affix[row] === AffixId.Swift) speed *= 1 + w.ix.affixes.params.swift.speed;
    e.speed[row] = speed;

    if (!tp.alive) {
      // nobody to chase: idle
      setAnim(e, row, AnimClip.Idle);
      placeOnGround(w, row, x, z);
      continue;
    }
    const dx = tp.x - x;
    const dz = tp.z - z;
    const dist = Math.hypot(dx, dz) || 1e-3;
    const ux = dx / dist;
    const uz = dz / dist;
    const radius = e.radius[row] as number;
    const cur = e.state[row] as number;
    let mx = 0;
    let mz = 0;

    switch (cur) {
      case EnemyState.Spawn:
        if ((e.stateT[row] as number) >= (e.aiT[row] as number)) {
          e.state[row] = EnemyState.Move;
          e.stateT[row] = 0;
          setAnim(e, row, AnimClip.Run);
        }
        break;

      case EnemyState.Move: {
        let desiredX = ux;
        let desiredZ = uz;
        let sp = speed;
        if ((st & StatusBit.Fear) !== 0) {
          // frightened: run away, no attacks
          mx = -ux * speed * 0.9;
          mz = -uz * speed * 0.9;
          setAnim(e, row, AnimClip.Run);
          turnTo(e, row, Math.atan2(-ux, -uz), 12);
          x += mx * DT;
          z += mz * DT;
          break;
        }
        const atkList = def.attacks;
        // choose an attack when ready and in range
        let started = false;
        for (let a = 0; a < atkList.length && a < MAX_ATTACKS; a++) {
          const atk = atkList[a] as EnemyAttack;
          if (t < (e.atkReady[row * MAX_ATTACKS + a] as number)) continue;
          // a creature that lost its target starts nothing (an aura is a hazard, it keeps burning)
          if (lost && atk.kind !== 'aura') continue;
          if (atk.kind === 'aura') {
            if (dist - radius - PLAYER_RADIUS <= atk.range) {
              e.atkReady[row * MAX_ATTACKS + a] = t + atk.cooldown / attackRate(w, row); // an aura has no windup
              hurtPlayer(w, ti, attackDamage(w, row, def, atk), e.x[row] as number, e.z[row] as number, elementOfRaces(def.race), HurtKind.Hazard, e.id[row] as number);
              w.bus.enemyAttack(e.id[row] as number, e.type[row] as number, KIND_INDEX.aura, x, z, ux, uz);
            }
            continue;
          }
          if (!inRange(atk, dist, radius)) continue;
          beginAttack(w, row, a, atk, def, tp, ux, uz);
          started = true;
          break;
        }
        if (started) break;

        // movement by AI archetype
        let backing = false;
        switch (def.ai) {
          case 'swarm': {
            const weave = Math.sin(t * 3.2 + (e.aiA[row] as number)) * 0.5;
            desiredX = ux + uz * weave;
            desiredZ = uz - ux * weave;
            break;
          }
          case 'ranged': {
            const range = rangedPreferred(def);
            if (dist < range - 2.2) {
              desiredX = -ux;
              desiredZ = -uz;
              sp *= 0.85;
            } else if (dist < range + 0.8) {
              // strafe around the hero at preferred distance
              const sgn = e.aiB[row] as number;
              desiredX = -uz * sgn;
              desiredZ = ux * sgn;
              sp *= 0.55;
            }
            break;
          }
          case 'skirmisher': {
            backing = (e.aiC[row] as number) > t;
            if (backing) {
              const sgn = e.aiB[row] as number;
              desiredX = -ux * 0.8 - uz * 0.5 * sgn;
              desiredZ = -uz * 0.8 + ux * 0.5 * sgn;
              sp *= 1.15;
            }
            break;
          }
          default:
            break;
        }
        // bait (DESIGN M5) pulls MOVEMENT only (attack choice above still uses the hero, so a bait never shields an adjacent
        // attacker); bosses ignore it, elites use half its radius. A creature that lost its target stands when no bait reaches it.
        if (!backing && (lost || w.baits.count > 0) && (flags & EnemyFlag.Boss) === 0 && e.eliteTier[row] !== 3) {
          const bi = w.baits.count > 0 ? w.baits.nearest(x, z, (e.eliteTier[row] as number) >= 1 ? 0.5 : 1) : -1;
          if (bi >= 0) {
            const bx = (w.baits.x[bi] as number) - x;
            const bz = (w.baits.z[bi] as number) - z;
            const bd = Math.hypot(bx, bz);
            if (bd > BAIT_STOP) {
              desiredX = bx / bd;
              desiredZ = bz / bd;
            } else {
              sp = 0;
            }
          } else if (lost) {
            sp = 0;
          }
        }
        // hold position once close enough to strike
        const hold = holdDistance(def, radius);
        if (dist <= hold && def.ai !== 'ranged' && !backing) sp = 0;
        const mag = Math.hypot(desiredX, desiredZ) || 1;
        mx = (desiredX / mag) * sp;
        mz = (desiredZ / mag) * sp;
        if (sp > 0) {
          setAnim(e, row, speed > 2.6 ? AnimClip.Run : AnimClip.Walk);
          turnTo(e, row, Math.atan2(desiredX, desiredZ), 12);
        } else {
          setAnim(e, row, AnimClip.Idle);
          turnTo(e, row, Math.atan2(ux, uz), 12);
        }
        x += mx * DT;
        z += mz * DT;
        break;
      }

      case EnemyState.Windup:
        turnTo(e, row, Math.atan2(e.dirX[row] as number, e.dirZ[row] as number), 10);
        if ((e.stateT[row] as number) >= (e.aiT[row] as number)) {
          const atk = def.attacks[e.atk[row] as number];
          if (atk) resolveAttack(w, row, def, atk, tp, ti);
          else endAttack(w, row);
        }
        break;

      case EnemyState.Dash: {
        const dashSpeed = Math.max(9 * w.options.speed, (e.baseSpeed[row] as number) * 3.4);
        const vx = (e.dirX[row] as number) * dashSpeed;
        const vz = (e.dirZ[row] as number) * dashSpeed;
        x += vx * DT;
        z += vz * DT;
        const atk = def.attacks[e.atk[row] as number];
        // contact damage once per dash (check all living players in co-op)
        if (atk && e.aiB[row] === 0) {
          const width = (atk.area ?? radius * 2) / 2 + PLAYER_RADIUS;
          for (let pi = 0; pi < w.players.length; pi++) {
            const p = w.players[pi] as PlayerState;
            if (!p.alive) continue;
            if (Math.hypot(p.x - x, p.z - z) <= width + radius * 0.5) {
              e.aiB[row] = 1;
              hurtPlayer(w, pi, attackDamage(w, row, def, atk), x, z, elementOfRaces(def.race), HurtKind.Melee, e.id[row] as number);
              break;
            }
          }
        }
        if ((e.stateT[row] as number) >= (e.aiT[row] as number)) endAttack(w, row, 0.7);
        break;
      }

      case EnemyState.Leap: {
        x += (e.vx[row] as number) * DT;
        z += (e.vz[row] as number) * DT;
        if ((e.stateT[row] as number) >= (e.aiT[row] as number)) {
          const atk = def.attacks[e.atk[row] as number];
          if (atk) landLeap(w, row, def, atk, x, z);
          endAttack(w, row, 0.5);
        }
        break;
      }

      case EnemyState.Recover:
        // the attack clip finishes its follow-through; dash / leap recoveries stand still
        if (e.animClip[row] !== AnimClip.Attack && e.animClip[row] !== AnimClip.Attack2) setAnim(e, row, AnimClip.Idle);
        if ((e.stateT[row] as number) >= (e.aiT[row] as number)) {
          e.state[row] = EnemyState.Move;
          e.stateT[row] = 0;
        }
        break;

      default:
        break;
    }

    // separation from neighbours (positions from this tick's hash, rows are live)
    if (e.state[row] !== EnemyState.Dash && e.state[row] !== EnemyState.Leap) {
      const cnt = w.hash.neighbours(x, z, w.qn);
      let pushX = 0;
      let pushZ = 0;
      for (let k = 0; k < cnt; k++) {
        const j = w.qn[k] as number;
        if (j === row) continue;
        const ox = (e.x[j] as number);
        const oz = (e.z[j] as number);
        let sx = x - ox;
        let sz = z - oz;
        const minD = ((e.radius[j] as number) + radius) * 0.92;
        const d2 = sx * sx + sz * sz;
        if (d2 >= minD * minD) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-3) {
          sx = (row & 1) === 0 ? 1 : -1;
          sz = (row & 2) === 0 ? 1 : -1;
        } else {
          sx /= d;
          sz /= d;
        }
        const overlap = minD - d;
        const otherStatic = ((e.flags[j] as number) & EnemyFlag.Metin) !== 0;
        const share = otherStatic ? 1 : (flags & EnemyFlag.Boss) !== 0 ? 0.15 : 0.5;
        pushX += sx * overlap * share * SEP_STRENGTH * 2;
        pushZ += sz * overlap * share * SEP_STRENGTH * 2;
      }
      x += pushX;
      z += pushZ;
    }

    placeOnGround(w, row, x, z);

    // far-away enemies are moved back to the ring around the hero instead of wandering off
    if (dist > RELOCATE_DIST && (row + tick) % 20 === 0 && (flags & (EnemyFlag.Boss | EnemyFlag.Pinned)) === 0) {
      ringPosition(w, tp.x, tp.z, SPAWN_RING_MIN, SPAWN_RING_MAX, relocPos);
      // never onto ground it cannot leave (ringPosition's last resort is not checked): stay where it is and try again later
      if (spawnable(w, relocPos.x, relocPos.z)) {
        e.x[row] = relocPos.x;
        e.z[row] = relocPos.z;
        e.px[row] = relocPos.x;
        e.pz[row] = relocPos.z;
      }
    }
  }
}

/** a creature stops this close (m) to the bait it walks to */
const BAIT_STOP = 1.2;

/** nearest living hero (index order breaks ties) that is not veiled and within trig.veilRepick of (x, z), or -1 */
function repickUnveiled(w: World, x: number, z: number): number {
  const players = w.players;
  const reach = w.trig.veilRepick;
  const r2 = reach * reach;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < players.length; i++) {
    const q = players[i];
    if (!q || !q.alive || q.veilT > 0) continue;
    const dx = q.x - x;
    const dz = q.z - z;
    const d = dx * dx + dz * dz;
    if (d <= r2 && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function rangedPreferred(def: EnemyDef): number {
  for (const a of def.attacks) if (a.kind === 'ranged' || a.kind === 'breath') return a.range * 0.75;
  return 6;
}

/** how close a non-ranged enemy walks before it stops and waits for its attack cooldown */
function holdDistance(def: EnemyDef, radius: number): number {
  let reach = 1;
  for (const a of def.attacks) {
    if (a.kind === 'melee') reach = Math.max(reach, a.range);
    // chargers / leapers stand off outside their minimum launch distance instead of camping on top of the hero
    else if (a.kind === 'charge' || a.kind === 'leap') reach = Math.max(reach, 3.4);
  }
  return radius + PLAYER_RADIUS + reach * 0.75;
}

function inRange(atk: EnemyAttack, dist: number, radius: number): boolean {
  switch (atk.kind) {
    case 'melee':
      return dist - radius - PLAYER_RADIUS <= atk.range;
    case 'charge':
      return dist <= atk.range && dist >= 2.5;
    case 'leap':
      return dist <= atk.range && dist >= 2;
    case 'explode':
      return dist - radius - PLAYER_RADIUS <= atk.range;
    default:
      return dist <= atk.range;
  }
}

function beginAttack(w: World, row: number, a: number, atk: EnemyAttack, def: EnemyDef, tp: PlayerState, ux: number, uz: number): void {
  const e = w.enemies;
  e.state[row] = EnemyState.Windup;
  e.stateT[row] = 0;
  e.aiT[row] = atk.windup;
  e.atk[row] = a;
  e.dirX[row] = ux;
  e.dirZ[row] = uz;
  setAnim(e, row, a % 2 === 0 ? AnimClip.Attack : AnimClip.Attack2);
  const x = e.x[row] as number;
  const z = e.z[row] as number;
  const handle = e.id[row] as number;
  const element = elementOfRaces(def.race);
  w.bus.enemyAttack(handle, e.type[row] as number, KIND_INDEX[atk.kind], x, z, ux, uz);
  const rot = Math.atan2(ux, uz);
  switch (atk.kind) {
    case 'charge': {
      const length = atk.range * 1.25 + 1;
      const width = atk.area ?? (e.radius[row] as number) * 2;
      e.aiB[row] = 0;
      addTelegraph(w, { shape: TelegraphShape.Line, x, z, rot, length, width, dur: atk.windup, follow: handle, owner: 0, act: TelegraphAct.Visual, element });
      break;
    }
    case 'leap': {
      const area = atk.area ?? 2;
      e.aiA[row] = tp.x;
      e.aiB[row] = tp.z;
      addTelegraph(w, { shape: TelegraphShape.Circle, x: tp.x, z: tp.z, radius: area, dur: atk.windup, owner: 0, act: TelegraphAct.Visual, element });
      break;
    }
    case 'explode': {
      const area = atk.area ?? atk.range;
      addTelegraph(w, { shape: TelegraphShape.Circle, x, z, radius: area, dur: atk.windup, follow: handle, owner: 0, act: TelegraphAct.Visual, element });
      break;
    }
    case 'breath': {
      const half = Math.atan2(atk.area ?? 2, atk.range);
      addTelegraph(w, { shape: TelegraphShape.Cone, x, z, rot, radius: atk.range, width: half * 2, dur: atk.windup, follow: handle, owner: 0, act: TelegraphAct.Visual, element });
      break;
    }
    default:
      break;
  }

}

function endAttack(w: World, row: number, recover = RECOVER_TIME): void {
  const e = w.enemies;
  // the strike itself can kill its owner (hero thorns run inside hurtPlayer): a dying creature stays dying, otherwise it
  // is revived as a zombie that dies a second time (double kill / loot / xp, spawner.alive below zero)
  if (e.state[row] === EnemyState.Dying) return;
  const def = w.typeDefs[e.type[row] as number];
  const a = e.atk[row] as number;
  const rng = w.rng.ai;
  if (def) {
    const atk = def.attacks[a];
    if (atk) e.atkReady[row * MAX_ATTACKS + a] = w.time + hastened(atk.cooldown * (0.9 + rng.next() * 0.2), atk.windup, attackRate(w, row));
    if (def.ai === 'skirmisher') e.aiC[row] = w.time + 1.1 + rng.next() * 0.8;
  }
  e.state[row] = EnemyState.Recover;
  e.stateT[row] = 0;
  e.aiT[row] = recover;
  // aiA/aiB were reused as leap target / dash hit flag during the attack: restore weave phase and strafe side
  e.aiA[row] = rng.next() * TAU;
  e.aiB[row] = rng.sign();
}

function resolveAttack(w: World, row: number, def: EnemyDef, atk: EnemyAttack, tp: PlayerState, ti: number): void {
  const e = w.enemies;
  const x = e.x[row] as number;
  const z = e.z[row] as number;
  const radius = e.radius[row] as number;
  const element = elementOfRaces(def.race);
  const dmg = attackDamage(w, row, def, atk);
  const handle = e.id[row] as number;
  switch (atk.kind) {
    case 'melee': {
      const d = Math.hypot(tp.x - x, tp.z - z);
      // a little slack so a hero that keeps moving still gets hit by an attack that visibly lands
      if (d - radius - PLAYER_RADIUS <= atk.range * 1.35 + 0.35) hurtPlayer(w, ti, dmg, x, z, element, HurtKind.Melee, handle);
      endAttack(w, row);
      break;
    }
    case 'ranged': {
      const speed = (atk.projectile?.speed ?? 8) * w.options.speed;
      const pr = atk.projectile?.radius ?? 0.3;
      const preset = atk.projectile?.vfx ?? 'vfx_enemy_bolt';
      const dx = tp.x - x;
      const dz = tp.z - z;
      const d = Math.hypot(dx, dz) || 1;
      const bolt = spawnProjectile(w, {
        kind: ProjKind.Hostile,
        x: x + (dx / d) * (radius + 0.3),
        z: z + (dz / d) * (radius + 0.3),
        vx: (dx / d) * speed,
        vz: (dz / d) * speed,
        radius: pr,
        life: (atk.range + 6) / speed,
        damage: dmg,
        element,
        owner: 0,
        skill: 255,
        pierce: 0,
        preset,
      });
      // a vampiric elite's bolt carries its shooter, so the hit that lands can heal it (combat.hurtPlayer; hostile bolts use no target)
      if (bolt >= 0 && e.affix[row] === AffixId.Vampiric) w.projectiles.target[bolt] = handle;
      endAttack(w, row);
      break;
    }
    case 'charge': {
      const len = atk.range * 1.25 + 1;
      const dashSpeed = Math.max(9 * w.options.speed, (e.baseSpeed[row] as number) * 3.4);
      e.state[row] = EnemyState.Dash;
      e.stateT[row] = 0;
      e.aiT[row] = len / dashSpeed;
      e.speed[row] = dashSpeed;
      e.aiB[row] = 0;
      setAnim(e, row, AnimClip.Special1);
      break;
    }
    case 'leap': {
      const tx = e.aiA[row] as number;
      const tz = e.aiB[row] as number;
      const dx = tx - x;
      const dz = tz - z;
      const d = Math.hypot(dx, dz);
      const flight = Math.max(0.35, d / Math.max(8, (e.baseSpeed[row] as number) * 3.2));
      e.state[row] = EnemyState.Leap;
      e.stateT[row] = 0;
      e.aiT[row] = flight;
      e.vx[row] = dx / flight;
      e.vz[row] = dz / flight;
      setAnim(e, row, AnimClip.Special1);
      break;
    }
    case 'explode': {
      const area = atk.area ?? atk.range;
      for (let pi = 0; pi < w.players.length; pi++) {
        const p = w.players[pi] as PlayerState;
        if (!p.alive) continue;
        if (Math.hypot(p.x - x, p.z - z) <= area + PLAYER_RADIUS) hurtPlayer(w, pi, dmg, x, z, element, HurtKind.Melee, handle);
      }
      w.bus.vfx('vfx_explode', x, z, 0, 1, area, 0.45, element);
      w.bus.shake(0.2, 0.2);
      killEnemy(w, row, -1, -1, false);
      break;
    }
    case 'breath': {
      const half = Math.atan2(atk.area ?? 2, atk.range);
      const fx = e.dirX[row] as number;
      const fz = e.dirZ[row] as number;
      for (let pi = 0; pi < w.players.length; pi++) {
        const p = w.players[pi] as PlayerState;
        if (!p.alive) continue;
        const dx = p.x - x;
        const dz = p.z - z;
        const d = Math.hypot(dx, dz) || 1;
        const cos = (dx * fx + dz * fz) / d;
        if (d <= atk.range + PLAYER_RADIUS && cos >= Math.cos(Math.min(Math.PI, half + Math.atan2(PLAYER_RADIUS, d)))) {
          hurtPlayer(w, pi, dmg, x, z, element, HurtKind.Melee, handle);
        }
      }
      w.bus.vfx('vfx_breath', x, z, fx, fz, atk.range, 0.6, element);
      endAttack(w, row);
      break;
    }
    default:
      endAttack(w, row);
      break;
  }
}

function landLeap(w: World, row: number, def: EnemyDef, atk: EnemyAttack, x: number, z: number): void {
  const area = atk.area ?? 2;
  const element = elementOfRaces(def.race);
  const dmg = attackDamage(w, row, def, atk);
  const players = w.players;
  for (let pi = 0; pi < players.length; pi++) {
    const p = players[pi] as PlayerState;
    if (!p.alive) continue;
    if (Math.hypot(p.x - x, p.z - z) <= area + PLAYER_RADIUS) hurtPlayer(w, pi, dmg, x, z, element, HurtKind.Melee, w.enemies.id[row] as number);
  }
  w.bus.vfx('vfx_slam', x, z, 0, 1, area, 0.45, element);
  w.bus.shake(0.25, 0.25);
}

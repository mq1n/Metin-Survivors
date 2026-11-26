// Projectile system: player bolts / homing bolts / orbitals / familiars and hostile bolts.

import { hitEnemy, hurtPlayer, HurtKind } from '../combat';
import { DT, PLAYER_RADIUS } from '../constants';
import { CompanionRole, PROJ_HIT_MEM, ProjKind, type PlayerState, type SkillInstance } from '../stores';
import type { World } from '../world';
import { beginHit, explodeAt, stampHit } from './common';
import { companionStep, creditMimicSlot, markerStep, twinStep } from './companions';

const TURN_RATE = 7;

export function updateProjectiles(w: World): void {
  const P = w.projectiles;
  for (let i = P.count - 1; i >= 0; i--) {
    P.px[i] = P.x[i] as number;
    P.pz[i] = P.z[i] as number;
    P.age[i] = (P.age[i] as number) + DT;
    const life = (P.life[i] as number) - DT;
    P.life[i] = life;
    const kind = P.kind[i] as number;
    let dead = life <= 0;
    switch (kind) {
      case ProjKind.Bolt:
      case ProjKind.Homing:
        // blaze-familiars twins steer and burst on their own; every other bolt (incl. the dragon's breath) is a plain bolt
        dead = (P.role[i] === CompanionRole.Twin ? twinStep(w, i) : moveBolt(w, i, kind === ProjKind.Homing)) || dead;
        break;
      case ProjKind.Orbit:
        dead = orbitStep(w, i) || dead;
        break;
      case ProjKind.Familiar: {
        const role = P.role[i] as number;
        dead = (role === CompanionRole.Chaser ? familiarStep(w, i) : companionStep(w, i, role)) || dead;
        break;
      }
      case ProjKind.Hostile:
        dead = hostileStep(w, i) || (P.life[i] as number) <= 0;
        break;
      case ProjKind.Marker:
        dead = markerStep(w, i) || dead;
        break;
      default:
        break;
    }
    if (dead) {
      if ((kind === ProjKind.Bolt || kind === ProjKind.Homing) && life > 0 && P.role[i] !== CompanionRole.Twin) endBolt(w, i);
      P.free(i);
    }
  }
}

/** awakening explosion where a bolt ended by impact */
function endBolt(w: World, i: number): void {
  const P = w.projectiles;
  const s = w.skillSlots[P.skill[i] as number];
  const p = w.players[P.owner[i] as number];
  if (!s || !p) return;
  const mul = P.mul[i] as number;
  const credit = P.credit[i] as number;
  const dmg0 = s.damage;
  explodeAt(w, p, s, s.fp, P.x[i] as number, P.z[i] as number, mul || 1);
  if (credit > 0 || mul > 0) creditMimicSlot(w, p, s, credit, mul, s.damage - dmg0);
}

function moveBolt(w: World, i: number, homing: boolean): boolean {
  const P = w.projectiles;
  const e = w.enemies;
  let vx = P.vx[i] as number;
  let vz = P.vz[i] as number;
  if (homing) {
    let row = e.find(P.target[i] as number);
    if (row < 0) {
      row = w.hash.nearest(e, P.x[i] as number, P.z[i] as number, 10);
      P.target[i] = row >= 0 ? (e.id[row] as number) : 0;
    }
    if (row >= 0) {
      const speed = Math.hypot(vx, vz) || 1;
      const want = Math.atan2((e.x[row] as number) - (P.x[i] as number), (e.z[row] as number) - (P.z[i] as number));
      const cur = Math.atan2(vx, vz);
      let d = want - cur;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const step = Math.max(-TURN_RATE * DT, Math.min(TURN_RATE * DT, d));
      const a = cur + step;
      vx = Math.sin(a) * speed;
      vz = Math.cos(a) * speed;
      P.vx[i] = vx;
      P.vz[i] = vz;
    }
  }
  const x = (P.x[i] as number) + vx * DT;
  const z = (P.z[i] as number) + vz * DT;
  P.x[i] = x;
  P.z[i] = z;
  P.rot[i] = Math.atan2(vx, vz);
  const n = w.hash.queryCircle(e, x, z, P.radius[i] as number, w.qa);
  if (n === 0) return false;
  const s = w.skillSlots[P.skill[i] as number];
  const p = w.players[P.owner[i] as number];
  if (!s || !p) return true;
  const c = beginHit(p, s, s.fp, x - vx * 0.05, z - vz * 0.05);
  c.knock = P.knock[i] as number;
  const mem = P.hitMem;
  const base = i * PROJ_HIT_MEM;
  let count = (P.aux2[i] as number) | 0;
  const mul = P.mul[i] as number;
  const credit = P.credit[i] as number;
  const dmg0 = s.damage;
  let dead = false;
  for (let k = 0; k < n; k++) {
    const row = w.qa[k] as number;
    const id = e.id[row] as number;
    const scan = count < PROJ_HIT_MEM ? count : PROJ_HIT_MEM;
    let seen = false;
    for (let h = 0; h < scan; h++) {
      if (mem[base + h] === id) {
        seen = true;
        break;
      }
    }
    if (seen) continue;
    mem[base + (count % PROJ_HIT_MEM)] = id;
    count++;
    P.aux2[i] = count;
    hitEnemy(w, row, P.damage[i] as number, c);
    const left = P.pierce[i] as number;
    if (left <= 0) {
      dead = true;
      break;
    }
    P.pierce[i] = left - 1;
  }
  if (credit > 0 || mul > 0) creditMimicSlot(w, p, s, credit, mul, s.damage - dmg0);
  return dead;
}

function orbitStep(w: World, i: number): boolean {
  const P = w.projectiles;
  const p = w.players[P.owner[i] as number];
  if (!p || !p.alive) return true;
  const s = w.skillSlots[P.skill[i] as number];
  if (!s) return true;
  const a = (P.orbitA[i] as number) + (P.orbitW[i] as number) * DT;
  P.orbitA[i] = a;
  const r = P.orbitR[i] as number;
  const x = p.x + Math.sin(a) * r;
  const z = p.z + Math.cos(a) * r;
  P.vx[i] = (x - (P.x[i] as number)) / DT;
  P.vz[i] = (z - (P.z[i] as number)) / DT;
  P.x[i] = x;
  P.z[i] = z;
  P.rot[i] = a;
  const e = w.enemies;
  const n = w.hash.queryCircle(e, x, z, P.radius[i] as number, w.qa);
  if (n === 0) return false;
  const c = beginHit(p, s, s.fp, x, z);
  c.knock = P.knock[i] as number;
  const interval = P.aux[i] as number;
  for (let k = 0; k < n; k++) {
    const row = w.qa[k] as number;
    if (stampHit(w, row, s.slot, interval)) hitEnemy(w, row, P.damage[i] as number, c);
  }
  return false;
}

function familiarStep(w: World, i: number): boolean {
  const P = w.projectiles;
  const p = w.players[P.owner[i] as number];
  if (!p || !p.alive) return true;
  const s = w.skillSlots[P.skill[i] as number];
  if (!s) return true;
  const e = w.enemies;
  const x = P.x[i] as number;
  const z = P.z[i] as number;
  const speed = P.aux[i] as number;
  const strikeR = P.orbitA[i] as number;
  const interval = P.orbitR[i] as number;
  const range = P.orbitW[i] as number;
  const timer = (P.aux2[i] as number) - DT;
  P.aux2[i] = timer;
  const row = w.hash.nearest(e, x, z, range);
  let tx: number;
  let tz: number;
  let stop: number;
  if (row >= 0) {
    tx = e.x[row] as number;
    tz = e.z[row] as number;
    stop = strikeR * 0.6 + (e.radius[row] as number);
  } else {
    // idle: hover near the hero
    const a = P.age[i] as number * 0.9 + i;
    tx = p.x + Math.sin(a) * 2;
    tz = p.z + Math.cos(a) * 2;
    stop = 0.4;
  }
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.hypot(dx, dz);
  let nx = x;
  let nz = z;
  if (d > stop) {
    const step = Math.min(d - stop, speed * (row >= 0 ? 1.4 : 1) * DT);
    nx += (dx / d) * step;
    nz += (dz / d) * step;
    P.rot[i] = Math.atan2(dx, dz);
  }
  P.vx[i] = (nx - x) / DT;
  P.vz[i] = (nz - z) / DT;
  P.x[i] = nx;
  P.z[i] = nz;
  if (row >= 0 && timer <= 0 && d <= stop + strikeR + 0.4) {
    P.aux2[i] = interval;
    const n = w.hash.queryCircle(e, nx, nz, strikeR, w.qa);
    const c = beginHit(p, s, s.fp, nx, nz);
    c.knock = P.knock[i] as number;
    for (let k = 0; k < n; k++) hitEnemy(w, w.qa[k] as number, P.damage[i] as number, c);
    w.bus.vfx(s.def.vfx, nx, nz, Math.sin(P.rot[i] as number), Math.cos(P.rot[i] as number), strikeR, 0.3, P.element[i] as number);
  }
  return false;
}

/** a mirror shell's caster skill: the skill that granted the holder's ward when it is a mirror, else the first skill with a live mirror radius (holder first, then player order) */
function mirrorSource(w: World, holder: PlayerState): SkillInstance | null {
  const granted = holder.wardSlot >= 0 ? w.skillSlots[holder.wardSlot] : undefined;
  if (granted && granted.fp.mirror > 0) return granted;
  const pool = [holder, ...w.players.filter((q) => q !== holder)];
  for (const q of pool) for (const s of q.skills) if (s.fp.mirror > 0 && s.def.behavior === 'selfBuff') return s;
  return null;
}

/** damage cap of a turned bolt, in multiples of the mirror skill's own damage */
const MIRROR_CAP = 3;

/**
 * Reflect's dome: a hostile bolt that enters `holder.mirrorR` turns around as the caster's own bolt (damage kept, capped at
 * 3x the skill's damage, hostile 0 so it never turns again). Returns true when the row was converted.
 */
function mirrorFlip(w: World, i: number, holder: PlayerState): boolean {
  const P = w.projectiles;
  const x = P.x[i] as number;
  const z = P.z[i] as number;
  const dx = holder.x - x;
  const dz = holder.z - z;
  const r = holder.mirrorR;
  if (dx * dx + dz * dz > r * r) return false;
  const src = mirrorSource(w, holder);
  if (!src) return false;
  P.kind[i] = ProjKind.Bolt;
  P.hostile[i] = 0;
  P.owner[i] = src.owner;
  P.skill[i] = src.slot;
  P.damage[i] = Math.min(P.damage[i] as number, MIRROR_CAP * src.fp.damage);
  P.vx[i] = -(P.vx[i] as number);
  P.vz[i] = -(P.vz[i] as number);
  P.rot[i] = Math.atan2(P.vx[i] as number, P.vz[i] as number);
  P.pierce[i] = 0;
  P.knock[i] = 0;
  P.aux2[i] = 0;
  P.mul[i] = 0;
  P.credit[i] = 0;
  P.life[i] = Math.max(P.life[i] as number, 1.2);
  P.age[i] = 0;
  w.bus.vfx('sk.mirror_shell.turn', x, z, P.vx[i] as number, P.vz[i] as number, 1, 0.3, P.element[i] as number);
  return true;
}

function hostileStep(w: World, i: number): boolean {
  const P = w.projectiles;
  const x = (P.x[i] as number) + (P.vx[i] as number) * DT;
  const z = (P.z[i] as number) + (P.vz[i] as number) * DT;
  P.x[i] = x;
  P.z[i] = z;
  const r = P.radius[i] as number;
  const players = w.players;
  for (let pi = 0; pi < players.length; pi++) {
    const p = players[pi] as PlayerState;
    if (!p.alive) continue;
    if (p.mirrorT > 0 && p.mirrorR > 0 && mirrorFlip(w, i, p)) return false;
    const dx = p.x - x;
    const dz = p.z - z;
    const rr = r + PLAYER_RADIUS;
    if (dx * dx + dz * dz <= rr * rr) {
      if (p.iframes <= 0) {
        hurtPlayer(w, pi, P.damage[i] as number, x, z, P.element[i] as number, HurtKind.Projectile);
        return true;
      }
    }
  }
  return false;
}

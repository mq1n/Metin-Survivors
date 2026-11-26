// Shared helpers for skill behaviors: targeting, hit contexts, zone/projectile spawning, cast bookkeeping.

import { MAX_SKILL_SLOTS } from '../constants';
import { hitEnemy, newHitCtx, resetHitCtx, type HitCtx } from '../combat';
import { SchedKind } from '../scheduler';
import { EnemyFlag, EnemyState, ProjKind, ZoneKind, type PlayerState, type SkillInstance } from '../stores';
import { MetinPhase } from '../types';
import type { World } from '../world';
import { queueMimic } from './companions';
import type { FinalParams } from './params';
import { castVeil } from './shell';

/** shared hit context for behaviors (reset on every `beginHit`) */
const hitCtx = newHitCtx();
const novaCtx = newHitCtx();

/** configure the shared hit context for `s` fired from (sx, sz) */
export function beginHit(p: PlayerState, s: SkillInstance, fp: FinalParams, sx: number, sz: number): HitCtx {
  const c = resetHitCtx(hitCtx);
  c.player = p.index;
  c.skill = s.slot;
  c.element = fp.element;
  c.knock = fp.knockback;
  c.sx = sx;
  c.sz = sz;
  c.statusKind = fp.statusKind;
  c.statusChance = fp.statusChance;
  c.statusPower = fp.statusPower;
  c.statusDuration = fp.statusDuration;
  return c;
}

/** per-(enemy, skill slot) hit gate: true (and arms the gate for `interval` s) when the enemy may be hit again */
export function stampHit(w: World, row: number, slot: number, interval: number): boolean {
  const i = row * MAX_SKILL_SLOTS + slot;
  const stamps = w.enemies.hitStamp;
  if ((stamps[i] as number) > w.time) return false;
  stamps[i] = w.time + interval;
  return true;
}

export function facingX(p: PlayerState): number {
  return Math.sin(p.rot);
}
export function facingZ(p: PlayerState): number {
  return Math.cos(p.rot);
}

/** scratch aim result (valid until the next `aim` call) */
export const aimOut = { dx: 0, dz: 1, row: -1, dist: 0 };

/**
 * A hero standing this close to a breakable metin stone (gap = centre distance − stone radius, m) aims its skills at
 * the stone instead of the nearest creature: the stone keeps summoning swarms that are always nearer than the pinned
 * stone, so plain nearest-targeting spent almost nothing on it (e2e audit P2-2). A boss within the skill's reach keeps
 * the plain nearest targeting, so a stone never pulls the hero's attacks out of a boss fight.
 */
export const STONE_FOCUS_GAP = 3;

/** true when a living boss is within `range` (gap) of the hero */
function bossInReach(w: World, p: PlayerState, range: number): boolean {
  const e = w.enemies;
  for (const b of w.bosses) {
    const row = e.find(b.enemy);
    if (row < 0 || e.state[row] === EnemyState.Dying) continue;
    const gap = Math.hypot((e.x[row] as number) - p.x, (e.z[row] as number) - p.z) - (e.radius[row] as number);
    if (gap < range) return true;
  }
  return false;
}

/**
 * the breakable (alive / awakened, not the Great Metin, not invulnerable or phased) stone row the hero stands at, or -1;
 * always -1 while a boss is within `range`
 */
export function focusStone(w: World, p: PlayerState, range: number): number {
  const metins = w.metins;
  if (metins.length === 0) return -1;
  if (w.bosses.length > 0 && bossInReach(w, p, range)) return -1;
  const e = w.enemies;
  let best = -1;
  let bestGap = Math.min(STONE_FOCUS_GAP, range);
  for (const m of metins) {
    if (m.great || (m.phase !== MetinPhase.Alive && m.phase !== MetinPhase.Awakened)) continue;
    const row = e.find(m.enemy);
    if (row < 0) continue;
    if (((e.flags[row] as number) & (EnemyFlag.Invuln | EnemyFlag.Phased)) !== 0) continue;
    const st = e.state[row];
    if (st === EnemyState.Dying || st === EnemyState.Spawn) continue;
    const gap = Math.hypot((e.x[row] as number) - p.x, (e.z[row] as number) - p.z) - (e.radius[row] as number);
    if (gap < bestGap) {
      bestGap = gap;
      best = row;
    }
  }
  return best;
}

/**
 * Pick the target within `range` of the player — a breakable metin stone the hero stands at (`focusStone`), else the
 * nearest hittable enemy — and compute the aim direction.
 * Without a target the aim falls back to the hero facing and `aimOut.row` is -1.
 */
export function aim(w: World, p: PlayerState, range: number): number {
  const e = w.enemies;
  const stone = focusStone(w, p, range);
  const row = stone >= 0 ? stone : w.hash.nearest(e, p.x, p.z, range);
  aimOut.row = row;
  if (row >= 0) {
    const dx = (e.x[row] as number) - p.x;
    const dz = (e.z[row] as number) - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) {
      aimOut.dx = dx / d;
      aimOut.dz = dz / d;
    } else {
      aimOut.dx = facingX(p);
      aimOut.dz = facingZ(p);
    }
    aimOut.dist = d;
  } else {
    aimOut.dx = facingX(p);
    aimOut.dz = facingZ(p);
    aimOut.dist = 0;
  }
  return row;
}

/**
 * In manual trigger mode (`p.manualAim`), always aims strictly along the player's cursor (`p.aimX/Z`) or current facing
 * direction without auto-locking onto nearby enemies. In auto mode, targets the nearest enemy/Metin within `range`.
 */
export function aimOrManual(w: World, p: PlayerState, range: number): boolean {
  if (p.manualAim) {
    aimOut.row = -1;
    aimOut.dist = 0;
    if (p.hasAim) {
      aimOut.dx = p.aimX;
      aimOut.dz = p.aimZ;
    } else {
      aimOut.dx = facingX(p);
      aimOut.dz = facingZ(p);
    }
    return true;
  }
  const row = aim(w, p, range);
  return row >= 0;
}

let echoGuard = false;
export function inEcho(): boolean {
  return echoGuard;
}
export function setEcho(v: boolean): void {
  echoGuard = v;
}

/**
 * Mimic guard (shadow clone copies): while set, finishCast emits the cast event with an EMPTY hero clip, leaves `p.castT` / `p.rot`
 * alone, fires no nova / echo / veil and never queues another mimic. companions.dispatchMimic sets it inside try / finally.
 */
let mimicGuard = false;
export function inMimic(): boolean {
  return mimicGuard;
}
export function setMimic(v: boolean): void {
  mimicGuard = v;
}

/** scratch result of `forParty` (valid until the next `forParty` call; do not retain) */
export const partyOut: PlayerState[] = [];

/**
 * The holders of a party payload (buff / heal / ward) of caster `p`: `p` itself plus every living ally within `reach` metres,
 * written to `partyOut` in PLAYER INDEX order. `reach` <= 0 or a solo world = just the caster. Returns the count.
 */
export function forParty(w: World, p: PlayerState, reach: number): number {
  partyOut.length = 0;
  const players = w.players;
  if (reach <= 0 || players.length < 2) {
    partyOut.push(p);
    return 1;
  }
  const r2 = reach * reach;
  for (let i = 0; i < players.length; i++) {
    const q = players[i] as PlayerState;
    if (q === p) {
      partyOut.push(q);
      continue;
    }
    if (!q.alive) continue;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    if (dx * dx + dz * dz <= r2) partyOut.push(q);
  }
  return partyOut.length;
}

/**
 * vfx: the buff skills whose base-kit nova has a look of its own (a thin ring roar in the skill's palette, `vfx/skills/<class>/moments.ts`) instead of the shared
 * `vfx_nova` -> shock.wave, whose filled cream disc whited the hero out at every cast (vfx critic X1). Every other skill keeps `vfx_nova`. The war oath's nova
 * (5 m) lands under its save pillar: its ring is a thin gold line. The wrath's golden descent was written for exactly this call.
 */
export const NOVA_VFX: Readonly<Record<string, string>> = {
  berserk: 'sk.warfever.nova',
  war_oath: 'sk.war_oath.nova',
  swallows_gait: 'sk.swallows_gait.nova',
  swiftness: 'sk.tailwind.nova',
  surging_arms: 'sk.surging_arms.nova',
  stormglass_shell: 'sk.stormglass_shell.nova',
  redmane_spirit: 'sk.redmane_spirit.nova',
  blood_frenzy: 'sk.blood_frenzy.nova',
  moonmane_spirit: 'sk.moonmane_spirit.nova',
  sovereigns_ire: 'sk.sovereigns_ire.descent',
};

/**
 * Common tail of a successful cast: cast event + hero clip, base-kit / awakening nova, awakening echo, veil, mimic queue.
 * (x, z) = origin of the effect, (dx, dz) = direction.
 */
export function finishCast(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, x: number, z: number, dx: number, dz: number): void {
  const def = s.def;
  const mim = mimicGuard;
  w.bus.skillCast(p.index, s.slot, def.id, def.behavior, x, z, dx, dz, fp.area, fp.awakened, mim ? '' : (def.heroClip ?? ''), mim);
  w.bus.sfx(def.sfx, x, z, 0.8);
  if (def.heroClip && !mim) {
    p.castT = 0.35;
    p.rot = Math.atan2(dx, dz);
  }
  if (!echoGuard && !mim) {
    if (fp.nova > 0) {
      const c = resetHitCtx(novaCtx);
      c.player = p.index;
      c.skill = s.slot;
      c.element = fp.element;
      // a base-kit nova ("nova" in the skill's params) shoves by the skill's own knockback; an awakening nova keeps the old 1.4
      c.knock = (def.params.nova ?? 0) > 0 && fp.knockback > 0 ? fp.knockback : 1.4;
      c.sx = p.x;
      c.sz = p.z;
      const n = w.hash.queryCircle(w.enemies, p.x, p.z, fp.nova, w.qa);
      w.bus.vfx(NOVA_VFX[def.id] ?? 'vfx_nova', p.x, p.z, 0, 1, fp.nova, 0.45, fp.element);
      const dmg = fp.damage * fp.novaDamage;
      for (let i = 0; i < n; i++) hitEnemy(w, w.qa[i] as number, dmg, c);
    }
    if (fp.echo > 0) w.sched.add(w.time + fp.echo, SchedKind.Echo, p.index, s.slot, 0, x, z, dx, dz, 0);
    if (fp.veil > 0) castVeil(w, p, s, fp);
    // the shadow clone repeats allow-listed casts of the hero (companions.queueMimic filters; nothing without a clone)
    queueMimic(w, p, s, fp, dx, dz);
  }
}

/** AoE hit of every enemy in a circle; returns hits. Uses `w.qa`. */
export function aoeHit(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, x: number, z: number, radius: number, damage: number, knock: number): number {
  const n = w.hash.queryCircle(w.enemies, x, z, radius, w.qa);
  const c = beginHit(p, s, fp, x, z);
  c.knock = knock;
  for (let i = 0; i < n; i++) hitEnemy(w, w.qa[i] as number, damage, c);
  return n;
}

/** explosion at the end of a projectile / strike / zone (awakening `explode`) */
export function explodeAt(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, x: number, z: number, damageMul = 1): void {
  if (fp.explode <= 0) return;
  w.bus.vfx('vfx_explode', x, z, 0, 1, fp.explode, 0.35, fp.element);
  aoeHit(w, p, s, fp, x, z, fp.explode, fp.damage * 0.7 * damageMul, fp.knockback * 0.6);
}

export interface ZoneSpec {
  kind: ZoneKind;
  team: number;
  x: number;
  z: number;
  rot?: number;
  radius: number;
  length?: number;
  angle?: number;
  dur: number;
  delay?: number;
  tick: number;
  damage: number;
  knock?: number;
  follow?: number;
  aux?: number;
  aux2?: number;
  preset: string;
  element: number;
  owner: number;
  skill: number;
  src?: number;
  firstTick?: number;
}

/** create a zone row; returns the row or -1 when the store is full */
export function spawnZone(w: World, z: ZoneSpec): number {
  const store = w.zones;
  const r = store.alloc();
  if (r < 0) return -1;
  store.kind[r] = z.kind;
  store.team[r] = z.team;
  store.x[r] = z.x;
  store.z[r] = z.z;
  store.px[r] = z.x;
  store.pz[r] = z.z;
  store.rot[r] = z.rot ?? 0;
  store.radius[r] = z.radius;
  store.length[r] = z.length ?? 0;
  store.angle[r] = z.angle ?? 0;
  store.t[r] = 0;
  store.dur[r] = z.dur;
  store.delay[r] = z.delay ?? 0;
  store.tick[r] = z.tick;
  store.tickT[r] = z.firstTick ?? Math.min(z.tick, 0.08);
  store.follow[r] = z.follow ?? 0;
  store.preset[r] = w.strings.id(z.preset);
  store.element[r] = z.element;
  store.owner[r] = z.owner;
  store.skill[r] = z.skill;
  store.damage[r] = z.damage;
  store.knock[r] = z.knock ?? 0;
  store.aux[r] = z.aux ?? 0;
  store.aux2[r] = z.aux2 ?? 0;
  store.src[r] = z.src ?? 0;
  return r;
}

export interface ProjSpec {
  kind: ProjKind;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  life: number;
  damage: number;
  element: number;
  owner: number;
  skill: number;
  pierce: number;
  preset: string;
  knock?: number;
  h?: number;
}

export function spawnProjectile(w: World, s: ProjSpec): number {
  const store = w.projectiles;
  const r = store.alloc();
  if (r < 0) return -1;
  store.kind[r] = s.kind;
  store.x[r] = s.x;
  store.z[r] = s.z;
  store.px[r] = s.x;
  store.pz[r] = s.z;
  store.vx[r] = s.vx;
  store.vz[r] = s.vz;
  store.rot[r] = Math.atan2(s.vx, s.vz);
  store.radius[r] = s.radius;
  store.life[r] = s.life;
  store.lifeMax[r] = s.life;
  store.style[r] = w.strings.id(s.preset);
  store.element[r] = s.element;
  store.owner[r] = s.owner;
  store.skill[r] = s.skill;
  store.damage[r] = s.damage;
  store.pierce[r] = s.pierce;
  store.knock[r] = s.knock ?? 0;
  store.h[r] = s.h ?? 1.0;
  store.hostile[r] = s.kind === ProjKind.Hostile ? 1 : 0;
  store.age[r] = 0;
  return r;
}

/**
 * index of the first live enemy row at/near the densest spot around (x,z) within `range` — cheap cluster pick.
 * `corruptedFirst` (Dispel): a metin-corrupted neighbour counts double, so the pick prefers a corrupted cluster.
 */
export function pickClusterTarget(w: World, x: number, z: number, range: number, corruptedFirst = false): number {
  const n = w.hash.queryCircle(w.enemies, x, z, range, w.qa);
  if (n === 0) return -1;
  const e = w.enemies;
  // sample up to 12 candidates, score = neighbours within 3 m among the sample
  const step = Math.max(1, Math.floor(n / 12));
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < n; i += step) {
    const a = w.qa[i] as number;
    let score = 0;
    for (let j = 0; j < n; j += step) {
      const b = w.qa[j] as number;
      const dx = (e.x[a] as number) - (e.x[b] as number);
      const dz = (e.z[a] as number) - (e.z[b] as number);
      if (dx * dx + dz * dz < 9) score += corruptedFirst && (e.corrupted[b] as number) > 0 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

// Companion roles, marker rows and the shadow-clone mimic (DESIGN M4 / M6).
//
// summon.ts delegates to roleCast / roleUpdate for a skill with `def.role`; projectiles.ts steps the rows through
// companionStep (Familiar rows by CompanionRole), twinStep (blaze-familiars twins) and markerStep. Every brain is a small
// function over one ProjectileStore row; the row fields it reuses are listed at its head. No brain draws RNG except the
// orbiter volley (w.rng.combat, host side, at the cast), prey / target ties break by row order, party loops run in
// player-index order.
//
// ROW LAYOUT (all rows: `skill` = the owner's global skill slot, `owner` = caster index, `style` = the skill's vfx id):
//   Orbiter  Familiar/Orbiter  orbitA ring index, orbitR ring size n, orbitW volley countdown (-1 idle), aux ring amplitude,
//                              aux2 phase offset, target = the volley target id
//   Twin     Homing/Twin       aux speed, target id, damage fixed at launch
//   Hunter   Familiar/Hunter   aux speed, aux2 rescore timer (pounce time in state 2), aux3 combo cooldown, orbitA bite reach,
//                              orbitR combo cycle, orbitW prey range, pierce = state (0 seek, 1 run, 2 pounce, 3 bite),
//                              hitMem[0] bites done, target = prey id
//   Pylon    Familiar/Pylon    orbitA splash radius, orbitR zap interval, orbitW range, aux flank angle, aux2 zap timer,
//                              aux3 time of the last re-plant
//   Knight   Familiar/Knight   as Pylon (orbitA sweep radius, orbitR swing interval), hitMem[0] = its bait-ring marker handle
//   Coil     Familiar/Coil     anchor host index, aux speed, aux2 breath timer, aux3 coil phase, orbitA dragon index,
//                              orbitR breath interval, orbitW breath range
//   Breath   Homing/Breath     a plain homing bolt (moveBolt)
//   Mimic    Familiar/Mimic    aux trail lag in ticks, orbitA clone index
//   Marker   Marker            anchor holder index (255 = stationary), radius = look scale (<= 7.9: the snapshot is q8 over 32)

import type { SummonRole } from '../../data/schema';
import { hitEnemy } from '../combat';
import { DT } from '../constants';
import { SchedKind, type SchedEntry } from '../scheduler';
import { CompanionRole, EnemyFlag, EnemyState, PROJ_HIT_MEM, ProjKind, type PlayerState, type SkillInstance } from '../stores';
import type { World } from '../world';
import { aim, aimOrManual, aoeHit, beginHit, finishCast, inEcho, inMimic, pickClusterTarget, setEcho, setMimic, spawnProjectile, stampHit } from './common';
import { BEHAVIORS } from './index';
import { newFinalParams, resolveParams, type FinalParams } from './params';

const TAU = Math.PI * 2;

/**
 * ProjectileStore.role tag for a skill's content role: orbiter / coil / hunter / mimic map 1:1; `planted` is the pylon
 * (thunder_guardians) unless the skill has a taunt radius (cursed_legion knights); no role = the legacy chaser.
 */
export function roleTag(role: SummonRole | undefined, fp: FinalParams): CompanionRole {
  switch (role) {
    case 'orbiter':
      return CompanionRole.Orbiter;
    case 'coil':
      return CompanionRole.Coil;
    case 'hunter':
      return CompanionRole.Hunter;
    case 'planted':
      return fp.taunt > 0 ? CompanionRole.Knight : CompanionRole.Pylon;
    case 'mimic':
      return CompanionRole.Mimic;
    default:
      return CompanionRole.Chaser;
  }
}

// ---------------------------------------------------------------------------
// shared helpers

/** scratch: store rows of the live pets of one skill (valid until the next livePets call) */
const rows = new Int32Array(24);
const scratchIds = new Uint32Array(24);

/** compact `s.pets` to the handles that still resolve to a row; fills `rows` (pet order) and returns their count */
function livePets(w: World, s: SkillInstance): number {
  const P = w.projectiles;
  const pets = s.pets;
  let n = 0;
  for (let k = 0; k < pets.length; k++) {
    const r = P.find(pets[k] as number);
    if (r < 0) {
      pets.splice(k, 1);
      k--;
      continue;
    }
    if (n < rows.length) rows[n++] = r;
  }
  return n;
}

/** free every pet row of `s` now (call from a cast / update, never from inside the projectile loop) */
function freePets(w: World, s: SkillInstance): void {
  const P = w.projectiles;
  const pets = s.pets;
  for (let k = pets.length - 1; k >= 0; k--) {
    const r = P.find(pets[k] as number);
    if (r < 0) continue;
    if (P.role[r] === CompanionRole.Knight) endMarker(w, P.hitMem[r * PROJ_HIT_MEM] as number);
    P.free(r);
  }
  pets.length = 0;
}

/** a companion row: Familiar kind, tagged with its role, remembered in `s.pets` */
function spawnPet(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, role: CompanionRole, x: number, z: number, h: number, life: number, radius: number): number {
  const r = spawnProjectile(w, {
    kind: ProjKind.Familiar,
    x,
    z,
    vx: 0,
    vz: 0,
    radius,
    life,
    damage: fp.damage,
    element: fp.element,
    owner: p.index,
    skill: s.slot,
    pierce: 0,
    preset: s.def.vfx ?? '',
    knock: fp.knockback,
    h,
  });
  if (r < 0) return -1;
  const P = w.projectiles;
  P.role[r] = role;
  s.pets.push(P.id[r] as number);
  return r;
}

/** the summon cast moment every spawn keeps (VFX contract: the 2.5 m cast event + the skillCast with the hero clip) */
function castMoment(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, x: number, z: number, withCast: boolean, withEvent = true): void {
  if (withEvent) w.bus.vfx(s.def.vfx ?? '', x, z, 0, 1, 2.5, 0.6, fp.element);
  if (withCast) finishCast(w, p, s, fp, p.x, p.z, Math.sin(p.rot), Math.cos(p.rot));
}

function hasWalkable(w: World, x: number, z: number): boolean {
  const f = w.env.walkable;
  return f ? f(x, z) : true;
}

/** (x, z) at angle `a` (0 = ahead, +pi/2 = the hero's left) and radius `r` from the hero, pulled in until the ground is walkable */
const spot = { x: 0, z: 0 };
function spotAround(w: World, p: PlayerState, a: number, r: number): void {
  const ang = p.rot + a;
  const sx = Math.sin(ang);
  const sz = Math.cos(ang);
  for (let rr = r; rr > 0.4; rr -= 0.5) {
    const x = p.x + sx * rr;
    const z = p.z + sz * rr;
    if (hasWalkable(w, x, z)) {
      spot.x = x;
      spot.z = z;
      return;
    }
  }
  spot.x = p.x;
  spot.z = p.z;
}

/** move row `i` toward (tx, tz) at `speed`, stopping `stop` short; writes vx / vz / rot; returns the distance BEFORE the move */
function seek(P: World['projectiles'], i: number, tx: number, tz: number, stop: number, speed: number): number {
  const x = P.x[i] as number;
  const z = P.z[i] as number;
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.hypot(dx, dz);
  let nx = x;
  let nz = z;
  if (d > stop) {
    const step = Math.min(d - stop, speed * DT);
    nx += (dx / d) * step;
    nz += (dz / d) * step;
    P.rot[i] = Math.atan2(dx, dz);
  }
  P.vx[i] = (nx - x) / DT;
  P.vz[i] = (nz - z) / DT;
  P.x[i] = nx;
  P.z[i] = nz;
  return d;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

// ---------------------------------------------------------------------------
// MARKER rows (M6)

/** the snapshot writes a row's radius as q8 over 32 (0..7.97 m) */
const MARKER_MAX_SCALE = 7.9;

/** spawn a marker at an arbitrary point; `anchor` 255 = stationary. Returns the row or -1 */
function markerRow(w: World, x: number, z: number, rot: number, owner: number, slot: number, style: string, scale: number, life: number, anchor: number): number {
  const r = spawnProjectile(w, {
    kind: ProjKind.Marker,
    x,
    z,
    vx: 0,
    vz: 0,
    radius: clamp(scale, 0.05, MARKER_MAX_SCALE),
    life: Math.max(DT, life),
    damage: 0,
    element: 0,
    owner,
    skill: slot,
    pierce: 0,
    preset: style,
    h: 0,
  });
  if (r < 0) return -1;
  const P = w.projectiles;
  P.anchor[r] = anchor;
  P.rot[r] = rot;
  return r;
}

/**
 * Spawn a MARKER row (ProjKind.Marker): a look that never collides. `follow` true = it copies `holder`'s position every tick
 * for exactly `life` seconds (shells, veil ring, halos); false = a stationary row at the holder's current position (stealth
 * decoy, bait ring). Row fields: owner = the caster (w.skillSlots[slot].owner), anchor = holder.index (255 when stationary),
 * skill = `slot`, style = `style` (an interned vfx id such as 'sk.gen.veil_ring'), radius = `scale` (look scale, 1 = base 1 m,
 * clamped to 7.9 for the snapshot), life / lifeMax = `life`. Returns the row's stable handle (`projectiles.id[row]`), 0 when
 * nothing was spawned (store full).
 */
export function spawnMarker(w: World, holder: PlayerState, slot: number, style: string, scale: number, life: number, follow: boolean): number {
  const owner = w.skillSlots[slot]?.owner ?? holder.index;
  const r = markerRow(w, holder.x, holder.z, follow ? holder.rot : 0, owner, slot, style, scale, life, follow ? holder.index : 255);
  return r < 0 ? 0 : (w.projectiles.id[r] as number);
}

/**
 * End the marker of `handle`: its life is set to 0, so the projectile step frees it (this tick when the step has not run
 * yet, else on its first visit next tick). Never frees a row directly: a shell breaking inside hostileStep must not
 * swap-remove rows under the projectile loop. Stale / 0 handles are ignored.
 */
export function endMarker(w: World, handle: number): void {
  if (handle === 0) return;
  const P = w.projectiles;
  const r = P.find(handle);
  if (r >= 0 && P.kind[r] === ProjKind.Marker) P.life[r] = 0;
}

/** projectile step of a Marker: follow the holder, die with it */
export function markerStep(w: World, i: number): boolean {
  const P = w.projectiles;
  const a = P.anchor[i] as number;
  if (a === 255) return false;
  const h = w.players[a];
  if (!h || !h.alive) return true;
  P.x[i] = h.x;
  P.z[i] = h.z;
  P.rot[i] = h.rot;
  return false;
}

// ---------------------------------------------------------------------------



const RING_LAP = 2.0;
/** ring half-width (m, across the hero) and depth of the ring at one spirit, low / high point heights (m) */
const RING_LAT = 0.6;
const RING_FWD = 0.55;
const RING_LOW = 0.3;
const RING_HIGH = 1.88;
/** +m of radius per extra spirit, up to this many spirits */
const RING_STEP = 0.15;
const RING_CAP = 5;
const MAX_SPIRITS = 8;
/** s between the twins of one volley */
const VOLLEY_STAGGER = 0.12;
/** a permanent row's life (s) */
const FOREVER = 1e6;

const ring = { x: 0, z: 0, h: 0 };

function ringAmp(n: number): number {
  return RING_LAT + RING_STEP * (Math.min(RING_CAP, Math.max(1, n)) - 1);
}





function ringPos(p: PlayerState, amp: number, theta: number): void {
  const c = Math.cos(theta);
  const lat = -amp * c;
  const fwd = ((amp * RING_FWD) / RING_LAT) * Math.sin(theta);
  const fx = Math.sin(p.rot);
  const fz = Math.cos(p.rot);
  // left = (cos rot, -sin rot)
  ring.x = p.x + fz * lat + fx * fwd;
  ring.z = p.z - fx * lat + fz * fwd;
  ring.h = (RING_LOW + RING_HIGH) / 2 - ((RING_HIGH - RING_LOW) / 2) * c;
}

function spawnSpirit(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, idx: number, n: number): number {
  const r = spawnPet(w, p, s, fp, CompanionRole.Orbiter, p.x, p.z, 1, FOREVER, 0.5);
  if (r < 0) return -1;
  const P = w.projectiles;
  const amp = ringAmp(n);
  const off = (idx * TAU) / n;
  P.orbitA[r] = idx;
  P.orbitR[r] = n;
  P.orbitW[r] = -1;
  P.aux[r] = amp;
  P.aux2[r] = off;
  ringPos(p, amp, (TAU * w.time) / RING_LAP + off);
  P.x[r] = ring.x;
  P.z[r] = ring.z;
  P.px[r] = ring.x;
  P.pz[r] = ring.z;
  P.h[r] = ring.h;
  return r;
}

/** keep exactly `count` spirits alive (permanent rows: first tick, a count card, a co-op revive) and number them on the ring */
function orbiterEnsure(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): void {
  const P = w.projectiles;
  const want = Math.min(MAX_SPIRITS, Math.max(1, fp.count));
  const live = livePets(w, s);
  if (live > want) {
    // free by handle: DenseStore.free swap-removes, so a row index cached before the first free can be stale
    for (let k = s.pets.length - 1; k >= want; k--) {
      const r = P.find(s.pets[k] as number);
      if (r >= 0) P.free(r);
    }
    livePets(w, s);
  }
  const have = Math.min(live, want);
  let spawned = 0;
  for (let k = have; k < want; k++) {
    if (spawnSpirit(w, p, s, fp, k, want) >= 0) spawned++;
  }
  if (spawned > 0) {
    
    castMoment(w, p, s, fp, p.x, p.z, have === 0);
  }
  const n = livePets(w, s);
  for (let k = 0; k < n; k++) {
    const r = rows[k] as number;
    P.orbitA[r] = k;
    P.orbitR[r] = n;
  }
}

/** the volley (cast): every spirit sends its twin to a random creature within range, one RNG draw per spirit */
function orbiterCast(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): boolean {
  const range = fp.range > 0 ? fp.range : 10;
  const e = w.enemies;
  const n = w.hash.queryCircle(e, p.x, p.z, range, w.qa);
  if (n === 0) return false;
  const live = livePets(w, s);
  if (live === 0) return false;
  const P = w.projectiles;
  const rng = w.rng.combat;
  for (let k = 0; k < live; k++) {
    const r = rows[k] as number;
    const t = w.qa[rng.int(n)] as number;
    P.target[r] = e.id[t] as number;
    P.orbitW[r] = k * VOLLEY_STAGGER;
  }
  return true;
}

function orbiterStep(w: World, i: number): boolean {
  const P = w.projectiles;
  const p = w.players[P.owner[i] as number];
  if (!p || !p.alive) return true;
  const s = w.skillSlots[P.skill[i] as number];
  if (!s) return true;
  const n = Math.max(1, P.orbitR[i] as number);
  const wantOff = ((P.orbitA[i] as number) * TAU) / n;
  const dOff = wrapPi(wantOff - (P.aux2[i] as number));
  P.aux2[i] = (P.aux2[i] as number) + clamp(dOff, -3.5 * DT, 3.5 * DT);
  const dAmp = ringAmp(n) - (P.aux[i] as number);
  P.aux[i] = (P.aux[i] as number) + clamp(dAmp, -0.5 * DT, 0.5 * DT);
  ringPos(p, P.aux[i] as number, (TAU * w.time) / RING_LAP + (P.aux2[i] as number));
  const ox = P.x[i] as number;
  const oz = P.z[i] as number;
  const mx = ring.x - ox;
  const mz = ring.z - oz;
  P.vx[i] = mx / DT;
  P.vz[i] = mz / DT;
  if (mx * mx + mz * mz > 1e-8) P.rot[i] = Math.atan2(mx, mz);
  P.x[i] = ring.x;
  P.z[i] = ring.z;
  P.h[i] = ring.h;
  const wait = P.orbitW[i] as number;
  if (wait >= 0) {
    const left = wait - DT;
    P.orbitW[i] = left;
    if (left < 0) {
      P.orbitW[i] = -1;
      launchTwin(w, p, s, i);
    }
  }
  return false;
}

/** the twin leaves the hero's belly (root + 1 m) at 10 m/s toward the spirit's picked target */
function launchTwin(w: World, p: PlayerState, s: SkillInstance, spirit: number): void {
  const P = w.projectiles;
  const e = w.enemies;
  const fp = s.fp;
  let row = (P.target[spirit] as number) !== 0 ? e.find(P.target[spirit] as number) : -1;
  if (row < 0) row = w.hash.nearest(e, p.x, p.z, fp.range > 0 ? fp.range : 10);
  if (row < 0) return;
  let dx = (e.x[row] as number) - p.x;
  let dz = (e.z[row] as number) - p.z;
  const d = Math.hypot(dx, dz);
  if (d > 1e-4) {
    dx /= d;
    dz /= d;
  } else {
    dx = Math.sin(p.rot);
    dz = Math.cos(p.rot);
  }
  const speed = fp.speed > 0 ? fp.speed : 10;
  const range = fp.range > 0 ? fp.range : 10;
  const r = spawnProjectile(w, {
    kind: ProjKind.Homing,
    x: p.x + dx * 0.3,
    z: p.z + dz * 0.3,
    vx: dx * speed,
    vz: dz * speed,
    radius: 0.5,
    life: (range + 4) / speed + 0.4,
    damage: fp.damage,
    element: fp.element,
    owner: p.index,
    skill: s.slot,
    pierce: 0,
    preset: s.def.vfx ?? '',
    knock: fp.knockback,
    h: 1,
  });
  if (r < 0) return;
  P.role[r] = CompanionRole.Twin;
  P.aux[r] = speed;
  P.target[r] = e.id[row] as number;
}

/** twin step: unlimited homing on its target (re-targets the nearest creature when it dies), bursts on arrival */
export function twinStep(w: World, i: number): boolean {
  const P = w.projectiles;
  const p = w.players[P.owner[i] as number];
  const s = w.skillSlots[P.skill[i] as number];
  if (!p || !s) return true;
  const e = w.enemies;
  const x = P.x[i] as number;
  const z = P.z[i] as number;
  const speed = P.aux[i] as number;
  let row = (P.target[i] as number) !== 0 ? e.find(P.target[i] as number) : -1;
  if (row >= 0 && e.state[row] === EnemyState.Dying) row = -1;
  if (row < 0) {
    row = w.hash.nearest(e, x, z, 5);
    P.target[i] = row >= 0 ? (e.id[row] as number) : 0;
  }
  let vx = P.vx[i] as number;
  let vz = P.vz[i] as number;
  if (row >= 0) {
    const tx = e.x[row] as number;
    const tz = e.z[row] as number;
    const dx = tx - x;
    const dz = tz - z;
    const d = Math.hypot(dx, dz);
    const hit = (e.radius[row] as number) + 0.25;
    if (d <= hit + speed * DT) {
      twinImpact(w, i, row, p, s);
      return true;
    }
    vx = (dx / d) * speed;
    vz = (dz / d) * speed;
    P.vx[i] = vx;
    P.vz[i] = vz;
  }
  P.x[i] = x + vx * DT;
  P.z[i] = z + vz * DT;
  P.rot[i] = Math.atan2(vx, vz);
  return false;
}

/** the twin hit: 'damage' on the target, then a burst across 'area' for 60% of it on everything ELSE in reach (the target is not hit twice); vfx_explode marks the impact (muyeong_blow) */
function twinImpact(w: World, i: number, row: number, p: PlayerState, s: SkillInstance): void {
  const P = w.projectiles;
  const e = w.enemies;
  const ex = e.x[row] as number;
  const ez = e.z[row] as number;
  const dmg = P.damage[i] as number;
  const burst = s.fp.area;
  const c = beginHit(p, s, s.fp, ex, ez);
  c.knock = P.knock[i] as number;
  hitEnemy(w, row, dmg, c);
  w.bus.vfx('vfx_explode', ex, ez, 0, 1, burst, 0.35, P.element[i] as number);
  const n = w.hash.queryCircle(e, ex, ez, burst, w.qa);
  const c2 = beginHit(p, s, s.fp, ex, ez);
  c2.knock = P.knock[i] as number;
  for (let k = 0; k < n; k++) {
    const r = w.qa[k] as number;
    if (r !== row) hitEnemy(w, r, dmg * 0.6, c2);
  }
}

// ---------------------------------------------------------------------------
// HUNTER (spirit_wolves): prey score, pounce, three bites

const HUNTER_PRESCORE = 0.5;
const HUNTER_LEASH = 14;
const POUNCE_FROM = 5;
const POUNCE_TIME = 0.3;
const BITE_GAP = 0.2;
const PACK_CAP = 0.45;

function hunterCast(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): boolean {
  const range = fp.range > 0 ? fp.range : 12;
  if (!aimOrManual(w, p, range + 4)) return false;
  freePets(w, s);
  const life = Math.max(3, fp.duration);
  const speed = fp.speed > 0 ? fp.speed : 9;
  const P = w.projectiles;
  for (let k = 0; k < fp.count; k++) {
    const a = (k / fp.count) * TAU + p.rot;
    const r = spawnPet(w, p, s, fp, CompanionRole.Hunter, p.x + Math.sin(a) * 1.4, p.z + Math.cos(a) * 1.4, 0.9, life, 0.5);
    if (r < 0) continue;
    P.aux[r] = speed;
    P.aux2[r] = 0.1 + 0.07 * k;
    P.orbitA[r] = fp.area > 0 ? fp.area : 1.2;
    P.orbitR[r] = fp.tick > 0 ? fp.tick : 1.2;
    P.orbitW[r] = range;
  }
  castMoment(w, p, s, fp, p.x, p.z, true);
  return true;
}

/** prey score of an enemy row for the wolf at (x, z): elite / boss x3, shooter x2, wounded x1.5, claimed-by-a-packmate x0.3, then nearest */
function preyScore(w: World, row: number, x: number, z: number, nClaimed: number): number {
  const e = w.enemies;
  let mult = 1;
  const tier = e.eliteTier[row] as number;
  if (tier >= 1) mult *= 3;
  if (w.typeDefs[e.type[row] as number]?.ai === 'ranged') mult *= 2;
  const hpMax = e.hpMax[row] as number;
  if (hpMax > 0 && (e.hp[row] as number) / hpMax < 0.5) mult *= 1.5;
  if (tier === 0) {
    const id = e.id[row] as number;
    for (let k = 0; k < nClaimed; k++) {
      if (scratchIds[k] === id) {
        mult *= 0.3;
        break;
      }
    }
  }
  const d = Math.hypot((e.x[row] as number) - x, (e.z[row] as number) - z);
  return mult + (1 - Math.min(1, d / 14)) * 0.45;
}

function pickPrey(w: World, p: PlayerState, s: SkillInstance, i: number, range: number): number {
  const P = w.projectiles;
  const e = w.enemies;
  // ids the pack mates already hunt (scratchIds[0..nClaimed))
  let nClaimed = 0;
  for (let k = 0; k < s.pets.length && nClaimed < 16; k++) {
    const r = P.find(s.pets[k] as number);
    if (r < 0 || r === i) continue;
    const t = P.target[r] as number;
    if (t !== 0) scratchIds[nClaimed++] = t;
  }
  const n = w.hash.queryCircle(e, p.x, p.z, range, w.qa);
  const x = P.x[i] as number;
  const z = P.z[i] as number;
  let best = -1;
  let bestScore = -Infinity;
  for (let k = 0; k < n; k++) {
    const row = w.qa[k] as number;
    if (((e.flags[row] as number) & EnemyFlag.Metin) !== 0) continue;
    const sc = preyScore(w, row, x, z, nClaimed);
    if (sc > bestScore) {
      bestScore = sc;
      best = row;
    }
  }
  return best;
}

function biteOnce(w: World, p: PlayerState, s: SkillInstance, i: number, prey: number, bite: number): void {
  const P = w.projectiles;
  const e = w.enemies;
  const ex = e.x[prey] as number;
  const ez = e.z[prey] as number;
  // pack bonus: +power per OTHER wolf hunting the same prey, capped
  let others = 0;
  const tid = P.target[i] as number;
  for (let k = 0; k < s.pets.length; k++) {
    const r = P.find(s.pets[k] as number);
    if (r >= 0 && r !== i && P.target[r] === tid) others++;
  }
  const dmg = (P.damage[i] as number) * (1 + Math.min(PACK_CAP, s.fp.power * others));
  const c = beginHit(p, s, s.fp, P.x[i] as number, P.z[i] as number);
  c.knock = P.knock[i] as number;
  if (bite < 2) {
    // only the last bite carries the skill's status (bleed)
    c.statusKind = -1;
    c.statusChance = 0;
  }
  hitEnemy(w, prey, dmg, c);
  const dx = ex - (P.x[i] as number);
  const dz = ez - (P.z[i] as number);
  const d = Math.hypot(dx, dz) || 1;
  w.bus.vfx(s.def.vfx ?? '', ex, ez, dx / d, dz / d, P.orbitA[i] as number, 0.3, P.element[i] as number);
}

function hunterStep(w: World, i: number): boolean {
  const P = w.projectiles;
  const e = w.enemies;
  const p = w.players[P.owner[i] as number];
  if (!p || !p.alive) return true;
  const s = w.skillSlots[P.skill[i] as number];
  if (!s) return true;
  const speed = P.aux[i] as number;
  const reach = P.orbitA[i] as number;
  const cycle = P.orbitR[i] as number;
  const range = P.orbitW[i] as number;
  const st = P.pierce[i] as number;
  P.aux3[i] = Math.max(0, (P.aux3[i] as number) - DT);
  const tid = P.target[i] as number;
  let prey = tid !== 0 ? e.find(tid) : -1;
  if (prey >= 0 && e.state[prey] === EnemyState.Dying) prey = -1;

  if (st === 3) {
    // bite combo: glued to the prey, one bite every BITE_GAP
    if (prey < 0) {
      P.pierce[i] = 0;
      P.target[i] = 0;
      P.aux2[i] = 0;
      return false;
    }
    seek(P, i, e.x[prey] as number, e.z[prey] as number, reach * 0.4 + (e.radius[prey] as number), speed * 1.5);
    P.aux2[i] = (P.aux2[i] as number) - DT;
    if ((P.aux2[i] as number) <= 0) {
      const bites = (P.hitMem[i * PROJ_HIT_MEM] as number) | 0;
      biteOnce(w, p, s, i, prey, bites);
      P.hitMem[i * PROJ_HIT_MEM] = bites + 1;
      if (bites + 1 >= 3) {
        P.pierce[i] = 0;
        P.aux2[i] = 0;
      } else {
        P.aux2[i] = BITE_GAP;
      }
    }
    return false;
  }

  // leash: far from the hero, or the prey ran away from the hero's side -> forget it and come home
  const x = P.x[i] as number;
  const z = P.z[i] as number;
  if (Math.hypot(x - p.x, z - p.z) > HUNTER_LEASH) prey = -1;
  else if (prey >= 0 && Math.hypot((e.x[prey] as number) - p.x, (e.z[prey] as number) - p.z) > HUNTER_LEASH + 1) prey = -1;

  let timer = (P.aux2[i] as number) - DT;
  if (st !== 2 && (prey < 0 || timer <= 0)) {
    prey = pickPrey(w, p, s, i, range);
    P.target[i] = prey >= 0 ? (e.id[prey] as number) : 0;
    timer = HUNTER_PRESCORE;
  }
  P.aux2[i] = timer;
  if (prey < 0) {
    // no prey: hover near the hero
    P.pierce[i] = 0;
    const a = (P.age[i] as number) * 0.9 + i * 2.4;
    seek(P, i, p.x + Math.sin(a) * 2, p.z + Math.cos(a) * 2, 0.4, speed * 1.2);
    return false;
  }
  const tx = e.x[prey] as number;
  const tz = e.z[prey] as number;
  const pr = e.radius[prey] as number;
  const reachD = reach + pr;
  const dist = Math.hypot(tx - x, tz - z);
  if (st === 2) {
    seek(P, i, tx, tz, reachD * 0.5, speed * 2.4);
    if (dist <= reachD + 0.3) {
      P.pierce[i] = 3;
      P.hitMem[i * PROJ_HIT_MEM] = 0;
      P.aux2[i] = 0;
      P.aux3[i] = cycle;
    } else if (timer <= 0) {
      P.pierce[i] = 1;
      P.aux2[i] = HUNTER_PRESCORE;
    }
    return false;
  }
  seek(P, i, tx, tz, reachD * 0.5, speed);
  P.pierce[i] = 1;
  if ((P.aux3[i] as number) <= 0) {
    if (dist <= reachD + 0.3) {
      P.pierce[i] = 3;
      P.hitMem[i * PROJ_HIT_MEM] = 0;
      P.aux2[i] = 0;
      P.aux3[i] = cycle;
    } else if (dist <= POUNCE_FROM + pr) {
      P.pierce[i] = 2;
      P.aux2[i] = POUNCE_TIME;
      w.bus.vfx(`${s.def.vfx ?? ''}.pounce`, x, z, (tx - x) / (dist || 1), (tz - z) / (dist || 1), 1.2, 0.35, P.element[i] as number);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// PLANTED: pylons (thunder_guardians) and knights (cursed_legion)

const PYLON_LEASH = 10;
const REPLANT_GAP = 3;
const FLANK_R = 2.5;
const ARC_GAP = 0.5;
const ARC_LINE = 1.0;
const ARC_MAX_LEN = 14;
const ARC_WIDTH = 0.7;
/** a cursed knight's lure refresh (s a bait lives) */
const BAIT_TTL = 0.15;
const ARC_FILL_R = 3.5;
/** kills in the recent window (EMA time constant, s): the knights' bonus count */
const KILL_TAU = 8;

function flankAngle(k: number, n: number): number {
  if (n <= 3) return k === 0 ? Math.PI / 2 : k === 1 ? -Math.PI / 2 : Math.PI;
  return Math.PI / 2 + (k * TAU) / n;
}

function plantedRow(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, role: CompanionRole, x: number, z: number, life: number, flank: number): number {
  const r = spawnPet(w, p, s, fp, role, x, z, 0.9, life, 0.5);
  if (r < 0) return -1;
  const P = w.projectiles;
  P.orbitA[r] = fp.area > 0 ? fp.area : 2;
  P.orbitR[r] = fp.tick > 0 ? fp.tick : 0.9;
  P.orbitW[r] = fp.range > 0 ? fp.range : 9;
  P.aux[r] = flank;
  P.aux2[r] = 0.3;
  P.aux3[r] = -100;
  P.rot[r] = p.rot;
  return r;
}

function pylonCast(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): boolean {
  const range = fp.range > 0 ? fp.range : 9;
  if (!aimOrManual(w, p, range + 4)) return false;
  freePets(w, s);
  const life = Math.max(3, fp.duration);
  const n = fp.count;
  for (let k = 0; k < n; k++) {
    const a = flankAngle(k, n);
    spotAround(w, p, a, k === 2 && n === 3 ? FLANK_R + 0.5 : FLANK_R);
    const r = plantedRow(w, p, s, fp, CompanionRole.Pylon, spot.x, spot.z, life, a);
    if (r >= 0) w.bus.vfx(`${s.def.vfx ?? ''}.plant`, spot.x, spot.z, 0, 1, 3, 1.0, fp.element);
  }
  // fix round 2 (vfx critic): the thunder cast event (k 2.5) dropped its byeorak bolt ON the caster (49 % of the hero crop white, 57 % on snow); the idols' own
  // `.plant` events are the cast look now, so the bolt event at the caster is skipped (the hero clip and the nova of finishCast stay)
  castMoment(w, p, s, fp, p.x, p.z, true, false);
  return true;
}

function pylonStep(w: World, i: number): boolean {
  const P = w.projectiles;
  const e = w.enemies;
  const p = w.players[P.owner[i] as number];
  if (!p || !p.alive) return true;
  const s = w.skillSlots[P.skill[i] as number];
  if (!s) return true;
  let x = P.x[i] as number;
  let z = P.z[i] as number;
  // leash: a kiting hero keeps her guardians (re-plant at her side, at most once per 3 s)
  if (Math.hypot(x - p.x, z - p.z) > PYLON_LEASH && w.time - (P.aux3[i] as number) >= REPLANT_GAP) {
    spotAround(w, p, P.aux[i] as number, FLANK_R);
    w.bus.vfxLine(`${s.def.vfx ?? ''}.blink`, x, z, spot.x, spot.z, 1, 0.3, P.element[i] as number);
    x = spot.x;
    z = spot.z;
    P.x[i] = x;
    P.z[i] = z;
    P.px[i] = x;
    P.pz[i] = z;
    P.aux3[i] = w.time;
  }
  const t = (P.aux2[i] as number) - DT;
  if (t > 0) {
    P.aux2[i] = t;
    return false;
  }
  const target = w.hash.nearest(e, x, z, P.orbitW[i] as number);
  if (target < 0) {
    P.aux2[i] = 0;
    return false;
  }
  P.aux2[i] = P.orbitR[i] as number;
  const tx = e.x[target] as number;
  const tz = e.z[target] as number;
  const area = P.orbitA[i] as number;
  const n = w.hash.queryCircle(e, tx, tz, area, w.qa);
  const c = beginHit(p, s, s.fp, tx, tz);
  c.knock = P.knock[i] as number;
  for (let k = 0; k < n; k++) hitEnemy(w, w.qa[k] as number, P.damage[i] as number, c);
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.hypot(dx, dz) || 1;
  P.rot[i] = Math.atan2(dx, dz);
  w.bus.vfx(s.def.vfx ?? '', tx, tz, dx / d, dz / d, area, 0.3, P.element[i] as number);
  return false;
}

/** the arc web between neighbouring idols: damages whatever crosses a segment (own 0.5 s stamp), a line event every second */
function pylonArcs(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): void {
  const n = livePets(w, s);
  if (n < 2) return;
  const P = w.projectiles;
  const e = w.enemies;
  const doDamage = w.time >= s.aux;
  const doLine = w.time >= s.h2;
  if (!doDamage && !doLine) return;
  if (doDamage) s.aux = w.time + ARC_GAP;
  if (doLine) s.h2 = w.time + ARC_LINE;
  const pairs = n === 2 ? 1 : n;
  for (let k = 0; k < pairs; k++) {
    const ra = rows[k] as number;
    const rb = rows[(k + 1) % n] as number;
    const ax = P.x[ra] as number;
    const az = P.z[ra] as number;
    const bx = P.x[rb] as number;
    const bz = P.z[rb] as number;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5 || len > ARC_MAX_LEN) continue;
    if (doLine) {
      w.bus.vfxLine(`${s.def.vfx ?? ''}.arc`, ax, az, bx, bz, 1, ARC_LINE, fp.element);
    }
    if (!doDamage) continue;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const q = w.hash.queryCircle(e, mx, mz, len / 2 + ARC_WIDTH, w.qa); // not qb: hitEnemy's crit burst reuses it
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const c = beginHit(p, s, fp, mx, mz);
    c.knock = 0;
    const dmg = fp.damage * fp.power;
    for (let m = 0; m < q; m++) {
      const row = w.qa[m] as number;
      const rx = (e.x[row] as number) - ax;
      const rz = (e.z[row] as number) - az;
      const along = rx * ux + rz * uz;
      if (along < -0.3 || along > len + 0.3) continue;
      const lat = Math.abs(rx * uz - rz * ux);
      if (lat > ARC_WIDTH + (e.radius[row] as number)) continue;
      if (stampHit(w, row, s.slot, ARC_GAP)) hitEnemy(w, row, dmg, c);
    }
  }
}

/** kills in the recent window, kept on the skill itself: s.h1 = p.kills last seen, s.aux = decayed count, s.h2 = initialised */
function knightKills(p: PlayerState, s: SkillInstance): void {
  const k = p.kills;
  if (s.h2 === 0) {
    s.h2 = 1;
    s.h1 = k; // first tick: ignore the kills before the skill existed
  }
  s.aux = s.aux * Math.exp(-DT / KILL_TAU) + (k - s.h1);
  s.h1 = k;
}

function knightCast(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): boolean {
  const range = fp.range > 0 ? fp.range : 12;
  if (!aimOrManual(w, p, range)) return false;
  freePets(w, s);
  const life = Math.max(3, fp.duration);
  const bonus = Math.min(3, Math.floor(s.aux / 10));
  const n = Math.min(12, fp.count + bonus);
  const taunt = fp.taunt;
  const P = w.projectiles;
  const placed: number[] = [];
  const rise = (x: number, z: number): void => {
    const r = plantedRow(w, p, s, fp, CompanionRole.Knight, x, z, life, 0);
    if (r < 0) return;
    const m = markerRow(w, x, z, 0, p.index, s.slot, 'sk.gen.bait_ring', taunt, life + 0.05, 255);
    P.hitMem[r * PROJ_HIT_MEM] = m >= 0 ? (P.id[m] as number) : 0;
    P.rot[r] = Math.atan2(x - p.x, z - p.z);
    placed.push(x, z);
    w.bus.vfx(`${s.def.vfx ?? ''}.rise`, x, z, 0, 1, 3, 1.0, fp.element);
  };
  const apart = (x: number, z: number): boolean => {
    for (let k = 0; k < placed.length; k += 2) {
      if (Math.hypot(x - (placed[k] as number), z - (placed[k + 1] as number)) < 1.5) return false;
    }
    return true;
  };
  // 1) where the hero's latest kills fell
  const C = w.corpses;
  let made = 0;
  for (let k = 0; k < C.count && made < n; k++) {
    const idx = C.at(k);
    if (C.owner[idx] !== p.index) continue;
    const cx = C.x[idx] as number;
    const cz = C.z[idx] as number;
    if (Math.hypot(cx - p.x, cz - p.z) > range || !hasWalkable(w, cx, cz) || !apart(cx, cz)) continue;
    rise(cx, cz);
    made++;
  }
  // 2) the rest rise in an arc toward the densest side
  if (made < n) {
    const cl = pickClusterTarget(w, p.x, p.z, range);
    const base = cl >= 0 ? Math.atan2((w.enemies.x[cl] as number) - p.x, (w.enemies.z[cl] as number) - p.z) : p.rot;
    const rest = n - made;
    for (let k = 0; k < rest; k++) {
      const a = base + (k - (rest - 1) / 2) * 0.55;
      let x = p.x + Math.sin(a) * ARC_FILL_R;
      let z = p.z + Math.cos(a) * ARC_FILL_R;
      for (let rr = ARC_FILL_R; rr > 0.5 && !hasWalkable(w, x, z); rr -= 0.5) {
        x = p.x + Math.sin(a) * rr;
        z = p.z + Math.cos(a) * rr;
      }
      rise(x, z);
    }
  }
  castMoment(w, p, s, fp, p.x, p.z, true);
  return true;
}

function knightStep(w: World, i: number): boolean {
  const P = w.projectiles;
  const e = w.enemies;
  const p = w.players[P.owner[i] as number];
  const s = w.skillSlots[P.skill[i] as number];
  if (!p || !p.alive || !s || (P.life[i] as number) <= 0) {
    endMarker(w, P.hitMem[i * PROJ_HIT_MEM] as number);
    return true;
  }
  const x = P.x[i] as number;
  const z = P.z[i] as number;
  // the lure: creatures within `taunt` walk to the nearest knight (bosses ignore, elites half radius: AI side)
  if (s.fp.taunt > 0) w.addBait(x, z, s.fp.taunt, BAIT_TTL, P.id[i] as number);
  const t = (P.aux2[i] as number) - DT;
  if (t > 0) {
    P.aux2[i] = t;
    return false;
  }
  const area = P.orbitA[i] as number;
  const n = w.hash.queryCircle(e, x, z, area, w.qa);
  if (n === 0) {
    P.aux2[i] = 0;
    return false;
  }
  P.aux2[i] = P.orbitR[i] as number;
  // sweep: the nearest `pierce` (default 5) creatures, closest first
  const maxHit = Math.min(n, s.fp.pierce > 0 ? s.fp.pierce : 5);
  const c = beginHit(p, s, s.fp, x, z);
  c.knock = P.knock[i] as number;
  let nearestD = Infinity;
  let nx = 0;
  let nz = 1;
  for (let h = 0; h < maxHit; h++) {
    let best = -1;
    let bestD = Infinity;
    for (let m = 0; m < n; m++) {
      const row = w.qa[m] as number;
      if (row < 0) continue;
      const d = Math.hypot((e.x[row] as number) - x, (e.z[row] as number) - z);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (best < 0) break;
    const row = w.qa[best] as number;
    w.qa[best] = -1;
    if (bestD < nearestD) {
      nearestD = bestD;
      nx = (e.x[row] as number) - x;
      nz = (e.z[row] as number) - z;
    }
    hitEnemy(w, row, P.damage[i] as number, c);
  }
  const d = Math.hypot(nx, nz) || 1;
  P.rot[i] = Math.atan2(nx, nz);
  w.bus.vfx(s.def.vfx ?? '', x, z, nx / d, nz / d, area, 0.3, P.element[i] as number);
  return false;
}

// ---------------------------------------------------------------------------
// COIL (wyrm_retinue): an orbiter anchored on the HOST, the ally dealing the most damage

const COIL_LAP = 2.2;
const COIL_R = 0.95;
const COIL_RETURN = 20;
const BREATH_SPEED = 12;

/** living players within `reach` of the caster, best hitter first (ties: the caster, then the lower index) */
function coilCandidates(w: World, p: PlayerState, reach: number, out: PlayerState[]): void {
  out.length = 0;
  for (const q of w.players) {
    if (!q.alive) continue;
    if (q !== p && Math.hypot(q.x - p.x, q.z - p.z) > reach) continue;
    out.push(q);
  }
  out.sort((a, b) => b.dmgRecent - a.dmgRecent || (a === p ? -1 : b === p ? 1 : a.index - b.index));
}

const coilPool: PlayerState[] = [];

function applyCoilBuff(host: PlayerState, s: SkillInstance, fp: FinalParams, life: number): void {
  if (!fp.buff) return;
  host.buffs = host.buffs.filter((b) => b.skillSlot !== s.slot);
  host.buffs.push({ skillSlot: s.slot, mods: fp.buff, left: life, total: life });
  host.statsDirty = true;
}

function coilCast(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): boolean {
  const range = fp.range > 0 ? fp.range : 10;
  if (!aimOrManual(w, p, range + 4)) return false;
  freePets(w, s);
  coilCandidates(w, p, fp.party > 0 ? fp.party : 14, coilPool);
  if (coilPool.length === 0) coilPool.push(p);
  const life = Math.max(3, fp.duration);
  const P = w.projectiles;
  const speed = fp.speed > 0 ? fp.speed : 7;
  const seen: PlayerState[] = [];
  // drop the old buffs of this skill from everyone (a re-cast refreshes)
  for (const q of w.players) {
    if (q.buffs.some((b) => b.skillSlot === s.slot)) {
      q.buffs = q.buffs.filter((b) => b.skillSlot !== s.slot);
      q.statsDirty = true;
    }
  }
  for (let k = 0; k < fp.count; k++) {
    const host = coilPool[k % coilPool.length] as PlayerState;
    const r = spawnPet(w, p, s, fp, CompanionRole.Coil, p.x, p.z, 1, life, 0.5);
    if (r < 0) continue;
    P.anchor[r] = host.index;
    P.aux[r] = speed;
    P.aux2[r] = 0.5 + 0.3 * k;
    P.aux3[r] = k * Math.PI;
    P.orbitA[r] = k;
    P.orbitR[r] = fp.tick > 0 ? fp.tick : 1.4;
    P.orbitW[r] = range;
    if (seen.includes(host)) continue;
    seen.push(host);
    applyCoilBuff(host, s, fp, life);
    
    aoeHit(w, p, s, fp, host.x, host.z, fp.area, fp.damage, fp.knockback);
    w.bus.vfx(s.def.vfx ?? '', host.x, host.z, 0, 1, 2.5, 0.6, fp.element);
    if (host !== p) w.bus.vfxLine('sk.gen.party_link', p.x, p.z, host.x, host.z, 1, 1.0, fp.element);
  }
  finishCast(w, p, s, fp, p.x, p.z, Math.sin(p.rot), Math.cos(p.rot));
  return true;
}

function coilStep(w: World, i: number): boolean {
  const P = w.projectiles;
  const e = w.enemies;
  const p = w.players[P.owner[i] as number];
  if (!p || !p.alive) return true;
  const s = w.skillSlots[P.skill[i] as number];
  if (!s) return true;
  let host = w.players[P.anchor[i] as number];
  if (host !== p && (!host || !host.alive || Math.hypot(host.x - p.x, host.z - p.z) > COIL_RETURN)) {
    // the host died or left: the dragon returns to the shaman and the buff goes with it
    if (host) {
      const old = host.buffs.find((b) => b.skillSlot === s.slot);
      if (old) {
        host.buffs = host.buffs.filter((b) => b !== old);
        host.statsDirty = true;
        applyCoilBuff(p, s, s.fp, old.left);
      }
    }
    host = p;
    P.anchor[i] = p.index;
  }
  const phase = (P.aux3[i] as number) + (TAU / COIL_LAP) * DT;
  P.aux3[i] = phase;
  const tx = (host as PlayerState).x + Math.sin(phase) * COIL_R;
  const tz = (host as PlayerState).z + Math.cos(phase) * COIL_R;
  P.h[i] = 0.9 + 0.35 * Math.sin(phase * 2);
  const dx = tx - (P.x[i] as number);
  const dz = tz - (P.z[i] as number);
  const dist = Math.hypot(dx, dz);
  seek(P, i, tx, tz, 0.02, clamp(dist * 4, P.aux[i] as number, 30));
  // breath: a holy bolt at the host's prey
  const t = (P.aux2[i] as number) - DT;
  if (t > 0) {
    P.aux2[i] = t;
    return false;
  }
  const hx = (host as PlayerState).x;
  const hz = (host as PlayerState).z;
  const range = P.orbitW[i] as number;
  const n = w.hash.queryCircle(e, hx, hz, range, w.qa);
  let prey = -1;
  let bestTier = -1;
  let bestD = Infinity;
  for (let k = 0; k < n; k++) {
    const row = w.qa[k] as number;
    const tier = e.eliteTier[row] as number;
    const d = Math.hypot((e.x[row] as number) - hx, (e.z[row] as number) - hz);
    if (tier > bestTier || (tier === bestTier && d < bestD)) {
      bestTier = tier;
      bestD = d;
      prey = row;
    }
  }
  if (prey < 0) {
    P.aux2[i] = 0;
    return false;
  }
  P.aux2[i] = P.orbitR[i] as number;
  const bx = P.x[i] as number;
  const bz = P.z[i] as number;
  let ux = (e.x[prey] as number) - bx;
  let uz = (e.z[prey] as number) - bz;
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul;
  uz /= ul;
  const r = spawnProjectile(w, {
    kind: ProjKind.Homing,
    x: bx + ux * 0.4,
    z: bz + uz * 0.4,
    vx: ux * BREATH_SPEED,
    vz: uz * BREATH_SPEED,
    radius: 0.45,
    life: 1.8,
    damage: P.damage[i] as number,
    element: P.element[i] as number,
    owner: p.index,
    skill: s.slot,
    pierce: s.fp.pierce,
    preset: `${s.def.vfx ?? ''}.breath`,
    knock: P.knock[i] as number,
    h: P.h[i] as number,
  });
  if (r >= 0) {
    P.role[r] = CompanionRole.Breath;
    P.target[r] = e.id[prey] as number;
  }
  return false;
}

// ---------------------------------------------------------------------------
// MIMIC (shadow_clone): the afterimage walks the hero's trail and repeats her attack casts

/** behaviors whose casts the clone repeats (damage captured per hit / row at cast time, or zones scaled by ZoneStore.mul) */
const MIMIC_OK = new Set<string>(['meleeArc', 'projectile', 'homingProjectile', 'chain', 'cone', 'shockwave', 'skyStrike', 'groundZone', 'spinAura']);
/** violet tint of the copies' vfx events (bus colour argument) */
const MIMIC_TINT = 0xa878ff;
/** TRAIL_LEN - 1: the oldest tick the trail ring keeps */
const TRAIL_MAX_BACK = 47;

const scratchFp = newFinalParams();

function mimicSkill(p: PlayerState): SkillInstance | null {
  for (const s of p.skills) if (s.def.role === 'mimic') return s;
  return null;
}

function mimicCast(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): boolean {
  const range = fp.range > 0 ? fp.range : 9;
  if (!aimOrManual(w, p, range + 4)) return false;
  freePets(w, s);
  const life = Math.max(3, fp.duration);
  const P = w.projectiles;
  const base = fp.speed > 0 ? clamp((0.6 * 8) / fp.speed, 0.3, 0.6) : 0.6;
  for (let k = 0; k < fp.count; k++) {
    const lag = Math.min(TRAIL_MAX_BACK, Math.round(base * 60) + 12 * k);
    const r = spawnPet(w, p, s, fp, CompanionRole.Mimic, p.x, p.z, 0.9, life, 0.5);
    if (r < 0) continue;
    P.aux[r] = lag;
    P.orbitA[r] = k;
    mimicPlace(P, r, p);
    P.px[r] = P.x[r] as number;
    P.pz[r] = P.z[r] as number;
  }
  castMoment(w, p, s, fp, p.x, p.z, true);
  return true;
}

function mimicPlace(P: World['projectiles'], i: number, p: PlayerState): void {
  const off = p.trailOffset(P.aux[i] as number);
  if (off < 0) {
    P.x[i] = p.x;
    P.z[i] = p.z;
    P.rot[i] = p.rot;
    return;
  }
  P.x[i] = p.trail[off] as number;
  P.z[i] = p.trail[off + 1] as number;
  P.rot[i] = p.trail[off + 2] as number;
}

function mimicStep(w: World, i: number): boolean {
  const P = w.projectiles;
  const p = w.players[P.owner[i] as number];
  if (!p || !p.alive) return true;
  const ox = P.x[i] as number;
  const oz = P.z[i] as number;
  mimicPlace(P, i, p);
  P.vx[i] = ((P.x[i] as number) - ox) / DT;
  P.vz[i] = ((P.z[i] as number) - oz) / DT;
  return false;
}

/**
 * Called from finishCast (WP1) for every hero cast of skill `s` (resolved params `fp`, cast direction dx / dz): when the hero
 * owns a live shadow-clone and the cast is an allow-listed attack, queue one copy per clone (up to trig.mimic.cap copies per
 * trig.mimic.window s) `tick` seconds later. Never re-queues while an echo or a copy is running.
 */
export function queueMimic(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams, dx: number, dz: number): void {
  void fp;
  if (inMimic() || inEcho()) return;
  if (s.ultimate || s.def.role === 'mimic' || !MIMIC_OK.has(s.def.behavior)) return;
  const cs = mimicSkill(p);
  if (!cs || cs.pets.length === 0) return;
  const P = w.projectiles;
  const win = w.trig.mimic.window;
  if (w.time - cs.h1 >= win) {
    cs.h1 = w.time;
    cs.h2 = 0;
  }
  const delay = cs.fp.tick > 0 ? cs.fp.tick : 0.3;
  const rot = Math.atan2(dx, dz);
  for (let k = 0; k < cs.pets.length; k++) {
    if (cs.h2 >= w.trig.mimic.cap) break;
    if (P.find(cs.pets[k] as number) < 0) continue;
    if (w.sched.add(w.time + delay, SchedKind.Mimic, p.index, s.slot, k, 0, 0, dx, dz, rot)) cs.h2++;
  }
}

/**
 * Called from dispatchScheduled for SchedKind.Mimic: re-fire the cast `e.slot` of hero `e.owner` from the position of clone
 * `e.n` with its damage scaled by the clone's `power` (position / rot / castT swap inside try / finally, never re-mimics).
 */
/**
 * Move `amount` of damage the copy of skill `s` dealt from the copied skill's meter to the clone's, so the run-end screen shows
 * Shadow Clone doing its work (instant hits, copied zones/strikes/shocks/projectiles, and their awakening explosions). Totals are unchanged.
 */
export function creditMimic(p: PlayerState, s: SkillInstance, amount: number): void {
  if (amount <= 0) return;
  const cs = mimicSkill(p);
  if (!cs || cs === s) return;
  s.damage -= amount;
  cs.damage += amount;
}

/**
 * Move `amount` of damage from `s` to the explicit provenance skill slot (`creditPlusOne - 1`), falling back to `creditMimic`
 * when a copied row only carries a positive `mul`.
 */
export function creditMimicSlot(w: World, p: PlayerState, s: SkillInstance, creditPlusOne: number, mul: number, amount: number): void {
  if (amount <= 0) return;
  if (creditPlusOne > 0) {
    const cs = w.skillSlots[creditPlusOne - 1];
    if (cs && cs !== s) {
      s.damage -= amount;
      cs.damage += amount;
      return;
    }
  }
  if (mul > 0) creditMimic(p, s, amount);
}

export function dispatchMimic(w: World, e: SchedEntry): void {
  const p = w.players[e.owner];
  const s = w.skillSlots[e.slot];
  if (!p || !s || !p.alive) return;
  const cs = mimicSkill(p);
  if (!cs) return;
  const P = w.projectiles;
  const row = P.find(cs.pets[e.n] as number);
  if (row < 0) return;
  const beh = BEHAVIORS[s.def.behavior];
  const fp = resolveParams(p, s, scratchFp);
  // copy strength: the clone's power x the clone skill's own damage lines / talents / awakening (its ratio to the base damage)
  const baseDmg = cs.def.params.damage;
  const lines = baseDmg > 0 && p.stats.damage > 0 ? cs.fp.damage / (baseDmg * p.stats.damage) : 1;
  const scale = cs.fp.power * lines;
  fp.damage *= scale;
  const ox = p.x;
  const oz = p.z;
  const orot = p.rot;
  const ocast = p.castT;
  const oh1 = s.h1;
  const wasEcho = inEcho();
  const wasMimic = inMimic();
  const zones0 = w.zones.count;
  const projs0 = P.count;
  const ev0 = w.events.length;
  const dmg0 = s.damage;
  p.x = P.x[row] as number;
  p.z = P.z[row] as number;
  p.rot = e.f;
  s.h1 = 0; // a spinAura copy must not refresh the hero's own zone
  setEcho(true); // no combo follow-ups, no echo
  setMimic(true); // finishCast: empty hero clip, no nova / veil, no re-queue
  try {
    beh.cast(w, p, s, fp);
  } finally {
    setMimic(wasMimic);
    setEcho(wasEcho);
    p.x = ox;
    p.z = oz;
    p.rot = orot;
    p.castT = ocast;
    s.h1 = oh1;
  }
  creditMimic(p, s, s.damage - dmg0);
  const creditTag = cs.slot + 1;
  // zones the copy spawned stay where they are, carry the clone's damage scale, and credit damage to the clone
  const Z = w.zones;
  for (let z = zones0; z < Z.count; z++) {
    Z.mul[z] = scale;
    Z.credit[z] = creditTag;
    Z.follow[z] = 0;
  }
  // projectiles the copy spawned carry the clone's damage scale and credit both direct hits and awakening explosions to the clone
  for (let r = projs0; r < P.count; r++) {
    P.mul[r] = scale;
    P.credit[r] = creditTag;
  }
  // the copy's effects are tinted violet (the cast event carries an empty hero clip: finishCast's mimic guard)
  const evs = w.events;
  for (let k = ev0; k < evs.length; k++) {
    const ev = evs[k];
    if (ev && ev.t === 'vfx') ev.color = MIMIC_TINT;
  }
}

// ---------------------------------------------------------------------------
// role dispatch

/**
 * summon.cast delegate for a skill with a `role`. Returns null when the role has no brain (yet) so the caller falls back to
 * the legacy chaser; true = cast fired (cooldown starts), false = declined (armed, retried next tick).
 */
export function roleCast(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): boolean | null {
  switch (s.def.role) {
    case 'orbiter':
      return orbiterCast(w, p, s, fp);
    case 'hunter':
      return hunterCast(w, p, s, fp);
    case 'planted':
      return fp.taunt > 0 ? knightCast(w, p, s, fp) : pylonCast(w, p, s, fp);
    case 'coil':
      return coilCast(w, p, s, fp);
    case 'mimic':
      return mimicCast(w, p, s, fp);
    default:
      return null;
  }
}

/** summon.update delegate (per tick, whether or not the cooldown is ready): permanent rows, re-sync, the arc web, kill window */
export function roleUpdate(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): void {
  switch (s.def.role) {
    case 'orbiter':
      orbiterEnsure(w, p, s, fp);
      break;
    case 'planted':
      if (fp.taunt > 0) knightKills(p, s);
      else pylonArcs(w, p, s, fp);
      break;
    default:
      break;
  }
}

/** projectile step of a Familiar row with a role (the chaser, role 0, keeps familiarStep) */
export function companionStep(w: World, i: number, role: number): boolean {
  switch (role) {
    case CompanionRole.Orbiter:
      return orbiterStep(w, i);
    case CompanionRole.Hunter:
      return hunterStep(w, i);
    case CompanionRole.Pylon:
      return pylonStep(w, i);
    case CompanionRole.Knight:
      return knightStep(w, i);
    case CompanionRole.Coil:
      return coilStep(w, i);
    case CompanionRole.Mimic:
      return mimicStep(w, i);
    default:
      return false;
  }
}

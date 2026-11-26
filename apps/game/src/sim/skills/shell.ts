// Hero shells (DESIGN M2): ward (+ end burst), dodge charges, steady, mirror, veil (+ decoy) and the War Oath save.
//
// Callers
//  - behaviors/selfBuff.ts cast(): `grantShell(w, holder, s, fp)` once per party holder (the caster included, player index order)
//    when the skill declares a shell (ward / steady / mirror / dodge charges)
//  - common.ts finishCast(): `castVeil(w, caster, s, fp)` when fp.veil > 0, for EVERY behavior (stealth is a selfBuff, smoke_bomb a
//    shockwave), never inside an echo / mimic copy
//  - combat.ts hurtPlayer: `slipBlow` (dodge charge, before the evasion roll), `absorbWard` (after armor / resist, before the trinket
//    shield), `oathSave` (the blow that would kill), `refillWard` (lifesteal drain, from lifestealHeal)
//  - player.ts updatePlayers: `tickShells` (timers; a ward that expires bursts), `clearShells` on death (combat.playerDown)
//
// STATE lives on PlayerState (ward / wardMax / wardT / wardSlot / wardOwner / wardAbsorbed / wardMark, veilT, decoy*, dodgeN / dodgeT,
// steadyT, mirrorT / mirrorR): all zero / -1 = nothing active. Hero-attached looks ride MARKER rows (companions.spawnMarker) that
// follow the holder for exactly the window and end with a broken ward; ids are `sk.<skill>.loop` (shell), `sk.gen.veil_ring`,
// `sk.<skill>.decoy`; moments are `sk.gen.ward_hit` / `sk.gen.ward_break` / `sk.gen.dodge_hop`, `sk.<skill>.<burst|shatter|pulse>`,
// `sk.<skill>.save` / `.guard`. A missing spec draws nothing.
//
// Determinism: no RNG here except the hits of a burst (hitEnemy, the same stream every skill hit uses); party / enemy loops run in
// player index and row order. Bursts scan the enemy store directly (not the spatial hash): they can fire while the hash is stale
// (a lava tick inside updatePlayers, the previous tick's swap-removed rows).

import { hitEnemy, newHitCtx, resetHitCtx, type HitCtx } from '../combat';
import { CAP, DT } from '../constants';
import { EnemyFlag, EnemyState, type PlayerState, type SkillInstance } from '../stores';
import type { World } from '../world';
import { castNow } from './index';
import { endMarker, spawnMarker } from './companions';
import { wardAmount, type FinalParams } from './params';

/** iframes the cocoon / smoke gives at the cast (attacks already wound up); bolts in flight and hazards still hit after it */
const VEIL_IFRAMES = 0.6;
/** a ward counts as broken below this many HP */
const WARD_EPS = 0.01;
/** iframes after a slipped blow (the evasion roll uses the same) */
const DODGE_IFRAMES = 0.25;

/** end-burst moment name per skill (default 'burst'): sk.<skill>.<moment> */
const BURST_MOMENT: Record<string, string> = { graniteform: 'shatter', stormglass_shell: 'pulse' };

/** vfx: at most this often (s) per hero a soaked blow draws `sk.gen.ward_hit` (a horde lands 10+ blows a second: the shell must not become a strobe) */
const WARD_HIT_GAP = 0.25;
/** vfx: shells whose marker swaps to the WORN look (`sk.<skill>.loop_worn`) when the ward falls under WORN_AT of its size */
const WORN_LOOPS: ReadonlySet<string> = new Set(['graniteform']);
const WORN_AT = 0.4;
/** vfx: the veil ring of a skill that is not the shadow veil (smoke bomb: grey-teal smoke) */
const VEIL_STYLE: Readonly<Record<string, string>> = { smoke_bomb: 'sk.gen.veil_ring_smoke' };
/** vfx: a ward that ends without an end burst of its own draws the shared break big enough for a guest to see (>= 3 m) */
const BREAK_SCALE_BURST = 1.5;
const BREAK_SCALE_ALONE = 3;

let burstCtx: HitCtx | null = null;
let burstRows: Int32Array | null = null;

/** rows of the creatures a burst at (x, z) with radius r touches (hittable ones, row order) */
function creaturesIn(w: World, x: number, z: number, r: number): number {
  const out = (burstRows ??= new Int32Array(CAP.enemies));
  const e = w.enemies;
  const flags = e.flags;
  let n = 0;
  for (let i = 0; i < e.count && n < out.length; i++) {
    const st = e.state[i];
    if (st === EnemyState.Dying || st === EnemyState.Spawn) continue;
    if (((flags[i] as number) & (EnemyFlag.Invuln | EnemyFlag.Phased)) !== 0) continue;
    const dx = (e.x[i] as number) - x;
    const dz = (e.z[i] as number) - z;
    const rr = r + (e.radius[i] as number);
    if (dx * dx + dz * dz <= rr * rr) out[n++] = i;
  }
  return n;
}

/** one burst hit of skill `s` (its status / knock ride along) on every creature near (x, z) */
function burstAt(w: World, s: SkillInstance, x: number, z: number, r: number, damage: number): void {
  if (damage <= 0 || r <= 0) return;
  const fp = s.fp;
  const c = resetHitCtx((burstCtx ??= newHitCtx()));
  c.player = s.owner;
  c.skill = s.slot;
  c.element = fp.element;
  c.knock = fp.knockback;
  c.sx = x;
  c.sz = z;
  c.statusKind = fp.statusKind;
  c.statusChance = fp.statusChance;
  c.statusPower = fp.statusPower;
  c.statusDuration = fp.statusDuration;
  const n = creaturesIn(w, x, z, r);
  const rows = burstRows as Int32Array;
  for (let i = 0; i < n; i++) hitEnemy(w, rows[i] as number, damage, c);
}

// ---------------------------------------------------------------------------
// grant

/** dodge charges a selfBuff grants: its `count` when the skill's BASE count is above 1 (feather walk); every legacy selfBuff carries 1 */
export function dodgeCharges(s: SkillInstance, fp: FinalParams): number {
  return (s.def.params.count ?? 1) > 1 ? fp.count : 0;
}

/** does this selfBuff declare any shell (ward / steady / mirror / dodge)? */
export function hasShell(s: SkillInstance, fp: FinalParams): boolean {
  return fp.shield > 0 || fp.steady > 0 || fp.mirror > 0 || dodgeCharges(s, fp) > 0;
}

/** look scale of a shell marker: half the cast area, between a hero-sized ring and a wide circle */
function shellScale(fp: FinalParams): number {
  return Math.min(3, Math.max(1.4, fp.area * 0.5));
}

/** radius in which a mirror shell turns hostile bolts: the skill's `mirror` grown by the same area lines as its burst */
function mirrorRadius(s: SkillInstance, fp: FinalParams): number {
  const p = s.def.params;
  const ratio = (p.burst ?? 0) > 0 ? fp.burst / (p.burst as number) : p.area > 0 ? fp.area / p.area : 1;
  return fp.mirror * ratio;
}

/**
 * Give `holder` the shell(s) skill `s` (caster `w.players[s.owner]`) declares: a ward of wardAmount(fp, holder.hpMax) (never stacks:
 * a live ward of another skill that is at least as big stays, a smaller one is replaced and bursts), steady, mirror, dodge charges.
 * Called once per holder inside the cast.
 */
export function grantShell(w: World, holder: PlayerState, s: SkillInstance, fp: FinalParams): void {
  if (!holder.alive) return;
  const dur = Math.max(1, fp.duration);
  let marked = false;
  const amount = wardAmount(fp, holder.hpMax);
  if (amount > 0) marked = grantWard(w, holder, s, fp, amount, dur);
  if (fp.steady > 0) holder.steadyT = Math.max(holder.steadyT, dur);
  if (fp.mirror > 0) {
    holder.mirrorT = Math.max(holder.mirrorT, dur);
    holder.mirrorR = Math.max(holder.mirrorR, mirrorRadius(s, fp));
  }
  const charges = dodgeCharges(s, fp);
  if (charges > 0) {
    holder.dodgeN = Math.max(holder.dodgeN, charges);
    holder.dodgeT = Math.max(holder.dodgeT, dur);
  }
  // a shell without a ward of its own (feather walk, a mirror under a bigger foreign ward) still wears its look for the window
  if (!marked && (fp.steady > 0 || fp.mirror > 0 || charges > 0)) {
    spawnMarker(w, holder, s.slot, `sk.${s.def.id}.loop`, shellScale(fp), dur, true);
  }
}

function grantWard(w: World, holder: PlayerState, s: SkillInstance, fp: FinalParams, amount: number, dur: number): boolean {
  if (holder.ward > 0) {
    // never stacks: the bigger of the live ward and the new one stands (the same skill re-raising always renews)
    if (holder.wardSlot !== s.slot && holder.ward >= amount) return false;
    endWard(w, holder, false, true);
  }
  holder.ward = amount;
  holder.wardMax = amount;
  holder.wardT = dur;
  holder.wardSlot = s.slot;
  holder.wardOwner = s.owner;
  holder.wardAbsorbed = 0;
  holder.wardWorn = false;
  holder.wardMark = spawnMarker(w, holder, s.slot, `sk.${s.def.id}.loop`, shellScale(fp), dur, true);
  return true;
}

// ---------------------------------------------------------------------------
// ward absorb / end

/** soak part of a blow of `dmg` (post-armor) in the holder's ward; returns what is left for the trinket shield and HP */
export function absorbWard(w: World, p: PlayerState, dmg: number, srcX: number, srcZ: number, element: number): number {
  const a = Math.min(p.ward, dmg);
  p.ward -= a;
  p.wardAbsorbed += a;
  let dx = srcX - p.x;
  let dz = srcZ - p.z;
  const d = Math.hypot(dx, dz);
  if (d > 1e-4) {
    dx /= d;
    dz /= d;
  } else {
    dx = 0;
    dz = 1;
  }
  // the look follows the WARD (its skill's element), not the blow; throttled per hero
  if (w.time - p.wardHitT >= WARD_HIT_GAP) {
    p.wardHitT = w.time;
    const ws = p.wardSlot >= 0 ? w.skillSlots[p.wardSlot] : undefined;
    w.bus.vfx('sk.gen.ward_hit', p.x, p.z, dx, dz, 1, 0.25, ws ? ws.fp.element : element);
  }
  if (p.ward <= WARD_EPS) endWard(w, p, false);
  return dmg - a;
}

/**
 * Lifesteal drain: skill `drain` shells take the stolen life first. Returns the part of `heal` that is left for HP. A ward is
 * refilled up to its size, and over the whole ward's life by at most trig.drainCap x its size (a lifesteal build gets no endless shell).
 */
export function refillWard(w: World, p: PlayerState, heal: number): number {
  const refilled = p.ward + p.wardAbsorbed - p.wardMax;
  const room = Math.min(p.wardMax - p.ward, w.trig.drainCap * p.wardMax - refilled);
  if (room <= 0) return heal;
  const take = Math.min(heal, room);
  p.ward += take;
  return heal - take;
}

/** does the holder's live ward drain lifesteal (its skill declares `drain`)? */
export function wardDrains(w: World, p: PlayerState): boolean {
  if (p.ward <= 0 || p.wardSlot < 0) return false;
  const s = w.skillSlots[p.wardSlot];
  return s !== undefined && s.fp.drain > 0;
}

/**
 * The ward ends (broken, expired or replaced): it bursts at the holder - radius `burst`, damage = `damage` + `power` x what it
 * absorbed (capped at trig.burstCap x the ward's size), with the skill's status - and takes its steady / mirror with it. The caster's
 * own early end reopens the selfBuff recast guard. `quiet` (death): no burst.
 */
function endWard(w: World, p: PlayerState, quiet: boolean, replaced = false): void {
  const slot = p.wardSlot;
  const absorbed = p.wardAbsorbed;
  const size = p.wardMax;
  const mark = p.wardMark;
  const timeLeft = p.wardT;
  p.ward = 0;
  p.wardMax = 0;
  p.wardT = 0;
  p.wardSlot = -1;
  p.wardOwner = -1;
  p.wardAbsorbed = 0;
  p.wardMark = 0;
  p.wardWorn = false;
  endMarker(w, mark);
  const s = slot >= 0 ? w.skillSlots[slot] : undefined;
  if (!s) return;
  const fp = s.fp;
  // a ward REPLACED by another keeps its steady / mirror windows (they run out on their own timers); a break or an expiry ends them
  if (!replaced && fp.steady > 0) p.steadyT = 0;
  if (!replaced && fp.mirror > 0) {
    p.mirrorT = 0;
    p.mirrorR = 0;
  }
  // a ward that breaks early ends the caster's window: the recast guard (aether ward's 12 s rhythm) opens
  if (timeLeft > DT && p.index === s.owner) s.aux = Math.min(s.aux, w.time);
  if (quiet) return;
  const breakScale = fp.burst > 0 ? BREAK_SCALE_BURST : BREAK_SCALE_ALONE;
  const breakLen = fp.burst > 0 ? 0.35 : 0.5;
  w.bus.vfx('sk.gen.ward_break', p.x, p.z, 0, 1, breakScale, breakLen, fp.element);
  w.bus.vfx('sk.gen.ward_ring', p.x, p.z, 0, 1, breakScale, breakLen, fp.element); // the neutral alpha twin (snow)
  if (fp.burst > 0) {
    const dmg = fp.damage + fp.power * Math.min(absorbed, w.trig.burstCap * size);
    w.bus.vfx(`sk.${s.def.id}.${BURST_MOMENT[s.def.id] ?? 'burst'}`, p.x, p.z, 0, 1, fp.burst, 0.6, fp.element);
    burstAt(w, s, p.x, p.z, fp.burst, dmg);
  }
}

// ---------------------------------------------------------------------------
// dodge

/** a dodge charge slips this blow (before the evasion roll; hazard ticks never get here) */
export function slipBlow(w: World, p: PlayerState, srcX: number, srcZ: number, element: number): void {
  p.dodgeN--;
  if (p.dodgeN <= 0) {
    p.dodgeN = 0;
    p.dodgeT = 0;
  }
  p.iframes = DODGE_IFRAMES;
  let dx = p.x - srcX;
  let dz = p.z - srcZ;
  const d = Math.hypot(dx, dz);
  if (d > 1e-4) {
    dx /= d;
    dz /= d;
  } else {
    dx = 0;
    dz = 1;
  }
  w.bus.playerHit(p.index, 0, 1, p.x, p.z, srcX, srcZ, element, p.hp);
  w.bus.vfx('sk.gen.dodge_hop', p.x, p.z, dx, dz, 1.2, 0.3, element);
}

// ---------------------------------------------------------------------------
// veil

/**
 * Veil the caster: non-boss creatures drop it as a target for fp.veil seconds (ai.ts), 0.6 s cast iframes, and when the skill has
 * a `taunt` radius a shadow decoy stays at the cast point as a bait that bursts when the veil ends. Called from finishCast.
 */
export function castVeil(w: World, caster: PlayerState, s: SkillInstance, fp: FinalParams): void {
  if (fp.veil <= 0 || !caster.alive) return;
  caster.veilT = Math.max(caster.veilT, fp.veil);
  caster.iframes = Math.max(caster.iframes, VEIL_IFRAMES);
  spawnMarker(w, caster, s.slot, VEIL_STYLE[s.def.id] ?? 'sk.gen.veil_ring', 1.4, fp.veil, true);
  if (fp.taunt > 0) {
    if (caster.decoySlot >= 0) decoyBurst(w, caster);
    caster.decoyX = caster.x;
    caster.decoyZ = caster.z;
    caster.decoySlot = s.slot;
    spawnMarker(w, caster, s.slot, `sk.${s.def.id}.decoy`, 1.2, fp.veil, false);
    w.addBait(caster.x, caster.z, fp.taunt, fp.veil, (0x80000000 | s.slot) >>> 0);
  }
}

/** the decoy pops: skill damage + knock over its `area` */
function decoyBurst(w: World, p: PlayerState): void {
  const s = w.skillSlots[p.decoySlot];
  const x = p.decoyX;
  const z = p.decoyZ;
  p.decoySlot = -1;
  if (!s) return;
  const fp = s.fp;
  const r = Math.max(1, fp.area);
  w.bus.vfx(`sk.${s.def.id}.burst`, x, z, 0, 1, r, 0.6, fp.element);
  burstAt(w, s, x, z, r, fp.damage);
}

// ---------------------------------------------------------------------------
// oath

/**
 * The War Oath: a blow that would bring HP to 0 while a lethal-armed skill is ready (`p.lethalSlot`) is cancelled before the revives:
 * the skill casts past its gate (buff, nova), HP rises to `power` x max HP + `heal`, the hero is untouchable for trig.lethalGuard s.
 * Returns true when the blow was undone.
 */
export function oathSave(w: World, p: PlayerState, srcX: number, srcZ: number, element: number): boolean {
  const s = p.lethalSlot >= 0 ? w.skillSlots[p.lethalSlot] : undefined;
  if (!s || s.owner !== p.index || s.cd > 0) return false;
  // the nova of the cast queries the spatial hash: rebuild it when the blow fell inside updatePlayers (a lava tick, stale rows)
  w.hash.rebuild(w.enemies);
  s.aux = Math.min(s.aux, w.time); // the oath's previous window (kill-extended) never blocks a save; selfBuff.cast drops its old buff
  if (!castNow(w, p, s)) return false;
  const fp = s.fp;
  p.hp = Math.min(p.hpMax, Math.max(p.hp, 1, p.hpMax * fp.power + fp.heal));
  p.iframes = Math.max(p.iframes, w.trig.lethalGuard);
  p.flash = 1;
  p.sinceHit = 0;
  // result 3 = absorbed by a ward / oath (vfx draws no `player.shield` egg: the shell's own look carries the read)
  w.bus.playerHit(p.index, 0, 3, p.x, p.z, srcX, srcZ, element, p.hp);
  w.bus.vfx(`sk.${s.def.id}.save`, p.x, p.z, 0, 1, Math.max(4, fp.nova), 1, fp.element);
  spawnMarker(w, p, s.slot, `sk.${s.def.id}.guard`, 1.4, w.trig.lethalGuard, true);
  return true;
}

// ---------------------------------------------------------------------------
// timers

/** per-tick timers of a living hero's shells (player.ts): a ward that runs out bursts, the veil ending pops the decoy */
export function tickShells(w: World, p: PlayerState): void {
  if (p.wardT > 0) {
    p.wardT -= DT;
    if (p.wardT <= 0) endWard(w, p, false);
    else if (!p.wardWorn && p.wardMax > 0 && p.ward < p.wardMax * WORN_AT) wearMarker(w, p);
  }
  if (p.veilT > 0) {
    p.veilT -= DT;
    if (p.veilT <= 0) {
      p.veilT = 0;
      if (p.decoySlot >= 0) decoyBurst(w, p);
    } else if (p.decoySlot >= 0) {
      // the decoy's lure is re-added every tick like a knight's (an existing key refreshes in place), so a full list never starves it
      const ds = w.skillSlots[p.decoySlot];
      if (ds) w.addBait(p.decoyX, p.decoyZ, ds.fp.taunt, p.veilT, (0x80000000 | ds.slot) >>> 0);
    }
  }
  if (p.dodgeT > 0) {
    p.dodgeT -= DT;
    if (p.dodgeT <= 0) {
      p.dodgeT = 0;
      p.dodgeN = 0;
    }
  }
  if (p.steadyT > 0) {
    p.steadyT -= DT;
    if (p.steadyT <= 0) p.steadyT = 0;
  }
  if (p.mirrorT > 0) {
    p.mirrorT -= DT;
    if (p.mirrorT <= 0) {
      p.mirrorT = 0;
      p.mirrorR = 0;
    }
  }
}

/** vfx: the ward is worn down: the marker swaps to its `.loop_worn` look (cracked, fewer plates) for the rest of the window */
function wearMarker(w: World, p: PlayerState): void {
  p.wardWorn = true;
  const s = p.wardSlot >= 0 ? w.skillSlots[p.wardSlot] : undefined;
  if (!s || !WORN_LOOPS.has(s.def.id) || p.wardMark === 0) return;
  endMarker(w, p.wardMark);
  p.wardMark = spawnMarker(w, p, s.slot, `sk.${s.def.id}.loop_worn`, shellScale(s.fp), Math.max(DT * 2, p.wardT), true);
}

/** the hero went down for good: every shell ends without a burst */
export function clearShells(w: World, p: PlayerState): void {
  if (p.wardSlot >= 0 || p.ward > 0) endWard(w, p, true);
  p.veilT = 0;
  p.decoySlot = -1;
  p.dodgeN = 0;
  p.dodgeT = 0;
  p.steadyT = 0;
  p.mirrorT = 0;
  p.mirrorR = 0;
}

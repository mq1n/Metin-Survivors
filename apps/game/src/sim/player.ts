// Player creation (class, doctrine, meta, empire) and per-tick hero update (input, movement, regen, buffs).

import { resolveEdict } from '../data/schema';
import { healPlayer, hurtPlayer, HurtKind } from './combat';
import { DT, MAX_SKILL_SLOTS, PLAYER_RADIUS, Surface } from './constants';
import { HealSource } from './events';
import { addSkill } from './skills';
import { tickShells } from './skills/shell';
import { createStats, refreshStats } from './stats';
import { ElementIdx, PlayerState, type PlayerInput } from './stores';
import type { CoopPlayerInit } from './run';
import { xpToNext } from './progress';
import type { World } from './world';

const ACCEL = 16;
const TAU = Math.PI * 2;
/** per-tick decay of PlayerState.dmgRecent (time constant ~5 s) */
const DMG_RECENT_DECAY = Math.exp(-DT / 5);
const moveOut = { x: 0, z: 0 };

export function createPlayer(w: World, index: number, init: CoopPlayerInit): PlayerState {
  const ix = w.ix;
  const cls = ix.classes.get(init.classId);
  if (!cls) throw new Error(`sim: unknown class '${init.classId}'`);
  const doctrine = init.doctrine === 'a' ? cls.doctrines[0] : cls.doctrines[1];
  const p = new PlayerState();
  p.index = index;
  p.classId = init.classId;
  p.doctrine = init.doctrine;
  p.sex = init.sex;
  p.empire = init.empire;
  p.stats = createStats();
  const empire = ix.empires.get(init.empire);
  p.fixed = [init.meta.stats];
  if (empire) p.fixed.push(empire.bonus);
  p.skillMods = init.meta.skillMods ?? {};
  const bal = w.balance;
  // budgets = balance + meta (talent nodes) + the empire's edict (DA-01: one bounded +1, equal for every hero of the empire)
  const edict = resolveEdict(empire);
  p.rerolls = bal.rerollsPerRun + (init.meta.rerolls ?? 0) + edict.rerolls;
  p.banishes = bal.banishesPerRun + (init.meta.banishes ?? 0) + edict.banishes;
  p.skips = bal.skipsPerRun + (init.meta.skips ?? 0) + edict.skips;
  // spawn spread around the origin for co-op
  const a = (index / 4) * TAU;
  p.x = index === 0 ? 0 : Math.sin(a) * 1.8;
  p.z = index === 0 ? 0 : Math.cos(a) * 1.8;
  p.px = p.x;
  p.pz = p.z;
  p.rot = 0;
  p.prot = 0;
  p.radius = PLAYER_RADIUS;

  refreshStats(p, w.content, ix);
  p.hp = p.hpMax;

  const basic = ix.skills.get(doctrine.basic);
  const starter = ix.skills.get(doctrine.starter);
  if (!basic) throw new Error(`sim: unknown basic skill '${doctrine.basic}'`);
  addSkill(w, p, basic, 0);
  if (starter && starter.id !== basic.id && w.skillSlots.length < MAX_SKILL_SLOTS) addSkill(w, p, starter, 0);
  for (const id of init.meta.extraSkills ?? []) {
    const def = ix.skills.get(id);
    if (def && !p.skills.some((s) => s.def.id === def.id) && w.skillSlots.length < MAX_SKILL_SLOTS) addSkill(w, p, def, 0);
  }

  p.level = 1;
  p.xp = 0;
  p.xpNext = xpToNext(w, 1);
  const startLevel = Math.max(1, Math.floor(init.meta.startLevel ?? 1));
  for (let l = 1; l < startLevel; l++) {
    p.level++;
    p.pendingLevels++;
    p.xpNext = xpToNext(w, p.level);
  }
  return p;
}

/** apply input, movement, regeneration, buff timers for every player */
export function updatePlayers(w: World, inputs: readonly PlayerInput[]): void {
  const players = w.players;
  const bal = w.balance;
  const arena = w.arenaRadius - 0.5;
  const walkable = w.env.walkable;
  const moveCircle = w.env.moveCircle;
  const surfaceAt = w.env.surfaceAt;
  for (let pi = 0; pi < players.length; pi++) {
    const p = players[pi];
    if (!p) continue;
    p.px = p.x;
    p.pz = p.z;
    p.prot = p.rot;
    if (!p.alive) {
      p.clipT += DT;
      p.speed = 0;
      continue;
    }

    // buffs
    if (p.buffs.length > 0) {
      let changed = false;
      for (let i = p.buffs.length - 1; i >= 0; i--) {
        const b = p.buffs[i];
        if (!b) continue;
        b.left -= DT;
        if (b.left <= 0) {
          p.buffs.splice(i, 1);
          changed = true;
        }
      }
      if (changed) p.statsDirty = true;
    }
    if (p.statsDirty) refreshStats(p, w.content, w.ix);
    const st = p.stats;

    // regen (% of max hp per second is capped), lifesteal heal budget, shield
    if (p.hp < p.hpMax && st.regen > 0) {
      const perSec = Math.min(st.regen, p.hpMax * bal.caps.regenPctPerSec);
      p.regenAcc += perSec * DT;
      if (p.regenAcc >= 1) {
        const heal = Math.floor(p.regenAcc);
        p.regenAcc -= heal;
        healPlayer(w, p, heal, HealSource.Regen);
      }
    }
    const budgetMax = p.hpMax * 0.05;
    p.healBudget = Math.min(budgetMax, p.healBudget + budgetMax * DT);
    if (st.shieldMax > 0) {
      p.shieldCd -= DT;
      if (p.shield > st.shieldMax) p.shield = st.shieldMax;
      else if (p.shieldCd <= 0 && p.shield < st.shieldMax) p.shield = Math.min(st.shieldMax, p.shield + st.shieldRegen * DT);
    } else {
      p.shield = 0;
    }
    if (p.iframes > 0) {
      p.iframes -= DT;
      // float residue (0.25 - 15 ticks leaves ~5e-17) must not swallow the next hazard tick
      if (p.iframes < 1e-6) p.iframes = 0;
    }
    if (p.flash > 0) p.flash = Math.max(0, p.flash - DT * 4);
    p.sinceHit += DT;
    if (p.castT > 0) p.castT -= DT;
    p.dmgRecent *= DMG_RECENT_DECAY;
    // hero shells (ward / veil / dodge / steady / mirror timers; DESIGN M2)
    if (p.wardT > 0 || p.veilT > 0 || p.dodgeT > 0 || p.steadyT > 0 || p.mirrorT > 0) tickShells(w, p);

    // input
    const input = inputs[pi];
    let mx = input ? input.moveX : 0;
    let mz = input ? input.moveZ : 0;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    } else if (!Number.isFinite(ml)) {
      mx = 0;
      mz = 0;
    }
    p.moveX = mx;
    p.moveZ = mz;
    p.wantAttack = input?.attack === true;
    p.wantCastMask = input?.castMask ?? 0;
    p.manualCast = input?.manualCast === true;
    if (input && typeof input.aimX === 'number' && typeof input.aimZ === 'number') {
      const al = Math.hypot(input.aimX, input.aimZ);
      if (al > 1e-4 && Number.isFinite(al)) {
        p.aimX = input.aimX / al;
        p.aimZ = input.aimZ / al;
        p.hasAim = true;
      } else {
        p.hasAim = false;
      }
    } else {
      p.hasAim = false;
    }

    // terrain surface under the hero (shallow water slows, ice slides, lava / miasma hurt)
    const surf = surfaceAt ? surfaceAt(p.x, p.z) : 0;
    // velocity
    let vx: number;
    let vz: number;
    if (p.dashT > 0) {
      p.dashT -= DT;
      vx = p.dashVx;
      vz = p.dashVz;
      if (p.dashT <= 0) {
        p.dashSlot = -1;
        p.dashT = 0;
        p.vx = mx * st.moveSpeed;
        p.vz = mz * st.moveSpeed;
      }
    } else {
      const speed = st.moveSpeed * p.slowMul * (surf === Surface.Shallow ? 0.8 : surf === Surface.Miasma ? 0.9 : 1);
      const tx = mx * speed;
      const tz = mz * speed;
      const k = Math.min(1, ACCEL * (surf === Surface.Ice ? 0.2 : 1) * DT);
      p.vx += (tx - p.vx) * k;
      p.vz += (tz - p.vz) * k;
      vx = p.vx;
      vz = p.vz;
    }
    p.slowMul = 1;

    // knockback velocity (decays)
    let kx = p.kvx;
    let kz = p.kvz;
    if (kx !== 0 || kz !== 0) {
      const decay = Math.exp(-9 * DT);
      p.kvx *= decay;
      p.kvz *= decay;
      if (Math.abs(p.kvx) < 0.02) p.kvx = 0;
      if (Math.abs(p.kvz) < 0.02) p.kvz = 0;
      kx = p.kvx;
      kz = p.kvz;
    }

    let nx = p.x + (vx + kx) * DT;
    let nz = p.z + (vz + kz) * DT;
    // keep inside the arena
    const rr = Math.hypot(nx, nz);
    if (rr > arena) {
      nx = (nx / rr) * arena;
      nz = (nz / rr) * arena;
    }
    if (moveCircle) {
      moveCircle(p.x, p.z, nx, nz, p.radius, moveOut);
      nx = moveOut.x;
      nz = moveOut.z;
    } else if (walkable && !walkable(nx, nz)) {
      // slide: try each axis on its own
      if (walkable(nx, p.z)) nz = p.z;
      else if (walkable(p.x, nz)) nx = p.x;
      else {
        nx = p.x;
        nz = p.z;
      }
    }
    p.x = nx;
    p.z = nz;
    if (surf === Surface.Lava || surf === Surface.Miasma) {
      p.surfT += DT;
      if (p.surfT >= 0.5) {
        p.surfT = 0;
        const lava = surf === Surface.Lava;
        hurtPlayer(w, pi, p.hpMax * (lava ? 0.025 : 0.015), p.x, p.z, lava ? ElementIdx.Fire : ElementIdx.Poison, HurtKind.Terrain);
      }
    } else {
      p.surfT = 0;
    }
    const sp = Math.hypot(vx, vz);
    p.speed = sp;
    if (p.manualCast && p.hasAim && (p.wantAttack || p.wantCastMask !== 0)) {
      p.rot = Math.atan2(p.aimX, p.aimZ);
    } else if (sp > 0.4 && p.castT <= 0) {
      const want = Math.atan2(vx, vz);
      let d = want - p.rot;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      p.rot += d * Math.min(1, 14 * DT);
    }
    // position trail, one entry per tick (the shadow clone follows it)
    p.pushTrail(p.x, p.z, p.rot);
    // hero clip
    const clip = w.endTimer >= 0 && w.endVictory ? 'victory' : p.castT > 0 ? 'cast' : p.dashT > 0 ? 'dash' : sp > 0.4 ? 'run' : 'idle';
    if (clip !== p.clip) {
      p.clip = clip;
      p.clipT = 0;
    } else {
      p.clipT += DT;
    }
  }
}

// Skill runtime: instances, upgrade accumulation, per-tick activation, scheduled follow-ups.

import type { BehaviorKind, SkillDef, UpgradeLine } from '../../data/schema';
import { DT, MAX_SKILL_SLOTS } from '../constants';
import { SchedKind, type SchedEntry } from '../scheduler';
import { UPGRADE_STATS, type PlayerState, type SkillInstance } from '../stores';
import type { CardLine } from '../types';
import type { World } from '../world';
import { beam } from './behaviors/beam';
import { chain } from './behaviors/chain';
import { cone } from './behaviors/cone';
import { dash } from './behaviors/dash';
import { groundZone } from './behaviors/groundZone';
import { homingProjectile } from './behaviors/homingProjectile';
import { leap, leapLand } from './behaviors/leap';
import { meleeArc } from './behaviors/meleeArc';
import { orbit } from './behaviors/orbit';
import { persistentAura } from './behaviors/persistentAura';
import { projectile } from './behaviors/projectile';
import { selfBuff } from './behaviors/selfBuff';
import { shockwave } from './behaviors/shockwave';
import { skyStrike } from './behaviors/skyStrike';
import { spinAura } from './behaviors/spinAura';
import { summon } from './behaviors/summon';
import { setEcho } from './common';
import { dispatchMimic } from './companions';
import { newFinalParams, resolveParams } from './params';
import { gateOpen, isLethalSkill } from './trigger';
import type { Behavior } from './types';

export const BEHAVIORS: Record<BehaviorKind, Behavior> = {
  meleeArc,
  spinAura,
  persistentAura,
  dash,
  projectile,
  homingProjectile,
  skyStrike,
  chain,
  groundZone,
  orbit,
  cone,
  shockwave,
  selfBuff,
  summon,
  leap,
  beam,
};

/** create a skill instance for `p` and register its global slot */
export function addSkill(w: World, p: PlayerState, def: SkillDef, rank = 0): SkillInstance {
  if (w.skillSlots.length >= MAX_SKILL_SLOTS) throw new Error('sim: too many skill slots');
  const upg = UPGRADE_STATS.map(() => ({ pct: 0, flat: 0 }));
  const s: SkillInstance = {
    slot: w.skillSlots.length,
    owner: p.index,
    def,
    rank,
    upg,
    cd: 0.25 + 0.07 * p.skills.length,
    h1: 0,
    h2: 0,
    aux: 0,
    damage: 0,
    fp: newFinalParams(),
    basic: def.kind === 'basic',
    ultimate: def.kind === 'ultimate',
    armedT: 0,
    pets: [],
    refunded: 0,
    fxT: -9,
    marks: [],
    markEnd: 0,
  };
  w.skillSlots.push(s);
  p.skills.push(s);
  // a standing Vigil bonus joins the stats at once
  if (def.vigil) p.statsDirty = true;
  return s;
}

/** accumulate one rolled card line into a skill's upgrade state */
export function applySkillLine(s: SkillInstance, line: CardLine): void {
  const i = UPGRADE_STATS.indexOf(line.stat as (typeof UPGRADE_STATS)[number]);
  const acc = s.upg[i];
  if (!acc) return;
  if (line.mode === 'pct') acc.pct += line.value;
  else acc.flat += line.value;
}

/** upgrade pool entry → rolled line at the given magnitude multiplier (flat count/pierce are rounded, min 1) */
export function rollLine(line: UpgradeLine, mult: number): CardLine {
  let value = line.base * mult;
  if (line.mode === 'flat' && (line.stat === 'count' || line.stat === 'pierce')) value = Math.max(1, Math.round(value));
  return { stat: line.stat, mode: line.mode, value };
}

export function updateSkills(w: World): void {
  const players = w.players;
  for (let pi = 0; pi < players.length; pi++) {
    const p = players[pi] as PlayerState;
    if (!p.alive) continue;
    const skills = p.skills;
    const maxActives = w.balance.maxActiveSkills;
    let activeOrd = 0;
    let ultOrd = 0;
    for (let i = 0; i < skills.length; i++) {
      const s = skills[i] as SkillInstance;
      const barIdx = s.basic ? 0 : s.ultimate ? 1 + maxActives + ultOrd++ : 1 + activeOrd++;
      const fp = resolveParams(p, s, s.fp);
      const beh = BEHAVIORS[s.def.behavior];
      beh.update?.(w, p, s, fp);
      if (beh.passive) continue;
      s.cd -= DT;
      if (s.cd > 0) {
        // on its lockout a lethal skill (War Oath) is not armed
        if (p.lethalSlot === s.slot) p.lethalSlot = -1;
        continue;
      }
      const manualReq = (s.basic && p.wantAttack) || (barIdx < 30 && (p.wantCastMask & (1 << barIdx)) !== 0);
      if (manualReq) {
        p.manualAim = true;
        let fired = false;
        try {
          fired = beh.cast(w, p, s, fp);
        } finally {
          p.manualAim = false;
        }
        if (fired) {
          s.cd = fp.cooldown;
          s.armedT = 0;
          s.refunded = 0;
          if (p.lethalSlot === s.slot) p.lethalSlot = -1;
        } else {
          s.cd = 0;
        }
        continue;
      }
      if (p.manualCast) {
        // manual control mode: do not auto-fire basic attacks or active skills; lethal insurance (War Oath) still arms
        s.cd = 0;
        if (s.def.trigger !== undefined && isLethalSkill(s)) p.lethalSlot = s.slot;
        continue;
      }
      // context gate (DESIGN M1): a gated skill stays ARMED (cd 0, retried next tick) until a trigger kind is true; the
      // cooldown below is the lockout after a fire. A skill without a trigger never reaches this branch.
      if (s.def.trigger !== undefined && !gateOpen(w, p, s)) {
        s.cd = 0;
        s.armedT += DT;
        // a lethal skill is cast by the killing blow itself (hurtPlayer reads p.lethalSlot), not by this loop
        if (isLethalSkill(s)) p.lethalSlot = s.slot;
        continue;
      }
      if (beh.cast(w, p, s, fp)) {
        s.cd = fp.cooldown;
        s.armedT = 0;
        s.refunded = 0;
        if (p.lethalSlot === s.slot) p.lethalSlot = -1;
      } else {
        s.cd = 0;
      }
    }
  }
}

/**
 * Cast skill `s` of hero `p` right now, outside the updateSkills loop and past its gate (the oath save of a killing blow):
 * resolves the params, runs the behavior and, when it fires, starts the lockout and clears the armed / lethal state exactly
 * like the loop does. Returns false when the behavior declined (e.g. a selfBuff window is still up).
 */
export function castNow(w: World, p: PlayerState, s: SkillInstance): boolean {
  const fp = resolveParams(p, s, s.fp);
  if (!BEHAVIORS[s.def.behavior].cast(w, p, s, fp)) return false;
  s.cd = fp.cooldown;
  s.armedT = 0;
  s.refunded = 0;
  if (p.lethalSlot === s.slot) p.lethalSlot = -1;
  return true;
}

/** fraction 0..1 of the cooldown remaining (HUD ring) */
export function cooldownFrac(s: SkillInstance): number {
  const total = s.fp.cooldown;
  if (s.def.behavior === 'persistentAura' || total <= 0) return 0;
  return Math.min(1, Math.max(0, s.cd / total));
}

export function dispatchScheduled(w: World, e: SchedEntry): void {
  const p = w.players[e.owner];
  const s = w.skillSlots[e.slot];
  if (!p || !s || !p.alive) return;
  const fp = resolveParams(p, s, s.fp);
  const beh = BEHAVIORS[s.def.behavior];
  switch (e.kind) {
    case SchedKind.Echo:
      setEcho(true);
      try {
        beh.cast(w, p, s, fp);
      } finally {
        setEcho(false);
      }
      break;
    case SchedKind.Swing:
      beh.pulse?.(w, p, s, fp, e.dx, e.dz, e.n);
      break;
    case SchedKind.LeapLand:
      leapLand(w, p, s, fp, p.x, p.z);
      break;
    case SchedKind.Mimic:
      dispatchMimic(w, e);
      break;
    default:
      break;
  }
}

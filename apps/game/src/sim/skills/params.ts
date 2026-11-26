// Final skill parameters = rank-1 params × accumulated upgrade lines × talent skillMods × player stats × awakening.
//
// Talent `skillMods` (MetaBonuses.skillMods[skillId][stat]) are fractions like card pct lines: damage/area/duration/speed/
// knockback/range/heal = +x relative, cooldown/tick = −x (capped), count/statusChance/statusPower = +x relative to the base
// value; `pierce` is a flat number of extra pierces (rounded). All 13 UpgradeStats are honoured.
//
// SkillParams semantics per behavior (the contract for CONTENT; fixtures follow it):
//  meleeArc      area = swing reach (m), angle = arc (rad), count = swings per cast (combo), range = trigger distance
//  spinAura      area = ring radius, duration = spin time, tick = hit interval, cooldown = time between spins
//  persistentAura area = radius, tick = interval, damage = per tick (permanent; cooldown ignored)
//  dash          range = distance, speed = m/s, area = hit radius along the path (i-frames while dashing)
//  projectile    count bolts fanned by `angle` (default 0.18 rad apart), speed, pierce, area = bolt radius, range = max travel
//  homingProjectile  as projectile, bolts steer toward targets
//  skyStrike     count strikes on random enemies within range, area = blast radius, tick = stagger (default 0.12 s)
//  chain         count = total hits, area = jump radius between targets, range = first-target range
//  groundZone    count zones, area = radius, duration, tick, range = placement range
//  orbit         count orbitals, range = orbit radius (falls back to 2.5 × area), area = orbital hit radius (default 0.7),
//                speed = rad/s, duration = lifetime, tick = per-enemy re-hit interval (default 0.45)
//  cone          range = length (area fallback), angle = cone angle, count = pulses
//  shockwave     area = max radius, duration = expansion time (default 0.55 s), knockback
//  selfBuff      buff (StatMods) for duration, heal on cast
//  summon        count familiars for duration; damage per strike, tick = strike interval, speed = run speed,
//                area = strike radius, range = target/leash range
//  leap          range = max distance, speed = m/s, area = landing radius, knockback
//  beam          range = length, area = width, duration, tick, speed = max turn rate rad/s (default 3.5)
//
// Awakening (rank P) params understood generically: damageMul areaMul countAdd cooldownMul durationMul pierceAdd
// speedMul knockbackMul rangeMul statusChanceAdd statusPowerMul healAdd tickMul, plus echo (s, free repeat cast),
// nova (blast radius around the caster per cast) with novaDamage (× damage), explode (radius of an explosion where a
// projectile / strike / zone ends).
//
// Skill-logic payload keys (SkillParams.veil … leech, all optional, absent = 0 = legacy behavior) are resolved here into
// FinalParams so behaviors never read `def.params` for them:
//  percent-like keys are WHOLE numbers in content and FRACTIONS in FinalParams: shield, power, cost, stack, leech
//  nova (base kit) = max(base.nova × area multipliers, awakening nova); the awakening nova stays unscaled (as before)
//  burst = base.burst × area multipliers          veil = base.veil × duration / base duration
//  shield = base.shield % × (1 + heal pct lines + talent heal) of the HOLDER's max HP, + shieldFlat = heal flat lines + healAdd;
//           a skill with shield > 0 and base heal 0 applies NO instant heal (its heal lines only grow the ward)

import type { BehaviorKind, StatMods, StatusKind } from '../../data/schema';
import { MAX_SKILL_RANK } from '../../data/schema';
import type { PlayerState, SkillInstance } from '../stores';
import { StatusIdx } from '../stores';

export interface FinalParams {
  damage: number;
  cooldown: number;
  area: number;
  count: number;
  duration: number;
  speed: number;
  pierce: number;
  knockback: number;
  tick: number;
  range: number;
  angle: number;
  heal: number;
  buff: StatMods | null;
  /** StatusIdx or -1 */
  statusKind: number;
  statusChance: number;
  statusPower: number;
  statusDuration: number;
  element: number;
  awakened: boolean;
  echo: number;
  nova: number;
  novaDamage: number;
  explode: number;
  // ---- skill-logic payloads (0 = off). Units: s = seconds, m = metres, frac = fraction, x = multiplier ----
  /** s: creatures lose the hero (base veil × duration / base duration) */
  veil: number;
  /** m: bait radius of a decoy / knight */
  taunt: number;
  /** frac of the holder's max HP, already × (1 + heal pct lines + talent heal); use wardAmount() for the HP */
  shield: number;
  /** HP: flat part of the ward (heal flat lines + healAdd); 0 unless shield > 0 */
  shieldFlat: number;
  /** m: ward end-burst radius (× area multipliers) */
  burst: number;
  /** frac: burst = damage + power × absorbed; mimic copy; wolf pack bonus; pylon arc; oath HP floor */
  power: number;
  /** 0 | 1: lifesteal refills the ward first */
  drain: number;
  /** m: hostile bolts entering this radius around the holder are turned */
  mirror: number;
  /** 0 | 1: pushes ignored while the shell lives */
  steady: number;
  /** m: party reach (buff / heal / ward on living allies); coil host search radius */
  party: number;
  /** frac of max HP paid at the cast */
  cost: number;
  /** K foes marked (integer) */
  mark: number;
  /** s between spectral bites */
  pulse: number;
  /** frac buff gain per kill */
  stack: number;
  /** s added to the running window per kill */
  extend: number;
  /** s taken off the cooldown per kill */
  refund: number;
  /** s: Dispel strip time */
  purge: number;
  /** x: second_wind missing-HP scaling */
  missing: number;
  /** frac: second_wind share of damage dealt that heals */
  leech: number;
}

export function newFinalParams(): FinalParams {
  return {
    damage: 0, cooldown: 1, area: 1, count: 1, duration: 0, speed: 0, pierce: 0, knockback: 0, tick: 0, range: 0,
    angle: 0, heal: 0, buff: null, statusKind: -1, statusChance: 0, statusPower: 0, statusDuration: 0, element: 0,
    awakened: false, echo: 0, nova: 0, novaDamage: 0, explode: 0,
    veil: 0, taunt: 0, shield: 0, shieldFlat: 0, burst: 0, power: 0, drain: 0, mirror: 0, steady: 0, party: 0, cost: 0,
    mark: 0, pulse: 0, stack: 0, extend: 0, refund: 0, purge: 0, missing: 0, leech: 0,
  };
}

/** ward HP for a holder with `maxHp`: shield fraction of max HP + the flat heal-line part (0 when the skill has no ward) */
export function wardAmount(fp: FinalParams, maxHp: number): number {
  return fp.shield > 0 ? fp.shield * maxHp + fp.shieldFlat : 0;
}

const STATUS_INDEX: Record<StatusKind, number> = {
  slow: StatusIdx.Slow,
  poison: StatusIdx.Poison,
  burn: StatusIdx.Burn,
  stun: StatusIdx.Stun,
  freeze: StatusIdx.Freeze,
  bleed: StatusIdx.Bleed,
  fear: StatusIdx.Fear,
  weaken: StatusIdx.Weaken,
};

/** behaviors that get the player's +projectiles / projSpeed / pierce stats */
const PROJECTILE_LIKE = new Set<BehaviorKind>(['projectile', 'homingProjectile']);
const COUNT_LIKE = new Set<BehaviorKind>(['projectile', 'homingProjectile', 'skyStrike', 'orbit', 'summon', 'chain']);

const U_DAMAGE = 0;
const U_COOLDOWN = 1;
const U_AREA = 2;
const U_COUNT = 3;
const U_DURATION = 4;
const U_SPEED = 5;
const U_PIERCE = 6;
const U_KNOCK = 7;
const U_TICK = 8;
const U_RANGE = 9;
const U_STATUS_CHANCE = 10;
const U_STATUS_POWER = 11;
const U_HEAL = 12;

const ELEMENT_INDEX: Record<string, number> = {
  physical: 0,
  fire: 1,
  ice: 2,
  lightning: 3,
  dark: 4,
  poison: 5,
  holy: 6,
  wind: 7,
};

export function elementIndex(name: string): number {
  return ELEMENT_INDEX[name] ?? 0;
}

/** write the skill's final parameters for the current moment into `out` */
export function resolveParams(p: PlayerState, s: SkillInstance, out: FinalParams): FinalParams {
  const def = s.def;
  const base = def.params;
  const st = p.stats;
  const upg = s.upg;
  const mods = p.skillMods[def.id];
  const aw = s.rank >= MAX_SKILL_RANK ? def.awaken.params : null;
  const awn = (key: string, dflt: number): number => (aw ? (aw[key] ?? dflt) : dflt);

  const mDamage = mods?.damage ?? 0;
  const mCooldown = mods?.cooldown ?? 0;
  const mArea = mods?.area ?? 0;
  const mDuration = mods?.duration ?? 0;
  const mCount = mods?.count ?? 0;
  const mSpeed = mods?.speed ?? 0;
  const mPierce = mods?.pierce ?? 0;
  const mKnock = mods?.knockback ?? 0;
  const mTick = mods?.tick ?? 0;
  const mRange = mods?.range ?? 0;
  const mStatusChance = mods?.statusChance ?? 0;
  const mStatusPower = mods?.statusPower ?? 0;
  const mHeal = mods?.heal ?? 0;

  const behavior = def.behavior;
  const uDamage = upg[U_DAMAGE]!;
  const uCooldown = upg[U_COOLDOWN]!;
  const uArea = upg[U_AREA]!;
  const uCount = upg[U_COUNT]!;
  const uDuration = upg[U_DURATION]!;
  const uSpeed = upg[U_SPEED]!;
  const uPierce = upg[U_PIERCE]!;
  const uKnock = upg[U_KNOCK]!;
  const uTick = upg[U_TICK]!;
  const uRange = upg[U_RANGE]!;

  const areaMul = (1 + uArea.pct + mArea) * st.area * awn('areaMul', 1);
  out.damage = (base.damage + uDamage.flat) * (1 + uDamage.pct + mDamage) * st.damage * awn('damageMul', 1);
  const cdr = Math.min(0.75, Math.max(0, uCooldown.pct + mCooldown));
  out.cooldown = Math.max(0.1, (base.cooldown - uCooldown.flat) * (1 - cdr) * st.cooldownMul * awn('cooldownMul', 1));
  out.area = Math.max(0.2, (base.area + uArea.flat) * (1 + uArea.pct + mArea) * st.area * awn('areaMul', 1));
  const countBonus = COUNT_LIKE.has(behavior) ? st.projectiles : 0;
  out.count = Math.max(1, Math.round(base.count + uCount.flat + uCount.pct * base.count + mCount * base.count) + countBonus + awn('countAdd', 0));
  out.duration = Math.max(0, (base.duration + uDuration.flat) * (1 + uDuration.pct + mDuration) * st.duration * awn('durationMul', 1));
  const projLike = PROJECTILE_LIKE.has(behavior);
  out.speed = (base.speed + uSpeed.flat) * (1 + uSpeed.pct + mSpeed) * (projLike || behavior === 'orbit' ? st.projSpeed : 1) * awn('speedMul', 1);
  out.pierce = Math.max(0, Math.round(base.pierce + uPierce.flat + mPierce) + (projLike ? st.pierce : 0) + awn('pierceAdd', 0));
  out.knockback = Math.max(0, (base.knockback + uKnock.flat) * (1 + uKnock.pct + mKnock) * awn('knockbackMul', 1));
  const tickCut = Math.min(0.7, Math.max(0, uTick.pct + mTick));
  out.tick = base.tick > 0 ? Math.max(0.08, (base.tick - uTick.flat) * (1 - tickCut) * awn('tickMul', 1)) : 0;
  out.range = Math.max(0, (base.range + uRange.flat) * (1 + uRange.pct + mRange) * awn('rangeMul', 1));
  out.angle = base.angle ?? 0;
  const baseHeal = base.heal ?? 0;
  out.heal = Math.max(0, baseHeal + upg[U_HEAL]!.flat + baseHeal * (upg[U_HEAL]!.pct + mHeal) + awn('healAdd', 0));
  const baseShield = base.shield ?? 0;
  if (baseShield > 0) {
    // a ward skill's heal lines and healAdd grow the ward; without a base heal there is no instant heal at all
    out.shield = (baseShield / 100) * (1 + upg[U_HEAL]!.pct + mHeal);
    out.shieldFlat = Math.max(0, upg[U_HEAL]!.flat + awn('healAdd', 0));
    if (baseHeal === 0) out.heal = 0;
  } else {
    out.shield = 0;
    out.shieldFlat = 0;
  }
  out.buff = base.buff ?? null;
  out.element = elementIndex(def.element);
  out.awakened = aw !== null;
  out.echo = awn('echo', 0);
  const baseNova = base.nova ?? 0;
  out.nova = Math.max(baseNova > 0 ? baseNova * areaMul : 0, awn('nova', 0));
  out.novaDamage = awn('novaDamage', base.novaDamage ?? 0.6);
  out.explode = awn('explode', 0);
  out.veil = (base.veil ?? 0) * (base.duration > 0 ? out.duration / base.duration : 1);
  out.taunt = base.taunt ?? 0;
  out.burst = (base.burst ?? 0) * areaMul;
  out.power = (base.power ?? 0) / 100;
  out.drain = base.drain ?? 0;
  out.mirror = base.mirror ?? 0;
  out.steady = base.steady ?? 0;
  out.party = base.party ?? 0;
  out.cost = (base.cost ?? 0) / 100;
  out.mark = Math.round(base.mark ?? 0);
  out.pulse = base.pulse ?? 0;
  out.stack = (base.stack ?? 0) / 100;
  out.extend = base.extend ?? 0;
  out.refund = base.refund ?? 0;
  out.purge = base.purge ?? 0;
  out.missing = base.missing ?? 0;
  out.leech = (base.leech ?? 0) / 100;

  const bs = base.status;
  if (bs) {
    out.statusKind = STATUS_INDEX[bs.kind];
    out.statusChance = Math.min(1, Math.max(0, bs.chance + upg[U_STATUS_CHANCE]!.flat + (upg[U_STATUS_CHANCE]!.pct + mStatusChance) * bs.chance + awn('statusChanceAdd', 0)));
    out.statusPower = bs.power * (1 + upg[U_STATUS_POWER]!.pct + mStatusPower) + upg[U_STATUS_POWER]!.flat;
    if (aw) out.statusPower *= aw['statusPowerMul'] ?? 1;
    out.statusDuration = bs.duration;
  } else {
    out.statusKind = -1;
    out.statusChance = 0;
    out.statusPower = 0;
    out.statusDuration = 0;
  }
  return out;
}

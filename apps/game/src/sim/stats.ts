// Player stat aggregation: class base + empire + meta + passives + spirit stones + trinkets + temporary buffs.
// Final value = (base + Σflat) × (1 + Σpct); caps from BalanceConfig.caps.
//
// Content conventions (also relied upon by the fixtures and the real CONTENT):
//  - StatMods percent-likes are fractions (0.1 = +10%). `cooldown` > 0 REDUCES cooldowns (capped by caps.cooldown),
//    `attackSpeed` > 0 divides cooldowns, `moveSpeed`/`area`/`duration`/`projSpeed`/`xpGain`/`yeopGain`/`pickupRadius`
//    /`damage` are +fractions, `projectiles`/`pierce`/`revives` are flat, `luck` is additive (0.1 = +10 luck points),
//    `thorns` = fraction of a melee hit reflected, `lifesteal` = fraction of damage dealt healed (capped).
//  - Passive effect = perRank × power (power = Σ RARITY_MULT of the picked cards, ≈ rank at common).
//  - Soul pearl effect = perLevel × (level + 1)  (+0 stones still give one step).
//  - Trinket effect keys in `perRank`: lifesteal{pct} chainHit{chance,damage} stunChance{chance,duration}
//    slowChance{chance,power,duration} poisonChance{chance,power,duration} thorns{pct} critBurst{radius,damage}
//    shield{amount,regen}; chance/pct/amount/power/damage/regen scale linearly with rank, radius/duration do not.

import type { ClassDef, ContentDB, RaceTag, StatMods, TrinketDef } from '../data/schema';
import type { ContentIndex } from './content';
import type { PlayerState, PlayerStats } from './stores';
import { ELEMENTS } from './stores';

export interface Acc {
  maxHp: number;
  maxHpPct: number;
  armor: number;
  regen: number;
  moveSpeed: number;
  damage: number;
  critChance: number;
  critDamage: number;
  cooldown: number;
  attackSpeed: number;
  area: number;
  duration: number;
  projectiles: number;
  projSpeed: number;
  pierce: number;
  xpGain: number;
  yeopGain: number;
  pickupRadius: number;
  luck: number;
  revives: number;
  lifesteal: number;
  evasion: number;
  thorns: number;
  vsBoss: number;
  vsRace: Partial<Record<RaceTag, number>>;
  resist: number[];
}

function newAcc(): Acc {
  return {
    maxHp: 0, maxHpPct: 0, armor: 0, regen: 0, moveSpeed: 0, damage: 0, critChance: 0, critDamage: 0, cooldown: 0,
    attackSpeed: 0, area: 0, duration: 0, projectiles: 0, projSpeed: 0, pierce: 0, xpGain: 0, yeopGain: 0,
    pickupRadius: 0, luck: 0, revives: 0, lifesteal: 0, evasion: 0, thorns: 0, vsBoss: 0, vsRace: {},
    resist: new Array<number>(ELEMENTS.length).fill(0),
  };
}

export function addMods(acc: Acc, m: StatMods, mul = 1): void {
  if (m.maxHp) acc.maxHp += m.maxHp * mul;
  if (m.maxHpPct) acc.maxHpPct += m.maxHpPct * mul;
  if (m.armor) acc.armor += m.armor * mul;
  if (m.regen) acc.regen += m.regen * mul;
  if (m.moveSpeed) acc.moveSpeed += m.moveSpeed * mul;
  if (m.damage) acc.damage += m.damage * mul;
  if (m.critChance) acc.critChance += m.critChance * mul;
  if (m.critDamage) acc.critDamage += m.critDamage * mul;
  if (m.cooldown) acc.cooldown += m.cooldown * mul;
  if (m.attackSpeed) acc.attackSpeed += m.attackSpeed * mul;
  if (m.area) acc.area += m.area * mul;
  if (m.duration) acc.duration += m.duration * mul;
  if (m.projectiles) acc.projectiles += m.projectiles * mul;
  if (m.projSpeed) acc.projSpeed += m.projSpeed * mul;
  if (m.pierce) acc.pierce += m.pierce * mul;
  if (m.xpGain) acc.xpGain += m.xpGain * mul;
  if (m.yeopGain) acc.yeopGain += m.yeopGain * mul;
  if (m.pickupRadius) acc.pickupRadius += m.pickupRadius * mul;
  if (m.luck) acc.luck += m.luck * mul;
  if (m.revives) acc.revives += m.revives * mul;
  if (m.lifesteal) acc.lifesteal += m.lifesteal * mul;
  if (m.evasion) acc.evasion += m.evasion * mul;
  if (m.thorns) acc.thorns += m.thorns * mul;
  if (m.vsBoss) acc.vsBoss += m.vsBoss * mul;
  if (m.vsRace) {
    for (const k of Object.keys(m.vsRace) as RaceTag[]) {
      acc.vsRace[k] = (acc.vsRace[k] ?? 0) + (m.vsRace[k] ?? 0) * mul;
    }
  }
  if (m.resist) {
    for (let i = 0; i < ELEMENTS.length; i++) {
      const v = m.resist[ELEMENTS[i] as keyof typeof m.resist];
      if (v) acc.resist[i] = (acc.resist[i] as number) + v * mul;
    }
  }
}


/** class base block with the three absolute fields split away from the additive mods */
export function classBaseMods(cls: ClassDef): StatMods {
  const { maxHp: _m, armor: _a, moveSpeed: _s, ...rest } = cls.base;
  void _m;
  void _a;
  void _s;
  return rest;
}

function trinketKey(def: TrinketDef, key: string, fallback: number): number {
  return def.perRank[key] ?? fallback;
}

export function createStats(): PlayerStats {
  return {
    maxHp: 100, armor: 0, regen: 0, moveSpeed: 5, damage: 1, critChance: 0.05, critMul: 1.5, cooldownMul: 1, area: 1,
    duration: 1, projectiles: 0, projSpeed: 1, pierce: 0, xpGain: 1, yeopGain: 1, pickupRadius: 3, luck: 0, revives: 0,
    lifesteal: 0, evasion: 0, thorns: 0, vsBoss: 0, vsRace: {}, resist: new Float32Array(ELEMENTS.length),
    chainChance: 0, chainDamage: 0, stunChance: 0, stunDuration: 0, slowChance: 0, slowPower: 0, slowDuration: 0,
    poisonChance: 0, poisonPower: 0, poisonDuration: 0, critBurstRadius: 0, critBurstDamage: 0, shieldMax: 0, shieldRegen: 0,
  };
}

/**
 * Recompute `p.stats` (and the per-type race multiplier table). Keeps current hp proportional when max hp changes
 * upward (gains are granted, losses clamp).
 */
export function refreshStats(p: PlayerState, content: ContentDB, ix: ContentIndex): void {
  const bal = content.balance;
  const cls = ix.classes.get(p.classId);
  if (!cls) throw new Error(`sim: unknown class '${p.classId}'`);
  const acc = newAcc();
  addMods(acc, classBaseMods(cls));
  for (const m of p.fixed) addMods(acc, m);
  for (const pi of p.passives) {
    const def = ix.passives.get(pi.id);
    if (def) addMods(acc, def.perRank, pi.power);
  }
  for (const st of p.stones) {
    if (!st) continue;
    const def = ix.stones.get(st.id);
    if (def) addMods(acc, def.perLevel, st.level + 1);
  }
  // Vigil: the standing bonus of an owned context skill (insurance cards are never dead)
  for (const sk of p.skills) if (sk.def.vigil) addMods(acc, sk.def.vigil);
  for (const b of p.buffs) addMods(acc, b.mods, b.scale ?? 1);

  const s = p.stats;
  const oldMax = s.maxHp;
  s.maxHp = Math.max(1, (cls.base.maxHp + acc.maxHp) * (1 + acc.maxHpPct));
  s.armor = Math.max(0, cls.base.armor + acc.armor);
  s.regen = Math.max(0, acc.regen);
  s.moveSpeed = Math.max(1.5, cls.base.moveSpeed * (1 + acc.moveSpeed));
  s.damage = Math.max(0.1, 1 + acc.damage);
  s.critChance = Math.min(bal.caps.critChance, Math.max(0, acc.critChance));
  s.critMul = Math.max(1, 1.5 + acc.critDamage);
  const cdr = Math.min(bal.caps.cooldown, Math.max(0, acc.cooldown));
  s.cooldownMul = (1 - cdr) / (1 + Math.max(-0.5, acc.attackSpeed));
  s.area = Math.max(0.3, 1 + acc.area);
  s.duration = Math.max(0.3, 1 + acc.duration);
  s.projectiles = Math.floor(acc.projectiles + 1e-6);
  s.projSpeed = Math.max(0.3, 1 + acc.projSpeed);
  s.pierce = Math.floor(acc.pierce + 1e-6);
  s.xpGain = Math.max(0.1, 1 + acc.xpGain);
  s.yeopGain = Math.max(0.1, 1 + acc.yeopGain);
  s.pickupRadius = 3.2 * Math.max(0.3, 1 + acc.pickupRadius);
  s.luck = acc.luck;
  s.revives = Math.max(0, Math.floor(acc.revives + 1e-6));
  s.evasion = Math.min(bal.caps.evasion, Math.max(0, acc.evasion));
  s.thorns = Math.max(0, acc.thorns);
  s.vsBoss = acc.vsBoss;
  s.vsRace = acc.vsRace;
  for (let i = 0; i < ELEMENTS.length; i++) s.resist[i] = Math.min(0.75, Math.max(-1, acc.resist[i] as number));

  let lifesteal = acc.lifesteal;
  s.chainChance = 0;
  s.chainDamage = 0;
  s.stunChance = 0;
  s.stunDuration = 0;
  s.slowChance = 0;
  s.slowPower = 0;
  s.slowDuration = 0;
  s.poisonChance = 0;
  s.poisonPower = 0;
  s.poisonDuration = 0;
  s.critBurstRadius = 0;
  s.critBurstDamage = 0;
  s.shieldMax = 0;
  s.shieldRegen = 0;
  for (const ti of p.trinkets) {
    if (!ti) continue;
    const def = ix.trinkets.get(ti.id);
    if (!def) continue;
    const r = ti.rank;
    switch (def.effect) {
      case 'lifesteal':
        lifesteal += trinketKey(def, 'pct', 0.01) * r;
        break;
      case 'chainHit':
        s.chainChance = Math.min(0.6, s.chainChance + trinketKey(def, 'chance', 0.1) * r);
        s.chainDamage = Math.min(1.5, trinketKey(def, 'damage', 0.5) * Math.max(1, r * 0.5 + 0.5));
        break;
      case 'stunChance':
        s.stunChance = Math.min(0.5, s.stunChance + trinketKey(def, 'chance', 0.03) * r);
        s.stunDuration = Math.max(s.stunDuration, trinketKey(def, 'duration', 0.5));
        break;
      case 'slowChance':
        s.slowChance = Math.min(0.8, s.slowChance + trinketKey(def, 'chance', 0.1) * r);
        s.slowPower = Math.min(0.7, Math.max(s.slowPower, trinketKey(def, 'power', 0.3) * Math.max(1, r * 0.5 + 0.5)));
        s.slowDuration = Math.max(s.slowDuration, trinketKey(def, 'duration', 2));
        break;
      case 'poisonChance':
        s.poisonChance = Math.min(0.8, s.poisonChance + trinketKey(def, 'chance', 0.08) * r);
        s.poisonPower = Math.max(s.poisonPower, trinketKey(def, 'power', 0.3) * r);
        s.poisonDuration = Math.max(s.poisonDuration, trinketKey(def, 'duration', 3));
        break;
      case 'thorns':
        s.thorns += trinketKey(def, 'pct', 0.2) * r;
        break;
      case 'critBurst':
        s.critBurstRadius = Math.max(s.critBurstRadius, trinketKey(def, 'radius', 3));
        s.critBurstDamage += trinketKey(def, 'damage', 0.2) * r;
        break;
      case 'shield':
        s.shieldMax += trinketKey(def, 'amount', 10) * r;
        s.shieldRegen += trinketKey(def, 'regen', 0.5) * r;
        break;
    }
  }
  s.lifesteal = Math.min(bal.caps.lifesteal, Math.max(0, lifesteal));

  // per-type race multipliers
  const types = ix.typeDefs;
  if (p.raceMul.length !== types.length) p.raceMul = new Float32Array(types.length);
  for (let i = 0; i < types.length; i++) {
    const def = types[i];
    let m = 1;
    if (def) for (const tag of def.race) m += s.vsRace[tag] ?? 0;
    p.raceMul[i] = m;
  }

  // keep hp in step with max hp changes
  if (oldMax > 0 && s.maxHp > oldMax) p.hp += s.maxHp - oldMax;
  p.hpMax = s.maxHp;
  if (p.hp > p.hpMax) p.hp = p.hpMax;
  p.statsDirty = false;
}

// ---------------------------------------------------------------------------
// Sky Sovereign's Boon (OF-03): the stacking overflow card. Every pick pushes one more always-on entry into `p.fixed` (run-only: the
// entries live and die with the PlayerState, nothing is saved). The registry tells the boon entries from the empire / meta ones.

const BOON_ENTRIES = new WeakSet<StatMods>();

/** add one Boon pick to the hero's always-on mods (the next refreshStats applies it) */
export function addBoon(p: PlayerState, mods: StatMods): void {
  const entry: StatMods = { ...mods };
  BOON_ENTRIES.add(entry);
  p.fixed.push(entry);
  p.statsDirty = true;
}

/** how many Boon picks the hero holds */
export function boonCount(p: PlayerState): number {
  let n = 0;
  for (const m of p.fixed) if (BOON_ENTRIES.has(m)) n++;
  return n;
}

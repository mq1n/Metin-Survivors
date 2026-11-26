// StatMods arithmetic: additive merge with scalar scaling (flat + pct stay separate keys, per schema.ts).

import type { StatMods } from '../data/schema';

type NumericKey = Exclude<keyof StatMods, 'vsRace' | 'resist'>;

/** Exhaustive by construction: adding a key to StatMods without listing it here is a compile error. */
const NUMERIC: Record<NumericKey, true> = {
  maxHp: true,
  maxHpPct: true,
  armor: true,
  regen: true,
  moveSpeed: true,
  damage: true,
  critChance: true,
  critDamage: true,
  cooldown: true,
  area: true,
  duration: true,
  projectiles: true,
  projSpeed: true,
  pierce: true,
  xpGain: true,
  yeopGain: true,
  pickupRadius: true,
  luck: true,
  revives: true,
  lifesteal: true,
  attackSpeed: true,
  evasion: true,
  thorns: true,
  vsBoss: true,
};
const NUMERIC_KEYS = Object.keys(NUMERIC) as NumericKey[];

function addRecord(dst: Record<string, number | undefined>, src: Record<string, number | undefined>, scale: number): void {
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    dst[k] = (dst[k] ?? 0) + v * scale;
  }
}

/** target += src × scale (in place). Numeric keys add; `vsRace` / `resist` add per entry. Returns target. */
export function addStatMods(target: StatMods, src: StatMods | undefined, scale = 1): StatMods {
  if (!src || scale === 0) return target;
  const out: Partial<Record<NumericKey, number>> = target;
  for (const key of NUMERIC_KEYS) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = (out[key] ?? 0) + v * scale;
  }
  if (src.vsRace) addRecord((target.vsRace ??= {}), src.vsRace, scale);
  if (src.resist) addRecord((target.resist ??= {}), src.resist, scale);
  return target;
}

/** Sum of several StatMods (new object). */
export function sumStatMods(...mods: (StatMods | undefined)[]): StatMods {
  const out: StatMods = {};
  for (const m of mods) addStatMods(out, m);
  return out;
}

export function scaleStatMods(mods: StatMods, scale: number): StatMods {
  return addStatMods({}, mods, scale);
}

/** True when no key carries a non-zero value. */
export function isEmptyStatMods(mods: StatMods): boolean {
  for (const key of NUMERIC_KEYS) if (mods[key]) return false;
  for (const rec of [mods.vsRace, mods.resist]) {
    if (rec) for (const n of Object.values(rec)) if (n) return false;
  }
  return true;
}

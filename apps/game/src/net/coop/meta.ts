// MetaBonuses cross the network once per run (guest → host, JSON `event` ≤ 4096 chars). The host builds the guest's hero
// from them, so everything is re-validated into a fresh object: known keys only, finite numbers, bounded magnitudes,
// bounded list sizes. (The host's sim has its own caps; this keeps garbage and absurd values out of the room.)

import type { MetaBonuses } from '../../sim/run';

const STAT_KEYS = [
  'maxHp',
  'maxHpPct',
  'armor',
  'regen',
  'moveSpeed',
  'damage',
  'critChance',
  'critDamage',
  'cooldown',
  'area',
  'duration',
  'projectiles',
  'projSpeed',
  'pierce',
  'xpGain',
  'yeopGain',
  'pickupRadius',
  'luck',
  'revives',
  'lifesteal',
  'attackSpeed',
  'evasion',
  'thorns',
  'vsBoss',
] as const;

const UPGRADE_KEYS = ['damage', 'cooldown', 'area', 'count', 'duration', 'speed', 'pierce', 'knockback', 'tick', 'range', 'statusChance', 'statusPower', 'heal'] as const;
const MAGNITUDE = 1e5;
const MAX_JSON = 3800;

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(-MAGNITUDE, Math.min(MAGNITUDE, v)) : null;
}

function smallInt(v: unknown, max: number): number | undefined {
  const n = finite(v);
  return n === null ? undefined : Math.max(0, Math.min(max, Math.floor(n)));
}

function cleanRecord(src: Record<string, unknown> | null, keys: readonly string[] | null, maxKeys: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!src) return out;
  let n = 0;
  for (const k of Object.keys(src)) {
    if (n >= maxKeys) break;
    if (keys && !keys.includes(k)) continue;
    if (!keys && !/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
    const v = finite(src[k]);
    if (v === null) continue;
    out[k] = v;
    n++;
  }
  return out;
}

/** Validates an untrusted MetaBonuses; never throws. */
export function sanitizeMeta(d: unknown): MetaBonuses {
  const src = rec(d);
  if (!src) return { stats: {} };
  const statsSrc = rec(src.stats);
  const stats: Record<string, unknown> = cleanRecord(statsSrc, STAT_KEYS, 40);
  const vsRace = cleanRecord(rec(statsSrc?.vsRace), null, 16);
  if (Object.keys(vsRace).length > 0) stats.vsRace = vsRace;
  const resist = cleanRecord(rec(statsSrc?.resist), null, 10);
  if (Object.keys(resist).length > 0) stats.resist = resist;
  const out: MetaBonuses = { stats };
  const startLevel = smallInt(src.startLevel, 40);
  if (startLevel !== undefined && startLevel > 1) out.startLevel = startLevel;
  if (Array.isArray(src.extraSkills)) {
    const skills = src.extraSkills.filter((s): s is string => typeof s === 'string' && /^[A-Za-z0-9_]{1,48}$/.test(s)).slice(0, 8);
    if (skills.length > 0) out.extraSkills = skills;
  }
  const rerolls = smallInt(src.rerolls, 20);
  if (rerolls) out.rerolls = rerolls;
  const banishes = smallInt(src.banishes, 20);
  if (banishes) out.banishes = banishes;
  const skips = smallInt(src.skips, 20);
  if (skips) out.skips = skips;
  const sm = rec(src.skillMods);
  if (sm) {
    const skillMods: NonNullable<MetaBonuses['skillMods']> = {};
    let n = 0;
    for (const id of Object.keys(sm)) {
      if (n >= 64) break;
      if (id === '__proto__' || !/^[A-Za-z0-9_]{1,48}$/.test(id)) continue;
      const mods = cleanRecord(rec(sm[id]), UPGRADE_KEYS, 13);
      if (Object.keys(mods).length === 0) continue;
      skillMods[id] = mods;
      n++;
    }
    if (n > 0) out.skillMods = skillMods;
  }
  // the relay refuses `event` frames above 4096 chars: drop per-skill talent mods rather than the whole message
  while (out.skillMods && JSON.stringify(out).length > MAX_JSON) {
    const ids = Object.keys(out.skillMods);
    const last = ids[ids.length - 1];
    if (last === undefined) {
      delete out.skillMods;
      break;
    }
    delete out.skillMods[last];
  }
  return out;
}

// Id → definition lookups over the ContentDB (cached per content object) plus the small text helpers that turn
// definitions into display strings (skill descriptions with live numbers, stat lines, rank labels).
import type {
  BossDef,
  ClassDef,
  ContentDB,
  EmpireDef,
  EnemyDef,
  GearDef,
  MetinDef,
  PassiveDef,
  SkillDef,
  SkillParams,
  StatMods,
  StoneDef,
  TrinketDef,
  ZoneDef,
} from '../data/schema';
import { SKILL_RANKS } from '../data/schema';
import { fmtDec, fmtInt, fmtPct, t, tl } from '../i18n/i18n';
import { deps } from './env';

export interface UiIndex {
  classes: Map<string, ClassDef>;
  skills: Map<string, SkillDef>;
  passives: Map<string, PassiveDef>;
  stones: Map<string, StoneDef>;
  trinkets: Map<string, TrinketDef>;
  enemies: Map<string, EnemyDef>;
  bosses: Map<string, BossDef>;
  metins: Map<string, MetinDef>;
  zones: Map<string, ZoneDef>;
  gear: Map<string, GearDef>;
  empires: Map<string, EmpireDef>;
  zonesOrdered: ZoneDef[];
}

const cache = new WeakMap<ContentDB, UiIndex>();

function byId<T extends { id: string }>(list: readonly T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

export function indexOf(content: ContentDB = deps().content): UiIndex {
  let ix = cache.get(content);
  if (!ix) {
    ix = {
      classes: byId(content.classes),
      skills: byId(content.skills),
      passives: byId(content.passives),
      stones: byId(content.stones),
      trinkets: byId(content.trinkets),
      enemies: byId(content.enemies),
      bosses: byId(content.bosses),
      metins: byId(content.metins),
      zones: byId(content.zones),
      gear: byId(content.gear),
      empires: byId(content.empires),
      zonesOrdered: [...content.zones].sort((a, b) => a.order - b.order),
    };
    cache.set(content, ix);
  }
  return ix;
}

// ---------------------------------------------------------------------------
// Ranks

/** Skill rank index 0..7 → '1','2','3','M1','M2','G1','G2','P'. */
export function rankLabel(rank: number): string {
  return SKILL_RANKS[Math.max(0, Math.min(SKILL_RANKS.length - 1, Math.floor(rank)))] ?? '1';
}

// ---------------------------------------------------------------------------
// Stat lines

/** Stats where a positive rolled value means "reduce by" (cooldown, tick interval). */
const REDUCE_STATS: Record<string, true> = { cooldown: true, tick: true };

/** Stats that are flat counts rather than fractions when mode === 'flat'. */
export function statLabel(stat: string): string {
  return t(`stat.${stat}`);
}

/**
 * "+34% damage", "−12% cooldown", "+1 projectiles". `mode` pct → value is a fraction.
 * Returns the number part and label part separately so the UI can colour the number.
 */
export function formatStatLine(stat: string, mode: 'pct' | 'flat', value: number): { sign: string; amount: string; label: string; positive: boolean } {
  const reduce = REDUCE_STATS[stat] === true;
  const shown = reduce ? -value : value;
  const sign = shown < 0 ? '−' : '+';
  const mag = Math.abs(value);
  const amount = mode === 'pct' ? fmtPct(mag, mag < 0.1 ? 1 : 0) : fmtDec(mag, mag < 10 ? 1 : 0);
  return { sign, amount, label: statLabel(stat), positive: reduce ? value > 0 : value >= 0 };
}

const PCT_STATS: Record<string, true> = {
  maxHpPct: true,
  moveSpeed: true,
  damage: true,
  critChance: true,
  critDamage: true,
  cooldown: true,
  area: true,
  duration: true,
  projSpeed: true,
  xpGain: true,
  yeopGain: true,
  pickupRadius: true,
  luck: true,
  lifesteal: true,
  attackSpeed: true,
  evasion: true,
  vsBoss: true,
};

export interface StatRow {
  label: string;
  value: string;
  positive: boolean;
}

/** StatMods → ordered [label, formatted value] rows (for gear tooltips, talent nodes, empire bonuses). */
export function statModRows(mods: StatMods, scale = 1): StatRow[] {
  const rows: StatRow[] = [];
  for (const [key, raw] of Object.entries(mods)) {
    if (raw === undefined || raw === null) continue;
    if (typeof raw === 'number') {
      if (raw === 0) continue;
      const v = raw * scale;
      const isPct = PCT_STATS[key] === true;
      const reduce = key === 'cooldown';
      const shown = reduce ? -v : v;
      const sign = shown < 0 ? '−' : '+';
      const amount = isPct ? fmtPct(Math.abs(shown), Math.abs(shown) < 0.1 ? 1 : 0) : fmtDec(Math.abs(shown), Math.abs(shown) < 10 ? 1 : 0);
      rows.push({ label: statLabel(key), value: `${sign}${amount}`, positive: reduce ? v >= 0 : v >= 0 });
    } else if (typeof raw === 'object') {
      for (const [sub, sv] of Object.entries(raw as Record<string, number>)) {
        if (!sv) continue;
        const v = sv * scale;
        const label = key === 'vsRace' ? t('stat.vsRace', { race: t(`race.${sub}`) }) : t('stat.resist', { element: t(`element.${sub}`) });
        rows.push({ label, value: `${v < 0 ? '−' : '+'}${fmtPct(Math.abs(v), 0)}`, positive: v >= 0 });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Skill text

/** placeholders printed with up to one decimal (3.5 m, 1.6 s, 1.5 s): a whole number still prints without ".0"; every other key rounds to an integer */
const ONE_DECIMAL_KEYS: ReadonlySet<string> = new Set(['cooldown', 'duration', 'tick', 'area', 'veil', 'pulse', 'nova', 'burst']);

/** Fills {damage} {cooldown} {area} {count} {duration} placeholders of a skill description from its params. */
export function skillDescription(def: SkillDef, params: SkillParams = def.params): string {
  // the unit sits with its number: a no-break space before the "s" / "sn" that follows a placeholder ("for 3.5 s" never splits across lines)
  const raw = tl(def.desc).replace(/(\{\w+\}) (s|sn)(?![\p{L}\d])/gu, '$1\u00A0$2');
  return raw.replace(/\{(\w+)\}/g, (m, key: string) => {
    const v = (params as unknown as Record<string, unknown>)[key];
    if (typeof v !== 'number') return m;
    if (ONE_DECIMAL_KEYS.has(key)) return fmtDec(v, 1);
    return fmtInt(v);
  });
}

export function skillName(id: string): string {
  const d = indexOf().skills.get(id);
  return d ? tl(d.name) : id;
}

export function enemyName(id: string): string {
  const ix = indexOf();
  const d = ix.bosses.get(id) ?? ix.enemies.get(id);
  return d ? tl(d.name) : id;
}

export function metinName(id: string): string {
  const d = indexOf().metins.get(id);
  return d ? tl(d.name) : id;
}

export function zoneName(id: string): string {
  const d = indexOf().zones.get(id);
  return d ? tl(d.name) : id;
}

export function className(id: string): string {
  const d = indexOf().classes.get(id);
  return d ? tl(d.name) : id;
}

/** Display name of any item id across skill/passive/stone/trinket/gear tables. */
export function itemName(id: string): string {
  const ix = indexOf();
  const d = ix.skills.get(id) ?? ix.passives.get(id) ?? ix.stones.get(id) ?? ix.trinkets.get(id) ?? ix.gear.get(id);
  return d ? tl(d.name) : id;
}

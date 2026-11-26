// Gear drops after a run (PLAN §3.8: "boss'lar sınıfa uygun parça düşürür"): one roll group per boss kill (defs whose
// GearDef.source.boss matches) plus one zone group (defs without a boss) per finished run. Chances come from
// GearDef.source.chance × hard-mode reward × luck × pity. Pity: every group that has a not-yet-owned piece but
// yields no NEW piece adds a miss; misses raise the chance, and at PITY_GUARANTEE the next group is guaranteed to
// deliver a new piece. A duplicate converts to shards (gear.ts grantGear).

import type { ClassId, Difficulty, GearDef } from '../data/schema';
import { indexContent } from './content';
import { grantGear, usableBy } from './gear';
import { weightedIndex } from './rng';
import type { MetaContent, MetaRng, SaveData } from './types';

/** Consecutive no-new-piece groups before the next group is a guaranteed new piece. */
export const PITY_GUARANTEE = 10;
/** Relative chance bonus per accumulated miss (chance × (1 + PITY_BONUS × pity)). */
export const PITY_BONUS = 0.2;
/** Zone-level (non-boss) pieces only roll after a victory, or after surviving this fraction of the run. */
export const ZONE_DROP_MIN_PROGRESS = 1 / 3;
/** Zone-group chance multiplier for a run that was not won. */
export const ZONE_DROP_DEFEAT_SCALE = 0.5;

export interface DropInput {
  zone: string;
  classId: ClassId;
  difficulty: Difficulty;
  victory: boolean;
  /** run clock, seconds */
  time: number;
  /** boss ids killed (roll once per entry) */
  bossesKilled: readonly string[];
  /** MetaBonuses luck (fraction; clamped 0..2) */
  luck?: number;
}

export interface DropOptions {
  pityGuarantee?: number;
  pityBonus?: number;
}

export interface DropGroup {
  kind: 'boss' | 'zone';
  /** boss id or zone id */
  key: string;
  /** candidate pieces, sorted by id */
  defs: GearDef[];
  /** chance multiplier of the group */
  scale: number;
}

export interface DropEvent {
  gearId: string;
  isNew: boolean;
  /** shards banked for a duplicate */
  shards: number;
  autoEquipped: boolean;
  /** true when the pity guarantee produced it */
  guaranteed: boolean;
  source: { kind: 'boss' | 'zone'; key: string };
}

export interface DropRollResult {
  save: SaveData;
  drops: DropEvent[];
  pity: { before: number; after: number };
}

const byId = (a: GearDef, b: GearDef): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Roll groups for a finished run, in resolution order (boss kills in order, then the zone group). */
export function dropGroupsFor(content: MetaContent, input: DropInput): DropGroup[] {
  const idx = indexContent(content);
  const zone = idx.zones.get(input.zone);
  const pool = content.gear.filter((g) => g.source.zone === input.zone && usableBy(g, input.classId)).sort(byId);
  const groups: DropGroup[] = [];
  const bosses = [...input.bossesKilled];
  if (input.victory && zone && !bosses.includes(zone.final.boss)) bosses.push(zone.final.boss);
  for (const boss of bosses) {
    const defs = pool.filter((g) => g.source.boss === boss);
    if (defs.length > 0) groups.push({ kind: 'boss', key: boss, defs, scale: 1 });
  }
  const zoneDefs = pool.filter((g) => g.source.boss === undefined);
  if (zoneDefs.length > 0) {
    const progress = content.balance.runLength > 0 ? input.time / content.balance.runLength : 0;
    const scale = input.victory ? 1 : progress >= ZONE_DROP_MIN_PROGRESS ? ZONE_DROP_DEFEAT_SCALE : 0;
    if (scale > 0) groups.push({ kind: 'zone', key: input.zone, defs: zoneDefs, scale });
  }
  return groups;
}

export interface DropTableEntry {
  def: GearDef;
  owned: boolean;
  /** per-roll chance shown to the player (GearDef.source.chance × hard-mode reward; before luck / pity) */
  chance: number;
}

export interface DropTableSection {
  zone: string;
  kind: 'boss' | 'zone';
  /** boss id or zone id */
  key: string;
  entries: DropTableEntry[];
}

/** Drop Tables screen model: per zone (in order), per boss (in encounter order) then the zone-level pieces. */
export function dropTableFor(save: SaveData, content: MetaContent, classId: ClassId, difficulty: Difficulty = 'normal'): DropTableSection[] {
  const reward = difficulty === 'hard' ? content.balance.hard.reward : 1;
  const owned = new Set(save.classes[classId].collection);
  const sections: DropTableSection[] = [];
  for (const zone of indexContent(content).zonesOrdered) {
    const pool = content.gear.filter((g) => g.source.zone === zone.id && usableBy(g, classId)).sort(byId);
    const entriesOf = (defs: GearDef[]): DropTableEntry[] =>
      defs.map((def) => ({ def, owned: owned.has(def.id), chance: Math.min(1, def.source.chance * reward) }));
    const bosses = [...new Set([...zone.bosses.map((b) => b.boss), zone.final.boss])];
    for (const boss of bosses) {
      const defs = pool.filter((g) => g.source.boss === boss);
      if (defs.length > 0) sections.push({ zone: zone.id, kind: 'boss', key: boss, entries: entriesOf(defs) });
    }
    const zoneDefs = pool.filter((g) => g.source.boss === undefined);
    if (zoneDefs.length > 0) sections.push({ zone: zone.id, kind: 'zone', key: zone.id, entries: entriesOf(zoneDefs) });
  }
  return sections;
}

export function rollGearDrops(
  save: SaveData,
  content: MetaContent,
  input: DropInput,
  rng: MetaRng,
  opts: DropOptions = {},
): DropRollResult {
  const guarantee = opts.pityGuarantee ?? PITY_GUARANTEE;
  const pityBonus = opts.pityBonus ?? PITY_BONUS;
  const reward = input.difficulty === 'hard' ? content.balance.hard.reward : 1;
  const luck = 1 + Math.max(0, Math.min(2, input.luck ?? 0));
  let cur = save;
  const drops: DropEvent[] = [];
  const before = save.classes[input.classId].pity;
  let pity = before;

  for (const group of dropGroupsFor(content, input)) {
    const owned = (def: GearDef): boolean => cur.classes[input.classId].collection.includes(def.id);
    const hadUnowned = group.defs.some((d) => !owned(d));
    const mult = reward * luck * group.scale * (1 + pityBonus * pity);
    const hits = group.defs.filter((d) => rng.next() < Math.min(1, d.source.chance * mult));
    let guaranteedPick: GearDef | undefined;
    if (!hits.some((d) => !owned(d)) && pity >= guarantee) {
      const candidates = group.defs.filter((d) => !owned(d));
      const i = weightedIndex(rng, candidates.map((d) => Math.max(d.source.chance, 0.001)));
      if (i >= 0) guaranteedPick = candidates[i];
    }
    const resolved = guaranteedPick ? [...hits.filter((d) => d !== guaranteedPick), guaranteedPick] : hits;
    let gotNew = false;
    for (const def of resolved) {
      const granted = grantGear(cur, content, input.classId, def.id, true);
      if (!granted.ok) continue;
      cur = granted.save;
      if (granted.isNew) gotNew = true;
      drops.push({
        gearId: def.id,
        isNew: granted.isNew,
        shards: granted.shards,
        autoEquipped: granted.autoEquipped,
        guaranteed: def === guaranteedPick,
        source: { kind: group.kind, key: group.key },
      });
    }
    if (gotNew) pity = 0;
    else if (hadUnowned) pity += 1;
  }

  if (pity !== cur.classes[input.classId].pity) {
    cur = structuredClone(cur);
    cur.classes[input.classId].pity = pity;
  }
  return { save: cur, drops, pity: { before, after: pity } };
}

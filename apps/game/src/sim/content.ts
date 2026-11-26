// Content lookup tables built once per world from the ContentDB.

import type {
  AffixesDef,
  BossDef,
  ClassDef,
  ContentDB,
  EmpireDef,
  EnemyDef,
  MetinDef,
  PassiveDef,
  RunEventKind,
  RunEventsDef,
  SkillDef,
  StoneDef,
  TrinketDef,
  ZoneDef,
} from '../data/schema';
import { resolveAffixes, resolveRunEvents, runEventKindsOf } from '../data/schema';

export interface ContentIndex {
  skills: Map<string, SkillDef>;
  passives: Map<string, PassiveDef>;
  stones: Map<string, StoneDef>;
  trinkets: Map<string, TrinketDef>;
  enemies: Map<string, EnemyDef>;
  bosses: Map<string, BossDef>;
  metins: Map<string, MetinDef>;
  classes: Map<string, ClassDef>;
  empires: Map<string, EmpireDef>;
  /** creatures then bosses: EnemyStore.type indexes this table */
  typeDefs: EnemyDef[];
  typeIndex: Map<string, number>;
  /** MetinDef table (also EnemyStore.ref for metin rows, MetinState.type) */
  metinDefs: MetinDef[];
  metinIndex: Map<string, number>;
  /** common-pool active skills offered to every class */
  commonSkills: SkillDef[];
  /** run events (data/content/runEvents.json) with defaults for content that has none: no zone has events */
  runEvents: RunEventsDef;
  /** elite affixes (data/content/affixes.json) with defaults for content that has none: disabled */
  affixes: AffixesDef;
}

function mapBy<T extends { id: string }>(list: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const item of list) m.set(item.id, item);
  return m;
}

export function buildContentIndex(content: ContentDB): ContentIndex {
  const typeDefs: EnemyDef[] = [...content.enemies, ...content.bosses];
  const typeIndex = new Map<string, number>();
  typeDefs.forEach((d, i) => typeIndex.set(d.id, i));
  const metinIndex = new Map<string, number>();
  content.metins.forEach((d, i) => metinIndex.set(d.id, i));
  return {
    skills: mapBy(content.skills),
    passives: mapBy(content.passives),
    stones: mapBy(content.stones),
    trinkets: mapBy(content.trinkets),
    enemies: mapBy(content.enemies),
    bosses: mapBy(content.bosses),
    metins: mapBy(content.metins),
    classes: mapBy(content.classes),
    empires: mapBy(content.empires),
    typeDefs,
    typeIndex,
    metinDefs: content.metins,
    metinIndex,
    commonSkills: content.skills.filter((s) => s.classId === 'common' && s.kind === 'active'),
    runEvents: resolveRunEvents(content.runEvents),
    affixes: resolveAffixes(content.affixes),
  };
}

/** the run event kinds eligible in a zone ([] = no event that run) */
export function zoneEventKinds(ix: Pick<ContentIndex, 'runEvents'>, zoneId: string): readonly RunEventKind[] {
  return runEventKindsOf(ix.runEvents, zoneId);
}

export function zoneById(content: ContentDB, id: string): ZoneDef {
  const z = content.zones.find((zone) => zone.id === id);
  if (!z) throw new Error(`sim: unknown zone '${id}'`);
  return z;
}

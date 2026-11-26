// Unlocks (PLAN §3.8): zone chain (zone N+1 opens after beating zone N's final), per-zone hard mode after the
// normal clear, codex entries. Unlock state is persisted (SaveData.unlocks) AND re-derivable from stats, so a
// content update that adds a zone, or a lost flag, heals on load (`recomputeUnlocks`).
//
// Codex unlock grammar (StoryDef.codex[].unlock, "kind:arg"):
//   ''|'always'|'start'   always unlocked          enter:<zoneId> | zone:<zoneId>   ≥1 run started in the zone
//   clear:<zoneId>        zone's final beaten (normal)   hard:<zoneId>   zone's final beaten on hard
//   boss:<bossId>         boss killed once               metin:<metinId>  that metin type broken once
//   class:<classId>       ≥1 run with the class
//   level:<n> | wins:<n> | runs:<n> | kills:<n>   cumulative / best stats thresholds
// Unrecognised strings never unlock (reported as kind 'unknown' by parseCodexCondition).

import type { ClassId, Difficulty, StoryDef, ZoneDef } from '../data/schema';
import { indexContent } from './content';
import { CLASS_IDS, type Fail, type MetaContent, type SaveData, type Unlocks } from './types';
import { fail } from './types';

export interface ZoneRequirement {
  zone: string;
  difficulty: Difficulty;
}

/** What opens `zoneId`: its `unlock` field, else the previous zone (by order) on normal; null for the first zone. */
export function zoneRequirement(content: MetaContent, zoneId: string): ZoneRequirement | null {
  const idx = indexContent(content);
  const zone = idx.zones.get(zoneId);
  if (!zone) return null;
  if (zone.unlock) return { zone: zone.unlock.zone, difficulty: zone.unlock.difficulty ?? 'normal' };
  const i = idx.zonesOrdered.indexOf(zone);
  const prev = i > 0 ? idx.zonesOrdered[i - 1] : undefined;
  return prev ? { zone: prev.id, difficulty: 'normal' } : null;
}

export function clearsOf(save: SaveData, zoneId: string, difficulty: Difficulty): number {
  return save.stats.zones[zoneId]?.[difficulty]?.clears ?? 0;
}

export function isZoneUnlocked(save: SaveData, content: MetaContent, zoneId: string): boolean {
  if (save.unlocks.zones.includes(zoneId)) return true;
  if (!indexContent(content).zones.has(zoneId)) return false;
  const req = zoneRequirement(content, zoneId);
  return req === null || clearsOf(save, req.zone, req.difficulty) > 0;
}

export function isHardUnlocked(save: SaveData, zoneId: string): boolean {
  return save.unlocks.hard.includes(zoneId) || clearsOf(save, zoneId, 'normal') > 0;
}

export interface ZoneStatus {
  zone: ZoneDef;
  unlocked: boolean;
  hardUnlocked: boolean;
  /** null for the first zone */
  requirement: ZoneRequirement | null;
  cleared: Record<Difficulty, boolean>;
}

export function zoneStatuses(save: SaveData, content: MetaContent): ZoneStatus[] {
  return indexContent(content).zonesOrdered.map((zone) => ({
    zone,
    unlocked: isZoneUnlocked(save, content, zone.id),
    hardUnlocked: isHardUnlocked(save, zone.id),
    requirement: zoneRequirement(content, zone.id),
    cleared: { normal: clearsOf(save, zone.id, 'normal') > 0, hard: clearsOf(save, zone.id, 'hard') > 0 },
  }));
}

export type StartCheck = { ok: true } | Fail<'unknownZone' | 'zoneLocked' | 'hardLocked'>;

export function canStartRun(save: SaveData, content: MetaContent, zoneId: string, difficulty: Difficulty): StartCheck {
  if (!indexContent(content).zones.has(zoneId)) return fail('unknownZone');
  if (!isZoneUnlocked(save, content, zoneId)) return fail('zoneLocked');
  if (difficulty === 'hard' && !isHardUnlocked(save, zoneId)) return fail('hardLocked');
  return { ok: true };
}

/** Unlock lists consistent with the stats: persisted flags ∪ derived ones (zone order kept, no duplicates). */
export function recomputeUnlocks(save: SaveData, content: MetaContent): Unlocks {
  const idx = indexContent(content);
  const zones = new Set(save.unlocks.zones);
  const hard = new Set(save.unlocks.hard);
  for (const z of idx.zonesOrdered) {
    if (isZoneUnlocked(save, content, z.id)) zones.add(z.id);
    if (isHardUnlocked(save, z.id)) hard.add(z.id);
  }
  const order = (ids: Set<string>): string[] => {
    const known = idx.zonesOrdered.map((z) => z.id).filter((id) => ids.has(id));
    const unknown = [...ids].filter((id) => !idx.zones.has(id));
    return [...known, ...unknown];
  };
  return { zones: order(zones), hard: order(hard), codex: [...save.unlocks.codex] };
}

// ---------------------------------------------------------------------------
// Codex

export type CodexCondition =
  | { kind: 'always' }
  | { kind: 'enter'; zone: string }
  | { kind: 'clear'; zone: string; difficulty: Difficulty }
  | { kind: 'boss'; boss: string }
  | { kind: 'metin'; metin: string }
  | { kind: 'class'; classId: ClassId }
  | { kind: 'level' | 'wins' | 'runs' | 'kills'; n: number }
  | { kind: 'unknown'; raw: string };

export function parseCodexCondition(raw: string): CodexCondition {
  const s = raw.trim();
  if (s === '' || s === 'always' || s === 'start') return { kind: 'always' };
  const colon = s.indexOf(':');
  if (colon <= 0) return { kind: 'unknown', raw };
  const kind = s.slice(0, colon);
  const arg = s.slice(colon + 1).trim();
  if (arg === '') return { kind: 'unknown', raw };
  switch (kind) {
    case 'enter':
    case 'zone':
      return { kind: 'enter', zone: arg };
    case 'clear':
      return { kind: 'clear', zone: arg, difficulty: 'normal' };
    case 'hard':
      return { kind: 'clear', zone: arg, difficulty: 'hard' };
    case 'boss':
      return { kind: 'boss', boss: arg };
    case 'metin':
      return { kind: 'metin', metin: arg };
    case 'class': {
      const classId = CLASS_IDS.find((c) => c === arg);
      return classId ? { kind: 'class', classId } : { kind: 'unknown', raw };
    }
    case 'level':
    case 'wins':
    case 'runs':
    case 'kills': {
      const n = Number(arg);
      return Number.isFinite(n) ? { kind, n } : { kind: 'unknown', raw };
    }
    default:
      return { kind: 'unknown', raw };
  }
}

export function codexConditionMet(save: SaveData, cond: CodexCondition): boolean {
  const st = save.stats;
  switch (cond.kind) {
    case 'always':
      return true;
    case 'enter': {
      const z = st.zones[cond.zone];
      return !!z && ((z.normal?.runs ?? 0) > 0 || (z.hard?.runs ?? 0) > 0);
    }
    case 'clear':
      return clearsOf(save, cond.zone, cond.difficulty) > 0;
    case 'boss':
      return (st.bossKills[cond.boss] ?? 0) > 0;
    case 'metin':
      return (st.metinKinds[cond.metin] ?? 0) > 0;
    case 'class':
      return st.classes[cond.classId].runs > 0;
    case 'level':
      return st.bestLevel >= cond.n;
    case 'wins':
      return st.wins >= cond.n;
    case 'runs':
      return st.runs >= cond.n;
    case 'kills':
      return st.kills >= cond.n;
    case 'unknown':
      return false;
  }
}

/** Codex entry ids whose condition is met but not yet unlocked. */
export function newCodexUnlocks(save: SaveData, content: MetaContent): string[] {
  const have = new Set(save.unlocks.codex);
  return content.story.codex
    .filter((e) => !have.has(e.id) && codexConditionMet(save, parseCodexCondition(e.unlock)))
    .map((e) => e.id);
}

export interface CodexEntryView {
  entry: StoryDef['codex'][number];
  unlocked: boolean;
  /** parsed unlock rule (UI can render "defeat <boss>" hints for locked entries) */
  condition: CodexCondition;
}

/** Codex screen model: every entry in content order with its unlock state. */
export function codexEntries(save: SaveData, content: MetaContent): CodexEntryView[] {
  const have = new Set(save.unlocks.codex);
  return content.story.codex.map((entry) => {
    const condition = parseCodexCondition(entry.unlock);
    return { entry, unlocked: have.has(entry.id) || codexConditionMet(save, condition), condition };
  });
}

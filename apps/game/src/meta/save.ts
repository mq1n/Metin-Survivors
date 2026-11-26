// SaveData construction and repair. `newProfile` builds a fresh profile; `normalizeSave` turns ANY migrated JSON
// (disk, .msav import, cloud blob) into a valid SaveData by coercing types, clamping ranges and enforcing the
// gameplay rules (talent legality, gear ownership, unlock consistency) instead of rejecting the whole save.

import { isRecord } from '@ms/shared/api';
import type { ClassId, Difficulty } from '../data/schema';
import { GEAR_SLOTS } from '../data/schema';
import { defaultSettings, sanitizeSettings, type SettingsData } from '../engine/settings';
import { doctrineIdsOf, indexContent } from './content';
import { clampPlus, usableBy } from './gear';
import { randomId, systemRng } from './rng';
import { earnedPoints, sanitizeTreePoints, talentCap } from './talents';
import {
  CLASS_IDS,
  SAVE_VERSION,
  type ClassSave,
  type ClassStats,
  type MetaContent,
  type MetaRng,
  type SaveData,
  type SaveStats,
  type ZoneStats,
} from './types';
import { newCodexUnlocks, recomputeUnlocks } from './unlocks';

/**
 * The stored name of a profile nobody named. Every fresh profile (and every save of the first releases) carries it, so it is read as
 * "unnamed", never as a chosen name: the UI shows `profile.defaultName` in the player's language (isDefaultProfileName) and anything
 * public (leaderboard, co-op lobby) gets a name of its own (publicProfileName), so two unnamed players are never both "Kahraman".
 */
export const DEFAULT_PROFILE_NAME = 'Kahraman';
export const MAX_NAME_LENGTH = 24;
/** Sanity ceiling for banked currencies (keeps arithmetic exact in doubles). */
export const MAX_CURRENCY = 1_000_000_000_000;
const MAX_XP = 1_000_000_000;
const MAX_COLLECTION = 1000;

export function emptyClassSave(): ClassSave {
  return { xp: 0, talents: {}, gear: {}, collection: [], plus: {}, pity: 0 };
}

export function emptyZoneStats(): ZoneStats {
  return { runs: 0, clears: 0, bestScore: 0, bestTime: 0, bestLevel: 0 };
}

export function emptyStats(): SaveStats {
  const classes = {} as Record<ClassId, ClassStats>;
  for (const c of CLASS_IDS) classes[c] = { runs: 0, wins: 0, bestScore: 0 };
  return {
    runs: 0,
    wins: 0,
    deaths: 0,
    kills: 0,
    elites: 0,
    bosses: 0,
    metins: 0,
    playTime: 0,
    yeopEarned: 0,
    shardsEarned: 0,
    bestScore: 0,
    bestLevel: 0,
    zones: {},
    classes,
    bossKills: {},
    metinKinds: {},
    gearFound: 0,
    blacksmith: { attempts: 0, successes: 0, yeopSpent: 0, shardsSpent: 0 },
  };
}

export interface NewProfileOptions {
  name?: string;
  /** ms since epoch (default Date.now()) */
  now?: number;
  rng?: MetaRng;
  settings?: SettingsData;
}

/** Fresh profile: nothing owned, the first zone (by order) unlocked. */
export function newProfile(content: MetaContent, opts: NewProfileOptions = {}): SaveData {
  const now = opts.now ?? Date.now();
  const classes = {} as Record<ClassId, ClassSave>;
  for (const c of CLASS_IDS) classes[c] = emptyClassSave();
  const save: SaveData = {
    version: SAVE_VERSION,
    profile: { id: randomId(opts.rng ?? systemRng, 16), name: cleanName(opts.name), created: now, updated: now },
    classes,
    bank: { yeop: 0, shards: 0 },
    unlocks: { zones: [], hard: [], codex: [] },
    stats: emptyStats(),
    settings: opts.settings ?? defaultSettings(),
  };
  save.unlocks = recomputeUnlocks(save, content);
  save.unlocks.codex = newCodexUnlocks(save, content);
  return save;
}

/** True for a profile that was never named (see DEFAULT_PROFILE_NAME). */
export function isDefaultProfileName(name: string): boolean {
  return name === DEFAULT_PROFILE_NAME;
}

/**
 * The name this profile goes by online (leaderboard, co-op lobby, cloud identity): its own name, or for an unnamed profile
 * `Hero-XXXX` with 4 characters of the profile id, which tells two unnamed players apart. Not validated here (callers run
 * `validateDisplayName` and fall back to the server's default); a valid display name whenever the profile id is the usual id.
 */
export function publicProfileName(profile: { id: string; name: string }): string {
  if (!isDefaultProfileName(profile.name)) return profile.name;
  const tag = profile.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase().padEnd(4, '0');
  return `Hero-${tag}`;
}

function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.normalize('NFC').trim().slice(0, MAX_NAME_LENGTH).trim() : '';
  return s === '' ? DEFAULT_PROFILE_NAME : s;
}

// ---------------------------------------------------------------------------
// Coercion helpers

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  return Math.floor(num(v, min, max, fallback));
}

function strings(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  for (const s of v) {
    if (typeof s === 'string' && s !== '' && s.length <= 64) seen.add(s);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** id -> positive integer count record (bestiary-style), capped in size. */
function countRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [id, n] of Object.entries(v).slice(0, 256)) {
    const c = int(n, 0, 1e9, 0);
    if (c > 0) out[id] = c;
  }
  return out;
}

function zoneStats(raw: unknown): ZoneStats {
  const r = isRecord(raw) ? raw : {};
  return {
    runs: int(r.runs, 0, 1e9, 0),
    clears: int(r.clears, 0, 1e9, 0),
    bestScore: int(r.bestScore, 0, 1e12, 0),
    bestTime: num(r.bestTime, 0, 1e6, 0),
    bestLevel: int(r.bestLevel, 0, 1e4, 0),
  };
}

function normalizeStats(raw: unknown): SaveStats {
  const r = isRecord(raw) ? raw : {};
  const base = emptyStats();
  const zones: SaveStats['zones'] = {};
  if (isRecord(r.zones)) {
    for (const [zid, rec] of Object.entries(r.zones).slice(0, 64)) {
      if (!isRecord(rec)) continue;
      const entry: Partial<Record<Difficulty, ZoneStats>> = {};
      if (rec.normal !== undefined) entry.normal = zoneStats(rec.normal);
      if (rec.hard !== undefined) entry.hard = zoneStats(rec.hard);
      zones[zid] = entry;
    }
  }
  const classes = base.classes;
  if (isRecord(r.classes)) {
    for (const c of CLASS_IDS) {
      const rec = r.classes[c];
      if (!isRecord(rec)) continue;
      classes[c] = { runs: int(rec.runs, 0, 1e9, 0), wins: int(rec.wins, 0, 1e9, 0), bestScore: int(rec.bestScore, 0, 1e12, 0) };
    }
  }
  const bossKills = countRecord(r.bossKills);
  const metinKinds = countRecord(r.metinKinds);
  const bs = isRecord(r.blacksmith) ? r.blacksmith : {};
  return {
    runs: int(r.runs, 0, 1e9, 0),
    wins: int(r.wins, 0, 1e9, 0),
    deaths: int(r.deaths, 0, 1e9, 0),
    kills: int(r.kills, 0, 1e12, 0),
    elites: int(r.elites, 0, 1e12, 0),
    bosses: int(r.bosses, 0, 1e9, 0),
    metins: int(r.metins, 0, 1e9, 0),
    playTime: num(r.playTime, 0, 1e10, 0),
    yeopEarned: int(r.yeopEarned, 0, MAX_CURRENCY, 0),
    shardsEarned: int(r.shardsEarned, 0, MAX_CURRENCY, 0),
    bestScore: int(r.bestScore, 0, 1e12, 0),
    bestLevel: int(r.bestLevel, 0, 1e4, 0),
    zones,
    classes,
    bossKills,
    metinKinds,
    gearFound: int(r.gearFound, 0, 1e9, 0),
    blacksmith: {
      attempts: int(bs.attempts, 0, 1e9, 0),
      successes: int(bs.successes, 0, 1e9, 0),
      yeopSpent: int(bs.yeopSpent, 0, MAX_CURRENCY, 0),
      shardsSpent: int(bs.shardsSpent, 0, MAX_CURRENCY, 0),
    },
  };
}

function normalizeClass(raw: unknown, classId: ClassId, content: MetaContent, repairs: string[], cap: number): ClassSave {
  const r = isRecord(raw) ? raw : {};
  const idx = indexContent(content);
  const out = emptyClassSave();
  out.xp = num(r.xp, 0, MAX_XP, 0);
  out.pity = int(r.pity, 0, 1000, 0);

  // collection (unknown ids are kept: they may belong to a newer content version), then +N levels
  out.collection = strings(r.collection, MAX_COLLECTION);
  if (isRecord(r.plus)) {
    for (const id of out.collection) {
      const p = clampPlus(typeof r.plus[id] === 'number' ? r.plus[id] : 0);
      if (p > 0) out.plus[id] = p;
    }
  }

  // equipped: must be owned, known, in the right slot and usable by this class
  if (isRecord(r.gear)) {
    for (const slot of GEAR_SLOTS) {
      const id = r.gear[slot];
      if (typeof id !== 'string') continue;
      const def = idx.gear.get(id);
      if (def && def.slot === slot && usableBy(def, classId) && out.collection.includes(id)) out.gear[slot] = id;
      else repairs.push(`${classId}: dropped invalid equipped ${slot}=${id}`);
    }
  }

  // talents: legal subset within the earned budget, both trees share it (tree a first); `cap` is the profile's talent
  // cap (40 + 2 per zone cleared on Hard, MT-02) taken from the SANITISED stats, so Hard-clear points survive a reload
  let budget = earnedPoints(out, cap);
  const rawTalents = isRecord(r.talents) ? r.talents : {};
  for (const did of doctrineIdsOf(classId)) {
    const tree = idx.trees.get(did);
    const rawTree = rawTalents[did];
    if (!tree || !isRecord(rawTree)) continue;
    const { points, used } = sanitizeTreePoints(tree, rawTree, budget);
    budget -= used;
    if (used > 0) out.talents[did] = points;
    const asked = Object.values(rawTree).reduce<number>((s, v) => s + (typeof v === 'number' && v > 0 ? Math.floor(v) : 0), 0);
    if (asked !== used) repairs.push(`${classId}: talents ${did} clamped ${asked}→${used}`);
  }
  return out;
}

export interface NormalizeOptions {
  now?: number;
  rng?: MetaRng;
  /** receives human-readable notes about repairs (diagnostics only) */
  repairs?: string[];
}

/**
 * Builds a valid SaveData from migrated JSON. Never throws on shape problems (fields fall back to defaults);
 * callers reject non-objects / version problems before this (migrateSave).
 */
export function normalizeSave(raw: unknown, content: MetaContent, opts: NormalizeOptions = {}): SaveData {
  const r = isRecord(raw) ? raw : {};
  const repairs = opts.repairs ?? [];
  const now = opts.now ?? Date.now();
  const rng = opts.rng ?? systemRng;
  const prof = isRecord(r.profile) ? r.profile : {};
  const created = num(prof.created, 0, 8.64e15, now);
  const classesRaw = isRecord(r.classes) ? r.classes : {};
  // stats first: the talent cap (and so the points a class may hold) derives from the sanitised zone stats
  const stats = normalizeStats(r.stats);
  const cap = talentCap({ stats });
  const classes = {} as Record<ClassId, ClassSave>;
  for (const c of CLASS_IDS) classes[c] = normalizeClass(classesRaw[c], c, content, repairs, cap);
  const bank = isRecord(r.bank) ? r.bank : {};
  const unl = isRecord(r.unlocks) ? r.unlocks : {};
  const save: SaveData = {
    version: SAVE_VERSION,
    profile: {
      id: typeof prof.id === 'string' && prof.id !== '' && prof.id.length <= 64 ? prof.id : randomId(rng, 16),
      name: cleanName(prof.name),
      created,
      updated: num(prof.updated, 0, 8.64e15, created),
    },
    classes,
    bank: { yeop: int(bank.yeop, 0, MAX_CURRENCY, 0), shards: int(bank.shards, 0, MAX_CURRENCY, 0) },
    unlocks: { zones: strings(unl.zones, 64), hard: strings(unl.hard, 64), codex: strings(unl.codex, 1000) },
    stats,
    settings: sanitizeSettings(r.settings),
  };
  save.unlocks = recomputeUnlocks(save, content);
  save.unlocks.codex = [...save.unlocks.codex, ...newCodexUnlocks(save, content)];
  return save;
}

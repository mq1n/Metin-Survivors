// Save migrations. A save carries `version`; `migrateSave` walks MIGRATIONS[version] → version+1 until the current
// SAVE_VERSION. Steps operate on untyped JSON and must be pure; shape/range repair is `normalizeSave`'s job
// (save.ts), so a step only has to translate the structure that changed.

import { isRecord } from '@ms/shared/api';
import { SaveError } from './errors';
import { SAVE_VERSION } from './types';

export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Key = the version a step upgrades FROM. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  0: migrateV0toV1,
};

/** Missing / non-numeric version counts as 0 (the pre-versioned ARCHITECTURE §9 draft shape). */
export function detectVersion(raw: unknown): number {
  if (!isRecord(raw)) return 0;
  const v = raw.version;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * Upgrades `raw` to `target`. Throws SaveError('tooNew') for saves from a newer build and
 * SaveError('noMigration') when a step is missing. Input is never mutated.
 */
export function migrateSave(
  raw: unknown,
  target: number = SAVE_VERSION,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): Record<string, unknown> {
  if (!isRecord(raw)) throw new SaveError('format', 'save is not an object');
  let version = detectVersion(raw);
  if (version > target) throw new SaveError('tooNew', `save version ${version} is newer than supported ${target}`);
  let cur: Record<string, unknown> = structuredClone(raw);
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new SaveError('noMigration', `no migration from version ${version}`);
    cur = step(cur);
    version += 1;
    cur.version = version;
  }
  return cur;
}

// ---------------------------------------------------------------------------
// v0 → v1
// v0 = ARCHITECTURE §9 draft: profile{ id, name, created }, classes[c].gear = Record<slot, { id, plus }>, collection: string[].
// v1 keeps `gear` as slot → gear id and moves the +N level into the per-class `plus` map (so a piece keeps its
// level when unequipped), adds `profile.updated`, `pity`, and the stats/bank defaults.

function migrateV0toV1(raw: Record<string, unknown>): Record<string, unknown> {
  const out = raw;
  const profile = isRecord(out.profile) ? out.profile : {};
  if (typeof profile.updated !== 'number') profile.updated = typeof profile.created === 'number' ? profile.created : 0;
  out.profile = profile;

  if (isRecord(out.classes)) {
    for (const cls of Object.values(out.classes)) {
      if (!isRecord(cls)) continue;
      const plus: Record<string, unknown> = isRecord(cls.plus) ? cls.plus : {};
      const collection: unknown[] = Array.isArray(cls.collection) ? cls.collection : [];
      const equipped: Record<string, unknown> = {};
      if (isRecord(cls.gear)) {
        for (const [slot, ref] of Object.entries(cls.gear)) {
          if (typeof ref === 'string') {
            equipped[slot] = ref;
            if (!collection.includes(ref)) collection.push(ref);
          } else if (isRecord(ref) && typeof ref.id === 'string') {
            equipped[slot] = ref.id;
            if (!collection.includes(ref.id)) collection.push(ref.id);
            if (typeof ref.plus === 'number' && ref.plus > 0 && plus[ref.id] === undefined) plus[ref.id] = ref.plus;
          }
        }
      }
      cls.gear = equipped;
      cls.collection = collection;
      cls.plus = plus;
      if (typeof cls.pity !== 'number') cls.pity = 0;
    }
  }
  if (!isRecord(out.bank)) out.bank = { yeop: 0, shards: 0 };
  return out;
}

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { content, validateContent } from './loader';
import { applyContentOverride, applyContentOverrideDetailed, ContentOverrideError, describeOverride, readOverrideArg } from './override';
import type { ContentDB } from './schema';

/** a private copy per test: the shared `content` module is never touched */
function fresh(): ContentDB {
  return structuredClone(content);
}

const snap = (db: ContentDB): string => JSON.stringify(db);

function rejected(fn: () => unknown): ContentOverrideError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ContentOverrideError);
    return e as ContentOverrideError;
  }
  throw new Error('expected the override to be rejected');
}

describe('applyContentOverride: merge', () => {
  it('merges an array of objects by id, leaving the other items and fields alone', () => {
    const db = fresh();
    const before = structuredClone(db.zones.find((z) => z.id === 'yeonmu')!);
    const others = snap({ ...db, zones: db.zones.filter((z) => z.id !== 'yeonmu') } as ContentDB);
    const paths = applyContentOverride(db, { zones: [{ id: 'yeonmu', metins: { firstAt: 20 } }] });
    expect(paths).toEqual(['zones[id=yeonmu].metins.firstAt']);
    const z = db.zones.find((x) => x.id === 'yeonmu')!;
    expect(z.metins.firstAt).toBe(20);
    expect(before.metins.firstAt).not.toBe(20);
    expect(z.metins.types).toEqual(before.metins.types);
    expect(z.metins.interval).toEqual(before.metins.interval);
    expect(snap({ ...db, zones: db.zones.filter((x) => x.id !== 'yeonmu') } as ContentDB)).toBe(others);
    expect(db.zones.map((x) => x.id)).toEqual(content.zones.map((x) => x.id));
    expect(validateContent(db).errors).toEqual([]);
  });

  it('merges objects recursively and returns every changed path in patch order', () => {
    const db = fresh();
    expect(db.balance.chestCost.base).toBe(15);
    const paths = applyContentOverride(db, { balance: { chestCost: { perOpen: 200 }, armorK: 120 }, zones: [{ id: 'yeonmu', metins: { firstAt: 25 } }] });
    expect(paths).toEqual(['balance.chestCost.perOpen', 'balance.armorK', 'zones[id=yeonmu].metins.firstAt']);
    expect(db.balance.chestCost).toEqual({ base: 15, perOpen: 200 });
    expect(db.balance.armorK).toBe(120);
  });

  it('keeps the identity of the objects other modules already hold (the merge runs in place)', () => {
    const db = fresh();
    const balance = db.balance;
    const chestCost = db.balance.chestCost;
    const zone = db.zones[0]!;
    const zones = db.zones;
    applyContentOverride(db, { balance: { chestCost: { perOpen: 77 } }, zones: [{ id: zone.id, metins: { firstAt: 33 } }] });
    expect(db.balance).toBe(balance);
    expect(db.balance.chestCost).toBe(chestCost);
    expect(db.zones).toBe(zones);
    expect(db.zones[0]).toBe(zone);
    expect(chestCost.perOpen).toBe(77);
    expect(zone.metins.firstAt).toBe(33);
  });

  it('reports no path (and changes nothing) for a value that is already there', () => {
    const db = fresh();
    const before = snap(db);
    expect(applyContentOverride(db, { balance: { chestCost: { perOpen: db.balance.chestCost.perOpen } } })).toEqual([]);
    expect(applyContentOverride(db, { zones: [{ id: 'yeonmu', metins: { interval: db.zones[0]!.metins.interval } }] })).toEqual([]);
    expect(applyContentOverride(db, {})).toEqual([]);
    expect(snap(db)).toBe(before);
  });

  it('replaces arrays that are not arrays of id objects (pairs, string lists) instead of merging them', () => {
    const db = fresh();
    const z0 = db.zones.find((z) => z.id === 'yeonmu')!;
    const oneType = z0.metins.types.slice(0, 1);
    const paths = applyContentOverride(db, { zones: [{ id: 'yeonmu', metins: { interval: [30, 40], types: oneType } }] });
    expect(paths).toEqual(['zones[id=yeonmu].metins.interval', 'zones[id=yeonmu].metins.types']);
    expect(z0.metins.interval).toEqual([30, 40]);
    expect(z0.metins.types).toEqual(oneType);
  });

  it('adds a key that the content does not have (how an optional system is switched on) and marks it added', () => {
    const db = fresh();
    const r = applyContentOverrideDetailed(db, { balance: { qaSwitch: { on: true, n: 3 } } });
    expect(r.paths).toEqual(['balance.qaSwitch']);
    expect(r.added).toEqual(['balance.qaSwitch']);
    expect(r.deleted).toEqual([]);
    expect((db.balance as unknown as Record<string, unknown>).qaSwitch).toEqual({ on: true, n: 3 });
    expect(describeOverride(r)).toBe('1 change: balance.qaSwitch (+)');
  });

  it('does not share objects with the patch (the patch can be reused and edited afterwards)', () => {
    const db = fresh();
    const patch = { balance: { qaSwitch: { list: [1, 2] } } };
    applyContentOverride(db, patch);
    patch.balance.qaSwitch.list.push(3);
    expect((db.balance as unknown as { qaSwitch: { list: number[] } }).qaSwitch.list).toEqual([1, 2]);
  });
});

describe('applyContentOverride: null deletes a key', () => {
  it('removes an added key again and lists it as deleted', () => {
    const db = fresh();
    applyContentOverride(db, { balance: { qaSwitch: 1, qaOther: 2 } });
    const r = applyContentOverrideDetailed(db, { balance: { qaSwitch: null } });
    expect(r.paths).toEqual(['balance.qaSwitch']);
    expect(r.deleted).toEqual(['balance.qaSwitch']);
    expect('qaSwitch' in db.balance).toBe(false);
    expect((db.balance as unknown as Record<string, unknown>).qaOther).toBe(2);
    expect(describeOverride(r)).toBe('1 change: balance.qaSwitch (-)');
  });

  it('deleting a key that is not there is a quiet no-op', () => {
    const db = fresh();
    expect(applyContentOverride(db, { balance: { notThere: null } })).toEqual([]);
  });

  it('deleting a key the content needs is rejected by the validator with a named error and the DB is untouched', () => {
    const db = fresh();
    const before = snap(db);
    const e = rejected(() => applyContentOverride(db, { balance: { chestCost: null } }));
    expect(e.errors).toHaveLength(1);
    expect(e.errors[0]).toMatch(/^content: validation threw .*balance\.chestCost \(-\)/);
    expect(snap(db)).toBe(before);
  });

  it('refuses to delete a whole top-level collection', () => {
    const db = fresh();
    const before = snap(db);
    const e = rejected(() => applyContentOverride(db, { zones: null }));
    expect(e.errors).toEqual(['override.zones: a top-level collection cannot be deleted']);
    expect(snap(db)).toBe(before);
  });
});

describe('applyContentOverride: rejections (named errors, the live DB untouched)', () => {
  it('rejects an unknown top-level key and names it with the known keys', () => {
    const db = fresh();
    const before = snap(db);
    const e = rejected(() => applyContentOverride(db, { zonez: [], balance: { armorK: 120 } }));
    expect(e.errors).toHaveLength(1);
    expect(e.errors[0]).toMatch(/^override\.zonez: unknown top-level key \(known: .*zones.*balance/);
    expect(e.message).toContain('content override rejected (1 error)');
    expect(snap(db)).toBe(before);
  });

  it('rejects a patch that is not a JSON object', () => {
    const db = fresh();
    for (const bad of [null, undefined, 3, 'x', [], [{ id: 'yeonmu' }]]) {
      const e = rejected(() => applyContentOverride(db, bad));
      expect(e.errors[0]).toMatch(/^override: the patch must be a JSON object \(got /);
    }
  });

  it('rejects a value the validator refuses and names the zone', () => {
    const db = fresh();
    const before = snap(db);
    const e = rejected(() => applyContentOverride(db, { zones: [{ id: 'yeonmu', metins: { firstAt: -1 } }] }));
    expect(e.errors.some((x) => x.includes('yeonmu') && x.includes('metins timing'))).toBe(true);
    expect(snap(db)).toBe(before);
    const e2 = rejected(() => applyContentOverride(db, { zones: [{ id: 'yeonmu', metins: { interval: [9, 3] } }] }));
    expect(e2.errors.some((x) => x.includes('metins timing'))).toBe(true);
    expect(snap(db)).toBe(before);
  });

  it('rejects an out-of-range balance value after the merge succeeded in the clone, with the DB untouched', () => {
    const db = fresh();
    const before = snap(db);
    const e = rejected(() => applyContentOverride(db, { balance: { chestCost: { perOpen: 5 }, armorK: -4 } }));
    expect(e.errors).toEqual(['balance: armorK invalid']);
    expect(db.balance.chestCost.perOpen).toBe(content.balance.chestCost.perOpen);
    expect(snap(db)).toBe(before);
  });

  it('rejects a kind change (number -> string, object -> array) with the path', () => {
    const db = fresh();
    const before = snap(db);
    const e = rejected(() => applyContentOverride(db, { zones: [{ id: 'yeonmu', metins: { firstAt: 'soon' } }], balance: { chestCost: [1, 2] } }));
    expect(e.errors).toContain('zones[id=yeonmu].metins.firstAt: cannot change a number into a string');
    expect(e.errors).toContain('balance.chestCost: cannot change a object into a array');
    expect(snap(db)).toBe(before);
  });

  it('rejects an unknown id in an id array when the new item is not a complete valid one, with the DB untouched', () => {
    const db = fresh();
    const before = snap(db);
    const e = rejected(() => applyContentOverride(db, { zones: [{ id: 'nowhere', metins: { firstAt: 20 } }] }));
    expect(e.errors.length).toBeGreaterThan(0);
    expect(e.errors.some((x) => x.includes('zones[id=nowhere] (+)'))).toBe(true);
    expect(db.zones.some((z) => z.id === 'nowhere')).toBe(false);
    expect(snap(db)).toBe(before);
  });

  it('refuses __proto__ / constructor / prototype keys (no prototype pollution) and non-JSON values', () => {
    const db = fresh();
    const before = snap(db);
    const evil = JSON.parse('{"balance":{"__proto__":{"polluted":1},"constructor":{"x":1}}}') as unknown;
    const e = rejected(() => applyContentOverride(db, evil));
    expect(e.errors).toEqual(["balance.__proto__: the key '__proto__' is not allowed", "balance.constructor: the key 'constructor' is not allowed"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const e2 = rejected(() => applyContentOverride(db, { balance: { armorK: Number.NaN, fn: () => 1, u: undefined } }));
    expect(e2.errors.map((x) => x.split(':')[0])).toEqual(['balance.armorK', 'balance.fn', 'balance.u']);
    expect(snap(db)).toBe(before);
  });

  it('collects every named problem of one patch in a single error', () => {
    const db = fresh();
    const e = rejected(() => applyContentOverride(db, { aaa: {}, bbb: {}, balance: { armorK: Number.POSITIVE_INFINITY } }));
    expect(e.errors).toHaveLength(3);
  });

  it('only counts errors the override adds: a content that already had an error still takes a valid override', () => {
    const db = fresh();
    db.balance.armorK = -1; // an existing error
    expect(validateContent(db).errors).toContain('balance: armorK invalid');
    expect(applyContentOverride(db, { balance: { chestCost: { perOpen: 99 } } })).toEqual(['balance.chestCost.perOpen']);
    const e = rejected(() => applyContentOverride(db, { balance: { enemyHpPerMin: -1 } }));
    expect(e.errors).toEqual(['balance: enemyHpPerMin invalid']);
    expect(db.balance.chestCost.perOpen).toBe(99);
  });
});

// the reason this module exists: systems that ship switched off in content (A0-DATA: run events, affixes) are switched on by a patch
describe.runIf('runEvents' in content && 'affixes' in content)('applyContentOverride: switching on systems that ship off', () => {
  it('lists run events for a zone and enables affixes, leaving every other value alone', () => {
    const db = fresh();
    expect(Object.keys(db.runEvents?.zones ?? {})).toEqual([]);
    const paths = applyContentOverride(db, { runEvents: { zones: { yeonmu: ['metinRain', 'goldenHour'] } }, affixes: { enabled: true, weights: { swift: 9 } } });
    expect(paths).toEqual(['runEvents.zones.yeonmu', 'affixes.enabled', 'affixes.weights.swift']);
    expect(db.runEvents?.zones).toEqual({ yeonmu: ['metinRain', 'goldenHour'] });
    expect(db.affixes?.enabled).toBe(true);
    expect(db.affixes?.weights.swift).toBe(9);
    expect(db.affixes?.weights.vampiric).toBe(content.affixes?.weights.vampiric);
    expect(db.runEvents?.kinds).toEqual(content.runEvents?.kinds);
    expect(validateContent(db).errors).toEqual([]);
  });

  it('names an unknown event kind or zone, and the live content stays as it was', () => {
    const db = fresh();
    const before = snap(db);
    const e = rejected(() => applyContentOverride(db, { runEvents: { zones: { yeonmu: ['metinRain', 'nope'], nowhere: ['metinRain'] } } }));
    expect(e.errors.some((x) => x.includes('runEvents.zones.yeonmu') && x.includes("unknown event kind 'nope'"))).toBe(true);
    expect(e.errors.some((x) => x.includes("unknown zone 'nowhere'"))).toBe(true);
    expect(snap(db)).toBe(before);
  });
});

describe('readOverrideArg', () => {
  it('parses inline JSON', () => {
    expect(readOverrideArg('{"zones":[{"id":"yeonmu","metins":{"firstAt":20}}]}')).toEqual({ zones: [{ id: 'yeonmu', metins: { firstAt: 20 } }] });
    expect(readOverrideArg('  {"a":1}  ')).toEqual({ a: 1 });
  });

  it('reads @<file> through the reader it is given (and strips a BOM)', () => {
    const seen: string[] = [];
    const v = readOverrideArg('@some/dir/f.json', (p) => {
      seen.push(p);
      return '﻿{"balance":{"armorK":120}}';
    });
    expect(seen).toEqual(['some/dir/f.json']);
    expect(v).toEqual({ balance: { armorK: 120 } });
  });

  it('reads @<file> from the disk by default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-override-'));
    try {
      const f = join(dir, 'o.json');
      writeFileSync(f, '{"balance":{"chestCost":{"perOpen":200}}}');
      expect(readOverrideArg(`@${f}`)).toEqual({ balance: { chestCost: { perOpen: 200 } } });
      expect(() => readOverrideArg(`@${join(dir, 'missing.json')}`)).toThrow(/cannot read/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid JSON, a bare @, and anything that is not a JSON object, with a named error', () => {
    expect(rejected(() => readOverrideArg('{"a":')).errors[0]).toMatch(/^override: the argument is not valid JSON/);
    expect(rejected(() => readOverrideArg('@x.json', () => 'nope')).errors[0]).toMatch(/^override: 'x\.json' is not valid JSON/);
    expect(rejected(() => readOverrideArg('@')).errors[0]).toContain('needs a file path');
    expect(rejected(() => readOverrideArg('[1,2]')).errors[0]).toBe('override: the patch must be a JSON object (got array)');
    expect(rejected(() => readOverrideArg('3')).errors[0]).toBe('override: the patch must be a JSON object (got number)');
    expect(rejected(() => readOverrideArg('null')).errors[0]).toBe('override: the patch must be a JSON object (got null)');
  });

  it('a parsed override applies end to end (the soak / shot.ts path)', () => {
    const db = fresh();
    const patch = readOverrideArg('{"balance":{"chestCost":{"perOpen":200}}}');
    expect(applyContentOverride(db, patch)).toEqual(['balance.chestCost.perOpen']);
    expect(db.balance.chestCost.perOpen).toBe(200);
  });
});

describe('app/content.ts: the DEV / QA hook (globalThis.__MS_CONTENT_OVERRIDE__ before boot)', () => {
  const g = globalThis as { __MS_CONTENT_OVERRIDE__?: unknown };

  /** a fresh module graph per case: app/content.ts caches the first load and the loader holds the one shared database */
  async function boot(): Promise<ContentDB> {
    vi.resetModules();
    const m = await import('../app/content');
    return m.loadContent();
  }

  afterEach(() => {
    delete g.__MS_CONTENT_OVERRIDE__;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('applies an object override once to the content loadContent() returns and logs the changed paths', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    g.__MS_CONTENT_OVERRIDE__ = { zones: [{ id: 'yeonmu', metins: { firstAt: 20 } }], balance: { chestCost: { perOpen: 200 } } };
    const db = await boot();
    expect(db.zones.find((z) => z.id === 'yeonmu')?.metins.firstAt).toBe(20);
    expect(db.balance.chestCost.perOpen).toBe(200);
    expect(content.balance.chestCost.perOpen).not.toBe(200); // the module graph of this file's other tests is untouched
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toContain('zones[id=yeonmu].metins.firstAt, balance.chestCost.perOpen');
  });

  it('accepts the override as JSON text too', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    g.__MS_CONTENT_OVERRIDE__ = '{"balance":{"chestCost":{"perOpen":150}}}';
    expect((await boot()).balance.chestCost.perOpen).toBe(150);
  });

  it('leaves the content alone and logs nothing when no override is set', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const db = await boot();
    expect(db.balance.chestCost.perOpen).toBe(content.balance.chestCost.perOpen);
    expect(db.zones.find((z) => z.id === 'yeonmu')?.metins.firstAt).toBe(content.zones.find((z) => z.id === 'yeonmu')?.metins.firstAt);
    expect(info).not.toHaveBeenCalled();
  });

  it('fails the content load loudly with the named errors when the override is invalid', async () => {
    g.__MS_CONTENT_OVERRIDE__ = { balance: { chestCost: { perOpen: 'free' } } };
    await expect(boot()).rejects.toThrow(/content override rejected.*balance\.chestCost\.perOpen: cannot change a number into a string/s);
  });
});

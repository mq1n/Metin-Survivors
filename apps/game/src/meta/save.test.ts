import { describe, expect, it } from 'vitest';
import { fixtureContent } from './__fixtures__/content';
import { NOW, freshSave, makeRun } from './__fixtures__/testkit';
import { SaveError, checksum } from './errors';
import { MIGRATIONS, detectVersion, migrateSave, type Migration } from './migrations';
import { MSAV_MAGIC, MSAV_MAX_CHARS, exportMsav, importMsav, msavFileName } from './msav';
import { grantGear } from './gear';
import { seededRng } from './rng';
import { validateDisplayName } from '@ms/shared/api';
import { DEFAULT_PROFILE_NAME, isDefaultProfileName, newProfile, normalizeSave, publicProfileName } from './save';
import { settleRun } from './settle';
import { treePointsOf, xpForPoints } from './talents';
import { SAVE_VERSION, type SaveData } from './types';

const C = fixtureContent;

/** A save that has been played: drops, bank, stats, unlocks, unicode name. */
function playedSave(): SaveData {
  let s = newProfile(C, { now: NOW, rng: seededRng(3), name: 'Şaman Ğ' });
  const rng = seededRng(11);
  for (const [zone, victory] of [['yeonmu', true], ['suryeon', false]] as const) {
    s = settleRun(s, C, makeRun({ zone, victory, classId: 'ninja', bossesKilled: [`${zone}_boss1`], yeopLeft: 5000, shards: 30 }), rng, NOW + 1).save;
  }
  for (const id of ['yeonmu_weapon_ninja', 'yeonmu_necklace']) {
    const g = grantGear(s, C, 'ninja', id);
    if (g.ok) s = g.save;
  }
  s.classes.ninja.plus.yeonmu_weapon_ninja = 4;
  return s;
}

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');
const msavOf = (json: string, version: number, sum = checksum(json)): string => `${MSAV_MAGIC}.${version}.${sum}.${b64(json)}`;

describe('newProfile', () => {
  it('builds a valid empty profile at the current version', () => {
    const s = freshSave();
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.profile).toMatchObject({ name: 'Tester', created: NOW, updated: NOW });
    expect(s.profile.id).toHaveLength(16);
    expect(Object.keys(s.classes).sort()).toEqual(['ninja', 'shaman', 'warrior', 'wolfman', 'yacha']);
    expect(s.classes.warrior).toEqual({ xp: 0, talents: {}, gear: {}, collection: [], plus: {}, pity: 0 });
    expect(s.bank).toEqual({ yeop: 0, shards: 0 });
    expect(s.unlocks).toEqual({ zones: ['yeonmu'], hard: [], codex: ['codex_start'] });
    expect(s.stats.runs).toBe(0);
    expect(s.settings).toMatchObject({ quality: 'auto' });
  });

  it('is deterministic for a seeded rng and cleans the name', () => {
    expect(newProfile(C, { now: 1, rng: seededRng(5) })).toEqual(newProfile(C, { now: 1, rng: seededRng(5) }));
    expect(newProfile(C, { now: 1, name: '   ' }).profile.name).toBe(DEFAULT_PROFILE_NAME);
    expect(newProfile(C, { now: 1, name: 'x'.repeat(100) }).profile.name).toHaveLength(24);
  });
});

describe('profile names (QA EXPLORER-1)', () => {
  it('a profile nobody named is recognised as unnamed, a chosen name is not', () => {
    expect(isDefaultProfileName(newProfile(C, { now: 1 }).profile.name)).toBe(true);
    expect(isDefaultProfileName(newProfile(C, { now: 1, name: 'Ejder' }).profile.name)).toBe(false);
  });

  it('online, an unnamed profile gets its own valid name: Hero-XXXX from the profile id, different per profile', () => {
    const names = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const p = newProfile(C, { now: 1, rng: seededRng(seed) }).profile;
      const pub = publicProfileName(p);
      expect(pub).toMatch(/^Hero-[A-Z0-9]{4}$/);
      expect(validateDisplayName(pub).ok, pub).toBe(true);
      names.add(pub);
    }
    expect(names.size).toBeGreaterThan(35); // 4 id characters: a clash is rare, never "everybody is the same"
    expect(publicProfileName({ id: '', name: DEFAULT_PROFILE_NAME })).toBe('Hero-0000');
    expect(publicProfileName({ id: 'a_-b', name: DEFAULT_PROFILE_NAME })).toBe('Hero-AB00');
  });

  it('a chosen name is the online name as it is', () => {
    expect(publicProfileName({ id: 'abcdefgh', name: 'Ejder' })).toBe('Ejder');
  });
});

describe('normalizeSave', () => {
  it('is idempotent on a valid, played save (JSON round trip)', () => {
    const s = playedSave();
    const once = normalizeSave(JSON.parse(JSON.stringify(s)), C, { now: NOW });
    expect(once).toEqual(s);
    expect(normalizeSave(JSON.parse(JSON.stringify(once)), C, { now: NOW })).toEqual(once);
  });

  it('turns garbage into a valid profile instead of throwing', () => {
    for (const junk of [null, undefined, 42, 'x', [], {}, { classes: 5, bank: 'x', stats: [] }]) {
      const s = normalizeSave(junk, C, { now: NOW, rng: seededRng(1) });
      expect(s.version).toBe(SAVE_VERSION);
      expect(s.bank).toEqual({ yeop: 0, shards: 0 });
      expect(s.unlocks.zones).toEqual(['yeonmu']);
      expect(Object.keys(s.classes)).toHaveLength(5);
    }
  });

  it('clamps numbers: negatives, NaN, floats, absurd values', () => {
    const raw = JSON.parse(JSON.stringify(freshSave()));
    raw.bank = { yeop: -5, shards: 12.9 };
    raw.classes.warrior.xp = 1e300;
    raw.classes.warrior.pity = -3;
    raw.stats.runs = 'many';
    raw.stats.kills = 7.8;
    raw.profile.updated = 'yesterday';
    const s = normalizeSave(raw, C, { now: NOW });
    expect(s.bank).toEqual({ yeop: 0, shards: 12 });
    expect(s.classes.warrior.xp).toBe(1_000_000_000);
    expect(s.classes.warrior.pity).toBe(0);
    expect(s.stats.runs).toBe(0);
    expect(s.stats.kills).toBe(7);
    expect(s.profile.updated).toBe(s.profile.created);
  });

  it('enforces talent legality and the shared point budget (tree a fills first)', () => {
    const raw = JSON.parse(JSON.stringify(freshSave()));
    raw.classes.warrior.xp = xpForPoints(4);
    raw.classes.warrior.talents = {
      warrior_a: { r0c0: 3, r0c1: 3, r4c0: 3, ghost: 9 },
      warrior_b: { r0c0: 3 },
    };
    const repairs: string[] = [];
    const s = normalizeSave(raw, C, { repairs });
    expect(treePointsOf(s.classes.warrior, 'warrior_a')).toEqual({ r0c0: 3, r0c1: 1 });
    expect(treePointsOf(s.classes.warrior, 'warrior_b')).toEqual({});
    expect(repairs.some((r) => r.includes('warrior_a'))).toBe(true);
  });

  it('keeps only equippable gear; keeps unknown ids in the collection; plus only for owned, clamped', () => {
    const raw = JSON.parse(JSON.stringify(freshSave()));
    const w = raw.classes.warrior;
    w.collection = ['yeonmu_weapon_warrior', 'yeonmu_armor_warrior', 'future_item', 'yeonmu_weapon_ninja'];
    w.gear = {
      weapon: 'yeonmu_weapon_warrior',
      armor: 'suryeon_armor_warrior', // not owned
      helmet: 'yeonmu_weapon_warrior', // wrong slot
      shield: 'yeonmu_weapon_ninja', // wrong class
      shoes: 'future_item', // unknown def
      bracelet: 7,
    };
    w.plus = { yeonmu_weapon_warrior: 99, yeonmu_armor_warrior: -2, future_item: 3, not_owned: 5 };
    const s = normalizeSave(raw, C);
    expect(s.classes.warrior.gear).toEqual({ weapon: 'yeonmu_weapon_warrior' });
    expect(s.classes.warrior.collection).toEqual(['yeonmu_weapon_warrior', 'yeonmu_armor_warrior', 'future_item', 'yeonmu_weapon_ninja']);
    expect(s.classes.warrior.plus).toEqual({ yeonmu_weapon_warrior: 9, future_item: 3 });
  });

  it('sanitises settings through the Engine sanitizer', () => {
    const raw = JSON.parse(JSON.stringify(freshSave()));
    raw.settings = { masterVolume: 7, quality: 'ultra', language: 'xx', showFps: 'yes' };
    const s = normalizeSave(raw, C);
    expect(s.settings).toMatchObject({ masterVolume: 1, quality: 'ultra', showFps: false });
    expect(['tr', 'en']).toContain(s.settings.language);
  });
});

describe('migrations', () => {
  const v0 = () => ({
    profile: { id: 'abc', name: 'Old Timer', created: 123 },
    classes: {
      warrior: {
        xp: 500,
        talents: { warrior_a: { r0c0: 2 } },
        gear: { weapon: { id: 'yeonmu_weapon_warrior', plus: 4 }, armor: { id: 'yeonmu_armor_warrior', plus: 0 } },
        collection: ['yeonmu_weapon_warrior', 'suryeon_weapon_warrior'],
      },
    },
    bank: { yeop: 900, shards: 3 },
    unlocks: { zones: ['yeonmu'], hard: [], codex: [] },
  });

  it('detects versions', () => {
    expect(detectVersion(v0())).toBe(0);
    expect(detectVersion({ version: 3 })).toBe(3);
    expect(detectVersion({ version: -1 })).toBe(0);
    expect(detectVersion({ version: '2' })).toBe(0);
    expect(detectVersion(null)).toBe(0);
  });

  it('v0 (ARCHITECTURE §9 draft) → v1: equipped {id,plus} becomes id + per-piece plus map', () => {
    const input = v0();
    const frozen = structuredClone(input);
    const out = migrateSave(input) as ReturnType<typeof v0> & { version: number };
    expect(input).toEqual(frozen); // not mutated
    expect(out.version).toBe(1);
    expect(out.profile).toMatchObject({ id: 'abc', created: 123, updated: 123 });
    const w = out.classes.warrior as unknown as { gear: Record<string, string>; plus: Record<string, number>; collection: string[]; pity: number };
    expect(w.gear).toEqual({ weapon: 'yeonmu_weapon_warrior', armor: 'yeonmu_armor_warrior' });
    expect(w.plus).toEqual({ yeonmu_weapon_warrior: 4 });
    expect(w.collection).toEqual(['yeonmu_weapon_warrior', 'suryeon_weapon_warrior', 'yeonmu_armor_warrior']);
    expect(w.pity).toBe(0);
  });

  it('v0 → normalized SaveData keeps progress (full load path)', () => {
    const s = normalizeSave(migrateSave(v0()), C, { now: NOW });
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.profile.name).toBe('Old Timer');
    expect(s.classes.warrior.xp).toBe(500);
    expect(s.classes.warrior.gear).toEqual({ weapon: 'yeonmu_weapon_warrior', armor: 'yeonmu_armor_warrior' });
    expect(s.classes.warrior.plus).toEqual({ yeonmu_weapon_warrior: 4 });
    expect(s.bank).toEqual({ yeop: 900, shards: 3 });
    expect(s.classes.ninja.collection).toEqual([]);
    expect(MIGRATIONS[0]).toBeTypeOf('function');
  });

  it('rejects saves from the future and non-objects', () => {
    expect(() => migrateSave({ version: SAVE_VERSION + 1 })).toThrowError(SaveError);
    try {
      migrateSave({ version: SAVE_VERSION + 1 });
    } catch (e) {
      expect((e as SaveError).code).toBe('tooNew');
    }
    for (const bad of [null, 5, 'x', []]) expect(() => migrateSave(bad)).toThrowError(/not an object/);
  });

  it('chains steps in order, stamps versions, and reports gaps', () => {
    const calls: number[] = [];
    const step =
      (n: number): Migration =>
      (raw) => {
        calls.push(n);
        return { ...raw, [`s${n}`]: true };
      };
    const registry = { 1: step(1), 2: step(2) };
    const out = migrateSave({ version: 1, keep: 'me' }, 3, registry);
    expect(calls).toEqual([1, 2]);
    expect(out).toMatchObject({ version: 3, keep: 'me', s1: true, s2: true });
    expect(() => migrateSave({ version: 0 }, 3, registry)).toThrowError(/no migration from version 0/);
    expect(migrateSave({ version: 3 }, 3, {})).toEqual({ version: 3 });
  });
});

describe('.msav export / import', () => {
  it('round-trips a played save exactly', () => {
    const s = playedSave();
    const text = exportMsav(s);
    expect(text.startsWith(`${MSAV_MAGIC}.${SAVE_VERSION}.`)).toBe(true);
    expect(text).not.toMatch(/\s/);
    const r = importMsav(text, C, { now: NOW });
    expect(r.save).toEqual(s);
    expect(r.fromVersion).toBe(SAVE_VERSION);
    expect(r.repairs).toEqual([]);
    expect(r.save.profile.name).toBe('Şaman Ğ');
  });

  it('tolerates surrounding whitespace (copy/paste)', () => {
    expect(importMsav(`\n  ${exportMsav(freshSave())}  \r\n`, C).save.profile.name).toBe('Tester');
  });

  it('detects corruption via the checksum', () => {
    const s = freshSave();
    const json = JSON.stringify(s);
    const tampered = json.replace('"yeop":0', '"yeop":999999');
    expect(tampered).not.toBe(json);
    expect(() => importMsav(msavOf(tampered, SAVE_VERSION, checksum(json)), C)).toThrowError(/checksum/);
    const text = exportMsav(s);
    expect(() => importMsav(text.slice(0, text.length - 40), C)).toThrowError(SaveError);
  });

  it('rejects foreign / malformed containers', () => {
    const bad = ['', 'hello', 'MSAV2.1.abc.e30=', 'MSAV1.x.abc.e30=', `${MSAV_MAGIC}.1.abc.@@@@`, `${MSAV_MAGIC}.1.${checksum('nope')}.${b64('nope')}`];
    for (const text of bad) expect(() => importMsav(text, C)).toThrowError(SaveError);
    expect(() => importMsav('x'.repeat(MSAV_MAX_CHARS + 1), C)).toThrowError(/too large/);
  });

  it('refuses files from a newer game version', () => {
    const json = JSON.stringify({ ...freshSave(), version: SAVE_VERSION + 5 });
    try {
      importMsav(msavOf(json, SAVE_VERSION + 5), C);
      throw new Error('should not import');
    } catch (e) {
      expect(e).toBeInstanceOf(SaveError);
      expect((e as SaveError).code).toBe('tooNew');
    }
  });

  it('imports an older (v0) file by migrating it', () => {
    const v0 = { profile: { id: 'p1', name: 'Legacy', created: 5 }, classes: { warrior: { xp: 250, gear: {}, collection: [] } }, bank: { yeop: 10, shards: 1 } };
    const r = importMsav(msavOf(JSON.stringify(v0), 0), C, { now: NOW });
    expect(r.fromVersion).toBe(0);
    expect(r.save.version).toBe(SAVE_VERSION);
    expect(r.save.profile.name).toBe('Legacy');
    expect(r.save.classes.warrior.xp).toBe(250);
  });

  it('a hand-edited file with a recomputed checksum still cannot break the rules', () => {
    const edited = JSON.parse(JSON.stringify(freshSave()));
    edited.classes.warrior.talents = { warrior_a: { r4c0: 3, r0c0: 3 } }; // no XP earned, locked row
    edited.classes.warrior.plus = { whatever: 9 };
    edited.bank.yeop = -1;
    const r = importMsav(msavOf(JSON.stringify(edited), SAVE_VERSION), C);
    expect(r.save.classes.warrior.talents).toEqual({});
    expect(r.save.classes.warrior.plus).toEqual({});
    expect(r.save.bank.yeop).toBe(0);
    expect(r.repairs.length).toBeGreaterThan(0);
  });

  it('builds a safe file name', () => {
    const s = freshSave();
    s.profile.name = 'Ejder Tanrısı / ../x';
    const name = msavFileName(s, Date.UTC(2026, 2, 5, 12));
    expect(name).toMatch(/^metin-survivors-[A-Za-z0-9_-]+-\d{8}\.msav$/);
    expect(name).not.toContain('/');
  });
});

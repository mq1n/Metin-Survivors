// tools/qa/payloadReport.ts: the windows and the once-per-URL rule of the payload gate (tools/qa/payload.ts).
import { describe, expect, it } from 'vitest';
import { content } from '../data/loader';
import { migrateSave } from '../meta/migrations';
import { normalizeSave } from '../meta/save';
import { decodeRecord } from '../meta/storage';
import { CLASS_IDS } from '../meta/types';
import { isZoneUnlocked } from '../meta/unlocks';
import {
  SEED_DB,
  WALK_CLASSES,
  WALK_ZONES,
  categoryOf,
  parseWalk,
  seedRecord,
  seedZones,
  sizeWindow,
  splitRepeats,
  walkHeader,
  windowsOf,
  type Req,
  type SizeOf,
} from '../../../../tools/qa/payloadReport';

const SIZES: Record<string, number> = {
  '/assets/index-a.js': 400,
  '/assets/ui/logo.webp': 200,
  '/assets/ui/board.webp': 100,
  '/assets/models/prop/hall.glb': 700,
  '/assets/textures/terrain/grass.webp': 300,
  '/assets/textures/terrain/earth.webp': 250,
  '/assets/audio/music/zone.mp3': 2000,
  '/fonts/cinzel.woff2': 50,
  '/': 1,
};
const sizeOf: SizeOf = (p) => ({ raw: (SIZES[p] ?? 0) * 2, wire: SIZES[p] ?? 0 });
const req = (path: string, sent: number, done: number, status = 200): Req => ({ path, status, sent, done });
const MARKS = { menu: 1000, menuIdle: 9000, start: 12000, hud: 20000, hud6: 26000 };

describe('categoryOf', () => {
  it('groups by asset directory, built scripts, fonts and the rest', () => {
    expect(categoryOf('/assets/index-a.js')).toBe('js/css/json');
    expect(categoryOf('/assets/ui/logo.webp')).toBe('ui');
    expect(categoryOf('/assets/textures/vfx/x.webp')).toBe('textures/vfx');
    expect(categoryOf('/assets/models/prop/hall.glb')).toBe('models/prop');
    expect(categoryOf('/fonts/cinzel.woff2')).toBe('fonts');
    expect(categoryOf('/favicon.ico')).toBe('other');
  });
});

describe('splitRepeats', () => {
  it('counts a URL once, at its first fetch, and lists the repeats with the bytes they would have cost', () => {
    const r = splitRepeats(
      [req('/assets/ui/logo.webp', 5000, 5100), req('/assets/ui/logo.webp', 13000, 13100), req('/assets/ui/logo.webp', 15000, 15100), req('/assets/ui/board.webp', 5200, 5300)],
      sizeOf,
    );
    expect(r.counted.map((x) => [x.path, x.sent])).toEqual([
      ['/assets/ui/logo.webp', 5000],
      ['/assets/ui/board.webp', 5200],
    ]);
    expect(r.all).toHaveLength(4);
    expect(r.repeats).toEqual([{ path: '/assets/ui/logo.webp', fetches: 2, wire: 400 }]);
  });

  it('the first fetch is the earliest one sent, whatever order the finishes came in', () => {
    const r = splitRepeats([req('/assets/ui/logo.webp', 14000, 14050), req('/assets/ui/logo.webp', 3000, 14100)], sizeOf);
    expect(r.counted).toEqual([req('/assets/ui/logo.webp', 3000, 14100)]);
  });

  it('two concurrent fetches of one URL inside a window count once', () => {
    const r = splitRepeats([req('/assets/models/prop/hall.glb', 13000, 15000), req('/assets/models/prop/hall.glb', 13010, 15010)], sizeOf);
    expect(r.counted).toHaveLength(1);
    expect(r.repeats[0]?.fetches).toBe(1);
  });
});

describe('windowsOf', () => {
  const reqs: Req[] = [
    req('/assets/index-a.js', 100, 600), // menu
    req('/assets/ui/logo.webp', 120, 700), // menu
    req('/fonts/cinzel.woff2', 130, 900), // menu
    req('/assets/ui/board.webp', 9500, 9800), // gesture -> start
    req('/assets/ui/logo.webp', 9600, 9900), // a repeat of a menu image, in gestureToStart
    req('/assets/models/prop/hall.glb', 12100, 15000), // zone (blocking)
    req('/assets/ui/logo.webp', 12200, 12500), // a repeat of a menu image, in the zone window
    req('/assets/textures/terrain/grass.webp', 19000, 25000), // zone (after HUD, before HUD + 6)
    req('/assets/audio/music/zone.mp3', 25000, 28000), // sent in the window, finished after HUD + 6: background
    req('/assets/textures/terrain/earth.webp', 31000, 31500), // background
  ];

  it('sums the windows of the walk with every URL counted once', () => {
    const { counted } = splitRepeats(reqs, sizeOf);
    const w = windowsOf(counted, MARKS, sizeOf, 2);
    expect(w.menu.wire).toBe(400 + 200 + 50);
    expect(w.menu.n).toBe(3);
    expect(w.menuIdle.n).toBe(0);
    expect(w.gestureToStart.wire).toBe(100); // board only: the logo is a repeat
    expect(w.zone.n).toBe(2);
    expect(w.zone.wire).toBe(700 + 300); // hall + grass; the logo repeat is not counted
    expect(w.zoneBlocking.wire).toBe(700);
    expect(w.background.wire).toBe(2000 + 250);
    expect(w.zone.groups['models/prop']).toMatchObject({ n: 1, wire: 700, raw: 1400 });
  });

  it('with repeats counted the same windows are bigger by exactly the repeated fetches', () => {
    const { all, counted } = splitRepeats(reqs, sizeOf);
    const once = windowsOf(counted, MARKS, sizeOf, 2);
    const every = windowsOf(all, MARKS, sizeOf, 2);
    expect(every.gestureToStart.wire).toBe(once.gestureToStart.wire + 200);
    expect(every.zone.wire).toBe(once.zone.wire + 200);
    expect(every.menu.wire).toBe(once.menu.wire);
  });

  it('a mark that was never reached leaves its windows empty instead of throwing (a boot that failed)', () => {
    const w = windowsOf(splitRepeats(reqs.slice(0, 3), sizeOf).counted, {}, sizeOf, 3);
    expect(w.menu.n).toBe(3); // everything finished before the (never shown) menu
    expect(w.zone.n).toBe(0);
    expect(w.background.n).toBe(0);
  });
});

describe('sizeWindow', () => {
  it('keeps the biggest files per category, largest first, ties by path', () => {
    const list = [req('/assets/textures/terrain/earth.webp', 0, 1), req('/assets/textures/terrain/grass.webp', 0, 1), req('/assets/ui/board.webp', 0, 1)];
    const w = sizeWindow(list, sizeOf, 1);
    expect(w.groups['textures/terrain']?.top).toEqual([{ path: '/assets/textures/terrain/grass.webp', raw: 600, wire: 300 }]);
    expect(w.groups['textures/terrain']?.n).toBe(2);
    expect(w.n).toBe(3);
  });
});

describe('--class / --zone of the payload walk', () => {
  const walk = (c?: string, z?: string) => {
    const r = parseWalk(c, z);
    if (!r.ok) throw new Error(r.error);
    return r.walk;
  };

  it('no flag is the default walk: warrior, zone 1, nothing seeded, nothing clicked', () => {
    expect(walk()).toEqual({ classId: 'warrior', zone: 'yeonmu', zoneNumber: 1, zoneCount: 4, explicit: false, seeded: false });
  });

  it('a flag makes the walk explicit; only a zone past the first needs the seeded profile', () => {
    expect(walk('shaman')).toMatchObject({ classId: 'shaman', zone: 'yeonmu', explicit: true, seeded: false });
    expect(walk(undefined, 'yeonmu')).toMatchObject({ explicit: true, seeded: false });
    expect(walk('shaman', 'suryeon')).toEqual({ classId: 'shaman', zone: 'suryeon', zoneNumber: 2, zoneCount: 4, explicit: true, seeded: true });
    expect(walk('wolfman', 'daeryeol')).toMatchObject({ zoneNumber: 4, seeded: true });
  });

  it('rejects an unknown hero or zone with the list of the valid ones', () => {
    expect(parseWalk('mage', undefined)).toEqual({ ok: false, error: '--class "mage": expected one of warrior|ninja|yacha|shaman|wolfman' });
    expect(parseWalk(undefined, 'hell')).toEqual({ ok: false, error: '--zone "hell": expected one of yeonmu|suryeon|seori|daeryeol' });
    expect(parseWalk('', undefined).ok).toBe(false); // `--class` with no value
  });

  it('the header names hero, zone and its number, and what was seeded', () => {
    expect(walkHeader(walk('shaman', 'suryeon'))).toBe('walk: class shaman, zone suryeon = zone 2 of 4, profile seeded with zones yeonmu + suryeon unlocked');
    expect(walkHeader(walk('ninja'))).toBe('walk: class ninja, zone yeonmu = zone 1 of 4');
    expect(walkHeader(walk('shaman', 'seori'), { classId: 'shaman', zone: 'seori' })).toContain('(on screen at Start: hero shaman, zone seori)');
  });

  it('the lists are the real content: the heroes of the game and the zones in their play order', () => {
    expect([...WALK_CLASSES]).toEqual([...CLASS_IDS]);
    expect([...WALK_ZONES]).toEqual([...content.zones].sort((a, b) => a.order - b.order).map((z) => z.id));
    expect(content.classes.map((c) => c.id).sort()).toEqual([...WALK_CLASSES].sort());
  });

  it('the seeded record is a save the game loads, with exactly the chain up to the zone unlocked', () => {
    const now = 1_700_000_000_000;
    for (const zone of WALK_ZONES) {
      const w = walk('warrior', zone);
      const raw = seedRecord(seedZones(w), now);
      const { data } = decodeRecord(raw); // the envelope and its checksum, as the game's repository checks them
      const save = normalizeSave(migrateSave(data), content, { now });
      expect(save.unlocks.zones).toEqual(seedZones(w));
      for (const z of WALK_ZONES) expect(isZoneUnlocked(save, content, z), `${zone}: ${z}`).toBe(WALK_ZONES.indexOf(z) <= WALK_ZONES.indexOf(zone));
      expect(save.stats.runs).toBe(0); // no progress: the same as a fresh profile except for the open zones
      expect(save.bank).toEqual({ yeop: 0, shards: 0 });
    }
    expect(SEED_DB).toEqual({ name: 'metin-survivors', store: 'kv', key: 'save.main' });
  });
});

// The arithmetic of tools/qa/payload.ts (pure, unit-tested in apps/game/src/dev/payloadReport.test.ts): which requests a window
// counts, how repeat fetches of one URL are treated, the per-category sums, and the hero / zone the walk picks (`--class` / `--zone`)
// with the saved profile that makes a later zone selectable.

import { checksum } from '../../apps/game/src/meta/errors';

/** one finished response of the session: path without query, HTTP status, ms since navigation when sent / finished */
export interface Req {
  path: string;
  status: number;
  sent: number;
  done: number;
}
export interface FileSize {
  raw: number;
  wire: number;
}
export type SizeOf = (path: string) => FileSize;
export interface Group {
  n: number;
  raw: number;
  wire: number;
  /** the biggest files of the category by wire size */
  top: { path: string; raw: number; wire: number }[];
}
export interface Sized {
  n: number;
  raw: number;
  wire: number;
  groups: Record<string, Group>;
}
export type WindowName = 'menu' | 'menuIdle' | 'gestureToStart' | 'zone' | 'zoneBlocking' | 'background';
/** marks of the walk: menu (shown), menuIdle (idle over), start (Start clicked), hud (HUD shown), hud6 (HUD + 6 s); ms since navigation */
export type Marks = Record<string, number>;

/** category of a request path: /assets/<dir>[/<sub>] (js/css/json for the built scripts), fonts, other */
export function categoryOf(path: string): string {
  if (!path.startsWith('/assets/')) return path.startsWith('/fonts') ? 'fonts' : 'other';
  const seg = path.split('/');
  if ((seg[2] ?? '').includes('.')) return 'js/css/json';
  return seg.length > 4 ? `${seg[2]}/${seg[3]}` : (seg[2] as string);
}

/**
 * A URL counts once per page session, at its first fetch (earliest `sent`): the tool disables the HTTP cache, a real browser
 * serves the repeat from its cache. `all` is every fetch in that order, `counted` the first fetch of each URL, `repeats` the
 * URLs fetched again (extra fetches and the bytes they would have cost each time).
 */
export function splitRepeats(reqs: readonly Req[], sizeOf: SizeOf): { all: Req[]; counted: Req[]; repeats: { path: string; fetches: number; wire: number }[] } {
  const all = [...reqs].sort((a, b) => a.sent - b.sent || a.done - b.done);
  const seen = new Set<string>();
  const counted: Req[] = [];
  const again = new Map<string, { fetches: number; wire: number }>();
  for (const r of all) {
    if (!seen.has(r.path)) {
      seen.add(r.path);
      counted.push(r);
      continue;
    }
    const e = again.get(r.path) ?? { fetches: 0, wire: 0 };
    e.fetches++;
    e.wire += sizeOf(r.path).wire;
    again.set(r.path, e);
  }
  const repeats = [...again.entries()].map(([path, v]) => ({ path, ...v })).sort((a, b) => b.wire - a.wire || a.path.localeCompare(b.path));
  return { all, counted, repeats };
}

/** sums of a request list per category, with the `top` biggest files of each */
export function sizeWindow(list: readonly Req[], sizeOf: SizeOf, top: number): Sized {
  const groups: Record<string, Group> = {};
  let raw = 0;
  let wire = 0;
  for (const r of list) {
    const s = sizeOf(r.path);
    const g = (groups[categoryOf(r.path)] ??= { n: 0, raw: 0, wire: 0, top: [] });
    g.n++;
    g.raw += s.raw;
    g.wire += s.wire;
    g.top.push({ path: r.path, raw: s.raw, wire: s.wire });
    raw += s.raw;
    wire += s.wire;
  }
  for (const g of Object.values(groups)) g.top = g.top.sort((a, b) => b.wire - a.wire || a.path.localeCompare(b.path)).slice(0, top);
  return { n: list.length, raw, wire, groups };
}

/** the six windows of the walk (definitions: tools/qa/payload.ts header); a mark that was never reached is Infinity */
export function windowsOf(list: readonly Req[], marks: Marks, sizeOf: SizeOf, top: number): Record<WindowName, Sized> {
  const at = (k: string): number => marks[k] ?? Number.POSITIVE_INFINITY;
  const win = (keep: (r: Req) => boolean): Sized => sizeWindow(list.filter(keep), sizeOf, top);
  return {
    menu: win((r) => r.done <= at('menu')),
    menuIdle: win((r) => r.done > at('menu') && r.done <= at('menuIdle')),
    gestureToStart: win((r) => r.sent > at('menuIdle') && r.sent < at('start')),
    zone: win((r) => r.sent >= at('start') && r.done <= at('hud6')),
    zoneBlocking: win((r) => r.sent >= at('start') && r.done <= at('hud')),
    background: win((r) => r.sent >= at('start') && r.done > at('hud6')),
  };
}

// ---- the hero and the zone of the walk ---------------------------------------------------------------------------------------

/** the heroes the hero-select screen offers (ids of data/content/classes.json, in that order) */
export const WALK_CLASSES = ['warrior', 'ninja', 'yacha', 'shaman', 'wolfman'] as const;
/** the zones in play order (ids and `order` of data/content/zones.json: apps/game/src/dev/payloadReport.test.ts pins both) */
export const WALK_ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'] as const;
export type WalkClass = (typeof WALK_CLASSES)[number];
export type WalkZone = (typeof WALK_ZONES)[number];

export interface Walk {
  classId: WalkClass;
  zone: WalkZone;
  /** 1-based position of the zone in the chain (what the report prints) */
  zoneNumber: number;
  zoneCount: number;
  /** `--class` or `--zone` was given: the walk picks the cards and the report header names them */
  explicit: boolean;
  /** the zone is not the first one: a fresh profile cannot pick it, the walk seeds a saved profile that has it unlocked */
  seeded: boolean;
}

/** `--class` / `--zone` values (undefined = flag absent = the default walk: warrior, yeonmu, nothing seeded or clicked) */
export function parseWalk(classArg: string | undefined, zoneArg: string | undefined): { ok: true; walk: Walk } | { ok: false; error: string } {
  const classId = classArg === undefined ? WALK_CLASSES[0] : WALK_CLASSES.find((c) => c === classArg);
  if (classId === undefined) return { ok: false, error: `--class "${classArg}": expected one of ${WALK_CLASSES.join('|')}` };
  const zone = zoneArg === undefined ? WALK_ZONES[0] : WALK_ZONES.find((z) => z === zoneArg);
  if (zone === undefined) return { ok: false, error: `--zone "${zoneArg}": expected one of ${WALK_ZONES.join('|')}` };
  const index = WALK_ZONES.indexOf(zone);
  return { ok: true, walk: { classId, zone, zoneNumber: index + 1, zoneCount: WALK_ZONES.length, explicit: classArg !== undefined || zoneArg !== undefined, seeded: index > 0 } };
}

/** the header line of an explicit walk (the default report stays as it was) */
export function walkHeader(w: Walk, picked?: { classId: string; zone: string }): string {
  const seeded = w.seeded ? `, profile seeded with zones ${seedZones(w).join(' + ')} unlocked` : '';
  const check = picked ? `   (on screen at Start: hero ${picked.classId}, zone ${picked.zone})` : '';
  return `walk: class ${w.classId}, zone ${w.zone} = zone ${w.zoneNumber} of ${w.zoneCount}${seeded}${check}`;
}

/** zones the seeded profile has unlocked: the chain up to and including the walk's zone (what clearing the earlier ones would have opened) */
export function seedZones(w: Walk): WalkZone[] {
  return WALK_ZONES.slice(0, w.zoneNumber);
}

/** The IndexedDB record the game's save repository reads back (meta/storage.ts: database `metin-survivors`, store `kv`, key `save.main`). */
export const SEED_DB = { name: 'metin-survivors', store: 'kv', key: 'save.main' } as const;

/**
 * A minimal saved profile with `zones` unlocked, in the repository's record envelope `{ f, t, c, d }` (the game's `normalizeSave` fills
 * every other field: no runs, no gold, no gear - the same as a fresh profile except for the open zones). `d` is the JSON text of the
 * save and `c` its checksum (meta/errors.ts `checksum`); apps/game/src/dev/payloadReport.test.ts decodes this with the real loader.
 */
export function seedRecord(zones: readonly string[], now: number): string {
  const save = {
    version: 1,
    profile: { id: 'qa-payload-seed-0001', name: 'PayloadQA', created: now, updated: now },
    unlocks: { zones: [...zones], hard: [], codex: [] },
  };
  const d = JSON.stringify(save);
  return JSON.stringify({ f: 1, t: now, c: checksum(d), d });
}

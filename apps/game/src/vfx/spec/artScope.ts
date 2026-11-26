// Art keys and per-run art scope (pure: no three.js, runs in tests and in the render catalog builder).
//
// An ART KEY names what one `tex: { art }` draws: a manifest sprite id, or a flipbook made of several separate sprites
// (`art: ['id1', 'id2', …]` → key `id1+id2+…`, frames in list order). The packer (art.ts) bakes every key into the art
// array once; a run bakes only the keys of the specs it can spawn (`runSpecIds`).

/** separator of the frame ids inside a sheet key (manifest ids never contain it) */
export const ART_SHEET_SEP = '+';

/** the key of an `ArtTex.art` value: the id itself, or the frame ids joined for a flipbook list ('' when empty / invalid) */
export function artKey(art: string | readonly string[]): string {
  if (typeof art === 'string') return art;
  if (!Array.isArray(art) || art.length === 0 || art.some((a) => typeof a !== 'string' || a.length === 0)) return '';
  return art.length === 1 ? (art[0] as string) : art.join(ART_SHEET_SEP);
}

/** the manifest ids a key is made of (one for a plain sprite, one per frame for a sheet) */
export function artParts(key: string): string[] {
  return key.includes(ART_SHEET_SEP) ? key.split(ART_SHEET_SEP) : [key];
}

/** a usable art reference: a non-empty id, or a non-empty list of non-empty ids */
export function artOk(art: unknown): boolean {
  return typeof art === 'string' ? art.length > 0 : artKey(art as readonly string[]) !== '';
}

// ------------------------------------------------------------------------------------------------ run scope

/** the fields of a skill definition the scope needs (data/schema SkillDef satisfies it structurally) */
export interface ScopeSkill {
  id: string;
  classId: string;
  /** 'a' | 'b'; absent for the common pool */
  doctrine?: string | null;
  /** spec preset id (`sk.<skillId>`) */
  vfx?: string | null;
}

/** one hero of the run: its class + chosen doctrine, plus skills granted outside the class pool (talent ultimates) */
export interface ScopeLoadout {
  classId: string;
  doctrine: string;
  extraSkills?: readonly string[] | null;
}

/** dev-only demo specs (`sk.__art_demo`, `sk.__art_demo_raw`, `sk.__art_sheets`): registered in DEV builds, never part of a run */
export const DEV_SPEC_PREFIX = 'sk.__';

export function isDevSpec(id: string): boolean {
  return id.startsWith(DEV_SPEC_PREFIX);
}

/**
 * What a zone changes about a run's art scope. Pure data (this module has no render dependencies): the caller resolves it from the zone's
 * look (app/simFeed.ts: `zoneAmbientLoops`).
 */
export interface ScopeZone {
  /**
   * The ambient particle loops the run spawns for the whole run, as the zone's look names them (`embers`, an alias of the preset
   * `ambient.embers`, or the preset id itself): `biome.particles` first, then the look's extra `ambientLoops` (PL-02; `ambientLoopList`
   * builds the list). A single id is a one-loop zone; '' / [] = the zone's look has no ambient loop. Every listed loop's art carrier
   * (`ambientCarrierId`) joins the scope, and no other zone's.
   */
  ambient: string | readonly string[];
  /**
   * The run-event kinds the zone's content lists (`runEvents.zones[zone]`, EV-03b): the presets of those kinds (`EVENT_SPEC_KINDS`) join the scope, and no
   * other event preset does. Absent / [] = a zone without events: none of them (the shipped content). Every kind is drawn at most once per run.
   */
  events?: readonly string[];
}

/** id prefix of the run-event presets (vfx/common/events/ids.ts: `ev.shrine`, `ev.champion`, ...) */
export const EVENT_SPEC_PREFIX = 'ev.';

/**
 * The run-event kinds (data/content/runEvents.json) and the preset ids each one draws (vfx/common/events/ids.ts EVENT_PRESET_IDS; a test pins the two
 * tables together). A run packs the sprites of an event preset only when its zone lists the kind (`ScopeZone.events`); a kind without visuals
 * (`goldenHour`) is not here. The presets are SOON (artTier.ts default, pinned by their specs): the event comes minutes into a run (window 380-620 s).
 */
export const EVENT_SPEC_KINDS: Readonly<Record<string, readonly string[]>> = {
  bargain: ['ev.shrine', 'ev.shrinePillar', 'ev.shrineChannel', 'ev.shrineClaim'],
  championHunt: ['ev.champion'],
  metinRain: ['ev.rainMark'],
};

/** the event preset ids of the listed kinds (unknown kinds and kinds without visuals add nothing; an id once) */
export function eventSpecIds(kinds: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const kind of kinds ?? []) {
    for (const id of EVENT_SPEC_KINDS[kind] ?? []) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** id prefix of the per-preset ambient art carriers (`sk.gen.ambient_art.<name>`, vfx/common/ambient/art.ts): never spawned, they only keep one loop's sprites in a scope */
export const AMBIENT_CARRIER_PREFIX = 'sk.gen.ambient_art.';

/** the carrier spec of an ambient loop (`snow` or `ambient.snow` → `sk.gen.ambient_art.snow`); '' for no loop */
export function ambientCarrierId(loop: string): string {
  const name = loop.startsWith('ambient.') ? loop.slice('ambient.'.length) : loop;
  return name === '' ? '' : AMBIENT_CARRIER_PREFIX + name;
}

/** the carriers of a zone's ambient loops (`ScopeZone.ambient`: one id or a list), in loop order, '' dropped, a carrier named twice kept once; [] for no loop */
export function ambientCarrierIds(loops: string | readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const loop of typeof loops === 'string' ? [loops] : (loops ?? [])) {
    const id = typeof loop === 'string' ? ambientCarrierId(loop) : '';
    if (id !== '' && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * A zone's ambient loops in spawn order (PL-02): the primary loop (`biome.particles`) first, then the extra ones of the look (`look.ambientLoops`).
 * Empty ids are dropped and a loop is listed once however it is spelled (`leaves` and `ambient.leaves` are one preset: its first spelling stays);
 * [] for a zone without an ambient loop. The FIRST entry is "the zone's loop": it starts at frame 1 on every tier (its carrier is NOW,
 * app/simFeed.ts), a low-quality run spawns nothing else, and the other loops' carriers are SOON (artTier.ts).
 */
export function ambientLoopList(primary: string | null | undefined, extras?: readonly string[] | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const loop of [primary, ...(extras ?? [])]) {
    if (typeof loop !== 'string') continue;
    const carrier = ambientCarrierId(loop);
    if (carrier === '' || seen.has(carrier)) continue;
    seen.add(carrier);
    out.push(loop);
  }
  return out;
}

/**
 * The spec presets a run can spawn. A spec belongs to a skill when
 *  1. the skill's `vfx` is the spec id or the spec id minus trailing `.part`s (`sk.nightfall.cast` → `sk.nightfall`), or
 *  2. no skill claims it that way but the spec is `sk.<skillId>` (+ parts) of a skill that exists in the content: new
 *     specs are authored under `sk.<skillId>` before the skill's `vfx` in skills.json is switched to them, and they must
 *     already belong to their own class (not leak into every run as common effects).
 * Specs no skill owns (the `sk.gen.*` hits, deaths, status loops, metin effects, …) are common and always included. An
 * owned spec is included when a hero of the run can hold that skill: the hero's class + chosen doctrine (basic, starter,
 * actives, ultimates), the common pool (`classId: 'common'`) and the hero's `extraSkills`. No loadouts = unknown run:
 * every spec. The dev demo specs (`sk.__*`) are never part of a run.
 *
 * `zone` prunes what the zone can never show: a run carries the ambient art of ITS zone only (the `sk.gen.ambient_art.<name>` carrier of
 * every loop the zone spawns, none when the zone's look has no ambient loop), because the zone's loops are fixed for the whole run. Without a
 * zone (the galleries, the QA tools, the dev server's unknown run) every ambient carrier stays. The same goes for the run-event presets (`ev.*`,
 * EV-03b): with a zone only those of the kinds its content lists (`ScopeZone.events`) stay, so a zone without events packs none of their art.
 */
export function runSpecIds(skills: readonly ScopeSkill[], loadouts: readonly ScopeLoadout[], specIds: Iterable<string>, zone?: ScopeZone | null): string[] {
  const keep = zone ? new Set(ambientCarrierIds(zone.ambient)) : null;
  const events = zone ? new Set(eventSpecIds(zone.events)) : null;
  const all = [...specIds].filter(
    (id) =>
      !isDevSpec(id) &&
      (keep === null || !id.startsWith(AMBIENT_CARRIER_PREFIX) || keep.has(id)) &&
      (events === null || !id.startsWith(EVENT_SPEC_PREFIX) || events.has(id)),
  );
  if (loadouts.length === 0) return all;
  const owners = specOwnerIndex(skills);
  const byId = new Map<string, ScopeSkill>();
  for (const s of skills) byId.set(s.id, s);
  const allowed = new Set<ScopeSkill>();
  for (const l of loadouts) {
    for (const s of skills) {
      if (s.classId === 'common' || (s.classId === l.classId && (s.doctrine == null || s.doctrine === l.doctrine))) allowed.add(s);
    }
    for (const id of l.extraSkills ?? []) {
      const s = byId.get(id);
      if (s) allowed.add(s);
    }
  }
  return all.filter((id) => {
    const own = owners(id);
    return own === null || own.some((s) => allowed.has(s));
  });
}

/**
 * The skills a spec id belongs to (see runSpecIds), null for common specs; the longest matching prefix decides. The
 * tier rules (artTier.ts) read the same ownership.
 */
export function specOwnerIndex(skills: readonly ScopeSkill[]): (specId: string) => ScopeSkill[] | null {
  const claimed = new Map<string, ScopeSkill[]>();
  const named = new Map<string, ScopeSkill[]>();
  const push = (m: Map<string, ScopeSkill[]>, key: string, s: ScopeSkill): void => {
    const list = m.get(key);
    if (list) list.push(s);
    else m.set(key, [s]);
  };
  for (const s of skills) {
    if (s.vfx) push(claimed, s.vfx, s);
    push(named, `sk.${s.id}`, s);
  }
  return (id) => {
    let cur = id;
    for (;;) {
      const hit = claimed.get(cur) ?? named.get(cur);
      if (hit) return hit;
      const dot = cur.lastIndexOf('.');
      if (dot < 0) return null;
      cur = cur.slice(0, dot);
    }
  };
}

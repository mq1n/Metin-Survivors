// Per-run VFX art scope: the render catalog lists only the skill specs the heroes of the run can spawn (class + chosen
// doctrine of every co-op hero, the common pool, talent extra skills, the common effects), so only their generated
// sprites are packed (vfx/spec/artScope.ts, SpecHost.preloadArt).
import { describe, expect, it, vi } from 'vitest';
import { content } from '../../data/loader';
import { resolveRunEvents } from '../../data/schema';
import type { QualityTier } from '../../render/quality';
import { findLook, loopsOf, resolveBiome } from '../../render/terrain/look';
import { createWorld } from '../../sim/world';
import '../../vfx/presets';
import { AMBIENT_CARRIER_PREFIX, EVENT_SPEC_KINDS, EVENT_SPEC_PREFIX, ambientCarrierIds, ambientLoopList, eventSpecIds, runSpecIds } from '../../vfx/spec/artScope';
import { ART_NOW, ART_SOON, commonTier } from '../../vfx/spec/artTier';
import { ART_DEMO, ART_DEMO_RAW, ART_SHEETS_DEMO } from '../../vfx/spec/demo';
import { SPEC_REGISTRY } from '../../vfx/spec/preset';
import { ambientLoopsForTier, buildCatalog, zoneAmbientLoops } from '../simFeed';
import { ensureAllSkillVfx } from '../../vfx/skills/loader';

// production (lazy) mode streams the later tiers (render/payloadPolicy.ts); the dev server awaits everything. The scope tests run in dev mode, the tier tests flip it.
const policy = vi.hoisted(() => ({ lazy: false }));
vi.mock('../../render/payloadPolicy', () => ({ lazyContent: () => policy.lazy }));

// the class specs are lazy chunks (vfx/skills/loader.ts): load them all before this file reads the registry
await ensureAllSkillVfx();

const registry = (): Set<string> => new Set(SPEC_REGISTRY.map((s) => s.id));

function scopeOf(classId: string, doctrine: string, coop: { classId: string; doctrine: string }[] = [], extraSkills?: string[], zone = 'yeonmu'): Set<string> {
  const meta = { stats: {}, ...(extraSkills ? { extraSkills } : {}) };
  const w = createWorld(
    {
      zone,
      difficulty: 'normal',
      classId: classId as 'warrior',
      doctrine: doctrine as 'a',
      sex: 'm',
      empire: 'saehwa',
      seed: 3,
      meta,
      coop: coop.map((c) => ({ classId: c.classId as 'warrior', doctrine: c.doctrine as 'a', sex: 'f', empire: 'saehwa', meta: { stats: {} } })),
    } as Parameters<typeof createWorld>[0],
    content,
  );
  return new Set(buildCatalog(w).vfxSpecs);
}

/** spec ids of the skills of a class + doctrine (the common pool when classId = 'common') that are registered presets */
function specsOf(classId: string, doctrine: string | null): string[] {
  const reg = registry();
  return content.skills.filter((s) => s.classId === classId && (doctrine === null || s.doctrine == null || s.doctrine === doctrine) && s.vfx && reg.has(s.vfx)).map((s) => s.vfx as string);
}

describe('run art scope (RenderCatalog.vfxSpecs)', () => {
  it('a solo run keeps its class + doctrine, the common pool and the common effects, and nothing of the others', () => {
    expect(SPEC_REGISTRY.length).toBeGreaterThan(100);
    const got = scopeOf('warrior', 'a');
    const own = specsOf('warrior', 'a');
    expect(own.length).toBeGreaterThan(0);
    for (const id of own) expect(got.has(id), id).toBe(true);
    for (const id of specsOf('common', null)) expect(got.has(id), `common ${id}`).toBe(true);
    // the other doctrine's and the other classes' skills are out
    for (const cls of ['ninja', 'yacha', 'shaman', 'wolfman']) for (const id of specsOf(cls, null)) expect(got.has(id), `${cls} ${id}`).toBe(false);
    const warriorB = content.skills.filter((s) => s.classId === 'warrior' && s.doctrine === 'b' && s.vfx && registry().has(s.vfx));
    expect(warriorB.length).toBeGreaterThan(0);
    for (const s of warriorB) expect(got.has(s.vfx as string), s.id).toBe(false);
    // unowned specs (hits, deaths, status loops, metin effects) are always there; owned = a skill's vfx (+ parts) or sk.<skillId>
    const owners = content.skills.flatMap((s) => [s.vfx, `sk.${s.id}`]).filter((c): c is string => typeof c === 'string');
    // (the ambient art carriers are unowned too, but a run keeps only its zone's: the next test; the run-event presets `ev.*` only join a zone
    // whose content lists their kind, which the shipped content never does: the last describe block, EV-03b)
    const unowned = [...registry()].filter(
      (id) => !id.startsWith('sk.__') && !id.startsWith(AMBIENT_CARRIER_PREFIX) && !id.startsWith(EVENT_SPEC_PREFIX) && !owners.some((c) => id === c || id.startsWith(`${c}.`)),
    );
    expect(unowned.length).toBeGreaterThan(20);
    for (const id of unowned) expect(got.has(id), id).toBe(true);
    expect(got.size).toBeLessThan(registry().size);
  });

  it('a run carries the ambient art of ITS zone only: the carrier of the loop its look spawns, none when the look has no ambient loop', () => {
    expect(content.zones.length).toBeGreaterThanOrEqual(4);
    const all = [...registry()].filter((id) => id.startsWith(AMBIENT_CARRIER_PREFIX));
    expect(all.length).toBeGreaterThanOrEqual(6);
    let withLoop = 0;
    for (const z of content.zones) {
      // the carriers of the zone's whole loop list (biome.particles, then look.ambientLoops: PL-02, DY-04 gives Daeryeol its smoke), one per loop
      const want = ambientCarrierIds(zoneAmbientLoops(z.id, z.biome)).sort();
      if (want.length > 0) withLoop++;
      for (const [cls, doc] of [['warrior', 'a'], ['shaman', 'b']] as const) {
        const got = [...scopeOf(cls, doc, [], undefined, z.id)].filter((id) => id.startsWith(AMBIENT_CARRIER_PREFIX)).sort();
        expect(got, `${z.id} ${cls}/${doc}`).toEqual(want);
        for (const carrier of want) expect(registry().has(carrier), `${z.id}: the carrier ${carrier} is a registered spec`).toBe(true);
      }
    }
    // daeryeol keeps its embers (its look sets no particles override) and adds the smoke wisps (DY-04); the other three looks switched the loop off
    expect(withLoop).toBeGreaterThanOrEqual(1);
    expect([...scopeOf('warrior', 'a', [], undefined, 'daeryeol')]).toContain('sk.gen.ambient_art.embers');
  });

  it('the dev demo specs (sk.__*) are registered in dev but never packed into a run', () => {
    for (const d of [ART_DEMO, ART_DEMO_RAW, ART_SHEETS_DEMO]) expect(registry().has(d.id), `${d.id} registered`).toBe(true);
    for (const [cls, doctrine] of [['warrior', 'a'], ['shaman', 'b']] as const) {
      const got = scopeOf(cls, doctrine);
      expect([...got].filter((id) => id.startsWith('sk.__'))).toEqual([]);
    }
    expect([...scopeOf('warrior', 'a', [{ classId: 'yacha', doctrine: 'a' }])].filter((id) => id.startsWith('sk.__'))).toEqual([]);
  });

  it('co-op: every partner\'s class and doctrine joins the scope', () => {
    const solo = scopeOf('warrior', 'a');
    const duo = scopeOf('warrior', 'a', [{ classId: 'shaman', doctrine: 'b' }]);
    const shamanB = specsOf('shaman', 'b');
    expect(shamanB.length).toBeGreaterThan(0);
    for (const id of shamanB) {
      expect(solo.has(id), `solo ${id}`).toBe(false);
      expect(duo.has(id), `duo ${id}`).toBe(true);
    }
    for (const id of solo) expect(duo.has(id)).toBe(true);
    // the partner's other doctrine stays out
    const shamanOnlyA = content.skills.filter((s) => s.classId === 'shaman' && s.doctrine === 'a' && s.vfx && registry().has(s.vfx));
    for (const s of shamanOnlyA) expect(duo.has(s.vfx as string), s.id).toBe(false);
  });

  it('talent extra skills of the hero pull in their own spec', () => {
    const yacha = content.skills.find((s) => s.classId === 'yacha' && s.vfx && registry().has(s.vfx) && !specsOf('warrior', 'a').includes(s.vfx));
    expect(yacha).toBeTruthy();
    expect(scopeOf('warrior', 'a').has(yacha?.vfx as string)).toBe(false);
    expect(scopeOf('warrior', 'a', [], [yacha?.id as string]).has(yacha?.vfx as string)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ PL-02: several ambient loops per zone

/** runs `fn` with the zone look's ambient loops (and optionally its primary loop, `biome.particles`) replaced; the look is restored afterwards */
function withLook<T>(zone: string, patch: { loops?: string[]; particles?: string }, fn: () => T): T {
  const look = findLook(zone);
  if (!look) throw new Error(`no look for ${zone}`);
  const had = { loops: look.ambientLoops, biome: look.biome };
  look.ambientLoops = patch.loops;
  if (patch.particles !== undefined) look.biome = { ...look.biome, particles: patch.particles };
  try {
    return fn();
  } finally {
    look.ambientLoops = had.loops;
    look.biome = had.biome;
  }
}

function catalogOf(zone: string, classId = 'warrior', doctrine = 'a', coop: { classId: string; doctrine: string }[] = []): ReturnType<typeof buildCatalog> {
  const w = createWorld(
    {
      zone,
      difficulty: 'normal',
      classId: classId as 'warrior',
      doctrine: doctrine as 'a',
      sex: 'm',
      empire: 'saehwa',
      seed: 3,
      meta: { stats: {} },
      coop: coop.map((c) => ({ classId: c.classId as 'warrior', doctrine: c.doctrine as 'a', sex: 'f', empire: 'saehwa', meta: { stats: {} } })),
    } as Parameters<typeof createWorld>[0],
    content,
  );
  return buildCatalog(w);
}

const carriersOf = (ids: readonly string[] | undefined): string[] => (ids ?? []).filter((id) => id.startsWith(AMBIENT_CARRIER_PREFIX));

describe('several ambient loops per zone (PL-02)', () => {
  it("ambientLoopList: the primary loop first, then the look's extras, each preset once however it is spelled, empties dropped", () => {
    expect(ambientLoopList('embers')).toEqual(['embers']);
    expect(ambientLoopList('')).toEqual([]);
    expect(ambientLoopList(undefined, undefined)).toEqual([]);
    expect(ambientLoopList('ambient.leaves', ['ambient.motes'])).toEqual(['ambient.leaves', 'ambient.motes']);
    // no primary loop: the first extra is the zone's loop
    expect(ambientLoopList('', ['ambient.motes', 'ambient.leaves'])).toEqual(['ambient.motes', 'ambient.leaves']);
    // `leaves` and `ambient.leaves` are one preset; duplicates and empty ids go
    expect(ambientLoopList('leaves', ['ambient.leaves', '', 'ambient.motes', 'motes'])).toEqual(['leaves', 'ambient.motes']);
    expect(ambientLoopList('ambient.dust', null)).toEqual(['ambient.dust']);
  });

  it('ambientCarrierIds: one carrier per loop in order, a string is a one-loop zone, no loop = none', () => {
    expect(ambientCarrierIds('ambient.leaves')).toEqual(['sk.gen.ambient_art.leaves']);
    expect(ambientCarrierIds('')).toEqual([]);
    expect(ambientCarrierIds(undefined)).toEqual([]);
    expect(ambientCarrierIds(['embers', 'ambient.motes', 'ambient.embers', ''])).toEqual(['sk.gen.ambient_art.embers', 'sk.gen.ambient_art.motes']);
  });

  it("runSpecIds: a list keeps the carrier of every listed loop and no other zone's; a string and an empty list are as before", () => {
    const ids = ['sk.gen.dust', 'sk.gen.ambient_art.leaves', 'sk.gen.ambient_art.motes', 'sk.gen.ambient_art.embers', 'hit.fire'];
    expect(runSpecIds([], [], ids, { ambient: ['ambient.leaves', 'motes'] })).toEqual(['sk.gen.dust', 'sk.gen.ambient_art.leaves', 'sk.gen.ambient_art.motes', 'hit.fire']);
    expect(runSpecIds([], [], ids, { ambient: 'ambient.leaves' })).toEqual(['sk.gen.dust', 'sk.gen.ambient_art.leaves', 'hit.fire']);
    expect(runSpecIds([], [], ids, { ambient: [] })).toEqual(['sk.gen.dust', 'hit.fire']);
    // no zone (galleries, QA tools): every carrier stays
    expect(runSpecIds([], [], ids)).toEqual(ids);
  });

  it('ambientLoopsForTier: low spawns only the first loop, every other tier all of them', () => {
    const loops = ['ambient.embers', 'ambient.motes', 'ambient.ash'];
    expect(ambientLoopsForTier(loops, 'low')).toEqual(['ambient.embers']);
    for (const tier of ['medium', 'high', 'ultra'] as QualityTier[]) expect(ambientLoopsForTier(loops, tier), tier).toEqual(loops);
    expect(ambientLoopsForTier([], 'low')).toEqual([]);
    expect(ambientLoopsForTier(['ambient.dust'], 'low')).toEqual(['ambient.dust']);
    // a copy: the caller's list is never aliased
    expect(ambientLoopsForTier(loops, 'high')).not.toBe(loops);
  });

  it("the other loops' carriers are SOON by rule (the first loop's is NOW through the run facts)", () => {
    expect(commonTier('sk.gen.ambient_art.motes')).toBe(ART_SOON);
    expect(commonTier('sk.gen.ambient_art.embers')).toBe(ART_SOON);
  });

  it("shipped zones: the loop list starts with biome.particles (the zone's own loop), a look's extra loops follow it; Daeryeol runs its embers and the smoke wisps (DY-04)", () => {
    for (const z of content.zones) {
      const particles = resolveBiome(z.id, z.biome).particles ?? '';
      const loops = zoneAmbientLoops(z.id, z.biome);
      expect(loops, z.id).toEqual(ambientLoopList(particles, loopsOf(findLook(z.id))));
      expect(loops.slice(0, particles === '' ? 0 : 1), z.id).toEqual(particles === '' ? [] : [particles]);
    }
    const doy = content.zones.find((x) => x.id === 'daeryeol');
    expect(zoneAmbientLoops('daeryeol', (doy as (typeof content.zones)[number]).biome)).toEqual(['embers', 'ambient.smoke']);
  });

  it('a two-loop zone (daeryeol: embers + motes) carries both carriers in its scope, dev and production, and no other', () => {
    withLook('daeryeol', { loops: ['ambient.motes'] }, () => {
      const z = content.zones.find((x) => x.id === 'daeryeol');
      expect(z).toBeTruthy();
      expect(zoneAmbientLoops('daeryeol', (z as (typeof content.zones)[number]).biome)).toEqual(['embers', 'ambient.motes']);
      try {
        for (const lazy of [false, true]) {
          policy.lazy = lazy;
          const cat = catalogOf('daeryeol');
          expect(carriersOf(cat.vfxSpecs).sort(), `lazy ${lazy}`).toEqual(['sk.gen.ambient_art.embers', 'sk.gen.ambient_art.motes']);
          // the carriers are real, registered specs
          for (const id of carriersOf(cat.vfxSpecs)) expect(registry().has(id), id).toBe(true);
        }
      } finally {
        policy.lazy = false;
      }
    });
    // restored: the shipped scope again (the embers and the smoke wisps of DY-04)
    expect(carriersOf([...scopeOf('warrior', 'a', [], undefined, 'daeryeol')]).sort()).toEqual(['sk.gen.ambient_art.embers', 'sk.gen.ambient_art.smoke']);
  });

  it("production tiers of a two-loop zone: the first loop's carrier is NOW, the second's SOON, neither is LATE; the three tiers still partition the scope", () => {
    policy.lazy = true;
    try {
      withLook('daeryeol', { loops: ['ambient.motes'] }, () => {
        const cat = catalogOf('daeryeol');
        const t = cat.vfxTiers;
        expect(t).toBeDefined();
        if (!t || !cat.vfxSpecs) return;
        expect(carriersOf(t.now)).toEqual(['sk.gen.ambient_art.embers']);
        expect(carriersOf(t.soon)).toEqual(['sk.gen.ambient_art.motes']);
        expect(carriersOf(t.late)).toEqual([]);
        const all = [...t.now, ...t.soon, ...t.late];
        expect(new Set(all).size).toBe(all.length);
        expect([...all].sort()).toEqual([...cat.vfxSpecs].sort());
        // the same with a co-op partner: nothing doubles, the zone's loops do not depend on the party
        const duo = catalogOf('daeryeol', 'warrior', 'a', [{ classId: 'shaman', doctrine: 'b' }]);
        expect(carriersOf(duo.vfxTiers?.now)).toEqual(['sk.gen.ambient_art.embers']);
        expect(carriersOf(duo.vfxTiers?.soon)).toEqual(['sk.gen.ambient_art.motes']);
      });
      // a zone with no primary loop (suryeon): the first extra loop is the zone's loop (NOW), the next one SOON
      withLook('suryeon', { loops: ['ambient.leaves_autumn', 'ambient.dust'] }, () => {
        const t = catalogOf('suryeon').vfxTiers;
        expect(carriersOf(t?.now)).toEqual(['sk.gen.ambient_art.leaves_autumn']);
        expect(carriersOf(t?.soon)).toEqual(['sk.gen.ambient_art.dust']);
      });
      // a primary loop that an extra repeats under another spelling is one loop, one carrier
      withLook('daeryeol', { loops: ['ambient.embers', 'ambient.motes'] }, () => {
        const t = catalogOf('daeryeol').vfxTiers;
        expect(carriersOf(t?.now)).toEqual(['sk.gen.ambient_art.embers']);
        expect(carriersOf(t?.soon)).toEqual(['sk.gen.ambient_art.motes']);
      });
    } finally {
      policy.lazy = false;
    }
  });

  it("shipped zones in production: the first loop's carrier is NOW, the carriers of the look's extra loops are SOON (Daeryeol's smoke), nothing ambient is LATE", () => {
    policy.lazy = true;
    try {
      for (const z of content.zones) {
        const t = catalogOf(z.id).vfxTiers;
        const carriers = ambientCarrierIds(zoneAmbientLoops(z.id, z.biome));
        expect(carriersOf(t?.now), `${z.id} NOW`).toEqual(carriers.slice(0, 1));
        expect(carriersOf(t?.soon).sort(), `${z.id} SOON`).toEqual(carriers.slice(1).sort());
        expect(carriersOf(t?.late), `${z.id} LATE`).toEqual([]);
      }
      expect(ART_NOW).toBe(0);
    } finally {
      policy.lazy = false;
    }
  });
});


// ------------------------------------------------------------------------------------------------ EV-03b: the run-event presets

/** the event presets (`ev.*`) of a list of spec ids */
const eventsOf = (ids: readonly string[] | undefined): string[] => (ids ?? []).filter((id) => id.startsWith(EVENT_SPEC_PREFIX)).sort();

/** a catalog of a world whose content lists `kinds` for the zone (null = the shipped content: no zone has events) */
function eventCatalog(zone: string, kinds: readonly string[] | null): ReturnType<typeof buildCatalog> {
  const re = resolveRunEvents(content.runEvents);
  const db = kinds === null ? content : { ...content, runEvents: { ...re, zones: { [zone]: kinds } } };
  const w = createWorld(
    { zone, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 3, meta: { stats: {} } } as Parameters<typeof createWorld>[0],
    db as typeof content,
  );
  return buildCatalog(w);
}

describe('run-event presets in the art scope (EV-03b)', () => {
  const ALL = Object.values(EVENT_SPEC_KINDS).flat().sort();

  it('eventSpecIds: the presets of the listed kinds, each once; kinds without visuals, unknown kinds and an empty list add nothing', () => {
    expect(eventSpecIds(['championHunt'])).toEqual(['ev.champion']);
    expect(eventSpecIds(['bargain']).sort()).toEqual(['ev.shrine', 'ev.shrineChannel', 'ev.shrineClaim', 'ev.shrinePillar']);
    expect(eventSpecIds(['metinRain', 'metinRain'])).toEqual(['ev.rainMark']);
    expect(eventSpecIds(['goldenHour', 'mystery'])).toEqual([]);
    expect(eventSpecIds([]).length + eventSpecIds(undefined).length + eventSpecIds(null).length).toBe(0);
    expect(eventSpecIds(['bargain', 'championHunt', 'metinRain']).sort()).toEqual(ALL);
  });

  it('the event presets are registered specs (the scope can only filter what exists) and the table names exactly them', () => {
    expect(ALL.length).toBe(6);
    for (const id of ALL) expect(registry().has(id), id).toBe(true);
    expect(eventsOf([...registry()])).toEqual(ALL);
  });

  it('runSpecIds: without a zone every event preset stays (galleries, tools); with a zone only the kinds its content lists', () => {
    const ids = [...registry()];
    expect(eventsOf(runSpecIds([], [], ids))).toEqual(ALL);
    expect(eventsOf(runSpecIds([], [], ids, { ambient: '' }))).toEqual([]);
    expect(eventsOf(runSpecIds([], [], ids, { ambient: '', events: [] }))).toEqual([]);
    expect(eventsOf(runSpecIds([], [], ids, { ambient: '', events: ['championHunt'] }))).toEqual(['ev.champion']);
    expect(eventsOf(runSpecIds([], [], ids, { ambient: '', events: ['metinRain', 'bargain'] }))).toEqual(['ev.rainMark', 'ev.shrine', 'ev.shrineChannel', 'ev.shrineClaim', 'ev.shrinePillar']);
    // the other specs are untouched by the events
    const plain = runSpecIds([], [], ids, { ambient: '' }).filter((id) => !id.startsWith(EVENT_SPEC_PREFIX));
    const withEv = runSpecIds([], [], ids, { ambient: '', events: ['bargain'] }).filter((id) => !id.startsWith(EVENT_SPEC_PREFIX));
    expect(withEv).toEqual(plain);
  });

  it('the shipped content has no zone with events, so no zone packs a single event preset (dev and production)', () => {
    for (const lazy of [false, true]) {
      policy.lazy = lazy;
      try {
        for (const z of content.zones) {
          const cat = eventCatalog(z.id, null);
          expect(eventsOf(cat.vfxSpecs), `${z.id} lazy ${lazy}`).toEqual([]);
          expect(eventsOf(cat.vfxTiers?.now)).toEqual([]);
          expect(eventsOf(cat.vfxTiers?.soon)).toEqual([]);
          expect(eventsOf(cat.vfxTiers?.late)).toEqual([]);
        }
      } finally {
        policy.lazy = false;
      }
    }
  });

  it('a zone whose content lists kinds carries the presets of those kinds only; in production they are SOON (not NOW, not LATE) and the tiers still partition the scope', () => {
    const cases: [string, string[], string[]][] = [
      ['yeonmu', ['championHunt'], ['ev.champion']],
      ['seori', ['bargain'], ['ev.shrine', 'ev.shrinePillar', 'ev.shrineChannel', 'ev.shrineClaim']],
      ['suryeon', ['metinRain', 'goldenHour'], ['ev.rainMark']],
      ['daeryeol', ['metinRain', 'championHunt', 'bargain', 'goldenHour'], ALL],
    ];
    for (const [zone, kinds, want] of cases) {
      policy.lazy = false;
      expect(eventsOf(eventCatalog(zone, kinds).vfxSpecs), `${zone} dev`).toEqual([...want].sort());
      policy.lazy = true;
      try {
        const cat = eventCatalog(zone, kinds);
        expect(eventsOf(cat.vfxSpecs), `${zone} production`).toEqual([...want].sort());
        const t = cat.vfxTiers;
        expect(t).toBeDefined();
        if (!t || !cat.vfxSpecs) continue;
        expect(eventsOf(t.now), `${zone} NOW`).toEqual([]);
        expect(eventsOf(t.late), `${zone} LATE`).toEqual([]);
        expect(eventsOf(t.soon), `${zone} SOON`).toEqual([...want].sort());
        const all = [...t.now, ...t.soon, ...t.late];
        expect(new Set(all).size).toBe(all.length);
        expect([...all].sort()).toEqual([...cat.vfxSpecs].sort());
      } finally {
        policy.lazy = false;
      }
    }
  });

  it('commonTier: an event preset is SOON by the default rule (no rule names it), pinned SOON by its own spec', () => {
    for (const id of ALL) {
      expect(commonTier(id), id).toBe(ART_SOON);
      expect(SPEC_REGISTRY.find((s) => s.id === id)?.artTier, id).toBe(ART_SOON);
    }
  });
});

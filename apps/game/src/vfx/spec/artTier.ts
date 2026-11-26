// Art tiers of a run (pure: no three.js, runs in tests and in the render catalog builder).
//
// A run's art scope (artScope.ts runSpecIds) is every sprite its heroes can ever spawn; fetching all of it before the HUD
// weighs on the zone payload window (ARCHITECTURE §11). The scope is split by WHEN a spec is first needed:
//
//   NOW   (0)  the first seconds of any run: the hero's basic attack and starter skill, hits and crits (plus the hit of the
//              element those two skills deal and the status they inflict), plain spawn / death puffs, foot dust, pickups, the
//              hit the hero takes, the sprites of the zone's FIRST ambient loop when it has ambient particles, the projectile
//              effects of the ranged enemies of its first time band and the spawn / death puffs of a pack leader when that band
//              has packs with one (app/simFeed.ts firstSecondsSpecs). Awaited before the run starts (the loading screen), like
//              the whole scope used to be.
//   SOON  (1)  needed within the first minute or two: the class's card skills (the first level-ups offer them), the other
//              element hits, status loops, level-up / heal / potion, player feedback, enemy projectiles, the legacy kit's
//              sprites (smoke, rocks, glints: a kit preset that draws one before it arrives uses its procedural cell and
//              fetches it, spec/art.ts role()), the sprites of the zone's OTHER ambient loops (PL-02: a zone can run several;
//              they are a second layer of atmosphere on medium and up, spawned at frame 1 beside the first loop; until their
//              sprites land they draw the procedural cells, ambient/art.ts sheetSpr). Streamed first.
//   LATE  (2)  rare or deep into the run: bosses, metins, elite / boss deaths and spawns (a first-band pack leader's are NOW,

//
// Only production (and `?payload=1`) streams SOON / LATE (render/payloadPolicy.ts); the dev server, the galleries and the QA
// captures await everything up front, so their pictures never depend on how long the page has been open. A spec that plays
// before its art has arrived draws its procedural fallback and requests the art at once (spec/host.ts ensureArt).
//
// The tier is derived from the spec id and its owners, so a builder file never declares one. A spec can still pin it
// (`FxSpec.artTier`, spec/types.ts) when the rules below guess wrong; the rules are the default, not a contract.
import { isDevSpec, specOwnerIndex, type ScopeLoadout, type ScopeSkill } from './artScope';

export type ArtTier = 0 | 1 | 2;
export const ART_NOW: ArtTier = 0;
export const ART_SOON: ArtTier = 1;
export const ART_LATE: ArtTier = 2;

/** a skill with the fields the tier rules read besides the scope ones (data/schema SkillDef satisfies it structurally) */
export interface TierSkill extends ScopeSkill {
  /** 'basic' | 'active' | 'ultimate' */
  kind?: string | null;
  /** 'physical' | 'fire' | … (the hit spec `hit.<element>` of the skill) */
  element?: string | null;
  /** `params.status` of data/schema SkillDef: the status the skill can inflict */
  params?: { status?: { kind?: string | null } | null } | null;
}

/** a hero of the run plus the skill ids it starts with (doctrine `basic` + `starter`) */
export interface TierLoadout extends ScopeLoadout {
  starts?: readonly string[] | null;
}

/** the run's scope split by tier (ids of spec presets; the three lists are disjoint and together are the scope) */
export interface RunArtTiers {
  readonly now: readonly string[];
  readonly soon: readonly string[];
  readonly late: readonly string[];
}

/**
 * Common specs (no skill owns them) by id. First match wins; an id no rule names is SOON. Exact ids and prefixes ending in
 * '.' or '_' are matched with startsWith. NOT here: the hero's own element hit (`hit.<element>`), added per run.
 */
export const COMMON_TIER_RULES: readonly (readonly [string, ArtTier])[] = [
  // ---- NOW: on screen in the first seconds of every run
  ['sk.gen.spawn_ring', ART_NOW], // band / pack spawn whisper (second 0)
  ['spawn.ring', ART_NOW],
  ['sk.gen.hit', ART_NOW], // physical hit + the critical / piercing add-ons
  ['sk.gen.critical', ART_NOW],
  ['sk.gen.penetrate', ART_NOW],
  ['hit.physical', ART_NOW],
  ['sk.gen.monster_die', ART_NOW], // a plain kill
  ['sk.gen.dust', ART_NOW], // foot dust from the first step
  ['sk.gen.running_dust', ART_NOW],
  ['sk.gen.pickup_art', ART_NOW], // carrier: the sprites the pickup presets draw (the first kill drops one)
  ['hit.player', ART_NOW], // the first hit the hero takes: 7.0-15.1 s in 5 observed runs, one per class (~90 kB of its own)
  // ---- LATE: rare, or deep into a run
  ['sk.gen.metin_', ART_LATE], // metin stones: first at `metins.firstAt`, their effects when one is hit
  ['metin.', ART_LATE],
  ['sk.gen.boss_', ART_LATE],
  ['boss.', ART_LATE],
  ['death.boss', ART_LATE],
  ['death.elite', ART_LATE],
  ['death.metin', ART_LATE],
  ['spawn.elite', ART_LATE],
  ['spawn.corrupt', ART_LATE],
  ['spawn.summon', ART_LATE],
  ['sk.gen.monster_appear', ART_LATE], // summon vortex
  ['summon.', ART_LATE],
  ['burst.', ART_LATE],
  ['player.revive', ART_LATE],
  ['player.death', ART_LATE],
  // ---- SOON on purpose (PL-02): the carrier of the zone's FIRST ambient loop is NOW through `extraNow` (app/simFeed.ts firstSecondsSpecs); the carriers of its other loops
  // (look.ambientLoops) are named here so the default is a decision, not an accident
  ['sk.gen.ambient_art.', ART_SOON],
];

/**
 * The specs that draw a status on an enemy, by status kind (vfx/skills/common/statusFeed.ts loops + the DoT tick puffs of
 * vfx/common/status/route.ts). A start skill that inflicts the status puts them in NOW: its first hit may well apply it.
 */
export const STATUS_SPECS: Readonly<Record<string, readonly string[]>> = {
  stun: ['sk.gen.stun_loop', 'sk.gen.stun'],
  burn: ['sk.gen.fire_loop', 'hit.dot.burn'],
  poison: ['sk.gen.poison_loop', 'hit.dot.poison'],
  slow: ['sk.gen.slow_loop'],
  bleed: ['hit.dot.bleed'],
};

/** the enemy projectile specs of a hostile attack's `projectile.vfx` (`proj.hostile.fire` / `proj.arrow.physical`: look = the last part) */
export function enemyProjectileSpecs(vfx: string): string[] {
  const m = /^proj\.(?:hostile|arrow)\.([a-z]+)$/.exec(vfx);
  return m ? ['making', 'release', 'blow'].map((stage) => `sk.gen.ep_${stage}_${m[1]}`) : [];
}

/** the tier of a common spec by the rules above (default SOON) */
export function commonTier(id: string): ArtTier {
  for (const [key, tier] of COMMON_TIER_RULES) {
    if (id === key || ((key.endsWith('.') || key.endsWith('_')) && id.startsWith(key))) return tier;
  }
  return ART_SOON;
}

/**
 * Splits a run's scope (`scope` = runSpecIds output) into tiers. A spec owned by skills is NOW when one of its owners is a
 * start skill of a hero, LATE when every owner is an ultimate, else SOON; a common spec follows COMMON_TIER_RULES, and
 * `hit.<element>` of every start skill's element is NOW, and so are the specs of the status it can inflict (STATUS_SPECS)
 * and the common specs in `extraNow` (facts of the run the rules cannot know: the zone has ambient particles, so
 * the carrier of its first loop, `sk.gen.ambient_art.<name>`, is on screen at frame 1; an enemy of the first time band shoots, so its projectile specs are). `pinned` pins a spec
 * (FxSpec.artTier); it wins over the rules. Without any `starts` (a loadout list without them) nothing is a start skill and
 * the owned specs are all SOON.
 */
export function runArtTiers(
  skills: readonly TierSkill[],
  loadouts: readonly TierLoadout[],
  scope: Iterable<string>,
  pinned?: (specId: string) => ArtTier | undefined,
  extraNow?: Iterable<string>,
): RunArtTiers {
  const owners = specOwnerIndex(skills);
  const starts = new Set<string>();
  const hitNow = new Set<string>(extraNow);
  const byId = new Map<string, TierSkill>();
  for (const s of skills) byId.set(s.id, s);
  for (const l of loadouts) {
    for (const id of l.starts ?? []) {
      starts.add(id);
      const def = byId.get(id);
      if (def?.element) hitNow.add(`hit.${def.element}`);
      for (const spec of STATUS_SPECS[def?.params?.status?.kind ?? ''] ?? []) hitNow.add(spec);
    }
  }
  const out: { now: string[]; soon: string[]; late: string[] } = { now: [], soon: [], late: [] };
  for (const id of scope) {
    if (isDevSpec(id)) continue;
    let tier = pinned?.(id);
    if (tier === undefined) {
      const own = owners(id);
      if (own === null) tier = hitNow.has(id) ? ART_NOW : commonTier(id);
      else if (own.some((s) => starts.has(s.id))) tier = ART_NOW;
      else if (own.every((s) => (s as TierSkill).kind === 'ultimate')) tier = ART_LATE;
      else tier = ART_SOON;
    }
    (tier === ART_NOW ? out.now : tier === ART_SOON ? out.soon : out.late).push(id);
  }
  return out;
}

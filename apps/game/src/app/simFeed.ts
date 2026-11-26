// Adapters from the sim World to the render contracts (render/feed.ts). The sim stores satisfy the feed interfaces
// structurally, so no per-frame copying happens here.
import type { ZoneDef } from '../data/schema';
import type { EnemyStreamDef, ProjectileStyleDef, RenderCatalog, RenderFeeds } from '../render/feed';
import type { MetinLoadDef } from '../render/metin';
import { lazyContent } from '../render/payloadPolicy';
import { zoneEventKinds, type ContentIndex } from '../sim/content';
import { EnemyFlag, EnemyState } from '../sim/stores';
import type { World } from '../sim/world';
import type { EventAdapter } from '../vfx/adapter';
import { setCreatureRadii } from '../vfx/common/death-spawn/route';
import { setRunEventSource, type RunEventSource } from '../vfx/common/events';
import type { QualityTier } from '../render/quality';
import { findLook, loopsOf, resolveBiome } from '../render/terrain/look';
import { ambientCarrierId, ambientLoopList, runSpecIds } from '../vfx/spec/artScope';
import { enemyProjectileSpecs, runArtTiers } from '../vfx/spec/artTier';
import { SPEC_REGISTRY } from '../vfx/spec/preset';

/** a creature that can be on screen within this many run seconds is loaded and baked before the run starts */
export const CREATURE_NOW_HORIZON = 30;

/**
 * Earliest run second each creature type (index into the sim type table) can be on screen, from the zone's schedule:
 * the band that spawns it (the first band is live from second 0 whatever its `from`), a boss / the final boss and their
 * escorts (the `at` they arrive), the metin swarms (the first stone falls at `metins.firstAt`) and the great metin's
 * swarm (the final wave). Types the schedule never mentions are absent.
 */
export function creatureFirstSeen(zone: ZoneDef, ix: Pick<ContentIndex, 'typeIndex' | 'bosses' | 'metins'>): Map<number, number> {
  const first = new Map<number, number>();
  const note = (id: string | undefined, at: number): void => {
    const i = id === undefined ? undefined : ix.typeIndex.get(id);
    if (i !== undefined && at < (first.get(i) ?? Infinity)) first.set(i, at);
  };
  const bands = [...zone.bands].sort((a, b) => a.from - b.from);
  bands.forEach((band, k) => {
    const at = k === 0 ? 0 : band.from;
    for (const s of band.spawns) {
      note(s.enemy, at);
      note(s.group?.leader, at);
      for (const m of s.group?.members ?? []) note(m, at);
    }
    for (const id of band.elites?.pool ?? []) note(id, at);
  });
  for (const b of [...zone.bosses, { at: zone.final.at, boss: zone.final.boss }]) {
    note(b.boss, b.at);
    for (const e of ix.bosses.get(b.boss)?.escorts ?? []) note(e, b.at);
  }
  const swarm = (id: string, at: number): void => {
    for (const e of ix.metins.get(id)?.swarm.enemies ?? []) note(e, at);
  };
  for (const id of zone.metins.types) swarm(id, zone.metins.firstAt);
  swarm(zone.final.greatMetin, zone.final.at);
  return first;
}

/**
 * Splits the creature types a run can meet into those loaded and baked before it starts (`now`: on screen within
 * CREATURE_NOW_HORIZON seconds) and those streamed in the background ahead of their first appearance (`later`, with that
 * second). Time bands are 180 s apart, so a zone's first band is all that blocks the load; later bands, bosses and
 * metin swarms stream behind the first minute (render/crowd/crowd.ts). `used` = the sim's `usedTypes`, a fallback for
 * types the schedule does not explain (they load now).
 */
export function creatureLoadPlan(zone: ZoneDef, ix: Pick<ContentIndex, 'typeIndex' | 'bosses' | 'metins'>, used: readonly number[]): { now: number[]; later: EnemyStreamDef[] } {
  const first = creatureFirstSeen(zone, ix);
  const all = new Set<number>([...used, ...first.keys()]);
  const now: number[] = [];
  const later: EnemyStreamDef[] = [];
  for (const type of [...all].sort((a, b) => a - b)) {
    const at = first.get(type) ?? 0;
    if (at <= CREATURE_NOW_HORIZON) now.push(type);
    else later.push({ type, at });
  }
  later.sort((a, b) => a.at - b.at || a.type - b.type);
  return { now, later };
}

/**
 * The ambient VFX loops of a zone, in spawn order (PL-02): the resolved look's `biome.particles` first, then the look's extra `ambientLoops`
 * (A0-LOOK `loopsOf`), each loop once; [] for a zone without any. The one list RunSession.load spawns from and buildCatalog packs the art
 * of, so the sprites of a loop are always in the run scope when it plays. The first entry is the zone's own loop (NOW, the only one on low).
 */
export function zoneAmbientLoops(zoneId: string, biome: ZoneDef['biome']): string[] {
  return ambientLoopList(resolveBiome(zoneId, biome).particles, loopsOf(findLook(zoneId)));
}

/** the loops of `loops` a quality tier spawns: low (phones) only the first, every other tier all of them */
export function ambientLoopsForTier(loops: readonly string[], tier: QualityTier): string[] {
  return tier === 'low' ? loops.slice(0, 1) : loops.slice();
}

/**
 * Common specs this run shows in its first seconds that no rule can know: the ambient sprites of the zone's FIRST loop when its particle loop
 * starts at frame 1 (RunSession.load; `loops` = `zoneAmbientLoops`, [] = none; the other loops' sprites are SOON, artTier.ts), the projectile effects of the ranged enemies of its first time band (`firstBand` =
 * the creature types that are loaded before the run starts, creatureLoadPlan), and the arrival / death puffs of a pack
 * leader when the first band has packs with one (the spawner makes a leader tier 2: `spawn.elite` when it appears, 1.0-9.4 s
 * in 5 observed yeonmu runs, `death.boss` when it dies, 8.2-19.8 s; vfx/common/death-spawn/route.ts).
 */
function firstSecondsSpecs(world: World, firstBand: readonly number[], loops: readonly string[]): string[] {
  const firstLoop = ambientCarrierId(loops[0] ?? '');
  const out: string[] = firstLoop ? [firstLoop] : [];
  for (const type of firstBand) {
    for (const a of world.typeDefs[type]?.attacks ?? []) if (a.projectile) out.push(...enemyProjectileSpecs(a.projectile.vfx));
  }
  // the first band is live from second 0 whatever its `from` (creatureFirstSeen)
  const first = [...world.zone.bands].sort((a, b) => a.from - b.from)[0];
  if (first?.spawns.some((s) => s.group?.leader !== undefined)) out.push('spawn.elite', 'death.boss');
  return out;
}

/** the skill ids a hero of `classId` / `doctrine` starts a run with: its basic attack and its starter skill */
function startSkills(world: World, classId: string, doctrine: string): string[] {
  const d = world.content.classes.find((c) => c.id === classId)?.doctrines.find((x) => x.id === doctrine);
  return d ? [d.basic, d.starter] : [];
}

/**
 * Builds the render catalog from the run's content (index order == sim type tables). Only what this zone can spawn is
 * fetched: its creatures (`enemyUsed` now, `enemyLater` streamed ahead of their time band / boss / metin swarm, see
 * creatureLoadPlan) and its metins: the zone's stones are first needed at `metins.firstAt` and stream in from second 12
 * (production, `lazyContent()`; the dev server loads them with the run), its great metin falls at the final wave
 * (`final.at`), so that GLB streams in ahead of it instead of weighing on the blocking zone load (see sim/metins.ts
 * updateMetins, render/metin.ts). The same
 * goes for the generated VFX sprites: `vfxSpecs` lists the skill specs the heroes of the run can spawn (class + chosen
 * doctrine of every co-op hero, the common pool, talent ultimates, the common `sk.gen.*` effects), so only their art is
 * packed (vfx/spec/artScope.ts); `vfxTiers` (production only) splits that list by when a spec is first needed, so the run
 * awaits the first seconds' sprites and the rest streams in behind the HUD (vfx/spec/artTier.ts).
 */
export function buildCatalog(world: World): RenderCatalog {
  const zoneMetins = new Set(world.zone.metins.types);
  const { greatMetin: great, at: finalAt } = world.zone.final;
  // the dev server loads every creature with the run (QA captures); a production build streams the later ones (payloadPolicy)
  const lazy = lazyContent();
  const plan = lazy ? creatureLoadPlan(world.zone, world.ix, world.usedTypes) : { now: world.usedTypes.slice(), later: [] };
  // the zone's own stones (model + glyphs, ~0.7 MB) are not needed before `metins.firstAt`: streamed behind the first seconds
  const stone: Pick<MetinLoadDef, 'load' | 'at'> = lazy ? { load: 'stream', at: world.zone.metins.firstAt } : { load: 'now' };
  // the generated VFX sprites: every hero's class + doctrine (and the skills it starts with, for the art tiers)
  const loadouts = world.players.map((p, i) => ({
    classId: p.classId,
    doctrine: p.doctrine,
    extraSkills: i === 0 ? world.config.meta.extraSkills : world.config.coop?.[i - 1]?.meta.extraSkills,
    starts: startSkills(world, p.classId, p.doctrine),
  }));
  // the zone's ambient loops are fixed for the whole run (RunSession.load spawns resolveBiome(...).particles + look.ambientLoops): only their sprites are packed
  const loops = zoneAmbientLoops(world.zone.id, world.zone.biome);
  // EV-03b: the run-event presets (shrine, champion ring, rain mark) are packed only for a zone whose content lists the kinds (a zone without events: none)
  const vfxSpecs = runSpecIds(world.content.skills, loadouts, SPEC_REGISTRY.map((s) => s.id), { ambient: loops, events: zoneEventKinds(world.ix, world.zone.id) });
  const specById = new Map(SPEC_REGISTRY.map((s) => [s.id, s]));
  return {
    enemyTypes: world.typeDefs.map((d) => ({
      key: d.id,
      modelId: d.model,
      tint: d.tint,
      tintMode: d.tintMode,
      // d.radius is the collision radius at final scale; the crowd multiplies by the per-instance scale itself
      radius: d.radius / Math.max(d.scale, 0.01),
    })),
    enemyUsed: plan.now,
    enemyLater: plan.later,
    projectileStyles: [],
    vfxSpecs,
    // production: only the first seconds' sprites are awaited, the rest streams in behind the HUD (artTier.ts); the dev
    // server awaits the whole scope like before
    vfxTiers: lazy ? runArtTiers(world.content.skills, loadouts, vfxSpecs, (id) => specById.get(id)?.artTier, firstSecondsSpecs(world, plan.now, loops)) : undefined,
    metinTypes: world.metinDefs.map(
      (m): MetinLoadDef =>
        m.id === great
          ? { key: m.id, modelId: m.model, rune: m.rune, load: 'stream', at: finalAt }
          : zoneMetins.has(m.id)
            ? { key: m.id, modelId: m.model, rune: m.rune, ...stone }
            : { key: m.id, modelId: m.model, rune: m.rune, load: 'skip' },
    ),
  };
}

/** The live feeds for a world. Created once per run; the arrays are the sim's own. */
export function worldFeeds(world: World): RenderFeeds {
  return {
    enemies: world.enemies,
    players: world.players,
    projectiles: world.projectiles,
    pickups: world.pickups,
    telegraphs: world.telegraphs,
    metins: world.metins,
  };
}

const ELEMENT_COLORS: [RegExp, string, string][] = [
  [/fire|flame|ember|burn|inferno|meteor/, '#ff7a1a', '#ffd27a'],
  [/ice|frost|freez|snow|glaci/, '#7fdcff', '#eefcff'],
  [/lightning|thunder|spark|shock|bolt|storm/, '#ffe45a', '#ffffff'],
  [/dark|shadow|ghost|void|curse|death/, '#a24bff', '#2a0c4d'],
  [/poison|toxic|venom|plague|acid/, '#7bff52', '#d9ffb0'],
  [/holy|light|divine|bless|gold|dragon/, '#ffd35a', '#fff6cf'],
  [/wind|air|gale/, '#bff6e0', '#ffffff'],
  [/blood|wolf|claw|rend|rip/, '#ff3a3a', '#ffc2a0'],
];

/** Heuristic projectile look from the interned vfx/style name (the sim only stores the string id). */
export function styleFromName(name: string, hostile: boolean): ProjectileStyleDef {
  const n = name.toLowerCase();
  let color = '#fff2c4';
  let core = '#ffffff';
  for (const [re, c, k] of ELEMENT_COLORS) {
    if (re.test(n)) {
      color = c;
      core = k;
      break;
    }
  }
  let shape: ProjectileStyleDef['shape'] = 'orb';
  if (/arrow|shot|volley|dart|needle/.test(n)) shape = 'arrow';
  else if (/blade|sword|slash|cut|crescent|aura_sword|dagger|knife|wave/.test(n)) shape = 'blade';
  else if (/talisman|charm|seal|fan|bell|paper|spirit/.test(n)) shape = 'talisman';
  else if (/lightning|thunder|bolt|chain|spark/.test(n)) shape = 'bolt';
  if (hostile) {
    color = '#ff3a2a';
    core = '#ffd0a0';
  }
  // `sk.*` skill specs draw their own projectile body through the VFX layer (app/skillVfxFeed)
  return { shape, color, core, length: shape === 'arrow' ? 3 : shape === 'blade' ? 2 : 1.4, trail: 0.12, hidden: n.startsWith('sk.') || undefined };
}

/** Keeps a style table aligned with `world.strings.names` (index = interned id). */
export class ProjectileStyleTable {
  readonly table: ProjectileStyleDef[] = [];
  private seen = 0;

  /** Returns true when the table grew and must be pushed to the renderer. */
  sync(world: World): boolean {
    const names = world.strings.names;
    if (names.length === this.seen) return false;
    for (let i = this.seen; i < names.length; i++) this.table[i] = styleFromName(names[i] as string, false);
    this.seen = names.length;
    return true;
  }
}

/**
 * Where the Champion Hunt's champion stands right now, for the ring that rides it (vfx/common/events/route.ts): the one enemy row of the run flagged
 * `EnemyFlag.Leader` (sim/runEvents.ts sets the bit on the champion only; it rides the snapshot flags column, so a co-op guest finds it the same way),
 * the one nearest to the hint (the last known spot) when there could be several. The row is remembered by its stable id (one `find` a frame);
 * a lost row is searched again (one pass over the rows, only while the hunt runs) and a Dying row counts as gone. The world is held weakly: a finished run is not kept alive.
 */
export function championLocator(world: World): NonNullable<RunEventSource['champion']> {
  const ref = new WeakRef(world);
  let id = 0;
  return (x, z, out) => {
    const w = ref.deref();
    if (w === undefined) return false;
    const e = w.enemies;
    let row = id !== 0 ? e.find(id) : -1;
    if (row >= 0 && (((e.flags[row] as number) & EnemyFlag.Leader) === 0 || e.state[row] === EnemyState.Dying)) row = -1;
    if (row < 0) {
      id = 0;
      let best = Infinity;
      for (let i = 0; i < e.count; i++) {
        if (((e.flags[i] as number) & EnemyFlag.Leader) === 0 || e.state[i] === EnemyState.Dying) continue;
        const d = ((e.x[i] as number) - x) ** 2 + ((e.z[i] as number) - z) ** 2;
        if (d < best) {
          best = d;
          row = i;
        }
      }
      if (row < 0) return false;
      id = e.id[row] as number;
    }
    out.x = e.x[row] as number;
    out.z = e.z[row] as number;
    return true;
  };
}

/** What the run-event visuals cannot read from the events: the champion's live position, the stones' rune colours, the shrine's channel radius, the span of the rain's stones */
export function runEventSource(world: World): RunEventSource {
  const runes = new Map<string, number>();
  for (const m of world.metinDefs) {
    const c = parseInt(m.rune.replace('#', ''), 16);
    if (Number.isFinite(c)) runes.set(m.id, c);
  }
  const kinds = world.ix.runEvents.kinds;
  return { champion: championLocator(world), rune: (def) => runes.get(def), shrineRadius: kinds.bargain.radius, rainWithin: kinds.metinRain.within };
}



export function configureVfxEvents(events: EventAdapter, world: World): void {
  events.setDeathPresets(world.typeDefs.map((d) => (d.race[0] === 'metin' ? 'death.metin' : 'sk.gen.monster_die')));
  // death / spawn smoke is sized from the creature's radius (death-spawn route), not only from its model scale
  setCreatureRadii(world.typeDefs.map((d) => (d.scale > 0 ? d.radius / d.scale : d.radius)));
  const runes: Record<string, string> = {};
  for (const m of world.metinDefs) runes[m.id] = m.rune;
  events.setMetinRunes(runes);
  setRunEventSource(runEventSource(world));
}

// Lazy skill packs: the hand specs and the generated families of a hero class live in their own chunk (skills/<class>/index.ts) that a run
// loads BEFORE it starts (RunSession.load: ensureSkillVfx(the classes of the party)). Why: the eager vfx chunk was 1,468 kB of the 1,500 kB
// warning limit with 216 hand specs and no family; the 63 generated families add 0.3-0.5 MB and must not weigh on the menu

//
// This file is EAGER and tiny: the class list, one literal dynamic import per pack (the bundler sees each literal and emits one chunk per
// pack; vite.config.ts keeps skills/<class>/, skills/shared/ and skills/_gen/ out of the eager `vfx` group), and the install step.
//
//   ensureSkillVfx(['warrior'])   a run / the hero-select prefetch: the pack of each class + the common pack (skills/shared), idempotent,
//                                 in-flight loads are shared, rejects when a chunk cannot be fetched (the caller shows loadFailureMessage)
//   ensureAllSkillVfx()           every pack: the gallery, QA tools, tests (beforeAll / top-level await)
//   loadedSkillClasses()          the packs that are installed
//
// Install (installSkillPack): the pack's specs become presets (specPreset, which also fills SPEC_REGISTRY), join SKILL_SPECS / SKILL_PRESETS and
// PRESETS, and every live VfxSystem is told (presets/addPresets → VfxSystem.addPresets: defs, cast / explode tables, spec compile, so the
// first cast pays nothing). ORDER: whatever order the packs arrive in, the registries list them behind everything else in PACK ORDER
// (warrior, ninja, yacha, shaman, wolfman, common), so the same set of loaded classes always gives the same registry.
import { addPresets, PRESETS } from '../presets';
import type { PresetDef } from '../presets/types';
import { SPEC_REGISTRY, specPreset } from '../spec/preset';
import type { FxSpec } from '../spec/types';
import type { SkillPack } from './families';
import { SKILL_PRESETS, SKILL_SPECS } from './index';

/** the five hero classes, in registry order */
export const ALL_SKILL_CLASSES = ['warrior', 'ninja', 'yacha', 'shaman', 'wolfman'] as const;
export type SkillClassId = (typeof ALL_SKILL_CLASSES)[number];
/** the packs in registry order: the classes, then `common` (skills/shared: the generated families of the common skills; every run loads it) */
export const SKILL_PACKS = [...ALL_SKILL_CLASSES, 'common'] as const;
export type SkillPackId = (typeof SKILL_PACKS)[number];

export type PackLoader = () => Promise<{ default: SkillPack }>;

/** one literal import() per pack: the bundler needs to see each path to give it its own chunk (bun and vitest resolve them too) */
const PACK_LOADERS: Record<SkillPackId, PackLoader> = {
  warrior: () => import('./warrior/index'),
  ninja: () => import('./ninja/index'),
  yacha: () => import('./yacha/index'),
  shaman: () => import('./shaman/index'),
  wolfman: () => import('./wolfman/index'),
  common: () => import('./shared/index'),
};

// ------------------------------------------------------------------------------------------------ install

const installed = new Map<string, { specs: readonly FxSpec[]; presets: readonly PresetDef[] }>();

/** removes the entries of `arr` that `drop` selects, in place (the registries are shared arrays) */
function removeWhere<T>(arr: T[], drop: (x: T) => boolean): void {
  let w = 0;
  for (const x of arr) if (!drop(x)) arr[w++] = x;
  arr.length = w;
}

/** moves `items` behind everything else in `arr` (in place), in the given order */
function moveToTail<T>(arr: T[], items: readonly T[]): void {
  const mine = new Set(items);
  removeWhere(arr, (x) => mine.has(x));
  for (const x of items) arr.push(x);
}

/**
 * Adds one pack to the registries and tells the live VfxSystems. An id the registry has already (a common family over its eager hand
 * spec, the `?fam=` dev switch) is replaced by the pack's spec, never duplicated. A class installs once; a second call is a no-op.
 */
export function installSkillPack(pack: SkillPack): void {
  if (installed.has(pack.classId)) return;
  const ids = new Set(pack.specs.map((s) => s.id));
  const stale = (x: { id: string }): boolean => ids.has(x.id);
  removeWhere(SPEC_REGISTRY, stale);
  removeWhere(SKILL_SPECS, stale);
  removeWhere(SKILL_PRESETS, stale);
  const presets = pack.specs.map(specPreset);
  installed.set(pack.classId, { specs: pack.specs, presets });
  SKILL_SPECS.push(...pack.specs);
  SKILL_PRESETS.push(...presets);
  addPresets(presets);
  // pack order, whatever the arrival order was
  const inOrder = SKILL_PACKS.flatMap((c) => installed.get(c) ?? []);
  moveToTail(SPEC_REGISTRY, inOrder.flatMap((p) => p.specs));
  moveToTail(SKILL_SPECS, inOrder.flatMap((p) => p.specs));
  moveToTail(SKILL_PRESETS, inOrder.flatMap((p) => p.presets));
  moveToTail(PRESETS, inOrder.flatMap((p) => p.presets));
}

// ------------------------------------------------------------------------------------------------ loading

export interface PackLoaderApi {
  /** loads (once) and installs the packs of `ids` plus `common`; unknown ids and `common` itself are ignored */
  ensure(ids: Iterable<string>): Promise<void>;
  loaded(): ReadonlySet<string>;
}

/**
 * The loading logic over any set of loaders (the real one below; unit tests pass fakes). Rules: a pack is fetched once, concurrent callers
 * share the in-flight promise, a failed fetch is forgotten so the next call tries again, and packs install in PACK order as soon as the
 * call's own packs are all settled (a pack that arrived for another caller meanwhile installs too).
 */
export function createPackLoader(loaders: Readonly<Record<string, PackLoader>>, order: readonly string[], install: (pack: SkillPack) => void): PackLoaderApi {
  const inflight = new Map<string, Promise<void>>();
  const arrived = new Map<string, SkillPack>();
  const done = new Set<string>();
  const load = (id: string): Promise<void> => {
    if (done.has(id) || arrived.has(id)) return Promise.resolve();
    let p = inflight.get(id);
    if (p === undefined) {
      p = (loaders[id] as PackLoader)().then(
        (mod) => {
          inflight.delete(id);
          arrived.set(id, mod.default);
        },
        (err: unknown) => {
          inflight.delete(id);
          throw err;
        },
      );
      inflight.set(id, p);
    }
    return p;
  };
  const flush = (): void => {
    for (const id of order) {
      const pack = arrived.get(id);
      if (pack === undefined) continue;
      arrived.delete(id);
      done.add(id);
      install(pack);
    }
  };
  return {
    async ensure(ids) {
      const want = new Set<string>(loaders['common'] !== undefined ? ['common'] : []);
      for (const id of ids) if (loaders[id] !== undefined) want.add(id);
      const results = await Promise.allSettled(order.filter((id) => want.has(id)).map(load));
      flush();
      for (const r of results) if (r.status === 'rejected') throw r.reason;
    },
    loaded: () => done,
  };
}

const loader = createPackLoader(PACK_LOADERS, SKILL_PACKS, installSkillPack);

/**
 * Makes the skill effects of these hero classes (and the common ones) available: their lazy chunks are fetched, installed in the
 * registries and compiled by every live VfxSystem. Await it before the run's render catalog is built (buildCatalog reads SPEC_REGISTRY).
 * Rejects when a chunk cannot be fetched (stale hashes after a deploy, offline).
 */
export function ensureSkillVfx(classIds: Iterable<string>): Promise<void> {
  return loader.ensure(classIds);
}

/** every pack: galleries, QA tools, tests */
export function ensureAllSkillVfx(): Promise<void> {
  return loader.ensure(ALL_SKILL_CLASSES);
}

/** the installed packs (class ids and `common`) */
export function loadedSkillClasses(): ReadonlySet<string> {
  return loader.loaded();
}

/**
 * The hero classes a run needs: the class of every hero of the party (co-op: all of them) plus the class of every skill a hero holds
 * from outside its pool (`extraSkills` of its meta: talent ultimates may name a skill of ANOTHER class, the rule of spec/artScope.ts runSpecIds).
 */
export function skillClassesOf(
  skills: readonly { id: string; classId: string }[],
  loadouts: readonly { classId: string; extraSkills?: readonly string[] | null }[],
): string[] {
  const classOf = new Map(skills.map((s) => [s.id, s.classId] as const));
  const out = new Set<string>();
  for (const l of loadouts) {
    out.add(l.classId);
    for (const id of l.extraSkills ?? []) {
      const c = classOf.get(id);
      if (c !== undefined) out.add(c);
    }
  }
  return [...out];
}

/** the part of a sim World that decides which classes a run needs (structural: the loader stays free of sim imports) */
export interface PartyWorld {
  readonly players: readonly { readonly classId: string }[];
  readonly config: {
    readonly meta: { readonly extraSkills?: readonly string[] | null };
    /** co-op: the meta of the partners, in world order after the local hero */
    readonly coop?: readonly { readonly meta: { readonly extraSkills?: readonly string[] | null } }[];
  };
  readonly content: { readonly skills: readonly { id: string; classId: string }[] };
}

/** the classes RunSession.load must have before it builds the render catalog (same loadouts as app/simFeed.ts buildCatalog) */
export function runSkillClasses(world: PartyWorld): string[] {
  const loadouts = world.players.map((p, i) => ({ classId: p.classId, extraSkills: i === 0 ? world.config.meta.extraSkills : world.config.coop?.[i - 1]?.meta.extraSkills }));
  return skillClassesOf(world.content.skills, loadouts);
}

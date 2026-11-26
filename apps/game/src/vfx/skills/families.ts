// Registry of GENERATED skill families (spec/README.md "Generated families + patches").
//

// (`<class>/<id>.patch.ts`) instead of a hand spec. A one-line wiring file next to the patch registers it:
//
//   // skills/warrior/bash.family.ts   (found by the CLASS entry skills/warrior/index.ts through import.meta.glob('./*.family.ts'))
//   import { registerPatchedFamily } from '../families';
//   import { GEN } from '../_gen/bash.gen';
//   import { PATCH } from './bash.patch';
//   registerPatchedFamily('bash', GEN, PATCH, { live: true });
//
// `live: true` = the family replaces ALL hand specs of that skill (`sk.<id>` and `sk.<id>.<part>`; companions the family does not
// have, e.g. `.explode`, come back through the patch's `addSpecs`), except the hand specs flagged `moment: true` (FxSpec.moment: the

// `live: false` (default) registers it for tooling only and the
// hand spec stays in charge, so nothing changes visually. Dev switch for a look in the game or the gallery without editing code:
// `?fam=bash,bladewheel` on the page URL (DEV builds) makes those registered families live. A wiring file also puts the gen file
// into the bundle: wire a skill only when its family is meant to ship.
//
// LAZY CLASS CHUNKS: the wiring files of a class (and the gen files they import) are part of that class's lazy chunk, not of the eager
// vfx chunk. The class entry `skills/<class>/index.ts` evaluates its own wiring files, then exports `classPack(classId, hand, wiring)`: its
// hand specs with the live families swapped in. `skills/loader.ts` loads the entries a run needs (ensureSkillVfx) and installs the packs.
// Common skills (classId `common`: stallion_stomp, arc_of_might ...) wire their families in `skills/shared/` (loaded by EVERY run).
import { applyPatch, checkPatch, type KeyTable, type SkillPatch } from '../spec/patch';
import type { FxSpec } from '../spec/types';

export interface SkillFamily {
  readonly skillId: string;
  readonly specs: readonly FxSpec[];
  readonly live: boolean;
}

const FAMILIES = new Map<string, SkillFamily>();

/** does spec id `id` belong to skill `skillId` (`sk.<skillId>` or `sk.<skillId>.<part>`)? */
export function belongsToSkill(id: string, skillId: string): boolean {
  return id === `sk.${skillId}` || id.startsWith(`sk.${skillId}.`);
}

/** register the (already patched) specs of skill `skillId`; a second registration of the same skill replaces the first */
export function registerSkillFamily(skillId: string, family: readonly FxSpec[], opts: { live?: boolean } = {}): void {
  for (const s of family) {
    if (!belongsToSkill(s.id, skillId)) throw new Error(`registerSkillFamily(${skillId}): spec ${s.id} is not sk.${skillId}[.part]`);
  }
  if (!family.some((s) => s.id === `sk.${skillId}`)) throw new Error(`registerSkillFamily(${skillId}): the family has no body spec sk.${skillId}`);
  FAMILIES.set(skillId, { skillId, specs: family, live: opts.live === true });
}

/**
 * gen + patch → register. Stale patch entries are logged in DEV builds (the vitest gate fails on them). A family that cannot be built
 * (a patch function that throws on a regenerated element, a spec id outside the skill ...) is NOT registered: the error is logged and
 * the hand spec of the skill stays in charge, because one broken wiring file must never take the whole game down (every wiring file
 * is imported by its class entry); skillFamilies.test.ts fails on it.
 */
export function registerPatchedFamily<K extends KeyTable>(skillId: string, gen: readonly FxSpec[], patch: SkillPatch<K>, opts: { live?: boolean } = {}): void {
  try {
    if (import.meta.env?.DEV) {
      const bad = checkPatch(gen, patch).filter((i) => i.level === 'error');
      if (bad.length > 0) console.warn(`[vfx] patch of ${skillId}: ${bad.map((i) => i.message).join('; ')}`);
    }
    registerSkillFamily(skillId, applyPatch(gen, patch), opts);
  } catch (e) {
    console.error(`[vfx] family ${skillId} not registered (the hand spec stays): ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function skillFamilies(): readonly SkillFamily[] {
  return [...FAMILIES.values()];
}

export function skillFamily(skillId: string): SkillFamily | undefined {
  return FAMILIES.get(skillId);
}

/** skill ids named by `?fam=a,b` (DEV builds in a browser); empty elsewhere */
export function devLiveFamilies(): ReadonlySet<string> {
  try {
    if (import.meta.env?.DEV && typeof location !== 'undefined') {
      const v = new URLSearchParams(location.search).get('fam');
      if (v) return new Set(v.split(',').filter(Boolean));
    }
  } catch {
    // no location (node, workers): no dev switch
  }
  return new Set();
}









export function resolveSkillSpecs(hand: readonly FxSpec[], families: readonly SkillFamily[] = skillFamilies(), devLive: ReadonlySet<string> = devLiveFamilies()): FxSpec[] {
  const live = families.filter((f) => f.live || devLive.has(f.skillId));
  if (live.length === 0) return [...hand];
  const familyIds = new Set(live.flatMap((f) => f.specs.map((s) => s.id)));
  const kept = hand.filter((s) => (s.moment === true && !familyIds.has(s.id)) || !live.some((f) => belongsToSkill(s.id, f.skillId)));
  return [...kept, ...live.flatMap((f) => f.specs)];
}

/** What a lazy skill chunk exports (default export of `skills/<class>/index.ts` and `skills/shared/index.ts`): the specs it adds to the registry. */
export interface SkillPack {
  /** the pack key: a class id (warrior, ninja, yacha, shaman, wolfman) or `common` (skills/shared) */
  readonly classId: string;
  /** the class's hand specs with the live families swapped in (resolveSkillSpecs), in registry order */
  readonly specs: readonly FxSpec[];
}

/** `./bash.family.ts` (an import.meta.glob key) → `bash` */
const FAMILY_FILE = /([^/\\]+)\.family\.[cm]?[jt]s$/;

/**
 * The pack of one class entry. `wiring` is the result of the entry's own `import.meta.glob('./*.family.ts', { eager: true })`: the
 * families of exactly those wiring files (named `<skillId>.family.ts`), and of every skill that has a hand spec in `hand`, may replace the
 * class's hand specs. A family registered by another class's chunk never leaks into this pack.
 */
export function classPack(classId: string, hand: readonly FxSpec[], wiring: Readonly<Record<string, unknown>> = {}): SkillPack {
  const wired = new Set<string>();
  for (const key of Object.keys(wiring)) {
    const m = FAMILY_FILE.exec(key);
    if (m) wired.add(m[1] as string);
  }
  const mine = skillFamilies().filter((f) => wired.has(f.skillId) || hand.some((s) => belongsToSkill(s.id, f.skillId)));
  return { classId, specs: resolveSkillSpecs(hand, mine) };
}

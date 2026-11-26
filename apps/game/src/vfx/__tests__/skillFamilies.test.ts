// Gate over the generated skill families (skills/_gen/*.gen.ts) and their patches (skills/<class>/<id>.patch.ts), and over the
// registry that swaps them in (skills/families.ts). Authoring guide: spec/README.md "Generated families + patches".
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SKILL_SPECS } from '../skills';
import { belongsToSkill, classPack, devLiveFamilies, registerPatchedFamily, registerSkillFamily, resolveSkillSpecs, skillFamilies, skillFamily, type SkillFamily } from '../skills/families';
import { MAX_ELEMENTS, applyPatch, checkPatch, familyKeys, keyOf, type KeyTable, type SkillPatch } from '../spec/patch';
import { BEHAVIOR_CONTRACTS } from '../spec/preset';
import { ROLES } from '../spec/roles';
import type { ElementSpec, FxSpec } from '../spec/types';
import { ensureAllSkillVfx } from '../skills/loader';

// the class specs are lazy chunks (vfx/skills/loader.ts): load them all before this file reads the registry
await ensureAllSkillVfx();

interface GenModule {
  GEN: readonly FxSpec[];
  GEN_KEYS: KeyTable;
  GEN_META: { skill: string; vnum?: number; parts: Record<string, { role: string; fire: (number | null)[]; at: (number | null)[] }> };
}
interface PatchModule {
  PATCH: SkillPatch<KeyTable>;
}

const GENS = import.meta.glob<GenModule>('../skills/_gen/*.gen.ts', { eager: true });
const PATCHES = import.meta.glob<PatchModule>('../skills/*/*.patch.ts', { eager: true });
const WIRING = Object.keys(import.meta.glob('../skills/*/*.family.ts'));
const SKILLS = JSON.parse(readFileSync(new URL('../../data/content/skills.json', import.meta.url), 'utf8')) as { id: string; behavior: string }[];

const idOf = (path: string, suffix: string): string => (path.split('/').pop() as string).replace(suffix, '');
const gens = Object.entries(GENS).map(([path, m]) => ({ id: idOf(path, '.gen.ts'), path, m }));
const patches = Object.entries(PATCHES).map(([path, m]) => ({ id: idOf(path, '.patch.ts'), path, m }));

describe('generated families (skills/_gen)', () => {
  it('every gen file is named after a skill in skills.json', () => {
    const stray = gens.filter((g) => !SKILLS.some((s) => s.id === g.id)).map((g) => g.path);
    expect(stray).toEqual([]);
  });

  for (const { id, m } of gens) {
    describe(id, () => {
      it('belongs to a skill in skills.json', () => {
        const skill = SKILLS.find((s) => s.id === id);
        expect(skill, `skills.json has no skill ${id}`).toBeDefined();
        expect(m.GEN_META.skill).toBe(id);
      });

      it('has the body spec sk.<id>, parts named sk.<id>.<part>, valid behaviours and unique ids', () => {
        const ids = m.GEN.map((s) => s.id);
        expect(ids).toContain(`sk.${id}`);
        expect(new Set(ids).size).toBe(ids.length);
        for (const s of m.GEN) {
          expect(belongsToSkill(s.id, id), s.id).toBe(true);
          expect(BEHAVIOR_CONTRACTS[s.behavior], `${s.id} behavior`).toBeDefined();
          expect(s.elements.length + (s.impact?.length ?? 0)).toBeGreaterThan(0);
        }
        expect(Object.keys(m.GEN_META.parts).sort()).toEqual([...ids].sort());
      });

      it('has a unique key on every element and GEN_KEYS lists them all', () => {
        for (const s of m.GEN) {
          const list = [...s.elements, ...(s.impact ?? [])];
          const keys = list.map(keyOf);
          expect(keys.every((k) => typeof k === 'string' && k.length > 0), `${s.id}: an element has no key`).toBe(true);
          expect(new Set(keys).size, `${s.id}: duplicate keys`).toBe(keys.length);
        }
        expect(familyKeys(m.GEN)).toEqual(m.GEN_KEYS);
        expect(checkPatch(m.GEN, {})).toEqual([]);
      });

      it('a list over the host element limit (MAX_ELEMENTS = 40, spec/types.ts) has a patch that brings it within (the host cuts the rest with a console warning)', () => {
        const over: string[] = [];
        for (const s of m.GEN) {
          if (s.elements.length > MAX_ELEMENTS) over.push(`${s.id} elements ${s.elements.length}`);
          if ((s.impact?.length ?? 0) > MAX_ELEMENTS) over.push(`${s.id} impact ${s.impact?.length}`);
        }
        if (over.length === 0) return;
        const patch = patches.find((p) => p.id === id);
        expect(patch, `${id}: ${over.join(', ')} - needs ${id}.patch.ts that drops elements (el: { '<key>': null }); regen.ts --skill ${id} --keys`).toBeDefined();
        // the patched result is checked by the patch tests below (checkPatch: too-many-elements)
      });

      it('grade variants only use the three bands, textures are roles or art, rank gates are ordered', () => {
        for (const s of m.GEN) {
          for (const el of [...s.elements, ...(s.impact ?? [])] as ElementSpec[]) {
            const g = el.grade as Record<string, unknown> | undefined;
            for (const b of Object.keys(g ?? {})) expect(['g1', 'g2', 'g3']).toContain(b);
            expect((el.minRank ?? 0) <= (el.maxRank ?? 7), `${s.id} ${keyOf(el)} rank gate`).toBe(true);
            const tex = el.tex;
            if (typeof tex === 'string') expect(ROLES[tex], `${s.id} ${keyOf(el)} role ${tex}`).toBeDefined();
          }
        }
      });
    });
  }
});

describe('patches (skills/<class>/<id>.patch.ts)', () => {
  it('every patch sits next to a generated family of the same skill', () => {
    expect(patches.filter((p) => !gens.some((g) => g.id === p.id)).map((p) => p.path)).toEqual([]);
  });

  for (const { id, path, m } of patches) {
    describe(id, () => {
      const gen = gens.find((g) => g.id === id);

      it('has its generated family and exports PATCH', () => {
        expect(gen, `${path}: no skills/_gen/${id}.gen.ts`).toBeDefined();
        expect(m.PATCH).toBeDefined();
      });

      it('applies cleanly: no stale keys, no clashes, within the element limit', () => {
        if (!gen) return;
        const issues = checkPatch(gen.m.GEN, m.PATCH);
        expect(issues.filter((i) => i.level === 'error').map((i) => i.message)).toEqual([]);
      });

      it("does not light an element up beyond the generated luma ('luma-up' warning: > 1.5x at some grade; use retint / tintMul)", () => {
        if (!gen) return;
        // a WARNING (patch.ts LUMA_UP_RATIO): reported here, never a failure; the recipe gate is that the list stays empty
        const lumaUp = checkPatch(gen.m.GEN, m.PATCH).filter((i) => i.code === 'luma-up');
        if (lumaUp.length > 0) console.warn(`[luma-up] ${id}: ${lumaUp.length} element(s) brighter than generated:\n  ${lumaUp.map((i) => i.message).join('\n  ')}`);
        expect(lumaUp.every((i) => i.level === 'warn' && i.key !== undefined)).toBe(true);
      });

      it('is deterministic and leaves the generated family untouched', () => {
        if (!gen) return;
        const before = JSON.stringify(gen.m.GEN);
        const a = JSON.stringify(applyPatch(gen.m.GEN, m.PATCH));
        expect(JSON.stringify(applyPatch(gen.m.GEN, m.PATCH))).toBe(a);
        expect(JSON.stringify(gen.m.GEN)).toBe(before);
      });

      it('keeps the family usable: body spec present, ids unique, belong to the skill', () => {
        if (!gen) return;
        const out = applyPatch(gen.m.GEN, m.PATCH);
        const ids = out.map((s) => s.id);
        expect(ids).toContain(`sk.${id}`);
        expect(new Set(ids).size).toBe(ids.length);
        for (const s of out) expect(belongsToSkill(s.id, id), s.id).toBe(true);
      });
    });
  }
});

describe('family registry', () => {
  const spec = (id: string): FxSpec => ({ id, desc: id, behavior: 'meleeArc', ref: {}, size: 'radius', base: 1, dur: 1, elements: [] });
  const fam = (skillId: string, live: boolean, ids: string[]): SkillFamily => ({ skillId, specs: ids.map(spec), live });
  const hand = ['sk.bash_x', 'sk.crushing_blow', 'sk.crushing_blow.cast', 'sk.other'].map(spec);

  it('a skill id owns sk.<id> and sk.<id>.<part>, not sk.<id>_x', () => {
    expect(belongsToSkill('sk.crushing_blow', 'crushing_blow')).toBe(true);
    expect(belongsToSkill('sk.crushing_blow.cast', 'crushing_blow')).toBe(true);
    expect(belongsToSkill('sk.bash_x', 'crushing_blow')).toBe(false);
    expect(belongsToSkill('sk.bashing', 'crushing_blow')).toBe(false);
  });

  it('a non-live family changes nothing: the hand specs stay registered', () => {
    const out = resolveSkillSpecs(hand, [fam('crushing_blow', false, ['sk.crushing_blow'])], new Set());
    expect(out.map((s) => s.id)).toEqual(['sk.bash_x', 'sk.crushing_blow', 'sk.crushing_blow.cast', 'sk.other']);
    expect(out[0]).toBe(hand[0]);
  });

  it('a live family replaces every hand spec of its skill (and only those)', () => {
    const out = resolveSkillSpecs(hand, [fam('crushing_blow', true, ['sk.crushing_blow', 'sk.crushing_blow.aura'])], new Set());
    expect(out.map((s) => s.id)).toEqual(['sk.bash_x', 'sk.other', 'sk.crushing_blow', 'sk.crushing_blow.aura']);
  });

  describe('moment specs (FxSpec.moment, skills/<class>/moments.ts)', () => {
    const moment = (id: string): FxSpec => ({ ...spec(id), moment: true });
    const withMoments = [...hand, moment('sk.crushing_blow.shatter'), moment('sk.crushing_blow.loop'), moment('sk.other.burst')];

    it('a live family keeps the hand moments of its skill and drops its other hand specs', () => {
      const out = resolveSkillSpecs(withMoments, [fam('crushing_blow', true, ['sk.crushing_blow', 'sk.crushing_blow.aura'])], new Set());
      expect(out.map((s) => s.id)).toEqual(['sk.bash_x', 'sk.other', 'sk.crushing_blow.shatter', 'sk.crushing_blow.loop', 'sk.other.burst', 'sk.crushing_blow', 'sk.crushing_blow.aura']);
      // the kept moment is the very same spec object
      expect(out.find((s) => s.id === 'sk.crushing_blow.shatter')).toBe(withMoments.find((s) => s.id === 'sk.crushing_blow.shatter'));
    });

    it('a family spec of the same id wins over the moment (an id is never registered twice)', () => {
      const out = resolveSkillSpecs(withMoments, [fam('crushing_blow', true, ['sk.crushing_blow', 'sk.crushing_blow.loop'])], new Set());
      const ids = out.map((s) => s.id);
      expect(ids.filter((id) => id === 'sk.crushing_blow.loop')).toHaveLength(1);
      expect(out.find((s) => s.id === 'sk.crushing_blow.loop')?.moment).not.toBe(true);
      expect(ids).toContain('sk.crushing_blow.shatter');
    });

    it('the dev switch keeps the moments too, and a non-live family changes nothing', () => {
      expect(resolveSkillSpecs(withMoments, [fam('crushing_blow', false, ['sk.crushing_blow'])], new Set(['crushing_blow'])).map((s) => s.id)).toContain('sk.crushing_blow.shatter');
      expect(resolveSkillSpecs(withMoments, [fam('crushing_blow', false, ['sk.crushing_blow'])], new Set()).map((s) => s.id)).toEqual(withMoments.map((s) => s.id));
    });

    it('an unflagged hand spec of the skill is still dropped (only `moment: true` survives)', () => {
      const out = resolveSkillSpecs([...hand, { ...spec('sk.crushing_blow.shatter'), moment: false }], [fam('crushing_blow', true, ['sk.crushing_blow'])], new Set());
      expect(out.map((s) => s.id)).not.toContain('sk.crushing_blow.shatter');
    });

    it('a pack built by classPack keeps the moments of a live family (the class chunk path)', () => {
      const bash = skillFamily('crushing_blow');
      expect(bash?.live, 'bash is a live family').toBe(true);
      const handCast = spec('sk.crushing_blow.cast');
      const shatter = moment('sk.crushing_blow.zz_moment');
      const handBody = spec('sk.crushing_blow');
      const pack = classPack('zz', [handBody, handCast, shatter], {});
      expect(pack.specs).toContain(shatter);
      expect(pack.specs).not.toContain(handCast);
      expect(pack.specs).not.toContain(handBody);
      expect(pack.specs.some((s) => s.id === 'sk.crushing_blow')).toBe(true); // the family body took the hand body's place
    });

    it('every registered hand moment of the shipped registry survives its live family and sits under sk.<skill>.<part> or sk.gen.*', () => {
      const ids = SKILL_SPECS.filter((s) => s.moment === true).map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(/^sk\.(gen\.[a-z_]+|[a-z_]+\.[a-z_]+)$/.test(id), id).toBe(true);
    });
  });

  it('the dev switch (?fam=) makes a registered family live', () => {
    const out = resolveSkillSpecs(hand, [fam('crushing_blow', false, ['sk.crushing_blow'])], new Set(['crushing_blow']));
    expect(out.map((s) => s.id)).toEqual(['sk.bash_x', 'sk.other', 'sk.crushing_blow']); // the hand sk.crushing_blow.cast goes with the skill
  });

  describe('?fam= dev switch', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('names the skills of the page URL (DEV builds in a browser)', () => {
      vi.stubGlobal('location', { search: '?x=1&fam=crushing_blow,bladewheel,&y=2' });
      expect([...devLiveFamilies()].sort()).toEqual(['bladewheel', 'crushing_blow']);
    });

    it('is empty without the parameter or without a location (bun / node scripts)', () => {
      vi.stubGlobal('location', { search: '?x=1' });
      expect(devLiveFamilies().size).toBe(0);
      vi.stubGlobal('location', undefined);
      expect(devLiveFamilies().size).toBe(0);
    });
  });

  it('registerSkillFamily validates ids and needs the body spec', () => {
    expect(() => registerSkillFamily('zz_test', [spec('sk.zz_test'), spec('sk.other')])).toThrow();
    expect(() => registerSkillFamily('zz_test', [spec('sk.zz_test.cast')])).toThrow();
    expect(skillFamilies().some((f) => f.skillId === 'zz_test')).toBe(false);
  });

  it('a family that cannot be built is logged and skipped: one broken wiring file must not take the app down', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gen = [{ ...spec('sk.zz_test'), elements: [{ kind: 'particle', key: 'a#0' } as unknown as ElementSpec] }];
    const boom: SkillPatch = { specs: { 'sk.zz_test': { el: { 'a#0': () => { throw new Error('regenerated element changed'); } } } } };
    expect(() => registerPatchedFamily('zz_test', gen, boom, { live: true })).not.toThrow();
    expect(skillFamily('zz_test')).toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it('every registered family is consistent with the generated one it came from', () => {
    for (const f of skillFamilies()) {
      expect(f.specs.some((s) => s.id === `sk.${f.skillId}`)).toBe(true);
      for (const s of f.specs) expect(belongsToSkill(s.id, f.skillId)).toBe(true);
    }
  });
});

describe('wiring files (skills/<class>/<id>.family.ts)', () => {
  const wired = WIRING.map((path) => ({ id: idOf(path, '.family.ts'), path }));

  it('every wiring file sits next to a gen file and a patch of the same skill and registers exactly that skill', () => {
    for (const w of wired) {
      expect(gens.some((g) => g.id === w.id), `${w.path}: no skills/_gen/${w.id}.gen.ts`).toBe(true);
      expect(patches.some((p) => p.id === w.id), `${w.path}: no ${w.id}.patch.ts`).toBe(true);
      expect(skillFamily(w.id), `${w.path} did not register a family (skills/index.ts glob)`).toBeDefined();
    }
    expect(skillFamilies().map((f) => f.skillId).sort()).toEqual(wired.map((w) => w.id).sort());
  });

  it('the registered family is the generated family with its patch applied', () => {
    for (const w of wired) {
      const gen = gens.find((g) => g.id === w.id);
      const patch = patches.find((p) => p.id === w.id);
      if (!gen || !patch) continue;
      expect(JSON.stringify(skillFamily(w.id)?.specs)).toBe(JSON.stringify(applyPatch(gen.m.GEN, patch.m.PATCH)));
    }
  });

  it('SKILL_SPECS: a live family replaces the hand specs of its skill, a non-live one leaves them alone; ids stay unique', () => {
    const ids = SKILL_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of skillFamilies()) {
      const mine = SKILL_SPECS.filter((s) => belongsToSkill(s.id, f.skillId));
      // skill-logic: the hand `moment: true` specs of the skill (skills/<class>/moments.ts) survive a live family (families.ts resolveSkillSpecs)
      if (f.live) expect(mine.filter((s) => s.moment !== true).map((s) => JSON.stringify(s))).toEqual(f.specs.map((s) => JSON.stringify(s)));
      else for (const s of f.specs) expect(mine.find((m) => m.id === s.id), `${s.id}: hand spec of a non-live family`).not.toBe(s);
    }
  });
});

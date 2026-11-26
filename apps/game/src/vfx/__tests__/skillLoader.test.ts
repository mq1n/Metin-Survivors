// Lazy skill packs (vfx/skills/loader.ts): loading rules, registry order, install / replace, the VfxSystem.addPresets hook and the
// run's class list. The real chunks are the dynamic imports of the loader itself (vitest resolves them like the bundler does).
import { describe, expect, it, vi } from 'vitest';
import { content } from '../../data/loader';
import { createWorld } from '../../sim/world';
import { addPresets, onPresetsAdded, PRESETS } from '../presets';
import type { PresetDef } from '../presets/types';
import { SKILL_PRESETS, SKILL_SPECS } from '../skills';
import { classPack, skillFamily, type SkillPack } from '../skills/families';
import {
  ALL_SKILL_CLASSES,
  createPackLoader,
  ensureAllSkillVfx,
  ensureSkillVfx,
  installSkillPack,
  loadedSkillClasses,
  runSkillClasses,
  SKILL_PACKS,
  skillClassesOf,
  type PackLoader,
} from '../skills/loader';
import { SPEC_REGISTRY } from '../spec/preset';
import type { FxSpec } from '../spec/types';
import { VfxSystem } from '../system';

const fakeSpec = (id: string): FxSpec => ({
  id,
  desc: id,
  behavior: 'selfBuff',
  size: 'radius',
  base: 1,
  dur: 1,
  ref: {},
  elements: [],
});
const pack = (classId: string, ...ids: string[]): SkillPack => ({ classId, specs: ids.map(fakeSpec) });
const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('createPackLoader (fake chunks)', () => {
  it('fetches a pack once, shares the in-flight load and installs in PACK order whatever order the chunks arrive in', async () => {
    const calls: string[] = [];
    const gates = new Map<string, () => void>();
    const loaders: Record<string, PackLoader> = {};
    for (const id of ['a', 'b', 'c']) {
      loaders[id] = () =>
        new Promise((resolve) => {
          calls.push(id);
          gates.set(id, () => resolve({ default: pack(id, `sk.${id}`) }));
        });
    }
    const installed: string[] = [];
    const api = createPackLoader(loaders, ['a', 'b', 'c'], (p) => installed.push(p.classId));
    const first = api.ensure(['c', 'a']);
    const second = api.ensure(['a', 'b']);
    await nextTick();
    expect(calls.sort()).toEqual(['a', 'b', 'c']); // each chunk requested once, though 'a' was asked for twice
    gates.get('c')?.(); // arrives first, but 'a' sorts before it
    gates.get('b')?.();
    await nextTick();
    expect(installed).toEqual([]); // the first call still waits for 'a'
    gates.get('a')?.();
    await Promise.all([first, second]);
    expect(installed).toEqual(['a', 'b', 'c']);
    expect([...api.loaded()].sort()).toEqual(['a', 'b', 'c']);
    await api.ensure(['a', 'b', 'c']);
    expect(calls).toHaveLength(3); // nothing is fetched twice
    expect(installed).toHaveLength(3);
  });

  it('always loads `common`, ignores unknown ids, and installs the packs that loaded when one fails', async () => {
    const installed: string[] = [];
    let broken = true;
    const loaders: Record<string, PackLoader> = {
      common: () => Promise.resolve({ default: pack('common') }),
      a: () => Promise.resolve({ default: pack('a') }),
      b: () => (broken ? Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/b-123.js')) : Promise.resolve({ default: pack('b') })),
    };
    const api = createPackLoader(loaders, ['a', 'b', 'common'], (p) => installed.push(p.classId));
    await expect(api.ensure(['a', 'b', 'nope'])).rejects.toThrow('dynamically imported module');
    expect(installed).toEqual(['a', 'common']); // the healthy packs are in, the failed one is not
    expect(api.loaded().has('b')).toBe(false);
    broken = false; // the network is back: the failed pack is requested again, the others are not
    await api.ensure(['a', 'b']);
    expect(installed).toEqual(['a', 'common', 'b']);
  });
});

describe('real packs', () => {
  it('the eager registry has no class spec before a pack is loaded', () => {
    // (module state of this file: nothing has called ensure* yet)
    expect(loadedSkillClasses().size).toBe(0);
    expect(SKILL_SPECS.some((s) => s.id === 'sk.bladewheel')).toBe(false);
    expect(PRESETS.some((p) => p.id === 'sk.crushing_blow')).toBe(false);
  });

  it('a class pack arrives behind everything else, and the registries keep PACK order whatever the load order was', async () => {
    const heard: string[][] = [];
    const off = onPresetsAdded((defs) => heard.push(defs.map((d) => d.id)));
    await ensureSkillVfx(['ninja']);
    expect([...loadedSkillClasses()].sort()).toEqual(['common', 'ninja']);
    expect(SPEC_REGISTRY.some((s) => s.id === 'sk.noxious_pall')).toBe(true);
    expect(PRESETS.some((p) => p.id === 'sk.noxious_pall')).toBe(true);
    expect(PRESETS.some((p) => p.id === 'sk.bladewheel')).toBe(false); // warrior is not in this run
    await ensureSkillVfx(['warrior']); // arrives AFTER ninja, sorts BEFORE it
    off();
    expect(heard.length).toBeGreaterThanOrEqual(2); // a live VfxSystem hears every install
    expect(heard.flat()).toContain('sk.bladewheel');
    const at = (list: readonly { id: string }[], id: string): number => list.findIndex((x) => x.id === id);
    for (const list of [PRESETS, SPEC_REGISTRY, SKILL_SPECS, SKILL_PRESETS] as { id: string }[][]) {
      expect(at(list, 'sk.bladewheel'), 'warrior before ninja').toBeLessThan(at(list, 'sk.noxious_pall'));
    }
    await ensureAllSkillVfx();
    expect([...loadedSkillClasses()].sort()).toEqual([...SKILL_PACKS].sort());
  });

  it('after ensureAllSkillVfx the class blocks follow the pack order, are contiguous at the end of the skill lists and have unique ids', () => {
    for (const list of [SKILL_SPECS, SPEC_REGISTRY] as FxSpec[][]) {
      const ids = list.map((s) => s.id);
      expect(new Set(ids).size, 'unique ids').toBe(ids.length);
    }
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    // class of every spec = the pack that carries it (the sk.<skillId> prefix of the skills each class's hand files define)
    const sample: Record<string, string> = { warrior: 'sk.bladewheel', ninja: 'sk.noxious_pall', yacha: 'sk.nightfall', shaman: 'sk.drifting_charms', wolfman: 'sk.rimewind' };
    const idx = ALL_SKILL_CLASSES.map((c) => SKILL_SPECS.findIndex((s) => s.id === sample[c]));
    expect(idx.every((i) => i >= 0), JSON.stringify(idx)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    // the eager common specs stay in front of every class spec
    const eagerLast = SKILL_SPECS.findIndex((s) => s.id === 'sk.gen.hit');
    expect(eagerLast).toBeGreaterThanOrEqual(0);
    expect(eagerLast).toBeLessThan(idx[0] as number);
  });

  it('a live family replaces the hand specs of its skill in its own class pack (bash is live)', () => {
    const fam = skillFamily('crushing_blow');
    expect(fam?.live).toBe(true);
    const mine = SKILL_SPECS.filter((s) => s.id === 'sk.crushing_blow' || s.id.startsWith('sk.crushing_blow.'));
    expect(mine.map((s) => s.id).sort()).toEqual((fam?.specs ?? []).map((s) => s.id).sort());
    for (const s of fam?.specs ?? []) expect(SKILL_SPECS.includes(s), s.id).toBe(true); // the family's objects, not the hand ones
  });

  it('classPack: only the families of its own wiring files (or of skills with a hand spec) join a pack', () => {
    const hand = [fakeSpec('sk.zz_a'), fakeSpec('sk.zz_b')];
    const p = classPack('zz', hand, {}); // no wiring, no live families of zz_*: the hand specs come back unchanged and in order
    expect(p.specs.map((s) => s.id)).toEqual(['sk.zz_a', 'sk.zz_b']);
    // bash is live and registered, but neither wired here nor owned by `hand`: it must not leak in
    expect(classPack('zz', hand, {}).specs.some((s) => s.id === 'sk.crushing_blow')).toBe(false);
    expect(classPack('zz', hand, { './crushing_blow.family.ts': {} }).specs.some((s) => s.id === 'sk.crushing_blow')).toBe(true);
    expect(classPack('zz', [fakeSpec('sk.crushing_blow')], {}).specs.find((s) => s.id === 'sk.crushing_blow')).toBe(skillFamily('crushing_blow')?.specs.find((s) => s.id === 'sk.crushing_blow'));
  });

  it('installSkillPack: an id the registry already has is replaced, never duplicated; a class installs once', () => {
    const before = SPEC_REGISTRY.length;
    const hear = vi.fn();
    const off = onPresetsAdded(hear);
    installSkillPack(pack('t_one', 'sk.zz_dup', 'sk.zz_only_one'));
    expect(SPEC_REGISTRY.length).toBe(before + 2);
    const second = pack('t_two', 'sk.zz_dup');
    installSkillPack(second);
    off();
    expect(SPEC_REGISTRY.length).toBe(before + 2);
    expect(SPEC_REGISTRY.filter((s) => s.id === 'sk.zz_dup')).toHaveLength(1);
    expect(SPEC_REGISTRY.find((s) => s.id === 'sk.zz_dup')).toBe(second.specs[0]);
    expect(PRESETS.filter((p) => p.id === 'sk.zz_dup')).toHaveLength(1);
    expect(SKILL_SPECS.filter((s) => s.id === 'sk.zz_dup')).toHaveLength(1);
    expect(SKILL_PRESETS.filter((p) => p.id === 'sk.zz_dup')).toHaveLength(1);
    expect(hear).toHaveBeenCalledTimes(2);
    installSkillPack(pack('t_two', 'sk.zz_other')); // same class again: no-op
    expect(SPEC_REGISTRY.some((s) => s.id === 'sk.zz_other')).toBe(false);
  });
});

describe('addPresets hub', () => {
  it('appends new ids, replaces known ones in place and tells every listener until it leaves', () => {
    const mk = (id: string): PresetDef => ({ id, cat: 'buff', desc: id, size: 'radius', base: 1, palette: 'physical', dur: 1, loop: false, fire() {} }) as PresetDef;
    const n = PRESETS.length;
    const heard: string[][] = [];
    const off = onPresetsAdded((d) => heard.push(d.map((x) => x.id)));
    addPresets([mk('sk.zz_hub_a')]);
    expect(PRESETS.length).toBe(n + 1);
    const replacement = mk('sk.zz_hub_a');
    const at = PRESETS.findIndex((p) => p.id === 'sk.zz_hub_a');
    addPresets([replacement, mk('sk.zz_hub_b')]);
    expect(PRESETS[at]).toBe(replacement);
    expect(PRESETS.length).toBe(n + 2);
    off();
    addPresets([mk('sk.zz_hub_c')]);
    expect(heard).toEqual([['sk.zz_hub_a'], ['sk.zz_hub_a', 'sk.zz_hub_b']]);
    addPresets([]);
    expect(heard).toHaveLength(2);
  });
});

describe('VfxSystem.addPresets (no GPU: the method on a bare instance)', () => {
  function bare(): { sys: VfxSystem; priv: Record<string, unknown>; compiled: string[]; cast: Record<string, string>[]; boom: Record<string, string>[] } {
    const compiled: string[] = [];
    const cast: Record<string, string>[] = [];
    const boom: Record<string, string>[] = [];
    const sys = Object.create(VfxSystem.prototype) as VfxSystem;
    const priv = sys as unknown as Record<string, unknown>;
    priv.defs = new Map();
    priv.missing = new Set(['sk.zz_late', 'sk.zz_other']);
    priv.boomN = 123;
    priv.boomCompanions = new Set(['sk.stale']);
    priv.adapter = { setCastPresets: (m: Record<string, string>) => cast.push({ ...m }), setExplodePresets: (m: Record<string, string>) => boom.push({ ...m }) };
    priv.spec = { compile: (s: FxSpec) => compiled.push(s.id) };
    return { sys, priv, compiled, cast, boom };
  }

  it('takes the defs in, forgets the cached misses, rebuilds the cast / explode tables, resets the boom guard and compiles the new specs now', () => {
    const { sys, priv, compiled, cast, boom } = bare();
    const specCast = fakeSpec('sk.zz_late.cast');
    const specBody = fakeSpec('sk.zz_late');
    const specBoom = fakeSpec('sk.zz_late.explode');
    const defs = [specBody, specCast, specBoom].map((s) => ({ id: s.id, variants: true }) as unknown as PresetDef);
    // the host compiles what SPEC_REGISTRY holds and the tables read PRESETS: register them the way specPreset / addPresets do
    const keep = SPEC_REGISTRY.length;
    const keepPresets = PRESETS.length;
    SPEC_REGISTRY.push(specBody, specCast, specBoom);
    PRESETS.push(...defs);
    try {
      sys.addPresets(defs);
    } finally {
      SPEC_REGISTRY.length = keep;
      PRESETS.length = keepPresets;
    }
    const d = priv.defs as Map<string, { def: PresetDef }>;
    expect([...d.keys()]).toEqual(['sk.zz_late', 'sk.zz_late.cast', 'sk.zz_late.explode']);
    expect((priv.missing as Set<string>).size).toBe(0);
    expect(compiled.sort()).toEqual(['sk.zz_late', 'sk.zz_late.cast', 'sk.zz_late.explode']);
    expect(priv.boomN).toBe(-1);
    // the tables are rebuilt from PRESETS: `sk.<id>.cast` keyed by the skill id, `sk.<id>.explode` keyed by `sk.<id>`; the old companions are gone
    expect(cast).toHaveLength(1);
    expect(boom).toHaveLength(1);
    expect(cast[0]?.zz_late).toBe('sk.zz_late.cast');
    expect(boom[0]?.['sk.zz_late']).toBe('sk.zz_late.explode');
    expect([...(priv.boomCompanions as Set<string>)]).toContain('sk.zz_late');
    expect([...(priv.boomCompanions as Set<string>)]).not.toContain('sk.stale');
  });

  it('drops the cached palette variants of a replaced preset and ignores an empty batch', () => {
    const { sys, priv, compiled } = bare();
    const oldDef = { id: 'sk.zz_var' } as unknown as PresetDef;
    const d = priv.defs as Map<string, { def: PresetDef; palette: null; element: number; variant: number }>;
    d.set('sk.zz_var', { def: oldDef, palette: null, element: -1, variant: -1 });
    d.set('sk.zz_var.fire', { def: oldDef, palette: null, element: 2, variant: 3 }); // resolve() cached this variant of the old def
    d.set('sk.zz_keep.fire', { def: { id: 'sk.zz_keep' } as unknown as PresetDef, palette: null, element: 2, variant: 3 });
    sys.addPresets([]);
    expect(d.size).toBe(3);
    const fresh = { id: 'sk.zz_var' } as unknown as PresetDef;
    sys.addPresets([fresh]);
    expect(d.get('sk.zz_var')?.def).toBe(fresh);
    expect(d.has('sk.zz_var.fire')).toBe(false);
    expect(d.has('sk.zz_keep.fire')).toBe(true);
    expect(compiled).toEqual([]); // no spec of that id in the registry: nothing to compile
  });
});

describe('skillClassesOf (the classes a run loads)', () => {
  const skills = [
    { id: 'bladewheel', classId: 'warrior' },
    { id: 'rimewind', classId: 'wolfman' },
    { id: 'stallion_stomp', classId: 'common' },
  ];
  it('is the class of every hero of the party plus the class of every extra skill', () => {
    expect(skillClassesOf(skills, [{ classId: 'shaman' }])).toEqual(['shaman']);
    expect(skillClassesOf(skills, [{ classId: 'shaman' }, { classId: 'ninja' }, { classId: 'shaman' }])).toEqual(['shaman', 'ninja']);
    expect(skillClassesOf(skills, [{ classId: 'ninja', extraSkills: ['rimewind', 'nope'] }, { classId: 'warrior', extraSkills: null }])).toEqual(['ninja', 'wolfman', 'warrior']);
    expect(skillClassesOf(skills, [])).toEqual([]);
  });
  it('feeds ensureSkillVfx: unknown classes and `common` are ignored, the common pack always loads', async () => {
    const out = skillClassesOf(skills, [{ classId: 'warrior', extraSkills: ['stallion_stomp'] }]);
    expect(out).toEqual(['warrior', 'common']);
    await expect(ensureSkillVfx(out.concat('martian'))).resolves.toBeUndefined();
    expect(loadedSkillClasses().has('martian')).toBe(false);
    expect(loadedSkillClasses().has('common')).toBe(true);
  });
});

describe('runSkillClasses (RunSession.load: the classes of a real World)', () => {
  const world = (classId: string, opts: { extra?: string[]; coop?: { classId: string; extra?: string[] }[] } = {}): ReturnType<typeof createWorld> =>
    createWorld(
      {
        zone: 'yeonmu',
        difficulty: 'normal',
        classId: classId as 'warrior',
        doctrine: 'a',
        sex: 'm',
        empire: 'saehwa',
        seed: 3,
        meta: { stats: {}, ...(opts.extra ? { extraSkills: opts.extra } : {}) },
        coop: (opts.coop ?? []).map((c) => ({ classId: c.classId as 'warrior', doctrine: 'a', sex: 'f', empire: 'saehwa', meta: { stats: {}, ...(c.extra ? { extraSkills: c.extra } : {}) } })),
      } as Parameters<typeof createWorld>[0],
      content,
    );
  const skillOf = (classId: string): string => (content.skills.find((s) => s.classId === classId && s.kind === 'active') as { id: string }).id;

  it('a solo run needs its own class only; the common pack comes with every ensure call', () => {
    expect(runSkillClasses(world('warrior'))).toEqual(['warrior']);
    expect(runSkillClasses(world('wolfman'))).toEqual(['wolfman']);
  });

  it('a co-op party needs the class of every partner, in world order', () => {
    expect(runSkillClasses(world('warrior', { coop: [{ classId: 'shaman' }] }))).toEqual(['warrior', 'shaman']);
    expect(runSkillClasses(world('ninja', { coop: [{ classId: 'yacha' }, { classId: 'ninja' }, { classId: 'wolfman' }] }))).toEqual(['ninja', 'yacha', 'wolfman']);
  });

  it('a talent extra skill of another class pulls in that class, for the local hero and for a partner', () => {
    expect(runSkillClasses(world('warrior', { extra: [skillOf('yacha')] }))).toEqual(['warrior', 'yacha']);
    expect(runSkillClasses(world('warrior', { coop: [{ classId: 'ninja', extra: [skillOf('wolfman')] }] }))).toEqual(['warrior', 'ninja', 'wolfman']);
    expect(runSkillClasses(world('warrior', { extra: ['no_such_skill'] }))).toEqual(['warrior']);
  });
});

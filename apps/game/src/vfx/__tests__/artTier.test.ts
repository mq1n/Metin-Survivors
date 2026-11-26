// Art tiers of a run (spec/artTier.ts): which specs of a run's art scope are awaited before the run starts (NOW), which stream
// in first (SOON) and last (LATE). The rules are derived from spec ids and skill ownership, so no builder file declares one;
// the budget test below is the guard against a builder pulling a heavy spec into the first seconds.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { PRESETS } from '../presets';
import { artKey, artParts, isDevSpec, runSpecIds, type ScopeSkill } from '../spec/artScope';
import { ART_LATE, ART_NOW, ART_SOON, COMMON_TIER_RULES, STATUS_SPECS, commonTier, enemyProjectileSpecs, runArtTiers, type TierLoadout, type TierSkill } from '../spec/artTier';
import { SPEC_REGISTRY } from '../spec/preset';
import type { ElementSpec, FxSpec } from '../spec/types';
import { ensureAllSkillVfx } from '../skills/loader';

// the class specs are lazy chunks (vfx/skills/loader.ts): load them all before this file reads the registry
await ensureAllSkillVfx();

const skills: TierSkill[] = [
  { id: 'sword_arc', classId: 'warrior', doctrine: 'a', vfx: 'sk.sword_arc', kind: 'basic', element: 'physical' },
  { id: 'cut', classId: 'warrior', doctrine: 'a', vfx: 'sk.cut', kind: 'active', element: 'fire', params: { status: { kind: 'burn' } } },
  { id: 'spin', classId: 'warrior', doctrine: 'a', vfx: 'sk.spin', kind: 'active', element: 'physical' },
  { id: 'storm', classId: 'warrior', doctrine: 'a', vfx: 'sk.storm', kind: 'ultimate', element: 'wind' },
  { id: 'spirit', classId: 'warrior', doctrine: 'b', vfx: 'sk.spirit', kind: 'basic', element: 'holy' },
  { id: 'heal_all', classId: 'common', doctrine: null, vfx: 'sk.heal_all', kind: 'active', element: 'holy' },
];
const registry = [
  'sk.sword_arc',
  'sk.sword_arc.cast',
  'sk.cut',
  'sk.spin',
  'sk.storm',
  'sk.storm.zone',
  'sk.spirit',
  'sk.heal_all',
  'sk.gen.hit',
  'sk.gen.spawn_ring',
  'sk.gen.metin_loop1.aqua',
  'sk.gen.boss_art2',
  'sk.gen.kit_art',
  'sk.gen.ambient_art',
  'sk.gen.level_up',
  'hit.physical',
  'hit.fire',
  'hit.ice',
  'hit.holy',
  'death.boss',
  'death.elite',
  'hit.player',
  'sk.gen.fire_loop',
  'sk.gen.poison_loop',
  'hit.dot.burn',
  'hit.dot.poison',
  'sk.gen.ep_making_fire',
  'sk.gen.ep_making_ice',
  'enemy.thing',
  'sk.__art_demo',
];
const warrior: TierLoadout = { classId: 'warrior', doctrine: 'a', starts: ['sword_arc', 'cut'] };
const scopeOf = (l: TierLoadout[]): string[] => runSpecIds(skills as ScopeSkill[], l, registry);

describe('runArtTiers', () => {
  it('the hero starts are NOW, card skills SOON, ultimates LATE, the dev demo specs are not in any tier', () => {
    const t = runArtTiers(skills, [warrior], scopeOf([warrior]));
    expect(t.now).toEqual(expect.arrayContaining(['sk.sword_arc', 'sk.sword_arc.cast', 'sk.cut']));
    expect(t.soon).toContain('sk.spin');
    expect(t.soon).toContain('sk.heal_all'); // the common pool's cards
    expect(t.late).toEqual(expect.arrayContaining(['sk.storm', 'sk.storm.zone']));
    for (const l of [t.now, t.soon, t.late]) expect(l.some(isDevSpec)).toBe(false);
  });

  it('common specs follow the rules; the element hit of a start skill joins NOW, the others stay SOON', () => {
    const t = runArtTiers(skills, [warrior], scopeOf([warrior]));
    expect(t.now).toEqual(expect.arrayContaining(['sk.gen.hit', 'sk.gen.spawn_ring', 'hit.physical', 'hit.fire', 'hit.player']));
    expect(t.now).not.toContain('hit.ice');
    expect(t.soon).toEqual(expect.arrayContaining(['hit.ice', 'sk.gen.level_up', 'sk.gen.kit_art', 'sk.gen.ambient_art', 'enemy.thing']));
    expect(t.late).toEqual(expect.arrayContaining(['sk.gen.metin_loop1.aqua', 'sk.gen.boss_art2', 'death.boss', 'death.elite']));
  });

  it('the three lists are disjoint and together are the scope', () => {
    const scope = scopeOf([warrior]).filter((id) => !isDevSpec(id));
    const t = runArtTiers(skills, [warrior], scope);
    const all = [...t.now, ...t.soon, ...t.late];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...scope].sort());
  });

  it('co-op: every hero contributes its starts; a hero without `starts` has none', () => {
    const l: TierLoadout[] = [warrior, { classId: 'warrior', doctrine: 'b' }];
    const t = runArtTiers(skills, l, scopeOf(l));
    expect(t.now).toContain('sk.sword_arc');
    expect(t.soon).toContain('sk.spirit');
    const l2: TierLoadout[] = [warrior, { classId: 'warrior', doctrine: 'b', starts: ['spirit'] }];
    expect(runArtTiers(skills, l2, scopeOf(l2)).now).toEqual(expect.arrayContaining(['sk.spirit', 'hit.holy']));
  });

  it('the status a start skill can inflict is NOW with its DoT puff; the other statuses stay SOON', () => {
    const t = runArtTiers(skills, [warrior], scopeOf([warrior]));
    expect(t.now).toEqual(expect.arrayContaining(['sk.gen.fire_loop', 'hit.dot.burn']));
    expect(t.soon).toEqual(expect.arrayContaining(['sk.gen.poison_loop', 'hit.dot.poison']));
    for (const specs of Object.values(STATUS_SPECS)) expect(specs.length).toBeGreaterThan(0);
  });

  it('enemyProjectileSpecs: the three effects of a hostile look, nothing for a hero projectile', () => {
    expect(enemyProjectileSpecs('proj.hostile.fire')).toEqual(['sk.gen.ep_making_fire', 'sk.gen.ep_release_fire', 'sk.gen.ep_blow_fire']);
    expect(enemyProjectileSpecs('proj.arrow.physical')[0]).toBe('sk.gen.ep_making_physical');
    expect(enemyProjectileSpecs('proj.player.fire')).toEqual([]);
    expect(enemyProjectileSpecs('proj.hostile')).toEqual([]);
    const t = runArtTiers(skills, [warrior], scopeOf([warrior]), undefined, enemyProjectileSpecs('proj.hostile.fire'));
    expect(t.now).toContain('sk.gen.ep_making_fire');
    expect(t.soon).toContain('sk.gen.ep_making_ice');
  });

  it('a spec can pin its tier, and the run can add common specs to NOW (the zone has ambient particles)', () => {
    const pinned = (id: string) => (id === 'sk.spin' ? ART_NOW : id === 'sk.gen.hit' ? ART_LATE : undefined);
    const t = runArtTiers(skills, [warrior], scopeOf([warrior]), pinned, ['sk.gen.ambient_art']);
    expect(t.now).toEqual(expect.arrayContaining(['sk.spin', 'sk.gen.ambient_art']));
    expect(t.late).toContain('sk.gen.hit');
    expect(t.now).not.toContain('sk.gen.hit');
  });

  it('commonTier: exact ids and "prefix." / "prefix_" rules, SOON for an id no rule names', () => {
    expect(commonTier('sk.gen.metin_loop3.pink')).toBe(ART_LATE);
    expect(commonTier('metin.crash')).toBe(ART_LATE);
    expect(commonTier('sk.gen.hit')).toBe(ART_NOW);
    expect(commonTier('sk.gen.hitting')).toBe(ART_SOON); // an exact id is not a prefix
    expect(commonTier('something.new')).toBe(ART_SOON);
    for (const [key, tier] of COMMON_TIER_RULES) expect(commonTier(key), key).toBe(tier);
  });
});

describe('the tiers of the shipped content', () => {
  const man = JSON.parse(readFileSync(new URL('../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as Record<string, { bytes?: number }>;
  const ids = (() => {
    expect(PRESETS.length).toBeGreaterThan(0); // registers the common specs
    return SPEC_REGISTRY.map((s) => s.id).filter((id) => !isDevSpec(id));
  })();
  const byId = new Map<string, FxSpec>(SPEC_REGISTRY.map((s) => [s.id, s]));
  /** the art ids of a spec (all grade variants, impact included) */
  const artOf = (id: string): string[] => {
    const out = new Set<string>();
    const s = byId.get(id);
    for (const list of [s?.elements, s?.impact] as (readonly ElementSpec[] | undefined)[]) {
      for (const el of list ?? []) {
        const g = (el as { grade?: Record<string, object> }).grade;
        for (const e of [el, ...['g1', 'g2', 'g3'].map((k) => (g?.[k] ? ({ ...el, ...g[k] } as ElementSpec) : null))]) {
          const t = e?.tex;
          if (t && typeof t !== 'string' && t.art) for (const p of artParts(artKey(t.art))) out.add(p);
        }
      }
    }
    return [...out];
  };
  const bytes = (specs: readonly string[]): number => {
    const seen = new Set<string>();
    let b = 0;
    for (const id of specs) for (const a of artOf(id)) if (!seen.has(a)) {
      seen.add(a);
      b += man[a]?.bytes ?? 0;
    }
    return b;
  };
  /** what a run awaits before it starts must stay small: the payload gate's zone window is 15 MB, the target 13 MB (ARCHITECTURE §11) */
  const NOW_BUDGET = 2.0e6;

  for (const cls of content.classes) {
    for (const d of cls.doctrines) {
      it(`${cls.id}/${d.id}: starts and their hit are NOW, bosses / metins / ultimates are not, NOW stays under ${NOW_BUDGET / 1e6} MB`, () => {
        const lo: TierLoadout = { classId: cls.id, doctrine: d.id, starts: [d.basic, d.starter] };
        const scope = runSpecIds(content.skills, [lo], ids);
        const t = runArtTiers(content.skills, [lo], scope, (id) => byId.get(id)?.artTier);
        for (const s of content.skills.filter((x) => x.id === d.basic || x.id === d.starter)) {
          for (const spec of new Set([s.vfx, `sk.${s.id}`])) if (spec && scope.includes(spec)) expect(t.now, `${spec} (start skill ${s.id})`).toContain(spec);
          if (scope.includes(`hit.${s.element}`)) expect(t.now).toContain(`hit.${s.element}`);
        }
        expect(t.now).toEqual(expect.arrayContaining(['sk.gen.hit', 'sk.gen.critical', 'sk.gen.monster_die', 'sk.gen.spawn_ring']));
        for (const id of t.now) expect(/^(sk\.gen\.(metin|boss)_|boss\.|metin\.|death\.(boss|elite)|spawn\.(elite|corrupt|summon))/.test(id), id).toBe(false);
        // an ultimate (talent milestone) is never in the first seconds
        for (const s of content.skills.filter((x) => x.kind === 'ultimate' && x.classId === cls.id && x.doctrine === d.id)) {
          if (s.vfx && scope.includes(s.vfx)) expect(t.late, s.vfx).toContain(s.vfx);
        }
        const all = [...t.now, ...t.soon, ...t.late];
        expect(all.length).toBe(scope.length);
        expect(bytes(t.now), `NOW art of ${cls.id}/${d.id}`).toBeLessThanOrEqual(NOW_BUDGET);
        // the point of it all: most of the scope's art is not in the blocking load
        expect(bytes(t.now)).toBeLessThan(bytes(scope) * 0.4);
      });
    }
  }
});

// Creature load plan (app/simFeed.creatureLoadPlan): what a run loads before it starts and what streams behind the first
// minute. Payload policy, ARCHITECTURE §11: the zone budget cannot afford every creature of all five time bands up front.
import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { buildContentIndex } from '../../sim/content';
import { createWorld } from '../../sim/world';
import { CREATURE_NOW_HORIZON, buildCatalog, creatureFirstSeen, creatureLoadPlan } from '../simFeed';

const ix = buildContentIndex(content);

function world(zone: string): ReturnType<typeof createWorld> {
  return createWorld({ zone, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 3, meta: { stats: {} } } as Parameters<typeof createWorld>[0], content);
}

const modelOf = (type: number): string => (ix.typeDefs[type] as { model: string }).model;

describe('creature load plan', () => {
  for (const zone of content.zones) {
    it(`${zone.id}: the first band loads before the run, the rest streams, nothing is lost`, () => {
      const w = world(zone.id);
      const plan = creatureLoadPlan(w.zone, w.ix, w.usedTypes);
      const now = new Set(plan.now);
      const later = new Set(plan.later.map((l) => l.type));
      // every type the sim may spawn is either loaded now or streamed, never both, never neither
      for (const t of w.usedTypes) expect(now.has(t) !== later.has(t), `${ix.typeDefs[t]?.id}`).toBe(true);
      for (const t of now) expect(later.has(t)).toBe(false);
      // the types of the band that is live at second 0 are always loaded with the run
      const first = [...zone.bands].sort((a, b) => a.from - b.from)[0];
      for (const s of first?.spawns ?? []) for (const id of [s.enemy, s.group?.leader, ...(s.group?.members ?? [])]) {
        const t = id === undefined ? undefined : ix.typeIndex.get(id);
        if (t !== undefined) expect(now.has(t), id).toBe(true);
      }
      // streamed types carry the second they can first be on screen, ordered; nothing urgent hides in the stream
      let prev = 0;
      for (const l of plan.later) {
        expect(l.at).toBeGreaterThan(CREATURE_NOW_HORIZON);
        expect(l.at).toBeGreaterThanOrEqual(prev);
        prev = l.at;
      }
      // the load is a fraction of the zone's roster (the whole point)
      expect(plan.now.length).toBeLessThan(w.usedTypes.length);
      expect(plan.later.length).toBeGreaterThan(0);
    });
  }

  it('Yeonmu: the wolves of the first band load, every other band / boss / swarm creature streams ahead of its time', () => {
    const w = world('yeonmu');
    const plan = creatureLoadPlan(w.zone, w.ix, w.usedTypes);
    const models = new Set(plan.now.map(modelOf));
    // the hungry dog / hungry alpha are baked albedo variants of their own (Yeonmu wave), so they load with the first band too
    expect([...models].sort()).toEqual(['alpha_wolf', 'alpha_wolf_hungry', 'hungry_wild_dog', 'wild_dog', 'wolf']);
    // earliest second per model (several types share one)
    const at = new Map<string, number>();
    for (const l of plan.later) at.set(modelOf(l.type), Math.min(at.get(modelOf(l.type)) ?? Infinity, l.at));
    // the metin swarms start at metins.firstAt (60 s): oath soldiers and bears can show up long before their bands
    expect(at.get('silver_vow_soldier')).toBe(w.zone.metins.firstAt);
    expect(at.get('bear')).toBe(w.zone.metins.firstAt);
    // the final boss model is only needed at the final wave
    const finalModel = ix.bosses.get(w.zone.final.boss)?.model as string;
    expect(at.get(finalModel)).toBe(w.zone.final.at);
  });

  it('first sighting: bands start at their `from` (the first band at 0), bosses bring their escorts, metin swarms their stone', () => {
    const w = world('yeonmu');
    const first = creatureFirstSeen(w.zone, w.ix);
    const at = (id: string): number | undefined => first.get(ix.typeIndex.get(id) as number);
    expect(at('wild_dog')).toBe(0);
    expect(at('blue_wolf')).toBe(w.zone.metins.firstAt); // band 2 spawns it at 180 s, the metin_lament swarm from 60 s
    expect(at('cursed_red_boar')).toBeLessThanOrEqual(180); // an elite of band 2
    for (const b of w.zone.bosses) {
      expect(at(b.boss)).toBeLessThanOrEqual(b.at);
      for (const e of ix.bosses.get(b.boss)?.escorts ?? []) expect(at(e)).toBeLessThanOrEqual(b.at);
    }
  });

  it('buildCatalog (the dev server loads everything with the run, the QA captures need it)', () => {
    const w = world('yeonmu');
    const cat = buildCatalog(w);
    expect(cat.enemyUsed).toEqual(w.usedTypes);
    expect(cat.enemyLater).toEqual([]);
  });
});

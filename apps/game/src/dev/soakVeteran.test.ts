// SOAK-9: the 30 ultimates (skills.json kind "ultimate") are granted only through talent-tree milestones, so no card policy reaches them
// and the soak never saw them. The `veteran` stats preset hands a case the milestone ultimates of its doctrine.
import { describe, expect, it } from 'vitest';
import { content } from '../data/loader';
import type { DoctrineKey } from '../data/schema';
import { createWorld } from '../sim/world';
import { metaFor, STATS } from './soakCore';

describe('soak veteran preset', () => {
  it('the doctrine milestone ultimates of every class x doctrine together are exactly the 30 ultimates', () => {
    const seen = new Set<string>();
    for (const cls of content.classes) {
      for (const doctrine of ['a', 'b'] as DoctrineKey[]) {
        const meta = metaFor(content, { stats: 'veteran', classId: cls.id, doctrine });
        expect(meta.stats).toEqual(STATS.veteran);
        for (const id of meta.extraSkills ?? []) {
          expect(content.skills.find((s) => s.id === id)?.kind, id).toBe('ultimate');
          seen.add(id);
        }
      }
    }
    const all = content.skills.filter((s) => s.kind === 'ultimate').map((s) => s.id);
    expect(all.length).toBe(30);
    expect([...seen].sort()).toEqual(all.sort());
  });

  it('god and the other presets grant nothing extra; the hero of a veteran case owns the ultimates', () => {
    const cls = content.classes[0]!;
    expect(metaFor(content, { stats: 'god', classId: cls.id, doctrine: 'a' }).extraSkills).toBeUndefined();
    const meta = metaFor(content, { stats: 'veteran', classId: cls.id, doctrine: 'a' });
    expect((meta.extraSkills ?? []).length).toBeGreaterThanOrEqual(1);
    const zone = content.zones[0]!;
    const w = createWorld({ zone: zone.id, difficulty: 'normal', classId: cls.id, doctrine: 'a', sex: cls.sexes[0]!, empire: content.empires[0]!.id, seed: 1, meta } as never, content);
    const owned = new Set(w.players[0]!.skills.map((s) => s.def.id));
    for (const id of meta.extraSkills ?? []) expect(owned.has(id), id).toBe(true);
  });
});

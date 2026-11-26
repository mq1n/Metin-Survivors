// Production payload policy (lazyContent() on): the zone's own stones are not part of the blocking zone load. Their model
// (~0.42 MB) and rune glyphs (5 x ~0.06 MB) stream in from run second 12 (render/metin.ts), the great metin ahead of the final
// wave, and the other zones' metins are only fetched if one shows up anyway.
import { describe, expect, it, vi } from 'vitest';
import { content } from '../../data/loader';
import type { MetinLoadDef } from '../../render/metin';
import { createWorld } from '../../sim/world';
import { buildCatalog } from '../simFeed';

vi.mock('../../render/payloadPolicy', () => ({ lazyContent: () => true }));

describe('metin load policy with streaming on', () => {
  it('streams the zone stones from metins.firstAt and the great metin from final.at, skips the rest', () => {
    for (const zone of content.zones) {
      const w = createWorld({ zone: zone.id, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 3, meta: { stats: {} } }, content);
      const types = buildCatalog(w).metinTypes as MetinLoadDef[];
      const by = (load: string): MetinLoadDef[] => types.filter((t) => (t.load ?? 'now') === load);
      expect(by('now')).toEqual([]); // nothing metin-related blocks the zone load
      expect(by('stream').map((t) => t.key).sort()).toEqual([...zone.metins.types, zone.final.greatMetin].sort());
      for (const t of by('stream')) expect(t.at).toBe(t.key === zone.final.greatMetin ? zone.final.at : zone.metins.firstAt);
      expect(by('skip').length).toBe(content.metins.length - zone.metins.types.length - 1);
    }
  });
});

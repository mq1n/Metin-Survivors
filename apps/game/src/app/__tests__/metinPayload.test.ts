// Zone payload: a run fetches only its own zone's metins (render catalog → MetinViews). The great metin falls at the
// final wave, so its GLB streams in after the run starts; other zones' great metins are never fetched.
import { Scene, Texture, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { content } from '../../data/loader';
import type { RenderCore } from '../../render/core';
import type { MetinView } from '../../render/feed';
import { MetinViews, type MetinLoadDef } from '../../render/metin';
import { createWorld } from '../../sim/world';
import { buildCatalog } from '../simFeed';

function catalogFor(zone: string): MetinLoadDef[] {
  const w = createWorld({ zone, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 3, meta: { stats: {} } }, content);
  return buildCatalog(w).metinTypes as MetinLoadDef[];
}

describe('metin load policy (zone payload)', () => {
  it('each zone loads its own metins now, streams its great metin and skips the other zones', () => {
    for (const zone of content.zones) {
      const types = catalogFor(zone.id);
      expect(types.map((t) => t.key)).toEqual(content.metins.map((m) => m.id)); // index order is the sim's contract
      const by = (load: string): string[] => types.filter((t) => (t.load ?? 'now') === load).map((t) => t.key).sort();
      expect(by('now')).toEqual([...zone.metins.types].sort());
      expect(by('stream')).toEqual([zone.final.greatMetin]);
      expect(types.find((t) => t.load === 'stream')?.at).toBe(zone.final.at);
      expect(by('skip').length).toBe(content.metins.length - zone.metins.types.length - 1);
    }
  });
});

describe('MetinViews loading', () => {
  let requested: string[];
  let uploaded: Texture[];
  let loaded: Set<string>;
  let core: RenderCore;
  const streamedTex = [new Texture(), new Texture()];

  beforeEach(() => {
    // the glow sprite paints a canvas texture at construction
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => ({ addColorStop: () => undefined }), fillRect: () => undefined, fillStyle: '' }) }),
    });
    requested = [];
    uploaded = [];
    loaded = new Set();
    core = {
      scene: new Scene(),
      rig: { focus: new Vector3() },
      heightAt: () => 0,
      renderer: { initTexture: (t: Texture) => uploaded.push(t) },
      assets: {
        loadBatch: async (reqs: { id: string }[]) => {
          for (const r of reqs) {
            requested.push(r.id);
            loaded.add(r.id);
          }
        },
        hasTexture: (id: string) => id.startsWith('tex_metin_rune_'),
        loadTexture: async (id: string) => {
          requested.push(id);
          return new Texture();
        },
        isModelLoaded: (id: string) => loaded.has(id),
        model: () => ({ extras: {} }),
        // streamed / on-demand fetches stay pending except the zone's great metin (its textures go to the GPU early)
        loadModel: (id: string) => {
          requested.push(id);
          if (id !== 'metin_great_yeonmu') return new Promise(() => undefined);
          loaded.add(id);
          return Promise.resolve({ meshes: [{ material: { map: streamedTex[0], emissiveMap: streamedTex[1], color: 1 } }] });
        },
      },
    } as unknown as RenderCore;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads the zone set with the run, streams the great metin ahead of the final wave, fetches a stray type on demand', async () => {
    const views = new MetinViews(core);
    const types = catalogFor('yeonmu');
    await views.load(types);
    const yeonmu = content.zones.find((z) => z.id === 'yeonmu');
    if (!yeonmu) throw new Error('content: yeonmu');
    // blocking load: the shared stone + this zone's rune glyphs only
    expect(requested.sort()).toEqual(['metin_stone', ...yeonmu.metins.types.map((id) => `tex_metin_rune_${id.replace(/^metin_/, '')}`)].sort());

    requested = [];
    views.feed = [];
    // the final wave is at yeonmu.final.at (900 s): fetched 120 s of run rendering ahead of it, not with the run
    for (let t = 10; t < yeonmu.final.at - 120; t += 10) views.update(10, 0);
    expect(requested).toEqual([]); // 770 s rendered
    views.update(10, 0);
    expect(requested).toEqual(['metin_great_yeonmu']);
    await Promise.resolve();
    views.update(0.016, 0);
    views.update(0.016, 0);
    views.update(0.016, 0);
    expect(uploaded).toEqual(streamedTex); // one texture per frame, ahead of the great metin's first appearance

    // a metin of another zone shows up anyway (never expected): its model is fetched then, not with the run
    const stray = types.findIndex((t) => t.key === 'metin_great_demise');
    const m: MetinView = { id: 9, type: stray, x: 0, z: 0, phase: 0, phaseT: 0, hpFrac: 1, scale: 2.4, great: true, auraRadius: 16, warnLeft: 5 };
    views.feed = [m];
    views.update(0.016, 0);
    views.update(0.016, 0);
    expect(requested).toEqual(['metin_great_yeonmu', 'metin_great_seori']); // once, while in flight
  });
});

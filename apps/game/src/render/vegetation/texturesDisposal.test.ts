import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasTexture, Fog, Texture } from 'three';
import type { Assets } from '../../engine/assets';
import type { ZoneContext } from '../terrain/zoneContext';
import { createCover } from './cover';
import { createRocks } from './rocks';
import * as vegTextures from './textures';
import { createTrees } from './trees';

function fakeCanvas2D() {
  const ctx = {
    fillStyle: '',
    globalAlpha: 1,
    beginPath: () => undefined,
    ellipse: () => undefined,
    fill: () => undefined,
    fillRect: () => undefined,
  };
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
  };
}

function makeZoneContext(assets: Assets): ZoneContext {
  const n = 4;
  const size = 64;
  const bed = new Float32Array(n * n);
  const surface = new Uint8Array(n * n); // SURFACE.GROUND === 0
  return {
    assets,
    biome: { id: 'test_zone' },
    core: { env: { fog: new Fog('#8899aa', 60, 160) } },
    field: {
      zoneId: 'test_zone',
      size,
      grid: { n, cell: size / (n - 1), bed, surface },
      blockers: [],
      paint: () => ({ res: 4, w0: new Uint8Array(4 * 4 * 4).fill(255), w1: new Uint8Array(4 * 4 * 4) }),
      layout: {
        groundLayers: [{ tex: 'tex_grass', tile: 8 }],
        rockMaterials: ['tex_rock_mossy'],
        trees: [],
        rocks: [],
        cover: [],
      },
      heightAt: () => 0,
    },
  } as unknown as ZoneContext;
}

describe('Vegetation procedural fallback texture ownership & disposal (RENDER-09)', () => {
  const origDocument = globalThis.document;

  afterEach(() => {
    if (origDocument === undefined) Reflect.deleteProperty(globalThis, 'document');
    else globalThis.document = origDocument;
  });

  function installCanvasStub(): void {
    globalThis.document = {
      createElement: () => fakeCanvas2D(),
    } as unknown as Document;
  }

  function failingAssets(): Assets {
    return {
      anisotropy: 4,
      manifest: { textures: {} },
      hasTexture: () => false,
      loadTexture: vi.fn(async () => {
        throw new Error('missing texture');
      }),
    } as unknown as Assets;
  }

  it('disposes every locally created fallback CanvasTexture for trees, rocks, and cover on teardown', async () => {
    installCanvasStub();
    const ctx = makeZoneContext(failingAssets());
    const created: CanvasTexture[] = [];
    const counts = new Map<CanvasTexture, number>();
    const origLoad = vegTextures.loadOwnedVegTexture;
    const spy = vi.spyOn(vegTextures, 'loadOwnedVegTexture').mockImplementation(async (assets, id) => {
      const res = await origLoad(assets, id);
      if (res.owned && res.texture instanceof CanvasTexture) {
        created.push(res.texture);
        counts.set(res.texture, 0);
        res.texture.addEventListener('dispose', () => {
          counts.set(res.texture as CanvasTexture, (counts.get(res.texture as CanvasTexture) ?? 0) + 1);
        });
      }
      return res;
    });

    try {
      const trees = createTrees({
        ctx,
        placements: [{ species: 'pine', x: 0, y: 0, z: 0, yaw: 0, scale: 1, seed: 1 }],
      });
      const rocks = createRocks({
        ctx,
        placements: [{ kind: 'boulder', x: 4, y: 0, z: 4, yaw: 0, sx: 2, sy: 1.5, sz: 2, mat: 0, seed: 1 }],
      });
      const cover = createCover(ctx, [
        { tex: 'tex_fol_grass_1', layers: [1], density: 1, size: [0.4, 0.6] },
      ]);

      await Promise.all([trees.ready, rocks.ready, cover.ready]);

      // Pine tree creates 2 fallbacks (bark + foliage), rock creates 1, cover creates 1 -> 4 total.
      expect(created).toHaveLength(4);
      for (const tex of created) expect(counts.get(tex)).toBe(0);

      trees.dispose();
      rocks.dispose();
      cover.dispose();

      for (const tex of created) expect(counts.get(tex)).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('preserves shared manifest textures from Assets and disposes fallbacks created during dispose-in-flight', async () => {
    installCanvasStub();

    // 1) Shared Assets texture must NOT be disposed when vegetation tears down.
    const sharedTex = new Texture();
    let sharedDisposeCount = 0;
    sharedTex.addEventListener('dispose', () => {
      sharedDisposeCount++;
    });
    const sharedAssets = {
      anisotropy: 4,
      manifest: { textures: { tex_rock_mossy: { url: 'rock.png' } } },
      hasTexture: (id: string) => id === 'tex_rock_mossy',
      loadTexture: vi.fn(async () => sharedTex),
    } as unknown as Assets;
    const rocksShared = createRocks({
      ctx: makeZoneContext(sharedAssets),
      placements: [{ kind: 'boulder', x: 0, y: 0, z: 0, yaw: 0, sx: 2, sy: 1.5, sz: 2, mat: 0, seed: 1 }],
    });
    await rocksShared.ready;
    rocksShared.dispose();
    expect(sharedDisposeCount).toBe(0);

    // 2) Dispose-during-load: fallback CanvasTexture constructed after dispose() is immediately disposed!
    let rejectTex!: (err: Error) => void;
    const inflightAssets = {
      anisotropy: 4,
      manifest: { textures: { tex_fol_grass_1: { url: 'grass.png' } } },
      hasTexture: (id: string) => id === 'tex_fol_grass_1',
      loadTexture: () =>
        new Promise<Texture>((_res, rej) => {
          rejectTex = rej;
        }),
    } as unknown as Assets;
    const disposeSpy = vi.spyOn(CanvasTexture.prototype, 'dispose');
    try {
      const coverInflight = createCover(makeZoneContext(inflightAssets), [
        { tex: 'tex_fol_grass_1', layers: [1], density: 1, size: [0.4, 0.6] },
      ]);
      coverInflight.dispose();
      rejectTex(new Error('network fail'));
      await coverInflight.ready;
      expect(disposeSpy).toHaveBeenCalledTimes(1);
    } finally {
      disposeSpy.mockRestore();
    }
  });
});

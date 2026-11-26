// Ground splat arrays and the payload policy for their normal maps (ARCHITECTURE §11): with a gate the normal array starts
// flat, the maps are fetched only once the gate opens (after the first seconds of the run) and each layer fades in through
// partial uploads, so the ground's lighting never pops. Without a gate they load with the albedo, as before.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Texture } from 'three';
import type { Assets } from '../../engine/assets';
import type { GroundLayer } from '../../world/layoutTypes';
import { buildLayerArrays, normalsGate } from './layerTextures';

const SIZE = 4;
/** the "normal map": every texel (200, 100, 255) */
const MAP: [number, number, number] = [200, 100, 255];

/** a 2d context that composites like a canvas: fillRect paints the background, drawImage blends the image by globalAlpha */
function fakeCanvas(): unknown {
  const px = new Uint8ClampedArray(SIZE * SIZE * 4);
  let fill: [number, number, number] = [0, 0, 0];
  const ctx = {
    globalAlpha: 1,
    set fillStyle(v: string) {
      const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(v);
      if (m) fill = [Number(m[1]), Number(m[2]), Number(m[3])];
    },
    fillRect() {
      for (let i = 0; i < SIZE * SIZE; i++) px.set([...fill, 255], i * 4);
    },
    drawImage(img: { rgb: [number, number, number] }) {
      for (let i = 0; i < SIZE * SIZE; i++) {
        for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.round((px[i * 4 + c] as number) * (1 - ctx.globalAlpha) + img.rgb[c]! * ctx.globalAlpha);
        px[i * 4 + 3] = 255;
      }
    },
    getImageData: () => ({ data: px }),
  };
  return { width: SIZE, height: SIZE, getContext: () => ctx };
}

const layers: GroundLayer[] = [{ tex: 'tex_a' }, { tex: 'tex_b' }] as unknown as GroundLayer[];
const tex = (rgb: [number, number, number]): Texture => ({ image: { rgb } }) as unknown as Texture;

function fakeAssets(): { assets: Assets; normalLoads: string[]; holds: Array<Promise<void>> } {
  const normalLoads: string[] = [];
  const holds: Array<Promise<void>> = [];
  const assets = {
    anisotropy: 4,
    manifest: { textures: {} },
    url: (p: string) => p,
    loadTexture: async () => tex([10, 20, 30]),
    // the ground asks for the real map (loadNormalMapNow), never for a held stand-in (loadNormalMap)
    loadNormalMapNow: async (id: string) => {
      normalLoads.push(id);
      return tex(MAP);
    },
    holdNormalMaps: (gate: Promise<void>) => void holds.push(gate),
  } as unknown as Assets;
  return { assets, normalLoads, holds };
}

const layerPixels = (data: Uint8Array, layer: number): number[] => [...data.subarray(layer * SIZE * SIZE * 4, layer * SIZE * SIZE * 4 + 4)];

describe('buildLayerArrays normal map policy', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => fakeCanvas() });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('without a gate the normal maps load with the albedo', async () => {
    const { assets, normalLoads, holds } = fakeAssets();
    const a = await buildLayerArrays(assets, layers, SIZE, true);
    expect(normalLoads.sort()).toEqual(['tex_a', 'tex_b']);
    expect(holds).toEqual([]); // nothing is held back where content is not streamed
    expect(layerPixels(a.normal?.image.data as Uint8Array, 0)).toEqual([...MAP, 255]);
  });

  it('with a gate: albedo now, flat normals, no normal download until it opens, then a stepwise fade layer by layer', async () => {
    const { assets, normalLoads } = fakeAssets();
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => (open = r));
    const a = await buildLayerArrays(assets, layers, SIZE, true, gate);
    const data = a.normal?.image.data as Uint8Array;
    expect(layerPixels(a.albedo.image.data as Uint8Array, 0)).toEqual([10, 20, 30, 255]);
    expect(layerPixels(data, 0)).toEqual([128, 128, 255, 255]);
    expect(layerPixels(data, 1)).toEqual([128, 128, 255, 255]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(normalLoads).toEqual([]); // the gate is still shut

    const v0 = a.normal?.version ?? 0;
    open();
    await vi.advanceTimersByTimeAsync(1);
    expect(normalLoads.sort()).toEqual(['tex_a', 'tex_b']);
    // first step of layer 0: 20 % of the relief, layer 1 untouched; only layer 0 is queued for upload
    expect(layerPixels(data, 0)).toEqual([Math.round(128 + (MAP[0] - 128) * 0.2), Math.round(128 + (MAP[1] - 128) * 0.2), 255, 255]);
    expect(layerPixels(data, 1)).toEqual([128, 128, 255, 255]);
    expect([...(a.normal?.layerUpdates ?? [])]).toEqual([0]);
    expect(a.normal?.version).toBeGreaterThan(v0);
    await vi.advanceTimersByTimeAsync(160);
    expect(layerPixels(data, 0)[0]).toBe(Math.round(128 + (MAP[0] - 128) * 0.4));
    await vi.advanceTimersByTimeAsync(160 * 3);
    expect(layerPixels(data, 0)).toEqual([...MAP, 255]); // faded in completely
    expect(layerPixels(data, 1)).toEqual([128, 128, 255, 255]); // the next layer follows
    await vi.advanceTimersByTimeAsync(1000);
    expect(layerPixels(data, 1)).toEqual([...MAP, 255]);
  });

  it('registers its gate with the asset cache, so the other normal maps of the zone (rocks, bark, ice) wait for it too', async () => {
    const { assets, holds } = fakeAssets();
    const gate = new Promise<void>(() => undefined);
    await buildLayerArrays(assets, layers, SIZE, true, gate);
    expect(holds).toEqual([gate]);
    // also where the ground itself has no normal maps (low quality): the rocks of that zone still ask for theirs
    await buildLayerArrays(assets, layers, SIZE, false, gate);
    expect(holds).toEqual([gate, gate]);
  });

  it('a normal array disposed before the gate opens never downloads anything', async () => {
    const { assets, normalLoads } = fakeAssets();
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => (open = r));
    const a = await buildLayerArrays(assets, layers, SIZE, true, gate);
    a.normal?.dispose();
    open();
    await vi.advanceTimersByTimeAsync(2000);
    expect(normalLoads).toEqual([]);
  });

  it('the gate only exists where content is streamed (the dev server keeps the old, complete load for its QA captures)', () => {
    expect(normalsGate({ time: 0 })).toBeUndefined();
  });
});

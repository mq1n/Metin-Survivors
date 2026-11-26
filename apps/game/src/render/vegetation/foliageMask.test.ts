import { afterEach, describe, expect, it, vi } from 'vitest';
import { Texture } from 'three';
import type { Assets } from '../../engine/assets';
import type { TreePlacement, ZoneLayout } from '../../world/layoutTypes';
import { foliageMaskOf, loadFoliageMasks } from './foliageMask';
import { foliageIdsFor, treeJitter, treeStyleFor } from './trees';
import { acquireTreeVariants, releaseTreeVariants } from './treeVariants';

// zones core B1: what the baked crown shadows need from the vegetation side (shared variants, the instance jitter, foliage
// texture alpha masks, the texture ids a zone really draws)

afterEach(() => {
  vi.unstubAllGlobals();
});

/** an OffscreenCanvas whose 2D context "draws" an image carrying `alphaAt(x, y)` (top row first) */
function stubCanvas(alphaAt: (x: number, y: number) => number): void {
  class FakeCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
    getContext(): unknown {
      const w = this.width;
      const h = this.height;
      return {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        clearRect() {},
        drawImage() {},
        getImageData() {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[(y * w + x) * 4 + 3] = alphaAt(x, y);
          return { data };
        },
      };
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
}

function texture(flipY: boolean): Texture {
  const t = new Texture({ width: 4, height: 4 } as unknown as HTMLImageElement);
  t.flipY = flipY;
  return t;
}

describe('foliageMaskOf', () => {
  it('reads the alpha channel; row 0 is the top of the image (v = 1) for three\'s default flipY', () => {
    stubCanvas((_x, y) => (y < 32 ? 255 : 0));
    const m = foliageMaskOf(texture(true));
    expect(m).not.toBeNull();
    const mask = m as NonNullable<typeof m>;
    expect(mask.size).toBe(64);
    expect(mask.data[0]).toBe(255); // top row opaque
    expect(mask.data[63 * 64]).toBe(0);
  });

  it('turns the rows over for a texture decoded with flipY = false', () => {
    stubCanvas((_x, y) => (y < 32 ? 255 : 0));
    const mask = foliageMaskOf(texture(false)) as NonNullable<ReturnType<typeof foliageMaskOf>>;
    expect(mask.data[0]).toBe(0);
    expect(mask.data[63 * 64]).toBe(255);
  });

  it('is null without a canvas or an image (the shadow bake then uses its procedural leaf blob)', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(foliageMaskOf(texture(true))).toBeNull();
    stubCanvas(() => 255);
    expect(foliageMaskOf(new Texture())).toBeNull();
  });
});

function layout(trees: TreePlacement[], tex = 'tex_grass'): ZoneLayout {
  return { zone: 'x', groundLayers: [{ tex, scale: 5 }], trees } as unknown as ZoneLayout;
}

describe('tree helpers shared with the baked shadows', () => {
  it('treeJitter is deterministic and small: lean under 2 degrees, scale within the tree system\'s range', () => {
    const t: TreePlacement = { species: 'pine', x: 1, z: 2, y: 0, scale: 1.3, yaw: 0.5, seed: 4242 };
    expect(treeJitter(3, t)).toEqual(treeJitter(3, t));
    for (let item = 0; item < 50; item++) {
      const j = treeJitter(item, t);
      expect(Math.abs(j.rx)).toBeLessThanOrEqual(0.035);
      expect(Math.abs(j.rz)).toBeLessThanOrEqual(0.035);
      expect(j.sxz).toBeGreaterThanOrEqual(1.3 * 0.92);
      expect(j.sxz).toBeLessThanOrEqual(1.3 * 1.08);
      expect(j.sy).toBeGreaterThanOrEqual(1.3 * 0.9);
      expect(j.sy).toBeLessThanOrEqual(1.3 * 1.1);
    }
  });

  it('foliageIdsFor follows the zone: look override, snowy / scorched species tables', () => {
    expect(foliageIdsFor('broadleaf', layout([]), undefined)).toEqual(['tex_fol_broadleaf', null]);
    expect(foliageIdsFor('broadleaf', layout([]), { fol: ['tex_fol_yeonmu_beech', 'tex_fol_broadleaf'] })).toEqual(['tex_fol_yeonmu_beech', 'tex_fol_broadleaf']);
    expect(foliageIdsFor('bare', layout([]), undefined)[0]).toBe('tex_fol_dead_branch');
    expect(treeStyleFor(layout([], 'tex_snow')).snowy).toBe(true);
    expect(treeStyleFor(layout([], 'tex_grass')).snowy).toBe(false);
  });

  it('variant sets are generated once and shared until the last user releases them', () => {
    const style = { snowy: false };
    const a = acquireTreeVariants('charred', style);
    const b = acquireTreeVariants('charred', style);
    expect(b).toBe(a);
    releaseTreeVariants('charred', style);
    expect(acquireTreeVariants('charred', style)).toBe(a); // one user is still holding it
    releaseTreeVariants('charred', style);
    releaseTreeVariants('charred', style);
    expect(acquireTreeVariants('charred', style)).not.toBe(a); // all released: regenerated on demand
    releaseTreeVariants('charred', style);
  });
});

describe('loadFoliageMasks', () => {
  it('loads each distinct card texture once per zone and keys the masks by species', async () => {
    stubCanvas(() => 200);
    const loads: string[] = [];
    const assets = {
      anisotropy: 1,
      loadTexture(id: string): Promise<Texture> {
        loads.push(id);
        return Promise.resolve(texture(true));
      },
    } as unknown as Assets;
    const trees: TreePlacement[] = [
      { species: 'autumn', x: 0, z: 0, y: 0, scale: 1, yaw: 0, seed: 1 },
      { species: 'broadleaf', x: 5, z: 0, y: 0, scale: 1, yaw: 0, seed: 2 },
    ];
    const masks = await loadFoliageMasks(assets, layout(trees), undefined);
    expect(Object.keys(masks).sort()).toEqual(['autumn', 'broadleaf']);
    // autumn draws tex_fol_autumn + tex_fol_broadleaf, broadleaf draws tex_fol_broadleaf: the shared card loads once
    expect(loads.filter((l) => l === 'tex_fol_broadleaf')).toHaveLength(1);
    expect(masks.autumn?.[0]?.data[0]).toBe(200);
    expect(masks.broadleaf?.[1]).toBeNull();
  });
});

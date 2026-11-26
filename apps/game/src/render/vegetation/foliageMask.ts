// Alpha masks of the foliage card textures, for the baked crown shadows (terrain/treeShadow.ts): the shadow of a leaf card
// is cut out by the same alpha the card is drawn with, so the ground shows the crown's own leaf clusters. Read once per zone,
// 64x64 per texture, through the asset cache (the tree system asks for the same textures, so nothing is downloaded twice).
import type { Texture } from 'three';
import type { Assets } from '../../engine/assets';
import type { TreeSpecies, ZoneLayout } from '../../world/layoutTypes';
import type { FoliageMask, TreeShadowMasks } from '../terrain/treeShadow';
import { loadOwnedVegTexture } from './textures';
import { foliageIdsFor, type TreeSpeciesLook } from './trees';

const MASK = 64;

/** Alpha of a texture's image as a MASK² byte mask, row 0 = the top of the image (v = 1); null when it cannot be read. */
export function foliageMaskOf(tex: Texture): FoliageMask | null {
  const img = tex.image as CanvasImageSource | undefined | null;
  if (!img) return null;
  try {
    let g: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (typeof OffscreenCanvas !== 'undefined') {
      g = new OffscreenCanvas(MASK, MASK).getContext('2d', { willReadFrequently: true });
    } else if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = c.height = MASK;
      g = c.getContext('2d', { willReadFrequently: true });
    } else return null;
    if (!g) return null;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, MASK, MASK);
    g.drawImage(img, 0, 0, MASK, MASK);
    const px = g.getImageData(0, 0, MASK, MASK).data;
    const data = new Uint8Array(MASK * MASK);
    // three's default flipY = true: image row 0 is v = 1. A texture decoded with flipY = false has v = 0 at row 0: turn it over
    const turn = tex.flipY === false;
    for (let y = 0; y < MASK; y++) {
      const src = turn ? MASK - 1 - y : y;
      for (let x = 0; x < MASK; x++) data[y * MASK + x] = px[(src * MASK + x) * 4 + 3] as number;
    }
    return { size: MASK, data };
  } catch {
    return null; // tainted canvas / undecodable image: the caller falls back to a procedural leaf blob
  }
}

/**
 * The foliage masks of every species that stands in the zone: slot A and slot B of the species' card textures (the zone's
 * `look.trees` override included). A texture that cannot be read leaves its slot null (procedural stand-in).
 */
export async function loadFoliageMasks(assets: Assets, layout: ZoneLayout, overrides: Partial<Record<TreeSpecies, TreeSpeciesLook>> | undefined): Promise<TreeShadowMasks> {
  const species = new Set<TreeSpecies>();
  for (const t of layout.trees) species.add(t.species);
  const out: TreeShadowMasks = {};
  const cache = new Map<string, Promise<FoliageMask | null>>();
  const maskFor = (id: string): Promise<FoliageMask | null> => {
    let p = cache.get(id);
    if (!p) {
      p = loadOwnedVegTexture(assets, id).then(
        (res) => {
          try {
            return foliageMaskOf(res.texture);
          } finally {
            res.dispose();
          }
        },
        () => null,
      );
      cache.set(id, p);
    }
    return p;
  };
  await Promise.all(
    [...species].map(async (sp) => {
      const [a, b] = foliageIdsFor(sp, layout, overrides?.[sp]);
      const [ma, mb] = await Promise.all([maskFor(a), b ? maskFor(b) : Promise.resolve<FoliageMask | null>(null)]);
      out[sp] = [ma, mb];
    }),
  );
  return out;
}

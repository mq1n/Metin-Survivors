// The baked light map of a zone (terrain.ts) shared with the systems that shade on top of the ground (the liquid shore decal and
// the sand shelf of the water surface, B2): they read the same sun visibility / AO texels the terrain does, so a sand band lies in
// a shadow exactly like the ground under it. The terrain registers its texture once the bake has finished (the bake is async: the
// readers poll `tex` in their update) and clears it when it is disposed.
import type { Texture } from 'three';
import type { TerrainField } from '../../world/terrainField';

export interface BakedLightRef {
  /** RGBA light texture (R sun visibility, G AO, B liquid proximity, A cliff-foot proximity), null until baked */
  tex: Texture | null;
  /** domain edge length the texture covers (m) */
  size: number;
}

const refs = new WeakMap<TerrainField, BakedLightRef>();

export function bakedLightRef(field: TerrainField): BakedLightRef {
  let r = refs.get(field);
  if (!r) {
    r = { tex: null, size: field.size };
    refs.set(field, r);
  }
  return r;
}

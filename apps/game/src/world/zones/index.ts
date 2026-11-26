// Zone recipe registry. Unknown ids fall back to a generic arena so any BiomePreset renders.
import type { ZoneRecipe } from '../recipe';
import { daeryeolRecipe } from './daeryeol';
import { genericRecipe } from './generic';
import { suryeonRecipe } from './suryeon';
import { seoriRecipe } from './seori';
import { yeonmuRecipe } from './yeonmu';

const GENERIC = genericRecipe('generic', {
  groundTex: ['tex_grass_a', 'tex_meadow', 'tex_dirt_path', 'tex_rock_mossy'],
  rockMats: ['tex_rock_mossy'],
  trees: [['broadleaf', 1], ['pine', 1]],
  rimHeight: 38,
  hills: 3,
});

const RECIPES: Record<string, ZoneRecipe> = {
  yeonmu: yeonmuRecipe,
  suryeon: suryeonRecipe,
  seori: seoriRecipe,
  daeryeol: daeryeolRecipe,
};

export function recipeFor(id: string): ZoneRecipe {
  return RECIPES[id] ?? GENERIC;
}

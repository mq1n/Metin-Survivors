// Shared prompt vocabulary — the machine-readable half of docs/ART.md (2D style bible).
import type { PostOp } from '../types';

/** Core look for every painted asset. */
export const PAINTERLY =
  'hand-painted digital painting, painterly East-Asian high-fantasy game art, visible confident brushwork with crisp readable shapes, ' +
  'rich but harmonious colour, original design (not a copy of any existing game)';

export const TILEABLE_CONSTRAINTS =
  'perfectly seamless tileable texture whose content continues across all four edges; flat even lighting, viewed straight down from above (orthographic, no perspective, no horizon); ' +
  'no baked cast shadows, no directional light gradient, no vignette, no large focal objects or unique landmarks that would reveal repetition; uniform detail density across the entire image; ' +
  'no text, no border, no watermark';

export const TILEABLE_AVOID =
  'perspective, horizon, sky, trees, characters, buildings, photograph look, vector/flat-shaded look, 3D render look, blur, smeared AI mush, visible seams, dark corners, vignette';

/** Standard post chain for a 1024² terrain albedo + derived normal.
 *  flatten (reflect borders) → tile (measure + overlap-and-cut heal at raw res) → resize (wrap-padded) → normal. */
export function terrainPost(opts: { flatten?: number; normal?: number; quality?: number; saturation?: number } = {}): PostOp[] {
  return [
    { op: 'flatten', strength: opts.flatten ?? 0.55 },
    ...(opts.saturation ? [{ op: 'grade', saturation: opts.saturation } as const] : []),
    { op: 'tile' },
    { op: 'resize', w: 1024 },
    { op: 'normal', strength: opts.normal ?? 2.2 },
    { op: 'webp', quality: opts.quality ?? 84, normalQuality: 88 },
  ];
}

/** Zone palettes (hex swatches; mirrored in docs/ART.md). */
export const ZONE_PALETTE = {
  yeonmu: 'lush emerald and moss greens, warm sunlit yellow-green highlights, soft earth browns, pale blue sky haze',
  suryeon: 'ochre, burnt sienna, dry straw gold, rust-red rock, dusty olive, muted warm shadows',
  seori: 'blue-white snow, glacial cyan, slate blue-grey rock, cold lavender shadows, small warm lantern accents',
  daeryeol: 'charcoal black, ash grey, deep crimson, molten orange-yellow glow, sulphur accents',
} as const;

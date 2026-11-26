// Asset manifest contract. Producers write parts in public/assets/manifest/*.json;
// tools/pipeline/manifest.ts merges them into public/assets/manifest.json.
// Owner: orchestrator. See docs/ARCHITECTURE.md §5.

export type ModelKind = 'creature' | 'boss' | 'hero' | 'weapon' | 'metin' | 'prop' | 'tree' | 'pickup';

export interface ClipInfo {
  /** seconds */
  duration: number;
  loop: boolean;
}

export interface ModelAsset {
  id: string;
  /** path relative to public/ (e.g. "assets/models/creature/wolf.3f9a1c.glb") */
  url: string;
  kind: ModelKind;
  /** meters */
  height: number;
  /** footprint radius in meters (selection rings, default collision radius) */
  radius: number;
  clips: Record<string, ClipInfo>;
  /** seconds into the clip where the hit lands, per attack-like clip */
  hit?: Record<string, number>;
  /** logical socket → bone name */
  sockets?: Record<string, string>;
  tris: number;
  bones: number;
  bytes: number;
  /** dominant colors (#rrggbb) for UI/minimap/VFX tinting */
  palette?: string[];
}

export type TextureKind = 'terrain' | 'foliage' | 'bark' | 'rock' | 'vfx' | 'rune' | 'ui' | 'portrait' | 'illustration';

export interface TextureAsset {
  id: string;
  url: string;
  kind: TextureKind;
  w: number;
  h: number;
  /** color data (sRGB) vs data (normal/roughness) */
  srgb: boolean;
  /** seamless tileable */
  tiling?: boolean;
  /** derived normal map url for terrain/bark/rock */
  normalUrl?: string;
  /** has meaningful alpha */
  alpha?: boolean;
  bytes: number;
}

export interface IconAsset {
  id: string;
  url: string;
  /** square px */
  size: number;
  bytes: number;
  /** icon pipeline v2 (docs/ART.md s5); absent = legacy opaque square. form 'tile' = octagon skill/talent/passive tile
   *  (RGBA, transparent chamfered corners, carries its own frame), 'cutout' = transparent item object (the UI draws the
   *  slot). variants: rank band -> icon id of the re-tinted tile (m = ranks M1-M2, g = G1-G2, p = P); the base id is
   *  ranks 1-3 and every variant id is an entry of `icons` too. */
  style?: { form: 'tile' | 'cutout'; variants?: Partial<Record<'m' | 'g' | 'p', string>> };
}

export type AudioKind = 'sfx' | 'music' | 'ambience' | 'stinger';

export interface AudioAsset {
  id: string;
  url: string;
  kind: AudioKind;
  /** seconds */
  duration: number;
  loop?: boolean;
  /** linear gain applied on playback (0..1+) */
  gain?: number;
  /** alternative urls picked at random on playback */
  variants?: string[];
  /** loop region for music with intros (seconds) */
  loopStart?: number;
  loopEnd?: number;
  bytes: number;
}

export interface AssetManifest {
  version: string;
  models: Record<string, ModelAsset>;
  textures: Record<string, TextureAsset>;
  icons: Record<string, IconAsset>;
  audio: Record<string, AudioAsset>;
}

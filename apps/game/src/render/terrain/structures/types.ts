// Contract for procedural structure builders (props from world/props.ts). One builder per prop id builds ONE model in
// prop-local space (metres, Y up, ground at y = 0, origin at the footprint centre, front = +Z). The system
// (structures/index.ts) instances it for every placement; a Forge GLB `prop_<id>` in the manifest takes precedence.
import type { BufferGeometry, Material, Texture } from 'three';
import type { QualityProfile } from '../../quality';

export interface StructureBuildContext {
  /** preloaded texture (declared in StructureDef.textures) or null when it is not available */
  texture(id: string): Texture | null;
  /** preloaded derived normal map for a texture id, or null */
  normal(id: string): Texture | null;
  quality: QualityProfile;
  /** zone id (BiomePreset.id: yeonmu | suryeon | seori | daeryeol) for palette / snow / ember variants */
  zone: string;
}

export interface StructurePart {
  geometry: BufferGeometry;
  material: Material;
  castShadow?: boolean;
  /** r9 ship: the shadow-pass material of a GLB part (the whole occlusion fade takes the shadow with it); absent = three's own */
  depthMaterial?: Material;
}

export interface StructureModel {
  parts: StructurePart[];
  /** per-frame hook (emissive flicker, banner flutter via uniforms ...); `time` = render seconds */
  update?(time: number): void;
}

export type StructureBuilder = (ctx: StructureBuildContext) => StructureModel;

export interface StructureDef {
  build: StructureBuilder;
  /** texture ids to preload before `build` runs */
  textures?: string[];
  /** extra texture ids that depend on the zone (palette-specific stone detail ...) */
  zoneTextures?: (zone: string) => string[];
}

// Shared contract between the zone render systems (terrain, vegetation, liquids, sky, structures) and zoneScene.ts.
// Every system builds from a ZoneContext, exposes a three.js group and gets per-frame updates from createZoneScene.
import { Vector2, Vector3, Vector4, type Object3D, type PerspectiveCamera, type Texture } from 'three';
import type { BiomePreset } from '../../data/schema';
import type { Assets } from '../../engine/assets';
import type { TerrainField } from '../../world/terrainField';
import type { RenderCore } from '../core';
import type { QualityProfile } from '../quality';

export interface ZoneContext {
  core: RenderCore;
  assets: Assets;
  field: TerrainField;
  biome: BiomePreset;
  /** current quality profile (systems also receive `setQuality` on changes) */
  quality: QualityProfile;
}

export interface ZoneSystem {
  readonly name: string;
  /** added to the scene by the owner (zoneScene) */
  readonly group: Object3D;
  /** resolves when async resources (textures, models) are ready; the loading screen awaits it */
  ready?: Promise<void>;
  /** `focus` = camera focus point (hero) in world space */
  update(dt: number, camera: PerspectiveCamera, focus: Vector3): void;
  setQuality(p: QualityProfile): void;
  dispose(): void;
}

/**
 * Uniform objects shared by every terrain-family shader (same object instances → one write per frame).
 * Updated by zoneScene.update(); shaders just reference them in their `uniforms` map.
 */
export const worldUniforms = {
  /** seconds of render time */
  uTime: { value: 0 },
  /** horizontal wind direction (unit XZ) */
  uWindDir: { value: new Vector2(0.8, 0.6) },
  /** wind strength 0..1 (gust-modulated every frame) */
  uWindStrength: { value: 0.6 },
  /** unit vector towards the sun */
  uSunDir: { value: new Vector3(0.45, 0.8, 0.35).normalize() },
  /** hero/camera focus (x,y,z) for distance fades */
  uFocus: { value: new Vector3() },
  /**
   * r8 Z8: up to 8 discs (x, z, r, 0; the GLSL array size in render/vegetation/coverMaterial.ts) where the ground cover draws no tuft: the rune carpets of the living metins (render/world.ts
   * fills them every frame; r 0 = an unused slot). The r7 judge saw grass blades and leaves draw over the runes in four zones.
   */
  uCoverClear: { value: Array.from({ length: 8 }, () => new Vector4()) },
};

/** Loads a texture id from the manifest; resolves null (not throws) when missing so a system can fall back. */
export async function tryTexture(assets: Assets, id: string): Promise<Texture | null> {
  try {
    return await assets.loadTexture(id);
  } catch {
    return null;
  }
}

export async function tryNormal(assets: Assets, id: string): Promise<Texture | null> {
  try {
    return await assets.loadNormalMap(id);
  } catch {
    return null;
  }
}

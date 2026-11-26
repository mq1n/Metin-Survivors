// Public entry of the VFX package: `createVfx(scene, camera, renderer, quality, opts)`.
import type { Camera, Scene, WebGLRenderer } from 'three';
import { VfxSystem } from './system';
import type { Vfx, VfxOptions, VfxQuality } from './types';

export type { ScreenFx, SpawnOpts, Vfx, VfxColor, VfxOptions, VfxQuality, VfxStats } from './types';
export { PALETTES, VARIANT_NAMES, type PaletteId } from './palette';
export { VfxSystem } from './system';

export function createVfx(scene: Scene, camera: Camera, renderer: WebGLRenderer, quality: VfxQuality, opts: VfxOptions = {}): Vfx {
  return new VfxSystem(scene, camera, renderer, quality, opts);
}

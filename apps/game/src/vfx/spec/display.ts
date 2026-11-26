// Display-space layer of the spec runtime.
//

// display values, each texture stage saturates at 1, and the framebuffer adds them to the already encoded picture, clamped
// per channel. Our scene is linear HDR (HalfFloat target), added in linear light, bloomed and tone mapped with ACES, which
//  - swallows dim texels (a texel of 0.1 adds ~0.04 over a dark floor here, 0.1 there),
//  - rolls stacked cores off to WHITE instead of clamping them to a saturated colour,
//  - and lets the game's bloom enlarge every bright core.
// No sprite gain can fix both ends, so additive spec elements flagged `space: 'display'` (FxSpec / ElementCommon, see
// resolveSpace) are drawn AFTER the final composite, straight onto the display-referred picture with fixed-function

//
// A post pipeline (render/post.ts, vfx/gallery/post.ts) cooperates in three calls:
//   const layer = displayLayer();            // the SpecHost of the page, or null
//   const any = layer?.beginScene();         // the display batches are skipped by the HDR scene pass (true = something to draw)
//   ... render the scene, bloom, composite to the canvas ...
//   layer?.drawOverlay(renderer, camera, sceneDepthTexture | null, width, height);   // canvas bound
// The scene depth is a manual test in the fragment shader (the canvas has no depth of its own after the composite); with no
// post pipeline (direct-to-canvas rendering) pass `null`: the canvas depth buffer still holds the scene.
// A renderer that never calls these keeps working: the display batches then draw inside the scene pass, in linear light
// (the pre-layer look), see SPEC_DISPLAY in shaders.ts.
import type { Camera, Texture, WebGLRenderer } from 'three';
import { ART_GAIN } from './artGain';
import { artParts } from './artScope';
import type { ElementSpec, FxSpec, SpaceMode } from './types';

export interface DisplayLayer {
  /** a post pipeline is about to render the scene into its HDR target: hide the display batches from that pass. Returns
   *  whether any display batch has live records, i.e. whether drawOverlay will draw (a pipeline that has to attach a scene depth
   *  texture for it can do so lazily, only when a display-space effect is actually on screen). */
  beginScene(): boolean;
  /** the final composite is on the canvas: draw the display batches onto it (no-op when beginScene was not called) */
  drawOverlay(renderer: WebGLRenderer, camera: Camera, sceneDepth: Texture | null, width: number, height: number): void;
}

let current: DisplayLayer | null = null;

/** the display layer of the page (the latest SpecHost), null when none exists */
export function displayLayer(): DisplayLayer | null {
  return current;
}

/** SpecHost registers itself; `null` (or another layer) on dispose */
export function setDisplayLayer(l: DisplayLayer | null): void {
  current = l;
}

/** unregisters `l` only when it is still the registered layer (a later host may already have replaced it) */
export function clearDisplayLayer(l: DisplayLayer): void {
  if (current === l) current = null;
}

/**
 * The blend space of an element: `element.space`, else `spec.space`, else the spec's default (defaultSpace).
 */
export function resolveSpace(spec: FxSpec, el: ElementSpec): SpaceMode {
  return el.space ?? spec.space ?? defaultSpace(spec);
}







export function defaultSpace(spec: FxSpec): SpaceMode {
  return /^sk\.(raw|draft)_/.test(spec.id) ? 'display' : 'linear';
}

/** the display-space brightness factor of an art key (artGain.ts; 1 = none, a frame list takes the mean of its frames) */
export function artGain(key: string): number {
  if (key === '') return 1;
  const parts = artParts(key);
  let sum = 0;
  for (const id of parts) sum += ART_GAIN[id] ?? 1;
  return sum / parts.length;
}

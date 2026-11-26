// Public types of the VFX package. Everything the Engine / adapter needs lives here.
import type { Camera, Scene, Texture, WebGLRenderer } from 'three';
import type { ArtSource, ArtStats } from './spec/art';
import type { RunArtTiers } from './spec/artTier';

export type VfxQuality = 'low' | 'medium' | 'high' | 'ultra';

/** Names of the element palettes (sim ElementIdx order). */
export const ELEMENT_NAMES = ['physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind'] as const;
export type ElementName = (typeof ELEMENT_NAMES)[number];

/** `color` accepts 0xRRGGBB, '#rrggbb' or -1 / undefined for "preset default". */
export type VfxColor = number | string;

/** What a caller may pass to `spawn`. Every field is optional except where a preset demands it (documented in the README). */
export interface SpawnOpts {
  x?: number;
  /** world height; default = terrain height at (x,z) */
  y?: number;
  z?: number;
  /** facing direction on the XZ plane (need not be normalised) */
  dirX?: number;
  dirZ?: number;
  /** yaw alternative to dirX/dirZ (0 faces +Z). dirX/dirZ win when both are set. */
  rot?: number;
  /** size: multiplier for `mult` presets, metres of radius/length for `radius` presets (see README) */
  scale?: number;
  /** seconds, for loops / telegraphs / zones. 0 or undefined = preset default */
  duration?: number;
  color?: VfxColor;
  /** element hint (sim ElementIdx or name) used to pick the palette when `color` is not given */
  element?: number | ElementName;
  /** second point for beams, chains, dash lanes */
  tx?: number;
  ty?: number;
  tz?: number;
  hasTarget?: boolean;
  /** 0..? brightness multiplier */
  intensity?: number;
  /** deterministic visual variation, any number */
  seed?: number;
  /** free parameter, preset-specific (documented per preset): count / angle / width ... */
  a?: number;
  b?: number;
  /** casting skill's rank 0..7 (1,2,3,M1,M2,G1,G2,P): `sk.*` specs gate elements (`minRank` / `maxRank`) and pick their
   *  per-grade keys (g0 = 0-2, g1 = M1-M2, g2 = G1-G2, g3 = P). Default 0. */
  rank?: number;
  /** awakened skill: grade 3 whatever `rank` says (rank 7 implies it) */
  awakened?: boolean;
  /** player index of the caster: socket-anchored spec elements read this hero's hands / weapon (default: the nearest
   *  hero whose sockets are fed, else a stand-in body) */
  caster?: number;
}

/** rank / caster of a skill effect (VfxSystem.track and the event adapter's skill lookup) */
export interface SkillMeta {
  rank: number;
  awakened: boolean;
  caster: number;
}

/** fills `out` for the skill whose preset id or skill id is `key`, cast by the player nearest (x, z); false = no
 *  player owns it (generic presets, enemies) */
export type SkillMetaSource = (key: string, x: number, z: number, out: SkillMeta) => boolean;

export interface VfxStats {
  /** draw calls issued by the VFX package this frame (≤ 8) */
  drawCalls: number;
  /** particles alive (additive + alpha batches) */
  particles: number;
  particlesAdd: number;
  particlesAlpha: number;
  shapes: number;
  ribbons: number;
  debris: number;
  /** running loops / tracked effects */
  loops: number;
  /** particles spawned since last stats() call / frame */
  spawnedThisFrame: number;
  /** dropped (budget) spawn requests this frame */
  droppedThisFrame: number;
  /** CPU ms spent in update() + spawn() this frame */
  cpuMs: number;
  quality: VfxQuality;
  /** triangles drawn by VFX batches (upper bound) */
  triangles: number;
  /** signature (elemental) effects active now and the draw calls they add (included in `drawCalls`) */
  elementalActive: number;
  elementalCalls: number;
  /** skill effect specs (`sk.*`) running, the draw calls they add (≤ 4, included in `drawCalls`), their live particles
   *  (included in `particles`) and parametric surfaces */
  specActive: number;
  specCalls: number;
  specParticles: number;
  specSurfaces: number;
}

/** Screen-space hooks Engine can apply (post pass / CSS overlay). Values are updated each update(). */
export interface ScreenFx {
  /** additive flash color (linear-ish 0..1) and intensity 0..1 */
  flashR: number;
  flashG: number;
  flashB: number;
  flashA: number;
  /** camera shake request in trauma units (0..1) accumulated this frame; Engine decides (rig.addTrauma) */
  shake: number;
}

export interface VfxOptions {
  /** terrain height sampler; spawn y and decal slopes use it */
  heightAt?: (x: number, z: number) => number;
  /** called with trauma units when a preset wants a camera shake */
  onShake?: (amount: number) => void;
  /** called when a preset wants a full-screen flash (r,g,b 0..1, alpha 0..1, seconds) */
  onFlash?: (r: number, g: number, b: number, a: number, dur: number) => void;
  /** also draw a full-screen flash quad inside VFX (default true). Disable when the post pipeline handles onFlash. */
  drawFlash?: boolean;
  /** scene depth texture for soft particles (optional; call setDepthTexture later) */
  depthTexture?: Texture | null;
  /** render order base for VFX meshes (default 40) */
  renderOrder?: number;
  /** signature (elemental) effects: default true (they only run at tier ≥ their minTier) */
  elemental?: boolean;
  /** mobile device hint: tightens low-tier particle/surface budgets and VRAM allocations */
  mobile?: boolean;
}

export interface Vfx {
  readonly name: 'vfx';
  /** Fire an effect. Returns a handle (>0) for looping presets, 0 for one-shots / unknown ids. */
  spawn(id: string, opts?: SpawnOpts): number;
  /** Stop a looping preset (graceful fade). */
  stop(handle: number): void;
  /** Move a looping preset (follow a unit). */
  move(handle: number, x: number, z: number, y?: number, dirX?: number, dirZ?: number): void;
  /**
   * Attach/refresh a moving effect (projectile trail, orbiting orb, aura) by a stable key (e.g. projectile handle).
   * Call every frame while the thing exists; it ends by itself ~0.1 s after the last call.
   */
  track(id: string, key: number, x: number, z: number, y?: number, dirX?: number, dirZ?: number, scale?: number, color?: VfxColor, meta?: SkillMeta): void;
  /** true while the looping effect behind `handle` runs */
  alive?(handle: number): boolean;
  /** rank / caster lookup for skill effects fired by sim events (app/skillVfxFeed installs it) */
  setSkillMeta?(fn: SkillMetaSource | null): void;
  /** hero body sockets for anchored skill elements (see VfxSystem.setSockets) */
  setSockets?(player: number, data: ArrayLike<number>): void;
  /**
   * loads + packs the generated sprites of the skill specs (await during loading). No `specs`: every registered spec's
   * sprites at full size (galleries, tools); `specs` (preset ids, RenderCatalog.vfxSpecs): only a run's own specs, within
   * the tier's VRAM budget. With `tiers` (RenderCatalog.vfxTiers, production only) only the NOW tier is awaited; the rest of
   * `specs` streams in behind the first seconds of the run (spec/artTier.ts, spec/art.ts).
   */
  preloadArt?(source: ArtSource, specs?: Iterable<string>, tiers?: RunArtTiers): Promise<void>;
  /** the last art bake (sprites, layers, cell px, VRAM bytes, ms) */
  artStats?(): ArtStats;
  /** Consume the sim's per-tick event list (read synchronously; nothing is retained). */
  handleEvents(events: ArrayLike<unknown>, count?: number): void;
  /** One sim event (use with a per-event listener hub such as `app/runEvents`). */
  handleEvent(e: unknown): void;
  /** Tell the adapter where the local player(s) are (auras / follow presets, camera-relative ambient). */
  setPlayer(index: number, x: number, z: number, y?: number): void;
  /** Ambient zone particles (`ambient.*`) follow this point (camera focus). */
  setFocus(x: number, z: number, y?: number): void;
  update(dt: number): void;
  setQuality(q: VfxQuality): void;
  setHeightAt(fn: ((x: number, z: number) => number) | null): void;
  setDepthTexture(tex: Texture | null, near?: number, far?: number): void;
  /** Drop everything alive (run restart). */
  clear(): void;
  has(id: string): boolean;
  presetIds(): readonly string[];
  stats(): VfxStats;
  readonly screen: ScreenFx;
  dispose(): void;
}

export type CreateVfx = (scene: Scene, camera: Camera, renderer: WebGLRenderer, quality: VfxQuality, opts?: VfxOptions) => Vfx;

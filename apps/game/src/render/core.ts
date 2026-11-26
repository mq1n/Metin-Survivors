// RenderCore: owns the WebGL2 renderer, scene, camera rig, lights/fog (Environment), quality state and the ordered
// list of render systems. One instance per page. Systems (crowd, hero, fx, terrain, vfx) register via addSystem().
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  Scene,
  Vector3,
  WebGLRenderer,
  type Camera,
} from 'three';
import type { Assets } from '../engine/assets';
import { settings, type SettingsData } from '../engine/settings';
import type { BiomePreset } from '../data/schema';
import { displayLayer } from '../vfx/spec/display';
import { CameraRig } from './camera';
import { AutoQuality, QualityState, guessTier, isMobileDevice, type QualityProfile, type QualityTier } from './quality';
import { GpuTimer } from './perf';

/** Ordered per-frame work. `update` runs after the camera rig moved, before the scene is drawn. */
export interface RenderSystem {
  readonly name: string;
  update(dt: number, alpha: number): void;
  /** called when the drawing-buffer size changes (CSS px, then device pixel ratio actually applied) */
  onResize?(width: number, height: number, pixelRatio: number): void;
  dispose?(): void;
}

/** Post-processing pipeline hook (implemented by render/post.ts). Must also handle the "no post" case itself. */
export interface FrameComposer {
  render(scene: Scene, camera: Camera, dt: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  dispose(): void;
}

export interface RenderFrameClock {
  /** seconds of render time since start */
  time: number;
  /** last raw frame delta (s), clamped to 0.25 */
  dt: number;
  frame: number;
}

/** Lights, fog and clear color for the active biome. */
export class Environment {
  readonly hemi = new HemisphereLight('#bcd0ff', '#4a3b2a', 0.9);
  readonly sun = new DirectionalLight('#fff1d6', 2.4);
  readonly fog = new Fog('#8fa6b8', 60, 160);
  /** direction from the scene towards the sun (unit) */
  readonly sunDir = new Vector3(0.45, 0.8, 0.35).normalize();

  private readonly shadowExtent = 24;
  private readonly basisR = new Vector3();
  private readonly basisU = new Vector3();
  private readonly tmp = new Vector3();

  constructor(scene: Scene) {
    scene.add(this.hemi, this.sun, this.sun.target);
    scene.fog = this.fog;
    scene.background = this.fog.color;
    const cam = this.sun.shadow.camera;
    const e = this.shadowExtent;
    cam.left = -e;
    cam.right = e;
    cam.top = e;
    cam.bottom = -e;
    cam.near = 1;
    cam.far = 120;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.sun.castShadow = false;
  }

  setBiome(b: Pick<BiomePreset, 'fog' | 'sun' | 'ambient'>): void {
    this.fog.color.set(b.fog.color);
    this.fog.near = b.fog.near;
    this.fog.far = b.fog.far;
    this.sun.color.set(b.sun.color);
    this.sun.intensity = b.sun.intensity;
    const d = this.tmp.set(b.sun.dir[0], b.sun.dir[1], b.sun.dir[2]);
    // `dir` may be authored either as "towards the sun" or "light travel direction"; keep the sun above the horizon.
    if (d.y < 0) d.negate();
    if (d.lengthSq() < 1e-6) d.set(0.4, 0.8, 0.3);
    this.sunDir.copy(d).normalize();
    this.hemi.color.set(b.ambient.sky);
    this.hemi.groundColor.set(b.ambient.ground);
    this.hemi.intensity = b.ambient.intensity;
  }

  /** Re-centres the shadow frustum on `focus`, snapped to shadow-map texels to avoid shimmering. */
  followShadow(focus: Vector3, mapSize: number): void {
    const up = Math.abs(this.sunDir.y) > 0.99 ? this.tmp.set(0, 0, 1) : this.tmp.set(0, 1, 0);
    this.basisR.crossVectors(up, this.sunDir).normalize();
    this.basisU.crossVectors(this.sunDir, this.basisR).normalize();
    const texel = (2 * this.shadowExtent) / mapSize;
    const a = Math.round(focus.dot(this.basisR) / texel) * texel;
    const b = Math.round(focus.dot(this.basisU) / texel) * texel;
    const c = focus.dot(this.sunDir);
    const target = this.sun.target.position;
    target.copy(this.basisR).multiplyScalar(a).addScaledVector(this.basisU, b).addScaledVector(this.sunDir, c);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 60);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }
}

export interface RenderCoreOptions {
  /** explicit tier (dev/bench) or 'auto' to follow settings + device */
  quality?: QualityTier | 'auto';
  /** disable the automatic downgrade governor (benchmarks) */
  fixedQuality?: boolean;
}

export class RenderCore {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  readonly env: Environment;
  readonly quality: QualityState;
  readonly governor: AutoQuality;
  readonly clock: RenderFrameClock = { time: 0, dt: 0, frame: 0 };
  readonly pixelRatioApplied = { value: 1 };
  /** true on phones/tablets: tightens WebGL resolution, anisotropy, shader complexity, vegetation, crowd & VFX budgets */
  readonly isMobile: boolean;
  /** terrain height sampler; replaced by the TERRAIN system when a zone loads */
  heightAt: (x: number, z: number) => number = () => 0;
  /** r7: where a metin break piece may rest (render/metin.ts REST_*: 0 ground, 1 under a liquid surface, 2 inside a static's body); replaced when a zone loads.
   *  r8 M8a: `r` = the piece's radius (its footprint is tested against the static bodies) */
  restAt: (x: number, z: number, r?: number) => number = () => 0;
  composer: FrameComposer | null = null;
  /** created on demand (perf overlay / benchmarks); null = off */
  gpuTimer: GpuTimer | null = null;

  private readonly systems: RenderSystem[] = [];
  private readonly unsubscribe: Array<() => void> = [];
  private cssW = 0;
  private cssH = 0;
  /** dynamic resolution multiplier stepped down by AutoQuality when already on 'low' (mobile starts at 0.8) */
  private renderScale = 1;
  private readonly resizeObserver: ResizeObserver;
  private _contextLost = false;
  private readonly contextLostListeners = new Set<() => void>();
  private readonly contextRestoredListeners = new Set<() => void>();
  private readonly onWebGLContextLost: (e: Event) => void;
  private readonly onWebGLContextRestored: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    readonly assets: Assets,
    opts: RenderCoreOptions = {},
  ) {
    this.canvas = canvas;
    this.isMobile = isMobileDevice();
    if (this.isMobile && typeof document !== 'undefined') {
      document.documentElement.dataset.mobile = '1';
    }
    this.renderScale = this.isMobile ? 0.8 : 1;
    const dpr = window.devicePixelRatio || 1;
    const renderer = new WebGLRenderer({
      canvas,
      antialias: !this.isMobile && dpr <= 1.5,
      alpha: false,
      // the hero x-ray (render/heroOutline.ts) masks itself with stencil, also when post is off (direct-to-canvas)
      stencil: true,
      powerPreference: 'high-performance',
    });
    this.renderer = renderer;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = true;
    // several passes per frame (post): accumulate renderer.info across them and reset once per frame
    renderer.info.autoReset = false;
    renderer.setClearColor(new Color('#0b0b10'));
    this.assets.anisotropy = this.isMobile ? 1 : Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const wanted = opts.quality ?? 'auto';
    const s = settings.value.quality;
    const resolved: QualityTier =
      wanted !== 'auto' ? wanted : s !== 'auto' ? s : guessTier(renderer.getContext() as WebGL2RenderingContext);
    this.quality = new QualityState(resolved);
    this.governor = new AutoQuality(this.quality, undefined, () => this.stepDownResolution());
    this.governor.enabled = !opts.fixedQuality && wanted === 'auto' && s === 'auto';

    this.env = new Environment(this.scene);
    this.unsubscribe.push(
      this.quality.onChange((p) => this.applyQuality(p)),
      settings.subscribe((d) => this.applySettings(d)),
    );
    this.applyQuality(this.quality.profile);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    this.onWebGLContextLost = (e: Event): void => {
      e.preventDefault();
      if (this._contextLost) return;
      this._contextLost = true;
      for (const fn of this.contextLostListeners) fn();
    };
    this.onWebGLContextRestored = (): void => {
      this._contextLost = false;
      this.resize(true);
      for (const fn of this.contextRestoredListeners) fn();
    };
    canvas.addEventListener('webglcontextlost', this.onWebGLContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onWebGLContextRestored, false);
  }

  get contextLost(): boolean {
    return this._contextLost;
  }

  onContextLost(fn: () => void): () => void {
    this.contextLostListeners.add(fn);
    return () => {
      this.contextLostListeners.delete(fn);
    };
  }

  onContextRestored(fn: () => void): () => void {
    this.contextRestoredListeners.add(fn);
    return () => {
      this.contextRestoredListeners.delete(fn);
    };
  }

  get camera(): CameraRig['camera'] {
    return this.rig.camera;
  }

  addSystem(sys: RenderSystem): void {
    this.systems.push(sys);
    sys.onResize?.(this.cssW, this.cssH, this.pixelRatioApplied.value);
  }

  removeSystem(sys: RenderSystem): void {
    const i = this.systems.indexOf(sys);
    if (i >= 0) this.systems.splice(i, 1);
  }

  setComposer(c: FrameComposer | null): void {
    this.composer?.dispose();
    this.composer = c;
    c?.setSize(this.cssW, this.cssH, this.pixelRatioApplied.value);
  }

  /** Applies a user tier choice (settings screen) — 'auto' re-enables the governor. */
  setQualitySetting(q: SettingsData['quality']): void {
    this.renderScale = this.isMobile && (q === 'auto' || q === 'low') ? 0.8 : 1;
    if (q === 'auto') {
      this.governor.enabled = true;
      this.governor.reset();
      this.quality.setTier(guessTier(this.renderer.getContext() as WebGL2RenderingContext));
    } else {
      this.governor.enabled = false;
      this.quality.setTier(q);
    }
    this.resize(true);
  }

  /** Adaptive resolution fallback when already at 'low' tier and frame times remain slow (especially mobile GPUs). */
  private stepDownResolution(): void {
    if (settings.value.dprCap > 0) return;
    const floor = this.isMobile ? 0.5 : 0.7;
    if (this.renderScale <= floor + 0.01) return;
    this.renderScale = Math.max(floor, Math.round(this.renderScale * 0.85 * 100) / 100);
    this.resize(true);
  }

  private applyQuality(p: QualityProfile): void {
    this.renderer.shadowMap.enabled = p.shadows;
    this.env.sun.castShadow = p.shadows;
    if (p.shadows) {
      const sh = this.env.sun.shadow;
      if (sh.mapSize.x !== p.shadowMapSize) {
        sh.mapSize.set(p.shadowMapSize, p.shadowMapSize);
        sh.map?.dispose();
        sh.map = null;
      }
    }
    this.resize(true);
  }

  private applySettings(d: SettingsData): void {
    this.rig.shakeScale = d.screenShake;
    this.resize(true);
  }

  /** Recomputes the drawing-buffer size from the canvas CSS box and the active DPR cap. */
  resize(force = false): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const explicitCap = settings.value.dprCap > 0;
    const cap = explicitCap ? settings.value.dprCap : this.quality.profile.dprCap;
    let pr = Math.min(window.devicePixelRatio || 1, cap);
    if (!explicitCap) {
      if (this.renderScale < 1) pr *= this.renderScale;
      // Mobile pixel-count ceiling (~520k px at initial 0.8 scale, scales down further with renderScale) so high-res tablets/phones never choke fill-rate.
      if (this.isMobile && this.quality.tier === 'low') {
        const maxPixels = 520_000 * (this.renderScale / 0.8);
        const curPixels = w * h * pr * pr;
        if (curPixels > maxPixels) pr *= Math.sqrt(maxPixels / curPixels);
        pr = Math.max(0.45, Math.round(pr * 100) / 100);
      }
    }
    if (!force && w === this.cssW && h === this.cssH && pr === this.pixelRatioApplied.value) return;
    this.cssW = w;
    this.cssH = h;
    this.pixelRatioApplied.value = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.rig.setAspect(w / h);
    this.composer?.setSize(w, h, pr);
    for (const s of this.systems) s.onResize?.(w, h, pr);
  }

  /** One rendered frame. `dt` = raw wall delta (s); `alpha` = sim interpolation factor (0..1). */
  frame(dt: number, alpha: number): void {
    if (this._contextLost) return;
    const d = Math.min(dt, 0.25);
    this.clock.dt = d;
    this.clock.time += d;
    this.clock.frame++;
    this.renderer.info.reset();
    this.governor.frame(dt);
    this.rig.update(d);
    const p = this.quality.profile;
    if (p.shadows) this.env.followShadow(this.rig.focus, p.shadowMapSize);
    for (const s of this.systems) s.update(d, alpha);
    this.gpuTimer?.begin();
    if (this.composer) this.composer.render(this.scene, this.rig.camera, d);
    else {
      // no post pipeline (tools, tests): display-space spec effects still draw after the scene, onto the canvas
      const layer = displayLayer();
      layer?.beginScene();
      this.renderer.render(this.scene, this.rig.camera);
      layer?.drawOverlay(this.renderer, this.rig.camera, null, this.canvas.width, this.canvas.height);
    }
    this.gpuTimer?.end();
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onWebGLContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.onWebGLContextRestored, false);
    this.contextLostListeners.clear();
    this.contextRestoredListeners.clear();
    for (const u of this.unsubscribe) u();
    this.resizeObserver.disconnect();
    for (const s of this.systems) s.dispose?.();
    this.systems.length = 0;
    this.composer?.dispose();
    this.renderer.dispose();
  }
}

// Asset loading: public/assets/manifest.json (merged by tools/pipeline/manifest.ts) → GLB models (meshopt) and textures.
// Missing ids throw MissingAssetError, except in DEV builds where src/dev/placeholders.ts supplies stand-ins.
import {
  type AnimationClip,
  type Bone,
  type Group,
  type Object3D,
  type SkinnedMesh,
  Mesh,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetManifest, ModelAsset, ModelKind, TextureAsset } from '../data/assetManifest';

export class MissingAssetError extends Error {
  constructor(
    readonly kind: 'model' | 'texture' | 'manifest',
    readonly id: string,
  ) {
    super(`missing ${kind} asset: ${id}`);
    this.name = 'MissingAssetError';
  }
}

/** Scene-level `extras` written by FORGE (see ARCHITECTURE §5.1). Everything optional: older GLBs may lack it. */
export interface ModelExtras {
  id?: string;
  kind?: ModelKind;
  height?: number;
  radius?: number;
  hit?: Record<string, number>;
  sockets?: Record<string, string>;
  palette?: string[];
  /** seconds into `special1` during which the model breathes fire (emissive surge, VFX origin = `muzzle` socket) */
  breath?: { start: number; end: number };
  /** metres the `fly` clip lifts the body (if a pattern uses it) */
  flyHeight?: number;
  /**
   * Metin stones (E3, forge-audit plan): `false` = the model carries its OWN emissive mask, so the renderer neither binds the 13
   * per-type rune glyph maps nor fetches them, and drives the damage ramp + `hit` clip. Absent (every forge stone) = today's behaviour.
   */
  glyph?: boolean;
  /**
   * Metin stones with their own mask (r5, opt-in): `bodyTint` (0..1) = how far the stone's albedo is multiplied toward its type's colour
   * (render/metin.ts metinBodyTint: saturation floor, fixed luminance), so the 13 types of the shared small stone differ in body, not only in the cracks.
   * `emissiveCap` [knee, cap] = soft ceiling of the alive / awakened emissive intensity (the glow keeps its hue instead of clipping to white). Absent = today's behaviour.
   */
  bodyTint?: number;
  /** r6 (opt-in): the linear mean luminance of the stone's albedo; the 13 small types then take their body colour from render/metin.ts METIN_TYPE_BODY (CIEDE2000 >= 15 apart) */
  bodyPalette?: number;
  /** r6 (opt-in): the break pieces rest on the terrain under them (render/metin.ts followTerrain), not on the stone's base height */
  terrainRest?: boolean;
  /** r6 (opt-in): opacity factor (0..1) of a tight break glow round the pile instead of the screen-wide additive rune sprite */
  breakGlow?: number;
  /** r8 M8a (opt-in, bodyPalette stones): 0..1 how far the strict core of the stone's emissive mask leans to white (a hot crack core inside the rune-coloured falloff) */
  veinCore?: number;
  /** r8 M8a (opt-in, bodyPalette stones): luminance contrast added to the NEUTRAL types' body texture (render/metin.ts metinTypeDetail), so they never read as scenery boulders */
  typeDetail?: number;
  /** r8 M8a (opt-in, bodyPalette stones): 0..1 white balance of the type colour against the zone's light (render/metin.ts metinWhiteBalance) */
  typeWB?: number;
  /** r8 M8a (opt-in, bodyPalette stones): per-type corrections of render/metin.ts METIN_TYPE_BODY, { '<rune hex>': '<body hex>' } (absent entries keep the shared palette) */
  typeBody?: Record<string, string>;
  /** r8 M8a (opt-in): emissive intensity the break pieces keep after the break flash (the interior's veins glow, cooling to the old 0.2 by the end of the shatter clip) */
  breakEmber?: number;
  /** r9 M9b (opt-in, terrainRest stones): the r9 rest of the break pieces (render/metinRest9.ts): per-piece radii, stacked prop bodies and ledges, an eased
   *  push, the rise limit (no piece on a bridge deck / parapet), the footprint liquid test and the readable sink cue */
  rest9?: boolean;
  /** r9 M9b (opt-in): 0..1 opacity of the soft ground glow under a breaking stone's pile (render/metinGroundGlow.ts), which replaces the break billboard */
  breakHeat?: number;
  /** r10 M10b (opt-in, breakHeat stones): a frost / lightning stone: its break light is a brief whitened ring (metinBreakHeat cold) and its flash whitens
   *  the rune instead of burning orange, so breakEmber can keep its cracks glowing without an orange heat disc */
  breakCold?: boolean;
  /** r10 M10b (opt-in, rest9 stones): a piece sinking into lava throws the translucent steam plume with rising sparks (metinSinkCue 'steam') */
  sinkSteam?: boolean;
  /** r9 M9a (opt-in, bodyPalette stones): the emissive texture carries its own hot core (the default rune's falloff with a white-hot centre line, emissiveFactor
   *  white): render/metin.ts reads its max channel back as the type's grey mask and its whiteness as the core (EMISSIVE_MAP_GLSL) */
  veinBaked?: boolean;
  emissiveCap?: [number, number];
  /**
   * Weapon meta of the static Tripo route (type, tier, grip, length, ...). `clipHold` (r4, opt-in): per-clip hold of the weapon root in the hand-socket
   * frame, { <clip>: [rx, ry, rz] degrees }, blended by render/weaponHold.ts over the static GLB hold; absent = the static hold only (today's behaviour).
   */
  weapon?: { clipHold?: Record<string, [number, number, number]> } & Record<string, unknown>;
  
  humanoid?: { handFrame?: string } & Record<string, unknown>;
}

export interface LoadedModel {
  id: string;
  /** manifest entry (synthesised for dev placeholders) */
  asset: ModelAsset;
  /** Template graph. NEVER add it to a scene; use `Assets.instantiate` (skinned-safe clone). */
  scene: Group;
  clips: AnimationClip[];
  clipMap: ReadonlyMap<string, AnimationClip>;
  /** all SkinnedMeshes in traversal order */
  skinned: SkinnedMesh[];
  /** all Meshes (skinned or not) in traversal order */
  meshes: Mesh[];
  extras: ModelExtras;
  /** true for DEV stand-ins; never true in production builds */
  placeholder: boolean;
}

export interface ModelInstance {
  root: Object3D;
  skinned: SkinnedMesh[];
  meshes: Mesh[];
  clips: AnimationClip[];
  /** bone by name (sockets resolve through model.asset.sockets) */
  bones: Map<string, Object3D>;
}

export interface AssetRequest {
  kind: 'model' | 'texture';
  id: string;
  /** model kind hint for DEV placeholders */
  hint?: ModelKind;
}

export interface LoadProgress {
  done: number;
  total: number;
  /** byte-weighted 0..1 */
  fraction: number;
  current: string;
}

/** Shape the dev placeholder module must return (see src/dev/placeholders.ts). */
export interface PlaceholderModel {
  scene: Group;
  clips: AnimationClip[];
  asset: ModelAsset;
}

export class Assets {
  manifest: AssetManifest = emptyManifest();
  readonly base: string;
  anisotropy = 4;

  private readonly gltf = new GLTFLoader();
  private readonly texLoader = new TextureLoader();
  private readonly models = new Map<string, LoadedModel>();
  private readonly modelLoads = new Map<string, Promise<LoadedModel>>();
  private readonly textures = new Map<string, Texture>();
  private readonly textureLoads = new Map<string, Promise<Texture>>();
  /** normal maps by texture id (like `textures`: shared and owned by Assets, so zone scenes never dispose them) */
  private readonly normalLoads = new Map<string, Promise<Texture | null>>();
  /** the normal map files, downloaded once per page and shared by `loadNormalMapNow` and the ground's worker fade */
  private readonly normalFiles = new Map<string, Promise<Blob>>();
  /** late normal maps (payload policy, `holdNormalMaps`): a flat stand-in, handed out at once, waiting for its image */
  private readonly standIns = new Map<string, Texture>();
  /** pending while `holdNormalMaps` has an open gate: `loadNormalMap` then answers with stand-ins */
  private normalHold: Promise<void> | null = null;
  /** the stand-in swaps run one after the other, `NORMAL_SWAP_GAP_MS` apart (one GPU re-upload at a time) */
  private swapTail: Promise<void> = Promise.resolve();

  constructor(base: string = import.meta.env.BASE_URL) {
    this.base = base.endsWith('/') ? base : `${base}/`;
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
  }

  /** Resolves a manifest-relative path ("assets/...") against the page base. */
  url(path: string): string {
    return /^(https?:|blob:|data:)/.test(path) ? path : this.base + path.replace(/^\//, '');
  }

  /** Fetches the manifest. In DEV, falls back to merging the producer parts, then to an empty manifest. */
  async init(): Promise<void> {
    const res = await fetch(this.url('assets/manifest.json'), { cache: 'no-cache' }).catch(() => null);
    if (res?.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      this.manifest = normalizeManifest((await res.json()) as Partial<AssetManifest>);
      return;
    }
    if (!import.meta.env.DEV) throw new MissingAssetError('manifest', 'assets/manifest.json');
    const merged = emptyManifest();
    for (const part of ['models', 'textures', 'icons', 'audio'] as const) {
      const r = await fetch(this.url(`assets/manifest/${part}.json`), { cache: 'no-cache' }).catch(() => null);
      if (r?.ok && (r.headers.get('content-type') ?? '').includes('json')) {
        Object.assign(merged[part], (await r.json()) as Record<string, never>);
      }
    }
    this.manifest = merged;
  }

  hasModel(id: string): boolean {
    return id in this.manifest.models;
  }

  hasTexture(id: string): boolean {
    return id in this.manifest.textures;
  }

  /** Sync getter for an already loaded model. Throws when it was not preloaded. */
  model(id: string): LoadedModel {
    const m = this.models.get(id);
    if (!m) throw new MissingAssetError('model', id);
    return m;
  }

  texture(id: string): Texture {
    const t = this.textures.get(id);
    if (!t) throw new MissingAssetError('texture', id);
    return t;
  }

  isModelLoaded(id: string): boolean {
    return this.models.has(id);
  }

  loadModel(id: string, hint?: ModelKind): Promise<LoadedModel> {
    const done = this.models.get(id);
    if (done) return Promise.resolve(done);
    let p = this.modelLoads.get(id);
    if (!p) {
      p = this.fetchModel(id, hint).then((m) => {
        this.models.set(id, m);
        this.modelLoads.delete(id);
        return m;
      });
      p.catch(() => this.modelLoads.delete(id));
      this.modelLoads.set(id, p);
    }
    return p;
  }

  loadTexture(id: string): Promise<Texture> {
    const done = this.textures.get(id);
    if (done) return Promise.resolve(done);
    let p = this.textureLoads.get(id);
    if (!p) {
      p = this.fetchTexture(id).then((t) => {
        this.textures.set(id, t);
        this.textureLoads.delete(id);
        return t;
      });
      p.catch(() => this.textureLoads.delete(id));
      this.textureLoads.set(id, p);
    }
    return p;
  }

  /** Loads many assets with bounded parallelism and byte-weighted progress. Rejects on the first failure. */
  async loadBatch(requests: readonly AssetRequest[], onProgress?: (p: LoadProgress) => void): Promise<void> {
    const unique = new Map<string, AssetRequest>();
    for (const r of requests) unique.set(`${r.kind}:${r.id}`, r);
    const list = [...unique.values()];
    const weight = (r: AssetRequest): number => {
      const bytes = r.kind === 'model' ? this.manifest.models[r.id]?.bytes : this.manifest.textures[r.id]?.bytes;
      return Math.max(bytes ?? 0, 1024);
    };
    const total = list.reduce((s, r) => s + weight(r), 0) || 1;
    let loadedBytes = 0;
    let done = 0;
    let next = 0;
    onProgress?.({ done: 0, total: list.length, fraction: 0, current: '' });
    const worker = async (): Promise<void> => {
      for (;;) {
        const r = list[next++];
        if (!r) return;
        if (r.kind === 'model') await this.loadModel(r.id, r.hint);
        else await this.loadTexture(r.id);
        loadedBytes += weight(r);
        done++;
        onProgress?.({ done, total: list.length, fraction: loadedBytes / total, current: r.id });
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, list.length) }, worker));
  }

  /** Skinned-safe clone of a loaded model for placing in a scene. */
  instantiate(id: string): ModelInstance {
    const m = this.model(id);
    const root = cloneSkinned(m.scene);
    const skinned: SkinnedMesh[] = [];
    const meshes: Mesh[] = [];
    const bones = new Map<string, Object3D>();
    root.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh);
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
      if ((o as Bone).isBone) bones.set(o.name, o);
    });
    return { root, skinned, meshes, clips: m.clips, bones };
  }

  private async fetchModel(id: string, hint?: ModelKind): Promise<LoadedModel> {
    const asset = this.manifest.models[id];
    if (!asset) {
      if (import.meta.env.DEV) {
        // Runtime-selected on purpose: DEV-only module must be tree-shaken out of production builds.
        const dev = await import('../dev/placeholders');
        const ph = await dev.makePlaceholderModel(id, hint);
        return buildLoaded(id, ph.asset, ph.scene, ph.clips, true);
      }
      throw new MissingAssetError('model', id);
    }
    const gltf = await this.gltf.loadAsync(this.url(asset.url));
    return buildLoaded(id, asset, gltf.scene, gltf.animations, false);
  }

  private async fetchTexture(id: string): Promise<Texture> {
    const asset = this.manifest.textures[id];
    if (!asset) {
      if (import.meta.env.DEV) {
        // Runtime-selected on purpose: DEV-only module must be tree-shaken out of production builds.
        const dev = await import('../dev/placeholders');
        return dev.makePlaceholderTexture(id);
      }
      throw new MissingAssetError('texture', id);
    }
    const tex = await this.texLoader.loadAsync(this.url(asset.url));
    configureTexture(tex, asset, this.anisotropy);
    return tex;
  }

  /**
   * Payload policy (ARCHITECTURE §11): until `gate` resolves, `loadNormalMap` answers with a flat stand-in instead of
   * downloading the map; once it opens every map asked for in the meantime is fetched and swapped into its stand-in. The
   * ground's normal arrays use the same gate (render/terrain/layerTextures.ts registers it), so rocks, bark and ice get their
   * relief at the same moment the ground fades its in. The latest gate wins (one per zone scene); maps already loaded are
   * never held back.
   */
  holdNormalMaps(gate: Promise<void>): void {
    const release = (): void => {
      if (this.normalHold === hold) this.normalHold = null;
    };
    const hold: Promise<void> = gate.then(release, release);
    this.normalHold = hold;
  }

  /**
   * A tangent-space normal map (`normalUrl`, linear color space), cached per id and shared like every other manifest texture.
   * With a closed `holdNormalMaps` gate it is a flat stand-in (the same Texture object the real map is swapped into later,
   * so no consumer needs to know and no shader variant changes); use `loadNormalMapNow` when the pixels are needed.
   */
  loadNormalMap(id: string): Promise<Texture | null> {
    const asset = this.manifest.textures[id];
    if (!asset?.normalUrl) return Promise.resolve(null);
    const stand = this.standIns.get(id);
    if (stand) {
      // no download in flight or done: an earlier one failed (or the hold is still shut), so ask again once the hold is over
      if (!this.normalLoads.has(id)) void (this.normalHold ?? Promise.resolve()).then(() => this.loadNormalMapNow(id)).catch(() => undefined);
      return Promise.resolve(stand);
    }
    const hold = this.normalHold;
    if (hold && !this.normalLoads.has(id)) {
      const tex = new Texture(flatImage());
      configureTexture(tex, { ...asset, srgb: false }, this.anisotropy);
      this.standIns.set(id, tex);
      void hold.then(() => this.loadNormalMapNow(id)).catch(() => undefined); // a failed download leaves the flat stand-in
      return Promise.resolve(tex);
    }
    return this.loadNormalMapNow(id);
  }

  /** The real normal map, whatever the hold: downloads it now (once) and resolves when its image is in place. */
  loadNormalMapNow(id: string): Promise<Texture | null> {
    const asset = this.manifest.textures[id];
    if (!asset?.normalUrl) return Promise.resolve(null);
    // cached per id: an uncached load made a fresh texture (and GPU upload) for every zone scene of every run, and nobody
    // owned it to dispose it (+3 512² and +1 1024² mipmapped textures per run)
    let p = this.normalLoads.get(id);
    if (!p) {
      p = this.fetchNormal(id, asset).then((tex) => this.adoptNormal(id, tex));
      p.catch(() => this.normalLoads.delete(id));
      this.normalLoads.set(id, p);
    }
    return p;
  }

  /** The normal map's file (WebP bytes), downloaded once per page. Rejects when it cannot be fetched (a later call retries). */
  normalFile(id: string): Promise<Blob> {
    const asset = this.manifest.textures[id];
    if (!asset?.normalUrl) return Promise.reject(new MissingAssetError('texture', id));
    let p = this.normalFiles.get(id);
    if (!p) {
      p = fetch(this.url(asset.normalUrl)).then((res) => {
        if (!res.ok) throw new Error(`normal map ${id}: HTTP ${res.status}`);
        return res.blob();
      });
      p.catch(() => this.normalFiles.delete(id));
      this.normalFiles.set(id, p);
    }
    return p;
  }

  private async fetchNormal(id: string, asset: TextureAsset): Promise<Texture> {
    const file = await this.normalFile(id);
    const url = URL.createObjectURL(file);
    try {
      const tex = await this.texLoader.loadAsync(url);
      configureTexture(tex, { ...asset, srgb: false }, this.anisotropy);
      return tex;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** a loaded normal map becomes the image of its stand-in (when it has one); the swaps are paced one GPU upload at a time */
  private adoptNormal(id: string, tex: Texture): Promise<Texture> {
    const stand = this.standIns.get(id);
    if (!stand) return Promise.resolve(tex);
    const swap = this.swapTail
      .then(() => new Promise<void>((r) => setTimeout(r, NORMAL_SWAP_GAP_MS)))
      .then(() => {
        this.standIns.delete(id);
        stand.image = tex.image;
        stand.dispose(); // drops the 1×1 GPU texture: the image changes size, so the next frame allocates it afresh
        stand.needsUpdate = true;
        return stand;
      });
    this.swapTail = swap.then(
      () => undefined,
      () => undefined,
    );
    return swap;
  }
}

/** ms between two stand-in swaps */
const NORMAL_SWAP_GAP_MS = 150;

/** the 1×1 flat tangent-space normal (128, 128, 255) a late normal map starts as */
function flatImage(): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = 'rgb(128,128,255)';
    g.fillRect(0, 0, 1, 1);
  }
  return c;
}

function configureTexture(tex: Texture, asset: TextureAsset, anisotropy: number): void {
  tex.colorSpace = asset.srgb ? SRGBColorSpace : '';
  if (asset.tiling) tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
}

function buildLoaded(id: string, asset: ModelAsset, scene: Group, clips: AnimationClip[], placeholder: boolean): LoadedModel {
  const skinned: SkinnedMesh[] = [];
  const meshes: Mesh[] = [];
  scene.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh);
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  scene.updateMatrixWorld(true);
  const clipMap = new Map<string, AnimationClip>();
  for (const c of clips) clipMap.set(c.name.toLowerCase(), c);
  return {
    id,
    asset,
    scene,
    clips,
    clipMap,
    skinned,
    meshes,
    extras: (scene.userData ?? {}) as ModelExtras,
    placeholder,
  };
}

function emptyManifest(): AssetManifest {
  return { version: '0', models: {}, textures: {}, icons: {}, audio: {} };
}

function normalizeManifest(m: Partial<AssetManifest>): AssetManifest {
  return {
    version: m.version ?? '0',
    models: m.models ?? {},
    textures: m.textures ?? {},
    icons: m.icons ?? {},
    audio: m.audio ?? {},
  };
}

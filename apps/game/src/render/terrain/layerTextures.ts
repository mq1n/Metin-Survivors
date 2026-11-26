// Builds the ground splat texture arrays (albedo sRGB + tangent normals) from the zone's ground layers.
// All layers are resampled to one square size so a single sampler2DArray serves every layer.
import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from 'three';
import type { Assets } from '../../engine/assets';
import type { GroundLayer } from '../../world/layoutTypes';
import { lazyContent } from '../payloadPolicy';
import type { NormalJob, NormalReply } from './terrainNormals.worker';
import { tryTexture } from './zoneContext';

/** textures Imagegen may not have shipped yet → closest available stand-in */
const FALLBACK: Record<string, string> = {
  tex_plaza_tile: 'tex_dirt_path',
  tex_cobble_dark: 'tex_basalt',
  tex_wood_plank: 'tex_dirt_path',
  tex_rock_basalt_cols: 'tex_basalt',
};

export const MAX_LAYERS = 8;

/** seconds of run rendering the ground waits before its normal maps are fetched (see `normalsGate`) */
const NORMALS_AFTER_S = 9;
/** the fade from the flat normal to the real one: share of the map in each step, and the pause between two uploads (ms) */
const NORMAL_FADE = [0.2, 0.4, 0.6, 0.8, 1];
const NORMAL_STEP_MS = 160;
const FLAT_NORMAL: [number, number, number] = [128, 128, 255];

export interface LayerArrays {
  albedo: DataArrayTexture;
  /** null when normals are disabled (low quality) */
  normal: DataArrayTexture | null;
  size: number;
  layers: number;
}

type Drawable = CanvasImageSource & { width?: number; height?: number };

/** `mix` < 1 (normal maps only) blends the image over the flat normal: that share of its relief */
function readPixels(src: Drawable | null, size: number, fill: [number, number, number], flat: boolean, mix = 1): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2d context unavailable');
  if (src) {
    if (mix < 1) {
      g.fillStyle = `rgb(${FLAT_NORMAL.join(',')})`;
      g.fillRect(0, 0, size, size);
      g.globalAlpha = mix;
    }
    g.drawImage(src, 0, 0, size, size);
  } else {
    g.fillStyle = flat ? 'rgb(128,128,255)' : `rgb(${fill[0]},${fill[1]},${fill[2]})`;
    g.fillRect(0, 0, size, size);
  }
  return new Uint8Array(g.getImageData(0, 0, size, size).data.buffer);
}

/** the real normal map of a texture id (never the flat stand-in of a held normal map: the ground reads its pixels), or null */
async function realNormal(assets: Assets, id: string): Promise<Texture | null> {
  try {
    return await assets.loadNormalMapNow(id);
  } catch {
    return null;
  }
}

function hexToRgb(hex: string | undefined, def: [number, number, number]): [number, number, number] {
  if (!hex) return def;
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function configure(tex: DataArrayTexture, srgb: boolean, anisotropy: number): void {
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
}

/**
 * The `deferNormals` argument of `buildLayerArrays` for a zone's ground: resolves once the render clock (`RenderCore.clock`)
 * has run NORMALS_AFTER_S seconds (frames only render in a run, so this is run time). Undefined where content is not
 * streamed (dev server, see payloadPolicy): the normal maps then load with the albedo, as before.
 */
export function normalsGate(clock: { time: number }): Promise<void> | undefined {
  return lazyContent() ? afterPlaying(clock, NORMALS_AFTER_S) : undefined;
}

export function afterPlaying(clock: { time: number }, seconds: number): Promise<void> {
  const t0 = clock.time;
  // the clock only runs in a run: a zone that is never played (disposed first) stops polling after 5 minutes
  const giveUp = Date.now() + 300_000;
  return new Promise((resolve) => {
    const poll = (): void => {
      if (clock.time - t0 >= seconds || Date.now() > giveUp) resolve();
      else setTimeout(poll, 250);
    };
    setTimeout(poll, 250);
  });
}

/**
 * Builds the splat arrays. `deferNormals` (payload policy, ARCHITECTURE §11): without it the normal maps are fetched with
 * the albedo, before the array exists. With it the normal array starts flat and only the albedo is awaited; the normal
 * maps are fetched once the promise resolves (`normalsGate`: after the first seconds of the run),
 * and each layer fades from flat to its real relief in five uploads (`addLayerUpdate`: one layer, not the whole array), so
 * the ground's lighting never pops. The array object stays the same, the material needs no swap.
 * The same gate also holds back every other standalone normal map of the zone (rocks, bark, ice: `Assets.holdNormalMaps`).
 * This runs first and synchronously, before the zone's other systems (created after the terrain, see `createZoneScene`) ask
 * for theirs.
 */
export async function buildLayerArrays(
  assets: Assets,
  layers: readonly GroundLayer[],
  size: number,
  withNormals: boolean,
  deferNormals?: Promise<void>,
): Promise<LayerArrays> {
  if (deferNormals) assets.holdNormalMaps(deferNormals);
  const count = Math.min(MAX_LAYERS, Math.max(1, layers.length));
  const layerBytes = size * size * 4;
  const defer = withNormals && deferNormals !== undefined;
  const albedoData = new Uint8Array(layerBytes * count);
  const normalData = withNormals ? new Uint8Array(layerBytes * count) : null;
  const loaded = await Promise.all(
    layers.slice(0, count).map(async (l) => {
      let id = l.tex;
      let alb = await tryTexture(assets, id);
      if (!alb && FALLBACK[id]) {
        id = FALLBACK[id] as string;
        alb = await tryTexture(assets, id);
      }
      const nrm = withNormals && !defer && alb ? await realNormal(assets, id) : null;
      return { alb, nrm, id };
    }),
  );
  for (let i = 0; i < count; i++) {
    const l = layers[i] as GroundLayer;
    const item = loaded[i] as { alb: Texture | null; nrm: Texture | null };
    const fill = hexToRgb(l.tint, [128, 128, 128]);
    albedoData.set(readPixels((item.alb?.image as Drawable | undefined) ?? null, size, fill, false), i * layerBytes);
    if (normalData && !defer) normalData.set(readPixels((item.nrm?.image as Drawable | undefined) ?? null, size, fill, true), i * layerBytes);
  }
  const albedo = new DataArrayTexture(albedoData, size, size, count);
  configure(albedo, true, assets.anisotropy);
  let normal: DataArrayTexture | null = null;
  if (normalData) {
    if (defer) new Uint32Array(normalData.buffer).fill(0xffff8080); // RGBA = 128, 128, 255, 255 (little endian)
    normal = new DataArrayTexture(normalData, size, size, count);
    configure(normal, false, Math.min(4, assets.anisotropy));
    if (deferNormals) {
      const ids = loaded.map((x) => (x.alb ? x.id : null));
      void fadeInNormals(assets, normal, ids, size, deferNormals);
    }
  }
  return { albedo, normal, size, layers: count };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** the fade worker, or null where workers / ImageBitmap / OffscreenCanvas do not exist (the fade then runs on the main thread, ~25 ms a step) */
function openNormalWorker(): Worker | null {
  if (typeof Worker === 'undefined' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null;
  try {
    return new Worker(new URL('./terrainNormals.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

/**
 * the normal map file of a texture id, or null (none shipped / failed). Goes through `Assets.normalFile`, so a map that
 * rocks / bark / ice also use (`tex_yeonmu_rock_granite_n`) is downloaded once, not once here and once by the texture loader.
 */
async function fetchNormalBlob(assets: Assets, id: string): Promise<Blob | null> {
  if (!assets.manifest.textures[id]?.normalUrl) return null;
  try {
    return await assets.normalFile(id);
  } catch {
    return null;
  }
}

/** a decoded copy of a normal map file (decoded off the main thread; one per layer, a worker job takes it over) */
async function decodeNormal(blob: Promise<Blob | null>): Promise<ImageBitmap | null> {
  const file = await blob;
  if (!file) return null;
  try {
    return await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    try {
      return await createImageBitmap(file); // engines that ignore / reject the options
    } catch {
      return null;
    }
  }
}

/**
 * Fetches the normal maps of `ids` (null = a layer without albedo stays flat) and fades each into `normal`, one layer at a
 * time: `NORMAL_FADE.length` uploads of that layer only, `NORMAL_STEP_MS` apart. The pixels come from a worker (the main
 * thread only copies them and uploads); where there is no worker, or it fails, from a main-thread canvas (~25 ms a step).
 */
async function fadeInNormals(assets: Assets, normal: DataArrayTexture, ids: readonly (string | null)[], size: number, when: Promise<void>): Promise<void> {
  let gone = false;
  let wake: (() => void) | null = null;
  normal.addEventListener('dispose', () => {
    gone = true;
    wake?.();
  });
  await when;
  if (gone) return;
  const data = normal.image.data as Uint8Array;
  const layerBytes = size * size * 4;
  let worker = openNormalWorker();
  const inbox: NormalReply[] = [];
  const dropWorker = (): void => {
    worker?.terminate();
    worker = null;
    wake?.();
  };
  if (worker) {
    worker.onmessage = (e: MessageEvent<NormalReply>) => {
      inbox.push(e.data);
      wake?.();
    };
    worker.onerror = dropWorker; // blocked / failed to start: the main thread takes over
  }
  const upload = (layer: number, pixels: Uint8Array): void => {
    data.set(pixels, layer * layerBytes);
    normal.addLayerUpdate(layer);
    normal.needsUpdate = true;
  };
  const maps: Array<Promise<ImageBitmap | null>> = [];
  const closedOrMoved = new Set<number>();
  try {
    // every download starts at once (once per texture, layers may share one); the uploads then go layer by layer
    const files = new Map<string, Promise<Blob | null>>();
    const fileOf = (id: string): Promise<Blob | null> => files.get(id) ?? (files.set(id, fetchNormalBlob(assets, id)), files.get(id) as Promise<Blob | null>);
    for (const id of ids) maps.push(id && worker ? decodeNormal(fileOf(id)) : Promise.resolve(null));
    // the main-thread path (no worker, or a failed one) downloads through the texture loader, also all at once
    const textures = new Map<string, Promise<Texture | null>>();
    const textureOf = (id: string): Promise<Texture | null> => textures.get(id) ?? (textures.set(id, realNormal(assets, id)), textures.get(id) as Promise<Texture | null>);
    if (!worker) for (const id of ids) if (id) void textureOf(id);
    for (let i = 0; i < ids.length && !gone; i++) {
      const id = ids[i];
      if (!id) continue;
      const bitmap = await maps[i];
      if (gone) {
        if (bitmap) {
          closedOrMoved.add(i);
          bitmap.close();
        }
        return;
      }
      let done = false;
      if (worker && bitmap) {
        closedOrMoved.add(i);
        worker.postMessage({ id: i, bitmap, size, mixes: NORMAL_FADE } satisfies NormalJob, [bitmap]);
        done = true;
        for (let k = 0; k < NORMAL_FADE.length; k++) {
          while (inbox.length === 0 && !gone && worker) await new Promise<void>((r) => (wake = r));
          if (gone) return;
          const reply = inbox.shift();
          if (!reply || reply.pixels.byteLength !== layerBytes) {
            done = false; // the worker died or cannot draw: this layer is finished on the main thread
            break;
          }
          upload(i, new Uint8Array(reply.pixels));
          await sleep(NORMAL_STEP_MS);
        }
        inbox.length = 0;
      } else if (worker && !bitmap) {
        continue; // no normal map shipped for this texture
      } else if (bitmap) {
        closedOrMoved.add(i);
        bitmap.close();
      }
      if (done) continue;
      const img = (await textureOf(id))?.image as Drawable | undefined;
      if (!img) continue;
      for (const mix of NORMAL_FADE) {
        if (gone) return;
        upload(i, readPixels(img, size, FLAT_NORMAL, true, mix));
        await sleep(NORMAL_STEP_MS);
      }
    }
  } finally {
    worker?.terminate();
    for (let j = 0; j < maps.length; j++) {
      if (closedOrMoved.has(j)) continue;
      void maps[j]?.then((b) => b?.close(), () => undefined);
    }
  }
}

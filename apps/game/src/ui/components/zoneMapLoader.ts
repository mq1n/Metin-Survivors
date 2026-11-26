// ZoneMap loader (UI core C14): turns (biome, seed, style, res) into a ready map canvas, off the main thread.
//
//   const asset = await loadZoneMap(zone.biome, { style: 'minimap', res: 1024 });   // cached, de-duplicated, never throws twice
//   asset.canvas            // res x res, opaque, the whole play area (+ a 30 m margin)
//   asset.pick(devicePx)    // the smallest mip canvas that still has >= devicePx texels (no shimmer when downscaled)
//   asset.x0 / z0 / span    // world square covered (m); pixel (i, j) centre = (x0 + (i + .5) * span / res, ...)
//
// A job runs in zoneMap.worker.ts (field bake ~0.3 s + paint maps ~0.35 s + a 30-100 ms pixel pass: never on the main
// thread); jobs are serial so a zone-select preload cannot starve the HUD map. Without Workers (tests, locked-down
// browsers) or when the worker fails to start, the same code runs on the main thread (`asset.via === 'main'`).
// The cache keeps the last few maps (byte budget); a memoised key resolves in a microtask.
import type { BiomePreset } from '../../data/schema';
import type { ZoneMapJob, ZoneMapLandmark, ZoneMapReply, ZoneMapRenderOpts, ZoneMapResult, ZoneMapStyle } from './zoneMapRender';

export interface ZoneMapRequest {
  /** scatter seed (run seed); the ground itself only depends on `biome.seed`. Default biome.seed */
  seed?: number;
  style: ZoneMapStyle;
  /** raster side in px (square), 64..2048 */
  res: number;
  /** half side (m) of the mapped square; default arenaRadius + 30 */
  extent?: number;
  /** draw trees / rocks / props / walls / bridges (default true) */
  objects?: boolean;
}

export interface ZoneMapAsset {
  key: string;
  zone: string;
  seed: number;
  style: ZoneMapStyle;
  res: number;
  /** world square covered by the raster (m) */
  x0: number;
  z0: number;
  span: number;
  arenaRadius: number;
  landmarks: ZoneMapLandmark[];
  /** FNV-1a 32 of the pixels: equal hashes = byte-identical renders */
  hash: string;
  /** where it was painted */
  via: 'worker' | 'main';
  /** ms: field bake, paint maps, map precompute, pixel pass (bake/paint/pre are 0 when memoised in that realm) + total wall time */
  timing: { bake: number; paint: number; pre: number; px: number; wall: number };
  /** the full-res canvas */
  canvas: HTMLCanvasElement;
  /** the smallest mip (res, res/2, res/4 ... down to 128 px) with at least `px` texels; level 0 for NaN / huge values */
  pick(px: number): HTMLCanvasElement;
}

const HAS_DOM = typeof document !== 'undefined';

/** FNV-1a of the whole preset (the field memoises on the same thing: any preset edit, e.g. a zones rebuild, misses this cache too) */
function biomeSig(b: BiomePreset): string {
  const j = JSON.stringify(b);
  let h = 0x811c9dc5;
  for (let i = 0; i < j.length; i++) {
    h ^= j.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${b.id}:${(h >>> 0).toString(16)}`;
}

export function zoneMapKey(biome: BiomePreset, req: ZoneMapRequest): string {
  return `${biomeSig(biome)}|${req.seed ?? biome.seed}|${req.style}|${Math.round(req.res)}|${req.extent ?? 'auto'}|${req.objects === false ? 'bare' : 'full'}`;
}

// ------------------------------------------------------------------------------------------------------------- worker

interface Pending {
  resolve: (r: ZoneMapResult) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let workerDead = false;
let nextId = 1;
const pending = new Map<number, Pending>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;
/** serial queue: one bake at a time */
let chain: Promise<unknown> = Promise.resolve();

function failAll(err: Error): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function ensureWorker(): Worker | null {
  if (workerDead || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL('./zoneMap.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<ZoneMapReply>) => {
      const reply = e.data;
      const p = pending.get(reply.id);
      if (!p) return;
      pending.delete(reply.id);
      if (reply.ok) p.resolve(reply.result);
      else p.reject(new Error(reply.error));
    };
    w.onerror = (ev) => {
      // a worker that cannot start (blocked, import error) is not retried: every later map runs on the main thread
      workerDead = true;
      const msg = (ev as ErrorEvent).message || 'worker error';
      try {
        w.terminate();
      } catch {
        /* ignore */
      }
      worker = null;
      failAll(new Error(`zone map worker: ${msg}`));
    };
    worker = w;
    return w;
  } catch {
    workerDead = true;
    return null;
  }
}

function scheduleIdle(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size === 0 && worker) {
      worker.terminate();
      worker = null;
    }
  }, 30000);
}

async function bakeOnMainThread(job: ZoneMapJob): Promise<ZoneMapResult> {
  // yield once so the caller's frame is not the one that pays for the module evaluation
  await new Promise<void>((r) => setTimeout(r, 0));
  const m = await import('./zoneMapRender');
  return m.bakeZoneMap(job.biome, job.seed, job.opts);
}

function runJob(biome: BiomePreset, seed: number, opts: ZoneMapRenderOpts): Promise<{ result: ZoneMapResult; via: 'worker' | 'main' }> {
  const id = nextId++;
  const job: ZoneMapJob = { id, biome, seed, opts };
  const w = ensureWorker();
  if (!w) return bakeOnMainThread(job).then((result) => ({ result, via: 'main' as const }));
  return new Promise<ZoneMapResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      w.postMessage(job);
    } catch (e) {
      pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  }).then(
    (result) => {
      scheduleIdle();
      return { result, via: 'worker' as const };
    },
    (err) => {
      // the worker died on this job: retry once on the main thread (a real bake error throws again and surfaces)
      if (workerDead) return bakeOnMainThread(job).then((result) => ({ result, via: 'main' as const }));
      throw err;
    },
  );
}

// -------------------------------------------------------------------------------------------------------------- cache

const BYTE_BUDGET = 40 * 1024 * 1024;
const cache = new Map<string, { promise: Promise<ZoneMapAsset>; asset: ZoneMapAsset | null; bytes: number }>();
let hits = 0;
let misses = 0;

function trim(): void {
  let total = 0;
  for (const e of cache.values()) total += e.bytes;
  if (total <= BYTE_BUDGET) return;
  // Map iteration order = insertion order = least recently used first (entries are re-inserted on every hit)
  for (const [k, e] of cache) {
    if (total <= BYTE_BUDGET || cache.size <= 2) break;
    if (!e.asset) continue; // still loading
    cache.delete(k);
    total -= e.bytes;
  }
}

function toCanvas(rgba: Uint8ClampedArray, res: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = res;
  c.height = res;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), res, res), 0, 0);
  return c;
}

function makeAsset(key: string, r: ZoneMapResult, via: 'worker' | 'main', wall: number): ZoneMapAsset {
  const canvas = toCanvas(r.rgba, r.res);
  const mips: HTMLCanvasElement[] = [canvas];
  const asset: ZoneMapAsset = {
    key,
    zone: r.zone,
    seed: r.seed,
    style: r.style,
    res: r.res,
    x0: r.x0,
    z0: r.z0,
    span: r.span,
    arenaRadius: r.arenaRadius,
    landmarks: r.landmarks,
    hash: r.hash,
    via,
    timing: { ...r.timing, wall },
    canvas,
    pick(px: number): HTMLCanvasElement {
      if (!Number.isFinite(px) || px >= r.res * 0.75) return canvas;
      let level = 0;
      while (r.res / 2 ** (level + 1) >= Math.max(128, px)) level++;
      for (let l = mips.length; l <= level; l++) {
        const prev = mips[l - 1] as HTMLCanvasElement;
        const size = Math.max(1, prev.width >> 1);
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(prev, 0, 0, size, size);
        }
        mips.push(c);
      }
      return mips[level] as HTMLCanvasElement;
    },
  };
  return asset;
}

/** The finished map for a request when it is already cached (sync, no flicker on remount), else null. */
export function peekZoneMap(biome: BiomePreset, req: ZoneMapRequest): ZoneMapAsset | null {
  return cache.get(zoneMapKey(biome, req))?.asset ?? null;
}

/**
 * Bakes (or reuses) the map of a zone. Rejects when the bake itself fails; the cache keeps no failed entries, so the
 * next call retries. Needs a DOM (it produces canvases); in a DOM-less realm it rejects.
 */
export function loadZoneMap(biome: BiomePreset, req: ZoneMapRequest): Promise<ZoneMapAsset> {
  if (!HAS_DOM) return Promise.reject(new Error('zone map needs a DOM'));
  const key = zoneMapKey(biome, req);
  const hit = cache.get(key);
  if (hit) {
    hits++;
    cache.delete(key);
    cache.set(key, hit); // most recently used
    return hit.promise;
  }
  misses++;
  const seed = req.seed ?? biome.seed;
  const opts: ZoneMapRenderOpts = { res: req.res, style: req.style, ...(req.extent !== undefined ? { extent: req.extent } : {}), ...(biome.water ? { water: biome.water.color } : {}), ...(req.objects === false ? { objects: false } : {}) };
  const entry: { promise: Promise<ZoneMapAsset>; asset: ZoneMapAsset | null; bytes: number } = { promise: undefined as unknown as Promise<ZoneMapAsset>, asset: null, bytes: Math.round(req.res) ** 2 * 5 };
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  // serial: wait for the previous bake (its failure must not block this one)
  const run = chain.then(
    () => runJob(biome, seed, opts),
    () => runJob(biome, seed, opts),
  );
  chain = run.catch(() => undefined);
  entry.promise = run.then(({ result, via }) => {
    const wall = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    const asset = makeAsset(key, result, via, wall);
    entry.asset = asset;
    trim();
    return asset;
  });
  entry.promise.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  cache.set(key, entry);
  return entry.promise;
}

/** Warms the cache (zone-select hover, loading screen); errors are swallowed. */
export function preloadZoneMap(biome: BiomePreset, req: ZoneMapRequest): void {
  loadZoneMap(biome, req).catch(() => undefined);
}

export function clearZoneMapCache(): void {
  cache.clear();
}

/** Debug / QA: cache occupancy and the last timings (window.__ui may print this). */
export function zoneMapStats(): { entries: number; hits: number; misses: number; worker: 'idle' | 'running' | 'none' | 'dead'; assets: { key: string; via: string; hash: string; timing: ZoneMapAsset['timing'] }[] } {
  const assets = [...cache.values()].filter((e) => e.asset).map((e) => ({ key: (e.asset as ZoneMapAsset).key, via: (e.asset as ZoneMapAsset).via, hash: (e.asset as ZoneMapAsset).hash, timing: (e.asset as ZoneMapAsset).timing }));
  return { entries: cache.size, hits, misses, worker: workerDead ? 'dead' : worker ? (pending.size ? 'running' : 'idle') : 'none', assets };
}

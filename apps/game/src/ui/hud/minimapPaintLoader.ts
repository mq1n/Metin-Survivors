// Painted minimap layer: turns the shared ZoneMap raster of a zone into the painterly picture (minimapPaint.ts) and hands it
// out as an object URL the HUD paints behind the map's pips (CSS var --mm-paint, see Minimap.tsx / hud.css). The map itself
// stays the core ZoneMap component; this only replaces its picture, so zoom, pips, heading and the ring keep working.
//
//   const url = await paintedMapUrl(asset);       // cached per asset; null when painting is impossible (the plain map shows)
import type { BiomePreset } from '../../data/schema';
import { defaultMapRequest } from '../components/ZoneMap';
import { loadZoneMap, type ZoneMapAsset } from '../components/zoneMapLoader';
import type { PaintJob, PaintReply } from './minimapPaint.worker';
import { paintMinimap } from './minimapPaint';

/** side of the painted raster in px: the ZoneMap raster is resampled to it (the brush works at ~2.3 px per metre) */
const SIDE = 1024;

const cache = new Map<string, Promise<string | null>>();
let worker: Worker | null = null;
let workerDead = false;
let nextId = 1;
const pending = new Map<number, (r: PaintReply) => void>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function ensureWorker(): Worker | null {
  if (workerDead || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL('./minimapPaint.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<PaintReply>) => {
      const fn = pending.get(e.data.id);
      if (!fn) return;
      pending.delete(e.data.id);
      fn(e.data);
    };
    w.onerror = () => {
      workerDead = true;
      try {
        w.terminate();
      } catch {
        /* ignore */
      }
      worker = null;
      for (const fn of pending.values()) fn({ id: -1, ok: false, error: 'worker error' });
      pending.clear();
    };
    worker = w;
    return w;
  } catch {
    workerDead = true;
    return null;
  }
}

function runPaint(rgba: Uint8ClampedArray, w: number, h: number): Promise<Uint8ClampedArray> {
  const wk = ensureWorker();
  if (!wk) {
    // no worker (tests, locked-down browsers): same code on the main thread, after the current frame
    return new Promise((res) => setTimeout(() => res(paintMinimap(rgba, w, h)), 0));
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (r) => {
      if (r.ok) resolve(new Uint8ClampedArray(r.buf));
      else reject(new Error(r.error));
    });
    const job: PaintJob = { id, w, h, buf: rgba.buffer as ArrayBuffer };
    wk.postMessage(job, [job.buf]);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (pending.size === 0 && worker) {
        worker.terminate();
        worker = null;
      }
    }, 20000);
  });
}

const done = new Map<string, string>();

async function build(asset: ZoneMapAsset): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  const side = Math.min(SIDE, asset.res);
  cv.width = side;
  cv.height = side;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(asset.canvas, 0, 0, side, side);
  let painted: Uint8ClampedArray;
  try {
    // the worker takes the pixel buffer (transferred): a failed job re-reads the canvas for the main-thread pass
    painted = await runPaint(ctx.getImageData(0, 0, side, side).data, side, side);
  } catch {
    painted = paintMinimap(ctx.getImageData(0, 0, side, side).data, side, side);
  }
  ctx.putImageData(new ImageData(painted as Uint8ClampedArray<ArrayBuffer>, side, side), 0, 0);
  const url = await new Promise<string | null>((resolve) => {
    cv.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), 'image/webp', 0.92);
  });
  if (url) done.set(asset.key, url);
  return url;
}

/** Painted picture of a ZoneMap asset as an object URL (cached; the same asset gives the same URL). */
export function paintedMapUrl(asset: ZoneMapAsset): Promise<string | null> {
  let p = cache.get(asset.key);
  if (!p) {
    p = build(asset).catch(() => null);
    cache.set(asset.key, p);
  }
  return p;
}

/** The painted URL when it is already built (sync), else null. */
export function peekPaintedMap(asset: ZoneMapAsset): string | null {
  return done.get(asset.key) ?? null;
}

/** Warm the painted minimap of a zone from the loading screen: bakes the ZoneMap raster (same cache entry the HUD asks for) and
 *  paints it, so the first HUD frame already shows the painted map. Never throws. */
export function preloadPaintedMinimap(biome: BiomePreset): void {
  loadZoneMap(biome, defaultMapRequest('minimap'))
    .then((a) => paintedMapUrl(a))
    .catch(() => undefined);
}

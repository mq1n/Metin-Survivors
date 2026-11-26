// Minimap paint worker: runs the painterly pass (minimapPaint.ts) off the main thread. One job in, one reply out; the pixels
// are transferred, not copied. Spawned by minimapPaintLoader.ts.
import { paintMinimap, type PaintOptions } from './minimapPaint';

export interface PaintJob {
  id: number;
  w: number;
  h: number;
  /** RGBA pixels of the ZoneMap raster, transferred */
  buf: ArrayBuffer;
  opts?: PaintOptions;
}
export type PaintReply = { id: number; ok: true; buf: ArrayBuffer } | { id: number; ok: false; error: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<PaintJob>) => void) | null;
  postMessage(msg: PaintReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e: MessageEvent<PaintJob>): void => {
  const job = e.data;
  try {
    const out = paintMinimap(new Uint8ClampedArray(job.buf), job.w, job.h, job.opts);
    scope.postMessage({ id: job.id, ok: true, buf: out.buffer as ArrayBuffer }, [out.buffer as ArrayBuffer]);
  } catch (err) {
    scope.postMessage({ id: job.id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};

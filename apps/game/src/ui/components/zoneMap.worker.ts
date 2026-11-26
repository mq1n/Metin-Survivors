// ZoneMap worker (UI core C14): bakes a zone's TerrainField (+ paint maps) and paints its map off the main thread, so a
// HUD minimap or a zone-select atlas never blocks a frame (a field bake is ~0.3-0.7 s). One job in, one reply out; the
// pixels are transferred, not copied. Spawned and fed by ZoneMap.tsx (`new Worker(new URL(...), { type: 'module' })`).
import { bakeZoneMap, type ZoneMapJob, type ZoneMapReply } from './zoneMapRender';

interface WorkerScope {
  onmessage: ((e: MessageEvent<ZoneMapJob>) => void) | null;
  postMessage(msg: ZoneMapReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e: MessageEvent<ZoneMapJob>): void => {
  const job = e.data;
  try {
    const result = bakeZoneMap(job.biome, job.seed, job.opts);
    scope.postMessage({ id: job.id, ok: true, result }, [result.rgba.buffer]);
  } catch (err) {
    scope.postMessage({ id: job.id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};

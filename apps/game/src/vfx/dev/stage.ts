// DEV-only VFX stage hooks on the real game (C10): `window.__ms.vfx` spawns presets / feeds synthetic sim events through
// the adapter path at the game camera, and steps VFX time deterministically while the sim is paused. Never shipped
// (installed from render/world.ts behind import.meta.env.DEV). Driver: tools/qa/vfxstage.ts; guide: vfx/common/README.md.
import type { SimEvent } from '../../sim/events';
import type { VfxSystem } from '../system';
import type { SpawnOpts, VfxStats } from '../types';

/** spawn options + placement relative to hero 0 (dx/dz, metres) when x/z are not given */
export interface StageSpawnOpts extends SpawnOpts {
  dx?: number;
  dz?: number;
}

export interface VfxStage {
  /** spawns a preset NOW (not on the next sim tick); x/z default to hero 0 + (dx, dz); returns the loop handle (0 for one-shots) */
  spawnNow(id: string, opts?: StageSpawnOpts): number;
  /** feeds one synthetic sim event through the EventAdapter (the route a real event takes); x/z default to hero 0 + (dx, dz) */
  event(e: Partial<SimEvent> & { t: SimEvent['t']; dx?: number; dz?: number }): void;
  /** advances VFX time only (sim untouched) by `seconds` in fixed `dt` steps, then renders one frame */
  step(seconds: number, dt?: number): void;
  /** stops one loop handle */
  stop(handle: number): void;
  /** removes every live effect (ambient zone particles included) */
  clear(): void;
  stats(): VfxStats;
  /** registered preset ids */
  ids(): readonly string[];
  /** hero 0 render position (x, y, z) */
  hero(): { x: number; y: number; z: number };
  readonly system: VfxSystem;
}

interface HostLike {
  vfx: VfxSystem | null;
}
interface MsLike {
  renderWorld?: HostLike;
  loop?: { advance(dt: number): void };
  vfx?: unknown;
}

function makeStage(vfx: VfxSystem): VfxStage {
  const hero = (): { x: number; y: number; z: number } => ({ x: vfx.players[0] as number, y: vfx.players[1] as number, z: vfx.players[2] as number });
  const place = <T extends { x?: number; z?: number; dx?: number; dz?: number }>(o: T): T => {
    const h = hero();
    const out = { ...o };
    if (out.x === undefined) out.x = h.x + (o.dx ?? 0);
    if (out.z === undefined) out.z = h.z + (o.dz ?? 0);
    return out;
  };
  return {
    system: vfx,
    spawnNow(id, opts = {}) {
      const o = place(opts);
      delete o.dx;
      delete o.dz;
      return vfx.spawn(id, o);
    },
    event(e) {
      const ev = place(e as { x?: number; z?: number; dx?: number; dz?: number }) as unknown as Record<string, unknown>;
      delete ev.dx;
      delete ev.dz;
      vfx.handleEvent(ev);
    },
    step(seconds, dt = 1 / 60) {
      let t = 0;
      while (t < seconds - 1e-9) {
        const d = Math.min(dt, seconds - t);
        vfx.update(d);
        t += d;
      }
      // one render through the app loop (dt 0: no sim tick, no extra VFX time)
      (window.__ms as unknown as MsLike | undefined)?.loop?.advance(0);
    },
    stop: (h) => vfx.stop(h),
    clear: () => vfx.clear(),
    stats: () => vfx.stats(),
    ids: () => vfx.presetIds(),
    hero,
  };
}

/** attaches `window.__ms.vfx` once the app has published `window.__ms` (polls; no-op outside a browser) */
export function installVfxDevHooks(host: HostLike): void {
  if (typeof window === 'undefined') return;
  let tries = 0;
  const attach = (): void => {
    const ms = window.__ms as unknown as MsLike | undefined;
    if (ms === undefined) {
      if (tries++ < 600) setTimeout(attach, 100);
      return;
    }
    const vfx = host.vfx;
    if (vfx === null || 'vfx' in ms) return;
    Object.defineProperty(ms, 'vfx', { value: makeStage(vfx), configurable: true, enumerable: false });
  };
  attach();
}

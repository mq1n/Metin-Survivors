// Event routes (C0/C1): the EventAdapter (vfx/adapter.ts) hands every sim event to the routes registered for its type.
// Each vfx/common/<target>/route.ts owns the events of its target (moved verbatim from the old adapter handlers, plus
// the C1 wiring fixes). Routes are created per adapter (factories), so their state (budgets, slots) never leaks between
// systems. Sim event objects are pooled: read them synchronously, never keep them.
import type { SimEvent } from '../../sim/events';
import type { Resolved } from '../presets';
import type { SpawnOpts } from '../types';

export type SimEventType = SimEvent['t'];
export type SimEventOf<T extends SimEventType> = Extract<SimEvent, { t: T }>;

/** what a route sees: the VFX system surface + the adapter's content tables and helpers */
export interface RouteCtx {
  /** adapter clock: seconds of VFX time */
  readonly time: number;
  /** VFX quality density (0.5 low … 1.3 ultra): scale per-frame budgets with it */
  readonly density: number;
  /** render positions of players 0..3 as [x, y, z] × 4 (VfxSystem.setPlayer) */
  readonly players: Float32Array;
  heightAt(x: number, z: number): number;
  /** id (+ palette/element suffix) → recipe; null when unknown */
  resolve(id: string): Resolved | null;
  /** the adapter's reusable SpawnOpts reset to (x, z, scale, dir) — valid until the next o() call */
  o(x: number, z: number, scale: number, dirX?: number, dirZ?: number): SpawnOpts;
  /** spawns a preset by id (unknown ids are a cheap no-op: a route may fire an id its builder has not added yet) */
  fire(id: string, o: SpawnOpts): number;
  spawnResolved(r: Resolved, o: SpawnOpts): number;
  stop(handle: number): void;
  /** false once a loop handle has ended (stopped, expired or evicted); used to respawn persistent loops */
  alive(handle: number): boolean;
  /** true when `key` was not marked within the last `window` seconds — and marks it now (alias vs event de-dupe) */
  once(key: string, window: number): boolean;
  /** seconds since `key` was last marked by once() or mark() (Infinity = never) */
  since(key: string): number;
  /** marks `key` now without asking */
  mark(key: string): void;
  /** death preset id for an enemy type (EventAdapter.setDeathPresets), undefined = none configured */
  deathPreset(type: number): string | undefined;
  /** rune colour (0xRRGGBB) of a metin def (EventAdapter.setMetinRunes, id-fragment hints as fallback) */
  metinRune(def: string, great: boolean): number;
  /** live position of the boss nearest to (x, z) from the render world; false = unknown (use the cached point) */
  bossPos(x: number, z: number, out: { x: number; y: number; z: number }): boolean;
  /** EventAdapter.telegraphEvents: the dormant `telegraph.*` presets only play when true */
  readonly telegraphEvents: boolean;
}

export interface EventRoute {
  readonly events: readonly SimEventType[];
  handle(e: SimEvent, ctx: RouteCtx): void;
  /** once per VFX frame, before the frame's events are handled (budgets, delayed spawns) */
  update?(dt: number, ctx: RouteCtx): void;
  /** run end / VfxSystem.clear(): drop handles and slots */
  reset?(): void;
}

/** typed route: `handle` receives the narrowed event type */
export function route<T extends SimEventType>(
  events: readonly T[],
  handle: (e: SimEventOf<T>, ctx: RouteCtx) => void,
  hooks: { update?: (dt: number, ctx: RouteCtx) => void; reset?: () => void } = {},
): EventRoute {
  return { events, handle: handle as (e: SimEvent, ctx: RouteCtx) => void, ...hooks };
}

/** a target's route factory (called once per EventAdapter) */
export type RouteFactory = () => readonly EventRoute[];

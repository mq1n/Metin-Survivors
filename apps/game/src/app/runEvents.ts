// Fan-out of sim events and run lifecycle to render fx, VFX, audio and UI feedback.
//
// Subscribe once at startup (e.g. the audio engine, the VFX system). Listeners run synchronously right after each
// `world.step()`; sim event objects are POOLED — copy what you need, never retain `e`.
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';

export type RunEventListener = (e: SimEvent, world: World) => void;

export interface RunLifecycleListener {
  /** a new world is ready and about to be simulated (zone loaded, assets baked) */
  runStart?(world: World): void;
  /** the world is being torn down (quit, results or restart) */
  runEnd?(world: World): void;
  /** run paused/resumed by the player (menus, modals do NOT call this) */
  pauseChanged?(paused: boolean): void;
}

class RunEventHub {
  private readonly listeners = new Set<RunEventListener>();
  private readonly lifecycle = new Set<RunLifecycleListener>();

  subscribe(fn: RunEventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  subscribeLifecycle(l: RunLifecycleListener): () => void {
    this.lifecycle.add(l);
    return () => this.lifecycle.delete(l);
  }

  /** Dispatches every event of the last step. */
  dispatch(events: readonly SimEvent[], world: World): void {
    if (this.listeners.size === 0) return;
    for (const e of events) for (const fn of this.listeners) fn(e, world);
  }

  runStart(world: World): void {
    for (const l of this.lifecycle) l.runStart?.(world);
  }

  runEnd(world: World): void {
    for (const l of this.lifecycle) l.runEnd?.(world);
  }

  pauseChanged(paused: boolean): void {
    for (const l of this.lifecycle) l.pauseChanged?.(paused);
  }
}

/** Singleton hub; one run is active at a time. */
export const runEvents = new RunEventHub();

// Awakening-explosion guard (FxSpec.explode = 'none'). At rank 7 the sim fires `vfx_explode` (sim/skills/common.ts explodeAt:

// so the VFX layer answers it with the shared `enemy.explode` (red hellfire ball, shock rings, dark scorch decal with ember
// cracks) unless the skill owns an `sk.<id>.explode` companion (EventAdapter.setExplodePresets). A spec that declares
// `explode: 'none'` carries its blast look itself: its explosion is dropped here, BEFORE the adapter sees it.
//
// Matching needs no skill id in the event (the sim has none), only what the VFX layer already knows about the skill's own
// effect, in either order and for every behaviour:
//  - same tick: a `sk.<id>` vfx event (any `vfx` event of an own spec) at the explosion's point, or, for lines (chain: the
//    explosion sits on the last hop's END point), at the line's far end. The sim emits both in one step and a skill's own event
//    may come after its explosion (leap), so a batch is scanned first and matched second;
//  - a body that stopped there: tracked projectile bodies (VfxSystem.track) and zone rows (VfxSystem.move) report their
//    position every frame; the explosion belongs to the one that reported within BODY_AGE s and BODY_R m of it.
// Pure data (no GPU): unit-tested in __tests__/specBoom.test.ts.
import type { FxSpec } from './types';

/** the explosion belongs to a body whose last report was at most this old (s) / this close (m); same tolerance as
 *  EventAdapter.explodeOfTrack (a projectile moves ~0.33 m per frame at 20 m/s) */
const BODY_AGE = 0.25;
const BODY_R2 = 1.5 * 1.5;
/** body notes older than this are dropped (s) */
const BODY_KEEP = 1;
/** the sim passes the very same floats to the skill's event and to its explosion */
const SAME_R2 = 1e-3 * 1e-3;
/** own-spec events remembered for the current tick (ring) */
const RECENT = 16;
/** pruning threshold of the body table (an opt-in spec's casts never pile up) */
const BODY_MAX = 48;

/** the fields of a sim `vfx` event the guard reads (sim/events.ts VfxEvent) */
interface BoomEvent {
  t?: string;
  preset?: string;
  x?: number;
  z?: number;
  tx?: number;
  tz?: number;
  hasTarget?: boolean;
}

interface Body {
  x: number;
  z: number;
  at: number;
}

export class BoomGuard {
  /** preset ids of the specs that own the blast (`explode: 'none'`, no `.explode` companion) */
  private readonly own = new Set<string>();
  private readonly bodies = new Map<number, Body>();
  /** own-spec events of the current tick: point, far end of a line, tick time */
  private readonly rx = new Float64Array(RECENT);
  private readonly rz = new Float64Array(RECENT);
  private readonly rtx = new Float64Array(RECENT);
  private readonly rtz = new Float64Array(RECENT);
  private readonly rhas = new Uint8Array(RECENT);
  private readonly rat = new Float64Array(RECENT).fill(-1);
  private rhead = 0;

  /** `companions`: preset ids that own an `sk.<id>.explode` (their companion plays instead, see EventAdapter) */
  constructor(specs: Iterable<FxSpec>, companions: ReadonlySet<string> = new Set()) {
    for (const s of specs) if (s.explode === 'none' && !companions.has(s.id)) this.own.add(s.id);
  }

  /** false = no spec opts in: callers skip every call below */
  get active(): boolean {
    return this.own.size > 0;
  }

  owns(preset: string): boolean {
    return this.own.has(preset);
  }

  /** a tracked projectile body (`key` = projectile id) or zone row (`key` = −handle) of `preset` is at (x, z) at time `now` */
  note(preset: string, key: number, x: number, z: number, now: number): void {
    if (!this.own.has(preset)) return;
    const b = this.bodies.get(key);
    if (b === undefined) {
      if (this.bodies.size >= BODY_MAX) this.prune(now);
      this.bodies.set(key, { x, z, at: now });
    } else {
      b.x = x;
      b.z = z;
      b.at = now;
    }
  }

  /** feeds `batch[0..count)` to `handle` (EventAdapter.handle1), dropping the swallowed explosions */
  dispatch(batch: ArrayLike<unknown>, count: number, now: number, handle: (e: unknown) => void): void {
    for (let i = 0; i < count; i++) this.remember(batch[i], now);
    for (let i = 0; i < count; i++) if (!this.swallows(batch[i], now)) handle(batch[i]);
  }

  /** one event on its own (VfxSystem.handleEvent): a skill's event is matched with the explosions that FOLLOW it */
  dispatchOne(e: unknown, now: number, handle: (e: unknown) => void): void {
    this.remember(e, now);
    if (!this.swallows(e, now)) handle(e);
  }

  clear(): void {
    this.bodies.clear();
    this.rat.fill(-1);
  }

  /** records the event when it is a `vfx` event of an own spec */
  private remember(ev: unknown, now: number): void {
    const e = ev as BoomEvent | null | undefined;
    if (e === undefined || e === null || e.t !== 'vfx' || e.preset === undefined || !this.own.has(e.preset)) return;
    const i = this.rhead;
    this.rhead = (i + 1) % RECENT;
    this.rx[i] = e.x as number;
    this.rz[i] = e.z as number;
    this.rtx[i] = e.tx as number;
    this.rtz[i] = e.tz as number;
    this.rhas[i] = e.hasTarget === true ? 1 : 0;
    this.rat[i] = now;
  }

  /** true when `ev` is the sim's generic awakening explosion of a spec that owns its blast */
  private swallows(ev: unknown, now: number): boolean {
    const b = ev as BoomEvent | null | undefined;
    if (b === undefined || b === null || b.t !== 'vfx' || b.preset !== 'vfx_explode') return false;
    const bx = b.x as number;
    const bz = b.z as number;
    for (let i = 0; i < RECENT; i++) {
      if (this.rat[i] !== now) continue;
      if (near(this.rx[i] as number, this.rz[i] as number, bx, bz)) return true;
      if (this.rhas[i] === 1 && near(this.rtx[i] as number, this.rtz[i] as number, bx, bz)) return true;
    }
    for (const n of this.bodies.values()) {
      const age = now - n.at;
      if (age > BODY_AGE) continue;
      if ((n.x - bx) ** 2 + (n.z - bz) ** 2 < BODY_R2) return true;
    }
    return false;
  }

  private prune(now: number): void {
    for (const [k, n] of this.bodies) if (now - n.at > BODY_KEEP) this.bodies.delete(k);
  }
}

function near(ax: number, az: number, bx: number, bz: number): boolean {
  return (ax - bx) ** 2 + (az - bz) ** 2 < SAME_R2;
}

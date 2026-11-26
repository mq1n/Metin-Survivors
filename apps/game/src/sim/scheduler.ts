// Tiny allocation-free scheduler for delayed skill actions (combo swings, awakened echoes, leap landings).

import { dispatchScheduled } from './skills';
import type { World } from './world';

export const enum SchedKind {
  /** repeat a skill cast once (awakening echo) */
  Echo = 0,
  /** follow-up swing of a meleeArc combo; n = swings left, f = angle offset */
  Swing = 1,
  /** leap landing at (x,z) */
  LeapLand = 2,
  /**
   * shadow_clone copy of a hero cast (skills/companions.ts dispatchMimic). Packing: owner = hero index, slot = the CAST skill's
   * slot, n = copy ordinal, dx / dz = cast direction, f = cast rot; x / z unused (the copy fires from the clone's position).
   */
  Mimic = 3,
}

const CAP = 256;

export class Scheduler {
  count = 0;
  readonly due = new Float64Array(CAP);
  readonly kind = new Uint8Array(CAP);
  readonly owner = new Uint8Array(CAP);
  readonly slot = new Uint8Array(CAP);
  readonly n = new Int16Array(CAP);
  readonly x = new Float32Array(CAP);
  readonly z = new Float32Array(CAP);
  readonly dx = new Float32Array(CAP);
  readonly dz = new Float32Array(CAP);
  readonly f = new Float32Array(CAP);

  add(due: number, kind: SchedKind, owner: number, slot: number, n: number, x: number, z: number, dx: number, dz: number, f: number): boolean {
    if (this.count >= CAP) return false;
    const i = this.count++;
    this.due[i] = due;
    this.kind[i] = kind;
    this.owner[i] = owner;
    this.slot[i] = slot;
    this.n[i] = n;
    this.x[i] = x;
    this.z[i] = z;
    this.dx[i] = dx;
    this.dz[i] = dz;
    this.f[i] = f;
    return true;
  }

  private remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.due[i] = this.due[last] as number;
    this.kind[i] = this.kind[last] as number;
    this.owner[i] = this.owner[last] as number;
    this.slot[i] = this.slot[last] as number;
    this.n[i] = this.n[last] as number;
    this.x[i] = this.x[last] as number;
    this.z[i] = this.z[last] as number;
    this.dx[i] = this.dx[last] as number;
    this.dz[i] = this.dz[last] as number;
    this.f[i] = this.f[last] as number;
  }

  /** pop the next due entry into `out`; returns false when nothing is due */
  popDue(now: number, out: SchedEntry): boolean {
    for (let i = 0; i < this.count; i++) {
      if ((this.due[i] as number) > now) continue;
      out.kind = this.kind[i] as number;
      out.owner = this.owner[i] as number;
      out.slot = this.slot[i] as number;
      out.n = this.n[i] as number;
      out.x = this.x[i] as number;
      out.z = this.z[i] as number;
      out.dx = this.dx[i] as number;
      out.dz = this.dz[i] as number;
      out.f = this.f[i] as number;
      this.remove(i);
      return true;
    }
    return false;
  }
}

export interface SchedEntry {
  kind: number;
  owner: number;
  slot: number;
  n: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
  f: number;
}

const entry: SchedEntry = { kind: 0, owner: 0, slot: 0, n: 0, x: 0, z: 0, dx: 0, dz: 0, f: 0 };

export function runScheduled(w: World): void {
  const s = w.sched;
  if (s.count === 0) return;
  // bounded: handlers may add new entries (never due immediately)
  let guard = 64;
  while (guard-- > 0 && s.popDue(w.time, entry)) dispatchScheduled(w, entry);
}

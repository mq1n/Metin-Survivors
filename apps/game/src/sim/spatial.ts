// Uniform grid over enemies (cell 4 m), rebuilt each tick with a counting sort (allocation-free).
// Queries return store ROWS; rows are only valid within the tick they were queried in.

import { CELL } from './constants';
import { EnemyFlag, EnemyState, type EnemyStore } from './stores';

/** extra slack so enemies that moved after the rebuild (≤ ~0.5 m per tick, charges/knockback) are still found */
const MARGIN = 0.6;

export class SpatialHash {
  private readonly dim: number;
  private readonly origin: number;
  private readonly cellStart: Int32Array;
  private readonly cellFill: Int32Array;
  private items: Int32Array;
  private readonly rowCell: Int32Array;
  /** number of rows indexed by the last rebuild */
  size = 0;
  /** largest body radius among indexed rows (a body is found through its centre cell, so queries widen by this) */
  private maxRadius = 1;

  constructor(arenaRadius: number, capacity: number) {
    const pad = 24;
    this.origin = -(arenaRadius + pad);
    this.dim = Math.ceil((2 * (arenaRadius + pad)) / CELL) + 1;
    this.cellStart = new Int32Array(this.dim * this.dim + 1);
    this.cellFill = new Int32Array(this.dim * this.dim);
    this.items = new Int32Array(capacity);
    this.rowCell = new Int32Array(capacity);
  }

  /** index every non-dying enemy row */
  rebuild(e: EnemyStore): void {
    const dim = this.dim;
    const origin = this.origin;
    const start = this.cellStart;
    const fill = this.cellFill;
    const rowCell = this.rowCell;
    start.fill(0);
    const n = e.count;
    const radius = e.radius;
    let maxRadius = 1;
    const x = e.x;
    const z = e.z;
    const state = e.state;
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (state[i] === EnemyState.Dying) {
        rowCell[i] = -1;
        continue;
      }
      let cx = Math.floor(((x[i] as number) - origin) / CELL);
      let cz = Math.floor(((z[i] as number) - origin) / CELL);
      if (cx < 0) cx = 0;
      else if (cx >= dim) cx = dim - 1;
      if (cz < 0) cz = 0;
      else if (cz >= dim) cz = dim - 1;
      const c = cz * dim + cx;
      rowCell[i] = c;
      start[c + 1] = (start[c + 1] as number) + 1;
      total++;
      if ((radius[i] as number) > maxRadius) maxRadius = radius[i] as number;
    }
    const cells = dim * dim;
    for (let c = 0; c < cells; c++) start[c + 1] = (start[c + 1] as number) + (start[c] as number);
    fill.fill(0);
    if (this.items.length < n) this.items = new Int32Array(n);
    const items = this.items;
    for (let i = 0; i < n; i++) {
      const c = rowCell[i] as number;
      if (c < 0) continue;
      const k = (start[c] as number) + (fill[c] as number);
      fill[c] = (fill[c] as number) + 1;
      items[k] = i;
    }
    this.size = total;
    this.maxRadius = maxRadius;
  }

  /**
   * rows of enemies whose body overlaps the circle (x,z,r); skips Dying and (optionally) Invuln rows.
   * Writes into `out`, returns the count (bounded by out.length).
   */
  queryCircle(e: EnemyStore, x: number, z: number, r: number, out: Int32Array, includeInvuln = false): number {
    const dim = this.dim;
    const origin = this.origin;
    const reach = r + MARGIN + this.maxRadius;
    let cx0 = Math.floor((x - reach - origin) / CELL);
    let cx1 = Math.floor((x + reach - origin) / CELL);
    let cz0 = Math.floor((z - reach - origin) / CELL);
    let cz1 = Math.floor((z + reach - origin) / CELL);
    if (cx0 < 0) cx0 = 0;
    if (cz0 < 0) cz0 = 0;
    if (cx1 >= dim) cx1 = dim - 1;
    if (cz1 >= dim) cz1 = dim - 1;
    const start = this.cellStart;
    const items = this.items;
    const ex = e.x;
    const ez = e.z;
    const er = e.radius;
    const state = e.state;
    const flags = e.flags;
    const cap = out.length;
    let n = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      const rowBase = cz * dim;
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = rowBase + cx;
        const end = start[c + 1] as number;
        for (let k = start[c] as number; k < end; k++) {
          const i = items[k] as number;
          if (state[i] === EnemyState.Dying) continue;
          if (!includeInvuln && (state[i] === EnemyState.Spawn || ((flags[i] as number) & (EnemyFlag.Invuln | EnemyFlag.Phased)) !== 0)) continue;
          const dx = (ex[i] as number) - x;
          const dz = (ez[i] as number) - z;
          const rr = r + (er[i] as number);
          if (dx * dx + dz * dz <= rr * rr) {
            if (n >= cap) return n;
            out[n++] = i;
          }
        }
      }
    }
    return n;
  }

  /** nearest hittable enemy row within `r` of (x,z) (centre distance minus body radius), or -1 */
  nearest(e: EnemyStore, x: number, z: number, r: number, skipHandle = 0): number {
    const dim = this.dim;
    const origin = this.origin;
    const reach = r + MARGIN + this.maxRadius;
    let cx0 = Math.floor((x - reach - origin) / CELL);
    let cx1 = Math.floor((x + reach - origin) / CELL);
    let cz0 = Math.floor((z - reach - origin) / CELL);
    let cz1 = Math.floor((z + reach - origin) / CELL);
    if (cx0 < 0) cx0 = 0;
    if (cz0 < 0) cz0 = 0;
    if (cx1 >= dim) cx1 = dim - 1;
    if (cz1 >= dim) cz1 = dim - 1;
    const start = this.cellStart;
    const items = this.items;
    const ex = e.x;
    const ez = e.z;
    const er = e.radius;
    const state = e.state;
    const flags = e.flags;
    let best = -1;
    let bestGap = r;
    for (let cz = cz0; cz <= cz1; cz++) {
      const rowBase = cz * dim;
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = rowBase + cx;
        const end = start[c + 1] as number;
        for (let k = start[c] as number; k < end; k++) {
          const i = items[k] as number;
          if (state[i] === EnemyState.Dying || state[i] === EnemyState.Spawn) continue;
          if (((flags[i] as number) & (EnemyFlag.Invuln | EnemyFlag.Phased)) !== 0) continue;
          if (skipHandle !== 0 && e.id[i] === skipHandle) continue;
          const dx = (ex[i] as number) - x;
          const dz = (ez[i] as number) - z;
          const rad = er[i] as number;
          const gap = Math.sqrt(dx * dx + dz * dz) - rad;
          if (gap < bestGap) {
            bestGap = gap;
            best = i;
          }
        }
      }
    }
    return best;
  }

  /**
   * cheap neighbour iteration for separation: calls `fn(row)` for rows in the 3×3 cells around (x,z).
   * Returns the number of rows written to `out` (up to out.length).
   */
  neighbours(x: number, z: number, out: Int32Array): number {
    const dim = this.dim;
    const origin = this.origin;
    const cx = Math.floor((x - origin) / CELL);
    const cz = Math.floor((z - origin) / CELL);
    const start = this.cellStart;
    const items = this.items;
    const cap = out.length;
    let n = 0;
    const z0 = cz < 1 ? 0 : cz - 1;
    const z1 = cz + 1 >= dim ? dim - 1 : cz + 1;
    const x0 = cx < 1 ? 0 : cx - 1;
    const x1 = cx + 1 >= dim ? dim - 1 : cx + 1;
    for (let zz = z0; zz <= z1; zz++) {
      const base = zz * dim;
      for (let xx = x0; xx <= x1; xx++) {
        const c = base + xx;
        const end = start[c + 1] as number;
        for (let k = start[c] as number; k < end; k++) {
          if (n >= cap) return n;
          out[n++] = items[k] as number;
        }
      }
    }
    return n;
  }
}

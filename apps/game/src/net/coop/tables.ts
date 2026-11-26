// Slot-indexed entity tables with delta coding — the workhorse of the co-op snapshot (enemies, projectiles, pickups,
// telegraphs share it).
//
// A table has `capacity` slots (= the sim store's slot space). Each live entity occupies the slot of its store handle and
// carries a 16-bit net id (11 bits slot + 5 bits generation) and a fixed list of quantised integer columns. Columns 0 and 1
// are always the x/z position pair (u16, 1/64 m).
//
// The host keeps a `sent` TableState that is by construction EXACTLY what every receiver has after applying the same stream
// of snapshots (the transport is reliable and ordered), so deltas are relative to the previous snapshot and need no
// acknowledgements. Anything the encoder decides not to send (rate limit, byte budget) simply stays different in `sent`
// and is picked up by a later snapshot; positions fall back to absolute u16 when the accumulated move no longer fits an i8.
//
// Wire layout of one table section:
//   varuint nRemoved, nRemoved × varuint slot
//   varuint nAdded,   nAdded   × ( u16 id, every column at its width )
//   varuint nUpdated, nUpdated × ( varuint slotGap, varuint mask, fields )     slots strictly ascending
//     mask bit0: i8 dx, i8 dz position delta     bit1: u16 x, u16 z absolute position     bit (k) for column k ≥ 2: that column
//
// A keyframe clears the receiver's table first and carries every entity as an add.

import { ByteReader, ByteWriter, DecodeError } from './bytes';
import { POS8_LIMIT } from './quant';

export interface TableSpec {
  readonly name: string;
  /** slot space; must be ≤ 2048 (11-bit slot in the net id) */
  readonly capacity: number;
  /** column widths in bytes; columns 0 and 1 are the position pair */
  readonly widths: readonly (1 | 2)[];
}

export class TableState {
  readonly present: Uint8Array;
  readonly id: Uint16Array;
  readonly cols: Uint16Array[];
  count = 0;

  constructor(readonly spec: TableSpec) {
    this.present = new Uint8Array(spec.capacity);
    this.id = new Uint16Array(spec.capacity);
    this.cols = spec.widths.map(() => new Uint16Array(spec.capacity));
  }

  clear(): void {
    this.present.fill(0);
    this.count = 0;
  }

  /** marks `slot` live with net id `id` (columns are written by the caller) */
  put(slot: number, id: number): void {
    if (this.present[slot] === 0) this.count++;
    this.present[slot] = 1;
    this.id[slot] = id;
  }

  drop(slot: number): void {
    if (this.present[slot] === 1) this.count--;
    this.present[slot] = 0;
  }

  copyFrom(o: TableState): void {
    this.present.set(o.present);
    this.id.set(o.id);
    for (let c = 0; c < this.cols.length; c++) (this.cols[c] as Uint16Array).set(o.cols[c] as Uint16Array);
    this.count = o.count;
  }

  equals(o: TableState): boolean {
    if (this.count !== o.count) return false;
    for (let s = 0; s < this.present.length; s++) {
      if (this.present[s] !== o.present[s]) return false;
      if (this.present[s] === 0) continue;
      if (this.id[s] !== o.id[s]) return false;
      for (let c = 0; c < this.cols.length; c++) if ((this.cols[c] as Uint16Array)[s] !== (o.cols[c] as Uint16Array)[s]) return false;
    }
    return true;
  }
}

export function varuintLen(v: number): number {
  return v < 0x80 ? 1 : v < 0x4000 ? 2 : v < 0x200000 ? 3 : 4;
}

export interface TableEncodeStats {
  removed: number;
  added: number;
  updated: number;
  /** updates postponed because of the byte budget */
  deferred: number;
  bytes: number;
}

/** update priority classes: 0 = every snapshot, 1 = every 2nd, 2 = every 3rd */
export const PRIO_NEAR = 0;
export const PRIO_MID = 1;
export const PRIO_FAR = 2;

export class TableEncoder {
  /** what the receivers have */
  readonly sent: TableState;
  /** the state to send; the adapter fills it before every `encode` (see `beginFrame`) */
  readonly cur: TableState;
  /** per-slot update priority, written by the adapter together with `cur` */
  readonly prio: Uint8Array;

  private readonly rem: Int32Array;
  private readonly add: Int32Array;
  private readonly updSlot: Int32Array;
  private readonly updMask: Int32Array;
  private readonly updSize: Int32Array;
  private readonly updKeep: Uint8Array;
  private readonly updPos: Uint8Array;

  constructor(readonly spec: TableSpec) {
    this.sent = new TableState(spec);
    this.cur = new TableState(spec);
    this.prio = new Uint8Array(spec.capacity);
    this.rem = new Int32Array(spec.capacity);
    this.add = new Int32Array(spec.capacity);
    this.updSlot = new Int32Array(spec.capacity);
    this.updMask = new Int32Array(spec.capacity);
    this.updSize = new Int32Array(spec.capacity);
    this.updKeep = new Uint8Array(spec.capacity);
    this.updPos = new Uint8Array(spec.capacity);
  }

  beginFrame(): void {
    this.cur.clear();
  }

  /**
   * Writes the delta (or, with `keyframe`, the full state) of `cur` against `sent` and advances `sent` accordingly.
   * `updateBudget` bounds the bytes spent on update records; the lowest priority updates are deferred first.
   */
  encode(w: ByteWriter, keyframe: boolean, snapIndex: number, updateBudget: number): TableEncodeStats {
    const { spec, sent, cur } = this;
    const n = spec.capacity;
    const widths = spec.widths;
    const ncols = widths.length;
    const start = w.pos;
    if (keyframe) sent.clear();

    let nRem = 0;
    let nAdd = 0;
    let nUpd = 0;
    let updBytes = 0;
    for (let s = 0; s < n; s++) {
      const cp = cur.present[s] === 1;
      const sp = sent.present[s] === 1;
      if (!cp && !sp) continue;
      if (sp && (!cp || sent.id[s] !== cur.id[s])) this.rem[nRem++] = s;
      if (cp && (!sp || sent.id[s] !== cur.id[s])) {
        this.add[nAdd++] = s;
        continue;
      }
      if (!cp) continue;
      // both present with the same id: diff the columns
      const pr = this.prio[s] as number;
      if (pr !== PRIO_NEAR && (snapIndex + s) % (pr + 1) !== 0) continue;
      let mask = 0;
      let size = 0;
      let posKind = 0;
      const dx = (cur.cols[0] as Uint16Array)[s]! - (sent.cols[0] as Uint16Array)[s]!;
      const dz = (cur.cols[1] as Uint16Array)[s]! - (sent.cols[1] as Uint16Array)[s]!;
      if (dx !== 0 || dz !== 0) {
        if (dx >= -POS8_LIMIT && dx <= POS8_LIMIT && dz >= -POS8_LIMIT && dz <= POS8_LIMIT) {
          mask |= 1;
          posKind = 1;
          size += 2;
        } else {
          mask |= 2;
          posKind = 2;
          size += 4;
        }
      }
      for (let c = 2; c < ncols; c++) {
        if ((cur.cols[c] as Uint16Array)[s] !== (sent.cols[c] as Uint16Array)[s]) {
          mask |= 1 << c;
          size += widths[c] as number;
        }
      }
      if (mask === 0) continue;
      size += 1 + varuintLen(mask);
      this.updSlot[nUpd] = s;
      this.updMask[nUpd] = mask;
      this.updSize[nUpd] = size;
      this.updKeep[nUpd] = 1;
      this.updPos[nUpd] = posKind;
      updBytes += size;
      nUpd++;
    }

    // byte budget: defer far, then mid, then near updates (highest slot first within a class)
    let deferred = 0;
    if (!keyframe && updBytes > updateBudget) {
      for (let pr = PRIO_FAR; pr >= PRIO_NEAR && updBytes > updateBudget; pr--) {
        for (let i = nUpd - 1; i >= 0 && updBytes > updateBudget; i--) {
          if (this.updKeep[i] === 1 && this.prio[this.updSlot[i] as number] === pr) {
            this.updKeep[i] = 0;
            updBytes -= this.updSize[i] as number;
            deferred++;
          }
        }
      }
    }

    // --- removed
    w.varuint(nRem);
    for (let i = 0; i < nRem; i++) {
      const s = this.rem[i] as number;
      w.varuint(s);
      sent.drop(s);
    }
    // --- added
    w.varuint(nAdd);
    for (let i = 0; i < nAdd; i++) {
      const s = this.add[i] as number;
      w.u16(cur.id[s] as number);
      for (let c = 0; c < ncols; c++) {
        const v = (cur.cols[c] as Uint16Array)[s] as number;
        if (widths[c] === 2) w.u16(v);
        else w.u8(v);
        (sent.cols[c] as Uint16Array)[s] = v;
      }
      sent.put(s, cur.id[s] as number);
    }
    // --- updated
    let kept = 0;
    for (let i = 0; i < nUpd; i++) if (this.updKeep[i] === 1) kept++;
    w.varuint(kept);
    let prev = -1;
    for (let i = 0; i < nUpd; i++) {
      if (this.updKeep[i] !== 1) continue;
      const s = this.updSlot[i] as number;
      const mask = this.updMask[i] as number;
      w.varuint(s - prev);
      prev = s;
      w.varuint(mask);
      const xs = sent.cols[0] as Uint16Array;
      const zs = sent.cols[1] as Uint16Array;
      const cx = (cur.cols[0] as Uint16Array)[s] as number;
      const cz = (cur.cols[1] as Uint16Array)[s] as number;
      if (this.updPos[i] === 1) {
        w.i8(cx - (xs[s] as number));
        w.i8(cz - (zs[s] as number));
      } else if (this.updPos[i] === 2) {
        w.u16(cx);
        w.u16(cz);
      }
      if (this.updPos[i] !== 0) {
        xs[s] = cx;
        zs[s] = cz;
      }
      for (let c = 2; c < ncols; c++) {
        if ((mask & (1 << c)) === 0) continue;
        const v = (cur.cols[c] as Uint16Array)[s] as number;
        if (widths[c] === 2) w.u16(v);
        else w.u8(v);
        (sent.cols[c] as Uint16Array)[s] = v;
      }
    }
    return { removed: nRem, added: nAdd, updated: kept, deferred, bytes: w.pos - start };
  }
}

/** Applies one table section to `state` (in place). Throws `DecodeError` on any inconsistency. */
export function decodeTable(r: ByteReader, state: TableState, keyframe: boolean): void {
  const spec = state.spec;
  const cap = spec.capacity;
  const widths = spec.widths;
  const ncols = widths.length;
  if (keyframe) state.clear();

  const nRem = r.varuint();
  if (nRem > cap) throw new DecodeError(`${spec.name}: ${nRem} removals`);
  for (let i = 0; i < nRem; i++) {
    const s = r.varuint();
    if (s >= cap || state.present[s] === 0) throw new DecodeError(`${spec.name}: bad removal slot ${s}`);
    state.drop(s);
  }
  const nAdd = r.varuint();
  if (nAdd > cap) throw new DecodeError(`${spec.name}: ${nAdd} adds`);
  for (let i = 0; i < nAdd; i++) {
    const id = r.u16();
    const s = id & 0x7ff;
    if (s >= cap) throw new DecodeError(`${spec.name}: bad add slot ${s}`);
    if (state.present[s] === 1) throw new DecodeError(`${spec.name}: add into occupied slot ${s}`);
    for (let c = 0; c < ncols; c++) (state.cols[c] as Uint16Array)[s] = widths[c] === 2 ? r.u16() : r.u8();
    state.put(s, id);
  }
  const nUpd = r.varuint();
  if (nUpd > cap) throw new DecodeError(`${spec.name}: ${nUpd} updates`);
  let s = -1;
  for (let i = 0; i < nUpd; i++) {
    const gap = r.varuint();
    if (gap === 0) throw new DecodeError(`${spec.name}: non-ascending update slot gap`);
    s += gap;
    if (s < 0 || s >= cap || state.present[s] === 0) throw new DecodeError(`${spec.name}: bad update slot ${s}`);
    const mask = r.varuint();
    const xs = state.cols[0] as Uint16Array;
    const zs = state.cols[1] as Uint16Array;
    if ((mask & 1) !== 0) {
      xs[s] = (xs[s] as number) + r.i8();
      zs[s] = (zs[s] as number) + r.i8();
    } else if ((mask & 2) !== 0) {
      xs[s] = r.u16();
      zs[s] = r.u16();
    }
    for (let c = 2; c < ncols; c++) {
      if ((mask & (1 << c)) !== 0) (state.cols[c] as Uint16Array)[s] = widths[c] === 2 ? r.u16() : r.u8();
    }
  }
}

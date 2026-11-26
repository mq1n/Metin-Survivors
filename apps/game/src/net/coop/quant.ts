// Fixed-point conventions of the co-op snapshot format (shared by host encoder and guest decoder).
//
//   position  u16, 1/64 m steps over [-512, 512) m  → 1.56 cm resolution, arena radius is 150 m
//   delta     i8 in the same 1/64 m units (±1.98 m per snapshot; larger moves use an absolute u16 pair)
//   angle     u8, 2π/256 steps (1.4°), always stored in [0, 2π)
//   unit      u8, 0..1 in 1/255 steps
//
// Quantised values are integers on BOTH sides: deltas are taken against the last *sent* quantised value, so host and
// guest never drift apart no matter how many snapshots are culled or reordered by priority.

export const POS_SCALE = 64;
export const POS_OFFSET = 512;
export const POS_MAX = 0xffff;
/** largest |delta| (in quantised units) a POS8 record can carry */
export const POS8_LIMIT = 127;

const TAU = Math.PI * 2;

export function qpos(v: number): number {
  const q = Math.round((v + POS_OFFSET) * POS_SCALE);
  return q < 0 ? 0 : q > POS_MAX ? POS_MAX : q;
}

export function dqpos(q: number): number {
  return q / POS_SCALE - POS_OFFSET;
}

export function qang(rad: number): number {
  let a = rad % TAU;
  if (a < 0) a += TAU;
  return Math.round((a / TAU) * 256) & 255;
}

/** decoded angle in (-π, π] (renderers lerp angles along the shortest arc) */
export function dqang(q: number): number {
  const a = (q / 256) * TAU;
  return a > Math.PI ? a - TAU : a;
}

export function qunit(v: number): number {
  const q = Math.round(v * 255);
  return q < 0 ? 0 : q > 255 ? 255 : q;
}

export function dqunit(q: number): number {
  return q / 255;
}

/** clamp-quantise `v / step` to a u8 */
export function qu8(v: number, step: number): number {
  const q = Math.round(v / step);
  return q < 0 ? 0 : q > 255 ? 255 : q;
}

export function qu16(v: number, step: number): number {
  const q = Math.round(v / step);
  return q < 0 ? 0 : q > 0xffff ? 0xffff : q;
}

export function qi16(v: number, step: number): number {
  const q = Math.round(v / step);
  return q < -32768 ? -32768 : q > 32767 ? 32767 : q;
}

// ---------------------------------------------------------------------------
// Entity ids on the wire

/**
 * 16-bit network id of a store handle: 11 bits of slot + 5 bits of generation. Stores hold < 2048 slots, so the slot
 * always fits, and the generation bits tell a re-used slot apart from the entity that used to live there (a slot is
 * re-used at most once per snapshot interval in practice; 32 re-uses would be needed to collide). 0 is a valid id; the
 * snapshot tables track presence separately.
 */
export function netId(handle: number): number {
  return (handle & 0x7ff) | (((handle >>> 16) & 0x1f) << 11);
}

/** per-store slot of a net id (for the host's "last sent state" arrays) */
export function netSlot(id: number): number {
  return id & 0x7ff;
}

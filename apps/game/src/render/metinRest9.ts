// r9 M9b (r8 judge MF5, r8 M8a critic): the r9 rest of a great metin's break pieces, for a stone whose extras carry `rest9: true` (every other stone keeps
// render/metin.ts applyPieceRest exactly). What changes against r8:
//  - each piece has its OWN radius (metinPieceRadii: the 80th percentile of its vertices' distance from its bone), not 0.3 m for a 0.5-1.4 m chunk;
//  - a prop is a stack of discs (plinth, column, roof: render/metinPropBands.ts) and a piece meets only the disc at its own height (no invisible
//    full-height cylinder round a slender lantern column);
//  - rocks 0.7 m tall or less, crates and other low bodies are ledges: a piece that comes down on one settles ON it instead of landing through it;
//  - the push out of a body is eased (REST9_PUSH_SPEED m per second of shatter time), so a piece slides off a body instead of jumping sideways;
//  - a piece never climbs ground that rises more than REST9_RISE_MAX above the stone's base (a bridge deck, the lava-stair parapet): it stops where the
//    rise begins; a piece whose footprint hangs over lava / deep water (REST9_LIQUID_SHARE of its 5 points) goes in (the bank-edge pieces sink).
import { MathUtils, Matrix4, Vector3, type Bone, type BufferGeometry, type Skeleton } from 'three';
import { REST_SINK_DEPTH, SINK_CUE_AT, type MetinBody, type MetinRestWorld } from './metin';

/** m per second of shatter time a piece's push out of a body may change (a 1.5 m boulder: about a quarter second, never one frame) */
export const REST9_PUSH_SPEED = 6;
/** m above its own ground: a body this low is a ledge a piece may settle on (a low rock, a crate), not a wall it slides round */
export const REST9_LOW_TOP = 1.0;
/** m: a ROCK up to this tall is a ledge too (a 1 m snow boulder under a great metin's heap carries pieces on its crown: no hollow ring round it) */
export const REST9_LEDGE_ROCK = 1.3;
/** m: a piece never rests on ground that much above the stone's base (a bridge deck, a stair parapet): it stays where the rise begins */
export const REST9_RISE_MAX = 0.6;
/** m: the step back toward the stone while the ground under a piece rises too high (at most REST9_RISE_STEPS steps) */
export const REST9_RISE_STEP = 0.25;
export const REST9_RISE_STEPS = 14;
/** of the 5 footprint points (centre + 4 at 0.6 x the radius) this many over lava / deep water and the piece goes in */
export const REST9_LIQUID_SHARE = 2;
/** a piece's footprint for the slope fit / liquid test: this share of its radius, at most REST9_FOOT_MAX m */
export const REST9_FOOT_SHARE = 0.6;
export const REST9_FOOT_MAX = 1.2;

/**
 * r9: the radius (bone-local, model units) of every bone's piece: the 80th percentile of the distance of the vertices skinned mostly to that bone
 * from the bone's bind position (boneInverse x bindMatrix x vertex). A bone with no vertices gets `fallback`.
 */
export function metinPieceRadii(geo: BufferGeometry, skeleton: Skeleton, bindMatrix: Matrix4, fallback = 0.3): Float32Array {
  const pos = geo.getAttribute('position'), si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
  const nb = skeleton.bones.length;
  const out = new Float32Array(nb).fill(fallback);
  if (!pos || !si || !sw) return out;
  const per: number[][] = Array.from({ length: nb }, () => []);
  const v = new Vector3(), m = new Matrix4();
  const mats = skeleton.boneInverses.map((bi) => m.clone().multiplyMatrices(bi, bindMatrix));
  for (let i = 0; i < pos.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    if (best < 0 || best >= nb) continue;
    v.fromBufferAttribute(pos, i).applyMatrix4(mats[best]!);
    per[best]!.push(v.length());
  }
  per.forEach((d, j) => {
    if (d.length < 3) return;
    d.sort((a, b) => a - b);
    out[j] = d[Math.min(d.length - 1, Math.floor(d.length * 0.8))]!;
  });
  return out;
}

/** r9: the piece radii of a model, computed once per geometry (every instance of a model shares its geometry) */
const radiiCache = new WeakMap<BufferGeometry, Float32Array>();
export function metinPieceRadiiCached(geo: BufferGeometry, skeleton: Skeleton, bindMatrix: Matrix4): Float32Array {
  let r = radiiCache.get(geo);
  if (!r) { r = metinPieceRadii(geo, skeleton, bindMatrix); radiiCache.set(geo, r); }
  return r;
}

/** does a body's vertical span [y0, top] meet a piece's [yb, yt] */
const spans = (b: MetinBody, yb: number, yt: number): boolean => yb < b.top && yt > (b.y0 ?? -Infinity);

/**
 * r9: pushes a piece (world centre x, z, bottom yb, top yt, radius r) out of every TALL body whose span meets the piece's (two relaxation passes); low bodies
 * (ledges) are never pushed out of: a piece settles on them (metinLowTop). A piece dead on a body centre leaves away from (ox, oz). Writes `out`; true = moved.
 */
export function metinPushOut9(bodiesNear: MetinRestWorld['bodiesNear'], x: number, z: number, yb: number, yt: number, r: number, ox: number, oz: number, out: { x: number; z: number }): boolean {
  let px = x, pz = z, any = false;
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    bodiesNear(px, pz, r, (b) => {
      if (b.low || !spans(b, yb, yt)) return;
      const dx = px - b.x, dz = pz - b.z, rr = b.r + r, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) return;
      const d = Math.sqrt(d2);
      if (d > 1e-5) { px = b.x + (dx / d) * rr; pz = b.z + (dz / d) * rr; }
      else { const ux = b.x - ox, uz = b.z - oz, ul = Math.hypot(ux, uz) || 1; px = b.x + (ux / ul) * rr; pz = b.z + (uz / ul) * rr; }
      moved = true;
    });
    if (!moved) break;
    any = true;
  }
  out.x = px; out.z = pz;
  return any;
}

/** r9: the highest LOW body top under the point (x, z) (-Infinity when none): a ledge a piece settles on */
export function metinLowTop(bodiesNear: MetinRestWorld['bodiesNear'], x: number, z: number): number {
  let top = -Infinity;
  bodiesNear(x, z, 0, (b) => { if (b.low && Math.hypot(x - b.x, z - b.z) < b.r) top = Math.max(top, b.top); });
  return top;
}

/** r9: the optional state of applyPieceRest9 (one per slot, reset at every new break) */
export interface PieceRest9 {
  /** 2 floats per bone: the xz offset (root space) added this frame; clearPieceRest takes it off with the y offset */
  offXZ: Float32Array;
  /** 2 floats per bone: the eased push (WORLD metres) the piece carries now */
  pushCur: Float32Array;
  /** per bone: the piece radius in root units (metinPieceRadii of the bone) */
  radii: Float32Array;
  bodiesNear: MetinRestWorld['bodiesNear'];
  liquidAt: MetinRestWorld['liquidAt'];
  /** world y of the stone's base */
  rootY: number;
  /** world metres the push may change in this call (REST9_PUSH_SPEED x the shatter time step; Infinity = take the target) */
  pushStep: number;
  onSink?: (i: number, wx: number, wz: number) => void;
  cued?: Uint8Array;
}

const tmp = { x: 0, z: 0 };
/**
 * r9: applyPieceRest for a rest9 stone (same bookkeeping: `off` / `offXZ` come off again in clearPieceRest before the mixer writes the clip pose). Per piece:
 * the target push out of the tall bodies at its height and back off a too-high rise, eased by `pushStep`; the rest height on the terrain or a ledge (5 points
 * of its own footprint, the mean lifted a quarter of the way to the highest); the footprint liquid test; the eased sink and its cue.
 */
export function applyPieceRest9(bones: readonly Bone[], off: Float32Array, rootX: number, rootZ: number, yaw: number, scale: number, groundY: number, w: number, sinkK: number,
  heightAt: (x: number, z: number) => number, sinkW: Float32Array, step: number, ext: PieceRest9): void {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  bones.forEach((b, i) => {
    const lx = b.position.x * scale, lz = b.position.z * scale;
    const wx = rootX + lx * cy + lz * sy, wz = rootZ - lx * sy + lz * cy;
    const r = (ext.radii[i] ?? 0.3) * scale;
    const yc = ext.rootY + b.position.y * scale;
    // the target: out of the tall bodies at the piece's own height, then back off ground that rises too high (only once the rest follows: w > 0)
    let tx = wx, tz = wz;
    if (metinPushOut9(ext.bodiesNear, wx, wz, yc - r, yc + r, r, rootX, rootZ, tmp)) { tx = tmp.x; tz = tmp.z; }
    if (w > 0) {
      // the whole footprint must stay clear of the rise (a piece half on a deck edge would be lifted by the slope fit)
      const ux = rootX - tx, uz = rootZ - tz, ul = Math.hypot(ux, uz), fr0 = Math.min(REST9_FOOT_SHARE * r, REST9_FOOT_MAX);
      for (let k = 0; k < REST9_RISE_STEPS && ul > 1e-3; k++) {
        const h = Math.max(heightAt(tx, tz), heightAt(tx + fr0, tz), heightAt(tx - fr0, tz), heightAt(tx, tz + fr0), heightAt(tx, tz - fr0));
        if (!(h - groundY > REST9_RISE_MAX)) break;
        const s = Math.min(REST9_RISE_STEP, Math.hypot(rootX - tx, rootZ - tz));
        if (s < 1e-3) break;
        tx += (ux / ul) * s; tz += (uz / ul) * s;
      }
    }
    // eased toward the target (world metres, at most pushStep this call)
    let px = ext.pushCur[i * 2]!, pz = ext.pushCur[i * 2 + 1]!;
    const gx = tx - wx - px, gz = tz - wz - pz, gl = Math.hypot(gx, gz);
    if (gl > 0) { const k = Math.min(1, ext.pushStep / gl); px += gx * k; pz += gz * k; }
    ext.pushCur[i * 2] = px; ext.pushCur[i * 2 + 1] = pz;
    // world -> root space (the inverse of the rotation above), / scale
    const dx = (px * cy - pz * sy) / scale, dz = (px * sy + pz * cy) / scale;
    b.position.x += dx; b.position.z += dz;
    ext.offXZ[i * 2] = dx; ext.offXZ[i * 2 + 1] = dz;
    const fx = wx + px, fz = wz + pz;
    // the rest height on its own footprint: terrain or a ledge under each of the 5 points; the liquid share
    const fr = Math.min(REST9_FOOT_SHARE * r, REST9_FOOT_MAX);
    let sum = 0, hi = -Infinity, n = 0, wet = 0;
    for (let k = 0; k < 5; k++) {
      const qx = fx + (k === 1 ? fr : k === 2 ? -fr : 0), qz = fz + (k === 3 ? fr : k === 4 ? -fr : 0);
      let h = heightAt(qx, qz);
      const lt = metinLowTop(ext.bodiesNear, qx, qz);
      if (lt > h) h = lt;
      if (Number.isFinite(h)) { sum += h; hi = Math.max(hi, h); n++; }
      if (ext.liquidAt(qx, qz) !== 0) wet++;
    }
    const mean = n ? sum / n : groundY;
    const dy = n ? MathUtils.clamp(mean + 0.25 * (hi - mean) - groundY, -12, 6) : 0;
    const sinkT = wet >= REST9_LIQUID_SHARE ? 1 : 0;
    const p0 = sinkW[i] ?? 0;
    const s = p0 + MathUtils.clamp(sinkT - p0, -step, step);
    sinkW[i] = s;
    if (ext.onSink && ext.cued && !ext.cued[i] && sinkT && sinkK * s > SINK_CUE_AT) { ext.cued[i] = 1; ext.onSink(i, fx, fz); }
    const o = (dy * w - REST_SINK_DEPTH * scale * sinkK * s) / scale;
    b.position.y += o;
    off[i] = o;
  });
}

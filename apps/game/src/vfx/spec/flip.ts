// Flipbook frame selection (pure: no three.js; the GLSL twin is `flipFrame` in shaders.ts, this is its JS mirror for tests

// renderer draws that one texture, never a blend of two (eterEffectLib/EffectUpdateDecorator.cpp); texanitype random_frame
// draws `random_range(0, count - 1)` at every step (repeats possible), clockwise / counter-clockwise step by one.
import type { FrameMode } from './types';

/** FrameMode as the shaders read it (record flag bits): 0 blend, 1 cut, 2 random */
export type FrameModeBits = 0 | 1 | 2;






export function frameModeBits(mode: FrameMode | undefined, art: boolean): FrameModeBits {
  if (mode === 'random') return 2;
  if (mode === 'cut') return 1;
  if (mode === 'blend') return 0;
  return art ? 1 : 0;
}

/** PCG hash (uint32), the same constants as the shader */
export function pcg32(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/**
 * The frame pair a record of `frames` frames draws at age `t` (life fraction `u`): [frame a, frame b, cross-fade of b over a],
 * mirror of shaders.ts `flipFrame`. `p` = start frame (blend / cut: record `frame0`, from `random: true`) or the hash seed
 * (random mode: record `frame0` / surface seed). fps 0 = once over the life (random mode: one step per frame).
 */
export function flipFrame(frames: number, mode: FrameModeBits, fps: number, t: number, u: number, p: number): [number, number, number] {
  if (mode === 2) {
    const step = fps > 0 ? Math.floor(Math.max(t, 0) * fps) : Math.floor(Math.min(u * frames, frames - 0.001));
    const f = pcg32((Math.imul(step >>> 0, 2654435761) + pcg32(p)) >>> 0) % Math.floor(frames);
    return [f, f, 0];
  }
  const fr = fps > 0 ? (((t * fps + p) % frames) + frames) % frames : Math.min(u * frames, frames - 0.001);
  const fa = Math.floor(fr);
  if (mode === 1) return [fa, fa, 0];
  return [fa, fps > 0 ? (fa + 1) % frames : Math.min(fa + 1, frames - 1), fr - fa];
}

/**
 * Per-record seed of a surface in random frame mode, in [0, 1) with 24 bits (exact in the float32 record slot; the shader
 * reads `floor(seed * 2^24)` as the hash seed of `flipFrame`). The spawn seed alone made every random-mode surface of one
 * spawn (and every loop period of one surface: loop elements are re-emitted each `life`) walk the SAME frame sequence in
 * lock step; mixing in the element index and the period index gives each record its own sequence. Deterministic per
 * (spawn seed, element, period), so a spawn with a fixed `SpawnOpts.seed` still replays identically.
 */
export function recordSeed(spawnSeed: number, element: number, period: number): number {
  const h = pcg32(((Math.floor(spawnSeed * 16777216) >>> 0) + Math.imul(element + 1, 0x9e3779b1) + Math.imul(period + 1, 0x85ebca6b)) >>> 0);
  return (h >>> 8) / 16777216;
}

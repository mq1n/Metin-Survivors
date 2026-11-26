// r7 ship 10-30: a break piece whose rest kind flips while it still flies (across a lava / water edge or a blocker boundary) eases its sink weight at a
// bounded rate (applyPieceRest `sinkW` / `step`, METIN_SINK_EASE) instead of jumping REST_SINK_DEPTH x scale in one frame (r7 M7 critic, code reading)
import { describe, expect, it } from 'vitest';
import { Bone } from 'three';
import { METIN_SINK_EASE, REST_GROUND, REST_SINK, REST_SINK_DEPTH, SINK_CUE_AT, applyPieceRest, clearPieceRest, type PieceRestExt } from './metin';

const flat = (): number => 0;
const lavaEast = (x: number): number => (x > 0 ? REST_SINK : REST_GROUND);

describe('r7 ship: eased sink of a metin break piece', () => {
  it('without sinkW the offset is exactly the old one (full sink at once)', () => {
    const b = new Bone(); b.position.set(1, 0, 0);
    const off = new Float32Array(1);
    applyPieceRest([b], off, 0, 0, 0, 1, 0, 1, 1, flat, lavaEast);
    expect(off[0]).toBeCloseTo(-REST_SINK_DEPTH, 6);
  });
  it('a piece flying from lava back onto ground rises at most `step` of the full sink per call', () => {
    const b = new Bone(); b.position.set(1, 0, 0);
    const off = new Float32Array(1), sinkW = new Float32Array(1);
    applyPieceRest([b], off, 0, 0, 0, 1, 0, 1, 1, flat, lavaEast, sinkW, Infinity); // first call: takes the target as is
    expect(sinkW[0]).toBe(1);
    clearPieceRest([b], off);
    b.position.x = -1; // now over the ground
    const step = (1 / 60) / METIN_SINK_EASE;
    applyPieceRest([b], off, 0, 0, 0, 1, 0, 1, 1, flat, lavaEast, sinkW, step);
    expect(sinkW[0]).toBeCloseTo(1 - step, 6);
    expect(off[0]).toBeCloseTo(-REST_SINK_DEPTH * (1 - step), 6); // no one-frame pop of 2.4 m
    for (let f = 0; f < 60; f++) { clearPieceRest([b], off); applyPieceRest([b], off, 0, 0, 0, 1, 0, 1, 1, flat, lavaEast, sinkW, step); }
    expect(sinkW[0]).toBe(0);
    expect(off[0]).toBeCloseTo(0, 6);
  });
  it('a piece that lands on lava goes under within METIN_SINK_EASE s of shatter time, smoothly', () => {
    const b = new Bone(); b.position.set(-1, 0, 0);
    const off = new Float32Array(1), sinkW = new Float32Array(1);
    applyPieceRest([b], off, 0, 0, 0, 2, 0, 1, 1, flat, lavaEast, sinkW, Infinity);
    expect(sinkW[0]).toBe(0);
    b.position.x = 1;
    const step = (1 / 60) / METIN_SINK_EASE;
    let prev = 0;
    for (let f = 0; f < Math.ceil(METIN_SINK_EASE * 60); f++) {
      clearPieceRest([b], off);
      applyPieceRest([b], off, 0, 0, 0, 2, 0, 1, 1, flat, lavaEast, sinkW, step);
      expect(prev - off[0]!).toBeLessThanOrEqual(REST_SINK_DEPTH * step + 1e-6); // root-space drop per frame stays bounded
      prev = off[0]!;
    }
    expect(sinkW[0]).toBeCloseTo(1, 6);
  });
});

describe('r8 M8a: the eased sink with the push and the sink cue', () => {
  it('a piece that lands on lava eases under, fires its cue once (when the eased weight passes SINK_CUE_AT), and the push offsets clear exactly', () => {
    const b = new Bone(); b.position.set(-1, 0.3, 0);
    const off = new Float32Array(1), offXZ = new Float32Array(2), sinkW = new Float32Array(1), cued = new Uint8Array(1);
    const fired: number[] = [];
    // a post (r 0.2, 3 m tall) at world (1.3, 0): the piece slides round it on its way over the lava
    const ext: PieceRestExt = { offXZ, bodiesNear: (x, z, r, cb) => { if (Math.hypot(x - 1.3, z) < r + 0.2) cb({ x: 1.3, z: 0, r: 0.2, top: 3 }); }, rootY: 0, pieceR: 0.3, cued, onSink: (i) => fired.push(i) };
    applyPieceRest([b], off, 0, 0, 0, 1, 0, 1, 1, flat, lavaEast, sinkW, Infinity, ext);
    expect(fired).toEqual([]);
    const step = (1 / 60) / METIN_SINK_EASE;
    let frames = 0, firedAt = -1;
    for (let f = 0; f < 40; f++) {
      clearPieceRest([b], off, offXZ);
      b.position.x = Math.min(1.3, -1 + f * 0.1); // flies east, onto the lava and into the post
      applyPieceRest([b], off, 0, 0, 0, 1, 0, 1, 1, flat, lavaEast, sinkW, step, ext);
      frames++;
      if (fired.length && firedAt < 0) firedAt = sinkW[0]!;
      expect(Math.hypot(b.position.x - 1.3, b.position.z)).toBeGreaterThanOrEqual(0.5 - 1e-6); // never inside the post
    }
    expect(fired).toEqual([0]);
    expect(firedAt).toBeGreaterThan(SINK_CUE_AT);
    expect(firedAt).toBeLessThanOrEqual(SINK_CUE_AT + step + 1e-6);
    expect(sinkW[0]).toBeCloseTo(1, 6);
    expect(off[0]).toBeCloseTo(-REST_SINK_DEPTH, 6);
    clearPieceRest([b], off, offXZ);
    expect(b.position.x).toBeCloseTo(1.3, 6);
    expect(b.position.z).toBeCloseTo(0, 6);
    expect(frames).toBe(40);
  });
});

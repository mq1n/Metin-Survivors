// r7: break pieces of a metin rest on what is under them (render/metin.ts metinPieceRest / applyPieceRest / clearPieceRest / metinRestKind):
// a slope fit on the terrain, lava and deep water take the piece UNDER the surface (never parked on a liquid as if on a floor), a static's body
// (prop / wall / rock blocker) takes it out of sight instead of letting it rest inside the prop, and the offset bookkeeping against three's mixer
// (which skips a bone whose clip value did not change) never accumulates.
import { describe, expect, it } from 'vitest';
import { AnimationClip, AnimationMixer, Bone, Group, VectorKeyframeTrack, type AnimationAction } from 'three';
import { SURFACE } from '../world/layoutTypes';
import { REST_BLOCKED, REST_GROUND, REST_SINK, REST_SINK_DEPTH, applyPieceRest, clearPieceRest, metinPieceRest, metinRestKind, type MetinRestField } from './metin';

// a little world: ground at 0 for x < 10, a 4 m cliff drop beyond x = 10 (to -4), a 30 deg slope for z > 20, lava for x in [-20, -15], deep water for x < -30,
// one prop blocker (r 2) at (5, 5)
const height = (x: number, z: number): number => (x > 10 ? -4 : 0) + (z > 20 ? (z - 20) * Math.tan(Math.PI / 6) : 0);
const field: MetinRestField = {
  surfaceAt: (x) => (x >= -20 && x <= -15 ? SURFACE.LAVA : x < -30 ? SURFACE.DEEP : x > 40 ? SURFACE.SHALLOW : SURFACE.GROUND),
  blockersNear: (x, z, r, cb) => { if (Math.hypot(x - 5, z - 5) < 2 + r + 1) cb({ x: 5, z: 5, r: 2 }); },
};
const rest = (x: number, z: number): number => metinRestKind(field, x, z);

describe('r7 metin break pieces: what they rest on', () => {
  it('classifies ground, lava, deep water, shallow water and the inside of a prop blocker', () => {
    expect(rest(0, 0)).toBe(REST_GROUND);
    expect(rest(-17, 0)).toBe(REST_SINK);
    expect(rest(-35, 0)).toBe(REST_SINK);
    expect(rest(45, 0)).toBe(REST_GROUND); // a ford: the piece rests on the bed
    expect(rest(5.5, 5.5)).toBe(REST_BLOCKED);
    expect(rest(8, 5)).toBe(REST_GROUND); // beside the prop, outside its body
  });
  it('rests on flat ground with no offset and follows a cliff drop down (no piece hangs in the air past the edge)', () => {
    expect(metinPieceRest(height, rest, 0, 0, 0.3, 0)).toEqual({ dy: 0, sink: false });
    const drop = metinPieceRest(height, rest, 12, 0, 0.3, 0);
    expect(drop.dy).toBeCloseTo(-4, 6);
    expect(drop.sink).toBe(false);
  });
  it('fits a slope: the piece sits at least at the mean ground under it (never half-buried), below the highest point (never floating)', () => {
    const z = 30, r = 0.6, h0 = height(0, z), hi = height(0, z + r);
    const fit = metinPieceRest(height, rest, 0, z, r, 0);
    expect(fit.dy).toBeGreaterThanOrEqual(h0 - 1e-9);
    expect(fit.dy).toBeLessThan(hi);
  });
  it('a piece over lava or deep water, or inside a prop, sinks; one in a ford does not', () => {
    expect(metinPieceRest(height, rest, -17, 0, 0.3, 0).sink).toBe(true);
    expect(metinPieceRest(height, rest, -40, 0, 0.3, 0).sink).toBe(true);
    expect(metinPieceRest(height, rest, 5, 5, 0.3, 0).sink).toBe(true);
    expect(metinPieceRest(height, rest, 45, 0, 0.3, 0).sink).toBe(false);
  });
  it('clamps a huge drop (a piece past a deep chasm is not dragged 100 m down)', () => {
    const deep = (x: number): number => (x > 1 ? -100 : 0);
    expect(metinPieceRest(deep, () => REST_GROUND, 5, 0, 0.3, 0).dy).toBe(-12);
  });
});

describe('r7 rest offsets against the animation mixer (follow / unfollow bookkeeping)', () => {
  // one stone at (x0, z0) with 3 piece bones; the shatter clip holds every bone still (the resting pile): the mixer would skip the unchanged write each frame
  const make = (): { bones: Bone[]; mixer: AnimationMixer; root: Group; action: AnimationAction } => {
    const root = new Group();
    const bones = [0, 1, 2].map((i) => { const b = new Bone(); b.name = `chunk_${i}`; b.position.set(i - 1, 0.5, 0.4 * i); root.add(b); return b; });
    const tracks = bones.map((b) => new VectorKeyframeTrack(`${b.name}.position`, [0, 1, 2.2], [b.position.x, 0.5, b.position.z, b.position.x, 0.4, b.position.z, b.position.x, 0.4, b.position.z]));
    const mixer = new AnimationMixer(root);
    const a = mixer.clipAction(new AnimationClip('shatter', 2.2, tracks));
    a.play(); a.paused = true;
    return { bones, mixer, root, action: a };
  };
  const drive = (k: { bones: Bone[]; mixer: AnimationMixer; action: AnimationAction }, off: Float32Array, t: number, heightAt: (x: number, z: number) => number, restAt: (x: number, z: number) => number, scale = 1): void => {
    clearPieceRest(k.bones, off);
    k.action.time = t; k.mixer.update(0);
    applyPieceRest(k.bones, off, 10.5, 0, 0, scale, 0, 1, 1, heightAt, restAt);
  };
  it('holds a resting pile at the same height frame after frame (no accumulation while the clip value is unchanged)', () => {
    const k = make(), off = new Float32Array(3);
    const h = (x: number): number => (x > 10 ? -4 : 0);
    const ys: number[][] = [];
    for (let f = 0; f < 30; f++) { drive(k, off, 1.2 + f / 60, h, () => REST_GROUND); ys.push(k.bones.map((b) => b.position.y)); }
    for (const y of ys) for (let i = 0; i < 3; i++) expect(y[i]).toBeCloseTo(ys[0]![i]!, 6);
    // the bone over the drop (world x 10.5 + 0 .. 11.5) rests 4 m lower than its clip pose; the one at x 9.5 stays
    expect(ys[0]![0]).toBeCloseTo(0.4, 6);
    expect(ys[0]![2]).toBeCloseTo(0.4 - 4, 6);
  });
  it('takes every offset off again (clear restores the clip pose exactly)', () => {
    const k = make(), off = new Float32Array(3);
    drive(k, off, 1.5, () => -2, () => REST_GROUND);
    clearPieceRest(k.bones, off);
    for (const b of k.bones) expect(b.position.y).toBeCloseTo(0.4, 6);
    expect([...off]).toEqual([0, 0, 0]);
  });
  it('sinks a piece over lava by the sink depth (x scale), in root space', () => {
    const k = make(), off = new Float32Array(3);
    drive(k, off, 1.5, () => 0, (x) => (x > 11 ? REST_SINK : REST_GROUND), 2.4);
    expect(k.bones[2]!.position.y).toBeCloseTo(0.4 - REST_SINK_DEPTH, 6);
    expect(k.bones[0]!.position.y).toBeCloseTo(0.4, 6);
  });
});

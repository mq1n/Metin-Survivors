

// everything else (batches, LUT, anchors) is plain typed arrays.
import { DataTexture, Scene, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Ctx, type Fx } from '../emit';
import { VRng } from '../util';
import { EMIT_STEP, SpecHost, particleFlags, spawnTint } from '../spec/host';
import { specPreset } from '../spec/preset';
import { ROLES } from '../spec/roles';
import { ANCHORS } from '../spec/shaders';
import type { FxSpec, ParticleSpec } from '../spec/types';

vi.mock('../spec/atlas', () => ({ bakeSpecAtlas: () => ({ texture: null, dispose: () => undefined }) }));

const MIRROR = 8;

function spec(tint: boolean | null): FxSpec {
  const base: FxSpec = { id: 'sk.test_tint', desc: 'test', behavior: 'selfBuff', ref: {}, size: 'radius', base: 2, dur: 1, elements: [] };
  return tint === null ? base : { ...base, tint };
}

describe('particle record flags (particle instance handedness)', () => {
  it('mirrors screen and upright sprites (u along −camera right), never lie or stretch quads', () => {
    expect(particleFlags(0, false, 1) & MIRROR).toBe(MIRROR);
    expect(particleFlags(2, false, 1) & MIRROR).toBe(MIRROR);
    expect(particleFlags(1, false, 1) & MIRROR).toBe(0);
    expect(particleFlags(3, false, 1) & MIRROR).toBe(0);
  });

  it('flips every handedness on mirrored swings except stretch quads', () => {
    expect(particleFlags(0, false, -1) & MIRROR).toBe(0);
    expect(particleFlags(2, false, -1) & MIRROR).toBe(0);
    expect(particleFlags(1, false, -1) & MIRROR).toBe(MIRROR);
    expect(particleFlags(3, false, -1) & MIRROR).toBe(0);
  });

  it('keeps the billboard and attach bits', () => {
    expect(particleFlags(1, true, 1)).toBe(1 | 4);
    expect(particleFlags(3, true, -1)).toBe(3 | 4);
    expect(particleFlags(0, true, 1)).toBe(4 | MIRROR);
  });
});

describe('per-spawn tint (FxSpec.tint)', () => {
  it('keeps authored colours unless the spec opts in', () => {
    const c = new Ctx();
    c.tinted = true;
    c.pal.main = 0xff4400;
    expect(spawnTint(spec(null), c)).toBe(0xffffff);
    expect(spawnTint(spec(false), c)).toBe(0xffffff);
    expect(spawnTint(spec(true), null)).toBe(0xffffff);
  });

  it('takes the main colour of the palette the caller resolved (colour, variant or element hint)', () => {
    const s = spec(true);
    const c = new Ctx();
    c.pal.main = 0x33aaff;
    expect(spawnTint(s, c)).toBe(0xffffff);
    c.tinted = true;
    expect(spawnTint(s, c)).toBe(0x33aaff);
    c.tinted = false;
    c.variant = 2;
    expect(spawnTint(s, c)).toBe(0x33aaff);
    c.variant = -1;
    c.element = 3;
    expect(spawnTint(s, c)).toBe(0x33aaff);
  });

  it('opens palette variants only for tint templates', () => {
    expect(specPreset(spec(true)).variants).toBe(true);
    expect(specPreset(spec(null)).variants).toBe(false);
  });
});

describe('spec atlas roles', () => {
  it('declares ringLine as a single 1×1 still', () => {
    expect(ROLES.ringLine).toMatchObject({ w: 1, h: 1, frames: 1 });
  });
});

// ------------------------------------------------------------------------------------------------ SpecHost (no GPU)
function makeHost(): { h: SpecHost; fx: Fx } {
  // SpecHost reads only these Fx fields (clock, rng, density, spawn budget, counters, ground height)
  const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
  const h = new SpecHost(new Scene(), {} as WebGLRenderer, { value: 0 }, fx, 3, 10, []);
  return { h, fx };
}

function emitter(rate: readonly number[], cycle: number, extra: Partial<FxSpec> = {}): FxSpec {
  const el: ParticleSpec = { kind: 'particle', cycle, max: 64, rate, life: [0, 3], half: [0, 0.3], color: [0, 0xffffff, 1], billboard: 'screen', blend: 'add', tex: 'glow' };
  return { ...spec(null), elements: [el], ...extra };
}

/** spawned particles after `seconds` of frames of length 1 / fps */
function spawned(s: FxSpec, fps: number, seconds = 1): number {
  const { h, fx } = makeHost();
  h.play(s, new Ctx(), false);
  const dt = 1 / fps;
  for (let f = 0; f < Math.round(seconds * fps); f++) {
    fx.time += dt;
    h.update(dt);
  }
  return fx.spawned;
}

describe('SpecHost emitter stepping (fixed 60 Hz update)', () => {
  it('emits the same particles at any frame rate', () => {
    const s = emitter([0, 120, 0.25, 60, 0.5, 120], 0.5);
    const at60 = spawned(s, 60);
    expect(at60).toBeGreaterThan(40);
    expect(spawned(s, 144)).toBe(at60);
    expect(spawned(s, 30)).toBe(at60);
    expect(spawned(s, 47)).toBe(at60);
  });

  it('samples the rate at the end of each 1/60 s step (sub-step spikes emit nothing)', () => {
    expect(EMIT_STEP).toBeCloseTo(1 / 60, 12);
    const spike = emitter([0, 1000, 0.01, 0], 0.5);
    expect(spawned(spike, 60)).toBe(0);
    expect(spawned(spike, 144)).toBe(0);
    // constant burst over a 0.05 s cycle: 2 emitting steps × 1000/60 (the step reaching the cycle end emits nothing)
    const burst = emitter([0, 1000], 0.05);
    expect(spawned(burst, 144)).toBe(spawned(burst, 60));
    expect(spawned(burst, 60)).toBeGreaterThanOrEqual(33);
    expect(spawned(burst, 60)).toBeLessThanOrEqual(34);
  });

  it('writes the per-spawn tint into anchor row 1 (white unless the spec opts in)', () => {
    const { h } = makeHost();
    const tex = h.uniforms.uAnchors.value;
    if (!(tex instanceof DataTexture) || !(tex.image.data instanceof Float32Array)) throw new Error('anchor texture: float DataTexture expected');
    const data = tex.image.data;
    const row1 = (handle: number): number[] => Array.from(data.subarray(ANCHORS * 4 + (handle & 255) * 4, ANCHORS * 4 + (handle & 255) * 4 + 4));
    const c = new Ctx();
    c.tinted = true;
    c.pal.main = 0xff8000;
    const tinted = h.play(emitter([0, 10], 1, { tint: true }), c, false);
    expect(row1(tinted).map((v) => +v.toFixed(3))).toEqual([1, 1, 0.502, 0]);
    const plain = h.play(emitter([0, 10], 1), c, false);
    expect(row1(plain)).toEqual([1, 1, 1, 1]);
  });
});

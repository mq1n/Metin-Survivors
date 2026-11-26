// Random flipbook frame mode on surfaces: every record (each surface of one spawn, each loop period of one surface) carries
// its own hash seed, so no two of them walk the same frame sequence in lock step. The SpecHost runs without a GPU (atlas
// bake stubbed, like specRuntime.test.ts); the frame sequence of a record is read back through flip.ts' JS mirror of the
// shader's `flipFrame` with the seed slot the shader reads (`floor(seed * 2^24)`).
import { Scene, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Ctx, type Fx } from '../emit';
import { VRng } from '../util';
import { flipFrame, recordSeed } from '../spec/flip';
import { SpecHost } from '../spec/host';
import { REC, type SpecBatch } from '../spec/batches';
import { ROLES } from '../spec/roles';
import type { FrameMode, FxSpec, SurfaceSpec } from '../spec/types';

vi.mock('../spec/atlas', () => ({ bakeSpecAtlas: () => ({ texture: null, dispose: () => undefined }) }));

const FRAMES = ROLES.boltH.frames;
const LIFE = 0.5;
const SF_FRAMES = 21;

function makeHost(): { h: SpecHost; fx: Fx } {
  const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
  const h = new SpecHost(new Scene(), {} as WebGLRenderer, { value: 0 }, fx, 3, 10, []);
  return { h, fx };
}

function surface(mode: FrameMode | undefined, fps = 0): SurfaceSpec {
  return {
    kind: 'surface',
    life: LIFE,
    loop: true,
    shape: { kind: 'card', w: 1, h: 1 },
    color: [0, 0xffffff, 1],
    blend: 'add',
    tex: 'boltH',
    ...(mode !== undefined ? { frames: { fps, mode } } : {}),
  };
}

function spec(elements: SurfaceSpec[]): FxSpec {
  return { id: 'sk.test_frame_seed', desc: 'test', behavior: 'selfBuff', ref: {}, size: 'radius', base: 2, dur: 2, elements };
}

interface Rec {
  birth: number;
  seed: number;
  mode: number;
  fps: number;
}

/** the surface records of the additive batch after `seconds` of 60 Hz frames, in allocation order */
function records(s: FxSpec, spawnSeed: number, seconds: number): Rec[] {
  const { h, fx } = makeHost();
  const c = new Ctx();
  c.seed = spawnSeed;
  c.duration = 3; // repeating elements run this long
  h.play(s, c, false);
  for (let f = 0; f < Math.round(seconds * 60); f++) {
    fx.time += 1 / 60;
    h.update(1 / 60);
  }
  const b = (h as unknown as { sAdd: SpecBatch }).sAdd;
  const out: Rec[] = [];
  for (let i = 0; i < b.used; i++) {
    const o = i * REC;
    out.push({ birth: b.f[o + 3] as number, seed: b.f[o + 22] as number, mode: ((b.f[o + 18] as number) >> SF_FRAMES) & 3, fps: b.f[o + 23] as number });
  }
  return out;
}

/** frames a record shows over one life when fps = 0 (one step per frame), like the shader */
function sequence(r: Rec): number[] {
  const p = Math.floor(r.seed * 16777216);
  const out: number[] = [];
  for (let k = 0; k < FRAMES; k++) out.push(flipFrame(FRAMES, 2, 0, 0, (k + 0.5) / FRAMES, p)[0]);
  return out;
}

describe('recordSeed', () => {
  it('is a 24-bit fraction (exact in a float32 slot), deterministic, and differs per element and per period', () => {
    const seen = new Set<number>();
    for (let e = 0; e < 6; e++) {
      for (let p = 0; p < 6; p++) {
        const v = recordSeed(0.37, e, p);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
        expect(Math.fround(v)).toBe(v);
        expect(Math.floor(Math.fround(v) * 16777216)).toBe(Math.floor(v * 16777216));
        expect(recordSeed(0.37, e, p)).toBe(v);
        seen.add(v);
      }
    }
    expect(seen.size).toBe(36);
    expect(recordSeed(0.38, 0, 0)).not.toBe(recordSeed(0.37, 0, 0));
  });
});

describe('random frame mode: a seed per surface record', () => {
  const two = spec([surface('random'), surface('random')]);

  it('two surfaces of one spawn pick different frame sequences', () => {
    const rec = records(two, 0.42, 0.3);
    expect(rec).toHaveLength(2);
    expect(rec.every((r) => r.mode === 2)).toBe(true);
    const [a, b] = rec as [Rec, Rec];
    expect(a.birth).toBeCloseTo(b.birth, 6);
    expect(a.seed).not.toBe(b.seed);
    expect(sequence(a)).not.toEqual(sequence(b));
  });

  it('two loop periods of one surface pick different frame sequences', () => {
    const rec = records(spec([surface('random')]), 0.42, 1.2);
    expect(rec.length).toBeGreaterThanOrEqual(3);
    const seqs = rec.map(sequence);
    for (let i = 0; i < seqs.length; i++) {
      expect(rec[i]?.birth).toBeCloseTo(i * LIFE, 5);
      for (let j = i + 1; j < seqs.length; j++) expect(seqs[i], `period ${i} vs ${j}`).not.toEqual(seqs[j]);
    }
  });

  it('every (surface, period) pair is its own sequence, and a fixed spawn seed replays identically', () => {
    const rec = records(two, 0.42, 1.2);
    expect(rec).toHaveLength(6);
    expect(new Set(rec.map((r) => r.seed)).size).toBe(6);
    expect(new Set(rec.map((r) => sequence(r).join())).size).toBe(6);
    expect(records(two, 0.42, 1.2).map((r) => r.seed)).toEqual(rec.map((r) => r.seed));
    expect(records(two, 0.43, 1.2).map((r) => r.seed)).not.toEqual(rec.map((r) => r.seed));
  });

  it('also holds with a flipbook rate (fps > 0): the seed differs per record', () => {
    const rec = records(spec([surface('random', 12), surface('random', 12)]), 0.42, 1.2);
    expect(new Set(rec.map((r) => r.seed)).size).toBe(rec.length);
    expect(rec.every((r) => r.fps === 12)).toBe(true);
  });
});

describe('other frame modes keep the spawn seed (existing looks unchanged)', () => {
  it('cut, blend and no frames: every record carries the spawn seed', () => {
    for (const mode of ['cut', 'blend', undefined] as const) {
      const rec = records(spec([surface(mode), surface(mode)]), 0.42, 1.2);
      expect(rec).toHaveLength(6);
      for (const r of rec) expect(r.seed).toBeCloseTo(0.42, 6);
    }
  });
});

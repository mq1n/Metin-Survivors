

// destroyed at once on impact, FlyingInstance.cpp __Explode). CPU side only (the atlas bake needs a GPU and is stubbed).
import { Scene, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Ctx, type Fx } from '../emit';
import { VRng } from '../util';
import { SpecHost } from '../spec/host';
import type { FxSpec, ParticleSpec } from '../spec/types';

vi.mock('../spec/atlas', () => ({ bakeSpecAtlas: () => ({ texture: null, dispose: () => undefined }) }));

interface Batch {
  f: Float32Array;
  endT: Float32Array;
  used: number;
}

function makeHost(): { h: SpecHost; fx: Fx; pAdd: Batch; anchors: Float32Array } {
  const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
  const h = new SpecHost(new Scene(), {} as WebGLRenderer, { value: 0 }, fx, 3, 10, []);
  const internals = h as unknown as { pAdd: Batch; anchorData: Float32Array };
  return { h, fx, pAdd: internals.pAdd, anchors: internals.anchorData };
}

function part(extra: Partial<ParticleSpec> = {}): ParticleSpec {
  return { kind: 'particle', cycle: 0.5, max: 64, rate: [0, 60], life: [0, 2], half: [0, 0.3], color: [0, 0xffffff, 1], billboard: 'upright', blend: 'add', tex: 'glow', ...extra };
}

function spec(el: ParticleSpec, extra: Partial<FxSpec> = {}): FxSpec {
  return { id: 'sk.test_faces', desc: 'test', behavior: 'selfBuff', ref: {}, size: 'radius', base: 2, dur: 1, elements: [el], ...extra };
}

function run(h: SpecHost, fx: Fx, seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds - 1e-9; t += step) {
    fx.time += step;
    h.update(step);
  }
}

/** flag word (record float 18) of every record of the batch, in allocation order */
function flagsOf(b: Batch): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.used; i++) out.push(b.f[i * 24 + 18] as number);
  return out;
}

const faceCode = (flags: number): number => (flags >> 18) & 7;

describe('ParticleSpec.faces (2FACE / 3FACE billboards)', () => {
  it('a single upright card (default) is one record per particle with face code 0', () => {
    const { h, fx, pAdd } = makeHost();
    h.play(spec(part()), new Ctx(), false);
    run(h, fx, 0.2);
    const fl = flagsOf(pAdd);
    expect(fl.length).toBeGreaterThan(3);
    expect(new Set(fl.map(faceCode))).toEqual(new Set([0]));
  });

  it('faces: 2 writes two records per particle turned -30 / +30 deg (codes 1, 2); faces: 3 writes three at 0 / -60 / +60 deg (codes 0, 3, 4)', () => {
    const one = makeHost();
    one.h.play(spec(part()), new Ctx(), false);
    run(one.h, one.fx, 0.2);
    const n1 = one.pAdd.used;
    for (const [faces, codes] of [[2, [1, 2]], [3, [0, 3, 4]]] as const) {
      const { h, fx, pAdd } = makeHost();
      h.play(spec(part({ faces })), new Ctx(), false);
      run(h, fx, 0.2);
      expect(pAdd.used).toBe(n1 * faces);
      const fl = flagsOf(pAdd);
      // consecutive records of one particle carry the codes in order, everything else of the record is identical
      for (let i = 0; i < fl.length; i += faces) {
        for (let k = 0; k < faces; k++) {
          expect(faceCode(fl[i + k] as number)).toBe(codes[k]);
          expect((fl[i + k] as number) & ~(7 << 18)).toBe((fl[i] as number) & ~(7 << 18));
          for (const c of [0, 1, 2, 3, 4, 5, 6, 7, 12, 13, 17, 19]) expect(pAdd.f[(i + k) * 24 + c]).toBe(pAdd.f[i * 24 + c]);
          expect(pAdd.endT[i + k]).toBe(pAdd.endT[i]);
        }
      }
    }
  });

  it('only an upright billboard has faces: a screen billboard with faces stays one record', () => {
    const a = makeHost(), b = makeHost();
    a.h.play(spec(part({ billboard: 'screen' })), new Ctx(), false);
    b.h.play(spec(part({ billboard: 'screen', faces: 3 })), new Ctx(), false);
    run(a.h, a.fx, 0.2);
    run(b.h, b.fx, 0.2);
    expect(b.pAdd.used).toBe(a.pAdd.used);
    expect(new Set(flagsOf(b.pAdd).map(faceCode))).toEqual(new Set([0]));
  });
});

describe('FxSpec.fadeOut: 0 (a projectile effect ends immediately on impact)', () => {
  /** anchor alpha of effect slot 0 after the stop, per frame */
  function alphaAfterStop(fadeOut: number | undefined, frames: number): number[] {
    const { h, fx, anchors } = makeHost();
    const el = part({ billboard: 'screen', life: [0, 2], loops: 0 });
    const handle = h.play(spec(el, { behavior: 'projectile', ...(fadeOut !== undefined ? { fadeOut } : {}) }), new Ctx(), true);
    run(h, fx, 0.2);
    h.stop(handle);
    const out: number[] = [];
    const slot = (handle & 255) - 1;
    const ANCHORS = 256;
    for (let i = 0; i < frames; i++) {
      run(h, fx, 1 / 60, 1 / 60);
      out.push(anchors[ANCHORS * 4 + (slot + 1) * 4] as number);
    }
    return out;
  }

  it('fadeOut 0: the body alpha is gone on the first frame after the stop, although its particles live for 2 s', () => {
    const a = alphaAfterStop(0, 3);
    expect(a[0]).toBeLessThan(0.05);
  });

  it('the default 0.35 s fade is unchanged (a fraction left after 3 frames)', () => {
    const a = alphaAfterStop(undefined, 3);
    expect(a[2]).toBeGreaterThan(0.8);
  });
});

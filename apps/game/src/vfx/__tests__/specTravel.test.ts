
// attach effect rides the flying object to the target's centre, ActorInstanceFly.cpp / FlyingInstance.cpp) instead of a static `place: 'along'`
// spread or a stand-in range in `path.z`. CPU side only (the atlas bake needs a GPU and is stubbed).
import { Scene, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Ctx, type Fx } from '../emit';
import { VRng } from '../util';
import { SpecHost } from '../spec/host';
import type { FxSpec, ParticleSpec, SurfaceSpec } from '../spec/types';

vi.mock('../spec/atlas', () => ({ bakeSpecAtlas: () => ({ texture: null, dispose: () => undefined }) }));

interface Batch {
  f: Float32Array;
  endT: Float32Array;
  used: number;
}

function makeHost(): { h: SpecHost; fx: Fx; pAdd: Batch } {
  const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
  const h = new SpecHost(new Scene(), {} as WebGLRenderer, { value: 0 }, fx, 3, 10, []);
  return { h, fx, pAdd: (h as unknown as { pAdd: Batch }).pAdd };
}

function part(extra: Partial<ParticleSpec> = {}): ParticleSpec {
  return { kind: 'particle', cycle: 0.4, max: 200, rate: [0, 120], life: [0, 0.05], half: [0, 0.2], color: [0, 0xffffff, 1], billboard: 'screen', blend: 'add', tex: 'glow', ...extra };
}

function spec(el: ParticleSpec): FxSpec {
  return { id: 'sk.test_travel', desc: 'test', behavior: 'chain', ref: {}, size: 'mult', base: 1, dur: 0.5, elements: [el] };
}

function line(c: Ctx, tx: number, ty: number, tz: number, rot = 0): Ctx {
  c.hasTarget = true;
  c.tx = tx;
  c.ty = ty;
  c.tz = tz;
  c.rot = rot;
  return c;
}

function run(h: SpecHost, fx: Fx, seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds - 1e-9; t += step) {
    fx.time += step;
    h.update(step);
  }
}

/** world birth position and velocity of every record: centre + offset (record floats 0-2, 4-6; 8-10) */
function births(b: Batch): { p: number[]; v: number[]; t: number }[] {
  const out = [];
  for (let i = 0; i < b.used; i++) {
    const o = i * 24, f = b.f;
    out.push({ p: [(f[o] as number) + (f[o + 4] as number), (f[o + 1] as number) + (f[o + 5] as number), (f[o + 2] as number) + (f[o + 6] as number)], v: [f[o + 8] as number, f[o + 9] as number, f[o + 10] as number], t: f[o + 3] as number });
  }
  return out.sort((a, b2) => a.t - b2.t);
}

describe('ParticleSpec.travel (moving emitter of a flight leg)', () => {
  it('the emitter runs from the origin to the REAL target: end of the leg = target, whatever the hop length', () => {
    for (const hop of [3, 6, 9]) {
      const { h, fx, pAdd } = makeHost();
      h.play(spec(part({ travel: [0, 0, 0.2, 1] })), line(new Ctx(), 0, 0, hop), false);
      run(h, fx, 0.4);
      const bs = births(pAdd);
      expect(bs.length).toBeGreaterThan(20);
      const zs = bs.map((b) => b.p[2] as number);
      for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeGreaterThanOrEqual((zs[i - 1] as number) - 1e-4); // monotone
      expect(zs[0]).toBeLessThan(hop * 0.1);
      expect(zs[zs.length - 1]).toBeCloseTo(hop, 3);
      // ~ halfway at 0.1 s into the leg
      const mid = bs.find((b) => b.t >= fx.time - 0.4 + 0.1);
      expect((mid?.p[2] as number) / hop).toBeGreaterThan(0.35);
      expect((mid?.p[2] as number) / hop).toBeLessThan(0.65);
    }
  });

  it('follows the slope (y of the segment) and adds the local path (absolute launch height)', () => {
    const { h, fx, pAdd } = makeHost();
    // segment rises 1 m; path.y is the launch -> arrival height (1.6 -> 0.8 m above the line)
    h.play(spec(part({ travel: [0, 0, 0.2, 1], path: { y: [0, 1.6, 0.2, 0.8] } })), line(new Ctx(), 0, 1, 6), false);
    run(h, fx, 0.4);
    const bs = births(pAdd);
    const first = bs[0]!, last = bs[bs.length - 1]!;
    expect(first.p[1]).toBeCloseTo(1.6, 0);
    expect(last.p[1]).toBeCloseTo(1 + 0.8, 3);
  });

  it('is world space: a segment along +X moves the emitter along +X whatever the local frame is', () => {
    const { h, fx, pAdd } = makeHost();
    h.play(spec(part({ travel: [0, 0, 0.2, 1] })), line(new Ctx(), 5, 0, 0, Math.PI / 2), false);
    run(h, fx, 0.4);
    const last = births(pAdd).pop()!;
    expect(last.p[0]).toBeCloseTo(5, 3);
    expect(Math.abs(last.p[2] as number)).toBeLessThan(1e-3);
  });

  it('wins over place: along (no random spread over the segment)', () => {
    const { h, fx, pAdd } = makeHost();
    h.play(spec(part({ travel: [0, 0, 0.4, 0.5], place: 'along' })), line(new Ctx(), 0, 0, 8), false);
    run(h, fx, 0.4);
    // 'along' alone would spread births over 0..8 m; travel 0 -> 0.5 keeps them in 0..4 m
    for (const b of births(pAdd)) expect(b.p[2]).toBeLessThanOrEqual(4.0001);
  });

  it('without a line target the emitter stays at the origin', () => {
    const { h, fx, pAdd } = makeHost();
    h.play(spec(part({ travel: [0, 0, 0.2, 1] })), new Ctx(), false);
    run(h, fx, 0.4);
    expect(pAdd.used).toBeGreaterThan(20);
    for (const b of births(pAdd)) expect(Math.hypot(b.p[0] as number, b.p[2] as number)).toBeLessThan(1e-4);
  });

  it('attach: true rides the emitter (segment velocity added while it moves, none after the arrival); without attach the particles are not carried', () => {
    for (const attach of [true, undefined]) {
      const { h, fx, pAdd } = makeHost();
      h.play(spec(part({ travel: [0, 0, 0.2, 1], ...(attach ? { attach: true } : {}) })), line(new Ctx(), 0, 0, 6), false);
      run(h, fx, 0.4);
      const bs = births(pAdd);
      const moving = bs.filter((b) => b.t - (fx.time - 0.4) < 0.18 && b.t - (fx.time - 0.4) > 0.02);
      const arrived = bs.filter((b) => b.t - (fx.time - 0.4) > 0.25);
      expect(moving.length).toBeGreaterThan(5);
      expect(arrived.length).toBeGreaterThan(5);
      for (const b of moving) expect(b.v[2]).toBeCloseTo(attach ? 30 : 0, 0); // 6 m in 0.2 s
      for (const b of arrived) expect(Math.abs(b.v[2] as number)).toBeLessThan(0.5);
    }
  });

  it('attach: true also rides the local `path` motion (a falling launch -> arrival height gives the particles the same vertical speed)', () => {
    const { h, fx, pAdd } = makeHost();
    // path.y falls 1.6 -> 0.8 m over 0.2 s = -4 m/s; z advances 3 m over the leg = +15 m/s on top of the segment's 6 m / 0.2 s = 30 m/s
    h.play(spec(part({ travel: [0, 0, 0.2, 1], attach: true, path: { y: [0, 1.6, 0.2, 0.8], z: [0, 0, 0.2, 3] } })), line(new Ctx(), 0, 0, 6), false);
    run(h, fx, 0.4);
    const moving = births(pAdd).filter((b) => b.t - (fx.time - 0.4) < 0.18 && b.t - (fx.time - 0.4) > 0.02);
    expect(moving.length).toBeGreaterThan(5);
    for (const b of moving) {
      expect(b.v[1]).toBeCloseTo(-4, 0);
      expect(b.v[2]).toBeCloseTo(45, 0);
    }
  });

  it('a spec without travel is unchanged (no extra velocity, along still spreads)', () => {
    const { h, fx, pAdd } = makeHost();
    h.play(spec(part({ place: 'along' })), line(new Ctx(), 0, 0, 8), false);
    run(h, fx, 0.4);
    const zs = births(pAdd).map((b) => b.p[2] as number);
    expect(Math.max(...zs)).toBeGreaterThan(6);
    expect(Math.min(...zs)).toBeLessThan(2);
  });
});

describe('SurfaceShape cyl.bulge / SurfaceSpec.softU (C-mesh-shell: curved crescent silhouette, feathered ends of a partial shell)', () => {
  function surf(extra: Partial<SurfaceSpec> = {}, shape: SurfaceSpec['shape'] = { kind: 'cyl', rb: 0.8, rt: 0.8, h: 2, span: 106 }): FxSpec {
    const el: SurfaceSpec = { kind: 'surface', life: 1, shape, color: [0, 0xffffff, 1], blend: 'add', tex: 'glow', ...extra };
    return { id: 'sk.test_surf', desc: 'test', behavior: 'selfBuff', ref: {}, size: 'mult', base: 1, dur: 1, elements: [el] };
  }
  function record(sp: FxSpec, k = 1): Float32Array {
    const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
    const h = new SpecHost(new Scene(), {} as WebGLRenderer, { value: 0 }, fx, 3, 10, []);
    const c = new Ctx();
    c.scale = k;
    h.play(sp, c, false);
    run(h, fx, 1 / 30);
    const b = (h as unknown as { sAdd: Batch }).sAdd;
    expect(b.used).toBe(1);
    return b.f.slice(0, 24);
  }

  it('bulge is written as shape param p4 (record float 12) at the effect scale; default 0 (straight cylinder)', () => {
    expect(record(surf())[12]).toBe(0);
    expect(record(surf({}, { kind: 'cyl', rb: 0.83, rt: 0.83, h: 2, span: 106, bulge: 0.51 }))[12]).toBeCloseTo(0.51, 5);
    expect(record(surf({}, { kind: 'cyl', rb: 0.83, rt: 0.83, h: 2, span: 106, bulge: 0.51 }), 2)[12]).toBeCloseTo(1.02, 5);
  });

  it('softU rides the integer part of the soft word (float 21) without touching soft: soft = w mod 2, softU = floor(w / 2) / 100', () => {
    const dec = (w: number): [number, number] => {
      const q = Math.floor(w * 0.5);
      return [w - 2 * q, q * 0.01];
    };
    const none = record(surf());
    expect(dec(none[21] as number)).toEqual([0, 0]);
    const both = dec(record(surf({ soft: 0.4, softU: 0.25 }))[21] as number);
    expect(both[0]).toBeCloseTo(0.4, 5);
    expect(both[1]).toBeCloseTo(0.25, 5);
    const sOnly = dec(record(surf({ soft: 1 }))[21] as number);
    expect(sOnly[0]).toBeCloseTo(1, 5);
    expect(sOnly[1]).toBe(0);
    // clamped to half the span
    expect(dec(record(surf({ softU: 0.9 }))[21] as number)[1]).toBeCloseTo(0.5, 5);
  });
});

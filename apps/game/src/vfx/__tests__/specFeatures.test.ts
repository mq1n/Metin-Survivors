
// gradeScale), body sockets (attach / from, stand-in body), weapon trails, generated-art roles (packing, encoding,
// missing-art fallback) and the persistent-loop lifetime. CPU side only (the atlas bakes need a GPU and are stubbed).
import { Scene, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Ctx, type Fx } from '../emit';
import { VRng } from '../util';
import { ART_ROLE_BASE, artFootprint, artRect, packArt, packArtRole } from '../spec/art';
import { SpecHost, gradeElement, gradeOf, type SpecMeta } from '../spec/host';
import { BEHAVIOR_CONTRACTS, specPreset } from '../spec/preset';
import { packRole, ROLES } from '../spec/roles';
import { SET_FLOATS, SOCKET_ID, SOCKET_STRIDE, qrot, quatFromBasis, quatYaw, standInSockets, STAND_IN_BLADE } from '../spec/sockets';
import { loopTotal } from '../system';
import type { ElementSpec, FxSpec, ParticleSpec, TrailSpec } from '../spec/types';
import type { PresetDef } from '../presets/types';

vi.mock('../spec/atlas', () => ({ bakeSpecAtlas: () => ({ texture: null, dispose: () => undefined }) }));

interface Batch {
  f: Float32Array;
  endT: Float32Array;
  used: number;
}

function makeHost(): { h: SpecHost; fx: Fx; batches: { pAdd: Batch; pAlpha: Batch; sAdd: Batch } } {
  const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
  const h = new SpecHost(new Scene(), {} as WebGLRenderer, { value: 0 }, fx, 3, 10, []);
  const b = h as unknown as { pAdd: Batch; pAlpha: Batch; sAdd: Batch };
  return { h, fx, batches: { pAdd: b.pAdd, pAlpha: b.pAlpha, sAdd: b.sAdd } };
}

function base(elements: ElementSpec[], extra: Partial<FxSpec> = {}): FxSpec {
  return { id: 'sk.test_features', desc: 'test spec', behavior: 'selfBuff', ref: { family: 'test' }, size: 'radius', base: 2, dur: 1, elements, ...extra };
}

function burst(extra: Partial<ParticleSpec> = {}): ParticleSpec {
  return { kind: 'particle', cycle: 0.5, max: 8, rate: [0, 240], life: [0, 2], half: [0, 0.3], color: [0, 0xffffff, 1], billboard: 'screen', blend: 'add', tex: 'glow', ...extra };
}

function run(h: SpecHost, fx: Fx, seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds - 1e-9; t += step) {
    fx.time += step;
    h.update(step);
  }
}

/** live records of a batch: their float slices */
function live(b: Batch, now: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < b.used; i++) if ((b.endT[i] as number) > now) out.push(b.f.subarray(i * 24, i * 24 + 24));
  return out;
}

const meta = (rank: number, caster = -1): SpecMeta => ({ rank, awakened: rank >= 7, caster });

// ------------------------------------------------------------------------------------------------ ranks

describe('rank escalation', () => {
  it('maps ranks 0..7 (1,2,3,M1,M2,G1,G2,P) to mastery grade bands', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((r) => gradeOf(r))).toEqual([0, 0, 0, 1, 1, 2, 2, 3]);
    expect(gradeOf(2, true)).toBe(3);
  });

  it('gates elements by minRank / maxRank', () => {
    const spec = base([burst({ minRank: 3 }), burst({ maxRank: 2, tex: 'spark' })]);
    const count = (rank: number): { glow: number; spark: number } => {
      const { h, fx, batches } = makeHost();
      h.play(spec, new Ctx(), false, meta(rank));
      run(h, fx, 0.1);
      const recs = live(batches.pAdd, fx.time);
      return { glow: recs.filter((r) => r[17] === packRole(ROLES.glow)).length, spark: recs.filter((r) => r[17] === packRole(ROLES.spark)).length };
    };
    expect(count(0)).toEqual({ glow: 0, spark: 8 });
    expect(count(2)).toEqual({ glow: 0, spark: 8 });
    expect(count(3)).toEqual({ glow: 8, spark: 0 });
    expect(count(7)).toEqual({ glow: 8, spark: 0 });
  });

  it('merges per-grade keys cumulatively (g2 on top of g1, g3 on top of g2) and shares the base when nothing changes', () => {
    const el = burst({ grade: { g1: { half: [0, 0.5] }, g3: { color: [0, 0xff0000, 1] } } });
    expect(gradeElement(el, 0)).toBe(el);
    const g1 = gradeElement(el, 1) as ParticleSpec;
    const g2 = gradeElement(el, 2) as ParticleSpec;
    const g3 = gradeElement(el, 3) as ParticleSpec;
    expect(g1.half).toEqual([0, 0.5]);
    expect(g2.half).toEqual([0, 0.5]);
    expect(g3.half).toEqual([0, 0.5]);
    expect(g3.color).toEqual([0, 0xff0000, 1]);
    expect(g2.color).toEqual(el.color);
    const plain = burst();
    expect(gradeElement(plain, 3)).toBe(plain);
  });

  it('draws the grade variant: own LUT rows only when curves differ, sizes and textures per grade', () => {
    const spec = base([burst({ grade: { g1: { half: [0, 0.6], tex: 'spark' }, g2: { color: [0, 0x00ff00, 1] } } })]);
    const rec = (rank: number): Float32Array => {
      const { h, fx, batches } = makeHost();
      h.play(spec, new Ctx(), false, meta(rank));
      run(h, fx, 0.05);
      return live(batches.pAdd, fx.time)[0] as Float32Array;
    };
    const r0 = rec(0), r1 = rec(3), r2 = rec(5), r3 = rec(7);
    // half x (k = 1): 0.3 at g0, 0.6 from g1
    expect(r0[12]).toBeCloseTo(0.3, 5);
    expect(r1[12]).toBeCloseTo(0.6, 5);
    expect(r3[12]).toBeCloseTo(0.6, 5);
    expect(r0[17]).toBe(packRole(ROLES.glow));
    expect(r1[17]).toBe(packRole(ROLES.spark));
    // g1 only changed CPU-side keys → same curve rows as g0; g2 recoloured → new rows (g3 inherits g2's)
    expect(r1[16]).toBe(r0[16]);
    expect(r2[16]).not.toBe(r0[16]);
    expect(r3[16]).toBe(r2[16]);
  });

  it('scales the whole effect per grade with gradeScale', () => {
    const spec = base([burst()], { gradeScale: [1, 1.2, 1.4, 2] });
    const half = (rank: number): number => {
      const { h, fx, batches } = makeHost();
      h.play(spec, new Ctx(), false, meta(rank));
      run(h, fx, 0.05);
      return (live(batches.pAdd, fx.time)[0] as Float32Array)[12] as number;
    };
    expect(half(0)).toBeCloseTo(0.3, 5);
    expect(half(4)).toBeCloseTo(0.36, 5);
    expect(half(7)).toBeCloseTo(0.6, 5);
  });
});

// ------------------------------------------------------------------------------------------------ sockets

describe('body sockets', () => {
  it('quaternion helpers agree: basis → quaternion rotates the axes, yaw reads the forward axis', () => {
    const q: number[] = [0, 0, 0, 1];
    // 90° about +Y: X → −Z, Y → Y, Z → X
    quatFromBasis(0, 0, -1, 0, 1, 0, 1, 0, 0, q, 0);
    const v: number[] = [0, 0, 0];
    qrot(q, 0, 0, 0, 1, v, 0);
    expect(v[0]).toBeCloseTo(1, 6);
    expect(v[2]).toBeCloseTo(0, 6);
    expect(quatYaw(q, 0)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('stand-in weapon sweeps from the right-back to the left-front, blade frame +Y toward the tip', () => {
    const s = new Float32Array(SET_FLOATS);
    const tip = (t: number, mirror = 1): [number, number, number] => {
      standInSockets(s, 0, 0, 0, 0, 0, t, mirror);
      const o = SOCKET_ID.weapon * SOCKET_STRIDE;
      return [s[o] as number, s[o + 1] as number, s[o + 2] as number];
    };
    const a = tip(0), b = tip(0.5);
    expect(a[0]).toBeLessThan(-0.5); // right of the caster (−X)
    expect(b[0]).toBeGreaterThan(0.3); // left of the caster (+X)
    expect(b[2]).toBeGreaterThan(0.3); // in front
    expect(tip(0, -1)[0]).toBeGreaterThan(0.5); // mirrored combo swing starts on the left
    // the blade frame's +Y points from the grip (hand_r) to the tip, blade length apart
    standInSockets(s, 0, 0, 0, 0, 0, 0.16, 1);
    const w = SOCKET_ID.weapon * SOCKET_STRIDE, hnd = SOCKET_ID.hand_r * SOCKET_STRIDE;
    const y: number[] = [0, 0, 0];
    qrot(s, w + 4, 0, 1, 0, y, 0);
    const d = [(s[w] as number) - (s[hnd] as number), (s[w + 1] as number) - (s[hnd + 1] as number), (s[w + 2] as number) - (s[hnd + 2] as number)];
    const len = Math.hypot(d[0] as number, d[1] as number, d[2] as number);
    expect(len).toBeCloseTo(STAND_IN_BLADE, 4);
    for (let i = 0; i < 3; i++) expect((y[i] as number) * len).toBeCloseTo(d[i] as number, 4);
  });

  it('attach: socket → particles live in the fed hero socket frame (anchor field = slot + 256 × socket texel)', () => {
    const { h, fx, batches } = makeHost();
    const data = new Float32Array(SET_FLOATS);
    standInSockets(data, 0, 5, 0, 5, 0, 0, 1);
    h.setSockets(1, data);
    const handle = h.play(base([burst({ attach: 'hand_l', at: [0, 0.1, 0] })]), new Ctx(), false, meta(0, 1));
    run(h, fx, 0.05);
    const r = live(batches.pAdd, fx.time)[0] as Float32Array;
    const slot = handle & 255;
    expect(r[19]).toBe(slot + 256 * (1 * 8 + SOCKET_ID.hand_l));
    // local offset in the socket frame (not world), attached flag set
    expect(r[1]).toBeCloseTo(0.1, 5);
    expect((r[18] as number) & 4).toBe(4);
  });

  it('from: socket → particles are born at the socket world position and stay in world space', () => {
    const { h, fx, batches } = makeHost();
    const data = new Float32Array(SET_FLOATS);
    standInSockets(data, 0, 3, 0, -2, 0, 0, 1);
    h.setSockets(0, data);
    h.play(base([burst({ from: 'weapon' })]), new Ctx(), false, meta(0, 0));
    run(h, fx, 0.05);
    const r = live(batches.pAdd, fx.time)[0] as Float32Array;
    const o = SOCKET_ID.weapon * SOCKET_STRIDE;
    expect(r[0]).toBeCloseTo(data[o] as number, 4);
    expect(r[1]).toBeCloseTo(data[o + 1] as number, 4);
    expect(r[2]).toBeCloseTo(data[o + 2] as number, 4);
    expect(r[19] as number).toBeLessThan(256); // no socket frame on the GPU
  });

  it('without fed heroes (galleries) a socket element gets a private stand-in body at the effect origin', () => {
    const { h, fx, batches } = makeHost();
    const c = new Ctx();
    c.x = 10;
    c.z = 4;
    h.play(base([burst({ from: 'hand_r' })]), c, false, meta(0));
    run(h, fx, 0.05);
    const r = live(batches.pAdd, fx.time)[0] as Float32Array;
    expect(Math.hypot((r[0] as number) - 10, (r[2] as number) - 4)).toBeLessThan(1);
    expect(r[1]).toBeGreaterThan(0.8);
  });
});

// ------------------------------------------------------------------------------------------------ trails

describe('trails', () => {
  const trail = (extra: Partial<TrailSpec> = {}): TrailSpec => ({ kind: 'trail', attach: 'weapon', life: 0.2, width: 0.8, color: [0, 0xffffff, 1, 1, 0xffffff, 0], blend: 'add', tex: 'glowStrip', ...extra });

  it('writes band segments (tip → base along the blade) only while the anchor moves', () => {
    const { h, fx, batches } = makeHost();
    const data = new Float32Array(SET_FLOATS);
    standInSockets(data, 0, 0, 0, 0, 0, 0, 1);
    h.setSockets(0, data);
    h.play(base([trail()]), new Ctx(), false, meta(0, 0));
    run(h, fx, 0.1);
    expect(live(batches.pAdd, fx.time).length).toBe(0); // still blade: nothing
    // swing: the fed socket moves every frame
    for (let k = 0; k < 12; k++) {
      standInSockets(data, 0, 0, 0, 0, 0, k / 60, 1);
      h.setSockets(0, data);
      fx.time += 1 / 60;
      h.update(1 / 60);
    }
    const recs = live(batches.pAdd, fx.time);
    expect(recs.length).toBeGreaterThan(8);
    for (const r of recs) {
      expect((r[18] as number) & 16).toBe(16); // trail segment
      expect((r[18] as number) & 32).toBe(0); // band
      expect(r[11]).toBeGreaterThanOrEqual(r[3] as number); // tB ≥ tA
      expect(r[7]).toBeCloseTo(0.2, 6); // point life
      // base = tip − blade × width: 0.8 m apart
      expect(Math.hypot((r[0] as number) - (r[4] as number), (r[1] as number) - (r[5] as number), (r[2] as number) - (r[6] as number))).toBeCloseTo(0.8, 2);
    }
  });

  it('ribbon trails on the effect origin follow move() and stop after their window', () => {
    const { h, fx, batches } = makeHost();
    const spec: FxSpec = { ...base([trail({ attach: 'origin', mode: 'ribbon', width: 0.4, dur: 0.3 })]), behavior: 'projectile', size: 'mult' };
    const handle = h.play(spec, new Ctx(), true, meta(0));
    const step = (k: number): void => {
      h.move(handle, k * 0.1, 0, 0, 1, 0);
      fx.time += 1 / 60;
      h.update(1 / 60);
    };
    let k = 0;
    for (; k < 19; k++) step(k);
    const during = live(batches.pAdd, fx.time);
    expect(during.length).toBeGreaterThan(5);
    for (const r of during) {
      expect((r[18] as number) & 32).toBe(32); // ribbon
      expect(r[23]).toBeCloseTo(0.2, 6); // half width
      expect(r[8] as number).toBeGreaterThan(r[0] as number); // B is further along +X than A
    }
    // after the 0.3 s window nothing new is sampled: the trail drains within its 0.2 s point life
    for (; k < 19 + 20; k++) step(k);
    expect(live(batches.pAdd, fx.time).length).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ art

describe('art roles', () => {
  it('sizes cells by aspect and frames by the sheet grid', () => {
    expect(artFootprint('a', 512, 512)).toMatchObject({ cw: 1, ch: 1, frames: 1 });
    expect(artFootprint('b', 512, 128)).toMatchObject({ cw: 4, ch: 1 });
    expect(artFootprint('c', 256, 512)).toMatchObject({ cw: 1, ch: 2 });
    expect(artFootprint('d', 1024, 1024, [4, 4])).toMatchObject({ cw: 1, ch: 1, frames: 16, cols: 4, rows: 4 });
    expect(artFootprint('e', 1024, 1024, [4, 4], 10).frames).toBe(10);
  });

  it('packs into the smallest grid, wraps long runs, spills into layers without overlaps', () => {
    expect(packArt([artFootprint('one', 512, 512)]).grid).toBe(1);
    expect(packArt(Array.from({ length: 5 }, (_, i) => artFootprint(`s${i}`, 256, 256))).grid).toBe(4);
    const many = Array.from({ length: 70 }, (_, i) => artFootprint(`m${i}`, 256, 256));
    const L = packArt(many);
    expect(L.grid).toBe(8);
    expect(L.layers).toBe(2);
    const fb = artFootprint('fb', 1024, 1024, [4, 4]);
    const mix = [fb, artFootprint('w', 512, 128), ...Array.from({ length: 9 }, (_, i) => artFootprint(`q${i}`, 256, 256))];
    const lay = packArt(mix);
    const used = new Set<string>();
    for (const f of mix) {
      const p = lay.place.get(f.id);
      expect(p).toBeDefined();
      const pk = packArtRole(p!, f);
      for (let k = 0; k < f.frames; k++) {
        const r = artRect(pk, k, lay.grid);
        expect(r.layer).toBe(p!.layer);
        for (let cx = 0; cx < f.cw; cx++) {
          for (let cy = 0; cy < f.ch; cy++) {
            const key = `${r.layer}:${Math.round(r.u0 * lay.grid) + cx}:${Math.round((1 - r.v0 - r.dv) * lay.grid) + cy}`;
            expect(used.has(key)).toBe(false);
            used.add(key);
            expect(Math.round(r.u0 * lay.grid) + cx).toBeLessThan(lay.grid);
          }
        }
      }
    }
  });

  it('encodes art roles above every procedural role and decodes them like the shaders', () => {
    const maxProc = Math.max(...Object.values(ROLES).map((r) => packRole(r)));
    expect(maxProc).toBeLessThan(ART_ROLE_BASE);
    const f = artFootprint('x', 512, 256, [2, 1]);
    const pk = packArtRole({ layer: 3, col: 2, row: 5 }, f);
    const r = artRect(pk, 1, 8);
    expect(r.layer).toBe(3);
    expect(r.frames).toBe(2);
    expect(r.u0).toBeCloseTo((2 + 1) / 8, 6);
    expect(r.du).toBeCloseTo(1 / 8, 6);
    expect(r.v0).toBeCloseTo(1 - 6 / 8, 6);
  });

  it('missing sprites keep the procedural fallback role and warn once', async () => {
    const { h, fx, batches } = makeHost();
    const spec = base([burst({ tex: { art: 'vfx_not_shipped', fallback: 'spark' } })]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // compile happens on first play; the art id is collected for preloading
    h.play(spec, new Ctx(), false, meta(0));
    expect(h.artIds.has('vfx_not_shipped')).toBe(true);
    const src = { hasTexture: () => false, loadTexture: () => Promise.reject(new Error('no')), manifest: { textures: {} } };
    await h.preloadArt(src);
    await h.preloadArt(src);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    run(h, fx, 0.05);
    const r = live(batches.pAdd, fx.time)[0] as Float32Array;
    expect(r[17]).toBe(packRole(ROLES.spark));
  });
});

// ------------------------------------------------------------------------------------------------ loop lifetime

describe('persistent-loop lifetime (audit C2)', () => {
  const def = (untilStopped: boolean): PresetDef => ({ id: 'x', cat: 'buff', desc: 'x', size: 'radius', base: 1, palette: 'physical', dur: 1, loop: true, untilStopped, fire: () => undefined });

  it('a spawn without an explicit duration lives until stopped for untilStopped presets, else the preset default', () => {
    expect(loopTotal(def(true), { duration: 0 })).toBe(0);
    expect(loopTotal(def(true), undefined)).toBe(0);
    expect(loopTotal(def(true), { duration: 4 })).toBe(4);
    expect(loopTotal(def(false), { duration: 0 })).toBe(1);
    expect(loopTotal(def(false), { duration: 2.5 })).toBe(2.5);
  });

  it('every looping spec contract is untilStopped (persistent auras, infinite zones, tracked bodies)', () => {
    for (const [beh, ct] of Object.entries(BEHAVIOR_CONTRACTS)) {
      const p = specPreset({ ...base([burst()]), behavior: beh as FxSpec['behavior'], size: ct.size });
      expect(p.untilStopped === true).toBe(ct.loop);
    }
  });

  it('a spec loop stays alive for 5 s of updates until stop()', () => {
    const { h, fx } = makeHost();
    const handle = h.play({ ...base([burst({ loops: 0 })]), behavior: 'persistentAura' }, new Ctx(), true, null);
    run(h, fx, 5);
    expect(h.alive(handle)).toBe(true);
    h.stop(handle);
    run(h, fx, 3);
    expect(h.alive(handle)).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ tEnd (sk.moonless_cut)

describe('tEnd: an element placed at the end of the caller duration', () => {
  /** birth times of the live records with the given half-extent (the element tag) */
  function births(b: Batch, now: number, half: number): number[] {
    return live(b, now)
      .filter((r) => Math.abs((r[12] as number) - half) < 1e-4)
      .map((r) => r[3] as number);
  }

  it('starts at (duration - tEnd) + t0 instead of at the spawn; elements without tEnd are unchanged', () => {
    const { h, fx, batches } = makeHost();
    const c = new Ctx();
    c.duration = 0.6;
    h.play(base([burst({ half: [0, 0.2], rate: [0, 120], max: 2, life: [0, 5] }), burst({ half: [0, 0.4], rate: [0, 120], max: 2, life: [0, 5], tEnd: 0.2 })], { behavior: 'dash' }), c, false, meta(0));
    run(h, fx, 0.9);
    const plain = births(batches.pAdd, fx.time, 0.2);
    const end = births(batches.pAdd, fx.time, 0.4);
    expect(plain.length).toBeGreaterThan(0);
    expect(Math.min(...plain)).toBeLessThan(0.1);
    expect(end.length).toBeGreaterThan(0);
    expect(Math.min(...end)).toBeGreaterThan(0.4 - 0.03);
    expect(Math.min(...end)).toBeLessThan(0.4 + 0.05);
  });

  it('a longer caller duration shifts the element later (a longer dash = a later arrival)', () => {
    const { h, fx, batches } = makeHost();
    const c = new Ctx();
    c.duration = 0.9;
    h.play(base([burst({ half: [0, 0.4], rate: [0, 120], max: 2, life: [0, 5], tEnd: 0.2 })], { behavior: 'dash' }), c, false, meta(0));
    run(h, fx, 1.2);
    expect(Math.min(...births(batches.pAdd, fx.time, 0.4))).toBeGreaterThan(0.7 - 0.03);
  });
});

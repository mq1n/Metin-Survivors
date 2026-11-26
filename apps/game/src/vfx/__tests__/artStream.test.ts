// Staged art scope (production, `?payload=1`; spec/art.ts header, ARCHITECTURE §11): a run awaits only the art of its first
// seconds, the array is laid out for the WHOLE scope up front, and the rest streams into its reserved cells behind the HUD
// without a repack. The GPU is faked (a renderer that records the passes it is asked to render), like specArt.test.ts.
import { Scene, ShaderMaterial, Texture, type BufferGeometry, type Mesh, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Ctx, type Fx } from '../emit';
import { ART_BLIT_MS, ART_BLIT_PIXELS, ART_BLIT_PIXELS_MAX, ART_BLIT_SKIP_S, ART_MAX_CELLS, ART_RUN_BUDGET_MB, ART_STREAM_AFTER_S, ART_STREAM_PARALLEL, SpecArt, type ArtPlan, type ArtSource } from '../spec/art';
import { SpecHost } from '../spec/host';
import type { ElementSpec, FxSpec, ParticleSpec } from '../spec/types';
import { VRng } from '../util';

vi.mock('../spec/atlas', () => ({ bakeSpecAtlas: () => ({ texture: null, dispose: () => undefined }) }));

interface Pass {
  layer: number;
  /** the render target's texture asked for a mipmap regeneration after this pass */
  mips: boolean;
  /** the pass cleared its layer first (a full bake does, a blit never) */
  cleared: boolean;
  quads: string[];
}

/** a renderer that records every pass (layer, mip flag, clear, the quads it copies) */
function fakeRenderer(): { r: WebGLRenderer; passes: Pass[] } {
  const passes: Pass[] = [];
  let layer = 0;
  let mips = false;
  let cleared = false;
  const r = {
    autoClear: true,
    info: { render: { calls: 0, triangles: 0, points: 0, lines: 0 } },
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getClearColor: (c: unknown) => c,
    getClearAlpha: () => 1,
    setClearColor: () => undefined,
    setRenderTarget: (rt: { texture: { generateMipmaps: boolean } } | null, l?: number) => {
      layer = l ?? 0;
      mips = rt?.texture.generateMipmaps ?? false;
      cleared = false;
    },
    clear: () => {
      cleared = true;
    },
    render: (scene: Scene) => {
      // like three with `info.autoReset = false`: every pass adds to the frame's counters
      r.info.render.calls += scene.children.length;
      r.info.render.triangles += scene.children.length * 2;
      const quads: string[] = [];
      for (const o of scene.children) {
        const g = (o as Mesh).geometry as BufferGeometry;
        const pos = Array.from(g.getAttribute('position').array as Float32Array);
        const uv = Array.from(g.getAttribute('uv').array as Float32Array);
        const map = ((o as Mesh).material as ShaderMaterial).uniforms.map?.value as Texture;
        // one entry per quad: the rect it fills, the uv rect it reads, the source it reads it from
        for (let q = 0; q < pos.length / 12; q++) quads.push(`${layer}|${pos.slice(q * 12, q * 12 + 12).join(',')}|${uv.slice(q * 8, q * 8 + 8).join(',')}|${map.uuid}`);
      }
      passes.push({ layer, mips, cleared, quads });
    },
  };
  return { r: r as unknown as WebGLRenderer, passes };
}

interface Fake {
  src: ArtSource;
  /** ids fetched, in request order */
  loaded: string[];
  /** hold a fetch until `release(id)` (default: resolves at once) */
  hold: Set<string>;
  release: (id: string) => void;
  fail: Set<string>;
}

/** a manifest of `n` square sprites `s0..` of `px` edge (+ named extras) with controllable load timing */
function fakeSource(n: number, px = 256, extra: Record<string, { w: number; h: number }> = {}): Fake {
  const textures: Record<string, { w: number; h: number; alpha: boolean }> = {};
  for (let i = 0; i < n; i++) textures[`s${i}`] = { w: px, h: px, alpha: false };
  for (const [id, d] of Object.entries(extra)) textures[id] = { ...d, alpha: false };
  const loaded: string[] = [];
  const waiting = new Map<string, () => void>();
  const hold = new Set<string>();
  const fail = new Set<string>();
  const src: ArtSource = {
    hasTexture: (id) => id in textures,
    loadTexture: (id) => {
      loaded.push(id);
      if (fail.has(id)) return Promise.reject(new Error('404'));
      const t = new Texture();
      if (!hold.has(id)) return Promise.resolve(t);
      return new Promise<Texture>((res) => waiting.set(id, () => res(t)));
    },
    manifest: { textures },
  };
  return { src, loaded, hold, release: (id) => waiting.get(id)?.(), fail };
}

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `s${i}`);
const plan = (now: string[], later: string[], after = 2): ArtPlan => ({ now: new Set(now), later, after });
const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));
/** a quad multiset that ignores which texture object a quad reads (two runs create different ones) */
const shape = (passes: Pass[]): string[] => passes.flatMap((p) => p.quads.map((q) => q.split('|').slice(0, 3).join('|'))).sort();

/** pumps frames until `n` sprites are in the array (fetches resolve between frames) */
async function drain(art: SpecArt, key = 's0'): Promise<void> {
  void key;
  for (let i = 0; i < 400 && (art.streamStats().queued > 0 || art.streamStats().flying > 0 || art.streamStats().ready > 0); i++) {
    art.pump(1 / 60);
    await tick();
  }
}

describe('staged art scope: SpecArt', () => {
  it('awaits only the NOW keys and reserves a cell for every key of the scope', async () => {
    const { r } = fakeRenderer();
    const f = fakeSource(12);
    const art = new SpecArt(r, 2);
    art.setBudget(ART_RUN_BUDGET_MB);
    await art.preload(f.src, ids(12), true, plan(['s0', 's1'], ['s5', 's4']));
    expect(f.loaded.sort()).toEqual(['s0', 's1']);
    expect(art.stats.sprites).toBe(2);
    expect(art.stats.pending).toBe(10);
    expect(art.role('s0')).not.toBeNull();
    expect(art.peek('s7')).toBeNull();
    expect(art.streamStats()).toMatchObject({ staged: true, queued: 10, flying: 0, ready: 0 });
  });

  it('the stream is closed until the clock reaches `after`, then fetches ART_STREAM_PARALLEL keys at a time in plan order', async () => {
    const { r } = fakeRenderer();
    const f = fakeSource(12);
    f.hold.add('s5');
    f.hold.add('s4');
    f.hold.add('s3');
    f.hold.add('s2');
    f.hold.add('s6');
    const art = new SpecArt(r, 2);
    await art.preload(f.src, ids(12), true, plan(['s0'], ['s5', 's4'], 2));
    for (let i = 0; i < 19; i++) art.pump(0.1);
    await tick();
    expect(f.loaded).toEqual(['s0']);
    art.pump(0.1);
    art.pump(0.1); // 2.1 s
    expect(f.loaded.slice(1)).toEqual(['s5', 's4', 's1', 's2'].slice(0, ART_STREAM_PARALLEL));
    // a held fetch counts as in flight: no more start until one lands
    art.pump(1 / 60);
    expect(f.loaded.length).toBe(1 + ART_STREAM_PARALLEL);
    expect(art.streamStats().flying).toBeGreaterThan(0);
    // the clock ignores a stalled frame (dt capped at 0.1 s)
    const art2 = new SpecArt(r, 2);
    await art2.preload(f.src, ids(12), true, plan(['s0'], [], ART_STREAM_AFTER_S));
    art2.pump(30);
    expect(art2.streamStats().clock).toBeCloseTo(0.1, 6);
  });

  it('blits arrivals into their reserved cells: same layout, cell and packed roles as baking the scope at once', async () => {
    const eagerR = fakeRenderer();
    const eager = new SpecArt(eagerR.r, 2);
    eager.setBudget(ART_RUN_BUDGET_MB);
    await eager.preload(fakeSource(40).src, ids(40), true);

    const { r, passes } = fakeRenderer();
    const art = new SpecArt(r, 2);
    art.setBudget(ART_RUN_BUDGET_MB);
    const f = fakeSource(40);
    await art.preload(f.src, ids(40), true, plan(['s0', 's9', 's3'], ids(40).reverse(), 0.5));
    const first = { s0: art.role('s0'), s9: art.role('s9'), s3: art.role('s3') };
    const version = art.version;
    art.takeChanged();
    await drain(art);
    expect(art.streamStats()).toMatchObject({ queued: 0, flying: 0, ready: 0 });
    expect(art.version).toBeGreaterThan(version);
    // nothing moved: the sprites that were in the array at the first bake have the roles they had
    expect(art.peek('s0')).toEqual(first.s0);
    expect(art.peek('s9')).toEqual(first.s9);
    expect(art.peek('s3')).toEqual(first.s3);
    // and the final state is the eager one
    expect(art.stats).toMatchObject({ grid: eager.stats.grid, layers: eager.stats.layers, cell: eager.stats.cell, size: eager.stats.size, bytes: eager.stats.bytes, sprites: 40, pending: 0 });
    for (const k of ids(40)) expect(art.peek(k), k).toEqual(eager.peek(k));
    // every quad the eager bake draws is drawn once by the staged one
    expect(shape(passes)).toEqual(shape(eagerR.passes));
  });

  it('a slice is bounded by ART_BLIT_PIXELS, never clears, and asks for one mip regeneration', async () => {
    const { r, passes } = fakeRenderer();
    const f = fakeSource(130, 512);
    const art = new SpecArt(r, 2);
    art.setBudget(ART_RUN_BUDGET_MB);
    await art.preload(f.src, ids(130), true, plan(['s0'], ids(130), 0));
    expect(art.stats.layers).toBeGreaterThanOrEqual(2);
    const bakePasses = passes.length;
    art.pump(1 / 60); // opens the stream (after 0) and fetches
    await tick();
    await tick();
    art.pump(1 / 60);
    const slice = passes.slice(bakePasses);
    expect(slice.length).toBeGreaterThan(0);
    const keys = art.streamStats().keys;
    expect(keys).toBeGreaterThan(0);
    // 512² sprites: the first slice takes one (a second would pass the budget), and never more than the cap
    expect(keys).toBe(1);
    expect(ART_BLIT_PIXELS).toBeLessThan(2 * 512 * 512);
    expect(art.streamStats().pixels).toBeLessThanOrEqual(ART_BLIT_PIXELS_MAX);
    expect(slice.every((p) => !p.cleared)).toBe(true);
    // one regeneration per slice: only the last layer's pass carries it
    expect(slice.filter((p) => p.mips).length).toBe(1);
    expect(slice[slice.length - 1]?.mips).toBe(true);
    // the slice left the target usable by the rest of the frame: mip generation is back on
    expect(art.streamStats().slices).toBe(1);
  });

  it('role() of a key the stream has not reached fetches it at once, once; peek() never does', async () => {
    const { r } = fakeRenderer();
    const f = fakeSource(12);
    const art = new SpecArt(r, 2);
    await art.preload(f.src, ids(12), true, plan(['s0'], [], 99));
    expect(art.peek('s7')).toBeNull();
    await tick();
    expect(f.loaded).toEqual(['s0']);
    expect(art.role('s7')).toBeNull(); // not there yet, but asked for
    expect(art.role('s7')).toBeNull();
    await tick();
    expect(f.loaded).toEqual(['s0', 's7']);
    expect(art.streamStats().demanded).toBe(1);
    art.pump(1 / 60); // still before the stream's own time: the demanded key lands anyway
    expect(art.peek('s7')).not.toBeNull();
    expect(art.streamStats().queued).toBe(10);
    // a key outside the scope is nobody's business
    expect(art.role('nope')).toBeNull();
    expect(art.streamStats().demanded).toBe(1);
  });

  it('a failed or missing sprite keeps its fallback, warns once, and does not stall the stream', async () => {
    const { r } = fakeRenderer();
    const f = fakeSource(6);
    f.fail.add('s2');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const art = new SpecArt(r, 2);
    await art.preload(f.src, [...ids(6), 'ghost'], true, plan(['s0'], [], 0));
    expect(warn).toHaveBeenCalledTimes(1); // "ghost" is not in the manifest: known up front
    await drain(art);
    expect(art.peek('s2')).toBeNull();
    expect(art.isMissing('s2')).toBe(true);
    expect(art.peek('s5')).not.toBeNull();
    expect(art.peek('ghost')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('a new scope drops the old stream: a fetch that lands afterwards never reaches the array', async () => {
    const { r } = fakeRenderer();
    const f = fakeSource(12);
    f.hold.add('s5');
    const art = new SpecArt(r, 2);
    await art.preload(f.src, ids(12), true, plan(['s0'], ['s5'], 0));
    art.pump(1 / 60);
    expect(f.loaded).toContain('s5');
    // the next run only wants s0..s3
    await art.preload(f.src, ids(4), true, plan(['s0'], [], 0));
    f.release('s5');
    await tick();
    art.pump(1 / 60);
    await drain(art);
    expect(art.peek('s5')).toBeNull();
    expect(art.peek('s3')).not.toBeNull();
    expect(art.stats.sprites).toBe(4);
  });

  it('the next run finds its keys loaded already: they are blitted into the first pass, nothing waits for the stream', async () => {
    const { r } = fakeRenderer();
    const f = fakeSource(12);
    const art = new SpecArt(r, 2);
    await art.preload(f.src, ids(12), true, plan(['s0'], ids(12), 0));
    await drain(art);
    expect(art.stats.pending).toBe(0);
    const loadedBefore = f.loaded.length;
    await art.preload(f.src, ids(12), true, plan(['s0'], ids(12), 0));
    expect(f.loaded.length).toBe(loadedBefore);
    expect(art.stats.pending).toBe(0);
    expect(art.peek('s11')).not.toBeNull();
  });

  it('a tier change re-bakes what is in the array and keeps the pending keys pending', async () => {
    const { r } = fakeRenderer();
    const f = fakeSource(130);
    const art = new SpecArt(r, 2);
    art.setBudget(ART_RUN_BUDGET_MB);
    await art.preload(f.src, ids(130), true, plan(['s0', 's1'], ids(130), 0));
    const cell = art.stats.cell;
    art.setTier(0);
    expect(art.stats.cell).toBeLessThan(cell);
    expect(art.stats.sprites).toBe(2);
    expect(art.stats.pending).toBe(128);
    art.pump(0.1);
    await tick();
    art.pump(1 / 60);
    expect(art.stats.sprites).toBeGreaterThan(2);
  });

  it('a slice does not show in the renderer draw-call counters of the frame it runs in', async () => {
    const { r } = fakeRenderer();
    const f = fakeSource(12);
    const art = new SpecArt(r, 2);
    await art.preload(f.src, ids(12), true, plan(['s0'], ids(12), 0));
    const info = (r as unknown as { info: { render: { calls: number; triangles: number } } }).info.render;
    art.pump(1 / 60);
    await tick();
    const before = { calls: info.calls, triangles: info.triangles };
    art.pump(1 / 60);
    expect(art.streamStats().slices).toBe(1);
    expect(info).toMatchObject(before);
  });

  it('a key that found no cell (more than 8 layers of art) is not downloaded by the stream', async () => {
    const { r } = fakeRenderer();
    // 8 layers of 8 x 8 cells = 512 one-cell sprites fit; 520 do not
    const f = fakeSource(520);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const art = new SpecArt(r, 2);
    await art.preload(f.src, ids(520), true, plan(['s0'], ids(520), 0));
    const unplaced = ids(520).filter((k) => art.isMissing(k));
    expect(unplaced.length).toBeGreaterThan(0);
    await drain(art);
    for (const k of unplaced) expect(f.loaded, k).not.toContain(k);
    expect(art.stats.pending).toBe(0);
    warn.mockRestore();
  });

  it('past the array the keys the plan needs LAST lose their cell: the NOW keys and the head of the stream keep theirs (ArtStats.dropped)', async () => {
    const { r } = fakeRenderer();
    const n = ART_MAX_CELLS + 24;
    const f = fakeSource(n);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const art = new SpecArt(r, 2);
    // the plan wants s(n-1) first and s0 last: the id order is NOT the plan order
    const order = ids(n).reverse();
    const now = order.slice(0, 6);
    await art.preload(f.src, ids(n), true, plan(now, order.slice(6), 0));
    expect(art.stats.dropped).toBe(24);
    const lost = order.slice(n - 24);
    for (const k of lost) expect(art.isMissing(k), `${k} lost`).toBe(true);
    for (const k of order.slice(0, n - 24)) expect(art.isMissing(k), `${k} kept`).toBe(false);
    for (const k of now) expect(art.peek(k), `${k} awaited`).not.toBeNull();
    await drain(art);
    for (const k of lost) expect(f.loaded, k).not.toContain(k);
    for (const k of order.slice(0, n - 24)) expect(art.peek(k), `${k} streamed`).not.toBeNull();
    expect(art.stats).toMatchObject({ pending: 0, dropped: 24, sprites: n - 24 });
    warn.mockRestore();
  });

  it('a smaller scope than the last run re-bakes: the array does not keep the sprites of the old one', async () => {
    const { r } = fakeRenderer();
    const f = fakeSource(12);
    const art = new SpecArt(r, 2);
    await art.preload(f.src, ids(12), true, plan(['s0'], ids(12), 0));
    await drain(art);
    expect(art.stats.sprites).toBe(12);
    await art.preload(f.src, ids(4), true, plan(['s0'], ids(4), 0));
    expect(art.stats.sprites).toBe(4);
    expect(art.peek('s9')).toBeNull();
  });

  it('a frame that already ran long gets no slice (a few in a row at most, so a slow machine still finishes)', async () => {
    const { r } = fakeRenderer();
    const f = fakeSource(12);
    const art = new SpecArt(r, 2);
    await art.preload(f.src, ids(12), true, plan(['s0'], ids(12), 0));
    art.pump(1 / 60);
    await tick();
    const slow = ART_BLIT_SKIP_S + 0.01;
    art.pump(slow);
    expect(art.streamStats().slices).toBe(0);
    art.pump(slow);
    expect(art.streamStats().slices).toBe(0);
    // held back at most 8 frames in a row: the ninth long frame is served
    for (let i = 0; i < 6; i++) art.pump(slow);
    expect(art.streamStats().slices).toBe(0);
    art.pump(slow);
    expect(art.streamStats().slices).toBe(1);
  });

  it('the slice size follows the measured cost: cheap slices grow it up to the cap, never below one sprite', async () => {
    const { r } = fakeRenderer();
    const f = fakeSource(60, 512);
    const art = new SpecArt(r, 2);
    await art.preload(f.src, ids(60), true, plan(['s0'], ids(60), 0));
    art.pump(1 / 60);
    await tick();
    const slices: number[] = [];
    let last = 0;
    for (let i = 0; i < 40; i++) {
      art.pump(1 / 60);
      const st = art.streamStats();
      if (st.slices > slices.length) {
        slices.push(st.keys - last);
        last = st.keys;
      }
      await tick();
    }
    // the fake GPU is instant (a slice costs ~0 ms): the budget ART_BLIT_MS buys the cap, so slices grow from 1 key to the cap
    expect(slices[0]).toBe(1);
    expect(Math.max(...slices)).toBeGreaterThan(1);
    expect(Math.max(...slices) * 512 * 512).toBeLessThanOrEqual(ART_BLIT_PIXELS_MAX);
    expect(ART_BLIT_MS).toBeGreaterThan(0);
  });

  it('one blit material outlives every pass (three frees a program nobody uses: the next slice would compile it again)', async () => {
    const disposed = new Set<string>();
    const spy = vi.spyOn(ShaderMaterial.prototype, 'dispose').mockImplementation(function (this: ShaderMaterial) {
      disposed.add(this.uuid);
    });
    const { r, passes } = fakeRenderer();
    const seen = new Set<string>();
    const render = (r as unknown as { render: (s: Scene) => void }).render;
    (r as unknown as { render: (s: Scene) => void }).render = (scene: Scene) => {
      for (const o of scene.children) seen.add(((o as Mesh).material as ShaderMaterial).uuid);
      render(scene);
    };
    const f = fakeSource(12);
    const art = new SpecArt(r, 2);
    await art.preload(f.src, ids(12), true, plan(['s0', 's1'], ids(12), 0));
    await drain(art);
    expect(passes.length).toBeGreaterThan(3);
    expect(seen.size).toBeGreaterThan(5);
    const alive = [...seen].filter((id) => !disposed.has(id));
    expect(alive.length).toBe(1);
    art.dispose();
    expect([...seen].filter((id) => !disposed.has(id)).length).toBe(0);
    spy.mockRestore();
  });

  it('without a plan nothing is staged: the whole scope is awaited and baked at once (dev, galleries)', async () => {
    const { r } = fakeRenderer();
    const f = fakeSource(12);
    const art = new SpecArt(r, 2);
    await art.preload(f.src, ids(12), true);
    expect(f.loaded.length).toBe(12);
    expect(art.stats.sprites).toBe(12);
    expect(art.stats.pending).toBe(0);
    expect(art.streamStats().staged).toBe(false);
    art.pump(100);
    expect(art.streamStats().keys).toBe(0);
    // a plan on a non-replacing call is ignored (late loads of the gallery)
    const g = fakeSource(4);
    const art2 = new SpecArt(r, 2);
    await art2.preload(g.src, ids(4), false, plan(['s0'], [], 0));
    expect(g.loaded.length).toBe(4);
  });
});

// ------------------------------------------------------------------------------------------------ host

function host(): { h: SpecHost; passes: Pass[] } {
  const { r, passes } = fakeRenderer();
  const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
  return { h: new SpecHost(new Scene(), r, { value: 0 }, fx, 2, 10, []), passes };
}
const puff = (art: ParticleSpec['tex']): ElementSpec => ({ kind: 'particle', cycle: 0.5, max: 4, rate: [0, 120], life: [0, 1], half: [0, 0.3], color: [0, 0xffffff, 1], billboard: 'screen', blend: 'add', tex: art });
const spec = (id: string, elements: ElementSpec[]): FxSpec => ({ id, desc: id, behavior: 'selfBuff', ref: { family: 'test' }, size: 'radius', base: 2, dur: 1, elements });
/** the role the first element of the compiled spec `id` draws now (private state, read for the test) */
const roleOf = (h: SpecHost, id: string): number => ((h as unknown as { compiledById: Map<string, { els: { v: { role: number }[] }[] }> }).compiledById.get(id)?.els[0]?.v[0]?.role ?? -1);
const fallbackOf = (h: SpecHost, id: string): number => ((h as unknown as { compiledById: Map<string, { els: { v: { fallback: number }[] }[] }> }).compiledById.get(id)?.els[0]?.v[0]?.fallback ?? -1);

describe('staged art scope: SpecHost', () => {
  it('a SOON / LATE spec draws its fallback role until its art lands, then the sprite; NOW specs draw the sprite from the first frame', async () => {
    const { h } = host();
    const f = fakeSource(6);
    const a = spec('sk.a', [puff({ art: 's0', fallback: 'spark' })]);
    const b = spec('sk.b', [puff({ art: 's1', fallback: 'spark' })]);
    const c = spec('sk.c', [puff({ art: ['s2', 's3'], fallback: 'boltH' })]);
    for (const s of [a, b, c]) h.play(s, new Ctx(), false);
    await h.preloadArt(f.src, ['sk.a', 'sk.b', 'sk.c'], { now: ['sk.a'], soon: ['sk.b'], late: ['sk.c'] });
    expect(f.loaded).toEqual(['s0']);
    expect(roleOf(h, 'sk.a')).toBeGreaterThanOrEqual(65536);
    expect(roleOf(h, 'sk.b')).toBe(fallbackOf(h, 'sk.b'));
    expect(roleOf(h, 'sk.c')).toBe(fallbackOf(h, 'sk.c'));
    // the stream opens at ART_STREAM_AFTER_S of VFX time: before it nothing is fetched
    h.update(0.1);
    await tick();
    expect(f.loaded).toEqual(['s0']);
    for (let t = 0; t < ART_STREAM_AFTER_S + 1; t += 0.1) h.update(0.1);
    await tick();
    h.update(0.016);
    h.update(0.016);
    expect(f.loaded.sort()).toEqual(['s0', 's1', 's2', 's3']);
    // SOON streams before LATE (plan order)
    expect(roleOf(h, 'sk.b')).toBeGreaterThanOrEqual(65536);
    expect(roleOf(h, 'sk.c')).toBeGreaterThanOrEqual(65536);
  });

  it('a deferred spec that plays before the stream opens fetches its art at once, once, and switches to the sprite when it lands', async () => {
    const { h } = host();
    const f = fakeSource(6);
    const a = spec('sk.a', [puff({ art: 's0', fallback: 'spark' })]);
    const b = spec('sk.b', [puff({ art: 's1', fallback: 'spark' })]);
    h.play(a, new Ctx(), false);
    h.play(b, new Ctx(), false);
    await h.preloadArt(f.src, ['sk.a', 'sk.b'], { now: ['sk.a'], soon: [], late: ['sk.b'] });
    expect(f.loaded).toEqual(['s0']);
    h.play(b, new Ctx(), false);
    h.play(b, new Ctx(), false);
    expect(h.artStream().demanded).toBe(1);
    expect(roleOf(h, 'sk.b')).toBe(fallbackOf(h, 'sk.b')); // this cast draws the fallback
    await tick();
    expect(f.loaded).toEqual(['s0', 's1']);
    h.update(1 / 60); // pump blits it, syncArt re-resolves the element
    expect(roleOf(h, 'sk.b')).toBeGreaterThanOrEqual(65536);
    expect(h.art.stats.pending).toBe(0);
  });

  it('only the base grade of a NOW spec is awaited; its higher-grade sprites stream', async () => {
    const { h } = host();
    const f = fakeSource(4);
    const el = { ...puff({ art: 's0', fallback: 'spark' }), grade: { g2: { tex: { art: 's1', fallback: 'spark' } } } } as ElementSpec;
    h.play(spec('sk.a', [el]), new Ctx(), false);
    await h.preloadArt(f.src, ['sk.a'], { now: ['sk.a'], soon: [], late: [] });
    expect(f.loaded).toEqual(['s0']);
    expect(h.art.peek('s1')).toBeNull();
    expect(h.art.streamStats().queued).toBe(1);
  });

  it('without tiers the run awaits its whole scope as before (dev server)', async () => {
    const { h } = host();
    const f = fakeSource(4);
    h.play(spec('sk.a', [puff({ art: 's0' })]), new Ctx(), false);
    h.play(spec('sk.b', [puff({ art: 's1' })]), new Ctx(), false);
    await h.preloadArt(f.src, ['sk.a', 'sk.b']);
    expect(f.loaded.sort()).toEqual(['s0', 's1']);
    expect(h.art.stats.pending).toBe(0);
    expect(h.artStream().staged).toBe(false);
  });
});

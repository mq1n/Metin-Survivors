// telegraphs target: route (hook queue -> sprite-layer preset, rune tint, dormant event path) + the five presets run headless
// against a recording Fx (every builder call is counted, nothing is drawn).
import { afterEach, describe, expect, it } from 'vitest';
import { telegraphHook, type TelegraphBegin } from '../../../../render/fx/fallCue';
import { getMetinWarnTint, clearTelegraphArtCaches, METIN_FALLBACK_HEX, ELEMENT_HEX } from '../../../../render/fx/telegraphArt';
import type { SimEvent } from '../../../../sim/events';
import type { Fx } from '../../../emit';
import { PALETTES } from '../../../palette';
import { VRng } from '../../../util';
import type { SpawnOpts } from '../../../types';
import type { RouteCtx } from '../../route';
import { presets } from '../presets';
import { telegraphRoutes } from '../route';

interface Fired {
  id: string;
  o: SpawnOpts;
}

function harness(over: Partial<RouteCtx> = {}) {
  const fired: Fired[] = [];
  const ctx = {
    time: 0,
    density: 1,
    players: new Float32Array(12),
    heightAt: () => 0,
    resolve: () => null,
    o: (x: number, z: number, scale: number, dirX?: number, dirZ?: number) => ({ x, z, scale, dirX, dirZ }) as SpawnOpts,
    fire: (id: string, o: SpawnOpts) => {
      fired.push({ id, o: { ...o } });
      return 0;
    },
    spawnResolved: () => 0,
    stop: () => {},
    alive: () => false,
    once: () => true,
    since: () => Infinity,
    mark: () => {},
    deathPreset: () => undefined,
    metinRune: (def: string) => (def === 'metin_lament' ? 0x6aa8ff : 0x112233),
    bossPos: () => false,
    telegraphEvents: false,
    ...over,
  } as RouteCtx;
  const routes = telegraphRoutes();
  const send = (e: Partial<SimEvent> & { t: SimEvent['t'] }): Fired[] => {
    const n = fired.length;
    for (const r of routes) if (r.events.includes(e.t)) r.handle(e as SimEvent, ctx);
    return fired.slice(n);
  };
  const tick = (): Fired[] => {
    const n = fired.length;
    for (const r of routes) r.update?.(1 / 60, ctx);
    return fired.slice(n);
  };
  return { send, tick, ctx, routes };
}

const begin = (o: Partial<TelegraphBegin>): TelegraphBegin => ({
  owner: 1, shape: 0, x: 3, z: 4, rot: 0, radius: 3, length: 0, width: 0, element: 0, aux: 0, dur: 1.4, progress: 0, meteor: false, impact: false, ...o,
});

afterEach(() => {
  telegraphHook.onBegin = null;
  clearTelegraphArtCaches();
});

describe('telegraph route', () => {
  it('installs the render hook; started decals fire their sprite layer on the next frame (shape -> preset id)', () => {
    const h = harness();
    expect(typeof telegraphHook.onBegin).toBe('function');
    telegraphHook.onBegin!(begin({ shape: 0 }));
    telegraphHook.onBegin!(begin({ shape: 1, radius: 9, width: 0.9, rot: 1 }));
    telegraphHook.onBegin!(begin({ shape: 2, radius: 0, length: 12, width: 2.6 }));
    telegraphHook.onBegin!(begin({ shape: 3, radius: 7, length: 3, impact: true }));
    telegraphHook.onBegin!(begin({ shape: 0, radius: 2.4, meteor: true, impact: true }));
    expect(h.tick().map((f) => f.id)).toEqual(['telegraph.circle', 'telegraph.cone', 'telegraph.lane', 'telegraph.ring', 'telegraph.meteor']);
  });

  it('passes scale / angle / width / inner radius / impact flag / duration / colour', () => {
    const h = harness();
    telegraphHook.onBegin!(begin({ shape: 2, length: 12, width: 2.6, rot: 0.5, dur: 1.6, element: 2 }));
    telegraphHook.onBegin!(begin({ shape: 3, radius: 7, length: 3, impact: true, dur: 1.6, owner: 0, element: 1 }));
    const [lane, ring] = h.tick();
    expect(lane?.o.scale).toBe(12);
    expect(lane?.o.a).toBe(2.6);
    expect(lane?.o.duration).toBeCloseTo(1.6);
    expect(lane?.o.dirX).toBeCloseTo(Math.sin(0.5));
    expect(lane?.o.color).not.toBe(ring?.o.color);
    expect(ring?.o.scale).toBe(7);
    expect(ring?.o.a).toBe(3);
    expect(ring?.o.b).toBe(1);
    expect(ring?.o.color).toBe(ELEMENT_HEX[1]);
  });

  it('a decal that started late gets only the rest of the warning; unknown dur falls back per owner; too short = nothing', () => {
    const h = harness();
    telegraphHook.onBegin!(begin({ dur: 2, progress: 0.1 }));
    telegraphHook.onBegin!(begin({ dur: 0, owner: 2 }));
    telegraphHook.onBegin!(begin({ dur: 0.2 }));
    const f = h.tick();
    expect(f).toHaveLength(2);
    expect(f[0]?.o.duration).toBeCloseTo(1.8);
    expect(f[1]?.o.duration).toBeCloseTo(2.6);
  });

  it('the queue is bounded and drains', () => {
    const h = harness();
    for (let i = 0; i < 100; i++) telegraphHook.onBegin!(begin({ x: i }));
    const n = h.tick().length;
    expect(n).toBeLessThanOrEqual(24);
    expect(n).toBeGreaterThan(0);
    expect(h.tick()).toEqual([]);
  });

  it('metinWarn stores the def rune colour the decal reads (aux = metin id); unknown ids fall back to fire orange', () => {
    const h = harness();
    expect(getMetinWarnTint(7)).toBeUndefined();
    h.send({ t: 'metinWarn', metin: 7, def: 'metin_lament', x: 0, z: 0, dur: 2.6, great: false });
    expect(getMetinWarnTint(7)).toBe(0x6aa8ff);
    telegraphHook.onBegin!(begin({ owner: 2, aux: 7 }));
    telegraphHook.onBegin!(begin({ owner: 2, aux: 99 }));
    const [a, b] = h.tick();
    expect(a?.o.color).toBe(0x6aa8ff);
    expect(b?.o.color).toBe(METIN_FALLBACK_HEX);
  });

  it('dormant path: with telegraphEvents the sim event fires the preset and the live hook stays silent (never drawn twice)', () => {
    const h = harness({ telegraphEvents: true });
    expect(h.send({ t: 'telegraph', shape: 1, x: 0, z: 0, rot: 0, a: 3, b: 1, c: 0, dur: 1, source: 0 }).map((f) => f.id)).toEqual(['telegraph.cone']);
    telegraphHook.onBegin!(begin({}));
    expect(h.tick()).toEqual([]);
    const off = harness();
    expect(off.send({ t: 'telegraph', shape: 0, x: 0, z: 0, rot: 0, a: 3, b: 0, c: 0, dur: 1, source: 1 })).toEqual([]);
  });

  it('reset empties the queue', () => {
    const h = harness();
    telegraphHook.onBegin!(begin({}));
    for (const r of h.routes) r.reset?.();
    expect(h.tick()).toEqual([]);
  });
});

/** a recording Fx: every builder call chains, `emit` counts */
function recorder(): { fx: Fx; emitted: () => number; arts: string[] } {
  let n = 0;
  const arts: string[] = [];
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === 'emit') return () => (n++, 0);
      if (k === 'art') return (a: { id: string }) => (arts.push(a.id), chain);
      return () => chain;
    },
    apply: () => chain,
  });
  const fx = {
    rng: new VRng(7),
    add: chain,
    alp: chain,
    dec: chain,
    shp: chain,
    db: chain,
    rb: chain,
    detail: 2,
    density: 1,
    legacyKit: false,
    budget: 1e9,
    heightAt: () => 0,
    hasArt: () => true,
    artCell: () => 0,
    n: (c: number) => Math.round(c),
  } as unknown as Fx;
  return { fx, emitted: () => n, arts };
}

function ctx(o: { radius: number; duration: number; a?: number; b?: number; rot?: number }) {
  return { x: 1, y: 0, z: 2, dx: 0, dz: 1, rot: o.rot ?? 0, scale: o.radius, radius: o.radius, duration: o.duration, intensity: 1, seed: 3, tx: 0, ty: 0, tz: 0, hasTarget: false, a: o.a ?? 0, b: o.b ?? 0, hasDir: true, variant: -1, pal: { ...PALETTES.warn }, element: -1, tinted: false };
}

describe('telegraph presets', () => {
  const byId = new Map(presets.map((p) => [p.id, p]));
  it('keeps the five ids, category telegraph, radius sized', () => {
    expect([...byId.keys()].sort()).toEqual(['telegraph.circle', 'telegraph.cone', 'telegraph.lane', 'telegraph.meteor', 'telegraph.ring']);
    for (const p of presets) {
      expect(p.cat).toBe('telegraph');
      expect(p.size).toBe('radius');
      expect(p.loop).toBe(false);
    }
  });

  it('every preset fires headless and emits a bounded number of particles', () => {
    const cases: Array<[string, Parameters<typeof ctx>[0]]> = [
      ['telegraph.circle', { radius: 4.2, duration: 2.6, b: 1 }],
      ['telegraph.circle', { radius: 9, duration: 4, b: 1 }],
      ['telegraph.cone', { radius: 12, duration: 1.6, a: 1 }],
      ['telegraph.lane', { radius: 12, duration: 1.6, a: 2.6 }],
      ['telegraph.ring', { radius: 7, duration: 1.6, a: 3, b: 1 }],
      ['telegraph.meteor', { radius: 2.4, duration: 1.2, b: 1 }],
    ];
    for (const [id, c] of cases) {
      const r = recorder();
      byId.get(id)!.fire(r.fx, ctx(c) as never);
      expect(r.emitted(), id).toBeGreaterThan(4);
      expect(r.emitted(), id).toBeLessThan(260);
    }
  });

  it('the meteor drops rocks, a normal circle does not; scorch only when the resolve lands an impact', () => {
    const m = recorder();
    byId.get('telegraph.meteor')!.fire(m.fx, ctx({ radius: 2.4, duration: 1.2 }) as never);
    expect(m.arts).toContain('vfx_rock_chunk_facet_a');
    const c = recorder();
    byId.get('telegraph.circle')!.fire(c.fx, ctx({ radius: 4.2, duration: 2.6 }) as never);
    expect(c.arts).not.toContain('vfx_rock_chunk_facet_a');
    const withImpact = recorder();
    byId.get('telegraph.circle')!.fire(withImpact.fx, ctx({ radius: 4.2, duration: 2.6, b: 1 }) as never);
    const without = recorder();
    byId.get('telegraph.circle')!.fire(without.fx, ctx({ radius: 4.2, duration: 2.6, b: 0 }) as never);
    expect(withImpact.emitted()).toBeGreaterThan(without.emitted());
  });
});

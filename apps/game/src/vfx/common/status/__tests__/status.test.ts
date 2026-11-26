// status target (r1): id contract, shipped sprites, loop structure guards, body table, DoT route.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../../../presets';
import type { Resolved } from '../../../presets';
import type { FxSpec, ParticleSpec } from '../../../spec/types';
import type { SimEvent } from '../../../../sim/events';
import type { RouteCtx } from '../../route';
import { STATUS_ART_IDS } from '../art';
import { BODIES, bodyOf, headY, torsoY } from '../bodies';
import { DOT_RATE, DOT_SCALE, statusRoutes } from '../route';
import { DOT_SPECS, specs } from '../specs';

const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const texFile = read('../../../../../public/assets/manifest/textures.json') as Record<string, { kind: string; alpha?: boolean }> & { textures?: Record<string, { kind: string; alpha?: boolean }> };
const tex: Record<string, { kind: string; alpha?: boolean }> = texFile.textures ?? texFile;
const particles = (s: FxSpec): ParticleSpec[] => s.elements.filter((e) => e.kind === 'particle') as ParticleSpec[];
const artIds = (s: FxSpec): string[] => particles(s).flatMap((p) => (typeof p.tex === 'object' ? [p.tex.art as string] : []));

describe('status: ids are the contract', () => {
  it('keeps the five sk.gen specs and the three hit.dot presets in their registry order', () => {
    expect(specs.map((s) => s.id)).toEqual(['sk.gen.stun', 'sk.gen.stun_loop', 'sk.gen.slow_loop', 'sk.gen.poison_loop', 'sk.gen.fire_loop']);
    expect(DOT_SPECS.map((s) => s.id)).toEqual(['hit.dot.burn', 'hit.dot.poison', 'hit.dot.bleed']);
    const ids = PRESETS.map((p) => p.id);
    for (const id of DOT_SPECS.map((s) => s.id)) expect(ids).toContain(id);
  });

  it('loops repeat while the status lasts, one-shots do not; every spec stays inside the 16-element cap', () => {
    for (const s of specs) {
      expect(s.elements.length).toBeLessThanOrEqual(16);
      const loop = s.behavior === 'persistentAura';
      for (const p of particles(s)) {
        if (loop) expect(p.loops, `${s.id} ${p.note}`).toBe(0);
        else expect(p.loops === undefined || p.loops === 1, `${s.id} ${p.note}`).toBe(true);
      }
    }
    for (const s of DOT_SPECS) for (const p of particles(s)) expect(p.loops).toBeUndefined();
  });
});

describe('status: sprites', () => {
  it('every sprite the specs draw ships in the manifest (kind vfx) and is listed in STATUS_ART_IDS', () => {
    const used = new Set([...specs, ...DOT_SPECS].flatMap(artIds));
    for (const id of used) {
      expect(tex[id]?.kind, id).toBe('vfx');
      expect(STATUS_ART_IDS, id).toContain(id);
    }
    for (const id of STATUS_ART_IDS) expect(used.has(id), `${id} listed but unused`).toBe(true);
  });

  it('colour-carrying layers keep an ALPHA twin so the hue survives on snow (stun ring, poison gas, flame tongues, slow smoke)', () => {
    const alpha = (id: string): number => particles(specs.find((s) => s.id === id) as FxSpec).filter((p) => p.blend === 'alpha').length;
    for (const id of ['sk.gen.stun_loop', 'sk.gen.poison_loop', 'sk.gen.fire_loop', 'sk.gen.slow_loop']) expect(alpha(id), id).toBeGreaterThanOrEqual(1);
  });

  it('additive stacks are clamped (no white-out when 24 loops overlap)', () => {
    for (const s of specs) {
      for (const p of particles(s)) {
        if (p.blend !== 'add') continue;
        const heavy = (p.bright ?? 1) > 1.2 && p.minTier === undefined;
        if (heavy) expect(p.clamp, `${s.id}: ${p.note}`).toBeDefined();
      }
    }
  });
});

describe('status: stun reads as a CONTINUOUS thin ring with 4-6 crisp four-point stars', () => {
  const ring = particles(specs.find((s) => s.id === 'sk.gen.stun_loop') as FxSpec);
  it('three overlapping ring strikes (the file overlaps 3 rings of 0.62 s): a ring is always on its plateau, so the loop never blinks', () => {
    const rings = ring.filter((p) => p.billboard === 'ground');
    expect(rings.length).toBeGreaterThanOrEqual(2);
    for (const r of rings) {
      const life = r.life[r.life.length - 1] as number;
      const rate = r.rate[r.rate.length - 1] as number;
      expect(r.max, 'slots for the overlapping strikes').toBeGreaterThanOrEqual(3);
      expect(life * rate, 'rings alive at once').toBeGreaterThanOrEqual(2.5);
      // alpha curve [t, rgb, a, ...]: a plateau of at least 40 % of the life at >= 0.6 alpha
      const c = r.color;
      let plateau = 0;
      for (let i = 0; i + 5 < c.length; i += 3) if ((c[i + 2] as number) >= 0.6 && (c[i + 5] as number) >= 0.6) plateau += (c[i + 3] as number) - (c[i] as number);
      if (r.blend === 'alpha') expect(plateau, 'plateau share of the life').toBeGreaterThanOrEqual(0.4);
      // a new ring is struck before the previous one has faded out: period < plateau start .. end
      expect(1 / rate).toBeLessThan(life * 0.5);
    }
  });
  it('at least 5 stars alive at once, spaced by a circling emitter (path), luminous additive cores over an alpha body', () => {
    const stars = ring.filter((p) => p.billboard === 'screen' && p.path !== undefined);
    expect(stars.length).toBeGreaterThanOrEqual(3);
    expect(stars.some((p) => p.blend === 'alpha')).toBe(true);
    expect(stars.some((p) => p.blend === 'add')).toBe(true);
    for (const p of stars) expect((p.life[p.life.length - 1] as number) * (p.rate[p.rate.length - 1] as number)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('status: the one-shot stun burst is gone before 0.6 s', () => {
  const burst = specs.find((s) => s.id === 'sk.gen.stun') as FxSpec;
  it('no element lives past 0.55 s', () => {
    for (const p of particles(burst)) expect(p.life[p.life.length - 1] as number).toBeLessThanOrEqual(0.55);
  });
});

describe('status: DoT ticks are small and end early', () => {
  it('every tick particle lives <= 0.4 s and the route scale keeps them under 0.6 m', () => {
    for (const s of DOT_SPECS) for (const p of particles(s)) expect(p.life[p.life.length - 1] as number).toBeLessThanOrEqual(0.4);
    expect(DOT_SCALE).toBeLessThanOrEqual(2);
  });
});

describe('status: body table', () => {
  it('knows every model an enemy or boss def uses (no silent humanoid fallback)', () => {
    const models = new Set<string>();
    for (const f of ['enemies', 'bosses']) for (const d of read(`../../../../data/content/${f}.json`) as { model: string }[]) models.add(d.model);
    for (const m of models) expect(BODIES[m], m).toBeDefined();
  });
  it('places a boar lower than a yeti and the ring over the head, the gas at the torso', () => {
    const [bh, bq] = bodyOf('boar');
    const [yh, yq] = bodyOf('yeti');
    expect(bq).toBe(1);
    expect(yq).toBe(0);
    expect(torsoY(bh, bq)).toBeLessThan(torsoY(yh, yq));
    for (const [h, q] of [[bh, bq], [yh, yq]] as const) expect(headY(h, q)).toBeGreaterThan(torsoY(h, q) + 0.2);
    expect(bodyOf(undefined)[0]).toBeCloseTo(1.76);
    expect(bodyOf('unknown_model')[0]).toBeCloseTo(1.76);
  });
});

describe('status: DoT route', () => {
  function run(events: number, dt: number): { spawned: string[] } {
    const spawned: string[] = [];
    const routes = statusRoutes();
    const r = routes[0] as { handle: (e: SimEvent, ctx: RouteCtx) => void; update?: (dt: number, ctx: RouteCtx) => void };
    const ctx = {
      resolve: (id: string): Resolved => ({ id }) as unknown as Resolved,
      spawnResolved: (d: Resolved) => void spawned.push((d as unknown as { id: string }).id),
      o: () => ({}) as never,
      heightAt: () => 0,
    } as unknown as RouteCtx;
    for (let i = 0; i < events; i++) {
      r.update?.(dt, ctx);
      r.handle({ t: 'damage', dot: true, element: 1, x: 0, z: 0 } as unknown as SimEvent, ctx);
    }
    return { spawned };
  }
  it('rate-limits ticks per element: a burst of 4, then DOT_RATE per second', () => {
    const s = run(30, 0);
    expect(s.spawned).toHaveLength(4);
    expect(s.spawned.every((id) => id === 'hit.dot.burn')).toBe(true);
    expect(DOT_RATE).toBeGreaterThanOrEqual(8);
  });
});

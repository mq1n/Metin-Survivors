// Host limits of the spec runtime: the element limit (MAX_ELEMENTS, ONE exported constant) and the curve LUT budget that the generated
// families (up to 40 elements each, ~9 LUT rows per element) draw on. The GPU itself is not available: the atlas bake is stubbed.
import { readFileSync } from 'node:fs';
import { Scene, type WebGLRenderer } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ctx, type Fx } from '../emit';
import { PRESETS } from '../presets';
import { VRng } from '../util';
import { SpecHost } from '../spec/host';
import { MAX_ELEMENTS as PATCH_MAX } from '../spec/patch';
import { SPEC_REGISTRY } from '../spec/preset';
import { LUT_H, LUT_SAMPLES, LUT_W } from '../spec/shaders';
import { MAX_ELEMENTS, type FxSpec, type ParticleSpec } from '../spec/types';
import { ensureAllSkillVfx } from '../skills/loader';

// the class specs are lazy chunks (vfx/skills/loader.ts): load them all before this file reads the registry
await ensureAllSkillVfx();

vi.mock('../spec/atlas', () => ({ bakeSpecAtlas: () => ({ texture: null, dispose: () => undefined }) }));

const el = (i: number, extra: Partial<ParticleSpec> = {}): ParticleSpec => ({
  kind: 'particle',
  key: `e#${i}`,
  cycle: 1,
  max: 1,
  rate: [0, 600],
  life: [0, 1],
  half: [0, 0.3],
  // a distinct colour per element: no two elements share LUT rows
  color: [0, 0x400000 + i * 0x101, 1, 1, 0x400000 + i * 0x101, 0],
  billboard: 'screen',
  blend: 'add',
  tex: 'glow',
  ...extra,
});

const spec = (n: number, impact = 0): FxSpec => ({
  id: `sk.limit${n}`,
  desc: 'test',
  behavior: 'selfBuff',
  ref: {},
  size: 'radius',
  base: 2,
  dur: 1,
  elements: Array.from({ length: n }, (_, i) => el(i)),
  ...(impact > 0 ? { impact: Array.from({ length: impact }, (_, i) => el(100 + i)) } : {}),
});

function host(specs: readonly FxSpec[] = []): { h: SpecHost; fx: Fx } {
  const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
  return { h: new SpecHost(new Scene(), {} as WebGLRenderer, { value: 0 }, fx, 3, 10, specs), fx };
}

interface Priv {
  pAdd: { used: number };
  lutNext: number;
  insts: Record<string, unknown>[];
  compile(s: FxSpec): { els: unknown[]; impact: { els: unknown[] } | null };
}

/** plays `s` once for 12 frames and returns the number of particle records (every element emits exactly one: max 1, life 1) */
function played(s: FxSpec): number {
  const { h, fx } = host();
  h.play(s, new Ctx(), false);
  for (let i = 0; i < 12; i++) {
    fx.time += 1 / 60;
    h.update(1 / 60);
  }
  return (h as unknown as Priv).pAdd.used;
}

afterEach(() => vi.restoreAllMocks());

describe('element limit (C4)', () => {
  it('is ONE exported constant: 40, defined in spec/types.ts, re-exported by spec/patch.ts, read by host.ts', () => {
    expect(MAX_ELEMENTS).toBe(40);
    expect(PATCH_MAX).toBe(MAX_ELEMENTS);
    const src = readFileSync(new URL('../spec/host.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/const MAX_EL = MAX_ELEMENTS;/);
    expect(src).not.toMatch(/const MAX_EL = \d/);
    const patch = readFileSync(new URL('../spec/patch.ts', import.meta.url), 'utf8');
    expect(patch).not.toMatch(/MAX_ELEMENTS = \d/);
  });

  it('a 17..40 element list compiles and plays EVERY element (the old limit dropped everything past 16)', () => {
    for (const n of [16, 17, 24, 38, MAX_ELEMENTS]) {
      expect(played(spec(n)), `${n} elements`).toBe(n);
    }
  });

  it('the impact list has the same limit', () => {
    const { h } = host();
    const c = (h as unknown as Priv).compile(spec(3, MAX_ELEMENTS));
    expect(c.els).toHaveLength(3);
    expect(c.impact?.els).toHaveLength(MAX_ELEMENTS);
  });

  it('past the limit the rest is cut WITH a console warning naming the spec (never silently)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(played(spec(MAX_ELEMENTS + 1))).toBe(MAX_ELEMENTS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(`sk.limit${MAX_ELEMENTS + 1}`);
    warn.mockClear();
    played(spec(MAX_ELEMENTS));
    expect(warn).not.toHaveBeenCalled();
  });

  it('per-instance emitter state is sized for the limit (355 bytes per element measured 2026-10-26 = 14.2 kB per instance, pool of 255 = 3.6 MB)', () => {
    const { h } = host();
    const inst = (h as unknown as Priv).insts[0] as Record<string, unknown>;
    let bytes = 0;
    for (const v of Object.values(inst)) if (ArrayBuffer.isView(v)) bytes += v.byteLength;
    expect(bytes / MAX_ELEMENTS).toBeGreaterThan(300); // the ring of 64 death times alone is 256 B per element
    expect(bytes / MAX_ELEMENTS).toBeLessThan(420); // a new per-element field must be weighed against the pool of 255 (README Limits to know)
    expect((h as unknown as Priv).insts).toHaveLength(255);
  });
});

describe('curve LUT budget', () => {
  const rowsOf = (specs: readonly FxSpec[]): number => (host(specs).h as unknown as Priv).lutNext;

  it('is 16384 rows (256 x 4096 half-float texels, 4 curves per texel row)', () => {
    expect((LUT_W / LUT_SAMPLES) * LUT_H).toBe(16384);
  });

  it('elements with equal curves share their rows host-wide', () => {
    const one = rowsOf([spec(1)]);
    const same: FxSpec = { ...spec(1), id: 'sk.other', elements: [el(0), el(0)] };
    expect(rowsOf([same])).toBe(one);
    expect(rowsOf([spec(1), same])).toBe(one);
    expect(rowsOf([spec(2)])).toBe(one * 2);
  });

  it('the whole registry (hand specs, commons, live families) stays under 90 % of the LUT (a spec past 100 % is not compiled and draws nothing; ~63 live families project to ~80 %)', () => {
    void PRESETS.length;
    const rows = rowsOf(SPEC_REGISTRY);
    expect(rows).toBeGreaterThan(1000);
    expect(rows).toBeLessThanOrEqual(0.9 * (LUT_W / LUT_SAMPLES) * LUT_H);
  });
});

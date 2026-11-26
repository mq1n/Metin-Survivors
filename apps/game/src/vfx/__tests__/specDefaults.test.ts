// A draft spec that leaves optional (or even required) fields out must still bake: one incomplete element in any class
// file may never break the LUT bake that every gallery and the game boot run through.
import { describe, expect, it } from 'vitest';
import { PARTICLE_ROWS, SURFACE_ROWS, bakeParticle, bakeSurface, withDefaults } from '../spec/curves';
import { LUT_SAMPLES } from '../spec/shaders';
import type { ElementSpec, ParticleSpec, SurfaceSpec } from '../spec/types';

const finite = (a: Float32Array): boolean => a.every((v) => Number.isFinite(v));

describe('spec element defaults', () => {
  it('bakes a particle with only the required fields (no scale: constant 1)', () => {
    const el: ParticleSpec = { kind: 'particle', cycle: 0.5, max: 4, rate: [0, 10], life: [0, 0.4], half: [0, 0.3], color: [0, 0xff8800, 1], billboard: 'screen', blend: 'add', tex: 'glow' };
    const out = new Float32Array(LUT_SAMPLES * 4 * PARTICLE_ROWS);
    bakeParticle(el, out, 0);
    expect(finite(out)).toBe(true);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(1);
  });

  it('fills every field a broken draft leaves out', () => {
    const broken = { kind: 'particle', cycle: 0, max: 0, tex: 'noSuchRole' } as unknown as ElementSpec;
    const el = withDefaults(broken) as ParticleSpec;
    expect(el.tex).toBe('glow');
    expect(el.cycle).toBeGreaterThan(0);
    expect(el.max).toBeGreaterThanOrEqual(1);
    expect(el.scale).toEqual([0, 1]);
    expect(el.billboard).toBe('screen');
    expect(el.blend).toBe('add');
    const out = new Float32Array(LUT_SAMPLES * 4 * PARTICLE_ROWS);
    bakeParticle(el, out, 0);
    expect(finite(out)).toBe(true);
    expect(out[3 + LUT_SAMPLES * 4 + 4 * 10]).toBe(1); // white, opaque colour row
  });

  it('bakes a surface with only shape / life', () => {
    const broken = { kind: 'surface', life: 0, shape: { kind: 'card', w: 1, h: 1 } } as unknown as ElementSpec;
    const el = withDefaults(broken) as SurfaceSpec;
    expect(el.life).toBeGreaterThan(0);
    const out = new Float32Array(LUT_SAMPLES * 4 * SURFACE_ROWS);
    bakeSurface(el, out, 0);
    expect(finite(out)).toBe(true);
  });
});

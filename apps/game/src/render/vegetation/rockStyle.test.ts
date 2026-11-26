// Zones core A2: the pure rock-style helpers (per-kind style, group key, C1 lift override, stone tuning).
import { describe, expect, it } from 'vitest';
import type { CliffStyle, RockLook } from '../terrain/look/types';
import { rockGroupKey, rockLift, rockStyleFor, rockTune } from './rockStyle';

const SKY: [number, number, number] = [0.5, 0.6, 0.7];

describe('rockStyleFor', () => {
  it('is undefined without a look or without style blocks (the old shading)', () => {
    expect(rockStyleFor(undefined, 'boulder')).toBeUndefined();
    expect(rockStyleFor({}, 'boulder')).toBeUndefined();
    expect(rockStyleFor({ tex: { boulder: 'tex_x' }, relief: 2 }, 'boulder')).toBeUndefined();
  });

  it('merges the per-kind block over `all`', () => {
    const look: RockLook = { all: { dirt: 0.3, normal: 1.2 }, kind: { boulder: { dirt: 0.7, tint: '#ccc' } } };
    expect(rockStyleFor(look, 'boulder')).toEqual({ dirt: 0.7, normal: 1.2, tint: '#ccc' });
    expect(rockStyleFor(look, 'outcrop')).toEqual({ dirt: 0.3, normal: 1.2 });
  });
});

describe('rockGroupKey', () => {
  it('is the bare texture id without a style, and splits groups on any style difference', () => {
    expect(rockGroupKey('tex_a', undefined)).toBe('tex_a');
    const a = rockGroupKey('tex_a', { dirt: 0.3, tint: '#fff' });
    expect(rockGroupKey('tex_a', { tint: '#fff', dirt: 0.3 })).toBe(a);
    expect(rockGroupKey('tex_a', { dirt: 0.4, tint: '#fff' })).not.toBe(a);
    expect(rockGroupKey('tex_b', { dirt: 0.3, tint: '#fff' })).not.toBe(a);
  });
});

describe('rockLift (C1 lift with the group override)', () => {
  const cliff: CliffStyle = { floor: 0.34, aoMin: 0.84, rimFill: 0.14 };

  it('without a style it is exactly the old lift: the cliff knobs, none when there is no cliff block', () => {
    expect(rockLift(cliff, undefined, SKY)).toEqual({ floor: 0.34, aoMin: 0.84, rimFill: 0.14, sky: SKY });
    expect(rockLift(undefined, undefined, SKY)).toBeNull();
    expect(rockLift({ stainAmp: 0.1 }, undefined, SKY)).toBeNull();
  });

  it('a group value replaces the cliff value field by field', () => {
    expect(rockLift(cliff, { floor: 0.08, aoMin: 0.45 }, SKY)).toEqual({ floor: 0.08, aoMin: 0.45, rimFill: 0.14, sky: SKY });
  });

  it('a group can lift on its own when the zone has no cliff block, and switch the lift off with zeros', () => {
    expect(rockLift(undefined, { aoMin: 0.5 }, SKY)).toEqual({ floor: 0, aoMin: 0.5, rimFill: 0, sky: SKY });
    expect(rockLift(cliff, { floor: 0, aoMin: 0, rimFill: 0 }, SKY)).toBeNull();
  });
});

describe('rockTune', () => {
  it('is null (old shader path) unless contrast / dirt / normal is asked for', () => {
    expect(rockTune(undefined)).toBeNull();
    expect(rockTune({ tint: '#fff', scale: 1.2, floor: 0.1 })).toBeNull();
    expect(rockTune({ dirt: 0.5 })).toEqual({ contrast: 1, dirt: 0.5, normal: 0.9, saturation: 1 });
    expect(rockTune({ saturation: 0.6 })).toEqual({ contrast: 1, dirt: 0, normal: 0.9, saturation: 0.6 });
    expect(rockTune({ contrast: 1.3, normal: 1.5 })).toEqual({ contrast: 1.3, dirt: 0, normal: 1.5, saturation: 1 });
  });

  it('settle: `geo` asks for face-normal triplanar weights, and only when set', () => {
    expect(rockTune({ geo: true })).toEqual({ contrast: 1, dirt: 0, normal: 0.9, saturation: 1, geo: true });
    expect(rockTune({ dirt: 0.5, geo: false })).toEqual({ contrast: 1, dirt: 0.5, normal: 0.9, saturation: 1 });
    expect(rockTune({ geo: false })).toBeNull();
  });
});

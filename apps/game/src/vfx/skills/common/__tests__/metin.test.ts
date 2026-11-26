import { describe, expect, it } from 'vitest';
import { METIN_LOOP_SETS, METIN_SPECS, metinLoopId, type MetinLoopStage } from '../metin';
import metins from '../../../../data/content/metins.json';

const ids = new Set(METIN_SPECS.map((s) => s.id));
const STAGES: MetinLoopStage[] = [1, 2, 3, 4];
const setOf = (rgb: number): string => metinLoopId(rgb, 4).replace(/^sk\.gen\.metin_loop4\.?/, '') || 'green';

describe('metin loop specs', () => {
  it('registers every colour set x stage as a persistent aura', () => {
    for (const set of METIN_LOOP_SETS)
      for (const stage of STAGES) {
        const id = set === 'green' ? `sk.gen.metin_loop${stage}` : `sk.gen.metin_loop${stage}.${set}`;
        const spec = METIN_SPECS.find((s) => s.id === id);
        expect(spec?.behavior, id).toBe('persistentAura');
      }
  });

  it('metinLoopId only returns registered ids', () => {
    for (let h = 0; h < 4096; h++) {
      const rgb = ((h >> 8) & 15) * 0x110000 + ((h >> 4) & 15) * 0x1100 + (h & 15) * 0x11;
      for (const stage of STAGES) expect(ids.has(metinLoopId(rgb, stage)), rgb.toString(16)).toBe(true);
    }
    for (const m of metins as Array<{ rune: string }>) expect(ids.has(metinLoopId(parseInt(m.rune.slice(1), 16), 1))).toBe(true);
  });

  it('maps the game rune hints to sensible colour sets', () => {
    expect(setOf(0x6aa8ff)).toBe('blue');
    expect(setOf(0xff8a3a)).toBe('orange');
    expect(setOf(0xff4a3a)).toBe('whitered');
    expect(setOf(0xffd23a)).toBe('yellow');
    expect(setOf(0xb060ff)).toBe('purple');
    expect(setOf(0x8a60ff)).toBe('purple');
    expect(setOf(0xff5a2a)).toBe('whitered');
    expect(setOf(0x6fe05a)).toBe('green');
    expect(setOf(0xff2a4a)).toBe('whitered');
    expect(setOf(0xffe08a)).toBe('yellow');
    expect(['blue', 'aqua']).toContain(setOf(0x9ad0ff));
    expect(setOf(0x7ae0ff)).toBe('aqua');
    expect(setOf(0xf244ca)).toBe('pink');
    expect(setOf(0x8a8ab0)).toBe('whitepurple');
    expect(setOf(0xffffff)).toBe('whitepurple');
  });

  it('keeps the stage in the id', () => {
    expect(metinLoopId(0x6fe05a, 1)).toBe('sk.gen.metin_loop1');
    expect(metinLoopId(0x6aa8ff, 3)).toBe('sk.gen.metin_loop3.blue');
  });
});

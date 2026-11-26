import { describe, expect, it } from 'vitest';
import metins from '../../data/content/metins.json';
import { fitDistance, hash32, inkDelay, inkWords, INK_MAX, mixHex, rng, runeTint, sigilOf } from './storyArt';

describe('story art helpers', () => {
  it('mixHex returns a plain hex between its ends', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#d9c89c', '#3cd08a', 0.14)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('hash and rng are stable', () => {
    expect(hash32('metin_avarice')).toBe(hash32('metin_avarice'));
    expect(hash32('a')).not.toBe(hash32('b'));
    const a = rng(7);
    const b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('every metin has its own sigil, and the same metin the same one', () => {
    const list = (metins as { id: string; great?: boolean }[]).map((m) => ({ id: m.id, g: Boolean(m.great) }));
    expect(list.length).toBeGreaterThanOrEqual(16);
    const seen = new Set<string>();
    for (const m of list) {
      const s = sigilOf(m.id, m.g);
      expect(sigilOf(m.id, m.g)).toEqual(s);
      expect(s.nodes.length).toBeGreaterThanOrEqual(m.g ? 7 : 5);
      expect(s.strokes.length).toBeGreaterThan(20);
      seen.add(s.strokes + s.arcs.join(''));
      expect(s.inner > 0).toBe(m.g);
    }
    expect(seen.size).toBe(list.length);
  });

  it('pale and strong greens do not collapse into one tint', () => {
    const jealousy = runeTint('#3cd08a');
    const death = runeTint('#b8f0c8');
    expect(death.sat).toBeLessThan(jealousy.sat - 0.25);
    expect(death.bri).toBeGreaterThan(jealousy.bri + 0.1);
    expect(death.on).toBe('#1a0a04');
    expect(Math.abs(runeTint('#ff9a2e').rot)).toBeLessThanOrEqual(4);
    expect(runeTint(null).hex).toBe('#ff9a2e');
    expect(runeTint('nonsense').hex).toBe('#ff9a2e');
  });

  it('camera distance grows with a wide or tall subject and a narrow view', () => {
    const near = fitDistance(1.3, 1.6, 30, 0.8);
    expect(fitDistance(2.6, 1.6, 30, 0.8)).toBeGreaterThan(near);
    expect(fitDistance(1.3, 3.2, 30, 0.8)).toBeGreaterThan(near);
    expect(fitDistance(1.3, 1.6, 30, 0.4)).toBeGreaterThan(near);
  });

  it('ink-in reveal stays short for long paragraphs', () => {
    expect(inkWords('  one two   three ')).toEqual(['one', 'two', 'three']);
    expect(inkDelay(0, 10)).toBe(0);
    expect(inkDelay(59, 60)).toBeLessThanOrEqual(INK_MAX);
    expect(inkDelay(3, 10)).toBeGreaterThan(inkDelay(2, 10));
  });
});

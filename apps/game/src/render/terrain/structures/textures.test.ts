// Payload policy of the structures system (ARCHITECTURE §11): a zone downloads only the textures its walls, bridges and
// procedural props sample (Yeonmu used to fetch the Seori frozen-rock and Daeryeol basalt stones it never draws).
import { describe, expect, it } from 'vitest';
import { neededTextures } from './index';

const noGlb = (): boolean => false;
const allGlb = (): boolean => true;

describe('structures neededTextures', () => {
  it('walls and bridges bring wood, bark and only their own zone stone', () => {
    expect([...neededTextures([], 'yeonmu', true, allGlb)].sort()).toEqual(['tex_bark_oak', 'tex_rock_mossy', 'tex_wood_plank']);
    expect(neededTextures([], 'suryeon', true, allGlb)).toContain('tex_rock_mossy');
    expect(neededTextures([], 'seori', true, allGlb)).toContain('tex_rock_frozen');
    expect(neededTextures([], 'seori', true, allGlb)).not.toContain('tex_basalt');
    expect(neededTextures([], 'daeryeol', true, allGlb)).toContain('tex_basalt');
    for (const zone of ['yeonmu', 'suryeon']) {
      const t = neededTextures([], zone, true, allGlb);
      expect(t).not.toContain('tex_rock_frozen');
      expect(t).not.toContain('tex_basalt');
    }
  });

  it('a zone without walls and bridges loads none of them', () => {
    expect(neededTextures([], 'yeonmu', false, allGlb)).toEqual([]);
  });

  it('a prop with a Forge GLB does not fetch its procedural builder textures (only the fallback path does)', () => {
    // barrel / crate declare wood planks, urn the mossy rock: all three have GLBs in the manifest
    expect(neededTextures(['barrel', 'crate', 'urn'], 'yeonmu', false, allGlb)).toEqual([]);
    const fallback = neededTextures(['barrel', 'urn'], 'yeonmu', false, noGlb);
    expect([...fallback].sort()).toEqual(['tex_rock_mossy', 'tex_wood_plank']);
    // only the props without a GLB count
    expect(neededTextures(['barrel', 'urn'], 'yeonmu', false, (id) => id === 'urn')).toEqual(['tex_wood_plank']);
  });

  it('never asks for a normal map: texture ids only (the caller no longer loads any)', () => {
    for (const zone of ['yeonmu', 'suryeon', 'seori', 'daeryeol']) {
      for (const t of neededTextures(['barrel', 'well', 'totem', 'stele'], zone, true, noGlb)) expect(t.endsWith('_n')).toBe(false);
    }
  });
});

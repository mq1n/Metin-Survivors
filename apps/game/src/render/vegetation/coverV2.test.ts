// Zones core C4 (cover v2 + per-zone tree look): CPU-side resolution and back-compat. The GLSL itself is exercised by the

import { Color, DataTexture, Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { CoverSpec } from '../../world/layoutTypes';
import { coverV2, planGrid, planRing } from './cover';
import { createCoverMaterial, type CoverV2 } from './coverMaterial';
import { withTreeLook, type SpeciesAssets } from './trees';
import { vegQuality } from './types';

const SPEC: CoverSpec = { tex: 'tex_fol_grass_1', density: 1.2, size: [0.5, 0.85], layers: [1, 0.5], tintVar: 0.25, far: true };

describe('cover v2 knob resolution', () => {
  it('a spec without v2 knobs and a zone without cover.cards / splay stay legacy (null)', () => {
    expect(coverV2(SPEC, undefined, 0)).toBeNull();
    // grade / density are zone-wide colour / count knobs, not a shape change
    expect(coverV2(SPEC, { grade: [0.9, 0.9, 0.8], density: 0.5 }, 0)).toBeNull();
  });

  it('zone cards / splay switch on the splayed fan with defaults', () => {
    const r = coverV2(SPEC, { cards: 6 }, 2);
    expect(r?.v2.fan).toBe(true);
    expect(r?.fanCards).toBe(6);
    expect(r?.v2.splay).toBeCloseTo(0.45);
    expect(r?.v2.jitter).toBe(-1);
    expect(r?.v2.clump).toBeNull();
    expect(r?.v2.atlas).toEqual([1, 1]);
    const s = coverV2(SPEC, { splay: 0.3 }, 0);
    expect(s?.v2.fan).toBe(true);
    expect(s?.fanCards).toBe(5);
    // spec wins over zone; card count clamped to 2..8
    expect(coverV2({ ...SPEC, cards: 12, splay: 0.2 }, { cards: 3, splay: 0.6 }, 0)).toMatchObject({ fanCards: 8, v2: { splay: 0.2 } });
    // face alone turns the fan on; default 1 (camera-facing cards)
    expect(coverV2({ ...SPEC, face: 1 }, undefined, 0)).toMatchObject({ fanCards: 5, v2: { fan: true, face: 1 } });
    expect(s?.v2.face).toBe(1);
    expect(coverV2({ ...SPEC, face: 0 }, undefined, 0)?.v2.face).toBe(0);
  });

  it('placement / shape knobs alone keep the crossed quads', () => {
    const r = coverV2({ ...SPEC, clump: { scale: 9, lo: 0.5, hi: 0.62 }, jitter: 0.7, variants: [2, 2], lean: 0.3, heightVar: 0.4 }, undefined, 3) as { v2: CoverV2 };
    expect(r.v2.fan).toBe(false);
    expect(r.v2.clump).toEqual({ scale: 9, lo: 0.5, hi: 0.62, seed: 3 });
    expect(r.v2.jitter).toBeCloseTo(0.7);
    expect(r.v2.atlas).toEqual([2, 2]);
    expect(r.v2.lean).toBeCloseTo(0.3);
    expect(r.v2.heightVar).toBeCloseTo(0.4);
    expect(coverV2({ ...SPEC, variants: 3 }, undefined, 0)?.v2.atlas).toEqual([3, 1]);
    expect(coverV2({ ...SPEC, lean: 0.2 }, undefined, 0)?.v2.jitter).toBe(-1);
  });

  it('clump: explicit seed shared, degenerate lo == hi nudged, lo > hi kept (inverted gate)', () => {
    expect(coverV2({ ...SPEC, clump: { scale: 8, lo: 0.5, hi: 0.62, seed: 7 } }, undefined, 4)?.v2.clump?.seed).toBe(7);
    const flat = coverV2({ ...SPEC, clump: { scale: 8, lo: 0.5, hi: 0.5 } }, undefined, 0)?.v2.clump;
    expect(flat && flat.hi - flat.lo).toBeGreaterThan(0);
    const inv = coverV2({ ...SPEC, clump: { scale: 8, lo: 0.62, hi: 0.5 } }, undefined, 0)?.v2.clump;
    expect(inv?.lo).toBeGreaterThan(inv?.hi ?? 1);
  });
});

describe('cover candidate plans', () => {
  it('legacy ring plan is unchanged and carries sub = 1', () => {
    const p = planRing(1.2, 28, 1, 4);
    expect(p).toMatchObject({ grid: 46, perCell: 2, sub: 1 });
    expect(p.cell).toBeCloseTo(Math.sqrt(2 / 1.2));
    expect(p.count).toBe(46 * 46 * 2);
  });

  it('stratified plan: one candidate per sub-cell, expected density preserved', () => {
    for (const d of [0.012, 0.13, 0.6, 1.2, 3, 7]) {
      for (const [lo, hi] of [[0.35, 4], [3, 6]] as const) {
        const p = planGrid(d, 28, lo, hi);
        expect(p.perCell).toBe(p.sub * p.sub);
        const step = p.cell / p.sub;
        // survivors per m² = keep / step² (capped at one per sub-cell)
        expect(p.keep / (step * step)).toBeCloseTo(Math.min(d, 1 / (step * step)), 6);
        expect(p.keep).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('cover material program', () => {
  const params = {
    map: new Texture(),
    height: new DataTexture(new Uint16Array(4), 2, 2),
    mask: new DataTexture(new Uint8Array(4), 2, 2),
    heightBase: 0,
    domain: 400,
    heightN: 401,
    size: [0.5, 0.85] as [number, number],
    aspect: 1,
    tint: new Color('#ffffff'),
    tintVar: 0.2,
    sway: 1,
    seed: 1,
    focus: new Vector3(),
  };
  const fakeShader = () => ({
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\nvoid main() {\n#include <uv_vertex>\n#include <beginnormal_vertex>\n#include <begin_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main() {\n#include <map_fragment>\n#include <color_fragment>\n#include <normal_fragment_begin>\n}',
  });

  it('legacy params compile the legacy body under the legacy program key', () => {
    const { material } = createCoverMaterial(params);
    expect(material.customProgramCacheKey()).toBe('vegCover');
    const sh = fakeShader();
    material.onBeforeCompile(sh as never, undefined as never);
    expect(sh.vertexShader).not.toContain('coverClump');
    expect(sh.vertexShader).toContain('float clump = 0.9');
    expect(sh.uniforms.uShape).toBeUndefined();
  });

  it('v2 params compile BODY_V2 under its own program key with the knob uniforms', () => {
    const v2: CoverV2 = { fan: true, splay: 0.5, face: 0.6, lean: 0.2, heightVar: 0.3, jitter: 0.7, clump: { scale: 9, lo: 0.5, hi: 0.62, seed: 2 }, atlas: [2, 2] };
    const { material } = createCoverMaterial({ ...params, v2 });
    expect(material.customProgramCacheKey()).toBe('vegCover2');
    const sh = fakeShader();
    material.onBeforeCompile(sh as never, undefined as never);
    expect(sh.vertexShader).toContain('coverClump');
    expect(sh.uniforms.uShape?.value).toEqual([1, 0.5, 0.2, 0.3]);
    expect(sh.uniforms.uClump?.value).toEqual([9, 0.5, 0.62, 1]);
    expect(sh.uniforms.uAtlas?.value).toEqual([2, 2]);
    expect(sh.uniforms.uJitter?.value).toBeCloseTo(0.7);
    expect(sh.uniforms.uFace?.value).toBeCloseTo(0.6);
  });
});

describe('per-zone tree look', () => {
  const base: SpeciesAssets = {
    bark: 'tex_bark_oak',
    fol: ['tex_fol_autumn', 'tex_fol_broadleaf'],
    look: { grade: [0.88, 0.84, 0.8], barkGrade: [0.95, 0.85, 0.78], translucency: 0.5, snow: 0, ember: 0 },
  };

  it('no override returns the species assets themselves', () => {
    expect(withTreeLook(base, undefined)).toBe(base);
  });

  it('merges key by key and ignores undefined keys', () => {
    const r = withTreeLook(base, { grade: [1, 0.55, 0.3], translucency: undefined, snow: 0.2 });
    expect(r.look).toEqual({ grade: [1, 0.55, 0.3], barkGrade: [0.95, 0.85, 0.78], translucency: 0.5, snow: 0.2, ember: 0 });
    expect(r.fol).toBe(base.fol);
    expect(r.bark).toBe('tex_bark_oak');
    expect(base.look.grade).toEqual([0.88, 0.84, 0.8]);
    expect(withTreeLook(base, { fol: ['tex_fol_yeonmu_autumn', null] }).fol).toEqual(['tex_fol_yeonmu_autumn', null]);
  });
});

describe('vegetation tiers', () => {
  it('fan card cap grows with the tier', () => {
    const caps = (['low', 'medium', 'high', 'ultra'] as const).map((tier) => vegQuality({ tier } as never).coverFanMax);
    expect(caps).toEqual([3, 4, 6, 8]);
  });
});

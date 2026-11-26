
// and tone maps it. Additive elements flagged `space: 'display'` are drawn after the final composite. This pins the CPU side:
// which spec / element lands in which batch, the post pipeline contract (beginScene / drawOverlay), the sprite gain table and
// the shader contract (the display branch must not tone map, must clamp per element and must be fed by the same defines the
// batches set). The GPU itself is not available: the atlas bake is stubbed and the renderer is a recorder.
import { readFileSync } from 'node:fs';
import { Scene, type Camera, type Texture, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Ctx, type Fx } from '../emit';
import { VRng } from '../util';
import { ART_GAIN } from '../spec/artGain';
import { artKey } from '../spec/artScope';
import { artGain, defaultSpace, displayLayer, resolveSpace } from '../spec/display';
import { SpecHost } from '../spec/host';
import { SPEC_PARTICLE_FRAG, SPEC_SURFACE_FRAG } from '../spec/shaders';
import type { ElementSpec, FxSpec, ParticleSpec, SurfaceSpec } from '../spec/types';

vi.mock('../spec/atlas', () => ({ bakeSpecAtlas: () => ({ texture: null, dispose: () => undefined }) }));

const particle = (extra: Partial<ParticleSpec> = {}): ParticleSpec => ({
  kind: 'particle',
  cycle: 1,
  max: 16,
  rate: [0, 60],
  life: [0, 1],
  half: [0, 0.3],
  color: [0, 0xffffff, 1],
  billboard: 'screen',
  blend: 'add',
  tex: 'glow',
  ...extra,
});

const surface = (extra: Partial<SurfaceSpec> = {}): SurfaceSpec => ({
  kind: 'surface',
  life: 1,
  shape: { kind: 'card', w: 1, h: 1 },
  color: [0, 0xffffff, 1],
  blend: 'add',
  tex: 'glow',
  ...extra,
});

function spec(id: string, elements: ElementSpec[], extra: Partial<FxSpec> = {}): FxSpec {
  return { id, desc: 'test', behavior: 'selfBuff', ref: {}, size: 'radius', base: 2, dur: 1, elements, ...extra };
}

interface Priv {
  pAdd: { used: number };
  pAlpha: { used: number };
  sAdd: { used: number };
  pAddD: { used: number; mesh: { visible: boolean }; f: Float32Array };
  sAddD: { used: number; mesh: { visible: boolean } };
}

function makeHost(): { h: SpecHost; fx: Fx; p: Priv } {
  const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
  const h = new SpecHost(new Scene(), {} as WebGLRenderer, { value: 0 }, fx, 3, 10, []);
  return { h, fx, p: h as unknown as Priv };
}

/** plays `s` for a few frames and returns the number of records each batch holds */
function run(s: FxSpec, setup?: (h: SpecHost) => void): { pAdd: number; pAddD: number; sAdd: number; sAddD: number; pAlpha: number; h: SpecHost; p: Priv } {
  const { h, fx, p } = makeHost();
  setup?.(h);
  h.play(s, new Ctx(), false);
  for (let i = 0; i < 12; i++) {
    fx.time += 1 / 60;
    h.update(1 / 60);
  }
  return { pAdd: p.pAdd.used, pAddD: p.pAddD.used, sAdd: p.sAdd.used, sAddD: (p as unknown as { sAddD: { used: number } }).sAddD.used, pAlpha: p.pAlpha.used, h, p };
}

describe('blend space of a spec / element (display.ts resolveSpace)', () => {
  it('converter drafts blend in display space, every registered hand spec stays linear until it opts in', () => {
    expect(defaultSpace(spec('sk.raw_91_g3', []))).toBe('display');
    expect(defaultSpace(spec('sk.raw_91_g3.cast', []))).toBe('display');
    expect(defaultSpace(spec('sk.draft_flying_talisman', []))).toBe('display');
    expect(defaultSpace(spec('sk.drifting_charms', []))).toBe('linear');
    expect(defaultSpace(spec('sk.gen.hit', []))).toBe('linear');
    expect(defaultSpace(spec('hit.fire', []))).toBe('linear');
  });

  it('element wins over spec, spec wins over the default', () => {
    const el = particle();
    expect(resolveSpace(spec('sk.x', [el]), el)).toBe('linear');
    expect(resolveSpace(spec('sk.x', [el], { space: 'display' }), el)).toBe('display');
    expect(resolveSpace(spec('sk.x', [el], { space: 'display' }), { ...el, space: 'linear' })).toBe('linear');
    expect(resolveSpace(spec('sk.raw_1_g0', [el]), el)).toBe('display');
    expect(resolveSpace(spec('sk.raw_1_g0', [el], { space: 'linear' }), el)).toBe('linear');
  });
});

describe('SpecHost routing into the display batches', () => {
  it('additive particles and surfaces of a display spec go to the display batches, nothing else does', () => {
    const r = run(spec('sk.x', [particle(), surface()], { space: 'display' }));
    expect(r.pAddD).toBeGreaterThan(0);
    expect(r.sAddD).toBeGreaterThan(0);
    expect(r.pAdd).toBe(0);
    expect(r.sAdd).toBe(0);
  });

  it('linear specs keep the scene-pass batches (the look every hand spec was tuned in)', () => {
    const r = run(spec('sk.x', [particle(), surface()]));
    expect(r.pAdd).toBeGreaterThan(0);
    expect(r.sAdd).toBeGreaterThan(0);
    expect(r.pAddD).toBe(0);
    expect(r.sAddD).toBe(0);
  });

  it('alpha blended elements never move to the display layer', () => {
    const r = run(spec('sk.x', [particle({ blend: 'alpha' })], { space: 'display' }));
    expect(r.pAlpha).toBeGreaterThan(0);
    expect(r.pAddD).toBe(0);
  });

  it('a mixed spec splits per element', () => {
    const r = run(spec('sk.x', [particle({ space: 'display' }), particle({ space: 'linear' })]));
    expect(r.pAddD).toBeGreaterThan(0);
    expect(r.pAdd).toBeGreaterThan(0);
  });

  it('displayOn = false routes everything back into the linear batches (A/B switch)', () => {
    const r = run(spec('sk.x', [particle(), surface()], { space: 'display' }), (h) => {
      h.displayOn = false;
    });
    expect(r.pAddD + r.sAddD).toBe(0);
    expect(r.pAdd).toBeGreaterThan(0);
    expect(r.sAdd).toBeGreaterThan(0);
  });
});

describe('SRCCOLOR / ONE elements (ElementCommon.square)', () => {
  /** record flags (float 18) of the first record of a batch */
  const flagsOf = (b: { f: Float32Array }): number => b.f[18] as number;
  const PF_SQ = 1 << 21;
  const SF_SQ = 1 << 23;

  it('a display-space particle / surface with square carries the flag bit, one without it does not', () => {
    const on = run(spec('sk.x', [particle({ square: true }), surface({ square: true })], { space: 'display' }));
    expect(flagsOf(on.p.pAddD) & PF_SQ).toBe(PF_SQ);
    expect(flagsOf(on.p.sAddD as unknown as { f: Float32Array }) & SF_SQ).toBe(SF_SQ);
    const off = run(spec('sk.x', [particle(), surface()], { space: 'display' }));
    expect(flagsOf(off.p.pAddD) & PF_SQ).toBe(0);
    expect(flagsOf(off.p.sAddD as unknown as { f: Float32Array }) & SF_SQ).toBe(0);
  });

  it('is ignored in linear space (decoding the sRGB sprite already squares it) and for alpha blended elements', () => {
    const lin = run(spec('sk.x', [particle({ square: true })]));
    expect(flagsOf((lin.p as unknown as { pAdd: { f: Float32Array } }).pAdd) & PF_SQ).toBe(0);
    const alpha = run(spec('sk.x', [particle({ square: true, blend: 'alpha' })], { space: 'display' }));
    expect(alpha.pAlpha).toBeGreaterThan(0);
    expect(alpha.pAddD).toBe(0);
  });

  it('the flag bits stay clear of the other record flags (face turns 18-20, flipbook mode 16-17 / 21-22) and exact in a float32', () => {
    expect(PF_SQ).toBeGreaterThan(7 << 18);
    expect(SF_SQ).toBeGreaterThan(3 << 21);
    expect(Math.fround(SF_SQ | ((1 << 23) - 1))).toBe(SF_SQ | ((1 << 23) - 1));
  });

  for (const [name, src] of [['particle', SPEC_PARTICLE_FRAG], ['surface', SPEC_SURFACE_FRAG]] as const) {
    it(`${name}: the display branch squares the saturated colour BEFORE the alpha weight`, () => {
      const disp = src.slice(src.indexOf('#ifdef SPEC_DISPLAY', src.indexOf('void main')));
      const sat = disp.indexOf('min(lin2srgb(tex.rgb) * vCol.rgb, vec3(1.0))');
      const sq = disp.indexOf('if (vSq > 0.5) rgb *= rgb;');
      const alpha = disp.indexOf('rgb *= vCol.a');
      expect(sat).toBeGreaterThan(-1);
      expect(sq).toBeGreaterThan(sat);
      expect(alpha).toBeGreaterThan(sq);
    });
  }
});

describe('post pipeline contract (beginScene / drawOverlay)', () => {
  function recorder(): { r: WebGLRenderer; calls: string[]; seen: Array<{ visible: boolean; overlay: number; depthOn: number; inv: number[] }> } {
    const calls: string[] = [];
    const seen: Array<{ visible: boolean; overlay: number; depthOn: number; inv: number[] }> = [];
    const r = {
      autoClear: true,
      setRenderTarget: (t: unknown) => calls.push(`target:${t === null ? 'canvas' : 'rt'}`),
      render: () => calls.push('render'),
    } as unknown as WebGLRenderer;
    return { r, calls, seen };
  }

  it('registers itself as the page display layer', () => {
    const { h } = makeHost();
    expect(displayLayer()).toBe(h);
  });

  it('hides the display batches from the scene pass, draws them onto the canvas, restores everything', () => {
    const r = run(spec('sk.x', [particle(), surface()], { space: 'display' }));
    const { h, p } = r;
    const u = h.uniforms;
    const rec = recorder();
    const meshes = [p.sAddD.mesh, p.pAddD.mesh];
    expect(meshes.map((m) => m.visible)).toEqual([true, true]);
    expect(h.beginScene()).toBe(true);
    expect(meshes.map((m) => m.visible)).toEqual([false, false]);
    // the scene pass would render here; the overlay then draws each batch with the overlay uniforms on
    const render = rec.r.render as unknown as (o: unknown, c: unknown) => void;
    rec.r.render = ((o: { visible: boolean }) => {
      rec.seen.push({ visible: o.visible, overlay: u.uOverlay.value, depthOn: u.uDepthOn.value, inv: [u.uInvRes.value.x, u.uInvRes.value.y] });
      render(o, null);
    }) as unknown as WebGLRenderer['render'];
    const depth = {} as Texture;
    h.drawOverlay(rec.r, {} as Camera, depth, 200, 100);
    expect(rec.calls.filter((c) => c === 'render').length).toBe(2);
    expect(rec.calls[0]).toBe('target:canvas');
    expect(rec.seen).toEqual([
      { visible: true, overlay: 1, depthOn: 1, inv: [1 / 200, 1 / 100] },
      { visible: true, overlay: 1, depthOn: 1, inv: [1 / 200, 1 / 100] },
    ]);
    // restored: visible again, uniforms back to the scene-pass values, the caller's autoClear untouched
    expect(meshes.map((m) => m.visible)).toEqual([true, true]);
    expect(u.uOverlay.value).toBe(0);
    expect(u.uDepthOn.value).toBe(0);
    expect(u.uSceneDepth.value).toBeNull();
    expect(rec.r.autoClear).toBe(true);
    // a second drawOverlay without a beginScene draws nothing
    rec.calls.length = 0;
    h.drawOverlay(rec.r, {} as Camera, depth, 200, 100);
    expect(rec.calls).toEqual([]);
  });

  it('soft particles: a perspective camera feeds uSoftZ (near, far, soft metres); ortho / no depth / softDepth 0 keep the hard test', () => {
    const { h } = run(spec('sk.x', [particle()], { space: 'display' }));
    const seen: number[][] = [];
    const rec = recorder();
    rec.r.render = (() => seen.push([h.uniforms.uSoftZ.value.x, h.uniforms.uSoftZ.value.y, h.uniforms.uSoftZ.value.z])) as unknown as WebGLRenderer['render'];
    const draw = (cam: object): void => {
      h.beginScene();
      h.drawOverlay(rec.r, cam as Camera, {} as Texture, 64, 64);
    };
    expect(h.softDepth).toBeGreaterThan(0);
    draw({ isPerspectiveCamera: true, near: 0.3, far: 120 });
    draw({});
    h.softDepth = 0;
    draw({ isPerspectiveCamera: true, near: 0.3, far: 120 });
    expect(seen[0]).toEqual([0.3, 120, 0.35]);
    expect(seen[1]?.[2]).toBe(0);
    expect(seen[2]?.[2]).toBe(0);
  });

  it('soft particles: only screen / upright billboard particles fade (vSoft); surfaces and flat decals keep the hard depth cut', () => {
    const branch = (src: string): string => {
      const disp = src.slice(src.indexOf('#ifdef SPEC_DISPLAY'));
      return disp.slice(disp.indexOf('if (uOverlay > 0.5)'), disp.indexOf('} else {', disp.indexOf('if (uOverlay > 0.5)')));
    };
    expect(branch(SPEC_PARTICLE_FRAG)).toContain('displayFade(vSoft)');
    expect(branch(SPEC_PARTICLE_FRAG)).not.toContain('displayOccluded()');
    expect(branch(SPEC_SURFACE_FRAG)).toContain('displayOccluded()');
    expect(branch(SPEC_SURFACE_FRAG)).not.toContain('displayFade');
  });

  it('beginScene reports whether anything will be drawn (the post pipeline attaches its depth texture lazily on it)', () => {
    const idle = makeHost();
    expect(idle.h.beginScene()).toBe(false);
    idle.h.drawOverlay(recorder().r, {} as Camera, null, 1, 1);
    const linear = run(spec('sk.x', [particle()]));
    expect(linear.h.beginScene()).toBe(false);
    linear.h.drawOverlay(recorder().r, {} as Camera, null, 1, 1);
    const disp = run(spec('sk.x', [particle()], { space: 'display' }));
    expect(disp.h.beginScene()).toBe(true);
    disp.h.drawOverlay(recorder().r, {} as Camera, null, 1, 1);
  });

  it('without a depth texture (direct-to-canvas rendering) the shader depth test stays off', () => {
    const { h, p } = run(spec('sk.x', [particle()], { space: 'display' }));
    const rec = recorder();
    const depthOn: number[] = [];
    rec.r.render = (() => depthOn.push(h.uniforms.uDepthOn.value)) as unknown as WebGLRenderer['render'];
    h.beginScene();
    h.drawOverlay(rec.r, {} as Camera, null, 64, 64);
    expect(depthOn).toEqual([0]);
    expect(p.pAddD.mesh.visible).toBe(true);
  });
});

describe('sprite brightness gain (artGain.ts)', () => {
  
  // sprites FROM the table instead of naming one
  const [GAINED, GAINED_B] = Object.keys(ART_GAIN) as [string, string];

  it('is 1 for procedural roles and unknown ids, the table value for known sprites', () => {
    expect(artGain('')).toBe(1);
    expect(artGain('vfx_does_not_exist')).toBe(1);
    expect(artGain(GAINED)).toBe(ART_GAIN[GAINED]);
    expect(ART_GAIN[GAINED]).toBeLessThan(1);
  });

  it('takes the mean over the frames of a frame list', () => {
    const [a, b] = [GAINED, GAINED_B];
    expect(artGain(artKey([a!, b!]))).toBeCloseTo(((ART_GAIN[a!] ?? 1) + (ART_GAIN[b!] ?? 1)) / 2, 6);
  });

  it('the table never boosts and never silences a sprite', () => {
    for (const [id, g] of Object.entries(ART_GAIN)) {
      expect(g, id).toBeGreaterThanOrEqual(0.05);
      expect(g, id).toBeLessThan(1);
    }
  });

  it('is applied only to display-space elements that draw the sprite (a missing sprite keeps its fallback brightness)', () => {
    const el = particle({ tex: { art: GAINED, fallback: 'glow' }, bright: 1 });
    // sprite not baked: the fallback role draws, no factor
    const miss = run(spec('sk.x', [el], { space: 'display' }));
    expect(miss.p.pAddD.f[20]).toBe(1);
    // baked: the factor multiplies `bright` (record float 20)
    const baked = run(spec('sk.x', [el], { space: 'display' }), (h) => {
      (h as unknown as { art: { role: (k: string) => unknown } }).art.role = () => ({ packed: 65536, frames: 1 });
    });
    expect(baked.p.pAddD.f[20]).toBeCloseTo(ART_GAIN[GAINED]!, 5);
    // linear specs and `artGain: false` specs are untouched
    const lin = run(spec('sk.x', [el]), (h) => {
      (h as unknown as { art: { role: (k: string) => unknown } }).art.role = () => ({ packed: 65536, frames: 1 });
    });
    expect((lin.p as unknown as { pAdd: { f: Float32Array } }).pAdd.f[20]).toBe(1);
    const off = run(spec('sk.x', [el], { space: 'display', artGain: false }), (h) => {
      (h as unknown as { art: { role: (k: string) => unknown } }).art.role = () => ({ packed: 65536, frames: 1 });
    });
    expect(off.p.pAddD.f[20]).toBe(1);
  });

  it('keeps every ART_GAIN entry finite, bounded to [0.05, 1], and backed by a shipped vfx texture', () => {
    const man = JSON.parse(readFileSync(new URL('../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as Record<string, { kind?: string }>;
    const entries = Object.entries(ART_GAIN);
    expect(entries.length).toBeGreaterThan(20);
    for (const [id, k] of entries) {
      expect(Number.isFinite(k) && k >= 0.05 && k <= 1, `${id}: ${String(k)}`).toBe(true);
      expect(man[id]?.kind, id).toBe('vfx');
    }
  });
});

describe('display shader contract (shaders.ts SPEC_DISPLAY)', () => {
  for (const [name, src] of [['particle', SPEC_PARTICLE_FRAG], ['surface', SPEC_SURFACE_FRAG]] as const) {
    it(`${name}: clamps each element per channel and draws the overlay without tone mapping or encoding`, () => {
      const disp = src.slice(src.indexOf('#ifdef SPEC_DISPLAY'));
      // texel (decoded display value) x colour curve x bright, saturated at 1 like the texture stage
      expect(src).toMatch(/min\(lin2srgb\(tex\.rgb\) \* vCol\.rgb, vec3\(1\.0\)\)/);
      // the overlay branch writes premultiplied display values and never includes the tone mapping / colour space chunks
      const overlay = disp.slice(disp.indexOf('if (uOverlay > 0.5)'), disp.indexOf('} else {', disp.indexOf('if (uOverlay > 0.5)')));
      // the depth test: hard for surfaces, soft (fades over uSoftZ.z metres in front of the surface it crosses) for billboard particles
      expect(overlay).toContain(name === 'particle' ? 'displayFade(vSoft)' : 'displayOccluded()');
      expect(overlay).not.toContain('tonemapping_fragment');
      expect(overlay).not.toContain('colorspace_fragment');
      expect(overlay).not.toContain('srgb2lin');
      // no post pipeline: the same light inside the scene pass, tone mapped like every other spec batch
      const fallback = disp.slice(disp.indexOf('} else {'));
      expect(fallback).toContain('srgb2lin(rgb)');
      expect(fallback).toContain('tonemapping_fragment');
    });
  }
});

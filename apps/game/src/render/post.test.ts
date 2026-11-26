import { readFileSync } from 'node:fs';
import { Color, PerspectiveCamera, Scene, type Mesh, type ShaderMaterial, type Vector2, type WebGLRenderTarget, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { QUALITY_PROFILES, QualityState } from './quality';
import { NEUTRAL_GRADE, type GradeSpec, type PostLook } from './terrain/look';
import {
  COMPOSITE_FRAG,
  POST_DEFAULTS,
  PostPipeline,
  asPostPipeline,
  bloomChainSizes,
  bloomDivisor,
  gradePixel,
  gradeUniforms,
  postActive,
  resolveSamples,
  softKneeContribution,
  type RGB,
} from './post';

describe('postActive', () => {
  it('is off only when neither bloom nor vignette is requested', () => {
    expect(postActive(QUALITY_PROFILES.low)).toBe(false);
    expect(postActive(QUALITY_PROFILES.medium)).toBe(true);
    expect(postActive(QUALITY_PROFILES.high)).toBe(true);
    expect(postActive(QUALITY_PROFILES.ultra)).toBe(true);
    expect(postActive({ bloom: 0, vignette: true })).toBe(true);
    expect(postActive({ bloom: 1, vignette: false })).toBe(true);
  });
});

describe('bloomDivisor', () => {
  it('keeps ~270 rows in the first bloom level', () => {
    expect(bloomDivisor(1080)).toBe(4);
    expect(bloomDivisor(1350)).toBe(5);
    expect(bloomDivisor(2160)).toBe(8);
    expect(bloomDivisor(720)).toBe(3);
  });
  it('is clamped to [2, 8]', () => {
    expect(bloomDivisor(100)).toBe(2);
    expect(bloomDivisor(8000)).toBe(8);
  });
});

describe('bloomChainSizes', () => {
  it('returns nothing without bloom', () => {
    expect(bloomChainSizes(1920, 1080, 0)).toEqual([]);
  });
  it('level 0 is the drawing buffer / divisor, level 1 is a quarter of level 0', () => {
    expect(bloomChainSizes(1920, 1080, 1)).toEqual([{ width: 480, height: 270 }]);
    expect(bloomChainSizes(1920, 1080, 2)).toEqual([
      { width: 480, height: 270 },
      { width: 120, height: 68 },
    ]);
  });
  it('never produces an empty target', () => {
    for (const s of bloomChainSizes(3, 2, 2)) {
      expect(s.width).toBeGreaterThanOrEqual(1);
      expect(s.height).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('resolveSamples', () => {
  it('clamps to the hardware limit and treats <2 as off', () => {
    expect(resolveSamples(4, 8)).toBe(4);
    expect(resolveSamples(4, 2)).toBe(2);
    expect(resolveSamples(4, 1)).toBe(0);
    expect(resolveSamples(0, 8)).toBe(0);
    expect(resolveSamples(1, 8)).toBe(0);
  });
});

describe('softKneeContribution', () => {
  const thr = 0.9;
  const knee = 0.5;
  it('is zero below threshold - knee and for black', () => {
    expect(softKneeContribution(0, thr, knee)).toBe(0);
    expect(softKneeContribution(thr - knee - 0.01, thr, knee)).toBe(0);
  });
  it('is exactly (peak - threshold) / peak above threshold + knee', () => {
    const peak = 3;
    expect(softKneeContribution(peak, thr, knee)).toBeCloseTo((peak - thr) / peak, 6);
  });
  it('rises monotonically through the knee and never exceeds 1', () => {
    let prev = -1;
    for (let p = 0.3; p <= 12; p += 0.05) {
      const c = softKneeContribution(p, thr, knee);
      expect(c).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(c).toBeLessThanOrEqual(1);
      prev = c;
    }
  });
  it('lit surfaces under the threshold barely contribute, emissive HDR does', () => {
    expect(softKneeContribution(0.7, thr, knee) * 0.7).toBeLessThan(0.05);
    expect(softKneeContribution(4, thr, knee) * 4).toBeGreaterThan(2.5);
  });
});

describe('post shaders', () => {
  it('find NaN/Inf on the exponent bits, never with isnan()/isinf()', () => {
    // ANGLE/D3D proves a texture read "cannot be NaN", prints warning X3577 on every session and may drop the check
    const src = readFileSync(new URL('./post.ts', import.meta.url), 'utf8');
    const code = src
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/\bis(nan|inf)\s*\(/);
    expect(code).toContain('floatBitsToUint');
    expect(code).toContain('0x7F800000u');
  });
});

// A0-POST: three resolves the multisampled scene target into its texture with one blitFramebuffer. Resolving the packed
// depth-STENCIL of a 4x MSAA HDR target is the slow ANGLE/D3D11 path (three #27799: ~6 ms per frame at 1080p) and nothing
// reads the stencil after the scene pass (the hero x-ray writes and tests it INSIDE the pass), so the scene target never
// resolves it. Depth is only read back through the display-space overlay's depth texture, so it is resolved only while
// that texture is attached.
interface PostInternals {
  wantDepthTex: boolean;
  sceneTarget: WebGLRenderTarget | null;
  levels: { a: WebGLRenderTarget; b: WebGLRenderTarget }[];
  ensureTargets(p: (typeof QUALITY_PROFILES)['high'], levels: number): WebGLRenderTarget;
}

function pipeline(): { post: PostPipeline; inner: PostInternals } {
  // ensureTargets only reads capabilities.maxSamples; three builds render targets without a GL context
  const renderer = { capabilities: { maxSamples: 4 } } as unknown as WebGLRenderer;
  const post = new PostPipeline(renderer, new QualityState('high'));
  post.setSize(640, 360, 1);
  return { post, inner: post as unknown as PostInternals };
}

describe('scene target resolve flags (A0-POST)', () => {
  for (const depthTex of [false, true]) {
    it(`never resolves the stencil and resolves depth only with the depth texture (wantDepthTex=${depthTex})`, () => {
      const { post, inner } = pipeline();
      inner.wantDepthTex = depthTex;
      const rt = inner.ensureTargets(QUALITY_PROFILES.high, 2);
      expect(rt.samples).toBe(4);
      expect(rt.resolveStencilBuffer).toBe(false);
      expect(rt.resolveDepthBuffer).toBe(depthTex);
      // the x-ray still needs a stencil attachment inside the multisampled scene pass
      expect(rt.depthBuffer).toBe(true);
      expect(rt.stencilBuffer).toBe(true);
      expect(rt.depthTexture !== null).toBe(depthTex);
      post.dispose();
    });
  }

  it('keeps the flags when MSAA is off (medium tier)', () => {
    const { post, inner } = pipeline();
    const rt = inner.ensureTargets(QUALITY_PROFILES.medium, 1);
    expect(rt.samples).toBe(0);
    expect(rt.resolveStencilBuffer).toBe(false);
    expect(rt.resolveDepthBuffer).toBe(false);
    post.dispose();
  });

  it('re-creates the target with the new depth flag when the depth texture is attached, and reuses it otherwise', () => {
    const { post, inner } = pipeline();
    const first = inner.ensureTargets(QUALITY_PROFILES.high, 2);
    expect(inner.ensureTargets(QUALITY_PROFILES.high, 2)).toBe(first);
    expect(first.resolveDepthBuffer).toBe(false);
    inner.wantDepthTex = true;
    const second = inner.ensureTargets(QUALITY_PROFILES.high, 2);
    expect(second).not.toBe(first);
    expect(second.resolveDepthBuffer).toBe(true);
    expect(second.resolveStencilBuffer).toBe(false);
    expect(second.depthTexture).not.toBeNull();
    post.dispose();
  });

  it('leaves the bloom level targets alone (single sample, colour only, three defaults)', () => {
    const { post, inner } = pipeline();
    inner.ensureTargets(QUALITY_PROFILES.high, 2);
    expect(inner.levels).toHaveLength(2);
    for (const l of inner.levels) {
      for (const t of [l.a, l.b]) {
        expect(t.samples).toBe(0);
        expect(t.depthBuffer).toBe(false);
        expect(t.stencilBuffer).toBe(false);
        expect(t.depthTexture).toBeNull();
        expect(t.resolveStencilBuffer).toBe(true);
        expect(t.resolveDepthBuffer).toBe(true);
      }
    }
    post.dispose();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// PL-01: per-zone colour grade, bloom and vignette in the composite pass, plus the vignette-pulse API
// ---------------------------------------------------------------------------------------------------------------------

/** the A-03 Yeonmu golden-hour values (audit A, opportunity A-03): the demo grade of the PL-01 acceptance */
const A03: GradeSpec = {
  shadowTint: '#2c4a5a',
  shadowAmt: 0.15,
  highlightTint: '#ffd9a0',
  highlightAmt: 0.12,
  saturation: 1.06,
  contrast: 1.08,
};
/** every field off its neutral value */
const FULL: GradeSpec = {
  lift: 0.04,
  gamma: 1.1,
  gain: [1.05, 1, 0.94],
  shadowTint: '#2c4a5a',
  shadowAmt: 0.2,
  highlightTint: '#ffd9a0',
  highlightAmt: 0.15,
  balance: 0.2,
  contrast: 1.2,
  pivot: 0.22,
  saturation: 1.1,
};
const GREYS = [0, 0.02, 0.05, 0.18, 0.4, 0.7, 0.95, 1];
const luma = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('composite shader grade block (PL-01)', () => {
  const src = COMPOSITE_FRAG;
  it('declares its uniforms under GRADE and applies after tone mapping, before saturation / vignette / colour space / dither', () => {
    expect(src.indexOf('#ifdef GRADE')).toBeGreaterThan(-1);
    expect(src.indexOf('#ifdef GRADE')).toBeLessThan(src.indexOf('void main'));
    for (const u of ['uniform vec3 uLift', 'uniform vec3 uGamma', 'uniform vec3 uGain', 'uniform vec4 uSplitS', 'uniform vec4 uSplitH', 'uniform vec3 uCurve']) {
      expect(src).toContain(u);
    }
    const tm = src.indexOf('#include <tonemapping_fragment>');
    const grade = src.indexOf('#ifdef GRADE', tm);
    const sat = src.indexOf('uGrade.z != 1.0');
    const vig = src.indexOf('#ifdef VIGNETTE', tm);
    const cs = src.indexOf('#include <colorspace_fragment>');
    const dither = src.indexOf('52.9829189');
    expect(tm).toBeGreaterThan(-1);
    expect(grade).toBeGreaterThan(tm);
    expect(sat).toBeGreaterThan(grade);
    expect(vig).toBeGreaterThan(sat);
    expect(cs).toBeGreaterThan(vig);
    expect(dither).toBeGreaterThan(cs);
  });
  it('keeps the existing saturation uniform (uGrade.z) and the vignette strength (uGrade.x)', () => {
    expect(src).toContain('uniform vec4 uGrade;');
    expect(src).toContain('mix(vec3(l), gl_FragColor.rgb, uGrade.z)');
  });
});

describe('gradeUniforms / gradePixel (CPU reference of the shader block)', () => {
  it('the neutral grade is an exact identity', () => {
    const u = gradeUniforms(NEUTRAL_GRADE);
    expect(gradeUniforms()).toEqual(u);
    for (const r of GREYS) for (const g of GREYS) for (const b of [0, 0.3, 1]) expect(gradePixel([r, g, b], u)).toEqual([r, g, b]);
    expect(u.lift).toEqual([0, 0, 0]);
    expect(u.gamma).toEqual([1, 1, 1]);
    expect(u.gain).toEqual([1, 1, 1]);
    expect(u.splitS[3]).toBe(0);
    expect(u.splitH[3]).toBe(0);
    expect(u.curve).toEqual([1, 0.18, 0]);
    expect(u.saturation).toBe(1);
  });

  it('gain scales, lift raises the blacks, gamma bends the mids', () => {
    const scaled = gradePixel([0.5, 0.5, 0.5], gradeUniforms({ gain: [1.2, 1, 0.8] }));
    [0.6, 0.5, 0.4].forEach((v, i) => expect(scaled[i]).toBeCloseTo(v, 6));
    for (const v of gradePixel([0, 0, 0], gradeUniforms({ lift: 0.1 }))) expect(v).toBeCloseTo(0.1, 6);
    // lift * (1 - c): a white pixel does not move
    for (const v of gradePixel([1, 1, 1], gradeUniforms({ lift: 0.1 }))) expect(v).toBeCloseTo(1, 6);
    // gamma 2 -> pow(c, 1/2); the exponent is what the uniform carries
    expect(gradeUniforms({ gamma: 2 }).gamma).toEqual([0.5, 0.5, 0.5]);
    for (const v of gradePixel([0.25, 0.25, 0.25], gradeUniforms({ gamma: 2 }))) expect(v).toBeCloseTo(0.5, 6);
    // a negative result is clamped before the power
    for (const v of gradePixel([0.5, 0.5, 0.5], gradeUniforms({ gain: [-1, -1, -1], gamma: 2 }))) expect(v).toBe(0);
  });

  it('shadows go toward shadowTint by shadowAmt * (1 - l)^2, highlights toward highlightTint by highlightAmt * l^2', () => {
    const tint = new Color('#2c4a5a');
    const us = gradeUniforms({ shadowTint: '#2c4a5a', shadowAmt: 0.2 });
    expect(us.splitS.slice(0, 3)).toEqual([tint.r, tint.g, tint.b]);
    const dark = gradePixel([0.1, 0.1, 0.1], us);
    const w = 0.2 * (1 - 0.1) ** 2;
    expect(dark[0]).toBeCloseTo(0.1 + (tint.r - 0.1) * w, 6);
    expect(dark[1]).toBeCloseTo(0.1 + (tint.g - 0.1) * w, 6);
    expect(dark[2]).toBeCloseTo(0.1 + (tint.b - 0.1) * w, 6);

    const warm = new Color('#ffd9a0');
    const uh = gradeUniforms({ highlightTint: '#ffd9a0', highlightAmt: 0.3 });
    const bright = gradePixel([0.8, 0.8, 0.8], uh);
    const wh = 0.3 * 0.8 ** 2;
    expect(bright[0]).toBeCloseTo(0.8 + (warm.r - 0.8) * wh, 6);
    expect(bright[2]).toBeCloseTo(0.8 + (warm.b - 0.8) * wh, 6);
    // an amount of 0 makes the tint inert, whatever it is
    expect(gradePixel([0.3, 0.2, 0.1], gradeUniforms({ shadowTint: '#ff0000', highlightTint: '#00ff00' }))).toEqual([0.3, 0.2, 0.1]);
  });

  it('the Yeonmu A-03 values split warm / cool: shadows cooler, highlights warmer, mid-grey almost untouched', () => {
    const u = gradeUniforms(A03);
    const sh = gradePixel([0.05, 0.05, 0.05], u);
    expect(sh[2] - sh[0]).toBeGreaterThan(0.002); // blue over red in the shadows
    const hi = gradePixel([0.85, 0.85, 0.85], u);
    expect(hi[0] - hi[2]).toBeGreaterThan(0.02); // red over blue in the highlights
    const mid = gradePixel([0.18, 0.18, 0.18], u);
    for (const v of mid) expect(Math.abs(v - 0.18)).toBeLessThan(0.025);
    expect(u.saturation).toBeCloseTo(1.06, 9);
    expect(u.curve[0]).toBeCloseTo(1.08, 9);
  });

  it('balance moves the split point: positive favours the highlights, negative the shadows', () => {
    const g = { shadowTint: '#0000ff', shadowAmt: 1, highlightTint: '#ff0000', highlightAmt: 1 } as const;
    const pull = (balance: number): { s: number; h: number } => {
      const out = gradePixel([0.4, 0.4, 0.4], gradeUniforms({ ...g, balance }));
      return { s: out[2], h: out[0] };
    };
    const centre = pull(0);
    expect(pull(0.8).h).toBeGreaterThan(centre.h);
    expect(pull(0.8).s).toBeLessThan(centre.s);
    expect(pull(-0.8).s).toBeGreaterThan(centre.s);
    expect(pull(-0.8).h).toBeLessThan(centre.h);
  });

  it('contrast is a soft S-curve about the pivot: fixed at 0, pivot and 1, monotonic, darker below / brighter above', () => {
    const curve = (x: number, contrast: number, pivot = 0.18): number => gradePixel([x, x, x], gradeUniforms({ contrast, pivot }))[0];
    for (const k of [0.6, 1.5, 2.5]) {
      expect(curve(0, k)).toBeCloseTo(0, 9);
      expect(curve(1, k)).toBeCloseTo(1, 9);
      expect(curve(0.18, k)).toBeCloseTo(0.18, 9);
      expect(curve(0.3, k, 0.3)).toBeCloseTo(0.3, 9);
      let prev = -1;
      for (let x = 0; x <= 1.0001; x += 0.01) {
        const y = curve(Math.min(1, x), k);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = y;
      }
    }
    expect(curve(0.1, 1.5)).toBeCloseTo(0.18 * (0.1 / 0.18) ** 1.5, 9);
    expect(curve(0.5, 1.5)).toBeCloseTo(1 - 0.82 * (0.5 / 0.82) ** 1.5, 9);
    expect(curve(0.1, 1.5)).toBeLessThan(0.1);
    expect(curve(0.5, 1.5)).toBeGreaterThan(0.5);
    // below 1 the curve flattens (the other way round)
    expect(curve(0.1, 0.7)).toBeGreaterThan(0.1);
    expect(curve(0.5, 0.7)).toBeLessThan(0.5);
    // a value above 1 (an unmapped HDR pixel) is clamped, never NaN
    expect(curve(3, 1.5)).toBe(1);
  });

  it('clamps unusable values and takes the neutral value for non-finite ones', () => {
    const u = gradeUniforms({ contrast: -4, pivot: 5, balance: 9, shadowAmt: 7, highlightAmt: -1, gamma: 0, saturation: -2 });
    expect(u.curve[0]).toBeGreaterThan(0);
    expect(u.curve[1]).toBeLessThan(1);
    expect(u.curve[1]).toBeGreaterThan(0);
    expect(u.curve[2]).toBe(1);
    expect(u.splitS[3]).toBe(1);
    expect(u.splitH[3]).toBe(0);
    expect(Number.isFinite(u.gamma[0])).toBe(true);
    expect(u.saturation).toBe(0);
    const n = gradeUniforms({ lift: Number.NaN, gain: [1, Number.NaN, 1], gamma: Number.POSITIVE_INFINITY } as GradeSpec);
    expect(n).toEqual(gradeUniforms());
    for (const r of GREYS) for (const v of gradePixel([r, r, r], gradeUniforms(FULL))) expect(Number.isFinite(v)).toBe(true);
  });

  it('keeps the luminance of a neutral grey close under a tint pair (a colour shift, not an exposure change)', () => {
    const u = gradeUniforms({ shadowTint: '#2c4a5a', shadowAmt: 0.15, highlightTint: '#ffd9a0', highlightAmt: 0.12 });
    for (const x of [0.05, 0.18, 0.5, 0.85]) expect(Math.abs(luma(gradePixel([x, x, x], u)) - x)).toBeLessThan(0.03);
  });
});

interface Inner {
  compositeMat: ShaderMaterial;
}
interface GlLog {
  compiles: { defines: string[]; target: unknown }[];
  renders: number;
}

/** a renderer that draws nothing: enough for PostPipeline.render / setZonePost without a GL context */
function rig(tier: 'low' | 'medium' | 'high' = 'high', asyncCompile = false) {
  const log: GlLog = { compiles: [], renders: 0 };
  let target: unknown = null;
  const compileOne = (scene: Scene): void => {
    const mat = (scene.children[0] as Mesh).material as ShaderMaterial;
    log.compiles.push({ defines: Object.keys(mat.defines ?? {}).sort(), target });
  };
  const renderer = {
    capabilities: { maxSamples: 4 },
    autoClear: true,
    domElement: { width: 640, height: 360 },
    getDrawingBufferSize: (v: Vector2) => v.set(640, 360),
    getRenderTarget: () => target,
    setRenderTarget: (t: unknown) => {
      target = t;
    },
    render: () => {
      log.renders++;
    },
    compile: (scene: Scene) => compileOne(scene),
    ...(asyncCompile
      ? {
          compileAsync: (scene: Scene) => {
            compileOne(scene);
            return Promise.resolve();
          },
        }
      : {}),
  };
  const post = new PostPipeline(renderer as unknown as WebGLRenderer, new QualityState(tier));
  post.setSize(640, 360, 1);
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  return {
    post,
    log,
    inner: post as unknown as Inner,
    frame: (dt = 1 / 60): void => post.render(scene, camera, dt),
    setTarget: (t: unknown): void => {
      target = t;
    },
    target: (): unknown => target,
  };
}

const defs = (m: ShaderMaterial): string[] => Object.keys(m.defines ?? {}).sort();
const uv = (m: ShaderMaterial, name: string): number[] => Array.from(m.uniforms[name]!.value as ArrayLike<number>);
const GRADE_UNIFORMS = ['uLift', 'uGamma', 'uGain', 'uSplitS', 'uSplitH', 'uCurve'] as const;
function snapshot(r: ReturnType<typeof rig>) {
  const p = r.post;
  const m = r.inner.compositeMat;
  return {
    bloomStrength: p.bloomStrength,
    bloomThreshold: p.bloomThreshold,
    bloomKnee: p.bloomKnee,
    vignetteStrength: p.vignetteStrength,
    vignettePulse: p.vignettePulse,
    saturation: p.saturation,
    uniforms: GRADE_UNIFORMS.map((n) => uv(m, n)),
    defines: defs(m),
  };
}

describe('PostPipeline.setZonePost (PL-01)', () => {
  it("has today's constants as its defaults", () => {
    expect(POST_DEFAULTS).toEqual({ bloomStrength: 0.62, bloomThreshold: 0.92, bloomKnee: 0.55, vignetteStrength: 0.34 });
    const r = rig();
    expect(snapshot(r)).toMatchObject({ bloomStrength: 0.62, bloomThreshold: 0.92, bloomKnee: 0.55, vignetteStrength: 0.34, vignettePulse: 0, saturation: 1 });
    expect(snapshot(r).defines).toEqual([]);
    const u = gradeUniforms();
    expect(snapshot(r).uniforms).toEqual([u.lift, u.gamma, u.gain, u.splitS, u.splitH, u.curve]);
    expect(r.inner.compositeMat.name).toBe('up:PL-01:composite');
    r.post.dispose();
  });

  it('decides the GRADE define once per setZonePost (on for a run, off for null) and never inside a frame', () => {
    const r = rig();
    const m = r.inner.compositeMat;
    expect(defs(m)).not.toContain('GRADE'); // menus / previews: today's program
    r.frame();
    expect(defs(m)).not.toContain('GRADE');
    r.post.setZonePost(); // a run with no zone values still gets the define: the arc and corruption modulate the grade
    expect(defs(m)).toContain('GRADE');
    r.frame();
    const v = m.version;
    for (let i = 0; i < 40; i++) {
      r.post.setGrade(i % 2 ? FULL : A03);
      if (i === 10) r.post.pulseVignette(0.2, 500);
      r.post.setGrade({ ...FULL, saturation: 0.8 + i * 0.01 });
      r.frame();
    }
    expect(m.version).toBe(v);
    expect(defs(m)).toContain('GRADE');
    // another zone's values in the same run state: the define is already right, so there is nothing to relink
    r.post.setZonePost({ grade: A03, vignette: 0.4 });
    r.frame();
    expect(m.version).toBe(v);
    r.post.setZonePost(null);
    expect(defs(m)).not.toContain('GRADE');
    expect(m.version).toBeGreaterThan(v);
    r.post.dispose();
  });

  it("applies a zone's bloom threshold / strength / knee, vignette and grade; an absent field keeps today's value on its own", () => {
    const r = rig();
    r.post.setZonePost({ bloom: { strength: 0.4 }, vignette: 0.5 });
    expect(r.post.bloomStrength).toBe(0.4);
    expect(r.post.bloomThreshold).toBe(0.92);
    expect(r.post.bloomKnee).toBe(0.55);
    expect(r.post.vignetteStrength).toBe(0.5);
    // the next zone does not inherit the previous zone's values
    r.post.setZonePost({ bloom: { threshold: 0.8, knee: 0.3 }, grade: A03 });
    expect(r.post.bloomStrength).toBe(0.62);
    expect(r.post.bloomThreshold).toBe(0.8);
    expect(r.post.bloomKnee).toBe(0.3);
    expect(r.post.vignetteStrength).toBe(0.34);
    const u = gradeUniforms(A03);
    expect(uv(r.inner.compositeMat, 'uSplitS')).toEqual(u.splitS);
    r.frame();
    expect(uv(r.inner.compositeMat, 'uGrade')[2]).toBeCloseTo(1.06, 6); // the grade's saturation rides uGrade.z
    // out-of-range numbers are clamped, not trusted
    r.post.setZonePost({ vignette: 7, bloom: { strength: -1, knee: 0 } });
    expect(r.post.vignetteStrength).toBe(1);
    expect(r.post.bloomStrength).toBe(0);
    expect(r.post.bloomKnee).toBeGreaterThan(0);
    r.post.dispose();
  });

  it("setZonePost(null) restores today's defaults exactly", () => {
    const fresh = rig();
    fresh.frame(); // a frame sets the BLOOM / VIGNETTE defines; the run below must end on the same set
    const r = rig();
    r.post.setZonePost({ bloom: { threshold: 0.5, strength: 0.1, knee: 0.2 }, vignette: 0.9, grade: FULL });
    r.post.pulseVignette(0.3, 500);
    r.frame();
    r.post.setGrade(FULL);
    expect(snapshot(r)).not.toEqual(snapshot(fresh));
    r.post.setZonePost(null);
    expect(snapshot(r)).toEqual(snapshot(fresh));
    r.post.dispose();
    fresh.post.dispose();
  });

  it("keeps VIGNETTE on inside a run even when the zone's own vignette is 0 (a pulse must never link a program), today's rule outside", () => {
    const run = rig();
    run.post.setZonePost({ vignette: 0 });
    run.frame();
    expect(defs(run.inner.compositeMat)).toContain('VIGNETTE');
    expect(uv(run.inner.compositeMat, 'uGrade')[0]).toBe(0);
    run.post.dispose();
    const menu = rig();
    menu.post.vignetteStrength = 0;
    menu.frame();
    expect(defs(menu.inner.compositeMat)).not.toContain('VIGNETTE');
    menu.post.dispose();
  });
});

describe('PostPipeline.setZonePost compiles the composite program under the loading screen (PL-01)', () => {
  it('compiles once, against the canvas, with exactly the defines the first frame uses', () => {
    for (const [tier, expected] of [
      ['high', ['BLOOM_A', 'BLOOM_B', 'GRADE', 'VIGNETTE']],
      ['medium', ['BLOOM_A', 'GRADE', 'VIGNETTE']],
    ] as const) {
      const r = rig(tier);
      const some = { isRenderTarget: true };
      r.setTarget(some); // the loading screen may leave any target bound
      r.post.setZonePost({ grade: A03 });
      expect(r.log.compiles).toHaveLength(1);
      expect(r.log.compiles[0]!.defines).toEqual(expected);
      expect(r.log.compiles[0]!.target).toBeNull(); // the composite renders into the canvas: that is the program key
      expect(r.target()).toBe(some); // and the caller's target is back
      r.frame();
      expect(defs(r.inner.compositeMat)).toEqual(expected);
      r.post.dispose();
    }
  });

  it("follows the zone's bloom (strength 0 = no bloom defines) and returns the async compile when the renderer has one", async () => {
    const r = rig('high', true);
    const done = r.post.setZonePost({ bloom: { strength: 0 } });
    expect(done).toBeInstanceOf(Promise);
    await done;
    expect(r.log.compiles[0]!.defines).toEqual(['GRADE', 'VIGNETTE']);
    r.frame();
    expect(defs(r.inner.compositeMat)).toEqual(['GRADE', 'VIGNETTE']);
    r.post.dispose();
  });

  it('compiles nothing for null, nor on low (no composite pass there)', () => {
    const a = rig('high');
    a.post.setZonePost(null);
    expect(a.log.compiles).toHaveLength(0);
    const b = rig('low');
    expect(b.post.setZonePost({ grade: A03 })).toBeUndefined();
    expect(b.log.compiles).toHaveLength(0);
    expect(defs(b.inner.compositeMat)).toContain('GRADE'); // the define is still decided; low just never draws it
    a.post.dispose();
    b.post.dispose();
  });
});

describe('PostPipeline.setGrade (PL-01)', () => {
  it('changes uniforms only and sets every grade uniform', () => {
    const r = rig();
    r.post.setZonePost();
    r.frame();
    const m = r.inner.compositeMat;
    const v = m.version;
    const before = defs(m);
    const neutral = GRADE_UNIFORMS.map((n) => uv(m, n));
    r.post.setGrade(FULL);
    expect(m.version).toBe(v);
    expect(defs(m)).toEqual(before);
    const u = gradeUniforms(FULL);
    const want = [u.lift, u.gamma, u.gain, u.splitS, u.splitH, u.curve];
    GRADE_UNIFORMS.forEach((n, i) => {
      const got = uv(m, n);
      expect(got).toEqual(want[i]);
      expect(got).not.toEqual(neutral[i]); // every one of the six moved
    });
    r.frame();
    expect(uv(m, 'uGrade')[2]).toBeCloseTo(1.1, 6);
    // no argument = the identity grade
    r.post.setGrade();
    expect(GRADE_UNIFORMS.map((n) => uv(m, n))).toEqual(neutral);
    r.frame();
    expect(uv(m, 'uGrade')[2]).toBe(1);
    r.post.dispose();
  });

  it("the grade's saturation multiplies the pipeline's own saturation", () => {
    const r = rig();
    r.post.setZonePost({ grade: { saturation: 1.2 } });
    r.post.saturation = 0.5;
    r.frame();
    expect(uv(r.inner.compositeMat, 'uGrade')[2]).toBeCloseTo(0.6, 6);
    r.post.dispose();
  });

  it('exposes the zone grade a per-frame blend (arc, corruption) starts from, and it survives setGrade', () => {
    const r = rig();
    r.post.setZonePost({ grade: A03 });
    expect(r.post.baseGrade.shadowAmt).toBe(0.15);
    r.post.setGrade(FULL);
    expect(r.post.baseGrade.shadowAmt).toBe(0.15);
    r.post.setZonePost(null);
    expect(r.post.baseGrade).toEqual(NEUTRAL_GRADE);
    r.post.dispose();
  });
});

describe('PostPipeline.pulseVignette (PL-01)', () => {
  it('rises to the amount, decays to 0 over the given time, and links nothing', () => {
    const r = rig();
    r.post.setZonePost();
    r.frame();
    const m = r.inner.compositeMat;
    const v = m.version;
    r.post.pulseVignette(0.25, 1000);
    expect(r.post.vignettePulse).toBe(0); // the attack starts from where the screen is
    r.frame(0.12);
    expect(r.post.vignettePulse).toBeCloseTo(0.25, 9); // peak after the attack
    expect(uv(m, 'uGrade')[0]).toBeCloseTo(0.34 + 0.25, 6); // base + pulse
    let prev = r.post.vignettePulse;
    let t = 0.12;
    while (t < 1.0) {
      r.frame(0.05);
      t += 0.05;
      expect(r.post.vignettePulse).toBeLessThanOrEqual(prev + 1e-12);
      expect(r.post.vignettePulse).toBeLessThanOrEqual(0.25 + 1e-12);
      prev = r.post.vignettePulse;
    }
    r.frame(0.05); // past the 1000 ms
    expect(r.post.vignettePulse).toBe(0);
    expect(uv(m, 'uGrade')[0]).toBeCloseTo(0.34, 6);
    expect(m.version).toBe(v);
    r.post.dispose();
  });

  it('decays on low too (no composite pass, the clock still runs) and ignores nonsense', () => {
    const r = rig('low');
    r.post.pulseVignette(0.2, 300);
    r.frame(0.12);
    expect(r.post.vignettePulse).toBeGreaterThan(0);
    r.frame(0.5);
    expect(r.post.vignettePulse).toBe(0);
    for (const [a, ms] of [
      [0, 500],
      [-1, 500],
      [0.2, 0],
      [0.2, -5],
      [Number.NaN, 500],
      [0.2, Number.NaN],
    ] as const) {
      r.post.pulseVignette(a, ms);
      expect(r.post.vignettePulse).toBe(0);
      r.frame(0.1);
      expect(r.post.vignettePulse).toBe(0);
    }
    r.post.dispose();
  });

  it('a second pulse never dips the level the screen is at, and the total vignette stays <= 1', () => {
    const r = rig();
    r.post.setZonePost();
    r.post.pulseVignette(0.4, 1000);
    r.frame(0.12);
    r.frame(0.3);
    const level = r.post.vignettePulse;
    expect(level).toBeGreaterThan(0.1);
    r.post.pulseVignette(0.05, 400);
    expect(r.post.vignettePulse).toBeCloseTo(level, 9);
    r.post.pulseVignette(5, 1000); // amount clamps to 1; base 0.34 + pulse still <= 1 on screen
    r.frame(0.12);
    r.frame(0.12);
    expect(uv(r.inner.compositeMat, 'uGrade')[0]).toBe(1);
    r.post.setZonePost(null); // leaving the run drops a pulse in flight
    expect(r.post.vignettePulse).toBe(0);
    r.post.dispose();
  });

  it("draws on a zone whose own vignette is 0", () => {
    const r = rig();
    r.post.setZonePost({ vignette: 0 });
    r.post.pulseVignette(0.2, 500);
    r.frame(0.1);
    expect(uv(r.inner.compositeMat, 'uGrade')[0]).toBeCloseTo(0.2, 6);
    r.post.dispose();
  });
});

describe('asPostPipeline (PL-01)', () => {
  it('finds the PostPipeline behind a FrameComposer and nothing else', () => {
    const r = rig();
    expect(asPostPipeline(r.post)).toBe(r.post);
    expect(asPostPipeline(null)).toBeNull();
    expect(asPostPipeline(undefined)).toBeNull();
    expect(asPostPipeline({ render() {}, setSize() {}, dispose() {} })).toBeNull();
    r.post.dispose();
  });
});

// type-level: the zone look's PostLook is what setZonePost takes
const postLookFits: PostLook = { bloom: { threshold: 0.9 }, vignette: 0.3, grade: A03 };
void postLookFits;

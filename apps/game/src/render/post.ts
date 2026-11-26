// Post-processing pipeline (ARCHITECTURE §7): HDR scene target (HalfFloat, MSAA, depth) → cheap bloom (soft-knee
// bright pass at ~1/4 res, separable Gaussian, optional second ~1/16 res level) → one composite pass that adds the
// bloom, then applies the renderer's own tone mapping + output colour space (so `renderer.toneMapping` /
// `renderer.outputColorSpace` stay the single source of truth, exactly like three's OutputPass), a vignette and a
// temporal dither that hides banding in the fog/sky gradients.
//
// When the active quality profile asks for neither bloom nor vignette no render target is touched at all: the scene is
// drawn straight to the canvas and three applies tone mapping + sRGB itself.
//

// the HDR pass: the scene pass skips them (`beginScene`), so they feed neither bloom nor the tone mapper, and they are drawn
// straight onto the canvas after the composite (`drawOverlay`), depth-tested against the HDR target's depth. The depth
// texture is attached to the scene target lazily, the first frame such an effect is on screen (it costs an MSAA depth
// resolve per frame, which a game that never plays one must not pay). The stencil of the scene target is never resolved
// (ensureTargets).
//
// Fullscreen passes are single triangles (no EffectComposer dependency). Targets are reused across frames and only
// re-created when the drawing-buffer size, MSAA count or bloom level count changes.
//
// PL-01 (upgrade stage 2): a per-zone colour grade between the tone mapper and the saturation / vignette / dither, the zone's
// bloom and vignette numbers, and a vignette pulse. The grade is behind the GRADE define, which `setZonePost` decides ONCE per
// run, at zone load: on for every run (the default arc and corruption move the grade mid-run, through `setGrade`, uniforms only),
// off outside runs (menus, previews: today's pixels and today's program). `setZonePost` also compiles the composite program under
// the loading screen, so no program links mid-run. Low has no composite pass; its mood comes from the light presets.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DepthStencilFormat,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedInt248Type,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { displayLayer } from '../vfx/spec/display';
import type { FrameComposer } from './core';
import type { QualityProfile, QualityState } from './quality';
import { resolveGrade, type GradeSpec, type PostLook, type ResolvedGrade } from './terrain/look';

export type RGB = [number, number, number];

/** Today's bloom / vignette numbers: what an absent `PostLook` field and `setZonePost(null)` give back. */
export const POST_DEFAULTS = Object.freeze({ bloomStrength: 0.62, bloomThreshold: 0.92, bloomKnee: 0.55, vignetteStrength: 0.34 });

/** A grade as the composite shader reads it (everything the six `uLift` ... `uCurve` uniforms and `uGrade.z` carry). */
export interface GradeUniforms {
  /** `uLift`: `c * gain + lift * (1 - c)` */
  lift: RGB;
  /** `uGamma`: the EXPONENT, `1 / gamma` (the shader never divides) */
  gamma: RGB;
  /** `uGain` */
  gain: RGB;
  /** `uSplitS`: shadow tint (LINEAR rgb, three's ColorManagement) and its amount */
  splitS: [number, number, number, number];
  /** `uSplitH`: highlight tint (linear rgb) and its amount */
  splitH: [number, number, number, number];
  /** `uCurve`: contrast, pivot (linear, after tone mapping), balance */
  curve: RGB;
  /** multiplies the pipeline's own saturation into `uGrade.z` */
  saturation: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const tintScratch = new Color();

/**
 * `GradeSpec` -> the numbers the shader takes. Absent / non-finite fields are the identity (resolveGrade), unusable ones are
 * clamped: an amount to 0..1, balance to -1..1, contrast to 0.1..4, pivot to 0.02..0.98, gamma >= 0.05, saturation >= 0. The
 * tints are sRGB hex, converted once here to the linear values the (linear, tone-mapped) pixel is blended with.
 */
export function gradeUniforms(g?: GradeSpec | ResolvedGrade | null): GradeUniforms {
  const r = resolveGrade(g);
  const ig = 1 / Math.max(r.gamma, 0.05);
  const tint = (hex: string, amt: number): [number, number, number, number] => {
    tintScratch.set(hex);
    return [tintScratch.r, tintScratch.g, tintScratch.b, clamp(amt, 0, 1)];
  };
  return {
    lift: [r.lift, r.lift, r.lift],
    gamma: [ig, ig, ig],
    gain: [r.gain[0], r.gain[1], r.gain[2]],
    splitS: tint(r.shadowTint, r.shadowAmt),
    splitH: tint(r.highlightTint, r.highlightAmt),
    curve: [clamp(r.contrast, 0.1, 4), clamp(r.pivot, 0.02, 0.98), clamp(r.balance, -1, 1)],
    saturation: Math.max(r.saturation, 0),
  };
}

/**
 * CPU reference of the shader's GRADE block (linear, tone-mapped rgb in, same out; the saturation is the existing block after
 * it). Order: gain / lift / gamma, split tone by luma, soft S-curve. The neutral grade is an exact identity.
 */
export function gradePixel(c: RGB, u: GradeUniforms): RGB {
  const g: RGB = [0, 0, 0];
  for (let i = 0; i < 3; i++) g[i] = Math.max(c[i]! * u.gain[i]! + u.lift[i]! * (1 - c[i]!), 0);
  if (u.gamma[0] !== 1 || u.gamma[1] !== 1 || u.gamma[2] !== 1) for (let i = 0; i < 3; i++) g[i] = Math.pow(g[i]!, u.gamma[i]!);
  // balance moves the split point: positive = more of the tone range counts as highlight
  const lb = clamp(0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2] + 0.5 * u.curve[2], 0, 1);
  const ws = u.splitS[3] * (1 - lb) * (1 - lb);
  const wh = u.splitH[3] * lb * lb;
  for (let i = 0; i < 3; i++) g[i] = g[i]! * (1 - ws) + u.splitS[i]! * ws;
  for (let i = 0; i < 3; i++) g[i] = g[i]! * (1 - wh) + u.splitH[i]! * wh;
  const k = u.curve[0];
  if (k !== 1) {
    const p = u.curve[1];
    for (let i = 0; i < 3; i++) {
      const x = clamp(g[i]!, 0, 1);
      g[i] = x <= p ? p * Math.pow(x / p, k) : 1 - (1 - p) * Math.pow((1 - x) / (1 - p), k);
    }
  }
  return g;
}

/** True when the profile needs the HDR target (bloom and/or vignette). Otherwise the scene renders straight to the canvas. */
export function postActive(p: Pick<QualityProfile, 'bloom' | 'vignette'>): boolean {
  return p.bloom > 0 || p.vignette;
}

/**
 * Downscale factor of the first bloom level. The bloom radius is meant to stay constant relative to the screen, so the
 * level keeps ~270 rows regardless of the drawing-buffer height (1080 → 4, 2160 → 8, 720 → 3).
 */
export function bloomDivisor(bufferHeight: number): number {
  return Math.max(2, Math.min(8, Math.round(bufferHeight / 270)));
}

export interface LevelSize {
  width: number;
  height: number;
}

/** Sizes of the bloom chain: level 0 = bufferSize / divisor, level 1 = level 0 / 4. `levels` is 0, 1 or 2. */
export function bloomChainSizes(bufferWidth: number, bufferHeight: number, levels: number): LevelSize[] {
  const out: LevelSize[] = [];
  if (levels <= 0) return out;
  const d = bloomDivisor(bufferHeight);
  let w = Math.max(1, Math.ceil(bufferWidth / d));
  let h = Math.max(1, Math.ceil(bufferHeight / d));
  out.push({ width: w, height: h });
  if (levels >= 2) {
    w = Math.max(1, Math.ceil(w / 4));
    h = Math.max(1, Math.ceil(h / 4));
    out.push({ width: w, height: h });
  }
  return out;
}

/** MSAA sample count actually requested from the GPU (profile value clamped by the hardware limit, 0/1 = off). */
export function resolveSamples(profileMsaa: number, maxSamples: number): number {
  const s = Math.min(Math.max(0, Math.floor(profileMsaa)), Math.max(0, Math.floor(maxSamples)));
  return s >= 2 ? s : 0;
}

/**
 * CPU reference of the soft-knee bright pass in the prefilter shader: fraction of a pixel with peak channel `peak`
 * that survives. 0 below `threshold - knee`, exactly `(peak - threshold) / peak` above `threshold + knee`.
 */
export function softKneeContribution(peak: number, threshold: number, knee: number): number {
  if (peak <= 1e-4) return 0;
  const soft = Math.min(Math.max(peak - threshold + knee, 0), 2 * knee);
  const s = (soft * soft) / (4 * knee + 1e-4);
  return Math.max(s, peak - threshold) / peak;
}

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// NaN and +-Inf have an all-ones exponent, so they are found on the bits. isnan()/isinf() are not an option: ANGLE's D3D
// backend assumes a texture read cannot be NaN, prints warning X3577 ("isnan() may not be necessary", every session) and
// is free to drop the check, while integer ops are always kept.
const NONFINITE_GLSL = /* glsl */ `
bool nonFinite(vec3 v) {
  uvec3 e = floatBitsToUint(v) & uvec3(0x7F800000u);
  return any(equal(e, uvec3(0x7F800000u)));
}
`;

// Bright pass + 1/4 downsample. Each of the 4 taps is itself a bilinear 2x2 average, so together they cover the 4x4
// source block of one destination texel; the knee is applied per tap (small bright highlights must not vanish in the
// average) and the taps are Karis-weighted so single hot pixels do not create flickering fireflies.
const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform vec2 uThreshold;
varying vec2 vUv;
${NONFINITE_GLSL}
vec3 knee(vec3 c) {
  float br = max(max(c.r, c.g), c.b);
  float soft = clamp(br - uThreshold.x + uThreshold.y, 0.0, 2.0 * uThreshold.y);
  soft = soft * soft / (4.0 * uThreshold.y + 1e-4);
  float contrib = max(soft, br - uThreshold.x) / max(br, 1e-4);
  return c * contrib;
}
vec3 tap(vec2 o) {
  vec3 s = texture2D(tSrc, vUv + o * uTexel).rgb;
  // NaN/Inf from any shader would otherwise smear through the whole blur chain
  if (nonFinite(s)) s = vec3(0.0);
  return knee(clamp(s, vec3(0.0), vec3(48.0)));
}
float karis(vec3 c) {
  return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)));
}
void main() {
  vec3 a = tap(vec2(-1.0, -1.0));
  vec3 b = tap(vec2( 1.0, -1.0));
  vec3 c = tap(vec2(-1.0,  1.0));
  vec3 d = tap(vec2( 1.0,  1.0));
  float wa = karis(a), wb = karis(b), wc = karis(c), wd = karis(d);
  gl_FragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
}
`;

// Plain 4-tap box downsample (bloom level 0 → level 1).
const DOWNSAMPLE_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  gl_FragColor = vec4(s * 0.25, 1.0);
}
`;

// 9-tap separable Gaussian expressed as 5 bilinear fetches per direction.
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 0.2270270270;
  vec2 o1 = uStep * 1.3846153846;
  vec2 o2 = uStep * 3.2307692308;
  s += (texture2D(tSrc, vUv + o1).rgb + texture2D(tSrc, vUv - o1).rgb) * 0.3162162162;
  s += (texture2D(tSrc, vUv + o2).rgb + texture2D(tSrc, vUv - o2).rgb) * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}
`;

// Composite renders into the canvas, so three's program prefix supplies `toneMapping()` for the renderer's current
// tone mapping and `linearToOutputTexel()` for its output colour space (and uploads `toneMappingExposure`).
//
// PL-01 colour grade (GRADE define, see setZonePost): on the tone-mapped linear colour, before saturation / vignette / dither.
// c = pow(max(c * gain + lift * (1 - c), 0), 1 / gamma); then a split tone by luma (shadows toward uSplitS.rgb by
// uSplitS.w * (1 - l)^2, highlights toward uSplitH.rgb by uSplitH.w * l^2, uCurve.z shifts the split point); then a soft S-curve
// about the pivot uCurve.y with strength uCurve.x. CPU reference: gradePixel. The neutral grade skips every pow and is exact.
export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform vec2 uBloom;
uniform vec4 uGrade;   // x vignette strength, y dither amplitude (1/255 units), z saturation, w frame seed
uniform float uAspect;
#ifdef GRADE
uniform vec3 uLift;
uniform vec3 uGamma;   // exponent, 1 / gamma
uniform vec3 uGain;
uniform vec4 uSplitS;  // shadow tint (linear rgb), amount
uniform vec4 uSplitH;  // highlight tint (linear rgb), amount
uniform vec3 uCurve;   // contrast, pivot, balance
#endif
varying vec2 vUv;
${NONFINITE_GLSL}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  // a NaN/Inf scene pixel (a broken shader) would tone-map to a white or garbage pixel: show it black instead
  if (nonFinite(c)) c = vec3(0.0);
#ifdef BLOOM_A
  c += texture2D(tBloomA, vUv).rgb * uBloom.x;
#endif
#ifdef BLOOM_B
  c += texture2D(tBloomB, vUv).rgb * uBloom.y;
#endif
  gl_FragColor = vec4(c, 1.0);
#include <tonemapping_fragment>
#ifdef GRADE
  {
    vec3 g = max(gl_FragColor.rgb * uGain + uLift * (1.0 - gl_FragColor.rgb), vec3(0.0));
    if (uGamma.x != 1.0 || uGamma.y != 1.0 || uGamma.z != 1.0) g = pow(g, uGamma);
    float lb = clamp(dot(g, vec3(0.2126, 0.7152, 0.0722)) + 0.5 * uCurve.z, 0.0, 1.0);
    float ws = uSplitS.w * (1.0 - lb) * (1.0 - lb);
    float wh = uSplitH.w * lb * lb;
    g = mix(g, uSplitS.rgb, ws);
    g = mix(g, uSplitH.rgb, wh);
    if (uCurve.x != 1.0) {
      vec3 x = clamp(g, 0.0, 1.0);
      float p = uCurve.y;
      vec3 lo = p * pow(x / p, vec3(uCurve.x));
      vec3 hi = 1.0 - (1.0 - p) * pow((1.0 - x) / (1.0 - p), vec3(uCurve.x));
      g = mix(hi, lo, step(x, vec3(p)));
    }
    gl_FragColor.rgb = g;
  }
#endif
  if (uGrade.z != 1.0) {
    float l = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor.rgb = max(mix(vec3(l), gl_FragColor.rgb, uGrade.z), 0.0);
  }
#ifdef VIGNETTE
  vec2 q = (vUv - 0.5) * 2.0;
  q.x *= mix(1.0, uAspect, 0.35);
  float d = length(q) * 0.62;
  float v = smoothstep(0.38, 1.0, d);
  gl_FragColor.rgb *= 1.0 - uGrade.x * v * v * (3.0 - 2.0 * v);
#endif
#include <colorspace_fragment>
  // interleaved-gradient noise with a per-frame offset, triangular-ish distribution, +-1 LSB
  vec2 fc = gl_FragCoord.xy + uGrade.w * vec2(5.588238, 3.1415);
  float n = fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
  gl_FragColor.rgb += (n - 0.5) * uGrade.y / 255.0;
}
`;

function makeTarget(width: number, height: number, samples: number, depth: boolean, depthTex = false): WebGLRenderTarget {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return new WebGLRenderTarget(w, h, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: depth,
    // the hero x-ray (render/heroOutline.ts) masks itself with the stencil the hero writes
    stencilBuffer: depth,
    samples,
    // read back by the display-space overlay (depth + stencil packed: the stencil attachment must survive). The key is left
    // out when unused: three merges the options with Object.assign, so an explicit `undefined` would replace its `null` default
    ...(depth && depthTex ? { depthTexture: new DepthTexture(w, h, UnsignedInt248Type, undefined, undefined, undefined, undefined, undefined, undefined, DepthStencilFormat) } : {}),
  });
}

interface BloomLevel {
  a: WebGLRenderTarget;
  b: WebGLRenderTarget;
}

/** The PostPipeline behind a core's composer (null for none, or for another composer). */
export function asPostPipeline(c: FrameComposer | null | undefined): PostPipeline | null {
  return c instanceof PostPipeline ? c : null;
}

/** seconds a vignette pulse takes to rise to its peak (capped at a fifth of the pulse) */
const PULSE_ATTACK = 0.12;

export class PostPipeline implements FrameComposer {
  /** overall bloom intensity multiplier (0 disables the add) */
  bloomStrength: number = POST_DEFAULTS.bloomStrength;
  /** linear scene luminance where bloom starts; lit surfaces peak below 1, emissive/additive FX exceed it */
  bloomThreshold: number = POST_DEFAULTS.bloomThreshold;
  /** soft knee width around the threshold */
  bloomKnee: number = POST_DEFAULTS.bloomKnee;
  /** darkening at the screen corners, 0..1 (only applied when the quality profile enables the vignette) */
  vignetteStrength: number = POST_DEFAULTS.vignetteStrength;
  /** dither amplitude in 8-bit LSBs */
  ditherStrength = 1.0;
  /** display-referred saturation after tone mapping (1 = untouched) */
  saturation = 1.0;

  /** PL-01: the GRADE define is on (a run: decided once per `setZonePost`); off = menus / previews, today's program */
  private gradeMode = false;
  /** PL-01: the zone's grade (what `setZonePost` set; a per-frame blend starts from it, `setGrade` never changes it) */
  private zoneGrade: ResolvedGrade = resolveGrade();
  /** PL-01: the saturation of the grade in force, multiplied into uGrade.z */
  private gradeSat = 1;
  /** PL-01 vignette pulse: peak, the level it rose from, length (s) and clock (s); length 0 = no pulse */
  private pulsePeak = 0;
  private pulseFrom = 0;
  private pulseDur = 0;
  private pulseT = 0;

  private profile: QualityProfile;
  private readonly unsubscribe: () => void;

  private readonly geometry: BufferGeometry;
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;
  private readonly passScene = new Scene();

  private readonly prefilterMat: ShaderMaterial;
  private readonly downsampleMat: ShaderMaterial;
  private readonly blurMat: ShaderMaterial;
  private readonly compositeMat: ShaderMaterial;

  private bufW = 0;
  private bufH = 0;

  private sceneTarget: WebGLRenderTarget | null = null;
  private sceneKey = '';
  /** the scene target carries a depth texture (sticky: set the first frame a display-space effect is on screen) */
  private wantDepthTex = false;
  private levels: BloomLevel[] = [];
  private levelKey = '';
  private frameNo = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly quality: QualityState,
  ) {
    this.profile = quality.profile;

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.geometry = g;

    const pass = (frag: string, uniforms: ShaderMaterial['uniforms'], toneMapped: boolean): ShaderMaterial =>
      new ShaderMaterial({
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: frag,
        uniforms,
        depthTest: false,
        depthWrite: false,
        toneMapped,
      });
    this.prefilterMat = pass(
      PREFILTER_FRAG,
      { tSrc: { value: null }, uTexel: { value: [0, 0] }, uThreshold: { value: [1, 0.5] } },
      false,
    );
    this.downsampleMat = pass(DOWNSAMPLE_FRAG, { tSrc: { value: null }, uTexel: { value: [0, 0] } }, false);
    this.blurMat = pass(BLUR_FRAG, { tSrc: { value: null }, uStep: { value: [0, 0] } }, false);
    this.compositeMat = pass(
      COMPOSITE_FRAG,
      {
        tScene: { value: null },
        tBloomA: { value: null },
        tBloomB: { value: null },
        uBloom: { value: [0, 0] },
        uGrade: { value: [0, 1, 1, 0] },
        uAspect: { value: 16 / 9 },
        // PL-01 (read only when the GRADE define is on); written in place by writeGrade, the neutral grade to start with
        uLift: { value: [0, 0, 0] },
        uGamma: { value: [1, 1, 1] },
        uGain: { value: [1, 1, 1] },
        uSplitS: { value: [1, 1, 1, 0] },
        uSplitH: { value: [1, 1, 1, 0] },
        uCurve: { value: [1, 0.18, 0] },
      },
      true,
    );
    this.compositeMat.name = 'up:PL-01:composite';

    this.quad = new Mesh(g, this.prefilterMat);
    this.quad.frustumCulled = false;
    this.passScene.add(this.quad);

    this.unsubscribe = quality.onChange((p) => {
      this.profile = p;
    });
  }

  /** true while the HDR/bloom path is in use for the current quality profile */
  get active(): boolean {
    return postActive(this.profile);
  }

  /**
   * PL-01: the zone's composite-pass look, called by the run at zone load (`undefined` = a run with no zone values, `null` = outside
   * a run). Sets the bloom threshold / strength / knee (an absent field is today's value, each on its own), the vignette (absent =
   * today's) and the grade (absent = the identity), and DECIDES the GRADE define: on for a run, off for null (menus, previews:
   * today's pixels and program). `null` restores today's defaults exactly and drops a vignette pulse in flight. The define is
   * never touched again until the next call; the arc, corruption and pulses only write uniforms (`setGrade`, `pulseVignette`).
   *
   * For a run it also compiles the composite program (the BLOOM / VIGNETTE / GRADE variant the first frame will use) against the
   * canvas, so it links under the loading screen: returns `renderer.compileAsync`'s promise (await it before the warm-up) or
   * nothing. Nothing is compiled when the quality profile has no composite pass (low) and none for null.
   */
  setZonePost(post?: PostLook | null): Promise<void> | void {
    const cm = this.compositeMat;
    this.clearPulse();
    if (post === null) {
      this.bloomStrength = POST_DEFAULTS.bloomStrength;
      this.bloomThreshold = POST_DEFAULTS.bloomThreshold;
      this.bloomKnee = POST_DEFAULTS.bloomKnee;
      this.vignetteStrength = POST_DEFAULTS.vignetteStrength;
      this.gradeMode = false;
      this.zoneGrade = resolveGrade();
      this.writeGrade(this.zoneGrade);
      this.setDefine(cm, 'GRADE', false);
      return;
    }
    const b = post?.bloom;
    const num = (v: number | undefined, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
    this.bloomStrength = num(b?.strength, POST_DEFAULTS.bloomStrength, 0, 8);
    this.bloomThreshold = num(b?.threshold, POST_DEFAULTS.bloomThreshold, 0, 16);
    this.bloomKnee = num(b?.knee, POST_DEFAULTS.bloomKnee, 0.01, 8);
    this.vignetteStrength = num(post?.vignette, POST_DEFAULTS.vignetteStrength, 0, 1);
    this.gradeMode = true;
    this.zoneGrade = resolveGrade(post?.grade);
    this.writeGrade(this.zoneGrade);
    this.setDefine(cm, 'GRADE', true);
    return this.precompile();
  }

  /**
   * PL-01: the grade in force this frame (the arc and corruption blend it per frame). Uniforms only: no define, no recompile.
   * No argument = the identity. Outside a run (GRADE off) the numbers are stored but the shader does not read them.
   */
  setGrade(g?: GradeSpec | ResolvedGrade | null): void {
    this.writeGrade(resolveGrade(g));
  }

  /** PL-01: the zone's own grade as `setZonePost` set it (the base of a per-frame blend); the identity outside a run. */
  get baseGrade(): Readonly<ResolvedGrade> {
    return this.zoneGrade;
  }

  /**
   * PL-01: a vignette pulse for the climax (boss spawns): adds up to `amount` (0..1, on top of the zone's vignette, the total
   * capped at 1) to the corner darkening, rising over ~0.12 s and easing back to 0 over `ms`. A pulse started while another runs
   * rises from the level the screen is at (no dip) to the larger peak. Nonsense (amount <= 0, ms <= 0, NaN) cancels nothing and
   * starts nothing. Uniform only: it never changes a define, and the VIGNETTE define of a run does not depend on the zone's
   * vignette strength, so a zone with no vignette still shows it. On low (no composite pass) there is nothing to draw.
   */
  pulseVignette(amount: number, ms: number): void {
    if (!(amount > 0) || !(ms > 0)) return;
    const level = this.vignettePulse;
    this.pulsePeak = Math.max(Math.min(1, amount), level);
    this.pulseFrom = level;
    this.pulseDur = ms / 1000;
    this.pulseT = 0;
  }

  /** PL-01: the vignette strength the running pulse adds right now (0 when none). */
  get vignettePulse(): number {
    const dur = this.pulseDur;
    const t = this.pulseT;
    if (dur <= 0 || t >= dur) return 0;
    const att = Math.min(PULSE_ATTACK, dur * 0.2);
    if (t < att) {
      const s = t / att;
      return this.pulseFrom + (this.pulsePeak - this.pulseFrom) * (s * s * (3 - 2 * s));
    }
    const u = (t - att) / (dur - att);
    return this.pulsePeak * (1 - u) * (1 - u);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.bufW = Math.max(1, Math.floor(width * pixelRatio));
    this.bufH = Math.max(1, Math.floor(height * pixelRatio));
  }

  render(scene: Scene, camera: Camera, dt: number): void {
    const r = this.renderer;
    const p = this.profile;
    this.stepPulse(dt); // the pulse clock runs on low too (no composite there): a pulse never outlives its time
    if (!postActive(p)) {
      this.releaseTargets();
      r.setRenderTarget(null);
      // straight to the canvas: its depth buffer still holds the scene when the overlay draws
      const layer = displayLayer();
      layer?.beginScene();
      r.render(scene, camera);
      layer?.drawOverlay(r, camera, null, r.domElement.width, r.domElement.height);
      return;
    }
    if (this.bufW === 0) {
      // setSize not called yet: fall back to the renderer's drawing buffer.
      const s = r.getDrawingBufferSize(this.scratchSize);
      this.bufW = s.x;
      this.bufH = s.y;
    }
    this.frameNo++;
    const levels = Math.min(2, Math.max(0, p.bloom));
    // display-space spec effects skip the HDR pass (see the header); a depth texture is attached once one is on screen
    const layer = displayLayer();
    const overlay = layer?.beginScene() === true;
    if (overlay) this.wantDepthTex = true;
    const sceneRT = this.ensureTargets(p, levels);

    const prevAuto = r.autoClear;
    r.setRenderTarget(sceneRT);
    r.render(scene, camera); // autoClear clears colour+depth with the scene background

    r.autoClear = false;
    const bloomOn = levels > 0 && this.bloomStrength > 0;
    if (bloomOn) this.renderBloom(sceneRT.texture, levels);

    const cm = this.compositeMat;
    const u = cm.uniforms;
    u.tScene!.value = sceneRT.texture;
    const wantA = bloomOn && this.levels.length > 0;
    const wantB = bloomOn && this.levels.length > 1;
    u.tBloomA!.value = wantA ? this.levels[0]!.b.texture : null;
    u.tBloomB!.value = wantB ? this.levels[1]!.b.texture : null;
    const strength = this.bloomStrength;
    u.uBloom!.value = wantB ? [0.62 * strength, 0.9 * strength] : [0.95 * strength, 0];
    u.uGrade!.value = [
      p.vignette ? Math.min(1, this.vignetteStrength + this.vignettePulse) : 0,
      this.ditherStrength,
      this.saturation * (this.gradeMode ? this.gradeSat : 1),
      (this.frameNo % 97) * 1.37,
    ];
    u.uAspect!.value = this.bufW / this.bufH;
    const want = this.wantedDefines(p);
    this.setDefine(cm, 'BLOOM_A', want.a);
    this.setDefine(cm, 'BLOOM_B', want.b);
    this.setDefine(cm, 'VIGNETTE', want.vignette);
    this.drawPass(cm, null);

    layer?.drawOverlay(r, camera, sceneRT.depthTexture, this.bufW, this.bufH);
    r.autoClear = prevAuto;
  }

  dispose(): void {
    this.unsubscribe();
    this.releaseTargets();
    this.geometry.dispose();
    this.prefilterMat.dispose();
    this.downsampleMat.dispose();
    this.blurMat.dispose();
    this.compositeMat.dispose();
  }

  // ---------------------------------------------------------------------------------------------------------------

  private readonly scratchSize = new Vector2();

  private stepPulse(dt: number): void {
    if (this.pulseDur <= 0) return;
    this.pulseT += dt > 0 ? dt : 0;
    if (this.pulseT >= this.pulseDur) this.clearPulse();
  }

  private clearPulse(): void {
    this.pulsePeak = 0;
    this.pulseFrom = 0;
    this.pulseDur = 0;
    this.pulseT = 0;
  }

  /** the grade's numbers into the composite uniforms, in place (a per-frame caller allocates nothing but the resolve) */
  private writeGrade(g: ResolvedGrade): void {
    const k = gradeUniforms(g);
    const u = this.compositeMat.uniforms;
    const put = (name: string, v: readonly number[]): void => {
      const dst = u[name]!.value as number[];
      for (let i = 0; i < v.length; i++) dst[i] = v[i]!;
    };
    put('uLift', k.lift);
    put('uGamma', k.gamma);
    put('uGain', k.gain);
    put('uSplitS', k.splitS);
    put('uSplitH', k.splitH);
    put('uCurve', k.curve);
    this.gradeSat = k.saturation;
  }

  /**
   * The BLOOM_A / BLOOM_B / VIGNETTE defines the composite wants for profile `p`: ONE rule for the frame and for the load-time
   * compile. Inside a run (GRADE on) the vignette define follows the profile alone, so a pulse on a zone whose own vignette is 0
   * needs no new program; outside a run it is today's rule (profile and a non-zero strength).
   */
  private wantedDefines(p: QualityProfile): { a: boolean; b: boolean; vignette: boolean } {
    const levels = Math.min(2, Math.max(0, p.bloom));
    const bloomOn = levels > 0 && this.bloomStrength > 0;
    return { a: bloomOn && levels > 0, b: bloomOn && levels > 1, vignette: p.vignette && (this.gradeMode || this.vignetteStrength > 0) };
  }

  /** Links the composite program of the current profile now (against the canvas: that is the program key), not at the first frame. */
  private precompile(): Promise<void> | void {
    const p = this.profile;
    if (!postActive(p)) return;
    const r = this.renderer;
    const cm = this.compositeMat;
    const want = this.wantedDefines(p);
    this.setDefine(cm, 'BLOOM_A', want.a);
    this.setDefine(cm, 'BLOOM_B', want.b);
    this.setDefine(cm, 'VIGNETTE', want.vignette);
    this.quad.material = cm;
    const prev = typeof r.getRenderTarget === 'function' ? r.getRenderTarget() : null;
    r.setRenderTarget(null);
    try {
      if (typeof r.compileAsync === 'function') return r.compileAsync(this.passScene, this.camera).then(() => undefined);
      if (typeof r.compile === 'function') r.compile(this.passScene, this.camera);
    } finally {
      r.setRenderTarget(prev);
    }
  }

  private renderBloom(sceneTex: Texture, levels: number): void {
    const l0 = this.levels[0];
    if (!l0) return;

    // bright pass: scene → l0.a
    let m = this.prefilterMat;
    m.uniforms.tSrc!.value = sceneTex;
    m.uniforms.uTexel!.value = [1 / this.bufW, 1 / this.bufH];
    m.uniforms.uThreshold!.value = [this.bloomThreshold, Math.max(0.01, this.bloomKnee)];
    this.drawPass(m, l0.a);
    this.blur(l0);

    const l1 = this.levels[1];
    if (levels >= 2 && l1) {
      m = this.downsampleMat;
      m.uniforms.tSrc!.value = l0.b.texture;
      m.uniforms.uTexel!.value = [1 / l0.b.width, 1 / l0.b.height];
      this.drawPass(m, l1.a);
      this.blur(l1);
    }
  }

  /** separable Gaussian: a → b (horizontal), b → a (vertical); result lives in `b`... so finish with b = final */
  private blur(level: BloomLevel): void {
    const m = this.blurMat;
    const w = level.a.width;
    const h = level.a.height;
    m.uniforms.tSrc!.value = level.a.texture;
    m.uniforms.uStep!.value = [1 / w, 0];
    this.drawPass(m, level.b);
    // second direction writes back into `a`, then swap so that `b` always holds the final blurred image
    m.uniforms.tSrc!.value = level.b.texture;
    m.uniforms.uStep!.value = [0, 1 / h];
    this.drawPass(m, level.a);
    const t = level.a;
    level.a = level.b;
    level.b = t;
  }

  private drawPass(material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.passScene, this.camera);
  }

  private setDefine(m: ShaderMaterial, name: string, on: boolean): void {
    const d = (m.defines ??= {});
    if (on === (name in d)) return;
    if (on) d[name] = '';
    else delete d[name];
    m.needsUpdate = true;
  }

  /** Creates/re-creates the render targets whose key changed and returns the HDR scene target. */
  private ensureTargets(p: QualityProfile, levels: number): WebGLRenderTarget {
    const samples = resolveSamples(p.msaa, this.renderer.capabilities.maxSamples);
    const sceneKey = `${this.bufW}x${this.bufH}:${samples}:${this.wantDepthTex ? 'd' : ''}`;
    if (!this.sceneTarget || this.sceneKey !== sceneKey) {
      this.sceneTarget?.dispose();
      const rt = makeTarget(this.bufW, this.bufH, samples, true, this.wantDepthTex);
      // three resolves a multisampled target into its texture with one blitFramebuffer, depth and stencil included by default.
      // Resolving the packed depth-STENCIL of the 4x HDR target is the slow ANGLE/D3D11 path (three #27799): ~90 % of the high
      // tier's GPU frame (5.8-11 ms at 1080p). Nothing reads the stencil after the scene pass (the hero x-ray writes and tests it
      // INSIDE the multisampled pass, render/heroOutline.ts, so `stencilBuffer` stays on), and the depth is only read back through
      // the display-space overlay's depth texture, so it is resolved only while that texture is attached (the `d` of sceneKey
      // re-creates the target when it is attached, so the flag always matches). Bloom level targets are not multisampled.
      rt.resolveStencilBuffer = false;
      rt.resolveDepthBuffer = this.wantDepthTex;
      this.sceneTarget = rt;
      this.sceneKey = sceneKey;
    }
    const levelKey = `${this.bufW}x${this.bufH}:${levels}`;
    if (this.levelKey !== levelKey) {
      this.disposeLevels();
      for (const s of bloomChainSizes(this.bufW, this.bufH, levels)) {
        this.levels.push({ a: makeTarget(s.width, s.height, 0, false), b: makeTarget(s.width, s.height, 0, false) });
      }
      this.levelKey = levelKey;
    }
    return this.sceneTarget;
  }

  private disposeLevels(): void {
    for (const l of this.levels) {
      l.a.dispose();
      l.b.dispose();
    }
    this.levels.length = 0;
    this.levelKey = '';
  }

  private releaseTargets(): void {
    this.sceneTarget?.dispose();
    this.sceneTarget = null;
    this.sceneKey = '';
    this.disposeLevels();
  }
}

// Ported from threejs-vfx src/materials/IceMaterial.js and src/materials/GlacierMaterial.js (MIT, © mohamedachrefelouafi — see
// ./LICENSE). Procedurally shaded ice for GrowthField instances. The sandbox builds its crystals on a patched standard material so
// they pick up the stage's shadows and HDR probe; the game has neither, so this is a self-lit ShaderMaterial that keeps the
// sandbox's stylisation and replaces the probe with an analytic environment:
//   - thickness tint: a facet seen head-on looks down the long axis of the crystal, so it darkens toward the deep colour; grazing
//     edges stay pale — the term that makes the field read as a solid you can see into rather than blue plastic (IceMaterial).
//   - internal fracture (ridged noise in WORLD space: neighbouring crystals look quarried from the same block), feather veins and
//     rime creeping up from the base (fbm in LOCAL space: they follow each crystal's own axis), pinpoint glints (IceMaterial).
//   - light piped up the body to a bright point, and a chromatically split fresnel rim (GlacierMaterial).
//   - environment: a sky / horizon / ground gradient sampled by the reflected ray with a hard bright horizon band and a halo round
//     the key light (`frame.uLightDir`), plus a tight sun lobe and a wrapped key + hemisphere fill on the body. No env map, no
//     scene lights: the material compiles once and never recompiles when the scene's light count changes.
//   - the freeze front (`aGrow`): everything above a ragged cut up the instance's axis is discarded, so a crystal forms upward
//     rather than sliding out of a hole; and the shatter (`aShatter`): a per-fragment chunk id (half voronoi cell, half flat-face
//     hash) thresholded so a dying crystal loses whole plates one at a time, each break edge flaring (GlacierMaterial).
// Per-instance inputs: `aSeed`, `aBirth`, `aGrow`, `aShatter` (instanced attributes, see ./growthField). Use on an InstancedMesh.
import { Color, DoubleSide, NormalBlending, ShaderMaterial } from 'three';
import { putHex } from './color';
import { sharedUniforms } from './frame';
import { noiseGLSL } from './glsl/noise';

/** Shading controls (defaults = the sandbox's `ice` block; front / shatter / pipe from its `glacier` block). Read on every `sync`. */
export interface IceLook {
  /** how fast the deep tint builds with thickness */
  density: number;
  /** fresnel gain (opacity + rim) and its exponent */
  fresnel: number;
  fresnelPower: number;
  /** how far the rim's red / green / blue exponents come apart (a prism fringe) */
  dispersion: number;
  /** light bleeding through the cracks and veins */
  translucency: number;
  /** crispness of the per-facet value split */
  facetSharp: number;
  /** internal crack planes and their frequency (per metre) */
  fracture: number;
  fractureScale: number;
  /** milky feather frost inside the crystal and its scale */
  veins: number;
  veinScale: number;
  /** pinpoint surface glints: strength, frequency (per metre), drift speed */
  glint: number;
  glintScale: number;
  glintSpeed: number;
  /** rime banding climbing from the base */
  frostLine: number;
  /** light piped up the long faces, how hard it crowds the point, the bright point itself and where it begins (0..1) */
  pipe: number;
  tipBias: number;
  tipGlow: number;
  tipStart: number;
  /** overall emissive gain, silhouette rim brightness, extra glow on a crystal that has just arrived */
  glow: number;
  edgeGlow: number;
  birthGlow: number;
  /** analytic environment reflection, the sun lobe, the wrapped key light on the body and the hemisphere fill */
  env: number;
  specular: number;
  key: number;
  ambient: number;
  /** freeze front: ragged edge, lit band behind it, its brightness */
  frontRough: number;
  frontWidth: number;
  frontGlow: number;
  /** shatter: break-up cells per unit, width and brightness of a fresh break edge */
  shatterScale: number;
  shatterEdge: number;
  shatterGlow: number;
  opacity: number;
}

export function iceLook(): IceLook {
  return {
    density: 1.35, fresnel: 2.3, fresnelPower: 2.4, dispersion: 0.6, translucency: 1.5, facetSharp: 0.68, fracture: 0.62, fractureScale: 6.5,
    veins: 0.45, veinScale: 3.2, glint: 1.1, glintScale: 34, glintSpeed: 0.7, frostLine: 0.5, pipe: 0.5, tipBias: 1.6, tipGlow: 0.45,
    tipStart: 0.62, glow: 0.85, edgeGlow: 1.1, birthGlow: 1.6, env: 0.9, specular: 2, key: 0.72, ambient: 0.4, frontRough: 0.35,
    frontWidth: 0.12, frontGlow: 2.4, shatterScale: 7, shatterEdge: 0.08, shatterGlow: 3, opacity: 0.92,
  };
}

type IceColorUniform = 'uColorIce' | 'uColorDeep' | 'uColorRim' | 'uColorCore' | 'uColorTip' | 'uSkyZenith' | 'uSkyHorizon' | 'uSkyGround';
type IceFloatUniform =
  | 'uDensity' | 'uFresnel' | 'uFresnelPower' | 'uDispersion' | 'uTranslucency' | 'uFacetSharp' | 'uFracture' | 'uFractureScale' | 'uVeins'
  | 'uVeinScale' | 'uGlint' | 'uGlintScale' | 'uGlintSpeed' | 'uFrostLine' | 'uPipe' | 'uTipBias' | 'uTipGlow' | 'uTipStart' | 'uGlow'
  | 'uEdgeGlow' | 'uBirthGlow' | 'uEnv' | 'uSpecular' | 'uKey' | 'uAmbient' | 'uFrontRough' | 'uFrontWidth' | 'uFrontGlow'
  | 'uShatterScale' | 'uShatterEdge' | 'uShatterGlow' | 'uOpacity';
/** Uniform boxes of one IceMaterial (the frame clock, key light and global glow are shared by identity on top of these). */
export type IceUniforms = Record<IceColorUniform, { value: Color }> & Record<IceFloatUniform, { value: number }>;

function makeUniforms(): IceUniforms {
  return {
    uColorIce: { value: new Color(0.54, 0.85, 1) },
    uColorDeep: { value: new Color(0.24, 0.45, 0.48) },
    uColorRim: { value: new Color(0.95, 1, 1) },
    uColorCore: { value: new Color(0.39, 0.53, 0.59) },
    uColorTip: { value: new Color(1, 1, 1) },
    uSkyZenith: { value: new Color(0.36, 0.47, 0.58) },
    uSkyHorizon: { value: new Color(0.87, 0.91, 0.94) },
    uSkyGround: { value: new Color(0.16, 0.15, 0.13) },
    uDensity: { value: 1.15 },
    uFresnel: { value: 2.3 },
    uFresnelPower: { value: 2.4 },
    uDispersion: { value: 0.6 },
    uTranslucency: { value: 1.5 },
    uFacetSharp: { value: 0.68 },
    uFracture: { value: 0.62 },
    uFractureScale: { value: 6.5 },
    uVeins: { value: 0.45 },
    uVeinScale: { value: 3.2 },
    uGlint: { value: 1.1 },
    uGlintScale: { value: 34 },
    uGlintSpeed: { value: 0.7 },
    uFrostLine: { value: 0.5 },
    uPipe: { value: 0.5 },
    uTipBias: { value: 1.6 },
    uTipGlow: { value: 0.45 },
    uTipStart: { value: 0.62 },
    uGlow: { value: 0.85 },
    uEdgeGlow: { value: 1.1 },
    uBirthGlow: { value: 1.6 },
    uEnv: { value: 0.9 },
    uSpecular: { value: 2 },
    uKey: { value: 0.85 },
    uAmbient: { value: 0.55 },
    uFrontRough: { value: 0.35 },
    uFrontWidth: { value: 0.12 },
    uFrontGlow: { value: 2.4 },
    uShatterScale: { value: 7 },
    uShatterEdge: { value: 0.08 },
    uShatterGlow: { value: 3 },
    uOpacity: { value: 0.92 },
  };
}

const ICE_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aBirth;
  attribute float aGrow;
  attribute float aShatter;

  varying vec3  vLocal;
  varying vec3  vWorld;
  varying vec3  vNormalW;
  varying vec3  vView;
  varying vec3  vAxis;
  varying float vSeed;
  varying float vBirth;
  varying float vGrow;
  varying float vShatter;

  void main() {
    vLocal = position;
    vSeed = aSeed;
    vBirth = aBirth;
    vGrow = aGrow;
    vShatter = aShatter;

    vec3 objectNormal = normal;
    vec3 objectAxis = vec3(0.0, 1.0, 0.0);
    vec4 world;
    #ifdef USE_INSTANCING
      // A crystal is scaled (radius, height, radius), which is anisotropic: the instance matrix would tip every normal toward the
      // long axis. Dividing by the squared column lengths is the inverse-transpose three itself uses.
      mat3 im = mat3(instanceMatrix);
      vec3 invScale = max(vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])), vec3(1e-10));
      objectNormal = im * (objectNormal / invScale);
      objectAxis = im * (objectAxis / invScale);
      world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    #else
      world = modelMatrix * vec4(position, 1.0);
    #endif

    vWorld = world.xyz;
    vNormalW = mat3(modelMatrix) * objectNormal;
    vAxis = mat3(modelMatrix) * objectAxis;
    vView = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ICE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3  uLightDir;
  uniform float uGlobalGlow;
  uniform float uShaderIntensity;

  uniform vec3  uColorIce;
  uniform vec3  uColorDeep;
  uniform vec3  uColorRim;
  uniform vec3  uColorCore;
  uniform vec3  uColorTip;
  uniform vec3  uSkyZenith;
  uniform vec3  uSkyHorizon;
  uniform vec3  uSkyGround;

  uniform float uDensity;
  uniform float uFresnel;
  uniform float uFresnelPower;
  uniform float uDispersion;
  uniform float uTranslucency;
  uniform float uFacetSharp;
  uniform float uFracture;
  uniform float uFractureScale;
  uniform float uVeins;
  uniform float uVeinScale;
  uniform float uGlint;
  uniform float uGlintScale;
  uniform float uGlintSpeed;
  uniform float uFrostLine;
  uniform float uPipe;
  uniform float uTipBias;
  uniform float uTipGlow;
  uniform float uTipStart;
  uniform float uGlow;
  uniform float uEdgeGlow;
  uniform float uBirthGlow;
  uniform float uEnv;
  uniform float uSpecular;
  uniform float uKey;
  uniform float uAmbient;
  uniform float uFrontRough;
  uniform float uFrontWidth;
  uniform float uFrontGlow;
  uniform float uShatterScale;
  uniform float uShatterEdge;
  uniform float uShatterGlow;
  uniform float uOpacity;

  varying vec3  vLocal;
  varying vec3  vWorld;
  varying vec3  vNormalW;
  varying vec3  vView;
  varying vec3  vAxis;
  varying float vSeed;
  varying float vBirth;
  varying float vGrow;
  varying float vShatter;

  ${noiseGLSL}

  #define TAU 6.28318530718

  float pw(float x, float e) { return pow(max(x, 0.0), e); }

  /**
   * The room the crystal stands in, without a probe: a sky gradient over the horizon, a darker ground below it, a hard bright
   * band right at the horizon (what makes glass read as glass is a crisp light line sliding over the facets as they turn) and a
   * halo round the key light.
   */
  vec3 skyEnv(vec3 r, vec3 L) {
    float y = r.y;
    vec3 c = y >= 0.0 ? mix(uSkyHorizon, uSkyZenith, pw(y, 0.55)) : mix(uSkyHorizon * 0.6, uSkyGround, pw(-y, 0.4));
    c += uSkyHorizon * 0.55 * (1.0 - smoothstep(0.0, 0.1, abs(y + 0.03)));
    c += uSkyHorizon * pw(dot(r, L), 10.0) * 0.8;
    return c;
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vView);
    // double-sided: the far wall of a crystal is part of what you see through the near one, so its normal has to be flipped
    if (dot(N, V) < 0.0) N = -N;
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float h = clamp(vLocal.y, 0.0, 1.0);

    /* ---- the freeze front: everything above it does not exist yet ---- */
    // The roughness is added back before the noise is taken off again, so a fully grown crystal (aGrow = 1) never cuts into itself.
    float ragged = snoise01(vLocal * 5.0 + vSeed * 7.0) * uFrontRough;
    float front = vGrow * (1.0 + uFrontRough) - ragged;
    if (h > front) discard;
    float freezing = smoothstep(front - uFrontWidth, front, h) * (1.0 - smoothstep(0.985, 1.0, vGrow));

    /* ---- the shatter: plates and wedges leaving one at a time ---- */
    float breaking = 0.0;
    if (vShatter > 0.001) {
      vec2 cell = voronoi2(vLocal.xz * uShatterScale + vLocal.y * 4.0 + vSeed * 13.0);
      float facet = hash13(floor(N * 6.0) + vSeed * 3.0);
      float chunk = 0.55 * cell.y + 0.45 * facet;
      if (chunk < vShatter) discard;
      breaking = smoothstep(vShatter + uShatterEdge, vShatter, chunk);
    }

    float rimAmount = pw(1.0 - ndv, uFresnelPower);
    float fres = rimAmount * uFresnel;
    // facing a facet you look down the long axis of the crystal; at a grazing angle you only clip its edge
    float thickness = clamp(ndv * uDensity, 0.0, 1.0);

    // world space: crack planes keep a fixed physical size, so a small shard and a tall spike look cut from the same glacier
    float cracks = smoothstep(0.55, 0.98, ridged(vWorld * uFractureScale + vSeed * 37.0, 4));
    // local space: veining follows each crystal's own axis
    float veins = smoothstep(0.45, 0.92, fbm3(vLocal * uVeinScale * 4.0 + vSeed * 11.0) * 0.5 + 0.5);

    vec3 body = mix(uColorIce, uColorDeep, thickness);
    body = mix(body, uColorRim, veins * uVeins * 0.55);
    body = mix(body, uColorRim, cracks * uFracture * 0.4);
    // rime gathers where the crystal left the floor
    float rime = smoothstep(0.55, 0.0, vLocal.y) * (0.5 + 0.5 * fbm3(vLocal * 9.0 + vSeed * 5.0));
    body = mix(body, uColorRim, clamp(rime, 0.0, 1.0) * uFrostLine);
    // lift the facets that face the camera so the silhouette reads as a bundle of planes rather than one smooth mass
    body *= mix(1.0, 0.55 + 0.9 * ndv, uFacetSharp);

    /* ---- light: wrapped key + hemisphere fill on the body, the analytic room in the facets, a tight sun lobe ---- */
    vec3 L = normalize(uLightDir);
    float wrap = clamp((dot(N, L) + 0.4) / 1.4, 0.0, 1.0);
    vec3 fill = mix(uSkyGround, uSkyZenith, N.y * 0.5 + 0.5) * uAmbient;
    vec3 color = body * (fill + vec3(wrap * uKey)) * (1.0 - 0.45 * rimAmount);
    vec3 R = reflect(-V, N);
    color += skyEnv(R, L) * uEnv * (0.12 + 0.88 * rimAmount);
    color += uColorRim * pw(dot(R, L), 90.0) * uSpecular;

    /* ---- what glows ---- */
    // a chromatically split rim: the three channels take slightly different exponents, so every silhouette carries a fringe
    vec3 fresRGB = pow(vec3(1.0 - ndv), vec3(uFresnelPower * (1.0 - uDispersion * 0.4), uFresnelPower, uFresnelPower * (1.0 + uDispersion * 0.55)));
    // light piped up the long faces (not the caps) toward the point, with a slow band travelling up it
    float along = 1.0 - abs(dot(N, normalize(vAxis)));
    float band = 0.5 + 0.5 * sin((h * 1.4 - uTime * 0.6) * TAU + vSeed * 5.0);
    float pipe = along * pw(h, uTipBias) * mix(0.6, 1.0, band * band);
    float tip = smoothstep(uTipStart, 1.0, h);
    // pinpoint glints, biased to the grazing angles where ice catches
    float sp = pw(snoise(vWorld * uGlintScale + vec3(0.0, uTime * uGlintSpeed, 0.0) + vSeed * 23.0), 14.0) * smoothstep(0.0, 0.7, fres + 0.3);

    float detail = mix(0.7, 1.0, uShaderIntensity);
    vec3 glow = uColorRim * fresRGB * uEdgeGlow;
    glow += uColorCore * (cracks * uFracture * 0.8 + veins * uVeins * 0.35) * uTranslucency * detail;
    glow += uColorRim * sp * uGlint * 1.5;
    glow += uColorCore * pipe * uPipe + uColorTip * tip * uTipGlow;
    glow += uColorCore * vBirth * uBirthGlow;
    glow += uColorRim * freezing * uFrontGlow + uColorTip * breaking * uShatterGlow;
    glow *= uGlow;
    // Soft ceiling: the terms above all peak at a grazing angle and stack; without it a silhouette facet sums past 10 and the
    // bloom pass smears the crystal into a white blob. Reinhard leaves everything under ~1 alone and asymptotes at ~4.5.
    glow /= 1.0 + glow * 0.22;
    color += glow;

    // thin at the edges, denser through the body and along the cracks; solid where it is still freezing or breaking
    float alpha = clamp(uOpacity * (0.8 + 0.4 * fres) + cracks * 0.12 + freezing + breaking, 0.0, 1.0);
    gl_FragColor = vec4(color * uGlobalGlow, alpha);
  }
`;

export class IceMaterial extends ShaderMaterial {
  readonly u: IceUniforms;
  readonly look: IceLook = iceLook();

  constructor() {
    const u = makeUniforms();
    super({
      transparent: true,
      // kept on: the crystals are near-opaque, and writing depth stops the field sorting through itself and lets mist fade against it
      depthWrite: true,
      depthTest: true,
      blending: NormalBlending,
      // translucent: the far wall of a crystal is part of what you see through the near one
      side: DoubleSide,
      toneMapped: false,
      uniforms: { ...sharedUniforms(u) },
      vertexShader: ICE_VERTEX,
      fragmentShader: ICE_FRAGMENT,
    });
    this.u = u;
    this.sync();
  }

  /** Crystal palette, 0xRRGGBB sRGB: body, the deep tint thick ice builds toward, rim / frost, the light inside, the bright point. */
  setColors(ice: number, deep: number, rim: number, core: number, tip: number): void {
    const u = this.u;
    putHex(u.uColorIce.value, ice);
    putHex(u.uColorDeep.value, deep);
    putHex(u.uColorRim.value, rim);
    putHex(u.uColorCore.value, core);
    putHex(u.uColorTip.value, tip);
  }

  /** The analytic room the facets reflect: zenith, horizon, ground. */
  setSky(zenith: number, horizon: number, ground: number): void {
    putHex(this.u.uSkyZenith.value, zenith);
    putHex(this.u.uSkyHorizon.value, horizon);
    putHex(this.u.uSkyGround.value, ground);
  }

  /** Pushes `look` into the uniforms. */
  sync(): void {
    const l = this.look;
    const u = this.u;
    u.uDensity.value = l.density;
    u.uFresnel.value = l.fresnel;
    u.uFresnelPower.value = l.fresnelPower;
    u.uDispersion.value = l.dispersion;
    u.uTranslucency.value = l.translucency;
    u.uFacetSharp.value = l.facetSharp;
    u.uFracture.value = l.fracture;
    u.uFractureScale.value = l.fractureScale;
    u.uVeins.value = l.veins;
    u.uVeinScale.value = l.veinScale;
    u.uGlint.value = l.glint;
    u.uGlintScale.value = l.glintScale;
    u.uGlintSpeed.value = l.glintSpeed;
    u.uFrostLine.value = l.frostLine;
    u.uPipe.value = l.pipe;
    u.uTipBias.value = l.tipBias;
    u.uTipGlow.value = l.tipGlow;
    u.uTipStart.value = l.tipStart;
    u.uGlow.value = l.glow;
    u.uEdgeGlow.value = l.edgeGlow;
    u.uBirthGlow.value = l.birthGlow;
    u.uEnv.value = l.env;
    u.uSpecular.value = l.specular;
    u.uKey.value = l.key;
    u.uAmbient.value = l.ambient;
    u.uFrontRough.value = l.frontRough;
    u.uFrontWidth.value = l.frontWidth;
    u.uFrontGlow.value = l.frontGlow;
    u.uShatterScale.value = l.shatterScale;
    u.uShatterEdge.value = l.shatterEdge;
    u.uShatterGlow.value = l.shatterGlow;
    u.uOpacity.value = l.opacity;
  }
}

// Terrain splat material: MeshStandardMaterial patched (onBeforeCompile) so it keeps the scene's hemisphere/sun lighting,
// Engine's dynamic sun shadow map and fog, while the surface itself is a height-blended splat of up to 8 ground layers
// (sampler2DArray), triplanar cliffs with strata + optional snow caps, anti-tiling, macro colour + hue variation, the baked
// static light texture (sun visibility / AO / liquid proximity / cliff-foot proximity), baked light pools, procedural ground
// decals and the central seal (terrainDecals.ts), per-layer roughness, tinted shadow fill and a soft hero glow. Cloud
// shadows, depth haze and ground mist come from the shared atmosphere patch (atmosphere.ts).
//
// Zones core (2026-10-13), every feature behind a define that is only set when the zone look asks for it, so a look without
// the new knobs compiles exactly the old shader:
//   CLIFF_V2   style.cliff: stain / strata knobs, power-8 triplanar blend, anisotropy-limited gradients, luma floor, AO
//              floor, sky-coloured rim fill (C1)
//   CLIFF_FOOT style.cliff.foot: scree band at the cliff foot from the baked foot proximity (light texture alpha) (C1)
//   CALM       style.calm: large soft patches where the tile detail recedes to a blurred mip, the layer average and a cut
//              normal (C2)
//   BLEND_V2   style.blend or a GroundLayer.h: splat border window / height gain / noise breakup / per-layer bias (C2)
//   LAVA_SHORE liquidLook.lava.shore: crust glow and lava shore light near the lava band (C3, terrain side)
//   DECALS / DECALS_V2  6 decal slots and the C8 kinds (C8)
//   FAR_FIELD  the far-field variant (farMaterial) shades the annulus beyond the domain as rock fading into fog (C6)
// Zones core A3 (core builder A, 2026-10-22), also behind defines that exist only when the look asks:
//   CLIFF_ONSET style.cliff.onset / onsetNoise: the slope band where rock takes over and the noise that shifts it (calm lawn slopes)
//   CLIFF_CAPK  style.cliff.cap: strength of the up-facing cap layer on steep ground (0 = off); an unset knob keeps the old cap
//   MEDALLION   look.medallion: one non-tiling picture on the plaza centre (A4), drawn under the seal and the decals
import { Color, MeshStandardMaterial, ShaderChunk, Vector2, Vector3, Vector4, type DataTexture, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import type { ZoneLayout } from '../../world/layoutTypes';
import type { QualityProfile } from '../quality';
import { medallionEmissive } from './arc';
import { applyAtmosphere, atmosphereUniforms } from './atmosphere';
import type { LayerArrays } from './layerTextures';
import type { ZoneLook } from './look/types';
import { DECAL_GLSL, DECAL_KIND_ID, usesDecalsV2, type DecalKindV2 } from './terrainDecals';
import { worldUniforms } from './zoneContext';

export interface TerrainMaterialOptions {
  layers: LayerArrays;
  splat0: DataTexture;
  splat1: DataTexture;
  /** the shared tileable noise (macroNoise.ts) */
  noise: DataTexture;
  light: DataTexture;
  pools: DataTexture;
  layout: ZoneLayout;
  look: ZoneLook;
  /** seal centre in world metres (null = no seal) */
  sealAt: { x: number; z: number } | null;
  size: number;
  /** A4: the loaded medallion picture and its centre in world metres (absent / null = no medallion) */
  medallion?: Texture | null;
  medallionAt?: { x: number; z: number } | null;
}

/**
 * PL-03a: what the run light arc drives on the terrain material per frame (arc.ts). `shadowTint` is a working-space colour like
 * the one `linear(look.fill.shadowTint)` makes; the medallion glow is ADDED to MedallionSpec.emissive and clamped to 0..1.
 */
export interface TerrainArc {
  shadowTint: Color;
  shadowFill: number;
  medallionGlow: number;
}

export interface TerrainMaterial {
  material: MeshStandardMaterial;
  /** the far-field variant (rock only, no splat / baked light) for the annulus beyond the domain (C6); created on demand */
  farMaterial(): MeshStandardMaterial;
  setQuality(p: QualityProfile): void;
  /** PL-03a: the run arc's shadow tint / fill and medallion glow for this frame (uniforms only); null = the look's own values */
  setArc(a: TerrainArc | null): void;
  /** swap in rebuilt layer arrays (quality change) */
  setLayers(l: LayerArrays): void;
  dispose(): void;
}

// PL-03a: the newest terrain material and the arc state last pushed to it. The terrain builds its material after the zone scene
// exists (and again on a layer rebuild), so the state is kept and handed to a material created later.
let liveTerrain: TerrainMaterial | null = null;
const liveArc: TerrainArc = { shadowTint: new Color(), shadowFill: 0, medallionGlow: 0 };
let liveArcOn = false;

/** PL-03a: drives the live terrain material from the run arc (zoneScene, every frame the arc moved); null = back to the look's values. */
export function setTerrainArc(a: TerrainArc | null): void {
  liveArcOn = a !== null;
  if (a) {
    liveArc.shadowTint.copy(a.shadowTint);
    liveArc.shadowFill = a.shadowFill;
    liveArc.medallionGlow = a.medallionGlow;
  }
  liveTerrain?.setArc(a ? liveArc : null);
}

/** decal slots compiled by default; a look with more families (C8) compiles MAX_DECALS */
const BASE_DECALS = 4;
export const MAX_DECALS = 6;
const DEFAULT_ROUGHNESS = 0.95;

/** C1 defaults = the old shader constants */
export const CLIFF_DEFAULTS = { stainAmp: 0.28, stainAspect: 0.17 / 0.006, strataAmp: 0.46, strataScale: 20 } as const;
/** C2 defaults = the old shader constants */
export const BLEND_DEFAULTS = { window: 0.34, heightK: 0.9, edgeNoise: 0, warp: 1 } as const;

const DECLS = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNrm;
uniform sampler2DArray uAlbedo;
// the atmosphere patch (atmosphere.ts) declares these under collision-free names; the terrain code uses the short ones
#define uNoise uAtmoNoise
#define uTime uAtmoTime
#define uWindDir uAtmoWind
#define uFocus uAtmoFocus
#ifdef Q_NORMALS
uniform sampler2DArray uNormal;
#endif
uniform sampler2D uSplat0;
uniform sampler2D uSplat1;
uniform sampler2D uLight;
uniform sampler2D uPools;
uniform vec4 uLayer[LAYERS];
uniform vec3 uTint[LAYERS];
uniform float uRough[LAYERS];
uniform float uSize;
uniform float uHalf;
uniform vec2 uCliff;
uniform float uCliffLayer;
uniform float uCapLayer;
uniform float uEmissiveLayer;
uniform vec2 uEmitCap;
uniform vec3 uCliffTint;
uniform vec3 uMacroDark;
uniform vec3 uMacroLight;
uniform float uMacroStrength;
uniform float uMacroScale;
uniform vec3 uAccentA;
uniform vec3 uAccentB;
uniform vec2 uAccent;
uniform float uSat;
uniform float uGain;
uniform float uShoreWet;
uniform float uLiquidLevel;
uniform float uLavaGlow;
uniform float uSparkle;
uniform float uNormalScale;
uniform vec3 uSunDir;
uniform vec3 uShadowTint;
uniform vec3 uShadowParams;
// PL-03a: run-arc multiplier of the baked light-pool emissive (shared with the atmosphere uniforms; 1 = as baked)
uniform float uPoolGain;
uniform vec4 uHeroGlow;
uniform vec3 uHeroGlowCol;
// C1: x stain amplitude, y stain vertical stretch, z strata amplitude, w strata metres per noise period
uniform vec4 uCliffA;
// C1: x luma floor (final albedo), y AO floor on steep faces, z sky-coloured rim fill, w unused
uniform vec4 uCliffB;
uniform vec3 uCliffSky;
uniform vec3 uFootCol;
// C2: x share of calm ground, y metres per calm patch, z normal cut, w mip levels of blur inside a calm patch
uniform vec4 uCalm;
// C2: x border window, y height gain, z edge noise, w A1: multiplier of the splat lookup warp (1 = the old 1.8 m / 0.5 m wobble)
uniform vec4 uBlend;
// C3 (terrain side of the lava look): x lava shore light, y crust glow inside the lava band
uniform vec2 uLavaShore;
// A3: x amplitude of the noise that shifts the cliff onset (old shader 0.12), y cap layer strength
uniform vec3 uCliffC;

float gSunVis = 1.0;
float gAO = 1.0;
float gRough = 0.95;
float gLW[8];
vec2 gDecalSun = vec2(0.7, 0.7);
vec3 gEmissive = vec3(0.0);
vec3 gWNormal = vec3(0.0, 1.0, 0.0);
// C1: |face normal| of the triangle (from derivatives, taken in uniform control flow)
vec3 gFaceN = vec3(0.0, 1.0, 0.0);
// C6: filter-footprint multiplier of the cliff rock lookups (1 = native; the far field blurs the tile so its cells do not
// read as paving)
float gRockBlur = 1.0;
`;

const SHADE = /* glsl */ `
vec3 sampleAlb(vec2 uv, vec2 dx, vec2 dy, float layer, float scale) {
#ifdef Q_FAST
  return texture(uAlbedo, vec3(uv * scale, layer)).rgb;
#else
  vec3 a = textureGrad(uAlbedo, vec3(uv * scale, layer), dx * scale, dy * scale).rgb;
#ifdef Q_ANTITILE
  mat2 R = mat2(0.866, 0.5, -0.5, 0.866) * 0.37;
  vec3 b = textureGrad(uAlbedo, vec3(R * uv * scale + 0.31, layer), R * dx * scale, R * dy * scale).rgb;
  float lum = dot(a, vec3(0.3, 0.5, 0.2));
  float lumb = dot(b, vec3(0.3, 0.5, 0.2));
  // keep the sharper first sample and pull the mean of the second in so repeats stop lining up
  a = mix(a, b + (lum - lumb), 0.42);
#endif
  return a;
#endif
}

// mean colour of a layer (its smallest mip)
vec3 layerMean(float layer) {
  return textureLod(uAlbedo, vec3(0.5, 0.5, layer), 14.0).rgb;
}

// C1: raise the luma of c to at least f; the stronger the lift, the more of it goes into neutral grey
vec3 liftLuma(vec3 c, float f) {
  float L = dot(c, vec3(0.3, 0.5, 0.2));
  float k = max(1.0, f / max(L, 1e-3));
  vec3 lifted = c * k;
  return mix(lifted, vec3(dot(lifted, vec3(0.3, 0.5, 0.2))), clamp((k - 1.0) * 0.35, 0.0, 0.6));
}

#ifdef CLIFF_V2
// C1: caps the filter footprint at 2:1 by widening the short axis: a long thin footprint smears the rock along the steep axis
void limitAniso(inout vec2 gx, inout vec2 gy) {
  float lx = dot(gx, gx);
  float ly = dot(gy, gy);
  if (lx > 4.0 * ly) gy = vec2(-gx.y, gx.x) * 0.5;
  else if (ly > 4.0 * lx) gx = vec2(-gy.y, gy.x) * 0.5;
}
#endif

#ifdef CALM
// C2: large soft patches (uCalm.y metres per feature) where the tile detail recedes; uCalm.x = share of calm ground
float terrainCalm(vec2 wxz) {
  if (uCalm.x >= 0.999) return 1.0;
  float n = texture2D(uNoise, wxz / (uCalm.y * 3.0) + vec2(0.37, 0.71)).r * 0.72 + texture2D(uNoise, wxz / (uCalm.y * 1.3) + vec2(0.13, 0.52)).g * 0.28;
  return smoothstep(-0.09, 0.09, n - (0.5 - (uCalm.x - 0.5) * 0.36));
}
#endif

// triplanar cliff rock: albedo (tinted, broad streaks, strata, stains) and the rock normal Nr (world)
vec3 cliffRock(vec3 Ng, vec4 mB, float dist, out vec3 Nr) {
  float cl = uCliffLayer;
  float sc = uLayer[int(cl + 0.5)].x * 0.8;
#ifdef Q_FAST
  vec3 bw = abs(Ng);
  bw *= bw;
  bw /= max(bw.x + bw.y + bw.z, 1e-4);
  vec2 sideUv = bw.x > bw.z ? vWPos.zy : vWPos.xy;
  vec3 rock = texture(uAlbedo, vec3(vWPos.xz * sc, cl)).rgb * bw.y
            + texture(uAlbedo, vec3(sideUv * sc, cl)).rgb * (1.0 - bw.y);
  rock *= uTint[int(cl + 0.5)] * uCliffTint * (0.82 + 0.36 * mB.g);
  Nr = Ng;
  return rock;
#else
#ifdef CLIFF_V2
  // sharper blend (power 8); a projection the actual triangle is nearly parallel to (the smooth vertex normal disagrees
  // with a near-vertical 1 m triangle) would stretch the texture into streaks, so it is dropped
  vec3 bw = abs(Ng);
  bw *= bw;
  bw *= bw;
  bw *= bw;
  bw = bw * smoothstep(vec3(0.12), vec3(0.4), gFaceN) + 1e-3 * gFaceN * gFaceN;
#else
  vec3 bw = pow(abs(Ng), vec3(4.0));
#endif
  bw /= (bw.x + bw.y + bw.z);
  vec2 pX = vWPos.zy * sc;
  vec2 pY = vWPos.xz * sc;
  vec2 pZ = vWPos.xy * sc;
  vec2 gxX = dFdx(vWPos.zy) * sc;
  vec2 gyX = dFdy(vWPos.zy) * sc;
  vec2 gxY = dFdx(vWPos.xz) * sc;
  vec2 gyY = dFdy(vWPos.xz) * sc;
  vec2 gxZ = dFdx(vWPos.xy) * sc;
  vec2 gyZ = dFdy(vWPos.xy) * sc;
  gxX *= gRockBlur; gyX *= gRockBlur; gxY *= gRockBlur; gyY *= gRockBlur; gxZ *= gRockBlur; gyZ *= gRockBlur;
#ifdef CLIFF_V2
  limitAniso(gxX, gyX);
  limitAniso(gxY, gyY);
  limitAniso(gxZ, gyZ);
#endif
  vec3 rock = vec3(0.0);
  rock += textureGrad(uAlbedo, vec3(pX, cl), gxX, gyX).rgb * bw.x;
  rock += textureGrad(uAlbedo, vec3(pY, cl), gxY, gyY).rgb * bw.y;
  rock += textureGrad(uAlbedo, vec3(pZ, cl), gxZ, gyZ).rgb * bw.z;
  rock *= uTint[int(cl + 0.5)] * uCliffTint;
  // broad dirt streaks, horizontal strata bands and vertical rain stains so a face is never one flat texture
  rock *= 0.82 + 0.36 * mB.g;
  float yy = vWPos.y;
#ifdef CLIFF_V2
  float strata = texture2D(uNoise, vec2(yy / uCliffA.w, (vWPos.x + vWPos.z) * 0.004)).g;
  float bands = texture2D(uNoise, vec2(yy * 0.42 / uCliffA.w + 0.13, (vWPos.x - vWPos.z) * 0.002)).r;
  float stain = texture2D(uNoise, vec2((vWPos.x + vWPos.z) * 0.17, yy * 0.17 / uCliffA.y)).b;
  rock *= ((0.99 - 0.5 * uCliffA.z) + uCliffA.z * smoothstep(0.25, 0.75, strata) + 0.2 * (bands - 0.5)) * ((1.0 - 0.5 * uCliffA.x) + uCliffA.x * stain);
#else
  float strata = texture2D(uNoise, vec2(yy * 0.05, (vWPos.x + vWPos.z) * 0.004)).g;
  float bands = texture2D(uNoise, vec2(yy * 0.021 + 0.13, (vWPos.x - vWPos.z) * 0.002)).r;
  float stain = texture2D(uNoise, vec2((vWPos.x + vWPos.z) * 0.17, yy * 0.006)).b;
  rock *= (0.76 + 0.46 * smoothstep(0.25, 0.75, strata) + 0.2 * (bands - 0.5)) * (0.86 + 0.28 * stain);
#endif
  Nr = Ng;
#ifdef Q_NORMALS
  vec3 tX = textureGrad(uNormal, vec3(pX, cl), gxX, gyX).xyz * 2.0 - 1.0;
  vec3 tY = textureGrad(uNormal, vec3(pY, cl), gxY, gyY).xyz * 2.0 - 1.0;
  vec3 tZ = textureGrad(uNormal, vec3(pZ, cl), gxZ, gyZ).xyz * 2.0 - 1.0;
  float ns = uLayer[int(cl + 0.5)].y * uNormalScale * (1.0 - smoothstep(70.0, 150.0, dist));
  tX = vec3(tX.xy * ns + Ng.zy, abs(tX.z) * Ng.x);
  tY = vec3(tY.xy * ns + Ng.xz, abs(tY.z) * Ng.y);
  tZ = vec3(tZ.xy * ns + Ng.xy, abs(tZ.z) * Ng.z);
  Nr = normalize(tX.zyx * bw.x + tY.xzy * bw.y + tZ.xyz * bw.z);
#endif
  return rock;
#endif
}

// macro colour variation (brightness + hue patches) and grading
vec3 terrainGrade(vec3 alb, vec2 wxz, vec4 mB) {
  float m = smoothstep(0.22, 0.78, mB.r * 0.62 + mB.g * 0.38);
  alb *= mix(vec3(1.0), mix(uMacroDark, uMacroLight, m), uMacroStrength);
#ifndef Q_FAST
  if (uAccent.x > 0.0) {
    vec4 mH = texture2D(uNoise, wxz / uAccent.y + vec2(0.27, 0.61));
    alb *= mix(vec3(1.0), mix(uAccentA, uAccentB, smoothstep(0.3, 0.7, mH.g * 0.55 + mH.r * 0.45)), uAccent.x);
  }
#endif
  float lumA = dot(alb, vec3(0.3, 0.5, 0.2));
  return mix(vec3(lumA), alb, uSat) * uGain;
}

#ifdef FAR_FIELD
// C6: the annulus beyond the domain: zone rock only (no splat, no baked light), fading into the fog
void terrainFar(out vec3 outAlb) {
  vec2 wxz = vWPos.xz;
  vec3 Ng = normalize(vWNrm);
  gFaceN = abs(normalize(cross(dFdx(vWPos), dFdy(vWPos))));
  vec4 mB = texture2D(uNoise, wxz / uMacroScale);
  float dist = length(vViewPosition);
  vec3 Nr;
  // the tile is blurred (more with the distance past the domain edge): its cell structure would read as paving here
  gRockBlur = 4.0 + 12.0 * smoothstep(0.0, 160.0, max(abs(vWPos.x), abs(vWPos.z)) - uHalf);
  vec3 rock = uCliffLayer >= 0.0 ? cliffRock(Ng, mB, dist, Nr) : vec3(0.35);
  if (uCliffLayer < 0.0) Nr = Ng;
  // broad light / dark patches so the far slopes do not read as one tone
  vec4 mF = texture2D(uNoise, wxz / 260.0 + vec2(0.41, 0.17));
  rock *= 0.78 + 0.44 * mF.r;
  vec3 alb = liftLuma(terrainGrade(rock, wxz, mB), uCliffB.x);
  gSunVis = 1.0;
  gAO = 0.85;
  gRough = 0.95;
  gEmissive += alb * uCliffSky * (0.12 + uCliffB.z);
  gWNormal = Nr;
  outAlb = alb;
}
#endif

void terrainShade(out vec3 outAlb) {
#ifdef FAR_FIELD
  terrainFar(outAlb);
  return;
#endif
  vec2 wxz = vWPos.xz;
  vec3 Ng = normalize(vWNrm);
#if defined(CLIFF_V2) && !defined(Q_FAST)
  gFaceN = abs(normalize(cross(dFdx(vWPos), dFdy(vWPos))));
#endif
#ifdef Q_FAST
  vec2 dx = vec2(0.0);
  vec2 dy = vec2(0.0);
  float pix = 0.0;
#else
  vec2 dx = dFdx(wxz);
  vec2 dy = dFdy(wxz);
  float pix = max(length(dx), length(dy));
#endif
  vec2 suv = (wxz + uHalf) / uSize;
  vec4 mA = texture2D(uNoise, wxz / 53.0);
  vec4 mB = texture2D(uNoise, wxz / uMacroScale);
#ifdef Q_FAST
  vec4 mC = mA;
  vec2 warp = (mA.rg - 0.5) * 1.8 * uBlend.w;
#else
  vec4 mC = texture2D(uNoise, wxz / 13.0);
  vec2 warp = ((mA.rg - 0.5) * 1.8 + (mC.rg - 0.5) * 0.5) * uBlend.w;
#endif
  vec2 suvW = suv + warp / uSize;
  vec4 c0 = texture2D(uSplat0, suvW);
  vec4 c1 = texture2D(uSplat1, suvW);
  float w[8];
  w[0] = c0.r; w[1] = c0.g; w[2] = c0.b; w[3] = c0.a;
  w[4] = c1.r; w[5] = c1.g; w[6] = c1.b; w[7] = c1.a;
  // baked static light: R sun visibility, G AO, B liquid proximity, A cliff-foot proximity
  vec4 bl = texture2D(uLight, suv);

  // ---- calm patches (C2): the tile detail recedes to a blurred mip inside large soft patches ----------------------
#if defined(CALM) && !defined(Q_FAST)
  float calm = terrainCalm(wxz);
  float calmBlur = exp2(calm * uCalm.w);
  vec2 dxl = dx * calmBlur;
  vec2 dyl = dy * calmBlur;
#else
  vec2 dxl = dx;
  vec2 dyl = dy;
#endif
#if defined(BLEND_V2) && !defined(Q_FAST)
  // ragged border noise: ~1.5-3 m lobes plus a ~0.3 m fray
  vec4 nE = texture2D(uNoise, wxz * 0.11) - 0.5;
  vec4 nF = texture2D(uNoise, wxz * 0.53 + 0.29) - 0.5;
  nE.rgb = nE.rgb * 0.65 + vec3(nF.g, nF.b, nF.g) * 0.55;
#endif

  // ---- height-blended ground layers -------------------------------------------------------------------------------
  vec3 col[8];
  float hgt[8];
  float wf[8];
  float mx = 0.0;
#ifdef Q_FAST
  const float minW = 0.06;
#else
  const float minW = 0.006;
#endif
  for (int i = 0; i < LAYERS; i++) {
    wf[i] = 0.0;
    col[i] = vec3(0.0);
    hgt[i] = 0.0;
    if (w[i] > minW) {
      vec3 a = sampleAlb(wxz, dxl, dyl, float(i), uLayer[i].x) * uTint[i];
#if defined(CALM) && !defined(Q_FAST)
      // what is left of the blurred detail fades into the layer's mean colour (a soft tonal patch, not a smeared tile)
      a = mix(a, layerMean(float(i)) * uTint[i], calm * calm * 0.7);
#endif
      col[i] = a;
      hgt[i] = dot(a, vec3(0.3, 0.5, 0.2));
#if defined(BLEND_V2) && !defined(Q_FAST)
      // C2: per-layer bias (GroundLayer.h, weight units) and a per-layer noise breakup of the borders
      float fi = float(i);
      hgt[i] = hgt[i] * uBlend.y + uLayer[i].z + dot(nE.rgb, vec3(sin(fi * 2.4 + 0.3), cos(fi * 1.7 + 1.1), sin(fi * 3.1 + 2.2))) * uBlend.z;
      mx = max(mx, w[i] + hgt[i]);
#else
      mx = max(mx, w[i] + hgt[i] * 0.9);
#endif
    }
  }
  float wsum = 0.0;
  vec3 alb = vec3(0.0);
  for (int i = 0; i < LAYERS; i++) {
    if (w[i] > minW) {
#if defined(BLEND_V2) && !defined(Q_FAST)
      float b = max(w[i] + hgt[i] - (mx - uBlend.x), 0.0);
#else
      float b = max(w[i] + hgt[i] * 0.9 - (mx - 0.34), 0.0);
#endif
      wf[i] = b;
      wsum += b;
      alb += col[i] * b;
    }
  }
  float inv = 1.0 / max(wsum, 1e-4);
  alb *= inv;
  float rough = 0.0;
  for (int i = 0; i < 8; i++) {
    gLW[i] = i < LAYERS ? wf[i] * inv : 0.0;
  }
  for (int i = 0; i < LAYERS; i++) rough += gLW[i] * uRough[i];
  gRough = rough;

  // ---- ground normal (tangent space xy accumulated) ---------------------------------------------------------------
  vec2 nxy = vec2(0.0);
#ifdef Q_NORMALS
  for (int i = 0; i < LAYERS; i++) {
    if (wf[i] > 0.0) {
      float s = uLayer[i].x;
      vec3 nm = textureGrad(uNormal, vec3(wxz * s, float(i)), dxl * s, dyl * s).xyz * 2.0 - 1.0;
      nxy += nm.xy * (wf[i] * inv) * uLayer[i].y;
    }
  }
  nxy *= uNormalScale;
#ifdef CALM
  nxy *= 1.0 - calm * uCalm.z;
#endif
#endif
  float dist = length(vViewPosition);
  nxy *= 1.0 - smoothstep(70.0, 150.0, dist);
  vec3 tRef = abs(Ng.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 T = normalize(tRef - Ng * dot(tRef, Ng));
  vec3 B = cross(T, Ng);
  float nz = sqrt(max(0.1, 1.0 - dot(nxy, nxy)));
  vec3 N = normalize(T * nxy.x + B * nxy.y + Ng * nz);

  // ---- emissive crust layer (lava veins): only glows where the layer really dominates ------------------------------
  if (uEmissiveLayer >= 0.0) {
    int el = int(uEmissiveLayer + 0.5);
    float we = smoothstep(uEmitCap.x, uEmitCap.y, wf[el] * inv);
#ifdef LAVA_SHORE
    // C3: the crust glow inside the lava band (the white crackle halo along the banks) has its own strength
    we *= mix(1.0, uLavaShore.y, smoothstep(0.02, 0.3, bl.b));
#endif
    if (we > 0.0) {
      vec3 a = col[el];
      float hot = clamp((a.r - 0.30) * 3.0, 0.0, 1.0) * clamp((a.r - a.b * 1.6) * 3.0, 0.0, 1.0);
      gEmissive += a * hot * we * 3.2 * uLavaGlow * (0.8 + 0.2 * sin(uTime * 1.3 + mB.r * 20.0));
    }
  }

  // ---- steep faces: triplanar cliff layer with strata, optional snow cap ------------------------------------------
#ifdef CLIFF_ONSET
  // A3: the noise that shifts the onset has its own amplitude (0 = a clean slope threshold, no rock on a 20-26 deg lawn slope)
  float steep = 1.0 - Ng.y + (mA.b - 0.5) * uCliffC.x;
#else
  float steep = 1.0 - Ng.y + (mA.b - 0.5) * 0.12;
#endif
  float cw = smoothstep(uCliff.x, uCliff.y, steep);
  if (cw > 0.002 && uCliffLayer >= 0.0) {
    vec3 Nr;
    vec3 rock = cliffRock(Ng, mB, dist, Nr);
    if (uCapLayer >= 0.0) {
      float capW = smoothstep(0.25, 0.8, Ng.y + (mB.r - 0.5) * 0.5 + (mC.g - 0.5) * 0.25) * smoothstep(0.0, 0.3, cw);
#ifdef CLIFF_CAPK
      capW *= uCliffC.y;
#endif
      vec3 cap = sampleAlb(wxz, dx, dy, uCapLayer, uLayer[int(uCapLayer + 0.5)].x) * uTint[int(uCapLayer + 0.5)];
      rock = mix(rock, cap, capW);
      Nr = normalize(mix(Nr, Ng, capW * 0.7));
    }
    if (uEmissiveLayer >= 0.0) {
      // painted lava / crust stripes survive on the faces (lava-falls)
      int el2 = int(uEmissiveLayer + 0.5);
      rock = mix(rock, col[el2], smoothstep(0.3, 0.8, gLW[el2]));
    }
    alb = mix(alb, rock, cw);
    N = normalize(mix(N, Nr, cw));
  }

  // ---- macro colour variation (brightness + hue patches), grading ----------------------------------------------------
  alb = terrainGrade(alb, wxz, mB);
#ifdef CLIFF_V2
  // C1: a cliff face never goes black: minimum albedo luma, scaled by the cliff weight; what has to be lifted a lot is
  // also partly desaturated (dark mossy / sooty texels become pale stone, not a neon tint)
  alb = liftLuma(alb, uCliffB.x * cw);
#endif
#if defined(CLIFF_FOOT) && !defined(Q_FAST)
  // C1: scree band at the cliff foot (baked foot proximity, ground only), grained by the rock texture seen from above
  {
    float footW = smoothstep(0.06, 0.6, bl.a) * (1.0 - cw);
    if (footW > 0.002 && uCliffLayer >= 0.0) {
      int fcl = int(uCliffLayer + 0.5);
      vec3 r = sampleAlb(wxz, dx, dy, uCliffLayer, uLayer[fcl].x * 1.7);
      float rl = dot(r, vec3(0.3, 0.5, 0.2)) / max(dot(layerMean(uCliffLayer), vec3(0.3, 0.5, 0.2)), 0.02);
      vec3 scree = uFootCol * clamp(rl, 0.45, 1.6) * (0.9 + 0.2 * mC.b);
      alb = mix(alb, scree, footW * (0.8 + 0.2 * mA.g));
    }
  }
#endif

  // ---- baked static light ----------------------------------------------------------------------------------------
#ifdef CLIFF_V2
  float blG = mix(bl.g, max(bl.g, uCliffB.y), cw);
#else
  float blG = bl.g;
#endif
  gSunVis = mix(1.0, bl.r, uShadowParams.y);
  gAO = mix(1.0, blG, 0.95 * uShadowParams.z);
  alb *= mix(1.0 - 0.22 * uShadowParams.z, 1.0, blG);
  if (uShoreWet > 0.0) {
    float wet = (1.0 - smoothstep(0.0, 0.75, vWPos.y - uLiquidLevel)) * uShoreWet * smoothstep(0.05, 0.4, bl.b);
    alb *= mix(1.0, 0.58, wet);
  }
  if (uLavaGlow > 0.0) {
    float g = pow(bl.b, 1.4) * (0.7 + 0.3 * sin(uTime * 1.9 + mB.g * 30.0));
#ifdef LAVA_SHORE
    g *= uLavaShore.x;
#endif
    gEmissive += vec3(1.0, 0.33, 0.06) * g * 0.75 * uLavaGlow * (1.0 - cw * 0.5);
  }
#ifndef Q_FAST
  if (uSparkle > 0.0) {
    float g = texture2D(uNoise, wxz * 0.13).a;
    float tw = 0.5 + 0.5 * sin(uTime * 2.3 + g * 90.0);
    gEmissive += vec3(0.8, 0.9, 1.0) * step(0.975, g) * tw * uSparkle * (1.0 - cw) * (1.0 - smoothstep(30.0, 90.0, dist));
  }
#endif

  // ---- procedural ground dressing (seal, then decals on top of it): ground only, never on cliff faces --------------------
#ifdef MEDALLION
  groundMedallion(alb, gEmissive, N, wxz, dx, dy, cw);
#endif
#ifdef Q_DECOR
  gDecalSun = normalize(uSunDir.xz + 1e-4);
  vec3 dEmi = vec3(0.0);
  groundSeal(alb, dEmi, N, gRough, wxz, pix, cw);
  groundDecals(alb, dEmi, wxz, pix, dist, bl.g, cw, bl.b, Ng);
  gEmissive += dEmi;
#endif

  // ---- light: tinted fill in shadow, baked light pools, hero glow ---------------------------------------------------
  float lit = max(dot(N, uSunDir), 0.0) * gSunVis;
  gEmissive += alb * uShadowTint * (uShadowParams.x * (1.0 - lit));
#ifdef CLIFF_V2
  // C1: sky-coloured lift on the faces (strongest on the shaded side)
  gEmissive += alb * uCliffSky * (uCliffB.z * cw * (1.0 - 0.5 * lit));
#endif
  vec4 pl = texture2D(uPools, suv);
  float flick = 1.0 + pl.a * 0.7 * (0.6 * sin(uTime * 7.3 + wxz.x * 0.41 + wxz.y * 0.57) + 0.4 * sin(uTime * 11.1 + wxz.x * 0.9));
  gEmissive += alb * pl.rgb * (2.0 * flick * uPoolGain);
  if (uHeroGlow.x > 0.0) {
    float hg = fall(uHeroGlow.w * 0.12, uHeroGlow.w, distance(wxz, uFocus.xz));
    gEmissive += alb * uHeroGlowCol * (uHeroGlow.x * hg * hg);
  }
  gWNormal = N;
  outAlb = alb;
}
`;

/** C6 far field: the fog depth of the annulus beyond the domain grows with the distance past the edge (fog wall) */
const FAR_FOG = /* glsl */ `
#if defined(FAR_FIELD) && defined(USE_FOG)
  vFogDepth *= 1.0 + uFarFog.x * smoothstep(0.0, uFarFog.y, max(abs(position.x), abs(position.z)) - uFarFog.z);
#endif
`;

function linear(c: string | undefined, def = '#ffffff'): Vector3 {
  const col = new Color(c ?? def);
  return new Vector3(col.r, col.g, col.b);
}

/** The glowing ground layer: the first layer flagged `emissive: true`, else the legacy id detection ('tex_lava_crust'
 * unless that layer says `emissive: false`); -1 = none. */
export function emissiveLayerIndex(layers: ZoneLayout['groundLayers']): number {
  const flagged = layers.findIndex((l) => l.emissive === true);
  if (flagged >= 0) return flagged;
  return layers.findIndex((l) => l.emissive !== false && l.tex === 'tex_lava_crust');
}

/** A3: `style.cliff.cap` as a 0..1 strength (absent / true = 1 = the old cap, false = 0) */
export function capStrength(cap: boolean | number | undefined): number {
  if (cap === undefined || cap === true) return 1;
  if (cap === false) return 0;
  return Math.min(1, Math.max(0, cap));
}

/** decal slots a look compiles: 4 (the old shader) unless it lists more families */
export function decalSlots(look: ZoneLook): number {
  return look.decals.length > BASE_DECALS ? MAX_DECALS : BASE_DECALS;
}

function decalUniforms(look: ZoneLook, layerCount: number, slots: number): Record<string, { value: Vector4[] }> {
  const dk: Vector4[] = [];
  const da: Vector4[] = [];
  const db: Vector4[] = [];
  const dm0: Vector4[] = [];
  const dm1: Vector4[] = [];
  const dx: Vector4[] = [];
  const dp: Vector4[] = [];
  for (let s = 0; s < slots; s++) {
    const d = look.decals[s];
    if (!d) {
      dk.push(new Vector4(0, 1, 0, 0));
      da.push(new Vector4(0, 0, 0, 0));
      db.push(new Vector4(0, 0, 0, 0));
      dm0.push(new Vector4());
      dm1.push(new Vector4());
      dx.push(new Vector4(0, 0, 1, 0));
      dp.push(new Vector4());
      continue;
    }
    const a = linear(d.a);
    const b = linear(d.b);
    const m: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < Math.min(8, layerCount); i++) m[i] = d.layers[i] ?? 0;
    dk.push(new Vector4(DECAL_KIND_ID[d.kind as DecalKindV2] ?? 0, d.cell, d.density, d.size));
    da.push(new Vector4(a.x, a.y, a.z, d.emissive ?? 0));
    db.push(new Vector4(b.x, b.y, b.z, d.opacity ?? 1));
    dm0.push(new Vector4(m[0], m[1], m[2], m[3]));
    dm1.push(new Vector4(m[4], m[5], m[6], m[7]));
    // fissure (C8): `canopy` is the lava-proximity weight and defaults to 1 (hug the lava band)
    const canopy = d.canopy ?? ((d.kind as DecalKindV2) === 'fissure' ? 1 : 0);
    dx.push(new Vector4(canopy, d.fade?.[0] ?? 26, d.fade?.[1] ?? 48, d.seed ?? s * 3.17 + 1.3));
    dp.push(new Vector4(d.patch?.scale ?? 0, d.patch?.lo ?? 0, d.patch?.hi ?? 1, d.warp ?? 0));
  }
  return { uDK: { value: dk }, uDA: { value: da }, uDB: { value: db }, uDM0: { value: dm0 }, uDM1: { value: dm1 }, uDX: { value: dx }, uDP: { value: dp } };
}

/** The compile-time feature set a look asks for (absent knobs = the old shader). */
export function terrainDefines(look: ZoneLook, layout: ZoneLayout): Record<string, string | number> {
  const d: Record<string, string | number> = { DECALS: decalSlots(look) };
  const st = look.style;
  if (st.cliff) d.CLIFF_V2 = '';
  if (st.cliff?.foot && st.cliff.foot.width > 0) d.CLIFF_FOOT = '';
  if (st.cliff && (st.cliff.onset !== undefined || st.cliff.onsetNoise !== undefined)) d.CLIFF_ONSET = '';
  if (st.cliff && st.cliff.cap !== undefined) d.CLIFF_CAPK = '';
  if (look.medallion) d.MEDALLION = '';
  if (st.calm && st.calm.amount > 0) d.CALM = '';
  if (st.blend || layout.groundLayers.some((l) => (l.h ?? 0) !== 0)) d.BLEND_V2 = '';
  if (look.liquidLook?.lava?.shore) d.LAVA_SHORE = '';
  if (usesDecalsV2(look.decals)) d.DECALS_V2 = '';
  return d;
}

export function createTerrainMaterial(o: TerrainMaterialOptions): TerrainMaterial {
  const count = o.layers.layers;
  const look = o.look;
  const style = look.style;
  const slots = decalSlots(look);
  const feature = terrainDefines(look, o.layout);
  // A4: no picture loaded (or no centre): the shader has no medallion code at all
  if (!o.medallion || !o.medallionAt) delete feature.MEDALLION;
  const med = look.medallion;
  const medLayers = (i: number): number => med?.layers?.[i] ?? 1;
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
  mat.defines = { LAYERS: count, Q_ANTITILE: '', Q_DECOR: '', ...feature };
  if (o.layers.normal) (mat.defines as Record<string, number | string>).Q_NORMALS = '';

  const layerVec: Vector4[] = [];
  const tints: Vector3[] = [];
  const rough: number[] = [];
  for (let i = 0; i < count; i++) {
    const l = o.layout.groundLayers[i];
    // z = C2 height-blend bias (GroundLayer.h, weight units)
    layerVec.push(new Vector4(1 / (l?.scale ?? 5), l?.normal ?? 1, l?.h ?? 0, 0));
    tints.push(linear(l?.tint));
    rough.push(look.roughness?.[l?.tex ?? ''] ?? DEFAULT_ROUGHNESS);
  }
  const emissiveLayer = emissiveLayerIndex(o.layout.groundLayers);
  const liquid = o.layout.liquid;
  const accent = look.accent;
  const seal = look.seal;
  const glow = look.heroGlow;
  const sealRgb = linear(seal?.color, '#ffffff');
  const cliff = style.cliff;
  const calm = style.calm;
  const blend = style.blend;
  const lavaShore = look.liquidLook?.lava?.shore;
  const half = o.size / 2;
  const uniforms = {
    uAlbedo: { value: o.layers.albedo },
    uDecalCount: { value: Math.min(slots, look.decals.length) },
    uNormal: { value: o.layers.normal },
    uSplat0: { value: o.splat0 },
    uSplat1: { value: o.splat1 },
    uLight: { value: o.light },
    uPools: { value: o.pools },
    uLayer: { value: layerVec },
    uTint: { value: tints },
    uRough: { value: rough },
    uSize: { value: o.size },
    uHalf: { value: half },
    uCliff: { value: new Vector2(cliff?.onset?.[0] ?? 0.1, cliff?.onset?.[1] ?? 0.27) },
    uCliffLayer: { value: o.layout.cliffLayer < count ? o.layout.cliffLayer : -1 },
    // A3: style.cliff.cap = false / 0 switches the up-facing cap layer off (the uniform goes to -1: no cap sample at all)
    uCapLayer: { value: o.layout.capLayer !== undefined && o.layout.capLayer < count && capStrength(cliff?.cap) > 0 ? o.layout.capLayer : -1 },
    uEmissiveLayer: { value: emissiveLayer >= 0 && emissiveLayer < count && style.lavaGlow > 0 ? emissiveLayer : -1 },
    uEmitCap: { value: new Vector2(look.emitCap?.[0] ?? 0, look.emitCap?.[1] ?? 0.001) },
    uCliffTint: { value: linear(style.cliffTint) },
    uMacroDark: { value: linear(style.macroDark) },
    uMacroLight: { value: linear(style.macroLight) },
    uMacroStrength: { value: style.macroStrength },
    uMacroScale: { value: style.macroScale },
    uAccentA: { value: linear(accent?.a) },
    uAccentB: { value: linear(accent?.b) },
    uAccent: { value: new Vector2(accent?.strength ?? 0, accent?.scale ?? 50) },
    uSat: { value: style.saturation },
    uGain: { value: style.gain },
    uShoreWet: { value: liquid && liquid.kind === 'water' ? style.shoreWet : 0 },
    uLiquidLevel: { value: liquid?.level ?? -1000 },
    uLavaGlow: { value: style.lavaGlow },
    uSparkle: { value: style.sparkle },
    uNormalScale: { value: style.normal },
    uSunDir: worldUniforms.uSunDir,
    uShadowTint: { value: linear(look.fill.shadowTint) },
    uShadowParams: { value: new Vector3(look.fill.shadowFill, look.shadow.baked, look.shadow.ao) },
    uPoolGain: atmosphereUniforms.uPoolGain,
    uHeroGlow: { value: new Vector4(glow?.strength ?? 0, 0, 0, glow?.radius ?? 6) },
    uHeroGlowCol: { value: linear(glow?.color, '#ffffff') },
    uSeal: { value: new Vector4(o.sealAt?.x ?? 0, o.sealAt?.z ?? 0, o.sealAt && seal ? seal.radius : 0, seal?.ticks ?? 16) },
    uSealCol: { value: new Vector4(sealRgb.x, sealRgb.y, sealRgb.z, seal?.glow ?? 0) },
    uSealOpt: { value: new Vector4(seal?.wear ?? 0, seal?.opacity ?? 0, seal?.line ?? 0.03, seal?.contrast ?? 0.15) },
    uSealOpt2: { value: new Vector4(seal?.cover ?? 0.35, seal?.metal ?? 0.5, seal?.relief ?? 0.6, 0) },
    uSealBand: { value: new Vector4(seal?.band ?? 0, seal?.bandTone ?? -0.1, seal?.bandBlock ?? 0.9, seal?.bandMix ?? 0.7) },
    uSealBandCol: { value: linear(seal?.bandColor, '#a8a296') },
    uCliffA: {
      value: new Vector4(
        cliff?.stainAmp ?? CLIFF_DEFAULTS.stainAmp,
        Math.max(0.25, cliff?.stainAspect ?? CLIFF_DEFAULTS.stainAspect),
        cliff?.strataAmp ?? CLIFF_DEFAULTS.strataAmp,
        Math.max(0.5, cliff?.strataScale ?? CLIFF_DEFAULTS.strataScale),
      ),
    },
    uCliffB: { value: new Vector4(cliff?.floor ?? 0, cliff?.aoMin ?? 0, cliff?.rimFill ?? 0, cliff?.foot?.width ?? 0) },
    uCliffSky: { value: linear(look.fill.sky) },
    uFootCol: { value: linear(cliff?.foot?.color, '#8c877c') },
    uCalm: { value: new Vector4(calm?.amount ?? 0, Math.max(4, calm?.scale ?? 40), calm?.normalCut ?? 0, 5) },
    uBlend: { value: new Vector4(blend?.window ?? BLEND_DEFAULTS.window, blend?.heightK ?? BLEND_DEFAULTS.heightK, blend?.edgeNoise ?? BLEND_DEFAULTS.edgeNoise, blend?.warp ?? BLEND_DEFAULTS.warp) },
    uLavaShore: { value: new Vector2(lavaShore?.glow ?? 1, lavaShore?.crackle ?? 1) },
    // A4: the medallion picture, its centre / radius / turn, opacity / feather / glow / relief, tint, allowed ground layers
    uMedal: { value: o.medallion ?? null },
    uMedalA: { value: new Vector4(o.medallionAt?.x ?? 0, o.medallionAt?.z ?? 0, med?.radius ?? 0, med?.rotation ?? 0) },
    uMedalB: { value: new Vector4(med?.opacity ?? 1, med?.feather ?? 0.12, med?.emissive ?? 0, med?.relief ?? 0.35) },
    uMedalTint: { value: linear(med?.tint, '#ffffff') },
    uMedalL0: { value: new Vector4(medLayers(0), medLayers(1), medLayers(2), medLayers(3)) },
    uMedalL1: { value: new Vector4(medLayers(4), medLayers(5), medLayers(6), medLayers(7)) },
    // A3: x onset noise amplitude, y cap strength
    uCliffC: { value: new Vector3(cliff?.onsetNoise ?? 0.12, capStrength(cliff?.cap), 0) },
    // C6: far-field fog wall (x strength, y metres past the edge to full strength, z domain half size)
    uFarFog: { value: new Vector3(look.edge?.fogWall ?? 0.6, 260, half) },
    ...decalUniforms(look, count, slots),
  };
  const patch = (shader: WebGLProgramParametersWithUniforms): void => {
    // the atmosphere patch declares uNoise / uTime / uWindDir / uFocus first, everything below builds on them
    applyAtmosphere(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nuniform vec3 uFarFog;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position;\nvWNrm = normal;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>\n${FAR_FOG}`);
    const lights = ShaderChunk.lights_fragment_begin
      .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= gSunVis;')
      .replace('getSunLightInfo( sunLight, directLight );', 'getSunLightInfo( sunLight, directLight ); directLight.color *= gSunVis;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${DECLS}\n${DECAL_GLSL}\n${SHADE}\nvoid main() {`)
      .replace('#include <map_fragment>', 'vec3 tAlb; terrainShade(tAlb); diffuseColor.rgb = tAlb;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gWNormal, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmissive;')
      .replace('#include <lights_fragment_begin>', lights)
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= gAO;');
  };
  mat.onBeforeCompile = patch;
  mat.customProgramCacheKey = () => `terrain-splat-${count}`;

  let far: MeshStandardMaterial | null = null;
  const farMaterial = (): MeshStandardMaterial => {
    if (far) return far;
    const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
    m.defines = { ...(mat.defines as Record<string, number | string>), FAR_FIELD: '' };
    m.onBeforeCompile = patch;
    m.customProgramCacheKey = () => `terrain-far-${count}`;
    far = m;
    return m;
  };

  const baseTint = uniforms.uShadowTint.value.clone();
  const tm: TerrainMaterial = {
    material: mat,
    farMaterial,
    setArc(a) {
      // PL-03a: uMedalB.z = MedallionSpec.emissive + the arc's glow (clamped); null restores the look's numbers
      if (a) {
        uniforms.uShadowTint.value.set(a.shadowTint.r, a.shadowTint.g, a.shadowTint.b);
        uniforms.uShadowParams.value.x = a.shadowFill;
        uniforms.uMedalB.value.z = medallionEmissive(med?.emissive, a.medallionGlow);
      } else {
        uniforms.uShadowTint.value.copy(baseTint);
        uniforms.uShadowParams.value.x = look.fill.shadowFill;
        uniforms.uMedalB.value.z = med?.emissive ?? 0;
      }
    },
    setQuality(p) {
      const wantNormals = p.tier !== 'low';
      const wantAnti = p.tier === 'high' || p.tier === 'ultra';
      const wantDecor = p.tier !== 'low';
      const wantFast = p.tier === 'low';
      const wantDecals = p.tier === 'medium' ? Math.min(2, look.decals.length) : Math.min(slots, look.decals.length);
      uniforms.uDecalCount.value = wantDecals;
      for (const m of far ? [mat, far] : [mat]) {
        const d = m.defines as Record<string, number | string>;
        let dirty = false;
        if (wantNormals !== ('Q_NORMALS' in d)) {
          if (wantNormals && !uniforms.uNormal.value) continue;
          if (wantNormals) d.Q_NORMALS = '';
          else delete d.Q_NORMALS;
          dirty = true;
        }
        if (wantAnti !== ('Q_ANTITILE' in d)) {
          if (wantAnti) d.Q_ANTITILE = '';
          else delete d.Q_ANTITILE;
          dirty = true;
        }
        if (wantDecor !== ('Q_DECOR' in d)) {
          if (wantDecor) d.Q_DECOR = '';
          else delete d.Q_DECOR;
          dirty = true;
        }
        if (wantFast !== ('Q_FAST' in d)) {
          if (wantFast) d.Q_FAST = '';
          else delete d.Q_FAST;
          dirty = true;
        }
        if (dirty) m.needsUpdate = true;
      }
    },
    setLayers(l) {
      uniforms.uAlbedo.value = l.albedo;
      uniforms.uNormal.value = l.normal;
    },
    dispose() {
      if (liveTerrain === tm) liveTerrain = null;
      mat.dispose();
      far?.dispose();
    },
  };
  liveTerrain = tm;
  if (liveArcOn) tm.setArc(liveArc);
  return tm;
}

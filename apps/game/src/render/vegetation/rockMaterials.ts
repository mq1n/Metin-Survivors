// Rock materials (Lambert + onBeforeCompile so lights, fog, tone mapping and shadow receiving keep working):
//  - stone: world-space triplanar albedo + normal map (texel density independent of the instance scale), vertex AO,
//    and zone-driven caps by world-normal.y: moss (mossy), snow (frozen / ice), ash dusting (basalt, scorched), sand dust
//    (canyon / ochre). Caps are broken up with the albedo's own luminance so their edge follows the rock grain.
//    Zones core C1: the zone's cliff knobs (floor / aoMin / rimFill) lift rock walls in shade (StoneLift).
//  - crystal: Standard material, body colour from the zone, vertex-glow driven emission and a fresnel rim. ROCK-01: the ice style is a
//    saturated glassy body with fake translucency (wrap + back light), a fresnel rim and an inner light that glows in shade (CrystalKnobs, from look.rocks).
// Both use alpha-to-coverage (alpha is 1 except inside the C5 camera-to-hero cut, see terrain/occlusion.ts).
import { Color, DataTexture, MeshLambertMaterial, MeshStandardMaterial, RGBAFormat, UnsignedByteType, Vector3, Vector4, type Texture } from 'three';
import { applyOcclusionFade } from '../terrain/occlusion';
import { applyAtmosphere } from '../terrain/atmosphere';
import { worldUniforms } from '../terrain/zoneContext';
import type { RockLook, RockMatStyle } from '../terrain/look/types';
import { rockStyleFor } from './rockStyle';

export interface CapStyle {
  /** world-normal.y above which the cap settles, softness, strength, grain breakup */
  params: [number, number, number, number];
  color: [number, number, number];
}

/** Cap look derived from the rock material id (texture id convention tex_rock_*). */
export function capStyleFor(id: string): CapStyle | null {
  if (/mossy/.test(id)) return { params: [0.58, 0.2, 0.7, 0.9], color: [0.05, 0.1, 0.03] };
  if (/frozen|ice|snow/.test(id)) return { params: [0.32, 0.24, 0.95, 0.4], color: [0.82, 0.88, 0.97] };
  if (/basalt|scorched|ash|lava|obsidian/.test(id)) return { params: [0.5, 0.22, 0.45, 0.5], color: [0.24, 0.22, 0.21] };
  if (/canyon|ochre|dry|sand/.test(id)) return { params: [0.5, 0.22, 0.55, 0.5], color: [0.5, 0.38, 0.22] };
  return null;
}

export type CrystalStyle = 'ice' | 'obsidian';

export function crystalStyleFor(matId: string): CrystalStyle {
  return /basalt|scorched|ash|lava|obsidian/.test(matId) ? 'obsidian' : 'ice';
}

function replaceOnce(src: string, token: string, repl: string): string {
  if (!src.includes(token)) throw new Error(`rock shader patch: token ${token} not found`);
  return src.replace(token, repl);
}

let flat: DataTexture | null = null;
/** 1x1 neutral normal map used when a rock texture ships without one */
function flatNormal(): DataTexture {
  if (!flat) {
    flat = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    flat.needsUpdate = true;
  }
  return flat;
}

const VERT_PARS = /* glsl */ `
attribute vec4 aData;
varying vec3 vWP;
varying vec3 vWN;
varying float vTexK;
varying float vGlow;
varying float vPhase;
`;

const VERT_BODY = /* glsl */ `
{
  mat4 bM = modelMatrix * batchingMatrix;
  vWP = (bM * vec4(transformed, 1.0)).xyz;
  mat3 m3 = mat3(bM);
  vec3 s2 = vec3(dot(m3[0], m3[0]), dot(m3[1], m3[1]), dot(m3[2], m3[2]));
  vWN = normalize(m3 * (objectNormal / s2));
  vTexK = aData.y;
  vGlow = aData.w;
  vPhase = bM[3].x * 0.37 + bM[3].z * 0.53;
}
`;

function patchVertex(shader: { vertexShader: string }): void {
  shader.vertexShader = replaceOnce(shader.vertexShader, '#include <common>', `#include <common>\n${VERT_PARS}`);
  shader.vertexShader = replaceOnce(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
}

const FRAG_PARS = /* glsl */ `
varying vec3 vWP;
varying vec3 vWN;
varying float vTexK;
varying float vGlow;
varying float vPhase;
`;

/**
 * Zones core C1: the zone's cliff knobs (look.style.cliff) applied to rock walls too, so outcrops and boulders in shade
 * never go black: minimum albedo luma, minimum vertex AO, sky-coloured lift (look.fill.sky, linear rgb).
 */
export interface StoneLift {
  floor: number;
  aoMin: number;
  rimFill: number;
  sky: [number, number, number];
}

/** Zones core A2: per-group stone tuning (look.rocks); absent = the old shading */
export interface StoneTune {
  /** albedo contrast about mid grey */
  contrast: number;
  /** 0..1 crevice / base darkening and vertical rain streaks */
  dirt: number;
  /** colour saturation (1 = as before) */
  saturation: number;
  /** normal-map strength */
  normal: number;
  /** triplanar weights from the face normal (squared blocks: no smeared seam where two faces meet) */
  geo?: boolean;
}

export interface StoneParams {
  map: Texture;
  normal: Texture | null;
  /** texture repeats per metre */
  texScale: number;
  cap: CapStyle | null;
  grade: [number, number, number];
  /** C1 lift (absent = the old shading) */
  lift?: StoneLift | null;
  /** A2 tuning (absent = the old shading) */
  tune?: StoneTune | null;
}

export function createStoneMaterial(p: StoneParams): MeshLambertMaterial {
  // C5: alpha-to-coverage gives the camera-to-hero cut a soft rim on multisampled tiers (alpha stays 1 elsewhere)
  const mat = new MeshLambertMaterial({ vertexColors: true, alphaToCoverage: true });
  mat.name = 'rockStone';
  const nrm = p.normal ?? flatNormal();
  const cap = p.cap;
  const lift = p.lift ?? null;
  const tune = p.tune ?? null;
  if (lift || tune) mat.defines = { ...(lift ? { ROCK_LIFT: '' } : {}), ...(tune ? { ROCK_V2: '' } : {}), ...(tune?.geo ? { ROCK_GEO: '' } : {}) };
  mat.onBeforeCompile = (shader) => {
    const u = shader.uniforms;
    u.uTex = { value: p.map };
    u.uNrm = { value: nrm };
    u.uTexScale = { value: p.texScale };
    u.uNrmK = { value: p.normal ? 1 : 0 };
    u.uCap = { value: new Vector4(...(cap?.params ?? [2, 0.1, 0, 0])) };
    u.uCapCol = { value: new Color(...(cap?.color ?? [1, 1, 1])) };
    u.uGrade = { value: new Color(...p.grade) };
    u.uLift = { value: new Vector4(lift?.floor ?? 0, lift?.aoMin ?? 0, lift?.rimFill ?? 0, 0) };
    u.uLiftSky = { value: new Color(...(lift?.sky ?? [1, 1, 1])) };
    u.uRockA = { value: new Vector4(tune?.contrast ?? 1, tune?.dirt ?? 0, tune?.normal ?? 0.9, tune?.saturation ?? 1) };
    patchVertex(shader);
    let f = shader.fragmentShader;
    f = replaceOnce(
      f,
      '#include <common>',
      `#include <common>\n${FRAG_PARS}
      uniform sampler2D uTex;
      uniform sampler2D uNrm;
      uniform float uTexScale;
      uniform float uNrmK;
      uniform vec4 uCap;
      uniform vec3 uCapCol;
      uniform vec3 uGrade;
      uniform vec4 uLift;
      uniform vec3 uLiftSky;
      uniform vec4 uRockA;`,
    );
    f = replaceOnce(
      f,
      '#include <map_fragment>',
      `vec3 N0 = normalize(vWN);
      #ifdef ROCK_GEO
      // squared blocks: the weights follow the face normal, so the smooth vertex normals of a corner never blend in the wrong projection
      vec3 tw = pow(abs(normalize(cross(dFdx(vWP), dFdy(vWP)))), vec3(4.0));
      #else
      vec3 tw = pow(abs(N0), vec3(4.0));
      #endif
      tw /= (tw.x + tw.y + tw.z);
      float sc = uTexScale * vTexK;
      vec2 uvX = vWP.zy * sc;
      vec2 uvY = vWP.xz * sc + 0.37;
      vec2 uvZ = vWP.xy * sc + 0.71;
      vec3 cX = texture2D(uTex, uvX).rgb;
      vec3 cY = texture2D(uTex, uvY).rgb;
      vec3 cZ = texture2D(uTex, uvZ).rgb;
      vec3 albedo = cX * tw.x + cY * tw.y + cZ * tw.z;
      #ifdef ROCK_V2
      // A2: contrast about mid grey (crisper cracks and grain), the normal strength of this group
      albedo = clamp((albedo - vec3(0.45)) * uRockA.x + vec3(0.45), 0.0, 1.0);
      albedo = mix(vec3(dot(albedo, vec3(0.3, 0.5, 0.2))), albedo, uRockA.w);
      float rockNK = uRockA.z;
      #else
      float rockNK = 0.9;
      #endif
      vec3 Nw = N0;
      if (uNrmK > 0.5) {
        vec3 tX = texture2D(uNrm, uvX).xyz * 2.0 - 1.0;
        vec3 tY = texture2D(uNrm, uvY).xyz * 2.0 - 1.0;
        vec3 tZ = texture2D(uNrm, uvZ).xyz * 2.0 - 1.0;
        tX = vec3(tX.xy * rockNK + N0.zy, abs(tX.z) * N0.x);
        tY = vec3(tY.xy * rockNK + N0.xz, abs(tY.z) * N0.y);
        tZ = vec3(tZ.xy * rockNK + N0.xy, abs(tZ.z) * N0.z);
        Nw = normalize(tX.zyx * tw.x + tY.xzy * tw.y + tZ.xyz * tw.z);
      }
      float lum = dot(albedo, vec3(0.3, 0.5, 0.2));
      // broad low-frequency patchiness so caps form clumps instead of a uniform hat
      float patchN = dot(texture2D(uTex, uvY * 0.21).rgb, vec3(0.3, 0.5, 0.2));
      float capK = smoothstep(uCap.x - uCap.y, uCap.x + uCap.y, Nw.y + (lum - 0.3) * 0.5 + (patchN - 0.3) * uCap.w) * uCap.z;
      capK *= smoothstep(0.25, 0.7, vColor.g) * (1.0 - smoothstep(1.5, 2.2, vTexK));
      albedo = mix(albedo * uGrade, uCapCol * (0.75 + 0.5 * lum), capK);
      #ifdef ROCK_V2
      {
        // A2: dirt gathers in the crevices and at the base (low vertex AO), and rain streaks run down the faces
        float rainN = texture2D(uAtmoNoise, vec2((vWP.x + vWP.z) * 0.27, vWP.y * 0.07)).b;
        albedo *= 1.0 - uRockA.y * (0.55 * (1.0 - vColor.g) + 0.3 * smoothstep(0.35, 0.8, rainN));
      }
      #endif
      Nw = normalize(mix(Nw, N0, capK * 0.65));
      diffuseColor.rgb = albedo;`,
    );
    f = replaceOnce(
      f,
      '#include <color_fragment>',
      `#ifdef ROCK_LIFT
      // C1: vertex AO floor, then a minimum albedo luma (rock walls in shade never go black); a strong lift also goes
      // partly into neutral grey so dark moss / soot reads as pale stone, not a neon tint
      diffuseColor.rgb *= max(vColor.rgb, vec3(uLift.y));
      {
        float L = dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2));
        float k = max(1.0, uLift.x / max(L, 1e-3));
        vec3 lifted = diffuseColor.rgb * k;
        diffuseColor.rgb = mix(lifted, vec3(dot(lifted, vec3(0.3, 0.5, 0.2))), clamp((k - 1.0) * 0.35, 0.0, 0.6));
      }
      #else
      diffuseColor.rgb *= vColor.rgb;
      #endif`,
    );
    f = replaceOnce(f, '#include <normal_fragment_begin>', 'vec3 normal = normalize((viewMatrix * vec4(Nw, 0.0)).xyz);\nvec3 nonPerturbedNormal = normal;');
    f = replaceOnce(
      f,
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      #ifdef ROCK_LIFT
      // C1: sky-coloured lift, strongest where the stone faces away from the sun
      #if NUM_DIR_LIGHTS > 0
      totalEmissiveRadiance += diffuseColor.rgb * uLiftSky * (uLift.z * (1.0 - 0.5 * saturate(dot(normal, directionalLights[0].direction))));
      #else
      totalEmissiveRadiance += diffuseColor.rgb * uLiftSky * uLift.z;
      #endif
      #endif`,
    );
    shader.fragmentShader = f;
    applyOcclusionFade(shader);
    applyAtmosphere(shader);
  };
  mat.customProgramCacheKey = () => `rockStone${p.normal ? 'N' : ''}${cap ? 'C' : ''}${lift ? 'L' : ''}${tune ? 'V' : ''}${tune?.geo ? 'G' : ''}`;
  return mat;
}

const CRYSTAL: Record<CrystalStyle, { body: [number, number, number]; glow: [number, number, number]; rim: [number, number, number]; amount: number }> = {
  // ROCK-01: the ice body is a saturated glass blue (the old grey-blue body sank into the snow and the pale one washed out against it); the old vertex-glow
  // ember (amount) is replaced by the inner light (emissive knob), a gradient from a dim azure base to a hot cyan-white tip
  ice: { body: [0.1, 0.5, 1.0], glow: [0.28, 0.62, 1.0], rim: [0.45, 0.8, 1.0], amount: 0 },
  obsidian: { body: [0.07, 0.06, 0.08], glow: [1.0, 0.3, 0.06], rim: [0.18, 0.07, 0.03], amount: 0.35 },
};

/**
 * ROCK-01: the look knobs of a crystal material (colours in linear rgb). They come from RockMatStyle (look.rocks.kind.crystal over
 * look.rocks.all); a field the look leaves out takes the default of the style: 'ice' gets the ROCK-01 look, 'obsidian' keeps the
 * numbers it always had (translucency 0, no inner emissive, its old rim), so only a zone that asks changes it. Strict kind gate: stone
 * rocks never read these (createStoneMaterial is untouched).
 */
export interface CrystalKnobs {
  /** 0..1 fake translucency (wrap light on the unlit side + back light through the thin tip) */
  translucency: number;
  /** strength of the fresnel rim */
  rimGlow: number;
  rimColor: [number, number, number];
  /** 0..2 inner light (0.25 = faint; a gradient from a dim base to a bright tip that fades where the sun already lights the facet, so it
   * glows in shade and tree shadow; blooms on the bloom tiers where the tips pass the bloom threshold) */
  emissive: number;
  emissiveColor: [number, number, number];
}

function hexLinear(hex: string): [number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

/**
 * ROCK-01: an additive light colour made richer, c * c / max(c): the hue stays, the pale channels drop (#7fc4ff -> a cyan-azure). Pale
 * additive light on white snow under the ACES tone map washes out to grey-white (the r2 shards sat at the snow's value, saturation 0.2),
 * a richer one keeps its colour at the same brightness. The ice style's inner light and rim go through it; obsidian is untouched.
 */
export function punchColor(c: readonly [number, number, number]): [number, number, number] {
  const m = Math.max(c[0], c[1], c[2], 1e-3);
  return [(c[0] * c[0]) / m, (c[1] * c[1]) / m, (c[2] * c[2]) / m];
}

const KNOB_DEFAULTS: Record<CrystalStyle, CrystalKnobs> = {
  ice: { translucency: 0.4, rimGlow: 0.45, rimColor: hexLinear('#9fd6ff'), emissive: 0.25, emissiveColor: hexLinear('#7fc4ff') },
  obsidian: { translucency: 0, rimGlow: 0.5, rimColor: [0.18, 0.07, 0.03], emissive: 0, emissiveColor: [1.0, 0.3, 0.06] },
};

type CrystalLook = Pick<RockMatStyle, 'translucency' | 'rimGlow' | 'rimColor' | 'emissive' | 'emissiveColor'>;

const unit = (v: number | undefined, d: number, max = 1): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : d);

/** The knobs of a crystal style with the zone look's values over the defaults (absent look / absent fields = the defaults). */
export function crystalKnobsFor(style: CrystalStyle, look?: CrystalLook | null): CrystalKnobs {
  const d = KNOB_DEFAULTS[style];
  return {
    translucency: unit(look?.translucency, d.translucency),
    rimGlow: unit(look?.rimGlow, d.rimGlow),
    rimColor: look?.rimColor ? hexLinear(look.rimColor) : [...d.rimColor],
    emissive: unit(look?.emissive, d.emissive, 2),
    emissiveColor: look?.emissiveColor ? hexLinear(look.emissiveColor) : [...d.emissiveColor],
  };
}

export function createCrystalMaterial(style: CrystalStyle, look?: CrystalLook | null): MeshStandardMaterial {
  const c = CRYSTAL[style];
  const k = crystalKnobsFor(style, look);
  // C5: alpha-to-coverage for the soft camera-to-hero cut on multisampled tiers
  const mat = new MeshStandardMaterial({ color: new Color(...c.body), roughness: style === 'ice' ? 0.22 : 0.14, metalness: style === 'ice' ? 0.05 : 0.35, vertexColors: true, alphaToCoverage: true });
  mat.name = 'rockCrystal';
  mat.onBeforeCompile = (shader) => {
    const u = shader.uniforms;
    u.uGlow = { value: new Color(...c.glow) };
    u.uRim = { value: new Color(...(style === 'ice' ? punchColor(k.rimColor) : k.rimColor)) };
    u.uRimK = { value: k.rimGlow };
    // rim shape: fresnel exponent, the extra rim at the tips and the gain (ice: a tight rim that brightens towards the tip; obsidian: as it was)
    u.uRimP = { value: new Vector3(style === 'ice' ? 2.4 : 2.2, style === 'ice' ? 0.8 : 0, style === 'ice' ? 0.78 : 1) };
    u.uAmount = { value: c.amount };
    u.uEmis = { value: new Color(...punchColor(k.emissiveColor)) };
    u.uEmK = { value: k.emissive };
    u.uTrans = { value: k.translucency };
    u.uTime = worldUniforms.uTime;
    patchVertex(shader);
    let f = shader.fragmentShader;
    f = replaceOnce(f, '#include <common>', `#include <common>\n${FRAG_PARS}\nuniform vec3 uGlow;\nuniform vec3 uRim;\nuniform float uRimK;
uniform vec3 uRimP;\nuniform float uAmount;\nuniform vec3 uEmis;\nuniform float uEmK;\nuniform float uTrans;\nuniform float uTime;`);
    f = replaceOnce(
      f,
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float rkPulse = 0.82 + 0.18 * sin(uTime * 1.6 + vPhase);
      float rkG2 = vGlow * vGlow;
      vec3 rkV = normalize(vViewPosition);
      {
        float fr = pow(1.0 - saturate(dot(normal, rkV)), uRimP.x) * (1.0 + uRimP.y * vGlow);
        totalEmissiveRadiance += uGlow * (rkG2 * uAmount * rkPulse) + uRim * (fr * uRimK * uRimP.z);
      }
      // ROCK-01: inner light, a gradient from a dim base to a pale hot tip (a slow twinkle runs up the tips); it is added after the lights
      // (lights_fragment_end) so it can fade where the sun already lights the facet and stay full in shade and tree shadow
      float rkTw = pow(0.5 + 0.5 * sin(uTime * 2.3 + vPhase * 5.0 + vWP.y * 7.0), 8.0);
      float rkCore = 0.55 + 0.45 * saturate(dot(normal, rkV));
      vec3 rkInner = mix(uEmis, mix(uEmis, vec3(1.0), 0.4), rkG2) * (uEmK * (0.28 + 9.0 * rkG2 * rkG2) * rkCore * rkPulse * (1.0 + 0.9 * rkTw * rkG2));`,
    );
    f = replaceOnce(
      f,
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      {
        // share of the sun that reaches this facet (n.l x shadow): 1 = full sun, 0 = turned away or shadowed
        #if NUM_DIR_LIGHTS > 0
        float rkSunLum = dot(directionalLights[0].color, vec3(0.3, 0.5, 0.2)) * RECIPROCAL_PI * dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2));
        float rkLit = saturate(dot(reflectedLight.directDiffuse, vec3(0.3, 0.5, 0.2)) / max(rkSunLum, 1e-4));
        #else
        float rkLit = 0.0;
        #endif
        totalEmissiveRadiance += rkInner * mix(1.4, 0.8, rkLit);
        #if NUM_DIR_LIGHTS > 0
        if (uTrans > 0.0) {
          // fake translucency: the sun side wraps round the edges, and a sun behind the crystal shines through the thin tip
          vec3 Ls = directionalLights[0].direction;
          float ndl = dot(normal, Ls);
          float wrapL = saturate((ndl + 0.6) / 1.6) - saturate(ndl);
          float back = pow(saturate(dot(rkV, -normalize(Ls + normal * 0.3))), 3.0);
          vec3 tint = mix(diffuseColor.rgb, uEmis, 0.7);
          totalEmissiveRadiance += tint * directionalLights[0].color * (uTrans * (0.55 * wrapL + 1.1 * back * (0.35 + 0.65 * vGlow)) * 0.5);
        }
        #endif
      }`,
    );
    shader.fragmentShader = f;
    applyOcclusionFade(shader);
    applyAtmosphere(shader);
  };
  mat.customProgramCacheKey = () => `rockCrystal${style}`;
  return mat;
}

/**
 * The crystal material of a zone's crystal rocks: the style from the rock material id, the knobs from the zone look (look.rocks.all with
 * look.rocks.kind.crystal over it). rocks.ts builds its crystal layer through this, so a zone look that tunes the crystal reaches the shader
 * (a call without the look left every knob at its default, which is what the two ROCK-01 critic rounds found).
 */
export function crystalMaterialFor(matId: string, rockLook: RockLook | undefined): MeshStandardMaterial {
  return createCrystalMaterial(crystalStyleFor(matId), rockStyleFor(rockLook, 'crystal'));
}

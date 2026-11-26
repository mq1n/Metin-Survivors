// Lambert material patched with: baked-bone-texture skinning per instance, hit flash, status tints, elite rim light,
// corruption glow and noisy dissolve (death). Instance matrix handles placement; skinning happens in model space.
import { Color, MeshLambertMaterial, Vector4, type DataTexture, type Material, type Texture } from 'three';
import { CROWD_DISSOLVE, CROWD_FX } from './fx';

/** Shared uniform holders updated once per frame by the CrowdRenderer / once per run by the zone style. */
export const crowdShared = {
  time: { value: 0 },
  /** per-zone rank-and-file rim (rgb linear, a = strength): separates enemies from the zone's ground palette */
  zoneRim: { value: new Vector4(1, 1, 1, 0) },
  /** per-zone rank-and-file grade: x = desaturation (0..1), y = darkening (0..1); elites/bosses keep full colour */
  zoneGrade: { value: new Vector4(0, 0, 0, 0) },
};

export interface CrowdZoneStyle {
  /** `#rrggbb` rim colour for tier-0 enemies */
  rim: string;
  rimStrength: number;
  desaturate: number;
  darken: number;
}

const tmpColor = new Color();
/** Applies a zone's enemy-readability style (all crowd materials share the uniforms). */
export function setCrowdZoneStyle(s: CrowdZoneStyle): void {
  tmpColor.set(s.rim);
  crowdShared.zoneRim.value.set(tmpColor.r, tmpColor.g, tmpColor.b, s.rimStrength);
  crowdShared.zoneGrade.value.set(s.desaturate, s.darken, 0, 0);
}

export interface CrowdMaterialOptions {
  bake: DataTexture;
  boneCount: number;
  map: Texture | null;
  vertexColors: boolean;
  tint: string | undefined;
  animLerp: boolean;
  tintMode?: 'multiply' | 'colorize';
  /** source material emissive (glow masks ship as emissiveMap; bloom picks them up) */
  emissive?: Color;
  emissiveMap?: Texture | null;
  emissiveIntensity?: number;
}

const COMMON_VERT = /* glsl */ `
uniform highp sampler2D uBake;
attribute vec4 aAnim; // rowA, rowB, mix, status bits
attribute vec4 aFx;   // flash, dissolve, corrupt, elite
varying vec4 vFx;
varying float vStatus;
varying vec3 vLocal;

void crowdAddBone(float bi, float wt, vec4 anim, inout vec4 s0, inout vec4 s1, inout vec4 s2) {
  int col = int(bi + 0.5) * 3;
  ivec2 a = ivec2(col, int(anim.x));
  vec4 a0 = texelFetch(uBake, a, 0);
  vec4 a1 = texelFetch(uBake, a + ivec2(1, 0), 0);
  vec4 a2 = texelFetch(uBake, a + ivec2(2, 0), 0);
#ifdef ANIM_LERP
  ivec2 b = ivec2(col, int(anim.y));
  a0 = mix(a0, texelFetch(uBake, b, 0), anim.z);
  a1 = mix(a1, texelFetch(uBake, b + ivec2(1, 0), 0), anim.z);
  a2 = mix(a2, texelFetch(uBake, b + ivec2(2, 0), 0), anim.z);
#endif
  s0 += wt * a0;
  s1 += wt * a1;
  s2 += wt * a2;
}
`;

const SKIN_BASE = /* glsl */ `
vec4 crowdS0 = vec4(0.0);
vec4 crowdS1 = vec4(0.0);
vec4 crowdS2 = vec4(0.0);
{
  vec4 w = skinWeight;
  float wsum = w.x + w.y + w.z + w.w;
  w /= max(wsum, 1e-4);
  if (w.x > 0.0) crowdAddBone(skinIndex.x, w.x, aAnim, crowdS0, crowdS1, crowdS2);
  if (w.y > 0.0) crowdAddBone(skinIndex.y, w.y, aAnim, crowdS0, crowdS1, crowdS2);
  if (w.z > 0.0) crowdAddBone(skinIndex.z, w.z, aAnim, crowdS0, crowdS1, crowdS2);
  if (w.w > 0.0) crowdAddBone(skinIndex.w, w.w, aAnim, crowdS0, crowdS1, crowdS2);
}
vFx = aFx;
vStatus = aAnim.w;
`;

const SKIN_NORMAL = /* glsl */ `
objectNormal = vec3(dot(crowdS0.xyz, objectNormal), dot(crowdS1.xyz, objectNormal), dot(crowdS2.xyz, objectNormal));
`;

const SKIN_POS = /* glsl */ `
{
  vec4 crowdP = vec4(transformed, 1.0);
  transformed = vec3(dot(crowdS0, crowdP), dot(crowdS1, crowdP), dot(crowdS2, crowdP));
  vLocal = transformed;
}
`;

const COMMON_FRAG = /* glsl */ `
uniform float uCrowdTime;
uniform vec3 uCrowdTint;
uniform vec4 uZoneRim;
uniform vec4 uZoneGrade;
varying vec4 vFx;
varying float vStatus;
varying vec3 vLocal;

float crowdHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float crowdNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(crowdHash(i), crowdHash(i + vec3(1, 0, 0)), f.x), mix(crowdHash(i + vec3(0, 1, 0)), crowdHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(crowdHash(i + vec3(0, 0, 1)), crowdHash(i + vec3(1, 0, 1)), f.x), mix(crowdHash(i + vec3(0, 1, 1)), crowdHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`;

const FRAG_DISSOLVE = CROWD_DISSOLVE;

const FRAG_COLORIZE = /* glsl */ `
#ifdef CROWD_COLORIZE
{
  float crowdLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 crowdCol = clamp(vec3(crowdLum) * uCrowdTint * 1.8, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, crowdCol, 0.85);
}
#endif
`;

const FRAG_FX = CROWD_FX;

/** [three shader anchor, replacement text]: every GLSL string injected into the crowd skin and where it goes, in application order */
export type ShaderPatch = readonly [anchor: string, replacement: string];

export const CROWD_VERT_PATCHES: readonly ShaderPatch[] = [
  ['void main() {', `${COMMON_VERT}\nvoid main() {`],
  ['#include <skinbase_vertex>', SKIN_BASE],
  ['#include <skinnormal_vertex>', SKIN_NORMAL],
  ['#include <skinning_vertex>', SKIN_POS],
  ['#include <common>', '#include <common>\nattribute vec4 skinIndex;\nattribute vec4 skinWeight;'],
];

export const CROWD_FRAG_PATCHES: readonly ShaderPatch[] = [
  ['void main() {', `${COMMON_FRAG}\nvoid main() {`],
  ['#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLORIZE}\n${FRAG_DISSOLVE}`],
  ['#include <opaque_fragment>', `${FRAG_FX}\n#include <opaque_fragment>`],
];

function applyPatches(src: string, patches: readonly ShaderPatch[]): string {
  for (const [anchor, text] of patches) src = src.replace(anchor, text);
  return src;
}

/** 53-bit string hash (cyrb53 style): deterministic and dependency-free; the parts are separated so ['ab', 'c'] != ['a', 'bc'] */
export function hashGlsl(parts: readonly string[]): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      const c = part.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ 0x1f, 2654435761);
    h2 = Math.imul(h2 ^ 0x1f, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** the program cache key of a patch set: it changes with every edit of an injected string or anchor, no manual bump */
export function crowdSkinKey(vert: readonly ShaderPatch[], frag: readonly ShaderPatch[]): string {
  return `crowd-skin-${hashGlsl([...vert.flat(), '|frag|', ...frag.flat()])}`;
}

/**
 * three keys its program cache by the material's customProgramCacheKey (plus defines and the stock parameters), so two crowd
 * skins with different injected GLSL must never share a key: a cached or hot-reloaded renderer would keep the stale program.
 * The key is derived from the injected source itself, computed once at module load.
 */
export const CROWD_SKIN_KEY = crowdSkinKey(CROWD_VERT_PATCHES, CROWD_FRAG_PATCHES);

export function createCrowdMaterial(opts: CrowdMaterialOptions): MeshLambertMaterial {
  const colorize = opts.tintMode === 'colorize';
  const tintColor = new Color(opts.tint ?? '#ffffff');
  const mat = new MeshLambertMaterial({
    vertexColors: opts.vertexColors,
    map: opts.map,
    // multiply: the tint is the material color (modulates the albedo). colorize: keeps the albedo's luminance detail but
    // takes hue/saturation from the tint (a white tiger from the orange tiger model).
    color: colorize ? new Color(1, 1, 1) : tintColor,
    emissive: opts.emissive ?? new Color(0, 0, 0),
    emissiveMap: opts.emissiveMap ?? null,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  const defines: Record<string, string> = {};
  if (opts.animLerp) defines.ANIM_LERP = '';
  if (colorize) defines.CROWD_COLORIZE = '';
  mat.defines = defines;
  mat.customProgramCacheKey = () => CROWD_SKIN_KEY;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBake = { value: opts.bake };
    shader.uniforms.uCrowdTime = crowdShared.time;
    shader.uniforms.uCrowdTint = { value: colorize ? tintColor : new Color(1, 1, 1) };
    shader.uniforms.uZoneRim = crowdShared.zoneRim;
    shader.uniforms.uZoneGrade = crowdShared.zoneGrade;
    shader.vertexShader = applyPatches(shader.vertexShader, CROWD_VERT_PATCHES);
    shader.fragmentShader = applyPatches(shader.fragmentShader, CROWD_FRAG_PATCHES);
  };
  return mat;
}

/** Toggles frame interpolation (needs a recompile). */
export function setAnimLerp(mat: Material, on: boolean): void {
  const defines = (mat.defines ??= {});
  if (on === ('ANIM_LERP' in defines)) return;
  if (on) defines.ANIM_LERP = '';
  else delete defines.ANIM_LERP;
  mat.needsUpdate = true;
}

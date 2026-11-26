// Camera-to-hero occlusion cut-out for tall world objects (trees, rocks, buildings): fragments that sit between the camera
// and the hero (inside a cylinder around that view ray, in front of the hero and above its head) are cut away, so the 55°
// gameplay camera never loses the hero behind a canopy. Shared by vegetation and structures materials; the hero position
// is driven by zoneScene, the zone look and the quality tier by the terrain system (configureOcclusion /
// setOcclusionQuality).
//
//   material.onBeforeCompile = (shader) => {
//     applyOcclusionFade(shader);   // after your own patches; needs MeshStandard/Lambert/Phong (uses vViewPosition)
//   };
//
// Zones core C5 (no screen-door): the cut is a crisp circle whose ~3 px rim is anti-aliased through alpha-to-coverage on
// multisampled tiers (materials created with `alphaToCoverage: true`) and dithered over those 3 px only on the others
// (deliberate, not noise). A zone look may ask for a wide soft rim (`feather` metres) and a ghost of the occluder
// (`minAlpha`): both use coverage, so they only apply on multisampled tiers (measured on ANGLE/D3D11: a wide coverage
// fade is still dithered by the driver, which is why the default rim is narrow).
import { Vector3, Vector4 } from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import type { QualityProfile } from '../quality';
import type { OcclusionLook } from './look/types';

/** default cut radius (m) */
export const DEFAULT_OCCLUSION_RADIUS = 2.4;
/** default soft rim as a share of the radius (the old dither band ran from 0.55 R to R) */
const DEFAULT_FEATHER_SHARE = 0.45;

/** hero chest position in VIEW space (set per frame by zoneScene.update) */
export const heroViewUniform = { value: new Vector3(0, 0, -1000) };
/** master radius (m) of the cut; 0 disables it everywhere (terrain gallery `?fade=0`). A zone look may override the
 * radius through configureOcclusion without touching this switch. */
export const occlusionRadius = { value: DEFAULT_OCCLUSION_RADIUS };
/** x zone radius override (m, 0 = occlusionRadius) · y soft rim (m, < 0 = 0.45 R) · z min alpha kept inside the cut
 * (alpha-to-coverage path) · w 1 = the scene target is multisampled (alpha-to-coverage path available) */
export const occlusionParams = { value: new Vector4(0, -1, 0, 1) };

/** Applies a zone look's occlusion knobs (absent = defaults). Called on zone creation (terrain system). */
export function configureOcclusion(look: OcclusionLook | undefined): void {
  const p = occlusionParams.value;
  p.x = look?.radius !== undefined && look.radius > 0 ? look.radius : 0;
  p.y = look?.feather !== undefined ? Math.max(0, look.feather) : -1;
  p.z = Math.min(1, Math.max(0, look?.minAlpha ?? 0));
}

/** Multisampled tiers use the alpha-to-coverage path, the others the crisp cut. */
export function setOcclusionQuality(p: QualityProfile): void {
  occlusionParams.value.w = p.msaa > 0 ? 1 : 0;
}

/**
 * GLSL helpers (declarations + functions), shared with the terrain shader (back faces when the camera is inside a rim
 * wall). `occlusionKeep(viewPos, soft, headGate)`: 1 = keep, 0 = cut.
 */
export const OCCLUSION_GLSL = /* glsl */ `
uniform vec3 uHeroView;
uniform float uOccludeR;
uniform vec4 uOccP;
float gOccKeep = 1.0;
float occlusionDither() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
// occP: fragment position in view space. soft: continuous rim (alpha-to-coverage) instead of the crisp ~3 px rim.
// headGate: only geometry above the hero's head is cut (trees, rocks, buildings); off for the terrain's back faces.
float occlusionKeep(vec3 occP, bool soft, bool headGate) {
  float heroDist = length(uHeroView);
  vec3 heroDir = uHeroView / max(heroDist, 1e-3);
  float along = dot(occP, heroDir);
  float d = length(cross(occP, heroDir));
  // height above the hero's chest (uHeroView = chest, the head is ~0.8 m higher)
  float up = dot(occP - uHeroView, viewMatrix[1].xyz);
  // pixel footprints, taken before any branch (derivatives need uniform control flow)
  float dPx = max(fwidth(d), 1e-4);
  float upPx = max(fwidth(up), 1e-4);
  float R = uOccludeR > 0.0 ? (uOccP.x > 0.0 ? uOccP.x : uOccludeR) : 0.0;
  // only geometry clearly in front of the hero (towards the camera) is cut away
  if (R <= 0.0 || along >= heroDist - 0.9 || along <= 0.0) return 1.0;
  // the cut edge sits in the middle of the old dither band (0.55 R .. R) unless the look sets its own soft rim
  float fe = uOccP.y >= 0.0 ? uOccP.y : R * ${DEFAULT_FEATHER_SHARE.toFixed(2)};
  float Rc = R - 0.5 * fe;
  float k;
  float h;
  if (soft && uOccP.y > 0.0) {
    // a soft rim of look.occlusion.feather metres (alpha-to-coverage)
    k = smoothstep(Rc - 0.5 * fe, Rc + 0.5 * fe, d);
    h = headGate ? smoothstep(0.45, 0.85, up) : 1.0;
  } else {
    // crisp circle with a ~3 px rim: anti-aliased by coverage on multisampled tiers, dithered on the others
    k = clamp((d - Rc) / (3.0 * dPx) + 0.5, 0.0, 1.0);
    h = headGate ? clamp((up - 0.8) / (3.0 * upPx) + 0.5, 0.0, 1.0) : 1.0;
  }
  return 1.0 - (1.0 - k) * h;
}
`;

const MAIN = /* glsl */ `
{
#ifdef ALPHA_TO_COVERAGE
  bool occSoft = uOccP.w > 0.5;
#else
  bool occSoft = false;
#endif
  gOccKeep = occlusionKeep(-vViewPosition, occSoft, true);
  // crisp path: fully cut inside, dithered only across the ~3 px rim
  if (!occSoft && occlusionDither() >= gOccKeep) discard;
}
`;

/** after the alpha test: the soft path scales the coverage (alpha-to-coverage materials only) */
const ALPHA = /* glsl */ `
#ifdef ALPHA_TO_COVERAGE
  if (uOccP.w > 0.5) diffuseColor.a *= mix(uOccP.z, 1.0, gOccKeep);
#endif
`;

// ---- r9 Z9: per-object occlusion for the structure GLBs (r8 judge MF1 / MF2) ------------------------------------------------------------
// The view-ray cut above slices whatever crosses its tilted cylinder: on a hall it left the ridge-end drums floating, black slivers across
// the cut and a jagged fan with loose shards on a gate roof; on a small prop just south of the hero it left a stub; with the camera inside
// the 55 m suryeon pagoda it showed the eave rims from inside. A structure GLB now gets one state per placement instead, decided on the
// CPU from the placement's own height grid (structures/propOcclusion.ts):
//   x  whole fade (0 = drawn .. 1 = gone): small props and single-body props ghost WHOLE (dithered) while they hide the hero; a landmark
//      the camera stands inside (its footprint, below its top) fades out whole;
//   y  cap fade + z cap height (world y): a building or gate that hides the hero loses EVERYTHING above the cap height (its whole roof,
//      drums, ridge, ornaments; walls and posts above the hero's head), so no sub-part is left floating above a cut-away support.
// The shadow pass draws with three's own depth material, so the shadows stay. A screen-space dither (no blending, no sorting).
// r9 ship (Z9 critic): a whole fade takes the shadow with it (applyObjectOcclusionDepth on the parts' customDepthMaterial: the faded pagoda left a
// 30 m roof shadow on an empty court, a faded lamp post its full shadow); the cap does not (the cut-away roof still shades its own floor).
/** name of the per-instance state attribute (vec4) on an instanced structure part */
export const OBJECT_OCCLUSION_ATTR = 'aOccState';

const OBJ_VERT_PARS = /* glsl */ `
#ifdef USE_INSTANCING
attribute vec4 aOccState;
#else
uniform vec4 uOccState;
#endif
varying vec4 vOccState;
`;
const OBJ_VERT_MAIN = /* glsl */ `
#ifdef USE_INSTANCING
  vOccState = aOccState;
#else
  vOccState = uOccState;
#endif
`;
const OBJ_FRAG_PARS = /* glsl */ `
varying vec4 vOccState;
float occObjDither() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
`;
const OBJ_FRAG_MAIN = /* glsl */ `
if (vOccState.x > 0.0 || vOccState.y > 0.0) {
  float occDz = occObjDither();
  // the whole object (1 = gone)
  if (occDz < vOccState.x) discard;
  if (vOccState.y > 0.0) {
    // world height of the fragment (view space back to world: p = cameraPosition + transpose(mat3(viewMatrix)) * pv)
    float occWy = cameraPosition.y + dot(viewMatrix[1].xyz, -vViewPosition);
    // a 6 cm dithered band at the cap height instead of a hard aliased edge (r9 ship: 12 cm gave every cut post top a sawtooth)
    if (occDz < vOccState.y * smoothstep(vOccState.z - 0.03, vOccState.z + 0.03, occWy)) discard;
  }
}
`;

/**
 * Patches a structure GLB material (MeshStandard; call inside onBeforeCompile after the look patches) with the per-object occlusion
 * state: the per-instance `aOccState` attribute on an InstancedMesh, `state` (the entry's own uniform) on a plain Mesh.
 */
export function applyObjectOcclusion(shader: WebGLProgramParametersWithUniforms, state: { value: Vector4 }): void {
  shader.uniforms.uOccState = state;
  shader.vertexShader = shader.vertexShader.replace('void main() {', `${OBJ_VERT_PARS}\nvoid main() {\n${OBJ_VERT_MAIN}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `${OBJ_FRAG_PARS}\nvoid main() {`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${OBJ_FRAG_MAIN}`);
}

const OBJ_FRAG_MAIN_DEPTH = /* glsl */ `
if (vOccState.x > 0.0 && occObjDither() < vOccState.x) discard;
`;

/**
 * r9 ship: the shadow-pass twin of applyObjectOcclusion for a structure part's customDepthMaterial (a MeshDepthMaterial): only the whole fade
 * (state x), dithered in shadow-map texels, so a fading prop's shadow fades with it and a gone prop throws none.
 */
export function applyObjectOcclusionDepth(shader: WebGLProgramParametersWithUniforms, state: { value: Vector4 }): void {
  shader.uniforms.uOccState = state;
  shader.vertexShader = shader.vertexShader.replace('void main() {', `${OBJ_VERT_PARS}\nvoid main() {\n${OBJ_VERT_MAIN}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `${OBJ_FRAG_PARS}\nvoid main() {`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${OBJ_FRAG_MAIN_DEPTH}`);
}

/** Patches a MeshStandard/Lambert/Phong shader (call inside onBeforeCompile after your own replacements). */
export function applyOcclusionFade(shader: WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uHeroView = heroViewUniform;
  shader.uniforms.uOccludeR = occlusionRadius;
  shader.uniforms.uOccP = occlusionParams;
  let f = shader.fragmentShader.replace('void main() {', `${OCCLUSION_GLSL}\nvoid main() {`).replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${MAIN}`);
  if (f.includes('#include <alphatest_fragment>')) f = f.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>\n${ALPHA}`);
  shader.fragmentShader = f;
}

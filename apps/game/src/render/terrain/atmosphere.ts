// Shared zone atmosphere: cloud shadows, focus-relative depth haze and drifting ground mist for every lit material of the
// terrain family (terrain, trees, rocks, structures, ground cover). One uniform set, one GLSL patch.
//
//   material.onBeforeCompile = (shader) => {
//     ... own patches ...
//     applyOcclusionFade(shader);
//     applyAtmosphere(shader);      // MeshStandard / Lambert / Phong only (needs vViewPosition + reflectedLight)
//   };
//
// The patch derives the world position of a fragment from vViewPosition and the camera world matrix, so it works on any mesh
// (instanced, custom vertex shaders) without touching the vertex stage. `zoneScene` owns the uniforms:
// `configureAtmosphere(look)` on zone creation, `updateAtmosphere(camera, focus)` every frame, `applyArcAtmosphere` when the run light
// arc (arc.ts, PL-03a) moves the haze / mist / light-pool gain.
import { Color, Matrix4, Vector3, Vector4 } from 'three';
import type { PerspectiveCamera, WebGLProgramParametersWithUniforms } from 'three';
import type { ZoneLook } from './look/types';
import { sharedNoise } from './macroNoise';
import { worldUniforms } from './zoneContext';

export const atmosphereUniforms = {
  /** camera world matrix (view -> world) */
  uViewInv: { value: new Matrix4() },
  /** x strength, y metres per feature, z drift speed (m/s), w unused */
  uCloud: { value: new Vector4(0, 160, 3, 0) },
  /** x depth haze amount, y camera->focus distance (m), z haze range (m), w mist density */
  uHaze: { value: new Vector4(0, 22, 40, 0) },
  /** x mist scale (m), y mist drift (m/s), z mist height (m), w hero clear radius (m) */
  uMist: { value: new Vector4(60, 1.2, 2.5, 8) },
  uHazeColor: { value: new Color('#ffffff') },
  uAtmoNoise: { value: sharedNoise() },
  /** PL-03a: multiplier of the baked light-pool emissive (read by the terrain shader only); the run arc raises it at dusk, 1 = as baked */
  uPoolGain: { value: 1 },
};

/**
 * GLSL shared by the terrain shader and the generic patch. The uAtmo* names cannot collide with uniforms the host materials
 * declare themselves (uTime, uWindDir, uFocus ... exist in several of them); the terrain shader maps its own names onto these.
 */
export const ATMO_FUNCS = /* glsl */ `
uniform mat4 uViewInv;
uniform vec4 uCloud;
uniform vec4 uHaze;
uniform vec4 uMist;
uniform vec3 uHazeColor;
uniform sampler2D uAtmoNoise;
uniform float uAtmoTime;
uniform vec2 uAtmoWind;
uniform vec3 uAtmoFocus;

float atmoCloud(vec2 p) {
  vec2 q = p / uCloud.y + uAtmoWind * (uAtmoTime * uCloud.z / uCloud.y);
  float n = texture2D(uAtmoNoise, q * 0.35).r * 0.65 + texture2D(uAtmoNoise, q * 0.9 + 0.37).g * 0.35;
  return 1.0 - uCloud.x * smoothstep(0.42, 0.62, n);
}

float atmoMist(vec3 wp) {
  vec2 q = wp.xz / uMist.x + vec2(uAtmoWind.y, -uAtmoWind.x) * (uAtmoTime * uMist.y / uMist.x);
  float n = texture2D(uAtmoNoise, q * 0.5).r * 0.6 + texture2D(uAtmoNoise, q * 1.3 + 0.61).g * 0.4;
  float body = smoothstep(0.32, 0.78, n);
  float lift = exp(-max(wp.y, 0.0) / max(uMist.z, 0.1));
  float clear = smoothstep(uMist.w * 0.5, uMist.w * 2.0, distance(wp.xz, uAtmoFocus.xz));
  return uHaze.w * body * lift * clear;
}
`;

const FRAG_LIGHT = /* glsl */ `
{
  vec3 atmoWP = (uViewInv * vec4(-vViewPosition, 1.0)).xyz;
  float atmoShade = atmoCloud(atmoWP.xz);
  reflectedLight.directDiffuse *= atmoShade;
  reflectedLight.directSpecular *= atmoShade;
}
`;

const FRAG_FOG = /* glsl */ `
{
  vec3 atmoWP2 = (uViewInv * vec4(-vViewPosition, 1.0)).xyz;
  float atmoDepth = length(vViewPosition);
  float atmoH = uHaze.x * smoothstep(0.0, uHaze.z, atmoDepth - uHaze.y);
  atmoH = max(atmoH, atmoMist(atmoWP2));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, clamp(atmoH, 0.0, 0.92));
}
`;

/** Patches a MeshStandard/Lambert/Phong shader (call inside onBeforeCompile after your own replacements). */
export function applyAtmosphere(shader: WebGLProgramParametersWithUniforms): void {
  const u = atmosphereUniforms;
  shader.uniforms.uViewInv = u.uViewInv;
  shader.uniforms.uCloud = u.uCloud;
  shader.uniforms.uHaze = u.uHaze;
  shader.uniforms.uMist = u.uMist;
  shader.uniforms.uHazeColor = u.uHazeColor;
  shader.uniforms.uAtmoNoise = u.uAtmoNoise;
  shader.uniforms.uAtmoTime = worldUniforms.uTime;
  shader.uniforms.uAtmoWind = worldUniforms.uWindDir;
  shader.uniforms.uAtmoFocus = worldUniforms.uFocus;
  let f = shader.fragmentShader;
  f = f.replace('void main() {', `${ATMO_FUNCS}\nvoid main() {`);
  if (f.includes('#include <lights_fragment_end>')) f = f.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAG_LIGHT}`);
  if (f.includes('#include <fog_fragment>')) f = f.replace('#include <fog_fragment>', `#include <fog_fragment>\n${FRAG_FOG}`);
  shader.fragmentShader = f;
}

const tmpColor = new Color();
const tmpV = new Vector3();

/** Applies a zone's haze / cloud settings to the shared uniforms. Absent features are switched off. */
export function configureAtmosphere(look: ZoneLook): void {
  const u = atmosphereUniforms;
  const c = look.cloud;
  u.uCloud.value.set(c?.strength ?? 0, c?.scale ?? 160, c?.speed ?? 3, 0);
  const h = look.haze;
  u.uHaze.value.set(h?.depth ?? 0, 22, h?.range ?? 40, h?.mist ?? 0);
  u.uMist.value.set(h?.mistScale ?? 60, h?.mistSpeed ?? 1.2, h?.mistHeight ?? 2.5, h?.clearRadius ?? 8);
  u.uHazeColor.value.copy(tmpColor.set(h?.color ?? '#ffffff'));
  u.uPoolGain.value = 1;
}

/**
 * PL-03a: the run arc's haze (colour, depth haze, ground mist) and light-pool gain for this frame. Uniforms only; the values it
 * starts from are the ones `configureAtmosphere` set (the arc's identity state), so an identity arc never calls this.
 */
export function applyArcAtmosphere(haze: { color: Color; depth: number; mist: number }, poolGain: number): void {
  const u = atmosphereUniforms;
  u.uHazeColor.value.copy(haze.color);
  u.uHaze.value.x = haze.depth;
  u.uHaze.value.w = haze.mist;
  u.uPoolGain.value = poolGain;
}

/** Per frame: camera matrix and the camera -> focus distance that anchors the depth haze. */
export function updateAtmosphere(camera: PerspectiveCamera, focus: Vector3): void {
  const u = atmosphereUniforms;
  camera.updateMatrixWorld();
  u.uViewInv.value.copy(camera.matrixWorld);
  u.uHaze.value.y = tmpV.setFromMatrixPosition(camera.matrixWorld).distanceTo(focus);
}

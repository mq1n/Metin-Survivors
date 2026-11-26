// Sky system: gradient dome with sun, painted clouds and (volcano) smoke plumes, plus a distant mountain backdrop of
// three silhouette rings. 2 draw calls, both camera-centred (no parallax). The dome is pinned to the far plane so the
// terrain rejects its pixels early; both meshes are hidden when the camera cannot see the horizon (gameplay camera).
// Zones core C6: a third camera-centred mesh, the abyss, fills every pixel below the horizon that no geometry covered
// (the camera inside a rim wall looks down through the culled wall into nothing; the far plane clips a wide view) with
// the zone's rock tone dissolving into the haze at the horizon, instead of a flat fog-coloured void. It sits just in
// front of the dome at the far plane and is always on: early-z rejects it wherever the world is drawn.
import {
  BackSide,
  Color,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
  type IUniform,
  type PerspectiveCamera,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { CAMERA_FOV } from '../../camera';
import type { QualityProfile } from '../../quality';
import { applyAtmosphere, atmosphereUniforms } from '../atmosphere';
import { findLook } from '../look';
import { worldUniforms, type ZoneContext, type ZoneSystem } from '../zoneContext';
import { getNoiseAtlas } from './noiseAtlas';
import { buildBackdrop } from './backdrop';
import { DOME_FRAG, DOME_VERT, RING_FRAG, RING_VERT } from './shaders';
import { SKY_DITHER_GLSL, SKY_GRADIENT_GLSL } from './skyGlsl';
import { styleFor } from './styles';

const DOME_RADIUS = 250;
/** C6: the abyss sphere sits inside the dome (and inside the camera far plane) */
const ABYSS_RADIUS = 240;
/** the horizon is considered visible when the top frustum edge is above this elevation (rad, ≈ −22°) */
const VISIBLE_ELEVATION = -0.38;

/**
 * SKY-01 / FEEL-04: does a camera looking `pitchDeg` DOWN (the gameplay rig: 55°; the run-start fly-in starts near 22°) with a vertical
 * field of view of `fovDeg` draw the dome and the backdrop? Same rule as `update`: the top frustum edge must be above
 * VISIBLE_ELEVATION. With the rig's 40° FOV that is every pitch below 42°, so the fly-in (20-30°) always sees them and the
 * gameplay pitch (55°) never does.
 */
export function skyVisibleFor(pitchDeg: number, fovDeg = CAMERA_FOV): boolean {
  return skyTopVisible(((fovDeg / 2 - pitchDeg) * Math.PI) / 180);
}

/** `topElevation`: elevation of the top frustum edge (rad, + above the horizon) */
function skyTopVisible(topElevation: number): boolean {
  return topElevation > VISIBLE_ELEVATION;
}

const ABYSS_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  // at the far plane, a hair in front of the dome: only pixels no geometry covered are left for it
  gl_Position.z = gl_Position.w * 0.99985;
}
`;

export const ABYSS_FRAG = /* glsl */ `
${SKY_GRADIENT_GLSL}
${SKY_DITHER_GLSL}
uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uRock;
uniform vec3 uRockShade;
// share of the haze colour mixed into the rock floor (aerial perspective: a floor far below is never as dark as its tone)
uniform float uHazeMix;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  if (e > 0.01) discard;
  // a rock floor far below: perspective-projected noise, soft broad light / dark patches plus a finer grain (no cell borders:
  // outlined cells read as giant paving), darker straight down
  vec2 uv = d.xz / max(-e, 0.08) * 0.85;
  float n = texture2D(uNoise, uv * 0.2).b * 0.55 + texture2D(uNoise, uv * 0.9 + 0.37).b * 0.3 + texture2D(uNoise, uv * 3.1 + 0.71).b * 0.15;
  float cell = texture2D(uNoise, uv * 0.5 + 0.11).a;
  vec3 rock = mix(uRockShade, uRock, smoothstep(0.2, 0.8, n));
  rock *= (1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.3, cell))) * (0.8 + 0.2 * smoothstep(-1.0, -0.4, e));
  rock = mix(rock, uHazeColor, uHazeMix);
  // towards the horizon the floor dissolves into the sky gradient, so a wide view meets the dome without a seam
  float hz = 1.0 - smoothstep(-0.02, -0.32, e);
  gl_FragColor = vec4(mix(rock, skyGradient(d), hz), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // SKY-01: the dome's low tier dither (0.0 elsewhere), so the two meet at the horizon with the same grain
  gl_FragColor.rgb += skyDither(uTime);
}
`;

/** atmosphere.ts clamps its depth haze to this share (FRAG_FOG: clamp(atmoH, 0.0, 0.92)) */
const ATMO_HAZE_MAX = 0.92;

/**
 * Does atmosphere.ts mix its depth haze colour into the fragment as the raw (linear) uniform, after `<colorspace_fragment>`? True when
 * SKY-01 was written: on a draw straight to the canvas (low: no composite pass) the far terrain then ends at `mix(OETF(fog), haze, k)`
 * instead of `OETF(mix(fog, haze, k))`, 15-25 levels darker than the correct colour, and the sky mirrors it (ATMO_RAW in
 * SKY_HAZE_OUT_GLSL) so the world edge has no step on that tier. Read from the patch atmosphere.ts really applies, once: when that
 * file converts the haze (the fix), this turns false by itself and the sky converts too. Medium / high are unaffected (identity).
 */
export function atmosphereHazeIsRaw(): boolean {
  const probe = { uniforms: {}, fragmentShader: 'void main() {\n#include <fog_fragment>\n}' } as unknown as WebGLProgramParametersWithUniforms;
  applyAtmosphere(probe);
  return isRawHazeMix(probe.fragmentShader);
}

/** the haze mix of a patched fragment shader takes the `uHazeColor` uniform as it is (no conversion in between) */
export function isRawHazeMix(fragmentShader: string): boolean {
  return /mix\(\s*gl_FragColor\.rgb\s*,\s*uHazeColor\s*,/.test(fragmentShader);
}

/**
 * SKY-01 redo: the colour the sky hazes toward is the colour the FAR TERRAIN ends at, not the plain scene fog. A fragment past the focus
 * distance + the haze range is the scene fog colour (three's fog, factor 1 beyond the fog far plane) with atmosphere.ts' depth haze
 * mixed over it (`mix(fog, atmosphereUniforms.uHazeColor, uHaze.x)`), which is lighter and warmer in Suryeon and Yeonmu. The first
 * build hazed toward the fog alone, so everything the sky draws behind the world edge (the dome's horizon band, the backdrop walls'
 * foot fade, the abyss) came out darker than the ground in front of it: a 5-10 level step along the edge and, in Suryeon's low
 * views, dark lobes of wall foot hanging between the pale far cliffs. Read every frame: the run arc moves both colours and the depth.
 * Working-space (linear) colours, so the identity on the HDR target of medium / high. `out` receives the result.
 */
export function skyHazeColor(out: Color, fog: Color): Color {
  return out.copy(fog).lerp(atmosphereUniforms.uHazeColor.value, atmoHazeShare());
}

/** the share of atmosphere.ts' haze colour on a fragment past the focus distance + haze range (FRAG_FOG's clamp included) */
function atmoHazeShare(): number {
  return Math.min(Math.max(atmosphereUniforms.uHaze.value.x, 0), ATMO_HAZE_MAX);
}

function qualityLevel(p: QualityProfile): number {
  return p.tier === 'low' ? 0 : p.tier === 'medium' ? 1 : 2;
}

export function createSky(ctx: ZoneContext): ZoneSystem {
  const { biome, core } = ctx;
  const env = core.env;
  const style = styleFor(biome.id);
  const edge = findLook(biome.id)?.edge;
  const backdrop = buildBackdrop(style, biome.seed, { ringBase: edge?.ringBase ?? 0 });

  const sunColor = new Color();
  const hazeColor = new Color();
  // dome + rings (output-space haze, see SKY_HAZE_OUT_GLSL): the fog and the atmosphere haze as they are, and the haze share
  const fogColor = new Color();
  const atmoHaze = new Color();
  const atmoK = { value: 0 };
  const plumes = backdrop.craters.map((c) => new Vector4(c.dirX, c.dirZ, Math.atan2(c.y, c.radius), 1));
  const shared: Record<string, IUniform> = {
    uNoise: { value: getNoiseAtlas() },
    uTime: worldUniforms.uTime,
    uWindDir: worldUniforms.uWindDir,
    uSunDir: worldUniforms.uSunDir,
    uSunColor: { value: sunColor },
    uSkyTop: { value: new Color(biome.sky.top) },
    uSkyHorizon: { value: new Color(biome.sky.horizon) },
    uSkyBottom: { value: new Color(biome.sky.bottom) },
    uHazeColor: { value: hazeColor },
  };
  const hazeUniforms: Record<string, IUniform> = { uFogColor: { value: fogColor }, uAtmoHaze: { value: atmoHaze }, uAtmoK: atmoK };
  const baseDefines: Record<string, string | number> = { QUALITY: qualityLevel(ctx.quality) };
  if (atmosphereHazeIsRaw()) baseDefines.ATMO_RAW = 1;

  const domeMat = new ShaderMaterial({
    name: 'sky_dome',
    uniforms: {
      ...shared,
      ...hazeUniforms,
      uCloudLit: { value: new Color(style.cloudLit).multiplyScalar(1.15) },
      uCloudShade: { value: new Color(style.cloudShade) },
      uGlow: { value: new Color(style.glow) },
      uPlume: { value: plumes },
    },
    defines: { ...baseDefines, CLOUD: style.cloud, NPLUME: plumes.length },
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    side: BackSide,
    fog: false,
    depthWrite: false,
    depthTest: true,
  });
  const dome = new Mesh(new SphereGeometry(DOME_RADIUS, 40, 20), domeMat);
  dome.name = 'sky:dome';
  dome.frustumCulled = false;
  // after the opaque terrain (early-z rejects covered pixels), before the transparent liquids
  dome.renderOrder = 1000;

  const ringDefines: Record<string, string | number> = { ...baseDefines };
  if (style.strata) ringDefines.STRATA = 1;
  if (style.snowLine > 0) ringDefines.SNOW = 1;
  if (style.profile === 'volcano') ringDefines.VOLCANO = 1;
  if (style.profile === 'mesa') ringDefines.MESA = 1;
  const ringMat = new ShaderMaterial({
    name: 'sky_backdrop',
    uniforms: {
      ...shared,
      ...hazeUniforms,
      uShadow: { value: new Color(style.shadow) },
      uSnow: { value: style.snowLine },
      uRough: { value: { rolling: 0.22, mesa: 0.25, alpine: 0.8, volcano: 0.55 }[style.profile] },
    },
    defines: ringDefines,
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    side: DoubleSide,
    fog: false,
  });
  const rings = new Mesh(backdrop.geometry, ringMat);
  rings.name = 'sky:backdrop';
  rings.frustumCulled = false;

  // C6 abyss: the zone's rock tone (nearest backdrop ring, its shadow colour for the dark side)
  const rockTint = new Color(style.rings[0].tint);
  const abyssMat = new ShaderMaterial({
    name: 'sky_abyss',
    uniforms: {
      uNoise: shared.uNoise as IUniform,
      uTime: shared.uTime as IUniform,
      uSkyTop: shared.uSkyTop as IUniform,
      uSkyHorizon: shared.uSkyHorizon as IUniform,
      uSkyBottom: shared.uSkyBottom as IUniform,
      uHazeColor: shared.uHazeColor as IUniform,
      uRock: { value: rockTint.clone().multiplyScalar(0.62) },
      uRockShade: { value: new Color(style.shadow).lerp(rockTint, 0.35).multiplyScalar(0.42) },
      uHazeMix: { value: 0.5 * (edge?.fogWall ?? 0.6) },
    },
    // QUALITY gates the low tier dither (skyDither); setQuality keeps it in step with the dome and the rings
    defines: { ...baseDefines },
    vertexShader: ABYSS_VERT,
    fragmentShader: ABYSS_FRAG,
    side: BackSide,
    fog: false,
    depthWrite: true,
    depthTest: true,
  });
  const abyss = new Mesh(new SphereGeometry(ABYSS_RADIUS, 32, 16, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), abyssMat);
  abyss.name = 'sky:abyss';
  abyss.frustumCulled = false;
  // after the opaque world (early-z rejects every covered pixel), before the dome it hides below the horizon
  abyss.renderOrder = 999;

  const group = new Group();
  group.name = 'sky';
  group.add(rings, abyss, dome);

  const fwd = new Vector3();

  return {
    name: 'sky',
    group,
    update(_dt: number, camera: PerspectiveCamera, _focus: Vector3) {
      group.position.copy(camera.position);
      // the abyss is always on (it only shades uncovered pixels) and needs the current haze colour
      skyHazeColor(hazeColor, env.fog.color);
      fogColor.copy(env.fog.color);
      atmoHaze.copy(atmosphereUniforms.uHazeColor.value);
      atmoK.value = atmoHazeShare();
      camera.getWorldDirection(fwd);
      const top = Math.asin(Math.max(-1, Math.min(1, fwd.y))) + (camera.fov * Math.PI) / 360;
      const seen = skyTopVisible(top);
      dome.visible = seen;
      rings.visible = seen;
      if (!seen) return;
      sunColor.copy(env.sun.color);
    },
    setQuality(p: QualityProfile) {
      const q = qualityLevel(p);
      for (const m of [domeMat, ringMat, abyssMat]) {
        if (m.defines.QUALITY !== q) {
          m.defines.QUALITY = q;
          m.needsUpdate = true;
        }
      }
    },
    dispose() {
      dome.geometry.dispose();
      abyss.geometry.dispose();
      backdrop.geometry.dispose();
      domeMat.dispose();
      ringMat.dispose();
      abyssMat.dispose();
    },
  };
}

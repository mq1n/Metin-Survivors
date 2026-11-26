// Tree materials: Lambert + onBeforeCompile patches (so the scene's hemisphere/sun lights, fog, tone mapping and the
// dynamic shadow map keep working) for BatchedMesh draws. Shared pieces: wind sway in the vertex shader (trunk bend by
// height², per-vertex leaf flutter), distance-driven dithered LOD cross-fade (stateless: LOD0 and LOD1 instances use
// complementary screen-door masks), foliage with two-texture mixing, soft translucency and un-flipped spherical
// normals; bark with normal map, snow dusting and charred ember glow.
import { Color, DoubleSide, MeshLambertMaterial, Vector2, type IUniform, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import { applyOcclusionFade } from '../terrain/occlusion';
import { applyAtmosphere } from '../terrain/atmosphere';
import { worldUniforms } from '../terrain/zoneContext';

export interface TreeLook {
  /** colour multiplier on the foliage (grading toward mid-dark, gameplay readability) */
  grade: [number, number, number];
  /** colour multiplier on bark */
  barkGrade: [number, number, number];
  /** back-light strength through leaves */
  translucency: number;
  /** snow dusting on up-facing surfaces (0..1 coverage) */
  snow: number;
  /** charred ember glow strength (0 = off) */
  ember: number;
  /**
   * Zone override only (look.trees.<species>.bark, read by trees.ts, never by the materials): bark texture id, e.g.
   * 'tex_bark_yeonmu_beech'. Absent = the species default.
   */
  bark?: string;
  /**
   * Zone override only (look.trees.<species>.fol, read by trees.ts): foliage texture ids [A, B], B = the alternate card
   * some lobes use (null = A everywhere), e.g. ['tex_fol_yeonmu_autumn', null]. Absent = the species default.
   */
  fol?: [string, string | null];
}

/** shared LOD fade window (metres from the camera): LOD0 is fully visible below x, fully replaced above y */
export const lodWindow = { value: new Vector2(54, 64) };

const WIND_PARS = /* glsl */ `
attribute vec4 aData;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec2 uLod;
varying vec4 vDat;
varying float vFade;
varying vec3 vWN;
`;

const WIND_BODY = /* glsl */ `
{
  vec3 ip = batchingMatrix[3].xyz;
  float seed = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
  mat3 bm = mat3(batchingMatrix);
  float s2 = max(dot(bm[1], bm[1]), 1e-4);
  vec3 wdir = vec3(uWindDir.x, 0.0, uWindDir.y);
  float ph = dot(ip.xz, uWindDir) * 0.045 - uTime * (0.7 + 0.5 * uWindStrength) + seed * 6.2831;
  float gust = 0.5 + 0.5 * sin(ph) + 0.35 * sin(ph * 2.3 + seed * 3.0);
  float amp = (0.15 + 0.5 * uWindStrength) * gust * 0.5;
  float h = aData.x;
  vec3 dW = wdir * (amp * h * h);
  vec3 wp = bm * transformed + ip;
  float fl = aData.y * (0.025 + 0.05 * uWindStrength);
  dW += fl * vec3(sin(uTime * 3.7 + wp.x * 2.1 + wp.y * 1.3 + seed * 9.0), sin(uTime * 4.3 + wp.y * 2.7 + wp.z * 1.7), sin(uTime * 3.1 + wp.z * 2.3 + wp.x * 1.1));
  transformed += (dW * bm) / s2;
  float camD = distance(cameraPosition, ip);
  float lodFrac = 1.0 - smoothstep(uLod.x, uLod.y, camD);
  vFade = lodFrac;
  vDat = aData;
  vWN = normalize(objectNormal);
}
`;

// LOD cross-fade. Zones core C5: on multisampled tiers (uOccP.w, terrain/occlusion.ts) an alpha-to-coverage material
// dissolves the near LOD over the far one (which stays solid across the window) instead of a screen-door; single-sample
// tiers keep the complementary dither masks.
const FADE_FRAG = /* glsl */ `
{
#ifdef ALPHA_TO_COVERAGE
  if (uOccP.w > 0.5) {
    gLodAlpha = vDat.w < 0.5 ? vFade : 1.0;
    if (vDat.w < 0.5 ? vFade <= 0.002 : vFade >= 0.998) discard;
  } else
#endif
  {
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    bool vis = vDat.w < 0.5 ? ign < vFade : ign >= vFade;
    if (!vis) discard;
  }
}
`;

/** after the alpha test: the near LOD's dissolve becomes coverage (alpha-to-coverage materials only) */
const LOD_ALPHA = /* glsl */ `
#ifdef ALPHA_TO_COVERAGE
  diffuseColor.a *= gLodAlpha;
#endif
`;

function replaceOnce(src: string, token: string, repl: string): string {
  if (!src.includes(token)) throw new Error(`vegetation shader patch: token ${token} not found`);
  return src.replace(token, repl);
}

function windUniforms(u: Record<string, IUniform>): void {
  u.uTime = worldUniforms.uTime;
  u.uWindDir = worldUniforms.uWindDir;
  u.uWindStrength = worldUniforms.uWindStrength;
  u.uLod = lodWindow;
}

function patchVertex(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = replaceOnce(shader.vertexShader, '#include <common>', `#include <common>\n${WIND_PARS}`);
  shader.vertexShader = replaceOnce(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>\n${WIND_BODY}`);
}

const FRAG_PARS = /* glsl */ `
varying vec4 vDat;
varying float vFade;
varying vec3 vWN;
float gLodAlpha = 1.0;
`;

export function createFoliageMaterial(look: TreeLook, mapA: Texture, mapB: Texture | null): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ map: mapA, vertexColors: true, side: DoubleSide, alphaTest: 0.42, alphaToCoverage: true });
  mat.name = 'treeFoliage';
  const grade = new Color(look.grade[0], look.grade[1], look.grade[2]);
  mat.onBeforeCompile = (shader) => {
    windUniforms(shader.uniforms);
    shader.uniforms.mapB = { value: mapB ?? mapA };
    shader.uniforms.uGrade = { value: grade };
    shader.uniforms.uTranslucency = { value: look.translucency };
    patchVertex(shader);
    let f = shader.fragmentShader;
    f = replaceOnce(f, '#include <common>', `#include <common>\n${FRAG_PARS}\nuniform sampler2D mapB;\nuniform vec3 uGrade;\nuniform float uTranslucency;`);
    f = replaceOnce(
      f,
      '#include <map_fragment>',
      `${FADE_FRAG}
      vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(mapB, vMapUv), step(0.5, vDat.z));
      diffuseColor *= sampledDiffuseColor;`,
    );
    f = replaceOnce(f, '#include <color_fragment>', 'diffuseColor.rgb *= vColor.rgb * uGrade;');
    f = replaceOnce(f, '#include <alphatest_fragment>', `#include <alphatest_fragment>\n${LOD_ALPHA}`);
    // spherical normals are authored per vertex: never flip them for back faces
    f = replaceOnce(f, '#include <normal_fragment_begin>', 'vec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;');
    f = replaceOnce(
      f,
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      #if NUM_DIR_LIGHTS > 0
      {
        float back = pow(saturate(dot(-directionalLights[0].direction, normalize(vViewPosition)) * 0.5 + 0.5), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * directionalLights[0].color * (back * uTranslucency);
      }
      #endif`,
    );
    shader.fragmentShader = f;
    applyOcclusionFade(shader);
    applyAtmosphere(shader);
  };
  mat.customProgramCacheKey = () => 'treeFoliage';
  return mat;
}

export function createBarkMaterial(look: TreeLook, map: Texture, normalMap: Texture | null): MeshLambertMaterial {
  // C5: alpha-to-coverage (bark alpha is forced to 1; only the LOD dissolve and the camera-to-hero cut use coverage)
  const mat = new MeshLambertMaterial({ map, normalMap: normalMap ?? undefined, vertexColors: true, alphaToCoverage: true });
  if (normalMap) mat.normalScale.set(0.9, 0.9);
  mat.name = 'treeBark';
  const grade = new Color(look.barkGrade[0], look.barkGrade[1], look.barkGrade[2]);
  const key = `treeBark${normalMap ? 'N' : ''}${look.ember > 0 ? 'E' : ''}${look.snow > 0 ? 'S' : ''}`;
  mat.onBeforeCompile = (shader) => {
    windUniforms(shader.uniforms);
    shader.uniforms.uGrade = { value: grade };
    shader.uniforms.uSnow = { value: look.snow };
    shader.uniforms.uEmber = { value: look.ember };
    patchVertex(shader);
    let f = shader.fragmentShader;
    f = replaceOnce(f, '#include <common>', `#include <common>\n${FRAG_PARS}\nuniform vec3 uGrade;\nuniform float uSnow;\nuniform float uEmber;\nuniform float uTime;`);
    f = replaceOnce(f, '#include <map_fragment>', `${FADE_FRAG}\n#include <map_fragment>\n#ifdef ALPHA_TO_COVERAGE\ndiffuseColor.a = 1.0;\n#endif`);
    f = replaceOnce(f, '#include <alphatest_fragment>', `#include <alphatest_fragment>\n${LOD_ALPHA}`);
    f = replaceOnce(
      f,
      '#include <color_fragment>',
      `diffuseColor.rgb *= vColor.rgb * uGrade;
      vec3 barkLinear = diffuseColor.rgb;
      // snow dusting: up-facing bark turns blue-white (the world normal comes from the vertex shader)
      float snowK = smoothstep(0.3, 0.75, vWN.y) * smoothstep(0.3, 0.9, vDat.z) * smoothstep(0.04, 0.12, vDat.x) * uSnow * 0.8;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.85, 0.94) * mix(0.8, 1.0, saturate(vColor.r)), snowK);`,
    );
    f = replaceOnce(
      f,
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      if (uEmber > 0.0) {
        // the charred bark texture carries glowing cracks: lift the red-dominant texels into emission
        float glow = smoothstep(0.1, 0.5, barkLinear.r - 0.55 * max(barkLinear.g, barkLinear.b));
        float flick = 0.8 + 0.2 * sin(uTime * 2.3 + vMapUv.x * 31.0 + vMapUv.y * 17.0);
        totalEmissiveRadiance += vec3(1.0, 0.32, 0.06) * glow * flick * uEmber * (0.4 + 0.6 * vDat.z);
      }`,
    );
    shader.fragmentShader = f;
    applyOcclusionFade(shader);
    applyAtmosphere(shader);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

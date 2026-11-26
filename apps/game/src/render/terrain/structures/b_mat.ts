// Materials for the set-B structures.
//  * structureMaterial: MeshStandardMaterial + vertex colours (painted palette + AO) with a luminance/hue *detail* layer
//    sampled from up to four textures chosen per vertex (aMs.x: wood / bark / stone / cloth) and an optional cloth sway
//    (aMs.y) driven by worldUniforms. Detail = texel ÷ texture average, so the vertex palette stays in charge of the
//    colour and any texture (Imagegen's or the procedural fallback) only adds breakup.
//  * flameMaterial: additive camera-facing flame cards (+ ground glow) with an in-shader flicker.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshStandardMaterial,
  RepeatWrapping,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector4,
  type Texture,
} from 'three';
import { applyOcclusionFade } from '../occlusion';
import { applyAtmosphere } from '../atmosphere';
import { worldUniforms } from '../zoneContext';
import { proceduralTexture } from './b_tex';
import type { StructureBuildContext } from './types';

export interface StructureMatOpts {
  roughness?: number;
  doubleSided?: boolean;
  /** compile the cloth-sway vertex code (banners, tent flaps, straw) */
  sway?: boolean;
  /** detail strength per slot [wood, bark, stone, cloth] (0 = flat, 1 = full texture contrast) */
  detail?: [number, number, number, number];
  /** emissive gain for slot 5 vertices (glowing coals / runes) */
  glow?: number;
  /** flat fill light as a fraction of albedo, so the side facing away from the sun never goes black (default 0.1) */
  fill?: number;
  /** detail texture id for the stone slot (default tex_rock_mossy) */
  stoneTexture?: string;
}

function tile(t: Texture): Texture {
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export function structureMaterial(ctx: StructureBuildContext, o: StructureMatOpts = {}): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: o.roughness ?? 0.88, metalness: 0 });
  if (o.doubleSided) mat.side = DoubleSide;
  const tex = {
    uTexWood: { value: tile(ctx.texture('tex_wood_plank') ?? proceduralTexture('wood')) },
    uTexBark: { value: tile(ctx.texture('tex_bark_oak') ?? proceduralTexture('bark')) },
    uTexStone: { value: tile(ctx.texture(o.stoneTexture ?? 'tex_rock_mossy') ?? proceduralTexture('stone')) },
    uTexCloth: { value: proceduralTexture('cloth') },
  };
  const d = o.detail ?? [0.9, 0.8, 0.7, 0.55];
  const uniforms = {
    ...tex,
    uDetail: { value: new Vector4(d[0], d[1], d[2], d[3]) },
    uGlow: { value: o.glow ?? 2.2 },
    uFill: { value: o.fill ?? 0.1 },
    uTime: worldUniforms.uTime,
    uWindDir: worldUniforms.uWindDir,
    uWindStrength: worldUniforms.uWindStrength,
    uSunDirB: worldUniforms.uSunDir,
  };
  const sway = o.sway === true;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aMs;
varying float vMat;
varying vec2 vDUv;
uniform vec3 uSunDirB;
${sway ? 'uniform float uTime; uniform vec2 uWindDir; uniform float uWindStrength;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vMat = aMs.x;
vDUv = uv;
${
  sway
    ? `if (aMs.y > 0.001) {
  mat4 mm = modelMatrix;
  #ifdef USE_INSTANCING
  mm = mm * instanceMatrix;
  #endif
  vec3 wp = (mm * vec4(transformed, 1.0)).xyz;
  vec3 wl = (vec4(uWindDir.x, 0.0, uWindDir.y, 0.0) * mm).xyz;
  wl /= max(length(wl), 1e-4);
  float gust = 0.55 + 0.45 * sin(uTime * 0.9 + dot(wp.xz, vec2(0.13, 0.09)));
  float ph = dot(wp.xz, uWindDir) * 0.9 - uTime * (2.4 + 2.0 * uWindStrength) + transformed.y * 0.8;
  float amp = (0.05 + 0.16 * uWindStrength) * aMs.y;
  transformed += wl * (0.10 + 0.34 * uWindStrength * gust) * aMs.y;
  transformed += normal * sin(ph) * amp + wl * (0.5 + 0.5 * sin(ph * 1.7 + 1.3)) * amp * 0.7;
}`
    : ''
}`,
      )
      .replace(
        '#include <shadowmap_vertex>',
        o.doubleSided
          ? `{
  // thin double-sided cloth: bias the shadow lookup toward the sun side so a surface never shadows itself
  vec3 wn = inverseTransformDirection(transformedNormal, viewMatrix);
  if (dot(wn, uSunDirB) < 0.0) transformedNormal = -transformedNormal;
}
#include <shadowmap_vertex>`
          : '#include <shadowmap_vertex>',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vMat;
varying vec2 vDUv;
uniform sampler2D uTexWood;
uniform sampler2D uTexBark;
uniform sampler2D uTexStone;
uniform sampler2D uTexCloth;
uniform vec4 uDetail;
uniform float uGlow;
uniform float uFill;
vec3 sDetail(sampler2D t, vec2 uv, float k) {
  vec3 s = texture2D(t, uv).rgb;
  vec3 a = max(textureLod(t, vec2(0.5), 12.0).rgb, vec3(0.02));
  return mix(vec3(1.0), clamp(s / a, vec3(0.3), vec3(2.2)), k);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float wWood = step(0.5, vMat) - step(1.5, vMat);
  float wBark = step(1.5, vMat) - step(2.5, vMat);
  float wStone = step(2.5, vMat) - step(3.5, vMat);
  float wCloth = step(3.5, vMat) - step(4.5, vMat);
  vec3 dt = vec3(1.0)
    + wWood * (sDetail(uTexWood, vDUv, uDetail.x) - 1.0)
    + wBark * (sDetail(uTexBark, vDUv, uDetail.y) - 1.0)
    + wStone * (sDetail(uTexStone, vDUv, uDetail.z) - 1.0)
    + wCloth * (sDetail(uTexCloth, vDUv, uDetail.w) - 1.0);
  diffuseColor.rgb *= dt;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * (uGlow * step(4.5, vMat) + uFill);`,
      );
    applyOcclusionFade(shader);
    applyAtmosphere(shader);
  };
  mat.customProgramCacheKey = () => `structB${sway ? '-sway' : ''}${o.doubleSided ? '-ds' : ''}`;
  return mat;
}

// ---- flames --------------------------------------------------------------------------------------------------------

export interface FlameCard {
  x: number;
  y: number;
  z: number;
  /** width / height of the flame card (m) */
  w: number;
  h: number;
  /** phase offset 0..1 */
  ph: number;
}

export interface FlameGlow {
  x: number;
  y: number;
  z: number;
  r: number;
  /** horizontal ground disc (true) or camera-facing halo (false) */
  ground?: boolean;
}

export type FlamePalette = 'fire' | 'plague';

const PALETTES: Record<FlamePalette, [Color, Color, Color]> = {
  fire: [new Color(1.0, 0.16, 0.02), new Color(1.0, 0.52, 0.07), new Color(1.0, 0.9, 0.52)],
  plague: [new Color(0.03, 0.42, 0.1), new Color(0.3, 1.0, 0.22), new Color(0.82, 1.0, 0.66)],
};

const FLAME_VERT = /* glsl */ `
attribute vec4 aFl;
varying vec2 vUv;
varying vec4 vFl;
uniform float uT;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vFl = aFl;
  vec4 p = vec4(position, 1.0);
  float sc = 1.0;
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  sc = length(instanceMatrix[0].xyz);
  #endif
  vec4 mvPosition = modelViewMatrix * p;
  if (aFl.w < 1.5) {
    if (aFl.w < 0.5) {
      vec3 up = mat3(viewMatrix) * vec3(0.0, 1.0, 0.0);
      vec3 right = normalize(vec3(up.y, -up.x, 0.0) + vec3(1e-4, 0.0, 0.0));
      float flick = 1.0 + 0.10 * sin(uT * 9.0 + aFl.z * 6.283) + 0.06 * sin(uT * 15.3 + aFl.z * 19.0);
      float lean = sin(uT * 2.6 + aFl.z * 6.283) * 0.10 * vUv.y;
      mvPosition.xyz += sc * (right * ((vUv.x - 0.5 + lean) * aFl.x) + up * (vUv.y * aFl.y * flick));
    } else {
      mvPosition.xyz += sc * vec3((vUv - 0.5) * aFl.x * 2.0, 0.0);
    }
  }
  gl_Position = projectionMatrix * mvPosition;
  #ifdef USE_FOG
  vFogDepth = -mvPosition.z;
  #endif
}`;

const FLAME_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vFl;
uniform float uT;
uniform float uGain;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
#include <fog_pars_fragment>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float a;
  vec3 col;
  float ph = vFl.z;
  if (vFl.w < 0.5) {
    vec2 q = vec2((vUv.x - 0.5) * 2.0, vUv.y);
    float n1 = vn(vec2(q.x * 2.2 + ph * 7.0, q.y * 2.6 - uT * 2.4));
    float n2 = vn(vec2(q.x * 4.6 - ph * 3.0, q.y * 5.2 - uT * 4.2));
    float x = q.x + ((n1 - 0.5) * 0.8 + (n2 - 0.5) * 0.3) * q.y;
    float w = pow(max(1.0 - q.y, 0.0), 0.62) * 0.8;
    float d = abs(x) / max(w, 0.02);
    float body = smoothstep(1.0, 0.2, d) * smoothstep(1.0, 0.5, q.y + (n2 - 0.5) * 0.5) * smoothstep(0.0, 0.07, q.y);
    float heat = clamp(body * (1.2 - q.y * 0.9) + (n1 - 0.5) * 0.25, 0.0, 1.0);
    col = heat < 0.5 ? mix(uC0, uC1, heat * 2.0) : mix(uC1, uC2, (heat - 0.5) * 2.0);
    a = body;
  } else {
    vec2 g = vUv * 2.0 - 1.0;
    float r = length(g);
    float pulse = 0.78 + 0.22 * sin(uT * 7.0 + ph * 6.283) * (0.6 + 0.4 * sin(uT * 2.3 + ph * 3.0));
    a = pow(max(1.0 - r, 0.0), vFl.w < 1.5 ? 2.2 : 1.6) * pulse * (vFl.w < 1.5 ? 0.42 : 0.7);
    col = uC0 * 0.9 + uC1 * 0.25;
  }
  gl_FragColor = vec4(col * uGain, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
  #ifdef FOG_EXP2
  float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
  float fogF = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.a *= 1.0 - fogF;
  #endif
}`;

export interface FlameParts {
  geometry: BufferGeometry;
  material: ShaderMaterial;
  /** call every frame with render seconds */
  update(time: number): void;
}

/** Builds the additive flame part: upright flame cards (camera-facing around Y) + ground / halo glows. */
export function flameParts(cards: readonly FlameCard[], glows: readonly FlameGlow[], palette: FlamePalette, gain = 1.25): FlameParts {
  const n = cards.length + glows.length;
  const pos = new Float32Array(n * 12);
  const uv = new Float32Array(n * 8);
  const fl = new Float32Array(n * 16);
  const idx = new Uint16Array(n * 6);
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ] as const;
  let q = 0;
  const emit = (x: number, y: number, z: number, w: number, h: number, ph: number, kind: number, ground: boolean): void => {
    for (let c = 0; c < 4; c++) {
      const [cu, cv] = corners[c] as readonly [number, number];
      const o = (q * 4 + c) * 3;
      // ground discs carry their real corner positions; billboards collapse onto the anchor point
      pos[o] = ground ? x + (cu - 0.5) * w * 2 : x;
      pos[o + 1] = y;
      pos[o + 2] = ground ? z + (cv - 0.5) * w * 2 : z;
      uv[(q * 4 + c) * 2] = cu;
      uv[(q * 4 + c) * 2 + 1] = cv;
      const f = (q * 4 + c) * 4;
      fl[f] = w;
      fl[f + 1] = h;
      fl[f + 2] = ph;
      fl[f + 3] = kind;
    }
    const b = q * 4;
    idx.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
    q++;
  };
  for (const c of cards) emit(c.x, c.y, c.z, c.w, c.h, c.ph, 0, false);
  for (const g of glows) emit(g.x, g.y, g.z, g.r, g.r, 0.3, g.ground ? 2 : 1, g.ground === true);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('aFl', new BufferAttribute(fl, 4));
  geometry.setIndex(new BufferAttribute(idx, 1));
  geometry.computeBoundingSphere();
  const [c0, c1, c2] = PALETTES[palette];
  const uT = { value: 0 };
  const uniforms = UniformsUtils.merge([UniformsLib.fog]);
  Object.assign(uniforms, { uT, uGain: { value: gain }, uC0: { value: c0.clone() }, uC1: { value: c1.clone() }, uC2: { value: c2.clone() } });
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
  });
  return {
    geometry,
    material,
    update(time: number) {
      uT.value = time;
    },
  };
}

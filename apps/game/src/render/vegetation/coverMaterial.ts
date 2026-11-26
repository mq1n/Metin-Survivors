// Ground-cover material: Lambert + onBeforeCompile where the vertex shader *generates* every tuft from gl_InstanceID:
// a camera-centred toroidal cell grid (stable hash per absolute cell, so tufts never swim or pop while the focus
// moves), position/rotation/size jitter, survival against the baked density mask, ground height from the baked
// height texture, wind sway, hero push-aside, a height cap near the hero and a dithered distance fade. An optional
// second ring of coarser, bigger tufts (cover specs with `far`) shares the same draw call.
//
// Cover v2 (zones core C4): a spec that sets any v2 knob (CoverSpec clump / jitter / variants / lean / heightVar / cards /
// splay / face, or the zone's look.cover.cards / splay) compiles BODY_V2 (program key 'vegCover2'): stratified jitter, a
// value-noise clump gate with empty lanes, a splayed fan of cards (camera-facing and / or radial, per-card angle / splay /
// size / twist / mirror jitter, 3 cards in the far ring), per-tuft lean and height variation, atlas cells per tuft, and an
// early out for culled tufts. Every other spec compiles the untouched legacy BODY (program key 'vegCover'), so zones that
// set nothing render bit-identically.
import { Color, DoubleSide, MeshLambertMaterial, Vector3, type DataTexture, type Texture } from 'three';
import { worldUniforms } from '../terrain/zoneContext';
import { applyAtmosphere } from '../terrain/atmosphere';

export interface CoverRing {
  /** cell edge (m) */
  cell: number;
  /** cells per axis */
  grid: number;
  /** candidate tufts per cell */
  perCell: number;
  /** survival multiplier applied to the density mask */
  keep: number;
}

export interface CoverMaterialParams {
  map: Texture;
  height: DataTexture;
  mask: DataTexture;
  heightBase: number;
  /** domain side (m) and height texture side (texels) */
  domain: number;
  heightN: number;
  size: [number, number];
  aspect: number;
  tint: Color;
  tintVar: number;
  sway: number;
  seed: number;
  focus: Vector3;
  /** cover v2 shape / placement (absent = the legacy shader) */
  v2?: CoverV2;
}

/** Resolved cover v2 knobs of one spec (see CoverSpec in world/layoutTypes.ts for their meaning). */
export interface CoverV2 {
  /** splayed fan of cards (true) or the legacy crossed quads (placement / lean / atlas knobs still apply) */
  fan: boolean;
  /** fan: mean outward splay of the cards from vertical (radians) */
  splay: number;
  /** fan: 0..1 share of the cards that face the fixed-yaw camera instead of leaning out on their own azimuth */
  face: number;
  /** maximum whole-tuft lean (fraction of the tuft height) */
  lean: number;
  /** ± per-tuft height variation */
  heightVar: number;
  /** stratified jitter 0..1, or -1 = legacy independent points per cell */
  jitter: number;
  /** clump gate (null = none) */
  clump: { scale: number; lo: number; hi: number; seed: number } | null;
  /** atlas cells [cols, rows] */
  atlas: [number, number];
}

export interface CoverUniforms {
  uNear: { value: [number, number, number, number] };
  uFar: { value: [number, number, number, number] };
  uNearCount: { value: number };
  /** near fade start/end, far fade-in start/end */
  uFade: { value: [number, number, number, number] };
  uFarOut: { value: [number, number] };
  uFarScale: { value: number };
  /** v2: sub-cells per axis of the near / far ring (stratified jitter) */
  uSub: { value: [number, number] };
  /** v2: cards in the fan geometry */
  uCards: { value: number };
}

const PARS = /* glsl */ `
uniform sampler2D uHeightTex;
uniform sampler2D uMaskTex;
uniform vec4 uNear;
uniform vec4 uFar;
uniform int uNearCount;
uniform vec4 uFade;
uniform vec2 uFarOut;
uniform float uFarScale;
uniform vec3 uFocusW;
uniform vec2 uSizeR;
uniform float uAspect;
uniform vec3 uTint;
uniform float uTintVar;
uniform float uSwayAmt;
uniform float uHeightBase;
uniform float uDomain;
uniform float uHeightN;
uniform float uSeed;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
// r8 Z8: discs (x, z, r) with no cover (a living metin's rune carpet; r 0 = unused): worldUniforms.uCoverClear
uniform vec4 uCoverClear[8];
varying float vFade;
varying vec3 vTint;

float coverClearAt(vec2 p) {
  float k = 1.0;
  for (int i = 0; i < 8; i++) {
    vec4 c = uCoverClear[i];
    vec2 d = p - c.xy;
    if (c.z > 0.0 && dot(d, d) < c.z * c.z) k = 0.0;
  }
  return k;
}

uint hu(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}
float h01(uint x) { return float(hu(x) >> 8u) * (1.0 / 16777216.0); }
`;

const BODY = /* glsl */ `
vec3 transformed = vec3(0.0);
{
  bool far = gl_InstanceID >= uNearCount;
  vec4 P = far ? uFar : uNear;
  int id = far ? gl_InstanceID - uNearCount : gl_InstanceID;
  float cell = P.x;
  int G = int(P.y);
  int perCell = int(P.z);
  int cellIdx = id / perCell;
  int k = id - cellIdx * perCell;
  int sx = cellIdx % G;
  int sz = cellIdx / G;
  ivec2 cc = ivec2(floor(uFocusW.xz / cell));
  int a0x = cc.x - G / 2;
  int a0z = cc.y - G / 2;
  int ax = a0x + int(mod(float(sx - a0x), float(G)));
  int az = a0z + int(mod(float(sz - a0z), float(G)));
  uint s = hu(uint(ax) * 0x27d4eb2fu ^ uint(az) * 0x165667b1u ^ uint(k) * 0x9e3779b1u ^ uint(uSeed) ^ (far ? 0xabcdef01u : 0u));
  vec2 xz = (vec2(float(ax), float(az)) + vec2(h01(s), h01(s + 1u))) * cell;
  float m = texture2D(uMaskTex, (xz + 0.5 * uDomain) / uDomain).r;
  vec2 toHero = xz - uFocusW.xz;
  float hd = length(toHero);
  float fade = far ? smoothstep(uFade.z, uFade.w, hd) * (1.0 - smoothstep(uFarOut.x, uFarOut.y, hd)) : 1.0 - smoothstep(uFade.x, uFade.y, hd);
  float alive = step(h01(s + 2u), m * P.w) * step(0.002, fade) * coverClearAt(xz);
  vFade = fade;
  float wsz = mix(uSizeR.x, uSizeR.y, h01(s + 3u)) * (far ? uFarScale : 1.0);
  float hgt = wsz * uAspect * mix(0.45, 1.0, smoothstep(1.3, 4.0, hd));
  float ang = h01(s + 4u) * 6.2831853;
  vec2 lat = vec2(position.x, position.z) * wsz;
  lat = vec2(cos(ang) * lat.x - sin(ang) * lat.y, sin(ang) * lat.x + cos(ang) * lat.y);
  float hv = position.y;
  float hh = hv * hv;
  float la = h01(s + 5u) * 6.2831853;
  vec2 lean = vec2(cos(la), sin(la)) * (0.12 * hgt * hh);
  float ph = dot(xz, uWindDir) * 0.55 - uTime * 2.0 + h01(s + 6u) * 6.28;
  vec2 sway = uWindDir * ((0.5 + 0.5 * sin(ph) + 0.3 * sin(ph * 2.7)) * uWindStrength * uSwayAmt * 0.22 * hgt * hh);
  vec2 push = (hd > 1e-3 ? toHero / hd : vec2(0.0)) * ((1.0 - smoothstep(0.5, 1.4, hd)) * 0.35 * hgt * hh);
  float gy = texture2D(uHeightTex, (xz + 0.5 * uDomain + 0.5) / uHeightN).r + uHeightBase;
  transformed = vec3(xz.x + lat.x + lean.x + sway.x + push.x, gy + hv * hgt - 0.05, xz.y + lat.y + lean.y + sway.y + push.y);
  transformed = mix(vec3(0.0, -1.0e5, 0.0), transformed, alive);
  vec3 jitter = vec3(h01(s + 8u), h01(s + 9u), h01(s + 10u)) - 0.5;
  float clump = 0.9 + 0.2 * sin(xz.x * 0.13 + 1.7) * sin(xz.y * 0.11);
  vTint = uTint * (1.0 + jitter * uTintVar * vec3(0.7, 0.45, 1.0)) * (0.7 + 0.26 * h01(s + 7u)) * clump * mix(0.5, 1.0, smoothstep(0.0, 0.6, hv));
}
`;

const PARS_V2 = /* glsl */ `
uniform vec2 uSub;
uniform float uJitter;
uniform vec4 uClump;
uniform float uClumpSeed;
uniform vec4 uShape;
uniform float uCards;
uniform vec2 uAtlas;
uniform float uFace;

// value noise on a hashed lattice (non-periodic, quintic fade); 'seed' decorrelates the patterns
float coverVN(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  uint x0 = uint(int(i.x)) * 0x27d4eb2fu;
  uint x1 = x0 + 0x27d4eb2fu;
  uint z0 = uint(int(i.y)) * 0x165667b1u;
  uint z1 = z0 + 0x165667b1u;
  float a = h01(hu(x0 ^ z0 ^ seed));
  float b = h01(hu(x1 ^ z0 ^ seed));
  float c = h01(hu(x0 ^ z1 ^ seed));
  float d = h01(hu(x1 ^ z1 ^ seed));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

// clump gate 0..1: smoothstep(lo, hi, n) of two rotated octaves (features ~uClump.x m); lo > hi inverts it
float coverClump(vec2 xz) {
  uint sd = hu(uint(uClumpSeed) * 0x9e3779b1u + 0x7f4a7c15u);
  vec2 p = xz / uClump.x;
  float n = 0.65 * coverVN(p, sd) + 0.35 * coverVN(mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + 17.17, sd ^ 0x5bd1e995u);
  float t = clamp((n - uClump.y) / (uClump.z - uClump.y), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
`;

// uShape: x fan (0/1), y splay (rad), z lean, w heightVar. Fan geometry: position = (card x -0.5..0.5, height 0..1, card index).
const BODY_V2 = /* glsl */ `
vec3 transformed = vec3(0.0);
{
  bool far = gl_InstanceID >= uNearCount;
  vec4 P = far ? uFar : uNear;
  int id = far ? gl_InstanceID - uNearCount : gl_InstanceID;
  float cell = P.x;
  int G = int(P.y);
  int perCell = int(P.z);
  int cellIdx = id / perCell;
  int k = id - cellIdx * perCell;
  int sx = cellIdx % G;
  int sz = cellIdx / G;
  ivec2 cc = ivec2(floor(uFocusW.xz / cell));
  int a0x = cc.x - G / 2;
  int a0z = cc.y - G / 2;
  int ax = a0x + int(mod(float(sx - a0x), float(G)));
  int az = a0z + int(mod(float(sz - a0z), float(G)));
  uint s = hu(uint(ax) * 0x27d4eb2fu ^ uint(az) * 0x165667b1u ^ uint(k) * 0x9e3779b1u ^ uint(uSeed) ^ (far ? 0xabcdef01u : 0u));
  vec2 xz;
  if (uJitter >= 0.0) {
    // stratified: candidate k owns one sub-cell of the cell and is jittered inside it (no overlapping pairs)
    int si = max(1, int((far ? uSub.y : uSub.x) + 0.5));
    vec2 kk = vec2(float(k % si), float(k / si));
    xz = (vec2(float(ax), float(az)) + (kk + 0.5 + (vec2(h01(s), h01(s + 1u)) - 0.5) * uJitter) / float(si)) * cell;
  } else {
    xz = (vec2(float(ax), float(az)) + vec2(h01(s), h01(s + 1u))) * cell;
  }
  float m = texture2D(uMaskTex, (xz + 0.5 * uDomain) / uDomain).r;
  if (uClump.w > 0.5) m *= coverClump(xz);
  vec2 toHero = xz - uFocusW.xz;
  float hd = length(toHero);
  float fade = far ? smoothstep(uFade.z, uFade.w, hd) * (1.0 - smoothstep(uFarOut.x, uFarOut.y, hd)) : 1.0 - smoothstep(uFade.x, uFade.y, hd);
  float alive = step(h01(s + 2u), m * P.w) * step(0.002, fade) * coverClearAt(xz);
  // far-ring fans keep 3 cards: the extra cards of a distant tuft collapse before rasterisation (perf, no visible loss)
  if (far && uShape.x > 0.5 && position.z > 2.5) alive = 0.0;
  vFade = fade;
  vTint = vec3(0.0);
  transformed = vec3(0.0, -1.0e5, 0.0);
  if (alive > 0.5) {
    float wsz = mix(uSizeR.x, uSizeR.y, h01(s + 3u)) * (far ? uFarScale : 1.0);
    float hgt = wsz * uAspect * mix(0.45, 1.0, smoothstep(1.3, 4.0, hd)) * (1.0 + uShape.w * (2.0 * h01(s + 11u) - 1.0));
    float ang = h01(s + 4u) * 6.2831853;
    float hv = position.y;
    float hh = hv * hv;
    vec2 lat;
    float up;
    vec2 uvc = uv;
    if (uShape.x > 0.5) {
      // splayed fan, card c of N. A FACING card (probability uFace) turns its painted face to the fixed-yaw camera: it
      // leans away from the camera within +-34 degrees, so the tuft shows the texture's own profile (what a tuft card is
      // painted for) and never its top-down projection; facing cards spread sideways and front-to-back for volume. A
      // RADIAL card leans outward on its own azimuth round the full circle (not the legacy 180 degree alternating cross)
      // with its foot line 6-18 % of the width behind the centre, so the lower stems cover the heart of the tuft (no
      // bare, unshadowed ground polygon framed by dark card feet: the legacy "cream triangle"). Splay, size, twist, foot
      // sink and mirror vary per card and tuft.
      float c = position.z;
      uint sc = hu(s ^ (uint(c) + 1u) * 0x632be5abu);
      bool facing = h01(sc + 10u) < uFace;
      vec2 cam = cameraPosition.xz - uFocusW.xz;
      float a = facing ? atan(-cam.y, -cam.x) + (h01(sc) - 0.5) * 1.2 : ang + 6.2831853 * (c + 0.5 + 0.85 * (h01(sc) - 0.5)) / uCards;
      vec2 d = vec2(cos(a), sin(a));
      float th = uShape.y * mix(0.5, 1.5, h01(sc + 1u));
      float hc = hgt * mix(0.72, 1.18, h01(sc + 2u));
      float wc = wsz * mix(0.85, 1.15, h01(sc + 3u));
      // break the N-fold symmetry (a dome-shaped card texture would otherwise draw an N-armed star from above): every
      // card is twisted about its foot (up to +-20 degrees off the tangent) and its foot slides along the card
      float tw = (h01(sc + 7u) - 0.5) * 0.7;
      vec2 t = vec2(-d.y * cos(tw) - d.x * sin(tw), d.x * cos(tw) - d.y * sin(tw));
      float slide = (h01(sc + 8u) - 0.5) * (facing ? 0.6 : 0.3) * wsz;
      float back = facing ? wsz * (0.3 * h01(sc + 5u) - 0.2) : -wsz * (0.06 + 0.12 * h01(sc + 5u));
      lat = t * (position.x * wc + slide) + d * (sin(th) * hv * hc + back);
      // the foot sinks 4-12 % of the card into the ground: hides the straight cut at the bottom of a tuft texture
      up = (cos(th) * hv - 0.04 - 0.08 * h01(sc + 6u)) * hc;
      if (h01(sc + 4u) < 0.5) uvc.x = 1.0 - uvc.x;
    } else {
      lat = vec2(position.x, position.z) * wsz;
      lat = vec2(cos(ang) * lat.x - sin(ang) * lat.y, sin(ang) * lat.x + cos(ang) * lat.y);
      up = hv * hgt;
      if (h01(s + 13u) < 0.5) uvc.x = 1.0 - uvc.x;
    }
    #ifdef USE_MAP
    // atlas cell per tuft; inside an atlas the card keeps 1.5 % off the cell border so low mips do not bleed the
    // neighbouring cell into the card edges
    if (uAtlas.x * uAtlas.y > 1.5) uvc = mix(vec2(0.015), vec2(0.985), uvc);
    vMapUv = (mapTransform * vec3((uvc + floor(vec2(h01(s + 14u), h01(s + 15u)) * uAtlas)) / uAtlas, 1.0)).xy;
    #endif
    float la = h01(s + 5u) * 6.2831853;
    vec2 lean = vec2(cos(la), sin(la)) * (uShape.z * mix(0.35, 1.0, h01(s + 12u)) * hgt * (0.5 * hv + 0.5 * hh));
    float ph = dot(xz, uWindDir) * 0.55 - uTime * 2.0 + h01(s + 6u) * 6.28;
    vec2 sway = uWindDir * ((0.5 + 0.5 * sin(ph) + 0.3 * sin(ph * 2.7)) * uWindStrength * uSwayAmt * 0.22 * hgt * hh);
    vec2 push = (hd > 1e-3 ? toHero / hd : vec2(0.0)) * ((1.0 - smoothstep(0.5, 1.4, hd)) * 0.35 * hgt * hh);
    float gy = texture2D(uHeightTex, (xz + 0.5 * uDomain + 0.5) / uHeightN).r + uHeightBase;
    transformed = vec3(xz.x + lat.x + lean.x + sway.x + push.x, gy + up - 0.05, xz.y + lat.y + lean.y + sway.y + push.y);
    vec3 jitter = vec3(h01(s + 8u), h01(s + 9u), h01(s + 10u)) - 0.5;
    float clump = 0.9 + 0.2 * sin(xz.x * 0.13 + 1.7) * sin(xz.y * 0.11);
    vTint = uTint * (1.0 + jitter * uTintVar * vec3(0.7, 0.45, 1.0)) * (0.7 + 0.26 * h01(s + 7u)) * clump * mix(0.5, 1.0, smoothstep(0.0, 0.6, hv));
  }
}
`;

export function createCoverMaterial(p: CoverMaterialParams): { material: MeshLambertMaterial; uniforms: CoverUniforms } {
  const mat = new MeshLambertMaterial({ map: p.map, side: DoubleSide, alphaTest: 0.45, alphaToCoverage: true });
  mat.name = 'cover';
  const uniforms: CoverUniforms = {
    uNear: { value: [1, 1, 1, 0] },
    uFar: { value: [1, 1, 1, 0] },
    uNearCount: { value: 0 },
    uFade: { value: [20, 28, 0, 0] },
    uFarOut: { value: [50, 60] },
    uFarScale: { value: 1.8 },
    uSub: { value: [1, 1] },
    uCards: { value: 1 },
  };
  const v2 = p.v2;
  mat.onBeforeCompile = (shader) => {
    const u = shader.uniforms;
    Object.assign(u, uniforms);
    if (v2) {
      const c = v2.clump;
      u.uJitter = { value: v2.jitter };
      u.uClump = { value: c ? [c.scale, c.lo, c.hi, 1] : [1, 0, 1, 0] };
      u.uClumpSeed = { value: c ? c.seed : 0 };
      u.uShape = { value: [v2.fan ? 1 : 0, v2.splay, v2.lean, v2.heightVar] };
      u.uAtlas = { value: v2.atlas };
      u.uFace = { value: v2.face };
    }
    u.uHeightTex = { value: p.height };
    u.uMaskTex = { value: p.mask };
    u.uFocusW = { value: p.focus };
    u.uSizeR = { value: p.size };
    u.uAspect = { value: p.aspect };
    u.uTint = { value: p.tint };
    u.uTintVar = { value: p.tintVar };
    u.uSwayAmt = { value: p.sway };
    u.uHeightBase = { value: p.heightBase };
    u.uDomain = { value: p.domain };
    u.uHeightN = { value: p.heightN };
    u.uSeed = { value: p.seed };
    u.uTime = worldUniforms.uTime;
    u.uWindDir = worldUniforms.uWindDir;
    u.uWindStrength = worldUniforms.uWindStrength;
    u.uCoverClear = worldUniforms.uCoverClear;
    let v = shader.vertexShader;
    v = replaceOnce(v, '#include <common>', v2 ? `#include <common>\n${PARS}${PARS_V2}` : `#include <common>\n${PARS}`);
    v = replaceOnce(v, '#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
    v = replaceOnce(v, '#include <begin_vertex>', v2 ? BODY_V2 : BODY);
    shader.vertexShader = v;
    let f = shader.fragmentShader;
    f = replaceOnce(f, '#include <common>', '#include <common>\nvarying float vFade;\nvarying vec3 vTint;');
    f = replaceOnce(
      f,
      '#include <map_fragment>',
      `{
        float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (ign > vFade) discard;
      }
      #include <map_fragment>`,
    );
    f = replaceOnce(f, '#include <color_fragment>', 'diffuseColor.rgb *= vTint;');
    f = replaceOnce(f, '#include <normal_fragment_begin>', 'vec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;');
    shader.fragmentShader = f;
    applyAtmosphere(shader);
  };
  mat.customProgramCacheKey = () => (v2 ? 'vegCover2' : 'vegCover');
  return { material: mat, uniforms };
}

function replaceOnce(src: string, token: string, repl: string): string {
  if (!src.includes(token)) throw new Error(`cover shader patch: token ${token} not found`);
  return src.replace(token, repl);
}

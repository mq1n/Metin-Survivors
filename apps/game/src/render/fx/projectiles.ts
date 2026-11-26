// Projectile renderer: one instanced draw per shape kind (orb | arrow | blade | talisman | bolt) → at most 5 draw calls.
// Every look is built in the fragment shader (SDF silhouettes, layered additive glow, hot cores, animated flicker) so no
// sprite assets are needed; the talisman charm uses a small painted canvas texture (calligraphic glyphs, paper fibre).
//
// Orientation, decided for the fixed 55° camera:
//   orb / arrow / bolt  → cylindrical billboard around the velocity axis (always faces the camera, streak runs along the
//                         projected flight direction; degenerates gracefully to a ground-lying streak for ±Z flight)
//   blade               → almost ground-aligned crescent (reads as a sweeping slash from above)
//   talisman            → spherical billboard with in-plane spin and tumbling squash
// Blending is premultiplied: glow layers use alpha 0 (additive, HDR values >1 feed the bloom), opaque parts (arrow shaft,
// paper, hostile dark rim) use alpha > 0, so friendly fire glows while hostile fire carries a dark/red rim readable on any
// terrain colour.
import {
  AddEquation,
  CanvasTexture,
  Color,
  CustomBlending,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  BufferAttribute,
  ClampToEdgeWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { RenderCore, RenderSystem } from '../core';
import type { ProjectileFeed, ProjectileStyleDef } from '../feed';
import type { QualityProfile } from '../quality';
import { LOOK, ProjEventKind, pushProjEvent } from './projectileEvents';
import {
  GLSL_HOSTILE_ARROW,
  GLSL_HOSTILE_BLADE,
  GLSL_HOSTILE_COMMON,
  GLSL_HOSTILE_GROUND,
  GLSL_HOSTILE_ORB,
  buildProjectileAtlas,
  lookOfStyle,
  makeAtlasStandIn,
} from './projectileLooks';
import { LAUNCH_MAX_AGE, ProjectileTracker } from './projectileTrack';

/** Sim tick rate: feed positions are one tick apart, so |cur - prev| * TICK_RATE = speed in m/s. */
export const SIM_TICK_RATE = 60;
/** Feed cap (ARCHITECTURE §6). Excess rows are dropped farthest-first. */
export const PROJECTILE_CAP = 1500;

export type ProjectileShape = ProjectileStyleDef['shape'];
export const PROJECTILE_SHAPES: readonly ProjectileShape[] = ['orb', 'arrow', 'blade', 'talisman', 'bolt'];

/** Per-shape defaults for `ProjectileStyleDef.length` (× radius) and `.trail` (seconds of travel). */
export const SHAPE_DEFAULTS: Record<ProjectileShape, { length: number; trail: number }> = {
  orb: { length: 1, trail: 0.14 },
  arrow: { length: 6, trail: 0.06 },
  blade: { length: 1.05, trail: 0.12 },
  talisman: { length: 1, trail: 0.08 },
  bolt: { length: 7.5, trail: 0 },
};

/** Longest streak in metres, whatever the speed. */
export const MAX_TRAIL_M = 3.2;

/** hostile bodies are drawn larger than their hit radius (readable at the 55 degree camera, 30+ enemies on screen) */
export const HOSTILE_ORB_SCALE = 2.1;
/** hostile arrow visual length x (the style length is 3 radii: 0.75 m for an archer's 0.25 m radius was a sticker) */
export const HOSTILE_ARROW_LEN = 1.6;
/** hostile crescent size x (the old 3.5-4 m white doily becomes an ~1.2 m translucent bolt) */
export const HOSTILE_BLADE_LEN = 0.68;

/** a hostile body within ~2 m of the hero shrinks to this fraction at the hit point (consumed by the blow) */
const HOSTILE_NEAR_MIN = 0.24;
function smooth01(x: number): number {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}
/** minimum trail (seconds of travel) of a hostile body per shape index: orb, arrow, blade, talisman, bolt (the smoke + embers it leaves behind) */
const HOSTILE_TRAIL_S: readonly number[] = [0.5, 0.3, 0.36, 0, 0];

const NEUTRAL_STYLE: ProjectileStyleDef ={ shape: 'orb', color: '#ffc77a', core: '#fff3d6' };

// ------------------------------------------------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ------------------------------------------------------------------------------------------------------------------

export interface CompiledStyles {
  /** number of table entries (the neutral fallback lives at index `count`) */
  count: number;
  /** 1 where the sim supplied a style, 0 where the entry is missing (drawn as the neutral orb) */
  valid: Uint8Array;
  shape: Uint8Array;
  /** linear rgb triples */
  color: Float32Array;
  core: Float32Array;
  length: Float32Array;
  trail: Float32Array;
  /** 1 = drawn by the VFX layer (`sk.*` spec presets): skipped here */
  hidden: Uint8Array;
  /** hostile element look (render/fx/projectileEvents LOOK): nearest simFeed element colour of the style, or the style's own
   *  `look` key when the feed carries one (schema C9 `projectile.look`, see projectileLooks.LOOK_OF_C9) */
  look: Uint8Array;
}

const tmpColor = new Color();

function writeLinear(dst: Float32Array, o: number, hex: string): void {
  tmpColor.set(hex);
  dst[o] = tmpColor.r;
  dst[o + 1] = tmpColor.g;
  dst[o + 2] = tmpColor.b;
}

/** Default secondary colour: the primary pushed towards white-hot (linear space mix). */
function hotCore(src: Float32Array, o: number, dst: Float32Array, k = 0.62): void {
  for (let c = 0; c < 3; c++) dst[o + c] = (src[o + c] as number) + (1 - (src[o + c] as number)) * k;
}

/** Flattens the style table into typed arrays; `styles[i]` may be undefined (→ neutral orb). */
export function compileProjectileStyles(styles: ReadonlyArray<ProjectileStyleDef | undefined>): CompiledStyles {
  const n = styles.length;
  const out: CompiledStyles = {
    count: n,
    valid: new Uint8Array(n + 1),
    shape: new Uint8Array(n + 1),
    color: new Float32Array((n + 1) * 3),
    core: new Float32Array((n + 1) * 3),
    length: new Float32Array(n + 1),
    trail: new Float32Array(n + 1),
    hidden: new Uint8Array(n + 1),
    look: new Uint8Array(n + 1),
  };
  for (let i = 0; i <= n; i++) {
    const def = i < n ? styles[i] : undefined;
    const s = def ?? NEUTRAL_STYLE;
    const shapeIdx = Math.max(0, PROJECTILE_SHAPES.indexOf(s.shape));
    const d = SHAPE_DEFAULTS[PROJECTILE_SHAPES[shapeIdx] as ProjectileShape];
    out.valid[i] = def ? 1 : 0;
    out.shape[i] = shapeIdx;
    writeLinear(out.color, i * 3, s.color);
    if (s.core) writeLinear(out.core, i * 3, s.core);
    else hotCore(out.color, i * 3, out.core);
    out.length[i] = s.length !== undefined && s.length > 0 ? s.length : d.length;
    out.trail[i] = s.trail !== undefined && s.trail >= 0 ? s.trail : d.trail;
    out.hidden[i] = def?.hidden === true ? 1 : 0;
    out.look[i] = def ? lookOfStyle(s) : LOOK.physical;
  }
  return out;
}

export interface Kinematics {
  x: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
}

/**
 * Interpolated position, unit flight direction and speed (m/s) of one projectile. When it barely moved the direction
 * falls back to its yaw (`rot`, 0 faces +Z) and speed is 0.
 */
export function projectileKinematics(
  x: number,
  z: number,
  px: number,
  pz: number,
  rot: number,
  alpha: number,
  out: Kinematics,
): Kinematics {
  const mx = x - px;
  const mz = z - pz;
  const dist = Math.sqrt(mx * mx + mz * mz);
  out.x = px + mx * alpha;
  out.z = pz + mz * alpha;
  if (dist > 1e-4) {
    out.dx = mx / dist;
    out.dz = mz / dist;
    out.speed = dist * SIM_TICK_RATE;
  } else {
    out.dx = Math.sin(rot);
    out.dz = Math.cos(rot);
    out.speed = 0;
  }
  return out;
}

/** Trail length in metres from seconds-of-travel and speed. */
export function trailMetres(trailSeconds: number, speed: number): number {
  return Math.min(MAX_TRAIL_M, Math.max(0, trailSeconds * speed));
}

/**
 * Returns the `cap`-th smallest value of `d2[0..n)` (quickselect on a scratch copy). Rows with `d2 <= cutoff` are kept.
 * Ties may let a few rows more than `cap` through; callers clamp on write. `cap >= n` returns +Infinity.
 */
export function nearestCutoff(d2: ArrayLike<number>, n: number, cap: number, work: Float32Array): number {
  if (cap >= n) return Infinity;
  if (cap <= 0) return -Infinity;
  for (let i = 0; i < n; i++) work[i] = d2[i] as number;
  let lo = 0;
  let hi = n - 1;
  const k = cap - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const a = work[lo] as number;
    const b = work[mid] as number;
    const c = work[hi] as number;
    const pivot = a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while ((work[i] as number) < pivot) i++;
      while ((work[j] as number) > pivot) j--;
      if (i <= j) {
        const t = work[i] as number;
        work[i] = work[j] as number;
        work[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return work[k] as number;
}

// ------------------------------------------------------------------------------------------------------------------
// Shaders
// ------------------------------------------------------------------------------------------------------------------

const VERT = /* glsl */ `
attribute vec4 iPosR;    // xyz world position (interpolated, includes height), w visual radius
attribute vec4 iDirT;    // xz unit direction, z trail length (m), w seed
attribute vec4 iColA;    // rgb main colour (linear), a hostile flag
attribute vec4 iColB;    // rgb core colour (linear), a age (s)
attribute vec4 iExtra;   // x length (r units), y speed (m/s), z hostile look code

uniform float uTilt;
uniform float uPush;

varying vec2 vP;
varying vec4 vColA;
varying vec4 vColB;
varying vec4 vInfo;
varying vec2 vDirScr;
varying vec3 vExt;
varying float vLook;

void main() {
  float r = iPosR.w;
  vLook = iExtra.z;
#if SHAPE == 5
  // ground glow decal: flat quad on the terrain under a hostile projectile (xyz = ground point, w = decal scale)
  vec3 gc = iPosR.xyz;
  vec2 gl = (position.xy * 2.0 - 1.0) * 2.4;
  vec3 gw = gc + vec3(gl.x, 0.0, gl.y) * r;
  // follow the local terrain plane (iDirT.xy = height gradient dh/dx, dh/dz): a flat quad dips under a slope
  gw.y += clamp(gl.x * r * iDirT.x + gl.y * r * iDirT.y, -0.9, 0.9);
  gw += normalize(cameraPosition - gc) * (r * 0.3);
  gl_Position = projectionMatrix * viewMatrix * vec4(gw, 1.0);
  vP = gl;
  vExt = vec3(2.4, 2.4, 2.4);
  vColA = iColA;
  vColB = iColB;
  vInfo = vec4(1.0, 0.0, iDirT.w, iExtra.y);
  vDirScr = vec2(1.0, 0.0);
  return;
#endif
  float len = iExtra.x;
  float trailR = min(iDirT.z / r, 14.0);
  float front;
  float back;
  float hw;
#if SHAPE == 0
  front = 1.9; back = 1.9 + trailR; hw = 1.9;
#elif SHAPE == 1
  front = len * 0.5 + 0.9; back = len * 0.5 + 0.9 + trailR; hw = 1.35;
#elif SHAPE == 2
  front = 0.85 * len; back = 1.2 * len + trailR; hw = 1.55 * len;
#elif SHAPE == 3
  trailR = min(trailR, 3.5);
  front = 2.4 + trailR; back = 2.4 + trailR; hw = 2.4 + trailR;
#else
  front = len * 0.5 + 0.9; back = len * 0.5 + 0.9; hw = 1.35;
#endif

  vec2 loc = vec2(mix(-back, front, position.x), mix(-hw, hw, position.y));
  float age = iColB.w;
  // hostile bodies condense over ~0.25 s (a boss volley spawns 12-20 bodies on one spot: they must not read as one solid mass); friendly: 0.06 s
  float k = clamp(age * mix(16.0, 4.2, iColA.a), 0.0, 1.0);
  float pop = 0.35 + 0.65 * (k * (2.0 - k));

  vec3 c = iPosR.xyz;
  vec3 toCam = normalize(cameraPosition - c);
  vec3 f;
  vec3 s;
#if SHAPE == 3
  f = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  s = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 dw = vec3(iDirT.x, 0.0, iDirT.y);
  vDirScr = vec2(dot(dw, f), dot(dw, s));
  float dl = length(vDirScr);
  vDirScr = dl > 1e-3 ? vDirScr / dl : vec2(1.0, 0.0);
#else
  f = normalize(vec3(iDirT.x, 0.0, iDirT.y));
  vec3 n = normalize(mix(vec3(0.0, 1.0, 0.0), toCam, uTilt));
  vec3 nn = n - f * dot(n, f);
  n = nn * inversesqrt(max(dot(nn, nn), 1e-6));
  s = cross(n, f);
  vDirScr = vec2(1.0, 0.0);
#endif
  vec3 w = c + (f * loc.x + s * loc.y) * (r * pop) + toCam * (r * uPush);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  vP = loc;
  vExt = vec3(front, back, hw);
  vColA = iColA;
  vColB = iColB;
  vInfo = vec4(len, trailR, iDirT.w, iExtra.y);
}
`;

const FRAG_COMMON = /* glsl */ `
uniform float uTime;
uniform float uDirect;
uniform sampler2D tPaper;
uniform sampler2D tGlyph;

varying vec2 vP;
varying vec4 vColA;
varying vec4 vColB;
varying vec4 vInfo;
varying vec2 vDirScr;
varying vec3 vExt;
varying float vLook;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float motes(vec2 p, float t, float scale) {
  vec2 g = p * scale + vec2(t * 0.8, -t * 0.55);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(id);
  vec2 off = (vec2(hash21(id + 7.1), hash21(id + 3.3)) - 0.5) * 0.55;
  float d = length(f - off);
  float tw = 0.5 + 0.5 * sin(t * 7.0 + h * 40.0);
  return step(0.72, h) * exp(-d * d * 110.0) * tw;
}
// pow(x, 2.0) is undefined for x < 0 in GLSL (NaN on some drivers → black pixels); use sq() for squares
float sq(float x) {
  return x * x;
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// isosceles triangle, apex at the origin, base at y = q.y, half base q.x
float sdTri(vec2 p, vec2 q) {
  p.x = abs(p.x);
  vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
  vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
  float s = -sign(q.y);
  vec2 d = min(vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)), vec2(dot(b, b), s * (p.y - q.y)));
  return -sqrt(d.x) * sign(d.y);
}
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
// premultiplied "over"
vec4 over(vec4 top, vec4 bot) {
  return vec4(top.rgb + bot.rgb * (1.0 - top.a), top.a + bot.a * (1.0 - top.a));
}
// hostile language shared with the telegraphs: crimson body + rim, yellow-white hot core, dark shell (never the fire
// zone's orange, never the hero's cyan-white)
vec3 hostileRed() { return vec3(1.0, 0.05, 0.2); }
vec3 hostileCore() { return vec3(1.0, 0.9, 0.6); }
`;

const FRAG_ORB = /* glsl */ `
vec4 shade(vec2 p) {
  float host = vColA.a;
  float t = uTime + vInfo.z * 31.0;
  float fade = clamp(vColB.w * 16.0, 0.0, 1.0);
  // hostile: the element-true turbulent ball (render/fx/projectileLooks.ts), never a recoloured friendly orb
  // the hostile flag also carries how far the body is from the hero (0.55 at the hit point .. 1.0 at >= 2.6 m): a body arriving fades to ~0.45 as it is consumed
  if (host > 0.5) return hostileOrb(p, vLook, t, vInfo.z, vInfo.y, fade * mix(0.45, 1.0, clamp((host - 0.55) / 0.45, 0.0, 1.0)), vInfo.w);
  vec3 colA = vColA.rgb;
  vec3 colC = vColB.rgb;
  float tr = vInfo.y;

  float pulse = 1.0 + 0.05 * sin(t * 23.0) + 0.035 * sin(t * 41.0 + 1.3);
  vec2 hp = p / pulse;
  float d = length(hp);
  float core = exp(-d * d * 9.0);
  float mid = exp(-d * d * 3.0);
  float halo = exp(-d * 1.4) * 0.34;
  float body = 1.0 - smoothstep(0.78, 1.02, d);
  vec3 rgb = colA * (mid * 1.5 + halo * 1.0) + colC * core * mix(2.8, 1.45, host);
  rgb += colA * smoothstep(0.5, 0.96, d) * body * 0.95;     // brighter limb
#ifndef LOW
  float ang = atan(hp.y, hp.x);
  float sw = 0.5 + 0.5 * sin(ang * 3.0 - t * 8.0 + d * 6.0);
  float ring = exp(-sq((d - 0.58) * 4.2)) * (0.35 + 0.65 * sw);
  rgb += colA * ring * body * 0.9;
  // tiny twinkling cross glint
  float tw = pow(max(0.0, sin(t * 11.0 + vInfo.z * 40.0)), 14.0);
  float ray = exp(-abs(hp.x) * 10.0) * exp(-abs(hp.y) * 1.15) + exp(-abs(hp.y) * 10.0) * exp(-abs(hp.x) * 1.15);
  rgb += colC * ray * (0.1 + 0.55 * tw);
#endif
  // velocity-stretched trail behind the head
  if (tr > 0.05) {
    float u = clamp(-(p.x - 0.1) / tr, 0.0, 1.0);
    float wdt = mix(0.74, 0.03, pow(u, 0.65));
    float prof = exp(-sq(p.y / wdt) * 2.4);
    float fall = pow(1.0 - u, 1.8);
    float fl = 0.7;
#ifndef LOW
    fl = 0.62 + 0.75 * vnoise(vec2(p.x * 1.1 + t * vInfo.w * 0.16, p.y * 3.3 + vInfo.z * 20.0));
#endif
    float join = smoothstep(0.3, -0.15, p.x);
    rgb += (colA * 1.1 + colC * pow(1.0 - u, 3.0) * 1.3) * prof * fall * fl * join;
  }

  return vec4(rgb * fade, 0.0);
}
`;

const FRAG_ARROW = /* glsl */ `
vec4 shade(vec2 p) {
  float host = vColA.a;
  float t = uTime + vInfo.z * 31.0;
  float fade = clamp(vColB.w * 16.0, 0.0, 1.0);
  float hl = vInfo.x * 0.5;
  if (host > 0.5) return hostileArrow(p, vLook, t, vInfo.z, vInfo.y, fade * mix(0.4, 1.0, clamp((host - 0.55) / 0.45, 0.0, 1.0)), hl);
  vec3 colA = vColA.rgb;
  vec3 colC = vColB.rgb;
  float trR = vInfo.y;

  // silhouette: shaft + broad head + fletching
  float shaft = sdSeg(p, vec2(-hl + 0.2, 0.0), vec2(hl - 1.0, 0.0)) - 0.1;
  float head = sdTri(vec2(p.y, hl - p.x), vec2(0.5, 1.3));
  vec2 pf = vec2(p.x, abs(p.y));
  float fl = 1e3;
  for (int i = 0; i < 3; i++) {
    float x0 = -hl + 0.3 + float(i) * 0.4;
    fl = min(fl, sdSeg(pf, vec2(x0, 0.05), vec2(x0 - 0.5, 0.46)) - 0.05);
  }
  float sd = min(shaft, min(head, fl));
  float aa = fwidth(sd) * 0.9 + 1e-4;
  float fill = 1.0 - smoothstep(-aa, aa, sd);

  // materials
  float lit = clamp(0.5 + p.y * 2.6, 0.0, 1.0);
  vec3 shaftCol = mix(vec3(0.16, 0.085, 0.045), vec3(0.62, 0.40, 0.2), lit);
  float edgeH = smoothstep(-0.12, 0.0, head);
  vec3 headCol = mix(vec3(0.42, 0.46, 0.54), vec3(1.0, 0.97, 0.9), clamp(0.35 + (p.y + 0.4) * 0.8 + (hl - p.x) * -0.2, 0.0, 1.0));
  headCol = mix(headCol, colC * 1.6, 0.22) + colC * edgeH * 0.9;
  vec3 fletCol = colA * mix(0.45, 0.95, lit) + 0.06;
  vec3 body = shaftCol;
  if (head <= shaft && head <= fl) body = headCol;
  else if (fl < shaft) body = fletCol;
  // thin dark outline keeps the silhouette crisp against bright ground
  body *= 0.55 + 0.45 * smoothstep(0.0, -0.045, sd);
  vec4 solid = vec4(body * fill, fill);

  // glow + motion streak
  float along = 0.25 + 0.75 * smoothstep(-hl, hl, p.x);
  float gl = exp(-max(sd, 0.0) * 6.0) * 0.6 * along;
  vec2 hq = p - vec2(hl - 0.35, 0.0);
  vec3 add = colA * (gl * 1.5 + exp(-dot(hq, hq) * 1.7) * 0.5);
  float u = clamp((-hl + 0.3 - p.x) / max(trR, 0.01), 0.0, 1.0);
  float u2 = clamp((hl - p.x) / (hl * 2.0 + trR), 0.0, 1.0);
  float sw = mix(0.22, 0.02, pow(clamp((-p.x + hl) / (hl * 2.0 + trR), 0.0, 1.0), 0.6));
  float streak = exp(-sq(p.y / max(sw, 0.01)) * 2.0) * pow(1.0 - u2, 1.7);
  add += colA * streak * 1.4 + colC * streak * pow(1.0 - u2, 4.0) * 0.8;
  float tip = exp(-dot(p - vec2(hl, 0.0), p - vec2(hl, 0.0)) * 9.0);
  vec4 glow = vec4(add * fade, 0.0);

  vec4 res = glow;
  res = over(vec4(solid.rgb * fade, solid.a * fade), res);
  res.rgb += colC * tip * 1.8 * fade;
  return res;
}
`;

const FRAG_BLADE = /* glsl */ `
vec3 crescent(vec2 q) {
  // outer circle centre (-0.70, 0), inner circle shifted back; both radius 1.25 → crescent facing +x
  // returns (signed distance of the crescent, distance to the outer circle, distance to the inner circle (<0 outside it))
  float dOut = length(q - vec2(-0.70, 0.0)) - 1.25;
  float dIn = 1.25 - length(q - vec2(-1.22, 0.0));
  return vec3(max(dOut, dIn), dOut, dIn);
}
vec4 shade(vec2 p) {
  float host = vColA.a;
  float t = uTime + vInfo.z * 31.0;
  float fade = clamp(vColB.w * 16.0, 0.0, 1.0);
  float S = vInfo.x;
  if (host > 0.5) return hostileBlade(p, vLook, t, vInfo.z, vInfo.y, fade * mix(0.5, 1.0, clamp((host - 0.55) / 0.45, 0.0, 1.0)), S);
  vec3 colA = vColA.rgb;
  vec3 colC = vColB.rgb;
  vec2 q = p / S;
  q.x += 0.28;

  vec3 cr = crescent(q);
  float sd = cr.x;
  float aa = fwidth(sd) * 0.9 + 1e-4;
  float fill = 1.0 - smoothstep(-aa, aa, sd);
  float g = clamp(-cr.y / 0.5, 0.0, 1.0);          // 0 at the leading edge → 1 towards the hollow
  float hot = exp(-g * 5.5);
  float energy = 1.0;
#ifndef LOW
  energy = 0.78 + 0.5 * vnoise(vec2(q.y * 6.0 + vInfo.z * 17.0, q.x * 3.0 - t * 7.0));
#endif
  vec3 body = mix(colC, colA, smoothstep(0.0, 0.75, g)) * (1.15 - 0.55 * g) * energy;
  vec3 rgb = (body * 1.5 + colC * hot * 2.4) * fill;
  float halo = exp(-max(sd, 0.0) * 4.2) * 0.55;
  rgb += colA * halo * 1.15;

#ifndef LOW
  // speed arcs: thin afterimages of the crescent trailing behind
  float step_ = max(vInfo.y, 0.4) / 3.0 / S;
  for (int i = 1; i <= 3; i++) {
    float fi = float(i);
    vec3 cq = crescent(q + vec2(fi * step_, 0.0));
    float line = exp(-sq(cq.y * 26.0)) * smoothstep(0.12, -0.12, cq.z);
    rgb += colA * line * (0.7 / fi);
  }
#endif

  return vec4(rgb * fade, 0.0);
}
`;

const FRAG_TALISMAN = /* glsl */ `
vec4 shade(vec2 p) {
  float host = vColA.a;
  float t = uTime + vInfo.z * 31.0;
  float fade = clamp(vColB.w * 16.0, 0.0, 1.0);
  // hostile charms (none in today's content) are drawn as the element ball, not as a recoloured friendly talisman
  if (host > 0.5) return hostileOrb(p * 0.55, vLook, t, vInfo.z, 0.0, fade, vInfo.w);
  vec3 colA = vColA.rgb;
  vec3 colC = vColB.rgb;
  float trR = vInfo.y;

  // in-plane spin + tumbling squash (paper turning towards / away from the camera)
  float dirSign = vInfo.z > 0.5 ? 1.0 : -1.0;
  float spin = t * (4.2 + vInfo.z * 2.4) * dirSign + vInfo.z * 6.283;
  float cs = cos(spin);
  float sn = sin(spin);
  vec2 pr = vec2(cs * p.x + sn * p.y, -sn * p.x + cs * p.y);
  float flip = cos(t * 5.2 + vInfo.z * 9.0);
  float squash = mix(0.5, 1.0, abs(flip));
  vec2 hs = vec2(0.62, 1.5);
  vec2 uv = vec2(pr.x / (hs.x * squash), pr.y / hs.y) * 0.5 + 0.5;
  if (flip < 0.0) uv.x = 1.0 - uv.x;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 paper = texture2D(tPaper, clamp(uv, 0.0, 1.0)) * inside;
  float glyph = texture2D(tGlyph, clamp(uv, 0.0, 1.0)).r * inside;
  float sdBox = sdRoundBox(vec2(pr.x / squash, pr.y), hs, 0.06);

  float lit = 0.5 + 0.3 * abs(flip);
  vec3 paperRgb = paper.rgb * lit * (0.9 + 0.2 * vnoise(uv * vec2(34.0, 80.0)));
  vec4 solid = vec4(paperRgb, paper.a);

  vec3 add = colA * glyph * 0.6;
  float d = length(p);
  add += colA * exp(-d * d * 0.55) * 0.3 * (0.8 + 0.2 * sin(t * 14.0));
  add += colA * exp(-max(sdBox, 0.0) * 3.4) * 0.32;
  // comet tail along the on-screen flight direction
  if (trR > 0.05) {
    vec2 tp = vec2(dot(p, -vDirScr), dot(p, vec2(-vDirScr.y, vDirScr.x)));
    float u = clamp(tp.x / trR, 0.0, 1.0);
    float prof = exp(-sq(tp.y / mix(0.5, 0.03, pow(u, 0.7))) * 2.4);
    add += (colA * 0.9 + colC * pow(1.0 - u, 3.0)) * prof * pow(1.0 - u, 1.8) * smoothstep(-0.1, 0.35, tp.x);
  }
  // drifting sparks
  add += mix(colA, colC, 0.5) * (motes(p, t, 2.6) * 1.8 + motes(p + 4.3, t * 1.3, 4.5) * 1.1) * exp(-d * d * 0.4);

  vec4 res = vec4(add * fade, 0.0);
  res = over(vec4(solid.rgb * fade, solid.a * fade), res);
  res.rgb += (colA * 2.3 + colC * 0.5) * glyph * solid.a * fade;      // seal burns through the paper
  return res;
}
`;

const FRAG_BOLT = /* glsl */ `
vec4 shade(vec2 p) {
  float host = vColA.a;
  float t = uTime + vInfo.z * 31.0;
  float fade = clamp(vColB.w * 16.0, 0.0, 1.0);
  // hostile bolts (none in today's content): the element ball, no crimson recolour
  if (host > 0.5) return hostileOrb(p * 0.6, vLook, t, vInfo.z, 0.0, fade, vInfo.w);
  vec3 colA = vColA.rgb;
  vec3 colC = vColB.rgb;
  float hl = vInfo.x * 0.5;
  float tick = floor(t * 16.0);
  float seed = vInfo.z * 13.0;

  float dA = 1e3;
  float dB = 1e3;
  vec2 pa = vec2(-hl, 0.0);
  vec2 pb = vec2(-hl, 0.0);
  vec2 br0 = vec2(0.0);
  for (int i = 1; i < 9; i++) {
    float u = float(i) / 8.0;
    float x = mix(-hl, hl, u);
    float env = pow(sin(u * 3.14159), 0.7);
    float ja = (hash21(vec2(float(i), tick + seed)) - 0.5) * 1.3 * env;
    float jb = (hash21(vec2(float(i) + 11.0, tick * 1.7 + seed * 2.1)) - 0.5) * 1.3 * env;
    vec2 na = vec2(x, ja);
    vec2 nb = vec2(x, jb);
    dA = min(dA, sdSeg(p, pa, na));
#ifndef LOW
    dB = min(dB, sdSeg(p, pb, nb));
#endif
    if (i == 4) br0 = na;
    pa = na;
    pb = nb;
  }
  float ph = smoothstep(-hl, hl, p.x);
  float taper = smoothstep(-hl - 0.3, -hl + 1.6, p.x) * mix(0.35, 1.0, pow(ph, 0.8));
  float flick = 0.75 + 0.25 * hash11(tick + seed);
  float core = (1.0 - smoothstep(0.025, 0.085, dA)) * taper;
  float glow = exp(-dA * 4.6) * taper;
  vec3 rgb = colC * core * 3.4 * flick + colA * glow * 1.35 * flick;
#ifndef LOW
  float coreB = (1.0 - smoothstep(0.02, 0.06, dB)) * taper;
  rgb += colA * coreB * 1.6 + colA * exp(-dB * 7.0) * taper * 0.5;
  // forked branch
  vec2 bend = br0 + vec2(0.9, (hash11(tick * 3.1 + seed) - 0.5) * 2.0);
  float dBr = sdSeg(p, br0, bend);
  rgb += (colA * exp(-dBr * 9.0) * 0.55 + colC * (1.0 - smoothstep(0.015, 0.05, dBr)) * 0.9) * taper;
#endif
  // hot head
  vec2 hv = p - vec2(hl, 0.0);
  rgb += colC * exp(-dot(hv, hv) * 5.0) * 2.4 + colA * exp(-dot(hv, hv) * 1.4) * 0.8;

  return vec4(rgb * fade, 0.0);
}
`;

const FRAG_GROUND = /* glsl */ `
vec4 shade(vec2 p) {
  float t = uTime + vInfo.z * 31.0;
  float fade = clamp(vColB.w * 6.0, 0.0, 1.0);
  return hostileGround(p, vLook, t, vInfo.z, fade);
}
`;

const FRAG_MAIN = /* glsl */ `
void main() {
  vec4 c = shade(vP);
  float win = smoothstep(vExt.x, vExt.x - 0.7, vP.x) * smoothstep(-vExt.y, -vExt.y + 0.7, vP.x) * smoothstep(vExt.z, vExt.z - 0.7, abs(vP.y));
  c *= win;
  c.rgb *= mix(1.0, 0.78, uDirect);
  gl_FragColor = c;
#include <tonemapping_fragment>
#include <colorspace_fragment>
}
`;

// the hostile functions go in front of the shape's `shade`; the blade's hostile crescent needs `crescent()` of FRAG_BLADE, so it
// is spliced right after that helper
const FRAG_BLADE_FULL = FRAG_BLADE.replace('vec4 shade(vec2 p) {', GLSL_HOSTILE_BLADE + '\nvec4 shade(vec2 p) {');
const FRAG_BY_SHAPE = [
  GLSL_HOSTILE_ORB + FRAG_ORB,
  GLSL_HOSTILE_ARROW + FRAG_ARROW,
  FRAG_BLADE_FULL,
  GLSL_HOSTILE_ORB + FRAG_TALISMAN,
  GLSL_HOSTILE_ORB + FRAG_BOLT,
  GLSL_HOSTILE_GROUND + FRAG_GROUND,
];
/** shape index of the ground glow decal batch (not a ProjectileStyleDef shape) */
const GROUND = 5;
const SHAPE_NAMES = ['orb', 'arrow', 'blade', 'talisman', 'bolt', 'ground'];
const TILT = [1.0, 1.0, 0.22, 1.0, 1.0, 0.0];
const PUSH = [0.7, 0.55, 0.3, 0.8, 0.6, 0.0];

// ------------------------------------------------------------------------------------------------------------------
// Painted talisman paper (canvas, browser only)
// ------------------------------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = readonly [number, number];

/** Brush stroke along a quadratic curve: stamped discs with a press/lift width profile and slight tremor. */
function brushStroke(ctx: CanvasRenderingContext2D, p0: Pt, c: Pt, p1: Pt, width: number, rng: () => number): void {
  const len = Math.hypot(c[0] - p0[0], c[1] - p0[1]) + Math.hypot(p1[0] - c[0], p1[1] - c[1]);
  const steps = Math.max(8, Math.ceil(len / 0.7));
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const iu = 1 - u;
    const x = iu * iu * p0[0] + 2 * iu * u * c[0] + u * u * p1[0];
    const y = iu * iu * p0[1] + 2 * iu * u * c[1] + u * u * p1[1];
    const press = Math.min(1, u * 7) * (0.38 + 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.9 + 0.05)), 0.55));
    const r = Math.max(0.35, width * 0.5 * press * (0.9 + 0.2 * rng()));
    ctx.beginPath();
    ctx.arc(x + (rng() - 0.5) * 0.3, y + (rng() - 0.5) * 0.3, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Abstract calligraphic glyph (original, not a real character): 4–6 strokes composed in a Hanzi-like structure. */
function drawGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, w: number, seed: number): void {
  const rng = mulberry32(seed);
  const j = (): number => (rng() - 0.5) * 0.13 * s;
  const layout = Math.floor(rng() * 3);
  // top bar
  brushStroke(ctx, [cx - 0.52 * s + j(), cy - 0.5 * s + j()], [cx + j(), cy - 0.58 * s + j()], [cx + 0.52 * s + j(), cy - 0.46 * s + j()], w * 1.05, rng);
  // spine with hook
  brushStroke(ctx, [cx + 0.02 * s + j(), cy - 0.82 * s], [cx + j(), cy + 0.1 * s], [cx + 0.03 * s, cy + 0.78 * s], w * 1.15, rng);
  brushStroke(ctx, [cx + 0.03 * s, cy + 0.78 * s], [cx + 0.2 * s, cy + 0.9 * s], [cx + 0.34 * s, cy + 0.7 * s], w * 0.8, rng);
  // falling strokes
  brushStroke(ctx, [cx - 0.05 * s, cy - 0.2 * s], [cx - 0.4 * s + j(), cy + 0.05 * s], [cx - 0.58 * s, cy + 0.62 * s], w, rng);
  brushStroke(ctx, [cx + 0.05 * s, cy - 0.12 * s], [cx + 0.3 * s, cy + 0.2 * s + j()], [cx + 0.6 * s, cy + 0.62 * s], w * 1.1, rng);
  if (layout === 0) {
    // box
    brushStroke(ctx, [cx - 0.42 * s, cy + 0.02 * s], [cx - 0.42 * s, cy + 0.3 * s], [cx - 0.4 * s, cy + 0.5 * s], w * 0.8, rng);
    brushStroke(ctx, [cx - 0.42 * s, cy + 0.02 * s], [cx - 0.1 * s, cy - 0.02 * s], [cx + 0.22 * s, cy + 0.04 * s], w * 0.8, rng);
  } else if (layout === 1) {
    brushStroke(ctx, [cx - 0.5 * s, cy - 0.02 * s], [cx - 0.15 * s, cy - 0.08 * s], [cx + 0.45 * s, cy + 0.02 * s], w * 0.85, rng);
  } else {
    brushStroke(ctx, [cx + 0.42 * s, cy - 0.38 * s], [cx + 0.48 * s, cy - 0.3 * s], [cx + 0.55 * s, cy - 0.2 * s], w * 0.9, rng);
    brushStroke(ctx, [cx - 0.55 * s, cy - 0.3 * s], [cx - 0.5 * s, cy - 0.22 * s], [cx - 0.42 * s, cy - 0.12 * s], w * 0.9, rng);
  }
}

/** Ring of eight trigrams (three bars each, some broken) around the seal. */
function drawTrigramRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, bar: number): void {
  for (let k = 0; k < 8; k++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((k * Math.PI) / 4);
    ctx.translate(radius, 0);
    for (let b = 0; b < 3; b++) {
      const x = (b - 1) * bar * 1.9;
      const broken = ((k * 3 + b * 5 + 1) & 3) < 2;
      const half = bar * 3.1;
      if (broken) {
        ctx.fillRect(x - bar * 0.5, -half, bar, half * 0.82);
        ctx.fillRect(x - bar * 0.5, half * 0.18, bar, half * 0.82);
      } else {
        ctx.fillRect(x - bar * 0.5, -half, bar, half * 2);
      }
    }
    ctx.restore();
  }
}

/** Minor glyphs (top/bottom), double seal ring, central glyph and trigram ring, in the context's current styles. */
function paintMarks(ctx: CanvasRenderingContext2D, W: number, minorAlpha: number): void {
  const cx = W * 0.5;
  ctx.globalAlpha = minorAlpha;
  drawGlyph(ctx, cx, 84, 20, 3.6, 0x1234);
  drawGlyph(ctx, cx, 318, 15, 3.0, 0x4321);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cx, 196, 45, 0, Math.PI * 2);
  ctx.lineWidth = 3.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, 196, 39.5, 0, Math.PI * 2);
  ctx.lineWidth = 1.3;
  ctx.stroke();
  drawGlyph(ctx, cx, 196, 28, 5, 0x51ea1);
  drawTrigramRing(ctx, cx, 196, 57, 1.9);
}

interface TalismanTextures {
  paper: CanvasTexture;
  glyph: CanvasTexture;
}

function paintTalismanTextures(): TalismanTextures {
  const W = 160;
  const H = 376;
  const mk = (): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d canvas unavailable');
    return { c, ctx };
  };
  const rng = mulberry32(0x7a1b5eed);
  const paper = mk();
  const glyph = mk();
  const p = paper.ctx;
  const m = 5;

  // silhouette: slightly wavering edges, swallow-tail cut at the bottom
  const outline = new Path2D();
  const wob = (): number => (rng() - 0.5) * 1.6;
  outline.moveTo(m + 1.5, m + wob());
  for (let x = m + 10; x <= W - m - 10; x += 10) outline.lineTo(x, m + wob());
  outline.lineTo(W - m - 1.5, m + wob());
  for (let y = m + 14; y < H - m - 36; y += 14) outline.lineTo(W - m + wob(), y);
  outline.lineTo(W - m - 1, H - m - 34);
  outline.lineTo(W - m - 8, H - m);
  outline.lineTo(W * 0.5 + 7, H - m - 34);
  outline.lineTo(W * 0.5, H - m - 44);
  outline.lineTo(W * 0.5 - 7, H - m - 34);
  outline.lineTo(m + 8, H - m);
  outline.lineTo(m + 1, H - m - 34);
  for (let y = H - m - 48; y > m + 14; y -= 14) outline.lineTo(m + wob(), y);
  outline.closePath();

  p.save();
  p.clip(outline);
  const g = p.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#f5ecd4');
  g.addColorStop(0.55, '#ecdfc0');
  g.addColorStop(1, '#dccaa4');
  p.fillStyle = g;
  p.fillRect(0, 0, W, H);
  // fibres
  for (let i = 0; i < 700; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const l = 3 + rng() * 9;
    const a = rng() * Math.PI;
    p.strokeStyle = rng() < 0.55 ? `rgba(150,115,70,${0.05 + rng() * 0.07})` : `rgba(255,252,240,${0.1 + rng() * 0.12})`;
    p.lineWidth = 0.4 + rng() * 0.5;
    p.beginPath();
    p.moveTo(x, y);
    p.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    p.stroke();
  }
  // age stains
  for (let i = 0; i < 6; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const r = 14 + rng() * 34;
    const rg = p.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(160,118,62,${0.1 + rng() * 0.08})`);
    rg.addColorStop(1, 'rgba(160,118,62,0)');
    p.fillStyle = rg;
    p.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // red header band
  const bandH = 34;
  const bg = p.createLinearGradient(0, m, 0, m + bandH);
  bg.addColorStop(0, '#b8281c');
  bg.addColorStop(1, '#8f1a12');
  p.fillStyle = bg;
  p.fillRect(0, m, W, bandH);
  for (let i = 0; i < 90; i++) {
    p.strokeStyle = `rgba(255,200,170,${0.04 + rng() * 0.07})`;
    p.lineWidth = 0.5;
    const y = m + rng() * bandH;
    p.beginPath();
    p.moveTo(m + rng() * 20, y);
    p.lineTo(W - m - rng() * 20, y + (rng() - 0.5) * 2);
    p.stroke();
  }
  // pale dots inside the band
  p.fillStyle = 'rgba(245,232,205,0.88)';
  for (let i = 0; i < 5; i++) {
    p.beginPath();
    p.arc(W * (0.2 + i * 0.15), m + bandH * 0.5, 2.4, 0, Math.PI * 2);
    p.fill();
  }
  // footer line + side rules
  p.fillStyle = '#9a1d14';
  p.fillRect(m + 10, H - m - 62, W - 2 * m - 20, 3);
  p.fillRect(m + 14, m + bandH + 8, 1.8, H - 2 * m - bandH - 80);
  p.fillRect(W - m - 15.8, m + bandH + 8, 1.8, H - 2 * m - bandH - 80);
  // glyphs
  p.fillStyle = '#8a150e';
  p.strokeStyle = '#8a150e';
  paintMarks(p, W, 1);
  // edge burn
  p.lineWidth = 7;
  p.strokeStyle = 'rgba(110,72,34,0.32)';
  p.stroke(outline);
  p.restore();

  // glow mask: the seal + glyphs burn in the projectile colour (same deterministic marks as the painted ink)
  const gm = glyph.ctx;
  gm.fillStyle = '#000';
  gm.fillRect(0, 0, W, H);
  gm.fillStyle = '#fff';
  gm.strokeStyle = '#fff';
  gm.shadowColor = '#fff';
  gm.shadowBlur = 1.5;
  paintMarks(gm, W, 0.45);

  const tex = (c: HTMLCanvasElement, srgb: boolean): CanvasTexture => {
    const t = new CanvasTexture(c);
    t.colorSpace = srgb ? SRGBColorSpace : '';
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.premultiplyAlpha = srgb;
    t.needsUpdate = true;
    return t;
  };
  return { paper: tex(paper.c, true), glyph: tex(glyph.c, false) };
}

// ------------------------------------------------------------------------------------------------------------------
// System
// ------------------------------------------------------------------------------------------------------------------

interface Batch {
  readonly shape: number;
  readonly geometry: InstancedBufferGeometry;
  readonly material: ShaderMaterial;
  readonly mesh: Mesh;
  readonly posR: Float32Array;
  readonly dirT: Float32Array;
  readonly colA: Float32Array;
  readonly colB: Float32Array;
  readonly extra: Float32Array;
  readonly attrs: InstancedBufferAttribute[];
  count: number;
}

const QUAD_POS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
const QUAD_INDEX = [0, 1, 2, 2, 1, 3];

export class Projectiles implements RenderSystem {
  readonly name = 'projectiles';
  feed: ProjectileFeed | null = null;

  private readonly batches: Batch[] = [];
  private readonly timeUniform = { value: 0 };
  private readonly directUniform = { value: 0 };
  private styleTab: CompiledStyles = compileProjectileStyles([]);
  private readonly kin: Kinematics = { x: 0, z: 0, dx: 0, dz: 0, speed: 0 };
  private d2: Float32Array = new Float32Array(0);
  private work: Float32Array = new Float32Array(0);
  private readonly talisman: TalismanTextures;
  private readonly unsubscribe: () => void;
  /** the sprite atlas the hostile looks sample (stand-in until the shipped vfx sprites are packed) */
  private readonly artUniform = { value: makeAtlasStandIn() as Texture };
  private readonly tracker = new ProjectileTracker();
  private disposed = false;

  constructor(private readonly core: RenderCore) {
    this.talisman = paintTalismanTextures();
    for (let s = 0; s <= GROUND; s++) this.batches.push(this.makeBatch(s));
    this.applyQuality(core.quality.profile);
    this.unsubscribe = core.quality.onChange((p) => this.applyQuality(p));
    for (const b of this.batches) core.scene.add(b.mesh);
    void buildProjectileAtlas((id) => core.assets.loadTexture(id))
      .then((t) => {
        if (!t) return;
        if (this.disposed) {
          t.dispose();
          return;
        }
        const old = this.artUniform.value;
        this.artUniform.value = t;
        old.dispose();
      })
      .catch(() => undefined);
  }

  /** Style table indexed by the feed's `style` column; undefined entries draw a neutral orb. */
  setStyles(styles: ReadonlyArray<ProjectileStyleDef | undefined>): void {
    this.styleTab = compileProjectileStyles(styles);
  }

  update(_dt: number, alpha: number): void {
    this.timeUniform.value = this.core.clock.time;
    for (const b of this.batches) b.count = 0;
    const feed = this.feed;
    if (feed) this.fill(feed, alpha);
    else this.tracker.clear();
    for (const b of this.batches) this.upload(b);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.artUniform.value.dispose();
    for (const b of this.batches) {
      this.core.scene.remove(b.mesh);
      b.geometry.dispose();
      b.material.dispose();
    }
    this.batches.length = 0;
    this.talisman.paper.dispose();
    this.talisman.glyph.dispose();
  }

  // -----------------------------------------------------------------------------------------------------------------

  private makeBatch(shape: number): Batch {
    const cap = PROJECTILE_CAP;
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(QUAD_POS, 3));
    geometry.setIndex(QUAD_INDEX);
    const mk = (): [Float32Array, InstancedBufferAttribute] => {
      const arr = new Float32Array(cap * 4);
      const attr = new InstancedBufferAttribute(arr, 4);
      attr.setUsage(35048); // DynamicDrawUsage
      return [arr, attr];
    };
    const [posR, aPos] = mk();
    const [dirT, aDir] = mk();
    const [colA, aColA] = mk();
    const [colB, aColB] = mk();
    const [extra, aExtra] = mk();
    geometry.setAttribute('iPosR', aPos);
    geometry.setAttribute('iDirT', aDir);
    geometry.setAttribute('iColA', aColA);
    geometry.setAttribute('iColB', aColB);
    geometry.setAttribute('iExtra', aExtra);
    geometry.instanceCount = 0;

    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG_COMMON + GLSL_HOSTILE_COMMON + (FRAG_BY_SHAPE[shape] as string) + FRAG_MAIN,
      defines: { SHAPE: shape },
      uniforms: {
        uTime: this.timeUniform,
        uDirect: this.directUniform,
        uTilt: { value: TILT[shape] },
        uPush: { value: PUSH[shape] },
        tPaper: { value: this.talisman.paper as Texture },
        tGlyph: { value: this.talisman.glyph as Texture },
        tArt: this.artUniform,
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // the ground glow decal lies on the terrain: pulled towards the camera in depth so slopes do not cut it
      polygonOffset: shape === GROUND,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: DoubleSide,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendEquationAlpha: AddEquation,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    material.onBeforeRender = (renderer: WebGLRenderer): void => {
      this.directUniform.value = renderer.getRenderTarget() === null ? 1 : 0;
    };
    const mesh = new Mesh(geometry, material);
    mesh.name = `projectiles:${SHAPE_NAMES[shape]}`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = shape === GROUND ? 49 : 50 + shape;
    mesh.visible = false;
    return { shape, geometry, material, mesh, posR, dirT, colA, colB, extra, attrs: [aPos, aDir, aColA, aColB, aExtra], count: 0 };
  }

  private applyQuality(p: QualityProfile): void {
    const low = p.tier === 'low';
    for (const b of this.batches) {
      const d = (b.material.defines ??= {});
      if ('LOW' in d === low) continue;
      if (low) d.LOW = '';
      else delete d.LOW;
      b.material.needsUpdate = true;
    }
  }

  private fill(feed: ProjectileFeed, alpha: number): void {
    const n = feed.count;
    const rig = this.core.rig;
    const tab = this.styleTab;
    const kin = this.kin;
    const fx = rig.focus.x;
    const fz = rig.focus.z;
    const core = this.core;
    const batches = this.batches;

    let cutoff = Infinity;
    if (n > PROJECTILE_CAP) {
      if (this.d2.length < n) {
        this.d2 = new Float32Array(n);
        this.work = new Float32Array(n);
      }
      for (let i = 0; i < n; i++) {
        const dx = (feed.x[i] as number) - fx;
        const dz = (feed.z[i] as number) - fz;
        this.d2[i] = dx * dx + dz * dz;
      }
      cutoff = nearestCutoff(this.d2, n, PROJECTILE_CAP, this.work);
    }

    // launch / vanish detection of the hostile rows (release flash + impact): off when the feed is over the cap (rows are dropped)
    const track = cutoff === Infinity;
    const tracker = this.tracker;
    if (track) tracker.begin();
    else tracker.clear();
    const now = core.clock.time;
    const ground = batches[GROUND] as Batch;

    for (let i = 0; i < n; i++) {
      if (cutoff !== Infinity && (this.d2[i] as number) > cutoff) continue;
      const styleId = feed.style[i] as number;
      const s = styleId >= 0 && styleId < tab.count && tab.valid[styleId] === 1 ? styleId : tab.count;
      if (tab.hidden[s] === 1) continue;
      const shape = tab.shape[s] as number;
      const b = batches[shape] as Batch;
      const hostile = (feed.hostile[i] as number) !== 0;

      const r0 = Math.max(0.1, feed.radius[i] as number);
      projectileKinematics(feed.x[i] as number, feed.z[i] as number, feed.px[i] as number, feed.pz[i] as number, feed.rot[i] as number, alpha, kin);
      const gy = core.heightAt(kin.x, kin.z);
      const py = gy + (feed.h[i] as number);
      const look = tab.look[s] as number;
      if (hostile && track) {
        const age = feed.age[i] as number;
        const t = tracker.see(styleId, feed.rot[i] as number, kin.x, py, kin.z, kin.dx, kin.dz, kin.speed, age, now - age, r0, look, shape);
        if (t !== null && t.isNew && age <= LAUNCH_MAX_AGE) pushProjEvent(ProjEventKind.Launch, look, shape, kin.x, py, kin.z, kin.dx, kin.dz, r0, kin.speed, false);
      }
      if (b.count >= PROJECTILE_CAP) continue;

      // hostile bodies are drawn bigger than the hit radius so they read at the 55 degree camera (orb ball, arrow length, small crescent)
      // a hostile body that reaches the hero shrinks into the hit point (it is consumed by the blow, not left sitting on the hero)
      let near = 1;
      let nearN = 1;
      if (hostile) {
        const dxh = kin.x - fx;
        const dzh = kin.z - fz;
        const dh = Math.sqrt(dxh * dxh + dzh * dzh);
        nearN = smooth01((dh - 0.4) / 2.2);
        near = HOSTILE_NEAR_MIN + (1 - HOSTILE_NEAR_MIN) * nearN;
      }
      const r = hostile && shape === 0 ? r0 * HOSTILE_ORB_SCALE * near : r0;
      let len = tab.length[s] as number;
      if (hostile) len = (shape === 1 ? len * HOSTILE_ARROW_LEN : shape === 2 ? len * HOSTILE_BLADE_LEN : len) * (shape === 0 ? 1 : near);
      // hostile bodies shed a longer trail (drifting smoke + embers stay where they were released, see projectileLooks trailPuffs)
      const trailSec = hostile ? Math.max(tab.trail[s] as number, HOSTILE_TRAIL_S[shape] ?? 0) : (tab.trail[s] as number);
      // the smoke / ember trail also shortens as the body is consumed at the hero (a volley converging on one point must not read as a radial porcupine of long streaks)
      const trailM = trailMetres(trailSec, kin.speed) * (hostile ? 0.4 + 0.6 * nearN : 1);
      if (!rig.isVisible(kin.x, kin.z, r * (2.4 + len * 0.6) + trailM)) continue;

      const o = b.count * 4;
      b.posR[o] = kin.x;
      b.posR[o + 1] = py;
      b.posR[o + 2] = kin.z;
      b.posR[o + 3] = r;
      b.dirT[o] = kin.dx;
      b.dirT[o + 1] = kin.dz;
      b.dirT[o + 2] = trailM;
      const rot = feed.rot[i] as number;
      const sv = Math.sin(rot * 78.233 + 1.7) * 43758.5453;
      const seed = sv - Math.floor(sv);
      b.dirT[o + 3] = seed;
      const c = s * 3;
      b.colA[o] = tab.color[c] as number;
      b.colA[o + 1] = tab.color[c + 1] as number;
      b.colA[o + 2] = tab.color[c + 2] as number;
      b.colA[o + 3] = hostile ? 0.55 + 0.45 * nearN : 0; // > 0.5 = hostile; the rest = distance to the hero (0 at the hit point .. 1 from ~2.6 m)
      b.colB[o] = tab.core[c] as number;
      b.colB[o + 1] = tab.core[c + 1] as number;
      b.colB[o + 2] = tab.core[c + 2] as number;
      b.colB[o + 3] = feed.age[i] as number;
      b.extra[o] = len;
      b.extra[o + 1] = kin.speed;
      b.extra[o + 2] = look;
      b.count++;

      if (hostile && ground.count < PROJECTILE_CAP) {
        // danger underlay on the floor in the element hue (soft pool over a dark soft shadow)
        const g = ground.count * 4;
        ground.posR[g] = kin.x;
        ground.posR[g + 1] = gy + 0.12;
        // the quad follows the local slope (a flat decal dips under uphill terrain): central differences over 1 m
        ground.dirT[g] = (core.heightAt(kin.x + 1, kin.z) - core.heightAt(kin.x - 1, kin.z)) * 0.5;
        ground.dirT[g + 1] = (core.heightAt(kin.x, kin.z + 1) - core.heightAt(kin.x, kin.z - 1)) * 0.5;
        ground.posR[g + 2] = kin.z;
        ground.posR[g + 3] = r * (shape === 0 ? 1.1 : shape === 1 ? 1.3 : 1.15);
        ground.dirT[g + 3] = seed;
        ground.colA[g + 3] = 1 + shape; // the ground shader reads the body shape: 1 orb, 2 arrow, 3 blade
        ground.colB[g + 3] = feed.age[i] as number;
        ground.extra[g + 2] = look;
        ground.count++;
      }
    }
    if (track) {
      const fx0 = rig.focus.x;
      const fz0 = rig.focus.z;
      tracker.end((rec) => {
        const hit = (rec.x - fx0) * (rec.x - fx0) + (rec.z - fz0) * (rec.z - fz0) < (1.6 + rec.r) * (1.6 + rec.r);
        pushProjEvent(ProjEventKind.Blow, rec.look, rec.shape, rec.x, rec.y, rec.z, rec.dx, rec.dz, rec.r, rec.speed, hit);
      });
    }
  }

  private upload(b: Batch): void {
    const n = b.count;
    b.mesh.visible = n > 0;
    b.geometry.instanceCount = n;
    if (n === 0) return;
    for (const a of b.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
  }
}

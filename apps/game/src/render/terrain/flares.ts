// PL-05 (S-LIGHT-05): visible light sources. Every emitter of the zone's light pools (the lantern, brazier, bonfire and pillar props the
// zone look lights on the ground, bakePools.ts) gets one soft additive glow at the height of its flame, so a pool on the ground has a
// source you can see. Render side only: the prop GLBs are not touched, positions come from the placed props (read only).
//
// One InstancedBufferGeometry draw per zone (a camera-facing quad per emitter), one material (`up:PL-05:flare`, no defines: a quality
// change never relinks it) that sits in the scene from zone load, so RenderWorld.warmupAsync compiles it under the loading screen and it
// never links mid-run. Nothing is uploaded after the build: every uniform is a shared object that zoneScene / the arc already write
// (worldUniforms.uTime / uFocus, atmosphereUniforms.uPoolGain), so a frame costs no JS and no buffer write.
//
//   - same flicker as the pool: the terrain shader's flick(time, x, z) at the emitter's own x, z with the pool's amplitude, so the glow
//     and the light on the ground breathe together;
//   - day and dusk: a lantern is a lit window, not a lamp, at noon. Each flare carries a `day` factor (its share of the full glow at the
//     arc's poolGain 1) that rises to 1 as poolGain goes 1.3 -> 3 (flareLit), then the glow keeps growing a little (poolGain^0.3,
//     flareGain). So the lanterns are a soft warm glint at noon and a lamp at dusk, while the fires (which burn by day too) keep theirs;
//   - small by day, full halo at dusk: the radius of a flare with a day share is FLARE_NOON_SCALE of its table radius at noon and grows with
//     the same ramp (flareScale), so the noon glint stays under the eaves and the dusk lamp spills a warm halo;
//   - the roof keeps its carving: the camera looks down on a lantern, the fire box sits under the eaves. The flare sits at the fire box
//     (not the roof's rim), is small, and is only pushed a little towards the camera (`push`, metres along the view ray, which leaves the
//     screen position alone and only decides what the depth test lets through), so the eaves still cut the top of the glow;
//   - `fwd`: metres the glow centre moves towards the camera (horizontally) so a light inside a thick body (the lava pillar) glows on the
//     face you can see; with a `push` that clears the rest the glow is not cut along a hard polygon edge by the body it sits on;
//   - `core`: share of the hot centre (the halo stays); a fire keeps its flame shape through a low core;
//   - never a glow over the hero: a flare that sits between the camera and the hero (nearer to the camera, within ~3 m of the hero's
//     screen position) fades to 12 %, the way the prop itself ghosts when it hides the hero (occlusion.ts: a ghosted pillar would
//     otherwise leave its flare floating over the hero); beyond 56..76 m the glow fades out and the vertex is parked outside the
//     clip volume;
//   - low tier: the mesh is hidden (no draw, no render-list entry). A tier switch relinks the render-target dependent programs of the
//     whole scene (linear HDR target vs the screen), this one included, like every other.
//
// `up=noflare` (dev server / VITE_QA_HOOKS=1 builds only, like the arc's `up=noarc`) builds no flares: the "before" side of a pair on the
// same tree.
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  type PerspectiveCamera,
  type Vector3,
} from 'three';
import type { QualityProfile } from '../quality';
import type { PoolEmitter } from './bakePools';
import { poolEmitters } from './bakePools';
import { atmosphereUniforms } from './atmosphere';
import type { PoolSpec, ZoneLook } from './look/types';
import { heroViewUniform } from './occlusion';
import { worldUniforms, type ZoneContext, type ZoneSystem } from './zoneContext';

/** the built-in flare of a prop id: brightness (PoolSpec.flare), metres above the prop's base (PoolSpec.flareHeight), glow radius in metres, sideways offset */
export interface FlareDef {
  flare: number;
  height: number;
  radius: number;
  /** metres along the prop's own +X (turned by its yaw) where the light hangs off the post (the lamp post's bracket); absent = on the axis */
  dx?: number;
  /** share of the full glow at poolGain 1 (noon), 0..1; absent = 1 (a fire burns by day too) */
  day?: number;
  /** metres the glow centre moves towards the camera (horizontal), onto the visible face of the body it sits in; absent = 0 */
  fwd?: number;
  /** metres the glow is pulled towards the camera along the view ray for the depth test; absent = 0.6 x radius */
  push?: number;
  /** share of the hot centre, 0..1 (1 = the full core); absent = 1 */
  core?: number;
  /** linear rgb multiplier on the pool colour (a pale cream pool #ffd08a leaves the shoulder of the tone map near white: the lantern glows deeper amber); absent = 1, 1, 1 */
  tint?: readonly [number, number, number];
}

/** the lantern tint: the pool colour of a lantern is pale cream (#ffd08a); added HDR light of that colour runs to white in the tone map's shoulder */
const AMBER: readonly [number, number, number] = [1, 0.85, 0.6];

/**
 * Built-in table (heights measured against the shipped GLBs, see the PL-05 notes): used when the zone's PoolSpec has no `flare` /
 * `flareHeight`. An id that is not here gets no flare unless its PoolSpec names one (obelisk, lava_rock and the rocks stay as they were).
 *
 * stone_lantern (4.8 m): plate 2.6..3.4, FIRE BOX 3.4..3.8 (r .5), roof 3.8..4.4 (r .78). lamp_post (4.8 m): the glass box hangs on the
 * arm at x .5..1.37 (centre .93), y 2.9..3.8. lava_pillar (13 m): a squarish shaft of +-1.33 m at 3..3.5 m.
 */
export const FLARE_TABLE: Readonly<Record<string, FlareDef>> = {
  stone_lantern: { flare: 0.65, height: 3.5, radius: 0.95, day: 0.3, push: 0.4, core: 0.6, tint: AMBER },
  lamp_post: { flare: 0.55, height: 3.3, radius: 0.8, dx: 0.93, day: 0.3, push: 0.3, core: 0.6, tint: AMBER },
  brazier: { flare: 0.45, height: 1.55, radius: 1.3, core: 0.5 },
  fire_brazier: { flare: 0.45, height: 1.45, radius: 1.3, core: 0.5 },
  bonfire: { flare: 0.34, height: 0.8, radius: 1.6, day: 0.7, core: 0.3 },
  lava_pillar: { flare: 0.36, height: 3.2, radius: 1.7, fwd: 1.3, push: 1.4, core: 0.15 },
  plague_brazier: { flare: 0.45, height: 0.9, radius: 1.0, core: 0.6 },
  // the boss altar's coal bowl (its flame sockets sit at 2.74..2.8 m): the glow rides just above them
  fire_altar: { flare: 0.32, height: 3.0, radius: 2.2, core: 0.3 },
};

/** radius of a flare whose id has no table entry (the pool's own radius, scaled down to a lamp-sized glow) */
const DEFAULT_RADIUS_OF_POOL = 0.16;
const MIN_RADIUS = 0.6;
const MAX_RADIUS = 2.4;
const DEFAULT_HEIGHT = 1.2;
/** the pull towards the camera of a flare without a `push` (x its radius) */
export const DEFAULT_PUSH_OF_RADIUS = 0.6;

/** HDR scale of a flare of brightness 1 at the centre of its core (bloom picks up the part above the pipeline's threshold) */
export const FLARE_HDR = 3.6;
/** past the day share the flare scales with the arc's poolGain to this power (1 at poolGain 1 -> x1.39 at gain 3, x1.57 at 4.5) */
export const FLARE_GAIN_EXP = 0.3;
/** the arc's poolGain where a flare with a `day` share starts to rise to its full glow, and where it is there (dusk is 3..4.5) */
export const FLARE_LIT_FROM = 1.3;
export const FLARE_LIT_TO = 3.0;

/** a flare with a `day` share is this share of its radius at poolGain 1 (noon: a small glint) and grows to the full radius as it lights up (dusk: a lamp with a halo) */
export const FLARE_NOON_SCALE = 0.65;

/** distance (m, horizontal, from the camera focus) where a flare starts to fade out / is gone */
export const FLARE_FADE_NEAR = 56;
export const FLARE_FADE_FAR = 76;
/**
 * The hero shield: a flare nearer to the camera than the hero (by 0.5..2.5 m) and within FLARE_SHIELD_NEAR..FAR metres of the hero's
 * chest across the view (measured on the plane of the hero) is dimmed to FLARE_SHIELD_MIN.
 */
export const FLARE_SHIELD_NEAR = 1.6;
export const FLARE_SHIELD_FAR = 3.4;
export const FLARE_SHIELD_MIN = 0.12;

/** One emitter as the shader gets it. */
export interface FlareEmitter {
  /** pool key (prop id, or `rock:<kind>`) */
  key: string;
  x: number;
  y: number;
  z: number;
  /** glow radius in metres (already times the prop's scale) */
  radius: number;
  /** linear colour times brightness (no HDR scale) */
  r: number;
  g: number;
  b: number;
  /** the pool's flicker amplitude 0..1 */
  flicker: number;
  /** share of the full glow at poolGain 1 (see FlareDef.day) */
  day: number;
  /** metres towards the camera (already times the prop's scale) */
  fwd: number;
  /** metres along the view ray towards the camera for the depth test (already times the prop's scale) */
  push: number;
  /** share of the hot centre */
  core: number;
}

/** The flare definition of one emitter, or null when it has none (no table entry and no `spec.flare`, or `flare: 0`). */
export function flareDefFor(key: string, spec: PoolSpec): FlareDef | null {
  if (spec.flare !== undefined && !(spec.flare > 0)) return null;
  const table = FLARE_TABLE[key];
  const flare = spec.flare ?? table?.flare;
  if (flare === undefined || !(flare > 0)) return null;
  const radius = table?.radius ?? Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, spec.radius * DEFAULT_RADIUS_OF_POOL));
  return { ...table, flare, height: spec.flareHeight ?? table?.height ?? DEFAULT_HEIGHT, radius };
}

const tmpColor = new Color();

/** The flares of a zone: its pool emitters that have a flare definition, at the light height of each. */
export function flareEmitters(emitters: readonly PoolEmitter[]): FlareEmitter[] {
  const out: FlareEmitter[] = [];
  for (const e of emitters) {
    // a rock key is only lit by an explicit `flare` (no built-in table for rocks)
    if (e.kind === 'rock' && !(e.spec.flare !== undefined && e.spec.flare > 0)) continue;
    const def = flareDefFor(e.key, e.spec);
    if (!def) continue;
    tmpColor.set(e.spec.color);
    const height = e.kind === 'rock' && e.spec.flareHeight === undefined ? 0.5 * e.height : def.height * e.scale;
    const dx = (def.dx ?? 0) * e.scale;
    const s = e.kind === 'rock' ? 1 : e.scale;
    const radius = def.radius * s;
    out.push({
      key: e.key,
      x: e.x + dx * Math.cos(e.yaw),
      y: e.y + height,
      z: e.z - dx * Math.sin(e.yaw),
      radius,
      r: tmpColor.r * def.flare * (def.tint?.[0] ?? 1),
      g: tmpColor.g * def.flare * (def.tint?.[1] ?? 1),
      b: tmpColor.b * def.flare * (def.tint?.[2] ?? 1),
      flicker: e.spec.flicker ?? 0,
      day: def.day ?? 1,
      fwd: (def.fwd ?? 0) * s,
      push: def.push !== undefined ? def.push * s : DEFAULT_PUSH_OF_RADIUS * radius,
      core: def.core ?? 1,
    });
  }
  return out;
}

/** The share of the full glow the arc's poolGain leaves a flare with a `day` share (the vertex shader's `mix(day, 1, smoothstep(FROM, TO, poolGain))`). */
export function flareLit(poolGain: number, day: number): number {
  const t = Math.min(1, Math.max(0, (poolGain - FLARE_LIT_FROM) / (FLARE_LIT_TO - FLARE_LIT_FROM)));
  return day + (1 - day) * (t * t * (3 - 2 * t));
}

/**
 * The radius share the arc's poolGain leaves a flare with a `day` share (the vertex shader's `mix(FLARE_NOON_SCALE, 1, k)`, k = how far it has lit up
 * between its day share and 1): the noon glint is small, the dusk lamp has its full halo. A flare without a day share (a fire) is always full size.
 */
export function flareScale(poolGain: number, day: number): number {
  if (day >= 0.999) return 1;
  const k = (flareLit(poolGain, day) - day) / (1 - day);
  return FLARE_NOON_SCALE + (1 - FLARE_NOON_SCALE) * k;
}

/** The arc's poolGain as the flare sees it (the vertex shader's `pow(uPoolGain, FLARE_GAIN_EXP)`): 1 at noon, ~1.39 at gain 3, ~1.57 at gain 4.5. */
export function flareGain(poolGain: number): number {
  return Math.pow(Math.max(poolGain, 0), FLARE_GAIN_EXP);
}

/** The terrain shader's pool flicker (terrainMaterial.ts) at the emitter's own ground point, with the pool's amplitude. */
export function flareFlicker(time: number, x: number, z: number, amplitude: number): number {
  return 1 + amplitude * 0.7 * (0.6 * Math.sin(time * 7.3 + x * 0.41 + z * 0.57) + 0.4 * Math.sin(time * 11.1 + x * 0.9));
}

/** `up=noflare` of a page query (several `up=` pairs add up); false for every page but the dev server / a QA build (`qa`). */
export function parseFlareSwitch(search: string | null | undefined, qa: boolean): boolean {
  if (!qa || !search) return false;
  for (const m of search.matchAll(/[?&]up=([^&#]*)/g)) {
    let v = m[1] ?? '';
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep the raw text */
    }
    for (const w of v.split(',')) if (w.trim().toLowerCase() === 'noflare') return true;
  }
  return false;
}

function pageNoFlare(): boolean {
  if (!(import.meta.env.DEV || import.meta.env.VITE_QA_HOOKS === '1')) return false;
  return parseFlareSwitch(typeof location !== 'undefined' ? location.search : '', true);
}

const f1 = (n: number): string => n.toFixed(2);

const FLARE_VERT = /* glsl */ `
attribute vec4 aPos; // world xyz of the light, w = glow radius (m)
attribute vec4 aCol; // linear rgb * brightness * HDR scale, a = the pool's flicker amplitude
attribute vec4 aEx; // x = day share, y = fwd (m towards the camera), z = push (m along the view ray), w = core share
uniform float uTime;
uniform vec3 uFocus;
uniform float uPoolGain;
uniform vec3 uHeroView; // the hero's chest in view space (zoneScene.update, occlusion.ts)
varying vec2 vUv;
varying vec3 vCol;
varying float vCore;
void main() {
  vUv = position.xy;
  vCore = aEx.w;
  float dist = length(aPos.xz - uFocus.xz);
  float fade = 1.0 - smoothstep(${f1(FLARE_FADE_NEAR)}, ${f1(FLARE_FADE_FAR)}, dist);
  if (fade <= 0.0) {
    vCol = vec3(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume: nothing is rasterised
    return;
  }
  // the terrain shader's pool flicker, at the emitter's own ground point
  float fl = 1.0 + aCol.a * 0.7 * (0.6 * sin(uTime * 7.3 + aPos.x * 0.41 + aPos.z * 0.57) + 0.4 * sin(uTime * 11.1 + aPos.x * 0.9));
  // noon -> dusk: the day share rises to the full glow, then it keeps growing a little
  float lit = mix(aEx.x, 1.0, smoothstep(${f1(FLARE_LIT_FROM)}, ${f1(FLARE_LIT_TO)}, uPoolGain));
  float gain = lit * pow(max(uPoolGain, 0.0), ${f1(FLARE_GAIN_EXP)});
  // the radius: small by day, the full halo once it is lit (a fire has no day share: always full)
  float k = (lit - aEx.x) / max(1.0 - aEx.x, 0.001);
  float rs = mix(mix(${f1(FLARE_NOON_SCALE)}, 1.0, k), 1.0, step(0.999, aEx.x));
  // onto the face of the body that the camera sees
  vec3 wp = aPos.xyz;
  vec3 toCam = cameraPosition - wp;
  toCam.y = 0.0;
  wp += toCam / max(length(toCam), 0.001) * aEx.y;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  // the hero shield: in front of the hero (nearer to the camera) and over the hero's screen position
  float df = -mv.z;
  float dh = -uHeroView.z;
  float front = smoothstep(0.5, 2.5, dh - df);
  vec2 lat = mv.xy * (dh / max(df, 0.1)) - uHeroView.xy;
  float over = 1.0 - smoothstep(${f1(FLARE_SHIELD_NEAR)}, ${f1(FLARE_SHIELD_FAR)}, length(lat));
  float shield = mix(1.0, ${f1(FLARE_SHIELD_MIN)}, front * over);
  vCol = aCol.rgb * (fade * fl * gain * shield);
  // towards the camera along the view ray: same screen position, clear of the prop's own mesh for the depth test
  mv.xyz -= normalize(mv.xyz) * aEx.z;
  mv.xy += position.xy * (aPos.w * rs);
  gl_Position = projectionMatrix * mv;
}
`;

const FLARE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vCore;
void main() {
  float d2 = dot(vUv, vUv);
  if (d2 >= 1.0) discard;
  float d = sqrt(d2);
  float core = exp(-d2 * 26.0) * vCore;
  float halo = pow(1.0 - d, 2.6) * 0.42;
  // the hot centre leans a little towards white, the skirt keeps the pool's colour
  vec3 c = vCol * (halo + core) + vec3(1.0, 0.9, 0.7) * (core * 0.08 * dot(vCol, vec3(0.3333)));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

export interface FlareSystem extends ZoneSystem {
  readonly material: ShaderMaterial;
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** the emitters baked into the instance buffer */
  readonly emitters: readonly FlareEmitter[];
}

/** Builds the zone's flares; null when it has none (no lit emitter with a flare) or `up=noflare` is on the page. */
export function createFlares(ctx: Pick<ZoneContext, 'field' | 'quality'>, look: Pick<ZoneLook, 'pools'>, noFlare = pageNoFlare()): FlareSystem | null {
  if (noFlare) return null;
  const emitters = flareEmitters(poolEmitters(ctx.field, look.pools));
  if (emitters.length === 0) return null;
  const n = emitters.length;
  const pos = new Float32Array(n * 4);
  const col = new Float32Array(n * 4);
  const ex = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const e = emitters[i] as FlareEmitter;
    pos.set([e.x, e.y, e.z, e.radius], i * 4);
    col.set([e.r * FLARE_HDR, e.g * FLARE_HDR, e.b * FLARE_HDR, e.flicker], i * 4);
    ex.set([e.day, e.fwd, e.push, e.core], i * 4);
  }
  const quad = new BufferGeometry();
  quad.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('aPos', new InstancedBufferAttribute(pos, 4));
  geometry.setAttribute('aCol', new InstancedBufferAttribute(col, 4));
  geometry.setAttribute('aEx', new InstancedBufferAttribute(ex, 4));
  geometry.instanceCount = n;
  quad.dispose();
  const material = new ShaderMaterial({
    name: 'up:PL-05:flare',
    uniforms: { uTime: worldUniforms.uTime, uFocus: worldUniforms.uFocus, uPoolGain: atmosphereUniforms.uPoolGain, uHeroView: heroViewUniform },
    vertexShader: FLARE_VERT,
    fragmentShader: FLARE_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'zone:flares';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 5;
  const group = new Group();
  group.name = 'flares';
  group.add(mesh);
  // low: the mesh is hidden (no render-list entry, no draw, no uniform upload); the program of the other tiers is compiled at load, and
  // a switch up relinks it with the rest of the scene's render-target dependent programs
  const apply = (p: QualityProfile): void => {
    mesh.visible = p.tier !== 'low';
  };
  apply(ctx.quality);
  return {
    name: 'flares',
    group,
    material,
    mesh,
    emitters,
    update(_dt: number, _camera: PerspectiveCamera, _focus: Vector3) {
      /* every uniform is shared and written by zoneScene / the arc: nothing to do per frame */
    },
    setQuality: apply,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

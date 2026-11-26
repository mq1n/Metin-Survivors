// Ground rings: immediate-mode markers under elites / champions / bosses / metins / the hero / the lock-on target.
//
// The owner calls `add()` any number of times before `update()` each frame; the list is consumed and reset.
//  • small rings (radius ≤ SMALL_RADIUS): one instanced quad batch, each quad tilted onto a plane fitted to 5 terrain
//    samples (centre + 4 around) and lifted by the curvature residual — cheap for hundreds of rings;
//  • large rings (boss / metin / big elites): terrain-conforming slot grids (the telegraph `DecalGrid`), so a 6 m
//    boss sigil drapes over hills instead of sinking half into them.
// Both paths share one analytic fragment look (`ringLook`); each kind's branch lives in ./rings/<kind>.ts (C0 split,
// one owner per kind; the target reticle stays here).
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  KeepStencilOp,
  Mesh,
  MathUtils,
  NormalBlending,
  NotEqualStencilFunc,
  ShaderMaterial,
  type IUniform,
} from 'three';
import type { RenderCore, RenderSystem } from '../core';
import { TG_CIRCLE, TG_LINE, TG_RING } from '../feed';
import type { QualityProfile } from '../quality';
import { DecalGrid, FX_GLSL_LIB, selectClosest } from './decalGrid';
import { RING_BOSS } from './rings/boss';
import { RING_CHAMPION } from './rings/champion';
import { RING_ELITE } from './rings/elite';
import { RING_HERO } from './rings/hero';
import { RING_METIN } from './rings/metin';

export type RingKind = 'elite' | 'champion' | 'boss' | 'metin' | 'hero' | 'target';

export const RING_KIND_INDEX: Record<RingKind, number> = { elite: 0, champion: 1, boss: 2, metin: 3, hero: 4, target: 5 };

export const RING_DEFAULT_COLOR: Record<RingKind, string> = {
  elite: '#9cc6f2',
  champion: '#ffcf5e',
  boss: '#c01f38',
  metin: '#b46cff',
  hero: '#c4ecff',
  target: '#ffffff',
};

/** radius (m) at or below which a ring uses the plane-fit instanced path */
export const SMALL_RADIUS = 2.6;
/** quad half-size = radius × QUAD_MARGIN (room for the outer halo) */
const QUAD_MARGIN = 1.3;
const FLOATS = 12;

/** Plane + lift fitted to terrain around a ring: y(lx,lz) = h0 + gx·lx + gz·lz + lift. */
export function fitGroundPlane(
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
  radius: number,
  out: Float32Array,
  o: number,
): void {
  const d = Math.max(0.3, radius * 1.15);
  const h0 = heightAt(x, z);
  const hxp = heightAt(x + d, z);
  const hxm = heightAt(x - d, z);
  const hzp = heightAt(x, z + d);
  const hzm = heightAt(x, z - d);
  const cx = (hxp + hxm) * 0.5 - h0;
  const cz = (hzp + hzm) * 0.5 - h0;
  out[o] = h0;
  out[o + 1] = (hxp - hxm) / (2 * d);
  out[o + 2] = (hzp - hzm) / (2 * d);
  out[o + 3] = 0.045 + Math.max(0, cx, cz);
}

/** Local rect of a large ring slot: square around the ring with halo margin. */
function ringRect(_kind: number, r1: number, _r2: number, _r3: number, out: Float32Array, o: number): void {
  const h = r1 * QUAD_MARGIN;
  out[o] = -h;
  out[o + 1] = h;
  out[o + 2] = -h;
  out[o + 3] = h;
}

// ---------------------------------------------------------------------------------------------------------------
// Fragment look

const RING_LOOK = /* glsl */ `
${FX_GLSL_LIB}

vec2 rot2(vec2 p, float a) { float c = cos(a); float s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float sdNgon(vec2 p, float r, float n) {
  float an = 3.14159265 / n;
  vec2 acs = vec2(cos(an), sin(an));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p.y += clamp(-p.y, 0.0, r * acs.y);
  return length(p) * sign(p.x);
}
float diamond(vec2 p, vec2 s, float aa) { p = abs(p) / s; return 1.0 - smoothstep(1.0 - aa, 1.0 + aa, p.x + p.y); }

// l: metres from the ring centre (x right, y forward); R: ring radius (m). Returns straight-alpha colour.
vec4 ringLook(vec2 l, float R, float kind, float str, vec3 colMain, float seed, float t) {
  const float TAU = 6.2831853;
  float r = length(l);
  float ang = atan(l.x, l.y);
  float aaM = max(fwidth(r), 1e-4) * 0.95;
  vec3 col = vec3(0.0);
  float a = 0.0;
  float outside = step(R, r);

  if (kind < 0.5) {
${RING_ELITE}  } else if (kind < 1.5) {
${RING_CHAMPION}  } else if (kind < 2.5) {
${RING_BOSS}  } else if (kind < 3.5) {
${RING_METIN}  } else if (kind < 4.5) {
${RING_HERO}  } else {
    // ---- target: thin white reticle -------------------------------------------------------------------------
    vec3 c = colMain;
    float breath = 1.0 + 0.025 * sin(t * 5.0);
    float rr = r / breath;
    float rc = R - 0.03;
    layer(col, a, vec3(0.0, 0.0, 0.02), band(rr, rc, 0.055, aaM * 1.4) * 0.5);
    layer(col, a, c, band(rr, rc, 0.016, aaM) * 0.88);
    float aq = mod(ang + t * 0.25 + 0.7853982, 1.5707963) - 0.7853982;
    vec2 pf = r * vec2(sin(aq), cos(aq));
    float tick = (1.0 - smoothstep(0.014, 0.014 + aaM, abs(pf.x))) * band(pf.y, R * 0.8, R * 0.2, aaM);
    layer(col, a, c, tick * 0.9);
    float bu = fract((ang + t * 0.25) / 1.5707963);
    float br = 1.0 - smoothstep(0.10, 0.13, abs(bu - 0.5));
    layer(col, a, c, band(rr, R + 0.1, 0.03, aaM) * br * 0.8);
    layer(col, a, c, exp(-abs(rr - rc) / 0.06) * 0.2);
  }
  // co-op allies (FEEL-01): the hero branch is gold; a hero ring carrying the ally colour (blue-dominant, render/world.ts) swaps red / blue = azure
  if (kind > 3.5 && kind < 4.5 && colMain.b > colMain.r * 4.0) col = col.bgr;
  vec3 rgb = col / max(a, 1e-4);
  a *= clamp(str, 0.0, 1.5);
  return vec4(rgb * (0.8 + 0.2 * clamp(str, 0.0, 1.5)), min(a, 1.0));
}
`;

const SMALL_VERT = /* glsl */ `
attribute vec4 aP; // x, z, radius, kind
attribute vec4 aQ; // plane: h0, gx, gz, lift
attribute vec4 aR; // strength, rgb
flat varying float vKind;
flat varying float vR;
flat varying float vStr;
flat varying float vSeed;
flat varying vec3 vCol;
varying vec2 vL;
void main() {
  vec2 l = position.xy * (aP.z * ${QUAD_MARGIN.toFixed(2)});
  vec2 w = aP.xy + l;
  float y = aQ.x + aQ.y * l.x + aQ.z * l.y + aQ.w;
  vKind = aP.w; vR = aP.z; vStr = aR.x; vCol = aR.yzw;
  vSeed = fract(aP.z * 3.713) * 6.2831853;
  vL = l;
  gl_Position = projectionMatrix * viewMatrix * vec4(w.x, y, w.y, 1.0);
}
`;

const SMALL_FRAG = /* glsl */ `
uniform float uTime;
flat varying float vKind;
flat varying float vR;
flat varying float vStr;
flat varying float vSeed;
flat varying vec3 vCol;
varying vec2 vL;
${RING_LOOK}
void main() {
  if (length(vL) > vR + 0.5) discard; // beyond every halo: skip the whole look
  vec4 c = ringLook(vL, vR, vKind, vStr, vCol, vSeed, uTime);
  if (c.a < 0.003) discard;
  gl_FragColor = c;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const LARGE_FRAG = /* glsl */ `
uniform float uTime;
flat varying float vKind;
flat varying float vProg;
flat varying float vR1;
flat varying float vAlpha;
flat varying float vSeed;
flat varying float vAux;
flat varying vec4 vExtra;
varying vec2 vL;
${RING_LOOK}
void main() {
  if (length(vL) > vR1 + 0.5) discard;
  vec4 c = ringLook(vL, vR1, vKind, vProg, vExtra.rgb, vSeed, uTime);
  c.a *= vAlpha * (1.0 - vAux);
  if (c.a < 0.003) discard;
  gl_FragColor = c;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------------------------------------------
// FEEL-01: hero beacon.
//
// Late in a run the hero disappears inside 250-500 enemies: its ring is a depth-tested ground decal, hidden wherever an enemy stands
// on it, and the x-ray only helps behind geometry. While >= BEACON_ON creatures stand within BEACON_NEAR m of a hero, that hero's ring is drawn a
// second time WITHOUT depth test, at ~35 % alpha, fading 0.25 s in / out, in gold for the local hero and azure for the other co-op heroes
// (the ground ring of an ally is azure too, see ringLook), plus a small chevron over the head on EVERY tier (redo: in the late fights the ring
// sits under a telegraph in 72-99 % of the frames, where it is thin and faint, so the ring alone did not find the hero on medium / low; the chevron
// is the same instanced draw and program, its alpha ignores the cover, and it adds no cost). Rules it keeps:
//  - no blinking: the crowd must hold 0.5 s to switch it on, and it stays on for 3 s and until the crowd has been thin for 2 s (stepBeacon);
//  - telegraphs win: where a telegraph decal overlaps the hero's ring (`telegraphCover`: circle / cone / line / ring geometry) the ring
//    goes thinner (x0.5) and a quarter fainter (x0.75, ~0.26), smoothed over 0.2 s, so the telegraph's fill stays the loudest thing on the ground;
//    the chevron is a 0.8 m mark over the head, never on a decal's edge or fill;
//  - skill VFX do not wash it out: it draws after the VFX batches (renderOrder 900, the hero rim / x-ray overlays follow at 980 / 981);
//  - the hero's own pixels win: the beacon is stencil-masked with the hero mask of render/heroOutline.ts (stencil 1, the same one the
//    x-ray uses), so it never paints over the hero's body;
//  - never links mid-run: ONE material (`up:FEEL-01:beacon`, no defines: a quality-tier change does not relink it), created with the rings,
//    in the scene for the load-time warm-up (RenderWorld.warmupAsync compiles and draws every drawable once); one instanced draw
//    carries every hero's ring and chevron (+1 draw in total, the plan's documented exception).

/** a creature this close (m) to the hero's feet counts towards the crowd */
export const BEACON_NEAR = 3;
/** weighted crowd that arms the beacon / the (lower) weight below which it may switch off again (hysteresis against flicker) */
export const BEACON_ON = 6;
export const BEACON_OFF = 4;
/**
 * Debounce (critic round 1: a warrior's knockback pushes the crowd across the 6 / 4 band and the marker blinked 18-24 times a minute):
 * the crowd must hold >= BEACON_ON for BEACON_ARM s before it switches on; once on it stays at least BEACON_HOLD s, and it only goes off
 * after the crowd has stayed below BEACON_OFF for BEACON_DROP s in a row. The 0.25 s fades are kept on top of this.
 */
export const BEACON_ARM = 0.5;
export const BEACON_HOLD = 3;
export const BEACON_DROP = 2;
/**
 * A late-run signal: the hero is only "lost" when the world is full. Fewer live CREATURES (metin rows do not count) in the whole feed and the
 * beacon does not arm (BEACON_WORLD_ON) / switches off (below BEACON_WORLD_OFF while on). Yeonmu 1:00-1:40 has 39-45 creatures (a warrior in
 * a small pack lit the beacon on 21-44 % of the frames there, round 1 critic); the 250-500 of the late run and even the 86 of Suryeon at
 * 3:45 clear it. A boss / king (eliteTier 3) on the hero bypasses the gate: a giant standing on the hero hides it in an empty arena too.
 */
export const BEACON_WORLD_ON = 60;
export const BEACON_WORLD_OFF = 40;
/** seconds to fade in / out */
export const BEACON_FADE = 0.25;
/** peak alpha of the beacon ring (the comet arcs of the look reach about 1.7x this, the gaps between them about 0.8x) */
export const BEACON_ALPHA = 0.35;
/** heroes with a beacon (a co-op party has at most 4) */
export const BEACON_MAX = 4;
/** the beacon ring has the hero ring's radius (render/world.ts adds the ground ring with 1.05) */
export const BEACON_RING_RADIUS = 1.05;
/**
 * Colours: 0 = the local hero (gold, the hero ring's own hue; the local hero is players[0] on every client), 1 = every other co-op hero
 * (one ally azure: "me = gold, allies = azure" reads the same on every screen and does not shift when a hero leaves and the slots re-index).
 */
export const BEACON_COLORS: readonly string[] = ['#ffcc33', '#5ec8ff'];
/**
 * The ground ring of every co-op ally: render/world.ts passes this colour with the 'hero' ring; `ringLook` swaps the red and blue channels of the
 * gold hero branch when it sees a blue-dominant colour (gold -> azure), so an ally has ONE colour on the ground and over the crowd (round 2 critic:
 * its ring stayed gold while its beacon was azure). The local hero's ring colour is the kind default (pale blue, ignored by the gold branch), which
 * is not blue-dominant enough (b / r < 4) to trigger the swap.
 */
export const BEACON_ALLY_HEX = BEACON_COLORS[1] as string;
/** a hero that moves further than this (m) between two frames is another hero (the party re-indexed): its beacon starts over */
export const BEACON_JUMP = 6;
/** chevron: half size (m) and height (m) of its centre above the ground at the hero's feet (hero ~2 m tall, so ~0.5 m above the head) */
const BEACON_CHEVRON_SIZE = 0.4;
const BEACON_CHEVRON_Y = 2.55;
/** draws after the VFX batches (<= 45) and the projectiles (<= ~60), so no skill sprite washes the ring / chevron out, and before the hero rim / x-ray overlays (980 / 981) and the damage numbers (1000) */
const BEACON_RENDER_ORDER = 900;
/** the beacon quad is the ring's radius x this (room for the glow) */
const BEACON_MARGIN = 1.3;
/** floats per instance: aP (x, z, size, kind) | aQ (plane h0, gx, gz, lift / anchor y) | aR (alpha, rgb) | aS (thin, seed, 0, 0) */
const BEACON_FLOATS = 16;
/** rows with this EnemyFlag bit are metin stones, not creatures (the crowd skips them too) */
const ENEMY_FLAG_METIN = 8;
/** the hero stencil value (render/heroOutline.ts HERO_STENCIL: the hero's own materials write it) */
const HERO_STENCIL_REF = 1;

/** the part of an EnemyFeed the density scan reads */
export interface CrowdFeed {
  readonly count: number;
  readonly x: ArrayLike<number>;
  readonly z: ArrayLike<number>;
  readonly flags?: ArrayLike<number>;
  readonly eliteTier?: ArrayLike<number>;
}

/**
 * Weighted crowd round (x, z): creatures within `radius` m count 1 each, a boss / king (eliteTier 3) counts as a whole crowd (BEACON_ON)
 * because a giant standing on the hero hides it as well as six small ones. Elites and champions (tier 1 / 2: the pack leaders of the
 * Yeonmu / Suryeon packs from 0:00, scale x1.12) are one creature each. Metin rows are not creatures. Stops as soon as `stopAt` is
 * reached (the caller only needs "enough or not"). `bossOnly` counts the tier-3 rows alone (the world is not full: only a giant lights it).
 */
export function crowdAround(feed: CrowdFeed, x: number, z: number, radius: number = BEACON_NEAR, stopAt = Infinity, bossOnly = false): number {
  const r2 = radius * radius;
  const xs = feed.x;
  const zs = feed.z;
  const flags = feed.flags;
  const tier = feed.eliteTier;
  const n = feed.count;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - x;
    if (dx > radius || dx < -radius) continue;
    const dz = (zs[i] as number) - z;
    if (dx * dx + dz * dz > r2) continue;
    if (flags && ((flags[i] as number) & ENEMY_FLAG_METIN) !== 0) continue;
    const boss = tier !== undefined && (tier[i] as number) >= 3;
    if (bossOnly && !boss) continue;
    sum += boss ? BEACON_ON : 1;
    if (sum >= stopAt) return sum;
  }
  return sum;
}

/**
 * Creature rows of the feed (metin rows excluded), counting stops at `stopAt`: the world gate only needs "full or not", so a full world is
 * answered after about `stopAt` rows. (The attempt-1 gate used `count`, which includes the metin rows: a boss on the hero with 55 creatures
 * and 6 metins alive passed it, with 55 and none did not.)
 */
export function creatureRows(feed: CrowdFeed, stopAt = Infinity): number {
  const flags = feed.flags;
  const n = feed.count;
  if (!flags) return Math.min(n, stopAt);
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (((flags[i] as number) & ENEMY_FLAG_METIN) !== 0) continue;
    if (++c >= stopAt) return c;
  }
  return c;
}

/** the part of a TelegraphFeed the overlap test reads */
export interface CoverFeed {
  readonly count: number;
  readonly shape: ArrayLike<number>;
  readonly x: ArrayLike<number>;
  readonly z: ArrayLike<number>;
  readonly rot: ArrayLike<number>;
  readonly radius: ArrayLike<number>;
  readonly length: ArrayLike<number>;
  readonly width: ArrayLike<number>;
}

/**
 * 1 when a telegraph decal overlaps the ring of radius `r` round (x, z), else 0 (circle: its disc, ring: the annulus, cone: the sector,
 * line: the rectangle from its origin along its yaw; the same geometry as render/fx/decalGrid.ts telegraphRect / decalWorld).
 */
export function telegraphCover(tg: CoverFeed | null | undefined, x: number, z: number, r: number): number {
  if (!tg) return 0;
  for (let i = 0; i < tg.count; i++) {
    const dx = x - (tg.x[i] as number);
    const dz = z - (tg.z[i] as number);
    const shape = tg.shape[i] as number;
    const radius = tg.radius[i] as number;
    if (shape === TG_CIRCLE) {
      const reach = radius + r;
      if (dx * dx + dz * dz <= reach * reach) return 1;
    } else if (shape === TG_RING) {
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d <= radius + r && d >= (tg.length[i] as number) - r) return 1;
    } else {
      // decal-local: lx = right, lz = forward (yaw 0 faces +Z); decalWorld: x = ox + c*lx + s*lz, z = oz - s*lx + c*lz
      const rot = tg.rot[i] as number;
      const s = Math.sin(rot);
      const c = Math.cos(rot);
      const lz = dx * s + dz * c;
      const lx = dx * c - dz * s;
      if (shape === TG_LINE) {
        if (lz >= -r && lz <= (tg.length[i] as number) + r && Math.abs(lx) <= (tg.width[i] as number) * 0.5 + r) return 1;
      } else {
        const d = Math.sqrt(lx * lx + lz * lz);
        if (d > radius + r) continue;
        if (d <= r) return 1;
        const half = (tg.width[i] as number) * 0.5;
        // angular distance to the axis, widened by the angle the ring's own radius spans at this distance
        if (Math.atan2(Math.abs(lx), lz) <= half + Math.asin(Math.min(1, r / d))) return 1;
      }
    }
  }
  return 0;
}

/** One hero's beacon: the target (`near` crowd, `coverTarget`) is set each frame, `stepBeacon` moves the faded values. */
export interface BeaconState {
  on: boolean;
  /** 0..1, linear in time (0.25 s end to end) */
  fade: number;
  /** 0..1 telegraph overlap, smoothed over 0.2 s */
  cover: number;
  x: number;
  z: number;
  rot: number;
  alive: boolean;
  /** `beacon()` was called for this slot since the last update */
  seen: boolean;
  near: number;
  coverTarget: number;
  /** s the crowd has held >= BEACON_ON while the beacon is off (debounce of the switch-on) */
  arm: number;
  /** s since the beacon went on (the minimum on-time) */
  held: number;
  /** s the crowd has stayed below BEACON_OFF in a row while the beacon is on (debounce of the switch-off) */
  drop: number;
}

export const newBeaconState = (): BeaconState => ({ on: false, fade: 0, cover: 0, x: 0, z: 0, rot: 0, alive: false, seen: false, near: 0, coverTarget: 0, arm: 0, held: 0, drop: 0 });

/**
 * Advances one beacon by `dt`. Off -> on once the crowd has held >= BEACON_ON for BEACON_ARM s; on -> off once BEACON_HOLD s have passed
 * AND the crowd has stayed below BEACON_OFF for BEACON_DROP s in a row (a melee scrum that surges across the band keeps it on instead of
 * blinking); a hero that is gone or dead drops it at once. Linear fade of BEACON_FADE s either way.
 */
export function stepBeacon(b: BeaconState, dt: number): void {
  if (!(b.alive && b.seen)) {
    b.on = false;
    b.arm = 0;
    b.held = 0;
    b.drop = 0;
  } else if (b.on) {
    b.held += dt;
    b.drop = b.near < BEACON_OFF ? b.drop + dt : 0;
    if (b.held >= BEACON_HOLD && b.drop >= BEACON_DROP) {
      b.on = false;
      b.arm = 0;
    }
  } else {
    b.arm = b.near >= BEACON_ON ? b.arm + dt : 0;
    if (b.arm >= BEACON_ARM) {
      b.on = true;
      b.held = 0;
      b.drop = 0;
    }
  }
  const k = dt / BEACON_FADE;
  b.fade = b.on ? Math.min(1, b.fade + k) : Math.max(0, b.fade - k);
  const ck = dt / 0.2;
  b.cover += Math.max(-ck, Math.min(ck, b.coverTarget - b.cover));
  b.seen = false;
}

const smooth01 = (t: number): number => t * t * (3 - 2 * t);

/**
 * ring alpha: BEACON_ALPHA at full fade, 75 % of it (~0.26) where a telegraph overlaps. Round 1 had 55 % (0.19) and the ring vanished in
 * the 47-62 % of dense frames that carry a telegraph; the telegraph still wins by the thinner line (beaconThin) and by its own fill.
 */
export function beaconAlpha(fade: number, cover: number): number {
  return BEACON_ALPHA * smooth01(fade) * (1 - 0.25 * cover);
}

/** ring line weight (1 = normal, 0.5 where a telegraph overlaps) */
export function beaconThin(cover: number): number {
  return 1 - 0.5 * cover;
}

/**
 * Writes one instance per visible ring (and chevron when `chevron`) into `out` (BEACON_FLOATS each) for the beacons with any fade left;
 * returns the instance count. `colors` = linear rgb per slot.
 */
export function writeBeaconInstances(
  states: readonly BeaconState[],
  chevron: boolean,
  heightAt: (x: number, z: number) => number,
  colors: ArrayLike<number>,
  out: Float32Array,
): number {
  let n = 0;
  for (let s = 0; s < states.length && s < BEACON_MAX; s++) {
    const b = states[s] as BeaconState;
    if (b.fade <= 0.002) continue;
    const seed = s * 1.7 + 0.3;
    const cr = colors[s * 3] as number;
    const cg = colors[s * 3 + 1] as number;
    const cb = colors[s * 3 + 2] as number;
    let o = n * BEACON_FLOATS;
    out[o] = b.x;
    out[o + 1] = b.z;
    out[o + 2] = BEACON_RING_RADIUS;
    out[o + 3] = 0;
    fitGroundPlane(heightAt, b.x, b.z, BEACON_RING_RADIUS, out, o + 4);
    out[o + 8] = beaconAlpha(b.fade, b.cover);
    out[o + 9] = cr;
    out[o + 10] = cg;
    out[o + 11] = cb;
    out[o + 12] = beaconThin(b.cover);
    out[o + 13] = seed;
    out[o + 14] = 0;
    out[o + 15] = 0;
    n++;
    if (chevron) {
      o = n * BEACON_FLOATS;
      out[o] = b.x;
      out[o + 1] = b.z;
      out[o + 2] = BEACON_CHEVRON_SIZE;
      out[o + 3] = 1;
      out[o + 4] = heightAt(b.x, b.z) + BEACON_CHEVRON_Y;
      out[o + 5] = 0;
      out[o + 6] = 0;
      out[o + 7] = 0;
      out[o + 8] = 0.92 * smooth01(b.fade);
      out[o + 9] = cr;
      out[o + 10] = cg;
      out[o + 11] = cb;
      out[o + 12] = 1;
      out[o + 13] = seed;
      out[o + 14] = 0;
      out[o + 15] = 0;
      n++;
    }
  }
  return n;
}

const BEACON_VERT = /* glsl */ `
attribute vec4 aP; // x, z, size (ring: radius, chevron: half size), kind (0 ring, 1 chevron)
attribute vec4 aQ; // ring: plane h0, gx, gz, lift | chevron: anchor y
attribute vec4 aR; // alpha, rgb
attribute vec4 aS; // thin, seed
uniform float uTime;
flat varying float vKind;
flat varying float vR;
flat varying float vA;
flat varying float vThin;
flat varying float vSeed;
flat varying vec3 vCol;
varying vec2 vL;
void main() {
  vKind = aP.w; vR = aP.z; vA = aR.x; vCol = aR.yzw; vThin = aS.x; vSeed = aS.y;
  vec3 wp;
  if (aP.w < 0.5) {
    vec2 l = position.xy * (aP.z * ${BEACON_MARGIN.toFixed(2)});
    vL = l;
    wp = vec3(aP.x + l.x, aQ.x + aQ.y * l.x + aQ.z * l.y + aQ.w, aP.y + l.y);
  } else {
    // camera-facing, screen-upright quad above the head
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vL = position.xy;
    wp = vec3(aP.x, aQ.x + 0.07 * sin(uTime * 3.2 + aS.y), aP.y) + right * (position.x * aP.z) + up * (position.y * aP.z);
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const BEACON_FRAG = /* glsl */ `
uniform float uTime;
flat varying float vKind;
flat varying float vR;
flat varying float vA;
flat varying float vThin;
flat varying float vSeed;
flat varying vec3 vCol;
varying vec2 vL;
float band(float x, float c, float hw, float aa) { hw = max(hw, aa); return 1.0 - smoothstep(hw - aa, hw + aa, abs(x - c)); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a; vec2 ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
void main() {
  const float TAU = 6.2831853;
  const vec3 DARK = vec3(0.03, 0.02, 0.0);
  const vec3 RIM = vec3(0.012, 0.02, 0.05);
  vec3 col;
  float a;
  if (vKind < 0.5) {
    // ---- ring: the hero ring's radius, a thin line with three bright comet arcs turning slowly (the click_select family) ----
    float r = length(vL);
    if (r > vR + 0.45) discard;
    float aa = max(fwidth(r), 1e-4) * 0.95;
    float ang = atan(vL.x, vL.y);
    float rc = vR - 0.1;
    float w = mix(0.03, 0.058, vThin);
    float cu = fract((ang / TAU - 0.16 * uTime + vSeed) * 3.0);
    float k = smoothstep(0.45, 0.92, cu) * (1.0 - smoothstep(0.92, 0.99, cu));
    float core = band(r, rc, w * (0.7 + 0.3 * k), aa);
    float side = r < rc ? 0.14 : 0.06;
    float glow = exp(-abs(r - rc) / side) * (0.25 + 0.55 * k) * vThin;
    float aC = clamp(core * mix(0.6, 1.0, k) + glow, 0.0, 1.0);
    float aU = band(r, rc, w * 3.2, aa) * 0.5;
    vec3 cC = mix(vCol, mix(vCol, vec3(1.0), 0.4), k);
    float aO = aC + aU * (1.0 - aC);
    col = (cC * aC + DARK * aU * (1.0 - aC)) / max(aO, 1e-4);
    a = aO * vA * (0.8 + 0.9 * k);
  } else {
    // ---- chevron: a small downward "v" over the head: white core, the hero's colour round it, a cool dark rim (reads on snow, gold elites and lava alike) ----
    vec2 p = vL * 1.15;
    float aa = max(fwidth(p.x), 1e-4);
    p.y += 0.05;
    float d = min(sdSeg(p, vec2(-0.78, 0.4), vec2(0.0, -0.32)), sdSeg(p, vec2(0.0, -0.32), vec2(0.78, 0.4)));
    float coreA = 1.0 - smoothstep(0.085 - aa, 0.085 + aa, d);
    float fillA = 1.0 - smoothstep(0.17 - aa, 0.17 + aa, d);
    float edgeA = (1.0 - smoothstep(0.27 - aa, 0.27 + aa, d)) * 0.85;
    vec3 c = mix(vCol, vec3(1.0), coreA * 0.88);
    float aO = fillA + edgeA * (1.0 - fillA);
    col = (c * fillA + RIM * edgeA * (1.0 - fillA)) / max(aO, 1e-4);
    a = aO * vA;
  }
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------------------------------------------
// System

const linearOf = (hex: string): Color => new Color(hex);

export class GroundRings implements RenderSystem {
  readonly name = 'groundRings';
  /** debug counters of the last update (`beacons` = heroes whose beacon has any fade left) */
  readonly stats = { added: 0, small: 0, large: 0, dropped: 0, beacons: 0 };

  private readonly core: RenderCore;
  private readonly uniforms: Record<string, IUniform> = { uTime: { value: 0 } };
  private readonly defaults: Float32Array = new Float32Array(6 * 3);
  private readonly colorCache = new Map<string, Float32Array>();
  private cap: number;
  // pending adds
  private px!: Float32Array;
  private pz!: Float32Array;
  private pr!: Float32Array;
  private pk!: Uint8Array;
  /** hero facing as a kind fraction (0..0.4) */
  private pf!: Float32Array;
  private ps!: Float32Array;
  private pc!: Float32Array;
  private pcount = 0;
  private overflow = 0;
  private pmax = 0;
  // selection scratch
  private d2!: Float32Array;
  private idx!: Int32Array;
  private slotOf!: Int32Array;
  // small path
  private smallGeom!: InstancedBufferGeometry;
  private smallBuf!: InstancedInterleavedBuffer;
  private smallData!: Float32Array;
  private readonly smallMat: ShaderMaterial;
  private smallMesh!: Mesh;
  // large path
  private grid!: DecalGrid;
  private readonly unsub: () => void;
  // FEEL-01 hero beacon: ONE instanced draw (every hero's ring + chevron), independent of the quality caps (never rebuilt)
  private readonly beaconMat: ShaderMaterial;
  private readonly beaconGeom: InstancedBufferGeometry;
  private readonly beaconBuf: InstancedInterleavedBuffer;
  private readonly beaconData = new Float32Array(BEACON_MAX * 2 * BEACON_FLOATS);
  private readonly beaconMesh: Mesh;
  private readonly beacons: BeaconState[] = Array.from({ length: BEACON_MAX }, newBeaconState);
  private readonly beaconColors = new Float32Array(BEACON_MAX * 3);
  /** instances written by the last update (0 = the mesh is hidden) */
  private beaconShown = 0;
  /** DEV QA switch `?up=nobeacon` (the control arm of before / after pairs); also settable from a dev eval (`rings.beaconOff = true`) */
  beaconOff = import.meta.env.DEV && typeof location !== 'undefined' && /[?&]up=[^&]*\bnobeacon\b/.test(location.search);

  constructor(core: RenderCore) {
    this.core = core;
    (Object.keys(RING_DEFAULT_COLOR) as RingKind[]).forEach((k) => {
      const c = linearOf(RING_DEFAULT_COLOR[k]);
      const o = (RING_KIND_INDEX[k] as number) * 3;
      this.defaults[o] = c.r;
      this.defaults[o + 1] = c.g;
      this.defaults[o + 2] = c.b;
    });
    this.smallMat = new ShaderMaterial({
      uniforms: this.uniforms,
      defines: core.quality.tier === 'low' ? { LOW: 1 } : {},
      vertexShader: SMALL_VERT,
      fragmentShader: SMALL_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: NormalBlending,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.cap = core.quality.profile.decalCap * 2;
    this.build(this.cap, core.quality.profile.decalCap);
    this.unsub = core.quality.onChange((p) => this.onQuality(p));

    // FEEL-01: the beacon material is created with the rings (no defines: a tier change never relinks it) and its mesh sits in the
    // scene from the start, so RenderWorld.warmupAsync compiles and draws it under the loading screen
    this.beaconMat = new ShaderMaterial({
      name: 'up:FEEL-01:beacon',
      uniforms: this.uniforms,
      vertexShader: BEACON_VERT,
      fragmentShader: BEACON_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: NormalBlending,
      side: DoubleSide,
    });
    // never over the hero's own pixels: the hero's materials write stencil 1 (render/heroOutline.ts markHeroStencil), the x-ray skips them the same way
    this.beaconMat.stencilWrite = true; // enables the stencil test; the ops keep the buffer untouched
    this.beaconMat.stencilRef = HERO_STENCIL_REF;
    this.beaconMat.stencilFunc = NotEqualStencilFunc;
    this.beaconMat.stencilFail = KeepStencilOp;
    this.beaconMat.stencilZFail = KeepStencilOp;
    this.beaconMat.stencilZPass = KeepStencilOp;
    for (let s = 0; s < BEACON_MAX; s++) {
      const c = linearOf(BEACON_COLORS[s === 0 ? 0 : 1] ?? BEACON_COLORS[0]!);
      this.beaconColors[s * 3] = c.r;
      this.beaconColors[s * 3 + 1] = c.g;
      this.beaconColors[s * 3 + 2] = c.b;
    }
    const quad = new BufferGeometry();
    quad.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    const bg = new InstancedBufferGeometry();
    bg.setAttribute('position', quad.getAttribute('position'));
    bg.setIndex([0, 1, 2, 0, 2, 3]);
    this.beaconBuf = new InstancedInterleavedBuffer(this.beaconData, BEACON_FLOATS, 1);
    this.beaconBuf.setUsage(35048);
    bg.setAttribute('aP', new InterleavedBufferAttribute(this.beaconBuf, 4, 0));
    bg.setAttribute('aQ', new InterleavedBufferAttribute(this.beaconBuf, 4, 4));
    bg.setAttribute('aR', new InterleavedBufferAttribute(this.beaconBuf, 4, 8));
    bg.setAttribute('aS', new InterleavedBufferAttribute(this.beaconBuf, 4, 12));
    // one zeroed instance while idle (size 0 = nothing rasterised): the warm-up frames show the hidden mesh and draw it once
    bg.instanceCount = 1;
    quad.dispose();
    this.beaconGeom = bg;
    this.beaconMesh = new Mesh(bg, this.beaconMat);
    this.beaconMesh.frustumCulled = false;
    // over the enemies AND the skill VFX that pile up on a hero in a crowd (VFX <= 45, projectiles <= ~60); telegraphs keep priority by
    // alpha (`telegraphCover`: thinner and fainter where a telegraph overlaps), not by draw order
    this.beaconMesh.renderOrder = BEACON_RENDER_ORDER;
    this.beaconMesh.name = 'groundBeacon';
    this.beaconMesh.visible = false;
    core.scene.add(this.beaconMesh);
  }

  /**
   * Queue a ring for this frame. `radius` = outer radius (m). `strength` scales intensity (0..1.5).
   * `colorHex` overrides the kind's default colour (rune colour for metins).
   */
  add(x: number, z: number, radius: number, kind: RingKind, strength = 1, colorHex?: string, facing = 0): void {
    const i = this.pcount;
    if (i >= this.pmax) {
      this.overflow++;
      return;
    }
    const k = RING_KIND_INDEX[kind];
    this.px[i] = x;
    this.pz[i] = z;
    this.pr[i] = radius;
    // hero facing rides in the kind's fraction (see the hero branch of `ringLook`)
    this.pk[i] = k;
    this.pf[i] = kind === 'hero' ? (MathUtils.euclideanModulo(facing, Math.PI * 2) / (Math.PI * 2)) * 0.4 : 0;
    this.ps[i] = strength;
    const o = i * 3;
    if (colorHex !== undefined) {
      let c = this.colorCache.get(colorHex);
      if (!c) {
        const col = linearOf(colorHex);
        c = new Float32Array([col.r, col.g, col.b]);
        this.colorCache.set(colorHex, c);
      }
      this.pc[o] = c[0] as number;
      this.pc[o + 1] = c[1] as number;
      this.pc[o + 2] = c[2] as number;
    } else {
      this.pc[o] = this.defaults[k * 3] as number;
      this.pc[o + 1] = this.defaults[k * 3 + 1] as number;
      this.pc[o + 2] = this.defaults[k * 3 + 2] as number;
    }
    this.pcount = i + 1;
  }

  update(dt: number, _alpha?: number): void {
    const n = this.pcount;
    this.pcount = 0;
    const rig = this.core.rig;
    const fx = rig.focus.x;
    const fz = rig.focus.z;
    const heightAt = this.core.heightAt;
    this.uniforms.uTime!.value = this.core.clock.time;
    this.stats.added = n;
    this.stats.dropped = this.overflow;
    this.overflow = 0;

    // visible candidates → nearest `cap`
    let m = 0;
    for (let i = 0; i < n; i++) {
      const r = this.pr[i] as number;
      if (r <= 0.01) continue;
      const x = this.px[i] as number;
      const z = this.pz[i] as number;
      if (!rig.isVisible(x, z, r * QUAD_MARGIN)) continue;
      const dx = x - fx;
      const dz = z - fz;
      this.d2[m] = dx * dx + dz * dz;
      this.idx[m] = i;
      m++;
    }
    const keep = selectClosest(this.d2, this.idx, m, this.cap);

    const slots = this.grid.slots;
    slots.begin();
    let ns = 0;
    let nl = 0;
    const sd = this.smallData;
    const ex = this.grid.extra;
    const slotOf = this.slotOf;
    // large rings: match against last frame's slots first, then create the rest
    for (let k = 0; k < keep; k++) {
      const i = this.idx[k] as number;
      const r = this.pr[i] as number;
      slotOf[k] = r > SMALL_RADIUS ? slots.match(this.pk[i] as number, 0, this.px[i] as number, this.pz[i] as number, 0, r, 0, 0, this.ps[i] as number) : -2;
    }
    for (let k = 0; k < keep; k++) {
      if (slotOf[k] !== -1) continue;
      const i = this.idx[k] as number;
      slotOf[k] = slots.create(this.pk[i] as number, 0, this.px[i] as number, this.pz[i] as number, 0, this.pr[i] as number, 0, 0, this.ps[i] as number);
      if (slotOf[k] === -1) this.stats.dropped++;
    }
    for (let k = 0; k < keep; k++) {
      const i = this.idx[k] as number;
      const s = slotOf[k] as number;
      const c = i * 3;
      if (s >= 0) {
        ex[s * 4] = this.pc[c] as number;
        ex[s * 4 + 1] = this.pc[c + 1] as number;
        ex[s * 4 + 2] = this.pc[c + 2] as number;
        ex[s * 4 + 3] = 1;
        nl++;
      } else if (s === -2) {
        const o = ns * FLOATS;
        const x = this.px[i] as number;
        const z = this.pz[i] as number;
        const r = this.pr[i] as number;
        sd[o] = x;
        sd[o + 1] = z;
        sd[o + 2] = r;
        sd[o + 3] = (this.pk[i] as number) + (this.pf[i] as number);
        fitGroundPlane(heightAt, x, z, r, sd, o + 4);
        sd[o + 8] = this.ps[i] as number;
        sd[o + 9] = this.pc[c] as number;
        sd[o + 10] = this.pc[c + 1] as number;
        sd[o + 11] = this.pc[c + 2] as number;
        ns++;
      }
    }
    slots.end(dt);
    this.grid.commit(heightAt);

    this.smallBuf.clearUpdateRanges();
    this.smallBuf.addUpdateRange(0, ns * FLOATS);
    this.smallBuf.needsUpdate = true;
    this.smallGeom.instanceCount = ns;
    this.smallMesh.visible = ns > 0;
    this.stats.small = ns;
    this.stats.large = nl;
    this.updateBeacons(dt);
  }

  /**
   * FEEL-01: reports hero `slot` (0 = the local hero) for this frame: while >= BEACON_ON creatures are within BEACON_NEAR m of it (the scan
   * stops at the threshold), its ring is drawn a second time over the crowd. Call once per hero per frame before `update()`; a hero that is
   * not reported (left, run cleared) or reported `alive = false` fades out. `enemies` / `telegraphs` are the frame's feeds.
   */
  beacon(slot: number, x: number, z: number, facing: number, enemies: CrowdFeed | null | undefined, telegraphs: CoverFeed | null | undefined, alive: boolean): void {
    if (this.beaconOff || slot < 0 || slot >= BEACON_MAX) return;
    const b = this.beacons[slot] as BeaconState;
    // the party re-indexed (a hero left and this slot now belongs to another one) or the hero was teleported: start over instead of
    // carrying the previous hero's fade and debounce timers over (also during the 0.5 s arm, round 2 critic: only a visible beacon was reset)
    if ((b.alive || b.fade > 0) && (x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) > BEACON_JUMP * BEACON_JUMP) Object.assign(b, newBeaconState());
    b.seen = true;
    b.alive = alive;
    b.x = x;
    b.z = z;
    b.rot = facing;
    // the world gate counts creature rows (metin rows excluded); a boss on the hero passes it whatever the count
    const gate = b.on ? BEACON_WORLD_OFF : BEACON_WORLD_ON;
    b.near = alive && enemies ? crowdAround(enemies, x, z, BEACON_NEAR, b.on ? BEACON_OFF : BEACON_ON, creatureRows(enemies, gate) < gate) : 0;
    // telegraphs only matter while the beacon shows (or is about to)
    b.coverTarget = alive && (b.fade > 0 || b.near >= BEACON_ON) ? telegraphCover(telegraphs, x, z, BEACON_RING_RADIUS) : 0;
  }

  /** Drops every hero's beacon at once (run end / a new run: nothing may fade out over the next run's first frames). */
  clearBeacons(): void {
    for (let i = 0; i < BEACON_MAX; i++) Object.assign(this.beacons[i] as BeaconState, newBeaconState());
  }

  /** Call when the terrain under live large rings changed without swapping `core.heightAt` (a swap is detected automatically). */
  invalidateTerrain(): void {
    this.grid.invalidate();
  }

  dispose(): void {
    this.unsub();
    this.teardown();
    this.smallMat.dispose();
    this.core.scene.remove(this.beaconMesh);
    this.beaconGeom.dispose();
    this.beaconMat.dispose();
  }

  // -------------------------------------------------------------------------------------------------------------

  private build(cap: number, decalCap: number): void {
    this.pmax = cap * 2;
    this.px = new Float32Array(this.pmax);
    this.pz = new Float32Array(this.pmax);
    this.pr = new Float32Array(this.pmax);
    this.pk = new Uint8Array(this.pmax);
    this.pf = new Float32Array(this.pmax);
    this.ps = new Float32Array(this.pmax);
    this.pc = new Float32Array(this.pmax * 3);
    this.d2 = new Float32Array(this.pmax);
    this.idx = new Int32Array(this.pmax);
    this.slotOf = new Int32Array(this.pmax);

    const g = new InstancedBufferGeometry();
    const quad = new BufferGeometry();
    quad.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute('position', quad.getAttribute('position'));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.smallData = new Float32Array(cap * FLOATS);
    this.smallBuf = new InstancedInterleavedBuffer(this.smallData, FLOATS, 1);
    this.smallBuf.setUsage(35048);
    g.setAttribute('aP', new InterleavedBufferAttribute(this.smallBuf, 4, 0));
    g.setAttribute('aQ', new InterleavedBufferAttribute(this.smallBuf, 4, 4));
    g.setAttribute('aR', new InterleavedBufferAttribute(this.smallBuf, 4, 8));
    g.instanceCount = 0;
    quad.dispose();
    this.smallGeom = g;
    this.smallMesh = new Mesh(g, this.smallMat);
    this.smallMesh.frustumCulled = false;
    // above the telegraph decals (-20): the hero / elite markers stay readable inside enemy telegraphs
    this.smallMesh.renderOrder = -15;
    this.smallMesh.name = 'groundRingsSmall';
    this.smallMesh.visible = false;
    this.core.scene.add(this.smallMesh);

    this.grid = new DecalGrid({
      cap: Math.max(8, decalCap >> 2),
      rect: ringRect,
      fragmentShader: LARGE_FRAG,
      uniforms: this.uniforms,
      defines: this.core.quality.tier === 'low' ? { LOW: 1 } : {},
      renderOrder: -31,
      name: 'groundRingsLarge',
      slots: { fadeOut: 0.2, fadeIn: 0.15, monotonic: false, maxMove: 3 },
    });
    this.core.scene.add(this.grid.mesh);
  }

  /** Steps every beacon by `dt` and uploads the visible ones (ring + chevron on every tier); the mesh is hidden once nothing has any fade left. */
  private updateBeacons(dt: number): void {
    let active = 0;
    for (let i = 0; i < BEACON_MAX; i++) {
      const b = this.beacons[i] as BeaconState;
      stepBeacon(b, dt);
      if (b.fade > 0.002) active++;
    }
    this.stats.beacons = active;
    if (active === 0) {
      if (this.beaconShown > 0) {
        // back to the idle zeroed instance (the next warm-up frame must not draw a stale ring), uploaded once
        this.beaconData.fill(0, 0, BEACON_FLOATS);
        this.beaconGeom.instanceCount = 1;
        this.beaconBuf.clearUpdateRanges();
        this.beaconBuf.addUpdateRange(0, BEACON_FLOATS);
        this.beaconBuf.needsUpdate = true;
        this.beaconMesh.visible = false;
        this.beaconShown = 0;
      }
      return;
    }
    const n = writeBeaconInstances(this.beacons, true, this.core.heightAt, this.beaconColors, this.beaconData);
    this.beaconGeom.instanceCount = n;
    this.beaconBuf.clearUpdateRanges();
    this.beaconBuf.addUpdateRange(0, n * BEACON_FLOATS);
    this.beaconBuf.needsUpdate = true;
    this.beaconMesh.visible = n > 0;
    this.beaconShown = n;
  }

  private teardown(): void {
    this.core.scene.remove(this.smallMesh);
    this.core.scene.remove(this.grid.mesh);
    this.smallGeom.dispose();
    this.grid.dispose();
  }

  private onQuality(p: QualityProfile): void {
    const cap = p.decalCap * 2;
    const lite = p.tier === 'low';
    const liteChanged = (this.smallMat.defines.LOW === 1) !== lite;
    if (cap === this.cap && !liteChanged) return;
    this.cap = cap;
    this.teardown();
    if (liteChanged) {
      if (lite) this.smallMat.defines.LOW = 1;
      else delete this.smallMat.defines.LOW;
      this.smallMat.needsUpdate = true;
    }
    this.build(cap, p.decalCap);
  }
}

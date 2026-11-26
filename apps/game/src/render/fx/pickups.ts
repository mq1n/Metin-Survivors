// Pickup renderer: XP gems, yeop coins (tier 0 one coin, tiers 1-2 a heap of 3 / 6 coins of the same size), health potions, chests (3 tiers) and the magnet/vacuum orb.
// One instanced draw per FORGE `pickup` model (static meshes; skinned GLBs are drawn in bind pose), plus one additive

// light planes, vacuum vortex) and one contact-shadow batch. Bob / spin / spawn pop are done in the vertex shader from `age` + a position-derived phase, so instance buffers
// are rewritten only for rows that pass the camera-footprint test (and the per-tier cap, nearest-first).
import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix3,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  CustomBlending,
  ShaderMaterial,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import type { LoadedModel } from '../../engine/assets';
import type { RenderCore, RenderSystem } from '../core';
import { PICKUP_CHEST, PICKUP_MAGNET, PICKUP_POTION, PICKUP_XP, PICKUP_YEOP, type PickupFeed } from '../feed';
import type { QualityProfile, QualityTier } from '../quality';
import { nearestCutoff } from './projectiles';

// ------------------------------------------------------------------------------------------------------------------
// Model + visual tables (pure, unit-tested)
// ------------------------------------------------------------------------------------------------------------------

export interface PickupModelDef {
  /** stable key, also the order of the batches */
  key: 'xp' | 'yeop' | 'potion' | 'chest0' | 'chest1' | 'chest2' | 'yeop2' | 'yeop3';
  /** manifest model id (FORGE `pickup` kind) */
  id: string;
  /**
   * r8 K8 (opt-in): bake only this named node of the GLB (several rows can share ONE file, so its textures load and upload once: the
   * three yeop tiers are the nodes yeop_t0 / yeop_t1 / yeop_t2 of yeop_coin). Absent, or a GLB without that node = the whole scene.
   */
  node?: string;
  /** largest dimension of the model after normalisation (m) at scale 1; whatever the GLB's size */
  size: number;
  /** height of the model's base above the ground (m) */
  hover: number;
  /** vertical bob amplitude (m) and angular speed (rad/s) */
  bob: number;
  bobSpeed: number;
  /** yaw spin (rad/s) */
  spin: number;
  /** random yaw spread around +Z (rad): 2π = free-spinning, small = chest facing the camera */
  yaw: number;
  /** tilt wobble amplitude (rad) about world X/Z, pivoting at half the model size */
  wobble: number;
  /** shading: x gloss 0..1, y metalness 0..1, z emissive strength, w faceted (flat) normals */
  mat: readonly [number, number, number, number];
}

export const PICKUP_MODELS: readonly PickupModelDef[] = [
  { key: 'xp', id: 'xp_gem', size: 0.449, hover: 0.54, bob: 0.14, bobSpeed: 2.9, spin: 2.3, yaw: Math.PI * 2, wobble: 0.36, mat: [0.9, 0.0, 1.0, 1] },
  // r9 K9: ONE coin size for every yeop tier (the r8 judge MF6b): the tier-0 coin is 0.40 m (0.381 x tier scale 1.05; 0.525 m before r8,
  // 0.42 m in r8), the size of the smallest gem, 16 % thick, tilted back 52 deg in its node so the spin never shows it edge-on
  { key: 'yeop', id: 'yeop_coin', node: 'yeop_t0', size: 0.381, hover: 0.46, bob: 0.11, bobSpeed: 2.6, spin: 3.4, yaw: Math.PI * 2, wobble: 0.15, mat: [0.75, 0.85, 0.3, 0] },
  { key: 'potion', id: 'potion_hp', size: 0.64, hover: 0.32, bob: 0.09, bobSpeed: 2.5, spin: 1.8, yaw: Math.PI * 2, wobble: 0.16, mat: [0.85, 0.0, 0.62, 0] },
  { key: 'chest0', id: 'chest_wood', size: 1.05, hover: 0, bob: 0, bobSpeed: 0, spin: 0, yaw: 0.7, wobble: 0, mat: [0.3, 0.2, 0.1, 0] },
  { key: 'chest1', id: 'chest_gold', size: 1.2, hover: 0, bob: 0, bobSpeed: 0, spin: 0, yaw: 0.7, wobble: 0, mat: [0.35, 0.45, 0.18, 0] },
  // r5 ship 10-29: the Tripo wood-and-gilt boss chest: low gloss (the dark planks caught cool white streaks at 0.3+), metal 0.45 keeps the bronze-gold warm, emissive 0.06
  { key: 'chest2', id: 'chest_boss', size: 1.6, hover: 0, bob: 0, bobSpeed: 0, spin: 0, yaw: 0.7, wobble: 0, mat: [0.2, 0.45, 0.12, 0] },
  
  // the tier-0 coin's size (r8's 0.30 m heap coins read as pale washers at 16-18 px), at rest on the ground (one leaning on the others),
  // so no hover / bob / spin; the random yaw turns each heap. Nodes of the yeop_coin GLB (one albedo, one spec map for all three tiers);
  // sizes = the nodes' largest sides at 0.40 m per coin (1.62 / 2.24 coin diameters). Hover 0.04: the coins' faces stay above the floor
  // light pool (drawn at ground + 0.05 m), which otherwise washes them pale.
  { key: 'yeop2', id: 'yeop_coin', node: 'yeop_t1', size: 0.648, hover: 0.04, bob: 0, bobSpeed: 0, spin: 0, yaw: Math.PI * 2, wobble: 0, mat: [0.65, 1.0, 0.3, 0] },
  { key: 'yeop3', id: 'yeop_coin', node: 'yeop_t2', size: 0.894, hover: 0.04, bob: 0, bobSpeed: 0, spin: 0, yaw: Math.PI * 2, wobble: 0, mat: [0.65, 1.0, 0.3, 0] },
];

/**
 * r7 K7 (opt-in): a pickup GLB may carry its own shading in its scene extras, `pickupMat` = [gloss, metal, emissive, faceted] (the same
 * meaning as `PickupModelDef.mat`), so a model and the material it was tuned with ship as ONE file (the struck yeop coin with its
 * spec-masked dark field, the boss chest with matte planks under glossy gilt). Absent or malformed (every other shipped GLB) = the
 * table's `mat`, exactly as before.
 */
export function pickupMatOf(def: PickupModelDef, extras: unknown): PickupModelDef['mat'] {
  const m = (extras as { pickupMat?: unknown } | null | undefined)?.pickupMat;
  if (Array.isArray(m) && m.length === 4 && m.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 4)) {
    return [m[0] as number, m[1] as number, m[2] as number, m[3] as number];
  }
  return def.mat;
}

/** r8 K8: the part of a loaded pickup GLB a row bakes: its named node when the row has one and the GLB carries it, else the whole scene */
export function pickupRoot(scene: Object3D, def: PickupModelDef): Object3D {
  return (def.node ? scene.getObjectByName(def.node) : undefined) ?? scene;
}

/**
 * XP gem tier colours: blue, green, violet, gold, diamond-white (sRGB hex). No orange / red / magenta: loot must never
 * share the fire-zone ground or the crimson hostile-projectile hues.
 */
export const XP_TIER_HEX: readonly string[] = ['#33b4ff', '#3fe36a', '#a86bff', '#ffd84a', '#eef2ff'];
/** pickups read from the 55 degree camera at 12-20 px: gems ~1.25x the old size (audit gap 4) */
export const XP_TIER_SCALE: readonly number[] = [1.0, 1.14, 1.3, 1.5, 1.72];
const YEOP_TIER_SCALE: readonly number[] = [1.05, 1.3, 1.62];
/** yeop model per tier: tier 0 the single coin, tiers 1 and 2 the heaps (drawn at their own size, scale 1) */
const YEOP_TIER_KEY: readonly PickupModelDef['key'][] = ['yeop', 'yeop2', 'yeop3'];
/**
 * Strength of the small halo of the yeop rows (multiplies the star row's colour; the floor pool and its ring keep the full glow).
 * The struck coin has a near-black field under gold relief: a full-strength halo, drawn in front of the coin, washed that field
 * to ochre (r6 K6 critic). The cross glints are 72 % white, so they change by less than 12 %.
 */
// r9 K9: 0.25 (was 0.45): the 0.40 m coin of every tier sits deeper in the halo quad than the 0.5 m coin it was tuned with; at 0.45
// its near-black field still lifted toward ochre at z16-22
export const YEOP_HALO = 0.25;

export const GLOW_STAR = 0;
export const GLOW_STREAK = 1;
export const GLOW_BEAM = 2;
export const GLOW_VORTEX = 3;

export const GLOW_POOL = 4;

/**
 * Chest light plane (PICK-01): the column's silhouette and fall-off, shared by the shader (interpolated into GLOW_FRAG) and by
 * `chestBeamProfile` (its pure mirror, unit-tested). The beam is a soft ADDITIVE column: a plane's contribution is a product of
 * non-negative factors and is blended One / OneMinusSrcAlpha with alpha 0, so it can only add light, never darken what is behind it
 * (the dark spear-shaped window of the r3b chest sheets was the chest drawn before its planes, see PICKUP_BEAM_ORDER).
 */
/** half width of the column at its top, as a fraction of its half width at the foot (it narrows, but is no needle) */
export const BEAM_TOP_WIDTH = 0.42;
/** exponent of the taper (smaller = the column keeps its width higher up) */
export const BEAM_TAPER_POW = 0.7;
/** where the soft edge starts (fraction of the local half width): inside it the column is at full strength */
export const BEAM_EDGE_START = 0.12;
/** low quality renders straight to the canvas (no HDR target, no tone map): the planes are damped there so they stay a soft column */
export const BEAM_DIRECT_GAIN = 0.62;

const smooth01 = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Strength of a chest light plane at plane-local (x, y): x in [-1, 1] across the plane (1 = the plane's half width at the foot), y in
 * [0, 1] up the beam. Mirrors GLOW_FRAG's `prof * vert`; always within [0, 1] (never negative, so the plane never darkens).
 */
export function chestBeamProfile(x: number, y: number): number {
  const ax = Math.abs(x);
  const yy = Math.min(1, Math.max(0, y));
  const w = 1 + (BEAM_TOP_WIDTH - 1) * Math.pow(yy, BEAM_TAPER_POW);
  const u = Math.min(1, ax / w);
  const prof = Math.pow(1 - smooth01(BEAM_EDGE_START, 1, u), 1.4);
  const vert = Math.pow(1 - yy, 1.1) * smooth01(0, 0.07, yy);
  return prof * vert;
}

export interface PickupVisual {
  /** index into PICKUP_MODELS */
  model: number;
  scale: number;
  /** linear tint multiplied into the vertex colours */
  tint: readonly [number, number, number];
  /** per-instance emissive multiplier */
  emissive: number;
  /** linear glow colour (intensity folded in) */
  glow: readonly [number, number, number];
  /** small halo strength: multiplies `glow` on the star row only (the floor pool keeps `glow`); 1 = the full halo */
  halo: number;
  /** glow quad size (m) */
  glowSize: number;
  /** 0..1 twinkle strength */
  sparkle: number;
  /** GLOW_STAR or GLOW_VORTEX */
  glowType: number;
  /** chest light beam: height and width (m), 0 = none */
  beamHeight: number;
  beamWidth: number;
  /** contact-shadow radius (m) */
  shadow: number;
  
  glint: number;
  /** ground light pool radius (m), 0 = none */
  pool: number;
  /** pool strength multiplier */
  poolInt: number;
  
  ring: boolean;
}

const tmpC = new Color();
function lin(hex: string, k = 1): [number, number, number] {
  tmpC.set(hex);
  return [tmpC.r * k, tmpC.g * k, tmpC.b * k];
}

const KIND_STRIDE = 8;

/** `kind * 8 + tier` → visual. Tiers beyond the defined range clamp to the highest. */
export function buildPickupVisuals(): PickupVisual[] {
  const out: PickupVisual[] = [];
  const set = (kind: number, tier: number, v: PickupVisual): void => {
    out[kind * KIND_STRIDE + tier] = v;
  };
  const base = (m: number): PickupVisual => ({
    model: m,
    scale: 1,
    tint: [1, 1, 1],
    emissive: 1,
    glow: [1, 1, 1],
    halo: 1,
    glowSize: 1,
    sparkle: 0,
    glowType: GLOW_STAR,
    beamHeight: 0,
    beamWidth: 0,
    shadow: 0.2,
    glint: 0.3,
    pool: 0.9,
    poolInt: 0.7,
    ring: false,
  });
  
  // warm light pool on the floor. `glowSize` is the quad that has to hold the halo + the glints (about 4.2 glint half-sizes).
  for (let t = 0; t < XP_TIER_HEX.length; t++) {
    const sc = XP_TIER_SCALE[t] as number;
    const gl = 0.54 + 0.08 * t;
    set(PICKUP_XP, t, {
      ...base(0),
      scale: sc,
      tint: lin(XP_TIER_HEX[t] as string, 1.0),
      emissive: 1.15 + 0.14 * t,
      // the diamond tier's pale-white light goes lilac: white-on-white halos turn into milky blobs on snow
      glow: lin(t === 4 ? '#b4bcff' : (XP_TIER_HEX[t] as string), 1.05),
      glowSize: gl * 4.2,
      sparkle: 1,
      shadow: 0.22 * sc,
      glint: gl,
      pool: 1.05 + 0.16 * t,
      poolInt: Math.min(0.48 + 0.08 * t, 0.68),
      ring: t >= 1,
    });
  }
  for (let t = 0; t < YEOP_TIER_SCALE.length; t++) {
    const sc = YEOP_TIER_SCALE[t] as number;
    const gl = 0.6 + 0.1 * t;
    // tier 0 is the single spinning coin (scaled); the heaps of tiers 1-2 are drawn at their own size
    const model = PICKUP_MODELS.findIndex((m) => m.key === YEOP_TIER_KEY[t]);
    set(PICKUP_YEOP, t, {
      ...base(model), scale: t === 0 ? sc : 1, emissive: 1.15, glow: lin('#ffcb42', 0.86), halo: YEOP_HALO, glowSize: gl * 4.2, sparkle: 1,
      shadow: 0.22 * sc, glint: gl, pool: 1.15 + 0.22 * t, poolInt: 0.68, ring: true,
    });
  }
  set(PICKUP_POTION, 0, { ...base(2), scale: 1.25, glow: lin('#ff4a5c', 0.92), glowSize: 2.3, sparkle: 0.9, shadow: 0.32, glint: 0.64, pool: 1.25, poolInt: 0.78, ring: true });
  set(PICKUP_CHEST, 0, {
    ...base(3), glow: lin('#ffe0a0', 0.78), glowSize: 3.8, sparkle: 1, beamHeight: 4.6, beamWidth: 1.9, shadow: 0.64, glint: 0.95, pool: 1.4, poolInt: 0.62, ring: true,
  });
  set(PICKUP_CHEST, 1, {
    ...base(4), glow: lin('#ffcb3d', 0.95), glowSize: 4.4, sparkle: 1, beamHeight: 6.0, beamWidth: 2.2, shadow: 0.72, glint: 1.1, pool: 1.65, poolInt: 0.68, ring: true,
  });
  set(PICKUP_CHEST, 2, {
    ...base(5), glow: lin('#ffa040', 1.05), glowSize: 5.5, sparkle: 1, beamHeight: 8.0, beamWidth: 2.6, shadow: 0.96, glint: 1.3, pool: 2.0, poolInt: 0.72, ring: true,
  });
  set(PICKUP_MAGNET, 0, {
    ...base(0),
    scale: 1.8,
    tint: lin('#5cc8ff', 1.0),
    emissive: 1.15,
    glow: lin('#38a4ff', 0.95),
    glowSize: 2.6,
    sparkle: 1,
    glowType: GLOW_VORTEX,
    shadow: 0.42,
    glint: 0.7,
    pool: 2.6,
    poolInt: 0.9,
    ring: true,
  });
  return out;
}

/** Visual for a feed row. Unknown kinds fall back to the tier-0 XP gem; tiers clamp to what the kind defines. */
export function pickupVisual(table: readonly PickupVisual[], kind: number, tier: number): PickupVisual {
  const k = kind >= 0 && kind <= PICKUP_MAGNET ? kind : PICKUP_XP;
  let t = tier > 0 ? Math.floor(tier) : 0;
  if (t >= KIND_STRIDE) t = KIND_STRIDE - 1;
  for (; t >= 0; t--) {
    const v = table[k * KIND_STRIDE + t];
    if (v) return v;
  }
  return table[0] as PickupVisual;
}

/** Max pickups drawn per quality tier (sim cap is 1200); farthest rows are dropped first. */
export const PICKUP_CAP_BY_TIER: Record<QualityTier, number> = { low: 500, medium: 800, high: 1200, ultra: 1200 };

export interface BakedPickupGeometry {
  position: Float32Array;
  normal: Float32Array;
  /** linear rgb vertex colours (material colour folded in) */
  color: Float32Array;
  index: Uint16Array | Uint32Array;
  /** extents after normalisation */
  width: number;
  height: number;
  depth: number;
  /**
   * Texture path (E1, forge-audit plan): present only when a mesh of the model carries a base-colour map and TEXCOORD_0. `uv` is
   * TEXCOORD_0 of every baked vertex and `map` the first map found. Models without a map (every shipped forge model today) leave
   * both undefined and keep the vertex-colour path unchanged. One map per model: it is bound once per model batch (one draw each).
   */
  uv?: Float32Array;
  map?: Texture;
  /**
   * Emissive-map path (r7 K7, the boss chest's ember eyes and ruby): present only on the texture path, when the mesh that carries
   * `map` also has an emissive map (same TEXCOORD_0). `emisCol` = the material's emissive colour x emissiveIntensity (glTF
   * emissiveFactor x KHR_materials_emissive_strength), linear. Models without one leave both undefined (shader unchanged).
   */
  emisMap?: Texture;
  emisCol?: [number, number, number];
}

const _v = new Vector3();
const _n = new Vector3();
const _nm = new Matrix3();

/**
 * Merges every mesh of `root` (world transforms baked, skinned meshes in bind pose) into one vertex-coloured geometry,
 * scales it uniformly so its largest side equals `size`, centres it on X/Z and puts its base on y = 0.
 */
export function bakePickupGeometry(root: Object3D, size: number): BakedPickupGeometry {
  root.updateMatrixWorld(true);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const uvs: number[] = [];
  let texMap: Texture | null = null;
  let emisMap: Texture | null = null;
  let emisCol: [number, number, number] | null = null;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    let geo = mesh.geometry as BufferGeometry;
    const p = geo.getAttribute('position');
    if (!p) return;
    if (!geo.getAttribute('normal')) {
      geo = geo.clone();
      geo.computeVertexNormals();
    }
    const nAttr = geo.getAttribute('normal');
    const cAttr = geo.getAttribute('color');
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as (Material & { color?: Color }) | undefined;
    const mc = material?.color;
    const uvAttr = geo.getAttribute('uv');
    const mapOf = (material as (Material & { map?: Texture | null }) | undefined)?.map ?? null;
    if (mapOf && uvAttr && !texMap) texMap = mapOf;
    const useUv = !!uvAttr && !!mapOf && mapOf === texMap;
    const em = material as (Material & { emissiveMap?: Texture | null; emissive?: Color; emissiveIntensity?: number }) | undefined;
    if (useUv && em?.emissiveMap && !emisMap) {
      emisMap = em.emissiveMap;
      const k = em.emissiveIntensity ?? 1;
      emisCol = em.emissive ? [em.emissive.r * k, em.emissive.g * k, em.emissive.b * k] : [k, k, k];
    }
    _nm.getNormalMatrix(mesh.matrixWorld);
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      pos.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(nAttr, i).applyMatrix3(_nm).normalize();
      nor.push(_n.x, _n.y, _n.z);
      let r = 1;
      let g = 1;
      let b = 1;
      if (cAttr) {
        r = cAttr.getX(i);
        g = cAttr.getY(i);
        b = cAttr.getZ(i);
      }
      if (mc) {
        r *= mc.r;
        g *= mc.g;
        b *= mc.b;
      }
      col.push(r, g, b);
      if (useUv && uvAttr) uvs.push(uvAttr.getX(i), uvAttr.getY(i));
      else uvs.push(0, 0);
    }
    const index = geo.index;
    if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  });
  const n = pos.length / 3;
  if (n === 0) throw new Error('bakePickupGeometry: model has no mesh');
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3] as number;
    const y = pos[i * 3 + 1] as number;
    const z = pos[i * 3 + 2] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
  const k = size / ext;
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const position = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    position[i * 3] = ((pos[i * 3] as number) - cx) * k;
    position[i * 3 + 1] = ((pos[i * 3 + 1] as number) - minY) * k;
    position[i * 3 + 2] = ((pos[i * 3 + 2] as number) - cz) * k;
  }
  const index = n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return {
    position,
    normal: new Float32Array(nor),
    color: new Float32Array(col),
    index,
    width: (maxX - minX) * k,
    height: (maxY - minY) * k,
    depth: (maxZ - minZ) * k,
    ...(texMap ? { uv: new Float32Array(uvs), map: texMap } : {}),
    ...(texMap && emisMap && emisCol ? { emisMap, emisCol } : {}),
  };
}

// ------------------------------------------------------------------------------------------------------------------
// Shaders
// ------------------------------------------------------------------------------------------------------------------

const MESH_VERT = /* glsl */ `
attribute vec3 color;
attribute vec4 iPos;    // x, y (ground + hop), z, scale
attribute vec4 iAnim;   // age, phase 0..1
attribute vec4 iTint;   // rgb tint, emissive multiplier

uniform float uTime;
uniform vec4 uMotion;   // hover, bob amplitude, spin rad/s, bob speed
uniform vec2 uWobble;   // tilt amplitude (rad), pivot height (m at scale 1)
uniform float uYaw;

varying vec3 vN;
varying vec3 vW;
varying vec3 vCol;
varying float vEmis;
#ifdef PICKUP_TEX
varying vec2 vUv;
#endif

vec3 rotXZ(vec3 v, float ax, float az) {
  float cx = cos(ax);
  float sx = sin(ax);
  v = vec3(v.x, cx * v.y - sx * v.z, sx * v.y + cx * v.z);
  float cz = cos(az);
  float sz = sin(az);
  return vec3(cz * v.x - sz * v.y, sz * v.x + cz * v.y, v.z);
}

void main() {
  float age = iAnim.x;
  float ph = iAnim.y;
  float u = clamp(age / 0.4, 0.0, 1.0);
  float c1 = 1.9;
  float v = u - 1.0;
  float pop = u >= 1.0 ? 1.0 : 1.0 + (c1 + 1.0) * v * v * v + c1 * v * v;
  pop = max(pop, 0.0);

  float ang = uTime * uMotion.z + (ph - 0.5) * uYaw;
  float cs = cos(ang);
  float sn = sin(ang);
  vec3 lp = position * iPos.w * pop;
  vec3 rp = vec3(cs * lp.x + sn * lp.z, lp.y, -sn * lp.x + cs * lp.z);
  vec3 rn = vec3(cs * normal.x + sn * normal.z, normal.y, -sn * normal.x + cs * normal.z);
  // gentle wobble about world X/Z so facets sweep through the key light as the stone spins
  float wx = uWobble.x * sin(uTime * 1.9 + ph * 6.2832);
  float wz = uWobble.x * cos(uTime * 1.5 + ph * 4.1);
  vec3 pv = vec3(0.0, uWobble.y * iPos.w * pop, 0.0);
  rp = rotXZ(rp - pv, wx, wz) + pv;
  rn = rotXZ(rn, wx, wz);
  float bob = sin(uTime * uMotion.w + ph * 10.7) * uMotion.y;
  float hover = uMotion.x * mix(1.0, iPos.w, 0.5);
  vec3 wp = vec3(iPos.x, iPos.y + hover + bob, iPos.z) + rp;
  vW = wp;
  vN = rn;
  vCol = color * iTint.rgb;
  vEmis = iTint.a;
#ifdef PICKUP_TEX
  vUv = uv;
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const MESH_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunCol;     // colour * intensity / PI
uniform vec3 uSky;        // hemisphere sky * intensity / PI
uniform vec3 uGround;
uniform vec4 uMat;        // gloss, metal, emissive, faceted gem
#ifdef PICKUP_TEX
uniform sampler2D uMap;   // base colour of a textured model (E1); vertex colours stay the fallback
varying vec2 vUv;
#endif
#ifdef PICKUP_EMIS
uniform sampler2D uEmisMap; // emissive map of a textured model (r7 K7: the boss chest's eyes and ruby); same UV set as uMap
uniform vec3 uEmisCol;      // emissiveFactor x emissive strength (linear)
#endif

varying vec3 vN;
varying vec3 vW;
varying vec3 vCol;
varying float vEmis;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 envColor(vec3 r) {
  float h = r.y * 0.5 + 0.5;
  vec3 c = mix(uGround * 1.8 + 0.03, uSky * 2.2 + 0.1, smoothstep(0.1, 0.9, h));
  c += uSunCol * 3.0 * pow(max(dot(r, uSunDir), 0.0), 36.0);
  c += vec3(1.0, 0.95, 0.88) * smoothstep(0.86, 0.97, dot(r, normalize(vec3(-0.6, 0.55, 0.55)))) * 1.3;
  c += vec3(0.7, 0.85, 1.0) * smoothstep(0.88, 0.97, dot(r, normalize(vec3(0.7, 0.35, -0.6)))) * 1.0;
  return c;
}

void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN);
  bool gem = uMat.w > 0.5;
  if (gem) N = normalize(cross(dFdx(vW), dFdy(vW)));
  if (dot(N, V) < 0.0) N = -N;
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 3.0);
#ifdef PICKUP_TEX
  vec4 texel = texture2D(uMap, vUv);
  vec3 baseCol = vCol * texel.rgb;
  // r7 K7: the map's alpha is a specular mask (an RGB map samples 1.0: every shipped map keeps its look). A dark coin field or dark
  // planks under a glossy gold material stop mirroring the bright sky (they read grey-lilac before); the gold keeps its sheen.
  float specK = texel.a;
#else
  vec3 baseCol = vCol;
  float specK = 1.0;
#endif
#ifdef PICKUP_EMIS
  // r8 K8: the emissive map's ALPHA is a spec mask too (the yeop coin and the boss chest keep their albedo plain RGB: a premultiplied decode,
  // Safari < 17, would band low-alpha albedo texels; under a low emissive alpha the glow RGB is black or flat). RGB emissive maps sample 1.0.
  vec4 emTexel = texture2D(uEmisMap, vUv);
  specK *= emTexel.a;
#endif
  vec3 albedo = gem ? pow(baseCol, vec3(1.3)) : baseCol;
  vec3 R = reflect(-V, N);
  vec3 rgb;
  if (gem) {
    // faceted stone: per-facet shade from a fixed studio key light, inner glow, sharp moving glints
    vec3 fi = floor(N * 4.0 + 8.0);
    float facet = hash21(fi.xy + fi.z * 5.17);
    float key = clamp(dot(N, normalize(vec3(-0.35, 0.85, 0.45))) * 0.5 + 0.5, 0.0, 1.0);
    float shade = mix(0.28, 1.3, key * key * (3.0 - 2.0 * key)) * (0.72 + 0.56 * facet);
    vec3 body = albedo * shade + albedo * (0.4 + 0.6 * fres) * 0.35;
    float g1 = pow(max(dot(R, normalize(vec3(-0.5, 0.7, 0.5))), 0.0), 70.0) * 5.0;
    float g2 = pow(max(dot(R, uSunDir), 0.0), 90.0) * 6.0;
    rgb = body * (uMat.z * vEmis) + (g1 + g2) * mix(vec3(1.0), albedo + 0.25, 0.5) + albedo * fres * 0.5;
  } else {
    float ndl = max(dot(N, uSunDir), 0.0);
    vec3 hemi = mix(uGround, uSky, N.y * 0.5 + 0.5);
    vec3 diff = albedo * (uSunCol * ndl + hemi);
    float f0 = mix(0.05, 0.85, uMat.y);
    vec3 specTint = mix(vec3(1.0), albedo * 1.6 + 0.1, uMat.y);
    vec3 spec = envColor(R) * specTint * (f0 + (1.0 - f0) * fres) * uMat.x * specK;
    vec3 emis = albedo * uMat.z * vEmis * (0.62 + 0.55 * fres + 0.3 * (1.0 - ndv));
    rgb = diff + spec + emis;
#ifdef PICKUP_EMIS
    rgb += emTexel.rgb * uEmisCol * vEmis;
#endif
  }
  gl_FragColor = vec4(rgb, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}
`;

const GLOW_VERT = /* glsl */ `
attribute vec4 gPos;    // xyz centre, w size (m)
attribute vec4 gCol;    // rgb linear colour (intensity folded in), a glow type
attribute vec4 gAnim;   // age, phase, a, b   (a/b: star = sparkle / glint half-size m, streak = dir xz, beam = width / yaw, pool = ring / strength)

uniform float uTime;

varying vec2 vQ;
varying vec4 vCol;
varying vec4 vAnim;
varying float vSize;

void main() {
  float type = gCol.a;
  vec3 c = gPos.xyz;
  float size = gPos.w;
  vec3 toCam = normalize(cameraPosition - c);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w;
  vec2 q = position.xy * 2.0 - 1.0;
  float birth = 1.0 + 0.5 * exp(-gAnim.x * 7.0);
  vSize = size;
  if (type < 0.5 || (type > 2.5 && type < 3.5)) {
    // chests (glow size >= 3 m): the halo stays inside the chest (pushed 1-1.56 m toward the camera and drawn after it, it washed the lid cream / salmon)
    w = c + (right * q.x + up * q.y) * size * 0.5 * birth + toCam * (size >= 3.0 ? 0.3 : size * 0.3);
    vQ = q;
  } else if (type < 1.5) {
    vec3 f = normalize(vec3(gAnim.z, 0.0, gAnim.w));
    vec3 n = normalize(mix(vec3(0.0, 1.0, 0.0), toCam, 0.9));
    vec3 nn = n - f * dot(n, f);
    n = nn * inversesqrt(max(dot(nn, nn), 1e-6));
    vec3 s = cross(n, f);
    w = c + f * ((0.14 - 1.14 * position.x) * size) + s * q.y * 0.3 + toCam * 0.25;
    vQ = vec2(position.x, q.y);
  } else if (type < 2.5) {
    // light plane: a vertical quad at a fixed yaw (the chest uses three, 60 degrees apart): no camera-facing shear, no hollow interior
    vec3 rt = vec3(cos(gAnim.w), 0.0, sin(gAnim.w));
    w = c + rt * q.x * gAnim.z * 0.5 + vec3(0.0, position.y * size, 0.0);
    vQ = vec2(q.x, position.y);
  } else {
    // flat light pool on the floor
    w = c + vec3(q.x, 0.0, q.y) * size * 0.5;
    vQ = q;
  }
  vCol = gCol;
  vAnim = gAnim;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

export const GLOW_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDirect;
varying vec2 vQ;
varying vec4 vCol;
varying vec4 vAnim;
varying float vSize;

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
float sq(float x) {
  return x * x;
}


float glintCross(vec2 q) {
  float ax = abs(q.x);
  float ay = abs(q.y);
  float r2 = dot(q, q);
  float spikes = exp(-ay * 17.0) * pow(max(1.0 - ax, 0.0), 1.9) + exp(-ax * 17.0) * pow(max(1.0 - ay, 0.0), 1.9);
  vec2 dq = vec2(q.x + q.y, q.x - q.y) * 0.7071;
  float diag = 0.28 * (exp(-abs(dq.y) * 26.0) * pow(max(1.0 - abs(dq.x) * 1.7, 0.0), 2.0) + exp(-abs(dq.x) * 26.0) * pow(max(1.0 - abs(dq.y) * 1.7, 0.0), 2.0));
  float core = exp(-r2 * 70.0) * 1.3 + exp(-sqrt(r2) * 6.5) * 0.2;
  return spikes + diag + core;
}

void main() {
  float type = vCol.a;
  vec3 col = vCol.rgb;
  float t = uTime;
  float ph = vAnim.y;
  float age = vAnim.x;
  vec3 rgb = vec3(0.0);
  float aout = 0.0;
  if (type < 0.5) {
    float d = length(vQ);
    float dm = d * vSize * 0.5;
    float edge = smoothstep(1.0, 0.7, d);
    // small tier-coloured halo (the gem itself stays the hero), breathing
    float g = (exp(-dm * dm * 11.0) * (vSize >= 3.0 ? 0.0 : 0.5) + exp(-dm * 3.0) * 0.07) * edge;
    float breathe = 0.88 + 0.12 * sin(t * 2.0 + ph * 20.0);
    rgb = col * g * breathe;
    
    // scale 0 -> 1 -> 0, alpha 0.8 -> 1 -> 0, near white
    float gl = vAnim.w;
    vec3 gc = mix(col, vec3(1.0), 0.72);
    for (int k = 0; k < 2; k++) {
      float tc = t / 1.5 + ph * 3.0 + float(k) * 0.37;
      float ci = floor(tc);
      float uu = fract(tc) / 0.43;
      if (uu < 1.0) {
        float h1 = hash21(vec2(ci + float(k) * 19.0, ph * 37.0 + 3.1));
        float h2 = hash21(vec2(ci * 1.7 + 5.0, ph * 13.0 + float(k) * 7.0));
        float ang = h1 * 6.2832;
        vec2 off = vec2(cos(ang), sin(ang) * 0.8) * gl * mix(0.5, 1.0, h2);
        float tri = 1.0 - abs(uu * 2.0 - 1.0);
        float sc = tri * tri * (3.0 - 2.0 * tri);
        vec2 q = (vQ * vSize * 0.5 - off) / max(gl * sc * (0.75 + 0.5 * h2), 0.01);
        float al = mix(0.8, 1.0, smoothstep(0.0, 0.5, uu)) * (1.0 - smoothstep(0.55, 1.0, uu));
        rgb += gc * glintCross(q) * al * vAnim.z * 1.25 * edge;
      }
    }
    rgb *= 1.0 + 1.6 * exp(-age * 9.0);
  } else if (type < 1.5) {
    float u = clamp(vQ.x, 0.0, 1.0);
    float w = mix(0.55, 0.05, pow(u, 0.7));
    float prof = exp(-sq(vQ.y / w) * 2.2);
    float fall = pow(1.0 - u, 1.6);
    float fl = 0.7 + 0.6 * vnoise(vec2(u * 6.0 - t * 9.0, vQ.y * 3.0 + ph * 30.0));
    rgb = (col * 1.5 + vec3(0.8) * pow(1.0 - u, 4.0)) * prof * fall * fl * smoothstep(0.0, 0.1, u + 0.05);
  } else if (type < 2.5) {
    // soft additive column (BEAM_* constants and chestBeamProfile in pickups.ts mirror this): every factor is >= 0, alpha stays 0
    float x = abs(vQ.x);
    float y = clamp(vQ.y, 0.0, 1.0);
    float w = mix(1.0, ${BEAM_TOP_WIDTH.toFixed(2)}, pow(y, ${BEAM_TAPER_POW.toFixed(2)}));
    float prof = pow(1.0 - smoothstep(${BEAM_EDGE_START.toFixed(2)}, 1.0, min(x / w, 1.0)), 1.4);
    float vert = pow(1.0 - y, 1.1) * smoothstep(0.0, 0.07, y);
    float yaw = vAnim.w;
    float rays = 0.65 + 0.7 * vnoise(vec2(vQ.x * 5.5 + ph * 17.0 + yaw * 3.0, y * 2.4 - t * 0.7));
    float motes = pow(vnoise(vec2(vQ.x * 8.0 + ph * 9.0 + yaw, y * 6.0 - t * 1.5)), 6.0) * 2.6;
    rgb = col * (prof * vert * rays * 0.95 + motes * prof * vert) * 1.1 * smoothstep(0.0, 0.35, age);
  } else if (type < 3.5) {
    float d = length(vQ);
    float ang = atan(vQ.y, vQ.x);
    float core = exp(-d * d * 12.0);
    float spiral = ang * 2.0 - t * 5.0 + d * 8.0;
    float arms = pow(0.5 + 0.5 * sin(spiral), 2.0);
    float band = exp(-sq((d - 0.5) * 3.2)) * smoothstep(1.0, 0.7, d);
    float ring = exp(-sq((d - 0.7) * 11.0)) * (0.35 + 0.65 * arms);
    float edge = smoothstep(1.0, 0.75, d);
    rgb = (col * (band * (0.25 + 0.9 * arms) + ring * 0.8 + exp(-d * 2.4) * 0.16) + vec3(1.0) * core * 0.75) * edge;
    rgb *= 1.0 + 1.1 * exp(-age * 9.0);
  } else {
    
    float d = length(vQ);
    float edge = smoothstep(1.0, 0.6, d);
    float disc = exp(-d * d * 4.2) * edge;
    float breathe = 0.82 + 0.18 * sin(t * 1.6 + ph * 20.0);
    float ring = 0.0;
    if (vAnim.z > 0.5) {
      float cyc = fract(t / 1.6 + ph);
      float rr = 0.2 + 0.7 * cyc;
      ring = exp(-sq((d - rr) * 8.0)) * sin(3.14159 * cyc) * edge * 0.9;
    }
    float k = disc * 0.4 * breathe + ring * 0.6;
    float pop = smoothstep(0.0, 0.5, age);
    rgb = col * k * 1.6 * pop;
    // a faint dark underlay (premultiplied alpha): the light keeps its colour on snow and pale stone instead of washing out
    aout = clamp(k * 0.16 * pop * vAnim.w, 0.0, 0.25);
  }
  // straight to the canvas (low tier: no HDR target, no tone map): the light planes are damped harder so they stay a soft column
  rgb *= mix(1.0, (type > 1.5 && type < 2.5) ? ${BEAM_DIRECT_GAIN.toFixed(2)} : 0.75, uDirect);
  // glow only ever adds: no negative light, no negative alpha, whatever a branch above produced
  gl_FragColor = vec4(max(rgb, vec3(0.0)), clamp(aout, 0.0, 1.0));
#include <tonemapping_fragment>
#include <colorspace_fragment>
}
`;

const SHADOW_VERT = /* glsl */ `
attribute vec4 sPos;   // xyz centre (ground), w radius
attribute vec4 sAnim;  // alpha, hover (m), -, -
varying vec2 vQ;
varying float vA;
void main() {
  vec2 q = position.xy * 2.0 - 1.0;
  float hover = sAnim.y;
  float r = sPos.w * (1.0 + hover * 0.35);
  vec3 w = sPos.xyz + vec3(q.x * r, 0.03, q.y * r);
  vQ = q;
  vA = sAnim.x / (1.0 + hover * 1.4);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const SHADOW_FRAG = /* glsl */ `
varying vec2 vQ;
varying float vA;
void main() {
  float d = length(vQ);
  float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.6) * vA;
  gl_FragColor = vec4(vec3(0.02, 0.015, 0.03), a);
}
`;

// ------------------------------------------------------------------------------------------------------------------
// System
// ------------------------------------------------------------------------------------------------------------------

const MAX_PICKUPS = 1200;
/** pickups on the floor up to which the floor pools keep their full size / strength; beyond it they thin out by sqrt(free / n) down to the minimum */
const POOL_CROWD_FREE = 14;
const POOL_CROWD_MIN = 0.45;
const GLOW_CAP = 5 * MAX_PICKUPS;
/** chest light planes: three per chest */
const BEAM_CAP = 3 * MAX_PICKUPS;
/**
 * Draw order of the chest light planes and of the chest models (r4 kp4 fix). The planes stand through the chest, so the plane parts
 * that reached out in front of its face washed the chest's sides while the part inside the body stayed hidden: a lancet-shaped dark
 * window over every chest. Now the planes draw first in the transparent pass and the chest models (opaque output, depth write) right
 * after them, so a chest always covers its own beam inside its silhouette: a clean chest standing in its light column. Both orders are
 * below every other transparent layer of the game (ground decals -20 and up), so no other effect is drawn before the chest and
 * overwritten by it.
 */
export const PICKUP_BEAM_ORDER = -22;
export const PICKUP_CHEST_ORDER = -21;
/** model batches that draw after the light planes (the chests: the only pickups with a beam) */
export const drawsAfterBeam = (def: PickupModelDef): boolean => def.key.startsWith('chest');
const QUAD_POS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
const QUAD_INDEX = [0, 1, 2, 2, 1, 3];
const INV_PI = 1 / Math.PI;

interface ModelBatch {
  def: PickupModelDef;
  geometry: InstancedBufferGeometry;
  material: ShaderMaterial;
  mesh: Mesh;
  pos: Float32Array;
  anim: Float32Array;
  tint: Float32Array;
  attrs: InstancedBufferAttribute[];
  count: number;
}

/** Optional previous-tick positions: when the sim supplies them, magnetised pickups are interpolated and trail correctly. */
interface PickupFeedWithPrev extends PickupFeed {
  readonly px?: Float32Array;
  readonly pz?: Float32Array;
}

function dynamicAttr(cap: number): [Float32Array, InstancedBufferAttribute] {
  const arr = new Float32Array(cap * 4);
  const attr = new InstancedBufferAttribute(arr, 4);
  attr.setUsage(35048); // DynamicDrawUsage
  return [arr, attr];
}

interface GlowBatch {
  geometry: InstancedBufferGeometry;
  material: ShaderMaterial;
  mesh: Mesh;
  pos: Float32Array;
  col: Float32Array;
  anim: Float32Array;
  attrs: InstancedBufferAttribute[];
  count: number;
}

/** one instanced quad batch of the glow shader (the shared material); `cap` rows */
function makeGlowBatch(material: ShaderMaterial, cap: number, name: string, renderOrder: number): GlowBatch {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(QUAD_POS, 3));
  geometry.setIndex(QUAD_INDEX);
  const [pos, aPos] = dynamicAttr(cap);
  const [col, aCol] = dynamicAttr(cap);
  const [anim, aAnim] = dynamicAttr(cap);
  geometry.setAttribute('gPos', aPos);
  geometry.setAttribute('gCol', aCol);
  geometry.setAttribute('gAnim', aAnim);
  geometry.instanceCount = 0;
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = renderOrder;
  mesh.visible = false;
  return { geometry, material, mesh, pos, col, anim, attrs: [aPos, aCol, aAnim], count: 0 };
}

export class Pickups implements RenderSystem {
  readonly name = 'pickups';
  feed: PickupFeed | null = null;

  private readonly visuals = buildPickupVisuals();
  private models: ModelBatch[] = [];
  private ready = false;
  private loading: Promise<void> | null = null;
  private disposed = false;

  private readonly timeUniform = { value: 0 };
  private readonly directUniform = { value: 0 };
  private readonly light = {
    uSunDir: { value: new Vector3(0.45, 0.8, 0.35).normalize() },
    uSunCol: { value: new Color() },
    uSky: { value: new Color() },
    uGround: { value: new Color() },
  };

  private readonly glow: GlowBatch;
  /** chest light planes: the glow shader in a batch of their own, drawn before the chests (PICKUP_BEAM_ORDER) */
  private readonly beam: GlowBatch;
  private readonly shadow: {
    geometry: InstancedBufferGeometry;
    material: ShaderMaterial;
    mesh: Mesh;
    pos: Float32Array;
    anim: Float32Array;
    attrs: InstancedBufferAttribute[];
    count: number;
  };

  private cap = PICKUP_CAP_BY_TIER.high;
  /** low quality: floor pools only under the rarer loot (gems of tier 2+, coins, chests, potions, magnets) */
  private lite = false;
  private d2: Float32Array = new Float32Array(0);
  private work: Float32Array = new Float32Array(0);
  private readonly unsubscribe: () => void;

  constructor(private readonly core: RenderCore) {
    // glow batch + the chest light-plane batch (same shader and material, drawn before the chests)
    {
      const material = new ShaderMaterial({
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        uniforms: { uTime: this.timeUniform, uDirect: this.directUniform },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        blending: CustomBlending,
        blendEquation: AddEquation,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendEquationAlpha: AddEquation,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
      });
      material.onBeforeRender = (renderer): void => {
        this.directUniform.value = renderer.getRenderTarget() === null ? 1 : 0;
      };
      this.glow = makeGlowBatch(material, GLOW_CAP, 'pickups:glow', 40);
      this.beam = makeGlowBatch(material, BEAM_CAP, 'pickups:beam', PICKUP_BEAM_ORDER);
    }
    // contact shadows
    {
      const geometry = new InstancedBufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(QUAD_POS, 3));
      geometry.setIndex(QUAD_INDEX);
      const [pos, aPos] = dynamicAttr(MAX_PICKUPS);
      const [anim, aAnim] = dynamicAttr(MAX_PICKUPS);
      geometry.setAttribute('sPos', aPos);
      geometry.setAttribute('sAnim', aAnim);
      geometry.instanceCount = 0;
      const material = new ShaderMaterial({
        vertexShader: SHADOW_VERT,
        fragmentShader: SHADOW_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        toneMapped: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.name = 'pickups:shadow';
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 10;
      mesh.visible = false;
      this.shadow = { geometry, material, mesh, pos, anim, attrs: [aPos, aAnim], count: 0 };
    }
    core.scene.add(this.shadow.mesh, this.beam.mesh, this.glow.mesh);
    this.applyQuality(core.quality.profile);
    this.unsubscribe = core.quality.onChange((p) => this.applyQuality(p));
  }

  /** Loads (via Assets.loadBatch) and bakes the pickup models. Safe to call more than once. */
  load(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.loading) {
      const p = this.doLoad().catch((err) => {
        if (this.loading === p) this.loading = null;
        throw err;
      });
      this.loading = p;
    }
    return this.loading;
  }

  update(_dt: number, alpha: number): void {
    const core = this.core;
    this.timeUniform.value = core.clock.time;
    this.updateLight();
    for (const m of this.models) m.count = 0;
    this.glow.count = 0;
    this.beam.count = 0;
    this.shadow.count = 0;
    const feed = this.feed as PickupFeedWithPrev | null;
    if (this.ready && feed && feed.count > 0) this.fill(feed, alpha);
    for (const m of this.models) this.uploadModel(m);
    this.uploadSimple(this.glow);
    this.uploadSimple(this.beam);
    this.uploadSimple(this.shadow);
  }

  dispose(): void {
    this.disposed = true;
    this.loading = null;
    this.unsubscribe();
    for (const m of this.models) {
      this.core.scene.remove(m.mesh);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.models = [];
    for (const s of [this.glow, this.beam, this.shadow]) {
      this.core.scene.remove(s.mesh);
      s.geometry.dispose();
      s.material.dispose();
    }
    this.ready = false;
  }

  // -----------------------------------------------------------------------------------------------------------------

  private async doLoad(): Promise<void> {
    const assets = this.core.assets;
    // r8 K8: rows may share a file (the yeop tiers are nodes of yeop_coin): each id is requested once
    const ids = [...new Set(PICKUP_MODELS.map((m) => m.id))];
    await assets.loadBatch(ids.map((id) => ({ kind: 'model' as const, id, hint: 'pickup' as const })));
    if (this.disposed) return;
    const batches: ModelBatch[] = [];
    try {
      for (const def of PICKUP_MODELS) {
        const model: LoadedModel = assets.model(def.id);
        const baked = bakePickupGeometry(pickupRoot(model.scene, def), def.size);
        batches.push(this.makeModelBatch({ ...def, mat: pickupMatOf(def, model.extras) }, baked));
      }
      if (this.disposed) {
        for (const b of batches) {
          b.geometry.dispose();
          b.material.dispose();
        }
        return;
      }
      for (const b of batches) this.core.scene.add(b.mesh);
      this.models = batches;
      this.ready = true;
    } catch (err) {
      for (const b of batches) {
        this.core.scene.remove(b.mesh);
        b.geometry.dispose();
        b.material.dispose();
      }
      throw err;
    }
  }

  private makeModelBatch(def: PickupModelDef, baked: BakedPickupGeometry): ModelBatch {
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(baked.position, 3));
    geometry.setAttribute('normal', new BufferAttribute(baked.normal, 3));
    geometry.setAttribute('color', new BufferAttribute(baked.color, 3));
    const textured = !!(baked.uv && baked.map);
    const emissiveMap = textured && baked.emisMap && baked.emisCol ? baked.emisMap : null;
    if (baked.uv && baked.map) geometry.setAttribute('uv', new BufferAttribute(baked.uv, 2));
    geometry.setIndex(new BufferAttribute(baked.index, 1));
    const [pos, aPos] = dynamicAttr(MAX_PICKUPS);
    const [anim, aAnim] = dynamicAttr(MAX_PICKUPS);
    const [tint, aTint] = dynamicAttr(MAX_PICKUPS);
    geometry.setAttribute('iPos', aPos);
    geometry.setAttribute('iAnim', aAnim);
    geometry.setAttribute('iTint', aTint);
    geometry.instanceCount = 0;
    const material = new ShaderMaterial({
      vertexShader: MESH_VERT,
      fragmentShader: MESH_FRAG,
      uniforms: {
        uTime: this.timeUniform,
        uMotion: { value: [def.hover, def.bob, def.spin, def.bobSpeed] },
        uYaw: { value: def.yaw },
        uWobble: { value: [def.wobble, def.size * 0.5] },
        uMat: { value: [...def.mat] },
        ...(textured ? { uMap: { value: baked.map } } : {}),
        ...(emissiveMap ? { uEmisMap: { value: emissiveMap }, uEmisCol: { value: [...(baked.emisCol as [number, number, number])] } } : {}),
        ...this.light,
      },
      ...(textured ? { defines: emissiveMap ? { PICKUP_TEX: '', PICKUP_EMIS: '' } : { PICKUP_TEX: '' } } : {}),
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = `pickups:${def.key}`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    if (drawsAfterBeam(def)) {
      // still opaque output (alpha 1, depth write): only moved into the transparent pass so it draws right after its light planes
      material.transparent = true;
      mesh.renderOrder = PICKUP_CHEST_ORDER;
    }
    return { def, geometry, material, mesh, pos, anim, tint, attrs: [aPos, aAnim, aTint], count: 0 };
  }

  private applyQuality(p: QualityProfile): void {
    this.cap = PICKUP_CAP_BY_TIER[p.tier];
    this.lite = p.tier === 'low';
  }

  private updateLight(): void {
    const env = this.core.env;
    const L = this.light;
    (L.uSunDir.value as Vector3).copy(env.sunDir);
    (L.uSunCol.value as Color).copy(env.sun.color).multiplyScalar(env.sun.intensity * INV_PI);
    (L.uSky.value as Color).copy(env.hemi.color).multiplyScalar(env.hemi.intensity * INV_PI);
    (L.uGround.value as Color).copy(env.hemi.groundColor).multiplyScalar(env.hemi.intensity * INV_PI);
  }

  private fill(feed: PickupFeedWithPrev, alpha: number): void {
    const n = feed.count;
    const rig = this.core.rig;
    const fx = rig.focus.x;
    const fz = rig.focus.z;
    const core = this.core;
    const vis = this.visuals;
    const models = this.models;
    const glow = this.glow;
    const beam = this.beam;
    const shadow = this.shadow;
    const prevX = feed.px;
    const prevZ = feed.pz;
    // many pickups lying about (a long run / a gem field): the floor pools of the common gems and coins thin out so 30+ of them
    // stay a field of small warm lights instead of a carpet (the audit's "quiet among 30+ enemies"). 1 up to POOL_CROWD_FREE.
    const poolCrowd = n <= POOL_CROWD_FREE ? 1 : Math.max(POOL_CROWD_MIN, Math.sqrt(POOL_CROWD_FREE / n));

    let cutoff = Infinity;
    if (n > this.cap) {
      if (this.d2.length < n) {
        this.d2 = new Float32Array(n);
        this.work = new Float32Array(n);
      }
      for (let i = 0; i < n; i++) {
        const dx = (feed.x[i] as number) - fx;
        const dz = (feed.z[i] as number) - fz;
        this.d2[i] = dx * dx + dz * dz;
      }
      cutoff = nearestCutoff(this.d2, n, this.cap, this.work);
    }

    for (let i = 0; i < n; i++) {
      if (cutoff !== Infinity && (this.d2[i] as number) > cutoff) continue;
      const kind = feed.kind[i] as number;
      const v = pickupVisual(vis, kind, feed.tier[i] as number);
      const cx = feed.x[i] as number;
      const cz = feed.z[i] as number;
      const magnet = feed.magnet[i] ? 1 : 0;
      let x = cx;
      let z = cz;
      let mdx = fx - cx;
      let mdz = fz - cz;
      if (prevX && prevZ) {
        const ox = prevX[i] as number;
        const oz = prevZ[i] as number;
        x = ox + (cx - ox) * alpha;
        z = oz + (cz - oz) * alpha;
        const sx = cx - ox;
        const sz = cz - oz;
        if (sx * sx + sz * sz > 1e-6) {
          mdx = sx;
          mdz = sz;
        }
      }
      const reach = v.beamHeight > 0 ? 1.8 + v.beamHeight * 0.55 : 1.4 + v.glowSize * 0.5;
      if (!rig.isVisible(x, z, reach)) continue;

      const mb = models[v.model] as ModelBatch;
      if (mb.count >= MAX_PICKUPS || glow.count >= GLOW_CAP - 6) continue;

      const gy = core.heightAt(x, z);
      const y = gy + (feed.h[i] as number);
      const age = feed.age[i] as number;
      // phase: smooth in space so it does not jitter while a pickup is magnetised, varied enough between neighbours
      const ph = Math.abs(Math.sin(x * 1.37 + z * 2.11)) * 0.5 + Math.abs(Math.cos(x * 0.83 - z * 1.71)) * 0.5;

      const o = mb.count * 4;
      mb.pos[o] = x;
      mb.pos[o + 1] = y;
      mb.pos[o + 2] = z;
      mb.pos[o + 3] = v.scale;
      mb.anim[o] = age;
      mb.anim[o + 1] = ph;
      const boost = magnet ? 1.15 : 1;
      mb.tint[o] = v.tint[0];
      mb.tint[o + 1] = v.tint[1];
      mb.tint[o + 2] = v.tint[2];
      mb.tint[o + 3] = v.emissive * boost;
      mb.count++;

      const def = mb.def;
      const hoverNow = def.hover * (1 + (v.scale - 1) * 0.5) + (feed.h[i] as number);
      // contact shadow
      {
        const so = shadow.count * 4;
        shadow.pos[so] = x;
        shadow.pos[so + 1] = gy;
        shadow.pos[so + 2] = z;
        shadow.pos[so + 3] = v.shadow;
        shadow.anim[so] = 0.42 * Math.min(1, age * 5);
        shadow.anim[so + 1] = hoverNow;
        shadow.count++;
      }
      
      const centreY = y + def.hover * (1 + (v.scale - 1) * 0.5) + def.size * v.scale * 0.5;
      {
        const go = glow.count * 4;
        glow.pos[go] = x;
        glow.pos[go + 1] = centreY;
        glow.pos[go + 2] = z;
        glow.pos[go + 3] = v.glowSize;
        const hk = boost * v.halo;
        glow.col[go] = v.glow[0] * hk;
        glow.col[go + 1] = v.glow[1] * hk;
        glow.col[go + 2] = v.glow[2] * hk;
        glow.col[go + 3] = v.glowType;
        glow.anim[go] = age;
        glow.anim[go + 1] = ph;
        glow.anim[go + 2] = v.sparkle;
        glow.anim[go + 3] = v.glint;
        glow.count++;
      }
      // soft light pool on the floor under resting loot (not under a pickup that is flying to the hero)
      if (v.pool > 0 && !magnet && !(this.lite && kind === PICKUP_XP && (feed.tier[i] as number) < 2)) {
        const go = glow.count * 4;
        glow.pos[go] = x;
        glow.pos[go + 1] = gy + 0.05;
        glow.pos[go + 2] = z;
        // only the common loot thins out (gems, coins); potions, chests and magnet orbs are the rare things a player must find
        const thin = kind === PICKUP_XP || kind === PICKUP_YEOP ? poolCrowd : 1;
        glow.pos[go + 3] = v.pool * 2 * (0.6 + 0.4 * thin);
        glow.col[go] = v.glow[0];
        glow.col[go + 1] = v.glow[1];
        glow.col[go + 2] = v.glow[2];
        glow.col[go + 3] = GLOW_POOL;
        glow.anim[go] = age;
        glow.anim[go + 1] = ph;
        glow.anim[go + 2] = v.ring ? 1 : 0;
        glow.anim[go + 3] = v.poolInt * thin;
        glow.count++;
      }
      if (v.beamHeight > 0 && beam.count <= BEAM_CAP - 3) {
        // three light planes 60 degrees apart (never a camera-facing ribbon: the 55 degree view would shear it), in the beam batch
        // that draws before the chests (PICKUP_BEAM_ORDER): the chest covers the planes inside its silhouette
        const h = v.beamHeight * Math.min(1, 0.2 + age * 2.5);
        for (let k = 0; k < 3; k++) {
          const go = beam.count * 4;
          beam.pos[go] = x;
          beam.pos[go + 1] = gy;
          beam.pos[go + 2] = z;
          beam.pos[go + 3] = h;
          beam.col[go] = v.glow[0] * 0.62;
          beam.col[go + 1] = v.glow[1] * 0.62;
          beam.col[go + 2] = v.glow[2] * 0.62;
          beam.col[go + 3] = GLOW_BEAM;
          beam.anim[go] = age;
          beam.anim[go + 1] = ph;
          beam.anim[go + 2] = v.beamWidth;
          beam.anim[go + 3] = ph * Math.PI + (k * Math.PI) / 3;
          beam.count++;
        }
      }
      if (magnet) {
        const dist = Math.sqrt(mdx * mdx + mdz * mdz);
        if (dist > 0.15) {
          const go = glow.count * 4;
          glow.pos[go] = x;
          glow.pos[go + 1] = centreY;
          glow.pos[go + 2] = z;
          glow.pos[go + 3] = 0.8 + 1.3 * Math.min(1, dist / 5);
          glow.col[go] = v.glow[0] * 1.15;
          glow.col[go + 1] = v.glow[1] * 1.15;
          glow.col[go + 2] = v.glow[2] * 1.15;
          glow.col[go + 3] = GLOW_STREAK;
          glow.anim[go] = age;
          glow.anim[go + 1] = ph;
          glow.anim[go + 2] = mdx / dist;
          glow.anim[go + 3] = mdz / dist;
          glow.count++;
        }
      }
    }
  }

  private uploadModel(m: ModelBatch): void {
    m.mesh.visible = m.count > 0;
    m.geometry.instanceCount = m.count;
    if (m.count === 0) return;
    for (const a of m.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, m.count * 4);
      a.needsUpdate = true;
    }
  }

  private uploadSimple(s: { mesh: Mesh; geometry: InstancedBufferGeometry; attrs: InstancedBufferAttribute[]; count: number }): void {
    s.mesh.visible = s.count > 0;
    s.geometry.instanceCount = s.count;
    if (s.count === 0) return;
    for (const a of s.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, s.count * 4);
      a.needsUpdate = true;
    }
  }
}

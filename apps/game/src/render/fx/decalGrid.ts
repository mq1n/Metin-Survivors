// Decal infrastructure shared by telegraphs.ts and groundRings.ts (C0 ownership split, moved verbatim from telegraphs.ts;
// core-owned and frozen for builders): `DecalSlots` (slot matching / fading, pure) and `DecalGrid` (one merged,
// terrain-draped grid mesh: GRID×GRID quads per slot, per-slot parameters in a float data texture, shapes evaluated
// analytically in the fragment shader), the shared GLSL helpers (FX_GLSL_LIB) and the pure helpers below.
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  FloatType,
  Mesh,
  NearestFilter,
  NormalBlending,
  RGBAFormat,
  ShaderMaterial,
  type IUniform,
} from 'three';
import { TG_CONE, TG_LINE } from '../feed';

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (unit-tested)

/** Grid cells per side of every decal slot (vertices = (GRID+1)²). */
export const DECAL_GRID = 24;
const VERTS_PER_SLOT = (DECAL_GRID + 1) * (DECAL_GRID + 1);
const INDICES_PER_SLOT = DECAL_GRID * DECAL_GRID * 6;
/** texels (RGBA32F) of per-slot parameters */
const TEXELS = 5;
/** margin (m) around the analytic shape so rim glow and AA never meet the grid border */
export const DECAL_MARGIN = 0.9;

/** Local-space bounding rectangle [x0,x1,z0,z1] (metres; +z = facing) a telegraph shape needs. */
export function telegraphRect(shape: number, radius: number, length: number, width: number, out: Float32Array, o = 0): void {
  let x0: number;
  let x1: number;
  let z0: number;
  let z1: number;
  if (shape === TG_LINE) {
    x1 = width * 0.5;
    x0 = -x1;
    z0 = 0;
    z1 = length;
  } else if (shape === TG_CONE) {
    const half = width * 0.5;
    x1 = half >= Math.PI / 2 ? radius : radius * Math.sin(half);
    x0 = -x1;
    z0 = half >= Math.PI / 2 ? radius * Math.cos(half) : 0;
    z1 = radius;
  } else {
    x1 = radius;
    x0 = -radius;
    z0 = -radius;
    z1 = radius;
  }
  out[o] = x0 - DECAL_MARGIN;
  out[o + 1] = x1 + DECAL_MARGIN;
  out[o + 2] = z0 - DECAL_MARGIN;
  out[o + 3] = z1 + DECAL_MARGIN;
}

/** Decal-local (lx = right, lz = forward) → world xz for a decal at (ox,oz) with yaw `rot` (0 faces +Z). Matches the vertex shader. */
export function decalWorld(ox: number, oz: number, rot: number, lx: number, lz: number, out: { x: number; z: number }): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  out.x = ox + c * lx + s * lz;
  out.z = oz - s * lx + c * lz;
}

/** side length (px) of the tileable noise texture the telegraph shader samples */
export const NOISE_SIZE = 128;

/**
 * Tileable fractal value noise (R8, `size`² texels, three octaves over a `cells`-cell lattice), contrast-stretched
 * around 0.5. Deterministic for a given seed. Sampled with repeat wrapping + bilinear filtering by the decal shader.
 */
export function makeNoiseData(size = NOISE_SIZE, cells = 8, octaves = 3, seed = 7): Uint8Array {
  const acc = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  let state = (seed * 2654435761) >>> 0;
  const rnd = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    const lattice = new Float32Array(c * c);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * c;
      const iy = Math.floor(gy);
      const fy = gy - iy;
      const sy = fy * fy * (3 - 2 * fy);
      const r0 = (iy % c) * c;
      const r1 = ((iy + 1) % c) * c;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * c;
        const ix = Math.floor(gx);
        const fx = gx - ix;
        const sx = fx * fx * (3 - 2 * fx);
        const x0 = ix % c;
        const x1 = (ix + 1) % c;
        const a = (lattice[r0 + x0] as number) + ((lattice[r0 + x1] as number) - (lattice[r0 + x0] as number)) * sx;
        const b = (lattice[r1 + x0] as number) + ((lattice[r1 + x1] as number) - (lattice[r1 + x0] as number)) * sx;
        acc[y * size + x] = (acc[y * size + x] as number) + amp * (a + (b - a) * sy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  const out = new Uint8Array(size * size);
  for (let i = 0; i < out.length; i++) {
    const v = (acc[i] as number) / total;
    out[i] = Math.round(Math.min(1, Math.max(0, (v - 0.5) * 1.7 + 0.5)) * 255);
  }
  return out;
}

/**
 * Chooses the `cap` entries nearest to (fx,fz) from `n` candidates. `idx[0..n)` holds candidate ids on entry and the
 * kept ids (nearest first) on return; `d2[i]` is the squared distance of candidate `idx[i]` (parallel arrays).
 */
export function selectClosest(d2: Float32Array, idx: Int32Array, n: number, cap: number): number {
  // insertion sort: n is at most the sim's telegraph cap (128) and mostly < 48
  for (let i = 1; i < n; i++) {
    const dv = d2[i] as number;
    const iv = idx[i] as number;
    let j = i - 1;
    while (j >= 0 && (d2[j] as number) > dv) {
      d2[j + 1] = d2[j] as number;
      idx[j + 1] = idx[j] as number;
      j--;
    }
    d2[j + 1] = dv;
    idx[j + 1] = iv;
  }
  return n < cap ? n : cap;
}

export const SLOT_FREE = 0;
export const SLOT_LIVE = 1;
export const SLOT_FADING = 2;

export interface DecalSlotsOptions {
  /** seconds a vanished decal lingers (rendered at its last pose, fading) */
  fadeOut?: number;
  /** seconds to fade a new decal in */
  fadeIn?: number;
  /** reject a match when the new progress is lower than the previous by more than 0.05 */
  monotonic?: boolean;
  /** max distance (m) a decal may move between frames and still be the same decal */
  maxMove?: number;
}

/**
 * Persistent slot assignment for per-frame decal lists (feeds have no stable ids): each entry is matched to the
 * previous frame's slot of the same kind/size nearest to it, so heights are only recomputed on real changes and a
 * vanished decal can fade out instead of popping.
 */
export class DecalSlots {
  readonly state: Uint8Array;
  readonly kind: Uint8Array;
  readonly sub: Uint8Array;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly rot: Float32Array;
  readonly r1: Float32Array;
  readonly r2: Float32Array;
  readonly r3: Float32Array;
  readonly prog: Float32Array;
  readonly age: Float32Array;
  /** time since vanishing (fading slots) */
  readonly fadeT: Float32Array;
  /** pose the heights were last computed for */
  readonly hx: Float32Array;
  readonly hz: Float32Array;
  readonly hrot: Float32Array;
  readonly hr1: Float32Array;
  readonly hr2: Float32Array;
  readonly hr3: Float32Array;
  /** 0 = heights valid, 1 = recompute (moved/resized), 2 = never computed (must be computed before drawing) */
  readonly dirty: Uint8Array;
  /** highest used slot + 1 */
  high = 0;
  liveCount = 0;
  readonly fadeOut: number;
  readonly fadeIn: number;
  private readonly monotonic: boolean;
  private readonly maxMove2: number;
  private readonly claimed: Uint8Array;

  constructor(
    readonly cap: number,
    o: DecalSlotsOptions = {},
  ) {
    this.state = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    this.sub = new Uint8Array(cap);
    this.claimed = new Uint8Array(cap);
    this.dirty = new Uint8Array(cap);
    this.x = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.rot = new Float32Array(cap);
    this.r1 = new Float32Array(cap);
    this.r2 = new Float32Array(cap);
    this.r3 = new Float32Array(cap);
    this.prog = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.fadeT = new Float32Array(cap);
    this.hx = new Float32Array(cap);
    this.hz = new Float32Array(cap);
    this.hrot = new Float32Array(cap);
    this.hr1 = new Float32Array(cap);
    this.hr2 = new Float32Array(cap);
    this.hr3 = new Float32Array(cap);
    this.fadeOut = o.fadeOut ?? 0.18;
    this.fadeIn = o.fadeIn ?? 0.12;
    this.monotonic = o.monotonic ?? true;
    const mm = o.maxMove ?? 2.5;
    this.maxMove2 = mm * mm;
  }

  begin(): void {
    this.claimed.fill(0);
  }

  /**
   * Matches one decal to last frame's slot (same kind/owner/size, nearest, progress not going backwards) and updates
   * its pose; returns the slot or -1 when nothing matches.
   */
  match(kind: number, sub: number, x: number, z: number, rot: number, r1: number, r2: number, r3: number, prog: number): number {
    let best = -1;
    let bestD = this.maxMove2;
    for (let i = 0; i < this.high; i++) {
      if (this.state[i] !== SLOT_LIVE || this.claimed[i] === 1) continue;
      if (this.kind[i] !== kind || this.sub[i] !== sub) continue;
      if (Math.abs(r1 - (this.r1[i] as number)) > 0.05 + 0.02 * r1) continue;
      if (Math.abs(r2 - (this.r2[i] as number)) > 0.05 + 0.02 * r2) continue;
      if (Math.abs(r3 - (this.r3[i] as number)) > 0.05 + 0.02 * r3) continue;
      if (this.monotonic && prog < (this.prog[i] as number) - 0.05) continue;
      const dx = x - (this.x[i] as number);
      const dz = z - (this.z[i] as number);
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best < 0) return -1;
    this.claimed[best] = 1;
    this.x[best] = x;
    this.z[best] = z;
    this.rot[best] = rot;
    this.r1[best] = r1;
    this.r2[best] = r2;
    this.r3[best] = r3;
    this.prog[best] = prog;
    const moved = Math.abs(x - (this.hx[best] as number)) + Math.abs(z - (this.hz[best] as number));
    const turned = Math.abs(rot - (this.hrot[best] as number));
    const resized =
      Math.abs(r1 - (this.hr1[best] as number)) + Math.abs(r2 - (this.hr2[best] as number)) + Math.abs(r3 - (this.hr3[best] as number));
    if ((moved > 0.35 || turned > 0.12 || resized > 0.2) && this.dirty[best] === 0) this.dirty[best] = 1;
    return best;
  }

  /**
   * Starts a new decal in a free slot (else the most-faded fading slot, else a live slot nobody matched this frame —
   * call it after every `match` of the frame). Returns the slot or -1 when full.
   */
  create(kind: number, sub: number, x: number, z: number, rot: number, r1: number, r2: number, r3: number, prog: number): number {
    const best = this.allocate();
    if (best < 0) return -1;
    this.state[best] = SLOT_LIVE;
    this.kind[best] = kind;
    this.sub[best] = sub;
    this.age[best] = 0;
    this.fadeT[best] = 0;
    this.dirty[best] = 2;
    if (best >= this.high) this.high = best + 1;
    this.claimed[best] = 1;
    this.x[best] = x;
    this.z[best] = z;
    this.rot[best] = rot;
    this.r1[best] = r1;
    this.r2[best] = r2;
    this.r3[best] = r3;
    this.prog[best] = prog;
    return best;
  }

  /** match, else create (single-pass convenience; prefer match-all-then-create-all when slots can run out). */
  claim(kind: number, sub: number, x: number, z: number, rot: number, r1: number, r2: number, r3: number, prog: number): number {
    const m = this.match(kind, sub, x, z, rot, r1, r2, r3, prog);
    return m >= 0 ? m : this.create(kind, sub, x, z, rot, r1, r2, r3, prog);
  }

  /** Call after all claims: unclaimed live slots start fading, fading ones expire, ages advance. */
  end(dt: number): void {
    let high = 0;
    let live = 0;
    for (let i = 0; i < this.high; i++) {
      const st = this.state[i];
      if (st === SLOT_LIVE) {
        if (this.claimed[i] === 0) {
          this.state[i] = SLOT_FADING;
          this.fadeT[i] = 0;
          this.prog[i] = 1;
        } else {
          this.age[i] = (this.age[i] as number) + dt;
          live++;
        }
      } else if (st === SLOT_FADING) {
        this.fadeT[i] = (this.fadeT[i] as number) + dt;
        if ((this.fadeT[i] as number) >= this.fadeOut) this.state[i] = SLOT_FREE;
      }
      if (this.state[i] !== SLOT_FREE) high = i + 1;
    }
    this.high = high;
    this.liveCount = live;
  }

  /** Per-slot opacity: fade-in while live, fade-out while fading. */
  alphaOf(i: number): number {
    if (this.state[i] === SLOT_FADING) {
      const u = 1 - (this.fadeT[i] as number) / this.fadeOut;
      return u <= 0 ? 0 : u * u;
    }
    const u = Math.min(1, (this.age[i] as number) / this.fadeIn);
    return u * u * (3 - 2 * u);
  }

  clear(): void {
    this.state.fill(SLOT_FREE);
    this.high = 0;
    this.liveCount = 0;
  }

  private allocate(): number {
    for (let i = 0; i < this.cap; i++) if (this.state[i] === SLOT_FREE) return i;
    let victim = -1;
    let most = -1;
    for (let i = 0; i < this.cap; i++) {
      if (this.state[i] === SLOT_FADING && (this.fadeT[i] as number) > most) {
        most = this.fadeT[i] as number;
        victim = i;
      }
    }
    if (victim >= 0) return victim;
    for (let i = 0; i < this.cap; i++) if (this.state[i] === SLOT_LIVE && this.claimed[i] === 0) return i;
    return -1;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Shared GLSL

/** Hash / noise / rune helpers shared by the telegraph and ring fragment shaders. */
export const FX_GLSL_LIB = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a; vec2 ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// angular-ish "rune": strokes picked by hash from a fixed candidate set. p in [-0.5,0.5]^2. Returns coverage 0..1.
float runeMask(vec2 p, float id, float aaw) {
  float h0 = hash11(id * 1.37 + 0.5); float h1 = hash11(id * 2.11 + 3.1); float h2 = hash11(id * 3.73 + 7.7);
  float h3 = hash11(id * 5.19 + 1.3); float h4 = hash11(id * 7.57 + 9.9); float h5 = hash11(id * 11.3 + 2.2);
  float h6 = hash11(id * 13.1 + 5.5); float h7 = hash11(id * 17.9 + 8.8);
  float d = 1e3;
  if (h0 > 0.12) d = min(d, sdSeg(p, vec2(0.0, -0.38), vec2(0.0, 0.38)));
  if (h1 > 0.45) d = min(d, sdSeg(p, vec2(-0.27, 0.38), vec2(0.0, 0.13)));
  if (h2 > 0.55) d = min(d, sdSeg(p, vec2(0.27, 0.38), vec2(0.0, 0.13)));
  if (h3 > 0.5) d = min(d, sdSeg(p, vec2(-0.25, -0.02), vec2(0.25, -0.02)));
  if (h4 > 0.5) d = min(d, sdSeg(p, vec2(-0.27, -0.38), vec2(0.0, -0.08)));
  if (h5 > 0.55) d = min(d, sdSeg(p, vec2(0.28, -0.2), vec2(0.0, -0.38)));
  if (h6 > 0.62) d = min(d, sdSeg(p, vec2(0.27, 0.3), vec2(0.27, -0.1)));
  if (h7 > 0.7) d = min(d, length(p - vec2(-0.25, -0.27)) - 0.02);
  if (d > 100.0) d = sdSeg(p, vec2(-0.2, 0.0), vec2(0.2, 0.0));
  return 1.0 - smoothstep(0.045 - aaw, 0.045 + aaw, d);
}
// soft-edged band: 1 within half-width hw of c, antialiased by aa
float band(float x, float c, float hw, float aa) { hw = max(hw, aa); return 1.0 - smoothstep(hw - aa, hw + aa, abs(x - c)); }
// "over" accumulator: col holds PREMULTIPLIED colour (divide by a once at the end), a is the coverage
void layer(inout vec3 col, inout float a, vec3 c, float ca) {
  col = c * ca + col * (1.0 - ca);
  a = ca + a * (1.0 - ca);
}
`;

/**
 * Generic decal vertex stage. Slot parameters come from a RGBA32F texture, TEXELS texels per slot:
 *   p0 = (kind, sub, progress/strength, rot)   p1 = (r1, r2, r3, alpha)   p2 = local rect (x0,x1,z0,z1)
 *   p3 = (originX, originZ, seed, aux)         p4 = (extra rgb, w)
 * position.xy = grid uv (0..1), position.z = slot; aH = terrain height (CPU sampled).
 */
export const DECAL_VERT = /* glsl */ `
attribute float aH;
uniform sampler2D uParams;
flat varying float vKind;
flat varying float vSub;
flat varying float vProg;
flat varying float vR1;
flat varying float vR2;
flat varying float vR3;
flat varying float vAlpha;
flat varying float vSeed;
flat varying float vAux;
flat varying vec4 vExtra;
varying vec2 vL;
void main() {
  int slot = int(position.z + 0.5);
  vec4 p0 = texelFetch(uParams, ivec2(slot * ${TEXELS}, 0), 0);
  vec4 p1 = texelFetch(uParams, ivec2(slot * ${TEXELS} + 1, 0), 0);
  vec4 p2 = texelFetch(uParams, ivec2(slot * ${TEXELS} + 2, 0), 0);
  vec4 p3 = texelFetch(uParams, ivec2(slot * ${TEXELS} + 3, 0), 0);
  vec4 p4 = texelFetch(uParams, ivec2(slot * ${TEXELS} + 4, 0), 0);
  if (p1.w <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 l = vec2(mix(p2.x, p2.y, position.x), mix(p2.z, p2.w, position.y));
  float c = cos(p0.w);
  float s = sin(p0.w);
  vec2 w = p3.xy + vec2(c * l.x + s * l.y, -s * l.x + c * l.y);
  vKind = p0.x; vSub = p0.y; vProg = p0.z;
  vR1 = p1.x; vR2 = p1.y; vR3 = p1.z; vAlpha = p1.w;
  vSeed = p3.z; vAux = p3.w; vExtra = p4;
  vL = l;
  gl_Position = projectionMatrix * viewMatrix * vec4(w.x, aH, w.y, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------------------------
// GPU slot grid (shared with groundRings.ts)

export type RectFn = (kind: number, r1: number, r2: number, r3: number, out: Float32Array, o: number) => void;

export interface DecalGridOptions {
  cap: number;
  rect: RectFn;
  fragmentShader: string;
  uniforms: Record<string, IUniform>;
  slots?: DecalSlotsOptions;
  renderOrder: number;
  name: string;
  /** max non-fresh slots whose heights are recomputed per frame */
  heightBudget?: number;
  /** shader #defines (e.g. LOW for the cheap look on the low tier) */
  defines?: Record<string, string | number>;
}

const LIFT_BASE = 0.045;
const LIFT_PER_M = 0.03;
/** terrain height samples are taken no closer than this (m): the terrain grid itself is no finer */
export const HEIGHT_SAMPLE_M = 0.5;

/**
 * Bilinear upsample of an (nx+1)×(nz+1) lattice (row-major, stride nx+1) into a (G+1)×(G+1) vertex block written at
 * `out[o...]`, adding `add` to every vertex. nx, nz ≥ 1.
 */
export function upsampleLattice(lat: Float32Array, nx: number, nz: number, G: number, out: Float32Array, o: number, add: number): void {
  const stride = nx + 1;
  for (let j = 0; j <= G; j++) {
    const v = (j / G) * nz;
    const j0 = Math.min(nz - 1, Math.floor(v));
    const fv = v - j0;
    const r0 = j0 * stride;
    const r1 = r0 + stride;
    for (let k = 0; k <= G; k++) {
      const u = (k / G) * nx;
      const i0 = Math.min(nx - 1, Math.floor(u));
      const fu = u - i0;
      const a = lat[r0 + i0] as number;
      const b = lat[r0 + i0 + 1] as number;
      const c = lat[r1 + i0] as number;
      const d = lat[r1 + i0 + 1] as number;
      const top = a + (b - a) * fu;
      out[o + j * (G + 1) + k] = top + (c + (d - c) * fu - top) * fv + add;
    }
  }
}


export class DecalGrid {
  readonly slots: DecalSlots;
  readonly mesh: Mesh;
  /** per-slot extra payload written by the owner (p4: rgb + w) */
  readonly extra: Float32Array;
  /** heights recomputed last commit (stat) */
  heightsComputed = 0;

  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly paramTex: DataTexture;
  private readonly params: Float32Array;
  private readonly rects: Float32Array;
  private readonly heights: Float32Array;
  private readonly heightAttr: BufferAttribute;
  private readonly rectFn: RectFn;
  private readonly heightBudget: number;
  private cursor = 0;
  private readonly tmp = { x: 0, z: 0 };

  /**
   * The sampler the stored heights were computed with, held WEAKLY: this grid lives as long as the renderer while the
   * sampler is a closure over the current run (`core.heightAt = (x, z) => session.field.heightAt(x, z)`), so a strong
   * reference kept the last RunSession - its world, terrain field (~6 MB) and zone scene - alive after the run was quit,
   * one run's worth of memory per cycle. A collected sampler simply reads as "changed" on the next commit.
   */
  private heightFn: WeakRef<(x: number, z: number) => number> | null = null;

  constructor(o: DecalGridOptions) {
    const cap = o.cap;
    this.slots = new DecalSlots(cap, o.slots);
    this.rectFn = o.rect;
    this.heightBudget = o.heightBudget ?? 6;
    this.extra = new Float32Array(cap * 4);
    this.params = new Float32Array(cap * TEXELS * 4);
    this.rects = new Float32Array(cap * 4);
    this.heights = new Float32Array(cap * VERTS_PER_SLOT);

    const g = new BufferGeometry();
    const pos = new Float32Array(cap * VERTS_PER_SLOT * 3);
    const G = DECAL_GRID;
    for (let s = 0; s < cap; s++) {
      for (let j = 0; j <= G; j++) {
        for (let i = 0; i <= G; i++) {
          const v = (s * VERTS_PER_SLOT + j * (G + 1) + i) * 3;
          pos[v] = i / G;
          pos[v + 1] = j / G;
          pos[v + 2] = s;
        }
      }
    }
    const total = cap * VERTS_PER_SLOT;
    const index = total > 65535 ? new Uint32Array(cap * INDICES_PER_SLOT) : new Uint16Array(cap * INDICES_PER_SLOT);
    for (let s = 0; s < cap; s++) {
      let w = s * INDICES_PER_SLOT;
      const base = s * VERTS_PER_SLOT;
      for (let j = 0; j < G; j++) {
        for (let i = 0; i < G; i++) {
          const a = base + j * (G + 1) + i;
          const b = a + 1;
          const c = a + (G + 1);
          const d = c + 1;
          index[w++] = a;
          index[w++] = c;
          index[w++] = b;
          index[w++] = b;
          index[w++] = c;
          index[w++] = d;
        }
      }
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    this.heightAttr = new BufferAttribute(this.heights, 1);
    this.heightAttr.setUsage(35048);
    g.setAttribute('aH', this.heightAttr);
    g.setIndex(new BufferAttribute(index, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;

    this.paramTex = new DataTexture(this.params, cap * TEXELS, 1, RGBAFormat, FloatType);
    this.paramTex.minFilter = NearestFilter;
    this.paramTex.magFilter = NearestFilter;
    this.paramTex.generateMipmaps = false;
    this.paramTex.needsUpdate = true;

    this.material = new ShaderMaterial({
      uniforms: { ...o.uniforms, uParams: { value: this.paramTex } },
      vertexShader: DECAL_VERT,
      fragmentShader: o.fragmentShader,
      defines: { ...o.defines },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: NormalBlending,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder;
    this.mesh.name = o.name;
    this.mesh.visible = false;
  }

  /** Marks every live decal's heights stale (terrain replaced / edited under existing decals). */
  invalidate(): void {
    const s = this.slots;
    for (let i = 0; i < s.high; i++) if (s.state[i] === SLOT_LIVE) s.dirty[i] = 2;
  }

  /** Samples heights for dirty slots (new ones always, moved ones within budget) and uploads slot params. */
  commit(heightAt: (x: number, z: number) => number): void {
    const s = this.slots;
    this.heightsComputed = 0;
    if (heightAt !== this.heightFn?.deref()) {
      // a new zone / terrain sampler (or the previous one was collected): everything already placed is stale
      this.heightFn = new WeakRef(heightAt);
      this.invalidate();
    }
    let budget = this.heightBudget;
    const n = s.high;
    // fresh / never-computed slots first (they must not draw with stale heights), then a rotating budget of moved ones
    for (let i = 0; i < n; i++) {
      if (s.dirty[i] === 2 && s.state[i] === 1) this.computeHeights(i, heightAt);
    }
    for (let k = 0; k < n && budget > 0; k++) {
      const i = (this.cursor + k) % n;
      if (s.dirty[i] === 1 && s.state[i] === 1) {
        this.computeHeights(i, heightAt);
        budget--;
      }
    }
    this.cursor = n > 0 ? (this.cursor + 1) % n : 0;

    const p = this.params;
    for (let i = 0; i < n; i++) {
      const o = i * TEXELS * 4;
      if (s.state[i] === 0) {
        p[o + 7] = 0; // alpha = 0 → vertex stage collapses the slot
        continue;
      }
      p[o] = s.kind[i] as number;
      p[o + 1] = s.sub[i] as number;
      p[o + 2] = s.prog[i] as number;
      p[o + 3] = s.rot[i] as number;
      p[o + 4] = s.r1[i] as number;
      p[o + 5] = s.r2[i] as number;
      p[o + 6] = s.r3[i] as number;
      p[o + 7] = s.alphaOf(i);
      p[o + 8] = this.rects[i * 4] as number;
      p[o + 9] = this.rects[i * 4 + 1] as number;
      p[o + 10] = this.rects[i * 4 + 2] as number;
      p[o + 11] = this.rects[i * 4 + 3] as number;
      p[o + 12] = s.x[i] as number;
      p[o + 13] = s.z[i] as number;
      p[o + 14] = i * 7.31;
      p[o + 15] = s.state[i] === 2 ? Math.max(0.001, (s.fadeT[i] as number) / s.fadeOut) : 0;
      p[o + 16] = this.extra[i * 4] as number;
      p[o + 17] = this.extra[i * 4 + 1] as number;
      p[o + 18] = this.extra[i * 4 + 2] as number;
      p[o + 19] = this.extra[i * 4 + 3] as number;
    }
    this.paramTex.needsUpdate = true;
    this.geometry.setDrawRange(0, n * INDICES_PER_SLOT);
    this.mesh.visible = n > 0;
  }

  private readonly lattice = new Float32Array((DECAL_GRID + 1) * (DECAL_GRID + 1));

  private computeHeights(i: number, heightAt: (x: number, z: number) => number): void {
    const s = this.slots;
    this.rectFn(s.kind[i] as number, s.r1[i] as number, s.r2[i] as number, s.r3[i] as number, this.rects, i * 4);
    const x0 = this.rects[i * 4] as number;
    const x1 = this.rects[i * 4 + 1] as number;
    const z0 = this.rects[i * 4 + 2] as number;
    const z1 = this.rects[i * 4 + 3] as number;
    const ox = s.x[i] as number;
    const oz = s.z[i] as number;
    const rot = s.rot[i] as number;
    const G = DECAL_GRID;
    // sample no finer than HEIGHT_SAMPLE_M (the terrain itself is no finer), then upsample to the vertex grid
    const nx = Math.min(G, Math.max(4, Math.ceil((x1 - x0) / HEIGHT_SAMPLE_M)));
    const nz = Math.min(G, Math.max(4, Math.ceil((z1 - z0) / HEIGHT_SAMPLE_M)));
    const lift = LIFT_BASE + LIFT_PER_M * Math.max((x1 - x0) / nx, (z1 - z0) / nz);
    const base = i * VERTS_PER_SLOT;
    const w = this.tmp;
    const lat = this.lattice;
    for (let j = 0; j <= nz; j++) {
      const lz = z0 + ((z1 - z0) * j) / nz;
      for (let k = 0; k <= nx; k++) {
        const lx = x0 + ((x1 - x0) * k) / nx;
        decalWorld(ox, oz, rot, lx, lz, w);
        lat[j * (nx + 1) + k] = heightAt(w.x, w.z);
      }
    }
    upsampleLattice(lat, nx, nz, G, this.heights, base, lift);
    this.heightAttr.addUpdateRange(base, VERTS_PER_SLOT);
    this.heightAttr.needsUpdate = true;
    s.hx[i] = ox;
    s.hz[i] = oz;
    s.hrot[i] = rot;
    s.hr1[i] = s.r1[i] as number;
    s.hr2[i] = s.r2[i] as number;
    s.hr3[i] = s.r3[i] as number;
    s.dirty[i] = 0;
    this.heightsComputed++;
  }

  dispose(): void {
    this.heightFn = null;
    this.geometry.dispose();
    this.material.dispose();
    this.paramTex.dispose();
  }
}

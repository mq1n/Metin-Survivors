// GPU batches. Each batch = one draw call, one pre-sized interleaved instance buffer, ring/free-list slot allocation,
// and a single persistent dirty range per buffer (no per-frame allocation).
import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DataArrayTexture,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Uint16BufferAttribute,
  ZeroFactor,
  type IUniform,
  type Texture,
} from 'three';
import { heroGuardUniforms } from './heroGuard';
import { DEBRIS_FRAG, DEBRIS_VERT, FLASH_FRAG, FLASH_VERT } from './shaders/debris';
import { PARTICLE_FRAG, PARTICLE_VERT } from './shaders/particles';
import { RIBBON_FRAG, RIBBON_VERT } from './shaders/ribbons';
import { SHAPE_FRAG, SHAPE_VERT } from './shaders/shapes';

export interface SharedUniforms {
  uTime: IUniform<number>;
  uAtlas: IUniform<Texture | null>;
  uNoise: IUniform<Texture | null>;
  uDepth: IUniform<Texture | null>;
  uInvRes: IUniform<{ x: number; y: number }>;
  uNearFar: IUniform<{ x: number; y: number }>;
  uSoft: IUniform<number>;
  /** C3 bridge: the spec runtime's generated-art texture array + cells per layer side (Fx.spec binds the spec host's own
   *  uniform objects here, so there is one art system); absent = a 1x1 empty placeholder until the spec host exists */
  uSpecArt?: IUniform<Texture | null>;
  uArtGrid?: IUniform<number>;
}

export type BlendKind = 'add' | 'alpha';

export function blendMaterial(mat: ShaderMaterial, kind: BlendKind): void {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.fog = false;
  mat.blending = CustomBlending;
  mat.blendEquation = AddEquation;
  mat.blendEquationAlpha = AddEquation;
  mat.blendSrc = OneFactor;
  if (kind === 'add') {
    mat.blendDst = OneFactor;
    mat.blendSrcAlpha = ZeroFactor;
    mat.blendDstAlpha = OneFactor;
  } else {
    mat.blendDst = OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = OneFactor;
    mat.blendDstAlpha = OneMinusSrcAlphaFactor;
  }
}

/** Persistent update-range holder: one object per buffer, mutated and re-pushed each flush. */
export class Dirty {
  private readonly range = { start: 0, count: 0 };
  lo = Infinity;
  hi = 0;
  constructor(private readonly buf: InterleavedBuffer, private readonly stride: number) {}
  mark(slot: number): void {
    if (slot < this.lo) this.lo = slot;
    if (slot + 1 > this.hi) this.hi = slot + 1;
  }
  flush(): void {
    if (this.hi === 0) return;
    const s = this.lo * this.stride;
    const e = this.hi * this.stride;
    const pending = this.buf.updateRanges;
    if (pending.length > 0) {
      // not uploaded yet (several update() steps without a render in between): grow the pending range instead of replacing it
      const end = Math.max(this.range.start + this.range.count, e);
      this.range.start = Math.min(this.range.start, s);
      this.range.count = end - this.range.start;
    } else {
      this.range.start = s;
      this.range.count = e - s;
      pending.push(this.range);
    }
    this.buf.version++;
    this.lo = Infinity;
    this.hi = 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export const P_STRIDE = 20;
const HANDLE_SLOT_BITS = 12;
const HANDLE_SLOT_MASK = (1 << HANDLE_SLOT_BITS) - 1;
const HANDLE_GEN_MASK = 0x7ffff;

function nextGen(prev: number): number {
  const g = (prev + 1) & HANDLE_GEN_MASK;
  return g === 0 ? 1 : g;
}

/** 1x1x1 transparent array texture: what `uSpecArt` holds until the spec host binds its own (the sampler must be valid) */
function emptyArt(): Texture {
  const t = new DataArrayTexture(new Uint8Array(4), 1, 1, 1);
  t.needsUpdate = true;
  return t;
}

/** Ring-buffer particle batch (additive or premultiplied-alpha). */
export class ParticleBatch {
  readonly mesh: Mesh;
  readonly geo: InstancedBufferGeometry;
  readonly mat: ShaderMaterial;
  readonly f: Float32Array;
  readonly c: Uint32Array;
  readonly endT: Float32Array;
  readonly capacity: number;
  /** active ring size (≤ capacity) */
  cap: number;
  head = 0;
  used = 0;
  private readonly fBuf: InstancedInterleavedBuffer;
  private readonly cBuf: InstancedInterleavedBuffer;
  private readonly dF: Dirty;
  private readonly dC: Dirty;

  constructor(capacity: number, kind: BlendKind, u: SharedUniforms) {
    this.capacity = capacity;
    this.cap = capacity;
    this.f = new Float32Array(capacity * P_STRIDE);
    this.c = new Uint32Array(capacity * 2);
    this.endT = new Float32Array(capacity);
    // park every slot in the past so nothing renders before it is written
    for (let i = 0; i < capacity; i++) {
      this.f[i * P_STRIDE + 3] = -1e6;
      this.f[i * P_STRIDE + 7] = 1;
      this.f[i * P_STRIDE + 16] = -9999;
    }
    this.fBuf = new InstancedInterleavedBuffer(this.f, P_STRIDE, 1).setUsage(DynamicDrawUsage);
    this.cBuf = new InstancedInterleavedBuffer(new Uint8Array(this.c.buffer), 8, 1).setUsage(DynamicDrawUsage);
    this.dF = new Dirty(this.fBuf, P_STRIDE);
    this.dC = new Dirty(this.cBuf, 8);
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    g.setAttribute('aA', new InterleavedBufferAttribute(this.fBuf, 4, 0));
    g.setAttribute('aB', new InterleavedBufferAttribute(this.fBuf, 4, 4));
    g.setAttribute('aC', new InterleavedBufferAttribute(this.fBuf, 4, 8));
    g.setAttribute('aD', new InterleavedBufferAttribute(this.fBuf, 4, 12));
    g.setAttribute('aE', new InterleavedBufferAttribute(this.fBuf, 4, 16));
    g.setAttribute('aCol0', new InterleavedBufferAttribute(this.cBuf, 4, 0, true));
    g.setAttribute('aCol1', new InterleavedBufferAttribute(this.cBuf, 4, 4, true));
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uTime: u.uTime,
        uAtlas: u.uAtlas,
        uDepth: u.uDepth,
        uInvRes: u.uInvRes,
        uNearFar: u.uNearFar,
        uSoft: u.uSoft,
        uSpecArt: u.uSpecArt ?? { value: emptyArt() },
        uArtGrid: u.uArtGrid ?? { value: 1 },
        ...heroGuardUniforms,
      },
    });
    blendMaterial(this.mat, kind);
    this.mat.side = DoubleSide;
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
  }

  /** shares the spec runtime's art array uniforms (packed art roles in `cell` then sample the generated sprites) */
  bindArt(art: IUniform<Texture | null>, grid: IUniform<number>): void {
    this.mat.uniforms.uSpecArt = art;
    this.mat.uniforms.uArtGrid = grid;
  }

  alloc(): number {
    if (this.cap <= 0) return -1;
    const i = this.head >= this.cap ? 0 : this.head;
    this.head = i + 1 >= this.cap ? 0 : i + 1;
    if (i + 1 > this.used) this.used = i + 1;
    this.dF.mark(i);
    this.dC.mark(i);
    return i;
  }

  /** ring size follows the quality profile (slots beyond the new cap die naturally and are reclaimed once expired) */
  setCap(n: number): void {
    this.cap = Math.max(0, Math.min(n, this.capacity));
    if (this.head >= this.cap) this.head = 0;
  }

  /** trims expired trailing slots so idle or downgraded batches converge to live usage and submit 0 instances when empty */
  reclaim(now: number): void {
    while (this.used > 0 && (this.endT[this.used - 1] as number) <= now) this.used--;
    if (this.used === 0) this.head = 0;
    else if (this.head > this.used) this.head = this.used < this.cap ? this.used : 0;
  }

  flush(now?: number): void {
    if (now !== undefined) this.reclaim(now);
    this.dF.flush();
    this.dC.flush();
    this.geo.instanceCount = this.used;
    this.mesh.visible = this.used > 0;
  }

  live(now: number): number {
    let n = 0;
    for (let i = 0; i < this.used; i++) if ((this.endT[i] as number) > now) n++;
    return n;
  }

  clear(): void {
    const prev = this.used;
    for (let i = 0; i < this.capacity; i++) {
      this.f[i * P_STRIDE + 3] = -1e6;
      this.endT[i] = 0;
    }
    if (prev > 0) {
      this.dF.lo = 0;
      this.dF.hi = prev;
      this.dC.lo = 0;
      this.dC.hi = prev;
    } else {
      this.dF.lo = Infinity;
      this.dF.hi = 0;
      this.dC.lo = Infinity;
      this.dC.hi = 0;
    }
    this.head = 0;
    this.used = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export const S_STRIDE = 28;
export const SHAPE_NEVER = 1e9;

/** Slot-pool batch of parametric shapes (arcs, rings, decals, beams...). */
export class ShapeBatch {
  readonly mesh: Mesh;
  readonly geo: InstancedBufferGeometry;
  readonly mat: ShaderMaterial;
  readonly f: Float32Array;
  readonly c: Uint32Array;
  readonly endT: Float32Array;
  readonly pinned: Uint8Array;
  readonly gen: Uint32Array;
  readonly capacity: number;
  cap: number;
  used = 0;
  private cursor = 0;
  private readonly fBuf: InstancedInterleavedBuffer;
  private readonly cBuf: InstancedInterleavedBuffer;
  private readonly dF: Dirty;
  private readonly dC: Dirty;

  constructor(capacity: number, kind: BlendKind, u: SharedUniforms) {
    this.capacity = capacity;
    this.cap = capacity;
    this.f = new Float32Array(capacity * S_STRIDE);
    this.c = new Uint32Array(capacity * 2);
    this.endT = new Float32Array(capacity);
    this.pinned = new Uint8Array(capacity);
    this.gen = new Uint32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      const o = i * S_STRIDE;
      this.f[o + 3] = -1e6;
      this.f[o + 7] = 1;
      this.f[o + 22] = SHAPE_NEVER;
    }
    this.fBuf = new InstancedInterleavedBuffer(this.f, S_STRIDE, 1).setUsage(DynamicDrawUsage);
    this.cBuf = new InstancedInterleavedBuffer(new Uint8Array(this.c.buffer), 8, 1).setUsage(DynamicDrawUsage);
    this.dF = new Dirty(this.fBuf, S_STRIDE);
    this.dC = new Dirty(this.cBuf, 8);

    // grid: (NU+1) x (NV+1) vertices carrying (u, v)
    const NU = 48;
    const NV = 4;
    const pos = new Float32Array((NU + 1) * (NV + 1) * 3);
    const idx = new Uint16Array(NU * NV * 6);
    let p = 0;
    for (let j = 0; j <= NV; j++) {
      for (let i = 0; i <= NU; i++) {
        pos[p++] = i / NU;
        pos[p++] = j / NV;
        pos[p++] = 0;
      }
    }
    let q = 0;
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const a = j * (NU + 1) + i;
        const b = a + 1;
        const c = a + (NU + 1);
        const d = c + 1;
        idx[q++] = a;
        idx[q++] = b;
        idx[q++] = c;
        idx[q++] = c;
        idx[q++] = b;
        idx[q++] = d;
      }
    }
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setIndex(new Uint16BufferAttribute(idx, 1));
    for (let k = 0; k < 7; k++) g.setAttribute('s' + 'ABCDEFG'[k]!, new InterleavedBufferAttribute(this.fBuf, 4, k * 4));
    g.setAttribute('sCol0', new InterleavedBufferAttribute(this.cBuf, 4, 0, true));
    g.setAttribute('sCol1', new InterleavedBufferAttribute(this.cBuf, 4, 4, true));
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new ShaderMaterial({
      vertexShader: SHAPE_VERT,
      fragmentShader: SHAPE_FRAG,
      uniforms: { uTime: u.uTime, uNoise: u.uNoise, uAtlas: u.uAtlas, ...heroGuardUniforms },
    });
    blendMaterial(this.mat, kind);
    this.mat.side = DoubleSide; // arcs / cylinders are viewed from both sides
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
  }

  /** Finds a free (expired, unpinned) slot; steals the oldest unpinned slot when full, or returns -1 if every slot is pinned. */
  alloc(now: number): number {
    const cap = this.cap;
    if (cap <= 0) return -1;
    let i = this.cursor >= cap ? 0 : this.cursor;
    let found = -1;
    let oldestUnpinned = -1;
    let oldestEnd = Infinity;
    for (let n = 0; n < cap; n++) {
      if (i >= cap) i = 0;
      if (this.pinned[i] === 0) {
        const end = this.endT[i] as number;
        if (end <= now) {
          found = i;
          break;
        }
        if (end < oldestEnd) {
          oldestEnd = end;
          oldestUnpinned = i;
        }
      }
      i++;
    }
    const slot = found >= 0 ? found : oldestUnpinned;
    if (slot < 0) return -1;
    this.gen[slot] = nextGen(this.gen[slot] as number);
    this.cursor = slot + 1 >= cap ? 0 : slot + 1;
    if (slot + 1 > this.used) this.used = slot + 1;
    this.dF.mark(slot);
    this.dC.mark(slot);
    return slot;
  }

  /** encodes slot + current generation into a positive Int32 handle (-1 for invalid slots) */
  handleOf(slot: number): number {
    if (slot < 0 || slot >= this.capacity) return -1;
    const g = this.gen[slot] as number;
    return g === 0 ? -1 : (g << HANDLE_SLOT_BITS) | slot;
  }

  /** validates a generation-stamped handle and returns its slot index, or -1 if invalid/stale */
  resolveHandle(handle: number): number {
    if (handle < 0) return -1;
    const slot = handle & HANDLE_SLOT_MASK;
    const g = handle >>> HANDLE_SLOT_BITS;
    if (g === 0 || slot >= this.capacity || (this.gen[slot] as number) !== g) return -1;
    return slot;
  }

  setCap(n: number): void {
    this.cap = Math.max(0, Math.min(n, this.capacity));
    if (this.cursor >= this.cap) this.cursor = 0;
  }

  reclaim(now: number): void {
    while (this.used > 0 && this.pinned[this.used - 1] === 0 && (this.endT[this.used - 1] as number) <= now) {
      this.used--;
    }
    if (this.used === 0) this.cursor = 0;
    else if (this.cursor > this.used) this.cursor = this.used < this.cap ? this.used : 0;
  }

  /** marks a slot's float record as modified (move / kill) */
  touch(slot: number): void {
    this.dF.mark(slot);
  }

  flush(now?: number): void {
    if (now !== undefined) this.reclaim(now);
    this.dF.flush();
    this.dC.flush();
    this.geo.instanceCount = this.used;
    this.mesh.visible = this.used > 0;
  }

  live(now: number): number {
    let n = 0;
    for (let i = 0; i < this.used; i++) if ((this.endT[i] as number) > now) n++;
    return n;
  }

  clear(): void {
    const prev = this.used;
    for (let i = 0; i < this.capacity; i++) {
      const o = i * S_STRIDE;
      this.f[o + 3] = -1e6;
      this.f[o + 22] = SHAPE_NEVER;
      this.endT[i] = 0;
      this.pinned[i] = 0;
      this.gen[i] = nextGen(this.gen[i] as number);
    }
    if (prev > 0) {
      this.dF.lo = 0;
      this.dF.hi = prev;
      this.dC.lo = 0;
      this.dC.hi = prev;
    } else {
      this.dF.lo = Infinity;
      this.dF.hi = 0;
      this.dC.lo = Infinity;
      this.dC.hi = 0;
    }
    this.cursor = 0;
    this.used = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export const R_PTS = 32; // points per chunk
export const R_VERTS = R_PTS * 2;
export const R_STRIDE = 14; // pos3 dir3 rP4 rQ4

/** Ribbon (polyline) batch: fixed-size chunks written by the CPU, faded by per-vertex birth/life in the shader. */
export class RibbonBatch {
  readonly mesh: Mesh;
  readonly geo: BufferGeometry;
  readonly mat: ShaderMaterial;
  readonly f: Float32Array;
  readonly c: Uint32Array;
  readonly endT: Float32Array;
  readonly pinned: Uint8Array;
  readonly gen: Uint32Array;
  readonly capacity: number;
  cap: number;
  used = 0;
  private cursor = 0;
  private readonly fBuf: InterleavedBuffer;
  private readonly cBuf: InterleavedBuffer;
  private readonly dF: Dirty;
  private readonly dC: Dirty;

  constructor(chunks: number, u: SharedUniforms) {
    this.capacity = chunks;
    this.cap = chunks;
    const verts = chunks * R_VERTS;
    this.f = new Float32Array(verts * R_STRIDE);
    this.c = new Uint32Array(verts);
    this.endT = new Float32Array(chunks);
    this.pinned = new Uint8Array(chunks);
    this.gen = new Uint32Array(chunks);
    for (let v = 0; v < verts; v++) {
      this.f[v * R_STRIDE + 9] = 1;
      this.f[v * R_STRIDE + 8] = -1e6;
    }
    this.fBuf = new InterleavedBuffer(this.f, R_STRIDE).setUsage(DynamicDrawUsage);
    this.cBuf = new InterleavedBuffer(new Uint8Array(this.c.buffer), 4).setUsage(DynamicDrawUsage);
    this.dF = new Dirty(this.fBuf, R_VERTS * R_STRIDE);
    this.dC = new Dirty(this.cBuf, R_VERTS * 4);
    const g = new BufferGeometry();
    g.setAttribute('position', new InterleavedBufferAttribute(this.fBuf, 3, 0));
    g.setAttribute('rDir', new InterleavedBufferAttribute(this.fBuf, 3, 3));
    g.setAttribute('rP', new InterleavedBufferAttribute(this.fBuf, 4, 6));
    g.setAttribute('rQ', new InterleavedBufferAttribute(this.fBuf, 4, 10));
    g.setAttribute('rCol', new InterleavedBufferAttribute(this.cBuf, 4, 0, true));
    const per = (R_PTS - 1) * 6;
    const idx = new Uint16Array(chunks * per);
    let n = 0;
    for (let ch = 0; ch < chunks; ch++) {
      const base = ch * R_VERTS;
      for (let k = 0; k < R_PTS - 1; k++) {
        const a = base + k * 2;
        idx[n++] = a;
        idx[n++] = a + 1;
        idx[n++] = a + 2;
        idx[n++] = a + 2;
        idx[n++] = a + 1;
        idx[n++] = a + 3;
      }
    }
    g.setIndex(new BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new ShaderMaterial({
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      uniforms: { uTime: u.uTime, uNoise: u.uNoise, ...heroGuardUniforms },
    });
    blendMaterial(this.mat, 'add');
    this.mat.side = DoubleSide;
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
  }

  /** Finds a free (expired, unpinned) chunk; steals the oldest unpinned chunk when full, or returns -1 if every chunk is pinned. */
  alloc(now: number): number {
    const cap = this.cap;
    if (cap <= 0) return -1;
    let i = this.cursor >= cap ? 0 : this.cursor;
    let found = -1;
    let oldestUnpinned = -1;
    let oldestEnd = Infinity;
    for (let n = 0; n < cap; n++) {
      if (i >= cap) i = 0;
      if (this.pinned[i] === 0) {
        const end = this.endT[i] as number;
        if (end <= now) {
          found = i;
          break;
        }
        if (end < oldestEnd) {
          oldestEnd = end;
          oldestUnpinned = i;
        }
      }
      i++;
    }
    const chunk = found >= 0 ? found : oldestUnpinned;
    if (chunk < 0) return -1;
    this.gen[chunk] = nextGen(this.gen[chunk] as number);
    this.cursor = chunk + 1 >= cap ? 0 : chunk + 1;
    if (chunk + 1 > this.used) this.used = chunk + 1;
    this.dF.mark(chunk);
    this.dC.mark(chunk);
    return chunk;
  }

  handleOf(chunk: number): number {
    if (chunk < 0 || chunk >= this.capacity) return -1;
    const g = this.gen[chunk] as number;
    return g === 0 ? -1 : (g << HANDLE_SLOT_BITS) | chunk;
  }

  resolveHandle(handle: number): number {
    if (handle < 0) return -1;
    const chunk = handle & HANDLE_SLOT_MASK;
    const g = handle >>> HANDLE_SLOT_BITS;
    if (g === 0 || chunk >= this.capacity || (this.gen[chunk] as number) !== g) return -1;
    return chunk;
  }

  setCap(n: number): void {
    this.cap = Math.max(0, Math.min(n, this.capacity));
    if (this.cursor >= this.cap) this.cursor = 0;
  }

  reclaim(now: number): void {
    while (this.used > 0 && this.pinned[this.used - 1] === 0 && (this.endT[this.used - 1] as number) <= now) {
      this.used--;
    }
    if (this.used === 0) this.cursor = 0;
    else if (this.cursor > this.used) this.cursor = this.used < this.cap ? this.used : 0;
  }

  /**
   * Writes one chunk from `n` points (pts stride 7: x y z halfWidth u birth life). Tangents come from neighbours;
   * unused trailing points repeat the last one with zero width (degenerate triangles). Colours lerp c0→c1 along u.
   */
  writeStrip(chunk: number, n: number, pts: Float32Array, style: number, intensity: number, fcode: number, seed: number, c0: number, c1: number): void {
    const f = this.f;
    const base = chunk * R_VERTS;
    const ar = c0 & 255, ag = (c0 >>> 8) & 255, ab = (c0 >>> 16) & 255, aa = c0 >>> 24;
    const br = c1 & 255, bg = (c1 >>> 8) & 255, bb = (c1 >>> 16) & 255, ba = c1 >>> 24;
    for (let k = 0; k < R_PTS; k++) {
      const i = k < n ? k : n - 1;
      const o = i * 7;
      const ia = (i > 0 ? i - 1 : 0) * 7;
      const ib = (i < n - 1 ? i + 1 : n - 1) * 7;
      let dx = (pts[ib] as number) - (pts[ia] as number);
      let dy = (pts[ib + 1] as number) - (pts[ia + 1] as number);
      let dz = (pts[ib + 2] as number) - (pts[ia + 2] as number);
      const dl = Math.hypot(dx, dy, dz);
      if (dl > 1e-6) {
        dx /= dl;
        dy /= dl;
        dz /= dl;
      } else {
        dx = 0;
        dy = 0;
        dz = 1;
      }
      const hw = k < n ? (pts[o + 3] as number) : 0;
      const u = pts[o + 4] as number;
      const t = u < 0 ? 0 : u > 1 ? 1 : u;
      const col =
        ((ar + (br - ar) * t) | 0) |
        (((ag + (bg - ag) * t) | 0) << 8) |
        (((ab + (bb - ab) * t) | 0) << 16) |
        (((aa + (ba - aa) * t) | 0) << 24);
      for (let s = 0; s < 2; s++) {
        const v = base + k * 2 + s;
        const q = v * R_STRIDE;
        f[q] = pts[o] as number;
        f[q + 1] = pts[o + 1] as number;
        f[q + 2] = pts[o + 2] as number;
        f[q + 3] = dx;
        f[q + 4] = dy;
        f[q + 5] = dz;
        f[q + 6] = s === 0 ? -hw : hw;
        f[q + 7] = u;
        f[q + 8] = pts[o + 5] as number;
        f[q + 9] = pts[o + 6] as number;
        f[q + 10] = intensity;
        f[q + 11] = style;
        f[q + 12] = fcode;
        f[q + 13] = seed;
        this.c[v] = col >>> 0;
      }
    }
    this.touch(chunk);
  }

  touch(chunk: number): void {
    this.dF.mark(chunk);
    this.dC.mark(chunk);
  }

  flush(now?: number): void {
    if (now !== undefined) this.reclaim(now);
    this.dF.flush();
    this.dC.flush();
    this.geo.setDrawRange(0, this.used * (R_PTS - 1) * 6);
    this.mesh.visible = this.used > 0;
  }

  live(now: number): number {
    let n = 0;
    for (let i = 0; i < this.used; i++) if ((this.endT[i] as number) > now) n++;
    return n;
  }

  clear(): void {
    const prev = this.used;
    for (let v = 0; v < this.capacity * R_VERTS; v++) this.f[v * R_STRIDE + 8] = -1e6;
    this.endT.fill(0);
    this.pinned.fill(0);
    for (let i = 0; i < this.capacity; i++) this.gen[i] = nextGen(this.gen[i] as number);
    if (prev > 0) {
      this.dF.lo = 0;
      this.dF.hi = prev;
      this.dC.lo = 0;
      this.dC.hi = prev;
    } else {
      this.dF.lo = Infinity;
      this.dF.hi = 0;
      this.dC.lo = Infinity;
      this.dC.hi = 0;
    }
    this.cursor = 0;
    this.used = 0;
    this.geo.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export const D_STRIDE = 20;

function shardGeometry(): InstancedBufferGeometry {
  // irregular pentagonal bipyramid, flat shaded (30 vertices)
  const rad = [0.5, 0.38, 0.55, 0.42, 0.47];
  const ring: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    ring.push([Math.cos(a) * (rad[i] as number), (i % 2) * 0.09 - 0.04, Math.sin(a) * (rad[i] as number)]);
  }
  const top = [0.04, 0.98, -0.02];
  const bot = [-0.03, -0.52, 0.04];
  const pos: number[] = [];
  const nrm: number[] = [];
  const tri = (a: number[], b: number[], c: number[]): void => {
    const ux = (b[0] as number) - (a[0] as number), uy = (b[1] as number) - (a[1] as number), uz = (b[2] as number) - (a[2] as number);
    const vx = (c[0] as number) - (a[0] as number), vy = (c[1] as number) - (a[1] as number), vz = (c[2] as number) - (a[2] as number);
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const v of [a, b, c]) {
      pos.push(v[0] as number, v[1] as number, v[2] as number);
      nrm.push(nx, ny, nz);
    }
  };
  for (let i = 0; i < 5; i++) {
    const a = ring[i] as number[];
    const b = ring[(i + 1) % 5] as number[];
    tri(top, b, a);
    tri(bot, a, b);
  }
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  return g;
}

/** Instanced tumbling shards (opaque, depth-written). */
export class DebrisBatch {
  readonly mesh: Mesh;
  readonly geo: InstancedBufferGeometry;
  readonly mat: ShaderMaterial;
  readonly f: Float32Array;
  readonly c: Uint32Array;
  readonly endT: Float32Array;
  readonly capacity: number;
  cap: number;
  head = 0;
  used = 0;
  private readonly fBuf: InstancedInterleavedBuffer;
  private readonly cBuf: InstancedInterleavedBuffer;
  private readonly dF: Dirty;
  private readonly dC: Dirty;

  constructor(capacity: number, u: SharedUniforms) {
    this.capacity = capacity;
    this.cap = capacity;
    this.f = new Float32Array(capacity * D_STRIDE);
    this.c = new Uint32Array(capacity * 2);
    this.endT = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.f[i * D_STRIDE + 3] = -1e6;
      this.f[i * D_STRIDE + 7] = 1;
      this.f[i * D_STRIDE + 12] = -9.8;
    }
    this.fBuf = new InstancedInterleavedBuffer(this.f, D_STRIDE, 1).setUsage(DynamicDrawUsage);
    this.cBuf = new InstancedInterleavedBuffer(new Uint8Array(this.c.buffer), 8, 1).setUsage(DynamicDrawUsage);
    this.dF = new Dirty(this.fBuf, D_STRIDE);
    this.dC = new Dirty(this.cBuf, 8);
    const g = shardGeometry();
    g.setAttribute('dA', new InterleavedBufferAttribute(this.fBuf, 4, 0));
    g.setAttribute('dB', new InterleavedBufferAttribute(this.fBuf, 4, 4));
    g.setAttribute('dC', new InterleavedBufferAttribute(this.fBuf, 4, 8));
    g.setAttribute('dD', new InterleavedBufferAttribute(this.fBuf, 4, 12));
    g.setAttribute('dCol0', new InterleavedBufferAttribute(this.cBuf, 4, 0, true));
    g.setAttribute('dCol1', new InterleavedBufferAttribute(this.cBuf, 4, 4, true));
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new ShaderMaterial({ vertexShader: DEBRIS_VERT, fragmentShader: DEBRIS_FRAG, uniforms: { uTime: u.uTime } });
    this.mat.fog = false;
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
  }

  alloc(): number {
    if (this.cap <= 0) return -1;
    const i = this.head >= this.cap ? 0 : this.head;
    this.head = i + 1 >= this.cap ? 0 : i + 1;
    if (i + 1 > this.used) this.used = i + 1;
    this.dF.mark(i);
    this.dC.mark(i);
    return i;
  }

  setCap(n: number): void {
    this.cap = Math.max(0, Math.min(n, this.capacity));
    if (this.head >= this.cap) this.head = 0;
  }

  reclaim(now: number): void {
    while (this.used > 0 && (this.endT[this.used - 1] as number) <= now) this.used--;
    if (this.used === 0) this.head = 0;
    else if (this.head > this.used) this.head = this.used < this.cap ? this.used : 0;
  }

  flush(now?: number): void {
    if (now !== undefined) this.reclaim(now);
    this.dF.flush();
    this.dC.flush();
    this.geo.instanceCount = this.used;
    this.mesh.visible = this.used > 0;
  }

  live(now: number): number {
    let n = 0;
    for (let i = 0; i < this.used; i++) if ((this.endT[i] as number) > now) n++;
    return n;
  }

  clear(): void {
    const prev = this.used;
    for (let i = 0; i < this.capacity; i++) {
      this.f[i * D_STRIDE + 3] = -1e6;
      this.endT[i] = 0;
    }
    if (prev > 0) {
      this.dF.lo = 0;
      this.dF.hi = prev;
      this.dC.lo = 0;
      this.dC.hi = prev;
    } else {
      this.dF.lo = Infinity;
      this.dF.hi = 0;
      this.dC.lo = Infinity;
      this.dC.hi = 0;
    }
    this.head = 0;
    this.used = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/** Full-screen additive flash quad (hidden while idle, so it costs no draw call). */
export class FlashQuad {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private readonly col: { x: number; y: number; z: number; w: number };
  constructor() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    this.mat = new ShaderMaterial({
      vertexShader: FLASH_VERT,
      fragmentShader: FLASH_FRAG,
      uniforms: { uColor: { value: { x: 0, y: 0, z: 0, w: 0 } } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
    });
    this.mat.toneMapped = false;
    this.col = this.mat.uniforms.uColor!.value as { x: number; y: number; z: number; w: number };
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }
  set(r: number, g: number, b: number, a: number): void {
    this.col.x = r * a;
    this.col.y = g * a;
    this.col.z = b * a;
    this.col.w = a;
    this.mesh.visible = a > 0.004;
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

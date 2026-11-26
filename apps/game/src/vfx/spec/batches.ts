// Spec batches: one instanced draw per blend family for particles (+ trail segments) and for parametric surfaces
// (≤ 4 draw calls total). The additive batches blend premultiplied (ONE, ONE_MINUS_SRC_ALPHA) with alpha 0 for plain
// additive records, so an element's `occlude` (soft core: darkens what is behind it) costs no extra draw call.
import {
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Uint16BufferAttribute,
  type IUniform,
  type Texture,
} from 'three';
import { Dirty, blendMaterial, type BlendKind } from '../batches';
import { heroGuardUniforms } from '../heroGuard';
import { SPEC_PARTICLE_FRAG, SPEC_PARTICLE_VERT, SPEC_SURFACE_FRAG, SPEC_SURFACE_VERT, SURF_NU, SURF_NV } from './shaders';

export interface SpecUniforms {
  uTime: IUniform<number>;
  uLut: IUniform<Texture | null>;
  uAnchors: IUniform<Texture | null>;
  uSpecAtlas: IUniform<Texture | null>;
  /** generated-art texture array (art.ts) */
  uSpecArt: IUniform<Texture | null>;
  /** cells per art layer side */
  uArtGrid: IUniform<number>;
  /** display-space batches (display.ts): 1 while the overlay pass draws them onto the canvas, 0 inside the scene pass */
  uOverlay: IUniform<number>;
  /** 1 = test against uSceneDepth in the shader (post path), 0 = the canvas depth buffer still holds the scene */
  uDepthOn: IUniform<number>;
  uSceneDepth: IUniform<Texture | null>;
  /** 1 / drawing-buffer size of the picture uSceneDepth belongs to */
  uInvRes: IUniform<{ x: number; y: number }>;
  /** camera near / far and the soft distance (m) of the overlay's depth fade (z 0 = hard test): see shaders.ts displayFade */
  uSoftZ: IUniform<{ x: number; y: number; z: number }>;
}

/** floats per record (both batches) */
export const REC = 24;

/** Ring-buffer instanced batch; `kind` picks the particle quad or the surface grid. `display` = the additive batch of the
 *  display-space layer (display.ts, shaders.ts SPEC_DISPLAY). */
export class SpecBatch {
  readonly mesh: Mesh;
  readonly f: Float32Array;
  readonly endT: Float32Array;
  readonly capacity: number;
  cap: number;
  head = 0;
  used = 0;
  private readonly geo: InstancedBufferGeometry;
  private readonly mat: ShaderMaterial;
  private readonly dirty: Dirty;

  constructor(capacity: number, blend: BlendKind, surface: boolean, u: SpecUniforms, display = false) {
    this.capacity = capacity;
    this.cap = capacity;
    this.f = new Float32Array(capacity * REC);
    this.endT = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.f[i * REC + 3] = -1e6;
      this.f[i * REC + 7] = 1;
    }
    const buf = new InstancedInterleavedBuffer(this.f, REC, 1).setUsage(DynamicDrawUsage);
    this.dirty = new Dirty(buf, REC);
    const g = new InstancedBufferGeometry();
    const prefix = surface ? 's' : 'a';
    if (surface) {
      const pos = new Float32Array((SURF_NU + 1) * (SURF_NV + 1) * 3);
      const idx = new Uint16Array(SURF_NU * SURF_NV * 6);
      let p = 0;
      for (let j = 0; j <= SURF_NV; j++) {
        for (let i = 0; i <= SURF_NU; i++) {
          pos[p++] = i / SURF_NU;
          pos[p++] = j / SURF_NV;
          pos[p++] = 0;
        }
      }
      let q = 0;
      for (let j = 0; j < SURF_NV; j++) {
        for (let i = 0; i < SURF_NU; i++) {
          const a = j * (SURF_NU + 1) + i;
          idx[q++] = a;
          idx[q++] = a + 1;
          idx[q++] = a + SURF_NU + 1;
          idx[q++] = a + SURF_NU + 1;
          idx[q++] = a + 1;
          idx[q++] = a + SURF_NU + 2;
        }
      }
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setIndex(new Uint16BufferAttribute(idx, 1));
    } else {
      g.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
      g.setIndex([0, 1, 2, 2, 1, 3]);
    }
    for (let k = 0; k < 6; k++) g.setAttribute(prefix + 'ABCDEF'[k]!, new InterleavedBufferAttribute(buf, 4, k * 4));
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new ShaderMaterial({
      vertexShader: surface ? SPEC_SURFACE_VERT : SPEC_PARTICLE_VERT,
      fragmentShader: surface ? SPEC_SURFACE_FRAG : SPEC_PARTICLE_FRAG,
      uniforms: {
        ...heroGuardUniforms,
        uTime: u.uTime,
        uLut: u.uLut,
        uAnchors: u.uAnchors,
        uSpecAtlas: u.uSpecAtlas,
        uSpecArt: u.uSpecArt,
        uArtGrid: u.uArtGrid,
        ...(display ? { uOverlay: u.uOverlay, uDepthOn: u.uDepthOn, uSceneDepth: u.uSceneDepth, uInvRes: u.uInvRes, uSoftZ: u.uSoftZ } : {}),
      },
      defines: display ? { SPEC_ADD: 1, SPEC_DISPLAY: 1 } : blend === 'add' ? { SPEC_ADD: 1 } : {},
    });
    blendMaterial(this.mat, blend);
    // additive records write alpha 0 (identical to ONE, ONE); `occlude` records write alpha > 0 and darken the background
    if (blend === 'add') this.mat.blendDst = OneMinusSrcAlphaFactor;
    this.mat.side = DoubleSide;
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** reserves the next ring slot and returns its float offset */
  alloc(): number {
    const i = this.head;
    this.head = i + 1 >= this.cap ? 0 : i + 1;
    if (i + 1 > this.used) this.used = i + 1;
    this.dirty.mark(i);
    return i;
  }

  setCap(n: number): void {
    this.cap = Math.max(1, Math.min(n, this.capacity));
    if (this.head >= this.cap) this.head = 0;
  }

  flush(now: number): void {
    this.dirty.flush();
    this.geo.instanceCount = this.used;
    // hide the draw once every record has expired (no draw call while idle)
    if (this.used > 0) {
      let alive = false;
      for (let i = 0; i < this.used; i++) {
        if ((this.endT[i] as number) > now) {
          alive = true;
          break;
        }
      }
      if (!alive) {
        this.used = 0;
        this.head = 0;
        this.geo.instanceCount = 0;
      }
    }
    this.mesh.visible = this.used > 0;
  }

  live(now: number): number {
    let n = 0;
    for (let i = 0; i < this.used; i++) if ((this.endT[i] as number) > now) n++;
    return n;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      this.f[i * REC + 3] = -1e6;
      this.endT[i] = 0;
    }
    this.dirty.lo = 0;
    this.dirty.hi = this.capacity;
    this.head = 0;
    this.used = 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

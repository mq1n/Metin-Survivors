// MeshBuilder: accumulates triangles with per-vertex colour (baked shading), uv, surface kind and emission into ONE
// BufferGeometry (prop-local space, metres, Y up, ground at y = 0). A transform stack positions primitives; every
// primitive is a parametric `grid` (smooth or faceted), so lofts / lathes / roofs / tubes share one normal path.
import { BufferAttribute, BufferGeometry, Color, Matrix3, Matrix4, Vector3, type ColorRepresentation } from 'three';
import { bakeAO, type AoOptions } from './ao';
import { KIND } from './kinds';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/** What a primitive is made of: base colour (sRGB in, linear stored), material kind, emission, brightness jitter. */
export interface Paint {
  readonly c: Color;
  readonly k: number;
  readonly e: number;
  /** ± brightness variation applied per primitive (per quad when faceted): the hand-painted look */
  readonly j: number;
}

export function paint(c: ColorRepresentation, k: number = KIND.plain, e = 0, j = 0.03): Paint {
  return { c: new Color(c), k, e, j };
}

/** brightness-scaled copy */
export function lit(p: Paint, f: number): Paint {
  return { ...p, c: p.c.clone().multiplyScalar(f) };
}

/** copy with another kind / emission */
export function recast(p: Paint, k: number, e = p.e): Paint {
  return { ...p, k, e };
}

export function mixPaint(a: Paint, b: Paint, t: number): Paint {
  return { c: a.c.clone().lerp(b.c, t), k: t < 0.5 ? a.k : b.k, e: a.e + (b.e - a.e) * t, j: a.j };
}

export interface GridOpts {
  /** reverse the facing (default front = dPdu × dPdv) */
  flip?: boolean;
  /** u=0 and u=1 columns coincide (rings): normals are merged across the seam */
  closedU?: boolean;
  /** flat shading per quad (each quad gets its own vertices and brightness jitter) */
  faceted?: boolean;
  /** uv per vertex (default (u, v)); `n` is the vertex normal */
  uv?: (u: number, v: number, p: Vec3, n: Vec3) => Vec2;
  /** brightness multiplier per vertex (baked shading / gradients); `cell` = quad index (i + j·nu) when faceted, else -1 */
  shade?: (u: number, v: number, p: Vec3, cell: number) => number;
  /** per-vertex colour edit (starts as the paint colour) */
  color?: (u: number, v: number, p: Vec3, out: Color, cell: number) => void;
  /** per-vertex emission override */
  emis?: (u: number, v: number, p: Vec3) => number;
}

const _v = new Vector3();
const _n = new Vector3();
const _c = new Color();
const _t = new Matrix4();

export class MeshBuilder {
  /** per-label triangle counts of the most recent build() (modelling budget accounting) */
  static lastReport: Record<string, number> = {};
  private counts: Record<string, number> = {};
  private tag = '';
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly uvs: number[] = [];
  private readonly mat: number[] = [];
  private readonly idx: number[] = [];
  private readonly m = new Matrix4();
  private readonly nm = new Matrix3();
  private readonly stack: Matrix4[] = [];
  private rs: number;

  constructor(seed = 1) {
    this.rs = (seed >>> 0) || 0x9e3779b9;
  }

  /** deterministic uniform [0,1) */
  rand(): number {
    let t = (this.rs = (this.rs + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triCount(): number {
    return this.idx.length / 3;
  }

  // --- transform stack -------------------------------------------------------------------------------------------

  push(): this {
    this.stack.push(this.m.clone());
    return this;
  }

  pop(): this {
    const t = this.stack.pop();
    if (t) this.m.copy(t);
    this.nm.getNormalMatrix(this.m);
    return this;
  }

  private mul(t: Matrix4): this {
    this.m.multiply(t);
    this.nm.getNormalMatrix(this.m);
    return this;
  }

  translate(x: number, y: number, z: number): this {
    return this.mul(_t.makeTranslation(x, y, z));
  }

  rotY(a: number): this {
    return this.mul(_t.makeRotationY(a));
  }

  rotX(a: number): this {
    return this.mul(_t.makeRotationX(a));
  }

  rotZ(a: number): this {
    return this.mul(_t.makeRotationZ(a));
  }

  scale(sx: number, sy = sx, sz = sx): this {
    return this.mul(_t.makeScale(sx, sy, sz));
  }

  /** push + translate + yaw + uniform scale; pair with pop() */
  at(x: number, y: number, z: number, yaw = 0, s = 1): this {
    this.push().translate(x, y, z);
    if (yaw !== 0) this.rotY(yaw);
    if (s !== 1) this.scale(s);
    return this;
  }

  // --- raw emission ----------------------------------------------------------------------------------------------

  /** adds one vertex (position / normal transformed by the current matrix); returns its index */
  vert(p: Vec3, n: Vec3, r: number, g: number, b: number, u: number, v: number, kind: number, emis: number): number {
    _v.set(p[0], p[1], p[2]).applyMatrix4(this.m);
    _n.set(n[0], n[1], n[2]).applyMatrix3(this.nm).normalize();
    const i = this.pos.length / 3;
    this.pos.push(_v.x, _v.y, _v.z);
    this.nor.push(_n.x, _n.y, _n.z);
    this.col.push(r, g, b);
    this.uvs.push(u, v);
    this.mat.push(kind, emis, 1);
    return i;
  }

  /** names the triangles that follow in the budget report */
  label(name: string): this {
    this.tag = name;
    return this;
  }

  tri(a: number, b: number, c: number): this {
    this.idx.push(a, b, c);
    this.counts[this.tag] = (this.counts[this.tag] ?? 0) + 1;
    return this;
  }

  // --- parametric surface ----------------------------------------------------------------------------------------

  /**
   * (nu × nv) quad grid over u,v ∈ [0,1]; `fn` writes the position of (u, v). Front side = dPdu × dPdv (unless flip).
   * Degenerate triangles (poles / apexes) are dropped.
   */
  grid(nu: number, nv: number, fn: (u: number, v: number, out: Vec3) => void, p: Paint, o: GridOpts = {}): this {
    const cols = nu + 1;
    const rows = nv + 1;
    const P = new Float32Array(cols * rows * 3);
    const t: Vec3 = [0, 0, 0];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        fn(i / nu, j / nv, t);
        const k = (j * cols + i) * 3;
        P[k] = t[0];
        P[k + 1] = t[1];
        P[k + 2] = t[2];
      }
    }
    const sgn = o.flip ? -1 : 1;
    const faceN = new Float32Array(nu * nv * 3);
    const N = new Float32Array(cols * rows * 3);
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = (j * cols + i) * 3;
        const b = a + 3;
        const c = a + cols * 3 + 3;
        const d = a + cols * 3;
        const e1x = (P[c] as number) - (P[a] as number);
        const e1y = (P[c + 1] as number) - (P[a + 1] as number);
        const e1z = (P[c + 2] as number) - (P[a + 2] as number);
        const e2x = (P[d] as number) - (P[b] as number);
        const e2y = (P[d + 1] as number) - (P[b + 1] as number);
        const e2z = (P[d + 2] as number) - (P[b + 2] as number);
        const nx = (e1y * e2z - e1z * e2y) * sgn;
        const ny = (e1z * e2x - e1x * e2z) * sgn;
        const nz = (e1x * e2y - e1y * e2x) * sgn;
        const f = (j * nu + i) * 3;
        faceN[f] = nx;
        faceN[f + 1] = ny;
        faceN[f + 2] = nz;
        for (const q of [a, b, c, d]) {
          N[q] = (N[q] as number) + nx;
          N[q + 1] = (N[q + 1] as number) + ny;
          N[q + 2] = (N[q + 2] as number) + nz;
        }
      }
    }
    if (o.closedU) {
      for (let j = 0; j < rows; j++) {
        const a = j * cols * 3;
        const b = a + nu * 3;
        for (let c = 0; c < 3; c++) {
          const s = (N[a + c] as number) + (N[b + c] as number);
          N[a + c] = s;
          N[b + c] = s;
        }
      }
    }

    const vertexOut = (i: number, j: number, n: Vec3, jm: number, cell: number): number => {
      const k = (j * cols + i) * 3;
      const u = i / nu;
      const v = j / nv;
      const pos: Vec3 = [P[k] as number, P[k + 1] as number, P[k + 2] as number];
      _c.copy(p.c);
      if (o.color) o.color(u, v, pos, _c, cell);
      const mult = jm * (o.shade ? o.shade(u, v, pos, cell) : 1);
      const uv = o.uv ? o.uv(u, v, pos, n) : ([u, v] as Vec2);
      return this.vert(pos, n, _c.r * mult, _c.g * mult, _c.b * mult, uv[0], uv[1], p.k, o.emis ? o.emis(u, v, pos) : p.e);
    };
    const area2 = (a: number, b: number, c: number): number => {
      const ax = (P[b * 3] as number) - (P[a * 3] as number);
      const ay = (P[b * 3 + 1] as number) - (P[a * 3 + 1] as number);
      const az = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
      const bx = (P[c * 3] as number) - (P[a * 3] as number);
      const by = (P[c * 3 + 1] as number) - (P[a * 3 + 1] as number);
      const bz = (P[c * 3 + 2] as number) - (P[a * 3 + 2] as number);
      const x = ay * bz - az * by;
      const y = az * bx - ax * bz;
      const z = ax * by - ay * bx;
      return x * x + y * y + z * z;
    };

    const smoothJm = 1 + (this.rand() * 2 - 1) * p.j;
    if (o.faceted) {
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const f = (j * nu + i) * 3;
          const fl = Math.hypot(faceN[f] as number, faceN[f + 1] as number, faceN[f + 2] as number);
          if (fl < 1e-9) continue;
          const n: Vec3 = [(faceN[f] as number) / fl, (faceN[f + 1] as number) / fl, (faceN[f + 2] as number) / fl];
          const jm = 1 + (this.rand() * 2 - 1) * p.j;
          const cell = j * nu + i;
          const la = j * cols + i;
          const lb = la + 1;
          const lc = la + cols + 1;
          const ld = la + cols;
          const t1 = area2(la, lb, lc) > 1e-14;
          const t2 = area2(la, lc, ld) > 1e-14;
          // a degenerate half (fan caps, apex quads) shares three of the four corners: emit only what is used
          const a = vertexOut(i, j, n, jm, cell);
          const bb = t1 ? vertexOut(i + 1, j, n, jm, cell) : -1;
          const c = vertexOut(i + 1, j + 1, n, jm, cell);
          const d = t2 ? vertexOut(i, j + 1, n, jm, cell) : -1;
          if (t1) {
            if (o.flip) this.tri(a, c, bb);
            else this.tri(a, bb, c);
          }
          if (t2) {
            if (o.flip) this.tri(a, d, c);
            else this.tri(a, c, d);
          }
        }
      }
      return this;
    }

    const base = this.vertexCount;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = (j * cols + i) * 3;
        let nx = N[k] as number;
        let ny = N[k + 1] as number;
        let nz = N[k + 2] as number;
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-12) {
          nx = 0;
          ny = 1;
          nz = 0;
        } else {
          nx /= l;
          ny /= l;
          nz /= l;
        }
        vertexOut(i, j, [nx, ny, nz], smoothJm, -1);
      }
    }
    const tp = (i: number, j: number): number => base + j * cols + i;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const la = j * cols + i;
        const lb = la + 1;
        const lc = la + cols + 1;
        const ld = la + cols;
        const a = tp(i, j);
        const b = tp(i + 1, j);
        const c = tp(i + 1, j + 1);
        const d = tp(i, j + 1);
        if (area2(la, lb, lc) > 1e-14) {
          if (o.flip) this.tri(a, c, b);
          else this.tri(a, b, c);
        }
        if (area2(la, lc, ld) > 1e-14) {
          if (o.flip) this.tri(a, d, c);
          else this.tri(a, c, d);
        }
      }
    }
    return this;
  }

  /** appends any three.js geometry (position/normal/uv/index) under the current transform with a flat paint */
  addGeometry(g: BufferGeometry, p: Paint, shade?: (p: Vec3) => number): this {
    const pa = g.getAttribute('position');
    const na = g.getAttribute('normal');
    const ua = g.getAttribute('uv');
    const base = this.vertexCount;
    const jm = 1 + (this.rand() * 2 - 1) * p.j;
    for (let i = 0; i < pa.count; i++) {
      const pos: Vec3 = [pa.getX(i), pa.getY(i), pa.getZ(i)];
      const n: Vec3 = na ? [na.getX(i), na.getY(i), na.getZ(i)] : [0, 1, 0];
      const s = jm * (shade ? shade(pos) : 1);
      this.vert(pos, n, p.c.r * s, p.c.g * s, p.c.b * s, ua ? ua.getX(i) : 0, ua ? ua.getY(i) : 0, p.k, p.e);
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) this.idx.push(base + ix.getX(i));
    else for (let i = 0; i < pa.count; i++) this.idx.push(base + i);
    return this;
  }

  // --- post edits on vertices added since a mark -----------------------------------------------------------------

  mark(): number {
    return this.vertexCount;
  }

  /** moves every vertex added since `from` (positions are final, prop-local) */
  displace(from: number, fn: (p: Vec3) => void): this {
    const t: Vec3 = [0, 0, 0];
    for (let i = from; i < this.vertexCount; i++) {
      t[0] = this.pos[i * 3] as number;
      t[1] = this.pos[i * 3 + 1] as number;
      t[2] = this.pos[i * 3 + 2] as number;
      fn(t);
      this.pos[i * 3] = t[0];
      this.pos[i * 3 + 1] = t[1];
      this.pos[i * 3 + 2] = t[2];
    }
    return this;
  }

  /** multiplies colours of vertices added since `from` by fn(position, normal) */
  shadeFrom(from: number, fn: (p: Vec3, n: Vec3) => number): this {
    for (let i = from; i < this.vertexCount; i++) {
      const f = fn(
        [this.pos[i * 3] as number, this.pos[i * 3 + 1] as number, this.pos[i * 3 + 2] as number],
        [this.nor[i * 3] as number, this.nor[i * 3 + 1] as number, this.nor[i * 3 + 2] as number],
      );
      this.col[i * 3] = (this.col[i * 3] as number) * f;
      this.col[i * 3 + 1] = (this.col[i * 3 + 1] as number) * f;
      this.col[i * 3 + 2] = (this.col[i * 3 + 2] as number) * f;
    }
    return this;
  }

  /** re-estimates normals of vertices added since `from` from the (displaced) triangles */
  recomputeNormals(from: number): this {
    const acc = new Float32Array((this.vertexCount - from) * 3);
    for (let t = 0; t < this.idx.length; t += 3) {
      const ia = this.idx[t] as number;
      const ib = this.idx[t + 1] as number;
      const ic = this.idx[t + 2] as number;
      if (ia < from || ib < from || ic < from) continue;
      const ax = (this.pos[ib * 3] as number) - (this.pos[ia * 3] as number);
      const ay = (this.pos[ib * 3 + 1] as number) - (this.pos[ia * 3 + 1] as number);
      const az = (this.pos[ib * 3 + 2] as number) - (this.pos[ia * 3 + 2] as number);
      const bx = (this.pos[ic * 3] as number) - (this.pos[ia * 3] as number);
      const by = (this.pos[ic * 3 + 1] as number) - (this.pos[ia * 3 + 1] as number);
      const bz = (this.pos[ic * 3 + 2] as number) - (this.pos[ia * 3 + 2] as number);
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      for (const i of [ia, ib, ic]) {
        const k = (i - from) * 3;
        acc[k] = (acc[k] as number) + nx;
        acc[k + 1] = (acc[k + 1] as number) + ny;
        acc[k + 2] = (acc[k + 2] as number) + nz;
      }
    }
    for (let i = from; i < this.vertexCount; i++) {
      const k = (i - from) * 3;
      const l = Math.hypot(acc[k] as number, acc[k + 1] as number, acc[k + 2] as number);
      if (l < 1e-12) continue;
      this.nor[i * 3] = (acc[k] as number) / l;
      this.nor[i * 3 + 1] = (acc[k + 1] as number) / l;
      this.nor[i * 3 + 2] = (acc[k + 2] as number) / l;
    }
    return this;
  }

  // --- output ----------------------------------------------------------------------------------------------------

  /** finished geometry; `ao` bakes voxel ambient occlusion into the vertex colours (false = skip) */
  build(ao: AoOptions | false = {}): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    g.setAttribute('aMat', new BufferAttribute(new Float32Array(this.mat), 3));
    g.setIndex(new BufferAttribute(this.pos.length / 3 > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    MeshBuilder.lastReport = this.counts;
    if (ao !== false) bakeAO(g, ao);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

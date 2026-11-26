// DEV-only: polygonises a Shape (sdf.ts) with surface nets, projects vertices onto the exact iso-surface, and derives
// every vertex attribute procedurally: smooth SDF normals, painted vertex colours (belly/back gradients, noise, fur
// streaks, ambient-occlusion darkening in crevices) and bone weights from per-prim distance falloff.
import { BufferAttribute, BufferGeometry } from 'three';
import { clamp, fbm3, mixRGB, noise3, smoothstep, type RGB } from './math';
import { smax, smin, toHex, type Prim, type Shape } from './sdf';

export interface Shade {
  /** 0..1 amount of `bellyColor` (default: lightened coat) on down-facing surface */
  belly?: number;
  bellyColor?: RGB;
  /** 0..1 darkening towards `backColor` (default: coat × 0.62) on up-facing surface */
  back?: number;
  backColor?: RGB;
  /** blotch noise amplitude (multiplicative, ±) and frequency (1/m) */
  noise?: number;
  noiseScale?: number;
  /** fur streak noise amplitude; streaks run along local Z */
  fur?: number;
  furScale?: number;
  /** 0..1 crevice darkening, probe radius (m) and multiplier colour of full occlusion */
  ao?: number;
  aoRadius?: number;
  /** coat pattern: tiger stripes (per metre along Z) or leopard spots (noise frequency 1/m) */
  pattern?: { kind: 'stripes' | 'spots'; color: RGB; scale: number; amount: number };
  aoTint?: RGB;
  /** bottom-to-top vertical brightness ramp (1 = off) measured over the shape's height */
  rampLow?: number;
}

export interface MeshOptions {
  /** grid cell (m) — the resolution/tri-count knob */
  cell: number;
  /** 0 = static mesh (no skin attributes) */
  boneCount: number;
  /** skin weight falloff length (m) */
  sigma?: number;
  /** base colour blend length (m) */
  tau?: number;
  shade?: Shade;
  seed?: number;
  maxInfluences?: number;
  /** crisp per-face normals (rocks, crystals) */
  flat?: boolean;
}

export interface BuiltMesh {
  geometry: BufferGeometry;
  tris: number;
  verts: number;
  min: [number, number, number];
  max: [number, number, number];
  /** up to 4 dominant colours, `#rrggbb` sRGB */
  palette: string[];
}

const BIG = 1;

export class Field {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly f: Float32Array;

  constructor(
    readonly ox: number,
    readonly oy: number,
    readonly oz: number,
    readonly h: number,
    nx: number,
    ny: number,
    nz: number,
  ) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.f = new Float32Array(nx * ny * nz).fill(BIG);
  }

  /** trilinear sample */
  sample(x: number, y: number, z: number): number {
    const { nx, ny, nz, f, h } = this;
    let fx = (x - this.ox) / h;
    let fy = (y - this.oy) / h;
    let fz = (z - this.oz) / h;
    fx = fx < 0 ? 0 : fx > nx - 1.001 ? nx - 1.001 : fx;
    fy = fy < 0 ? 0 : fy > ny - 1.001 ? ny - 1.001 : fy;
    fz = fz < 0 ? 0 : fz > nz - 1.001 ? nz - 1.001 : fz;
    const ix = fx | 0;
    const iy = fy | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const ty = fy - iy;
    const tz = fz - iz;
    const b = ix + nx * (iy + ny * iz);
    const sl = nx * ny;
    const c000 = f[b] as number;
    const c100 = f[b + 1] as number;
    const c010 = f[b + nx] as number;
    const c110 = f[b + nx + 1] as number;
    const c001 = f[b + sl] as number;
    const c101 = f[b + sl + 1] as number;
    const c011 = f[b + sl + nx] as number;
    const c111 = f[b + sl + nx + 1] as number;
    const x00 = c000 + (c100 - c000) * tx;
    const x10 = c010 + (c110 - c010) * tx;
    const x01 = c001 + (c101 - c001) * tx;
    const x11 = c011 + (c111 - c011) * tx;
    const y0 = x00 + (x10 - x00) * ty;
    const y1 = x01 + (x11 - x01) * ty;
    return y0 + (y1 - y0) * tz;
  }

  gradient(x: number, y: number, z: number, out: [number, number, number]): void {
    const e = this.h * 0.6;
    out[0] = this.sample(x + e, y, z) - this.sample(x - e, y, z);
    out[1] = this.sample(x, y + e, z) - this.sample(x, y - e, z);
    out[2] = this.sample(x, y, z + e) - this.sample(x, y, z - e);
  }
}

export function fillField(shape: Shape, h: number): Field {
  const b = shape.bounds();
  let maxK = 0;
  for (const p of shape.prims) if (p.op !== 'paint') maxK = Math.max(maxK, p.k);
  const pad = Math.ceil(maxK / h) + 3;
  const ox = b.min[0] - pad * h;
  const oy = b.min[1] - pad * h;
  const oz = b.min[2] - pad * h;
  const nx = Math.ceil((b.max[0] - b.min[0]) / h) + 2 * pad + 1;
  const ny = Math.ceil((b.max[1] - b.min[1]) / h) + 2 * pad + 1;
  const nz = Math.ceil((b.max[2] - b.min[2]) / h) + 2 * pad + 1;
  const field = new Field(ox, oy, oz, h, nx, ny, nz);
  const f = field.f;
  for (const p of shape.prims) {
    if (p.op === 'paint') continue;
    const margin = p.k + 2 * h;
    const i0 = Math.max(0, Math.floor((p.bmin[0] - margin - ox) / h));
    const i1 = Math.min(nx - 1, Math.ceil((p.bmax[0] + margin - ox) / h));
    const j0 = Math.max(0, Math.floor((p.bmin[1] - margin - oy) / h));
    const j1 = Math.min(ny - 1, Math.ceil((p.bmax[1] + margin - oy) / h));
    const k0 = Math.max(0, Math.floor((p.bmin[2] - margin - oz) / h));
    const k1 = Math.min(nz - 1, Math.ceil((p.bmax[2] + margin - oz) / h));
    const add = p.op === 'add';
    for (let k = k0; k <= k1; k++) {
      const z = oz + k * h;
      for (let j = j0; j <= j1; j++) {
        const y = oy + j * h;
        let idx = i0 + nx * (j + ny * k);
        for (let i = i0; i <= i1; i++, idx++) {
          const d = p.dist(ox + i * h, y, z);
          const cur = f[idx] as number;
          f[idx] = add ? smin(cur, d, p.k) : smax(cur, -d, p.k);
        }
      }
    }
  }
  if (shape.rough) {
    const { amp, scale, seed } = shape.rough;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const idx = i + nx * (j + ny * k);
          const v = f[idx] as number;
          if (Math.abs(v) > amp * 3) continue;
          f[idx] = v + (fbm3((ox + i * h) * scale, (oy + j * h) * scale, (oz + k * h) * scale, 3, seed) - 0.5) * 2 * amp;
        }
      }
    }
  }
  return field;
}

// corner order: bit0 x, bit1 y, bit2 z
const EDGE_A = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3];
const EDGE_B = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];

interface RawMesh {
  pos: Float32Array;
  nrm: Float32Array;
  idx: Uint32Array;
}

/** Surface nets on the field; vertices are projected onto the iso-surface and carry gradient normals. */
export function surfaceNets(field: Field): RawMesh {
  const { nx, ny, nz, f, h, ox, oy, oz } = field;
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const sl = nx * ny;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos: number[] = [];
  const fs = new Float64Array(8);
  const CX = [0, 1, 0, 1, 0, 1, 0, 1];
  const CY = [0, 0, 1, 1, 0, 0, 1, 1];
  const CZ = [0, 0, 0, 0, 1, 1, 1, 1];
  for (let z = 0; z < cz; z++) {
    for (let y = 0; y < cy; y++) {
      for (let x = 0; x < cx; x++) {
        const b = x + nx * (y + ny * z);
        fs[0] = f[b] as number;
        fs[1] = f[b + 1] as number;
        fs[2] = f[b + nx] as number;
        fs[3] = f[b + nx + 1] as number;
        fs[4] = f[b + sl] as number;
        fs[5] = f[b + sl + 1] as number;
        fs[6] = f[b + sl + nx] as number;
        fs[7] = f[b + sl + nx + 1] as number;
        let mask = 0;
        for (let c = 0; c < 8; c++) if ((fs[c] as number) < 0) mask |= 1 << c;
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (let e = 0; e < 12; e++) {
          const a = EDGE_A[e] as number;
          const bb = EDGE_B[e] as number;
          if (((mask >> a) & 1) === ((mask >> bb) & 1)) continue;
          const fa = fs[a] as number;
          const fb = fs[bb] as number;
          const t = fa / (fa - fb);
          sx += (CX[a] as number) + t * ((CX[bb] as number) - (CX[a] as number));
          sy += (CY[a] as number) + t * ((CY[bb] as number) - (CY[a] as number));
          sz += (CZ[a] as number) + t * ((CZ[bb] as number) - (CZ[a] as number));
          n++;
        }
        cellVert[x + cx * (y + cy * z)] = pos.length / 3;
        pos.push(ox + (x + sx / n) * h, oy + (y + sy / n) * h, oz + (z + sz / n) * h);
      }
    }
  }

  const quads: number[] = [];
  const cellAt = (axis: number, a: number, u: number, v: number): number => {
    const x = axis === 0 ? a : axis === 1 ? v : u;
    const y = axis === 0 ? u : axis === 1 ? a : v;
    const z = axis === 0 ? v : axis === 1 ? u : a;
    return cellVert[x + cx * (y + cy * z)] as number;
  };
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const b = x + nx * (y + ny * z);
        const s0 = (f[b] as number) < 0;
        for (let axis = 0; axis < 3; axis++) {
          // edge along `axis` starting at this point; (u,v) are the cyclic perpendicular axes
          const a = axis === 0 ? x : axis === 1 ? y : z;
          const u = axis === 0 ? y : axis === 1 ? z : x;
          const v = axis === 0 ? z : axis === 1 ? x : y;
          const amax = axis === 0 ? nx - 2 : axis === 1 ? ny - 2 : nz - 2;
          const umax = axis === 0 ? ny - 2 : axis === 1 ? nz - 2 : nx - 2;
          const vmax = axis === 0 ? nz - 2 : axis === 1 ? nx - 2 : ny - 2;
          if (a > amax || u < 1 || u > umax || v < 1 || v > vmax) continue;
          const nb = b + (axis === 0 ? 1 : axis === 1 ? nx : sl);
          if (s0 === (f[nb] as number) < 0) continue;
          const q0 = cellAt(axis, a, u - 1, v - 1);
          const q1 = cellAt(axis, a, u, v - 1);
          const q2 = cellAt(axis, a, u, v);
          const q3 = cellAt(axis, a, u - 1, v);
          if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) continue;
          if (s0) quads.push(q0, q1, q2, q3);
          else quads.push(q0, q3, q2, q1);
        }
      }
    }
  }

  const nv = pos.length / 3;
  const P = new Float32Array(pos);
  const N = new Float32Array(nv * 3);
  const g: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < nv; i++) {
    let px = P[i * 3] as number;
    let py = P[i * 3 + 1] as number;
    let pz = P[i * 3 + 2] as number;
    for (let it = 0; it < 2; it++) {
      const s = field.sample(px, py, pz);
      field.gradient(px, py, pz, g);
      const gl = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (gl < 1e-12) break;
      // gradient is over a span of 1.2h → |∇f| ≈ 1 ⇒ g·g ≈ (1.2h)²
      let k = (s * 1.2 * h) / gl;
      const maxStep = 0.75 * h;
      const step = Math.abs(k) * Math.sqrt(gl);
      if (step > maxStep) k *= maxStep / step;
      px -= g[0] * k;
      py -= g[1] * k;
      pz -= g[2] * k;
    }
    P[i * 3] = px;
    P[i * 3 + 1] = py;
    P[i * 3 + 2] = pz;
    field.gradient(px, py, pz, g);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    N[i * 3] = g[0] / l;
    N[i * 3 + 1] = g[1] / l;
    N[i * 3 + 2] = g[2] / l;
  }

  const idx: number[] = [];
  const dist = (a: number, b: number): number =>
    Math.hypot(
      (P[a * 3] as number) - (P[b * 3] as number),
      (P[a * 3 + 1] as number) - (P[b * 3 + 1] as number),
      (P[a * 3 + 2] as number) - (P[b * 3 + 2] as number),
    );
  for (let q = 0; q < quads.length; q += 4) {
    const a = quads[q] as number;
    const b = quads[q + 1] as number;
    const c = quads[q + 2] as number;
    const d = quads[q + 3] as number;
    if (dist(a, c) <= dist(b, d)) idx.push(a, b, c, a, c, d);
    else idx.push(a, b, d, b, c, d);
  }
  return { pos: P, nrm: N, idx: new Uint32Array(idx) };
}

/** Full pipeline: shape → BufferGeometry with position/normal/color(/skinIndex/skinWeight). */
export function buildMesh(shape: Shape, opts: MeshOptions): BuiltMesh {
  const field = fillField(shape, opts.cell);
  const raw = surfaceNets(field);
  const nv = raw.pos.length / 3;
  const prims = shape.prims;
  const np = prims.length;
  const tau = opts.tau ?? 0.03;
  const sigmaDef = opts.sigma ?? 0.06;
  const seed = opts.seed ?? 1;
  const sh = opts.shade ?? {};
  const skinned = opts.boneCount > 0;
  const maxInf = Math.min(4, opts.maxInfluences ?? 3);

  const colors = new Float32Array(nv * 3);
  const skinIndex = skinned ? new Uint16Array(nv * 4) : null;
  const skinWeight = skinned ? new Float32Array(nv * 4) : null;
  const dists = new Float64Array(np);
  const reach = new Float64Array(np);
  for (let p = 0; p < np; p++) {
    const pr = prims[p] as Prim;
    reach[p] = pr.op === 'paint' ? pr.soft * 2 + 0.01 : Math.max(7 * tau, 7 * (pr.sigma > 0 ? pr.sigma : sigmaDef));
  }
  const boneW = new Float64Array(Math.max(opts.boneCount, 1));

  const b = shape.bounds();
  const hgt = Math.max(b.max[1] - b.min[1], 1e-3);
  const aoR = sh.aoRadius ?? 0.12;
  const aoTint = sh.aoTint ?? [0.5, 0.42, 0.5];
  const nsc = sh.noiseScale ?? 7;
  const fsc = sh.furScale ?? 24;
  const vmin: [number, number, number] = [Infinity, Infinity, Infinity];
  const vmax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const hist = new Map<number, { n: number; r: number; g: number; b: number }>();

  for (let i = 0; i < nv; i++) {
    const x = raw.pos[i * 3] as number;
    const y = raw.pos[i * 3 + 1] as number;
    const z = raw.pos[i * 3 + 2] as number;
    const nxv = raw.nrm[i * 3] as number;
    const nyv = raw.nrm[i * 3 + 1] as number;
    const nzv = raw.nrm[i * 3 + 2] as number;
    if (x < vmin[0]) vmin[0] = x;
    if (y < vmin[1]) vmin[1] = y;
    if (z < vmin[2]) vmin[2] = z;
    if (x > vmax[0]) vmax[0] = x;
    if (y > vmax[1]) vmax[1] = y;
    if (z > vmax[2]) vmax[2] = z;
    for (let p = 0; p < np; p++) {
      const pr = prims[p] as Prim;
      const m = reach[p] as number;
      dists[p] =
        x < (pr.bmin[0] as number) - m || x > (pr.bmax[0] as number) + m || y < (pr.bmin[1] as number) - m || y > (pr.bmax[1] as number) + m || z < (pr.bmin[2] as number) - m || z > (pr.bmax[2] as number) + m
          ? 1e3
          : pr.dist(x, y, z);
    }

    // base colour: distance-weighted blend of the prims the vertex is closest to
    let wsum = 0;
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let p = 0; p < np; p++) {
      const pr = prims[p] as Prim;
      if (pr.op !== 'add' || pr.cw <= 0) continue;
      const d = dists[p] as number;
      const w = pr.cw * Math.exp(-(d > 0 ? d : 0) / tau);
      wsum += w;
      r += w * pr.color[0];
      g += w * pr.color[1];
      bl += w * pr.color[2];
    }
    if (wsum < 1e-9) {
      wsum = 1;
      r = g = bl = 0.5;
    }
    r /= wsum;
    g /= wsum;
    bl /= wsum;
    // paint layers
    for (let p = 0; p < np; p++) {
      const pr = prims[p] as Prim;
      if (pr.op !== 'paint') continue;
      const m = pr.alpha * smoothstep(pr.soft, -pr.soft, dists[p] as number);
      if (m <= 0) continue;
      r += (pr.color[0] - r) * m;
      g += (pr.color[1] - g) * m;
      bl += (pr.color[2] - bl) * m;
    }
    let col: RGB = [r, g, bl];
    if (sh.belly) {
      const t = smoothstep(-0.05, -0.8, nyv) * sh.belly;
      col = mixRGB(col, sh.bellyColor ?? [Math.min(1, r * 1.55 + 0.02), Math.min(1, g * 1.5 + 0.02), Math.min(1, bl * 1.45 + 0.02)], t);
    }
    if (sh.back) {
      const t = smoothstep(0.2, 0.95, nyv) * sh.back;
      col = mixRGB(col, sh.backColor ?? [r * 0.6, g * 0.6, bl * 0.62], t);
    }
    if (sh.pattern) {
      const pt = sh.pattern;
      let t: number;
      if (pt.kind === 'stripes') {
        const warp = fbm3(x * 3.2, y * 3.2, z * 3.2, 2, seed + 9) * 2.2;
        const s = Math.sin((z * pt.scale + y * pt.scale * 0.28) * Math.PI * 2 + warp * 2.4);
        t = smoothstep(0.25, 0.55, s) * smoothstep(-0.55, 0.15, nyv);
      } else {
        t = smoothstep(0.64, 0.7, noise3(x * pt.scale, y * pt.scale, z * pt.scale, seed + 3));
      }
      col = mixRGB(col, pt.color, t * pt.amount);
    }
    let mul = 1;
    if (sh.noise) mul *= 1 + (fbm3(x * nsc, y * nsc, z * nsc, 3, seed) - 0.5) * 2 * sh.noise;
    if (sh.fur) mul *= 1 + (noise3(x * fsc, y * fsc * 0.8, z * fsc * 0.18, seed + 5) - 0.5) * 2 * sh.fur;
    if (sh.rampLow !== undefined) mul *= sh.rampLow + (1 - sh.rampLow) * smoothstep(0, 1, (y - b.min[1]) / hgt);
    if (sh.ao) {
      let ao = 0;
      const w = [0.5, 0.32, 0.18];
      for (let s = 1; s <= 3; s++) {
        const hh = (aoR * s) / 3;
        const fv = field.sample(x + nxv * hh, y + nyv * hh, z + nzv * hh);
        ao += (w[s - 1] as number) * clamp((hh - fv) / hh, 0, 1);
      }
      const t = clamp(ao * 1.35, 0, 1) * sh.ao;
      col = [col[0] * (1 + (aoTint[0] - 1) * t), col[1] * (1 + (aoTint[1] - 1) * t), col[2] * (1 + (aoTint[2] - 1) * t)];
    }
    colors[i * 3] = clamp(col[0] * mul, 0, 1);
    colors[i * 3 + 1] = clamp(col[1] * mul, 0, 1);
    colors[i * 3 + 2] = clamp(col[2] * mul, 0, 1);

    // palette histogram (coarse, in gamma-ish space)
    const cr = colors[i * 3] as number;
    const cg = colors[i * 3 + 1] as number;
    const cb = colors[i * 3 + 2] as number;
    const key = ((Math.sqrt(cr) * 5) | 0) * 36 + ((Math.sqrt(cg) * 5) | 0) * 6 + ((Math.sqrt(cb) * 5) | 0);
    const hv = hist.get(key);
    if (hv) {
      hv.n++;
      hv.r += cr;
      hv.g += cg;
      hv.b += cb;
    } else hist.set(key, { n: 1, r: cr, g: cg, b: cb });

    if (skinIndex && skinWeight) {
      boneW.fill(0);
      for (let p = 0; p < np; p++) {
        const pr = prims[p] as Prim;
        if (pr.op !== 'add' || pr.skin <= 0) continue;
        const d = dists[p] as number;
        const sg = pr.sigma > 0 ? pr.sigma : sigmaDef;
        boneW[pr.bone] = (boneW[pr.bone] as number) + pr.skin * Math.exp(-(d > 0 ? d : 0) / sg);
      }
      // top-N influences
      let total = 0;
      for (let k = 0; k < maxInf; k++) {
        let best = -1;
        let bw = 0;
        for (let bi = 0; bi < opts.boneCount; bi++) {
          const w = boneW[bi] as number;
          if (w > bw) {
            bw = w;
            best = bi;
          }
        }
        if (best < 0) break;
        skinIndex[i * 4 + k] = best;
        skinWeight[i * 4 + k] = bw;
        total += bw;
        boneW[best] = 0;
      }
      if (total <= 0) {
        skinIndex[i * 4] = 0;
        skinWeight[i * 4] = 1;
        total = 1;
      }
      // drop negligible tails then renormalise
      let kept = 0;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight[i * 4 + k] as number;
        if (w < total * 0.05 && k > 0) {
          skinWeight[i * 4 + k] = 0;
          skinIndex[i * 4 + k] = 0;
        } else kept += w;
      }
      for (let k = 0; k < 4; k++) skinWeight[i * 4 + k] = (skinWeight[i * 4 + k] as number) / kept;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(raw.pos, 3));
  geometry.setAttribute('normal', new BufferAttribute(raw.nrm, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  if (skinIndex && skinWeight) {
    geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  }
  geometry.setIndex(new BufferAttribute(nv < 65535 ? new Uint16Array(raw.idx) : raw.idx, 1));
  if (opts.flat) {
    const flat = geometry.toNonIndexed();
    flat.computeVertexNormals();
    geometry.copy(flat);
  }
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const palette = [...hist.values()]
    .sort((p, q) => q.n - p.n)
    .slice(0, 4)
    .map((e) => toHex([e.r / e.n, e.g / e.n, e.b / e.n]));
  return { geometry, tris: raw.idx.length / 3, verts: nv, min: vmin, max: vmax, palette };
}

/** Concatenates two geometries with identical attribute sets (position/normal/color[/skinIndex/skinWeight]). */
export function mergeGeometry(a: BufferGeometry, b: BufferGeometry): BufferGeometry {
  const out = new BufferGeometry();
  const na = a.getAttribute('position').count;
  const nb = b.getAttribute('position').count;
  for (const name of ['position', 'normal', 'color', 'skinIndex', 'skinWeight']) {
    const A = a.getAttribute(name);
    const B = b.getAttribute(name);
    if (!A || !B) continue;
    const Ctor = A.array.constructor as new (n: number) => Float32Array | Uint16Array;
    const arr = new Ctor(A.array.length + B.array.length);
    arr.set(A.array as ArrayLike<number>);
    arr.set(B.array as ArrayLike<number>, A.array.length);
    out.setAttribute(name, new BufferAttribute(arr, A.itemSize));
  }
  const ia = a.index?.array as ArrayLike<number>;
  const ib = b.index?.array as ArrayLike<number>;
  const idx = new Uint32Array(ia.length + ib.length);
  for (let i = 0; i < ia.length; i++) idx[i] = ia[i] as number;
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = (ib[i] as number) + na;
  out.setIndex(new BufferAttribute(na + nb < 65535 ? new Uint16Array(idx) : idx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

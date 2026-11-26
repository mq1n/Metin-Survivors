// Sparse surface-nets mesher for SDF trees.
//
// 1. An octree of cell blocks is walked top-down. Each node evaluates the (restricted) SDF at its centre; if
//    |d| exceeds Lipschitz * half-diagonal no surface can be inside and the whole subtree is skipped. The SDF is
//    `restrict`ed on the way down, so leaves only evaluate the handful of primitives that can matter there.
// 2. Leaves sample a (B+1)^3 corner lattice. Cells with sign changes get one vertex (mean of edge crossings),
//    then Newton-projected onto the zero level set along the gradient.
// 3. Quads are emitted per sign-changing lattice edge and split along the shorter diagonal.
import type { Aabb } from '../math.ts';
import type { Sdf } from '../sdf/node.ts';

export interface MeshOpts {
  /** cell size in metres */
  voxel: number;
  bounds?: Aabb;
  /** cells per block edge */
  block?: number;
  /** Newton projection iterations for vertices */
  project?: number;
}

export interface RawMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

interface Leaf {
  bx: number;
  by: number;
  bz: number;
  values: Float32Array;
  sdf: Sdf;
  vert: Int32Array;
}

const CORNER = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
] as const;
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], // x edges
  [0, 2], [1, 3], [4, 6], [5, 7], // y edges
  [0, 4], [1, 5], [2, 6], [3, 7], // z edges
] as const;

export function meshSdf(sdf: Sdf, opts: MeshOpts): RawMesh {
  const vox = opts.voxel;
  const B = opts.block ?? 8;
  const iters = opts.project ?? 2;
  const bb = opts.bounds ?? sdf.bounds();
  const pad = vox * 2;
  const ox = bb.min[0] - pad, oy = bb.min[1] - pad, oz = bb.min[2] - pad;
  const nx = Math.ceil((bb.max[0] - bb.min[0] + 2 * pad) / vox);
  const ny = Math.ceil((bb.max[1] - bb.min[1] + 2 * pad) / vox);
  const nz = Math.ceil((bb.max[2] - bb.min[2] + 2 * pad) / vox);
  const bx = Math.ceil(nx / B), by = Math.ceil(ny / B), bz = Math.ceil(nz / B);
  const leafGrid = new Array<Leaf | undefined>(bx * by * bz);
  const leaves: Leaf[] = [];
  const S = B + 1;
  let top = 1;
  while (top < Math.max(bx, by, bz)) top *= 2;

  const visit = (x0: number, y0: number, z0: number, size: number, node: Sdf): void => {
    if (x0 >= bx || y0 >= by || z0 >= bz) return;
    const edge = size * B * vox;
    const cx = ox + (x0 * B) * vox + edge / 2;
    const cy = oy + (y0 * B) * vox + edge / 2;
    const cz = oz + (z0 * B) * vox + edge / 2;
    const half = edge * 0.8660254037844386;
    const dc = node.d(cx, cy, cz);
    if (Math.abs(dc) > node.lip * half) return;
    const rn = node.restrict(cx, cy, cz, half);
    if (size === 1) {
      const values = new Float32Array(S * S * S);
      const px = ox + x0 * B * vox, py = oy + y0 * B * vox, pz = oz + z0 * B * vox;
      let n = 0;
      for (let k = 0; k < S; k++) for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) values[n++] = rn.d(px + i * vox, py + j * vox, pz + k * vox);
      const leaf: Leaf = { bx: x0, by: y0, bz: z0, values, sdf: rn, vert: new Int32Array(B * B * B).fill(-1) };
      leaves.push(leaf);
      leafGrid[x0 + bx * (y0 + by * z0)] = leaf;
      return;
    }
    const h = size / 2;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) visit(x0 + dx * h, y0 + dy * h, z0 + dz * h, h, rn);
  };
  visit(0, 0, 0, top, sdf);

  const pos: number[] = [];
  const gstep = vox * 0.5;

  // ---- vertices
  const c = new Float64Array(8);
  for (const leaf of leaves) {
    const { values, vert } = leaf;
    for (let k = 0; k < B; k++) {
      const ck = leaf.bz * B + k;
      if (ck >= nz) break;
      for (let j = 0; j < B; j++) {
        const cj = leaf.by * B + j;
        if (cj >= ny) break;
        for (let i = 0; i < B; i++) {
          const ci = leaf.bx * B + i;
          if (ci >= nx) break;
          let mask = 0;
          for (let q = 0; q < 8; q++) {
            const o = CORNER[q]!;
            const v = values[(i + o[0]) + S * ((j + o[1]) + S * (k + o[2]))]!;
            c[q] = v;
            if (v < 0) mask |= 1 << q;
          }
          if (mask === 0 || mask === 255) continue;
          let sx = 0, sy = 0, sz = 0, cnt = 0;
          for (let e = 0; e < 12; e++) {
            const [a, b] = EDGES[e]!;
            const va = c[a]!, vb = c[b]!;
            if (va < 0 === vb < 0) continue;
            const t = va / (va - vb);
            const oa = CORNER[a]!, ob = CORNER[b]!;
            sx += oa[0] + t * (ob[0] - oa[0]);
            sy += oa[1] + t * (ob[1] - oa[1]);
            sz += oa[2] + t * (ob[2] - oa[2]);
            cnt++;
          }
          let px = ox + (ci + sx / cnt) * vox, py = oy + (cj + sy / cnt) * vox, pz = oz + (ck + sz / cnt) * vox;
          if (iters > 0) {
            const s = leaf.sdf;
            const minx = ox + ci * vox, miny = oy + cj * vox, minz = oz + ck * vox;
            for (let it = 0; it < iters; it++) {
              const d = s.d(px, py, pz);
              const gx = s.d(px + gstep, py, pz) - s.d(px - gstep, py, pz);
              const gy = s.d(px, py + gstep, pz) - s.d(px, py - gstep, pz);
              const gz = s.d(px, py, pz + gstep) - s.d(px, py, pz - gstep);
              const gl = gx * gx + gy * gy + gz * gz;
              if (gl < 1e-12) break;
              // gradient of a distance field ~ 2*gstep per unit; step along it
              const inv = (d * 2 * gstep) / gl;
              px -= gx * inv; py -= gy * inv; pz -= gz * inv;
            }
            // keep the vertex within its (slightly inflated) cell: avoids spikes at thin features
            const m = vox * 0.6;
            px = Math.min(Math.max(px, minx - m), minx + vox + m);
            py = Math.min(Math.max(py, miny - m), miny + vox + m);
            pz = Math.min(Math.max(pz, minz - m), minz + vox + m);
          }
          vert[i + B * (j + B * k)] = pos.length / 3;
          pos.push(px, py, pz);
        }
      }
    }
  }

  const vertexAt = (ci: number, cj: number, ck: number): number => {
    if (ci < 0 || cj < 0 || ck < 0 || ci >= nx || cj >= ny || ck >= nz) return -1;
    const leaf = leafGrid[Math.floor(ci / B) + bx * (Math.floor(cj / B) + by * Math.floor(ck / B))];
    if (!leaf) return -1;
    return leaf.vert[(ci % B) + B * ((cj % B) + B * (ck % B))]!;
  };

  // ---- faces
  const idx: number[] = [];
  const P = pos;
  const emit = (a: number, b: number, c_: number, d: number, axis: number, outward: boolean): void => {
    if (a < 0 || b < 0 || c_ < 0 || d < 0) return;
    // split along the shorter diagonal
    const dist2 = (u: number, v: number) => (P[u * 3]! - P[v * 3]!) ** 2 + (P[u * 3 + 1]! - P[v * 3 + 1]!) ** 2 + (P[u * 3 + 2]! - P[v * 3 + 2]!) ** 2;
    const tris: [number, number, number][] = dist2(a, c_) <= dist2(b, d) ? [[a, b, c_], [a, c_, d]] : [[a, b, d], [b, c_, d]];
    for (const [t0, t1, t2] of tris) {
      const ux = P[t1 * 3]! - P[t0 * 3]!, uy = P[t1 * 3 + 1]! - P[t0 * 3 + 1]!, uz = P[t1 * 3 + 2]! - P[t0 * 3 + 2]!;
      const wx = P[t2 * 3]! - P[t0 * 3]!, wy = P[t2 * 3 + 1]! - P[t0 * 3 + 1]!, wz = P[t2 * 3 + 2]! - P[t0 * 3 + 2]!;
      const n = axis === 0 ? uy * wz - uz * wy : axis === 1 ? uz * wx - ux * wz : ux * wy - uy * wx;
      if (t0 === t1 || t1 === t2 || t0 === t2) continue;
      if (outward === n > 0) idx.push(t0, t1, t2);
      else idx.push(t0, t2, t1);
    }
  };

  for (const leaf of leaves) {
    const { values } = leaf;
    for (let k = 0; k < B; k++) {
      const ck = leaf.bz * B + k;
      if (ck >= nz) break;
      for (let j = 0; j < B; j++) {
        const cj = leaf.by * B + j;
        if (cj >= ny) break;
        for (let i = 0; i < B; i++) {
          const ci = leaf.bx * B + i;
          if (ci >= nx) break;
          const v0 = values[i + S * (j + S * k)]! < 0;
          const vx = values[i + 1 + S * (j + S * k)]! < 0;
          const vy = values[i + S * (j + 1 + S * k)]! < 0;
          const vz = values[i + S * (j + S * (k + 1))]! < 0;
          // axis 0 edge: cells (ci,cj,ck), (ci,cj-1,ck), (ci,cj-1,ck-1), (ci,cj,ck-1)
          if (v0 !== vx && cj > 0 && ck > 0) emit(vertexAt(ci, cj, ck), vertexAt(ci, cj - 1, ck), vertexAt(ci, cj - 1, ck - 1), vertexAt(ci, cj, ck - 1), 0, v0);
          if (v0 !== vy && ci > 0 && ck > 0) emit(vertexAt(ci, cj, ck), vertexAt(ci, cj, ck - 1), vertexAt(ci - 1, cj, ck - 1), vertexAt(ci - 1, cj, ck), 1, v0);
          if (v0 !== vz && ci > 0 && cj > 0) emit(vertexAt(ci, cj, ck), vertexAt(ci - 1, cj, ck), vertexAt(ci - 1, cj - 1, ck), vertexAt(ci, cj - 1, ck), 2, v0);
        }
      }
    }
  }

  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

// Triangle BVH (median split, flat arrays) for ambient-occlusion / contact baking of hard-surface props.
// Closest-hit within [0, tmax]; two-sided triangles (props are solids but thin shells must still occlude).

export class Bvh {
  private readonly nodeMin: Float32Array;
  private readonly nodeMax: Float32Array;
  /** internal: right child index (left is node+1); leaf: -(start+1) with count in `nodeCount` */
  private readonly nodeRight: Int32Array;
  private readonly nodeCount: Int32Array;
  private readonly order: Int32Array;
  private nodes = 0;
  private readonly tri: Float32Array; // per ordered tri: v0 xyz, e1 xyz, e2 xyz (9 floats)

  constructor(positions: Float32Array, indices: Uint32Array) {
    const nt = indices.length / 3;
    const cap = Math.max(1, nt * 2);
    this.nodeMin = new Float32Array(cap * 3);
    this.nodeMax = new Float32Array(cap * 3);
    this.nodeRight = new Int32Array(cap);
    this.nodeCount = new Int32Array(cap);
    this.order = new Int32Array(nt);
    const cen = new Float32Array(nt * 3);
    const tmin = new Float32Array(nt * 3);
    const tmax = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      for (let a = 0; a < 3; a++) {
        let lo = Infinity, hi = -Infinity;
        for (let k = 0; k < 3; k++) {
          const v = positions[indices[t * 3 + k]! * 3 + a]!;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        tmin[t * 3 + a] = lo;
        tmax[t * 3 + a] = hi;
        cen[t * 3 + a] = (lo + hi) * 0.5;
      }
      this.order[t] = t;
    }
    if (nt > 0) this.build(0, nt, cen, tmin, tmax);
    this.tri = new Float32Array(nt * 9);
    for (let i = 0; i < nt; i++) {
      const t = this.order[i]!;
      const a = indices[t * 3]! * 3, b = indices[t * 3 + 1]! * 3, c = indices[t * 3 + 2]! * 3;
      const o = i * 9;
      this.tri[o] = positions[a]!; this.tri[o + 1] = positions[a + 1]!; this.tri[o + 2] = positions[a + 2]!;
      this.tri[o + 3] = positions[b]! - positions[a]!; this.tri[o + 4] = positions[b + 1]! - positions[a + 1]!; this.tri[o + 5] = positions[b + 2]! - positions[a + 2]!;
      this.tri[o + 6] = positions[c]! - positions[a]!; this.tri[o + 7] = positions[c + 1]! - positions[a + 1]!; this.tri[o + 8] = positions[c + 2]! - positions[a + 2]!;
    }
  }

  private build(start: number, end: number, cen: Float32Array, tmin: Float32Array, tmax: Float32Array): number {
    const node = this.nodes++;
    let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    for (let i = start; i < end; i++) {
      const t = this.order[i]!;
      bx0 = Math.min(bx0, tmin[t * 3]!); by0 = Math.min(by0, tmin[t * 3 + 1]!); bz0 = Math.min(bz0, tmin[t * 3 + 2]!);
      bx1 = Math.max(bx1, tmax[t * 3]!); by1 = Math.max(by1, tmax[t * 3 + 1]!); bz1 = Math.max(bz1, tmax[t * 3 + 2]!);
      cx0 = Math.min(cx0, cen[t * 3]!); cy0 = Math.min(cy0, cen[t * 3 + 1]!); cz0 = Math.min(cz0, cen[t * 3 + 2]!);
      cx1 = Math.max(cx1, cen[t * 3]!); cy1 = Math.max(cy1, cen[t * 3 + 1]!); cz1 = Math.max(cz1, cen[t * 3 + 2]!);
    }
    this.nodeMin[node * 3] = bx0; this.nodeMin[node * 3 + 1] = by0; this.nodeMin[node * 3 + 2] = bz0;
    this.nodeMax[node * 3] = bx1; this.nodeMax[node * 3 + 1] = by1; this.nodeMax[node * 3 + 2] = bz1;
    const n = end - start;
    if (n <= 4) {
      this.nodeRight[node] = -(start + 1);
      this.nodeCount[node] = n;
      return node;
    }
    const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const sub = Array.from(this.order.subarray(start, end)).sort((p, q) => cen[p * 3 + axis]! - cen[q * 3 + axis]!);
    for (let i = 0; i < n; i++) this.order[start + i] = sub[i]!;
    const mid = start + (n >> 1);
    this.build(start, mid, cen, tmin, tmax);
    this.nodeRight[node] = this.build(mid, end, cen, tmin, tmax);
    this.nodeCount[node] = 0;
    return node;
  }

  /** nearest hit distance along (dx,dy,dz) (unit) within tmax; Infinity when nothing is hit */
  hit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmax: number): number {
    if (this.nodes === 0) return Infinity;
    const idx = 1 / (Math.abs(dx) < 1e-12 ? 1e-12 : dx), idy = 1 / (Math.abs(dy) < 1e-12 ? 1e-12 : dy), idz = 1 / (Math.abs(dz) < 1e-12 ? 1e-12 : dz);
    const stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    let best = tmax;
    const nmin = this.nodeMin, nmax = this.nodeMax, tri = this.tri;
    while (sp > 0) {
      const node = stack[--sp]!;
      // slab test
      let t0 = (nmin[node * 3]! - ox) * idx, t1 = (nmax[node * 3]! - ox) * idx;
      let tn = Math.min(t0, t1), tf = Math.max(t0, t1);
      t0 = (nmin[node * 3 + 1]! - oy) * idy; t1 = (nmax[node * 3 + 1]! - oy) * idy;
      tn = Math.max(tn, Math.min(t0, t1)); tf = Math.min(tf, Math.max(t0, t1));
      t0 = (nmin[node * 3 + 2]! - oz) * idz; t1 = (nmax[node * 3 + 2]! - oz) * idz;
      tn = Math.max(tn, Math.min(t0, t1)); tf = Math.min(tf, Math.max(t0, t1));
      if (tf < Math.max(tn, 0) || tn > best) continue;
      const r = this.nodeRight[node]!;
      if (r < 0) {
        const start = -r - 1, cnt = this.nodeCount[node]!;
        for (let i = start; i < start + cnt; i++) {
          const o = i * 9;
          const e1x = tri[o + 3]!, e1y = tri[o + 4]!, e1z = tri[o + 5]!, e2x = tri[o + 6]!, e2y = tri[o + 7]!, e2z = tri[o + 8]!;
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-14 && det < 1e-14) continue;
          const inv = 1 / det;
          const sx = ox - tri[o]!, sy = oy - tri[o + 1]!, sz = oz - tri[o + 2]!;
          const u = (sx * px + sy * py + sz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (t > 1e-5 && t < best) best = t;
        }
      } else {
        stack[sp++] = r;
        stack[sp++] = node + 1;
      }
    }
    return best >= tmax ? Infinity : best;
  }

  private readonly stack = new Int32Array(128);
}

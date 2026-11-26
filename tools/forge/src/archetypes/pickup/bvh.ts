// Small static BVH over a triangle soup for the baking passes (ambient occlusion, hidden-face tests).
// Triangles are 9 floats each; hits are two-sided and report whether the nearest hit was a back face.

export class Bvh {
  /** triangle vertices, 9 floats per triangle, original order */
  readonly tris: Float32Array;
  private readonly order: Int32Array;
  private bmin: Float32Array;
  private bmax: Float32Array;
  /** left child (right = left + 1) or -1 for a leaf */
  private left: Int32Array;
  private first: Int32Array;
  private cnt: Int32Array;
  private nodes = 0;
  private readonly stack = new Int32Array(96);
  /** set by `nearest`: nearest hit was a back face (the ray started inside a closed solid) */
  hitBack = false;
  hitTri = -1;

  constructor(tris: Float32Array) {
    this.tris = tris;
    const n = tris.length / 9;
    this.order = new Int32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    const cap = Math.max(2, n * 2);
    this.bmin = new Float32Array(cap * 3);
    this.bmax = new Float32Array(cap * 3);
    this.left = new Int32Array(cap).fill(-1);
    this.first = new Int32Array(cap);
    this.cnt = new Int32Array(cap);
    if (n > 0) this.build(n);
  }

  get triCount(): number {
    return this.tris.length / 9;
  }

  private build(n: number): void {
    const t = this.tris;
    const cx = new Float32Array(n), cy = new Float32Array(n), cz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      cx[i] = (t[o]! + t[o + 3]! + t[o + 6]!) / 3;
      cy[i] = (t[o + 1]! + t[o + 4]! + t[o + 7]!) / 3;
      cz[i] = (t[o + 2]! + t[o + 5]! + t[o + 8]!) / 3;
    }
    const order = this.order;
    // work stack of [node, start, end)
    const work: number[] = [0, 0, n];
    this.nodes = 1;
    while (work.length) {
      const end = work.pop()!, start = work.pop()!, node = work.pop()!;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      let c0x = Infinity, c0y = Infinity, c0z = Infinity, c1x = -Infinity, c1y = -Infinity, c1z = -Infinity;
      for (let i = start; i < end; i++) {
        const ti = order[i]!, o = ti * 9;
        for (let k = 0; k < 3; k++) {
          const x = t[o + k * 3]!, y = t[o + k * 3 + 1]!, z = t[o + k * 3 + 2]!;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
        if (cx[ti]! < c0x) c0x = cx[ti]!; if (cx[ti]! > c1x) c1x = cx[ti]!;
        if (cy[ti]! < c0y) c0y = cy[ti]!; if (cy[ti]! > c1y) c1y = cy[ti]!;
        if (cz[ti]! < c0z) c0z = cz[ti]!; if (cz[ti]! > c1z) c1z = cz[ti]!;
      }
      this.bmin[node * 3] = x0 - 1e-5; this.bmin[node * 3 + 1] = y0 - 1e-5; this.bmin[node * 3 + 2] = z0 - 1e-5;
      this.bmax[node * 3] = x1 + 1e-5; this.bmax[node * 3 + 1] = y1 + 1e-5; this.bmax[node * 3 + 2] = z1 + 1e-5;
      const count = end - start;
      if (count <= 4) {
        this.left[node] = -1;
        this.first[node] = start;
        this.cnt[node] = count;
        continue;
      }
      const ex = c1x - c0x, ey = c1y - c0y, ez = c1z - c0z;
      const axis = ex >= ey && ex >= ez ? cx : ey >= ez ? cy : cz;
      const sub = Array.from(order.subarray(start, end));
      sub.sort((a, b) => axis[a]! - axis[b]!);
      for (let i = 0; i < count; i++) order[start + i] = sub[i]!;
      const mid = start + (count >> 1);
      const l = this.nodes;
      this.nodes += 2;
      this.left[node] = l;
      work.push(l, start, mid, l + 1, mid, end);
    }
  }

  /**
   * Nearest intersection along o + t d with 0 < t <= tMax (d need not be normalised but tMax is in units of t).
   * Returns Infinity when nothing is hit. Skips triangles with index in `skip` (small list).
   */
  nearest(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number, skip?: ArrayLike<number>): number {
    if (this.nodes === 0) return Infinity;
    const idx = 1 / (dx === 0 ? 1e-30 : dx), idy = 1 / (dy === 0 ? 1e-30 : dy), idz = 1 / (dz === 0 ? 1e-30 : dz);
    const stack = this.stack;
    const bmin = this.bmin, bmax = this.bmax, left = this.left, first = this.first, cnt = this.cnt, order = this.order, tris = this.tris;
    let sp = 0;
    stack[sp++] = 0;
    let best = tMax;
    let found = false;
    let back = false;
    let btri = -1;
    while (sp > 0) {
      const node = stack[--sp]!;
      // slab test
      let t0 = (bmin[node * 3]! - ox) * idx, t1 = (bmax[node * 3]! - ox) * idx;
      let tmin = t0 < t1 ? t0 : t1, tmax = t0 < t1 ? t1 : t0;
      t0 = (bmin[node * 3 + 1]! - oy) * idy; t1 = (bmax[node * 3 + 1]! - oy) * idy;
      tmin = Math.max(tmin, t0 < t1 ? t0 : t1); tmax = Math.min(tmax, t0 < t1 ? t1 : t0);
      t0 = (bmin[node * 3 + 2]! - oz) * idz; t1 = (bmax[node * 3 + 2]! - oz) * idz;
      tmin = Math.max(tmin, t0 < t1 ? t0 : t1); tmax = Math.min(tmax, t0 < t1 ? t1 : t0);
      if (tmax < 0 || tmin > tmax || tmin > best) continue;
      const l = left[node]!;
      if (l >= 0) {
        stack[sp++] = l;
        stack[sp++] = l + 1;
        continue;
      }
      const f = first[node]!, c = cnt[node]!;
      for (let i = f; i < f + c; i++) {
        const ti = order[i]!;
        if (skip) {
          let s = false;
          for (let k = 0; k < skip.length; k++) if (skip[k] === ti) { s = true; break; }
          if (s) continue;
        }
        const o = ti * 9;
        const ax = tris[o]!, ay = tris[o + 1]!, az = tris[o + 2]!;
        const e1x = tris[o + 3]! - ax, e1y = tris[o + 4]! - ay, e1z = tris[o + 5]! - az;
        const e2x = tris[o + 6]! - ax, e2y = tris[o + 7]! - ay, e2z = tris[o + 8]! - az;
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-14 && det < 1e-14) continue;
        const inv = 1 / det;
        const sx = ox - ax, sy = oy - ay, sz = oz - az;
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1e-7 && t < best) {
          best = t;
          found = true;
          back = det < 0;
          btri = ti;
        }
      }
    }
    this.hitBack = found && back;
    this.hitTri = found ? btri : -1;
    return found ? best : Infinity;
  }
}

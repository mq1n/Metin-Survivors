// Indexed triangle mesh used by the bake pipeline: conforming edge splitting (no T-junctions, crease-split vertices stay
// split), per-triangle utilities and hidden-face culling. Vertices carry (position, normal, group); `pid` is a welded
// position id so edges that meet at a crease are treated as the same edge.
import type { HardModelMesh } from '../../core/hard/hardmesh.ts';

const PID_STRIDE = 4194304; // 2^22

export class TriMesh {
  pos: number[] = [];
  nrm: number[] = [];
  grp: number[] = [];
  idx: number[] = [];
  /** welded position id per vertex */
  pid: number[] = [];
  private nextPid = 0;

  static fromHard(h: HardModelMesh): TriMesh {
    const m = new TriMesh();
    const nv = h.positions.length / 3;
    const ids = new Map<string, number>();
    for (let i = 0; i < nv; i++) {
      m.pos.push(h.positions[i * 3]!, h.positions[i * 3 + 1]!, h.positions[i * 3 + 2]!);
      m.nrm.push(h.normals[i * 3]!, h.normals[i * 3 + 1]!, h.normals[i * 3 + 2]!);
      m.grp.push(h.groups[i]!);
      const k = `${Math.round(h.positions[i * 3]! * 1e5)},${Math.round(h.positions[i * 3 + 1]! * 1e5)},${Math.round(h.positions[i * 3 + 2]! * 1e5)}`;
      let id = ids.get(k);
      if (id === undefined) {
        id = ids.size;
        ids.set(k, id);
      }
      m.pid.push(id);
    }
    m.nextPid = ids.size;
    for (let i = 0; i < h.indices.length; i++) m.idx.push(h.indices[i]!);
    return m;
  }

  /** mesh from raw arrays (pids already welded) */
  static fromArrays(pos: number[], nrm: number[], grp: number[], pid: number[], idx: number[]): TriMesh {
    const m = new TriMesh();
    m.pos = pos; m.nrm = nrm; m.grp = grp; m.pid = pid; m.idx = idx;
    let top = -1;
    for (const p of pid) if (p > top) top = p;
    m.nextPid = top + 1;
    return m;
  }

  get nv(): number {
    return this.pos.length / 3;
  }
  get nt(): number {
    return this.idx.length / 3;
  }

  /** group (bone * 256 + zone) of a triangle */
  triGroup(t: number): number {
    return this.grp[this.idx[t * 3]!]!;
  }

  edgeKey(a: number, b: number): number {
    const pa = this.pid[a]!, pb = this.pid[b]!;
    return pa < pb ? pa * PID_STRIDE + pb : pb * PID_STRIDE + pa;
  }

  edgeLen(a: number, b: number): number {
    const p = this.pos;
    return Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!);
  }

  /** triangle soup (9 floats per tri) of the given triangle ids (all when omitted) */
  soup(tris?: ArrayLike<number>, xform?: (x: number, y: number, z: number, out: number[], o: number) => void): Float32Array {
    const n = tris ? tris.length : this.nt;
    const out = new Float32Array(n * 9);
    const tmp = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const t = tris ? tris[i]! : i;
      for (let k = 0; k < 3; k++) {
        const v = this.idx[t * 3 + k]!;
        const x = this.pos[v * 3]!, y = this.pos[v * 3 + 1]!, z = this.pos[v * 3 + 2]!;
        if (xform) {
          xform(x, y, z, tmp, 0);
          out[i * 9 + k * 3] = tmp[0]!; out[i * 9 + k * 3 + 1] = tmp[1]!; out[i * 9 + k * 3 + 2] = tmp[2]!;
        } else {
          out[i * 9 + k * 3] = x; out[i * 9 + k * 3 + 1] = y; out[i * 9 + k * 3 + 2] = z;
        }
      }
    }
    return out;
  }

  /** unit face normal of triangle t (counter-clockwise winding) */
  faceNormal(t: number, out: number[] = [0, 0, 0]): number[] {
    const p = this.pos, i = this.idx;
    const a = i[t * 3]! * 3, b = i[t * 3 + 1]! * 3, c = i[t * 3 + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  }

  private addMidVertex(a: number, b: number, pidNew: number): number {
    const p = this.pos, n = this.nrm;
    const v = this.nv;
    p.push((p[a * 3]! + p[b * 3]!) / 2, (p[a * 3 + 1]! + p[b * 3 + 1]!) / 2, (p[a * 3 + 2]! + p[b * 3 + 2]!) / 2);
    let nx = n[a * 3]! + n[b * 3]!, ny = n[a * 3 + 1]! + n[b * 3 + 1]!, nz = n[a * 3 + 2]! + n[b * 3 + 2]!;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-6) { nx = n[a * 3]!; ny = n[a * 3 + 1]!; nz = n[a * 3 + 2]!; } else { nx /= l; ny /= l; nz /= l; }
    n.push(nx, ny, nz);
    this.grp.push(this.grp[a]!);
    this.pid.push(pidNew);
    return v;
  }

  /** conforming split of every edge whose key is in `marked` (red/green closure: 1, 2 or 3 marked edges per triangle) */
  splitEdges(marked: ReadonlySet<number>): void {
    if (marked.size === 0) return;
    const midV = new Map<number, number>();
    const midPid = new Map<number, number>();
    const mid = (a: number, b: number): number => {
      const vk = a < b ? a * PID_STRIDE + b : b * PID_STRIDE + a;
      let m = midV.get(vk);
      if (m !== undefined) return m;
      const ek = this.edgeKey(a, b);
      let np = midPid.get(ek);
      if (np === undefined) {
        np = this.nextPid++;
        midPid.set(ek, np);
      }
      m = this.addMidVertex(a, b, np);
      midV.set(vk, m);
      return m;
    };
    const out: number[] = [];
    const nt = this.nt;
    const idx = this.idx;
    const len = (a: number, b: number): number => this.edgeLen(a, b);
    for (let t = 0; t < nt; t++) {
      let a = idx[t * 3]!, b = idx[t * 3 + 1]!, c = idx[t * 3 + 2]!;
      let mab = marked.has(this.edgeKey(a, b)), mbc = marked.has(this.edgeKey(b, c)), mca = marked.has(this.edgeKey(c, a));
      const cntM = (mab ? 1 : 0) + (mbc ? 1 : 0) + (mca ? 1 : 0);
      if (cntM === 0) {
        out.push(a, b, c);
        continue;
      }
      // rotate so the marked edges come first: 1 marked -> ab ; 2 marked -> ab & bc (common vertex b)
      for (let r = 0; r < 3; r++) {
        const ok = cntM === 1 ? mab : cntM === 2 ? mab && mbc : true;
        if (ok) break;
        const na = b, nb = c, nc = a;
        const nab = mbc, nbc = mca, nca = mab;
        a = na; b = nb; c = nc; mab = nab; mbc = nbc; mca = nca;
      }
      if (cntM === 1) {
        const m = mid(a, b);
        out.push(a, m, c, m, b, c);
      } else if (cntM === 2) {
        const m1 = mid(a, b), m2 = mid(b, c);
        out.push(m1, b, m2);
        if (len(a, m2) <= len(m1, c)) out.push(a, m1, m2, a, m2, c);
        else out.push(m1, m2, c, m1, c, a);
      } else {
        const m1 = mid(a, b), m2 = mid(b, c), m3 = mid(c, a);
        out.push(a, m1, m3, m1, b, m2, m3, m2, c, m1, m2, m3);
      }
    }
    this.idx = out;
  }

  /** split edges until none exceeds `limit(zone)`; returns the number of passes used */
  subdivideTo(limit: (zone: number) => number, maxPasses = 8): number {
    for (let pass = 0; pass < maxPasses; pass++) {
      const lim = new Map<number, number>();
      const len = new Map<number, number>();
      for (let t = 0; t < this.nt; t++) {
        const zone = this.triGroup(t) & 255;
        const L = limit(zone);
        for (let k = 0; k < 3; k++) {
          const a = this.idx[t * 3 + k]!, b = this.idx[t * 3 + ((k + 1) % 3)]!;
          const key = this.edgeKey(a, b);
          const prev = lim.get(key);
          if (prev === undefined || L < prev) lim.set(key, L);
          if (!len.has(key)) len.set(key, this.edgeLen(a, b));
        }
      }
      const marked = new Set<number>();
      for (const [key, l] of len) if (l > lim.get(key)! * 1.0001) marked.add(key);
      if (marked.size === 0) return pass;
      this.splitEdges(marked);
    }
    return maxPasses;
  }

  /** keep only the listed triangles and drop unused vertices */
  keepTriangles(keep: ArrayLike<number>): void {
    const used = new Int32Array(this.nv).fill(-1);
    const pos: number[] = [], nrm: number[] = [], grp: number[] = [], pid: number[] = [], idx: number[] = [];
    for (let i = 0; i < keep.length; i++) {
      const t = keep[i]!;
      for (let k = 0; k < 3; k++) {
        const v = this.idx[t * 3 + k]!;
        let nvI = used[v]!;
        if (nvI < 0) {
          nvI = pos.length / 3;
          used[v] = nvI;
          pos.push(this.pos[v * 3]!, this.pos[v * 3 + 1]!, this.pos[v * 3 + 2]!);
          nrm.push(this.nrm[v * 3]!, this.nrm[v * 3 + 1]!, this.nrm[v * 3 + 2]!);
          grp.push(this.grp[v]!);
          pid.push(this.pid[v]!);
        }
        idx.push(nvI);
      }
    }
    this.pos = pos; this.nrm = nrm; this.grp = grp; this.pid = pid; this.idx = idx;
  }
}

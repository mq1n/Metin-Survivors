// Hard-surface mesh builder: a triangle soup that is welded and given crease-angle normals when finished.
// Builders (extrude / lathe / sweep / box / prism) only emit triangles; smoothing decisions are made once, in `finish`,
// so bevels (small angle between neighbouring faces) come out smooth and real corners stay crisp.
import { type Mat4, type Vec3, m4identity as mident, m4translation, m4transformPoint as mtransformPoint, vcross, vdot, vlen, vnorm, vsub } from '../math.ts';
import type { RawMesh } from '../mesh/surfaceNets.ts';
import { type Vec2, ensureCCW, offsetShape, roundCorners, triangulate } from './shape2d.ts';

export interface FinishOpts {
  /** faces meeting at less than this angle (degrees) share smooth normals. Default 40 */
  crease?: number;
  /** weld distance for position matching (m). Default 1e-5 */
  weld?: number;
}

export interface HardModelMesh extends RawMesh {
  normals: Float32Array;
  /** per-vertex group id (material zone / paint tag) */
  groups: Uint16Array;
}

export class HardMesh {
  /** 9 floats per triangle (3 x xyz) */
  readonly tris: number[] = [];
  /** group id per triangle (for paint zones) */
  readonly triGroup: number[] = [];
  /** group assigned to triangles added from now on */
  group = 0;

  get triCount(): number {
    return this.tris.length / 9;
  }

  tri(a: Vec3, b: Vec3, c: Vec3): this {
    this.tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.triGroup.push(this.group);
    return this;
  }

  /** counter-clockwise quad seen from the front */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): this {
    return this.tri(a, b, c).tri(a, c, d);
  }

  /** convex or simple 3-D polygon; `normal` picks the facing (vertices must wind counter-clockwise around it) */
  polygon(pts: readonly Vec3[]): this {
    // project onto the polygon plane to triangulate
    let n: Vec3 = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const c = vcross(pts[i]!, pts[(i + 1) % pts.length]!);
      n = [n[0] + c[0], n[1] + c[1], n[2] + c[2]];
    }
    n = vnorm(n);
    const ax: Vec3 = Math.abs(n[1]) < 0.9 ? vnorm(vcross([0, 1, 0], n)) : vnorm(vcross([1, 0, 0], n));
    const ay = vcross(n, ax);
    const p2 = pts.map((p) => [vdot(p, ax), vdot(p, ay)] as Vec2);
    for (const [i, j, k] of triangulate(p2)) this.tri(pts[i]!, pts[j]!, pts[k]!);
    return this;
  }

  transform(m: Mat4): this {
    for (let i = 0; i < this.tris.length; i += 3) {
      const p = mtransformPoint(m, [this.tris[i]!, this.tris[i + 1]!, this.tris[i + 2]!]);
      this.tris[i] = p[0]; this.tris[i + 1] = p[1]; this.tris[i + 2] = p[2];
    }
    return this;
  }

  /** append a transformed copy into `into`. Triangles keep their own non-zero group; group-0 triangles take `into.group` */
  appendTo(into: HardMesh, m: Mat4 = mident()): void {
    for (let i = 0; i < this.tris.length; i += 9) {
      const a = mtransformPoint(m, [this.tris[i]!, this.tris[i + 1]!, this.tris[i + 2]!]);
      const b = mtransformPoint(m, [this.tris[i + 3]!, this.tris[i + 4]!, this.tris[i + 5]!]);
      const c = mtransformPoint(m, [this.tris[i + 6]!, this.tris[i + 7]!, this.tris[i + 8]!]);
      const g = into.group;
      const sg = this.triGroup[i / 9]!;
      if (sg !== 0) into.group = sg;
      into.tri(a, b, c);
      into.group = g;
    }
  }

  /** mirror across x = 0 and append (adds the mirrored copy with flipped winding) */
  mirrorX(): this {
    const n = this.tris.length;
    for (let i = 0; i < n; i += 9) {
      const t = this.tris;
      // mirrored triangle with swapped b/c keeps outward facing
      this.tris.push(-t[i]!, t[i + 1]!, t[i + 2]!, -t[i + 6]!, t[i + 7]!, t[i + 8]!, -t[i + 3]!, t[i + 4]!, t[i + 5]!);
      this.triGroup.push(this.triGroup[i / 9]!);
    }
    return this;
  }

  bounds(): { min: Vec3; max: Vec3 } {
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.tris.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, this.tris[i + k]!);
        max[k] = Math.max(max[k]!, this.tris[i + k]!);
      }
    return { min, max };
  }

  /** weld positions, split normals at creases, drop degenerate triangles */
  finish(opts: FinishOpts = {}): HardModelMesh {
    const cosCrease = Math.cos(((opts.crease ?? 40) * Math.PI) / 180);
    const weld = opts.weld ?? 1e-5;
    const nt = this.triCount;
    const key = (x: number, y: number, z: number): string => `${Math.round(x / weld)},${Math.round(y / weld)},${Math.round(z / weld)}`;
    // 1. weld positions -> unique ids; per-triangle unit normal + area
    const ids = new Map<string, number>();
    const pos: number[] = [];
    const tri = new Int32Array(nt * 3);
    const fn = new Float32Array(nt * 3);
    const area = new Float32Array(nt);
    const keep = new Uint8Array(nt);
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const x = this.tris[t * 9 + k * 3]!, y = this.tris[t * 9 + k * 3 + 1]!, z = this.tris[t * 9 + k * 3 + 2]!;
        const kk = key(x, y, z);
        let id = ids.get(kk);
        if (id === undefined) {
          id = pos.length / 3;
          ids.set(kk, id);
          pos.push(x, y, z);
        }
        tri[t * 3 + k] = id;
      }
      const a: Vec3 = [pos[tri[t * 3]! * 3]!, pos[tri[t * 3]! * 3 + 1]!, pos[tri[t * 3]! * 3 + 2]!];
      const b: Vec3 = [pos[tri[t * 3 + 1]! * 3]!, pos[tri[t * 3 + 1]! * 3 + 1]!, pos[tri[t * 3 + 1]! * 3 + 2]!];
      const c: Vec3 = [pos[tri[t * 3 + 2]! * 3]!, pos[tri[t * 3 + 2]! * 3 + 1]!, pos[tri[t * 3 + 2]! * 3 + 2]!];
      const n = vcross(vsub(b, a), vsub(c, a));
      const l = vlen(n);
      if (tri[t * 3] === tri[t * 3 + 1] || tri[t * 3 + 1] === tri[t * 3 + 2] || tri[t * 3] === tri[t * 3 + 2] || l < 1e-12) continue;
      keep[t] = 1;
      area[t] = l / 2;
      fn[t * 3] = n[0] / l; fn[t * 3 + 1] = n[1] / l; fn[t * 3 + 2] = n[2] / l;
    }
    // 2. triangles incident to each welded vertex
    const nv = pos.length / 3;
    const inc: number[][] = Array.from({ length: nv }, () => []);
    for (let t = 0; t < nt; t++) if (keep[t]) for (let k = 0; k < 3; k++) inc[tri[t * 3 + k]!]!.push(t);
    // 3. a corner's smooth normal = area-weighted mean of incident faces within the crease angle; weld equal (pos, normal)
    const outPos: number[] = [];
    const outNrm: number[] = [];
    const outGrp: number[] = [];
    const outIdx: number[] = [];
    const cache = new Map<string, number>();
    for (let t = 0; t < nt; t++) {
      if (!keep[t]) continue;
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k]!;
        let nx = 0, ny = 0, nz = 0;
        for (const u of inc[v]!) {
          const d = fn[u * 3]! * fn[t * 3]! + fn[u * 3 + 1]! * fn[t * 3 + 1]! + fn[u * 3 + 2]! * fn[t * 3 + 2]!;
          if (d >= cosCrease) {
            nx += fn[u * 3]! * area[u]!; ny += fn[u * 3 + 1]! * area[u]!; nz += fn[u * 3 + 2]! * area[u]!;
          }
        }
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const g = this.triGroup[t]!;
        const ck = `${v}|${Math.round(nx * 500)}|${Math.round(ny * 500)}|${Math.round(nz * 500)}|${g}`;
        let id = cache.get(ck);
        if (id === undefined) {
          id = outPos.length / 3;
          cache.set(ck, id);
          outPos.push(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
          outNrm.push(nx, ny, nz);
          outGrp.push(g);
        }
        outIdx.push(id);
      }
    }
    return {
      positions: Float32Array.from(outPos),
      normals: Float32Array.from(outNrm),
      indices: Uint32Array.from(outIdx),
      groups: Uint16Array.from(outGrp),
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// builders

export interface BevelOpts {
  /** bevel width (m) */
  size: number;
  /** arc segments per bevel (1 = chamfer) */
  segments?: number;
}

/** point on a quarter-round bevel: returns [inset, rise] for t in 0..1 (inset shrinks the outline, rise moves toward the face) */
const bevelCurve = (size: number, t: number): [number, number] => [size * (1 - Math.sin((t * Math.PI) / 2)), size * (1 - Math.cos((t * Math.PI) / 2))];

/** place a 2-D outline at depth z along `axis` ('z': xy plane at z, 'y': xz plane at y with x,z swapped, 'x': yz plane) */
function place(pt: Vec2, z: number, axis: 'x' | 'y' | 'z'): Vec3 {
  return axis === 'z' ? [pt[0], pt[1], z] : axis === 'y' ? [pt[0], z, pt[1]] : [z, pt[0], pt[1]];
}

export interface ExtrudeOpts {
  /** extrusion axis; 2-D outline x,y maps to (x,y) / (x,z) / (y,z). Default 'z' */
  axis?: 'x' | 'y' | 'z';
  bevel?: BevelOpts;
  /** round the outline corners with this radius before extruding */
  round?: number;
  /** start offset along the axis. Default 0 */
  z0?: number;
  /** taper: end outline scaled by this factor (uniform); bevel is applied on the straight part */
  taper?: number;
  caps?: boolean;
}

/** Extrude a simple outline to a prism with optional bevelled edges. Returns the mesh (ccw outline => outward faces). */
export function extrude(outline: readonly Vec2[], depth: number, opts: ExtrudeOpts = {}): HardMesh {
  const axis = opts.axis ?? 'z';
  const z0 = opts.z0 ?? 0;
  let shape = ensureCCW(outline);
  if (opts.round) shape = roundCorners(shape, opts.round, 4);
  const m = new HardMesh();
  const bevel = opts.bevel;
  const segs = bevel ? Math.max(1, bevel.segments ?? 2) : 0;
  const size = bevel ? Math.min(bevel.size, depth / 2 - 1e-6) : 0;
  // rings bottom -> top: [outline, z]
  const rings: [Vec2[], number][] = [];
  if (bevel) {
    for (let k = 0; k <= segs; k++) {
      const [inset, rise] = bevelCurve(size, k / segs);
      rings.push([offsetShape(shape, -inset), z0 + rise]);
    }
    for (let k = segs; k >= 0; k--) {
      const [inset, rise] = bevelCurve(size, k / segs);
      rings.push([offsetShape(shape, -inset), z0 + depth - rise]);
    }
  } else {
    rings.push([shape, z0], [shape, z0 + depth]);
  }
  if (opts.taper !== undefined && opts.taper !== 1) {
    const c = shape.reduce((s, p) => [s[0] + p[0] / shape.length, s[1] + p[1] / shape.length] as Vec2, [0, 0] as Vec2);
    for (const r of rings) {
      const f = 1 + (opts.taper - 1) * ((r[1] - z0) / depth);
      r[0] = r[0].map((p) => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f] as Vec2);
    }
  }
  const flip = axis === 'y';
  for (let r = 0; r + 1 < rings.length; r++) {
    const [a, za] = rings[r]!, [b, zb] = rings[r + 1]!;
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      const p0 = place(a[i]!, za, axis), p1 = place(a[j]!, za, axis), p2 = place(b[j]!, zb, axis), p3 = place(b[i]!, zb, axis);
      if (flip) m.quad(p1, p0, p3, p2);
      else m.quad(p0, p1, p2, p3);
    }
  }
  if (opts.caps !== false) {
    const bottom = rings[0]![0], top = rings[rings.length - 1]![0];
    const zb = rings[0]![1], zt = rings[rings.length - 1]![1];
    for (const [i, j, k] of triangulate(bottom)) {
      const a = place(bottom[i]!, zb, axis), b = place(bottom[j]!, zb, axis), c = place(bottom[k]!, zb, axis);
      if (flip) m.tri(a, b, c);
      else m.tri(a, c, b);
    }
    for (const [i, j, k] of triangulate(top)) {
      const a = place(top[i]!, zt, axis), b = place(top[j]!, zt, axis), c = place(top[k]!, zt, axis);
      if (flip) m.tri(a, c, b);
      else m.tri(a, b, c);
    }
  }
  return m;
}

export interface LatheOpts {
  /** segments around the axis. Default 24 */
  segments?: number;
  /** sweep angle (radians). Default full turn */
  sweep?: number;
  /** close the open ends of a partial sweep */
  caps?: boolean;
}

/**
 * Surface of revolution around +Y. `profile` is [radius, y] points from bottom to top (counter-clockwise in the xy half-plane
 * when travelling bottom -> top on the outside). Use `roundCorners(profile, r, n, false)` to bevel profile corners.
 */
export function lathe(profile: readonly Vec2[], opts: LatheOpts = {}): HardMesh {
  const n = opts.segments ?? 24;
  const sweep = opts.sweep ?? Math.PI * 2;
  const full = Math.abs(sweep - Math.PI * 2) < 1e-6;
  const m = new HardMesh();
  const ring = (r: number, y: number, k: number): Vec3 => [Math.cos((k / n) * sweep) * r, y, -Math.sin((k / n) * sweep) * r];
  for (let i = 0; i + 1 < profile.length; i++) {
    const [r0, y0] = profile[i]!, [r1, y1] = profile[i + 1]!;
    for (let k = 0; k < n; k++) {
      const a = ring(r0, y0, k), b = ring(r0, y0, k + 1), c = ring(r1, y1, k + 1), d = ring(r1, y1, k);
      if (r0 < 1e-9 && r1 < 1e-9) continue;
      if (r0 < 1e-9) m.tri(a, c, d);
      else if (r1 < 1e-9) m.tri(a, b, d);
      else m.quad(a, b, c, d);
    }
  }
  if (!full && opts.caps) {
    // radial walls at both ends of the sweep
    const wall = (k: number, flipW: boolean): void => {
      const pts = profile.map(([r, y]) => ring(r, y, k));
      pts.push([0, profile[profile.length - 1]![1], 0], [0, profile[0]![1], 0]);
      const poly = flipW ? [...pts].reverse() : pts;
      m.polygon(poly);
    };
    wall(0, true);
    wall(n, false);
  }
  return m;
}

export interface SweepOpts {
  /** per-ring uniform scale of the outline, t in 0..1 (default 1) */
  scale?: (t: number) => number;
  /** per-ring twist in radians */
  twist?: (t: number) => number;
  caps?: boolean;
  /** close the path into a loop (no caps) */
  closed?: boolean;
  /** up hint for the first frame. Default +Y (or +Z when the path starts vertically) */
  up?: Vec3;
}

/** Sweep an outline (counter-clockwise, in the frame's x/y plane) along a 3-D polyline with parallel-transport frames. */
export function sweep(outline: readonly Vec2[], path: readonly Vec3[], opts: SweepOpts = {}): HardMesh {
  const shape = ensureCCW(outline);
  const n = path.length;
  const m = new HardMesh();
  // tangents
  const tan: Vec3[] = path.map((p, i) => {
    const a = path[Math.max(0, i - 1)]!, b = path[Math.min(n - 1, i + 1)]!;
    const t = vsub(b, a);
    return vnorm(vlen(t) < 1e-9 ? [0, 0, 1] : t);
  });
  if (opts.closed) {
    tan[0] = vnorm(vsub(path[1]!, path[n - 1]!));
    tan[n - 1] = vnorm(vsub(path[0]!, path[n - 2]!));
  }
  // frames: x = right, y = up, tangent = forward (local +Z of the outline plane)
  const up0 = opts.up ?? (Math.abs(tan[0]![1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]);
  let x = vnorm(vcross(up0, tan[0]!));
  let y = vcross(tan[0]!, x);
  const rings: Vec3[][] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // rotate previous frame to the new tangent (parallel transport)
      const t0 = tan[i - 1]!, t1 = tan[i]!;
      const axis = vcross(t0, t1);
      const s = vlen(axis), c = vdot(t0, t1);
      if (s > 1e-9) {
        const k = vnorm(axis);
        const rot = (v: Vec3): Vec3 => {
          const kv = vcross(k, v), kd = vdot(k, v);
          return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
        };
        x = rot(x);
        y = rot(y);
      }
    }
    const t = n > 1 ? i / (n - 1) : 0;
    const sc = opts.scale ? opts.scale(t) : 1;
    const tw = opts.twist ? opts.twist(t) : 0;
    const ct = Math.cos(tw), st = Math.sin(tw);
    const p = path[i]!;
    rings.push(
      shape.map(([px, py]) => {
        const rx = (px * ct - py * st) * sc, ry = (px * st + py * ct) * sc;
        return [p[0] + x[0] * rx + y[0] * ry, p[1] + x[1] * rx + y[1] * ry, p[2] + x[2] * rx + y[2] * ry] as Vec3;
      }),
    );
  }
  const count = opts.closed ? n : n - 1;
  for (let r = 0; r < count; r++) {
    const a = rings[r]!, b = rings[(r + 1) % n]!;
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      m.quad(a[i]!, a[j]!, b[j]!, b[i]!);
    }
  }
  if (opts.caps !== false && !opts.closed) {
    const first = rings[0]!, last = rings[n - 1]!;
    m.polygon([...first].reverse());
    m.polygon(last);
  }
  return m;
}

/** axis-aligned beveled box centred on `center` (size = full extents) */
export function bevelBox(size: Vec3, bevel: number, center: Vec3 = [0, 0, 0], segments = 2): HardMesh {
  const m = extrude([[-size[0] / 2, -size[1] / 2], [size[0] / 2, -size[1] / 2], [size[0] / 2, size[1] / 2], [-size[0] / 2, size[1] / 2]], size[2], { bevel: { size: Math.min(bevel, size[2] / 2 - 1e-6), segments }, round: Math.min(bevel, size[0] / 2.01, size[1] / 2.01) });
  return m.transform(m4translation([center[0], center[1], center[2] - size[2] / 2]));
}


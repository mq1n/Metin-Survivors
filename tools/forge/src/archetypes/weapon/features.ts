// Crease (feature) edge lookup for hand-painted edge highlights / ink lines: distance from a surface point to the nearest convex
// and concave crease of the mesh, via a spatial hash of edge segments.
import type { HardModelMesh } from '../../core/hard/hardmesh.ts';
import type { Vec3 } from '../../core/math.ts';

export interface EdgeField {
  /** distances (m, capped at `reach`) to the nearest convex / concave feature edge */
  query(p: Vec3): { cvx: number; ccv: number };
  count: number;
}

export function buildEdgeField(mesh: HardModelMesh, minAngleDeg = 16, reach = 0.004): EdgeField {
  const pos = mesh.positions, idx = mesh.indices;
  const nt = idx.length / 3;
  const q = (x: number): number => Math.round(x / 1e-5);
  const key = (v: number): string => `${q(pos[v * 3]!)},${q(pos[v * 3 + 1]!)},${q(pos[v * 3 + 2]!)}`;
  interface Face { n: Vec3; opp: Vec3 }
  const edges = new Map<string, { a: number; b: number; faces: Face[] }>();
  for (let t = 0; t < nt; t++) {
    const v = [idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!];
    const P = v.map((i) => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!] as Vec3);
    const e1: Vec3 = [P[1]![0] - P[0]![0], P[1]![1] - P[0]![1], P[1]![2] - P[0]![2]], e2: Vec3 = [P[2]![0] - P[0]![0], P[2]![1] - P[0]![1], P[2]![2] - P[0]![2]];
    const c: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(c[0], c[1], c[2]);
    if (l < 1e-14) continue;
    const n: Vec3 = [c[0] / l, c[1] / l, c[2] / l];
    for (let k = 0; k < 3; k++) {
      const a = v[k]!, b = v[(k + 1) % 3]!;
      const ka = key(a), kb = key(b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      let e = edges.get(ek);
      if (!e) edges.set(ek, (e = { a, b, faces: [] }));
      e.faces.push({ n, opp: P[(k + 2) % 3]! });
    }
  }
  const cosMin = Math.cos((minAngleDeg * Math.PI) / 180);
  const segs: number[] = []; // ax ay az bx by bz sign
  for (const e of edges.values()) {
    if (e.faces.length !== 2) continue;
    const [f1, f2] = e.faces as [Face, Face];
    const d = f1.n[0] * f2.n[0] + f1.n[1] * f2.n[1] + f1.n[2] * f2.n[2];
    if (d > cosMin) continue;
    // convex when the opposite vertex of face 2 lies below the plane of face 1
    const pa: Vec3 = [pos[e.a * 3]!, pos[e.a * 3 + 1]!, pos[e.a * 3 + 2]!];
    const side = (f2.opp[0] - pa[0]) * f1.n[0] + (f2.opp[1] - pa[1]) * f1.n[1] + (f2.opp[2] - pa[2]) * f1.n[2];
    segs.push(pa[0], pa[1], pa[2], pos[e.b * 3]!, pos[e.b * 3 + 1]!, pos[e.b * 3 + 2]!, side < 0 ? 1 : -1);
  }
  const ns = segs.length / 7;
  const cell = 0.008;
  const grid = new Map<number, number[]>();
  const hk = (x: number, y: number, z: number): number => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  for (let s = 0; s < ns; s++) {
    const o = s * 7;
    const lo = [0, 1, 2].map((c) => Math.floor((Math.min(segs[o + c]!, segs[o + 3 + c]!) - reach) / cell));
    const hi = [0, 1, 2].map((c) => Math.floor((Math.max(segs[o + c]!, segs[o + 3 + c]!) + reach) / cell));
    for (let x = lo[0]!; x <= hi[0]!; x++) for (let y = lo[1]!; y <= hi[1]!; y++) for (let z = lo[2]!; z <= hi[2]!; z++) {
      const k = hk(x, y, z);
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(s);
    }
  }
  return {
    count: ns,
    query(p) {
      let cvx = reach, ccv = reach;
      const l = grid.get(hk(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)));
      if (l) {
        for (const s of l) {
          const o = s * 7;
          const ax = segs[o]!, ay = segs[o + 1]!, az = segs[o + 2]!;
          const dx = segs[o + 3]! - ax, dy = segs[o + 4]! - ay, dz = segs[o + 5]! - az;
          const l2 = dx * dx + dy * dy + dz * dz || 1;
          let t = ((p[0] - ax) * dx + (p[1] - ay) * dy + (p[2] - az) * dz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(p[0] - ax - dx * t, p[1] - ay - dy * t, p[2] - az - dz * t);
          if (segs[o + 6]! > 0) { if (d < cvx) cvx = d; } else if (d < ccv) ccv = d;
        }
      }
      return { cvx, ccv };
    },
  };
}

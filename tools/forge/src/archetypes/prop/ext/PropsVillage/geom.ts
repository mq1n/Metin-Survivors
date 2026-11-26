// Geometry helpers of the village props.
import { HardMesh } from '../../../../core/hard/hardmesh.ts';
import type { Vec2 as H2 } from '../../../../core/hard/shape2d.ts';
import type { Vec3 } from '../../../../core/math.ts';

/**
 * Lathe cut into `parts` equal arcs. A big ring unwraps as one 20 m strip, which caps the atlas texel density; arcs of 1/`parts` the
 * length pack far better. Each cut runs through the middle of a face (face `cut0 + j * segments / parts`), so both halves share the
 * face normal and the shading stays seamless, and the two sides stay 0.1 mm apart so the unwrapper cuts there. Same winding as
 * `revolve` (profile bottom -> top has outward normals).
 */
export function revolveArcs(profile: readonly H2[], segments: number, parts: number, cut0 = 0): HardMesh[] {
  const per = segments / parts;
  const ring = (r: number, y: number, k: number): Vec3 => {
    const th = (k / segments) * Math.PI * 2;
    return [Math.cos(th) * r, y, -Math.sin(th) * r];
  };
  /** middle of the edge a -> b, moved 0.1 mm toward `toward` */
  const midGap = (a: Vec3, b: Vec3, toward: Vec3): Vec3 => {
    const m: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const l = Math.hypot(toward[0] - m[0], toward[1] - m[1], toward[2] - m[2]);
    return l < 1e-9 ? m : [m[0] + ((toward[0] - m[0]) * 1e-4) / l, m[1] + ((toward[1] - m[1]) * 1e-4) / l, m[2] + ((toward[2] - m[2]) * 1e-4) / l];
  };
  const out: HardMesh[] = [];
  for (let j = 0; j < parts; j++) {
    const m = new HardMesh();
    const f0 = cut0 + j * per, f1 = cut0 + (j + 1) * per;
    for (let i = 0; i + 1 < profile.length; i++) {
      const [r0, y0] = profile[i]!, [r1, y1] = profile[i + 1]!;
      if (r0 < 1e-9 && r1 < 1e-9) continue;
      for (let f = f0; f <= f1; f++) {
        const k = f % segments;
        const a = ring(r0, y0, k), b = ring(r0, y0, k + 1), c = ring(r1, y1, k + 1), d = ring(r1, y1, k);
        const first = f === f0, last = f === f1;
        const qa = first ? midGap(a, b, b) : a, qd = first ? midGap(d, c, c) : d;
        const qb = last ? midGap(a, b, a) : b, qc = last ? midGap(d, c, d) : c;
        if (r0 < 1e-9) m.tri(qa, qc, qd);
        else if (r1 < 1e-9) m.tri(qa, qb, qd);
        else m.quad(qa, qb, qc, qd);
      }
    }
    out.push(m);
  }
  return out;
}

// 2-D outline helpers for the hard-surface module (extrude / sweep profiles, lathe profiles).
export type Vec2 = [number, number];

export const rectShape = (w: number, h: number): Vec2[] => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];

export function ngonShape(r: number, n: number, phase = 0): Vec2[] {
  return Array.from({ length: n }, (_, i) => [Math.cos(phase + (i / n) * Math.PI * 2) * r, Math.sin(phase + (i / n) * Math.PI * 2) * r] as Vec2);
}

export const circleShape = (r: number, n = 24): Vec2[] => ngonShape(r, n);

export function signedArea(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]!, [x1, y1] = p[(i + 1) % p.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** counter-clockwise copy */
export const ensureCCW = (p: readonly Vec2[]): Vec2[] => (signedArea(p) < 0 ? [...p].reverse() : [...p]);

/**
 * Round every corner of an outline with an arc of `radius` (clamped to half of the adjacent edges), `segments` per corner.
 * `closed=false` keeps the end points (profile polylines for lathe).
 */
export function roundCorners(p: readonly Vec2[], radius: number, segments = 4, closed = true): Vec2[] {
  const n = p.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const cur = p[i]!;
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(cur);
      continue;
    }
    const prev = p[(i - 1 + n) % n]!, next = p[(i + 1) % n]!;
    const v0: Vec2 = [prev[0] - cur[0], prev[1] - cur[1]], v1: Vec2 = [next[0] - cur[0], next[1] - cur[1]];
    const l0 = Math.hypot(...v0), l1 = Math.hypot(...v1);
    const u0: Vec2 = [v0[0] / l0, v0[1] / l0], u1: Vec2 = [v1[0] / l1, v1[1] / l1];
    const cos = Math.max(-1, Math.min(1, u0[0] * u1[0] + u0[1] * u1[1]));
    const ang = Math.acos(cos);
    if (ang > Math.PI - 1e-3 || ang < 1e-3) {
      out.push(cur);
      continue;
    }
    let r = radius;
    const tan = Math.tan(ang / 2);
    const maxR = (Math.min(l0, l1) / 2) * tan;
    if (r > maxR) r = maxR;
    const d = r / tan;
    const a: Vec2 = [cur[0] + u0[0] * d, cur[1] + u0[1] * d], b: Vec2 = [cur[0] + u1[0] * d, cur[1] + u1[1] * d];
    const bis: Vec2 = [u0[0] + u1[0], u0[1] + u1[1]];
    const bl = Math.hypot(...bis) || 1;
    const c: Vec2 = [cur[0] + (bis[0] / bl) * (r / Math.sin(ang / 2)), cur[1] + (bis[1] / bl) * (r / Math.sin(ang / 2))];
    const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
    let a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    a1 = a0 + da;
    for (let k = 0; k <= segments; k++) {
      const t = a0 + (a1 - a0) * (k / segments);
      out.push([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r]);
    }
  }
  return out;
}

/** Miter offset of a CCW outline: d > 0 grows, d < 0 shrinks. */
export function offsetShape(p: readonly Vec2[], d: number): Vec2[] {
  const n = p.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n]!, b = p[i]!, c = p[(i + 1) % n]!;
    const e0: Vec2 = [b[0] - a[0], b[1] - a[1]], e1: Vec2 = [c[0] - b[0], c[1] - b[1]];
    const l0 = Math.hypot(...e0) || 1, l1 = Math.hypot(...e1) || 1;
    // outward normals of CCW edges are (dy, -dx)
    const n0: Vec2 = [e0[1] / l0, -e0[0] / l0], n1: Vec2 = [e1[1] / l1, -e1[0] / l1];
    const mx = n0[0] + n1[0], my = n0[1] + n1[1];
    const k = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    const s = k < 1e-4 ? 1 : 1 / k;
    out.push([b[0] + mx * s * d, b[1] + my * s * d]);
  }
  return out;
}

/** ear-clipping triangulation of a simple CCW polygon; returns index triples */
export function triangulate(poly: readonly Vec2[]): [number, number, number][] {
  const n = poly.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  const tris: [number, number, number][] = [];
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length]!, i1 = idx[i]!, i2 = idx[(i + 1) % idx.length]!;
      const a = poly[i0]!, b = poly[i1]!, c = poly[i2]!;
      if (cross(a, b, c) <= 1e-12) continue;
      let ear = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inside(poly[j]!, a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      tris.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([idx[0]!, idx[1]!, idx[2]!]);
  return tris;
}

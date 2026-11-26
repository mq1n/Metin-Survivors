// Weapon geometry kit, part 1: ring lofts, blades, talons, tapered bars.
// Everything is authored in the canonical weapon frame: origin = grip centre, +Y = business end, +Z = cutting edge / forward,
// +X = flat face normal. Builders return plain HardMeshes whose triangles carry a zone id (see zones.ts) in `triGroup`.
import { HardMesh } from '../../core/hard/hardmesh.ts';
import type { Vec3 } from '../../core/math.ts';
import { smoothstep, vcross, vdot, vnorm, vsub } from '../../core/math.ts';

export type Ring = Vec3[];
export type Vec2 = [number, number];

/** Newell normal of a closed ring (right-hand rule along traversal order). */
export function ringNormal(r: readonly Vec3[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

const centroid = (r: readonly Vec3[]): Vec3 => {
  let x = 0, y = 0, z = 0;
  for (const p of r) { x += p[0]; y += p[1]; z += p[2]; }
  return [x / r.length, y / r.length, z / r.length];
};

export interface LoftOpts {
  /** zone id for every ring segment i -> i+1 (array length = ring length) or one zone for the whole loft */
  zones: number | readonly number[];
  capStart?: boolean;
  capEnd?: boolean;
  /** cap zone (defaults to zones[0]) */
  capZone?: number;
}

/** Connect consecutive equal-length closed rings into an outward-facing skin (orientation auto-detected from the ring winding). */
export function loft(m: HardMesh, rings: readonly Ring[], o: LoftOpts): HardMesh {
  const n = rings[0]!.length;
  const zoneOf = (i: number): number => (typeof o.zones === 'number' ? o.zones : o.zones[i % o.zones.length]!);
  const g0 = m.group;
  for (let r = 0; r + 1 < rings.length; r++) {
    const a = rings[r]!, b = rings[r + 1]!;
    // travel direction from the ring centroids (falls back to the next-but-one ring when two rings coincide)
    let t = vsub(centroid(b), centroid(a));
    if (Math.hypot(t[0], t[1], t[2]) < 1e-9 && rings[r + 2]) t = vsub(centroid(rings[r + 2]!), centroid(a));
    const na = ringNormal(a), nb = ringNormal(b);
    const nrm = Math.hypot(na[0], na[1], na[2]) >= Math.hypot(nb[0], nb[1], nb[2]) ? na : nb;
    const ccw = vdot(nrm, t) >= 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      m.group = zoneOf(i);
      if (ccw) m.quad(a[i]!, a[j]!, b[j]!, b[i]!);
      else m.quad(a[i]!, b[i]!, b[j]!, a[j]!);
    }
  }
  const capZone = o.capZone ?? zoneOf(0);
  const first = rings[0]!, last = rings[rings.length - 1]!;
  if (rings.length > 1) {
    const tFirst = vsub(centroid(rings[1]!), centroid(first));
    const tLast = vsub(centroid(last), centroid(rings[rings.length - 2]!));
    m.group = capZone;
    if (o.capStart) {
      const facing = vdot(ringNormal(first), tFirst) > 0 ? [...first].reverse() : [...first];
      m.polygon(facing);
    }
    if (o.capEnd) {
      const facing = vdot(ringNormal(last), tLast) > 0 ? [...last] : [...last].reverse();
      if (!facing.every((p) => p[0] === facing[0]![0] && p[1] === facing[0]![1] && p[2] === facing[0]![2])) m.polygon(facing);
    }
  }
  m.group = g0;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// frames along a path

export interface Frame { p: Vec3; t: Vec3; x: Vec3; y: Vec3 }

/**
 * Frames along a polyline. With `up` the frame is rebuilt from it at every point (x = up × t, y = t × x): stable for planar curves
 * (up = [1,0,0] on a curve in the YZ plane gives x = in-plane normal, y = +X). Without `up` parallel transport is used.
 */
export function pathFrames(path: readonly Vec3[], up?: Vec3): Frame[] {
  const n = path.length;
  const tan: Vec3[] = path.map((_, i) => vnorm(vsub(path[Math.min(n - 1, i + 1)]!, path[Math.max(0, i - 1)]!)));
  const out: Frame[] = [];
  let x: Vec3 = [1, 0, 0], y: Vec3 = [0, 1, 0];
  for (let i = 0; i < n; i++) {
    const t = tan[i]!;
    if (up) {
      x = vnorm(vcross(up, t));
      y = vcross(t, x);
    } else if (i === 0) {
      const hint: Vec3 = Math.abs(t[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
      x = vnorm(vcross(hint, t));
      y = vcross(t, x);
    } else {
      const t0 = tan[i - 1]!;
      const ax = vcross(t0, t);
      const s = Math.hypot(ax[0], ax[1], ax[2]);
      if (s > 1e-9) {
        const k = vnorm(ax), c = vdot(t0, t);
        const rot = (v: Vec3): Vec3 => {
          const kv = vcross(k, v), kd = vdot(k, v);
          return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
        };
        x = rot(x);
        y = rot(y);
      }
    }
    out.push({ p: path[i]!, t, x, y });
  }
  return out;
}

/** place a 2-D section (a along frame.x, b along frame.y) at a frame */
export const placeSection = (f: Frame, sec: readonly Vec2[], scale = 1): Ring => sec.map(([a, b]) => [f.p[0] + (f.x[0] * a + f.y[0] * b) * scale, f.p[1] + (f.x[1] * a + f.y[1] * b) * scale, f.p[2] + (f.x[2] * a + f.y[2] * b) * scale] as Vec3);

/** loft one section (optionally varying with t) along a path */
export function sweepSection(m: HardMesh, path: readonly Vec3[], section: readonly Vec2[] | ((t: number, i: number) => readonly Vec2[]), o: LoftOpts & { up?: Vec3; scale?: (t: number) => number; tipPoint?: boolean }): HardMesh {
  const fr = pathFrames(path, o.up);
  const rings = fr.map((f, i) => {
    const t = fr.length > 1 ? i / (fr.length - 1) : 0;
    const sec = typeof section === 'function' ? section(t, i) : section;
    return placeSection(f, sec, o.scale ? o.scale(t) : 1);
  });
  if (o.tipPoint) {
    const c = path[path.length - 1]!;
    rings[rings.length - 1] = rings[rings.length - 1]!.map(() => [c[0], c[1], c[2]] as Vec3);
  }
  return loft(m, rings, o);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// section helpers

/** rounded-rectangle-ish section: w/h half extents, chamfer c; 8 vertices CCW from +a/+b corner */
export const chamferRect = (w: number, h: number, c: number): Vec2[] => {
  const k = Math.min(c, w * 0.9, h * 0.9);
  return [[w, h - k], [w - k, h], [-w + k, h], [-w, h - k], [-w, -h + k], [-w + k, -h], [w - k, -h], [w, -h + k]];
};
export const diamond = (w: number, h: number): Vec2[] => [[w, 0], [0, h], [-w, 0], [0, -h]];
export const hexSection = (w: number, h: number, f = 0.55): Vec2[] => [[w, 0], [w * f, h], [-w * f, h], [-w, 0], [-w * f, -h], [w * f, -h]];
export function ovalSection(a: number, b: number, n = 8, phase = 0): Vec2[] {
  return Array.from({ length: n }, (_, i) => [Math.cos(phase + (i / n) * Math.PI * 2) * a, Math.sin(phase + (i / n) * Math.PI * 2) * b] as Vec2);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// blade

export interface FullerSpec {
  /** centre of the groove across the blade, fraction of the mean half-width (-1 = spine side, +1 = edge side) */
  c?: number;
  /** half-width of the groove, fraction of the mean half-width */
  hw: number;
  /** groove depth, fraction of half thickness */
  depth: number;
  t0: number;
  t1: number;
  /** ramp length at both ends (t units) */
  ramp?: number;
  /** also cut the -X face (default true) */
  both?: boolean;
}

export interface BladeSpec {
  y0: number;
  length: number;
  /** t stations (0..1, ascending, must start 0 and end 1); default 14 uniform */
  stations?: readonly number[];
  /** half-width on the +Z (edge) side */
  halfW: (t: number) => number;
  /** half-width on the -Z side (default = halfW) */
  halfWBack?: (t: number) => number;
  /** half thickness at the centre */
  halfT: (t: number) => number;
  /** centre line offset along +Z */
  bendZ?: (t: number) => number;
  /** double edged (diamond/flat bevel both sides) or single edged (flat spine at -Z) */
  single?: boolean;
  /** bevel width as fraction of the half width (edge side); default 0.28 */
  bevel?: number;
  /** spine-side bevel (double edged only) default = bevel */
  bevelBack?: number;
  fuller?: FullerSpec;
  /** z of the tip point relative to the centre line at t=1 (clipped / swept points); default 0 */
  tipZ?: number;
  /** fraction of the last station that is the tip cone; the final ring collapses to the tip point. default true */
  collapse?: boolean;
  zones: { flat: number; edge: number; fuller: number; spine: number };
  /** spine chamfer for single-edged blades (m) */
  spineChamfer?: number;
}

const sstep = (a: number, b: number, x: number): number => smoothstep(a, b, x);

/** loft a blade: ring vertex layout is constant (diamond/flat 6 verts, +fuller 14, single edged +1 per side) */
export function bladeMesh(m: HardMesh, s: BladeSpec): HardMesh {
  const st = s.stations ?? Array.from({ length: 15 }, (_, i) => i / 14);
  const bevR = s.bevel ?? 0.28, bevL = s.bevelBack ?? bevR;
  const rings: Ring[] = [];
  let ringZones: number[] = [];
  for (let k = 0; k < st.length; k++) {
    const t = st[k]!;
    const wr = Math.max(1e-4, s.halfW(t)), wl = Math.max(1e-4, (s.halfWBack ?? s.halfW)(t)), h = Math.max(1e-4, s.halfT(t));
    const br = wr * bevR, bl = wl * bevL;
    const bend = s.bendZ ? s.bendZ(t) : 0;
    const dbend = s.bendZ ? (s.bendZ(Math.min(1, t + 0.002)) - s.bendZ(Math.max(0, t - 0.002))) / (Math.min(1, t + 0.002) - Math.max(0, t - 0.002)) : 0;
    const L = s.length;
    const tl = Math.hypot(L, dbend);
    const nz: Vec3 = [0, -dbend / tl, L / tl]; // in-plane normal (blade width axis)
    // section points as [z, x], CCW seen from +Y when x is up and z right...  (orientation is auto-detected in loft)
    const pts: Vec2[] = [];
    const zones: number[] = [];
    const push = (z: number, x: number, zone: number): void => {
      pts.push([z, x]);
      zones.push(zone);
    };
    // +X face, going from the +Z edge to the -Z side; zone = zone of the segment starting at this vertex
    const f = s.fuller;
    let fa = 0;
    if (f) fa = sstep(f.t0, f.t0 + (f.ramp ?? 0.04), t) * (1 - sstep(f.t1 - (f.ramp ?? 0.04), f.t1, t));
    const mean = (wr + wl) / 2;
    const zf = f ? (f.c ?? 0) * mean * 0.5 : 0;
    const fw = f ? Math.min(f.hw * mean, Math.min(wr - br, wl - bl) - 1e-4 - Math.abs(zf)) : 0;
    const fd = f ? f.depth * h * fa : 0;
    const both = f ? f.both !== false : false;
    // --- +X face
    push(wr, 0, s.zones.edge); // edge point, segment to shoulder is bevel
    push(wr - br, h, f ? s.zones.flat : s.zones.flat);
    if (f) {
      push(zf + fw, h, s.zones.fuller);
      push(zf + fw * 0.7, h - fd, s.zones.fuller);
      push(zf - fw * 0.7, h - fd, s.zones.fuller);
      push(zf - fw, h, s.zones.flat);
    }
    if (s.single) {
      const c = Math.min(s.spineChamfer ?? 0.0035, h * 0.6);
      push(-wl + c, h, s.zones.spine);
      push(-wl, h - c, s.zones.spine);
      push(-wl, -h + c, s.zones.spine);
      push(-wl + c, -h, s.zones.flat);
    } else {
      push(-wl + bl, h, s.zones.edge);
      push(-wl, 0, s.zones.edge);
      push(-wl + bl, -h, s.zones.flat);
    }
    // --- -X face back toward the +Z edge
    if (f) {
      push(zf - fw, -h, both ? s.zones.fuller : s.zones.flat);
      push(zf - fw * 0.7, -(h - (both ? fd : 0)), s.zones.fuller);
      push(zf + fw * 0.7, -(h - (both ? fd : 0)), s.zones.fuller);
      push(zf + fw, -h, s.zones.flat);
    }
    push(wr - br, -h, s.zones.edge);
    ringZones = zones;
    const last = k === st.length - 1;
    const tip = last && s.collapse !== false;
    const cy = s.y0 + t * s.length;
    const ring: Ring = pts.map(([z, x]) => {
      if (tip) return [0, cy, bend + (s.tipZ ?? 0)] as Vec3;
      return [x, cy + z * nz[1]!, bend + z * nz[2]!] as Vec3;
    });
    rings.push(ring);
  }
  loft(m, rings, { zones: ringZones, capStart: false, capEnd: false });
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// talons / fangs / spikes: a tapered curved blade along a path

export interface TalonSpec {
  path: readonly Vec3[];
  /** half extents of the base section (a across the blade, b thickness) */
  w: number;
  h: number;
  /** direction of the blade width (frame x) hint: planar blade lying in the plane spanned by the path and this vector's perpendicular */
  up?: Vec3;
  /** taper exponent: scale(t) = (1-t)^p ... default 0.8 */
  taper?: number;
  zones: { flat: number; edge: number };
  /** bevel: hexagonal section if true */
  hex?: boolean;
  /** keep a blunt tip at this fraction of the base size (0 = needle) */
  tipSize?: number;
}

export function talon(m: HardMesh, s: TalonSpec): HardMesh {
  const p = s.taper ?? 0.8;
  const sec: Vec2[] = s.hex ? hexSection(s.w, s.h, 0.5) : diamond(s.w, s.h);
  const zones = s.hex ? [s.zones.edge, s.zones.flat, s.zones.flat, s.zones.edge, s.zones.flat, s.zones.flat] : [s.zones.edge, s.zones.flat, s.zones.edge, s.zones.flat];
  return sweepSection(m, s.path, sec, {
    zones,
    up: s.up,
    capStart: true,
    tipPoint: true,
    scale: (t) => Math.max(s.tipSize ?? 0.02, (1 - t) ** p),
  });
}

/** point on a quadratic bezier */
export const bez2 = (a: Vec3, b: Vec3, c: Vec3, t: number): Vec3 => [
  (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0],
  (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1],
  (1 - t) * (1 - t) * a[2] + 2 * (1 - t) * t * b[2] + t * t * c[2],
];
export const bez3 = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, t: number): Vec3 => {
  const u = 1 - t;
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    u * u * u * a[2] + 3 * u * u * t * b[2] + 3 * u * t * t * c[2] + t * t * t * d[2],
  ];
};
export const sampleBez3 = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: number): Vec3[] => Array.from({ length: n + 1 }, (_, i) => bez3(a, b, c, d, i / n));
export const sampleBez2 = (a: Vec3, b: Vec3, c: Vec3, n: number): Vec3[] => Array.from({ length: n + 1 }, (_, i) => bez2(a, b, c, i / n));

/** Catmull-Rom through points (open), `sub` samples per span */
export function catmull(pts: readonly Vec3[], sub = 4): Vec3[] {
  const out: Vec3[] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(n - 1, i + 2)]!;
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((c) => 0.5 * (2 * p1[c]! + (-p0[c]! + p2[c]!) * t + (2 * p0[c]! - 5 * p1[c]! + 4 * p2[c]! - p3[c]!) * t2 + (-p0[c]! + 3 * p1[c]! - 3 * p2[c]! + p3[c]!) * t3)) as Vec3);
    }
  }
  out.push(pts[n - 1]!);
  return out;
}

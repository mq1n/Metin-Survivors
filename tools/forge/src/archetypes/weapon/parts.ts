// Weapon geometry kit, part 2: plates, lathe parts, grips, gems, ribbons, hoops, bars. Canonical weapon frame (see loft.ts).
import { HardMesh, extrude, lathe, sweep } from '../../core/hard/hardmesh.ts';
import { circleShape, roundCorners } from '../../core/hard/shape2d.ts';
import type { Mat4, Vec3 } from '../../core/math.ts';
import { m4fromQuat, m4mul, m4translation, qaxis, qfromTo, qmul, vnorm } from '../../core/math.ts';
import { type Vec2, chamferRect, loft, ovalSection, sweepSection } from './loft.ts';

/** append `src` into `dst`, giving its unassigned (group 0) triangles `zone` */
export function add(dst: HardMesh, src: HardMesh, zone: number, m?: Mat4): HardMesh {
  const g = dst.group;
  dst.group = zone;
  src.appendTo(dst, m);
  dst.group = g;
  return dst;
}

/** rotation about an axis then translation */
export const place = (pos: Vec3, axis: Vec3 = [0, 1, 0], angle = 0): Mat4 => m4mul(m4translation(pos), m4fromQuat(qaxis(axis, angle)));
/** rotate +Y onto `dir`, then translate */
export const orient = (pos: Vec3, dir: Vec3, roll = 0): Mat4 => m4mul(m4translation(pos), m4fromQuat(qmul(qfromTo([0, 1, 0], vnorm(dir)), qaxis([0, 1, 0], roll))));

// ---------------------------------------------------------------------------------------------------------------------------------
// outlines

/** half outline (a >= 0, from the top axis point to the bottom axis point) -> closed polygon mirrored across a = 0 */
export function mirrorOutline(half: readonly Vec2[]): Vec2[] {
  const left = [...half].reverse().filter(([a]) => Math.abs(a) > 1e-6).map(([a, b]) => [-a, b] as Vec2);
  return [...half.map(([a, b]) => [a, b] as Vec2), ...left];
}

export interface PlateOpts {
  /** extrusion depth */
  depth: number;
  /** start of the extrusion along the axis. default = -depth/2 (centred) */
  z0?: number;
  bevel?: number;
  bevelSegments?: number;
  /** round the outline corners (m) before extruding */
  round?: number;
  taper?: number;
}

/** outline drawn as (z, y) (blade-face view), extruded along X */
export function plateX(outlineZY: readonly Vec2[], o: PlateOpts): HardMesh {
  const pts = outlineZY.map(([z, y]) => [y, z] as Vec2);
  return extrude(pts, o.depth, { axis: 'x', z0: o.z0 ?? -o.depth / 2, round: o.round, taper: o.taper, bevel: o.bevel ? { size: o.bevel, segments: o.bevelSegments ?? 1 } : undefined });
}

/** outline drawn as (x, z) (top view), extruded along Y */
export function plateY(outlineXZ: readonly Vec2[], o: PlateOpts & { y0: number }): HardMesh {
  return extrude(outlineXZ, o.depth, { axis: 'y', z0: o.y0, round: o.round, taper: o.taper, bevel: o.bevel ? { size: o.bevel, segments: o.bevelSegments ?? 1 } : undefined });
}

/** closed polygon from a function of angle */
export function polar(n: number, r: (a: number) => number, phase = 0): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    const rr = r(a);
    return [Math.cos(a) * rr, Math.sin(a) * rr] as Vec2;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// revolved parts

export interface SpinOpts {
  segments?: number;
  /** round the profile corners (m) */
  round?: number;
  roundSegments?: number;
}

/** surface of revolution around +Y from a [radius, y] profile (bottom to top) */
export function spin(profile: readonly Vec2[], o: SpinOpts = {}): HardMesh {
  const p = o.round ? roundCorners(profile, o.round, o.roundSegments ?? 2, false) : [...profile];
  return lathe(p, { segments: o.segments ?? 12 });
}

/** faceted gem: a pointed cabochon lying on the XZ plane base, height along +Y. */
export function gemMesh(r: number, h: number, facets = 6, base = 0.28): HardMesh {
  return lathe([[0, -h * base], [r * 0.82, -h * base * 0.4], [r, 0], [r * 0.7, h * 0.5], [r * 0.3, h * 0.85], [0, h]], { segments: facets });
}

/** torus-like hoop in a plane: centre c, radius R, tube radius r, normal along `axis` ('x'|'y'|'z') */
export function hoop(R: number, r: number, axis: 'x' | 'y' | 'z', segs = 16, tubeSegs = 5, c: Vec3 = [0, 0, 0], arc = Math.PI * 2, phase = 0): HardMesh {
  const closed = Math.abs(arc - Math.PI * 2) < 1e-6;
  const n = closed ? segs : segs + 1;
  const path: Vec3[] = Array.from({ length: n }, (_, i) => {
    const a = phase + (i / (closed ? segs : segs)) * arc;
    const u = Math.cos(a) * R, v = Math.sin(a) * R;
    return axis === 'y' ? [c[0] + u, c[1], c[2] + v] : axis === 'x' ? [c[0], c[1] + u, c[2] + v] : [c[0] + u, c[1] + v, c[2]];
  });
  return sweep(circleShape(r, tubeSegs), path, { closed, caps: !closed });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// grips / bars / ribbons

export interface GripOpts {
  y0: number;
  y1: number;
  /** half extents of the oval (a along X, b along Z) */
  a: number;
  b: number;
  n?: number;
  /** full turns of twist over the length (spiral wrap ridges) */
  twist?: number;
  /** relative swell at mid length */
  bulge?: number;
  rings?: number;
  zone: number;
}

/** oval grip with swell and spiral facets */
export function gripMesh(dst: HardMesh, o: GripOpts): HardMesh {
  const n = o.n ?? 8, rings = o.rings ?? 8;
  const out: Vec3[][] = [];
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const y = o.y0 + (o.y1 - o.y0) * t;
    const s = 1 + (o.bulge ?? 0.1) * Math.sin(Math.PI * t) - 0.04 * (1 - t);
    const phase = (o.twist ?? 0) * Math.PI * 2 * t;
    out.push(ovalSection(o.a * s, o.b * s, n, phase).map(([u, v]) => [u, y, v] as Vec3));
  }
  return loft(dst, out, { zones: o.zone, capStart: true, capEnd: true });
}

/** tapered rectangular bar from a to b (a/b = half extents of the two end sections: [across, thick]) */
export function bar(dst: HardMesh, a: Vec3, b: Vec3, ha: Vec2, hb: Vec2, zone: number, up: Vec3 = [1, 0, 0], chamfer = 0.003, caps = true): HardMesh {
  return sweepSection(
    dst,
    [a, b],
    (t) => chamferRect(ha[0] + (hb[0] - ha[0]) * t, ha[1] + (hb[1] - ha[1]) * t, chamfer),
    { zones: zone, up, capStart: caps, capEnd: caps },
  );
}

/** flat cloth strip along a path with width taper */
export function ribbon(dst: HardMesh, path: readonly Vec3[], w0: number, w1: number, thick: number, zone: number, up: Vec3 = [1, 0, 0]): HardMesh {
  const sec = (t: number): Vec2[] => {
    const w = w0 + (w1 - w0) * t;
    return [[w, thick], [-w, thick], [-w, -thick], [w, -thick]];
  };
  return sweepSection(dst, path, (t) => sec(t), { zones: zone, up, capStart: true, capEnd: true });
}

/** build a ring of lobes: a rosette outline (petals) as a closed polygon, for guards / lotus caps */
export function rosette(lobes: number, rIn: number, rOut: number, pointy = 0.6, seg = 6): Vec2[] {
  return polar(lobes * seg, (a) => {
    const t = ((a * lobes) / (Math.PI * 2)) % 1;
    const k = Math.abs(Math.sin(t * Math.PI));
    return rIn + (rOut - rIn) * Math.pow(k, pointy);
  });
}

/** chamfered box (full extents [x, y, z]) centred on c: 28 triangles */
export function box(dst: HardMesh, c: Vec3, size: Vec3, chamfer: number, zone: number): HardMesh {
  return sweepSection(dst, [[c[0], c[1] - size[1] / 2, c[2]], [c[0], c[1] + size[1] / 2, c[2]]], chamferRect(size[2] / 2, size[0] / 2, chamfer), {
    zones: zone,
    up: [1, 0, 0],
    capStart: true,
    capEnd: true,
  });
}

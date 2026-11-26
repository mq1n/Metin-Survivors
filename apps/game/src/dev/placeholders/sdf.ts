// DEV-only signed-distance-field shape builder. Creatures, heroes, chests and rocks are modelled as smooth unions of
// round-cones / ellipsoids / rounded boxes (each bound to a bone), then polygonised by mesher.ts. This is what turns
// "capsule limbs" into one blended organic surface instead of visible primitives.
import { Color, Euler, Matrix4 } from 'three';
import type { RGB, Vec3 } from './math';

export const K_RC = 0;
export const K_ELL = 1;
export const K_BOX = 2;
export const K_CYL = 3;
export const K_TORUS = 4;
export const K_SPH = 5;

export type PrimOp = 'add' | 'sub' | 'paint';

export interface PrimOpt {
  /** smooth blend width (m) for union / subtraction */
  k?: number;
  color?: string | RGB;
  op?: PrimOp;
  /** euler XYZ (rad) orientation for ell / box / cyl / torus */
  rot?: Vec3;
  /** paint edge softness (m) */
  soft?: number;
  /** paint opacity 0..1 */
  alpha?: number;
  /** weight of this prim in the base colour blend (0 = never contributes colour) */
  cw?: number;
  /** skin falloff length (m) override */
  sigma?: number;
  /** skin weight multiplier (0 = prim never drives its bone) */
  skin?: number;
}

const tmpColor = new Color();
const colorCache = new Map<string, RGB>();

/** `#rrggbb` (sRGB) to linear RGB. */
export function rgb(c: string | RGB): RGB {
  if (typeof c !== 'string') return c;
  const hit = colorCache.get(c);
  if (hit) return hit;
  tmpColor.set(c);
  const v: RGB = [tmpColor.r, tmpColor.g, tmpColor.b];
  colorCache.set(c, v);
  return v;
}

/** linear RGB back to `#rrggbb` (sRGB) */
export function toHex(c: RGB): string {
  tmpColor.setRGB(c[0], c[1], c[2]);
  return `#${tmpColor.getHexString()}`;
}

export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number): number {
  if (k <= 0) return a > b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a > b ? a : b) + h * h * k * 0.25;
}

export class Prim {
  kind: number;
  readonly op: PrimOp;
  readonly bone: number;
  readonly k: number;
  readonly color: RGB;
  readonly soft: number;
  readonly alpha: number;
  readonly cw: number;
  readonly sigma: number;
  readonly skin: number;
  // geometry
  ax = 0;
  ay = 0;
  az = 0;
  bax = 0;
  bay = 0;
  baz = 0;
  r1 = 0;
  r2 = 0;
  hx = 0;
  hy = 0;
  hz = 0;
  rnd = 0;
  // round cone precompute
  l2 = 0;
  rr = 0;
  a2 = 0;
  il2 = 0;
  /** world→local rotation (row major) or null */
  m: Float64Array | null = null;
  readonly bmin: [number, number, number] = [0, 0, 0];
  readonly bmax: [number, number, number] = [0, 0, 0];

  constructor(kind: number, bone: number, opt: PrimOpt) {
    this.kind = kind;
    this.bone = bone;
    this.op = opt.op ?? 'add';
    this.k = opt.k ?? 0.04;
    this.color = rgb(opt.color ?? '#808080');
    this.soft = opt.soft ?? 0.012;
    this.alpha = opt.alpha ?? 1;
    this.cw = opt.cw ?? 1;
    this.sigma = opt.sigma ?? 0;
    this.skin = opt.skin ?? 1;
    if (opt.rot) {
      const e = new Euler(opt.rot[0], opt.rot[1], opt.rot[2], 'XYZ');
      const r = new Matrix4().makeRotationFromEuler(e); // local → world
      const m = new Float64Array(9);
      const el = r.elements;
      // world → local = transpose
      m[0] = el[0] as number;
      m[1] = el[1] as number;
      m[2] = el[2] as number;
      m[3] = el[4] as number;
      m[4] = el[5] as number;
      m[5] = el[6] as number;
      m[6] = el[8] as number;
      m[7] = el[9] as number;
      m[8] = el[10] as number;
      this.m = m;
    }
  }

  /** half extents of the world AABB of a rotated local box with half extents (hx,hy,hz) */
  private rotExtent(hx: number, hy: number, hz: number): [number, number, number] {
    const m = this.m;
    if (!m) return [hx, hy, hz];
    // m rows are local axes in world coords; world extent along axis i = Σ_j |m[j][i]| h_j
    return [
      Math.abs(m[0] as number) * hx + Math.abs(m[3] as number) * hy + Math.abs(m[6] as number) * hz,
      Math.abs(m[1] as number) * hx + Math.abs(m[4] as number) * hy + Math.abs(m[7] as number) * hz,
      Math.abs(m[2] as number) * hx + Math.abs(m[5] as number) * hy + Math.abs(m[8] as number) * hz,
    ];
  }

  finish(): void {
    const { bmin, bmax } = this;
    if (this.kind === K_RC) {
      const bx = this.ax + this.bax;
      const by = this.ay + this.bay;
      const bz = this.az + this.baz;
      const r = Math.max(this.r1, this.r2);
      bmin[0] = Math.min(this.ax, bx) - r;
      bmin[1] = Math.min(this.ay, by) - r;
      bmin[2] = Math.min(this.az, bz) - r;
      bmax[0] = Math.max(this.ax, bx) + r;
      bmax[1] = Math.max(this.ay, by) + r;
      bmax[2] = Math.max(this.az, bz) + r;
      return;
    }
    let ex: [number, number, number];
    if (this.kind === K_SPH) ex = [this.r1, this.r1, this.r1];
    else if (this.kind === K_TORUS) ex = this.rotExtent(this.hx + this.hy, this.hy, this.hx + this.hy);
    else if (this.kind === K_CYL) ex = this.rotExtent(this.hx, this.hy, this.hx);
    else ex = this.rotExtent(this.hx, this.hy, this.hz);
    bmin[0] = this.ax - ex[0];
    bmin[1] = this.ay - ex[1];
    bmin[2] = this.az - ex[2];
    bmax[0] = this.ax + ex[0];
    bmax[1] = this.ay + ex[1];
    bmax[2] = this.az + ex[2];
  }

  dist(x: number, y: number, z: number): number {
    const dx = x - this.ax;
    const dy = y - this.ay;
    const dz = z - this.az;
    switch (this.kind) {
      case K_SPH:
        return Math.sqrt(dx * dx + dy * dy + dz * dz) - this.r1;
      case K_RC: {
        const { bax, bay, baz, l2, rr, a2, il2 } = this;
        const yy = dx * bax + dy * bay + dz * baz;
        const zz = yy - l2;
        const qx = dx * l2 - bax * yy;
        const qy = dy * l2 - bay * yy;
        const qz = dz * l2 - baz * yy;
        const x2 = qx * qx + qy * qy + qz * qz;
        const y2 = yy * yy * l2;
        const z2 = zz * zz * l2;
        const k = Math.sign(rr) * rr * rr * x2;
        if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - this.r2;
        if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - this.r1;
        return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - this.r1;
      }
      default:
        break;
    }
    let lx = dx;
    let ly = dy;
    let lz = dz;
    const m = this.m;
    if (m) {
      lx = (m[0] as number) * dx + (m[1] as number) * dy + (m[2] as number) * dz;
      ly = (m[3] as number) * dx + (m[4] as number) * dy + (m[5] as number) * dz;
      lz = (m[6] as number) * dx + (m[7] as number) * dy + (m[8] as number) * dz;
    }
    switch (this.kind) {
      case K_ELL: {
        const ux = lx / this.hx;
        const uy = ly / this.hy;
        const uz = lz / this.hz;
        const k0 = Math.sqrt(ux * ux + uy * uy + uz * uz);
        const vx = ux / this.hx;
        const vy = uy / this.hy;
        const vz = uz / this.hz;
        const k1 = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (k1 < 1e-9) return -Math.min(this.hx, this.hy, this.hz);
        return (k0 * (k0 - 1)) / k1;
      }
      case K_BOX: {
        const r = this.rnd;
        const qx = Math.abs(lx) - (this.hx - r);
        const qy = Math.abs(ly) - (this.hy - r);
        const qz = Math.abs(lz) - (this.hz - r);
        const mx = qx > 0 ? qx : 0;
        const my = qy > 0 ? qy : 0;
        const mz = qz > 0 ? qz : 0;
        return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
      }
      case K_CYL: {
        const r = this.rnd;
        const qx = Math.sqrt(lx * lx + lz * lz) - (this.hx - r);
        const qy = Math.abs(ly) - (this.hy - r);
        const mx = qx > 0 ? qx : 0;
        const my = qy > 0 ? qy : 0;
        return Math.min(Math.max(qx, qy), 0) + Math.sqrt(mx * mx + my * my) - r;
      }
      default: {
        // torus about local Y
        const qx = Math.sqrt(lx * lx + lz * lz) - this.hx;
        return Math.sqrt(qx * qx + ly * ly) - this.hy;
      }
    }
  }
}

/** A bag of prims plus a builder API. Distances are metres. */
export class Shape {
  readonly prims: Prim[] = [];
  /** smallest feature radius the mesher can hold (set from the grid cell by the builders) */
  minRadius = 0;
  /** optional noise displacement of the final field (rocks): amplitude m, frequency 1/m */
  rough: { amp: number; scale: number; seed: number } | null = null;

  private push(p: Prim): Prim {
    p.finish();
    this.prims.push(p);
    return p;
  }

  /** round cone / capsule between a and b with radii ra, rb */
  rc(bone: number, a: Vec3, b: Vec3, ra: number, rb: number, opt: PrimOpt = {}): Prim {
    const r1 = Math.max(ra, this.minRadius);
    const r2 = Math.max(rb, this.minRadius);
    const p = new Prim(K_RC, bone, opt);
    const bax = b[0] - a[0];
    const bay = b[1] - a[1];
    const baz = b[2] - a[2];
    const l2 = bax * bax + bay * bay + baz * baz;
    const rr = r1 - r2;
    const a2 = l2 - rr * rr;
    p.ax = a[0];
    p.ay = a[1];
    p.az = a[2];
    p.bax = bax;
    p.bay = bay;
    p.baz = baz;
    p.r1 = r1;
    p.r2 = r2;
    if (l2 < 1e-10 || a2 < 1e-8) {
      // degenerate: one sphere swallows the other
      p.kind = K_SPH;
      const useA = r1 >= r2;
      p.ax = useA ? a[0] : b[0];
      p.ay = useA ? a[1] : b[1];
      p.az = useA ? a[2] : b[2];
      p.r1 = Math.max(r1, r2);
    } else {
      p.l2 = l2;
      p.rr = rr;
      p.a2 = a2;
      p.il2 = 1 / l2;
    }
    return this.push(p);
  }

  sph(bone: number, c: Vec3, r: number, opt: PrimOpt = {}): Prim {
    const p = new Prim(K_SPH, bone, opt);
    p.ax = c[0];
    p.ay = c[1];
    p.az = c[2];
    p.r1 = Math.max(r, this.minRadius);
    return this.push(p);
  }

  ell(bone: number, c: Vec3, r: Vec3, opt: PrimOpt = {}): Prim {
    const p = new Prim(K_ELL, bone, opt);
    p.ax = c[0];
    p.ay = c[1];
    p.az = c[2];
    p.hx = Math.max(r[0], this.minRadius);
    p.hy = Math.max(r[1], this.minRadius);
    p.hz = Math.max(r[2], this.minRadius);
    return this.push(p);
  }

  /** rounded box; `half` = outer half extents, `round` = corner radius */
  box(bone: number, c: Vec3, half: Vec3, round: number, opt: PrimOpt = {}): Prim {
    const p = new Prim(K_BOX, bone, opt);
    p.ax = c[0];
    p.ay = c[1];
    p.az = c[2];
    p.hx = half[0];
    p.hy = half[1];
    p.hz = half[2];
    p.rnd = Math.min(round, half[0], half[1], half[2]);
    return this.push(p);
  }

  /** capped cylinder about local Y: radius r, half height hh, edge rounding */
  cyl(bone: number, c: Vec3, r: number, hh: number, round: number, opt: PrimOpt = {}): Prim {
    const p = new Prim(K_CYL, bone, opt);
    p.ax = c[0];
    p.ay = c[1];
    p.az = c[2];
    p.hx = r;
    p.hy = hh;
    p.rnd = Math.min(round, r, hh);
    return this.push(p);
  }

  /** torus about local Y: major radius R, minor radius r */
  torus(bone: number, c: Vec3, R: number, r: number, opt: PrimOpt = {}): Prim {
    const p = new Prim(K_TORUS, bone, opt);
    p.ax = c[0];
    p.ay = c[1];
    p.az = c[2];
    p.hx = R;
    p.hy = Math.max(r, this.minRadius);
    return this.push(p);
  }

  /** world AABB of all geometry-producing prims */
  bounds(): { min: [number, number, number]; max: [number, number, number] } {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const p of this.prims) {
      if (p.op !== 'add') continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i] as number, p.bmin[i] as number);
        max[i] = Math.max(max[i] as number, p.bmax[i] as number);
      }
    }
    return { min, max };
  }

  /** full field value at a point (reference implementation, slow path) */
  eval(x: number, y: number, z: number): number {
    let d = 1e3;
    for (const p of this.prims) {
      if (p.op === 'paint') continue;
      const dp = p.dist(x, y, z);
      d = p.op === 'add' ? smin(d, dp, p.k) : smax(d, -dp, p.k);
    }
    return d;
  }
}

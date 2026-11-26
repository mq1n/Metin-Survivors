// DEV-only: small polygon-mesh toolkit (lofts, lathes, fans) for the hard-surface placeholders — weapons, pickups,
// chests, lanterns, crystals. Everything lands in one indexed BufferGeometry with position/normal/color(linear).
import { BufferAttribute, BufferGeometry, Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { noise3, type RGB, type Vec3 } from './math';
import { rgb } from './sdf';

export type ColorFn = (p: Vec3, n: Vec3, i: number, j: number) => RGB;
export type ColorSpec = string | RGB | ColorFn;

export interface Section {
  /** centre */
  c: Vec3;
  /** local x / y axes (world space); loft direction is ax × ay */
  ax: Vec3;
  ay: Vec3;
  /** closed polygon in (x,y), counter-clockwise seen along the loft direction */
  pts: readonly (readonly [number, number])[];
  color?: ColorSpec;
}

export interface LoftOptions {
  /** per-face normals (crisp bevels) instead of smooth ring normals */
  flat?: boolean;
  capStart?: boolean;
  capEnd?: boolean;
  color?: ColorSpec;
}

function resolve(spec: ColorSpec | undefined, fallback: ColorSpec): ColorFn {
  const s = spec ?? fallback;
  if (typeof s === 'function') return s;
  const c = rgb(s);
  return () => c;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** circle polygon (counter-clockwise) with `n` points */
export function circle(n: number, rx: number, ry = rx, phase = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    out.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return out;
}

export class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private vertex(p: Vec3, n: Vec3, c: RGB): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    return i;
  }

  /** single flat triangle (counter-clockwise = front) */
  tri(a: Vec3, b: Vec3, c: Vec3, color: ColorSpec): void {
    const n = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
    const f = resolve(color, '#808080');
    const i = this.vertex(a, n, f(a, n, 0, 0));
    const j = this.vertex(b, n, f(b, n, 0, 1));
    const k = this.vertex(c, n, f(c, n, 0, 2));
    this.idx.push(i, j, k);
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: ColorSpec): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** flat-shaded quad with an explicit colour per corner (counter-clockwise = front) */
  quadColors(a: Vec3, b: Vec3, c: Vec3, d: Vec3, ca: RGB, cb: RGB, cc: RGB, cd: RGB): void {
    const n = norm(cross([c[0] - a[0], c[1] - a[1], c[2] - a[2]], [d[0] - b[0], d[1] - b[1], d[2] - b[2]]));
    const i = this.vertex(a, n, ca);
    const j = this.vertex(b, n, cb);
    const k = this.vertex(c, n, cc);
    const l = this.vertex(d, n, cd);
    this.idx.push(i, j, k, i, k, l);
  }

  loft(sections: readonly Section[], o: LoftOptions = {}): void {
    const S = sections.length;
    if (S < 2) return;
    const first = sections[0] as Section;
    const n = first.pts.length;
    const pointAt = (s: Section, j: number): Vec3 => {
      const q = s.pts[j] as readonly [number, number];
      return [s.c[0] + s.ax[0] * q[0] + s.ay[0] * q[1], s.c[1] + s.ax[1] * q[0] + s.ay[1] * q[1], s.c[2] + s.ax[2] * q[0] + s.ay[2] * q[1]];
    };
    const colorOf = (s: Section): ColorFn => resolve(s.color, o.color ?? '#808080');
    const ring: Vec3[][] = sections.map((s) => Array.from({ length: n }, (_, j) => pointAt(s, j)));

    if (o.flat) {
      for (let i = 0; i < S - 1; i++) {
        for (let j = 0; j < n; j++) {
          const j2 = (j + 1) % n;
          const a = (ring[i] as Vec3[])[j] as Vec3;
          const b = (ring[i] as Vec3[])[j2] as Vec3;
          const c = (ring[i + 1] as Vec3[])[j2] as Vec3;
          const d = (ring[i + 1] as Vec3[])[j] as Vec3;
          const nn = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [d[0] - a[0], d[1] - a[1], d[2] - a[2]]));
          const f0 = colorOf(sections[i] as Section);
          const f1 = colorOf(sections[i + 1] as Section);
          const va = this.vertex(a, nn, f0(a, nn, i, j));
          const vb = this.vertex(b, nn, f0(b, nn, i, j2));
          const vc = this.vertex(c, nn, f1(c, nn, i + 1, j2));
          const vd = this.vertex(d, nn, f1(d, nn, i + 1, j));
          this.idx.push(va, vb, vc, va, vc, vd);
        }
      }
    } else {
      const base = this.vertexCount;
      const normals = new Float32Array(S * n * 3);
      for (let i = 0; i < S - 1; i++) {
        for (let j = 0; j < n; j++) {
          const j2 = (j + 1) % n;
          const a = (ring[i] as Vec3[])[j] as Vec3;
          const b = (ring[i] as Vec3[])[j2] as Vec3;
          const d = (ring[i + 1] as Vec3[])[j] as Vec3;
          const fn = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [d[0] - a[0], d[1] - a[1], d[2] - a[2]]);
          for (const [ii, jj] of [[i, j], [i, j2], [i + 1, j2], [i + 1, j]] as const) {
            const o3 = (ii * n + jj) * 3;
            normals[o3] = (normals[o3] as number) + fn[0];
            normals[o3 + 1] = (normals[o3 + 1] as number) + fn[1];
            normals[o3 + 2] = (normals[o3 + 2] as number) + fn[2];
          }
        }
      }
      for (let i = 0; i < S; i++) {
        const f = colorOf(sections[i] as Section);
        for (let j = 0; j < n; j++) {
          const o3 = (i * n + j) * 3;
          const nn = norm([normals[o3] as number, normals[o3 + 1] as number, normals[o3 + 2] as number]);
          const p = (ring[i] as Vec3[])[j] as Vec3;
          this.vertex(p, nn, f(p, nn, i, j));
        }
      }
      for (let i = 0; i < S - 1; i++) {
        for (let j = 0; j < n; j++) {
          const j2 = (j + 1) % n;
          const a = base + i * n + j;
          const b = base + i * n + j2;
          const c = base + (i + 1) * n + j2;
          const d = base + (i + 1) * n + j;
          this.idx.push(a, b, c, a, c, d);
        }
      }
    }

    const cap = (s: Section, ringPts: Vec3[], sign: 1 | -1): void => {
      const dir = norm(cross(s.ax, s.ay));
      const nn: Vec3 = [dir[0] * sign, dir[1] * sign, dir[2] * sign];
      const f = colorOf(s);
      const centre = this.vertex(s.c, nn, f(s.c, nn, 0, -1));
      const vs = ringPts.map((p, j) => this.vertex(p, nn, f(p, nn, 0, j)));
      for (let j = 0; j < n; j++) {
        const a = vs[j] as number;
        const b = vs[(j + 1) % n] as number;
        if (sign > 0) this.idx.push(centre, a, b);
        else this.idx.push(centre, b, a);
      }
    };
    if (o.capStart) cap(first, ring[0] as Vec3[], -1);
    if (o.capEnd) cap(sections[S - 1] as Section, ring[S - 1] as Vec3[], 1);
  }

  /** chamfered box (flat shaded); `half` = outer half extents */
  box(c: Vec3, half: Vec3, bevel: number, color: ColorSpec): void {
    const [hx, hy, hz] = half;
    const bv = Math.min(bevel, hx * 0.9, hy * 0.9, hz * 0.9);
    const poly = (x: number, y: number): [number, number][] => [
      [x - bv, -y],
      [x, -y + bv],
      [x, y - bv],
      [x - bv, y],
      [-x + bv, y],
      [-x, y - bv],
      [-x, -y + bv],
      [-x + bv, -y],
    ];
    const sec = (z: number, x: number, y: number): Section => ({ c: [c[0], c[1], c[2] + z], ax: [1, 0, 0], ay: [0, 1, 0], pts: poly(x, y), color });
    this.loft([sec(-hz, hx - bv, hy - bv), sec(-hz + bv, hx, hy), sec(hz - bv, hx, hy), sec(hz, hx - bv, hy - bv)], { flat: true, capStart: true, capEnd: true });
  }

  /** surface of revolution about +Y. `profile` = (radius, y) bottom→top. */
  lathe(profile: readonly (readonly [number, number])[], segs: number, o: LoftOptions & { origin?: Vec3; sx?: number; sz?: number } = {}): void {
    const origin = o.origin ?? [0, 0, 0];
    const sx = o.sx ?? 1;
    const sz = o.sz ?? 1;
    const sections: Section[] = profile.map(([r, y]) => ({
      c: [origin[0], origin[1] + y, origin[2]],
      ax: [1, 0, 0],
      ay: [0, 0, -1],
      pts: circle(segs, Math.max(r, 1e-4) * sx, Math.max(r, 1e-4) * sz),
    }));
    this.loft(sections, o);
  }

  /** copies another builder in (with a transform applied to its vertices) */
  append(other: MeshBuilder, m?: Matrix4): void {
    const base = this.vertexCount;
    const v = new Vector3();
    const n3 = m ? new Matrix3().getNormalMatrix(m) : null;
    for (let i = 0; i < other.vertexCount; i++) {
      v.set(other.pos[i * 3] as number, other.pos[i * 3 + 1] as number, other.pos[i * 3 + 2] as number);
      if (m) v.applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      v.set(other.nrm[i * 3] as number, other.nrm[i * 3 + 1] as number, other.nrm[i * 3 + 2] as number);
      if (n3) v.applyMatrix3(n3).normalize();
      this.nrm.push(v.x, v.y, v.z);
      this.col.push(other.col[i * 3] as number, other.col[i * 3 + 1] as number, other.col[i * 3 + 2] as number);
    }
    for (const i of other.idx) this.idx.push(base + i);
  }

  /** multiplies vertex colours by a gentle noise/AO-ish function (painterly variation) */
  speckle(amount: number, scale: number, seed = 1, from = 0): void {
    for (let i = from; i < this.vertexCount; i++) {
      const k = 1 + (noise3(this.pos[i * 3]! * scale, this.pos[i * 3 + 1]! * scale, this.pos[i * 3 + 2]! * scale, seed) - 0.5) * 2 * amount;
      for (let c = 0; c < 3; c++) this.col[i * 3 + c] = Math.min(1, (this.col[i * 3 + c] as number) * k);
    }
  }

  bounds(): { min: Vec3; max: Vec3 } {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.vertexCount; i++) {
      for (let k = 0; k < 3; k++) {
        const v = this.pos[i * 3 + k] as number;
        if (v < (min[k] as number)) min[k] = v;
        if (v > (max[k] as number)) max[k] = v;
      }
    }
    return { min, max };
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(new BufferAttribute(this.vertexCount < 65535 ? new Uint16Array(this.idx) : new Uint32Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** TRS matrix helper (euler XYZ) */
export function mat(pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]): Matrix4 {
  const q = new Quaternion().setFromEuler(new Euler(rot[0], rot[1], rot[2], 'XYZ'));
  return new Matrix4().compose(new Vector3(pos[0], pos[1], pos[2]), q, new Vector3(scale[0], scale[1], scale[2]));
}

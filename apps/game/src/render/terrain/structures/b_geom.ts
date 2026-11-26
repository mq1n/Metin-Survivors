// Procedural geometry toolkit for the set-B structures (props, walls, bridges). One MeshBuilder merges any number of
// primitives into a single BufferGeometry with vertex colours (painted variation + ground AO), a material slot and a
// cloth-sway weight per vertex (see b_mat.ts). Everything is a parametric grid surface (lathe, tube, blob, patch) with
// normals derived from the displaced grid, plus rounded/plain boxes, cards and paint strokes. Prop-local space:
// metres, Y up, +Z front.
import { BufferAttribute, BufferGeometry, Color, Matrix3, Matrix4, Vector3 } from 'three';

/** material slots of the structure shader (b_mat.ts) */
export const MAT = { plain: 0, wood: 1, bark: 2, stone: 3, cloth: 4, glow: 5 } as const;
export type MatSlot = (typeof MAT)[keyof typeof MAT];

export type ColorLike = string | number | Color;

export interface Style {
  color: Color;
  /** weathering / paint-over colour blended in by low-frequency noise */
  color2: Color;
  /** strength of the color2 blend (0 = off) */
  blend: number;
  /** low-frequency brightness mottling */
  mottle: number;
  mottleFreq: number;
  /** per-vertex brightness jitter (position hashed, so coincident vertices agree) */
  jitter: number;
  /** ground contact darkening (0 = off) and its height */
  ao: number;
  aoH: number;
  /** model-space y of the ground the AO refers to */
  groundY: number;
  mat: MatSlot;
  /** constant cloth sway weight (0 = rigid) */
  sway: number;
  /** sway weight from the local position (overrides `sway` / per-point weights): decals riding on cloth */
  swayFn: ((x: number, y: number, z: number) => number) | null;
  /** metres per texture tile */
  uvs: number;
}

export interface SurfPoint {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  /** brightness multiplier */
  m: number;
  /** extra colour2 blend */
  k: number;
  /** sway weight */
  sw: number;
  nx: number;
  ny: number;
  nz: number;
}

export interface SurfaceOpts {
  /** last column wraps onto the first (lathe, tube): normals are periodic */
  wrapU?: boolean;
  /** reverse the winding (and the derived normals) */
  flip?: boolean;
  /** use the normals written by fn instead of deriving them from the grid */
  analytic?: boolean;
}

export interface TubeOpts {
  radial?: number;
  /** end caps: flat disc, a pointed tip of the given length, or open */
  cap0?: 'flat' | 'open' | number;
  cap1?: 'flat' | 'open' | number;
  /** radial displacement, multiplier around 1: (t along, angle 0..1) */
  wobble?: (t: number, a: number) => number;
  /** brightness multiplier along the tube */
  shade?: (t: number, a: number) => number;
  /** sway weight along the tube */
  sway?: (t: number) => number;
  /** texture turns around the circumference override (default circumference / uvs) */
  uTurns?: number;
}

export interface LatheOpts {
  seg?: number;
  /** radius multiplier around 1 (angle 0..1, profile index) */
  rad?: (a: number, i: number) => number;
  /** crease angle (radians) that splits the profile into separately shaded sections */
  crease?: number;
  shade?: (a: number, i: number) => number;
  /** blend toward style.color2 (0..1), same arguments as shade */
  blend?: (a: number, i: number) => number;
  /** closes the bottom (y of the first point) and/or top with a flat disc */
  capBottom?: boolean;
  capTop?: boolean;
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();

export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** smooth value noise in [0,1] */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const h = (i: number, j: number, k: number): number => hash3(x0 + i, y0 + j, z0 + k, seed);
  const a = h(0, 0, 0) + (h(1, 0, 0) - h(0, 0, 0)) * sx;
  const b = h(0, 1, 0) + (h(1, 1, 0) - h(0, 1, 0)) * sx;
  const c = h(0, 0, 1) + (h(1, 0, 1) - h(0, 0, 1)) * sx;
  const d = h(0, 1, 1) + (h(1, 1, 1) - h(0, 1, 1)) * sx;
  const e = a + (b - a) * sy;
  const f = c + (d - c) * sy;
  return e + (f - e) * sz;
}

export function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const toColor = (c: ColorLike): Color => (c instanceof Color ? c.clone() : new Color(c));

const DEFAULT_STYLE = (): Style => ({
  color: new Color('#8a8a8a'),
  color2: new Color('#5a5a5a'),
  blend: 0,
  mottle: 0.1,
  mottleFreq: 1.6,
  jitter: 0.05,
  ao: 0.4,
  aoH: 0.5,
  groundY: 0,
  mat: MAT.plain,
  sway: 0,
  swayFn: null,
  uvs: 1,
});

export type StyleInit = Partial<Omit<Style, 'color' | 'color2'>> & { color?: ColorLike; color2?: ColorLike };

export class MeshBuilder {
  readonly rng: () => number;
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uvs: number[] = [];
  private readonly col: number[] = [];
  private readonly ms: number[] = [];
  private readonly idx: number[] = [];
  private mat = new Matrix4();
  private nmat = new Matrix3();
  private st: Style = DEFAULT_STYLE();
  private readonly stack: Array<{ m: Matrix4; s: Style }> = [];
  private readonly seed: number;
  private readonly cc = new Color();

  constructor(seed = 1) {
    this.seed = seed;
    this.rng = makeRng(seed);
  }

  get style(): Readonly<Style> {
    return this.st;
  }

  get triCount(): number {
    return this.idx.length / 3;
  }

  // ---- state ------------------------------------------------------------------------------------------------

  set(init: StyleInit): this {
    const { color, color2, ...rest } = init;
    if (color !== undefined) this.st.color = toColor(color);
    if (color2 !== undefined) this.st.color2 = toColor(color2);
    Object.assign(this.st, rest);
    return this;
  }

  push(): this {
    this.stack.push({ m: this.mat.clone(), s: { ...this.st, color: this.st.color.clone(), color2: this.st.color2.clone() } });
    return this;
  }

  pop(): this {
    const top = this.stack.pop();
    if (!top) throw new Error('MeshBuilder.pop without push');
    this.mat = top.m;
    this.st = top.s;
    this.nmat.getNormalMatrix(this.mat);
    return this;
  }

  /** runs fn inside push/pop */
  scope(fn: () => void): this {
    this.push();
    fn();
    return this.pop();
  }

  private apply(m: Matrix4): this {
    this.mat.multiply(m);
    this.nmat.getNormalMatrix(this.mat);
    return this;
  }

  t(x: number, y: number, z: number): this {
    return this.apply(new Matrix4().makeTranslation(x, y, z));
  }

  rx(a: number): this {
    return this.apply(new Matrix4().makeRotationX(a));
  }

  ry(a: number): this {
    return this.apply(new Matrix4().makeRotationY(a));
  }

  rz(a: number): this {
    return this.apply(new Matrix4().makeRotationZ(a));
  }

  s(x: number, y = x, z = x): this {
    return this.apply(new Matrix4().makeScale(x, y, z));
  }

  /** orients local +Y along (to - from) and moves the origin to `from` */
  align(from: Vector3, to: Vector3, roll = 0): this {
    const dir = tmpA.copy(to).sub(from).normalize();
    const side = Math.abs(dir.y) > 0.98 ? tmpB.set(1, 0, 0) : tmpB.set(0, 1, 0);
    const x = tmpC.crossVectors(side, dir).normalize();
    const z = new Vector3().crossVectors(x, dir);
    const m = new Matrix4().makeBasis(x, dir.clone(), z).setPosition(from);
    this.apply(m);
    return roll ? this.ry(roll) : this;
  }

  /** world (model) position of a local point under the current transform */
  world(x: number, y: number, z: number, out = new Vector3()): Vector3 {
    return out.set(x, y, z).applyMatrix4(this.mat);
  }

  // ---- low level --------------------------------------------------------------------------------------------

  /** emits one vertex (local pos/normal, transformed by the stack). */
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, m = 1, k = 0, sw = this.st.sway): number {
    const p = tmpA.set(x, y, z).applyMatrix4(this.mat);
    const n = tmpB.set(nx, ny, nz).applyMatrix3(this.nmat).normalize();
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    const c = this.paintAt(p.x, p.y, p.z, m, k);
    this.col.push(c.r, c.g, c.b);
    this.ms.push(this.st.mat, this.st.swayFn ? this.st.swayFn(x, y, z) : sw);
    return i;
  }

  private paintAt(x: number, y: number, z: number, m: number, k: number): Color {
    const s = this.st;
    const f = s.mottleFreq;
    const nz = noise3(x * f + 7.3, y * f + 1.9, z * f + 4.1, this.seed);
    let blend = k;
    if (s.blend > 0) blend += s.blend * smooth(0.38, 0.72, noise3(x * f * 1.7 + 3.1, y * f * 1.7, z * f * 1.7 + 9.7, this.seed + 5));
    const c = this.cc.copy(s.color);
    if (blend > 0) c.lerp(s.color2, Math.min(1, blend));
    let b = m * (1 + s.mottle * (nz - 0.5) * 2);
    if (s.jitter > 0) b *= 1 + s.jitter * (hash3(Math.round(x * 64), Math.round(y * 64), Math.round(z * 64), this.seed) - 0.5) * 2;
    if (s.ao > 0) b *= 1 - s.ao * (1 - smooth(0, s.aoH, y - s.groundY));
    c.multiplyScalar(b);
    return c;
  }

  tri(a: number, b: number, c: number): this {
    this.idx.push(a, b, c);
    return this;
  }

  quad(a: number, b: number, c: number, d: number): this {
    this.idx.push(a, b, c, a, c, d);
    return this;
  }

  // ---- parametric grid surface -------------------------------------------------------------------------------

  surface(nu: number, nv: number, fn: (u: number, v: number, p: SurfPoint) => void, o: SurfaceOpts = {}): this {
    const w = nu + 1;
    const h = nv + 1;
    const pts: SurfPoint[] = [];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const p: SurfPoint = { x: 0, y: 0, z: 0, u: i / nu, v: j / nv, m: 1, k: 0, sw: this.st.sway, nx: 0, ny: 1, nz: 0 };
        fn(i / nu, j / nv, p);
        pts.push(p);
      }
    }
    if (!o.analytic) this.gridNormals(pts, w, h, o.wrapU === true, o.flip === true);
    const base = this.pos.length / 3;
    for (const p of pts) this.vert(p.x, p.y, p.z, p.nx, p.ny, p.nz, p.u, p.v, p.m, p.k, p.sw);
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * w + i;
        const b = a + 1;
        const c = a + w;
        const d = c + 1;
        if (o.flip) this.idx.push(a, c, b, b, c, d);
        else this.idx.push(a, b, c, b, d, c);
      }
    }
    return this;
  }

  private gridNormals(pts: SurfPoint[], w: number, h: number, wrapU: boolean, flip: boolean): void {
    const at = (i: number, j: number): SurfPoint => pts[j * w + i] as SurfPoint;
    const ok = new Array<boolean>(w * h).fill(true);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let i0 = i - 1;
        let i1 = i + 1;
        if (wrapU) {
          if (i0 < 0) i0 = w - 2;
          if (i1 > w - 1) i1 = 1;
        } else {
          i0 = Math.max(0, i0);
          i1 = Math.min(w - 1, i1);
        }
        const j0 = Math.max(0, j - 1);
        const j1 = Math.min(h - 1, j + 1);
        const a = at(i0, j);
        const b = at(i1, j);
        const c = at(i, j0);
        const d = at(i, j1);
        tmpA.set(b.x - a.x, b.y - a.y, b.z - a.z);
        tmpB.set(d.x - c.x, d.y - c.y, d.z - c.z);
        const n = tmpC.crossVectors(tmpA, tmpB);
        const len = n.length();
        const p = at(i, j);
        if (len < 1e-10) {
          ok[j * w + i] = false;
          continue;
        }
        const s = (flip ? -1 : 1) / len;
        p.nx = n.x * s;
        p.ny = n.y * s;
        p.nz = n.z * s;
      }
    }
    // poles (degenerate rows): borrow the normal of the closest valid row
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (ok[j * w + i]) continue;
        const p = at(i, j);
        for (let dj = 1; dj < h; dj++) {
          const jj = j === 0 || (j < h - 1 && j < h / 2) ? j + dj : j - dj;
          if (jj < 0 || jj >= h || !ok[jj * w + i]) continue;
          const q = at(i, jj);
          p.nx = q.nx;
          p.ny = q.ny;
          p.nz = q.nz;
          break;
        }
      }
    }
  }

  // ---- shapes -------------------------------------------------------------------------------------------------

  /** Surface of revolution around local Y. `profile` = [radius, y] pairs, bottom to top. */
  lathe(profile: ReadonlyArray<readonly [number, number]>, o: LatheOpts = {}): this {
    const seg = o.seg ?? 12;
    const crease = o.crease ?? 0.9;
    // split into smooth sections at sharp profile corners
    const sections: Array<Array<[number, number, number]>> = [];
    let cur: Array<[number, number, number]> = [];
    const norm = (a: readonly [number, number], b: readonly [number, number]): [number, number] => {
      const dr = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    };
    for (let i = 0; i < profile.length; i++) {
      const pt = profile[i] as readonly [number, number];
      cur.push([pt[0], pt[1], i]);
      if (i > 0 && i < profile.length - 1) {
        const n0 = norm(profile[i - 1] as readonly [number, number], pt);
        const n1 = norm(pt, profile[i + 1] as readonly [number, number]);
        const ang = Math.acos(Math.max(-1, Math.min(1, n0[0] * n1[0] + n0[1] * n1[1])));
        if (ang > crease) {
          sections.push(cur);
          cur = [[pt[0], pt[1], i]];
        }
      }
    }
    if (cur.length > 1) sections.push(cur);
    for (const sec of sections) {
      let arc = 0;
      const arcs = [0];
      for (let i = 1; i < sec.length; i++) {
        const a = sec[i - 1] as [number, number, number];
        const b = sec[i] as [number, number, number];
        arc += Math.hypot(b[0] - a[0], b[1] - a[1]);
        arcs.push(arc);
      }
      const rmax = sec.reduce((m, p) => Math.max(m, p[0]), 0.001);
      const uvs = this.st.uvs;
      this.surface(
        seg,
        sec.length - 1,
        (u, v, p) => {
          const i = Math.round(v * (sec.length - 1));
          const [r0, y, pi] = sec[i] as [number, number, number];
          const r = r0 * (o.rad ? o.rad(u, pi) : 1);
          const th = u * Math.PI * 2;
          p.x = Math.cos(th) * r;
          p.y = y;
          p.z = Math.sin(th) * r;
          p.u = (u * Math.PI * 2 * rmax) / uvs;
          p.v = (arcs[i] ?? 0) / uvs;
          if (o.shade) p.m = o.shade(u, pi);
          if (o.blend) p.k = o.blend(u, pi);
        },
        { wrapU: true, flip: true },
      );
    }
    const last = profile[profile.length - 1] as readonly [number, number];
    const bot = profile[0] as readonly [number, number];
    if (o.capTop && last[0] > 0.001) this.disc(last[0], last[1], 1, seg, o.rad);
    if (o.capBottom && bot[0] > 0.001) this.disc(bot[0], bot[1], -1, seg, o.rad);
    return this;
  }

  /** flat disc at height y facing ±Y */
  disc(r: number, y: number, dir: 1 | -1, seg = 12, rad?: (a: number, i: number) => number): this {
    const c = this.vert(0, y, 0, 0, dir, 0, 0.5, 0.5);
    const ring: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = i / seg;
      const rr = r * (rad ? rad(a, 0) : 1);
      const th = a * Math.PI * 2;
      ring.push(this.vert(Math.cos(th) * rr, y, Math.sin(th) * rr, 0, dir, 0, 0.5 + (Math.cos(th) * rr) / this.st.uvs, 0.5 + (Math.sin(th) * rr) / this.st.uvs));
    }
    for (let i = 0; i < seg; i++) {
      if (dir > 0) this.tri(c, ring[i + 1] as number, ring[i] as number);
      else this.tri(c, ring[i] as number, ring[i + 1] as number);
    }
    return this;
  }

  /** Tapered swept tube along a polyline (logs, poles, horns, ropes, beams). `radius` is a number or a function of t. */
  tube(path: readonly Vector3[], radius: number | ((t: number) => number), o: TubeOpts = {}): this {
    const n = path.length;
    if (n < 2) return this;
    const radial = o.radial ?? 7;
    const rf = typeof radius === 'number' ? () => radius : radius;
    // arc-length parametrisation + tangents
    const arc: number[] = [0];
    for (let i = 1; i < n; i++) arc.push((arc[i - 1] as number) + (path[i] as Vector3).distanceTo(path[i - 1] as Vector3));
    const total = arc[n - 1] as number;
    const tans: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)] as Vector3;
      const b = path[Math.min(n - 1, i + 1)] as Vector3;
      tans.push(new Vector3().subVectors(b, a).normalize());
    }
    // parallel-transport frames
    const nn: Vector3[] = [];
    const bb: Vector3[] = [];
    const t0 = tans[0] as Vector3;
    let nrm = Math.abs(t0.y) > 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    nrm = nrm.sub(t0.clone().multiplyScalar(nrm.dot(t0))).normalize();
    for (let i = 0; i < n; i++) {
      const t = tans[i] as Vector3;
      nrm = nrm.clone().sub(t.clone().multiplyScalar(nrm.dot(t))).normalize();
      nn.push(nrm);
      bb.push(new Vector3().crossVectors(t, nrm));
    }
    const rmean = (rf(0) + rf(0.5) + rf(1)) / 3;
    const turns = o.uTurns ?? Math.max(1, (Math.PI * 2 * rmean) / this.st.uvs);
    const uvs = this.st.uvs;
    this.surface(
      radial,
      n - 1,
      (u, v, p) => {
        const i = Math.round(v * (n - 1));
        const t = total > 0 ? (arc[i] as number) / total : 0;
        const wob = o.wobble ? o.wobble(t, u) : 1;
        const r = rf(t) * wob;
        const th = u * Math.PI * 2;
        const c = Math.cos(th);
        const s = Math.sin(th);
        const P = path[i] as Vector3;
        const N = nn[i] as Vector3;
        const B = bb[i] as Vector3;
        p.x = P.x + (N.x * c + B.x * s) * r;
        p.y = P.y + (N.y * c + B.y * s) * r;
        p.z = P.z + (N.z * c + B.z * s) * r;
        p.u = u * turns;
        p.v = (arc[i] as number) / uvs;
        if (o.shade) p.m = o.shade(t, u);
        if (o.sway) p.sw = o.sway(t);
      },
      { wrapU: true },
    );
    const capOf = (end: 0 | 1, kind: 'flat' | 'open' | number | undefined): void => {
      if (kind === undefined || kind === 'open') return;
      const i = end === 0 ? 0 : n - 1;
      const t = end === 0 ? 0 : 1;
      const P = path[i] as Vector3;
      const T = tans[i] as Vector3;
      const N = nn[i] as Vector3;
      const B = bb[i] as Vector3;
      const dir = end === 0 ? -1 : 1;
      const tip = typeof kind === 'number' ? kind : 0;
      const r = rf(t);
      const ctr = this.vert(P.x + T.x * tip * dir, P.y + T.y * tip * dir, P.z + T.z * tip * dir, T.x * dir, T.y * dir, T.z * dir, 0.5, 0.5);
      const ring: number[] = [];
      for (let k = 0; k <= radial; k++) {
        const th = (k / radial) * Math.PI * 2;
        const c = Math.cos(th);
        const s = Math.sin(th);
        const px = P.x + (N.x * c + B.x * s) * r;
        const py = P.y + (N.y * c + B.y * s) * r;
        const pz = P.z + (N.z * c + B.z * s) * r;
        // pointed tips use cone-ish normals, flat caps the axis normal
        const nx = typeof kind === 'number' ? (N.x * c + B.x * s) * r + T.x * tip * dir * 0.6 : T.x * dir;
        const ny = typeof kind === 'number' ? (N.y * c + B.y * s) * r + T.y * tip * dir * 0.6 : T.y * dir;
        const nz = typeof kind === 'number' ? (N.z * c + B.z * s) * r + T.z * tip * dir * 0.6 : T.z * dir;
        ring.push(this.vert(px, py, pz, nx, ny, nz, 0.5 + (c * r) / uvs, 0.5 + (s * r) / uvs));
      }
      for (let k = 0; k < radial; k++) {
        if (dir < 0) this.tri(ctr, ring[k + 1] as number, ring[k] as number);
        else this.tri(ctr, ring[k] as number, ring[k + 1] as number);
      }
    };
    capOf(0, o.cap0);
    capOf(1, o.cap1);
    return this;
  }

  /** straight tapered log/pole between two points (convenience over tube) */
  pole(a: Vector3, b: Vector3, r0: number, r1: number, o: TubeOpts & { lenSeg?: number; bend?: number } = {}): this {
    const ls = o.lenSeg ?? Math.max(2, Math.round(a.distanceTo(b) / 0.9));
    const pts: Vector3[] = [];
    const bend = o.bend ?? 0;
    const side = new Vector3(b.z - a.z, 0, -(b.x - a.x)).normalize();
    for (let i = 0; i <= ls; i++) {
      const t = i / ls;
      const p = a.clone().lerp(b, t);
      if (bend) p.addScaledVector(side, Math.sin(t * Math.PI) * bend);
      pts.push(p);
    }
    return this.tube(pts, (t) => r0 + (r1 - r0) * t, { cap0: 'flat', cap1: 'flat', ...o });
  }

  /**
   * Box centred on the origin. bevel = 0 → plain 12-triangle box; with `soft` (0..1) its normals are blended towards the
   * corner directions so it shades like a rounded block. bevel > 0 → rounded box (true chamfer geometry, 108 triangles).
   * `grain` picks the texture's long axis.
   */
  box(w: number, h: number, d: number, o: { bevel?: number; grain?: 'x' | 'y' | 'z'; soft?: number } = {}): this {
    const hx = w / 2;
    const hy = h / 2;
    const hz = d / 2;
    const bev = Math.min(o.bevel ?? 0, hx * 0.95, hy * 0.95, hz * 0.95);
    const grain = o.grain ?? (h >= w && h >= d ? 'y' : w >= d ? 'x' : 'z');
    const uvs = this.st.uvs;
    // six faces: [axis normal, tangent a, tangent b]
    const faces: Array<[Vector3, Vector3, Vector3]> = [
      [new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)],
      [new Vector3(0, 0, -1), new Vector3(-1, 0, 0), new Vector3(0, 1, 0)],
      [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, 1, 0)],
      [new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
      [new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, -1)],
      [new Vector3(0, -1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1)],
    ];
    const half = new Vector3(hx, hy, hz);
    for (const [nrm, ta, tb] of faces) {
      // texture axes: v follows the grain axis when it lies in the face plane
      const axisOf = (t: Vector3): 'x' | 'y' | 'z' => (Math.abs(t.x) > 0.5 ? 'x' : Math.abs(t.y) > 0.5 ? 'y' : 'z');
      const aa = axisOf(ta);
      const ab = axisOf(tb);
      const vIsB = grain === ab ? true : grain === aa ? false : (ab === 'x' ? w : ab === 'y' ? h : d) >= (aa === 'x' ? w : aa === 'y' ? h : d);
      const ext = (ax: 'x' | 'y' | 'z'): number => (ax === 'x' ? w : ax === 'y' ? h : d);
      if (bev <= 0) {
        const c = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const;
        const soft = o.soft ?? 0;
        const ids = c.map(([sa, sb]) => {
          const px = nrm.x * hx + ta.x * sa * hx + tb.x * sb * hx;
          const py = nrm.y * hy + ta.y * sa * hy + tb.y * sb * hy;
          const pz = nrm.z * hz + ta.z * sa * hz + tb.z * sb * hz;
          const ua0 = ((sa + 1) / 2) * ext(aa) / uvs;
          const vb0 = ((sb + 1) / 2) * ext(ab) / uvs;
          let nx = nrm.x;
          let ny = nrm.y;
          let nz = nrm.z;
          if (soft > 0) {
            const cd = new Vector3(px / hx, py / hy, pz / hz).normalize();
            nx = nx * (1 - soft) + cd.x * soft;
            ny = ny * (1 - soft) + cd.y * soft;
            nz = nz * (1 - soft) + cd.z * soft;
          }
          return this.vert(px, py, pz, nx, ny, nz, vIsB ? ua0 : vb0, vIsB ? vb0 : ua0);
        });
        this.quad(ids[0] as number, ids[1] as number, ids[2] as number, ids[3] as number);
        continue;
      }
      const coordsA = [-1, -1 + (2 * bev) / ext(aa), 1 - (2 * bev) / ext(aa), 1];
      const coordsB = [-1, -1 + (2 * bev) / ext(ab), 1 - (2 * bev) / ext(ab), 1];
      const inner = half.clone().subScalar(bev);
      this.surface(
        3,
        3,
        (u, v, p) => {
          const sa = coordsA[Math.round(u * 3)] as number;
          const sb = coordsB[Math.round(v * 3)] as number;
          const q = new Vector3(
            nrm.x * hx + ta.x * sa * hx + tb.x * sb * hx,
            nrm.y * hy + ta.y * sa * hy + tb.y * sb * hy,
            nrm.z * hz + ta.z * sa * hz + tb.z * sb * hz,
          );
          const c = new Vector3(Math.max(-inner.x, Math.min(inner.x, q.x)), Math.max(-inner.y, Math.min(inner.y, q.y)), Math.max(-inner.z, Math.min(inner.z, q.z)));
          const dir = new Vector3().subVectors(q, c);
          if (dir.lengthSq() > 1e-12) dir.normalize();
          else dir.copy(nrm);
          p.x = c.x + dir.x * bev;
          p.y = c.y + dir.y * bev;
          p.z = c.z + dir.z * bev;
          p.nx = dir.x;
          p.ny = dir.y;
          p.nz = dir.z;
          const ua = ((sa + 1) / 2) * ext(aa) / uvs;
          const vb = ((sb + 1) / 2) * ext(ab) / uvs;
          p.u = vIsB ? ua : vb;
          p.v = vIsB ? vb : ua;
        },
        { analytic: true },
      );
    }
    return this;
  }

  /**
   * Extruded convex/star-shaped polygon (XY plane, CCW seen from +Z) centred on z = 0: pointed planks, arrow boards,
   * flaps. `grain` = texture direction (default along the longer bounding axis).
   */
  prism(poly: ReadonlyArray<readonly [number, number]>, depth: number, o: { grain?: 'x' | 'y' } = {}): this {
    const n = poly.length;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let cx = 0;
    let cy = 0;
    for (const [x, y] of poly) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      cx += x / n;
      cy += y / n;
    }
    const grain = o.grain ?? (maxX - minX >= maxY - minY ? 'x' : 'y');
    const uvs = this.st.uvs;
    const h = depth / 2;
    const uvOf = (x: number, y: number): [number, number] => (grain === 'x' ? [(y - minY) / uvs, (x - minX) / uvs] : [(x - minX) / uvs, (y - minY) / uvs]);
    for (const side of [1, -1] as const) {
      const c = this.vert(cx, cy, h * side, 0, 0, side, ...uvOf(cx, cy));
      const ring = poly.map(([x, y]) => this.vert(x, y, h * side, 0, 0, side, ...uvOf(x, y)));
      for (let i = 0; i < n; i++) {
        const a = ring[i] as number;
        const b = ring[(i + 1) % n] as number;
        if (side > 0) this.tri(c, a, b);
        else this.tri(c, b, a);
      }
    }
    for (let i = 0; i < n; i++) {
      const [ax, ay] = poly[i] as readonly [number, number];
      const [bx, by] = poly[(i + 1) % n] as readonly [number, number];
      const dx = bx - ax;
      const dy = by - ay;
      const l = Math.hypot(dx, dy) || 1;
      const nx = dy / l;
      const ny = -dx / l;
      const a = this.vert(ax, ay, h, nx, ny, 0, 0, 0);
      const b = this.vert(bx, by, h, nx, ny, 0, l / uvs, 0);
      const c = this.vert(bx, by, -h, nx, ny, 0, l / uvs, depth / uvs);
      const d = this.vert(ax, ay, -h, nx, ny, 0, 0, depth / uvs);
      this.quad(a, d, c, b);
    }
    return this;
  }
  /** Lumpy ellipsoid (rocks, skulls, stones, sacks). `lump` = radial noise amplitude. */
  blob(rx: number, ry: number, rz: number, o: { seg?: number; rings?: number; lump?: number; seedOffset?: number; cutBottom?: number } = {}): this {
    const seg = o.seg ?? 9;
    const rings = o.rings ?? 6;
    const lump = o.lump ?? 0.12;
    const sd = this.seed + (o.seedOffset ?? 0);
    const cut = o.cutBottom ?? 0;
    const uvs = this.st.uvs;
    this.surface(
      seg,
      rings,
      (u, v, p) => {
        const phi = cut + v * (Math.PI - cut);
        const th = u * Math.PI * 2;
        const sp = Math.sin(phi);
        const dx = Math.cos(th) * sp;
        const dy = -Math.cos(phi);
        const dz = Math.sin(th) * sp;
        const w = this.world(dx * rx, dy * ry, dz * rz, tmpC);
        const k = 1 + lump * (noise3(w.x * 2.3 + 11, w.y * 2.3, w.z * 2.3 + 5, sd) - 0.5) * 2;
        p.x = dx * rx * k;
        p.y = dy * ry * k;
        p.z = dz * rz * k;
        p.u = (u * Math.PI * 2 * Math.max(rx, rz)) / uvs;
        p.v = (v * Math.PI * ry) / uvs;
      },
      { wrapU: true, flip: true },
    );
    return this;
  }

  /** Cone/spike around local Y: base radius r at y=0 to a point at y=h; `lean` bends the tip sideways. */
  spike(r: number, h: number, seg = 6, o: { lean?: [number, number]; rad?: (a: number) => number } = {}): this {
    const lean = o.lean ?? [0, 0];
    const uvs = this.st.uvs;
    this.surface(
      seg,
      3,
      (u, v, p) => {
        const th = u * Math.PI * 2;
        const rr = v >= 1 ? 0 : r * Math.pow(1 - v, 0.8) * (o.rad ? o.rad(u) : 1);
        p.x = Math.cos(th) * rr + lean[0] * v * v * h;
        p.y = v * h;
        p.z = Math.sin(th) * rr + lean[1] * v * v * h;
        p.u = (u * Math.PI * 2 * r) / uvs;
        p.v = (v * h) / uvs;
      },
      { wrapU: true, flip: true },
    );
    return this;
  }

  /** Flat double-sided-capable card (straw blade, flap, tuft): quad from base to tip with taper. */
  blade(base: Vector3, tip: Vector3, wBase: number, wTip: number, o: { bend?: Vector3; mBase?: number; mTip?: number; swTip?: number } = {}): this {
    const dir = tmpA.copy(tip).sub(base);
    const side = new Vector3(dir.z, 0, -dir.x);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    const nrm = new Vector3().crossVectors(side, dir).normalize();
    const mid = base.clone().lerp(tip, 0.5);
    if (o.bend) mid.add(o.bend);
    const mb = o.mBase ?? 1;
    const mt = o.mTip ?? 1;
    const a = this.vert(base.x - side.x * wBase, base.y - side.y * wBase, base.z - side.z * wBase, nrm.x, nrm.y, nrm.z, 0, 0, mb);
    const b = this.vert(base.x + side.x * wBase, base.y + side.y * wBase, base.z + side.z * wBase, nrm.x, nrm.y, nrm.z, 1, 0, mb);
    const c = this.vert(mid.x + side.x * (wBase + wTip) * 0.5, mid.y, mid.z + side.z * (wBase + wTip) * 0.5, nrm.x, nrm.y, nrm.z, 1, 0.5, (mb + mt) / 2);
    const d = this.vert(mid.x - side.x * (wBase + wTip) * 0.5, mid.y, mid.z - side.z * (wBase + wTip) * 0.5, nrm.x, nrm.y, nrm.z, 0, 0.5, (mb + mt) / 2);
    const e = this.vert(tip.x - side.x * wTip, tip.y - side.y * wTip, tip.z - side.z * wTip, nrm.x, nrm.y, nrm.z, 0, 1, mt, 0, o.swTip ?? this.st.sway);
    const f = this.vert(tip.x + side.x * wTip, tip.y + side.y * wTip, tip.z + side.z * wTip, nrm.x, nrm.y, nrm.z, 1, 1, mt, 0, o.swTip ?? this.st.sway);
    this.quad(a, b, c, d);
    this.quad(d, c, f, e);
    return this;
  }

  /** Flat ribbon along a 3D polyline, lying on a surface (paint strokes, trim, stitching). */
  stroke(points: readonly Vector3[], normals: readonly Vector3[], width: number, o: { lift?: number; taper?: boolean; m?: number } = {}): this {
    const lift = o.lift ?? 0.012;
    const n = points.length;
    const rows: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const p = points[i] as Vector3;
      const nr = normals[i] as Vector3;
      const a = points[Math.max(0, i - 1)] as Vector3;
      const b = points[Math.min(n - 1, i + 1)] as Vector3;
      const tan = new Vector3().subVectors(b, a).normalize();
      const side = new Vector3().crossVectors(tan, nr).normalize();
      const tt = i / Math.max(1, n - 1);
      const wv = (o.taper ? Math.sin(tt * Math.PI) * 0.8 + 0.2 : 1) * width * 0.5;
      const lx = p.x + nr.x * lift;
      const ly = p.y + nr.y * lift;
      const lz = p.z + nr.z * lift;
      rows.push([
        this.vert(lx - side.x * wv, ly - side.y * wv, lz - side.z * wv, nr.x, nr.y, nr.z, 0, tt, o.m ?? 1),
        this.vert(lx + side.x * wv, ly + side.y * wv, lz + side.z * wv, nr.x, nr.y, nr.z, 1, tt, o.m ?? 1),
      ]);
    }
    for (let i = 0; i < n - 1; i++) {
      const [a, b] = rows[i] as [number, number];
      const [c, d] = rows[i + 1] as [number, number];
      this.quad(a, b, d, c);
    }
    return this;
  }


  // ---- output -------------------------------------------------------------------------------------------------

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aMs', new BufferAttribute(new Float32Array(this.ms), 2));
    const count = this.pos.length / 3;
    g.setIndex(new BufferAttribute(count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** points of a circular arc in the XY plane (horns, hoops): centre (cx,cy), radius, from a0 to a1 radians */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, n: number, z = 0): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(new Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z));
  }
  return out;
}

import { type Aabb, type Quat, type Vec3, aabbExpand, aabbUnion, qinv, qrotate } from '../math.ts';
import { Sdf, smax, smin } from './node.ts';

/** Distance from point to AABB (0 inside). Lower bound of the distance to any solid inside the box. */
function boxDist(x: number, y: number, z: number, b: Float64Array, o: number): number {
  const dx = Math.max(b[o]! - x, 0, x - b[o + 3]!);
  const dy = Math.max(b[o + 1]! - y, 0, y - b[o + 4]!);
  const dz = Math.max(b[o + 2]! - z, 0, z - b[o + 5]!);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ------------------------------------------------------------------ smooth union
export interface UnionChild {
  node: Sdf;
  /** blend width used when this child is folded into the accumulated shape (world metres) */
  w: number;
}

/**
 * N-ary smooth union (left fold of cubic smin). `children[i].w` is the blend width of child i into everything
 * before it. Pruning (`restrict`) is exact: a child is dropped only if its blend can never activate.
 */
export class SmoothUnion extends Sdf {
  private nodes: Sdf[];
  private ws: Float64Array;
  private boxes: Float64Array;
  private wmax: number;
  constructor(public children: UnionChild[]) {
    super();
    this.nodes = children.map((c) => c.node);
    this.ws = Float64Array.from(children.map((c) => c.w));
    this.boxes = new Float64Array(children.length * 6);
    this.wmax = 0;
    let lip = 0;
    children.forEach((c, i) => {
      const b = c.node.bounds();
      this.boxes.set([b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]], i * 6);
      this.wmax = Math.max(this.wmax, c.w);
      lip = Math.max(lip, c.node.lip);
    });
    this.lip = lip;
  }
  d(x: number, y: number, z: number): number {
    const nodes = this.nodes, ws = this.ws, boxes = this.boxes;
    const n = nodes.length;
    let acc = nodes[0]!.d(x, y, z);
    for (let i = 1; i < n; i++) {
      const w = ws[i]!;
      if (boxDist(x, y, z, boxes, i * 6) >= acc + w) continue;
      const b = nodes[i]!.d(x, y, z);
      const diff = acc > b ? acc - b : b - acc;
      const m = acc < b ? acc : b;
      if (diff >= w) acc = m;
      else {
        const h = (w - diff) / w;
        acc = m - (h * h * h * w) / 6;
      }
    }
    return acc;
  }
  protected computeBounds(): Aabb {
    let box = this.nodes[0]!.bounds();
    for (let i = 1; i < this.nodes.length; i++) box = aabbUnion(box, this.nodes[i]!.bounds());
    return box;
  }
  override restrict(cx: number, cy: number, cz: number, r: number): Sdf {
    const n = this.nodes.length;
    if (n === 1) return this.nodes[0]!.restrict(cx, cy, cz, r);
    const lb = new Float64Array(n);
    let mub = Infinity;
    for (let i = 0; i < n; i++) {
      const node = this.nodes[i]!;
      let d: number;
      // cheap path: box lower bound far beyond anything -> skip evaluating
      d = node.d(cx, cy, cz);
      const span = node.lip * r;
      lb[i] = d - span;
      if (d + span < mub) mub = d + span;
    }
    const thresh = mub + 1.2 * this.wmax;
    const kept: UnionChild[] = [];
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (lb[i]! >= thresh) {
        changed = true;
        continue;
      }
      const child = this.children[i]!;
      const rn = child.node.restrict(cx, cy, cz, r);
      if (rn !== child.node) changed = true;
      kept.push({ node: rn, w: child.w });
    }
    if (!changed) return this;
    if (kept.length === 1) return kept[0]!.node;
    return new SmoothUnion(kept);
  }
}

// ------------------------------------------------------------------ smooth subtract
/** a minus (b0 ∪ b1 ∪ ...) with smooth edge of width `w` (cutters folded in sequentially). */
export class SmoothSubtract extends Sdf {
  private cutters: Sdf[];
  private ws: Float64Array;
  constructor(
    public a: Sdf,
    public cuts: UnionChild[],
  ) {
    super();
    this.cutters = cuts.map((c) => c.node);
    this.ws = Float64Array.from(cuts.map((c) => c.w));
    this.lip = Math.max(a.lip, ...cuts.map((c) => c.node.lip));
  }
  d(x: number, y: number, z: number): number {
    let acc = this.a.d(x, y, z);
    const cuts = this.cutters, ws = this.ws;
    for (let i = 0; i < cuts.length; i++) {
      acc = smax(acc, -cuts[i]!.d(x, y, z), ws[i]!);
    }
    return acc;
  }
  protected computeBounds(): Aabb {
    return this.a.bounds();
  }
  override restrict(cx: number, cy: number, cz: number, r: number): Sdf {
    const ra = this.a.restrict(cx, cy, cz, r);
    const lbA = this.a.d(cx, cy, cz) - this.a.lip * r;
    const kept: UnionChild[] = [];
    let changed = ra !== this.a;
    for (const c of this.cuts) {
      const lbB = c.node.d(cx, cy, cz) - c.node.lip * r;
      if (lbA + lbB >= c.w) {
        changed = true;
        continue;
      }
      const rn = c.node.restrict(cx, cy, cz, r);
      if (rn !== c.node) changed = true;
      kept.push({ node: rn, w: c.w });
    }
    if (!changed) return this;
    if (kept.length === 0) return ra;
    return new SmoothSubtract(ra, kept);
  }
}

/** smooth intersection of two or more shapes */
export class SmoothIntersect extends Sdf {
  constructor(
    public parts: Sdf[],
    public w: number,
  ) {
    super();
    this.lip = Math.max(...parts.map((p) => p.lip));
  }
  d(x: number, y: number, z: number): number {
    let acc = this.parts[0]!.d(x, y, z);
    for (let i = 1; i < this.parts.length; i++) acc = smax(acc, this.parts[i]!.d(x, y, z), this.w);
    return acc;
  }
  protected computeBounds(): Aabb {
    // intersection of boxes
    let b = this.parts[0]!.bounds();
    for (let i = 1; i < this.parts.length; i++) {
      const o = this.parts[i]!.bounds();
      b = { min: [Math.max(b.min[0], o.min[0]), Math.max(b.min[1], o.min[1]), Math.max(b.min[2], o.min[2])], max: [Math.min(b.max[0], o.max[0]), Math.min(b.max[1], o.max[1]), Math.min(b.max[2], o.max[2])] };
    }
    return b;
  }
  override restrict(cx: number, cy: number, cz: number, r: number): Sdf {
    let changed = false;
    const parts = this.parts.map((p) => {
      const rp = p.restrict(cx, cy, cz, r);
      if (rp !== p) changed = true;
      return rp;
    });
    return changed ? new SmoothIntersect(parts, this.w) : this;
  }
}

// ------------------------------------------------------------------ transforms
/** Translate / rotate / scale (non-uniform allowed: distances become a lower bound, zero level set stays exact). */
export class Xform extends Sdf {
  private inv: Quat;
  private hasRot: boolean;
  private smin_: number;
  constructor(
    public child: Sdf,
    public pos: Vec3 = [0, 0, 0],
    public rot: Quat = [0, 0, 0, 1],
    public scale: Vec3 = [1, 1, 1],
  ) {
    super();
    this.inv = qinv(rot);
    this.hasRot = rot[3] < 0.99999999;
    this.smin_ = Math.min(scale[0], scale[1], scale[2]);
    this.lip = child.lip;
  }
  d(x: number, y: number, z: number): number {
    let px = x - this.pos[0], py = y - this.pos[1], pz = z - this.pos[2];
    if (this.hasRot) {
      const r = qrotate(this.inv, [px, py, pz]);
      px = r[0]; py = r[1]; pz = r[2];
    }
    return this.child.d(px / this.scale[0], py / this.scale[1], pz / this.scale[2]) * this.smin_;
  }
  protected computeBounds(): Aabb {
    const b = this.child.bounds();
    const xs = [b.min[0] * this.scale[0], b.max[0] * this.scale[0]];
    const ys = [b.min[1] * this.scale[1], b.max[1] * this.scale[1]];
    const zs = [b.min[2] * this.scale[2], b.max[2] * this.scale[2]];
    let mn: Vec3 = [Infinity, Infinity, Infinity];
    let mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const x of xs) for (const y of ys) for (const z of zs) {
      const p = qrotate(this.rot, [x, y, z]);
      for (let i = 0; i < 3; i++) {
        mn[i] = Math.min(mn[i]!, p[i]! + this.pos[i]!);
        mx[i] = Math.max(mx[i]!, p[i]! + this.pos[i]!);
      }
    }
    return { min: mn, max: mx };
  }
  override restrict(cx: number, cy: number, cz: number, r: number): Sdf {
    let px = cx - this.pos[0], py = cy - this.pos[1], pz = cz - this.pos[2];
    if (this.hasRot) {
      const q = qrotate(this.inv, [px, py, pz]);
      px = q[0]; py = q[1]; pz = q[2];
    }
    const rc = this.child.restrict(px / this.scale[0], py / this.scale[1], pz / this.scale[2], r / this.smin_);
    return rc === this.child ? this : new Xform(rc, this.pos, this.rot, this.scale);
  }
}

/** Fold space across X=0 so a one-sided shape becomes symmetric. */
export class MirrorX extends Sdf {
  constructor(public child: Sdf) {
    super();
    this.lip = child.lip;
  }
  d(x: number, y: number, z: number): number {
    return this.child.d(Math.abs(x), y, z);
  }
  protected computeBounds(): Aabb {
    const b = this.child.bounds();
    const m = Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]));
    return { min: [-m, b.min[1], b.min[2]], max: [m, b.max[1], b.max[2]] };
  }
  override restrict(cx: number, cy: number, cz: number, r: number): Sdf {
    const rc = this.child.restrict(Math.abs(cx), cy, cz, r);
    return rc === this.child ? this : new MirrorX(rc);
  }
}

// ------------------------------------------------------------------ distance-field modifiers
/** Inflate (+) or erode (-) the surface. */
export class Offset extends Sdf {
  constructor(
    public child: Sdf,
    public amount: number,
  ) {
    super();
    this.lip = child.lip;
  }
  d(x: number, y: number, z: number): number {
    return this.child.d(x, y, z) - this.amount;
  }
  protected computeBounds(): Aabb {
    return aabbExpand(this.child.bounds(), Math.max(this.amount, 0));
  }
  override restrict(cx: number, cy: number, cz: number, r: number): Sdf {
    const rc = this.child.restrict(cx, cy, cz, r);
    return rc === this.child ? this : new Offset(rc, this.amount);
  }
}

/** A scalar field in space with a known Lipschitz bound (used for displacement and masks). */
export interface Field {
  eval(x: number, y: number, z: number): number;
  /** bound on |∇field| */
  lip: number;
}

/**
 * d + amp * field(p). `amp` may be a mask-modulated field itself (use `maskedField`). Keep amp*field.lip small relative to 1
 * or the result stops being a usable distance bound (the mesher tolerates it, smooth-blends do not).
 */
export class Displace extends Sdf {
  constructor(
    public child: Sdf,
    public field: Field,
    public amp: number,
  ) {
    super();
    this.lip = child.lip + Math.abs(amp) * field.lip;
  }
  d(x: number, y: number, z: number): number {
    return this.child.d(x, y, z) + this.amp * this.field.eval(x, y, z);
  }
  protected computeBounds(): Aabb {
    return aabbExpand(this.child.bounds(), Math.abs(this.amp));
  }
  override restrict(cx: number, cy: number, cz: number, r: number): Sdf {
    const rc = this.child.restrict(cx, cy, cz, r);
    return rc === this.child ? this : new Displace(rc, this.field, this.amp);
  }
}

/**
 * General domain warp: p' = fn(p). `lipScale` bounds |∂p'/∂p| (>=1 for expansive warps).
 * `expand` grows the reported bounds to cover how far the warp may move the surface.
 */
export class Warp extends Sdf {
  private out = new Float64Array(3);
  constructor(
    public child: Sdf,
    public fn: (x: number, y: number, z: number, out: Float64Array) => void,
    public lipScale = 1,
    public expand = 0,
  ) {
    super();
    this.lip = child.lip * lipScale;
  }
  d(x: number, y: number, z: number): number {
    this.fn(x, y, z, this.out);
    return this.child.d(this.out[0]!, this.out[1]!, this.out[2]!);
  }
  protected computeBounds(): Aabb {
    return aabbExpand(this.child.bounds(), this.expand);
  }
  // no pruning through arbitrary warps (the child is evaluated in warped space)
}

// ------------------------------------------------------------------ factories
export const smoothUnion = (nodes: Sdf[], w: number): Sdf => (nodes.length === 1 ? nodes[0]! : new SmoothUnion(nodes.map((node) => ({ node, w }))));
export const smoothSubtract = (a: Sdf, cuts: Sdf[], w: number): Sdf => new SmoothSubtract(a, cuts.map((node) => ({ node, w })));
export const smoothIntersect = (parts: Sdf[], w: number): Sdf => new SmoothIntersect(parts, w);
export const translate = (s: Sdf, p: Vec3): Sdf => new Xform(s, p);
export const rotate = (s: Sdf, q: Quat, pivot: Vec3 = [0, 0, 0]): Sdf => {
  // rotate about pivot: translate to origin, rotate, translate back => Xform(child shifted)
  const inner = new Xform(s, [-pivot[0], -pivot[1], -pivot[2]]);
  return new Xform(inner, pivot, q);
};
export const scaleNonUniform = (s: Sdf, k: Vec3, about: Vec3 = [0, 0, 0]): Sdf => {
  const inner = new Xform(s, [-about[0], -about[1], -about[2]]);
  return new Xform(inner, about, [0, 0, 0, 1], k);
};
export const mirrorX = (s: Sdf): Sdf => new MirrorX(s);
export const offset = (s: Sdf, a: number): Sdf => new Offset(s, a);
export const displace = (s: Sdf, f: Field, amp: number): Sdf => new Displace(s, f, amp);

// Elliptical / super-elliptical loft along +Y: the torso, hips, coats, skirts, helmets, boots. Cross-section parameters
// (half-widths, centre offsets, squareness) are interpolated smoothly between stations; the ends are rounded.
import type { Aabb } from '../../../core/math.ts';
import { Sdf } from '../../../core/sdf/node.ts';

export interface Station {
  y: number;
  /** half-width along X */
  rx: number;
  /** half-depth along Z */
  rz: number;
  /** centre offsets */
  cx?: number;
  cz?: number;
  /** super-ellipse exponent: 2 = ellipse, 3-4 = soft box. Default 2. */
  n?: number;
}

interface Sample {
  rx: number;
  rz: number;
  cx: number;
  cz: number;
  n: number;
}

export interface LoftOpts {
  /** radius of the rounded end caps (metres); 0 = flat caps */
  cap?: number;
  /** clip the loft to [y0, y1] (default: the station range). Stations outside still shape the interpolation. */
  range?: [number, number];
}

const hermite = (p0: number, p1: number, m0: number, m1: number, u: number): number => {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
};

export class Loft extends Sdf {
  private st: Required<Station>[];
  private y0: number;
  private y1: number;
  private sy0: number;
  private sy1: number;
  private cap: number;
  private tan: { rx: number; rz: number; cx: number; cz: number; n: number }[];
  private rmax: number;
  constructor(stations: Station[], opts: LoftOpts = {}) {
    super();
    this.st = stations
      .map((s) => ({ y: s.y, rx: s.rx, rz: s.rz, cx: s.cx ?? 0, cz: s.cz ?? 0, n: s.n ?? 2 }))
      .sort((a, b) => a.y - b.y);
    this.sy0 = this.st[0]!.y;
    this.sy1 = this.st[this.st.length - 1]!.y;
    this.y0 = opts.range?.[0] ?? this.sy0;
    this.y1 = opts.range?.[1] ?? this.sy1;
    this.cap = opts.cap ?? 0;
    // monotone-ish finite-difference tangents (cardinal spline, c = 0.5)
    this.tan = this.st.map((_s, i) => {
      const a = this.st[Math.max(i - 1, 0)]!, b = this.st[Math.min(i + 1, this.st.length - 1)]!;
      const dy = b.y - a.y || 1;
      return { rx: (b.rx - a.rx) / dy, rz: (b.rz - a.rz) / dy, cx: (b.cx - a.cx) / dy, cz: (b.cz - a.cz) / dy, n: (b.n - a.n) / dy };
    });
    let rm = 0;
    let slope = 0;
    for (let i = 0; i < this.st.length; i++) {
      const s = this.st[i]!;
      rm = Math.max(rm, s.rx + Math.abs(s.cx), s.rz + Math.abs(s.cz));
      slope = Math.max(slope, Math.abs(this.tan[i]!.rx), Math.abs(this.tan[i]!.rz), Math.abs(this.tan[i]!.cx), Math.abs(this.tan[i]!.cz));
    }
    this.rmax = rm;
    this.lip = 1 + slope * 1.1;
  }

  private sample(y: number, o: Sample): void {
    const st = this.st;
    if (y <= this.sy0) { const s = st[0]!; o.rx = s.rx; o.rz = s.rz; o.cx = s.cx; o.cz = s.cz; o.n = s.n; return; }
    if (y >= this.sy1) { const s = st[st.length - 1]!; o.rx = s.rx; o.rz = s.rz; o.cx = s.cx; o.cz = s.cz; o.n = s.n; return; }
    let i = 0;
    while (i < st.length - 2 && y > st[i + 1]!.y) i++;
    const a = st[i]!, b = st[i + 1]!;
    const h = b.y - a.y;
    const u = (y - a.y) / h;
    const ta = this.tan[i]!, tb = this.tan[i + 1]!;
    o.rx = hermite(a.rx, b.rx, ta.rx * h, tb.rx * h, u);
    o.rz = hermite(a.rz, b.rz, ta.rz * h, tb.rz * h, u);
    o.cx = hermite(a.cx, b.cx, ta.cx * h, tb.cx * h, u);
    o.cz = hermite(a.cz, b.cz, ta.cz * h, tb.cz * h, u);
    o.n = a.n + (b.n - a.n) * u;
  }

  private tmp: Sample = { rx: 0, rz: 0, cx: 0, cz: 0, n: 2 };

  /** cross-section parameters at height y */
  at(y: number): { rx: number; rz: number; cx: number; cz: number; n: number } {
    const o: Sample = { rx: 0, rz: 0, cx: 0, cz: 0, n: 2 };
    this.sample(y, o);
    return o;
  }

  d(x: number, y: number, z: number): number {
    const s = this.tmp;
    this.sample(y, s);
    const rx = s.rx < 1e-4 ? 1e-4 : s.rx, rz = s.rz < 1e-4 ? 1e-4 : s.rz;
    const px = x - s.cx, pz = z - s.cz;
    const X = Math.abs(px) / rx, Z = Math.abs(pz) / rz;
    let d2: number;
    if (s.n === 2) {
      const q = Math.sqrt(X * X + Z * Z);
      // first-order distance of the ellipse (Taubin): f / |grad f|
      const gx = X / (rx * (q || 1)), gz = Z / (rz * (q || 1));
      const g = Math.sqrt(gx * gx + gz * gz);
      d2 = q < 1e-6 ? -Math.min(rx, rz) : (q - 1) / (g || 1);
    } else {
      const n = s.n;
      const xn = X ** n, zn = Z ** n;
      const q = (xn + zn) ** (1 / n);
      if (q < 1e-6) d2 = -Math.min(rx, rz);
      else {
        // grad q = (X^(n-1) / (rx q^(n-1)), Z^(n-1) / (rz q^(n-1)))
        const qn1 = q ** (n - 1);
        const gx = X ** (n - 1) / (rx * qn1), gz = Z ** (n - 1) / (rz * qn1);
        const g = Math.sqrt(gx * gx + gz * gz);
        d2 = (q - 1) / (g || 1);
      }
    }
    // end caps
    const c = this.cap;
    const ym = (this.y0 + this.y1) * 0.5, hy = (this.y1 - this.y0) * 0.5;
    const dy = Math.abs(y - ym) - hy;
    if (c <= 0) {
      const ox = d2 > 0 ? d2 : 0, oy = dy > 0 ? dy : 0;
      return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(d2, dy), 0);
    }
    // rounded caps: shrink both by c, then inflate
    const a = d2 + c, b = dy + c;
    const ox = a > 0 ? a : 0, oy = b > 0 ? b : 0;
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(a, b), 0) - c;
  }

  protected computeBounds(): Aabb {
    let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (const s of this.st) {
      mnx = Math.min(mnx, s.cx - s.rx); mxx = Math.max(mxx, s.cx + s.rx);
      mnz = Math.min(mnz, s.cz - s.rz); mxz = Math.max(mxz, s.cz + s.rz);
    }
    // spline overshoot margin
    const m = 0.01 + this.rmax * 0.04;
    return { min: [mnx - m, this.y0 - this.cap * 0 - 0.001, mnz - m], max: [mxx + m, this.y1 + 0.001, mxz + m] };
  }
}

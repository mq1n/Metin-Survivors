// Conjurer talisman strips: AUTHORED paper geometry (not SDF). A thin curved slip with a swallow-tail end is a few dozen triangles; the SDF
// pipeline (8 mm voxels, regularised decimation) would turn the same slip into a thick, ragged slab. The strips are appended to the SDF
// body mesh by `conjurer_build.ts`, skinned rigidly (or blended) to their bones, and painted by procedural layers keyed on the strip frame
// (glyph columns in strip space), so they never depend on SDF regions.
import { type Vec3, clamp01, smoothstep, vadd, vcross, vdot, vlen, vnorm, vscale, vsub } from '../../core/math.ts';
import { type PaintLayer, type PaintVertex, type Rgb, mixRgb, rgb } from '../../core/paint/painter.ts';
import { custom } from '../../core/paint/layers.ts';

/** extra triangles appended to the SDF mesh: world-rest positions, smooth normals, per-vertex bone influences (names, weights sum to 1) */
export interface Authored {
  /** group name for paint hooks (see buildCrowdAuthored) */
  name?: string;
  positions: number[];
  normals: number[];
  indices: number[];
  skin: { bone: string; w: number }[][];
}

export const newAuthored = (name?: string): Authored => ({ ...(name ? { name } : {}), positions: [], normals: [], indices: [], skin: [] });

export interface StripSpec {
  id: string;
  /** bone the strip follows (all vertices rigid on it) */
  bone: string;
  /** centre of the slip (world rest) */
  c: Vec3;
  /** orthonormal frame: horizontal tangent (across the width), long axis, outward normal (the front face) */
  t: Vec3;
  up: Vec3;
  n: Vec3;
  /** half width / half length (m) */
  hu: number;
  hv: number;
  /** cross curl 1/R (1/m): + bulges toward n */
  curl: number;
  /** outward kick of the lower end (m) */
  bow: number;
  /** twist about the long axis from top to bottom (rad) */
  twist: number;
  /** swallow-tail depth as a fraction of the full length */
  notch: number;
  /** glyph variant */
  seed: number;
}

const NU = 2;
const NV = 4;
const GAP = 0.0007;

/** the paper surface: u, v in [-1, 1] (v = +1 at the top), returns the mid-surface point */
export function stripPoint(s: StripSpec, u: number, v: number): Vec3 {
  const phi = s.twist * (0.5 - 0.5 * v);
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const x = u * s.hu;
  const curlOff = -0.5 * s.curl * x * x;
  const low = clamp01((0.15 - v) / 1.15);
  const off = curlOff + s.bow * low * low;
  const tx = vadd(vscale(s.t, cp), vscale(s.n, sp));
  const nx = vsub(vscale(s.n, cp), vscale(s.t, sp));
  return vadd(vadd(s.c, vscale(s.up, v * s.hv)), vadd(vscale(tx, x), vscale(nx, off)));
}

/** append the double-sided slip to `out` */
export function addStrip(out: Authored, s: StripSpec): void {
  const rows: { u: number; v: number }[][] = [];
  for (let j = 0; j <= NV; j++) {
    const row: { u: number; v: number }[] = [];
    for (let i = 0; i <= NU; i++) {
      const u = -1 + (2 * i) / NU;
      let v = 1 - (2 * j) / NV;
      // the swallow-tail: the last row is pulled up toward the middle
      if (j === NV) v = -1 + 2 * s.notch * (1 - Math.abs(u));
      row.push({ u, v });
    }
    rows.push(row);
  }
  const e = 1e-3;
  for (const side of [1, -1] as const) {
    const base = out.positions.length / 3;
    for (const row of rows) {
      for (const { u, v } of row) {
        const p = stripPoint(s, u, v);
        const du = vsub(stripPoint(s, Math.min(1, u + e), v), stripPoint(s, Math.max(-1, u - e), v));
        const dv = vsub(stripPoint(s, u, Math.min(1, v + e)), stripPoint(s, u, Math.max(-1, v - e)));
        let nrm = vnorm(vcross(du, dv));
        if (vdot(nrm, s.n) < 0) nrm = vscale(nrm, -1);
        const q = vadd(p, vscale(nrm, GAP * side));
        out.positions.push(q[0], q[1], q[2]);
        const nn = vscale(nrm, side);
        out.normals.push(nn[0], nn[1], nn[2]);
        out.skin.push([{ bone: s.bone, w: 1 }]);
      }
    }
    const W = NU + 1;
    for (let j = 0; j < NV; j++) {
      for (let i = 0; i < NU; i++) {
        const a = base + j * W + i, b = a + 1, c = a + W, d = c + 1;
        // front: counter-clockwise seen from +n; back: reversed
        if (side === 1) out.indices.push(a, c, b, b, c, d);
        else out.indices.push(a, b, c, b, d, c);
      }
    }
  }
}

// --------------------------------------------------------------------------------------------------------------------------------
// layout of the orbiting rings

export interface RingDef {
  bone: string;
  /** pivot height (m) */
  y: number;
  /** orbit radius (m) */
  R: number;
  count: number;
  /** angle of the first strip (rad, 0 = +Z, + toward +X) */
  phase: number;
  /** inward lean of the top (rad): the ring is a cone */
  lean: number;
  /** yaw of each slip against the orbit tangent (rad): louvres show their faces from every side */
  yaw: number;
  hu: number;
  hv: number;
  twist: number;
  bow: number;
  /** vertical offset of the strip centres from the pivot */
  dy?: number;
  /** tilt of the ring plane away from horizontal (rad) toward azimuth `az` (rad, 0 = +Z, + toward +X) */
  tilt?: number;
  az?: number;
}

/** unit axis of a (possibly tilted) ring */
export function ringAxis(r: { tilt?: number; az?: number }): Vec3 {
  const t = r.tilt ?? 0, az = r.az ?? 0;
  return [Math.sin(t) * Math.sin(az), Math.cos(t), Math.sin(t) * Math.cos(az)];
}

/** rotate `v` by the ring tilt (the rotation taking +Y to the ring axis, about the horizontal axis perpendicular to the tilt azimuth) */
function tiltVec(v: Vec3, r: { tilt?: number; az?: number }): Vec3 {
  const t = r.tilt ?? 0, az = r.az ?? 0;
  if (t === 0) return v;
  // axis h = (cos az, 0, -sin az): rotating +Y about h by t tilts it toward (sin az, 0, cos az)
  const h: Vec3 = [Math.cos(az), 0, -Math.sin(az)];
  const c = Math.cos(t), s = Math.sin(t);
  const hv = vcross(h, v);
  const hd = vdot(h, v);
  return [v[0] * c + hv[0] * s + h[0] * hd * (1 - c), v[1] * c + hv[1] * s + h[1] * hd * (1 - c), v[2] * c + hv[2] * s + h[2] * hd * (1 - c)];
}

export function ringStrips(rings: RingDef[], seed0 = 1): StripSpec[] {
  const out: StripSpec[] = [];
  let seed = seed0;
  for (const r of rings) {
    seed++;
    for (let i = 0; i < r.count; i++) {
      const phi = r.phase + (i / r.count) * Math.PI * 2;
      const rad: Vec3 = [Math.sin(phi), 0, Math.cos(phi)];
      const tan: Vec3 = [Math.cos(phi), 0, -Math.sin(phi)];
      const cy = Math.cos(r.yaw), sy = Math.sin(r.yaw);
      // louvre: rotate the slip about the ring axis by `yaw`
      const t0 = vadd(vscale(tan, cy), vscale(rad, -sy));
      const r0 = vadd(vscale(rad, cy), vscale(tan, sy));
      const ca = Math.cos(r.lean), sa = Math.sin(r.lean);
      const up: Vec3 = vadd(vscale([0, 1, 0], ca), vscale(r0, -sa));
      const n: Vec3 = vadd(vscale(r0, ca), vscale([0, 1, 0], sa));
      const c = tiltVec([rad[0] * r.R, r.dy ?? 0, rad[2] * r.R], r);
      out.push({
        id: `${r.bone}_${i}`, bone: r.bone,
        c: [c[0], r.y + c[1], c[2]],
        t: vnorm(tiltVec(t0, r)), up: vnorm(tiltVec(up, r)), n: vnorm(tiltVec(n, r)),
        hu: r.hu, hv: r.hv, curl: 1 / Math.max(r.R, 0.2), bow: r.bow, twist: r.twist, notch: 0.16, seed,
      });
    }
  }
  return out;
}

// --------------------------------------------------------------------------------------------------------------------------------
// paint: paper + hand-written glyph columns in strip space

const hash = (a: number, b: number, c = 0): number => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** distance from (x, y) to the segment a-b */
function seg(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-9;
  const t = clamp01(((x - ax) * dx + (y - ay) * dy) / l2);
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
}

/** ink coverage 0..1 of a pseudo-calligraphy column at strip coords (u, v in [-1,1]) */
export function glyphInk(u: number, v: number, seed: number): { ink: number; seal: number } {
  // border: a thin double rule
  const eu = 1 - Math.abs(u), ev = 1 - Math.abs(v);
  let ink = 0;
  const rule = (d: number, w: number, at: number): number => smoothstep(w, w * 0.4, Math.abs(d - at));
  if (ev > 0.04) ink = Math.max(ink, rule(eu, 0.022, 0.1) * smoothstep(0.02, 0.1, ev));
  ink = Math.max(ink, rule(ev, 0.016, 0.075) * smoothstep(0.0, 0.1, eu));
  // character cells stacked down the strip
  const cells = 4;
  const top = 0.74, cellH = 0.3;
  for (let k = 0; k < cells; k++) {
    const v1 = top - k * (cellH + 0.04), v0 = v1 - cellH;
    if (v > v1 + 0.08 || v < v0 - 0.08) continue;
    const cu = (u + 0.58) / 1.16, cv = (v - v0) / cellH; // 0..1 inside the cell
    const H = (i: number): number => hash(seed, k, i);
    let d = 9;
    // two horizontal bars
    for (let i = 0; i < 2; i++) {
      const y = 0.25 + 0.5 * i + (H(i) - 0.5) * 0.18;
      const x0 = 0.06 + H(i + 2) * 0.2, x1 = 0.72 + H(i + 4) * 0.24;
      d = Math.min(d, seg(cu, cv, x0, y, x1, y + (H(i + 6) - 0.5) * 0.12));
    }
    // a long vertical stroke and a hook
    const vx = 0.3 + H(8) * 0.4;
    d = Math.min(d, seg(cu, cv, vx, 0.04, vx + (H(9) - 0.5) * 0.12, 0.96));
    d = Math.min(d, seg(cu, cv, 0.18 + H(10) * 0.2, 0.9, 0.78 + H(11) * 0.14, 0.2 + H(12) * 0.3));
    if (H(13) > 0.45) d = Math.min(d, seg(cu, cv, 0.12, 0.12 + H(14) * 0.2, 0.55 + H(15) * 0.3, 0.06));
    const w = 0.075 + 0.03 * H(16);
    const s = smoothstep(w, w * 0.45, d) * smoothstep(-0.12, 0.02, cu) * smoothstep(1.12, 0.98, cu);
    ink = Math.max(ink, s);
  }
  // a seal block near the tail
  const su = Math.abs(u) / 0.34, sv = Math.abs(v + 0.62) / 0.13;
  const sealBox = smoothstep(1.05, 0.95, Math.max(su, sv));
  const mark = Math.max(smoothstep(0.1, 0.02, seg(u, v + 0.62, -0.18, -0.07, 0.18, 0.07)), smoothstep(0.1, 0.02, seg(u, v + 0.62, -0.18, 0.07, 0.18, -0.07)));
  return { ink: Math.max(ink, sealBox * (1 - mark * 0.85)), seal: sealBox };
}

export interface StripPaintOpts {
  paper: string;
  paperShade: string;
  ink: string;
  glow: string;
}

/** strip frame lookup shared by the albedo and emissive layers */
function locate(specs: StripSpec[], v: PaintVertex): { s: StripSpec; u: number; vv: number; front: boolean } | null {
  let best: { s: StripSpec; u: number; vv: number; front: boolean; d: number } | null = null;
  for (const s of specs) {
    const d = vsub(v.p, s.c);
    if (vlen(d) > Math.hypot(s.hu, s.hv) * 1.4 + 0.02) continue;
    const dn = vdot(d, s.n);
    if (Math.abs(dn) > 0.03) continue;
    const u = vdot(d, s.t) / s.hu, vv = vdot(d, s.up) / s.hv;
    if (Math.abs(u) > 1.25 || Math.abs(vv) > 1.25) continue;
    if (!best || Math.abs(dn) < best.d) best = { s, u, vv, front: vdot(v.n, s.n) >= 0, d: Math.abs(dn) };
  }
  return best;
}

export function stripPaint(specs: StripSpec[], o: StripPaintOpts): { albedo: PaintLayer; emissive: PaintLayer } {
  const paper = rgb(o.paper), shade = rgb(o.paperShade), ink = rgb(o.ink), glow = rgb(o.glow);
  const albedo = custom('talismanPaper', (v) => {
    const h = locate(specs, v);
    if (!h) return;
    const { s, u, vv, front } = h;
    const fib = v.noise.fbm(v.p[0] * 70, v.p[1] * 70, v.p[2] * 70, { octaves: 2 });
    let c = mixRgb(paper, shade, clamp01(0.18 + fib * 0.5 + 0.28 * smoothstep(0.6, 1.4, Math.abs(u)) + 0.18 * smoothstep(0.1, -1, vv)));
    const g = glyphInk(front ? u : -u, vv, s.seed);
    // the reverse shows the glyph faintly through the paper
    c = mixRgb(c, ink, g.ink * (front ? 0.96 : 0.4));
    v.color = c;
  });
  const emissive = custom('talismanGlow', (v) => {
    const h = locate(specs, v);
    if (!h) return;
    const g = glyphInk(h.front ? h.u : -h.u, h.vv, h.s.seed);
    const m = smoothstep(0.55, 0.9, g.ink) * (h.front ? 1 : 0.25);
    if (m > 0) v.color = [glow[0] * m, glow[1] * m, glow[2] * m];
  });
  return { albedo, emissive };
}

export type { Rgb };

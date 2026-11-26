// yeop_coin: upright cash coin (disc plane vertical, normal along Z, base on y = 0): ridge rim, a raised square boss round a
// bevelled square hole, original glyph marks (raised bars) and stud dots on both faces. Polar ring grid with matching angles so
// strips between the 24-gon rim and the 12-vertex boss rings stay conforming; budget <= 500 tris.
import { HardMesh } from '../../core/hard/hardmesh.ts';
import type { ModelData } from '../../core/model.ts';
import { Assembly } from './assembly.ts';
import { buildPickup } from './build.ts';
import { type V3, clamp, sstep, stud } from './geom.ts';
import { Grain, type Rgb, mixRgb, rgb } from './paintkit.ts';

const ZONE = { rim: 1, field: 2, boss: 3, hole: 4, glyph: 5, edge: 6, wall: 7 } as const;

export interface CoinParams {
  /** outer radius (m) */
  R: number;
  /** z of the rim crest / field / boss crest / hole edge (front face; mirrored for the back) */
  zRim: number;
  zField: number;
  zBoss: number;
  zHole: number;
  /** rim foot radius */
  rFoot: number;
  /** half sides of the square boss foot / crest and of the hole */
  bossFoot: number;
  bossCrest: number;
  holeHalf: number;
  /** glyph bar height / width */
  barH: number;
  barW: number;
}

export const coinParams: CoinParams = { R: 0.15, zRim: 0.0155, zField: 0.0082, zBoss: 0.0128, zHole: 0.006, rFoot: 0.133, bossFoot: 0.0615, bossCrest: 0.05, holeHalf: 0.0375, barH: 0.0036, barW: 0.0082 };

interface RingPt {
  /** polar angle (rad) */
  a: number;
  p: V3;
}

/** coin-plane point: x right, y up from the coin centre, z towards the viewer */
function pt(cy: number, r: number, a: number, z: number): V3 {
  return [Math.cos(a) * r, cy + Math.sin(a) * r, z];
}

/** circle ring of n vertices starting at angle a0 */
function circleRing(cy: number, r: number, n: number, z: number, a0: number): RingPt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (i / n) * Math.PI * 2;
    return { a, p: pt(cy, r, a, z) };
  });
}

/** square ring (half side h) sampled at the same angles as a circle ring */
function squareRing(cy: number, h: number, n: number, z: number, a0: number): RingPt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (i / n) * Math.PI * 2;
    const rho = h / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    return { a, p: pt(cy, rho, a, z) };
  });
}

/**
 * Zipper triangulation between an outer and an inner ring (both counter-clockwise, same start angle). `sign` +1 faces +Z,
 * -1 faces -Z. Rings may have different vertex counts; angles decide the pairing.
 */
function zipper(m: HardMesh, outer: RingPt[], inner: RingPt[], sign: 1 | -1): void {
  const no = outer.length, ni = inner.length;
  let io = 0, ii = 0;
  const TWO_PI = Math.PI * 2;
  const angOf = (r: RingPt[], i: number, n: number): number => r[i % n]!.a + (i >= n ? TWO_PI : 0);
  const emit = (a: V3, b: V3, c: V3): void => {
    if (sign > 0) m.tri(a, b, c);
    else m.tri(a, c, b);
  };
  while (io < no || ii < ni) {
    const nextO = io < no ? angOf(outer, io + 1, no) : Infinity;
    const nextI = ii < ni ? angOf(inner, ii + 1, ni) : Infinity;
    const o0 = outer[io % no]!.p, o1 = outer[(io + 1) % no]!.p;
    const i0 = inner[ii % ni]!.p, i1 = inner[(ii + 1) % ni]!.p;
    if (nextO <= nextI + 1e-9 && io < no) {
      emit(o0, o1, i0);
      io++;
    } else {
      emit(i0, o0, i1);
      ii++;
    }
  }
}

/** raised bar (hip-roof ridge) lying on the field: centre (x, y), direction angle, length, base width, height */
function ridgeBar(cx: number, cy: number, ang: number, len: number, wid: number, hgt: number, z: number, sign: 1 | -1): HardMesh {
  const m = new HardMesh();
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const P = (u: number, v: number, h: number): V3 => [cx + ca * u - sa * v, cy + sa * u + ca * v, sign * (z + h)];
  const hl = len / 2, hw = wid / 2;
  const e = Math.min(hl * 0.5, wid * 0.55);
  const b0 = P(-hl, -hw, 0), b1 = P(hl, -hw, 0), b2 = P(hl, hw, 0), b3 = P(-hl, hw, 0);
  const c0 = P(-hl + e, 0, hgt), c1 = P(hl - e, 0, hgt);
  const emit = (a: V3, b: V3, c: V3): void => {
    if (sign > 0) m.tri(a, b, c);
    else m.tri(a, c, b);
  };
  emit(b0, b1, c1); emit(b0, c1, c0); // lower long side (facing -v)
  emit(b1, b2, c1); // +u end
  emit(b2, b3, c0); emit(b2, c0, c1); // upper long side
  emit(b3, b0, c0); // -u end
  return m;
}

/** glyph = list of bars in a local square (u, v in [-1,1]) placed at a polar position with a size */
interface Stroke { u: number; v: number; ang: number; len: number }
const HALF_PI = Math.PI / 2;
const GLYPH_FRONT: Stroke[][] = [
  // top: three stacked bars, the middle one short
  [{ u: 0, v: 0.78, ang: 0, len: 1.9 }, { u: 0, v: 0, ang: 0, len: 1.3 }, { u: 0, v: -0.78, ang: 0, len: 1.9 }],
  // right: a vertical stem with a hook bar
  [{ u: -0.35, v: 0, ang: HALF_PI, len: 1.9 }, { u: 0.45, v: 0.5, ang: 0, len: 1.1 }],
  // bottom: cross
  [{ u: 0, v: 0, ang: 0, len: 1.9 }, { u: 0, v: 0, ang: HALF_PI, len: 1.9 }],
  // left: two stems joined by a short bar at the foot
  [{ u: -0.55, v: 0, ang: HALF_PI, len: 1.9 }, { u: 0.55, v: 0, ang: HALF_PI, len: 1.9 }],
];
const GLYPH_BACK: Stroke[][] = [
  [{ u: -0.75, v: 0, ang: HALF_PI, len: 1.9 }, { u: 0, v: 0, ang: HALF_PI, len: 1.9 }, { u: 0.75, v: 0, ang: HALF_PI, len: 1.9 }],
  [{ u: 0, v: 0.55, ang: 0, len: 1.7 }, { u: 0.5, v: -0.35, ang: HALF_PI, len: 1.1 }],
  [{ u: 0, v: 0, ang: Math.PI / 4, len: 2.1 }, { u: 0, v: 0, ang: -Math.PI / 4, len: 2.1 }],
  [{ u: 0, v: 0.5, ang: 0, len: 1.9 }, { u: 0, v: -0.5, ang: 0, len: 1.9 }],
];

export function coinMesh(p: CoinParams): { mesh: HardMesh; cy: number } {
  const asm = new Assembly();
  const cy = p.R; // coin centre height: the rim touches y = 0
  const A0 = 0; // rings start at 0 deg: the 8-vertex square rings hit the corners (45 deg) and side midpoints
  const N = 32, M = 8;
  const rim = new HardMesh(), field = new HardMesh(), boss = new HardMesh(), hole = new HardMesh(), edge = new HardMesh(), wall = new HardMesh(), glyph = new HardMesh();
  for (const sign of [1, -1] as const) {
    const crest = circleRing(cy, p.R, N, sign * p.zRim, A0);
    const foot = circleRing(cy, p.rFoot, N, sign * p.zField, A0);
    const bossFoot = squareRing(cy, p.bossFoot, M, sign * p.zField, A0);
    const bossCrest = squareRing(cy, p.bossCrest, M, sign * p.zBoss, A0);
    const holeEdge = squareRing(cy, p.holeHalf, M, sign * p.zHole, A0);
    zipper(rim, crest, foot, sign);
    zipper(field, foot, bossFoot, sign);
    zipper(boss, bossFoot, bossCrest, sign);
    zipper(hole, bossCrest, holeEdge, sign);
    // glyph marks on the field between the boss and the rim
    const set = sign > 0 ? GLYPH_FRONT : GLYPH_BACK;
    const rMid = (p.bossFoot + p.rFoot) / 2 + 0.001;
    const gs = 0.02; // glyph half-size
    for (let g = 0; g < 4; g++) {
      const ang = HALF_PI - g * HALF_PI; // top, right, bottom, left (viewed from the face)
      const a = sign > 0 ? ang : Math.PI - ang; // keep reading order when seen from behind
      const gx = Math.cos(a) * rMid, gy = cy + Math.sin(a) * rMid;
      for (const s of set[g]!) {
        // the local glyph frame is upright in the view of the face
        const ux = s.u * gs, uy = s.v * gs;
        ridgeBar(gx + (sign > 0 ? ux : -ux), gy + uy, sign > 0 ? s.ang : Math.PI - s.ang, s.len * gs, p.barW, p.barH, p.zField, sign).appendTo(glyph);
      }
      // stud between glyphs (diagonal)
      const da = ang + Math.PI / 4;
      stud([Math.cos(da) * 0.101, cy + Math.sin(da) * 0.101, sign * p.zField], [0, 0, sign], 0.0046, 0.0042, 4, 0, Math.PI / 4).appendTo(glyph);
    }
  }
  // edge band and hole wall (front ring i -> back ring i)
  const f = circleRing(cy, p.R, N, p.zRim, A0), b = circleRing(cy, p.R, N, -p.zRim, A0);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    edge.quad(f[i]!.p, b[i]!.p, b[j]!.p, f[j]!.p);
  }
  const hf = squareRing(cy, p.holeHalf, M, p.zHole, A0), hb = squareRing(cy, p.holeHalf, M, -p.zHole, A0);
  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M;
    wall.quad(hf[j]!.p, hb[j]!.p, hb[i]!.p, hf[i]!.p);
  }
  asm.add(rim, ZONE.rim);
  asm.add(field, ZONE.field);
  asm.add(boss, ZONE.boss);
  asm.add(hole, ZONE.hole);
  asm.add(edge, ZONE.edge);
  asm.add(wall, ZONE.wall);
  asm.add(glyph, ZONE.glyph);
  return { mesh: asm.mesh, cy };
}

export function buildCoin(log: (s: string) => void): ModelData {
  const p = coinParams;
  const { mesh, cy } = coinMesh(p);
  const grain = new Grain('yeop_coin');
  const light = rgb('#f2bd2c'), mid = rgb('#dc9a14'), deep = rgb('#9a5e0a'), shadow = rgb('#4a2a08'), hot = rgb('#f9d24e');
  return buildPickup(
    {
      id: 'yeop_coin',
      mesh,
      crease: 42,
      ao: { rays: 32, maxDist: 0.03, minElev: 0.25 },
      refine: { maxEdge: () => 10, minEdge: 1, tol: 10, passes: 0, budget: 0 },
      paint: (c, out) => {
        const dx = c.x, dy = c.y - cy;
        const r = Math.hypot(dx, dy);
        const sq = Math.max(Math.abs(dx), Math.abs(dy)); // square radius (boss / hole)
        const wear = grain.fbm(c.x * 38, dy * 38, c.z * 38, 3); // -1..1
        const speck = grain.at(c.x * 140 + 3, dy * 140, c.z * 140);
        let base: Rgb;
        switch (c.zone) {
          case ZONE.rim: {
            const u = sstep(p.rFoot, p.R, r);
            base = mixRgb(deep, light, 0.3 + 0.7 * u);
            break;
          }
          case ZONE.field:
            base = mixRgb(deep, mid, 0.45 + 0.4 * sstep(-0.6, 0.6, wear));
            break;
          case ZONE.boss: {
            const u = sstep(p.bossFoot, p.bossCrest, sq);
            base = mixRgb(mid, light, 0.2 + 0.8 * u);
            break;
          }
          case ZONE.hole: {
            const u = sstep(p.bossCrest, p.holeHalf, sq);
            base = mixRgb(light, deep, u * 0.85);
            break;
          }
          case ZONE.glyph: {
            const hgt = (Math.abs(c.z) - p.zField) / p.barH;
            base = mixRgb(mid, hot, clamp(hgt, 0, 1));
            break;
          }
          case ZONE.edge:
            base = mixRgb(deep, mid, 0.45 + 0.3 * wear);
            break;
          default:
            base = shadow; // hole wall
        }
        // worn gold: polished patches vs dull tarnish, plus tiny bright scratches
        const k = 1 + 0.14 * wear + 0.06 * speck;
        out[0] = Math.min(1, base[0] * k);
        out[1] = Math.min(1, base[1] * (k - 0.02 * Math.max(0, -wear)));
        out[2] = Math.min(1, base[2] * (k - 0.06 * Math.max(0, -wear)));
        if (speck > 0.62 && c.zone !== ZONE.wall) {
          out[0] = Math.min(1, out[0] * 1.12 + 0.03); out[1] = Math.min(1, out[1] * 1.1 + 0.02); out[2] = Math.min(1, out[2] * 1.08 + 0.01);
        }
      },
      grade: { floor: 0.5, gamma: 1.1, tint: [1, 0.9, 0.8] },
    },
    log,
  );
}

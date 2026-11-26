// Fire parts for the PropsElem2 braziers / altars: sculpted flame tongues (twisted lobed sections that taper to a licking point),
// coal heaps (lumpy dome + loose faceted coals) and palette-driven glow materials (orange fire, sickly plague green).
// Flame uv carries data, not tile coords: uv = (k / sides, t) with t = 0 at the root and 1 at the tip.
import type { Vec3 } from '../../../../core/math.ts';
import { clamp01, m4mul, m4translation, smoothstep } from '../../../../core/math.ts';
import { Rng } from '../../../../core/rng.ts';
import type { Mat, PropMesh, Texel } from '../../mesh.ts';
import { fbm01, mixc, mulc } from '../../mats.ts';
import type { Rgb } from '../../texlib.ts';
import { TAG_GROUND, addFaces, hull, rockPlanes, rotYm, xfPlanes, type Plane } from '../PropsElem/hull.ts';
import { memo1, ramp, type Stop } from '../PropsElem/paint.ts';

export interface FirePal {
  /** emission ramp over heat 0..1 */
  heat: Stop[];
  /** flame body albedo from root (0) to tip (1) */
  body: Stop[];
  /** charred / soot colour of cold coal */
  coal: Rgb;
}

export const FIRE: FirePal = {
  heat: [
    [0, [0, 0, 0]],
    [0.12, [0.12, 0.012, 0.003]],
    [0.35, [0.55, 0.07, 0.01]],
    [0.6, [1.0, 0.24, 0.03]],
    [0.82, [1.0, 0.5, 0.09]],
    [1, [1.0, 0.82, 0.36]],
  ],
  body: [
    [0, [1.0, 0.86, 0.5]],
    [0.3, [1.0, 0.6, 0.14]],
    [0.65, [0.92, 0.26, 0.04]],
    [1, [0.45, 0.06, 0.012]],
  ],
  coal: [0.03, 0.022, 0.02],
};

export const PLAGUE: FirePal = {
  heat: [
    [0, [0, 0, 0]],
    [0.12, [0.01, 0.06, 0.012]],
    [0.35, [0.05, 0.3, 0.04]],
    [0.6, [0.2, 0.75, 0.08]],
    [0.82, [0.35, 0.95, 0.15]],
    [1, [0.62, 1.0, 0.38]],
  ],
  body: [
    [0, [0.62, 1.0, 0.38]],
    [0.3, [0.48, 0.95, 0.2]],
    [0.65, [0.16, 0.62, 0.1]],
    [1, [0.03, 0.2, 0.08]],
  ],
  coal: [0.025, 0.03, 0.025],
};

export const heatOf = (pal: FirePal, h: number): Rgb => ramp(pal.heat, clamp01(h));

// ---------------------------------------------------------------------------------------------------------------------------------
// flame tongues

export interface Tongue {
  /** root centre (buried a little in the coals) */
  base: Vec3;
  h: number;
  /** half width at the belly */
  r: number;
  /** tip offset (m) in x / z */
  lean?: [number, number];
  /** sideways S-sway amplitude (fraction of r) and its phase */
  sway?: number;
  phase?: number;
  /** total twist of the lobes root -> tip (rad) */
  twist?: number;
  /** lobes of the section (2 = blade, 3-5 = star) */
  lobes?: number;
  /** depth of the grooves between lobes (0 = round, 0.6 = deep star) */
  groove?: number;
  rings?: number;
  /** cross-section squash (1 = round) along the local z after `yaw` */
  flat?: number;
  yaw?: number;
}

/** a licking flame tongue: lobed section, swelling belly, twisted ridges, curling point */
export function flameTongue(m: PropMesh, mat: number, s: Tongue): void {
  const lobes = s.lobes ?? 3;
  const n = lobes * 2;
  const R = s.rings ?? 8;
  const tw = s.twist ?? 1.8;
  const ph = s.phase ?? 0;
  const g = s.groove ?? 0.42;
  const flat = s.flat ?? 1;
  const cy = Math.cos(s.yaw ?? 0), sy = Math.sin(s.yaw ?? 0);
  const rings: Vec3[][] = [];
  for (let i = 0; i <= R; i++) {
    const t = i / R;
    const sw = (s.sway ?? 0.35) * s.r * Math.sin(t * Math.PI * 1.6 + ph) * t;
    const lx = (s.lean?.[0] ?? 0) * t ** 1.6, lz = (s.lean?.[1] ?? 0) * t ** 1.6;
    const c: Vec3 = [s.base[0] + lx + sw * cy, s.base[1] + s.h * t, s.base[2] + lz - sw * sy];
    const rad = s.r * Math.pow(1 - t, 0.9) * (0.72 + 0.48 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 1.25)));
    const inner = 1 - g * (0.7 + 0.3 * t);
    const ring: Vec3[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + tw * t + ph;
      const rr = rad * (k % 2 === 0 ? 1 : inner);
      const x = Math.cos(a) * rr, z = -Math.sin(a) * rr * flat;
      ring.push([c[0] + x * cy + z * sy, c[1], c[2] - x * sy + z * cy]);
    }
    rings.push(ring);
  }
  for (let i = 0; i < R; i++) {
    const A = rings[i]!, B = rings[i + 1]!;
    const t0 = i / R, t1 = (i + 1) / R;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const u0 = k / n, u1 = (k + 1) / n;
      m.quad(A[k]!, A[k1]!, B[k1]!, B[k]!, [u0, t0], [u1, t0], [u1, t1], [u0, t1], mat);
    }
  }
}

/** flame body: hot pale root, saturated belly, dark licking tips, streaks running up the lobes */
export function flameMat(name: string, pal: FirePal, o: { gain?: number } = {}): Mat {
  const gain = o.gain ?? 1;
  const f = memo1((t: Texel) => {
    const v = clamp01(t.uv[1]);
    const streak = t.noise.noise(t.uv[0] * 9 + t.p[0] * 2, v * 3.2 - t.p[1] * 1.5, t.p[2] * 2);
    const hot = clamp01(1 - v * 0.95 + 0.16 * streak + 0.1 * (t.edge - 0.3));
    return { v, hot };
  });
  return {
    name,
    ao: 0,
    shade(t) {
      const { v, hot } = f(t);
      return mulc(ramp(pal.body, clamp01(1 - hot + 0.05)), 0.85 + 0.15 * (1 - v));
    },
    emit(t) {
      const { hot } = f(t);
      return mulc(heatOf(pal, 0.22 + 0.68 * hot), gain);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// coals

export interface CoalOpts {
  /** cells per metre of the crust network */
  scale?: number;
  /** base heat of the bed (0..1) */
  base?: number;
  /** extra heat on top (by height above `y0`) */
  y0?: number;
  y1?: number;
  gain?: number;
}

/**
 * glowing coals: the bed is split into Voronoi chunks; the gaps between chunks glow, a minority of chunks are red-hot right through,
 * the rest are charred with grey ash on their crowns. Hotter toward the top of the heap (`y0`..`y1`) and in its deep crevices.
 */
export function coalMat(name: string, pal: FirePal, o: CoalOpts = {}): Mat {
  const sc = o.scale ?? 9;
  const gain = o.gain ?? 1;
  const g = memo1((t: Texel) => {
    const p = t.p;
    const wx = 0.35 * t.noise.noise(p[0] * sc * 0.8, p[1] * sc * 0.8, p[2] * sc * 0.8);
    const wz = 0.35 * t.noise.noise(p[0] * sc * 0.8 + 7.1, p[1] * sc * 0.8, p[2] * sc * 0.8 - 3.3);
    const v = t.noise.voronoi(p[0] * sc + wx, p[1] * sc * 1.2, p[2] * sc + wz, 0.95);
    const edge = v.f2 - v.f1;
    const lift = o.y0 !== undefined && o.y1 !== undefined ? smoothstep(o.y0, o.y1, p[1]) : 0.5;
    const gap = 1 - smoothstep(0.03, 0.11, edge);
    const hot = smoothstep(0.62, 0.92, v.id) * (0.45 + 0.55 * lift);
    const crown = smoothstep(0.08, 0.45, edge);
    const hole = 1 - t.ao;
    const heat = clamp01(gap * (0.36 + 0.28 * lift) * (0.7 + 0.3 * fbm01(t, 7, 2, 2.2)) + hot * (0.4 + 0.18 * (1 - crown)) + (o.base ?? 0.3) * 0.35 * (1 - crown) + hole * 0.25 * lift);
    return { heat, crown, id: v.id };
  });
  return {
    name,
    ao: 0.35,
    shade(t) {
      const { heat, crown, id } = g(t);
      // charred chunk, rounded by darkening toward its rim, grey ash on the crowns of the cool ones
      let c = mulc(pal.coal, (0.6 + 0.9 * id) * (0.55 + 0.6 * crown) * (0.8 + 0.4 * fbm01(t, 30, 2, 1.1)));
      c = mixc(c, [0.32, 0.3, 0.29], smoothstep(0.35, 0.8, crown) * smoothstep(0.3, 0.05, heat) * 0.55 * fbm01(t, 9, 2, 5.1));
      return mixc(c, mulc(ramp(pal.body, 0.45), 0.55), smoothstep(0.3, 0.85, heat));
    },
    emit(t) {
      const { heat } = g(t);
      return heat < 0.02 ? null : mulc(heatOf(pal, heat), gain);
    },
  };
}

export interface HeapSpec {
  cx: number;
  cz: number;
  /** bed level (rim of the heap) */
  y0: number;
  /** dome rise */
  h: number;
  r: number;
  segs?: number;
  /** loose coal lumps scattered over the dome */
  lumps?: number;
  lumpR?: number;
  seed?: string;
}

/** lumpy coal dome plus loose faceted coals sitting on it */
export function coalHeap(m: PropMesh, mat: number, s: HeapSpec): void {
  const rng = new Rng(s.seed ?? 'coals');
  const seg = s.segs ?? 14;
  const prof: [number, number][] = [[1, -0.02], [0.92, 0.32], [0.7, 0.66], [0.38, 0.9], [0, 1]];
  const bumps = Array.from({ length: seg }, () => 0.86 + 0.28 * rng.next());
  const rings: Vec3[][] = prof.map(([fr, fy], i) =>
    Array.from({ length: seg }, (_, k) => {
      const th = (k / seg) * Math.PI * 2;
      const b = i === 0 ? 1 : i === 1 ? Math.min(1, bumps[(k + i * 3) % seg]!) : bumps[(k + i * 3) % seg]!;
      const y = s.y0 + s.h * fy * (i === 0 ? 1 : 0.9 + 0.2 * bumps[(k * 5 + i) % seg]!);
      return [s.cx + Math.cos(th) * s.r * fr * b, y, s.cz - Math.sin(th) * s.r * fr * b] as Vec3;
    }),
  );
  const top: Vec3 = [s.cx, s.y0 + s.h, s.cz];
  const uvOf = (p: Vec3): [number, number] => [p[0] - s.cx, p[2] - s.cz];
  for (let i = 0; i + 1 < rings.length; i++) {
    const A = rings[i]!, B = rings[i + 1]!;
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      m.quad(A[k]!, A[k1]!, B[k1]!, B[k]!, uvOf(A[k]!), uvOf(A[k1]!), uvOf(B[k1]!), uvOf(B[k]!), mat);
    }
  }
  const L = rings[rings.length - 1]!;
  for (let k = 0; k < seg; k++) m.tri(L[k]!, L[(k + 1) % seg]!, top, uvOf(L[k]!), uvOf(L[(k + 1) % seg]!), uvOf(top), mat);
  const nl = s.lumps ?? 0;
  const lr = s.lumpR ?? s.r * 0.16;
  for (let i = 0; i < nl; i++) {
    const a = rng.next() * Math.PI * 2;
    const fr = 0.15 + 0.55 * Math.sqrt(rng.next());
    const k = 1 - fr * fr;
    const at: Vec3 = [s.cx + Math.cos(a) * s.r * fr, s.y0 + s.h * k * 0.85, s.cz - Math.sin(a) * s.r * fr];
    const r = lr * (0.6 + 0.6 * rng.next());
    const lp = rockPlanes(rng.fork(`lump${i}`), { r: [r, r * 0.62, r * 0.85], n: 8, jitter: 0.45, cut: [0.78, 1] });
    const planes: Plane[] = xfPlanes(lp, m4mul(m4translation(at), rotYm(rng.next() * 6.28)));
    addFaces(m, hull(planes, 4), { mat, skip: [TAG_GROUND] });
  }
}

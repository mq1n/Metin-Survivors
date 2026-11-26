// Cooling-lava crust: black basalt plates whose rims where they split are scorched and glow, over a molten (emissive) core.
// Shared by the volcanic props (lava_rock, obsidian_spire foot, ...).
import type { Rng } from '../../../../core/rng.ts';
import type { Vec3 } from '../../../../core/math.ts';
import { clamp01, smoothstep } from '../../../../core/math.ts';
import { fbm01, mixc, mulc, rgb } from '../../mats.ts';
import type { Mat, Texel } from '../../mesh.ts';
import { TAG_GROUND, hull, hullEdge, type Plane } from './hull.ts';
import { sandPainter } from './mats.ts';
import { cracks, facetHash, glowMat, veins } from './paint.ts';

const crustPaint = sandPainter({
  tex: ['tex_basalt'],
  k: 1.1,
  ramp: [[0, rgb('#151211')], [0.5, rgb('#3a3431')], [1, rgb('#847a70')]],
  keep: 0,
  bump: 0.85,
  strata: 0.3,
  soot: 0,
  uvMetres: false,
});

/** heat of a crust plate: its rim where it borders a gap, plus hairline veins of residual heat */
const crustHeat = (t: Texel): { heat: number; char: number } => {
  const e = hullEdge(t.uv);
  const seam = e.seam ? 1 - smoothstep(0.0, 0.032, e.d) : 0;
  const flick = 0.75 + 0.25 * fbm01(t, 9, 2, 3.3);
  const vn = veins(t, 3.4, 0.004, 7, 0.4);
  return { heat: clamp01(seam * (0.4 + 0.3 * flick) + vn * 0.26), char: clamp01(e.seam ? 1 - smoothstep(0.0, 0.1, e.d) : 0) };
};

/** black basalt plate with sharpened, lightened free edges and glowing seam rims */
export function crustMat(name = 'crust'): Mat {
  return glowMat(
    name,
    (t) => {
      const e = hullEdge(t.uv);
      const c = mulc(crustPaint(t), 0.85 + 0.35 * facetHash(t));
      return e.seam ? c : mixc(c, rgb('#9a9086'), (1 - smoothstep(0, 0.026, e.d)) * 0.2 * (0.4 + 0.6 * t.nf[1]));
    },
    crustHeat,
    { spill: 0.2, scorch: [0.12, 0.03, 0.015] },
  );
}

/** the molten core / gap walls: charred base with a crack network of hot lava */
export function moltenMat(name = 'molten'): Mat {
  return glowMat(
    name,
    (t) => mulc(rgb('#1d0a06'), 0.7 + 0.6 * fbm01(t, 16, 3, 1.7)),
    (t) => {
      const c = cracks(t, { scale: 7, width: 0.012, halo: 0.04, warp: 0.5, keep: 0.8, seed: 2 });
      return { heat: Math.min(0.78, 0.32 + 0.2 * fbm01(t, 6, 2, 4.2) + 0.3 * c.core), char: 0 };
    },
    { ao: 0.05 },
  );
}

const faceArea = (poly: readonly Vec3[]): number => {
  let a = 0;
  const o = poly[0]!;
  for (let i = 1; i + 1 < poly.length; i++) {
    const u = poly[i]!, v = poly[i + 1]!;
    a += 0.5 * Math.hypot(
      (u[1] - o[1]) * (v[2] - o[2]) - (u[2] - o[2]) * (v[1] - o[1]),
      (u[2] - o[2]) * (v[0] - o[0]) - (u[0] - o[0]) * (v[2] - o[2]),
      (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]),
    );
  }
  return a;
};

export interface SkinSeedOpts {
  /** how far under the skin (m) each seed sits: shallow = radial, narrow slots */
  depth?: number;
  /** seeds lower than this (m) are rejected */
  minY?: number;
  /** minimum spacing (m) */
  spacing?: number;
}

/** Voronoi seeds scattered over the visible skin of `outer` (area weighted) and pushed inward, so cell bisectors run radially */
export function skinSeeds(outer: readonly Plane[], rng: Rng, count: number, o: SkinSeedOpts = {}): Vec3[] {
  const depth = o.depth ?? 0.32, minY = o.minY ?? 0.12, spacing = o.spacing ?? 0.5;
  const skin = hull(outer, 10).filter((f) => f.tag !== TAG_GROUND);
  const areas = skin.map((f) => faceArea(f.poly));
  const total = areas.reduce((a, b) => a + b, 0);
  const seeds: Vec3[] = [];
  let guard = 0;
  while (seeds.length < count && guard++ < 900) {
    let pick = rng.next() * total, fi = 0;
    while (fi < skin.length - 1 && pick > areas[fi]!) { pick -= areas[fi]!; fi++; }
    const f = skin[fi]!;
    const a = f.poly[0]!, b = f.poly[1 + Math.floor(rng.next() * (f.poly.length - 2))]!, c = f.poly[2 + Math.floor(rng.next() * (f.poly.length - 2)) % (f.poly.length - 1)]!;
    let u = rng.next(), v = rng.next();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const p: Vec3 = [
      a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v - f.n[0] * depth,
      a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v - f.n[1] * depth,
      a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v - f.n[2] * depth,
    ];
    if (p[1] < minY) continue;
    if (seeds.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < spacing)) continue;
    seeds.push(p);
  }
  return seeds;
}

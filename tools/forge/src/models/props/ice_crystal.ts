// prop_ice_crystal — 2 m cluster of glacial ice crystals for the snowfield: a tall hexagonal crystal with a chiselled point surrounded by
// seven smaller crystals leaning out of a frost-split granite boulder, two of them broken and re-grown at a kink. Every facet is painted
// as a slab of deep glacier ice: dark blue depth in the middle of the facet, milky bright rims, internal fracture planes, frost and
// snow at the root, paler and more translucent toward the points; a faint cold-blue glow from inside (emissive).
import { Rng } from '../../core/rng.ts';
import type { Mat4, Vec3 } from '../../core/math.ts';
import { clamp01, m4mul, m4translation, smoothstep } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import type { Mat, Texel } from '../../archetypes/prop/mesh.ts';
import { fbm01, mixc, mulc, rgb } from '../../archetypes/prop/mats.ts';
import type { Rgb } from '../../archetypes/prop/texlib.ts';
import { TAG_GROUND, addFaces, crystalPlanes, groundPlane, hull, hullEdge, rockPlanes, rotX, rotYm, rotZ, xfPlanes, type Face, type Plane } from '../../archetypes/prop/ext/PropsElem/hull.ts';
import { rockMat } from '../../archetypes/prop/ext/PropsElem/mats.ts';
import { cracks, facetHash, memo1, noiseBump } from '../../archetypes/prop/ext/PropsElem/paint.ts';

const ICE = 0, ROCK = 1;
const HEIGHT = 2.0;

interface Shard {
  at: Vec3;
  h: number;
  r: number;
  lean: number;
  sides: number;
  tip: number;
  narrow: number;
  tipLen: number;
  kink?: { t: number; rx: number; rz: number; shift: [number, number] };
}

const SHARDS: Shard[] = [
  { at: [0.0, 0, 0.0], h: 2.0, r: 0.34, lean: 0.05, sides: 6, tip: 3, narrow: 0.62, tipLen: 0.5 },
  { at: [0.42, 0, 0.16], h: 1.45, r: 0.26, lean: 0.26, sides: 6, tip: 3, narrow: 0.66, tipLen: 0.4, kink: { t: 0.55, rx: -0.1, rz: 0.14, shift: [-0.03, 0.04] } },
  { at: [-0.38, 0, 0.26], h: 1.25, r: 0.24, lean: 0.3, sides: 6, tip: 2, narrow: 0.6, tipLen: 0.36 },
  { at: [0.08, 0, -0.42], h: 1.55, r: 0.27, lean: 0.22, sides: 6, tip: 3, narrow: 0.64, tipLen: 0.42, kink: { t: 0.5, rx: 0.12, rz: -0.08, shift: [0.04, -0.02] } },
  { at: [-0.36, 0, -0.28], h: 0.95, r: 0.2, lean: 0.42, sides: 6, tip: 3, narrow: 0.6, tipLen: 0.3 },
  { at: [0.52, 0, -0.26], h: 0.82, r: 0.18, lean: 0.5, sides: 5, tip: 2, narrow: 0.6, tipLen: 0.26 },
  { at: [0.16, 0, 0.5], h: 0.66, r: 0.15, lean: 0.6, sides: 6, tip: 3, narrow: 0.55, tipLen: 0.22 },
  { at: [-0.58, 0, 0.02], h: 0.56, r: 0.14, lean: 0.7, sides: 5, tip: 2, narrow: 0.55, tipLen: 0.2 },
];

const shardXf = (s: Shard, spin: number): Mat4 => {
  const away = Math.atan2(s.at[2], s.at[0]);
  return m4mul(m4translation(s.at), m4mul(rotYm(-away), m4mul(rotZ(-s.lean), rotYm(spin))));
};
const kinkXf = (y0: number, k: NonNullable<Shard['kink']>): Mat4 => m4mul(m4translation([k.shift[0], y0, k.shift[1]]), m4mul(m4mul(rotX(k.rx), rotZ(k.rz)), m4translation([0, -y0, 0])));

// ---------------------------------------------------------------------------------------------------------------------------------
// glacier ice

const DEEP = rgb('#0f3b72'), MID = rgb('#2f7fc0'), PALE = rgb('#9fdcf4'), MILK = rgb('#e6f7ff'), SKY = rgb('#cfe9ff'), FROST = rgb('#f2f8fc');

const iceLook = memo1((t: Texel) => {
  const e = hullEdge(t.uv);
  const f1 = facetHash(t, 1), f2 = facetHash(t, 2);
  // depth: thick dark ice in the middle of a facet, milky at its rims
  const rim = 1 - smoothstep(0.0, 0.05 + 0.04 * f1, e.d);
  const depth = smoothstep(0.03, 0.25, e.d);
  // internal fracture planes (straight Voronoi bisectors) seen through the ice
  const frac = cracks(t, { scale: 2.4, width: 0.004, halo: 0.02, warp: 0.05, keep: 0.45, seed: 21 }).core + 0.6 * cracks(t, { scale: 6, width: 0.0025, halo: 0.01, warp: 0.05, keep: 0.35, seed: 22 }).core;
  const up = clamp01(t.hy / HEIGHT);
  return { e, f1, f2, rim, depth, frac: clamp01(frac), up };
});

function iceShade(t: Texel): Rgb {
  const L = iceLook(t);
  let c = mixc(PALE, mixc(MID, DEEP, L.depth * (0.55 + 0.45 * L.f1)), 0.35 + 0.65 * L.depth);
  // a third of the facets catch the sky as mirrors
  c = mixc(c, SKY, smoothstep(0.7, 0.95, L.f2) * (0.35 + 0.4 * clamp01(t.nf[1] * 0.5 + 0.5)));
  // paler, more translucent toward the points
  c = mixc(c, PALE, smoothstep(0.35, 1.0, L.up) * 0.35);
  c = mixc(c, MILK, L.rim * (0.55 + 0.35 * L.f1));
  c = mixc(c, MILK, L.frac * 0.32 * (0.4 + 0.6 * L.depth));
  // inner streaks along the crystal axis
  c = mulc(c, 0.9 + 0.2 * t.noise.noise(t.p[0] * 9, t.p[1] * 1.5, t.p[2] * 9));
  c = mulc(c, noiseBump(t, 14, 0.12, 2, 6));
  // hoar frost and snow at the root and on the upward facets
  const frost = (1 - smoothstep(0.0, 0.45, t.hy)) * smoothstep(0.35, 0.7, fbm01(t, 9, 3, 2.2) + 0.25);
  c = mixc(c, FROST, clamp01(frost * 0.85));
  const snow = smoothstep(0.55, 0.85, t.nf[1]) * smoothstep(0.45, 0.65, fbm01(t, 6, 3, 8.8) + 0.2);
  return mixc(c, FROST, snow * 0.8);
}

const iceMat: Mat = {
  name: 'ice',
  ao: 0.55,
  shade: iceShade,
  emit(t) {
    const L = iceLook(t);
    // cold light from inside: strongest in the thick lower ice and along the internal fractures, faint on the rims
    const g = (0.12 + 0.22 * (1 - L.up)) * L.depth + L.frac * 0.3 + L.rim * 0.06;
    const frost = 1 - smoothstep(0.0, 0.35, t.hy);
    const k = clamp01(g * (1 - 0.7 * frost));
    return k < 0.01 ? null : [0.18 * k, 0.55 * k, 1.0 * k];
  },
};

export const prop: PropDef = {
  id: 'prop_ice_crystal',
  size: 1024,
  crease: 20,
  aoShort: 0.35,
  aoLong: 1.4,
  aoGain: 1.15,
  shadowTint: [0.45, 0.55, 0.72],
  emissiveFactor: [1, 1, 1],
  material: { roughness: 0.25, metallic: 0.05 },
  mats: [
    iceMat,
    rockMat('frozen-granite', { tex: ['tex_rock_frozen'], texAmt: 0.5, k: 0.9, dark: '#2b323b', light: '#8d98a4', warm: '#7d7a78', cool: '#5f6f84', facet: 0.7, strata: 0.3, cracks: 0.6, edge: '#dce6ee', edgeAmt: 0.6, snow: 0.75, bump: 0.45, lichen: 0.15 }),
  ],
  build(m) {
    interface Part { faces: Face[]; mat: number; rough?: { edge?: number; centre?: number; minEdge?: number; seed?: number } }
    const parts: Part[] = [];
    const rng = new Rng('ice_crystal');
    // ---- frost-split boulder the crystals grow out of (two halves) + loose chunks
    const gp = groundPlane(0);
    const base = rockPlanes(rng.fork('base'), { r: [0.78, 0.34, 0.68], n: 18, jitter: 0.35, cut: [0.8, 1], chips: 4, chipDepth: [0.08, 0.2], skew: [0.08, 0, -0.06] });
    const split: Plane = { n: [0.83, 0.1, -0.55], d: 0.02 };
    const splitB: Plane = { n: [-0.83, -0.1, 0.55], d: 0.02 };
    parts.push({ faces: hull([...xfPlanes(base, m4translation([0, 0.06, 0])), split, gp], 8), mat: ROCK, rough: { edge: 0.08, centre: 0.06, minEdge: 0.2, seed: 3 } });
    parts.push({ faces: hull([...xfPlanes(base, m4mul(m4translation([0.06, 0.04, -0.04]), rotYm(0.05))), splitB, gp], 8), mat: ROCK, rough: { edge: 0.08, centre: 0.06, minEdge: 0.2, seed: 4 } });
    const chunks: { at: Vec3; r: Vec3; yaw: number }[] = [
      { at: [0.85, 0, 0.5], r: [0.2, 0.13, 0.17], yaw: 0.5 },
      { at: [-0.8, 0, -0.45], r: [0.18, 0.12, 0.2], yaw: 1.9 },
    ];
    chunks.forEach((c, i) => {
      const lp = rockPlanes(rng.fork(`chunk${i}`), { r: c.r, n: 9, jitter: 0.4, cut: [0.76, 1], chips: 1 });
      parts.push({ faces: hull([...xfPlanes(lp, m4mul(m4translation([c.at[0], c.r[1] * 0.3, c.at[2]]), rotYm(c.yaw))), gp], 4), mat: ROCK, rough: { centre: 0.08, seed: 10 + i } });
    });

    // ---- crystals
    SHARDS.forEach((s, i) => {
      const r = new Rng(`ice:${i}`);
      const lp = crystalPlanes(r, { h: s.h, r: s.r, sides: s.sides, narrow: s.narrow, tipLen: s.tipLen, tip: s.tip, irregular: 0.2, aspect: 0.12, offset: 0.3, bottom: -0.5 });
      const place = shardXf(s, r.next() * 6.28);
      if (!s.kink) {
        parts.push({ faces: hull([...xfPlanes(lp, place), gp], 10), mat: ICE });
        return;
      }
      const y0 = s.kink.t * s.h;
      parts.push({ faces: hull([...xfPlanes([...lp, { n: [0, 1, 0], d: y0 }], place), gp], 10), mat: ICE });
      parts.push({ faces: hull([...xfPlanes(xfPlanes([...lp, { n: [0, -1, 0], d: -y0 }], kinkXf(y0, s.kink)), place), gp], 10), mat: ICE });
    });

    // normalise to the nominal height
    let top = 0;
    for (const p of parts) for (const f of p.faces) for (const v of f.poly) top = Math.max(top, v[1]);
    const k = HEIGHT / top;
    const sc = (v: Vec3): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
    for (const p of parts) addFaces(m, p.faces, { mat: p.mat, skip: [TAG_GROUND], xf: sc, ...(p.rough ? { rough: p.rough } : {}) });
  },
};

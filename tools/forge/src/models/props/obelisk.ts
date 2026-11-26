// prop_obelisk — 7 m basalt obelisk of the volcanic zone: a two-tier rough-hewn plinth carrying a fret band, a tall chamfered shaft with
// a base collar and a neck collar that tapers into a pyramidion with a faintly glowing tip, split by an earthquake along an inclined
// fracture — the upper half has slid and twisted and ember light leaks through the gap. A column of framed rune cartouches runs up the
// front face ("faint ember"), narrower glyph strips on the sides, cracked basalt everywhere; fallen chunks lie around the foot.
// Built from planar-clipped solids so every edge is crisp and chipped; the runes are painted in the frame of the part they sit on.
import { Rng } from '../../core/rng.ts';
import type { Mat4, Vec3 } from '../../core/math.ts';
import { clamp01, m4mul, m4translation, smoothstep } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { fbm01, mixc, mulc, rgb } from '../../archetypes/prop/mats.ts';
import type { Texel } from '../../archetypes/prop/mesh.ts';
import type { Rgb } from '../../archetypes/prop/texlib.ts';
import { TAG_GAP, TAG_GROUND, addFaces, blockPlanes, groundPlane, hull, hullEdge, hullVerts, rockPlanes, rotYm, xfPlanes, type Face, type Plane } from '../../archetypes/prop/ext/PropsElem/hull.ts';
import { moltenMat } from '../../archetypes/prop/ext/PropsElem/lava.ts';
import { sandPainter } from '../../archetypes/prop/ext/PropsElem/mats.ts';
import { fretBand } from '../../archetypes/prop/ext/PropsElem/motifs.ts';
import { type Glow, facetHash, glowMat, loadMask, memo1, noiseBump, sampleMask, veins } from '../../archetypes/prop/ext/PropsElem/paint.ts';

const STONE = 0, MOLTEN = 1;

// ---------------------------------------------------------------------------------------------------------------------------------
// geometry constants (metres)

const H_TOTAL = 7.0;
const Y_SHAFT = 1.0; // shaft base
const W0 = 0.78; // half width at the shaft base
const W1 = 0.42; // half width where the pyramidion starts
const Y_PYR = 6.15;
const SLOPE = Math.atan((W0 - W1) / (Y_PYR - Y_SHAFT));

const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

// inclined fracture: the upper part slides down it, twists, and lifts a little off the lower part
const FR_N = unit([0.1, 0.93, -0.34]);
const FR_P: Vec3 = [0, 3.45, 0];
const FR_D = FR_N[0] * FR_P[0] + FR_N[1] * FR_P[1] + FR_N[2] * FR_P[2];
const TWIST = 0.06;
const SLIDE: Vec3 = (() => {
  const g: Vec3 = [FR_N[0] * FR_N[1], FR_N[1] * FR_N[1] - 1, FR_N[2] * FR_N[1]];
  const l = Math.hypot(g[0], g[1], g[2]);
  return [(g[0] / l) * 0.24 + FR_N[0] * 0.07, (g[1] / l) * 0.24 + FR_N[1] * 0.07, (g[2] / l) * 0.24 + FR_N[2] * 0.07];
})();

/** rigid transform of the upper part: twist about the shaft axis through the fracture point, then slide + lift */
const upperXf: Mat4 = m4mul(m4translation(SLIDE), m4mul(m4translation(FR_P), m4mul(rotYm(TWIST), m4translation([-FR_P[0], -FR_P[1], -FR_P[2]]))));

const isUpper = (p: Vec3): boolean => FR_N[0] * p[0] + FR_N[1] * p[1] + FR_N[2] * p[2] - FR_D > 0.02;

/** world point -> the frame of the part it belongs to (so painted motifs follow the slid upper half) */
function partLocal(p: Vec3): Vec3 {
  if (!isUpper(p)) return p;
  const q: Vec3 = [p[0] - SLIDE[0] - FR_P[0], p[1] - SLIDE[1] - FR_P[1], p[2] - SLIDE[2] - FR_P[2]];
  const c = Math.cos(-TWIST), s = Math.sin(-TWIST);
  return [c * q[0] + s * q[2] + FR_P[0], q[1] + FR_P[1], -s * q[0] + c * q[2] + FR_P[2]];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// painting

const basalt = sandPainter({
  tex: ['tex_basalt'],
  k: 0.7,
  ramp: [[0, rgb('#12111a')], [0.45, rgb('#34303a')], [1, rgb('#8a7c73')]],
  keep: 0,
  bump: 0.8,
  strata: 0,
  soot: 0,
  uvMetres: false,
});

const bands = loadMask('tex_rune_bands');
// the ten framed cartouches of the strip: first centre, pitch, half width, vertical centre and half height, as fractions of the 2048x512 image
const CART_X0 = 0.0638, CART_DX = 0.0983, CART_HW = 0.042, CART_CY = 0.478, CART_HH = 0.245;

interface Rune {
  /** 0..1 glyph / frame line strength */
  ink: number;
  /** 0..1 soft halo */
  halo: number;
  /** 0..1 inside the recessed cartouche field */
  field: number;
  /** relief light factor */
  lit: number;
}
const NO_RUNE: Rune = { ink: 0, halo: 0, field: 0, lit: 1 };

/** one cartouche of the strip drawn into a w x h metre cell centred at (cu, cy); u across, y up */
function cartouche(idx: number, u: number, y: number, cu: number, cy: number, w: number, h: number): Rune {
  if (!bands) return NO_RUNE;
  const lx = (u - cu) / w, ly = (y - cy) / h; // -0.5..0.5 inside the cell
  if (Math.abs(lx) > 0.62 || Math.abs(ly) > 0.62) return NO_RUNE;
  const iu = CART_X0 + CART_DX * idx + lx * 2 * CART_HW * 1.1;
  const iv = CART_CY - ly * 2 * CART_HH * 1.1;
  const m = sampleMask(bands, iu, iv);
  const e = 0.012;
  const hx = sampleMask(bands, iu + e, iv - e) - sampleMask(bands, iu - e, iv + e);
  const inside = Math.abs(lx) < 0.5 && Math.abs(ly) < 0.5 ? 1 : 0;
  return { ink: smoothstep(0.3, 0.75, m), halo: Math.min(1, m * 1.2), field: inside, lit: Math.min(1.35, Math.max(0.65, 1 + 2.2 * hx)) };
}

// cartouche centres up the front face (local height); the fracture zone around y 3.0..3.9 stays clear
const COLUMN = [1.68, 2.56, 4.4, 5.28];
const CW = 0.5, CH = 0.8;

/** which face of the shaft a texel is on, and its horizontal coordinate (u grows to the right when looking at the face) */
function faceU(p: Vec3, n: Vec3): { face: 'front' | 'side' | 'other'; u: number } {
  if (n[2] > 0.82) return { face: 'front', u: p[0] };
  if (n[0] > 0.82) return { face: 'side', u: -p[2] };
  if (n[0] < -0.82) return { face: 'side', u: p[2] };
  return { face: 'other', u: 0 };
}

function runesAt(t: Texel): Rune {
  const p = partLocal(t.p);
  if (p[1] < Y_SHAFT + 0.2 || p[1] > Y_PYR - 0.15) return NO_RUNE;
  const f = faceU(p, t.nf);
  const pick = (cells: readonly { idx: number; cu: number; cy: number; w: number; h: number }[]): Rune => {
    let best = NO_RUNE;
    for (const c of cells) {
      const r = cartouche(c.idx, f.u, p[1], c.cu, c.cy, c.w, c.h);
      if (r.field + r.halo > best.field + best.halo) best = r;
    }
    return best;
  };
  if (f.face === 'front') return pick(COLUMN.map((cy, i) => ({ idx: (i * 3 + 1) % 10, cu: 0, cy, w: CW, h: CH })));
  if (f.face === 'side') {
    const o = t.nf[0] > 0 ? 2 : 7;
    return pick([2.1, 4.8].map((cy, i) => ({ idx: (i * 4 + o) % 10, cu: 0.02, cy, w: 0.38, h: 0.6 })));
  }
  return NO_RUNE;
}

const runeMemo = memo1(runesAt);

const nearFracture = (p: Vec3): number => Math.abs(FR_N[0] * p[0] + FR_N[1] * p[1] + FR_N[2] * p[2] - FR_D);

/** key-fret band around the lower plinth tier (world x / z along the face, y relative to the tier top) */
const PLINTH_BAND = { y: 0.3, cell: 0.34 };
function plinthFret(t: Texel): { lit: number; ink: number; glow: number } {
  if (t.p[1] > 0.58 || t.p[1] < 0.05) return { lit: 1, ink: 0, glow: 0 };
  const ax = Math.abs(t.nf[0]), az = Math.abs(t.nf[2]);
  if (Math.max(ax, az) < 0.85) return { lit: 1, ink: 0, glow: 0 };
  const u = az > ax ? (t.nf[2] > 0 ? t.p[0] : -t.p[0]) : (t.nf[0] > 0 ? -t.p[2] : t.p[2]);
  return fretBand(u, t.p[1], { cy: PLINTH_BAND.y, cell: PLINTH_BAND.cell, glow: 0.3 });
}
const fretMemo = memo1(plinthFret);

function stonePaint(t: Texel): Rgb {
  const r = runeMemo(t);
  let c = basalt(t);
  // columnar weathering: vertical streaks, ash dust on top-facing ledges, lighter chipped edges
  const streak = 0.84 + 0.3 * t.noise.fbm(t.p[0] * 5, t.p[1] * 0.45, t.p[2] * 5, { octaves: 2 });
  c = mulc(c, streak * (0.82 + 0.34 * facetHash(t)));
  c = mulc(c, noiseBump(t, 7, 0.22, 2, 3));
  const e = hullEdge(t.uv);
  c = mixc(c, rgb('#a39a92'), (1 - smoothstep(0, 0.03, e.d)) * (0.22 + 0.2 * Math.max(0, t.nf[1])));
  c = mixc(c, rgb('#6b645d'), smoothstep(0.5, 0.95, t.nf[1]) * 0.55 * (0.5 + 0.5 * fbm01(t, 6, 2, 5)));
  // iron-oxide stain that bleeds down from the cracks
  c = mixc(c, rgb('#5a3425'), clamp01(0.5 * smoothstep(0.55, 0.9, fbm01(t, 2.6, 3, 8.1))) * (1 - smoothstep(1, 5.5, t.p[1])));
  // hairline cracks (dark)
  c = mulc(c, 1 - 0.7 * veins(t, 2.1, 0.009, 5, 0.6));
  // carved rune fields: recessed (darker) with lit/shaded relief on the strokes
  c = mulc(c, 1 - 0.35 * r.field * (1 - r.ink));
  c = mulc(c, 1 + (r.lit - 1) * r.field);
  c = mixc(c, rgb('#1a0b07'), r.ink * 0.85);
  const fr = fretMemo(t);
  c = mulc(c, fr.lit * (1 - 0.7 * fr.ink));
  return c;
}

function stoneHeat(t: Texel): Glow {
  const r = runeMemo(t);
  const p = partLocal(t.p);
  const cell = 0.7 + 0.3 * t.noise.noise(Math.floor((p[1] + 0.2) / 0.85) * 3.7, 1.3, 0.7);
  const nf = nearFracture(t.p);
  const v = veins(t, 2.1, 0.009, 5, 0.6);
  const leak = v * (1 - smoothstep(0.1, 1.0, nf)) * 0.7 + v * 0.18 * (1 - smoothstep(1.0, 2.2, t.p[1]));
  const ember = r.ink * 0.62 * cell + r.halo * 0.1 * r.field;
  const tip = smoothstep(6.55, 6.95, p[1]) * 0.55;
  const fr = fretMemo(t);
  return { heat: clamp01(Math.max(ember, leak, tip, fr.glow * 0.5)), char: clamp01(r.halo * 0.5 * r.field) };
}

// ---------------------------------------------------------------------------------------------------------------------------------

function shaftPlanes(rng: Rng): Plane[] {
  const planes: Plane[] = [];
  const ca = Math.cos(SLOPE), sa = Math.sin(SLOPE);
  const skew = (): number => (rng.next() - 0.5) * 0.02;
  for (let k = 0; k < 4; k++) {
    const phi = (k * Math.PI) / 2 + skew();
    planes.push({ n: [Math.cos(phi) * ca, sa, Math.sin(phi) * ca], d: W0 * ca + Y_SHAFT * sa });
  }
  // chamfers along the four vertical corners
  const sc = W0 * Math.SQRT2 - 0.08;
  for (let k = 0; k < 4; k++) {
    const phi = Math.PI / 4 + (k * Math.PI) / 2 + skew();
    planes.push({ n: [Math.cos(phi) * ca, sa, Math.sin(phi) * ca], d: sc * ca + Y_SHAFT * sa });
  }
  // pyramidion
  const gam = Math.atan(W1 / (H_TOTAL - Y_PYR));
  for (let k = 0; k < 4; k++) {
    const phi = (k * Math.PI) / 2 + skew() * 2;
    const n: Vec3 = [Math.cos(gam) * Math.cos(phi), Math.sin(gam), Math.cos(gam) * Math.sin(phi)];
    planes.push({ n, d: n[1] * H_TOTAL });
  }
  return planes;
}

/** square collar ring around the shaft: bevelled top and bottom edges, chamfered corners */
function collarPlanes(y0: number, y1: number, w: number, bev: number): Plane[] {
  const planes: Plane[] = [{ n: [0, -1, 0], d: -y0 }, { n: [0, 1, 0], d: y1 }];
  const r = Math.SQRT1_2;
  for (let k = 0; k < 4; k++) {
    const phi = (k * Math.PI) / 2;
    const c = Math.cos(phi), s = Math.sin(phi);
    planes.push({ n: [c, 0, s], d: w });
    planes.push({ n: [c * r, r, s * r], d: r * (w + y1 - bev) });
    planes.push({ n: [c * r, -r, s * r], d: r * (w - bev - y0) });
  }
  for (let k = 0; k < 4; k++) {
    const phi = Math.PI / 4 + (k * Math.PI) / 2;
    planes.push({ n: [Math.cos(phi), 0, Math.sin(phi)], d: w * Math.SQRT2 - 0.1 });
  }
  return planes;
}

export const prop: PropDef = {
  id: 'prop_obelisk',
  size: 1536,
  crease: 30,
  aoShort: 0.5,
  aoLong: 2.6,
  // ~40% under the original 1.6 (bloom washed out the glyph bands at the gameplay camera)
  emissiveFactor: [0.95, 0.95, 0.95],
  material: { roughness: 0.88, metallic: 0 },
  mats: [glowMat('basalt', stonePaint, stoneHeat, { spill: 0.1, scorch: [0.1, 0.03, 0.02] }), moltenMat()],
  build(m) {
    const rng = new Rng('obelisk');
    const gp = groundPlane(0);
    interface Part { faces: Face[]; mat: number | ((f: Face) => number); rough?: { edge?: number; centre?: number; minEdge?: number; seed?: number } }
    const parts: Part[] = [];
    const split = (f: Face): number => (f.tag === TAG_GAP ? MOLTEN : STONE);

    // plinth: two hewn tiers, slightly rotated against each other
    const tier = (half: Vec3, at: Vec3, yaw: number, cuts: number, seed: number): void => {
      const lp = blockPlanes(rng.fork(`tier${seed}`), { size: half, tilt: 0.03, cuts, depth: [0.06, 0.2], edgeBias: 0.7, minY: -0.1 });
      parts.push({ faces: hull([...xfPlanes(lp, m4mul(m4translation(at), rotYm(yaw))), gp], 12), mat: STONE, rough: { edge: 0.06, centre: 0.04, minEdge: 0.3, seed } });
    };
    tier([1.38, 0.3, 1.3], [0.05, 0.3, 0.0], 0.08, 6, 11);
    tier([1.04, 0.24, 1.0], [-0.02, 0.84, 0.02], -0.05, 5, 12);

    // shaft, cut by the fracture plane into a lower and an upper part
    const sp = shaftPlanes(rng.fork('shaft'));
    const bottom: Plane = { n: [0, -1, 0], d: -(Y_SHAFT - 0.15) };
    const lowerCut: Plane = { n: FR_N, d: FR_D, tag: TAG_GAP };
    const upperCut: Plane = { n: [-FR_N[0], -FR_N[1], -FR_N[2]], d: -FR_D, tag: TAG_GAP };
    parts.push({ faces: hull([...sp, bottom, lowerCut], 12), mat: split, rough: { centre: 0.03, seed: 21 } });

    // chips off the upper part, measured against the real solid: one corner of the pyramidion and a nick high on the shaft
    const upperBase = hullVerts(hull([...sp, upperCut], 12));
    const chips: Plane[] = [];
    for (const [dir, depth] of [[[0.72, 0.42, 0.55], 0.16], [[-0.75, 0.15, 0.62], 0.12]] as const) {
      const n = unit([dir[0], dir[1], dir[2]]);
      let sup = -1e9;
      for (const v of upperBase) sup = Math.max(sup, n[0] * v[0] + n[1] * v[1] + n[2] * v[2]);
      chips.push({ n, d: sup - depth });
    }
    parts.push({ faces: hull(xfPlanes([...sp, ...chips, upperCut], upperXf), 12), mat: split, rough: { centre: 0.03, seed: 22 } });

    // base collar (just above the plinth) and neck collar (under the pyramidion): the neck belongs to the upper part
    parts.push({ faces: hull([...collarPlanes(Y_SHAFT - 0.1, Y_SHAFT + 0.34, W0 + 0.1, 0.1), gp], 12), mat: STONE, rough: { centre: 0.03, seed: 31 } });
    parts.push({ faces: hull(xfPlanes(collarPlanes(Y_PYR - 0.4, Y_PYR + 0.02, W1 + 0.09, 0.08), upperXf), 12), mat: STONE, rough: { centre: 0.03, seed: 32 } });

    // fallen chunks around the foot
    const chunks: { at: Vec3; r: Vec3; yaw: number }[] = [
      { at: [0.95, 0, 1.3], r: [0.4, 0.25, 0.32], yaw: 0.6 },
      { at: [-1.2, 0, 0.95], r: [0.32, 0.21, 0.28], yaw: 2.1 },
      { at: [1.35, 0, -0.5], r: [0.28, 0.19, 0.24], yaw: 1.2 },
      { at: [-0.5, 0, -1.32], r: [0.36, 0.23, 0.28], yaw: 0.2 },
      { at: [0.3, 0, 1.42], r: [0.2, 0.14, 0.18], yaw: 1.7 },
    ];
    chunks.forEach((c, i) => {
      const lp = rockPlanes(rng.fork(`chunk${i}`), { r: c.r, n: 11, jitter: 0.4, cut: [0.76, 1], chips: 2, chipDepth: [0.1, 0.25], skew: [0.1, 0.2, -0.1] });
      parts.push({ faces: hull([...xfPlanes(lp, m4mul(m4translation([c.at[0], c.r[1] * 0.3, c.at[2]]), rotYm(c.yaw))), gp], 8), mat: STONE, rough: { edge: 0.08, centre: 0.06, minEdge: 0.22, seed: 40 + i } });
    });

    for (const p of parts) addFaces(m, p.faces, { mat: p.mat, skip: [TAG_GROUND], ...(p.rough ? { rough: p.rough } : {}) });
  },
};

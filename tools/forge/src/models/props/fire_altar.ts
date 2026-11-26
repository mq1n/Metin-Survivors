// prop_fire_altar — 3 m round stepped fire altar of the volcanic zone (7.3 m across): two faceted basalt tiers built from fitted blocks
// (base moulding, cornice lip, paved tops with ash and scorch), ember light seeping from the joints and a molten crack network on the
// treads; two carved sandstone dragons writhe along the lower tier and guard the front stair with glowing eyes; the upper tier carries
// framed rune panels alternating with glowing sigil medallions; a red sandstone lotus of upturned petals holds a faceted bronze fire
// bowl with a crown of upturned petals, filled with glowing coals and licking flame tongues (all emissive).
import type { Mat4, Vec3 } from '../../core/math.ts';
import { clamp01, smoothstep } from '../../core/math.ts';
import { extrude } from '../../core/hard/hardmesh.ts';
import { Rng } from '../../core/rng.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import type { Mapper, Texel } from '../../archetypes/prop/mesh.ts';
import { fbm01, groundDirt, mixc, mulc, rgb } from '../../archetypes/prop/mats.ts';
import type { Rgb } from '../../archetypes/prop/texlib.ts';
import { crackGlow } from '../../archetypes/prop/ext/PropsElem/mats.ts';
import { fretBand, lotusPetal, NO_MOTIF, runePanel, type Motif } from '../../archetypes/prop/ext/PropsElem/motifs.ts';
import { type Glow, facetHash, glowMat, loadMask, memo1, noiseBump, sampleMask, veins } from '../../archetypes/prop/ext/PropsElem/paint.ts';
import { tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { FIRE, coalHeap, coalMat, flameMat, flameTongue } from '../../archetypes/prop/ext/PropsElem2/fire.ts';
import { TAU, faceAt, hash2, lathe2, thetaOf, wrapA } from '../../archetypes/prop/ext/PropsElem2/geo.ts';
import { bronzeMat } from '../../archetypes/prop/ext/PropsElem2/metal.ts';
import { stonePainter } from '../../archetypes/prop/ext/PropsElem2/stone.ts';

const BASALT = 0, LOTUS = 1, BRONZE = 2, COALS = 3, FLAME = 4, DRAGON = 5, HEAD = 6;

// ---------------------------------------------------------------------------------------------------------------------------------
// layout (metres); front = +z = theta -PI/2

const TH_F = -Math.PI / 2;
const N1 = 28, N2 = 20;
/** phase that centres a face (not a corner) on the front */
const phaseFor = (n: number): number => TH_F + Math.PI / n;
const PH1 = phaseFor(N1), PH2 = phaseFor(N2);
const Y1 = 0.72, Y2 = 1.38, Y3 = 1.8;
const R1 = 3.5, R2 = 2.6;
const T1: [number, number][] = [[3.64, 0], [3.64, 0.12], [3.54, 0.17], [R1, 0.6], [3.58, 0.65], [3.5, Y1], [2.74, Y1]];
const T2: [number, number][] = [[2.74, Y1 - 0.01], [2.72, 0.8], [2.64, 0.84], [R2, 1.26], [2.68, 1.31], [2.6, Y2], [1.4, Y2]];

// ---------------------------------------------------------------------------------------------------------------------------------
// painting

const basaltRaw = stonePainter({ tex: ['tex_basalt'], k: 0.28, ramp: [[0, rgb('#221d1a')], [0.5, rgb('#4b433d')], [1, rgb('#8a7f74')]], contrast: 0.6, bump: 0.55, strata: 0.3, blotch: 0.35 });
const basalt = (t: Texel): Rgb => groundDirt(basaltRaw(t), t, 0.5, 0.35, rgb('#1b1412'));

const SAND_RAMP: [number, Rgb][] = [[0, rgb('#2c0f09')], [0.35, rgb('#7a2e1b')], [0.7, rgb('#b44a22')], [1, rgb('#e39858')]];
const sand = stonePainter({ tex: ['tex_rock_canyon'], k: 0.6, ramp: SAND_RAMP, contrast: 1.1, keep: 0.15, bump: 0.45, strata: 0.4, blotch: 0.2 });
const lotusSand = stonePainter({ tex: ['tex_rock_canyon'], k: 0.35, ramp: SAND_RAMP, contrast: 0.45, keep: 0.1, bump: 0.3, strata: 0.15, blotch: 0.15 });

const sigils = loadMask('tex_rune_sigils');

interface Paint {
  /** value multiplier */
  lit: number;
  /** 0..1 dark groove / joint */
  ink: number;
  /** 0..1 ember glow */
  glow: number;
  /** light ash / dust amount */
  ash: number;
  /** per-block tint factor */
  tint: number;
}

function sigilMedallion(lu: number, lv: number, idx: number): Motif {
  const R = 0.17;
  const d = Math.hypot(lu, lv);
  if (d > R + 0.04) return NO_MOTIF;
  const ring = 1 - smoothstep(0.012, 0.024, Math.abs(d - R));
  const field = smoothstep(R + 0.004, R - 0.01, d);
  let g = 0;
  let lit = 1 + 0.35 * ring * (lv > lu ? 1 : -0.6);
  if (sigils && d < R - 0.015) {
    const cx = idx % 4, cy = Math.floor(idx / 4) % 4;
    const s = 0.5 / (R - 0.015) * 0.86;
    const mu = (cx + 0.5 + lu * s) / 4, mv = (cy + 0.5 - lv * s) / 4;
    const mk = sampleMask(sigils, mu, mv);
    g = smoothstep(0.35, 0.8, mk);
    const e = 0.004;
    lit *= 1 + 1.8 * (sampleMask(sigils, mu + e, mv - e) - sampleMask(sigils, mu - e, mv + e));
  }
  return { lit, ink: clamp01(field * 0.32 + ring * 0.25 + g * 0.5), glow: g };
}

/** carved / built pattern of the basalt tiers at a texel */
function tierPaint(t: Texel): Paint {
  const p = t.p;
  const th = thetaOf(p);
  const r = Math.hypot(p[0], p[2]);
  const up = t.nf[1] > 0.7;
  const out: Paint = { lit: 1, ink: 0, glow: 0, ash: 0, tint: 1 };
  if (up) {
    // paving: radial joints at the wall corners of the tier below the tread, a concentric joint half way, staggered rings
    const tierTop = p[1] > (Y1 + Y2) / 2 ? 2 : 1;
    const n = tierTop === 1 ? N1 : N2, ph = tierTop === 1 ? PH1 : PH2;
    const rIn = tierTop === 1 ? 2.74 : 1.6, rOut = tierTop === 1 ? R1 : R2;
    const rMid = (rIn + rOut) / 2;
    const ring = r > rMid ? 1 : 0;
    const f = faceAt(th + (ring ? 0 : Math.PI / n), r, n, ph);
    const dc = Math.abs(r - rMid);
    const dj = Math.min(f.dj, dc);
    const w = 0.012 * (0.7 + 0.6 * fbm01(t, 14, 2, 2.2));
    out.ink = (1 - smoothstep(w, w * 2.2, dj)) * (r < rOut - 0.04 ? 1 : 0);
    out.tint = 0.86 + 0.28 * hash2(f.j * 3 + ring, tierTop * 17);
    out.lit = 1 + 0.22 * smoothstep(w * 2, w * 5, dj) * (1 - smoothstep(w * 5, w * 9, dj)) * (f.lu > 0 ? 1 : -0.5);
    // ash drifts against the walls (occluded corners) and toward the bowl
    out.ash = clamp01((1 - t.ao) * 1.2 + (1 - smoothstep(1.9, 2.4, r)) * 0.5) * smoothstep(0.35, 0.7, fbm01(t, 3.2, 3, 4.4) + 0.15);
    return out;
  }
  // walls: one course of fitted blocks per tier, joints on the faceted corners
  if (Math.abs(t.nf[1]) < 0.5) {
    const tier = p[1] < Y1 ? 1 : 2;
    const n = tier === 1 ? N1 : N2, ph = tier === 1 ? PH1 : PH2;
    const f = faceAt(th, r, n, ph);
    out.tint = 0.84 + 0.32 * hash2(f.j, tier * 31);
    const w = 0.014 * (0.7 + 0.6 * fbm01(t, 12, 2, 6.1));
    out.ink = 1 - smoothstep(w, w * 2.2, f.dj);
    if (tier === 2 && p[1] > 0.86 && p[1] < 1.25 && f.j !== 0) {
      const lv = p[1] - 1.05;
      const m = f.j % 2 === 0 ? sigilMedallion(f.lu, lv, (f.j * 7) % 16) : runePanel(f.lu, p[1] - 0.84, { cy: 0.21, hw: 0.27, hh: 0.15, seed: 400 + f.j, glow: 0.5, stroke: 0.022, frame: 0.03 });
      out.lit *= m.lit;
      out.ink = Math.max(out.ink, m.ink);
      out.glow = m.glow * (f.j % 2 === 0 ? 0.75 : 0.55);
    }
    // ember light leaking through the low joints
    out.glow = Math.max(out.glow, out.ink * (1 - smoothstep(0.1, 0.55, p[1] - (tier === 1 ? 0 : Y1))) * 0.55 * smoothstep(0.4, 0.75, fbm01(t, 2.5, 2, 9.4)));
  }
  return out;
}
const tierMemo = memo1(tierPaint);

/** ember crack network: dense on the treads (most around the bowl), sparse on the walls */
const tierCracks = crackGlow({
  scale: 0.9,
  width: 0.011,
  cover: (t) => (t.nf[1] > 0.7 ? 0.2 + 0.32 * (1 - smoothstep(1.9, 3.2, Math.hypot(t.p[0], t.p[2]))) : 0.05),
  heat: (t) => 0.75 + 0.25 * (1 - smoothstep(0, 1.4, t.p[1])),
  seed: 4,
  fine: false,
});

function basaltShade(t: Texel): Rgb {
  const pt = tierMemo(t);
  let c = mulc(basalt(t), pt.tint * (0.9 + 0.2 * facetHash(t)));
  c = mulc(c, noiseBump(t, 5, 0.25, 2, 7));
  // chipped light edges and a darker weathered bottom
  c = mixc(c, rgb('#9d9187'), smoothstep(0.25, 0.7, t.edge) * 0.45 * (0.4 + 0.6 * fbm01(t, 20, 2, 3.1)));
  c = mulc(c, 1 - 0.55 * veins(t, 2.2, 0.006, 3, 0.55));
  c = mulc(c, pt.lit * (1 - 0.82 * pt.ink));
  if (pt.ash > 0) c = mixc(c, mulc(rgb('#8f8983'), 0.8 + 0.3 * fbm01(t, 18, 2, 5)), pt.ash * 0.7);
  // soot fanning up the upper tier toward the bowl
  c = mixc(c, rgb('#0d0a09'), smoothstep(0.9, 1.4, t.p[1]) * (1 - smoothstep(1.9, 2.7, Math.hypot(t.p[0], t.p[2]))) * 0.5 * fbm01(t, 4, 3, 1.1));
  return c;
}

function basaltGlow(t: Texel): Glow {
  const pt = tierMemo(t);
  const g = tierCracks(t);
  return { heat: clamp01(Math.max(g.heat, pt.glow * (0.6 + 0.3 * fbm01(t, 7, 2, 2.5)))), char: Math.max(g.char, pt.glow * 0.4) };
}

// lotus plinth: 10 broad upturned petals cupping the bowl
const PETALS = 10;
const PH_L = TH_F;
const LOTUS_PROFILE: [number, number][] = [[1.42, Y2 - 0.01], [1.58, Y2 + 0.12], [1.66, Y2 + 0.28], [1.6, Y3], [1.36, Y3 + 0.02], [0.75, Y3 + 0.02]];
/** petal bulge weight 0..1 at angle th (1 = petal centre line, 0 = the V cleft between two petals) */
const petalAt = (th: number): number => Math.abs(Math.cos(((th - PH_L) * PETALS) / 2)) ** 0.7;
function lotusShade(t: Texel): Rgb {
  const th = thetaOf(t.p);
  const ph = (wrapA(th - PH_L) / TAU) * PETALS;
  const top = t.nf[1] > 0.85 && Math.hypot(t.p[0], t.p[2]) < 1.38;
  const m = top ? NO_MOTIF : lotusPetal(ph + 0.5, clamp01((t.p[1] - Y2) / (Y3 - Y2 + 0.06)), { tipY: 0.95 });
  let c = mulc(lotusSand(t), m.lit * (1 - 0.9 * m.ink));
  // petal bellies lighter, the clefts between petals dark
  const b = petalAt(th);
  c = mulc(c, 0.62 + 0.55 * b);
  c = mixc(c, rgb('#f2b273'), smoothstep(0.3, 0.7, t.edge) * 0.4);
  c = mixc(c, rgb('#140c09'), (top ? 0.65 : 0.25) * smoothstep(1.55, 1.85, t.p[1]) * fbm01(t, 5, 3, 2.2));
  return c;
}

// bowl: soot inside and on the upper body, glowing inner lip, cast key-fret band
const bowl = bronzeMat('bronze-bowl', {
  k: 1.4,
  corrode: 0.55,
  polish: 0.75,
  soot: (t) => {
    const r = Math.hypot(t.p[0], t.p[2]);
    const inward = -(t.n[0] * t.p[0] + t.n[2] * t.p[2]) / Math.max(1e-3, r);
    return clamp01(smoothstep(2.25, 2.5, t.p[1]) * 0.6 + smoothstep(0.1, 0.5, inward) * 0.85);
  },
  heat: (t) => {
    const r = Math.hypot(t.p[0], t.p[2]);
    const inward = -(t.n[0] * t.p[0] + t.n[2] * t.p[2]) / Math.max(1e-3, r);
    return clamp01(smoothstep(0.2, 0.6, inward) * (1 - smoothstep(2.25, 2.46, t.p[1])) * 0.55 * (0.6 + 0.6 * fbm01(t, 10, 2, 4.4)));
  },
  motif: (t) => {
    if (t.p[1] < 2.08 || t.p[1] > 2.3) return NO_MOTIF;
    return fretBand(thetaOf(t.p) * 1.15, t.p[1], { cy: 2.19, cell: 0.115, glow: 0 });
  },
});

// dragons: tube uv u along the body (in 0.25 m tiles), v around; overlapping scales and a lighter belly / ridge
function dragonShade(t: Texel): Rgb {
  const u = t.uv[0] * 3.2, v = t.uv[1] * 2.4;
  const row = Math.floor(v);
  const fu = u + (row & 1 ? 0.5 : 0);
  const cu = fu - Math.floor(fu) - 0.5, cv = v - row - 0.15;
  const d = Math.hypot(cu, cv * 1.15) - 0.55;
  const rim = 1 - smoothstep(0, 0.12, Math.abs(d));
  let c = mulc(sand(t), (1 - 0.45 * rim) * (1 + 0.25 * clamp01(-cv)));
  c = mixc(c, rgb('#f2b46e'), smoothstep(0.3, 0.75, t.edge) * 0.4);
  return c;
}

const EYES: Vec3[] = [];
function headShade(t: Texel): Rgb {
  let c = sand(t);
  c = mixc(c, rgb('#f2b46e'), smoothstep(0.25, 0.7, t.edge) * 0.45);
  for (const e of EYES) {
    const d = Math.hypot(t.p[0] - e[0], t.p[1] - e[1], t.p[2] - e[2]);
    c = mixc(c, rgb('#140806'), 1 - smoothstep(0.03, 0.045, d));
  }
  return c;
}
function headGlow(t: Texel): Glow {
  let h = 0;
  for (const e of EYES) h = Math.max(h, 1 - smoothstep(0.012, 0.03, Math.hypot(t.p[0] - e[0], t.p[1] - e[1], t.p[2] - e[2])));
  return { heat: h * 0.95, char: 0 };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// geometry

/** column-major frame from forward / up / side axes and an origin */
const frame = (f: Vec3, u: Vec3, s: Vec3, o: Vec3): Mat4 => [f[0], f[1], f[2], 0, u[0], u[1], u[2], 0, s[0], s[1], s[2], 0, o[0], o[1], o[2], 1];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const xfPt = (m: Mat4, p: Vec3): Vec3 => [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!, m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!, m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!];

/** side profile of a carved dragon head (x forward, y up), origin at the neck */
const HEAD_SIDE: [number, number][] = [
  [-0.1, -0.11], [0.14, -0.13], [0.38, -0.09], [0.31, -0.035], [0.43, -0.005], [0.41, 0.075], [0.22, 0.11], [0.13, 0.18], [0.02, 0.17], [-0.26, 0.33], [-0.07, 0.11], [-0.16, 0.05],
];

/** block-ish part mapper (metres, dominant axis) */
const mapBlock: Mapper = (a, b, c, n) => {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const f = (p: Vec3): [number, number] => (ay >= ax && ay >= az ? [p[0], p[2]] : ax >= az ? [p[2], -p[1]] : [p[0], -p[1]]);
  return [f(a), f(b), f(c)];
};

export const prop: PropDef = {
  id: 'prop_fire_altar',
  size: 1536,
  crease: 14,
  aoShort: 0.45,
  aoLong: 2.4,
  aoGain: 1.25,
  shadowTint: [0.5, 0.4, 0.42],
  emissiveFactor: [1, 1, 1],
  material: { roughness: 0.86, metallic: 0 },
  mats: [
    glowMat('basalt', basaltShade, basaltGlow, { spill: 0.12, scorch: [0.1, 0.035, 0.025] }),
    glowMat('lotus', lotusShade, () => ({ heat: 0, char: 0 }), { spill: 0 }),
    bowl,
    coalMat('coals', FIRE, { scale: 5, base: 0.28, y0: 2.18, y1: 2.42, gain: 0.85 }),
    flameMat('flame', FIRE),
    glowMat('dragon', dragonShade, () => ({ heat: 0, char: 0 }), { spill: 0 }),
    glowMat('dragon-head', headShade, headGlow, { spill: 0 }),
  ],
  build(m) {
    const rng = new Rng('fire_altar');
    // ---- tiers: faceted block courses, rim corners jittered a little (hand-laid)
    const jitter = (n: number, seed: number) => (th: number, i: number, k: number, r: number, y: number): [number, number] => {
      if (r < 1e-6) return [r, y];
      const h = hash2(k, seed + i * 0);
      const top = i >= 4 ? 1 : 0;
      return [r * (1 + (h - 0.5) * 0.008), y + (top ? (hash2(k, seed + 5) - 0.5) * 0.025 : 0)];
    };
    lathe2(m, BASALT, T1, N1, { phase: PH1, mod: jitter(N1, 11) });
    lathe2(m, BASALT, T2, N2, { phase: PH2, mod: jitter(N2, 23) });

    // ---- lotus plinth: broad petals that swell out and lift their tips around the bowl foot
    lathe2(m, LOTUS, LOTUS_PROFILE, 40, {
      phase: PH_L,
      mod: (th, i, _k, r, y) => {
        const b = petalAt(th);
        if (i === 1) return [r * (1 + 0.05 * b), y];
        if (i === 2) return [r * (1 + 0.1 * b), y + 0.03 * b];
        if (i === 3) return [r * (1 + 0.13 * b), y + 0.12 * b - 0.05 * (1 - b)];
        if (i === 4) return [r * (1 + 0.06 * b), y + 0.06 * b - 0.02 * (1 - b)];
        return [r, y];
      },
    });

    // ---- faceted bronze fire bowl: foot, waist knop, flaring body, crown of 8 upturned petals, inner wall down to the coals
    const BOWL: [number, number][] = [[0.8, Y3 - 0.01], [0.8, Y3 + 0.05], [0.56, Y3 + 0.13], [0.54, 1.99], [0.66, 2.03], [0.92, 2.12], [1.16, 2.26], [1.31, 2.42], [1.25, 2.48], [1.12, 2.45], [1.0, 2.32], [0.95, 2.18]];
    lathe2(m, BRONZE, BOWL, 16, {
      phase: phaseFor(16),
      mod: (_th, i, k, r, y) => {
        if (i < 6 || i > 10) return [r, y];
        const tip = k % 2 === 0 ? 1 : 0;
        const w = i === 6 ? 0.3 : i === 10 ? 0.5 : 1;
        return [r + 0.08 * tip * w, y + 0.15 * tip * w];
      },
    });

    // ---- coals + flames
    coalHeap(m, COALS, { cx: 0, cz: 0, y0: 2.18, h: 0.24, r: 0.99, segs: 14, lumps: 6, lumpR: 0.15, seed: 'altar-coals' });
    flameTongue(m, FLAME, { base: [0, 2.22, 0], h: 0.78, r: 0.44, lobes: 3, twist: 2.3, sway: 0.4, phase: 0.3, rings: 9 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.4 + (rng.next() - 0.5) * 0.4;
      const rr = 0.52 + rng.next() * 0.14;
      const h = 0.4 + rng.next() * 0.22;
      flameTongue(m, FLAME, {
        base: [Math.cos(a) * rr, 2.26, -Math.sin(a) * rr],
        h,
        r: 0.21 + rng.next() * 0.07,
        lean: [Math.cos(a) * 0.14 + (rng.next() - 0.5) * 0.1, -Math.sin(a) * 0.14 + (rng.next() - 0.5) * 0.1],
        lobes: 3,
        twist: 1.6 + rng.next(),
        phase: rng.next() * 6,
        rings: 6,
      });
    }

    // ---- front stairs: three steps up to the first tread, two up to the second, cheek walls on the lower flight
    const step = (x0: number, x1: number, y1: number, z0: number, z1: number): void => {
      const h = extrude([[x0, 0], [x1, 0], [x1, y1], [x0, y1]], z1 - z0, { axis: 'z', z0, bevel: { size: 0.025, segments: 1 } });
      m.add(h, BASALT, mapBlock);
    };
    const a1 = R1 * Math.cos(Math.PI / N1), a2 = R2 * Math.cos(Math.PI / N2);
    for (let i = 0; i < 3; i++) step(-1.0, 1.0, Y1 - i * 0.24, a1 - 0.08 + i * 0.32, a1 + (i + 1) * 0.32);
    for (let i = 0; i < 2; i++) {
      const h = extrude([[-0.85, Y1 - 0.02], [0.85, Y1 - 0.02], [0.85, Y2 - i * 0.33], [-0.85, Y2 - i * 0.33]], 0.3 + 0.08 * (i === 0 ? 1 : 0), { axis: 'z', z0: a2 - 0.08 + i * 0.3 + (i === 0 ? 0 : 0.08), bevel: { size: 0.025, segments: 1 } });
      m.add(h, BASALT, mapBlock);
    }
    for (const sx of [-1, 1]) {
      // sloping cheek wall: outline in (y, z), extruded along x
      const x0 = sx > 0 ? 1.0 : -1.26;
      const cheek = extrude([[0, a1 - 0.1], [0, a1 + 1.02], [0.3, a1 + 1.02], [Y1 + 0.16, a1 + 0.12], [Y1 + 0.16, a1 - 0.1]], 0.26, { axis: 'x', z0: x0, bevel: { size: 0.03, segments: 1 } });
      m.add(cheek, BASALT, mapBlock);
    }

    // ---- two carved dragons writhing along the lower tier toward the stair, heads guarding it
    for (const s of [-1, 1]) {
      const pts: Vec3[] = [];
      const radii: number[] = [];
      const n = 20;
      const th0 = TH_F + s * 0.52, span = 2.5;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const th = th0 + s * span * u;
        const y = 0.39 + 0.1 * Math.sin(u * TAU * 2.2 + 0.6) * (0.3 + 0.7 * smoothstep(0, 0.15, u));
        const rb = 0.035 + 0.11 * Math.pow(1 - u, 0.8);
        const rr = 3.49 + rb * 0.5;
        pts.push([Math.cos(th) * rr, y, -Math.sin(th) * rr]);
        radii.push(rb * 0.65);
      }
      tube(m, { path: pts, radii, sides: 5, mat: DRAGON, s: 0.25, squash: 1 / 0.65, caps: 'none', seed: `dragon${s}`, jitter: 0.05, phase: 0.3 });
      // head at the start of the body, looking along the body toward the stairs
      const p0 = pts[0]!, p1 = pts[1]!;
      let f: Vec3 = [p0[0] - p1[0], 0, p0[2] - p1[2]];
      const fl = Math.hypot(f[0], f[2]);
      f = [f[0] / fl, 0, f[2] / fl];
      const up: Vec3 = [0, 1, 0];
      const side = cross(f, up);
      const o: Vec3 = [p0[0] + f[0] * 0.04, p0[1] + 0.02, p0[2] + f[2] * 0.04];
      const k = 1.3;
      const M = frame([f[0] * k, 0, f[2] * k], [0, k, 0], [side[0] * k, side[1] * k, side[2] * k], o);
      const head = extrude(HEAD_SIDE, 0.22, { axis: 'z', z0: -0.11, bevel: { size: 0.025, segments: 1 } });
      m.add(head, HEAD, mapBlock, M);
      // `side` points into or out of the wall depending on the dragon; the eye on the outward side is the visible one
      const outward = Math.sign(side[0] * o[0] + side[2] * o[2]) || 1;
      EYES.push(xfPt(M, [0.23, 0.085, 0.112 * outward]));
      // mane spikes along the neck
      for (let q = 1; q <= 4; q++) {
        const a = pts[q * 2]!, b = pts[q * 2 + 1]!;
        const tg: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const tl = Math.hypot(tg[0], tg[1], tg[2]);
        const base: Vec3 = [a[0], a[1] + radii[q * 2]! * 1.3, a[2]];
        const tipP: Vec3 = [base[0] - (tg[0] / tl) * 0.08, base[1] + 0.11 - q * 0.015, base[2] - (tg[2] / tl) * 0.08];
        tube(m, { path: [base, [(base[0] + tipP[0]) / 2, (base[1] + tipP[1]) / 2, (base[2] + tipP[2]) / 2], tipP], radii: [0.035, 0.02, 0.002], sides: 3, mat: DRAGON, s: 0.25, caps: 'none', seed: `sp${s}${q}` });
      }
    }
  },
};

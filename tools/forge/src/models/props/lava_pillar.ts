// prop_lava_pillar — 13 m beacon pillar of the volcanic zone: a stepped octagonal plinth, an eight-petal lotus foot, seven stacked
// tapering sandstone drums (each twisted / shifted a little, painted with rune panels, key-fret and dragon-scale bands, joined by
// glowing ember V-grooves), two crossing ruyi-cloud plates, a pinched neck, a flared capital whose rim rises into eight upturned
// petals around a basin of glowing coals, and a faceted ember jewel on top. Rust-red sandstone painted with strata, soot and a
// molten crack network; every ember part writes the emissive map.
import { Rng } from '../../core/rng.ts';
import type { Vec3 } from '../../core/math.ts';
import { clamp01, m4mul, m4translation, smoothstep } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { extrude, revolve, sweepSolid } from '../../archetypes/prop/kit.ts';
import { mapCylY, type Mat, type Texel } from '../../archetypes/prop/mesh.ts';
import { fbm01, mixc, mulc, rgb } from '../../archetypes/prop/mats.ts';
import { TAG_GROUND, addFaces, groundPlane, hull, rockPlanes, rotX, rotYm, rotZ, xfPlanes } from '../../archetypes/prop/ext/PropsElem/hull.ts';
import { crownRings, drum, loftRings, mapDrum, mapMetres } from '../../archetypes/prop/ext/PropsElem/arch.ts';
import { crackGlow, sandPainter } from '../../archetypes/prop/ext/PropsElem/mats.ts';
import { fretBand, lotusPetal, NO_MOTIF, RUYI, ruyiPlate, runePanel, scaleBand, type Motif } from '../../archetypes/prop/ext/PropsElem/motifs.ts';
import { type Glow, type Stop, cracks, facetHash, glowMat, memo1 } from '../../archetypes/prop/ext/PropsElem/paint.ts';

const SAND = 0, RIM = 1, COALS = 2, BASALT = 3, SANDHULL = 4, FLAME = 5, LOTUS = 6, D_RUNE = 7, D_FRET = 8, D_SCALE = 9, PLATE_A = 10, PLATE_B = 11;

const SAND_RAMP: Stop[] = [
  [0, rgb('#2a0c08')],
  [0.35, rgb('#74281a')],
  [0.7, rgb('#b2431f')],
  [1, rgb('#e08a4a')],
];

const sandPaint = sandPainter({ tex: ['tex_rock_canyon'], k: 0.36, ramp: SAND_RAMP, keep: 0.2, bump: 0.3, strata: 0.7, soot: 0.6 });
const sandPaintHull = sandPainter({ tex: ['tex_rock_canyon'], k: 0.5, ramp: SAND_RAMP, keep: 0.2, bump: 0.45, strata: 0.7, soot: 0.6, uvMetres: false });

/** crack coverage over the pillar: hot near the ground and toward the capital, sparse in between */
const cover = (y: number): number => clamp01(0.12 + 0.62 * (1 - smoothstep(0, 4.5, y)) + 0.55 * smoothstep(9.6, 11.6, y));

const sandGlow = crackGlow({
  scale: 0.9,
  stretch: [1, 0.4, 1],
  width: 0.014,
  cover: (t) => cover(t.p[1]),
  heat: (t) => 0.62 + 0.38 * (1 - smoothstep(0, 6, t.p[1])),
  seed: 3,
  fine: true,
});

/** crust plates over molten rock on the coal bed */
const coalCracks = (t: Texel): { core: number } => cracks(t, { scale: 3.4, width: 0.02, halo: 0.07, warp: 0.5, keep: 0.95, seed: 5 });

const rimHeat = (t: Texel): number => 0.52 + 0.4 * (0.5 + 0.5 * t.noise.noise(t.p[0] * 5 + t.p[2] * 3, t.p[1] * 9, t.p[2] * 5 - t.p[0] * 2));

/** carved sandstone whose upright faces carry a painted motif in metres (u across the face, v up from the drum bottom) */
function carved(name: string, motif: (t: Texel) => Motif, paint = sandPaint): Mat {
  const mm = memo1(motif);
  return glowMat(
    name,
    (t) => {
      const m = mm(t);
      return mulc(paint(t), m.lit * (1 - 0.72 * m.ink) * drumTint(t.p[1]));
    },
    (t): Glow => {
      const m = mm(t);
      const g = sandGlow(t);
      return { heat: Math.max(g.heat, m.glow * 0.9), char: Math.max(g.char, m.ink * 0.3) };
    },
    { spill: 0.14 },
  );
}

const TINT = [1.0, 0.9, 1.07, 0.95, 1.05, 0.92, 1.03];
/** subtle per-drum value shift so the stack does not read as one extrusion */
const drumTint = (y: number): number => {
  const i = DRUMS.findIndex((d) => y >= d.y0 && y < d.y1);
  return i < 0 ? 1 : TINT[i % TINT.length]!;
};

const upright = (t: Texel): boolean => Math.abs(t.nf[1]) < 0.5;

// drum table (bottom -> top); motif per drum
interface Drum {
  y0: number;
  y1: number;
  r0: number;
  r1: number;
  mat: number;
}
const DRUMS: Drum[] = [
  { y0: 2.0, y1: 3.25, r0: 1.42, r1: 1.38, mat: D_RUNE },
  { y0: 3.25, y1: 4.35, r0: 1.4, r1: 1.36, mat: D_FRET },
  { y0: 4.35, y1: 5.7, r0: 1.33, r1: 1.28, mat: D_RUNE },
  { y0: 5.7, y1: 6.7, r0: 1.2, r1: 1.16, mat: D_SCALE },
  { y0: 6.7, y1: 7.9, r0: 1.15, r1: 1.1, mat: D_RUNE },
  { y0: 7.9, y1: 8.9, r0: 1.08, r1: 1.04, mat: D_FRET },
  { y0: 8.9, y1: 10.2, r0: 0.98, r1: 0.92, mat: D_RUNE },
];

const PLATE_YAW = [0, Math.PI / 2 + 0.1];
const PLATE_Y = [8.45, 9.75];

function plateMat(name: string, yaw: number, yc: number): Mat {
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  return carved(name, (t) => (Math.abs(t.nf[0] * nx + t.nf[2] * nz) > 0.8 ? ruyiPlate(t.uv[0], t.uv[1], { glow: 0.75 }) : NO_MOTIF), sandPaint);
}

export const prop: PropDef = {
  id: 'prop_lava_pillar',
  size: 1536,
  crease: 36,
  aoShort: 0.6,
  aoLong: 3.2,
  // ~40% under the original 1.7: at the Daeryeol gameplay camera bloom ate the carved bands
  emissiveFactor: [1.0, 1.0, 1.0],
  material: { roughness: 0.92, metallic: 0 },
  mats: [
    glowMat('sandstone', sandPaint, sandGlow, { spill: 0.14 }),
    glowMat('ember-rim', (t) => mulc(rgb('#2a0d06'), 0.8 + 0.4 * fbm01(t, 18, 2, 1.3)), (t) => ({ heat: rimHeat(t), char: 0.2 }), { ao: 0.1, spill: 0 }),
    glowMat(
      'coals',
      (t) => mulc(rgb('#170907'), 0.8 + 0.6 * fbm01(t, 14, 3, 2.1)),
      (t) => {
        const c = coalCracks(t);
        return { heat: clamp01(0.1 + 0.1 * fbm01(t, 5, 2, 6.3) + c.core * (0.5 + 0.32 * fbm01(t, 9, 2, 1.7))), char: 0 };
      },
      { ao: 0.1, gain: 1.0 },
    ),
    glowMat('basalt', sandPainter({ tex: ['tex_basalt'], k: 0.9, ramp: [[0, rgb('#0f0d0d')], [0.5, rgb('#2c2826')], [1, rgb('#5a524c')]], bump: 0.6, uvMetres: false }), crackGlow({ scale: 2.4, width: 0.012, cover: () => 0.7, heat: () => 0.9, seed: 8 }), { spill: 0.2 }),
    glowMat('sandstone-hull', sandPaintHull, sandGlow, { spill: 0.14 }),
    glowMat(
      'ember-flame',
      (t) => mixc(rgb('#5a1d10'), rgb('#e5742f'), smoothstep(11.9, 13.2, t.p[1]) * 0.8),
      (t) => ({ heat: clamp01(0.3 + 0.42 * smoothstep(11.8, 13.1, t.p[1]) + 0.14 * fbm01(t, 8, 2, 3)), char: 0 }),
      { ao: 0.25, gain: 1.1 },
    ),
    // lotus petals: u = around (tile units, ~metres along the rim), v = -y
    glowMat(
      'lotus',
      (t) => {
        const p = (-t.uv[0] * 8) / 11 + 0.5;
        const m = lotusPetal(p, clamp01((-t.uv[1] - 0.9) / 1.1));
        return mulc(sandPaint(t), m.lit * (1 - 0.7 * m.ink));
      },
      sandGlow,
      { spill: 0.14 },
    ),
    carved('drum-rune', (t) => (upright(t) ? runePanel(t.uv[0], t.uv[1], { cy: 0.62, hw: 0.33, hh: 0.43, seed: Math.floor(facetHash(t, 9) * 997), glow: 0.6, stroke: 0.04 }) : NO_MOTIF)),
    carved('drum-fret', (t) => (upright(t) ? fretBand(t.uv[0], t.uv[1], { cy: 0.5, cell: 0.4, glow: 0.35 }) : NO_MOTIF)),
    carved('drum-scale', (t) => (upright(t) ? scaleBand(t.uv[0], t.uv[1], { cy: 0.5, cell: 0.26, rows: 3.4, glow: 0.4 }) : NO_MOTIF)),
    plateMat('plate-a', PLATE_YAW[0]!, PLATE_Y[0]!),
    plateMat('plate-b', PLATE_YAW[1]!, PLATE_Y[1]!),
  ],
  build(m) {
    const rng = new Rng('lava_pillar');
    // ---- stepped octagonal plinth
    drum(m, { cx: 0, cz: 0, y0: 0, y1: 0.42, r0: 2.34, r1: 2.28, phase: Math.PI / 8, cb: 0.001, ct: 0.07, jitter: 0.015, seed: 1, mats: { side: SAND, top: RIM } });
    drum(m, { cx: 0, cz: 0, y0: 0.42, y1: 0.86, r0: 2.0, r1: 1.95, phase: Math.PI / 8 + 0.06, cb: 0.05, ct: 0.07, jitter: 0.015, seed: 2, mats: { side: SAND, top: RIM, bot: RIM } });

    // ---- lotus foot: eight petals bulging out of a flared collar
    const petal = (th: number, y: number): number => 1 + 0.2 * Math.max(0, Math.cos(th * 8)) ** 2 * smoothstep(0.92, 1.25, y) * (1 - smoothstep(1.55, 1.95, y));
    m.add(revolve([[1.62, 0.86], [1.74, 0.92], [1.84, 1.06], [1.78, 1.28], [1.6, 1.52], [1.47, 1.76], [1.42, 2.0]], 32, petal), LOTUS, mapCylY(0, 0, 1.7, 1));

    // ---- seven stacked drums
    let ph = 0.12;
    let top = { cx: 0, cz: 0, ph, r: 0.9, y: 10.2 };
    DRUMS.forEach((d, i) => {
      ph += 0.14 + 0.1 * rng.next();
      const cx = (rng.next() - 0.5) * 0.07, cz = (rng.next() - 0.5) * 0.07;
      drum(m, { ...d, cx, cz, phase: ph, cb: 0.06, ct: 0.065, jitter: 0.03, seed: 10 + i, mats: { side: d.mat, top: RIM, bot: RIM, cap: SAND } });
      top = { cx, cz, ph, r: d.r1 - 0.065, y: d.y1 };
    });

    // ---- two crossing ruyi-cloud plates
    const arc: [number, number][] = [];
    for (let a = -105; a <= 105; a += 15) {
      const phi = (a * Math.PI) / 180;
      const u: [number, number] = [Math.cos(phi), Math.sin(phi)];
      let tmax = 0;
      for (const c of RUYI) {
        const dx = c.x - RUYI[0]!.x, dy = c.y;
        const proj = dx * u[0] + dy * u[1];
        const disc = c.r * c.r - (dx * dx + dy * dy - proj * proj);
        if (disc >= 0) tmax = Math.max(tmax, proj + Math.sqrt(disc));
      }
      arc.push([RUYI[0]!.x + u[0] * tmax, u[1] * tmax]);
    }
    const right: [number, number][] = [[0.3, -0.36], [0.8, -0.42], ...arc, [0.8, 0.42], [0.3, 0.36]];
    const left: [number, number][] = [...right].reverse().map(([x, y]) => [-x, y]);
    const plate = extrude([...right, ...left], 0.24, { axis: 'z', z0: -0.12 });
    PLATE_YAW.forEach((yaw, i) => {
      const ux: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
      m.add(plate, i === 0 ? PLATE_A : PLATE_B, mapMetres([0, PLATE_Y[i]!, 0], ux, [0, 1, 0]), m4mul(m4translation([0, PLATE_Y[i]!, 0]), rotYm(yaw)));
    });

    // ---- flared capital: 16-point rings (8 corners lifted into petals, 8 edge midpoints), then the coal bed
    const crown = crownRings(
      [
        { y: top.y, rc: top.r, re: top.r * 0.924 },
        { y: 10.32, rc: 1.02, re: 0.94 },
        { y: 10.52, rc: 1.06, re: 0.97 },
        { y: 10.64, rc: 0.92, re: 0.85 },
        { y: 10.9, rc: 1.1, re: 1.0 },
        { y: 11.14, rc: 1.5, re: 1.2, lc: 0.02 },
        { y: 11.38, rc: 1.95, re: 1.5, lc: 0.12 },
        { y: 11.58, rc: 2.22, re: 1.7, lc: 0.34, le: 0.02 },
        { y: 11.74, rc: 2.34, re: 1.78, lc: 0.6, le: 0.05 },
        { y: 11.82, rc: 2.2, re: 1.7, lc: 0.64, le: 0.08 },
        { y: 11.62, rc: 1.9, re: 1.52, lc: 0.36, le: 0.02 },
        { y: 11.5, rc: 1.5, re: 1.25, lc: 0.08 },
      ],
      8,
      top.ph,
      top.cx,
      top.cz,
    );
    loftRings(m, SAND, mapDrum(top.cx, top.cz, 10.2), crown);
    {
      const floor = crown[crown.length - 1]!;
      const rings: Vec3[][] = [floor];
      const scales = [0.74, 0.48, 0.24];
      for (const s of scales) {
        rings.push(floor.map(([x, y, z]) => [x * s * (0.9 + 0.2 * rng.next()), y + 0.2 * (1 - s) ** 1.2 + (rng.next() - 0.3) * 0.12, z * s * (0.9 + 0.2 * rng.next())] as Vec3));
      }
      const peak: Vec3 = [0, floor[0]![1] + 0.3, 0];
      const mp = mapMetres([0, 0, 0], [1, 0, 0], [0, 0, 1]);
      const tri = (p: Vec3, q: Vec3, r: Vec3): void => {
        const [ua, ub, uc] = mp(p, q, r, [0, 1, 0]);
        m.tri(p, q, r, ua, ub, uc, COALS);
      };
      for (let i = 0; i + 1 < rings.length; i++) {
        const A = rings[i]!, B = rings[i + 1]!;
        for (let k = 0; k < A.length; k++) {
          const a = A[k]!, b = A[(k + 1) % A.length]!, c = B[(k + 1) % B.length]!, d = B[k]!;
          tri(a, b, c);
          tri(a, c, d);
        }
      }
      const last = rings[rings.length - 1]!;
      for (let k = 0; k < last.length; k++) tri(last[k]!, last[(k + 1) % last.length]!, peak);
    }

    // ---- flame finial: a star section twisted and swelled into a carved flame pearl on a lotus stem
    {
      const star: [number, number][] = Array.from({ length: 10 }, (_, i) => [Math.cos((i / 10) * Math.PI * 2) * (i % 2 === 0 ? 0.36 : 0.19), Math.sin((i / 10) * Math.PI * 2) * (i % 2 === 0 ? 0.36 : 0.19)]);
      const path: Vec3[] = Array.from({ length: 9 }, (_, i) => [0, 12.0 + (i / 8) * 1.25, 0]);
      m.add(
        sweepSolid(star, path, { scale: (t) => Math.max(0.03, Math.pow(1 - t, 0.7) * (0.6 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.25)))), twist: (t) => 2.4 * t }),
        FLAME, mapCylY(0, 0, 0.4, 1),
      );
      m.add(revolve([[0.0, 11.7], [0.34, 11.7], [0.4, 11.78], [0.22, 11.92], [0.16, 12.02], [0.0, 12.02]], 12, (th, y) => 1 + 0.12 * Math.max(0, Math.cos(th * 6)) ** 2 * (1 - smoothstep(11.7, 11.95, y))), SAND, mapCylY(0, 0, 0.3, 1));
    }

    // ---- fallen blocks and slag around the plinth
    const rubble: { at: Vec3; r: Vec3; yaw: number; mat: number; seed: string }[] = [
      { at: [1.7, 0, 0.95], r: [0.5, 0.42, 0.45], yaw: 0.4, mat: BASALT, seed: 'r1' },
      { at: [-1.2, 0, 1.55], r: [0.42, 0.34, 0.38], yaw: 1.5, mat: SANDHULL, seed: 'r2' },
      { at: [-1.8, 0, -0.8], r: [0.55, 0.42, 0.48], yaw: 2.2, mat: BASALT, seed: 'r3' },
      { at: [0.7, 0, -1.8], r: [0.46, 0.34, 0.4], yaw: 0.9, mat: SANDHULL, seed: 'r4' },
      { at: [1.5, 0, -1.25], r: [0.3, 0.24, 0.28], yaw: 2.9, mat: BASALT, seed: 'r5' },
    ];
    for (const rb of rubble) {
      const rr = new Rng(`lava_pillar:${rb.seed}`);
      const local = rockPlanes(rr, { r: rb.r, n: 9, jitter: 0.4, cut: [0.72, 1], chips: 2 });
      const xf = m4mul(m4translation([rb.at[0], rb.r[1] * 0.3, rb.at[2]]), m4mul(rotYm(rb.yaw), m4mul(rotX(0.1), rotZ(0.08))));
      addFaces(m, hull([...xfPlanes(local, xf), groundPlane(0)], 8), { mat: rb.mat, skip: [TAG_GROUND], rough: { edge: 0.1, centre: 0.08, seed: 3 } });
    }
  },
};


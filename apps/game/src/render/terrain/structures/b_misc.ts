// Set B, misc: banner_pole (zone-coloured war banner, cloth sways in the wind) and yurt (snow-capped felt tent).
import { Color, Vector3 } from 'three';
import { PAL, TAU, rope, solidPart, vary } from './b_common';
import { MAT, MeshBuilder, V, noise3, smooth } from './b_geom';
import { banner, type GlyphKind } from './b_orc';
import type { StructureBuildContext, StructureModel } from './types';

// ---- banner pole --------------------------------------------------------------------------------------------------

interface BannerLook {
  cloth: string;
  trim: string;
  emblem: GlyphKind;
  emblemColor: string;
}

/** colour by zone: red / orc black-red / frost blue / ember (the system builds one zone at a time) */
const BANNER_LOOKS: Record<string, BannerLook> = {
  yeonmu: { cloth: '#a3221b', trim: PAL.gold, emblem: 'sun', emblemColor: PAL.gold },
  suryeon: { cloth: '#7a1c15', trim: '#1c1613', emblem: 'hand', emblemColor: '#d9cfb3' },
  seori: { cloth: '#3d6ea6', trim: '#e6eef6', emblem: 'sun', emblemColor: '#e6eef6' },
  daeryeol: { cloth: '#a8420f', trim: '#f0a030', emblem: 'sun', emblemColor: '#ffbf48' },
};

function bannerPole(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(51);
  const rng = mb.rng;
  const look = BANNER_LOOKS[ctx.zone] ?? (BANNER_LOOKS.yeonmu as BannerLook);
  const POLE = 6.55;
  // tapered timber pole with a slight lean
  mb.set({ mat: MAT.bark, color: '#7a5a3e', color2: '#473428', blend: 0.4, uvs: 0.9, ao: 0.3, aoH: 0.7, mottle: 0.12 });
  const pts: Vector3[] = [];
  for (let i = 0; i <= 8; i++) pts.push(V(Math.sin(i * 0.8) * 0.015, (i / 8) * POLE, Math.cos(i * 1.1) * 0.012));
  mb.tube(pts, (t) => 0.125 - 0.055 * t, { radial: 8, cap0: 'flat', cap1: 'flat', wobble: (t, a) => 1 + 0.04 * Math.sin(t * 21 + a * 6) });
  // gold-and-red collars
  for (const [y, c] of [
    [0.9, PAL.red],
    [3.6, look.trim],
    [6.0, PAL.red],
  ] as Array<[number, string]>) {
    mb.set({ mat: MAT.plain, color: c, color2: PAL.black, blend: 0.15, ao: 0, mottle: 0.1 });
    const r = 0.125 - 0.055 * (y / POLE) + 0.02;
    mb.scope(() => {
      mb.t(0, y, 0);
      mb.lathe(
        [
          [r - 0.005, 0],
          [r + 0.02, 0.02],
          [r + 0.02, 0.16],
          [r - 0.005, 0.18],
        ],
        { seg: 8 },
      );
    });
  }
  // gilded finial: knop + spearhead
  mb.set({ mat: MAT.plain, color: PAL.gold, color2: PAL.goldDark, blend: 0.35, ao: 0, mottle: 0.15 });
  mb.scope(() => {
    mb.t(0, POLE - 0.02, 0);
    mb.lathe(
      [
        [0.07, 0],
        [0.11, 0.04],
        [0.07, 0.09],
        [0.05, 0.12],
        [0.13, 0.19],
        [0.15, 0.26],
        [0.1, 0.34],
        [0.06, 0.37],
      ],
      { seg: 8, crease: 1.2 },
    );
    mb.t(0, 0.36, 0);
    mb.spike(0.06, 0.5, 6);
  });
  // cross bar with gold end knobs and tassels
  mb.set({ mat: MAT.bark, color: '#6b4e36', color2: '#473428', blend: 0.4, uvs: 0.6, ao: 0 });
  mb.pole(V(-0.95, 6.38, 0.1), V(0.95, 6.38, 0.1), 0.045, 0.045, { radial: 5, lenSeg: 3 });
  mb.pole(V(0, 6.38, 0.0), V(0, 6.38, 0.1), 0.04, 0.04, { radial: 4, lenSeg: 1 });
  mb.set({ mat: MAT.plain, color: PAL.gold, color2: PAL.goldDark, blend: 0.35, ao: 0 });
  for (const sx of [-1, 1]) {
    mb.scope(() => {
      mb.t(sx * 0.98, 6.38, 0.1);
      mb.blob(0.07, 0.07, 0.07, { seg: 6, rings: 4, lump: 0.05 });
    });
    mb.set({ mat: MAT.cloth, color: PAL.red, color2: PAL.redDark, blend: 0.3, ao: 0, swayFn: (_x, y) => Math.min(1, Math.max(0, (6.38 - y) / 0.5)) * 0.6 });
    rope(mb, [V(sx * 0.9, 6.36, 0.1), V(sx * 0.9, 6.15, 0.1), V(sx * 0.9, 5.95, 0.1)], 0.012);
    mb.set({ mat: MAT.plain, color: PAL.gold, color2: PAL.goldDark, blend: 0.35, ao: 0, swayFn: null });
  }
  // the war banner
  mb.scope(() => {
    mb.t(0, 6.36, 0.14);
    banner(mb, { w: 1.5, h: 3.7, tail: 0.18, cloth: look.cloth, trim: look.trim, emblem: look.emblem, emblemColor: look.emblemColor, swayTop: 0.04, ragged: ctx.zone === 'suryeon' });
  });
  // stone footing
  mb.set({ mat: MAT.stone, color: PAL.stone, color2: PAL.moss, blend: 0.4, ao: 0.35, aoH: 0.3, uvs: 0.9 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + rng() * 0.3;
    const r = 0.2 + rng() * 0.04;
    mb.scope(() => {
      mb.t(Math.cos(a) * r, 0.07, Math.sin(a) * r).ry(rng() * TAU);
      mb.set({ color: vary(PAL.stone, rng, 0.15) });
      mb.blob(0.12 + rng() * 0.05, 0.1 + rng() * 0.04, 0.12 + rng() * 0.05, { seg: 6, rings: 3, lump: 0.2, seedOffset: i });
    });
  }
  return { parts: [solidPart(mb, ctx, { roughness: 0.8, doubleSided: true, sway: true, detail: [0.8, 0.8, 0.7, 0.55] })] };
}

// ---- yurt ---------------------------------------------------------------------------------------------------------

function yurt(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(52);
  const rng = mb.rng;
  const FELT = '#cdc3ae';
  const wallProf: Array<[number, number]> = [
    [3.2, 0],
    [3.3, 0.18],
    [3.3, 1.4],
    [3.24, 1.58],
  ];
  const domeProf: Array<[number, number]> = [
    [3.42, 1.55],
    [3.3, 1.92],
    [2.85, 2.36],
    [2.25, 2.8],
    [1.55, 3.18],
    [0.95, 3.44],
    [0.62, 3.54],
  ];
  // felt wall with seams between panels, dome roof with radial ribs
  mb.set({ mat: MAT.cloth, color: FELT, color2: '#8f8878', blend: 0.45, mottle: 0.12, mottleFreq: 1.1, uvs: 1.1, ao: 0.4, aoH: 0.7 });
  mb.lathe(wallProf, { seg: 32, crease: 1.4, rad: (a) => 1 - 0.012 * (1 - Math.abs(Math.sin(a * Math.PI * 8))) });
  mb.set({ color: '#d4cbb8', blend: 0.4, ao: 0 });
  mb.lathe(domeProf, { seg: 32, crease: 2, rad: (a) => 1 + 0.014 * Math.cos(a * TAU * 16), shade: (_a, i) => 0.85 + 0.15 * (i / 6) });
  // painted bands around the wall (teal + red) with a cream zigzag
  mb.set({ mat: MAT.cloth, color: '#3d7380', color2: '#2d5560', blend: 0.4, ao: 0, mottle: 0.14 });
  mb.lathe(
    [
      [3.3 + 0.012, 1.1],
      [3.3 + 0.022, 1.2],
      [3.3 + 0.022, 1.36],
      [3.3 + 0.012, 1.46],
    ],
    { seg: 32, crease: 2 },
  );
  mb.set({ color: '#9a2f24', color2: '#6e1f18' });
  mb.lathe(
    [
      [3.3 + 0.012, 0.78],
      [3.3 + 0.022, 0.84],
      [3.3 + 0.022, 0.96],
      [3.3 + 0.012, 1.02],
    ],
    { seg: 32, crease: 2 },
  );
  mb.scope(() => {
    mb.set({ mat: MAT.plain, color: '#e9dcc0', ao: 0 });
    const zz: Vector3[] = [];
    const nz: Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const th = (i / 48) * TAU;
      const y = 1.28 + (i % 2 === 0 ? -0.05 : 0.05);
      zz.push(V(Math.cos(th) * 3.34, y, Math.sin(th) * 3.34));
      nz.push(V(Math.cos(th), 0, Math.sin(th)));
    }
    mb.stroke(zz, nz, 0.035, { lift: 0 });
  });
  // rope bands tying the felt
  mb.set({ mat: MAT.cloth, color: '#a58f66', color2: '#6f5d3e', blend: 0.3, ao: 0, mottle: 0.1 });
  for (const [y, r] of [
    [1.68, 3.34],
    [2.55, 2.64],
  ] as Array<[number, number]>) {
    mb.scope(() => {
      mb.t(0, y, 0);
      mb.lathe(
        [
          [r, -0.03],
          [r + 0.045, 0],
          [r, 0.03],
        ],
        { seg: 32 },
      );
    });
  }
  // snow cap with a ragged lower edge + drifts at the foot
  const dome = (s: number): [number, number] => {
    // s = 0 at the crown, 1 at the eave
    const f = (1 - s) * (domeProf.length - 1);
    const i = Math.min(domeProf.length - 2, Math.floor(f));
    const k = f - i;
    const a = domeProf[i] as [number, number];
    const b = domeProf[i + 1] as [number, number];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  mb.set({ mat: MAT.plain, color: PAL.snow, color2: PAL.snowShade, blend: 0.5, mottle: 0.06, mottleFreq: 2, ao: 0, jitter: 0.02 });
  mb.surface(
    32,
    5,
    (u, v, p) => {
      const th = u * TAU;
      const reach = 0.5 + 0.2 * noise3(Math.cos(th) * 1.6 + 5, Math.sin(th) * 1.6 + 5, 3, 7) + 0.07 * Math.sin(u * TAU * 11);
      const s = v * reach;
      const [r0, y] = dome(s);
      const r = r0 * 1.0 + 0.05 + 0.06 * Math.sin(Math.PI * v);
      p.x = Math.cos(th) * r;
      p.y = y + 0.04 + 0.04 * Math.sin(Math.PI * v);
      p.z = Math.sin(th) * r;
      p.m = 1 - 0.1 * v;
      p.k = v > 0.8 ? 0.4 : 0;
    },
    { wrapU: true },
  );
  mb.lathe(
    [
      [3.15, 0],
      [3.4, 0.05],
      [3.54, 0.15],
      [3.46, 0.28],
      [3.36, 0.38],
      [3.28, 0.44],
    ],
    { seg: 32, crease: 2, rad: (a, i) => 1 + (i > 0 ? 0.16 * (noise3(Math.cos(a * TAU) * 2.2 + 9, Math.sin(a * TAU) * 2.2, i * 0.6, 4) - 0.5) : 0) },
  );
  // timber door frame, lattice door, rolled felt flap
  mb.set({ mat: MAT.wood, color: '#6d4f36', color2: '#43301f', blend: 0.4, uvs: 0.6, ao: 0.2, aoH: 0.4 });
  for (const sx of [-1, 1]) {
    mb.scope(() => {
      mb.t(sx * 0.58, 0.9, 3.33);
      mb.box(0.15, 1.8, 0.18, { soft: 0.3 });
    });
  }
  mb.scope(() => {
    mb.t(0, 1.82, 3.33);
    mb.box(1.45, 0.17, 0.2, { soft: 0.3 });
  });
  mb.set({ mat: MAT.plain, color: '#17110c', color2: '#2c2016', blend: 0.4, ao: 0 });
  mb.scope(() => {
    mb.t(0, 0.88, 3.24);
    mb.box(1.02, 1.76, 0.03);
  });
  mb.set({ mat: MAT.wood, color: '#8a6945', color2: '#5b4128', blend: 0.3, ao: 0, uvs: 0.4 });
  for (let i = 0; i < 5; i++) {
    for (const s of [1, -1]) {
      mb.scope(() => {
        mb.t(-0.4 + i * 0.2, 0.88, 3.36).rz(s * 0.52);
        mb.box(0.035, 1.65, 0.035);
      });
    }
  }
  mb.set({ mat: MAT.cloth, color: '#bdb39b', color2: '#7f7867', blend: 0.4, ao: 0 });
  mb.tube([V(-0.62, 1.98, 3.4), V(0, 1.99, 3.42), V(0.62, 1.98, 3.4)], 0.1, { radial: 5, cap0: 'flat', cap1: 'flat', wobble: (t, a) => 1 + 0.06 * Math.sin(t * 9 + a * 4) });
  mb.set({ mat: MAT.cloth, color: PAL.rope, color2: PAL.ropeDark, blend: 0.3, ao: 0 });
  for (const sx of [-0.42, 0.42]) rope(mb, [V(sx, 2.08, 3.4), V(sx + 0.01, 1.98, 3.43), V(sx, 1.88, 3.4)], 0.016);
  // crown ring, spokes seen through the smoke hole, stovepipe with a snowy hat
  mb.set({ mat: MAT.wood, color: '#6d4f36', color2: '#43301f', blend: 0.4, uvs: 0.6, ao: 0 });
  mb.lathe(
    [
      [0.55, 3.5],
      [0.72, 3.54],
      [0.72, 3.68],
      [0.56, 3.7],
    ],
    { seg: 24, crease: 1.2 },
  );
  mb.set({ mat: MAT.plain, color: '#16110d', ao: 0 });
  mb.disc(0.56, 3.46, 1, 12);
  mb.set({ mat: MAT.plain, color: '#3a3a40', color2: '#6b3b24', blend: 0.45, ao: 0, mottle: 0.2 });
  mb.pole(V(0.08, 3.5, 0), V(0.05, 4.22, 0), 0.1, 0.085, { radial: 6, lenSeg: 2 });
  mb.scope(() => {
    mb.t(0.05, 4.1, 0);
    mb.lathe(
      [
        [0.16, 0],
        [0.2, 0.02],
        [0.0, 0.17],
      ],
      { seg: 8, crease: 2 },
    );
  });
  mb.set({ mat: MAT.plain, color: PAL.snow, color2: PAL.snowShade, blend: 0.4, ao: 0 });
  mb.scope(() => {
    mb.t(0.05, 4.2, 0);
    mb.blob(0.14, 0.05, 0.14, { seg: 6, rings: 3, lump: 0.1 });
  });
  void [smooth, Color];
  return { parts: [solidPart(mb, ctx, { roughness: 0.92, detail: [0.8, 0.8, 0.5, 0.7] })] };
}

export const MISC_DEFS = {
  banner_pole: { build: bannerPole, textures: ['tex_bark_oak', 'tex_rock_mossy'] },
  yurt: { build: yurt, textures: ['tex_wood_plank'] },
};

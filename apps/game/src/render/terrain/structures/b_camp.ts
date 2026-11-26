// Set B, orc camp: orc_tent, watchtower, totem, weapon_rack, bonfire. Prop-local space, ground at y = 0, +Z front.
import { Vector3 } from 'three';
import { PAL, TAU, rope, solidPart, vary } from './b_common';
import { MAT, MeshBuilder, V } from './b_geom';
import { banner, glyph, horn, patch, skull, strokeUV, type GlyphKind, type Surf } from './b_orc';
import type { StructureBuildContext, StructureModel } from './types';

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---- orc tent -----------------------------------------------------------------------------------------------------

function orcTent(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(21);
  const rng = mb.rng;
  const N = 10;
  const R0 = 2.5;
  const TOP = 3.0;
  const RT = 0.38;
  const dTh = TAU / N;
  /** pole k stands at angle (k - 0.5)·dTh from +Z, so panel 0 is centred on the entrance */
  const poleAng = (k: number): number => (k - 0.5) * dTh;
  const coneR = (y: number): number => RT + (R0 - RT) * Math.pow(Math.max(0, Math.cos((y / TOP) * Math.PI * 0.5)), 0.9);
  const hemY = (u: number): number => 0.05 + 0.3 * Math.pow(Math.sin(Math.PI * u), 0.8);
  const sag = (u: number, v: number): number => 0.17 * Math.sin(Math.PI * u) * (1 - 0.45 * v);
  const gap = (v: number): number => (v < 0.62 ? 0.86 * (1 - v / 0.62) : 0);

  const panelAt = (k: number, u: number, v: number, lift = 0, inset = 0): Vector3 => {
    const y = hemY(u) + v * (TOP - hemY(u));
    const r = coneR(y) - sag(u, v) + lift - inset;
    const th = poleAng(k) + u * dTh;
    return V(Math.sin(th) * r, y, Math.cos(th) * r);
  };
  const panelSurf = (k: number): Surf => ({
    pos: (u, v, lift) => panelAt(k, u, v, lift),
    nrm: (u, _v) => {
      const th = poleAng(k) + u * dTh;
      return V(Math.sin(th), 0.55, Math.cos(th)).normalize();
    },
  });

  // ---- hide panels -------------------------------------------------------------------------------------------
  const hides = ['#c29c6a', '#b79364', '#cba776', '#aa9370', '#bd8a5e', '#cfb386', '#b08a68', '#c4a278'];
  for (let k = 0; k < N; k++) {
    const base = vary(hides[k % hides.length] as string, rng, 0.06);
    mb.set({ mat: MAT.cloth, color: base, color2: PAL.hideDark, blend: 0.45, mottle: 0.14, mottleFreq: 1.4, jitter: 0.04, uvs: 0.9, ao: 0.3, aoH: 0.45 });
    const shade = (v: number): number => (0.86 + 0.16 * smoothstep(0, 0.4, v)) * (1 - 0.3 * smoothstep(0.84, 1, v));
    if (k === 0) {
      // entrance: two halves pulled apart, leaving a pointed opening
      for (const half of [0, 1]) {
        mb.surface(
          3,
          5,
          (uu, v, p) => {
            const span = 0.5 * (1 - gap(v));
            const u = half === 0 ? uu * span : 1 - uu * span;
            const q = panelAt(0, u, v);
            p.x = q.x;
            p.y = q.y;
            p.z = q.z;
            p.m = shade(v) * (0.82 + 0.2 * uu);
            p.sw = 0.3 * uu * (1 - v) * (v < 0.62 ? 1 : 0);
            p.u = (half === 0 ? u : 1 - u) * 2;
            p.v = v * 3;
          },
          { flip: half === 1 },
        );
      }
      // dark interior seen through the opening
      mb.set({ mat: MAT.plain, color: '#3b2512', color2: '#5e3a1d', blend: 0.5, ao: 0, mottle: 0.2 });
      mb.surface(
        3,
        3,
        (u, v, p) => {
          const q = panelAt(0, u, v * 0.7, 0, 0.16);
          p.x = q.x;
          p.y = q.y;
          p.z = q.z;
          p.m = 0.75 + 0.5 * v;
          p.sw = 0;
        },
        {},
      );
    } else {
      mb.surface(4, 5, (u, v, p) => {
        const q = panelAt(k, u, v);
        p.x = q.x;
        p.y = q.y;
        p.z = q.z;
        p.m = shade(v) * (0.9 + 0.1 * Math.sin(u * Math.PI));
        p.sw = 0;
        p.u = u * 1.4;
        p.v = v * 3;
      });
    }
  }

  // ---- patches, stitched seams, painted marks -----------------------------------------------------------------
  const patchSpots: Array<[number, number, number]> = [
    [1, 0.45, 0.3],
    [2, 0.6, 0.55],
    [3, 0.35, 0.2],
    [4, 0.5, 0.66],
    [5, 0.4, 0.4],
    [6, 0.6, 0.28],
    [7, 0.5, 0.58],
  ];
  for (const [k, u, v] of patchSpots) {
    const w = 0.12 + rng() * 0.06;
    const h = 0.045 + rng() * 0.03;
    patch(mb, panelSurf(k), u - w, v - h, u + w, v + h, vary(hides[(k + 3) % hides.length] as string, rng, 0.1).multiplyScalar(0.82));
  }
  const gl = (k: number, kind: GlyphKind, u: number, v: number, size: number, color: string, width: number): void => {
    const y = hemY(u) + v * (TOP - hemY(u));
    const du = size / 2 / (dTh * coneR(y));
    const dv = size / 2 / (TOP - 0.3);
    glyph(mb, panelSurf(k), kind, u, v, du, dv, color, width);
  };
  gl(2, 'sun', 0.5, 0.36, 0.95, PAL.red, 0.065);
  gl(4, 'hand', 0.5, 0.34, 0.85, PAL.red, 0.06);
  gl(5, 'zig', 0.5, 0.16, 1.0, PAL.black, 0.07);
  gl(6, 'eye', 0.5, 0.44, 0.9, PAL.red, 0.055);
  gl(8, 'tally', 0.5, 0.3, 0.8, PAL.black, 0.055);
  gl(9, 'zig', 0.55, 0.72, 0.6, PAL.red, 0.05);
  gl(7, 'zig', 0.5, 0.1, 0.9, PAL.red, 0.06);
  // red + black paint bands around the hem and the smoke hole
  const band = (v: number, width: number, color: string, zig = 0): void => {
    for (let k = 0; k < N; k++) {
      const uMax = k === 0 ? 0.5 * (1 - gap(v)) * 0.92 : 1;
      const pieces: Array<[number, number]> = k === 0 ? [[0, uMax], [1 - uMax, 1]] : [[0, 1]];
      for (const [ua, ub] of pieces) {
        const pts: Array<[number, number]> = [];
        const n = zig ? 6 : 3;
        for (let i = 0; i <= n; i++) pts.push([ua + (ub - ua) * (i / n), v + (zig ? (i % 2 ? zig : -zig) : 0)]);
        mb.scope(() => {
          mb.set({ mat: MAT.plain, color, ao: 0, mottle: 0.1, jitter: 0.03 });
          strokeUV(mb, panelSurf(k), pts, width, 0.02);
        });
      }
    }
  };
  band(0.075, 0.2, PAL.red);
  band(0.175, 0.05, PAL.black, 0.02);
  band(0.94, 0.1, PAL.red);

  // ---- bone teeth hanging from the hem ------------------------------------------------------------------------
  mb.set({ mat: MAT.stone, color: PAL.bone, color2: PAL.boneDark, blend: 0.4, ao: 0, uvs: 0.3 });
  for (let k = 0; k < N; k++) {
    for (const u of k === 0 ? [0.04, 0.96] : [0.2, 0.5, 0.8]) {
      const b = panelAt(k, u, 0, 0.02);
      b.y += 0.02;
      mb.blade(b, b.clone().add(V(0, -0.15 - rng() * 0.05, 0)), 0.026, 0.008, { mBase: 1, mTip: 0.85 });
    }
  }

  // ---- timber poles, lashed ----------------------------------------------------------------------------------
  const tipAt: Vector3[] = [];
  for (let k = 0; k < N; k++) {
    const th = poleAng(k);
    const ext = 0.45 + rng() * 0.4;
    const pts: Vector3[] = [];
    const len = TOP + ext;
    for (let i = 0; i <= 5; i++) {
      const y = (i / 5) * len;
      const r = (y <= TOP ? coneR(y) : RT - (y - TOP) * 0.9) + 0.075;
      const w = Math.sin(i * 1.7 + k * 3.1) * 0.012;
      pts.push(V(Math.sin(th) * r + Math.cos(th) * w, y, Math.cos(th) * r - Math.sin(th) * w));
    }
    tipAt.push(pts[pts.length - 1] as Vector3);
    mb.set({ mat: MAT.bark, color: vary('#5c4636', rng, 0.12), color2: '#3a2c22', blend: 0.4, uvs: 0.7, ao: 0.35, aoH: 0.4, mottle: 0.12 });
    mb.tube(pts, (t) => 0.1 - 0.05 * t, {
      radial: 5,
      cap0: 'flat',
      cap1: 'flat',
      wobble: (t, a) => 1 + 0.07 * Math.sin(t * 17 + a * 5 + k),
    });
    // rope lashing: a short helix around every other pole and the door posts
    if (k % 2 === 1 || k === 0) {
      mb.set({ mat: MAT.cloth, color: PAL.rope, color2: PAL.ropeDark, blend: 0.3, ao: 0, mottle: 0.1 });
      const pa = pts[2] as Vector3;
      const pb = pts[3] as Vector3;
      const axis = pb.clone().sub(pa).normalize();
      const e1 = new Vector3().crossVectors(axis, V(0, 0, 1).applyAxisAngle(V(0, 1, 0), th)).normalize();
      const e2 = new Vector3().crossVectors(axis, e1);
      const helix: Vector3[] = [];
      for (let i = 0; i <= 4; i++) {
        const a = (i / 4) * TAU * 1.25;
        helix.push(pa.clone().addScaledVector(axis, (i / 4) * 0.12).addScaledVector(e1, Math.cos(a) * 0.1).addScaledVector(e2, Math.sin(a) * 0.1));
      }
      mb.tube(helix, 0.014, { radial: 3, cap0: 'flat', cap1: 'flat' });
    }
  }
  // bundle lashing at the top where the poles cross
  mb.set({ mat: MAT.cloth, color: PAL.rope, color2: PAL.ropeDark, blend: 0.3, ao: 0 });
  const bundle: Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * TAU * 2;
    bundle.push(V(Math.cos(a) * 0.22, TOP + 0.12 + (i / 12) * 0.12, Math.sin(a) * 0.22));
  }
  mb.tube(bundle, 0.025, { radial: 3, cap0: 'flat', cap1: 'flat', shade: (t) => 0.85 + 0.2 * Math.sin(t * 90) });

  // smoke hole: sooty rim seen from above
  mb.set({ mat: MAT.plain, color: '#1a120d', ao: 0, mottle: 0.2 });
  mb.disc(RT + 0.02, TOP - 0.2, 1, 10);

  // ---- door lintel with a horned skull ---------------------------------------------------------------------
  const lz = coneR(1.95) + 0.12;
  mb.set({ mat: MAT.bark, color: '#5a4332', color2: '#3a2c22', blend: 0.4, uvs: 0.7, ao: 0 });
  mb.pole(V(-0.62, 1.96, lz - 0.02), V(0.62, 1.96, lz - 0.02), 0.075, 0.075, { radial: 6, lenSeg: 3 });
  mb.scope(() => {
    mb.t(0, 2.12, lz + 0.02).rx(-0.18);
    skull(mb, { scale: 1.5, horns: true });
  });
  // a skull on a stick above the smoke hole
  const top = tipAt[0] as Vector3;
  mb.scope(() => {
    mb.t(top.x, top.y - 0.02, top.z).rx(-0.15);
    skull(mb, { scale: 1.15, horns: true });
  });
  mb.set({ mat: MAT.stone, color: PAL.boneDark, color2: PAL.bone, blend: 0.4, ao: 0 });
  for (const k of [3, 6, 8]) {
    const tp = tipAt[k] as Vector3;
    mb.scope(() => {
      mb.t(tp.x, tp.y - 0.05, tp.z);
      horn(mb, { len: 0.34, r: 0.035, side: tp.x >= 0 ? 1 : -1, curl: 1.5, base: 1.2, seg: 5 });
    });
  }
  // red streamers fluttering from pole tips
  for (const k of [1, 5, 7]) {
    const tp = tipAt[k] as Vector3;
    mb.scope(() => {
      mb.t(tp.x, tp.y - 0.1, tp.z).ry(poleAng(k));
      banner(mb, { w: 0.2, h: 0.95, tail: 0.3, cloth: k === 5 ? PAL.black : PAL.red, trim: PAL.rope, swayTop: 0.15, ragged: true });
    });
  }
  return { parts: [solidPart(mb, ctx, { roughness: 0.9, doubleSided: true, sway: true, detail: [0.9, 0.8, 0.6, 0.75] })] };
}

// ---- watchtower ---------------------------------------------------------------------------------------------------

function watchtower(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(22);
  const rng = mb.rng;
  const DECK = 6.1;
  const RED = '#b0281d';
  const BLK = '#2c2724';
  const ROOF = 7.35;
  const TOPY = 9.0;
  const legAt = (sx: number, sz: number, y: number): Vector3 => {
    const k = 1.3 - 0.5 * (y / ROOF);
    return V(sx * k, y, sz * k);
  };
  const corners: Array<[number, number]> = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  // splayed log legs
  mb.set({ mat: MAT.bark, color: '#7a6048', color2: '#4a3a2c', blend: 0.4, uvs: 0.8, ao: 0.25, aoH: 0.6, mottle: 0.12 });
  for (const [sx, sz] of corners) mb.pole(legAt(sx, sz, 0), legAt(sx, sz, ROOF), 0.2, 0.14, { radial: 6, lenSeg: 6, bend: 0.03 });
  // cross-bracing: horizontal ties on three levels, diagonals in the two lower bays
  const levels = [1.5, 3.3, 5.0];
  mb.set({ color: '#85694f', color2: '#4a3a2c', blend: 0.4, ao: 0.2, aoH: 0.6 });
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i] as [number, number];
    const [bx, bz] = corners[(i + 1) % 4] as [number, number];
    for (const y of levels) mb.pole(legAt(ax, az, y), legAt(bx, bz, y), 0.085, 0.085, { radial: 5, lenSeg: 1 });
    for (let b = 0; b < 2; b++) {
      const flip = (i + b) % 2 === 0;
      const y0 = levels[b] as number;
      const y1 = levels[b + 1] as number;
      mb.pole(flip ? legAt(ax, az, y0) : legAt(bx, bz, y0), flip ? legAt(bx, bz, y1) : legAt(ax, az, y1), 0.06, 0.06, { radial: 4, lenSeg: 1 });
    }
  }
  // rope lashings where the ties meet the legs
  mb.set({ mat: MAT.cloth, color: PAL.rope, color2: PAL.ropeDark, blend: 0.3, ao: 0 });
  for (const [sx, sz] of corners) {
    for (const y of [levels[0] as number, levels[2] as number]) {
      mb.scope(() => {
        const p = legAt(sx, sz, y);
        mb.t(p.x, y - 0.06, p.z);
        const lr = 0.2 - 0.06 * (y / ROOF);
        mb.lathe(
          [
            [lr + 0.015, 0],
            [lr + 0.04, 0.06],
            [lr + 0.015, 0.12],
          ],
          { seg: 6 },
        );
      });
    }
  }
  // plank deck on joists
  mb.set({ mat: MAT.wood, color: PAL.woodMid, color2: PAL.woodDark, blend: 0.3, uvs: 0.8, ao: 0.2, aoH: 0.3 });
  for (const z of [-0.9, 0, 0.9]) {
    mb.scope(() => {
      mb.t(0, DECK - 0.13, z);
      mb.set({ color: '#5a4332' });
      mb.box(2.9, 0.16, 0.16, { soft: 0.25 });
    });
  }
  for (let i = 0; i < 12; i++) {
    mb.scope(() => {
      mb.t(-1.24 + i * 0.226, DECK + (rng() - 0.5) * 0.012, (rng() - 0.5) * 0.04).ry((rng() - 0.5) * 0.01);
      mb.set({ color: vary('#8d673f', rng, 0.14) });
      mb.box(0.215, 0.1, 2.7, { soft: 0.3, grain: 'z' });
    });
  }
  // railing: posts + two rails, front rails open for the ladder
  mb.set({ mat: MAT.bark, color: '#6a5242', color2: '#3b2d22', blend: 0.4, uvs: 0.6, ao: 0 });
  const P = 1.26;
  const posts: Array<[number, number]> = [
    [P, P],
    [-P, P],
    [-P, -P],
    [P, -P],
    [0, -P],
    [-P, 0],
    [P, 0],
    [0.55, P],
    [-0.55, P],
  ];
  for (const [x, z] of posts) mb.pole(V(x, DECK + 0.03, z), V(x + (rng() - 0.5) * 0.04, DECK + 1.2, z), 0.058, 0.05, { radial: 5, lenSeg: 1 });
  const rail = (x0: number, z0: number, x1: number, z1: number): void => {
    for (const h of [0.5, 1.0]) mb.pole(V(x0, DECK + h, z0), V(x1, DECK + h + (rng() - 0.5) * 0.03, z1), 0.04, 0.04, { radial: 4, lenSeg: 1 });
  };
  rail(P, P, P, -P);
  rail(-P, P, -P, -P);
  rail(P, -P, -P, -P);
  rail(P, P, 0.55, P);
  rail(-0.55, P, -P, P);
  // painted war shields hung on the front rails
  for (const [x, red] of [
    [0.9, true],
    [-0.9, false],
    [1.26, false],
  ] as Array<[number, boolean]>) {
    mb.scope(() => {
      mb.t(x === 1.26 ? 1.32 : x, DECK + 0.7, x === 1.26 ? 0.3 : 1.32);
      if (x === 1.26) mb.ry(Math.PI / 2);
      mb.rx(Math.PI / 2);
      mb.set({ mat: MAT.wood, color: red ? '#7a5030' : '#5b4331', color2: PAL.woodDark, blend: 0.35, uvs: 0.7, ao: 0 });
      mb.lathe(
        [
          [0.0, 0.05],
          [0.14, 0.055],
          [0.31, 0.01],
          [0.33, -0.015],
          [0.31, -0.04],
          [0.0, -0.04],
        ],
        { seg: 10, crease: 1.2 },
      );
      mb.set({ mat: MAT.plain, color: red ? PAL.red : PAL.black, ao: 0 });
      mb.stroke([V(-0.26, 0.07, -0.26), V(0, 0.07, 0), V(0.26, 0.07, 0.26)], [V(0, 1, 0), V(0, 1, 0), V(0, 1, 0)], 0.07, { lift: 0 });
      mb.stroke([V(0.26, 0.07, -0.26), V(0, 0.07, 0), V(-0.26, 0.07, 0.26)], [V(0, 1, 0), V(0, 1, 0), V(0, 1, 0)], 0.07, { lift: 0 });
      mb.set({ mat: MAT.plain, color: PAL.iron, color2: PAL.ironLight, blend: 0.4, ao: 0 });
      mb.scope(() => {
        mb.t(0, 0.05, 0);
        mb.lathe(
          [
            [0.11, 0],
            [0.1, 0.03],
            [0.05, 0.075],
            [0, 0.085],
          ],
          { seg: 8 },
        );
      });
    });
  }
  // four roof posts
  mb.set({ mat: MAT.bark, color: '#5d4838', color2: '#3b2d22', blend: 0.4, uvs: 0.8 });
  for (const [sx, sz] of corners) mb.pole(V(sx * 1.05, DECK, sz * 1.05), V(sx * 1.0, ROOF + 0.05, sz * 1.0), 0.075, 0.065, { radial: 5, lenSeg: 2 });
  // pyramid hide roof with scalloped eaves
  const hides = ['#b08a5c', '#a2704a', '#bf9d6c', '#a38663'];
  for (let f = 0; f < 4; f++) {
    mb.scope(() => {
      mb.ry((f * Math.PI) / 2);
      mb.set({ mat: MAT.cloth, color: vary(hides[f] as string, rng, 0.05), color2: PAL.hideDark, blend: 0.45, mottle: 0.14, uvs: 0.9, ao: 0 });
      const roofPos = (u: number, v: number, lift: number): Vector3 => {
        const ex = -2.0 + 4.0 * u;
        const droop = -0.1 * (1 - Math.sin(Math.PI * u));
        const hemLift = 0.16 * Math.sin(Math.PI * u) * Math.sin(Math.PI * u);
        const y = ROOF + (droop + hemLift) * (1 - v) + (TOPY - ROOF) * Math.pow(v, 1.3);
        const z = 2.0 * (1 - v) - 0.12 * Math.sin(Math.PI * u) * (1 - v) + lift;
        return V(ex * (1 - v), y + lift * 0.55, z);
      };
      mb.surface(6, 4, (u, v, p) => {
        const q = roofPos(u, v, 0);
        p.x = q.x;
        p.y = q.y;
        p.z = q.z;
        p.m = 0.8 + 0.25 * v + 0.07 * Math.sin(u * 20);
        p.u = u * 4.4;
        p.v = v * 2.2;
      });
      const surf: Surf = { pos: roofPos, nrm: () => V(0, 0.6, 0.8).normalize() };
      glyph(mb, surf, (['sun', 'hand', 'zig', 'eye'] as const)[f] ?? 'sun', 0.5, 0.42, 0.14, 0.14, PAL.red, 0.07);
      mb.set({ mat: MAT.plain, color: PAL.red, ao: 0 });
      strokeUV(
        mb,
        surf,
        [0.04, 0.2, 0.36, 0.5, 0.64, 0.8, 0.96].map((u): [number, number] => [u, 0.06]),
        0.2,
        0.02,
      );
      mb.set({ mat: MAT.stone, color: PAL.bone, color2: PAL.boneDark, blend: 0.4, ao: 0, uvs: 0.3 });
      for (const u of [0.18, 0.5, 0.82]) {
        const b = roofPos(u, 0, 0.02);
        mb.blade(b, b.clone().add(V(0, -0.2, 0)), 0.03, 0.01, {});
      }
    });
  }
  // apex spike with a pennant
  mb.set({ mat: MAT.bark, color: '#4d3b2e', color2: '#2e231b', blend: 0.4, uvs: 0.6 });
  mb.pole(V(0, ROOF + 0.4, 0), V(0, TOPY + 0.35, 0), 0.06, 0.03, { radial: 5, lenSeg: 2 });
  mb.scope(() => {
    mb.t(0.0, TOPY - 0.3, 0.04);
    banner(mb, { w: 0.5, h: 1.1, tail: 0.3, cloth: BLK, trim: PAL.red, emblem: 'sun', emblemColor: '#c0301f', swayTop: 0.1 });
  });
  // banners hung from the front eave corners
  for (const [x, cloth] of [
    [-1.5, RED],
    [1.5, BLK],
  ] as Array<[number, string]>) {
    mb.scope(() => {
      mb.t(x, ROOF - 0.1, 1.85);
      banner(mb, { w: 0.8, h: 2.1, tail: 0.22, cloth, trim: PAL.gold, emblem: cloth === RED ? 'hand' : 'sun', emblemColor: cloth === RED ? BLK : '#c0301f', swayTop: 0.12, ragged: true });
    });
  }
  // rope ladder on the front
  mb.set({ mat: MAT.cloth, color: PAL.rope, color2: PAL.ropeDark, blend: 0.3, ao: 0 });
  const lad = (t: number, side: number): Vector3 => V(side * 0.3, DECK - 0.1 - t * (DECK - 0.1), 1.3 + t * 0.9);
  for (const side of [-1, 1]) rope(mb, [0, 0.33, 0.66, 1].map((t) => lad(t, side)), 0.022);
  mb.set({ mat: MAT.wood, color: '#8a6a45', color2: PAL.woodDark, blend: 0.3, ao: 0.1, aoH: 0.4 });
  for (let i = 1; i <= 13; i++) {
    const t = i / 14;
    const c = lad(t, 0);
    mb.scope(() => {
      mb.t(c.x, c.y, c.z).rx(0.15);
      mb.box(0.66, 0.038, 0.04, { soft: 0.3 });
    });
  }
  return { parts: [solidPart(mb, ctx, { roughness: 0.9, doubleSided: true, sway: true, detail: [0.9, 0.8, 0.6, 0.75] })] };
}

export const CAMP_DEFS = {
  orc_tent: { build: orcTent, textures: ['tex_wood_plank', 'tex_bark_oak', 'tex_rock_mossy'] },
  watchtower: { build: watchtower, textures: ['tex_wood_plank', 'tex_bark_oak'] },
};

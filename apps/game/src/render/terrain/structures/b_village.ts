// Set B, village props: barrel, crate, urn, haystack, signpost, well. Prop-local space, ground at y = 0, +Z front.
import { Color, Vector3 } from 'three';
import { PAL, TAU, rope, roundedLoop, solidPart, vary } from './b_common';
import { MAT, MeshBuilder, V, noise3 } from './b_geom';
import type { StructureBuildContext, StructureModel } from './types';

const hash1 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** linear interpolation of a lathe profile's radius at height y */
function radiusAt(prof: ReadonlyArray<readonly [number, number]>, y: number): number {
  for (let i = 1; i < prof.length; i++) {
    const a = prof[i - 1] as readonly [number, number];
    const b = prof[i] as readonly [number, number];
    if (y <= b[1] && b[1] > a[1]) return a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
  }
  return (prof[prof.length - 1] as readonly [number, number])[0];
}

// ---- barrel -------------------------------------------------------------------------------------------------------

const BARREL_PROFILE: Array<[number, number]> = [
  [0.33, 0],
  [0.36, 0.02],
  [0.405, 0.2],
  [0.44, 0.4],
  [0.45, 0.5],
  [0.44, 0.6],
  [0.405, 0.8],
  [0.37, 0.98],
  [0.365, 1.0],
  [0.33, 1.0],
  [0.325, 0.96],
];

function barrel(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(11);
  mb.set({ mat: MAT.wood, color: '#8b6339', color2: PAL.woodDark, blend: 0.3, uvs: 0.9, ao: 0.32, aoH: 0.3, mottle: 0.12 });
  mb.lathe(BARREL_PROFILE, {
    seg: 20,
    rad: (a) => 1 - 0.014 * (1 - Math.abs(Math.sin(a * Math.PI * 10))),
    shade: (a) => {
      const k = Math.round(a * 20);
      return k % 2 === 0 ? 0.72 : 0.84 + 0.3 * hash1(Math.floor(k / 2) + 3);
    },
    capTop: true,
  });
  // plank seams on the lid
  mb.scope(() => {
    mb.set({ mat: MAT.plain, color: PAL.woodDark, ao: 0 });
    for (const x of [-0.11, 0.0, 0.11]) {
      mb.stroke([V(x, 0.962, -0.3), V(x, 0.962, 0), V(x, 0.962, 0.3)].map((p) => p.setX(p.x + (hash1(p.x * 9) - 0.5) * 0.01)), [V(0, 1, 0), V(0, 1, 0), V(0, 1, 0)], 0.012, { lift: 0.002 });
    }
  });
  // iron hoops
  mb.set({ mat: MAT.plain, color: PAL.iron, color2: PAL.ironLight, blend: 0.4, mottle: 0.18, ao: 0.1 });
  for (const y of [0.1, 0.3, 0.7, 0.9]) {
    const rb = radiusAt(BARREL_PROFILE, y + 0.03);
    mb.lathe(
      [
        [rb - 0.004, y],
        [rb + 0.014, y + 0.03],
        [rb - 0.004, y + 0.06],
      ],
      { seg: 20 },
    );
  }
  return { parts: [solidPart(mb, ctx, { roughness: 0.9 })] };
}

// ---- crate --------------------------------------------------------------------------------------------------------

function crate(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(12);
  const rng = mb.rng;
  const W = 0.8;
  const T = 0.035;
  mb.set({ mat: MAT.wood, color: PAL.woodMid, color2: PAL.woodDark, blend: 0.3, uvs: 0.75, ao: 0.34, aoH: 0.3 });
  const board = (cx: number, cy: number, cz: number, w: number, h: number, d: number, col: Color): void => {
    mb.scope(() => {
      mb.t(cx, cy, cz).rx((rng() - 0.5) * 0.02).rz((rng() - 0.5) * 0.02);
      mb.set({ color: col });
      mb.box(w, h, d, { soft: 0.28 });
    });
  };
  // side boards: four per face
  for (let i = 0; i < 4; i++) {
    const y = 0.03 + i * 0.2 + 0.0925;
    for (const s of [1, -1]) {
      board(0, y, s * (W / 2 - T / 2 + rng() * 0.008), W, 0.185, T, vary('#85603b', rng, 0.16));
      board(s * (W / 2 - T / 2 + rng() * 0.008), y, 0, T, 0.185, W - 2 * T, vary('#7b5736', rng, 0.16));
    }
  }
  // corner posts
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) board(sx * (W / 2 - 0.03), 0.43, sz * (W / 2 - 0.03), 0.075, 0.86, 0.075, vary('#5d412a', rng, 0.1));
  }
  // diagonal braces on all four faces
  const diag = Math.hypot(W - 0.1, 0.8 - 0.06);
  const ang = Math.atan2(0.8 - 0.06, W - 0.1);
  for (let f = 0; f < 4; f++) {
    mb.scope(() => {
      mb.ry((f * Math.PI) / 2).t(0, 0.43, W / 2 + 0.005).rz(ang * (f % 2 === 0 ? 1 : -1));
      mb.set({ color: vary('#6a4a2d', rng, 0.12) });
      mb.box(0.07, diag, 0.012, { soft: 0.2, grain: 'y' });
    });
  }
  // lid: five boards
  for (let i = 0; i < 5; i++) board(-0.32 + i * 0.16, 0.845, 0, 0.158, T, W + 0.02, vary('#8a653d', rng, 0.14));
  // rope binding with a knot at the front
  mb.set({ mat: MAT.cloth, color: PAL.rope, ao: 0.1, mottle: 0.1 });
  rope(mb, roundedLoop(W / 2 + 0.025, W / 2 + 0.025, 0.45, 0.06, 2), 0.017);
  mb.scope(() => {
    mb.t(0, 0.45, W / 2 + 0.04).s(1, 1, 0.8);
    mb.blob(0.045, 0.04, 0.035, { seg: 6, rings: 4, lump: 0.2 });
  });
  // painted shipping mark on the front
  mb.set({ mat: MAT.plain, color: PAL.red, ao: 0 });
  const z = W / 2 + 0.0 + 0.002;
  mb.stroke([V(-0.12, 0.62, z), V(0.0, 0.69, z), V(0.12, 0.76, z)], [V(0, 0, 1), V(0, 0, 1), V(0, 0, 1)], 0.03, { lift: 0.003 });
  mb.stroke([V(-0.12, 0.76, z), V(0.0, 0.69, z), V(0.12, 0.62, z)], [V(0, 0, 1), V(0, 0, 1), V(0, 0, 1)], 0.03, { lift: 0.003 });
  return { parts: [solidPart(mb, ctx, { roughness: 0.92 })] };
}

// ---- urn ----------------------------------------------------------------------------------------------------------

const URN_PROFILE: Array<[number, number]> = [
  [0.27, 0.0],
  [0.29, 0.05],
  [0.38, 0.18],
  [0.47, 0.36],
  [0.5, 0.52],
  [0.47, 0.7],
  [0.37, 0.86],
  [0.26, 0.97],
  [0.23, 1.05],
  [0.25, 1.13],
  [0.32, 1.2],
  [0.27, 1.205],
  [0.22, 1.15],
];

function urn(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(13);
  mb.set({ mat: MAT.stone, color: PAL.clay, color2: PAL.clayDark, blend: 0.55, mottle: 0.16, uvs: 0.9, ao: 0.4, aoH: 0.4, mottleFreq: 2.4 });
  mb.lathe(URN_PROFILE, { seg: 12, rad: (a, i) => 1 + 0.012 * Math.sin(a * TAU * 3 + i) });
  // cream ornamental band (dentil pattern) at the belly + a ridge at the shoulder
  mb.set({ color: PAL.cream, color2: PAL.clay, blend: 0.25 });
  const band = [0.47, 0.56, 0.65].map((y) => [radiusAt(URN_PROFILE, y) + 0.014, y] as [number, number]);
  mb.lathe(band, { seg: 24 });
  // painted zigzag + edge lines on the band
  mb.scope(() => {
    mb.set({ mat: MAT.plain, color: '#5b2f1f', ao: 0 });
    const ring = (yOf: (i: number) => number, width: number): void => {
      const pts: Vector3[] = [];
      const nrm: Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const th = (i / 24) * TAU;
        const y = yOf(i);
        const rr = radiusAt(URN_PROFILE, y) + 0.03;
        pts.push(V(Math.cos(th) * rr, y, Math.sin(th) * rr));
        nrm.push(V(Math.cos(th), 0, Math.sin(th)));
      }
      mb.stroke(pts, nrm, width, { lift: 0.0 });
    };
    ring((i) => 0.56 + (i % 2 === 0 ? -0.04 : 0.04), 0.02);
  });
  mb.set({ color: PAL.clayDark, color2: PAL.clay, blend: 0.4 });
  const rs = radiusAt(URN_PROFILE, 0.84);
  mb.lathe(
    [
      [rs, 0.82],
      [rs + 0.03, 0.85],
      [rs, 0.88],
    ],
    { seg: 14 },
  );
  // two loop handles at the neck
  mb.set({ mat: MAT.stone, color: PAL.clay, color2: PAL.clayDark, blend: 0.5 });
  for (const side of [0, Math.PI]) {
    mb.scope(() => {
      mb.ry(side);
      mb.tube([V(0.235, 1.09, 0), V(0.33, 1.06, 0), V(0.385, 0.99, 0), V(0.36, 0.92, 0), V(0.32, 0.875, 0)], 0.026, { radial: 5, cap0: 'flat', cap1: 'flat' });
    });
  }
  // cloth stopper tied with rope
  mb.set({ mat: MAT.cloth, color: '#8f6a43', color2: PAL.hideDark, blend: 0.4, ao: 0 });
  mb.scope(() => {
    mb.t(0, 1.19, 0);
    mb.blob(0.25, 0.1, 0.25, { seg: 9, rings: 4, lump: 0.1, cutBottom: 0.9 });
  });
  mb.set({ color: PAL.rope });
  const ringPts: Vector3[] = [];
  for (let i = 0; i <= 10; i++) ringPts.push(V(Math.cos((i / 10) * TAU) * 0.245, 1.12, Math.sin((i / 10) * TAU) * 0.245));
  rope(mb, ringPts, 0.014);
  rope(mb, [V(0.24, 1.12, 0.05), V(0.28, 1.04, 0.1), V(0.27, 0.95, 0.12)], 0.011);
  return { parts: [solidPart(mb, ctx, { roughness: 0.82, detail: [0.9, 0.8, 0.28, 0.5] })] };
}

// ---- haystack -----------------------------------------------------------------------------------------------------

function haystack(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(14);
  const rng = mb.rng;
  const H = 2;
  const rAt = (t: number): number => 1.28 * Math.pow(Math.max(0, 1 - t), 0.7) * (1 + 0.12 * Math.sin(t * Math.PI));
  const rows = 14;
  const prof: Array<[number, number]> = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    prof.push([Math.max(0.03, rAt(t)), t * H]);
  }
  mb.set({ mat: MAT.cloth, color: '#c2a14a', color2: PAL.strawDark, blend: 0.55, mottle: 0.2, mottleFreq: 2.2, jitter: 0.08, uvs: 0.8, ao: 0.5, aoH: 0.55 });
  mb.lathe(prof, {
    seg: 16,
    crease: 3,
    rad: (a, i) => {
      const w = mb.world(Math.cos(a * TAU), i * 0.1, Math.sin(a * TAU), new Vector3());
      return 1 + 0.05 * (noise3(w.x * 2.1, w.y * 2.1, w.z * 2.1, 3) - 0.5) * 2;
    },
    shade: (a, i) => 0.7 + 0.3 * (i / rows) + 0.1 * (noise3(a * 7, i * 0.5, 2, 5) - 0.5),
  });
  // thatch: rings of wide straw strips hanging down over the mound, overlapping like shingles
  const layers = 11;
  for (let L = 0; L < layers; L++) {
    const t = 0.06 + (L / (layers - 1)) * 0.88;
    const count = Math.round(12 + 20 * (1 - t));
    const dt = 0.1;
    for (let k = 0; k < count; k++) {
      const a = ((k + rng() * 0.8) / count) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const r = rAt(t) * 1.012;
      const base = V(ca * r, t * H + 0.04 + rng() * 0.05, sa * r);
      const dr = rAt(t - dt) - rAt(t);
      // hang down the slope, fanned sideways and curling slightly outward at the tip
      const fan = (rng() - 0.5) * 0.7;
      const down = V(ca * dr - sa * fan * 0.4, -dt * H, sa * dr + ca * fan * 0.4).normalize();
      const len = 0.26 + rng() * 0.3;
      const tip = base.clone().addScaledVector(down, len).add(V(ca * (0.05 + rng() * 0.07), 0, sa * (0.05 + rng() * 0.07)));
      const hue = rng();
      mb.set({ color: new Color(hue < 0.3 ? '#e4c76c' : hue < 0.75 ? '#cfae54' : '#ab8c3e').multiplyScalar(0.88 + t * 0.2) });
      mb.blade(base, tip, 0.03 + rng() * 0.012, 0.016, { mBase: 1.1, mTip: 0.78, bend: V(ca * 0.03, 0, sa * 0.03) });
    }
  }
  // loose bunched tuft on top
  for (let n = 0; n < 24; n++) {
    const a = rng() * TAU;
    const base = V(Math.cos(a) * 0.04, H - 0.06, Math.sin(a) * 0.04);
    const tip = V(Math.cos(a) * (0.1 + rng() * 0.2), H + 0.22 + rng() * 0.2, Math.sin(a) * (0.1 + rng() * 0.2));
    mb.set({ color: new Color('#e3c76c').lerp(new Color(PAL.strawDark), rng() * 0.5) });
    mb.blade(base, tip, 0.03, 0.006, { mBase: 0.95, mTip: 1.15 });
  }
  // two rope bands
  mb.set({ color: PAL.rope, color2: PAL.ropeDark, blend: 0.3, jitter: 0.04, ao: 0 });
  for (const t of [0.24, 0.52]) {
    const pts: Vector3[] = [];
    const rr = rAt(t) + 0.035;
    for (let i = 0; i <= 18; i++) pts.push(V(Math.cos((i / 18) * TAU) * rr, t * H, Math.sin((i / 18) * TAU) * rr));
    mb.tube(pts, 0.026, { radial: 3, shade: (u, a) => 0.82 + 0.25 * Math.sin((u * 60 + a * 3) * 1.5) });
  }
  return { parts: [solidPart(mb, ctx, { roughness: 0.95, doubleSided: true, detail: [0.9, 0.8, 0.7, 0.8] })] };
}

// ---- signpost -----------------------------------------------------------------------------------------------------

function signpost(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(15);
  const rng = mb.rng;
  mb.set({ mat: MAT.wood, color: PAL.woodMid, color2: PAL.woodDark, blend: 0.35, uvs: 0.8, ao: 0.4, aoH: 0.5 });
  // hewn post, slightly out of true
  mb.scope(() => {
    mb.t(0, 1.2, 0).rz(0.012).rx(-0.01);
    mb.box(0.15, 2.4, 0.15, { bevel: 0.025, grain: 'y' });
  });
  // gabled cap
  mb.scope(() => {
    mb.set({ color: PAL.woodDark });
    mb.t(0, 2.4, 0);
    mb.prism(
      [
        [-0.2, 0],
        [0.2, 0],
        [0.0, 0.17],
      ],
      0.26,
    );
  });
  // arrow boards
  const boards: Array<{ y: number; dir: number; yaw: number; len: number }> = [
    { y: 2.02, dir: 1, yaw: 0.05, len: 1.0 },
    { y: 1.68, dir: -1, yaw: -0.03, len: 0.9 },
    { y: 1.36, dir: 1, yaw: -0.08, len: 0.8 },
  ];
  for (const b of boards) {
    mb.scope(() => {
      mb.t(0, b.y, 0.115).rz((rng() - 0.5) * 0.05).ry(b.yaw);
      mb.set({ color: vary('#92693f', rng, 0.1) });
      const L = b.len;
      mb.prism(
        b.dir > 0
          ? [
              [-L * 0.35, -0.1],
              [L * 0.55, -0.1],
              [L * 0.72, 0],
              [L * 0.55, 0.1],
              [-L * 0.35, 0.1],
            ]
          : [
              [L * 0.35, -0.1],
              [-L * 0.55, -0.1],
              [-L * 0.72, 0],
              [-L * 0.55, 0.1],
              [L * 0.35, 0.1],
            ],
        0.034,
        { grain: 'x' },
      );
      // painted marks + nails on the front face
      mb.set({ mat: MAT.plain, color: PAL.black, ao: 0 });
      const zf = 0.0175;
      for (let k = 0; k < 3; k++) {
        const x0 = b.dir * (0.05 + k * 0.17 * L);
        mb.stroke([V(x0, -0.05, zf), V(x0 + b.dir * 0.03, 0.0, zf), V(x0, 0.055, zf)], [V(0, 0, 1), V(0, 0, 1), V(0, 0, 1)], 0.022, { lift: 0.003 });
      }
      mb.set({ color: '#2a2a2e' });
      for (const nx of [-0.28 * b.dir * L, 0.0]) {
        mb.scope(() => {
          mb.t(nx, 0, zf + 0.004);
          mb.box(0.026, 0.026, 0.01);
        });
      }
    });
  }
  // red cloth strip tied below the cap
  mb.set({ mat: MAT.cloth, color: PAL.red, color2: PAL.redDark, blend: 0.4, ao: 0, sway: 0 });
  for (let i = 0; i < 2; i++) {
    mb.blade(V(0.09, 2.33 - i * 0.03, 0.08 - i * 0.05), V(0.13 + i * 0.03, 1.98 - i * 0.12, 0.11 - i * 0.08), 0.045, 0.05, { swTip: 0.7, mBase: 1, mTip: 0.9 });
  }
  // cairn around the foot
  mb.set({ mat: MAT.stone, color: PAL.stone, color2: PAL.moss, blend: 0.45, ao: 0.35, aoH: 0.3, uvs: 0.9 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + rng() * 0.4;
    const r = 0.17 + rng() * 0.05;
    mb.scope(() => {
      mb.t(Math.cos(a) * r, 0.05, Math.sin(a) * r).ry(rng() * TAU);
      mb.set({ color: vary(PAL.stone, rng, 0.14) });
      mb.blob(0.1 + rng() * 0.05, 0.07 + rng() * 0.03, 0.1 + rng() * 0.04, { seg: 6, rings: 4, lump: 0.18, seedOffset: i });
    });
  }
  return { parts: [solidPart(mb, ctx, { roughness: 0.9, doubleSided: true, sway: true })] };
}

// ---- well ---------------------------------------------------------------------------------------------------------

function well(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(16);
  const rng = mb.rng;
  const R0 = 1.1;
  const R1 = 0.72;
  const rc = (R0 + R1) / 2;
  // stone ring: three courses of soft-edged blocks, each course offset by half a block
  const N = 14;
  mb.set({ mat: MAT.stone, color: PAL.stone, color2: PAL.moss, blend: 0.55, mottle: 0.16, uvs: 0.7, ao: 0.42, aoH: 0.45, mottleFreq: 2.2 });
  const courses = [
    { y0: 0.0, h: 0.3 },
    { y0: 0.3, h: 0.28 },
    { y0: 0.58, h: 0.3 },
  ];
  courses.forEach((c, ci) => {
    for (let i = 0; i < N; i++) {
      const a = ((i + (ci % 2) * 0.5) / N) * TAU;
      const h = c.h * (0.94 + rng() * 0.1);
      const depth = R0 - R1 + (ci === 2 ? 0.1 : 0) + (rng() - 0.5) * 0.06;
      const rr = rc + (ci === 2 ? 0.015 : 0) + (rng() - 0.5) * 0.04;
      mb.scope(() => {
        mb.t(Math.cos(a) * rr, c.y0 + h / 2, Math.sin(a) * rr).ry(Math.PI / 2 - a + (rng() - 0.5) * 0.05);
        mb.set({ color: vary(ci === 2 ? '#a5a093' : PAL.stone, rng, 0.14) });
        mb.box(0.5 + rng() * 0.05, h, depth, { soft: 0.4 });
      });
    }
  });
  // dark water far down the shaft
  mb.set({ mat: MAT.plain, color: '#1f3a46', ao: 0, mottle: 0.2 });
  mb.disc(R1 - 0.02, 0.5, 1, 14);
  // timber frame
  mb.set({ mat: MAT.bark, color: '#6b4a30', color2: PAL.barkDark, blend: 0.4, uvs: 0.7, ao: 0.1 });
  for (const sx of [1, -1]) {
    mb.pole(V(sx * 0.9, 0.84, 0.0), V(sx * 0.88, 1.62, 0.0), 0.075, 0.065, { radial: 6, lenSeg: 3 });
    // diagonal brace to the roof beam
    mb.pole(V(sx * 0.9, 1.0, 0.0), V(sx * 0.62, 1.6, 0.0), 0.035, 0.032, { radial: 5, lenSeg: 2 });
  }
  mb.set({ color: '#5b3f29' });
  mb.pole(V(-1.05, 1.58, 0), V(1.05, 1.58, 0), 0.07, 0.07, { radial: 6, lenSeg: 3 }); // roof beam
  mb.set({ color: '#7a5636', color2: PAL.woodDark });
  mb.pole(V(-0.92, 1.18, 0), V(0.98, 1.18, 0), 0.075, 0.075, { radial: 7, lenSeg: 3 }); // windlass roller
  // crank
  mb.set({ mat: MAT.wood, color: PAL.woodDark });
  mb.pole(V(0.98, 1.18, 0), V(1.18, 1.18, 0.05), 0.03, 0.03, { radial: 5, lenSeg: 1 });
  mb.pole(V(1.18, 1.18, 0.05), V(1.18, 1.0, 0.07), 0.03, 0.03, { radial: 5, lenSeg: 1 });
  mb.pole(V(1.18, 1.0, 0.07), V(1.18, 1.0, 0.24), 0.03, 0.03, { radial: 5, lenSeg: 1 });
  // rope + bucket
  mb.set({ mat: MAT.cloth, color: PAL.rope, color2: PAL.ropeDark, blend: 0.3, ao: 0 });
  rope(mb, [V(0.05, 1.2, 0.08), V(0.07, 1.1, 0.1), V(0.06, 1.04, 0.1)], 0.016);
  mb.set({ mat: MAT.wood, color: '#8a6238', color2: PAL.woodDark, blend: 0.3, uvs: 0.5, ao: 0 });
  mb.scope(() => {
    mb.t(0.06, 0.8, 0.1);
    mb.lathe(
      [
        [0.095, 0],
        [0.105, 0.02],
        [0.13, 0.22],
        [0.135, 0.24],
        [0.115, 0.235],
      ],
      { seg: 10, rad: (a) => 1 - 0.02 * (1 - Math.abs(Math.sin(a * Math.PI * 5))), capBottom: true },
    );
    mb.set({ mat: MAT.plain, color: PAL.iron, ao: 0 });
    mb.lathe(
      [
        [0.112, 0.06],
        [0.121, 0.075],
        [0.112, 0.09],
      ],
      { seg: 10 },
    );
    mb.lathe(
      [
        [0.126, 0.16],
        [0.135, 0.175],
        [0.126, 0.19],
      ],
      { seg: 10 },
    );
    mb.tube([V(-0.135, 0.22, 0), V(-0.08, 0.3, 0), V(0, 0.32, 0), V(0.08, 0.3, 0), V(0.135, 0.22, 0)], 0.008, { radial: 4 });
  });
  // gabled roof: courses of corrugated slate tiles, each course overlapping the one below
  const roofW = 1.3;
  const eave = 0.92;
  const rise = 0.4;
  const tileRows = 5;
  for (const s of [1, -1]) {
    for (let c = 0; c < tileRows; c++) {
      const v0 = c / tileRows;
      const v1 = Math.min(1, (c + 1) / tileRows + 0.03);
      const tone = 0.92 + 0.14 * hash1(c * 7 + (s > 0 ? 1 : 2));
      mb.set({ mat: MAT.plain, color: new Color('#617079').multiplyScalar(tone), color2: '#4c5c4e', blend: 0.4, mottle: 0.14, ao: 0, uvs: 1 });
      mb.surface(
        32,
        1,
        (u, v, p) => {
          const sv = v0 + (v1 - v0) * v;
          const x = (u - 0.5) * 2 * roofW;
          const corr = Math.sin(u * Math.PI * 16);
          p.x = x;
          p.y = 1.78 - sv * rise + corr * 0.026 - v * 0.014;
          p.z = s * sv * eave;
          p.m = (0.84 + 0.2 * corr) * (v === 1 ? 1.16 : 0.74);
        },
        { flip: s > 0 },
      );
    }
    // fascia board along the eave
    mb.set({ mat: MAT.wood, color: '#5b3f29', color2: PAL.woodDark, blend: 0.3, ao: 0 });
    mb.scope(() => {
      mb.t(0, 1.78 - rise - 0.02, s * eave);
      mb.box(roofW * 2 + 0.1, 0.06, 0.06, { soft: 0.2 });
    });
  }
  // ridge cap with upturned horn ends
  mb.set({ mat: MAT.plain, color: '#43505a', color2: '#3a463f', blend: 0.4, ao: 0 });
  mb.pole(V(-roofW - 0.06, 1.81, 0), V(roofW + 0.06, 1.81, 0), 0.085, 0.085, { radial: 6, lenSeg: 4 });
  for (const sx of [1, -1]) {
    mb.scope(() => {
      mb.t(sx * (roofW + 0.06), 1.84, 0);
      mb.spike(0.07, 0.3, 6, { lean: [sx * 0.12, 0] });
    });
  }
  // gable boards
  mb.set({ mat: MAT.wood, color: '#6b4b30', color2: PAL.woodDark, blend: 0.3 });
  for (const gx of [-roofW + 0.05, roofW - 0.05]) {
    mb.scope(() => {
      mb.t(gx, 1.6, 0).ry(Math.PI / 2);
      mb.prism(
        [
          [-eave + 0.05, -0.12],
          [eave - 0.05, -0.12],
          [0, 0.17],
        ],
        0.04,
        { grain: 'x' },
      );
    });
  }
  return { parts: [solidPart(mb, ctx, { roughness: 0.9, doubleSided: true })] };
}

export const VILLAGE_DEFS = {
  barrel: { build: barrel, textures: ['tex_wood_plank'] },
  crate: { build: crate, textures: ['tex_wood_plank'] },
  urn: { build: urn, textures: ['tex_rock_mossy'] },
  haystack: { build: haystack },
  signpost: { build: signpost, textures: ['tex_wood_plank', 'tex_rock_mossy'] },
  well: { build: well, textures: ['tex_rock_mossy', 'tex_bark_oak', 'tex_wood_plank'] },
};


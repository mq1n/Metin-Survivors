// metin_stone: 3 m fractured volcanic obelisk. Rune plate on the front (three stacked slabs, the middle one carries the sigil),
// fractured back/core, a jagged crown of three leaning crystals, flared plinth, leaning crystal spurs, rubble, 3 floating rune shards.
// Faces are flat convex facets; plates, core and plinth are Voronoi-fractured into rigid pieces that really come apart in `shatter`.
import { type Img, loadTexture } from '../../core/ext/metins/img.ts';
import { CLS, type Plane, Poly, fracture, roofPlane, sidePlane, splitPoly } from '../../core/ext/metins/poly.ts';
import type { Vec3 } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { MetinSpec } from './build.ts';
import { bipyramid, crystal, groundCut, leanPoly, rock } from './geo.ts';
import type { PieceDef } from './rig.ts';
import { type Decal, type Palette, planeFrame } from './shade.ts';

export const PART = { SHAFT: 1, PLINTH: 2, SPUR: 3, RUBBLE: 4, SHARD: 5, CROWN: 6 } as const;
export const PLANE = { FRONT: 0, BACK: 1, RIGHT: 2, LEFT: 3, PLINTH_TOP: 8 } as const;

export const STONE_PALETTE: Palette = {
  shadow: [0.14, 0.125, 0.18],
  mid: [0.42, 0.38, 0.52],
  light: [0.78, 0.74, 0.9],
  edge: [0.82, 0.8, 0.94],
  ember: [0.16, 0.13, 0.2],
  glow: [0.55, 0.6, 0.85],
};

/** decal frame on a hull plane: centre at height y */
export function decalOnPlane(pl: Plane, y: number, w: number, h: number, ox = 0, oz = 0): Pick<Decal, 'plane' | 'o' | 'right' | 'up' | 'w' | 'h'> {
  const n = pl.n;
  const f = planeFrame(n);
  let o: Vec3;
  if (Math.abs(n[2]) >= Math.abs(n[0])) o = [ox, y, (pl.d - n[0] * ox - n[1] * y) / n[2]];
  else o = [(pl.d - n[2] * oz - n[1] * y) / n[0], y, oz];
  return { plane: pl.plane ?? -1, o, right: f.right, up: f.up, w, h };
}

/** hidden-bottom helper: planar faces at height y0 pointing down become band-painted fracture faces */
export function hideBottom(p: Poly, y0: number): Poly {
  for (const f of p.faces) if (f.pts.every((q) => Math.abs(q[1] - y0) < 1e-4)) f.cls = CLS.CRACK;
  return p;
}

export interface SigilSource {
  img: Img;
  /** crop rect (0..1) of the sigil inside `img` */
  crop?: [number, number, number, number];
}

/** `sigil`: glyph painted into the emissive mask of the front/back medallion (default: cell 0 of Imagegen's tex_rune_sigils = the `sorrow` medallion) */
export function stoneSpec(sigil?: SigilSource): MetinSpec {
  const rng = new Rng('metin_stone');
  const j = (a: number): number => rng.range(-a, a);
  const pieces: PieceDef[] = [];
  const PI = Math.PI;
  const chip = (p: Poly, size = 0.02, skip = 0.2): Poly => p.chamfer(size, rng, { jitter: 0.55, skip });

  // ------------------------------------------------------------------ shaft hull (ends in a broken, slanted top; crystals crown it)
  const sides: Plane[] = [
    sidePlane(PI / 2 + j(0.03), 0.5 + j(0.02), 0.15, PLANE.FRONT),
    sidePlane(-PI / 2 + j(0.03), 0.47 + j(0.02), 0.08, PLANE.BACK),
    sidePlane(0 + j(0.04), 0.62 + j(0.02), 0.07, PLANE.RIGHT),
    sidePlane(PI + j(0.04), 0.58 + j(0.02), 0.06, PLANE.LEFT),
    sidePlane(PI / 4 + j(0.05), 0.74 + j(0.02), 0.1, 4),
    sidePlane((3 * PI) / 4 + j(0.05), 0.7 + j(0.02), 0.09, 5),
    sidePlane(-PI / 4 + j(0.05), 0.72 + j(0.02), 0.11, 6),
    sidePlane((-3 * PI) / 4 + j(0.05), 0.76 + j(0.02), 0.08, 7),
  ];
  const top: Plane[] = [
    roofPlane(PI / 2, 0.55, [0, 2.3, 0.3], -1),
    roofPlane(-PI / 2, 0.7, [0, 2.45, -0.25], -1),
    roofPlane(0.2, 0.9, [0.3, 2.35, 0], -1),
    roofPlane(PI - 0.2, 0.75, [-0.3, 2.25, 0], -1),
  ];
  const hull = Poly.fromPlanes([...sides, ...top, { n: [0, -1, 0], d: -0.5 }]) as Poly;
  hideBottom(hull, 0.5);

  // shaft = stack of tilted slabs; the middle slab is left whole and carries the rune sigil, the others are split once
  const gap = 0.016;
  const front = sides[PLANE.FRONT]!;
  const [low, upper] = splitPoly(hull, [0.06, 1, 0.03], 1.05, gap);
  const [mid, high] = upper ? splitPoly(upper, [-0.07, 1, 0.04], 2.05, gap) : [null, null];
  const addSlab = (p: Poly | null, size = 0.02): void => {
    if (p) pieces.push({ role: 'chunk', part: PART.SHAFT, polys: [chip(p, size, 0.15)] });
  };
  if (low) {
    const [l, r] = splitPoly(low, [1, 0.12, 0.25], 0.04, gap);
    addSlab(l);
    addSlab(r);
  }
  addSlab(mid);
  if (high) {
    const [l, r] = splitPoly(high, [1, -0.2, 0.1], -0.06, gap);
    addSlab(l);
    addSlab(r);
  }

  // ------------------------------------------------------------------ crown: three leaning crystals growing out of the broken top
  const crown: { base: Vec3; heading: number; lean: number; r: number; h: number }[] = [
    { base: [0.02, 1.95, -0.14], heading: -PI / 2, lean: 0.1, r: 0.27, h: 1.2 },
    { base: [-0.3, 1.95, 0.06], heading: PI, lean: 0.38, r: 0.2, h: 0.95 },
    { base: [0.3, 1.9, 0.14], heading: 0.2 * PI, lean: 0.3, r: 0.16, h: 0.72 },
  ];
  for (const s of crown) {
    const c = leanPoly(crystal(rng, s.r, s.h, { crown: 3, slope: 0.75 }), s.heading, s.lean, [0, 0, 0]).translate(s.base);
    pieces.push({ role: 'chunk', part: PART.CROWN, polys: [chip(c, 0.014, 0.1)] });
  }

  // ------------------------------------------------------------------ flared plinth
  const plinthPlanes: Plane[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2 + j(0.06);
    const r = Math.hypot(1.08 * Math.cos(a), 0.82 * Math.sin(a)) * rng.range(0.92, 1.02);
    plinthPlanes.push(sidePlane(a, r, 0.46, 10 + i));
  }
  plinthPlanes.push({ n: [0.05, 1, 0.03], d: 0.62, plane: PLANE.PLINTH_TOP }, { n: [0, -1, 0], d: 0 });
  const plinth = hideBottom(Poly.fromPlanes(plinthPlanes) as Poly, 0);
  const plinthSeeds: Vec3[] = [[-0.62, 0.3, 0.12], [0.0, 0.3, -0.38], [0.6, 0.3, 0.1], [0.05, 0.3, 0.46]];
  for (const c of fracture(plinth, plinthSeeds, 0.016, 1)) pieces.push({ role: 'chunk', part: PART.PLINTH, polys: [chip(c, 0.022, 0.2)] });

  // ------------------------------------------------------------------ leaning crystal spurs
  const spurs: { base: Vec3; heading: number; lean: number; r: number; h: number }[] = [
    { base: [-0.8, -0.05, -0.28], heading: PI, lean: 0.36, r: 0.2, h: 1.95 },
    { base: [0.78, -0.05, -0.38], heading: -0.25, lean: 0.44, r: 0.17, h: 1.4 },
    { base: [-0.46, -0.05, 0.8], heading: PI / 2 + 0.6, lean: 0.52, r: 0.15, h: 1.0 },
  ];
  for (const s of spurs) {
    const c = groundCut(leanPoly(crystal(rng, s.r, s.h), s.heading, s.lean, [0, 0, 0]).translate(s.base), 0);
    pieces.push({ role: 'chunk', part: PART.SPUR, polys: [chip(c, 0.014, 0.1)] });
  }

  // ------------------------------------------------------------------ rubble (rocks share bones in pairs)
  const ring: [number, number, number][] = [
    [0.4, 1.28, 0.26], [0.9, 1.4, 0.2], [1.6, 1.3, 0.3], [2.4, 1.5, 0.18], [3.2, 1.25, 0.24],
    [4.0, 1.55, 0.3], [4.8, 1.35, 0.17], [5.4, 1.2, 0.22], [5.9, 1.5, 0.2], [2.0, 1.85, 0.16],
  ];
  const rocks = ring.map(([a, r, s]) => chip(groundCut(rock(rng, s, { flat: true, squash: 0.65, planes: 12 }), 0).translate([Math.cos(a) * r * 1.1, 0, Math.sin(a) * r * 0.85]), 0.03, 0.3));
  for (let i = 0; i < rocks.length; i += 2) pieces.push({ role: 'debris', part: PART.RUBBLE, polys: rocks.slice(i, i + 2) });

  // ------------------------------------------------------------------ floating rune shards
  [1.15, 2.0, 2.65].forEach((y, i) => {
    const s = bipyramid(rng, 0.12 + 0.02 * (i % 2), 0.36 + 0.06 * i, 5).chamfer(0.01, rng, { skip: 0.3 });
    const a0 = (i / 3) * PI * 2 + 0.5;
    const r = 1.12 - 0.08 * i;
    pieces.push({ role: 'shard', part: PART.SHARD, polys: [s.translate([Math.cos(a0) * r, y, Math.sin(a0) * r])], orbit: { r, a0, turns: i % 2 ? -1 : 1, bob: 0.07, bobCycles: 2 + i, spin: 2, cx: 0, cz: 0 } });
  });

  // ------------------------------------------------------------------ decals
  const sg: SigilSource = sigil ?? { img: loadTexture('tex_rune_sigils'), crop: [0, 0, 0.25, 0.25] };
  const sigilCrop = sg.crop ? { crop: sg.crop } : {};
  const column = loadTexture('tex_rune_a');
  const ff = planeFrame(front.n);
  // a horizontal rune band on the lower plate: the column sheet rotated a quarter turn
  const lowerBand = { ...decalOnPlane(front, 0.84, 0.24, 0.98), img: column, up: ff.right, right: ff.up, gain: 0.9, carve: 0.8, halo: 0.45 };
  const plinthBand = (i: number, y: number): Decal => ({ ...decalOnPlane(plinthPlanes[i]!, y, 0.2, 0.8), img: column, up: planeFrame(plinthPlanes[i]!.n).right, right: planeFrame(plinthPlanes[i]!.n).up, gain: 0.85, carve: 0.7, halo: 0.4 });
  const decals: Decal[] = [
    ...[1, 2, 3].map((i) => plinthBand(i, 0.33)),
    { ...decalOnPlane(front, 1.56, 0.9, 0.9), img: sg.img, ...sigilCrop, gain: 1, halo: 0.5, plate: { r: 0.97, depth: 0.5 } },
    lowerBand,
    { ...decalOnPlane(sides[PLANE.BACK]!, 1.55, 0.7, 0.7), img: sg.img, ...sigilCrop, gain: 0.9, halo: 0.45, plate: { r: 0.97, depth: 0.5 } },
    { ...decalOnPlane(sides[PLANE.RIGHT]!, 1.6, 0.26, 0.82), img: column, gain: 0.95, carve: 0.8, halo: 0.45 },
    { ...decalOnPlane(sides[PLANE.LEFT]!, 1.5, 0.26, 0.82), img: column, gain: 0.95, carve: 0.8, halo: 0.45 },
  ];

  return {
    id: 'metin_stone',
    pieces,
    shade: { seed: 'metin_stone', palette: STONE_PALETTE, decals, veins: 1.0, glowParts: [PART.SHARD], tipParts: [PART.CROWN, PART.SPUR], tipGain: 0.9, seams: 1, value: 1.25 },
    texSize: 1024,
    tune: { S: 1, seed: 'metin_stone' },
    emissiveFactor: [0.22, 0.52, 1.0],
    roughness: 0.62,
    extras: { metin: { glowMask: 'emissiveTexture', tint: 'material.emissive', pulseClip: 'pulse' } },
  };
}

// metin_great_yeonmu — Great Ebon Metin: a 7.5 m obsidian stele (stack of tilted, slightly shifted slabs carrying a huge
// rune sigil), crowned by five crystal spikes, on a two-tier fractured plinth with four rune pillars, leaning crystal spurs,
// a rubble ring and ten floating rune shards orbiting on two rings. Black-violet palette.
import { loadTexture } from '../../core/ext/metins/img.ts';
import { type Plane, Poly, fracture, roofPlane, sidePlane, splitPoly } from '../../core/ext/metins/poly.ts';
import type { Vec3 } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { MetinSpec } from './build.ts';
import { bipyramid, crystal, groundCut, leanPoly, rock } from './geo.ts';
import { hideFacesAt, jitterSlab } from './parts.ts';
import type { PieceDef } from './rig.ts';
import { type Decal, type Palette, planeFrame } from './shade.ts';
import { decalOnPlane } from './stone.ts';

const PART = { SLAB: 1, PLINTH: 2, SPUR: 3, RUBBLE: 4, SHARD: 5, CROWN: 6, PILLAR: 7 } as const;

const PALETTE: Palette = {
  shadow: [0.09, 0.07, 0.13],
  mid: [0.3, 0.24, 0.4],
  light: [0.6, 0.5, 0.78],
  edge: [0.86, 0.78, 0.98],
  ember: [0.18, 0.1, 0.22],
  glow: [0.6, 0.38, 0.9],
};

export function greatYeonmuSpec(): MetinSpec {
  const rng = new Rng('metin_great_yeonmu');
  const j = (a: number): number => rng.range(-a, a);
  const PI = Math.PI;
  const pieces: PieceDef[] = [];
  const chip = (p: Poly, size = 0.05, skip = 0.2): Poly => p.chamfer(size, rng, { jitter: 0.55, skip });
  const gap = 0.04;

  // ---- plinth: two fractured octagonal tiers
  const tier = (rx: number, rz: number, y0: number, y1: number, idBase: number, taper: number): { poly: Poly; pl: Plane[] } => {
    const pl: Plane[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2 + j(0.05);
      pl.push(sidePlane(a, Math.hypot(rx * Math.cos(a), rz * Math.sin(a)) * rng.range(0.94, 1.02), taper, idBase + i, y0));
    }
    pl.push({ n: [0.03, 1, 0.02], d: y1, plane: idBase + 8 }, { n: [0, -1, 0], d: -y0 });
    return { poly: hideFacesAt(Poly.fromPlanes(pl) as Poly, y0), pl };
  };
  const t1 = tier(3.3, 2.7, 0, 0.6, 10, 0.5);
  const tier1 = t1.poly;
  const tier2 = tier(2.2, 1.8, 0.55, 1.15, 20, 0.5).poly;
  const t1Seeds: Vec3[] = [[-1.6, 0.3, 0.4], [-0.3, 0.3, -1.2], [1.5, 0.3, -0.1], [0.2, 0.3, 1.3], [-1.3, 0.3, -0.9]];
  for (const c of fracture(tier1, t1Seeds, 0.05, 1)) pieces.push({ role: 'chunk', part: PART.PLINTH, polys: [chip(c, 0.07)] });
  const t2Seeds: Vec3[] = [[-0.9, 0.85, 0.2], [0.8, 0.85, -0.2], [0.0, 0.85, 0.8]];
  for (const c of fracture(tier2, t2Seeds, 0.05, 1)) pieces.push({ role: 'chunk', part: PART.PLINTH, polys: [chip(c, 0.06)] });

  // ---- stele hull (wide front/back faces, narrow corners)
  const sides: Plane[] = [
    sidePlane(PI / 2, 0.78 + j(0.02), 0.045, 0, 1.0),
    sidePlane(-PI / 2, 0.72 + j(0.02), 0.04, 1, 1.0),
    sidePlane(0, 1.2 + j(0.03), 0.035, 2, 1.0),
    sidePlane(PI, 1.15 + j(0.03), 0.03, 3, 1.0),
    sidePlane(PI / 4, 1.5 + j(0.03), 0.05, 4, 1.0),
    sidePlane((3 * PI) / 4, 1.45 + j(0.03), 0.045, 5, 1.0),
    sidePlane(-PI / 4, 1.48 + j(0.03), 0.05, 6, 1.0),
    sidePlane((-3 * PI) / 4, 1.52 + j(0.03), 0.045, 7, 1.0),
  ];
  const top: Plane[] = [
    roofPlane(PI / 2, 0.5, [0, 5.6, 0.6], -1),
    roofPlane(-PI / 2, 0.7, [0, 5.95, -0.5], -1),
    roofPlane(0.15, 0.9, [0.9, 5.75, 0], -1),
    roofPlane(PI - 0.15, 0.8, [-0.9, 5.6, 0], -1),
  ];
  const hull = hideFacesAt(Poly.fromPlanes([...sides, ...top, { n: [0, -1, 0], d: -1.0 }]) as Poly, 1.0);
  const addSlab = (p: Poly | null, size = 0.045): void => {
    if (p) pieces.push({ role: 'chunk', part: PART.SLAB, polys: [chip(jitterSlab(p, rng, 0.03, 0.05), size, 0.15)] });
  };
  const [s1, r1] = splitPoly(hull, [0.05, 1, 0.03], 2.2, gap);
  const [s2, r2] = r1 ? splitPoly(r1, [-0.06, 1, 0.04], 4.4, gap) : [null, null];
  const [s3, s4] = r2 ? splitPoly(r2, [0.05, 1, -0.03], 5.4, gap) : [null, null];
  if (s1) {
    const [l, r] = splitPoly(s1, [1, 0.1, 0.2], 0.15, gap);
    addSlab(l);
    addSlab(r);
  }
  addSlab(s2);
  if (s3) {
    const [l, r] = splitPoly(s3, [1, -0.18, 0.1], -0.2, gap);
    addSlab(l);
    addSlab(r);
  }
  addSlab(s4);

  // ---- crown: two tall horns flanking a floating void crystal
  const crown: { base: Vec3; heading: number; lean: number; r: number; h: number }[] = [
    { base: [-0.85, 5.0, 0.05], heading: PI, lean: 0.24, r: 0.46, h: 2.9 },
    { base: [0.9, 5.0, -0.05], heading: 0.05, lean: 0.2, r: 0.4, h: 2.5 },
    { base: [0.0, 5.0, -0.55], heading: -PI / 2, lean: 0.12, r: 0.34, h: 1.9 },
    { base: [-0.2, 5.0, 0.7], heading: PI / 2 + 0.3, lean: 0.45, r: 0.26, h: 1.3 },
  ];
  for (const s of crown) {
    const c = leanPoly(crystal(rng, s.r, s.h, { crown: 3, slope: 0.75 }), s.heading, s.lean, [0, 0, 0]).translate(s.base);
    pieces.push({ role: 'chunk', part: PART.CROWN, polys: [chip(c, 0.04, 0.1)] });
  }
  const voidCrystal = bipyramid(rng, 0.52, 1.15, 6).chamfer(0.04, rng, { skip: 0.2 }).translate([0, 7.3, 0]);
  pieces.push({ role: 'core', part: PART.SHARD, polys: [voidCrystal], bob: { amp: 0.22, cycles: 2 } });

  // ---- four corner rune pillars on the lower tier
  const pillarPos: [number, number][] = [[2.55, 1.5], [-2.55, 1.5], [2.45, -1.5], [-2.45, -1.5]];
  for (const [x, z] of pillarPos) {
    const c = crystal(rng, 0.34, 1.35, { sides: 5, crown: 3, slope: 0.8, taper: 0.06 }).translate([x, 0.5, z]);
    pieces.push({ role: 'chunk', part: PART.PILLAR, polys: [chip(c, 0.03, 0.1)] });
  }

  // ---- leaning crystal spurs around the plinth
  const spurN = 5;
  for (let i = 0; i < spurN; i++) {
    const a = (i / spurN) * PI * 2 + 0.3 + j(0.12);
    const r = 4.0 + rng.range(0, 0.6);
    const h = 1.5 + rng.range(0, 1.0);
    const c = groundCut(leanPoly(crystal(rng, 0.26 + rng.range(0, 0.1), h), a, 0.4 + rng.range(0, 0.15), [0, 0, 0]).translate([Math.cos(a) * r, -0.1, Math.sin(a) * r * 0.82]), 0);
    pieces.push({ role: 'chunk', part: PART.SPUR, polys: [chip(c, 0.03, 0.1)] });
  }

  // ---- rubble ring
  const rocks: Poly[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2 + j(0.2);
    const r = 4.4 + rng.range(0, 1.0);
    rocks.push(chip(groundCut(rock(rng, rng.range(0.25, 0.6), { flat: true, squash: 0.65 }), 0).translate([Math.cos(a) * r, 0, Math.sin(a) * r * 0.85]), 0.025, 0.15));
  }
  for (let i = 0; i < rocks.length; i += 2) pieces.push({ role: 'debris', part: PART.RUBBLE, polys: rocks.slice(i, i + 2) });

  // ---- floating rune shards on two rings
  for (let i = 0; i < 8; i++) {
    const inner = i % 2 === 0;
    const r = inner ? 3.0 : 3.9;
    const y = inner ? 2.4 + (i / 8) * 4.0 : 1.4 + ((i * 7) % 8) * 0.6;
    const a0 = (i / 8) * PI * 2 + 0.4;
    const s = bipyramid(rng, 0.2 + rng.range(0, 0.07), 0.55 + rng.range(0, 0.25), 5).chamfer(0.025, rng, { skip: 0.3 });
    pieces.push({ role: 'shard', part: PART.SHARD, polys: [s.translate([Math.cos(a0) * r, y, Math.sin(a0) * r])], orbit: { r, a0, turns: inner ? 1 : -1, bob: 0.18, bobCycles: 2 + (i % 3), spin: 2, cx: 0, cz: 0 } });
  }

  // ---- decals
  const sigils = loadTexture('tex_rune_sigils');
  const eclipse: [number, number, number, number] = [0, 0.25, 0.25, 0.5];
  const column = loadTexture('tex_rune_a');
  const ff = planeFrame(sides[0]!.n);
  const decals: Decal[] = [
    { ...decalOnPlane(sides[0]!, 3.3, 1.95, 1.95), img: sigils, crop: eclipse, gain: 1, halo: 0.5, plate: { r: 0.97, depth: 0.55 } },
    { ...decalOnPlane(sides[0]!, 1.62, 0.34, 2.1), img: column, up: ff.right, right: ff.up, gain: 0.9, carve: 0.8, halo: 0.45 },
    { ...decalOnPlane(sides[0]!, 4.9, 0.3, 1.8), img: column, up: ff.right, right: ff.up, gain: 0.9, carve: 0.8, halo: 0.45 },
    { ...decalOnPlane(sides[1]!, 3.3, 1.6, 1.6), img: sigils, crop: [0.25, 0.25, 0.5, 0.5], gain: 0.9, halo: 0.45, plate: { r: 0.97, depth: 0.55 } },
    { ...decalOnPlane(sides[2]!, 3.3, 0.56, 1.75), img: column, gain: 0.95, carve: 0.8, halo: 0.45 },
    { ...decalOnPlane(sides[3]!, 3.3, 0.56, 1.75), img: column, gain: 0.95, carve: 0.8, halo: 0.45 },
  ];
  for (const i of [1, 2, 3]) {
    const pl = t1.pl[i]!;
    const f = planeFrame(pl.n);
    decals.push({ ...decalOnPlane(pl, 0.28, 0.26, 1.9), img: column, up: f.right, right: f.up, gain: 0.85, carve: 0.7, halo: 0.4 });
  }

  return {
    id: 'metin_great_yeonmu',
    pieces,
    shade: { seed: 'great_yeonmu', palette: PALETTE, decals, veins: 1.0, glowParts: [PART.SHARD], tipParts: [PART.CROWN, PART.SPUR, PART.PILLAR], tipGain: 0.9, seams: 1, value: 1.25, tile: 2.2 },
    texSize: 2048,
    tune: { S: 2.5, seed: 'metin_great_yeonmu', speed: 0.85 },
    emissiveFactor: [0.62, 0.25, 1.0],
    roughness: 0.6,
    extras: { metin: { glowMask: 'emissiveTexture', tint: 'material.emissive', pulseClip: 'pulse', great: true, debrisRadius: 6.0 } },
  };
}


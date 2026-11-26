// metin_great_daeryeol — Great Purgatory Metin: a 9 m molten crystal spire standing on an inverted floating rock island, flame horns
// licking off its rim, hovering over a broken ring of lava-cracked slabs and a scatter of lava rocks (the debris ring the final
// boss bursts through: radius >= 2.6 m, height <= 1.4 m). Charred basalt with orange-red molten light.
import { loadTexture } from '../../core/ext/metins/img.ts';
import { type Plane, Poly, roofPlane, sidePlane, splitPoly } from '../../core/ext/metins/poly.ts';
import type { Vec3 } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { MetinSpec } from './build.ts';
import { bipyramid, crystal, groundCut, leanPoly, rock } from './geo.ts';
import { hideFacesAt, limbChain } from './parts.ts';
import type { PieceDef } from './rig.ts';
import { type Decal, type Palette, planeFrame } from './shade.ts';

const PART = { ISLAND: 1, RING: 2, RUBBLE: 3, GLOW: 4, SPIRE: 5, HORN: 6 } as const;

const PALETTE: Palette = {
  shadow: [0.1, 0.055, 0.045],
  mid: [0.36, 0.2, 0.15],
  light: [0.68, 0.42, 0.3],
  edge: [0.98, 0.72, 0.5],
  ember: [0.5, 0.14, 0.04],
  glow: [1.0, 0.5, 0.18],
};

export function greatDaeryeolSpec(): MetinSpec {
  const rng = new Rng('metin_great_daeryeol');
  const PI = Math.PI;
  const j = (a: number): number => rng.range(-a, a);
  const pieces: PieceDef[] = [];
  const chip = (p: Poly, size = 0.04, skip = 0.2): Poly => p.chamfer(size, rng, { jitter: 0.5, skip });
  const hover = { amp: 0.2, cycles: 2 };

  // ---- broken ring of lava slabs (horizontal tops share plane 30 so one sigil decal spans the whole ring)
  const slabs = 9;
  const rin = 2.5, rout = 4.0, h = 0.45;
  for (let i = 0; i < slabs; i++) {
    const a0 = (i / slabs) * PI * 2 + j(0.03), a1 = ((i + 1) / slabs) * PI * 2 + j(0.03);
    const m = (a0 + a1) / 2;
    const half = (a1 - a0) / 2;
    const gap = 0.16 + rng.range(0, 0.1);
    const planes: Plane[] = [
      { n: [Math.sin(a0), 0, -Math.cos(a0)], d: -gap / 2, plane: -1 },
      { n: [-Math.sin(a1), 0, Math.cos(a1)], d: -gap / 2, plane: -1 },
      { n: [Math.cos(m), 0, Math.sin(m)], d: rout * Math.cos(half) * rng.range(0.95, 1.03), plane: 60 + i },
      { n: [-Math.cos(m), 0, -Math.sin(m)], d: -rin * rng.range(0.97, 1.05), plane: 80 + i },
      { n: [0, 1, 0], d: h, plane: 30 },
      { n: [0, -1, 0], d: 0 },
    ];
    const s = hideFacesAt(Poly.fromPlanes(planes, 8) as Poly, 0);
    pieces.push({ role: 'chunk', part: PART.RING, polys: [chip(s, 0.05, 0.15)] });
  }

  // ---- floating inverted island: three stacked slabs + stalactites
  const ip: Plane[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2 + j(0.06);
    ip.push(sidePlane(a, 2.5 * rng.range(0.92, 1.04), -0.78, 100 + k, 3.4));
  }
  ip.push({ n: [0.02, 1, 0.03], d: 3.4, plane: 90 }, { n: [0, -1, 0], d: -1.15 });
  const island = hideFacesAt(Poly.fromPlanes(ip, 12) as Poly, 1.15);
  const [i1, ir] = splitPoly(island, [0.05, 1, 0.02], 2.05, 0.14);
  const [i2, i3] = ir ? splitPoly(ir, [-0.04, 1, 0.05], 2.75, 0.14) : [null, null];
  for (const p of [i1, i2, i3]) if (p) pieces.push({ role: 'chunk', part: PART.ISLAND, polys: [chip(p, 0.06, 0.15)], bob: hover });
  // stalactites hanging below
  const hang: Poly[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + 0.6;
    const path: Vec3[] = [[Math.cos(a) * 0.5, 1.6, Math.sin(a) * 0.5], [Math.cos(a) * 0.65, 0.9, Math.sin(a) * 0.65], [Math.cos(a) * 0.55, 0.3, Math.sin(a) * 0.55]];
    hang.push(...limbChain(path, 0.3, 0.03, 5, rng, 0.9));
  }
  pieces.push({ role: 'chunk', part: PART.ISLAND, polys: hang.map((p) => chip(p, 0.02, 0.3)), bob: hover });

  // ---- molten spire: main crystal in three stacked pieces (glowing seams), flanking crystals
  const main = leanPoly(crystal(rng, 0.95, 5.8, { sides: 7, crown: 4, slope: 0.38, taper: 0.095 }), 0.9, 0.05, [0, 0, 0]).translate([0.0, 3.2, -0.1]);
  const [m1, mr] = splitPoly(main, [0.04, 1, 0.02], 5.2, 0.34);
  const [m2, m3] = mr ? splitPoly(mr, [-0.04, 1, 0.03], 7.1, 0.3) : [null, null];
  for (const p of [m1, m2, m3]) if (p) pieces.push({ role: 'chunk', part: PART.SPIRE, polys: [chip(p, 0.05, 0.15)], bob: hover });
  const flank: { base: Vec3; heading: number; lean: number; r: number; h: number }[] = [
    { base: [-1.2, 3.2, 0.3], heading: PI, lean: 0.34, r: 0.55, h: 3.9 },
    { base: [1.15, 3.2, -0.1], heading: 0.1, lean: 0.3, r: 0.5, h: 3.4 },
    { base: [0.2, 3.2, 1.1], heading: PI / 2 + 0.3, lean: 0.4, r: 0.4, h: 2.4 },
    { base: [-0.4, 3.2, -1.15], heading: -PI / 2 - 0.3, lean: 0.38, r: 0.42, h: 2.8 },
  ];
  for (const s of flank) {
    const c = leanPoly(crystal(rng, s.r, s.h, { crown: 3, slope: 0.75 }), s.heading, s.lean, [0, 0, 0]).translate(s.base);
    pieces.push({ role: 'chunk', part: PART.SPIRE, polys: [chip(c, 0.035, 0.1)], bob: hover });
  }

  // ---- flame horns licking up and out of the island rim
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2 + 0.2;
    const path: Vec3[] = [];
    for (let s = 0; s <= 5; s++) {
      const t = s / 5;
      const rr = 2.1 + 1.5 * Math.sin(t * 1.25);
      const aa = a + 0.5 * t;
      path.push([Math.cos(aa) * rr, 3.2 + 2.6 * t - 0.5 * t * t, Math.sin(aa) * rr]);
    }
    pieces.push({ role: 'chunk', part: PART.HORN, polys: limbChain(path, 0.3, 0.035, 5, rng, 0.85).map((p) => chip(p, 0.02, 0.3)), bob: hover });
  }

  // ---- ember shards orbiting the spire
  for (let i = 0; i < 8; i++) {
    const r = 3.3 + 0.5 * (i % 3);
    const y = 2.4 + ((i * 5) % 8) * 0.8;
    const a0 = (i / 8) * PI * 2 + 0.3;
    const s = bipyramid(rng, 0.17 + rng.range(0, 0.06), 0.6 + rng.range(0, 0.3), 5).chamfer(0.02, rng, { skip: 0.3 }).translate([Math.cos(a0) * r, y, Math.sin(a0) * r]);
    pieces.push({ role: 'shard', part: PART.GLOW, polys: [s], orbit: { r, a0, turns: i % 2 ? 1 : -1, bob: 0.22, bobCycles: 2 + (i % 3), spin: 2, cx: 0, cz: 0 } });
  }

  // ---- lava rocks outside the ring
  const rocks: Poly[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * PI * 2 + j(0.15);
    const r = 4.5 + rng.range(0, 1.1);
    rocks.push(chip(groundCut(rock(rng, rng.range(0.35, 0.8), { flat: true, squash: 0.7 }), 0).translate([Math.cos(a) * r, 0, Math.sin(a) * r * 0.92]), 0.03, 0.15));
  }
  for (let i = 0; i < rocks.length; i += 2) pieces.push({ role: 'debris', part: PART.RUBBLE, polys: rocks.slice(i, i + 2) });

  // ---- decal: a large sigil across the ring tops
  const f = planeFrame([0, 1, 0], [0, 0, -1]);
  const decals: Decal[] = [{ plane: 30, o: [0, h, 0], right: f.right, up: f.up, w: 8.6, h: 8.6, img: loadTexture('tex_rune_b'), gain: 1, carve: 0.7, halo: 0.55 }];
  void roofPlane;

  return {
    id: 'metin_great_daeryeol',
    pieces,
    shade: { seed: 'great_daeryeol', palette: PALETTE, decals, veins: 1.3, glowParts: [PART.GLOW], tipParts: [PART.SPIRE, PART.HORN], tipGain: 0.95, seams: 1, value: 1.2, tile: 2.0 },
    texSize: 2048,
    tune: { S: 3.0, seed: 'metin_great_daeryeol', speed: 0.8 },
    emissiveFactor: [1.0, 0.32, 0.06],
    roughness: 0.62,
    extras: { metin: { glowMask: 'emissiveTexture', tint: 'material.emissive', pulseClip: 'pulse', great: true, debrisRadius: 5.5 } },
  };
}

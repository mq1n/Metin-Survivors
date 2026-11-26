// metin_great_suryeon — Great Dusk Metin: four twisting obsidian horns spiralling up around a pulsing purple void core, on a
// fractured sigil platform, with drifting stone slabs and rune shards. ~8 m tall.
import { loadTexture } from '../../core/ext/metins/img.ts';
import { type Plane, Poly, fracture, sidePlane } from '../../core/ext/metins/poly.ts';
import type { Vec3 } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { MetinSpec } from './build.ts';
import { bipyramid, groundCut, rock } from './geo.ts';
import { hideFacesAt, limbChain } from './parts.ts';
import type { PieceDef } from './rig.ts';
import { type Decal, type Palette, planeFrame } from './shade.ts';

const PART = { PRONG: 1, PLATFORM: 2, RUBBLE: 3, GLOW: 4, DRIFT: 5 } as const;

const PALETTE: Palette = {
  shadow: [0.07, 0.05, 0.11],
  mid: [0.24, 0.18, 0.34],
  light: [0.52, 0.42, 0.7],
  edge: [0.82, 0.72, 0.98],
  ember: [0.12, 0.06, 0.18],
  glow: [0.62, 0.32, 0.95],
};

export function greatSuryeonSpec(): MetinSpec {
  const rng = new Rng('metin_great_suryeon');
  const PI = Math.PI;
  const j = (a: number): number => rng.range(-a, a);
  const pieces: PieceDef[] = [];
  const chip = (p: Poly, size = 0.04, skip = 0.2): Poly => p.chamfer(size, rng, { jitter: 0.5, skip });

  // ---- fractured sigil platform
  const pl: Plane[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * PI * 2 + j(0.05);
    pl.push(sidePlane(a, 3.5 * rng.range(0.94, 1.03), 0.5, 40 + i));
  }
  pl.push({ n: [0, 1, 0], d: 0.55, plane: 30 }, { n: [0, -1, 0], d: 0 });
  const platform = hideFacesAt(Poly.fromPlanes(pl) as Poly, 0);
  const pSeeds: Vec3[] = [[-1.8, 0.28, 0.5], [-0.6, 0.28, -1.6], [1.4, 0.28, -1.2], [1.9, 0.28, 0.9], [0.1, 0.28, 1.8], [-0.1, 0.28, 0.0]];
  for (const c of fracture(platform, pSeeds, 0.05, 1)) pieces.push({ role: 'chunk', part: PART.PLATFORM, polys: [chip(c, 0.06)] });

  // ---- four twisting horns (pinwheel), each three rigid segments
  const horns = 4;
  for (let k = 0; k < horns; k++) {
    const a0 = (k / horns) * PI * 2 + 0.35;
    const path: Vec3[] = [];
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const ang = a0 + 2.5 * t ** 0.95;
      const rad = 1.35 * (1 - t ** 1.8) + 0.55 * Math.sin(PI * t) + 0.02;
      path.push([Math.cos(ang) * rad, 0.4 + 7.3 * t - 0.5 * Math.sin(t * PI) * 0.0, Math.sin(ang) * rad]);
    }
    const chain = limbChain(path, 0.62, 0.06, 5, rng, 0.8);
    for (let g = 0; g < chain.length; g += 2) {
      const segs = chain.slice(g, g + 2).map((p) => chip(p, 0.035, 0.25));
      pieces.push({ role: 'chunk', part: PART.PRONG, polys: segs });
    }
  }

  // ---- the void core
  const core = bipyramid(rng, 0.78, 1.15, 6).chamfer(0.03, rng, { skip: 0.3 }).translate([0, 3.5, 0]);
  pieces.push({ role: 'core', part: PART.GLOW, polys: [core], bob: { amp: 0.14, cycles: 2 } });

  // ---- rubble on the platform rim
  const rocks: Poly[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2 + j(0.2);
    const r = 3.9 + rng.range(0, 1.0);
    rocks.push(chip(groundCut(rock(rng, rng.range(0.25, 0.55), { flat: true, squash: 0.65 }), 0).translate([Math.cos(a) * r, 0, Math.sin(a) * r * 0.9]), 0.025, 0.15));
  }
  for (let i = 0; i < rocks.length; i += 2) pieces.push({ role: 'debris', part: PART.RUBBLE, polys: rocks.slice(i, i + 2) });

  // ---- drifting stone slabs and rune shards (two rings, opposite directions)
  for (let i = 0; i < 4; i++) {
    const r = 3.6 + 0.5 * (i % 2);
    const y = 1.6 + i * 1.5;
    const a0 = (i / 4) * PI * 2 + 0.9;
    const s = chip(rock(rng, 0.5 + rng.range(0, 0.2), { squash: 0.55 }), 0.03, 0.15).translate([Math.cos(a0) * r, y, Math.sin(a0) * r]);
    pieces.push({ role: 'shard', part: PART.DRIFT, polys: [s], orbit: { r, a0, turns: 1, bob: 0.22, bobCycles: 2 + (i % 2), spin: 1, wob: 0.12, cx: 0, cz: 0 } });
  }
  for (let i = 0; i < 6; i++) {
    const r = 2.7 + 0.35 * (i % 3);
    const y = 1.2 + ((i * 5) % 6) * 0.95;
    const a0 = (i / 6) * PI * 2 + 0.2;
    const s = bipyramid(rng, 0.16 + rng.range(0, 0.06), 0.55 + rng.range(0, 0.3), 5).chamfer(0.02, rng, { skip: 0.3 }).translate([Math.cos(a0) * r, y, Math.sin(a0) * r]);
    pieces.push({ role: 'shard', part: PART.GLOW, polys: [s], orbit: { r, a0, turns: -1, bob: 0.2, bobCycles: 2 + (i % 3), spin: 2, cx: 0, cz: 0 } });
  }

  // ---- decals: a big sigil on the platform top (the camera looks down on it) and rune bands on the rim
  const sigil = loadTexture('tex_rune_b');
  const top = pl[9]!;
  const f = planeFrame(top.n, [0, 0, -1]);
  const decals: Decal[] = [{ plane: 30, o: [0, 0.55, 0], right: f.right, up: f.up, w: 6.2, h: 6.2, img: sigil, gain: 1, carve: 0.8, halo: 0.5 }];

  return {
    id: 'metin_great_suryeon',
    pieces,
    shade: { seed: 'great_suryeon', palette: PALETTE, decals, veins: 1.1, glowParts: [PART.GLOW], tipParts: [PART.PRONG], tipGain: 0.95, seams: 1, value: 1.2, tile: 2.2 },
    texSize: 2048,
    tune: { S: 2.6, seed: 'metin_great_suryeon', speed: 0.85 },
    emissiveFactor: [0.6, 0.2, 1.0],
    roughness: 0.58,
    extras: { metin: { glowMask: 'emissiveTexture', tint: 'material.emissive', pulseClip: 'pulse', great: true, debrisRadius: 5.5 } },
  };
}

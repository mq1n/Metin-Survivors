// metin_great_seori — Great Death Metin: a skeletal ice-black spinal pillar (stacked vertebrae with transverse spikes, ribs, a
// glowing teal spine core showing in the gaps, crowned by three curved spines) wrapped in spectral chains that spiral around it.
import { loadTexture } from '../../core/ext/metins/img.ts';
import { type Plane, Poly, fracture, sidePlane } from '../../core/ext/metins/poly.ts';
import type { Vec3 } from '../../core/math.ts';
import { vnorm, vcross } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { MetinSpec } from './build.ts';
import { bipyramid, groundCut, rock } from './geo.ts';
import { frustum, hideFacesAt, limbChain, orientedBox, prism } from './parts.ts';
import type { PieceDef } from './rig.ts';
import { type Decal, type Palette, planeFrame } from './shade.ts';

const PART = { BONE: 1, PLATFORM: 2, RUBBLE: 3, GLOW: 4, CHAIN: 5, RIB: 6 } as const;

const PALETTE: Palette = {
  shadow: [0.05, 0.08, 0.12],
  mid: [0.2, 0.32, 0.42],
  light: [0.5, 0.7, 0.82],
  edge: [0.86, 0.97, 1.0],
  ember: [0.06, 0.16, 0.2],
  glow: [0.35, 0.85, 0.95],
};

export function greatSeoriSpec(): MetinSpec {
  const rng = new Rng('metin_great_seori');
  const PI = Math.PI;
  const j = (a: number): number => rng.range(-a, a);
  const pieces: PieceDef[] = [];
  const chip = (p: Poly, size = 0.03, skip = 0.2): Poly => p.chamfer(size, rng, { jitter: 0.5, skip });

  // ---- frozen platform (lightning-crack sigil on top)
  const pl: Plane[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2 + j(0.05);
    pl.push(sidePlane(a, 3.0 * rng.range(0.94, 1.03), 0.55, 50 + i));
  }
  pl.push({ n: [0, 1, 0], d: 0.5, plane: 30 }, { n: [0, -1, 0], d: 0 });
  const platform = hideFacesAt(Poly.fromPlanes(pl) as Poly, 0);
  const pSeeds: Vec3[] = [[-1.5, 0.25, 0.4], [-0.4, 0.25, -1.4], [1.3, 0.25, -0.8], [1.5, 0.25, 0.9], [0.0, 0.25, 1.5], [0, 0.25, 0]];
  for (const c of fracture(platform, pSeeds, 0.05, 1)) pieces.push({ role: 'chunk', part: PART.PLATFORM, polys: [chip(c, 0.05)] });

  // ---- vertebrae: nine drums with transverse spikes and a spinous blade, curving slightly
  const N = 9;
  const y0 = 0.7;
  const pitch = 0.78;
  for (let k = 0; k < N; k++) {
    const t = k / (N - 1);
    const cy = y0 + k * pitch;
    const cx = 0.28 * Math.sin(k * 0.65), cz = 0.12 * Math.cos(k * 0.5);
    const rb = 1.2 - 0.5 * t;
    const body = prism(cx, cz, cy, cy + 0.52, rb, rb * 0.82, 6, rng, k * 0.31);
    const polys: Poly[] = [chip(body, 0.035, 0.1)];
    // transverse processes: two spikes out and slightly down
    const spike = (side: number): Poly => {
      const a: Vec3 = [cx + side * rb * 0.7, cy + 0.26, cz];
      const b: Vec3 = [cx + side * (rb + 0.95 - 0.5 * t), cy + 0.05, cz + 0.2 * Math.sin(k)];
      return frustum(a, b, 0.17 - 0.05 * t, 0.03, 4, { extendA: 0.1 });
    };
    polys.push(spike(1), spike(-1));
    // spinous blade pointing back and up
    polys.push(frustum([cx, cy + 0.4, cz - rb * 0.6], [cx - 0.1, cy + 0.9, cz - rb - 0.7 + 0.3 * t], 0.15 - 0.04 * t, 0.025, 4, { extendA: 0.1 }));
    pieces.push({ role: 'chunk', part: PART.BONE, polys });
  }
  const topY = y0 + (N - 1) * pitch + 0.52;

  // ---- ribs on vertebrae 2..4: arches sweeping outward and forward
  for (const k of [2, 3, 4]) {
    for (const side of [1, -1]) {
      const cy = y0 + k * pitch + 0.3;
      const path: Vec3[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        path.push([side * (0.55 + 1.2 * Math.sin(t * 1.35)), cy - 0.75 * t * t, 0.1 + 1.55 * (1 - Math.cos(t * 1.25)) * 0.9]);
      }
      pieces.push({ role: 'chunk', part: PART.RIB, polys: limbChain(path, 0.17, 0.045, 5, rng, 0.9).map((p) => chip(p, 0.015, 0.4)) });
    }
  }

  // ---- crown: three curved spines
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + 0.5;
    const path: Vec3[] = [];
    for (let s = 0; s <= 5; s++) {
      const t = s / 5;
      const rr = 0.25 + 0.95 * Math.sin(t * 1.2) * (1 - 0.25 * t);
      path.push([0.28 * Math.sin(8 * 0.65) + Math.cos(a) * rr, topY - 0.1 + 1.9 * t, Math.sin(a) * rr]);
    }
    pieces.push({ role: 'chunk', part: PART.BONE, polys: limbChain(path, 0.26, 0.03, 5, rng, 0.85).map((p) => chip(p, 0.02, 0.3)) });
  }

  // ---- glowing spine core (visible between vertebrae)
  const spine = frustum([0.0, 0.5, 0.0], [0.0, topY + 0.4, 0.0], 0.3, 0.22, 6, { rng });
  pieces.push({ role: 'core', part: PART.GLOW, polys: [spine], bob: { amp: 0.0, cycles: 1 } });
  // heart crystal at chest height, larger than the column so it shows through the rib gaps
  pieces.push({ role: 'core', part: PART.GLOW, polys: [bipyramid(rng, 0.55, 0.85, 6).chamfer(0.025, rng, { skip: 0.3 }).translate([0.2, y0 + 3.5 * pitch, 0.55])], bob: { amp: 0.1, cycles: 2 } });

  // ---- spectral chains: helix of flat links, three rigid turns that rotate around the pillar
  const turns = 3, perTurn = 28, R = 1.9;
  const hy0 = 0.9, hy1 = topY - 0.3;
  for (let tn = 0; tn < turns; tn++) {
    const polys: Poly[] = [];
    for (let i = 0; i < perTurn; i++) {
      const s = (tn * perTurn + i) / (turns * perTurn);
      const ang = s * turns * PI * 2;
      const y = hy0 + (hy1 - hy0) * s;
      const rad = R * (1 - 0.3 * s);
      const c: Vec3 = [Math.cos(ang) * rad, y, Math.sin(ang) * rad];
      const sp = turns * PI * 2;
      const tan = vnorm([-Math.sin(ang) * rad * sp, hy1 - hy0, Math.cos(ang) * rad * sp]);
      const radial = vnorm([c[0], 0, c[2]]);
      const bin = vnorm(vcross(tan, radial));
      const flat = i % 2 === 0;
      const ay = flat ? radial : bin;
      const az = flat ? bin : radial;
      polys.push(orientedBox(c, tan, ay, az, 0.2, 0.1, 0.045));
    }
    pieces.push({ role: 'shard', part: PART.CHAIN, polys, orbit: { r: 0, a0: 0, turns: 0, bob: 0, bobCycles: 1, spin: 1, wob: 0, cx: 0, cz: 0 } });
  }

  // ---- ice shards and rubble
  for (let i = 0; i < 6; i++) {
    const r = 3.2 + 0.4 * (i % 3);
    const y = 1.5 + ((i * 5) % 6) * 0.95;
    const a0 = (i / 6) * PI * 2 + 0.3;
    const s = bipyramid(rng, 0.16 + rng.range(0, 0.06), 0.6 + rng.range(0, 0.3), 5).chamfer(0.02, rng, { skip: 0.3 }).translate([Math.cos(a0) * r, y, Math.sin(a0) * r]);
    pieces.push({ role: 'shard', part: PART.GLOW, polys: [s], orbit: { r, a0, turns: i % 2 ? 1 : -1, bob: 0.2, bobCycles: 2 + (i % 3), spin: 2, cx: 0, cz: 0 } });
  }
  const rocks: Poly[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2 + j(0.2);
    const r = 3.8 + rng.range(0, 0.9);
    rocks.push(chip(groundCut(rock(rng, rng.range(0.25, 0.5), { flat: true, squash: 0.65 }), 0).translate([Math.cos(a) * r, 0, Math.sin(a) * r * 0.9]), 0.02, 0.15));
  }
  for (let i = 0; i < rocks.length; i += 2) pieces.push({ role: 'debris', part: PART.RUBBLE, polys: rocks.slice(i, i + 2) });

  // ---- decals: lightning-crack sigil on the platform top
  const f = planeFrame([0, 1, 0], [0, 0, -1]);
  const decals: Decal[] = [{ plane: 30, o: [0, 0.5, 0], right: f.right, up: f.up, w: 5.6, h: 5.6, img: loadTexture('tex_rune_c'), gain: 1, carve: 0.7, halo: 0.5 }];

  return {
    id: 'metin_great_seori',
    pieces,
    shade: { seed: 'great_seori', palette: PALETTE, decals, veins: 1.1, glowParts: [PART.GLOW, PART.CHAIN], tipParts: [PART.BONE], tipGain: 0.5, seams: 1, value: 1.25, tile: 2.0 },
    texSize: 2048,
    tune: { S: 2.8, seed: 'metin_great_seori', speed: 0.85 },
    emissiveFactor: [0.2, 0.85, 1.0],
    roughness: 0.5,
    extras: { metin: { glowMask: 'emissiveTexture', tint: 'material.emissive', pulseClip: 'pulse', great: true, debrisRadius: 5.5 } },
  };
}

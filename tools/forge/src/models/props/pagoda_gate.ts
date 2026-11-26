// prop_pagoda_gate — two-pillar temple gate (iljumun / paifang type), ~9.2 m tall, pillars at x = ±3.4 (z = 0), front = +Z.
// Granite plinths + lotus drums, red lacquered pillars with entasis, painted tie beams with a gold inscription board, bracket sets
// and outrigger beam ends, a wide hipped lower roof with upturned eaves, a plastered attic and a hip-and-gable upper roof with ridge horns.
import { circleShape, roundCorners } from '../../core/hard/shape2d.ts';
import { m4translation } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { cap, dougong, finial, mapBand, mapBoard, mapRing, pillar, prism, rectCorners, revolve, roofLoft, slab, sweepSolid } from '../../archetypes/prop/kit.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { dancheong, gold, lacquer, plaque, plaster, roofEdge, roofTile, stone, wood } from '../../archetypes/prop/mats.ts';
import { mapAuto, mapCylY } from '../../archetypes/prop/mesh.ts';
import type { PropMesh } from '../../archetypes/prop/mesh.ts';

const STONE = 0, PILLAR = 1, TILE = 2, EDGE = 3, SOFFIT = 4, DANCH = 5, GOLD = 6, PLAQUE = 7, PLASTER = 8, BEAM = 9, FRAME = 10, COUPLET = 11;

export interface GateOpts {
  /** half distance between the pillar axes (3.4 for the intact gate) */
  hs: number;
  /** build the attic + upper hip-and-gable roof */
  upper?: boolean;
  /** callback with the triangle range of every named part (pillarL, pillarR, beamLow, beamHigh, plaque, brackets, roofLower, attic, upperRoof) */
  part?: (name: string, from: number, to: number) => void;
}

export function gateMats(): PropDef['mats'] {
  return [
    stone('granite', { tex: ['tex_stone_block_wall', 'tex_rock_mossy'], dark: '#6c675e', light: '#c2b8a4', moss: 0.25, dirt: 0.4, wear: 0.5 }),
    lacquer('pillar', { vertical: true }),
    roofTile('tile', { moss: 0.12 }),
    roofEdge('roof-edge', { tile: 2.0 }),
    lacquer('soffit', { color: '#5c1812', wear: 0.2, dirt: 0 }),
    dancheong('dancheong'),
    gold('gold'),
    plaque('plaque', { cols: 3 }),
    plaster('plaster'),
    lacquer('beam', { color: '#9b2119', wear: 0.8 }),
    wood('frame', { tex: ['tex_wood_beam_dark', 'tex_wood_plank'], dark: '#2a1810', light: '#5c3b25', vertical: false }),
    plaque('couplet', { cols: 5, vertical: true }),
  ];
}

export const GATE_MAT = { STONE, PILLAR, TILE, EDGE, SOFFIT, DANCH, GOLD, PLAQUE, PLASTER, BEAM, FRAME, COUPLET };

export function buildGate(m: PropMesh, o: GateOpts): void {
  const wall = mapAuto(1.2);
  const PX = o.hs;
  const part = (name: string, from: number): void => o.part?.(name, from, m.triCount);
  // ---- pillars: plinth, lotus drum, lacquered shaft
  for (const sx of [-1, 1]) {
    const x = sx * PX;
    const t0 = m.triCount;
    prism(m, STONE, wall, [[x - 0.78, -0.78], [x + 0.78, -0.78], [x + 0.78, 0.78], [x - 0.78, 0.78]], 0, 0.42, { bevel: 0.04 });
    m.add(
      revolve(roundCorners([[0.64, 0.42], [0.72, 0.48], [0.7, 0.58], [0.6, 0.72], [0.52, 0.84]], 0.02, 1, false), 14),
      STONE, mapCylY(x, 0, 0.65, 1.2), m4translation([x, 0, 0]),
    );
    m.add(revolve(pillar(0.5, 0.42, 4.3, 0.05, 5), 16), PILLAR, mapCylY(x, 0, 0.46, 1.6), m4translation([x, 0.84, 0]));
    // gold bands above the lotus drum and under the tie beam, painted collar between them
    const ring = (y0: number, y1: number, r: number, mat: number, mp: ReturnType<typeof mapCylY>): void => {
      m.add(revolve([[r, y0], [r, y1]], 16), mat, mp, m4translation([x, 0, 0]));
    };
    ring(3.24, 3.3, 0.5, GOLD, mapCylY(x, 0, 0.5, 0.6));
    ring(3.3, 3.62, 0.495, DANCH, mapRing(x, 0, 0.495, 3.62, 0.32));
    ring(3.62, 3.68, 0.5, GOLD, mapCylY(x, 0, 0.5, 0.6));
    part(sx < 0 ? 'pillarL' : 'pillarR', t0);
  }
  // ---- vertical couplet boards on the pillar fronts (and backs)
  {
    const tc = m.triCount;
    const cw = 0.4, y1 = 3.1, ch = 1.9;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * PX;
      slab(m, COUPLET, mapBoard(sz > 0 ? x - cw / 2 : x + cw / 2, sz > 0 ? cw : -cw, y1, ch), [cw, ch, 0.07], [x, y1 - ch / 2, sz * 0.47]);
    }
    part('couplet', tc);
  }
  // ---- tie beams, inscription boards, painted fronts
  const beam = (y0: number, y1: number, hx: number, d: number, name: string): void => {
    const t0 = m.triCount;
    slab(m, BEAM, wall, [hx * 2, y1 - y0, d], [0, (y0 + y1) / 2, 0]);
    for (const sz of [-1, 1]) slab(m, DANCH, mapBand(y1 - 0.025, y1 - y0 - 0.05, 'x', y1 - y0 - 0.05), [hx * 2 - 0.5, y1 - y0 - 0.05, 0.03], [0, (y0 + y1) / 2, sz * (d / 2 + 0.012)]);
    part(name, t0);
  };
  beam(3.7, 4.14, PX + 0.65, 0.34, 'beamLow');
  beam(4.72, 5.12, PX + 0.95, 0.42, 'beamHigh');
  const t1 = m.triCount;
  const pw = PX * 0.9;
  for (const sz of [-1, 1]) {
    slab(m, FRAME, wall, [pw + 0.2, 0.72, 0.07], [0, 4.4, sz * 0.2]);
    slab(m, PLAQUE, mapBoard(-pw / 2, pw, 4.69, 0.6), [pw, 0.6, 0.03], [0, 4.4, sz * 0.2 + sz * 0.045]);
  }
  part('plaque', t1);
  // ---- bracket sets + outrigger beam ends under the eaves
  const t2 = m.triCount;
  for (const sz of [-1, 1]) {
    for (const bx of [-PX, -PX * 0.32, PX * 0.32, PX]) {
      dougong(m, { block: BEAM, arm: DANCH }, wall, [bx, 5.12, sz * 0.3], 1.0, sz > 0 ? 0 : Math.PI);
    }
    for (const bx of [-PX, 0, PX]) {
      slab(m, BEAM, wall, [0.26, 0.3, 1.6], [bx, 5.5, sz * 0.98]);
      slab(m, DANCH, mapBand(5.62, 0.24, 'x', 0.24), [0.28, 0.24, 0.03], [bx, 5.5, sz * 1.79]);
    }
  }
  part('brackets', t2);
  // ---- lower roof: wide hip with upturned corners, truncated into a flat top for the attic
  const roofMats = { top: TILE, fascia: EDGE, under: SOFFIT };
  const t3 = m.triCount;
  const lower = roofLoft(m, {
    corners: rectCorners(PX + 1.75, 2.0),
    stages: [{ f: 1, corners: rectCorners(PX - 0.2, 0.95) }],
    y0: 5.75, rise: 1.0, q: 1.5, rings: 4, segs: [10, 4, 10, 4],
    lift: 0.5, flare: 0.3, reach: 0.3, thick: 0.2, soffit: 1.3, tile: 2.0, mats: roofMats,
  });
  for (const path of lower.hips) cap(m, TILE, path, 0.09, wall, 4);
  cap(m, TILE, [...lower.hips.map((p) => p[p.length - 1]!), lower.hips[0]![lower.hips[0]!.length - 1]!], 0.075, wall, 4);
  for (const path of lower.hips) beastTile(m, path[0]!);
  part('roofLower', t3);
  if (o.upper === false) return;
  // ---- attic
  const t4 = m.triCount;
  const ay0 = 6.7, ay1 = 7.4;
  slab(m, PLASTER, wall, [2 * PX - 0.5, ay1 - ay0, 1.82], [0, (ay0 + ay1) / 2, 0]);
  for (const sx of [-1, -0.34, 0.34, 1]) for (const sz of [-1, 1]) slab(m, BEAM, wall, [0.22, ay1 - ay0 + 0.1, 0.12], [sx * (PX - 0.3), (ay0 + ay1) / 2, sz * 0.94]);
  for (const sz of [-1, 1]) {
    for (const wx of [-PX * 0.56, 0, PX * 0.56]) {
      slab(m, FRAME, wall, [1.1, 0.5, 0.06], [wx, 7.05, sz * 0.93]);
      slab(m, PLASTER, wall, [0.84, 0.34, 0.03], [wx, 7.05, sz * 0.96]);
    }
  }
  slab(m, BEAM, wall, [2 * PX - 0.3, 0.14, 2.0], [0, ay1 + 0.03, 0]);
  part('attic', t4);
  // ---- upper roof: hip-and-gable with vertical gable walls at the x ends
  const t5 = m.triCount;
  const gx = PX - 0.5;
  const upper = roofLoft(m, {
    corners: rectCorners(PX + 0.75, 1.8),
    stages: [{ f: 0.5, corners: rectCorners(gx, 1.25) }, { f: 1, corners: [[-gx, 0], [gx, 0], [gx, 0], [-gx, 0]] }],
    y0: 7.45, rise: 1.3, q: 1.45, rings: 4, segs: [8, 3, 8, 3],
    lift: 0.4, flare: 0.22, reach: 0.3, thick: 0.18, soffit: 1.0, tile: 2.0, mats: roofMats,
    gable: { edges: [1, 3], mat: PLASTER, fromF: 0.5 },
    gableMap: mapAuto(1.2),
  });
  for (const path of upper.hips) cap(m, TILE, path, 0.075, wall, 4);
  const ridgeY = upper.crest[0]![1];
  cap(m, TILE, [[-gx, ridgeY, 0], [gx, ridgeY, 0]], 0.1, wall, 5);
  for (const path of upper.hips) beastTile(m, path[0]!);
  for (const sx of [-1, 1]) chiwen(m, TILE, sx, gx, ridgeY);
  finial(m, GOLD, [0, ridgeY + 0.04, 0], 0.42, 0.14, wall);
  part('upperRoof', t5);
}

export const prop: PropDef = {
  id: 'prop_pagoda_gate',
  aoGain: 1.7,
  shadowTint: [0.56, 0.5, 0.52],
  size: 1536,
  aoLong: 2.6,
  crease: 36,
  mats: gateMats(),
  build: (m) => buildGate(m, { hs: 3.4 }),
};

/** curled ridge horn (chiwen) at the +x/-x ridge end */
function chiwen(m: PropMesh, mat: number, sx: number, hx: number, y: number): void {
  const x = hx * sx;
  const pts: Vec3[] = [[x - sx * 0.1, y - 0.02, 0], [x + sx * 0.04, y + 0.16, 0], [x + sx * 0.12, y + 0.34, 0], [x + sx * 0.04, y + 0.5, 0], [x - sx * 0.14, y + 0.54, 0], [x - sx * 0.26, y + 0.44, 0]];
  m.add(sweepSolid(circleShape(0.12, 5), pts, { scale: (t) => 1.25 - 0.85 * t }), mat, mapAuto(1.2));
}

/** small bulb at the end of a hip ridge (5-sided, ~30 tris) */
function beastTile(m: PropMesh, at: Vec3): void {
  const pts: [number, number][] = [[0, 0], [0.1, 0], [0.04, 0.2], [0, 0.34]];
  m.add(revolve(pts, 4), TILE, mapAuto(1.2), m4translation([at[0], at[1] + 0.02, at[2]]));
}

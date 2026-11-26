// prop_hall_tiled — two-storey red-tiled hall on a stepped granite platform (13 x 9 m footprint, ~10 m tall, front = +Z):
// lacquered pillar colonnade with lattice doors, a skirt roof with upturned corners, a plastered upper storey with windows,
// and a big hip-and-gable roof with a ridge cap, horns and a gold finial.
import { m4translation } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { circleShape } from '../../core/hard/shape2d.ts';
import { cap, extrude, finial, lathe, mapBand, mapBoard, prism, rectCorners, revolve, roofLoft, slab, stairs, sweepSolid } from '../../archetypes/prop/kit.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { dancheong, gold, lacquer, lattice, plaster, roofEdge, roofTile, stone, timberPlaster, wood } from '../../archetypes/prop/mats.ts';
import { mapAuto } from '../../archetypes/prop/mesh.ts';
import type { PropMesh } from '../../archetypes/prop/mesh.ts';

const STONE = 0, PILLAR = 1, TILE = 2, EDGE = 3, SOFFIT = 4, DANCH = 5, GOLD = 6, PLASTER = 7, BEAM = 8, FRAME = 9, LATTICE = 10, TIMBER = 11, FLOOR = 12;

export const prop: PropDef = {
  id: 'prop_hall_tiled',
  aoGain: 1.7,
  shadowTint: [0.56, 0.5, 0.52],
  size: 2048,
  aoLong: 3.4,
  crease: 36,
  mats: [
    stone('granite', { tex: ['tex_stone_block_wall', 'tex_plaza_tile', 'tex_rock_mossy'], dark: '#716b60', light: '#c9bfab', moss: 0.2, dirt: 0.45, wear: 0.5 }),
    lacquer('pillar', { vertical: true }),
    roofTile('tile', { moss: 0.1 }),
    roofEdge('roof-edge', { tile: 2.6 }),
    lacquer('soffit', { color: '#5c1812', wear: 0.2, dirt: 0 }),
    dancheong('dancheong'),
    gold('gold'),
    plaster('plaster'),
    lacquer('beam', { color: '#9b2119', wear: 0.8 }),
    wood('frame', { dark: '#2a1810', light: '#5c3b25' }),
    lattice('lattice', { cell: 0.11, bar: 0.011 }),
    timberPlaster('timber-plaster', { studs: 0.9, rails: 1.1 }),
    stone('floor', { tex: ['tex_plaza_tile'], dark: '#6d665a', light: '#b9ae98', dirt: 0.2 }),
  ],
  build(m) {
    const wall = mapAuto(1.3);
    // ---- platform (13 x 9): two moulded tiers + front stairs with sloped cheek walls
    prism(m, STONE, wall, rectCorners(6.5, 4.5), 0, 0.46, { bevel: 0.05 });
    prism(m, STONE, wall, rectCorners(6.2, 4.2), 0.46, 0.92, { bevel: 0.05 });
    stairs(m, STONE, wall, [0, 0, 4.2], 3.4, 5, 0.34, 0.184);
    for (const sx of [-1, 1]) {
      const cheek = extrude([[0, 0], [0, 1.7], [0.92, 0]], 0.3, { axis: 'x' });
      m.add(cheek, STONE, wall, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, sx * 1.85 - 0.15, 0, 4.2, 1]);
    }
    const FY = 0.92;
    // ---- ground-floor colonnade: 5 pillars front/back, 1 mid-side; lattice doors in the front bays, plaster elsewhere
    const px = [-5.3, -2.65, 0, 2.65, 5.3];
    const pillarAt = (x: number, z: number): void => {
      m.add(lathe([[0.2, 0], [0.24, 0.3], [0.22, 2.4], [0.2, 2.8]], { segments: 8 }), PILLAR, mapAuto(1.3), m4translation([x, FY, z]));
      slab(m, STONE, wall, [0.5, 0.18, 0.5], [x, FY + 0.09, z]);
    };
    for (const z of [-3.3, 3.3]) for (const x of px) pillarAt(x, z);
    for (const x of [-5.3, 5.3]) pillarAt(x, 0);
    // walls recessed behind the colonnade
    slab(m, PLASTER, wall, [10.6, 2.5, 0.2], [0, FY + 1.35, -3.2]);
    for (const sx of [-1, 1]) slab(m, PLASTER, wall, [0.2, 2.5, 6.4], [sx * 5.2, FY + 1.35, 0]);
    slab(m, PLASTER, wall, [2.65, 2.5, 0.2], [-3.98, FY + 1.35, 3.2]);
    slab(m, PLASTER, wall, [2.65, 2.5, 0.2], [3.98, FY + 1.35, 3.2]);
    for (const dx of [-1.325, 1.325]) {
      slab(m, FRAME, wall, [2.2, 2.2, 0.14], [dx, FY + 1.2, 3.16]);
      slab(m, LATTICE, mapBoard(dx - 1.0, 2.0, FY + 2.2, 2.0), [2.0, 2.0, 0.04], [dx, FY + 1.2, 3.25]);
    }
    // door centre bay stays open (dark interior) -> recessed dark panel
    slab(m, FRAME, wall, [2.4, 2.3, 0.1], [0, FY + 1.25, 3.0]);
    // tie beam + painted frieze all round
    const FZ = FY + 2.8;
    for (const sz of [-1, 1]) {
      slab(m, BEAM, wall, [11.2, 0.34, 0.4], [0, FZ + 0.1, sz * 3.3]);
      slab(m, DANCH, mapBand(FZ + 0.23, 0.28, 'x', 0.28), [10.8, 0.28, 0.03], [0, FZ + 0.1, sz * 3.3 + sz * 0.22]);
    }
    for (const sx of [-1, 1]) {
      slab(m, BEAM, wall, [0.4, 0.34, 6.8], [sx * 5.3, FZ + 0.1, 0]);
      slab(m, DANCH, mapBand(FZ + 0.23, 0.28, 'z', 0.28), [0.03, 0.28, 6.4], [sx * 5.3 + sx * 0.22, FZ + 0.1, 0]);
    }
    // cantilever beam ends under the skirt eaves
    for (const x of px) for (const sz of [-1, 1]) slab(m, BEAM, wall, [0.24, 0.26, 1.0], [x, FZ + 0.4, sz * 3.9]);
    // ---- skirt roof
    const mats = { top: TILE, fascia: EDGE, under: SOFFIT };
    const skirt = roofLoft(m, {
      corners: rectCorners(6.4, 4.4),
      stages: [{ f: 1, corners: rectCorners(4.6, 2.6) }],
      y0: FZ + 0.55, rise: 0.85, q: 1.4, rings: 4, segs: [12, 6, 12, 6],
      lift: 0.42, flare: 0.28, reach: 0.28, thick: 0.18, soffit: 1.2, tile: 2.6, mats,
    });
    for (const path of skirt.hips) cap(m, TILE, path, 0.085, wall, 4);
    for (const path of skirt.hips) beastTile(m, path[0]!);
    // ---- upper storey: timber-framed plaster with windows
    const UY0 = FZ + 0.55 + 0.8, UY1 = UY0 + 1.75;
    slab(m, TIMBER, wall, [9.2, UY1 - UY0, 5.2], [0, (UY0 + UY1) / 2, 0]);
    for (const sx of [-4.6, -2.3, 0, 2.3, 4.6]) for (const sz of [-2.6, 2.6]) slab(m, BEAM, wall, [0.24, UY1 - UY0 + 0.1, 0.24], [sx, (UY0 + UY1) / 2, sz]);
    for (const sx of [-4.6, 4.6]) slab(m, BEAM, wall, [0.24, UY1 - UY0 + 0.1, 0.24], [sx, (UY0 + UY1) / 2, 0]);
    for (const sz of [-1, 1]) {
      for (const wx of [-3.45, -1.15, 1.15, 3.45]) {
        slab(m, FRAME, wall, [1.6, 0.95, 0.06], [wx, UY0 + 0.95, sz * 2.62]);
        slab(m, LATTICE, mapBoard(wx - 0.7, 1.4, UY0 + 1.35, 0.8), [1.4, 0.8, 0.03], [wx, UY0 + 0.95, sz * 2.65]);
      }
    }
    slab(m, BEAM, wall, [9.8, 0.16, 5.8], [0, UY1 + 0.05, 0]);
    slab(m, DANCH, mapBand(UY1 - 0.0, 0.3, 'x', 0.3), [9.4, 0.28, 0.03], [0, UY1 - 0.15, 2.62]);
    slab(m, DANCH, mapBand(UY1 - 0.0, 0.3, 'x', 0.3), [9.4, 0.28, 0.03], [0, UY1 - 0.15, -2.62]);
    // ---- upper roof: hip-and-gable
    const upper = roofLoft(m, {
      corners: rectCorners(5.9, 3.7),
      stages: [{ f: 0.5, corners: rectCorners(3.9, 2.2) }, { f: 1, corners: [[-3.9, 0], [3.9, 0], [3.9, 0], [-3.9, 0]] }],
      y0: UY1 + 0.3, rise: 2.7, q: 1.45, rings: 4, segs: [12, 6, 12, 6],
      lift: 0.5, flare: 0.3, reach: 0.28, thick: 0.2, soffit: 1.1, tile: 2.6, mats,
      gable: { edges: [1, 3], mat: TIMBER, fromF: 0.5 },
      gableMap: mapAuto(1.3),
    });
    for (const path of upper.hips) cap(m, TILE, path, 0.095, wall, 4);
    const ridgeY = upper.crest[0]![1];
    cap(m, TILE, [[-3.9, ridgeY, 0], [3.9, ridgeY, 0]], 0.12, wall, 5);
    for (const path of upper.hips) beastTile(m, path[0]!);
    for (const sx of [-1, 1]) horn(m, TILE, sx, 3.9, ridgeY);
    finial(m, GOLD, [0, ridgeY + 0.05, 0], 0.5, 0.17, wall);
    void FLOOR; void circleShape;
  },
};

function horn(m: PropMesh, mat: number, sx: number, hx: number, y: number): void {
  const x = hx * sx;
  const pts: Vec3[] = [[x - sx * 0.12, y - 0.02, 0], [x + sx * 0.05, y + 0.2, 0], [x + sx * 0.14, y + 0.42, 0], [x + sx * 0.05, y + 0.62, 0], [x - sx * 0.16, y + 0.66, 0], [x - sx * 0.3, y + 0.54, 0]];
  m.add(sweepSolid(circleShape(0.14, 5), pts, { scale: (t) => 1.25 - 0.85 * t }), mat, mapAuto(1.3));
}

function beastTile(m: PropMesh, at: Vec3): void {
  m.add(revolve([[0, 0], [0.11, 0], [0.045, 0.22], [0, 0.38]], 4), TILE, mapAuto(1.3), m4translation([at[0], at[1] + 0.02, at[2]]));
}

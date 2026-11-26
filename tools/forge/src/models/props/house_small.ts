// prop_house_small — single-storey tiled village house (6.5 x 5 m footprint, ~6 m tall, front = +Z): granite plinth, timber-framed plaster
// walls with a lattice door and two windows, an open porch under the extended front eave, hip-and-gable tiled roof with ridge horns.
import { circleShape } from '../../core/hard/shape2d.ts';
import { m4translation } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { cap, finial, mapBand, mapBoard, prism, rectCorners, revolve, roofLoft, slab, stairs, sweepSolid } from '../../archetypes/prop/kit.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { dancheong, gold, lacquer, lattice, roofEdge, roofTile, stone, timberPlaster, wood } from '../../archetypes/prop/mats.ts';
import { mapAuto } from '../../archetypes/prop/mesh.ts';
import type { PropMesh } from '../../archetypes/prop/mesh.ts';

const STONE = 0, POST = 1, TILE = 2, EDGE = 3, SOFFIT = 4, DANCH = 5, GOLD = 6, TIMBER = 7, FRAME = 8, LATTICE = 9, DARK = 10;

export const prop: PropDef = {
  id: 'prop_house_small',
  aoGain: 1.7,
  shadowTint: [0.56, 0.5, 0.52],
  size: 1536,
  aoLong: 2.4,
  crease: 36,
  mats: [
    stone('granite', { tex: ['tex_stone_block_wall', 'tex_rock_mossy'], dark: '#6c675e', light: '#c2b8a4', moss: 0.25, dirt: 0.45, wear: 0.5 }),
    lacquer('post', { vertical: true }),
    roofTile('tile', { moss: 0.15 }),
    roofEdge('roof-edge'),
    lacquer('soffit', { color: '#5c1812', wear: 0.2, dirt: 0 }),
    dancheong('dancheong'),
    gold('gold'),
    timberPlaster('timber-plaster', { studs: 0.8, rails: 1.2 }),
    wood('frame', { tex: ['tex_wood_beam_dark', 'tex_wood_plank'], dark: '#2a1810', light: '#5c3b25' }),
    lattice('lattice', { cell: 0.12, bar: 0.012 }),
    wood('dark-wood', { tex: ['tex_wood_beam_dark', 'tex_wood_plank'], dark: '#2b1b12', light: '#4e3322' }),
  ],
  build(m) {
    const wall = mapAuto(1.3);
    // ---- plinth + front steps
    prism(m, STONE, wall, rectCorners(3.25, 2.5), 0, 0.5, { bevel: 0.05 });
    stairs(m, STONE, wall, [0, 0, 2.5], 1.7, 2, 0.34, 0.25);
    // ---- walls: framed plaster body, wainscot, corner/mid posts
    const y0 = 0.5, h = 2.6;
    slab(m, TIMBER, wall, [5.0, h, 3.6], [0, y0 + h / 2, -0.05]);
    slab(m, DARK, wall, [5.06, 0.7, 3.66], [0, y0 + 0.35, -0.05]);
    for (const sx of [-2.5, -0.9, 0.9, 2.5]) for (const sz of [-1.85, 1.75]) slab(m, POST, wall, [0.2, h + 0.1, 0.2], [sx, y0 + h / 2, sz]);
    for (const sx of [-2.5, 2.5]) slab(m, POST, wall, [0.2, h + 0.1, 0.2], [sx, y0 + h / 2, -0.05]);
    // porch posts (front, under the extended eave)
    for (const sx of [-2.5, 2.5]) slab(m, POST, wall, [0.24, h + 0.1, 0.24], [sx, y0 + h / 2, 2.55]);
    // door (centre bay) and windows
    slab(m, FRAME, wall, [1.5, 2.1, 0.1], [0, y0 + 1.05 + 0.1, 1.78]);
    slab(m, LATTICE, mapBoard(-0.65, 1.3, y0 + 2.1, 1.9), [1.3, 1.9, 0.04], [0, y0 + 1.1, 1.84]);
    for (const wx of [-1.7, 1.7]) {
      slab(m, FRAME, wall, [0.9, 0.9, 0.08], [wx, y0 + 1.5, 1.78]);
      slab(m, LATTICE, mapBoard(wx - 0.38, 0.76, y0 + 1.88, 0.76), [0.76, 0.76, 0.03], [wx, y0 + 1.5, 1.83]);
    }
    // eave beam + painted frieze
    slab(m, POST, wall, [5.5, 0.3, 4.1], [0, y0 + h + 0.12, 0]);
    slab(m, POST, wall, [0.28, 0.3, 1.4], [-2.5, y0 + h + 0.12, 2.3]);
    slab(m, POST, wall, [0.28, 0.3, 1.4], [2.5, y0 + h + 0.12, 2.3]);
    slab(m, DANCH, mapBand(y0 + h + 0.25, 0.26, 'x', 0.26), [5.1, 0.26, 0.03], [0, y0 + h + 0.12, 1.92]);
    slab(m, DANCH, mapBand(y0 + h + 0.25, 0.26, 'x', 0.26), [5.1, 0.26, 0.03], [0, y0 + h + 0.12, -2.02]);
    // ---- roof: hip-and-gable, front eave extended over the porch (asymmetric rectangle)
    const zF = 3.1, zB = -2.3, xE = 3.7;
    const cz = (zF + zB) / 2;
    const mats = { top: TILE, fascia: EDGE, under: SOFFIT };
    const roof = roofLoft(m, {
      corners: [[-xE, zF], [xE, zF], [xE, zB], [-xE, zB]],
      stages: [
        { f: 0.5, corners: [[-2.7, cz + 1.55], [2.7, cz + 1.55], [2.7, cz - 1.55], [-2.7, cz - 1.55]] },
        { f: 1, corners: [[-2.7, cz], [2.7, cz], [2.7, cz], [-2.7, cz]] },
      ],
      y0: y0 + h + 0.42, rise: 2.0, q: 1.45, rings: 4, segs: [8, 3, 8, 3],
      lift: 0.38, flare: 0.22, reach: 0.3, thick: 0.17, soffit: 1.0, tile: 1.5, mats,
      gable: { edges: [1, 3], mat: TIMBER, fromF: 0.5 },
      gableMap: mapAuto(1.3),
    });
    for (const path of roof.hips) cap(m, TILE, path, 0.07, wall, 4);
    const ry = roof.crest[0]![1];
    cap(m, TILE, [[-2.7, ry, cz], [2.7, ry, cz]], 0.09, wall, 5);
    for (const sx of [-1, 1]) horn(m, TILE, sx, 2.7, ry, cz);
    finial(m, GOLD, [0, ry + 0.03, cz], 0.3, 0.11, wall);
  },
};

function horn(m: PropMesh, mat: number, sx: number, hx: number, y: number, z: number): void {
  const x = hx * sx;
  const pts: Vec3[] = [[x - sx * 0.08, y - 0.02, z], [x + sx * 0.03, y + 0.13, z], [x + sx * 0.09, y + 0.27, z], [x + sx * 0.03, y + 0.4, z], [x - sx * 0.1, y + 0.43, z], [x - sx * 0.2, y + 0.35, z]];
  m.add(sweepSolid(circleShape(0.09, 5), pts, { scale: (t) => 1.25 - 0.85 * t }), mat, mapAuto(1.3));
}

void m4translation; void revolve;

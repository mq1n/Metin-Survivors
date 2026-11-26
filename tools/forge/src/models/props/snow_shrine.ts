// prop_snow_shrine — small roadside shrine buried in snow (2.5 m): granite plinth with steps, lacquered posts around a lattice-doored
// sanctum, a hip roof with upturned eaves under a thick snow blanket, icicles along the eaves and drifts around the base. Front = +Z.
import { m4translation } from '../../core/math.ts';
import { cap, finial, mapBoard, prism, rectCorners, revolve, roofLoft, slab, stairs } from '../../archetypes/prop/kit.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { fbm01, gold, lacquer, lattice, mixc, mulc, pickTex, rgb, roofEdge, roofTile, stone, wood } from '../../archetypes/prop/mats.ts';
import { type Mat, mapAuto, mapCylY } from '../../archetypes/prop/mesh.ts';

const STONE = 0, POST = 1, TILE = 2, EDGE = 3, SOFFIT = 4, GOLD = 5, FRAME = 6, LATTICE = 7, SNOW = 8, ICE = 9, WALL = 10;

function snowMat(): Mat {
  const a = rgb('#f3f8fc'), b = rgb('#bdd0e3');
  return { name: 'snow', ao: 0.6, shade: (t) => mulc(mixc(b, a, 0.45 + 0.55 * t.n[1]), 0.92 + 0.12 * fbm01(t, 8, 3, 1.7)) };
}

function iceMat(): Mat {
  const T = pickTex('tex_ice_blue');
  return {
    name: 'ice',
    ao: 0.4,
    shade: (t) => (T ? mulc(t.tex(T, 1), 1.5) : mulc(rgb('#8fc9ee'), 0.9 + 0.2 * fbm01(t, 12, 2, 2.2))),
    emit: () => mulc(rgb('#5fb4ff'), 0.12),
  };
}

export const prop: PropDef = {
  id: 'prop_snow_shrine',
  yScale: 0.95,
  size: 1024,
  aoLong: 1.8,
  crease: 36,
  mats: [
    stone('granite', { tex: ['tex_stone_block_wall', 'tex_rock_frozen'], dark: '#6a6a72', light: '#bcc2cc', snow: 0.55, moss: 0, dirt: 0.2, wear: 0.5, k: 0.8 }),
    lacquer('post', { vertical: true, color: '#8c261e', wear: 1.1, dirt: 0.5 }),
    roofTile('tile', { moss: 0.1, snow: 0.6, tint: '#f0d8cc' }),
    roofEdge('roof-edge'),
    lacquer('soffit', { color: '#4a1a15', wear: 0.3, dirt: 0 }),
    gold('gold'),
    wood('frame', { tex: ['tex_wood_beam_dark', 'tex_wood_plank'], dark: '#2a1810', light: '#5c3b25', snow: 0.4 }),
    lattice('lattice', { cell: 0.14, bar: 0.014 }),
    snowMat(),
    iceMat(),
    wood('wall-wood', { tex: ['tex_wood_beam_dark', 'tex_wood_plank'], dark: '#35251a', light: '#6a4a30', snow: 0.3 }),
  ],
  emissiveFactor: [1, 1, 1],
  build(m) {
    const wall = mapAuto(1.0);
    prism(m, STONE, wall, rectCorners(0.95, 0.8), 0, 0.3, { bevel: 0.04 });
    stairs(m, STONE, wall, [0, 0, 0.8], 0.9, 2, 0.26, 0.15);
    // sanctum: dark wood box, four posts, framed double doors
    const y0 = 0.3;
    slab(m, WALL, wall, [1.15, 1.0, 0.95], [0, y0 + 0.5, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) slab(m, POST, wall, [0.14, 1.12, 0.14], [sx * 0.62, y0 + 0.56, sz * 0.5]);
    slab(m, FRAME, wall, [0.84, 0.86, 0.06], [0, y0 + 0.5, 0.5]);
    slab(m, LATTICE, mapBoard(-0.38, 0.76, y0 + 0.88, 0.76), [0.76, 0.76, 0.03], [0, y0 + 0.5, 0.53]);
    slab(m, POST, wall, [1.3, 0.12, 1.1], [0, y0 + 1.08, 0]);
    // roof
    const roof = roofLoft(m, {
      corners: rectCorners(1.4, 1.2),
      stages: [{ f: 1, corners: [[-0.25, 0], [0.25, 0], [0.25, 0], [-0.25, 0]] }],
      y0: y0 + 1.28, rise: 0.78, q: 1.5, rings: 4, segs: [6, 4, 6, 4],
      lift: 0.2, flare: 0.14, reach: 0.3, thick: 0.1, soffit: 0.6, tile: 0.9,
      mats: { top: TILE, fascia: EDGE, under: SOFFIT },
    });
    for (const path of roof.hips) cap(m, TILE, path, 0.04, wall, 4);
    const ry = roof.crest[0]![1];
    cap(m, TILE, [[-0.25, ry, 0], [0.25, ry, 0]], 0.05, wall, 5);
    finial(m, GOLD, [0, ry + 0.03, 0], 0.26, 0.07, wall);
    // snow lumps on the roof ridge/hips, drifts at the base, icicles under the front/back eaves
    const blob = (x: number, y: number, z: number, r: number, h: number, ph: number): void => {
      m.add(revolve([[0, 0], [r, 0], [r * 0.9, h * 0.45], [r * 0.5, h * 0.9], [0, h]], 8, (th) => 1 + 0.2 * Math.sin(th * 3 + ph)), SNOW, mapCylY(x, z, r, 1), m4translation([x, y, z]));
    };
    blob(0, ry - 0.04, 0, 0.36, 0.16, 0.4);
    blob(0.9, 0, 0.9, 0.55, 0.28, 1.2);
    blob(-0.95, 0, 0.7, 0.45, 0.22, 2.1);
    blob(0.1, 0, -1.05, 0.6, 0.3, 3.0);
    blob(-0.9, 0, -0.5, 0.4, 0.2, 0.7);
    const ey = roof.eave.reduce((a, p) => Math.min(a, p[1]), 9) - 0.1;
    for (const [x, z, h] of [[-1.0, 1.15, 0.22], [-0.55, 1.2, 0.3], [0.0, 1.22, 0.18], [0.5, 1.2, 0.32], [1.0, 1.15, 0.2], [-0.6, -1.2, 0.26], [0.2, -1.2, 0.3], [0.8, -1.15, 0.2]] as [number, number, number][]) {
      m.add(revolve([[0, -h], [0.03, -h * 0.5], [0.05, 0]], 4), ICE, wall, m4translation([x, ey + 0.1, z]));
    }
  },
};

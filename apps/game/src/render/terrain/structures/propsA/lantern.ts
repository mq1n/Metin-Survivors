// stone_lantern (3.4 m): lotus base, octagonal shaft with collars, lit fire chamber, curved eaves cap and jewel finial.
import { MeshBuilder, paint, lit } from '../geom/builder';
import { KIND } from '../geom/kinds';
import { curvedRoof, roofPoly, DEFAULT_CURVE } from '../geom/roof';
import { box, boxAt, lathe } from '../geom/shapes';
import { archMaterial, paletteFor, stoneTextures } from '../palette';
import type { StructureBuildContext, StructureDef, StructureModel } from '../types';

function build(ctx: StructureBuildContext): StructureModel {
  const pal = paletteFor(ctx.zone);
  const b = new MeshBuilder(11);
  const stone = paint(pal.stone, KIND.stone, 0, 0.05);
  const stoneD = paint(pal.stoneDark, KIND.stone, 0, 0.05);
  const stoneL = paint(pal.stoneLight, KIND.stone, 0, 0.04);
  const glow = paint(pal.paper, KIND.lattice, 0.85, 0);
  const o8 = { faceted: true, phase: 0 };

  // stepped base + lotus pedestal
  lathe(b, [[0.62, -0.15], [0.62, 0.1], [0.55, 0.18], [0.46, 0.18]], 8, stoneD, o8);
  lathe(
    b,
    [[0.46, 0.18], [0.5, 0.24], [0.52, 0.32], [0.47, 0.42], [0.36, 0.5], [0.24, 0.55]],
    16,
    stoneL,
    { shade: (p) => 0.9 + 0.1 * Math.cos(Math.atan2(p[2], p[0]) * 8) },
  );
  // shaft with three collars
  lathe(
    b,
    [[0.24, 0.55], [0.2, 0.62], [0.2, 0.95], [0.27, 0.98], [0.27, 1.06], [0.19, 1.09], [0.18, 1.42], [0.24, 1.45], [0.24, 1.52], [0.18, 1.55], [0.17, 1.7]],
    8,
    stone,
    o8,
  );
  // inverted lotus seat under the fire chamber
  lathe(b, [[0.17, 1.7], [0.3, 1.76], [0.46, 1.86], [0.52, 1.95], [0.5, 1.99], [0, 1.99]], 16, stoneL, {
    shade: (p) => 0.9 + 0.1 * Math.cos(Math.atan2(p[2], p[0]) * 8),
  });
  // fire chamber: octagon with four lit openings
  const R = 0.4;
  lathe(b, [[R, 1.99], [R, 2.5], [R + 0.05, 2.53], [0.2, 2.53]], 8, stone, o8);
  const apothem = R * Math.cos(Math.PI / 8);
  for (let k = 0; k < 8; k += 2) {
    const a = (k + 0.5) * (Math.PI / 4);
    b.at(apothem * Math.cos(a), 2.04, -apothem * Math.sin(a), a + Math.PI / 2);
    box(b, 0.2, 0.36, 0.03, glow);
    box(b, 0.27, 0.04, 0.06, stoneL, { y0: 0.34 });
    box(b, 0.27, 0.04, 0.06, stoneL, { y0: -0.02 });
    for (const sx of [-0.115, 0.115]) boxAt(b, sx, 0, 0, 0.04, 0.36, 0.06, stoneL);
    b.pop();
  }

  // eaves cap: eight-sided curved roof
  b.at(0, 2.5, 0);
  const style = {
    tile: paint(pal.stone, KIND.tile, 0, 0.04),
    under: lit(stoneD, 0.8),
    fascia: stoneD,
    end: stone,
    ridge: stone,
  };
  curvedRoof(b, {
    ...roofPoly(8, 0.82, 0, Math.PI / 8),
    curve: { ...DEFAULT_CURVE, rise: 0.46, sag: 1.5, tip: 0.05, tipSpan: 0.16, corner: 0.12, cornerPow: 2, flare: 0.05, thick: 0.1 },
    style,
    nu: 3,
    nv: 4,
    hipR: 0.045,
    noEnd: true,
  });
  b.pop();
  // jewel finial
  lathe(b, [[0, 2.96], [0.1, 2.96], [0.12, 3.02], [0.09, 3.07], [0.17, 3.15], [0.19, 3.22], [0.13, 3.32], [0.05, 3.4], [0, 3.42]], 10, stoneL);

  const geometry = b.build({ cell: 0.1, reach: 0.9, strength: 0.5 });
  return { parts: [{ geometry, material: archMaterial(ctx, pal), castShadow: true }] };
}

export const STONE_LANTERN: StructureDef = { build, zoneTextures: stoneTextures };

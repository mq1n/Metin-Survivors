// house_small (6 m): single-storey tiled house on a stone plinth: plaster walls in a timber frame, lattice door and
// windows, front porch under the eave, hip roof with upturned corners. lamp_post (4.2 m): wooden post on a stone foot
// with an iron bracket and a lit yellow paper lantern.
import { makePaints, stairs } from '../geom/arch';
import { MeshBuilder, paint } from '../geom/builder';
import { KIND } from '../geom/kinds';
import { chiwen, curvedRoof, eaveTail } from '../geom/roof';
import { box, boxAt, cylinder, lathe, quadZ, tube } from '../geom/shapes';
import { archMaterial, paletteFor, stoneTextures } from '../palette';
import type { StructureBuildContext, StructureDef, StructureModel } from '../types';
import { windowZ } from './hall';

function buildHouse(ctx: StructureBuildContext): StructureModel {
  const pal = paletteFor(ctx.zone);
  const P = makePaints(pal);
  const b = new MeshBuilder(41);
  const Y0 = 0.42;

  b.label('plinth');
  boxAt(b, 0, -0.5, 0, 6.5, Y0 + 0.5, 5.0, P.masonry, { bevel: 0.05 });
  b.at(0, 0, 3.2);
  stairs(b, P, 1.9, 2, 0.21, 0.4, false);
  b.pop();

  b.label('walls');
  const zf = 1.5;
  boxAt(b, 0, Y0, -0.35, 5.7, 2.7, 4.3, P.plaster);
  // timber frame: corner posts, mid posts, tie beams
  for (const x of [-2.85, 2.85]) for (const z of [zf, -2.2]) boxAt(b, x, Y0, z, 0.3, 2.7, 0.3, P.timber);
  for (const x of [-1.0, 1.0]) boxAt(b, x, Y0, zf + 0.02, 0.2, 2.7, 0.22, P.timber);
  boxAt(b, 0, Y0 + 2.5, -0.35, 5.95, 0.22, 4.55, P.timberDark);
  boxAt(b, 0, Y0, -0.35, 5.95, 0.12, 4.55, P.timberDark);
  boxAt(b, 0, Y0 + 1.15, zf + 0.04, 5.7, 0.1, 0.12, P.timber);
  // door + windows (front), windows (sides)
  quadZ(b, -0.78, Y0 + 0.12, 1.56, 2.0, zf + 0.07, P.paper);
  boxAt(b, 0, Y0 + 2.12, zf + 0.07, 1.9, 0.18, 0.16, P.lacquer);
  boxAt(b, 0, Y0 + 0.12, zf + 0.09, 0.06, 2.0, 0.06, P.timberDark);
  for (const x of [-2.0, 2.0]) windowZ(b, P, x, Y0 + 1.0, 1.0, 1.0, zf + 0.07);
  for (const sx of [-1, 1]) {
    b.at(sx * 2.85, 0, -0.35);
    b.rotY(sx * (Math.PI / 2));
    windowZ(b, P, 0, Y0 + 1.0, 1.2, 1.0, 0.04);
    b.pop();
  }

  b.label('porch');
  for (const x of [-1.5, 1.5]) {
    b.at(x, 0, 2.4);
    box(b, 0.5, 0.14, 0.5, P.stoneLight, { y0: Y0 });
    cylinder(b, 0.14, 2.45, 8, P.lacquer, { y0: Y0 + 0.14, r2: 0.12 });
    b.pop();
  }
  boxAt(b, 0, Y0 + 2.5, 2.4, 3.4, 0.24, 0.3, P.lacquer);

  b.label('roof');
  b.at(0, Y0 + 2.7, 0);
  const roof = curvedRoof(b, {
    corners: [[-3.9, 3.0], [3.9, 3.0], [3.9, -3.0], [-3.9, -3.0]],
    ridge: [[-2.0, 0], [2.0, 0], [2.0, 0], [-2.0, 0]],
    curve: { rise: 2.05, sag: 1.55, tip: 0.16, tipSpan: 0.14, corner: 0.5, cornerPow: 3, flare: 0.3, thick: 0.3 },
    style: P.roof,
    nu: 6,
    nv: 4,
    hipR: 0.13,
    ridgeR: 0.17,
  });
  b.label('tails');
  for (const t of roof.tips) eaveTail(b, t, [t[0], t[2]], 1.1, P.roof.ridge);
  chiwen(b, [-2.0, 2.05 + 0.08, 0], -1, 0.8, P.roof.ridge, P.gold);
  chiwen(b, [2.0, 2.05 + 0.08, 0], 1, 0.8, P.roof.ridge, P.gold);
  b.pop();

  const geometry = b.build();
  return { parts: [{ geometry, material: archMaterial(ctx, pal), castShadow: true }] };
}

function buildLampPost(ctx: StructureBuildContext): StructureModel {
  const pal = paletteFor(ctx.zone);
  const P = makePaints(pal);
  const b = new MeshBuilder(43);
  const iron = paint('#3b3835', KIND.metal, 0, 0.03);
  const paperLit = paint('#ffc768', KIND.cloth, 0.6, 0.02);

  b.label('post');
  box(b, 0.55, 0.4, 0.55, P.stone, { bevel: 0.04, y0: -0.1 });
  box(b, 0.36, 0.14, 0.36, P.stoneLight, { bevel: 0.03, y0: 0.3 });
  box(b, 0.2, 3.7, 0.2, P.timberDark, { bevel: 0.025, y0: 0.44, top: [0.15, 0.15] });
  box(b, 0.3, 0.1, 0.3, P.gold, { y0: 4.0 });
  // iron arm with brace and chain
  b.label('arm');
  boxAt(b, 0.48, 3.62, 0, 1.05, 0.08, 0.08, iron);
  tube(b, [[0.1, 3.2, 0], [0.5, 3.6, 0]], 0.035, 4, iron, { caps: false });
  tube(b, [[0.9, 3.62, 0], [0.9, 3.35, 0]], 0.012, 3, iron, { caps: false });
  // paper lantern: ribbed ellipsoid with lacquered caps
  b.label('lantern');
  b.at(0.9, 2.78, 0);
  lathe(b, [[0.0, 0.0], [0.1, 0.0], [0.22, 0.08], [0.28, 0.28], [0.22, 0.5], [0.1, 0.57], [0, 0.57]], 8, paperLit, {
    faceted: true,
    shade: (p) => 0.85 + 0.15 * Math.cos(Math.atan2(p[2], p[0]) * 8),
  });
  cylinder(b, 0.12, 0.05, 8, P.lacquerDark, { y0: 0.55 });
  cylinder(b, 0.12, 0.05, 8, P.lacquerDark, { y0: -0.03 });
  tube(b, [[0, -0.03, 0], [0, -0.28, 0]], 0.014, 3, P.lacquer, { caps: false });
  b.pop();

  const geometry = b.build({ cell: 0.1, reach: 0.9, strength: 0.5 });
  return { parts: [{ geometry, material: archMaterial(ctx, pal), castShadow: true }] };
}

export const HOUSE_SMALL: StructureDef = { build: buildHouse, zoneTextures: stoneTextures };
export const LAMP_POST: StructureDef = { build: buildLampPost, zoneTextures: stoneTextures };

// hall_tiled (10 m): two-storey hall on a masonry platform (footprint 13 × 9, front +Z). Ground floor: lacquered porch
// colonnade, plaster walls, lattice doors / windows; a skirt roof; a plaster upper storey; a big hip roof with
// ridge ornaments and upturned corners.
import { makePaints, stairs, type Paints } from '../geom/arch';
import { MeshBuilder } from '../geom/builder';
import { chiwen, curvedRoof, eaveTail } from '../geom/roof';
import { box, boxAt, cylinder, quadZ } from '../geom/shapes';
import { archMaterial, paletteFor, stoneTextures } from '../palette';
import type { StructureBuildContext, StructureDef, StructureModel } from '../types';

/** lattice window on a wall plane facing +Z (call inside b.at / yaw for other walls): paper panel + lintel rail */
export function windowZ(b: MeshBuilder, P: Paints, cx: number, y: number, w: number, h: number, z: number): void {
  quadZ(b, cx - w / 2, y, w, h, z, P.paper);
  boxAt(b, cx, y + h, z, w + 0.24, 0.16, 0.14, P.lacquer);
  boxAt(b, cx, y - 0.1, z, w + 0.2, 0.1, 0.16, P.lacquerDark);
}

function build(ctx: StructureBuildContext): StructureModel {
  const pal = paletteFor(ctx.zone);
  const P = makePaints(pal);
  const b = new MeshBuilder(31);
  const Y0 = 0.8; // platform top

  // --- platform + stair flight --------------------------------------------------------------------------------------
  b.label('platform');
  boxAt(b, 0, -0.7, 0, 13, Y0 + 0.7, 9, P.masonry, { bevel: 0.07 });
  b.at(0, 0, 5.85);
  stairs(b, P, 3.2, 3, 0.27, 0.45);
  b.pop();

  // --- ground floor body ----------------------------------------------------------------------------------------------
  b.label('walls');
  const zf = 2.4; // front wall plane
  boxAt(b, 0, Y0, -0.6, 10.6, 3.3, 6.0, P.plaster);
  // corner and bay posts
  for (const x of [-5.3, 5.3]) for (const z of [zf, -3.6]) boxAt(b, x, Y0, z, 0.36, 3.3, 0.36, P.lacquer);
  for (const x of [-3.4, -1.15, 1.15, 3.4]) boxAt(b, x, Y0, zf + 0.02, 0.24, 3.3, 0.26, P.lacquer);
  // lattice doors (centre bay) and windows
  quadZ(b, -1.05, Y0 + 0.1, 2.1, 2.7, zf + 0.06, P.paper);
  boxAt(b, 0, Y0 + 2.8, zf + 0.06, 2.5, 0.2, 0.2, P.lacquerDark);
  boxAt(b, 0, Y0 + 0.1, zf + 0.07, 0.07, 2.7, 0.07, P.lacquerDark);
  for (const x of [-4.4, -2.3, 2.3, 4.4]) windowZ(b, P, x, Y0 + 1.0, 1.3, 1.5, zf + 0.06);
  // side + back windows
  for (const sx of [-1, 1]) {
    b.at(sx * 5.3, 0, -0.6);
    b.rotY(sx * (Math.PI / 2));
    for (const x of [-1.8, 1.8]) windowZ(b, P, x, Y0 + 1.0, 1.3, 1.5, 0.04);
    b.pop();
  }
  b.at(0, 0, -3.6);
  b.rotY(Math.PI);
  for (const x of [-3.3, -1.1, 1.1, 3.3]) windowZ(b, P, x, Y0 + 1.0, 1.3, 1.5, 0.04);
  b.pop();

  // --- porch colonnade ------------------------------------------------------------------------------------------------
  b.label('porch');
  const zc = 3.6;
  for (const x of [-5, -3, -1, 1, 3, 5]) {
    b.at(x, 0, zc);
    box(b, 0.62, 0.16, 0.62, P.stoneLight, { y0: Y0 });
    cylinder(b, 0.25, 3.0, 10, P.lacquer, { y0: Y0 + 0.16, r2: 0.22 });
    cylinder(b, 0.27, 0.12, 10, P.gold, { y0: Y0 + 0.18 });
    b.pop();
  }
  boxAt(b, 0, Y0 + 3.2, zc, 10.9, 0.34, 0.4, P.lacquer);
  boxAt(b, 0, Y0 + 3.54, zc, 11.0, 0.09, 0.44, P.gold);
  boxAt(b, 0, Y0 + 3.0, zc, 10.7, 0.2, 0.3, P.accent);

  // --- skirt roof (truncated hip at the porch/body) ----------------------------------------------------------------
  b.label('roofLow');
  const yLow = Y0 + 3.4;
  b.at(0, yLow, 0);
  const low = curvedRoof(b, {
    corners: [[-7.1, 4.8], [7.1, 4.8], [7.1, -4.6], [-7.1, -4.6]],
    ridge: [[-4.9, 2.3], [4.9, 2.3], [4.9, -2.3], [-4.9, -2.3]],
    curve: { rise: 1.0, sag: 1.45, tip: 0.2, tipSpan: 0.14, corner: 0.75, cornerPow: 3, flare: 0.4, thick: 0.36 },
    style: P.roof,
    nu: 6,
    nv: 4,
    hipR: 0.15,
  });
  b.label('tails');
  for (const t of low.tips) eaveTail(b, t, [t[0], t[2]], 1.4, P.roof.ridge);
  b.pop();

  // --- upper storey -----------------------------------------------------------------------------------------------------
  b.label('upper');
  const yUp = yLow + 0.95;
  boxAt(b, 0, yUp, 0, 9.6, 2.4, 4.4, P.plaster);
  boxAt(b, 0, yUp + 2.25, 0, 9.9, 0.2, 4.7, P.lacquerDark);
  boxAt(b, 0, yUp, 0, 9.9, 0.16, 4.7, P.lacquerDark);
  for (const x of [-4.8, -2.4, 0, 2.4, 4.8]) boxAt(b, x, yUp, 2.2, 0.26, 2.4, 0.26, P.lacquer);
  for (const x of [-3.6, -1.2, 1.2, 3.6]) windowZ(b, P, x, yUp + 0.55, 1.5, 1.3, 2.23);
  for (const sx of [-1, 1]) {
    b.at(sx * 4.8, 0, 0);
    b.rotY(sx * (Math.PI / 2));
    windowZ(b, P, 0, yUp + 0.55, 1.5, 1.3, 0.03);
    b.pop();
  }

  // --- main hip roof ------------------------------------------------------------------------------------------------------
  b.label('roofUp');
  const yTop = yUp + 2.35;
  b.at(0, yTop, 0);
  const up = curvedRoof(b, {
    corners: [[-6.7, 4.4], [6.7, 4.4], [6.7, -4.4], [-6.7, -4.4]],
    ridge: [[-3.7, 0], [3.7, 0], [3.7, 0], [-3.7, 0]],
    curve: { rise: 2.3, sag: 1.55, tip: 0.2, tipSpan: 0.14, corner: 0.8, cornerPow: 3, flare: 0.42, thick: 0.38 },
    style: P.roof,
    nu: 6,
    nv: 4,
    hipR: 0.17,
    ridgeR: 0.22,
  });
  b.label('tails');
  for (const t of up.tips) eaveTail(b, t, [t[0], t[2]], 1.5, P.roof.ridge);
  b.label('orn');
  chiwen(b, [-3.7, 2.3 + 0.12, 0], -1, 1.15, P.roof.ridge, P.gold);
  chiwen(b, [3.7, 2.3 + 0.12, 0], 1, 1.15, P.roof.ridge, P.gold);
  b.pop();

  const geometry = b.build();
  return { parts: [{ geometry, material: archMaterial(ctx, pal), castShadow: true }] };
}

export const HALL_TILED: StructureDef = { build, zoneTextures: stoneTextures };

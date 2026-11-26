// pagoda_gate (9 m): two lacquered pillars on stone feet, tie beam + painted lintel with a name tablet, a bracket band,
// a truncated lower hip roof (skirt) and a smaller upper hip roof with ridge ornaments. Faces +Z, passage ≈ 5.8 m clear.
import { bracket, makePaints, plinth, shaft, tablet, type Paints } from '../geom/arch';
import { MeshBuilder } from '../geom/builder';
import { chiwen, curvedRoof, eaveTail, type RoofCurve } from '../geom/roof';
import { boxAt, lathe } from '../geom/shapes';
import { archMaterial, paletteFor, stoneTextures } from '../palette';
import type { StructureBuildContext, StructureDef, StructureModel } from '../types';

export const GATE_X = 3.4;

/** the skirt roof: eaves 12.4 × 4.8, truncated at a rectangular ring where the attic starts */
export function gateLowerRoof(b: MeshBuilder, P: Paints, y: number, rise: number): { tips: Array<[number, number, number]> } {
  const curve: RoofCurve = { rise, sag: 1.45, tip: 0.2, tipSpan: 0.14, corner: 0.75, cornerPow: 3, flare: 0.4, thick: 0.38 };
  b.label('roofLow');
  b.at(0, y, 0);
  const r = curvedRoof(b, {
    corners: [[-6.2, 2.4], [6.2, 2.4], [6.2, -2.4], [-6.2, -2.4]],
    ridge: [[-3.9, 1.15], [3.9, 1.15], [3.9, -1.15], [-3.9, -1.15]],
    curve,
    style: P.roof,
    nu: 6,
    nv: 4,
    hipR: 0.16,
  });
  b.label('tails');
  for (const t of r.tips) eaveTail(b, t, [t[0], t[2]], 1.5, P.roof.ridge);
  b.pop();
  return { tips: r.tips.map((t) => [t[0], t[1] + y, t[2]]) };
}

/** attic block + upper hip roof; returns the ridge end positions for ornaments */
export function gateUpper(b: MeshBuilder, P: Paints, y: number): void {
  b.label('attic');
  boxAt(b, 0, y, 0, 7.8, 0.8, 2.2, P.plaster);
  boxAt(b, 0, y + 0.66, 0, 7.95, 0.14, 2.35, P.lacquerDark);
  boxAt(b, 0, y - 0.02, 0, 7.95, 0.1, 2.35, P.lacquerDark);
  for (const x of [-3.7, -1.85, 0, 1.85, 3.7]) boxAt(b, x, y, 0, 0.26, 0.8, 2.3, P.lacquer);
  const eave = y + 0.8;
  b.label('roofUp');
  b.at(0, eave, 0);
  const r = curvedRoof(b, {
    corners: [[-5.1, 2.1], [5.1, 2.1], [5.1, -2.1], [-5.1, -2.1]],
    ridge: [[-2.3, 0], [2.3, 0], [2.3, 0], [-2.3, 0]],
    curve: { rise: 1.05, sag: 1.5, tip: 0.18, tipSpan: 0.14, corner: 0.6, cornerPow: 3, flare: 0.34, thick: 0.32 },
    style: P.roof,
    nu: 6,
    nv: 4,
    hipR: 0.14,
    ridgeR: 0.19,
  });
  b.label('tails');
  for (const t of r.tips) eaveTail(b, t, [t[0], t[2]], 1.3, P.roof.ridge);
  b.label('orn');
  chiwen(b, [-2.3, 1.05 + 0.1, 0], -1, 1.0, P.roof.ridge, P.gold);
  chiwen(b, [2.3, 1.05 + 0.1, 0], 1, 1.0, P.roof.ridge, P.gold);
  lathe(b, [[0, 1.12], [0.16, 1.12], [0.2, 1.2], [0.13, 1.32], [0.07, 1.46], [0, 1.52]], 8, P.gold, { crease: 120 });
  b.pop();
}

function build(ctx: StructureBuildContext): StructureModel {
  const pal = paletteFor(ctx.zone);
  const P = makePaints(pal);
  const b = new MeshBuilder(21);
  const X = GATE_X;

  b.label('cols');
  for (const sx of [-1, 1]) {
    b.at(sx * X, 0, 0);
    plinth(b, P, 0.95, 0.56);
    shaft(b, P, 0.56, 4.9, 0.5, 0.42);
    b.pop();
  }
  b.label('beams');
  // tie beam and painted lintel
  boxAt(b, 0, 3.45, 0, 2 * X, 0.42, 0.36, P.lacquer, { bevel: 0.03 });
  boxAt(b, 0, 3.45 + 0.42, 0, 2 * X, 0.07, 0.4, P.gold, { bevel: 0.01 });
  boxAt(b, 0, 5.02, 0, 2 * X + 1.4, 0.5, 0.52, P.accent, { bevel: 0.035 });
  boxAt(b, 0, 5.02, 0, 2 * X + 1.5, 0.06, 0.56, P.gold, { bevel: 0.01 });
  boxAt(b, 0, 5.46, 0, 2 * X + 1.5, 0.06, 0.56, P.gold, { bevel: 0.01 });
  b.label('tablet');
  // hanging name tablet (front and back)
  b.at(0, 4.0, 0.0);
  b.at(0, 0, 0.26);
  tablet(b, P, 2.6, 0.92, 4);
  b.pop();
  b.at(0, 0, -0.26);
  b.rotY(Math.PI);
  tablet(b, P, 2.6, 0.92, 4);
  b.pop();
  b.pop();
  b.label('brackets');
  // bracket band
  for (let i = -3; i <= 3; i++) {
    b.at((i * X) / 3, 5.52, 0);
    bracket(b, P, 1.05, 1.7, i % 3 === 0);
    b.pop();
  }
  boxAt(b, 0, 6.08, 0, 2 * X + 1.9, 0.22, 0.9, P.lacquerDark, { bevel: 0.03 });
  boxAt(b, 0, 6.08, 0, 2 * X + 2.0, 0.05, 1.0, P.gold, { bevel: 0.01 });

  gateLowerRoof(b, P, 6.3, 0.9);
  gateUpper(b, P, 7.12);

  const geometry = b.build();
  return { parts: [{ geometry, material: archMaterial(ctx, pal), castShadow: true }] };
}

export const PAGODA_GATE: StructureDef = { build, zoneTextures: stoneTextures };

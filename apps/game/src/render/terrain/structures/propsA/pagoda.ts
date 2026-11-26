// giant_pagoda (62 m landmark): a seven-tier octagonal tower on a two-tier masonry platform with a front stair. Every tier
// is a plaster drum with lacquered corner posts, lattice windows on the lower tiers, a gold band and a curved eight-sided
// roof whose corners flick up; the crown is a stack of gold rings (相轮) with a jewel. Faces +Z; platform apothem 13.5 m
// matches the blocker circle. Detail falls off with height: the sim camera never sees the upper tiers closely.
import { makePaints, stairs } from '../geom/arch';
import { MeshBuilder } from '../geom/builder';
import { curvedRoof, eaveTail, roofPoly } from '../geom/roof';
import { boxAt, lathe } from '../geom/shapes';
import { archMaterial, paletteFor, stoneTextures } from '../palette';
import type { StructureBuildContext, StructureDef, StructureModel } from '../types';
import { windowZ } from './hall';

const OCT = Math.PI / 8;
const TIERS = 7;

function build(ctx: StructureBuildContext): StructureModel {
  const pal = paletteFor(ctx.zone);
  const P = makePaints(pal);
  const b = new MeshBuilder(81);

  // --- platform ---------------------------------------------------------------------------------------------------------
  b.label('platform');
  lathe(
    b,
    [[14.6, -1.5], [14.6, 1.8], [14.3, 2.0], [12.2, 2.0], [12.2, 3.4], [11.9, 3.6], [0, 3.6]],
    8,
    P.masonry,
    { faceted: true, phase: OCT },
  );
  // two flights on the front (+Z) face
  b.at(0, 0, 13.49 + 3.0);
  stairs(b, P, 5.6, 5, 0.4, 0.6, true);
  b.pop();
  b.at(0, 2.0, 11.27 + 2.0);
  stairs(b, P, 5.0, 4, 0.4, 0.5, true);
  b.pop();

  // --- tiers ------------------------------------------------------------------------------------------------------------
  let y = 3.6;
  for (let i = 0; i < TIERS; i++) {
    const hb = 6.2 - 0.4 * i;
    const rise = 2.0 - 0.08 * i;
    const rb = 7.8 - 0.85 * i;
    const re = rb + 4.6 - 0.2 * i;
    const rtop = i < TIERS - 1 ? 7.8 - 0.85 * (i + 1) + 0.6 : 1.3;
    const ap = rb * Math.cos(OCT);

    b.label('bodies');
    lathe(b, [[rb, y], [rb, y + hb]], 8, P.plaster, { faceted: true, phase: OCT });
    // plinth band, gold band and dark lintel band
    lathe(b, [[rb + 0.25, y], [rb + 0.25, y + 0.45], [rb, y + 0.45]], 8, P.stoneDark, { faceted: true, phase: OCT });
    lathe(b, [[rb + 0.14, y + hb - 0.9], [rb + 0.14, y + hb - 0.25], [rb, y + hb - 0.25]], 8, P.lacquerDark, { faceted: true, phase: OCT });
    lathe(b, [[rb + 0.18, y + hb - 0.35], [rb + 0.18, y + hb - 0.2], [rb, y + hb - 0.2]], 8, P.gold, { faceted: true, phase: OCT });

    b.label('posts');
    for (let k = 0; k < 8; k++) {
      const a = OCT + k * (Math.PI / 4);
      b.at(rb * Math.cos(a), y, -rb * Math.sin(a), a + Math.PI / 2);
      boxAt(b, 0, 0.45, 0, 0.6, hb - 0.45, 0.6, P.lacquer);
      b.pop();
    }

    if (i < 4) {
      b.label('windows');
      for (let k = 0; k < 8; k++) {
        if (i > 0 && k % 2 === 1) continue;
        const a = k * (Math.PI / 4);
        b.at(ap * Math.cos(a), y, -ap * Math.sin(a), a + Math.PI / 2);
        windowZ(b, P, 0, 1.7, 2.6 - 0.2 * i, 2.8 - 0.25 * i, 0.03);
        b.pop();
      }
    }

    b.label('roofs');
    b.at(0, y + hb, 0);
    const spec = roofPoly(8, re, rtop, -OCT);
    const roof = curvedRoof(b, {
      corners: spec.corners,
      ridge: spec.ridge,
      curve: { rise, sag: 1.5, tip: 0.3, tipSpan: 0.14, corner: 1.1 - 0.06 * i, cornerPow: 3, flare: 0.6, thick: 0.55 },
      style: P.roof,
      nu: 4,
      nv: 4,
      hipR: 0.2,
      noUnder: i > 3,
      noEnd: i > 4,
    });
    b.label('tails');
    roof.tips.forEach((t, k) => {
      if (i < 3 || k % 2 === 0) eaveTail(b, t, [t[0], t[2]], 2.0 - 0.1 * i, P.roof.ridge);
    });
    b.pop();
    y += hb + rise - 0.1;
  }

  // --- crown: lotus bowl, stacked gold rings, jewel -------------------------------------------------------------------
  b.label('crown');
  lathe(b, [[1.5, y], [2.3, y + 0.3], [2.0, y + 0.9], [0.9, y + 1.3], [0, y + 1.3]], 8, P.gold, { faceted: true, phase: OCT });
  lathe(b, [[0.22, y + 1.3], [0.22, y + 9.0]], 6, P.timberDark);
  for (let k = 0; k < 8; k++) {
    const r = 1.4 - 0.1 * k;
    const yy = y + 1.8 + k * 0.85;
    lathe(b, [[r, yy], [r, yy + 0.22], [0.25, yy + 0.3]], 8, P.gold, { faceted: true, phase: OCT });
  }
  lathe(b, [[0.5, y + 8.7], [0.7, y + 8.95], [0.4, y + 9.3], [0.55, y + 9.7], [0.2, y + 10.2], [0, y + 10.6]], 8, P.gold, { crease: 120 });

  const geometry = b.build({ cell: 0.6, reach: 4, strength: 0.5 });
  return { parts: [{ geometry, material: archMaterial(ctx, pal), castShadow: true }] };
}

export const GIANT_PAGODA: StructureDef = { build, zoneTextures: stoneTextures };

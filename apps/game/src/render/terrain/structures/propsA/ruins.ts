// Plague ruins of seori: broken_gate (half-collapsed pagoda gate) and ruined_shrine (collapsed hall with a sickly green glow).
// Same toolkit as the intact buildings, with snapped shafts (jagged displaced breaks over an exposed timber core), a slumped
// roof, fallen beams, tattered banners and snow drifts. Faded lacquer, frosted tiles; the snow overlay comes from the palette.
import { makePaints, plinth, shaft, stairs, type Paints } from '../geom/arch';
import { MeshBuilder, lit, paint, type Paint, type Vec3 } from '../geom/builder';
import { KIND } from '../geom/kinds';
import { curvedRoof, eaveTail, roofRect } from '../geom/roof';
import { box, boxAt, cylinder, ellipsoid, jag, lathe, ribbon } from '../geom/shapes';
import { archMaterial, paletteFor, stoneTextures, type ArchPalette } from '../palette';
import type { StructureBuildContext, StructureDef, StructureModel } from '../types';

/** weathered variant of a paint set: lacquer faded to dusty red, timber bleached */
function weathered(P: Paints): Paints {
  return {
    ...P,
    lacquer: lit(P.lacquer, 0.82),
    lacquerDark: lit(P.lacquerDark, 0.85),
    timber: lit(P.timber, 1.15),
  };
}

/** snow drift lump (flattened ellipsoid) */
function drift(b: MeshBuilder, x: number, z: number, rx: number, ry: number, rz: number, yaw: number, p: Paint): void {
  b.at(x, ry * 0.25, z, yaw);
  ellipsoid(b, rx, ry, rz, p, { rings: 3, segs: 8 });
  b.pop();
}

/** column with a snapped, jagged top over an exposed timber core; `h` = height of the break */
function snappedColumn(b: MeshBuilder, P: Paints, r: number, h: number, seed: number): void {
  plinth(b, P, r + 0.4, 0.56);
  shaft(b, P, 0.56, h - 0.56, r, r * 0.9, false);
  const m = b.mark();
  lathe(b, [[r * 0.72, h - 0.02], [r * 0.7, h + 0.55], [0, h + 0.55]], 8, P.timber, { faceted: true });
  b.displace(m, (p) => {
    if (p[1] > h + 0.2) p[1] += jag(p[0] + seed, p[2]) * 0.3 + 0.1 * Math.sign(p[0] - 0.05);
  }).recomputeNormals(m);
  // splintered outer shell
  const m2 = b.mark();
  lathe(b, [[r * 0.9, h - 0.02], [r * 0.88, h + 0.18], [r * 0.72, h + 0.18]], 8, P.lacquer, { faceted: true });
  b.displace(m2, (p) => {
    p[1] += Math.abs(jag(p[0] * 1.7 + seed, p[2] * 1.3)) * 0.22;
  }).recomputeNormals(m2);
}

// --- broken_gate ---------------------------------------------------------------------------------------------------------
function buildBrokenGate(ctx: StructureBuildContext): StructureModel {
  const pal = paletteFor('seori');
  const P = weathered(makePaints(pal));
  const b = new MeshBuilder(71);

  b.label('left');
  b.at(-3.2, 0, 0);
  plinth(b, P, 0.9, 0.56);
  shaft(b, P, 0.56, 4.7, 0.5, 0.43);
  boxAt(b, 0, 5.1, 0, 1.0, 0.26, 0.9, P.accent);
  b.pop();
  // tie beam stub still pinned to the standing pillar
  boxAt(b, -2.2, 3.5, 0, 1.9, 0.42, 0.36, P.lacquer);

  b.label('right');
  b.at(2.6, 0, 0);
  snappedColumn(b, P, 0.42, 2.5, 3.1);
  b.pop();

  b.label('fallen');
  // lintel hanging from the standing pillar down onto the rubble
  b.at(-2.9, 3.9, 0);
  b.rotZ(-0.62);
  box(b, 4.6, 0.42, 0.36, P.lacquer, { bevel: 0.03, axis: 0 });
  b.pop();
  // upper shaft lying in the snow
  b.at(3.9, 0.46, 1.9);
  b.rotY(0.5);
  b.rotZ(Math.PI / 2);
  cylinder(b, 0.45, 2.7, 9, P.lacquer, { y0: -1.35, bottom: true, faceted: true });
  b.pop();

  b.label('roof');
  // slumped skirt roof: hinged on the standing pillar, resting on the broken one
  b.at(-3.3, 5.35, 0);
  b.rotZ(-0.43);
  b.translate(3.2, 0, 0);
  const roof = curvedRoof(b, {
    corners: [[-3.2, 2.2], [3.2, 2.2], [3.2, -2.2], [-3.2, -2.2]],
    ridge: [[-1.6, 0], [1.6, 0], [1.6, 0], [-1.6, 0]],
    curve: { rise: 1.0, sag: 1.45, tip: 0.18, tipSpan: 0.14, corner: 0.5, cornerPow: 3, flare: 0.3, thick: 0.34 },
    style: { ...P.roof, tile: lit(P.roof.tile, 0.95) },
    nu: 5,
    nv: 4,
    hipR: 0.13,
    ridgeR: 0.16,
  });
  b.label('tails');
  for (const t of roof.tips.slice(0, 2)) eaveTail(b, t, [t[0], t[2]], 1.0, P.roof.ridge);
  b.pop();

  b.label('rubble');
  for (let i = 0; i < 9; i++) {
    const a = i * 2.1;
    boxAt(b, 1.6 + jag(i, 1) * 2.6, 0.02, 0.7 + jag(i, 4) * 2.0, 0.55, 0.18, 0.4, P.roof.tile, {}, a);
  }
  drift(b, 3.4, -0.3, 1.5, 0.45, 1.0, 0.3, P.plaster);
  drift(b, -3.4, 1.1, 1.1, 0.35, 0.8, -0.5, P.plaster);
  drift(b, 0.3, -1.0, 1.7, 0.4, 0.9, 0.1, P.plaster);

  b.label('banner');
  const m = b.mark();
  const pts: Vec3[] = [];
  for (let i = 0; i <= 5; i++) pts.push([-3.3 + Math.sin(i * 0.9) * 0.08, 3.5 - i * 0.55, 0.35 + i * 0.03]);
  const cloth = paint('#7a2a28', KIND.cloth, 0, 0.05);
  ribbon(b, pts, 0.7, [0, 0, 1], cloth);
  ribbon(b, pts, 0.7, [0, 0, -1], cloth);
  b.displace(m, (p) => {
    if (p[1] < 1.2) p[1] += jag(p[0] * 9, p[2]) * 0.18;
  });

  const geometry = b.build();
  return { parts: [{ geometry, material: archMaterial(ctx, pal), castShadow: true }] };
}

// --- ruined_shrine -------------------------------------------------------------------------------------------------------

/** wall run along +x, centred, with a jagged broken top; origin at the foot centre */
function brokenWall(b: MeshBuilder, len: number, h: number, thick: number, face: Paint, cap: Paint, seed: number): void {
  const nu = Math.max(4, Math.round(len / 0.7));
  const top = (u: number): number => {
    const k = Math.floor(u * nu);
    const n = (jag(k + seed, seed * 1.7) + 1) / 2;
    const taper = 0.55 + 0.45 * Math.sin(u * Math.PI);
    return h * (0.35 + 0.65 * n * taper);
  };
  const x = (u: number): number => (u - 0.5) * len;
  // heights stepped per column so the break reads as missing masonry
  const hs = (u: number): number => top(Math.min(0.9999, Math.round(u * nu - 0.5) / nu + 0.5 / nu));
  b.grid(nu, 2, (u, v, out) => {
    out[0] = x(u);
    out[1] = v * hs(u);
    out[2] = thick / 2;
  }, face, { uv: (u, v) => [u * len, v * h] });
  b.grid(nu, 2, (u, v, out) => {
    out[0] = x(u);
    out[1] = v * hs(u);
    out[2] = -thick / 2;
  }, face, { flip: true, uv: (u, v) => [u * len, v * h] });
  b.grid(nu, 1, (u, v, out) => {
    out[0] = x(u);
    out[1] = hs(u);
    out[2] = thick / 2 - v * thick;
  }, cap, { faceted: true });
}

function buildRuinedShrine(ctx: StructureBuildContext): StructureModel {
  const pal: ArchPalette = paletteFor('seori');
  const P = weathered(makePaints(pal));
  const glow = paint('#6dff9a', KIND.ember, 1.5, 0);
  const b = new MeshBuilder(73);

  b.label('platform');
  boxAt(b, 0, -0.6, 0, 11, 1.2, 8, P.masonry, { bevel: 0.07 });
  b.at(0, 0, 5.0);
  stairs(b, P, 2.6, 3, 0.2, 0.4, false);
  b.pop();

  b.label('walls');
  b.at(-1.6, 0.6, -3.6);
  brokenWall(b, 7.2, 4.1, 0.5, P.plaster, P.plasterDark, 3);
  b.pop();
  b.at(-5.0, 0.6, -1.0);
  b.rotY(Math.PI / 2);
  brokenWall(b, 5.2, 3.6, 0.5, P.plaster, P.plasterDark, 8);
  b.pop();
  b.at(4.4, 0.6, -3.6);
  brokenWall(b, 2.4, 1.7, 0.5, P.plaster, P.plasterDark, 5);
  b.pop();
  // timber posts embedded in the walls
  for (const [x, z, h] of [[-5.0, -3.6, 4.2], [-1.6, -3.6, 3.4], [-5.0, 0.8, 2.2]] as const) boxAt(b, x, 0.6, z, 0.4, h, 0.4, P.lacquer);

  b.label('columns');
  for (const [x, h, seed] of [[-4.2, 4.4, 1], [-1.4, 2.9, 2], [1.4, 1.2, 3], [4.2, 3.4, 4]] as const) {
    b.at(x, 0.6, 3.1);
    if (h > 4) {
      plinth(b, P, 0.62, 0.56);
      shaft(b, P, 0.56, h - 0.56, 0.34, 0.3, false);
    } else {
      snappedColumn(b, P, 0.32, h, seed);
    }
    b.pop();
  }
  // stub of the lintel on the standing column
  boxAt(b, -3.3, 0.6 + 4.2, 3.1, 2.2, 0.4, 0.36, P.lacquer);

  b.label('roof');
  // the surviving corner of the hip roof: back and left slopes only
  b.at(0, 0.6 + 4.2, 0);
  const spec = roofRect(12.6, 9.4, 6.0);
  const roof = curvedRoof(b, {
    corners: spec.corners,
    ridge: spec.ridge,
    edges: [false, false, true, true],
    curve: { rise: 2.0, sag: 1.55, tip: 0.18, tipSpan: 0.14, corner: 0.7, cornerPow: 3, flare: 0.36, thick: 0.36 },
    style: P.roof,
    nu: 6,
    nv: 4,
    hipR: 0.15,
    ridgeR: 0.2,
  });
  b.label('tails');
  eaveTail(b, roof.tips[3] as Vec3, [-1, -1], 1.3, P.roof.ridge);
  b.pop();
  // rafters left hanging where the roof is gone
  b.label('rafters');
  for (const x of [-1.5, 0.8, 3.0]) {
    b.at(x, 0.6 + 4.0, -3.4);
    b.rotX(0.62);
    b.translate(0, 0, 2.3);
    box(b, 0.3, 0.3, 4.6, P.timberDark, { axis: 2 });
    b.pop();
  }

  b.label('glow');
  lathe(b, [[1.15, 0.62], [0, 0.62]], 12, glow);
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26;
    b.at(0.3 + Math.cos(a) * 0.7, 0.6, -0.4 - Math.sin(a) * 0.7);
    b.rotZ(jag(i, 2) * 0.35);
    b.rotX(jag(i, 5) * 0.35);
    lathe(b, [[0.2, 0], [0.15, 0.7 + (i % 3) * 0.3], [0, 1.25 + (i % 2) * 0.4]], 5, glow, { faceted: true });
    b.pop();
  }

  b.label('banners');
  const m = b.mark();
  const cloth = paint('#6b2a2e', KIND.cloth, 0, 0.05);
  for (const [x, len] of [[-4.2, 2.6], [-1.6, 1.8]] as const) {
    const pts: Vec3[] = [];
    for (let i = 0; i <= 5; i++) pts.push([x + Math.sin(i * 0.8) * 0.07, 0.6 + 4.1 - (i / 5) * len, 3.35 + i * 0.02]);
    ribbon(b, pts, 0.75, [0, 0, 1], cloth);
    ribbon(b, pts, 0.75, [0, 0, -1], cloth);
  }
  b.displace(m, (p) => {
    if (p[1] < 3.0) p[1] += jag(p[0] * 7, p[2]) * 0.2;
  });

  b.label('snow');
  drift(b, -3.0, 2.2, 1.8, 0.4, 1.2, 0.2, P.plaster);
  drift(b, 3.4, 0.5, 1.6, 0.35, 1.2, -0.4, P.plaster);
  drift(b, -4.4, -2.5, 1.2, 0.5, 0.9, 0.8, P.plaster);
  drift(b, 1.6, 3.7, 1.2, 0.3, 0.7, 0.1, P.plaster);
  drift(b, 5.7, -1.8, 0.9, 0.3, 1.1, 0.3, P.plaster);

  const geometry = b.build();
  return { parts: [{ geometry, material: archMaterial(ctx, pal), castShadow: true }] };
}

export const BROKEN_GATE: StructureDef = { build: buildBrokenGate, zoneTextures: stoneTextures };
export const RUINED_SHRINE: StructureDef = { build: buildRuinedShrine, zoneTextures: stoneTextures };

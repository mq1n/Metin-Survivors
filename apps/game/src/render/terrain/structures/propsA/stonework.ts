// Stonework props (all sandstone / basalt / frozen granite, no tile roofs except the stone gate): stone_gate,
// ruin_pillar, lava_pillar, obelisk, fire_altar, stele. Emissive ember seams are only lit in daeryeol (and the green
// plague glow in seori ruins); elsewhere the same seams stay dark stone.
import { makePaints, stairs } from '../geom/arch';
import { MeshBuilder, lit, paint, recast, type Paint, type Vec3 } from '../geom/builder';
import { KIND } from '../geom/kinds';
import { chiwen, curvedRoof, eaveTail } from '../geom/roof';
import { box, boxAt, cylinder, ellipsoid, extrude, jag, lathe, quadZ, ribbon, tube } from '../geom/shapes';
import { archMaterial, paletteFor, stoneTextures, type ArchPalette } from '../palette';
import type { StructureBuildContext, StructureDef, StructureModel } from '../types';

const SQ = Math.SQRT2;
const PHASE_SQ = Math.PI / 4;
const PHASE_OCT = Math.PI / 8;

/** sandstone palette of daeryeol, or the frozen-granite one in seori */
function ruinPalette(zone: string): ArchPalette {
  return paletteFor(zone === 'seori' ? 'seori' : 'daeryeol');
}

function ember(pal: ArchPalette, zone: string, strength = 1.5): Paint {
  return zone === 'daeryeol' || zone === 'seori' ? paint(pal.ember, KIND.ember, strength, 0) : paint(pal.stoneDark, KIND.stone, 0, 0.04);
}

function finish(ctx: StructureBuildContext, b: MeshBuilder, pal: ArchPalette, ao?: { cell?: number; reach?: number; strength?: number }): StructureModel {
  const geometry = b.build(ao ?? {});
  return { parts: [{ geometry, material: archMaterial(ctx, pal), castShadow: true }] };
}

/** half-width of a straight taper at y */
function taper(y: number, y0: number, y1: number, w0: number, w1: number): number {
  return w0 + (w1 - w0) * ((y - y0) / (y1 - y0));
}

// --- stone_gate ----------------------------------------------------------------------------------------------------------
function buildStoneGate(ctx: StructureBuildContext): StructureModel {
  const pal = ruinPalette(ctx.zone);
  const P = makePaints(pal);
  const glow = ember(pal, ctx.zone, 1.7);
  const b = new MeshBuilder(51);
  const X = 2.9;

  b.label('pillars');
  const prof: Array<[number, number]> = [
    [SQ * 0.85, -0.4], [SQ * 0.85, 0.42], [SQ * 0.72, 0.5], [SQ * 0.7, 0.55], [SQ * 0.62, 2.0], [SQ * 0.75, 2.05], [SQ * 0.75, 2.25],
    [SQ * 0.62, 2.3], [SQ * 0.58, 3.9], [SQ * 0.72, 3.95], [SQ * 0.9, 4.3], [SQ * 0.98, 4.35], [SQ * 0.98, 4.6], [0, 4.6],
  ];
  for (const sx of [-1, 1]) {
    b.at(sx * X, 0, 0);
    lathe(b, prof, 4, P.stone, { faceted: true, phase: PHASE_SQ });
    for (const side of [1, -1]) {
      b.at(0, 0, 0);
      if (side < 0) b.rotY(Math.PI);
      boxAt(b, 0, 0.8, 0.63, 0.7, 1.0, 0.1, P.stoneLight);
      boxAt(b, 0, 2.55, 0.55, 0.6, 1.0, 0.1, P.stoneLight);
      quadZ(b, -0.03, 0.9, 0.06, 0.8, 0.69, glow);
      quadZ(b, -0.03, 2.65, 0.06, 0.8, 0.61, glow);
      b.pop();
    }
    b.pop();
  }

  b.label('lintel');
  boxAt(b, 0, 4.55, 0, 2 * X + 1.4, 0.75, 1.3, P.stone, { bevel: 0.05 });
  for (const side of [1, -1]) {
    b.at(0, 0, 0);
    if (side < 0) b.rotY(Math.PI);
    for (let i = -2; i <= 2; i++) quadZ(b, i * 1.1 - 0.35, 4.75, 0.7, 0.14, 0.66, glow);
    b.pop();
  }
  boxAt(b, 0, 5.3, 0, 2 * X + 2.2, 0.2, 1.9, P.stoneLight, { bevel: 0.03 });
  boxAt(b, 0, 5.5, 0, 2 * X + 2.6, 0.2, 2.3, P.stone, { bevel: 0.03 });

  b.label('roof');
  const roofStyle = {
    tile: paint(lit(P.stone, 1.05).c, KIND.tile, 0, 0.05),
    under: lit(P.stoneDark, 0.8),
    fascia: P.stoneDark,
    end: paint(pal.stoneDark, KIND.tileEnd, 0, 0.03),
    ridge: P.stoneLight,
  };
  b.at(0, 5.7, 0);
  const roof = curvedRoof(b, {
    corners: [[-5.1, 2.2], [5.1, 2.2], [5.1, -2.2], [-5.1, -2.2]],
    ridge: [[-2.8, 0], [2.8, 0], [2.8, 0], [-2.8, 0]],
    curve: { rise: 1.25, sag: 1.5, tip: 0.18, tipSpan: 0.14, corner: 0.55, cornerPow: 3, flare: 0.3, thick: 0.42 },
    style: roofStyle,
    nu: 6,
    nv: 4,
    hipR: 0.15,
    ridgeR: 0.2,
  });
  b.label('tails');
  for (const t of roof.tips) eaveTail(b, t, [t[0], t[2]], 1.2, P.stoneLight);
  chiwen(b, [-2.8, 1.25 + 0.1, 0], -1, 0.85, P.stoneLight, glow);
  chiwen(b, [2.8, 1.25 + 0.1, 0], 1, 0.85, P.stoneLight, glow);
  b.pop();
  return finish(ctx, b, pal);
}

// --- ruin_pillar ---------------------------------------------------------------------------------------------------------
function buildRuinPillar(ctx: StructureBuildContext): StructureModel {
  const pal = ruinPalette(ctx.zone);
  const P = makePaints(pal);
  const b = new MeshBuilder(53);

  b.label('base');
  box(b, 1.5, 0.45, 1.5, P.stoneDark, { bevel: 0.07, y0: -0.2 });
  box(b, 1.15, 0.2, 1.15, P.stone, { bevel: 0.05, y0: 0.25 });
  b.label('shaft');
  const shaft: Array<[number, number]> = [
    [0.52, 0.4], [0.5, 1.5], [0.55, 1.52], [0.55, 1.62], [0.5, 1.64], [0.49, 2.7], [0.54, 2.72], [0.54, 2.8], [0.49, 2.82], [0.47, 3.9],
  ];
  lathe(b, shaft, 12, P.stone, { faceted: true });
  // broken head: a leaning drum that ends in a jagged break
  const m = b.mark();
  b.at(0.04, 0, -0.02);
  b.rotZ(-0.05);
  lathe(b, [[0.47, 3.9], [0.46, 4.5], [0, 4.5]], 12, P.stone, { faceted: true });
  b.pop();
  b.displace(m, (p) => {
    if (p[1] > 4.4) p[1] += jag(p[0], p[2]) * 0.34 - 0.1 + p[0] * 0.5;
  }).recomputeNormals(m);
  // fallen drum and chips at the foot
  b.label('rubble');
  b.at(1.25, 0.34, 0.5);
  b.rotY(0.7);
  b.rotZ(Math.PI / 2);
  cylinder(b, 0.4, 0.95, 10, P.stone, { y0: -0.45, bottom: true, faceted: true });
  b.pop();
  boxAt(b, -1.0, -0.05, 0.85, 0.5, 0.34, 0.4, P.stoneDark, { bevel: 0.04 }, 0.5);
  boxAt(b, 0.8, -0.05, -1.0, 0.36, 0.26, 0.3, P.stone, { bevel: 0.04 }, -0.4);
  return finish(ctx, b, pal);
}

// --- lava_pillar ---------------------------------------------------------------------------------------------------------
const PILLAR_Y0 = 1.6;
const PILLAR_STEP = 0.85;
const PILLAR_RINGS = 12;
/** the shaft is a hexagonal basalt column wrung into a slow spiral */
const twist = (y: number): number => (y - PILLAR_Y0) * 0.1;
const ringY = (i: number): number => PILLAR_Y0 + i * PILLAR_STEP;
const ringR = (i: number): number => taper(i, 0, PILLAR_RINGS - 1, 1.25, 0.82) * (1 + 0.07 * jag(i, 7.3));

function buildLavaPillar(ctx: StructureBuildContext): StructureModel {
  const pal = paletteFor('daeryeol');
  const P = makePaints(pal);
  const glow = paint(pal.ember, KIND.ember, 1.7, 0);
  const b = new MeshBuilder(55);

  b.label('plinth');
  // fractured rock mass: seven irregular facets chipped with radial noise
  let m = b.mark();
  lathe(b, [[0, -0.6], [2.05, -0.6], [2.0, 0.4], [1.75, 0.95], [1.5, 1.65], [0, 1.65]], 7, P.stone, { faceted: true, phase: 0.2 });
  b.displace(m, (p) => {
    const k = 1 + 0.11 * jag(p[0] * 2.3, p[2] * 2.1);
    p[0] *= k;
    p[2] *= k;
    p[1] += 0.12 * jag(p[2] * 3.1, p[0] * 2.7);
  }).recomputeNormals(m);

  b.label('shaft');
  m = b.mark();
  const prof: Array<[number, number]> = [];
  for (let i = 0; i < PILLAR_RINGS; i++) prof.push([ringR(i), ringY(i)]);
  prof.push([0, ringY(PILLAR_RINGS - 1)]);
  lathe(b, prof, 6, P.stone, { faceted: true, phase: 0 });
  const top = ringY(PILLAR_RINGS - 1);
  b.displace(m, (p) => {
    const a = twist(p[1]);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = p[0] * c + p[2] * s;
    p[2] = -p[0] * s + p[2] * c;
    p[0] = x;
    if (p[1] > top - 0.01) p[1] += 0.3 * jag(p[0] * 3.1, p[2] * 3.1);
  }).recomputeNormals(m);

  b.label('cracks');
  // ember cracks follow the spiral down three facets; one short ribbon per ring pair keeps each flush with its facet
  const FACE = Math.PI / 6;
  for (let k = 0; k < 3; k++) {
    const at = (i: number): Vec3 => {
      const a = FACE + k * ((2 * Math.PI) / 3) + twist(ringY(i));
      const nx = Math.cos(a);
      const nz = -Math.sin(a);
      const r = ringR(i) * Math.cos(Math.PI / 6) + 0.05;
      const off = jag(i + k * 3.1, k) * 0.25;
      return [nx * r - nz * off, ringY(i), nz * r + nx * off];
    };
    for (let i = 1; i < PILLAR_RINGS - 1; i += 2) {
      const a = FACE + k * ((2 * Math.PI) / 3) + twist(ringY(i) + PILLAR_STEP / 2);
      ribbon(b, [at(i), at(i + 1)], 0.075, [Math.cos(a), 0, -Math.sin(a)], glow);
    }
  }

  b.label('crown');
  // the column top has split into three splintered shards of different height, leaning apart
  for (const [dx, dz, r, h, tz, tx, ph] of [[-0.4, 0.05, 0.5, 2.0, 0.16, 0.04, 0.3], [0.4, -0.12, 0.46, 1.4, -0.2, -0.08, 0.9], [0.02, 0.44, 0.36, 0.9, 0.04, 0.26, 0.1]] as const) {
    b.at(dx, top + 0.05, dz);
    b.rotZ(tz);
    b.rotX(tx);
    m = b.mark();
    lathe(b, [[r, 0], [r * 0.9, h * 0.72], [r * 0.3, h], [0, h]], 6, P.stone, { faceted: true, phase: ph });
    b.displace(m, (p) => {
      if (p[1] > top + h * 0.6) p[1] += 0.22 * jag(p[0] * 5 + dx, p[2] * 5 + dz);
    }).recomputeNormals(m);
    b.pop();
  }

  b.label('rubble');
  // fallen column drums lying at the foot
  for (const [x, z, yaw, len] of [[1.95, 1.2, 0.5, 2.3], [-2.0, 0.7, 2.4, 1.5]] as const) {
    b.at(x, 0.36, z);
    b.rotY(yaw);
    b.rotZ(Math.PI / 2);
    lathe(b, [[0, -len / 2], [0.4, -len / 2], [0.4, len / 2], [0, len / 2]], 6, P.stoneDark, { faceted: true, phase: 0.2 });
    b.pop();
  }
  return finish(ctx, b, pal);
}

// --- obelisk -------------------------------------------------------------------------------------------------------------
function buildObelisk(ctx: StructureBuildContext): StructureModel {
  const pal = paletteFor('daeryeol');
  const P = makePaints(pal);
  const glow = paint(pal.ember, KIND.ember, 1.35, 0);
  const b = new MeshBuilder(57);

  b.label('stone');
  const hw = (y: number): number => taper(y, 0.7, 6.1, 0.78, 0.52);
  const m = b.mark();
  lathe(
    b,
    [[SQ * 1.15, -0.4], [SQ * 1.15, 0.3], [SQ * 0.95, 0.38], [SQ * 0.95, 0.62], [SQ * hw(0.7), 0.7], [SQ * hw(6.1), 6.1], [SQ * 0.58, 6.14], [SQ * 0.5, 6.2], [0, 7.0]],
    4,
    P.stone,
    { faceted: true, phase: PHASE_SQ },
  );
  // broken corner of the pyramidion
  b.displace(m, (p) => {
    if (p[1] > 6.1) {
      const k = Math.max(0, p[0] + p[2] - 0.18);
      p[1] -= k * 1.4;
    }
  }).recomputeNormals(m);
  b.label('runes');
  // vertical rune column on the front face
  for (let i = 0; i < 7; i++) {
    const y = 1.4 + i * 0.66;
    const z = hw(y + 0.3) + 0.012;
    const strokes = 2 + (i % 2);
    for (let s = 0; s < strokes; s++) {
      const horizontal = (i + s) % 2 === 0;
      const w = horizontal ? 0.34 : 0.05;
      const h = horizontal ? 0.05 : 0.3;
      quadZ(b, (s - 1) * 0.12 - w / 2, y + (horizontal ? s * 0.12 : 0.04), w, h, z, glow);
    }
  }
  // glowing cracks from the broken corner
  const crack: Vec3[] = [];
  for (let i = 0; i <= 5; i++) {
    const y = 6.0 - i * 0.8;
    const z = hw(y) + 0.012;
    crack.push([0.32 + jag(i, 2.0) * 0.12, y, z]);
  }
  ribbon(b, crack, 0.05, [0, 0, 1], glow);
  return finish(ctx, b, pal, { cell: 0.2 });
}

// --- fire_altar ----------------------------------------------------------------------------------------------------------
function buildFireAltar(ctx: StructureBuildContext): StructureModel {
  const pal = paletteFor('daeryeol');
  const P = makePaints(pal);
  const glow = paint(pal.ember, KIND.ember, 1.8, 0);
  const b = new MeshBuilder(59);

  b.label('tiers');
  lathe(b, [[3.65, -0.5], [3.65, 0.55], [3.5, 0.62], [3.3, 0.62]], 24, P.stone);
  lathe(b, [[3.3, 0.62], [2.65, 0.62], [2.65, 1.05], [2.5, 1.12], [2.3, 1.12]], 24, P.stoneLight);
  lathe(b, [[2.3, 1.12], [1.85, 1.12], [1.85, 1.6], [1.7, 1.68], [0, 1.68]], 24, P.stone);
  b.label('stairs');
  b.at(0, 0, 4.3);
  stairs(b, P, 2.2, 2, 0.28, 0.5, false);
  b.pop();
  b.label('dragon');
  // sinuous dragon relief wrapped around the lower tier
  const body: Vec3[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2 * 0.92;
    const r = 3.66 + 0.02;
    body.push([r * Math.cos(t), 0.28 + 0.12 * Math.sin(t * 9), -r * Math.sin(t)]);
  }
  tube(b, body, (t) => 0.1 * (1 - 0.75 * t) + 0.015, 4, P.stoneLight);
  const hx = body[0] as Vec3;
  b.at(hx[0] * 1.02, hx[1], hx[2]);
  ellipsoid(b, 0.22, 0.17, 0.3, P.stoneLight, { rings: 3, segs: 6 });
  b.pop();
  b.label('seams');
  // ember cracks fanning over the tier tops
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const pts: Vec3[] = [];
    for (let i = 0; i <= 4; i++) {
      const r = 2.35 + i * 0.28;
      const aa = a + jag(i, k) * 0.07;
      pts.push([r * Math.cos(aa), 0.64 + 0.002, -r * Math.sin(aa)]);
    }
    ribbon(b, pts, 0.06, [0, 1, 0], glow);
  }
  b.label('brazier');
  lathe(b, [[0.5, 1.68], [0.9, 1.9], [1.2, 2.25], [1.1, 2.3], [0.8, 2.0], [0, 2.0]], 14, P.stone);
  lathe(b, [[0, 2.15], [1.0, 2.15], [0.9, 2.2], [0, 2.4]], 14, glow);
  for (const k of [0, 1, 2, 3]) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    b.at(2.1 * Math.cos(a), 1.12, -2.1 * Math.sin(a));
    lathe(b, [[0.24, 0], [0.24, 1.1], [0.32, 1.2], [0.34, 1.5], [0.2, 1.52], [0, 1.52]], 8, P.stone);
    lathe(b, [[0.2, 1.3], [0.2, 1.36]], 8, glow);
    b.pop();
  }
  return finish(ctx, b, pal, { cell: 0.25 });
}

// --- stele on a tortoise ------------------------------------------------------------------------------------------------
function buildStele(ctx: StructureBuildContext): StructureModel {
  const pal = paletteFor(ctx.zone);
  const P = makePaints(pal);
  const b = new MeshBuilder(61);

  b.label('tortoise');
  b.at(0, 0.48, 0);
  ellipsoid(b, 1.15, 0.5, 0.85, P.stoneDark, { rings: 4, segs: 10 });
  // shell scutes: a raised ring and spine
  lathe(b, [[1.05, 0.12], [1.1, 0.2], [0.85, 0.42], [0.45, 0.5]], 10, P.stone, { faceted: true });
  b.pop();
  // head and neck (+Z), tail (-Z), four flippers
  tube(b, [[0, 0.42, 0.7], [0, 0.55, 1.1], [0, 0.72, 1.4]], 0.2, 7, P.stoneDark);
  b.at(0, 0.75, 1.5);
  ellipsoid(b, 0.26, 0.2, 0.34, P.stoneDark, { rings: 4, segs: 8 });
  b.pop();
  for (const sx of [-1, 1]) {
    boxAt(b, sx * 0.24, 0.9, 1.62, 0.09, 0.2, 0.07, P.stoneLight, {}, sx * 0.3);
    for (const sz of [-1, 1]) {
      b.at(sx * 0.95, 0.18, sz * 0.6);
      b.rotY(sx * sz * 0.5);
      ellipsoid(b, 0.4, 0.15, 0.22, P.stone, { rings: 3, segs: 6 });
      b.pop();
    }
  }
  tube(b, [[0, 0.38, -0.8], [0, 0.3, -1.1], [0, 0.4, -1.25]], 0.1, 5, P.stoneDark);

  b.label('slab');
  box(b, 1.0, 0.4, 0.5, P.stone, { bevel: 0.04, y0: 0.9 });
  box(b, 1.0, 2.0, 0.3, P.stoneLight, { bevel: 0.03, y0: 1.2 });
  // crowned head with two coiled dragons
  const cap: Array<[number, number]> = [[-0.5, 0], [-0.52, 0.2], [-0.4, 0.5], [-0.15, 0.7], [0.15, 0.7], [0.4, 0.5], [0.52, 0.2], [0.5, 0]];
  b.at(0, 3.15, 0);
  extrude(b, cap, 0.34, P.stoneLight, { bevel: 0.03 });
  b.pop();
  for (const sx of [-1, 1]) {
    const pts: Vec3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const a = t * 4.4 + 0.3;
      pts.push([sx * (0.34 + 0.18 * Math.cos(a) * (1 - t * 0.5)), 3.45 + 0.17 * Math.sin(a) * (1 - t * 0.3) + t * 0.12, 0.2]);
    }
    tube(b, pts, (t) => 0.06 * (1 - 0.6 * t) + 0.012, 4, P.stone);
  }
  b.label('text');
  // inscription: three columns of carved glyphs (two-stroke marks with jittered size and position) between incised rules
  const ink = lit(recast(P.stoneDark, KIND.stone), 0.55);
  const faces = [
    { side: 1, cols: [-0.3, 0, 0.3], rules: [-0.43, -0.15, 0.15, 0.43] },
    { side: -1, cols: [-0.17, 0.17], rules: [-0.38, 0, 0.38] },
  ];
  for (const { side, cols, rules } of faces) {
    const z = 0.155 * side;
    for (const x of rules) quadZ(b, x, 2.2, 0.012, 1.5, z, ink, { flip: side < 0 });
    for (const [ci, x] of cols.entries()) {
      for (let r = 0; r < 8; r++) {
        if (jag(ci + side, r) > 0.8) continue;
        const w = 0.09 + 0.05 * (jag(ci, r + 3) * 0.5 + 0.5);
        const y = 1.52 + r * 0.19 + jag(r, ci) * 0.012;
        const cx = x + jag(ci + 5, r) * 0.02;
        quadZ(b, cx, y + 0.045, w, 0.026, z, ink, { flip: side < 0 });
        quadZ(b, cx + jag(r, ci + 9) * 0.025, y - 0.005, 0.026, 0.11, z, ink, { flip: side < 0 });
        if (jag(ci + 2, r + 1) > 0) quadZ(b, cx - w * 0.3, y - 0.05, w * 0.55, 0.022, z, ink, { flip: side < 0 });
      }
    }
  }
  return finish(ctx, b, pal, { cell: 0.1, reach: 1.2 });
}

export const STONE_GATE: StructureDef = { build: buildStoneGate, zoneTextures: (z) => [ruinPalette(z).stoneTex] };
export const RUIN_PILLAR: StructureDef = { build: buildRuinPillar, zoneTextures: (z) => [ruinPalette(z).stoneTex] };
export const LAVA_PILLAR: StructureDef = { build: buildLavaPillar, textures: [paletteFor('daeryeol').stoneTex] };
export const OBELISK: StructureDef = { build: buildObelisk, textures: [paletteFor('daeryeol').stoneTex] };
export const FIRE_ALTAR: StructureDef = { build: buildFireAltar, textures: [paletteFor('daeryeol').stoneTex] };
export const STELE: StructureDef = { build: buildStele, zoneTextures: stoneTextures };

// prop_ruined_shrine — plague-ruined hall shrine (11 x 8 m footprint, ~8 m tall, front = +Z): cracked platform with a missing corner, a
// colonnade of lacquered pillars (some snapped to splintered stumps, one fallen), half of the hip roof still up and slumped, the other half
// collapsed into a heap of tile shards and rafters, a ragged timber back wall, torn banners and an altar holding a cluster of sickly green
// emissive crystals; snow drifts over everything.
import { extrude, lathe } from '../../core/hard/hardmesh.ts';
import { m4mul, m4translation } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { cap, compose, pillar, prism, rectCorners, revolve, roofLoft, rotY, slab, stairs } from '../../archetypes/prop/kit.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { fbm01, lacquer, mixc, mulc, rgb, roofEdge, roofTile, stone, timberPlaster, wood } from '../../archetypes/prop/mats.ts';
import { type Mat, type PropMesh, mapAuto, mapCylY } from '../../archetypes/prop/mesh.ts';
import { Rng } from '../../core/rng.ts';

const STONE = 0, PILLAR = 1, TILE = 2, EDGE = 3, SOFFIT = 4, BEAM = 5, WALL = 6, SNOW = 7, CRYSTAL = 8, CLOTH = 9, SPLINTER = 10;

const rotZ = (a: number, p: Vec3): number[] => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, p[0] - c * p[0] + s * p[1], p[1] - s * p[0] - c * p[1], 0, 1];
};
const rotX = (a: number): number[] => {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
};

function snowMat(): Mat {
  const a = rgb('#f1f6fb'), b = rgb('#bccee0');
  return { name: 'snow', ao: 0.6, shade: (t) => mulc(mixc(b, a, 0.45 + 0.55 * t.n[1]), 0.92 + 0.12 * fbm01(t, 6, 3, 1.7)) };
}

function crystalMat(): Mat {
  const deep = rgb('#1f5a3a'), glow = rgb('#7dffa6');
  return {
    name: 'plague-crystal',
    ao: 0.3,
    shade: (t) => mixc(deep, glow, 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t.p[1] * 9 + fbm01(t, 10, 2, 3.3) * 4))),
    emit: (t) => mulc(glow, 0.5 + 0.5 * t.n[1] * t.n[1] + 0.3 * fbm01(t, 14, 2, 2.1)),
  };
}

function clothMat(): Mat {
  const base = rgb('#5d3a6b'), faded = rgb('#7d6a8a'), stain = rgb('#2e2133');
  return {
    name: 'torn-banner',
    shade(t) {
      const v = Math.min(1, Math.max(0, (t.p[1] - 2.2) / 2.4));
      let c = mixc(base, faded, 0.25 + 0.5 * fbm01(t, 5, 3, 1.2));
      c = mixc(c, stain, 0.55 * Math.max(0, 0.5 - v) + 0.2 * fbm01(t, 20, 2, 9));
      // vertical weave streaks
      c = mulc(c, 0.88 + 0.2 * (0.5 + 0.5 * Math.sin(t.p[0] * 90 + t.p[2] * 90)));
      return c;
    },
  };
}

export const prop: PropDef = {
  id: 'prop_ruined_shrine',
  aoGain: 1.7,
  shadowTint: [0.56, 0.5, 0.52],
  size: 2048,
  aoLong: 3,
  crease: 36,
  emissiveFactor: [1, 1, 1],
  mats: [
    stone('granite', { tex: ['tex_stone_block_wall', 'tex_rock_frozen'], dark: '#62626a', light: '#b6bcc6', moss: 0.1, dirt: 0.3, snow: 0.45, wear: 0.65, k: 0.7 }),
    lacquer('pillar', { vertical: true, color: '#7a2820', wear: 1.3, dirt: 0.6 }),
    roofTile('tile', { moss: 0.15, snow: 0.2, tint: '#e4cdc2', wear: 0.7 }),
    roofEdge('roof-edge', { tile: 2.8 }),
    lacquer('soffit', { color: '#3f1814', wear: 0.5, dirt: 0 }),
    lacquer('beam', { color: '#6e2820', wear: 1.3 }),
    timberPlaster('timber-plaster', { studs: 1.0, rails: 1.3, color: '#cfc7b6' }),
    snowMat(),
    crystalMat(),
    clothMat(),
    wood('splinter', { tex: ['tex_wood_beam_dark', 'tex_wood_plank'], dark: '#5e4c3a', light: '#bfa682', vertical: true }),
  ],
  build(m) {
    const rng = new Rng('ruined_shrine');
    const wall = mapAuto(1.3);
    // ---- platform with a broken NE corner
    let n = m.triCount;
    prism(m, STONE, wall, rectCorners(5.5, 4.0), 0, 0.6, { bevel: 0.06 });
    prism(m, STONE, wall, rectCorners(5.1, 3.6), 0.6, 0.82, { bevel: 0.05 });
    m.filterFrom(n, (cx, cy, cz) => !(cx > 3.4 && cz < -1.8 && cy > 0.35));
    stairs(m, STONE, wall, [0, 0, 4.0], 3.0, 3, 0.4, 0.27);
    for (const [x, z, s, yaw] of [[4.4, -3.0, 0.9, 0.4], [3.6, -3.8, 0.6, 1.1], [5.1, -2.2, 0.7, 2.0], [4.9, -3.6, 0.5, 0.2]] as [number, number, number, number][]) {
      n = m.triCount;
      slab(m, STONE, wall, [1.0 * s, 0.5 * s, 0.8 * s], [0, 0.25 * s, 0]);
      m.transformFrom(n, compose(m4translation([x, 0, z]), rotY(yaw)));
    }
    const FY = 0.82;
    // ---- colonnade: [x, z, height (0 = fallen)]
    const cols: [number, number, number][] = [
      [-4, 2.6, 4.3], [-1.4, 2.6, 4.3], [1.4, 2.6, 2.2], [4, 2.6, 4.3],
      [-4, -2.6, 3.4], [-1.4, -2.6, 4.3], [1.4, -2.6, 1.2], [4, -2.6, 4.3],
    ];
    for (const [x, z, h] of cols) {
      prism(m, STONE, wall, [[x - 0.5, z - 0.5], [x + 0.5, z - 0.5], [x + 0.5, z + 0.5], [x - 0.5, z + 0.5]], FY - 0.02, FY + 0.2, { bevel: 0.03 });
      n = m.triCount;
      m.add(lathe(pillar(0.36, 0.3, h, 0.03, 4), { segments: 12 }), PILLAR, mapCylY(x, z, 0.33, 1.4), m4translation([x, FY + 0.2, z]));
      if (h < 4) {
        // ragged break
        m.deform(n, ([px, py, pz]) => (py > FY + 0.2 + h - 0.25 ? [px, py - 0.35 * (0.5 + 0.5 * Math.sin(Math.atan2(pz - z, px - x) * 2 + x)), pz] : [px, py, pz]));
        const cutY = FY + 0.2 + h - 0.2;
        m.add(revolve([[0.31, cutY], [0, cutY]], 10), PILLAR, wall, m4translation([x, 0, z]));
        for (let i = 0; i < 3; i++) {
          const a = rng.range(0, 6.28), w = rng.range(0.14, 0.22), hh = rng.range(0.4, 0.8);
          m.add(extrude([[-w / 2, 0], [w / 2, 0], [0, w * 0.6]], hh, { axis: 'y', taper: 0.1 }), SPLINTER, wall, m4mul(m4translation([x + Math.cos(a) * 0.17, cutY - 0.1, z + Math.sin(a) * 0.17]), rotY(a)));
        }
      }
    }
    // fallen shafts
    n = m.triCount;
    m.add(lathe(pillar(0.36, 0.3, 2.6, 0.03, 3), { segments: 12 }), PILLAR, wall);
    m.transformFrom(n, compose(m4translation([-0.8, FY + 0.45, 0.8]), rotY(0.7), rotZ(Math.PI / 2, [0, 0, 0])));
    n = m.triCount;
    m.add(lathe(pillar(0.36, 0.3, 1.8, 0.03, 3), { segments: 12 }), PILLAR, wall);
    m.transformFrom(n, compose(m4translation([2.6, FY + 0.35, -0.6]), rotY(-0.5), rotZ(Math.PI / 2 - 0.2, [0, 0, 0])));
    // ---- ragged back wall (polygon extrusion with a broken top edge)
    const profile: [number, number][] = [[-5, 0], [2, 0], [2, 3.0], [1.1, 2.4], [0.4, 3.5], [-0.5, 2.5], [-1.4, 3.2], [-2.2, 1.9], [-3.1, 2.9], [-4, 2.3], [-5, 3.2]];
    const wallMesh = extrude(profile, 0.32, { axis: 'z' });
    m.add(wallMesh, WALL, mapAuto(1.2), m4translation([0, FY, -3.75]));
    for (const x of [-4.6, -2.6, -0.6, 1.6]) slab(m, BEAM, wall, [0.22, 3.0, 0.4], [x, FY + 1.5, -3.7]);
    // ---- standing half of the roof, slumped to the left
    n = m.triCount;
    const roofR = roofLoft(m, {
      corners: rectCorners(3.6, 3.7),
      stages: [{ f: 0.55, corners: rectCorners(2.7, 2.6) }, { f: 1, corners: [[-2.4, 0], [2.4, 0], [2.4, 0], [-2.4, 0]] }],
      y0: FY + 4.65, rise: 2.0, q: 1.5, rings: 4, segs: [8, 6, 8, 6],
      lift: 0.5, flare: 0.3, reach: 0.28, thick: 0.24, soffit: 1.3, tile: 2.8,
      mats: { top: TILE, fascia: EDGE, under: SOFFIT },
    });
    for (const path of roofR.hips) cap(m, TILE, path, 0.09, wall, 4);
    m.transformFrom(n, compose(rotZ(0.1, [4, FY + 4.5, 0]), m4translation([2.5, 0, 0])));
    m.filterFrom(n, (cx, cy, cz) => !(cx < -1.0 + 0.4 * Math.sin(cz * 3 + cy) && cy < FY + 5.6));
    // ---- collapsed half: tile shards + rafters piled on the platform
    for (let i = 0; i < 16; i++) {
      const x = rng.range(-4.8, 0.2), z = rng.range(-3.0, 3.0);
      const s = rng.range(0.7, 1.4), lean = rng.range(0.1, 0.6);
      n = m.triCount;
      slab(m, TILE, wall, [1.1 * s, 0.1, 0.9 * s], [0, 0, 0]);
      m.transformFrom(n, compose(m4translation([x, FY + 0.15 + rng.range(0, 0.9), z]), rotY(rng.range(0, 6.28)), rotZ(lean * (i % 2 ? 1 : -1), [0, 0, 0])));
    }
    for (let i = 0; i < 6; i++) {
      n = m.triCount;
      slab(m, BEAM, wall, [0.2, 0.22, rng.range(2.4, 3.8)], [0, 0, 0]);
      m.transformFrom(n, compose(m4translation([rng.range(-3.8, -0.6), FY + rng.range(0.7, 1.6), rng.range(-2.2, 2.2)]), rotY(rng.range(0, 3.14)), rotX(rng.range(-0.5, 0.5))));
    }
    // ---- altar with plague crystals
    slab(m, STONE, wall, [1.8, 0.9, 1.1], [-0.4, FY + 0.45, -2.4]);
    slab(m, STONE, wall, [2.1, 0.14, 1.4], [-0.4, FY + 0.97, -2.4]);
    const crystals: [number, number, number, number, number, number][] = [
      [-0.4, -2.4, 1.15, 0.2, 0, 0], [-0.9, -2.5, 0.8, 0.15, 0.3, -0.2], [0.1, -2.3, 0.9, 0.16, -0.3, 0.1], [-0.55, -2.1, 0.6, 0.12, 0.2, 0.4], [-0.2, -2.7, 0.55, 0.12, -0.1, -0.4],
    ];
    for (const [x, z, h, r, tx, tz] of crystals) {
      n = m.triCount;
      m.add(revolve([[0, 0], [r, 0], [r * 1.05, h * 0.7], [0, h]], 6), CRYSTAL, wall);
      m.transformFrom(n, compose(m4translation([x, FY + 1.04, z]), rotZ(tz, [0, 0, 0]), rotX(tx)));
    }
    // ---- torn banners hanging from the standing roof front
    const banner = (x: number, z: number, len: number, w: number, ph: number): void => {
      const segs = 6;
      for (const side of [1, -1]) {
        for (let i = 0; i < segs; i++) {
          const y0 = FY + 4.4 - (i / segs) * len, y1 = FY + 4.4 - ((i + 1) / segs) * len;
          const sw = (y: number): number => Math.sin((FY + 4.4 - y) * 1.8 + ph) * 0.12;
          const bx = (y: number): number => (y < FY + 4.4 - len * 0.7 ? 0.5 * (1 - (FY + 4.4 - y - len * 0.7) / (len * 0.3)) * w * Math.sin(ph * 5 + y * 3) * 0.3 : 0);
          const p = (dx: number, y: number): Vec3 => [x + dx, y, z + sw(y) * side * 0.0 + sw(y)];
          const a = p(-w / 2 + bx(y0), y0), b = p(w / 2 - bx(y0), y0), c = p(w / 2 - bx(y1), y1), d = p(-w / 2 + bx(y1), y1);
          if (side === 1) m.quad(a, d, c, b, [0, i], [0, i + 1], [1, i + 1], [1, i], CLOTH);
          else m.quad(a, b, c, d, [0, i], [1, i], [1, i + 1], [0, i + 1], CLOTH);
        }
      }
    };
    banner(3.3, 3.3, 2.4, 0.8, 0.4);
    banner(5.2, 3.2, 1.7, 0.7, 1.9);
    banner(1.2, 3.4, 1.0, 0.7, 3.1);
    // ---- snow drifts
    const drift = (x: number, z: number, r: number, h: number, ph: number, y = 0): void => {
      m.add(revolve([[0, 0], [r, 0], [r * 0.9, h * 0.4], [r * 0.5, h * 0.85], [0, h]], 10, (th) => 1 + 0.22 * Math.sin(th * 3 + ph) + 0.1 * Math.sin(th * 5 + ph * 2)), SNOW, mapCylY(x, z, r, 1.2), m4translation([x, y, z]));
    };
    drift(-2.8, 1.8, 1.4, 0.5, 0.3, FY);
    drift(-3.6, -1.2, 1.2, 0.45, 1.1, FY);
    drift(3.0, 0.5, 1.2, 0.35, 2.2, FY);
    drift(5.4, 3.7, 1.1, 0.45, 0.9);
    drift(-5.4, 3.2, 1.3, 0.5, 2.8);
    drift(0, 4.9, 1.2, 0.35, 1.9);
    drift(-1.0, FY + 1.0, 0.8, 0.28, 0.3, 0);
    m.fixedGround = true;
    void (null as unknown as PropMesh);
  },
};

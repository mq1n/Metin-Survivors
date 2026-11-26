// prop_broken_gate — half-collapsed pagoda gate in the frozen plague lands (≈6.5 m). It is the intact gate generator with the right half
// ruined: snapped right pillar (splintered stump), beams sagging off the left pillar, the lower roof hanging ripped from its left half
// with the upper roof gone (a remnant of the attic stands), inscription board and a pillar shaft on the ground, snow drifts everywhere.
// Pillar axes end up at x = -3.2 / +2.6 (the Terrain collision circles).
import { lathe, extrude } from '../../core/hard/hardmesh.ts';
import { m4mul, m4translation } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { compose, mapBand, pillar, rectCorners, revolve, roofLoft, rotY, slab, cap } from '../../archetypes/prop/kit.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { fbm01, lacquer, mixc, mulc, rgb, roofTile, stone, wood } from '../../archetypes/prop/mats.ts';
import { type Mat, mapAuto, mapCylY } from '../../archetypes/prop/mesh.ts';
import { GATE_MAT as G, buildGate, gateMats } from './pagoda_gate.ts';

const SNOW = 11, SPLINTER = 12;

function snowMat(): Mat {
  const a = rgb('#f1f6fb'), b = rgb('#c3d3e4');
  return { name: 'snow', ao: 0.55, shade: (t) => mulc(mixc(b, a, 0.5 + 0.5 * t.n[1]), 0.9 + 0.14 * fbm01(t, 7, 3, 1.7)) };
}

const rotX = (a: number): number[] => {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
};

const rotZ = (a: number, p: Vec3): number[] => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, p[0] - c * p[0] + s * p[1], p[1] - s * p[0] - c * p[1], 0, 1];
};

export const prop: PropDef = {
  id: 'prop_broken_gate',
  aoGain: 1.7,
  shadowTint: [0.56, 0.5, 0.52],
  size: 1536,
  aoLong: 2.6,
  crease: 36,
  mats: (() => {
    const mats = gateMats();
    mats[G.STONE] = stone('granite', { tex: ['tex_stone_block_wall', 'tex_rock_frozen'], dark: '#6a6a70', light: '#bcc0c8', moss: 0.1, dirt: 0.3, snow: 0.35, wear: 0.6 });
    mats[G.PILLAR] = lacquer('pillar', { vertical: true, color: '#7c2a22', wear: 1.3, dirt: 0.7 });
    mats[G.TILE] = roofTile('tile', { moss: 0.12, snow: 0.1, tint: '#f2d4c6', wear: 0.6 });
    mats[G.BEAM] = lacquer('beam', { color: '#74281f', wear: 1.3 });
    mats[SNOW] = snowMat();
    mats[SPLINTER] = wood('splinter', { tex: ['tex_wood_beam_dark', 'tex_wood_plank'], dark: '#6e5a44', light: '#c4aa86', vertical: true });
    return mats;
  })(),
  build(m) {
    const wall = mapAuto(1.2);
    const HS = 2.9;
    const droop = (x0: number, span: number, k: number) => ([x, y, z]: Vec3): Vec3 => {
      const t = Math.max(0, (x - x0) / span);
      return [x, y - k * t * t, z + 0.06 * k * t * t * (z > 0 ? 1 : -1) * 0];
    };
    buildGate(m, {
      hs: HS,
      upper: true,
      part(name, from, to) {
        const keepLeft = (xCut: number, jag = 0.35) => (cx: number, cy: number, cz: number): boolean => cx < xCut + jag * Math.sin(cz * 6 + cy * 3);
        const rightOf = (x: number, cx: number, jag = 0.35, cz = 0, cy = 0): boolean => cx > x + jag * Math.sin(cz * 6 + cy * 3);
        switch (name) {
          case 'pillarR': {
            // snap the shaft: everything above a ragged line collapses onto it, then cap the break
            m.deform(from, ([x, y, z]) => {
              const cut = 2.15 + 0.5 * Math.max(0, x - HS + 0.5) + 0.12 * Math.sin(z * 9 + x * 5);
              return [x, Math.min(y, cut), z];
            });
            const r = 0.46;
            m.add(revolve([[r, 2.3], [0, 2.3]], 12), G.PILLAR, mapAuto(1), m4translation([HS, 0, 0]));
            m.deform(m.triCount - 12, ([x, y, z]) => [x, y + 0.5 * Math.max(0, x - HS + 0.5) + 0.12 * Math.sin(z * 9 + x * 5) - 0.15 + 0.0, z]);
            // splinters
            const sp: [number, number, number, number][] = [[-0.32, 0.1, 0.6, 0.3], [0.05, -0.3, 0.9, 0.34], [0.3, 0.12, 0.5, 0.26], [-0.1, 0.3, 0.75, 0.24]];
            for (const [dx, dz, h, w] of sp) {
              const wedge = extrude([[-w / 2, 0], [w / 2, 0], [0, w * 0.55]], h, { axis: 'y', taper: 0.12 });
              m.add(wedge, SPLINTER, mapAuto(1), m4mul(m4translation([HS + dx, 2.2 + 0.4 * Math.max(0, dx + 0.0), dz]), rotY(dx * 4)));
            }
            break;
          }
          case 'beamLow': {
            m.filterFrom(from, () => false);
            const k = m.triCount;
            slab(m, G.BEAM, wall, [3.1, 0.36, 0.34], [-HS + 1.45, 3.9, 0]);
            slab(m, G.DANCH, mapBand(4.05, 0.3, 'x', 0.3), [2.9, 0.3, 0.03], [-HS + 1.45, 3.9, 0.185]);
            slab(m, G.DANCH, mapBand(4.05, 0.3, 'x', 0.3), [2.9, 0.3, 0.03], [-HS + 1.45, 3.9, -0.185]);
            m.transformFrom(k, rotZ(-0.17, [-HS, 3.9, 0]));
            break;
          }
          case 'beamHigh': {
            m.filterFrom(from, () => false);
            const k = m.triCount;
            slab(m, G.BEAM, wall, [2.0, 0.4, 0.42], [-HS + 0.9, 4.92, 0]);
            m.transformFrom(k, rotZ(-0.62, [-HS, 4.92, 0]));
            break;
          }
          case 'brackets':
            m.filterFrom(from, (cx) => cx < 0.6);
            break;
          case 'couplet':
            m.filterFrom(from, (cx) => cx < 0);
            break;
          case 'plaque':
            m.transformFrom(from, compose(m4translation([0.5, 0.45, 2.4]), rotY(0.35), rotZ(0.11, [0, 0, 0]), [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1], m4translation([0, -4.4, 0])));
            break;
          case 'roofLower': {
            m.filterFrom(from, () => false);
            // surviving roof section: a smaller complete roof resting on the left pillar and the beam stub, tilted toward the gap
            const mats = { top: G.TILE, fascia: G.EDGE, under: G.SOFFIT };
            let k = m.triCount;
            const roofA = roofLoft(m, {
              corners: rectCorners(2.7, 2.25),
              stages: [{ f: 1, corners: rectCorners(1.1, 0.9) }],
              y0: 5.7, rise: 1.0, q: 1.5, rings: 4, segs: [7, 4, 7, 4],
              lift: 0.45, flare: 0.28, reach: 0.32, thick: 0.22, soffit: 1.2, tile: 2.0, mats,
            });
            for (const path of roofA.hips) cap(m, G.TILE, path, 0.085, wall, 4);
            m.transformFrom(k, compose(rotZ(-0.09, [-HS, 5.5, 0]), m4translation([-HS + 1.2, 0, 0])));
            // fallen half of the roof, leaning on the stump, half sunk in the snow
            k = m.triCount;
            const roofB = roofLoft(m, {
              corners: rectCorners(2.2, 1.7),
              stages: [{ f: 1, corners: rectCorners(0.8, 0.5) }],
              y0: 0.2, rise: 0.8, q: 1.4, rings: 3, segs: [6, 3, 6, 3],
              lift: 0.3, flare: 0.2, reach: 0.32, thick: 0.2, soffit: 0.9, tile: 2.0, mats,
            });
            for (const path of roofB.hips) cap(m, G.TILE, path, 0.08, wall, 4);
            m.transformFrom(k, compose(m4translation([HS + 1.2, 0.35, -0.6]), rotY(-0.5), rotX(0.34), rotZ(0.16, [0, 0, 0])));
            break;
          }
          case 'attic':
            m.filterFrom(from, () => false);
            break;
          case 'upperRoof':
            m.filterFrom(from, () => false);
            break;
          default:
        }
      },
    });
    // shift so the pillar axes sit at x = -3.2 / +2.6
    m.transformFrom(0, m4translation([-0.3, 0, 0]));
    // fallen pillar shaft and a few roof-tile slabs on the ground
    const n = m.triCount;
    m.add(lathe(pillar(0.5, 0.44, 2.3, 0.03, 3), { segments: 14 }), G.PILLAR, mapAuto(1.2));
    m.transformFrom(n, compose(m4translation([0.9, 0.5, 2.1]), rotY(0.5), rotZ(Math.PI / 2, [0, 0, 0])));
    const shards: [number, number, number, number][] = [[1.6, 0.4, 1.6, 0.4], [3.6, -0.6, 0.9, -0.7], [-1.2, 1.7, 0.7, 1.1], [3.9, 1.4, 0.8, 0.2]];
    for (const [x, z, s, yaw] of shards) {
      const k = m.triCount;
      slab(m, G.TILE, wall, [1.1 * s, 0.12, 0.9 * s], [0, 0.09, 0]);
      m.transformFrom(k, compose(m4translation([x, 0, z]), rotY(yaw), rotZ(0.25 * s, [0, 0, 0])));
    }
    // snow drifts
    const drift = (x: number, z: number, r: number, h: number, ph: number): void => {
      m.add(revolve([[0, 0], [r, 0], [r * 0.9, h * 0.4], [r * 0.5, h * 0.85], [0, h]], 10, (th) => 1 + 0.22 * Math.sin(th * 3 + ph) + 0.1 * Math.sin(th * 5 + ph * 2)), SNOW, mapCylY(x, z, r, 1.2), m4translation([x, 0, z]));
    };
    drift(-3.2, 0.9, 1.1, 0.5, 0.3);
    drift(-4.1, -0.9, 0.9, 0.38, 1.4);
    drift(2.7, 1.0, 1.0, 0.5, 2.2);
    drift(-0.4, -0.3, 1.5, 0.28, 0.6);
    drift(1.8, 2.5, 0.8, 0.3, 3.1);
    m.fixedGround = true;
  },
};

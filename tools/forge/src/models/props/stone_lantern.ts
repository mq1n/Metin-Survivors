// prop_stone_lantern — tall carved stone toro (3.4 m): stepped octagonal base, lotus-petal cushions, faceted shaft with a
// knot ring, firebox with four lit paper windows, curved octagonal cap with upturned hips and a jewel finial.
import { lathe } from '../../core/hard/hardmesh.ts';
import { polyCorners, revolve, roofLoft, slab, prism, pyramidStages } from '../../archetypes/prop/kit.ts';
import { mapAuto, mapCylY } from '../../archetypes/prop/mesh.ts';
import { type PropDef } from '../../archetypes/prop/index.ts';
import { rgb, stone, mulc } from '../../archetypes/prop/mats.ts';
import type { Mat } from '../../archetypes/prop/mesh.ts';
import { roundCorners } from '../../core/hard/shape2d.ts';

const STONE = 0, GLOW = 1, BASE = 2, CAP = 3;

export function stoneMats(): Mat[] {
  return [
    stone('granite', { tex: ['tex_rock_mossy'], dark: '#6f6d68', light: '#c4bfb4', moss: 0.35, dirt: 0.3, wear: 0.55 }),
    {
      name: 'paper-glow',
      ao: 0.2,
      shade: (t) => mulc(rgb('#ffd58a'), 0.8 + 0.3 * (0.5 + 0.5 * t.noise.fbm(t.p[0] * 30, t.p[1] * 30, t.p[2] * 30, { octaves: 2 }))),
      emit: () => mulc(rgb('#ff9a3c'), 0.55),
    },
    stone('granite-base', { tex: ['tex_rock_mossy'], dark: '#5d5b57', light: '#aaa59a', moss: 0.55, dirt: 0.5, wear: 0.4 }),
    stone('granite-cap', { tex: ['tex_rock_mossy'], dark: '#67655f', light: '#bdb7ab', moss: 0.5, snow: 0, dirt: 0, wear: 0.5 }),
  ];
}

export const prop: PropDef = {
  id: 'prop_stone_lantern',
  yScale: 0.94,
  mats: stoneMats(),
  size: 1024,
  aoLong: 1.6,
  crease: 36,
  build(m) {
    const S = 1.1;
    const cyl = (r: number) => mapCylY(0, 0, r, S);
    const wall = mapAuto(S);
    // --- stepped octagonal base
    prism(m, BASE, wall, polyCorners(8, 0.78, Math.PI / 8), 0, 0.2, { bevel: 0.025 });
    prism(m, BASE, wall, polyCorners(8, 0.6, Math.PI / 8), 0.2, 0.34, { bevel: 0.02 });
    // --- lower lotus cushion (8 petals)
    m.add(
      revolve(roundCorners([[0, 0.34], [0.42, 0.34], [0.5, 0.44], [0.46, 0.56], [0.3, 0.68], [0.22, 0.72], [0, 0.72]], 0.02, 2, false), 24, (th) => 1 + 0.09 * Math.cos(th * 8) ** 3),
      STONE, cyl(0.45),
    );
    // --- shaft: faceted, entasis, knot ring at mid-height
    m.add(lathe([[0.17, 0.72], [0.2, 0.9], [0.205, 1.2], [0.19, 1.55], [0.17, 1.82]], { segments: 8 }), STONE, wall);
    m.add(revolve(roundCorners([[0.16, 1.14], [0.3, 1.16], [0.32, 1.22], [0.3, 1.28], [0.16, 1.3]], 0.015, 2, false), 8), STONE, cyl(0.3));
    // --- upper lotus (inverted petals) + platform
    m.add(
      revolve(roundCorners([[0.17, 1.82], [0.3, 1.88], [0.44, 1.96], [0.5, 2.06], [0.5, 2.1]], 0.02, 2, false), 24, (th) => 1 + 0.08 * Math.cos(th * 8 + Math.PI) ** 3),
      STONE, cyl(0.4),
    );
    prism(m, STONE, wall, polyCorners(8, 0.5, Math.PI / 8), 2.1, 2.2, { bevel: 0.015 });
    // --- firebox: octagonal core, four framed lit windows (faces 0,2,4,6) and four solid panel faces
    const core = polyCorners(8, 0.3, Math.PI / 8);
    prism(m, STONE, wall, core, 2.2, 2.78);
    const apo = 0.3 * Math.cos(Math.PI / 8);
    for (let f = 0; f < 8; f += 2) {
      const yaw = (f * Math.PI) / 4;
      // window: lit paper panel on the core face, framed by four proud stone bars
      slab(m, GLOW, wall, [0.26, 0.38, 0.01], [0, 2.49, apo + 0.003], yaw);
      for (const [w, h, x, y] of [[0.05, 0.46, -0.15, 2.49], [0.05, 0.46, 0.15, 2.49], [0.34, 0.05, 0, 2.7], [0.34, 0.05, 0, 2.28]] as [number, number, number, number][]) {
        slab(m, STONE, wall, [w, h, 0.05], [x, y, apo + 0.02], yaw);
      }
    }
    // --- curved octagonal cap with upturned hips
    const corners = polyCorners(8, 1.0, Math.PI / 8);
    roofLoft(m, {
      corners,
      stages: pyramidStages(8),
      y0: 2.78,
      rise: 0.62,
      q: 1.9,
      rings: 5,
      segs: 2,
      lift: 0.17,
      flare: 0.12,
      reach: 0.55,
      thick: 0.1,
      soffit: 0.55,
      tile: S,
      mats: { top: CAP, fascia: CAP, under: CAP },
    });
    prism(m, STONE, wall, polyCorners(8, 0.36, Math.PI / 8), 2.76, 2.82);
    // --- jewel finial: neck + onion bulb + point
    m.add(revolve(roundCorners([[0, 3.2], [0.13, 3.2], [0.1, 3.27], [0.2, 3.33], [0.22, 3.4], [0.13, 3.47], [0.05, 3.55], [0, 3.62]], 0.012, 2, false), 16), STONE, cyl(0.2));
  },
};

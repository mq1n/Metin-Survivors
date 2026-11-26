// prop_stone_gate — carved sandstone gate (7 m, pillars at x = ±2.9): basalt footings, banded octagonal sandstone pillars with
// bracketed capitals, a dark carved cloud-scroll lintel with ember-lit grooves, a bracket row and a heavy rust-red stone hip roof with
// upturned eaves, ridge and flame jewels. Front = +Z.
import { m4translation, smoothstep } from '../../core/math.ts';
import { lathe } from '../../core/hard/hardmesh.ts';
import { cap, mapBand, pillar, prism, rectCorners, revolve, roofLoft, slab } from '../../archetypes/prop/kit.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { fbm01, fract, line, lum, mixc, mulc, pickTex, rgb, stone } from '../../archetypes/prop/mats.ts';
import { type Mat, mapAuto } from '../../archetypes/prop/mesh.ts';

const SAND = 0, CARVED = 1, ROOF = 2, DARK = 3, LINTEL = 4;

/** lintel face plate: light sandstone relief on a dark field with cloud-scroll grooves that glow like embers. uv: u along the lintel (band heights), v 0..1 across */
function carved(): Mat {
  const base = stone('sandstone', { tex: ['tex_rock_canyon'], dark: '#7a4128', light: '#e0a06a', moss: 0, dirt: 0, wear: 0.5 });
  const groove = rgb('#2a1209');
  const ember = rgb('#ff6a1e');
  const mask = (u: number, v: number, aa: number): number => {
    const cx = fract(u * 0.5) - 0.5, cy = v - 0.5;
    const d = Math.hypot(cx * 1.9, cy * 1.55);
    const arc = Math.max(line(d - 0.3, 0.03, aa), line(d - 0.5, 0.026, aa) * (cy > -0.1 ? 1 : 0), line(d - 0.12, 0.02, aa));
    const rail = Math.max(line(v - 0.08, 0.022, aa), line(v - 0.92, 0.022, aa));
    return Math.max(arc, rail);
  };
  return {
    name: 'carved-band',
    ao: 0.7,
    shade(t) {
      const aa = Math.max(0.01, t.fp * 1.4);
      let c = base.shade(t);
      c = mulc(c, 0.92 + 0.12 * fbm01(t, 8, 2, 3.3));
      return mixc(c, groove, mask(t.uv[0], t.uv[1], aa) * 0.85);
    },
    emit(t) {
      const aa = Math.max(0.01, t.fp * 1.4);
      const k = mask(t.uv[0], t.uv[1], aa);
      return k > 0.4 ? mulc(ember, 0.35 * k * (0.7 + 0.5 * fbm01(t, 12, 2, 4.1))) : null;
    },
  };
}

function stoneRoof(): Mat {
  const T = pickTex('tex_roof_tile');
  const dark = rgb('#4e2216'), light = rgb('#b4552e');
  return {
    name: 'stone-roof',
    shade(t) {
      let c = mixc(dark, light, 0.5 + 0.2 * fbm01(t, 3, 3, 1.2));
      if (T) {
        const s = t.tex(T, 1);
        c = mixc(dark, light, 0.1 + 0.85 * smoothstep(0.02, 0.3, lum(s)));
      }
      return mulc(c, 0.88 + 0.22 * fbm01(t, 6, 3, 9.1));
    },
  };
}

export const prop: PropDef = {
  id: 'prop_stone_gate',
  yScale: 0.92,
  size: 1280,
  aoLong: 2.4,
  crease: 36,
  mats: [
    stone('sandstone', { tex: ['tex_rock_canyon'], dark: '#8a4c2c', light: '#e8b07c', moss: 0, dirt: 0.3, wear: 0.55 }),
    carved(),
    stoneRoof(),
    stone('dark-basalt', { tex: ['tex_basalt'], dark: '#3b3330', light: '#8c7f78', wear: 0.4, dirt: 0.2 }),
    stone('lintel', { tex: ['tex_basalt'], dark: '#3d2d28', light: '#7c6659', wear: 0.5 }),
  ],
  emissiveFactor: [1, 1, 1],
  build(m) {
    const wall = mapAuto(1.4);
    const PX = 2.9;
    const sq = (x: number, r: number): [number, number][] => [[x - r, -r], [x + r, -r], [x + r, r], [x - r, r]];
    for (const sx of [-1, 1]) {
      const x = sx * PX;
      prism(m, DARK, wall, sq(x, 0.85), 0, 0.38, { bevel: 0.05 });
      prism(m, DARK, wall, sq(x, 0.7), 0.38, 0.62, { bevel: 0.04 });
      m.add(lathe(pillar(0.56, 0.45, 4.15, 0.05, 4), { segments: 8 }), SAND, wall, m4translation([x, 0.62, 0]));
      // carved collars (octagonal rings) at the third points and under the capital
      for (const y of [1.55, 2.9, 4.45]) m.add(lathe([[0.64 - y * 0.02, y], [0.7 - y * 0.02, y + 0.05], [0.7 - y * 0.02, y + 0.17], [0.64 - y * 0.02, y + 0.22]], { segments: 8 }), SAND, wall, m4translation([x, 0, 0]));
      // capital: stepped cross bracket
      prism(m, SAND, wall, sq(x, 0.56), 4.77, 4.92, { bevel: 0.03 });
      slab(m, SAND, wall, [1.5, 0.2, 0.62], [x, 5.04, 0]);
      slab(m, SAND, wall, [0.62, 0.2, 1.5], [x, 5.04, 0]);
      slab(m, SAND, wall, [1.9, 0.22, 0.7], [x, 5.25, 0]);
    }
    // lintel: dark core, light carved plates, second beam, bracket row under the roof
    slab(m, LINTEL, wall, [6.7, 0.72, 1.0], [0, 5.58, 0]);
    for (const sz of [-1, 1]) slab(m, CARVED, mapBand(5.9, 0.54, 'x', 0.54), [6.3, 0.54, 0.05], [0, 5.58, sz * 0.52]);
    slab(m, SAND, wall, [5.6, 0.2, 0.9], [0, 6.04, 0]);
    for (const bx of [-1.7, -0.57, 0.57, 1.7]) for (const sz of [-1, 1]) {
      slab(m, SAND, wall, [0.3, 0.26, 0.4], [bx, 6.2, sz * 0.62]);
      slab(m, SAND, wall, [0.9, 0.18, 0.34], [bx, 6.42, sz * 0.72]);
    }
    // roof: hip with upturned eaves in carved rust stone
    const roof = roofLoft(m, {
      corners: rectCorners(4.0, 1.75),
      stages: [{ f: 1, corners: [[-1.9, 0], [1.9, 0], [1.9, 0], [-1.9, 0]] }],
      y0: 6.55, rise: 0.62, q: 1.5, rings: 4, segs: [8, 3, 8, 3],
      lift: 0.34, flare: 0.22, reach: 0.3, thick: 0.28, soffit: 1.0, tile: 1.5,
      mats: { top: ROOF, fascia: ROOF, under: DARK },
    });
    for (const path of roof.hips) cap(m, SAND, path, 0.1, wall, 4);
    const ry = roof.crest[0]![1];
    cap(m, SAND, [[-1.9, ry, 0], [1.9, ry, 0]], 0.13, wall, 5);
    m.add(revolve([[0, 0], [0.13, 0], [0.1, 0.08], [0.17, 0.2], [0.08, 0.34], [0.02, 0.44], [0, 0.5]], 8), SAND, wall, m4translation([0, ry + 0.04, 0]));
    for (const sx of [-1, 1]) m.add(revolve([[0, 0], [0.12, 0], [0.07, 0.16], [0, 0.26]], 5), SAND, wall, m4translation([sx * 1.9, ry + 0.04, 0]));
  },
};

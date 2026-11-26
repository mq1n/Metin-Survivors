// prop_lamp_post — village street lamp (4.2 m): octagonal granite plinth with a lotus cushion, tapering red-lacquer post with a black
// skirt and a dancheong collar, dark capital, iron gooseneck bracket with a diagonal brace, a hanging octagonal paper lantern (glowing,
// glyph rings and lotus medallions, red tassel) and a small tiled cap with a gilt finial. Emissive paper. Front = +Z, bracket toward +X.
import type { Vec3 } from '../../core/math.ts';
import { smoothstep } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type Mat, type PropMesh, mapCylY } from '../../archetypes/prop/mesh.ts';
import { mapRing, pyramidStages, rectCorners, revolve, roofLoft } from '../../archetypes/prop/kit.ts';
import { dancheong, fbm01, gold, lacquer, mixc, mulc, rgb, roofEdge, roofTile, stone, wood } from '../../archetypes/prop/mats.ts';
import { moveXf, mul, rotY, tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { blackIron } from '../../archetypes/prop/ext/PropsOrc/mats.ts';
import { paperLantern } from '../../archetypes/prop/ext/PropsVillage/mats.ts';
import { cov } from '../../archetypes/prop/ext/PropsVillage/sdf.ts';

const STONE = 0, POST = 1, DANCH = 2, GOLD = 3, IRON = 4, PAPER = 5, FRAME = 6, TASSEL = 7, TILE = 8, EDGE = 9, WOOD = 10, CAPITAL = 11;

const LX = 0.55;
const goldc = rgb('#d9a532');

/** red lacquer post: black skirt at the foot with gold rules, gold rules under the collar */
function postMat(): Mat {
  const base = lacquer('lamp-post', { color: '#a1231a', wear: 0.8, dirt: 0.4 });
  const skirtC = rgb('#1d1411');
  return {
    name: 'lamp-post',
    shade(t) {
      const y = t.p[1], aa = Math.max(0.002, t.mpt * 1.2);
      let c = base.shade(t);
      const skirt = 1 - smoothstep(0.82 - aa, 0.82 + aa, y);
      c = mixc(c, mulc(skirtC, 0.9 + 0.2 * fbm01(t, 30, 2, 1)), skirt);
      const rules = Math.max(cov(Math.abs(y - 0.84) - 0.009, aa), cov(Math.abs(y - 0.87) - 0.0035, aa), cov(Math.abs(y - 3.3) - 0.008, aa), cov(Math.abs(y - 3.33) - 0.0035, aa));
      return mixc(c, mulc(goldc, 0.9 + 0.2 * fbm01(t, 50, 2, 2)), rules);
    },
  };
}

/** dark lacquer capital with gold rules at each step */
function capitalMat(): Mat {
  const base = lacquer('lamp-capital', { color: '#5e1812', wear: 0.5, dirt: 0 });
  return {
    name: 'lamp-capital',
    shade(t) {
      const y = t.p[1], aa = Math.max(0.002, t.mpt * 1.2);
      const rules = Math.max(cov(Math.abs(y - 3.605) - 0.006, aa), cov(Math.abs(y - 3.665) - 0.006, aa), cov(Math.abs(y - 3.775) - 0.007, aa));
      return mixc(base.shade(t), mulc(goldc, 0.9 + 0.2 * fbm01(t, 50, 2, 2)), rules);
    },
  };
}

/** silk tassel: gold knob and neck, red strands with darker strand lines */
function tasselMat(): Mat {
  const red = rgb('#b3261e'), dark = rgb('#5a1410');
  return {
    name: 'lamp-tassel',
    ao: 0.6,
    shade(t) {
      const th = Math.atan2(t.p[0] - LX, t.p[2]);
      if (t.p[1] > 2.895) return mulc(goldc, 0.85 + 0.25 * fbm01(t, 60, 2, 1));
      const strand = Math.abs(Math.sin(th * 14 + t.p[1] * 6));
      return mulc(mixc(red, dark, 0.55 * (1 - strand) * smoothstep(2.86, 2.8, t.p[1]) + 0.2 * fbm01(t, 40, 2, 3)), 0.9 + 0.2 * fbm01(t, 70, 2, 4));
    },
  };
}

export const prop: PropDef = {
  id: 'prop_lamp_post',
  size: 1024,
  aoLong: 2.2,
  crease: 38,
  emissiveFactor: [1, 1, 1],
  mats: [
    stone('granite', { tex: ['tex_stone_block_wall', 'tex_rock_mossy'], dark: '#6a675f', light: '#c5bdae', moss: 0.2, dirt: 0.45, wear: 0.55, k: 1.1 }),
    postMat(),
    dancheong('collar'),
    gold('lamp-gold'),
    blackIron('bracket', { rust: 0.3, tone: '#34343b' }),
    paperLantern('paper', { cx: LX, cz: 0, y0: 3.0, y1: 3.4, glow: 1.0 }),
    lacquer('lantern-frame', { color: '#6e1812', wear: 0.4, dirt: 0 }),
    tasselMat(),
    roofTile('lamp-tile', { hip: 1, moss: 0.1 }),
    roofEdge('lamp-edge', { tile: 0.84, period: 0.09 }),
    wood('lamp-wood', { tex: ['tex_wood_beam_dark'], dark: '#2a1810', light: '#5c3b25' }),
    capitalMat(),
  ],
  build(m: PropMesh) {
    const rs = (r: number, s = 0.9) => mapCylY(0, 0, r, s);
    // ---- plinth: octagonal slab, then a lotus cushion that carries the post
    m.add(revolve([[0.5, 0], [0.5, 0.11], [0.45, 0.14], [0.45, 0.21]], 8), STONE, rs(0.5));
    m.add(revolve([[0.4, 0.21], [0.43, 0.3], [0.3, 0.4], [0.19, 0.46]], 16, (th) => 1 + 0.09 * Math.cos(th * 8) ** 3), STONE, rs(0.4));
    // ---- lacquered post with entasis
    m.add(revolve([[0.175, 0.46], [0.14, 0.52], [0.122, 0.74], [0.105, 1.5], [0.09, 3.3], [0.09, 3.62]], 10), POST, rs(0.12));
    // dancheong collar under the capital
    m.add(revolve([[0.088, 3.38], [0.108, 3.385], [0.108, 3.515], [0.088, 3.52]], 10), DANCH, mapRing(0, 0, 0.108, 3.52, 0.14));
    // capital block
    m.add(revolve([[0.09, 3.58], [0.13, 3.6], [0.13, 3.66], [0.19, 3.72], [0.19, 3.78]], 8), CAPITAL, rs(0.17));
    // ---- iron gooseneck bracket with brace and hook, chain to the lantern
    const bar = (path: Vec3[], r0: number, r1: number, seed: string): void =>
      tube(m, { path, radii: path.map((_, i) => r0 + ((r1 - r0) * i) / (path.length - 1)), sides: 4, phase: Math.PI / 4, mat: IRON, s: 0.4, caps: 'both', seed, jitter: 0.04 });
    // arm: quadratic sweep from the post up to the point above the lantern axis
    const arm: Vec3[] = Array.from({ length: 7 }, (_, i) => {
      const t = i / 6, u = 1 - t;
      return [u * u * 0.06 + 2 * u * t * 0.32 + t * t * LX, u * u * 3.47 + 2 * u * t * 3.47 + t * t * 3.62, 0] as Vec3;
    });
    bar(arm, 0.024, 0.016, 'arm');
    bar([[0.075, 3.1, 0], [0.2, 3.26, 0], [0.33, 3.52, 0]], 0.02, 0.016, 'brace');
    bar([[LX, 3.62, 0], [LX, 3.5, 0]], 0.009, 0.009, 'chain');
    // ---- hanging octagonal paper lantern (a face centred on +Z)
    const put = mul(moveXf(LX, 0, 0), rotY(Math.PI / 8));
    m.add(revolve([[0.12, 3.0], [0.165, 3.06], [0.178, 3.2], [0.168, 3.33], [0.15, 3.4]], 8), PAPER, mapCylY(LX, 0, 0.17, 0.5), put);
    m.add(revolve([[0.19, 3.4], [0.19, 3.43], [0.12, 3.47], [0.03, 3.5]], 8), FRAME, mapCylY(LX, 0, 0.17, 0.5), put);
    m.add(revolve([[0.0, 2.94], [0.1, 2.945], [0.17, 2.975], [0.15, 3.0]], 8), FRAME, mapCylY(LX, 0, 0.17, 0.5), put);
    m.add(revolve([[0.0, 2.735], [0.045, 2.74], [0.042, 2.86], [0.012, 2.9], [0.024, 2.93], [0, 2.945]], 6), TASSEL, mapCylY(LX, 0, 0.03, 0.2), moveXf(LX, 0, 0));
    // ---- tiled cap and gilt finial
    roofLoft(m, {
      corners: rectCorners(0.42, 0.42),
      stages: pyramidStages(4),
      y0: 3.83, rise: 0.2, q: 1.45, rings: 3, segs: 2, lift: 0.055, flare: 0.05, reach: 0.45, thick: 0.05, soffit: 0.7, tile: 0.84,
      mats: { top: TILE, fascia: EDGE, under: WOOD },
    });
    m.add(revolve([[0, 4.03], [0.045, 4.03], [0.03, 4.07], [0.052, 4.1], [0.025, 4.15], [0, 4.2]], 6), GOLD, mapCylY(0, 0, 0.05, 0.3));
  },
};

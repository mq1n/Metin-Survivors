// prop_barrel — bellied oak barrel (1.0 m) with four riveted iron hoops, sunken head with a corked bung, a wooden spigot and a burnt-in
// sun brand; staves are individually toned and separated by painted grooves, a tarry drip runs down from the bung. Front = +Z.
import { lathe } from '../../core/hard/hardmesh.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type Mat, type PropMesh, mapCylY } from '../../archetypes/prop/mesh.ts';
import { mixc, mulc, rgb } from '../../archetypes/prop/mats.ts';
import { revolve } from '../../archetypes/prop/kit.ts';
import { log, moveXf } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { blackIron, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';
import { MOTIFS, cov, hash3 } from '../../archetypes/prop/ext/PropsOrc/paint.ts';

const WOOD = 0, IRON = 1;

const STAVES = 9;
const SEGS = STAVES * 2;
/** barrel profile: [radius, height] at the belly stations */
const PROFILE: [number, number][] = [[0.0, 0.0], [0.33, 0.0], [0.368, 0.1], [0.4, 0.3], [0.418, 0.5], [0.4, 0.7], [0.368, 0.9], [0.335, 1.0], [0.312, 1.0], [0.312, 0.955], [0.0, 0.955]];
const HOOPS = [0.075, 0.24, 0.76, 0.925];

const radiusAt = (y: number): number => {
  for (let i = 1; i < PROFILE.length - 3; i++) {
    const [r0, y0] = PROFILE[i]!, [r1, y1] = PROFILE[i + 1]!;
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0.33;
};

/** oak staves: tone per stave, painted gaps between them, tarry drips, a branded sun on the front, rivets on the hoops are on the iron */
function barrelWood(): Mat {
  const base = timber('barrel-oak', { dark: '#3b2a1b', mid: '#7a5a38', light: '#b08b5c', grey: '#948c78', facets: 0.3, dirt: 0.5, grain: 'v', scale: 0.7, tileM: 0.9, tile: ['tex_wood_plank'], tileRange: [0.012, 0.25], tileGrain: 'u' });
  const tar = rgb('#140f0b'), char = rgb('#1c130d');
  return {
    name: 'barrel',
    shade(t) {
      let c = base.shade(t);
      const th = Math.atan2(t.p[0], t.p[2]);
      const aa = Math.max(0.0015, t.mpt * 1.2);
      if (Math.abs(t.n[1]) < 0.7) {
        const sf = ((th / (Math.PI * 2)) * STAVES + 0.5) / 1;
        const id = Math.floor(sf);
        const f = sf - id;
        c = mulc(c, 0.82 + 0.34 * hash3(id, 3, 7));
        // groove between staves
        const edge = Math.min(f, 1 - f);
        c = mulc(c, 0.3 + 0.7 * (1 - cov(edge - 0.05, 0.012 + 0.4 * aa * STAVES)));
        // a tarry drip from the bung down the +x side and a brand burnt into the front
        const drip = cov(Math.abs(t.p[0] - 0.2 - 0.02 * Math.sin(t.p[1] * 9)) - 0.012, aa) * (t.p[1] > 0.55 ? 1 : 0) * (t.n[2] > 0.3 ? 1 : 0) * (1 - Math.min(1, Math.max(0, (0.95 - t.p[1]) / 0.4)));
        c = mixc(c, tar, 0.75 * drip);
        if (t.n[2] > 0.5) {
          const d = MOTIFS.sun(t.p[0] / 0.11, (t.p[1] - 0.5) / 0.11) * 0.11;
          c = mixc(c, mulc(char, 0.9 + 0.3 * t.noise.noise(t.p[0] * 50, t.p[1] * 50, 2.2)), cov(d, aa) * 0.9);
        }
      } else if (t.p[1] > 0.9) {
        // planked head: seams between three boards
        const sx = Math.abs(((t.p[0] + 0.1) % 0.2) - 0.1);
        c = mulc(c, 0.55 + 0.45 * (1 - cov(0.1 - sx - 0.092, 0.01)));
      }
      return c;
    },
  };
}

export const prop: PropDef = {
  id: 'prop_barrel',
  size: 1024,
  aoLong: 1.2,
  crease: 14,
  mats: [barrelWood(), blackIron('hoop-iron', { rust: 0.55, tone: '#3f4148' })],
  build(m: PropMesh) {
    // ---- stave body: slightly grooved between staves, one lathe so the belly reads as a single swelling
    const body = revolve(PROFILE, SEGS, (theta) => {
      const k = Math.round((theta / (Math.PI * 2)) * SEGS);
      return k % 2 === 0 ? 1 : 0.975;
    });
    m.add(body, WOOD, mapCylY(0, 0, 0.4, 0.7));
    // ---- iron hoops: raised bands, slightly rolled, rivets painted by the iron material
    for (const y of HOOPS) {
      const r = radiusAt(y + 0.022) + 0.012;
      m.add(lathe([[r - 0.008, y], [r + 0.016, y + 0.008], [r + 0.016, y + 0.04], [r - 0.008, y + 0.05]], { segments: 14 }), IRON, mapCylY(0, 0, r, 0.5));
    }
    // ---- bung and spigot
    m.add(lathe([[0, 0.0], [0.045, 0.0], [0.04, 0.045], [0.0, 0.05]], { segments: 6 }), WOOD, mapCylY(0, 0, 0.1, 0.5), moveXf(0.17, 0.955, -0.08));
    const tapY = 0.2;
    const rz = radiusAt(tapY) - 0.01;
    log(m, IRON, [0, tapY, rz], [0, tapY - 0.03, rz + 0.12], 0.02, 0.016, { sides: 5, segs: 1, seed: 'tap', caps: 'both' });
    log(m, WOOD, [-0.05, tapY - 0.02, rz + 0.1], [0.05, tapY - 0.02, rz + 0.1], 0.014, 0.014, { sides: 4, segs: 1, seed: 'tapk', caps: 'both' });
  },
};

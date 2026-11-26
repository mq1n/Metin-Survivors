// prop_banner_pole — tall lashed-timber standard (7 m): spliced two-part pole on a braced stone footing, crossbar with a long
// swallow-tail war banner (red, gold border, painted sun), iron spear finial with a pair of bone horns and a hair tassel. Front = +Z.
import { Rng } from '../../core/rng.ts';
import { extrude, lathe } from '../../core/hard/hardmesh.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type PropMesh, mapBox } from '../../archetypes/prop/mesh.ts';
import { stone } from '../../archetypes/prop/mats.ts';
import { arcPath, frameXf, horn, lash, log, mul, moveXf, rotY, sheet, spike, stoneChunk } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { blackIron, bone, cloth, endGrain, rope, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';

const LOG = 0, END = 1, ROPE = 2, IRON = 3, HORN = 4, CLOTH = 5, STONE = 6, TASSEL = 7;

const BAR_Y = 6.12;
const BAN_W = 1.3;
const BAN_L = 3.3;
/** swallow-tail: the centre is cut short, the left tail is a little longer than the right one */
const bannerLen = (u: number): number => BAN_L * (1 - 0.3 * (1 - Math.abs(u * 2 - 1))) * (1 - 0.07 * (u - 0.5));

export const prop: PropDef = {
  id: 'prop_banner_pole',
  size: 1024,
  aoLong: 2.5,
  crease: 46,
  mats: [
    timber('standard-timber', { dark: '#2e2218', mid: '#614a32', light: '#957650', grey: '#8a8472', bark: 0.25, facets: 0.9, dirt: 0.5, bands: [[1.55, 1.62, '#a5321c'], [5.2, 5.28, '#a5321c'], [5.3, 5.33, '#e6dcc0']] }),
    endGrain('end-grain'),
    rope('rope', { across: 'u', color: '#8c7048', dark: '#46341d' }),
    blackIron('iron', { rust: 0.35, tone: '#4a4d56' }),
    bone('horn', { horn: true }),
    cloth('banner', {
      color: '#a3231a', dark: '#5a1812', soot: 0.6,
      sigil: { kind: 'sun', u: BAN_W / 2, v: 1.05, size: 0.42, color: '#e8c25a' },
      borders: [[0.0, 0.1, '#e8c25a'], [0.14, 0.17, '#e8c25a'], [1.62, 1.66, '#e8c25a']],
    }),
    stone('footing', { tex: ['tex_rock_mossy'], k: 1.5, dark: '#34312e', light: '#a39b8a', moss: 0.2, dirt: 0.55, wear: 0.6 }),
    cloth('tassel', { color: '#8e2218', dark: '#4a1510', soot: 0.6 }),
  ],
  build(m: PropMesh) {
    const rng = new Rng('banner_pole');
    const map = mapBox(0.8);
    // ---- footing: ring of stones and two wedge braces
    for (let k = 0; k < 3; k++) {
      const a = 0.5 + (k / 3) * Math.PI * 2 + (rng.next() - 0.5) * 0.3;
      const r = 0.2 + rng.next() * 0.06;
      m.add(stoneChunk(rng, 0.4 + rng.next() * 0.14, 0.2 + rng.next() * 0.16, 0.34, 5, 0.7), STONE, map, mul(moveXf(Math.sin(a) * r, 0, Math.cos(a) * r), rotY(rng.next() * 6)));
    }
    // ---- spliced pole: stout lower log, slimmer upper log, rope + iron splice collar
    log(m, LOG, [0, 0, 0], [0.01, 3.95, 0], 0.15, 0.115, { sides: 7, segs: 2, chamfer1: 0.02, capMat: END, seed: 'pole-lo', jitter: 0.05, bow: [0.025, 0, 0.01], caps: 'end' });
    log(m, LOG, [0.01, 3.7, 0.0], [0, 6.62, 0], 0.105, 0.065, { sides: 7, segs: 2, chamfer1: 0.02, capMat: END, seed: 'pole-hi', jitter: 0.05, bow: [-0.02, 0, 0.012], caps: 'end' });
    lash(m, ROPE, [0.01, 3.82, 0], [0, 1, 0], 0.15, 0.3, { sides: 7, ridges: 2, bulge: 0.03, seed: 'sp' });
    for (const sx of [-1, 1]) {
      log(m, LOG, [sx * 0.62, 0, 0.0], [sx * 0.04, 1.75, 0.0], 0.06, 0.05, { sides: 4, segs: 1, chamfer1: 0.012, capMat: END, seed: `brace${sx}`, jitter: 0.06, caps: 'end' });
      lash(m, ROPE, [sx * 0.07, 1.64, 0], [0, 1, 0], 0.16, 0.12, { sides: 6, bulge: 0.025, seed: `bl${sx}` });
    }
    // ---- crossbar with iron end spikes
    log(m, LOG, [-0.88, BAR_Y, 0], [0.88, BAR_Y + 0.02, 0], 0.045, 0.04, { sides: 6, segs: 2, chamfer0: 0.012, chamfer1: 0.012, capMat: END, seed: 'bar', jitter: 0.05, bow: [0, -0.02, 0] });
    lash(m, ROPE, [0, BAR_Y + 0.005, 0], [0, 1, 0], 0.115, 0.14, { sides: 6, bulge: 0.03, seed: 'barl' });
    for (const sx of [-1, 1]) {
      spike(m, IRON, [sx * 0.88, BAR_Y + 0.01, 0], [sx, 0.12, 0], 0.22, 0.04, { sides: 4 });
    }
    // ---- finial: iron spearhead on a socket, two bone horns and a red hair tassel
    m.add(lathe([[0.075, 0], [0.085, 0.04], [0.06, 0.12], [0.04, 0.22]], { segments: 6 }), IRON, map, moveXf(0, 6.5, 0));
    m.add(extrude([[0, 0], [0.075, 0.1], [0.085, 0.22], [0, 0.46], [-0.085, 0.22], [-0.075, 0.1]], 0.024, { axis: 'z', z0: -0.012 }), IRON, map, frameXf([0, 6.54, 0], [0, 1, 0], [1, 0, 0]));
    for (const sx of [-1, 1]) {
      horn(m, HORN, arcPath([sx * 0.06, 6.42, 0.0], [sx * 0.9, 0.5, 0], [sx * 0.3, 1, 0], 0.5, 1.5, 3), 0.045, { sides: 4, seed: `fh${sx}` });
    }
    sheet(m, {
      nu: 2, nv: 3, thick: 0.008, mat: TASSEL, outward: [0, 0, 1],
      at: (u, v) => [(u - 0.5) * 0.08 * (1 - 0.4 * v) + 0.05 * v, 6.5 - 0.45 * v, 0.08 + 0.05 * v],
      uv: (u, v) => [u * 0.08, v * 0.45],
    });
    // ---- long swallow-tail banner hanging from the crossbar, flutter folds in z
    sheet(m, {
      nu: 4, nv: 6, thick: 0.012, mat: CLOTH, outward: [0, 0, 1],
      at: (u, v) => {
        const l = bannerLen(u);
        const amp = 0.2 * v * v;
        const taper = 1 - 0.1 * v;
        const x = (u - 0.5) * BAN_W * taper + 0.06 * Math.sin(v * 3.1 + 0.4) * v;
        return [x, BAR_Y - 0.08 - l * v, 0.14 + amp * (0.5 + 0.5 * Math.sin(v * 4.6 + u * 2.2 - 0.6))];
      },
      uv: (u, v) => [u * BAN_W, v * bannerLen(u)],
    });
    for (const u of [-0.5, 0.5]) {
      lash(m, ROPE, [u * 1.2, BAR_Y + 0.0, 0.0], [1, 0, 0], 0.055, 0.07, { sides: 5, bulge: 0.015, seed: `bt${u}` });
    }
  },
};

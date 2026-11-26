// prop_war_banner — low orc war standard (4 m): leaning timber pole with a tusk-tipped crossbar, six torn charcoal strips painted with a
// bone-white skull and red ochre bands, a horned skull on top, stone-weighted footing with guy ropes pegged to iron stakes. Front = +Z.
import { Rng } from '../../core/rng.ts';
import type { Vec3 } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type PropMesh, mapBox } from '../../archetypes/prop/mesh.ts';
import { stone } from '../../archetypes/prop/mats.ts';
import { arcPath, horn, lash, log, mul, moveXf, rotY, sheet, skull, spike, stoneChunk, tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { blackIron, bone, cloth, endGrain, rope, skullBone, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';

const LOG = 0, END = 1, ROPE = 2, IRON = 3, HORN = 4, SKULL = 5, CLOTH = 6, STONE = 7;

const BAR_Y = 3.3;
const W = 1.62; // banner width
const STRIPS = 6;
/** length of each torn strip (m) */
const LENS = [1.45, 1.95, 1.25, 2.0, 1.6, 1.2];

export const prop: PropDef = {
  id: 'prop_war_banner',
  size: 1024,
  aoLong: 2.0,
  crease: 46,
  mats: [
    timber('war-timber', { dark: '#241a13', mid: '#4f3b28', light: '#826446', grey: '#7c7766', bark: 0.3, facets: 0.9, dirt: 0.55, bands: [[0.9, 0.97, '#a5321c'], [2.3, 2.36, '#a5321c'], [2.39, 2.42, '#e6dcc0']] }),
    endGrain('end-grain', { light: '#9c7c55', dark: '#5a4128' }),
    rope('rope', { across: 'u', color: '#7e6642', dark: '#3d2d19' }),
    blackIron('iron', { rust: 0.5, tone: '#44474f' }),
    bone('horn', { horn: true }),
    skullBone('skull'),
    cloth('war-cloth', {
      color: '#26211f', dark: '#0b0908', soot: 0.5,
      sigil: { kind: 'skull', u: W / 2, v: 0.82, size: 0.5, color: '#e3d8b6' },
      borders: [[0.0, 0.1, '#a5321c'], [0.16, 0.19, '#a5321c'], [1.28, 1.34, '#a5321c']],
    }),
    stone('footing', { tex: ['tex_rock_mossy'], k: 1.5, dark: '#34312e', light: '#a39b8a', moss: 0.15, dirt: 0.55, wear: 0.6 }),
  ],
  build(m: PropMesh) {
    const rng = new Rng('war_banner');
    const map = mapBox(0.8);
    // ---- leaning pole
    log(m, LOG, [0, 0, 0], [0.04, 3.68, 0], 0.1, 0.062, { sides: 7, segs: 3, chamfer1: 0.02, capMat: END, seed: 'wpole', jitter: 0.06, bow: [0.03, 0, 0.02], caps: 'end' });
    // ---- footing: stones, sharpened support stakes, a skull
    for (let k = 0; k < 2; k++) {
      const a = 0.9 + (k / 2) * Math.PI * 2 + (rng.next() - 0.5) * 0.3;
      const r = 0.24 + rng.next() * 0.05;
      m.add(stoneChunk(rng, 0.4 + rng.next() * 0.14, 0.2 + rng.next() * 0.16, 0.34, 5, 0.7), STONE, map, mul(moveXf(Math.sin(a) * r, 0, Math.cos(a) * r), rotY(rng.next() * 6)));
    }
    for (const [a, h] of [[2.4, 0.78], [-2.3, 0.7]] as [number, number][]) {
      log(m, LOG, [Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5], [Math.sin(a) * 0.06, h, Math.cos(a) * 0.06], 0.05, 0.035, { sides: 4, segs: 1, chamfer1: 0.01, capMat: END, seed: `prop${a}`, jitter: 0.06, caps: 'end' });
    }
    lash(m, ROPE, [0.01, 0.72, 0], [0, 1, 0], 0.115, 0.14, { sides: 6, bulge: 0.028, seed: 'fl' });
    skull(m, { bone: SKULL }, [0.3, 0.1, 0.58], 0.45, 0.2, { detail: 0, pitch: 0.4, roll: 0.25 });
    // ---- crossbar with upswept tusks at both ends
    log(m, LOG, [-0.93, BAR_Y, 0], [0.93, BAR_Y + 0.02, 0], 0.052, 0.045, { sides: 6, segs: 2, chamfer0: 0.012, chamfer1: 0.012, capMat: END, seed: 'wbar', jitter: 0.06, bow: [0, -0.025, 0] });
    lash(m, ROPE, [0.03, BAR_Y + 0.01, 0], [0, 1, 0], 0.115, 0.15, { sides: 6, bulge: 0.03, seed: 'wbl' });
    for (const sx of [-1, 1]) {
      horn(m, HORN, arcPath([sx * 0.9, BAR_Y + 0.02, 0], [sx * 1, 0.25, 0], [0, 1, 0], 0.5, 1.2, 3), 0.05, { sides: 4, seed: `wt${sx}` });
    }
    // ---- horned skull on the pole head
    skull(m, { bone: SKULL }, [0.04, 3.6, 0.12], 0, 0.3, { detail: 0, pitch: -0.1, horns: { mat: HORN, len: 1.4, r: 0.1, curl: 1.3, up: 0.05, segs: 3, sides: 4 } });
    spike(m, IRON, [0.04, 3.64, -0.03], [0, 1, -0.05], 0.2, 0.03, { sides: 4 });
    // ---- torn charcoal strips (one painted surface: uv runs continuously across them)
    for (let i = 0; i < STRIPS; i++) {
      const x0 = -W / 2 + (i / STRIPS) * W + 0.012, x1 = -W / 2 + ((i + 1) / STRIPS) * W - 0.012;
      const L = LENS[i]!;
      const ph = i * 1.7;
      const wob = 0.9 + 0.3 * rng.next();
      const at = (u: number, v: number): Vec3 => {
        // strips narrow to a ragged point, sway sideways and twist so they catch the light differently
        const w = (1 - 0.7 * Math.pow(v, 2.4)) * wob;
        const cx = (x0 + x1) / 2 + Math.sin(v * 2.4 + ph) * 0.11 * v + (i % 2 === 0 ? 1 : -1) * 0.05 * v * v;
        const tw = Math.sin(v * 3.1 + ph * 1.3) * 0.09 * v;
        return [cx + (u - 0.5) * (x1 - x0) * w, BAR_Y - 0.06 - L * v, 0.14 + 0.24 * v * v * (0.5 + 0.5 * Math.sin(v * 3.7 + ph)) + 0.03 * (i % 3) + (u - 0.5) * tw];
      };
      sheet(m, { nu: 1, nv: 3, thick: 0.01, mat: CLOTH, outward: [0, 0, 1], at, uv: (u, v) => [at(u, v)[0] + W / 2, v * L] });
    }
    // ---- rope guys to iron stakes
    for (const [a, r] of [[1.35, 0.95], [-1.4, 0.9], [3.2, 0.85]] as [number, number][]) {
      const g: Vec3 = [Math.sin(a) * r, 0.02, Math.cos(a) * r];
      tube(m, { path: [[0.03, 2.45, 0], [g[0] * 0.5, 1.2, g[2] * 0.5], g], radii: [0.016, 0.014, 0.014], sides: 4, mat: ROPE, s: 0.35, caps: 'none', seed: `guy${a}` });
      spike(m, IRON, [g[0], 0.16, g[2]], [-g[0] * 0.3, -1, -g[2] * 0.3], 0.2, 0.025, { sides: 4 });
    }
  },
};

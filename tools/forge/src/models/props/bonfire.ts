// prop_bonfire — camp fire (1.4 m): ring of soot-blackened boulders around a mound of glowing coals, a teepee of charred logs with
// glowing fissures and a few crossed base logs. The flame itself is VFX; the coals and cracks carry an emissive map.
import { Rng } from '../../core/rng.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type Mat, type PropMesh, mapBox, mapCylY } from '../../archetypes/prop/mesh.ts';
import { lathe } from '../../core/hard/hardmesh.ts';
import { mixc, mulc, rgb, stone } from '../../archetypes/prop/mats.ts';
import { lerp, log, moveXf, mul, rotX, rotY, rotZ, stoneChunk } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { endGrain } from '../../archetypes/prop/ext/PropsOrc/mats.ts';
import { charred, emberBed } from '../../archetypes/prop/ext/PropsOrc/mats2.ts';
import { smoothstep } from '../../core/math.ts';

const STONE = 0, CHAR = 1, END = 2, EMBER = 3;

/** soot-blackened boulders: darker on the faces looking at the fire */
function sootStone(): Mat {
  const base = stone('boulder', { tex: ['tex_rock_mossy'], k: 1.5, dark: '#34312e', light: '#a39b8a', moss: 0.12, dirt: 0.5, wear: 0.7 });
  return {
    name: 'boulder',
    shade(t) {
      let c = base.shade(t);
      const r = Math.hypot(t.p[0], t.p[2]) || 1;
      const inward = -(t.n[0] * t.p[0] + t.n[2] * t.p[2]) / r;
      const scorch = smoothstep(0.1, 0.8, inward) * (1 - smoothstep(0.25, 0.7, t.p[1]));
      c = mixc(c, rgb('#15110e'), 0.8 * scorch);
      // a hint of warm bounce light on the scorched faces
      c = mixc(c, mulc(rgb('#8a3a14'), 0.8), 0.22 * scorch * smoothstep(0.0, 0.2, t.ao));
      return c;
    },
  };
}

export const prop: PropDef = {
  id: 'prop_bonfire',
  size: 1024,
  aoLong: 1.4,
  crease: 46,
  emissiveFactor: [1, 1, 1],
  mats: [sootStone(), charred('charred-log', { glow: 1.1, core: [0.0, 0.75] }), endGrain('char-end', { light: '#5a4636', dark: '#241a14' }), emberBed('embers', { glow: 1.1 })],
  build(m: PropMesh) {
    const rng = new Rng('bonfire');
    // ---- glowing coal mound inside the ring (profile bottom -> top for outward/upward faces)
    m.add(lathe([[0.7, 0.08], [0.62, 0.12], [0.45, 0.2], [0.22, 0.27], [0.0, 0.3]], { segments: 12 }), EMBER, mapCylY(0, 0, 0.6, 1));
    // ---- ring of boulders
    const n = 10;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + (rng.next() - 0.5) * 0.18;
      const r = 0.74 + (rng.next() - 0.5) * 0.08;
      const w = 0.46 + rng.next() * 0.16, h = 0.26 + rng.next() * 0.2, d = 0.4 + rng.next() * 0.1;
      const xf = mul(moveXf(Math.sin(a) * r, 0, Math.cos(a) * r), rotY(a + (rng.next() - 0.5) * 0.4), rotX((rng.next() - 0.5) * 0.18), rotZ((rng.next() - 0.5) * 0.18));
      m.add(stoneChunk(rng, w, h, d, 6, 0.7), STONE, mapBox(0.9), xf);
    }
    // ---- teepee of charred logs
    const logs = 8;
    for (let k = 0; k < logs; k++) {
      const a = (k / logs) * Math.PI * 2 + (rng.next() - 0.5) * 0.5;
      const rb = 0.5 + rng.next() * 0.1;
      const ya = 1.0 + rng.next() * 0.38;
      const top: [number, number, number] = [Math.sin(a + Math.PI) * 0.0 + Math.sin(a) * 0.05, ya, Math.cos(a) * 0.05];
      const base: [number, number, number] = [Math.sin(a) * rb, 0.17, Math.cos(a) * rb];
      log(m, CHAR, base, top, 0.095 - rng.next() * 0.02, 0.055, { sides: 6, segs: 2, chamfer1: 0.02, capMat: END, seed: `fl${k}`, jitter: 0.12, wobble: 0.05, bow: [(rng.next() - 0.5) * 0.06, 0, (rng.next() - 0.5) * 0.06], uOff: k * 3.1 });
    }
    // ---- crossed logs lying under the pile
    for (let k = 0; k < 3; k++) {
      const a = 0.4 + k * 1.1;
      const c = Math.cos(a), s = Math.sin(a);
      const len = 0.52 + rng.next() * 0.15;
      log(m, CHAR, [-c * len, 0.14 + k * 0.025, -s * len], [c * len, 0.14 + k * 0.025, s * len], 0.085, 0.075, { sides: 6, segs: 2, chamfer0: 0.02, chamfer1: 0.02, capMat: END, seed: `bl${k}`, jitter: 0.1, uOff: 20 + k * 2.7 });
    }
    void lerp;
  },
};

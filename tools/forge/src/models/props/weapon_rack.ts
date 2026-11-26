// prop_weapon_rack — orc weapon rack (2 m high, 2.4 x 0.8 m): two crossed-leg lashed timber frames with a trophy skull on each, a top
// bar and low rails; spears, bearded axes and a spiked club rest on it, a painted hide shield hangs in the middle.
// Front = +Z.
import { Rng } from '../../core/rng.ts';
import { type Vec3, smoothstep, vadd, vcross, vnorm, vscale } from '../../core/math.ts';
import { extrude, lathe } from '../../core/hard/hardmesh.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type Mat, type PropMesh, mapBox } from '../../archetypes/prop/mesh.ts';
import { mixc, mulc, rgb } from '../../archetypes/prop/mats.ts';
import { frameXf, lash, log, mul, moveXf, rotX, sheet, skull, spike, tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { blackIron, bone, cloth, endGrain, leather, orcHide, rope, skullBone, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';
import { cov } from '../../archetypes/prop/ext/PropsOrc/paint.ts';

const LOG = 0, END = 1, ROPE = 2, IRON = 3, BONE = 4, SKULL = 5, HORN = 6, LEATHER = 7, SHIELD = 8, CLOTH = 9;

const TOP_Y = 1.48; // where the legs cross and the top bar sits
const SHIELD_C: Vec3 = [-0.02, 0.97, 0.12];
const SHIELD_R = 0.43;

/** painted round shield: stitched hide face, dark leather rim with bone studs, iron boss, big painted war sigil */
function shieldMat(): Mat {
  const hide = orcHide('shield-hide', {
    frame: (t) => [0, t.p[0] - SHIELD_C[0], t.p[1] - SHIELD_C[1], 9],
    dirt: 0.1,
    tile: { m: 0.9, gain: 1.35 },
    motifs: [{ panel: 0, kind: 'sun', u: 0, v: 0, size: 0.27, color: '#e6dcc0' }],
  });
  const rim = rgb('#241812'), stud = rgb('#d8cba6'), iron = rgb('#3a3a40'), red = rgb('#a5321c');
  return {
    name: 'shield',
    shade(t) {
      let c = hide.shade(t);
      const r = Math.hypot(t.p[0] - SHIELD_C[0], t.p[1] - SHIELD_C[1]);
      const ang = Math.atan2(t.p[1] - SHIELD_C[1], t.p[0] - SHIELD_C[0]);
      const aa = Math.max(0.002, t.mpt * 1.2);
      // red ring painted inside the rim band
      c = mixc(c, mulc(red, 0.9), 0.9 * cov(Math.abs(r - 0.3) - 0.018, aa));
      // dark leather rim with studs
      c = mixc(c, mulc(rim, 0.9 + 0.5 * t.ao), smoothstep(SHIELD_R - 0.085, SHIELD_R - 0.075, r));
      const studs = 16;
      const k = (((ang / (Math.PI * 2)) * studs + 0.5) % 1 + 1) % 1 - 0.5;
      c = mixc(c, stud, cov(Math.hypot(k * ((Math.PI * 2) / studs) * r, r - (SHIELD_R - 0.04)) - 0.013, aa) * 0.9);
      // iron boss
      const boss = smoothstep(0.082, 0.074, r);
      c = mixc(c, mulc(iron, 0.9 + 0.9 * t.ao + 1.4 * Math.max(0, t.n[1] * 0.5 + t.n[0] * 0.35)), boss);
      c = mixc(c, rgb('#0e0c0c'), (1 - smoothstep(0.0, 0.012, Math.abs(r - 0.082))) * 0.8);
      return c;
    },
  };
}

export const prop: PropDef = {
  id: 'prop_weapon_rack',
  size: 1024,
  aoLong: 1.6,
  crease: 46,
  mats: [
    timber('rack-timber', { dark: '#2e2118', mid: '#5c4630', light: '#8e7050', bark: 0.2, facets: 0.9, dirt: 0.5, grey: '#8a8472' }),
    endGrain('end-grain'),
    rope('rope', { across: 'u', color: '#8c7048', dark: '#46341d' }),
    blackIron('iron', { rust: 0.3, tone: '#4a4d56' }),
    bone('bone'),
    skullBone('skull'),
    bone('horn', { horn: true }),
    leather('leather'),
    shieldMat(),
    cloth('tassel', { color: '#8e2218', dark: '#4a1510', soot: 1 }),
  ],
  build(m: PropMesh) {
    const rng = new Rng('weapon_rack');
    const map = mapBox(0.7);

    // ---- two crossed-leg frames, top bar, low rails
    for (const sx of [-1, 1]) {
      const x = sx * 1.02;
      log(m, LOG, [x, 0, 0.4], [x + sx * 0.02, 1.8, -0.1], 0.07, 0.052, { sides: 6, segs: 1, chamfer1: 0.02, capMat: END, seed: `lf${sx}`, jitter: 0.07, bow: [0, 0.0, 0.015], caps: 'end' });
      log(m, LOG, [x, 0, -0.4], [x - sx * 0.02, 1.74, 0.1], 0.07, 0.052, { sides: 6, segs: 1, chamfer1: 0.02, capMat: END, seed: `lb${sx}`, jitter: 0.07, bow: [0, 0.0, -0.015], caps: 'end' });
      lash(m, ROPE, [x, TOP_Y, 0], [0, 1, 0], 0.12, 0.17, { sides: 6, bulge: 0.03, seed: `tl${sx}` });
      // trophy skull wedged in the fork
      skull(m, { bone: SKULL }, [x, 1.7, 0.15], sx * 0.12, 0.27, sx < 0
        ? { detail: 1, pitch: -0.1, horns: { mat: HORN, len: 1.2, r: 0.09, curl: 1.2, up: 0.0, segs: 3, sides: 4 } }
        : { detail: 1, pitch: -0.12, roll: 0.1 });
    }
    log(m, LOG, [-1.22, TOP_Y, 0], [1.2, TOP_Y + 0.01, 0.0], 0.055, 0.05, { sides: 6, segs: 2, chamfer0: 0.015, chamfer1: 0.015, capMat: END, seed: 'topbar', jitter: 0.07, bow: [0, 0.015, 0] });
    for (const z of [0.265, -0.265]) {
      log(m, LOG, [-1.12, 0.45, z], [1.12, 0.46, z], 0.042, 0.04, { sides: 5, segs: 1, chamfer0: 0.012, chamfer1: 0.012, capMat: END, seed: `rail${z}`, jitter: 0.07 });
      if (z > 0) for (const sx of [-1, 1]) lash(m, ROPE, [sx * 1.02, 0.455, z], [1, 0, 0], 0.062, 0.13, { sides: 5, bulge: 0.025, seed: `rl${sx}${z}` });
    }

    // ---- spears leaning on the top bar
    for (let k = 0; k < 3; k++) {
      const x = -0.98 + k * 0.17 + (rng.next() - 0.5) * 0.04;
      const b: Vec3 = [x, 0, 0.36 + k * 0.01];
      const c: Vec3 = [x + (k - 1) * 0.02, TOP_Y, 0.06];
      const d = vnorm([c[0] - b[0], c[1] - b[1], c[2] - b[2]]);
      const len = 1.62 - k * 0.07;
      const tip = vadd(b, vscale(d, len));
      log(m, LOG, b, tip, 0.024, 0.02, { sides: 4, segs: 1, capMat: END, seed: `sp${k}`, jitter: 0.04, caps: 'end' });
      // leaf-shaped iron head, socket wrap and a tuft of red hair
      m.add(extrude([[0, 0], [0.04, 0.05], [0.05, 0.12], [0.0, 0.27], [-0.05, 0.12], [-0.04, 0.05]], 0.014, { axis: 'z', z0: -0.007 }), IRON, map, frameXf(tip, d, [1, 0, 0]));
      log(m, LEATHER, vadd(tip, vscale(d, -0.05)), vadd(tip, vscale(d, 0.07)), 0.03, 0.026, { sides: 5, segs: 1, seed: `sw${k}`, caps: 'none' });
      lash(m, ROPE, vadd(tip, vscale(d, -0.22)), d, 0.025, 0.09, { sides: 5, bulge: 0.012, seed: `spl${k}` });
    }

    // ---- two bearded axes and a spiked club leaning on the right frame
    const axe = (x: number, side: number, h: number, seed: string, sc: number): void => {
      const b: Vec3 = [x, 0, 0.3];
      const t: Vec3 = [x - side * 0.04, h, 0.04];
      const d = vnorm([t[0] - b[0], t[1] - b[1], t[2] - b[2]]);
      log(m, LOG, b, t, 0.034, 0.03, { sides: 5, segs: 2, chamfer1: 0.01, capMat: END, seed, jitter: 0.05, bow: [0, 0, 0.012] });
      // crescent bearded head: drooping beard, convex cutting edge, notched toe
      const o: [number, number][] = [[-0.06, -0.04], [0.03, -0.1], [0.13, -0.21], [0.21, -0.33], [0.31, -0.24], [0.37, -0.08], [0.385, 0.07], [0.35, 0.21], [0.27, 0.34], [0.15, 0.25], [0.05, 0.16], [-0.06, 0.15], [-0.1, 0.05]];
      const head = extrude(o.map(([x0, y0]) => [x0 * sc, y0 * sc] as [number, number]), 0.032, { axis: 'z', z0: -0.016, bevel: { size: 0.009, segments: 1 } });
      m.add(head, IRON, map, frameXf(vadd(t, vscale(d, -0.04)), d, [side, 0, 0]));
      lash(m, ROPE, vadd(t, vscale(d, -0.13)), d, 0.032, 0.1, { sides: 5, bulge: 0.015, seed: `${seed}w` });
      spike(m, BONE, vadd(t, vscale(d, 0.1)), d, 0.1, 0.022, { sides: 3 });
    };
    axe(0.6, 1, 1.38, 'axe1', 1);
    axe(0.86, -1, 1.2, 'axe2', 0.75);
    {
      const b: Vec3 = [1.0, 0, 0.3];
      const t: Vec3 = [1.0, 1.18, 0.07];
      const d = vnorm([t[0] - b[0], t[1] - b[1], t[2] - b[2]]);
      log(m, LOG, b, t, 0.03, 0.13, { sides: 6, segs: 3, chamfer1: 0.035, capMat: END, seed: 'club', jitter: 0.08, bow: [0.01, 0, 0.01], swell: 0.1 });
      const s1: Vec3 = [1, 0, 0], s2 = vnorm(vcross(d, s1));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + (i % 2) * 0.5;
        const along = 0.93 + (i % 2) * 0.05;
        const pt = vadd(vadd(b, vscale(d, 1.19 * along)), vscale(vadd(vscale(s1, Math.cos(a)), vscale(s2, Math.sin(a))), 0.115));
        spike(m, IRON, pt, vadd(vscale(s1, Math.cos(a)), vscale(s2, Math.sin(a))), 0.1, 0.028, { sides: 3 });
      }
    }

    // ---- hide shield hung from the top bar with two ropes
    const sc = SHIELD_C;
    m.add(
      lathe([[0, 0], [SHIELD_R + 0.01, 0], [SHIELD_R + 0.008, 0.04], [SHIELD_R - 0.09, 0.05], [0.082, 0.05], [0.07, 0.085], [0.0, 0.1]], { segments: 12 }),
      SHIELD, map, mul(moveXf(sc[0], sc[1], sc[2]), rotX(Math.PI / 2 - 0.12)),
    );
    for (const dx of [-0.2, 0.2]) {
      tube(m, { path: [[sc[0] + dx, sc[1] + 0.36, sc[2] + 0.02], [sc[0] + dx * 0.55, (sc[1] + TOP_Y) / 2 + 0.1, sc[2] - 0.01], [sc[0] + dx * 0.4, TOP_Y - 0.02, 0.03]], radii: [0.016, 0.016, 0.016], sides: 4, mat: ROPE, s: 0.35, caps: 'none', seed: `sr${dx}` });
    }

    // ---- torn red pennant on the left end of the top bar
    sheet(m, {
      nu: 2, nv: 4, thick: 0.01, mat: CLOTH, outward: [0, 0, 1],
      at: (u, v) => {
        const l = 0.62 * (1 - 0.35 * (1 - Math.abs(u * 2 - 1)));
        return [-0.78 + (u - 0.5) * 0.2 * (1 - 0.3 * v) + 0.04 * v, TOP_Y - 0.04 - l * v, 0.06 + 0.07 * Math.sin(v * 3.2) * v];
      },
      uv: (u, v) => [u * 0.2, v * 0.6],
    });
    // ---- hanging claws from the top bar
    for (const [x, len] of [[-0.45, 0.2], [0.3, 0.26]] as [number, number][]) {
      tube(m, { path: [[x, TOP_Y - 0.03, 0.05], [x + 0.01, TOP_Y - 0.03 - len * 0.5, 0.06], [x, TOP_Y - 0.03 - len, 0.06]], radii: [0.012, 0.012, 0.012], sides: 4, mat: ROPE, s: 0.35, caps: 'none', seed: `hc${x}` });
      spike(m, BONE, [x, TOP_Y - 0.03 - len, 0.06], [0.05, -1, 0], 0.13, 0.025, { sides: 4 });
    }
  },
};

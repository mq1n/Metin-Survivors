// prop_orc_tent — orc war tent (4 m tall, ~4.4 x 4.2 m, entrance on the +Z gable): crossed gable poles carry a ridge beam, stitched
// patchwork hide roofs with ochre tribal paint are tied down to pegs by roof ropes, scalloped leather-bound hems, an ogival door whose
// two flaps are folded back, a crossed tusk arch under a horned skull, spiked pole tips and torn red streamers.
import type { Vec3 } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import type { PropMesh } from '../../archetypes/prop/mesh.ts';
import { horn, lash, lerp, log, sheet, skull, spike, sstep, tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { blackIron, bone, cloth, darkLining, endGrain, leather, orcHide, rope, skullBone, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';

const HIDE = 0, TIMBER = 1, END = 2, ROPE = 3, BONE = 4, SKULL = 5, IRON = 6, LEATHER = 7, LINING = 8, CLOTH = 9, HORN = 10;

const YR = 3.04, XE = 2.2, ZF = 2.0, ZB = 2.0;
const Z0 = -(ZB + 0.06), Z1 = ZF + 0.05;
const STAKES = [-1.94, -0.65, 0.65, 1.94];
const SLOPE = Math.hypot(XE, YR);

const hemYAt = (z: number): number => {
  let d = 9;
  for (const zk of STAKES) d = Math.min(d, Math.abs(z - zk));
  return 0.06 + 0.5 * sstep(0, 0.62, d) ** 0.85;
};

/** roof point: sg = +1 / -1 side, a 0..1 along the ridge (back -> front), s 0..1 ridge -> eave; `lift` pushes along the outward normal */
function roofP(sg: number, a: number, s: number, lift = 0): Vec3 {
  const z = lerp(Z0, Z1, a);
  const yE = hemYAt(z);
  let x = sg * XE * s, y = lerp(YR, yE, s);
  // the hide bulges between the tie ropes and is pinched at them; faint wind ripples on top
  let d = 9;
  for (const zk of STAKES) d = Math.min(d, Math.abs(z - zk));
  const sc = Math.sin(Math.PI * Math.min(1, Math.max(0, s)));
  const rip = 0.075 * sstep(0, 0.5, d) * sc ** 0.7 + 0.018 * Math.sin(z * 3.3 + s * 2.2 + sg) * sc + lift;
  const nl = Math.hypot(YR - yE, XE);
  x += sg * rip * ((YR - yE) / nl);
  y += rip * (XE / nl);
  return [x, y, z];
}

/** gable half width at height y (hide edge shared with the roofs at the end planes) */
const hw = (y: number): number => (XE * (YR - y)) / (YR - 0.06);
const DOOR_H = 2.28, DOOR_W = 0.6;
const doorHalf = (y: number): number => DOOR_W * Math.max(0, 1 - (Math.max(0, y - 0.06) / DOOR_H) ** 1.35);

export const prop: PropDef = {
  id: 'prop_orc_tent',
  size: 1536,
  aoLong: 3.0,
  crease: 46,
  mats: [
    orcHide('hide', {
      frame: (t) => {
        const [x, y, z] = t.p;
        if (Math.abs(t.n[2]) > 0.8) return [t.n[2] > 0 ? 2 : 3, x * (t.n[2] > 0 ? 1 : -1), y, y - 0.06];
        const sg = x >= 0 ? 1 : -1;
        const v = (1 - Math.min(1, Math.abs(x) / XE)) * Math.hypot(XE, YR - hemYAt(z));
        return [sg > 0 ? 0 : 1, z * sg, v, v];
      },
      palette: ['#8a6a46', '#6a4f35', '#a07c50', '#523b29', '#7a5a3b', '#94754c', '#9a7a52'],
      courseH: 1.5,
      pieceW: 1.05,
      hem: 0.24,
      top: SLOPE,
      soot: 0.8,
      patches: 5,
      patchArea: [2.0, 0.6, 3.1],
      motifs: [
        { panel: 0, kind: 'sun', u: -0.35, v: 1.95, size: 0.95 },
        { panel: 0, kind: 'claw', u: 1.35, v: 1.7, size: 0.55 },
        { panel: 0, kind: 'zig', u: -1.55, v: 0.85, size: 0.45, color: '#1b1411' },
        { panel: 1, kind: 'skull', u: 0.15, v: 1.9, size: 0.9, color: '#e6dcc0' },
        { panel: 1, kind: 'hand', u: -1.35, v: 2.2, size: 0.5 },
        { panel: 1, kind: 'hand', u: -1.05, v: 1.55, size: 0.4, rot: 0.3 },
        { panel: 1, kind: 'spiral', u: 1.45, v: 1.15, size: 0.42, color: '#1b1411' },
        { panel: 2, kind: 'hand', u: -0.92, v: 1.25, size: 0.3 },
        { panel: 2, kind: 'hand', u: 0.9, v: 1.35, size: 0.3, rot: -0.25 },
        { panel: 3, kind: 'eye', u: 0, v: 1.7, size: 0.7, color: '#1b1411' },
        { panel: 3, kind: 'chevron', u: 0, v: 0.7, size: 0.5 },
      ],
    }),
    timber('pole', { dark: '#2e2118', mid: '#5b4430', light: '#8a6b49', bark: 0.35, facets: 0.9, knots: 0.6, dirt: 0.5, bands: [[1.5, 1.66, '#a5321c'], [1.7, 1.75, '#e6dcc0']] }),
    endGrain('end-grain'),
    rope('rope', { across: 'u', color: '#8c7048', dark: '#46341d' }),
    bone('tusk'),
    skullBone('skull'),
    blackIron('iron', { rust: 0.5 }),
    leather('leather'),
    darkLining('lining'),
    cloth('streamer', { color: '#8e2218', dark: '#4a1510', soot: 1 }),
    bone('horn', { horn: true }),
  ],
  build(m: PropMesh) {
    buildRoofs(m);
    buildGables(m);
    buildInterior(m);
    buildFrame(m);
    buildTusks(m);
    buildTies(m);
  },
};

function buildRoofs(m: PropMesh): void {
  for (const sg of [1, -1]) {
    sheet(m, { nu: 16, nv: 5, at: (u, v) => roofP(sg, u, v), uv: (u, v) => [u * 4, v * 3], mat: HIDE, flip: sg < 0 });
    // sewn-on leather binding along the scalloped hem, slightly proud
    sheet(m, { nu: 16, nv: 1, at: (u, v) => roofP(sg, u, 1 - 0.07 * (1 - v), 0.02), uv: (u, v) => [u * 4, v], mat: HIDE, flip: sg < 0 });
    // rolled edges: gable seams (front + back) from eave to ridge
    for (const a of [0, 1]) {
      const pts = Array.from({ length: 5 }, (_, i) => roofP(sg, a, 1 - i / 4, 0.01));
      tube(m, { path: pts, radii: pts.map(() => 0.04), sides: 3, mat: LEATHER, s: 0.5, caps: 'none', jitter: 0.1, seed: `edge${sg}${a}` });
    }
  }
}

function buildGables(m: PropMesh): void {
  const bulge = (v: number): number => 0.06 * Math.sin(Math.PI * Math.min(1, v * 1.05));
  // front gable: two flaps folded back from an ogival door opening
  for (const side of [-1, 1] as const) {
    const at = (u: number, v: number): Vec3 => {
      const y = lerp(0.06, YR, v);
      const edge = hw(y), free = doorHalf(y);
      const x = side < 0 ? lerp(-edge, -free, u) : lerp(edge, free, u);
      const curl = 0.16 * u ** 1.7 * (1 - sstep(0.0, DOOR_H, y));
      return [x, y, Z1 + 0.02 + bulge(v) * (1 - u * 0.4) + curl];
    };
    sheet(m, { nu: 4, nv: 8, at, uv: (u, v) => [u, v], mat: HIDE, flip: side > 0 });
    // rolled free edge of the door flap
    const pts = Array.from({ length: 8 }, (_, i) => at(1, (i / 7) * ((DOOR_H + 0.06) / (YR - 0.06))));
    tube(m, { path: pts, radii: pts.map(() => 0.04), sides: 3, mat: LEATHER, s: 0.5, caps: 'none', jitter: 0.1, seed: `door${side}` });
  }
  // back gable (closed)
  sheet(m, {
    nu: 4, nv: 5, flip: true, mat: HIDE, uv: (u, v) => [u, v],
    at: (u, v) => {
      const y = lerp(0.06, YR, v);
      return [(u * 2 - 1) * hw(y), y, Z0 - 0.02 - 0.05 * Math.sin(Math.PI * v)];
    },
  });
  // threshold log
  log(m, TIMBER, [-0.72, 0.07, Z1 + 0.22], [0.72, 0.07, Z1 + 0.22], 0.08, 0.08, { sides: 6, segs: 2, chamfer0: 0.02, chamfer1: 0.02, capMat: END, seed: 'sill' });
}

function buildInterior(m: PropMesh): void {
  // dark rug floor, inner roof planes and back wall: what the door and the hem scallops reveal
  sheet(m, { nu: 1, nv: 1, flip: true, mat: LINING, at: (u, v) => [lerp(-XE + 0.1, XE - 0.1, u), 0.03, lerp(Z0 + 0.1, Z1 - 0.05, v)] });
  for (const sg of [1, -1]) {
    sheet(m, { nu: 1, nv: 1, flip: sg > 0, mat: LINING, at: (u, v) => [sg * lerp(0, XE - 0.15, v), lerp(YR - 0.12, 0.03, v), lerp(Z0 + 0.1, Z1 - 0.05, u)] });
  }
  sheet(m, {
    nu: 1, nv: 1, mat: LINING,
    at: (u, v) => {
      const y = lerp(0.03, YR - 0.14, v);
      return [(u * 2 - 1) * (XE - 0.15) * (1 - v), y, Z0 + 0.12];
    },
  });
}

function buildFrame(m: PropMesh): void {
  // ridge beam resting on the pole crossings
  const ry = YR + 0.1;
  log(m, TIMBER, [0, ry, Z0 - 0.35], [0, ry + 0.02, Z1 + 0.5], 0.105, 0.095, { sides: 7, segs: 5, chamfer0: 0.03, chamfer1: 0.03, capMat: END, seed: 'ridge', bow: [0, -0.03, 0], jitter: 0.06 });
  for (const [zEnd, dir] of [[ZF, 1], [-ZB, -1]] as const) {
    for (const sx of [-1, 1]) {
      const z = zEnd + dir * (sx < 0 ? 0.14 : 0.38);
      const base: Vec3 = [sx * 2.0, 0, z];
      const cross: Vec3 = [0, YR - 0.02, z];
      const d: Vec3 = [cross[0] - base[0], cross[1] - base[1], 0];
      const l = Math.hypot(d[0], d[1]);
      const tip: Vec3 = [cross[0] + (d[0] / l) * 0.8, cross[1] + (d[1] / l) * 0.8, z];
      log(m, TIMBER, base, tip, 0.135, 0.085, { sides: 6, segs: 4, chamfer0: 0, chamfer1: 0.03, caps: 'end', capMat: END, seed: `pole${sx}${dir}`, swell: 0.03 });
      spike(m, IRON, tip, [d[0] / l, d[1] / l, 0], 0.29, 0.062, { sides: 5 });
      // knot of lashing where the pole crosses the ridge and low down
      lash(m, ROPE, [cross[0] - (d[0] / l) * 0.02, cross[1] - (d[1] / l) * 0.02, z], [d[0], d[1], 0], 0.115, 0.2, { sides: 6, bulge: 0.03, ridges: 1, seed: `lashA${sx}${dir}` });
    }
    // torn red streamers hanging from the crossing tips
    for (const sx of [-1, 1]) {
      const z = zEnd + dir * (sx < 0 ? 0.14 : 0.38);
      const root: Vec3 = [sx * 0.36, YR + 0.6, z];
      const len = 1.0;
      sheet(m, {
        nu: 2, nv: 4, thick: 0.01, mat: CLOTH,
        at: (u, v) => {
          const w = 0.085 * (1 - 0.3 * v) * (u * 2 - 1);
          const l = len * (1 - 0.3 * (1 - Math.abs(u * 2 - 1)));
          return [root[0] + sx * 0.06 * v, root[1] - l * v, root[2] + w + dir * 0.2 * Math.sin(v * 3.2 + sx) * v];
        },
        uv: (u, v) => [u * 0.17, v * len],
      });
    }
  }
  // dorsal bone spikes along the ridge beam + rope lashings where every roof tie meets it
  const spine: [number, number][] = [[-1.72, 0.3], [-1.12, 0.4], [-0.52, 0.34], [0.08, 0.46], [0.66, 0.36], [1.24, 0.3], [1.74, 0.26]];
  for (const [z, h] of spine) spike(m, BONE, [0, ry + 0.07, z], [0, 1, -0.28], h, 0.058, { sides: 4 });
  for (const zk of STAKES) lash(m, ROPE, [0, ry, zk], [0, 0, 1], 0.11, 0.12, { sides: 7, bulge: 0.026, seed: `rl${zk}` });
}

/** crossed tusk arch over the door with a horned skull above */
function buildTusks(m: PropMesh): void {
  const zAt = (y: number): number => Z1 + 0.04 + 0.06 * Math.sin(Math.PI * (y / YR));
  for (const sx of [-1, 1]) {
    const pts: Vec3[] = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = 0.05 + 2.45 * t ** 0.95;
      const x = sx * (0.82 * Math.cos((t * Math.PI) / 2) ** 1.15 - 0.15 * t ** 4);
      pts.push([x, y, zAt(y) + 0.2]);
    }
    horn(m, BONE, pts, 0.13, { sides: 6, taper: 1.0, s: 0.5, blunt: 0.07, seed: `tusk${sx}` });
  }
  lash(m, ROPE, [0, 2.4, zAt(2.4) + 0.22], [0, 1, 0.1], 0.08, 0.16, { sides: 6, bulge: 0.03, seed: 'cross' });
  const at: Vec3 = [0, 2.74, Z1 + 0.62];
  skull(m, { bone: SKULL }, at, 0, 0.5, { detail: 2, pitch: 0.2, jaw: 0.1, horns: { mat: HORN, len: 1.25, r: 0.13, curl: 1.7 } });
}

/** pegs at every hem tab and the ropes tying the roofs down to them */
function buildTies(m: PropMesh): void {
  STAKES.forEach((zk, k) => {
    for (const sg of [1, -1]) {
      const a = (zk - Z0) / (Z1 - Z0);
      const pts: Vec3[] = [];
      const pn = 5;
      for (let i = 0; i <= pn; i++) {
        const s = 0.04 + (0.96 * i) / pn;
        const base = roofP(sg, a, s, 0.04);
        pts.push(base);
      }
      tube(m, { path: pts, radii: pts.map(() => 0.03), sides: 4, mat: ROPE, s: 0.35, caps: 'end', seed: `tie${k}${sg}` });
      // peg driven through the hem loop
      const base: Vec3 = [sg * (XE + 0.22), 0, zk], tip: Vec3 = [sg * (XE + 0.02), 0.46, zk];
      log(m, TIMBER, base, tip, 0.05, 0.05, { sides: 5, segs: 1, chamfer0: 0, chamfer1: 0.012, caps: 'end', capMat: END, seed: `peg${k}${sg}` });
    }
  });
}

// prop_totem — carved orc totem pole (6 m): tusked war-face at the foot, a bull skull with sweeping horns, painted feather wings with iron
// spikes, a horned crown skull, hanging trophy skulls and torn streamers; ochre / bone / soot paint bands. Front = +Z.
import { Rng } from '../../core/rng.ts';
import type { Vec3 } from '../../core/math.ts';
import { extrude } from '../../core/hard/hardmesh.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type Mat, type PropMesh, mapAuto, mapBox } from '../../archetypes/prop/mesh.ts';
import { mixc, mulc, rgb, stone } from '../../archetypes/prop/mats.ts';
import { arcPath, horn, lash, log, moveXf, mul, rotY, rotZ, sheet, skull, spike, stoneChunk } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { MOTIFS, cov, fract } from '../../archetypes/prop/ext/PropsOrc/paint.ts';
import { blackIron, bone, cloth, endGrain, rope, skullBone, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';

const LOG = 0, END = 1, ROPE = 2, BONE = 3, SKULL = 4, HORN = 5, IRON = 6, CLOTH = 7, STONE = 8;

const FY = 1.42; // eye line of the war-face
const WY = 3.62; // wing root height
const POLE_TOP = 5.05;

const RED = rgb('#a5321c'), BLACK = rgb('#17110e'), WHITE = rgb('#e6dcc0');

/** weathered pole timber plus the carved faces' paint, feather stripes on the wings and glyphs on the back */
function totemWood(): Mat {
  const base = timber('totem', {
    dark: '#3a2c20', mid: '#725739', light: '#a58460', bark: 0.25, facets: 0.9, knots: 0.5, dirt: 0.5,
    bands: [[0.2, 0.3, '#a5321c'], [2.06, 2.18, '#a5321c'], [2.2, 2.24, '#e6dcc0'], [3.12, 3.24, '#17110e'], [3.26, 3.3, '#e6dcc0'], [4.1, 4.3, '#a5321c'], [4.34, 4.38, '#e6dcc0'], [4.7, 4.78, '#17110e']],
  });
  return {
    name: 'totem',
    shade(t) {
      let c = base.shade(t);
      const [x, y, z] = t.p;
      const aa = Math.max(0.002, t.mpt * 1.1);
      const paint = (col: [number, number, number], k: number): void => {
        if (k > 0) c = mixc(c, mulc(col, 0.75 + 0.4 * (0.5 + 0.5 * t.noise.noise(x * 60, y * 40, z * 60))), k * 0.96);
      };
      if (t.n[2] > 0.1 && Math.abs(x) < 0.5 && y > 0.5 && y < 2.0) {
        const cs = Math.cos(0.38), sn = Math.sin(0.38);
        for (const sx of [-1, 1]) {
          // slanted almond eyes: white-rimmed black, red iris dot, heavy black brow stroke above
          const ex = (x - sx * 0.2) * sx, ey = y - FY;
          const rx = ex * cs + ey * sn, ry = -ex * sn + ey * cs;
          const eye = MOTIFS.eye(rx / 0.13, ry / 0.13) * 0.13;
          paint(BLACK, cov(Math.max(eye, -0.02), aa) * 0.0);
          const lens = Math.max(Math.hypot(rx, ry - 0.05) - 0.1, Math.hypot(rx, ry + 0.05) - 0.1);
          paint(WHITE, cov(lens, aa));
          paint(BLACK, cov(lens + 0.018, aa) - cov(lens, aa) * 0 > 0 ? cov(Math.abs(lens + 0.008) - 0.012, aa) : 0);
          paint(RED, cov(Math.hypot(rx, ry) - 0.032, aa));
          paint(BLACK, cov(Math.hypot(rx, ry) - 0.016, aa));
          const bx = (x - sx * 0.2) * sx, by = y - (FY + 0.13);
          paint(BLACK, cov(Math.abs(bx * sn * 0.9 + by * cs) - 0.025, aa) * cov(Math.abs(bx * cs - by * sn * 0.9 - 0.02) - 0.14, aa));
        }
        // war paint: three slashes on each cheek, red band across the mouth, white jaw ticks, black mouth slot
        for (const sx of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            const d = Math.abs(x - sx * (0.2 + k * 0.07) + (y - (FY - 0.28)) * sx * 0.9) - 0.016;
            paint(RED, cov(d, aa) * cov(Math.abs(y - (FY - 0.28)) - 0.11, aa));
          }
        }
        paint(BLACK, cov(Math.max(Math.abs(x) - 0.27, Math.abs(y - (FY - 0.5)) - 0.05), aa));
        paint(RED, cov(Math.max(Math.abs(x) - 0.34, Math.abs(y - (FY - 0.5)) - 0.1), aa) * 0.55);
        for (let k = -2; k <= 2; k++) paint(WHITE, cov(Math.max(Math.abs(x - k * 0.1) - 0.018, Math.abs(y - (FY - 0.8)) - 0.06), aa) * 0.9);
        const sd = MOTIFS.sun(x / 0.17, (y - (FY + 0.38)) / 0.17) * 0.17;
        paint(WHITE, cov(sd, aa));
        paint(RED, cov(Math.hypot(x, y - (FY - 0.14)) - 0.065, aa) * (t.n[2] > 0.3 ? 1 : 0));
      }
      // feather stripes along the wings
      if (Math.abs(x) > 0.3 && y > WY - 0.35 && y < WY + 0.55 && Math.abs(t.n[2]) > 0.5) {
        const k = fract((Math.abs(x) - 0.3) / 0.2);
        paint(k < 0.4 ? RED : k < 0.55 ? WHITE : BLACK, 0.85);
        paint(BLACK, cov(Math.abs(y - WY) - 0.012, aa) * 0.5);
      }
      // painted chevron rows and handprints on the long pole segments
      if (y > 3.9 && y < 4.95 && t.n[2] > -0.2) {
        const th = Math.atan2(x, z) * Math.hypot(x, z);
        const zz = Math.abs(fract(th / 0.26 + 0.5) - 0.5) * 0.26 * 0.9;
        for (const [yc, col] of [[4.5, RED], [4.62, WHITE], [4.74, BLACK]] as [number, typeof RED][]) {
          paint(col, cov(Math.abs(y - yc - zz) - 0.028, aa));
        }
        if (t.n[2] > 0.2) {
          paint(RED, cov(MOTIFS.hand(x / 0.15, (y - 4.12) / 0.15) * 0.15, aa));
                  }
      }
      if (y > 3.05 && y < 3.5) {
        const th = Math.atan2(x, z) * Math.hypot(x, z);
        const zz = Math.abs(fract(th / 0.22 + 0.5) - 0.5) * 0.22;
        paint(fract(th / 0.44) < 0.5 ? RED : BLACK, cov(Math.abs(y - 3.38 - zz) - 0.03, aa));
      }
      // glyphs on the back of the pole
      if (t.n[2] < -0.2 && Math.abs(x) < 0.3) {
        for (const [yy, kind, size] of [[0.95, 'claw', 0.2], [1.5, 'zig', 0.16], [2.6, 'sun', 0.18], [4.0, 'eye', 0.17]] as [number, 'claw' | 'zig' | 'sun' | 'eye', number][]) {
          const d = MOTIFS[kind](-x / size, (y - yy) / size) * size;
          paint(kind === 'sun' ? WHITE : kind === 'eye' ? BLACK : RED, cov(d, aa));
        }
      }
      return c;
    },
  };
}

export const prop: PropDef = {
  id: 'prop_totem',
  size: 1024,
  aoLong: 2.0,
  crease: 46,
  mats: [
    totemWood(),
    endGrain('end-grain'),
    rope('rope', { across: 'u', color: '#8c7048', dark: '#46341d' }),
    bone('bone'),
    skullBone('skull'),
    bone('horn', { horn: true }),
    blackIron('iron', { rust: 0.5 }),
    cloth('streamer', { color: '#8e2218', dark: '#4a1510', soot: 1 }),
    stone('footing', { tex: ['tex_rock_mossy', 'tex_cobble_dark'], dark: '#4a4640', light: '#8f897b', moss: 0.2, dirt: 0.45, wear: 0.45 }),
  ],
  build(m: PropMesh) {
    const map = mapAuto(1);
    const rng = new Rng('totem');
    // pole core
    log(m, LOG, [0, 0, 0], [0, POLE_TOP, 0], 0.27, 0.2, { sides: 8, segs: 7, chamfer1: 0.04, capMat: END, seed: 'pole', jitter: 0.05, bow: [0.03, 0, 0.02], swell: 0.03, caps: 'end' });
    // ---- carved war-face block: jaw, head, brow ridge, wedge nose, cheeks, ears, fangs and tusks
    const oct = (w: number, d: number, z = 0): [number, number][] => [[-w, z - d * 0.45], [-w * 0.72, z - d], [w * 0.72, z - d], [w, z - d * 0.45], [w, z + d * 0.45], [w * 0.72, z + d], [-w * 0.72, z + d], [-w, z + d * 0.45]];
    m.add(extrude(oct(0.31, 0.27, 0.07), 0.45, { axis: 'y', z0: 0.52, taper: 0.82, bevel: { size: 0.035, segments: 1 } }), LOG, map);
    m.add(extrude(oct(0.4, 0.3, 0.07), 0.98, { axis: 'y', z0: 0.97, taper: 1.1, bevel: { size: 0.04, segments: 1 } }), LOG, map);
    m.add(extrude([[-0.52, -0.02], [-0.44, 0.15], [0.44, 0.15], [0.52, -0.02], [0.4, -0.16], [-0.4, -0.16]], 0.15, { axis: 'y', z0: 0 }), LOG, map, moveXf(0, FY + 0.2, 0.34));
    m.add(extrude([[0.0, 0.0], [-0.24, 0.02], [-0.1, 0.22]], 0.17, { axis: 'x', z0: -0.085 }), LOG, map, moveXf(0, FY - 0.06, 0.3));
    for (const sx of [-1, 1]) {
      m.add(extrude([[0, 0], [0.18 * sx, 0.08], [0.0, 0.3]], 0.2, { axis: 'y', z0: 0 }), LOG, map, moveXf(sx * 0.3, FY - 0.3, 0.26));
      spike(m, LOG, [sx * 0.4, FY + 0.18, 0.05], [sx * 1, 0.7, -0.15], 0.3, 0.075, { sides: 4 });
      horn(m, BONE, arcPath([sx * 0.2, FY - 0.62, 0.34], [sx * 0.1, 1, 0.2], [sx * 0.8, 0.1, 1], 0.62, 0.9, 4), 0.055, { sides: 5, seed: `ftusk${sx}` });
    }
    for (let k = -1; k <= 1; k++) spike(m, BONE, [k * 0.09, FY - 0.57, 0.36], [0, -1, 0.15], 0.1, 0.028, { sides: 3 });
    // carved collars between the segments
    for (const y of [2.08, 3.18]) m.add(extrude(oct(0.3, 0.3, 0), 0.14, { axis: 'y', z0: y }), LOG, map);
    // ---- bull skull with long swept horns
    skull(m, { bone: SKULL }, [0, 2.78, 0.4], 0, 0.64, { detail: 1, pitch: -0.12, horns: { mat: HORN, len: 1.6, r: 0.11, curl: 1.9, up: 0.25, segs: 4, sides: 5 } });
    lash(m, ROPE, [0, 2.45, 0.0], [0, 1, 0], 0.26, 0.16, { sides: 7, bulge: 0.035, seed: 'bl1' });
    lash(m, ROPE, [0, 3.02, 0.0], [0, 1, 0], 0.25, 0.16, { sides: 7, bulge: 0.035, seed: 'bl2' });
    // ---- feather wings
    for (const sx of [-1, 1]) {
      const outline: [number, number][] = [[0.15, 0.18], [0.55, 0.22], [1.12, 0.14], [1.04, 0.02], [0.93, 0.08], [0.84, -0.1], [0.72, -0.01], [0.6, -0.2], [0.47, -0.08], [0.15, -0.18]];
      const w = extrude(outline.map(([x, y]) => [x * sx, y] as [number, number]), 0.1, { axis: 'z', z0: -0.05 });
      m.add(w, LOG, map, mul(moveXf(0, WY, 0), rotZ(sx * 0.1)));
      spike(m, IRON, [sx * 1.1, WY + 0.2, 0], [sx * 0.8, 0.6, 0], 0.3, 0.045, { sides: 4 });
    }
    lash(m, ROPE, [0, WY, 0], [0, 1, 0], 0.255, 0.16, { sides: 7, bulge: 0.035, seed: 'wl' });
    // ---- horned crown skull + a ring of iron spikes
    skull(m, { bone: SKULL }, [0, POLE_TOP + 0.16, 0.1], 0, 0.56, { detail: 1, pitch: 0.1, horns: { mat: HORN, len: 1.25, r: 0.1, curl: 1.7, up: 0.9, segs: 4, sides: 5 } });
    for (let k = 0; k < 2; k++) {
      const a = 0.9 + (k / 2) * Math.PI * 2;
      spike(m, IRON, [Math.sin(a) * 0.17, POLE_TOP - 0.05, Math.cos(a) * 0.17], [Math.sin(a) * 0.5, 1, Math.cos(a) * 0.5], 0.28, 0.04, { sides: 4 });
    }
    // ---- hanging trophy skulls and torn streamers
    for (const sx of [-1, 1]) {
      const root: Vec3 = [sx * 0.98, WY - 0.05, 0.0];
      skull(m, { bone: SKULL }, [root[0], WY - 0.42, 0.04], sx * 0.5, 0.2, { detail: 0, pitch: 0.2 });
      log(m, ROPE, root, [root[0], WY - 0.26, 0.02], 0.014, 0.014, { sides: 4, segs: 1, caps: 'none', seed: `skr${sx}` });
      const sroot: Vec3 = [sx * 0.55, WY - 0.2, 0.08];
      sheet(m, {
        nu: 2, nv: 3, thick: 0.01, mat: CLOTH, outward: [0, 0, 1],
        at: (u, v) => {
          const l = 1.0 * (1 - 0.3 * (1 - Math.abs(u * 2 - 1)));
          return [sroot[0] + (u - 0.5) * 0.14 * (1 - 0.4 * v) + sx * 0.04 * v, sroot[1] - l * v, sroot[2] + 0.1 * Math.sin(v * 3.4 + sx) * v];
        },
        uv: (u, v) => [u * 0.14, v],
      });
    }
    // ---- spikes through the lower pole and the stone footing with two trophy skulls
    for (const [y, a] of [[0.45, 1.9]] as [number, number][]) {
      spike(m, IRON, [Math.sin(a) * 0.2, y, Math.cos(a) * 0.2], [Math.sin(a), 0.35, Math.cos(a)], 0.34, 0.045, { sides: 4 });
    }
    for (let k = 0; k < 2; k++) {
      const a = 2.2 + k * 2.6;
      const r = 0.5;
      m.add(stoneChunk(rng, 0.62, 0.3 + rng.next() * 0.16, 0.5, 5, 0.72), STONE, mapBox(1), mul(moveXf(Math.sin(a) * r, 0, Math.cos(a) * r), rotY(rng.next() * 6)));
    }
    skull(m, { bone: SKULL }, [0.34, 0.1, 0.62], 0.5, 0.2, { detail: 0, pitch: 0.4, roll: 0.3 });
    skull(m, { bone: SKULL }, [-0.3, 0.1, 0.55], -0.7, 0.18, { detail: 0, pitch: 0.5, roll: -0.2 });
  },
};

// prop_watchtower — orc lookout tower (9 m): four leaning peeled logs lashed with rope and iron bands, tied by braces, a cantilevered
// plank crow's nest with a hide-screen parapet, a ladder up the +Z face, a hide canopy over a central mast with bone horns at its
// corners, skull trophies and two painted war banners. Footprint radius ~1.9 m at the feet (stone footings).
import { Rng } from '../../core/rng.ts';
import type { Vec3 } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type PropMesh, mapBox, mapPlanar } from '../../archetypes/prop/mesh.ts';
import { stone } from '../../archetypes/prop/mats.ts';
import { slab } from '../../archetypes/prop/kit.ts';
import { arcPath, horn, lash, lerp, lerp3, log, moveXf, mul, rotY, sheet, skull, spike, stoneChunk, tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { blackIron, bone, cloth, darkLining, endGrain, leather, orcHide, rope, skullBone, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';

const LOG = 0, END = 1, ROPE = 2, PLANK = 3, HIDE = 4, IRON = 5, BONE = 6, SKULL = 7, HORN = 8, BANNER_A = 9, BANNER_B = 10, STONE = 11, LEATHER = 12, LINING = 13;

const H_LEG = 7.95;
const BASE = 1.4, TOPR = 0.84;
const DECK_Y = 6.2;
const legR = (y: number): number => lerp(0.19, 0.13, y / H_LEG);
const legAt = (sx: number, sz: number, y: number): Vec3 => {
  const t = y / H_LEG;
  return [sx * lerp(BASE, TOPR, t), y, sz * lerp(BASE, TOPR, t)];
};

// roof: four hide faces over a central mast, corners at (+-RC, YC, +-RC), apex A
const RC = 1.6, YC = 7.42, APEX: Vec3 = [0, 8.7, 0];
const CORNERS: Vec3[] = [[-RC, YC, RC], [RC, YC, RC], [RC, YC, -RC], [-RC, YC, -RC]];
const FACE_DIR: Vec3[] = [[0, 0.4, 1], [1, 0.4, 0], [0, 0.4, -1], [-1, 0.4, 0]];
function roofP(k: number, u: number, v: number): Vec3 {
  const a = CORNERS[k]!, b = CORNERS[(k + 1) % 4]!;
  const h = lerp3(a, b, u);
  const lift = 0.38 * Math.sin(Math.PI * u) ** 0.85;
  const sag = 0.1 * Math.sin(Math.PI * u);
  const dir = FACE_DIR[k]!;
  const hem: Vec3 = [h[0] - dir[0] * sag, h[1] + lift, h[2] - dir[2] * sag];
  const p = lerp3(hem, APEX, v);
  const bulge = 0.07 * Math.sin(Math.PI * v) ** 0.7 * Math.sin(Math.PI * u) ** 0.4;
  return [p[0] + dir[0] * bulge, p[1] + 0.5 * bulge, p[2] + dir[2] * bulge];
}

export const prop: PropDef = {
  id: 'prop_watchtower',
  size: 1536,
  aoLong: 3.4,
  crease: 46,
  mats: [
    timber('log', { dark: '#33261b', mid: '#6a5036', light: '#9a7a55', bark: 0.4, facets: 0.9, knots: 0.7, dirt: 0.55, bands: [[3.3, 3.46, '#a5321c'], [3.5, 3.58, '#e6dcc0'], [5.1, 5.24, '#a5321c']] }),
    endGrain('end-grain'),
    rope('rope', { across: 'u', color: '#8c7048', dark: '#46341d' }),
    timber('plank', { dark: '#34261b', mid: '#66503a', light: '#947552', facets: 0.35, knots: 0.9, bark: 0, dirt: 0.4 }),
    orcHide('hide', {
      frame: (t) => {
        const [x, y, z] = t.p;
        const sector = ((Math.round(Math.atan2(x, z) / (Math.PI / 2)) % 4) + 4) % 4;
        const u = sector % 2 === 0 ? x * (sector === 0 ? 1 : -1) : z * (sector === 1 ? -1 : 1);
        if (y > 7.3) {
          const v = Math.max(0, y - 7.3) * 1.2;
          return [sector, u, v, v];
        }
        return [4 + sector, u, y - 6.3, y - 6.3];
      },
      courseH: 1.2,
      pieceW: 0.95,
      hem: 0.2,
      top: 1.6,
      soot: 0.3,
      patches: 2,
      patchArea: [0.8, 0.3, 1.0],
      motifs: [
        { panel: 0, kind: 'sun', u: 0, v: 0.55, size: 0.5 },
        { panel: 1, kind: 'claw', u: 0, v: 0.55, size: 0.45 },
        { panel: 2, kind: 'eye', u: 0, v: 0.55, size: 0.5, color: '#1b1411' },
        { panel: 3, kind: 'hand', u: 0, v: 0.5, size: 0.4 },
        { panel: 5, kind: 'skull', u: 0, v: 0.45, size: 0.4, color: '#e6dcc0' },
        { panel: 6, kind: 'zig', u: 0, v: 0.45, size: 0.5, color: '#1b1411' },
        { panel: 7, kind: 'chevron', u: 0, v: 0.45, size: 0.35 },
        { panel: 4, kind: 'spiral', u: 0.5, v: 0.4, size: 0.3 },
      ],
    }),
    blackIron('iron', { rust: 0.55 }),
    bone('bone'),
    skullBone('skull'),
    bone('horn', { horn: true }),
    cloth('banner-a', { color: '#8e2218', dark: '#4a1510', soot: 1, scale: 1, sigil: { kind: 'skull', u: 0.4, v: 0.7, size: 0.28, color: '#e6dcc0' }, borders: [[0.0, 0.07, '#14100e'], [2.0, 2.06, '#14100e']] }),
    cloth('banner-b', { color: '#7a1c14', dark: '#3d100c', soot: 1, scale: 1, sigil: { kind: 'sun', u: 0.4, v: 0.7, size: 0.28, color: '#d6a43a' }, borders: [[0.0, 0.07, '#14100e'], [2.0, 2.06, '#14100e']] }),
    stone('footing', { tex: ['tex_rock_mossy', 'tex_cobble_dark'], dark: '#4a4640', light: '#8f897b', moss: 0.2, dirt: 0.45, wear: 0.45 }),
    leather('leather'),
    darkLining('lining'),
  ],
  build(m: PropMesh) {
    buildLegs(m);
    buildBraces(m);
    buildDeck(m);
    buildLadder(m);
    buildParapet(m);
    buildRoof(m);
    buildTrophies(m);
    buildFootings(m);
  },
};

function buildLegs(m: PropMesh): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const base = legAt(sx, sz, 0), top = legAt(sx, sz, H_LEG);
      log(m, LOG, base, top, 0.19, 0.13, { sides: 6, segs: 4, caps: 'end', capMat: END, seed: `leg${sx}${sz}`, jitter: 0.08, bow: [sx * 0.04, 0, sz * 0.04], swell: 0.03 });
      const dir: Vec3 = [top[0] - base[0], top[1] - base[1], top[2] - base[2]];
      // iron band near the foot, rope lashing at the deck and under the roof
      lash(m, IRON, legAt(sx, sz, 1.0), dir, legR(1.0), 0.16, { sides: 6, bulge: 0.03, seed: `band${sx}${sz}` });
      lash(m, ROPE, legAt(sx, sz, 7.75), dir, legR(7.75), 0.2, { sides: 6, bulge: 0.03, seed: `rl${sx}${sz}` });
    }
  }
}

function buildBraces(m: PropMesh): void {
  const faces: [number, number, number, number][] = [[1, 1, -1, 1], [-1, 1, -1, -1], [-1, -1, 1, -1], [1, -1, 1, 1]];
  const levels = [2.45, 4.75];
  // horizontal ties lashed on the outside of the legs
  for (const y of levels) {
    for (const [ax, az, bx, bz] of faces) {
      const out: Vec3 = [(ax + bx) / 2 === 0 ? 0 : Math.sign(ax + bx), 0, (az + bz) / 2 === 0 ? 0 : Math.sign(az + bz)];
      const o = 0.2;
      const a = legAt(ax, az, y), b = legAt(bx, bz, y);
      const pa: Vec3 = [a[0] + out[0] * o, y, a[2] + out[2] * o], pb: Vec3 = [b[0] + out[0] * o, y, b[2] + out[2] * o];
      log(m, LOG, pa, pb, 0.085, 0.085, { sides: 5, segs: 1, capMat: END, seed: `tie${ax}${az}${y}`, bow: [0, 0.03, 0] });
    }
  }
  for (const y of levels) for (const sx of [-1, 1]) for (const sz of [-1, 1]) lash(m, ROPE, legAt(sx, sz, y), [0, 1, 0], legR(y) * 1.02, 0.2, { sides: 6, bulge: 0.03, seed: `tl${sx}${sz}${y}` });
  // diagonal braces, alternating directions per face
  const bays: [number, number][] = [[0.35, 2.45], [2.45, 4.75]];
  faces.forEach(([ax, az, bx, bz], fi) => {
    const out: Vec3 = [Math.sign(ax + bx), 0, Math.sign(az + bz)];
    bays.forEach(([y0, y1], bi) => {
      const flip = (fi + bi) % 2 === 0;
      const A = legAt(flip ? ax : bx, flip ? az : bz, y0), B = legAt(flip ? bx : ax, flip ? bz : az, y1);
      const o = 0.25;
      const pa: Vec3 = [A[0] + out[0] * o, y0, A[2] + out[2] * o], pb: Vec3 = [B[0] + out[0] * o, y1, B[2] + out[2] * o];
      log(m, LOG, pa, pb, 0.07, 0.07, { sides: 5, segs: 1, capMat: END, seed: `dg${fi}${bi}` });
    });
  });
}

function buildDeck(m: PropMesh): void {
  // perimeter beams + corbels under the deck
  const EB = 1.28;
  for (const s of [-1, 1]) {
    log(m, LOG, [-EB - 0.15, DECK_Y - 0.14, s * EB], [EB + 0.15, DECK_Y - 0.14, s * EB], 0.1, 0.1, { sides: 6, segs: 1, capMat: END, seed: `ebx${s}` });
    log(m, LOG, [s * EB, DECK_Y - 0.14, -EB - 0.15], [s * EB, DECK_Y - 0.14, EB + 0.15], 0.1, 0.1, { sides: 6, segs: 1, capMat: END, seed: `ebz${s}` });
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const l = legAt(sx, sz, DECK_Y - 0.8);
      log(m, LOG, l, [sx * (EB - 0.05), DECK_Y - 0.14, sz * (EB - 0.05)], 0.065, 0.065, { sides: 5, segs: 1, capMat: END, seed: `cb${sx}${sz}` });
    }
  }
  // planks (uneven lengths, tiny gaps)
  const rng = new Rng('deck');
  const n = 9, w = 0.3;
  for (let i = 0; i < n; i++) {
    const z = (i - (n - 1) / 2) * (w + 0.012);
    const len = 2.74 + (rng.next() - 0.5) * 0.14;
    slab(m, PLANK, mapPlanar([-len / 2, 0, z - w / 2], [1, 0, 0], [0, 0, 1], 1), [len, 0.09, w], [0, DECK_Y + 0.045 + (rng.next() - 0.5) * 0.012, z]);
  }
}

function buildLadder(m: PropMesh): void {
  const zAt = (y: number): number => lerp(BASE, TOPR, y / H_LEG) + 0.46;
  for (const sx of [-1, 1]) {
    log(m, LOG, [sx * 0.34, 0, zAt(0)], [sx * 0.34, 6.5, zAt(6.5)], 0.05, 0.05, { sides: 5, segs: 1, capMat: END, seed: `lad${sx}` });
  }
  for (let i = 0; i < 10; i++) {
    const y = 0.45 + i * 0.58;
    slab(m, LOG, mapPlanar([0, y, 0], [1, 0, 0], [0, 1, 0], 1), [0.7, 0.05, 0.06], [0, y, zAt(y)]);
  }
}

function buildParapet(m: PropMesh): void {
  const PE = 1.28;
  // corner posts with sharpened tips
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      log(m, LOG, [sx * PE, DECK_Y, sz * PE], [sx * PE, 7.28, sz * PE], 0.075, 0.07, { sides: 6, segs: 1, point: 0.25, caps: 'none', seed: `post${sx}${sz}` });
    }
  }
  // top rails: back, left, right and two stubs flanking the ladder hatch
  const ry = 7.0;
  const rail = (a: Vec3, b: Vec3, s: string): void => log(m, LOG, a, b, 0.06, 0.06, { sides: 5, segs: 1, capMat: END, seed: s });
  rail([-PE, ry, -PE], [PE, ry, -PE], 'rb');
  rail([-PE, ry, -PE], [-PE, ry, PE], 'rl');
  rail([PE, ry, -PE], [PE, ry, PE], 'rr');
  rail([-PE, ry, PE], [-0.45, ry, PE], 'rfl');
  rail([0.45, ry, PE], [PE, ry, PE], 'rfr');
  // hide screens hanging from the rails (painted on the outer face)
  const screen = (a: Vec3, b: Vec3, dir: Vec3): void => {
    sheet(m, {
      nu: 4, nv: 2, mat: HIDE, outward: dir,
      at: (u, v) => {
        const p = lerp3(a, b, u);
        const hang = 0.78 - 0.16 * Math.sin(Math.PI * u) ** 0.8;
        const out = 0.05 * Math.sin(Math.PI * u) * v;
        return [p[0] + dir[0] * out, ry - 0.04 - hang * v, p[2] + dir[2] * out];
      },
    });
  };
  screen([-PE, ry, -PE - 0.07], [PE, ry, -PE - 0.07], [0, 0, -1]);
  screen([-PE - 0.07, ry, PE], [-PE - 0.07, ry, -PE], [-1, 0, 0]);
  screen([PE + 0.07, ry, -PE], [PE + 0.07, ry, PE], [1, 0, 0]);
  screen([-PE, ry, PE + 0.07], [-0.45, ry, PE + 0.07], [0, 0, 1]);
  screen([0.45, ry, PE + 0.07], [PE, ry, PE + 0.07], [0, 0, 1]);
  // lintel over the ladder hatch
  rail([-0.55, 7.14, PE + 0.02], [0.55, 7.14, PE + 0.02], 'lintel');
}

function buildRoof(m: PropMesh): void {
  // central mast
  log(m, LOG, [0, DECK_Y, 0], [0, 8.7, 0], 0.1, 0.07, { sides: 6, segs: 3, chamfer0: 0, chamfer1: 0.02, caps: 'end', capMat: END, seed: 'mast', bow: [0.02, 0, 0] });
  spike(m, IRON, [0, 8.68, 0], [0, 1, 0], 0.305, 0.07, { sides: 5 });
  lash(m, ROPE, [0, 8.5, 0], [0, 1, 0], 0.075, 0.16, { sides: 6, bulge: 0.025, seed: 'mastl' });
  for (let k = 0; k < 4; k++) {
    sheet(m, { nu: 4, nv: 2, at: (u, v) => roofP(k, u, v), mat: HIDE, outward: FACE_DIR[k]!, thick: 0.03, backMat: LINING, edge: true, edgeMat: LEATHER });
  }
  // hip ribs from the mast head over the hide to the corners, ending in curved bone horns
  for (let k = 0; k < 4; k++) {
    const c = CORNERS[k]!;
    const end: Vec3 = [c[0] * 1.04, c[1] - 0.02, c[2] * 1.04];
    log(m, LOG, [APEX[0], APEX[1] - 0.08, APEX[2]], end, 0.07, 0.06, { sides: 5, segs: 2, capMat: END, caps: 'end', seed: `rib${k}`, bow: [0, 0.03, 0] });
    const dir: Vec3 = [Math.sign(c[0]), 0.7, Math.sign(c[2])];
    horn(m, BONE, arcPath([end[0], end[1] - 0.02, end[2]], dir, [-Math.sign(c[0]) * 0.2, 1, -Math.sign(c[2]) * 0.2], 0.62, 1.15, 3), 0.075, { sides: 5, seed: `ch${k}` });
  }
  // pennant streaming from the mast head
  const root: Vec3 = [0.06, 8.6, 0];
  sheet(m, {
    nu: 2, nv: 5, thick: 0.01, mat: BANNER_A, outward: [0, 0, 1],
    at: (u, v) => {
      const w = 0.16 * (1 - 0.5 * v) * (u - 0.5);
      const l = 1.15 * (1 - 0.3 * (1 - Math.abs(u * 2 - 1)));
      return [root[0] + l * v, root[1] + w - 0.18 * v, root[2] + 0.13 * Math.sin(v * 4) * v];
    },
    uv: (u, v) => [u * 0.14, v * 1.1],
  });
}

function buildTrophies(m: PropMesh): void {
  // hero skull over the hatch
  skull(m, { bone: SKULL }, [0, 7.4, 1.52], 0, 0.42, { detail: 2, pitch: 0.15, horns: { mat: HORN, len: 1.1, r: 0.12, curl: 1.6, segs: 4, sides: 5 } });
  // corner trophy skulls under the canopy corners, hung on rope
  [[-1, 1], [1, 1]].forEach(([sx, sz], i) => {
    const at: Vec3 = [sx! * 1.45, 7.0, sz! * 1.45];
    tube(m, { path: [[at[0], 7.36, at[2]], [at[0], 7.2, at[2]]], radii: [0.015, 0.015], sides: 4, mat: ROPE, s: 0.35, caps: 'none' });
    skull(m, { bone: SKULL }, at, Math.atan2(sx!, sz!), 0.26, { detail: 0, pitch: 0.2 + 0.05 * i });
  });
  // two war banners hung from crossbars at the front corners
  [-1, 1].forEach((sx, i) => {
    const bx = sx * 1.08;
    const zf = lerp(BASE, TOPR, 7.0 / H_LEG) + 0.55;
    log(m, LOG, [bx - 0.5, 7.0, zf], [bx + 0.5, 7.0, zf], 0.04, 0.04, { sides: 5, segs: 1, chamfer0: 0.015, chamfer1: 0.015, capMat: END, seed: `bar${sx}` });
    const len = 2.2;
    sheet(m, {
      nu: 2, nv: 5, thick: 0.012, mat: i === 0 ? BANNER_A : BANNER_B, outward: [0, 0, 1],
      at: (u, v) => {
        const l = len * (1 - 0.18 * (1 - Math.abs(u * 2 - 1)));
        const flutter = 0.09 * Math.sin(v * 5 + i * 2) * v;
        return [bx + (u - 0.5) * 0.8, 6.96 - l * v, zf + 0.03 + flutter];
      },
      uv: (u, v) => [u * 0.8, v * len],
    });
  });
}

function buildFootings(m: PropMesh): void {
  const rng = new Rng('footing');
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const c = legAt(sx, sz, 0);
      for (let k = 0; k < 1; k++) {
        const a = Math.atan2(sx, sz) + (k === 0 ? -0.5 : 0.55) + (rng.next() - 0.5) * 0.3;
        const r = 0.36 + k * 0.1;
        const xf = mul(moveXf(c[0] + Math.sin(a) * r, 0, c[2] + Math.cos(a) * r), rotY(rng.next() * 6));
        const h = stoneChunk(rng, 0.62 + k * 0.1, 0.34 + rng.next() * 0.16, 0.52 + k * 0.06, 5, 0.74);
        m.add(h, STONE, mapBox(1), xf);
      }
    }
  }
}

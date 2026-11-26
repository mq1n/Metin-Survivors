// DEV-only: hero placeholders — humanoid body (skin + clothes), hair mesh and armour mesh sharing one skeleton, with a
// fine-resolution face overlay merged into the body. Class colour schemes: warrior / ninja / yacha / shaman / wolfman.
import type { PlaceholderModel } from '../../engine/assets';
import { faceOverlay, type FaceStyle } from './face';
import { HUMAN_BASE, SIDES, bodyPrims, layoutHuman, outfitPrims, type HumanSpec, type Layout, type Outfit } from './humanoid';
import { humanClips, type AttackKind, type HumanAnimStyle } from './humanAnim';
import type { HeroClass } from './infer';
import { buildMesh, mergeGeometry } from './mesher';
import { Rng, type Vec3 } from './math';
import { assembleModel } from './model';
import { Shape, rgb, toHex } from './sdf';

type HairStyle = 'topknot' | 'short' | 'ponytail' | 'long' | 'spiky' | 'scruff';

interface Scheme {
  skin: [string, string][];
  hair: string;
  hairM: HairStyle;
  hairF: HairStyle;
  cloth: string;
  cloth2: string;
  trim: string;
  pants: string;
  boots: string;
  plate: string;
  plate2: string;
  eye: string;
  brow: string;
  attack: AttackKind;
  mass: number;
  glow?: boolean;
}

const SCHEMES: Record<HeroClass, Scheme> = {
  warrior: {
    skin: [['#d3a07c', '#b9835f'], ['#c28b66', '#a56f4d']],
    hair: '#1c1512',
    hairM: 'topknot',
    hairF: 'ponytail',
    cloth: '#9a2f26',
    cloth2: '#6e1f1a',
    trim: '#d7b24c',
    pants: '#2e2a29',
    boots: '#3b2a1f',
    plate: '#9aa6b2',
    plate2: '#6e7884',
    eye: '#4a3020',
    brow: '#1c1512',
    attack: 'smash',
    mass: 1.1,
  },
  ninja: {
    skin: [['#d9aa86', '#bd8c68']],
    hair: '#14141b',
    hairM: 'ponytail',
    hairF: 'ponytail',
    cloth: '#35524a',
    cloth2: '#26403a',
    trim: '#b23a2e',
    pants: '#222a2c',
    boots: '#15181a',
    plate: '#4a4640',
    plate2: '#2e2b28',
    eye: '#3a4f46',
    brow: '#14141b',
    attack: 'stab',
    mass: 0.85,
  },
  yacha: {
    skin: [['#d0a58a', '#b48a70']],
    hair: '#dcdce6',
    hairM: 'spiky',
    hairF: 'long',
    cloth: '#2a2a38',
    cloth2: '#383848',
    trim: '#b0222c',
    pants: '#16161c',
    boots: '#101015',
    plate: '#34343f',
    plate2: '#1c1c24',
    eye: '#c4262e',
    brow: '#8a8a98',
    attack: 'smash',
    mass: 1,
    glow: true,
  },
  shaman: {
    skin: [['#e0b896', '#c49c7c']],
    hair: '#6e4426',
    hairM: 'topknot',
    hairF: 'long',
    cloth: '#ebf0ee',
    cloth2: '#c8dbd6',
    trim: '#38a095',
    pants: '#d7dfdc',
    boots: '#8a6a3a',
    plate: '#d9b24a',
    plate2: '#a87a26',
    eye: '#3d6e5c',
    brow: '#4a2e18',
    attack: 'cast',
    mass: 0.95,
  },
  wolfman: {
    skin: [['#c9966f', '#ad7a56']],
    hair: '#6a5646',
    hairM: 'scruff',
    hairF: 'scruff',
    cloth: '#6b4a2e',
    cloth2: '#4a3220',
    trim: '#d19a3a',
    pants: '#4a3a2c',
    boots: '#32261c',
    plate: '#8a7a66',
    plate2: '#5e5244',
    eye: '#d19a3a',
    brow: '#4a3a2e',
    attack: 'stab',
    mass: 1,
  },
};

export interface HeroOptions {
  cls: HeroClass;
  female: boolean;
  tier: number;
  seed: number;
}

function addHairBones(lay: Layout, style: HairStyle, female: boolean): number {
  const { rig, L } = lay;
  const u = L.u;
  const [, ry, rz] = L.headR;
  if (style === 'ponytail') {
    rig.add('hair1', 'head', [0, L.head[1] + ry * 0.15, L.head[2] - rz * 0.95]);
    rig.add('hair2', 'hair1', [0, L.head[1] - ry * 0.7, L.head[2] - rz * 1.55]);
    rig.add('hair3', 'hair2', [0, L.head[1] - ry * 1.7, L.head[2] - rz * 1.75]);
    return 3;
  }
  if (style === 'long') {
    rig.add('hair1', 'head', [0, L.neckT[1] - 0.01 * u, L.head[2] - rz * 0.9]);
    rig.add('hair2', 'hair1', [0, L.chest[1] + 0.14 * u, -L.r.chestD * 1.35]);
    rig.add('hair3', 'hair2', [0, L.chest[1] - (female ? 0.08 : 0.02) * u, -L.r.chestD * 1.4]);
    return 3;
  }
  return 0;
}

function hairShape(lay: Layout, style: HairStyle, hairN: number, color: string, tint2: string, female: boolean, cell: number): Shape {
  const { rig, L } = lay;
  const u = L.u;
  const shape = new Shape();
  shape.minRadius = cell * 0.6;
  const head = rig.i('head');
  const [rx, ry, rz] = L.headR;
  const [hx, hy, hz] = L.head;
  // skull cap, open at the face
  shape.ell(head, [hx, hy + ry * 0.12, hz - rz * 0.06], [rx * 1.07, ry * 1.04, rz * 1.08], { k: 0.03, color });
  shape.ell(head, [hx, hy + ry * 0.62, hz + rz * 0.62], [rx * 1.0, ry * 0.3, rz * 0.55], { k: 0.03, color: tint2 });
  // side locks
  for (const s of [1, -1]) shape.rc(head, [hx + s * rx * 0.98, hy + ry * 0.35, hz + rz * 0.2], [hx + s * rx * 1.02, hy - ry * 0.45, hz + rz * 0.05], ry * 0.2, ry * 0.12, { k: 0.03, color });
  const chain = (names: string[], pts: Vec3[], r0: number, r1: number, col: string): void => {
    for (let i = 0; i < names.length; i++) {
      const a = pts[i] as Vec3;
      const b = pts[i + 1] as Vec3;
      const t0 = i / names.length;
      const t1 = (i + 1) / names.length;
      shape.rc(rig.i(names[i] as string), a, b, r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, { k: 0.04, color: col, sigma: 0.05 });
    }
  };
  switch (style) {
    case 'topknot':
      shape.sph(head, [hx, hy + ry * 1.18, hz - rz * 0.25], rx * 0.42, { k: 0.04, color });
      shape.rc(head, [hx, hy + ry * 0.9, hz - rz * 0.2], [hx, hy + ry * 1.05, hz - rz * 0.25], rx * 0.16, rx * 0.2, { k: 0.02, color: '#d7b24c', cw: 5 });
      shape.ell(head, [hx, hy - ry * 0.1, hz - rz * 0.95], [rx * 0.8, ry * 0.8, rz * 0.3], { k: 0.04, color });
      break;
    case 'short':
    case 'scruff':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        shape.rc(head, [hx + Math.cos(a) * rx * 0.6, hy + ry * 0.7, hz + Math.sin(a) * rz * 0.55 - rz * 0.1], [hx + Math.cos(a) * rx * 1.05, hy + ry * 1.12 + (i % 2) * ry * 0.15, hz + Math.sin(a) * rz * 0.95 - rz * 0.2], ry * 0.2, ry * 0.05, { k: 0.03, color: i % 2 ? tint2 : color });
      }
      shape.ell(head, [hx, hy - ry * 0.05, hz - rz * 0.9], [rx * 0.95, ry * 0.85, rz * 0.4], { k: 0.04, color });
      break;
    case 'spiky':
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        const lift = 1.2 + 0.35 * Math.sin(i * 2.3);
        shape.rc(head, [hx + Math.cos(a) * rx * 0.55, hy + ry * 0.75, hz + Math.sin(a) * rz * 0.5 - rz * 0.1], [hx + Math.cos(a) * rx * 1.55, hy + ry * (0.9 + lift * 0.6), hz + Math.sin(a) * rz * 1.3 - rz * 0.4], ry * 0.22, ry * 0.03, { k: 0.03, color: i % 3 ? color : tint2 });
      }
      shape.ell(head, [hx, hy - ry * 0.05, hz - rz * 0.9], [rx * 0.9, ry * 0.9, rz * 0.4], { k: 0.04, color });
      break;
    case 'ponytail': {
      shape.sph(head, [hx, hy + ry * 0.2, hz - rz * 0.95], rx * 0.3, { k: 0.03, color });
      const names = ['hair1', 'hair2', 'hair3'].slice(0, hairN);
      chain(
        names,
        [rig.pos('hair1'), rig.pos('hair2'), rig.pos('hair3'), [hx, hy - ry * 2.4, hz - rz * 1.85]],
        rx * 0.26,
        rx * 0.05,
        color,
      );
      shape.rc(head, [hx, hy + ry * 0.2, hz - rz * 1.0], [hx, hy + ry * 0.05, hz - rz * 1.15], rx * 0.17, rx * 0.2, { k: 0.01, color: '#b23a2e', cw: 6 });
      break;
    }
    case 'long': {
      shape.ell(head, [hx, hy - ry * 0.05, hz - rz * 0.85], [rx * 1.0, ry * 0.95, rz * 0.5], { k: 0.04, color });
      const names = ['hair1', 'hair2', 'hair3'].slice(0, hairN);
      const w = female ? 0.095 * u : 0.075 * u;
      chain(
        names,
        [rig.pos('hair1'), rig.pos('hair2'), rig.pos('hair3'), [hx, L.chest[1] - (female ? 0.22 : 0.12) * u, -L.r.chestD * 1.3]],
        w,
        w * 0.55,
        color,
      );
      // front locks over the shoulders
      for (const s of [1, -1]) {
        shape.rc(rig.i('hair1'), [hx + s * rx * 0.95, hy - ry * 0.3, hz - rz * 0.1], [hx + s * rx * 1.45, L.shoulderY - 0.02 * u, L.head[2] + 0.01 * u], 0.035 * u, 0.028 * u, { k: 0.03, color, sigma: 0.05 });
        shape.rc(rig.i('hair1'), [hx + s * rx * 1.45, L.shoulderY - 0.02 * u, L.head[2] + 0.01 * u], [hx + s * rx * 1.35, L.chest[1] - 0.02 * u, L.head[2] + 0.04 * u], 0.028 * u, 0.012 * u, { k: 0.03, color, sigma: 0.05 });
      }
      break;
    }
  }
  // face opening (forehead stays, eyes/cheeks exposed)
  shape.ell(head, [hx, hy - ry * 0.25, hz + rz * 0.98], [rx * 0.8, ry * 0.72, rz * 0.5], { op: 'sub', k: 0.02 });
  return shape;
}

function armorShape(lay: Layout, cls: HeroClass, tier: number, sch: Scheme, cell: number): Shape {
  const { rig, L } = lay;
  const u = L.u;
  const r = L.r;
  const shape = new Shape();
  shape.minRadius = cell * 0.6;
  const I = (n: string): number => rig.i(n);
  const P = L.P;
  const plate = sch.plate;
  const plate2 = sch.plate2;
  const trim = sch.trim;
  const g = 0.012 * u;
  const bt = Math.sqrt(L.spec.limb);

  const lerp3 = (a: Vec3, c: Vec3, t: number): Vec3 => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
  const bracers = (len: number, col: string, trimCol?: string): void => {
    for (const { n, s } of SIDES) {
      const i = s > 0 ? 0 : 1;
      shape.rc(I(`farm_${n}`), lerp3(L.wr[i], L.el[i], len), lerp3(L.wr[i], L.el[i], 0.05), r.arm * 0.72 + g * 1.4, r.arm * 0.78 + g * 1.5, { k: 0.01, color: col, cw: 2 });
      if (trimCol) shape.rc(I(`farm_${n}`), lerp3(L.wr[i], L.el[i], 0.06), lerp3(L.wr[i], L.el[i], 0.1), 0.09 * u, 0.09 * u, { op: 'paint', color: trimCol, soft: 0.004 });
    }
  };
  const greaves = (col: string): void => {
    for (const { n, s } of SIDES) {
      const i = s > 0 ? 0 : 1;
      shape.rc(I(`shin_${n}`), lerp3(L.knee[i], L.ankle[i], 0.9), lerp3(L.knee[i], L.ankle[i], 0.28), r.leg * 0.62 + g * 1.8, r.leg * 0.5 + g * 1.8, { k: 0.01, color: col, cw: 2 });
      shape.sph(I(`shin_${n}`), [L.knee[i][0], L.knee[i][1], L.knee[i][2] + r.leg * 0.45], r.leg * 0.5, { k: 0.015, color: trim, cw: 3 });
    }
  };

  switch (cls) {
    case 'warrior': {
      // breastplate + pauldrons
      shape.ell(I('chest'), P(0, L.chest[1] + 0.01 * u, 0.012 * u), [r.chestW * 0.97 + g, r.chestH * 0.9, r.chestD + g * 1.5], { k: 0.01, color: plate });
      shape.ell(I('chest'), P(0, L.chest[1] + 0.02 * u, r.chestD * 0.95), [0.03 * u, r.chestH * 0.8, 0.02 * u], { k: 0.01, color: trim, cw: 4 });
      shape.ell(I('spine'), P(0, L.hipY + 0.1 * u, 0.0), [r.waistW * 1.12 + g, 0.045 * u, r.waistD * 1.15 + g], { k: 0.01, color: plate2 });
      for (const { n, s } of SIDES) {
        const i = s > 0 ? 0 : 1;
        const c: Vec3 = [L.sh[i][0] + s * 0.03 * u, L.sh[i][1] + 0.03 * u, L.sh[i][2]];
        shape.ell(I(`clav_${n}`), c, [0.115 * u * bt, 0.075 * u, 0.115 * u * bt], { k: 0.01, color: plate, rot: [0, 0, s * -0.4] });
        shape.torus(I(`clav_${n}`), [c[0] + s * 0.012 * u, c[1] - 0.012 * u, c[2]], 0.112 * u * bt, 0.011 * u, { k: 0.005, color: trim, rot: [0, 0, s * -0.4], cw: 3 });
        shape.sph(I(`clav_${n}`), [c[0] - s * 0.01 * u, c[1] + 0.06 * u, c[2]], 0.026 * u, { k: 0.01, color: trim, cw: 3 });
      }
      bracers(0.62, plate, trim);
      if (tier >= 2) greaves(plate2);
      if (tier >= 3) {
        shape.rc(I('head'), [L.head[0], L.head[1] + L.headR[1] * 0.9, L.head[2] - L.headR[2] * 0.3], [L.head[0], L.head[1] + L.headR[1] * 1.8, L.head[2] - L.headR[2] * 1.1], L.headR[0] * 0.15, L.headR[0] * 0.1, { k: 0.02, color: '#b02a22', cw: 3 });
        shape.torus(I('head'), [L.head[0], L.head[1] + L.headR[1] * 0.55, L.head[2] - L.headR[2] * 0.05], L.headR[0] * 1.09, L.headR[1] * 0.07, { k: 0.005, color: trim, cw: 3, rot: [0.15, 0, 0] });
      }
      break;
    }
    case 'ninja': {
      bracers(0.7, plate2, sch.trim);
      for (const { n, s } of SIDES) {
        const i = s > 0 ? 0 : 1;
        shape.ell(I(`clav_${n}`), [L.sh[i][0] + s * 0.02 * u, L.sh[i][1] + 0.035 * u, L.sh[i][2]], [0.085 * u * bt, 0.04 * u, 0.09 * u * bt], { k: 0.01, color: plate, rot: [0, 0, s * -0.35] });
      }
      shape.rc(I('chest'), P(-r.chestW * 0.9, L.chest[1] + r.chestH * 0.8, r.chestD * 0.5), P(r.chestW * 0.9, L.chest[1] - r.chestH * 0.9, r.chestD * 0.5), 0.02 * u, 0.02 * u, { op: 'paint', color: sch.trim, soft: 0.008 });
      // headband plate
      shape.box(I('head'), [L.head[0], L.head[1] + L.headR[1] * 0.42, L.head[2] + L.headR[2] * 0.94], [0.052 * u, 0.026 * u, 0.012 * u], 0.006 * u, { k: 0.005, color: '#b8bcc4', cw: 3 });
      shape.torus(I('head'), [L.head[0], L.head[1] + L.headR[1] * 0.42, L.head[2] - L.headR[2] * 0.02], L.headR[0] * 1.09, L.headR[1] * 0.1, { k: 0.005, color: sch.trim, cw: 2, rot: [0.05, 0, 0] });
      if (tier >= 2) greaves(plate2);
      break;
    }
    case 'yacha': {
      for (const { n, s } of SIDES) {
        const i = s > 0 ? 0 : 1;
        const c: Vec3 = [L.sh[i][0] + s * 0.035 * u, L.sh[i][1] + 0.035 * u, L.sh[i][2]];
        shape.ell(I(`clav_${n}`), c, [0.11 * u * bt, 0.06 * u, 0.1 * u * bt], { k: 0.01, color: plate, rot: [0, 0, s * -0.45] });
        for (let k = 0; k < 3; k++) {
          shape.rc(I(`clav_${n}`), [c[0] + s * (0.02 + k * 0.03) * u, c[1] + 0.03 * u, c[2] + (k - 1) * 0.03 * u], [c[0] + s * (0.05 + k * 0.045) * u, c[1] + (0.11 + (k === 1 ? 0.04 : 0)) * u, c[2] + (k - 1) * 0.05 * u], 0.022 * u, 0.004 * u, { k: 0.01, color: plate2, cw: 3 });
        }
        shape.torus(I(`clav_${n}`), [c[0] + s * 0.012 * u, c[1] - 0.012 * u, c[2]], 0.106 * u * bt, 0.009 * u, { k: 0.005, color: sch.trim, rot: [0, 0, s * -0.45], cw: 3 });
      }
      shape.torus(I('neck'), [L.neckB[0], L.neckB[1] + 0.012 * u, L.neckB[2]], 0.075 * u, 0.02 * u, { k: 0.01, color: plate2, cw: 2 });
      shape.ell(I('spine'), P(0, L.hipY + 0.1 * u, 0), [r.waistW * 1.15 + g, 0.04 * u, r.waistD * 1.2 + g], { k: 0.01, color: plate2 });
      shape.sph(I('spine'), P(0, L.hipY + 0.1 * u, r.waistD * 1.15), 0.035 * u, { k: 0.01, color: sch.trim, cw: 3 });
      bracers(0.6, plate, sch.trim);
      if (tier >= 2) greaves(plate2);
      break;
    }
    case 'shaman': {
      shape.torus(I('neck'), [L.neckB[0], L.neckB[1] + 0.008 * u, L.neckB[2]], 0.082 * u, 0.017 * u, { k: 0.01, color: plate, cw: 3 });
      for (const { n, s } of SIDES) {
        const i = s > 0 ? 0 : 1;
        shape.sph(I(`clav_${n}`), [L.sh[i][0] + s * 0.02 * u, L.sh[i][1] + 0.05 * u, L.sh[i][2]], 0.03 * u, { k: 0.01, color: sch.trim, cw: 3 });
        shape.torus(I(`clav_${n}`), [L.sh[i][0] + s * 0.02 * u, L.sh[i][1] + 0.05 * u, L.sh[i][2]], 0.045 * u, 0.007 * u, { k: 0.005, color: plate, cw: 3, rot: [Math.PI / 2, 0, 0] });
      }
      shape.rc(I('chest'), P(-r.chestW * 0.9, L.chest[1] + r.chestH * 0.85, r.chestD * 0.6), P(r.chestW * 0.9, L.chest[1] - r.chestH * 0.9, r.chestD * 0.6), 0.024 * u, 0.024 * u, { op: 'paint', color: sch.trim, soft: 0.01 });
      if (tier >= 2) bracers(0.4, plate, plate2);
      if (tier >= 3) {
        shape.torus(I('head'), [L.head[0], L.head[1] + L.headR[1] * 0.62, L.head[2] - L.headR[2] * 0.05], L.headR[0] * 1.1, L.headR[1] * 0.07, { k: 0.005, color: plate, cw: 3, rot: [0.2, 0, 0] });
        shape.sph(I('head'), [L.head[0], L.head[1] + L.headR[1] * 0.6, L.head[2] + L.headR[2] * 1.0], 0.016 * u, { k: 0.01, color: sch.trim, cw: 4 });
      }
      break;
    }
    case 'wolfman': {
      // fur mantle, leather straps, bracers
      for (const { n, s } of SIDES) {
        const i = s > 0 ? 0 : 1;
        shape.ell(I(`clav_${n}`), [L.sh[i][0] + s * 0.02 * u, L.sh[i][1] + 0.025 * u, L.sh[i][2]], [0.105 * u * bt, 0.07 * u, 0.115 * u * bt], { k: 0.04, color: plate, rot: [0, 0, s * -0.3] });
      }
      shape.rc(I('neck'), L.neckB, [L.neckB[0], L.neckB[1] + 0.04 * u, L.neckB[2]], 0.075 * u, 0.07 * u, { k: 0.04, color: plate, cw: 2 });
      shape.rc(I('chest'), P(-r.chestW * 0.9, L.chest[1] + r.chestH * 0.85, r.chestD * 0.6), P(r.chestW * 0.9, L.chest[1] - r.chestH * 0.9, r.chestD * 0.6), 0.022 * u, 0.022 * u, { op: 'paint', color: '#2e2016', soft: 0.008 });
      bracers(0.55, '#3b2a1c', sch.trim);
      if (tier >= 2) greaves('#3b2a1c');
      break;
    }
  }
  return shape;
}

function mulColor(c: readonly [number, number, number], k: number): [number, number, number] {
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}

export function makeHero(id: string, o: HeroOptions): PlaceholderModel {
  const rng = new Rng(o.seed ^ 0x9e11);
  const sch = SCHEMES[o.cls];
  const female = o.female;
  const skinPair = sch.skin[rng.int(sch.skin.length)] as [string, string];
  const spec: HumanSpec = {
    ...HUMAN_BASE,
    H: female ? 1.7 : 1.8,
    shoulder: female ? 0.178 : 0.2,
    hip: female ? 0.098 : 0.092,
    head: female ? 1.16 : 1.1,
    neck: female ? 1.05 : 1,
    torsoW: female ? 0.9 : 1,
    torsoD: female ? 0.92 : 1,
    limb: female ? 0.88 : 1,
    legT: female ? 0.9 : 1,
    hand: female ? 0.9 : 1,
    leg: female ? 1.02 : 1,
    fem: female ? 1 : 0,
    skin: skinPair[0],
    skin2: skinPair[1],
  };
  if (o.cls === 'warrior') {
    spec.torsoW *= 1.12;
    spec.limb *= 1.1;
    spec.legT *= 1.05;
  } else if (o.cls === 'ninja') {
    spec.torsoW *= 0.92;
    spec.limb *= 0.92;
  } else if (o.cls === 'wolfman') {
    spec.torsoW *= 1.08;
    spec.hunch = 0.015;
    spec.limb *= 1.08;
  }
  const lay = layoutHuman(spec);
  const { rig, L } = lay;
  const u = L.u;
  const hairStyle = female ? sch.hairF : sch.hairM;
  const hairN = addHairBones(lay, hairStyle, female);
  if (o.cls === 'wolfman') {
    rig.add('tail1', 'hips', L.P(0, L.hipY + 0.02 * u, -L.r.pelvisD * 0.9));
    rig.add('tail2', 'tail1', L.P(0, L.hipY - 0.06 * u, -0.3 * u));
    rig.add('tail3', 'tail2', L.P(0, L.hipY - 0.16 * u, -0.52 * u));
  }

  const cell = 0.033 * u;
  const shape = new Shape();
  shape.minRadius = cell * 0.6;
  const I = (n: string): number => rig.i(n);
  bodyPrims(shape, lay, { bust: female ? 1 : 0 });

  // outfit
  const outfit: Outfit = {};
  switch (o.cls) {
    case 'warrior':
      Object.assign(outfit, {
        top: { color: sch.cloth, trim: sch.trim, sleeves: 'short', cuff: sch.trim, bust: female ? 1 : 0 },
        pants: { color: sch.pants, length: 'full', trim: sch.trim },
        boots: { color: sch.boots, height: 0.55, trim: sch.trim },
        gloves: { color: '#2a1d16', length: 0.18 },
        belt: { color: '#3a2a1f', buckle: sch.trim },
      } satisfies Outfit);
      break;
    case 'ninja':
      Object.assign(outfit, {
        top: { color: sch.cloth, sleeves: 'long', cuff: sch.trim, bust: female ? 1 : 0 },
        pants: { color: sch.pants, length: 'full', baggy: 0.4 },
        boots: { color: sch.boots, height: 0.5, trim: sch.trim },
        gloves: { color: '#15181a', length: 0.3 },
        belt: { color: sch.trim },
        collar: { color: sch.cloth2, height: 1.4 },
      } satisfies Outfit);
      break;
    case 'yacha':
      Object.assign(outfit, {
        top: { color: sch.cloth, trim: sch.trim, sleeves: 'long', cuff: sch.trim, bust: female ? 1 : 0 },
        pants: { color: sch.pants, length: 'full', trim: sch.trim },
        boots: { color: sch.boots, height: 0.6, trim: sch.trim },
        gloves: { color: '#101015', length: 0.3 },
        coat: { color: sch.cloth2, length: 0.42, flare: 0.25, trim: sch.trim },
        collar: { color: sch.cloth2, height: 1.8 },
        belt: { color: sch.trim },
      } satisfies Outfit);
      break;
    case 'shaman':
      Object.assign(outfit, {
        top: { color: sch.cloth, trim: sch.trim, sleeves: 'long', cuff: sch.trim, bust: female ? 1 : 0 },
        pants: { color: sch.pants, length: 'full', baggy: 0.5 },
        boots: { color: sch.boots, height: 0.3 },
        coat: { color: sch.cloth, length: female ? 0.92 : 0.8, flare: 1.2, trim: sch.trim },
        belt: { color: sch.trim, buckle: sch.plate },
        collar: { color: sch.cloth2, height: 1 },
      } satisfies Outfit);
      break;
    case 'wolfman':
      Object.assign(outfit, {
        top: { color: sch.cloth, trim: sch.trim, sleeves: 'none', coverage: 0.7, bust: female ? 1 : 0 },
        pants: { color: sch.pants, length: 'full' },
        boots: { color: sch.boots, height: 0.5, trim: sch.trim },
        gloves: { color: '#2a1d16', length: 0.12 },
        belt: { color: '#2a1d16', buckle: sch.trim },
      } satisfies Outfit);
      break;
  }
  outfitPrims(shape, lay, outfit);
  if (o.cls === 'ninja') {
    // cloth mask over the lower face (painted: the overlay face has no nose/mouth in this case)
    shape.ell(I('head'), [L.head[0], L.head[1] - L.headR[1] * 0.42, L.head[2] + L.headR[2] * 0.2], [L.headR[0] * 1.3, L.headR[1] * 0.5, L.headR[2] * 1.3], { op: 'paint', color: sch.cloth, soft: 0.008 });
  }

  if (o.cls === 'wolfman') {
    // wolf ears, tail and claws
    for (const s of [1, -1]) {
      const [rx, ry, rz] = L.headR;
      shape.rc(I('head'), [L.head[0] + s * rx * 0.55, L.head[1] + ry * 0.85, L.head[2] - rz * 0.1], [L.head[0] + s * rx * 0.85, L.head[1] + ry * 1.75, L.head[2] - rz * 0.25], rx * 0.42, rx * 0.06, { k: 0.03, color: sch.hair });
      shape.rc(I('head'), [L.head[0] + s * rx * 0.55, L.head[1] + ry * 0.95, L.head[2] - rz * 0.05], [L.head[0] + s * rx * 0.78, L.head[1] + ry * 1.5, L.head[2] - rz * 0.12], rx * 0.24, rx * 0.04, { k: 0.01, color: '#c98a7a', cw: 4 });
    }
    shape.rc(I('tail1'), L.P(0, L.hipY + 0.02 * u, -L.r.pelvisD * 0.9), L.P(0, L.hipY - 0.06 * u, -0.3 * u), 0.05 * u, 0.06 * u, { k: 0.05, color: sch.hair });
    shape.rc(I('tail2'), L.P(0, L.hipY - 0.06 * u, -0.3 * u), L.P(0, L.hipY - 0.16 * u, -0.52 * u), 0.06 * u, 0.055 * u, { k: 0.05, color: sch.hair });
    shape.rc(I('tail3'), L.P(0, L.hipY - 0.16 * u, -0.52 * u), L.P(0, L.hipY - 0.3 * u, -0.66 * u), 0.055 * u, 0.012 * u, { k: 0.05, color: '#d8cfc0' });
  }

  const faceStyle: FaceStyle = {
    iris: sch.eye,
    brow: sch.brow,
    skin: skinPair[0],
    eyeScale: female ? 1.6 : 1.4,
    angry: o.cls === 'yacha' ? 0.7 : o.cls === 'warrior' ? 0.35 : o.cls === 'wolfman' ? 0.5 : 0,
    glow: false,
    ears: 'human',
    mask: o.cls === 'ninja' ? sch.cloth : undefined,
    mouth: o.cls !== 'ninja',
    lips: female ? '#b85a60' : '#a86a5c',
  };

  const body = buildMesh(shape, {
    cell,
    boneCount: rig.count,
    sigma: 0.05 * u,
    tau: 0.02 * u,
    seed: o.seed,
    shade: { belly: 0.15, back: 0.2, noise: 0.07, noiseScale: 9, ao: 0.9, aoRadius: 0.09 * u, aoTint: [0.5, 0.45, 0.5] },
  });
  const face = faceOverlay(rig, L, faceStyle, 0.0085 * u);
  const bodyGeo = mergeGeometry(body.geometry, face);

  const hairShapeObj = hairShape(lay, hairStyle, hairN, sch.hair, sch.hair === '#dcdce6' ? '#8a8aa0' : toHex(mulColor(rgb(sch.hair), 1.5)), female, 0.025 * u);
  const hair = buildMesh(hairShapeObj, {
    cell: 0.025 * u,
    boneCount: rig.count,
    sigma: 0.045 * u,
    tau: 0.02 * u,
    seed: o.seed + 7,
    shade: { back: 0.25, noise: 0.14, noiseScale: 18, fur: 0.2, furScale: 40, ao: 0.6, aoRadius: 0.05 * u },
  });
  const armor = buildMesh(armorShape(lay, o.cls, o.tier, sch, 0.032 * u), {
    cell: 0.032 * u,
    boneCount: rig.count,
    sigma: 0.03 * u,
    tau: 0.012 * u,
    seed: o.seed + 13,
    shade: { back: 0.2, noise: o.cls === 'wolfman' ? 0.25 : 0.05, noiseScale: 14, fur: o.cls === 'wolfman' ? 0.3 : 0, furScale: 30, ao: 0.6, aoRadius: 0.05 * u },
  });

  const style: HumanAnimStyle = {
    attack: sch.attack,
    mass: sch.mass,
    hunch: o.cls === 'wolfman' ? 0.08 : 0.02,
    guard: o.cls !== 'shaman',
    hero: true,
    boss: false,
    bodyH: spec.H * 0.52,
    halfT: 0.13,
    height: spec.H,
    knuckle: false,
  };
  const anim = humanClips(rig, style);
  const parts = [
    { name: 'body', geometry: bodyGeo },
    { name: 'hair', geometry: hair.geometry },
    { name: 'armor', geometry: armor.geometry },
  ];
  return assembleModel({
    id,
    kind: 'hero',
    rig,
    parts,
    clips: anim.clips,
    hit: anim.hit,
    sockets: { head: 'head', hand_r: 'hand_r', hand_l: 'hand_l', back: 'back', muzzle: 'muzzle', chest: 'chest' },
    height: Math.max(body.max[1], hair.max[1]),
    radius: 0.32,
    palette: [skinPair[0], sch.cloth, sch.trim, sch.plate],
    extra: { class: o.cls, female, tier: o.tier },
  });
}


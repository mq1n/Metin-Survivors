// DEV-only: bipedal creature presets built on the shared humanoid anatomy — humanoid (orc / goblin / bandit / ninja),
// brute (golem / yeti / ogre, knuckle-walkers) and boss (oni / warlord / beast-lord, 2.5× scale, spiked back).
import { faceOverlay } from './face';
import { buildMesh, mergeGeometry } from './mesher';
import { Rng, type Vec3 } from './math';
import { HUMAN_BASE, SIDES, bodyPrims, layoutHuman, outfitPrims, type HumanSpec, type Outfit } from './humanoid';
import { humanClips, type HumanAnimStyle } from './humanAnim';
import { Shape, rgb, toHex } from './sdf';
import type { CreatureBuild } from './creatures';

export type BipedKind = 'humanoid' | 'brute' | 'boss';
export type BipedPreset = 'orc' | 'goblin' | 'bandit' | 'ninja' | 'golem' | 'yeti' | 'ogre' | 'oni' | 'warlord' | 'beast';

const SKINS: Record<string, [string, string][]> = {
  orc: [['#6f8a4a', '#5a7239'], ['#7b8b57', '#64733f'], ['#8a6e48', '#6f5636'], ['#8d5143', '#6f3d32'], ['#5f7c88', '#4a6370']],
  goblin: [['#8da34d', '#748a3a'], ['#a6a04a', '#8a8438'], ['#6fa066', '#58844f']],
  bandit: [['#c89a78', '#a97f60'], ['#b98862', '#9a6e4b'], ['#8f6446', '#724e35'], ['#dcb08c', '#bd9270']],
  ninja: [['#c89a78', '#a97f60'], ['#a8775a', '#8c6048']],
  golem: [['#7d7a76', '#5d5a57'], ['#8a7a66', '#6b5d4c'], ['#6e7a82', '#53606a']],
  yeti: [['#d8dde0', '#aab4bb'], ['#c9c2b3', '#a49c8c'], ['#b9c8d6', '#8da1b3']],
  ogre: [['#8f8a52', '#736e3d'], ['#a07a58', '#82603f'], ['#7e9a6a', '#617d50']],
  oni: [['#a63a2e', '#832a22'], ['#3f5f9a', '#2e4a7d'], ['#4a8a6a', '#376d52']],
  warlord: [['#6a7480', '#4f5963'], ['#8c7058', '#6e5640']],
  beast: [['#cf7e2e', '#a8631f'], ['#c8c0b0', '#a29a89']],
};

const CLOTHS = ['#5a4632', '#4c3b52', '#3f4d3a', '#6a3a30', '#3a4a5c', '#6b5a3a'];
const TRIMS = ['#b89b4a', '#9aa0a8', '#c0553a', '#6aa0b8'];

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[rng.int(arr.length)] as T;
}

function defaultPreset(kind: BipedKind, rng: Rng): BipedPreset {
  if (kind === 'humanoid') return pick(rng, ['orc', 'orc', 'goblin', 'bandit', 'ninja'] as const);
  if (kind === 'brute') return pick(rng, ['golem', 'yeti', 'ogre'] as const);
  return pick(rng, ['oni', 'warlord', 'beast'] as const);
}

export interface BipedOptions {
  preset?: BipedPreset;
  tint?: string;
  cell?: number;
}

export function buildBiped(kind: BipedKind, seed: number, o: BipedOptions = {}): CreatureBuild {
  const rng = new Rng(seed ^ 0x7a3c1);
  const preset = o.preset ?? defaultPreset(kind, rng);
  const skinPair = pick(rng, SKINS[preset] ?? (SKINS.orc as [string, string][]));
  let skin = skinPair[0];
  let skin2 = skinPair[1];
  if (o.tint) {
    const t = rgb(o.tint);
    const mix = (hex: string, m: number): string => {
      const c = rgb(hex);
      return toHex([c[0] + (t[0] * 1.1 - c[0]) * m, c[1] + (t[1] * 1.1 - c[1]) * m, c[2] + (t[2] * 1.1 - c[2]) * m]);
    };
    skin = mix(skin, 0.7);
    skin2 = mix(skin2, 0.7);
  }
  const cloth = pick(rng, CLOTHS);
  const cloth2 = pick(rng, CLOTHS);
  const trim = pick(rng, TRIMS);

  const spec: HumanSpec = { ...HUMAN_BASE, skin, skin2 };
  const style: HumanAnimStyle = {
    attack: 'smash',
    mass: 1,
    hunch: 0.1,
    guard: true,
    hero: false,
    boss: kind === 'boss',
    bodyH: 0.95,
    halfT: 0.15,
    height: 1.8,
    knuckle: false,
  };
  const outfit: Outfit = {};
  let shadeBase = { belly: 0.3, back: 0.25, noise: 0.2, fur: 0.04, ao: 0.9 };
  let cellMul = 0.042;
  let scale = 1;

  switch (preset) {
    case 'orc': {
      Object.assign(spec, { H: rng.jitter(1.85, 0.08), shoulder: 0.27, hip: 0.105, hunch: rng.range(0.05, 0.1), arm: 1.1, leg: 0.85, neck: 0.6, head: rng.jitter(1.3, 0.06), torsoW: rng.jitter(1.28, 0.06), torsoD: 1.15, limb: rng.jitter(1.35, 0.06), legT: 1.2, hand: 1.35, foot: 1.25, jaw: 1.3 });
      Object.assign(outfit, {
        top: { color: cloth, sleeves: 'none', coverage: 0.5, trim },
        pants: { color: cloth2, length: 'knee' },
        belt: { color: '#2f241b', buckle: trim },
        gloves: { color: '#3b2f26', length: 0.3 },
      } satisfies Outfit);
      style.mass = 1.15;
      style.hunch = 0.16;
      break;
    }
    case 'goblin': {
      Object.assign(spec, { H: rng.jitter(1.2, 0.1), shoulder: 0.17, hip: 0.085, hunch: 0.1, arm: 1.1, leg: 0.8, neck: 0.5, head: 1.75, torsoW: 0.9, torsoD: 0.85, limb: 0.85, legT: 0.8, hand: 1.2, foot: 1.2, jaw: 1.1 });
      Object.assign(outfit, {
        top: { color: cloth, sleeves: 'none', coverage: 0.4 },
        pants: { color: cloth2, length: 'shorts' },
        belt: { color: '#3a2c20' },
      } satisfies Outfit);
      style.mass = 0.8;
      style.hunch = 0.22;
      style.bodyH = 0.62;
      style.halfT = 0.12;
      break;
    }
    case 'bandit': {
      Object.assign(spec, { H: rng.jitter(1.78, 0.06), shoulder: 0.21, hunch: 0.03, neck: 0.9, head: 1.15, torsoW: 1.05, limb: 1.05, hand: 1.1 });
      Object.assign(outfit, {
        top: { color: cloth, sleeves: 'long', cuff: trim, trim },
        pants: { color: cloth2, length: 'full' },
        boots: { color: '#2b2119', height: 0.5 },
        belt: { color: '#2a2018', buckle: trim },
        gloves: { color: '#2a2018', length: 0.2 },
      } satisfies Outfit);
      style.hunch = 0.06;
      style.attack = 'smash';
      break;
    }
    case 'ninja': {
      Object.assign(spec, { H: rng.jitter(1.72, 0.05), shoulder: 0.19, hunch: 0.04, neck: 1, head: 1.15, torsoW: 0.9, torsoD: 0.9, limb: 0.88, legT: 0.88 });
      const dark = pick(rng, ['#232a30', '#2a2430', '#1f2f2a'] as const);
      Object.assign(outfit, {
        top: { color: dark, sleeves: 'long', cuff: '#8a2f2a' },
        pants: { color: dark, length: 'full', baggy: 0.3 },
        boots: { color: '#15181b', height: 0.45, trim: '#8a2f2a' },
        belt: { color: '#8a2f2a' },
        gloves: { color: '#15181b', length: 0.3 },
        collar: { color: '#8a2f2a', height: 1.6 },
      } satisfies Outfit);
      style.attack = 'stab';
      style.mass = 0.85;
      style.hunch = 0.12;
      style.bodyH = 0.9;
      break;
    }
    case 'golem': {
      Object.assign(spec, { H: rng.jitter(2.25, 0.07), shoulder: 0.36, hip: 0.14, hunch: 0.1, arm: 1.35, leg: 0.62, torso: 1, neck: 0.3, head: 1.4, torsoW: 1.45, torsoD: 1.3, limb: 2, legT: 1.6, hand: 2, foot: 1.6, jaw: 1.35 });
      style.knuckle = true;
      style.mass = 1.7;
      style.hunch = 0.22;
      style.guard = false;
      style.bodyH = 1.0;
      style.halfT = 0.3;
      cellMul = 0.05;
      shadeBase = { belly: 0.1, back: 0.2, noise: 0.42, fur: 0, ao: 1 };
      break;
    }
    case 'yeti': {
      Object.assign(spec, { H: rng.jitter(2.3, 0.07), shoulder: 0.34, hip: 0.14, hunch: 0.1, arm: 1.4, leg: 0.6, torso: 1, neck: 0.3, head: 1.45, torsoW: 1.4, torsoD: 1.3, limb: 1.85, legT: 1.5, hand: 1.9, foot: 1.5, jaw: 1.2 });
      style.knuckle = true;
      style.mass = 1.6;
      style.hunch = 0.2;
      style.guard = false;
      style.bodyH = 1.0;
      style.halfT = 0.32;
      cellMul = 0.05;
      shadeBase = { belly: 0.25, back: 0.2, noise: 0.18, fur: 0.22, ao: 0.9 };
      break;
    }
    case 'ogre': {
      Object.assign(spec, { H: rng.jitter(2.35, 0.07), shoulder: 0.3, hip: 0.15, hunch: 0.06, arm: 1.15, leg: 0.68, torso: 1, neck: 0.35, head: 1.3, torsoW: 1.5, torsoD: 1.5, limb: 1.6, legT: 1.5, hand: 1.6, foot: 1.5, jaw: 1.3 });
      Object.assign(outfit, {
        pants: { color: cloth2, length: 'knee' },
        belt: { color: '#2f241b', buckle: trim },
      } satisfies Outfit);
      style.mass = 1.7;
      style.hunch = 0.14;
      style.bodyH = 1.1;
      style.halfT = 0.3;
      cellMul = 0.05;
      break;
    }
    default: {
      // bosses: 2.5× brutes
      scale = 2.5;
      const warlord = preset === 'warlord';
      Object.assign(spec, { H: 2.0 * scale * rng.jitter(1, 0.05), shoulder: 0.3, hip: 0.13, hunch: 0.07, arm: 1.2, leg: 0.7, torso: 1, neck: 0.5, head: 1.25, torsoW: 1.35, torsoD: 1.25, limb: 1.55, legT: 1.4, hand: 1.6, foot: 1.4, jaw: 1.3 });
      Object.assign(outfit, {
        pants: { color: warlord ? '#3b3f46' : '#2b2420', length: 'knee', trim: '#c9a54a' },
        belt: { color: '#c9a54a', buckle: '#e8d08a' },
        gloves: { color: '#c9a54a', length: 0.32 },
      } satisfies Outfit);
      style.mass = 2.2;
      style.hunch = 0.12;
      style.boss = true;
      style.bodyH = 1.5 * scale;
      style.halfT = 0.4 * scale;
      style.guard = true;
      cellMul = 0.03;
      shadeBase = { belly: 0.25, back: 0.3, noise: 0.22, fur: 0.04, ao: 0.9 };
      break;
    }
  }
  spec.skin = skin;
  spec.skin2 = skin2;

  const lay = layoutHuman(spec);
  const { rig, L } = lay;
  const u = L.u;
  const I = (n: string): number => rig.i(n);
  style.height = spec.H;
  style.bodyH = Math.max(style.bodyH, spec.H * 0.5);

  // extra bones: boss spikes + tail
  const spikes = kind === 'boss' ? 5 : 0;
  if (spikes) {
    for (let i = 1; i <= spikes; i++) {
      const t = i / (spikes + 1);
      const y = L.waist[1] + (L.neckB[1] - L.waist[1]) * t;
      rig.add(`spike${i}`, 'chest', L.P(0, y, -L.r.chestD * (1 - 0.3 * t)));
    }
    rig.add('tail1', 'hips', L.P(0, L.hipY + 0.02, -L.r.pelvisD * 0.8));
    rig.add('tail2', 'tail1', L.P(0, L.hipY - 0.08 * u, -0.36 * u));
    rig.add('tail3', 'tail2', L.P(0, L.hipY - 0.2 * u, -0.6 * u));
  }
  const cell = o.cell ?? cellMul * u;
  const shape = new Shape();
  shape.minRadius = cell * 0.62;

  bodyPrims(shape, lay);

  // ----- head features
  const hr = L.headR;
  const hx = L.head[0];
  const hy = L.head[1];
  const hz = L.head[2];
  const eyeCol = preset === 'golem' ? '#ff9a3a' : preset === 'oni' || preset === 'ogre' ? '#ffd24a' : preset === 'yeti' ? '#9fd8ff' : '#f0d040';
  for (const s of [1, -1]) {
    // brow ridge
    shape.rc(I('head'), [hx + s * hr[0] * 0.15, hy + hr[1] * 0.3, hz + hr[2] * 0.82], [hx + s * hr[0] * 0.78, hy + hr[1] * 0.22, hz + hr[2] * 0.62], 0.024 * u, 0.018 * u, { k: 0.03, color: skin2 });
  }
  shape.ell(I('head'), [hx, hy - hr[1] * 0.08, hz + hr[2] * 0.96], [0.022 * u, 0.03 * u, 0.028 * u], { k: 0.03, color: skin2 });
  shape.rc(I('jaw'), [hx - hr[0] * 0.3, hy - hr[1] * 0.42, hz + hr[2] * 0.88], [hx + hr[0] * 0.3, hy - hr[1] * 0.42, hz + hr[2] * 0.88], 0.006 * u, 0.006 * u, { op: 'paint', color: '#1a0f0c', soft: 0.004 });
  const tusk = preset === 'orc' || preset === 'ogre' || preset === 'oni' || preset === 'beast' || preset === 'warlord';
  if (tusk) {
    const tl = (preset === 'oni' ? 0.1 : preset === 'beast' ? 0.08 : 0.065) * u;
    for (const s of [1, -1]) {
      shape.rc(I('jaw'), [hx + s * hr[0] * 0.42, hy - hr[1] * 0.5, hz + hr[2] * 0.78], [hx + s * hr[0] * 0.56, hy - hr[1] * 0.5 + tl, hz + hr[2] * 0.98], 0.017 * u, 0.007 * u, { k: 0.012, color: '#e8dfc8', cw: 4 });
    }
  }
  // ears
  const earLong = preset === 'goblin' ? 2.4 : preset === 'beast' ? 1.0 : preset === 'yeti' || preset === 'golem' || preset === 'bandit' || preset === 'ninja' ? 0 : 1.2;
  if (earLong > 0) {
    for (const s of [1, -1]) {
      shape.rc(I('head'), [hx + s * hr[0] * 0.9, hy + hr[1] * 0.0, hz - hr[2] * 0.1], [hx + s * (hr[0] + 0.09 * u * earLong), hy + hr[1] * 0.3 + 0.03 * u * earLong, hz - hr[2] * (0.25 + 0.3 * (earLong - 1))], 0.026 * u, 0.008 * u, { k: 0.02, color: skin2 });
    }
  }
  // horns
  if (preset === 'oni' || preset === 'warlord' || preset === 'ogre') {
    const hornLen = preset === 'ogre' ? 0.14 : 0.3;
    for (const s of [1, -1]) {
      const b0: Vec3 = [hx + s * hr[0] * 0.5, hy + hr[1] * 0.85, hz + hr[2] * 0.25];
      const b1: Vec3 = [b0[0] + s * 0.04 * u, b0[1] + hornLen * 0.5 * u, b0[2] + 0.04 * u];
      const b2: Vec3 = [b1[0] + s * 0.02 * u, b1[1] + hornLen * 0.5 * u, b1[2] + 0.1 * u];
      shape.rc(I('head'), b0, b1, 0.03 * u, 0.022 * u, { k: 0.02, color: '#d8cdb0', cw: 3 });
      shape.rc(I('head'), b1, b2, 0.022 * u, 0.007 * u, { k: 0.02, color: '#e6dcc0', cw: 3 });
    }
  }
  // mane / hair tuft for beast & yeti brow
  if (preset === 'beast' || preset === 'yeti') {
    shape.ell(I('head'), [hx, hy + hr[1] * 0.5, hz - hr[2] * 0.2], [hr[0] * 1.08, hr[1] * 0.5, hr[2] * 1.0], { k: 0.1, color: preset === 'beast' ? '#3a2312' : '#e8eef2' });
  }

  // ----- outfit
  outfitPrims(shape, lay, outfit);

  // ----- preset specifics
  const hrA = L.hd[1];
  if (preset === 'orc' || preset === 'ogre' || preset === 'oni' || preset === 'warlord' || preset === 'bandit' || preset === 'ninja' || preset === 'goblin') {
    // right-hand weapon: bound to hand_r so it swings with the arm
    const h0 = hrA;
    if (preset === 'bandit' || preset === 'ninja' || preset === 'goblin') {
      const len = preset === 'goblin' ? 0.32 : 0.55;
      shape.rc(I('hand_r'), [h0[0], h0[1] + 0.02 * u, h0[2] + 0.02 * u], [h0[0], h0[1] + 0.03 * u, h0[2] + 0.02 * u + len * u], 0.014 * u, 0.012 * u, { k: 0.01, color: '#2a2018', cw: 6 });
      shape.rc(I('hand_r'), [h0[0], h0[1] + 0.035 * u, h0[2] + 0.1 * u], [h0[0], h0[1] + 0.035 * u, h0[2] + 0.1 * u + len * u * 0.95], 0.011 * u, 0.006 * u, { k: 0.005, color: '#c9d0d6', cw: 6 });
      shape.box(I('hand_r'), [h0[0], h0[1] + 0.03 * u, h0[2] + 0.095 * u], [0.045 * u, 0.012 * u, 0.014 * u], 0.006 * u, { k: 0.005, color: trim, cw: 6 });
    } else {
      const big = preset === 'oni' || preset === 'warlord' ? 1.45 : 1;
      const a: Vec3 = [h0[0], h0[1] + 0.01 * u, h0[2] - 0.01 * u];
      const b: Vec3 = [h0[0] - 0.01 * u, h0[1] + 0.3 * u * big, h0[2] + 0.5 * u * big];
      const c: Vec3 = [h0[0] - 0.02 * u, h0[1] + 0.52 * u * big, h0[2] + 0.78 * u * big];
      const wood = preset === 'oni' || preset === 'warlord' ? '#3a3a40' : '#6b4a2e';
      shape.rc(I('hand_r'), a, b, 0.032 * u * big, 0.05 * u * big, { k: 0.03, color: wood, cw: 6 });
      shape.rc(I('hand_r'), b, c, 0.05 * u * big, 0.1 * u * big, { k: 0.03, color: wood, cw: 6 });
      shape.sph(I('hand_r'), c, 0.1 * u * big, { k: 0.03, color: wood, cw: 6 });
      // studs
      for (let i = 0; i < 7; i++) {
        const t = 0.55 + (i % 2) * 0.15;
        const ang = (i / 7) * Math.PI * 2;
        const centre: Vec3 = [b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t, b[2] + (c[2] - b[2]) * t];
        const r = 0.085 * u * big;
        shape.rc(I('hand_r'), centre, [centre[0] + Math.cos(ang) * r, centre[1] + Math.sin(ang) * r * 0.7, centre[2] - Math.sin(ang) * r * 0.5], 0.02 * u * big, 0.008 * u * big, { k: 0.01, color: '#aeb2b8', cw: 6 });
      }
    }
  }
  if (preset === 'golem') {
    const stone = skin;
    const hi = '#9a968f';
    for (const { n, s } of SIDES) {
      const i = s > 0 ? 0 : 1;
      shape.ell(I(`clav_${n}`), [L.sh[i][0] + s * 0.04 * u, L.sh[i][1] + 0.03 * u, L.sh[i][2]], [0.15 * u, 0.1 * u, 0.13 * u], { k: 0.05, color: hi, rot: [0, 0, s * -0.35] });
      shape.ell(I(`farm_${n}`), [(L.el[i][0] + L.wr[i][0]) / 2, (L.el[i][1] + L.wr[i][1]) / 2, (L.el[i][2] + L.wr[i][2]) / 2], [0.085 * u, 0.15 * u, 0.085 * u], { k: 0.04, color: stone });
      shape.sph(I(`hand_${n}`), L.hd[i], 0.095 * u, { k: 0.04, color: stone });
      shape.sph(I(`shin_${n}`), [L.knee[i][0], L.knee[i][1], L.knee[i][2] + 0.06 * u], 0.08 * u, { k: 0.04, color: hi });
    }
    shape.box(I('chest'), L.P(0, L.chest[1] + 0.05 * u, -0.17 * u), [0.3 * u, 0.22 * u, 0.06 * u], 0.03 * u, { k: 0.05, color: hi });
    // glowing cracks
    const crack = '#ff8a3a';
    const cr: [Vec3, Vec3][] = [
      [L.P(0.05 * u, L.chest[1] + 0.12 * u, 0.14 * u), L.P(-0.08 * u, L.chest[1] - 0.08 * u, 0.16 * u)],
      [L.P(-0.08 * u, L.chest[1] - 0.08 * u, 0.16 * u), L.P(0.02 * u, L.chest[1] - 0.22 * u, 0.15 * u)],
      [L.P(0.2 * u, L.chest[1] + 0.2 * u, 0.04 * u), L.P(0.12 * u, L.chest[1] + 0.04 * u, 0.12 * u)],
    ];
    for (const [a, b] of cr) shape.rc(I('chest'), a, b, 0.011 * u, 0.008 * u, { op: 'paint', color: crack, soft: 0.004 });
  }
  if (preset === 'yeti') {
    // shaggy fur tufts on shoulders, forearms and back
    for (const { n, s } of SIDES) {
      const i = s > 0 ? 0 : 1;
      shape.ell(I(`clav_${n}`), [L.sh[i][0] + s * 0.03 * u, L.sh[i][1] + 0.0, L.sh[i][2] - 0.02 * u], [0.13 * u, 0.12 * u, 0.14 * u], { k: 0.07, color: skin });
      for (let k = 0; k < 3; k++) {
        const t = 0.2 + k * 0.25;
        shape.rc(I(`farm_${n}`), [L.el[i][0] + s * 0.03 * u, L.el[i][1] + (L.wr[i][1] - L.el[i][1]) * t, L.el[i][2] + (L.wr[i][2] - L.el[i][2]) * t - 0.02 * u], [L.el[i][0] + s * 0.08 * u, L.el[i][1] + (L.wr[i][1] - L.el[i][1]) * t - 0.07 * u, L.el[i][2] + (L.wr[i][2] - L.el[i][2]) * t - 0.04 * u], 0.03 * u, 0.012 * u, { k: 0.02, color: skin2 });
      }
    }
    shape.ell(I('chest'), L.P(0, L.chest[1] + 0.05 * u, -0.08 * u), [0.24 * u, 0.2 * u, 0.14 * u], { k: 0.07, color: skin });
  }
  if (preset === 'ogre') {
    shape.ell(I('spine'), L.P(0, L.waist[1] - 0.04 * u, 0.1 * u), [0.22 * u, 0.18 * u, 0.19 * u], { k: 0.1, color: skin });
  }
  if (preset === 'beast') {
    for (const { n, s } of SIDES) {
      const i = s > 0 ? 0 : 1;
      for (let k = 0; k < 3; k++) {
        shape.rc(I(`hand_${n}`), [L.hd[i][0] + (k - 1) * 0.022 * u, L.hd[i][1] - 0.05 * u, L.hd[i][2] + 0.02 * u], [L.hd[i][0] + (k - 1) * 0.026 * u, L.hd[i][1] - 0.11 * u, L.hd[i][2] + 0.06 * u], 0.012 * u, 0.004 * u, { k: 0.008, color: '#efe7d2', cw: 6 });
      }
    }
  }
  // boss spikes, tail, shoulder & knee spikes
  if (spikes) {
    for (let i = 1; i <= spikes; i++) {
      const t = i / (spikes + 1);
      const y = L.waist[1] + (L.neckB[1] - L.waist[1]) * t;
      const base = L.P(0, y, -L.r.chestD * 0.9 * (1 - 0.3 * t));
      const sz = (0.9 + 0.5 * Math.sin(t * Math.PI)) * 0.18 * u;
      shape.rc(I(`spike${i}`), base, [base[0], base[1] + sz * 0.8, base[2] - sz * 0.55], 0.05 * u, 0.012 * u, { k: 0.03, color: preset === 'oni' ? '#2a1a18' : '#d8cdb0', cw: 4, sigma: 0.03 });
    }
    const tb = L.P(0, L.hipY + 0.02, -L.r.pelvisD * 0.7);
    shape.rc(I('tail1'), tb, L.P(0, L.hipY - 0.08 * u, -0.36 * u), 0.07 * u, 0.055 * u, { k: 0.06, color: skin });
    shape.rc(I('tail2'), L.P(0, L.hipY - 0.08 * u, -0.36 * u), L.P(0, L.hipY - 0.2 * u, -0.6 * u), 0.055 * u, 0.035 * u, { k: 0.05, color: skin });
    shape.rc(I('tail3'), L.P(0, L.hipY - 0.2 * u, -0.6 * u), L.P(0, L.hipY - 0.3 * u, -0.78 * u), 0.035 * u, 0.01 * u, { k: 0.04, color: '#2a1a18' });
    for (const { n, s } of SIDES) {
      const i = s > 0 ? 0 : 1;
      const sp0: Vec3 = [L.sh[i][0] + s * 0.03 * u, L.sh[i][1] + 0.05 * u, L.sh[i][2]];
      shape.rc(I(`clav_${n}`), sp0, [sp0[0] + s * 0.05 * u, sp0[1] + 0.14 * u, sp0[2] - 0.07 * u], 0.05 * u, 0.012 * u, { k: 0.04, color: '#d8cdb0', cw: 4 });
    }
  }
  // beast stripes / yeti fur pattern and shading
  const pattern = preset === 'beast' ? { kind: 'stripes' as const, color: rgb('#24160a'), scale: 5.2, amount: 0.9 } : undefined;

  const mesh = buildMesh(shape, {
    cell,
    boneCount: rig.count,
    sigma: 0.055 * Math.sqrt(u),
    tau: 0.022 * Math.sqrt(u),
    seed,
    shade: {
      belly: shadeBase.belly,
      back: shadeBase.back,
      noise: shadeBase.noise,
      noiseScale: 9 / Math.sqrt(u),
      fur: shadeBase.fur,
      furScale: 28 / u,
      ao: shadeBase.ao,
      aoRadius: 0.1 * u,
      aoTint: [0.42, 0.38, 0.45],
      pattern,
    },
  });

  style.attack = preset === 'ninja' ? 'stab' : 'smash';
  const face = faceOverlay(rig, L, { iris: eyeCol, brow: skin2, skin, glow: true, eyeScale: preset === 'goblin' ? 1.9 : kind === 'brute' ? 2.1 : 1.6, angry: kind === 'brute' ? 0.4 : 0.8, mouth: false, nose: false, ears: 'none' }, cell * 0.28);
  const bodyGeo = mergeGeometry(mesh.geometry, face);
  const anim = humanClips(rig, style);
  const height = mesh.max[1];
  const radius = Math.max(0.3 * u, Math.max(mesh.max[0] - mesh.min[0], (mesh.max[2] - mesh.min[2]) * 0.7) * 0.5 * (kind === 'brute' ? 0.9 : 0.8));
  return {
    rig,
    parts: [{ name: 'body', geometry: bodyGeo }],
    clips: anim.clips,
    hit: anim.hit,
    sockets: { head: 'head', hand_r: 'hand_r', hand_l: 'hand_l', back: 'back', muzzle: 'muzzle', chest: 'chest' },
    height,
    radius,
    palette: mesh.palette,
    verts: mesh.verts,
  };
}

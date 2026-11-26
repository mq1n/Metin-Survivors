// DEV-only: quadruped archetype (wolf / boar / bear / big-cat proportions). Blended SDF body, 26-bone rig, full clip set.
import type { AnimationClip } from 'three';
import { buildMesh } from './mesher';
import { Rng, clamp, curve, easeInOut, hashString, type Vec3 } from './math';
import { bakeClips, Rig, type ClipSpec, type Pose } from './rig';
import { Shape, rgb, toHex } from './sdf';
import type { CreatureBuild } from './creatures';

export type QuadVariant = 'wolf' | 'boar' | 'bear' | 'cat';

interface QuadSpec {
  variant: QuadVariant;
  len: number;
  hgt: number;
  wid: number;
  bulk: number;
  snout: number;
  head: number;
  ear: number;
  earRound: number;
  tail: number;
  tailThick: number;
  tusk: number;
  neck: number;
  hump: number;
  mane: number;
  coat: string;
  belly: string;
  dark: string;
  accent: string;
  eye: string;
  pattern: 'none' | 'stripes' | 'spots';
}

const VARIANTS: Record<QuadVariant, Omit<QuadSpec, 'variant'>> = {
  wolf: {
    len: 1, hgt: 1, wid: 1, bulk: 1, snout: 1, head: 1, ear: 1, earRound: 0, tail: 1, tailThick: 1, tusk: 0.35, neck: 1, hump: 0.3, mane: 0.5,
    coat: '#6f675c', belly: '#b5a78f', dark: '#3a3530', accent: '#2b2723', eye: '#f4b73a', pattern: 'none',
  },
  boar: {
    len: 0.9, hgt: 0.84, wid: 1.14, bulk: 1.22, snout: 0.82, head: 1.16, ear: 0.6, earRound: 0.3, tail: 0.3, tailThick: 0.5, tusk: 1.2, neck: 0.55, hump: 0.9, mane: 1,
    coat: '#5b4333', belly: '#8d6c4d', dark: '#2d221a', accent: '#1f1712', eye: '#e2562c', pattern: 'none',
  },
  bear: {
    len: 1, hgt: 1.18, wid: 1.34, bulk: 1.42, snout: 0.7, head: 1.1, ear: 0.42, earRound: 1, tail: 0.22, tailThick: 0.8, tusk: 0, neck: 0.75, hump: 1, mane: 0.3,
    coat: '#4b392a', belly: '#6f5841', dark: '#2a2018', accent: '#241a13', eye: '#d9a53a', pattern: 'none',
  },
  cat: {
    len: 1.1, hgt: 0.92, wid: 0.92, bulk: 0.95, snout: 0.62, head: 0.95, ear: 0.7, earRound: 0.6, tail: 1.25, tailThick: 0.7, tusk: 0.3, neck: 0.8, hump: 0.2, mane: 0,
    coat: '#c27a2d', belly: '#ecd9b2', dark: '#3a2412', accent: '#24150a', eye: '#9be04a', pattern: 'stripes',
  },
};

function shiftColor(hex: string, rng: Rng, hue = 0.04, light = 0.14): string {
  const c = rgb(hex);
  const k = 1 + (rng.next() - 0.5) * 2 * light;
  const sh = (rng.next() - 0.5) * 2 * hue;
  return toHex([clamp(c[0] * k * (1 + sh), 0, 1), clamp(c[1] * k, 0, 1), clamp(c[2] * k * (1 - sh), 0, 1)]);
}

export function makeQuadSpec(seed: number, variant: QuadVariant | undefined, tint: string | undefined): QuadSpec {
  const rng = new Rng(seed ^ 0x51ed);
  const v = variant ?? (['wolf', 'boar', 'bear', 'cat'] as const)[rng.int(4)] ?? 'wolf';
  const base = VARIANTS[v];
  const spec: QuadSpec = {
    variant: v,
    ...base,
    len: rng.jitter(base.len, 0.07),
    hgt: rng.jitter(base.hgt, 0.07),
    wid: rng.jitter(base.wid, 0.06),
    bulk: rng.jitter(base.bulk, 0.06),
    snout: rng.jitter(base.snout, 0.12),
    head: rng.jitter(base.head, 0.06),
    ear: rng.jitter(base.ear, 0.15),
    tail: rng.jitter(base.tail, 0.15),
    coat: shiftColor(base.coat, rng),
    belly: shiftColor(base.belly, rng, 0.03, 0.08),
    dark: shiftColor(base.dark, rng),
    pattern: base.pattern === 'none' && v === 'wolf' && rng.chance(0.25) ? 'spots' : base.pattern,
  };
  if (tint) {
    const t = rgb(tint);
    const mixTo = (hex: string, m: number): string => {
      const c = rgb(hex);
      return toHex([c[0] + (t[0] * 1.15 - c[0]) * m, c[1] + (t[1] * 1.15 - c[1]) * m, c[2] + (t[2] * 1.15 - c[2]) * m]);
    };
    spec.coat = mixTo(spec.coat, 0.7);
    spec.belly = mixTo(spec.belly, 0.4);
    spec.dark = mixTo(spec.dark, 0.45);
  }
  return spec;
}

// Leg bone naming: fl_upper / fl_lower / hand_l, fr_upper / fr_lower / hand_r, bl_upper / bl_lower / bl_paw, br_...
function buildRig(s: QuadSpec): { rig: Rig; P: (x: number, y: number, z: number) => Vec3 } {
  const P = (x: number, y: number, z: number): Vec3 => [x * s.wid, y * s.hgt, z * s.len];
  const rig = new Rig();
  rig.add('root', null, [0, 0, 0]);
  rig.add('hips', 'root', P(0, 0.56, -0.36));
  rig.add('spine', 'hips', P(0, 0.58, -0.08));
  rig.add('chest', 'spine', P(0, 0.6, 0.2));
  rig.add('neck', 'chest', P(0, 0.66, 0.34 + 0.04 * s.neck));
  rig.add('head', 'neck', P(0, 0.7, 0.52 + 0.04 * s.neck));
  rig.add('jaw', 'head', P(0, 0.62, 0.62));
  rig.add('muzzle', 'head', P(0, 0.64, 0.66 + 0.24 * s.snout));
  rig.add('ear_l', 'head', P(0.07, 0.8, 0.55));
  rig.add('ear_r', 'head', P(-0.07, 0.8, 0.55));
  rig.add('back', 'spine', P(0, 0.8, 0.02));
  rig.add('tail1', 'hips', P(0, 0.62, -0.54));
  rig.add('tail2', 'tail1', P(0, 0.64, -0.74));
  rig.add('tail3', 'tail2', P(0, 0.61, -0.92 - 0.1 * (s.tail - 1)));
  for (const [sd, x] of [['l', 1], ['r', -1]] as const) {
    rig.add(`f${sd}_upper`, 'chest', P(x * 0.14, 0.54, 0.26));
    rig.add(`f${sd}_lower`, `f${sd}_upper`, P(x * 0.125, 0.31, 0.22));
    rig.add(`hand_${sd}`, `f${sd}_lower`, P(x * 0.12, 0.1, 0.265));
    rig.add(`b${sd}_upper`, 'hips', P(x * 0.13, 0.54, -0.4));
    rig.add(`b${sd}_lower`, `b${sd}_upper`, P(x * 0.125, 0.32, -0.3));
    rig.add(`b${sd}_paw`, `b${sd}_lower`, P(x * 0.12, 0.17, -0.46));
  }
  return { rig, P };
}

function legCycle(phase: number, duty: number): { swing: number; lift: number } {
  const p = ((phase % 1) + 1) % 1;
  if (p < duty) return { swing: 1 - 2 * (p / duty), lift: 0 };
  const s = (p - duty) / (1 - duty);
  return { swing: -1 + 2 * easeInOut(s), lift: Math.sin(Math.PI * s) };
}

export function buildQuadruped(seed: number, opts: { variant?: QuadVariant; tint?: string; bones?: number; cell?: number } = {}): CreatureBuild {
  const spec = makeQuadSpec(seed, opts.variant, opts.tint);
  const { rig, P } = buildRig(spec);
  const I = (n: string): number => rig.i(n);
  const cell = opts.cell ?? 0.042 * ((spec.len + spec.hgt) / 2);
  const shape = new Shape();
  shape.minRadius = cell * 0.62;
  const b = spec.bulk;
  const S = (r: number): number => r * b;
  const coat = spec.coat;
  const belly = spec.belly;
  const dark = spec.dark;
  const ivory = '#e8dfc8';
  const ear = 0.07 * spec.ear;

  // torso
  shape.ell(I('hips'), P(0, 0.56, -0.38), [S(0.15) * spec.wid, S(0.17) * spec.hgt, 0.2 * spec.len], { k: 0.09, color: coat });
  shape.rc(I('spine'), P(0, 0.575, -0.3), P(0, 0.585, 0.05), S(0.145) * spec.wid, S(0.155) * spec.wid, { k: 0.1, color: coat });
  shape.ell(I('chest'), P(0, 0.585, 0.22), [S(0.17) * spec.wid, S(0.215) * spec.hgt, 0.235 * spec.len], { k: 0.1, color: coat });
  // withers / hump
  shape.ell(I('chest'), P(0, 0.68, 0.24), [S(0.12) * spec.wid, 0.1 * spec.hump * spec.hgt + 0.04, 0.17 * spec.len], { k: 0.1, color: coat });
  shape.rc(I('neck'), P(0, 0.63, 0.34), P(0, 0.71, 0.56), S(0.125) * spec.neck + 0.02, S(0.1) * spec.neck + 0.02, { k: 0.08, color: coat });
  // head
  const hs = spec.head;
  shape.ell(I('head'), P(0, 0.72, 0.6), [0.1 * hs * spec.wid, 0.1 * hs * spec.hgt, 0.135 * hs], { k: 0.07, color: coat });
  shape.rc(I('head'), P(0, 0.69, 0.66), P(0, 0.655, 0.66 + 0.22 * spec.snout), 0.072 * hs, 0.044 * hs + 0.006 * spec.snout, { k: 0.05, color: belly, cw: 0.9 });
  shape.rc(I('jaw'), P(0, 0.612, 0.66), P(0, 0.612, 0.64 + 0.2 * spec.snout), 0.04 * hs, 0.028 * hs, { k: 0.04, color: belly });
  // ears
  for (const [sd, x] of [['l', 1], ['r', -1]] as const) {
    const e = I(`ear_${sd}`);
    const tipR = ear * (0.2 + spec.earRound * 0.8);
    shape.rc(e, P(x * 0.075, 0.78, 0.56), P(x * (0.1 + 0.02 * spec.ear), 0.8 + 0.12 * spec.ear, 0.54), 0.045 * spec.ear + 0.012, tipR + 0.004, { k: 0.035, color: dark });
  }
  // tusks / fangs
  if (spec.tusk > 0) {
    for (const x of [1, -1]) {
      shape.rc(I('head'), P(x * 0.05, 0.635, 0.82), P(x * 0.075, 0.635 + 0.075 * spec.tusk, 0.85 + 0.03 * spec.tusk), 0.016, 0.006, { k: 0.01, color: ivory, cw: 3 });
    }
  }
  // tail
  const tt = spec.tailThick;
  shape.rc(I('tail1'), P(0, 0.605, -0.5), P(0, 0.64, -0.74), 0.06 * tt + 0.01, 0.062 * tt + 0.01, { k: 0.06, color: coat });
  shape.rc(I('tail2'), P(0, 0.64, -0.74), P(0, 0.62, -0.92 - 0.1 * (spec.tail - 1)), 0.062 * tt + 0.01, 0.05 * tt + 0.008, { k: 0.05, color: coat });
  shape.rc(I('tail3'), P(0, 0.62, -0.92 - 0.1 * (spec.tail - 1)), P(0, 0.58, -1.05 - 0.2 * (spec.tail - 1)), 0.05 * tt + 0.008, 0.02 * tt + 0.006, {
    k: 0.04,
    color: spec.variant === 'cat' ? dark : belly,
  });
  // legs
  for (const [sd, x] of [['l', 1], ['r', -1]] as const) {
    shape.rc(I(`f${sd}_upper`), P(x * 0.13, 0.54, 0.26), P(x * 0.12, 0.31, 0.22), S(0.078), S(0.05), { k: 0.07, color: coat });
    shape.rc(I(`f${sd}_lower`), P(x * 0.12, 0.31, 0.22), P(x * 0.12, 0.1, 0.265), S(0.05), S(0.036), { k: 0.05, color: dark });
    shape.ell(I(`hand_${sd}`), P(x * 0.12, 0.04 * spec.hgt + 0.02, 0.3), [S(0.042), 0.04, S(0.07)], { k: 0.04, color: dark });
    shape.rc(I(`b${sd}_upper`), P(x * 0.135, 0.55, -0.4), P(x * 0.125, 0.32, -0.3), S(0.11), S(0.056), { k: 0.08, color: coat });
    shape.rc(I(`b${sd}_lower`), P(x * 0.125, 0.32, -0.3), P(x * 0.12, 0.17, -0.46), S(0.056), S(0.036), { k: 0.05, color: coat });
    shape.rc(I(`b${sd}_paw`), P(x * 0.12, 0.17, -0.46), P(x * 0.12, 0.05, -0.42), S(0.036), S(0.032), { k: 0.04, color: dark });
    shape.ell(I(`b${sd}_paw`), P(x * 0.12, 0.04 * spec.hgt + 0.02, -0.38), [S(0.042), 0.04, S(0.072)], { k: 0.04, color: dark });
  }
  // paint: eyes, nose, dorsal stripe, brow
  for (const x of [1, -1]) {
    shape.sph(I('head'), P(x * 0.078, 0.745, 0.675), 0.021 * hs + 0.004, { op: 'paint', color: spec.eye, soft: 0.006, alpha: 1 });
    shape.sph(I('head'), P(x * 0.083, 0.745, 0.682), 0.01 * hs + 0.002, { op: 'paint', color: '#120d0a', soft: 0.004 });
  }
  shape.sph(I('head'), P(0, 0.668, 0.668 + 0.23 * spec.snout), 0.026 * hs, { op: 'paint', color: '#1a1413', soft: 0.008 });
  shape.rc(I('spine'), P(0, 0.8, 0.32), P(0, 0.72, -0.56), 0.055, 0.05, { op: 'paint', color: spec.accent, soft: 0.04, alpha: 0.75 * (0.3 + spec.mane) });

  const mesh = buildMesh(shape, {
    cell,
    boneCount: rig.count,
    sigma: 0.055 * Math.sqrt(spec.bulk),
    tau: 0.03,
    seed,
    shade: {
      belly: 0.85,
      bellyColor: rgb(belly),
      back: 0.45,
      noise: 0.12,
      noiseScale: 6,
      fur: 0.1,
      furScale: 26,
      ao: 0.8,
      aoRadius: 0.14,
      aoTint: [0.45, 0.4, 0.46],
      pattern:
        spec.pattern === 'none'
          ? undefined
          : { kind: spec.pattern, color: rgb(spec.accent), scale: spec.pattern === 'stripes' ? 9.5 : 12, amount: spec.pattern === 'stripes' ? 0.9 : 0.5 },
    },
  });

  const height = mesh.max[1];
  const radius = Math.max(0.3, Math.max(mesh.max[0] - mesh.min[0], (mesh.max[2] - mesh.min[2]) * 0.55) * 0.5);
  const anim = quadClips(rig, spec);
  return {
    rig,
    parts: [{ name: 'body', geometry: mesh.geometry }],
    clips: anim.clips,
    hit: anim.hit,
    sockets: { head: 'head', hand_r: 'hand_r', hand_l: 'hand_l', back: 'back', muzzle: 'muzzle', chest: 'chest' },
    height,
    radius,
    palette: mesh.palette,
    verts: mesh.verts,
  };
}

// ---------------------------------------------------------------- animation

function quadClips(rig: Rig, spec: QuadSpec): { clips: AnimationClip[]; hit: Record<string, number> } {
  const heavy = clamp(spec.bulk, 0.8, 1.5);
  const L = ['l', 'r'] as const;
  const bodyH = 0.58 * spec.hgt;
  const halfW = 0.2 * spec.wid * spec.bulk;
  const side = hashString(spec.coat) & 1 ? 1 : -1;
  const TAU = Math.PI * 2;

  const tail = (p: Pose, u: number, amp: number, lift: number, freq = 1, phase = 0): void => {
    const a = TAU * u * freq + phase;
    p.r('tail1', -lift * 0.5, amp * 0.5 * Math.sin(a), 0);
    p.r('tail2', -lift * 0.5, amp * 0.7 * Math.sin(a - 0.8), 0);
    p.r('tail3', -lift * 0.4, amp * 0.9 * Math.sin(a - 1.6), 0);
  };
  const legs = (p: Pose, u: number, duty: number, ampF: number, ampH: number, flex: number, phF: number[], phH: number[], freq = 1): void => {
    L.forEach((sd, i) => {
      const f = legCycle(u * freq + (phF[i] as number), duty);
      p.r(`f${sd}_upper`, -f.swing * ampF, 0, 0);
      p.r(`f${sd}_lower`, f.lift * flex + 0.12 * (1 - f.swing) * 0.5, 0, 0);
      p.r(`hand_${sd}`, -f.lift * flex * 0.5 + f.swing * ampF * 0.35, 0, 0);
      const h = legCycle(u * freq + (phH[i] as number), duty);
      p.r(`b${sd}_upper`, -h.swing * ampH, 0, 0);
      p.r(`b${sd}_lower`, h.lift * flex * 1.2 + 0.1 * (1 - h.swing) * 0.5, 0, 0);
      p.r(`b${sd}_paw`, -h.lift * flex * 0.9 - h.swing * ampH * 0.2, 0, 0);
    });
  };

  const idle = (u: number, p: Pose): void => {
    const a = TAU * u;
    p.m('hips', 0, 0.004 * Math.sin(a), 0);
    p.r('spine', 0.015 * Math.sin(a), 0.02 * Math.sin(a + 1), 0);
    p.r('chest', -0.025 * Math.sin(a - 0.4), 0, 0);
    p.r('neck', -0.04 + 0.03 * Math.sin(a - 0.8), 0.08 * Math.sin(a * 0.5 + 0.5), 0);
    p.r('head', 0.02 * Math.sin(a - 1.2), 0.1 * Math.sin(a * 0.5 + 0.5), 0.03 * Math.sin(a));
    p.r('jaw', 0.03 + 0.03 * Math.max(0, Math.sin(a * 2 - 1)), 0, 0);
    const twitch = Math.max(0, Math.sin(a * 3 + 0.5) - 0.8) * 5;
    p.r('ear_l', -twitch * 0.25, 0, twitch * 0.2);
    p.r('ear_r', 0, 0, 0);
    tail(p, u, 0.25, 0.05, 1, 0);
    for (const sd of L) {
      p.r(`f${sd}_upper`, 0.02 * Math.sin(a), 0, 0);
      p.r(`f${sd}_lower`, 0.03, 0, 0);
    }
  };

  const walk = (u: number, p: Pose): void => {
    const a = TAU * u;
    legs(p, u, 0.64, 0.42, 0.38, 0.75, [0, 0.5], [0.5, 0], 1);
    p.m('hips', 0, 0.014 * Math.sin(a * 2 + 0.6), 0);
    p.r('hips', 0, -0.07 * Math.sin(a), 0.02 * Math.sin(a));
    p.r('spine', 0.02 * Math.sin(a * 2), 0.05 * Math.sin(a), 0);
    p.r('chest', 0.025 * Math.sin(a * 2 + 0.9), 0.04 * Math.sin(a), -0.02 * Math.sin(a));
    p.r('neck', -0.08 + 0.04 * Math.sin(a * 2 - 0.4), -0.09 * Math.sin(a), 0);
    p.r('head', 0.05 + 0.03 * Math.sin(a * 2), 0.05 * Math.sin(a), 0);
    p.r('jaw', 0.04, 0, 0);
    tail(p, u, 0.35, 0.1, 1, 0.5);
    p.r('ear_l', 0.03 * Math.sin(a * 2), 0, 0);
  };

  const run = (u: number, p: Pose): void => {
    const a = TAU * u;
    // bounding gait: front pair then hind pair, with spine flex
    legs(p, u, 0.42, 0.78, 0.82, 1.15, [0, 0.12], [0.5, 0.58], 1);
    const bound = Math.sin(a);
    p.m('root', 0, 0.045 * Math.abs(Math.sin(a + 0.4)) * heavy, 0);
    p.r('hips', 0.14 * bound, 0, 0);
    p.r('spine', -0.2 * bound, 0.03 * Math.sin(a * 2), 0);
    p.r('chest', -0.1 * bound, 0, 0);
    p.r('neck', -0.28 + 0.1 * Math.sin(a + 1), 0, 0);
    p.r('head', 0.12 - 0.06 * bound, 0, 0);
    p.r('jaw', 0.18 + 0.1 * Math.sin(a - 0.5), 0, 0);
    tail(p, u, 0.2, 0.55, 2, 0);
    p.r('ear_l', 0.25, 0, -0.15);
    p.r('ear_r', 0.25, 0, 0.15);
  };

  // --- attack: crouch, lunge, bite, recover. Contact at u = 0.5
  const attack = (u: number, p: Pose): void => {
    const crouch = curve(u, [[0, 0], [0.36, 1], [0.42, 0.85], [0.52, 0.1], [0.75, 0], [1, 0]]);
    const lunge = curve(u, [[0, 0], [0.38, 0], [0.5, 1], [0.62, 0.85], [0.85, 0.15], [1, 0]]);
    const jaw = curve(u, [[0, 0], [0.3, 0.25], [0.46, 1], [0.54, 0], [0.68, 0.05], [1, 0]]);
    p.m('root', 0, -0.05 * crouch * heavy, 0.3 * lunge - 0.06 * crouch);
    p.r('hips', 0.2 * crouch - 0.12 * lunge, 0, 0);
    p.r('spine', 0.08 * crouch - 0.2 * lunge, 0.1 * (lunge - crouch) * side, 0);
    p.r('chest', 0.22 * crouch - 0.12 * lunge, 0, 0);
    p.r('neck', -0.4 * crouch + 0.85 * lunge, 0.12 * lunge * side, 0);
    p.r('head', -0.1 * crouch + 0.25 * lunge, 0, 0);
    p.r('jaw', 1.05 * jaw, 0, 0);
    p.r('ear_l', 0.5 * crouch, 0, -0.4 * crouch);
    p.r('ear_r', 0.5 * crouch, 0, 0.4 * crouch);
    for (const sd of L) {
      p.r(`f${sd}_upper`, -0.55 * lunge + 0.3 * crouch, 0, 0);
      p.r(`f${sd}_lower`, 0.25 * crouch + 0.55 * lunge, 0, 0);
      p.r(`b${sd}_upper`, 0.45 * crouch - 0.5 * lunge, 0, 0);
      p.r(`b${sd}_lower`, -0.3 * crouch + 0.4 * lunge, 0, 0);
      p.r(`b${sd}_paw`, 0.2 * crouch - 0.3 * lunge, 0, 0);
    }
    tail(p, u, 0.15, 0.2 + 0.5 * lunge, 1, 0);
  };

  // --- attack2: rear up and maul down with both front paws. Contact at u = 0.55
  const attack2 = (u: number, p: Pose): void => {
    const rise = curve(u, [[0, 0], [0.42, 1], [0.5, 1], [0.6, 0.05], [0.8, 0], [1, 0]]);
    const slam = curve(u, [[0, 0], [0.45, 0], [0.56, 1], [0.7, 0.7], [1, 0]]);
    p.m('root', 0, 0.03 * rise, -0.1 * rise + 0.12 * slam);
    p.r('hips', 0.5 * rise - 0.2 * slam, 0, 0);
    p.r('spine', -0.55 * rise + 0.25 * slam, 0, 0);
    p.r('chest', -0.3 * rise + 0.3 * slam, 0, 0);
    p.r('neck', -0.3 * rise + 0.6 * slam, 0, 0);
    p.r('head', -0.1 * rise + 0.2 * slam, 0, 0);
    p.r('jaw', 0.8 * rise * (1 - slam) + 0.2 * slam, 0, 0);
    for (const sd of L) {
      const x = sd === 'l' ? -1 : 1;
      p.r(`f${sd}_upper`, -1.25 * rise + 1.5 * slam, 0, x * 0.25 * rise);
      p.r(`f${sd}_lower`, 0.9 * rise - 0.5 * slam, 0, 0);
      p.r(`hand_${sd}`, 0.3 * rise, 0, 0);
      p.r(`b${sd}_upper`, -0.45 * rise, 0, 0);
      p.r(`b${sd}_lower`, 0.45 * rise, 0, 0);
      p.r(`b${sd}_paw`, -0.15 * rise, 0, 0);
    }
    tail(p, u, 0.1, 0.4 * rise, 1, 0);
  };

  const hit = (u: number, p: Pose): void => {
    const k = curve(u, [[0, 0], [0.18, 1], [0.45, 0.25], [1, 0]]);
    p.m('root', 0, 0, -0.14 * k);
    p.r('hips', 0.14 * k, 0.1 * k, 0);
    p.r('spine', -0.24 * k, -0.18 * k, 0);
    p.r('chest', -0.22 * k, 0.1 * k, 0);
    p.r('neck', -0.4 * k, -0.15 * k, 0);
    p.r('head', -0.2 * k, 0, 0.15 * k);
    p.r('jaw', 0.5 * k, 0, 0);
    p.r('ear_l', 0.5 * k, 0, -0.4 * k);
    p.r('ear_r', 0.5 * k, 0, 0.4 * k);
    tail(p, u, 0, 0.6 * k, 1, 0);
    for (const sd of L) {
      p.r(`f${sd}_upper`, 0.25 * k, 0, 0);
      p.r(`b${sd}_upper`, -0.2 * k, 0, 0);
    }
  };

  // --- death: stagger, buckle, roll onto the side, settle. Static for the last 25%.
  const death = (u: number, p: Pose): void => {
    const stagger = curve(u, [[0, 0], [0.1, 1], [0.3, 0.4], [0.45, 0]]);
    const e = curve(u, [[0, 0], [0.2, 0], [0.55, 1], [0.62, 1.04], [0.72, 1]]);
    const roll = e * 1.5 * side;
    const cy = bodyH + (halfW - bodyH) * Math.min(e, 1);
    p.r('root', 0, 0, roll);
    // keep the body centre above ground while rolling
    p.m('root', bodyH * Math.sin(roll), cy - bodyH * Math.cos(roll), 0);
    p.m('root', 0, 0, -0.12 * stagger);
    p.r('hips', 0.1 * stagger, 0.15 * stagger, 0);
    p.r('spine', -0.2 * stagger + 0.18 * e, 0.2 * e, 0);
    p.r('neck', -0.35 * stagger - 0.2 * e, 0.3 * e * side, 0);
    p.r('head', 0.25 * e, 0.2 * e, 0.2 * e * side);
    p.r('jaw', 0.6 * Math.min(e, 1), 0, 0);
    p.r('ear_l', 0.6 * e, 0, -0.5 * e);
    p.r('ear_r', 0.6 * e, 0, 0.5 * e);
    tail(p, 0, 0.2, -0.2 * e, 1, 0);
    const stiff = e;
    p.r('fl_upper', -0.8 * stiff, 0, 0.2 * stiff);
    p.r('fr_upper', -0.35 * stiff, 0, -0.2 * stiff);
    p.r('fl_lower', 0.7 * stiff, 0, 0);
    p.r('fr_lower', 0.5 * stiff, 0, 0);
    p.r('bl_upper', -0.75 * stiff, 0, 0.15 * stiff);
    p.r('br_upper', 0.05 * stiff, 0, -0.15 * stiff);
    p.r('bl_lower', 0.8 * stiff, 0, 0);
    p.r('br_lower', 0.45 * stiff, 0, 0);
  };

  const spawn = (u: number, p: Pose): void => {
    const rise = curve(u, [[0, 0], [0.55, 1], [0.7, 1.02], [1, 1]]);
    const pop = curve(u, [[0, 0.25], [0.5, 1.12], [0.72, 0.98], [1, 1]]);
    p.m('root', 0, -0.55 * (1 - rise), 0);
    p.s('root', pop);
    p.r('root', -0.5 * (1 - rise), 0, 0);
    const shake = curve(u, [[0, 0], [0.55, 0], [0.7, 1], [0.85, -0.6], [1, 0]]);
    p.r('spine', 0, 0.12 * shake, 0);
    p.r('neck', -0.25 * (1 - rise) - 0.2 * shake, 0, 0);
    p.r('jaw', 0.5 * shake, 0, 0);
    tail(p, u, 0.3 * shake, 0, 2, 0);
  };

  // --- special1: head-back howl
  const howl = (u: number, p: Pose): void => {
    const k = curve(u, [[0, 0], [0.22, 1], [0.7, 1], [1, 0]]);
    const w = Math.sin(TAU * u * 5) * 0.05 * k;
    p.r('hips', 0.1 * k, 0, 0);
    p.r('spine', -0.2 * k, 0, 0);
    p.r('chest', -0.35 * k, 0, 0);
    p.r('neck', -0.9 * k, 0, w);
    p.r('head', -0.5 * k, 0, w);
    p.r('jaw', 0.75 * k, 0, 0);
    p.r('ear_l', 0.35 * k, 0, -0.25 * k);
    p.r('ear_r', 0.35 * k, 0, 0.25 * k);
    tail(p, u, 0.15 * k, 0.5 * k, 1, 0);
    for (const sd of L) {
      p.r(`f${sd}_upper`, 0.1 * k, 0, 0);
      p.r(`b${sd}_upper`, 0.1 * k, 0, 0);
    }
  };

  const specs: ClipSpec[] = [
    { name: 'idle', duration: 2.4, loop: true, fn: idle },
    { name: 'walk', duration: 0.95, loop: true, fn: walk },
    { name: 'run', duration: 0.52, loop: true, fn: run },
    { name: 'attack', duration: 0.85, loop: false, fn: attack, fps: 30 },
    { name: 'attack2', duration: 1.1, loop: false, fn: attack2, fps: 30 },
    { name: 'hit', duration: 0.42, loop: false, fn: hit, fps: 30 },
    { name: 'death', duration: 1.3, loop: false, fn: death, fps: 30 },
    { name: 'spawn', duration: 0.9, loop: false, fn: spawn, fps: 30 },
    { name: 'special1', duration: 2.0, loop: false, fn: howl },
  ];
  const clips = bakeClips(rig, specs, { posBones: ['root', 'hips'], scaleBones: ['root'] });
  return { clips, hit: { attack: 0.85 * 0.5, attack2: 1.1 * 0.56 } };
}

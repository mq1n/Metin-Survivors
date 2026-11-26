// DEV-only: shared humanoid anatomy for orcs, brutes, bosses and heroes. `layoutHuman` produces the rig (23 bones) and
// landmark positions (spec.H is the real standing height); `bodyPrims` adds the blended skin anatomy; `outfitPrims`
// layers clothes (slightly inflated prims whose colour wins on the surface). Characters face +Z, left side is +X.
import type { Vec3 } from './math';
import { Rig } from './rig';
import type { Shape } from './sdf';

export interface HumanSpec {
  /** standing height (m), measured to the top of the head */
  H: number;
  /** half distance between shoulder joints (m at H=1.82) */
  shoulder: number;
  /** half distance between hip joints (m at H=1.82) */
  hip: number;
  /** forward lean of the head relative to the pelvis, as a fraction of height */
  hunch: number;
  /** length multipliers */
  arm: number;
  leg: number;
  torso: number;
  neck: number;
  /** thickness multipliers */
  head: number;
  torsoW: number;
  torsoD: number;
  limb: number;
  legT: number;
  hand: number;
  foot: number;
  jaw: number;
  /** 0 = male build, 1 = female build (waist/hip/bust shaping) */
  fem: number;
  skin: string;
  skin2: string;
}

export const HUMAN_BASE: HumanSpec = {
  H: 1.8,
  shoulder: 0.2,
  hip: 0.095,
  hunch: 0,
  arm: 1,
  leg: 1,
  torso: 1,
  neck: 1,
  head: 1,
  torsoW: 1,
  torsoD: 1,
  limb: 1,
  legT: 1,
  hand: 1,
  foot: 1,
  jaw: 1,
  fem: 0,
  skin: '#c89a78',
  skin2: '#b0805f',
};

export interface Landmarks {
  spec: HumanSpec;
  /** metres per base unit (height / 1.82-model height) */
  u: number;
  hipY: number;
  P: (x: number, y: number, z: number) => Vec3;
  pelvis: Vec3;
  waist: Vec3;
  chest: Vec3;
  shoulderY: number;
  neckB: Vec3;
  neckT: Vec3;
  head: Vec3;
  headR: Vec3;
  sh: [Vec3, Vec3];
  el: [Vec3, Vec3];
  wr: [Vec3, Vec3];
  hd: [Vec3, Vec3];
  hipJ: [Vec3, Vec3];
  knee: [Vec3, Vec3];
  ankle: [Vec3, Vec3];
  toe: [Vec3, Vec3];
  // derived radii (metres)
  r: {
    chestW: number;
    chestD: number;
    chestH: number;
    waistW: number;
    waistD: number;
    pelvisW: number;
    pelvisD: number;
    arm: number;
    leg: number;
  };
}

export interface Layout {
  rig: Rig;
  L: Landmarks;
}

export const SIDES = [
  { n: 'l', s: 1 },
  { n: 'r', s: -1 },
] as const;

function landmarks(spec: HumanSpec, u: number): Landmarks {
  const legL = 0.9 * spec.leg * u;
  const hipY = legL;
  const lean = (y: number): number => spec.hunch * u * Math.pow(Math.max(0, (y - hipY) / (0.95 * u)), 1.6) * 1.6;
  const P = (x: number, y: number, z: number): Vec3 => [x, y, z + lean(y)];
  const tU = spec.torso * u;
  const pelvisY = hipY + 0.05 * u;
  const waistY = hipY + 0.18 * tU;
  const chestY = hipY + 0.37 * tU;
  const shY = hipY + 0.59 * tU;
  const neckBY = shY + 0.035 * u;
  const neckTY = neckBY + 0.09 * u * spec.neck;
  const hr = 0.105 * u * spec.head;
  const headY = neckTY + hr * 0.78;
  const sw = spec.shoulder * u;
  const hw = spec.hip * u;
  const ua = 0.29 * spec.arm * u;
  const fa = 0.27 * spec.arm * u;
  const pair = (f: (s: number) => Vec3): [Vec3, Vec3] => [f(1), f(-1)];
  const sh = pair((s) => P(s * sw, shY, 0));
  const el = pair((s) => {
    const o = sh[s > 0 ? 0 : 1];
    return [o[0] + s * ua * Math.sin(0.16), o[1] - ua * Math.cos(0.16), o[2] - 0.015 * u];
  });
  const wr = pair((s) => {
    const o = el[s > 0 ? 0 : 1];
    return [o[0] + s * fa * Math.sin(0.1), o[1] - fa * Math.cos(0.3), o[2] + fa * Math.sin(0.3)];
  });
  const hd = pair((s) => {
    const o = wr[s > 0 ? 0 : 1];
    return [o[0] + s * 0.012 * u, o[1] - 0.07 * u * spec.hand, o[2] + 0.025 * u];
  });
  const hipJ = pair((s) => P(s * hw, hipY, 0));
  const knee = pair((s) => P(s * hw * 0.95, hipY * 0.53, 0.015 * u));
  const ankle = pair((s) => P(s * hw * 0.9, 0.085 * u * spec.foot, -0.01 * u));
  const toe = pair((s) => P(s * hw * 0.95, 0.03 * u * spec.foot, 0.15 * u * spec.foot));
  const f = spec.fem;
  const r = {
    chestW: 0.168 * u * spec.torsoW * (1 - 0.1 * f),
    chestD: 0.115 * u * spec.torsoD,
    chestH: 0.17 * u * spec.torso,
    waistW: 0.125 * u * spec.torsoW * (1 - 0.14 * f),
    waistD: 0.1 * u * spec.torsoD,
    pelvisW: Math.max(hw * 1.3, 0.13 * u * spec.torsoW) * (1 + 0.12 * f),
    pelvisD: 0.105 * u * spec.torsoD,
    arm: 0.05 * u * spec.limb,
    leg: 0.088 * u * spec.legT,
  };
  return {
    spec,
    u,
    hipY,
    P,
    pelvis: P(0, pelvisY, 0),
    waist: P(0, waistY, 0),
    chest: P(0, chestY, 0),
    shoulderY: shY,
    neckB: P(0, neckBY, 0.01 * u),
    neckT: P(0, neckTY, 0.02 * u),
    head: P(0, headY, 0.025 * u),
    headR: [hr * 0.97, hr * 1.04, hr * 1.0],
    sh,
    el,
    wr,
    hd,
    hipJ,
    knee,
    ankle,
    toe,
    r,
  };
}

export function layoutHuman(spec: HumanSpec): Layout {
  // heights scale linearly with u, so one probe at u=1 gives the exact factor for the requested height
  const probe = landmarks(spec, 1);
  const top = probe.head[1] + probe.headR[1];
  const L = landmarks(spec, spec.H / top);
  const { u } = L;
  const hr = L.headR[1] / 1.05;
  const rig = new Rig();
  rig.add('root', null, [0, 0, 0]);
  rig.add('hips', 'root', L.pelvis);
  rig.add('spine', 'hips', L.waist);
  rig.add('chest', 'spine', L.chest);
  rig.add('neck', 'chest', L.neckB);
  rig.add('head', 'neck', L.neckT);
  rig.add('jaw', 'head', [L.head[0], L.head[1] - hr * 0.35, L.head[2] + hr * 0.1]);
  rig.add('muzzle', 'head', [L.head[0], L.head[1] - hr * 0.5, L.head[2] + hr * 0.95]);
  rig.add('back', 'chest', L.P(0, L.chest[1] + 0.06 * u, -L.r.chestD * 1.05));
  for (const { n, s } of SIDES) {
    const i = s > 0 ? 0 : 1;
    rig.add(`clav_${n}`, 'chest', L.P(L.sh[i][0] * 0.4, L.shoulderY, 0.0));
    rig.add(`uarm_${n}`, `clav_${n}`, L.sh[i]);
    rig.add(`farm_${n}`, `uarm_${n}`, L.el[i]);
    rig.add(`hand_${n}`, `farm_${n}`, L.wr[i]);
  }
  for (const { n, s } of SIDES) {
    const i = s > 0 ? 0 : 1;
    rig.add(`thigh_${n}`, 'hips', L.hipJ[i]);
    rig.add(`shin_${n}`, `thigh_${n}`, L.knee[i]);
    rig.add(`foot_${n}`, `shin_${n}`, L.ankle[i]);
  }
  return { rig, L };
}

function lerp3(a: Vec3, c: Vec3, t: number): Vec3 {
  return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
}

/** Skin anatomy: pelvis, abdomen, chest, shoulder yoke, neck, head, arms, legs. */
export function bodyPrims(shape: Shape, lay: Layout, opts: { bust?: number } = {}): void {
  const { rig, L } = lay;
  const sp = L.spec;
  const u = L.u;
  const r = L.r;
  const I = (n: string): number => rig.i(n);
  const skin = sp.skin;
  const skin2 = sp.skin2;
  const P = L.P;
  const sw = L.sh[0][0];
  const bt = Math.sqrt(sp.limb);

  // limbs first with tight blends (legs/arms stay separate shapes), then the torso blends into them with larger k
  for (const { n, s } of SIDES) {
    const i = s > 0 ? 0 : 1;
    shape.rc(I(`thigh_${n}`), L.hipJ[i], L.knee[i], r.leg, r.leg * 0.68, { k: 0.03, color: skin });
    shape.rc(I(`shin_${n}`), L.knee[i], L.ankle[i], r.leg * 0.66, r.leg * 0.43, { k: 0.05, color: skin });
    shape.rc(I(`foot_${n}`), [L.ankle[i][0], L.ankle[i][1] - 0.01 * u, L.ankle[i][2] - 0.01 * u], L.toe[i], 0.044 * u * Math.sqrt(sp.foot * sp.legT), 0.034 * u * sp.foot, { k: 0.04, color: skin2 });
  }
  for (const { n, s } of SIDES) {
    const i = s > 0 ? 0 : 1;
    shape.ell(I(`uarm_${n}`), L.sh[i], [0.066 * u * bt, 0.075 * u * bt, 0.066 * u * bt], { k: 0.04, color: skin });
    shape.rc(I(`uarm_${n}`), L.sh[i], L.el[i], r.arm * 1.05, r.arm * 0.84, { k: 0.05, color: skin });
    shape.rc(I(`farm_${n}`), L.el[i], L.wr[i], r.arm * 0.88, r.arm * 0.68, { k: 0.04, color: skin });
    const hs = sp.hand;
    shape.ell(I(`hand_${n}`), L.hd[i], [0.038 * u * hs, 0.062 * u * hs, 0.028 * u * hs], { k: 0.035, color: skin2 });
    shape.rc(I(`hand_${n}`), [L.wr[i][0] - s * 0.025 * u * hs, L.wr[i][1] - 0.03 * u, L.wr[i][2] + 0.02 * u], [L.hd[i][0] - s * 0.03 * u * hs, L.hd[i][1] - 0.01 * u, L.hd[i][2] + 0.035 * u * hs], 0.015 * u * hs, 0.011 * u * hs, { k: 0.02, color: skin2 });
  }
  shape.ell(I('hips'), L.pelvis, [r.pelvisW, 0.115 * u, r.pelvisD], { k: 0.08, color: skin });
  shape.rc(I('spine'), P(0, L.hipY + 0.07 * u, 0), P(0, L.chest[1] - 0.07 * u, 0), r.waistW, r.waistW * 1.1, { k: 0.09, color: skin, skin: 1 });
  shape.ell(I('chest'), L.chest, [r.chestW, r.chestH, r.chestD], { k: 0.09, color: skin });
  shape.ell(I('chest'), P(0, L.chest[1] + 0.09 * u, -0.01 * u), [r.chestW * 0.96, 0.1 * u, r.chestD * 0.95], { k: 0.08, color: skin });
  // shoulder yoke + trapezius so the shoulder line reads straight with sloped neck-to-shoulder
  shape.rc(I('chest'), P(-sw * 0.82, L.shoulderY - 0.012 * u, -0.005 * u), P(sw * 0.82, L.shoulderY - 0.012 * u, -0.005 * u), 0.056 * u * bt, 0.056 * u * bt, { k: 0.07, color: skin });
  for (const { s } of SIDES) {
    shape.rc(I('chest'), P(s * 0.035 * u, L.neckB[1] - 0.01 * u, -0.015 * u), P(s * sw * 0.75, L.shoulderY - 0.005 * u, -0.015 * u), 0.046 * u * bt, 0.05 * u * bt, { k: 0.06, color: skin });
  }
  if (opts.bust) {
    for (const s of [1, -1]) shape.sph(I('chest'), P(s * 0.062 * u, L.chest[1] + 0.02 * u, r.chestD * 0.85), 0.052 * u * opts.bust, { k: 0.05, color: skin });
  }
  // neck + head
  const nr = 0.05 * u * Math.sqrt(sp.torsoW * bt);
  shape.rc(I('neck'), L.neckB, L.neckT, nr * 1.2, nr, { k: 0.05, color: skin });
  shape.ell(I('head'), L.head, L.headR, { k: 0.05, color: skin });
  shape.ell(I('jaw'), [L.head[0], L.head[1] - L.headR[1] * 0.44, L.head[2] + L.headR[2] * 0.2], [L.headR[0] * 0.8 * sp.jaw, L.headR[1] * 0.5 * sp.jaw, L.headR[2] * 0.82], { k: 0.05, color: skin });
}

export interface Outfit {
  /** torso garment */
  top?: { color: string; trim?: string; sleeves: 'none' | 'short' | 'long'; cuff?: string; coverage?: number; bust?: number };
  /** legs */
  pants?: { color: string; length: 'shorts' | 'knee' | 'full'; trim?: string; baggy?: number };
  boots?: { color: string; height: number; trim?: string };
  gloves?: { color: string; length: number };
  belt?: { color: string; buckle?: string };
  /** long coat / robe panel hanging from the waist */
  coat?: { color: string; length: number; flare: number; trim?: string };
  /** collar / scarf at the neck */
  collar?: { color: string; height?: number };
}

/** Clothes as inflated overlays; the nearest prim colour wins, so garments read as separate layers. */
export function outfitPrims(shape: Shape, lay: Layout, o: Outfit): void {
  const { rig, L } = lay;
  const u = L.u;
  const sp = L.spec;
  const r = L.r;
  const I = (n: string): number => rig.i(n);
  const P = L.P;
  const g = 0.013 * u; // garment thickness
  const sw = L.sh[0][0];
  const bt = Math.sqrt(sp.limb);

  if (o.top) {
    const t = o.top;
    const cov = t.coverage ?? 1;
    shape.ell(I('chest'), L.chest, [r.chestW + g, r.chestH + g, r.chestD + g], { k: 0.07, color: t.color, cw: 3 });
    shape.ell(I('chest'), P(0, L.chest[1] + 0.09 * u, -0.01 * u), [r.chestW * 0.96 + g, 0.1 * u + g, r.chestD * 0.95 + g], { k: 0.06, color: t.color, cw: 3 });
    shape.rc(I('chest'), P(-sw * 0.82, L.shoulderY - 0.012 * u, -0.005 * u), P(sw * 0.82, L.shoulderY - 0.012 * u, -0.005 * u), 0.056 * u * bt + g, 0.056 * u * bt + g, { k: 0.06, color: t.color, cw: 3 });
    shape.rc(I('spine'), P(0, L.hipY + 0.07 * u + (1 - cov) * 0.1 * u, 0), P(0, L.chest[1] - 0.07 * u, 0), r.waistW + g, r.waistW * 1.1 + g, { k: 0.06, color: t.color, cw: 3 });
    if (t.bust) {
      for (const s of [1, -1]) shape.sph(I('chest'), P(s * 0.062 * u, L.chest[1] + 0.02 * u, r.chestD * 0.85), 0.052 * u * t.bust + g, { k: 0.04, color: t.color, cw: 3 });
    }
    if (t.trim) {
      shape.ell(I('spine'), P(0, L.hipY + 0.05 * u + (1 - cov) * 0.1 * u, 0), [r.waistW * 1.4, 0.016 * u, r.waistD * 1.5], { op: 'paint', color: t.trim, soft: 0.006 });
    }
    for (const { n, s } of SIDES) {
      const i = s > 0 ? 0 : 1;
      if (t.sleeves !== 'none') {
        const sleeveEnd = t.sleeves === 'long' ? 0.98 : 0.5;
        shape.ell(I(`uarm_${n}`), L.sh[i], [0.066 * u * bt + g, 0.075 * u * bt + g, 0.066 * u * bt + g], { k: 0.05, color: t.color, cw: 3 });
        shape.rc(I(`uarm_${n}`), L.sh[i], L.el[i], r.arm * 1.05 + g, r.arm * 0.84 + g, { k: 0.04, color: t.color, cw: 3 });
        const end = lerp3(L.el[i], L.wr[i], sleeveEnd);
        shape.rc(I(`farm_${n}`), L.el[i], end, r.arm * 0.88 + g, r.arm * (0.88 - 0.2 * sleeveEnd) + g, { k: 0.04, color: t.color, cw: 3 });
        if (t.cuff) {
          const a = lerp3(L.el[i], L.wr[i], sleeveEnd - 0.14);
          shape.rc(I(`farm_${n}`), a, end, 0.06 * u, 0.06 * u, { op: 'paint', color: t.cuff, soft: 0.006 });
        }
      }
    }
  }
  if (o.pants) {
    const p = o.pants;
    const len = p.length === 'shorts' ? 0.42 : p.length === 'knee' ? 0.82 : 1;
    const baggy = p.baggy ?? 0;
    for (const { n, s } of SIDES) {
      const i = s > 0 ? 0 : 1;
      const kneeEnd = lerp3(L.hipJ[i], L.knee[i], Math.min(1, len));
      shape.rc(I(`thigh_${n}`), L.hipJ[i], kneeEnd, r.leg + g + baggy * 0.01, r.leg * (1 - 0.32 * Math.min(1, len)) + g + baggy * 0.015, { k: 0.03, color: p.color, cw: 3 });
      if (p.length === 'full') {
        const shinEnd = lerp3(L.knee[i], L.ankle[i], 0.9);
        shape.rc(I(`shin_${n}`), L.knee[i], shinEnd, r.leg * 0.66 + g + baggy * 0.014, r.leg * 0.45 + g + baggy * 0.02, { k: 0.04, color: p.color, cw: 3 });
      }
      if (p.trim) {
        const a = lerp3(L.knee[i], L.ankle[i], 0.62);
        shape.rc(I(`shin_${n}`), a, lerp3(L.knee[i], L.ankle[i], 0.7), 0.09 * u, 0.09 * u, { op: 'paint', color: p.trim, soft: 0.005 });
      }
    }
    shape.ell(I('hips'), L.pelvis, [r.pelvisW + g, 0.115 * u + g, r.pelvisD + g], { k: 0.05, color: p.color, cw: 3 });
  }
  if (o.boots) {
    const bt2 = o.boots;
    for (const { n, s } of SIDES) {
      const i = s > 0 ? 0 : 1;
      const top = lerp3(L.ankle[i], L.knee[i], bt2.height);
      shape.rc(I(`shin_${n}`), L.ankle[i], top, r.leg * 0.45 + g * 1.5, r.leg * (0.45 + 0.18 * bt2.height) + g * 1.5, { k: 0.03, color: bt2.color, cw: 4 });
      shape.rc(I(`foot_${n}`), [L.ankle[i][0], L.ankle[i][1] - 0.01 * u, L.ankle[i][2] - 0.01 * u], L.toe[i], 0.044 * u * Math.sqrt(sp.foot * sp.legT) + g, 0.034 * u * sp.foot + g, { k: 0.03, color: bt2.color, cw: 4 });
      if (bt2.trim) {
        shape.rc(I(`shin_${n}`), lerp3(L.ankle[i], L.knee[i], bt2.height - 0.1), top, 0.09 * u, 0.09 * u, { op: 'paint', color: bt2.trim, soft: 0.005 });
      }
    }
  }
  if (o.gloves) {
    const gl = o.gloves;
    const hs = sp.hand;
    for (const { n, s } of SIDES) {
      const i = s > 0 ? 0 : 1;
      shape.ell(I(`hand_${n}`), L.hd[i], [0.038 * u * hs + g, 0.062 * u * hs + g, 0.028 * u * hs + g], { k: 0.03, color: gl.color, cw: 4 });
      if (gl.length > 0) {
        shape.rc(I(`farm_${n}`), lerp3(L.wr[i], L.el[i], gl.length), L.wr[i], r.arm * 0.74 + g, r.arm * 0.68 + g, { k: 0.03, color: gl.color, cw: 4 });
      }
    }
  }
  if (o.coat) {
    const c = o.coat;
    const top = P(0, L.hipY + 0.1 * u, 0);
    const bottomY = L.hipY - c.length * L.hipY * 0.95;
    for (const { n, s } of SIDES) {
      const i = s > 0 ? 0 : 1;
      const end = lerp3(L.hipJ[i], L.ankle[i], c.length);
      shape.rc(I(`thigh_${n}`), [L.hipJ[i][0] * 0.7, L.hipJ[i][1] + 0.02 * u, 0.0], [end[0] + s * 0.05 * c.flare * u, end[1], end[2] + 0.02 * u], 0.12 * u * sp.legT + g, (0.115 + 0.05 * c.flare) * u * sp.legT + g, {
        k: 0.05,
        color: c.color,
        cw: 3,
        sigma: 0.09,
      });
    }
    shape.rc(I('hips'), top, P(0, bottomY + 0.12 * u, 0), r.pelvisW + g, r.pelvisW * (1.25 + 0.2 * c.flare) + g, { k: 0.06, color: c.color, cw: 3, sigma: 0.08 });
    if (c.trim) {
      shape.ell(I('hips'), P(0, bottomY + 0.045 * u, 0), [0.7 * u, 0.04 * u, 0.7 * u], { op: 'paint', color: c.trim, soft: 0.006 });
    }
  }
  if (o.belt) {
    const bl = o.belt;
    shape.ell(I('spine'), P(0, L.hipY + 0.08 * u, 0), [r.waistW * 1.45 + g, 0.028 * u, r.waistD * 1.5 + g], { op: 'paint', color: bl.color, soft: 0.007 });
    if (bl.buckle) shape.sph(I('spine'), P(0, L.hipY + 0.08 * u, r.waistD * 1.15 + g), 0.034 * u, { op: 'paint', color: bl.buckle, soft: 0.005 });
  }
  if (o.collar) {
    const c = o.collar;
    const nr = 0.05 * u * Math.sqrt(sp.torsoW * bt);
    shape.rc(I('neck'), L.neckB, P(0, L.neckB[1] + 0.05 * u * (c.height ?? 1), 0.01 * u), nr * 1.2 + g, nr * 1.1 + g, { k: 0.03, color: c.color, cw: 4 });
  }
}

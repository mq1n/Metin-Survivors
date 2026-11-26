// Weapon-style data for orcs and monks (OrcStyle = idle carry pose + attacks + gait tuning). Chest frame, reference metres.
import { type Key, type Pose, V, basePose } from '../humanoid/index.ts';
import { type Hand, type OrcStyle, gp, grip } from './anim.ts';

type V3 = [number, number, number];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** blade direction and edge direction for a chop in the sagittal plane: `elev` = blade elevation above the horizontal (rad; > pi/2 = tipping back),
 *  `yaw` swings the whole plane toward +X (left) */
export function chopAxes(elev: number, yaw = 0): { b: V3; edge: V3 } {
  const b: V3 = [Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev)];
  const e: V3 = [Math.sin(yaw) * Math.sin(elev), -Math.cos(elev), Math.cos(yaw) * Math.sin(elev)];
  // e currently = (0,-cos,sin) rotated by yaw about Y
  return { b: norm(b), edge: norm([e[0], e[1], e[2]]) };
}

/** blade direction and edge direction for a horizontal-ish sweep: `yaw` swings the blade from forward (0) toward +X (left); `dir` = +1 travel toward the left, -1 toward the right */
export function sweepAxes(yaw: number, elev = 0, dir: 1 | -1 = 1): { b: V3; edge: V3 } {
  const b: V3 = [Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev)];
  const e: V3 = [dir * Math.cos(yaw), 0, -dir * Math.sin(yaw)];
  return { b: norm(b), edge: norm(e) };
}

export const stance = (width: number, fwd: number, drop: number): Partial<Pose> => ({ fl: V(width, 0, fwd), fr: V(-width, 0, -fwd), root: V(0, -drop, 0) });

/**
 * hand holding a weapon whose CUTTING EDGE faces `edge` (made orthogonal to the blade). Unlike `grip()` the edge is not negated: the
 * solver's `e` is the weapon's +Z (edge) axis, so `grip(.., edge)` ends up with the edge pointing the opposite way.
 */
const holdE = (g: V3, blade: V3, edge: V3, c = 1): Hand => {
  const b = norm(blade);
  const d = edge[0] * b[0] + edge[1] * b[1] + edge[2] * b[2];
  return { g, b, e: norm([edge[0] - b[0] * d, edge[1] - b[1] * d, edge[2] - b[2] * d]), c };
};
/** the same as a Key patch (any of grip point / blade / edge / curl) */
const patchE = (g?: V3, blade?: V3, edge?: V3, c?: number): Partial<Hand> => {
  const out: Partial<Hand> = {};
  if (g) out.g = g;
  if (blade) out.b = norm(blade);
  if (edge) {
    const b = norm(blade ?? [0, 0, 1]);
    const d = edge[0] * b[0] + edge[1] * b[1] + edge[2] * b[2];
    out.e = norm([edge[0] - b[0] * d, edge[1] - b[1] * d, edge[2] - b[2] * d]);
  }
  if (c !== undefined) out.c = c;
  return out;
};
/** relaxed free hand (left): grip point, forward axis, back-of-hand axis, curl */
const freeHand = (g: V3, b: V3, c: number, e: V3 = [1, 0, 0]): Hand => ({ g, b: norm(b), e: norm(e), c });

/** one-handed heavy cleaver: held out to the right front (blade up and forward so the broad face reads from above), a slow overhead chop */
export function cleaverStyle(): OrcStyle {
  const rest = chopAxes(0.95, -0.45);
  const idle: Pose = Object.assign(basePose(), stance(0.15, 0.08, 0.06), {
    sp: [0.1, -0.16, 0.02] as V3,
    hip: [0, 0.12, 0] as V3,
    head: [-0.1, 0.08, 0] as V3,
    r: holdAxe(V(-0.4, -0.18, 0.34), rest.b, rest.edge, 1),
    poleR: V(-0.6, -0.7, -0.5),
    l: freeHand(V(0.36, -0.3, 0.2), V(0.1, -0.2, 1), 0.5),
  });
  const up = chopAxes(2.7), top = chopAxes(2.95), hit = chopAxes(0.05), low = chopAxes(-0.85);
  const attack: Key[] = [
    { t: 0, p: {} },
    { t: 0.14, ease: 'out', p: { r: patchAxe(V(-0.25, 0.4, -0.08), up.b, up.edge), sp: [-0.04, -0.45, 0.05], hip: [0, -0.3, 0], root: V(0, -0.06, -0.07), fl: V(0.15, 0, 0.02), fr: V(-0.15, 0, -0.2), l: patchE(V(0.34, 0.1, 0.22), V(0.2, 0.2, 1), V(1, 0, 0)) } },
    { t: 0.32, ease: 'smooth', p: { r: patchAxe(V(-0.2, 0.52, -0.16), top.b, top.edge), sp: [-0.22, -0.6, 0.06], root: V(0, -0.04, -0.09), head: [-0.2, 0.1, 0] } },
    { t: 0.5, ease: 'in', p: { r: patchAxe(V(-0.04, -0.08, 0.55), hit.b, hit.edge), sp: [0.36, 0.42, -0.05], hip: [0, 0.4, 0], root: V(0, -0.2, 0.22), fl: V(0.15, 0, 0.38), fr: V(-0.15, 0, -0.2), head: [0.14, 0, 0], l: patchE(V(0.34, -0.18, 0.0)) } },
    { t: 0.66, ease: 'out', p: { r: patchAxe(V(0.08, -0.34, 0.46), low.b, low.edge), sp: [0.45, 0.5, -0.03], root: V(0, -0.24, 0.24) } },
    { t: 1.1, ease: 'smooth', p: { ...idle } },
  ];
  return { cfg: {}, idle, attack, attackDur: 1.1, attackHit: 0.5, weight: 1.1 };
}

/** quick savage hatchet work: low ready guard in front, long claw arm hanging, a fast lunge-and-chop */
export function hatchetStyle(): OrcStyle {
  const ready = chopAxes(0.85, -0.3);
  const idle: Pose = Object.assign(basePose(), stance(0.17, 0.12, 0.1), {
    sp: [0.14, -0.18, 0] as V3,
    head: [-0.2, 0.05, 0] as V3,
    hip: [0, 0.12, 0] as V3,
    r: holdAxe(V(-0.38, -0.3, 0.4), ready.b, ready.edge, 1),
    poleR: V(-0.6, -0.6, -0.5),
    l: freeHand(V(0.36, -0.6, 0.12), V(0, 0, 1), 0.3),
  });
  const hiBack = chopAxes(2.0, -0.1), strike = chopAxes(0.1), low = chopAxes(-0.7);
  const attack: Key[] = [
    { t: 0, p: {} },
    { t: 0.2, ease: 'out', p: { r: patchAxe(V(-0.26, 0.42, -0.05), hiBack.b, hiBack.edge), sp: [-0.08, -0.6, 0.05], hip: [0, -0.4, 0], root: V(0, -0.03, -0.1), fl: V(0.15, 0, 0.04), fr: V(-0.15, 0, -0.22), l: patchE(V(0.36, 0.08, 0.26), V(0.2, 0.3, 1), V(1, 0, 0), 0.1) } },
    { t: 0.36, ease: 'in', p: { r: patchAxe(V(-0.04, -0.12, 0.52), strike.b, strike.edge), sp: [0.38, 0.5, -0.05], hip: [0, 0.42, 0], root: V(0, -0.17, 0.3), fl: V(0.15, 0, 0.42), fr: V(-0.15, 0, -0.14), head: [0.1, 0, 0], l: patchE(V(0.3, -0.2, 0.1), undefined, undefined, 0.5) } },
    { t: 0.52, ease: 'out', p: { r: patchAxe(V(0.05, -0.3, 0.46), low.b, low.edge), sp: [0.44, 0.55, 0], root: V(0, -0.2, 0.3) } },
    { t: 0.85, ease: 'smooth', p: { ...idle } },
  ];
  return { cfg: {}, idle, attack, attackDur: 0.85, attackHit: 0.36, weight: 0.85, gait: { walk: { T: 0.86, sweep: 0.5, lean: 0.12 }, run: { T: 0.56, sweep: 0.8, lean: 0.3 } } };
}

/** commander's sabre: upright ready guard (blade up beside the body so it reads from behind), hand on hip, a wide right-side wind-up and one sweeping slash with the cutting edge leading */
export function slashStyle(): OrcStyle {
  // the sabre is built rolled (see `scimitar`): its flat faces are the weapon +Z axis and the cutting edge the weapon +X axis, so the solver's
  // edge axis is cross(cutting edge, blade)
  const roll = (blade: V3, edge: V3): V3 => {
    const b = norm(blade);
    return [edge[1] * b[2] - edge[2] * b[1], edge[2] * b[0] - edge[0] * b[2], edge[0] * b[1] - edge[1] * b[0]];
  };
  const hold = (g: V3, b: V3, edge: V3, c = 1): Hand => holdE(g, b, roll(b, edge), c);
  const patch = (g: V3 | undefined, b: V3, edge: V3): Partial<Hand> => patchE(g, b, roll(b, edge));
  const rest: V3 = norm([-0.22, 0.92, 0.32]);
  const idle: Pose = Object.assign(basePose(), stance(0.17, 0.08, 0.05), {
    sp: [0.04, -0.14, 0] as V3,
    hip: [0, 0.1, 0] as V3,
    r: hold(V(-0.36, -0.16, 0.34), rest, [-1, 0, 0.1]),
    l: freeHand(V(0.3, -0.34, 0.1), V(0, -0.2, 1), 0.5),
  });
  // `sweepAxes(...).edge` is the direction the blade travels: the cutting edge leads the swing
  const w0 = sweepAxes(-1.25, 0.5);
  const s0 = sweepAxes(0.7, 0.1);
  const s1 = sweepAxes(1.5, -0.3);
  const attack: Key[] = [
    { t: 0, p: {} },
    { t: 0.36, ease: 'out', p: { r: patch(V(-0.42, 0.1, -0.1), w0.b, w0.edge), sp: [0.0, -0.75, 0.1], hip: [0, -0.5, 0], root: V(0, -0.05, -0.1), fl: V(0.17, 0, 0.02), fr: V(-0.17, 0, -0.15), l: freeHand(V(0.34, 0.0, 0.3), V(0, 0.3, 1), 0.3) } },
    { t: 0.5, ease: 'in', p: { r: patch(V(-0.02, -0.02, 0.5), s0.b, s0.edge), sp: [0.12, 0.55, -0.05], hip: [0, 0.42, 0], root: V(0, -0.1, 0.2), fl: V(0.17, 0, 0.32), fr: V(-0.17, 0, -0.06), l: freeHand(V(0.28, -0.3, 0.1), V(0, 0.1, 1), 0.6) } },
    { t: 0.66, ease: 'out', p: { r: patch(V(0.22, -0.08, 0.3), s1.b, s1.edge), sp: [0.16, 0.7, 0] } },
    { t: 1.2, ease: 'smooth', p: { ...idle } },
  ];
  return { cfg: {}, idle, attack, attackDur: 1.2, attackHit: 0.5, weight: 1.0, gait: { walk: { T: 1.1, sweep: 0.55 }, run: { T: 0.72 } } };
}

/** shaman with a tall totem staff: planted carry (the skull faces forward), free hand conjuring; the attack raises the staff beside the head, then drives the skull at the target while the free hand blasts a spell */
export function staffStyle(): OrcStyle {
  const face: V3 = [0, 0, 1];
  const up = norm([0.04, 1, 0.14]);
  const idle: Pose = Object.assign(basePose(), stance(0.15, 0.06, 0.05), {
    sp: [0.12, -0.1, 0] as V3,
    head: [-0.1, 0.05, 0] as V3,
    r: holdE(V(-0.3, -0.06, 0.28), up, face, 1),
    l: freeHand(V(0.26, -0.14, 0.36), V(0, 0.45, 1), 0.3, V(0, -1, 0)),
  });
  const raised = norm([0.12, 1, -0.2]);
  const thrust = norm([0.0, 0.62, 0.78]);
  const attack: Key[] = [
    { t: 0, p: {} },
    { t: 0.32, ease: 'out', p: { r: patchE(V(-0.3, 0.34, 0.1), raised, face), sp: [-0.28, -0.22, 0.06], head: [-0.3, 0, 0], root: V(0, -0.02, -0.08), fl: V(0.15, 0, 0.02), fr: V(-0.15, 0, -0.1), l: freeHand(V(0.26, 0.2, 0.2), V(0, 0.9, 0.5), 0.1, V(0, -0.5, -0.85)), shl: 0.14 } },
    { t: 0.55, ease: 'in', p: { r: patchE(V(-0.3, 0.1, 0.55), thrust, face), sp: [0.12, 0.1, 0], head: [0.08, 0, 0], root: V(0, -0.07, 0.14), fl: V(0.15, 0, 0.14), fr: V(-0.15, 0, -0.04), l: freeHand(V(0.2, 0.2, 0.62), V(0, 0.85, 0.5), 0.0, V(0, -0.5, -0.85)) } },
    { t: 0.85, ease: 'smooth', p: { root: V(0, -0.05, 0.1), l: freeHand(V(0.2, 0.22, 0.6), V(0, 0.85, 0.5), 0.0, V(0, -0.5, -0.85)) } },
    { t: 1.3, ease: 'smooth', p: { ...idle } },
  ];
  return { cfg: {}, idle, attack, attackDur: 1.3, attackHit: 0.55, weight: 0.8, spawnRoar: true, gait: { walk: { T: 1.1, sweep: 0.46 }, run: { T: 0.74, sweep: 0.8 } } };
}

/**
 * solver `e` for weapons whose cutting edge lies along weapon +X (hatchet, cleaver: blade plane = weapon Y/X): the solver pins weapon +Z
 * (hand -X) to `e`, and weapon +X = blade x e, so a world edge direction E needs e = E x blade (E made orthogonal to the blade first).
 */
const axeE = (blade: V3, edge: V3): V3 => {
  const b = norm(blade);
  const d = edge[0] * b[0] + edge[1] * b[1] + edge[2] * b[2];
  const E = norm([edge[0] - b[0] * d, edge[1] - b[1] * d, edge[2] - b[2] * d]);
  return norm([E[1] * b[2] - E[2] * b[1], E[2] * b[0] - E[0] * b[2], E[0] * b[1] - E[1] * b[0]]);
};
/** right hand holding an axe-type weapon: grip point, blade (tip) direction, cutting-edge direction, curl */
const holdAxe = (g: V3, blade: V3, edge: V3, c = 1): Hand => ({ g, b: norm(blade), e: axeE(blade, edge), c });
/** the same as a Key patch (blade must be given together with the edge) */
const patchAxe = (g?: V3, blade?: V3, edge?: V3, c?: number): Partial<Hand> => ({
  ...(g ? { g } : {}), ...(blade ? { b: norm(blade) } : {}), ...(blade && edge ? { e: axeE(blade, edge) } : {}), ...(c !== undefined ? { c } : {}),
});

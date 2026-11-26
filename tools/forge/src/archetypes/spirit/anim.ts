// Spirit clip sets. Floating forms: no foot IK, so the motion language is hover bob, lean into travel, trailing chains
// (robes / flames / tatters lag the body with travelling waves), orbiting bits, and torso-relative two-bone arm reaches.
import type { ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import { bump, damped, ramp } from '../../core/anim/curve.ts';
import { aimQuat, localFromWorld, twoBoneIK } from '../../core/anim/ik.ts';
import { cwave, wave } from '../../core/anim/quadruped.ts';
import { type Vec3, deg, qaxis, qrotate, vadd, vdist, vsub } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { FireAnatomy } from './fire.ts';
import type { IceAnatomy } from './ice.ts';

const TAU = Math.PI * 2;

/** helpers bound to one skeleton */
export class Rig {
  constructor(readonly skel: Skeleton, readonly s: number) {}

  set(c: PoseCtx, bone: string, x = 0, y = 0, z = 0): void {
    if (this.skel.has(bone)) c.set(bone, x, y, z);
  }
  move(c: PoseCtx, bone: string, x = 0, y = 0, z = 0): void {
    if (this.skel.has(bone)) c.move(bone, x, y, z);
  }
  /** tilt a DOWN-hanging bone's tip toward the horizontal direction (vx, vz) (small-angle: displacement ~ angle) */
  tilt(c: PoseCtx, bone: string, vx: number, vz: number): void {
    const a = Math.hypot(vx, vz);
    if (a < 1e-6 || !this.skel.has(bone)) return;
    c.setQ(bone, qaxis([-vz, 0, vx], a));
  }
  /** same for an UP-pointing bone (hair, crown horns) */
  tiltUp(c: PoseCtx, bone: string, vx: number, vz: number): void {
    const a = Math.hypot(vx, vz);
    if (a < 1e-6 || !this.skel.has(bone)) return;
    c.setQ(bone, qaxis([vz, 0, -vx], a));
  }
  /**
   * Move the hand of `side` to `rest hand + off` (rest space, torso-relative: the target follows the chest) with a two-bone IK solve.
   * Call after the spine / chest bones are posed.
   */
  reach(c: PoseCtx, side: 'l' | 'r', off: Vec3, pole: Vec3, handEuler: Vec3 = [0, 0, 0], parent = 'chest'): void {
    const sk = this.skel;
    const upper = `arm_${side}`, lower = `forearm_${side}`, hand = `hand_${side}`;
    if (!sk.has(upper)) return;
    const p0 = sk.restPos(upper), p1 = sk.restPos(lower), p2 = sk.restPos(hand);
    const l1 = vdist(p0, p1), l2 = vdist(p1, p2);
    const w = sk.fk(c.pose);
    const pr = w.rot[sk.idx(parent)]!;
    const P0 = w.pos[sk.idx(upper)]!;
    const chestW = w.pos[sk.idx(parent)]!;
    const chestRest = sk.restPos(parent);
    const target = vadd(chestW, qrotate(pr, vsub(vadd(p2, off), chestRest)));
    // pole = the rest elbow's offset from the shoulder->wrist line, so IK keeps the authored elbow side (`pole` is only a fallback)
    const axis = vsub(p2, p0);
    const axLen2 = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];
    const e0 = vsub(p1, p0);
    const k = (e0[0] * axis[0] + e0[1] * axis[1] + e0[2] * axis[2]) / axLen2;
    const rp: Vec3 = [e0[0] - axis[0] * k, e0[1] - axis[1] * k, e0[2] - axis[2] * k];
    const poleW = qrotate(pr, Math.hypot(rp[0], rp[1], rp[2]) > 0.01 ? rp : pole);
    const { mid, end } = twoBoneIK(P0, target, l1, l2, poleW);
    const side3: Vec3 = qrotate(pr, [1, 0, 0]);
    const rUpper = aimQuat(vsub(p1, p0), [1, 0, 0], vsub(mid, P0), side3);
    const rLower = aimQuat(vsub(p2, p1), [1, 0, 0], vsub(end, mid), side3);
    c.pose.rot[sk.idx(upper)] = localFromWorld(pr, rUpper);
    c.pose.rot[sk.idx(lower)] = localFromWorld(rUpper, rLower);
    c.set(hand, handEuler[0], handEuler[1], handEuler[2]);
  }
  /** FK chain wave: bone i gets pitch/yaw/roll scaled by (1 + grow*i) and lagged in phase */
  chain(c: PoseCtx, bones: string[], u: number, o: { pitch?: number; yaw?: number; roll?: number; cycles?: number; phase?: number; lag?: number; grow?: number; biasPitch?: number; biasYaw?: number; biasRoll?: number }): void {
    const cyc = o.cycles ?? 1, ph = o.phase ?? 0, lag = o.lag ?? 0.12, grow = o.grow ?? 0.35;
    bones.forEach((b, i) => {
      const k = 1 + grow * i;
      const w = wave(u, cyc, ph - i * lag);
      const w2 = wave(u, cyc, ph - i * lag + 0.25);
      this.set(c, b, (o.biasPitch ?? 0) + (o.pitch ?? 0) * k * w2, (o.biasYaw ?? 0) + (o.yaw ?? 0) * k * w, (o.biasRoll ?? 0) + (o.roll ?? 0) * k * w2);
    });
  }
}

// ======================================================================================================== ICE WRAITH
export function makeIceClips(a: IceAnatomy, skel: Skeleton): ClipSpec[] {
  const s = a.s;
  const R = new Rig(skel, s);
  const petals = a.petalAngles;
  const poleL: Vec3 = [0.5, -0.4, -0.8];
  const poleR: Vec3 = [-0.5, -0.4, -0.8];
  const robe = ['robe1', 'robe2', 'robe3'];

  /** hover body: bob, lean (rad), trail strength (rad) */
  const hover = (c: PoseCtx, u: number, o: { bobAmp: number; bobCyc: number; lean: number; trail: number; sway: number; spin: number; flutter: number }): void => {
    const b = wave(u, o.bobCyc, 0);
    R.move(c, 'root', o.sway * s * wave(u, o.bobCyc, 0.25), o.bobAmp * s * b, 0);
    R.set(c, 'pelvis', -0.02 * b + o.lean * 0.4, 0.05 * wave(u, o.bobCyc, 0.1), 0.04 * wave(u, o.bobCyc, 0.25));
    R.set(c, 'spine', o.lean * 0.35 + 0.02 * b, -0.04 * wave(u, o.bobCyc, 0.1), -0.03 * wave(u, o.bobCyc, 0.25));
    R.set(c, 'chest', o.lean * 0.4, -0.06 * wave(u, o.bobCyc, 0.2), -0.02 * wave(u, o.bobCyc, 0.3));
    R.set(c, 'neck', -o.lean * 0.3 + 0.03 * b, 0.1 * wave(u, o.bobCyc, 0.15), 0);
    R.set(c, 'head', -o.lean * 0.3 + 0.03 * wave(u, o.bobCyc * 2, 0.1), 0.18 * wave(u, o.bobCyc, 0.3), 0.04 * wave(u, o.bobCyc, 0.05));
    R.tiltUp(c, 'crown_l', 0.1 * wave(u, o.bobCyc * 2, 0.0) + o.flutter, 0.06 * wave(u, o.bobCyc * 2, 0.3));
    R.tiltUp(c, 'crown_r', 0.1 * wave(u, o.bobCyc * 2, 0.5) + o.flutter, 0.06 * wave(u, o.bobCyc * 2, 0.8));
    R.chain(c, robe, u, { yaw: 0.07, pitch: 0.05, cycles: o.bobCyc, phase: -0.1, lag: 0.14, biasPitch: o.trail * 0.4 });
    for (const ang of petals) {
      const th = deg(ang);
      const flare = 0.07 * wave(u, o.bobCyc * 2, ang / 360) + 0.05;
      R.tilt(c, `petal_${ang}`, Math.sin(th) * flare, Math.cos(th) * flare - o.trail * 0.8);
    }
    // gyroscopic ring + counter-rotating orbit shards
    R.set(c, 'ring', 0.08 * wave(u, o.bobCyc, 0), o.spin * u * TAU, 0.06 * wave(u, o.bobCyc, 0.25));
    R.set(c, 'orbit_a', 0, -o.spin * 1.0 * u * TAU, 0);
    R.set(c, 'orbit_b', 0, o.spin * 2.0 * u * TAU, 0);
    R.move(c, 'orbit_a', 0, 0.05 * s * wave(u, o.bobCyc * 2, 0.1), 0);
    R.move(c, 'orbit_b', 0, 0.05 * s * wave(u, o.bobCyc * 2, 0.6), 0);
  };
  const armsIdle = (c: PoseCtx, u: number, amp = 1, cyc = 1): void => {
    R.reach(c, 'l', [0.02 * amp * wave(u, cyc, 0), 0.03 * amp * wave(u, cyc, 0.2), 0.03 * amp * wave(u, cyc, 0.5)], poleL, [0.15 * wave(u, cyc, 0.3), 0, 0]);
    R.reach(c, 'r', [0.02 * amp * wave(u, cyc, 0.5), 0.03 * amp * wave(u, cyc, 0.7), -0.02 * amp * wave(u, cyc, 0.1)], poleR, [-0.1 * wave(u, cyc, 0.1), 0, 0]);
  };

  const idle: ClipSpec = {
    name: 'idle', duration: 2.0, loop: true,
    pose(c) {
      hover(c, c.u, { bobAmp: 0.035, bobCyc: 1, lean: 0, trail: 0, sway: 0.012, spin: 1, flutter: 0 });
      armsIdle(c, c.u);
    },
  };
  const walk: ClipSpec = {
    name: 'walk', duration: 1.2, loop: true,
    pose(c) {
      hover(c, c.u, { bobAmp: 0.03, bobCyc: 2, lean: 0.14, trail: 0.18, sway: 0.01, spin: 2, flutter: 0.1 });
      armsIdle(c, c.u, 1.6, 2);
    },
  };
  const run: ClipSpec = {
    name: 'run', duration: 0.7, loop: true,
    pose(c) {
      hover(c, c.u, { bobAmp: 0.04, bobCyc: 2, lean: 0.34, trail: 0.5, sway: 0.015, spin: 3, flutter: 0.3 });
      R.reach(c, 'l', [0.0, 0.05, 0.05], poleL, [0.3, 0, 0]);
      R.reach(c, 'r', [-0.04, 0.0, -0.1], poleR, [-0.3, 0, 0]);
    },
  };

  // cast: gather frost (arms rise, shards converge, ring spins up), release at 0.55 s, recoil
  const attack: ClipSpec = {
    name: 'attack', duration: 1.4, loop: false, hit: 0.55,
    pose(c) {
      const t = c.t;
      const wind = ramp(t, 0.0, 0.5, 'inout3') * (1 - ramp(t, 0.5, 0.58, 'in'));
      const rel = ramp(t, 0.5, 0.6, 'out') * (1 - ramp(t, 0.62, 1.1, 'inout3'));
      const lunge = rel;
      R.move(c, 'root', 0, 0.02 * s * wind, -0.07 * s * wind + 0.12 * s * lunge);
      R.set(c, 'pelvis', -0.1 * wind + 0.12 * rel, 0, 0);
      R.set(c, 'spine', -0.12 * wind + 0.15 * rel, 0.1 * wind, 0);
      R.set(c, 'chest', -0.2 * wind + 0.25 * rel, 0.15 * wind - 0.1 * rel, 0);
      R.set(c, 'neck', -0.1 * wind + 0.14 * rel, 0, 0);
      R.set(c, 'head', -0.25 * wind + 0.2 * rel, 0.1 * wind, 0);
      R.chain(c, robe, c.u, { pitch: 0.05, yaw: 0.05, cycles: 2, lag: 0.1, biasPitch: -0.2 * wind + 0.5 * rel });
      for (const ang of petals) {
        const th = deg(ang);
        const f = 0.05 + 0.28 * wind + 0.25 * rel;
        R.tilt(c, `petal_${ang}`, Math.sin(th) * f, Math.cos(th) * f - 0.4 * rel);
      }
      R.tiltUp(c, 'crown_l', -0.3 * wind + 0.4 * rel, 0.1);
      R.tiltUp(c, 'crown_r', -0.3 * wind + 0.4 * rel, -0.1);
      R.set(c, 'ring', 0.3 * wind, (c.u * 4 + wind * 2) * TAU, 0.2 * rel);
      R.set(c, 'orbit_a', 0, -(c.u * 3 + wind * 3) * TAU, 0);
      R.set(c, 'orbit_b', 0, (c.u * 5 + wind * 4) * TAU, 0);
      // arms: both rise overhead while gathering, then the left thrusts forward
      R.reach(c, 'l', [0.0 - 0.1 * rel, 0.26 * wind - 0.12 * rel, -0.1 * wind + 0.45 * rel], poleL, [-0.5 * wind + 0.5 * rel, 0, 0]);
      R.reach(c, 'r', [0.2 * wind + 0.02 * rel, 0.5 * wind - 0.1 * rel, 0.0 + 0.3 * wind + 0.25 * rel], poleR, [-0.4 * wind, 0, 0]);
    },
  };

  const hit: ClipSpec = {
    name: 'hit', duration: 0.5, loop: false,
    pose(c) {
      const t = c.t;
      const imp = ramp(t, 0, 0.06, 'out') * Math.exp(-6 * Math.max(0, t - 0.06));
      const osc = damped(Math.max(0, t - 0.06), 6, 8);
      R.move(c, 'root', 0, -0.03 * s * imp, -0.14 * s * imp);
      R.set(c, 'pelvis', 0.15 * imp, 0.05 * osc, 0.08 * osc);
      R.set(c, 'spine', -0.2 * imp, 0.1 * osc, 0);
      R.set(c, 'chest', -0.3 * imp, -0.12 * osc, 0.05 * osc);
      R.set(c, 'neck', -0.3 * imp, 0.1 * osc, 0);
      R.set(c, 'head', -0.4 * imp, 0.15 * osc, 0);
      R.chain(c, robe, c.u, { yaw: 0.1, cycles: 3, lag: 0.1, biasPitch: 0.5 * imp });
      for (const ang of petals) {
        const th = deg(ang);
        R.tilt(c, `petal_${ang}`, Math.sin(th) * 0.35 * imp, Math.cos(th) * 0.35 * imp + 0.3 * imp);
      }
      R.set(c, 'ring', 0.25 * osc, 3 * c.u * TAU, 0.2 * imp);
      R.set(c, 'orbit_a', 0.2 * osc, -2 * c.u * TAU, 0);
      R.set(c, 'orbit_b', 0.2 * osc, 3 * c.u * TAU, 0);
      R.reach(c, 'l', [0.05 * imp, 0.1 * imp, -0.18 * imp], poleL, [0.3 * imp, 0, 0]);
      R.reach(c, 'r', [-0.05 * imp, 0.1 * imp, -0.1 * imp], poleR, [-0.3 * imp, 0, 0]);
    },
  };

  // death: jolt, then every facet drifts apart and drops (the game dissolves the mesh)
  const death: ClipSpec = {
    name: 'death', duration: 1.3, loop: false,
    pose(c) {
      const t = c.t;
      const jolt = ramp(t, 0, 0.12, 'out') * (1 - ramp(t, 0.12, 0.35));
      const fall = ramp(t, 0.15, 1.1, 'in');
      const spread = ramp(t, 0.12, 0.9, 'out');
      const tremble = 0.05 * wave(t, 14, 0) * (1 - ramp(t, 0.3, 0.9));
      R.move(c, 'root', 0, -0.35 * s * fall, -0.15 * s * jolt - 0.1 * s * fall);
      R.set(c, 'pelvis', 0.35 * fall + 0.1 * jolt, tremble, 0.25 * fall);
      R.set(c, 'spine', -0.3 * jolt + 0.2 * fall, tremble, 0);
      R.set(c, 'chest', -0.4 * jolt + 0.25 * fall, tremble, 0.1 * fall);
      R.set(c, 'neck', -0.5 * jolt + 0.3 * fall, 0, 0);
      R.set(c, 'head', -0.5 * jolt + 0.5 * fall, 0.3 * fall, 0.2 * fall);
      R.chain(c, robe, c.u, { yaw: 0.2, cycles: 3, biasPitch: 0.6 * fall });
      for (const ang of petals) {
        const th = deg(ang);
        const f = 0.15 + 0.9 * spread;
        R.tilt(c, `petal_${ang}`, Math.sin(th) * f, Math.cos(th) * f);
        R.move(c, `petal_${ang}`, Math.sin(th) * 0.25 * s * spread, -0.15 * s * spread * fall, Math.cos(th) * 0.25 * s * spread);
      }
      R.tiltUp(c, 'crown_l', 0.7 * spread, 0.3 * spread);
      R.tiltUp(c, 'crown_r', -0.7 * spread, -0.3 * spread);
      R.set(c, 'ring', 0.9 * fall, (3 * c.u + 2 * fall) * TAU, 0.6 * fall);
      R.move(c, 'ring', 0, -0.25 * s * fall, 0);
      R.set(c, 'orbit_a', 0, -(2 * c.u) * TAU, 0);
      R.set(c, 'orbit_b', 0, (3 * c.u) * TAU, 0);
      R.move(c, 'orbit_a', 0.2 * s * spread, -0.4 * s * fall, 0.2 * s * spread);
      R.move(c, 'orbit_b', -0.2 * s * spread, -0.35 * s * fall, -0.2 * s * spread);
      R.reach(c, 'l', [0.2 * spread, -0.35 * fall, -0.1], poleL, [0.5 * fall, 0, 0]);
      R.reach(c, 'r', [-0.2 * spread, -0.2 * fall, -0.2 * fall], poleR, [-0.5 * fall, 0, 0]);
    },
  };

  // spawn: condenses out of the cold ground; shards snap into place
  const spawn: ClipSpec = {
    name: 'spawn', duration: 1.3, loop: false,
    pose(c) {
      const t = c.t;
      const rise = ramp(t, 0.0, 0.8, 'inout3');
      const snap = bump(t, 0.7, 0.8, 0.85, 1.1);
      const low = 1 - rise;
      R.move(c, 'root', 0, -0.55 * s * low + 0.03 * s * snap, 0);
      R.set(c, 'pelvis', 0.2 * low, 0.5 * low, 0);
      R.set(c, 'spine', 0.15 * low - 0.05 * snap, 0, 0);
      R.set(c, 'chest', 0.2 * low - 0.1 * snap, 0, 0);
      R.set(c, 'neck', 0.2 * low, 0, 0);
      R.set(c, 'head', 0.4 * low - 0.1 * snap, 0.3 * low, 0);
      R.chain(c, robe, c.u, { yaw: 0.05, cycles: 2, biasPitch: -0.3 * low });
      for (const ang of petals) {
        const th = deg(ang);
        R.tilt(c, `petal_${ang}`, -Math.sin(th) * 0.9 * low + Math.sin(th) * 0.2 * snap, -Math.cos(th) * 0.9 * low + Math.cos(th) * 0.2 * snap);
      }
      R.tiltUp(c, 'crown_l', -0.6 * low, 0);
      R.tiltUp(c, 'crown_r', -0.6 * low, 0);
      R.set(c, 'ring', 0.5 * low, (4 * low + c.u) * TAU, 0);
      R.set(c, 'orbit_a', 0, -(3 * low + c.u) * TAU, 0);
      R.set(c, 'orbit_b', 0, (4 * low + c.u) * TAU, 0);
      R.move(c, 'orbit_a', 0, 0.2 * s * low, 0);
      R.move(c, 'orbit_b', 0, -0.2 * s * low, 0);
      R.reach(c, 'l', [-0.2 * low, -0.1 * low, -0.1 * low], poleL, [0.4 * low, 0, 0]);
      R.reach(c, 'r', [0.1 * low, 0.05 * low, 0.0], poleR, [-0.4 * low, 0, 0]);
    },
  };
  return [idle, walk, run, attack, hit, death, spawn];
}

// ======================================================================================================== FLAME GHOST
export function makeFireClips(a: FireAnatomy, skel: Skeleton): ClipSpec[] {
  const s = a.s;
  const R = new Rig(skel, s);
  const tail = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'];
  const poleL: Vec3 = [0.5, -0.5, -0.7];
  const poleR: Vec3 = [-0.5, -0.5, -0.7];

  const flames = (c: PoseCtx, u: number, o: { cyc: number; amp: number; trail: number; up: number }): void => {
    const f = (i: number, ph = 0): number => wave(u, o.cyc, ph + i * 0.17);
    R.tiltUp(c, 'hair_c1', 0.1 * o.amp * f(0) - o.trail * 0.5, 0.06 * o.amp * f(1));
    R.tiltUp(c, 'hair_c2', 0.14 * o.amp * f(1, 0.1) - o.trail * 0.4 + o.up, 0.1 * o.amp * f(2));
    R.tiltUp(c, 'hair_l1', 0.1 * o.amp * f(2) - o.trail * 0.5, 0.12 * o.amp * f(0, 0.2) - 0.1 * o.up);
    R.tiltUp(c, 'hair_l2', 0.16 * o.amp * f(3, 0.3) - o.trail * 0.4, 0.16 * o.amp * f(1, 0.4) - 0.12 * o.up);
    R.tiltUp(c, 'hair_r1', 0.1 * o.amp * f(1, 0.5) - o.trail * 0.5, -0.12 * o.amp * f(3) + 0.1 * o.up);
    R.tiltUp(c, 'hair_r2', 0.16 * o.amp * f(2, 0.6) - o.trail * 0.4, -0.16 * o.amp * f(0, 0.7) + 0.12 * o.up);
    R.tiltUp(c, 'sflame_l', 0.12 * o.amp * f(0, 0.2) - o.trail * 0.4, 0.15 * o.amp * f(2));
    R.tiltUp(c, 'sflame_r', 0.12 * o.amp * f(1, 0.7) - o.trail * 0.4, -0.15 * o.amp * f(3));
    R.tiltUp(c, 'wisp_l', 0.15 * o.amp * f(2, 0.1), 0.2 * o.amp * f(0, 0.5) + 0.15 * o.up);
    R.tiltUp(c, 'wisp_r', 0.15 * o.amp * f(3, 0.6), -0.2 * o.amp * f(1, 0.9) - 0.15 * o.up);
  };
  const hover = (c: PoseCtx, u: number, o: { bobAmp: number; cyc: number; lean: number; tailAmp: number; trail: number; flameAmp: number; flameCyc: number }): void => {
    const b = wave(u, o.cyc, 0);
    R.move(c, 'root', 0.015 * s * wave(u, o.cyc, 0.25), o.bobAmp * s * b, 0);
    R.set(c, 'pelvis', o.lean * 0.5 - 0.03 * b, 0.07 * wave(u, o.cyc, 0.1), 0.05 * wave(u, o.cyc, 0.25));
    R.set(c, 'spine', o.lean * 0.3, -0.06 * wave(u, o.cyc, 0.1), -0.04 * wave(u, o.cyc, 0.25));
    R.set(c, 'chest', o.lean * 0.35 + 0.02 * b, -0.08 * wave(u, o.cyc, 0.2), 0.03 * wave(u, o.cyc, 0.1));
    R.set(c, 'neck', -o.lean * 0.4 + 0.04 * b, 0.12 * wave(u, o.cyc, 0.15), 0);
    R.set(c, 'head', -o.lean * 0.3 + 0.04 * wave(u, o.cyc * 2, 0.2), 0.2 * wave(u, o.cyc, 0.3), 0.06 * wave(u, o.cyc, 0.05));
    R.set(c, 'jaw', 0.22 + 0.08 * wave(u, o.cyc * 2, 0.4), 0, 0);
    // torch tail: S-wave travelling down the body, trailing opposite the travel direction
    R.chain(c, tail, u, { yaw: o.tailAmp, pitch: o.tailAmp * 0.45, cycles: o.cyc, phase: 0, lag: 0.14, grow: 0.3, biasPitch: o.trail * 0.35 });
    flames(c, u, { cyc: o.flameCyc, amp: o.flameAmp, trail: o.trail, up: 0 });
    R.set(c, 'ember_a', 0, -u * TAU * Math.max(1, o.cyc), 0);
    R.set(c, 'ember_b', 0, u * TAU * Math.max(1, o.cyc) * 2, 0);
    R.move(c, 'ember_a', 0, 0.05 * s * wave(u, o.cyc * 2, 0.1), 0);
    R.move(c, 'ember_b', 0, 0.06 * s * wave(u, o.cyc * 2, 0.6), 0);
  };
  const armsIdle = (c: PoseCtx, u: number, amp = 1, cyc = 1): void => {
    R.reach(c, 'l', [0.02 * amp * wave(u, cyc, 0), 0.03 * amp * wave(u, cyc, 0.2), 0.03 * amp * wave(u, cyc, 0.5)], poleL, [0.15 * wave(u, cyc, 0.3), 0, 0]);
    R.reach(c, 'r', [0.02 * amp * wave(u, cyc, 0.5), 0.03 * amp * wave(u, cyc, 0.7), -0.03 * amp * wave(u, cyc, 0.1)], poleR, [-0.15 * wave(u, cyc, 0.1), 0, 0]);
  };

  const idle: ClipSpec = {
    name: 'idle', duration: 1.4, loop: true,
    pose(c) {
      hover(c, c.u, { bobAmp: 0.04, cyc: 1, lean: 0, tailAmp: 0.16, trail: 0, flameAmp: 1, flameCyc: 2 });
      armsIdle(c, c.u);
    },
  };
  const walk: ClipSpec = {
    name: 'walk', duration: 1.0, loop: true,
    pose(c) {
      hover(c, c.u, { bobAmp: 0.04, cyc: 2, lean: 0.14, tailAmp: 0.24, trail: 0.2, flameAmp: 1.3, flameCyc: 3 });
      armsIdle(c, c.u, 1.8, 2);
    },
  };
  const run: ClipSpec = {
    name: 'run', duration: 0.6, loop: true,
    pose(c) {
      hover(c, c.u, { bobAmp: 0.05, cyc: 2, lean: 0.34, tailAmp: 0.3, trail: 0.55, flameAmp: 1.6, flameCyc: 4 });
      R.reach(c, 'l', [0.02, 0.05, 0.06], poleL, [0.3, 0, 0]);
      R.reach(c, 'r', [-0.02, 0.0, -0.1], poleR, [-0.3, 0, 0]);
    },
  };

  // throw: pull both hands into the chest and flare, then hurl a fireball with the left hand (release 0.55 s)
  const attack: ClipSpec = {
    name: 'attack', duration: 1.2, loop: false, hit: 0.55,
    pose(c) {
      const t = c.t;
      const gather = ramp(t, 0.0, 0.45, 'inout3') * (1 - ramp(t, 0.48, 0.56, 'in'));
      const rel = ramp(t, 0.5, 0.6, 'out') * (1 - ramp(t, 0.62, 1.1, 'inout3'));
      R.move(c, 'root', 0, 0.03 * s * gather, -0.06 * s * gather + 0.1 * s * rel);
      R.set(c, 'pelvis', -0.1 * gather + 0.1 * rel, 0, 0);
      R.set(c, 'spine', -0.12 * gather + 0.12 * rel, 0.12 * gather - 0.1 * rel, 0);
      R.set(c, 'chest', -0.25 * gather + 0.3 * rel, 0.2 * gather - 0.15 * rel, 0);
      R.set(c, 'neck', -0.15 * gather + 0.2 * rel, 0, 0);
      R.set(c, 'head', -0.3 * gather + 0.25 * rel, 0.1 * gather, 0);
      R.set(c, 'jaw', 0.2 + 0.7 * bump(t, 0.35, 0.5, 0.65, 0.9), 0, 0);
      R.chain(c, tail, c.u, { yaw: 0.12, pitch: 0.1, cycles: 2, lag: 0.12, biasPitch: 0.1 * gather + 0.45 * rel });
      flames(c, c.u, { cyc: 3, amp: 1.2, trail: 0.5 * rel - 0.2 * gather, up: 0.5 * gather });
      R.set(c, 'ember_a', 0, -(c.u * 3 + gather * 3) * TAU, 0);
      R.set(c, 'ember_b', 0, (c.u * 5 + gather * 4) * TAU, 0);
      R.reach(c, 'l', [-0.12 * gather + 0.0, 0.12 * gather - 0.1 * rel, -0.2 * gather + 0.5 * rel], poleL, [-0.4 * gather + 0.3 * rel, 0, 0]);
      R.reach(c, 'r', [0.2 * gather, 0.2 * gather - 0.05 * rel, 0.25 * gather + 0.12 * rel], poleR, [-0.4 * gather, 0, 0]);
    },
  };

  const hit: ClipSpec = {
    name: 'hit', duration: 0.5, loop: false,
    pose(c) {
      const t = c.t;
      const imp = ramp(t, 0, 0.06, 'out') * Math.exp(-6 * Math.max(0, t - 0.06));
      const osc = damped(Math.max(0, t - 0.06), 6, 8);
      R.move(c, 'root', 0, -0.03 * s * imp, -0.14 * s * imp);
      R.set(c, 'pelvis', 0.15 * imp, 0.05 * osc, 0.1 * osc);
      R.set(c, 'spine', -0.2 * imp, 0.1 * osc, 0);
      R.set(c, 'chest', -0.3 * imp, -0.15 * osc, 0.06 * osc);
      R.set(c, 'neck', -0.3 * imp, 0.1 * osc, 0);
      R.set(c, 'head', -0.5 * imp, 0.2 * osc, 0);
      R.set(c, 'jaw', 0.2 + 0.7 * imp, 0, 0);
      R.chain(c, tail, c.u, { yaw: 0.2, pitch: 0.1, cycles: 3, lag: 0.1, biasPitch: 0.4 * imp });
      flames(c, c.u, { cyc: 5, amp: 1.5, trail: 0.6 * imp, up: 0.4 * imp });
      R.reach(c, 'l', [0.04 * imp, 0.1 * imp, -0.2 * imp], poleL, [0.3 * imp, 0, 0]);
      R.reach(c, 'r', [-0.05 * imp, 0.1 * imp, -0.1 * imp], poleR, [-0.3 * imp, 0, 0]);
    },
  };

  // death: the flame gutters - body folds forward, the tail coils up, tongues droop and everything sinks
  const death: ClipSpec = {
    name: 'death', duration: 1.6, loop: false,
    pose(c) {
      const t = c.t;
      const jolt = ramp(t, 0, 0.12, 'out') * (1 - ramp(t, 0.12, 0.4));
      const fold = ramp(t, 0.1, 1.2, 'inout3');
      const sink = ramp(t, 0.3, 1.5, 'in');
      const flick = 0.1 * wave(t, 12, 0) * (1 - ramp(t, 0.2, 1.2));
      R.move(c, 'root', 0, -0.5 * s * sink, -0.12 * s * jolt);
      R.set(c, 'pelvis', 0.2 * fold, flick, 0.15 * fold);
      R.set(c, 'spine', -0.3 * jolt + 0.4 * fold, flick, 0);
      R.set(c, 'chest', -0.4 * jolt + 0.5 * fold, flick, 0.05 * fold);
      R.set(c, 'neck', -0.5 * jolt + 0.5 * fold, 0, 0);
      R.set(c, 'head', -0.6 * jolt + 0.6 * fold, 0.2 * fold, 0);
      R.set(c, 'jaw', 0.2 + 0.8 * jolt + 0.3 * fold, 0, 0);
      R.chain(c, tail, c.u, { yaw: 0.2, pitch: 0.1, cycles: 3, lag: 0.12, biasPitch: -0.5 * fold, biasYaw: 0.4 * fold });
      flames(c, c.u, { cyc: 6, amp: 1.6 * (1 - 0.6 * fold), trail: -0.8 * fold, up: -0.6 * fold });
      R.move(c, 'ember_a', 0, -0.3 * s * sink, 0);
      R.move(c, 'ember_b', 0, -0.3 * s * sink, 0);
      R.reach(c, 'l', [0.05 * fold, -0.4 * fold, -0.1], poleL, [0.5 * fold, 0, 0]);
      R.reach(c, 'r', [-0.05 * fold, -0.3 * fold, -0.2 * fold], poleR, [-0.5 * fold, 0, 0]);
    },
  };

  // spawn: ignites out of the ground, tail unfurling, flames whipping up
  const spawn: ClipSpec = {
    name: 'spawn', duration: 1.4, loop: false,
    pose(c) {
      const t = c.t;
      const rise = ramp(t, 0.0, 0.85, 'inout3');
      const flare = bump(t, 0.5, 0.8, 0.95, 1.3);
      const low = 1 - rise;
      R.move(c, 'root', 0, -0.9 * s * low, 0);
      R.set(c, 'pelvis', 0.3 * low, 0.4 * low, 0);
      R.set(c, 'spine', 0.25 * low, 0, 0);
      R.set(c, 'chest', 0.3 * low - 0.15 * flare, 0, 0);
      R.set(c, 'neck', 0.3 * low - 0.1 * flare, 0, 0);
      R.set(c, 'head', 0.4 * low - 0.2 * flare, 0.2 * low, 0);
      R.set(c, 'jaw', 0.2 + 0.7 * flare, 0, 0);
      R.chain(c, tail, c.u, { yaw: 0.2, pitch: 0.1, cycles: 3, lag: 0.12, biasPitch: 0.9 * low });
      flames(c, c.u, { cyc: 4, amp: 1 + 0.8 * flare, trail: 0.0, up: 0.8 * flare - 0.6 * low });
      R.set(c, 'ember_a', 0, -(3 * low + c.u) * TAU, 0);
      R.set(c, 'ember_b', 0, (4 * low + c.u) * TAU, 0);
      R.reach(c, 'l', [-0.15 * low + 0.05 * flare, 0.0, -0.1 * low], poleL, [0.4 * low, 0, 0]);
      R.reach(c, 'r', [0.1 * low, 0.1 * flare, 0.0], poleR, [-0.4 * low, 0, 0]);
    },
  };
  return [idle, walk, run, attack, hit, death, spawn];
}

export { cwave };

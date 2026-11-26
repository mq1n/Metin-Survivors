// Aquatic clip set: idle, walk, run, attack, hit, death, spawn.
// The whale hovers on two paddle-fins: they scull on planted-foot IK (alternating strokes), while a travelling pitch+yaw wave runs
// down a 6-bone spine with phase lag, the flukes and dorsal fin whip behind it. Everything is in place; authored ground speeds
// are stride sweep / (duty x cycle) and are exported through the model extras.
// Attack timing follows the game data: windup 0.7 s -> `hit` 0.7 s, tail-slap follow-through, ~1.3 s total.
import type { ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import { bump, damped, keyed, ramp } from '../../core/anim/curve.ts';
import { aimQuat, localFromWorld, twoBoneIK } from '../../core/anim/ik.ts';
import { wave } from '../../core/anim/quadruped.ts';
import { type Quat, type Vec3, deg, qeuler, qrotate, smoothstep, vadd, vdist, vsub } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';

const SPINE = ['chest', 'spine', 'tail1', 'tail2', 'tail3', 'fluke'] as const;
/** pitch / yaw amplitude growth along the spine (radians per unit of the clip's amplitude) */
const AP = [0.02, 0.04, 0.07, 0.1, 0.13, 0.17];
const AY = [0.01, 0.03, 0.06, 0.09, 0.12, 0.16];

const WALK = { sweep: 0.55, duty: 0.62, cycle: 0.7 };
const RUN = { sweep: 0.62, duty: 0.42, cycle: 0.52 };

/** accumulates euler contributions per bone so several drivers can share one bone before it is written */
class Acc {
  private m = new Map<string, Vec3>();
  add(bone: string, x = 0, y = 0, z = 0): this {
    const v = this.m.get(bone) ?? [0, 0, 0];
    v[0] += x; v[1] += y; v[2] += z;
    this.m.set(bone, v);
    return this;
  }
  flush(c: PoseCtx): void {
    for (const [b, v] of this.m) c.set(b, v[0], v[1], v[2]);
  }
}

interface Swim {
  pitch: number;
  yaw: number;
  cycles?: number;
  lag?: number;
  phase?: number;
}

/** travelling wave down the spine (pitch = vertical undulation, yaw = side sway a quarter-cycle behind) */
function swim(acc: Acc, u: number, o: Swim): void {
  const cyc = o.cycles ?? 1, lag = o.lag ?? 0.09, ph = o.phase ?? 0;
  SPINE.forEach((b, k) => {
    const q = ph - k * lag;
    acc.add(b, o.pitch * AP[k]! * wave(u, cyc, q), o.yaw * AY[k]! * wave(u, cyc, q + 0.25), 0);
  });
}

/** flukes, dorsal fin follow-through: later phase, own amplitude */
function tailTips(acc: Acc, u: number, cyc: number, lag: number, amp: number, phase = 0): void {
  const q = phase - 6 * lag;
  acc.add('fluke_l', 0.3 * amp * wave(u, cyc, q - 0.1), 0, 0.45 * amp * wave(u, cyc, q));
  acc.add('fluke_r', 0.3 * amp * wave(u, cyc, q - 0.1), 0, -0.45 * amp * wave(u, cyc, q));
  acc.add('dorsal1', -0.18 * amp * wave(u, cyc, phase - 1.5 * lag), 0, 0.05 * amp * wave(u, cyc, phase + 0.2));
  acc.add('dorsal2', -0.34 * amp * wave(u, cyc, phase - 2.4 * lag), 0, 0.1 * amp * wave(u, cyc, phase + 0.3));
}

export interface FinOff {
  dx: number;
  dy: number;
  dz: number;
  pitch?: number;
  yaw?: number;
  roll?: number;
}

type Side = 'l' | 'r';

/** two paddle-fin legs: shoulder -> elbow -> wrist two-bone IK with a paddle (pec3) that stays flat on the ground */
export class FinRig {
  private legs: Record<Side, { upper: number; lower: number; foot: number; parent: number; p0: Vec3; p1: Vec3; p2: Vec3; l1: number; l2: number; pole: Vec3; ax1: Vec3; ax2: Vec3 }>;
  constructor(readonly skel: Skeleton) {
    const pickAxis = (d: Vec3): Vec3 => {
      const n = Math.hypot(...d);
      const ax: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      return ax.reduce((best, cur) => (Math.abs(cur[0] * d[0] + cur[1] * d[1] + cur[2] * d[2]) / n < Math.abs(best[0] * d[0] + best[1] * d[1] + best[2] * d[2]) / n ? cur : best));
    };
    const mk = (sd: Side): FinRig['legs'][Side] => {
      const p0 = skel.restPos(`pec_${sd}`), p1 = skel.restPos(`pec2_${sd}`), p2 = skel.restPos(`pec3_${sd}`);
      // the elbow bows up/out of the shoulder-wrist line: that offset is the IK pole
      const sw = vsub(p2, p0);
      const l2sw = sw[0] * sw[0] + sw[1] * sw[1] + sw[2] * sw[2];
      const se = vsub(p1, p0);
      const k = (se[0] * sw[0] + se[1] * sw[1] + se[2] * sw[2]) / l2sw;
      const pole: Vec3 = [se[0] - sw[0] * k, se[1] - sw[1] * k, se[2] - sw[2] * k];
      return {
        upper: skel.idx(`pec_${sd}`), lower: skel.idx(`pec2_${sd}`), foot: skel.idx(`pec3_${sd}`), parent: skel.idx('chest'),
        p0, p1, p2, l1: vdist(p0, p1), l2: vdist(p1, p2), pole,
        ax1: pickAxis(vsub(p1, p0)), ax2: pickAxis(vsub(p2, p1)),
      };
    };
    this.legs = { l: mk('l'), r: mk('r') };
  }

  /** plant the paddle at (rest wrist + offset) in ground space; call after the body bones are posed. Returns true when the reach clamped. */
  plant(c: PoseCtx, sd: Side, off: FinOff): boolean {
    const leg = this.legs[sd];
    const w = this.skel.fk(c.pose);
    const pr = w.rot[leg.parent]!;
    const P0 = w.pos[leg.upper]!;
    const target = vadd(leg.p2, [off.dx, off.dy, off.dz]);
    const { mid, end, clamped } = twoBoneIK(P0, target, leg.l1, leg.l2, qrotate(pr, leg.pole));
    const rUpper = aimQuat(vsub(leg.p1, leg.p0), leg.ax1, vsub(mid, P0), qrotate(pr, leg.ax1));
    const rLower = aimQuat(vsub(leg.p2, leg.p1), leg.ax2, vsub(end, mid), qrotate(rUpper, leg.ax2));
    const rFoot: Quat = qeuler(off.pitch ?? 0, off.yaw ?? 0, off.roll ?? 0);
    c.pose.rot[leg.upper] = localFromWorld(pr, rUpper);
    c.pose.rot[leg.lower] = localFromWorld(rUpper, rLower);
    c.pose.rot[leg.foot] = localFromWorld(rLower, rFoot);
    return clamped;
  }
}

/** one fin stroke: planted push-back (constant ground speed) then a lifted, swung-wide recovery */
function stroke(u0: number, duty: number, sweep: number, lift: number, sx: number): FinOff {
  const u = u0 - Math.floor(u0);
  if (u < duty) {
    const k = u / duty;
    return { dz: sweep * (0.5 - k), dy: 0, dx: -0.1 * smoothstep(0.55, 1, k), pitch: 0.06 * (1 - k), yaw: sx * 0.42 * (k - 0.5), roll: 0 };
  }
  const k = (u - duty) / (1 - duty);
  const e = k * k * (3 - 2 * k);
  const arc = Math.pow(Math.sin(Math.PI * k), 0.75);
  return { dz: sweep * (-0.5 + e), dy: lift * arc, dx: 0.1 * Math.sin(Math.PI * k) - 0.1 * (1 - e), pitch: -0.55 * arc + 0.06 * k, yaw: sx * 0.42 * (0.5 - e), roll: sx * 0.35 * arc };
}

export function makeClips(a: Anatomy, skel: Skeleton): ClipSpec[] {
  const s = a.s;
  const rig = new FinRig(skel);
  const gape = a.p.gape;
  const FINS: Side[] = ['l', 'r'];
  const pelvic = (acc: Acc, u: number, cyc: number, amp: number, ph = 0): void => {
    acc.add('pel_l', 0, 0, 0.3 * amp * wave(u, cyc, ph));
    acc.add('pel_r', 0, 0, -0.3 * amp * wave(u, cyc, ph + 0.5));
  };

  // ------------------------------------------------------------------ idle: hover, slow wave, fin gestures, growl
  const idle: ClipSpec = {
    name: 'idle', duration: 2.4, loop: true,
    pose(c) {
      const u = c.u;
      const acc = new Acc();
      const br = wave(u, 1, 0);
      c.move('root', 0, 0.03 * s * br, 0);
      swim(acc, u, { pitch: 0.6, yaw: 0.5, lag: 0.1 });
      acc.add('chest', 0, 0.035 * wave(u, 1, 0.5), 0.02 * wave(u, 1, 0.25));
      acc.add('neck', -0.05 + 0.02 * br, 0.07 * wave(u, 1, 0.3), 0);
      acc.add('head', -0.1 + 0.03 * wave(u, 1, 0.15), 0.13 * wave(u, 1, 0.32), 0.02 * wave(u, 1, 0.1));
      const growl = bump(u, 0.52, 0.58, 0.68, 0.76);
      acc.add('jaw', 0.03 + 0.05 * (0.5 + 0.5 * wave(u, 2, 0.1)) + 0.2 * growl, 0, 0);
      tailTips(acc, u, 1, 0.1, 0.7);
      pelvic(acc, u, 1, 0.6);
      acc.flush(c);
      const lf = bump(u, 0.16, 0.26, 0.36, 0.48), rf = bump(u, 0.6, 0.7, 0.8, 0.92);
      rig.plant(c, 'l', { dx: 0.06 * lf, dy: 0.13 * lf, dz: 0.1 * lf, pitch: -0.3 * lf, yaw: 0.25 * lf, roll: 0.2 * lf });
      rig.plant(c, 'r', { dx: -0.06 * rf, dy: 0.13 * rf, dz: 0.1 * rf, pitch: -0.3 * rf, yaw: -0.25 * rf, roll: -0.2 * rf });
    },
  };

  // ------------------------------------------------------------------ walk: alternating sculling strokes + body wave
  const walk: ClipSpec = {
    name: 'walk', duration: WALK.cycle, loop: true,
    pose(c) {
      const u = c.u;
      const acc = new Acc();
      c.move('root', 0, -0.01 * s + 0.024 * s * wave(u, 2, 0.15), 0);
      swim(acc, u, { pitch: 0.9, yaw: 0.8, lag: 0.1 });
      acc.add('chest', 0, 0.05 * wave(u, 1, 0.25), 0.06 * wave(u, 1, 0.0));
      acc.add('neck', -0.02 + 0.03 * wave(u, 2, 0.4), 0.1 * wave(u, 1, 0.05), 0);
      acc.add('head', -0.06 + 0.03 * wave(u, 2, 0.5), 0.1 * wave(u, 1, 0.1), 0);
      acc.add('jaw', 0.05 + 0.05 * (0.5 + 0.5 * wave(u, 2, 0.2)), 0, 0);
      tailTips(acc, u, 1, 0.1, 0.8);
      pelvic(acc, u, 1, 1);
      acc.flush(c);
      for (const sd of FINS) {
        const sx = sd === 'l' ? 1 : -1;
        const f = stroke(u + (sd === 'l' ? 0 : 0.5), WALK.duty, WALK.sweep, 0.17, sx);
        rig.plant(c, sd, { ...f, dx: f.dx * sx, dz: f.dz + 0.08 });
      }
    },
  };

  // ------------------------------------------------------------------ run: low, fast flutter, head down, fins swept back
  const run: ClipSpec = {
    name: 'run', duration: RUN.cycle, loop: true,
    pose(c) {
      const u = c.u;
      const acc = new Acc();
      c.move('root', 0, -0.012 * s + 0.026 * s * wave(u, 2, 0.1), 0);
      c.set('root', 0.025 + 0.015 * wave(u, 2, 0.4), 0, 0.03 * wave(u, 1, 0.3));
      swim(acc, u, { pitch: 1.2, yaw: 1.0, lag: 0.085 });
      acc.add('chest', 0, 0.06 * wave(u, 1, 0.25), 0.07 * wave(u, 1, 0));
      acc.add('neck', 0.0 + 0.04 * wave(u, 2, 0.3), 0.08 * wave(u, 1, 0.05), 0);
      acc.add('head', -0.09 + 0.04 * wave(u, 2, 0.4), 0.07 * wave(u, 1, 0.1), 0);
      acc.add('jaw', 0.2 + 0.07 * wave(u, 2, 0.15), 0, 0);
      tailTips(acc, u, 1, 0.085, 1.0);
      pelvic(acc, u, 2, 1.2);
      acc.flush(c);
      for (const sd of FINS) {
        const sx = sd === 'l' ? 1 : -1;
        const f = stroke(u + (sd === 'l' ? 0 : 0.5), RUN.duty, RUN.sweep, 0.2, sx);
        rig.plant(c, sd, { ...f, dx: f.dx * sx - sx * 0.03, dz: f.dz + 0.06, yaw: (f.yaw ?? 0) + sx * 0.25 });
      }
    },
  };

  // ------------------------------------------------------------------ attack: rear back and inhale (0..0.65), lunge-bite lands 0.7, tail-slap follow-through
  const attack: ClipSpec = {
    name: 'attack', duration: 1.3, loop: false, hit: 0.7,
    pose(c) {
      const t = c.t;
      const acc = new Acc();
      const coil = ramp(t, 0, 0.45, 'inout3') * (1 - ramp(t, 0.6, 0.7, 'in'));
      const lunge = ramp(t, 0.58, 0.71, 'in') * (1 - ramp(t, 0.78, 1.2, 'inout3'));
      const shiver = bump(t, 0.4, 0.46, 0.6, 0.66) * wave(t, 9, 0);
      const jaw = keyed(t, [[0, 0], [0.1, 0.08], [0.4, 0.38], [0.62, 0.45], [0.7, -gape * 0.95], [0.77, -gape * 0.78], [0.98, -gape * 0.7], [1.2, 0.02], [1.3, 0]], 'smooth');
      c.move('root', 0, 0.05 * s * coil + 0.09 * s * lunge, -0.24 * s * coil + 0.5 * s * lunge + 0.012 * s * shiver);
      c.set('root', -0.04 * coil + 0.03 * lunge, 0.04 * shiver, 0);
      acc.add('chest', -0.2 * coil + 0.14 * lunge, 0.02 * shiver, 0);
      acc.add('spine', -0.05 * coil + 0.03 * lunge, 0, 0);
      acc.add('neck', -0.4 * coil + 0.3 * lunge, 0.03 * shiver, 0);
      acc.add('head', -0.32 * coil + 0.16 * lunge + 0.02 * shiver, 0, 0);
      acc.add('jaw', jaw, 0, 0);
      // tail: curls up in the windup, whips down and across for the slap
      const slap = bump(t, 0.68, 0.78, 0.88, 1.18);
      const sw = wave(t, 2.2, -0.68 * 2.2);
      acc.add('tail1', 0.12 * coil - 0.22 * lunge, 0.25 * slap * sw, 0);
      acc.add('tail2', 0.16 * coil - 0.2 * lunge, 0.4 * slap * sw, 0);
      acc.add('tail3', 0.18 * coil - 0.1 * lunge, 0.55 * slap * sw, 0);
      acc.add('fluke', 0.2 * coil + 0.2 * lunge * 0 - 0.1 * slap, 0.6 * slap * sw, 0);
      acc.add('fluke_l', 0.2 * slap * sw, 0, 0.5 * slap * sw);
      acc.add('fluke_r', 0.2 * slap * sw, 0, -0.5 * slap * sw);
      // dorsal fin snaps back as the body lunges
      acc.add('dorsal1', 0.08 * coil - 0.28 * lunge, 0, 0);
      acc.add('dorsal2', 0.12 * coil - 0.4 * lunge, 0, 0);
      acc.add('pel_l', 0, 0, 0.3 * lunge); acc.add('pel_r', 0, 0, -0.3 * lunge);
      acc.flush(c);
      for (const sd of FINS) {
        const sx = sd === 'l' ? 1 : -1;
        rig.plant(c, sd, { dx: sx * (0.05 * coil + 0.05 * lunge), dy: 0.02 * lunge, dz: 0.34 * lunge - 0.04 * coil, pitch: -0.3 * lunge, yaw: sx * (0.2 * coil - 0.2 * lunge) });
      }
    },
  };

  // ------------------------------------------------------------------ hit: whole-body S-curve recoil, roar
  const hit: ClipSpec = {
    name: 'hit', duration: 0.6, loop: false,
    pose(c) {
      const t = c.t;
      const acc = new Acc();
      const env = ramp(t, 0, 0.06, 'out') * (1 - ramp(t, 0.1, 0.5, 'inout3'));
      const ring = damped(Math.max(0, t - 0.04), 5.5, 4.5) * ramp(t, 0, 0.05);
      c.move('root', 0, 0.04 * s * env, -0.26 * s * env);
      c.set('root', -0.06 * env, 0.07 * ring, 0.05 * ring);
      // S-curve: chest throws back, spine alternates, the wave rings out to the flukes
      SPINE.forEach((b, k) => acc.add(b, (k === 0 ? -0.2 : k === 1 ? 0.06 : 0.07 + 0.015 * k) * env + 0.035 * (k + 1) * ring, -0.07 * (k + 1) * ring, 0));
      acc.add('neck', -0.3 * env, 0.14 * ring, 0);
      acc.add('head', -0.26 * env, -0.1 * ring, 0.06 * ring);
      acc.add('jaw', 0.45 * env + 0.06 * ring, 0, 0);
      tailTips(acc, c.u, 2, 0.1, 0.9 * (1 - ramp(t, 0.2, 0.6)));
      acc.add('dorsal1', 0.25 * env, 0, 0); acc.add('dorsal2', 0.3 * env + 0.2 * ring, 0, 0);
      acc.flush(c);
      for (const sd of FINS) {
        const sx = sd === 'l' ? 1 : -1;
        rig.plant(c, sd, { dx: -sx * 0.09 * env, dy: 0.04 * env, dz: 0.1 * env, pitch: -0.2 * env, yaw: sx * 0.3 * env });
      }
    },
  };

  // ------------------------------------------------------------------ death: recoil, roll onto its side, fins flail then go limp, sink and settle
  const death: ClipSpec = {
    name: 'death', duration: 1.2, loop: false,
    pose(c) {
      const t = c.t;
      const acc = new Acc();
      const rec = ramp(t, 0, 0.12, 'out') * (1 - ramp(t, 0.12, 0.45));
      const fall = ramp(t, 0.1, 0.78, 'inout3');
      const settle = ramp(t, 0.78, 1.2, 'out');
      const wob = damped(Math.max(0, t - 0.78), 5, 6) * ramp(t, 0.78, 0.82);
      const th = deg(82) * fall + deg(-6) * settle + deg(5) * wob;
      c.set('root', -0.1 * rec, 0, th);
      c.move('root', 0.68 * s * Math.sin(th) - 0.05 * s * rec, 0.46 * s * Math.sin(th) + 0.3 * s * Math.sin(Math.PI * ramp(t, 0.02, 0.8)) - 0.02 * s * ramp(t, 0.12, 0.8, 'inout3') - 0.02 * s * wob, -0.16 * s * rec - 0.1 * s * fall);
      acc.add('chest', -0.15 * rec + 0.08 * fall, 0.1 * fall, 0);
      acc.add('neck', -0.3 * rec - 0.12 * fall, 0.15 * fall, 0.1 * fall);
      acc.add('head', -0.28 * rec - 0.1 * fall, 0.1 * fall, 0.15 * fall);
      acc.add('jaw', 0.4 * rec + 0.32 * fall + 0.06 * wob, 0, 0);
      // spine goes slack: the wave dies out while the tail curls to the side
      swim(acc, c.u, { pitch: 1.5 * (1 - fall), yaw: 0.4, cycles: 2.5, lag: 0.13 });
      SPINE.forEach((b, k) => acc.add(b, 0.05 * k * fall, 0, 0));
      // the tail twists back flat so the flukes lie on the ground instead of standing on edge in the snow
      (['tail1', 'tail2', 'tail3', 'fluke'] as const).forEach((b, k) => acc.add(b, 0, 0, -th * [0.2, 0.3, 0.3, 0.2][k]!));
      tailTips(acc, c.u, 2, 0.12, 0.9 * (1 - fall) + 0.3);
      acc.add('dorsal1', 0.2 * fall, 0, 0.2 * fall); acc.add('dorsal2', 0.3 * fall, 0, 0.2 * fall);
      // fins flail while falling, then flop limply (FK)
      const flail = (1 - ramp(t, 0.3, 0.6)) * ramp(t, 0.05, 0.2);
      const limp = ramp(t, 0.3, 0.8, 'out');
      for (const sd of FINS) {
        const sx = sd === 'l' ? 1 : -1;
        const fl = wave(t, 3.2, sd === 'l' ? 0 : 0.37) * flail;
        // limp = the paddles fold back along the flanks (never sprawl out through the ground)
        acc.add(`pec_${sd}`, 0.25 * fl - 0.1 * limp, sx * (-0.3 * fl + 1.3 * limp), sx * (0.35 * flail + 0.3 * fl - 0.2 * limp));
        acc.add(`pec2_${sd}`, 0.4 * fl + 0.3 * limp, sx * 0.2 * fl, sx * (0.25 * fl));
        acc.add(`pec3_${sd}`, 0.3 * fl + 0.3 * limp, 0, sx * (0.3 * fl - 0.2 * limp));
        acc.add(`pel_${sd}`, 0, sx * 1.2 * limp, sx * 0.4 * fl);
      }
      acc.flush(c);
    },
  };

  // ------------------------------------------------------------------ spawn: erupt from the ice (nose up), crash back to a hover, roar
  const spawn: ClipSpec = {
    name: 'spawn', duration: 1.2, loop: false,
    pose(c) {
      const t = c.t;
      const acc = new Acc();
      const burst = ramp(t, 0.05, 0.42, 'out');
      const land = ramp(t, 0.42, 0.9, 'inout3');
      const settle = ramp(t, 0.9, 1.2);
      const ring = damped(Math.max(0, t - 0.55), 4, 4);
      // root: starts buried (hidden below the ground plane), rockets up tilted, drops to the hover
      c.move('root', 0, -1.15 * s * (1 - burst) + 0.34 * s * burst * (1 - land) + 0.02 * s * ring, -0.2 * s * (1 - burst) + 0.1 * s * burst * (1 - land));
      c.set('root', -deg(62) * (1 - land) * (0.4 + 0.6 * burst) + 0.08 * ring, 0.1 * (1 - land) * wave(t, 3, 0), 0);
      swim(acc, c.u, { pitch: 1.6 * (1 - settle), yaw: 1.2 * (1 - settle), cycles: 1.6, lag: 0.12, phase: 0.2 });
      acc.add('chest', -0.12 * burst * (1 - land), 0, 0);
      acc.add('neck', -0.28 * burst * (1 - land) + 0.1 * land * (1 - settle), 0, 0);
      acc.add('head', -0.3 * burst * (1 - land) - 0.1 * settle, 0.15 * wave(t, 2, 0.1) * land * (1 - settle), 0);
      acc.add('jaw', 0.42 * burst * (1 - settle) + 0.15 * bump(t, 0.7, 0.78, 0.9, 1.1) + 0.05 * settle, 0, 0);
      tailTips(acc, c.u, 1.6, 0.12, 1.4 * (1 - settle), 0.2);
      acc.add('dorsal1', 0.2 * (1 - burst), 0, 0); acc.add('dorsal2', 0.3 * (1 - burst), 0, 0);
      pelvic(acc, t, 3, 1.2 * (1 - settle));
      acc.flush(c);
      for (const sd of FINS) {
        const sx = sd === 'l' ? 1 : -1;
        const fly = burst * (1 - land);
        // fins held out/up while airborne, then planted on touchdown
        const air = 1 - ramp(t, 0.5, 0.8);
        rig.plant(c, sd, { dx: sx * 0.12 * air, dy: 0.32 * fly + 0.25 * air * burst, dz: 0.08 * air, pitch: -0.4 * air, yaw: sx * 0.3 * air, roll: sx * 0.4 * air });
      }
    },
  };

  return [idle, walk, run, attack, hit, death, spawn];
}

/** authored ground speeds (m/s) = stride sweep / (duty x cycle) */
export const authoredSpeeds = (s: number): { walk: number; run: number } => ({
  walk: Number(((WALK.sweep * s) / (WALK.duty * WALK.cycle)).toFixed(3)),
  run: Number(((RUN.sweep * s) / (RUN.duty * RUN.cycle)).toFixed(3)),
});

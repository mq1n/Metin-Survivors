// Corpse ghost clips: a shambling, lurching revenant. Slow hunched hover with a limp, long arms that reach and drag, cloth
// strips trailing the body, a rattling jaw. attack = double claw rake (hit 0.4 s); attack2 = wail that blasts the shroud
// outward (the aura attack, hit 0.45 s).
import type { ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import { bump, damped, ramp } from '../../core/anim/curve.ts';
import { wave } from '../../core/anim/quadruped.ts';
import type { Vec3 } from '../../core/math.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { Rig } from './anim.ts';
import type { CorpseAnatomy } from './corpse.ts';

export function makeCorpseClips(a: CorpseAnatomy, skel: Skeleton): ClipSpec[] {
  const s = a.s;
  const R = new Rig(skel, s);
  const poleL: Vec3 = [0.5, -0.4, -0.8];
  const poleR: Vec3 = [-0.5, -0.4, -0.8];
  const strips = a.strips;

  /** strips: tilt each ring chain: `flare` pushes them outward, `trail` pushes them backward (-Z), plus travelling wave */
  const hem = (c: PoseCtx, u: number, o: { cyc: number; amp: number; flare: number; trail: number; droop?: number }): void => {
    strips.forEach((st, i) => {
      const w1 = wave(u, o.cyc, i * 0.21);
      const w2 = wave(u, o.cyc, i * 0.21 - 0.16);
      R.tilt(c, `strip_${st.name}1`, st.dir[0] * o.flare + 0.08 * o.amp * w1, st.dir[1] * o.flare - o.trail + 0.08 * o.amp * wave(u, o.cyc, i * 0.21 + 0.25));
      R.tilt(c, `strip_${st.name}2`, st.dir[0] * o.flare * 0.8 + 0.16 * o.amp * w2, st.dir[1] * o.flare * 0.8 - o.trail * 0.7 + 0.14 * o.amp * wave(u, o.cyc, i * 0.21 - 0.05));
    });
    R.tilt(c, 'hood_tail', 0.04 * o.amp * wave(u, o.cyc, 0.3), -o.trail * 0.6 + 0.06 * o.amp * wave(u, o.cyc, 0.1));
    R.tilt(c, 'sleeve_l', 0.07 * o.amp * wave(u, o.cyc, 0.2), -o.trail * 0.5 + 0.08 * o.amp * wave(u, o.cyc, 0.45));
    R.tilt(c, 'sleeve_r', -0.07 * o.amp * wave(u, o.cyc, 0.6), -o.trail * 0.5 + 0.08 * o.amp * wave(u, o.cyc, 0.85));
  };
  const fingers = (c: PoseCtx, curlL: number, curlR: number): void => {
    R.set(c, 'finger_l', curlL, 0, 0);
    R.set(c, 'finger_r', curlR, 0, 0);
  };
  const body = (c: PoseCtx, u: number, o: { bob: number; cyc: number; lean: number; lurch: number; head: number; limp: number }): void => {
    const b = wave(u, o.cyc, 0);
    R.move(c, 'root', o.lurch * s * wave(u, o.cyc / 2, 0.25), o.bob * s * b, 0);
    R.set(c, 'pelvis', -0.04 * b + o.lean * 0.3, 0.06 * wave(u, o.cyc / 2, 0.1), o.limp * wave(u, o.cyc / 2, 0.0));
    R.set(c, 'spine', o.lean * 0.4 + 0.03 * wave(u, o.cyc, 0.2), -0.05 * wave(u, o.cyc / 2, 0.1), -o.limp * 0.6 * wave(u, o.cyc / 2, 0.0));
    R.set(c, 'chest', o.lean * 0.3 + 0.03 * wave(u, o.cyc, 0.3), -0.1 * wave(u, o.cyc / 2, 0.1), 0.03 * wave(u, o.cyc / 2, 0.3));
    R.set(c, 'neck', o.lean * 0.2 + 0.05 + 0.03 * b, 0.1 * wave(u, o.cyc / 2, 0.2), 0.04 * wave(u, o.cyc / 2, 0.4));
    R.set(c, 'head', 0.04 * wave(u, o.cyc, 0.1) + o.head, 0.22 * wave(u, o.cyc / 2, 0.35), 0.1 * wave(u, o.cyc / 2, 0.05));
    R.set(c, 'jaw', 0.1 + 0.1 * wave(u, o.cyc * 2, 0.4), 0, 0);
    R.set(c, 'tali', 0.2 * wave(u, o.cyc, 0.2) - o.lean * 0.5, 0, 0.1 * wave(u, o.cyc, 0.5));
  };

  const idle: ClipSpec = {
    name: 'idle', duration: 1.8, loop: true,
    pose(c) {
      const u = c.u;
      body(c, u, { bob: 0.025, cyc: 1, lean: 0, lurch: 0.012, head: 0, limp: 0.03 });
      hem(c, u, { cyc: 1, amp: 1, flare: 0.04, trail: 0 });
      R.reach(c, 'l', [0.02 * wave(u, 1, 0), 0.04 * wave(u, 1, 0.2), 0.03 * wave(u, 1, 0.5)], poleL, [0.2 * wave(u, 1, 0.3), 0, 0]);
      R.reach(c, 'r', [0.02 * wave(u, 1, 0.5), 0.02 * wave(u, 1, 0.7), -0.03 * wave(u, 1, 0.1)], poleR, [-0.1 * wave(u, 1, 0.1), 0, 0]);
      fingers(c, 0.3 + 0.2 * wave(u, 2, 0.1), 0.35 + 0.25 * wave(u, 2, 0.6));
    },
  };
  const walk: ClipSpec = {
    name: 'walk', duration: 1.1, loop: true,
    pose(c) {
      const u = c.u;
      body(c, u, { bob: 0.045, cyc: 2, lean: 0.16, lurch: 0.03, head: 0.1, limp: 0.1 });
      hem(c, u, { cyc: 2, amp: 1.4, flare: 0.05, trail: 0.25 });
      R.reach(c, 'l', [0.03 * wave(u, 1, 0), 0.05 * wave(u, 2, 0.1) + 0.03, 0.08 * wave(u, 1, 0.5)], poleL, [0.2, 0, 0]);
      R.reach(c, 'r', [0.0, 0.04 * wave(u, 2, 0.6), -0.08 * wave(u, 1, 0.5) + 0.04], poleR, [-0.15, 0, 0]);
      fingers(c, 0.4 + 0.2 * wave(u, 2, 0.1), 0.4 + 0.2 * wave(u, 2, 0.6));
    },
  };
  const run: ClipSpec = {
    name: 'run', duration: 0.7, loop: true,
    pose(c) {
      const u = c.u;
      body(c, u, { bob: 0.06, cyc: 2, lean: 0.38, lurch: 0.03, head: 0.2, limp: 0.12 });
      hem(c, u, { cyc: 2, amp: 1.8, flare: 0.06, trail: 0.7 });
      R.reach(c, 'l', [0.0, 0.08 + 0.05 * wave(u, 1, 0), 0.2 + 0.1 * wave(u, 1, 0.25)], poleL, [0.4, 0, 0]);
      R.reach(c, 'r', [0.0, 0.05 + 0.05 * wave(u, 1, 0.5), 0.12 + 0.1 * wave(u, 1, 0.75)], poleR, [0.3, 0, 0]);
      fingers(c, 0.5, 0.5);
    },
  };

  // claw rake: both arms cock back and up, then the lunge rakes them down and forward (hit 0.4)
  const attack: ClipSpec = {
    name: 'attack', duration: 1.3, loop: false, hit: 0.4,
    pose(c) {
      const t = c.t;
      const wind = ramp(t, 0.0, 0.32, 'inout3') * (1 - ramp(t, 0.32, 0.4, 'in'));
      const rake = ramp(t, 0.32, 0.44, 'out') * (1 - ramp(t, 0.5, 1.05, 'inout3'));
      const bite = bump(t, 0.3, 0.4, 0.46, 0.7);
      R.move(c, 'root', 0, 0.01 * s * wind, -0.06 * s * wind + 0.22 * s * rake);
      R.set(c, 'pelvis', -0.08 * wind + 0.08 * rake, 0, 0);
      R.set(c, 'spine', -0.16 * wind + 0.12 * rake, 0.1 * wind - 0.1 * rake, 0);
      R.set(c, 'chest', -0.18 * wind + 0.18 * rake, 0.18 * wind - 0.15 * rake, 0);
      R.set(c, 'neck', -0.16 * wind + 0.14 * rake, 0, 0);
      R.set(c, 'head', -0.25 * wind + 0.2 * rake, 0.1 * wind, 0);
      R.set(c, 'jaw', 0.1 + 0.7 * wind + 0.5 * bite, 0, 0);
      R.set(c, 'tali', -0.5 * wind + 0.8 * rake, 0, 0);
      hem(c, c.u, { cyc: 2, amp: 1, flare: 0.05 + 0.15 * wind, trail: 0.7 * rake });
      R.reach(c, 'l', [0.05 * wind - 0.1 * rake, 0.25 * wind - 0.2 * rake, -0.2 * wind + 0.4 * rake], poleL, [-0.4 * wind + 0.5 * rake, 0, 0]);
      R.reach(c, 'r', [-0.1 * wind + 0.08 * rake, 0.5 * wind - 0.15 * rake, -0.15 * wind + 0.5 * rake], poleR, [-0.4 * wind + 0.5 * rake, 0, 0]);
      fingers(c, 0.1 + 0.9 * rake - 0.1 * wind, 0.1 + 0.9 * rake - 0.1 * wind);
    },
  };
  // wail: reel back, arms flung wide, jaw unhinged; at 0.45 s the scream blasts the shroud outward
  const attack2: ClipSpec = {
    name: 'attack2', duration: 1.2, loop: false, hit: 0.45,
    pose(c) {
      const t = c.t;
      const rear = ramp(t, 0.0, 0.4, 'inout3') * (1 - ramp(t, 0.85, 1.15, 'inout3'));
      const blast = bump(t, 0.4, 0.5, 0.78, 1.1);
      const shake = 0.05 * wave(t, 18, 0) * bump(t, 0.42, 0.5, 0.8, 1.0);
      R.move(c, 'root', shake * s, 0.04 * s * rear, -0.05 * s * rear);
      R.set(c, 'pelvis', -0.12 * rear, 0, 0);
      R.set(c, 'spine', -0.25 * rear, shake, 0);
      R.set(c, 'chest', -0.3 * rear - 0.05 * blast, shake, 0);
      R.set(c, 'neck', -0.4 * rear, 0, 0);
      R.set(c, 'head', -0.55 * rear, shake * 2, 0);
      R.set(c, 'jaw', 0.1 + 0.95 * rear, 0, 0);
      R.set(c, 'tali', -0.9 * rear, 0, 0.2 * shake * 5);
      hem(c, c.u, { cyc: 3, amp: 1 + 2 * blast, flare: 0.05 + 0.7 * blast + 0.2 * rear, trail: 0 });
      R.reach(c, 'l', [0.3 * rear, 0.28 * rear, -0.05 * rear], poleL, [-0.3 * rear, 0, 0]);
      R.reach(c, 'r', [-0.3 * rear, 0.45 * rear, 0.0], poleR, [-0.3 * rear, 0, 0]);
      fingers(c, 0.05 - 0.2 * rear * 0, 0.05 - 0.2 * rear * 0);
    },
  };

  const hit: ClipSpec = {
    name: 'hit', duration: 0.5, loop: false,
    pose(c) {
      const t = c.t;
      const imp = ramp(t, 0, 0.06, 'out') * Math.exp(-6 * Math.max(0, t - 0.06));
      const osc = damped(Math.max(0, t - 0.06), 6, 8);
      R.move(c, 'root', 0, -0.03 * s * imp, -0.16 * s * imp);
      R.set(c, 'pelvis', 0.12 * imp, 0.06 * osc, 0.08 * osc);
      R.set(c, 'spine', -0.22 * imp, 0.12 * osc, 0);
      R.set(c, 'chest', -0.3 * imp, -0.14 * osc, 0.06 * osc);
      R.set(c, 'neck', -0.35 * imp, 0.1 * osc, 0);
      R.set(c, 'head', -0.5 * imp, 0.2 * osc, 0.1 * osc);
      R.set(c, 'jaw', 0.1 + 0.8 * imp, 0, 0);
      R.set(c, 'tali', -0.6 * imp, 0, 0.3 * osc);
      hem(c, c.u, { cyc: 3, amp: 1.5, flare: 0.05, trail: 0.5 * imp });
      R.reach(c, 'l', [0.1 * imp, 0.12 * imp, -0.2 * imp], poleL, [0.3 * imp, 0, 0]);
      R.reach(c, 'r', [-0.1 * imp, 0.15 * imp, -0.15 * imp], poleR, [-0.3 * imp, 0, 0]);
      fingers(c, 0.1, 0.1);
    },
  };

  // death: staggers back, loses the will to float and folds forward into a heap of shroud
  const death: ClipSpec = {
    name: 'death', duration: 1.4, loop: false,
    pose(c) {
      const t = c.t;
      const stag = ramp(t, 0, 0.2, 'out') * (1 - ramp(t, 0.2, 0.45));
      const fold = ramp(t, 0.15, 1.0, 'inout3');
      const sink = ramp(t, 0.3, 1.3, 'in');
      const tremble = 0.04 * wave(t, 12, 0) * (1 - ramp(t, 0.4, 1.1));
      R.move(c, 'root', 0, -0.55 * s * sink, -0.12 * s * stag + 0.1 * s * fold);
      R.set(c, 'pelvis', -0.1 * stag + 0.35 * fold, tremble, 0.15 * fold);
      R.set(c, 'spine', -0.3 * stag + 0.55 * fold, tremble, 0);
      R.set(c, 'chest', -0.4 * stag + 0.6 * fold, tremble, 0.1 * fold);
      R.set(c, 'neck', -0.5 * stag + 0.5 * fold, 0, 0);
      R.set(c, 'head', -0.7 * stag + 0.7 * fold, 0.3 * fold, 0.2 * fold);
      R.set(c, 'jaw', 0.1 + 0.9 * stag + 0.3 * fold, 0, 0);
      R.set(c, 'tali', 0.6 * fold, 0, 0.3 * fold);
      hem(c, c.u, { cyc: 3, amp: 1.2 * (1 - fold), flare: 0.1 + 0.5 * fold, trail: -0.2 * fold });
      R.reach(c, 'l', [0.05 * fold, -0.4 * fold, -0.1 * stag], poleL, [0.5 * fold, 0, 0]);
      R.reach(c, 'r', [-0.05 * fold, -0.2 * fold, -0.2 * fold], poleR, [-0.5 * fold, 0, 0]);
      fingers(c, 0.2 + 0.3 * fold, 0.2 + 0.3 * fold);
    },
  };

  // spawn: coalesces from the ground mist, head bowed, then rises and unfolds its arms with a rattling gasp
  const spawn: ClipSpec = {
    name: 'spawn', duration: 1.4, loop: false,
    pose(c) {
      const t = c.t;
      const rise = ramp(t, 0.0, 0.8, 'inout3');
      const gasp = bump(t, 0.65, 0.8, 0.95, 1.3);
      const low = 1 - rise;
      R.move(c, 'root', 0, -0.85 * s * low, 0);
      R.set(c, 'pelvis', 0.3 * low, 0.5 * low, 0);
      R.set(c, 'spine', 0.35 * low - 0.1 * gasp, 0, 0);
      R.set(c, 'chest', 0.4 * low - 0.15 * gasp, 0, 0);
      R.set(c, 'neck', 0.4 * low - 0.2 * gasp, 0, 0);
      R.set(c, 'head', 0.5 * low - 0.35 * gasp, 0.3 * low, 0);
      R.set(c, 'jaw', 0.1 + 0.9 * gasp, 0, 0);
      R.set(c, 'tali', 0.5 * low, 0, 0);
      hem(c, c.u, { cyc: 3, amp: 1, flare: 0.05 + 0.4 * gasp, trail: -0.5 * low });
      R.reach(c, 'l', [-0.2 * low + 0.1 * gasp, -0.2 * low + 0.1 * gasp, -0.1 * low], poleL, [0.4 * low, 0, 0]);
      R.reach(c, 'r', [0.2 * low - 0.1 * gasp, -0.1 * low + 0.1 * gasp, 0], poleR, [-0.4 * low, 0, 0]);
      fingers(c, 0.6 * low + 0.3, 0.6 * low + 0.3);
    },
  };
  return [idle, walk, run, attack, attack2, hit, death, spawn];
}

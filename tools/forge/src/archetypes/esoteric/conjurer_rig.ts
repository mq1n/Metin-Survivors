// Conjurer talisman rig: each ring is ONE extra deforming bone on `root`, pivoting on the body axis, carrying its strips rigidly (see
// conjurer_strips.ts for the geometry). Spinning the bone about the ring's own (tilted) axis makes the strips orbit; a small precession
// of that axis makes the ring breathe; uniform scale + a forward shift flares / throws it. Loop clips use an orbit angle whose net turn
// per loop is a multiple of the ring's symmetry angle (360 / strips), so the orbit speed can differ per clip and still close seamlessly.
import type { PoseCtx } from '../../core/anim/clip.ts';
import { bump, ramp } from '../../core/anim/curve.ts';
import { type Quat, qaxis, qeuler, qmul } from '../../core/math.ts';
import type { BoneSpec } from '../../core/skin/skeleton.ts';
import { type RingDef, ringAxis } from './conjurer_strips.ts';

const TAU = Math.PI * 2;

export interface RingMotion {
  /** orbit direction */
  dir: 1 | -1;
  /** idle orbit: turns per idle loop (multiple of 1/count) */
  idleTurns: number;
  /** wobble amplitude (rad) and phase */
  wob: number;
  ph: number;
  /** bob amplitude (m) */
  bob: number;
  /** share of the forward cast throw (the steep upper rings mostly flare so their back arcs never swing over the crown); default 1 */
  throw?: number;
}

export interface EvoRing extends RingDef, RingMotion {}

export const ringBoneSpecs = (rings: EvoRing[]): BoneSpec[] => rings.map((r) => ({ name: r.bone, parent: 'root', pos: [0, r.y, 0] }));

/** angle swept (in turns) by an angular speed profile w(t) [turns/s] over [0, t] */
function turns(w: (t: number) => number, t: number): number {
  const n = Math.max(8, Math.ceil(t * 40));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += w(((i + 0.5) / n) * t);
  return (sum * t) / n;
}

export interface CastTimes {
  /** impact time of `attack` (s) */
  hit: number;
  /** attack duration (s) */
  dur: number;
}

/** pose every ring bone for the clip */
export function poseEvoRings(rings: EvoRing[], clip: string, c: PoseCtx, tm: CastTimes): void {
  const u = c.u, t = c.t;
  for (const r of rings) {
    const sym = 1 / r.count;
    const axis = ringAxis(r);
    let rev = 0; // turns about the ring axis
    let px = 0, pz = 0; // precession of the axis (rad about world X / Z)
    let sc = 1;
    let dy = 0;
    let dz = 0;
    const w1 = Math.sin(TAU * u + r.ph);
    const w2 = Math.cos(TAU * u + r.ph);
    switch (clip) {
      case 'idle': {
        rev = r.idleTurns * u;
        px = r.wob * w1;
        pz = r.wob * w2;
        dy = r.bob * Math.sin(TAU * u + r.ph * 1.7);
        break;
      }
      case 'walk': {
        // positive x precession only ever dips the (low) front arc further: the rings stream back over the shoulders while moving
        rev = sym * 2 * u;
        px = r.wob * 1.2 * w1 + 0.05;
        pz = r.wob * 1.2 * w2;
        dy = r.bob * 0.8 * Math.sin(TAU * 2 * u + r.ph);
        break;
      }
      case 'run': {
        rev = sym * 4 * u;
        px = r.wob * 1.4 * w1 + 0.14;
        pz = r.wob * 1.4 * w2;
        dy = r.bob * 0.6 * Math.sin(TAU * 2 * u + r.ph);
        break;
      }
      case 'attack': {
        // gather: spin up, draw in and dip toward the hips; release: burst out and forward at the hit (wide, so the paper flies past the
        // flanks, never across the chest); settle with a damped overshoot
        const spin = (x: number): number => ramp(x, 0.06, tm.hit, 'in') * (1 - ramp(x, tm.hit, tm.hit + 0.6, 'out'));
        rev = turns((x) => 0.28 + 2.6 * spin(x), t);
        const draw = ramp(t, 0.04, tm.hit - 0.12, 'out') * (1 - ramp(t, tm.hit - 0.12, tm.hit, 'in'));
        const burst = ramp(t, tm.hit - 0.12, tm.hit, 'out');
        const settle = ramp(t, tm.hit + 0.04, tm.hit + 0.7, 'smooth');
        const over = 1 + 0.5 * burst * (1 - settle);
        sc = (1 - 0.18 * draw) * (burst > 0 ? over : 1);
        dy = -0.05 * draw - 0.08 * burst * (1 - settle);
        dz = 0.45 * (r.throw ?? 1) * burst * (1 - settle) * (1 - 0.25 * Math.sin(settle * Math.PI));
        px = 0.12 * burst * (1 - settle) + r.wob * w1 * 0.5;
        pz = r.wob * w2 * 0.5;
        break;
      }
      case 'hit': {
        // the rings jolt: a forward-dipping shudder (never tipping the front arc up into the chest)
        const k = Math.exp(-5 * t);
        rev = 0.28 * t + (1.1 * (1 - k)) / 5;
        px = 0.12 * k * (1 + Math.sin(TAU * 3 * t + r.ph));
        pz = 0.2 * k * Math.cos(TAU * 3 * t + r.ph);
        sc = 1 - 0.1 * k;
        dz = -0.1 * k;
        break;
      }
      case 'death': {
        // the strips lose their hold: the spin runs down, the rings tip forward, drift away from the body (it falls backward) and sink,
        // then the paper burns out
        const d = ramp(t, 0.05, 0.85, 'in');
        rev = 0.28 * t - 0.1 * t * t;
        px = 0.5 * d + r.wob * w1 * (1 - d);
        pz = 0.4 * d * Math.cos(r.ph + 1);
        dy = -r.y * 0.85 * d * d;
        dz = 0.3 * d;
        sc = 1 - 0.95 * ramp(t, 0.7, 1.5, 'in');
        break;
      }
      case 'spawn': {
        // summoned: a fast spiral out of the ground that settles into the idle orbit
        const g = ramp(t, 0.0, 0.9, 'out');
        rev = turns((x) => 0.28 + 3.2 * (1 - ramp(x, 0.1, 1.3, 'smooth')) ** 2, t);
        sc = 0.05 + 0.95 * g;
        dy = -r.y * 0.9 * (1 - g) ** 2;
        px = r.wob * w1 * g + 0.4 * (1 - g);
        pz = r.wob * w2 * g;
        break;
      }
      default:
        break;
    }
    const q: Quat = qmul(qeuler(px, 0, pz), qaxis(axis, r.dir * TAU * rev));
    c.setQ(r.bone, q);
    c.move(r.bone, 0, dy, dz);
    if (sc !== 1) c.scale(r.bone, sc);
  }
}

export { bump };

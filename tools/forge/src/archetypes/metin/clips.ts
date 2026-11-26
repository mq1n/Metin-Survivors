// Clips for rigid-piece metins (see rig.ts): drop (0.9 s, matches sim DROP_ANIM), idle (loop), hit, pulse (loop, awakened),
// shatter (2.2 s, matches sim BREAK_ANIM; every piece is scaled to ~0 on the last frame so the model has vanished).
// Translations are world offsets from the rest pose (rest rotations are identity, parent is `root`).
import { type ClipSpec, type PoseCtx } from '../../core/anim/clip.ts';
import { ramp } from '../../core/anim/curve.ts';
import type { Quat, Vec3 } from '../../core/math.ts';
import { QIDENT, qaxis, qmul, qnorm, qrotate, vnorm } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { Piece, Rig } from './rig.ts';

export interface ClipTune {
  /** size relative to the 3 m metin stone (amplitudes scale with sqrt(S), distances with S) */
  S: number;
  seed: number | string;
  /** gravity (m/s^2) used by the shatter sim */
  g?: number;
  /** fragment launch speed multiplier */
  speed?: number;
  /** extra pieces that never move on their own (static scenery like ground slabs) are still shatter-simulated unless kick = 0 */
  idleDuration?: number;
  /** R2 (static route): shatter fade start (default 1.5 s) + random spread (default 0.35 s) + fade length (default: to the end of the clip) */
  fadeAt?: number;
  fadeSpread?: number;
  fadeLen?: number;
  /** r5 (static route): multiplier on the upward launch velocity only (a lower arc keeps the burst inside the game camera's frame) */
  arc?: number;
  /** r5 ship (static route): per-piece loft [h0, h1] on the centroid height h (0..1): pieces at h >= h1 keep the full upward launch (x1), pieces at
   *  h <= h0 take `arc`, linear between, so the crown still pops while the base stays low in the game camera's frame (absent = `arc` for every piece) */
  loft?: [number, number];
  /** r5 (static route): pieces that never fly (the intact shell): they take the charge shudder, then vanish in ONE frame at the earliest
   *  launch of the other chunk pieces (no rising, spinning, shrinking ghost of the whole stone inside the burst) */
  pop?: string[];
  /** r6 (static route, opt-in): all pieces are simulated TOGETHER: the ground test uses the lowest of the piece's hull points under its CURRENT rotation
   *  (no chunk buried, none floating on a bounding-radius guess), and resting / landing pieces are pushed apart in x / z (spheres of `r` x the piece's
   *  equivalent radius), so the heap does not interpenetrate. No extra rng call: the launch of every piece is the same as without it. */
  contact?: { r?: number; iters?: number };
  /** r6 (static route, opt-in): the pile HOLDS full size and sinks into the ground from `at` s (+ up to `spread` s per piece) over `len` s instead of the centroid
   *  shrink (the "deflating rock"); the very last frame still scales to ~0 (the model has vanished when the sim removes it) */
  sink?: { at: number; len: number; spread?: number };
  /** r7 (static route, opt-in): outward launch speed multiplier by the piece's height h (0..1): pieces at h = 0 take k0, at h = 1 take k1 (linear): the
   *  base slumps where it stood (a collapse with a core mass, no hollow ring), the crown is thrown wider. Applied after the launch draws (same rng order). */
  spreadH?: [number, number];
  /** r7 (static route, opt-in): the GEOMETRY of every solid piece stays within this horizontal radius (model metres) of the stone's axis: the centroid is held at
   *  `reach` - the piece's bounding radius (never closer than where it started), the outward velocity is dropped there. The great metin's 8 m spawn clearance /
   *  the small stone's METIN_CLEAR_R hold for the whole pile, whatever the launch draws. */
  reach?: number;
  /** r7 (static route, with `contact`): a grounded piece turns toward lying on its flattest side (its thinnest hull direction to the vertical, `rate` rad/s), so the
   *  pile lies low instead of standing chunks on end (a tall chunk upright buried the hero at the game camera) */
  settle?: { rate: number };
  /** r7 (static route, with `pop`): the intact shell SWELLS by this fraction once per awakened pulse loop (the stone visibly throbs while awake; its chunks
   *  are hidden behind the shell outside the shatter, so the per-chunk pulse wave never showed on it) */
  pulseSwell?: number;
}

/** r7: outward speed multiplier of a piece at height h (tune.spreadH; 1 when unset) */
function spreadK(tune: ClipTune, h: number): number {
  if (!tune.spreadH) return 1;
  const k = Math.min(1, Math.max(0, h));
  return tune.spreadH[0] + (tune.spreadH[1] - tune.spreadH[0]) * k;
}

/** r7: holds a solid piece's centroid inside tune.reach (minus its bounding radius; never inside its own rest radius); returns the clamped offset, or null when inside */
function reachClamp(tune: ClipTune, p: Piece, pos: Vec3): Vec3 | null {
  if (tune.reach === undefined || p.role === 'shard') return null;
  const cx = p.c[0] + pos[0], cz = p.c[2] + pos[2];
  const d = Math.hypot(cx, cz);
  const lim = Math.max(Math.hypot(p.c[0], p.c[2]), tune.reach - p.rad);
  if (d <= lim || d < 1e-6) return null;
  const k = lim / d;
  return [cx * k - p.c[0], pos[1], cz * k - p.c[2]];
}

const TAU = Math.PI * 2;

const stretch = (t: number): number => {
  // vertical stretch factor k(t): stretched while falling, squashed on impact at 0.07 s, then a damped rebound
  const ti = 0.07;
  if (t < ti) {
    const u = t / ti;
    return 0.07 + (-0.09 - 0.07) * u * u;
  }
  const s = t - ti;
  return -0.09 * Math.exp(-4.4 * s) * Math.cos(TAU * 2.1 * s);
};

function poseDrop(rig: Rig, tune: ClipTune): (c: PoseCtx) => void {
  const S = tune.S;
  const rng = new Rng(`${tune.seed}:drop`);
  const per = rig.pieces.map(() => ({ ph: rng.next() * TAU, hover: 1.4 + rng.next() * 1.4, spread: 0.2 + rng.next() * 0.35, hop: 0.07 + rng.next() * 0.07 }));
  return (c) => {
    const t = c.t;
    const k = stretch(t);
    rig.pieces.forEach((p, i) => {
      const q = per[i]!;
      if (p.role === 'chunk' || p.role === 'core') {
        // vertical squash/stretch about the ground, volume-ish compensation sideways; bases are crushed harder
        const crush = 1.25 - p.h * 0.5;
        const dy = k * crush * p.c[1];
        const lat = -k * 0.4 * Math.hypot(p.c[0], p.c[2]);
        c.move(p.name, p.radial[0] * lat, dy, p.radial[2] * lat);
        const wob = 0.035 * Math.exp(-5 * t) * Math.sin(TAU * 4 * t + q.ph) * (0.4 + p.h);
        c.set(p.name, wob * p.radial[2], 0, -wob * p.radial[0]);
      } else if (p.role === 'debris') {
        // falls out of the meteor wake onto its resting place after the impact, hops once, settles
        const hover = q.hover * Math.sqrt(S);
        const u = Math.min(1, t / 0.56);
        const fall = 1 - u * u;
        let dy = hover * fall;
        const hop = Math.max(0, (t - 0.56) / 0.24);
        if (hop > 0 && hop < 1) dy += q.hop * Math.sqrt(S) * 4 * hop * (1 - hop);
        const out = q.spread * S * fall;
        c.move(p.name, -p.radial[0] * out, dy, -p.radial[2] * out);
        const tumble = fall * 1.1;
        c.set(p.name, tumble * Math.sin(q.ph), tumble * 0.6, tumble * Math.cos(q.ph));
      } else if (p.orbit) {
        // shards burst out of the wake onto their orbit; the orbit offset itself is the idle motion at t = 0 (zero)
        const decay = 1 - ramp(t, 0, 0.75, 'out');
        const wake = Math.hypot(p.c[0] - (p.orbit.cx ?? 0), p.c[2] - (p.orbit.cz ?? 0));
        c.move(p.name, -p.radial[0] * wake * 0.7 * decay, (1.2 * Math.sqrt(S)) * decay, -p.radial[2] * wake * 0.7 * decay);
        c.set(p.name, 0, decay * 5, 0);
      }
    });
  };
}

function orbitOffset(p: Piece, u: number, turnsScale = 1): { off: Vec3; spin: number; wob: number } {
  const o = p.orbit!;
  const cx = o.cx ?? 0, cz = o.cz ?? 0;
  const phi = TAU * o.turns * turnsScale * u;
  const x0 = cx + o.r * Math.cos(o.a0), z0 = cz + o.r * Math.sin(o.a0);
  const x1 = cx + o.r * Math.cos(o.a0 + phi), z1 = cz + o.r * Math.sin(o.a0 + phi);
  const dy = o.bob * Math.sin(TAU * o.bobCycles * turnsScale * u);
  return { off: [x1 - x0, dy, z1 - z0], spin: TAU * o.spin * turnsScale * u, wob: (o.wob ?? 0.18) * Math.sin(TAU * o.bobCycles * turnsScale * u + 1.3) };
}

function poseIdle(rig: Rig, tune: ClipTune): (c: PoseCtx) => void {
  return (c) => {
    for (const p of rig.pieces) {
      if (p.bob) c.move(p.name, 0, p.bob.amp * Math.sin(TAU * p.bob.cycles * c.u + (p.bob.phase ?? 0)) - p.bob.amp * Math.sin(p.bob.phase ?? 0), 0);
      if (p.role === 'shard' && p.orbit) {
        const { off, spin, wob } = orbitOffset(p, c.u);
        c.move(p.name, off[0], off[1], off[2]);
        c.set(p.name, wob, spin, wob * 0.6);
      } else if (p.role === 'core') {
        const s = 1 + 0.035 * Math.sin(TAU * 2 * c.u);
        c.scale(p.name, s);
      }
    }
    void tune;
  };
}

function poseHit(rig: Rig, tune: ClipTune): (c: PoseCtx) => void {
  const S = tune.S;
  const rng = new Rng(`${tune.seed}:hit`);
  const ph = rig.pieces.map(() => rng.next() * TAU);
  return (c) => {
    const t = c.t;
    const env = Math.exp(-8 * t);
    const k = -0.04 * Math.sin(TAU * 3.2 * t) * Math.exp(-6.5 * t);
    rig.pieces.forEach((p, i) => {
      if (p.role === 'chunk' || p.role === 'core') {
        c.move(p.name, 0, k * p.c[1], 0);
        const a = 0.028 * env * Math.sin(TAU * 11 * t + ph[i]!) * (0.5 + p.h);
        c.set(p.name, a * p.radial[2], 0, -a * p.radial[0]);
      } else if (p.role === 'shard') {
        const kick = 0.16 * Math.sqrt(S) * Math.sin(TAU * 2.2 * t) * Math.exp(-5 * t);
        c.move(p.name, p.radial[0] * kick, 0.05 * Math.sin(TAU * 3 * t) * env, p.radial[2] * kick);
      }
    });
  };
}

function posePulse(rig: Rig, tune: ClipTune): (c: PoseCtx) => void {
  const S = tune.S;
  const swell = new Set(tune.pulseSwell ? tune.pop ?? [] : []);
  return (c) => {
    rig.pieces.forEach((p) => {
      if (swell.has(p.name)) c.scale(p.name, 1 + (tune.pulseSwell ?? 0) * (0.5 - 0.5 * Math.cos(TAU * c.u)));
      if (p.bob) c.move(p.name, 0, p.bob.amp * 0.35 * Math.sin(TAU * c.u), 0);
      if (p.role === 'chunk') {
        // glow wave travelling up the stone: every plate pushes out a hair, exposing the seams
        const w = 0.5 - 0.5 * Math.cos(TAU * (c.u - p.h * 0.55));
        const amp = 0.022 * Math.sqrt(S) * w;
        c.move(p.name, p.radial[0] * amp, amp * 0.5, p.radial[2] * amp);
      } else if (p.role === 'core') {
        c.scale(p.name, 1 + 0.07 * (0.5 - 0.5 * Math.cos(TAU * c.u)));
      } else if (p.role === 'shard' && p.orbit) {
        const { off, spin, wob } = orbitOffset(p, c.u, 1);
        const lift = 0.1 * Math.sqrt(S) * (0.5 - 0.5 * Math.cos(TAU * 2 * c.u));
        c.move(p.name, off[0] * 0.5, off[1] + lift, off[2] * 0.5);
        c.set(p.name, wob, spin * 2, wob * 0.6);
      }
    });
    void tune;
  };
}

interface Traj {
  /** samples at 1/DT Hz */
  pos: Vec3[];
  rot: Quat[];
  tEnd: number;
}

const DT = 1 / 120;

function simulate(p: Piece, tune: ClipTune, rng: Rng, duration: number): { traj: Traj; shrinkAt: number; delay: number } {
  const S = tune.S;
  const g = tune.g ?? 14;
  const speed = (tune.speed ?? 1) * Math.sqrt(S);
  const kick = p.kick ?? 1;
  const delay = 0.2 + 0.05 * (1 - p.h) + rng.next() * 0.05;
  // launch velocity: away from the core, upward bias grows with height, lighter pieces fly faster
  const light = 1 / (0.6 + p.rad * 1.2 / Math.sqrt(S));
  const out = (1.6 + rng.next() * 2.4) * speed * light * kick * spreadK(tune, p.h);
  const arc0 = tune.arc ?? 1;
  const arcK = tune.loft ? arc0 + (1 - arc0) * Math.min(1, Math.max(0, (p.h - tune.loft[0]) / Math.max(1e-6, tune.loft[1] - tune.loft[0]))) : arc0;
  const up = (2.2 + rng.next() * 3.0 + p.h * 3.5) * speed * kick * (p.role === 'shard' ? 1.2 : 1) * arcK;
  const tang = (rng.next() - 0.5) * 2.4 * speed;
  let v: Vec3 = [p.radial[0] * out - p.radial[2] * tang, up, p.radial[2] * out + p.radial[0] * tang];
  let pos: Vec3 = [0, 0, 0];
  let q: Quat = QIDENT;
  const axis = vnorm([rng.next() - 0.5, rng.next() - 0.5 + 0.1, rng.next() - 0.5]);
  let w = (5 + rng.next() * 8) / Math.sqrt(Math.max(0.6, p.rad / Math.sqrt(S) * 2));
  // lowest allowed centroid offset so the piece rests on y = 0 (rotation-agnostic: use a fraction of the bounding radius)
  const floorY = -(p.c[1] - Math.min(-p.low, p.rad * 0.6)) + (p.role === 'shard' ? -1e9 : 0);
  const steps = Math.ceil(duration / DT) + 1;
  const poss: Vec3[] = [], rots: Quat[] = [];
  let rest = false;
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    poss.push([pos[0], pos[1], pos[2]]);
    rots.push(q);
    if (t < delay || rest) continue;
    v = [v[0], v[1] - g * DT, v[2]];
    pos = [pos[0] + v[0] * DT, pos[1] + v[1] * DT, pos[2] + v[2] * DT];
    q = qnorm(qmul(qaxis(axis, w * DT), q));

    if (pos[1] < floorY) {
      pos = [pos[0], floorY, pos[2]];
      if (Math.abs(v[1]) < 0.9) {
        v = [v[0] * 0.55, 0, v[2] * 0.55];
        w *= 0.6;
        if (Math.hypot(v[0], v[2]) < 0.2) { v = [0, 0, 0]; w = 0; rest = true; }
      } else {
        v = [v[0] * 0.62, -v[1] * 0.34, v[2] * 0.62];
        w *= 0.55;
      }
    }
    if (p.role !== 'shard') { v = [v[0] * (1 - 0.35 * DT), v[1], v[2] * (1 - 0.35 * DT)]; }
    const rc = reachClamp(tune, p, pos);
    if (rc) { pos = rc; v = [0, v[1], 0]; }
  }
  return { traj: { pos: poss, rot: rots, tEnd: (steps - 1) * DT }, shrinkAt: (tune.fadeAt ?? 1.5) + rng.next() * (tune.fadeSpread ?? 0.35), delay };
}

/** r6: up to 26 support points (+ the 8 box corners) of a piece about its centroid: the rotation-aware ground test takes the lowest of them */
function hullPoints(p: Piece): Vec3[] {
  if (p.hull?.length) return p.hull;
  const vs: Vec3[] = [];
  for (const poly of p.polys) for (const v of poly.vertices()) vs.push([v[0] - p.c[0], v[1] - p.c[1], v[2] - p.c[2]]);
  if (!vs.length) {
    // no geometry on the piece: the old rotation-agnostic guess as a small octahedron
    const r = Math.min(-p.low, p.rad * 0.6);
    return [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]];
  }
  if (vs.length <= 48) return vs;
  const out: Vec3[] = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (!x && !y && !z) continue;
    let best = vs[0]!, bd = -Infinity;
    for (const v of vs) { const d = v[0] * x + v[1] * y + v[2] * z; if (d > bd) { bd = d; best = v; } }
    out.push(best);
  }
  return out;
}

/**
 * r6 (tune.contact): the shatter of all pieces stepped together. The launch draws are exactly those of simulate() (same fork, same order), the differences are
 * (1) the ground test: the lowest hull point under the CURRENT rotation rests on y = 0, and (2) a push-apart in x / z between grounded pieces (equivalent spheres).
 */
function simulateTogether(rig: Rig, tune: ClipTune, rng: Rng, duration: number): { traj: Traj; shrinkAt: number; delay: number }[] {
  const S = tune.S;
  const g = tune.g ?? 14;
  const speed = (tune.speed ?? 1) * Math.sqrt(S);
  const st = rig.pieces.map((p) => {
    const r = rng.fork(p.name);
    const kick = p.kick ?? 1;
    const delay = 0.2 + 0.05 * (1 - p.h) + r.next() * 0.05;
    const light = 1 / (0.6 + p.rad * 1.2 / Math.sqrt(S));
    const out = (1.6 + r.next() * 2.4) * speed * light * kick * spreadK(tune, p.h);
    const arc0 = tune.arc ?? 1;
    const arcK = tune.loft ? arc0 + (1 - arc0) * Math.min(1, Math.max(0, (p.h - tune.loft[0]) / Math.max(1e-6, tune.loft[1] - tune.loft[0]))) : arc0;
    const up = (2.2 + r.next() * 3.0 + p.h * 3.5) * speed * kick * (p.role === 'shard' ? 1.2 : 1) * arcK;
    const tang = (r.next() - 0.5) * 2.4 * speed;
    const v: Vec3 = [p.radial[0] * out - p.radial[2] * tang, up, p.radial[2] * out + p.radial[0] * tang];
    const axis = vnorm([r.next() - 0.5, r.next() - 0.5 + 0.1, r.next() - 0.5]);
    const w = (5 + r.next() * 8) / Math.sqrt(Math.max(0.6, p.rad / Math.sqrt(S) * 2));
    const shrinkAt = (tune.fadeAt ?? 1.5) + r.next() * (tune.fadeSpread ?? 0.35);
    const hull = hullPoints(p);
    // equivalent radius: the mean half extent of the hull box (a slab gets a small sphere, so slabs may still lie close)
    let mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const h of hull) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k]!, h[k]!); mx[k] = Math.max(mx[k]!, h[k]!); }
    const req = Math.cbrt(Math.max(1e-6, (mx[0] - mn[0]) * (mx[1] - mn[1]) * (mx[2] - mn[2]))) * 0.5 * (tune.contact?.r ?? 0.85);
    // r7 (tune.settle): the piece's thinnest direction among 13 (axes, face and space diagonals) of its hull: the axis it lies on
    let thin: Vec3 = [0, 1, 0], thinW = Infinity;
    if (tune.settle) for (const d0 of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1], [1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1]] as Vec3[]) {
      const d = vnorm(d0);
      let lo = Infinity, hi = -Infinity;
      for (const h of hull) { const x = h[0] * d[0] + h[1] * d[1] + h[2] * d[2]; lo = Math.min(lo, x); hi = Math.max(hi, x); }
      if (hi - lo < thinW) { thinW = hi - lo; thin = d; }
    }
    return { p, delay, v, w, axis, shrinkAt, hull, req, thin, pos: [0, 0, 0] as Vec3, q: QIDENT as Quat, rest: false, ground: false, poss: [] as Vec3[], rots: [] as Quat[] };
  });
  const lowest = (s: (typeof st)[number]): number => { let m = Infinity; for (const h of s.hull) m = Math.min(m, qrotate(s.q, h)[1]); return m; };
  const steps = Math.ceil(duration / DT) + 1;
  const solid = (s: (typeof st)[number]): boolean => s.p.role !== 'shard' && !s.p.sliver;
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    for (const s of st) { s.poss.push([s.pos[0], s.pos[1], s.pos[2]]); s.rots.push(s.q); }
    for (const s of st) {
      if (t < s.delay || s.rest) continue;
      s.v = [s.v[0], s.v[1] - g * DT, s.v[2]];
      s.pos = [s.pos[0] + s.v[0] * DT, s.pos[1] + s.v[1] * DT, s.pos[2] + s.v[2] * DT];
      s.q = qnorm(qmul(qaxis(s.axis, s.w * DT), s.q));
      if (s.p.role !== 'shard') {
        const floorY = -(s.p.c[1] + lowest(s));
        if (s.pos[1] < floorY) {
          s.pos = [s.pos[0], floorY, s.pos[2]];
          s.ground = true;
          if (Math.abs(s.v[1]) < 0.9) {
            s.v = [s.v[0] * 0.55, 0, s.v[2] * 0.55];
            s.w *= 0.6;
            if (Math.hypot(s.v[0], s.v[2]) < 0.2) { s.v = [0, 0, 0]; s.w = 0; s.rest = true; }
          } else {
            s.v = [s.v[0] * 0.62, -s.v[1] * 0.34, s.v[2] * 0.62];
            s.w *= 0.55;
          }
        }
        s.v = [s.v[0] * (1 - 0.35 * DT), s.v[1], s.v[2] * (1 - 0.35 * DT)];
      }
    }
    // r7 (tune.settle): grounded pieces (resting ones too) turn toward their flattest side, then re-seat on the floor under the new rotation
    if (tune.settle) for (const s of st) {
      if (!s.ground || s.p.role === 'shard' || t < s.delay) continue;
      const a = qrotate(s.q, s.thin);
      const tgt: Vec3 = a[1] >= 0 ? [0, 1, 0] : [0, -1, 0];
      const c = Math.min(1, Math.max(-1, a[0] * tgt[0] + a[1] * tgt[1] + a[2] * tgt[2]));
      const ang = Math.acos(c);
      if (ang < 1e-3) continue;
      const ax: Vec3 = [a[1] * tgt[2] - a[2] * tgt[1], a[2] * tgt[0] - a[0] * tgt[2], a[0] * tgt[1] - a[1] * tgt[0]];
      if (Math.hypot(ax[0], ax[1], ax[2]) < 1e-6) continue;
      s.q = qnorm(qmul(qaxis(vnorm(ax), Math.min(ang, tune.settle.rate * DT)), s.q));
      const floorY = -(s.p.c[1] + lowest(s));
      if (s.rest || s.pos[1] < floorY) s.pos = [s.pos[0], floorY, s.pos[2]];
    }
    // push-apart (x / z only, inverse-volume weighted) between pieces that have touched the ground; a few relaxation passes per step
    for (let it = 0; it < (tune.contact?.iters ?? 2); it++) {
      for (let a = 0; a < st.length; a++) {
        const A = st[a]!;
        if (!A.ground || !solid(A) || t < A.delay) continue;
        for (let b = a + 1; b < st.length; b++) {
          const B = st[b]!;
          if (!B.ground || !solid(B) || t < B.delay) continue;
          const ax = A.p.c[0] + A.pos[0], az = A.p.c[2] + A.pos[2], bx = B.p.c[0] + B.pos[0], bz = B.p.c[2] + B.pos[2];
          const ay = A.p.c[1] + A.pos[1], by = B.p.c[1] + B.pos[1];
          const dx = bx - ax, dz = bz - az, dy = by - ay;
          const d = Math.hypot(dx, dy, dz), need = A.req + B.req;
          if (d >= need || d < 1e-6) continue;
          const dh = Math.hypot(dx, dz);
          const ux = dh > 1e-4 ? dx / dh : Math.cos(a * 2.399 + b), uz = dh > 1e-4 ? dz / dh : Math.sin(a * 2.399 + b);
          const ma = A.req ** 3, mb = B.req ** 3, push = need - d;
          const ka = mb / (ma + mb), kb = ma / (ma + mb);
          A.pos = [A.pos[0] - ux * push * ka, A.pos[1], A.pos[2] - uz * push * ka];
          B.pos = [B.pos[0] + ux * push * kb, B.pos[1], B.pos[2] + uz * push * kb];
        }
      }
    }
    // r7 (tune.reach): the pile stays inside the clearance: a centroid past reach - rad is held there and its outward motion dropped
    if (tune.reach !== undefined) for (const s of st) {
      if (t < s.delay) continue;
      const rc = reachClamp(tune, s.p, s.pos);
      if (rc) { s.pos = rc; s.v = [0, s.v[1], 0]; }
    }
  }
  return st.map((s) => ({ traj: { pos: s.poss, rot: s.rots, tEnd: (steps - 1) * DT }, shrinkAt: s.shrinkAt, delay: s.delay }));
}

function poseShatter(rig: Rig, tune: ClipTune, duration: number): (c: PoseCtx) => void {
  const rng = new Rng(`${tune.seed}:shatter`);
  const sims = tune.contact ? simulateTogether(rig, tune, rng, duration) : rig.pieces.map((p) => simulate(p, tune, rng.fork(p.name), duration));
  // r6: per-piece sink start (deterministic from the name, no rng call) and depth (the piece's own bounding radius + its lowest point: fully under the ground)
  const sinkAt = rig.pieces.map((p, i) => (tune.sink ? tune.sink.at + (tune.sink.spread ?? 0) * ((Math.sin((i + 1) * 12.9898 + p.c[0] * 78.233) * 43758.5453) % 1 + 1) % 1 : 0));
  const S = tune.S;
  // r5: `pop` pieces vanish at the earliest launch of the flying chunks (one frame), never before (the chunks are still in place behind them)
  const pop = new Set(tune.pop ?? []);
  const flyDelays = rig.pieces.flatMap((p, i) => (!pop.has(p.name) && (p.role === 'chunk' || p.role === 'core') ? [sims[i]!.delay] : []));
  const popT = flyDelays.length ? Math.min(...flyDelays) : 0.2;
  return (c) => {
    const t = c.t;
    rig.pieces.forEach((p, i) => {
      const { traj, shrinkAt, delay } = sims[i]!;
      if (pop.has(p.name)) {
        // the charge shudder / swell of the whole stone, then gone: scale 1 up to the last frame before popT, ~0 from the first frame at / after it
        const k = ramp(t, 0, popT, 'in');
        const sh = Math.sin(t * 150 + i * 1.7) * 0.014 * Math.sqrt(S) * k, sw = 0.03 * Math.sqrt(S) * k;
        c.move(p.name, p.radial[0] * sw + sh, sh * 0.7 + sw * 0.4 * p.h, p.radial[2] * sw - sh);
        c.scale(p.name, t + 1e-6 < popT ? 1 : 0.0005);
        return;
      }
      const f = Math.min(t / DT, traj.pos.length - 1);
      const f0 = Math.floor(f), f1 = Math.min(traj.pos.length - 1, f0 + 1), a = f - f0;
      const pa = traj.pos[f0]!, pb = traj.pos[f1]!;
      let dx = pa[0] + (pb[0] - pa[0]) * a, dy = pa[1] + (pb[1] - pa[1]) * a, dz = pa[2] + (pb[2] - pa[2]) * a;
      if (t < delay) {
        // charge: seams flare, the whole stone shudders harder and swells before it blows
        const k = ramp(t, 0, delay, 'in');
        const sh = Math.sin(t * 150 + i * 1.7) * 0.014 * Math.sqrt(S) * k;
        const sw = 0.03 * Math.sqrt(S) * k;
        dx += p.radial[0] * sw + sh; dy += sh * 0.7 + sw * 0.4 * p.h; dz += p.radial[2] * sw - sh;
      }
      if (tune.sink && p.role !== 'shard' && !p.sliver && p.role !== 'core') {
        // r6: the resting pile sinks straight down into the ground (depth = the piece's bounding diameter), never shrinks; gone at the clip end
        const k = ramp(t, sinkAt[i]!, Math.min(duration - 1 / 30, sinkAt[i]! + tune.sink.len), 'in');
        dy -= k * (2 * p.rad + 0.05);
      }
      c.move(p.name, dx, dy, dz);
      const qa = traj.rot[f0]!, qb = traj.rot[f1]!;
      const qq = qnorm([qa[0] + (qb[0] - qa[0]) * a, qa[1] + (qb[1] - qa[1]) * a, qa[2] + (qb[2] - qa[2]) * a, qa[3] + (qb[3] - qa[3]) * a]);
      c.setQ(p.name, qq);
      let s = tune.sink && p.role !== 'shard' ? (t >= duration - 1e-6 ? 0 : 1) : 1 - ramp(t, shrinkAt, tune.fadeLen !== undefined ? Math.min(duration, shrinkAt + tune.fadeLen) : duration, 'in');
      if (p.sliver) s = 1 - ramp(t, delay, delay + 0.18, 'in');
      if (p.role === 'core' && !p.sliver) s = (t < delay ? 1 + 0.35 * ramp(t, 0, delay) : 1.35 * (1 - ramp(t, delay, delay + 0.45, 'in')));
      c.scale(p.name, Math.max(s, 0.0005));
    });
  };
}

export function metinClips(rig: Rig, tune: ClipTune): ClipSpec[] {
  const idleT = tune.idleDuration ?? 8;
  return [
    { name: 'drop', duration: 0.9, loop: false, fps: 30, pose: poseDrop(rig, tune) },
    { name: 'idle', duration: idleT, loop: true, fps: 12, pose: poseIdle(rig, tune) },
    { name: 'hit', duration: 0.35, loop: false, fps: 30, pose: poseHit(rig, tune) },
    { name: 'pulse', duration: 1.2, loop: true, fps: 20, pose: posePulse(rig, tune) },
    { name: 'shatter', duration: 2.2, loop: false, fps: 30, pose: poseShatter(rig, tune, 2.2) },
  ];
}

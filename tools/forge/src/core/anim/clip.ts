import { type Quat, type Vec3, QIDENT, qeuler, qmul, qnorm, qslerp } from '../math.ts';
import type { Pose, Skeleton } from '../skin/skeleton.ts';

export interface BoneTrack {
  bone: number;
  /** rotation keys, 4 floats (xyzw) per frame, absent when constant identity */
  rot?: Float32Array;
  /** translation offset keys (added to rest offset), 3 floats per frame, absent when constant zero */
  pos?: Float32Array;
  /** local scale keys, 3 floats per frame, absent when constant 1 */
  scale?: Float32Array;
}

export interface ClipData {
  name: string;
  duration: number;
  loop: boolean;
  fps: number;
  /** number of key times = frames + 1 (the last key closes the loop for looping clips) */
  keys: number;
  tracks: BoneTrack[];
  /** seconds into the clip where the damaging contact happens (attack-like clips) */
  hit?: number;
}

/**
 * Mutable pose being built for one time sample. Rotations are in the parent's frame relative to rest.
 * Euler order: X (pitch, around the lateral axis), Y (yaw, around up), Z (roll, around forward) — applied X, then Y, then Z.
 */
export class PoseCtx {
  readonly pose: Pose;
  constructor(
    readonly skel: Skeleton,
    /** time in seconds within the clip */
    readonly t: number,
    /** normalised time 0..1 */
    readonly u: number,
    readonly duration: number,
  ) {
    this.pose = skel.restPose();
    // restPose shares identity constants; give each bone its own pos array so move() can mutate safely
    this.pose.pos = this.pose.pos.map(() => [0, 0, 0] as Vec3);
  }
  /** replace rotation of `bone` with euler (radians) */
  set(bone: string, x = 0, y = 0, z = 0): this {
    this.pose.rot[this.skel.idx(bone)] = qeuler(x, y, z);
    return this;
  }
  /** compose an extra euler rotation after the current one */
  add(bone: string, x = 0, y = 0, z = 0): this {
    const i = this.skel.idx(bone);
    this.pose.rot[i] = qnorm(qmul(this.pose.rot[i]!, qeuler(x, y, z)));
    return this;
  }
  setQ(bone: string, q: Quat): this {
    this.pose.rot[this.skel.idx(bone)] = q;
    return this;
  }
  /** local scale of `bone` (uniform number or per-axis); 1 = rest. Written as a glTF scale channel (e.g. fragments shrinking to dust) */
  scale(bone: string, s: number | Vec3): this {
    const i = this.skel.idx(bone);
    this.pose.scale ??= this.skel.bones.map(() => [1, 1, 1] as Vec3);
    this.pose.scale[i] = typeof s === 'number' ? [s, s, s] : [s[0], s[1], s[2]];
    return this;
  }
  /** translation offset (local to the parent) */
  move(bone: string, x = 0, y = 0, z = 0): this {
    const p = this.pose.pos[this.skel.idx(bone)]!;
    p[0] += x; p[1] += y; p[2] += z;
    return this;
  }
}

export interface ClipSpec {
  name: string;
  duration: number;
  loop: boolean;
  fps?: number;
  hit?: number;
  pose: (c: PoseCtx) => void;
}

/** Sample a clip spec into dense keyframes (30 fps default). */
export function sampleClip(skel: Skeleton, spec: ClipSpec): ClipData {
  const fps = spec.fps ?? 30;
  const frames = Math.max(1, Math.round(spec.duration * fps));
  const keys = frames + 1;
  const n = skel.count;
  const rot = Array.from({ length: n }, () => new Float32Array(keys * 4));
  const pos = Array.from({ length: n }, () => new Float32Array(keys * 3));
  let scl: Float32Array[] | undefined;
  for (let f = 0; f < keys; f++) {
    const t = (f / frames) * spec.duration;
    const ctx = new PoseCtx(skel, t, f / frames, spec.duration);
    spec.pose(ctx);
    for (let b = 0; b < n; b++) {
      let q = ctx.pose.rot[b]!;
      if (f > 0) {
        const o = (f - 1) * 4;
        const dot = q[0] * rot[b]![o]! + q[1] * rot[b]![o + 1]! + q[2] * rot[b]![o + 2]! + q[3] * rot[b]![o + 3]!;
        if (dot < 0) q = [-q[0], -q[1], -q[2], -q[3]];
      }
      rot[b]!.set(q, f * 4);
      pos[b]!.set(ctx.pose.pos[b]!, f * 3);
    }
    if (ctx.pose.scale) {
      scl ??= Array.from({ length: n }, () => new Float32Array(keys * 3).fill(1));
      for (let b = 0; b < n; b++) scl[b]!.set(ctx.pose.scale[b]!, f * 3);
    }
  }
  const tracks: BoneTrack[] = [];
  for (let b = 0; b < n; b++) {
    const r = rot[b]!;
    let rotMoves = false;
    for (let f = 0; f < keys && !rotMoves; f++) {
      if (Math.abs(r[f * 4]!) > 1e-5 || Math.abs(r[f * 4 + 1]!) > 1e-5 || Math.abs(r[f * 4 + 2]!) > 1e-5 || Math.abs(Math.abs(r[f * 4 + 3]!) - 1) > 1e-5) rotMoves = true;
    }
    const p = pos[b]!;
    let posMoves = false;
    for (let i = 0; i < p.length && !posMoves; i++) if (Math.abs(p[i]!) > 1e-5) posMoves = true;
    let sclMoves = false;
    const sc = scl?.[b];
    if (sc) for (let i = 0; i < sc.length && !sclMoves; i++) if (Math.abs(sc[i]! - 1) > 1e-5) sclMoves = true;
    if (rotMoves || posMoves || sclMoves) tracks.push({ bone: b, ...(rotMoves ? { rot: r } : {}), ...(posMoves ? { pos: p } : {}), ...(sclMoves && sc ? { scale: sc } : {}) });
  }
  return { name: spec.name, duration: spec.duration, loop: spec.loop, fps, keys, tracks, ...(spec.hit !== undefined ? { hit: spec.hit } : {}) };
}

/** Evaluate a sampled clip back into a Pose at time t (for CPU skinning / validation / foot-slide tests). */
export function poseAt(skel: Skeleton, clip: ClipData, t: number): Pose {
  const pose = skel.restPose();
  pose.pos = pose.pos.map(() => [0, 0, 0] as Vec3);
  const frames = clip.keys - 1;
  let f = (clip.loop ? ((t % clip.duration) + clip.duration) % clip.duration : Math.min(Math.max(t, 0), clip.duration)) / clip.duration * frames;
  const f0 = Math.min(Math.floor(f), frames - 1), f1 = f0 + 1;
  const a = f - f0;
  for (const tr of clip.tracks) {
    if (tr.rot) {
      const q0: Quat = [tr.rot[f0 * 4]!, tr.rot[f0 * 4 + 1]!, tr.rot[f0 * 4 + 2]!, tr.rot[f0 * 4 + 3]!];
      const q1: Quat = [tr.rot[f1 * 4]!, tr.rot[f1 * 4 + 1]!, tr.rot[f1 * 4 + 2]!, tr.rot[f1 * 4 + 3]!];
      pose.rot[tr.bone] = qslerp(q0, q1, a);
    }
    if (tr.pos) {
      for (let k = 0; k < 3; k++) pose.pos[tr.bone]![k] = tr.pos[f0 * 3 + k]! * (1 - a) + tr.pos[f1 * 3 + k]! * a;
    }
    if (tr.scale) {
      pose.scale ??= skel.bones.map(() => [1, 1, 1] as Vec3);
      for (let k = 0; k < 3; k++) pose.scale[tr.bone]![k] = tr.scale[f0 * 3 + k]! * (1 - a) + tr.scale[f1 * 3 + k]! * a;
    }
  }
  return pose;
}

export { QIDENT };

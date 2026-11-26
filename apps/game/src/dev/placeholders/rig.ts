// DEV-only: skeleton description, procedural pose composition and AnimationClip baking for the placeholder factory.
// Rest pose = every bone rotation identity (bone axes == world axes), so a bone's local position is just
// (its rest world position − its parent's). Animation tracks are therefore plain euler deltas about world-aligned axes:
// +X rotation pitches +Y toward +Z (so NEGATIVE rx swings a hanging limb forward / nods a head up).
import {
  AnimationClip,
  Bone,
  Euler,
  Group,
  QuaternionKeyframeTrack,
  Quaternion,
  Skeleton,
  VectorKeyframeTrack,
  type KeyframeTrack,
} from 'three';
import type { Vec3 } from './math';

export interface BoneDef {
  name: string;
  parent: string | null;
  /** rest position in model space */
  pos: Vec3;
}

export class Rig {
  readonly defs: BoneDef[] = [];
  private readonly lookup = new Map<string, number>();

  add(name: string, parent: string | null, pos: Vec3): number {
    if (this.lookup.has(name)) throw new Error(`duplicate bone ${name}`);
    if (parent !== null && !this.lookup.has(parent)) throw new Error(`bone ${name}: unknown parent ${parent}`);
    const i = this.defs.length;
    this.defs.push({ name, parent, pos });
    this.lookup.set(name, i);
    return i;
  }

  /** index of a bone by name (throws when missing so typos fail loudly) */
  i(name: string): number {
    const v = this.lookup.get(name);
    if (v === undefined) throw new Error(`unknown bone ${name}`);
    return v;
  }

  has(name: string): boolean {
    return this.lookup.has(name);
  }

  get count(): number {
    return this.defs.length;
  }

  pos(name: string): Vec3 {
    return this.defs[this.i(name)]!.pos;
  }

  /** Creates the Bone hierarchy. Bones whose parent is null are added to `scene`. */
  createBones(scene: Group): Bone[] {
    const bones = this.defs.map((d) => {
      const b = new Bone();
      b.name = d.name;
      return b;
    });
    this.defs.forEach((d, i) => {
      const b = bones[i] as Bone;
      if (d.parent === null) {
        b.position.set(d.pos[0], d.pos[1], d.pos[2]);
        scene.add(b);
      } else {
        const p = this.defs[this.i(d.parent)] as BoneDef;
        b.position.set(d.pos[0] - p.pos[0], d.pos[1] - p.pos[1], d.pos[2] - p.pos[2]);
        (bones[this.i(d.parent)] as Bone).add(b);
      }
    });
    return bones;
  }

  createSkeleton(scene: Group): Skeleton {
    const bones = this.createBones(scene);
    scene.updateMatrixWorld(true);
    return new Skeleton(bones);
  }
}

/** Mutable pose over a rig: additive euler rotation, position offset and scale multiplier per bone. */
export class Pose {
  readonly rot: Float32Array;
  readonly pos: Float32Array;
  readonly scl: Float32Array;

  constructor(readonly rig: Rig) {
    this.rot = new Float32Array(rig.count * 3);
    this.pos = new Float32Array(rig.count * 3);
    this.scl = new Float32Array(rig.count * 3).fill(1);
  }

  reset(): void {
    this.rot.fill(0);
    this.pos.fill(0);
    this.scl.fill(1);
  }

  /** add euler rotation (YXZ order) */
  r(bone: string, rx: number, ry = 0, rz = 0): void {
    const i = this.rig.i(bone) * 3;
    this.rot[i] = (this.rot[i] as number) + rx;
    this.rot[i + 1] = (this.rot[i + 1] as number) + ry;
    this.rot[i + 2] = (this.rot[i + 2] as number) + rz;
  }

  /** add position offset (metres) relative to rest */
  m(bone: string, x: number, y: number, z: number): void {
    const i = this.rig.i(bone) * 3;
    this.pos[i] = (this.pos[i] as number) + x;
    this.pos[i + 1] = (this.pos[i + 1] as number) + y;
    this.pos[i + 2] = (this.pos[i + 2] as number) + z;
  }

  /** multiply uniform scale */
  s(bone: string, s: number): void {
    const i = this.rig.i(bone) * 3;
    this.scl[i] = (this.scl[i] as number) * s;
    this.scl[i + 1] = (this.scl[i + 1] as number) * s;
    this.scl[i + 2] = (this.scl[i + 2] as number) * s;
  }
}

export interface ClipSpec {
  name: string;
  duration: number;
  loop: boolean;
  /** `u` runs 0..1 over the clip (loops: u=1 is never sampled as a distinct pose) */
  fn: (u: number, pose: Pose) => void;
  fps?: number;
}

export interface ClipBakeOptions {
  /** bones that get position tracks in EVERY clip (so no clip leaves stale state from another) */
  posBones: readonly string[];
  /** bones that get scale tracks in every clip */
  scaleBones: readonly string[];
}

const eul = new Euler();
const quat = new Quaternion();

/** Samples spec.fn into an AnimationClip with full-coverage tracks (every bone has a quaternion track). */
export function bakeClip(rig: Rig, spec: ClipSpec, opts: ClipBakeOptions): AnimationClip {
  const fps = spec.fps ?? 24;
  const n = Math.max(2, Math.round(spec.duration * fps));
  const nb = rig.count;
  const pose = new Pose(rig);
  const frames = n + 1;
  const q = new Float32Array(frames * nb * 4);
  const p = new Float32Array(frames * nb * 3);
  const s = new Float32Array(frames * nb * 3);
  for (let f = 0; f < frames; f++) {
    const frame = spec.loop && f === n ? 0 : f;
    if (frame === f) {
      pose.reset();
      spec.fn(f / n, pose);
    }
    for (let b = 0; b < nb; b++) {
      const o3 = (f * nb + b) * 3;
      if (frame === f) {
        eul.set(pose.rot[b * 3] as number, pose.rot[b * 3 + 1] as number, pose.rot[b * 3 + 2] as number, 'YXZ');
        quat.setFromEuler(eul);
        const o4 = (f * nb + b) * 4;
        q[o4] = quat.x;
        q[o4 + 1] = quat.y;
        q[o4 + 2] = quat.z;
        q[o4 + 3] = quat.w;
        p[o3] = pose.pos[b * 3] as number;
        p[o3 + 1] = pose.pos[b * 3 + 1] as number;
        p[o3 + 2] = pose.pos[b * 3 + 2] as number;
        s[o3] = pose.scl[b * 3] as number;
        s[o3 + 1] = pose.scl[b * 3 + 1] as number;
        s[o3 + 2] = pose.scl[b * 3 + 2] as number;
      } else {
        const src3 = (frame * nb + b) * 3;
        const src4 = (frame * nb + b) * 4;
        const o4 = (f * nb + b) * 4;
        for (let k = 0; k < 4; k++) q[o4 + k] = q[src4 + k] as number;
        for (let k = 0; k < 3; k++) {
          p[o3 + k] = p[src3 + k] as number;
          s[o3 + k] = s[src3 + k] as number;
        }
      }
    }
  }
  // shortest-path continuity per bone
  for (let b = 0; b < nb; b++) {
    for (let f = 1; f < frames; f++) {
      const a = ((f - 1) * nb + b) * 4;
      const c = (f * nb + b) * 4;
      const dot =
        (q[a] as number) * (q[c] as number) +
        (q[a + 1] as number) * (q[c + 1] as number) +
        (q[a + 2] as number) * (q[c + 2] as number) +
        (q[a + 3] as number) * (q[c + 3] as number);
      if (dot < 0) for (let k = 0; k < 4; k++) q[c + k] = -(q[c + k] as number);
    }
  }

  const times = new Float32Array(frames);
  for (let f = 0; f < frames; f++) times[f] = (f / n) * spec.duration;
  const times2 = new Float32Array([0, spec.duration]);
  const tracks: KeyframeTrack[] = [];
  const column = (src: Float32Array, comps: number, b: number): Float32Array => {
    const out = new Float32Array(frames * comps);
    for (let f = 0; f < frames; f++) for (let k = 0; k < comps; k++) out[f * comps + k] = src[(f * nb + b) * comps + k] as number;
    return out;
  };
  const isConst = (v: Float32Array, comps: number): boolean => {
    for (let i = comps; i < v.length; i++) if (Math.abs((v[i] as number) - (v[i % comps] as number)) > 1e-5) return false;
    return true;
  };
  const push = (name: string, track: 'quaternion' | 'position' | 'scale', v: Float32Array, comps: number, rest?: Vec3): void => {
    let vals = v;
    if (rest) {
      vals = new Float32Array(v.length);
      for (let i = 0; i < v.length; i++) vals[i] = (v[i] as number) + (rest[i % 3] as number);
    }
    const constant = isConst(vals, comps);
    const t = constant ? times2 : times;
    const data = constant ? new Float32Array([...vals.subarray(0, comps), ...vals.subarray(0, comps)]) : vals;
    tracks.push(
      track === 'quaternion' ? new QuaternionKeyframeTrack(`${name}.quaternion`, t, data) : new VectorKeyframeTrack(`${name}.${track}`, t, data),
    );
  };
  for (let b = 0; b < nb; b++) {
    const def = rig.defs[b] as { name: string; parent: string | null; pos: Vec3 };
    push(def.name, 'quaternion', column(q, 4, b), 4);
    if (opts.posBones.includes(def.name)) {
      const parent = def.parent === null ? null : rig.defs[rig.i(def.parent)]!.pos;
      const local: Vec3 = parent ? [def.pos[0] - parent[0], def.pos[1] - parent[1], def.pos[2] - parent[2]] : def.pos;
      push(def.name, 'position', column(p, 3, b), 3, local);
    }
    if (opts.scaleBones.includes(def.name)) push(def.name, 'scale', column(s, 3, b), 3);
  }
  return new AnimationClip(spec.name, spec.duration, tracks);
}

export function bakeClips(rig: Rig, specs: readonly ClipSpec[], opts: ClipBakeOptions): AnimationClip[] {
  return specs.map((s) => bakeClip(rig, s, opts));
}

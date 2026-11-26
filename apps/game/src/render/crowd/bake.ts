// Bakes every clip of a skinned GLB into a bone-matrix DataTexture so the crowd can be skinned in the vertex shader.
//
// Texture layout (RGBA16F): one ROW per animation frame, 3 texels per bone — the first three ROWS of the 4x4 skinning
// matrix S_i = boneWorld_i · boneInverse_i · bindMatrix (root frame), i.e. texel k = (m[k], m[4+k], m[8+k], m[12+k]).
// Skinned position = (dot(r0,[p,1]), dot(r1,[p,1]), dot(r2,[p,1])). Clips are stored back to back.
import {
  AnimationMixer,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LoopOnce,
  Matrix4,
  NearestFilter,
  RGBAFormat,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Object3D,
  type SkinnedMesh,
  type Bone,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { LoadedModel } from '../../engine/assets';
import { CLIP_NAMES, type ClipName } from '../feed';

export const BAKE_FPS = 30;

/** Sockets whose model-space position is kept per baked row (CPU side) for render-side origins, e.g. the breath VFX. */
export const BAKED_SOCKETS = ['muzzle'] as const;
export type BakedSocket = (typeof BAKED_SOCKETS)[number];

export interface SocketPoint {
  x: number;
  y: number;
  z: number;
}

export interface BakedClip {
  name: string;
  /** first texture row */
  start: number;
  frames: number;
  duration: number;
  loop: boolean;
}

export interface BakedModel {
  modelId: string;
  mesh: SkinnedMesh;
  texture: DataTexture;
  boneCount: number;
  rows: number;
  clips: Map<string, BakedClip>;
  /** CLIP_NAMES index → clip (with fallbacks applied), null when the model has no clips at all */
  byIndex: (BakedClip | null)[];
  /** socket → model-space position track (xyz per texture row, same space as the skinned mesh); absent = no such bone */
  sockets: Partial<Record<BakedSocket, Float32Array>>;
  height: number;
  radius: number;
  dispose(): void;
}

/** Clip-name fallback chains for clips a model does not have (index = CLIP_NAMES). */
const FALLBACKS: Record<ClipName, ClipName[]> = {
  idle: ['walk', 'run'],
  walk: ['run', 'idle'],
  run: ['walk', 'idle'],
  attack: ['attack2', 'special1', 'idle'],
  attack2: ['attack', 'special1', 'idle'],
  hit: ['idle'],
  death: [],
  spawn: ['idle'],
  special1: ['attack', 'attack2', 'idle'],
  special2: ['special1', 'attack2', 'attack', 'idle'],
  special3: ['special2', 'special1', 'attack', 'idle'],
};

export function isLoopClip(name: string): boolean {
  return name === 'idle' || name === 'walk' || name === 'run' || name === 'pulse';
}

/** Number of baked frames for a clip. Loops drop the duplicate end frame; one-shots keep it. */
export function frameCountFor(duration: number, loop: boolean): number {
  const n = Math.round(duration * BAKE_FPS);
  return loop ? Math.max(2, n) : Math.max(2, n + 1);
}

export function resolveClips(clips: ReadonlyMap<string, BakedClip>): (BakedClip | null)[] {
  const any = clips.values().next().value ?? null;
  return CLIP_NAMES.map((name) => {
    const direct = clips.get(name);
    if (direct) return direct;
    for (const f of FALLBACKS[name]) {
      const c = clips.get(f);
      if (c) return c;
    }
    return name === 'death' ? null : any;
  });
}

/** Row pair + blend factor for time `t` seconds into a baked clip. Pure, allocation-free via `out`. */
export function sampleRows(clip: BakedClip, t: number, out: { a: number; b: number; mix: number }): void {
  const dur = clip.duration;
  if (clip.loop) {
    const f = (dur > 0 ? ((t % dur) + dur) % dur / dur : 0) * clip.frames;
    const i0 = Math.min(clip.frames - 1, Math.floor(f));
    out.a = clip.start + i0;
    out.b = clip.start + (i0 + 1 >= clip.frames ? 0 : i0 + 1);
    out.mix = f - i0;
  } else {
    const u = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 1;
    const f = u * (clip.frames - 1);
    const i0 = Math.min(clip.frames - 1, Math.floor(f));
    out.a = clip.start + i0;
    out.b = clip.start + Math.min(clip.frames - 1, i0 + 1);
    out.mix = f - i0;
  }
}

/** Model-space socket position at a sampleRows() result: rows a→b blended by `mix`, like the shader's ANIM_LERP. */
export function sampleSocket(track: Float32Array, r: { a: number; b: number; mix: number }, out: SocketPoint): void {
  const a = r.a * 3;
  const b = r.b * 3;
  const t = r.mix;
  const ax = track[a] as number;
  const ay = track[a + 1] as number;
  const az = track[a + 2] as number;
  out.x = ax + ((track[b] as number) - ax) * t;
  out.y = ay + ((track[b + 1] as number) - ay) * t;
  out.z = az + ((track[b + 2] as number) - az) * t;
}

interface RestPose {
  p: Vector3;
  q: Quaternion;
  s: Vector3;
}

/**
 * Bakes all clips of `model` (first SkinnedMesh). Uses a private clone, so the template keeps its rest pose.
 * Cost is O(frames × bones) matrix multiplies — 4 to 8 ms per model in one go (see `bakeModelSteps` to spread it).
 */
export function bakeModel(model: LoadedModel): BakedModel {
  const steps = bakeModelSteps(model);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * The same bake as a generator that yields after every clip (about a millisecond each), so a caller streaming models into
 * a running game can spend a few ms per frame on it instead of blocking one frame for the whole model. The last `next()`
 * returns the BakedModel.
 */
export function* bakeModelSteps(model: LoadedModel): Generator<void, BakedModel, void> {
  const src = model.skinned[0];
  if (!src) throw new Error(`model "${model.id}" has no SkinnedMesh; cannot bake`);
  const root = cloneSkinned(model.scene);
  root.updateMatrixWorld(true);
  let mesh: SkinnedMesh | null = null;
  root.traverse((o: Object3D) => {
    if (!mesh && (o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
  });
  if (!mesh) throw new Error(`clone of "${model.id}" lost its SkinnedMesh`);
  const skinned: SkinnedMesh = mesh;
  const bones = skinned.skeleton.bones;
  const inverses = skinned.skeleton.boneInverses;
  const nb = bones.length;
  const width = nb * 3;

  const rest: RestPose[] = bones.map((b: Bone) => ({ p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
  const restore = (): void => {
    bones.forEach((b: Bone, i: number) => {
      const r = rest[i] as RestPose;
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    });
  };

  // Clip list: authored clips; a model without clips gets a single rest-pose "idle".
  const authored: AnimationClip[] = model.clips.length > 0 ? model.clips : [];
  const plan: { name: string; clip: AnimationClip | null; duration: number; loop: boolean; frames: number }[] = [];
  for (const c of authored) {
    const name = c.name.toLowerCase();
    const loop = isLoopClip(name);
    const duration = Math.max(c.duration, 1 / BAKE_FPS);
    plan.push({ name, clip: c, duration, loop, frames: frameCountFor(duration, loop) });
  }
  if (plan.length === 0) plan.push({ name: 'idle', clip: null, duration: 1, loop: true, frames: 2 });
  const rows = plan.reduce((s, p) => s + p.frames, 0);

  const data = new Uint16Array(rows * width * 4);
  const clips = new Map<string, BakedClip>();
  // socket bones (manifest sockets win over GLB extras, as for the hero's weapon socket) and their per-row positions
  const sockets: Partial<Record<BakedSocket, Float32Array>> = {};
  const socketBones: { bone: Object3D; track: Float32Array }[] = [];
  for (const name of BAKED_SOCKETS) {
    const boneName = model.asset.sockets?.[name] ?? model.extras.sockets?.[name];
    const bone = boneName ? root.getObjectByName(boneName) : undefined;
    if (!bone) continue;
    const track = new Float32Array(rows * 3);
    sockets[name] = track;
    socketBones.push({ bone, track });
  }
  const m = new Matrix4();
  const bind = skinned.bindMatrix;
  let row = 0;
  for (const p of plan) {
    clips.set(p.name, { name: p.name, start: row, frames: p.frames, duration: p.duration, loop: p.loop });
    restore();
    const mixer = p.clip ? new AnimationMixer(root) : null;
    if (mixer && p.clip) {
      // One-shots must hold their final pose at t == duration instead of wrapping to frame 0.
      const action = mixer.clipAction(p.clip);
      if (!p.loop) {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.play();
    }
    for (let f = 0; f < p.frames; f++) {
      const t = p.loop ? (f * p.duration) / p.frames : (f * p.duration) / (p.frames - 1);
      if (mixer) mixer.setTime(Math.min(t, p.duration));
      root.updateMatrixWorld(true);
      for (let b = 0; b < nb; b++) {
        const bone = bones[b] as Bone;
        m.multiplyMatrices(bone.matrixWorld, inverses[b] as Matrix4).multiply(bind);
        const e = m.elements;
        const base = (row * width + b * 3) * 4;
        for (let k = 0; k < 3; k++) {
          const o = base + k * 4;
          data[o] = DataUtils.toHalfFloat(e[k] as number);
          data[o + 1] = DataUtils.toHalfFloat(e[4 + k] as number);
          data[o + 2] = DataUtils.toHalfFloat(e[8 + k] as number);
          data[o + 3] = DataUtils.toHalfFloat(e[12 + k] as number);
        }
      }
      for (const sb of socketBones) {
        const e = sb.bone.matrixWorld.elements;
        sb.track[row * 3] = e[12] as number;
        sb.track[row * 3 + 1] = e[13] as number;
        sb.track[row * 3 + 2] = e[14] as number;
      }
      row++;
    }
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    }
    yield;
  }
  restore();

  const texture = new DataTexture(data, width, rows, RGBAFormat, HalfFloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;

  const geometry = src.geometry;
  return {
    modelId: model.id,
    mesh: src,
    texture,
    boneCount: nb,
    rows,
    clips,
    byIndex: resolveClips(clips),
    sockets,
    height: model.asset.height || model.extras.height || 1.5,
    radius: model.asset.radius || model.extras.radius || 0.5,
    dispose() {
      texture.dispose();
      void geometry;
    },
  };
}

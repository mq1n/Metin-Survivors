import { describe, expect, it } from 'vitest';
import {
  AnimationClip,
  Bone,
  BufferAttribute,
  BufferGeometry,
  DataUtils,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import type { LoadedModel } from '../../engine/assets';
import type { ModelAsset } from '../../data/assetManifest';
import { bakeModel, frameCountFor, resolveClips, sampleRows, sampleSocket, type BakedClip } from './bake';
import { CLIP_NAMES } from '../feed';

function makeModel(): LoadedModel {
  const root = new Bone();
  root.name = 'root';
  const mid = new Bone();
  mid.name = 'mid';
  mid.position.set(0, 1, 0);
  const tip = new Bone();
  tip.name = 'tip';
  tip.position.set(0, 1, 0);
  root.add(mid);
  mid.add(tip);

  const geo = new BufferGeometry();
  const pos = [0, 0, 0, 0.5, 1, 0, -0.5, 2, 0.2, 0, 2.5, 0];
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0, 2, 0, 0, 0]), 4));
  geo.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geo, new MeshBasicMaterial());
  const group = new Group();
  group.add(root, mesh);
  group.updateMatrixWorld(true);
  const skeleton = new Skeleton([root, mid, tip]);
  mesh.bind(skeleton, mesh.matrixWorld);

  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.9);
  const qi = new Quaternion();
  const walk = new AnimationClip('walk', 1, [
    new QuaternionKeyframeTrack('mid.quaternion', [0, 0.5, 1], [...qi.toArray(), ...q.toArray(), ...qi.toArray()]),
  ]);
  const death = new AnimationClip('death', 0.8, [
    new VectorKeyframeTrack('root.position', [0, 0.8], [0, 0, 0, 0, -0.5, 0.3]),
    new QuaternionKeyframeTrack('tip.quaternion', [0, 0.8], [...qi.toArray(), ...q.toArray()]),
  ]);
  const asset: ModelAsset = {
    id: 't',
    url: '',
    kind: 'creature',
    height: 2.5,
    radius: 0.5,
    clips: { walk: { duration: 1, loop: true }, death: { duration: 0.8, loop: false } },
    tris: 0,
    bones: 3,
    bytes: 0,
  };
  return {
    id: 't',
    asset,
    scene: group,
    clips: [walk, death],
    clipMap: new Map([
      ['walk', walk],
      ['death', death],
    ]),
    skinned: [mesh],
    meshes: [mesh],
    extras: {},
    placeholder: true,
  };
}

function readS(data: Uint16Array, width: number, row: number, bone: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 3; k++) {
    const o = (row * width + bone * 3 + k) * 4;
    for (let c = 0; c < 4; c++) out.push(DataUtils.fromHalfFloat(data[o + c] as number));
  }
  return out;
}

/** the test model with a `muzzle` bone 0.3 up / 0.4 forward of `tip`, declared as the muzzle socket in the GLB extras */
function withMuzzle(model: LoadedModel): Bone {
  const muzzle = new Bone();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0.3, 0.4);
  (model.scene.getObjectByName('tip') as Bone).add(muzzle);
  model.scene.updateMatrixWorld(true);
  model.extras = { sockets: { muzzle: 'muzzle' } };
  return muzzle;
}

describe('bake', () => {
  it('frame counts: loops drop the duplicate end frame, one-shots keep it', () => {
    expect(frameCountFor(1, true)).toBe(30);
    expect(frameCountFor(1, false)).toBe(31);
    expect(frameCountFor(0.01, true)).toBe(2);
  });

  it('bakes rest pose to identity and matches three skinning at a sampled time', () => {
    const model = makeModel();
    const baked = bakeModel(model);
    expect(baked.boneCount).toBe(3);
    const walk = baked.clips.get('walk') as BakedClip;
    const death = baked.clips.get('death') as BakedClip;
    expect(walk.loop).toBe(true);
    expect(death.loop).toBe(false);
    expect(baked.rows).toBe(walk.frames + death.frames);
    const data = baked.texture.image.data as Uint16Array;
    const width = baked.boneCount * 3;

    // walk frame 0 = rest pose = identity for every bone
    for (let b = 0; b < 3; b++) {
      const s = readS(data, width, walk.start, b);
      const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
      s.forEach((v, i) => expect(v).toBeCloseTo(ident[i] as number, 2));
    }

    // Compare against three's own skinning at t = 0.5 s (frame 15 of 30): fresh posed copy of the template.
    const ref = makeModel();
    const refMesh = ref.skinned[0] as SkinnedMesh;
    const bones = refMesh.skeleton.bones;
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.9);
    (bones[1] as Bone).quaternion.copy(q);
    ref.scene.updateMatrixWorld(true);
    const pos = refMesh.geometry.getAttribute('position');
    const frame = walk.start + 15;
    for (let v = 0; v < pos.count; v++) {
      const expected = new Vector3();
      refMesh.getVertexPosition(v, expected);
      const idx = refMesh.geometry.getAttribute('skinIndex');
      const wgt = refMesh.geometry.getAttribute('skinWeight');
      const p = [pos.getX(v), pos.getY(v), pos.getZ(v), 1];
      const got = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const w = wgt.getComponent(v, k);
        if (w === 0) continue;
        const s = readS(data, width, frame, idx.getComponent(v, k));
        for (let r = 0; r < 3; r++) {
          got[r] = (got[r] as number) + w * ((s[r * 4] as number) * (p[0] as number) + (s[r * 4 + 1] as number) * (p[1] as number) + (s[r * 4 + 2] as number) * (p[2] as number) + (s[r * 4 + 3] as number));
        }
      }
      expect(got[0]).toBeCloseTo(expected.x, 2);
      expect(got[1]).toBeCloseTo(expected.y, 2);
      expect(got[2]).toBeCloseTo(expected.z, 2);
    }
    // template untouched
    expect((model.skinned[0] as SkinnedMesh).skeleton.bones[1]?.quaternion.w).toBeCloseTo(1, 5);
  });

  it('resolves missing clips through fallbacks and keeps death null when absent', () => {
    const baked = bakeModel(makeModel());
    const by = baked.byIndex;
    expect(by.length).toBe(CLIP_NAMES.length);
    expect(by[CLIP_NAMES.indexOf('idle')]?.name).toBe('walk');
    expect(by[CLIP_NAMES.indexOf('attack')]?.name).toBeDefined();
    expect(by[CLIP_NAMES.indexOf('death')]?.name).toBe('death');
    const noDeath = resolveClips(new Map([['walk', baked.clips.get('walk') as BakedClip]]));
    expect(noDeath[CLIP_NAMES.indexOf('death')]).toBeNull();
  });

  it('sampleRows wraps loops and clamps one-shots', () => {
    const loop: BakedClip = { name: 'walk', start: 10, frames: 30, duration: 1, loop: true };
    const out = { a: 0, b: 0, mix: 0 };
    sampleRows(loop, 0.5, out);
    expect(out.a).toBe(25);
    expect(out.b).toBe(26);
    sampleRows(loop, 0.99999, out);
    expect(out.b).toBe(10); // wraps to frame 0
    sampleRows(loop, 2.25, out);
    expect(out.a).toBe(10 + 7);
    const shot: BakedClip = { name: 'death', start: 100, frames: 25, duration: 0.8, loop: false };
    sampleRows(shot, 5, out);
    expect(out.a).toBe(124);
    expect(out.b).toBe(124);
    expect(out.mix).toBe(0);
    sampleRows(shot, 0.4, out);
    expect(out.a).toBe(112);
    expect(out.mix).toBeCloseTo(0, 5);
  });

  it('keeps the muzzle socket position per baked row, matching the posed bone', () => {
    expect(bakeModel(makeModel()).sockets.muzzle).toBeUndefined();
    const model = makeModel();
    withMuzzle(model);
    const baked = bakeModel(model);
    const track = baked.sockets.muzzle as Float32Array;
    expect(track.length).toBe(baked.rows * 3);
    const walk = baked.clips.get('walk') as BakedClip;
    const death = baked.clips.get('death') as BakedClip;

    const posed = (pose: (bones: Bone[]) => void): Vector3 => {
      const ref = makeModel();
      const muzzle = withMuzzle(ref);
      pose((ref.skinned[0] as SkinnedMesh).skeleton.bones);
      ref.scene.updateMatrixWorld(true);
      return muzzle.getWorldPosition(new Vector3());
    };
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.9);
    const out = { x: 0, y: 0, z: 0 };
    const expectAt = (row: number, p: Vector3): void => {
      sampleSocket(track, { a: row, b: row, mix: 0 }, out);
      expect(out.x).toBeCloseTo(p.x, 4);
      expect(out.y).toBeCloseTo(p.y, 4);
      expect(out.z).toBeCloseTo(p.z, 4);
    };
    // rest, walk mid-swing (mid bone rotated), and the death clip's held last frame (root moved, tip rotated)
    expectAt(walk.start, posed(() => undefined));
    expectAt(walk.start + 15, posed((b) => (b[1] as Bone).quaternion.copy(q)));
    expectAt(
      death.start + death.frames - 1,
      posed((b) => {
        (b[0] as Bone).position.set(0, -0.5, 0.3);
        (b[2] as Bone).quaternion.copy(q);
      }),
    );

    // blended rows lerp linearly, like the shader
    const r = { a: walk.start, b: walk.start + 15, mix: 0.25 };
    sampleSocket(track, r, out);
    const a = walk.start * 3;
    const b = (walk.start + 15) * 3;
    expect(out.x).toBeCloseTo((track[a] as number) * 0.75 + (track[b] as number) * 0.25, 6);
    expect(out.y).toBeCloseTo((track[a + 1] as number) * 0.75 + (track[b + 1] as number) * 0.25, 6);
  });
});

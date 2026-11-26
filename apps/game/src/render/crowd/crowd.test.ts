import { describe, expect, it, vi } from 'vitest';
import {
  AnimationClip,
  Bone,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Scene,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three';
import type { LoadedModel } from '../../engine/assets';
import type { RenderCore } from '../core';
import { CLIP_NAMES, type EnemyFeed } from '../feed';
import { CrowdRenderer, instancePoint } from './crowd';

// the blob batch paints a canvas texture (DOM); the socket math does not need it
vi.mock('./blobShadows', () => ({
  BlobShadows: class {
    begin(): void {}
    add(): void {}
    end(): void {}
    dispose(): void {}
  },
}));

const GROUND = 1.25;
const NOD = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.7);

/** 2.5 m creature: body → head (nods in `walk`) → muzzle 0.2 up / 0.6 forward of the head */
function makeModel(): { model: LoadedModel; head: Bone; muzzle: Bone } {
  const body = new Bone();
  body.name = 'body';
  const head = new Bone();
  head.name = 'head';
  head.position.set(0, 2, 0.3);
  const muzzle = new Bone();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0.2, 0.6);
  body.add(head);
  head.add(muzzle);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 2.5, 0, 0.3, 2, 0.5], 3));
  geo.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  geo.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geo, new MeshLambertMaterial());
  const scene = new Group();
  scene.add(body, mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new Skeleton([body, head]), mesh.matrixWorld);
  const qi = new Quaternion();
  const walk = new AnimationClip('walk', 1, [new QuaternionKeyframeTrack('head.quaternion', [0, 0.5, 1], [...qi.toArray(), ...NOD.toArray(), ...qi.toArray()])]);
  const model: LoadedModel = {
    id: 'beast',
    asset: { id: 'beast', url: '', kind: 'boss', height: 2.5, radius: 0.8, clips: { walk: { duration: 1, loop: true } }, sockets: { muzzle: 'muzzle' }, tris: 0, bones: 2, bytes: 0 },
    scene,
    clips: [walk],
    clipMap: new Map([['walk', walk]]),
    skinned: [mesh],
    meshes: [mesh],
    extras: {},
    placeholder: true,
  };
  return { model, head, muzzle };
}

function fakeCore(model: LoadedModel): RenderCore {
  return {
    scene: new Scene(),
    quality: { onChange: () => () => undefined, profile: { animLerp: true, crowdCap: 1000 } },
    assets: { loadBatch: async () => undefined, model: () => model },
    heightAt: () => GROUND,
  } as unknown as RenderCore;
}

interface Row {
  x: number;
  z: number;
  rot: number;
  scale: number;
  tier: number;
  t: number;
}

function feedOf(rows: Row[]): EnemyFeed {
  const n = rows.length;
  const f32 = (k: keyof Row): Float32Array => Float32Array.from(rows, (r) => r[k]);
  return {
    count: n,
    x: f32('x'),
    z: f32('z'),
    px: f32('x'),
    pz: f32('z'),
    rot: f32('rot'),
    scale: f32('scale'),
    type: new Uint8Array(n),
    animClip: new Uint8Array(n).fill(CLIP_NAMES.indexOf('walk')),
    animT: f32('t'),
    flash: new Float32Array(n),
    eliteTier: Uint8Array.from(rows, (r) => r.tier),
    corrupted: new Float32Array(n),
    status: new Uint16Array(n),
    id: Uint32Array.from(rows, (_, i) => i + 1),
    flags: new Uint8Array(n),
  };
}

/** the muzzle in world space for a unit drawn at (x, GROUND, z), yaw `rot`, uniform scale `s`, head at its mid-nod pose */
function expected(x: number, z: number, rot: number, s: number): Vector3 {
  const ref = makeModel();
  ref.head.quaternion.copy(NOD);
  ref.model.scene.updateMatrixWorld(true);
  const p = ref.muzzle.getWorldPosition(new Vector3());
  const m = new Matrix4().compose(new Vector3(x, GROUND, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rot), new Vector3(s, s, s));
  return p.applyMatrix4(m);
}

describe('crowd sockets', () => {
  it('instancePoint applies the drawn instance transform (translate · yaw · scale)', () => {
    const out = { x: 0, y: 0, z: 0 };
    instancePoint({ x: 0.4, y: 1.5, z: -2 }, 3, 1, -7, 2.1, 1.7, out);
    const m = new Matrix4().compose(new Vector3(3, 1, -7), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 2.1), new Vector3(1.7, 1.7, 1.7));
    const want = new Vector3(0.4, 1.5, -2).applyMatrix4(m);
    expect(out.x).toBeCloseTo(want.x, 5);
    expect(out.y).toBeCloseTo(want.y, 5);
    expect(out.z).toBeCloseTo(want.z, 5);
  });

  it('socketWorld places the baked muzzle of the current clip frame on the drawn unit; bossAt finds the boss row', async () => {
    const { model } = makeModel();
    const crowd = new CrowdRenderer(fakeCore(model));
    await crowd.load([{ key: 'beast', modelId: 'beast', radius: 0.8 }]);
    crowd.feed = feedOf([
      { x: 5, z: 7, rot: 0.6, scale: 2, tier: 3, t: 0.5 }, // 5 m boss: drawn at its own scale
      { x: -4, z: 1, rot: -1.2, scale: 1, tier: 3, t: 0.5 }, // 2.5 m boss: drawn with the boss size cue (× 1.35)
      { x: 9, z: 9, rot: 0, scale: 1, tier: 0, t: 0.5 }, // rank and file
    ]);
    const out = { x: 0, y: 0, z: 0 };
    const cases: [number, Vector3][] = [
      [0, expected(5, 7, 0.6, 2)],
      [1, expected(-4, 1, -1.2, 1.35)],
      [2, expected(9, 9, 0, 1)],
    ];
    for (const [row, want] of cases) {
      expect(crowd.socketWorld(row, 'muzzle', out)).toBe(true);
      expect(out.x).toBeCloseTo(want.x, 2);
      expect(out.y).toBeCloseTo(want.y, 2);
      expect(out.z).toBeCloseTo(want.z, 2);
    }
    expect(crowd.socketWorld(3, 'muzzle', out)).toBe(false);

    expect(crowd.bossAt(5.2, 7.1)).toBe(0);
    expect(crowd.bossAt(-4, 1)).toBe(1);
    expect(crowd.bossAt(9, 9)).toBe(-1); // not a boss
    expect(crowd.bossAt(5, 8)).toBe(-1); // too far from any boss
  });
});

describe('crowd run release', () => {
  it('releaseRun frees the baked bone textures and the batches at the end of a run, and the next load rebuilds them', async () => {
    const { model } = makeModel();
    const core = fakeCore(model);
    const crowd = new CrowdRenderer(core);
    await crowd.load([{ key: 'beast', modelId: 'beast', radius: 0.8 }]);
    const baked = [...(crowd as unknown as { baked: Map<string, { texture: { addEventListener(t: string, f: () => void): void } }> }).baked.values()];
    expect(baked).toHaveLength(1);
    const disposed = vi.fn();
    baked[0]?.texture.addEventListener('dispose', disposed);
    expect(core.scene.children.length).toBeGreaterThan(0);

    crowd.releaseRun();
    expect(disposed).toHaveBeenCalledTimes(1); // the GPU texture does not outlive the run
    expect(core.scene.children).toHaveLength(0);
    expect(crowd.socketWorld(0, 'muzzle', { x: 0, y: 0, z: 0 })).toBe(false);
    crowd.releaseRun(); // idempotent

    await crowd.load([{ key: 'beast', modelId: 'beast', radius: 0.8 }]);
    expect(core.scene.children.length).toBeGreaterThan(0);
  });
});

// Background streaming of the crowd types a run only meets later (RenderCatalog.enemyLater, payload policy ARCHITECTURE §11):
// nothing downloads in the first seconds, a type's model comes `CROWD_STREAM_LEAD` seconds before it can spawn, bakes in
// slices, compiles before it is shown, and a type that shows up in the feed without a model is fetched on demand.
import { describe, expect, it, vi } from 'vitest';
import { AnimationClip, Bone, BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, MeshLambertMaterial, Quaternion, QuaternionKeyframeTrack, Scene, Skeleton, SkinnedMesh, type InstancedMesh } from 'three';
import type { LoadedModel } from '../../engine/assets';
import type { RenderCore } from '../core';
import { CLIP_NAMES, type CrowdTypeDef, type EnemyFeed } from '../feed';
import { CROWD_STREAM_DELAY, CROWD_STREAM_LEAD, CrowdRenderer } from './crowd';

vi.mock('./blobShadows', () => ({
  BlobShadows: class {
    begin(): void {}
    add(): void {}
    end(): void {}
    dispose(): void {}
  },
}));

function makeModel(id: string): LoadedModel {
  const body = new Bone();
  body.name = 'body';
  const head = new Bone();
  head.name = 'head';
  head.position.set(0, 2, 0.3);
  body.add(head);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 2.5, 0, 0.3, 2, 0.5], 3));
  geo.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  geo.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geo, new MeshLambertMaterial());
  const scene = new Group();
  scene.add(body, mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new Skeleton([body, head]), mesh.matrixWorld);
  const q = new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 } as never, 0.4);
  const clips = ['idle', 'walk', 'attack', 'death'].map((n) => new AnimationClip(n, 1, [new QuaternionKeyframeTrack('head.quaternion', [0, 1], [0, 0, 0, 1, ...q.toArray()])]));
  return {
    id,
    asset: { id, url: '', kind: 'creature', height: 2.5, radius: 0.8, clips: {}, tris: 0, bones: 2, bytes: 0 },
    scene,
    clips,
    clipMap: new Map(clips.map((c) => [c.name, c])),
    skinned: [mesh],
    meshes: [mesh],
    extras: {},
    placeholder: true,
  } as unknown as LoadedModel;
}

interface Rig {
  crowd: CrowdRenderer;
  core: RenderCore;
  fetched: string[];
  warmed: InstancedMesh[];
  uploads: unknown[];
  /** one rendered frame of `dt` seconds */
  frame(dt?: number): void;
  /** frames until `done()` or `limit` seconds */
  run(seconds: number, done?: () => boolean): Promise<void>;
}

const batches = (r: Rig): (unknown | undefined)[] => (r.crowd as unknown as { batches: unknown[] }).batches;

function rig(opts: { warm?: boolean } = {}): Rig {
  const fetched: string[] = [];
  const loaded = new Map<string, LoadedModel>();
  const uploads: unknown[] = [];
  const warmed: InstancedMesh[] = [];
  const core = {
    scene: new Scene(),
    clock: { time: 0, dt: 0, frame: 0 },
    quality: { onChange: () => () => undefined, profile: { animLerp: true, crowdCap: 1000 } },
    renderer: { initTexture: (t: unknown) => void uploads.push(t) },
    rig: { focus: { x: 0, z: 0 }, isVisible: () => true },
    env: { sunDir: { x: 0.4, z: 0.3 } },
    heightAt: () => 0,
    assets: {
      loadBatch: async (reqs: { id: string }[]) => {
        for (const r of reqs) loaded.set(r.id, makeModel(r.id));
      },
      isModelLoaded: (id: string) => loaded.has(id),
      model: (id: string) => loaded.get(id) as LoadedModel,
      loadModel: async (id: string) => {
        fetched.push(id);
        await new Promise((r) => setTimeout(r, 5));
        const m = makeModel(id);
        loaded.set(id, m);
        return m;
      },
    },
  } as unknown as RenderCore;
  const crowd = new CrowdRenderer(core);
  if (opts.warm !== false) {
    // the compile resolves a little later, like compileAsync
    crowd.warmSink = (mesh) => {
      warmed.push(mesh);
      return new Promise((r) => setTimeout(r, 30));
    };
  }
  const self: Rig = {
    crowd,
    core,
    fetched,
    warmed,
    uploads,
    frame(dt = 1 / 60) {
      core.clock.time += dt;
      crowd.update(dt, 0);
    },
    async run(seconds, done) {
      for (let t = 0; t < seconds; t += 1 / 60) {
        self.frame();
        if (done?.()) return;
        // let the fake downloads / compiles (real timers) settle every few frames
        if (Math.round(t * 60) % 6 === 0) await new Promise((r) => setTimeout(r, 6));
      }
    },
  };
  return self;
}

const types: CrowdTypeDef[] = ['a', 'b', 'c', 'd'].map((k) => ({ key: k, modelId: `m_${k}`, radius: 0.8 }));

function feedOf(typeIdx: number[]): EnemyFeed {
  const n = typeIdx.length;
  const f = (v: number): Float32Array => new Float32Array(n).fill(v);
  return {
    count: n,
    x: f(3),
    z: f(2),
    px: f(3),
    pz: f(2),
    rot: f(0),
    scale: f(1),
    type: Uint8Array.from(typeIdx),
    animClip: new Uint8Array(n).fill(CLIP_NAMES.indexOf('idle')),
    animT: f(0.2),
    flash: f(0),
    eliteTier: new Uint8Array(n),
    corrupted: f(0),
    status: new Uint16Array(n),
    id: Uint32Array.from(typeIdx, (_, i) => i + 1),
    flags: new Uint8Array(n),
  };
}

describe('crowd background streaming', () => {
  it('loads the `used` types with the run and nothing else; later types wait for the delay and their lead', async () => {
    const r = rig();
    await r.crowd.load(types, [0], undefined, [
      { type: 1, at: 60 },
      { type: 2, at: 300 },
    ]);
    expect(batches(r)[0]).toBeDefined();
    expect(batches(r)[1]).toBeUndefined();
    expect(r.fetched).toEqual([]);

    // the first CROWD_STREAM_DELAY seconds download nothing, however close a type is
    const streamTime = (t: number): void => void ((r.crowd as unknown as { streamTime: number }).streamTime = t);
    streamTime(CROWD_STREAM_DELAY - 0.5);
    await r.run(0.25);
    expect(r.fetched).toEqual([]);

    // type 1 (at 60 s) starts right after the delay; type 2 (at 300 s) only CROWD_STREAM_LEAD s before it
    await r.run(3, () => batches(r)[1] !== undefined);
    expect(r.fetched).toEqual(['m_b']);
    expect(batches(r)[1]).toBeDefined();
    expect(batches(r)[2]).toBeUndefined();
    streamTime(200);
    await r.run(0.5);
    expect(r.fetched).toEqual(['m_b']);

    // the render clock of the run: just before the lead of type 2, nothing; past it, the download starts
    streamTime(300 - CROWD_STREAM_LEAD - 1);
    await r.run(0.5);
    expect(r.fetched).toEqual(['m_b']);
    await r.run(3, () => batches(r)[2] !== undefined);
    expect(r.fetched).toEqual(['m_b', 'm_c']);
    expect(batches(r)[2]).toBeDefined();
    expect(batches(r)[3]).toBeUndefined(); // never scheduled, never on screen
  });

  it('a streamed batch stays hidden and uncompiled until its program is ready, the bake texture is uploaded first', async () => {
    const r = rig();
    await r.crowd.load(types, [0], undefined, [{ type: 1, at: 20 }]);
    (r.crowd as unknown as { streamTime: number }).streamTime = CROWD_STREAM_DELAY;
    let hidden = true;
    let sawWarm = false;
    for (let i = 0; i < 600 && batches(r)[1] === undefined; i++) {
      r.frame();
      await new Promise((res) => setTimeout(res, 4));
      // the batch's mesh joins the scene (so it can be compiled) but is never visible before activation
      const mesh = r.core.scene.children.find((c) => (c as InstancedMesh).isInstancedMesh && c !== (batches(r)[0] as { mesh: unknown }).mesh) as InstancedMesh | undefined;
      if (mesh) hidden &&= mesh.visible === false;
      if (r.warmed.length > 0) sawWarm = true;
    }
    expect(batches(r)[1]).toBeDefined();
    expect(sawWarm).toBe(true);
    expect(hidden).toBe(true);
    expect(r.warmed).toHaveLength(1);
    expect(r.uploads.length).toBeGreaterThan(0);
  });

  it('bakes in slices: a model spreads over several frames, never one whole bake in a frame', async () => {
    const r = rig();
    await r.crowd.load(types, [0], undefined, [{ type: 1, at: 20 }]);
    (r.crowd as unknown as { streamTime: number }).streamTime = CROWD_STREAM_DELAY;
    // every bake slice (one clip) costs more than the frame's budget, as on a slow device
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1.5));
    const stages: string[] = [];
    try {
      for (let i = 0; i < 80 && batches(r)[1] === undefined; i++) {
        r.frame();
        await new Promise((res) => setTimeout(res, 2));
        const it = (r.crowd as unknown as { items: { stage: string }[] }).items[0];
        if (it) stages.push(it.stage);
      }
    } finally {
      now.mockRestore();
    }
    expect(batches(r)[1]).toBeDefined();
    // 4 clips at 2 slices a frame: the model is in 'baking' on at least two frame boundaries
    expect(stages.filter((x) => x === 'baking').length).toBeGreaterThanOrEqual(2);
    // and the stages come strictly one after the other
    const order = ['queued', 'fetching', 'fetched', 'baking', 'baked', 'built', 'warming', 'ready'];
    const idx = stages.map((x) => order.indexOf(x));
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThanOrEqual(idx[i - 1] as number);
  });

  it('a feed row of a type without a model fetches it at once, ahead of the schedule, and stays hidden until it is ready', async () => {
    const r = rig();
    await r.crowd.load(types, [0], undefined, [{ type: 1, at: 600 }]);
    r.crowd.feed = feedOf([0, 1, 1, 3]); // type 1 is scheduled for 600 s, type 3 is not scheduled at all
    r.frame();
    expect(r.crowd.stats.drawn).toBe(1); // only the loaded type draws
    await r.run(5, () => batches(r)[1] !== undefined && batches(r)[3] !== undefined);
    expect(r.fetched.sort()).toEqual(['m_b', 'm_d']);
    r.frame();
    expect(r.crowd.stats.drawn).toBe(4);
  });

  it('a new load drops what an older run still had in flight', async () => {
    const r = rig();
    await r.crowd.load(types, [0], undefined, [{ type: 1, at: 20 }]);
    (r.crowd as unknown as { streamTime: number }).streamTime = CROWD_STREAM_DELAY;
    await r.run(1, () => r.fetched.length > 0);
    expect(r.fetched).toEqual(['m_b']);
    await r.crowd.load(types, [0], undefined, []); // next run, nothing to stream
    await new Promise((res) => setTimeout(res, 60));
    await r.run(5);
    expect(batches(r)[1]).toBeUndefined();
    expect((r.crowd as unknown as { items: unknown[] }).items).toEqual([]);
  });

  it('without a warm sink (tests, tools) a streamed type is active as soon as it is built', async () => {
    const r = rig({ warm: false });
    await r.crowd.load(types, [0], undefined, [{ type: 1, at: 20 }]);
    (r.crowd as unknown as { streamTime: number }).streamTime = CROWD_STREAM_DELAY;
    await r.run(10, () => batches(r)[1] !== undefined);
    expect(batches(r)[1]).toBeDefined();
  });

  it('an urgent type sharing a model that is already mid-bake never deadlocks the streaming queue', async () => {
    const sharedTypes: CrowdTypeDef[] = [
      { key: 'a', modelId: 'm_a', radius: 0.8 },
      { key: 'shared1', modelId: 'm_shared', radius: 0.8 },
      { key: 'shared2', modelId: 'm_shared', radius: 0.9, tint: '#ff4422' },
      { key: 'other', modelId: 'm_other', radius: 0.8 },
    ];
    const r = rig({ warm: false });
    await r.crowd.load(sharedTypes, [0], undefined, [
      { type: 1, at: 20 },
      { type: 3, at: 25 },
    ]);
    (r.crowd as unknown as { streamTime: number }).streamTime = CROWD_STREAM_DELAY;
    // Stretch baking across multiple frames so type 1 is guaranteed to be mid-bake when type 2 becomes urgent.
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 2.5));
    try {
      // Advance until type 1's item enters 'baking'.
      for (let i = 0; i < 60; i++) {
        r.frame();
        await new Promise((res) => setTimeout(res, 2));
        const items = (r.crowd as unknown as { items: { modelId: string; stage: string }[] }).items;
        if (items.some((it) => it.modelId === 'm_shared' && it.stage === 'baking')) break;
      }
      const items = (r.crowd as unknown as { items: { modelId: string; stage: string }[] }).items;
      expect(items.some((it) => it.modelId === 'm_shared' && it.stage === 'baking')).toBe(true);

      // Now type 2 (same modelId 'm_shared') appears on screen urgently while type 1 is mid-bake!
      r.crowd.feed = feedOf([2]);
      await r.run(5, () => batches(r)[1] !== undefined && batches(r)[2] !== undefined && batches(r)[3] !== undefined);
    } finally {
      now.mockRestore();
    }
    expect(batches(r)[1]).toBeDefined();
    expect(batches(r)[2]).toBeDefined();
    expect(batches(r)[3]).toBeDefined();
  });

  it('deferBlobEnd withholds blobs.end() in crowd.update so heroes and metins can append before flush', async () => {
    const r = rig({ warm: false });
    await r.crowd.load(types, [0], undefined, []);
    const order: string[] = [];
    vi.spyOn(r.crowd.blobs, 'begin').mockImplementation(() => void order.push('begin'));
    vi.spyOn(r.crowd.blobs, 'add').mockImplementation(() => void order.push('add'));
    vi.spyOn(r.crowd.blobs, 'end').mockImplementation(() => void order.push('end'));

    r.crowd.feed = feedOf([0]);
    r.crowd.deferBlobEnd = true;
    r.frame();
    // Crowd wrote begin + enemy add, but did NOT flush yet:
    expect(order).toEqual(['begin', 'add']);
    // Heroes and Metins now append their shadows before the combined end() flush:
    r.crowd.blobs.add(0, 0, 0, 0.9, 0.7);
    r.crowd.blobs.add(5, 0, 5, 2.0, 0.9);
    r.crowd.blobs.end();
    expect(order).toEqual(['begin', 'add', 'add', 'add', 'end']);
  });

  it.each(['baking', 'baked', 'built', 'warming'] as const)(
    'wantType arriving during %s reuses the single model owner without leaking meshes on releaseRun',
    async (targetStage) => {
      const sharedTypes: CrowdTypeDef[] = [
        { key: 'a', modelId: 'm_a', radius: 0.8 },
        { key: 's1', modelId: 'm_shared', radius: 0.8 },
        { key: 's2', modelId: 'm_shared', radius: 0.9, tint: '#ff4422' },
      ];
      let resolveWarm: (() => void) | null = null;
      const r = rig({ warm: false });
      r.crowd.warmSink = (mesh) => {
        r.warmed.push(mesh);
        return new Promise<void>((res) => {
          const prev = resolveWarm;
          resolveWarm = () => {
            prev?.();
            res();
          };
        });
      };

      await r.crowd.load(sharedTypes, [0], undefined, [{ type: 1, at: 20 }]);
      (r.crowd as unknown as { streamTime: number }).streamTime = CROWD_STREAM_DELAY;
      let clock = 0;
      const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 2.5));
      try {
        // Advance until m_shared reaches the exact targetStage.
        for (let i = 0; i < 120; i++) {
          r.frame();
          await new Promise((res) => setTimeout(res, 2));
          const items = (r.crowd as unknown as { items: { modelId: string; stage: string; urgent: boolean }[] }).items;
          if (items.some((it) => it.modelId === 'm_shared' && it.stage === targetStage)) break;
        }
        const items = (r.crowd as unknown as { items: { modelId: string; stage: string; urgent: boolean }[] }).items;
        const owner = items.find((it) => it.modelId === 'm_shared');
        expect(owner?.stage).toBe(targetStage);

        // Request BOTH the same type (1) and a sibling type sharing m_shared (2) while in targetStage!
        r.crowd.feed = feedOf([1, 2]);
        r.frame();

        const afterItems = (r.crowd as unknown as { items: { modelId: string; stage: string; urgent: boolean }[] }).items;
        const matchingOwners = afterItems.filter((it) => it.modelId === 'm_shared');
        expect(matchingOwners).toHaveLength(1);
        expect(matchingOwners[0]?.urgent).toBe(true);

        // Pump to completion, releasing any pending warm promises as they arrive.
        for (let i = 0; i < 120 && (batches(r)[1] === undefined || batches(r)[2] === undefined); i++) {
          if (resolveWarm) {
            const fn = resolveWarm;
            resolveWarm = null;
            fn();
            await Promise.resolve();
          }
          r.frame();
          await new Promise((res) => setTimeout(res, 2));
        }

        expect(batches(r)[1]).toBeDefined();
        expect(batches(r)[2]).toBeDefined();
        r.frame();
        expect(r.crowd.stats.drawn).toBe(2);
      } finally {
        now.mockRestore();
      }

      // releaseRun must leave ZERO InstancedMesh objects in the scene.
      r.crowd.releaseRun();
      const orphanMeshes = r.core.scene.children.filter((c) => (c as InstancedMesh).isInstancedMesh);
      expect(orphanMeshes).toHaveLength(0);
    },
  );

  it('defensively disposes an existing batch if a ready item replaces an occupied type slot', async () => {
    const r = rig({ warm: false });
    await r.crowd.load(types, [0, 1], undefined, []);
    const oldBatch = batches(r)[1] as { mesh: InstancedMesh; material: MeshLambertMaterial };
    expect(oldBatch).toBeDefined();
    expect(r.core.scene.children).toContain(oldBatch.mesh);
    const matDispose = vi.spyOn(oldBatch.material, 'dispose');
    const geoDispose = vi.spyOn(oldBatch.mesh.geometry, 'dispose');

    // Simulate a ready StreamItem delivering a replacement batch for type 1.
    const replacement = (r.crowd as unknown as { createBatch: (def: CrowdTypeDef, cap: number, t: number) => unknown }).createBatch(types[1]!, 64, 1);
    (r.crowd as unknown as { items: unknown[] }).items.push({
      modelId: 'm_b',
      at: 0,
      urgent: true,
      types: [1],
      stage: 'ready',
      retryAt: 0,
      baker: null,
      built: [replacement],
    });

    r.frame();
    expect(batches(r)[1]).toBe(replacement);
    expect(r.core.scene.children).not.toContain(oldBatch.mesh);
    expect(matDispose).toHaveBeenCalledTimes(1);
    expect(geoDispose).toHaveBeenCalledTimes(1);

    r.crowd.releaseRun();
    const orphanMeshes = r.core.scene.children.filter((c) => (c as InstancedMesh).isInstancedMesh);
    expect(orphanMeshes).toHaveLength(0);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Texture,
} from 'three';
import type { Assets, ModelInstance } from '../../../engine/assets';
import type { TerrainField } from '../../../world/terrainField';
import type { ZoneContext } from '../zoneContext';
import { dressGround } from '../liquid/devScene';
import { createActors } from './actors';
import { createDebugGround } from './debugGround';
import { GalleryHost } from './host';
import { createStage } from './modes/structures';

describe('GalleryHost CPU timing vs animation-frame interval (RENDER-DEV-01)', () => {
  const origRaf = globalThis.requestAnimationFrame;

  afterEach(() => {
    vi.restoreAllMocks();
    if (origRaf === undefined) Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    else globalThis.requestAnimationFrame = origRaf;
  });

  function makeBareHost(): GalleryHost {
    const host = Object.create(GalleryHost.prototype) as GalleryHost;
    Object.assign(host, {
      core: {
        renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
        gpuTimer: null,
        quality: { profile: { tier: 'high' } },
      },
      frameTimes: [],
      cpuTimes: [],
      lastFrameStart: 0,
      frameCpuStart: 0,
      lastCpuSample: -1,
      cpuSampleSeq: 0,
      statsEl: { textContent: '' },
      zoneId: 'yeonmu',
      cam: 'gameplay',
    });
    return host;
  }

  it('never reports vsync wall interval as cpuMs when no CPU work is recorded, and reports real CPU ms separately from frameMs', async () => {
    let clockMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clockMs);

    // 1) Scheduler-only 60 Hz RAF with zero rendering: cpuMs must be -1 (unavailable), NOT 16.67 ms!
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      queueMicrotask(() => {
        clockMs += 1000 / 60;
        cb(clockMs);
      });
      return 1;
    };

    const idleHost = makeBareHost();
    expect(idleHost.stats().cpuMs).toBe(-1);
    expect(idleHost.stats().frameMs).toBe(-1);

    const idleMeasured = await idleHost.measure(20);
    expect(idleMeasured.frameMs).toBeCloseTo(1000 / 60, 2);
    expect(idleMeasured.fps).toBeCloseTo(60, 1);
    expect(idleMeasured.cpuMs).toBe(-1);

    // 2) Active rendering where each 60 Hz frame performs 2.5 ms of synchronous update+render work.
    const activeHost = makeBareHost();
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      queueMicrotask(() => {
        clockMs += 1000 / 60;
        activeHost.afterRender(2.5);
        cb(clockMs);
      });
      return 1;
    };

    const activeMeasured = await activeHost.measure(20);
    expect(activeMeasured.frameMs).toBeCloseTo(1000 / 60, 2);
    expect(activeMeasured.cpuMs).toBeCloseTo(2.5, 4);
    expect(activeHost.stats().cpuMs).toBeCloseTo(2.5, 4);
  });
});

describe('Dev gallery resource ownership & disposal (RENDER-DEV-02)', () => {
  it('structures review stage disposes EVERY owned geometry and material (ground, grid lines, ruler bands, hero capsule)', () => {
    const fakeHost = { cam: 'orbit' } as unknown as GalleryHost;
    // rulerHeight = 7 => 1 ground + 2 line grids + 7 ruler bands + 1 hero = 11 distinct geometries & 11 materials
    const stage = createStage(fakeHost, 10, 7);

    const geos = new Set<BufferGeometry>();
    const mats = new Set<Material>();
    stage.group.traverse((obj) => {
      const m = obj as Mesh | LineSegments;
      if (m.geometry) geos.add(m.geometry);
      if (m.material) {
        if (Array.isArray(m.material)) for (const item of m.material) mats.add(item);
        else mats.add(m.material);
      }
    });

    expect(geos.size).toBe(11);
    expect(mats.size).toBe(11);

    let geoDisposed = 0;
    let matDisposed = 0;
    for (const g of geos) g.addEventListener('dispose', () => void geoDisposed++);
    for (const m of mats) m.addEventListener('dispose', () => void matDisposed++);

    stage.dispose();
    expect(geoDisposed).toBe(11);
    expect(matDisposed).toBe(11);
    expect(stage.group.children).toHaveLength(0);
  });

  it('dressGround + debugGround disposes replaced material, replacement material, and dev boulder geometries/materials while preserving shared Assets textures', async () => {
    const sharedTex = new Texture();
    let sharedTexDisposed = 0;
    sharedTex.addEventListener('dispose', () => void sharedTexDisposed++);

    const ctx = {
      biome: { id: 'yeonmu', fog: { color: '#8899aa' } },
      assets: {
        hasTexture: () => true,
        loadTexture: vi.fn(async () => sharedTex),
      },
      field: {
        size: 16,
        grid: { n: 5 },
        layout: { liquid: { level: -1 } },
        heightAt: () => 0,
        normalAt: (_x: number, _z: number, out: { x: number; y: number; z: number }) => {
          out.x = 0;
          out.y = 1;
          out.z = 0;
        },
        surfaceAt: () => 0,
      },
    } as unknown as ZoneContext;

    const ground = createDebugGround(ctx, 8, 4);
    const groundMesh = ground.group.children[0] as Mesh;
    const origMat = groundMesh.material as Material;
    let origMatDisposed = 0;
    origMat.addEventListener('dispose', () => void origMatDisposed++);

    await dressGround(ctx, ground, [
      { kind: 'boulder', x: 1, y: 0, z: 2, yaw: 0, sx: 1, sy: 1, sz: 1, mat: 0, seed: 1 },
      { kind: 'boulder', x: -2, y: 0, z: -1, yaw: 1, sx: 1.5, sy: 1, sz: 1.2, mat: 0, seed: 2 },
    ]);

    // Original debug material was disposed immediately on replacement!
    expect(origMatDisposed).toBe(1);
    expect(groundMesh.material).not.toBe(origMat);

    // Collect every remaining geometry (ground + 2 boulders = 3) and material (dressed ground + boulder mat = 2).
    const geos = new Set<BufferGeometry>();
    const mats = new Set<Material>();
    ground.group.traverse((obj) => {
      const m = obj as Mesh;
      if (m.geometry) geos.add(m.geometry);
      if (m.material) {
        if (Array.isArray(m.material)) for (const item of m.material) mats.add(item);
        else mats.add(m.material);
      }
    });
    expect(geos.size).toBe(3);
    expect(mats.size).toBe(2);

    let geoDisposed = 0;
    let matDisposed = 0;
    for (const g of geos) g.addEventListener('dispose', () => void geoDisposed++);
    for (const m of mats) m.addEventListener('dispose', () => void matDisposed++);

    ground.dispose();
    expect(geoDisposed).toBe(3);
    expect(matDisposed).toBe(2);
    expect(sharedTexDisposed).toBe(0);
    expect(ground.group.children).toHaveLength(0);
  });

  it('createActors disposes every cloned actor skeleton on dispose while preserving shared geometries/materials', async () => {
    const sharedGeo = new BufferGeometry();
    sharedGeo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3));
    sharedGeo.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 4));
    sharedGeo.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const sharedMat = new MeshBasicMaterial();
    const sharedGeoSpy = vi.spyOn(sharedGeo, 'dispose');
    const sharedMatSpy = vi.spyOn(sharedMat, 'dispose');

    const skeletons: Skeleton[] = [];
    const assets = {
      loadModel: vi.fn(async () => undefined),
      instantiate: () => {
        const root = new Group();
        const bone = new Bone();
        const sm = new SkinnedMesh(sharedGeo, sharedMat);
        const skel = new Skeleton([bone]);
        root.add(bone, sm);
        root.updateMatrixWorld(true);
        sm.bind(skel, sm.matrixWorld);
        skeletons.push(skel);
        return { root, meshes: [sm], skinned: [sm], bones: new Map() } as unknown as ModelInstance;
      },
    } as unknown as Assets;

    const field = { heightAt: () => 0 } as unknown as TerrainField;
    const actors = await createActors(assets, field);

    expect(skeletons.length).toBe(11); // 1 hero + 10 enemies
    const skelSpies = skeletons.map((s) => vi.spyOn(s, 'dispose'));

    actors.dispose();
    for (const spy of skelSpies) expect(spy).toHaveBeenCalledTimes(1);
    expect(sharedGeoSpy).not.toHaveBeenCalled();
    expect(sharedMatSpy).not.toHaveBeenCalled();
  });
});

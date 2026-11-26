import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
} from 'three';
import type { Assets, LoadedModel, ModelInstance } from '../engine/assets';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class MockWebGLRenderer {
    outputColorSpace = '';
    toneMapping = 0;
    toneMappingExposure = 1;
    domElement = {
      style: { cssText: '', cursor: '' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => false),
      remove: vi.fn(),
    };
    setClearColor = vi.fn();
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    forceContextLoss = vi.fn();
  }
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

import { createHeroPreview } from './heroPreview';

interface BuiltInstance {
  inst: ModelInstance;
  skeleton: Skeleton;
}

function makeTemplate(
  id: string,
  extras: Record<string, unknown>,
  withHands = false,
): {
  model: LoadedModel;
  sharedGeoDispose: ReturnType<typeof vi.spyOn>;
  sharedMatDispose: ReturnType<typeof vi.spyOn>;
  instantiate: () => BuiltInstance;
} {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 1.8, 0, 0.3, 1.8, 0.2], 3));
  geo.setAttribute('skinIndex', new BufferAttribute(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 4));
  geo.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mat = new MeshBasicMaterial();
  const sharedGeoDispose = vi.spyOn(geo, 'dispose');
  const sharedMatDispose = vi.spyOn(mat, 'dispose');

  const instantiate = (): BuiltInstance => {
    const root = new Group();
    const body = new Bone();
    body.name = 'body';
    const bones = new Map<string, Bone>([['body', body]]);
    const boneList: Bone[] = [body];
    if (withHands) {
      const r = new Bone();
      r.name = 'hand_r';
      const l = new Bone();
      l.name = 'hand_l';
      body.add(r, l);
      bones.set('hand_r', r);
      bones.set('hand_l', l);
      boneList.push(r, l);
    }
    const sm = new SkinnedMesh(geo, mat);
    const skeleton = new Skeleton(boneList);
    root.add(body, sm);
    root.updateMatrixWorld(true);
    sm.bind(skeleton, sm.matrixWorld);
    return {
      inst: { root, meshes: [sm], skinned: [sm], bones } as unknown as ModelInstance,
      skeleton,
    };
  };

  const model = {
    id,
    asset: { id, url: '', kind: withHands ? 'hero' : 'weapon', height: 1.8, radius: 0.4, clips: {}, tris: 1, bones: withHands ? 3 : 1, bytes: 0 },
    scene: new Group(),
    clips: [],
    clipMap: new Map(),
    skinned: [],
    meshes: [],
    extras,
  } as unknown as LoadedModel;

  return { model, sharedGeoDispose, sharedMatDispose, instantiate };
}

describe('createHeroPreview skeleton disposal (RENDER-06)', () => {
  const origWindow = globalThis.window;
  const origResizeObserver = globalThis.ResizeObserver;
  const origRaf = globalThis.requestAnimationFrame;
  const origCancelRaf = globalThis.cancelAnimationFrame;

  afterEach(() => {
    if (origWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else globalThis.window = origWindow;
    if (origResizeObserver === undefined) Reflect.deleteProperty(globalThis, 'ResizeObserver');
    else globalThis.ResizeObserver = origResizeObserver;
    if (origRaf === undefined) Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    else globalThis.requestAnimationFrame = origRaf;
    if (origCancelRaf === undefined) Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    else globalThis.cancelAnimationFrame = origCancelRaf;
  });

  it('disposes all cloned hero, main-weapon, and off-hand weapon skeletons on switch and dispose without disposing shared assets', async () => {
    globalThis.window = { devicePixelRatio: 1 } as unknown as Window & typeof globalThis;
    globalThis.ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => undefined;

    const heroA = makeTemplate(
      'hero_a',
      { humanoid: { handFrame: 'anatomical equip joints' }, sockets: { hand_r: 'hand_r', hand_l: 'hand_l' } },
      true,
    );
    const heroB = makeTemplate(
      'hero_b',
      { humanoid: { handFrame: 'anatomical equip joints' }, sockets: { hand_r: 'hand_r', hand_l: 'hand_l' } },
      true,
    );
    // Dual-wield dagger triggers BOTH main and mirrored off-hand weapon instantiations!
    const dualDagger = makeTemplate('weapon_dagger', { weapon: { type: 'dagger' } }, false);
    const sword = makeTemplate('weapon_sword', { weapon: { type: 'sword' } }, false);

    const templates = new Map([
      ['hero_a', heroA],
      ['hero_b', heroB],
      ['weapon_dagger', dualDagger],
      ['weapon_sword', sword],
    ]);

    const createdByModel = new Map<string, Skeleton[]>();
    const assets = {
      loadBatch: vi.fn(async () => undefined),
      model: (id: string) => templates.get(id)!.model,
      instantiate: (id: string) => {
        const built = templates.get(id)!.instantiate();
        const list = createdByModel.get(id) ?? [];
        list.push(built.skeleton);
        createdByModel.set(id, list);
        return built.inst;
      },
    } as unknown as Assets;

    const container = {
      clientWidth: 400,
      clientHeight: 500,
      appendChild: vi.fn(),
    } as unknown as HTMLElement;

    const factory = createHeroPreview(assets, (sel) =>
      sel.classId === 'ninja'
        ? { modelId: 'hero_a', weaponId: 'weapon_dagger', styleB: false }
        : { modelId: 'hero_b', weaponId: 'weapon_sword', styleB: false },
    );

    const handle = factory.mount(container, {
      classId: 'ninja',
      sex: 'm',
      doctrine: 'a',
      empire: 'saehwa',
      armorTier: 0,
    });
    await new Promise((r) => setTimeout(r, 10));

    // Initial preview created 1 hero skeleton + 2 weapon skeletons (main + mirrored off-hand).
    const firstHeroSkels = createdByModel.get('hero_a') ?? [];
    const firstWeaponSkels = createdByModel.get('weapon_dagger') ?? [];
    expect(firstHeroSkels).toHaveLength(1);
    expect(firstWeaponSkels).toHaveLength(2);
    const firstSpies = [...firstHeroSkels, ...firstWeaponSkels].map((s) => vi.spyOn(s, 'dispose'));

    // Switch preview to warrior with sword -> all 3 skeletons from ninja preview must be disposed!
    handle.update({
      classId: 'warrior',
      sex: 'm',
      doctrine: 'a',
      empire: 'saehwa',
      armorTier: 0,
    });
    await new Promise((r) => setTimeout(r, 10));

    for (const spy of firstSpies) expect(spy).toHaveBeenCalledTimes(1);

    const secondHeroSkels = createdByModel.get('hero_b') ?? [];
    const secondWeaponSkels = createdByModel.get('weapon_sword') ?? [];
    expect(secondHeroSkels).toHaveLength(1);
    expect(secondWeaponSkels).toHaveLength(1);
    const secondSpies = [...secondHeroSkels, ...secondWeaponSkels].map((s) => vi.spyOn(s, 'dispose'));

    // Disposing preview disposes the second preview's skeletons too.
    handle.dispose();
    for (const spy of secondSpies) expect(spy).toHaveBeenCalledTimes(1);

    // Shared geometries and materials from Assets must NEVER be disposed.
    for (const tpl of templates.values()) {
      expect(tpl.sharedGeoDispose).not.toHaveBeenCalled();
      expect(tpl.sharedMatDispose).not.toHaveBeenCalled();
    }
  });
});

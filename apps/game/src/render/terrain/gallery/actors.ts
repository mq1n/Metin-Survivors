// DEV: a hero and a pack of enemies standing around the hero focus, so ground/vegetation contrast can be judged the way
// the game shows it (value contrast of characters on the terrain). Uses real Forge GLBs when present, Engine's DEV
// placeholders otherwise.
import { Group, type Object3D, type PerspectiveCamera, type Vector3 } from 'three';
import type { Assets, ModelInstance } from '../../../engine/assets';
import type { TerrainField } from '../../../world/terrainField';
import type { ZoneSystem } from '../zoneContext';

interface Actor {
  inst: ModelInstance;
  root: Object3D;
  /** offset from the hero in the camera-aligned frame (m) */
  dx: number;
  dz: number;
  rot: number;
}

const ENEMY_IDS = ['wolf', 'wolf', 'alpha_wolf', 'wild_dog', 'grey_wolf', 'wolf', 'blue_wolf', 'wolf', 'wild_dog', 'alpha_grey_wolf'];

export interface GalleryActors extends ZoneSystem {
  /** repositions the pack around the hero at (x,z) */
  place(x: number, z: number): void;
}

export async function createActors(assets: Assets, field: TerrainField, heroId = 'warrior_m_t1'): Promise<GalleryActors> {
  const group = new Group();
  group.name = 'actors';
  const actors: Actor[] = [];
  const add = async (id: string, hint: 'hero' | 'creature', dx: number, dz: number, rot: number): Promise<void> => {
    try {
      await assets.loadModel(id, hint);
      const inst = assets.instantiate(id);
      inst.root.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      });
      group.add(inst.root);
      actors.push({ inst, root: inst.root, dx, dz, rot });
    } catch (err) {
      console.warn(`[gallery actors] ${id}: ${String(err)}`);
    }
  };
  await add(heroId, 'hero', 0, 0, 0);
  const n = ENEMY_IDS.length;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.4;
    const r = 4.5 + (i % 3) * 2.6;
    const dx = Math.cos(a) * r;
    const dz = Math.sin(a) * r;
    await add(ENEMY_IDS[i] as string, 'creature', dx, dz, Math.atan2(-dx, -dz));
  }
  let hx = 0;
  let hz = 0;
  const place = (x: number, z: number): void => {
    hx = x;
    hz = z;
    for (const a of actors) {
      const px = x + a.dx;
      const pz = z + a.dz;
      a.root.position.set(px, field.heightAt(px, pz), pz);
      a.root.rotation.y = a.rot;
    }
  };
  place(hx, hz);
  return {
    name: 'actors',
    group,
    place,
    update(_dt: number, _camera: PerspectiveCamera, _focus: Vector3) {},
    setQuality() {},
    dispose() {
      const seen = new Set<unknown>();
      for (const a of actors) {
        for (const sm of a.inst.skinned) {
          if (sm.skeleton && !seen.has(sm.skeleton)) {
            seen.add(sm.skeleton);
            sm.skeleton.dispose();
          }
        }
      }
      actors.length = 0;
      group.clear();
    },
  };
}

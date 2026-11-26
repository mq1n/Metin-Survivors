// DEV-only stand-in terrain until the TERRAIN agent's zone renderer is wired: textured flat plane + faint 4 m grid.
import {
  Color,
  GridHelper,
  LineBasicMaterial,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  type Object3D,
  type Texture,
} from 'three';
import type { BiomePreset } from '../data/schema';
import type { RenderCore } from '../render/core';

export async function createDevGround(core: RenderCore, biome: Pick<BiomePreset, 'ground'>): Promise<Object3D> {
  const size = 600;
  let map: Texture | null = null;
  const id = biome.ground[0];
  if (id) {
    try {
      map = (await core.assets.loadTexture(id)).clone();
      map.wrapS = map.wrapT = RepeatWrapping;
      map.repeat.set(size / 8, size / 8);
      map.needsUpdate = true;
    } catch {
      map = null;
    }
  }
  const ground = new Mesh(
    new PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new MeshLambertMaterial({ color: new Color(map ? '#ffffff' : '#4d5a3a'), map }),
  );
  ground.receiveShadow = true;
  const grid = new GridHelper(size, size / 4, '#000000', '#000000');
  const mat = grid.material as LineBasicMaterial;
  mat.transparent = true;
  mat.opacity = 0.08;
  grid.position.y = 0.02;
  ground.add(grid);
  ground.name = 'dev-ground';
  return ground;
}

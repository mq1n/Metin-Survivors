// DEV stand-in terrain: one lit mesh of the baked height grid, vertex-coloured by slope/surface. Lets the vegetation,
// liquid and structure helpers test against the real TerrainField before the production terrain renderer lands.
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, type Material, type PerspectiveCamera, type Vector3 } from 'three';
import { SURFACE } from '../../../world/layoutTypes';
import type { ZoneContext, ZoneSystem } from '../zoneContext';

export function createDebugGround(ctx: ZoneContext, extent = 300, step = 2): ZoneSystem {
  const f = ctx.field;
  const g = f.grid;
  const half = Math.min(extent, f.size / 2);
  const nn = Math.floor((half * 2) / step) + 1;
  const pos = new Float32Array(nn * nn * 3);
  const col = new Float32Array(nn * nn * 3);
  const nrm = new Float32Array(nn * nn * 3);
  const base = new Color(ctx.biome.fog.color).lerp(new Color('#6f8a4a'), 0.7);
  const rock = new Color('#80786c');
  const c = new Color();
  const n = { x: 0, y: 1, z: 0 };
  for (let j = 0; j < nn; j++) {
    for (let i = 0; i < nn; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      const h = f.heightAt(x, z);
      const o = (j * nn + i) * 3;
      pos[o] = x;
      pos[o + 1] = h;
      pos[o + 2] = z;
      f.normalAt(x, z, n);
      nrm[o] = n.x;
      nrm[o + 1] = n.y;
      nrm[o + 2] = n.z;
      c.copy(base).lerp(rock, Math.min(1, Math.max(0, (1 - n.y - 0.12) * 3)));
      const s = f.surfaceAt(x, z);
      if (s === SURFACE.DEEP || s === SURFACE.SHALLOW) c.set('#35677f');
      else if (s === SURFACE.LAVA) c.set('#ff6a1a');
      else if (s === SURFACE.ICE) c.set('#9ccbe6');
      col[o] = c.r;
      col[o + 1] = c.g;
      col[o + 2] = c.b;
    }
  }
  const idx = new Uint32Array((nn - 1) * (nn - 1) * 6);
  let k = 0;
  for (let j = 0; j < nn - 1; j++) {
    for (let i = 0; i < nn - 1; i++) {
      const a = j * nn + i;
      idx[k++] = a;
      idx[k++] = a + nn;
      idx[k++] = a + 1;
      idx[k++] = a + 1;
      idx[k++] = a + nn;
      idx[k++] = a + nn + 1;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nrm, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setIndex(new BufferAttribute(idx, 1));
  void g;
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const group = new Group();
  group.name = 'debugGround';
  group.add(mesh);
  let disposed = false;
  group.userData.isDisposed = (): boolean => disposed;
  return {
    name: 'ground',
    group,
    update(_dt: number, _camera: PerspectiveCamera, _focus: Vector3) {},
    setQuality() {},
    dispose() {
      if (disposed) return;
      disposed = true;
      const geos = new Set<BufferGeometry>([geo]);
      const mats = new Set<Material>([mat]);
      group.traverse((obj) => {
        const m = obj as Mesh;
        if (m.geometry) geos.add(m.geometry);
        if (m.material) {
          if (Array.isArray(m.material)) {
            for (const item of m.material) mats.add(item);
          } else {
            mats.add(m.material);
          }
        }
      });
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      group.clear();
    },
  };
}

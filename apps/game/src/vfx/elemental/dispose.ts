// Resource disposal helpers (ported from threejs-vfx utils/dispose.js, MIT — see LICENSE).
import type { BufferGeometry, Material, Mesh, Object3D, Texture } from 'three';

export function disposeMaterial(material: Material | Material[] | null | undefined): void {
  if (!material) return;
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  material.dispose();
}

/** Recursively disposes geometries and materials under `root` and detaches it. */
export function disposeObject(root: Object3D | null | undefined): void {
  if (!root) return;
  root.traverse((node) => {
    const m = node as Mesh;
    const geo = m.geometry as BufferGeometry | undefined;
    geo?.dispose();
    if (m.material) disposeMaterial(m.material);
  });
  root.parent?.remove(root);
}

export function disposeTexture(t: Texture | null | undefined): void {
  t?.dispose();
}

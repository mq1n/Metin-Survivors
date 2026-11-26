// HardMesh -> ModelData (static prop / weapon). Vertex colours come from per-group base colours plus a cheap upward-facing /
// height shading so flat hard-surface parts still read; attach a baked texture through the SDF pipeline if you need more.
import type { Vec3 } from '../math.ts';
import type { ModelData, ModelKind } from '../model.ts';
import { type HardModelMesh } from './hardmesh.ts';

export interface HardModelOpts {
  id: string;
  kind: ModelKind;
  /** linear RGB base colour per group id */
  groupColors: Vec3[];
  sockets?: Record<string, string>;
  extras?: Record<string, unknown>;
  /** darken faces pointing down and the lowest part of the model. Default 0.35 */
  groundShade?: number;
}

export function hardToModel(mesh: HardModelMesh, opts: HardModelOpts): ModelData {
  const nv = mesh.positions.length / 3;
  let minY = Infinity, maxY = -Infinity, r2 = 0;
  for (let i = 0; i < nv; i++) {
    const y = mesh.positions[i * 3 + 1]!;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    r2 = Math.max(r2, mesh.positions[i * 3]! ** 2 + mesh.positions[i * 3 + 2]! ** 2);
  }
  const positions = Float32Array.from(mesh.positions);
  for (let i = 0; i < nv; i++) positions[i * 3 + 1] = positions[i * 3 + 1]! - minY; // origin on the ground
  const colors = new Float32Array(nv * 3);
  const gs = opts.groundShade ?? 0.35;
  const h = Math.max(1e-6, maxY - minY);
  for (let i = 0; i < nv; i++) {
    const base = opts.groupColors[mesh.groups[i]!] ?? opts.groupColors[0] ?? [0.5, 0.5, 0.5];
    const ny = mesh.normals[i * 3 + 1]!;
    const hy = positions[i * 3 + 1]! / h;
    const k = 0.78 + 0.22 * ny - gs * (1 - Math.min(1, hy * 4)) * 0.5;
    colors[i * 3] = base[0] * k; colors[i * 3 + 1] = base[1] * k; colors[i * 3 + 2] = base[2] * k;
  }
  return {
    id: opts.id,
    kind: opts.kind,
    positions,
    normals: mesh.normals,
    colors,
    indices: mesh.indices,
    clips: [],
    height: h,
    radius: Math.sqrt(r2),
    ...(opts.sockets ? { sockets: opts.sockets } : {}),
    ...(opts.extras ? { extras: opts.extras } : {}),
  };
}

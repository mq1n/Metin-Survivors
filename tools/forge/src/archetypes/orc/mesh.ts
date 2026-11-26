// Low-poly decimation that survives skinning. The core `simplify()` runs meshopt with ErrorAbsolute only: on smooth SDF bodies
// (cylindrical limbs, big flat torso) the quadric error of axial collapses is ~0, so at crowd budgets (<= 5k tris) it leaves
// 1 m long sliver triangles (legs become cones, bridges form across gaps) and non-manifold vertices from surface nets stay
// locked. `Regularize` keeps triangles well shaped and `Permissive` lets non-manifold / locked vertices collapse: measured on
// orc_fighter at 4.6k tris: longest edge 1.58 m -> 0.13 m, slivers 1126 -> 42, worst centroid error 176 mm -> 19 mm.
import { MeshoptSimplifier } from 'meshoptimizer';
import type { FocusRegion } from '../../core/mesh/simplify.ts';
import { compact, ensureSimplifier } from '../../core/mesh/simplify.ts';
import type { RawMesh } from '../../core/mesh/surfaceNets.ts';

export async function simplifyReg(mesh: RawMesh, opts: { targetTris: number; focus?: FocusRegion[] }): Promise<RawMesh> {
  await ensureSimplifier();
  const nv = mesh.positions.length / 3;
  const warped = new Float32Array(mesh.positions);
  // same focus warp as core/simplify: collapse costs are measured in a copy where focus regions are magnified
  for (const f of opts.focus ?? []) {
    for (let v = 0; v < nv; v++) {
      const dx = warped[v * 3]! - f.c[0], dy = warped[v * 3 + 1]! - f.c[1], dz = warped[v * 3 + 2]! - f.c[2];
      const t = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / f.r;
      if (t <= 0) continue;
      const g = 1 + (f.gain - 1) * t * t * (3 - 2 * t);
      warped[v * 3] = f.c[0] + dx * g; warped[v * 3 + 1] = f.c[1] + dy * g; warped[v * 3 + 2] = f.c[2] + dz * g;
    }
  }
  const target = Math.max(3, Math.floor(opts.targetTris) * 3);
  const [out] = MeshoptSimplifier.simplify(mesh.indices, warped, 3, target, 1e9, ['ErrorAbsolute', 'Regularize', 'Permissive']);
  return compact({ positions: mesh.positions, indices: out });
}

import { describe, expect, test } from 'bun:test';
import { vcross, vdot, vsub, type Vec3 } from '../math.ts';
import type { Vec2 } from './shape2d.ts';
import { hoop } from '../../archetypes/weapon/parts.ts';
import { sweep } from './hardmesh.ts';

function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return vcross(vsub(b, a), vsub(c, a));
}

function signedVolume(positions: Float32Array, indices: Uint32Array): number {
  let vol6 = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]! * 3, ib = indices[i + 1]! * 3, ic = indices[i + 2]! * 3;
    const ax = positions[ia]!, ay = positions[ia + 1]!, az = positions[ia + 2]!;
    const bx = positions[ib]!, by = positions[ib + 1]!, bz = positions[ib + 2]!;
    const cx = positions[ic]!, cy = positions[ic + 1]!, cz = positions[ic + 2]!;
    vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return vol6 / 6;
}

describe('TOOL-RENDER-05 core sweep outward face winding', () => {
  test('straight square sweep emits outward normals on all side and cap faces with positive volume', () => {
    const sq: Vec2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const mesh = sweep(sq, [[0, 0, 0], [0, 0, 2]], { caps: true }).finish();
    const { positions, indices } = mesh;
    expect(indices.length / 3).toBe(12); // 8 side tris + 4 cap tris
    expect(signedVolume(positions, indices)).toBeGreaterThan(7.9); // 2 x 2 x 2 = 8

    // Every triangle normal must point outward from the box center (0, 0, 1)
    const center: Vec3 = [0, 0, 1];
    let outward = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i]! * 3, ib = indices[i + 1]! * 3, ic = indices[i + 2]! * 3;
      const a: Vec3 = [positions[ia]!, positions[ia + 1]!, positions[ia + 2]!];
      const b: Vec3 = [positions[ib]!, positions[ib + 1]!, positions[ib + 2]!];
      const c: Vec3 = [positions[ic]!, positions[ic + 1]!, positions[ic + 2]!];
      const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      const n = triangleNormal(a, b, c);
      if (vdot(n, vsub(centroid, center)) > 0) outward++;
    }
    expect(outward).toBe(12);
  });

  test('hoop(1, 0.1, "y", 24, 8) emits all 384 triangles pointing outward from the torus tube centerline', () => {
    const R = 1;
    const r = 0.1;
    const mesh = hoop(R, r, 'y', 24, 8).finish();
    const { positions, indices } = mesh;
    const nTris = indices.length / 3;
    expect(nTris).toBe(384);
    expect(signedVolume(positions, indices)).toBeGreaterThan(0);

    let outward = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i]! * 3, ib = indices[i + 1]! * 3, ic = indices[i + 2]! * 3;
      const a: Vec3 = [positions[ia]!, positions[ia + 1]!, positions[ia + 2]!];
      const b: Vec3 = [positions[ib]!, positions[ib + 1]!, positions[ib + 2]!];
      const c: Vec3 = [positions[ic]!, positions[ic + 1]!, positions[ic + 2]!];
      const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      const radialLen = Math.hypot(centroid[0], centroid[2]);
      const tubeCenter: Vec3 = [(centroid[0] / radialLen) * R, 0, (centroid[2] / radialLen) * R];
      const n = triangleNormal(a, b, c);
      if (vdot(n, vsub(centroid, tubeCenter)) > 0) outward++;
    }
    expect(outward).toBe(384);
  });
});

import { describe, expect, test } from 'bun:test';
import { buildGlb } from '../../core/export/glb.ts';
import { vcross, vsub, type Vec3 } from '../../core/math.ts';
import { parseGlb } from '../../../scripts/propTex.ts';
import { PropMesh } from '../../archetypes/prop/mesh.ts';
import { prop as bonfireProp } from './bonfire.ts';
import { prop as lampPostProp } from './lamp_post.ts';

function triNormal(pos: Float32Array, ia: number, ib: number, ic: number): Vec3 {
  const a: Vec3 = [pos[ia * 3]!, pos[ia * 3 + 1]!, pos[ia * 3 + 2]!];
  const b: Vec3 = [pos[ib * 3]!, pos[ib * 3 + 1]!, pos[ib * 3 + 2]!];
  const c: Vec3 = [pos[ic * 3]!, pos[ic * 3 + 1]!, pos[ic * 3 + 2]!];
  return vcross(vsub(b, a), vsub(c, a));
}

function signedVolumeOfTris(pos: Float32Array, idx: Uint32Array, tris: number[]): number {
  let vol6 = 0;
  for (const t of tris) {
    const ia = idx[t * 3]! * 3, ib = idx[t * 3 + 1]! * 3, ic = idx[t * 3 + 2]! * 3;
    const ax = pos[ia]!, ay = pos[ia + 1]!, az = pos[ia + 2]!;
    const bx = pos[ib]!, by = pos[ib + 1]!, bz = pos[ib + 2]!;
    const cx = pos[ic]!, cy = pos[ic + 1]!, cz = pos[ic + 2]!;
    vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return vol6 / 6;
}

describe('TOOL-UI-04 bonfire & lamp_post revolution profile winding', () => {
  test('bonfire coal mound has 84/84 upward-facing triangles with single-sided exported material', async () => {
    const m = new PropMesh();
    bonfireProp.build(m);
    const fin = m.finish(bonfireProp.crease ?? 46);

    const EMBER = 3;
    let totalCoals = 0;
    let upwardCoals = 0;
    for (let t = 0; t < fin.indices.length / 3; t++) {
      const ia = fin.indices[t * 3]!, ib = fin.indices[t * 3 + 1]!, ic = fin.indices[t * 3 + 2]!;
      if (fin.groups[ia] !== EMBER) continue;
      totalCoals++;
      const n = triNormal(fin.positions, ia, ib, ic);
      if (n[1] > 0) upwardCoals++;
    }

    expect(totalCoals).toBe(84);
    expect(upwardCoals).toBe(84);

    // Export uncompressed GLB and verify single-sided material contract
    const glb = await buildGlb(
      {
        id: bonfireProp.id,
        kind: 'prop',
        positions: fin.positions,
        normals: fin.normals,
        colors: new Float32Array(fin.positions.length).fill(1),
        indices: fin.indices,
        clips: [],
        height: 1.4,
        radius: 1,
      },
      { noCompress: true },
    );
    const { json } = parseGlb(glb);
    // glTF 2.0 defaults omitted doubleSided to false (single-sided)
    expect(json.materials?.[0]?.doubleSided ?? false).toBe(false);
  });

  test('lamp_post closed tassel has positive signed volume and lower lantern frame faces outward', async () => {
    const m = new PropMesh();
    lampPostProp.build(m);
    const fin = m.finish(lampPostProp.crease ?? 38);

    const FRAME = 6;
    const TASSEL = 7;
    const tasselTris: number[] = [];
    const lowerFrameTris: number[] = [];

    for (let t = 0; t < fin.indices.length / 3; t++) {
      const ia = fin.indices[t * 3]!, ib = fin.indices[t * 3 + 1]!, ic = fin.indices[t * 3 + 2]!;
      const g = fin.groups[ia]!;
      if (g === TASSEL) {
        tasselTris.push(t);
      } else if (g === FRAME) {
        const cy = (fin.positions[ia * 3 + 1]! + fin.positions[ib * 3 + 1]! + fin.positions[ic * 3 + 1]!) / 3;
        if (cy < 3.01) lowerFrameTris.push(t);
      }
    }

    // Closed tassel: 48 triangles, positive signed volume
    expect(tasselTris.length).toBe(48);
    expect(signedVolumeOfTris(fin.positions, fin.indices, tasselTris)).toBeGreaterThan(0);

    // Lower lantern frame (bottom dish under lantern): outward normal points downward (ny < 0) on bottom cap/underside
    expect(lowerFrameTris.length).toBeGreaterThan(0);
    let downwardLowerFrame = 0;
    for (const t of lowerFrameTris) {
      const ia = fin.indices[t * 3]!, ib = fin.indices[t * 3 + 1]!, ic = fin.indices[t * 3 + 2]!;
      const n = triNormal(fin.positions, ia, ib, ic);
      // Lower frame rises from y=2.94 (r=0) -> r=0.1 -> r=0.17 (outward/downward) -> r=0.15 at y=3.0 (inward bevel faces slightly up)
      // At least the bottom cap & expanding underside (y < 2.975) must point downward (ny < 0)
      const cy = (fin.positions[ia * 3 + 1]! + fin.positions[ib * 3 + 1]! + fin.positions[ic * 3 + 1]!) / 3;
      if (cy < 2.975 && n[1] < 0) downwardLowerFrame++;
    }
    expect(downwardLowerFrame).toBeGreaterThan(0);

    // Export uncompressed GLB and verify single-sided material contract
    const glb = await buildGlb(
      {
        id: lampPostProp.id,
        kind: 'prop',
        positions: fin.positions,
        normals: fin.normals,
        colors: new Float32Array(fin.positions.length).fill(1),
        indices: fin.indices,
        clips: [],
        height: 4.2,
        radius: 0.7,
      },
      { noCompress: true },
    );
    const { json } = parseGlb(glb);
    // glTF 2.0 defaults omitted doubleSided to false (single-sided)
    expect(json.materials?.[0]?.doubleSided ?? false).toBe(false);
  });
});

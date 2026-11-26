import { describe, expect, test } from 'bun:test';
import { computeSkinWeights } from '../../core/skin/weights.ts';
import { scarletWyrm } from '../../models/dragon/scarlet_wyrm.ts';
import { computeAnatomy } from './anatomy.ts';
import { makeBody, SKIN_TAU } from './body.ts';
import { MembraneSet, ThickTriangle } from './membrane.ts';
import { makeSkeleton } from './skeleton.ts';

describe('TOOL-RENDER-07 dragon wing membrane analytic skin weights', () => {
  test('boneSources excludes ordinary membrane ThickTriangle parts while keeping non-membrane sources and analytic fields', () => {
    const a = computeAnatomy(scarletWyrm);
    const skel = makeSkeleton(a);
    const { body, membranes } = makeBody(a);

    // Membrane triangles must remain in body.parts for geometry & painting
    expect(body.tagged('membrane').length).toBeGreaterThan(0);

    // Ordinary membrane ThickTriangles must NOT appear in boneSources()
    const sources = body.boneSources();
    for (const [bone, arr] of sources) {
      for (const s of arr) {
        expect(s.sdf instanceof ThickTriangle, `unexpected ThickTriangle in boneSources(${bone})`).toBe(false);
      }
    }
    // Structural body & wing bone sources must still be preserved
    expect((sources.get('chest')?.length ?? 0)).toBeGreaterThan(0);
    expect((sources.get('wing_arm_l')?.length ?? 0)).toBeGreaterThan(0);
    expect((sources.get('wing_f3_l')?.length ?? 0)).toBeGreaterThan(0);
    expect((sources.get('wing_f4_l')?.length ?? 0)).toBeGreaterThan(0);

    // Pick an interior point on a membrane triangle well away from structural wing bones
    const set = new MembraneSet(membranes);
    const wing = membranes[0]!; // left wing (+X)
    const nonMembraneSources = [...sources.entries()].flatMap(([bone, arr]) =>
      arr
        .filter((s) => s.sdf.constructor.name !== 'MembraneWeightField')
        .map((s) => ({ bone, sdf: s.sdf })),
    );

    let probe: [number, number, number] | null = null;
    let analytic: Map<string, number> | null = null;
    for (const tri of wing.tris) {
      // Interior point biased toward vertices b and c (so the arbitrary vertex-a bone differs from the dominant analytic bone!)
      const p: [number, number, number] = [
        0.15 * tri.a.p[0] + 0.45 * tri.b.p[0] + 0.4 * tri.c.p[0],
        0.15 * tri.a.p[1] + 0.45 * tri.b.p[1] + 0.4 * tri.c.p[1],
        0.15 * tri.a.p[2] + 0.45 * tri.b.p[2] + 0.4 * tri.c.p[2],
      ];
      // Ensure the probe is far from structural bones so analytic field governs cleanly
      const minStructDist = Math.min(...nonMembraneSources.map((s) => s.sdf.d(p[0], p[1], p[2])));
      if (minStructDist < 0.8 * a.s) continue;
      const sample = set.at(p[0], p[1], p[2]);
      if (sample.w.size >= 2) {
        const firstCornerBone = tri.a.w[0]![0];
        const firstCornerShare = sample.w.get(firstCornerBone) ?? 0;
        if (firstCornerShare < 0.35) {
          probe = p;
          analytic = sample.w;
          break;
        }
      }
    }

    expect(probe).not.toBeNull();
    expect(analytic).not.toBeNull();

    const skin = computeSkinWeights(new Float32Array(probe!), new Uint32Array(0), body, skel, {
      tau: SKIN_TAU * a.s,
      smooth: 0,
    });
    const nb = skel.count;
    for (const [bone, expectedW] of analytic!.entries()) {
      const actualW = skin.dense[skel.idx(bone)]!;
      // Quantized to 8-bit weights, analytic barycentric weights must match closely without whole-triangle zero-distance override
      expect(Math.abs(actualW - expectedW), `bone ${bone}: actual=${actualW} expected=${expectedW}`).toBeLessThan(0.05);
    }
  });
});

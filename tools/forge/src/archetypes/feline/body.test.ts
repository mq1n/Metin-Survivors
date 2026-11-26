import { describe, expect, test } from 'bun:test';
import { computeSkinWeights } from '../../core/skin/weights.ts';
import { blazeTiger } from '../../models/feline/blaze_tiger.ts';
import { snowLion } from '../../models/feline/snow_lion.ts';
import { tiger } from '../../models/feline/tiger.ts';
import { tigerGod } from '../../models/feline/tiger_god.ts';
import { computeAnatomy } from './anatomy.ts';
import { makeBody } from './body.ts';
import { makeSkeleton } from './skeleton.ts';

describe('TOOL-RENDER-06 feline mane bone skin influences', () => {
  test.each([
    { label: 'blaze_tiger', params: blazeTiger, expectedManeBones: ['mane_l', 'mane_r'] },
    { label: 'snow_lion', params: snowLion, expectedManeBones: ['mane_l', 'mane_r'] },
    { label: 'tiger_god', params: tigerGod, expectedManeBones: ['mane_l', 'mane_r', 'mane_b'] },
  ])('$label assigns mane primitives and yields positive skin weights on every defined mane bone', ({ params, expectedManeBones }) => {
    const a = computeAnatomy(params);
    const skel = makeSkeleton(a);
    const body = makeBody(a);
    const sources = body.boneSources();

    // Every source bone must exist in the skeleton
    for (const boneName of sources.keys()) {
      expect(() => skel.idx(boneName)).not.toThrow();
    }

    // Collect probe centers from all mane parts
    const maneParts = body.partsByName('mane_');
    expect(maneParts.length).toBeGreaterThan(0);

    const probes: number[] = [];
    for (const part of maneParts) {
      const b = part.sdf.bounds();
      probes.push(
        (b.min[0] + b.max[0]) / 2,
        (b.min[1] + b.max[1]) / 2,
        (b.min[2] + b.max[2]) / 2,
      );
    }
    const positions = new Float32Array(probes);
    const skin = computeSkinWeights(positions, new Uint32Array(0), body, skel, { tau: 0.02 * a.s, smooth: 0 });
    const nv = positions.length / 3;
    const nb = skel.count;

    for (const maneBone of expectedManeBones) {
      expect(sources.get(maneBone)?.length ?? 0).toBeGreaterThan(0);
      const bi = skel.idx(maneBone);
      let maxW = 0;
      let influenced = 0;
      for (let v = 0; v < nv; v++) {
        const w = skin.dense[v * nb + bi]!;
        if (w > 0) influenced++;
        if (w > maxW) maxW = w;
      }
      expect(influenced, `${params.id} ${maneBone} influenced probes`).toBeGreaterThan(0);
      expect(maxW, `${params.id} ${maneBone} max weight`).toBeGreaterThan(0.3);
    }

    // Unrelated body geometry (e.g. front paw) must receive zero weight from mane bones
    const pawPart = body.partsByName('paw_l')[0]!;
    const pb = pawPart.sdf.bounds();
    const pawPos = new Float32Array([(pb.min[0] + pb.max[0]) / 2, (pb.min[1] + pb.max[1]) / 2, (pb.min[2] + pb.max[2]) / 2]);
    const pawSkin = computeSkinWeights(pawPos, new Uint32Array(0), body, skel, { tau: 0.02 * a.s, smooth: 0 });
    for (const maneBone of expectedManeBones) {
      expect(pawSkin.dense[skel.idx(maneBone)]).toBe(0);
    }
  });

  test('non-maned tiger builds cleanly without mane bones', () => {
    const a = computeAnatomy(tiger);
    const skel = makeSkeleton(a);
    const body = makeBody(a);
    for (const boneName of body.boneSources().keys()) {
      expect(() => skel.idx(boneName)).not.toThrow();
    }
  });
});

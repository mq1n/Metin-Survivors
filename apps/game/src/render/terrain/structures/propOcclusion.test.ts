// r9 Z9 (r8 judge MF1 / MF2): the per-placement occlusion of the structure GLBs. The camera is the gameplay rig (render/camera.ts: pitch
// 55 degrees, 16-30 m from the focus, fixed yaw, on the +Z side), the props are boxes with the size of the live models.
import { Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA_PITCH } from '../../camera';
import { applyObjectOcclusion, applyObjectOcclusionDepth } from '../occlusion';
import {
  CAP_MIN,
  INSIDE_HYSTERESIS,
  WHOLE_GHOST,
  buildOccGrid,
  occOverhangLow,
  occModeOf,
  occTargetFor,
  stepFade,
  type OccGrid,
  type OccMode,
  type OccTarget,
  type OccView,
} from './propOcclusion';

/** a closed box (12 triangles) from (x0, y0, z0) to (x1, y1, z1), prop space */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): { position: number[]; index: number[] } {
  const v = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const f = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1],
    [3, 2, 6], [3, 6, 7], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2],
  ];
  return { position: v.flat(), index: f.flat() };
}

function grid(...parts: Array<{ position: number[]; index: number[] }>): OccGrid {
  const g = buildOccGrid(parts);
  if (!g) throw new Error('empty grid');
  return g;
}

/** the rig camera for a hero at (x, y, z) and zoom distance d */
function view(x: number, z: number, d: number, y = 0): OccView {
  return {
    camX: x,
    camY: y + d * Math.sin(CAMERA_PITCH),
    camZ: z + d * Math.cos(CAMERA_PITCH),
    heroes: [{ x, y, z }],
  };
}

const out = (): OccTarget => ({ whole: 0, cap: 0, capY: 0, inside: false });
const at = (x: number, z: number, yaw = 0, scale = 1, y = 0) => ({ x, y, z, yaw, scale });
const target = (g: OccGrid, mode: OccMode, p: ReturnType<typeof at>, v: OccView): OccTarget => occTargetFor(g, mode, p, v, out());

describe('structure occlusion: modes', () => {
  it('buildings and gates take the capped cut, the pagoda the landmark rule, everything else ghosts whole (banners too: no cut)', () => {
    for (const id of ['hall_tiled', 'house_small', 'pagoda_gate', 'stone_gate', 'broken_gate', 'yurt', 'orc_tent', 'ruined_shrine']) expect(occModeOf(id)).toBe('cap');
    expect(occModeOf('giant_pagoda')).toBe('landmark');
    for (const id of ['stone_lantern', 'lamp_post', 'well', 'urn', 'banner_pole', 'war_banner', 'stele', 'obelisk', 'lava_pillar', 'frozen_tree']) expect(occModeOf(id)).toBe('whole');
  });

  it('the height grid keeps the top and the bottom of every cell (a roof face fills every cell under it)', () => {
    const g = grid(box(-7, 0, -5, 7, 10, 5));
    expect(g.maxY).toBeCloseTo(10);
    const mid = Math.floor(g.nx / 2) + Math.floor(g.nz / 2) * g.nx;
    expect(g.top[mid]).toBeCloseTo(10);
    expect(g.bottom[mid]).toBeCloseTo(0);
    expect(g.nx).toBeLessThanOrEqual(48);
  });
});

describe('structure occlusion: the suryeon giant pagoda (r8 judge GO blocker 3)', () => {
  // prop_giant_pagoda.2b420b3f: 30.7 x 32.2 m footprint, 55 m tall, placed at (0, -125)
  const g = grid(box(-15.33, 0, -16.11, 15.33, 54.95, 16.11));
  const pg = at(0, -125);

  it('fades out whole while the camera stands inside it: the judge spots at zoom 16, 22 and 30', () => {
    for (const [x, z] of [
      [0, -140],
      [0, -146],
      [9, -141],
      [-9, -141],
    ] as const) {
      for (const d of [16, 22, 30]) {
        const t = target(g, 'landmark', pg, view(x, z, d));
        expect(t.inside, `hero (${x}, ${z}) zoom ${d}`).toBe(true);
        expect(t.whole).toBe(1);
        expect(t.cap).toBe(0);
      }
    }
  });

  it('stays whole from the south, the east and the west and once the camera is out of its footprint (no cap: it never loses its top)', () => {
    for (const [x, z] of [
      [0, -100],
      [22, -125],
      [-22, -125],
      [0, -175],
    ] as const) {
      for (const d of [16, 22, 30]) {
        const t = target(g, 'landmark', pg, view(x, z, d));
        expect(t.whole, `hero (${x}, ${z}) zoom ${d}`).toBe(0);
        expect(t.cap).toBe(0);
      }
    }
  });
});

describe('structure occlusion: small props ghost whole (r8 judge MF2 b)', () => {
  // prop_stone_lantern.9339d089: 1.8 x 1.8 x 4.8 m
  const lantern = grid(box(-0.9, 0, -0.9, 0.9, 4.8, 0.9));

  it('a stone lantern just south of the hero (between it and the camera) ghosts whole, never a stub', () => {
    for (const d of [16, 22, 30]) {
      for (const dz of [1.2, 2.0]) {
        const t = target(lantern, 'whole', at(0, dz), view(0, 0, d));
        expect(t.whole, `zoom ${d}, ${dz} m south`).toBe(WHOLE_GHOST);
        expect(t.cap).toBe(0);
      }
    }
  });

  it('a lantern north of the hero, beside it or far south of it, and a barrel at its feet, stay drawn', () => {
    expect(target(lantern, 'whole', at(0, -2), view(0, 0, 22)).whole).toBe(0);
    expect(target(lantern, 'whole', at(3, 0.5), view(0, 0, 22)).whole).toBe(0);
    expect(target(lantern, 'whole', at(0, 7), view(0, 0, 22)).whole).toBe(0);
    const barrel = grid(box(-0.38, 0, -0.38, 0.38, 1, 0.38));
    expect(target(barrel, 'whole', at(0, 1.2), view(0, 0, 22)).whole).toBe(0);
  });

  it('honours the placement yaw and scale', () => {
    // a 4 m long fence-like slab, rotated 90 degrees: it runs along z, so it no longer crosses the view south of the hero at x = 1.5
    const slab = grid(box(-2, 0, -0.2, 2, 3.5, 0.2));
    expect(target(slab, 'whole', at(1.5, 1.4), view(0, 0, 22)).whole).toBe(WHOLE_GHOST);
    expect(target(slab, 'whole', at(2.6, 1.4, Math.PI / 2), view(0, 0, 22)).whole).toBe(0);
    // half size: 1.75 m tall, 1.4 m south: the view ray from the chest is over it
    expect(target(slab, 'whole', at(0, 1.4, 0, 0.5), view(0, 0, 22)).whole).toBe(0);
  });
});

describe('structure occlusion: buildings and gates lose everything above the cap (r8 judge MF2 a / c)', () => {
  // prop_hall_tiled.dbff1ae8: 14.2 x 10.6 m, 9.9 m tall
  const hall = grid(box(-7.1, 0, -5.3, 7.1, 9.9, 5.3));

  it('the hero just north of a hall: the cap is a horizontal plane under the lowest hit, over the hero head', () => {
    for (const d of [16, 22, 30]) {
      // the hall's north wall 1.5 m south of the hero
      const t = target(hall, 'cap', at(0, 6.8), view(0, 0, d));
      expect(t.cap, `zoom ${d}`).toBe(1);
      expect(t.whole).toBe(0);
      expect(t.capY).toBeGreaterThanOrEqual(CAP_MIN - 1e-6);
      // the ray from the chest meets the wall at 1.15 + 1.5 x tan(view) (about 3.2-3.3 m): the cap sits under it
      expect(t.capY).toBeLessThan(3.4);
    }
  });

  it('the cap follows the ground the hero stands on', () => {
    const t = target(hall, 'cap', at(0, 6.8, 0, 1, 2), view(0, 0, 22, 2));
    expect(t.capY).toBeGreaterThanOrEqual(2 + CAP_MIN - 1e-6);
  });

  it('a hall the hero stands in front of (south) or far behind is not cut', () => {
    expect(target(hall, 'cap', at(0, -8), view(0, 0, 22)).cap).toBe(0);
    expect(target(hall, 'cap', at(0, 20), view(0, 0, 22)).cap).toBe(0);
  });

  it('under a stone gate the whole roof goes (cap under the roof soffit, or lower where the near post blocks the view), the posts stay', () => {
    // prop_stone_gate.21e20661 turned to span north-south over the hero: posts at z +-4, a roof slab 6-7.4 m up
    const gate = grid(box(-1, 0, -4.6, 1, 6.2, -3.4), box(-1, 0, 3.4, 1, 6.2, 4.6), box(-2.3, 6.0, -5, 2.3, 7.4, 5));
    for (const d of [16, 22, 30]) {
      const t = target(gate, 'cap', at(0, 0), view(0, 0, d));
      expect(t.cap, `zoom ${d}`).toBe(1);
      expect(t.capY).toBeGreaterThan(4.8);
      expect(t.capY).toBeLessThan(6.0);
    }
  });
});

describe('structure occlusion: fades and the shader patch', () => {
  it('fades in over ~0.14 s and out over ~0.24 s, monotonically', () => {
    let v = 0;
    const seen: number[] = [];
    for (let i = 0; i < 20; i++) seen.push((v = stepFade(v, 1, 1 / 60)));
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.findIndex((x) => x >= 1)).toBeLessThanOrEqual(9);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    for (let i = 0; i < 16; i++) v = stepFade(v, 0, 1 / 60);
    expect(v).toBe(0);
    expect(stepFade(0.7, 0.7, 1)).toBe(0.7);
  });

  it('patches the instance attribute (InstancedMesh) or the entry uniform (Mesh), a dither discard, the cap plane in world y', () => {
    const state = { value: new Vector4(1, 0, 0, 0) };
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main() {\n#include <clipping_planes_fragment>\n}',
    };
    applyObjectOcclusion(shader as never, state);
    expect(shader.uniforms.uOccState).toBe(state);
    expect(shader.vertexShader).toContain('attribute vec4 aOccState;');
    expect(shader.vertexShader).toContain('vOccState = uOccState;');
    expect(shader.fragmentShader).toMatch(/occDz < vOccState\.x\) discard/);
    expect(shader.fragmentShader).toContain('cameraPosition.y + dot(viewMatrix[1].xyz, -vViewPosition)');
    expect(shader.fragmentShader.indexOf('vOccState.x')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <clipping_planes_fragment>'));
  });
});

describe('structure occlusion: the run-start fly-in', () => {
  it('a low establishing camera (rays off) caps and ghosts nothing, but still hides a landmark it stands inside', () => {
    const hall = grid(box(-7.1, 0, -5.3, 7.1, 9.9, 5.3));
    const v = { ...view(0, 0, 22), rays: false };
    expect(target(hall, 'cap', at(0, 6.8), v).cap).toBe(0);
    const pagoda = grid(box(-15.33, 0, -16.11, 15.33, 54.95, 16.11));
    const inside = { ...view(0, -140, 22), rays: false };
    expect(target(pagoda, 'landmark', at(0, -125), inside).whole).toBe(1);
  });
});

describe('structure occlusion: r9 ship fixes (Z9 critic)', () => {
  it('MF2b: a ghosted prop is fully gone (no 20 % screen door over the hero, no lattice)', () => {
    expect(WHOLE_GHOST).toBe(1);
  });

  it('MF2b: a 1.5 m ruin block just south of the hero hides only his legs and stays drawn; a 3 m one hiding his chest goes', () => {
    const block = grid(box(-0.9, 0, -0.6, 0.9, 1.5, 0.6));
    for (const d of [16, 22, 30]) expect(target(block, 'whole', at(0, 1.2), view(0, 0, d)).whole, `zoom ${d}`).toBe(0);
    const tall = grid(box(-0.9, 0, -0.6, 0.9, 3.2, 0.6));
    expect(target(tall, 'whole', at(0, 1.2), view(0, 0, 22)).whole).toBe(WHOLE_GHOST);
  });

  it('MF2c: a gate caps under its lowest roof underside, so a drooping eave corner never stays as a shard', () => {
    // two posts, a lintel at 3.6-4.0 m, a roof slab 4.0-4.6 m whose eave corner droops to 3.5 m
    const gate = grid(box(-2.6, 0, -0.3, -2.0, 4.0, 0.3), box(2.0, 0, -0.3, 2.6, 4.0, 0.3), box(-2.8, 3.6, -0.4, 2.8, 4.0, 0.4), box(-3.4, 4.0, -1.2, 3.4, 4.6, 1.2), box(3.0, 3.5, 0.8, 3.4, 4.0, 1.2));
    expect(occOverhangLow(gate)).toBeCloseTo(3.5, 1);
    const free = target(gate, 'cap', at(0, 1.5), view(0, 0, 22));
    expect(free.cap).toBe(1);
    gate.capCeil = occOverhangLow(gate) - 0.08;
    const capped = target(gate, 'cap', at(0, 1.5), view(0, 0, 22));
    expect(capped.cap).toBe(1);
    expect(capped.capY).toBeLessThanOrEqual(3.5 - 0.08 + 1e-6);
    expect(capped.capY).toBeGreaterThanOrEqual(CAP_MIN - 1e-6);
  });

  it('MF1: the camera-inside test holds INSIDE_HYSTERESIS longer once inside (no flicker on the footprint rim)', () => {
    const pagoda = grid(box(-13.5, 0, -13.5, 13.5, 54.95, 13.5));
    // a camera ~0.6 m outside the rim (beyond the one-cell slack), standing still while the hero strafes
    const v: OccView = { camX: 0, camY: 18, camZ: -125 - 13.5 - 1.3, heroes: [{ x: 0, y: 0, z: -160 }] };
    const fresh = occTargetFor(pagoda, 'landmark', at(0, -125), v, out(), false);
    const held = occTargetFor(pagoda, 'landmark', at(0, -125), v, out(), true);
    expect(fresh.inside).toBe(false);
    expect(held.inside).toBe(true);
    expect(INSIDE_HYSTERESIS).toBeGreaterThanOrEqual(1);
  });

  it('the shadow pass reads the whole fade only (no cap: a cut roof still shades its floor)', () => {
    const state = { value: new Vector4(1, 0, 0, 0) };
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main() {\n#include <clipping_planes_fragment>\n}',
    };
    applyObjectOcclusionDepth(shader as never, state);
    expect(shader.uniforms.uOccState).toBe(state);
    expect(shader.vertexShader).toContain('attribute vec4 aOccState;');
    expect(shader.fragmentShader).toMatch(/occObjDither\(\) < vOccState\.x\) discard/);
    expect(shader.fragmentShader).not.toContain('vViewPosition');
  });
});

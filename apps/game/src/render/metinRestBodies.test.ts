// r8 M8a (r7 judge MF5): a metin break piece meets the zone's static BODIES. Before r8 the rest test asked only whether the piece's centre lay inside a
// collision circle (rocks shrunk to 0.82 of their drawn size), so a heap rested inside a snow boulder and an in-flight burst went through a stone lantern;
// a piece that sank into lava or deep water slid under without a cue. Covered here: the footprint test against the real circles, the push out of a body
// below its top (in flight and at rest), the offset bookkeeping against the mixer, the bodies of a layout, the liquid lookup, the sink cue (once per piece,
// pooled, tier-sized, never darkening) and the r8 type-colour helpers (neutral-type detail, zone-light white balance).
import { describe, expect, it } from 'vitest';
import { AdditiveBlending, AnimationClip, AnimationMixer, Bone, Group, NormalBlending, Scene, VectorKeyframeTrack, type AnimationAction, type ShaderMaterial, type WebGLRenderer } from 'three';
import { SURFACE, type ZoneLayout } from '../world/layoutTypes';
import { PROP_DEFS } from '../world/props';
import {
  METIN_ROCK_BLOCK_SHRINK, METIN_TYPE_BODY, METIN_WB_MAX_HUE, REST_BLOCKED, REST_GROUND, REST_SINK, SINK_CUE_AT, applyPieceRest, clearPieceRest, metinBodyIndex, metinBodyR,
  metinPushOut, metinRestKind, metinTypeDetail, metinWhiteBalance, type MetinBody, type MetinRestField, type PieceRestExt,
} from './metin';
import { metinBodies, metinRestWorld } from './metinBodies';
import { MetinSinkCue, SINK_LAVA, SINK_POOL, SINK_WATER } from './metinSinkCue';

// one rock collision circle (registered at 0.82 x its 2 m half side) at (10, 0), one prop circle r 0.5 at (0, 10), lava for x < -20
const rockR = 2;
const field: MetinRestField = {
  surfaceAt: (x) => (x < -20 ? SURFACE.LAVA : SURFACE.GROUND),
  blockersNear: (x, z, r, cb) => {
    if (Math.hypot(x - 10, z) < rockR * METIN_ROCK_BLOCK_SHRINK + r + 0.01) cb({ x: 10, z: 0, r: rockR * METIN_ROCK_BLOCK_SHRINK, kind: 'rock' });
    if (Math.hypot(x, z - 10) < 0.5 + r + 0.01) cb({ x: 0, z: 10, r: 0.5, kind: 'prop' });
  },
};

describe('r8 M8a: the rest test uses the piece footprint against the real body circles', () => {
  it('a rock blocker is met at its real half side, a prop at its footprint circle', () => {
    expect(metinBodyR({ r: rockR * METIN_ROCK_BLOCK_SHRINK, kind: 'rock' })).toBeCloseTo(rockR, 9);
    expect(metinBodyR({ r: 0.5, kind: 'prop' })).toBe(0.5);
    expect(metinBodyR({ r: 0.7 })).toBe(0.7);
  });
  it('a piece centre between the 0.82 circle and the real rock is inside (the r7 centre test let it rest in the boulder)', () => {
    const x = 10 - 1.8; // 1.8 m from the rock centre: outside 0.82 x 2 = 1.64, inside the real 2 m body
    expect(metinRestKind(field, x, 0)).toBe(REST_BLOCKED);
  });
  it('a piece whose FOOTPRINT reaches half its radius into the body is inside; one touching the rim is not', () => {
    const r = 0.6;
    expect(metinRestKind(field, 10 - (rockR + 0.25), 0, r)).toBe(REST_BLOCKED); // 0.35 m of the 0.6 m piece inside the rock
    expect(metinRestKind(field, 10 - (rockR + r), 0, r)).toBe(REST_GROUND); // resting against the rock
    expect(metinRestKind(field, -25, 0, r)).toBe(REST_SINK);
    expect(metinRestKind(field, 0, 10 - 0.5 - 0.2, r)).toBe(REST_BLOCKED);
  });
});

describe('r8 M8a: the push out of static bodies (in flight and at rest)', () => {
  const bodies: MetinBody[] = [{ x: 0, z: 0, r: 0.8, top: 2.2 }, { x: 30, z: 0, r: 1, top: 1 }];
  const near = metinBodyIndex(bodies, 4);
  it('the body index finds a body from every cell its disc touches, once', () => {
    const seen: MetinBody[] = [];
    near(0.5, 0.5, 0.3, (b) => seen.push(b));
    expect(seen).toEqual([bodies[0]]);
    const none: MetinBody[] = [];
    near(15, 0, 0.3, (b) => none.push(b));
    expect(none).toEqual([]);
  });
  it('a piece inside a body below its top is moved onto the rim, along its own direction', () => {
    const out = { x: 0, z: 0 };
    expect(metinPushOut(near, 0.5, 0, 1.0, 0.3, -5, 0, out)).toBe(true);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(0.8 + 0.3, 6);
    expect(out.z).toBeCloseTo(0, 6);
    expect(out.x).toBeGreaterThan(0);
  });
  it('a piece flying above the body top passes over it; one clear of the body is not moved', () => {
    const out = { x: 0, z: 0 };
    expect(metinPushOut(near, 0.5, 0, 2.3, 0.3, -5, 0, out)).toBe(false);
    expect(out).toEqual({ x: 0.5, z: 0 });
    expect(metinPushOut(near, 3, 3, 0, 0.3, -5, 0, out)).toBe(false);
  });
  it('a piece dead on a body centre leaves away from the stone', () => {
    const out = { x: 0, z: 0 };
    metinPushOut(near, 0, 0, 0, 0.3, -5, 0, out);
    expect(out.x).toBeCloseTo(1.1, 6);
    expect(out.z).toBeCloseTo(0, 6);
  });
});

describe('r8 M8a: applyPieceRest with the push, against the animation mixer', () => {
  // a stone at (-2, 0) whose shatter lands its 3 pieces at local x 1.6, 2.0, 4.0 (world -0.4, 0, 2): the first two inside a lantern body (r 0.8 at the origin)
  const make = (): { bones: Bone[]; mixer: AnimationMixer; action: AnimationAction } => {
    const root = new Group();
    const xs = [1.6, 2.0, 4.0];
    const bones = xs.map((x, i) => { const b = new Bone(); b.name = `chunk_${i}`; b.position.set(x, 0.3, 0); root.add(b); return b; });
    const tracks = bones.map((b, i) => new VectorKeyframeTrack(`${b.name}.position`, [0, 1, 2.2], [0, 1.2, 0, xs[i]!, 0.3, 0, xs[i]!, 0.3, 0]));
    const mixer = new AnimationMixer(root);
    const action = mixer.clipAction(new AnimationClip('shatter', 2.2, tracks));
    action.play(); action.paused = true;
    return { bones, mixer, action };
  };
  const near = metinBodyIndex([{ x: 0, z: 0, r: 0.8, top: 2.2 }], 4);
  const ground = (): number => 0;
  const restAt = (): number => REST_GROUND;
  it('the pieces that would land inside the lantern rest on its rim, frame after frame, and clear restores the clip pose', () => {
    const k = make(), off = new Float32Array(3), offXZ = new Float32Array(6);
    const ext: PieceRestExt = { offXZ, bodiesNear: near, rootY: 0, pieceR: 0.3 };
    const world: number[][] = [];
    for (let f = 0; f < 20; f++) {
      clearPieceRest(k.bones, off, offXZ);
      k.action.time = 1.2 + f / 60; k.mixer.update(0);
      applyPieceRest(k.bones, off, -2, 0, 0, 1, 0, 1, 1, ground, restAt, undefined, Infinity, ext);
      world.push(k.bones.map((b) => b.position.x - 2));
    }
    for (const w of world) for (let i = 0; i < 3; i++) expect(w[i]).toBeCloseTo(world[0]![i]!, 6); // no accumulation while the clip value is unchanged
    expect(Math.abs(world[0]![0]!)).toBeCloseTo(0.8 + 0.3, 5); // on the rim (pushed back toward the stone side it came from)
    expect(world[0]![1]!).toBeCloseTo(0.8 + 0.3, 5);
    expect(world[0]![2]!).toBeCloseTo(2, 6); // clear of the lantern: untouched
    clearPieceRest(k.bones, off, offXZ);
    expect(k.bones.map((b) => b.position.x)).toEqual([1.6, 2.0, 4.0].map((x) => expect.closeTo(x, 6)));
    expect([...offXZ]).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it('in flight a piece above the lantern top is not pushed (it flies over); below the top it slides round the body', () => {
    const k = make(), off = new Float32Array(3), offXZ = new Float32Array(6);
    const ext: PieceRestExt = { offXZ, bodiesNear: near, rootY: 0, pieceR: 0.3 };
    k.bones[0]!.position.set(2.0, 3.0, 0.1); // 3 m up: over the 2.2 m lantern
    applyPieceRest([k.bones[0]!], off, -2, 0, 0, 1, 0, 0, 0, ground, restAt, undefined, Infinity, ext);
    expect(offXZ[0]).toBe(0);
    clearPieceRest([k.bones[0]!], off, offXZ);
    k.bones[0]!.position.set(2.0, 1.0, 0.1);
    applyPieceRest([k.bones[0]!], off, -2, 0, 0, 1, 0, 0, 0, ground, restAt, undefined, Infinity, ext);
    expect(Math.hypot(k.bones[0]!.position.x - 2, k.bones[0]!.position.z)).toBeCloseTo(1.1, 5);
  });
  it('a rotated, scaled stone pushes in world space (the root-space offset is un-rotated and / scale)', () => {
    const b = new Bone(); b.position.set(0, 0.3, 1); // yaw 90 deg: local +z -> world +x
    const off = new Float32Array(1), offXZ = new Float32Array(2);
    const yaw = Math.PI / 2, scale = 2;
    applyPieceRest([b], off, -2, 0, yaw, scale, 0, 0, 0, ground, restAt, undefined, Infinity, { offXZ, bodiesNear: near, rootY: 0, pieceR: 0.3 });
    const lx = b.position.x * scale, lz = b.position.z * scale;
    const wx = -2 + lx * Math.cos(yaw) + lz * Math.sin(yaw), wz = 0 - lx * Math.sin(yaw) + lz * Math.cos(yaw);
    expect(Math.hypot(wx, wz)).toBeCloseTo(0.8 + 0.6, 5);
  });
});

describe('r8 M8a: the sink cue fires once per piece when it starts going under', () => {
  it('fires on the frame the sink weight passes SINK_CUE_AT, never again in that break', () => {
    const b = new Bone(); b.position.set(1, 0.3, 0);
    const off = new Float32Array(1), offXZ = new Float32Array(2), cued = new Uint8Array(1), sinkW = new Float32Array(1);
    const fired: number[][] = [];
    const ext: PieceRestExt = { offXZ, bodiesNear: () => {}, rootY: 0, pieceR: 0.3, cued, onSink: (i, x, z) => fired.push([i, x, z]) };
    const lava = (): number => REST_SINK;
    // sinkK 0 (before 0.45 s): no cue
    applyPieceRest([b], off, 0, 0, 0, 1, 0, 1, 0, () => 0, lava, sinkW, Infinity, ext);
    expect(fired).toEqual([]);
    clearPieceRest([b], off, offXZ);
    applyPieceRest([b], off, 0, 0, 0, 1, 0, 1, SINK_CUE_AT * 2, () => 0, lava, sinkW, Infinity, ext);
    expect(fired).toEqual([[0, 1, 0]]);
    for (let f = 0; f < 10; f++) { clearPieceRest([b], off, offXZ); applyPieceRest([b], off, 0, 0, 0, 1, 0, 1, 1, () => 0, lava, sinkW, Infinity, ext); }
    expect(fired.length).toBe(1);
    // a new break clears `cued`
    cued.fill(0);
    clearPieceRest([b], off, offXZ);
    applyPieceRest([b], off, 0, 0, 0, 1, 0, 1, 1, () => 0, lava, sinkW, Infinity, ext);
    expect(fired.length).toBe(2);
  });
  it('a piece resting on ground never fires', () => {
    const b = new Bone(); b.position.set(1, 0.3, 0);
    const fired: number[] = [];
    applyPieceRest([b], new Float32Array(1), 0, 0, 0, 1, 0, 1, 1, () => 0, () => REST_GROUND, new Float32Array(1), Infinity, { offXZ: new Float32Array(2), bodiesNear: () => {}, rootY: 0, pieceR: 0.3, cued: new Uint8Array(1), onSink: (i) => fired.push(i) });
    expect(fired).toEqual([]);
  });
});

describe('r8 M8a: the bodies and liquids of a zone layout', () => {
  const layout = {
    zone: 't', groundLayers: [], cliffLayer: 0, cover: [], rockMaterials: [], streams: [], bridges: [], landmarks: [],
    liquid: { kind: 'lava', level: -1 },
    trees: [{ species: 'pine', x: 20, z: 0, y: 0, scale: 1, yaw: 0, seed: 1 }],
    rocks: [
      { kind: 'boulder', x: 0, z: 20, y: 0, sx: 2, sy: 1.5, sz: 3, yaw: 0, seed: 1, mat: 0, sink: 0.2 },
      { kind: 'pebbles', x: 5, z: 20, y: 0, sx: 2, sy: 0.3, sz: 2, yaw: 0, seed: 1, mat: 0 },
    ],
    props: [{ id: 'stone_lantern', x: -10, z: 0, y: 0.5, yaw: 0, scale: 1, seed: 1 }],
    walls: [{ kind: 'stone', x0: 0, z0: -10, x1: 1.8, z1: -10, height: 2, seed: 1 }],
  } as unknown as ZoneLayout;
  it('props stand up to their PROP_DEFS height, blocking rocks to their top at the real half side, trunks, wall discs; pebbles never block', () => {
    const bs = metinBodies(layout, () => 0.25);
    const lantern = bs.filter((b) => Math.hypot(b.x + 10, b.z) < 2);
    expect(lantern.length).toBeGreaterThan(0);
    for (const b of lantern) expect(b.top).toBeCloseTo(0.5 + PROP_DEFS.stone_lantern!.height, 6);
    const rock = bs.find((b) => b.x === 0 && b.z === 20)!;
    expect(rock.r).toBeCloseTo(1.5, 6);
    expect(rock.top).toBeCloseTo(1.3, 6);
    expect(bs.some((b) => b.x === 5 && b.z === 20)).toBe(false);
    expect(bs.some((b) => b.x === 20 && b.z === 0 && b.top > 5)).toBe(true);
    expect(bs.filter((b) => b.z === -10).every((b) => b.top === 2.25 && b.r === 0.55)).toBe(true);
  });
  it('the liquid under a point and its surface: the layout level over a trench, the ground elsewhere', () => {
    const rw = metinRestWorld({ layout, heightAt: (x) => (x < 0 ? -3 : 0), surfaceAt: (x) => (x < -50 ? SURFACE.LAVA : x > 50 ? SURFACE.DEEP : SURFACE.GROUND) });
    expect(rw.liquidAt(-60, 0)).toBe(SINK_LAVA);
    expect(rw.liquidAt(60, 0)).toBe(SINK_WATER);
    expect(rw.liquidAt(0, 0)).toBe(0);
    expect(rw.liquidY(-60, 0)).toBe(-1);
    expect(rw.liquidY(60, 0)).toBe(0);
  });
});

describe('r8 M8a: the pooled sink cue', () => {
  const renderer = { getDrawingBufferSize: (v: { x: number; y: number; set: (a: number, b: number) => unknown }) => { v.set(1920, 1080); return v; } } as unknown as WebGLRenderer;
  it('sizes its two pools by the quality tier and resizes on a tier change', () => {
    const scene = new Scene();
    const cue = new MetinSinkCue(scene, 'medium');
    const pts = scene.children.filter((c) => c.name.startsWith('metinSinkCue'));
    expect(pts.length).toBe(2);
    cue.setTier('low');
    expect(scene.children.filter((c) => c.name.startsWith('metinSinkCue')).length).toBe(2);
    for (let i = 0; i < 40; i++) cue.emit(SINK_LAVA, 0, 0, 0, 1);
    expect(cue.alive).toBeLessThanOrEqual(2 * SINK_POOL.low);
    cue.dispose();
    expect(scene.children.length).toBe(0);
  });
  it('lava and water cues live about a second and are gone after their life (pool slots come back)', () => {
    const cue = new MetinSinkCue(new Scene(), 'high');
    cue.emit(SINK_LAVA, 0, 0, 0, 0.6);
    cue.emit(SINK_WATER, 5, 0, 0, 0.6);
    cue.update(1 / 60, renderer);
    expect(cue.alive).toBeGreaterThan(10);
    for (let f = 0; f < 120; f++) cue.update(1 / 60, renderer);
    expect(cue.alive).toBe(0);
  });
  it('never darkens: the light pool is additive, the wisp pool only pale colours', () => {
    const scene = new Scene();
    const cue = new MetinSinkCue(scene, 'ultra');
    cue.emit(SINK_LAVA, 0, 0, 0, 1);
    cue.emit(SINK_WATER, 0, 0, 0, 1);
    cue.update(1 / 60, renderer);
    const [add, alpha] = scene.children as unknown as { material: ShaderMaterial; geometry: { getAttribute(n: string): { array: Float32Array } } }[];
    expect(add!.material.blending).toBe(AdditiveBlending);
    expect(alpha!.material.blending).toBe(NormalBlending);
    const col = alpha!.geometry.getAttribute('aColor').array;
    for (let i = 0; i < col.length; i += 4) if (col[i + 3]! > 0) expect(Math.min(col[i]!, col[i + 1]!, col[i + 2]!)).toBeGreaterThanOrEqual(0.7);
  });
});

describe('r8 M8a: the type colour helpers', () => {
  it('only the neutral types (toughness, death, shadow) get extra body detail', () => {
    const neutral = ['#8aa07a', '#b8f0c8', '#8a8ab0'];
    for (const rune of Object.keys(METIN_TYPE_BODY)) {
      const d = metinTypeDetail(rune, 0.35);
      if (neutral.includes(rune)) expect(d).toBeGreaterThan(1.1);
      else expect(d).toBeCloseTo(1, 1);
    }
    expect(metinTypeDetail('#8aa07a', 0)).toBe(1);
    expect(metinTypeDetail('#123456', 0.35)).toBe(1);
  });
  it('white balance: identity under a white light or k 0, warmer under a cold light, always unit luminance', () => {
    const amber: [number, number, number] = [1.6, 0.9, 0.35];
    const lum = (c: number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const n = lum(amber);
    const unit = amber.map((v) => v / n) as [number, number, number];
    const w = metinWhiteBalance(unit, [2, 2, 2], 0.7);
    for (let i = 0; i < 3; i++) expect(w[i]).toBeCloseTo(unit[i]!, 6);
    expect(metinWhiteBalance(unit, [0.8, 1, 1.4], 0)).toEqual(unit);
    const c = metinWhiteBalance(unit, [0.8, 1, 1.4], 0.7);
    expect(lum(c)).toBeCloseTo(1, 6);
    // r9 M9a: warmer = the hue moves toward red (green falls against red); the saturation is the authored one
    expect(c[1]! / c[0]!).toBeLessThan(unit[1]! / unit[0]!);
  });
  it('r9 M9a: the balance moves the authored hue by at most METIN_WB_MAX_HUE degrees and keeps its saturation', () => {
    const l2s = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
    const hs = (c: number[]): [number, number] => {
      const m = Math.max(...c), [r, g, b] = c.map((v) => l2s(v / m)) as [number, number, number], mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      const h = d < 1e-6 ? 0 : mx === r ? (60 * ((g - b) / d) + 360) % 360 : mx === g ? 60 * ((b - r) / d) + 120 : 60 * ((r - g) / d) + 240;
      return [h, d / mx];
    };
    const lum = (c: number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    // the devil body (#b052a8, linear) under a strong warm autumn light: the r8 balance turned it violet
    const devil = [0.4342, 0.0844, 0.3916];
    const unit = devil.map((v) => v / lum(devil)) as [number, number, number];
    const warm: [number, number, number] = [1.6, 1.0, 0.45];
    const out = metinWhiteBalance(unit, warm, 0.7);
    const [h0, s0] = hs(unit), [h1, s1] = hs(out);
    const dh = Math.abs(((h1 - h0 + 540) % 360) - 180);
    expect(dh).toBeLessThanOrEqual(METIN_WB_MAX_HUE + 1e-6);
    expect(dh).toBeGreaterThan(1);
    expect(s1).toBeCloseTo(s0, 4);
    expect(lum(out)).toBeCloseTo(1, 6);
    // a 0-degree cap leaves the hue where it was
    const [h2] = hs(metinWhiteBalance(unit, warm, 0.7, 0));
    expect(Math.abs(((h2 - h0 + 540) % 360) - 180)).toBeLessThan(1e-3);
  });
});

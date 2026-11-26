// r9 M9b (r8 judge MF5, r8 M8a critic): the rest9 break of a great metin. Covered: the per-piece radius from the skinned vertices, the stacked prop bodies
// (a piece meets the column at its own height, not an invisible full-height cylinder), ledges (low rocks / crates: a piece settles ON them), the eased push
// (no one-frame sideways jump), the rise limit (no piece rests on a bridge deck / the lava-stair parapet), the footprint liquid test (a bank-edge piece goes
// in), the offset bookkeeping against the animation mixer, the stone without extras.rest9 untouched, the readable sink cue (rings, never darkening) and
// the soft ground glow.
import { describe, expect, it } from 'vitest';
import { AdditiveBlending, Bone, BufferAttribute, BufferGeometry, Color, Matrix4, NormalBlending, Scene, Skeleton, Texture, type ShaderMaterial, type WebGLRenderer } from 'three';
import { REST_SINK_DEPTH, metinBodyIndex, type MetinBody } from './metin';
import { REST9_LOW_TOP, REST9_PUSH_SPEED, REST9_RISE_MAX, applyPieceRest9, metinLowTop, metinPieceRadii, metinPushOut9, type PieceRest9 } from './metinRest9';
import { metinBodies, metinBodies9, metinRestWorld } from './metinBodies';
import { METIN_PROP_BANDS } from './metinPropBands';
import { MetinSinkCue, SINK_LAVA, SINK_RINGS, SINK_WATER } from './metinSinkCue';
import { GROUND_GLOW_LIFT, MetinGroundGlow } from './metinGroundGlow';
import { PROP_DEFS } from '../world/props';
import type { ZoneLayout } from '../world/layoutTypes';

const flat = (): number => 0;
const dry = (): number => 0;
const ext9 = (bodies: MetinBody[], radii: number[], o: Partial<PieceRest9> = {}): PieceRest9 => ({
  offXZ: new Float32Array(radii.length * 2), pushCur: new Float32Array(radii.length * 2), radii: Float32Array.from(radii), bodiesNear: metinBodyIndex(bodies, 4), liquidAt: dry, rootY: 0, pushStep: Infinity, ...o,
});
const clear = (bones: Bone[], off: Float32Array, e: PieceRest9): void => {
  bones.forEach((b, i) => { b.position.y -= off[i]!; off[i] = 0; b.position.x -= e.offXZ[i * 2]!; b.position.z -= e.offXZ[i * 2 + 1]!; e.offXZ[i * 2] = e.offXZ[i * 2 + 1] = 0; });
};

describe('r9: each piece has its own radius (metinPieceRadii)', () => {
  it('the 80th percentile of the vertices skinned to a bone, from the bone, in bone space', () => {
    const g = new BufferGeometry();
    // bone 0 at the origin with vertices at radius 1, bone 1 at x 5 with vertices at radius 0.25 (bone inverse = translate(-5))
    const pos: number[] = [], si: number[] = [], sw: number[] = [];
    for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2; pos.push(Math.cos(a), 0, Math.sin(a)); si.push(0, 0, 0, 0); sw.push(1, 0, 0, 0); }
    for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2; pos.push(5 + 0.25 * Math.cos(a), 0, 0.25 * Math.sin(a)); si.push(1, 0, 0, 0); sw.push(1, 0, 0, 0); }
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(si), 4));
    g.setAttribute('skinWeight', new BufferAttribute(new Float32Array(sw), 4));
    const b0 = new Bone(), b1 = new Bone(); b1.position.set(5, 0, 0);
    const sk = new Skeleton([b0, b1], [new Matrix4(), new Matrix4().makeTranslation(-5, 0, 0)]);
    const r = metinPieceRadii(g, sk, new Matrix4());
    expect(r[0]).toBeCloseTo(1, 5);
    expect(r[1]).toBeCloseTo(0.25, 5);
  });
});

describe('r9: stacked prop bodies and ledges', () => {
  const lantern = PROP_DEFS.stone_lantern!;
  const layout = {
    zone: 't', groundLayers: [], cliffLayer: 0, cover: [], rockMaterials: [], streams: [], landmarks: [], trees: [], walls: [],
    bridges: [{ kind: 'stone', x0: 0, z0: 40, x1: 0, z1: 60, width: 4, yEnd: 0.5, yMid: 1.5 }],
    rocks: [
      { kind: 'boulder', x: 20, z: 0, y: 0, sx: 2, sy: 1.5, sz: 2, yaw: 0, seed: 1, mat: 0 },
      { kind: 'boulder', x: 30, z: 0, y: 0, sx: 1.6, sy: 0.6, sz: 1.6, yaw: 0, seed: 1, mat: 0 },
      { kind: 'pebbles', x: 34, z: 0, y: 0, sx: 2, sy: 0.25, sz: 2, yaw: 0, seed: 1, mat: 0 },
    ],
    props: [{ id: 'stone_lantern', x: 0, z: 0, y: 0, yaw: 0, scale: 1, seed: 1 }, { id: 'crate', x: 10, z: 0, y: 0, yaw: 0, scale: 1, seed: 1 }],
  } as unknown as ZoneLayout;
  const bodies = metinBodies9(layout, flat);
  it('a single-circle prop is a stack of discs at its measured bands (the lantern: plinth, slender column, roof)', () => {
    const lb = bodies.filter((b) => Math.hypot(b.x, b.z) < 0.01);
    const bands = METIN_PROP_BANDS.stone_lantern!;
    expect(lb.length).toBe(bands.length);
    const c = (lantern.footprint[0] as { circle: [number, number, number] }).circle[2];
    lb.forEach((b, i) => { expect(b.r).toBeCloseTo(c * bands[i]![2], 6); expect(b.top).toBeCloseTo(lantern.height * bands[i]![1], 6); });
    expect(lb[1]!.r).toBeLessThan(lb[0]!.r); // the column is slimmer than the plinth
    // the r8 list keeps the single full-height cylinder
    expect(metinBodies(layout, flat).filter((b) => Math.hypot(b.x, b.z) < 0.01).length).toBe(1);
  });
  it('a piece beside the column (outside it, inside the plinth radius) above the plinth is not pushed; at the plinth height it is', () => {
    const near = metinBodyIndex(bodies, 4), out = { x: 0, z: 0 };
    const c = (lantern.footprint[0] as { circle: [number, number, number] }).circle[2];
    const x = c * METIN_PROP_BANDS.stone_lantern![1]![2] + 0.3 + 0.05; // just clear of the column with a 0.3 m piece
    expect(metinPushOut9(near, x, 0, 1.5, 2.1, 0.3, -5, 0, out)).toBe(false);
    expect(metinPushOut9(near, x, 0, 0.0, 0.5, 0.3, -5, 0, out)).toBe(true);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(c + 0.3, 6);
  });
  it('low bodies: a crate, a 0.6 m rock and pebbles are ledges with their own top; a 1.5 m boulder stays a tall body; bridge rails stand on both sides', () => {
    const crate = bodies.filter((b) => Math.hypot(b.x - 10, b.z) < 0.01);
    expect(crate.every((b) => b.low)).toBe(PROP_DEFS.crate!.height <= REST9_LOW_TOP);
    expect(bodies.find((b) => b.x === 30)!.low).toBe(true);
    expect(bodies.find((b) => b.x === 34)!.low).toBe(true);
    expect(bodies.find((b) => b.x === 20)!.low).toBeFalsy();
    expect(metinLowTop(metinBodyIndex(bodies, 4), 30, 0)).toBeCloseTo(0.6, 6);
    const rails = bodies.filter((b) => b.z >= 40 && b.z <= 60);
    expect(rails.length).toBeGreaterThan(40);
    expect(new Set(rails.map((b) => Math.sign(b.x))).size).toBe(2);
    expect(rails.every((b) => Math.abs(Math.abs(b.x) - 2.25) < 1e-6 && b.top > 1.5)).toBe(true);
  });
  it('the run world builds the rest9 index next to the r8 one', () => {
    const rw = metinRestWorld({ layout, heightAt: flat, surfaceAt: () => 0 });
    const a: MetinBody[] = [], b: MetinBody[] = [];
    rw.bodiesNear(0, 0, 0.5, (x) => a.push(x));
    rw.bodiesNear9!(0, 0, 0.5, (x) => b.push(x));
    expect(a.length).toBe(1);
    expect(b.length).toBe(METIN_PROP_BANDS.stone_lantern!.length);
  });
});

describe('r9: applyPieceRest9', () => {
  it('a piece landing on a ledge rests on its top; one on bare ground beside it rests on the ground', () => {
    const bodies: MetinBody[] = [{ x: 2, z: 0, r: 0.8, top: 0.55, low: true }];
    const b0 = new Bone(), b1 = new Bone(); b0.position.set(2, 0.4, 0); b1.position.set(-2, 0.4, 0);
    const off = new Float32Array(2), e = ext9(bodies, [0.3, 0.3]);
    applyPieceRest9([b0, b1], off, 0, 0, 0, 1, 0, 1, 0, flat, new Float32Array(2), Infinity, e);
    expect(off[0]).toBeGreaterThan(0.4); // lifted onto the 0.55 m ledge (the slope fit takes 5 points of its footprint)
    expect(off[1]).toBeCloseTo(0, 6);
  });
  it('the push out of a tall body is eased: at most REST9_PUSH_SPEED x dt per frame, then it holds on the rim', () => {
    const bodies: MetinBody[] = [{ x: 0, z: 0, r: 1.5, top: 3 }];
    const b = new Bone(); b.position.set(5.5, 0.5, 0); // root at x -5: world x 0.5, inside the body
    const off = new Float32Array(1), dt = 1 / 60, e = ext9(bodies, [0.4], { pushStep: REST9_PUSH_SPEED * dt });
    const xs: number[] = [];
    for (let f = 0; f < 40; f++) {
      applyPieceRest9([b], off, -5, 0, 0, 1, 0, 1, 0, flat, new Float32Array(1), Infinity, e);
      xs.push(b.position.x - 5);
      clear([b], off, e);
    }
    for (let f = 1; f < xs.length; f++) expect(Math.abs(xs[f]! - xs[f - 1]!)).toBeLessThanOrEqual(REST9_PUSH_SPEED * dt + 1e-6);
    expect(xs[xs.length - 1]).toBeCloseTo(1.5 + 0.4, 5); // on the rim
    expect(b.position.x).toBeCloseTo(5.5, 6); // clear restores the clip pose
  });
  it('a piece never rests on ground that rises more than REST9_RISE_MAX over the stone base: it stops where the rise begins', () => {
    const deck = (x: number): number => (x > 3 ? 1.5 : 0); // a bridge deck 1.5 m up, 3 m east of the stone
    const b = new Bone(); b.position.set(4, 0.5, 0);
    const off = new Float32Array(1), e = ext9([], [0.3]);
    applyPieceRest9([b], off, 0, 0, 0, 1, 0, 1, 0, deck, new Float32Array(1), Infinity, e);
    expect(b.position.x).toBeLessThanOrEqual(3 + 1e-6);
    expect(off[0]).toBeLessThan(REST9_RISE_MAX);
  });
  it('a piece whose footprint hangs over lava goes in (2 of 5 points), with its cue once; a dry piece never fires', () => {
    const lava = (x: number): number => (x > 1.8 ? SINK_LAVA : 0);
    const b = new Bone(); b.position.set(1.9, 0.5, 0); // on the lava edge: the centre and three footprint points over the lava
    const off = new Float32Array(1), sinkW = new Float32Array(1), fired: number[] = [];
    const e = ext9([], [0.6], { liquidAt: lava, cued: new Uint8Array(1), onSink: (i) => fired.push(i) });
    for (let f = 0; f < 5; f++) { applyPieceRest9([b], off, 0, 0, 0, 1, 0, 1, 1, flat, sinkW, Infinity, e); clear([b], off, e); }
    expect(sinkW[0]).toBe(1);
    expect(fired).toEqual([0]);
    applyPieceRest9([b], off, 0, 0, 0, 1, 0, 1, 1, flat, sinkW, Infinity, e);
    expect(off[0]).toBeCloseTo(-REST_SINK_DEPTH, 6);
    const b2 = new Bone(); b2.position.set(-3, 0.5, 0);
    const s2 = new Float32Array(1), f2: number[] = [];
    applyPieceRest9([b2], new Float32Array(1), 0, 0, 0, 1, 0, 1, 1, flat, s2, Infinity, ext9([], [0.6], { liquidAt: lava, cued: new Uint8Array(1), onSink: (i) => f2.push(i) }));
    expect(s2[0]).toBe(0);
    expect(f2).toEqual([]);
  });
});

describe('r9: the readable sink cue and the ground glow', () => {
  const renderer = { getDrawingBufferSize: (v: { x: number; y: number; set: (a: number, b: number) => unknown }) => { v.set(1920, 1080); return v; } } as unknown as WebGLRenderer;
  it('a readable lava / water cue lays a ring on the liquid that grows and fades, more particles than the r8 cue, nothing darker than a pale wisp', () => {
    const scene = new Scene();
    const small = new MetinSinkCue(new Scene(), 'high'), big = new MetinSinkCue(scene, 'high');
    small.emit(SINK_LAVA, 0, 0, 0, 1); big.emit(SINK_LAVA, 0, 0, 0, 1, true); big.emit(SINK_WATER, 4, 0, 0, 1, true);
    small.update(1 / 60, renderer); big.update(1 / 60, renderer);
    expect(big.rings).toBe(2);
    expect(big.alive).toBeGreaterThan(small.alive * 2);
    const rings = scene.children.filter((c) => c.name.startsWith('metinSinkRing'));
    expect(rings.length).toBe(2);
    expect((rings[0] as unknown as { material: ShaderMaterial }).material.blending).toBe(AdditiveBlending);
    expect((rings[1] as unknown as { material: ShaderMaterial }).material.blending).toBe(NormalBlending);
    for (let f = 0; f < 90; f++) big.update(1 / 60, renderer);
    expect(big.rings).toBe(0);
    for (let i = 0; i < SINK_RINGS + 3; i++) big.emit(SINK_LAVA, 0, 0, 0, 1, true);
    big.update(1 / 60, renderer);
    expect(big.rings).toBeLessThanOrEqual(SINK_RINGS);
    big.dispose();
    expect(scene.children.length).toBe(0);
  });
  it('the ground glow follows the terrain a few cm up, hides at opacity 0, and uses additive light only', () => {
    const g = new MetinGroundGlow(new Texture());
    const hill = (x: number, z: number): number => 0.1 * x + 0.05 * z;
    g.set(3, 4, 2, hill, new Color(1, 0.4, 0.1), 0.6);
    const p = g.mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(hill(p.getX(i), p.getZ(i)) + GROUND_GLOW_LIFT, 5);
    expect(g.mesh.visible).toBe(true);
    expect((g.mesh.material as { blending: number }).blending).toBe(AdditiveBlending);
    g.set(3, 4, 2, hill, new Color(1, 0.4, 0.1), 0);
    expect(g.mesh.visible).toBe(false);
    g.dispose();
  });
});

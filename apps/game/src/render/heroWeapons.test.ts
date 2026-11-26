// HeroView weapon mounting: socket per weapon type, two instances for the dual types, the bow on the left, per-clip hold on both, disposal of both.

// in the right hand (shipped hand-fixed: yacha, shaman, wolfman, ninja; the warrior is still a forge-marked hero).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
  type AnimationAction,
  type Material,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets, LoadedModel, ModelExtras, ModelInstance } from '../engine/assets';
import type { RenderCore } from './core';
import type { PlayerFeed } from './feed';
import { HeroView, oneShotFades } from './hero';
import { SET_FLOATS, SOCKET_ID, SOCKET_STRIDE } from '../vfx/spec/sockets';

/** hero stand-in: hips + mirror-symmetric hand_r (hold scale `rs`) / hand_l (+ optional hand_r_b), one skinned body */
const FIXED_FRAME = 'anatomical equip joints (rig1to1): hand_r / hand_l / hand_r_b are rigid children of the hand joints';
const FORGE_FRAME = 'palm +X(r) / -X(l), fingers -Y, thumb +Z, grip axis Z';

function heroScene(rs = 1, withRb = false, withLeft = true, equip = true, rig1to1 = false): Group {
  const scene = new Group();
  scene.userData = { humanoid: { handFrame: equip ? FIXED_FRAME : FORGE_FRAME }, ...(rig1to1 ? { rig: 'rig1to1/2' } : {}) };
  const hips = new Bone();
  hips.name = 'hips';
  const bones: Bone[] = [hips];
  const add = (name: string, x: number, scale: number): void => {
    const b = new Bone();
    b.name = name;
    b.position.set(x, 0.3, 0);
    b.scale.setScalar(scale);
    hips.add(b);
    bones.push(b);
  };
  add('hand_r', -0.4, rs);
  if (withLeft) add('hand_l', 0.4, 1);
  if (withRb) add('hand_r_b', -0.4, 1);
  hips.position.set(0, 0.9, 0);
  const g = new BoxGeometry(0.4, 1.6, 0.3);
  const n = g.getAttribute('position').count;
  g.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: n }, () => [1, 0, 0, 0]).flat(), 4));
  const body = new SkinnedMesh(g, new MeshStandardMaterial());
  body.name = 'body';
  scene.add(hips, body);
  scene.updateMatrixWorld(true);
  body.bind(new Skeleton(bones));
  return scene;
}

/** weapon stand-in: grip at the origin, blade along +Z (0.9 m), cutting edge side -X; optionally skinned (to count skeleton disposals) */
function weaponScene(extras: ModelExtras, skinned = false): Group {
  const scene = new Group();
  scene.userData = extras;
  const g = new BoxGeometry(0.03, 0.04, 0.9).translate(-0.05, 0, 0.45);
  if (skinned) {
    const b = new Bone();
    const n = g.getAttribute('position').count;
    g.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: n }, () => [1, 0, 0, 0]).flat(), 4));
    const m = new SkinnedMesh(g, new MeshStandardMaterial());
    m.add(b);
    scene.add(m);
    m.bind(new Skeleton([b]));
  } else {
    scene.add(new Mesh(g, new MeshStandardMaterial()));
  }
  return scene;
}

function loaded(id: string, scene: Group, kind: 'hero' | 'weapon', sockets?: Record<string, string>): LoadedModel {
  const skinned: SkinnedMesh[] = [];
  const meshes: Mesh[] = [];
  scene.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh);
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  return {
    id,
    asset: { id, url: '', kind, height: 1.8, radius: 0.4, clips: {}, tris: 0, bones: 0, bytes: 0, ...(sockets ? { sockets } : {}) },
    scene,
    clips: [],
    clipMap: new Map(),
    skinned,
    meshes,
    extras: (scene.userData ?? {}) as ModelExtras,
    placeholder: false,
  };
}

function fakeCore(models: LoadedModel[]): RenderCore {
  const byId = new Map(models.map((m) => [m.id, m]));
  const assets = {
    loadBatch: async () => undefined,
    model: (id: string) => {
      const m = byId.get(id);
      if (!m) throw new Error(`no model ${id}`);
      return m;
    },
    instantiate: (id: string): ModelInstance => {
      const m = byId.get(id) as LoadedModel;
      const root = cloneSkinned(m.scene);
      const skinned: SkinnedMesh[] = [];
      const meshes: Mesh[] = [];
      const bones = new Map<string, Object3D>();
      root.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh);
        if ((o as Mesh).isMesh) meshes.push(o as Mesh);
        if ((o as Bone).isBone) bones.set(o.name, o);
      });
      return { root, skinned, meshes, clips: m.clips, bones };
    },
  } as unknown as Assets;
  return { scene: new Group(), assets, heightAt: () => 0 } as unknown as RenderCore;
}

const SOCK = { hand_r: 'hand_r', hand_l: 'hand_l' };
const feed: PlayerFeed = { x: 0, z: 0, px: 0, pz: 0, rot: 0, speed: 0, dead: false, flash: 0, corrupted: 0, clip: 'idle' };

async function hero(weaponExtras: ModelExtras, opts: { rs?: number; styleB?: boolean; withRb?: boolean; noLeft?: boolean; skinnedWeapon?: boolean; forge?: boolean; rig1to1?: boolean } = {}) {
  const sockets = opts.withRb ? { ...SOCK, hand_r_b: 'hand_r_b' } : SOCK;
  const core = fakeCore([
    loaded('hero', heroScene(opts.rs ?? 1, opts.withRb, !opts.noLeft, !opts.forge, opts.rig1to1), 'hero', sockets),
    loaded('wpn', weaponScene(weaponExtras, opts.skinnedWeapon), 'weapon'),
  ]);
  const hv = new HeroView(core);
  await hv.setModel('hero', 'wpn', opts.styleB ?? false);
  const priv = hv as unknown as { weapon: Object3D | null; offWeapon: Object3D | null; inst: ModelInstance; weaponMats: Material[]; weaponDepthMats: Material[]; overlays: Object3D[] };
  return { hv, priv, core };
}

const dagger: ModelExtras = { weapon: { type: 'dagger', hand: 'r', grip: 'dual' } };
const claw: ModelExtras = { weapon: { type: 'claw', hand: 'r', grip: 'claw' } };
const bow: ModelExtras = { weapon: { type: 'bow', hand: 'l', grip: 'bow' } };
const sword: ModelExtras = { weapon: { type: 'sword', hand: 'r', grip: 'one_hand' } };

const parentName = (o: Object3D | null): string | undefined => {
  let p = o?.parent ?? null;
  while (p && !(p as Bone).isBone) p = p.parent;
  return p?.name;
};

afterEach(() => vi.restoreAllMocks());

describe('HeroView weapon sockets (the weapon type decides the hands)', () => {
  it('a sword is one instance on hand_r', async () => {
    const { priv } = await hero(sword);
    expect(priv.weapon).not.toBeNull();
    expect(priv.offWeapon).toBeNull();
    expect(parentName(priv.weapon)).toBe('hand_r');
  });

  it('a dagger and a claw are two instances: the main on hand_r, the mirrored one on hand_l', async () => {
    for (const [extras, k] of [[dagger, 1.5], [claw, 1.7]] as const) {
      const { hv, priv } = await hero(extras, { rs: k });
      expect(parentName(priv.weapon)).toBe('hand_r');
      expect(parentName(priv.offWeapon)).toBe('hand_l');
      expect(priv.weapon).not.toBe(priv.offWeapon);
      // the left one is the right one reflected: x flipped, the same size in the world (hand_r's hold scale carried over to hand_l)
      hv.root.updateMatrixWorld(true);
      expect(priv.weapon!.matrixWorld.determinant()).toBeGreaterThan(0);
      expect(priv.offWeapon!.matrixWorld.determinant()).toBeLessThan(0);
      const tip = new Vector3(0, 0, 0.9);
      const a = tip.clone().applyMatrix4(priv.weapon!.matrixWorld);
      const b = tip.clone().applyMatrix4(priv.offWeapon!.matrixWorld);
      expect(b.x).toBeCloseTo(-a.x, 5);
      expect(b.y).toBeCloseTo(a.y, 5);
      expect(b.z).toBeCloseTo(a.z, 5);
      // the cutting edge (weapon -X) faces outward on both sides: the right one to -X of the hero, the left one to +X
      const edge = new Vector3(-0.05, 0, 0.45);
      const ea = edge.clone().applyMatrix4(priv.weapon!.matrixWorld);
      const eb = edge.clone().applyMatrix4(priv.offWeapon!.matrixWorld);
      const grip = new Vector3();
      expect(ea.x - grip.setFromMatrixPosition(priv.weapon!.matrixWorld).x).toBeLessThan(0);
      expect(eb.x - grip.setFromMatrixPosition(priv.offWeapon!.matrixWorld).x).toBeGreaterThan(0);
    }
  });

  it('the bow is one instance on hand_l (not mirrored), also under doctrine B; the right hand stays empty', async () => {
    for (const styleB of [false, true]) {
      const { hv, priv } = await hero(bow, { styleB, withRb: true });
      expect(parentName(priv.weapon)).toBe('hand_l');
      expect(priv.offWeapon).toBeNull();
      hv.root.updateMatrixWorld(true);
      expect(priv.weapon!.matrixWorld.determinant()).toBeGreaterThan(0);
      expect(priv.weapon!.scale.x).toBe(1);
    }
  });

  it('a hero without a hand_l joint holds a dagger (and the bow) in the right hand only', async () => {
    for (const extras of [dagger, bow]) {
      const { priv } = await hero(extras, { noLeft: true });
      expect(parentName(priv.weapon)).toBe('hand_r');
      expect(priv.offWeapon).toBeNull();
    }
  });

  it('doctrine B keeps hand_r_b for a right-hand weapon', async () => {
    const { priv } = await hero(sword, { styleB: true, withRb: true });
    expect(parentName(priv.weapon)).toBe('hand_r_b');
  });
});

describe('HeroView on a forge hero (no anatomical equip joints in the GLB): every weapon stays in the right hand, as before', () => {
  it('a dagger, a claw and a bow are one instance on hand_r, with no off-hand instance and no claw frame fix', async () => {
    for (const extras of [dagger, claw, bow]) {
      const { hv, priv } = await hero(extras, { forge: true });
      expect(parentName(priv.weapon)).toBe('hand_r');
      expect(priv.offWeapon).toBeNull();
      expect(priv.inst.bones.get('hand_l')!.children).toHaveLength(0);
      expect(priv.weapon!.quaternion.angleTo(new Object3D().quaternion)).toBeCloseTo(0, 6);
      hv.root.updateMatrixWorld(true);
      expect(priv.weapon!.matrixWorld.determinant()).toBeGreaterThan(0);
    }
  });

  it('the bow takes the doctrine-B hold hand_r_b of a forge hero that ships it', async () => {
    const { priv } = await hero(bow, { forge: true, styleB: true, withRb: true });
    expect(parentName(priv.weapon)).toBe('hand_r_b');
  });

  it('a hand-fixed hero turns the forge claw onto the worn-claw pitch (40 deg about X); a forge hero does not', async () => {
    const fixed = await hero(claw);
    expect(fixed.priv.weapon!.quaternion.angleTo(new Object3D().quaternion)).toBeCloseTo((40 * Math.PI) / 180, 5);
    const worn = await hero({ weapon: { type: 'claw', hand: 'r', grip: 'claw', worn: true } });
    expect(worn.priv.weapon!.quaternion.angleTo(new Object3D().quaternion)).toBeCloseTo(0, 6);
  });
});

describe('HeroView weapon VFX sockets', () => {
  it('the weapon socket is the blade tip of the MAIN instance; hand_r stays the right hand for a dagger', async () => {
    const { hv, priv } = await hero(dagger, { rs: 1.5 });
    const out = new Float32Array(SET_FLOATS);
    expect(hv.sockets(out)).toBe(true);
    hv.root.updateMatrixWorld(true);
    const wo = SOCKET_ID.weapon * SOCKET_STRIDE;
    const tipRight = new Vector3(-0.05, 0, 0.9).applyMatrix4(priv.weapon!.matrixWorld);
    const tipLeft = new Vector3(-0.05, 0, 0.9).applyMatrix4(priv.offWeapon!.matrixWorld);
    expect(out[wo]).toBeLessThan(0);
    expect(Math.hypot(out[wo]! - tipRight.x, out[wo + 1]! - tipRight.y, out[wo + 2]! - tipRight.z)).toBeLessThan(1e-4);
    expect(Math.hypot(out[wo]! - tipLeft.x, out[wo + 1]! - tipLeft.y, out[wo + 2]! - tipLeft.z)).toBeGreaterThan(0.1);
    const ho = SOCKET_ID.hand_r * SOCKET_STRIDE;
    const hr = new Vector3().setFromMatrixPosition(priv.inst.bones.get('hand_r')!.matrixWorld);
    expect(out[ho]).toBeCloseTo(hr.x, 4);
  });

  it('the bow: the weapon socket is the bow, hand_r is still the RIGHT hand joint (the drawing hand), hand_l the bow hand', async () => {
    const { hv, priv } = await hero(bow);
    const out = new Float32Array(SET_FLOATS);
    hv.sockets(out);
    hv.root.updateMatrixWorld(true);
    const hr = new Vector3().setFromMatrixPosition(priv.inst.bones.get('hand_r')!.matrixWorld);
    const hl = new Vector3().setFromMatrixPosition(priv.inst.bones.get('hand_l')!.matrixWorld);
    const ho = SOCKET_ID.hand_r * SOCKET_STRIDE;
    const lo = SOCKET_ID.hand_l * SOCKET_STRIDE;
    expect(out[ho]).toBeCloseTo(hr.x, 4);
    expect(out[lo]).toBeCloseTo(hl.x, 4);
    expect(hr.x).toBeLessThan(0);
    expect(hl.x).toBeGreaterThan(0);
    const wo = SOCKET_ID.weapon * SOCKET_STRIDE;
    const tip = new Vector3(-0.05, 0, 0.9).applyMatrix4(priv.weapon!.matrixWorld);
    expect(out[wo]).toBeCloseTo(tip.x, 4);
    expect(out[wo]).toBeGreaterThan(0); // the bow is in the left hand
  });
});

describe('HeroView per-clip hold on both instances', () => {
  it('the off-hand instance follows the main one\'s hold, reflected', async () => {
    const withHold: ModelExtras = { weapon: { type: 'dagger', hand: 'r', clipHold: { idle: [0, 30, 0] } } };
    const { hv, priv } = await hero(withHold, { rs: 1.5 });
    hv.update(0.016, 1, feed);
    const m = priv.weapon!.quaternion;
    const o = priv.offWeapon!.quaternion;
    expect(m.angleTo(new Object3D().quaternion)).toBeGreaterThan(0.4); // the 30 deg hold is on
    expect(o.x).toBeCloseTo(m.x, 6);
    expect(o.y).toBeCloseTo(-m.y, 6);
    expect(o.z).toBeCloseTo(-m.z, 6);
    expect(o.w).toBeCloseTo(m.w, 6);
  });

  it('a rig1to1 hero (extras.rig "rig1to1/..") takes NO hold table: the weapon stays at the socket identity in both hands (SPEC rig1to1 R2)', async () => {
    const withHold: ModelExtras = { weapon: { type: 'dagger', hand: 'r', clipHold: { idle: [0, 30, 0], attack: [10, 0, 0] } } };
    const { hv, priv } = await hero(withHold, { rs: 1.5, rig1to1: true });
    hv.update(0.016, 1, feed);
    expect((hv as unknown as { weaponHold: unknown }).weaponHold).toBeNull();
    expect(priv.weapon!.quaternion.angleTo(new Object3D().quaternion)).toBeLessThan(1e-6);
    expect(priv.offWeapon!.quaternion.angleTo(new Object3D().quaternion)).toBeLessThan(1e-6);
    // the same weapon on a hand-fixed forge hero still takes its table
    const old = await hero(withHold, { rs: 1.5 });
    old.hv.update(0.016, 1, feed);
    expect((old.hv as unknown as { weaponHold: unknown }).weaponHold).not.toBeNull();
  });
});

describe('oneShotFades (rig1to1 R8): the fade-in grows when the one-shot starts from the run or cuts another one-shot', () => {
  it('matches the table', () => {
    // [duration, running, cut] -> [fadeIn, fadeOut]
    const rows: [number, boolean, boolean, number, number][] = [
      [0.9, false, false, 0.08, 0.18], // idle -> attack: as today
      [0.9, true, false, 0.15, 0.18], // run -> attack
      [0.9, false, true, 0.15, 0.18], // attack -> attack2 / swing -> hit
      [0.45, false, false, 0.08, 0.1575], // idle -> hit: 0.35 x 0.45 caps the fade-out
      [0.45, true, false, 0.135, 0.1575], // run -> hit: 0.30 x 0.45
      [0.2, false, false, 0.05, 0.07], // a very short clip: 25 % / 35 %
      [0.2, true, true, 0.06, 0.07],
    ];
    for (const [d, run, cut, fi, fo] of rows) {
      const f = oneShotFades(d, run, cut);
      expect(f.fadeIn).toBeCloseTo(fi, 6);
      expect(f.fadeOut).toBeCloseTo(fo, 6);
    }
  });
});

describe('HeroView weapon disposal', () => {
  it('re-attaching or dropping frees the materials, shadow-depth materials and skeletons of BOTH instances', async () => {
    const skel = vi.spyOn(Skeleton.prototype, 'dispose');
    const { hv, priv } = await hero(dagger, { rs: 1.5, skinnedWeapon: true });
    const main = priv.weapon!;
    const off = priv.offWeapon!;
    expect(off).not.toBeNull();
    const mats = [...priv.weaponMats, ...priv.weaponDepthMats];
    expect(priv.weaponMats).toHaveLength(2); // one material copy per instance
    expect(priv.weaponDepthMats).toHaveLength(2);
    const disposed = new Set<Material>();
    for (const m of mats) m.addEventListener('dispose', () => disposed.add(m));
    // overlays (rim / x-ray siblings of the weapon meshes) exist for both instances and leave with them
    const overlayCount = priv.overlays.filter((o) => {
      for (let p: Object3D | null = o; p; p = p.parent) if (p === main || p === off) return true;
      return false;
    }).length;
    expect(overlayCount).toBe(4);

    // 1. swapping the weapon (setModel again with another one) frees both
    skel.mockClear();
    const swap = (hv as unknown as { attachWeapon(id?: string): void }).attachWeapon.bind(hv);
    swap(undefined);
    expect(disposed.size).toBe(4);
    expect(skel).toHaveBeenCalledTimes(2); // both weapon skeletons
    expect(main.parent).toBeNull();
    expect(off.parent).toBeNull();
    expect(priv.weapon).toBeNull();
    expect(priv.offWeapon).toBeNull();
    expect(priv.overlays.some((o) => { for (let p: Object3D | null = o; p; p = p.parent) if (p === main || p === off) return true; return false; })).toBe(false);
  });

  it('dispose() frees both instances\' materials and skeletons along with the hero', async () => {
    const skel = vi.spyOn(Skeleton.prototype, 'dispose');
    const { hv, priv } = await hero(claw, { rs: 1.7, skinnedWeapon: true });
    const mats = [...priv.weaponMats, ...priv.weaponDepthMats];
    expect(mats).toHaveLength(4);
    const disposed = new Set<Material>();
    for (const m of mats) m.addEventListener('dispose', () => disposed.add(m));
    skel.mockClear();
    hv.dispose();
    expect(disposed.size).toBe(4);
    expect(skel).toHaveBeenCalledTimes(3); // the hero body + the two weapon instances
    expect(priv.weapon).toBeNull();
    expect(priv.offWeapon).toBeNull();
  });

  it('a new model drops the off-hand instance of the old weapon (dagger -> sword leaves nothing on hand_l)', async () => {
    const core = fakeCore([
      loaded('hero', heroScene(1.5), 'hero', SOCK),
      loaded('dag', weaponScene(dagger), 'weapon'),
      loaded('swd', weaponScene(sword), 'weapon'),
    ]);
    const hv = new HeroView(core);
    await hv.setModel('hero', 'dag');
    const priv = hv as unknown as { weapon: Object3D | null; offWeapon: Object3D | null; inst: ModelInstance };
    expect(priv.offWeapon).not.toBeNull();
    await hv.setModel('hero', 'swd');
    expect(priv.offWeapon).toBeNull();
    expect(parentName(priv.weapon)).toBe('hand_r');
    expect(priv.inst.bones.get('hand_l')!.children).toHaveLength(0);
    await hv.setModel('hero', 'dag');
    expect(parentName(priv.offWeapon)).toBe('hand_l');
    expect(priv.inst.bones.get('hand_l')!.children).toHaveLength(1); // exactly the one mirrored dagger (its overlays hang inside the weapon root)
  });
});

describe('HeroView: the held weapons list and the bowstring', () => {
  const stringBow: ModelExtras = { weapon: { type: 'bow', hand: 'l', grip: 'bow', string: { top: [-0.3, 0, 0.6], bottom: [-0.3, 0, -0.6] } } };
  const privOf = (hv: HeroView) =>
    hv as unknown as { weapon: Object3D; bowString: { nock: Vector3; root: Object3D } | null; bowDrawHand: Object3D | null; mixer: { clipAction(c: AnimationClip): { play(): void; time: number; setEffectiveWeight(w: number): void } }; syncBowString(): void };
  const attackB = new AnimationClip('attack_b', 0.9, [new VectorKeyframeTrack('hips.position', [0, 0.9], [0, 0.9, 0, 0, 0.9, 0])]);

  it('weapons lists the main instance first (its hand), then the mirrored off-hand one of a dual weapon', async () => {
    const sw = await hero(sword);
    expect(sw.hv.weapons.map((w) => w.side)).toEqual(['r']);
    const dg = await hero(dagger, { rs: 1.5 });
    expect(dg.hv.weapons.map((w) => w.side)).toEqual(['r', 'l']);
    expect(dg.hv.weapons[0]!.root).toBe(dg.priv.weapon);
    expect(dg.hv.weapons[1]!.root).toBe(dg.priv.offWeapon);
    const bw = await hero(bow);
    expect(bw.hv.weapons.map((w) => w.side)).toEqual(['l']);
  });

  it('a bow that declares its string anchors carries the string on its root; other weapons and a bow without anchors do not', async () => {
    const withString = await hero(stringBow, { styleB: true });
    const p = privOf(withString.hv);
    expect(p.bowString).not.toBeNull();
    expect(p.weapon.children.some((c) => c.name === 'bowstring')).toBe(true);
    expect(p.bowDrawHand?.name).toBe('hand_r');
    expect(privOf((await hero(bow)).hv).bowString).toBeNull();
    expect(privOf((await hero(sword)).hv).bowString).toBeNull();
    expect(privOf((await hero({ weapon: { type: 'sword', hand: 'r', string: { top: [0, 0, 1], bottom: [0, 0, -1] } } })).hv).bowString).toBeNull();
  });

  it('a legacy right-hand bow (a hero without the equip joints) has a straight string and no drawing hand', async () => {
    const { hv } = await hero(stringBow, { forge: true });
    const p = privOf(hv);
    expect(p.bowString).not.toBeNull();
    expect(p.bowDrawHand).toBeNull();
  });

  it('dropping the weapon or the model removes the string', async () => {
    const { hv } = await hero(stringBow, { styleB: true });
    const p = privOf(hv);
    const root = p.bowString!.root;
    expect(root.parent).not.toBeNull();
    hv.dispose();
    expect(root.parent).toBeNull();
    expect(privOf(hv).bowString).toBeNull();
  });

  it('the nock follows the right hand while the bow shot clip is drawn, rests otherwise, and the string is read from the mixer (no game loop needed)', async () => {
    const { hv, core } = await hero(stringBow, { styleB: true });
    ((core.assets.model('hero') as LoadedModel).clipMap as Map<string, AnimationClip>).set('attack_b', attackB);
    (core.assets.model('hero') as LoadedModel).extras.hit = { attack_b: 0.5 };
    const p = privOf(hv);
    // before the clip runs: straight string at the rest nock
    hv.root.updateMatrixWorld(true);
    p.syncBowString();
    expect(p.bowString!.nock.toArray()).toEqual([-0.3, 0, 0]);
    const a = p.mixer.clipAction(attackB);
    a.play();
    a.setEffectiveWeight(1);
    const drawn = (t: number): Vector3 => {
      a.time = t;
      hv.root.updateMatrixWorld(true);
      p.syncBowString();
      return p.bowString!.nock.clone();
    };
    expect(drawn(0).distanceTo(new Vector3(-0.3, 0, 0))).toBeLessThan(1e-9);
    // hand_r is 0.8 m from hand_l along -X in the stand-in: at full draw the nock is on the hand, in the bow frame
    const full = drawn(0.3);
    expect(full.x).toBeCloseTo(-0.8, 3);
    expect(full.y).toBeCloseTo(0, 3);
    expect(full.z).toBeCloseTo(0, 3);
    // let go just after the hit (0.5 s): a few frames later the string rings about the rest nock, far from the hand; a long time after it has settled
    expect(Math.abs(drawn(0.58).x - -0.8)).toBeGreaterThan(0.4);
    expect(drawn(0.89).distanceTo(new Vector3(-0.3, 0, 0))).toBeLessThan(0.03);
    // a clip that is not running (stopped) does not draw
    a.setEffectiveWeight(0);
    expect(drawn(0.3).distanceTo(new Vector3(-0.3, 0, 0))).toBeLessThan(1e-9);
  });
});

describe('HeroView: upper/lower body attack-while-running layering', () => {
  function layeredHero(): LoadedModel {
    const scene = new Group();
    scene.userData = { rig: 'rig1to1/2', humanoid: { handFrame: FIXED_FRAME } };
    const pelvis = new Bone();
    pelvis.name = 'Pelvis';
    const lThigh = new Bone();
    lThigh.name = 'L_Thigh';
    const spine = new Bone();
    spine.name = 'Spine';
    const rHand = new Bone();
    rHand.name = 'R_Hand';
    pelvis.add(lThigh, spine);
    spine.add(rHand);
    const g = new BoxGeometry(0.4, 1.6, 0.3);
    const n = g.getAttribute('position').count;
    g.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: n }, () => [1, 0, 0, 0]).flat(), 4));
    const body = new SkinnedMesh(g, new MeshStandardMaterial());
    scene.add(pelvis, body);
    scene.updateMatrixWorld(true);
    body.bind(new Skeleton([pelvis, lThigh, spine, rHand]));

    const qId = [0, 0, 0, 1];
    const qLegRun = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.7).toArray();
    const qArmRun = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.25).toArray();
    const qArmAtk = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1.2).toArray();
    const qLegAtk = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.15).toArray();

    const mkClip = (name: string, legQ: number[], armQ: number[]): AnimationClip =>
      new AnimationClip(name, 1.0, [
        new QuaternionKeyframeTrack('Pelvis.quaternion', [0, 1], [...qId, ...qId]),
        new QuaternionKeyframeTrack('L_Thigh.quaternion', [0, 1], [...legQ, ...legQ]),
        new QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [...qId, ...qId]),
        new QuaternionKeyframeTrack('R_Hand.quaternion', [0, 1], [...armQ, ...armQ]),
      ]);

    const clips = [mkClip('idle', qId, qId), mkClip('run', qLegRun, qArmRun), mkClip('attack', qLegAtk, qArmAtk), mkClip('dash', qLegAtk, qArmAtk)];
    const m = loaded('hero_layered', scene, 'hero');
    m.clips = clips;
    for (const c of clips) (m.clipMap as Map<string, AnimationClip>).set(c.name, c);
    return m;
  }

  const mkFeed = (speed: number): PlayerFeed => ({
    x: 0,
    z: 0,
    px: 0,
    pz: 0,
    rot: 0,
    speed,
    dead: false,
    flash: 0,
    corrupted: 0,
  });

  it('keeps lower-body run legs active while upper-body attack plays on moving hero (zero sliding)', async () => {
    const core = fakeCore([layeredHero()]);
    const hv = new HeroView(core);
    await hv.setModel('hero_layered');
    const priv = hv as unknown as {
      runLower: AnimationAction | null;
      runUpper: AnimationAction | null;
      shot: { action: AnimationAction; upper: AnimationAction | null; layerable: boolean } | null;
      inst: ModelInstance;
    };
    expect(priv.runLower).not.toBeNull();
    expect(priv.runUpper).not.toBeNull();

    // Ramp up into full run
    for (let i = 0; i < 40; i++) hv.update(0.025, 1, mkFeed(5));
    expect(priv.runLower!.getEffectiveWeight()).toBeGreaterThan(0.95);
    expect(priv.runUpper!.getEffectiveWeight()).toBeGreaterThan(0.95);

    // Trigger attack while continuing to run
    hv.trigger('attack', 1);
    for (let i = 0; i < 12; i++) hv.update(0.025, 1, mkFeed(5)); // t = 0.30 s (peak of swing)
    expect(priv.shot).not.toBeNull();
    expect(priv.shot!.layerable).toBe(true);
    expect(priv.runLower!.getEffectiveWeight()).toBeGreaterThan(0.95); // legs stay in full run!
    expect(priv.runUpper!.getEffectiveWeight()).toBeLessThan(0.05); // run arms suppressed
    expect(priv.shot!.upper!.getEffectiveWeight()).toBeGreaterThan(0.95); // upper body full attack!
    expect(priv.shot!.action.getEffectiveWeight()).toBeLessThan(0.05); // full-body attack legs off

    // Verify actual bone transforms: L_Thigh holds the run pose, R_Hand holds the attack pose
    const lThigh = priv.inst.bones.get('L_Thigh')!;
    const rHand = priv.inst.bones.get('R_Hand')!;
    const expectedLeg = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.7);
    const expectedArm = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1.2);
    expect(lThigh.quaternion.angleTo(expectedLeg)).toBeLessThan(0.05);
    expect(rHand.quaternion.angleTo(expectedArm)).toBeLessThan(0.05);
  });

  it('plays full-body attack when stationary and full-body dash even while running', async () => {
    const core = fakeCore([layeredHero()]);
    const hv = new HeroView(core);
    await hv.setModel('hero_layered');
    const priv = hv as unknown as {
      runLower: AnimationAction | null;
      shot: { action: AnimationAction; upper: AnimationAction | null; layerable: boolean } | null;
      inst: ModelInstance;
    };

    // Stationary attack: full-body lunge & stance
    hv.trigger('attack', 1);
    for (let i = 0; i < 12; i++) hv.update(0.025, 1, mkFeed(0));
    expect(priv.shot!.action.getEffectiveWeight()).toBeGreaterThan(0.95);
    expect(priv.shot!.upper!.getEffectiveWeight()).toBeLessThan(0.05);
    expect(priv.runLower!.getEffectiveWeight()).toBeLessThan(0.05);

    // Finish attack, ramp to run, then trigger dash (non-layerable full-body)
    for (let i = 0; i < 40; i++) hv.update(0.025, 1, mkFeed(5));
    hv.trigger('dash', 1);
    for (let i = 0; i < 12; i++) hv.update(0.025, 1, mkFeed(5));
    expect(priv.shot!.layerable).toBe(false);
    expect(priv.shot!.action.getEffectiveWeight()).toBeGreaterThan(0.95);
    expect(priv.runLower!.getEffectiveWeight()).toBeLessThan(0.05);
  });

  it('faces WASD when walking (zero moonwalk), twists upper torso on diagonal attacks, and pivots with backpedal legs on rear attacks', async () => {
    const core = fakeCore([layeredHero()]);
    const hv = new HeroView(core);
    await hv.setModel('hero_layered');
    const priv = hv as unknown as { inst: ModelInstance; torsoTwist: number; runLower: AnimationAction | null };
    const moveNorthCursorSouth: PlayerFeed = { x: 0, z: -0.1, px: 0, pz: 0, vx: 0, vz: -5, rot: 0, speed: 5, dead: false, flash: 0, corrupted: 0 };

    // 1. Walking North (-Z, yaw=PI) WITHOUT attacking while rot/cursor points South (0): faces North (PI), forward stride, zero moonwalk
    for (let i = 0; i < 30; i++) hv.update(0.02, 1, moveNorthCursorSouth);
    expect(Math.abs(Math.abs(hv.root.rotation.y) - Math.PI)).toBeLessThan(0.05);
    expect(priv.runLower!.timeScale).toBeGreaterThan(0);
    expect(Math.abs(priv.torsoTwist)).toBeLessThan(0.05);

    // 2. Walking North (-Z) and clicking LMB South (aimYaw=0, 180° behind): pivots to face South to strike into the VFX with backpedal legs (timeScale < 0)
    hv.trigger('attack', 1, false, 0);
    for (let i = 0; i < 15; i++) hv.update(0.02, 1, moveNorthCursorSouth); // t = 0.30 s (active swing)
    expect(Math.abs(hv.root.rotation.y)).toBeLessThan(0.1); // turned to face South (0)
    expect(priv.runLower!.timeScale).toBeLessThan(0); // backpedal legs, NOT forward moonwalking
    expect(Math.abs(priv.torsoTwist)).toBeLessThan(0.1);

    // 3. Once the rear attack finishes while still walking North, hero turns back North and resumes forward stride
    for (let i = 0; i < 45; i++) hv.update(0.02, 1, moveNorthCursorSouth);
    expect(Math.abs(Math.abs(hv.root.rotation.y) - Math.PI)).toBeLessThan(0.05);
    expect(priv.runLower!.timeScale).toBeGreaterThan(0);

    // 4. Walking East (+X, yaw=PI/2) while attacking North-East (aimYaw=PI/4, -45°): legs face East forward, torso twists -45° directly onto NE
    const moveEastAimNE: PlayerFeed = { x: 0.1, z: 0, px: 0, pz: 0, vx: 5, vz: 0, rot: Math.PI / 4, speed: 5, dead: false, flash: 0, corrupted: 0 };
    for (let i = 0; i < 30; i++) hv.update(0.02, 1, moveEastAimNE);
    hv.trigger('attack', 1, false, Math.PI / 4);
    for (let i = 0; i < 15; i++) hv.update(0.02, 1, moveEastAimNE);
    expect(hv.root.rotation.y).toBeCloseTo(Math.PI / 2, 1);
    expect(priv.runLower!.timeScale).toBeGreaterThan(0);
    expect(priv.torsoTwist).toBeCloseTo(-Math.PI / 4, 1);

    // 5. Standing still and attacking North (rot=PI): full body rotates 180° to face North
    const stillAimNorth: PlayerFeed = { x: 0, z: 0, px: 0, pz: 0, vx: 0, vz: 0, rot: Math.PI, speed: 0, dead: false, flash: 0, corrupted: 0 };
    for (let i = 0; i < 60; i++) hv.update(0.02, 1, stillAimNorth);
    expect(Math.abs(Math.abs(hv.root.rotation.y) - Math.PI)).toBeLessThan(0.05);
    expect(Math.abs(priv.torsoTwist)).toBeLessThan(0.05);
  });
});

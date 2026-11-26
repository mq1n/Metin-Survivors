import { describe, expect, it } from 'vitest';
import { Bone, BoxGeometry, Euler, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3 } from 'three';
import { EQUIP_JOINTS_MARK, FORGE_CLAW_PITCH, hasEquipJoints, mirrorQuaternionX, placeMirrored, planHeldWeapons, syncMirrored, weaponFrameFix, weaponHands } from './weaponHands';

const ex = (type: string, hand = 'r'): unknown => ({ weapon: { type, hand } });

describe('weaponHands (the weapon type decides the hands)', () => {
  it('dagger and claw take both hands (right main, left off), the bow the left only, every other type the right', () => {
    expect(weaponHands(ex('dagger'))).toEqual({ main: 'r', off: 'l' });
    expect(weaponHands(ex('claw'))).toEqual({ main: 'r', off: 'l' });
    expect(weaponHands(ex('bow', 'l'))).toEqual({ main: 'l', off: null });
    // the type wins over the GLB's hand field (the shipped claws and daggers say hand 'r' = the main hand)
    expect(weaponHands(ex('bow', 'r'))).toEqual({ main: 'l', off: null });
    for (const t of ['sword', 'twohand', 'fan', 'bell']) expect(weaponHands(ex(t))).toEqual({ main: 'r', off: null });
  });

  it('a model without extras (forge / dev stand-ins) is a right-hand weapon; an unknown type follows its hand field', () => {
    expect(weaponHands(undefined)).toEqual({ main: 'r', off: null });
    expect(weaponHands({})).toEqual({ main: 'r', off: null });
    expect(weaponHands({ weapon: {} })).toEqual({ main: 'r', off: null });
    expect(weaponHands(ex('wand', 'l'))).toEqual({ main: 'l', off: null });
    expect(weaponHands(ex('wand', 'r'))).toEqual({ main: 'r', off: null });
  });
});

/** a hero skeleton stand-in: mirror-symmetric hand joints, hand_r carries the hold scale of the dagger / claw classes */
function skeleton(opts: { rightScale?: number; withLeft?: boolean; withRb?: boolean; withLb?: boolean } = {}) {
  const root = new Group();
  const bones = new Map<string, Object3D>();
  const add = (name: string, x: number, scale = 1): Bone => {
    const b = new Bone();
    b.name = name;
    b.position.set(x, 1, 0);
    b.scale.setScalar(scale);
    root.add(b);
    bones.set(name, b);
    return b;
  };
  add('hand_r', -0.4, opts.rightScale ?? 1);
  if (opts.withLeft !== false) add('hand_l', 0.4);
  if (opts.withRb) add('hand_r_b', -0.4);
  if (opts.withLb) add('hand_l_b', 0.4);
  return { root, bones };
}
const names = (m: Record<string, string> = {}) => (key: string): string | undefined => m[key];

describe('planHeldWeapons (socket choice per weapon type)', () => {
  it('a sword hangs on hand_r only', () => {
    const s = skeleton();
    const p = planHeldWeapons(ex('sword'), false, names(), s.bones, s.root);
    expect(p.mounts.map((m) => [m.hand, m.bone.name, m.mirrored])).toEqual([['r', 'hand_r', false]]);
    expect(p.rightBone).toBe(s.bones.get('hand_r'));
  });

  it('a dagger / claw hangs on hand_r and, mirrored, on hand_l; the left carries the right joint\'s hold scale', () => {
    for (const [type, k] of [['dagger', 1.5], ['claw', 1.7]] as const) {
      const s = skeleton({ rightScale: k });
      const p = planHeldWeapons(ex(type), false, names(), s.bones, s.root);
      expect(p.mounts.map((m) => [m.hand, m.bone.name, m.mirrored])).toEqual([['r', 'hand_r', false], ['l', 'hand_l', true]]);
      expect(p.mounts[0]!.scaleK).toBe(1);
      expect(p.mounts[1]!.scaleK).toBeCloseTo(k, 6);
    }
  });

  it('the bow hangs on hand_l (not mirrored), or hand_l_b under doctrine B when the hero ships it (SPEC rig1to1 R1); the VFX hand_r stays the right joint', () => {
    const s = skeleton({ withRb: true, withLb: true });
    const a = planHeldWeapons(ex('bow', 'l'), false, names({ hand_r_b: 'hand_r_b', hand_l_b: 'hand_l_b' }), s.bones, s.root);
    expect(a.mounts.map((m) => [m.hand, m.bone.name, m.mirrored])).toEqual([['l', 'hand_l', false]]);
    expect(a.rightBone).toBe(s.bones.get('hand_r'));
    const b = planHeldWeapons(ex('bow', 'l'), true, names({ hand_r_b: 'hand_r_b', hand_l_b: 'hand_l_b' }), s.bones, s.root);
    expect(b.mounts.map((m) => [m.hand, m.bone.name, m.mirrored])).toEqual([['l', 'hand_l_b', false]]);
    expect(b.rightBone).toBe(s.bones.get('hand_r_b'));
    // without hand_l_b in sockets, doctrine B falls back to hand_l
    const fb = planHeldWeapons(ex('bow', 'l'), true, names({ hand_r_b: 'hand_r_b' }), s.bones, s.root);
    expect(fb.mounts.map((m) => m.bone.name)).toEqual(['hand_l']);
  });

  it('doctrine B uses hand_r_b only when the hero ships it; the socket table renames joints', () => {
    const s = skeleton({ withRb: true });
    expect(planHeldWeapons(ex('fan'), true, names({ hand_r_b: 'hand_r_b' }), s.bones, s.root).mounts[0]!.bone.name).toBe('hand_r_b');
    expect(planHeldWeapons(ex('fan'), true, names(), s.bones, s.root).mounts[0]!.bone.name).toBe('hand_r');
    expect(planHeldWeapons(ex('fan'), false, names({ hand_r_b: 'hand_r_b' }), s.bones, s.root).mounts[0]!.bone.name).toBe('hand_r');
    s.bones.set('RightHandSocket', s.bones.get('hand_r')!);
    expect(planHeldWeapons(ex('fan'), false, names({ hand_r: 'RightHandSocket' }), s.bones, s.root).mounts[0]!.bone.name).toBe('hand_r');
  });

  it('a hero without hand_l keeps every weapon in the right hand (no second instance, the bow falls back)', () => {
    const s = skeleton({ withLeft: false });
    expect(planHeldWeapons(ex('dagger'), false, names(), s.bones, s.root).mounts.map((m) => [m.hand, m.mirrored])).toEqual([['r', false]]);
    expect(planHeldWeapons(ex('bow', 'l'), false, names(), s.bones, s.root).mounts.map((m) => [m.hand, m.bone.name])).toEqual([['r', 'hand_r']]);
  });

  it('a hero without anatomical equip joints (equipJoints false) keeps every weapon in the right hand: no off-hand dagger / claw, no left bow', () => {
    const s = skeleton({ withRb: true });
    for (const t of ['dagger', 'claw', 'bow']) {
      const p = planHeldWeapons(ex(t, t === 'bow' ? 'l' : 'r'), false, names({ hand_r_b: 'hand_r_b' }), s.bones, s.root, false);
      expect(p.mounts.map((m) => [m.hand, m.bone.name, m.mirrored])).toEqual([['r', 'hand_r', false]]);
    }
    // doctrine B still takes the hero's own right hold; the VFX hand_r joint is unchanged
    const b = planHeldWeapons(ex('bow', 'l'), true, names({ hand_r_b: 'hand_r_b' }), s.bones, s.root, false);
    expect(b.mounts.map((m) => m.bone.name)).toEqual(['hand_r_b']);
    expect(b.rightBone).toBe(s.bones.get('hand_r_b'));
    // the default (argument omitted) is the weapon-type plan
    expect(planHeldWeapons(ex('dagger'), false, names(), s.bones, s.root).mounts).toHaveLength(2);
  });

  it('a hero with no hand joints at all falls back to the model root', () => {
    const root = new Group();
    const p = planHeldWeapons(ex('sword'), false, names(), new Map(), root);
    expect(p.mounts[0]!.bone).toBe(root);
    expect(p.rightBone).toBe(root);
  });
});

describe('placeMirrored (the left instance = the right one reflected about the sagittal plane)', () => {
  const q = (rx: number, ry: number, rz: number): Quaternion => new Quaternion().setFromEuler(new Euler(rx, ry, rz, 'XYZ'));

  it('mirrorQuaternionX is the rotation conjugated by the x reflection', () => {
    const Mx = new Matrix4().makeScale(-1, 1, 1);
    const r = q(0.4, -0.9, 0.3);
    const conj = new Matrix4().multiplyMatrices(new Matrix4().multiplyMatrices(Mx, new Matrix4().makeRotationFromQuaternion(r)), Mx);
    const got = new Matrix4().makeRotationFromQuaternion(mirrorQuaternionX(r, new Quaternion()));
    for (let i = 0; i < 16; i++) expect(got.elements[i]).toBeCloseTo(conj.elements[i]!, 6);
  });

  it('every vertex of the left instance sits at the x-reflected world point of the right one (hold scale included)', () => {
    // symmetric hand joints: hand_l is hand_r reflected; hand_r carries the 1.5 hold scale, hand_l 1
    const s = skeleton({ rightScale: 1.5 });
    const handR = s.bones.get('hand_r')!;
    const handL = s.bones.get('hand_l')!;
    handR.quaternion.copy(q(0.2, -0.5, 0.35));
    mirrorQuaternionX(handR.quaternion, handL.quaternion);
    const make = (): Mesh => new Mesh(new BoxGeometry(0.02, 0.04, 0.4).translate(-0.05, 0.01, 0.2), new MeshBasicMaterial());
    const main = make();
    main.quaternion.copy(q(0.1, 0.6, -0.2)); // the GLB's own hold
    main.position.set(0.01, -0.02, 0.03);
    handR.add(main);
    const off = make();
    placeMirrored(off, main, 1.5);
    handL.add(off);
    s.root.updateMatrixWorld(true);
    const a = new Vector3();
    const b = new Vector3();
    const pos = main.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      a.fromBufferAttribute(pos, i).applyMatrix4(main.matrixWorld);
      b.fromBufferAttribute(pos, i).applyMatrix4(off.matrixWorld);
      // the right hand is the left hand reflected only up to the joint offsets (x = -0.4 / 0.4): reflect about x = 0
      expect(b.x).toBeCloseTo(-a.x, 5);
      expect(b.y).toBeCloseTo(a.y, 5);
      expect(b.z).toBeCloseTo(a.z, 5);
    }
    // the mirror is a reflection (negative determinant, three.js flips the winding), the main is not
    expect(main.matrixWorld.determinant()).toBeGreaterThan(0);
    expect(off.matrixWorld.determinant()).toBeLessThan(0);
  });

  it('syncMirrored follows the per-clip hold of the main instance every frame', () => {
    const main = new Object3D();
    const off = new Object3D();
    placeMirrored(off, main);
    main.quaternion.copy(q(-0.2, 0.5, 0.1));
    syncMirrored(off, main);
    expect(off.quaternion.angleTo(mirrorQuaternionX(main.quaternion, new Quaternion()))).toBeLessThan(1e-5);
    expect(off.scale.x).toBe(-1);
    expect(off.scale.y).toBe(1);
  });
});

describe('hasEquipJoints (a hand-fixed hero GLB declares anatomical equip joints in its scene extras)', () => {
  it('true for the anatomical equip-joints generator text, false for the forge text and for anything else', () => {
    expect(EQUIP_JOINTS_MARK).toBe('anatomical equip joints');
    expect(hasEquipJoints({ humanoid: { handFrame: 'anatomical equip joints (rig1to1): hand_r / hand_l / hand_r_b are rigid children of the hand joints' } })).toBe(true);
    expect(hasEquipJoints({ humanoid: { handFrame: 'palm +X(r) / -X(l), fingers -Y, thumb +Z, grip axis Z' } })).toBe(false);
    for (const v of [undefined, null, {}, { humanoid: {} }, { humanoid: { handFrame: 3 } }, 'anatomical equip joints']) expect(hasEquipJoints(v)).toBe(false);
  });
});

describe('weaponFrameFix (forge claws take the worn-claw frame, rigfix 2026-10-29)', () => {
  it('a forge claw (talons +Z, no worn frame) turns 40 deg about X onto the talon pitch of the Tripo claws (50 deg from -Y), the grip stays at the origin', () => {
    const q = weaponFrameFix({ weapon: { type: 'claw', tier: 0, hand: 'r', grip: 'claw' } });
    expect(q).not.toBeNull();
    const talon = new Vector3(0, 0, 0.3).applyQuaternion(q!);
    expect(talon.x).toBeCloseTo(0, 6);
    expect(talon.y).toBeCloseTo(-0.3 * Math.sin(FORGE_CLAW_PITCH), 6);
    expect(talon.z).toBeCloseTo(0.3 * Math.cos(FORGE_CLAW_PITCH), 6);
    expect((Math.atan2(talon.z, -talon.y) * 180) / Math.PI).toBeCloseTo(50, 3);
    expect(new Vector3(0, 0, 0).applyQuaternion(q!).length()).toBe(0);
    // a rotation about X is its own sagittal mirror: the mirrored off-hand instance keeps the same fix
    expect(mirrorQuaternionX(q!, new Quaternion()).angleTo(q!)).toBeLessThan(1e-9);
  });

  it('the Tripo claws (worn frame) and every other weapon keep their frame', () => {
    expect(weaponFrameFix({ weapon: { type: 'claw', worn: true } })).toBeNull();
    for (const t of ['sword', 'twohand', 'dagger', 'bow', 'fan', 'bell']) expect(weaponFrameFix({ weapon: { type: t } })).toBeNull();
    expect(weaponFrameFix(undefined)).toBeNull();
  });
});

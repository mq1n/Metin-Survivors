// Hero rendering: SkinnedMesh + AnimationMixer with crossfaded locomotion, one-shot actions (attack/cast/dash/…),
// weapon attached to a socket bone, armor tier = model swap. One HeroView per player.
import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  MathUtils,
  Matrix4,
  MeshDepthMaterial,
  Quaternion,
  type AnimationAction,
  type Bone,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  Vector2,
  Vector3,
} from 'three';
import type { LoadedModel, ModelInstance } from '../engine/assets';
import type { RenderCore, RenderSystem } from './core';
import type { PlayerFeed } from './feed';
import type { BlobShadows } from './crowd/blobShadows';
import { addHeroOverlays, markHeroStencil } from './heroOutline';
import { setHeroGuard } from '../vfx/heroGuard';
import { SOCKET_ID, SOCKET_STRIDE, STAND_IN, quatFromBasis, writeYawSocket } from '../vfx/spec/sockets';
import { WeaponHold } from './weaponHold';
import { hasEquipJoints, isRig1to1, placeMirrored, planHeldWeapons, syncMirrored, weaponFrameFix, type HeldMount } from './weaponHands';
import { BowStringRig, bowAnchorsFromExtras, bowDraw, isBow, poseBowString, type DrawState } from './bowString';

export type HeroAction = 'attack' | 'attack2' | 'cast' | 'dash' | 'hit' | 'victory' | 'special1' | 'special2' | 'special3';

const REF_RUN_SPEED = 5; // m/s the authored run cycle is tuned for
const _v = new Vector3();
const _q = new Quaternion();
const _qParent = new Quaternion();
const _m = new Matrix4();
/** max procedural upper-body yaw twist (rad) when attacking diagonally while running forward along WASD */
const MAX_TORSO_TWIST = MathUtils.degToRad(75);
/** body sockets fed to the VFX (spec/sockets.ts), besides `weapon` (blade tip) and `root` (the feet) */
const BODY_SOCKETS = ['hand_r', 'hand_l', 'head', 'chest'] as const;
const STRING_REST: DrawState = { draw: 0, sinceRelease: 0 };
const LOCO_BLEND = 9; // 1/s weight response
const ROT_RESPONSE = 16; // 1/s facing response
const ROT_ATTACK_RESPONSE = 32; // 1/s snappy pivot when attacking behind travel direction
/** Render-only hero scale: the authored ~1.8 m models read too small at the gameplay camera (sim radius unchanged). */
export const HERO_RENDER_SCALE = 1.12;

/** Actions whose upper body layers cleanly over running legs when moving (dash / victory stay full-body). */
const LAYERABLE_ACTIONS = new Set<string>(['attack', 'attack2', 'cast', 'hit', 'special1', 'special2', 'special3']);
/** Combat actions that actively face their strike direction during the swing. */
const ATTACK_ACTIONS = new Set<string>(['attack', 'attack2', 'cast', 'special1', 'special2', 'special3']);

/** Collect the spine bone and all its descendants (arms, head, upper torso) for upper/lower body clip splitting. */
function collectUpperBones(root: Object3D): Set<string> {
  const out = new Set<string>();
  let spine: Object3D | null = null;
  root.traverse((o) => {
    if (spine || !(o as Bone).isBone) return;
    if (/^spine$/i.test(o.name)) spine = o;
  });
  if (!spine) {
    root.traverse((o) => {
      if (spine || !(o as Bone).isBone) return;
      if (/^spine/i.test(o.name)) spine = o;
    });
  }
  if (spine) {
    (spine as Object3D).traverse((o) => {
      if (o.name) out.add(o.name);
    });
  }
  return out;
}

/** Collect Spine + Spine1/Chest bones in hierarchy order for procedural upper-body aim twist while moving. */
function collectSpineBones(root: Object3D): Object3D[] {
  let spine: Object3D | null = null;
  let spine1: Object3D | null = null;
  root.traverse((o) => {
    if (!(o as Bone).isBone) return;
    if (!spine && /^spine$/i.test(o.name)) spine = o;
    else if (!spine1 && /^spine1$|^chest$/i.test(o.name)) spine1 = o;
  });
  const out: Object3D[] = [];
  if (spine) out.push(spine);
  if (spine1) out.push(spine1);
  return out;
}

/** Node/bone name targeted by a Three.js KeyframeTrack (`Spine.quaternion` or `.bones[Spine].quaternion`). */
function trackBoneName(trackName: string): string {
  const m = /\.bones\[([^\]]+)\]/.exec(trackName);
  if (m) return m[1]!;
  const dot = trackName.indexOf('.');
  return dot >= 0 ? trackName.slice(0, dot) : trackName;
}

/** Build a filtered copy of `clip` keeping only upper-body (`upper = true`) or lower-body (`upper = false`) tracks. */
export function filterClipByBones(clip: AnimationClip, upperBones: ReadonlySet<string>, upper: boolean): AnimationClip | null {
  if (upperBones.size === 0) return null;
  const tracks = clip.tracks.filter((tr) => upperBones.has(trackBoneName(tr.name)) === upper);
  if (tracks.length === 0 || tracks.length === clip.tracks.length) return null;
  return new AnimationClip(`${clip.name}__${upper ? 'upper' : 'lower'}`, clip.duration, tracks);
}

interface OneShot {
  action: AnimationAction;
  /** upper-body-only twin of `action`, driven in sync while moving so legs keep running */
  upper: AnimationAction | null;
  /** whether this action layers upper-body over running legs when moving */
  layerable: boolean;
  t: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  /** keep the pose after finishing (death/victory) */
  hold: boolean;
  /** the action name (per-clip weapon hold, weaponHold.ts) */
  name: string;
  /** world yaw (rad) the strike targets; undefined for non-directional clips (hit, victory, self-buff) */
  aimYaw?: number;
}

/**
 * Fade times of a one-shot over the locomotion layer (rig1to1 R8, 2026-11-06): from the idle the old 0.08 s / 25 % fade-in; when the hero is
 * running (`runWeight` > 0.5 at the trigger) or the one-shot cuts another (swing -> hit after 60 %, attack -> attack2) the arm chain may be
 * 40-60 cm from the clip's first key, so the fade-in grows to min(0.15 s, 30 %); the fade-out stays min(0.18 s, 35 %).
 */
export function oneShotFades(duration: number, running: boolean, cut: boolean): { fadeIn: number; fadeOut: number } {
  return {
    fadeIn: running || cut ? Math.min(0.15, duration * 0.3) : Math.min(0.08, duration * 0.25),
    fadeOut: Math.min(0.18, duration * 0.35),
  };
}

export class HeroView {
  readonly root = new Group();
  /** interpolated ground position (what the camera follows) */
  readonly position = new Vector3();
  modelId = '';
  weaponId = '';
  private styleB = false;

  private inst: ModelInstance | null = null;
  private model: LoadedModel | null = null;
  private mixer: AnimationMixer | null = null;
  private idle: AnimationAction | null = null;
  private run: AnimationAction | null = null;
  /** lower-body & upper-body halves of `run` so attacks/casts play on the torso/arms while the legs keep running */
  private runLower: AnimationAction | null = null;
  private runUpper: AnimationAction | null = null;
  private upperBones = new Set<string>();
  private readonly upperClips = new Map<AnimationClip, AnimationClip | null>();
  private deathAction: AnimationAction | null = null;
  private shot: OneShot | null = null;
  private runWeight = 0;
  private deadBlend = 0;
  private yaw = 0;
  private yawInit = false;
  /** the main held weapon (its hand: the right, or the left for a bow; the blade-tip VFX socket and the per-clip hold belong to it) */
  private weapon: Object3D | null = null;
  /** the second, mirrored instance of a dual weapon (dagger / claw) in the left hand, else null (render/weaponHands.ts) */
  private offWeapon: Object3D | null = null;
  private flashMats: { mat: MeshStandardMaterial; base: MeshStandardMaterial['emissive'] }[] = [];
  private lastFlash = -1;
  /** hit flash rim: this view's own copy of the shared rim overlay material (hot red-white), swapped in while the flash lasts */
  private flashRim: Material | null = null;
  /** overlay mesh -> the shared rim material it normally draws with, while the flash copy is swapped in */
  private readonly rimSwapped = new Map<Object3D, Material>();
  private wasDead = false;
  private lastClip = '';
  private radius = 0.5;
  /** body height (m, after HERO_RENDER_SCALE) */
  height = 1.8;
  /** rim / x-ray overlays (hidden while dead) */
  private overlays: Object3D[] = [];
  private overlaysShown = true;
  /** weapon material copies (stencil-marked) of every held instance, disposed with the weapons */
  private weaponMats: Material[] = [];
  /** the shadow-depth materials of the body / weapon meshes (see {@link depthMaterial}), disposed with them */
  private bodyDepthMats: Material[] = [];
  private weaponDepthMats: Material[] = [];
  /** the held weapon instances (main / off-hand): their skeletons own GPU bone textures that dispose() must free */
  private weaponInst: ModelInstance | null = null;
  private offWeaponInst: ModelInstance | null = null;
  /** the right-hand socket joint (hand_r or the doctrine-B hold hand_r_b): the VFX `hand_r` socket, also when the right hand holds no weapon (the bow) */
  private rightBone: Object3D | null = null;
  /** the hands of the held instances (main, off-hand), for {@link weapons} */
  private mainHand: 'r' | 'l' = 'r';
  private offHand: 'r' | 'l' = 'l';
  /** the held bow's string (render/bowString.ts), null for every other weapon; its nock follows the right hand in a draw */
  private bowString: BowStringRig | null = null;
  /** the hand that draws the string (the right joint) while the bow is in the left hand; null for a legacy right-hand bow (the string stays straight) */
  private bowDrawHand: Object3D | null = null;
  /** per-clip hold of the held weapon (GLB extras `weapon.clipHold`, weaponHold.ts); null for every weapon without the table */
  private weaponHold: WeaponHold | null = null;
  /** the one-shot a new one-shot replaced (rig1to1 R8): it fades out over the new one's fade-in while the locomotion layer stays down, so the
   * arms cross from swing to swing instead of dropping to the idle pose for the fade (10 000 deg/s measured live before) */
  private fading: { action: AnimationAction; upper: AnimationAction | null; layerable: boolean; w0: number; t: number; dur: number } | null = null;
  /** active animation layers [clip, weight] of the last driveAnimation (idle / run / the one-shot), for the per-clip weapon hold */
  private readonly holdLayers: [string, number][] = [['idle', 0], ['run', 0], ['', 0]];
  /** blade tip in the weapon root (= hand bone) frame and the VFX weapon frame in it (+Y blade, +Z edge) */
  private readonly bladeTip = new Vector3(0, 0, 0.9);
  private readonly bladeQ = new Quaternion();
  private bladeLen = 0.9;
  private loadGen = 0;
  private disposed = false;
  /** spine chain (`Spine`, `Spine1`) twisted procedurally toward attack aim while legs run along WASD */
  private spineBones: Object3D[] = [];
  private torsoTwist = 0;

  constructor(private readonly core: RenderCore) {
    this.root.matrixAutoUpdate = true;
    this.root.scale.setScalar(HERO_RENDER_SCALE);
    core.scene.add(this.root);
  }

  /**
   * The held weapon instances, the main one first, then the mirrored off-hand instance of a dual weapon (dagger / claw): hand, root and the per-clip
   * hold that turns it (the off-hand instance follows the main one's, mirrored). QA tools (held sweeps, held gates) read it to see both hands.
   */
  get weapons(): { side: 'r' | 'l'; root: Object3D; hold: WeaponHold | null }[] {
    const out: { side: 'r' | 'l'; root: Object3D; hold: WeaponHold | null }[] = [];
    if (this.weapon) out.push({ side: this.mainHand, root: this.weapon, hold: this.weaponHold });
    if (this.offWeapon) out.push({ side: this.offHand, root: this.offWeapon, hold: null });
    return out;
  }

  /** Loads (if needed) and swaps the hero model + weapon. Safe to call again for armor tier changes. */
  async setModel(modelId: string, weaponId?: string, styleB = false): Promise<void> {
    const gen = ++this.loadGen;
    const assets = this.core.assets;
    const wanted: { kind: 'model'; id: string; hint: 'hero' | 'weapon' }[] = [{ kind: 'model', id: modelId, hint: 'hero' }];
    if (weaponId) wanted.push({ kind: 'model', id: weaponId, hint: 'weapon' });
    await assets.loadBatch(wanted);
    if (this.disposed || gen !== this.loadGen) return;
    this.styleB = styleB;
    this.dropModel();
    const inst = assets.instantiate(modelId);
    this.inst = inst;
    this.model = assets.model(modelId);
    this.modelId = modelId;
    this.radius = (this.model.asset.radius || 0.5) * HERO_RENDER_SCALE;
    this.height = (this.model.asset.height || this.model.extras.height || 1.8) * HERO_RENDER_SCALE;
    this.root.add(inst.root);
    this.flashMats = [];
    this.overlays = [];
    this.overlaysShown = true;
    for (const mesh of inst.meshes) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.customDepthMaterial = this.depthMaterial(this.bodyDepthMats);
      const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material | undefined;
      if (m && (m as MeshStandardMaterial).isMeshStandardMaterial) {
        const clone = m.clone() as MeshStandardMaterial;
        markHeroStencil(clone);
        mesh.material = clone;
        this.flashMats.push({ mat: clone, base: clone.emissive.clone() });
      }
    }
    for (const mesh of inst.meshes) this.overlays.push(...addHeroOverlays(mesh));
    const mixer = new AnimationMixer(inst.root);
    this.mixer = mixer;
    this.upperBones = collectUpperBones(inst.root);
    this.spineBones = collectSpineBones(inst.root);
    this.torsoTwist = 0;
    this.upperClips.clear();
    const clip = (n: string): AnimationAction | null => {
      const c = this.clipFor(n);
      return c ? mixer.clipAction(c) : null;
    };
    this.idle = clip('idle');
    const runClip = this.clipFor('run') ?? this.clipFor('walk');
    const runLowerClip = runClip ? filterClipByBones(runClip, this.upperBones, false) : null;
    const runUpperClip = runClip ? filterClipByBones(runClip, this.upperBones, true) : null;
    if (runLowerClip && runUpperClip) {
      this.run = null;
      this.runLower = mixer.clipAction(runLowerClip);
      this.runUpper = mixer.clipAction(runUpperClip);
    } else {
      this.run = runClip ? mixer.clipAction(runClip) : null;
      this.runLower = null;
      this.runUpper = null;
    }
    this.deathAction = clip('death');
    for (const a of [this.idle, this.run, this.runLower, this.runUpper]) {
      if (!a) continue;
      a.play();
      a.setEffectiveWeight(0);
    }
    this.idle?.setEffectiveWeight(1);
    this.shot = null;
    this.fading?.action.stop();
    this.fading?.upper?.stop();
    this.fading = null;
    this.runWeight = 0;
    this.deadBlend = 0;
    this.wasDead = false;
    this.lastFlash = -1;
    this.attachWeapon(weaponId);
  }

  private attachWeapon(weaponId?: string): void {
    if (this.weapon || this.offWeapon) {
      const gone = new Set<Object3D>();
      this.weapon?.traverse((o) => gone.add(o));
      this.offWeapon?.traverse((o) => gone.add(o));
      this.overlays = this.overlays.filter((o) => !gone.has(o));
      for (const m of this.weaponMats) m.dispose();
      this.weaponMats = [];
      for (const m of this.weaponDepthMats) m.dispose();
      this.weaponDepthMats = [];
      this.weapon?.removeFromParent();
      this.offWeapon?.removeFromParent();
      this.weapon = null;
      this.offWeapon = null;
    }
    this.freeSkeletons(this.weaponInst);
    this.freeSkeletons(this.offWeaponInst);
    this.weaponInst = null;
    this.offWeaponInst = null;
    this.rightBone = null;
    this.weaponHold = null;
    this.bowString?.dispose();
    this.bowString = null;
    this.bowDrawHand = null;
    this.weaponId = weaponId ?? '';
    if (!weaponId || !this.inst || !this.model) return;
    const model = this.model;
    const wmodel = this.core.assets.model(weaponId);
    
    // the bow = the left hand, everything else = the right; doctrine B may carry its own right hold (hero GLB socket hand_r_b).
    
    const plan = planHeldWeapons(
      wmodel.extras,
      this.styleB,
      (key) => model.asset.sockets?.[key] ?? model.extras.sockets?.[key],
      this.inst.bones,
      this.inst.root,
      hasEquipJoints(model.extras),
    );
    this.rightBone = plan.rightBone;
    const main = plan.mounts[0] as HeldMount;
    this.mainHand = main.hand;
    const w = this.mountWeapon(weaponId, main);
    this.weapon = w.root;
    this.weaponInst = w;
    this.measureBlade(w.root, w.meshes);
    // the bow's string: the anchors the GLB declares (weapon.string); a bow in the left hand is drawn by the right one
    const anchors = isBow(wmodel.extras) ? bowAnchorsFromExtras(wmodel.extras) : null;
    if (anchors) {
      this.bowString = new BowStringRig(anchors);
      this.bowString.attachTo(w.root);
      this.bowString.onSync = () => this.syncBowString();
      this.bowDrawHand = main.hand === 'l' ? plan.rightBone : null;
    }
    // per-clip hold (opt-in by the GLB): measured after measureBlade so the VFX blade frame stays the GLB's own
    
    // heroes keep their per-clip hold tables until their lane removes them
    this.weaponHold = isRig1to1(model.extras) ? null : WeaponHold.from(wmodel.extras, w.root.quaternion.clone());
    if (this.weaponHold) this.weaponHold.apply([['idle', 1]], w.root.quaternion);
    const off = plan.mounts[1];
    if (off) {
      this.offHand = off.hand;
      const o = this.mountWeapon(weaponId, off, w.root);
      this.offWeapon = o.root;
      this.offWeaponInst = o;
    }
  }

  /**
   * One instance of the weapon model on a hand joint, with its own materials / shadow-depth materials (tracked in the shared weapon lists, so
   * dropping the weapon frees every instance). A mirrored instance copies the main one's transform reflected about the sagittal plane.
   */
  private mountWeapon(weaponId: string, mount: HeldMount, mirrorOf?: Object3D): ModelInstance {
    const w = this.core.assets.instantiate(weaponId);
    for (const mesh of w.meshes) {
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.customDepthMaterial = this.depthMaterial(this.weaponDepthMats);
      // own material copy: it writes the hero stencil (x-ray mask) without touching the shared weapon asset
      const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material | undefined;
      if (m) {
        const clone = m.clone();
        markHeroStencil(clone);
        mesh.material = clone;
        this.weaponMats.push(clone);
      }
    }
    if (mirrorOf) placeMirrored(w.root, mirrorOf, mount.scaleK);
    else {
      // forge claws take the worn-claw frame (weaponHands.ts weaponFrameFix) on a hand-fixed hero; the mirrored instance copies it with the rest of the transform
      const fix = hasEquipJoints(this.model?.extras) ? weaponFrameFix(this.core.assets.model(weaponId).extras) : null;
      if (fix) w.root.quaternion.multiply(fix);
    }
    mount.bone.add(w.root);
    w.root.updateMatrixWorld(true);
    for (const mesh of w.meshes) this.overlays.push(...addHeroOverlays(mesh));
    return w;
  }

  /**
   * An own shadow-depth material for one hero mesh, instead of three's single shared MeshDepthMaterial. The shared one picks
   * its shader program from whatever it draws next (skinned or not, instanced or not, map or not) and so changes program from
   * caster to caster: which program the weapon's shadow draw ran with depended on the casters drawn before it that frame.
   * The (program x vertex layout) pair the loading frames and the warm-up passes had drawn was therefore not always the pair a
   * later frame used, and the other pair cost a 45-58 ms driver stall at its first draw in play (first combat / first metin
   * fall: `useProgram` of the weapon's depth program, measured in prod4 runtime-memory-net). An own instance has one program
   * for the mesh for its whole life (three's own default settings, so the program is the one every other caster shares: basic
   * depth packing in r186, whose PCF shadow map is a depth texture; map / alphaTest / side follow the mesh's material per
   * draw), compiled and drawn by the loading frames and RenderWorld.warmup.
   */
  private depthMaterial(into: Material[]): Material {
    const m = new MeshDepthMaterial();
    into.push(m);
    return m;
  }

  /**
   * A cloned skeleton owns a float DataTexture (the GPU bone texture) that three.js creates on the first render and
   * only releases through Skeleton.dispose(): without it every dropped model leaks one texture for the page lifetime.
   * The clone's skeleton is private to the instance (SkeletonUtils.clone), the shared template is untouched.
   */
  private freeSkeletons(inst: ModelInstance | null): void {
    if (inst) for (const sm of inst.skinned) sm.skeleton.dispose();
  }

  /**
   * Blade axis + tip of the held weapon in its root (hand) frame, from the geometry: the bounding-box extreme farthest
   * from the grip (FORGE ships weapons grip at the origin, blade along hand +Z, cutting edge along hand −X).
   */
  private measureBlade(root: Object3D, meshes: readonly Object3D[]): void {
    const box = new Box3();
    const inv = new Matrix4().copy(root.matrixWorld).invert();
    for (const mesh of meshes) {
      const g = (mesh as { geometry?: { boundingBox: Box3 | null; computeBoundingBox(): void } }).geometry;
      if (!g) continue;
      if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox) box.union(g.boundingBox.clone().applyMatrix4(_m.multiplyMatrices(inv, mesh.matrixWorld)));
    }
    if (box.isEmpty()) return;
    const ext = [-box.min.x, box.max.x, -box.min.y, box.max.y, -box.min.z, box.max.z];
    let best = 5;
    for (let i = 0; i < 6; i++) if ((ext[i] as number) > (ext[best] as number) + 1e-4) best = i;
    const axis = best >> 1;
    const sign = best & 1 ? 1 : -1;
    const len = Math.max(0.05, ext[best] as number);
    const tip = box.getCenter(new Vector3());
    tip.setComponent(axis, sign * len);
    const y = new Vector3().setComponent(axis, sign);
    // cutting edge: hand −X orthogonalised against the blade (hand +Y when the blade lies along X)
    const e = Math.abs(y.x) > 0.9 ? new Vector3(0, 1, 0) : new Vector3(-1, 0, 0);
    e.addScaledVector(y, -e.dot(y)).normalize();
    const x = new Vector3().crossVectors(y, e);
    const qa: number[] = [0, 0, 0, 1];
    quatFromBasis(x.x, x.y, x.z, y.x, y.y, y.z, e.x, e.y, e.z, qa, 0);
    this.bladeTip.copy(tip);
    this.bladeQ.set(qa[0] as number, qa[1] as number, qa[2] as number, qa[3] as number);
    this.bladeLen = len;
  }

  /**
   * World-space body sockets for socket-anchored skill VFX (vfx/spec/sockets.ts layout: 8 floats per socket id):
   * root (feet), hands / head / chest (bone positions, hero facing frame), weapon (blade tip, +Y along the blade).
   * Call after this frame's animation update. False when no model is loaded.
   */
  sockets(out: Float32Array): boolean {
    const inst = this.inst;
    if (!inst || !this.model) return false;
    const yaw = this.yaw;
    const p = this.position;
    writeYawSocket(out, SOCKET_ID.root * SOCKET_STRIDE, p.x, p.y, p.z, yaw);
    const sockets = this.model.asset.sockets ?? this.model.extras.sockets;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const k = HERO_RENDER_SCALE;
    for (const name of BODY_SOCKETS) {
      const bone = name === 'hand_r' && this.rightBone ? this.rightBone : inst.bones.get(sockets?.[name] ?? name);
      if (bone) {
        bone.getWorldPosition(_v);
      } else {
        const o = STAND_IN[name];
        _v.set(p.x + (cy * o[0] + sy * o[2]) * k, p.y + o[1] * k, p.z + (-sy * o[0] + cy * o[2]) * k);
      }
      writeYawSocket(out, SOCKET_ID[name] * SOCKET_STRIDE, _v.x, _v.y, _v.z, yaw);
    }
    const wo = SOCKET_ID.weapon * SOCKET_STRIDE;
    if (this.weapon) {
      _v.copy(this.bladeTip);
      this.weapon.localToWorld(_v);
      this.weapon.getWorldQuaternion(_q).multiply(this.bladeQ);
      out[wo] = _v.x;
      out[wo + 1] = _v.y;
      out[wo + 2] = _v.z;
      out[wo + 3] = this.bladeLen * k;
      out[wo + 4] = _q.x;
      out[wo + 5] = _q.y;
      out[wo + 6] = _q.z;
      out[wo + 7] = _q.w;
    } else {
      // no weapon model: a point 0.6 m ahead of the right hand, frame = facing
      const ho = SOCKET_ID.hand_r * SOCKET_STRIDE;
      writeYawSocket(out, wo, (out[ho] as number) + sy * 0.6, (out[ho + 1] as number) + 0.1, (out[ho + 2] as number) + cy * 0.6, yaw, 0.6);
    }
    return true;
  }

  private dropModel(): void {
    this.rightBone = null;
    this.weaponHold = null;
    this.bowString?.dispose();
    this.bowString = null;
    this.bowDrawHand = null;
    if (this.inst) {
      this.mixer?.stopAllAction();
      this.mixer?.uncacheRoot(this.inst.root);
      this.root.remove(this.inst.root);
      for (const m of this.flashMats) m.mat.dispose();
      this.rimSwapped.clear();
      this.flashRim?.dispose();
      this.flashRim = null;
      this.lastFlash = -1;
      for (const m of this.weaponMats) m.dispose();
      this.weaponMats = [];
      for (const m of this.bodyDepthMats) m.dispose();
      this.bodyDepthMats = [];
      for (const m of this.weaponDepthMats) m.dispose();
      this.weaponDepthMats = [];
      this.freeSkeletons(this.inst);
      this.freeSkeletons(this.weaponInst);
      this.freeSkeletons(this.offWeaponInst);
    }
    this.weaponInst = null;
    this.offWeaponInst = null;
    this.inst = null;
    this.mixer = null;
    this.idle = null;
    this.run = null;
    this.runLower = null;
    this.runUpper = null;
    this.deathAction = null;
    this.shot = null;
    this.fading = null;
    this.upperBones.clear();
    this.spineBones = [];
    this.torsoTwist = 0;
    this.upperClips.clear();
    this.weapon = null;
    this.offWeapon = null;
  }

  /** doctrine B plays the `<clip>_b` variant when the model ships one */
  private clipFor(name: string): AnimationClip | undefined {
    const map = this.model?.clipMap;
    return (this.styleB ? map?.get(`${name}_b`) : undefined) ?? map?.get(name);
  }

  private upperClipFor(clip: AnimationClip): AnimationClip | null {
    if (this.upperClips.has(clip)) return this.upperClips.get(clip) ?? null;
    const u = filterClipByBones(clip, this.upperBones, true);
    this.upperClips.set(clip, u);
    return u;
  }

  /** Fire a one-shot animation over the locomotion layer. Unknown clips are ignored. */
  trigger(name: HeroAction, speed = 1, hold = false, aimYaw?: number): void {
    const model = this.model;
    const mixer = this.mixer;
    if (!model || !mixer || this.wasDead) return;
    const clip = this.clipFor(name) ?? (name === 'attack2' ? this.clipFor('attack') : undefined);
    if (!clip) return;
    if (this.shot && !this.shot.hold && name === 'hit' && this.shot.t < this.shot.duration * 0.6) return; // don't cut a swing for a flinch
    const cut = !!this.shot; // a one-shot replacing a playing one (swing -> hit after 60 %, attack -> attack2)
    const duration = clip.duration / Math.max(speed, 0.05);
    const fades = oneShotFades(duration, this.runWeight > 0.5, cut);
    const action = mixer.clipAction(clip);
    const layerable = !hold && LAYERABLE_ACTIONS.has(name) && this.runLower !== null && this.runUpper !== null;
    const uClip = layerable ? this.upperClipFor(clip) : null;
    const upper = uClip ? mixer.clipAction(uClip) : null;
    // rig1to1 R8 (2026-11-06): the replaced one-shot fades out over the new one's fade-in instead of stopping dead (a stop dropped the arms to the
    // locomotion pose for a frame: 10 000 deg/s measured live on swing -> hit); the mixer fades its effective weight from where it stands to 0
    if (this.shot) {
      if (this.fading && this.fading.action !== this.shot.action) {
        this.fading.action.stop();
        this.fading.upper?.stop();
      }
      const prevW = Math.min(1, this.shot.action.getEffectiveWeight() + (this.shot.upper?.getEffectiveWeight() ?? 0));
      this.fading = this.shot.action === action ? null : { action: this.shot.action, upper: this.shot.upper, layerable: this.shot.layerable, w0: prevW, t: 0, dur: Math.max(fades.fadeIn, 1e-3) };
    } else if (this.fading && this.fading.action === action) {
      this.fading = null;
    }
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = speed;
    action.setEffectiveWeight(0);
    action.play();
    if (upper) {
      upper.reset();
      upper.setLoop(LoopOnce, 1);
      upper.clampWhenFinished = true;
      upper.timeScale = speed;
      upper.setEffectiveWeight(0);
      upper.play();
    }
    this.shot = {
      action,
      upper,
      layerable: layerable && upper !== null,
      t: 0,
      duration,
      fadeIn: fades.fadeIn,
      fadeOut: fades.fadeOut,
      hold,
      name,
      aimYaw,
    };
  }

  /** Seconds into the active one-shot's clip where the hit lands (from model extras), if any. */
  hitTime(name: string): number | undefined {
    return this.model?.asset.hit?.[name] ?? this.model?.extras.hit?.[name];
  }

  update(dt: number, alpha: number, feed: PlayerFeed): void {
    const core = this.core;
    const x = feed.px + (feed.x - feed.px) * alpha;
    const z = feed.pz + (feed.z - feed.pz) * alpha;
    const y = core.heightAt(x, z);
    this.position.set(x, y, z);
    this.root.position.set(x, y, z);

    const hasVel = typeof feed.vx === 'number' && typeof feed.vz === 'number' && feed.vx * feed.vx + feed.vz * feed.vz > 0.16;
    const dx = hasVel ? (feed.vx as number) : feed.x - feed.px;
    const dz = hasVel ? (feed.vz as number) : feed.z - feed.pz;
    const movingDir = !feed.dead && feed.speed > 0.4 && dx * dx + dz * dz > 1e-6;
    const moveYaw = movingDir ? Math.atan2(dx, dz) : this.yaw;

    const shot = this.shot;
    const activeAttack =
      shot !== null &&
      ATTACK_ACTIONS.has(shot.name) &&
      (shot.hold || shot.t < shot.duration * 0.85);
    const attackYaw = activeAttack ? (shot.aimYaw ?? feed.rot) : feed.rot;
    const attackDelta = movingDir && activeAttack
      ? MathUtils.euclideanModulo(attackYaw - moveYaw + Math.PI, Math.PI * 2) - Math.PI
      : 0;
    // Forward/diagonal strikes (<= 75 deg from WASD): lower body runs forward along WASD while upper spine twists onto aim.
    // Rear strikes (> 75 deg behind WASD): whole hero pivots into the strike direction and legs backpedal (negative timeScale)
    // so the weapon physically swings into the clicked VFX without forward-stride moonwalking.
    const rearAttack = movingDir && activeAttack && Math.abs(attackDelta) > MAX_TORSO_TWIST;
    const desiredYaw = !movingDir ? attackYaw : rearAttack ? attackYaw : moveYaw;
    if (!this.yawInit) {
      this.yaw = desiredYaw;
      this.yawInit = true;
    } else {
      let d = desiredYaw - this.yaw;
      d = MathUtils.euclideanModulo(d + Math.PI, Math.PI * 2) - Math.PI;
      const response = rearAttack ? ROT_ATTACK_RESPONSE : ROT_RESPONSE;
      this.yaw += d * (1 - Math.exp(-response * dt));
    }
    this.root.rotation.y = this.yaw;

    const backpedal = movingDir && Math.cos(moveYaw - this.yaw) < -0.15;
    const mixer = this.mixer;
    if (mixer) {
      this.driveAnimation(dt, feed, backpedal);
      mixer.update(dt);
      this.applyTorsoAimTwist(dt, movingDir && activeAttack && !rearAttack && shot.layerable, attackYaw);
      if (this.weaponHold && this.weapon) {
        this.weaponHold.apply(this.holdLayers, this.weapon.quaternion);
        // the off-hand instance is the mirror of the main one: the same per-clip hold, reflected
        if (this.offWeapon) syncMirrored(this.offWeapon, this.weapon);
      }
    }
    if (feed.clip !== undefined && feed.clip !== this.lastClip) {
      this.lastClip = feed.clip;
      if (feed.clip === 'victory') this.trigger('victory', 1, true);
      else if (feed.clip === 'cast') {
        if (!this.shot) this.trigger('cast');
      } else if (feed.clip !== 'idle' && feed.clip !== 'run' && feed.clip !== 'death') {
        this.trigger(feed.clip as HeroAction);
      }
    }
    this.applyFlash(feed);
    const show = !feed.dead;
    if (show !== this.overlaysShown) {
      this.overlaysShown = show;
      for (const o of this.overlays) o.visible = show;
    }
  }

  /**
   * Procedurally twists Spine / Spine1 around world +Y by the exact signed aim delta (clamped to ±75°) when executing a
   * forward/diagonal layered attack while running along WASD. Rear attacks (>75°) pivot the root instead so twist decays to 0.
   */
  private applyTorsoAimTwist(dt: number, active: boolean, aimYaw: number): void {
    const aimDelta = active ? MathUtils.euclideanModulo(aimYaw - this.yaw + Math.PI, Math.PI * 2) - Math.PI : 0;
    const targetTwist = active ? MathUtils.clamp(aimDelta, -MAX_TORSO_TWIST, MAX_TORSO_TWIST) : 0;
    this.torsoTwist += (targetTwist - this.torsoTwist) * (1 - Math.exp(-ROT_ATTACK_RESPONSE * dt));
    if (Math.abs(this.torsoTwist) < 1e-3 || this.spineBones.length === 0) return;
    const weights = this.spineBones.length >= 2 ? [0.55, 0.45] : [1];
    for (let i = 0; i < weights.length; i++) {
      const b = this.spineBones[i] as Object3D;
      const parent = b.parent;
      if (!parent) continue;
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(_qParent).invert();
      _v.set(0, 1, 0).applyQuaternion(_qParent).normalize();
      _q.setFromAxisAngle(_v, this.torsoTwist * (weights[i] as number));
      b.quaternion.premultiply(_q);
      b.updateMatrixWorld(true);
    }
  }

  /**
   * The bowstring of the frame, called by the string's own prisms right before they are drawn (BowStringRig.onSync): the nock follows the right
   * hand while the bow's shot is drawn (render/bowString.ts bowDraw: raised with the authored arm, let go at the hit), straight otherwise. The draw
   * is read from the mixer's running shot clip (the game's one-shot, or a clip a tool poses by hand), the hands from this frame's world matrices.
   */
  private syncBowString(): void {
    const rig = this.bowString;
    const bow = this.weapon;
    const hand = this.bowDrawHand;
    const mixer = this.mixer;
    if (!rig || !bow) return;
    let state: DrawState = STRING_REST;
    if (hand && mixer && !this.wasDead) {
      // the shots: attack / attack2 and (weapon-fit fix r1) the archer's cast, an authored left-hand shot since the rig-fix route (handfix BOW_SHOTS)
      for (const name of ['attack', 'attack2', 'cast'] as const) {
        const clip = this.clipFor(name);
        if (!clip) continue;
        const fullA = mixer.existingAction(clip);
        const uClip = this.upperClips.get(clip) ?? null;
        const upperA = uClip ? mixer.existingAction(uClip) : null;
        const fullW = fullA && fullA.isRunning() ? fullA.getEffectiveWeight() : 0;
        const upperW = upperA && upperA.isRunning() ? upperA.getEffectiveWeight() : 0;
        const a = upperW > fullW ? upperA : fullA;
        if (!a || Math.max(fullW, upperW) < 0.02) continue;
        const dur = Math.max(clip.duration, 1e-3);
        const hit = this.hitTime(clip.name);
        const s = bowDraw(name, Math.min(1, Math.max(0, a.time / dur)), dur, hit !== undefined ? hit / dur : undefined);
        if (s.draw > state.draw || s.sinceRelease > state.sinceRelease) state = s;
      }
    }
    poseBowString(rig, bow, hand, state);
  }

  private driveAnimation(dt: number, feed: PlayerFeed, backpedal: boolean): void {
    const moving = !feed.dead && feed.speed > 0.4;
    const target = moving ? 1 : 0;
    this.runWeight += (target - this.runWeight) * (1 - Math.exp(-LOCO_BLEND * dt));
    const runScale = MathUtils.clamp(feed.speed / REF_RUN_SPEED, 0.5, 1.8);
    const legScale = backpedal ? -runScale * 0.85 : runScale;
    if (this.run) this.run.timeScale = legScale;
    if (this.runLower) this.runLower.timeScale = legScale;
    if (this.runUpper) this.runUpper.timeScale = runScale;

    if (feed.dead && !this.wasDead) {
      this.wasDead = true;
      this.shot?.action.stop();
      this.shot?.upper?.stop();
      this.shot = null;
      this.fading?.action.stop();
      this.fading?.upper?.stop();
      this.fading = null;
      this.deathAction?.reset().setLoop(LoopOnce, 1);
      if (this.deathAction) {
        this.deathAction.clampWhenFinished = true;
        this.deathAction.play();
      }
    } else if (!feed.dead && this.wasDead) {
      this.wasDead = false;
      this.deathAction?.stop();
    }
    this.deadBlend += ((this.wasDead && this.deathAction ? 1 : 0) - this.deadBlend) * (1 - Math.exp(-14 * dt));

    const r = this.runWeight;
    const alive = 1 - this.deadBlend;
    let os = 0;
    let nonLayer = 0;
    const shot = this.shot;
    if (shot) {
      shot.t += dt;
      // a mid-run celebration (levelUp victory, hold=false) yields immediately to running when the player moves
      if (!shot.hold && shot.name === 'victory' && moving) {
        const tail = Math.min(shot.fadeOut, 0.16);
        if (shot.duration - shot.t > tail) shot.t = shot.duration - tail;
      }
      const tin = shot.fadeIn > 0 ? Math.min(1, shot.t / shot.fadeIn) : 1;
      const tout = shot.hold ? 1 : Math.min(1, Math.max(0, (shot.duration - shot.t) / Math.max(shot.fadeOut, 1e-3)));
      os = Math.min(tin, tout);
      if (shot.t >= shot.duration && !shot.hold) {
        shot.action.stop();
        shot.upper?.stop();
        this.shot = null;
        os = 0;
      } else if (shot.layerable && shot.upper) {
        // Upper-body / lower-body split while moving: arms & torso play the attack swing while legs keep running
        shot.action.setEffectiveWeight(os * (1 - r) * alive);
        shot.upper.setEffectiveWeight(os * r * alive);
      } else {
        shot.action.setEffectiveWeight(os * alive);
        nonLayer += os;
      }
    }
    let fw = 0;
    const fading = this.fading;
    if (fading) {
      fading.t += dt;
      fw = fading.w0 * Math.max(0, 1 - fading.t / fading.dur);
      if (fw <= 0) {
        fading.action.stop();
        fading.upper?.stop();
        this.fading = null;
      } else if (fading.layerable && fading.upper) {
        fading.action.setEffectiveWeight(fw * (1 - r) * alive);
        fading.upper.setEffectiveWeight(fw * r * alive);
      } else {
        fading.action.setEffectiveWeight(fw * alive);
        nonLayer += fw;
      }
    }
    const locoUpper = Math.max(0, 1 - os - fw) * alive;
    this.idle?.setEffectiveWeight(locoUpper * (1 - r));
    if (this.runLower && this.runUpper) {
      this.runLower.setEffectiveWeight(Math.max(0, 1 - nonLayer) * r * alive);
      this.runUpper.setEffectiveWeight(locoUpper * r);
    } else {
      this.run?.setEffectiveWeight(locoUpper * r);
    }
    this.deathAction?.setEffectiveWeight(this.deadBlend);
    if (this.weaponHold) {
      const L = this.holdLayers;
      L[0]![1] = locoUpper * (1 - r);
      L[1]![1] = locoUpper * r;
      L[2]![0] = this.shot?.name ?? '';
      L[2]![1] = this.shot ? os : 0;
    }
  }

  /**
   * Player hit flash (r1 2026-10-19): the old +0.85 emissive on every material made the hero a flat white ghost (albedo and
   * silhouette gone, worst on snow). Now the sim's 0.25 s linear decay is squared (a ~0.1 s punch) and drives
   *  - a weak red emissive lift (the albedo detail stays readable), and
   *  - the fresnel rim overlay (heroOutline.ts, drawn after the VFX) turning hot red-white and brighter / wider: the flash
   *    is the SILHOUETTE lighting up, the way a hit reads on a body, not a white fill.
   * The shared rim material is never edited (co-op heroes share it): the view swaps in its own copy for the flash.
   */
  private applyFlash(feed: PlayerFeed): void {
    const f = Math.round(feed.flash * 20) / 20;
    if (f === this.lastFlash) return;
    this.lastFlash = f;
    const k = f * f;
    for (const { mat, base } of this.flashMats) {
      mat.emissive.copy(base);
      // r3: NO body emissive lift at all. r2 still added +0.09 red (linear: about +80 sRGB on the albedo) and a fresnel rim that covered
      // most of the body from the 55 deg camera: the critic sampled the leg 117,104,94 -> 170,127,113 (a full-body salmon recolour).
      // The body keeps its albedo and the hurt read is the narrow rim below (silhouette edges only) + the hit sprites.
    }
    this.applyRimFlash(k);
  }

  private applyRimFlash(k: number): void {
    if (k <= 0) {
      for (const [o, mat] of this.rimSwapped) (o as unknown as { material: Material }).material = mat;
      this.rimSwapped.clear();
      return;
    }
    for (const o of this.overlays) {
      const m = (o as unknown as { material?: Material }).material;
      if (!m || m.name !== 'heroRim') {
        if (!this.rimSwapped.has(o)) continue;
      } else if (!this.rimSwapped.has(o)) {
        this.flashRim ??= m.clone();
        this.rimSwapped.set(o, m);
        (o as unknown as { material: Material }).material = this.flashRim;
      }
    }
    const u = (this.flashRim as unknown as { uniforms?: Record<string, { value: unknown }> } | null)?.uniforms;
    if (!u) return;
    const col = u.uColor?.value as { setRGB(r: number, g: number, b: number): void } | undefined;
    const w = Math.min(1, k * 1.3);
    // cool white-cyan (#bfe8ff) -> hot red-white
    col?.setRGB(0.75 + 0.25 * w, 0.91 - 0.6 * w, 1 - 0.74 * w);
    // r3: the rim stays an EDGE accent (power >= 3.2: only the silhouette band lights up; r2 went down to power 1.8 and lit most of the body)
    // r3 second pass: the first r3 frames still measured a faint red lift on the legs / vest (leg +14..+29 R at t0.05, the vest rim +40 R), so the rim gain and
    // the power drop are halved once more (the silhouette still lights up, the albedo between the edges is left alone)
    if (u.uRim) u.uRim.value = 0.55 * k;
    if (u.uPower) u.uPower.value = 4 - 0.4 * k;
  }

  /** Immediate blob shadow when real shadows are off. */
  blob(blobs: BlobShadows, strength: number): void {
    blobs.add(this.position.x, this.position.y, this.position.z, this.radius * 1.5, strength);
  }

  dispose(): void {
    this.disposed = true;
    this.loadGen++;
    this.dropModel();
    this.core.scene.remove(this.root);
  }
}

/** Owns one HeroView per player slot and feeds them each frame. */
export class Heroes implements RenderSystem {
  readonly name = 'heroes';
  readonly views: HeroView[] = [];
  /** assigned by the owner before each core.frame() */
  players: PlayerFeed[] = [];
  blobs: BlobShadows | null = null;

  constructor(private readonly core: RenderCore) {}

  async setHero(index: number, modelId: string, weaponId?: string, styleB = false): Promise<HeroView> {
    let v = this.views[index];
    if (!v) {
      v = new HeroView(this.core);
      this.views[index] = v;
    }
    await v.setModel(modelId, weaponId, styleB);
    return v;
  }

  update(dt: number, alpha: number): void {
    const shadows = this.core.quality.profile.shadows;
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      const p = this.players[i];
      if (!v || !p) continue;
      v.update(dt, alpha, p);
      if (!shadows && this.blobs) v.blob(this.blobs, 0.9);
    }
    this.updateGuard();
  }

  private readonly ndc = new Vector3();
  private readonly buf = new Vector2();

  /** VFX hero guard: screen ellipse around the local hero's body (drawing-buffer px), off when dead / absent. */
  private updateGuard(): void {
    const v = this.views[0];
    const p = this.players[0];
    if (!v || !p || p.dead) {
      setHeroGuard(0, 0, 0, 0);
      return;
    }
    const cam = this.core.camera;
    const size = this.core.renderer.getDrawingBufferSize(this.buf);
    const { x, y, z } = v.position;
    const ndc = this.ndc;
    ndc.set(x, y + v.height * 0.5, z).project(cam);
    const cx = (ndc.x * 0.5 + 0.5) * size.x;
    const cy = (ndc.y * 0.5 + 0.5) * size.y;
    ndc.set(x, y + v.height, z).project(cam);
    const halfH = Math.max(8, Math.abs((ndc.y * 0.5 + 0.5) * size.y - cy) * 1.35);
    setHeroGuard(cx, cy, halfH * 0.8, halfH);
  }

  dispose(): void {
    for (const v of this.views) v?.dispose();
    this.views.length = 0;
  }

  /** Removes all hero views (end of run). */
  clear(): void {
    for (const v of this.views) v?.dispose();
    this.views.length = 0;
  }
}


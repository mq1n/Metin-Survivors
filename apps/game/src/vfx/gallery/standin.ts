// Visible stand-in caster for compare strips / gallery casts: a mannequin whose body, arms and blade are drawn FROM the very
// socket data the effects read (spec/sockets.ts standInSockets), so what you see is where hand / weapon / head / chest anchored
// elements land: ~2 m tall (head socket 1.8 m, chest 1.4 m, hands ~1.05 m, a 0.95 m blade tip swinging from each fx event).


// proportions (1.65 - 1.8 m), the blade along the hand bone's axis, so a hand / head / weapon element lands where it does in the reference.
import { BoxGeometry, CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SET_FLOATS, SOCKET_ID, SOCKET_STRIDE, STAND_IN, samplePose, standInSockets } from '../spec/sockets';
import type { StandInPose, StandInSwing } from '../spec/types';

const MAT = new MeshStandardMaterial({ color: '#b8c4d8', roughness: 0.6, metalness: 0.2, emissive: '#102030', emissiveIntensity: 0.4 });
const BLADE_MAT = new MeshStandardMaterial({ color: '#e8eef8', roughness: 0.25, metalness: 0.8, emissive: '#203040', emissiveIntensity: 0.5 });

/** limb segments drawn from a pose's joints: [from, to, radius (m)] */
const LIMBS: ReadonlyArray<readonly [string, string, number]> = [
  ['pelvis', 'spine', 0.15], ['spine', 'neck', 0.14], ['neck', 'head', 0.05], ['shoulder_r', 'shoulder_l', 0.05], ['hip_r', 'hip_l', 0.08],
  ['shoulder_r', 'elbow_r', 0.05], ['elbow_r', 'hand_r', 0.04], ['shoulder_l', 'elbow_l', 0.05], ['elbow_l', 'hand_l', 0.04],
  ['hip_r', 'knee_r', 0.08], ['knee_r', 'ankle_r', 0.06], ['ankle_r', 'toe_r', 0.04], ['hip_l', 'knee_l', 0.08], ['knee_l', 'ankle_l', 0.06], ['ankle_l', 'toe_l', 0.04],
];

function bodyGeometry(): BufferGeometry {
  const part = (g: BufferGeometry, x: number, y: number, z: number): BufferGeometry => g.translate(x, y, z);
  const geos = [
    part(new CapsuleGeometry(0.27, 0.5, 4, 10), 0, 1.22, 0), // torso: chest socket (1.4 m) inside, hips at ~0.85 m
    part(new SphereGeometry(0.17, 12, 10), 0, STAND_IN.head[1] - 0.02, 0.02), // head around the head socket
    part(new CapsuleGeometry(0.1, 0.62, 3, 8), -0.14, 0.42, 0), // legs
    part(new CapsuleGeometry(0.1, 0.62, 3, 8), 0.14, 0.42, 0),
  ];
  const g = mergeGeometries(geos, false);
  for (const x of geos) x.dispose();
  g.computeVertexNormals();
  return g;
}

/** one arm / blade segment: a box from (0,0,0) along +Y of length 1 (scaled / oriented per frame) */
function segment(w: number, d: number): BoxGeometry {
  const g = new BoxGeometry(w, 1, d);
  g.translate(0, 0.5, 0);
  return g;
}

export class StandInBody {
  readonly group = new Group();
  private readonly body = new Mesh(bodyGeometry(), MAT);
  private readonly armR = new Mesh(segment(0.09, 0.09), MAT);
  private readonly armL = new Mesh(segment(0.09, 0.09), MAT);
  private readonly blade = new Mesh(segment(0.05, 0.012), BLADE_MAT);
  /** the 8 socket entries of player 0 (the same numbers vfx.standIn feeds the effects) */
  readonly sock = new Float32Array(SET_FLOATS);
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  /** pose mannequin: one cylinder per LIMBS entry + a head ball (built on the first pose) */
  private limbs: Mesh[] | null = null;
  private headBall: Mesh | null = null;
  private readonly jt = new Float32Array(3);

  constructor() {
    this.group.add(this.body, this.armR, this.armL, this.blade);
    for (const m of [this.armR, this.armL, this.blade]) m.matrixAutoUpdate = true;
    this.group.visible = false;
  }

  /** stands the body at (x, y, z) facing `yaw` (0 = +Z, π/2 = +X) and draws the arms / blade of the swing `t` s in; with a `pose`
   *  (joints) the mannequin is drawn from them and `t` is seconds into the pose clip */
  place(x: number, y: number, z: number, yaw: number, t: number, mirror = 1, swing?: StandInSwing, pose?: StandInPose): void {
    standInSockets(this.sock, 0, x, y, z, yaw, t, mirror, swing, pose);
    this.group.visible = true;
    const s = this.sock;
    if (pose?.joints) this.drawPose(pose, t, x, y, z, yaw);
    else {
      if (this.limbs) {
        for (const l of this.limbs) l.visible = false;
        (this.headBall as Mesh).visible = false;
      }
      this.body.visible = this.armR.visible = this.armL.visible = true;
      this.body.position.set(x, y, z);
      this.body.rotation.set(0, yaw, 0);
      const pos = (id: number, out: Vector3): Vector3 => out.set(s[id * SOCKET_STRIDE] as number, s[id * SOCKET_STRIDE + 1] as number, s[id * SOCKET_STRIDE + 2] as number);
      const cy = Math.cos(yaw), sy = Math.sin(yaw), m = mirror < 0 ? -1 : 1;
      const shoulder = (lx: number, out: Vector3): Vector3 => out.set(x + cy * lx * m, y + 1.52, z - sy * lx * m);
      this.arm(this.armR, shoulder(-0.3, this.a), pos(SOCKET_ID.hand_r, this.b));
      this.arm(this.armL, shoulder(0.3, this.a), pos(SOCKET_ID.hand_l, this.b));
    }
    // blade: grip (hand_r) → tip (weapon socket), edge along the socket's +Z
    const w = SOCKET_ID.weapon * SOCKET_STRIDE;
    const len = Math.max(0.05, s[w + 3] as number);
    this.q.set(s[w + 4] as number, s[w + 5] as number, s[w + 6] as number, s[w + 7] as number);
    const axis = this.b.copy(this.up).applyQuaternion(this.q);
    this.blade.position.set(s[w] as number - axis.x * len, s[w + 1] as number - axis.y * len, s[w + 2] as number - axis.z * len);
    this.blade.quaternion.copy(this.q);
    this.blade.scale.set(1, len, 1);
  }

  private arm(mesh: Mesh, from: Vector3, to: Vector3): void {
    const d = to.clone().sub(from);
    const len = d.length();
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(this.up, d.divideScalar(len || 1));
    mesh.scale.set(1, Math.max(0.01, len), 1);
  }

  private ensureLimbs(): Mesh[] {
    if (!this.limbs) {
      const cyl = new CylinderGeometry(1, 1, 1, 8);
      cyl.translate(0, 0.5, 0);
      this.limbs = LIMBS.map(() => new Mesh(cyl, MAT));
      this.headBall = new Mesh(new SphereGeometry(1, 12, 10), MAT);
      this.group.add(...this.limbs, this.headBall);
    }
    return this.limbs;
  }

  /** world position of drawing joint `name` of the pose at clip time t (null: the pose has no such joint) */
  private joint(pose: StandInPose, name: string, t: number, x: number, y: number, z: number, cy: number, sy: number, out: Vector3): Vector3 | null {
    const tr = pose.joints?.[name];
    if (!tr) return null;
    samplePose(tr, 3, pose.n, pose.fps, t, this.jt);
    const lx = this.jt[0] as number, ly = this.jt[1] as number, lz = this.jt[2] as number;
    return out.set(x + cy * lx + sy * lz, y + ly, z - sy * lx + cy * lz);
  }

  /** draws the pose mannequin (limbs between the pose's joints); the default torso / arms are hidden */
  private drawPose(pose: StandInPose, t: number, x: number, y: number, z: number, yaw: number): void {
    const limbs = this.ensureLimbs();
    this.body.visible = this.armR.visible = this.armL.visible = false;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const a = new Vector3(), b = new Vector3();
    LIMBS.forEach(([from, to, r], i) => {
      const m = limbs[i] as Mesh;
      const pa = this.joint(pose, from, t, x, y, z, cy, sy, a), pb = this.joint(pose, to, t, x, y, z, cy, sy, b);
      m.visible = pa !== null && pb !== null;
      if (pa && pb) this.limb(m, pa, pb, r);
    });
    const head = this.joint(pose, 'head', t, x, y, z, cy, sy, a), top = this.joint(pose, 'headTop', t, x, y, z, cy, sy, b);
    const ball = this.headBall as Mesh;
    ball.visible = head !== null;
    if (head) {
      ball.position.copy(top ? head.clone().lerp(top, 0.6) : head.clone().add(new Vector3(0, 0.1, 0)));
      ball.scale.setScalar(top ? Math.max(0.09, head.distanceTo(top) * 0.8) : 0.12);
    }
  }

  private limb(mesh: Mesh, from: Vector3, to: Vector3, r: number): void {
    const d = to.clone().sub(from);
    const len = d.length();
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(this.up, d.divideScalar(len || 1));
    mesh.scale.set(r, Math.max(0.01, len), r);
  }

  hide(): void {
    this.group.visible = false;
  }
}

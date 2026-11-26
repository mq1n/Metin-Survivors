import { type Mat4, type Quat, type Vec3, QIDENT, m4fromQuat, m4mul, m4rigidInverse, m4translation, qmul, qrotate, vadd, vsub } from '../math.ts';

export interface BoneSpec {
  name: string;
  /** parent bone name, null for the single root */
  parent: string | null;
  /** WORLD rest position of the joint (rest rotations are identity everywhere) */
  pos: Vec3;
  /** helper bone that carries no skin weights (sockets such as `muzzle`, `back`) */
  helper?: boolean;
}

/** Local pose: rotation per bone (relative to rest) and optional translation offsets (added to the rest offset). */
export interface Pose {
  rot: Quat[];
  /** translation offsets (local to parent) per bone; only a few bones normally have one (root, pelvis) */
  pos: Vec3[];
  /** optional per-bone local scale (absent = 1). `fk`/`skinMatrices` ignore it; it only reaches the GLB scale channel */
  scale?: Vec3[];
}

/**
 * Skeleton with identity rest rotations: every bone's local translation is simply `pos - parent.pos`, and
 * clips are pure rotation deltas. That keeps authoring (IK, gaits, actions) simple and the GLB tiny.
 */
export class Skeleton {
  readonly bones: BoneSpec[];
  readonly parent: Int32Array;
  readonly names: string[];
  private nameIdx = new Map<string, number>();
  /** local rest offsets */
  readonly offset: Vec3[];

  constructor(bones: BoneSpec[]) {
    this.bones = bones;
    this.names = bones.map((b) => b.name);
    bones.forEach((b, i) => this.nameIdx.set(b.name, i));
    this.parent = new Int32Array(bones.length);
    this.offset = [];
    bones.forEach((b, i) => {
      if (b.parent === null) {
        this.parent[i] = -1;
        this.offset.push([...b.pos] as Vec3);
      } else {
        const p = this.nameIdx.get(b.parent);
        if (p === undefined) throw new Error(`bone ${b.name}: unknown parent ${b.parent}`);
        if (p >= i) throw new Error(`bone ${b.name}: parent must be declared before child`);
        this.parent[i] = p;
        this.offset.push(vsub(b.pos, bones[p]!.pos));
      }
    });
    if (bones.filter((b) => b.parent === null).length !== 1) throw new Error('skeleton needs exactly one root');
  }

  get count(): number {
    return this.bones.length;
  }

  idx(name: string): number {
    const i = this.nameIdx.get(name);
    if (i === undefined) throw new Error(`unknown bone ${name}`);
    return i;
  }

  has(name: string): boolean {
    return this.nameIdx.has(name);
  }

  restPos(nameOrIdx: string | number): Vec3 {
    const i = typeof nameOrIdx === 'string' ? this.idx(nameOrIdx) : nameOrIdx;
    return this.bones[i]!.pos;
  }

  children(i: number): number[] {
    const out: number[] = [];
    for (let j = 0; j < this.count; j++) if (this.parent[j] === i) out.push(j);
    return out;
  }

  /** bone indices that may receive skin weights */
  deformingBones(): number[] {
    return this.bones.map((b, i) => (b.helper ? -1 : i)).filter((i) => i >= 0);
  }

  restPose(): Pose {
    return { rot: this.bones.map(() => QIDENT), pos: this.bones.map(() => [0, 0, 0] as Vec3) };
  }

  /** world rotation and position of every bone for a pose */
  fk(pose: Pose): { rot: Quat[]; pos: Vec3[] } {
    const rot: Quat[] = new Array(this.count);
    const pos: Vec3[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const p = this.parent[i]!;
      const lp = vadd(this.offset[i]!, pose.pos[i]!);
      if (p < 0) {
        rot[i] = pose.rot[i]!;
        pos[i] = lp;
      } else {
        rot[i] = qmul(rot[p]!, pose.rot[i]!);
        pos[i] = vadd(pos[p]!, qrotate(rot[p]!, lp));
      }
    }
    return { rot, pos };
  }

  /** inverse bind matrices (glTF `inverseBindMatrices`) */
  inverseBind(): Mat4[] {
    return this.bones.map((b) => m4rigidInverse(m4translation(b.pos)));
  }

  /** skinning matrices world * inverseBind per bone, for CPU skinning / validation */
  skinMatrices(pose: Pose): Mat4[] {
    const w = this.fk(pose);
    const ibm = this.inverseBind();
    return this.bones.map((_, i) => m4mul(m4fromQuat(w.rot[i]!, w.pos[i]!), ibm[i]!));
  }
}

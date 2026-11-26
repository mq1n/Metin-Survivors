// Build context: wraps the Body with bone-aware helpers so body parts and outfit pieces stay terse.
import { type Quat, type Vec3, basisFromDirSide, qfromBasis, vnorm } from '../../../core/math.ts';
import { Noise } from '../../../core/noise.ts';
import { Body, type PartOpts } from '../../../core/sdf/body.ts';
import type { Sdf } from '../../../core/sdf/node.ts';
import type { Skeleton } from '../../../core/skin/skeleton.ts';
import type { Anatomy } from '../anatomy.ts';
import type { Side } from '../params.ts';
import type { RigLayout } from '../skeleton.ts';

export interface AddOpts {
  /** tags: material first ('skin' | 'cloth' | 'leather' | 'plate' | 'lacquer' | 'gold' | 'hair' | ...), then feature tags */
  tags?: string[];
  /** blend width into the body so far (metres) */
  w?: number;
  /** skin stiffness (>1 sticks to its bone: rigid plates, helmets) */
  grip?: number;
}

export class Ctx {
  readonly body = new Body();
  readonly noise: Noise;
  /** paint-only trim bands collected by pieces: gold / edge highlight regions */
  constructor(
    readonly a: Anatomy,
    readonly sk: Skeleton,
    readonly layout: RigLayout,
    seed: number | string,
  ) {
    this.noise = new Noise(seed);
  }

  /** base-stage part */
  add(name: string, sdf: Sdf, bone: string, o: AddOpts = {}): this {
    const po: PartOpts = { bone, ...(o.tags ? { tags: o.tags } : {}), ...(o.w !== undefined ? { w: o.w } : {}), ...(o.grip !== undefined ? { grip: o.grip } : {}) };
    this.body.add(name, sdf, po);
    return this;
  }

  cut(name: string, sdf: Sdf, bone: string, o: AddOpts = {}): this {
    const po: PartOpts = { bone, ...(o.tags ? { tags: o.tags } : {}), ...(o.w !== undefined ? { w: o.w } : {}) };
    this.body.cut(name, sdf, po);
    return this;
  }

  late(name: string, sdf: Sdf, bone: string, o: AddOpts = {}): this {
    const po: PartOpts = { bone, ...(o.tags ? { tags: o.tags } : {}), ...(o.w !== undefined ? { w: o.w } : {}), ...(o.grip !== undefined ? { grip: o.grip } : {}) };
    this.body.addLate(name, sdf, po);
    return this;
  }

  /** paint-only region */
  mark(name: string, sdf: Sdf, tags: string[]): this {
    this.body.mark(name, sdf, tags);
    return this;
  }

  /** reserve a paint piece for hook-added geometry: add parts with tags `[piece.tag]` (trim marks with `[piece.trimTag]`); `mat` is a palette key */
  nextPiece = 100;
  /** pieces registered by hooks (painted after the outfit pieces) */
  readonly extraPieces: { i: number; id: string; mat: string; o: Record<string, number | string | boolean> }[] = [];
  piece(mat: string, o: Record<string, number | string | boolean> = {}): { i: number; tag: string; trimTag: string } {
    const i = this.nextPiece++;
    this.extraPieces.push({ i, id: `hook${i}`, mat, o });
    return { i, tag: `p${i}`, trimTag: `t${i}` };
  }

  /** add a left and a right copy: `make(sx)` builds the (world-space) shape for a side; bone = `${bone}_l|r` */
  both(name: string, make: (sx: Side) => Sdf, bone: string, o: AddOpts = {}): this {
    for (const sx of [1, -1] as Side[]) {
      const n = sx === 1 ? 'l' : 'r';
      this.add(`${name}_${n}`, make(sx), this.sk.has(bone) ? bone : `${bone}_${n}`, o);
    }
    return this;
  }

  bothLate(name: string, make: (sx: Side) => Sdf, bone: string, o: AddOpts = {}): this {
    for (const sx of [1, -1] as Side[]) {
      const n = sx === 1 ? 'l' : 'r';
      this.late(`${name}_${n}`, make(sx), this.sk.has(bone) ? bone : `${bone}_${n}`, o);
    }
    return this;
  }

  bothMark(name: string, make: (sx: Side) => Sdf, tags: string[]): this {
    for (const sx of [1, -1] as Side[]) this.mark(`${name}_${sx === 1 ? 'l' : 'r'}`, make(sx), tags);
    return this;
  }
}

/** rotation taking local (x, y, z) to a frame whose Y axis follows `dir` and X is as close to `side` as possible */
export function frameQ(dir: Vec3, side: Vec3): Quat {
  const b = basisFromDirSide(vnorm(dir), side);
  return qfromBasis(b.x, b.y, b.z);
}

export function frameBasis(dir: Vec3, side: Vec3): { x: Vec3; y: Vec3; z: Vec3 } {
  return basisFromDirSide(vnorm(dir), side);
}

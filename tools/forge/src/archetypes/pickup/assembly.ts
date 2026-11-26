// Assembly: collects parts into one HardMesh, stamping every triangle with group = bone * 256 + zone. Parts can also be recorded as
// convex covers (their face planes) so the build removes the faces they hide (see clip.ts).
import { HardMesh } from '../../core/hard/hardmesh.ts';
import type { Mat4 } from '../../core/math.ts';
import { type Cover, coverOf } from './clip.ts';

/** false: decor, never hides anything; 'drop': hides the faces of other parts that lie fully inside it; 'clip': also cuts partly covered faces exactly */
export type CoverMode = false | 'drop' | 'clip';

export class Assembly {
  readonly mesh = new HardMesh();
  /** convex solids recorded as covers */
  readonly covers: Cover[] = [];

  /** @param mode default cover mode of `add` (parts recorded as covers must be closed convex solids) */
  constructor(private readonly mode: CoverMode = false) {}

  /** add a part (group-0 triangles) under `zone` (1..255) on `bone` (0 = root, 1 = lid) */
  add(part: HardMesh, zone: number, m?: Mat4, bone = 0, mode: CoverMode = this.mode): this {
    const from = this.mesh.tris.length;
    this.mesh.group = bone * 256 + zone;
    part.appendTo(this.mesh, m);
    this.mesh.group = 0;
    if (mode) {
      const c = coverOf(this.mesh.tris, from, this.mesh.tris.length, bone, mode === 'clip');
      if (c) this.covers.push(c);
    }
    return this;
  }

  /** add several parts that share zone/bone/transform */
  addAll(parts: readonly HardMesh[], zone: number, m?: Mat4, bone = 0, mode: CoverMode = this.mode): this {
    for (const p of parts) this.add(p, zone, m, bone, mode);
    return this;
  }
}

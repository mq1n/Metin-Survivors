import type { Sdf } from './node.ts';
import { type Field, Displace, SmoothSubtract, SmoothUnion, type UnionChild } from './ops.ts';

export interface PartOpts {
  /** skeleton bone this primitive follows (skin weights are derived from it) */
  bone: string;
  /** blend width into the body so far (metres). Defaults to `Body.blend`. */
  w?: number;
  /** paint / selection region tags, e.g. 'muzzle', 'ear', 'paw' */
  tags?: string[];
  /** skin stiffness: >1 makes the bone grab its neighbourhood more tightly (rigid heads, hooves) */
  grip?: number;
}

export interface Part extends PartOpts {
  name: string;
  sdf: Sdf;
  stage: 'base' | 'cut' | 'late' | 'mark';
  w: number;
}

/**
 * A body is an ordered list of named SDF parts. Stages:
 *   base - smooth-unioned in insertion order (torso, limbs, head, tufts...)
 *   cut  - smooth-subtracted afterwards (eye sockets, mouth slit, nostrils, nail grooves)
 *   [displacement fields applied to base+cut]
 *   late - unioned last, not displaced (eyeballs, teeth, claws, gems)
 * Parts carry their bone (skinning) and tags (painting).
 */
export class Body {
  parts: Part[] = [];
  /** default blend width */
  blend = 0.03;
  private displacements: { field: Field; amp: number }[] = [];
  private built: Sdf | null = null;
  private builtSmooth: Sdf | null = null;

  add(name: string, sdf: Sdf, opts: PartOpts): this {
    this.parts.push({ name, sdf, stage: 'base', w: opts.w ?? this.blend, ...opts });
    this.built = null;
    this.builtSmooth = null;
    return this;
  }

  /** subtract; `bone` only matters for skin of nearby vertices (usually the host bone) */
  cut(name: string, sdf: Sdf, opts: PartOpts): this {
    this.parts.push({ name, sdf, stage: 'cut', w: opts.w ?? 0.01, ...opts });
    this.built = null;
    this.builtSmooth = null;
    return this;
  }

  addLate(name: string, sdf: Sdf, opts: PartOpts): this {
    this.parts.push({ name, sdf, stage: 'late', w: opts.w ?? 0.006, ...opts });
    this.built = null;
    this.builtSmooth = null;
    return this;
  }

  /** paint-only region (no geometry, no skin): e.g. a pupil or a scar line at a given place */
  mark(name: string, sdf: Sdf, tags: string[]): this {
    this.parts.push({ name, sdf, stage: 'mark', w: 0, bone: '', tags });
    return this;
  }

  displace(field: Field, amp: number): this {
    this.displacements.push({ field, amp });
    this.built = null;
    this.builtSmooth = null;
    return this;
  }

  /** The final SDF used for meshing, normals, AO. `smooth: true` skips the displacement fields (for reprojection / relaxation). */
  sdf(smooth = false): Sdf {
    const cached = smooth ? this.builtSmooth : this.built;
    if (cached) return cached;
    const base = this.parts.filter((p) => p.stage === 'base');
    if (base.length === 0) throw new Error('Body has no base parts');
    let s: Sdf = new SmoothUnion(base.map((p): UnionChild => ({ node: p.sdf, w: p.w })));
    const cuts = this.parts.filter((p) => p.stage === 'cut');
    if (cuts.length) s = new SmoothSubtract(s, cuts.map((p): UnionChild => ({ node: p.sdf, w: p.w })));
    if (!smooth) for (const d of this.displacements) s = new Displace(s, d.field, d.amp);
    const late = this.parts.filter((p) => p.stage === 'late');
    if (late.length) s = new SmoothUnion([{ node: s, w: 0.01 }, ...late.map((p): UnionChild => ({ node: p.sdf, w: p.w }))]);
    if (smooth) this.builtSmooth = s;
    else this.built = s;
    return s;
  }

  /** sdfs per bone (skin sources): base + late parts only */
  boneSources(): Map<string, { sdf: Sdf; grip: number }[]> {
    const m = new Map<string, { sdf: Sdf; grip: number }[]>();
    for (const p of this.parts) {
      if (p.stage === 'cut' || p.stage === 'mark') continue;
      const arr = m.get(p.bone) ?? [];
      arr.push({ sdf: p.sdf, grip: p.grip ?? 1 });
      m.set(p.bone, arr);
    }
    return m;
  }

  /** sdfs carrying a paint tag (cut parts too: a tagged cutter marks the carved surface, e.g. the lip line) */
  tagged(tag: string): Sdf[] {
    return this.parts.filter((p) => p.tags?.includes(tag)).map((p) => p.sdf);
  }

  partsByName(prefix: string): Part[] {
    return this.parts.filter((p) => p.name.startsWith(prefix));
  }
}

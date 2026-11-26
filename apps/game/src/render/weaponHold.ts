// Per-clip weapon hold (statictripo r4, 2026-10-27): a held weapon GLB may carry `extras.weapon.clipHold` = { <clip>: [rx, ry, rz] } (degrees, Euler XYZ,
// a rotation of the weapon root about the grip in the hand-socket frame, ON TOP of the GLB's own static hold). The hero view blends the rotations of

// clips that were authored for a thin stick bow. Weapons without the table keep today's static hold exactly (nothing is touched).

import { Euler, MathUtils, Quaternion } from 'three';

export type ClipHoldTable = Readonly<Record<string, readonly [number, number, number]>>;

const _e = new Euler();
const _q = new Quaternion();

export class WeaponHold {
  private readonly q = new Map<string, Quaternion>();

  /** `base` = the weapon root's own local rotation (kept: the blend multiplies onto it) */
  constructor(table: ClipHoldTable, readonly base: Quaternion) {
    for (const [clip, r] of Object.entries(table)) {
      if (!Array.isArray(r) || r.length !== 3 || !r.every((x) => Number.isFinite(x))) continue;
      this.q.set(clip, new Quaternion().setFromEuler(_e.set(r[0] * MathUtils.DEG2RAD, r[1] * MathUtils.DEG2RAD, r[2] * MathUtils.DEG2RAD, 'XYZ')));
    }
  }

  /** the table of a weapon model's scene extras (`extras.weapon.clipHold`), or null when it has none (every weapon before r4) */
  static from(extras: unknown, base: Quaternion): WeaponHold | null {
    const t = (extras as { weapon?: { clipHold?: unknown } } | null | undefined)?.weapon?.clipHold;
    if (!t || typeof t !== 'object') return null;
    const h = new WeaponHold(t as ClipHoldTable, base);
    return h.q.size ? h : null;
  }

  /** clips with an entry */
  get clips(): string[] {
    return [...this.q.keys()];
  }

  /**
   * Weighted blend of the per-clip rotations of the active layers ([clip, weight] pairs; a clip without an entry counts as no rotation), written as
   * base * blend into `out` (the weapon root's local quaternion). Normalised linear blend in one hemisphere: the per-clip rotations are small (<= ~30 deg).
   */
  apply(layers: readonly (readonly [string, number])[], out: Quaternion): Quaternion {
    let x = 0, y = 0, z = 0, w = 0, tot = 0;
    for (const [clip, wt] of layers) {
      if (!(wt > 0)) continue;
      const q = this.q.get(clip);
      const qx = q?.x ?? 0, qy = q?.y ?? 0, qz = q?.z ?? 0, qw = q?.w ?? 1;
      const s = qx * x + qy * y + qz * z + qw * w < 0 ? -wt : wt;
      x += qx * s; y += qy * s; z += qz * s; w += qw * s;
      tot += wt;
    }
    if (tot <= 0) return out.copy(this.base);
    _q.set(x, y, z, w);
    if (_q.lengthSq() < 1e-12) _q.identity(); else _q.normalize();
    return out.copy(this.base).multiply(_q);
  }
}

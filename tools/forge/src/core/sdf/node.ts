import type { Aabb } from '../math.ts';

/**
 * Signed-distance-field node. Negative inside, positive outside, ~metres.
 *
 * Every node carries a conservative Lipschitz bound `lip` (|d(p) - d(q)| <= lip * |p - q|). The mesher uses it
 * to build a *bounding hierarchy on demand*: `restrict(ball)` returns an equivalent but cheaper tree that is
 * only valid for queries inside the ball (unions drop children that provably cannot influence the ball).
 * Coarse octree cells therefore evaluate the whole creature while leaf cells evaluate a handful of primitives.
 */
export abstract class Sdf {
  /** Lipschitz upper bound for the field. */
  lip = 1;
  private _bounds: Aabb | null = null;

  abstract d(x: number, y: number, z: number): number;

  /** AABB of the solid {d <= 0}. */
  protected abstract computeBounds(): Aabb;

  bounds(): Aabb {
    return (this._bounds ??= this.computeBounds());
  }

  /** Equivalent tree for queries inside ball(c, r). Default: no pruning possible. */
  restrict(_cx: number, _cy: number, _cz: number, _r: number): Sdf {
    return this;
  }

  /** gradient by central differences */
  grad(x: number, y: number, z: number, h = 0.004): [number, number, number] {
    const gx = this.d(x + h, y, z) - this.d(x - h, y, z);
    const gy = this.d(x, y + h, z) - this.d(x, y - h, z);
    const gz = this.d(x, y, z + h) - this.d(x, y, z - h);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  }
}

/** Arbitrary field wrapped as a node (escape hatch for one-off shapes). */
export class FnSdf extends Sdf {
  constructor(
    private fn: (x: number, y: number, z: number) => number,
    private box: Aabb,
    lip = 1,
  ) {
    super();
    this.lip = lip;
  }
  d(x: number, y: number, z: number): number {
    return this.fn(x, y, z);
  }
  protected computeBounds(): Aabb {
    return this.box;
  }
}

/** polynomial (cubic) smooth minimum: C2 continuous, finite support `w` */
export function smin(a: number, b: number, w: number): number {
  const diff = a > b ? a - b : b - a;
  const m = a < b ? a : b;
  if (diff >= w) return m;
  const h = (w - diff) / w;
  return m - (h * h * h * w) / 6;
}

export function smax(a: number, b: number, w: number): number {
  const diff = a > b ? a - b : b - a;
  const m = a > b ? a : b;
  if (diff >= w) return m;
  const h = (w - diff) / w;
  return m + (h * h * h * w) / 6;
}

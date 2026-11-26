// Shared hook for presets that start a signature (elemental) effect with explicit effect params.
import type { Ctx, Fx } from '../emit';

/**
 * Starts the signature effect `kind` from the spawn context with effect params `a`, `b` (and optionally another `radius`),
 * leaving the preset's own `a` / `b` / `radius` untouched for the batched recipe that runs around it. Returns false when the
 * tier does not run it, the budget / pool is exhausted or the effect refuses: the preset then plays its batched recipe.
 */
export function castEl(fx: Fx, kind: string, c: Ctx, a: number, b: number, radius: number = c.radius): boolean {
  const el = fx.el;
  if (el === null) return false;
  const pa = c.a;
  const pb = c.b;
  const pr = c.radius;
  c.a = a;
  c.b = b;
  c.radius = radius;
  const taken = el.cast(kind, c);
  c.a = pa;
  c.b = pb;
  c.radius = pr;
  return taken;
}

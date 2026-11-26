// Heavy one-handed blade baked into the enemy mesh: wide slightly up-curved sabre, round guard, wrapped grip, pommel.
// Modelled in the REST hand frame (kit.ts `hp`): the blade runs along the grip axis +Z in front of the fist, the edges point up / down
// (hand +y / -y) and the flats face the palm normal, so the IK-aimed hand carries it edge-first.
import type { Vec3 } from '../../core/math.ts';
import type { Anatomy, Ctx } from '../humanoid/index.ts';
import { type HandN, ball, bar, cylinder, disc, handRef, hp, leaf, rigid, rod } from './kit.ts';

export interface BladeOpts {
  hand?: HandN;
  /** blade length from the guard (m) */
  len?: number;
  /** half width (m) and half thickness (m); thin features need >= 1.5 voxels */
  halfW?: number;
  halfT?: number;
  /** tip rise (m) above the straight line: the up-curve of a sabre */
  curve?: number;
  mats: { metal: string; leather: string; gold: string };
}

export function addBlade(ctx: Ctx, a: Anatomy, o: BladeOpts): void {
  const h = handRef(a, o.hand ?? 'r');
  const s = a.s;
  const metal = ctx.piece(o.mats.metal), leather = ctx.piece(o.mats.leather), gold = ctx.piece(o.mats.gold);
  const len = (o.len ?? 0.92) * s, hw = (o.halfW ?? 0.05) * s, ht = (o.halfT ?? 0.0165) * s, rise = (o.curve ?? 0.035) * s;
  // wrapped grip, round guard, pommel
  rigid(ctx, 'blade_grip', cylinder(hp(h, 0, 0, -0.115 * s), hp(h, 0, 0, 0.09 * s), 0.0225 * s, 0.006), h.bone, [leather.tag], 0.004);
  rigid(ctx, 'blade_pommel', ball(hp(h, 0, 0, -0.13 * s), 0.031 * s), h.bone, [gold.tag], 0.004);
  rigid(ctx, 'blade_guard', disc(hp(h, 0, 0, 0.1 * s), [0, 0, 1], 0.058 * s, 0.017 * s, 0.006), h.bone, [gold.tag], 0.004);
  // blade: straight body + tapering tip raised by `rise`, thick spine along the upper edge
  const z0 = 0.115 * s, zBody = z0 + len * 0.78, zTip = z0 + len;
  const p = (z: number, y: number): Vec3 => hp(h, 0, y, z);
  rigid(ctx, 'blade_body', bar(p(z0, 0), p(zBody, rise * 0.45), hw, ht, [0, 1, 0], 0.004), h.bone, [metal.tag], 0.003);
  rigid(ctx, 'blade_tip', leaf(p(zBody - 0.03 * s, rise * 0.4), p(zTip, rise), hw, ht, [1, 0, 0]), h.bone, [metal.tag], 0.003);
  rigid(ctx, 'blade_spine', rod(p(z0, hw * 0.92), p(zBody, hw * 0.92 + rise * 0.45), 0.0175 * s, 0.016 * s), h.bone, [metal.tag], 0.003);
}

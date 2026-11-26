// Projectile launch accents, orbitals, buffs, summons, heal and level-up (owner: VfxCast).
// Legacy barrel since the C0 ownership split: [proj.*] → vfx/common/enemy-projectiles, [buff.*, burst.*, summon.*] → vfx/common/player-feedback, [aura.*, buff.*, heal.*, holy.*, levelup.*] → vfx/common/levelup-heal. CAST_PRESETS keeps the original ids and
// order for presets/index.ts, tests and tools.

import { ENEMY_PROJECTILES } from '../common/enemy-projectiles';
import { LEVELUP_HEAL } from '../common/levelup-heal';
import { PLAYER_FEEDBACK } from '../common/player-feedback';
import { pickPresets } from '../common/registry';
import type { Ctx, Fx } from '../emit';
import { PALETTES } from '../palette';
import type { Inst } from '../system';
import { mixHex } from '../util';
import { FB, FO, M, PAT, SC, SPR, TAU, dustRing, embers, fireBurst, flash, glow, haloRing, shockRing, smoke, sparks, wisps } from './kit';
import type { PresetDef } from './types';

/** muzzle height above the caster's feet */
const HAND = 1.05;

/** heading (dx,dz) rotated by `a` radians → (TX, TZ) */
let TX = 0;

let TZ = 0;

function turn(dx: number, dz: number, a: number): void {
  const ca = Math.cos(a), sa = Math.sin(a);
  TX = dx * ca + dz * sa;
  TZ = dz * ca - dx * sa;
}

/** colour bloom + hot core + pop burst + lens flare + forward ray fan: the first 0.15 s of every launch / cast */
function launchCore(fx: Fx, c: Ctx, x: number, y: number, z: number, size: number, fan = 1): void {
  const p = c.pal;
  const k = c.intensity;
  const rng = fx.rng;
  glow(fx, x, y, z, size * 2.4, size * 0.9, 0.34, p.main, 0.9, 1.7 * k);
  flash(fx, x, y, z, size * 0.6, size * 0.18, 0.1, p.core, 2.6 * k);
  fx.add.at(x, y, z).size(size * 0.8, size * 1.9).life(0.14).col(p.main, 1, p.edge, 0).int(2.2 * k).spr(SPR.burst).rot(rng.f() * TAU).fade(0, FO.quad).emit();
  fx.add.at(x, y, z).size(size * 2.6, size * 0.9).life(0.18).col(p.core, 1, p.main, 0).int(1.8 * k).spr(SPR.flare).rot(Math.atan2(-c.dz, c.dx) + rng.s2(0.15)).fade(0, FO.cubic).emit();
  if (fan > 0) {
    fx.add.at(x + c.dx * size * 1.1 * fan, y, z + c.dz * size * 1.1 * fan).size(size * 2.2 * fan, size * 3.2 * fan).life(0.17).col(p.main, 1, p.edge, 0).int(2.0 * k)
      .spr(SPR.rays).rot(Math.atan2(-c.dx, -c.dz)).fade(0, FO.quad).emit();
  }
}

/** comet bullets: velocity-stretched streaks racing out along the heading */
function lances(fx: Fx, c: Ctx, x: number, y: number, z: number, n: number, width: number, vMin: number, vMax: number, len: number, life: number, spread = 0.05): void {
  const rng = fx.rng;
  const p = c.pal;
  for (let i = 0; i < n; i++) {
    turn(c.dx, c.dz, rng.s2(spread));
    const v = rng.r(vMin, vMax);
    fx.add.at(x, y + rng.s2(0.08), z).vel(TX * v, 0, TZ * v).size(width * (i === 0 ? 1 : rng.r(0.4, 0.7)), width * 0.3).stretch(len / v).life(life * rng.r(0.8, 1.1))
      .col(i === 0 ? p.core : p.main, 1, p.edge, 0).int(2.6 * c.intensity).spr(SPR.streak).mode(M.streak).fade(0, FO.cubic).emit();
  }
}

/** crisp streak ribbons along the heading starting just ahead of the muzzle (thin bright tip, wide faded tail) */
function speedLines(fx: Fx, c: Ctx, x: number, y: number, z: number, n: number, l0: number, l1: number, w: number, life: number, spread = 0.35, int = 1.8): void {
  const rng = fx.rng;
  const p = c.pal;
  const lx = c.dz, lz = -c.dx;
  for (let i = 0; i < n; i++) {
    const off = rng.s2(spread), dy = rng.s2(spread * 0.6);
    const a = rng.r(0.15, 0.6), b = a + rng.r(l0, l1);
    fx.rb.width(w * rng.r(0.7, 1.3)).life(life * rng.r(0.8, 1.2)).col(p.core, p.main).int(int * c.intensity).style_(2).fade(FO.quad).delay(rng.r(0, 0.04))
      .streak(x + c.dx * b + lx * off, y + dy, z + c.dz * b + lz * off, x + c.dx * a + lx * off, y + dy, z + c.dz * a + lz * off);
  }
}

/** element flavour of a launch burst at (x,y,z), heading along the caster's direction */
function launchFlavor(fx: Fx, c: Ctx, x: number, y: number, z: number, s: number, dly: number): void {
  const p = c.pal;
  const rng = fx.rng;
  const dx = c.dx, dz = c.dz;
  switch (c.element) {
    case 1:
      fireBurst(fx, x + dx * 0.35 * s, y, z + dz * 0.35 * s, 1.1 * s, 0.3, p, 1.7, dly);
      for (let i = 0, n = fx.n(3); i < n; i++) {
        turn(dx, dz, rng.s2(0.6));
        const v = rng.r(1.5, 4);
        fx.add.at(x, y - 0.1, z).vel(TX * v, rng.r(0.5, 1.6), TZ * v).size(0.45 * s, 0.85 * s).life(rng.r(0.26, 0.4)).delay(dly)
          .col(p.main, 0.9, p.edge, 0).int(1.9).spr(SPR.flame0 + rng.i(4)).mode(M.upright).stretch(1.3).wob(0.1).fade(0, FO.quad).emit();
      }
      embers(fx, x, y, z, fx.n(5), 0.3 * s, 1.5, 0.45, 0.9, 0.15 * s, p.core, p.edge, dly);
      break;
    case 2:
      for (let i = 0, n = fx.n(5); i < n; i++) {
        turn(dx, dz, rng.s2(0.7));
        const v = rng.r(3, 8);
        fx.add.at(x, y, z).vel(TX * v, rng.r(0.4, 1.8), TZ * v).size(0.3 * s, 0.12 * s).life(rng.r(0.3, 0.5)).delay(dly)
          .col(p.core, 1, p.main, 0).int(1.9).spr(SPR.shard).rot(rng.f() * TAU, rng.s2(9)).grav(-7).drag(1.4).fade(0, FO.quad).emit();
      }
      fx.add.at(x, y, z).size(0.5 * s, 1.0 * s).life(0.4).delay(dly).col(p.core, 1, p.main, 0).int(2).spr(SPR.snow0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(2)).fade(0, FO.quad).emit();
      break;
    case 3:
      for (let i = 0, n = fx.n(3); i < n; i++) {
        fx.add.at(x + rng.s2(0.3), y + rng.s2(0.3), z + rng.s2(0.3)).size(1.0 * s, 1.5 * s).life(rng.r(0.08, 0.14)).delay(dly + rng.r(0, 0.08))
          .col(p.core, 1, p.main, 0).int(2.4).spr(SPR.arc0 + rng.i(3)).rot(rng.f() * TAU).twinkle().fade(0, FO.cube).emit();
      }
      if (fx.detail >= 1) {
        for (let i = 0; i < 2; i++) {
          turn(dx, dz, rng.s2(0.8));
          const L = rng.r(1.0, 2.0) * s;
          fx.rb.width(0.13 * s).life(0.12).delay(dly).col(p.core, p.main).int(2.2).jag(0.4).bolt(x, y, z, x + TX * L, y + rng.s2(0.5), z + TZ * L);
        }
      }
      break;
    case 4:
      smoke(fx, x, y - 0.2, z, fx.n(2), 0.2 * s, 0.5, 0.45, 0.8, 0.5 * s, 1.3 * s, mixHex(p.smoke, p.main, 0.3), 0.5, dly);
      wisps(fx, x, y, z, fx.n(2), 0.3 * s, 0.9, 0.5, 0.8, 0.4 * s, p.main, p.edge, dly);
      embers(fx, x, y, z, fx.n(3), 0.25 * s, 1.2, 0.4, 0.7, 0.14 * s, p.extra, p.main, dly);
      break;
    case 5:
      for (let i = 0, n = fx.n(4); i < n; i++) {
        turn(dx, dz, rng.s2(0.8));
        const v = rng.r(1.5, 4.5);
        fx.alp.at(x, y, z).vel(TX * v, rng.r(0.4, 1.4), TZ * v).size(0.2 * s, 0.1 * s).life(0.45).delay(dly).col(p.main, 0.95, p.edge, 0.7).spr(SPR.drop).grav(-9).fade(0, FO.snap).emit();
      }
      fx.add.at(x + dx * 0.3 * s, y, z + dz * 0.3 * s).size(0.3 * s, 0.9 * s).life(0.3).delay(dly).col(p.core, 0.8, p.main, 0).int(1.6).spr(SPR.ringThin).fade(0, FO.quad).emit();
      break;
    case 6:
      for (let i = 0, n = fx.n(3); i < n; i++) {
        fx.add.at(x + rng.s2(0.3), y + rng.s2(0.2), z + rng.s2(0.3)).vel(0, rng.r(0.8, 1.6), 0).size(0.45 * s, 0.1 * s).life(0.5).delay(dly + i * 0.03)
          .col(p.core, 1, p.edge, 0).int(2).spr(SPR.glint).twinkle().fade(1, FO.quad).emit();
      }
      fx.add.at(x, y, z).size(0.5 * s, 1.3 * s).life(0.3).delay(dly).col(p.core, 0.9, p.main, 0).int(2.0).spr(SPR.star6).rot(rng.f() * TAU, rng.s2(3)).fade(0, FO.quad).emit();
      break;
    case 7:
      for (let i = 0, n = fx.n(3); i < n; i++) {
        turn(dx, dz, rng.s2(0.5));
        const v = rng.r(8, 14);
        fx.add.at(x, y + rng.s2(0.2), z).vel(TX * v, 0, TZ * v).size(0.1 * s, 0.04 * s).life(0.26).delay(dly).stretch(0.1).col(p.core, 0.9, p.main, 0).int(1.6).spr(SPR.streak).mode(M.streak).drag(2).fade(0, FO.cubic).emit();
      }
      for (let i = 0, n = fx.n(2); i < n; i++) {
        turn(dx, dz, rng.s2(0.9));
        fx.add.at(x, y, z).vel(TX * 3, rng.r(0.2, 0.9), TZ * 3).size(0.2 * s, 0.14 * s).life(0.6).delay(dly).col(p.main, 0.9, p.edge, 0).int(1.3).spr(SPR.leaf0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(9)).drag(1.5).wob(0.2).fade(1, FO.quad).emit();
      }
      break;
    default:
      if (fx.detail >= 1) smoke(fx, x, c.y + 0.15, z, fx.n(2), 0.3 * s, 0.4, 0.35, 0.6, 0.35 * s, 1.0 * s, PALETTES.dust.main, 0.28, dly);
      fx.add.at(x, y, z).vel(0, rng.r(0.3, 0.8), 0).size(0.4 * s, 0.1 * s).life(0.4).delay(dly).col(p.core, 1, p.main, 0).int(1.9).spr(SPR.glint).twinkle().fade(1, FO.quad).emit();
  }
}

function projOrb(): PresetDef {
  return {
    id: 'proj.orb',
    cat: 'ranged',
    desc: 'orb / homing launch: hot muzzle flash, energy swirl, forward lance + speed lines, cone sparks, cast ring, element flavour.',
    size: 'mult',
    base: 0.8,
    palette: 'shamanBlue',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const s = c.scale;
      const k = c.intensity;
      const rng = fx.rng;
      const dx = c.dx, dz = c.dz;
      const mx = c.x + dx * 0.55 * s, mz = c.z + dz * 0.55 * s, my = c.y + HAND;
      launchCore(fx, c, mx, my, mz, 1.0 * s);
      glow(fx, mx + dx * 0.2 * s, my, mz + dz * 0.2 * s, 1.6 * s, 0.5 * s, 0.42, p.edge, 0.55, 1.2 * k, 0.05);
      lances(fx, c, mx, my, mz, 3, 0.34 * s, 18, 26, 2.2 * s, 0.17);
      speedLines(fx, c, mx, my, mz, 3, 1.4 * s, 3.0 * s, 0.07 * s, 0.26);
      sparks(fx, mx, my, mz, fx.n(13), 5 * s, 15 * s, 0.4, 0.14, 0.36, 0.1 * s, p.core, p.edge, dx, dz, 1.0, 2.4 * k, -4);
      for (let i = 0, n = fx.n(3); i < n; i++) {
        fx.add.at(mx + dx * rng.r(0.2, 1.2) * s, my + rng.s2(0.3), mz + dz * rng.r(0.2, 1.2) * s + rng.s2(0.3)).vel(dx * 2, rng.r(0.2, 0.8), dz * 2).size(0.4 * s, 0.05).life(rng.r(0.3, 0.5)).delay(rng.r(0, 0.08))
          .col(p.core, 1, p.main, 0).int(2.2).spr(SPR.sparkle).rot(rng.f() * TAU, rng.s2(4)).twinkle().drag(1.5).fade(0, FO.quad).emit();
      }
      haloRing(fx, mx + dx * 0.3 * s, my, mz + dz * 0.3 * s, 0.3 * s, 1.7 * s, 0.24, p.main, 0.6, 1.3);
      shockRing(fx, c.x, c.z, 1.2 * s, 0.34, p, 0.24, 1.0 * k);
      launchFlavor(fx, c, mx, my, mz, s, 0);
    },
  };
}

function projArrow(): PresetDef {
  return {
    id: 'proj.arrow',
    cat: 'ranged',
    desc: 'arrow launch: bow-release flash with a snapping crescent, white shaft glint, speed lines and a quick foot puff.',
    size: 'mult',
    base: 0.8,
    palette: 'ninjaGreen',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const s = c.scale;
      const k = c.intensity;
      const rng = fx.rng;
      const dx = c.dx, dz = c.dz;
      const mx = c.x + dx * 0.5 * s, mz = c.z + dz * 0.5 * s, my = c.y + HAND;
      flash(fx, mx, my, mz, 0.8 * s, 0.25 * s, 0.1, p.core, 3.2 * k);
      glow(fx, mx, my, mz, 1.3 * s, 0.5 * s, 0.22, p.main, 0.8, 1.5 * k);
      // bow limb snapping forward: a crescent whose convex side leads
      fx.add.at(mx + dx * 0.25 * s, my, mz + dz * 0.25 * s).size(1.1 * s, 1.5 * s).life(0.16).col(p.core, 1, p.main, 0).int(2.2 * k).spr(SPR.crescent)
        .rot(Math.atan2(-dz, dx) - Math.PI / 2).fade(0, FO.quad).emit();
      fx.add.at(mx, my, mz).size(1.2 * s, 0.4 * s).life(0.16).col(p.core, 1, p.main, 0).int(2.2 * k).spr(SPR.flare).rot(Math.atan2(-dz, dx)).fade(0, FO.cubic).emit();
      // shaft glint: thin white lance along the shot line
      lances(fx, c, mx, my, mz, 2, 0.16 * s, 26, 34, 3.0 * s, 0.16, 0.02);
      speedLines(fx, c, mx, my, mz, 6, 1.8 * s, 4.2 * s, 0.05 * s, 0.24, 0.5, 2.0);
      sparks(fx, mx, my, mz, fx.n(5), 10 * s, 20 * s, 0.1, 0.1, 0.24, 0.07 * s, p.core, p.main, dx, dz, 0.35, 2.4 * k, -2);
      if (fx.detail >= 1) {
        smoke(fx, c.x, c.y + 0.15, c.z, fx.n(2), 0.25 * s, 0.3, 0.3, 0.5, 0.3 * s, 0.9 * s, PALETTES.dust.main, 0.25);
        fx.add.at(mx, my, mz).vel(dx * 2, 0.5, dz * 2).size(0.5 * s, 0.1 * s).life(0.3).col(p.core, 1, p.edge, 0).int(2).spr(SPR.glint).rot(rng.s2(0.4)).twinkle().fade(0, FO.quad).emit();
      }
      launchFlavor(fx, c, mx, my, mz, s * 0.8, 0);
    },
  };
}

function projBlade(): PresetDef {
  return {
    id: 'proj.blade',
    cat: 'ranged',
    desc: 'air-blade launch: forward-leaping crescent echoes with a white leading edge, edge sparks, wind burst and dust sweep.',
    size: 'mult',
    base: 1.4,
    palette: 'warriorWhite',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const s = c.scale;
      const k = c.intensity;
      const rng = fx.rng;
      const dx = c.dx, dz = c.dz;
      const my = c.y + HAND;
      const R = 1.45 * s;
      const roll = (c.seed - 0.5) * 0.5 - 0.25;
      const sd = c.seed * 10;
      flash(fx, c.x + dx * 0.5 * s, my, c.z + dz * 0.5 * s, 1.0 * s, 0.3 * s, 0.12, p.core, 2.8 * k);
      // crescent echoes leaping away from the caster
      for (let i = 0; i < 4; i++) {
        const off = (0.35 + i * 0.6) * s;
        const f = 1 - i * 0.12;
        const ox = c.x + dx * off, oz = c.z + dz * off;
        fx.shp.at(ox, my, oz).yaw_(c.rot).tilt(0, roll).arc(R * 0.42 * f, R * f, 2.0, -1.0).crescent(1).pat(PAT.slash).sweep(0.3, 0.8).life(0.32 - i * 0.03).delay(i * 0.04)
          .col(p.main, 1, p.edge, 1).int((2.2 - i * 0.4) * k).seed(sd + i).emit();
        if (i < 2) {
          fx.shp.at(ox, my + 0.02, oz).yaw_(c.rot).tilt(0, roll).arc(R * 0.76 * f, R * 1.04 * f, 2.0, -1.0).crescent(1).pat(PAT.slash).sweep(0.24, 0.4).life(0.24).delay(i * 0.04)
            .col(p.core, 1, p.main, 1).int(2.8 * k).seed(sd + 5 + i).emit();
        }
      }
      // sparks shed along the leading edge
      for (let i = 0, n = fx.n(10); i < n; i++) {
        const ang = rng.s2(1.0);
        const r = R * rng.r(0.9, 1.05);
        turn(dx, dz, ang);
        const v = rng.r(3, 8);
        fx.add.at(c.x + dx * 0.35 * s + TX * r, my + rng.s2(0.15), c.z + dz * 0.35 * s + TZ * r).vel(TX * v, rng.r(0, 0.8), TZ * v).size(0.09 * s, 0.03 * s).life(rng.r(0.16, 0.34)).delay(rng.r(0, 0.1))
          .stretch(0.05).col(p.core, 1, p.edge, 0).int(2.4).spr(SPR.streak).mode(M.streak).drag(2.2).fade(0, FO.cubic).emit();
      }
      speedLines(fx, c, c.x + dx * 0.2, my, c.z + dz * 0.2, 4, 2.0 * s, 4.0 * s, 0.06 * s, 0.26, 0.7, 1.7);
      shockRing(fx, c.x, c.z, 1.5 * s, 0.4, p, 0.2, 1.1 * k);
      if (fx.detail >= 1) dustRing(fx, c.x, c.y, c.z, fx.n(6), 1.2 * s, 0.45, PALETTES.dust.main, 0.3, 0.7 * s, 0.03);
      launchFlavor(fx, c, c.x + dx * 0.9 * s, my, c.z + dz * 0.9 * s, s, 0.04);
    },
  };
}

function projBolt(): PresetDef {
  return {
    id: 'proj.bolt',
    cat: 'ranged',
    desc: 'lightning-bolt launch: white flash, forked bolt along the heading, side arcs, ground arc and crackle sparks.',
    size: 'mult',
    base: 0.9,
    palette: 'lightning',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const s = c.scale;
      const k = c.intensity;
      const rng = fx.rng;
      const dx = c.dx, dz = c.dz;
      const mx = c.x + dx * 0.55 * s, mz = c.z + dz * 0.55 * s, my = c.y + HAND;
      launchCore(fx, c, mx, my, mz, 0.95 * s);
      const L = rng.r(2.6, 3.4) * s;
      fx.rb.width(0.26 * s).life(0.17).col(p.core, p.main).int(2.8 * k).jag(0.3).branch(2).seed(c.seed * 10).bolt(mx, my, mz, mx + dx * L, my + rng.s2(0.25), mz + dz * L);
      for (let i = 0; i < 2; i++) {
        turn(dx, dz, (i === 0 ? 1 : -1) * rng.r(0.6, 1.2));
        const L2 = rng.r(0.9, 1.7) * s;
        fx.rb.width(0.15 * s).life(0.12).col(p.core, p.main).int(2.4 * k).jag(0.4).bolt(mx, my, mz, mx + TX * L2, my + rng.s2(0.45), mz + TZ * L2);
      }
      fx.rb.width(0.14 * s).life(0.1).col(p.core, p.extra).int(2.2 * k).jag(0.4).bolt(mx, my, mz, c.x + dx * 0.6 * s + rng.s2(0.5), c.y + 0.05, c.z + dz * 0.6 * s + rng.s2(0.5));
      for (let i = 0, n = fx.n(3); i < n; i++) {
        fx.add.at(mx + rng.s2(0.35), my + rng.s2(0.3), mz + rng.s2(0.35)).size(1.0 * s, 1.6 * s).life(rng.r(0.08, 0.15)).delay(rng.r(0, 0.08))
          .col(p.core, 1, p.main, 0).int(2.4).spr(SPR.arc0 + rng.i(3)).rot(rng.f() * TAU).twinkle().fade(0, FO.cube).emit();
      }
      glow(fx, mx, my, mz, 1.5 * s, 0.6 * s, 0.3, p.extra, 0.5, 1.0);
      sparks(fx, mx, my, mz, fx.n(8), 5 * s, 13 * s, 0.5, 0.12, 0.3, 0.08 * s, p.core, p.extra, dx, dz, 1.0, 2.6 * k, -6);
      haloRing(fx, mx, my, mz, 0.3 * s, 1.4 * s, 0.2, p.core, 0.7, 1.4);
      fx.shp.ground(c.x, c.z, 0.05).disk(1.15 * s).pat(PAT.cracks).life(0.4).col(p.main, 1, p.edge, 1).int(1.3 * k).fade(FO.sq).seed(c.seed * 8).emit();
    },
  };
}

function projTalisman(): PresetDef {
  return {
    id: 'proj.talisman',
    cat: 'ranged',
    desc: 'paper charm launch: glyph flash, rune puff, ground seal stamp, fluttering paper scraps and ink sparks.',
    size: 'mult',
    base: 0.8,
    palette: 'shamanGold',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const s = c.scale;
      const k = c.intensity;
      const rng = fx.rng;
      const dx = c.dx, dz = c.dz;
      const mx = c.x + dx * 0.5 * s, mz = c.z + dz * 0.5 * s, my = c.y + HAND;
      flash(fx, mx, my, mz, 0.9 * s, 0.3 * s, 0.11, p.core, 3.0 * k);
      glow(fx, mx, my, mz, 1.7 * s, 0.7 * s, 0.3, p.main, 0.75, 1.4 * k);
      // glyph flash: runes unfolding at the hand
      for (let i = 0; i < 3; i++) {
        fx.add.at(mx + dx * i * 0.18 * s, my + (i - 1) * 0.12 * s, mz + dz * i * 0.18 * s).size(0.5 * s, (1.5 + i * 0.35) * s).life(0.32 + i * 0.05).delay(i * 0.03)
          .col(i === 0 ? p.core : p.main, 1, p.edge, 0).int((2.2 - i * 0.3) * k).spr(SPR.rune0 + rng.i(8)).rot(rng.s2(0.35), rng.s2(1.6)).fade(0, FO.quad, SC.out).emit();
      }
      haloRing(fx, mx, my, mz, 0.3 * s, 1.5 * s, 0.24, p.core, 0.75, 1.3);
      // seal stamp on the ground
      fx.shp.ground(c.x, c.z, 0.06).disk(1.15 * s).pat(PAT.rune).expand(0.55).spin(1.4).life(0.5).col(p.main, 1, p.edge, 1).int(1.5 * k).fade(FO.sq).seed(c.seed * 9).emit();
      // paper scraps
      for (let i = 0, n = fx.n(5); i < n; i++) {
        turn(dx, dz, rng.s2(0.9));
        const v = rng.r(1.5, 5);
        fx.db.at(mx, my + rng.s2(0.2), mz).vel(TX * v, rng.r(0.5, 2.2), TZ * v).sz(rng.r(0.06, 0.1)).tall(1.7).col(0xf6e8b8, 0xc9a45a).glow(0.35).grav(-4).bounce(0.15).spin_(12).floor(c.y).life(rng.r(0.7, 1.1)).emit();
      }
      sparks(fx, mx, my, mz, fx.n(6), 5 * s, 12 * s, 0.4, 0.14, 0.3, 0.08 * s, p.core, p.edge, dx, dz, 0.7, 2.2 * k, -5);
      for (let i = 0, n = fx.n(4); i < n; i++) {
        turn(dx, dz, rng.s2(0.7));
        const v = rng.r(2, 6);
        fx.add.at(mx, my, mz).vel(TX * v, rng.r(0, 1), TZ * v).size(0.12 * s, 0.05 * s).life(rng.r(0.3, 0.55)).col(p.extra, 1, p.edge, 0).int(2).spr(SPR.dot).drag(2).twinkle().fade(0, FO.quad).emit();
      }
      if (fx.detail >= 1) smoke(fx, mx, my - 0.2, mz, fx.n(2), 0.2 * s, 0.4, 0.35, 0.6, 0.4 * s, 1.1 * s, p.smoke, 0.3);
      launchFlavor(fx, c, mx, my, mz, s * 0.8, 0);
    },
  };
}

function projDragon(): PresetDef {
  return {
    id: 'proj.dragon',
    cat: 'ranged',
    desc: 'dragon launch: golden coil spiralling forward, big roar flash, forward rings and a wide energy lance with cyan scale glints.',
    size: 'mult',
    base: 1.2,
    palette: 'shamanGold',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const s = c.scale;
      const k = c.intensity;
      const rng = fx.rng;
      const dx = c.dx, dz = c.dz;
      const lx = c.dz, lz = -c.dx;
      const mx = c.x + dx * 0.6 * s, mz = c.z + dz * 0.6 * s, my = c.y + HAND;
      launchCore(fx, c, mx, my, mz, 1.5 * s, 1.3);
      glow(fx, mx + dx * 0.4 * s, my, mz + dz * 0.4 * s, 2.4 * s, 0.7 * s, 0.5, p.edge, 0.55, 1.2 * k, 0.05);
      lances(fx, c, mx, my, mz, 4, 0.6 * s, 16, 24, 3.2 * s, 0.24, 0.12);
      // coil: a luminous double helix drawn forward along the shot line
      const n = fx.n(16);
      for (let i = 0; i < n; i++) {
        const f = i / 16;
        const th = f * 11 + c.seed * TAU;
        for (let st = 0; st < 2; st++) {
          const a = th + st * Math.PI;
          const r = (0.42 - f * 0.12) * s;
          const dist = (0.3 + f * 3.6) * s;
          fx.add.at(mx + dx * dist + lx * Math.cos(a) * r, my + Math.sin(a) * r * 0.9, mz + dz * dist + lz * Math.cos(a) * r).size(0.3 * s, 0.1 * s).life(0.3).delay(f * 0.14)
            .col(st === 0 ? p.core : p.extra, 1, p.main, 0).int(2.0 * k).spr(SPR.glow).fade(0, FO.quad).emit();
        }
      }
      // roar rings pushed forward
      for (let i = 0; i < 3; i++) {
        const d = (0.9 + i * 1.0) * s;
        haloRing(fx, mx + dx * d, my, mz + dz * d, 0.4 * s, (1.7 + i * 0.5) * s, 0.28, i === 0 ? p.core : p.main, 0.7, 1.4, i * 0.06);
      }
      speedLines(fx, c, mx, my, mz, 4, 2.0 * s, 4.5 * s, 0.09 * s, 0.3, 0.6, 1.8);
      sparks(fx, mx, my, mz, fx.n(10), 6 * s, 16 * s, 0.4, 0.16, 0.38, 0.1 * s, p.core, p.edge, dx, dz, 1.0, 2.4 * k, -4);
      for (let i = 0, m = fx.n(5); i < m; i++) {
        turn(dx, dz, rng.s2(0.8));
        const v = rng.r(2, 6);
        fx.add.at(mx, my, mz).vel(TX * v, rng.r(0, 1.2), TZ * v).size(0.22 * s, 0.06 * s).life(rng.r(0.35, 0.6)).col(p.extra, 1, p.extra, 0).int(2.2).spr(SPR.sparkle).rot(rng.f() * TAU, rng.s2(4)).drag(2).twinkle().fade(0, FO.quad).emit();
      }
      shockRing(fx, c.x, c.z, 2.0 * s, 0.45, p, 0.2, 1.3 * k);
      if (fx.detail >= 1) dustRing(fx, c.x, c.y, c.z, fx.n(8), 1.6 * s, 0.5, PALETTES.dust.main, 0.32, 0.8 * s);
      launchFlavor(fx, c, mx, my, mz, s, 0);
    },
  };
}

function projStar(): PresetDef {
  return {
    id: 'proj.star',
    cat: 'ranged',
    desc: 'ninja throwing-star launch: spinning star-glint flash, leaping star echoes, wrist-flick crescent, speed lines.',
    size: 'mult',
    base: 0.7,
    palette: 'ninjaPurple',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const s = c.scale;
      const k = c.intensity;
      const rng = fx.rng;
      const dx = c.dx, dz = c.dz;
      const mx = c.x + dx * 0.45 * s, mz = c.z + dz * 0.45 * s, my = c.y + HAND;
      flash(fx, mx, my, mz, 0.75 * s, 0.22 * s, 0.1, p.core, 3.0 * k);
      glow(fx, mx, my, mz, 1.2 * s, 0.45 * s, 0.22, p.main, 0.75, 1.5 * k);
      // the star itself leaving the hand: spinning echoes along the shot line
      for (let i = 0; i < 4; i++) {
        const d = (0.15 + i * 0.7) * s;
        fx.add.at(mx + dx * d, my, mz + dz * d).size((0.95 - i * 0.12) * s, (0.5 - i * 0.07) * s).life(0.16 + i * 0.01).delay(i * 0.022)
          .col(i === 0 ? p.core : p.main, 1, p.edge, 0).int((2.6 - i * 0.4) * k).spr(SPR.star6).rot(rng.f() * TAU, 34).fade(0, FO.quad).emit();
        fx.add.at(mx + dx * d, my, mz + dz * d).size((0.7 - i * 0.1) * s, 0.2 * s).life(0.14).delay(i * 0.022)
          .col(p.core, 1, p.main, 0).int(2.0 * k).spr(SPR.gemSparkle).rot(rng.f() * TAU, -26).fade(0, FO.quad).emit();
      }
      // wrist flick
      fx.add.at(mx - dx * 0.1 * s, my, mz - dz * 0.1 * s).size(1.0 * s, 1.35 * s).life(0.15).col(p.core, 1, p.main, 0).int(2.0 * k).spr(SPR.crescent)
        .rot(Math.atan2(-dz, dx) - Math.PI / 2).fade(0, FO.quad).emit();
      speedLines(fx, c, mx, my, mz, 4, 1.4 * s, 3.4 * s, 0.05 * s, 0.22, 0.4, 1.9);
      sparks(fx, mx, my, mz, fx.n(6), 8 * s, 17 * s, 0.2, 0.1, 0.26, 0.07 * s, p.core, p.extra, dx, dz, 0.5, 2.4 * k, -3);
      haloRing(fx, mx, my, mz, 0.2 * s, 1.1 * s, 0.18, p.core, 0.6, 1.3);
      if (fx.detail >= 1) fx.add.at(mx, my, mz).vel(dx * 3, 0.4, dz * 3).size(0.4 * s, 0.08 * s).life(0.3).col(p.extra, 1, p.extra, 0).int(2).spr(SPR.glint).twinkle().fade(0, FO.quad).emit();
      launchFlavor(fx, c, mx, my, mz, s * 0.7, 0);
    },
  };
}

/** instance velocity in XZ (clamped against teleports) → OVX / OVZ */
let OVX = 0;

let OVZ = 0;

function instVel(c: Inst, dt: number): void {
  if (dt <= 0) {
    OVX = 0;
    OVZ = 0;
    return;
  }
  let vx = (c.x - c.px) / dt, vz = (c.z - c.pz) / dt;
  const sp = Math.hypot(vx, vz);
  if (sp > 24) {
    vx *= 24 / sp;
    vz *= 24 / sp;
  }
  OVX = vx;
  OVZ = vz;
}

/** orbitals report their world height; when the caller gave none (y = terrain) hover at hand height */
function lift(fx: Fx, c: Inst): void {
  if (Math.abs(c.y - fx.heightAt(c.x, c.z)) < 0.01) c.y += 1.0;
}

/** gallery / test hook: `a === 99` makes an untargeted instance circle its spawn point (never used in production) */
function demoSetup(c: Inst): void {
  if (c.a === 99 && !c.hasTarget) {
    c.tx = c.x;
    c.tz = c.z;
  }
}

function demoOrbit(fx: Fx, c: Inst): void {
  if (c.a !== 99 || c.hasTarget) return;
  const w = c.age * 3.2;
  c.x = c.tx + Math.sin(w) * 2.4;
  c.z = c.tz + Math.cos(w) * 2.4;
  c.y = fx.heightAt(c.x, c.z);
}

/** element specific shed of an orbiting body at its position, moving at (vx,vz) */
function orbitFlavor(fx: Fx, c: Inst, vx: number, vz: number, s: number): void {
  const p = c.pal;
  const rng = fx.rng;
  const x = c.x + rng.s2(0.12 * s), y = c.y + rng.s2(0.12 * s), z = c.z + rng.s2(0.12 * s);
  switch (c.element) {
    case 1:
      fx.add.at(x, y - 0.1, z).vel(vx * 0.3, rng.r(0.5, 1.3), vz * 0.3).size(0.4 * s, 0.7 * s).life(rng.r(0.25, 0.4)).col(p.main, 0.8, p.edge, 0).int(1.8)
        .spr(SPR.flame0 + rng.i(4)).mode(M.upright).stretch(1.3).wob(0.1).fade(0, FO.quad).emit();
      embers(fx, x, y, z, 1, 0.1, 1.2, 0.4, 0.8, 0.13 * s, p.core, p.edge);
      break;
    case 2:
      fx.add.at(x, y, z).vel(vx * 0.2, rng.r(-0.3, 0.4), vz * 0.2).size(0.3 * s, 0.14 * s).life(rng.r(0.4, 0.7)).col(p.core, 1, p.main, 0).int(1.8)
        .spr(rng.f() < 0.5 ? SPR.shard : SPR.snow0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(6)).grav(-1.5).drag(1.2).fade(0, FO.quad).emit();
      break;
    case 3:
      fx.add.at(x, y, z).size(0.9 * s, 1.3 * s).life(rng.r(0.07, 0.13)).col(p.core, 1, p.main, 0).int(2.4).spr(SPR.arc0 + rng.i(3)).rot(rng.f() * TAU).twinkle().fade(0, FO.cube).emit();
      if (fx.detail >= 1 && rng.f() < 0.5) {
        const a = rng.f() * TAU, L = rng.r(0.5, 1.0) * s;
        fx.rb.width(0.1 * s).life(0.1).col(p.core, p.main).int(2.2).jag(0.4).bolt(c.x, c.y, c.z, c.x + Math.sin(a) * L, c.y + rng.s2(0.4), c.z + Math.cos(a) * L);
      }
      break;
    case 4:
      fx.add.at(x, y, z).vel(vx * 0.25, rng.r(0.3, 0.8), vz * 0.25).size(0.4 * s, 0.7 * s).life(rng.r(0.5, 0.8)).col(p.main, 0.7, p.edge, 0).int(1.4)
        .spr(SPR.wisp).mode(M.upright).stretch(1.6).wob(0.3).drag(0.5).fade(1, FO.sq).emit();
      embers(fx, x, y, z, 1, 0.1, 0.8, 0.4, 0.7, 0.12 * s, p.extra, p.main);
      break;
    case 5:
      fx.alp.at(x, y, z).vel(vx * 0.2, rng.r(-0.2, 0.4), vz * 0.2).size(0.2 * s, 0.1 * s).life(0.5).col(p.main, 0.95, p.edge, 0.7).spr(SPR.drop).grav(-6).fade(0, FO.snap).emit();
      break;
    case 6:
      fx.add.at(x, y, z).vel(0, rng.r(0.5, 1.1), 0).size(0.45 * s, 0.08 * s).life(0.5).col(p.core, 1, p.edge, 0).int(2).spr(SPR.glint).twinkle().fade(1, FO.quad).emit();
      break;
    case 7:
      fx.add.at(x, y, z).vel(vx * 0.4, 0.3, vz * 0.4).size(0.16 * s, 0.1 * s).life(0.6).col(p.main, 0.9, p.edge, 0).int(1.3).spr(SPR.leaf0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(9)).drag(1.5).wob(0.2).fade(1, FO.quad).emit();
      break;
    default:
      break;
  }
}

function orbitOrb(): PresetDef {
  return {
    id: 'orbit.orb',
    cat: 'ranged',
    desc: 'orbital orb accent (T): soft halo + hot core + dashed energy ring riding the orb, shed sparkles, glow ribbon trail. track(y) = orb height.',
    size: 'mult',
    base: 0.6,
    palette: 'shamanBlue',
    variants: true,
    dur: 900,
    loop: true,
    demo: { loopFor: 3 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const s = c.scale;
      demoSetup(inst);
      lift(fx, inst);
      inst.trailRibbon(0.42 * s, 0.42, p.main, p.edge, 1.5 * c.intensity, 0);
      flash(fx, c.x, c.y, c.z, 1.0 * s, 0.4 * s, 0.14, p.core, 2.6);
      haloRing(fx, c.x, c.y, c.z, 0.2 * s, 1.3 * s, 0.3, p.core, 0.7, 1.4);
    },
    tick(fx, c, dt) {
      demoOrbit(fx, c);
      lift(fx, c);
      const p = c.pal;
      const s = c.scale;
      const k = c.intensity;
      const rng = fx.rng;
      instVel(c, dt);
      const vx = OVX, vz = OVZ;
      // body: ~60 overlapping 0.12 s blobs riding the orb velocity (alpha tuned so they sum to a steady glow)
      c.acc0 += dt * 60 * fx.density;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        fx.add.at(c.x, c.y, c.z).vel(vx, 0, vz).size(1.15 * s, 1.0 * s).life(0.12).col(p.main, 0.2, p.main, 0).int(1.5 * k).spr(SPR.glow).fade(0, FO.quad).emit();
        fx.add.at(c.x, c.y, c.z).vel(vx, 0, vz).size(0.5 * s, 0.42 * s).life(0.1).col(p.core, 0.4, p.core, 0).int(2.6 * k).spr(SPR.glowTight).fade(0, FO.quad).emit();
        fx.add.at(c.x, c.y, c.z).vel(vx, 0, vz).size(0.95 * s, 0.9 * s).life(0.1).col(p.core, 0.1, p.main, 0).int(1.8 * k).spr(SPR.ringDash).rot(c.age * 5 + rng.s2(0.2)).fade(0, FO.quad).emit();
      }
      // shed sparkles
      c.acc1 += dt * 16 * fx.density;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        fx.add.at(c.x + rng.s2(0.2 * s), c.y + rng.s2(0.2 * s), c.z + rng.s2(0.2 * s)).vel(vx * 0.25 + rng.s2(0.5), rng.r(-0.1, 0.6), vz * 0.25 + rng.s2(0.5)).size(0.3 * s, 0.05 * s).life(rng.r(0.35, 0.65))
          .col(p.core, 1, p.main, 0).int(2.2).spr(SPR.sparkle).rot(rng.f() * TAU, rng.s2(4)).twinkle().drag(1.2).fade(0, FO.quad).emit();
      }
      c.acc2 += dt * 9 * fx.density;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        orbitFlavor(fx, c, vx, vz, s);
      }
    },
  };
}

function orbitBlade(): PresetDef {
  return {
    id: 'orbit.blade',
    cat: 'ranged',
    desc: 'orbiting blade accent (T): spinning crescent afterimages, tip glints, tangential spark shed and a crisp streak ribbon. track(y) = blade height.',
    size: 'mult',
    base: 0.7,
    palette: 'warriorWhite',
    variants: true,
    dur: 900,
    loop: true,
    demo: { loopFor: 3 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const s = c.scale;
      demoSetup(inst);
      lift(fx, inst);
      inst.trailRibbon(0.34 * s, 0.32, p.core, p.edge, 2.0 * c.intensity, 2);
      flash(fx, c.x, c.y, c.z, 0.9 * s, 0.35 * s, 0.12, p.core, 2.6);
    },
    tick(fx, c, dt) {
      demoOrbit(fx, c);
      lift(fx, c);
      const p = c.pal;
      const s = c.scale;
      const k = c.intensity;
      const rng = fx.rng;
      instVel(c, dt);
      const vx = OVX, vz = OVZ;
      const sp = Math.hypot(vx, vz);
      // spinning crescent afterimages
      c.acc0 += dt * 60 * fx.density;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        const rot = c.age * 16;
        fx.add.at(c.x, c.y, c.z).vel(vx, 0, vz).size(1.35 * s, 1.2 * s).life(0.15).col(p.main, 0.5, p.edge, 0).int(2.2 * k).spr(SPR.crescent).rot(rot).fade(0, FO.quad).emit();
        fx.add.at(c.x, c.y, c.z).vel(vx, 0, vz).size(1.2 * s, 1.05 * s).life(0.12).col(p.core, 0.4, p.main, 0).int(2.6 * k).spr(SPR.crescent).rot(rot + Math.PI).fade(0, FO.quad).emit();
        fx.add.at(c.x, c.y, c.z).vel(vx, 0, vz).size(0.9 * s, 0.8 * s).life(0.1).col(p.edge, 0.22, p.edge, 0).int(2.0 * k).spr(SPR.glow).fade(0, FO.quad).emit();
      }
      // tip glints
      c.acc1 += dt * 7 * fx.density;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        fx.add.at(c.x + rng.s2(0.3 * s), c.y + rng.s2(0.1), c.z + rng.s2(0.3 * s)).vel(vx * 0.5, 0, vz * 0.5).size(0.7 * s, 0.1 * s).life(0.16).col(p.core, 1, p.main, 0).int(2.6)
          .spr(SPR.glint).rot(rng.f() * TAU, rng.s2(8)).twinkle().fade(0, FO.quad).emit();
      }
      // streak sparks thrown off against the motion
      c.acc2 += dt * 22 * fx.density;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        const bx = sp > 0.2 ? -vx / sp : 0, bz = sp > 0.2 ? -vz / sp : 0;
        fx.add.at(c.x + rng.s2(0.25 * s), c.y + rng.s2(0.15), c.z + rng.s2(0.25 * s)).vel(vx * 0.3 + bx * rng.r(1, 3) + rng.s2(0.8), rng.r(-0.2, 0.7), vz * 0.3 + bz * rng.r(1, 3) + rng.s2(0.8))
          .life(rng.r(0.18, 0.34)).size(0.08 * s, 0.03).stretch(0.06).col(p.core, 1, p.edge, 0).int(2.4).spr(SPR.streak).mode(M.streak).drag(2).grav(-4).fade(0, FO.cubic).emit();
      }
      c.acc3 += dt * 7 * fx.density;
      while (c.acc3 >= 1) {
        c.acc3 -= 1;
        orbitFlavor(fx, c, vx, vz, s);
      }
    },
  };
}

function orbitSpirit(): PresetDef {
  return {
    id: 'orbit.spirit',
    cat: 'ranged',
    desc: 'orbiting ghost-flame accent (T): flame head, rising wisps + embers, wavering soft ribbon tail. track(y) = flame height.',
    size: 'mult',
    base: 0.7,
    palette: 'wolfmanIndigo',
    variants: true,
    dur: 900,
    loop: true,
    demo: { loopFor: 3 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const s = c.scale;
      demoSetup(inst);
      lift(fx, inst);
      inst.trailRibbon(0.6 * s, 0.6, p.main, p.edge, 1.3 * c.intensity, 0);
      flash(fx, c.x, c.y, c.z, 1.0 * s, 0.4 * s, 0.14, p.core, 2.4);
      fireBurst(fx, c.x, c.y, c.z, 1.1 * s, 0.35, p, 1.6);
    },
    tick(fx, c, dt) {
      demoOrbit(fx, c);
      lift(fx, c);
      const p = c.pal;
      const s = c.scale;
      const k = c.intensity;
      const rng = fx.rng;
      instVel(c, dt);
      const vx = OVX, vz = OVZ;
      // soft halo + flame head
      c.acc0 += dt * 60 * fx.density;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        fx.add.at(c.x, c.y, c.z).vel(vx, 0, vz).size(1.2 * s, 1.0 * s).life(0.12).col(p.main, 0.16, p.main, 0).int(1.4 * k).spr(SPR.glow).fade(0, FO.quad).emit();
        fx.add.at(c.x, c.y - 0.15 * s, c.z).vel(vx, 0, vz).size(0.7 * s, 0.7 * s).life(0.12).col(p.core, 0.3, p.main, 0).int(2.2 * k).spr(SPR.flame0 + rng.i(4)).mode(M.upright).stretch(1.5).fade(0, FO.quad).emit();
      }
      // flame flipbook puffs trailing behind
      c.acc1 += dt * 12 * fx.density;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        fx.add.at(c.x + rng.s2(0.1), c.y - 0.1, c.z + rng.s2(0.1)).vel(vx * 0.55, rng.r(0.2, 0.7), vz * 0.55).size(0.6 * s, 0.9 * s).life(rng.r(0.35, 0.5)).col(p.main, 0.9, p.edge, 0.9).int(1.5 * k)
          .spr(FB.fire).frames(16).ramp().rot(rng.f() * TAU).drag(1.5).fade(0, FO.late).emit();
      }
      // wisps + embers drifting up
      c.acc2 += dt * 8 * fx.density;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        fx.add.at(c.x + rng.s2(0.15), c.y, c.z + rng.s2(0.15)).vel(vx * 0.2 + rng.s2(0.25), rng.r(0.5, 1.1), vz * 0.2 + rng.s2(0.25)).size(0.4 * s, 0.7 * s).life(rng.r(0.6, 0.95))
          .col(p.main, 0.75, p.edge, 0).int(1.5).spr(SPR.wisp).mode(M.upright).stretch(1.7).wob(0.3).drag(0.5).fade(1, FO.sq).emit();
      }
      c.acc3 += dt * 10 * fx.density;
      while (c.acc3 >= 1) {
        c.acc3 -= 1;
        embers(fx, c.x, c.y, c.z, 1, 0.15 * s, 1.0, 0.45, 0.9, 0.13 * s, p.core, p.extra);
      }
    },
  };
}

const LOCAL: PresetDef[] = [
  projOrb(),
  projArrow(),
  projBlade(),
  projBolt(),
  projTalisman(),
  projDragon(),
  projStar(),
  orbitOrb(),
  orbitBlade(),
  orbitSpirit(),
];

export const CAST_PRESETS: PresetDef[] = pickPresets(
  [
    'proj.orb',
    'proj.arrow',
    'proj.blade',
    'proj.bolt',
    'proj.talisman',
    'proj.dragon',
    'proj.hostile',
    'proj.star',
    'burst.dragon_head',
    'orbit.orb',
    'orbit.blade',
    'orbit.spirit',
    'buff.aura',
    'buff.shield',
    'buff.stealth',
    'buff.haste',
    'summon.circle',
    'summon.dragon',
    'summon.ghost',
    'summon.wolf',
    'holy.heal',
    'aura.heal',
    'heal.drain',
    'levelup',
  ],
  LOCAL, ENEMY_PROJECTILES.presets, PLAYER_FEEDBACK.presets, LEVELUP_HEAL.presets,
);

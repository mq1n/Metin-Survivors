// Melee & movement skills: crescent slashes, claw rakes, stabs, dagger flurry, spin blades, auras, dashes, leaps.
// Legacy barrel since the C0 ownership split: [aura.*, dash.*] → vfx/common/player-feedback. MELEE_PRESETS keeps the original ids and
// order for presets/index.ts, tests and tools.

import { PLAYER_FEEDBACK } from '../common/player-feedback';
import { pickPresets } from '../common/registry';
import type { Ctx, Fx } from '../emit';
import { PALETTES } from '../palette';
import type { Inst } from '../system';
import { castEl } from './el';
import { FO, M, PAT, SC, SPR, TAU, chunks, dustRing, embers, flash, glow, haloRing, pillar, shockRing, smoke, sparks } from './kit';
import type { PresetDef } from './types';

/** local → world offset for a plane tilted by `roll` about the forward axis then yawed by `rot` (writes OUT_*) */
let OUT_X = 0;

let OUT_Y = 0;

let OUT_Z = 0;

function toWorld(c: Ctx, lx: number, ly: number, lz: number, roll: number, ox: number, oy: number, oz: number): void {
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const x1 = lx * cr - ly * sr;
  const y1 = lx * sr + ly * cr;
  const cy = Math.cos(c.rot), sy = Math.sin(c.rot);
  OUT_X = ox + x1 * cy + lz * sy;
  OUT_Y = oy + y1;
  OUT_Z = oz - x1 * sy + lz * cy;
}

/** inverse of the shader's easeOut3: time fraction at which the head reaches position h (0..1) */
function headTime(h: number): number {
  return 1 - Math.pow(1 - Math.min(h, 0.999), 1 / 3);
}

/** per-element secondary particles dropped along a slash edge at (x,y,z); (nx,nz) = outward direction */
function edgeFlavor(fx: Fx, el: number, x: number, y: number, z: number, nx: number, nz: number, s: number, delay: number, c: Ctx): void {
  const rng = fx.rng;
  const p = c.pal;
  switch (el) {
    case 1:
      embers(fx, x, y, z, 1, 0.1, 1.6, 0.35, 0.7, 0.2 * s, p.core, p.edge, delay);
      if (fx.detail >= 2 && rng.f() < 0.5) fx.add.at(x, y, z).vel(nx * 0.6, 1.2, nz * 0.6).size(0.35 * s, 0.7 * s).life(0.35).delay(delay).col(p.main, 0.9, p.edge, 0).int(1.8).spr(SPR.flame0 + rng.i(4)).mode(M.upright).wob(0.1).fade(0, FO.quad).emit();
      break;
    case 2:
      fx.add.at(x, y, z).vel(nx * 1.4, rng.r(0.5, 1.6), nz * 1.4).size(0.26 * s, 0.1 * s).life(0.4).delay(delay).col(p.core, 1, p.main, 0).int(1.8).spr(SPR.shard).rot(rng.f() * TAU, rng.s2(8)).grav(-6).fade(0, FO.quad).emit();
      break;
    case 3:
      fx.add.at(x, y, z).size(0.9 * s, 1.3 * s).life(rng.r(0.08, 0.14)).delay(delay).col(p.core, 1, p.main, 0).int(2.4).spr(SPR.arc0 + rng.i(3)).rot(rng.f() * TAU).twinkle().fade(0, FO.cube).emit();
      break;
    case 4:
      smoke(fx, x, y, z, 1, 0.1, 0.5, 0.45, 0.8, 0.4 * s, 1.1 * s, p.smoke, 0.55, delay);
      embers(fx, x, y, z, 1, 0.1, 1.2, 0.35, 0.6, 0.18 * s, p.extra, p.main, delay);
      break;
    case 5:
      fx.alp.at(x, y, z).vel(nx * 0.8, rng.r(0.4, 1.2), nz * 0.8).size(0.18 * s, 0.1 * s).life(0.45).delay(delay).col(p.main, 0.95, p.edge, 0.7).spr(SPR.drop).grav(-9).fade(0, FO.snap).emit();
      break;
    case 6:
      fx.add.at(x, y, z).vel(0, rng.r(0.8, 1.6), 0).size(0.36 * s, 0.08 * s).life(0.5).delay(delay).col(p.core, 1, p.edge, 0).int(2).spr(SPR.glint).twinkle().fade(1, FO.quad).emit();
      break;
    case 7:
      fx.add.at(x, y, z).vel(nx * 2.5, 0, nz * 2.5).size(0.1 * s, 0.04 * s).life(0.25).delay(delay).stretch(0.12).col(p.core, 0.9, p.main, 0).int(1.6).spr(SPR.streak).mode(M.streak).drag(3).fade(0, FO.cubic).emit();
      break;
    default:
      if (rng.f() < 0.5) smoke(fx, x, y - 0.4, z, 1, 0.1, 0.4, 0.35, 0.6, 0.3 * s, 0.9 * s, PALETTES.dust.main, 0.28, delay);
  }
}

/** one crescent swing (two layered arcs + sparks + flavour) */
function swing(fx: Fx, c: Ctx, R: number, A: number, dir: number, roll: number, delay: number, life: number, y: number, ox = c.x, oz = c.z): void {
  const p = c.pal;
  const rng = fx.rng;
  const a0 = dir >= 0 ? -A / 2 : A / 2;
  const span = dir >= 0 ? A : -A;
  const sd = c.seed * 10;
  // main crescent
  fx.shp.at(ox, y, oz).yaw_(c.rot).tilt(0, roll).arc(R * 0.4, R, span, a0).crescent(1).pat(PAT.slash).sweep(0.3, 0.62).life(life).delay(delay)
    .col(p.main, 1, p.edge, 1).int(1.9 * c.intensity).seed(sd).emit();
  // thin white-hot leading blade, slightly larger
  fx.shp.at(ox, y + 0.02, oz).yaw_(c.rot).tilt(0, roll).arc(R * 0.78, R * 1.04, span, a0).crescent(1).pat(PAT.slash).sweep(0.22, 0.35).life(life * 0.72).delay(delay)
    .col(p.core, 1, p.main, 1).int(2.6 * c.intensity).seed(sd + 3).emit();
  if (fx.detail >= 2) {
    fx.shp.at(ox, y - 0.03, oz).yaw_(c.rot).tilt(0, roll).arc(R * 0.1, R * 1.12, span, a0).crescent(0.6).pat(PAT.band).life(life * 1.15).delay(delay)
      .col(p.edge, 0.5, p.edge, 0.5).int(0.9 * c.intensity).fade(FO.quad).seed(sd + 6).emit();
  }
  // sparks and flavour particles riding the head
  const n = fx.n(11);
  const sw = life * 0.3;
  for (let k = 0; k < n; k++) {
    const gu = (k + rng.f()) / n;
    const ang = a0 + span * gu;
    const r = R * rng.r(0.9, 1.03);
    toWorld(c, Math.sin(ang) * r, 0, Math.cos(ang) * r, roll, ox, y, oz);
    const dly = delay + sw * headTime(gu);
    const tx = Math.cos(ang), tz = -Math.sin(ang); // outward-ish tangent in local frame
    toWorld(c, Math.sin(ang), 0, Math.cos(ang), roll, 0, 0, 0);
    const nx = OUT_X, ny = OUT_Y, nz = OUT_Z;
    toWorld(c, Math.sin(ang) * r, 0, Math.cos(ang) * r, roll, ox, y, oz);
    const px = OUT_X, py = OUT_Y, pz = OUT_Z;
    const v = rng.r(2, 5.5);
    fx.add.at(px, py, pz).vel(nx * v + rng.s2(1), ny * v + rng.r(0.2, 1.4), nz * v + rng.s2(1)).life(rng.r(0.18, 0.36)).delay(dly)
      .size(0.09 * c.scale, 0.03).stretch(0.05).col(p.core, 1, p.edge, 0).int(2.4).spr(SPR.streak).mode(M.streak).drag(3).grav(-8).fade(0, FO.cubic).emit();
    if (k % 2 === 0) edgeFlavor(fx, c.element, px, py, pz, nx, nz, c.scale, dly, c);
    void tx; void tz;
  }
}

function slash(): PresetDef {
  return {
    id: 'melee.slash',
    cat: 'melee',
    desc: 'meleeArc: eroding crescent slash with white-hot leading blade, edge sparks and element flavour. a = arc angle, b = swing direction ±1.',
    size: 'radius',
    base: 2.6,
    palette: 'warriorGold',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const R = c.radius;
      const A = c.a > 0 ? c.a : 2.5;
      const dir = c.b < 0 ? -1 : 1;
      const y = c.y + 1.0;
      flash(fx, c.x + c.dx * 0.5, y, c.z + c.dz * 0.5, 0.9 * c.scale, 0.3 * c.scale, 0.12, c.pal.core, 2.5);
      swing(fx, c, R, A, dir, -0.38 * dir + (c.seed - 0.5) * 0.2, 0, 0.44, y);
      if (fx.detail >= 1) dustRing(fx, c.x, c.y, c.z, fx.n(5), R * 0.5, 0.45, PALETTES.dust.main, 0.25, 0.7, 0.04);
    },
  };
}

function flurry(): PresetDef {
  return {
    id: 'melee.flurry',
    cat: 'melee',
    desc: 'Dagger flurry: rapid alternating mini slashes with tip glints. a = hit count (4).',
    size: 'radius',
    base: 2.0,
    palette: 'ninjaGreen',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const hits = c.a > 0 ? Math.round(c.a) : 4;
      const R = c.radius;
      const rng = fx.rng;
      for (let i = 0; i < hits; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        const dly = i * 0.075;
        const roll = rng.s2(0.8);
        const rot = c.rot;
        c.rot = rot + rng.s2(0.35);
        swing(fx, c, R * rng.r(0.8, 1), 1.5 + rng.r(0, 0.5), dir, roll, dly, 0.26, c.y + 1.0 + rng.s2(0.15));
        c.rot = rot;
        flash(fx, c.x + c.dx * R * 0.8, c.y + 1.0, c.z + c.dz * R * 0.8, 0.5 * c.scale, 0.15, 0.1, c.pal.core, 2.2, dly + 0.05);
      }
    },
  };
}

function stab(): PresetDef {
  return {
    id: 'melee.stab',
    cat: 'melee',
    desc: 'Thrust / assassinate: lunging light lance, tip flash, motion lines.',
    size: 'radius',
    base: 3.0,
    palette: 'ninjaPurple',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const R = c.radius;
      const y = c.y + 1.0;
      fx.shp.at(c.x, y, c.z).yaw_(c.rot).beam(0.55 * c.scale, R).expand(0.15).pat(PAT.beam).life(0.2).col(p.core, 1, p.main, 1).int(2.4).fade(FO.quad).seed(c.seed * 9).emit();
      fx.shp.at(c.x, y, c.z).yaw_(c.rot + 0.12).beam(0.3 * c.scale, R * 0.9).expand(0.15).pat(PAT.beam).life(0.16).delay(0.02).col(p.main, 1, p.edge, 1).int(2).fade(FO.quad).seed(c.seed * 9 + 2).emit();
      const tx = c.x + c.dx * R, tz = c.z + c.dz * R;
      flash(fx, tx, y, tz, 1.2 * c.scale, 0.3, 0.16, p.core, 3.2, 0.03);
      fx.add.at(tx, y, tz).size(1.2 * c.scale, 2.2 * c.scale).life(0.2).delay(0.03).col(p.main, 0.9, p.edge, 0).int(2).spr(SPR.spark4).rot(c.rot).fade(0, FO.quad).emit();
      sparks(fx, tx, y, tz, fx.n(8), 4 * c.scale, 9 * c.scale, 1, 0.16, 0.34, 0.1 * c.scale, p.core, p.edge, c.dx, c.dz, 1.1, 2.4, -9, 0.03);
      for (let i = 0; i < 4; i++) {
        const off = (i - 1.5) * 0.28 * c.scale;
        fx.rb.width(0.07).life(0.2).col(p.core, p.edge).int(1.6).style_(2).fade(FO.quad).streak(c.x - c.dz * off, y + fx.rng.s2(0.2), c.z + c.dx * off, c.x - c.dz * off + c.dx * R * 0.9, y, c.z + c.dx * off * 0 + c.dz * R * 0.9 + c.dx * off);
      }
    },
  };
}

function claw(): PresetDef {
  return {
    id: 'melee.claw',
    cat: 'melee',
    desc: 'meleeArc (Wolfman): parallel claw rakes that tear across the target, scratch glow + sparks. a = rake count (3).',
    size: 'radius',
    base: 2.2,
    palette: 'wolfmanRed',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const rng = fx.rng;
      const n = c.a > 0 ? Math.round(c.a) : 3;
      const R = c.radius;
      const y = c.y + 0.95;
      const rx = c.dz, rz = -c.dx; // right-hand perpendicular
      const slant = 0.62;
      const cs = Math.cos(slant), sn = Math.sin(slant);
      flash(fx, c.x + c.dx * R * 0.5, y, c.z + c.dz * R * 0.5, 1.0 * c.scale, 0.3, 0.14, p.core, 2.6);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 0.5 * c.scale;
        // each scratch runs from upper-left to lower-right of the swipe, slanted relative to facing
        const dly = i * 0.035;
        const sx = c.x + c.dx * R * 0.35 + rx * (off - 0.55 * c.scale);
        const sz = c.z + c.dz * R * 0.35 + rz * (off - 0.55 * c.scale);
        const yaw = c.rot + slant;
        fx.shp.at(sx, y, sz).yaw_(yaw).lane(0.32 * c.scale, R * 1.0).pat(PAT.scratch).sweep(0.4, 0.5).life(0.42).delay(dly).col(p.main, 1, p.edge, 1).int(2.2).fade(FO.none).seed(c.seed * 9 + i).emit();
        fx.shp.at(sx, y + 0.02, sz).yaw_(yaw).lane(0.12 * c.scale, R * 1.05).pat(PAT.scratch).sweep(0.3, 0.4).life(0.34).delay(dly).col(p.core, 1, p.core, 1).int(3).fade(FO.none).seed(c.seed * 9 + i + 3).emit();
        // sparks along the scratch
        const ex = sx + Math.sin(yaw) * R, ez = sz + Math.cos(yaw) * R;
        for (let k = 0, m = fx.n(5); k < m; k++) {
          const f = (k + rng.f()) / m;
          const px = sx + (ex - sx) * f, pz = sz + (ez - sz) * f;
          const dd = dly + 0.42 * 0.4 * headTime(f);
          fx.add.at(px, y, pz).vel(rng.s2(2) + c.dx * 2, rng.r(0.5, 2), rng.s2(2) + c.dz * 2).life(rng.r(0.15, 0.32)).delay(dd).size(0.08 * c.scale, 0.03).stretch(0.05)
            .col(p.core, 1, p.edge, 0).int(2.2).spr(SPR.streak).mode(M.streak).drag(3).grav(-8).fade(0, FO.cubic).emit();
        }
        void cs; void sn;
      }
      if (fx.detail >= 1) fx.add.at(c.x + c.dx * R * 0.8, y, c.z + c.dz * R * 0.8).size(2.2 * c.scale, 2.8 * c.scale).life(0.3).delay(0.04).col(p.main, 0.8, p.edge, 0).int(1.6).spr(SPR.claw0 + (n > 3 ? 1 : 0)).mode(M.ground).rot(c.rot + 0.4).fade(0, FO.quad).emit();
    },
  };
}

function spinBlades(): PresetDef {
  return {
    id: 'spin.blades',
    cat: 'melee',
    desc: 'spinAura: three rotating crescent blades, dust swirl and tip sparks around the player (follows). a = blade count (3).',
    size: 'radius',
    base: 2.4,
    palette: 'warriorGold',
    variants: true,
    dur: 3,
    loop: true,
    follow: true,
    demo: { loopFor: 3 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const R = c.radius;
      const n = c.a > 0 ? Math.round(c.a) : 3;
      const om = 9.5;
      for (let k = 0; k < n; k++) {
        const slot = fx.shp.at(c.x, c.y + 0.95, c.z).arc(R * 0.55, R, 1.25, (k * TAU) / n).crescent(1).pat(PAT.slash).spin(om).life(c.duration + 1).fade(FO.late)
          .col(p.main, 1, p.edge, 1).int(2.1 * c.intensity).seed(c.seed * 10 + k).pinned().emit();
        inst.own(slot, 0.95);
      }
      // faint ground ring
      const g = fx.dec.ground(c.x, c.z, 0.04).ring(R * 0.6, R * 1.02).pat(PAT.band).life(c.duration + 1).col(p.main, 0.55, p.edge, 0.55).int(0.8).fade(FO.late).seed(c.seed * 5).pinned().emit();
      inst.ownDecal(g, 0);
      flash(fx, c.x, c.y + 0.9, c.z, 1.6 * c.scale, 0.5, 0.2, p.core, 2);
      shockRing(fx, c.x, c.z, R * 1.1, 0.4, p, 0.15, 1.2);
    },
    tick(fx, c, dt) {
      const p = c.pal;
      const R = c.radius;
      const n = c.a > 0 ? Math.round(c.a) : 3;
      const om = 9.5;
      c.acc0 += dt * 54 * fx.density;
      const rng = fx.rng;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        const k = rng.i(n);
        const ang = (k * TAU) / n + om * c.age + 1.25 * rng.r(0.7, 1);
        const r = R * rng.r(0.78, 1);
        const px = c.x + Math.sin(ang) * r, pz = c.z + Math.cos(ang) * r;
        // tangent (direction of motion) + outward
        const tx = Math.cos(ang), tz = -Math.sin(ang);
        fx.add.at(px, c.y + 0.95, pz).vel(tx * 3 + Math.sin(ang) * 2, rng.r(0.2, 1.5), tz * 3 + Math.cos(ang) * 2).life(rng.r(0.15, 0.3)).size(0.09 * c.scale, 0.03).stretch(0.05)
          .col(p.core, 1, p.edge, 0).int(2.2).spr(SPR.streak).mode(M.streak).drag(2.5).grav(-6).fade(0, FO.cubic).emit();
      }
      c.acc1 += dt * 9 * fx.density;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        const ang = rng.f() * TAU;
        const r = R * rng.r(0.6, 1.0);
        fx.alp.at(c.x + Math.sin(ang) * r, c.y + 0.12, c.z + Math.cos(ang) * r).vel(Math.cos(ang) * 1.6, 0.3, -Math.sin(ang) * 1.6).life(rng.r(0.5, 0.8)).size(0.35 * c.scale, 1.0 * c.scale)
          .col(PALETTES.dust.main, 0.3, PALETTES.dust.main, 0).spr(SPR.dust0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(1)).drag(1.5).fade(1, FO.sq, SC.out).emit();
      }
    },
  };
}

function leap(): PresetDef {
  return {
    id: 'leap.arc',
    cat: 'melee',
    desc: 'leap: take-off burst at x,z, glowing arc trail, landing shockwave + dust + chunks at tx,tz after `duration` (0.5 s). a = landing radius.',
    size: 'radius',
    base: 2.2,
    palette: 'wolfmanIndigo',
    variants: true,
    dur: 0.5,
    loop: false,
    needsTarget: true,
    demo: { dir: 0, target: 6 },
    fire(fx, c) {
      const p = c.pal;
      const rng = fx.rng;
      const T = c.duration;
      const ex = c.hasTarget ? c.tx : c.x + c.dx * 6;
      const ez = c.hasTarget ? c.tz : c.z + c.dz * 6;
      const ey = fx.heightAt(ex, ez);
      // take-off
      dustRing(fx, c.x, c.y, c.z, fx.n(8), 1.6, 0.5, PALETTES.dust.main, 0.4, 1.0);
      flash(fx, c.x, c.y + 0.6, c.z, 1.2, 0.4, 0.18, p.core, 2.2);
      shockRing(fx, c.x, c.z, 1.6, 0.3, p, 0.2, 1.2);
      // arc trail: glow blobs scheduled along the parabola
      const g = -14;
      const vy = -0.5 * g * T;
      const lift = 0.9;
      for (let i = 0, n = fx.n(14); i < n; i++) {
        const f = (i + 0.5) / n;
        const t = f * T;
        const x = c.x + (ex - c.x) * f, z = c.z + (ez - c.z) * f;
        const y = c.y + lift + vy * t + 0.5 * g * t * t;
        fx.add.at(x, y, z).size(0.6 * c.scale, 0.1).life(0.28).delay(t).col(p.main, 0.9, p.edge, 0).int(1.8).spr(SPR.glow).fade(0, FO.quad).emit();
        if (i % 2 === 0) fx.add.at(x, y, z).vel(rng.s2(1), rng.r(0, 1), rng.s2(1)).size(0.14, 0.03).life(0.35).delay(t).col(p.core, 1, p.edge, 0).int(2).spr(SPR.ember0).twinkle().fade(0, FO.quad).emit();
      }
      // landing
      const R = c.a > 0 ? c.a : c.radius;
      shockRing(fx, ex, ez, R * 1.6, 0.5, p, 0.2, 1.8, T);
      dustRing(fx, ex, ey, ez, fx.n(14), R * 1.4, 0.7, PALETTES.dust.main, 0.5, 1.2, T);
      flash(fx, ex, ey + 0.4, ez, 2.2, 0.5, 0.22, p.core, 3, T);
      sparks(fx, ex, ey + 0.2, ez, fx.n(12), 4, 10, 1.6, 0.2, 0.42, 0.11, p.core, p.edge, 0, 0, 1, 2.4, -10, T);
      chunks(fx, ex, ey + 0.2, ez, fx.n(5), 4, 0.12, 0x6a5a40, 0x3a3020, 0, 1.0, ey, T);
    },
  };
}

/** the nova's ring gain (x the stock 2.0 / 1.4 / 1.0 ring intensities) and ring band (fraction of R; the stock rings are forced to >= 0.3 R wide) */
const NOVA_RING_GAIN = 0.5;
const NOVA_RING_BAND = 0.1;

/**
 * `groundless`: the caller lays its own ground layer (the physical default skips its chunks + scorch decal).
 * `nova`: the shared awakening blast (`vfx_nova` -> shock.wave, fired by every rank-7 cast and by the boss ring) is capped once here (leftovers L6, 2026-10-27):
 * its physical-flavour scorch decal was drawn in the palette's cream `main` (bright, white crack veins) and on a light floor it was the thick white band of every
 * awakening (earthquake 20.2 %, rending_gale 20.8 % of the centre crop above luma 0.85 at 0.3 s; with the nova dropped earthquake measures 0.4 %), and the three
 * stacked additive rings on forced 0.3 R bands summed over 4 in HDR; the fire flavour's scorch decal in its yellow `main` was the same band for coil_of_flame
 * (23 % at 0.3 s): now a dark tan / burnt-orange mark and thin rings at half the intensity.
 */
function shockBody(fx: Fx, c: Ctx, R: number, life: number, groundless = false, nova = false): void {
  const p = c.pal;
  const rng = fx.rng;
  const el = c.element < 0 ? 0 : c.element;
  const x = c.x, z = c.z, y = c.y;
  // the nova (every rank-7 cast): the three stacked rings (2.0 + 1.4 + 1.0 additive on forced 0.3-R wide bands) summed over 4 in HDR and filled the ring band with
  // cream (coil_of_flame 23 % white at 0.3 s): thin bands at half the intensity keep the pulse and stop the fill
  const k = nova ? NOVA_RING_GAIN : 1;
  const band = nova ? NOVA_RING_BAND : 0.3;
  flash(fx, x, y + 0.5, z, R * 0.32, R * 0.1, 0.16, p.core, 2.6 * k);
  shockRing(fx, x, z, R, life, p, nova ? band : 0.24, 2.0 * k, 0, band);
  shockRing(fx, x, z, R * 0.72, life * 0.8, p, nova ? band : 0.14, 1.4 * k, 0.05, band);
  if (fx.detail >= 2) shockRing(fx, x, z, R * 1.05, life * 1.15, p, nova ? band : 0.07, 1.0 * k, 0.1, band);
  dustRing(fx, x, y, z, fx.n(14 + R * 2), R * 0.95, life * 1.2, el === 2 ? 0xdfeeff : PALETTES.dust.main, 0.42, 0.9 + R * 0.12);
  switch (el) {
    case 1: // fire: flame ring wall + embers + scorch
      fx.shp.ground(x, z, 0).cyl(R * 0.78, R * 0.9, 1.5).pat(PAT.flame).life(life * 1.4).delay(0.04).col(p.main, 1, p.edge, 1).int(1.7 * k).fade(FO.sq).expand(0.2).seed(rng.f() * 9).emit();
      embers(fx, x, y, z, fx.n(18), R * 0.8, 2.2, 0.6, 1.2, 0.22, p.core, p.edge, 0.05);
      fx.dec.ground(x, z, 0.02).disk(R * 0.8).pat(PAT.scorch).life(5).col(nova ? 0x7a3c14 : p.main, nova ? 0.85 : 1, p.smoke, 0.6).fade(FO.late).seed(rng.f() * 9).emit();
      break;
    case 2: // ice: shard burst + frost
      chunks(fx, x, y + 0.3, z, fx.n(10), R * 1.3, 0.16, 0xcfeeff, 0x7fc4ff, 0.6, 1.3, y);
      fx.dec.ground(x, z, 0.02).disk(R * 0.85).pat(PAT.frost).life(4.5).col(p.core, 1, p.main, 0.7).fade(FO.late).seed(rng.f() * 9).emit();
      for (let i = 0, n = fx.n(8); i < n; i++) fx.add.at(x + rng.s2(R * 0.7), y + 0.2, z + rng.s2(R * 0.7)).vel(0, rng.r(0.6, 1.4), 0).size(0.5, 0.1).life(rng.r(0.5, 0.9)).delay(0.1).col(p.core, 1, p.main, 0).int(2).spr(SPR.glint).twinkle().fade(1, FO.quad).emit();
      break;
    case 3: // lightning: radial ground bolts
      for (let i = 0, n = Math.round(6 * (0.6 + fx.density * 0.4)); i < n; i++) {
        const a = (i / n) * TAU + rng.s2(0.3);
        fx.rb.width(0.16).life(0.2).col(p.core, p.main).jag(0.4).branch(1).delay(rng.r(0, 0.06)).bolt(x, y + 0.25, z, x + Math.sin(a) * R * 0.95, y + 0.25, z + Math.cos(a) * R * 0.95);
      }
      break;
    case 4: // dark: smoke tendrils + ember
      smoke(fx, x, y + 0.2, z, fx.n(8), R * 0.8, 0.8, 0.8, 1.4, 0.8, 2.2, p.smoke, 0.6, 0.05);
      embers(fx, x, y, z, fx.n(10), R * 0.8, 1.6, 0.6, 1.1, 0.2, p.extra, p.edge, 0.05);
      fx.dec.ground(x, z, 0.02).disk(R * 0.8).pat(PAT.scorch).life(4).col(p.main, 1, p.smoke, 0.7).fade(FO.late).seed(rng.f() * 9).emit();
      break;
    case 5: // poison: gas + pool
      smoke(fx, x, y + 0.3, z, fx.n(10), R * 0.8, 0.6, 0.9, 1.5, 0.8, 2.2, p.main, 0.4, 0.05);
      fx.dec.ground(x, z, 0.02).disk(R * 0.8).pat(PAT.pool).life(4).col(p.core, 1, p.edge, 0.7).fade(FO.late).seed(rng.f() * 9).emit();
      break;
    case 6: // holy: light pillars + glints
      for (let i = 0, n = 5; i < n; i++) {
        const a = (i / n) * TAU;
        fx.shp.ground(x + Math.sin(a) * R * 0.55, z + Math.cos(a) * R * 0.55, 0).cyl(0.35, 0.15, 3).pat(PAT.pillar).life(0.6).delay(0.06 + i * 0.03).col(p.core, 1, p.main, 1).int(1.6).fade(FO.sq).seed(i).emit();
      }
      for (let i = 0, n = fx.n(10); i < n; i++) fx.add.at(x + rng.s2(R * 0.7), y + 0.2, z + rng.s2(R * 0.7)).vel(0, rng.r(1, 2.2), 0).size(0.5, 0.1).life(rng.r(0.5, 1)).delay(0.1).col(p.core, 1, p.main, 0).int(2).spr(SPR.glint).twinkle().fade(1, FO.quad).emit();
      break;
    case 7: // wind: swirl streaks
      for (let i = 0, n = fx.n(14); i < n; i++) {
        const a = rng.f() * TAU;
        fx.add.at(x + Math.sin(a) * R * 0.3, y + 0.3, z + Math.cos(a) * R * 0.3).vel(Math.sin(a + 1.2) * R * 1.6, rng.r(0, 0.6), Math.cos(a + 1.2) * R * 1.6).size(0.14, 0.05).life(0.4).stretch(0.12)
          .col(p.core, 0.9, p.main, 0).int(1.6).spr(SPR.streak).mode(M.streak).drag(3).fade(0, FO.cubic).emit();
      }
      break;
    default: // physical: chunks + crack scorch
      if (groundless) break;
      chunks(fx, x, y + 0.2, z, fx.n(6), R * 1.1, 0.14, 0x7a6a50, 0x3a3226, 0, 1.0, y);
      fx.dec.ground(x, z, 0.02).disk(R * 0.7).pat(PAT.scorch).life(4).col(nova ? 0x6e5430 : p.main, nova ? 0.85 : 1, 0x1a1410, 0.5).fade(FO.late).seed(rng.f() * 9).emit();
  }
  void haloRing;
}

function shockWave(): PresetDef {
  return {
    id: 'shock.wave',
    cat: 'area',
    desc: 'shockwave: expanding ground rings, dust ring and element flavour (flame wall, ice shards, ground bolts, gas, light pillars, wind streaks). duration = expand time.',
    size: 'radius',
    base: 4,
    palette: 'physical',
    variants: true,
    dur: 0.55,
    loop: false,
    demo: {},
    fire(fx, c) {
      // ice flavour: the signature crown (blades erupting ring by ring on a rime sheet, vapour dome, shock rings) replaces the batched
      // burst; every other flavour, and ice when the tier / budget / pool does not run it, plays the batched recipe
      if (c.element === 2 && castEl(fx, 'frost.nova', c, 0, 0)) return;
      shockBody(fx, c, c.radius, c.duration, false, true);
    },
  };
}

function quake(): PresetDef {
  return {
    id: 'shock.quake',
    cat: 'area',
    desc: 'Earthquake / heavy slam resolve: glowing ground cracks, rock chunks, double ring, dust wall.',
    size: 'radius',
    base: 6,
    palette: 'warriorGold',
    variants: true,
    dur: 0.7,
    loop: false,
    demo: {},
    fire(fx, c) {
      const R = c.radius;
      const p = c.pal;
      const rng = fx.rng;
      // signature quake: a molten fissure network, slabs lifting off the floor and a pressure lens replace the flat cracks and batched chunks
      const sig = castEl(fx, 'impact.fissure', c, 1, 0);
      shockBody(fx, c, R, c.duration, sig);
      if (!sig) {
        fx.shp.ground(c.x, c.z, 0.05).disk(R * 0.95).pat(PAT.cracks).life(2.4).col(p.core, 1, p.edge, 1).int(1.6).fade(FO.late).seed(rng.f() * 9).emit();
      }
      // the cracks are the only glow when the signature effect runs: the decal underneath is plain char
      fx.dec.ground(c.x, c.z, 0.03).disk(R * 0.95).pat(PAT.scorch).life(5).col(sig ? 0x2a1c10 : p.main, 1, 0x120c08, 0.5).fade(FO.late).seed(rng.f() * 9).emit();
      if (!sig) chunks(fx, c.x, c.y + 0.3, c.z, fx.n(14), R * 1.2, 0.2, 0x7a6a50, 0x3a3226, 0.0, 1.3, c.y);
      else fx.shake(0.22 * Math.min(1.5, R / 6));
      smoke(fx, c.x, c.y + 0.3, c.z, fx.n(8), R * 0.5, 1.2, 0.9, 1.5, 1.2, 3.2, PALETTES.dust.main, 0.5, 0.05);
      glow(fx, c.x, c.y + 0.6, c.z, R * 0.9, R * 0.25, 0.25, p.main, 0.4, 1.1);
    },
  };
}

function howl(): PresetDef {
  return {
    id: 'shock.howl',
    cat: 'area',
    desc: 'Wolf Howl: concentric sound rings with rising wisps and a moon-pale flash.',
    size: 'radius',
    base: 5,
    palette: 'wolfmanIndigo',
    variants: true,
    dur: 0.9,
    loop: false,
    demo: {},
    fire(fx, c) {
      const R = c.radius;
      const p = c.pal;
      const rng = fx.rng;
      flash(fx, c.x, c.y + 1.2, c.z, R * 0.4, R * 0.12, 0.3, p.core, 2.6);
      for (let i = 0; i < 3; i++) shockRing(fx, c.x, c.z, R * (1 - i * 0.18), c.duration * (1 - i * 0.1), p, 0.12, 1.5, i * 0.14);
      for (let i = 0; i < 3; i++) haloRing(fx, c.x, c.y + 1.2, c.z, 0.6, R * 1.4, c.duration, p.main, 0.5, 1.2, i * 0.14);
      for (let i = 0, n = fx.n(12); i < n; i++) {
        const a = rng.f() * TAU;
        fx.add.at(c.x + Math.sin(a) * 0.5, c.y + 0.9, c.z + Math.cos(a) * 0.5).vel(Math.sin(a) * R * 1.1, rng.r(0.2, 1.4), Math.cos(a) * R * 1.1).size(0.7 * c.scale, 1.8 * c.scale).life(rng.r(0.6, 1.0))
          .col(p.main, 0.35, p.core, 0).int(1.2).spr(SPR.cloud).rot(a, rng.s2(0.5)).drag(2.2).fade(1, FO.sq, SC.out).emit();
      }
      dustRing(fx, c.x, c.y, c.z, fx.n(12), R * 0.9, 0.9, p.smoke, 0.3, 1.1, 0.05);
    },
  };
}

function anvilfall(): PresetDef {
  return {
    id: 'ult.anvilfall',
    cat: 'area',
    desc: 'Warrior ultimate: the strike lands in a flash and splits the ground. Molten fissures race out to the radius, slabs heave off the floor, a triple slam ring rolls out over a dust wall, and the camera shudders.',
    size: 'radius',
    base: 5,
    palette: 'warriorGold',
    variants: true,
    dur: 0.9,
    loop: false,
    demo: {},
    fire(fx, c) {
      const R = c.radius;
      const p = c.pal;
      const rng = fx.rng;
      const x = c.x, y = c.y, z = c.z;
      const s = R / 5;
      // fissure network + heaved slabs; flat cracks and batched chunks stand in when the tier doesn't run it
      const sig = castEl(fx, 'impact.fissure', c, 1.4, 0);
      // the strike: a spike of light driven into the ground, the flash and the pressure glow
      pillar(fx, x, z, R * 0.14, 15, 0.24, p, 3.4);
      flash(fx, x, y + 0.7, z, R * 0.7, R * 0.2, 0.2, p.core, 3.8);
      glow(fx, x, y + 1, z, R * 1.5, R * 0.55, 0.5, p.main, 0.8, 1.6);
      // the slam: three staggered rings, the last wide and slow, plus a billboard halo
      shockRing(fx, x, z, R * 1.15, 0.55, p, 0.22, 2.6);
      shockRing(fx, x, z, R * 0.78, 0.45, p, 0.14, 1.9, 0.05);
      shockRing(fx, x, z, R * 1.6, 0.95, p, 0.06, 1.3, 0.12);
      haloRing(fx, x, y + 0.5, z, R * 0.3, R * 1.5, 0.5, p.core, 0.6, 1.4);
      dustRing(fx, x, y, z, fx.n(16 + R * 2), R * 1.15, 1.2, PALETTES.dust.main, 0.45, 1 + R * 0.1);
      if (!sig) {
        fx.shp.ground(x, z, 0.05).disk(R * 0.95).pat(PAT.cracks).life(2.6).col(p.core, 1, p.edge, 1).int(1.6).fade(FO.late).seed(rng.f() * 9).emit();
        chunks(fx, x, y + 0.3, z, fx.n(18), R * 1.3, 0.22, 0x7a6a50, 0x3a3226, 0, 1.4, y);
      }
      // the cracks are the only glow when the signature effect runs: the decal underneath is plain char
      fx.dec.ground(x, z, 0.03).disk(R * 0.95).pat(PAT.scorch).life(6).col(sig ? 0x2a1c10 : p.main, 1, 0x120c08, 0.5).fade(FO.late).seed(rng.f() * 9).emit();
      smoke(fx, x, y + 0.3, z, fx.n(10), R * 0.55, 1.3, 1, 1.7, 1.2 * s, 3.4 * s, PALETTES.dust.main, 0.5, 0.05);
      sparks(fx, x, y + 0.3, z, fx.n(18), R * 1.2, R * 2.6, 1.6, 0.3, 0.7, 0.1 * s, p.core, p.main, 0, 0, 1, 2.4, -9);
      embers(fx, x, y, z, fx.n(16), R * 0.8, 3, 0.9, 1.8, 0.2 * s, p.core, p.main, 0.1);
      fx.shake(0.55);
    },
  };
}

const LOCAL: PresetDef[] = [
  slash(),
  claw(),
  stab(),
  flurry(),
  spinBlades(),
  leap(),
  shockWave(),
  quake(),
  howl(),
  anvilfall(),
];

export const MELEE_PRESETS: PresetDef[] = pickPresets(
  [
    'melee.slash',
    'melee.claw',
    'melee.stab',
    'melee.flurry',
    'spin.blades',
    'aura.ring',
    'dash.streak',
    'leap.arc',
    'shock.wave',
    'shock.quake',
    'shock.howl',
    'ult.anvilfall',
  ],
  LOCAL, PLAYER_FEEDBACK.presets,
);

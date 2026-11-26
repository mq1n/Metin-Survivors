// Sky strikes, chains and beams: sky.*, chain.bolt, beam.line (owner: VfxSky).
import type { Ctx, Fx } from '../emit';
import { PALETTES } from '../palette';
import type { Inst } from '../system';
import { mixHex } from '../util';
import { castEl } from './el';
import { FB, FO, M, PAT, SC, SPR, TAU, chunks, dustRing, embers, fireBurst, flash, glow, haloRing, scorch, shockRing, smoke, smokeBurst, sparks, swirlBurst, wisps } from './kit';
import type { PresetDef } from './types';

const DUST = PALETTES.dust.main;
/** gravity applied to every falling body (m/s²) */
const FALL_G = -34;
/** game camera (pitch 55°) screen-up vector, used to orient billboards along a fall */
const CAM_UP_Y = 0.574;
const CAM_UP_Z = 0.819;

// scratch outputs of the path helpers (module level: presets allocate nothing)
let FV_X = 0;
let FV_Y = 0;
let FV_Z = 0;
let TF = 0;
let T0 = 0;
let TI = 0;
let PX = 0;
let PY = 0;
let PZ = 0;

/** initial velocity so a body starting at p0 reaches p0 + (dx,dy,dz) after `tf` seconds under FALL_G */
function fallVel(dx: number, dy: number, dz: number, tf: number): void {
  FV_X = dx / tf;
  FV_Z = dz / tf;
  FV_Y = dy / tf - 0.5 * FALL_G * tf;
}

/** position on the current fall path `t` seconds after the start point (writes PX..PZ) */
function pathAt(sx: number, sy: number, sz: number, t: number): void {
  PX = sx + FV_X * t;
  PY = sy + FV_Y * t + 0.5 * FALL_G * t * t;
  PZ = sz + FV_Z * t;
}

/** fall time (≤ base), start delay and impact time for a strike `T` seconds from now (writes TF, T0, TI) */
function timing(T: number, base: number): void {
  TF = Math.max(0.1, Math.min(T, base));
  TI = Math.max(T, TF);
  T0 = TI - TF;
}

/** billboard roll that points a sprite's tip (+y) along the screen-projected fall direction */
function fallRot(): number {
  return Math.atan2(-FV_X, FV_Y * CAM_UP_Y - FV_Z * CAM_UP_Z);
}

function elementOf(c: Ctx, native: number): number {
  return c.element >= 0 ? c.element : native;
}

/** velocity-stretched streak riding the current fall path */
function fStreak(fx: Fx, sx: number, sy: number, sz: number, at: number, tf: number, w: number, k: number, cell: number, hex0: number, a0: number, hex1: number, a1: number, int: number): void {
  fx.add.at(sx, sy, sz).vel(FV_X, FV_Y, FV_Z).grav(FALL_G).life(tf).delay(at).size(w, w).stretch(k)
    .col(hex0, a0, hex1, a1).int(int).spr(cell).mode(M.streak).fade(0, FO.snap).emit();
}

/** round sprite riding the current fall path */
function fHead(fx: Fx, sx: number, sy: number, sz: number, at: number, tf: number, s0: number, s1: number, hex0: number, a0: number, hex1: number, int: number, cell: number): void {
  fx.add.at(sx, sy, sz).vel(FV_X, FV_Y, FV_Z).grav(FALL_G).life(tf).delay(at).size(s0, s1).col(hex0, a0, hex1, a0).int(int).spr(cell).fade(0, FO.snap).emit();
}

// ----------------------------------------------------------------------------------------------------------- shared pieces

/** ground target marker: telegraph fill + rune circle (+ falling-shadow cue), visible until the impact, then snaps off */
function marker(fx: Fx, c: Ctx, x: number, z: number, R: number, T: number, shadow: boolean): void {
  if (T < 0.08 || c.a > 0) return;
  const p = c.pal;
  const life = T / 0.88 + 0.04;
  const sd = c.seed * 9;
  fx.dec.ground(x, z, 0.03).disk(R).pat(PAT.tele).life(life).col(p.main, 0.9, p.edge, 0.9).fade(FO.snap).emit();
  fx.shp.ground(x, z, 0.05).disk(R * 1.12).pat(PAT.rune).expand(0.6).life(life).col(p.main, 0.9, p.edge, 0.9).int(1.15 * c.intensity).fade(FO.snap).seed(sd).emit();
  if (shadow) fx.dec.ground(x, z, 0.02).disk(R * 1.5).pat(PAT.shadow).life(life).col(0x000000, 1, 0x07080c, 0.9).fade(FO.snap).seed(sd).emit();
}

/** shared impact punch: hot flash, soft glow, billboard + ground rings, dust, sparks. P = strength (1 = strike) */
function impactBase(fx: Fx, c: Ctx, x: number, y: number, z: number, R: number, T: number, P: number, halo = true): void {
  const p = c.pal;
  const I = c.intensity;
  flash(fx, x, y + 0.5, z, R * 1.5, R * 0.45, 0.16, p.core, 3.4 * I, T);
  glow(fx, x, y + 0.8, z, R * 2.4, R * 1.2, 0.4, p.main, 0.8, 1.2 * I, T);
  if (halo) haloRing(fx, x, y + 0.5, z, R * 0.5, R * 2.8, 0.4, p.main, 0.7, 1.3, T);
  shockRing(fx, x, z, R * 1.5, 0.46, p, 0.2, 2 * I, T);
  if (fx.detail >= 1) shockRing(fx, x, z, R * 1.02, 0.34, p, 0.12, 1.4, T + 0.05);
  dustRing(fx, x, y, z, fx.n(5 + 4 * P), R * 1.2, 0.7, DUST, 0.34, 0.8 + R * 0.2, T);
  sparks(fx, x, y + 0.3, z, fx.n(8 + 6 * P), 4, 9 * P, 1.4, 0.2, 0.45, 0.1, p.core, p.edge, 0, 0, 1, 2.4, -10, T);
}

/** element-specific ground aftermath + secondary particles at an impact */
function flavor(fx: Fx, c: Ctx, x: number, y: number, z: number, R: number, T: number, el: number): void {
  const p = c.pal;
  const rng = fx.rng;
  const sd = rng.f() * 9;
  switch (el) {
    case 1: {
      fx.dec.ground(x, z, 0.02).disk(R * 1.5).pat(PAT.scorch).life(6).delay(T).col(p.edge, 1, p.smoke, 0.85).int(0.55).fade(FO.late).seed(sd).emit();
      fx.shp.ground(x, z, 0.05).disk(R * 1.2).pat(PAT.cracks).life(2.2).delay(T).col(p.main, 1, p.edge, 1).int(1.0).fade(FO.late).seed(sd + 3).emit();
      for (let i = 0, n = fx.n(7); i < n; i++) {
        const a = rng.f() * TAU;
        const r = Math.sqrt(rng.f()) * R * 0.95;
        fx.add.at(x + Math.sin(a) * r, y + 0.05, z + Math.cos(a) * r).vel(0, rng.r(0.2, 0.8), 0).size(R * 0.18, R * 0.55 * rng.r(0.7, 1.2)).life(rng.r(0.45, 0.8)).delay(T + rng.r(0.03, 0.16))
          .col(p.main, 1, p.edge, 0).int(1.7).spr(SPR.flame0 + rng.i(4)).mode(M.upright).stretch(1.7).wob(0.08).fade(0, FO.quad, SC.bell).emit();
      }
      embers(fx, x, y + 0.2, z, fx.n(10), R * 0.9, 2.4, 0.7, 1.4, 0.2, p.core, p.edge, T + 0.04);
      break;
    }
    case 2: {
      fx.dec.ground(x, z, 0.02).disk(R * 1.35).pat(PAT.frost).life(5).delay(T).col(p.main, 1, p.edge, 0.8).fade(FO.late).seed(sd).emit();
      chunks(fx, x, y + 0.3, z, fx.n(7), R * 2.4, 0.12 * R, p.core, p.main, 0.7, 1.2, y, T);
      for (let i = 0, n = fx.n(6); i < n; i++) {
        fx.add.at(x + rng.s2(R * 0.9), y + 0.2, z + rng.s2(R * 0.9)).vel(0, rng.r(0.6, 1.5), 0).size(0.55, 0.12).life(rng.r(0.5, 0.95)).delay(T + rng.r(0.05, 0.25))
          .col(p.core, 1, p.main, 0).int(2).spr(SPR.glint).twinkle().fade(1, FO.quad).emit();
      }
      smoke(fx, x, y + 0.2, z, fx.n(3), R * 0.8, 0.7, 0.7, 1.1, R * 0.7, R * 1.8, 0xeaf6ff, 0.35, T + 0.04);
      break;
    }
    case 3: {
      const n = Math.round(6 * (0.6 + fx.density * 0.4));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rng.s2(0.35);
        const L = R * rng.r(1.0, 1.5);
        fx.rb.width(0.16).life(0.2).col(p.core, p.main).jag(0.45).branch(1).delay(T + rng.r(0, 0.07)).bolt(x, y + 0.25, z, x + Math.sin(a) * L, y + 0.25, z + Math.cos(a) * L);
      }
      fx.shp.ground(x, z, 0.05).disk(R * 1.1).pat(PAT.cracks).life(0.9).delay(T).col(p.main, 1, p.edge, 1).int(1.5).fade(FO.late).seed(sd).emit();
      fx.dec.ground(x, z, 0.02).disk(R * 1.1).pat(PAT.scorch).life(4.5).delay(T).col(p.edge, 1, 0x0e1016, 0.8).int(0.7).fade(FO.late).seed(sd + 2).emit();
      for (let i = 0, k = fx.n(4); i < k; i++) {
        fx.add.at(x + rng.s2(R * 0.8), y + 0.5, z + rng.s2(R * 0.8)).size(R * 0.7, R * 1.0).life(rng.r(0.08, 0.14)).delay(T + rng.r(0, 0.14))
          .col(p.core, 1, p.main, 0).int(2.4).spr(SPR.arc0 + rng.i(3)).rot(rng.f() * TAU).twinkle().fade(0, FO.cube).emit();
      }
      break;
    }
    case 4: {
      fx.dec.ground(x, z, 0.02).disk(R * 1.45).pat(PAT.scorch).life(5).delay(T).col(p.main, 1, p.smoke, 0.9).fade(FO.late).seed(sd).emit();
      fx.shp.ground(x, z, 0.06).disk(R * 1.3).pat(PAT.arcane).life(1.3).delay(T).col(p.main, 1, p.edge, 1).int(1.5).fade(FO.late).seed(sd).emit();
      smokeBurst(fx, x, y + R * 0.5, z, R * 2.6, 1.3, p.edge, p.smoke, 0.8, T + 0.05, 0.9);
      smoke(fx, x, y + 0.3, z, fx.n(5), R * 0.9, 0.9, 0.9, 1.5, R * 0.8, R * 2.2, p.smoke, 0.6, T + 0.05);
      embers(fx, x, y + 0.2, z, fx.n(9), R * 0.9, 1.7, 0.6, 1.2, 0.2, p.extra, p.main, T + 0.05);
      break;
    }
    case 5: {
      fx.dec.ground(x, z, 0.02).disk(R * 1.35).pat(PAT.pool).life(5).delay(T).col(p.core, 1, p.edge, 0.8).fade(FO.late).seed(sd).emit();
      for (let i = 0, n = fx.n(10); i < n; i++) {
        const a = rng.f() * TAU;
        const v = rng.r(2.5, 6.5);
        fx.alp.at(x, y + 0.3, z).vel(Math.sin(a) * v, rng.r(2.5, 5.5), Math.cos(a) * v).size(0.3 * rng.r(0.6, 1.2), 0.18).life(rng.r(0.45, 0.8)).delay(T)
          .col(p.main, 0.95, p.edge, 0.7).spr(SPR.drop).rot(rng.f() * TAU).grav(-14).floor(y).fade(0, FO.snap).emit();
      }
      smoke(fx, x, y + 0.3, z, fx.n(5), R * 0.9, 0.7, 0.9, 1.5, R * 0.8, R * 2.1, p.main, 0.4, T + 0.05);
      break;
    }
    case 6: {
      fx.shp.ground(x, z, 0.05).disk(R * 1.5).pat(PAT.holy).life(1.3).delay(T).col(p.main, 1, p.edge, 1).int(1.3).fade(FO.late).seed(sd).emit();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + sd;
        fx.shp.ground(x + Math.sin(a) * R * 0.75, z + Math.cos(a) * R * 0.75, 0).cyl(R * 0.2, R * 0.08, 3.2).pat(PAT.pillar).life(0.65).delay(T + 0.05 + i * 0.03).col(p.core, 1, p.main, 1).int(1.6).fade(FO.sq).seed(i).emit();
      }
      for (let i = 0, n = fx.n(9); i < n; i++) {
        fx.add.at(x + rng.s2(R * 0.9), y + 0.2, z + rng.s2(R * 0.9)).vel(0, rng.r(1, 2.4), 0).size(0.5, 0.1).life(rng.r(0.6, 1.1)).delay(T + rng.r(0.05, 0.3))
          .col(p.core, 1, p.main, 0).int(2).spr(SPR.glint).twinkle().fade(1, FO.quad).emit();
      }
      break;
    }
    case 7: {
      for (let i = 0, n = fx.n(14); i < n; i++) {
        const a = rng.f() * TAU;
        fx.add.at(x + Math.sin(a) * R * 0.3, y + 0.3, z + Math.cos(a) * R * 0.3).vel(Math.sin(a + 1.2) * R * 2, rng.r(0, 0.7), Math.cos(a + 1.2) * R * 2).size(0.14, 0.05).life(0.45).delay(T).stretch(0.12)
          .col(p.core, 0.9, p.main, 0).int(1.6).spr(SPR.streak).mode(M.streak).drag(3).fade(0, FO.cubic).emit();
      }
      for (let i = 0, n = fx.n(5); i < n; i++) {
        const a = rng.f() * TAU;
        fx.alp.at(x, y + 0.4, z).vel(Math.sin(a + 0.9) * R * 1.6, rng.r(0.8, 2), Math.cos(a + 0.9) * R * 1.6).size(0.4, 0.3).life(rng.r(0.7, 1.1)).delay(T)
          .col(p.edge, 0.9, p.main, 0.5).spr(SPR.leaf0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(9)).drag(1.5).grav(-1.5).wob(0.2).fade(0, FO.quad).emit();
      }
      fx.shp.ground(x, z, 0.05).disk(R * 1.3).pat(PAT.arcane).life(0.9).delay(T).col(p.main, 1, p.edge, 1).int(1.2).fade(FO.late).seed(sd).emit();
      break;
    }
    default: {
      chunks(fx, x, y + 0.3, z, fx.n(8), R * 2.2, 0.13 * R, 0x8a7a60, 0x4a4032, 0, 1.2, y, T);
      fx.dec.ground(x, z, 0.02).disk(R * 1.3).pat(PAT.scorch).life(5).delay(T).col(p.main, 0.7, 0x1a1410, 0.7).fade(FO.late).seed(sd).emit();
      fx.shp.ground(x, z, 0.05).disk(R * 1.2).pat(PAT.cracks).life(1.8).delay(T).col(p.main, 1, p.edge, 1).int(1.2).fade(FO.late).seed(sd + 3).emit();
      smoke(fx, x, y + 0.3, z, fx.n(5), R * 0.9, 1.0, 0.9, 1.5, R * 0.9, R * 2.4, DUST, 0.45, T + 0.04);
    }
  }
}

/** tiny per-element accent where a small projectile lands */
function tinyImpact(fx: Fx, c: Ctx, el: number, x: number, y: number, z: number, s: number, delay: number): void {
  const p = c.pal;
  const rng = fx.rng;
  switch (el) {
    case 1:
      embers(fx, x, y, z, 1, 0.1, 1.8, 0.35, 0.7, 0.2 * s, p.core, p.edge, delay);
      break;
    case 2:
      fx.add.at(x, y + 0.1, z).vel(rng.s2(1.2), rng.r(1, 2.4), rng.s2(1.2)).size(0.26 * s, 0.1 * s).life(0.4).delay(delay).col(p.core, 1, p.main, 0).int(1.8).spr(SPR.shard).rot(rng.f() * TAU, rng.s2(8)).grav(-8).fade(0, FO.quad).emit();
      break;
    case 3:
      fx.add.at(x, y + 0.2, z).size(0.7 * s, 1.0 * s).life(rng.r(0.08, 0.13)).delay(delay).col(p.core, 1, p.main, 0).int(2.4).spr(SPR.arc0 + rng.i(3)).rot(rng.f() * TAU).twinkle().fade(0, FO.cube).emit();
      break;
    case 4:
      smoke(fx, x, y, z, 1, 0.1, 0.5, 0.45, 0.8, 0.3 * s, 0.9 * s, p.smoke, 0.5, delay);
      break;
    case 5:
      fx.alp.at(x, y + 0.1, z).vel(rng.s2(1), rng.r(1.2, 2.6), rng.s2(1)).size(0.2 * s, 0.12 * s).life(0.45).delay(delay).col(p.main, 0.95, p.edge, 0.7).spr(SPR.drop).grav(-10).fade(0, FO.snap).emit();
      break;
    case 6:
      fx.add.at(x, y + 0.1, z).vel(0, rng.r(0.8, 1.6), 0).size(0.4 * s, 0.08 * s).life(0.5).delay(delay).col(p.core, 1, p.edge, 0).int(2).spr(SPR.glint).twinkle().fade(1, FO.quad).emit();
      break;
    case 7:
      fx.add.at(x, y + 0.1, z).vel(rng.s2(2.5), 0.4, rng.s2(2.5)).size(0.1 * s, 0.04 * s).life(0.28).delay(delay).stretch(0.12).col(p.core, 0.9, p.main, 0).int(1.6).spr(SPR.streak).mode(M.streak).drag(3).fade(0, FO.cubic).emit();
      break;
    default:
      smoke(fx, x, y, z, 1, 0.1, 0.4, 0.35, 0.6, 0.28 * s, 0.85 * s, DUST, 0.3, delay);
  }
}

// ----------------------------------------------------------------------------------------------------------- meteor / fireball

/** batched pieces around the signature meteor (rock, wake, dome shell, wreckage and molten cracks are `impact.meteor`) */
function meteorGround(fx: Fx, c: Ctx, R: number, T: number): void {
  const p = c.pal;
  const rng = fx.rng;
  const I = c.intensity;
  const x = c.hasTarget ? c.tx : c.x;
  const y = c.hasTarget ? c.ty : c.y;
  const z = c.hasTarget ? c.tz : c.z;
  const ti = Math.max(T, 0.3);
  const el = elementOf(c, 1);
  const sd = rng.f() * 9;
  marker(fx, c, x, z, R, ti, true);
  // detonation punch: hot flash, soft glow, billboard + ground rings, dust, rising fireball
  flash(fx, x, y + 0.5, z, R * 1.7, R * 0.5, 0.16, p.core, 3.4 * I, ti);
  glow(fx, x, y + 0.8, z, R * 2.8, R * 1.4, 0.45, p.main, 0.8, 1.2 * I, ti);
  haloRing(fx, x, y + 0.5, z, R * 0.5, R * 3.0, 0.4, p.main, 0.6, 1.3, ti);
  shockRing(fx, x, z, R * 2.0, 0.5, p, 0.18, 2 * I, ti);
  dustRing(fx, x, y, z, fx.n(8), R * 1.5, 0.8, DUST, 0.34, 0.9 + R * 0.2, ti);
  fx.add.at(x, y + R * 0.5, z).vel(0, 2.4, 0).size(R * 2.4, R * 4.4).life(0.72).delay(ti).col(p.main, 1, p.edge, 1).int(2.0).spr(FB.fire).frames(16).ramp().rot(rng.f() * TAU).fade(0, FO.late).emit();
  smokeBurst(fx, x, y + R * 0.9, z, R * 3.2, 1.3, 0x6a5a4e, p.smoke, 0.65, ti + 0.1, 1.4);
  sparks(fx, x, y + 0.3, z, fx.n(16), 4, 11, 1.4, 0.25, 0.6, 0.1, p.core, p.edge, 0, 0, 1, 2.4, -10, ti);
  // the ground keeps the mark: scorch / frost / pool by element, embers drifting off the crater while the cracks burn out
  if (el === 2) fx.dec.ground(x, z, 0.02).disk(R * 1.7).pat(PAT.frost).life(7).delay(ti).col(p.main, 1, p.edge, 0.8).fade(FO.late).seed(sd).emit();
  else if (el === 5) fx.dec.ground(x, z, 0.02).disk(R * 1.6).pat(PAT.pool).life(7).delay(ti).col(p.core, 1, p.edge, 0.8).fade(FO.late).seed(sd).emit();
  else fx.dec.ground(x, z, 0.02).disk(R * 1.6).pat(PAT.scorch).life(8).delay(ti).col(p.edge, 1, p.smoke, 0.85).int(0.55).fade(FO.late).seed(sd).emit();
  for (let i = 0; i < 6; i++) embers(fx, x, y + 0.2, z, fx.n(3), R * 1.5, 2.2, 0.8, 1.6, 0.2, p.core, p.edge, ti + 0.15 + i * 0.5);
  for (let i = 0; i < 3; i++) smoke(fx, x, y + 0.3, z, fx.n(2), R * 1.4, 1.0, 1.4, 2.2, R * 0.8, R * 2.2, p.smoke, 0.35, ti + 0.3 + i * 0.9);
}

function meteor(fx: Fx, c: Ctx, x: number, y: number, z: number, R: number, T: number, P: number): void {
  if (castEl(fx, 'impact.meteor', c, 0, 0)) {
    meteorGround(fx, c, R, T);
    return;
  }
  const p = c.pal;
  const rng = fx.rng;
  timing(T, P > 1 ? 0.55 : 0.34);
  const tf = TF, t0 = T0, ti = TI;
  const H = P > 1 ? 13 : 12;
  const ox = -H * (P > 1 ? 0.7 : 0.5) + rng.s2(0.8);
  const oz = -H * 0.3 + rng.s2(0.6);
  fallVel(-ox, -H, -oz, tf);
  const sx = x + ox, sy = y + H, sz = z + oz;
  marker(fx, c, x, z, R, ti, true);
  // body: glow halo, white-hot nucleus, long flame streaks
  fHead(fx, sx, sy, sz, t0, tf, R * 3.2, R * 2.8, p.main, 0.5, p.edge, 1.3, SPR.glow);
  fHead(fx, sx, sy, sz, t0, tf, R * 1.5, R * 1.3, p.core, 1, p.main, 3.4, SPR.glowTight);
  fStreak(fx, sx, sy, sz, t0, tf, R * 0.6, 0.085, SPR.streak, p.core, 1, p.main, 0.9, 3.0);
  fStreak(fx, sx, sy, sz, t0, tf, R * 1.7, 0.12, SPR.streakSoft, p.main, 0.9, p.edge, 0.6, 1.7);
  // wake: short flame puffs, shed sparks, thin smoke
  const nW = fx.n(14);
  for (let i = 0; i < nW; i++) {
    const t = (tf * (i + 0.6)) / (nW + 0.5);
    pathAt(sx, sy, sz, t);
    fireBurst(fx, PX + rng.s2(R * 0.1), PY, PZ, R * rng.r(0.9, 1.3), 0.22 + t * 0.1, p, 2.0, t0 + t);
    if (i % 2 === 0) {
      fx.add.at(PX, PY, PZ).vel(rng.s2(3), rng.r(-1.5, 2.5), rng.s2(3)).life(rng.r(0.35, 0.7)).delay(t0 + t).size(0.12, 0.04).stretch(0.04)
        .col(p.core, 1, p.edge, 0).int(2.4).spr(SPR.streak).mode(M.streak).grav(-8).drag(1.5).fade(0, FO.cubic).emit();
    }
    if (i % 4 === 0) smoke(fx, PX, PY, PZ, 1, 0.2, 0.4, 0.9, 1.3, R * 0.5, R * 1.3, p.smoke, 0.4, t0 + t);
  }
  // impact
  impactBase(fx, c, x, y, z, R, ti, P > 1 ? 1.4 : 1.0, false);
  fx.shp.ground(x, z, 0.06).disk(R * 1.9).pat(PAT.disk).expand(0.4).life(0.5).delay(ti).col(p.main, 1, p.edge, 1).int(1.6).fade(FO.quad).seed(rng.f() * 9).emit();
  // rising fireball + radial flame blasts flung outward
  fx.add.at(x, y + R * 0.5, z).vel(0, 2.4, 0).size(R * 2.4, R * 4.4).life(0.72).delay(ti).col(p.main, 1, p.edge, 1).int(2.3).spr(FB.fire).frames(16).ramp().rot(rng.f() * TAU).fade(0, FO.late).emit();
  for (let i = 0, n = fx.n(6); i < n; i++) {
    const a = (i / n) * TAU + rng.s2(0.4);
    const v = R * rng.r(1.4, 2.4);
    fx.add.at(x + Math.sin(a) * R * 0.2, y + R * 0.3, z + Math.cos(a) * R * 0.2).vel(Math.sin(a) * v, rng.r(1, 3.2), Math.cos(a) * v).drag(2.2)
      .size(R * 1.1, R * rng.r(1.9, 2.6)).life(rng.r(0.5, 0.75)).delay(ti + rng.r(0.01, 0.1)).col(p.main, 1, p.edge, 1).int(1.9)
      .spr(FB.fire).frames(16).ramp().rot(rng.f() * TAU).fade(0, FO.late).emit();
  }
  smokeBurst(fx, x, y + R * 0.9, z, R * 3.4, 1.3, 0x6a5a4e, p.smoke, 0.7, ti + 0.1, 1.4);
  if (fx.detail >= 1) smokeBurst(fx, x + rng.s2(R * 0.5), y + R * 0.6, z + rng.s2(R * 0.5), R * 2.6, 1.1, 0x6a5a4e, p.smoke, 0.6, ti + 0.2, 1.1);
  chunks(fx, x, y + 0.4, z, fx.n(8), R * 2.6, 0.14 * R, 0xc05a22, 0x2a2018, 0.8, 1.2, y, ti);
  flavor(fx, c, x, y, z, R, ti, elementOf(c, 1));
}

// ----------------------------------------------------------------------------------------------------------- thunderbolt

function thunder(fx: Fx, c: Ctx, x: number, y: number, z: number, R: number, T: number, k: number): void {
  const p = c.pal;
  const rng = fx.rng;
  const I = c.intensity;
  const H = 19;
  const sx = x + rng.s2(2.2);
  const sz = z - rng.r(0.5, 3);
  const sy = y + H;
  const sd = rng.f() * 9;
  marker(fx, c, x, z, R, T, false);
  // stepped leader just before the strike
  if (T >= 0.12) fx.rb.width(0.1 * k).life(0.1).col(p.main, p.main, 0.7, 0.7).int(1.3).jag(0.2).branch(2).style_(1).fade(FO.quad).delay(T - 0.09).bolt(sx, sy, sz, x, y + 0.1, z);
  // main strike: fat bolt + thin white strand + two re-strikes
  fx.rb.width(0.3 * k).life(0.3).col(p.core, p.main).int(3.0 * I).jag(0.22).branch(4).style_(1).fade(FO.cubic).delay(T).bolt(sx, sy, sz, x, y + 0.1, z);
  fx.rb.width(0.14 * k).life(0.24).col(p.core, p.core).int(4).jag(0.18).branch(2).style_(1).fade(FO.cubic).delay(T).bolt(sx, sy, sz, x, y + 0.1, z);
  fx.rb.width(0.24 * k).life(0.16).col(p.main, p.edge).int(2.2).jag(0.22).branch(3).style_(1).fade(FO.quad).delay(T + 0.11).bolt(sx, sy, sz, x, y + 0.1, z);
  if (fx.detail >= 2) fx.rb.width(0.16 * k).life(0.12).col(p.core, p.main).int(2.0).jag(0.2).branch(2).style_(1).fade(FO.quad).delay(T + 0.21).bolt(sx, sy, sz, x, y + 0.1, z);
  // illuminated column: camera-facing soft beam that races down
  const dx = x - sx, dy = y + 0.1 - sy, dz = z - sz;
  const len = Math.hypot(dx, dy, dz);
  fx.shp.at(sx, sy, sz).yaw_(Math.atan2(dx, dz)).tilt(-Math.asin(dy / len), 0).beam(1.0 * k, len).expand(0.05).pat(PAT.beam).life(0.3).delay(T)
    .col(p.main, 0.8, p.edge, 0.8).int(0.8 * I).fade(FO.quad).seed(sd).emit();
  // ground
  impactBase(fx, c, x, y, z, R, T, 1.0);
  flavor(fx, c, x, y, z, R, T, 3);
  fx.add.at(x, y + 0.7, z).size(R * 1.4, R * 3.8).life(0.26).delay(T).col(p.core, 1, p.main, 0).int(2.4).spr(SPR.sunburst).rot(rng.f() * TAU).fade(0, FO.quad).emit();
  // screen punch: exact when the strike is immediate, otherwise a big soft glow at the impact
  if (T <= 0.06) {
    fx.flash(((p.edge >> 16) & 255) / 255, ((p.edge >> 8) & 255) / 255, (p.edge & 255) / 255, 0.02, 0.1);
    fx.shake(0.12);
  } else {
    glow(fx, x, y + 3, z, 10, 14, 0.12, p.main, 0.1, 1.0, T);
  }
}

/** `sky.lightning`: the signature strike (filament bundle, ionised shell, branching burn) when the elemental layer takes it, else the batched bolt */
function skyLightning(fx: Fx, c: Ctx): void {
  // `a` only hides the marker of the batched strike; the signature effect would read it as a barrage count
  const a = c.a;
  c.a = 0;
  const taken = fx.el?.cast('storm.bolt', c) === true;
  c.a = a;
  if (!taken) {
    thunder(fx, c, c.hasTarget ? c.tx : c.x, c.hasTarget ? c.ty : c.y, c.hasTarget ? c.tz : c.z, c.radius, c.duration, 1.2);
    return;
  }
  marker(fx, c, c.hasTarget ? c.tx : c.x, c.hasTarget ? c.tz : c.z, c.radius, c.duration, false);
}

// ----------------------------------------------------------------------------------------------------------- icicles

/** one spear: falls tip-down, drives into the ground and leaves ice spikes + shards */
function spear(fx: Fx, c: Ctx, ex: number, ey: number, ez: number, ti: number, k: number): void {
  const p = c.pal;
  const rng = fx.rng;
  const tf = 0.22 + rng.r(0, 0.06);
  const at = Math.max(0, ti - tf);
  const H = 12 + rng.r(0, 3);
  const ox = -H * 0.1 + rng.s2(0.4);
  const oz = -H * 0.07 + rng.s2(0.3);
  fallVel(-ox, -H, -oz, tf);
  const sx = ex + ox, sy = ey + H, sz = ez + oz;
  const S = k;
  // body
  fx.add.at(sx, sy, sz).vel(FV_X, FV_Y, FV_Z).grav(FALL_G).life(tf).delay(at).size(S * 1.5, S * 1.5).rot(fallRot() + Math.PI).col(p.core, 1, p.main, 1).int(2.3).spr(SPR.shard).fade(0, FO.snap).emit();
  fHead(fx, sx, sy, sz, at, tf, S * 2.4, S * 2.0, p.main, 0.55, p.edge, 1.3, SPR.glow);
  fHead(fx, sx, sy, sz, at, tf, S * 0.9, S * 0.8, p.core, 1, p.main, 3.2, SPR.glowTight);
  fStreak(fx, sx, sy, sz, at, tf, S * 0.5, 0.07, SPR.streak, p.core, 1, p.main, 0.9, 2.4);
  for (let i = 0; i < 2; i++) {
    pathAt(sx, sy, sz, tf * rng.r(0.3, 0.9));
    fx.add.at(PX, PY, PZ).vel(rng.s2(0.8), rng.r(-0.5, 1.2), rng.s2(0.8)).size(0.34, 0.08).life(rng.r(0.35, 0.6)).delay(at + (PY > sy ? 0 : 0))
      .col(p.core, 1, p.main, 0).int(2).spr(SPR.sparkle).rot(rng.f() * TAU).twinkle().fade(0, FO.quad).emit();
  }
  // impact
  flash(fx, ex, ey + 0.4, ez, S * 1.1, S * 0.35, 0.12, p.core, 3.2, ti);
  if (k > c.radius) shockRing(fx, ex, ez, S * 1.5, 0.34, p, 0.18, 1.7, ti);
  for (let i = 0; i < 2; i++) {
    const a = rng.f() * TAU;
    const r = rng.r(0.05, 0.3) * S;
    const h = S * rng.r(0.55, 0.9);
    fx.add.at(ex + Math.sin(a) * r, ey - 0.05, ez + Math.cos(a) * r).size(h * 0.55, h * 0.75).life(rng.r(0.8, 1.1)).delay(ti + i * 0.03)
      .col(p.core, 1, p.main, 0.9).int(2.1).spr(SPR.shard).mode(M.upright).stretch(2.4).fade(0, FO.late, SC.out).emit();
  }
  for (let i = 0, n = fx.n(3); i < n; i++) {
    const a = rng.f() * TAU;
    const v = rng.r(2.5, 5.5);
    fx.add.at(ex, ey + 0.15, ez).vel(Math.sin(a) * v, rng.r(2, 4.5), Math.cos(a) * v).size(S * 0.34, S * 0.12).life(rng.r(0.35, 0.6)).delay(ti)
      .col(p.core, 1, p.main, 0).int(1.9).spr(SPR.shard).rot(rng.f() * TAU, rng.s2(9)).grav(-10).fade(0, FO.quad).emit();
  }
  smoke(fx, ex, ey + 0.1, ez, 1, 0.2, 0.7, 0.6, 1.0, S * 0.45, S * 1.1, 0xeaf6ff, 0.24, ti);
  chunks(fx, ex, ey + 0.2, ez, 1, 4, 0.1 * S, p.core, p.main, 0.7, 1.0, ey, ti);
}

function icicles(fx: Fx, c: Ctx, x: number, y: number, z: number, R: number, T: number, count: number): void {
  const p = c.pal;
  const rng = fx.rng;
  timing(T, 0.3);
  const ti = TI;
  marker(fx, c, x, z, R, ti, false);
  const a0 = rng.f() * TAU;
  for (let i = 0; i < count; i++) {
    const a = a0 + i * 2.399;
    const r = i === 0 ? R * 0.12 : R * 0.82 * Math.sqrt((i + 0.4) / count);
    const ex = x + Math.sin(a) * r;
    const ez = z + Math.cos(a) * r;
    const land = i === 0 ? ti : Math.max(0.22, ti - rng.r(0.02, 0.34));
    spear(fx, c, ex, fx.heightAt(ex, ez), ez, land, R * (i === 0 ? 1.1 : rng.r(0.6, 0.85)));
  }
  // frost burst
  const sd = rng.f() * 9;
  flash(fx, x, y + 0.5, z, R * 1.6, R * 0.5, 0.16, p.core, 3, ti);
  glow(fx, x, y + 0.7, z, R * 2.6, R * 1.2, 0.4, p.main, 0.8, 1.2, ti);
  shockRing(fx, x, z, R * 1.7, 0.5, p, 0.2, 1.9 * c.intensity, ti);
  fx.dec.ground(x, z, 0.02).disk(R * 1.4).pat(PAT.frost).life(5).delay(ti).col(p.main, 1, p.edge, 0.8).fade(FO.late).seed(sd).emit();
  if (fx.detail >= 1) fx.shp.ground(x, z, 0.05).disk(R * 1.2).pat(PAT.cracks).life(1.4).delay(ti).col(p.main, 1, p.edge, 1).int(1.0).fade(FO.late).seed(sd + 2).emit();
  for (let i = 0, n = fx.n(6); i < n; i++) {
    fx.add.at(x + rng.s2(R * 0.9), y + 0.2, z + rng.s2(R * 0.9)).vel(0, rng.r(0.6, 1.5), 0).size(0.55, 0.12).life(rng.r(0.5, 1.0)).delay(ti + rng.r(0.05, 0.35))
      .col(p.core, 1, p.main, 0).int(2).spr(SPR.glint).twinkle().fade(1, FO.quad).emit();
  }
}

// ----------------------------------------------------------------------------------------------------------- column of light

function lightColumn(fx: Fx, c: Ctx, x: number, y: number, z: number, R: number, T: number, P: number): void {
  const p = c.pal;
  const rng = fx.rng;
  const I = c.intensity;
  timing(T, 0.3);
  const tf = TF, t0 = T0, ti = TI;
  const sd = rng.f() * 9;
  marker(fx, c, x, z, R, ti, false);
  if (ti >= 0.08 && c.a <= 0) fx.shp.ground(x, z, 0.045).disk(R * 0.95).pat(PAT.holy).life(ti / 0.88 + 0.04).col(p.main, 0.8, p.edge, 0.8).int(1.0).fade(FO.snap).seed(sd).emit();
  // the light itself drops in
  fallVel(0, -17, 0, tf);
  fStreak(fx, x, y + 17, z, t0, tf, R * 0.5, 0.11, SPR.streak, p.core, 1, p.main, 0.9, 3.0);
  fStreak(fx, x, y + 17, z, t0, tf, R * 1.5, 0.15, SPR.streakSoft, p.main, 0.8, p.edge, 0.5, 1.6);
  fHead(fx, x, y + 17, z, t0, tf, R * 2.4, R * 2.0, p.main, 0.55, p.edge, 1.3, SPR.glow);
  fHead(fx, x, y + 17, z, t0, tf, R * 1.1, R * 1.0, p.core, 1, p.main, 3.4, SPR.glowTight);
  // pillar + ring cascade sliding down it
  fx.shp.ground(x, z, 0).cyl(R * 0.8, R * 0.45, 17).pat(PAT.pillar).life(0.9).delay(ti).col(p.main, 1, p.edge, 1).int(1.9 * I).fade(FO.sq).expand(0.5).seed(sd).emit();
  fx.shp.ground(x, z, 0).cyl(R * 0.32, R * 0.18, 17).pat(PAT.pillar).life(0.5).delay(ti).col(p.core, 1, p.main, 1).int(2.4 * I).fade(FO.sq).expand(0.5).seed(sd + 1).emit();
  fx.shp.ground(x, z, 0).cyl(R * 1.5, R * 0.9, 17).pat(PAT.pillar).life(1.15).delay(ti).col(p.main, 0.8, p.edge, 0.8).int(0.5).fade(FO.sq).expand(0.4).seed(sd + 2).emit();
  const nR = P > 0.8 ? 4 : 3;
  for (let i = 0; i < nR; i++) {
    fx.add.at(x, y + 8.5, z).vel(0, -21, 0).size(R * 2.7, R * 1.6).life(0.42).delay(ti + i * 0.06).col(p.core, 0.95, p.main, 0).int(2).spr(SPR.ringThin).mode(M.ground).fade(0, FO.quad).emit();
  }
  // ground
  impactBase(fx, c, x, y, z, R, ti, 0.85 * P);
  fx.shp.ground(x, z, 0.05).disk(R * 1.6).pat(PAT.holy).life(1.5).delay(ti).col(p.main, 1, p.edge, 1).int(1.4).fade(FO.late).seed(sd + 3).emit();
  fx.add.at(x, y + 0.8, z).size(R * 1.2, R * 3.6).life(0.3).delay(ti).col(p.core, 1, p.main, 0).int(2.6).spr(SPR.sunburst).rot(rng.f() * TAU).fade(0, FO.quad).emit();
  for (let i = 0, n = fx.n(16); i < n; i++) {
    const a = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * R * 0.9;
    fx.add.at(x + Math.sin(a) * r, y + 0.2, z + Math.cos(a) * r).vel(0, rng.r(1.5, 4.5), 0).size(rng.r(0.4, 0.7), 0.1).life(rng.r(0.7, 1.3)).delay(ti + rng.r(0, 0.3))
      .col(p.core, 1, p.main, 0).int(2.2).spr(rng.f() < 0.5 ? SPR.glint : SPR.sparkle).twinkle().fade(1, FO.quad).emit();
  }
  if (fx.detail >= 1) {
    for (let i = 0, n = fx.n(6); i < n; i++) {
      fx.alp.at(x + rng.s2(R), y + rng.r(3, 7), z + rng.s2(R)).vel(rng.s2(0.4), -rng.r(0.6, 1.4), rng.s2(0.4)).size(0.34, 0.26).life(rng.r(0.9, 1.5)).delay(ti + rng.r(0, 0.2))
        .col(p.main, 0.8, p.core, 0).spr(SPR.petal).rot(rng.f() * TAU, rng.s2(3)).wob(0.35).drag(0.5).fade(1, FO.quad).emit();
    }
  }
}

// ----------------------------------------------------------------------------------------------------------- dark spear

function shadowSpear(fx: Fx, c: Ctx, x: number, y: number, z: number, R: number, T: number): void {
  const p = c.pal;
  const rng = fx.rng;
  timing(T, 0.32);
  const tf = TF, t0 = T0, ti = TI;
  const H = 19;
  const ox = -H * 0.1 + rng.s2(0.5);
  const oz = -H * 0.08;
  fallVel(-ox, -H, -oz, tf);
  const sx = x + ox, sy = y + H, sz = z + oz;
  marker(fx, c, x, z, R, ti, true);
  // black body (alpha) wrapped in violet light
  fx.alp.at(sx, sy, sz).vel(FV_X, FV_Y, FV_Z).grav(FALL_G).life(tf).delay(t0).size(R * 0.62, R * 0.62).stretch(0.1).col(p.smoke, 1, p.smoke, 1).spr(SPR.streak).mode(M.streak).fade(0, FO.snap).emit();
  fStreak(fx, sx, sy, sz, t0, tf, R * 1.5, 0.12, SPR.streakSoft, p.main, 0.9, p.edge, 0.6, 1.7);
  fStreak(fx, sx, sy, sz, t0, tf, R * 0.28, 0.1, SPR.streak, p.core, 1, p.extra, 0.9, 3.0);
  fHead(fx, sx, sy, sz, t0, tf, R * 2.2, R * 2.0, p.main, 0.55, p.edge, 1.4, SPR.glow);
  fHead(fx, sx, sy, sz, t0, tf, R * 0.9, R * 0.8, p.extra, 1, p.core, 3.0, SPR.glowTight);
  const nW = fx.n(6);
  for (let i = 0; i < nW; i++) {
    const t = (tf * (i + 0.5)) / (nW + 0.5);
    pathAt(sx, sy, sz, t);
    smoke(fx, PX, PY, PZ, 1, 0.2, 0.4, 0.9, 1.4, R * 0.7, R * 1.8, p.smoke, 0.6, t0 + t);
    if (i % 2 === 0) embers(fx, PX, PY, PZ, 1, 0.2, 0.6, 0.4, 0.8, 0.2, p.extra, p.main, t0 + t);
  }
  // impact + planted spear
  impactBase(fx, c, x, y, z, R, ti, 1.0);
  flavor(fx, c, x, y, z, R, ti, 4);
  fx.rb.width(0.5 * R).life(0.6).col(p.core, p.main).int(2.2).style_(2).fade(FO.late).delay(ti).streak(x, y + 0.1, z, x + 0.3, y + 4.6, z - 0.3);
  fx.add.at(x, y + 0.8, z).size(R * 1.4, R * 3.4).life(0.3).delay(ti).col(p.core, 1, p.main, 0).int(2.2).spr(SPR.burst).rot(rng.f() * TAU).fade(0, FO.quad).emit();
  wisps(fx, x, y + 0.2, z, fx.n(6), R * 0.7, 1.6, 0.8, 1.4, 0.8, p.main, p.edge, ti + 0.1, 1.4);
}

// ----------------------------------------------------------------------------------------------------------- acid glob

function acidGlob(fx: Fx, c: Ctx, x: number, y: number, z: number, R: number, T: number): void {
  const p = c.pal;
  const rng = fx.rng;
  timing(T, 0.34);
  const tf = TF, t0 = T0, ti = TI;
  const H = 16;
  const ox = -H * 0.1 + rng.s2(0.4);
  const oz = -H * 0.07;
  fallVel(-ox, -H, -oz, tf);
  const sx = x + ox, sy = y + H, sz = z + oz;
  marker(fx, c, x, z, R, ti, true);
  fx.alp.at(sx, sy, sz).vel(FV_X, FV_Y, FV_Z).grav(FALL_G).life(tf).delay(t0).size(R * 1.5, R * 1.35).rot(fallRot() + Math.PI).col(p.main, 1, p.edge, 1).spr(SPR.drop).fade(0, FO.snap).emit();
  fHead(fx, sx, sy, sz, t0, tf, R * 2.6, R * 2.3, p.main, 0.5, p.edge, 1.3, SPR.glow);
  fHead(fx, sx, sy, sz, t0, tf, R * 0.8, R * 0.7, p.core, 0.9, p.main, 2.4, SPR.glowTight);
  fStreak(fx, sx, sy, sz, t0, tf, R * 0.7, 0.08, SPR.streakSoft, p.main, 0.6, p.edge, 0.3, 1.4);
  for (let i = 0, n = fx.n(6); i < n; i++) {
    pathAt(sx, sy, sz, tf * rng.r(0.15, 0.95));
    fx.alp.at(PX, PY, PZ).vel(rng.s2(0.8), rng.r(-1, 0.4), rng.s2(0.8)).size(0.26 * R * 0.7, 0.14).life(rng.r(0.3, 0.5)).delay(t0)
      .col(p.main, 0.9, p.edge, 0.6).spr(SPR.drop).grav(-12).fade(0, FO.quad).emit();
  }
  impactBase(fx, c, x, y, z, R, ti, 0.9);
  fx.alp.at(x, y + 0.08, z).size(R * 1.0, R * 3.2).life(0.7).delay(ti).col(p.main, 0.95, p.edge, 0.5).spr(SPR.splat).rot(rng.f() * TAU).mode(M.ground).fade(0, FO.sq, SC.out).emit();
  flavor(fx, c, x, y, z, R, ti, 5);
  for (let i = 0, n = fx.n(8); i < n; i++) {
    const a = rng.f() * TAU;
    const v = rng.r(1.5, 4);
    fx.add.at(x, y + 0.2, z).vel(Math.sin(a) * v, rng.r(1.2, 3), Math.cos(a) * v).size(0.12, 0.05).life(rng.r(0.5, 0.9)).delay(ti + rng.r(0, 0.3))
      .col(p.core, 1, p.main, 0).int(1.8).spr(SPR.dot).grav(-6).fade(0, FO.quad).emit();
  }
}

// ----------------------------------------------------------------------------------------------------------- cyclone

function cyclone(fx: Fx, c: Ctx, x: number, y: number, z: number, R: number, T: number): void {
  const p = c.pal;
  const rng = fx.rng;
  timing(T, 0.4);
  const tf = TF, ti = TI, t0 = T0;
  marker(fx, c, x, z, R, ti, false);
  const N = fx.n(14);
  const strands = fx.detail >= 1 ? 2 : 1;
  const dt = tf / Math.max(1, N);
  const a0 = rng.f() * TAU;
  for (let h = 0; h < strands; h++) {
    for (let i = 0; i < N; i++) {
      const u0 = i / N;
      const u1 = (i + 1) / N;
      const th0 = a0 + h * Math.PI + 4.4 * u0 * TAU * 0.5;
      const th1 = a0 + h * Math.PI + 4.4 * u1 * TAU * 0.5;
      const r0 = R * (1.15 - 0.9 * u0), r1 = R * (1.15 - 0.9 * u1);
      const y0 = y + 9 * (1 - u0) * (1 - u0), y1 = y + 9 * (1 - u1) * (1 - u1);
      const x0 = x + Math.sin(th0) * r0, z0 = z + Math.cos(th0) * r0;
      const x1 = x + Math.sin(th1) * r1, z1 = z + Math.cos(th1) * r1;
      fx.add.at(x0, y0, z0).vel((x1 - x0) / dt, (y1 - y0) / dt, (z1 - z0) / dt).life(dt * 1.5).delay(t0 + u0 * tf).size(0.2, 0.12).stretch(dt * 0.9)
        .col(p.core, 0.95, p.main, 0.7).int(1.9).spr(SPR.streak).mode(M.streak).fade(0, FO.quad).emit();
    }
  }
  fx.shp.ground(x, z, 0).cyl(R * 0.5, R * 1.15, 5).pat(PAT.flame).life(0.8).delay(ti - 0.06).col(p.core, 0.9, p.main, 0.9).int(1.3).fade(FO.sq).expand(0.4).seed(rng.f() * 9).emit();
  impactBase(fx, c, x, y, z, R, ti, 0.9);
  swirlBurst(fx, x, y + 0.9, z, R * 3.4, 0.7, p, 1.7, ti);
  flavor(fx, c, x, y, z, R, ti, 7);
}

// ----------------------------------------------------------------------------------------------------------- boulder

function boulder(fx: Fx, c: Ctx, x: number, y: number, z: number, R: number, T: number): void {
  const p = c.pal;
  const rng = fx.rng;
  timing(T, 0.34);
  const tf = TF, t0 = T0, ti = TI;
  const H = 17;
  const ox = -H * 0.12 + rng.s2(0.5);
  const oz = -H * 0.1;
  fallVel(-ox, -H, -oz, tf);
  const sx = x + ox, sy = y + H, sz = z + oz;
  marker(fx, c, x, z, R, ti, true);
  fx.db.at(sx, sy, sz).vel(FV_X, FV_Y, FV_Z).grav(FALL_G).sz(R * 0.62).col(0x9a8a70, 0x5a4c3a).spin_(3).bounce(0.1).life(tf / 0.7).floor(y).delay(t0).emit();
  fx.db.at(sx + 0.5, sy + 0.6, sz).vel(FV_X, FV_Y, FV_Z).grav(FALL_G).sz(R * 0.34).col(0x8a7a60, 0x4a4032).spin_(5).bounce(0.1).life(tf / 0.7).floor(y).delay(t0).emit();
  fHead(fx, sx, sy, sz, t0, tf, R * 2.4, R * 2.1, p.main, 0.4, p.edge, 1.2, SPR.glow);
  fStreak(fx, sx, sy, sz, t0, tf, R * 0.5, 0.08, SPR.streak, p.core, 1, p.main, 0.8, 2.0);
  fx.alp.at(sx, sy, sz).vel(FV_X, FV_Y, FV_Z).grav(FALL_G).life(tf).delay(t0).size(R * 1.3, R * 1.3).stretch(0.1).col(p.smoke, 0.6, p.smoke, 0.4).spr(SPR.streakSoft).mode(M.streak).fade(0, FO.snap).emit();
  for (let i = 0, n = fx.n(5); i < n; i++) {
    pathAt(sx, sy, sz, tf * (i + 0.5) / n);
    smoke(fx, PX, PY, PZ, 1, 0.2, 0.2, 0.7, 1.1, R * 0.6, R * 1.6, DUST, 0.38, t0 + tf * (i + 0.5) / n);
  }
  impactBase(fx, c, x, y, z, R, ti, 1.0);
  flavor(fx, c, x, y, z, R, ti, 0);
  chunks(fx, x, y + 0.3, z, fx.n(6), R * 2.4, 0.16 * R, 0x9a8a70, 0x5a4c3a, 0.4, 1.2, y, ti);
}

// ----------------------------------------------------------------------------------------------------------- spectral swords

/** one giant sword: falls blade-first, flashes in, optionally stays embedded `stay` seconds */
function swordDrop(fx: Fx, c: Ctx, ex: number, ey: number, ez: number, ti: number, s: number, stay: number): void {
  const p = c.pal;
  const rng = fx.rng;
  const tf = 0.22 + rng.r(0, 0.05);
  const at = Math.max(0, ti - tf);
  const H = 15 + rng.r(0, 3);
  const ox = -H * 0.05 + rng.s2(0.3);
  const oz = rng.s2(0.3);
  fallVel(-ox, -H, -oz, tf);
  const sx = ex + ox, sy = ey + H, sz = ez + oz;
  fStreak(fx, sx, sy, sz, at, tf, 0.3 * s, 0.075, SPR.streak, p.core, 1, p.main, 0.9, 3.0);
  fStreak(fx, sx, sy, sz, at, tf, 1.0 * s, 0.09, SPR.streakSoft, p.main, 0.85, p.edge, 0.4, 1.5);
  fHead(fx, sx, sy, sz, at, tf, 0.9 * s, 0.8 * s, p.core, 1, p.main, 3.4, SPR.glowTight);
  fx.add.at(sx, sy + 2.1 * s, sz).vel(FV_X, FV_Y, FV_Z).grav(FALL_G).life(tf).delay(at).size(1.6 * s, 1.6 * s).col(p.core, 1, p.main, 1).int(2.6).spr(SPR.spark4).fade(0, FO.snap).emit();
  // impact
  flash(fx, ex, ey + 0.4, ez, 2.0 * s, 0.5 * s, 0.15, p.core, 3.4, ti);
  shockRing(fx, ex, ez, 1.35 * s, 0.32, p, 0.18, 1.7, ti);
  chunks(fx, ex, ey + 0.2, ez, fx.n(3), 3.6, 0.1 * s, 0xfff2c0, p.main, 1.0, 0.8, ey, ti);
  for (let i = 0; i < 2; i++) {
    fx.add.at(ex + rng.s2(0.3 * s), ey + 0.15, ez + rng.s2(0.3 * s)).vel(0, rng.r(1, 2.2), 0).size(0.5 * s, 0.1).life(rng.r(0.45, 0.8)).delay(ti + i * 0.04)
      .col(p.core, 1, p.edge, 0).int(2).spr(SPR.glint).twinkle().fade(1, FO.quad).emit();
  }
  smoke(fx, ex, ey + 0.1, ez, 1, 0.2, 0.6, 0.5, 0.9, 0.6 * s, 1.5 * s, DUST, 0.3, ti);
  if (stay > 0) {
    const L = 3.6 * s;
    fx.shp.at(ex, ey + L, ez).yaw_(rng.s2(0.45)).tilt(Math.PI / 2, 0).lane(0.7 * s, L).pat(PAT.scratch).life(stay).delay(ti)
      .col(p.main, 1, p.edge, 1).int(2.3).fade(FO.late).seed(rng.f() * 9).emit();
    fx.add.at(ex, ey + L * 0.82, ez).size(1.3 * s, 1.3 * s).life(stay).delay(ti).col(p.core, 1, p.main, 0.8).int(2.4).spr(SPR.spark4).fade(0, FO.late).emit();
  }
}

// ----------------------------------------------------------------------------------------------------------- arrow volley

function arrowDrop(fx: Fx, c: Ctx, el: number, ex: number, ey: number, ez: number, ti: number, stick: boolean): void {
  const p = c.pal;
  const rng = fx.rng;
  const tf = 0.2 + rng.r(0, 0.04);
  const at = Math.max(0, ti - tf);
  const H = 14 + rng.r(0, 2);
  const ox = -H * 0.38 + rng.s2(0.6);
  const oz = -H * 0.3 + rng.s2(0.5);
  fallVel(-ox, -H, -oz, tf);
  const sx = ex + ox, sy = ey + H, sz = ez + oz;
  fStreak(fx, sx, sy, sz, at, tf, 0.1, 0.034, SPR.streak, p.core, 1, p.main, 0.95, 2.8);
  fStreak(fx, sx, sy, sz, at, tf, 0.36, 0.04, SPR.streakSoft, p.main, 0.55, p.edge, 0.3, 1.2);
  fHead(fx, sx, sy, sz, at, tf, 0.42, 0.38, p.core, 1, p.main, 3.2, SPR.glowTight);
  // impact puff
  smoke(fx, ex, ey + 0.08, ez, 1, 0.1, 0.5, 0.4, 0.7, 0.3, 0.9, DUST, 0.34, ti);
  flash(fx, ex, ey + 0.2, ez, 0.8, 0.25, 0.1, p.core, 2.6, ti);
  sparks(fx, ex, ey + 0.1, ez, fx.n(2), 2, 5, 1.2, 0.15, 0.3, 0.07, p.core, p.edge, 0, 0, 1, 2.2, -10, ti);
  tinyImpact(fx, c, el, ex, ey, ez, 1, ti);
  if (stick) {
    const vx = FV_X, vy = FV_Y + FALL_G * tf, vz = FV_Z;
    const l = Math.hypot(vx, vy, vz) || 1;
    fx.rb.width(0.12).life(0.9).col(p.core, p.main).int(1.7).style_(2).fade(FO.late).delay(ti).streak(ex, ey + 0.05, ez, ex - (vx / l) * 1.0, ey + 0.05 - (vy / l) * 1.0, ez - (vz / l) * 1.0);
  }
}

function arrowVolley(fx: Fx, c: Ctx): void {
  const R = c.radius;
  const rng = fx.rng;
  const T = c.duration;
  const el = elementOf(c, 0);
  const last = Math.max(0.36, T);
  marker(fx, c, c.x, c.z, R, last + 0.2, false);
  const n = fx.n(12);
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * R;
    const ex = c.x + Math.sin(a) * r;
    const ez = c.z + Math.cos(a) * r;
    arrowDrop(fx, c, el, ex, fx.heightAt(ex, ez), ez, 0.26 + (i / Math.max(1, n)) * (last - 0.26) + rng.s2(0.04), i % 2 === 0 && fx.detail >= 1);
  }
}

function swordRain(fx: Fx, c: Ctx): void {
  const R = c.radius;
  const rng = fx.rng;
  const T = c.duration;
  const s = c.scale;
  const last = Math.max(0.4, T);
  marker(fx, c, c.x, c.z, R, last + 0.25, false);
  const n = fx.detail >= 1 ? 7 : 5;
  const a0 = rng.f() * TAU;
  for (let i = 0; i < n; i++) {
    const a = a0 + i * 2.399;
    const r = R * 0.9 * Math.sqrt((i + 0.35) / n);
    const ex = c.x + Math.sin(a) * r;
    const ez = c.z + Math.cos(a) * r;
    const ti = 0.26 + (i / n) * (last - 0.26) + rng.s2(0.03);
    swordDrop(fx, c, ex, fx.heightAt(ex, ez), ez, ti, s * rng.r(0.85, 1.1), i % 3 === 0 ? 0.9 + rng.r(0, 0.3) : 0);
  }
  // final soul flash where the rain ends
  const tl = last + 0.04;
  flash(fx, c.x, c.y + 0.5, c.z, R * 1.5, R * 0.5, 0.18, c.pal.core, 2.6, tl);
  glow(fx, c.x, c.y + 0.7, c.z, R * 2.6, R * 1.2, 0.4, c.pal.main, 0.7, 1.2, tl);
  shockRing(fx, c.x, c.z, R * 1.5, 0.5, c.pal, 0.2, 1.6, tl);
}

// ----------------------------------------------------------------------------------------------------------- sky.strike dispatch

function strike(fx: Fx, c: Ctx): void {
  const R = c.radius;
  const T = c.duration;
  switch (elementOf(c, 1)) {
    case 0:
      if (c.variant === 8 || c.variant === 9) {
        marker(fx, c, c.x, c.z, R, Math.max(T, 0.26), false);
        swordDrop(fx, c, c.x, c.y, c.z, Math.max(T, 0.26), R / 2.0, 0.9);
        const ti = Math.max(T, 0.26);
        impactBase(fx, c, c.x, c.y, c.z, R, ti, 0.9);
        flavor(fx, c, c.x, c.y, c.z, R, ti, 6);
      } else {
        boulder(fx, c, c.x, c.y, c.z, R, T);
      }
      break;
    case 2:
      icicles(fx, c, c.x, c.y, c.z, R, T, 3);
      break;
    case 3:
      skyLightning(fx, c);
      break;
    case 4:
      shadowSpear(fx, c, c.x, c.y, c.z, R, T);
      break;
    case 5:
      acidGlob(fx, c, c.x, c.y, c.z, R, T);
      break;
    case 6:
      lightColumn(fx, c, c.x, c.y, c.z, R, T, 0.85);
      break;
    case 7:
      cyclone(fx, c, c.x, c.y, c.z, R, T);
      break;
    default:
      meteor(fx, c, c.x, c.y, c.z, R, T, 1);
  }
}

// ----------------------------------------------------------------------------------------------------------- chain.bolt

function chainBolt(fx: Fx, c: Ctx): void {
  const s = c.scale;
  const p = c.pal;
  const rng = fx.rng;
  const I = c.intensity;
  const sy = c.y + 0.9;
  let ex = c.tx, ez = c.tz, ey = (c.hasTarget ? c.ty : fx.heightAt(c.tx, c.tz)) + 0.9;
  if (!c.hasTarget) {
    ex = c.x + c.dx * 5 * s;
    ez = c.z + c.dz * 5 * s;
    ey = fx.heightAt(ex, ez) + 0.9;
  }
  const dx = ex - c.x, dy = ey - sy, dz = ez - c.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const el = elementOf(c, 3);
  const sd = rng.f() * 9;
  // the signature effect draws the electric part; without it (tier, budget, pool) the batched bolt does
  if (fx.el?.cast('storm.chain', c) !== true) {
    // glow lane + two strands
    fx.shp.at(c.x, sy, c.z).yaw_(Math.atan2(dx, dz)).tilt(-Math.asin(dy / len), 0).beam(1.1 * s, len).expand(0.2).pat(PAT.beam).life(0.24)
      .col(p.main, 0.9, p.edge, 0.9).int(1.0 * I).fade(FO.quad).seed(sd).emit();
    fx.rb.width(0.36 * s).life(0.22).col(p.core, p.main).int(3.2 * I).jag(0.28).branch(2).style_(1).fade(FO.cubic).bolt(c.x, sy, c.z, ex, ey, ez);
    fx.rb.width(0.2 * s).life(0.17).col(p.core, p.core).int(3.6).jag(0.34).branch(1).style_(1).fade(FO.cubic).delay(0.03).bolt(c.x, sy, c.z, ex, ey, ez);
    if (fx.detail >= 1) fx.rb.width(0.26 * s).life(0.1).col(p.main, p.edge).int(2.2).jag(0.3).branch(2).style_(1).fade(FO.quad).delay(0.09).bolt(c.x, sy, c.z, ex, ey, ez);
    // muzzle + end spark
    flash(fx, c.x, sy, c.z, 0.9 * s, 0.3 * s, 0.12, p.core, 2.6);
    flash(fx, ex, ey, ez, 1.5 * s, 0.4 * s, 0.16, p.core, 3.4);
    glow(fx, ex, ey, ez, 2.2 * s, 0.8 * s, 0.24, p.main, 0.7, 1.4);
    haloRing(fx, ex, ey, ez, 0.3 * s, 1.9 * s, 0.22, p.main, 0.7, 1.4, 0.02);
    sparks(fx, ex, ey, ez, fx.n(7), 3, 8, 1.2, 0.16, 0.34, 0.09 * s, p.core, p.edge, 0, 0, 1, 2.4, -9, 0.02);
    sparks(fx, c.x, sy, c.z, fx.n(3), 2, 5, 1, 0.12, 0.25, 0.07 * s, p.core, p.main, 0, 0, 1, 2, -9);
    for (let i = 0, n = fx.n(3); i < n; i++) {
      fx.add.at(ex + rng.s2(0.3 * s), ey + rng.s2(0.3 * s), ez + rng.s2(0.3 * s)).size(0.9 * s, 1.3 * s).life(rng.r(0.08, 0.14)).delay(rng.r(0, 0.08))
        .col(p.core, 1, p.main, 0).int(2.4).spr(SPR.arc0 + rng.i(3)).rot(rng.f() * TAU).twinkle().fade(0, FO.cube).emit();
    }
  }
  // non-lightning flavours: accents along the line + at the end
  if (el !== 3) {
    tinyImpact(fx, c, el, ex, ey - 0.6, ez, 1.4 * s, 0.02);
    for (let i = 0, n = fx.n(4); i < n; i++) {
      const f = rng.r(0.1, 0.9);
      const x = c.x + dx * f + rng.s2(0.35), y = sy + dy * f + rng.s2(0.3), z = c.z + dz * f + rng.s2(0.35);
      fx.add.at(x, y, z).vel(rng.s2(0.6), rng.r(0.2, 1.0), rng.s2(0.6)).size(0.2 * s, 0.05).life(rng.r(0.3, 0.55)).delay(f * 0.06)
        .col(p.extra, 1, p.main, 0).int(2.2).spr(SPR.ember0 + rng.i(2)).twinkle().fade(0, FO.quad).emit();
    }
  }
}

// ----------------------------------------------------------------------------------------------------------- beam.line

let BG_LEN = 1;
let BG_YAW = 0;
let BG_EX = 0;
let BG_EZ = 0;
const BEAM_H = 1.0;

/** beam start c.x,c.z → end (target or dir × radius): writes BG_* */
function beamGeom(c: Ctx): void {
  if (c.hasTarget) {
    const dx = c.tx - c.x, dz = c.tz - c.z;
    BG_LEN = Math.max(0.5, Math.hypot(dx, dz));
    BG_YAW = Math.atan2(dx, dz);
    BG_EX = c.tx;
    BG_EZ = c.tz;
  } else {
    BG_LEN = c.radius;
    BG_YAW = c.rot;
    BG_EX = c.x + c.dx * c.radius;
    BG_EZ = c.z + c.dz * c.radius;
  }
}

function beamLine(): PresetDef {
  return {
    id: 'beam.line',
    cat: 'beam',
    desc: 'beam: persistent energy beam from x,z along dir (or to tx,tz) — soft halo, white core, flowing energy ropes, muzzle + end flares and an end spark spray. default duration 1.2 s.',
    size: 'radius',
    base: 8,
    palette: 'lightning',
    variants: true,
    dur: 1.2,
    loop: true,
    needsTarget: false,
    demo: { dir: 0, target: 7, loopFor: 1.2 },
    fire(fx, c) {
      const inst = c as Inst;
      // the signature beam (beam.nova: column, coils, discs, muzzle orb, floor burn, accents) replaces everything below; without it
      // (tier, budget, pool) the batched beam plays. A persistent beam has no wind-up (`a` < 0)
      if (castEl(fx, 'beam.nova', c, -1, 0)) return;
      const p = c.pal;
      const I = c.intensity;
      beamGeom(c);
      const y = c.y + BEAM_H;
      const life = c.duration + 1;
      const sd = c.seed * 9;
      const ey = fx.heightAt(BG_EX, BG_EZ) + BEAM_H;
      const pitch = -Math.asin((ey - y) / Math.hypot(BG_LEN, ey - y));
      inst.own(fx.shp.at(c.x, y, c.z).yaw_(BG_YAW).tilt(pitch, 0).beam(2.4, BG_LEN).expand(0.05).pat(PAT.beam).life(life).col(p.main, 0.8, p.edge, 0.8).int(0.9 * I).fade(FO.late).seed(sd).pinned().emit(), BEAM_H);
      inst.own(fx.shp.at(c.x, y, c.z).yaw_(BG_YAW).tilt(pitch, 0).beam(0.95, BG_LEN).expand(0.05).pat(PAT.beam).life(life).col(p.main, 1, p.edge, 1).int(1.8 * I).fade(FO.late).seed(sd + 2).pinned().emit(), BEAM_H);
      inst.own(fx.shp.at(c.x, y, c.z).yaw_(BG_YAW).tilt(pitch, 0).beam(0.34, BG_LEN).expand(0.05).pat(PAT.beam).life(life).col(p.core, 1, p.core, 1).int(3 * I).fade(FO.late).seed(sd + 4).pinned().emit(), BEAM_H);
      inst.own(fx.shp.at(c.x, y, c.z).disk(1.0).pat(PAT.disk).life(life).col(p.main, 0.6, p.edge, 0.6).int(1.0).fade(FO.late).seed(sd + 6).pinned().emit(), BEAM_H);
      // ignition
      flash(fx, c.x, y, c.z, 2.2, 0.8, 0.2, p.core, 3.2);
      haloRing(fx, c.x, y, c.z, 0.4, 2.6, 0.3, p.main, 0.7, 1.4);
      flash(fx, BG_EX, ey, BG_EZ, 2.4, 0.9, 0.22, p.core, 3.4, 0.08);
      shockRing(fx, BG_EX, BG_EZ, 2.0, 0.4, p, 0.2, 1.6, 0.08);
      sparks(fx, c.x, y, c.z, fx.n(8), 3, 8, 1, 0.16, 0.34, 0.09, p.core, p.edge, c.dx, c.dz, 1.2, 2.4, -9);
    },
    tick(fx, c, dt) {
      // the signature beam owns no batched shapes: nothing here to keep alive
      if (c.na === 0) return;
      const p = c.pal;
      const rng = fx.rng;
      const inst = c as Inst;
      beamGeom(c);
      const y = c.y + BEAM_H;
      const ex = BG_EX, ez = BG_EZ;
      const ey = fx.heightAt(ex, ez) + BEAM_H;
      const len = BG_LEN;
      if (c.moved) for (let k = 0; k < 3; k++) fx.shp.setYaw(inst.sa[k] as number, BG_YAW);
      const ux = (ex - c.x) / len, uz = (ez - c.z) / len;
      const pulse = 0.85 + 0.15 * Math.sin(c.age * 31);
      const ramp = Math.min(1, c.age * 8);
      // muzzle and end flares (re-emitted every frame, ~1 frame long)
      fx.add.at(c.x + ux * 0.2, y, c.z + uz * 0.2).size(1.0 * pulse, 1.0 * pulse).life(0.07).col(p.core, 1, p.main, 0.6).int(2.8).spr(SPR.glowTight).fade(0, FO.none).emit();
      fx.add.at(c.x + ux * 0.2, y, c.z + uz * 0.2).size(1.8 * pulse, 1.6).life(0.09).col(p.main, 0.8, p.edge, 0.4).int(1.8).spr(SPR.flare).rot(c.age * 3, 2.5).fade(0, FO.none).emit();
      fx.add.at(ex, ey, ez).size(1.5 * pulse * ramp, 1.5 * ramp).life(0.07).col(p.core, 1, p.main, 0.6).int(3.0).spr(SPR.glowTight).fade(0, FO.none).emit();
      fx.add.at(ex, ey, ez).size(2.6 * pulse * ramp, 2.4 * ramp).life(0.09).col(p.main, 0.7, p.edge, 0.4).int(1.5).spr(SPR.flare).rot(-c.age * 4, -3).fade(0, FO.none).emit();
      // flowing energy ropes (short-lived jittering ribbons)
      c.acc0 += dt * 16 * fx.density;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        fx.rb.width(0.55).life(0.11).col(p.main, p.core).int(2.1).jag(0.05).style_(3).fade(FO.quad).seed(rng.f() * 9).bolt(c.x, y, c.z, ex, ey, ez);
        fx.rb.width(0.3).life(0.09).col(p.core, p.main).int(2.4).jag(0.08).style_(3).fade(FO.quad).seed(rng.f() * 9).bolt(c.x, y, c.z, ex, ey, ez);
      }
      // end spark spray
      c.acc1 += dt * 46 * fx.density * ramp;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        const a = rng.f() * TAU;
        const v = rng.r(3, 9);
        fx.add.at(ex, ey - 0.4, ez).vel(Math.sin(a) * v - ux * 2, rng.r(0.5, 4.5), Math.cos(a) * v - uz * 2).life(rng.r(0.16, 0.4)).size(0.1, 0.03).stretch(0.045)
          .col(p.core, 1, p.edge, 0).int(2.4).spr(SPR.streak).mode(M.streak).drag(2.6).grav(-10).fade(0, FO.cubic).emit();
      }
      // flow motes riding the beam
      c.acc2 += dt * 22 * fx.density;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        const f = rng.f();
        const sp = rng.r(10, 18);
        fx.add.at(c.x + (ex - c.x) * f + rng.s2(0.18), y + rng.s2(0.22), c.z + (ez - c.z) * f + rng.s2(0.18)).vel(ux * sp, 0, uz * sp).life(rng.r(0.12, 0.26)).size(0.2, 0.08)
          .col(p.core, 1, p.main, 0).int(2.4).spr(SPR.glow).twinkle().fade(0, FO.quad).emit();
      }
      // ground scorch glow + dust at the end
      c.acc3 += dt * 9 * fx.density;
      while (c.acc3 >= 1) {
        c.acc3 -= 1;
        fx.alp.at(ex + rng.s2(0.4), ey - 0.8, ez + rng.s2(0.4)).vel(rng.s2(1), rng.r(0.2, 0.8), rng.s2(1)).life(rng.r(0.4, 0.7)).size(0.4, 1.3)
          .col(DUST, 0.3, DUST, 0).spr(SPR.dust0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(1)).drag(2).fade(1, FO.sq, SC.out).emit();
      }
    },
  };
}

// ----------------------------------------------------------------------------------------------------------- ult.storm

/** seconds the rune circle charges before the first bolt lands */
const STORM_LEAD = 0.45;
/** bolts of a storm when `a` is not given */
const STORM_BOLTS = 5;

/** `ult.storm`: a rune circle charges, a barrage of lightning strikes rains over the radius, a big ring closes it */
function ultStorm(): PresetDef {
  return {
    id: 'ult.storm',
    cat: 'sky',
    desc: 'ultimate storm: a rune circle charges for 0.45 s, then a barrage of `a` (5) lightning strikes (storm.bolt) rains over the radius until `duration` (1.4), the last one dead centre and bigger, closed by a big ground ring, dust and flash. b>0 overrides the barrage span. Falls back to batched thunderbolts.',
    size: 'radius',
    base: 3.2,
    palette: 'lightning',
    variants: true,
    dur: 1.4,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = c.pal;
      const R = c.radius;
      const cx = c.hasTarget ? c.tx : c.x;
      const cz = c.hasTarget ? c.tz : c.z;
      const cy = c.hasTarget ? c.ty : c.y;
      const total = c.duration > 0 ? c.duration : 1.4;
      const lead = Math.min(STORM_LEAD, total * 0.35);
      const bolts = c.a > 0 ? Math.min(8, Math.round(c.a)) : STORM_BOLTS;
      const span = c.b > 0 ? c.b : Math.max(0.3, total - lead);
      // the last bolt lands at lead + span; the finale follows it
      const tf = lead + span + 0.1;

      // `a`, `b` and `duration` mean something else to the storm effect (bolt count, barrage span, delay): swap them in, put them back
      const dur = c.duration;
      const a = c.a;
      const b = c.b;
      c.a = 0;
      marker(fx, c, cx, cz, R * 1.25, lead, false);
      c.duration = lead;
      c.a = bolts;
      c.b = span;
      const taken = fx.el?.cast('storm.bolt', c) === true;
      c.duration = dur;
      c.b = b;
      if (!taken) {
        c.a = 1; // hides the markers of the batched strikes: the one above is the telegraph
        for (let i = 0; i < bolts; i++) {
          const t = lead + (bolts > 1 ? (span * i) / (bolts - 1) : 0);
          if (i === bolts - 1) {
            thunder(fx, c, cx, cy, cz, R * 0.5, t, 1.25);
          } else {
            const ang = i * 2.39996 + c.seed * TAU;
            const rr = R * (0.3 + 0.6 * Math.sqrt((i + 0.5) / (bolts - 1)));
            const x = cx + Math.sin(ang) * rr;
            const z = cz + Math.cos(ang) * rr;
            thunder(fx, c, x, fx.heightAt(x, z), z, R * 0.3, t, 1);
          }
        }
      }
      c.a = a;

      // the light gathers over the rune circle, then the finale
      glow(fx, cx, cy + 0.6, cz, R * 1.2, R * 2.6, lead + 0.1, p.main, 0.5, 0.9);
      shockRing(fx, cx, cz, R * 2.4, 0.6, p, 0.1, 1.9, tf);
      shockRing(fx, cx, cz, R * 1.5, 0.45, p, 0.16, 1.4, tf + 0.08);
      dustRing(fx, cx, cy, cz, fx.n(12), R * 1.8, 0.9, DUST, 0.35, 1 + R * 0.2, tf);
      flash(fx, cx, cy + 0.6, cz, R * 1.4, R * 0.5, 0.2, p.core, 2.4, tf);
      glow(fx, cx, cy + 0.8, cz, R * 2.6, R * 1.3, 0.5, p.main, 0.7, 1.3, tf);
    },
  };
}

// ----------------------------------------------------------------------------------------------------------- ult.novabeam

/** seconds the orb winds up before the column is let out (the signature beam's own beat) */
const NOVA_CHARGE = 0.35;
/** metres per second the batched column's leading edge is taken to travel at */
const NOVA_SPEED = 100;

/** batched stand-in for the nova beam (tier, budget or pool exhausted): a wind-up of inward streaks, a column of three shapes held for `hold`, the end burn */
function novaBatched(fx: Fx, c: Ctx, charge: number, hold: number): void {
  const p = c.pal;
  const rng = fx.rng;
  const I = c.intensity;
  beamGeom(c);
  const L = BG_LEN;
  const ux = (BG_EX - c.x) / L, uz = (BG_EZ - c.z) / L;
  const mx = c.x + ux * 0.6, mz = c.z + uz * 0.6;
  const y = c.y + BEAM_H;
  const ey = fx.heightAt(BG_EX, BG_EZ) + BEAM_H;
  const pitch = -Math.asin((ey - y) / Math.hypot(L, ey - y));
  const sd = c.seed * 9;
  const arrive = charge + L / NOVA_SPEED;
  const life = hold + 0.5;
  // wind-up: the orb's glow and light streaks pulled into it
  glow(fx, mx, y, mz, 1.0, 2.6, charge + 0.05, p.main, 0.9, 1.6);
  for (let i = 0, n = fx.n(16); i < n; i++) {
    const a = rng.f() * TAU, e = rng.r(-0.3, 0.9), r = rng.r(1.8, 2.6), t = rng.r(0.18, 0.3);
    const vx = Math.sin(a) * Math.cos(e), vz = Math.cos(a) * Math.cos(e), vy = Math.sin(e);
    fx.add.at(mx + vx * r, y + vy * r, mz + vz * r).vel(-vx * r / t, -vy * r / t, -vz * r / t).life(t).delay(rng.f() * Math.max(0, charge - t)).size(0.09, 0.03).stretch(0.07)
      .col(p.core, 1, p.main, 0.2).int(2.4).spr(SPR.streak).mode(M.streak).fade(0, FO.quad).emit();
  }
  // the column: halo, body and core, all added
  fx.shp.at(c.x, y, c.z).yaw_(BG_YAW).tilt(pitch, 0).beam(2.6, L).expand(1).pat(PAT.beam).delay(charge).life(life).col(p.main, 0.8, p.edge, 0.8).int(0.9 * I).fade(FO.late).seed(sd).emit();
  fx.shp.at(c.x, y, c.z).yaw_(BG_YAW).tilt(pitch, 0).beam(1.0, L).expand(1).pat(PAT.beam).delay(charge).life(life).col(p.main, 1, p.edge, 1).int(1.8 * I).fade(FO.late).seed(sd + 2).emit();
  fx.shp.at(c.x, y, c.z).yaw_(BG_YAW).tilt(pitch, 0).beam(0.36, L).expand(1).pat(PAT.beam).delay(charge).life(life).col(p.core, 1, p.core, 1).int(3 * I).fade(FO.late).seed(sd + 4).emit();
  // release and landing
  flash(fx, mx, y, mz, 2.6, 0.9, 0.22, p.core, 3.2 * I, charge);
  haloRing(fx, mx, y, mz, 0.5, 3.0, 0.3, p.main, 0.7, 1.4, charge);
  sparks(fx, mx, y, mz, fx.n(22), 4, 12, 0.8, 0.2, 0.45, 0.1, p.core, p.edge, ux, uz, 1, 2.4, -8, charge);
  flash(fx, BG_EX, ey, BG_EZ, 3.0, 1.0, 0.26, p.core, 3.4 * I, arrive);
  glow(fx, BG_EX, ey - 0.4, BG_EZ, 4.2, 2.0, 0.55, p.main, 0.7, 1.4 * I, arrive);
  shockRing(fx, BG_EX, BG_EZ, 4.2, 0.55, p, 0.14, 1.7 * I, arrive);
  // the burn the beam holds on the floor
  for (let k = 0; k < 4; k++) {
    const t0 = arrive + (hold * k) / 4;
    sparks(fx, BG_EX, ey - 0.4, BG_EZ, fx.n(16), 3, 9, 1.2, 0.2, 0.5, 0.1, p.core, p.edge, -ux, -uz, 1.6, 2.4, -10, t0);
    shockRing(fx, BG_EX, BG_EZ, 2.4, 0.45, p, 0.16, 1.2 * I, t0);
  }
  const n = Math.max(2, Math.round(L / 1.4));
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) / n;
    scorch(fx, c.x + (BG_EX - c.x) * s + rng.s2(0.3), c.z + (BG_EZ - c.z) * s + rng.s2(0.3), rng.r(0.7, 1.05), hold + 5, mixHex(0x0b0e14, p.smoke, 0.15), p.main, PAT.scorch, charge + s * L / NOVA_SPEED);
  }
  fx.shake(0.14);
}

/** `ult.novabeam`: the signature nova beam on a rune circle (batched stand-in when the elemental layer does not take it) */
function ultNovaBeam(): PresetDef {
  return {
    id: 'ult.novabeam',
    cat: 'beam',
    desc: 'ultimate nova beam: an orb winds up for 0.35 s (a) with light pulled into it, then a column of light (beam.nova: white-hot core, palette sheath, coils, racing shock discs) is let out from x,z along dir (or to tx,tz) for R metres and held for `duration` (1.7) burning into the floor, then collapses to a thread. A rune circle charges under the caster. Falls back to a batched beam.',
    size: 'radius',
    base: 10,
    palette: 'holy',
    variants: true,
    dur: 1.7,
    loop: false,
    needsTarget: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const charge = c.a > 0 ? c.a : NOVA_CHARGE;
      const hold = c.duration;
      // the circle that charges under the caster and holds as long as the beam does
      const pat = c.element === 6 ? PAT.holy : c.element === 4 ? PAT.arcane : PAT.rune;
      fx.shp.ground(c.x, c.z, 0.05).disk(2.2).pat(pat).life(charge + hold + 0.5).col(p.main, 1, p.edge, 1).int(1.1 * c.intensity).fade(FO.late).seed(c.seed * 9).emit();
      if (!castEl(fx, 'beam.nova', c, c.a, 0)) novaBatched(fx, c, charge, hold);
    },
  };
}

// ----------------------------------------------------------------------------------------------------------- registry

export const SKY_PRESETS: PresetDef[] = [
  {
    id: 'sky.strike',
    cat: 'sky',
    desc: 'skyStrike: ground marker for `duration` (0.8) → body falls (flavour by element: meteor / icicle / thunderbolt / light column / shadow spear / acid glob / cyclone / boulder, spirit sword for gold+white) → impact. a>0 hides the marker.',
    size: 'radius',
    base: 1.8,
    palette: 'fire',
    variants: true,
    dur: 0.8,
    loop: false,
    demo: {},
    fire: strike,
  },
  {
    id: 'sky.meteor',
    cat: 'sky',
    desc: 'big flaming meteor: marker + falling shadow, white-hot head with flame-flipbook wake and smoke trail, flipbook fireball, scorch. duration = delay until impact (1.0). a>0 hides the marker.',
    size: 'radius',
    base: 2.4,
    palette: 'fire',
    variants: true,
    dur: 1.0,
    loop: false,
    demo: {},
    fire(fx, c) {
      meteor(fx, c, c.x, c.y, c.z, c.radius, c.duration, 1.4);
    },
  },
  {
    id: 'sky.lightning',
    cat: 'sky',
    desc: 'thunderbolt: the signature strike (storm.bolt: filament bundle, ionised shell, branching burn) when the elemental layer takes it, else the batched bolt from 19 m. duration 0 = immediate (screen flash + shake), > 0 = marker then strike. a>0 hides the marker.',
    size: 'radius',
    base: 1.6,
    palette: 'lightning',
    variants: true,
    dur: 0,
    loop: false,
    demo: {},
    fire: skyLightning,
  },
  {
    id: 'sky.arrows',
    cat: 'sky',
    desc: 'arrow volley: ~12 streaking arrows land at random points inside the radius over `duration` (0.8), impact puffs, embedded fading arrows, element accents.',
    size: 'radius',
    base: 3,
    palette: 'ninjaGreen',
    variants: true,
    dur: 0.8,
    loop: false,
    demo: {},
    fire: arrowVolley,
  },
  {
    id: 'sky.icicle',
    cat: 'sky',
    desc: 'falling icicle spears: 5-7 shard spears slam in over the last 0.3 s of `duration` (0.9), spikes + shards, frost decal. a>0 hides the marker.',
    size: 'radius',
    base: 2.2,
    palette: 'ice',
    variants: true,
    dur: 0.9,
    loop: false,
    demo: {},
    fire(fx, c) {
      // signature: real ice crystals fall point-first and drive into the floor (rime, cracks, vapour shell, shatter); the marker stays
      // batched. Without the elemental layer the batched spears play
      if (castEl(fx, 'frost.icicle', c, 0, 0)) {
        timing(c.duration, 0.3);
        marker(fx, c, c.x, c.z, c.radius, TI, false);
        return;
      }
      icicles(fx, c, c.x, c.y, c.z, c.radius, c.duration, 5 + (fx.detail >= 1 ? 1 : 0) + (fx.detail >= 2 ? 1 : 0));
    },
  },
  {
    id: 'sky.holy',
    cat: 'sky',
    desc: 'column of light: marker, light drops in, pillar with a descending ring cascade, sunburst, holy circle and rising glints. duration = delay until impact (0.9). a>0 hides the marker.',
    size: 'radius',
    base: 2,
    palette: 'holy',
    variants: true,
    dur: 0.9,
    loop: false,
    demo: {},
    fire(fx, c) {
      lightColumn(fx, c, c.x, c.y, c.z, c.radius, c.duration, 1);
    },
  },
  {
    id: 'sky.sword',
    cat: 'sky',
    desc: 'Sword Rain: giant spectral swords plunge into the radius over `duration` (0.8), each with flash + ring + chips; some stay embedded and fade. a>0 hides the marker.',
    size: 'radius',
    base: 2.2,
    palette: 'warriorGold',
    variants: true,
    dur: 0.8,
    loop: false,
    demo: {},
    fire: swordRain,
  },
  {
    id: 'chain.bolt',
    cat: 'ranged',
    desc: 'chain: one link x,z → tx,tz — the signature hopping arc network (storm.chain: earthing spikes, floor crawl, end spark) when the elemental layer takes it, else a glow lane, jagged double-strand bolt with forks, muzzle and end sparks. Non-lightning variants keep the electric look and add element embers.',
    size: 'mult',
    base: 1,
    palette: 'lightning',
    variants: true,
    dur: 0,
    loop: false,
    needsTarget: true,
    demo: { dir: 0, target: 5 },
    fire: chainBolt,
  },
  beamLine(),
  ultStorm(),
  ultNovaBeam(),
];

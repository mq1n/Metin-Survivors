// Ported from threejs-vfx src/abilities/BeamAbility.js (Nova Beam; config/abilities/beam.js) (MIT, © mohamedachrefelouafi — see ../LICENSE).
// Signature beam: `beam.nova` — a charge orb winds up at the muzzle with motes pulled into it, then a column of light is let out along
// the aimed line and *held*, burning into the floor, before it collapses to a thread and blinks out. The column is `../beamTube`
// (one draw call); the CPU only paces the beats and fires the cheap batched accents (intake motes, sparks, steam, scorch, ground
// light) through `host.fx`, resolving every metre against the tube's own radius profile so they stay welded to what the GPU draws.
import { Vector3 } from 'three';
import type { Ctx } from '../../emit';
import { FO, M, PAT, SPR, TAU, flash, glow, haloRing, scorch, sparks } from '../../presets/kit';
import { mixHex, scaleHex } from '../../util';
import { BEAM_TESSELLATION, BeamTube } from '../beamTube';
import { BurstMode, BurstSphere } from '../burstSphere';
import { DecalType, GroundDecals } from '../groundDecals';
import { ElementalEffect, type EffectDef } from '../host';
import { Easing, clamp, saturate } from '../math';

const BEAM = {
  /** seconds the orb winds up before the column is let out */
  charge: 0.35,
  /** seconds the column holds on the floor unless the cast says otherwise */
  hold: 1.4,
  /** seconds it takes to collapse to a thread */
  collapse: 0.4,
  /** metres per second the leading edge races downrange */
  speed: 100,
  /** metres in front of the caster the muzzle sits, and the axis height above the floor at both ends */
  hand: 0.6,
  height: 1.0,
  /** wind-up of the intake: motes per second, and how far out they are drawn from (× the column radius) */
  intakeRate: 150,
  intakeReach: 2.8,
  sparkRate: 70,
  moteRate: 26,
  splashRate: 85,
  pulseRate: 1.8,
  /** steady camera rumble while the column stands (trauma held), and the burst of the release / landing */
  rumble: 0.14,
};

/**
 * The sandbox's column look re-tuned for a world point seen from 22 m. The sandbox holds its tube back (opacity 0.29) and lets the
 * ribbons carry the read; here the sheath is lifted and the core held down so the layers keep the palette's saturation instead of
 * stacking into one white plank.
 */
const LOOK = {
  glow: 1,
  opacity: 0.85,
  coreOpacity: 0.7,
  shellRim: 1.5,
  shellFill: 0.4,
  haloOpacity: 0.4,
  haloWidth: 2.4,
  streakGlow: 0.3,
  flare: 0.6,
  flareWidth: 0.12,
  coilFlare: 0.3,
  coilGlow: 2.2,
  coilOpacity: 1.2,
  ringGlow: 2.2,
  ringOpacity: 0.8,
  orbGlow: 1.7,
  laneOpacity: 0.55,
  laneGlow: 1.4,
};

const _p = new Vector3();

class BeamNova extends ElementalEffect {
  /** draw calls: the column / coils / discs / orb mesh, the ground ring layer and the pressure shells */
  readonly cost = 3;
  private tube!: BeamTube;
  private ground!: GroundDecals;
  private shells!: BurstSphere;

  // the cast's shape (the Ctx is scratch: copied, never kept)
  private len = 9;
  private width = 0.85;
  private ux = 0;
  private uz = 1;
  private sx = 1;
  private sz = 0;
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private ex = 0;
  private ey = 0;
  private ez = 0;
  private fx0 = 0;
  private fz0 = 0;
  private intensity = 1;
  private charge = 0;
  private hold = 1.4;
  // the cast's palette
  private main = 0;
  private core = 0;
  private edge = 0;
  private dark = 0;

  // beat state
  private front = 0;
  private released = false;
  private landedAt = -1;
  private accIntake = 0;
  private accSpark = 0;
  private accMote = 0;
  private accSplash = 0;
  private accPulse = 0;
  private accDust = 0;

  build(): void {
    const tess = BEAM_TESSELLATION[this.host.tier];
    this.tube = new BeamTube(tess, 46);
    this.root.add(this.tube.mesh);
    this.ground = new GroundDecals({ additive: 12, renderOrder: 41 });
    this.root.add(this.ground.group);
    this.shells = new BurstSphere(BurstMode.AIR, 6, this.host.tier >= 3 ? 12 : this.host.tier === 2 ? 9 : 6, 44);
    this.root.add(this.shells.mesh);
  }

  start(c: Ctx): boolean {
    const fx = this.host.fx;
    const tube = this.tube;
    const look = tube.look;

    // the shot: from just in front of the caster at chest height, along the aimed line or to the target
    let dx = c.dx;
    let dz = c.dz;
    let L = c.radius > 0 ? c.radius : 9;
    if (c.hasTarget) {
      const tx = c.tx - c.x;
      const tz = c.tz - c.z;
      const d = Math.hypot(tx, tz);
      if (d > 0.5) {
        dx = tx / d;
        dz = tz / d;
        L = d;
      }
    }
    L = clamp(L, 2, 40);
    this.len = L;
    this.ux = dx;
    this.uz = dz;
    this.sx = dz;
    this.sz = -dx;
    this.fx0 = c.x;
    this.fz0 = c.z;
    this.ox = c.x + dx * BEAM.hand;
    this.oz = c.z + dz * BEAM.hand;
    this.oy = c.y + BEAM.height;
    this.ex = c.x + dx * L;
    this.ez = c.z + dz * L;
    this.ey = (c.hasTarget ? c.ty : fx.heightAt(this.ex, this.ez)) + BEAM.height;
    this.intensity = clamp(c.intensity, 0.3, 3);
    this.charge = c.a < 0 ? 0 : c.a > 0 ? c.a : BEAM.charge;
    this.hold = c.duration > 0 ? c.duration : BEAM.hold;

    // the column's size follows the length, within what reads at the game camera
    const W = clamp(0.5 + 0.035 * L, 0.62, 1.15) * clamp(c.scale > 0 ? Math.sqrt(c.scale) : 1, 0.7, 1.4);
    this.width = W;
    const k = W / 0.77;
    look.radius = W;
    look.radiusNear = W * 0.21;
    look.coilWidth = 0.1 * k;
    look.orbSize = 0.39 * k;
    look.glow = LOOK.glow;
    look.opacity = LOOK.opacity;
    look.coreOpacity = LOOK.coreOpacity;
    look.shellRim = LOOK.shellRim;
    look.shellFill = LOOK.shellFill;
    look.haloOpacity = LOOK.haloOpacity;
    look.haloWidth = LOOK.haloWidth;
    look.streakGlow = LOOK.streakGlow;
    look.flare = LOOK.flare;
    look.flareWidth = LOOK.flareWidth;
    look.coilFlare = LOOK.coilFlare;
    look.coilGlow = LOOK.coilGlow;
    look.coilOpacity = LOOK.coilOpacity;
    look.ringGlow = LOOK.ringGlow;
    look.ringOpacity = LOOK.ringOpacity;
    look.orbGlow = LOOK.orbGlow;
    look.laneOpacity = LOOK.laneOpacity;
    look.laneGlow = LOOK.laneGlow;

    const p = c.pal;
    this.main = p.main;
    this.core = p.core;
    this.edge = p.edge;
    this.dark = mixHex(0x0b0e14, p.smoke, 0.15);
    // white-hot axis, a body that keeps the palette's saturation (the edge hue, not the pale main), a deep bloom, the accent hue on the ribbons
    tube.setColors(
      p.core,
      mixHex(p.main, p.core, 0.3),
      mixHex(p.edge, p.main, 0.2),
      scaleHex(p.edge, 0.5),
      mixHex(p.extra, p.core, 0.15),
      p.edge,
      mixHex(p.main, p.core, 0.2),
    );
    this.shells.setColors(p.edge, mixHex(p.main, p.edge, 0.4), p.core);
    tube.origin.set(this.ox, this.oy, this.oz);
    tube.target.set(this.ex, this.ey, this.ez);
    tube.side.set(this.sx, 0, this.sz);
    tube.seed = c.seed * 100;
    const tier = this.host.tier;
    tube.coils = tier >= 3 ? 6 : tier === 2 ? 4 : 3;
    tube.rings = tier >= 3 ? 10 : tier === 2 ? 8 : 6;
    tube.gain = this.intensity;
    tube.progress = 0;
    tube.fade = 1;
    tube.widthFade = 1;
    tube.charge = 0;

    this.front = 0;
    this.released = false;
    this.landedAt = -1;
    this.accIntake = this.accSpark = this.accMote = this.accSplash = this.accPulse = this.accDust = 0;
    this.ground.clear();
    this.shells.clear();
    tube.sampleGround(fx.heightAt);
    tube.sync(0);
    tube.mesh.visible = true;

    // the wind-up's light on the caster's feet (the sandbox's second light, faked)
    if (this.charge > 0) {
      fx.add.at(c.x, c.y + 0.1, c.z).size(W * 2.4, W * 4.2).life(this.charge + 0.1).col(this.main, 0.8, this.edge, 0.2).int(1.1 * this.intensity).spr(SPR.glow).mode(M.ground).fade(1, FO.quad).emit();
    }
    return true;
  }

  step(dt: number): boolean {
    const age = this.age;
    const tube = this.tube;
    tube.charge = this.charge > 0 ? saturate(age / this.charge) : 1;

    if (age < this.charge) {
      this.intake(dt);
      tube.sync(tube.orbRadius(age));
      this.ground.update(dt);
      this.shells.update(dt);
      return true;
    }
    if (!this.released) {
      this.released = true;
      this.release();
    }

    // the leading edge: held at the muzzle until the orb is up to power, then thrown out
    const since = age - this.charge;
    if (this.landedAt < 0) {
      this.front += BEAM.speed * Easing.outQuad(saturate(since / 0.05)) * dt;
      tube.progress = saturate(this.front / this.len);
      if (tube.progress >= 1) {
        this.landedAt = age;
        this.impact();
      }
    }

    let scale = 1;
    if (this.landedAt >= 0) {
      // t runs 0..1 while the beam burns, then 1..2 while it collapses to a thread
      const burn = (age - this.landedAt) / this.hold;
      if (burn > 1) {
        const q = saturate(((burn - 1) * this.hold) / BEAM.collapse);
        // brightness hangs on and then goes; the width pinches early: a snap back to a thread, not a fat beam dimming
        tube.fade = 1 - Easing.inCubic(q);
        tube.widthFade = Math.max(0.04, 1 - Easing.outCubic(q) * 0.94);
        scale = tube.fade * 0.5;
        if (q >= 1) {
          tube.mesh.visible = false;
          this.ground.update(dt);
          this.shells.update(dt);
          return this.ground.busy || this.shells.busy;
        }
      } else {
        this.host.fx.shake(1.8 * BEAM.rumble * dt);
      }
      this.burn(dt, scale);
    }
    this.column(dt, scale);
    tube.sync(tube.orbRadius(age));
    this.ground.update(dt);
    this.shells.update(dt);
    return true;
  }

  override reset(): void {
    super.reset();
    this.tube.mesh.visible = false;
    this.ground.clear();
    this.shells.clear();
  }

  dispose(): void {
    this.tube.dispose();
    this.ground.dispose();
    this.shells.dispose();
  }

  /** The wind-up: light pulled *inward* out of the air and swallowed by the orb. */
  private intake(dt: number): void {
    const fx = this.host.fx;
    const rng = fx.rng;
    const charge = this.tube.charge;
    this.accIntake += dt * BEAM.intakeRate * (0.35 + charge) * fx.density;
    // the shell tightens as the orb fills, so the intake visibly closes in
    const shell = this.width * BEAM.intakeReach * (1 - 0.55 * charge);
    while (this.accIntake >= 1) {
      this.accIntake -= 1;
      const a = rng.f() * TAU;
      const e = rng.r(-0.3, 0.9);
      const ce = Math.cos(e);
      const r = shell * rng.r(0.7, 1.15);
      const life = rng.r(0.22, 0.34);
      const sp = r / life;
      const vx = Math.sin(a) * ce;
      const vz = Math.cos(a) * ce;
      const vy = Math.sin(e);
      fx.add.at(this.ox + vx * r, this.oy + vy * r, this.oz + vz * r).vel(-vx * sp, -vy * sp, -vz * sp).life(life).size(0.09, 0.03).stretch(0.07)
        .col(this.core, 1, this.main, 0.2).int(2.4).spr(SPR.streak).mode(M.streak).fade(0, FO.quad).emit();
    }
    // the orb's own glow, thrown wider as it fills
    fx.add.at(this.ox, this.oy, this.oz).size(this.width * (1.2 + 1.8 * charge), this.width * (1 + 1.4 * charge)).life(0.06).col(this.main, 0.9, this.core, 0.4).int(1.6 + charge)
      .spr(SPR.glow).fade(0, FO.none).emit();
  }

  /** The release: the orb lets go, a pressure shell is shoved out of it, and the floor under the column starts to burn. */
  private release(): void {
    const fx = this.host.fx;
    const rng = fx.rng;
    const W = this.width;
    const I = this.intensity;
    flash(fx, this.ox, this.oy, this.oz, W * 3.2, W * 1.1, 0.22, this.core, 3.2 * I);
    haloRing(fx, this.ox, this.oy, this.oz, W * 0.6, W * 3.4, 0.32, this.main, 0.7, 1.4);
    this.shells.begin(this.ox, this.oy, this.oz).radius(W * 0.4, W * 1.5).life(0.35).int(1.1 * I).opacity(0.5).fresnel(2).displace(0.08).emit();
    sparks(fx, this.ox, this.oy, this.oz, fx.n(26), 6, 16, 0.6, 0.2, 0.45, 0.1, this.core, this.main, this.ux, this.uz, 0.9, 2.4, -6);
    // the shove across the floor at the caster's feet
    this.ground.begin(DecalType.SHOCKWAVE, this.fx0, fx.heightAt(this.fx0, this.fz0), this.fz0).radius(W * 3).life(0.5).col(this.main, this.core).width(0.06).int(0.9 * I).emit();

    // the burn the column leaves on the floor as the front passes over it
    const n = Math.max(2, Math.round(this.len / 1.6));
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const x = this.ox + (this.ex - this.ox) * s + this.sx * rng.s2(W * 0.4);
      const z = this.oz + (this.ez - this.oz) * s + this.sz * rng.s2(W * 0.4);
      scorch(fx, x, z, W * rng.r(0.95, 1.35), this.hold + 5, this.dark, mixHex(this.dark, this.edge, 0.3), PAT.scorch, (s * this.len) / BEAM.speed + 0.05);
    }
    fx.shake(0.1);
    fx.flash(((this.core >> 16) & 255) / 255, ((this.core >> 8) & 255) / 255, (this.core & 255) / 255, 0.07, 0.14);
  }

  /** The front lands: pressure shell, the ring snapping outward across the floor, the strike's sparks, dust and the deep scorch. */
  private impact(): void {
    const fx = this.host.fx;
    const rng = fx.rng;
    const W = this.width;
    const I = this.intensity;
    const { ex, ez } = this;
    const fy = fx.heightAt(ex, ez);
    this.ground.begin(DecalType.SHOCKWAVE, ex, fy, ez).radius(W * 5.5).life(0.65).col(this.main, this.core).width(0.05).int(1.2 * I).emit();
    this.shells.begin(ex, this.ey - 0.3, ez).radius(W * 0.8, W * 2.4).life(0.6).int(1.1 * I).opacity(0.5).fresnel(2).displace(0.1).squash(0.7).emit();
    flash(fx, ex, fy + 0.7, ez, W * 3.6, W * 1.2, 0.26, this.core, 3.4 * I);
    glow(fx, ex, fy + 0.5, ez, W * 5, W * 2.2, 0.55, this.edge, 0.7, 1.4 * I);
    fx.add.at(ex, fy + 0.8, ez).size(W * 2.4, W * 5.6).life(0.28).col(this.core, 1, this.main, 0).int(1.6 * I).spr(SPR.sunburst).rot(rng.f() * TAU, 1.5).fade(0, FO.quad).emit();
    sparks(fx, ex, fy + 0.5, ez, fx.n(46), 5, 14, 1.2, 0.35, 0.8, 0.1, this.core, this.main, -this.ux, -this.uz, 1.6, 2.6, -10);
    for (let i = 0, n = fx.n(10); i < n; i++) {
      const a = rng.f() * TAU;
      const sp = rng.r(3, 7);
      fx.alp.at(ex + Math.sin(a) * W * 0.6, fy + 0.3, ez + Math.cos(a) * W * 0.6).vel(Math.sin(a) * sp, rng.r(0.3, 1.2), Math.cos(a) * sp).life(rng.r(0.6, 1))
        .size(0.7, 2.4).col(this.dark, 0.35, this.dark, 0).spr(SPR.dust0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(1)).drag(2.2).fade(1, FO.sq).emit();
    }
    scorch(fx, ex, ez, W * 2.8, this.hold + 6, scaleHex(this.dark, 0.6), this.edge);
    fx.shake(0.16);
  }

  /** What the column sheds along its length: sparks thrown off the surface and dragged downrange, motes hanging in the wake. */
  private column(dt: number, scale: number): void {
    const fx = this.host.fx;
    const rng = fx.rng;
    const tube = this.tube;
    const reach = Math.max(0.02, tube.progress);
    this.accSpark += dt * BEAM.sparkRate * scale * fx.density;
    while (this.accSpark >= 1) {
      this.accSpark -= 1;
      const s = rng.r(0.04, 1) * reach;
      const rad = tube.radiusAt(s);
      const a = rng.f() * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      tube.axisPoint(s, _p);
      const r = rad * rng.r(0.8, 1.25);
      const rx = this.sx * ca;
      const rz = this.sz * ca;
      // thrown off the surface, then dragged downrange by the flow: pressure, which is the one thing these must not share with a bolt's sparks
      const v = rng.r(3, 7);
      fx.add.at(_p.x + rx * r, _p.y + sa * r, _p.z + rz * r).vel((rx + this.ux * 0.9) * v, sa * v * 0.8, (rz + this.uz * 0.9) * v).life(rng.r(0.22, 0.45)).size(0.1, 0.03).stretch(0.05)
        .col(this.core, 1, this.main, 0).int(2.2).spr(SPR.streak).mode(M.streak).drag(1.8).grav(-6).fade(0, FO.cubic).emit();
    }
    this.accMote += dt * BEAM.moteRate * scale * fx.density;
    while (this.accMote >= 1) {
      this.accMote -= 1;
      const s = rng.f() * reach;
      tube.axisPoint(s, _p);
      const r = tube.radiusAt(s) * 2.2;
      const a = rng.f() * TAU;
      fx.add.at(_p.x + Math.sin(a) * r * this.sx, _p.y + rng.s2(r * 0.7), _p.z + Math.sin(a) * r * this.sz).vel(this.ux * 1.2, rng.r(0.4, 1.1), this.uz * 1.2).life(rng.r(0.7, 1.3)).size(0.18, 0.06)
        .col(this.core, 1, this.main, 0).int(2).spr(SPR.glow).twinkle().fade(1, FO.quad).emit();
    }
  }

  /** What the far end does while the beam stands on it: an impact that keeps happening. */
  private burn(dt: number, scale: number): void {
    const fx = this.host.fx;
    const rng = fx.rng;
    const W = this.width;
    const I = this.intensity;
    const { ex, ey, ez } = this;
    const fy = fx.heightAt(ex, ez);
    const pulse = 0.85 + 0.15 * Math.sin(this.age * 31);
    // end flares, re-emitted every frame (~1 frame long) so they throb with the beam
    fx.add.at(ex, ey, ez).size(W * 1.7 * pulse, W * 1.7).life(0.07).col(this.core, 1, this.main, 0.6).int(2.6 * scale * I).spr(SPR.glowTight).fade(0, FO.none).emit();
    fx.add.at(ex, ey, ez).size(W * 3 * pulse, W * 2.8).life(0.09).col(this.main, 0.7, this.edge, 0.4).int(1.5 * scale * I).spr(SPR.flare).rot(this.age * 3, -3).fade(0, FO.none).emit();

    // sparks thrown back up the line and upward: the wash coming off something being drilled
    this.accSplash += dt * BEAM.splashRate * scale * fx.density;
    while (this.accSplash >= 1) {
      this.accSplash -= 1;
      const a = rng.f() * TAU;
      const v = rng.r(4, 10);
      fx.add.at(ex + Math.sin(a) * W * 0.5, fy + 0.4, ez + Math.cos(a) * W * 0.5).vel(Math.sin(a) * v * 0.7 - this.ux * v * 0.5, rng.r(2, 6), Math.cos(a) * v * 0.7 - this.uz * v * 0.5)
        .life(rng.r(0.2, 0.5)).size(0.1, 0.03).stretch(0.045).col(this.core, 1, this.edge, 0).int(2.4).spr(SPR.streak).mode(M.streak).drag(2.4).grav(-10).fade(0, FO.cubic).emit();
    }
    // pressure rings snapped across the floor and shells shed off the burning point
    this.accPulse += dt * BEAM.pulseRate * scale;
    if (this.accPulse >= 1) {
      this.accPulse -= 1;
      this.ground.begin(DecalType.SHOCKWAVE, ex, fy, ez).radius(W * rng.r(2.6, 3.6)).life(0.5).col(this.main, this.core).width(0.04).int(0.8 * I).emit();
      this.shells.begin(ex, ey - 0.2, ez).radius(W * 0.6, W * 1.7).life(0.4).int(0.8 * I).opacity(0.4).fresnel(2.2).displace(0.08).squash(0.7).emit();
    }
    // steam scoured off the floor under the burn, blown out sideways
    this.accDust += dt * 9 * scale * fx.density;
    while (this.accDust >= 1) {
      this.accDust -= 1;
      const a = rng.f() * TAU;
      fx.alp.at(ex + Math.sin(a) * W * 0.8, fy + 0.25, ez + Math.cos(a) * W * 0.8).vel(Math.sin(a) * rng.r(1, 2.4), rng.r(0.3, 0.9), Math.cos(a) * rng.r(1, 2.4)).life(rng.r(0.5, 0.9))
        .size(0.5, 1.7).col(this.dark, 0.3, this.dark, 0).spr(SPR.dust0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(1)).drag(2).fade(1, FO.sq).emit();
    }
  }
}

export const EFFECTS: EffectDef[] = [{ kind: 'beam.nova', create: () => new BeamNova(), pool: 2, minTier: 1 }];

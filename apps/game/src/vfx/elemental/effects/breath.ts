// Ported from threejs-vfx src/abilities/flame/DragonbreathAbility.js (Wyrm's Breath; config/abilities/dragonbreath.js) (MIT, © mohamedachrefelouafi — see ../LICENSE).
// Signature cone breath: `breath.dragon` — a gout of flame (frost, venom, ... by the cast's palette) from the caster's mouth along the
// aimed line. The gout is `../volumeFire` (one draw call): a hollow raymarched cone that is let out, held, then guttered back toward
// the mouth. The CPU paces those beats and fires the cheap batched accents through `host.fx` — embers streaming off the cone, scorch
// burnt under it, smoke off the floor, the heat flash at the mouth — resolving every metre against the cone's own geometry.
import type { Ctx } from '../../emit';
import { FO, M, PAT, SPR, TAU, flash, glow, scorch, sparks } from '../../presets/kit';
import { mixHex, scaleHex } from '../../util';
import { ElementalEffect, type EffectDef } from '../host';
import { Easing, clamp, saturate } from '../math';
import { FIRE_QUALITY, VolumeFire, volumeFireLook } from '../volumeFire';

const BREATH = {
  /** seconds the gout takes to reach full length, and to gutter out at the end */
  grow: 0.12,
  fade: 0.4,
  /** × length: how far it pulls back toward the mouth as it gutters out */
  dieback: 0.4,
  /** metres in front of the caster the cone starts */
  hand: 0.55,
  /** height of the cone's centre at the far end, above the floor */
  endHeight: 0.4,
  /** mouth half-height ÷ half-width: a breath fans out along the floor */
  squash: 0.5,
  emberRate: 80,
  smokeRate: 12,
  /** steady camera rumble while the breath is held (trauma held) */
  rumble: 0.055,
};

/** What the gas is: the sandbox's flame, and the nearest sensible gas for each other element (emission, absorption, how it moves, how much the noise opens the body and mottles its temperature). */
interface FlameStyle {
  emission: number;
  absorption: number;
  density: number;
  jet: number;
  rise: number;
  swirl: number;
  noise: number;
  hollow: number;
  core: number;
  heat: number;
  cool: number;
}

const FIRE: FlameStyle = { emission: 0.9, absorption: 0.75, density: 1.5, jet: 7.5, rise: 0.9, swirl: 0.6, noise: 1.1, hollow: 0.5, core: 0.6, heat: 0.6, cool: 0.55 };

/** By element index (1 fire, 2 ice, 3 lightning, 4 dark, 5 poison, 7 wind); everything else burns. Emission is low on purpose: the game has no tone map, so the sandbox's 7.5 is a white wall. */
const STYLE: Record<number, FlameStyle> = {
  2: { emission: 0.8, absorption: 0.6, density: 1.6, jet: 6, rise: -0.4, swirl: 0.9, noise: 1, hollow: 0.4, core: 0.55, heat: 0.4, cool: 0.3 },
  3: { emission: 1.6, absorption: 0.5, density: 1.6, jet: 16, rise: 0, swirl: 2.4, noise: 1.2, hollow: 0.3, core: 0.65, heat: 0.6, cool: 0.15 },
  4: { emission: 0.9, absorption: 1.2, density: 2, jet: 6, rise: 0.4, swirl: 0.5, noise: 1, hollow: 0.5, core: 0.5, heat: 0.45, cool: 0.4 },
  5: { emission: 0.9, absorption: 1.1, density: 2, jet: 5.5, rise: 0.6, swirl: 0.8, noise: 1, hollow: 0.46, core: 0.5, heat: 0.45, cool: 0.4 },
  7: { emission: 0.45, absorption: 0.3, density: 1.4, jet: 12, rise: 0, swirl: 1.6, noise: 1.1, hollow: 0.4, core: 0.65, heat: 0.2, cool: 0.2 },
};

const BASE_LOOK = volumeFireLook();

class BreathDragon extends ElementalEffect {
  /** draw calls: the cone's one mesh; the accents ride the shared batches (the march is fill-rate heavy, hence 2) */
  readonly cost = 2;
  private fire!: VolumeFire;

  // the cast's shape (the Ctx is scratch: copied, never kept)
  private ax = 0;
  private ay = 0;
  private az = 0;
  /** the full-length mouth, and the unit axis from the apex to it */
  private mx = 0;
  private my = 0;
  private mz = 0;
  private axx = 0;
  private axy = 0;
  private axz = 1;
  private span0 = 7;
  private ux = 0;
  private uz = 1;
  private sx = 1;
  private sz = 0;
  private tanHalf = 0.48;
  private groundY = 0;
  private seed = 0;
  private total = 0.9;
  private grow = BREATH.grow;
  private fadeT = BREATH.fade;
  private intensity = 1;
  private size = 1;
  // the cast's palette
  private main = 0;
  private core = 0;
  private edge = 0;
  private smoke = 0;

  private accEmber = 0;
  private accSmoke = 0;

  build(): void {
    this.fire = new VolumeFire(45);
    this.root.add(this.fire.mesh);
  }

  start(c: Ctx): boolean {
    const fx = this.host.fx;

    // the shot: from just in front of the caster along the aimed line, or to the target
    let dx = c.dx;
    let dz = c.dz;
    let L = c.radius > 0 ? c.radius : 7;
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
    L = clamp(L, 2.5, 22);
    this.ux = dx;
    this.uz = dz;
    this.sx = dz;
    this.sz = -dx;
    this.ax = c.x + dx * BREATH.hand;
    this.az = c.z + dz * BREATH.hand;
    this.ay = c.y + clamp(0.7 + 0.05 * L, 0.9, 1.5);
    this.mx = c.x + dx * L;
    this.mz = c.z + dz * L;
    const mouthFloor = fx.heightAt(this.mx, this.mz);
    this.my = mouthFloor + BREATH.endHeight;
    this.groundY = (fx.heightAt(this.ax, this.az) + mouthFloor) * 0.5;
    const ex = this.mx - this.ax;
    const ey = this.my - this.ay;
    const ez = this.mz - this.az;
    this.span0 = Math.max(0.5, Math.hypot(ex, ey, ez));
    this.axx = ex / this.span0;
    this.axy = ey / this.span0;
    this.axz = ez / this.span0;
    // c.a is the full angle of the cone, radians; the visible flame is narrower than the gameplay wedge (the burn on the floor shows that)
    this.tanHalf = Math.tan(clamp((c.a > 0 ? c.a : 0.9) * 0.5, 0.12, 0.8)) * 0.72;
    this.total = clamp(c.duration > 0 ? c.duration : 0.9, 0.4, 8);
    this.grow = Math.min(BREATH.grow, this.total * 0.25);
    this.fadeT = Math.min(BREATH.fade, this.total * 0.4);
    this.intensity = clamp(c.intensity, 0.3, 3);
    this.size = clamp(c.scale > 0 ? Math.sqrt(c.scale) : 1, 0.7, 1.4);
    this.seed = c.seed * 100;
    this.accEmber = this.accSmoke = 0;

    const p = c.pal;
    this.main = p.main;
    this.core = p.core;
    this.edge = p.edge;
    this.smoke = p.smoke;
    const fire = this.fire;
    const look = fire.look;
    Object.assign(look, BASE_LOOK);
    const s = STYLE[c.element] ?? FIRE;
    look.emission = s.emission * clamp(this.intensity, 0.5, 1.6);
    look.absorption = s.absorption;
    look.density = s.density;
    look.jet = s.jet;
    look.rise = s.rise;
    look.swirl = s.swirl;
    look.noiseStrength = s.noise;
    look.hollow = s.hollow;
    look.coreErosion = s.core;
    look.heatNoise = s.heat;
    look.cooling = s.cool;
    look.feather = 0.45;
    look.margin = 0.25;
    look.billow = 0.55;
    look.noiseFrequency = 2.6;
    const q = FIRE_QUALITY[this.host.tier];
    look.steps = q.steps;
    look.octaves = q.octaves;
    // a warm white-gold heart, the palette's body and rim, and a dark amber soot (or the palette's own haze, dimmed, for the cold and the gases)
    fire.setPalette(mixHex(p.main, p.core, 0.35), p.main, p.edge, s === FIRE ? scaleHex(p.edge, 0.28) : scaleHex(p.smoke, 0.55));
    fire.place(this.ax, this.ay, this.az, this.ax, this.ay, this.az + 0.1, 0.1, BREATH.squash, this.groundY, this.seed);
    fire.sync(0);
    fire.mesh.visible = false;

    this.muzzle();
    return true;
  }

  step(dt: number): boolean {
    const age = this.age;
    const fire = this.fire;
    if (age >= this.total) {
      fire.mesh.visible = false;
      return false;
    }
    const fx = this.host.fx;
    const grown = saturate(age / this.grow);
    const gut = saturate((age - (this.total - this.fadeT)) / this.fadeT);
    // the front runs out fast, holds, then the mouth walks back toward the caster: the gout is withdrawn, not merely faded
    const reach = Math.max(0.02, Easing.outCubic(grown) * (1 - (1 - BREATH.dieback) * Easing.inQuad(gut)));
    const fade = 1 - Easing.inCubic(gut);
    const span = this.span0 * reach;
    this.place(span, fade);
    fire.mesh.visible = reach > 0.04 && fade > 0.01;

    const scale = fade * Math.min(1, grown * 2);
    if (scale > 0.02) {
      this.accents(dt, scale, reach, span);
      if (gut < 1) fx.shake(1.8 * BREATH.rumble * dt);
    }
    return true;
  }

  override reset(): void {
    super.reset();
    this.fire.mesh.visible = false;
  }

  dispose(): void {
    this.fire.dispose();
  }

  /** Pins the cone to the live reach: the mouth walks along the axis and the flare (half-width ÷ span) stays constant. */
  private place(span: number, fade: number): void {
    const fire = this.fire;
    fire.place(
      this.ax, this.ay, this.az,
      this.ax + this.axx * span, this.ay + this.axy * span, this.az + this.axz * span,
      span * this.tanHalf, BREATH.squash, this.groundY, this.seed,
    );
    fire.sync(fade);
  }

  /** The release: the flash at the mouth, a spray of sparks, the floor scorched under where the cone will be, a little shake. */
  private muzzle(): void {
    const fx = this.host.fx;
    const rng = fx.rng;
    const I = this.intensity;
    const W = (0.9 + 0.04 * this.span0) * this.size;
    const { ax, ay, az } = this;
    flash(fx, ax, ay, az, W * 3, W * 1.2, 0.2, this.core, 3 * I);
    glow(fx, ax, ay - 0.1, az, W * 3.6, W * 1.6, 0.45, this.edge, 0.7, 1.3 * I);
    sparks(fx, ax, ay, az, fx.n(24), 5, 14, 0.5, 0.2, 0.4, 0.1, this.core, this.main, this.ux, this.uz, 0.7, 2, -5);

    // the burn under the cone: blobs that widen with the cone, laid down as the front passes over them
    const dark = mixHex(0x0b0e14, this.smoke, 0.15);
    const rim = mixHex(dark, this.edge, 0.15);
    const n = Math.max(2, Math.round(this.span0 / 2));
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const x = this.ax + (this.mx - this.ax) * s + this.sx * rng.s2(0.3 * s * this.span0 * this.tanHalf);
      const z = this.az + (this.mz - this.az) * s + this.sz * rng.s2(0.3 * s * this.span0 * this.tanHalf);
      const r = Math.max(0.9, s * this.span0 * this.tanHalf * rng.r(0.6, 0.9));
      scorch(fx, x, z, r, this.total + 5, dark, rim, PAT.scorch, s * this.grow);
    }
    fx.shake(0.08);
    fx.flash(((this.core >> 16) & 255) / 255, ((this.core >> 8) & 255) / 255, (this.core & 255) / 255, 0.05, 0.12);
  }

  /** What the cone sheds while it stands: embers streaming off the wall, the hot spot at the mouth, smoke scoured off the floor. */
  private accents(dt: number, scale: number, reach: number, span: number): void {
    const fx = this.host.fx;
    const rng = fx.rng;
    const I = this.intensity;
    const { ax, ay, az, axx, axy, axz } = this;
    const halfFlare = this.tanHalf;

    // the hot spot at the caster's mouth, re-emitted every frame (~1 frame long) so it throbs with the flame
    const pulse = 0.85 + 0.15 * Math.sin(this.age * 29);
    const W = (0.9 + 0.04 * this.span0) * this.size;
    fx.add.at(ax, ay, az).size(W * 1.1 * pulse, W).life(0.07).col(this.main, 0.9, this.edge, 0.5).int(1.3 * scale * I).spr(SPR.glow).fade(0, FO.none).emit();

    this.accEmber += dt * BREATH.emberRate * scale * fx.density;
    while (this.accEmber >= 1) {
      this.accEmber -= 1;
      const s = rng.r(0.12, 1) * reach;
      const a = rng.f() * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rad = s * this.span0 * halfFlare * rng.r(0.35, 0.95);
      const x = ax + axx * s * this.span0 + this.sx * ca * rad;
      const y = ay + axy * s * this.span0 + sa * rad * BREATH.squash;
      const z = az + axz * s * this.span0 + this.sz * ca * rad;
      // carried downrange by the jet, thrown outward off the wall and lifted by the heat, then dragged down
      const v = rng.r(8, 15);
      const lat = rng.r(0.5, 2.6);
      fx.add.at(x, y, z).vel(axx * v + this.sx * ca * lat, axy * v + sa * lat * 0.6 + rng.r(0.3, 1.8), axz * v + this.sz * ca * lat).life(rng.r(0.45, 0.9)).size(0.1, 0.03).stretch(0.12)
        .col(this.main, 1, this.edge, 0).int(1.8).spr(SPR.streak).mode(M.streak).drag(1.2).grav(-5).fade(0, FO.cubic).emit();
    }

    // smoke (or mist, by the palette) scoured off the floor under the cone
    this.accSmoke += dt * BREATH.smokeRate * scale * fx.density;
    while (this.accSmoke >= 1) {
      this.accSmoke -= 1;
      const s = rng.r(0.1, 1) * reach;
      const x = ax + axx * s * this.span0 + this.sx * rng.s2(s * span * halfFlare * 0.6);
      const z = az + axz * s * this.span0 + this.sz * rng.s2(s * span * halfFlare * 0.6);
      const fy = fx.heightAt(x, z);
      fx.alp.at(x, fy + 0.2, z).vel(this.ux * rng.r(0.5, 2.5) + rng.s2(0.8), rng.r(0.5, 1.4), this.uz * rng.r(0.5, 2.5) + rng.s2(0.8)).life(rng.r(0.9, 1.6))
        .size(0.7, 2.2).col(this.smoke, 0.24, this.smoke, 0).spr(SPR.dust0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(1)).drag(1.2).fade(1, FO.sq).emit();
    }
  }
}

export const EFFECTS: EffectDef[] = [{ kind: 'breath.dragon', create: () => new BreathDragon(), pool: 2, minTier: 1 }];

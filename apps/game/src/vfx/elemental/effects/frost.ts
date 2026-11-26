// Ported from threejs-vfx src/abilities/IceAbility.js, src/abilities/GlacierAbility.js and src/abilities/frost/RimeAbility.js
// (MIT, © mohamedachrefelouafi — see ../LICENSE). Signature frost: `frost.lance` (a fracture front races down a line and a field of
// crystals tears up behind it, small and dense at the caster, a wall of blades at the far end, a cluster at the impact),
// `frost.nova` (a crown of blades erupting ring by ring out to the radius on a rime sheet, with a vapour dome and shock ring) and
// `frost.icicle` (crystal spears falling point-first into the floor). The modules they stand on are ../growthField (placement,
// timing, matrices), ../iceMaterial (the lit ice), ../frostField (the frozen ground), ../burstSphere and ../groundDecals; mist,
// glitter, chips, rings and the cold flash are the batched accents (`host.fx`). Every colour derives from `c.pal`.
import { Vector3 } from 'three';
import type { Ctx, Fx } from '../../emit';
import { copyPalette, type Palette } from '../../palette';
import { FO, M, PAT, SPR, TAU, chunks, flash, glow, shockRing, smoke } from '../../presets/kit';
import { mixHex, scaleHex } from '../../util';
import { BurstMode, BurstSphere } from '../burstSphere';
import { FrostField } from '../frostField';
import { createCrystalGeometry } from '../geometry';
import { DecalType, GroundDecals } from '../groundDecals';
import { GrowthEmerge, GrowthField, GrowthLayout, growthParams, type GrowthParams } from '../growthField';
import { ElementalEffect, type EffectDef } from '../host';
import { IceMaterial } from '../iceMaterial';
import { Easing, clamp, saturate } from '../math';
import type { FloorAt } from '../shatterField';
import { Shell, ShellMode } from '../shell';

const _tip = new Vector3();
const _pos = new Vector3();

/** The cast's colours, copied out of the scratch Ctx at `start`. */
interface Tint {
  readonly pal: Palette;
  /** mist: the palette's residue warmed toward its body */
  mist: number;
  /** chips: pale and saturated ends */
  chipA: number;
  chipB: number;
}

function makeTint(): Tint {
  return { pal: { main: 0, core: 0, edge: 0, smoke: 0, extra: 0 }, mist: 0, chipA: 0, chipB: 0 };
}

function fillTint(t: Tint, p: Palette): void {
  copyPalette(p, t.pal);
  t.mist = mixHex(p.smoke, p.main, 0.3);
  t.chipA = mixHex(p.core, p.main, 0.35);
  t.chipB = mixHex(p.main, p.edge, 0.5);
}

/**
 * One ice look for every frost effect. Large areas take the body (`main`) and the saturated `edge`, only the rim and the points
 * take `core`; the analytic room the facets reflect is a neutral sky nudged toward the palette, so a recoloured cast (dark, poison,
 * holy) still reads as glass rather than as tinted plastic.
 */
function paintIce(m: IceMaterial, p: Palette): void {
  m.setColors(p.main, scaleHex(mixHex(p.edge, p.main, 0.35), 0.55), mixHex(p.core, p.main, 0.2), mixHex(p.main, p.edge, 0.55), p.core);
  m.setSky(mixHex(0x3e5470, p.edge, 0.3), mixHex(0xaebccb, p.main, 0.3), mixHex(0x1c1916, p.smoke, 0.12));
}

function paintField(f: FrostField, p: Palette): void {
  f.setColors(p.main, mixHex(p.main, p.core, 0.4), mixHex(p.core, p.main, 0.5), mixHex(p.edge, p.main, 0.3));
}

/** twinkling glints lifting off the ice */
function glitter(fx: Fx, x: number, y: number, z: number, n: number, radius: number, rise: number, life: number, hex0: number, hex1: number, delay = 0): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * radius;
    fx.add.at(x + Math.sin(a) * r, y + rng.r(0, 0.5), z + Math.cos(a) * r).vel(rng.s2(0.4), rise * rng.r(0.4, 1.2), rng.s2(0.4))
      .size(rng.r(0.16, 0.3), 0.05).life(life * rng.r(0.6, 1.2)).delay(delay).col(hex0, 1, hex1, 0).int(2.2)
      .spr(rng.f() < 0.5 ? SPR.glint : SPR.sparkle).rot(rng.f() * TAU).drag(1.1).wob(0.15).twinkle().fade(1, FO.quad).emit();
  }
}

/** ice chips spat where a crystal breaks the surface */
function chips(fx: Fx, x: number, y: number, z: number, n: number, speed: number, size: number, hex0: number, hex1: number, dx: number, dz: number): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const v = speed * rng.r(0.3, 1);
    fx.add.at(x, y + 0.1, z).vel(Math.sin(a) * v * 0.6 + dx * v * 0.35, v * rng.r(0.8, 1.4), Math.cos(a) * v * 0.6 + dz * v * 0.35)
      .size(size * rng.r(0.6, 1.3), size * 0.4).life(rng.r(0.5, 0.9)).col(hex0, 1, hex1, 0).int(1.6).spr(SPR.shard)
      .rot(rng.f() * TAU, rng.s2(12)).grav(-14).drag(0.2).fade(0, FO.quad).emit();
  }
}

/** The cold flash. The flash quad is additive on the linear scene: a faint pulse in the saturated edge colour, never a pale wash. */
function coldPulse(fx: Fx, hex: number, a: number): void {
  fx.flash(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, a, 0.12);
}

// --------------------------------------------------------------------------------------------------------------------- lance

/** defaults copied from the sandbox's `ice` block, authored for a ~12 m cast; `start` scales the metres by the cast length */
const LANCE = {
  count: [0, 110, 150, 190] as const,
  clusterShare: 0.22,
  riseStagger: 0.09,
  /** fraction of the cast duration the fracture front takes to reach the end */
  travel: 0.2,
  /** seconds the shatter + thaw take at the end of the cast */
  leave: 0.62,
  /** metres in front of the caster the first crystals stand */
  lead: 0.7,
  burstSize: 3,
  mistRate: 46,
  glitterRate: 52,
};

class FrostLance extends ElementalEffect {
  /** draw calls: three crystal variants, the rime sheet, the vapour shell */
  readonly cost = 5;
  private field!: GrowthField;
  private ice!: IceMaterial;
  private sheet!: FrostField;
  private shells!: BurstSphere;
  private readonly gp: GrowthParams = growthParams();
  private readonly tint: Tint = makeTint();
  private floorAt!: FloorAt;
  private travel = 0.3;
  private shatterAt = 1;
  private total = 2;
  private impacted = false;
  private shattered = false;
  private k = 1;
  private mistAcc = 0;
  private glitterAcc = 0;

  build(): void {
    const fx = this.host.fx;
    this.floorAt = (x, z) => fx.heightAt(x, z);
    this.ice = new IceMaterial();
    this.field = new GrowthField(this.root, {
      geometry: (v) => createCrystalGeometry({ seed: 7.3 + v * 21.7, sides: 7, taper: 0.69, roughness: 0.09, bend: 0.66 }),
      material: this.ice,
      variants: 3,
      capacity: LANCE.count[3],
      renderOrder: 42,
    });
    this.field.onBreach = (_i, x, y, z, r) => this.breach(x, y, z, r);
    this.field.onCrumble = (_i, x, y, z, r) => this.crumble(x, y, z, r);
    this.sheet = new FrostField(this.host.tier >= 3 ? 36 : 28, 41);
    this.root.add(this.sheet.mesh);
    this.shells = new BurstSphere(BurstMode.FROST, 2, this.host.tier >= 3 ? 12 : 9);
    this.root.add(this.shells.mesh);
  }

  start(c: Ctx): boolean {
    const tier = this.host.tier;
    const L = clamp(c.radius > 0 ? c.radius : 8, 3, 16);
    const T = clamp(c.duration > 0 ? c.duration : 1.6, 0.9, 4);
    // authored for the sandbox's ~9 m cast: footprint and height follow the length, softly
    const k = Math.pow(L / 9, 0.8);
    const kh = clamp(L / 9, 0.6, 1.3);
    const kr = Math.pow(k, 0.6);
    this.k = k;
    let dx = c.dx;
    let dz = c.dz;
    const dl = Math.hypot(dx, dz);
    if (dl < 1e-4) {
      dx = 0;
      dz = 1;
    } else {
      dx /= dl;
      dz /= dl;
    }
    const p = this.gp;
    p.layout = GrowthLayout.LINE;
    p.emerge = GrowthEmerge.PUSH;
    p.origin.set(c.x + dx * LANCE.lead, c.y, c.z + dz * LANCE.lead);
    p.direction.set(dx, 0, dz);
    p.side.set(-dz, 0, dx);
    p.length = L - LANCE.lead;
    p.widthNear = 0.55 * k;
    p.width = 2.5 * k;
    p.widthCurve = 0.75;
    p.frontBias = 0.85;
    p.clumping = 1.35;
    p.scatter = 0.55;
    p.clusterRadius = -1;
    p.heightNear = 0.5 * kh;
    p.height = 3.1 * kh;
    p.heightCurve = 1.7;
    p.heightJitter = 0.55;
    p.crown = 0.55;
    p.peak = 1.45;
    p.peakWidth = 0.28;
    p.crest = 0;
    p.rubble = 0.42;
    p.rubbleScale = 0.3;
    p.rubbleSpread = 1.25;
    p.radiusNear = 0.41 * 0.72 * kr;
    p.radiusFar = 0.41 * 1.15 * kr;
    p.radiusCurve = 0.6;
    p.radiusJitter = 0.93;
    p.lean = 0.42;
    p.leanJitter = 1.5;
    p.leanRamp = 0.65;
    p.leanForward = 0.75;
    p.leanOutward = 0.85;
    p.fan = 0;
    p.twist = 1;
    p.tilt = 0;
    p.riseTime = 0.17;
    p.riseOvershoot = 0.26;
    p.settle = 0.55;
    p.birthFade = 0.45;
    p.breachAt = 0.25;
    p.growFront = 0;
    p.shatterTime = 0.32;
    p.shatterSweep = 0.3;
    p.shatterStagger = 0.15;
    p.shatterSink = 0.45;
    this.field.plant(LANCE.count[tier], LANCE.clusterShare, c.seed);

    paintIce(this.ice, c.pal);
    const look = this.ice.look;
    // quarried, milky ice (the sandbox's lance): no piped light, no bright point, a little less sky in the facets
    look.pipe = 0.15;
    look.tipGlow = 0;
    look.env = 0.45;
    look.edgeGlow = 0.9;
    look.frostLine = 0.35;
    look.birthGlow = 1;
    look.glow = 0.85 * clamp(c.intensity, 0.4, 1.6);
    this.ice.sync();

    // the rime under it: a lane a little wider than the band, opening into a broad patch under the cluster
    const s = this.sheet.shape;
    s.length = L - LANCE.lead * 0.5;
    s.widthNear = p.widthNear * 1.35;
    s.widthFar = p.width * 1.2;
    s.widthCurve = 0.75;
    s.endRadius = p.width * 1.25 * 1.2;
    paintField(this.sheet, c.pal);
    this.sheet.look.fill = 0.2;
    this.sheet.lay(c.x + dx * LANCE.lead * 0.5, c.z + dz * LANCE.lead * 0.5, dx, dz, c.seed * 17, this.floorAt);
    this.sheet.sync(0, -1, 1, 1);

    fillTint(this.tint, c.pal);
    this.shells.setColors(mixHex(c.pal.main, c.pal.edge, 0.35), c.pal.main, mixHex(c.pal.core, c.pal.main, 0.25));
    this.shells.clear();

    this.travel = clamp(T * LANCE.travel, 0.16, 0.45);
    this.shatterAt = Math.max(this.travel + 0.5, T - LANCE.leave);
    this.total = this.shatterAt + p.shatterSweep + p.shatterStagger + p.shatterTime + 0.1;
    this.impacted = false;
    this.shattered = false;
    this.mistAcc = 0;
    this.glitterAcc = 0;
    this.field.setVisible(true);
    return true;
  }

  step(dt: number): boolean {
    const age = this.age;
    if (age >= this.total) return false;
    const fx = this.host.fx;
    const p = this.gp;
    const u = saturate(age / this.travel);
    this.field.triggerUpTo(age, u, LANCE.riseStagger, p.frontBias, false);
    if (!this.impacted && age >= this.travel) {
      this.impacted = true;
      this.field.triggerUpTo(age, 1, LANCE.riseStagger, p.frontBias, true);
      this.impact(fx);
    }
    if (!this.impacted) {
      fx.shake(0.05);
      this.frontFx(fx, dt, u);
    } else if (age < this.shatterAt) {
      this.standFx(fx, dt);
    }
    if (!this.shattered && age >= this.shatterAt) {
      this.shattered = true;
      const end = p.length;
      glitter(fx, p.origin.x + p.direction.x * end * 0.6, p.origin.y + 0.4, p.origin.z + p.direction.z * end * 0.6, fx.n(16), end * 0.45, 1.6, 1.2, this.tint.pal.core, this.tint.pal.main);
    }
    const shatterAge = age >= this.shatterAt ? age - this.shatterAt : -1;
    this.field.update(age, p, this.floorAt, 0, shatterAge);

    // the sheet: freezes down the lane behind the front, opens across the end patch at the impact, sublimates from the caster's end
    const sheet = this.sheet;
    const reach = sheet.reach;
    const lane = sheet.shape.length;
    const front = age < this.travel ? u * lane : lane + Math.min(1, (age - this.travel) / 0.28) * (reach - lane);
    const thaw = shatterAge >= 0 ? (shatterAge / (this.total - this.shatterAt)) * (reach + 1) - 0.5 : -1;
    sheet.sync(front, thaw, front < reach - 0.05 ? 1 : 0, 1 - saturate((age - this.total + 0.25) / 0.25));
    this.shells.update(dt);
    return true;
  }

  /** Mist rolling off the front and glitter lifting out of the wreckage while the fracture travels. */
  private frontFx(fx: Fx, dt: number, u: number): void {
    const p = this.gp;
    const rng = fx.rng;
    const t = this.tint;
    const along = u * p.length;
    const hw = p.widthNear + (p.width - p.widthNear) * Math.pow(u, p.widthCurve);
    const fxx = p.origin.x + p.direction.x * along;
    const fxz = p.origin.z + p.direction.z * along;
    const fy = fx.heightAt(fxx, fxz);
    this.mistAcc += dt * LANCE.mistRate * fx.density;
    while (this.mistAcc >= 1) {
      this.mistAcc -= 1;
      const off = rng.s2(hw * 0.9);
      fx.alp.at(fxx + p.side.x * off, fy + 0.2, fxz + p.side.z * off).vel(rng.s2(0.6), rng.r(0.2, 0.6), rng.s2(0.6)).size(0.9 * this.k + 0.4, 2.6 * this.k + 0.8)
        .life(rng.r(1.2, 1.9)).col(t.mist, 0.24, t.mist, 0).spr(SPR.smoke0 + rng.i(4)).rot(rng.f() * TAU, rng.s2(0.5)).drag(1.9).fade(2, FO.sq, 1).emit();
    }
    this.glitterAcc += dt * LANCE.glitterRate * fx.density;
    while (this.glitterAcc >= 1) {
      this.glitterAcc -= 1;
      glitter(fx, fxx, fy + 0.3, fxz, 1, hw, 2.2, 1.4, t.pal.core, t.pal.main);
    }
  }

  /** The standing field keeps breathing cold: a thinner glitter plume while it holds. */
  private standFx(fx: Fx, dt: number): void {
    const p = this.gp;
    this.glitterAcc += dt * LANCE.glitterRate * 0.35 * fx.density;
    while (this.glitterAcc >= 1) {
      this.glitterAcc -= 1;
      const s = fx.rng.r(0.25, 1) * p.length;
      const x = p.origin.x + p.direction.x * s;
      const z = p.origin.z + p.direction.z * s;
      glitter(fx, x, fx.heightAt(x, z) + 0.35, z, 1, p.width, 1.6, 1.3, this.tint.pal.core, this.tint.pal.main);
    }
  }

  /** Chips and a puff where a crystal breaks the surface. Only some puff: hundreds of them smoking buries the silhouette. */
  private breach(x: number, y: number, z: number, r: number): void {
    const fx = this.host.fx;
    const rng = fx.rng;
    const t = this.tint;
    if (rng.f() < 0.45) chips(fx, x, y, z, 1, 5.5, 0.22 + r * 0.3, t.chipA, t.chipB, this.gp.direction.x, this.gp.direction.z);
    if (rng.f() < 0.12) smoke(fx, x, y + 0.15, z, 1, r, 0.5, 0.9, 1.4, 0.7, 1.8, t.mist, 0.22);
  }

  /** A crystal coming apart: a chip or two and a glint. */
  private crumble(x: number, y: number, z: number, r: number): void {
    const fx = this.host.fx;
    const t = this.tint;
    if (fx.rng.f() < 0.35) chunks(fx, x, y, z, 1, 2.6, 0.12 + r * 0.25, t.chipA, t.chipB, 0.5, 0.9, fx.heightAt(x, z));
    if (fx.rng.f() < 0.3) glitter(fx, x, y, z, 1, r, 1.2, 0.8, t.pal.core, t.pal.main);
  }

  /** The front reaches the end: the terminal cluster goes up, the vapour shell, the ring, the cold flash, chips, fog, glitter. */
  private impact(fx: Fx): void {
    const p = this.gp;
    const t = this.tint;
    const pal = t.pal;
    const k = this.k;
    const x = p.origin.x + p.direction.x * p.length;
    const z = p.origin.z + p.direction.z * p.length;
    const y = fx.heightAt(x, z);
    const size = LANCE.burstSize * k;
    this.shells.begin(x, y + 0.6 * k, z).radius(size * 0.3, size).life(0.7).int(0.42).opacity(0.75).fresnel(1.3).displace(0.55).squash(0.72).emit();
    shockRing(fx, x, z, 5.5 * k, 0.75, pal, 0.12, 1.6);
    flash(fx, x, y + 0.9, z, size * 0.55, size * 0.2, 0.14, pal.core, 2.2);
    glow(fx, x, y + 0.8, z, size * 1.5, size * 0.7, 0.4, pal.edge, 0.45, 1.1);
    chunks(fx, x, y + 0.4, z, fx.n(12), 6.5 * k + 1.5, 0.2 * k + 0.05, t.chipA, t.chipB, 0.6, 1.2, y);
    chips(fx, x, y, z, fx.n(14), 9 * k + 2, 0.3, t.chipA, t.chipB, 0, 0);
    smoke(fx, x, y + 0.3, z, fx.n(8), p.width * 0.8, 0.8, 1.4, 2.2, 1.2 * k + 0.5, 3.4 * k + 1, t.mist, 0.3);
    glitter(fx, x, y + 0.4, z, fx.n(22), p.width, 3.2, 1.8, pal.core, pal.main);
    // the rime that stays once the signature layer lets go
    fx.dec.ground(x, z, 0.02).disk(p.width * 1.4).pat(PAT.frost).life(5).col(pal.core, 0.5, pal.main, 0.35).fade(FO.late).seed(fx.rng.f() * 9).emit();
    fx.shake(0.22 * Math.min(1.4, k + 0.3));
    coldPulse(fx, pal.edge, 0.012);
  }

  override reset(): void {
    super.reset();
    this.field.clear();
    this.shells.clear();
    this.sheet.mesh.visible = false;
  }

  dispose(): void {
    this.field.dispose();
    this.ice.dispose();
    this.sheet.dispose();
    this.shells.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------------- nova

/** a crown of blades, ring by ring (the sandbox's `glacier` crown: blunt wedges thrown outward and fanned so they cross) */
const NOVA = {
  count: [0, 90, 130, 170] as const,
  stagger: 0.07,
  /** seconds the front takes to reach the rim when the cast gives no duration */
  expand: 0.55,
  /** seconds the crown stands when the cast gives no `a` */
  hold: 1.1,
  bands: 3,
  glitterRate: 40,
};

class FrostNova extends ElementalEffect {
  /** draw calls: three blade variants, the rime sheet, the pressure lens */
  readonly cost = 5;
  private field!: GrowthField;
  private ice!: IceMaterial;
  private sheet!: FrostField;
  private lens!: Shell;
  private lensLife = 0.8;
  private readonly gp: GrowthParams = growthParams();
  private readonly tint: Tint = makeTint();
  private floorAt!: FloorAt;
  private expand = 0.55;
  private shatterAt = 1.6;
  private total = 2.5;
  private glitterAcc = 0;
  private shattered = false;

  build(): void {
    const fx = this.host.fx;
    this.floorAt = (x, z) => fx.heightAt(x, z);
    this.ice = new IceMaterial();
    this.field = new GrowthField(this.root, {
      // blunt wedges: a thick base that only narrows to about a third at the tip, so each facet stays wide enough to catch a flash
      geometry: (v) => createCrystalGeometry({ seed: 3.1 + v * 17.9, sides: 7, taper: 0.36, roughness: 0.06, bend: 0.12 }),
      material: this.ice,
      variants: 3,
      capacity: NOVA.count[3],
      renderOrder: 42,
    });
    this.field.onBreach = (_i, x, y, z, r) => this.breach(x, y, z, r);
    this.field.onCrumble = (_i, x, y, z, r) => this.crumble(x, y, z, r);
    this.sheet = new FrostField(this.host.tier >= 3 ? 36 : 28, 41);
    this.root.add(this.sheet.mesh);
    this.lens = new Shell(ShellMode.PRESSURE, 36, 44, 44);
    this.root.add(this.lens.mesh);
  }

  start(c: Ctx): boolean {
    const fx = this.host.fx;
    const tier = this.host.tier;
    const R = clamp(c.radius > 0 ? c.radius : 5, 1.5, 12);
    const expand = clamp(c.duration > 0 ? c.duration : NOVA.expand, 0.2, 1.5);
    const hold = clamp(c.a > 0 ? c.a : NOVA.hold, 0.3, 12);
    const kR = Math.pow(R / 5, 0.7);
    const kr = Math.pow(kR, 0.6);
    const dl = Math.hypot(c.dx, c.dz) || 1;
    const p = this.gp;
    p.layout = GrowthLayout.ZONE;
    p.emerge = GrowthEmerge.PUSH;
    p.centre.set(c.x, c.y, c.z);
    p.direction.set(c.dx / dl, 0, c.dz / dl);
    p.side.set(-p.direction.z, 0, p.direction.x);
    // the middle stays open: the caster stands there, and a crown is a wall you look into
    p.zoneRadius = R * 0.97;
    p.zoneInner = R * 0.24;
    p.radialCurve = 0.6;
    p.radialJitter = 0;
    p.angleJitter = 0;
    p.bands = NOVA.bands;
    p.bandJitter = 0.25;
    p.clusterRadius = -1;
    p.heightNear = 0.45 * kR;
    p.height = 2.6 * kR;
    p.heightCurve = 1.6;
    p.heightJitter = 0.5;
    p.crown = 0;
    p.peak = 1;
    p.crest = 0.45;
    p.rubble = 0.3;
    p.rubbleScale = 0.34;
    p.rubbleSpread = 1.3;
    p.radiusNear = 0.28 * kr;
    p.radiusFar = 0.4 * kr;
    p.radiusCurve = 0.8;
    p.radiusJitter = 0.85;
    p.lean = 0.55;
    p.leanJitter = 0.9;
    p.leanRamp = 0.3;
    p.leanForward = 0;
    p.leanOutward = 1;
    p.fan = 0.9;
    p.twist = 1;
    p.tilt = 0.12;
    p.riseTime = 0.2;
    p.riseOvershoot = 0.3;
    p.settle = 0.5;
    p.emergeSink = 0.9;
    p.birthFade = 0.5;
    p.breachAt = 0.22;
    p.growFront = 0.85;
    p.shatterTime = 0.35;
    p.shatterSweep = 0.3;
    p.shatterStagger = 0.25;
    p.shatterSink = 0.45;
    this.field.plant(NOVA.count[tier], 0, c.seed);

    // near-empty glass carried by its edges, light piped up to a bright point (the crown's treatment, not the lance's milk)
    paintIce(this.ice, c.pal);
    const look = this.ice.look;
    look.density = 0.9;
    look.veins = 0.3;
    look.pipe = 0.9;
    look.tipGlow = 0.5;
    look.edgeGlow = 1.3;
    look.dispersion = 0.75;
    look.env = 0.75;
    look.glow = 0.9 * clamp(c.intensity, 0.4, 1.6);
    this.ice.sync();

    const s = this.sheet.shape;
    s.length = 0;
    s.widthNear = 0;
    s.widthFar = 0;
    s.widthCurve = 1;
    s.endRadius = R * 1.04;
    paintField(this.sheet, c.pal);
    this.sheet.look.fill = 0.1;
    this.sheet.look.fingers = 0.55;
    this.sheet.lay(c.x, c.z, p.direction.x, p.direction.z, c.seed * 23, this.floorAt);
    this.sheet.sync(0, -1, 1, 1);

    const t = this.tint;
    fillTint(t, c.pal);
    const pal = t.pal;
    // the pressure front: a near-invisible lens hugging the floor, carried by its rim (the quake's, in the cast's colours)
    const lens = this.lens;
    lens.axis.set(0, 1, 0);
    lens.origin.set(c.x, c.y, c.z);
    lens.seed = c.seed * 40;
    lens.look.radius = 0.4;
    lens.look.radiusEnd = R * 1.12;
    lens.look.expand = 2.2;
    lens.look.height = 0.16;
    lens.look.lift = 0.06;
    lens.look.displace = 0.08;
    lens.look.fill = 0.03;
    lens.look.rim = 1.6;
    lens.look.rimPower = 3.4;
    lens.look.dissolve = 0.8;
    lens.look.glow = 1.1 * clamp(c.intensity, 0.4, 1.6);
    lens.setColors(pal.edge, pal.main, pal.core);
    this.lensLife = Math.max(expand * 1.4, 0.5);
    lens.t = 0;
    lens.fade = 1;
    lens.sync();
    this.expand = expand;
    this.shatterAt = expand + hold;
    this.total = this.shatterAt + p.shatterSweep + p.shatterStagger + p.shatterTime + 0.1;
    this.glitterAcc = 0;
    this.shattered = false;
    this.field.setVisible(true);

    // the moment of the cast: the shock rings, fog rolling outward, a small centre flash (the caster stands in it), the cold pulse
    const { x, y, z } = c;
    shockRing(fx, x, z, R * 1.08, expand * 1.25 + 0.1, pal, 0.14, 1.8);
    shockRing(fx, x, z, R * 0.66, expand + 0.05, pal, 0.1, 1.2, 0.06);
    flash(fx, x, y + 0.6, z, R * 0.35, R * 0.12, 0.14, pal.core, 2.2);
    dustRingMist(fx, x, y, z, fx.n(10 + R * 2), R, expand * 1.6 + 0.3, t.mist, 1 + R * 0.16);
    fx.shake(0.16 * Math.min(1.4, kR));
    coldPulse(fx, pal.edge, 0.01);
    return true;
  }

  step(dt: number): boolean {
    const age = this.age;
    if (age >= this.total) return false;
    const fx = this.host.fx;
    const p = this.gp;
    const f = Easing.outQuad(saturate(age / this.expand));
    this.field.triggerRadial(age, f, NOVA.stagger, p, true);
    if (age < this.shatterAt && age > this.expand * 0.5) {
      this.glitterAcc += dt * NOVA.glitterRate * fx.density;
      while (this.glitterAcc >= 1) {
        this.glitterAcc -= 1;
        const a = fx.rng.f() * TAU;
        const r = p.zoneRadius * fx.rng.r(0.35, 1);
        const gx = p.centre.x + Math.cos(a) * r;
        const gz = p.centre.z + Math.sin(a) * r;
        glitter(fx, gx, fx.heightAt(gx, gz) + 0.3, gz, 1, 0.4, 1.6, 1.3, this.tint.pal.core, this.tint.pal.main);
      }
    }
    if (!this.shattered && age >= this.shatterAt) {
      this.shattered = true;
      glitter(fx, p.centre.x, p.centre.y + 0.4, p.centre.z, fx.n(18), p.zoneRadius, 1.8, 1.2, this.tint.pal.core, this.tint.pal.main);
    }
    const shatterAge = age >= this.shatterAt ? age - this.shatterAt : -1;
    this.field.update(age, p, this.floorAt, 0, shatterAge);

    // the sheet freezes outward with the front and thaws from the middle as the crown breaks
    const sheet = this.sheet;
    const reach = sheet.reach;
    const thaw = shatterAge >= 0 ? (shatterAge / (this.total - this.shatterAt)) * (reach + 1) - 0.5 : -1;
    sheet.sync(f * reach, thaw, f < 0.999 ? 1 : 0, 1 - saturate((age - this.total + 0.25) / 0.25));
    const lens = this.lens;
    const lt = saturate(age / this.lensLife);
    lens.t = lt;
    lens.fade = age < this.lensLife ? (1 - lt) * (1 - lt) : 0;
    lens.sync();
    return true;
  }

  private breach(x: number, y: number, z: number, r: number): void {
    const fx = this.host.fx;
    const t = this.tint;
    const dx = x - this.gp.centre.x;
    const dz = z - this.gp.centre.z;
    const dl = Math.hypot(dx, dz) || 1;
    if (fx.rng.f() < 0.45) chips(fx, x, y, z, 1, 5, 0.2 + r * 0.3, t.chipA, t.chipB, dx / dl, dz / dl);
    if (fx.rng.f() < 0.1) smoke(fx, x, y + 0.15, z, 1, r, 0.5, 0.9, 1.4, 0.7, 1.8, t.mist, 0.22);
  }

  private crumble(x: number, y: number, z: number, r: number): void {
    const fx = this.host.fx;
    const t = this.tint;
    if (fx.rng.f() < 0.35) chunks(fx, x, y, z, 1, 2.6, 0.12 + r * 0.25, t.chipA, t.chipB, 0.5, 0.9, fx.heightAt(x, z));
    if (fx.rng.f() < 0.3) glitter(fx, x, y, z, 1, r, 1.2, 0.8, t.pal.core, t.pal.main);
  }

  override reset(): void {
    super.reset();
    this.field.clear();
    this.lens.fade = 0;
    this.lens.mesh.visible = false;
    this.sheet.mesh.visible = false;
  }

  dispose(): void {
    this.field.dispose();
    this.ice.dispose();
    this.sheet.dispose();
    this.lens.dispose();
  }
}

/** fog rolling outward across the floor (the batched dust ring in the cast's mist colour) */
function dustRingMist(fx: Fx, x: number, y: number, z: number, n: number, r: number, life: number, hex: number, size: number): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.s2(0.25);
    const sp = (r / life) * rng.r(0.9, 1.3) * 1.6;
    fx.alp.at(x + Math.sin(a) * r * 0.15, y + 0.15, z + Math.cos(a) * r * 0.15).vel(Math.sin(a) * sp, rng.r(0.1, 0.5), Math.cos(a) * sp)
      .life(life * rng.r(0.8, 1.2)).size(size * 0.6, size * rng.r(1.6, 2.4)).col(hex, 0.36, hex, 0).spr(SPR.smoke0 + rng.i(4))
      .rot(rng.f() * TAU, rng.s2(0.6)).drag(2.4).fade(1, FO.sq, 1).emit();
  }
}

// ------------------------------------------------------------------------------------------------------------------- icicle

const ICICLE = {
  count: [0, 5, 6, 7] as const,
  /** seconds an icicle takes to fall */
  fall: 0.26,
  /** metres it falls along its own axis */
  drop: 13,
  /** seconds the icicles stand after the last one lands */
  hold: 0.9,
  lean: 0.5,
};

class FrostIcicle extends ElementalEffect {
  /** draw calls: three spear variants, the rime / crack decals, the vapour shell */
  readonly cost = 5;
  private field!: GrowthField;
  private ice!: IceMaterial;
  private decals!: GroundDecals;
  private shells!: BurstSphere;
  private readonly gp: GrowthParams = growthParams();
  private readonly tint: Tint = makeTint();
  private floorAt!: FloorAt;
  private R = 2.2;
  private kR = 1;
  private intensity = 1;
  private shatterAt = 2;
  private total = 3;

  build(): void {
    const fx = this.host.fx;
    this.floorAt = (x, z) => fx.heightAt(x, z);
    this.ice = new IceMaterial();
    this.field = new GrowthField(this.root, {
      geometry: (v) => createCrystalGeometry({ seed: 11.3 + v * 13.1, sides: 6, taper: 0.16, roughness: 0.2, bend: 0.12 }),
      material: this.ice,
      variants: 3,
      capacity: ICICLE.count[3],
      renderOrder: 42,
    });
    this.field.onBreach = (i, x, y, z, r) => this.land(i, x, y, z, r);
    this.field.onCrumble = (_i, x, y, z, r) => {
      const t = this.tint;
      chunks(fx, x, y, z, fx.n(3), 3, 0.1 + r * 0.3, t.chipA, t.chipB, 0.5, 0.9, fx.heightAt(x, z));
      glitter(fx, x, y, z, fx.n(3), r * 2, 1.2, 0.8, t.pal.core, t.pal.main);
    };
    this.decals = new GroundDecals({ alpha: 2 * ICICLE.count[3] + 2 });
    this.root.add(this.decals.group);
    this.shells = new BurstSphere(BurstMode.FROST, 1, 9);
    this.root.add(this.shells.mesh);
  }

  start(c: Ctx): boolean {
    const fx = this.host.fx;
    const rng = fx.rng;
    const tier = this.host.tier;
    const R = clamp(c.radius > 0 ? c.radius : 2.2, 0.8, 6);
    const T = Math.max(0.3, c.duration > 0 ? c.duration : 0.9);
    const kR = Math.pow(R / 2.2, 0.6);
    const fall = Math.min(ICICLE.fall, T);
    this.R = R;
    this.kR = kR;
    this.intensity = clamp(c.intensity, 0.4, 1.6);
    const p = this.gp;
    p.layout = GrowthLayout.ZONE;
    p.emerge = GrowthEmerge.DROP;
    p.centre.set(c.x, c.y, c.z);
    // the rain comes from up-left: every icicle leans the same way, give or take, so the slant reads on screen
    p.direction.set(-0.94, 0, -0.34);
    p.side.set(0.34, 0, -0.94);
    p.zoneRadius = R * 0.82;
    p.zoneInner = 0;
    p.radialCurve = 1;
    p.radialJitter = 0;
    p.angleJitter = 0;
    p.bands = 0;
    p.heightNear = 2.4 * kR;
    p.height = 2.4 * kR;
    p.heightJitter = 0.3;
    p.crown = 0;
    p.peak = 1;
    p.crest = 0;
    p.rubble = 0;
    p.radiusNear = 0.55 * kR;
    p.radiusFar = 0.55 * kR;
    p.radiusJitter = 0.25;
    p.lean = ICICLE.lean;
    p.leanJitter = 0.4;
    p.leanRamp = 0;
    p.leanForward = 1;
    p.leanOutward = 0.15;
    p.fan = 0.3;
    p.twist = 1;
    p.tilt = 0;
    p.riseTime = fall;
    p.dropHeight = ICICLE.drop;
    p.embed = 0.32;
    p.birthFade = 0.45;
    p.growFront = 0;
    p.shatterTime = 0.3;
    p.shatterSweep = 0.1;
    p.shatterStagger = 0.3;
    p.shatterSink = 0.35;
    const n = this.field.plant(ICICLE.count[tier], 0, c.seed);

    paintIce(this.ice, c.pal);
    const look = this.ice.look;
    look.pipe = 0.7;
    look.tipGlow = 0.6;
    look.birthGlow = 2.2;
    look.glow = 0.9 * clamp(c.intensity, 0.4, 1.6);
    this.ice.sync();
    const t = this.tint;
    fillTint(t, c.pal);
    const pal = t.pal;
    this.shells.setColors(mixHex(pal.main, pal.edge, 0.35), pal.main, mixHex(pal.core, pal.main, 0.25));
    this.shells.clear();
    this.decals.clear();

    // where each one lands and when (the centre one last and biggest, on the marker's beat), and the batched streak riding its fall
    const sl = Math.sin(ICICLE.lean);
    _tip.set(-p.direction.x * sl, -Math.cos(ICICLE.lean), -p.direction.z * sl);
    const a0 = rng.f();
    for (let i = 0; i < n; i++) {
      const radial = i === 0 ? 0.15 : Math.sqrt((i + 0.4) / n);
      this.field.pin(i, (a0 + i * 0.381966) % 1, radial, i === 0 ? 1 : rng.s2(0.7), i === 0 ? 1 : rng.s2(0.7));
      const land = i === 0 ? T : Math.max(fall, T - rng.r(0.02, 0.34));
      this.field.triggerIndex(0, i, land - fall);
      this.field.positionOf(i, p, _pos);
      const gy = fx.heightAt(_pos.x, _pos.z);
      const v = ICICLE.drop / fall;
      const sx = _pos.x - _tip.x * ICICLE.drop;
      const sy = gy - _tip.y * ICICLE.drop;
      const sz = _pos.z - _tip.z * ICICLE.drop;
      fx.add.at(sx, sy, sz).vel(_tip.x * v, _tip.y * v, _tip.z * v).life(fall).delay(land - fall).size(0.5 * kR, 0.5 * kR).stretch(0.05)
        .col(pal.core, 1, pal.main, 0.9).int(2.2).spr(SPR.streak).mode(M.streak).fade(0, FO.snap).emit();
      fx.add.at(sx, sy, sz).vel(_tip.x * v, _tip.y * v, _tip.z * v).life(fall).delay(land - fall).size(1.8 * kR, 1.5 * kR)
        .col(pal.main, 0.45, pal.edge, 0.45).int(1.3).spr(SPR.glow).fade(0, FO.snap).emit();
    }
    this.shatterAt = T + ICICLE.hold;
    this.total = this.shatterAt + p.shatterSweep + p.shatterStagger + p.shatterTime + 0.4;
    this.field.setVisible(true);
    return true;
  }

  step(dt: number): boolean {
    const age = this.age;
    if (age >= this.total) return false;
    const shatterAge = age >= this.shatterAt ? age - this.shatterAt : -1;
    this.field.update(age, this.gp, this.floorAt, 0, shatterAge);
    this.decals.update(dt);
    this.shells.update(dt);
    return true;
  }

  /** An icicle drives into the floor: rime and cracks under it, chips, a puff of vapour; the centre one shakes the ground. */
  private land(i: number, x: number, y: number, z: number, r: number): void {
    const fx = this.host.fx;
    const t = this.tint;
    const pal = t.pal;
    const main = i === 0;
    const k = this.kR * (main ? 1.45 : 1);
    const life = Math.max(0.6, this.total - this.age);
    const gx = (fx.heightAt(x + 1, z) - fx.heightAt(x - 1, z)) * 0.5;
    const gz = (fx.heightAt(x, z + 1) - fx.heightAt(x, z - 1)) * 0.5;
    this.decals.begin(DecalType.FROST, x, y, z).radius(this.R * 0.42 * k).life(life).width(1.5).int(0.75)
      .col(mixHex(pal.main, pal.core, 0.3), mixHex(pal.main, pal.edge, 0.6)).slope(gx, gz).emit();
    this.decals.begin(DecalType.CRACK, x, y, z).radius(0.9 * k).life(Math.min(life, 1.8)).width(0.4).int(0.9)
      .col(mixHex(pal.edge, 0x0a1018, 0.6), pal.main).slope(gx, gz).emit();
    flash(fx, x, y + 0.4, z, 1.1 * k, 0.35 * k, 0.12, pal.core, 3);
    chips(fx, x, y, z, fx.n(main ? 8 : 4), 5 * k, 0.24, t.chipA, t.chipB, 0, 0);
    chunks(fx, x, y + 0.2, z, fx.n(main ? 4 : 2), 3.5, 0.1 * k, t.chipA, t.chipB, 0.6, 1, y);
    smoke(fx, x, y + 0.1, z, main ? 3 : 1, 0.3 * k, 0.6, 0.7, 1.2, 0.5 * k, 1.4 * k, t.mist, 0.28);
    glitter(fx, x, y + 0.2, z, fx.n(main ? 8 : 3), r * 3, 1.4, 1, pal.core, pal.main);
    if (main) {
      this.shells.begin(x, y + 0.1, z).radius(this.R * 0.2, this.R * 1.1).life(0.6).int(0.45).opacity(0.7).fresnel(1.3).displace(0.45).squash(0.6).emit();
      shockRing(fx, x, z, this.R * 1.6, 0.5, pal, 0.18, 1.8 * this.intensity);
      glow(fx, x, y + 0.7, z, this.R * 2.2, this.R, 0.4, pal.main, 0.6, 1.1);
      // the rime that stays once the signature layer lets go
      fx.dec.ground(x, z, 0.02).disk(this.R * 1.3).pat(PAT.frost).life(4.5).col(pal.core, 0.5, pal.main, 0.35).fade(FO.late).seed(fx.rng.f() * 9).emit();
      fx.shake(0.12);
      coldPulse(fx, pal.edge, 0.01);
    }
  }

  override reset(): void {
    super.reset();
    this.field.clear();
    this.shells.clear();
    this.decals.clear();
  }

  dispose(): void {
    this.field.dispose();
    this.ice.dispose();
    this.decals.dispose();
    this.shells.dispose();
  }
}

export const EFFECTS: EffectDef[] = [
  { kind: 'frost.lance', create: () => new FrostLance(), pool: 2, minTier: 1 },
  { kind: 'frost.nova', create: () => new FrostNova(), pool: 3, minTier: 1 },
  { kind: 'frost.icicle', create: () => new FrostIcicle(), pool: 2, minTier: 1 },
];

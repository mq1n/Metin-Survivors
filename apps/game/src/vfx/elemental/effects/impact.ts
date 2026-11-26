// Signature impact effects: `impact.meteor` (burning rock + raymarched wake + molten crater), `impact.wake` (the same wake without
// the rock, for bodies the render layer already draws), `impact.fissure` (ground-tearing quake: molten fissure network, lifting
// debris, shock lens). Techniques ported from threejs-vfx (MIT, © mohamedachrefelouafi — see ../LICENSE): MeteorAbility,
// AnvilfallAbility; the modules they stand on are ../meteorMaterial, ../emberTrail, ../fissures, ../shatterField, ../shell.
import { InstancedBufferAttribute, InstancedMesh, Object3D, Quaternion, Vector3 } from 'three';
import type { Ctx } from '../../emit';
import { mixHex, scaleHex } from '../../util';
import { EmberTrail } from '../emberTrail';
import { Fissures } from '../fissures';
import { createAsteroidGeometry } from '../geometry';
import { ElementalEffect, type EffectDef } from '../host';
import { hash11, saturate } from '../math';
import { MeteorMaterial } from '../meteorMaterial';
import { ShatterField, shatterParams, type ShatterParams } from '../shatterField';
import { Shell, ShellMode } from '../shell';

const TAU = Math.PI * 2;

/** Seconds the body spends visibly falling; a longer `duration` makes the effect wait (the preset's marker covers the delay). */
export const METEOR_FALL = 0.9;
/** metres above the impact the slanted start sits */
const SLANT_HEIGHT = 18;
/** wake-only default fall height (the render layer's metin stone) */
const WAKE_HEIGHT = 75;
/** seconds the wake takes to burn back to the head after the impact */
const BURN_OUT = 0.9;

const _pos = new Vector3();
const _dir = new Vector3();
const _axis = new Vector3();
const _spin = new Quaternion();
const _dummy = new Object3D();

/** palettes whose body colour is a warm (orange / red / gold) fire hue keep part of the black-body physics in the wake */
function isWarm(hex: number): boolean {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return r >= 200 && b < r * 0.55 && g < r * 1.02;
}

/** one rock look for the whole effect: grey stone tinted by the palette's smoke, seams in the palette's fire */
function paintRock(m: MeteorMaterial, c: Ctx): void {
  const p = c.pal;
  const rock = mixHex(0x514b45, p.smoke, 0.25);
  m.setPalette(rock, scaleHex(mixHex(0x120f0c, p.smoke, 0.15), 0.8), mixHex(p.main, p.edge, 0.35), p.core);
}

// ------------------------------------------------------------------------------------------------------------------ meteor

class ImpactMeteor extends ElementalEffect {
  readonly cost: number;
  private readonly wakeOnly: boolean;

  private trail!: EmberTrail;
  private body!: InstancedMesh;
  private bodyMat!: MeteorMaterial;
  private bodySeed!: InstancedBufferAttribute;
  private chunks!: ShatterField;
  private chunkMat!: MeteorMaterial;
  private readonly chunkParams: ShatterParams = shatterParams();
  private fissures!: Fissures;
  private lipMat!: MeteorMaterial;
  private dome!: Shell;
  private floorAt!: (x: number, z: number) => number;

  // per-cast state (dice and timestamps only; metres are derived each frame)
  private wake = false;
  private tilt = 0;
  private wait = 0;
  private fall = METEOR_FALL;
  private impactAt = 0;
  private detonated = false;
  private ex = 0;
  private ey = 0;
  private ez = 0;
  private R = 2.4;
  private rockR = 1;
  private scale = 1;
  private lob = false;
  private seed = 0;
  private spinRate = 3.4;
  private chunkLife = 3.6;
  private domeLife = 0.5;
  private total = 0;
  private shakeAmount = 0.35;
  private tier = 2;

  constructor(wakeOnly: boolean) {
    super();
    this.wakeOnly = wakeOnly;
    // visible draw calls: body, chunks, wake, fissure ribbon, lips, dome; the wake-only variant draws the wake alone
    this.cost = wakeOnly ? 1 : 6;
  }

  build(): void {
    const fx = this.host.fx;
    this.floorAt = (x, z) => fx.heightAt(x, z);
    const tier = this.host.tier;

    this.trail = new EmberTrail(11);
    this.root.add(this.trail.mesh);
    if (this.wakeOnly) return;

    // the rock
    this.bodyMat = new MeteorMaterial();
    const geometry = createAsteroidGeometry({
      seed: 11.7, detail: tier >= 2 ? 3 : 2, lumpiness: 0.3, noiseScale: 1.5, roughness: 0.16, cuts: 9, cutDepth: 0.32,
      craters: 5, craterDepth: 0.18, craterSize: 0.5,
    });
    this.bodySeed = new InstancedBufferAttribute(new Float32Array(1), 1);
    geometry.setAttribute('aSeed', this.bodySeed);
    geometry.setAttribute('aLife', new InstancedBufferAttribute(new Float32Array(1), 1));
    this.body = new InstancedMesh(geometry, this.bodyMat, 1);
    this.body.frustumCulled = false;
    this.body.renderOrder = 2;
    this.body.visible = false;
    this.root.add(this.body);

    // the wreckage it breaks into
    this.chunkMat = new MeteorMaterial();
    this.chunks = new ShatterField(this.root, {
      geometry: (v) => createAsteroidGeometry({ seed: 3.3 + v * 5.1, detail: 1, lumpiness: 0.34, cuts: 4, cutDepth: 0.22, craters: 1 }),
      material: this.chunkMat,
      variants: 1,
      capacity: 24,
      renderOrder: 3,
    });

    // the crater
    this.lipMat = new MeteorMaterial();
    this.fissures = new Fissures(this.lipMat, 41);
    this.root.add(this.fissures.ribbon);
    this.root.add(this.fissures.lips);
    this.dome = new Shell(ShellMode.DOME, 48, 64, 12);
    this.root.add(this.dome.mesh);
  }

  start(c: Ctx): boolean {
    const tier = this.host.tier;
    this.tier = tier;
    this.wake = this.wakeOnly || c.b >= 1;
    this.seed = c.seed;
    this.detonated = false;
    this.lob = !this.wake && c.hasTarget;
    this.R = c.radius > 0 ? c.radius : 2.4;
    this.scale = c.scale > 0 ? c.scale : 1;
    this.rockR = Math.max(0.35, this.R * 0.4);
    const T = Math.max(c.duration > 0 ? c.duration : METEOR_FALL, 0.3);
    this.fall = Math.min(T, METEOR_FALL);
    this.wait = T - this.fall;
    this.impactAt = T;
    this.spinRate = 3.4;

    // impact point
    if (this.lob) {
      this.ex = c.tx;
      this.ey = c.ty;
      this.ez = c.tz;
    } else {
      this.ex = c.x;
      this.ey = c.y;
      this.ez = c.z;
    }

    const trail = this.trail;
    const look = trail.look;
    trail.setTier(tier);
    const k = this.wake ? this.scale : this.rockR / 0.8;
    look.width = (this.wake ? 0.6 : 0.66) * k;
    look.span = (this.wake ? 15 : 7) * k;
    look.headSize = this.wake ? 1.05 : 1.8;
    look.opacity = this.wake ? 0.9 : 0.96;
    look.glow = this.wake ? 2.4 : 2.3;
    look.tailFade = this.wake ? 0.5 : 0.71;
    const p = c.pal;
    // a stone falling out of the sky burns orange whatever its rune colour (`b` ≥ 1 on the wake kind): pure black-body fire
    const blackBody = this.wakeOnly && c.b >= 1;
    trail.setPalette(p.core, p.main, p.edge, mixHex(p.smoke, 0x101010, 0.6), blackBody ? 0 : isWarm(p.main) ? 0.62 : 1);

    if (this.wake) {
      // the render layer's stone path: y = ground + H·(1−p)^2.2, straight above the landing point
      const H = c.a > 1 ? c.a : WAKE_HEIGHT;
      const lift = 1.5 * this.scale;
      trail.setPath(c.x, c.y + H + lift, c.z, c.x, c.y + lift, c.z, 0, 0.85);
      this.total = T + BURN_OUT * 0.55;
    } else {
      if (this.lob) {
        const sx = c.x;
        const sy = c.y + 1.35;
        const sz = c.z;
        const dist = Math.hypot(c.tx - sx, c.tz - sz);
        trail.setPath(sx, sy, sz, c.tx, c.ty + this.rockR * 0.8, c.tz, Math.min(8, Math.max(1.5, dist * 0.22)), 0.85);
      } else {
        // steep slanted line from the upper left of the screen, jittered by the cast seed
        const sd = c.seed * 31.7;
        const ox = -SLANT_HEIGHT * (0.5 + 0.12 * hash11(sd));
        const oz = -SLANT_HEIGHT * (0.28 + 0.1 * hash11(sd + 1.3));
        trail.setPath(c.x + ox, c.y + SLANT_HEIGHT, c.z + oz, c.x, c.y + this.rockR * 0.8, c.z, 0, 0.85);
      }
      const dome = this.dome;
      dome.look.radius = 0.3 * this.R;
      dome.look.radiusEnd = 1.6 * this.R;
      dome.look.expand = 4.5;
      dome.look.height = 0.8;
      dome.look.lift = 0.05;
      dome.look.displace = 0.16;
      dome.look.noiseScale = 1.8;
      dome.look.fill = 0.12;
      dome.look.rim = 1.5;
      dome.look.rimPower = 2.2;
      dome.look.seal = 1.2;
      dome.look.glow = 1.0;
      dome.look.dissolve = 0.85;
      dome.setColors(p.edge, p.main, p.core);
      dome.axis.set(0, 1, 0);
      dome.origin.set(this.ex, this.ey, this.ez);
      dome.seed = c.seed * 40;
      dome.t = 0;
      dome.fade = 0;
      dome.sync();

      // body
      const m = this.bodyMat;
      paintRock(m, c);
      (this.bodySeed.array as Float32Array)[0] = c.seed * 10;
      this.bodySeed.needsUpdate = true;
      this.tilt = hash11(c.seed * 9.1) * TAU;
      this.body.visible = false;

      // chunks
      const ch = this.chunkParams;
      const n = tier >= 3 ? 24 : tier === 2 ? 18 : 12;
      this.chunkLife = 3.6;
      ch.centre.set(this.ex, this.ey, this.ez);
      ch.radius = 0;
      ch.spawnRadius = this.rockR * 0.3;
      ch.spawnHeight = this.rockR * 0.5;
      ch.speed = 6.75 * Math.pow(this.rockR / 0.8, 0.35);
      ch.speedJitter = 0.5;
      ch.elevMin = 0.12;
      ch.elevMax = 1.4;
      ch.gravity = -17;
      ch.drag = 0.1;
      ch.size = this.rockR * 0.28 * 0.8;
      ch.sizeJitter = 0.44;
      ch.shrink = 0.2;
      ch.shrinkPower = 1.6;
      ch.spin = 6;
      ch.spinJitter = 1;
      ch.floorSpin = 0.2;
      ch.lifetime = this.chunkLife;
      ch.sinkStart = 0.72;
      paintRock(this.chunkMat, c);
      this.chunkMat.look.leadGlow = 0;
      this.chunkMat.look.rimHeat = 0.3;
      this.chunkMat.u.uCool.value = this.chunkLife / 2.6;
      this.chunkMat.sync(0.7, 0, 1, 0);
      this.chunks.clear();
      this.chunks.burst(0, n, c.seed);
      this.chunks.setVisible(false);

      // the crater
      const f = this.fissures;
      f.look.radius = 1.9 * this.R;
      f.look.width = 0.14 * Math.pow(this.R / 2.4, 0.6);
      f.look.life = 4.4;
      f.look.arms = tier >= 3 ? 7 : 6;
      f.look.branches = tier >= 2 ? 0.8 : 0.55;
      f.look.lipSize = 0.3 * Math.pow(this.R / 2.4, 0.6);
      paintRock(this.lipMat, c);
      this.lipMat.look.leadGlow = 0;
      this.lipMat.look.rimHeat = 0.15;
      this.lipMat.u.uCool.value = 1.5;
      this.lipMat.sync(0.6, 0, 1, 0);
      f.setPalette(p.smoke, p.edge, p.main, p.core);
      this.shakeAmount = 0.34 * Math.min(1.5, Math.max(0.7, this.R / 2.4));
      this.total = T + Math.max(f.look.life, this.chunkLife) + 0.3;
    }
    this.trail.sync(0, 0, this.ey, 0);
    this.trail.setOccluder(0, 0, 0, 0);
    this.trail.mesh.visible = false;
    return true;
  }

  /** path fraction of the falling body at fall progress `u` (0..1) */
  private qOf(u: number): number {
    if (this.wake) return 1 - Math.pow(1 - u, 2.2);
    return this.lob ? u : Math.pow(u, 1.15);
  }

  step(_dt: number): boolean {
    const age = this.age;
    const trail = this.trail;
    if (age >= this.total) return false;

    if (this.wake) {
      const u = saturate(age / this.impactAt);
      const burn = saturate((age - this.impactAt) / (BURN_OUT * 0.55));
      trail.sync(this.qOf(u), burn, this.ey, saturate(age / 0.25));
      return true;
    }

    const flight = age - this.wait;
    if (flight < 0) {
      this.trail.mesh.visible = false;
      return true;
    }
    if (age < this.impactAt) {
      const u = saturate(flight / this.fall);
      const q = this.qOf(u);
      // heats up on the way in: the seams prise open and the nose goes white
      const charge = saturate(0.2 + 0.8 * Math.pow(u, 1.2));
      trail.headingAt(q, _dir);
      this.bodyMat.sync(charge, _dir.x, _dir.y, _dir.z);
      trail.pointAt(q, _pos);
      trail.setOccluder(_pos.x, _pos.y, _pos.z, this.rockR * 0.9);
      _axis.set(Math.sin(this.tilt), 0.6, Math.cos(this.tilt)).normalize();
      _spin.setFromAxisAngle(_axis, flight * this.spinRate);
      _dummy.position.copy(_pos);
      _dummy.quaternion.copy(_spin);
      _dummy.scale.setScalar(this.rockR);
      _dummy.updateMatrix();
      this.body.setMatrixAt(0, _dummy.matrix);
      this.body.instanceMatrix.needsUpdate = true;
      this.body.visible = true;
      trail.sync(q, 0, this.ey, saturate(flight / 0.12));
      return true;
    }

    if (!this.detonated) this.detonate();
    const since = age - this.impactAt;

    this.body.visible = false;
    trail.sync(1, saturate(since / BURN_OUT), this.ey, 1);

    const dome = this.dome;
    const t = saturate(since / this.domeLife);
    dome.t = t;
    dome.fade = since < this.domeLife ? Math.pow(1 - t, 1.5) * 0.9 : 0;
    dome.sync();

    this.chunks.update(since, this.chunkParams, this.floorAt);
    this.fissures.step(since);
    return true;
  }

  /** the rock lands: flash, shell, wreckage, molten cracks */
  private detonate(): void {
    this.detonated = true;
    this.trail.setOccluder(0, 0, 0, 0);
    const fx = this.host.fx;
    this.domeLife = 0.5;
    this.chunks.setVisible(true);
    const maxLips = this.tier >= 3 ? 40 : this.tier === 2 ? 28 : 0;
    this.fissures.start(this.seed, this.ex, this.ey, this.ez, this.floorAt, maxLips);
    fx.shake(this.shakeAmount);
  }

  override reset(): void {
    super.reset();
    this.trail.mesh.visible = false;
    if (this.wakeOnly) return;
    this.body.visible = false;
    this.chunks.clear();
    this.chunks.setVisible(false);
    this.fissures.hide();
    this.dome.fade = 0;
    this.dome.mesh.visible = false;
  }

  dispose(): void {
    this.trail.dispose();
    if (this.wakeOnly) return;
    this.body.geometry.dispose();
    this.body.dispose();
    this.bodyMat.dispose();
    this.chunks.dispose();
    this.chunkMat.dispose();
    this.fissures.dispose();
    this.lipMat.dispose();
    this.dome.dispose();
  }
}

// ------------------------------------------------------------------------------------------------------------------ fissure

class ImpactFissure extends ElementalEffect {
  // visible draw calls: fissure ribbon, lips, debris, shock lens
  readonly cost = 4;

  private fissures!: Fissures;
  private lipMat!: MeteorMaterial;
  private debris!: ShatterField;
  private debrisMat!: MeteorMaterial;
  private readonly debrisParams: ShatterParams = shatterParams();
  private lens!: Shell;
  private floorAt!: (x: number, z: number) => number;
  private lensLife = 0.8;
  private total = 1;

  build(): void {
    const fx = this.host.fx;
    this.floorAt = (x, z) => fx.heightAt(x, z);
    this.lipMat = new MeteorMaterial();
    this.fissures = new Fissures(this.lipMat, 41);
    this.root.add(this.fissures.ribbon);
    this.root.add(this.fissures.lips);
    this.debrisMat = new MeteorMaterial();
    this.debris = new ShatterField(this.root, {
      geometry: (v) => createAsteroidGeometry({ seed: 7.7 + v * 3.1, detail: 1, lumpiness: 0.3, cuts: 4, cutDepth: 0.2, craters: 1 }),
      material: this.debrisMat,
      variants: 1,
      capacity: 30,
      renderOrder: 3,
    });
    this.lens = new Shell(ShellMode.PRESSURE, 36, 44, 12);
    this.root.add(this.lens.mesh);
  }

  start(c: Ctx): boolean {
    const tier = this.host.tier;
    const R = c.radius > 0 ? c.radius : 6;
    const T = Math.max(c.duration > 0 ? c.duration : 0.7, 0.25);
    const p = c.pal;
    const debrisScale = c.a > 0 ? c.a : 0;
    const domed = c.b >= 1;
    const kR = Math.pow(R / 6, 0.6);

    // the cracks
    const f = this.fissures;
    f.look.radius = R;
    f.look.width = 0.14 * kR * 1.25;
    f.look.growth = R / Math.min(1.1, Math.max(0.3, T * 0.8));
    f.look.life = domed ? 3.4 : 4.2;
    f.look.arms = tier >= 3 ? 8 : tier === 2 ? 7 : 6;
    f.look.branches = tier >= 2 ? 0.85 : 0.6;
    f.look.lipSize = 0.34 * kR;
    paintRock(this.lipMat, c);
    this.lipMat.look.leadGlow = 0;
    this.lipMat.look.rimHeat = 0.15;
    this.lipMat.u.uCool.value = 1.4;
    this.lipMat.sync(0.5, 0, 1, 0);
    f.setPalette(p.smoke, p.edge, p.main, p.core);
    f.start(c.seed, c.x, c.y, c.z, this.floorAt, tier >= 3 ? 40 : tier === 2 ? 30 : 0);

    // slabs lifting off the floor along the cracks
    const d = this.debrisParams;
    const n = Math.round((tier >= 3 ? 26 : tier === 2 ? 20 : 12) * debrisScale);
    this.debris.clear();
    this.debris.setVisible(n > 0);
    if (n > 0) {
      d.centre.set(c.x, c.y, c.z);
      d.radius = R * 0.8;
      d.spawnRadius = 0.2;
      d.spawnHeight = 0.05;
      d.speed = 4.2 * Math.pow(R / 6, 0.4);
      d.speedJitter = 0.55;
      d.elevMin = 1.0;
      d.elevMax = 1.5;
      d.gravity = -15;
      d.drag = 0.15;
      d.size = 0.3 * kR;
      d.sizeJitter = 0.5;
      d.shrink = 0.25;
      d.shrinkPower = 1.8;
      d.spin = 2.5;
      d.spinJitter = 1;
      d.floorSpin = 0.2;
      d.lifetime = 2.4;
      d.sinkStart = 0.75;
      paintRock(this.debrisMat, c);
      this.debrisMat.look.leadGlow = 0;
      this.debrisMat.look.rimHeat = 0.2;
      this.debrisMat.u.uCool.value = 2.2;
      this.debrisMat.sync(0.6, 0, 1, 0);
      this.debris.burst(0, n, c.seed + 0.37);
    }

    // the shock lens: a flat pressure front hugging the floor (a dome when this is an impact rather than a slam)
    const lens = this.lens;
    lens.axis.set(0, 1, 0);
    lens.origin.set(c.x, c.y, c.z);
    lens.seed = c.seed * 40;
    lens.look.radius = 0.4;
    lens.look.radiusEnd = R * 1.18;
    lens.look.expand = 2.2;
    lens.look.height = domed ? 0.42 : 0.1;
    lens.look.lift = 0.06;
    lens.look.displace = 0.08;
    lens.look.fill = domed ? 0.05 : 0.025;
    lens.look.rim = 1.7;
    lens.look.rimPower = 3.6;
    lens.look.dissolve = 0.8;
    lens.look.glow = 1.1;
    lens.setColors(mixHex(p.edge, p.smoke, 0.3), mixHex(p.main, 0xcdbd9a, 0.35), p.core);
    this.lensLife = Math.max(T * 1.2, 0.5);
    lens.t = 0;
    lens.fade = 1;
    lens.sync();
    this.total = f.look.life + 0.2;
    return true;
  }

  step(_dt: number): boolean {
    const age = this.age;
    if (age >= this.total) return false;
    const lens = this.lens;
    const t = saturate(age / this.lensLife);
    lens.t = t;
    lens.fade = age < this.lensLife ? (1 - t) * (1 - t) : 0;
    lens.sync();
    this.debris.update(age, this.debrisParams, this.floorAt);
    this.fissures.step(age);
    return true;
  }

  override reset(): void {
    super.reset();
    this.fissures.hide();
    this.debris.clear();
    this.debris.setVisible(false);
    this.lens.fade = 0;
    this.lens.mesh.visible = false;
  }

  dispose(): void {
    this.fissures.dispose();
    this.lipMat.dispose();
    this.debris.dispose();
    this.debrisMat.dispose();
    this.lens.dispose();
  }
}

export const EFFECTS: EffectDef[] = [
  { kind: 'impact.meteor', create: () => new ImpactMeteor(false), pool: 2, minTier: 1 },
  { kind: 'impact.wake', create: () => new ImpactMeteor(true), pool: 3, minTier: 1 },
  { kind: 'impact.fissure', create: () => new ImpactFissure(), pool: 2, minTier: 1 },
];

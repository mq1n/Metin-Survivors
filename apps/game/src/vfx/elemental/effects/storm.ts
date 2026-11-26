// Ported from threejs-vfx src/abilities/ThunderAbility.js and src/abilities/storm/ChainArcAbility.js (MIT, © mohamedachrefelouafi — see ../LICENSE).
// Signature lightning: `storm.bolt` (a bundle of filaments struck onto a world point, or a barrage of them) and `storm.chain`
// (one hopping ArcNetwork link). Everything shape-related lives in the filament vertex shader; the CPU only schedules strikes,
// hands the shader their endpoints and fires the cheap batched accents (sparks, dust, scorch) through `host.fx`.
import { Vector3 } from 'three';
import type { Ctx, Fx } from '../../emit';
import { FO, M, PAT, SPR, TAU, dustRing, flash, glow, haloRing, scorch, sparks } from '../../presets/kit';
import { PALETTES } from '../../palette';
import { mixHex } from '../../util';
import { BurstMode, BurstSphere } from '../burstSphere';
import { ArcNetwork, createArcNetworkParams } from '../arcNetwork';
import { FilamentPaths, MAX_FILAMENT_ROLES, createFilamentLook, paletteLook, type FilamentLook } from '../filament';
import { DecalType, GroundDecals } from '../groundDecals';
import { ElementalEffect, type EffectDef } from '../host';
import { Easing, clamp, saturate } from '../math';

const MAX_STRIKES = 8;
/** metres between the strike point and where the bolt leaves the sky */
const SKY_H = 22;
/** seconds the strike front takes to race down */
const FRONT = 0.085;
/** seconds the bolt holds after landing, guttering and re-striking */
const HOLD = 0.34;
/** seconds it takes to blow out */
const FADE = 0.3;
/** seconds a barrage spreads its strikes over unless `c.b` says otherwise */
const BARRAGE_SPAN = 1.2;
const STRIKE_LIFE = FRONT + HOLD + FADE;
const DUST = PALETTES.dust.main;

const _top = new Vector3();
const _gnd = new Vector3();
const _up = new Vector3();
const _from = new Vector3();
const _to = new Vector3();

const TUNE = {
  width: 0.1,
  glow: 2.4,
  glowWidth: 6,
  glowOpacity: 0.55,
  jitter: 0.8,
  jitterScale: 0.32,
  octaves: 4,
  falloff: 0.5,
  coreSharp: 3.6,
  glowFalloff: 2.1,
  spine: 1.7,
  outerDim: 0.6,
  spreadTop: 1,
  spreadGround: 0.28,
  spreadCurve: 1.3,
  twist: 0.25,
  popGain: 2.2,
  tipGlow: 2.2,
  forkKink: 0.3,
  forkAngle: 0.55,
  forkLen: 0.28,
  // a fork's kink frequency is counted over the whole 22 m trunk, but the fork is only ~6 m of it: scale it back down
  forkFreq: 0.9,
  shellDisplace: 0.08,
  crawlKink: 0.3,
  crawlFreq: 3,
  crawlWander: 1.5,
  flashInt: 1,
  glowInt: 0.7,
  sunInt: 1.4,
  shellInt: 1,
  arcR: 1.25,
  arcWidth: 1.4,
  arcInt: 2.2,
  lean: 5,
};

/** One bolt of a cast: where it lands, when, and which filament roles it owns while it lives. */
interface Strike {
  /** effect-age seconds the front leaves the sky; it lands `FRONT` later */
  t0: number;
  x: number;
  y: number;
  z: number;
  topX: number;
  topZ: number;
  /** 1 = a normal strike, > 1 = the finale */
  size: number;
  main: number;
  forks: number;
  crawl: number;
  started: boolean;
  landed: boolean;
  done: boolean;
}

function makeStrike(): Strike {
  return { t0: 0, x: 0, y: 0, z: 0, topX: 0, topZ: 0, size: 1, main: -1, forks: -1, crawl: -1, started: false, landed: false, done: true };
}

class StormBolt extends ElementalEffect {
  /** draw calls: filament halo + core, the ground layer (burn + ring) and, from tier 2, the ionised shell */
  cost = 3;
  private paths!: FilamentPaths;
  private ground!: GroundDecals;
  private shells: BurstSphere | null = null;
  private readonly look: FilamentLook = createFilamentLook();
  private readonly strikes: Strike[] = [];
  private readonly owner = new Int8Array(MAX_FILAMENT_ROLES);
  private count = 0;
  private seed = 0;
  private strands = 6;
  private forkStrands = 6;
  private crawlStrands = 5;
  private radius = 3;
  private widthK = 1;
  private intensity = 1;
  private end = 0;
  /** the first strike of an immediate cast flashes the screen */
  private screenFx = false;
  // the cast's palette (the Ctx is scratch: copied, never kept)
  private main = 0;
  private core = 0;
  private edge = 0;
  private body = 0;
  private dim = 0;

  build(): void {
    this.paths = new FilamentPaths({ samples: 72, capacity: 56, renderOrder: 45 });
    this.root.add(this.paths.group);
    this.ground = new GroundDecals({ additive: 2 * MAX_STRIKES });
    this.root.add(this.ground.group);
    if (this.host.tier >= 2) {
      this.shells = new BurstSphere(BurstMode.STORM, MAX_STRIKES, this.host.tier >= 3 ? 14 : 10);
      this.root.add(this.shells.mesh);
      this.cost = 4;
    }
    for (let i = 0; i < MAX_STRIKES; i++) this.strikes.push(makeStrike());
  }

  start(c: Ctx): boolean {
    const fx = this.host.fx;
    const rng = fx.rng;
    const tier = this.host.tier;
    this.strands = tier >= 3 ? 7 : tier === 2 ? 6 : 4;
    this.forkStrands = tier >= 3 ? 8 : tier === 2 ? 6 : 4;
    this.crawlStrands = tier >= 3 ? 7 : tier === 2 ? 5 : 4;

    const R = clamp(c.radius, 0.8, 8);
    this.radius = R;
    this.widthK = clamp(0.55 + 0.15 * R, 0.8, 1.7);
    this.intensity = clamp(c.intensity, 0.2, 3);
    this.seed = c.seed * 100;
    const look = this.look;
    look.width = TUNE.width * this.widthK;
    look.glow = TUNE.glow * this.intensity;
    look.glowWidth = TUNE.glowWidth;
    look.glowOpacity = TUNE.glowOpacity;
    look.jitter = TUNE.jitter;
    look.jitterScale = TUNE.jitterScale;
    look.octaves = TUNE.octaves;
    look.jitterFalloff = TUNE.falloff;
    look.coreSharp = TUNE.coreSharp;
    look.glowFalloff = TUNE.glowFalloff;
    look.crawl = 3.2;
    look.pinch = 0.08;
    look.restrike = 22;
    look.flicker = 0.3;
    look.flickerSpeed = 34;
    look.strandFlash = 0.3;
    paletteLook(look, c.pal);
    this.main = c.pal.main;
    this.core = c.pal.core;
    this.edge = c.pal.edge;
    this.body = mixHex(c.pal.main, c.pal.edge, 0.45);
    this.dim = mixHex(c.pal.edge, 0x0b0e14, 0.7);
    this.shells?.setColors(this.body, c.pal.main, c.pal.core);

    const cx = c.hasTarget ? c.tx : c.x;
    const cz = c.hasTarget ? c.tz : c.z;
    const cy = c.hasTarget ? c.ty : c.y;
    // the bolt leans toward the caster side. Straight down the camera's axis it would read as a pillar, so the lean always carries
    // a sideways part (its sign from the seed) that shows on screen
    let lx: number;
    let lz: number;
    if (c.hasTarget) {
      const ux = c.x - c.tx;
      const uz = c.z - c.tz;
      const ul = Math.hypot(ux, uz) || 1;
      lx = (ux / ul) * TUNE.lean;
      lz = (uz / ul) * TUNE.lean;
    } else {
      lx = -c.dx * TUNE.lean;
      lz = -c.dz * TUNE.lean * 0.5;
    }
    lx += (c.seed < 0.5 ? -1 : 1) * TUNE.lean * 0.9;

    const delay = Math.max(0, c.duration);
    const barrage = c.a > 0 ? Math.min(MAX_STRIKES, Math.round(c.a)) : 0;
    const span = c.b > 0 ? c.b : BARRAGE_SPAN;
    const n = barrage > 0 ? barrage : 1;
    const ring = n - 1;
    // the first strike lands exactly when the marker ends (`delay`); an immediate cast lands one front-time after it starts
    const launch = Math.max(0, delay - FRONT);
    for (let i = 0; i < n; i++) {
      const s = this.strikes[i] as Strike;
      s.t0 = launch + (n > 1 ? (span * i) / (n - 1) : 0);
      if (i === n - 1) {
        // the last strike (the only one of a single cast) lands dead centre
        s.x = cx;
        s.z = cz;
        s.y = cy;
        s.size = n > 1 ? 1.35 : 1;
      } else {
        const rr = R * (0.3 + 0.6 * Math.sqrt((i + 0.5) / ring)) + rng.s2(R * 0.06);
        const a = i * 2.39996323 + c.seed * TAU;
        s.x = cx + Math.sin(a) * rr;
        s.z = cz + Math.cos(a) * rr;
        s.y = fx.heightAt(s.x, s.z);
        s.size = 1;
      }
      s.topX = s.x + lx + rng.s2(0.9);
      s.topZ = s.z + lz + rng.s2(0.7);
      s.main = -1;
      s.forks = -1;
      s.crawl = -1;
      s.started = false;
      s.landed = false;
      s.done = false;
    }
    for (let i = n; i < MAX_STRIKES; i++) (this.strikes[i] as Strike).done = true;
    this.count = n;
    this.screenFx = delay < 0.06;
    this.owner.fill(-1);
    this.end = (this.strikes[n - 1] as Strike).t0 + STRIKE_LIFE + 0.05;
    this.paths.clear();
    this.ground.clear();
    this.shells?.clear();
    return true;
  }

  step(dt: number): boolean {
    const age = this.age;
    let alive = false;
    for (let i = 0; i < this.count; i++) {
      const s = this.strikes[i] as Strike;
      if (s.done) continue;
      const lt = age - s.t0;
      if (lt < 0) {
        alive = true;
        continue;
      }
      if (!s.started) {
        s.started = true;
        s.main = this.claim(i);
        s.crawl = this.claim(i);
        s.forks = this.claim(i);
      }
      if (!s.landed && lt >= FRONT) {
        s.landed = true;
        this.impact(s, i === 0);
      }
      if (lt >= STRIKE_LIFE) {
        s.done = true;
        this.free(s.main);
        this.free(s.forks);
        this.free(s.crawl);
        continue;
      }
      alive = true;
      this.drive(s, lt);
    }
    this.paths.sync(this.look, 1, this.seed);
    this.ground.update(dt);
    this.shells?.update(dt);
    return alive || age < this.end || this.ground.busy || this.shells?.busy === true;
  }

  override reset(): void {
    super.reset();
    this.paths.clear();
    this.ground.clear();
    this.shells?.clear();
  }

  dispose(): void {
    this.paths.dispose();
    this.ground.dispose();
    this.shells?.dispose();
  }

  private claim(strike: number): number {
    for (let r = 0; r < MAX_FILAMENT_ROLES; r++) {
      if (this.owner[r] === -1) {
        this.owner[r] = strike;
        return r;
      }
    }
    return -1;
  }

  private free(role: number): void {
    if (role < 0) return;
    this.paths.role(role).retire();
    this.owner[role] = -1;
  }

  /** The front reaches the ground: the burn, the ring, the shell of ionised air and the batched accents. */
  private impact(s: Strike, firstOfCast: boolean): void {
    const fx = this.host.fx;
    const rng = fx.rng;
    const R = this.radius * s.size;
    const I = this.intensity;
    const { x, y, z } = s;
    // the terrain under the strike: a plane fitted across the footprint so the flat decals lie on the ground, and a small lift for
    // what the plane cannot follow
    const d = Math.max(1, R * 1.2);
    const gx = (fx.heightAt(x + d, z) - fx.heightAt(x - d, z)) / (2 * d);
    const gz = (fx.heightAt(x, z + d) - fx.heightAt(x, z - d)) / (2 * d);
    const lift = 0.04 * R;
    // in a barrage the bolts between the first and the finale get a smaller ring and shell, or they pile up into bubbles
    const k = this.count > 1 && s.size === 1 ? 0.65 : 1;
    // branching electric burn and the thin ring that snaps outward across the floor
    this.ground.begin(DecalType.ARC, x, y + lift, z).radius(R * TUNE.arcR).life(0.95).col(this.body, this.main).width(TUNE.arcWidth).int(I * TUNE.arcInt).slope(gx, gz).emit();
    this.ground.begin(DecalType.SHOCKWAVE, x, y + lift, z).radius(R * 1.7 * k).life(0.6).col(this.main, this.core).width(0.04).int(I).slope(gx, gz).emit();
    this.shells?.begin(x, y + 0.05, z).radius(R * 0.18 * k, R * 0.85 * k).life(0.7).int(TUNE.shellInt * I * (0.7 + 0.3 * k)).opacity(0.9).fresnel(1.6).displace(TUNE.shellDisplace).squash(0.8).emit();

    // ground flash and the glow that fakes the light on the floor
    flash(fx, x, y + 0.5, z, R * 0.8, R * 0.3, 0.12, this.core, TUNE.flashInt * I);
    glow(fx, x, y + 0.8, z, R * 1.8, R * 1.0, 0.4, this.main, 0.6, TUNE.glowInt * I);
    fx.add.at(x, y + 0.7, z).size(R * 1.0, R * 2.6).life(0.22).col(this.core, 1, this.main, 0).int(TUNE.sunInt * I).spr(SPR.sunburst).rot(rng.f() * TAU).fade(0, FO.quad).emit();
    // sparks flung from the strike point, and shed along the bolt while it holds
    sparks(fx, x, y + 0.3, z, fx.n(14), 4, 10, 1.4, 0.2, 0.5, 0.09, this.core, this.main, 0, 0, 1, 2.4, -10);
    this.boltSparks(fx, s);
    dustRing(fx, x, y, z, fx.n(6), R * 1.1, 0.7, DUST, 0.3, 0.8 + R * 0.2);
    // the dark scorch that stays
    fx.dec.ground(x, z, 0.02).disk(R * 1.1).pat(PAT.scorch).life(5.5).col(this.dim, 1, 0x0b0e14, 0.85).int(0.7).fade(FO.late).seed(rng.f() * 9).emit();

    if (firstOfCast) {
      fx.shake(0.12 * s.size);
      // the flash quad is additive on the linear scene, so a pale colour lifts a dark ground into a grey wash: a faint pulse
      // tinted with the saturated edge colour
      if (this.screenFx) fx.flash(((this.edge >> 16) & 255) / 255, ((this.edge >> 8) & 255) / 255, (this.edge & 255) / 255, 0.015, 0.1);
    }
  }

  /** Sparks shed along the length of the bolt while it holds. */
  private boltSparks(fx: Fx, s: Strike): void {
    const rng = fx.rng;
    const ax = s.topX - s.x;
    const az = s.topZ - s.z;
    for (let i = 0, n = fx.n(16); i < n; i++) {
      const h = rng.r(0.5, 10);
      const k = h / SKY_H;
      const a = rng.f() * TAU;
      const r = 0.15 + 0.5 * k;
      fx.add.at(s.x + ax * k + Math.sin(a) * r, s.y + h, s.z + az * k + Math.cos(a) * r)
        .vel(Math.sin(a) * rng.r(1, 5), rng.r(-1, 3), Math.cos(a) * rng.r(1, 5)).delay(rng.r(0, HOLD)).life(rng.r(0.18, 0.4)).size(0.08, 0.025).stretch(0.05)
        .col(this.core, 1, this.main, 0).int(2.4).spr(SPR.streak).mode(M.streak).drag(2).grav(-9).fade(0, FO.cubic).emit();
    }
  }

  /** Writes the shader parameters of one strike's roles for the local time `lt` since its front left the sky. */
  private drive(s: Strike, lt: number): void {
    const fade = lt < FRONT + HOLD ? 1 : 1 - Easing.inCubic(saturate((lt - FRONT - HOLD) / FADE));
    // the strike pops: a white-hot gain that decays over the first tenth of a second after it lands
    const pop = 1 + TUNE.popGain * Math.exp(-Math.max(0, lt - FRONT) * 26);
    const swell = (0.35 + 0.65 * fade) * s.size;
    _top.set(s.topX, s.y + SKY_H, s.topZ);
    _gnd.set(s.x, s.y, s.z);

    if (s.main >= 0) {
      const role = this.paths.role(s.main);
      role.line(_top, _gnd, 0, TUNE.spreadTop, TUNE.spreadGround, TUNE.spreadCurve, TUNE.twist, 0.7, 1);
      role.style(1, swell, fade, 1).bundle(TUNE.spine, TUNE.outerDim, pop, 1).ends(1, 0, 1, 0);
      role.draw(saturate(lt / FRONT) * 1.12, 0.06, -1e4, TUNE.tipGlow);
      role.count = this.strands;
    }
    if (s.forks >= 0) {
      const role = this.paths.role(s.forks);
      role.crack(_top, _gnd, TUNE.forkAngle, TUNE.forkLen, 0.7, 0.5, 0.3, 0, 0.2);
      role.style(TUNE.forkKink, 0.55 * swell, 0.7 * fade * saturate((lt - FRONT * 0.4) / 0.05), 1).bundle(0.15, 1, pop * 0.8, TUNE.forkFreq).ends(1, 1, 1, 1);
      // no floor clamp: a fork that reaches the ground carries on into it (the terrain hides that part). Clamped, the part below the
      // floor is flattened onto it and, since the fork runs almost straight down, all that is left of it is its kink — a tight coil
      role.draw(2, 0.08, -1e4, 0);
      role.count = this.forkStrands;
    }
    if (s.crawl >= 0) {
      const role = this.paths.role(s.crawl);
      const grow = saturate((lt - FRONT) / 0.25);
      _up.set(s.x, s.y + 1, s.z);
      role.meander(_gnd, _up, 0.15, this.radius * 1.15 * s.size, 0.85, TUNE.crawlWander, 0.2, 0.07, 0.15);
      role.style(TUNE.crawlKink, 0.8 * swell, 0.9 * fade * Math.min(1, grow * 4), 0.3).bundle(1, 1, pop, TUNE.crawlFreq).ends(0, 1, 0, 1);
      role.draw(grow + 0.14, 0.14, s.y + 0.04, 1);
      role.count = this.crawlStrands;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------- storm.chain

/** seconds the discharge takes to hop the whole chain */
const CHAIN_TRAVEL = 0.1;
/** seconds a lit hop stays at full, then takes to decay */
const CHAIN_HOLD = 0.14;
const CHAIN_DECAY = 0.16;
const CHAIN_SPIKE_LIFE = 0.22;
const CHAIN_CRAWL_LIFE = 0.5;
const CHAIN_CRAWL_GROW = 0.2;
/** chance that a middle node stabs down to the floor */
const CHAIN_EARTH = 0.55;
const ROLE_SPIKE = 1;
const ROLE_CRAWL = 2;

/** One link of chain lightning: an `ArcNetwork` hopping from (x, z) to the target, with earthing spikes, a crawl and an end spark. */
class StormChain extends ElementalEffect {
  /** draw calls: filament halo + core */
  cost = 2;
  private paths!: FilamentPaths;
  private net!: ArcNetwork;
  private readonly look: FilamentLook = createFilamentLook();
  private readonly params = createArcNetworkParams();
  private scale = 1;
  private intensity = 1;
  private crawlStrands = 3;
  private crawlReach = 1;
  private endCursor = 0;
  private earthNode = -1;
  private earthAt = 0;
  private earthY = 0;
  private impactAt = -1;
  private crawlEnd = 0;
  private floorEnd = 0;
  private main = 0;
  private core = 0;
  private edge = 0;
  private dim = 0;

  build(): void {
    this.paths = new FilamentPaths({ samples: 96, capacity: 20, renderOrder: 45 });
    this.root.add(this.paths.group);
    this.net = new ArcNetwork(this.paths, 0);
    // bound once: a closure built per frame would allocate
    this.net.onNode = (index, position, count) => this.nodeLit(index, position, count);
  }

  start(c: Ctx): boolean {
    const fx = this.host.fx;
    const tier = this.host.tier;
    const s = clamp(c.scale, 0.6, 2.4);
    const sy = c.y + 0.9;
    let ex = c.tx;
    let ez = c.tz;
    let ey = c.ty + 0.9;
    if (!c.hasTarget) {
      ex = c.x + c.dx * 5 * s;
      ez = c.z + c.dz * 5 * s;
      ey = fx.heightAt(ex, ez) + 0.9;
    }
    const len = Math.hypot(ex - c.x, ey - sy, ez - c.z);
    // a degenerate link has no axis to hop along: the batched bolt handles it
    if (len < 0.3) return false;

    this.scale = s;
    this.intensity = clamp(c.intensity, 0.2, 3);
    this.crawlStrands = tier >= 3 ? 6 : tier === 2 ? 5 : 3;
    this.crawlReach = 1.1 * s;
    this.main = c.pal.main;
    this.core = c.pal.core;
    this.edge = c.pal.edge;
    this.dim = mixHex(c.pal.edge, 0x0b0e14, 0.7);

    const net = this.net;
    net.from.set(c.x, sy, c.z);
    net.to.set(ex, ey, ez);
    const nodes = clamp(Math.round(len / 1.05) + 1, 4, 9);
    const hop = CHAIN_TRAVEL / (nodes - 1);
    const scatter = clamp(0.13 * len, 0.3, 1.1);
    const p = this.params;
    p.nodes = nodes;
    p.filaments = tier >= 3 ? 4 : 3;
    p.scatter = scatter;
    p.lift = scatter * 0.45;
    p.alongJitter = 0.55;
    p.sag = 0.08 * scatter;
    p.bow = scatter * 0.2;
    p.floorY = -1e4;
    p.hopTime = hop;
    p.hold = CHAIN_HOLD / hop;
    p.overlap = CHAIN_DECAY / hop;
    p.tip = 0.35;
    p.kink = 1;
    p.chainWidth = 1;
    p.dim = 1;
    p.groundDamp = 0.5;
    this.endCursor = nodes - 1 + p.hold + p.overlap + 0.5;

    const look = this.look;
    look.width = 0.11 * clamp(s, 0.8, 1.6);
    look.glow = 3.2 * this.intensity;
    look.glowWidth = 6;
    look.glowOpacity = 0.5;
    look.jitter = 0.22;
    look.jitterScale = 1.6;
    look.octaves = 4;
    look.jitterFalloff = 0.55;
    look.crawl = 3;
    look.pinch = 0.12;
    look.restrike = 26;
    look.flicker = 0.28;
    look.flickerSpeed = 32;
    look.strandFlash = 0.5;
    look.coreSharp = 4.4;
    look.glowFalloff = 2.4;
    paletteLook(look, c.pal);

    this.paths.clear();
    this.paths.role(0).bundle(1, 1, 1, 1);
    this.paths.role(ROLE_SPIKE).bundle(1, 1, 1, 1);
    this.earthNode = -1;
    this.impactAt = -1;
    this.crawlEnd = 0;
    this.floorEnd = fx.heightAt(ex, ez);
    net.reset(c.seed * 100 + 1);
    return true;
  }

  step(dt: number): boolean {
    this.net.update(dt, this.params);
    this.syncSpike();
    this.syncCrawl();
    this.paths.sync(this.look, 1, this.net.seed);
    return this.net.cursor < this.endCursor || this.age < this.crawlEnd;
  }

  override reset(): void {
    super.reset();
    this.net.clear();
    this.paths.clear();
  }

  dispose(): void {
    this.paths.dispose();
  }

  /** A node lights: a flash and a few sparks; some middle nodes earth to the floor, the last one grounds the whole discharge. */
  private nodeLit(index: number, pos: Vector3, count: number): void {
    const fx = this.host.fx;
    const rng = fx.rng;
    const s = this.scale;
    if (index === count - 1) {
      this.grounded(fx, pos);
      return;
    }
    flash(fx, pos.x, pos.y, pos.z, 0.9 * s, 0.3 * s, 0.1, this.core, index === 0 ? 2.8 : 2.4);
    sparks(fx, pos.x, pos.y, pos.z, fx.n(index === 0 ? 3 : 2), 2, 6, 0.9, 0.12, 0.25, 0.06 * s, this.core, this.main, 0, 0, 1, 2, -9);
    if (index > 0 && rng.f() < CHAIN_EARTH) {
      this.earthNode = index;
      this.earthAt = this.age;
      this.earthY = fx.heightAt(pos.x, pos.z) + 0.05;
    }
  }

  /** The last node: end spark, a few arcs, a tiny scorch, and the floor crawl opens. */
  private grounded(fx: Fx, pos: Vector3): void {
    const rng = fx.rng;
    const s = this.scale;
    const { x, y, z } = pos;
    flash(fx, x, y, z, 1.5 * s, 0.4 * s, 0.16, this.core, 3.4);
    glow(fx, x, y, z, 2.2 * s, 0.8 * s, 0.24, this.main, 0.7, 1.4);
    haloRing(fx, x, y, z, 0.3 * s, 1.9 * s, 0.22, this.main, 0.7, 1.4, 0.02);
    sparks(fx, x, y, z, fx.n(7), 3, 8, 1.2, 0.16, 0.34, 0.09 * s, this.core, this.edge, 0, 0, 1, 2.4, -9, 0.02);
    for (let i = 0, n = fx.n(3); i < n; i++) {
      fx.add.at(x + rng.s2(0.3 * s), y + rng.s2(0.3 * s), z + rng.s2(0.3 * s)).size(0.9 * s, 1.3 * s).life(rng.r(0.08, 0.14)).delay(rng.r(0, 0.08))
        .col(this.core, 1, this.main, 0).int(2.4).spr(SPR.arc0 + rng.i(3)).rot(rng.f() * TAU).twinkle().fade(0, FO.cube).emit();
    }
    scorch(fx, x, z, 0.5 * s, 2.4, 0x0b0e14, this.dim, PAT.scorch);
    this.earthNode = this.net.nodeCount - 1;
    this.earthAt = this.age;
    this.earthY = this.floorEnd + 0.05;
    this.impactAt = this.age;
    this.crawlEnd = this.age + CHAIN_CRAWL_LIFE;
  }

  /** The earthing spike: a short LINE role from the node that just lit down to the floor under it. */
  private syncSpike(): void {
    const role = this.paths.role(ROLE_SPIKE);
    if (this.earthNode < 0) {
      role.retire();
      return;
    }
    const k = 1 - saturate((this.age - this.earthAt) / CHAIN_SPIKE_LIFE);
    if (k <= 0) {
      role.retire();
      return;
    }
    // nodePoint re-derives the node with the shader's own arithmetic, so the spike leaves the chain exactly where the chain is
    this.net.nodePoint(Math.min(this.earthNode, this.net.nodeCount - 1), _from);
    _to.set(_from.x, Math.min(this.earthY, _from.y - 0.05), _from.z);
    role.count = 2;
    role.line(_from, _to, 0.05, 0.03, 0.35, 1.4, 0.3, 1.2, 0.75);
    role.style(0.7, 0.8, 0.8 * k, 0.35).ends(0, 1, 0, 1).draw(2, 0.12, this.earthY, 1.6);
  }

  /** The crawl at the last node: a MEANDER role running out across the floor. */
  private syncCrawl(): void {
    const role = this.paths.role(ROLE_CRAWL);
    if (this.impactAt < 0) {
      role.retire();
      return;
    }
    const since = this.age - this.impactAt;
    const k = 1 - saturate(since / CHAIN_CRAWL_LIFE);
    if (k <= 0) {
      role.retire();
      return;
    }
    _from.set(this.net.to.x, this.floorEnd + 0.03, this.net.to.z);
    _to.set(_from.x, _from.y + 1, _from.z);
    const grow = saturate(since / CHAIN_CRAWL_GROW);
    role.count = this.crawlStrands;
    role.meander(_from, _to, 0.15, this.crawlReach, 0.85, 1.2, 0.2, 0.06, 0.15);
    role.style(TUNE.crawlKink, 0.9, 0.9 * k, 0.3).bundle(1, 1, 1, TUNE.crawlFreq).ends(0, 1, 0, 1).draw(grow + 0.14, 0.14, this.floorEnd + 0.03, 0.9);
  }
}

export const EFFECTS: EffectDef[] = [
  { kind: 'storm.bolt', create: () => new StormBolt(), pool: 3, minTier: 1 },
  { kind: 'storm.chain', create: () => new StormChain(), pool: 4, minTier: 1 },
];

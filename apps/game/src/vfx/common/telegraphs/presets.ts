// `telegraph.*` presets (common VFX, owner: the telegraphs builder): the SPRITE LAYER of a ground warning. The decal itself
// (render/fx/telegraphs.ts: soot underlay, broken glowing arcs, sweep heat, chevrons, rune band) is drawn by the render
// system; the Telegraphs system tells the route (route.ts, through render/fx/fallCue.ts `telegraphHook`) when a boss / metin /
// big warning starts and the route fires one of these. They add what a decal cannot: height and billboards.
//   - embers born exactly where the sweep front passes (delay = D x sweep coordinate), cinders cooling as they rise
//   - a low dust haze along the rim, twinkling glints on bosses and metins
//   - vertical light shafts (shaman meteo_1_drop: thin rising shafts) for the ones that mean "something falls here"
//   - telegraph.meteor: a rain of small rocks + hot streaks falling onto the circle, each landing inside it (never one big body:
//     the sim's `sky.meteor` still plays its own fall after the resolve)
//   - the resolve payoff at D: spark ring along the edge, and for impacts a dust ring + a soot stain that lingers 1.9 s (late fade)
// Ids are the contract (the old neon reticles are gone: the ids stay, the look is new). Spawn opts: scale = radius (cone length,
// lane length, ring outer radius), `a` = cone full angle / lane width / ring inner radius, `b` > 0 = the resolve lands an impact,
// rot / dir = facing, duration = the warning time, color / element = the tint.
import type { Ctx, Fx } from '../../emit';
import { mixHex } from '../../util';
import { KIT_ART } from '../kitArt';
import { FO, M, SPR, TAU, dustRing, glints, lightShaft, smoke, stain } from '../../presets/kit';
import type { PresetDef } from '../../presets/types';

const K_DISK = 0;
const K_CONE = 1;
const K_LANE = 2;
const K_RING = 3;

let gk = K_DISK;
let gx = 0;
let gz = 0;
let gyaw = 0;
/** outer radius / cone & lane length */
let gr = 1;
/** inner radius (annulus) */
let gr0 = 0;
/** cone full angle / lane width */
let ga = 0;
/** sampled point + outward normal, written by `edge()` / `inside()` */
let ex = 0;
let ez = 0;
let enx = 0;
let enz = 0;
/** sweep coordinate (0..1) at which the decal's fill front reaches the point sampled by `inside()` */
let pf = 0;

/** dusty ground-brown the haze and the dust ring are tinted with (mixed a little toward the warning hue) */
const DUST = 0x8d7d6a;
/** soot of the closing stain */
const SOOT = 0x14100e;
/** the rock tint of the falling debris */
const ROCK = 0xa8957f;

/** length of the warning outline in metres (spark / haze budget) */
function perimeter(): number {
  if (gk === K_DISK) return TAU * gr;
  if (gk === K_CONE) return ga * gr + 2 * gr;
  if (gk === K_LANE) return 2 * gr + 2 * ga;
  return TAU * (gr + gr0);
}

/** the footprint area (m2) */
function area(): number {
  if (gk === K_CONE) return 0.5 * ga * gr * gr;
  if (gk === K_LANE) return gr * ga;
  if (gk === K_RING) return Math.PI * (gr * gr - gr0 * gr0);
  return Math.PI * gr * gr;
}

/** random point on the outline -> ex,ez (+ outward normal enx,enz) */
function edge(fx: Fx): void {
  const rng = fx.rng;
  if (gk === K_DISK || gk === K_RING) {
    const a = rng.f() * TAU;
    const inner = gk === K_RING && rng.f() < gr0 / (gr0 + gr);
    const r = inner ? gr0 : gr;
    enx = Math.sin(a) * (inner ? -1 : 1);
    enz = Math.cos(a) * (inner ? -1 : 1);
    ex = gx + Math.sin(a) * r;
    ez = gz + Math.cos(a) * r;
  } else if (gk === K_CONE) {
    const u = rng.f();
    if (u < 0.5) {
      const a = gyaw + (rng.f() - 0.5) * ga;
      enx = Math.sin(a);
      enz = Math.cos(a);
      ex = gx + enx * gr;
      ez = gz + enz * gr;
    } else {
      const s = u < 0.75 ? 1 : -1;
      const a = gyaw + s * ga * 0.5;
      const along = gr * (0.15 + 0.85 * rng.f());
      enx = Math.cos(a) * s;
      enz = -Math.sin(a) * s;
      ex = gx + Math.sin(a) * along;
      ez = gz + Math.cos(a) * along;
    }
  } else {
    const s = rng.f() < 0.5 ? 1 : -1;
    const along = gr * rng.f();
    enx = Math.cos(gyaw) * s;
    enz = -Math.sin(gyaw) * s;
    ex = gx + Math.sin(gyaw) * along + enx * ga * 0.5;
    ez = gz + Math.cos(gyaw) * along + enz * ga * 0.5;
  }
}

/** random point inside the footprint -> ex,ez, pf (the decal's sweep coordinate there), (enx,enz) = local outward direction (lane: forward) */
function inside(fx: Fx): void {
  const rng = fx.rng;
  const u = rng.f();
  if (gk === K_LANE) {
    const along = gr * u;
    const side = (rng.f() - 0.5) * ga * 0.8;
    enx = Math.sin(gyaw);
    enz = Math.cos(gyaw);
    ex = gx + enx * along + enz * side;
    ez = gz + enz * along - enx * side;
    pf = u;
  } else {
    const r = gk === K_RING ? Math.sqrt(gr0 * gr0 + u * (gr * gr - gr0 * gr0)) : gr * Math.sqrt(u);
    const a = gk === K_CONE ? gyaw + (rng.f() - 0.5) * ga * 0.92 : rng.f() * TAU;
    enx = Math.sin(a);
    enz = Math.cos(a);
    ex = gx + enx * r;
    ez = gz + enz * r;
    pf = gk === K_RING ? (r - gr0) / (gr - gr0) : r / gr;
  }
}

/** embers lifting off the filled part, born when the decal's sweep front reaches them; cooling hot -> main while they rise */
function frontEmbers(fx: Fx, c: Ctx, D: number, k: number): void {
  const rng = fx.rng;
  const p = c.pal;
  const n = fx.n(Math.min(area() * 0.34 * k, 24));
  const hot = mixHex(p.core, p.main, 0.45);
  for (let i = 0; i < n; i++) {
    inside(fx);
    const t = Math.min(D * pf + rng.r(0, 0.05), D * 0.97);
    const y = fx.heightAt(ex, ez) + 0.1;
    fx.add.at(ex, y, ez).vel(rng.s2(0.3), rng.r(0.7, 1.7), rng.s2(0.3)).life(rng.r(0.7, 1.2)).delay(t).size(rng.r(0.34, 0.55), 0.1)
      .col(hot, 1, p.edge, 0.4).int(rng.r(1.8, 2.6)).spr(rng.f() < 0.5 ? SPR.ember0 : SPR.ember1).rot(rng.f() * TAU, rng.s2(3)).drag(0.5)
      .wob(0.12).twinkle().fade(1, FO.quad).emit();
  }
}

/** a low dust / ash haze drifting along the rim over the warning time */
function rimHaze(fx: Fx, c: Ctx, D: number, k: number): void {
  const rng = fx.rng;
  const p = c.pal;
  const n = fx.n(Math.min(perimeter() * 0.2 * k, 9));
  const hex = mixHex(DUST, p.main, 0.14);
  for (let i = 0; i < n; i++) {
    edge(fx);
    smoke(fx, ex, fx.heightAt(ex, ez) + 0.15, ez, 1, 0.3, 0.35, 1.1, 1.7, 1.1, 2.6, hex, 0.26, rng.r(0.1 * D, 0.92 * D));
  }
}

/** light shafts rising from inside the footprint, one per `every` seconds across the warning */
function shafts(fx: Fx, c: Ctx, D: number, n: number, width: number, height: number, from: number): void {
  const rng = fx.rng;
  const p = c.pal;
  for (let i = 0; i < n; i++) {
    inside(fx);
    const t = from * D + (i / Math.max(1, n)) * (0.95 - from) * D + rng.r(0, 0.06);
    lightShaft(fx, ex, fx.heightAt(ex, ez), ez, width * rng.r(0.9, 1.4), height * rng.r(1.0, 1.5), Math.min(D * 0.55, 1.0), mixHex(p.main, p.core, 0.2), 0.95, 2.8 * c.intensity, t);
  }
}

/** the closing snap, D seconds after spawn: ring of spark streaks thrown off the outline, then (impacts) dust + a soot scar */
function resolve(fx: Fx, c: Ctx, D: number, impact: boolean): void {
  const rng = fx.rng;
  const p = c.pal;
  const n = fx.n(Math.min(perimeter() * 0.55, 20));
  for (let i = 0; i < n; i++) {
    edge(fx);
    const v = rng.r(2.2, 4.4);
    fx.add.at(ex, fx.heightAt(ex, ez) + 0.12, ez).vel(enx * v * 0.6 + rng.s2(0.6), rng.r(1.4, 3.0), enz * v * 0.6 + rng.s2(0.6))
      .life(rng.r(0.22, 0.42)).delay(D).size(0.08, 0.02).stretch(0.05).col(mixHex(p.core, p.main, 0.4), 1, p.main, 0).int(2.2).spr(SPR.streak).mode(M.streak)
      .grav(-8).drag(1.5).fade(0, FO.cubic).emit();
  }
  if (!impact || gk === K_LANE) return;
  const y = fx.heightAt(gx, gz);
  const R = gr;
  dustRing(fx, gx, y, gz, fx.n(8), R * 0.95, 0.75, mixHex(DUST, p.main, 0.12), 0.34, 0.8 + R * 0.12, D);
  stain(fx, gx, gz, R * 0.6, 1.9, 0x2a211c, mixHex(0x2a211c, p.edge, 0.4), D);
}

/** the common stack of an area warning */
function build(fx: Fx, c: Ctx, o: { glintCount: number; shaftN: number; impact: boolean; embers: number }): void {
  const D = c.duration;
  frontEmbers(fx, c, D, o.embers);
  rimHaze(fx, c, D, 1);
  if (o.glintCount > 0) {
    const p = c.pal;
    glints(fx, gx, fx.heightAt(gx, gz) + 0.05, gz, o.glintCount, Math.max(gr * 0.8, 1), 0.7, 0.6, 1.1, 0.8, mixHex(p.core, p.main, 0.3), p.main, 0.1 * D, 2.4);
  }
  if (o.shaftN > 0) shafts(fx, c, D, o.shaftN, 1.3 + gr * 0.12, 4.5 + gr * 0.4, 0.2);
  resolve(fx, c, D, o.impact);
}

function circle(): PresetDef {
  return {
    id: 'telegraph.circle',
    cat: 'telegraph',
    desc: 'circular warning (slam / metin impact): embers born at the fill front, rim haze, glints + light shafts on bosses and metins, resolve sparks (+ dust ring and soot scar when b>0). duration = warning time.',
    size: 'radius',
    base: 3,
    palette: 'warn',
    dur: 1.2,
    loop: false,
    demo: {},
    fire(fx, c) {
      gk = K_DISK;
      gx = c.x;
      gz = c.z;
      gr = c.radius;
      const big = gr >= 3.2;
      build(fx, c, { glintCount: big ? fx.n(Math.min(gr * 1.4, 9)) : 0, shaftN: big ? (gr > 6 ? 5 : 3) : 0, impact: c.b > 0, embers: big ? 1.1 : 0.7 });
    },
  };
}

function cone(): PresetDef {
  return {
    id: 'telegraph.cone',
    cat: 'telegraph',
    desc: 'sector warning (breath / roar): embers streaming out of the apex as the fill front passes, rim haze, resolve sparks. `a` full angle (rad), scale = length.',
    size: 'radius',
    base: 6,
    palette: 'warn',
    dur: 1.2,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      gk = K_CONE;
      gx = c.x;
      gz = c.z;
      gyaw = c.rot;
      gr = c.radius;
      ga = c.a > 0.05 ? Math.min(c.a, 6.2) : 0.9;
      build(fx, c, { glintCount: 0, shaftN: 0, impact: false, embers: 1 });
    },
  };
}

function lane(): PresetDef {
  return {
    id: 'telegraph.lane',
    cat: 'telegraph',
    desc: 'rectangle warning (charge / beam lane): embers racing down the lane with the fill front, rim haze, resolve sparks. `a` width (m), scale = length, starts at x,z along dir.',
    size: 'radius',
    base: 8,
    palette: 'warn',
    dur: 1.2,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      gk = K_LANE;
      gx = c.x;
      gz = c.z;
      gyaw = c.rot;
      gr = c.radius;
      ga = c.a > 0.05 ? c.a : 2.2;
      build(fx, c, { glintCount: 0, shaftN: 0, impact: false, embers: 1 });
    },
  };
}

function ring(): PresetDef {
  return {
    id: 'telegraph.ring',
    cat: 'telegraph',
    desc: 'annulus warning (nova / ring wave): the safe inner disk stays clear, embers + rim haze on the band, glints and shafts on the outer edge, impact payoff when b>0. `a` inner safe radius, scale = outer radius.',
    size: 'radius',
    base: 6,
    palette: 'warn',
    dur: 1.2,
    loop: false,
    demo: {},
    fire(fx, c) {
      gk = K_RING;
      gx = c.x;
      gz = c.z;
      gr = c.radius;
      gr0 = c.a > 0.05 && c.a < c.radius * 0.95 ? c.a : c.radius * 0.55;
      build(fx, c, { glintCount: fx.n(Math.min(gr * 1.2, 9)), shaftN: 4, impact: c.b > 0, embers: 1 });
    },
  };
}

/**
 * boss meteor warning (shaman meteo_1_drop / redd_meteo): the decal shows a growing shadow and three contracting thin rings; this
 * adds the sky: thin vertical light streaks, and small rocks with a hot head falling onto the circle, each landing inside it at its
 * own time over the second half of the warning.
 */
function meteor(): PresetDef {
  return {
    id: 'telegraph.meteor',
    cat: 'telegraph',
    desc: 'meteor mark: light streaks and a rain of small hot rocks falling onto the circle during the second half of the warning (landing inside it), embers at the fill front, closing dust + soot scar. duration = warning time.',
    size: 'radius',
    base: 2.4,
    palette: 'warn',
    dur: 1.2,
    loop: false,
    demo: {},
    fire(fx, c) {
      const rng = fx.rng;
      const p = c.pal;
      const D = c.duration;
      const R = c.radius;
      gk = K_DISK;
      gx = c.x;
      gz = c.z;
      gr = R;
      const gy = fx.heightAt(gx, gz);
      frontEmbers(fx, c, D, 0.9);
      
      shafts(fx, c, D, 6, 0.9 + R * 0.1, 4.6 + R * 0.4, 0.3);
      // the rock rain: n rocks, landing times spread over [0.45 D, 0.97 D], each falling 0.55-0.85 s under g = 14
      const n = fx.n(Math.min(6 + R * 2.4, 16));
      const art = fx.hasArt(KIT_ART.rockFacet);
      for (let i = 0; i < n; i++) {
        const a = rng.f() * TAU;
        const r = Math.sqrt(rng.f()) * R * 0.92;
        const rx = gx + Math.sin(a) * r;
        const rz = gz + Math.cos(a) * r;
        const tau = rng.r(0.55, 0.85);
        const tl = Math.min(D * (0.45 + 0.52 * ((i + rng.f()) / n)), D * 0.98);
        const t0 = Math.max(0, tl - tau);
        const fall = tau;
        const vy = -2;
        const y0 = gy + 0.5 * 14 * fall * fall - vy * fall;
        const sx = rx + rng.s2(0.7);
        const sz = rz - rng.r(0.4, 1.6);
        const vx = (rx - sx) / fall;
        const vz = (rz - sz) / fall;
        const gy2 = fx.heightAt(rx, rz);
        if (art) {
          fx.alp.at(sx, y0, sz).vel(vx, vy, vz).grav(-14).life(fall).delay(t0).floor(gy2).size(rng.r(0.3, 0.55)).col(ROCK, 1, ROCK, 1).art(KIT_ART.rockFacet)
            .rot(rng.f() * TAU, rng.s2(7)).fade(0, FO.snap).emit();
        }
        // hot head + a streak along the path (always drawn: it carries the read when the rock art is not packed)
        fx.add.at(sx, y0, sz).vel(vx, vy, vz).grav(-14).life(fall).delay(t0).size(0.7, 0.4).col(mixHex(p.core, p.main, 0.4), 0.85, p.main, 0).int(1.7 * c.intensity)
          .spr(SPR.glow).fade(1, FO.quad).emit();
        fx.add.at(sx, y0, sz).vel(vx, vy, vz).grav(-14).life(fall).delay(t0).size(0.2, 0.55).stretch(0.3).col(p.core, 0.95, p.main, 0).int(1.8 * c.intensity)
          .spr(SPR.streak).mode(M.streak).fade(1, FO.quad).emit();
        // every landing kicks a puff of ember sparks
        fx.add.at(rx, gy2 + 0.12, rz).vel(rng.s2(1.2), rng.r(1.4, 2.6), rng.s2(1.2)).life(rng.r(0.3, 0.5)).delay(tl).size(0.1, 0.03).stretch(0.05)
          .col(p.core, 1, p.main, 0).int(2).spr(SPR.streak).mode(M.streak).grav(-9).drag(1.4).fade(0, FO.cubic).emit();
      }
      rimHaze(fx, c, D, 0.7);
      resolve(fx, c, D, c.b > 0);
      glints(fx, gx, gy + 0.05, gz, fx.n(Math.min(R * 1.5, 6)), R * 0.8, 0.5, 0.5, 0.9, 0.45, mixHex(p.core, p.main, 0.3), p.main, 0.5 * D, 1.6);
    },
  };
}

export const presets: PresetDef[] = [circle(), cone(), lane(), ring(), meteor()];

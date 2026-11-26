// Ground zones and cones: zone.*, cone.* (owner: VfxZones).
import type { Ctx, Fx } from '../emit';
import type { Palette } from '../palette';
import type { Inst } from '../system';
import { FB, FO, M, PAT, SC, SPR, TAU, chunks, dustRing, embers, flash, glow, haloRing, runeMotes, shockRing, smoke, sparks, wisps } from './kit';
import { castEl } from './el';
import type { PresetDef } from './types';

/** random point in the annulus [r0·R, r1·R] around the zone centre (writes PX/PZ) */
let PX = 0;
let PZ = 0;
function spot(fx: Fx, c: Ctx, r0: number, r1: number): void {
  const a = fx.rng.f() * TAU;
  const r = c.radius * Math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * fx.rng.f());
  PX = c.x + Math.sin(a) * r;
  PZ = c.z + Math.cos(a) * r;
}

/** terrain height under (x,z) */
function gy(fx: Fx, c: Ctx, x: number, z: number): number {
  return fx.hasHeight ? fx.heightAt(x, z) : c.y;
}

/** particle size multiplier: follows the zone radius but stays readable for tiny/huge zones */
function sk(c: Ctx): number {
  return Math.min(Math.max(c.scale, 0.6), 2.2);
}

/** emission-rate multiplier ~ area, damped */
function ak(c: Ctx): number {
  return Math.min(Math.max(c.scale * c.scale, 0.45), 3);
}

/** the zone's pinned shapes fade out when it ends */
function endZone(fx: Fx, c: Inst): void {
  c.host?.killShapes(c);
}

/** upright flame tongue rooted at (x,y,z): red-orange body that swells and dies, slimmer flickering yellow core */
function tongue(fx: Fx, p: Palette, x: number, y: number, z: number, sz: number, life: number, rise: number, int: number, delay: number): void {
  const rng = fx.rng;
  const vx = rng.s2(0.25), vz = rng.s2(0.25), vy = rise * rng.r(0.7, 1.3);
  const cell = SPR.flame0 + rng.i(4);
  const st = rng.r(1.9, 2.5);
  fx.add.at(x, y, z).vel(vx, vy, vz).life(life).delay(delay).size(sz * 0.2, sz).stretch(st)
    .col(p.main, 0.9, p.edge, 0).int(int).spr(cell).mode(M.upright).wob(0.1).fade(0, FO.quad, SC.bell).emit();
  fx.add.at(x, y, z).vel(vx, vy * 1.1, vz).life(life * 0.8).delay(delay + life * 0.06).size(sz * 0.12, sz * 0.58).stretch(st * 0.85)
    .col(p.extra, 1, p.main, 0).int(int * 1.8).spr(cell).mode(M.upright).wob(0.1).twinkle().fade(0, FO.quad, SC.bell).emit();
}

/** heat-ramped fire flipbook puff rising from (x,y,z) */
function puff(fx: Fx, p: Palette, x: number, y: number, z: number, sz: number, life: number, rise: number, int: number, delay: number): void {
  const rng = fx.rng;
  fx.add.at(x, y, z).vel(rng.s2(0.3), rise, rng.s2(0.3)).life(life).delay(delay).size(sz * 0.6, sz).col(p.extra, 1, p.edge, 1).int(int)
    .spr(FB.fire).frames(16).ramp().rot(rng.f() * TAU, rng.s2(0.8)).drag(0.8).fade(0, FO.late).emit();
}

/** big soft smoke puff (alpha), lit `light` → shaded `dark` over its life */
function cloudPuff(fx: Fx, light: number, dark: number, x: number, y: number, z: number, sz: number, life: number, a: number, vx: number, vz: number, rise: number, delay: number): void {
  const rng = fx.rng;
  fx.alp.at(x, y, z).vel(vx, rise, vz).life(life).delay(delay).size(sz * 0.7, sz * 1.15).col(light, a, dark, 0).spr(SPR.smoke0 + rng.i(4))
    .rot(rng.f() * TAU, rng.s2(0.25)).drag(0.45).fade(2, FO.quad).emit();
}

/** tiny hot dots / spores drifting up */
function mote(fx: Fx, x: number, y: number, z: number, sz: number, life: number, rise: number, hex0: number, hex1: number, int: number, wob: number, delay: number): void {
  const rng = fx.rng;
  fx.add.at(x, y, z).vel(rng.s2(0.2), rise * rng.r(0.7, 1.3), rng.s2(0.2)).life(life).delay(delay).size(sz, sz * 0.4).col(hex0, 1, hex1, 0).int(int)
    .spr(SPR.glow).wob(wob).twinkle().fade(2, FO.quad).emit();
}

/** twinkling cross-glint rising (snow, holy, magic) */
function glint(fx: Fx, x: number, y: number, z: number, sz: number, life: number, rise: number, hex0: number, hex1: number, int: number, delay: number): void {
  const rng = fx.rng;
  fx.add.at(x, y, z).vel(rng.s2(0.2), rise * rng.r(0.7, 1.3), rng.s2(0.2)).life(life).delay(delay).size(sz, sz * 0.3).col(hex0, 1, hex1, 0).int(int)
    .spr(rng.f() < 0.5 ? SPR.glint : SPR.sparkle).rot(rng.s2(0.4), rng.s2(0.8)).twinkle().drag(0.8).fade(1, FO.quad, SC.out).emit();
}

/** bubble ripple lying on the ground, expanding then popping */
function bubble(fx: Fx, x: number, y: number, z: number, sz: number, life: number, hex0: number, hex1: number, int: number, delay: number): void {
  fx.add.at(x, y + 0.05, z).size(sz * 0.25, sz).life(life).delay(delay).col(hex0, 0.95, hex1, 0).int(int).spr(SPR.ringThin).mode(M.ground).fade(0, FO.quad, SC.out).emit();
}

/** element-flavoured accent particle (rune circles, clouds): one per call */
function accent(fx: Fx, c: Ctx, x: number, y: number, z: number, s: number, I: number): void {
  const rng = fx.rng;
  const p = c.pal;
  switch (c.element) {
    case 1:
      embers(fx, x, y, z, 1, 0.1, 1.7 * s, 0.7, 1.4, 0.15 * s, p.core, p.edge, 0, 2.2 * I);
      break;
    case 2:
      glint(fx, x, y, z, 0.38 * s, rng.r(0.8, 1.4), 0.5, p.core, p.main, 2.2 * I, 0);
      break;
    case 3:
      fx.add.at(x, y + 0.1, z).size(0.9 * s, 1.3 * s).life(rng.r(0.08, 0.14)).col(p.core, 1, p.main, 0).int(2.6 * I).spr(SPR.arc0 + rng.i(3)).mode(M.ground)
        .rot(rng.f() * TAU).twinkle().fade(0, FO.cube).emit();
      break;
    case 4:
      wisps(fx, x, y, z, 1, 0.1, 0.9 * s, 0.9, 1.5, 0.55 * s, p.main, p.edge, 0, 1.5 * I);
      break;
    case 5:
      bubble(fx, x, y, z, 0.5 * s, 0.8, p.core, p.main, 1.3 * I, 0);
      mote(fx, x, y + 0.2, z, 0.14 * s, rng.r(1.2, 2.0), 0.5, p.extra, p.core, 1.8 * I, 0.25, 0);
      break;
    case 6:
      glint(fx, x, y, z, 0.42 * s, rng.r(0.9, 1.5), 0.9, p.core, p.edge, 2.4 * I, 0);
      break;
    case 7:
      fx.add.at(x, y + 0.3, z).vel(rng.s2(4), rng.r(0.2, 0.9), rng.s2(4)).size(0.1 * s, 0.04 * s).life(0.3).stretch(0.07).col(p.core, 0.9, p.main, 0).int(1.8 * I)
        .spr(SPR.streak).mode(M.streak).drag(2).fade(0, FO.cubic).emit();
      break;
    default:
      glint(fx, x, y, z, 0.34 * s, rng.r(0.8, 1.4), 0.7, p.core, p.main, 2.0 * I, 0);
  }
}

// ----------------------------------------------------------------------------------------------------------- fire

function fireZone(): PresetDef {
  return {
    id: 'zone.fire',
    cat: 'area',
    desc: 'groundZone: burning ground — charred decal with lava veins, ring lip, flame fringe, flipbook flames, tongues, embers, smoke, heat haze.',
    size: 'radius',
    base: 3,
    palette: 'fire',
    dur: 4,
    loop: true,
    demo: { loopFor: 4 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const rng = fx.rng;
      const R = c.radius;
      const s = sk(c);
      const I = c.intensity;
      const life = c.duration + 1;
      const hot = c.duration * 3 + 2;
      const sd = c.seed * 10;
      inst.ownDecal(fx.dec.ground(c.x, c.z, 0.03).disk(R * 1.1).pat(PAT.scorch).life(hot).col(0xff4a10, 1, 0x100804, 0.9).int(0.55 * I).fade(FO.none).seed(sd).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.05).disk(R).pat(PAT.cracks).life(hot).col(p.main, 1, p.edge, 1).int(0.75 * I).fade(FO.none).seed(sd + 2).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.07).ring(R * 0.92, R * 1.02).pat(PAT.ring).expand(1).life(life).col(p.extra, 1, p.main, 1).int(1.3 * I).fade(FO.none).seed(sd + 3).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0).cyl(R * 0.98, R * 0.93, 0.6 * s).pat(PAT.flame).life(life).col(p.main, 1, p.edge, 1).int(0.75 * I).fade(FO.none).seed(sd).pinned().emit());
      shockRing(fx, c.x, c.z, R * 1.1, 0.5, p, 0.2, 1.9);
      flash(fx, c.x, c.y + 0.4, c.z, R * 0.8, R * 0.25, 0.22, p.core, 2.4);
      for (let i = 0, n = fx.n(8); i < n; i++) {
        const a = (i / n) * TAU + rng.s2(0.3);
        const r = R * rng.r(0.5, 0.95);
        puff(fx, p, c.x + Math.sin(a) * r, c.y + 0.1, c.z + Math.cos(a) * r, 1.2 * s, 0.6, 1.3, 1.2 * I, i * 0.012);
      }
      sparks(fx, c.x, c.y + 0.3, c.z, fx.n(14), 3, 7, 4, 0.4, 0.8, 0.1, p.core, p.main);
    },
    tick(fx, c, dt) {
      const p = c.pal;
      const rng = fx.rng;
      const s = sk(c);
      const A = ak(c);
      const I = c.intensity;
      // flame clusters around the rim: three tongues of different height per cluster
      c.acc0 += dt * 13 * fx.density * A;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        spot(fx, c, 0.8, 1.0);
        const cx = PX, cz = PZ;
        const life = rng.r(0.6, 0.95);
        for (let k = 0; k < 3; k++) {
          const x = cx + rng.s2(0.3 * s), z = cz + rng.s2(0.3 * s);
          tongue(fx, p, x, gy(fx, c, x, z), z, rng.r(0.7, 1.4) * s, life * rng.r(0.7, 1.0), rng.r(0.3, 0.8), 1.0 * I, rng.f() * dt + k * 0.05);
        }
      }
      c.acc1 += dt * 13 * fx.density * A;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        spot(fx, c, 0, 0.8);
        if (rng.f() < 0.65) tongue(fx, p, PX, gy(fx, c, PX, PZ), PZ, rng.r(0.5, 1.0) * s, rng.r(0.45, 0.75), rng.r(0.3, 0.7), 0.8 * I, rng.f() * dt);
        else puff(fx, p, PX, gy(fx, c, PX, PZ) + 0.15, PZ, rng.r(0.8, 1.3) * s, rng.r(0.6, 0.9), 0.9, 1.0 * I, rng.f() * dt);
      }
      c.acc2 += dt * 16 * fx.density * A;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        spot(fx, c, 0, 1);
        embers(fx, PX, gy(fx, c, PX, PZ) + 0.2, PZ, 1, 0.1, 1.9 * s, 0.8, 1.6, 0.16 * s, p.core, p.edge, rng.f() * dt, 2.4 * I);
      }
      c.acc3 += dt * 3.5 * fx.density * A;
      while (c.acc3 >= 1) {
        c.acc3 -= 1;
        spot(fx, c, 0, 0.9);
        const y = gy(fx, c, PX, PZ);
        if (fx.detail >= 1) smoke(fx, PX, y + 0.5, PZ, 1, 0.1, 1.1, 1.3, 1.9, 0.8 * s, 2.2 * s, p.smoke, 0.34, 0, SPR.smoke0);
        glow(fx, PX, y + 0.8, PZ, 1.6 * s, 2.6 * s, 1.0, p.main, 0.35, 0.8);
      }
    },
    end: endZone,
  };
}

// ----------------------------------------------------------------------------------------------------------- poison

function poisonZone(): PresetDef {
  return {
    id: 'zone.poison',
    cat: 'area',
    desc: 'groundZone: bubbling toxic pool with glowing rim, flipbook gas puffs, popping bubbles and drifting spores.',
    size: 'radius',
    base: 3,
    palette: 'poison',
    dur: 4,
    loop: true,
    demo: { loopFor: 4 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const rng = fx.rng;
      const R = c.radius;
      const s = sk(c);
      const I = c.intensity;
      const life = c.duration + 1;
      const sd = c.seed * 10;
      inst.ownDecal(fx.dec.ground(c.x, c.z, 0.03).disk(R * 1.06).pat(PAT.pool).life(life).col(p.main, 1, 0x1c4a16, 0.92).fade(FO.none).seed(sd).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.05).disk(R).pat(PAT.disk).life(life).col(p.main, 0.4, p.edge, 0.4).int(0.55 * I).fade(FO.none).seed(sd + 1).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.07).ring(R * 0.86, R * 1.02).pat(PAT.ring).expand(1).life(life).col(p.core, 1, p.main, 1).int(0.8 * I).fade(FO.none).seed(sd + 3).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.06).ring(R * 0.5, R * 1.0).pat(PAT.band).life(life).col(p.extra, 0.45, p.extra, 0.45).int(0.5 * I).fade(FO.none).seed(sd + 5).pinned().emit());
      shockRing(fx, c.x, c.z, R * 1.08, 0.5, p, 0.2, 1.5);
      for (let i = 0, n = fx.n(12); i < n; i++) {
        const a = rng.f() * TAU;
        const v = rng.r(1.5, 4) * s;
        fx.alp.at(c.x, c.y + 0.1, c.z).vel(Math.sin(a) * v, rng.r(2.5, 5), Math.cos(a) * v).size(0.26 * s, 0.16 * s).life(rng.r(0.5, 0.8)).col(p.main, 0.95, p.edge, 0.6)
          .spr(SPR.drop).mode(M.streak).stretch(0.05).grav(-12).drag(0.5).fade(0, FO.snap).emit();
      }
      for (let i = 0, n = fx.n(6); i < n; i++) {
        const a = (i / n) * TAU + rng.s2(0.3);
        const r = R * rng.r(0.3, 0.8);
        cloudPuff(fx, p.main, p.edge, c.x + Math.sin(a) * r, c.y + 0.3, c.z + Math.cos(a) * r, 1.8 * s, 1.4, 0.55, Math.sin(a) * 0.8, Math.cos(a) * 0.8, 0.5, i * 0.02);
      }
    },
    tick(fx, c, dt) {
      const p = c.pal;
      const rng = fx.rng;
      const s = sk(c);
      const A = ak(c);
      const I = c.intensity;
      c.acc0 += dt * 11 * fx.density * A;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        spot(fx, c, 0, 0.95);
        const y = gy(fx, c, PX, PZ);
        bubble(fx, PX, y, PZ, rng.r(0.4, 0.8) * s, rng.r(0.5, 0.9), p.core, p.main, 1.5 * I, rng.f() * dt);
        if (rng.f() < 0.35) {
          fx.alp.at(PX, y + 0.1, PZ).vel(rng.s2(0.8), rng.r(1.6, 3), rng.s2(0.8)).size(0.16 * s, 0.1 * s).life(rng.r(0.35, 0.55)).delay(0.2).col(p.main, 0.95, p.edge, 0.6)
            .spr(SPR.drop).mode(M.streak).stretch(0.05).grav(-11).fade(0, FO.snap).emit();
        }
      }
      c.acc1 += dt * 4.5 * fx.density * A;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        spot(fx, c, 0, 0.9);
        const a = rng.f() * TAU;
        cloudPuff(fx, p.main, p.edge, PX, gy(fx, c, PX, PZ) + 0.3, PZ, rng.r(1.4, 2.2) * s, rng.r(1.4, 2.0), 0.5, Math.sin(a) * 0.3, Math.cos(a) * 0.3, 0.55, rng.f() * dt);
      }
      c.acc2 += dt * 12 * fx.density * A;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        spot(fx, c, 0, 1);
        mote(fx, PX, gy(fx, c, PX, PZ) + 0.2, PZ, rng.r(0.1, 0.18) * s, rng.r(1.4, 2.4), 0.55, rng.f() < 0.5 ? p.extra : p.core, p.main, 1.9 * I, 0.25, rng.f() * dt);
      }
      c.acc3 += dt * 2.5 * fx.density * A;
      while (c.acc3 >= 1) {
        c.acc3 -= 1;
        spot(fx, c, 0, 0.85);
        glow(fx, PX, gy(fx, c, PX, PZ) + 0.7, PZ, 1.5 * s, 2.4 * s, 1.2, p.main, 0.3, 0.7);
      }
    },
    end: endZone,
  };
}

// ----------------------------------------------------------------------------------------------------------- ice

function iceZone(): PresetDef {
  return {
    id: 'zone.ice',
    cat: 'area',
    desc: 'groundZone: frost patch with dendrites, growing crystal spikes + debris shards, snow glints, falling flakes and low mist.',
    size: 'radius',
    base: 3,
    palette: 'ice',
    dur: 4,
    loop: true,
    demo: { loopFor: 4 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const rng = fx.rng;
      const R = c.radius;
      const s = sk(c);
      const I = c.intensity;
      const life = c.duration + 1;
      const sd = c.seed * 10;
      inst.ownDecal(fx.dec.ground(c.x, c.z, 0.03).disk(R * 1.1).pat(PAT.frost).life(life).col(p.core, 1, p.main, 0.95).fade(FO.none).seed(sd).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.05).disk(R).pat(PAT.disk).life(life).col(p.edge, 0.3, p.edge, 0.3).int(0.5 * I).fade(FO.none).seed(sd + 1).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.07).ring(R * 0.86, R * 1.02).pat(PAT.ring).expand(1).life(life).col(p.core, 1, p.main, 1).int(0.85 * I).fade(FO.none).seed(sd + 3).pinned().emit());
      // signature crown: blades erupt ring by ring on a rime sheet and stand for the zone's life (the tick keeps running); the
      // batched burst and spikes below play when the tier, budget or pool does not run it
      const dur = c.duration;
      c.duration = 0.5;
      const sig = castEl(fx, 'frost.nova', c, Math.max(0.6, dur - 0.4), 0);
      c.duration = dur;
      if (sig) return;
      shockRing(fx, c.x, c.z, R * 1.1, 0.45, p, 0.2, 1.8);
      flash(fx, c.x, c.y + 0.3, c.z, R * 0.7, R * 0.2, 0.2, p.core, 2.2);
      dustRing(fx, c.x, c.y, c.z, fx.n(8), R * 0.9, 0.7, 0xdff2ff, 0.4, 1.0);
      // crystal spikes erupt around the rim and inside
      for (let i = 0, n = fx.n(9); i < n; i++) {
        const a = (i / n) * TAU + rng.s2(0.3);
        const r = R * rng.r(0.35, 0.95);
        const x = c.x + Math.sin(a) * r;
        const z = c.z + Math.cos(a) * r;
        const y = gy(fx, c, x, z);
        const h = rng.r(0.7, 1.3) * s;
        fx.alp.at(x, y - 0.05, z).size(0.1 * s, h).life(rng.r(2.4, 3.2)).delay(i * 0.03).stretch(1.7).col(p.main, 0.92, p.edge, 0.85).spr(SPR.shard).mode(M.upright).fade(0, FO.late, SC.out).emit();
        fx.add.at(x, y - 0.05, z).size(0.1 * s, h * 0.9).life(rng.r(1.0, 1.6)).delay(i * 0.03).stretch(1.7).col(p.core, 0.8, p.main, 0).int(1.8).spr(SPR.shard).mode(M.upright).fade(0, FO.quad, SC.out).emit();
      }
      for (let i = 0, n = fx.n(10); i < n; i++) {
        const a = rng.f() * TAU;
        const r = R * rng.r(0.3, 1.0);
        const x = c.x + Math.sin(a) * r;
        const z = c.z + Math.cos(a) * r;
        fx.db.at(x, gy(fx, c, x, z) + 0.05, z).vel(0, 0, 0).sz(rng.r(0.16, 0.3) * s).tall(2.3).col(p.core, p.main).glow(0.6).life(c.duration + 0.5).floor(gy(fx, c, x, z)).delay(0.05 + i * 0.03).spin_(0).emit();
      }
    },
    tick(fx, c, dt) {
      const p = c.pal;
      const rng = fx.rng;
      const s = sk(c);
      const A = ak(c);
      const I = c.intensity;
      c.acc0 += dt * 13 * fx.density * A;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        spot(fx, c, 0, 1);
        glint(fx, PX, gy(fx, c, PX, PZ) + 0.15, PZ, rng.r(0.25, 0.45) * s, rng.r(1.0, 1.7), 0.5, p.core, p.main, 2.2 * I, rng.f() * dt);
      }
      c.acc1 += dt * 6 * fx.density * A;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        spot(fx, c, 0, 1);
        fx.alp.at(PX, gy(fx, c, PX, PZ) + rng.r(1.4, 2.4), PZ).vel(rng.s2(0.25), rng.r(-0.9, -0.5), rng.s2(0.25)).size(0.2 * s, 0.26 * s).life(rng.r(1.8, 2.6)).delay(rng.f() * dt)
          .col(0xeaf8ff, 0.85, 0xcfe8ff, 0.3).spr(SPR.snow0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(1.2)).wob(0.3).fade(2, FO.late).emit();
      }
      c.acc2 += dt * 4.5 * fx.density * A;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        spot(fx, c, 0.2, 0.95);
        const a = Math.atan2(PX - c.x, PZ - c.z);
        const y = gy(fx, c, PX, PZ);
        fx.alp.at(PX, y + 0.25, PZ).vel(Math.sin(a) * 0.45, 0.12, Math.cos(a) * 0.45).size(1.2 * s, 2.4 * s).life(rng.r(1.6, 2.2)).delay(rng.f() * dt)
          .col(0xe4f4ff, 0.3, 0xbfdcf5, 0).spr(SPR.smoke0 + rng.i(4)).rot(rng.f() * TAU, rng.s2(0.3)).drag(0.8).fade(2, FO.sq, SC.out).emit();
      }
      c.acc3 += dt * 1.5 * fx.density * A;
      while (c.acc3 >= 1) {
        c.acc3 -= 1;
        spot(fx, c, 0.3, 0.98);
        const y = gy(fx, c, PX, PZ);
        const h = rng.r(0.7, 1.3) * s;
        fx.alp.at(PX, y - 0.05, PZ).size(0.1 * s, h).life(rng.r(1.8, 2.6)).stretch(1.7).col(p.main, 0.92, p.edge, 0.85).spr(SPR.shard).mode(M.upright).fade(0, FO.late, SC.out).emit();
        fx.add.at(PX, y - 0.05, PZ).size(0.1 * s, h * 0.9).life(rng.r(0.9, 1.4)).stretch(1.7).col(p.core, 0.8, p.main, 0).int(1.8).spr(SPR.shard).mode(M.upright).fade(0, FO.quad, SC.out).emit();
        haloRing(fx, PX, y + 0.1, PZ, 0.2 * s, 0.9 * s, 0.35, p.core, 0.7, 1.4);
      }
    },
    end: endZone,
  };
}

// ----------------------------------------------------------------------------------------------------------- dark

function darkZone(): PresetDef {
  return {
    id: 'zone.dark',
    cat: 'area',
    desc: 'groundZone: violet arcane vortex — blackened floor, swirling disk, counter-rotating rune ring, twisting column, inflow streaks, wisps and smoke.',
    size: 'radius',
    base: 3,
    palette: 'dark',
    dur: 4,
    loop: true,
    demo: { loopFor: 4 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const R = c.radius;
      const s = sk(c);
      const I = c.intensity;
      const life = c.duration + 1;
      const hot = c.duration * 3 + 2;
      const sd = c.seed * 10;
      inst.ownDecal(fx.dec.ground(c.x, c.z, 0.03).disk(R * 1.1).pat(PAT.scorch).life(hot).col(p.main, 1, 0x0c0414, 0.92).fade(FO.none).seed(sd).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.05).disk(R).pat(PAT.arcane).spin(0.7).life(life).col(p.main, 1, p.edge, 1).int(1.1 * I).fade(FO.none).seed(sd + 1).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.06).disk(R * 0.98).pat(PAT.rune).spin(-0.35).life(life).col(p.main, 1, p.edge, 1).int(1.0 * I).fade(FO.none).seed(sd + 2).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.07).ring(R * 0.88, R * 1.02).pat(PAT.ring).expand(1).life(life).col(p.main, 1, p.edge, 1).int(0.8 * I).fade(FO.none).seed(sd + 3).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0).cyl(R * 0.2, R * 0.38, 2.4 * s).pat(PAT.pillar).spin(2.6).life(life).col(p.main, 1, p.edge, 1).int(0.9 * I).fade(FO.none).seed(sd + 4).pinned().emit());
      shockRing(fx, c.x, c.z, R * 1.1, 0.5, p, 0.2, 1.6);
      flash(fx, c.x, c.y + 0.3, c.z, R * 0.7, R * 0.2, 0.2, p.core, 2.0);
      smoke(fx, c.x, c.y + 0.2, c.z, fx.n(8), R * 0.8, 0.8, 0.9, 1.4, 1.2 * s, 2.4 * s, p.smoke, 0.6);
    },
    tick(fx, c, dt) {
      const p = c.pal;
      const rng = fx.rng;
      const R = c.radius;
      const s = sk(c);
      const A = ak(c);
      const I = c.intensity;
      c.acc0 += dt * 26 * fx.density * A;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        const a = rng.f() * TAU;
        const r = R * rng.r(0.62, 1.0);
        const sn = Math.sin(a), cs = Math.cos(a);
        const px = c.x + sn * r, pz = c.z + cs * r;
        const sp = rng.r(3.0, 4.6) * s;
        fx.add.at(px, gy(fx, c, px, pz) + 0.12, pz).vel(cs * sp - sn * sp * 0.55, rng.r(0.1, 0.5), -sn * sp - cs * sp * 0.55).life(rng.r(0.5, 0.85)).delay(rng.f() * dt)
          .size(0.11 * s, 0.04 * s).stretch(0.07).col(p.main, 1, p.edge, 0).int(1.9 * I).spr(SPR.streak).mode(M.streak).drag(1.2).fade(0, FO.cubic).emit();
      }
      c.acc1 += dt * 6 * fx.density * A;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        spot(fx, c, 0, 0.95);
        wisps(fx, PX, gy(fx, c, PX, PZ), PZ, 1, 0.1, 1.1 * s, 1.0, 1.7, 0.7 * s, p.main, p.edge, rng.f() * dt, 1.7 * I);
      }
      c.acc2 += dt * 3 * fx.density * A;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        spot(fx, c, 0, 0.9);
        const a = rng.f() * TAU;
        cloudPuff(fx, p.edge, p.smoke, PX, gy(fx, c, PX, PZ) + 0.3, PZ, rng.r(1.4, 2.2) * s, rng.r(1.4, 2.0), 0.5, Math.cos(a) * 0.5, -Math.sin(a) * 0.5, 0.6, rng.f() * dt);
      }
      c.acc3 += dt * 1.1 * fx.density * A;
      while (c.acc3 >= 1) {
        c.acc3 -= 1;
        fx.add.at(c.x, c.y + 0.08, c.z).size(R * 0.35, R * 1.6).life(1.3).col(p.main, 0.7, p.edge, 0).int(1.0 * I).spr(FB.swirl).frames(16).ramp().mode(M.ground).rot(rng.f() * TAU, 1.4).fade(0, FO.late).emit();
        if (fx.detail >= 1) spot(fx, c, 0.3, 0.9);
        embers(fx, PX, gy(fx, c, PX, PZ) + 0.1, PZ, 2, 0.2, 1.3 * s, 0.9, 1.6, 0.15 * s, p.extra, p.main, 0, 2.2 * I);
      }
    },
    end: endZone,
  };
}

// ----------------------------------------------------------------------------------------------------------- holy

function holyZone(): PresetDef {
  return {
    id: 'zone.holy',
    cat: 'area',
    desc: 'groundZone: consecrated light circle — pulsing ring stack, rune ring, soft light pillars blinking in and out, rising glints and feathers.',
    size: 'radius',
    base: 3,
    palette: 'holy',
    dur: 4,
    loop: true,
    demo: { loopFor: 4 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const R = c.radius;
      const I = c.intensity;
      const life = c.duration + 1;
      const sd = c.seed * 10;
      inst.own(fx.shp.ground(c.x, c.z, 0.05).disk(R).pat(PAT.disk).life(life).col(p.main, 0.5, p.edge, 0.5).int(0.6 * I).fade(FO.none).seed(sd + 1).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.06).disk(R * 0.98).pat(PAT.holy).life(life).col(p.main, 1, p.edge, 1).int(1.0 * I).fade(FO.none).seed(sd + 2).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.07).disk(R * 0.7).pat(PAT.rune).spin(0.3).life(life).col(p.core, 0.9, p.main, 0.9).int(0.8 * I).fade(FO.none).seed(sd + 3).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.08).ring(R * 0.86, R * 1.02).pat(PAT.ring).expand(1).life(life).col(p.core, 1, p.extra, 1).int(1.0 * I).fade(FO.none).seed(sd + 4).pinned().emit());
      shockRing(fx, c.x, c.z, R * 1.1, 0.5, p, 0.2, 1.8);
      flash(fx, c.x, c.y + 0.5, c.z, R * 0.9, R * 0.3, 0.25, p.core, 2.4);
      for (let i = 0, n = fx.n(12); i < n; i++) {
        spot(fx, c, 0, 0.95);
        glint(fx, PX, gy(fx, c, PX, PZ) + 0.1, PZ, 0.45 * sk(c), 1.1, 1.6, p.core, p.edge, 2.4 * I, i * 0.02);
      }
    },
    tick(fx, c, dt) {
      const p = c.pal;
      const rng = fx.rng;
      const s = sk(c);
      const A = ak(c);
      const I = c.intensity;
      c.acc0 += dt * 2.6 * fx.density * A;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        spot(fx, c, 0, 0.85);
        const y = gy(fx, c, PX, PZ);
        fx.shp.at(PX, y, PZ).cyl(0.36 * s, 0.14 * s, 3.4 * s).pat(PAT.pillar).life(rng.r(0.9, 1.3)).col(p.core, 1, p.main, 1).int(1.3 * I).fade(FO.sq).expand(0.35).seed(rng.f() * 10).emit();
        fx.shp.at(PX, y + 0.06, PZ).disk(0.9 * s).pat(PAT.disk).life(0.8).col(p.main, 1, p.edge, 1).int(1.3 * I).fade(FO.sq).seed(rng.f() * 10).emit();
        flash(fx, PX, y + 0.2, PZ, 0.9 * s, 0.3 * s, 0.3, p.core, 2.2);
      }
      c.acc1 += dt * 15 * fx.density * A;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        spot(fx, c, 0, 1);
        glint(fx, PX, gy(fx, c, PX, PZ) + 0.1, PZ, rng.r(0.3, 0.5) * s, rng.r(1.0, 1.7), 1.2, p.core, p.edge, 2.4 * I, rng.f() * dt);
      }
      c.acc2 += dt * 10 * fx.density * A;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        spot(fx, c, 0, 1);
        mote(fx, PX, gy(fx, c, PX, PZ) + 0.1, PZ, rng.r(0.1, 0.18) * s, rng.r(1.4, 2.2), 0.6, p.main, p.edge, 1.6 * I, 0.15, rng.f() * dt);
      }
      c.acc3 += dt * 2.5 * fx.density * A;
      while (c.acc3 >= 1) {
        c.acc3 -= 1;
        spot(fx, c, 0, 0.95);
        fx.add.at(PX, gy(fx, c, PX, PZ) + 0.2, PZ).vel(rng.s2(0.3), rng.r(0.5, 1.0), rng.s2(0.3)).size(0.3 * s, 0.4 * s).life(rng.r(1.4, 2.0)).col(p.core, 0.8, p.main, 0).int(1.2 * I)
          .spr(SPR.petal).rot(rng.f() * TAU, rng.s2(2)).wob(0.4).drag(0.4).fade(2, FO.quad).emit();
      }
    },
    end: endZone,
  };
}

// ----------------------------------------------------------------------------------------------------------- lightning

function lightningZone(): PresetDef {
  return {
    id: 'zone.lightning',
    cat: 'area',
    desc: 'groundZone: static field — pale-blue glow, crackling ground arcs (ribbon bolts), flickering fracture veins, flat arc flashes and rising sparkles.',
    size: 'radius',
    base: 3,
    palette: 'lightning',
    dur: 4,
    loop: true,
    demo: { loopFor: 4 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const rng = fx.rng;
      const R = c.radius;
      const s = sk(c);
      const I = c.intensity;
      const life = c.duration + 1;
      const sd = c.seed * 10;
      inst.ownDecal(fx.dec.ground(c.x, c.z, 0.03).disk(R * 1.05).pat(PAT.scorch).life(life).col(0x000000, 1, 0x0a1022, 0.55).fade(FO.none).seed(sd).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.05).disk(R).pat(PAT.disk).life(life).col(p.edge, 0.45, p.edge, 0.45).int(0.6 * I).fade(FO.none).seed(sd + 1).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.07).ring(R * 0.9, R * 1.02).pat(PAT.ring).expand(1).life(life).col(p.core, 1, p.main, 1).int(1.2 * I).fade(FO.none).seed(sd + 3).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.06).ring(R * 0.45, R * 1.0).pat(PAT.band).life(life).col(p.extra, 0.4, p.extra, 0.4).int(0.5 * I).fade(FO.none).seed(sd + 5).pinned().emit());
      shockRing(fx, c.x, c.z, R * 1.1, 0.4, p, 0.18, 1.8);
      flash(fx, c.x, c.y + 0.4, c.z, R * 0.8, R * 0.25, 0.18, p.core, 2.6);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + rng.s2(0.4);
        fx.rb.width(0.12 * s).life(0.16).delay(i * 0.02).col(p.core, p.main).int(2.4 * I).jag(0.5).branch(1)
          .bolt(c.x, c.y + 0.25, c.z, c.x + Math.sin(a) * R * 0.95, c.y + 0.12, c.z + Math.cos(a) * R * 0.95);
      }
    },
    tick(fx, c, dt) {
      const p = c.pal;
      const rng = fx.rng;
      const R = c.radius;
      const s = sk(c);
      const A = ak(c);
      const I = c.intensity;
      c.acc0 += dt * 6.5 * fx.density * A;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        spot(fx, c, 0, 0.85);
        const x0 = PX, z0 = PZ;
        const a = rng.f() * TAU;
        const len = rng.r(0.9, 1.8) * s;
        const x1 = x0 + Math.sin(a) * len, z1 = z0 + Math.cos(a) * len;
        const y0 = gy(fx, c, x0, z0) + 0.12, y1 = gy(fx, c, x1, z1) + 0.12;
        fx.rb.width(rng.r(0.08, 0.13) * s).life(rng.r(0.1, 0.16)).delay(rng.f() * dt).col(p.core, p.main).int(2.2 * I).jag(0.55).branch(rng.f() < 0.5 ? 1 : 0).bolt(x0, y0, z0, x1, y1, z1);
        flash(fx, x1, y1 + 0.05, z1, 0.7 * s, 0.25 * s, 0.14, p.core, 2.4);
      }
      c.acc1 += dt * 12 * fx.density * A;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        spot(fx, c, 0, 0.95);
        fx.add.at(PX, gy(fx, c, PX, PZ) + 0.08, PZ).size(1.0 * s, 1.5 * s).life(rng.r(0.07, 0.13)).delay(rng.f() * dt).col(p.core, 1, p.main, 0).int(2.4 * I)
          .spr(SPR.arc0 + rng.i(3)).mode(M.ground).rot(rng.f() * TAU).twinkle().fade(0, FO.cube).emit();
      }
      c.acc2 += dt * 14 * fx.density * A;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        spot(fx, c, 0, 1);
        glint(fx, PX, gy(fx, c, PX, PZ) + 0.15, PZ, rng.r(0.22, 0.4) * s, rng.r(0.5, 1.0), 0.8, p.core, p.main, 2.4 * I, rng.f() * dt);
      }
      c.acc3 += dt * 3.5 * fx.density;
      while (c.acc3 >= 1) {
        c.acc3 -= 1;
        fx.shp.ground(c.x, c.z, 0.08).disk(R).pat(PAT.cracks).life(0.24).col(p.core, 1, p.main, 1).int(1.5 * I).fade(FO.sq).seed(rng.f() * 10).emit();
      }
    },
    end: endZone,
  };
}

// ----------------------------------------------------------------------------------------------------------- wind

/** gust heads orbit at this angular speed (rad/s) */
const GUST_OMEGA = 2.6;

function windZone(): PresetDef {
  return {
    id: 'zone.wind',
    cat: 'area',
    desc: 'groundZone: spiralling gust — mint swirl disk, noise ring, twisting funnel, comet streaks circling the rim, crescent gust blades, leaves and dust.',
    size: 'radius',
    base: 3,
    palette: 'wind',
    dur: 4,
    loop: true,
    demo: { loopFor: 4 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const R = c.radius;
      const s = sk(c);
      const I = c.intensity;
      const life = c.duration + 1;
      const sd = c.seed * 10;
      inst.own(fx.shp.ground(c.x, c.z, 0.05).disk(R).pat(PAT.disk).life(life).col(p.main, 0.3, p.edge, 0.3).int(0.4 * I).fade(FO.none).seed(sd + 1).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.06).disk(R * 0.98).pat(PAT.arcane).spin(-1.3).life(life).col(p.main, 1, p.edge, 1).int(0.6 * I).fade(FO.none).seed(sd + 2).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.07).ring(R * 0.8, R * 1.04).pat(PAT.band).life(life).col(p.core, 1, p.main, 1).int(1.0 * I).fade(FO.none).seed(sd + 3).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0).cyl(R * 0.15, R * 0.5, 2.2 * s).pat(PAT.pillar).spin(3.0).life(life).col(p.core, 1, p.main, 1).int(0.8 * I).fade(FO.none).seed(sd + 4).pinned().emit());
      shockRing(fx, c.x, c.z, R * 1.1, 0.5, p, 0.14, 1.4);
      dustRing(fx, c.x, c.y, c.z, fx.n(8), R * 0.9, 0.7, p.smoke, 0.35, 0.9);
      sparks(fx, c.x, c.y + 0.3, c.z, fx.n(14), 4, 8, 0.5, 0.3, 0.5, 0.08, p.core, p.main);
    },
    tick(fx, c, dt) {
      const p = c.pal;
      const rng = fx.rng;
      const R = c.radius;
      const s = sk(c);
      const A = ak(c);
      const I = c.intensity;
      c.acc0 += dt * 46 * fx.density * A;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        const a = GUST_OMEGA * c.age + (rng.i(3) * TAU) / 3 - rng.r(0, 0.5);
        const r = R * rng.r(0.55, 1.0);
        const sn = Math.sin(a), cs = Math.cos(a);
        const px = c.x + sn * r, pz = c.z + cs * r;
        const sp = GUST_OMEGA * r * 0.8;
        fx.add.at(px, gy(fx, c, px, pz) + rng.r(0.1, 0.9), pz).vel(cs * sp, rng.r(0.1, 0.6), -sn * sp).life(rng.r(0.3, 0.5)).delay(rng.f() * dt)
          .size(0.1 * s, 0.04 * s).stretch(0.08).col(p.core, 1, p.main, 0).int(1.7 * I).spr(SPR.streak).mode(M.streak).drag(1.0).fade(0, FO.cubic).emit();
      }
      c.acc1 += dt * 6 * fx.density * A;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        const a = rng.f() * TAU;
        const r = R * rng.r(0.5, 0.95);
        const sn = Math.sin(a), cs = Math.cos(a);
        const px = c.x + sn * r, pz = c.z + cs * r;
        fx.alp.at(px, gy(fx, c, px, pz) + 0.3, pz).vel(cs * 2.6, rng.r(0.5, 1.2), -sn * 2.6).size(0.26 * s, 0.34 * s).life(rng.r(1.0, 1.5)).delay(rng.f() * dt)
          .col(0xbfe89a, 0.95, p.main, 0.5).spr(SPR.leaf0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(7)).wob(0.25).drag(0.3).fade(1, FO.late).emit();
      }
      c.acc2 += dt * 4 * fx.density * A;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        const a = rng.f() * TAU;
        const r = R * rng.r(0.6, 1.0);
        const sn = Math.sin(a), cs = Math.cos(a);
        const px = c.x + sn * r, pz = c.z + cs * r;
        fx.alp.at(px, gy(fx, c, px, pz) + 0.2, pz).vel(cs * 1.8, 0.3, -sn * 1.8).size(0.6 * s, 1.5 * s).life(rng.r(0.8, 1.2)).delay(rng.f() * dt)
          .col(p.smoke, 0.28, p.smoke, 0).spr(SPR.dust0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(1)).drag(1.2).fade(1, FO.sq, SC.out).emit();
      }
      c.acc3 += dt * 2.4 * fx.density;
      while (c.acc3 >= 1) {
        c.acc3 -= 1;
        const r = R * rng.r(0.55, 0.95);
        fx.shp.ground(c.x, c.z, 0.12).arc(r * 0.93, r, rng.r(0.9, 1.5), rng.f() * TAU).crescent(1).pat(PAT.slash).sweep(0.35, 0.6).spin(GUST_OMEGA * 1.1).life(0.7)
          .col(p.core, 1, p.main, 1).int(1.3 * I).seed(rng.f() * 10).emit();
      }
    },
    end: endZone,
  };
}

// ----------------------------------------------------------------------------------------------------------- physical

function physicalZone(): PresetDef {
  return {
    id: 'zone.physical',
    cat: 'area',
    desc: 'groundZone: stomped-earth dust circle — dark soil stain, pale rim, dust puffs circling the edge, hopping pebbles, dust-lit sparkles.',
    size: 'radius',
    base: 3,
    palette: 'dust',
    dur: 4,
    loop: true,
    demo: { loopFor: 4 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const R = c.radius;
      const s = sk(c);
      const I = c.intensity;
      const life = c.duration + 1;
      const sd = c.seed * 10;
      inst.ownDecal(fx.dec.ground(c.x, c.z, 0.03).disk(R * 1.08).pat(PAT.scorch).life(life).col(0x000000, 1, 0x3a2c1c, 0.75).fade(FO.none).seed(sd).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.07).ring(R * 0.9, R * 1.02).pat(PAT.ring).expand(1).life(life).col(p.core, 1, p.main, 1).int(0.9 * I).fade(FO.none).seed(sd + 3).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.06).ring(R * 0.45, R * 1.05).pat(PAT.band).life(life).col(p.main, 0.7, p.edge, 0.7).int(0.7 * I).fade(FO.none).seed(sd + 5).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.05).disk(R).pat(PAT.disk).life(life).col(p.main, 0.4, p.edge, 0.4).int(0.4 * I).fade(FO.none).seed(sd + 1).pinned().emit());
      shockRing(fx, c.x, c.z, R * 1.1, 0.45, p, 0.2, 1.5);
      dustRing(fx, c.x, c.y, c.z, fx.n(12), R, 0.7, p.main, 0.5, 1.1 * s);
      chunks(fx, c.x, c.y + 0.1, c.z, fx.n(8), 4 * s, 0.12 * s, p.edge, p.smoke, 0, 1.1, c.y);
    },
    tick(fx, c, dt) {
      const p = c.pal;
      const rng = fx.rng;
      const R = c.radius;
      const s = sk(c);
      const A = ak(c);
      const I = c.intensity;
      c.acc0 += dt * 24 * fx.density * A;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        const a = rng.f() * TAU;
        const r = R * rng.r(0.6, 1.0);
        const sn = Math.sin(a), cs = Math.cos(a);
        const px = c.x + sn * r, pz = c.z + cs * r;
        fx.alp.at(px, gy(fx, c, px, pz) + 0.15, pz).vel(cs * 1.7, rng.r(0.3, 0.8), -sn * 1.7).size(0.7 * s, rng.r(1.4, 2.2) * s).life(rng.r(0.8, 1.3)).delay(rng.f() * dt)
          .col(p.main, 0.7, p.edge, 0).spr(SPR.dust0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(0.8)).drag(1.3).fade(1, FO.sq, SC.out).emit();
      }
      c.acc1 += dt * 3 * fx.density * A;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        spot(fx, c, 0, 0.95);
        const y = gy(fx, c, PX, PZ);
        chunks(fx, PX, y + 0.05, PZ, 1, 3.2 * s, 0.09 * s, p.edge, p.smoke, 0, 1.1, y);
        dustRing(fx, PX, y, PZ, fx.n(3), 0.9 * s, 0.5, p.main, 0.35, 0.6 * s);
      }
      c.acc2 += dt * 8 * fx.density * A;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        spot(fx, c, 0, 1);
        mote(fx, PX, gy(fx, c, PX, PZ) + 0.2, PZ, rng.r(0.08, 0.14) * s, rng.r(1.2, 2.0), 0.35, p.core, p.main, 1.5 * I, 0.2, rng.f() * dt);
      }
    },
    end: endZone,
  };
}

// ----------------------------------------------------------------------------------------------------------- rune

function runeZone(): PresetDef {
  return {
    id: 'zone.rune',
    cat: 'area',
    desc: 'groundZone: arcane rune circle — counter-rotating rune rings, light barrier, rising glyph motes and light beams, 1 s pulse ring; element flavour from the variant.',
    size: 'radius',
    base: 3,
    palette: 'metin',
    variants: true,
    dur: 4,
    loop: true,
    demo: { loopFor: 4 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const R = c.radius;
      const s = sk(c);
      const I = c.intensity;
      const life = c.duration + 1;
      const sd = c.seed * 10;
      inst.own(fx.shp.ground(c.x, c.z, 0.05).disk(R).pat(PAT.disk).life(life).col(p.edge, 0.4, p.edge, 0.4).int(0.55 * I).fade(FO.none).seed(sd + 1).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.06).disk(R).pat(PAT.rune).spin(0.35).life(life).col(p.main, 1, p.edge, 1).int(1.5 * I).fade(FO.none).seed(sd + 2).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.07).disk(R * 0.62).pat(PAT.rune).spin(-0.6).life(life).col(p.core, 0.9, p.main, 0.9).int(1.0 * I).fade(FO.none).seed(sd + 3).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.08).ring(R * 0.9, R * 1.04).pat(PAT.band).life(life).col(p.main, 0.7, p.edge, 0.7).int(0.7 * I).fade(FO.none).seed(sd + 4).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0).cyl(R * 0.98, R * 0.98, 1.3 * s).pat(PAT.pillar).life(life).col(p.main, 1, p.edge, 1).int(0.45 * I).fade(FO.none).seed(sd + 5).pinned().emit());
      shockRing(fx, c.x, c.z, R * 1.1, 0.5, p, 0.18, 1.8);
      flash(fx, c.x, c.y + 0.3, c.z, R * 0.7, R * 0.2, 0.2, p.core, 2.2);
      runeMotes(fx, c.x, c.y + 0.1, c.z, fx.n(8), R * 0.9, 1.2, 0.9, 1.4, 0.5 * s, p.core, 0, 1.8 * I);
    },
    tick(fx, c, dt) {
      const p = c.pal;
      const rng = fx.rng;
      const R = c.radius;
      const s = sk(c);
      const A = ak(c);
      const I = c.intensity;
      c.acc0 += dt * 5 * fx.density * A;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        spot(fx, c, 0.2, 0.95);
        runeMotes(fx, PX, gy(fx, c, PX, PZ) + 0.1, PZ, 1, 0.1, 1.0 * s, 1.0, 1.6, 0.42 * s, p.main, rng.f() * dt, 1.7 * I);
      }
      c.acc1 += dt * 12 * fx.density * A;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        spot(fx, c, 0.55, 1.0);
        fx.add.at(PX, gy(fx, c, PX, PZ) + 0.1, PZ).vel(0, rng.r(2.2, 3.6), 0).size(0.07 * s, 0.03 * s).life(rng.r(0.4, 0.7)).delay(rng.f() * dt).stretch(0.28)
          .col(p.core, 0.9, p.main, 0).int(1.7 * I).spr(SPR.streak).mode(M.streak).fade(0, FO.cubic).emit();
      }
      c.acc2 += dt * 8 * fx.density * A;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        spot(fx, c, 0, 1);
        accent(fx, c, PX, gy(fx, c, PX, PZ) + 0.15, PZ, s, I);
      }
      c.acc3 += dt * 1.0 * fx.density;
      while (c.acc3 >= 1) {
        c.acc3 -= 1;
        fx.shp.ground(c.x, c.z, 0.09).ring(R * 0.82, R).pat(PAT.ring).expand(0.2).life(0.9).col(p.main, 1, p.edge, 1).int(1.3 * I).fade(FO.sq).seed(rng.f() * 10).emit();
      }
    },
    end: endZone,
  };
}

// ----------------------------------------------------------------------------------------------------------- cloud

function cloudZone(): PresetDef {
  return {
    id: 'zone.cloud',
    cat: 'area',
    desc: 'groundZone: drifting volume — large flipbook puffs tinted by the palette over a soft stain, faint noise rim; flavour per element (embers, frost glints, storm flashes, wisps, spores).',
    size: 'radius',
    base: 3,
    palette: 'poison',
    variants: true,
    dur: 4,
    loop: true,
    demo: { loopFor: 4 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const rng = fx.rng;
      const R = c.radius;
      const s = sk(c);
      const I = c.intensity;
      const life = c.duration + 1;
      const sd = c.seed * 10;
      const dark = c.element === 4 || c.element === 1;
      inst.ownDecal(fx.dec.ground(c.x, c.z, 0.03).disk(R * 1.1).pat(PAT.scorch).life(life).col(0x000000, 1, p.smoke, 0.55).fade(FO.none).seed(sd).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.05).disk(R).pat(PAT.disk).life(life).col(p.main, 0.35, p.edge, 0.35).int(0.5 * I).fade(FO.none).seed(sd + 1).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.06).ring(R * 0.84, R * 1.04).pat(PAT.band).life(life).col(p.main, 0.8, p.edge, 0.8).int(0.7 * I).fade(FO.none).seed(sd + 3).pinned().emit());
      shockRing(fx, c.x, c.z, R * 1.05, 0.5, p, 0.16, 1.2);
      for (let i = 0, n = fx.n(9); i < n; i++) {
        const a = (i / n) * TAU + rng.s2(0.3);
        const r = R * rng.r(0.2, 0.85);
        cloudPuff(fx, dark ? p.edge : p.main, dark ? p.smoke : p.edge, c.x + Math.sin(a) * r, c.y + 0.4, c.z + Math.cos(a) * r, 2.2 * s, 1.6, 0.6, Math.sin(a) * 1.0, Math.cos(a) * 1.0, 0.3, i * 0.02);
      }
    },
    tick(fx, c, dt) {
      const p = c.pal;
      const rng = fx.rng;
      const s = sk(c);
      const A = ak(c);
      const I = c.intensity;
      const dark = c.element === 4 || c.element === 1;
      c.acc0 += dt * 8 * fx.density * A;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        spot(fx, c, 0, 0.92);
        const a = rng.f() * TAU;
        cloudPuff(fx, dark ? p.edge : p.main, dark ? p.smoke : p.edge, PX, gy(fx, c, PX, PZ) + rng.r(0.3, 0.9), PZ, rng.r(1.9, 2.9) * s, rng.r(2.2, 3.0), 0.55,
          Math.cos(a) * 0.35, -Math.sin(a) * 0.35, 0.25, rng.f() * dt);
      }
      c.acc1 += dt * 3 * fx.density * A;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        spot(fx, c, 0, 0.85);
        glow(fx, PX, gy(fx, c, PX, PZ) + 0.9, PZ, 1.6 * s, 2.8 * s, 1.4, p.main, 0.28, 0.7);
      }
      c.acc2 += dt * 9 * fx.density * A;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        spot(fx, c, 0, 1);
        accent(fx, c, PX, gy(fx, c, PX, PZ) + rng.r(0.2, 0.9), PZ, s, I);
      }
      if (c.element === 3) {
        c.acc3 += dt * 2.2 * fx.density * A;
        while (c.acc3 >= 1) {
          c.acc3 -= 1;
          spot(fx, c, 0, 0.8);
          flash(fx, PX, gy(fx, c, PX, PZ) + 0.8, PZ, 2.6 * s, 1.4 * s, 0.14, p.core, 2.6 * I);
        }
      }
    },
    end: endZone,
  };
}

// ----------------------------------------------------------------------------------------------------------- firering

function fireRingZone(): PresetDef {
  return {
    id: 'zone.firering',
    cat: 'area',
    desc: 'metin fireRing: flame blobs orbiting at radius R (4/6/8 by size) trailing flame tails, embers and smoke over a glowing ground ring.',
    size: 'radius',
    base: 3,
    palette: 'fire',
    dur: 4,
    loop: true,
    demo: { loopFor: 4 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const R = c.radius;
      const s = sk(c);
      const I = c.intensity;
      const life = c.duration + 1;
      const sd = c.seed * 10;
      const n = R < 2 ? 4 : R < 4 ? 6 : 8;
      inst.own(fx.shp.ground(c.x, c.z, 0.05).ring(R * 0.62, R * 1.12).pat(PAT.band).life(life).col(p.edge, 0.7, p.edge, 0.7).int(0.7 * I).fade(FO.none).seed(sd + 1).pinned().emit());
      inst.own(fx.shp.ground(c.x, c.z, 0.07).ring(R * 0.92, R * 1.04).pat(PAT.ring).expand(1).life(life).col(p.extra, 1, p.main, 1).int(1.1 * I).fade(FO.none).seed(sd + 2).pinned().emit());
      inst.ownDecal(fx.dec.ground(c.x, c.z, 0.03).ring(R * 0.8, R * 1.1).pat(PAT.shadow).life(c.duration * 0.5 + 0.4).col(0x000000, 1, 0x100804, 0.7).fade(FO.late).seed(sd).pinned().emit());
      shockRing(fx, c.x, c.z, R * 1.15, 0.5, p, 0.2, 1.9);
      for (let k = 0; k < n; k++) {
        const a = (k * TAU) / n;
        const x = c.x + Math.sin(a) * R, z = c.z + Math.cos(a) * R;
        flash(fx, x, c.y + 0.6, z, 1.6 * s, 0.6 * s, 0.25, p.core, 2.4, k * 0.02);
        puff(fx, p, x, c.y + 0.1, z, 1.5 * s, 0.6, 1.2, 1.4 * I, k * 0.02);
      }
    },
    tick(fx, c, dt) {
      const p = c.pal;
      const rng = fx.rng;
      const R = c.radius;
      const s = sk(c);
      const I = c.intensity;
      const n = R < 2 ? 4 : R < 4 ? 6 : 8;
      const om = 1.9;
      const base = om * c.age;
      c.acc0 += dt * 13 * n * fx.density;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        const a = base + (rng.i(n) * TAU) / n - rng.r(0, 0.45);
        const x = c.x + Math.sin(a) * R + rng.s2(0.15), z = c.z + Math.cos(a) * R + rng.s2(0.15);
        tongue(fx, p, x, gy(fx, c, x, z), z, rng.r(0.8, 1.4) * s, rng.r(0.5, 0.85), rng.r(0.4, 0.9), 1.1 * I, rng.f() * dt);
      }
      c.acc1 += dt * 12 * n * fx.density;
      while (c.acc1 >= 1) {
        c.acc1 -= 1;
        const a = base + (rng.i(n) * TAU) / n - rng.r(0, 0.12);
        const x = c.x + Math.sin(a) * R, z = c.z + Math.cos(a) * R;
        const y = gy(fx, c, x, z);
        if (rng.f() < 0.5) puff(fx, p, x, y + 0.2, z, rng.r(1.0, 1.5) * s, rng.r(0.4, 0.6), 0.8, 1.3 * I, rng.f() * dt);
        fx.add.at(x, y + 0.5, z).size(1.3 * s, 0.7 * s).life(0.16).delay(rng.f() * dt).col(p.core, 1, p.extra, 0).int(1.8 * I).spr(SPR.glow).fade(0, FO.quad).emit();
      }
      c.acc2 += dt * 6 * n * fx.density;
      while (c.acc2 >= 1) {
        c.acc2 -= 1;
        const a = base + (rng.i(n) * TAU) / n - rng.r(0, 0.35);
        const x = c.x + Math.sin(a) * R, z = c.z + Math.cos(a) * R;
        embers(fx, x, gy(fx, c, x, z) + 0.3, z, 1, 0.15, 1.8 * s, 0.7, 1.5, 0.15 * s, p.core, p.edge, rng.f() * dt, 2.4 * I);
      }
      c.acc3 += dt * 1.2 * n * fx.density;
      while (c.acc3 >= 1) {
        c.acc3 -= 1;
        const a = base + (rng.i(n) * TAU) / n - rng.r(0, 0.5);
        const x = c.x + Math.sin(a) * R, z = c.z + Math.cos(a) * R;
        if (fx.detail >= 1) smoke(fx, x, gy(fx, c, x, z) + 0.6, z, 1, 0.1, 1.0, 1.3, 1.8, 0.8 * s, 2.0 * s, p.smoke, 0.3);
      }
    },
    end: endZone,
  };
}

// ----------------------------------------------------------------------------------------------------------- cones

/** breath particles decelerate with this drag; travel distance = v·(1 − e^(−d·T))/d */
const BREATH_DRAG = 1.5;

function breathZone(): PresetDef {
  return {
    id: 'cone.breath',
    cat: 'area',
    desc: 'cone: breath stream for `duration` (0.8 s) — particle jet filling a cone (a = full angle, default 0.9) with a ground wedge/decal; flame, frost, storm, gloom, toxic gas, holy light, gale or neutral energy by element.',
    size: 'radius',
    base: 6,
    palette: 'fire',
    variants: true,
    dur: 0.8,
    loop: true,
    demo: { dir: 0, loopFor: 0.8 },
    fire(fx, c) {
      const inst = c as Inst;
      const p = c.pal;
      const L = c.radius;
      const A = c.a > 0 ? c.a : 0.9;
      const I = c.intensity;
      const el = c.element;
      const sd = c.seed * 10;
      const mx = c.x + c.dx * 0.5, mz = c.z + c.dz * 0.5;
      // the signature gout where a flame or gas suits the element; the batched jet (tick) stays the fallback and serves the rest
      const sig = (el === -1 || el === 1 || el === 2 || el === 4 || el === 5) && castEl(fx, 'breath.dragon', c, A, 0);
      if (sig) {
        inst.acc2 = 1;
      } else {
        flash(fx, mx, c.y + 0.9, mz, 1.4, 0.5, 0.2, p.core, 3.0);
        fx.add.at(mx, c.y + 0.9, mz).size(1.0, 2.2).life(0.22).col(p.main, 0.9, p.edge, 0).int(2.0).spr(SPR.sunburst).rot(fx.rng.f() * TAU, 2).fade(0, FO.quad).emit();
      }
      inst.own(fx.shp.ground(c.x, c.z, 0.06).yaw_(c.rot).arc(0.3, L, A * 0.9, -A * 0.45).pat(PAT.disk).expand(0.25).life(c.duration + 0.5).col(p.main, 0.35, p.edge, 0.35).int(0.5 * I).fade(FO.none).seed(sd).pinned().emit());
      const dpat = el === 1 || el === 4 ? PAT.scorch : el === 5 ? PAT.pool : el === 2 ? PAT.frost : -1;
      // the signature burns its own scorch; frost and slime keep their decals
      if (dpat >= 0 && !(sig && (el === 1 || el === 4))) {
        const dark = el === 4 ? 0x0c0414 : el === 5 ? 0x1c4a16 : el === 2 ? p.main : 0x100804;
        const lit = el === 2 ? p.core : p.main;
        fx.dec.ground(c.x, c.z, 0.03).yaw_(c.rot).arc(0.5, L * 0.97, A * 0.88, -A * 0.44).pat(dpat).expand(0.3).life(c.duration + 1.6).col(lit, 1, dark, 0.6).int(0.5 * I).fade(FO.late).seed(sd).emit();
      }
      if (el === 3) {
        for (let i = 0; i < 4; i++) {
          const a = c.rot + fx.rng.s2(A * 0.5);
          fx.rb.width(0.14).life(0.14).delay(i * 0.02).col(p.core, p.main).int(2.4 * I).jag(0.5).branch(1).bolt(mx, c.y + 0.9, mz, c.x + Math.sin(a) * L * 0.8, c.y + 0.4, c.z + Math.cos(a) * L * 0.8);
        }
      }
    },
    tick(fx, c, dt) {
      if (c.acc2 > 0) return; // the signature gout carries its own embers, smoke and sparks
      const p = c.pal;
      const rng = fx.rng;
      const L = c.radius;
      const half = (c.a > 0 ? c.a : 0.9) * 0.5;
      const I = c.intensity;
      const el = c.element;
      const k = Math.min(Math.max(L / 6, 0.6), 2);
      const env = Math.min(1, c.age / 0.08) * Math.min(1, Math.max(0, (c.duration - c.age) / 0.1 + 0.2));
      const mx = c.x + c.dx * 0.5, mz = c.z + c.dz * 0.5, my = c.y + 0.9;
      c.acc0 += dt * (el === 3 ? 30 : 130) * k * env * fx.density;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        const ang = c.rot + rng.s2(half * 0.95);
        const D = L * (0.12 + 0.88 * rng.f());
        const T = rng.r(0.45, 0.7);
        const v = (D * BREATH_DRAG) / (1 - Math.exp(-BREATH_DRAG * T));
        const vx = Math.sin(ang) * v, vz = Math.cos(ang) * v;
        const sz = 0.5 + D * 0.42;
        const dly = rng.f() * dt;
        const q = rng.f();
        switch (el) {
          case 1:
            if (q < 0.5) fx.add.at(mx, my, mz).vel(vx, rng.r(0.1, 0.6), vz).life(T).delay(dly).size(sz * 0.4, sz).col(p.extra, 1, p.edge, 1).int(1.5 * I).spr(FB.fire).frames(16).ramp().rot(rng.f() * TAU, rng.s2(1)).drag(BREATH_DRAG).fade(0, FO.late).emit();
            else if (q < 0.75) fx.add.at(mx, my, mz).vel(vx * 1.3, rng.r(0.2, 1), vz * 1.3).life(T * 0.7).delay(dly).size(0.1, 0.04).stretch(0.06).col(p.core, 1, p.main, 0).int(2.4 * I).spr(SPR.streak).mode(M.streak).drag(BREATH_DRAG).fade(0, FO.cubic).emit();
            else fx.alp.at(mx, my, mz).vel(vx * 0.8, rng.r(0.5, 1.2), vz * 0.8).life(T * 1.5).delay(dly + 0.1).size(sz * 0.5, sz * 1.2).col(p.smoke, 0.35, p.smoke, 0).spr(SPR.smoke0 + rng.i(4)).rot(rng.f() * TAU, rng.s2(0.5)).drag(BREATH_DRAG).fade(2, FO.sq, SC.out).emit();
            break;
          case 2:
            if (q < 0.4) fx.add.at(mx, my, mz).vel(vx * 1.1, rng.r(0, 0.8), vz * 1.1).life(T).delay(dly).size(0.3, 0.12).col(p.core, 1, p.main, 0).int(1.9 * I).spr(SPR.shard).rot(rng.f() * TAU, rng.s2(9)).drag(BREATH_DRAG).grav(-2).fade(0, FO.quad).emit();
            else if (q < 0.8) fx.alp.at(mx, my, mz).vel(vx * 0.9, rng.r(0.1, 0.6), vz * 0.9).life(T * 1.4).delay(dly).size(sz * 0.4, sz * 1.1).col(0xe4f4ff, 0.4, 0xbfdcf5, 0).spr(SPR.smoke0 + rng.i(4)).rot(rng.f() * TAU, rng.s2(0.5)).drag(BREATH_DRAG).fade(1, FO.sq, SC.out).emit();
            else glint(fx, mx + vx * 0.2, my, mz + vz * 0.2, 0.4, T, 0.2, p.core, p.main, 2.4 * I, dly);
            break;
          case 3:
            if (q < 0.6) fx.add.at(mx, my, mz).vel(vx * 1.2, rng.s2(1), vz * 1.2).life(T * 0.5).delay(dly).size(0.09, 0.03).stretch(0.07).col(p.core, 1, p.main, 0).int(2.6 * I).spr(SPR.streak).mode(M.streak).drag(BREATH_DRAG).fade(0, FO.cubic).emit();
            else fx.add.at(mx + vx * 0.15, c.y + 0.2, mz + vz * 0.15).size(1.1, 1.6).life(rng.r(0.07, 0.12)).delay(dly).col(p.core, 1, p.main, 0).int(2.4 * I).spr(SPR.arc0 + rng.i(3)).mode(M.ground).rot(rng.f() * TAU).twinkle().fade(0, FO.cube).emit();
            break;
          case 4:
            if (q < 0.45) fx.alp.at(mx, my, mz).vel(vx * 0.8, rng.r(0.1, 0.7), vz * 0.8).life(T * 1.5).delay(dly).size(sz * 0.4, sz * 1.1).col(p.edge, 0.7, p.smoke, 0).spr(SPR.smoke0 + rng.i(4)).rot(rng.f() * TAU, rng.s2(0.5)).drag(BREATH_DRAG).fade(1, FO.sq).emit();
            else if (q < 0.7) fx.add.at(mx, my, mz).vel(vx * 0.9, rng.r(0, 0.5), vz * 0.9).life(T).delay(dly).size(sz * 0.3, sz * 0.9).col(p.main, 0.7, p.edge, 0).int(1.3 * I).spr(SPR.smoke0 + rng.i(4)).rot(rng.f() * TAU, rng.s2(2)).drag(BREATH_DRAG).fade(0, FO.late).emit();
            else fx.add.at(mx, my, mz).vel(vx * 1.2, rng.r(0.2, 1), vz * 1.2).life(T * 0.8).delay(dly).size(0.12, 0.05).stretch(0.07).col(p.main, 1, p.edge, 0).int(2.0 * I).spr(SPR.streak).mode(M.streak).drag(BREATH_DRAG).fade(0, FO.cubic).emit();
            break;
          case 5:
            if (q < 0.5) fx.alp.at(mx, my, mz).vel(vx * 0.85, rng.r(0.1, 0.6), vz * 0.85).life(T * 1.5).delay(dly).size(sz * 0.4, sz * 1.15).col(p.main, 0.6, p.edge, 0).spr(SPR.smoke0 + rng.i(4)).rot(rng.f() * TAU, rng.s2(0.5)).drag(BREATH_DRAG).fade(1, FO.sq).emit();
            else if (q < 0.8) fx.alp.at(mx, my, mz).vel(vx, rng.r(0.5, 2), vz).life(T).delay(dly).size(0.18, 0.12).col(p.main, 0.95, p.edge, 0.6).spr(SPR.drop).mode(M.streak).stretch(0.05).drag(BREATH_DRAG).grav(-9).fade(0, FO.snap).emit();
            else mote(fx, mx + vx * 0.25, my, mz + vz * 0.25, 0.16, T * 1.6, 0.4, p.extra, p.core, 1.9 * I, 0.25, dly);
            break;
          case 6:
            if (q < 0.45) glint(fx, mx + vx * 0.1, my, mz + vz * 0.1, rng.r(0.3, 0.55), T * 1.3, 0.3, p.core, p.edge, 2.5 * I, dly);
            else if (q < 0.75) fx.add.at(mx, my, mz).vel(vx * 1.2, rng.s2(0.4), vz * 1.2).life(T * 0.7).delay(dly).size(0.12, 0.05).stretch(0.07).col(p.core, 1, p.main, 0).int(2.2 * I).spr(SPR.streak).mode(M.streak).drag(BREATH_DRAG).fade(0, FO.cubic).emit();
            else fx.add.at(mx, my, mz).vel(vx * 0.8, rng.r(0, 0.4), vz * 0.8).life(T).delay(dly).size(sz * 0.4, sz * 0.9).col(p.main, 0.6, p.edge, 0).int(1.0 * I).spr(SPR.glow).drag(BREATH_DRAG).fade(0, FO.quad).emit();
            break;
          case 7:
            if (q < 0.55) fx.add.at(mx, my, mz).vel(vx * 1.25, rng.s2(0.6), vz * 1.25).life(T * 0.8).delay(dly).size(0.08, 0.03).stretch(0.09).col(p.core, 0.95, p.main, 0).int(1.8 * I).spr(SPR.streak).mode(M.streak).drag(BREATH_DRAG).fade(0, FO.cubic).emit();
            else if (q < 0.75) fx.alp.at(mx, my, mz).vel(vx * 0.9, rng.r(0.2, 0.8), vz * 0.9).life(T * 1.4).delay(dly).size(0.26, 0.32).col(0xbfe89a, 0.95, p.main, 0.5).spr(SPR.leaf0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(8)).wob(0.2).drag(BREATH_DRAG * 0.6).fade(0, FO.late).emit();
            else fx.add.at(mx, my, mz).vel(vx * 0.85, rng.r(0, 0.4), vz * 0.85).life(T).delay(dly).size(sz * 0.3, sz * 0.9).col(p.core, 0.6, p.main, 0).int(1.1 * I).spr(SPR.smoke0 + rng.i(4)).rot(rng.f() * TAU, rng.s2(2)).drag(BREATH_DRAG).fade(0, FO.late).emit();
            break;
          default:
            if (q < 0.45) fx.add.at(mx, my, mz).vel(vx * 1.2, rng.s2(0.5), vz * 1.2).life(T * 0.7).delay(dly).size(0.11, 0.04).stretch(0.07).col(p.core, 1, p.main, 0).int(2.1 * I).spr(SPR.streak).mode(M.streak).drag(BREATH_DRAG).fade(0, FO.cubic).emit();
            else if (q < 0.8) fx.add.at(mx, my, mz).vel(vx * 0.9, rng.r(0, 0.5), vz * 0.9).life(T).delay(dly).size(sz * 0.3, sz * 0.9).col(p.main, 0.7, p.edge, 0).int(1.2 * I).spr(SPR.smoke0 + rng.i(4)).rot(rng.f() * TAU, rng.s2(2)).drag(BREATH_DRAG).fade(0, FO.late).emit();
            else glint(fx, mx + vx * 0.1, my, mz + vz * 0.1, rng.r(0.3, 0.5), T * 1.2, 0.3, p.core, p.main, 2.2 * I, dly);
        }
      }
      if (el === 3) {
        c.acc1 += dt * 16 * k * env * fx.density;
        while (c.acc1 >= 1) {
          c.acc1 -= 1;
          const ang = c.rot + rng.s2(half);
          const D = L * rng.r(0.4, 1.0);
          fx.rb.width(rng.r(0.09, 0.15)).life(rng.r(0.09, 0.14)).delay(rng.f() * dt).col(p.core, p.main).int(2.3 * I).jag(0.5).branch(rng.f() < 0.5 ? 1 : 0)
            .bolt(mx, my, mz, c.x + Math.sin(ang) * D, c.y + rng.r(0.2, 0.9), c.z + Math.cos(ang) * D);
        }
      }
    },
    end: endZone,
  };
}

function roarZone(): PresetDef {
  return {
    id: 'cone.roar',
    cat: 'area',
    desc: 'Shaman Dragon Roar: golden shock cone — expanding concentric arc rings, flying chevrons, streak/dust stream, rune seal and mouth flare. a = full angle (1.1).',
    size: 'radius',
    base: 7,
    palette: 'shamanGold',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const rng = fx.rng;
      const L = c.radius;
      const A = c.a > 0 ? c.a : 1.1;
      const I = c.intensity;
      const s = sk(c);
      const sd = c.seed * 10;
      const mx = c.x + c.dx * 0.5, mz = c.z + c.dz * 0.5;
      // a short golden exhale ahead of the shock rings (the signature; the batched roar is unchanged when it is refused)
      if (c.element === -1 || c.element === 1) {
        const d0 = c.duration;
        c.duration = 0.55;
        castEl(fx, 'breath.dragon', c, A * 0.7, 0, L * 0.85);
        c.duration = d0;
      }
      flash(fx, mx, c.y + 0.9, mz, 2.0, 0.6, 0.22, p.core, 3.2);
      fx.add.at(mx, c.y + 0.9, mz).size(1.4, 3.2).life(0.3).col(p.main, 0.9, p.edge, 0).int(2.2).spr(SPR.sunburst).rot(rng.f() * TAU, 1.5).fade(0, FO.quad).emit();
      fx.shp.ground(c.x, c.z, 0.06).yaw_(c.rot).arc(0, L, A, -A * 0.5).pat(PAT.disk).expand(0.2).life(0.6).col(p.main, 0.8, p.edge, 0.8).int(0.9 * I).fade(FO.sq).seed(sd).emit();
      for (let k = 0; k < 5; k++) {
        const r = L * (0.3 + 0.17 * k);
        const span = A * (0.8 + 0.05 * k);
        fx.shp.ground(c.x, c.z, 0.08).yaw_(c.rot).arc(r * 0.84, r, span, -span * 0.5).pat(PAT.ring).expand(0.4).life(0.55).delay(k * 0.07)
          .col(p.main, 1, p.edge, 1).int(1.8 * I).fade(FO.sq).seed(sd + k).emit();
      }
      for (let k = 0; k < 7; k++) {
        const a = c.rot + (k - 3) * A * 0.14;
        const sp = (L / 0.5) * rng.r(0.8, 1.0);
        fx.add.at(mx, c.y + 0.12, mz).vel(Math.sin(a) * sp, 0, Math.cos(a) * sp).size(0.7 * s, 1.1 * s).life(0.5).delay(k * 0.03).col(p.core, 1, p.main, 0).int(1.8 * I)
          .spr(SPR.chevron).mode(M.ground).rot(-a).drag(1.6).fade(0, FO.quad).emit();
      }
      for (let i = 0, n = fx.n(26); i < n; i++) {
        const a = c.rot + rng.s2(A * 0.5);
        const sp = rng.r(14, 22);
        fx.add.at(mx, c.y + rng.r(0.3, 1.0), mz).vel(Math.sin(a) * sp, rng.s2(0.6), Math.cos(a) * sp).size(0.12, 0.04).stretch(0.07).life(rng.r(0.3, 0.5)).delay(rng.f() * 0.12)
          .col(p.core, 1, p.main, 0).int(2.3 * I).spr(SPR.streak).mode(M.streak).drag(2.4).fade(0, FO.cubic).emit();
      }
      for (let i = 0, n = fx.n(10); i < n; i++) {
        const a = c.rot + rng.s2(A * 0.5);
        const sp = rng.r(6, 11);
        fx.alp.at(mx, c.y + 0.4, mz).vel(Math.sin(a) * sp, rng.r(0.2, 0.8), Math.cos(a) * sp).size(0.6 * s, 1.8 * s).life(rng.r(0.5, 0.8)).delay(rng.f() * 0.1)
          .col(p.smoke, 0.32, p.smoke, 0).spr(SPR.dust0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(1)).drag(2.6).fade(1, FO.sq, SC.out).emit();
      }
      fx.add.at(c.x + c.dx * L * 0.42, c.y + 0.1, c.z + c.dz * L * 0.42).size(L * 0.18, L * 0.26).life(0.7).delay(0.05).col(p.core, 0.9, p.main, 0).int(1.6 * I)
        .spr(SPR.rune0 + ((c.seed * 8) | 0)).mode(M.ground).rot(-c.rot).fade(0, FO.late).emit();
      sparks(fx, mx, c.y + 0.8, mz, fx.n(16), 5, 12, 0.5, 0.3, 0.6, 0.09, p.core, p.main, c.dx, c.dz, A / Math.PI * 2, 2.2, -3);
      fx.shake(0.25);
    },
  };
}

// ----------------------------------------------------------------------------------------------------------- frost ultimates

/** unit cast direction (writes LDX/LDZ); +Z when the caller gave none */
let LDX = 0;
let LDZ = 1;
function laneDir(c: Ctx): void {
  const l = Math.hypot(c.dx, c.dz);
  LDX = l > 1e-4 ? c.dx / l : 0;
  LDZ = l > 1e-4 ? c.dz / l : 1;
}

/** batched frost lance: shard spikes erupting down the lane behind a racing front, rime under them, an icy burst at the end */
function frostLaneBatched(fx: Fx, c: Ctx): void {
  const p = c.pal;
  const rng = fx.rng;
  const L = c.radius;
  const T = c.duration;
  const k = Math.min(1.4, L / 9);
  const travel = Math.min(0.45, Math.max(0.16, T * 0.2));
  laneDir(c);
  const sx = -LDZ;
  const sz = LDX;
  for (let i = 0, n = fx.n(30); i < n; i++) {
    const t = (i + rng.f()) / n;
    const off = rng.s2(1) * (0.4 + 1.5 * t) * k;
    const x = c.x + LDX * (0.7 + t * (L - 0.7)) + sx * off;
    const z = c.z + LDZ * (0.7 + t * (L - 0.7)) + sz * off;
    const y = gy(fx, c, x, z);
    const h = (0.5 + 2.6 * t * t) * k * rng.r(0.7, 1.2);
    const d = t * travel;
    const w = (0.12 + 0.2 * t) * k;
    fx.alp.at(x, y - 0.05, z).size(w, h).life(Math.max(0.5, T - d)).delay(d).stretch(1.7).col(p.main, 0.92, p.edge, 0.85).spr(SPR.shard).mode(M.upright).fade(0, FO.late, SC.out).emit();
    fx.add.at(x, y - 0.05, z).size(w, h * 0.9).life(Math.min(1.2, T - d)).delay(d).stretch(1.7).col(p.core, 0.8, p.main, 0).int(1.8).spr(SPR.shard).mode(M.upright).fade(0, FO.quad, SC.out).emit();
  }
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const x = c.x + LDX * t * L;
    const z = c.z + LDZ * t * L;
    fx.dec.ground(x, z, 0.02).disk((0.7 + 1.6 * t) * k).pat(PAT.frost).life(T + 2.5).delay(t * travel).col(p.core, 1, p.main, 0.85).fade(FO.late).seed(rng.f() * 9).emit();
    smoke(fx, x, gy(fx, c, x, z) + 0.2, z, fx.n(2), (0.5 + t) * k, 0.4, 1.2, 1.8, 0.8, 2.2, 0xdff2ff, 0.3, t * travel);
  }
  const ex = c.x + LDX * L;
  const ez = c.z + LDZ * L;
  const ey = gy(fx, c, ex, ez);
  flash(fx, ex, ey + 0.8, ez, 2.6 * k, 0.8 * k, 0.16, p.core, 2.6, travel);
  glow(fx, ex, ey + 0.8, ez, 5 * k, 2.4 * k, 0.45, p.main, 0.5, 1.2, travel);
  shockRing(fx, ex, ez, 4.4 * k, 0.6, p, 0.14, 1.7, travel);
  chunks(fx, ex, ey + 0.4, ez, fx.n(10), 6, 0.18 * k, p.core, p.main, 0.6, 1.2, ey, travel);
  for (let i = 0, n = fx.n(14); i < n; i++) glint(fx, ex + rng.s2(2 * k), ey + 0.3, ez + rng.s2(2 * k), rng.r(0.25, 0.45), rng.r(0.8, 1.4), 1.6, p.core, p.main, 2.2, travel + rng.r(0, 0.4));
}

function ultFrostLance(): PresetDef {
  return {
    id: 'ult.frostlance',
    cat: 'area',
    desc: 'Frost ultimate: a fracture front races from x,z along dir for `scale` metres (9) and a field of ice crystals tears up behind it — small and dense at the caster, a wall of blades at the end, a cluster at the impact — on a cracked rime lane, with mist, glitter and a cold burst; it holds, then shatters. duration = total (1.8).',
    size: 'radius',
    base: 9,
    palette: 'ice',
    variants: true,
    dur: 1.8,
    loop: false,
    demo: { dir: 1.25 },
    fire(fx, c) {
      if (castEl(fx, 'frost.lance', c, 0, 0)) return;
      frostLaneBatched(fx, c);
    },
  };
}

/** snow and ice streaks driven down over the radius for T seconds (slanted by the wind) */
function blizzardSnow(fx: Fx, c: Ctx, R: number, T: number): void {
  const p = c.pal;
  const rng = fx.rng;
  for (let i = 0, n = fx.n(26 + R * 6); i < n; i++) {
    spot(fx, c, 0, 1.05);
    const h = rng.r(6, 9);
    const tf = rng.r(0.35, 0.5);
    fx.add.at(PX - 2.2 * tf * 4, gy(fx, c, PX, PZ) + h, PZ - 1.2 * tf * 4).vel(8.8, -h / tf, 4.8).life(tf).delay(rng.r(0, T - tf * 0.5)).size(0.09, 0.05).stretch(0.05)
      .col(p.core, 0.95, p.main, 0.6).int(1.7).spr(SPR.streak).mode(M.streak).fade(0, FO.snap).emit();
  }
  for (let i = 0, n = fx.n(30 + R * 8); i < n; i++) {
    spot(fx, c, 0, 1.1);
    const life = rng.r(1.4, 2.2);
    const h = rng.r(2.5, 5);
    fx.alp.at(PX - 1.2, gy(fx, c, PX, PZ) + h, PZ - 0.6).vel(rng.r(1, 2.2), -h / life, rng.r(0.4, 1.2)).size(0.2, 0.28).life(life).delay(rng.r(0, T - 0.4))
      .col(0xf2faff, 0.9, p.main, 0.4).spr(SPR.snow0 + rng.i(2)).rot(rng.f() * TAU, rng.s2(2)).wob(0.35).fade(2, FO.late).emit();
  }
  for (let i = 0, n = fx.n(6 + R); i < n; i++) {
    spot(fx, c, 0.2, 1);
    cloudPuff(fx, 0xe8f6ff, p.main, PX, gy(fx, c, PX, PZ) + 0.4, PZ, 2.4 + R * 0.2, rng.r(1.6, 2.4), 0.26, 1.4, 0.7, 0.15, rng.r(0, T * 0.7));
  }
}

/** batched nova: rings of shard spikes erupting outward, rime, shock rings */
function frostNovaBatched(fx: Fx, c: Ctx, R: number, T: number): void {
  const p = c.pal;
  const rng = fx.rng;
  const s = Math.min(1.6, R / 4);
  shockRing(fx, c.x, c.z, R * 1.08, 0.7, p, 0.16, 1.9);
  shockRing(fx, c.x, c.z, R * 0.7, 0.55, p, 0.1, 1.3, 0.06);
  flash(fx, c.x, c.y + 0.5, c.z, R * 0.4, R * 0.12, 0.16, p.core, 2.2);
  dustRing(fx, c.x, c.y, c.z, fx.n(12), R * 0.95, 0.9, 0xdff2ff, 0.45, 1.2);
  fx.dec.ground(c.x, c.z, 0.03).disk(R * 1.05).pat(PAT.frost).life(T + 2.5).col(p.core, 1, p.main, 0.9).fade(FO.late).seed(rng.f() * 9).emit();
  for (let ring = 0; ring < 3; ring++) {
    const rr = R * (0.42 + ring * 0.24);
    for (let i = 0, n = fx.n(7 + ring * 4); i < n; i++) {
      const a = (i / n) * TAU + rng.s2(0.25);
      const x = c.x + Math.sin(a) * rr;
      const z = c.z + Math.cos(a) * rr;
      const y = gy(fx, c, x, z);
      const h = (0.7 + ring * 0.45) * s * rng.r(0.75, 1.25);
      const d = 0.08 + ring * 0.1;
      fx.alp.at(x, y - 0.05, z).size(0.14 * s, h).life(Math.max(0.8, T - d)).delay(d).stretch(1.7).col(p.main, 0.92, p.edge, 0.85).spr(SPR.shard).mode(M.upright).fade(0, FO.late, SC.out).emit();
      fx.add.at(x, y - 0.05, z).size(0.14 * s, h * 0.9).life(1.1).delay(d).stretch(1.7).col(p.core, 0.8, p.main, 0).int(1.8).spr(SPR.shard).mode(M.upright).fade(0, FO.quad, SC.out).emit();
    }
  }
}

function ultBlizzard(): PresetDef {
  return {
    id: 'ult.blizzard',
    cat: 'area',
    desc: 'Blizzard ultimate: snow and ice streaks drive down over the radius (5.5) for `duration` (2) while a crown of ice blades erupts ring by ring on a rime sheet with a vapour dome and shock ring, stands, then shatters.',
    size: 'radius',
    base: 5.5,
    palette: 'ice',
    variants: true,
    dur: 2,
    loop: false,
    demo: {},
    fire(fx, c) {
      const R = c.radius;
      const T = c.duration;
      blizzardSnow(fx, c, R, T);
      // the crown (rime sheet, blades ring by ring, pressure lens): its front reaches the rim in 0.6 s and it stands for the rest
      // of the storm; the batched rings, spikes and rime decal stand in when the tier, budget or pool does not run it
      c.duration = 0.6;
      const sig = castEl(fx, 'frost.nova', c, Math.max(0.6, T - 0.6), 0);
      c.duration = T;
      if (!sig) frostNovaBatched(fx, c, R, T);
    },
  };
}

// ---------------------------------------------------------------------------------------------------- dragon-breath ultimate

/** The batched stand-in for the dragon-breath ultimate (the tier refused the volume): tinted fire, streaks and smoke laid out over the duration along the cone. */
function dragonBreathBatched(fx: Fx, c: Ctx, L: number, A: number, T: number): void {
  const p = c.pal;
  const rng = fx.rng;
  const I = c.intensity;
  const mx = c.x + c.dx * 0.5, mz = c.z + c.dz * 0.5, my = c.y + 0.9;
  for (let i = 0, n = fx.n(150); i < n; i++) {
    const ang = c.rot + rng.s2(A * 0.45);
    const D = L * (0.15 + 0.85 * rng.f());
    const tl = rng.r(0.45, 0.7);
    const v = (D * BREATH_DRAG) / (1 - Math.exp(-BREATH_DRAG * tl));
    const vx = Math.sin(ang) * v, vz = Math.cos(ang) * v;
    const dly = rng.f() * T * 0.85;
    const q = rng.f();
    const sz = 0.5 + D * 0.42;
    if (q < 0.5) {
      fx.add.at(mx, my, mz).vel(vx, rng.r(0.1, 0.6), vz).life(tl).delay(dly).size(sz * 0.4, sz).col(p.extra, 1, p.edge, 1).int(1.5 * I).spr(FB.fire).frames(16).ramp().rot(rng.f() * TAU, rng.s2(1)).drag(BREATH_DRAG).fade(0, FO.late).emit();
    } else if (q < 0.8) {
      fx.add.at(mx, my, mz).vel(vx * 1.3, rng.r(0.2, 1), vz * 1.3).life(tl * 0.7).delay(dly).size(0.1, 0.04).stretch(0.06).col(p.core, 1, p.main, 0).int(2.4 * I).spr(SPR.streak).mode(M.streak).drag(BREATH_DRAG).fade(0, FO.cubic).emit();
    } else {
      fx.alp.at(mx, my, mz).vel(vx * 0.8, rng.r(0.5, 1.2), vz * 0.8).life(tl * 1.5).delay(dly + 0.1).size(sz * 0.5, sz * 1.2).col(p.smoke, 0.35, p.smoke, 0).spr(SPR.smoke0 + rng.i(4)).rot(rng.f() * TAU, rng.s2(0.5)).drag(BREATH_DRAG).fade(2, FO.sq, SC.out).emit();
    }
  }
}

function ultDragonBreath(): PresetDef {
  return {
    id: 'ult.dragonbreath',
    cat: 'area',
    desc: 'Dragon-breath ultimate: a rune seal flares under the caster and a hollow cone of volumetric flame (a = full angle, default 0.9) pours along dir for `scale` metres (8) for `duration` (1.4) — embers, scorch burnt under it, smoke, and a shock ring and spray where it lands; flame, frost or toxic gas by palette.',
    size: 'radius',
    base: 8,
    palette: 'shamanGold',
    variants: true,
    dur: 1.4,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const L = c.radius;
      const A = c.a > 0 ? c.a : 0.9;
      const T = c.duration;
      const I = c.intensity;
      const sd = c.seed * 10;
      const ex = c.x + c.dx * L, ez = c.z + c.dz * L;
      const fy = fx.heightAt(ex, ez);
      // the heat flaring under the caster as the breath is drawn, and the lit wedge the gout throws on the floor
      fx.add.at(c.x, c.y + 0.1, c.z).size(3.2 * sk(c), 3.2 * sk(c)).life(T * 0.8).col(p.main, 0.8, p.edge, 0).int(1.2 * I).spr(SPR.glow).mode(M.ground).fade(0, FO.late).emit();
      fx.shp.ground(c.x, c.z, 0.06).yaw_(c.rot).arc(0.3, L, A * 0.9, -A * 0.45).pat(PAT.disk).expand(0.25).life(T + 0.4).col(p.main, 0.35, p.edge, 0.35).int(0.5 * I).fade(FO.late).seed(sd).emit();
      if (!castEl(fx, 'breath.dragon', c, A, 0)) {
        flash(fx, c.x + c.dx * 0.5, c.y + 0.9, c.z + c.dz * 0.5, 1.4, 0.5, 0.2, p.core, 3.0);
        fx.dec.ground(c.x, c.z, 0.03).yaw_(c.rot).arc(0.5, L * 0.97, A * 0.88, -A * 0.44).pat(PAT.scorch).expand(0.3).life(T + 2).col(p.main, 1, 0x100804, 0.6).int(0.5 * I).fade(FO.late).seed(sd).emit();
        dragonBreathBatched(fx, c, L, A, T);
      }
      // where it lands
      shockRing(fx, ex, ez, L * 0.3, 0.45, p, 0.15, 1.2, 0.15);
      flash(fx, ex, fy + 0.6, ez, 2.4, 1.0, 0.25, p.core, 2.4 * I, 0.12);
      sparks(fx, ex, fy + 0.5, ez, fx.n(18), 4, 10, 1.2, 0.3, 0.6, 0.09, p.core, p.main, -c.dx, -c.dz, 1.5, 2.2, -8, 0.12);
      fx.shake(0.2);
      fx.flash(((p.core >> 16) & 255) / 255, ((p.core >> 8) & 255) / 255, (p.core & 255) / 255, 0.06, 0.15);
    },
  };
}

export const ZONE_PRESETS: PresetDef[] = [
  fireZone(), poisonZone(), iceZone(), darkZone(), holyZone(), lightningZone(), windZone(), physicalZone(), runeZone(), cloudZone(), fireRingZone(), breathZone(), roarZone(),
  ultFrostLance(), ultBlizzard(), ultDragonBreath(),
];

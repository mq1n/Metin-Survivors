


// burst with light shafts, crossed light planes and glints for the chests. No hairline vector rings, no hard cylinder caps, no
// flat ellipse disc. Every sprite is an existing shipped one (./art.ts); ids are the contract (../README.md).
import type { Fx } from '../../emit';
import { PALETTES } from '../../palette';
import { mixHex } from '../../util';
import { FO, M, PAT, SC, SPR, TAU, chunks, cinders, dustRing, groundFlare, lightShaft, pillarCross } from '../../presets/kit';
import { KIT_ART } from '../kitArt';
import type { PresetDef } from '../../presets/types';
import { PK_ART } from './art';

const GRAV = -14;

/** gem colour wheel (chest.open.boss) */
const GEMS = [0xff4a5a, 0xff9a2e, 0xffe14a, 0x62e07a, 0x4ad8ff, 0x5a7aff, 0xc060ff] as const;

/** alpha-blended body under an additive burst: keeps the hue on snow / pale stone, where pure additive light turns pastel */
function underlay(fx: Fx, x: number, y: number, z: number, s0: number, s1: number, life: number, hex: number, a: number, delay = 0): void {
  fx.alp.at(x, y, z).size(s0, s1).life(life).delay(delay).col(hex, a, hex, 0).spr(SPR.glow).fade(0, FO.quad, SC.out).emit();
}





function glints(fx: Fx, x: number, y: number, z: number, n: number, radius: number, height: number, life0: number, life1: number, size: number, hex0: number, hex1: number, delay = 0, int = 2): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * radius;
    const sz = size * rng.r(0.6, 1.25);
    fx.add.at(x + Math.sin(a) * r, y + rng.r(0, height), z + Math.cos(a) * r).vel(rng.s2(0.08), rng.r(0.05, 0.3), rng.s2(0.08))
      .life(rng.r(life0, life1)).delay(delay + rng.r(0, life0 * 0.5)).size(sz * 0.25, sz).col(hex0, 1, hex1, 0).int(int)
      .art(i % 3 === 0 ? KIT_ART.glintPin : PK_ART.cross).rot(rng.s2(0.35), rng.s2(0.8)).twinkle().fade(1, FO.quad, SC.bell).emit();
  }
}

/** thrown coin / gem: a bright tumbling bit with a glint riding the arc and a twinkle waiting where it comes to rest */
function treasure(fx: Fx, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, hex0: number, hex1: number, glint: number, life: number, floorY: number, delay: number): void {
  const rest = 0.4;
  fx.db.at(x, y, z).vel(vx, vy, vz).sz(size).col(hex0, hex1).glow(0.9).bounce(rest).life(life).floor(floorY).delay(delay).emit();
  const tl = (vy + Math.sqrt(Math.max(vy * vy - 2 * GRAV * (y - floorY), 0))) / -GRAV;
  const vy1 = (vy + GRAV * tl) * -rest;
  const tb = vy1 > 0.2 ? (2 * vy1) / -GRAV : 0;
  // the glint riding the arc: a hot soft head (not a streak) so the thrown bit reads as a bright coin from the game camera
  fx.add.at(x, y, z).vel(vx, vy, vz).grav(GRAV).floor(floorY).life(tl + 0.05).delay(delay).size(size * 5, size * 3)
    .col(glint, 1, hex0, 0).int(2.0).art(PK_ART.core).fade(0, FO.quad).emit();
  const k = tb + 0.09;
  const rx = x + vx * tl + vx * 0.55 * k;
  const rz = z + vz * tl + vz * 0.55 * k;
  const t0 = tl + tb;
  fx.add.at(rx, floorY + 0.14, rz).size(size * 4, size * 8).life(Math.max(0.35, (life - t0) * 0.6)).delay(delay + t0)
    .col(glint, 1, glint, 0).int(2.2).art(PK_ART.cross).rot(0, 0.5).twinkle().fade(1, FO.quad, SC.bell).emit();
}







function coinFlight(fx: Fx, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, hex0: number, hex1: number, floorY: number, delay: number): { x: number; z: number; t: number } {
  let px = x, py = y, pz = z, qx = vx, qy = vy, qz = vz, t0 = delay;
  for (let hop = 0; hop < 2; hop++) {
    const tl = (qy + Math.sqrt(Math.max(qy * qy - 2 * GRAV * (py - floorY), 0))) / -GRAV;
    if (tl < 0.1) break;
    const n = Math.max(1, Math.round(tl / 0.34));
    const seg = tl / n;
    const spin = fx.rng.s2(1);
    for (let k = 0; k < n; k++) {
      const ts = k * seg;
      const last = hop === 1 && k === n - 1;
      // the last segment of the second hop fades out on the floor (nothing slides there), earlier ones stay bright through the cut
      fx.alp.at(px + qx * ts, py + qy * ts + 0.5 * GRAV * ts * ts, pz + qz * ts).vel(qx, qy + GRAV * ts, qz).grav(GRAV).floor(floorY + 0.06)
        .life(seg + 0.012).delay(t0 + ts).size(size, size).col(hex0, 1, hex1, 1).int(1.7).art(PK_ART.coin).rot(spin * 0.4, spin).fade(0, last ? FO.quad : FO.none).emit();
    }
    px += qx * tl; pz += qz * tl; py = floorY;
    t0 += tl;
    qy = -(qy + GRAV * tl) * 0.38;
    qx *= 0.55; qz *= 0.55;
  }
  return { x: px + qx * 0.12, z: pz + qz * 0.12, t: t0 };
}

/** a thrown gold coin with a faint warm halo riding the arc and a twinkle where it comes to rest */
function coin(fx: Fx, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, hex0: number, hex1: number, glint: number, life: number, floorY: number, delay: number): void {
  const end = coinFlight(fx, x, y, z, vx, vy, vz, size, hex0, hex1, floorY, delay);
  const tl = (vy + Math.sqrt(Math.max(vy * vy - 2 * GRAV * (y - floorY), 0))) / -GRAV;
  fx.add.at(x, y, z).vel(vx, vy, vz).grav(GRAV).floor(floorY).life(tl + 0.05).delay(delay).size(size * 2.6, size * 1.6)
    .col(hex1, 0.8, hex1, 0).int(1.4).art(PK_ART.core).fade(0, FO.quad).emit();
  fx.add.at(end.x, floorY + 0.14, end.z).size(size * 1.3, size * 3.4).life(Math.max(0.35, life - end.t)).delay(end.t)
    .col(glint, 1, glint, 0).int(2.1).art(PK_ART.cross).rot(0, 0.5).twinkle().fade(1, FO.quad, SC.bell).emit();
}

function pickupXp(): PresetDef {
  return {
    id: 'pickup.xp',
    cat: 'pickup',
    desc: '',
    size: 'mult',
    base: 0.5,
    palette: 'xp',
    dur: 0,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = c.pal;
      const rng = fx.rng;
      const s = c.scale;
      const x = c.x, y = c.y + 0.4 * s, z = c.z;
      underlay(fx, x, y, z, 0.5 * s, 1.5 * s, 0.26, mixHex(p.main, 0x000000, 0.45), 0.5);
      fx.add.at(x, y, z).size(0.5 * s, 1.3 * s).life(0.15).col(p.core, 1, p.main, 0).int(2.2).art(PK_ART.core).fade(0, FO.cubic, SC.out).emit();
      fx.add.at(x, y, z).size(0.8 * s, 2.3 * s).life(0.34).col(p.main, 0.9, p.edge, 0).int(1.5).art(PK_ART.burst).rot(rng.f() * TAU, rng.s2(1.4)).fade(0, FO.quad, SC.out).emit();
      fx.add.at(x, y, z).size(0.45 * s, 1.8 * s).life(0.3).col(p.core, 1, p.extra, 0).int(2.0).art(PK_ART.cross).rot(rng.s2(0.3), rng.s2(0.8)).fade(0, FO.quad).emit();
      for (let i = 0, n = fx.n(3); i < n; i++) {
        const a = rng.f() * TAU;
        const v = rng.r(2, 3.6) * s;
        fx.add.at(x, y, z).vel(Math.sin(a) * v, rng.r(0.6, 1.8) * s, Math.cos(a) * v).size(0.1 * s, 0.03).stretch(0.06).life(rng.r(0.16, 0.26)).drag(3.4).grav(-6)
          .col(p.core, 1, p.main, 0).int(2.2).spr(SPR.streak).mode(M.streak).fade(0, FO.cubic).emit();
      }
    },
  };
}

function pickupYeop(): PresetDef {
  return {
    id: 'pickup.yeop',
    cat: 'pickup',
    desc: '',
    size: 'mult',
    base: 0.5,
    palette: 'yeop',
    dur: 0,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = c.pal;
      const rng = fx.rng;
      const s = c.scale;
      const x = c.x, y = c.y + 0.4 * s, z = c.z;
      underlay(fx, x, y, z, 0.5 * s, 1.5 * s, 0.28, 0xa86a10, 0.45);
      fx.add.at(x, y, z).size(0.45 * s, 1.1 * s).life(0.14).col(p.core, 1, p.main, 0).int(2.2).art(PK_ART.core).fade(0, FO.cubic, SC.out).emit();
      // monround_1: a soft luminous ring that swells and fades (alpha 0 -> 0.4 -> 0 in the file); vfx_pickups_money_ring is its generated look
      fx.add.at(x, y, z).size(0.5 * s, 2.5 * s).life(0.5).col(p.main, 0.55, p.edge, 0).int(1.4).art(PK_ART.moneyRing).fade(1, FO.quad, SC.out).emit();
      fx.add.at(x, y, z).size(0.5 * s, 1.8 * s).life(0.32).col(p.core, 1, p.main, 0).int(2.1).art(PK_ART.cross).rot(rng.s2(0.4), rng.s2(1.6)).fade(0, FO.quad).emit();
      for (let i = 0, n = fx.n(3); i < n; i++) {
        const a = rng.f() * TAU;
        const v = rng.r(0.8, 1.8) * s;
        fx.add.at(x, y, z).vel(Math.sin(a) * v, rng.r(3, 4.6) * s, Math.cos(a) * v).size(0.22 * s, 0.1 * s).life(rng.r(0.3, 0.45)).drag(0.8).grav(-12)
          .col(p.core, 1, p.edge, 0).int(2.2).art(PK_ART.core).fade(0, FO.quad).emit();
      }
      fx.add.at(x + rng.s2(0.25 * s), y + 0.2 * s, z + rng.s2(0.25 * s)).size(0.25 * s, 0.9 * s).life(0.34).delay(0.07).col(p.core, 1, p.main, 0).int(2.0)
        .art(PK_ART.cross).rot(0.3).twinkle().fade(0, FO.quad, SC.bell).emit();
    },
  };
}

function pickupHeal(): PresetDef {
  return {
    id: 'pickup.heal',
    cat: 'pickup',
    desc: 'DEPRECATED (never fired: the potion plays sk.gen.potion_red; the core deletes this id). Soft cream-green light column, a monround pulse and rising glints.',
    size: 'mult',
    base: 1,
    palette: 'heal',
    dur: 0,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = c.pal;
      const rng = fx.rng;
      const s = c.scale;
      const x = c.x, y = c.y, z = c.z;
      fx.add.at(x, y + 0.6 * s, z).size(0.8 * s, 2.6 * s).life(0.2).col(p.core, 1, p.main, 0).int(2.2).art(PK_ART.core).fade(0, FO.cubic, SC.out).emit();
      fx.add.at(x, y, z).size(1.4 * s, 1.4 * s).stretch(1.6).life(0.8).col(p.core, 0.8, p.main, 0).int(1.4).art(PK_ART.rise).mode(M.upright).fade(1, FO.quad).emit();
      fx.add.at(x, fx.heightAt(x, z) + 0.06, z).size(0.5 * s, 3.2 * s).life(0.6).col(p.main, 0.7, p.edge, 0).int(1.3).art(PK_ART.monround).mode(M.ground).fade(1, FO.quad, SC.out).emit();
      glints(fx, x, y + 0.2 * s, z, fx.n(6), 0.8 * s, 1.6 * s, 0.5, 0.9, 0.8 * s, p.core, p.extra, 0.05, 2);
    },
  };
}

function pickupMagnet(): PresetDef {
  return {
    id: 'pickup.magnet',
    cat: 'pickup',
    desc: '',
    size: 'mult',
    base: 1,
    palette: 'xp',
    dur: 0,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = c.pal;
      const rng = fx.rng;
      const s = c.scale;
      const R = 9 * s;
      const x = c.x, y = c.y, z = c.z;
      const gy = fx.heightAt(x, z) + 0.06;
      underlay(fx, x, y + 0.6, z, 2.2 * s, 6.0 * s, 0.5, 0x1c4a8a, 0.5);
      fx.add.at(x, y + 0.7, z).size(0.8 * s, 3.2 * s).life(0.22).col(p.core, 1, p.main, 0).int(2.3).art(PK_ART.core).fade(0, FO.cubic, SC.out).emit();
      fx.add.at(x, y + 0.7, z).size(1.2 * s, 4.6 * s).life(0.4).col(p.main, 0.8, p.edge, 0).int(1.5).art(PK_ART.burst).rot(rng.f() * TAU, 1.1).fade(0, FO.quad, SC.out).emit();
      // the absorb: two soft grainy bands sweeping out over the ground, and a vortex of arms that shrinks into the hero
      fx.add.at(x, gy, z).size(R * 0.4, R * 2).life(0.8).col(p.main, 0.9, p.edge, 0).int(1.6).art(PK_ART.waveGrain).mode(M.ground).rot(rng.f() * TAU, 0.4).fade(1, FO.quad, SC.out).emit();
      fx.add.at(x, gy, z).size(R * 0.3, R * 1.5).life(0.65).delay(0.07).col(p.extra, 0.6, p.main, 0).int(1.4).art(PK_ART.monround).mode(M.ground).fade(1, FO.quad, SC.out).emit();
      fx.add.at(x, gy, z).size(R * 1.9, R * 0.2).life(0.85).col(p.core, 0.75, p.main, 0).int(1.6).art(PK_ART.vortex).mode(M.ground).rot(rng.f() * TAU, -5).fade(1, FO.sq, SC.in).emit();
      for (let i = 0, n = fx.n(26); i < n; i++) {
        const a = rng.f() * TAU;
        const rr = rng.r(2.4, R * 0.95);
        const v = Math.min(rr * 2.8, 18);
        const tang = v * 0.4 * (i % 2 === 0 ? 1 : -1);
        const ix = -Math.sin(a), iz = -Math.cos(a);
        fx.add.at(x + Math.sin(a) * rr, y + 0.35, z + Math.cos(a) * rr).vel(ix * v + Math.cos(a) * tang, 0, iz * v - Math.sin(a) * tang).drag(2.0)
          .size(0.12 * s, 0.03).stretch(0.08).life(rng.r(0.28, 0.45)).delay((rr / R) * 0.5 + rng.r(0, 0.08))
          .col(p.core, 1, p.main, 0).int(2.1).spr(SPR.streak).mode(M.streak).fade(0, FO.cubic).emit();
      }
      for (let i = 0, n = fx.n(7); i < n; i++) {
        const a = rng.f() * TAU;
        fx.add.at(x + Math.sin(a) * 1.5, y + 0.5, z + Math.cos(a) * 1.5).vel(-Math.sin(a) * 3.2, 0.6, -Math.cos(a) * 3.2).size(0.3 * s, 1.0 * s).life(0.32).delay(0.2 + i * 0.03)
          .col(p.core, 1, p.main, 0).int(2.2).art(PK_ART.cross).rot(rng.f() * 0.5).twinkle().fade(0, FO.quad, SC.bell).emit();
      }
      fx.add.at(x, y + 0.7, z).size(0.5 * s, 2.6 * s).life(0.22).delay(0.36).col(p.core, 1, p.extra, 0).int(2.0).art(PK_ART.crossHalo).fade(0, FO.quad, SC.out).emit();
    },
  };
}

function pickupShard(): PresetDef {
  return {
    id: 'pickup.shard',
    cat: 'pickup',
    desc: 'Metin shard collected (the sim never emits it; kept until the core removes the id): hot core, starburst, a prismatic cross glint, crystal bits and rising glints.',
    size: 'mult',
    base: 0.8,
    palette: 'metin',
    dur: 0,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = c.pal;
      const rng = fx.rng;
      const s = c.scale;
      const x = c.x, y = c.y + 0.45 * s, z = c.z;
      underlay(fx, x, y, z, 0.8 * s, 2.4 * s, 0.34, 0x233a80, 0.45);
      fx.add.at(x, y, z).size(0.7 * s, 1.7 * s).life(0.16).col(p.core, 1, p.main, 0).int(2.2).art(PK_ART.core).fade(0, FO.cubic, SC.out).emit();
      fx.add.at(x, y, z).size(1.1 * s, 3.2 * s).life(0.38).col(p.main, 0.9, p.edge, 0).int(1.5).art(PK_ART.burst).rot(rng.f() * TAU, 1.2).fade(0, FO.quad, SC.out).emit();
      fx.add.at(x, y, z).size(0.7 * s, 2.6 * s).life(0.34).col(p.core, 1, p.extra, 0).int(2.0).art(PK_ART.crossHalo).rot(0.2, -0.6).fade(0, FO.quad).emit();
      for (let i = 0, n = fx.n(6); i < n; i++) {
        const a = (i / 6) * TAU + rng.s2(0.4);
        const v = rng.r(2.2, 4.2) * s;
        fx.add.at(x, y, z).vel(Math.sin(a) * v, rng.r(1.8, 4) * s, Math.cos(a) * v).size(0.3 * s * rng.r(0.7, 1.2), 0.1 * s).life(rng.r(0.4, 0.7)).drag(1.2).grav(-8)
          .col(i % 2 === 0 ? p.core : p.main, 1, p.edge, 0).int(2.2).spr(SPR.shard).rot(rng.f() * TAU, rng.s2(9)).fade(0, FO.quad).emit();
      }
      glints(fx, x, y, z, fx.n(5), 0.7 * s, 1.2 * s, 0.5, 0.9, 0.7 * s, p.core, p.extra, 0.05, 2.1);
      chunks(fx, x, y, z, fx.n(3), 3.2 * s, 0.07 * s, p.core, p.main, 1, 1, c.y);
    },
  };
}

function chestOpen(): PresetDef {
  return {
    id: 'chest.open',
    cat: 'pickup',
    desc: 'Chest opens: warm hot core + fine-spoke starburst, light shafts and a soft crossed-plane column, a flat spike flare on the floor, a fountain of streaks, glints, a coin / gem spray bouncing with glints, cinders.',
    size: 'mult',
    base: 1.6,
    palette: 'yeop',
    dur: 0,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = c.pal;
      const rng = fx.rng;
      const s = c.scale;
      const x = c.x, y = c.y, z = c.z;
      const top = y + 0.7 * s;
      underlay(fx, x, top, z, 2.2 * s, 5.2 * s, 0.7, 0x8a5208, 0.4);
      fx.add.at(x, top, z).size(0.8 * s, 2.6 * s).life(0.22).col(0xffd98a, 0.9, p.main, 0).int(1.5).art(PK_ART.core).fade(0, FO.cubic, SC.out).emit();
      fx.add.at(x, top, z).size(2.2 * s, 7.2 * s).life(0.55).col(p.main, 0.85, p.edge, 0).int(1.5).art(PK_ART.chestBurst).rot(rng.s2(0.25), rng.s2(0.35)).fade(0, FO.quad, SC.out).emit();
      fx.add.at(x, top, z).size(1.0 * s, 3.4 * s).life(0.4).delay(0.04).col(p.main, 0.6, p.edge, 0).int(1.3).art(PK_ART.burst).rot(rng.f() * TAU, 0.5).fade(0, FO.quad, SC.out).emit();
      fx.add.at(x, top, z).size(1.0 * s, 3.8 * s).life(0.4).col(p.main, 0.85, p.extra, 0).int(1.5).art(PK_ART.crossHalo).rot(0.1, 0.6).fade(0, FO.quad).emit();
      groundFlare(fx, x, z, 3.2 * s, 0.7, p.main, 1.2);
      fx.add.at(x, y, z).size(3.0 * s, 3.0 * s).stretch(1.15).life(0.75).col(p.main, 0.85, p.edge, 0).int(1.5).art(PK_ART.spray).mode(M.upright).fade(0, FO.quad).emit();
      lightShaft(fx, x, y, z, 2.6 * s, 5.4 * s, 1.15, p.main, 0.8, 1.5);
      pillarCross(fx, x, z, 1.1 * s, 6.5 * s, 0.85, p, 1.1, 0.02, 3);
      glints(fx, x, top, z, fx.n(14), 1.8 * s, 2.4 * s, 0.5, 1.0, 0.95 * s, p.core, p.main, 0.08, 2.2);
      for (let i = 0, n = fx.n(12); i < n; i++) {
        const a = rng.f() * TAU;
        const v = rng.r(2.2, 5) * s;
        const gem = i % 5 === 4;
        if (gem) {
          const hex = GEMS[rng.i(7)] as number;
          treasure(fx, x, top, z, Math.sin(a) * v, rng.r(5, 8.5), Math.cos(a) * v, 0.2 * s, hex, hex, 0xffffff, 1.7, y, rng.r(0, 0.08));
        } else {
          coin(fx, x, top, z, Math.sin(a) * v, rng.r(5, 8.5), Math.cos(a) * v, 0.46 * s, 0xffd54a, 0xe0a020, 0xfff0a0, 1.7, y, rng.r(0, 0.08));
        }
      }
      cinders(fx, x, top, z, fx.n(8), 1.2 * s, 1.5, 1.0, 1.8, 0.2 * s, p.core, 0xe0701a, 0.1, 2);
      dustRing(fx, x, y, z, fx.n(5), 2.2 * s, 0.6, PALETTES.dust.main, 0.3, 0.9 * s);
    },
  };
}

function chestBoss(): PresetDef {
  return {
    id: 'chest.open.boss',
    cat: 'pickup',
    desc: 'Boss chest: a bigger warm burst (starburst, shafts, three light planes, floor flare), a soft gem-coloured band, the gold rune on the floor, a gem-coloured treasure spray and a long spiralling glint tail (~2 s).',
    size: 'mult',
    base: 2.4,
    palette: 'yeop',
    dur: 0,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = c.pal;
      const rng = fx.rng;
      const s = c.scale;
      const x = c.x, y = c.y, z = c.z;
      const top = y + 0.9 * s;
      underlay(fx, x, top, z, 3.4 * s, 8.4 * s, 0.9, 0x8a5208, 0.4);
      fx.add.at(x, top, z).size(1.3 * s, 4.2 * s).life(0.26).col(0xffd98a, 0.9, p.main, 0).int(1.5).art(PK_ART.core).fade(0, FO.cubic, SC.out).emit();
      fx.add.at(x, top, z).size(3.4 * s, 10.5 * s).life(0.65).col(p.main, 0.85, p.edge, 0).int(1.5).art(PK_ART.chestBurst).rot(rng.s2(0.25), rng.s2(0.3)).fade(0, FO.quad, SC.out).emit();
      fx.add.at(x, top, z).size(1.6 * s, 5.4 * s).life(0.45).delay(0.04).col(p.main, 0.6, p.edge, 0).int(1.3).art(PK_ART.burst).rot(rng.f() * TAU, 0.45).fade(0, FO.quad, SC.out).emit();
      fx.add.at(x, top, z).size(1.6 * s, 5.6 * s).life(0.5).col(p.main, 0.85, p.extra, 0).int(1.5).art(PK_ART.crossHalo).rot(0.15, 0.5).fade(0, FO.quad).emit();
      groundFlare(fx, x, z, 5.2 * s, 0.95, p.main, 1.3);
      groundFlare(fx, x, z, 3.2 * s, 0.7, p.core, 1.0, 0.08);
      fx.add.at(x, y, z).size(4.8 * s, 4.8 * s).stretch(1.2).life(0.95).col(p.main, 0.9, p.edge, 0).int(1.6).art(PK_ART.spray).mode(M.upright).fade(0, FO.quad).emit();
      lightShaft(fx, x, y, z, 4.4 * s, 8.4 * s, 1.5, p.main, 0.85, 1.55);
      pillarCross(fx, x, z, 1.7 * s, 9 * s, 1.1, p, 1.1, 0.02, 3);
      pillarCross(fx, x, z, 0.9 * s, 10 * s, 0.7, PALETTES.warriorWhite, 0.8, 0.07, 2);
      // the gem colours: a soft rainbow band swelling out (a sprite band, not seven hairline rings) + seven staggered gem glints
      fx.add.at(x, top, z).size(1.2 * s, 7.4 * s).life(0.75).col(0xffffff, 0.5, 0xffffff, 0).int(1.3).art(PK_ART.rainbow).fade(1, FO.quad, SC.out).emit();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * TAU + 0.3;
        fx.add.at(x + Math.sin(a) * 1.6 * s, top + 0.4 * s, z + Math.cos(a) * 1.6 * s).vel(Math.sin(a) * 1.1, 0.6, Math.cos(a) * 1.1).size(0.5 * s, 2.2 * s).life(0.55).delay(0.1 + k * 0.05)
          .col(GEMS[k] as number, 1, GEMS[k] as number, 0).int(2.2).art(PK_ART.cross).rot(rng.f() * 0.5).twinkle().fade(0, FO.quad, SC.bell).emit();
      }
      fx.shp.ground(x, z, 0.05).disk(2.8 * s).pat(PAT.rune).life(2).col(p.main, 0.85, p.edge, 0.85).int(1.3).fade(FO.late).seed(c.seed * 9).emit();
      glints(fx, x, top, z, fx.n(22), 3.0 * s, 3.6 * s, 0.6, 1.3, 1.15 * s, p.core, p.main, 0.1, 2.3);
      for (let i = 0, n = fx.n(16); i < n; i++) {
        const a = rng.f() * TAU;
        const v = rng.r(2.6, 6.4) * s;
        const hex = GEMS[i % 7] as number;
        if (i % 2 === 0) treasure(fx, x, top, z, Math.sin(a) * v, rng.r(6, 10), Math.cos(a) * v, 0.22 * s, hex, mixHex(hex, 0x000000, 0.35), hex, 2.2, y, rng.r(0, 0.12));
        else coin(fx, x, top, z, Math.sin(a) * v, rng.r(6, 10), Math.cos(a) * v, 0.5 * s, 0xffd54a, 0xe0a020, 0xfff0a0, 2.2, y, rng.r(0, 0.12));
      }
      for (let i = 0, n = fx.n(16); i < n; i++) {
        const a = (i / 16) * TAU * 2;
        const r = 0.3 + (i / 16) * 1.5;
        fx.add.at(x + Math.sin(a) * r * s, y + 0.2, z + Math.cos(a) * r * s).vel(Math.sin(a + 1.5) * 0.5, rng.r(1.4, 2.6), Math.cos(a + 1.5) * 0.5).size(0.4 * s, 1.5 * s).life(rng.r(1.2, 2)).delay(0.1 + i * 0.04)
          .col(GEMS[i % 7] as number, 1, p.main, 0).int(2.2).art(PK_ART.cross).rot(rng.f() * TAU, rng.s2(1.2)).twinkle().wob(0.2).fade(1, FO.quad).emit();
      }
      cinders(fx, x, top, z, fx.n(10), 1.6 * s, 1.6, 1.2, 2.2, 0.24 * s, p.core, 0xe0701a, 0.1, 2);
      dustRing(fx, x, y, z, fx.n(8), 3.2 * s, 0.7, PALETTES.dust.main, 0.35, 1.2 * s);
      fx.shake(0.2);
    },
  };
}

export const presets: PresetDef[] = [
  pickupXp(),
  pickupYeop(),
  pickupHeal(),
  pickupMagnet(),
  pickupShard(),
  chestOpen(),
  chestBoss(),
];

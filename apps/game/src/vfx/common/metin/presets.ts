// Metin stone classic presets (common VFX target `metin`; owner: the metin builder): the falling-stone trail, the impact ground / debris
// companion of sk.gen.metin_crash, the awaken burst, the shatter / essence reveal companion of sk.gen.metin_break, plus the unwired
// aura / pulse presets (kept: ids are the contract, the core removes dead ones). Rebuilt r1 (2026-10-19): sprites of ./art.ts through
// PBuilder.art, soft kit helpers (crater, crackHeat, groundFlare, dustRing, rocks, glints, lightShaft, pillarCross), no marbled crack slab,


import type { Ctx, Fx } from '../../emit';
import { PALETTES, type Palette } from '../../palette';
import type { Inst } from '../../system';
import { mixHex } from '../../util';
import { FO, M, PAT, SC, SPR, TAU, crater, dustRing, embers, flash, glints, glow, groundFlare, haloRing, lightShaft, pillarCross, rocks, runeMotes, scorch, shockRing, smoke, smokeBurst, sparks, wisps } from '../../presets/kit';
import type { PresetDef } from '../../presets/types';
import { MA } from './art';

const DUST = PALETTES.dust.main;

/** `rocks()` throws chunks up at a speed proportional to its `speed` argument (vy up to 1.4x): uncapped, a great metin's chunks (R ~ 10 m) left at 26 m/s and hung 20 m up in front of
 *  the camera as 4 m boulders (seen in the seori break sheet, r1). Capped, the highest chunk of any stone peaks at ~5 m. */
const ROCK_SPEED_MAX = 8.5;

/** height the render layer drops the metin stone from */
const FALL_H = 75;

/** scratch palette for the blood-red variants (written by `redden`, consumed synchronously by the caller) */
const WARM: Palette = { main: 0, core: 0, edge: 0, smoke: 0, extra: 0 };

/** pushes a rune palette toward blood red (awakened stones) */
function redden(src: Palette, k: number): Palette {
  WARM.main = mixHex(src.main, 0xe01228, k);
  WARM.core = mixHex(src.core, 0xff9a84, k);
  WARM.edge = mixHex(src.edge, 0x60061a, k);
  WARM.smoke = 0x16070c;
  WARM.extra = mixHex(src.extra, 0xff8a40, k);
  return WARM;
}

/** screen tint hook from a 0xRRGGBB colour (the kit clamps the alpha). The flash quad is full screen and the post pass lifts it, so alpha 0.08 already moved
 *  half of a 1080p frame by > 12/255 at its first frame (coverage budget: <= 25 %): keep it <= 0.04, a warm kick, never a wash. */
function tint(fx: Fx, hex: number, a: number, dur: number): void {
  fx.flash(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, a, dur);
}

/** negative start offset so very long (pinned) shapes skip their slow fade-in (2.5 % of the lifetime) */
function lead(life: number): number {
  return Math.min(0, 0.3 - 0.025 * life);
}

/** ground rune seal (additive) */
function runeCircle(fx: Fx, x: number, z: number, R: number, life: number, c0: number, c1: number, int: number, delay = 0, expand = 1, spin = 0.25, fade: number = FO.late): number {
  return fx.shp.ground(x, z, 0.05).disk(R).pat(PAT.rune).expand(expand).spin(spin).life(life).delay(delay).col(c0, 1, c1, 1).int(int).fade(fade).seed(fx.rng.f() * 10).emit();
}

/** hot ground cracks that cool (PAT.crackHeat alone: hairline red seams, no brown scar sprite under them) */
function hotCracks(fx: Fx, x: number, z: number, r: number, life: number, darkHex: number, glowHex: number, int = 1.2, delay = 0): void {
  fx.dec.ground(x, z, 0.025).disk(r).pat(PAT.crackHeat).life(life).delay(delay).col(glowHex, 1, darkHex, 0.92).int(int).fade(FO.late).seed(fx.rng.f() * 10).emit();
}

/** hot stone chips thrown up and landing (alpha rock sprites, orange at the break edge cooling to dark rock; each lives only until it is back on the floor) */
function hotChips(fx: Fx, x: number, y: number, z: number, n: number, speed: number, size: number, life: number, delay = 0): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const v = speed * rng.r(0.35, 1);
    const vy = rng.r(2.2, 5.2);
    const fall = (2 * vy) / 9.8;
    fx.alp.at(x, y, z).vel(Math.sin(a) * v, vy, Math.cos(a) * v).size(size * rng.r(0.6, 1.25)).life(Math.min(life * rng.r(0.7, 1), fall * 0.92)).delay(delay)
      .col(0xffa050, 1, 0x2a1a10, 1).art(MA.rockLumpy).rot(rng.f() * TAU, rng.s2(9)).grav(-9.8).fade(0, FO.snap).emit();
  }
}

/** smoke masses boiling up from a disc of radius `r` (alpha billboards of the generated smoke sprites) */
function boil(fx: Fx, x: number, y: number, z: number, n: number, r: number, rise: number, life0: number, life1: number, s0: number, s1: number, hex0: number, hex1: number, a: number, delay = 0): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const ang = rng.f() * TAU;
    const rr = Math.sqrt(rng.f()) * r;
    fx.alp.at(x + Math.sin(ang) * rr, y + 0.25, z + Math.cos(ang) * rr).vel(rng.s2(0.5), rise * rng.r(0.6, 1.2), rng.s2(0.5)).life(rng.r(life0, life1)).delay(delay + rng.r(0, 0.08))
      .size(s0 * rng.r(0.8, 1.2), s1 * rng.r(0.85, 1.25)).col(hex0, a, hex1, 0).art(rng.f() < 0.65 ? MA.smokeBall : MA.dustClump)
      .rot(rng.f() * TAU, rng.s2(0.9)).drag(1.1).fade(1, FO.sq, SC.out).emit();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// FALL: the sky trail of the dropping stone (the ground column is sk.gen.metin_drop)

function metinFall(): PresetDef {
  return {
    id: 'metin.fall',
    cat: 'metin',
    desc: 'Metin drop trail: a burning meteor column - white-hot flame head, long orange fire streak and dark brown smoke streaming up behind the stone, sparks and chips flung off, dust kicked up as it arrives. Follows y = 75 (1 - t/D)^2.2 like the stone model.',
    size: 'mult',
    base: 1,
    palette: 'metin',
    dur: 2.0,
    loop: false,
    demo: {},
    fire(fx, c) {
      const rng = fx.rng;
      const s = c.scale;
      const D = c.duration;
      const { x, y, z } = c;
      // samples along the visible part of the path, constant spacing in height: the stone is ~60 m/s at the top of the frame and ~6 m/s at the
      // ground, so a fixed puff life gives a long fire streak while it is fast and a compact fireball when it lands
      const NT = fx.n(30);
      for (let i = 0; i < NT; i++) {
        const k = (i + 0.5) / NT;
        const h = 1 + 46 * Math.pow(k, 1.2);
        const t = D * (1 - Math.pow(h / FALL_H, 1 / 2.2));
        const yy = y + h + 0.8 * s;
        const jx = rng.s2(0.3 * s);
        const jz = rng.s2(0.3 * s);
        // flame head / fire streak (additive, white-hot -> orange -> red)
        fx.add.at(x + jx, yy, z + jz).vel(rng.s2(0.5), rng.r(1.5, 3.5), rng.s2(0.5)).size(2.5 * s, 3.9 * s).life(rng.r(0.4, 0.55)).delay(t)
          .col(0xfff0c8, 1, 0xc84a14, 0).int(1.45).art(MA.flameBlob).rot(rng.f() * TAU, rng.s2(2.5)).drag(0.6).fade(0, FO.late, SC.out).emit();
        if ((i & 1) === 0) {
          fx.add.at(x + jx * 1.4, yy + 0.6 * s, z + jz * 1.4).vel(0, rng.r(2, 4), 0).size(1.5 * s, 3.4 * s).life(rng.r(0.3, 0.45)).delay(t)
            .col(0xffe0a0, 1, 0xff5a18, 0).int(1.5).art(MA.flameTongues).mode(M.upright).wob(0.1).fade(0, FO.quad).emit();
        }
        // dark brown smoke streaming up behind it (alpha: stays dark on snow)
        fx.alp.at(x + jx * 1.8, yy + 0.2 * s, z + jz * 1.8).vel(rng.s2(0.7), rng.r(2.5, 4.8), rng.s2(0.7)).size(2.2 * s, 5.4 * s).life(rng.r(1.0, 1.55)).delay(t + 0.05)
          .col(0x5a3418, 0.62, 0x1c1008, 0).art(rng.f() < 0.6 ? MA.smokeBall : MA.dustClump).rot(rng.f() * TAU, rng.s2(0.8)).drag(0.9).fade(1, FO.sq, SC.out).emit();
        // hot glow round the head (soft, additive: the light the stone throws on the smoke)
        if (i % 3 === 0) glow(fx, x, yy, z, 4.2 * s, 1.4 * s, 0.32, 0xff8a30, 0.5, 1.2, t);
        // stone chips and sparks flung off
        if ((i & 1) === 1) {
          fx.alp.at(x + jx, yy, z + jz).vel(rng.s2(3.2), rng.r(0.5, 3.5), rng.s2(3.2)).size(0.34 * s).life(rng.r(0.5, 0.85)).delay(t)
            .col(0xffa050, 1, 0x3a2012, 1).art(MA.rockLumpy).rot(rng.f() * TAU, rng.s2(9)).grav(-9).fade(0, FO.snap).emit();
        }
        fx.add.at(x + jx * 2, yy, z + jz * 2).vel(rng.s2(1.2), rng.r(8, 15), rng.s2(1.2)).size(0.14 * s, 0.05).stretch(0.1).life(rng.r(0.18, 0.34)).delay(t)
          .col(0xfff0b8, 1, 0xff7a1a, 0).int(2.2).spr(SPR.streak).mode(M.streak).fade(0, FO.cubic).emit();
      }
      // the ground answers the arriving stone: dust kicked out, embers lifted
      dustRing(fx, x, y, z, fx.n(14), 3.2 * s, 0.7, DUST, 0.4, 1.0 * s, D * 0.86);
      for (let i = 0, n = fx.n(10); i < n; i++) embers(fx, x, y, z, 1, 2.4 * s, 3.5, 0.8, 1.4, 0.2 * s, 0xffc070, 0xc84a14, D * rng.r(0.5, 0.95));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// IMPACT: ground scar, dust wall and debris around sk.gen.metin_crash (the smoke ball + hot ring are the spec)

function metinImpact(): PresetDef {
  return {
    id: 'metin.impact',
    cat: 'metin',
    desc: 'Metin crash companion: brown dust wall thrown out along the ground, rock and hot chips flung up, a hot radial flare on the floor, a crater with cooling cracks and soot that stays under the stone. a = 1 great.',
    size: 'radius',
    base: 3.2,
    palette: 'metin',
    dur: 1.4,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = c.pal;
      const R = c.radius;
      const s = R / 3.2;
      /** debris / chip size: grows with the stone but stays a rock, not a boulder, for the great metin */
      const ds = Math.min(s, 1.5);
      const big = c.a >= 1 ? 1 : 0;
      const { x, y, z } = c;
      // a hot orange slam (kit clamps the intensity: never a white-out)
      flash(fx, x, y + 0.9 * s, z, R * 0.5, R * 0.18, 0.1, 0xffa860, 1.5);
      groundFlare(fx, x, z, R * 1.05, 0.5, 0xff8a40, 1.0);
      // ground scar: crater pit + lip and a soot scorch with a hot rim that cools (stays under the stone for ~12 s)
      crater(fx, x, z, R * 0.62, 14, 0x140c08, 0x8a7860);
      scorch(fx, x, z, R * 0.8, 12, 0x0c0806, 0x4a2410);
      // brown dust wall rolling out along the ground (the dust-ring crash)
      dustRing(fx, x, y, z, fx.n(22 + 8 * big), R * 1.55, 1.0, 0xa89070, 0.7, 1.75 * s);
      dustRing(fx, x, y, z, fx.n(12), R * 1.0, 0.8, 0x8a7458, 0.55, 1.3 * s, 0.06);
      boil(fx, x, y, z, fx.n(8 + 4 * big), R * 0.5, 1.8, 1.0, 1.7, 1.6 * s, 3.4 * s, 0x4a2418, 0x1a0e0a, 0.6, 0.04);
      smokeBurst(fx, x, y + 0.7 * s, z, R * 0.95, 1.5, 0x8a6a50, 0x2a1a14, 0.7, 0.08, 1.1);
      // debris
      rocks(fx, x, y + 0.4, z, fx.n(7 + 4 * big), Math.min(R * 1.7, ROCK_SPEED_MAX), 0.55 * ds, 1.3, y, 0xb09a82);
      hotChips(fx, x, y + 0.4, z, fx.n(12 + 6 * big), R * 1.9, 0.26 * ds, 1.2);
      sparks(fx, x, y + 0.4, z, fx.n(24), R * 1.3, R * 3.0, 1.4, 0.35, 0.75, 0.13 * s, 0xfff0b0, 0xff4a10, 0, 0, 1, 2.4, -9);
      embers(fx, x, y, z, fx.n(14), R * 0.9, 3.2, 0.9, 1.7, 0.2 * s, 0xffb060, 0xc84a14, 0.06);
      // a faint rune-coloured breath of the stone's own energy settling on the floor (keeps the stone's colour in the first second)
      glow(fx, x, y + 0.5 * s, z, R * 1.5, R * 0.9, 0.9, p.main, 0.28, 1.1, 0.1);
      tint(fx, 0xff8a40, 0.03, 0.18);
    },
  };
}

/** pinned ground / pillar shapes of a living stone; follow the instance */
function auraBuild(fx: Fx, c: Ctx, awk: boolean): void {
  const inst = c as Inst;
  const s = c.scale;
  const p = awk ? redden(c.pal, 0.78) : c.pal;
  const L = c.duration + 1;
  const d0 = lead(L);
  const Rc = 3.4 * s;
  const sd = c.seed * 10;
  inst.own(fx.shp.ground(c.x, c.z, 0.05).disk(Rc).pat(PAT.rune).spin(awk ? -0.55 : 0.25).life(L).delay(d0).col(p.main, 1, p.edge, 1).int(awk ? 1.5 : 1.2).fade(FO.late).seed(sd).pinned().emit(), 0);
  inst.own(fx.shp.ground(c.x, c.z, 0.045).disk(Rc * 0.62).pat(PAT.arcane).spin(awk ? 0.9 : -0.5).life(L).delay(d0).col(p.main, 0.8, p.edge, 0.8).int(0.8).fade(FO.late).seed(sd + 2).pinned().emit(), 0);
  inst.own(fx.shp.ground(c.x, c.z, 0.04).ring(Rc * 0.9, Rc * 1.1).pat(PAT.band).life(L).delay(d0).col(p.main, 0.9, p.edge, 0.9).int(awk ? 1.2 : 0.9).fade(FO.late).seed(sd + 4).pinned().emit(), 0);
  // volumetric parts are capped: the scale follows the aura RADIUS (up to ~16 m), and a 28 m pillar / 24 m glow washed
  // the whole gameplay frame in the zone colour
  const sv = Math.min(s, 1.3);
  inst.own(fx.shp.ground(c.x, c.z, 0).cyl(Math.min(Rc * 0.46, 1.6), Math.min(Rc * 0.36, 1.2), 6 * sv).pat(PAT.pillar).life(L).delay(d0).col(p.main, 1, p.edge, 1).int(awk ? 0.8 : 0.6).fade(FO.late).seed(sd + 6).pinned().emit(), 0);
  if (awk) inst.own(fx.shp.ground(c.x, c.z, 0.055).disk(Rc * 1.4).pat(PAT.rune).spin(0.35).life(L).delay(d0).col(p.main, 0.9, p.edge, 0.9).int(0.8).fade(FO.late).seed(sd + 8).pinned().emit(), 0);
  inst.ownDecal(fx.dec.ground(c.x, c.z, 0.03).disk(Rc * 1.15).pat(PAT.scorch).life(L).delay(d0).col(p.main, 1, p.smoke, awk ? 0.9 : 0.7).fade(FO.late).seed(sd + 10).pinned().emit(), 0);
}

function auraTick(fx: Fx, c: Inst, dt: number, awk: boolean): void {
  const rng = fx.rng;
  const s = c.scale;
  const p = awk ? redden(c.pal, 0.78) : c.pal;
  const f = awk ? 1.9 : 1;
  const k = fx.density;
  const Rc = 3.4 * s;
  const sv = Math.min(s, 1.3);
  const { x, y, z } = c;
  // corruption wisps (+ black smoke when awakened)
  c.acc0 += dt * 8 * f * k;
  while (c.acc0 >= 1) {
    c.acc0 -= 1;
    const a = rng.f() * TAU;
    const r = Rc * rng.r(0.35, 1);
    fx.add.at(x + Math.sin(a) * r, y + 0.1, z + Math.cos(a) * r).vel(rng.s2(0.3), rng.r(0.9, 1.7) * sv, rng.s2(0.3)).life(rng.r(1.4, 2.2)).size(1.1 * sv, 1.7 * sv)
      .col(p.main, 0.8, p.edge, 0).int(1.8).spr(SPR.wisp).mode(M.upright).stretch(1.35).wob(0.35).drag(0.4).fade(2, FO.sq).emit();
    if (awk && rng.f() < 0.6) {
      fx.alp.at(x + Math.sin(a) * r * 0.8, y + 0.2, z + Math.cos(a) * r * 0.8).vel(rng.s2(0.4), rng.r(0.5, 1.1), rng.s2(0.4)).life(rng.r(1.4, 2.2)).size(1.2 * s, 3 * s)
        .col(0x1c0a14, 0.55, 0x0a0408, 0).spr(SPR.smoke0 + rng.i(4)).rot(rng.f() * TAU, rng.s2(0.5)).drag(1).fade(2, FO.sq, SC.out).emit();
    }
  }
  // rising rune-coloured motes
  c.acc1 += dt * 14 * f * k;
  while (c.acc1 >= 1) {
    c.acc1 -= 1;
    const a = rng.f() * TAU;
    const r = Rc * 0.9 * Math.sqrt(rng.f());
    fx.add.at(x + Math.sin(a) * r, y + 0.1, z + Math.cos(a) * r).vel(rng.s2(0.4), rng.r(0.7, 1.8), rng.s2(0.4)).life(rng.r(1, 1.8)).size(0.14 * s, 0.03)
      .col(p.core, 1, p.main, 0).int(2).spr(SPR.glow).wob(0.15).drag(0.3).fade(1, FO.quad).emit();
  }
  // accents: floating rune glyphs and crackling arcs from the stone
  c.acc2 += dt * 3.5 * f * k;
  while (c.acc2 >= 1) {
    c.acc2 -= 1;
    if (rng.f() < 0.68) {
      runeMotes(fx, x, y + 0.4, z, 1, Rc * 0.9, 0.8 * s, 1.6, 2.4, 0.7 * s, p.main, 0, 1.8);
    } else {
      const a = rng.f() * TAU;
      const r = rng.r(1.4, 3) * s;
      const ex = x + Math.sin(a) * r, ez = z + Math.cos(a) * r;
      fx.rb.width(0.1 * s + 0.04).life(0.16).col(p.core, p.main).int(1.8).jag(0.4).branch(1).bolt(x + rng.s2(0.5 * s), y + rng.r(1.2, 2.6) * s, z + rng.s2(0.5 * s), ex, y + 0.15, ez);
      flash(fx, ex, y + 0.15, ez, 0.9 * s, 0.2, 0.14, p.core, 2.4);
    }
  }
  // periodic pulse: ring wave, pillar flare, breathing glow
  c.acc3 += dt;
  if (c.acc3 >= (awk ? 1.5 : 2.6)) {
    c.acc3 = 0;
    shockRing(fx, x, z, Rc * 1.05, 1.0, p, 0.1, awk ? 1.6 : 1.3);
    fx.shp.ground(x, z, 0).cyl(Math.min(Rc * 0.32, 1.1), Math.min(Rc * 0.22, 0.8), 8 * sv).pat(PAT.pillar).life(0.9).col(p.core, 1, p.main, 1).int(awk ? 1.4 : 1.1).fade(FO.sq).expand(0.4).seed(rng.f() * 10).emit();
    glow(fx, x, y + 1.4 * sv, z, 3.2 * sv, 5.2 * sv, 0.55, p.main, 0.7, 1.2);
    sparks(fx, x, y + 0.2, z, fx.n(6), 1.5 * s, 3.5 * s, 1.2, 0.3, 0.6, 0.07 * s, p.core, p.main, 0, 0, 1, 2, -6);
  }
}

function aura(awk: boolean): PresetDef {
  return {
    id: awk ? 'metin.aura.awakened' : 'metin.aura',
    cat: 'metin',
    desc: awk
      ? 'Awakened metin: red-tinged rune seal spinning against a second seal, hot pillar, black smoke, fast crackling arcs and corruption wisps (until stop).'
      : 'Living metin: rune seal + swirl disk, pulsing pillar, corruption wisps, floating rune glyphs, crackling arcs, corrupted ground (until stop).',
    size: 'mult',
    base: 3.4,
    palette: 'metin',
    dur: 900,
    loop: true,
    demo: { loopFor: 4 },
    fire(fx, c) {
      auraBuild(fx, c, awk);
    },
    tick(fx, c, dt) {
      auraTick(fx, c, dt, awk);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// AWAKEN: the stone turns blood red: a hot carpet of glyphs flares on the ground, cracks race out, red rings and a smoke column

function metinAwaken(): PresetDef {
  return {
    id: 'metin.awaken',
    cat: 'metin',
    desc: 'Awaken burst: the glyph carpet flares blood red under the stone, hot cracks race across the ground, red shock rings and a dark smoke column rise, embers and rune glyphs lift off.',
    size: 'mult',
    base: 4.5,
    palette: 'metin',
    dur: 1.8,
    loop: false,
    demo: {},
    fire(fx, c) {
      const rng = fx.rng;
      const s = c.scale;
      const R = c.radius;
      const p = redden(c.pal, 0.9);
      const { x, y, z } = c;
      const gy = y + 0.07;
      // the filled glyph carpet flaring (engraved medallion sprite lying on the floor), then cooling to dull red
      fx.add.at(x, gy, z).size(R * 1.1, R * 2.3).life(1.5).col(0xe83a20, 0.9, 0x8a1008, 0).int(1.15).art(MA.medallion).mode(M.ground).rot(rng.f() * TAU, 0.35).fade(0, FO.late, SC.out).emit();
      fx.add.at(x, gy + 0.01, z).size(R * 0.6, R * 1.6).life(1.1).col(0xff9060, 0.8, 0xe02a14, 0).int(1.0).art(MA.medallion).mode(M.ground).rot(rng.f() * TAU, -0.8).fade(0, FO.quad, SC.out).emit();
      groundFlare(fx, x, z, R * 1.35, 0.9, p.core, 1.5);
      // an ALPHA soot-red scorch under the additive flare and the cracks: additive red alone washes to pink on snow / pale stone (r1 seori awaken)
      scorch(fx, x, z, R * 1.05, 9, 0x1c0608, 0x7a1418);
      hotCracks(fx, x, z, R * 1.2, 7, 0x14080a, 0xff4a30, 1.5, 0.02);
      shockRing(fx, x, z, R * 1.15, 0.7, p, 0.3, 2.2);
      shockRing(fx, x, z, R * 0.75, 0.55, p, 0.3, 1.6, 0.1);
      shockRing(fx, x, z, R * 1.5, 0.95, p, 0.3, 1.2, 0.22);
      // red heat column (crossed planes: no hollow cylinder) and a hot core in it
      pillarCross(fx, x, z, R * 0.22, R * 2.6, 1.0, p, 1.5);
      flash(fx, x, y + 1.3 * s, z, R * 0.85, R * 0.3, 0.2, p.core, 2.2);
      glow(fx, x, y + 1.3 * s, z, R * 1.9, R * 0.6, 0.7, p.main, 0.7, 1.4);
      // dark red smoke boiling off the stone, ember rain, glyphs lifting
      boil(fx, x, y, z, fx.n(9), R * 0.4, 2.2, 1.2, 1.9, 1.7 * s, 3.8 * s, 0x5a1810, 0x14080a, 0.62, 0.05);
      dustRing(fx, x, y, z, fx.n(12), R * 0.95, 0.9, 0x5a3a34, 0.5, 1.2 * s);
      sparks(fx, x, y + 0.4, z, fx.n(20), R * 1.1, R * 2.3, 1.8, 0.4, 0.8, 0.11 * s, p.core, p.main, 0, 0, 1, 2.4, -8);
      embers(fx, x, y, z, fx.n(18), R * 0.8, 3.2, 1.0, 1.9, 0.2 * s, p.core, p.edge, 0.05, 2);
      runeMotes(fx, x, y + 0.3, z, fx.n(8), R * 0.8, 2, 0.9, 1.5, 0.85 * s, p.main, 0.1, 2);
      tint(fx, p.main, 0.035, 0.25);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// SHATTER: the essence reveal (companion of sk.gen.metin_break; the white-hot ball, streaks and laser lines are the spec)

function metinShatter(): PresetDef {
  return {
    id: 'metin.shatter',
    cat: 'metin',
    desc: 'Metin shatters: the stone releases its essence - a rune-coloured orb rises out of it in curling smoke wisps and glints, rune crystal shards and rock chips scatter, glyphs drift up, dust rolls out. a = 1 awakened (bigger, red).',
    size: 'mult',
    base: 3.4,
    palette: 'metin',
    dur: 2.2,
    loop: false,
    demo: {},
    fire(fx, c) {
      const rng = fx.rng;
      const awk = c.a >= 1;
      const s = c.scale * (awk ? 1.25 : 1);
      const R = 3.4 * s;
      const ds = Math.min(s, 1.5);
      const p = awk ? redden(c.pal, 0.55) : c.pal;
      const { x, y, z } = c;
      const cy = y + 1.1 * s;
      // --- the essence orb: a bright rune-coloured heart that lifts out of the broken stone, trailing curling wisps ---
      fx.add.at(x, cy, z).vel(0, 0.9, 0).size(0.9 * s, 1.5 * s).life(1.9).delay(0.18).col(p.core, 0.95, p.main, 0).int(1.6).art(MA.hotCore).fade(1, FO.late, SC.bell).emit();
      fx.add.at(x, cy, z).vel(0, 0.9, 0).size(2.6 * s, 3.6 * s).life(1.9).delay(0.18).col(p.main, 0.55, p.edge, 0).int(1.3).spr(SPR.glow).fade(1, FO.late, SC.bell).emit();
      fx.alp.at(x, cy, z).vel(0, 0.9, 0).size(1.5 * s, 2.3 * s).life(1.7).delay(0.18).col(p.main, 0.4, p.edge, 0).art(MA.smokeMass).fade(1, FO.late, SC.bell).emit();
      for (let i = 0, n = fx.n(9); i < n; i++) {
        const a = rng.f() * TAU;
        const r = rng.r(0.3, 0.9) * s;
        fx.add.at(x + Math.sin(a) * r, cy - 0.5 * s, z + Math.cos(a) * r).vel(-Math.sin(a) * 0.35, rng.r(1.1, 2.0), -Math.cos(a) * 0.35).life(rng.r(1.0, 1.6)).delay(0.12 + rng.r(0, 0.5))
          .size(0.9 * s, 2.0 * s).col(p.main, 0.9, p.edge, 0).int(1.6).art(rng.f() < 0.5 ? MA.wispThreads : MA.curl).mode(M.upright).stretch(1.7).wob(0.4).drag(0.5).fade(1, FO.sq).emit();
      }
      glints(fx, x, cy, z, fx.n(6), 1.4 * s, 1.8 * s, 0.7, 1.4, 0.26 * ds, p.core, p.main, 0.2, 2.2);
      lightShaft(fx, x, y, z, 1.5 * s, 6 * s, 1.1, p.main, 0.5, 1.2, 0.1);
      // --- the stone itself coming apart ---
      const crystal = fx.n(14 + (awk ? 8 : 0));
      for (let i = 0; i < crystal; i++) {
        const a = rng.f() * TAU;
        const v = R * rng.r(1.2, 2.4);
        fx.db.at(x, cy, z).vel(Math.sin(a) * v, rng.r(2, 8) * s, Math.cos(a) * v).sz(0.11 * ds * rng.r(0.6, 1.3)).col(p.core, p.main).glow(1.3).tall(1.8).life(rng.r(1, 1.6)).floor(y).emit();
      }
      rocks(fx, x, cy, z, fx.n(9 + (awk ? 5 : 0)), Math.min(R * 1.9, ROCK_SPEED_MAX), 0.6 * ds, 1.3, y, awk ? 0xa07c84 : 0xe0d0b8);
      // glyphs lifting off the broken stone
      for (let i = 0, n = fx.n(9); i < n; i++) {
        const a = rng.f() * TAU;
        const v = R * rng.r(0.6, 1.3);
        fx.add.at(x, cy, z).vel(Math.sin(a) * v, rng.r(1.0, 3.5), Math.cos(a) * v).life(rng.r(0.9, 1.5)).size(0.8 * ds, 0.55 * ds).col(p.main, 0.95, p.core, 0).int(2).spr(SPR.rune0 + rng.i(8))
          .rot(rng.s2(0.8), rng.s2(2.5)).drag(2.0).fade(0, FO.quad).emit();
      }
      wisps(fx, x, y + 0.4, z, fx.n(7), R * 0.5, 2.6 * s, 1.2, 2.0, 1.0 * s, p.core, p.main, 0.1, 1.8);
      dustRing(fx, x, y, z, fx.n(14), R * 1.05, 0.9, awk ? 0x5a4044 : 0xa89070, 0.6, 1.3 * s);
      smokeBurst(fx, x, y + 0.7 * s, z, R * 0.7, 1.3, awk ? 0x5a3a44 : 0x9a8468, awk ? 0x120608 : 0x3a2c24, 0.6, 0.05, 1.2);
      if (awk) smoke(fx, x, y + 0.5, z, fx.n(8), R * 0.5, 1.6, 1.2, 2, 1.4 * s, 3.8 * s, 0x1c0a14, 0.55, 0.08);
      embers(fx, x, y, z, fx.n(awk ? 18 : 10), R * 0.8, 3, 0.9, 1.7, 0.2 * s, p.core, p.edge, 0.05, 2);
      tint(fx, p.core, awk ? 0.04 : 0.03, 0.2);
    },
  };
}

function metinPulse(): PresetDef {
  return {
    id: 'metin.pulse',
    cat: 'metin',
    desc: 'Corruption pulse: rune seal expanding to the radius with a bright ring front, rune glyphs and sparks riding the wave, wisps.',
    size: 'radius',
    base: 4,
    palette: 'metin',
    dur: 0.9,
    loop: false,
    demo: {},
    fire(fx, c) {
      const rng = fx.rng;
      const p = c.pal;
      const R = c.radius;
      const s = R / 4;
      const T = c.duration;
      const { x, y, z } = c;
      flash(fx, x, y + 1.2 * s, z, R * 0.45, R * 0.12, 0.2, p.core, 2.8);
      glow(fx, x, y + 0.8 * s, z, R * 1.2, R * 0.3, 0.45, p.main, 0.8, 1.4);
      runeCircle(fx, x, z, R, T * 1.2, p.core, p.main, 1.6, 0, 0.18, 0.8, FO.quad);
      shockRing(fx, x, z, R, T * 0.85, p, 0.2, 2.2);
      shockRing(fx, x, z, R * 0.7, T * 0.7, p, 0.12, 1.4, 0.08);
      fx.shp.ground(x, z, 0.04).disk(R).pat(PAT.disk).expand(0.2).life(T * 0.8).col(p.main, 0.7, p.edge, 0.7).int(0.9).fade(FO.sq).seed(rng.f() * 10).emit();
      haloRing(fx, x, y + 0.8 * s, z, 0.5, R * 2.1, T * 0.9, p.core, 0.6, 1.3);
      // glyphs and sparks riding the ring front (r(t) = R·(0.18 + 0.82·easeOut3))
      for (let i = 0, n = fx.n(14); i < n; i++) {
        const f = rng.r(0.05, 0.75);
        const r = R * (0.18 + 0.82 * (1 - Math.pow(1 - f, 3)));
        const a = rng.f() * TAU;
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (i % 2 === 0) {
          fx.add.at(px, y + 0.4, pz).vel(0, rng.r(0.7, 1.4), 0).life(rng.r(0.6, 1)).delay(T * f * 1.2).size(0.75 * s, 0.6 * s).col(p.main, 0.95, p.core, 0).int(2).spr(SPR.rune0 + rng.i(8))
            .rot(rng.s2(0.6), rng.s2(0.8)).drag(0.5).fade(1, FO.quad).emit();
        } else {
          fx.add.at(px, y + 0.2, pz).vel(Math.sin(a) * 1.5, rng.r(1.5, 3.2), Math.cos(a) * 1.5).life(rng.r(0.3, 0.5)).delay(T * f * 1.2).size(0.1 * s, 0.03).stretch(0.05)
            .col(p.core, 1, p.main, 0).int(2.4).spr(SPR.streak).mode(M.streak).drag(2).grav(-7).fade(0, FO.cubic).emit();
        }
      }
      for (let i = 0, n = fx.n(7); i < n; i++) {
        const a = rng.f() * TAU;
        const r = R * rng.r(0.4, 0.95);
        fx.add.at(x + Math.sin(a) * r, y + 0.1, z + Math.cos(a) * r).vel(rng.s2(0.2), rng.r(1, 1.8), rng.s2(0.2)).life(rng.r(0.9, 1.5)).delay(T * rng.r(0.2, 0.8)).size(0.55 * s, 1 * s)
          .col(p.main, 0.85, p.edge, 0).int(1.5).spr(SPR.wisp).mode(M.upright).stretch(1.6).wob(0.3).drag(0.4).fade(2, FO.sq).emit();
      }
    },
  };
}

export const presets: PresetDef[] = [
  metinFall(),
  metinImpact(),
  aura(false),
  aura(true),
  metinAwaken(),
  metinShatter(),
  metinPulse(),
];

// Set-piece building blocks of the boss presets (common VFX target `boss`; owner: the boss builder). Each block is one layer of the

// upright volumes (monster_die / metinstone_crash thrown UP above the body, whitedragon_boss2's translucent haze wall), thin soft
// light beams, element chips, flames, and only a short low-contrast memory on the floor. All sizes in metres / seconds; every block
// draws generated sprites with a procedural fallback (art.ts).
//
// r2 (2026-10-20): the blind critic of round 1 found every event "a flat floor layer" (grain ring, dust disc, dark underlay, black crack
// decal) opening with the SAME stamp. The upright volumes (`plume`, `ball`, `hazeWall`) now carry the events, the rings are an afterthought.
//

// spiky ring over a white flare core). `rayBurst` is that (<= 0.3 s, element hued); `motes` / `sparkle` replace the hard + / x glints, `pit` animates
// the crater, `chips` throws varied ice shards / rocks over the whole disc, `orbitSmoke` is the enrage aura (swirl smoke hugging the body).
import { KIT_ART } from '../kitArt';
import { FO, M, SC, SPR, TAU, type Fx } from '../../presets/kit';
import type { KitArt } from '../../emit';
import type { Palette } from '../../palette';
import { mixHex, scaleHex } from '../../util';
import { BOSS_ART, BOSS_RING_ART, type RingArt } from './art';
import { EL, hazeTone } from './look';

/** smoke body sprites (alpha, lit from above): cumulus balls, hazy fog, a rare dense lump */
const BODY: readonly KitArt[] = [KIT_ART.smokeBillow, BOSS_ART.hazeRound, KIT_ART.smokeBillow, BOSS_ART.fogBall, KIT_ART.smokeClump, BOSS_ART.puffLumpy, BOSS_ART.hazeRound, BOSS_ART.mass];
/** r3: a TEXTURED set for the summon / teleport columns (the smooth hazy puffs of BODY read as flat lavender airbrush blobs there): dense billowing clouds, grainy clumps, a ragged mass */
export const TEX_BODY: readonly KitArt[] = [KIT_ART.smokeBillow, KIT_ART.smokeClump, BOSS_ART.puffLumpy, KIT_ART.smokeBillow, BOSS_ART.mass, KIT_ART.smokeClump];
/** the aura's body puffs: ragged hazy smoke, NOT the dense lit cloud balls (tinted crimson those read as lava balls in the close-up) */
const AURA_BODY: readonly KitArt[] = [BOSS_ART.puffLumpy, BOSS_ART.fogBall, BOSS_ART.smudge, BOSS_ART.puffLumpy, BOSS_ART.puffHaze];
/** the soft additive companions of the aura (no round hot-core orbs: they read as glowing bubbles inside the smoke) */
const GLOW_SOFT: readonly KitArt[] = [BOSS_ART.puffLumpy, BOSS_ART.puffHaze, BOSS_ART.puffLumpy];
/** the luminous additive companions (the glow inside a smoke body) */
const GLOW: readonly KitArt[] = [BOSS_ART.puffMottled, BOSS_ART.puffLumpy, BOSS_ART.hotcore, BOSS_ART.puffMottled];
/** dust bank puffs: grainy clumps carry the volume, the faint haze fills between them */
const DUST_SET: readonly KitArt[] = [KIT_ART.smokeClump, KIT_ART.smokeClump, BOSS_ART.puffLumpy, BOSS_ART.puffHaze, KIT_ART.smokeDust];

/**
 * The height at which a flat quad of radius `r` round (x, z) lies clear of the ground: the highest ground point under its footprint (centre,
 * a half ring and the rim, 17 samples). A quad placed at the centre height alone is buried wherever the floor rises toward its rim (hills,
 * ramps, the rough gallery floor), which cuts a ring or a glow off with a hard straight edge; floating on the highest point costs a few
 * centimetres of apparent lift on the low side, never visible at the 55 degree camera.
 */
export function lay(fx: Fx, x: number, z: number, r: number): number {
  let y = fx.heightAt(x, z);
  const rr = Math.min(r, 9);
  for (let i = 0; i < 8; i++) {
    const a = (i * TAU) / 8;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    const h1 = fx.heightAt(x + sx * rr, z + sz * rr);
    const h2 = fx.heightAt(x + sx * rr * 0.5, z + sz * rr * 0.5);
    if (h1 > y) y = h1;
    if (h2 > y) y = h2;
  }
  return y;
}

/** dust colour that sits well on the floor of the element's usual zone (never white on snow, never black on stone) */
export function dustHex(el: number): number {
  switch (el) {
    case 2:
      return 0x93a6c2;
    case 4:
      return 0x9486a8;
    case 1:
      return 0xbc8c68;
    case 5:
      return 0xa4b68a;
    default:
      return 0xcdbfa4;
  }
}

/** colour of the dark smoke body: the palette's smoke tone lifted a little so it still reads as a volume on dark floors (r1 look, still used by the loops) */
export function bodyHex(p: Palette): number {
  return mixHex(p.smoke, 0x5a4a42, 0.35);
}

/**
 * A ring lying on the ground, growing (or shrinking) from `r0` to `r1` (ring radius in metres at the sprite's brightest band),
 * additive. `spin` rad/s. The soft band is the shock front / seal / vortex; stack two with different sprites and opposite spin.
 */
export function ringOn(fx: Fx, art: RingArt, x: number, z: number, r0: number, r1: number, life: number, hex: number, a = 0.9, int = 1.4, spin = 0, delay = 0, lift = 0.07, edge = -1): void {
  const y = lay(fx, x, z, Math.max(r0, r1)) + lift;
  const rot = fx.rng.f() * TAU;
  // the additive ring vanishes on snow / pale stone: the same ring is also drawn as a darker alpha body of the same hue under it
  
  // tone of the element (cobalt under ice, brown-red under fire): a stronger body in that colour keeps a pale hot rim readable on white snow
  const body = edge >= 0 ? edge : scaleHex(hex, 0.34);
  const ba = edge >= 0 ? 0.9 : 0.5;
  fx.alp.at(x, y - 0.012, z).size(r0 / art.pk, r1 / art.pk).life(life).delay(delay).col(body, a * ba, body, a * ba * 0.36).art(art).mode(M.ground)
    .rot(rot, spin).fade(0, FO.late, SC.out).emit();
  fx.add.at(x, y, z).size(r0 / art.pk, r1 / art.pk).life(life).delay(delay).col(hex, a, hex, 0).int(int).art(art).mode(M.ground)
    .rot(rot, spin).fade(0, FO.quad, SC.out).emit();
}

/** a dark soft patch on the ground: short and faint in r2 (a hint under a hued glow, never the main shape of an event) */
export function underlay(fx: Fx, x: number, z: number, R: number, life: number, hex: number, a = 0.5, delay = 0): void {
  const y = lay(fx, x, z, R * 1.2) + 0.035;
  const rng = fx.rng;
  for (let i = 0; i < 2; i++) {
    fx.alp.at(x + rng.s2(R * 0.08), y + i * 0.004, z + rng.s2(R * 0.08)).size(R * (i === 0 ? 2.1 : 1.5), R * (i === 0 ? 2.5 : 1.8)).life(life).delay(delay)
      .col(hex, a * (i === 0 ? 1 : 0.7), hex, a * 0.45).art(i === 0 ? BOSS_ART.puffHaze : BOSS_ART.smudge).mode(M.ground).rot(rng.f() * TAU, rng.s2(0.1)).fade(2, FO.late, SC.out).emit();
  }
}

/** soft additive glow lying on the ground (element hue), `R` = radius of the visible pool */
export function groundGlow(fx: Fx, x: number, z: number, R: number, life: number, hex: number, a = 0.8, int = 1.1, delay = 0): void {
  const y = lay(fx, x, z, R) + 0.05;
  // additive light alone goes white on snow and pale stone: an alpha body of the same hue, half as bright, carries the colour there
  const body = scaleHex(hex, 0.55);
  fx.alp.at(x, y - 0.012, z).size(R * 1.5, R * 2.0).life(life).delay(delay).col(body, a * 0.5, body, 0).spr(SPR.glow).mode(M.ground).fade(0, FO.quad, SC.out).emit();
  fx.add.at(x, y, z).size(R * 1.7, R * 2.3).life(life).delay(delay).col(hex, a, hex, 0).int(int).spr(SPR.glow).mode(M.ground).fade(0, FO.quad, SC.out).emit();
}

// ---------------------------------------------------------------------------------------------------------------- r2: upright smoke volumes

/**
 * One plume of smoke standing up out of the ground: `n` screen-facing puffs stacked from the base to `h` metres (base puffs small, top puffs
 * wide: the head of a billow), every puff shooting up with drag so the column erupts in about 0.4 s and keeps boiling for `life`; the alpha body
 * (`body`, mid-tone of the element) + a narrower luminous additive core (`glow`) in the lower two thirds. `lx, lz` lean the column. Puffs start
 * `s0 * 0.3` above the base so a flat floor never cuts the lowest one.
 */
export function plume(fx: Fx, x: number, y: number, z: number, h: number, w: number, n: number, life: number, body: number, glow: number, a = 0.7, aGlow = 0.5, delay = 0, lx = 0, lz = 0, set: readonly KitArt[] = BODY): void {
  const rng = fx.rng;
  const d = 2.2;
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0;
    const s0 = w * (0.5 + 0.3 * f) * rng.r(0.85, 1.15);
    const s1 = w * (1.15 + 0.85 * f) * rng.r(0.9, 1.15);
    const target = h * (0.1 + 0.9 * f) * rng.r(0.92, 1.08);
    fx.alp.at(x + rng.s2(w * 0.28) + lx * f * 0.2, y + s0 * 0.3, z + rng.s2(w * 0.28) + lz * f * 0.2)
      .vel(rng.s2(0.4) + lx * f, (target * d) / 0.93, rng.s2(0.4) + lz * f).life(life * rng.r(0.85, 1.15)).delay(delay + i * 0.014 + rng.r(0, 0.05)).size(s0, s1)
      .col(body, a * (1 - 0.2 * f), mixHex(body, 0x000000, 0.12), a * 0.2).art(set[rng.i(set.length)] as KitArt).rot(rng.f() * TAU, rng.s2(0.5)).drag(d).fade(1, FO.late, SC.out).emit();
  }
  const ng = Math.max(2, Math.round(n * 0.55));
  for (let i = 0; i < ng; i++) {
    const f = ng > 1 ? (i / (ng - 1)) * 0.72 : 0;
    const target = h * (0.1 + 0.9 * f);
    fx.add.at(x + rng.s2(w * 0.18), y + w * 0.2, z + rng.s2(w * 0.18)).vel(rng.s2(0.3), (target * d) / 0.93, rng.s2(0.3)).life(life * rng.r(0.5, 0.7)).delay(delay + i * 0.02 + rng.r(0, 0.04))
      .size(w * 0.45, w * (0.9 + 0.4 * f)).col(glow, aGlow * (1 - 0.3 * f), glow, 0).int(1.35).art(GLOW[rng.i(GLOW.length)] as KitArt).rot(rng.f() * TAU, rng.s2(0.6)).drag(d).fade(1, FO.quad, SC.out).emit();
  }
}






export function ball(fx: Fx, x: number, y: number, z: number, n: number, R: number, speed: number, rise: number, l0: number, l1: number, s0: number, s1: number, body: number, glow: number, a = 0.75, aGlow = 0.7, crashN = 0, delay = 0): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const cu = rng.s2(1);
    const ph = rng.f() * TAU;
    const hr = Math.sqrt(1 - cu * cu);
    const dx = Math.sin(ph) * hr;
    const dz = Math.cos(ph) * hr;
    const sp = speed * rng.r(0.5, 1.1);
    const sa = s0 * rng.r(0.8, 1.2);
    fx.alp.at(x + dx * R * rng.r(0.1, 0.5), y + cu * R * 0.3, z + dz * R * rng.r(0.1, 0.5))
      .vel(dx * sp, cu * sp * 0.6 + rise * rng.r(0.7, 1.25), dz * sp).life(rng.r(l0, l1)).delay(delay + rng.r(0, 0.07)).size(sa, s1 * rng.r(0.85, 1.2))
      .col(body, a, mixHex(body, 0x000000, 0.15), a * 0.2).art(BODY[rng.i(BODY.length)] as KitArt).rot(rng.f() * TAU, rng.s2(0.5)).drag(1.7).fade(1, FO.late, SC.out).emit();
  }
  for (let i = 0; i < crashN; i++) {
    const ph = rng.f() * TAU;
    const sa = s0 * 1.5;
    fx.alp.at(x + Math.sin(ph) * R * 0.3, y + 0.2, z + Math.cos(ph) * R * 0.3).vel(Math.sin(ph) * speed * 0.35, rise * 0.8, Math.cos(ph) * speed * 0.35).life(rng.r(l0, l1) * 0.9)
      .delay(delay + rng.r(0, 0.05)).size(sa, s1 * 1.05).col(0xffffff, a * 0.95, 0xd8b8a8, a * 0.2).art(BOSS_ART.crash).rot(rng.f() * TAU, rng.s2(0.4)).drag(1.8).fade(1, FO.late, SC.out).emit();
  }
  const ng = Math.max(2, Math.round(n * 0.4));
  for (let i = 0; i < ng; i++) {
    const ph = rng.f() * TAU;
    const rr = R * rng.r(0, 0.35);
    fx.add.at(x + Math.sin(ph) * rr, y + rng.s2(R * 0.2), z + Math.cos(ph) * rr).vel(Math.sin(ph) * speed * 0.4, rise * 0.9, Math.cos(ph) * speed * 0.4).life(rng.r(0.4, 0.65)).delay(delay + rng.r(0, 0.04))
      .size(s0 * 1.4, s1 * 0.8).col(glow, aGlow, glow, 0).int(1.25).art(GLOW[rng.i(GLOW.length)] as KitArt).rot(rng.f() * TAU, rng.s2(0.8)).drag(1.7).fade(0, FO.quad, SC.out).emit();
  }
}

/**
 * A wall of translucent haze sweeping out along the ground from `r0` to `r1` in `T` seconds (the blue-violet wall of whitedragon_boss2's
 * s1_blow): a ring of upright, camera-facing hazy cards `h` tall (body `body` alpha + a hued additive twin on the front half) with light
 * streaks (`glow`) running up the front. Cards overlap, so the ring reads as one band of smoke; the sweep is the ring's only fast motion.
 */
export function hazeWall(fx: Fx, x: number, y: number, z: number, r0: number, r1: number, T: number, h: number, body: number, glow: number, a = 0.5, delay = 0, lum = 0.7, nMax = 26, lifeK = 1): void {
  const rng = fx.rng;
  const n = Math.max(8, fx.n(Math.max(10, Math.min(nMax, Math.round((TAU * r1) / 2.7)))));
  const w = Math.max(2.2, Math.min(5.2, ((TAU * r1 * 0.78) / n) * 1.15));
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU + rng.s2(0.12);
    const sx = Math.sin(ang);
    const sz = Math.cos(ang);
    const v = (r1 - r0) / T;
    const rr = r0 * rng.r(0.9, 1.1);
    const hh = h * rng.r(0.85, 1.2);
    const ww = w * rng.r(0.9, 1.15);
    const life = T * rng.r(1.3, 1.5) * lifeK;
    const dl = delay + rng.r(0, 0.05);
    fx.alp.at(x + sx * rr, y + 0.06, z + sz * rr).vel(sx * v, 0.15, sz * v).delay(dl).life(life).size(ww * 0.8, ww * 1.15).stretch(hh / ww)
      .col(body, a, body, a * 0.25).art(i % 2 === 0 ? BOSS_ART.hazeWall : rng.f() < 0.5 ? BOSS_ART.hazeRound : BOSS_ART.fogBall).mode(M.upright).rot(0, 0).fade(1, FO.late).emit();
    // a denser, rounder lump in front of every second bank card: the bank sprite alone is too translucent at the 22 m camera on a pale floor (snow)
    if (i % 2 === 1) {
      const lat = rng.s2(ww * 0.25);
      fx.alp.at(x + sx * rr * 1.03 + sz * lat, y + 0.08, z + sz * rr * 1.03 - sx * lat).vel(sx * v, 0.2, sz * v).delay(dl + 0.03).life(life * 0.9).size(ww * 0.62, ww * 0.78).stretch((hh * 0.85) / ww)
        .col(body, a * 0.95, body, a * 0.3).art(rng.f() < 0.5 ? BOSS_ART.hazeRound : BOSS_ART.puffMottled).mode(M.upright).rot(0, 0).fade(1, FO.late).emit();
    }
    // the luminous twin of every card (additive, narrower, a little shorter): the wall glows in the element hue, it is not a dust bank
    fx.add.at(x + sx * rr, y + 0.1, z + sz * rr).vel(sx * v, 0.3, sz * v).delay(dl).life(life * 0.75).size(ww * 0.6, ww * 0.95).stretch((hh * 0.9) / ww)
      .col(glow, a * lum, glow, 0).int(1.35).art(i % 2 === 0 ? BOSS_ART.hazeWall : BOSS_ART.puffMottled).mode(M.upright).fade(1, FO.quad).emit();
    if (i % 2 === 0) {
      // a light streak running up the front (cyan on ice): upright, narrow and tall, brighter than the haze
      fx.add.at(x + sx * rr * 1.04, y + 0.05, z + sz * rr * 1.04).vel(sx * v, 0.2, sz * v).delay(dl + rng.r(0.02, 0.06)).life(T * rng.r(0.75, 1.0)).size(ww * 0.16, ww * 0.22).stretch((hh * 1.15) / (ww * 0.18))
        .col(glow, 0.8 * Math.min(1, lum + 0.3), glow, 0).int(1.7).art(BOSS_ART.riseSoft).mode(M.upright).fade(0, FO.quad).emit();
    }
  }
}

/** low dust skirt: a bank of dust racing out along the ground to radius `r`: alpha puffs (generated dust sprites) riding the front */
export function dustFront(fx: Fx, x: number, y: number, z: number, n: number, r: number, life: number, hex: number, a: number, size: number, delay = 0): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU + rng.s2(0.22);
    const sp = (r / life) * rng.r(0.8, 1.2) * 1.55;
    fx.alp.at(x + Math.sin(ang) * r * 0.12, y + size * 0.3, z + Math.cos(ang) * r * 0.12)
      .vel(Math.sin(ang) * sp, rng.r(0.15, 0.7), Math.cos(ang) * sp).life(life * rng.r(0.85, 1.2)).delay(delay).size(size * 0.55, size * rng.r(1.3, 2))
      .col(hex, a, hex, a * 0.5).art(DUST_SET[rng.i(DUST_SET.length)] as KitArt).rot(rng.f() * TAU, rng.s2(0.7)).drag(2.4).fade(1, FO.quad, SC.out).emit();
  }
}

/** fine speckled dust / ember haze hanging over a disc, drifting up (additive speckle sprite; `hex` warm for embers) */
export function haze(fx: Fx, x: number, y: number, z: number, n: number, radius: number, height: number, life: number, size: number, hex: number, a = 0.5, int = 1.3, delay = 0): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const ang = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * radius;
    fx.add.at(x + Math.sin(ang) * r, y + rng.r(0.2, height), z + Math.cos(ang) * r).vel(rng.s2(0.4), rng.r(0.2, 0.9), rng.s2(0.4)).life(life * rng.r(0.7, 1.15)).delay(delay + rng.r(0, 0.2))
      .size(size * 0.8, size * rng.r(1.1, 1.5)).col(hex, a, hex, 0).int(int).art(rng.f() < 0.55 ? BOSS_ART.dustGrain : BOSS_ART.emberSpeck).rot(rng.f() * TAU, rng.s2(0.3)).fade(1, FO.quad).emit();
  }
}

/** smoke volumes thrown up and out of a disc (the r1 block: loops and small accents; the big events use `plume` / `ball`) */
export function smokeVol(fx: Fx, x: number, y: number, z: number, n: number, spread: number, rise: number, l0: number, l1: number, s0: number, s1: number, hex: number, a: number, glow = false, int = 1.2, delay = 0, out = 0.5): void {
  const rng = fx.rng;
  const set = glow ? GLOW : BODY;
  for (let i = 0; i < n; i++) {
    const ang = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * spread;
    const sa = s0 * rng.r(0.8, 1.2);
    const b = (glow ? fx.add : fx.alp).at(x + Math.sin(ang) * r, y + sa * 0.35, z + Math.cos(ang) * r)
      .vel(Math.sin(ang) * out * rng.r(0.4, 1) * (r / Math.max(0.3, spread)), rise * rng.r(0.55, 1.25), Math.cos(ang) * out * rng.r(0.4, 1) * (r / Math.max(0.3, spread)))
      .life(rng.r(l0, l1)).delay(delay + rng.r(0, 0.06)).size(sa, s1 * rng.r(0.85, 1.2)).col(hex, a, glow ? mixHex(hex, 0x000000, 0.4) : hex, glow ? a * 0.15 : a * 0.75)
      .art(set[rng.i(set.length)] as KitArt).rot(rng.f() * TAU, rng.s2(0.45)).drag(1.5).fade(2, glow ? FO.quad : FO.late, SC.out);
    if (glow) b.int(int);
    b.emit();
  }
}


export function swirl(fx: Fx, x: number, z: number, r0: number, r1: number, life: number, body: number, glow: number, a = 0.5, spin = 2, delay = 0, lift = 0.06): void {
  const art = BOSS_RING_ART.vortexDisc;
  const y = lay(fx, x, z, Math.max(r0, r1)) + lift;
  const rot = fx.rng.f() * TAU;
  fx.alp.at(x, y, z).size(r0 / art.pk, r1 / art.pk).life(life).delay(delay).col(body, a, body, a * 0.35).art(art).mode(M.ground).rot(rot, spin).fade(1, FO.late, SC.out).emit();
  fx.add.at(x, y + 0.012, z).size((r0 * 0.9) / art.pk, (r1 * 0.9) / art.pk).life(life * 0.8).delay(delay).col(glow, a * 0.55, glow, 0).int(1.1).art(art).mode(M.ground).rot(rot + 1.3, -spin * 0.7).fade(1, FO.quad, SC.out).emit();
}

// ---------------------------------------------------------------------------------------------------------------- r2: light, chips, flames, memory

/**
 * A soft light beam standing on the ground: a wide faint shaft (`riseSoft`) with a thin bright beam (`beam`, hot root) inside it: a beam, not
 * the comb of evenly spaced hairlines of the old curtain. `w` = width of the shaft, `h` = height; additive in `hex`, the beam core a little whiter.
 */
export function beam(fx: Fx, x: number, y: number, z: number, w: number, h: number, life: number, hex: number, a = 0.8, int = 1.4, delay = 0): void {
  fx.add.at(x, y - h * 0.01, z).vel(0, h * 0.04, 0).size(w * 1.5, w * 1.9).stretch(h / (w * 1.5)).life(life).delay(delay).col(hex, a * 0.55, hex, 0).int(int * 0.85).art(BOSS_ART.riseSoft).mode(M.upright).fade(1, FO.sq).emit();
  const core = mixHex(hex, 0xffffff, 0.3);
  fx.add.at(x + fx.rng.s2(w * 0.05), y - h * 0.005, z).vel(0, h * 0.06, 0).size(w * 1.1, w * 1.3).stretch(h / (w * 1.1) * 0.65).life(life * 0.8).delay(delay).col(core, a, hex, 0).int(int).art(BOSS_ART.beam).mode(M.upright).fade(0, FO.sq).emit();
}

/**
 * Chips thrown out of a point, by element: a lit rock sprite (alpha body) always, plus an additive twin of the same sprite and path in the
 * element's glow, so they are not black dice on snow: ice = bright faceted CYAN crystals (a cobalt-to-ice body, a strong glow, with sparkle),
 * fire / dark / poison = dark rock with a glowing lava / violet / lime face, physical = brown rock with a faint warm face.
 */
export function chips(fx: Fx, el: number, x: number, y: number, z: number, n: number, speed: number, size: number, life: number, floorY: number, delay = 0): void {
  const rng = fx.rng;
  const hz = hazeTone(el);
  let body = 0x8c7a68;
  let far = 0x5a4c40;
  let glow = 0xff8a40;
  let ga = 0.22;
  switch (el) {
    case EL.ice:
      body = 0xa8dcff;
      far = 0x4a86e0;
      glow = 0x7ae4ff;
      ga = 0.7;
      break;
    case EL.fire:
      body = 0x4a3830;
      far = 0x2a1810;
      glow = 0xffa030;
      ga = 0.6;
      break;
    case EL.dark:
      body = 0x4a3c5c;
      far = 0x1c1426;
      glow = hz.glow;
      ga = 0.55;
      break;
    case EL.poison:
      body = 0x4c5c3c;
      far = 0x1c2614;
      glow = hz.glow;
      ga = 0.5;
      break;
    default:
      break;
  }
  const ice = el === EL.ice;
  // the ice boss's three kinds of chip (r2 was ONE hex-gem at one size spaced round a ring): the glowing crystal, a faceted block of ice (the rock sprite in a
  // cobalt-to-cyan tint) and a small upright shard cluster; sizes vary x4 and the speeds span the whole disc, so they land scattered, not on one circle
  const GEM_TINT = [0xffffff, 0xcfe6ff, 0xa6d2ff];
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const u = rng.f();
    const v = speed * (0.22 + 0.9 * Math.pow(u, 0.8));
    const vx = Math.sin(a) * v;
    const vy = speed * rng.r(0.7, 1.6) * (1.15 - 0.45 * u);
    const vz = Math.cos(a) * v;
    const big = rng.f();
    const sz = size * (0.45 + 1.15 * big * big) * (ice ? 1.15 : 1);
    const lf = life * rng.r(0.8, 1.2);
    const r0 = rng.f() * TAU;
    const sp = rng.s2(7);
    const dl = delay + rng.r(0, 0.06);
    const roll = rng.f();
    // kind: 0 = rock / facet block, 1 = ice gem, 2 = ice shard cluster
    const kind = ice ? (roll < 0.34 ? 1 : roll < 0.78 ? 0 : 2) : 0;
    const art = kind === 1 ? BOSS_ART.iceGem : kind === 2 ? BOSS_ART.iceCrown : ice || rng.f() < 0.5 ? KIT_ART.rockFacet : BOSS_ART.rockLumpy;
    const c0 = kind === 1 ? (GEM_TINT[i % 3] as number) : kind === 2 ? 0xc8e8ff : ice ? 0xa8d0ff : body;
    const c1 = kind === 1 ? 0xc8d8ff : kind === 2 ? 0x6aa0ff : ice ? 0x4a7ad0 : far;
    const w = kind === 2 ? sz * 0.8 : sz;
    // the crystal / shards keep their own colours (cyan facets, cobalt shade); rocks take the element's tint; the shard cluster is taller than wide
    const b = fx.alp.at(x, y, z).vel(vx, vy, vz).life(lf).delay(dl).floor(floorY).size(w).col(c0, 1, c1, 1).art(art).rot(r0, sp).grav(-14).drag(0.35).fade(0, FO.snap);
    if (kind === 2) b.stretch(1.1);
    b.emit();
    fx.add.at(x, y, z).vel(vx, vy, vz).life(lf).delay(dl).floor(floorY).size(w * 1.12).col(glow, ga * (kind === 1 ? 1 : 0.75), glow, ga * 0.2).int(1.5).art(art).rot(r0, sp).grav(-14).drag(0.35).fade(0, FO.snap).emit();
    if (ice && i % 3 === 0) {
      // a soft sparkle riding the chip
      fx.add.at(x, y, z).vel(vx, vy, vz).life(lf * 0.8).delay(dl).floor(floorY).size(sz * 1.7).col(0xd8f8ff, 0.8, glow, 0).int(1.8).art(BOSS_ART.starFrost).rot(r0, sp * 0.5).grav(-14).drag(0.35).twinkle().fade(0, FO.quad).emit();
    }
  }
}

/**
 * Upright element accents of the ground (not the same blob recoloured): ice = bright faceted crystal crowns bursting up, fire = a short
 * jet of flame, dark = violet smoke threads; physical / poison draw nothing (their smoke and chips carry the event). `n` accents on a ring of `radius`.
 */
export function accent(fx: Fx, el: number, x: number, y: number, z: number, n: number, radius: number, h: number, life: number, delay = 0): void {
  const rng = fx.rng;
  const hz = hazeTone(el);
  for (let i = 0; i < n; i++) {
    const ang = (i / Math.max(1, n)) * TAU + rng.s2(0.4);
    const rr = radius * rng.r(0.6, 1.05);
    const px = x + Math.sin(ang) * rr;
    const pz = z + Math.cos(ang) * rr;
    const dl = delay + rng.r(0, 0.12);
    const hh = h * rng.r(0.7, 1.15);
    if (el === EL.ice) {
      const w = hh * 0.85;
      fx.alp.at(px, y - 0.05, pz).life(life).delay(dl).size(w * 0.9, w * 1.1).stretch(0.95).col(0x5aa0ff, 0.75, 0x2a5ad0, 0.2).art(BOSS_ART.iceCrown).mode(M.upright).fade(0, FO.late, SC.out).emit();
      fx.add.at(px, y, pz).life(life).delay(dl).size(w * 0.9, w * 1.1).stretch(0.95).col(0xc8f4ff, 0.95, hz.glow, 0.1).int(1.7).art(BOSS_ART.iceCrown).mode(M.upright).fade(0, FO.quad, SC.out).emit();
    } else if (el === EL.fire) {
      const w = hh * 0.55;
      fx.alp.at(px, y - 0.05, pz).life(life).delay(dl).size(w * 0.9, w).stretch(2).col(0x5a1608, 0.7, 0x2a0a04, 0).art(BOSS_ART.flameA).mode(M.upright).fade(0, FO.quad, SC.out).emit();
      fx.add.at(px, y, pz).life(life).delay(dl).size(w * 0.85, w * 0.95).stretch(2).col(0xffa040, 0.9, 0xff4010, 0).int(1.6).art(BOSS_ART.flameA).mode(M.upright).fade(0, FO.quad, SC.out).emit();
    } else if (el === EL.dark) {
      const w = hh * 0.6;
      fx.add.at(px, y, pz).vel(0, hh * 0.5, 0).life(life).delay(dl).size(w, w * 1.1).stretch(1.4).col(hz.glow, 0.8, hz.body, 0).int(1.5).art(BOSS_ART.column).mode(M.upright).fade(1, FO.quad).emit();
    }
  }
}

/**
 * A short, faint memory on the floor: the generated crack scar, tinted the floor's own darker shade (`hazeTone(el).scar`: warm brown on stone, a
 * cool grey-blue on snow, never black), thin, fading within `life`; only `hot` seconds of a faint hot seam in the element hue while it opens.
 */
export function scar(fx: Fx, x: number, z: number, r: number, life: number, el: number, glow: number, a = 0.5, hot = 0.4, delay = 0, arms = 1, hotA = 0.55): void {
  const rng = fx.rng;
  const y = lay(fx, x, z, r) + 0.03;
  // snow: the generated pale frost fissure (r3; the charred sprite times any tint was a black root vein on white) in a pale blue at 0.85 x alpha; every other
  // floor: the charred scar in the floor's own shade lifted 35 % toward a pale dust and 0.75 x alpha, a low-contrast memory, not a black root vein
  const ice = el === EL.ice;
  const art = ice ? BOSS_ART.frostCrack : BOSS_ART.crack;
  const tint = ice ? 0x9fbce8 : mixHex(hazeTone(el).scar, 0xb4a490, 0.35);
  a *= ice ? 0.85 : 0.75;
  const rot0 = rng.f() * TAU;
  for (let i = 0; i < arms; i++) {
    const rot = rot0 + (i * TAU) / arms + rng.s2(0.35);
    const sz = (r / 0.48) * rng.r(0.92, 1.08) * (i === 0 ? 1 : 0.8);
    fx.alp.at(x, y + i * 0.003, z).size(sz * 0.65, sz).life(life).delay(delay).col(tint, a, tint, a * 0.9).art(art).mode(M.ground).rot(rot, 0).fade(0, FO.late, SC.out).emit();
    // the hot seam: glowing while the crack opens, cooling to the scar
    if (hot > 0) fx.add.at(x, y + 0.012 + i * 0.003, z).size(sz * 0.65, sz).life(hot).delay(delay).col(glow, hotA, glow, 0).int(1.3).art(art).mode(M.ground).rot(rot, 0).fade(0, FO.quad, SC.out).emit();
  }
}






export function flames(fx: Fx, x: number, y: number, z: number, n: number, radius: number, h: number, w: number, life0: number, life1: number, hot: number, cool: number, bodyHex: number, a = 0.9, int = 1.6, delay = 0): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const ang = rng.f() * TAU;
    const r = radius * rng.r(0.45, 1);
    const px = x + Math.sin(ang) * r;
    const pz = z + Math.cos(ang) * r;
    const hh = h * rng.r(0.75, 1.2);
    const qw = (w * rng.r(0.8, 1.2)) / 0.62;
    const qh = hh / 0.55;
    const asp = qh / qw;
    const lf = rng.r(life0, life1);
    const dl = delay + rng.r(0, 0.12);
    const vx = rng.s2(0.25);
    const vz = rng.s2(0.25);
    const by = y - qh * 0.22;
    fx.alp.at(px, by + 0.03, pz).vel(vx, 0.35, vz).life(lf * 1.05).delay(dl).size(qw * 1.04, qw * 0.88).stretch(asp * 1.04).col(bodyHex, a * 0.8, mixHex(bodyHex, 0x000000, 0.5), 0)
      .art(BOSS_ART.flameAura).mode(M.upright).wob(0.08).fade(1, FO.quad).emit();
    fx.add.at(px, by + 0.05, pz).vel(vx, 0.4, vz).life(lf).delay(dl).size(qw * 0.98, qw * 0.84).stretch(asp).col(hot, a * 0.95, cool, 0).int(int)
      .art(BOSS_ART.flameAura).mode(M.upright).wob(0.08).fade(1, FO.quad).emit();
  }
}

/** wind streaks racing out along the ground from the centre (the roar of a phase change / a nova) */
export function windOut(fx: Fx, x: number, z: number, n: number, r0: number, r1: number, life: number, len: number, hex: number, a = 0.55, int = 1.2, delay = 0): void {
  const rng = fx.rng;
  const y = lay(fx, x, z, r1) + 0.09;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU + rng.s2(0.25);
    const rr = r0 * rng.r(0.8, 1.2);
    fx.add.at(x + Math.sin(ang) * rr, y, z + Math.cos(ang) * rr).vel(Math.sin(ang) * (r1 - r0) / life, 0, Math.cos(ang) * (r1 - r0) / life).life(life * rng.r(0.8, 1.15)).delay(delay + rng.r(0, 0.08))
      .size(len * 0.5, len * rng.r(0.8, 1.2)).col(hex, a, hex, 0).int(int).art(BOSS_ART.windStreak).mode(M.ground).rot(Math.PI * 0.5 - ang, 0).fade(0, FO.quad).emit();
  }
}

/** a twisting smoke streamer standing up inside a plume (the r1 generated column sprite; upright, additive on a dark alpha body) */
export function streamers(fx: Fx, x: number, y: number, z: number, n: number, height: number, life: number, bodyHex: number, glowHex: number, a = 0.8, aGlow = 0.5, delay = 0, ringR = 0, art: KitArt = BOSS_ART.column): void {
  const rng = fx.rng;
  const body = mixHex(bodyHex, 0x9a8a7c, 0.3);
  for (let i = 0; i < n; i++) {
    const h = height * rng.r(0.85, 1.15);
    const ang = (i / n) * TAU + rng.s2(0.6);
    const rr = ringR > 0 ? ringR * rng.r(0.8, 1.2) : 0;
    const ox = Math.sin(ang) * rr + rng.s2(h * 0.06);
    const oz = Math.cos(ang) * rr + rng.s2(h * 0.05);
    const d = delay + i * 0.05 + rng.r(0, 0.05);
    const w0 = h * 0.5;
    fx.alp.at(x + ox, y - w0 * 1.15 * 0.035, z + oz).vel(rng.s2(0.25), h * 0.05, rng.s2(0.25)).size(w0, h * 0.8).stretch(1.15).life(life * rng.r(0.9, 1.15)).delay(d)
      .col(body, a, body, a * 0.25).art(art).mode(M.upright).fade(1, FO.late).emit();
    if (aGlow > 0)
      fx.add.at(x + ox * 0.7, y - w0 * 0.03, z + oz * 0.7).vel(0, h * 0.08, 0).size(h * 0.38, h * 0.62).stretch(1.3).life(life * 0.7).delay(d + 0.03)
        .col(glowHex, aGlow, glowHex, 0).int(1.6).art(art).mode(M.upright).fade(1, FO.quad).emit();
  }
}

// ---------------------------------------------------------------------------------------------------------------- r3: star-burst, motes, pit, aura

/** options of `rayBurst` (all optional) */
export interface RayOpts {
  /** the ray ring's sprite (tips at R) */
  ring?: RingArt;
  /** the flare core's sprite */
  flare?: KitArt;
  /** seconds of the ring (the flare lives 0.6 x this) */
  life?: number;
  /** height of the flare above y (m) */
  h?: number;
  /** flare width (m) */
  fs?: number;
  /** the flare stands this far toward the camera (+z) of the point: a flare at the boss's feet is hidden by the body model, in front of it it reads */
  fz?: number;
  /** ring start radius as a share of R */
  r0?: number;
  a?: number;
  int?: number;
  delay?: number;
  /** ring spin (rad/s) */
  spin?: number;
}






export function rayBurst(fx: Fx, x: number, y: number, z: number, R: number, hex: number, edge: number, o: RayOpts = {}): void {
  const rng = fx.rng;
  const ring = o.ring ?? BOSS_RING_ART.rayHazy;
  const flare = o.flare ?? BOSS_ART.flareDense;
  const life = o.life ?? 0.28;
  const a = o.a ?? 0.9;
  const int = o.int ?? 1.5;
  const d = o.delay ?? 0;
  const r0 = o.r0 ?? 0.25;
  const spin = o.spin ?? rng.s2(0.7);
  const rot = rng.f() * TAU;
  const gy = lay(fx, x, z, R) + 0.07;
  const hot = mixHex(hex, 0xffffff, 0.5);
  // the ring keeps more of the element's hue than the white-hot flare
  const ringHot = mixHex(hex, 0xffffff, 0.25);
  // the ring of rays on the floor: an alpha body in the saturated edge hue + the additive light; it holds its brightness and goes out at the end (FO.late)
  fx.alp.at(x, gy - 0.012, z).size((R * r0) / ring.pk, R / ring.pk).life(life * 1.15).delay(d).col(edge, a * 0.85, edge, 0).art(ring).mode(M.ground).rot(rot, spin).fade(0, FO.late, SC.out).emit();
  fx.add.at(x, gy, z).size((R * r0) / ring.pk, R / ring.pk).life(life).delay(d).col(ringHot, a, hex, 0).int(int).art(ring).mode(M.ground).rot(rot, spin).fade(0, FO.late, SC.out).emit();
  // the flare core: rays round a white-hot hub, screen-facing, short, standing toward the camera of the point
  const fs = o.fs ?? R * 0.9;
  const fy = y + (o.h ?? 0.8);
  const fz = z + (o.fz ?? 0);
  const fr = rng.f() * TAU;
  fx.alp.at(x, fy, fz).size(fs * 0.8, fs * 1.15).life(life * 0.8).delay(d).col(edge, 0.7, edge, 0).art(flare).rot(fr, rng.s2(0.5)).fade(0, FO.cubic, SC.out).emit();
  fx.add.at(x, fy, fz).size(fs * 0.7, fs * 1.1).life(life * 0.65).delay(d).col(hot, 1, hex, 0).int(int * 1.3).art(flare).rot(fr, rng.s2(0.5)).fade(0, FO.cubic, SC.out).emit();
  fx.add.at(x, fy, fz).size(fs * 0.3, fs * 0.5).life(life * 0.5).delay(d).col(mixHex(hex, 0xffffff, 0.8), 1, hex, 0).int(1.9).art(BOSS_ART.hotcore).fade(0, FO.cubic, SC.out).emit();
}

/** round soft glowing motes drifting up (no hard + / x glints): additive pips that twinkle and cool from `hex0` to `hex1` */
export function motes(fx: Fx, x: number, y: number, z: number, n: number, radius: number, height: number, life0: number, life1: number, size: number, hex0: number, hex1: number, delay = 0, int = 1.6): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * radius;
    const sz = size * rng.r(0.5, 1.3);
    fx.add.at(x + Math.sin(a) * r, y + rng.r(0, height), z + Math.cos(a) * r).vel(rng.s2(0.25), rng.r(0.3, 1.1), rng.s2(0.25)).life(rng.r(life0, life1)).delay(delay + rng.r(0, life0 * 0.6))
      .size(sz * 0.5, sz).col(hex0, 1, hex1, 0).int(int).spr(SPR.glow).twinkle().fade(1, FO.quad, SC.bell).emit();
  }
}

/** ice sparkle: soft six-point frost stars (the generated `starburst_frost`) twinkling in a disc; not the hard + / x of the kit's glints */
export function sparkle(fx: Fx, x: number, y: number, z: number, n: number, radius: number, height: number, life0: number, life1: number, size: number, hex0: number, hex1: number, delay = 0, int = 1.8): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * radius;
    const sz = size * rng.r(0.6, 1.3);
    fx.add.at(x + Math.sin(a) * r, y + rng.r(0, height), z + Math.cos(a) * r).vel(rng.s2(0.1), rng.r(0.05, 0.4), rng.s2(0.1)).life(rng.r(life0, life1)).delay(delay + rng.r(0, life0 * 0.5))
      .size(sz * 0.6, sz).col(hex0, 1, hex1, 0).int(int).art(BOSS_ART.starFrost).rot(rng.f() * TAU, rng.s2(1.4)).twinkle().fade(1, FO.quad, SC.bell).emit();
  }
}

/**
 * An impact pit that LIVES (the r2 crater decal was a frozen dust donut): a dark soft pit that snaps open, a ring of dust puffs thrown up off its lip
 * that settle, and the cooling of both over `life`. `pitHex` = the floor's own dark shade of the element (never an ink blot on snow).
 */
export function pit(fx: Fx, x: number, z: number, r: number, life: number, pitHex: number, dust: number, delay = 0): void {
  const rng = fx.rng;
  const y = lay(fx, x, z, r * 1.3) + 0.04;
  fx.alp.at(x, y, z).size(r * 1.5, r * 2.2).life(life).delay(delay).col(pitHex, 0.62, pitHex, 0.3).art(BOSS_ART.smudge).mode(M.ground).rot(rng.f() * TAU, 0).fade(0, FO.late, SC.out).emit();
  fx.alp.at(x, y + 0.004, z).size(r * 1.1, r * 1.6).life(life * 0.8).delay(delay).col(mixHex(pitHex, 0x000000, 0.25), 0.5, pitHex, 0.2).art(BOSS_ART.puffHaze).mode(M.ground).rot(rng.f() * TAU, 0).fade(0, FO.late, SC.out).emit();
  const n = 8;
  const a0 = rng.f() * TAU;
  for (let i = 0; i < n; i++) {
    const ang = a0 + (i / n) * TAU + rng.s2(0.3);
    const rr = r * rng.r(0.65, 0.95);
    fx.alp.at(x + Math.sin(ang) * rr, y + r * 0.2, z + Math.cos(ang) * rr).vel(Math.sin(ang) * rng.r(0.5, 1.3), rng.r(0.8, 1.8), Math.cos(ang) * rng.r(0.5, 1.3)).life(rng.r(0.55, 0.95)).delay(delay + rng.r(0, 0.06))
      .size(r * 0.55, r * rng.r(1.2, 1.7)).col(dust, 0.6, dust, 0.15).art(DUST_SET[rng.i(DUST_SET.length)] as KitArt).rot(rng.f() * TAU, rng.s2(0.8)).drag(1.9).fade(1, FO.quad, SC.out).emit();
  }
}

/**
 * One puff of the enrage aura: smoke turning round a body. Born on the ring hugging the body (`R` x 0.7-1.05), carrying the body's own velocity (`vx, vz`, so a
 * walking boss keeps it instead of leaving a wake a body-width behind), orbiting at `spin` m/s and rising; `body` alpha + (when `glow` >= 0) a smaller
 * additive twin. `h` = the body's height: puffs start along its lower two thirds.
 */
export function orbitSmoke(fx: Fx, x: number, y: number, z: number, vx: number, vz: number, R: number, h: number, spin: number, body: number, glow: number, a: number, s0: number, s1: number, life0: number, life1: number): void {
  const rng = fx.rng;
  // over half of the puffs are born on the camera side of the body (+z): the ones behind a large model are hidden by it, so the aura would sit on one side
  const ang = rng.f() < 0.55 ? rng.s2(1.2) : rng.f() * TAU;
  const rr = R * rng.r(0.7, 1.05);
  const sx = Math.sin(ang);
  const sz = Math.cos(ang);
  const tx = sz * spin * rng.r(0.8, 1.2);
  const tz = -sx * spin * rng.r(0.8, 1.2);
  const lf = rng.r(life0, life1);
  const py = y + h * rng.r(0.05, 0.75);
  const up = rng.r(0.9, 1.8);
  const sa = s0 * rng.r(0.85, 1.2);
  fx.alp.at(x + sx * rr, py, z + sz * rr).vel(vx * 0.92 + tx, up, vz * 0.92 + tz).life(lf).size(sa, s1 * rng.r(0.85, 1.15))
    .col(body, a, mixHex(body, 0x000000, 0.2), a * 0.2).art(AURA_BODY[rng.i(AURA_BODY.length)] as KitArt).rot(rng.f() * TAU, rng.s2(0.7)).drag(0.9).fade(1, FO.late, SC.out).emit();
  if (glow >= 0 && rng.f() < 0.8) {
    fx.add.at(x + sx * rr, py, z + sz * rr).vel(vx * 0.92 + tx, up * 1.1, vz * 0.92 + tz).life(lf * 0.6).size(sa * 0.6, s1 * 0.65).col(glow, Math.min(1, a * 1.1), glow, 0).int(1.7)
      .art(GLOW_SOFT[rng.i(GLOW_SOFT.length)] as KitArt).rot(rng.f() * TAU, rng.s2(0.9)).drag(0.9).fade(1, FO.quad, SC.out).emit();
  }
}

/**
 * One streamer of the enrage aura: a tall twisting smoke column (the generated teleport column, a bright narrow core with smoke wound round it) standing at
 * the body and carried round it, so the aura reads as smoke WINDING round the body, not as a few round puffs. `body` alpha + an additive twin in `glow`.
 */
export function orbitStreamer(fx: Fx, x: number, y: number, z: number, vx: number, vz: number, R: number, h: number, spin: number, body: number, glow: number, a: number, life0: number, life1: number): void {
  const rng = fx.rng;
  const ang = rng.f() < 0.55 ? rng.s2(1.2) : rng.f() * TAU;
  const rr = R * rng.r(0.85, 1.1);
  const sx = Math.sin(ang);
  const sz = Math.cos(ang);
  const tx = sz * spin * rng.r(0.8, 1.2);
  const tz = -sx * spin * rng.r(0.8, 1.2);
  const hh = h * rng.r(0.8, 1.2);
  const w = hh / 1.4;
  const lf = rng.r(life0, life1);
  const px = x + sx * rr;
  const pz = z + sz * rr;
  fx.alp.at(px, y - w * 0.03, pz).vel(vx * 0.92 + tx, 0.25, vz * 0.92 + tz).life(lf).size(w * 0.8, w * 1.1).stretch(1.4).col(body, a, body, a * 0.2).art(BOSS_ART.tpColumn).mode(M.upright).drag(0.9).fade(1, FO.late).emit();
  fx.add.at(px, y - w * 0.02, pz).vel(vx * 0.92 + tx, 0.35, vz * 0.92 + tz).life(lf * 0.7).size(w * 0.7, w * 0.95).stretch(1.4).col(glow, a * 0.9, glow, 0).int(1.5).art(BOSS_ART.tpColumn).mode(M.upright).drag(0.9).fade(1, FO.quad).emit();
}

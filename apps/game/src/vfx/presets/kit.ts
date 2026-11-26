// Building blocks shared by presets. Everything is expressed in metres/seconds and allocates nothing.
import { KIT_ART } from '../common/kitArt';
import { FLASH_INT_MAX, FO, M, PAT, SC, type Ctx, type Fx, type KitArt } from '../emit';
import type { Palette } from '../palette';
import { SPR, FB } from '../textures';
import { TAU } from '../util';

// C4 soft kit (2026-10-13): haloRing / shockRing / pillar / flash keep their signatures but draw soft, feathered shapes

// (gallery `?legacyKit=1`) restores the old look for A/B. vfx/common/** must not use PAT.cracks (commonNoCracks.test.ts).
// C3 bridge: smoke / dustRing and the 2026-10-19 helpers (ringArc, glints, cinders, groundFlare, crackHeat, stain, crater,
// lightShaft, pillarCross, rocks) draw GENERATED sprites of the spec art array (common/kitArt.ts KIT_ART, PBuilder.art) and
// fall back to the procedural atlas while a sprite is not packed. New helpers change no existing preset by themselves.

/** glowRing's bright band sits at 0.72 of the sprite radius vs ringThin's 0.94: scale so the ring keeps its radius */
const HALO_SOFT_K = 0.94 / 0.72;

/** big soft additive glow */
export function glow(fx: Fx, x: number, y: number, z: number, s0: number, s1: number, life: number, hex: number, a = 1, int = 1.5, delay = 0): void {
  fx.add.at(x, y, z).size(s0, s1).life(life).delay(delay).col(hex, a, hex, 0).int(int).spr(SPR.glow).fade(0, FO.quad).emit();
}

/** hot, tight additive flash (intensity clamped to FLASH_INT_MAX unless fx.legacyKit: stacked flashes must not white out) */
export function flash(fx: Fx, x: number, y: number, z: number, s0: number, s1: number, life: number, hex: number, int = 3, delay = 0): void {
  const k = fx.legacyKit ? int : Math.min(int, FLASH_INT_MAX);
  fx.add.at(x, y, z).size(s0, s1).life(life).delay(delay).col(hex, 1, hex, 0).int(k).spr(SPR.glowTight).fade(0, FO.cubic, SC.out).emit();
}

/** soft expanding billboard ring (camera-facing): wide feathered band (glowRing), not a hairline circle */
export function haloRing(fx: Fx, x: number, y: number, z: number, s0: number, s1: number, life: number, hex: number, a = 0.8, int = 1.4, delay = 0): void {
  if (fx.legacyKit) {
    fx.add.at(x, y, z).size(s0, s1).life(life).delay(delay).col(hex, a, hex, 0).int(int).spr(SPR.ringThin).fade(0, FO.quad, SC.out).emit();
    return;
  }
  fx.add.at(x, y, z).size(s0 * HALO_SOFT_K, s1 * HALO_SOFT_K).life(life).delay(delay).col(hex, a * 0.85, hex, 0).int(int)
    .spr(SPR.glowRing).fade(0, FO.quad, SC.out).emit();
}

/** velocity-stretched sparks sprayed around direction (dx,dz) (dx=dz=0 → all around) */
export function sparks(
  fx: Fx, x: number, y: number, z: number, n: number, vMin: number, vMax: number, up: number,
  life0: number, life1: number, width: number, hex0: number, hex1: number, dx = 0, dz = 0, spread = 1, int = 2, grav = -9, delay = 0,
): void {
  const rng = fx.rng;
  const cone = dx !== 0 || dz !== 0;
  const base = cone ? Math.atan2(dx, dz) : 0;
  for (let i = 0; i < n; i++) {
    const a = cone ? base + rng.s2(spread * Math.PI * 0.5) : rng.f() * TAU;
    const v = rng.r(vMin, vMax);
    fx.add.at(x, y, z)
      .vel(Math.sin(a) * v, rng.r(0.15, 1) * up * v * 0.5 + rng.r(0, up), Math.cos(a) * v)
      .life(rng.r(life0, life1)).delay(delay).size(width, width * 0.3).stretch(0.045)
      .col(hex0, 1, hex1, 0).int(int).spr(SPR.streak).mode(M.streak).drag(3.2).grav(grav).fade(0, FO.cubic).emit();
  }
}

/** glowing embers drifting up (or any v) */
export function embers(fx: Fx, x: number, y: number, z: number, n: number, radius: number, rise: number, life0: number, life1: number, size: number, hex0: number, hex1: number, delay = 0, int = 2.2): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * radius;
    fx.add.at(x + Math.sin(a) * r, y, z + Math.cos(a) * r)
      .vel(rng.s2(0.6), rise * rng.r(0.6, 1.3), rng.s2(0.6)).life(rng.r(life0, life1)).delay(delay)
      .size(size * rng.r(0.7, 1.3), size * 0.2).col(hex0, 1, hex1, 0).int(int)
      .spr(rng.f() < 0.5 ? SPR.ember0 : SPR.ember1).rot(rng.f() * TAU, rng.s2(3)).drag(0.6).wob(0.18).twinkle().fade(1, FO.quad).emit();
  }
}

/** generated smoke puffs (alpha): sparse dust, grainy clump, dense billow, picked per puff */
const SMOKE_ART: readonly KitArt[] = [KIT_ART.smokeDust, KIT_ART.smokeClump, KIT_ART.smokeBillow, KIT_ART.smokeClump];
/** the art puffs read denser than the old procedural ones: alpha scale */
const SMOKE_ART_A = 1.12;

/**
 * alpha smoke / dust puffs rising from a point. Soft kit: generated smoke sprites (C3 bridge); pass `cell` (a SPR.* base of
 * 4 variants) to force a procedural atlas sprite, as before.
 */
export function smoke(fx: Fx, x: number, y: number, z: number, n: number, radius: number, rise: number, life0: number, life1: number, s0: number, s1: number, hex: number, a = 0.5, delay = 0, cell = -1): void {
  const rng = fx.rng;
  const art = cell < 0 && fx.hasArt(KIT_ART.smokeClump);
  for (let i = 0; i < n; i++) {
    const ang = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * radius;
    const b = fx.alp.at(x + Math.sin(ang) * r, y, z + Math.cos(ang) * r)
      .vel(rng.s2(0.5), rise * rng.r(0.6, 1.2), rng.s2(0.5)).life(rng.r(life0, life1)).delay(delay)
      .size(s0 * rng.r(0.8, 1.2), s1 * rng.r(0.85, 1.25)).col(hex, art ? Math.min(1, a * SMOKE_ART_A) : a, hex, 0);
    if (art) b.art(SMOKE_ART[rng.i(SMOKE_ART.length)] as KitArt);
    else b.spr((cell < 0 ? SPR.smoke0 : cell) + rng.i(4));
    b.rot(rng.f() * TAU, rng.s2(0.6)).drag(1.4).fade(2, FO.sq, SC.out).emit();
  }
}

/** radial dust ring on the ground: puffs shooting outward (soft kit: generated dust sprites, C3 bridge) */
export function dustRing(fx: Fx, x: number, y: number, z: number, n: number, r: number, life: number, hex: number, a = 0.55, size = 0.9, delay = 0): void {
  const rng = fx.rng;
  const art = fx.hasArt(KIT_ART.smokeDust);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU + rng.s2(0.25);
    const sp = (r / life) * rng.r(0.85, 1.25) * 1.7;
    const b = fx.alp.at(x + Math.sin(ang) * r * 0.1, y + 0.12, z + Math.cos(ang) * r * 0.1)
      .vel(Math.sin(ang) * sp, rng.r(0.2, 0.9), Math.cos(ang) * sp).life(life * rng.r(0.8, 1.2)).delay(delay)
      .size(size * 0.5, size * rng.r(1.4, 2.1)).col(hex, art ? Math.min(1, a * SMOKE_ART_A) : a, hex, 0);
    if (art) b.art(rng.f() < 0.55 ? KIT_ART.smokeDust : KIT_ART.smokeClump);
    else b.spr(SPR.dust0 + rng.i(2));
    b.rot(rng.f() * TAU, rng.s2(0.8)).drag(2.6).fade(1, FO.sq, SC.out).emit();
  }
}

/** expanding ground shock ring (shape batch). `r` = final outer radius. Soft kit: feathered noisy band (PAT.ringSoft) */
export function shockRing(fx: Fx, x: number, z: number, r: number, life: number, pal: Palette, thickness = 0.2, int = 1.6, delay = 0, minBand = 0.3): void {
  const pat = fx.legacyKit ? PAT.ring : PAT.ringSoft;
  // the soft band needs some width to read as a band: at least `minBand` (0.3) of the radius (the legacy lip drew at any thickness); the awakening nova passes a thin one
  const th = fx.legacyKit ? thickness : Math.max(thickness, minBand);
  fx.shp.ground(x, z, 0.06).ring(r * (1 - th), r).expand(0.1).pat(pat).life(life).delay(delay).col(pal.main, 1, pal.edge, 1).int(int).fade(FO.sq).shrink(0.5).seed(fx.rng.f() * 10).emit();
}

/** debris chunks flying out */
export function chunks(fx: Fx, x: number, y: number, z: number, n: number, speed: number, size: number, hex0: number, hex1: number, glow = 0, life = 1.1, floorY = 0, delay = 0): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const v = speed * rng.r(0.5, 1.1);
    fx.db.at(x, y, z).vel(Math.sin(a) * v, speed * rng.r(0.5, 1.3), Math.cos(a) * v).sz(size * rng.r(0.6, 1.3)).col(hex0, hex1)
      .glow(glow).life(life * rng.r(0.8, 1.2)).floor(floorY).delay(delay).emit();
  }
}

/** small fire flipbook burst (additive, heat-ramped) */
export function fireBurst(fx: Fx, x: number, y: number, z: number, size: number, life: number, pal: Palette, int = 1.8, delay = 0): void {
  fx.add.at(x, y, z).size(size * 0.5, size).life(life).delay(delay).col(pal.main, 1, pal.edge, 1).int(int).spr(FB.fire).frames(16).ramp()
    .rot(fx.rng.f() * TAU).fade(0, FO.late).emit();
}

/** smoke flipbook puff (alpha, heat = lighting) */
export function smokeBurst(fx: Fx, x: number, y: number, z: number, size: number, life: number, light: number, dark: number, a = 0.8, delay = 0, rise = 0.6): void {
  fx.alp.at(x, y, z).vel(0, rise, 0).size(size * 0.7, size).life(life).delay(delay).col(light, a, dark, 0).spr(FB.smoke).frames(16).ramp()
    .rot(fx.rng.f() * TAU).drag(1.2).fade(1, FO.sq).emit();
}

/** swirl / energy flipbook burst (additive) */
export function swirlBurst(fx: Fx, x: number, y: number, z: number, size: number, life: number, pal: Palette, int = 1.8, delay = 0): void {
  fx.add.at(x, y, z).size(size * 0.45, size).life(life).delay(delay).col(pal.core, 1, pal.main, 1).int(int).spr(FB.swirl).frames(16).ramp()
    .rot(fx.rng.f() * TAU, fx.rng.s2(1.5)).fade(0, FO.late).emit();
}

/** wisps drifting up (souls, steam, corruption) */
export function wisps(fx: Fx, x: number, y: number, z: number, n: number, radius: number, rise: number, life0: number, life1: number, size: number, hex0: number, hex1: number, delay = 0, int = 1.6): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * radius;
    fx.add.at(x + Math.sin(a) * r, y, z + Math.cos(a) * r)
      .vel(rng.s2(0.25), rise * rng.r(0.7, 1.3), rng.s2(0.25)).life(rng.r(life0, life1)).delay(delay)
      .size(size * 0.7, size * rng.r(1.0, 1.4)).col(hex0, 0.9, hex1, 0).int(int).spr(SPR.wisp).mode(M.upright).stretch(1.6)
      .wob(0.35).drag(0.5).fade(2, FO.sq).emit();
  }
}

/** keeps rune glyph sprites floating above a point */
export function runeMotes(fx: Fx, x: number, y: number, z: number, n: number, radius: number, rise: number, life0: number, life1: number, size: number, hex: number, delay = 0, int = 1.6): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * radius;
    fx.add.at(x + Math.sin(a) * r, y, z + Math.cos(a) * r)
      .vel(0, rise * rng.r(0.7, 1.2), 0).life(rng.r(life0, life1)).delay(delay).size(size * 0.8, size).col(hex, 0.9, hex, 0).int(int)
      .spr(SPR.rune0 + rng.i(8)).rot(rng.s2(0.6), rng.s2(0.8)).drag(0.4).fade(2, FO.sq).emit();
  }
}

/** vertical light column (pillar shape). Soft kit: no cap rim, streak noise scrolling up, tapered top (PAT.pillarSoft) */
export function pillar(fx: Fx, x: number, z: number, radius: number, height: number, life: number, pal: Palette, int = 1.6, delay = 0): number {
  const pat = fx.legacyKit ? PAT.pillar : PAT.pillarSoft;
  return fx.shp.ground(x, z, 0).cyl(radius, radius * 0.55, height).pat(pat).life(life).delay(delay).col(pal.core, 1, pal.main, 1).int(int).fade(FO.sq).expand(0.35).seed(fx.rng.f() * 10).emit();
}

/** burnt/stain ground decal (alpha batch) */
export function scorch(fx: Fx, x: number, z: number, r: number, life: number, dark: number, glowHex: number, pat: number = PAT.scorch, delay = 0): void {
  fx.dec.ground(x, z, 0.02).disk(r).pat(pat).life(life).delay(delay).col(glowHex, 1, dark, 0.8).fade(FO.late).seed(fx.rng.f() * 10).emit();
}

// ---------------------------------------------------------------------------------------------------------------------
// C4 remainder (2026-10-19): helpers the rebuilt presets use. All sizes in metres, all draw on the existing batches.

/**
 * Broken glowing arcs ringing a ground point (the click-select ring): `r0` → `r1` ring radius over `life`, turning at `spin`
 * rad/s. Generated arc sprite (`ring_arcs_select_a`: ring radius 0.345 of the quad); procedural dashed ring until it is
 * packed. Stack two with opposite spin for a double ring.
 */
export function ringArc(fx: Fx, x: number, z: number, r0: number, r1: number, life: number, hex: number, a = 0.9, int = 1.5, spin = 2.4, delay = 0, lift = 0.06): void {
  const k = fx.hasArt(KIT_ART.ringArcs) ? 1 / 0.345 : 1 / 0.47;
  fx.add.at(x, fx.heightAt(x, z) + lift, z).size(r0 * k, r1 * k).life(life).delay(delay).col(hex, a, hex, 0).int(int)
    .art(KIT_ART.ringArcs).mode(M.ground).rot(fx.rng.f() * TAU, spin).fade(0, FO.quad, SC.out).emit();
}

/** twinkling 4-point glints scattered through a disk of `radius` and `height` above (x, y, z): sparkle dust on treasure, holy ground, ice */
export function glints(fx: Fx, x: number, y: number, z: number, n: number, radius: number, height: number, life0: number, life1: number, size: number, hex0: number, hex1: number = hex0, delay = 0, int = 2): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * radius;
    const pick = rng.f();
    const sz = size * rng.r(0.6, 1.25);
    const b = fx.add.at(x + Math.sin(a) * r, y + rng.r(0, height), z + Math.cos(a) * r)
      .vel(rng.s2(0.08), rng.r(0.05, 0.3), rng.s2(0.08)).life(rng.r(life0, life1)).delay(delay + rng.r(0, life0 * 0.5))
      .size(sz * 0.2, sz).col(hex0, 1, hex1, 0).int(int);
    // the generated pin glint carries most of them; plain 4-point crosses / sparkles (atlas) vary the field
    if (pick < 0.6) b.art(KIT_ART.glintPin);
    else b.spr(pick < 0.85 ? SPR.cross : SPR.sparkle);
    b.rot(rng.s2(0.35), rng.s2(0.8)).twinkle().fade(1, FO.quad, SC.bell).emit();
  }
}

/** glowing ash cinders drifting up and cooling from `hexHot` to `hexCool` (burnt ground, forges, lava edges); `size` ~ visible width */
export function cinders(fx: Fx, x: number, y: number, z: number, n: number, radius: number, rise: number, life0: number, life1: number, size: number, hexHot: number, hexCool: number, delay = 0, int = 1.8): void {
  const rng = fx.rng;
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const r = Math.sqrt(rng.f()) * radius;
    fx.add.at(x + Math.sin(a) * r, y, z + Math.cos(a) * r).vel(rng.s2(0.5), rise * rng.r(0.5, 1.2), rng.s2(0.5)).life(rng.r(life0, life1)).delay(delay)
      .size(size * 1.7 * rng.r(0.6, 1.3), size * 0.5).col(hexHot, 1, hexCool, 0).int(int).spr(rng.f() < 0.5 ? SPR.ember0 : SPR.ember1)
      .rot(rng.f() * TAU, rng.s2(3)).drag(0.7).wob(0.22).twinkle().fade(1, FO.quad).emit();
  }
}

/**
 * Flat radial flare on the ground (burst of fine spikes around a hub) growing from 0.35 r to r: arrival rings, shrine
 * strikes, chest bursts. Generated spike sprite (`rayring_ground_burst_a`: spike tips at 0.39 of the quad) + a soft hub glow.
 */
export function groundFlare(fx: Fx, x: number, z: number, r: number, life: number, hex: number, int = 1.6, delay = 0): void {
  const y = fx.heightAt(x, z) + 0.05;
  const k = fx.hasArt(KIT_ART.groundBurst) ? 1 / 0.39 : 1 / 0.47;
  fx.add.at(x, y, z).size(r * k * 0.35, r * k).life(life).delay(delay).col(hex, 0.95, hex, 0).int(int)
    .art(KIT_ART.groundBurst).mode(M.ground).rot(fx.rng.f() * TAU, fx.rng.s2(0.5)).fade(0, FO.quad, SC.out).emit();
  fx.add.at(x, y, z).size(r * 0.7, r * 1.35).life(life * 0.8).delay(delay).col(hex, 0.5, hex, 0).int(int * 0.7)
    .spr(SPR.glow).mode(M.ground).fade(0, FO.quad, SC.out).emit();
}

/**
 * Hot ground cracks that cool: branching ridged lines (thick at the impact, hairline at the rim) glowing `glowHex` from
 * white-hot to dull red over the first ~75 % of `life`, leaving charred `darkHex` scars until the decal fades. The soft kit
 * adds the generated crack scar (`crack_thorn_scorch_a`, full colour) under the procedural lines when it is packed.
 */
export function crackHeat(fx: Fx, x: number, z: number, r: number, life: number, darkHex: number, glowHex: number, int = 1.2, delay = 0): void {
  fx.dec.ground(x, z, 0.025).disk(r).pat(PAT.crackHeat).life(life).delay(delay).col(glowHex, 1, darkHex, 0.92).int(int).fade(FO.late).seed(fx.rng.f() * 10).emit();
  if (!fx.hasArt(KIT_ART.crackScar)) return;
  const rng = fx.rng;
  const y = fx.heightAt(x, z) + 0.03;
  const n = r > 2.2 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    // the scar is long and thin (0.97 x 0.53 of the quad): one per arm, turned apart
    const rot = rng.f() * TAU + (i * TAU) / n;
    fx.alp.at(x, y, z).size(r * 1.7, r * 2.0).life(life).delay(delay).col(0xffffff, 0.9, 0x5a4a42, 0.9).art(KIT_ART.crackScar).mode(M.ground).rot(rot, 0).fade(0, FO.late).emit();
  }
}

/** ground stain (blood, ichor, ooze, soot): noisy blob with a darker wet lip, mottled body and splatter drops; `shineHex` = wet glints */
export function stain(fx: Fx, x: number, z: number, r: number, life: number, bodyHex: number, shineHex: number, delay = 0): void {
  fx.dec.ground(x, z, 0.02).disk(r).pat(PAT.stain).life(life).delay(delay).col(shineHex, 1, bodyHex, 0.85).fade(FO.late).seed(fx.rng.f() * 10).emit();
}

/** impact crater: dark pit, raised dusty lip (`lipHex`), radial ejecta streaks */
export function crater(fx: Fx, x: number, z: number, r: number, life: number, pitHex: number, lipHex: number, delay = 0): void {
  fx.dec.ground(x, z, 0.022).disk(r).pat(PAT.crater).life(life).delay(delay).col(lipHex, 1, pitHex, 0.9).fade(FO.late).seed(fx.rng.f() * 10).emit();
}

/**
 * Light shafts rising from the ground: two layered generated shaft curtains (upright, always facing the camera
 * horizontally), `width` wide and `height` tall, drifting up a little. Soft streak fallback until the sprites are packed.
 */
export function lightShaft(fx: Fx, x: number, y: number, z: number, width: number, height: number, life: number, hex: number, a = 0.8, int = 1.5, delay = 0): void {
  for (let i = 0; i < 2; i++) {
    // two parallax layers of the same curtain: the second is narrower, shifted, shorter-lived and a little lower in alpha
    const w = width * (i === 0 ? 1 : 0.78);
    // the sprite leaves 0.11 of its height empty below the shaft roots
    fx.add.at(x + (i === 0 ? 0 : width * 0.18) + fx.rng.s2(width * 0.04), y - height * 0.11, z + fx.rng.s2(width * 0.04)).vel(0, height * (i === 0 ? 0.06 : 0.1), 0)
      .size(w, w).stretch((height * (i === 0 ? 1 : 0.85)) / w).life(life * (i === 0 ? 1 : 0.85)).delay(delay + i * 0.05).col(hex, a * (i === 0 ? 1 : 0.8), hex, 0).int(int)
      .art(KIT_ART.shafts).mode(M.upright).fade(1, FO.sq).emit();
  }
}

/**
 * Light column from CROSSED vertical planes (PAT.pillarPlane): no hollow cylinder interior and no cap rim, so it reads at
 * the 55° game camera from any heading. `planes` planes are spread evenly over 180°; returns the first shape slot.
 */
export function pillarCross(fx: Fx, x: number, z: number, radius: number, height: number, life: number, pal: Palette, int = 1.6, delay = 0, planes = 2): number {
  const yaw0 = fx.rng.f() * Math.PI;
  let first = -1;
  for (let k = 0; k < planes; k++) {
    const slot = fx.shp.ground(x, z, 0).plane(radius * 2.2, height).yaw_(yaw0 + (k * Math.PI) / planes).pat(PAT.pillarPlane).life(life).delay(delay)
      .col(pal.core, 1, pal.main, 1).int(int).fade(FO.sq).expand(0.35).seed(fx.rng.f() * 10).emit();
    if (first < 0) first = slot;
  }
  return first;
}

/** a darker shade of a hex colour (debris fallback far colour) */
function darker(hex: number): number {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return (Math.round(r * 0.55) << 16) | (Math.round(g * 0.55) << 8) | Math.round(b * 0.55);
}

/**
 * Rock chunks thrown from a point: generated rock sprites (alpha, lit) falling under gravity and spinning, settling on
 * `floorY`; `tint` multiplies the rock grey. Falls back to the faceted debris cubes (`chunks`) until the sprites are packed.
 */
export function rocks(fx: Fx, x: number, y: number, z: number, n: number, speed: number, size: number, life = 1.2, floorY = 0, tint = 0xb8a890, delay = 0): void {
  const rng = fx.rng;
  if (!fx.hasArt(KIT_ART.rockFacet)) {
    chunks(fx, x, y, z, n, speed, size * 0.45, tint, darker(tint), 0, life, floorY, delay);
    return;
  }
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU;
    const v = speed * rng.r(0.5, 1.1);
    fx.alp.at(x, y, z).vel(Math.sin(a) * v, speed * rng.r(0.6, 1.4), Math.cos(a) * v).life(life * rng.r(0.8, 1.2)).delay(delay).floor(floorY)
      .size(size * rng.r(0.6, 1.3)).col(tint, 1, tint, 1).art(KIT_ART.rockFacet)
      .rot(rng.f() * TAU, rng.s2(7)).grav(-14).drag(0.35).fade(0, FO.snap).emit();
  }
}

export { M, FO, SC, PAT, SPR, FB, TAU };
export type { Ctx, Fx };

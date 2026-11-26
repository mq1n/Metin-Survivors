// Zone ambient particles `ambient.*` (common VFX target `ambient`; owner: the ambient builder). r1 2026-10-19 rebuild: the emoji snowflakes, 5-point-star embers, plus-shaped

// specks, mid clumps, near blurred bokeh, low ground drift) and blown by a travelling GUST wave so bands of wind cross the screen. Alpha-blended bodies carry the colour on

// Atmosphere itself (fog, cloud shadows, plumes, glitter decals) is the map domain: hand-off in notes.txt.
// r3 (2026-10-22): readable leaves (0.9-1.35 m, contrast against the stone), soft fluffy snow flakes (vfx_ambient_snow_soft_sheet), ragged ANGULAR ember chips (vfx_ambient_ember_chip_sheet), WARM-only sparks
// (the flame map has no cold glitter), granular dust veils for Suryeon's wind dust; the r1 / r2 sheets nobody draws any more are out of the art scope (structure.txt).
// r4 (upgrade AMB-01): the leaves are sized for the 55 deg gameplay camera (1 m ~ 67 px at zoom 22: a 0.9-1.4 m leaf was a 60-95 px paper cut-out): 0.25-0.5 m quads, a third of the old
// count, slower tumble, the near layer fades; ambient.leaves is spring (greens + white petals), ambient.leaves_autumn the Suryeon russet / amber / ochre fall, ambient.motes the sun
// motes that used to ride inside the leaves loop (a zone runs it as a second loop: PL-02 look.ambientLoops).
//
// Emitter: the camera-following box of the old version (unchanged contract: 52 m box, focus-velocity shift, density = fx.density, ids / zones.json keys unchanged).
import type { Fx, KitArt } from '../../emit';
import type { Inst } from '../../system';
import { FO, M, SC, SPR, TAU } from '../../presets/kit';
import type { PresetDef } from '../../presets/types';
import { AMBIENT_ART as A, grainCell, sheetSpr } from './art';

/** (x, z) is where the particle should be `af` (0..1) of its life from now; af = 0 → a fresh spawn */
type Spawn = (fx: Fx, x: number, z: number, af: number) => void;

/** the visible ground at the game camera is ~28 x 16 m: a 52 m box (scale 26, run.ts AMBIENT_RADIUS) spends 80 % of its particles off screen, so the box is capped at +-20 m (r1: ~2.5x the particles in view at the same cost) */
const BOX_MAX = 20;

/** spawn point scratch written by `boxPoint` */
let ax = 0;

let az = 0;

/** random point of the box: ±r around the centre in x, r behind … 0.55 r ahead (down-screen) in z, shifted toward the smoothed focus velocity */
function boxPoint(fx: Fx, c: Inst): void {
  const rng = fx.rng;
  const r = Math.min(c.radius, BOX_MAX);
  ax = c.x + Math.max(-10, Math.min(10, c.acc2 * 2.5)) + rng.s2(r);
  az = c.z + Math.max(-10, Math.min(10, c.acc3 * 2.5)) + rng.r(-r, r * 0.55);
}

/** pre-populates the box: `count` particles at random positions, each at a random point of its life */
function fill(fx: Fx, c: Inst, count: number, spawn: Spawn): void {
  const rng = fx.rng;
  const n = fx.n(count * c.intensity);
  for (let i = 0; i < n; i++) {
    boxPoint(fx, c);
    spawn(fx, ax, az, rng.f() * 0.97);
  }
}

/** moves the loop to the camera focus (when the host has one) */
function follow(c: Inst): void {
  const h = c.host;
  if (h !== null && (h.focusX !== 0 || h.focusZ !== 0)) {
    c.x = h.focusX;
    c.z = h.focusZ;
    c.y = h.focusY;
  }
}

function ambient(id: string, desc: string, rate: number, meanLife: number, spawn: Spawn): PresetDef {
  return {
    id,
    cat: 'ambient',
    desc,
    size: 'radius',
    base: 26,
    palette: 'dust',
    dur: 900,
    loop: true,
    demo: { loopFor: 30 },
    fire(fx, c) {
      const inst = c as Inst;
      follow(inst);
      inst.px = inst.x;
      inst.pz = inst.z;
      fill(fx, inst, rate * meanLife, spawn);
    },
    tick(fx, c, dt) {
      const px = c.x;
      const pz = c.z;
      follow(c);
      const dx = c.x - px;
      const dz = c.z - pz;
      if (dx * dx + dz * dz > 900) {
        // focus jumped (zone change / teleport): re-populate around the new position
        c.acc2 = 0;
        c.acc3 = 0;
        fill(fx, c, rate * meanLife, spawn);
      } else if (dt > 0) {
        const k = 1 - Math.exp(-dt * 2.5);
        c.acc2 += (dx / dt - c.acc2) * k;
        c.acc3 += (dz / dt - c.acc3) * k;
      }
      c.acc0 += dt * rate * fx.density * c.intensity;
      while (c.acc0 >= 1) {
        c.acc0 -= 1;
        boxPoint(fx, c);
        spawn(fx, ax, az, 0);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- wind
/** prevailing wind on the floor plane (unit): from screen-left to screen-right and a little down-screen, as the old leaves / dust drifted */
const WX = 0.93;

const WZ = 0.37;

/** gust multiplier 0.62..1.6 of the wind speed a particle born `age` s ago at (x, z) got: a slow travelling wave (period ~14 s, wavelength ~34 m, running with the wind), squared so calm stretches are long */
function gust(fx: Fx, x: number, z: number, age: number): number {
  const g = 0.5 + 0.5 * Math.sin((fx.time - age) * 0.45 - (x * WX + z * WZ) * 0.185);
  return 0.62 + 0.98 * g * g;
}

/** one alpha particle, straight from the emitter box (`age` pre-ages it so the box is already full at the start) */
function alp(fx: Fx, art: KitArt | number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, age: number, s0: number, s1: number, hex: number, a: number, spin = 0.5, wob = 0.25): void {
  const p = fx.alp.at(x - vx * age, y - vy * age, z - vz * age).vel(vx, vy, vz).life(life).delay(-age).size(s0, s1).rot(fx.rng.f() * TAU, fx.rng.s2(spin)).col(hex, a, hex, a);
  (typeof art === 'number' ? p.spr(art) : p.art(art)).wob(wob).fade(3, FO.late).emit();
}

// ---------------------------------------------------------------------------------------------------------------- Yeonmu / Suryeon leaves
/** a leaf palette: tints for the sheet's mid-grey leaves (cumulative weights), the share of petals (cell 3) and the sheet cell weights of the leaves (maple, birch blade, curled) */
interface LeafPalette {
  /** [cumulative weight 0..1, hex] */
  readonly tints: readonly (readonly [number, number])[];
  /** share of white-pink petals (0 for none) */
  readonly petals: number;
  /** cumulative weights of the leaf cells 0 maple, 1 birch blade, 2 curled leaf */
  readonly cells: readonly [number, number];
  /** leaf quad size range (m); petals have their own, the near layer tops out at 0.5 */
  readonly size: readonly [number, number];
  /** colour gain: the sheet's leaves are mid-grey, so a dark tint (russet) needs more than 1 to keep its saturation against dark grass */
  readonly gain: number;
}

/** spring (Yeonmu): a spread of fresh, mid, yellow and deep greens (the light ones read on shaded grass, the deep ones on the pale cobble and stone), with a good share of cream and pink cherry petals (pure white vanishes on the cobble) */
const SPRING: LeafPalette = {
  tints: [[0.3, 0x92c63a], [0.56, 0x6aa62e], [0.8, 0xb8d84c], [1, 0x4f8f26]],
  petals: 0.4,
  cells: [0.3, 0.7],
  size: [0.34, 0.5],
  gain: 1.25,
};

/** autumn (Suryeon): russet #a8461e, amber #e08a2a, ochre and a deep brown for depth; maples first, no petals */
const AUTUMN: LeafPalette = {
  tints: [[0.32, 0xa8461e], [0.62, 0xe08a2a], [0.88, 0xc99a2e], [1, 0x7a4a2a]],
  petals: 0,
  cells: [0.5, 0.78],
  size: [0.38, 0.5],
  gain: 1.5,
};

/**
 * One falling leaf or petal for the 55 deg gameplay camera (r4). Quads 0.25-0.5 m (a leaf fills ~80 % of its cell: ~17-33 px at the camera), petals 0.2-0.32 m; the tumble is a lazy
 * +-0.7 rad/s turn with a small flutter (the r3 +-1.8 rad/s and 0.6 m wobble flung a 1 m leaf around: at 0.35 m that is a flicker); a long, slow fall in the gust bands. The odd NEAR
 * leaf (high above the floor, i.e. close to the camera) passes at the top of the size range at about half the alpha, so it never reads as a sticker in front of the hero. The low tier
 * skips the near layer and thins the rest by a further 15 % (its density already halves them).
 */
function leafFall(fx: Fx, x: number, z: number, af: number, pal: LeafPalette): void {
  const rng = fx.rng;
  const near = rng.f() < 0.12;
  // low tier (phones, density x0.5): no near layer and 15 % fewer leaves on top of the halved density, so a loop stays <= 30 on screen
  if (fx.profile.tier === 'low' && (near || rng.f() < 0.15)) return;
  const life = rng.r(9, 14);
  const age = af * life;
  const sink = rng.r(0.2, 0.36);
  const m = gust(fx, x, z, age);
  const vx = rng.r(0.4, 1.0) * m;
  const vz = rng.r(0.08, 0.34) * m;
  const t = rng.f();
  const petal = rng.f() < pal.petals;
  const tint = pal.tints.find((e) => t <= e[0]) ?? (pal.tints[pal.tints.length - 1] as readonly [number, number]);
  const hex = petal ? (t < 0.15 ? 0xffffff : t < 0.4 ? 0xfff0dc : t < 0.72 ? 0xf9cfda : 0xf2b2c3) : tint[1];
  const s = petal ? rng.r(0.28, 0.42) : near ? rng.r(0.45, 0.5) : rng.r(pal.size[0], pal.size[1]);
  const a = near ? rng.r(0.4, 0.55) : petal ? rng.r(0.82, 0.92) : rng.r(0.88, 0.97);
  // sheet cells: 0 maple, 1 birch blade, 2 curled / tumbling leaf, 3 petal (the procedural cut-outs only draw while the sheet is missing)
  const k = rng.f();
  const cell = petal ? sheetSpr(fx, A.leafSheet, 3, SPR.petal) : sheetSpr(fx, A.leafSheet, k < pal.cells[0] ? 0 : k < pal.cells[1] ? 1 : 2, k < 0.5 ? SPR.leaf0 : SPR.leaf1);
  const gy = fx.heightAt(x, z);
  fx.alp.at(x - vx * age, gy + sink * life + rng.r(0.5, 1.0) + (near ? rng.r(1.4, 2.6) : 0), z - vz * age).vel(vx, -sink, vz).life(life).delay(-age)
    .size(s, s * 0.92).rot(rng.f() * TAU, rng.s2(0.7)).col(hex, a, hex, a).int(petal ? 1.05 : pal.gain).spr(cell)
    .wob(near ? 0.4 : 0.3).fade(3, FO.late).emit();
}

/** Yeonmu: a light, slow fall of spring leaves and white petals (0.25-0.5 m, painted sheet) in a gentle wind */
function leaves(fx: Fx, x: number, z: number, af: number): void {
  leafFall(fx, x, z, af, SPRING);
}

/** Suryeon: the autumn valley's russet / amber / ochre leaves, same sizes and fall */
function leavesAutumn(fx: Fx, x: number, z: number, af: number): void {
  leafFall(fx, x, z, af, AUTUMN);
}

/**
 * Sun motes (r4: the pips that rode inside the old leaves loop, now their own loop so a zone can run them next to the leaves): 0.06-0.12 m warm soft pips that swell and fade
 * (the bell size curve: no hard blink), adrift on the gust waves a hand's breadth above the grass up to head height, rising a little. Additive #ffe6b0; <= ~40 of them on screen.
 */
function motes(fx: Fx, x: number, z: number, af: number): void {
  const rng = fx.rng;
  const life = rng.r(7, 11);
  const age = af * life;
  const m = gust(fx, x, z, age);
  const vx = rng.r(0.12, 0.34) * m;
  const vz = rng.r(0.03, 0.14) * m;
  const vy = rng.r(0.02, 0.12);
  const s = rng.r(0.06, 0.12);
  fx.add.at(x - vx * age, fx.heightAt(x, z) + rng.r(0.4, 2.6) - vy * age, z - vz * age).vel(vx, vy, vz).life(life).delay(-age).size(s * 0.6, s)
    .col(0xffe6b0, 0.95, 0xffe6b0, 0.95).int(rng.r(2.0, 2.8)).art(A.pip).wob(0.2).fade(3, FO.late, SC.bell).emit();
}

// ---------------------------------------------------------------------------------------------------------------- Suryeon
/**
 * Suryeon: wind-blown dust. r3: the granular dust VEILS of the foot dust (vfx_ambient_dust_grain_sheet) are the body of the loop: 1.1-2.2 m translucent puffs tumbling along the ground wind in gust bands,
 * swelling a little as they thin out, over faint low haze veils and sun-glinting motes. (r2 drew small cotton puffs at alpha 0.16-0.3 that were imperceptible at the game camera: "only stray bright specks read".)
 */
function dust(fx: Fx, x: number, z: number, af: number): void {
  const rng = fx.rng;
  const q = rng.f();
  const gy = fx.heightAt(x, z);
  if (q < 0.06) {
    // gust veils: wide, very faint, low, fast - the gust wave makes them come in bands; a soft mottled body (no streaks)
    const life = rng.r(3, 5);
    const age = af * life;
    const m = gust(fx, x, z, age);
    const v = rng.r(3.2, 5.2) * m;
    const s = rng.r(3.4, 5.4);
    alp(fx, A.puffMottled, x, gy + rng.r(0.5, 1.4), z, v * WX, 0, v * WZ, life, age, s * 0.8, s * 1.1, 0xdcc8a0, rng.r(0.06, 0.1), 0.1, 0.1);
  } else if (q < 0.12) {
    // haze veils: wide, slow, faint
    const life = rng.r(8, 12);
    const age = af * life;
    const m = gust(fx, x, z, age);
    const vx = rng.r(1.4, 2.4) * m;
    const vz = rng.r(0.35, 0.9) * m;
    const s = rng.r(3.4, 6.0);
    alp(fx, A.puffMottled, x, gy + rng.r(0.6, 1.8), z, vx, 0, vz, life, age, s, s * 1.15, 0xe0cfa8, rng.r(0.05, 0.09), 0.15, 0.1);
  } else if (q < 0.62) {
    // dust puffs: granular veils blown along the ground wind, swelling as they thin out; in the gust bands (m > 1) they are bigger and faster
    const life = rng.r(3.2, 5.6);
    const age = af * life;
    const m = gust(fx, x, z, age);
    const vx = rng.r(1.8, 3.6) * m;
    const vz = rng.r(0.45, 1.1) * m;
    const s = rng.r(1.2, 2.2);
    alp(fx, grainCell(fx, rng.f()), x, gy + rng.r(0.5, 1.6), z, vx, rng.s2(0.1), vz, life, age, s * 0.9, s * 1.35, rng.f() < 0.5 ? 0xe8d6a8 : 0xd6c394, rng.r(0.6, 0.9), 0.8, 0.25);
  } else {
    // sun-glinting motes
    const life = rng.r(5, 9);
    const age = af * life;
    const m = gust(fx, x, z, age);
    const vx = rng.r(0.9, 1.8) * m;
    const vz = rng.r(0.2, 0.6) * m;
    const s = rng.r(0.2, 0.36);
    fx.add.at(x - vx * age, gy + rng.r(0.4, 3.2), z - vz * age).vel(vx, rng.s2(0.06), vz).life(life).delay(-age).size(s, s)
      .col(0xffe2a6, 0.9, 0xffc878, 0.9).int(rng.r(1.2, 2.0)).art(A.pip).wob(0.3).twinkle().fade(3, FO.late).emit();
  }
}

// ---------------------------------------------------------------------------------------------------------------- Seori
/** the share of its 2x2-sheet cell the flake fills, per cell (vfx_ambient_snow_soft_sheet: 0 crisp small, 1 big out-of-focus, 2 two merged puffs, 3 flake with loose fluffs; alpha > 0.5 measured) */
const SNOW_FILL: readonly number[] = [0.45, 0.7, 0.6, 0.55];
/** the low tier's procedural soft dot: the share of its quad it covers visibly (measured on the low Seori stills: a dot at 0.45 read ~1.7 x as wide as the sheet flake of the same size, the skirt and the bloom of the white on the pale floor) */
const LOW_DOT_FILL = 0.75;

/**
 * Seori: a light snowfall of SMALL SOFT FLAKES (AMB-02 r5-r9). The r3 flakes were 0.4-2.3 m cotton balls over blue-grey halos (a 0.9 m puff is 60 px at the 55 deg camera: a sticker, and the
 * near blurred ones hid the telegraphs); the veils skimming the floor clipped it with a hard edge (the haze is the zone look's job: haze.mist). Now the flake you SEE is 0.12-0.55 m (8-37 px at
 * 1 m ~ 67 px) - about half the old size; the quad is that / the share of its cell the flake fills (0.45-0.7, measured on the sheet): far = 0.12-0.18 m cool-white specks (a depth layer,
 * fainter, 22 % on high and ultra only), the bulk (mid) = 0.20-0.40 m white soft flakes, skewed small (the 0.16-0.30 m flakes of r5 vanished on the near-white floor of medium shots), near = 10 % faint blurred
 * 0.40-0.55 m flakes (the "few large soft out-of-focus flakes" of the target) high above the floor (they pass in front of the hero at about a third of the alpha, so a telegraph under them stays
 * readable). NO halo under them: the r5 blue-grey halo (1.45x, alpha .5) read as a grey RING around every flake in the blind pairs on Seori's floor; the painted sheet already shades each
 * flake's rim cool grey and feathers it, which is all the edge a white flake needs on the pale floor. 15 % of the flakes are a touch cooler (#e6edf9) for the shaded side of the yurts: the
 * r7 #c9d6ee was as bright as the sunlit floor (luma ~213 against ~205-215) and showed as blue-grey discs on dark roofs.
 * The spec's 0.04-0.12 m cannot be read here: a 0.12 m QUAD is a 2-3 px dot (measured: 250 of them on Seori's floor were invisible in a blind pair, as were 0.06-0.18 m flakes), which is why the
 * bulk is 0.20-0.40 m. They fall slowly and sway on a small flutter while the gust waves lean them (the same travelling gusts as the leaves). The low tier (phones) drops the far and near layers
 * and 68 % of the rest on top of its halved density (~17 flakes on screen, <= 30) and draws a plain soft dot instead of the sheet (the sheet's cells came out of the 96 px art as ringed bubbles there).
 */
function snow(fx: Fx, x: number, z: number, af: number): void {
  const rng = fx.rng;
  const low = fx.profile.tier === 'low';
  const q = rng.f();
  // layers: 0 far specks (q < 0.22, high and up: a 0.12-0.18 m speck is invisible on the bright floor and only a depth cue where there is detail), 1 mid flakes, 2 near faint out-of-focus flakes (10 %)
  const layer = q > 0.9 ? 2 : q < 0.22 && fx.profile.detail >= 2 ? 0 : 1;
  if (low && (layer === 2 || rng.f() < 0.68)) return;
  const gy = fx.heightAt(x, z);
  const life = layer === 0 ? rng.r(8, 12) : layer === 1 ? rng.r(6.5, 9.5) : rng.r(6, 9);
  const age = af * life;
  const fall = layer === 0 ? rng.r(0.45, 0.8) : layer === 1 ? rng.r(0.7, 1.1) : rng.r(0.9, 1.3);
  const m = gust(fx, x, z, age);
  const vx = rng.r(0.25, 0.7) * m * (layer === 2 ? 1.2 : 1);
  const vz = rng.r(0.05, 0.3) * m;
  // sheet cell first: the quad is the VISIBLE flake diameter / the share of its cell the flake fills (measured on the sheet: crisp 0.45, big blurred 0.7, loose-fluff 0.55). The low tier (phones) draws the crisp cell 0 only
  // and, below, the procedural soft dot instead of the sheet: the low-resolution art (96 px cells) draws the sheet's flakes as a white-rimmed grey disc, and the 0.3-0.4 m loose-fluff flakes (cell 3) as a
  // ringed bubble with satellite dots (AMB-02 r2 critic): the sticker look this loop exists to remove. A radial dot has no rim, and LOW_DOT_FILL scales the quad so the dot is as wide on screen as the sheet's flake of the same size
  const cellK = layer === 2 ? 1 : layer === 0 || low ? 0 : rng.f() < 0.5 ? 0 : 3;
  // the mid flakes skew small (a few reach 0.4 m): a fall of equal discs reads as a pattern, a fall in sizes as depth
  const d = layer === 0 ? rng.r(0.12, 0.18) : layer === 1 ? 0.2 + 0.2 * rng.f() ** 1.5 : rng.r(0.4, 0.55);
  const s = d / (low ? LOW_DOT_FILL : (SNOW_FILL[cellK] ?? 0.5));
  // p0 height: the flake sinks `fall` m/s through its life and ends 0.15-1.8 m above the floor (near layer: 2.8-5 m, between the camera and the hero)
  const y = gy + fall * life + (layer === 2 ? rng.r(2.8, 5.0) : rng.r(0.15, layer === 0 ? 1.8 : 1.2));
  const hex = layer === 0 ? 0xdbe5f8 : layer === 1 ? (rng.f() < 0.85 ? 0xf8fbff : 0xe6edf9) : 0xe3ebf8;
  const a = layer === 0 ? rng.r(0.7, 0.85) : layer === 1 ? rng.r(0.88, 0.96) : rng.r(0.26, 0.38);
  // sheet cells: 0 crisp small flake, 1 big out-of-focus flake, 3 flake with loose fluffs
  fx.alp.at(x - vx * age, y, z - vz * age).vel(vx, -fall, vz).life(life).delay(-age).size(s, s).rot(rng.f() * TAU, 0).col(hex, a, hex, a).spr(low ? SPR.glow : sheetSpr(fx, A.snowSoft, cellK, SPR.glow))
    .wob(layer === 0 ? 0.1 : 0.16).fade(3, FO.late).emit();
}

// ---------------------------------------------------------------------------------------------------------------- Daeryeol

function embers(fx: Fx, x: number, z: number, af: number): void {
  const rng = fx.rng;
  const q = rng.f();
  const gy = fx.heightAt(x, z);
  if (q < 0.6) {
    // cinders: hot chips / cores cooling from yellow-white to deep red, flickering and tumbling; height layers 0.1-3 m
    const life = rng.r(5, 8);
    const age = af * life;
    const rise = rng.r(0.6, 1.5);
    const m = gust(fx, x, z, age);
    const vx = rng.r(0.15, 0.7) * m;
    const vz = rng.s2(0.25);
    const hot = rng.f() < 0.28;
    const far = rng.f() < 0.4;
    const y0 = gy + (far ? rng.r(1.4, 3.2) : rng.r(0.1, 1.2));
    if (rng.f() < 0.72 && fx.hasArt(A.emberChip)) {
      // ragged chips: the shard fills ~45 % of its cell, so a 0.8-1.3 m quad is a 0.35-0.6 m chip; they tumble as they rise, the cracks glow hot and the facets are dark red
      const q2 = (far ? rng.r(0.85, 1.2) : rng.r(1.25, 1.8)) * (hot ? 1.15 : 1);
      fx.add.at(x - vx * age, y0 - rise * age, z - vz * age).vel(vx, rise, vz).life(life).delay(-age).size(q2, q2).rot(rng.f() * TAU, rng.s2(3.2))
        .col(hot ? 0xffb454 : 0xff7424, 1, 0xb01c04, 0.65).int(far ? rng.r(1.25, 1.6) : rng.r(1.5, 2.0)).spr(sheetSpr(fx, A.emberChip, Math.floor(rng.f() * 4))).wob(0.4).twinkle().fade(3, FO.late).emit();
    } else {
      const s = (far ? rng.r(0.2, 0.3) : rng.r(0.28, 0.44)) * (hot ? 1.25 : 1);
      fx.add.at(x - vx * age, y0 - rise * age, z - vz * age).vel(vx, rise, vz).life(life).delay(-age).size(s, s * 0.8).rot(rng.f() * TAU, rng.s2(1.5))
        .col(hot ? 0xffe39a : 0xffb050, 1, 0xd8300c, 0.75).int(rng.r(2.2, 3.0)).art(A.hotcore).wob(0.45).twinkle().fade(3, FO.late).emit();
    }
  } else if (q < 0.72) {
    // spark streaks: short fast chips flung up and across (volcanostone stretched), brief
    const life = rng.r(0.7, 1.3);
    const age = af * life;
    const a = rng.s2(0.7);
    const v = rng.r(2.4, 4.4);
    const vx = Math.cos(a) * v;
    const vz = Math.sin(a) * v * 0.5;
    fx.add.at(x - vx * age, gy + rng.r(0.2, 1.4), z - vz * age).vel(vx, rng.r(0.8, 2.4), vz).grav(-1.6).size(0.12, 0.06).stretch(0.1).life(life).delay(-age)
      .col(0xffd27a, 1, 0xff4a10, 0.5).int(2.8).spr(SPR.streak).mode(M.streak).fade(1, FO.quad).emit();
  } else if (q < 0.86) {
    // dark ash veils: soft cinder-smoke rising slowly (the haze that the flame map is defined by); faint on purpose, the haze itself is the map domain
    const life = rng.r(6, 10);
    const age = af * life;
    const m = gust(fx, x, z, age);
    const vx = rng.r(0.3, 0.9) * m;
    const s = rng.r(2.6, 4.6);
    alp(fx, A.cinderPuffs, x, gy + rng.r(0.3, 1.6), z, vx, rng.r(0.25, 0.55), rng.s2(0.2), life, age, s * 0.8, s, 0x2c1d19, rng.r(0.1, 0.17), 0.12, 0.1);
  } else {
    // low rust smoke wisps hugging the ground
    const life = rng.r(7, 11);
    const age = af * life;
    const m = gust(fx, x, z, age);
    const vx = rng.r(0.5, 1.2) * m;
    const s = rng.r(2.4, 4.2);
    alp(fx, A.puffMottled, x, gy + rng.r(0.15, 0.8), z, vx, rng.r(0.05, 0.2), rng.s2(0.25), life, age, s * 0.8, s, 0x6e3a2a, rng.r(0.07, 0.12), 0.12, 0.1);
  }
}

// ---------------------------------------------------------------------------------------------------------------- ash / smoke / sparks
/** ash flake tints (r5, AMB-02): the warm grey #5a504a of burnt wood, a darker char and a lighter ash [cumulative weight, hex] */
const ASH_TINTS: readonly (readonly [number, number])[] = [[0.5, 0x5a504a], [0.8, 0x4a423c], [1, 0x6e635b]];
/** the linear gain on the ash flakes (the grit gets 0.72 x it): the painted flakes are shaded (a typical pixel is ~0.4 of the tint), so a dark tint needs a gain to lift it off the charcoal floor. Blind-compared on the lava floor: gain 5 left the half-size flakes invisible (changed pixels 0.23 % of the frame, nothing to see), 6 was marginal, 7 reads as small warm-grey flecks (the r5 pairs: 9 of 9 decisive wins against the old 0.6-0.96 m crumpled cut-outs); the darkness comes from the tint (#5a504a, #4a423c) and the painted shading, not from a lower gain */
const ASH_GAIN = 7;

/**
 * ash flakes: slow tumbling small WARM-GREY ragged flakes, fine grit and the odd glowing cinder. r5 / r7 (AMB-02): half the r2 size (0.3-0.48 m flakes, 0.17-0.31 m grit, 0.08-0.15 m cinders) and
 * the warm grey tint #5a504a x gain 7 instead of pale greys: on screen a MID warm grey (top-10 % pixels ~(122-149, 96-120, 85-108) on the charcoal lava floor), not the tint's own dark and not paper white (the sheet's torn pale edges and the light tints read as white paper confetti against the charcoal floor); the sheet's torn flakes are shaded
 * (measured on the lava floor: the typical pixel is ~0.4 of the tint on screen, and #5a504a at gain 1-2 vanishes into the dark ground), so a linear gain of ~7 puts the typical flake pixel a clear step above the floor (a gain of 4-5 still read as nothing in a blind pair). The low tier drops 70 % of them on top of its halved density (<= 30 on screen).
 */
function ash(fx: Fx, x: number, z: number, af: number): void {
  const rng = fx.rng;
  if (fx.profile.tier === 'low' && rng.f() < 0.7) return;
  const q = rng.f();
  const gy = fx.heightAt(x, z);
  const life = q < 0.1 ? rng.r(3, 5) : rng.r(8, 12);
  const age = af * life;
  const sink = q < 0.1 ? rng.r(0.15, 0.3) : rng.r(0.22, 0.5);
  const m = gust(fx, x, z, age);
  const vx = rng.r(0.3, 0.9) * m;
  const vz = rng.r(0.05, 0.3) * m;
  const px = x - vx * age;
  const py = gy + sink * life + rng.r(0.3, 1.2);
  const pz = z - vz * age;
  if (q < 0.1) {
    const s = rng.r(0.08, 0.15);
    fx.add.at(px, py, pz).vel(vx, -sink, vz).life(life).delay(-age).size(s, s).col(0xffa040, 1, 0xff4a10, 0.7).int(rng.r(2.0, 2.8)).art(A.hotcore).wob(0.4).twinkle().fade(3, FO.late).emit();
  } else if (q < 0.45) {
    // ragged flakes of the sheet (torn edges, curled), tumbling, 0.3-0.48 m quads (the flake fills ~60 % of its cell); the scatter sprite stays only as the fallback while the sheet is missing
    const s = rng.r(0.3, 0.48);
    const k = rng.f();
    const hex = (ASH_TINTS.find((e) => k <= e[0]) ?? (ASH_TINTS[ASH_TINTS.length - 1] as readonly [number, number]))[1];
    const cell = sheetSpr(fx, A.ashSheet, Math.floor(rng.f() * 4), SPR.flake);
    fx.alp.at(px, py, pz).vel(vx, -sink, vz).life(life).delay(-age).size(s, s).rot(rng.f() * TAU, rng.s2(2.0)).col(hex, 0.92, 0x4a423c, 0.85)
      .int(ASH_GAIN).spr(cell).wob(0.5).fade(3, FO.late).emit();
    // no ember halo on the flakes: an additive copy of the cell fills the flake with salmon (r2 pass 1: raw-meat scraps); the glow of the loop is the 10 % cinders above
  } else {
    const s = rng.r(0.17, 0.31);
    fx.alp.at(px, py, pz).vel(vx, -sink * 0.8, vz).life(life).delay(-age).size(s, s).rot(rng.f() * TAU, rng.s2(1.4)).col(rng.f() < 0.5 ? 0x5a504a : 0x6e635b, 0.75, 0x4a423c, 0.62)
      .int(ASH_GAIN * 0.72).spr(grainCell(fx, rng.f())).wob(0.45).fade(3, FO.late).emit();
  }
}

/** smoke wisp tints (r5, AMB-02): warm light grey, a darker char grey and the lava-lit rust of the low wisps (the sprites are mostly transparent at alpha <= 0.12, so the gain lifts them off the dark floor) [cumulative weight, hex, gain] */
const SMOKE_TINTS: readonly (readonly [number, number, number])[] = [[0.57, 0xa09488, 2.4], [0.86, 0x7a6e66, 2.2], [1, 0xb06a44, 2.8]];
/**
 * the share of the (not lava-lit) wisps drawn as a STANDING bank: an upright card (M.upright, the base sits a hand above the floor, height = SMOKE_BANK_ASP x width) instead of a screen-facing disc. At the 55 deg
 * gameplay camera a vertical card foreshortens to cos 55 = 0.57 of its height, so a 2-4 m bank reads ~1.7 : 1 wide and low, a smoke bank blown along the ground - the round-puff silhouette (a ring / donut
 * outline on a flat floor, flagged by the r1 and r2 critics) is broken without a second sprite or any extra draw
 */
const SMOKE_BANK = 0.5;
const SMOKE_BANK_ASP = 1;

/**
 * Smoke wisps (r5, AMB-02: Daeryeol had none): slow, soft, low: 2-4 m puffs (mottled billows and the granular veil sheet, whose ragged rims keep a wisp from reading as a disc) at alpha 0.06-0.12, born
 * a hand above the floor, rising ~0.3 m/s while the gust waves push them along the wind, swelling by a third as they thin out; a bell fade in and out (no pop), a slow random turn so no two
 * wisps repeat the same silhouette. Half of the grey wisps stand as banks (an upright card: wide and low on screen, SMOKE_BANK; r9: the discs kept a round outline); the others are screen-facing and their
 * centre starts >= 0.57 x half the size above the floor: a screen-facing quad lower than that dips under the ground (a hard cut on the tiers without soft
 * depth). 14 % are rust coloured, lava-lit wisps that stay lower and smaller; the low tier keeps half of them. Meant to run next to ambient.embers (a second loop, PL-02); a telegraph under one stays readable (<= 0.12 alpha).
 */
function smoke(fx: Fx, x: number, z: number, af: number): void {
  const rng = fx.rng;
  // the low tier (phones) keeps half of the wisps on top of its halved density: the changed-pixel share stays under 2 % of the frame
  if (fx.profile.tier === 'low' && rng.f() < 0.5) return;
  const t = rng.f();
  const tint = SMOKE_TINTS.find((e) => t <= e[0]) ?? (SMOKE_TINTS[SMOKE_TINTS.length - 1] as readonly [number, number, number]);
  const lit = tint[1] === 0xb06a44;
  const life = lit ? rng.r(9, 13) : rng.r(12, 17);
  const age = af * life;
  const m = gust(fx, x, z, age);
  const vy = rng.r(0.24, 0.38) * (lit ? 0.75 : 1);
  const vx = rng.r(0.3, 0.8) * m;
  const vz = rng.r(0.05, 0.3) * m;
  const s0 = lit ? rng.r(2.0, 2.5) : rng.r(2.0, 3.0);
  const s1 = Math.min(4, s0 * rng.r(1.25, 1.4));
  const bank = !lit && rng.f() < SMOKE_BANK;
  // a bank stands on its base (a hand above the floor); a disc is centred, so its lower edge clears the floor
  const y0 = fx.heightAt(x, z) + (bank ? rng.r(0.05, 0.45) : 0.574 * 0.5 * s1 + rng.r(0.05, lit ? 0.25 : 0.7));
  const a = rng.r(0.06, 0.12);
  const p = fx.alp.at(x - vx * age, y0, z - vz * age).vel(vx, vy, vz).life(life).delay(-age).size(s0, s1).rot(rng.f() * TAU, rng.s2(0.1)).col(tint[1], a, tint[1], a).int(tint[2]);
  if (bank) p.mode(M.upright).stretch(SMOKE_BANK_ASP);
  // 72 % granular veils (4 variants, ragged rims), 28 % mottled billows (a round billow keeps a ring / donut outline on a flat floor, so the rust wisps are always veils)
  if (lit || rng.f() < 0.72) p.spr(grainCell(fx, rng.f()));
  else p.art(A.puffMottled);
  p.wob(0.1).fade(4, FO.quad).emit();
}





function sparks(fx: Fx, x: number, z: number, af: number): void {
  const rng = fx.rng;
  const gy = fx.heightAt(x, z);
  const r = rng.f();
  if (r < 0.25) {
    // glow chips: a small hot core in a round halo, twinkling, drifting up and across
    const life = rng.r(2.2, 4.0);
    const age = af * life;
    const vx = rng.s2(0.3) + 0.35;
    const vz = rng.s2(0.3);
    const vy = rng.r(0.3, 0.9);
    const s = rng.r(1.0, 1.8);
    fx.add.at(x - vx * age, gy + rng.r(0.3, 2.4) - vy * age * 0.5, z - vz * age).vel(vx, vy, vz).life(life).delay(-age).size(s, s).rot(rng.s2(0.3), rng.s2(0.4))
      .col(rng.f() < 0.6 ? 0xff9a58 : 0xffc27a, 1, 0xff3a14, 0.75).int(rng.r(2.2, 3.2)).spr(sheetSpr(fx, A.glitterChip, 0, SPR.glow)).wob(0.35).twinkle().fade(2, FO.quad, SC.bell).emit();
  } else if (r < 0.65) {
    // small hot shards: ragged chips of the ember sheet flung up, tumbling fast, cooling to dull red
    const life = rng.r(1.6, 2.8);
    const age = af * life;
    const a = rng.s2(0.8) + 0.4;
    const v = rng.r(1.2, 2.8);
    const vx = Math.cos(a) * v;
    const vz = Math.sin(a) * v * 0.5;
    const s = rng.r(0.8, 1.25);
    fx.add.at(x - vx * age, gy + rng.r(0.3, 1.6), z - vz * age).vel(vx, rng.r(0.8, 2.2), vz).grav(-1.2).life(life).delay(-age).size(s, s).rot(rng.f() * TAU, rng.s2(5))
      .col(0xff9a38, 1, 0xc02406, 0.55).int(rng.r(1.4, 1.9)).spr(sheetSpr(fx, A.emberChip, Math.floor(rng.f() * 4))).twinkle().fade(2, FO.quad).emit();
  } else {
    // fast warm streaks (volcanostone stretched along its flight)
    const life = rng.r(0.6, 1.1);
    const age = af * life;
    const v = rng.r(3.5, 6.5);
    const a = rng.s2(0.6) + 0.45;
    const vx = Math.cos(a) * v;
    const vz = Math.sin(a) * v;
    fx.add.at(x - vx * age, gy + rng.r(0.5, 2.5), z - vz * age).vel(vx, rng.r(-0.3, 0.8), vz).life(life).delay(-age).size(0.18, 0.09).stretch(0.14)
      .col(0xffd27a, 1, 0xff3a10, 0.6).int(3.0).spr(SPR.streak).mode(M.streak).fade(1, FO.quad).emit();
  }
}

export const presets: PresetDef[] = [
  ambient('ambient.leaves', 'Yeonmu: a light, slow fall of spring leaves (fresh greens) and white petals, 0.25-0.5 m painted quads sized for the gameplay camera, in a gentle wind; the odd near leaf is fainter. Follows the camera focus; scale = box half-extent (26 m, capped at 20 m).', 9, 11.5, leaves),
  ambient('ambient.dust', 'Suryeon: wind-blown dust - translucent granular dust veils (1.1-2.2 m) tumbling along the ground wind in gust bands, faint low haze veils and sun-glinting motes.', 22, 4.4, dust),
  ambient('ambient.snow', 'Seori: a light snowfall of small soft flakes (0.12-0.55 m visible, quad 0.27-0.9 m) in three depth layers - far specks, soft white mid flakes, a few faint near flakes high above the floor - swaying in the gusts; no halos, no veils. Follows the camera focus; scale = box half-extent (26 m, capped at 20 m).', 58, 9, snow),
  ambient('ambient.embers', 'Daeryeol: cooling cinders (ragged angular glowing chips + small hot cores) in depth layers, spark streaks and faint dark volcanic ash / rust smoke veils.', 46, 6.5, embers),
  ambient('ambient.ash', 'ash flakes tumbling down: a few warm-grey ragged flakes (tint #5a504a x gain 7: a mid warm grey on the charcoal floor, never paper white) at half the r2 size (0.3-0.48 m), fine grit and the odd small glowing cinder.', 30, 9.5, ash),
  ambient('ambient.sparks', 'flame sparks (Daeryeol, warm only): soft round glow chips drifting up, small ragged hot shards tumbling and cooling to red, fast warm streaks. No cold glitter, no glints.', 42, 3.0, sparks),
  ambient('ambient.leaves_autumn', 'Suryeon: the autumn fall - russet, amber and ochre leaves (0.25-0.5 m painted quads), same slow tumble as ambient.leaves. Follows the camera focus; scale = box half-extent (26 m, capped at 20 m).', 9, 11.5, leavesAutumn),
  ambient('ambient.motes', 'sun motes: 0.06-0.12 m warm soft pips adrift on the gust waves, swelling and fading, <= ~40 on screen; the second loop of Yeonmu next to ambient.leaves. Follows the camera focus; scale = box half-extent (26 m, capped at 20 m).', 7.5, 9, motes),
  ambient('ambient.smoke', 'Daeryeol: slow low smoke wisps - 2-4 m granular / mottled puffs at alpha 0.06-0.12, born a hand above the floor, rising ~0.3 m/s and swelling, pushed along by the gust waves; 14 % rust-coloured lava-lit wisps. The second loop of the lava zone next to ambient.embers. Follows the camera focus; scale = box half-extent (26 m, capped at 20 m).', 5.4, 14, smoke),
];

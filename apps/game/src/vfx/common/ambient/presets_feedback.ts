// Enemy charge / leap dust cues (common VFX target `ambient`; owner: the ambient builder). r1 2026-10-19: the orange ring outlines + chevron glyphs of the first version were
// gone. r2 2026-10-20: both cues were ONE FILLED DUST BODY (the matte cotton puff, peak alpha 0.9) and the blind critic read "near-opaque cauliflower billows still at full density at 0.45 s",
// "24 plumes merge into a cotton fog", "two disconnected clumps at 0.10 s", "a leap bloom 3x the small puff". r3 (this file):
//   - the body is the VERY TRANSLUCENT, FINELY GRANULAR veil of sk.gen.dust (vfx_ambient_dust_grain_sheet), peak alpha 0.5, full only until ~0.3 s (FO.late: the fall starts at 60 % of a 0.5 s life), gone by ~0.5 s;
//   - a soft cool shadow underlay (the same grain, larger, darker) gives the lit powder an edge on a pale floor: on snow the dust is LIT white-blue powder, not a grey body darker than the floor;
//   - charge = a head puff at the feet and a plume of overlapping puffs trailing back along -dir, all born together so the plume is ONE connected body from the first frames (its elongation is the direction cue);
//   - leap   = a take-off bloom capped at ~2 m (3 overlapping puffs + a low skirt braked inside the bloom's reach + a small push-off column).

// Budget: <= ~20 particles per event (the stress moment fires 24 at once), alpha-blended dust (keeps its colour on snow), nothing hard-edged.
import type { Fx } from '../../emit';
import { FO, SC, TAU } from '../../presets/kit';
import type { PresetDef } from '../../presets/types';
import { grainCell } from './art';
import { dustPair } from './dustTint';

/**
 * one alpha dust puff of the granular veil: quad width s0 -> s1 (visible ~ 0.9 x), thrown with v, drag, swells fast then slows (SC.out). r3: the veil is translucent (peak `a` ~0.5) and holds its alpha
 * only until ~60 % of a 0.5 s life (FO.late, ~0.3 s), then falls to nothing; the colour alpha also thins to 30 % by the end. `shadeHex` / `shadeA` (> 0) draw the soft shadow underlay first: the same
 * grain, 1.2x larger, a touch down-screen (+z) and darker, so a pale puff keeps an edge on a pale floor.
 */
/** r3 pass 2: the granular veil is sparse (mean sprite luma ~0.12), so the authored `a` (0.5 = "the visible peak") is scaled up to a colour alpha: effective core alpha = sprite x `a` x GAIN */
const GAIN = 2.2;

function puff(fx: Fx, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, hex: number, a0: number, delay: number, drag = 2.2, shade = true): void {
  const rng = fx.rng;
  const a = Math.min(1, a0 * GAIN);
  const cell = grainCell(fx, rng.f());
  const rot = rng.f() * TAU;
  const spin = rng.s2(0.7);
  const pair = dustPair();
  if (shade && pair.shadeA > 0.05) {
    fx.alp.at(x, y - 0.05, z + 0.3).vel(vx, vy, vz).life(life).delay(delay).size(s0 * 1.25, s1 * 1.42).col(pair.shade, pair.shadeA * (a0 / 0.5), pair.shade, pair.shadeA * 0.3).spr(grainCell(fx, rng.f()))
      .rot(rng.f() * TAU, spin).drag(drag).fade(1, FO.late, SC.out).emit();
  }
  fx.alp.at(x, y, z).vel(vx, vy, vz).life(life).delay(delay).size(s0, s1).col(hex, a, hex, a * 0.3).spr(cell).rot(rot, spin).drag(drag).fade(1, FO.late, SC.out).emit();
}

/** fine grit knocked loose: small granular puffs of the same veil flung away (along (dx, dz) when given, else all round) and falling; tiny, in the lit tone (never dark pebbles: pepper on snow) */
function grit(fx: Fx, x: number, y: number, z: number, n: number, dx: number, dz: number, speed: number, s: number, tone: number): void {
  const rng = fx.rng;
  const cone = dx !== 0 || dz !== 0;
  const base = Math.atan2(dx, dz);
  for (let i = 0; i < n; i++) {
    const a = cone ? base + rng.s2(0.9) : rng.f() * TAU;
    const v = speed * rng.r(0.5, 1.0);
    fx.alp.at(x, y + 0.3 * s, z).vel(Math.sin(a) * v, rng.r(0.9, 2.1) * s, Math.cos(a) * v).life(rng.r(0.32, 0.5)).delay(0.02).size(0.2 * s, 0.3 * s).col(tone, 0.55, tone, 0)
      .spr(grainCell(fx, rng.f())).rot(rng.f() * TAU, rng.s2(3)).grav(-9).drag(1.4).fade(1, FO.sq).emit();
  }
}

function charge(): PresetDef {
  return {
    id: 'enemy.charge',
    cat: 'trail',
    desc: 'Enemy charge start: a very translucent, finely granular dust plume kicked back along -dir from the feet (a head puff + overlapping puffs trailing behind, one connected body from the first frames), lit powder over a soft cool shadow, a little grit. Gone by ~0.5 s. No rings, no glyphs, no speed lines.',
    size: 'mult',
    base: 1,
    palette: 'dust',
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const rng = fx.rng;
      const s = c.scale;
      const x = c.x, y = c.y, z = c.z;
      const dx = c.dx, dz = c.dz;
      const px = -dz, pz = dx;
      const { hi, lo } = dustPair();
      // 1. the head puff: the dense core of the cloud at the feet, lifted (centre >= 0.57 x its half size), drifting back as the enemy leans into the run
      puff(fx, x - dx * 0.1 * s, y + 0.55 * s, z - dz * 0.1 * s, -dx * 0.9 * s, 0.3, -dz * 0.9 * s, 0.5, 0.8 * s, 1.5 * s, hi, 0.55, 0, 2.0);
      // 2. the plume: puffs born one behind the other along -dir (0.3 m apart, 0.7+ m wide from the first frame, so they overlap into ONE elongated body at 0.10 s too), thrown back, swelling as they slow
      for (let i = 0, n = fx.n(6); i < n; i++) {
        const back = (0.4 + i * 0.3) * s;
        const side = rng.s2(0.14) * s;
        const v = (0.9 + i * 0.16) * s;
        puff(fx, x - dx * back + px * side, y + (0.42 + 0.03 * i) * s, z - dz * back + pz * side, -dx * v + px * rng.s2(0.25), rng.r(0.2, 0.4), -dz * v + pz * rng.s2(0.25),
          0.44 + i * 0.02, (0.95 + 0.02 * i) * s, (1.45 + 0.03 * i) * s, i % 2 === 0 ? hi : lo, 0.5 - 0.035 * i, i * 0.012, 2.2, i % 3 === 0);
      }
      // 3. grit knocked loose: small granular puffs flung back and down
      grit(fx, x - dx * 0.2 * s, y, z - dz * 0.2 * s, fx.n(3), -dx, -dz, 2.4 * s, s, lo);
    },
  };
}

function leap(): PresetDef {
  return {
    id: 'enemy.leap',
    cat: 'trail',
    desc: 'Enemy leap take-off: a very translucent granular dust bloom at the feet capped at ~2 m (3 overlapping puffs, a low skirt braked inside its reach, a small push-off column), lit powder over a soft cool shadow, a little grit. Gone by ~0.5 s. No rings, no streaks.',
    size: 'mult',
    base: 1,
    palette: 'dust',
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const rng = fx.rng;
      const s = c.scale;
      const x = c.x, y = c.y, z = c.z;
      const { hi, lo } = dustPair();
      // 1. the take-off bloom: three overlapping puffs under the body, rising a little (the push-off); the visible bloom stays <= ~1.9 m wide
      for (let i = 0, n = fx.n(3); i < n; i++) {
        puff(fx, x + rng.s2(0.16) * s, y + (0.62 + 0.04 * i) * s, z + rng.s2(0.16) * s, rng.s2(0.25), rng.r(0.3, 0.6) * s, rng.s2(0.25), 0.5, (0.85 + 0.08 * i) * s, (1.5 + 0.08 * i) * s, i === 1 ? lo : hi, 0.5, i * 0.02, 1.8, i !== 2);
      }
      // 2. the skirt: low puffs shot outward and braked hard (travel ~0.5 m), so they stay inside the bloom's reach and the middle never opens into a ring
      for (let i = 0, n = fx.n(6); i < n; i++) {
        const a = (i / 6) * TAU + rng.s2(0.4);
        const v = rng.r(1.3, 1.9) * s;
        puff(fx, x + Math.sin(a) * 0.22 * s, y + 0.42 * s, z + Math.cos(a) * 0.22 * s, Math.sin(a) * v, rng.r(0.1, 0.3), Math.cos(a) * v, rng.r(0.4, 0.5), 0.55 * s, rng.r(0.9, 1.05) * s, i % 2 === 0 ? hi : lo, 0.42, 0.02 + i * 0.01, 3.0, false);
      }
      // 3. the push-off column: two small puffs thrown straight up under the body
      for (let i = 0, n = fx.n(2); i < n; i++) {
        puff(fx, x + rng.s2(0.12) * s, y + 0.55 * s, z + rng.s2(0.12) * s, rng.s2(0.2), rng.r(1.2, 1.6) * s, rng.s2(0.2), 0.42, 0.5 * s, 0.95 * s, hi, 0.36, 0.03 + i * 0.04, 1.6, false);
      }
      // 4. grit
      grit(fx, x, y, z, fx.n(4), 0, 0, 2.4 * s, s, lo);
    },
  };
}

export const presets: PresetDef[] = [
  charge(),
  leap(),
];

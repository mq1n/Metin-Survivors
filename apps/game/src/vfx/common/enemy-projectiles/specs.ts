// The MAKING / RELEASE / BLOW effects of the hostile attacks as FxSpecs (common VFX target `enemy-projectiles`, rounds 1-2).

//   <mob>_hand / _making  the charge at the hand: a dark ALPHA smoke ball (black_mine_edge, rot cw 32 deg/s, a 0 -> 1 -> 0) under
//                         an additive swirl (ls1_1 copy rotating 500 deg/s ccw, a 1 -> 0) while the arm winds up
//   <mob>_throw           the flying body (render/fx/projectiles.ts + projectileLooks.ts draws it) + a faint thick tail
//   <mob>_blow            dark smoke sphere r100 (alpha) + stretched sparks (skeleton_magician_fire_rotate) + the ground

// One factory per stage, parametrised by `LOOKS` (palette, swirl sprite, burst sprite). The element reads by STRUCTURE (the
// swirl and burst sprites differ: flame tongues, crystals, ink, toxic blob, air slashes), not by hue alone.
// Spawn contract (route.ts): `making` at the hand (y = ground, elements carry the 1.0 m hand height), `release` at the
// projectile head (y = the projectile's height), `blow` on the ground under the vanishing projectile (elements at y 0.9).
// LUT budget: 6 looks x (3 + 4 + 5) elements = 72 elements = 216 curve rows (spec/README "Perf rules").
import type { ColorCurve, FxSpec, ParticleSpec } from '../../spec/types';
import { ART_CHARGE_SPHERE, ART_COMET, ART_GLOW, ART_NEEDLE, ART_RING_SMOKE, ART_SMOKE_DARK } from './art';
import { EP_LOOKS, LOOKS, type EpLook, type LookDef } from './looks';

const HAND_Y = 1.0;

/** colour curve [t, rgb, a, ...] helper: fades the element colour `c` in/out with alpha keys `a` over the life */
function fade(c: number, keys: readonly number[]): ColorCurve {
  const out: number[] = [];
  for (let i = 0; i < keys.length; i += 2) out.push(keys[i] as number, c, keys[i + 1] as number);
  return out;
}
/** an sRGB hex scaled towards black (a darker body colour for alpha-blended smoke, so it keeps its hue on a bright floor) */
function dim(c: number, k: number): number {
  const r = Math.round(((c >> 16) & 255) * k);
  const g = Math.round(((c >> 8) & 255) * k);
  const b = Math.round((c & 255) * k);
  return (r << 16) | (g << 8) | b;
}
/** linear mix of two sRGB hex colours */
function mixc(a: number, b: number, k: number): number {
  const m = (sh: number): number => Math.round(((a >> sh) & 255) * (1 - k) + ((b >> sh) & 255) * k);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
/** hot -> body -> rim over the life with an alpha envelope */
function heat(L: LookDef, a: readonly [number, number, number, number]): ColorCurve {
  return [0, L.core, a[0], 0.28, L.mid, a[1], 0.7, L.mid, a[2], 1, L.rim, a[3]];
}

// ---------------------------------------------------------------------------------------------------------------- MAKING

// light gathering in the hand, about 1 m by the throw): ~0.3 m at the start -> ~1.1 m at the release, a white-hot heart, a soft rim in the
// element hue (feathered, no outline), the spinning element structure inside and a few motes drawn in. The dark alpha smoke under it is only a
// faint haze now (a coin / disc with a dark rim read as a button on snow in round 2). The additive layers carry the look; one faint alpha
// hue volume keeps the colour on a white floor. It sits 0.6 m in front of the hand so the caster's body stays visible.
function makingSpec(L: LookDef): FxSpec {
  const hand = [0, HAND_Y, 0.6] as const;
  // 0.3 m -> 1.1 m: the sphere is up to ~0.65 of its size after a quarter of the wind-up (readable at 0.15 s), full at the throw
  const grow = [0, 0.28, 0.25, 0.66, 0.6, 0.92, 1, 1.0] as const;
  const elements: ParticleSpec[] = [
    {
      kind: 'particle',
      note: 'black_mine_edge: only a feathered haze of the dark smoke now (alpha <= 0.28), the underlay that keeps the glow readable on snow without a dark disc',
      cycle: 0.1,
      max: 1,
      rate: [0, 20],
      life: [0, 0.55],
      at: hand,
      half: [0, 0.9],
      scale: grow,
      color: fade(L.smoke, [0, 0, 0.3, 0.16, 0.8, 0.28, 1, 0]),
      billboard: 'screen',
      rotation: { start: [0, 360], spin: -32 },
      blend: 'alpha',
      tex: ART_SMOKE_DARK,
    },
    {
      kind: 'particle',
      note: 'the element hue volume (alpha blended, up to 0.5, feathered: the glow keeps a saturated colour on a white floor, where an additive-only sphere washes out)',
      cycle: 0.1,
      max: 1,
      rate: [0, 20],
      life: [0, 0.55],
      at: hand,
      half: [0, 0.74],
      scale: grow,
      color: [0, dim(L.mid, 0.62), 0.0, 0.3, dim(L.mid, 0.62), 0.44, 0.85, dim(L.rim, 0.7), 0.5, 1, dim(L.rim, 0.7), 0.0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 48 },
      blend: 'alpha',
      tex: ART_SMOKE_DARK,
    },
    {
      kind: 'particle',
      note: 'the soft rim shell of the sphere in the element hue (feathered glow, no outline), swelling with the sphere',
      cycle: 0.1,
      max: 1,
      rate: [0, 20],
      life: [0, 0.55],
      at: hand,
      half: [0, 1.0],
      scale: grow,
      color: [0, L.rim, 0.0, 0.2, L.rim, 0.34, 0.85, L.mid, 0.42, 1, L.mid, 0.1],
      billboard: 'screen',
      blend: 'add',
      bright: 1.0,
      clamp: 1.1,
      tex: ART_GLOW,
    },
    {
      kind: 'particle',
      note: 'the charge sphere itself (generated sprite): translucent plasma wisps turning around a hot heart, grows 0.3 -> 1.1 m over the wind-up, slowly turning',
      cycle: 0.1,
      max: 1,
      rate: [0, 20],
      life: [0, 0.55],
      at: hand,
      half: [0, 0.8],
      scale: grow,
      color: [0, L.mid, 0.0, 0.1, L.mid, 0.6, 0.7, L.mid, 0.82, 1, L.core, 0.4],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: L.spin * 0.22 },
      blend: 'add',
      bright: 1.1,
      occlude: 0.25,
      clamp: 1.15,
      tex: ART_CHARGE_SPHERE,
    },
    {
      kind: 'particle',
      note: 'ls1_1 copy: the element structure (flame tongues / crystals / vortex / glob) turning inside the sphere, smaller than it',
      cycle: 0.1,
      max: 1,
      rate: [0, 20],
      life: [0, 0.55],
      at: hand,
      half: [0, 0.6],
      scale: grow,
      color: [0, L.mid, 0.0, 0.2, L.mid, 0.4, 0.8, L.mid, 0.5, 1, L.core, 0.25],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: L.spin },
      blend: 'add',
      bright: 1.0,
      occlude: 0.3,
      clamp: 1.1,
      tex: L.swirl,
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.1,
      max: 1,
      rate: [0, 20],
      life: [0, 0.55],
      at: hand,
      half: [0, 0.4],
      scale: [0, 0.4, 0.4, 0.8, 1, 1.0],
      color: [0, L.core, 0.0, 0.12, L.core, 0.6, 0.8, L.core, 0.95, 1, L.core, 0.35],
      billboard: 'screen',
      blend: 'add',
      bright: 1.1,
      clamp: 1.15,
      tex: ART_GLOW,
    },
    {
      kind: 'particle',
      note: 'a few motes of light drifting into the sphere (grains, not needles)',
      cycle: 0.5,
      max: 7,
      rate: [0, 18],
      life: [0, 0.34],
      at: hand,
      shape: { kind: 'sphere', radius: 1.0, edge: true },
      adv: 'inner',
      vel: [0, 0.02],
      half: [0, 0.07],
      scale: [[0, 0.8], [0, 1.4, 1, 0.6]],
      color: [0, L.core, 0.0, 0.2, L.core, 0.95, 1, L.mid, 0],
      billboard: 'screen',
      blend: 'add',
      bright: 1.1,
      clamp: 1.1,
      tex: ART_GLOW,
    },
    {
      kind: 'particle',
      note: 'orc_magician_weapon / hand charge sparks: only fine short motes now (adv inner on a shell), element colour',
      cycle: 0.5,
      max: 5,
      rate: [0, 14],
      life: [0, 0.22],
      at: hand,
      shape: { kind: 'sphere', radius: 0.95, edge: true },
      adv: 'inner',
      vel: [0, 0.03],
      half: [0, 0.09],
      scale: [[0, 0.5], [0, 1.2, 1, 0.5]],
      color: [0, L.core, 0.0, 0.2, L.core, 0.9, 1, L.mid, 0],
      billboard: 'stretch',
      blend: 'add',
      bright: 1.1,
      clamp: 1.1,
      tex: ART_NEEDLE,
    },
  ];
  return {
    id: `sk.gen.ep_making_${L.name}`,
    desc: `Enemy ${L.name} attack MAKING: a translucent glowing sphere grows 0.3 -> 1.1 m at the hand over the wind-up (white-hot heart, soft element rim, element structure, motes)`,
    behavior: 'selfBuff',
    ref: {},
    size: 'radius',
    base: 1,
    dur: 0.6,
    lift: 0,
    elements,
  };
}

// ---------------------------------------------------------------------------------------------------------------- RELEASE
function releaseSpec(L: LookDef): FxSpec {
  const y = 0;
  const elements: ParticleSpec[] = [
    {
      kind: 'particle',
      note: 'a faint puff of element-tinted smoke at the hand where the ball leaves (round 2 drew it near-black and 0.72 opaque: dirt spots at the launch points)',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.55],
      at: [0, y, 0],
      half: [0, 0.46],
      scale: [0, 0.5, 1, 1.25],
      color: fade(mixc(L.smoke, dim(L.mid, 0.45), 0.55), [0, 0.0, 0.1, 0.3, 0.5, 0.16, 1, 0]),
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 30 },
      blend: 'alpha',
      tex: ART_SMOKE_DARK,
    },
    {
      kind: 'particle',
      note: 'throw start: a short hot swirl flash at the hand where the ball leaves',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.16],
      at: [0, y, 0],
      half: [0, 0.4],
      scale: [0, 0.5, 0.35, 1, 1, 1.2],
      color: heat(L, [0.8, 0.6, 0.35, 0]),
      billboard: 'screen',
      rotation: { start: [0, 360], spin: L.spin },
      blend: 'add',
      bright: 1.1,
      occlude: 0.3,
      clamp: 1.1,
      tex: L.swirl,
    },
    {
      kind: 'particle',
      note: 'soft glow core of the flash',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.12],
      at: [0, y, 0],
      half: [0, 0.28],
      scale: [0, 0.6, 1, 1.15],
      color: [0, L.core, 0.75, 1, L.mid, 0],
      billboard: 'screen',
      blend: 'add',
      clamp: 1.1,
      tex: ART_GLOW,
    },
    {
      kind: 'particle',
      note: 'stretched sparks thrown along the throw direction (+Z = the projectile heading)',
      cycle: 0.05,
      max: 8,
      rate: [0, 400],
      life: [0, 0.22],
      at: [0, y, 0.1],
      shape: { kind: 'sphere', radius: 0.08 },
      dir: { z: [0, 100] },
      jitter: [0.06, 0.06, 0.02],
      vel: [0, 0.045],
      half: [0, 0.13],
      scale: [[0, 0.45], [0, 1.5, 1, 0.5]],
      color: [0, L.core, 1, 0.5, L.mid, 0.8, 1, L.rim, 0],
      air: [0, 0.1],
      billboard: 'stretch',
      blend: 'add',
      bright: 1.2,
      clamp: 1.1,
      tex: ART_NEEDLE,
    },
  ];
  return {
    id: `sk.gen.ep_release_${L.name}`,
    desc: `Enemy ${L.name} projectile RELEASE: dark smoke puff + hot swirl flash + glow + sparks along the throw at the moment the ball leaves`,
    behavior: 'selfBuff',
    ref: {},
    size: 'radius',
    base: 1,
    dur: 0.55,
    lift: 0,
    elements,
  };
}

// ---------------------------------------------------------------------------------------------------------------- BLOW
// Round 2: the blow is mostly ALPHA (dark smoke puffs + an element-coloured smoke ball + a dark ragged ground ring), so it keeps a
// readable hue on snow and does not stack into the r1 pastel cloud; only the small hot swirl / burst / sparks are additive.
function blowSpec(L: LookDef): FxSpec {
  const air = 0.9;
  const elements: ParticleSpec[] = [
    {
      kind: 'particle',
      note: 'skeleton_magician_smake sphere r100: dark alpha smoke puffs billowing out of the impact and rising (the underlay of the blow)',
      cycle: 0.1,
      max: 4,
      rate: [0, 70],
      life: [0, 0.6],
      at: [0, air, 0],
      shape: { kind: 'sphere', radius: 0.4 },
      adv: 'outer',
      vel: [0, 0.006],
      dir: { y: [0, 90] },
      half: [0, 0.5],
      scale: [0, 0.4, 0.4, 0.9, 1, 1.2],
      color: fade(mixc(L.smoke, dim(L.mid, 0.4), 0.72), [0, 0.0, 0.1, 0.38, 0.5, 0.26, 1, 0]),
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 40, randomDir: true },
      blend: 'alpha',
      tex: ART_SMOKE_DARK,
    },
    {
      kind: 'particle',
      note: 'the element-coloured smoke ball of the blow (alpha blended: hue instead of a pastel additive bloom)',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.42],
      at: [0, air, 0],
      half: [0, 0.62],
      scale: [0, 0.35, 0.3, 0.9, 1, 1.15],
      color: [0, dim(L.mid, 0.85), 0.0, 0.1, dim(L.mid, 0.85), 0.62, 0.55, dim(L.rim, 0.8), 0.38, 1, dim(L.rim, 0.8), 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 55 },
      blend: 'alpha',
      tex: ART_SMOKE_DARK,
    },
    {
      kind: 'particle',
      note: 'the flash that eats the body: a hot soft glow at the impact point for 0.14 s (the arriving ball is consumed, not left sitting on the target)',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.16],
      at: [0, air, 0],
      half: [0, 0.55],
      scale: [0, 0.5, 0.4, 1, 1, 1.2],
      color: [0, L.core, 0.95, 0.4, L.mid, 0.5, 1, L.rim, 0],
      billboard: 'screen',
      blend: 'add',
      bright: 1.1,
      clamp: 1.1,
      tex: ART_GLOW,
    },
    {
      kind: 'particle',
      note: 'ls1_1 copy swirl star (a 1 -> 0, 0.13 s): the element flash, small',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.22],
      at: [0, air, 0],
      half: [0, 0.58],
      scale: [0, 0.45, 0.3, 0.95, 1, 1.12],
      color: heat(L, [0.7, 0.55, 0.25, 0]),
      billboard: 'screen',
      rotation: { start: [0, 360], spin: L.spin },
      blend: 'add',
      bright: 0.95,
      occlude: 0.35,
      clamp: 1.1,
      tex: L.swirl,
    },
    {
      kind: 'particle',
      note: 'the element signature of the blow: flame tongues / ice crystals / ink / toxic blob / air slashes / ember rays (hits-builder sprites)',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, L.burstLife],
      at: [0, air, 0],
      half: [0, L.burstHalf * 0.75],
      scale: [0, 0.5, 0.3, 0.95, 1, 1.1],
      color: [0, L.core, 0.7, 0.25, L.mid, 0.8, 0.7, L.mid, 0.35, 1, L.rim, 0],
      billboard: 'screen',
      rotation: { start: [-10, 10], spin: L.name === 'wind' ? 360 : 0 },
      blend: 'add',
      bright: 0.95,
      occlude: 0.3,
      clamp: 1.1,
      tex: L.burst,
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.05,
      max: 1,
      rate: [0, 60],
      life: [0, 0.62],
      at: [0, 0.04, 0],
      half: [0, 1.5],
      scale: [0, 0.3, 0.3, 0.85, 1, 1.08],
      color: [0, dim(L.mid, 0.72), 0.0, 0.1, dim(L.mid, 0.72), 0.5, 0.55, dim(L.rim, 0.6), 0.34, 1, dim(L.rim, 0.6), 0],
      billboard: 'ground',
      rotation: { start: [0, 360] },
      blend: 'alpha',
      tex: ART_RING_SMOKE,
    },
    {
      kind: 'particle',
      note: 'skeleton_magician_fire_rotate: stretched sparks flung out of the blow (gravity pulls the embers down)',
      cycle: 0.05,
      max: 9,
      rate: [0, 600],
      life: [0, 0.32],
      at: [0, air, 0],
      shape: { kind: 'sphere', radius: 0.1 },
      adv: 'outer',
      vel: [0, 0.05],
      dir: { y: [0, 35] },
      half: [0, 0.14],
      scale: [[0, 0.45], [0, 1.6, 1, 0.5]],
      color: [0, L.core, 1, 0.45, L.mid, 0.85, 1, L.rim, 0],
      gravity: [0, 6],
      air: [0, 0.1],
      billboard: 'stretch',
      blend: 'add',
      bright: 1.25,
      clamp: 1.1,
      tex: L.name === 'fire' || L.name === 'physical' ? ART_COMET : ART_NEEDLE,
    },
  ];
  return {
    id: `sk.gen.ep_blow_${L.name}`,
    desc: `Enemy ${L.name} projectile BLOW: dark smoke puffs + element smoke ball + swirl flash + the element signature burst + a dark ragged ground ring + sparks`,
    behavior: 'selfBuff',
    ref: {},
    size: 'radius',
    base: 1,
    dur: 0.7,
    lift: 0,
    elements,
  };
}

export const MAKING_ID = (look: EpLook): string => `sk.gen.ep_making_${look}`;
export const RELEASE_ID = (look: EpLook): string => `sk.gen.ep_release_${look}`;
export const BLOW_ID = (look: EpLook): string => `sk.gen.ep_blow_${look}`;

export const specs: FxSpec[] = EP_LOOKS.flatMap((l) => [makingSpec(LOOKS[l]), releaseSpec(LOOKS[l]), blowSpec(LOOKS[l])]);

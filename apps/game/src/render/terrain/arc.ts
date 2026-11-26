// Run light arc (A-07). The 15-minute run gets a visual arc: the zone's light, haze, fog, colour grade, lantern pools and
// medallion glow move along the RUN CLOCK between keys. PL-03a is the plumbing; PL-03b sets DEFAULT_ARC's values (afternoon ->
// golden hour -> crimson dusk at the Great Metin), the zone lanes override per zone with `look.arc` (ArcKey[], look/types.ts).
// PL-04 (A-10) lays the corruption mood on top: as the world's corruption rises the shadows go bruised violet (a split tone on the
// grade, the hemispheres, the baked shadows), the far air turns cold and deep and the edges close in, while the lit colour keeps its
// light (`applyCorruption`, `CORRUPTION_MOOD`; the zone's `look.corruption` names the hues). A metin that breaks (the fed corruption
// falls by >= `HEAL.minDrop` within `HEAL.windowS`) lifts the sickness for a moment: the tint is evaluated at a lower corruption, the light
// rises and the air clears for ~1.75 s of RUN time, then it eases into the new, lower tint (`applyRelief`, `HEAL`, `healEnvelope`). The
// break opens the Metin Essence offer in the same sim tick and the sim (the run clock) stands still behind it, so the pulse ages on the
// RUN CLOCK it is fed: it waits at its start while an offer or the pause menu holds the run and plays when the player looks back at the world.
//
//   const arc = new RunArc(look, biome, { switches: pageArcSwitches() });
//   per frame (zoneScene.update):  arc.composite = <the composite pass exists>;  if (arc.update(runTime, corruption, dt)) apply(arc.state);
//
// Everything here is a pure function of (look, biome, run clock, corruption) - the corruption is smoothed over ~2 s when the
// caller passes the frame time, and taken as is without one: a co-op guest that feeds its mirrored `world.time` (the clock the HUD
// timer shows) and mirrored `world.corruption` (the value the HUD gauge shows) lands on the same state as the host. Nothing here
// touches three's scene or any GL object.
//
// The arc is RELATIVE to the zone's own preset: an ArcKey sub-field it does not name keeps the preset value at that key, so a key with
// only `t` is the identity, and an arc with no (or only identity) keys changes nothing (`update` never returns true, so the renderer
// writes nothing). The sun DIRECTION never changes (the shadows are baked); unlit layers are untouched.
import { Color } from 'three';
import type { BiomePreset } from '../../data/schema';
import { arcKeysOf, resolveCorruption, resolveGrade, DEFAULT_CORRUPTION, type ResolvedGrade } from './look';
import type { ArcKey, ZoneLook } from './look/types';

/** the part of the content biome the arc is relative to */
export type ArcBiome = Pick<BiomePreset, 'fog' | 'sun' | 'ambient'>;

// ---- state ----------------------------------------------------------------------------------------------------------------------

/** GradeSpec with every field present and the tints as colours (blendable without parsing hex every frame) */
export interface ArcGrade {
  lift: number;
  gamma: number;
  gain: [number, number, number];
  shadowTint: Color;
  shadowAmt: number;
  highlightTint: Color;
  highlightAmt: number;
  balance: number;
  contrast: number;
  pivot: number;
  saturation: number;
}

/**
 * What the renderer applies this frame. Colours are three Colors in the working (linear) space, exactly what `Color.set(hex)` gives
 * for the preset's hex, so the identity state is bit-identical to what the zone's biome / look already put on the lights.
 */
export interface ArcState {
  sun: { color: Color; intensity: number };
  hemi: { sky: Color; ground: Color; intensity: number };
  /** ZoneLook.fill: the tint added inside baked shadows and its strength (terrain shader) */
  fill: { shadowTint: Color; shadowFill: number };
  /** ZoneLook.fill sky / ground: the colours of the zone's extra hemisphere light (its intensity stays the look's; PL-04 tints it) */
  zoneFill: { sky: Color; ground: Color };
  /** ZoneLook.haze: depth haze colour / strength and the ground mist density */
  haze: { color: Color; depth: number; mist: number };
  fog: { color: Color; near: number; far: number };
  grade: ArcGrade;
  /** multiplier of the baked light-pool emissive (1 = as baked) */
  poolGain: number;
  /** ADDED to MedallionSpec.emissive (the terrain material clamps the sum, see `medallionEmissive`) */
  medallionGlow: number;
}

/** one compiled key: the absolute state at run clock `t` */
export interface ArcFrame extends ArcState {
  t: number;
}

const newGrade = (): ArcGrade => ({
  lift: 0,
  gamma: 1,
  gain: [1, 1, 1],
  shadowTint: new Color(),
  shadowAmt: 0,
  highlightTint: new Color(),
  highlightAmt: 0,
  balance: 0,
  contrast: 1,
  pivot: 0.18,
  saturation: 1,
});

function newState(): ArcState {
  return {
    sun: { color: new Color(), intensity: 0 },
    hemi: { sky: new Color(), ground: new Color(), intensity: 0 },
    fill: { shadowTint: new Color(), shadowFill: 0 },
    zoneFill: { sky: new Color(), ground: new Color() },
    haze: { color: new Color(), depth: 0, mist: 0 },
    fog: { color: new Color(), near: 0, far: 0 },
    grade: newGrade(),
    poolGain: 1,
    medallionGlow: 0,
  };
}

function copyGrade(d: ArcGrade, s: ArcGrade): void {
  d.lift = s.lift;
  d.gamma = s.gamma;
  d.gain[0] = s.gain[0];
  d.gain[1] = s.gain[1];
  d.gain[2] = s.gain[2];
  d.shadowTint.copy(s.shadowTint);
  d.shadowAmt = s.shadowAmt;
  d.highlightTint.copy(s.highlightTint);
  d.highlightAmt = s.highlightAmt;
  d.balance = s.balance;
  d.contrast = s.contrast;
  d.pivot = s.pivot;
  d.saturation = s.saturation;
}

function copyState(d: ArcState, s: ArcState): void {
  d.sun.color.copy(s.sun.color);
  d.sun.intensity = s.sun.intensity;
  d.hemi.sky.copy(s.hemi.sky);
  d.hemi.ground.copy(s.hemi.ground);
  d.hemi.intensity = s.hemi.intensity;
  d.fill.shadowTint.copy(s.fill.shadowTint);
  d.fill.shadowFill = s.fill.shadowFill;
  d.zoneFill.sky.copy(s.zoneFill.sky);
  d.zoneFill.ground.copy(s.zoneFill.ground);
  d.haze.color.copy(s.haze.color);
  d.haze.depth = s.haze.depth;
  d.haze.mist = s.haze.mist;
  d.fog.color.copy(s.fog.color);
  d.fog.near = s.fog.near;
  d.fog.far = s.fog.far;
  copyGrade(d.grade, s.grade);
  d.poolGain = s.poolGain;
  d.medallionGlow = s.medallionGlow;
}

const lerp = (a: number, b: number, s: number): number => a + (b - a) * s;
/** a.lerp(b, s) written into d (exactly `a` at s = 0 and whenever a == b) */
const lerpColor = (d: Color, a: Color, b: Color, s: number): void => {
  d.r = lerp(a.r, b.r, s);
  d.g = lerp(a.g, b.g, s);
  d.b = lerp(a.b, b.b, s);
};

function lerpState(d: ArcState, a: ArcState, b: ArcState, s: number): void {
  lerpColor(d.sun.color, a.sun.color, b.sun.color, s);
  d.sun.intensity = lerp(a.sun.intensity, b.sun.intensity, s);
  lerpColor(d.hemi.sky, a.hemi.sky, b.hemi.sky, s);
  lerpColor(d.hemi.ground, a.hemi.ground, b.hemi.ground, s);
  d.hemi.intensity = lerp(a.hemi.intensity, b.hemi.intensity, s);
  lerpColor(d.fill.shadowTint, a.fill.shadowTint, b.fill.shadowTint, s);
  d.fill.shadowFill = lerp(a.fill.shadowFill, b.fill.shadowFill, s);
  lerpColor(d.zoneFill.sky, a.zoneFill.sky, b.zoneFill.sky, s);
  lerpColor(d.zoneFill.ground, a.zoneFill.ground, b.zoneFill.ground, s);
  lerpColor(d.haze.color, a.haze.color, b.haze.color, s);
  d.haze.depth = lerp(a.haze.depth, b.haze.depth, s);
  d.haze.mist = lerp(a.haze.mist, b.haze.mist, s);
  lerpColor(d.fog.color, a.fog.color, b.fog.color, s);
  d.fog.near = lerp(a.fog.near, b.fog.near, s);
  d.fog.far = lerp(a.fog.far, b.fog.far, s);
  const g = d.grade;
  const ga = a.grade;
  const gb = b.grade;
  g.lift = lerp(ga.lift, gb.lift, s);
  g.gamma = lerp(ga.gamma, gb.gamma, s);
  g.gain[0] = lerp(ga.gain[0], gb.gain[0], s);
  g.gain[1] = lerp(ga.gain[1], gb.gain[1], s);
  g.gain[2] = lerp(ga.gain[2], gb.gain[2], s);
  lerpColor(g.shadowTint, ga.shadowTint, gb.shadowTint, s);
  g.shadowAmt = lerp(ga.shadowAmt, gb.shadowAmt, s);
  lerpColor(g.highlightTint, ga.highlightTint, gb.highlightTint, s);
  g.highlightAmt = lerp(ga.highlightAmt, gb.highlightAmt, s);
  g.balance = lerp(ga.balance, gb.balance, s);
  g.contrast = lerp(ga.contrast, gb.contrast, s);
  g.pivot = lerp(ga.pivot, gb.pivot, s);
  g.saturation = lerp(ga.saturation, gb.saturation, s);
  d.poolGain = lerp(a.poolGain, b.poolGain, s);
  d.medallionGlow = lerp(a.medallionGlow, b.medallionGlow, s);
}

function sameColor(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

function sameGrade(a: ArcGrade, b: ArcGrade): boolean {
  return (
    a.lift === b.lift &&
    a.gamma === b.gamma &&
    a.gain[0] === b.gain[0] &&
    a.gain[1] === b.gain[1] &&
    a.gain[2] === b.gain[2] &&
    sameColor(a.shadowTint, b.shadowTint) &&
    a.shadowAmt === b.shadowAmt &&
    sameColor(a.highlightTint, b.highlightTint) &&
    a.highlightAmt === b.highlightAmt &&
    a.balance === b.balance &&
    a.contrast === b.contrast &&
    a.pivot === b.pivot &&
    a.saturation === b.saturation
  );
}

/** exact equality of two states (the change test of `RunArc.update`) */
export function sameState(a: ArcState, b: ArcState): boolean {
  return (
    sameColor(a.sun.color, b.sun.color) &&
    a.sun.intensity === b.sun.intensity &&
    sameColor(a.hemi.sky, b.hemi.sky) &&
    sameColor(a.hemi.ground, b.hemi.ground) &&
    a.hemi.intensity === b.hemi.intensity &&
    sameColor(a.fill.shadowTint, b.fill.shadowTint) &&
    a.fill.shadowFill === b.fill.shadowFill &&
    sameColor(a.zoneFill.sky, b.zoneFill.sky) &&
    sameColor(a.zoneFill.ground, b.zoneFill.ground) &&
    sameColor(a.haze.color, b.haze.color) &&
    a.haze.depth === b.haze.depth &&
    a.haze.mist === b.haze.mist &&
    sameColor(a.fog.color, b.fog.color) &&
    a.fog.near === b.fog.near &&
    a.fog.far === b.fog.far &&
    sameGrade(a.grade, b.grade) &&
    a.poolGain === b.poolGain &&
    a.medallionGlow === b.medallionGlow
  );
}

/** a deep copy of a state (tests, snapshots) */
export function cloneState(s: ArcState): ArcState {
  const c = newState();
  copyState(c, s);
  return c;
}

// ---- the zone's own values (t = 0) ------------------------------------------------------------------------------------------------

/**
 * The zone's own light at t = 0: the preset the arc is relative to. `biome` is the render biome the zone was built with
 * (`resolveBiome`: what `Environment.setBiome` put on the lights), the rest comes from the look.
 */
export function arcBase(look: ZoneLook, biome: ArcBiome): ArcState {
  const s = newState();
  s.sun.color.set(biome.sun.color);
  s.sun.intensity = biome.sun.intensity;
  s.hemi.sky.set(biome.ambient.sky);
  s.hemi.ground.set(biome.ambient.ground);
  s.hemi.intensity = biome.ambient.intensity;
  s.fill.shadowTint.set(look.fill.shadowTint);
  s.fill.shadowFill = look.fill.shadowFill;
  s.zoneFill.sky.set(look.fill.sky);
  s.zoneFill.ground.set(look.fill.ground);
  // a zone with no haze configures the atmosphere with white / 0 / 0 (configureAtmosphere)
  s.haze.color.set(look.haze?.color ?? '#ffffff');
  s.haze.depth = look.haze?.depth ?? 0;
  s.haze.mist = look.haze?.mist ?? 0;
  s.fog.color.set(biome.fog.color);
  s.fog.near = biome.fog.near;
  s.fog.far = biome.fog.far;
  const g = resolveGrade(look.post?.grade);
  const d = s.grade;
  d.lift = g.lift;
  d.gamma = g.gamma;
  d.gain[0] = g.gain[0];
  d.gain[1] = g.gain[1];
  d.gain[2] = g.gain[2];
  d.shadowTint.set(g.shadowTint);
  d.shadowAmt = g.shadowAmt;
  d.highlightTint.set(g.highlightTint);
  d.highlightAmt = g.highlightAmt;
  d.balance = g.balance;
  d.contrast = g.contrast;
  d.pivot = g.pivot;
  d.saturation = g.saturation;
  return s;
}

/** `ArcGrade` -> the GradeSpec `PostPipeline.setGrade` takes (tints as sRGB hex) */
export function gradeSpecOf(g: ArcGrade): ResolvedGrade {
  return {
    lift: g.lift,
    gamma: g.gamma,
    gain: [g.gain[0], g.gain[1], g.gain[2]],
    shadowTint: `#${g.shadowTint.getHexString()}`,
    shadowAmt: g.shadowAmt,
    highlightTint: `#${g.highlightTint.getHexString()}`,
    highlightAmt: g.highlightAmt,
    balance: g.balance,
    contrast: g.contrast,
    pivot: g.pivot,
    saturation: g.saturation,
  };
}

/**
 * The terrain shader's medallion glow: `MedallionSpec.emissive + the arc's glow`, clamped to 0..1 (uMedalB.z; the shader's own mask
 * keeps the glow to the bright parts of the picture, never the whole disc).
 */
export function medallionEmissive(base: number | undefined, glow: number): number {
  const b = Number.isFinite(base) ? (base as number) : 0;
  const g = Number.isFinite(glow) ? glow : 0;
  return Math.min(1, Math.max(0, b + g));
}

// ---- keys -> keyframes -------------------------------------------------------------------------------------------------------------

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const fin = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const nonNeg = (v: unknown, d: number): number => Math.max(0, fin(v, d));

/** sets `d` from a hex when it is one (a malformed or absent hex keeps the preset colour) */
function setHex(d: Color, hex: unknown): void {
  if (typeof hex === 'string' && HEX.test(hex.trim())) d.set(hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`);
}

/** one ArcKey on top of the zone's own values: every sub-field it does not name stays the preset's */
function keyframeOf(k: ArcKey, base: ArcState): ArcFrame {
  const f = newState() as ArcFrame;
  copyState(f, base);
  f.t = Math.max(0, fin(k.t, 0));
  if (k.sun) {
    setHex(f.sun.color, k.sun.color);
    f.sun.intensity = nonNeg(k.sun.intensity, f.sun.intensity);
  }
  if (k.hemi) {
    setHex(f.hemi.sky, k.hemi.sky);
    setHex(f.hemi.ground, k.hemi.ground);
    f.hemi.intensity = nonNeg(k.hemi.intensity, f.hemi.intensity);
  }
  if (k.fill) {
    setHex(f.fill.shadowTint, k.fill.shadowTint);
    f.fill.shadowFill = nonNeg(k.fill.shadowFill, f.fill.shadowFill);
  }
  if (k.haze) {
    setHex(f.haze.color, k.haze.color);
    f.haze.depth = Math.min(1, nonNeg(k.haze.depth, f.haze.depth));
    f.haze.mist = Math.min(1, nonNeg(k.haze.mist, f.haze.mist));
  }
  if (k.fog) {
    setHex(f.fog.color, k.fog.color);
    f.fog.near = nonNeg(k.fog.near, f.fog.near);
    f.fog.far = Math.max(f.fog.near + 1, nonNeg(k.fog.far, f.fog.far));
  }
  const g = k.grade;
  if (g) {
    const d = f.grade;
    d.lift = fin(g.lift, d.lift);
    d.gamma = fin(g.gamma, d.gamma);
    const gg = g.gain;
    if (Array.isArray(gg) && gg.length === 3 && gg.every((c) => typeof c === 'number' && Number.isFinite(c))) {
      d.gain[0] = gg[0] as number;
      d.gain[1] = gg[1] as number;
      d.gain[2] = gg[2] as number;
    }
    setHex(d.shadowTint, g.shadowTint);
    d.shadowAmt = fin(g.shadowAmt, d.shadowAmt);
    setHex(d.highlightTint, g.highlightTint);
    d.highlightAmt = fin(g.highlightAmt, d.highlightAmt);
    d.balance = fin(g.balance, d.balance);
    d.contrast = fin(g.contrast, d.contrast);
    d.pivot = fin(g.pivot, d.pivot);
    d.saturation = fin(g.saturation, d.saturation);
  }
  f.poolGain = Math.min(8, nonNeg(k.poolGain, f.poolGain));
  f.medallionGlow = Math.min(1, nonNeg(k.medallionGlow, f.medallionGlow));
  return f;
}

/**
 * Keys -> sorted keyframes. The arc always starts at the preset: when the first key sits after t = 0 an implicit identity key at
 * t = 0 comes first (so a zone whose first key is at 300 s still opens on its own light). No keys = no frames = the identity.
 */
export function compileKeys(keys: readonly ArcKey[], base: ArcState): ArcFrame[] {
  const frames: ArcFrame[] = [];
  for (const k of keys) frames.push(keyframeOf(k, base));
  if (frames.length === 0) return frames;
  frames.sort((a, b) => a.t - b.t);
  if ((frames[0] as ArcFrame).t > 0) {
    const f0 = newState() as ArcFrame;
    copyState(f0, base);
    f0.t = 0;
    frames.unshift(f0);
  }
  return frames;
}

/** `s` in 0..1 -> smoothstep */
const smooth = (s: number): number => s * s * (3 - 2 * s);

/**
 * The state at run clock `t`: smoothstep between the two keyframes round `t`, the first / last key held before / after the
 * keys. No keyframes = the base. Written into `out` (allocation free) and returned.
 */
export function sampleFrames(frames: readonly ArcFrame[], base: ArcState, t: number, out: ArcState): ArcState {
  const n = frames.length;
  if (n === 0) {
    copyState(out, base);
    return out;
  }
  const first = frames[0] as ArcFrame;
  if (!(t > first.t)) {
    copyState(out, first);
    return out;
  }
  const last = frames[n - 1] as ArcFrame;
  if (t >= last.t) {
    copyState(out, last);
    return out;
  }
  let i = 0;
  while (i < n - 2 && t >= (frames[i + 1] as ArcFrame).t) i++;
  const a = frames[i] as ArcFrame;
  const b = frames[i + 1] as ArcFrame;
  const span = b.t - a.t;
  lerpState(out, a, b, span > 0 ? smooth(Math.min(1, Math.max(0, (t - a.t) / span))) : 1);
  return out;
}

// ---- the default arc (relative to the zone's preset) -------------------------------------------------------------------------------

/** "move `amount` (0..1) of the way from the preset's colour toward `color`" */
export type Toward = readonly [color: string, amount: number];

/**
 * One key of the DEFAULT arc, written RELATIVE to the zone's own preset (a zone with no `look.arc` of its own gets these keys resolved
 * against its preset). Every sub-field is optional; a key with only `t` is the identity.
 */
export interface ArcStep {
  /** run clock in seconds */
  t: number;
  sun?: { toward?: Toward; mul?: number };
  hemi?: { skyToward?: Toward; groundToward?: Toward; mul?: number };
  /** `shadowToward` moves the shadow tint, `fillMul` scales the fill strength */
  fill?: { shadowToward?: Toward; fillMul?: number };
  /** `mistAdd` is added to the mist density, `depthMul` scales the depth haze */
  haze?: { toward?: Toward; depthMul?: number; mistAdd?: number };
  fog?: { toward?: Toward };
  grade?: {
    shadowToward?: Toward;
    highlightToward?: Toward;
    shadowAmtAdd?: number;
    highlightAmtAdd?: number;
    gainMul?: [number, number, number];
    saturationMul?: number;
  };
  /** absolute multiplier of the baked pool emissive */
  poolGain?: number;
  /** absolute amount added to MedallionSpec.emissive */
  medallionGlow?: number;
}

/** "move `amount` of the way toward `color`" as a frozen tuple (the shape of `Toward`) */
const toward = (color: string, amount: number): Toward => Object.freeze([color, amount] as const);
/** a frozen RGB multiplier triple (ArcStep.grade.gainMul is typed as a plain tuple) */
const gain3 = (r: number, g: number, b: number): [number, number, number] => Object.freeze([r, g, b]) as unknown as [number, number, number];

/**
 * The afternoon (600 s): a warmer, slightly brighter sun, a honey haze, a richer colour, a touch of blue in the baked shadows. The lantern
 * pools wake a little (they are invisible at x1 on a lit afternoon ground).
 *
 * Every grade key of this arc names the SAME dark violet shadow tint (`shadowToward ['#2a1238', 1]`) and moves only its AMOUNT: the
 * shipped zones grade from a neutral WHITE tint at amount 0, so a tint that travelled from white to violet while its amount rose passed
 * through light grey and lifted the blacks into a milky veil for ~200 s (critic r1: dark pixel +48..+146 % at 650-800 s).
 */
const AFTERNOON: Omit<ArcStep, 't'> = Object.freeze({
  sun: Object.freeze({ toward: toward('#ffc890', 0.28), mul: 1.06 }),
  fill: Object.freeze({ shadowToward: toward('#4a6890', 0.15) }),
  haze: Object.freeze({ toward: toward('#e8b878', 0.2) }),
  grade: Object.freeze({
    shadowToward: toward('#2a1238', 1),
    highlightToward: toward('#ffc680', 0.6),
    highlightAmtAdd: 0.09,
    gainMul: gain3(1.03, 1, 0.95),
    // a richer afternoon: on a zone whose palette is already warm and dark (Daeryeol) the colour is the only thing that can move
    saturationMul: 1.1,
  }),
  poolGain: 2,
});

/**
 * The golden hour (780 s): amber light pooling on the ground, violet air in the shadows, the lanterns lit. It is its own key, so the
 * crimson of the dusk only arrives in the last 100 s (a single 600 -> 880 s ramp was 80 % dusk at 800 s: grey-mauve water, a pink cast).
 */
const GOLDEN_HOUR: Omit<ArcStep, 't'> = Object.freeze({
  sun: Object.freeze({ toward: toward('#ffb868', 0.44), mul: 1 }),
  hemi: Object.freeze({ skyToward: toward('#ffd8b0', 0.12), mul: 0.97 }),
  fill: Object.freeze({ shadowToward: toward('#4a5090', 0.3) }),
  haze: Object.freeze({ toward: toward('#f0b070', 0.26), mistAdd: 0.02 }),
  fog: Object.freeze({ toward: toward('#d09068', 0.08) }),
  grade: Object.freeze({
    shadowToward: toward('#2a1238', 1),
    shadowAmtAdd: 0.05,
    highlightToward: toward('#ffb060', 0.6),
    highlightAmtAdd: 0.12,
    gainMul: gain3(1.04, 0.995, 0.93),
    saturationMul: 1.06,
  }),
  poolGain: 3,
  medallionGlow: 0.3,
});

/**
 * The crimson dusk at the Great Metin: the last look of the run, reached at 880 s and held from there (the final boss and the Great
 * Metin fall at 900 s). Every number is relative to the zone's own preset. Rose-red, not amber: the sun carries the warmth, the air goes
 * crimson / violet, the grade stays near neutral (an orange sun + orange grade turned every ground the same rust and cut the contrast
 * of the red telegraphs by ~60 %), and the exposure drops only ~10 % so the plaza, the cobbles and the medallion keep their depth.
 */
const DUSK: Omit<ArcStep, 't'> = Object.freeze({
  sun: Object.freeze({ toward: toward('#ff7a78', 0.4), mul: 0.9 }),
  hemi: Object.freeze({ skyToward: toward('#9a6aa8', 0.24), groundToward: toward('#6a3a5a', 0.22), mul: 0.9 }),
  fill: Object.freeze({ shadowToward: toward('#4a3a88', 0.45) }),
  haze: Object.freeze({ toward: toward('#c04a6a', 0.28), mistAdd: 0.05 }),
  fog: Object.freeze({ toward: toward('#5a3050', 0.22) }),
  grade: Object.freeze({
    shadowToward: toward('#2a1238', 1),
    shadowAmtAdd: 0.12,
    highlightToward: toward('#ff8c84', 0.5),
    highlightAmtAdd: 0.1,
    gainMul: gain3(1.03, 0.97, 0.98),
    saturationMul: 0.98,
  }),
  // the lantern pools read as warm pools on the dusk ground (x1 and x3 were invisible); the medallion's brightest inlay glows (the
  // terrain shader's own mask keeps it to the bright parts: frost glints on Seori's disc, white glints on the carved stone elsewhere)
  poolGain: 4.5,
  medallionGlow: 1,
});

/**
 * The arc of a zone that has no `look.arc` (PL-03b): the run opens on the zone's own light (t = 0 is the identity), the afternoon
 * warms by 600 s, the golden hour comes at 780 s and the crimson dusk of the final fight by 880 s (smoothstep between the keys, held
 * after 900 s). A zone lane overrides it with its own `look.arc` (stage B).
 */
export const DEFAULT_ARC: readonly ArcStep[] = Object.freeze([
  Object.freeze({ t: 0 }),
  Object.freeze({ t: 600, ...AFTERNOON }),
  Object.freeze({ t: 780, ...GOLDEN_HOUR }),
  Object.freeze({ t: 880, ...DUSK }),
  Object.freeze({ t: 900, ...DUSK }),
]);

const toHex = (c: Color): string => `#${c.getHexString()}`;
const tmpA = new Color();
const tmpB = new Color();

function towardHex(from: Color, to: Toward | undefined): string | undefined {
  if (!to) return undefined;
  const amt = Math.min(1, Math.max(0, fin(to[1], 0)));
  if (!HEX.test(String(to[0]).trim())) return undefined;
  tmpA.copy(from);
  tmpB.set(String(to[0]).trim());
  tmpA.r = lerp(tmpA.r, tmpB.r, amt);
  tmpA.g = lerp(tmpA.g, tmpB.g, amt);
  tmpA.b = lerp(tmpA.b, tmpB.b, amt);
  return toHex(tmpA);
}

/** Relative steps -> absolute ArcKeys against the zone's own values (only the fields a step names are present). */
export function stepsToKeys(steps: readonly ArcStep[], base: ArcState): ArcKey[] {
  const keys: ArcKey[] = [];
  for (const st of steps) {
    const k: ArcKey = { t: st.t };
    if (st.sun) {
      const color = towardHex(base.sun.color, st.sun.toward);
      k.sun = { ...(color ? { color } : {}), ...(st.sun.mul !== undefined ? { intensity: base.sun.intensity * st.sun.mul } : {}) };
    }
    if (st.hemi) {
      const sky = towardHex(base.hemi.sky, st.hemi.skyToward);
      const ground = towardHex(base.hemi.ground, st.hemi.groundToward);
      k.hemi = { ...(sky ? { sky } : {}), ...(ground ? { ground } : {}), ...(st.hemi.mul !== undefined ? { intensity: base.hemi.intensity * st.hemi.mul } : {}) };
    }
    if (st.fill) {
      const shadowTint = towardHex(base.fill.shadowTint, st.fill.shadowToward);
      k.fill = { ...(shadowTint ? { shadowTint } : {}), ...(st.fill.fillMul !== undefined ? { shadowFill: base.fill.shadowFill * st.fill.fillMul } : {}) };
    }
    if (st.haze) {
      const color = towardHex(base.haze.color, st.haze.toward);
      k.haze = {
        ...(color ? { color } : {}),
        ...(st.haze.depthMul !== undefined ? { depth: base.haze.depth * st.haze.depthMul } : {}),
        ...(st.haze.mistAdd !== undefined ? { mist: base.haze.mist + st.haze.mistAdd } : {}),
      };
    }
    if (st.fog) {
      const color = towardHex(base.fog.color, st.fog.toward);
      k.fog = color ? { color } : {};
    }
    if (st.grade) {
      const g = st.grade;
      const b = base.grade;
      const shadowTint = towardHex(b.shadowTint, g.shadowToward);
      const highlightTint = towardHex(b.highlightTint, g.highlightToward);
      k.grade = {
        ...(shadowTint ? { shadowTint } : {}),
        ...(highlightTint ? { highlightTint } : {}),
        ...(g.shadowAmtAdd !== undefined ? { shadowAmt: b.shadowAmt + g.shadowAmtAdd } : {}),
        ...(g.highlightAmtAdd !== undefined ? { highlightAmt: b.highlightAmt + g.highlightAmtAdd } : {}),
        ...(g.gainMul ? { gain: [b.gain[0] * g.gainMul[0], b.gain[1] * g.gainMul[1], b.gain[2] * g.gainMul[2]] as [number, number, number] } : {}),
        ...(g.saturationMul !== undefined ? { saturation: b.saturation * g.saturationMul } : {}),
      };
    }
    if (st.poolGain !== undefined) k.poolGain = st.poolGain;
    if (st.medallionGlow !== undefined) k.medallionGlow = st.medallionGlow;
    keys.push(k);
  }
  return keys;
}

// ---- the corruption tint (PL-04, A-10) ---------------------------------------------------------------------------------------------

/** the world tint settles (95 %) this many seconds after the corruption moved: a metin or an awakening eases the land instead of jumping it (the visible beat of a break is the relief pulse, `HEAL`) */
export const CORRUPTION_SETTLE_S = 2;
/** time constant of the exponential follow: 1 - exp(-CORRUPTION_SETTLE_S / tau) = 0.95 */
const CORRUPTION_TAU = CORRUPTION_SETTLE_S / Math.log(20);
/** a smoothed corruption this close to its target IS the target, so a steady corruption writes nothing */
const CORRUPTION_EPS = 0.001;

/** the numbers of `CORRUPTION_MOOD` (documented there) */
export interface CorruptionMood {
  gradeSatShare: number;
  satBoost: number;
  warmSatCut: number;
  gradeShadowAmt: number;
  warmShadowAmt: number;
  warmFillLift: number;
  gradeTintLuma: number;
  gradeTintChroma: number;
  contrast: number;
  gain: number;
  hemiSkyMix: number;
  hemiGroundMix: number;
  bruiseChroma: number;
  hemiDesat: number;
  hemiBoost: number;
  sunMix: number;
  sunWarm: number;
  sunDim: number;
  fogMix: number;
  fogDeepen: number;
  fogNear: number;
  fogFar: number;
  hazeMix: number;
  hazeDeepen: number;
  hazeDepth: number;
  shadowLift: number;
  shadowLiftMax: number;
}

/**
 * How the sickness is painted (every number is "at full corruption", scaled by the smoothed corruption c; all of it uniforms).
 * The land does not just lose colour (the first build: a ~15 % grey film that the blind pairs rejected), it GAINS a mood: the lit
 * parts keep their light and colour, the shadows go bruised violet, the far air turns cold and deep, the edges close in. A zone's own
 * `look.corruption` still names the hues (`shadowTint`, `haze`) and the two amounts (`desaturate`, `darken`).
 */
export const CORRUPTION_MOOD: Readonly<CorruptionMood> = Object.freeze({
  /** share of `desaturate` the composite grade takes from the whole frame (the rest is taken from the shadow-side light: the hemispheres) */
  gradeSatShare: 0.2,
  /** the saturation of the grade ADDED back (the violet split tone pulls the lit colours toward grey: the lit land keeps its colour) */
  satBoost: 0.2,
  /** share of `satBoost` taken back in a zone with a deep gold key light (`CorruptionTint.warmth`): there the boost is what made the land read as a stronger sunset, not as sickness */
  warmSatCut: 0.25,
  /** split-tone shadow amount ADDED to the grade (a weighted blend with the zone's / the arc's own tint: a white tint at amount 0 never lifts a black) */
  gradeShadowAmt: 0.17,
  /** share of `gradeShadowAmt` ADDED in a warm-key zone: a violet that survives a gold sun needs more of it */
  warmShadowAmt: 0.45,
  /** a warm-key zone LIFTS its baked shadow fill by this much (x (1 + this c)) instead of thinning it: the violet fill is what turns the shade of a gold-lit land bruised (the split tone alone is a few levels there) */
  warmFillLift: 2,
  /** luma (linear) of the split-tone shadow tint: DARK, so the tint adds hue and never lifts a dark pixel into a milky veil */
  gradeTintLuma: 0.018,
  /** chroma of that tint relative to the corruption shadow tint's (>1 = more saturated violet) */
  gradeTintChroma: 1.8,
  /** the S-curve contrast ADDED (deeper shadows, a firmer light: the grey film is gone) and the gain (exposure of the lit part) */
  contrast: 0.09,
  gain: 0.03,
  /** the hemispheres (the light that fills every shadow: the biome's and the zone's fill) move this far toward the bruise violet, brightness kept */
  hemiSkyMix: 0.4,
  hemiGroundMix: 0.55,
  /** chroma of the bruise colour the hemispheres move toward, relative to `look.corruption.shadowTint` */
  bruiseChroma: 1.6,
  /** fraction of `desaturate` taken from the hemispheres' colour: the SHADOWED land loses colour, the lit land keeps it */
  hemiDesat: 1,
  /** the hemisphere's intensity gained (the shadows are lit violet, not just darker) */
  hemiBoost: 0.1,
  /** the key light: moves toward the bruise hue (brightness kept), then dims; a light with chroma >= sunWarm is not turned at all */
  sunMix: 0.25,
  sunWarm: 0.6,
  sunDim: 0,
  /** the fog colour moves toward the corruption haze, then loses this much brightness: the far edge closes in cold and dark */
  fogMix: 0.4,
  fogDeepen: 0.4,
  /** the fog starts / ends closer (x (1 - this)): the far edge of the frame closes in */
  fogNear: 0.35,
  fogFar: 0.2,
  /** the depth haze: colour move, brightness lost, thickness ADDED */
  hazeMix: 0.35,
  hazeDeepen: 0.45,
  hazeDepth: 0.12,
  /** the baked shadows' fill is lifted this much (x (1 + this c)) instead of thinned; 0 = the zone's `darken` thins it (the composite pass carries the shadows) */
  shadowLift: 0,
  /** ... but never by more than this much (absolute) at full corruption: a zone whose baked shadow fill is already strong (Daeryeol's 0.8) must not be flooded */
  shadowLiftMax: 0,
});
/**
 * The same, with no composite pass (the low tier, every phone): no grade (no split tone, contrast, saturation), so the channels low
 * does draw take a stronger share: the hemispheres go violet and brighter, the key light turns and dims a little, the baked shadows
 * are LIFTED in violet, the air closes in tighter. (The first build left low at +0.7..2.9 8-bit levels: no reaction at all.)
 */
export const CORRUPTION_MOOD_LOW: Readonly<CorruptionMood> = Object.freeze({
  ...CORRUPTION_MOOD,
  hemiSkyMix: 0.7,
  hemiGroundMix: 0.85,
  hemiBoost: 0.04,
  sunMix: 0.6,
  sunDim: 0.16,
  fogMix: 0.6,
  fogDeepen: 0.5,
  fogNear: 0.4,
  fogFar: 0.25,
  hazeMix: 0.5,
  hazeDeepen: 0.55,
  hazeDepth: 0.18,
  shadowLift: 5,
  shadowLiftMax: 2.4,
});
/**
 * The same for a zone whose LIT colour is its identity (`CorruptionTint.lit`: a strong, coloured key light - Yeonmu's green plain,
 * Suryeon's gold). With no grade on low, the lights do all of it, and the hemispheres / key light that fill and cover the lit ground
 * turned it into a mauve-grey film in the blind pairs (sand B 34 -> 45, saturation -8 %, luma -7 %: the r1 critic's low pairs: "duller, not
 * moodier"). So a zone like that takes this table: the key light is turned and dimmed hardly at all (the lit ground keeps its colour and
 * light), the hemisphere that fills the shade still turns toward the bruise violet but is DIMMED (the ambient light is what lifts the shade, so
 * the shade deepens and takes the hue, while the ground lit by the sun keeps its colour: the value structure of the medium / high mood without
 * a grade), the baked shadows carry a modest violet lift and the far air closes in. A zone in between takes the table in between
 * (`CorruptionTint.low`).
 */
export const CORRUPTION_MOOD_LOW_LIT: Readonly<CorruptionMood> = Object.freeze({
  ...CORRUPTION_MOOD_LOW,
  hemiSkyMix: 0.5,
  hemiGroundMix: 0.6,
  hemiBoost: -0.3,
  sunMix: 0.1,
  sunDim: 0.02,
  fogMix: 0.5,
  fogDeepen: 0.45,
  fogNear: 0.4,
  fogFar: 0.25,
  hazeMix: 0.4,
  hazeDeepen: 0.45,
  hazeDepth: 0.15,
  shadowLift: 2,
  shadowLiftMax: 0.8,
});
/**
 * `CorruptionTint.lit`: 0 for a zone lit mostly by its ambient light (Seori's snow, Daeryeol's basalt: the bruise is what colours them),
 * 1 for a zone under a strong chromatic key light (the chroma of the key light x its intensity from `LIT.from` to `LIT.to`, a smoothstep).
 * Read from the zone's own preset, so a retuned sun moves it without anyone touching this file.
 */
export const LIT = Object.freeze({ from: 1.3, to: 1.9 });

/** a zone's `look.corruption` as numbers and (linear) colours: what `applyCorruption` blends toward */
export interface CorruptionTint {
  /** 0..1 saturation lost at full corruption */
  desaturate: number;
  /** 0..1 shadow fill lost at full corruption */
  darken: number;
  /** the bruise: the terrain's baked shadows go toward it */
  shadowTint: Color;
  /** the bruise as light: `shadowTint` with its chroma raised (the colour the hemispheres and the key light take the hue of) */
  bruise: Color;
  /** the sick air: the haze and the fog take its hue */
  haze: Color;
  /** the split-tone tint of the composite grade: `shadowTint`'s hue, more saturated, at the dark luma `gradeTintLuma` */
  gradeTint: Color;
  /** 0..1 how deep a gold the zone's own key light is (`warmthOf` its preset sun): 0 for a pale sun, 1 for Suryeon's; see `CORRUPTION_MOOD.warmSatCut` */
  warmth: number;
  /** 0..1 how much the zone's lit colour is its identity (`litOf`): picks the low-tier table between `CORRUPTION_MOOD_LOW` (0) and `CORRUPTION_MOOD_LOW_LIT` (1) */
  lit: number;
  /** the mood table of the low tier (no composite pass) for this zone: `CORRUPTION_MOOD_LOW` mixed toward `CORRUPTION_MOOD_LOW_LIT` by `lit` */
  low: Readonly<CorruptionMood>;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const lumaOf = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
/** (max - min) / max of a linear colour: 0 for a grey, 1 for a pure hue */
const chromaOf = (c: Color): number => {
  const mx = Math.max(c.r, c.g, c.b);
  return mx > 1e-9 ? (mx - Math.min(c.r, c.g, c.b)) / mx : 0;
};
/** how deep a gold a key light is, 0..1: a smoothstep of its chroma between 0.55 (pale / amber: 0) and 0.72 (deep gold: 1) */
export function warmthOf(sun: Color): number {
  const x = clamp01((chromaOf(sun) - 0.55) / 0.17);
  return x * x * (3 - 2 * x);
}

/** how much a zone's lit colour is its identity, 0..1: a smoothstep of (chroma of the key light x its intensity) between `LIT.from` and `LIT.to` */
export function litOf(sun: Color, intensity: number): number {
  const x = clamp01((chromaOf(sun) * (Number.isFinite(intensity) ? intensity : 0) - LIT.from) / (LIT.to - LIT.from));
  return x * x * (3 - 2 * x);
}

/** every number of `a` moved `k` (0..1) of the way to the one of `b` */
function mixMood(a: CorruptionMood, b: CorruptionMood, k: number): CorruptionMood {
  const o = { ...a };
  for (const key of Object.keys(a) as (keyof CorruptionMood)[]) o[key] = a[key] + (b[key] - a[key]) * k;
  return Object.freeze(o);
}

/** `d` = `src` with its chroma x `chroma` about its own luma, then scaled to luma `luma` (hue kept); black stays black */
function darkTone(d: Color, src: Color, chroma: number, luma: number): void {
  const l = lumaOf(src);
  const r = Math.max(0, l + (src.r - l) * chroma);
  const g = Math.max(0, l + (src.g - l) * chroma);
  const b = Math.max(0, l + (src.b - l) * chroma);
  d.setRGB(r, g, b);
  const l2 = lumaOf(d);
  if (l2 > 1e-9) d.multiplyScalar(luma / l2);
}

/**
 * The corruption tint of a zone: its `look.corruption`, each field it does not name the DEFAULT_CORRUPTION value (a zone with no tint
 * of its own still reacts); a malformed hex falls back to the default colour, the amounts are clamped to 0..1. `sun` = the zone's preset
 * key light (for `warmth` and `lit`, with its `sunIntensity`; absent = a pale, dim sun).
 */
export function corruptionTintOf(look: Pick<ZoneLook, 'corruption'>, sun?: Color, sunIntensity = 0): CorruptionTint {
  const r = resolveCorruption(look.corruption);
  const t: CorruptionTint = {
    desaturate: clamp01(fin(r.desaturate, DEFAULT_CORRUPTION.desaturate)),
    darken: clamp01(fin(r.darken, DEFAULT_CORRUPTION.darken)),
    shadowTint: new Color().set(DEFAULT_CORRUPTION.shadowTint),
    haze: new Color().set(DEFAULT_CORRUPTION.haze),
    gradeTint: new Color(),
    bruise: new Color(),
    warmth: sun ? warmthOf(sun) : 0,
    lit: sun ? litOf(sun, sunIntensity) : 0,
    low: CORRUPTION_MOOD_LOW,
  };
  if (t.lit > 0) t.low = mixMood(CORRUPTION_MOOD_LOW, CORRUPTION_MOOD_LOW_LIT, t.lit);
  setHex(t.shadowTint, r.shadowTint);
  setHex(t.haze, r.haze);
  darkTone(t.gradeTint, t.shadowTint, CORRUPTION_MOOD.gradeTintChroma, CORRUPTION_MOOD.gradeTintLuma);
  darkTone(t.bruise, t.shadowTint, CORRUPTION_MOOD.bruiseChroma, lumaOf(t.shadowTint));
  return t;
}

/**
 * `d` moves `mix` of the way toward the HUE of `to` (a lerp in linear light), then keeps its own brightness x (1 - deepen): a pure
 * hue move cannot lift a colour into a veil, and `deepen` closes it in. A channel above 1 is scaled back.
 */
function recolor(d: Color, to: Color, mix: number, deepen: number): void {
  const l0 = lumaOf(d);
  d.r += (to.r - d.r) * mix;
  d.g += (to.g - d.g) * mix;
  d.b += (to.b - d.b) * mix;
  const l1 = lumaOf(d);
  if (l1 > 1e-9) d.multiplyScalar((l0 * (1 - deepen)) / l1);
  const m = Math.max(d.r, d.g, d.b);
  if (m > 1) d.multiplyScalar(1 / m);
}

/** `d` loses `amount` of its saturation (mix toward its own luma), brightness kept */
function desaturateColor(d: Color, amount: number): void {
  const l = lumaOf(d);
  d.r += (l - d.r) * amount;
  d.g += (l - d.g) * amount;
  d.b += (l - d.b) * amount;
}

/**
 * The corruption on top of an arc state, in place (`c` = smoothed corruption 0..1). Multiplicative on what the arc made of the zone's
 * light, so the two compose. It adds a MOOD, it does not just take colour away (`CORRUPTION_MOOD`):
 *  - the composite grade: a dark violet split-tone on the shadows (an amount ADDED, a weighted blend with the tint the zone / the
 *    arc already has), a little contrast, a smaller share of `desaturate` (the warm key light and the lit colours stay),
 *  - the hemisphere, which fills every shadow, takes the corruption violet at its own brightness and loses `desaturate` of its colour,
 *  - the terrain's baked shadows: tint toward the corruption's, the fill x (1 - darken c) (a warm-key zone lifts it instead, `warmFillLift`),
 *  - the far air: the haze colour and the fog colour turn toward the corruption's haze and lose brightness, the haze thickens a little.
 * The sun turns only when it is pale (a golden-hour sun keeps its gold; its shadows carry the violet) and its exposure moves only on low;
 * the grade's gain rises 3 %, its lift / gamma / highlights, the lantern pools and the medallion are the arc's. The red telegraphs, the
 * hero ring and the pickups sit in the composite frame like everything else: they are pushed within `CORRUPTION_MOOD`'s limits (a firmer
 * light, never drained: the arc.test readability block pins it). c = 0 is the identity, bit for bit.
 *
 * `composite` = the composite pass exists (medium / high): without it (low) the grade changes are not drawn, so `CORRUPTION_MOOD_LOW`
 * gives the channels low does draw a stronger share. A deep gold key light (`tint.warmth`) takes less of the saturation boost and more of
 * the violet split tone, so a warm zone reads as sick instead of as a stronger sunset.
 */
export function applyCorruption(s: ArcState, c: number, tint: CorruptionTint, composite = true): void {
  if (!(c > 0)) return;
  const m = composite ? CORRUPTION_MOOD : tint.low;
  const g = s.grade;
  g.saturation *= 1 - tint.desaturate * m.gradeSatShare * c + m.satBoost * (1 - m.warmSatCut * tint.warmth) * c;
  g.contrast += m.contrast * c;
  const gm = 1 + m.gain * c;
  g.gain[0] *= gm;
  g.gain[1] *= gm;
  g.gain[2] *= gm;
  // split tone: weighted blend (amount a, tint T) + (amount b, tint V) -> amount a + b, tint (a T + b V) / (a + b)
  const a = g.shadowAmt;
  const b = m.gradeShadowAmt * (1 + m.warmShadowAmt * tint.warmth) * c;
  if (b > 0) {
    lerpColor(g.shadowTint, g.shadowTint, tint.gradeTint, b / (a + b));
    g.shadowAmt = a + b;
  }
  // the light that fills the shadows (the biome's hemisphere and the zone's own fill hemisphere)
  const dsat = tint.desaturate * m.hemiDesat * c;
  for (const col of [s.hemi.sky, s.zoneFill.sky]) {
    recolor(col, tint.bruise, m.hemiSkyMix * c, 0);
    desaturateColor(col, dsat);
  }
  for (const col of [s.hemi.ground, s.zoneFill.ground]) {
    recolor(col, tint.bruise, m.hemiGroundMix * c, 0);
    desaturateColor(col, dsat);
  }
  s.hemi.intensity *= 1 + m.hemiBoost * c;
  if (m.sunMix > 0 || m.sunDim > 0) {
    // the more golden the key light, the less it is turned: a golden-hour sun stays golden (its shadows carry the violet), a pale one goes lilac
    const sc = s.sun.color;
    recolor(sc, tint.bruise, m.sunMix * clamp01(1 - chromaOf(sc) / m.sunWarm) * c, 0);
    s.sun.intensity *= 1 - m.sunDim * c;
  }
  // the baked shadows of the ground
  lerpColor(s.fill.shadowTint, s.fill.shadowTint, tint.shadowTint, c);
  if (m.shadowLift > 0) s.fill.shadowFill = Math.min(s.fill.shadowFill * (1 + m.shadowLift * c), s.fill.shadowFill + m.shadowLiftMax * c);
  else s.fill.shadowFill *= (1 - tint.warmth) * (1 - tint.darken * c) + tint.warmth * (1 + m.warmFillLift * c);
  // the far air
  recolor(s.haze.color, tint.haze, m.hazeMix * c, m.hazeDeepen * c);
  s.haze.depth = Math.min(1, s.haze.depth + m.hazeDepth * c);
  recolor(s.fog.color, tint.haze, m.fogMix * c, m.fogDeepen * c);
  s.fog.near *= 1 - m.fogNear * c;
  s.fog.far = Math.max(s.fog.near + 1, s.fog.far * (1 - m.fogFar * c));
}

// ---- the relief pulse: a metin breaks, the land heals as the player looks back at the world after the offer (PL-04, A-10) ----------------

/**
 * A metin that breaks lowers the world's corruption by exactly 0.06 (sim/metins.ts), which on its own moves the land by under 1 %: nobody
 * would see it (the r1 / r2 reviews measured it inside the noise of the animated scene). So a break also starts a short RELIEF PULSE:
 * the tint is evaluated at a lower corruption, the light rises and the air clears for ~1.75 s, then the land eases into the new, lower tint.
 * Keyed off the corruption the arc is FED (the sim's, or on a co-op guest the mirrored `world.corruption` the HUD gauge shows), so every
 * screen sees the same beat. A guest's mirrored value is INTERPOLATED between two snapshots (net/coop/mirror.ts), so a break reaches it as
 * a ramp over 70-200 ms, not as a step: the drop is therefore summed over a short window (`windowS`), never judged per frame.
 *
 * THE CLOCK OF THE PULSE IS THE RUN CLOCK. An ordinary metin break opens the Metin Essence offer in the very tick that lowers the corruption
 * (sim/metins.ts onMetinRowDied -> openEssence), and the sim - hence `world.time` - stands still while an offer (or the pause menu) is open
 * while the renderer keeps drawing with the wall-clock frame time behind the dark scrim. A pulse timed on the frame time ran its whole
 * ~1.75 s behind the offer (the r1 critic measured the lift at +1.0 s and the plain tint after the pick): no player ever saw it. So the
 * pulse AGES BY THE RUN-CLOCK TIME the arc is fed: detected in the frame after the break, held at its start while the clock stands still,
 * played when it moves again - the heal happens as the player looks back at the world after the pick (and holds again if the XP of the
 * break opens a level-up offer). A break with no offer plays at once. On a guest the clock is the mirrored one (`rt`), which stalls the
 * same way while the host holds the sim. Uniforms only; it never exists without a frame time (`evaluate`, tests, the first call of a
 * late joiner).
 */
export const HEAL = Object.freeze({
  /** the fed corruption falling by at least this much inside `windowS` starts a pulse: a break is -0.06, the natural decay 0.004 / s (0.001 in the window), an awakening is a RISE */
  minDrop: 0.03,
  /** the drop a metin break makes (sim/metins.ts); only the arc test reads it, to notice the day the sim changes it */
  breakDrop: 0.06,
  /** the window (s) the falls are summed over: a leaky sum with this time constant; a slow fall (under ~0.1 / s) never reaches `minDrop` */
  windowS: 0.3,
  /** after a pulse starts, falls are ignored for this long (s): the rest of an interpolated break must not start a second pulse */
  cooldownS: 0.4,
  /** a land at or below `sickLow` (smoothed) corruption does not pulse, at `sickFull` and above it pulses in full: a healthy land has nothing to be relieved of */
  sickLow: 0.08,
  sickFull: 0.4,
  /** the rise to the peak (s) and the fall from it to the plain state (s) */
  attackS: 0.15,
  decayS: 1.6,
  /**
   * the run clock jumping by more than this between two frames (s), or backwards, is a resync (a guest back from a hidden tab: the mirror's
   * playback clock re-seats itself; a new run), never a break, and the pulse does not skip ahead. (RenderCore clamps the FRAME time to 0.25 s,
   * and a normal frame moves the clock by <= 0.25 s, so only a jump of the clock itself is seen here)
   */
  maxJump: 0.5,
  /** at the peak the tint is evaluated at c - relief: half of the sickness is lifted ... */
  relief: 0.5,
  /** ... minus this share of it in a deep gold zone (`warmth` 1): there the violet of the shade is what balances the amber, lifting it all turns the frame near-pure orange */
  warmRelief: 0.35,
  /** at the peak (all x the pulse level e): the exposure (grade gain) and the saturation, the key light and the hemispheres rise; the air clears: fog and haze pushed back */
  gain: 0.07,
  saturation: 0.12,
  /** share of the saturation lift taken back in a deep gold zone (`warmth` 1): an amber land does not need more orange */
  warmSat: 0.75,
  sun: 0.06,
  hemi: 0.12,
  fogNear: 0.35,
  fogFar: 0.35,
  haze: 0.6,
  mist: 0.5,
  /** with no composite pass (low) the gain / saturation are not drawn: the key light and the hemispheres take this multiple of their lift */
  lowShare: 2,
});

/** the pulse level 0..1 `age` seconds after a break: a smooth rise over `attackS`, a smooth fall over `decayS`; 0 before it, after it and for a bad age */
export function healEnvelope(age: number): number {
  if (!(age >= 0)) return 0;
  if (age < HEAL.attackS) {
    const x = age / HEAL.attackS;
    return x * x * (3 - 2 * x);
  }
  const x = (age - HEAL.attackS) / HEAL.decayS;
  if (!(x < 1)) return 0;
  const y = 1 - x;
  return y * y * (3 - 2 * y);
}

/** how sick the land counts as for the pulse, 0..1, from its smoothed corruption */
export function healSickness(c: number): number {
  const x = clamp01((c - HEAL.sickLow) / (HEAL.sickFull - HEAL.sickLow));
  return x * x * (3 - 2 * x);
}

/** the corruption the pulse lifts at level `e` (the tint is evaluated at c minus this): half of the sickness, less in a deep gold zone */
export function reliefLift(e: number, warmth = 0): number {
  return HEAL.relief * (1 - HEAL.warmRelief * clamp01(warmth)) * e;
}

/**
 * The relief on top of an arc state AFTER the corruption was applied at the lower corruption, in place (`e` = the pulse level 0..1):
 * a lift of light (grade gain, key light, hemispheres), the colour comes back a little (less in a deep gold zone, `warmth` 1), and the
 * air clears (fog and haze pushed back). e = 0 never touches a state. `composite` as in `applyCorruption`.
 */
export function applyRelief(s: ArcState, e: number, composite = true, warmth = 0): void {
  if (!(e > 0)) return;
  const h = HEAL;
  const k = composite ? 1 : h.lowShare;
  const g = s.grade;
  g.saturation *= 1 + h.saturation * (1 - h.warmSat * clamp01(warmth)) * e;
  const gm = 1 + h.gain * e;
  g.gain[0] *= gm;
  g.gain[1] *= gm;
  g.gain[2] *= gm;
  s.sun.intensity *= 1 + h.sun * k * e;
  s.hemi.intensity *= 1 + h.hemi * k * e;
  s.fog.near *= 1 + h.fogNear * e;
  s.fog.far *= 1 + h.fogFar * e;
  s.haze.depth *= 1 - h.haze * e;
  s.haze.mist *= 1 - h.mist * e;
}

// ---- the page switches (DEV / VITE_QA_HOOKS only) --------------------------------------------------------------------------------

export interface ArcSwitches {
  /** `up=noarc`: the arc is forced to the identity (clean captures by lanes that do not own the arc) */
  noarc: boolean;
  /** `up=nocorr`: the corruption tint is forced to the identity (PL-04 reads `RunArc.corruption`) */
  nocorr: boolean;
}

export const NO_SWITCHES: Readonly<ArcSwitches> = Object.freeze({ noarc: false, nocorr: false });

/**
 * The `up=` switches of a page query (`?up=noarc,nocorr`, comma separated, several `up=` pairs add up). Without `qa` (a plain
 * production build) every switch is off whatever the URL says.
 */
export function parseArcSwitches(search: string | null | undefined, qa: boolean): ArcSwitches {
  if (!qa || !search) return NO_SWITCHES;
  let noarc = false;
  let nocorr = false;
  for (const m of search.matchAll(/[?&]up=([^&#]*)/g)) {
    let v = m[1] ?? '';
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep the raw text */
    }
    for (const w of v.split(',')) {
      const word = w.trim().toLowerCase();
      if (word === 'noarc') noarc = true;
      else if (word === 'nocorr') nocorr = true;
    }
  }
  return noarc || nocorr ? { noarc, nocorr } : NO_SWITCHES;
}

/** The switches of the current page: the dev server and the frozen QA snapshot build (VITE_QA_HOOKS=1) only; a plain build folds this to NO_SWITCHES. */
export function pageArcSwitches(): ArcSwitches {
  if (!(import.meta.env.DEV || import.meta.env.VITE_QA_HOOKS === '1')) return NO_SWITCHES;
  return parseArcSwitches(typeof location !== 'undefined' ? location.search : '', true);
}

// ---- evaluation ----------------------------------------------------------------------------------------------------------------------

export interface ArcOptions {
  /** the arc of a zone with no `look.arc` (default DEFAULT_ARC; tests inject others) */
  defaultArc?: readonly ArcStep[];
  switches?: Readonly<ArcSwitches>;
}

/** The keys a zone's arc runs on: its own `look.arc`, else the default arc resolved against the zone's preset; none when `noarc`. */
export function arcKeys(look: ZoneLook, base: ArcState, opts: ArcOptions = {}): ArcKey[] {
  if (opts.switches?.noarc) return [];
  const own = arcKeysOf(look);
  return own.length > 0 ? own : stepsToKeys(opts.defaultArc ?? DEFAULT_ARC, base);
}

/** `evaluate`'s input from a sim / mirror World: the clock the HUD timer shows and the corruption the HUD gauge shows */
export interface ArcClock {
  /** run clock in seconds (host: `world.time`; guest: the mirrored `world.time`) */
  time: number;
  /** world corruption 0..1 */
  corruption: number;
}

/**
 * Per-zone arc evaluator with change detection: owns the compiled keyframes, the current state and the last state the renderer
 * applied. `update` is cheap (a compare when nothing moved) and allocation free.
 */
export class RunArc {
  /** the zone's own values at t = 0 */
  readonly base: ArcState;
  /** the state of the last `update` */
  readonly state: ArcState;
  /** the (smoothed) corruption the last `update` applied, 0..1, 0 under `up=nocorr` (PL-04: the tint is blended with it) */
  corruption = 0;
  /** run clock of the last `update` */
  time = 0;
  /** the relief pulse level (0..1) the last `update` applied: 0 outside the ~1.75 s of run time after a metin broke (it waits while the run clock stands still) */
  relief = 0;
  /** the grade of the last true-returning `update` differs from the one applied before it */
  gradeDirty = false;
  /**
   * the composite pass exists (medium / high): the renderer sets it before each `update` (the pass can come and go with the quality
   * tier). False (low) gives the channels low does draw a stronger share (`CORRUPTION_MOOD_LOW`); a change re-evaluates the state.
   */
  composite = true;

  private frames: ArcFrame[] = [];
  private compiledFor: ZoneLook['arc'] | null = null;
  private readonly applied: ArcState;
  private seen = false;
  /** the corruption has been fed at least once: the next ones are followed, the first one is taken as is (a guest that joins late) */
  private primed = false;
  private tint: CorruptionTint;
  private tintFor: ZoneLook['corruption'];
  private compositeSeen = true;
  /** the corruption `update` was fed last time (clamped), for the drop that starts a relief pulse; null until the first call */
  private lastTarget: number | null = null;
  /** run-clock seconds since the last break, and the pulse's amplitude (0..1); Infinity = no pulse */
  private healAge = Infinity;
  private healAmp = 0;
  /** the leaky sum of the recent falls of the fed corruption, and the seconds left of the cooldown after a trigger */
  private dropAcc = 0;
  private healCool = 0;

  constructor(
    private readonly look: ZoneLook,
    biome: ArcBiome,
    private readonly opts: ArcOptions = {},
  ) {
    this.base = arcBase(look, biome);
    this.state = cloneState(this.base);
    this.applied = cloneState(this.base);
    this.tintFor = look.corruption;
    this.tint = corruptionTintOf(look, this.base.sun.color, this.base.sun.intensity);
    this.recompile();
  }

  /** true when the zone's arc ends up as the identity (no keys, or every key names nothing) */
  get identity(): boolean {
    return this.frames.every((f) => sameState(f, this.base));
  }

  /** compiles `look.arc` (or the default arc) again; `update` does this by itself when the look's arc array is replaced (dev evals) */
  recompile(): void {
    this.compiledFor = this.look.arc;
    this.frames = compileKeys(arcKeys(this.look, this.base, this.opts), this.base);
    this.seen = false;
  }

  /**
   * Evaluates the arc at run clock `time` (s) with world `corruption`. Returns true when the result differs from what the previous
   * true-returning call left (the renderer applies `state` then); an identity arc at corruption 0 never returns true. A non-finite
   * input counts as 0.
   *
   * `dt` (s, the frame time) makes the corruption FOLLOW its input: it settles (95 %) CORRUPTION_SETTLE_S after the input moved, so
   * a metin that breaks or a swarm that awakens eases the land instead of jumping it. Without a finite non-negative `dt` (tests,
   * `evaluate`, the first call, a guest that just joined) the input is taken as it is. `dt` 0 (a paused frame) holds the value.
   *
   * `dt` also times the DETECTION of the relief pulse (`HEAL`): the input falling by >= HEAL.minDrop within HEAL.windowS (a break, on
   * the host as a step, on a guest as the mirror's ramp; never the natural decay, never a rise, never a jump of the run clock longer
   * than HEAL.maxJump, never the first call) starts it, scaled by how sick the land was. The pulse AGES by the run clock `time`
   * moves between two calls, not by `dt`: while an offer or the pause menu holds the run (the clock stands still) it waits at its
   * start, it plays when the clock moves again (see `HEAL`).
   */
  update(time: number, corruption: number, dt?: number): boolean {
    if (this.look.arc !== this.compiledFor) this.recompile();
    if (this.look.corruption !== this.tintFor) this.retint();
    if (this.composite !== this.compositeSeen) {
      this.compositeSeen = this.composite;
      this.seen = false;
    }
    const t = Math.max(0, fin(time, 0));
    const target = this.opts.switches?.nocorr ? 0 : clamp01(fin(corruption, 0));
    const timed = typeof dt === 'number' && Number.isFinite(dt) && dt >= 0;
    let c = target;
    if (this.primed && timed) {
      // the pulse first (it reads the smoothed corruption the land had BEFORE this frame), then the follow
      const run = t - this.time; // the run clock's move since the last call: 0 while an offer / the pause menu holds the sim
      if (!(run >= 0 && run <= HEAL.maxJump)) {
        // the run clock jumped (a resync, a restart): never a break, and the pulse does not skip ahead
        this.dropAcc = 0;
      } else {
        if (this.healAge !== Infinity) this.healAge += run;
        this.healCool = Math.max(0, this.healCool - dt);
        this.dropAcc *= Math.exp(-dt / HEAL.windowS);
        if (this.lastTarget !== null && this.healCool === 0) this.dropAcc += Math.max(0, this.lastTarget - target);
        if (this.dropAcc >= HEAL.minDrop) {
          this.dropAcc = 0;
          this.healCool = HEAL.cooldownS;
          const amp = healSickness(this.corruption);
          if (amp > 0) {
            // a pulse that is still running is never lowered by a second break: it restarts from the level it has
            const now = healEnvelope(this.healAge) * this.healAmp;
            this.healAmp = Math.max(amp, now);
            this.healAge = now > 0 ? HEAL.attackS : 0;
          }
        }
      }
      c = this.corruption + (target - this.corruption) * (1 - Math.exp(-dt / CORRUPTION_TAU));
      if (Math.abs(target - c) < CORRUPTION_EPS) c = target;
    }
    this.primed = true;
    this.lastTarget = target;
    const e = this.healAge === Infinity ? 0 : healEnvelope(this.healAge) * this.healAmp;
    if (e === 0 && this.healAge !== Infinity && this.healAge >= HEAL.attackS + HEAL.decayS) {
      this.healAge = Infinity;
      this.healAmp = 0;
    }
    if (this.seen && t === this.time && c === this.corruption && e === this.relief) return false;
    this.seen = true;
    this.time = t;
    this.corruption = c;
    this.relief = e;
    sampleFrames(this.frames, this.base, t, this.state);
    applyCorruption(this.state, Math.max(0, c - reliefLift(e, this.tint.warmth)), this.tint, this.composite);
    applyRelief(this.state, e, this.composite, this.tint.warmth);
    if (sameState(this.state, this.applied)) return false;
    this.gradeDirty = !sameGrade(this.state.grade, this.applied.grade);
    copyState(this.applied, this.state);
    return true;
  }

  /** the zone's `look.corruption` was replaced (a dev eval): read it again; the next `update` re-evaluates */
  private retint(): void {
    this.tintFor = this.look.corruption;
    this.tint = corruptionTintOf(this.look, this.base.sun.color, this.base.sun.intensity);
    this.seen = false;
  }
}

/**
 * The arc state of a zone at run clock `t` with world `corruption`, as a pure function (tests, tools). The renderer uses `RunArc`.
 * `biome` is the render biome the zone was built with.
 */
export function evaluate(look: ZoneLook, t: number, corruption: number, biome: ArcBiome, opts: ArcOptions = {}): ArcState {
  const arc = new RunArc(look, biome, opts);
  arc.update(t, corruption);
  return arc.state;
}

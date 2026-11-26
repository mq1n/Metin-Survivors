// Metin stones: falling meteor → landing (`drop` clip) → alive (`idle`) → awakened (`pulse`) → breaking (`shatter`).
// Driven entirely by the sim's MetinFeed (phase + phaseT); each live metin owns a small mixer (≤ a handful at once).
import { AdditiveBlending, AnimationMixer, CanvasTexture, Color, Group, MathUtils, type Object3D, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, type AnimationAction, type Material, type MeshStandardMaterial, type Texture, type WebGLRenderer, type Bone, type WebGLProgramParametersWithUniforms } from 'three';
import type { ModelInstance } from '../engine/assets';
import { SURFACE } from '../world/layoutTypes';
import type { RenderCore, RenderSystem } from './core';
import type { MetinFeed, MetinTypeDef, MetinView } from './feed';
import type { BlobShadows } from './crowd/blobShadows';
import { MetinSinkCue, SINK_CUES_PER_BREAK, SINK_LAVA, SINK_WATER } from './metinSinkCue';
import { REST9_PUSH_SPEED, applyPieceRest9, metinPieceRadiiCached, type PieceRest9 } from './metinRest9';
import { MetinGroundGlow, heatTexture, metinBreakHeat, ringTexture } from './metinGroundGlow';

const FALL_HEIGHT = 75;
const DROP_DUR_FALLBACK = 0.9;

/** soft round light with NO white centre (the old gradient had a hot white core that read as a flat blob with a halo round the stone) */
function glowTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.34)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** the stone's glow while it falls and in the first second after the crash: white-hot at first, then the orange of a hot rock */
const HOT = new Color(1.0, 0.34, 0.07);
/** r9 M9b: scratch colour of the break's ground glow */
const heatTmp = new Color();
/** r10 M10b: what a cold stone's break flash (extras.breakCold) whitens its rune light toward, on the pieces and on the ground ring (never orange) */
const COLD_WHITE = new Color(0.86, 0.95, 1.0);

/**
 * Damage ramp of a stone that carries its own emissive mask (E3): the dim hairline cracks of the mask come up as the stone weakens.
 * 1 at full health, 1.9 at 0 hp. Applied to the alive and awakened emissive intensity only.
 */
/** M4: albedo tint of a stone that carries its own emissive mask (glyph: false): white lerped RUNE_TINT toward the rune colour at full value (multiplies the albedo) */
export const RUNE_TINT = 0.3;
export function runeTint(runeIn: Parameters<Color['set']>[0]): Color {
  const rune = new Color(runeIn);
  const mx = Math.max(rune.r, rune.g, rune.b, 1e-3);
  return new Color(1, 1, 1).lerp(new Color(rune.r / mx, rune.g / mx, rune.b / mx), RUNE_TINT);
}

/**
 * r5: body colour of a stone whose extras carry `bodyTint` (the shared small metin, 13 types): the albedo is MULTIPLIED by this colour. The type's rune colour
 * (max channel 1) gets a chroma floor of 0.6, so pale runes (#b8f0c8, #8aa07a, #8a8ab0) still read as their hue; its luminance is fixed (1, pale runes 1.12),
 * so blue / violet types do not darken the stone and pale types read lighter; no channel exceeds 2.2. `strength` lerps it from white.
 */
export function metinBodyTint(runeIn: Parameters<Color['set']>[0], strength: number): Color {
  const c = new Color(runeIn);
  const mx = Math.max(c.r, c.g, c.b, 1e-3);
  let r = c.r / mx, g = c.g / mx, b = c.b / mx;
  const lum = (x: number, y: number, z: number): number => 0.2126 * x + 0.7152 * y + 0.0722 * z;
  const chroma = 1 - Math.min(r, g, b);
  if (chroma > 0.04) {
    const k = Math.min(4, Math.max(1, 0.6 / chroma)), l0 = lum(r, g, b);
    r = Math.max(0, l0 + (r - l0) * k); g = Math.max(0, l0 + (g - l0) * k); b = Math.max(0, l0 + (b - l0) * k);
  }
  const pale = chroma < 0.5 ? 1.12 : 1;
  const norm = (target: number): void => { const l = lum(r, g, b) || 1; r *= target / l; g *= target / l; b *= target / l; };
  norm(pale);
  const s = MathUtils.clamp(strength, 0, 1);
  r = 1 + (r - 1) * s; g = 1 + (g - 1) * s; b = 1 + (b - 1) * s;
  r = Math.min(r, 2.2); g = Math.min(g, 2.2); b = Math.min(b, 2.2);
  return new Color(r, g, b);
}

/**
 * r7: the BODY colour of each of the 13 small metin types (sRGB target of the body's MEAN colour, keyed by the type's rune colour). Applied by a model whose extras
 * carry `bodyPalette` (its albedo's linear mean luminance) as a luminance-preserving hue shift in the fragment shader (metinShiftTexel / TYPE_SHIFT_GLSL): every
 * texel keeps its own luminance (x one value factor per type), takes the type's hue at a capped saturation, and never passes METIN_TYPE_ALBEDO_CAP. Designed so
 * any two types differ by CIEDE2000 >= 12 on the built stone's albedo (the four reds and the two violets included, L* 25 .. 70: no coal lump, no snowball);
 * the stone's rune halo is softened (METIN_PALETTE_HALO) so the body, not the additive rune light, carries the type at the game camera.
 */
export const METIN_TYPE_BODY: Readonly<Record<string, string>> = {
  '#5a8cff': '#6080c8', // sorrow: slate blue
  '#ff6a3a': '#d89a50', // combat: amber
  '#e84a4a': '#e08070', // battle: salmon-red granite
  '#ffcf4a': '#c8b450', // greed: ochre gold
  '#9a7aff': '#b0a0d8', // black: lavender
  '#6a4ac8': '#483494', // darkness: deep indigo
  '#3cd08a': '#2e9070', // jealousy: jade
  '#7ae0ff': '#4a9eac', // soul: teal
  '#8a8ab0': '#545464', // shadow: dark slate
  '#8aa07a': '#6a7062', // toughness: grey-green stone
  '#ff3a5a': '#b052a8', // devil: magenta-violet
  '#b8f0c8': '#b8c6b2', // death: pale bone
  '#ff3a1a': '#7a3040', // murder: dried-blood wine
};
/** r7: alive / awakened halo opacity factor of a `bodyPalette` stone: the additive rune sprite washed every body in its rune colour (battle and murder, both red
 *  runes, measured CIEDE2000 4 apart at z22 under it); the veins and the ground circle keep the rune colour */
export const METIN_PALETTE_HALO = 0.4;
/** r7: saturation cap ((max - min) / max) of a type's unit-luminance chroma: no single-hue plastic, every channel keeps >= 28 % */
export const METIN_TYPE_SAT_CAP = 0.72;
/** r7: no shifted albedo channel passes this (linear): a brighter texel is desaturated toward its own grey, a grey above it is clamped */
export const METIN_TYPE_ALBEDO_CAP = 0.9;
/** r7: the per-type value factor (target luminance / the albedo's mean luminance) stays inside this range */
export const METIN_TYPE_VAL: readonly [number, number] = [0.32, 2.8];

export interface MetinTypeShift {
  /** the type's chroma at unit luminance (linear), saturation-capped */
  chroma: [number, number, number];
  /** luminance factor of the type (target / the albedo's mean, clamped to METIN_TYPE_VAL) */
  val: number;
}

const lumOf = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** r7: the hue shift of a `bodyPalette` stone for its rune (`ref` = the albedo's linear mean luminance); null = no palette entry or a bad ref.
 *  r8 M8a: `palette` (the model's extras.typeBody) overrides single METIN_TYPE_BODY entries, keyed by the same rune hex */
export function metinTypeShift(runeIn: string, ref: number, palette?: Readonly<Record<string, string>> | null): MetinTypeShift | null {
  const key = new Color(runeIn).getHexString();
  const own = palette?.[`#${key}`];
  const hex = typeof own === 'string' && /^#[0-9a-f]{6}$/i.test(own) ? own : METIN_TYPE_BODY[`#${key}`];
  if (!hex || !(ref > 0) || !Number.isFinite(ref)) return null;
  const t = new Color(hex); // linear working colour
  const l = lumOf(t.r, t.g, t.b);
  let ch: [number, number, number] = [t.r / l, t.g / l, t.b / l];
  const sat = (c: readonly number[]): number => { const mx = Math.max(c[0]!, c[1]!, c[2]!); return mx > 0 ? (mx - Math.min(c[0]!, c[1]!, c[2]!)) / mx : 0; };
  if (sat(ch) > METIN_TYPE_SAT_CAP) {
    // mix toward unit grey until the saturation sits on the cap, then back to unit luminance
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) { const k = (lo + hi) / 2; if (sat(ch.map((x) => 1 + (x - 1) * k)) > METIN_TYPE_SAT_CAP) hi = k; else lo = k; }
    const c2 = ch.map((x) => 1 + (x - 1) * lo), l2 = lumOf(c2[0]!, c2[1]!, c2[2]!);
    ch = [c2[0]! / l2, c2[1]! / l2, c2[2]! / l2];
  }
  return { chroma: ch, val: MathUtils.clamp(l / ref, METIN_TYPE_VAL[0], METIN_TYPE_VAL[1]) };
}

/** r7: one albedo texel (linear) through the type shift: exactly what TYPE_SHIFT_GLSL does on the GPU */
export function metinShiftTexel(rgb: readonly [number, number, number], s: MetinTypeShift): [number, number, number] {
  const L = lumOf(rgb[0], rgb[1], rgb[2]) * s.val, cap = METIN_TYPE_ALBEDO_CAP;
  let c: [number, number, number] = [L * s.chroma[0], L * s.chroma[1], L * s.chroma[2]];
  const mx = Math.max(c[0], c[1], c[2]);
  if (mx > cap) {
    const g = Math.min(L, cap), k = MathUtils.clamp((cap - g) / Math.max(mx - L, 1e-4), 0, 1);
    c = [g + (c[0] - L) * k, g + (c[1] - L) * k, g + (c[2] - L) * k];
  }
  return c;
}

/** r7 ship 10-30: static_metin.ts reserves the bottom quarter of the atlas (glTF v >= 0.75) for the cut faces, chips and core: the type shift
 *  leaves them alone, so a broken small stone shows its own grey mineral interior with hot veins, not a uniform type-dyed heap (r7 M7 critic) */
export const METIN_CUT_FACE_V = 0.749;

const TYPE_SHIFT_GLSL = /* glsl */ `
#ifdef USE_MAP
if (vMapUv.y < ${METIN_CUT_FACE_V.toFixed(3)})
#endif
{
  // r8 M8a: uMetinDetail > 1 widens the texel's luminance about the albedo mean (uMetinRef) before the shift: the neutral types keep a visible body texture
  float mL0 = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float mL = max(uMetinRef + (mL0 - uMetinRef) * uMetinDetail, 0.0) * uMetinVal;
  vec3 mc = mL * uMetinChroma;
  float mx = max(mc.r, max(mc.g, mc.b));
  if (mx > ${METIN_TYPE_ALBEDO_CAP.toFixed(3)}) {
    float g = min(mL, ${METIN_TYPE_ALBEDO_CAP.toFixed(3)});
    float k = clamp((${METIN_TYPE_ALBEDO_CAP.toFixed(3)} - g) / max(mx - mL, 1e-4), 0.0, 1.0);
    mc = vec3(g) + (mc - vec3(mL)) * k;
  }
  diffuseColor.rgb = mc;
}`;

/**
 * r8 M8a: the hot core of a crack. Where the stone's own emissive mask is at its strict core (linear >= 0.55: the r8 build writes the core at 1.0 and the
 * band / halo round it far lower), the emissive leans toward white at the light's own peak (`uMetinCore` of the way): a white-hot line inside the
 * rune-coloured falloff, not a uniform band. uMetinCore 0 = exactly the emissive of before.
 */
/**
 * r9 M9a (r8 judge MF4 (c)): a stone whose extras carry `veinBaked` ships its hot core IN the emissive texture (the default rune's falloff with a white-hot
 * core line, emissiveFactor white), so the raw GLB (boards, previews) shows what the game shows. The game reads such a texel back as its grey mask (the max
 * channel) times the type's rune, and its core from the texel's whiteness (min / max channel) instead of the grey level. uMetinBaked 0 = three's own
 * emissivemap_fragment and the r8 core exactly.
 */
const EMISSIVE_MAP_GLSL = /* glsl */ `
#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
  float mMx = max(emissiveColor.r, max(emissiveColor.g, emissiveColor.b));
  float mMn = min(emissiveColor.r, min(emissiveColor.g, emissiveColor.b));
  totalEmissiveRadiance *= mix(emissiveColor.rgb, vec3(mMx), uMetinBaked);
#endif`;
const VEIN_CORE_GLSL = /* glsl */ `
#ifdef USE_EMISSIVEMAP
{
  float mCoreB = smoothstep(0.3, 0.8, mMn / max(mMx, 1e-4)) * smoothstep(0.12, 0.35, mMx);
  float mCore = mix(smoothstep(0.55, 0.92, emissiveColor.g), mCoreB, uMetinBaked) * uMetinCore;
  float mPeak = max(totalEmissiveRadiance.r, max(totalEmissiveRadiance.g, totalEmissiveRadiance.b));
  totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(mPeak * 0.9), mCore);
}
#endif`;

/** r8 M8a: the type shift's uniforms (userData.metinShift): `base` = the type's chroma before the zone-light white balance, `chroma` = what the shader reads;
 *  r9 M9a: `baked` = 1 for a stone with extras.veinBaked (EMISSIVE_MAP_GLSL) */
interface ShiftUniforms { chroma: Vector3; base: Vector3; val: number; ref: number; detail: number; core: number; wb: number; baked: number }

/** r7: one shared hook (one program for every type: the cache key is its source), the type's uniforms come from the material's userData */
function typeShiftHook(this: Material, shader: WebGLProgramParametersWithUniforms): void {
  const u = (this.userData as { metinShift?: ShiftUniforms }).metinShift;
  shader.uniforms.uMetinChroma = { value: u?.chroma ?? new Vector3(1, 1, 1) };
  shader.uniforms.uMetinVal = { value: u?.val ?? 1 };
  shader.uniforms.uMetinRef = { value: u?.ref ?? 0 };
  shader.uniforms.uMetinDetail = { value: u?.detail ?? 1 };
  shader.uniforms.uMetinCore = { value: u?.core ?? 0 };
  shader.uniforms.uMetinBaked = { value: u?.baked ?? 0 };
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uMetinChroma;\nuniform float uMetinVal;\nuniform float uMetinRef;\nuniform float uMetinDetail;\nuniform float uMetinCore;\nuniform float uMetinBaked;')
    .replace('#include <color_fragment>', `#include <color_fragment>\n${TYPE_SHIFT_GLSL}`)
    .replace('#include <emissivemap_fragment>', `${EMISSIVE_MAP_GLSL}\n${VEIN_CORE_GLSL}`);
}

/** r8 M8a: saturation ((max - min) / max) of a METIN_TYPE_BODY colour below which a type counts as neutral (toughness, death, shadow) */
export const METIN_NEUTRAL_SAT = 0.3;
/**
 * r8 M8a: the luminance contrast factor of a type (TYPE_SHIFT_GLSL uMetinDetail): 1 + `k` x how neutral the type's body colour is (1 at grey, 0 at
 * METIN_NEUTRAL_SAT and above). A grey-green / bone / slate stone reads as a scenery boulder unless its own texture carries it (r7 judge MF3).
 */
export function metinTypeDetail(runeIn: string, k: number, palette?: Readonly<Record<string, string>> | null): number {
  const key = `#${new Color(runeIn).getHexString()}`, own = palette?.[key];
  const hex = typeof own === 'string' && /^#[0-9a-f]{6}$/i.test(own) ? own : METIN_TYPE_BODY[key];
  if (!hex || !(k > 0)) return 1;
  // the saturation of the authored sRGB colour (what the palette reads as), not of its linear value
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), mx = Math.max(c[0]!, c[1]!, c[2]!, 1e-4), sat = (mx - Math.min(c[0]!, c[1]!, c[2]!)) / mx;
  return 1 + k * MathUtils.clamp(1 - sat / METIN_NEUTRAL_SAT, 0, 1);
}

/**
 * r8 M8a: the white balance of a type's chroma under the zone's light (r7 judge MF3: "warm types go olive under the Seori grade"). `light` = the linear
 * colour of the light on the stone; the chroma is divided by the light's tint (its colour at unit luminance) `k` of the way, then set back to unit
 * luminance, so the LIT body keeps the type's hue. k 0 = the chroma unchanged.
 */
export function metinWhiteBalance(chroma: readonly [number, number, number], light: readonly [number, number, number], k: number, maxHue = METIN_WB_MAX_HUE): [number, number, number] {
  const ll = lumOf(light[0], light[1], light[2]);
  if (!(k > 0) || !(ll > 1e-4)) return [chroma[0], chroma[1], chroma[2]];
  const c = [0, 1, 2].map((i) => chroma[i]! * (1 + k * (ll / Math.max(light[i]!, 1e-3) - 1)));
  // r9 M9a (r8 judge MF4 (e)): the balanced colour may move the authored hue by at most `maxHue` degrees, and it keeps the authored saturation (the r8
  // balance turned the suryeon devil violet and the warm types muddy); hue / saturation are read in sRGB like the palette is authored
  const a = srgbHsv(chroma), b = srgbHsv(c as [number, number, number]);
  const dh = MathUtils.clamp(((b[0] - a[0] + 540) % 360) - 180, -maxHue, maxHue);
  const o = linFromHsv((a[0] + dh + 360) % 360, a[1]);
  const l = lumOf(o[0], o[1], o[2]) || 1;
  return [o[0] / l, o[1] / l, o[2] / l];
}
/** r9 M9a: the largest hue move (degrees) of metinWhiteBalance (r8 judge MF4: "white balance clamped to 10-15 degrees") */
export const METIN_WB_MAX_HUE = 12;
const s2l = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const l2s = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
/** r9 M9a: [hue deg, saturation (max - min) / max] of a linear colour (any scale), measured on its sRGB encoding at unit max */
function srgbHsv(c: readonly [number, number, number]): [number, number] {
  const m = Math.max(c[0], c[1], c[2], 1e-6), [r, g, b] = [l2s(Math.max(0, c[0] / m)), l2s(Math.max(0, c[1] / m)), l2s(Math.max(0, c[2] / m))];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? (60 * ((g - b) / d) + 360) % 360 : mx === g ? 60 * ((b - r) / d) + 120 : 60 * ((r - g) / d) + 240;
  return [h, mx > 0 ? d / mx : 0];
}
/** r9 M9a: the linear colour (value 1 in sRGB) of an sRGB hue / saturation */
function linFromHsv(h: number, s: number): [number, number, number] {
  const f = (n: number): number => { const k = (n + h / 60) % 6; return 1 - s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [s2l(f(5)), s2l(f(3)), s2l(f(1))];
}

/** r7: installs the type shift on a (cloned) stone material; r8 M8a: `opts` = the albedo mean (`ref`), the neutral-type detail, the vein core, the white balance;
 *  r9 M9a: `baked` = the stone's emissive texture carries its own hot core (extras.veinBaked) */
export function applyTypeShift(mat: MeshStandardMaterial, s: MetinTypeShift, opts?: { ref?: number; detail?: number; core?: number; wb?: number; baked?: boolean }): void {
  const ch = new Vector3(s.chroma[0], s.chroma[1], s.chroma[2]);
  const u: ShiftUniforms = { chroma: ch, base: ch.clone(), val: s.val, ref: opts?.ref ?? 0, detail: opts?.detail ?? 1, core: opts?.core ?? 0, wb: opts?.wb ?? 0, baked: opts?.baked ? 1 : 0 };
  mat.userData.metinShift = u;
  mat.onBeforeCompile = typeShiftHook;
}

/**
 * r7: where a break piece may rest (RenderCore.restAt): REST_GROUND = on the ground under it, REST_SINK = it goes UNDER the surface (lava, deep water: never parked
 * on a liquid as if on a floor), REST_BLOCKED = inside a static's body (a prop / wall / rock blocker): it sinks out of sight instead of resting inside the prop.
 */
export const REST_GROUND = 0;
export const REST_SINK = 1;
export const REST_BLOCKED = 2;
export interface MetinRestField {
  surfaceAt(x: number, z: number): number;
  blockersNear(x: number, z: number, r: number, cb: (b: { x: number; z: number; r: number; kind?: string }) => void): void;
}
/** r8 M8a: world/terrainField.ts registers a rock blocker at 0.82 x the rock's half side (the hero may brush the drawn rock); a break piece meets the real rock */
export const METIN_ROCK_BLOCK_SHRINK = 0.82;
/** r8 M8a: the body radius of a blocker circle: a rock's real half side, every other kind (prop footprint, trunk, wall disc) as registered */
export function metinBodyR(b: { r: number; kind?: string }): number {
  return b.kind === 'rock' ? b.r / METIN_ROCK_BLOCK_SHRINK : b.r;
}
/** r8 M8a: share of a piece's radius that may overlap a static's body before the piece counts as inside it (a piece pushed against a prop touches it) */
export const REST_FOOT_OVERLAP = 0.5;
/**
 * r7: the rest kind at (x, z) of a zone's field (wired into RenderCore.restAt by the run). r8 M8a (r7 judge MF5): a piece of radius `r` is tested with its
 * FOOTPRINT against the REAL body circles (metinBodyR: rocks unshrunk), not its centre against the 0.82 collision circle; r 0 = the centre test.
 */
export function metinRestKind(f: MetinRestField, x: number, z: number, r = 0): number {
  const s = f.surfaceAt(x, z);
  if (s === SURFACE.LAVA || s === SURFACE.DEEP) return REST_SINK;
  let inside = false;
  const reach = REST_FOOT_OVERLAP * Math.max(0, r);
  // the query disc grows by the rock shrink slack (a rock's collision circle is 18 % smaller than its body)
  f.blockersNear(x, z, reach + 0.05 + 1.5, (b) => { if (!inside && Math.hypot(x - b.x, z - b.z) < metinBodyR(b) + reach) inside = true; });
  return inside ? REST_BLOCKED : REST_GROUND;
}

/** r8 M8a: a static body a break piece meets: a disc (x, z, r) standing from the ground up to the world height `top` */
export interface MetinBody {
  x: number; z: number; r: number; top: number;
  /** r9 M9b: the world height the disc starts at (a prop's column / roof band; absent = from the ground) */
  y0?: number;
  /** r9 M9b: a ledge (low rock, crate): a rest9 piece settles on its top instead of being pushed out */
  low?: boolean;
}
/**
 * r8 M8a: what the run tells the break pieces about the zone (MetinViews.restWorld, set by app/run.ts): the static bodies (props up to their height, blocking
 * rocks with their real half side, tree trunks, walls), and the liquid under a point (SINK_LAVA / SINK_WATER / 0) with its surface height.
 */
export interface MetinRestWorld {
  bodiesNear(x: number, z: number, r: number, cb: (b: MetinBody) => void): void;
  liquidAt(x: number, z: number): number;
  liquidY(x: number, z: number): number;
  /** r9 M9b: the rest9 bodies (stacked prop discs, ledges, bridge rails: render/metinBodies.ts metinBodies9); absent = bodiesNear */
  bodiesNear9?(x: number, z: number, r: number, cb: (b: MetinBody) => void): void;
}
/** r8 M8a: a spatial hash over static bodies (cell `cell` m): `near` calls back every body whose disc may touch the disc (x, z, r), each once */
export function metinBodyIndex(list: readonly MetinBody[], cell = 4): (x: number, z: number, r: number, cb: (b: MetinBody) => void) => void {
  const grid = new Map<number, MetinBody[]>();
  const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);
  let maxR = 0;
  for (const b of list) {
    maxR = Math.max(maxR, b.r);
    const k = key(Math.floor(b.x / cell), Math.floor(b.z / cell));
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(b);
  }
  return (x, z, r, cb) => {
    const reach = r + maxR;
    const i0 = Math.floor((x - reach) / cell), i1 = Math.floor((x + reach) / cell), j0 = Math.floor((z - reach) / cell), j1 = Math.floor((z + reach) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = grid.get(key(i, j));
      if (!a) continue;
      for (const b of a) if (Math.hypot(x - b.x, z - b.z) < r + b.r) cb(b);
    }
  };
}
/**
 * r8 M8a (r7 judge MF5: "in-flight pieces ignore props"): pushes a piece (world centre x, z, bottom y `yb`, radius r) out of every static body it overlaps below
 * the body's top, onto the body's rim (two relaxation passes, like the field's moveCircle); a piece above a body's top flies over it. A piece dead on a body's
 * centre leaves away from (ox, oz) (the stone). Writes the pushed point to `out`; returns true when it moved.
 */
export function metinPushOut(bodiesNear: MetinRestWorld['bodiesNear'], x: number, z: number, yb: number, r: number, ox: number, oz: number, out: { x: number; z: number }): boolean {
  let px = x, pz = z, any = false;
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    bodiesNear(px, pz, r, (b) => {
      if (yb >= b.top) return;
      const dx = px - b.x, dz = pz - b.z, rr = b.r + r, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) return;
      const d = Math.sqrt(d2);
      if (d > 1e-5) { px = b.x + (dx / d) * rr; pz = b.z + (dz / d) * rr; }
      else { const ux = b.x - ox, uz = b.z - oz, ul = Math.hypot(ux, uz) || 1; px = b.x + (ux / ul) * rr; pz = b.z + (uz / ul) * rr; }
      moved = true;
    });
    if (!moved) break;
    any = true;
  }
  out.x = px; out.z = pz;
  return any;
}
/** r8 M8a: a piece's sink weight (sinkK x its eased sink) past which it counts as going under: its liquid cue fires (once per piece and break) */
export const SINK_CUE_AT = 0.04;
/** r8 M8a: the optional part of applyPieceRest: the push out of static bodies and the sink cue */
export interface PieceRestExt {
  /** 2 floats per bone: the xz push (root space) last added; clearPieceRest takes it off with the y offset */
  offXZ: Float32Array;
  bodiesNear: MetinRestWorld['bodiesNear'];
  /** world y of the stone's base (a piece's world y = rootY + bone y x scale) */
  rootY: number;
  /** a piece's radius in root units (x scale = metres) */
  pieceR: number;
  /** once per piece and break, when its sink weight passes SINK_CUE_AT, with the piece's world (x, z); `cued` (1 per bone) remembers who fired */
  onSink?: (i: number, wx: number, wz: number) => void;
  cued?: Uint8Array;
}
/** r7: how far below the surface a sinking piece goes (x the stone's scale): out of sight for the biggest chunk */
export const REST_SINK_DEPTH = 2.4;
/** r7 ship 10-30: seconds of shatter time for a piece's sink weight to go 0 -> 1 (or back) when its rest kind flips mid-flight (no one-frame pop) */
export const METIN_SINK_EASE = 0.25;
/** r9 ship (M9b critic MUST): m round the local hero that a rest9 break piece is pushed out of while it settles (a body 2.2 m tall: no chunk over him) */
export const METIN_HERO_CLEAR_R = 0.9;
/**
 * r7: the world y offset that rests a piece at (wx, wz) of radius r on what is under it, from the stone's base height `groundY`: the terrain under the centre and at
 * 4 points of radius r (the mean lifted a quarter of the way to the highest: no half-buried piece on a slope, none floating over a dip), clamped -12 .. +6 m.
 * `sink` = the piece must go under the surface (REST_SINK / REST_BLOCKED).
 */
export function metinPieceRest(heightAt: (x: number, z: number) => number, restAt: (x: number, z: number, r?: number) => number, wx: number, wz: number, r: number, groundY: number): { dy: number; sink: boolean } {
  const hs = [heightAt(wx, wz), heightAt(wx + r, wz), heightAt(wx - r, wz), heightAt(wx, wz + r), heightAt(wx, wz - r)].filter((h) => Number.isFinite(h));
  if (!hs.length) return { dy: 0, sink: false };
  const mean = hs.reduce((a, b) => a + b, 0) / hs.length, hi = Math.max(...hs);
  const dy = MathUtils.clamp(mean + 0.25 * (hi - mean) - groundY, -12, 6);
  // r8 M8a: the piece's radius goes with the point (metinRestKind tests its footprint)
  const k = restAt(wx, wz, r);
  return { dy, sink: k === REST_SINK || k === REST_BLOCKED };
}
const pushTmp = { x: 0, z: 0 };
/**
 * r7: adds each piece bone's rest offset (root space; `off` keeps it so clearPieceRest can take it off before the mixer writes the clip pose again: three's
 * PropertyMixer skips a bone whose clip value did not change, so an offset left on would accumulate). `w` blends the follow in, `sinkK` (0..1) the sink.
 * r8 M8a: with `ext` every piece is first pushed out of the static bodies it overlaps below their top (in flight and at rest: it slides round a lantern and
 * lands beside it, never inside), the rest is taken at the pushed point, and a piece that starts going under a liquid fires `ext.onSink` once.
 */
export function applyPieceRest(bones: readonly Bone[], off: Float32Array, rootX: number, rootZ: number, yaw: number, scale: number, groundY: number, w: number, sinkK: number,
  heightAt: (x: number, z: number) => number, restAt: (x: number, z: number, r?: number) => number, sinkW?: Float32Array, step = Infinity, ext?: PieceRestExt): void {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  bones.forEach((b, i) => {
    const lx = b.position.x * scale, lz = b.position.z * scale;
    let wx = rootX + lx * cy + lz * sy, wz = rootZ - lx * sy + lz * cy;
    if (ext) {
      const pr = ext.pieceR * scale;
      let dx = 0, dz = 0;
      if (metinPushOut(ext.bodiesNear, wx, wz, ext.rootY + b.position.y * scale - pr, pr, rootX, rootZ, pushTmp)) {
        const ddx = pushTmp.x - wx, ddz = pushTmp.z - wz;
        // world -> root space (the inverse of the rotation above), / scale
        dx = (ddx * cy - ddz * sy) / scale; dz = (ddx * sy + ddz * cy) / scale;
        wx = pushTmp.x; wz = pushTmp.z;
      }
      b.position.x += dx; b.position.z += dz;
      ext.offXZ[i * 2] = dx; ext.offXZ[i * 2 + 1] = dz;
    }
    const r = metinPieceRest(heightAt, restAt, wx, wz, 0.3 * scale, groundY);
    // r7 ship 10-30: with `sinkW` each piece's sink weight moves toward its target (1 = under the surface) by at most `step` per call, so a piece still
    // flying across a lava / water edge or a blocker boundary eases in or out instead of jumping by REST_SINK_DEPTH x scale in one frame (r7 M7 critic)
    let s = r.sink ? 1 : 0;
    if (sinkW) { const p = sinkW[i] ?? 0; s = p + MathUtils.clamp(s - p, -step, step); sinkW[i] = s; }
    if (ext?.onSink && ext.cued && !ext.cued[i] && r.sink && sinkK * s > SINK_CUE_AT) { ext.cued[i] = 1; ext.onSink(i, wx, wz); }
    const o = (r.dy * w - REST_SINK_DEPTH * scale * sinkK * s) / scale;
    b.position.y += o;
    off[i] = o;
  });
}
/** r7: takes the offsets applyPieceRest added off the bones again; r8 M8a: and the xz push (`offXZ`, 2 per bone) */
export function clearPieceRest(bones: readonly Bone[], off: Float32Array, offXZ?: Float32Array): void {
  bones.forEach((b, i) => {
    b.position.y -= off[i]!;
    off[i] = 0;
    if (offXZ) {
      b.position.x -= offXZ[i * 2]!;
      b.position.z -= offXZ[i * 2 + 1]!;
      offXZ[i * 2] = offXZ[i * 2 + 1] = 0;
    }
  });
}

/** r5: soft ceiling of a stone's emissive intensity (extras.emissiveCap [knee, cap]): unchanged up to the knee, then eased toward the cap (never above it) */
export function metinEmissiveCap(e: number, knee: number, cap: number): number {
  if (e <= knee || cap <= knee) return Math.min(e, Math.max(knee, cap));
  return knee + (cap - knee) * (1 - Math.exp(-(e - knee) / (cap - knee)));
}

/** r5 ship: share of the damage ramp that rides on top of a CAPPED base glow (the rest goes to the glow sprite, METIN_CAP_GLOW_SHARE) */
export const METIN_CAP_RAMP_SHARE = 0.35;
/** r5 ship: share of the damage ramp a capped stone carries on its glow sprite size instead */
export const METIN_CAP_GLOW_SHARE = 0.4;

/**
 * r5 ship: emissive intensity of a stone with extras.emissiveCap. The soft cap eases only the BASE glow (idle swell / awakened heartbeat) toward
 * its ceiling; the damage ramp then rides on top (METIN_CAP_RAMP_SHARE of it), so the heartbeat and the low-HP "about to break" cue survive the cap
 * while the full-HP glow keeps its hue under the ceiling (the r5 critic: capping base x ramp flattened the beat from 2.47 to 0.19 at low HP).
 */
export function metinCappedEmissive(base: number, ramp: number, knee: number, cap: number): number {
  return metinEmissiveCap(base, knee, cap) * (1 + (ramp - 1) * METIN_CAP_RAMP_SHARE);
}

/** r5 ship: extras.emissiveCap -> [knee, cap], or null when it is not two finite numbers with 0 < knee < cap (a malformed array means no cap, never NaN) */
export function parseEmissiveCap(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const knee = Number(v[0]), cap = Number(v[1]);
  return Number.isFinite(knee) && Number.isFinite(cap) && knee > 0 && cap > knee ? [knee, cap] : null;
}

export function metinDamageRamp(hpFrac: number): number {
  return 1 + 0.9 * (1 - MathUtils.clamp(hpFrac, 0, 1));
}

/** seconds the `hit` clip of a stone with its own mask plays after an HP drop */
const HIT_DUR_FALLBACK = 0.35;

/** A metin type plus the run's load policy (app/simFeed.buildCatalog). Plain `MetinTypeDef`s load everything. */
export interface MetinLoadDef extends MetinTypeDef {
  /**
   * 'now' (default): model + rune glyph load with the run. 'stream': needed later (the zone's stones from `metins.firstAt`,
   * its great metin at the final wave): model + glyph are fetched in the background ahead of `at` instead of in the blocking
   * zone load, and their programs are compiled ahead too. 'skip': cannot appear in this run (other zones' metins); fetched
   * only if one shows up anyway. A type that is needed before it arrived is fetched on demand and appears once it is in.
   */
  load?: 'now' | 'stream' | 'skip';
  /** run seconds from which it can appear ('stream': fetched STREAM_LEAD s ahead; a run that ends earlier never fetches it) */
  at?: number;
}

/** seconds before a failed on-demand model fetch is tried again */
const RETRY_AFTER = 5;
/** a streamed type is fetched this many seconds of run rendering before it can appear (rendering runs ahead of the sim
 *  clock: modals pause the sim, not the renderer) ... */
const STREAM_LEAD = 120;
/** ... and never earlier than this many seconds into the run: outside the payload gate's window (Start → HUD + 6 s, ARCHITECTURE
 *  §11, with a margin for a slow machine that notices the HUD late), after the zone music (10 s) and the creature stream
 *  have started. The first stones fall from `metins.firstAt` (60 s), so the margin costs nothing. */
const STREAM_DELAY = 12;

/**
 * Identity of the shader programs a material has compiled so far (three's program cache keys). Two materials with the same
 * identity share every program, so keeping one of them alive keeps all of them alive. '' = nothing compiled yet.
 */
function programSignature(renderer: WebGLRenderer, mat: Material): string {
  const props = (renderer as { properties?: { get?(o: object): unknown } }).properties?.get?.(mat) as
    | { programs?: Map<string, unknown>; currentProgram?: { cacheKey?: string } }
    | undefined;
  if (props?.programs && props.programs.size > 0) return [...props.programs.keys()].sort().join('|');
  return props?.currentProgram?.cacheKey ?? '';
}

interface Slot {
  id: number;
  type: number;
  /** MetinTypeDef.key of the type */
  key: string;
  root: Group;
  inst: ModelInstance;
  mixer: AnimationMixer;
  actions: Map<string, AnimationAction>;
  current: AnimationAction | null;
  mats: MeshStandardMaterial[];
  /** the type's rune colour (emissive / glow colour once the stone has cooled) */
  rune: Color;
  glow: Sprite;
  trail: Sprite;
  maxWarn: number;
  seen: boolean;
  lastPhase: number;
  breakFlash: number;
  /** model carries its own emissive mask (extras.glyph === false): damage ramp + hit clip, no rune glyph map (E3) */
  ownMask: boolean;
  /** hp fraction of the previous frame, and seconds since the last hp drop (E3 hit clip; Infinity = none playing) */
  hpLast: number;
  hitT: number;
  /** r5: extras.emissiveCap of the model (alive / awakened emissive soft ceiling), null = none */
  emCap: [number, number] | null;
  /** r6: the piece bones of a stone whose extras carry `terrainRest` (the break follows the terrain under each piece); empty = none */
  pieceBones: Bone[];
  /** r6: the terrain offset (root space) last added to each piece bone; taken off again before the mixer runs (the mixer skips unchanged values) */
  terrainOff: Float32Array;
  /** r7 ship: each piece's eased sink weight (applyPieceRest `sinkW`) and the shatter time it was last advanced at */
  sinkW: Float32Array;
  sinkT: number;
  /** r6: extras.breakGlow (opacity factor of a tight break glow round the pile), null = today's break glow */
  breakGlow: number | null;
  /** r7: alive / awakened halo opacity factor (METIN_PALETTE_HALO for a bodyPalette stone, 1 otherwise) */
  haloK: number;
  /** r8 M8a: the xz push (root space, 2 per piece bone) last added out of static bodies (applyPieceRest `ext.offXZ`) */
  pushOff: Float32Array;
  /** r8 M8a: the pieces whose liquid cue fired in this break, and how many cues the break threw (<= SINK_CUES_PER_BREAK) */
  cued: Uint8Array;
  cues: number;
  /** r8 M8a: extras.typeWB of the model: how far the type's body colour is white-balanced against the zone light (0 = never) */
  wbK: number;
  /** r8 M8a: extras.breakEmber: the emissive the pieces keep after the break flash (0 = the r7 break: 0.2 from 0.45 s on) */
  ember: number;
  /** r9 M9b: extras.rest9: the piece radii (per piece bone, root units) and the eased push of render/metinRest9.ts; null = the r8 rest */
  rest9: { radii: Float32Array; pushCur: Float32Array } | null;
  /** r9 M9b: extras.breakHeat (0..1): the soft ground glow under the pile replaces the break billboard; null = the r8 break glow */
  heat: MetinGroundGlow | null;
  heatK: number;
  /** r10 M10b: extras.breakCold (a frost / lightning stone): a brief white-rune ground ring instead of the heat disc, a white (not orange) break flash */
  cold: boolean;
  /** r10 M10b: extras.sinkSteam: a piece sinking into lava throws a translucent steam plume with rising sparks (metinSinkCue 'steam') */
  steam: boolean;
}

export class MetinViews implements RenderSystem {
  readonly name = 'metins';
  /** assigned by the owner before each core.frame() */
  feed: MetinFeed | null = null;
  blobs: BlobShadows | null = null;
  /** world positions of live metins, for the owner (rings, camera hints) */
  readonly active: MetinView[] = [];

  /**
   * Compiles the materials under `obj` without blocking a frame (RenderWorld wires it to compileAsync with the HDR stand-in
   * target bound, like the crowd's streamed batches). Without it a streamed type's programs compile at its first draw.
   */
  warmSink: ((obj: Object3D) => Promise<unknown> | void) | null = null;

  private types: MetinLoadDef[] = [];
  /** 'stream' types still to fetch (type index, run-render second it is due) */
  private pending: { type: number; due: number }[] = [];
  /** run-render seconds since `load` (counts while the run draws) */
  private streamTime = 0;
  /** types fetched in the background (stream or on demand) whose programs are not compiled yet: warmed once they are in */
  private readonly awaiting = new Set<number>();
  /** type keys whose programs were compiled (load-time warm-up or compiled ahead) */
  private readonly warmed = new Set<string>();
  /** model id / glyph texture id → time (s) from which a background fetch may be (re)issued; Infinity while one is in flight */
  private readonly fetches = new Map<string, number>();
  /** textures of streamed models + glyphs, pushed to the GPU one per frame before their first appearance */
  private readonly uploads: Texture[] = [];
  private readonly slots = new Map<number, Slot>();
  private readonly glyphs = new Map<string, Texture>();
  /** type keys whose rune glyph could not be fetched: the stone appears without it rather than not at all */
  private readonly glyphMissing = new Set<string>();
  /**
   * One live material per distinct set of compiled programs (programSignature). Disposing the last user of a program deletes
   * it, and the next stone would compile it inside a frame, so retired metin materials are parked here instead - but only the
   * first of each kind: it grows with the number of program variants (a handful), not with the runs played.
   */
  private readonly warmKeep = new Map<string, Material>();
  private readonly glowTex = glowTexture();
  /** r9 M9b: the falloff of the break's ground glow (made with the first breakHeat stone) */
  private heatTex: Texture | null = null;
  /** r10 M10b: the ring falloff of a cold stone's break flash (made with the first breakCold stone) */
  private ringTex: Texture | null = null;
  private time = 0;
  private disposed = false;
  /** r8 M8a: the zone's static bodies and liquids for the break pieces (app/run.ts sets it at load; null = the r7 behaviour: rest test only) */
  restWorld: MetinRestWorld | null = null;
  /** r8 M8a: the pooled splash / ember cue of pieces that sink into a liquid (made at load, so the warm-up compiles it) */
  private cue: MetinSinkCue | null = null;
  /** r8 M8a: the light on the stones this frame (linear, sun + sky / ground fill) for the white balance of the type colours */
  private readonly light: [number, number, number] = [1, 1, 1];

  constructor(private readonly core: RenderCore) {}

  async load(types: readonly MetinLoadDef[]): Promise<void> {
    this.types = [...types];
    const assets = this.core.assets;
    const now = types.filter((t) => (t.load ?? 'now') === 'now');
    const ids = [...new Set(now.map((t) => t.modelId))];
    // a streamed type is due STREAM_LEAD s ahead of `at`, never before STREAM_DELAY: its stones share one GLB + a glyph each
    this.pending = [];
    this.awaiting.clear();
    this.streamTime = 0;
    this.types.forEach((t, type) => {
      if (t.load === 'stream') this.pending.push({ type, due: Math.max(STREAM_DELAY, (t.at ?? 0) - STREAM_LEAD) });
    });
    await assets.loadBatch(ids.map((id) => ({ kind: 'model' as const, id, hint: 'metin' as const })));
    // (a partial core, as in the unit tests and the dev demos, has no quality state: no cue there)
    if (!this.cue && !this.disposed && this.core.quality) this.cue = new MetinSinkCue(this.core.scene, this.core.quality.tier);
    // metin_stone shares one mesh; the per-type rune glyph is an optional emissive map (tex_metin_rune_<id minus 'metin_'>)
    await Promise.all(
      now.map(async (t) => {
        const texId = this.glyphId(t);
        if (texId) this.glyphs.set(t.key, this.prepareGlyph(await assets.loadTexture(texId)));
      }),
    );
  }

  /** texture id of a type's rune glyph, or null when it has none (only the shared stone model carries one) */
  private glyphId(t: MetinLoadDef): string | null {
    const texId = `tex_metin_rune_${t.key.replace(/^metin_/, '')}`;
    if (t.modelId !== 'metin_stone' || !this.core.assets.hasTexture(texId)) return null;
    // E3: a model with its own emissive mask (extras.glyph === false) has no use for the 13 glyph maps: they are never fetched for it
    return this.ownMask(t.modelId) ? null : texId;
  }

  /** the model is loaded and its scene extras say `glyph: false` (a loaded model is the only place the flag can be read) */
  private ownMask(modelId: string): boolean {
    const assets = this.core.assets;
    return assets.isModelLoaded(modelId) && assets.model(modelId).extras.glyph === false;
  }

  private prepareGlyph(tex: Texture): Texture {
    // idempotent: a glyph kept from an earlier run is already on the GPU in this layout
    if (tex.flipY || tex.colorSpace !== SRGBColorSpace) {
      tex.flipY = false;
      tex.colorSpace = SRGBColorSpace;
      tex.needsUpdate = true;
    }
    return tex;
  }

  /** a type can be drawn: its model is in and so is its glyph (or the glyph could not be had) */
  private ready(type: number): boolean {
    const def = this.types[type];
    if (!def || !this.core.assets.isModelLoaded(def.modelId)) return false;
    return this.glyphId(def) === null || this.glyphs.has(def.key) || this.glyphMissing.has(def.key);
  }

  /** Background fetch of a type's model and rune glyph (streamed, or a type that appeared before it arrived). */
  private fetchType(type: number): void {
    const def = this.types[type];
    if (!def || this.ready(type)) return;
    this.awaiting.add(type);
    this.fetchModel(def.modelId);
    // E3: whether a type needs its glyph is in the model's extras, so it is fetched once the model is in (the callback of
    // fetchModel does it for a model still in flight)
    if (this.core.assets.isModelLoaded(def.modelId)) this.fetchGlyph(def);
  }

  private fetchModel(id: string): void {
    const assets = this.core.assets;
    if (assets.isModelLoaded(id) || this.time < (this.fetches.get(id) ?? 0)) return;
    this.fetches.set(id, Infinity);
    assets.loadModel(id, 'metin').then(
      (model) => {
        this.fetches.delete(id);
        // models loaded with the run are uploaded by the load-time warm-up; a streamed one uploads ahead of its first frame
        const seen = new Set<Texture>();
        for (const mesh of model.meshes) {
          for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            for (const v of Object.values(mat)) if ((v as Texture | null)?.isTexture) seen.add(v as Texture);
          }
        }
        this.uploads.push(...seen);
        for (const type of this.awaiting) {
          const def = this.types[type];
          if (def && def.modelId === id) this.fetchGlyph(def);
        }
      },
      (err: unknown) => {
        this.fetches.set(id, this.time + RETRY_AFTER);
        console.warn(`[metins] model ${id} failed to load`, err);
      },
    );
  }

  private fetchGlyph(def: MetinLoadDef): void {
    const texId = this.glyphId(def);
    if (!texId || this.glyphs.has(def.key) || this.glyphMissing.has(def.key) || this.time < (this.fetches.get(texId) ?? 0)) return;
    this.fetches.set(texId, Infinity);
    this.core.assets.loadTexture(texId).then(
      (tex) => {
        this.fetches.delete(texId);
        this.glyphs.set(def.key, this.prepareGlyph(tex));
        this.uploads.push(tex);
      },
      (err: unknown) => {
        // a rune glyph is decoration: the stone must not wait for it forever
        this.fetches.delete(texId);
        this.glyphMissing.add(def.key);
        console.warn(`[metins] glyph ${texId} failed to load`, err);
      },
    );
  }

  /** The stand-in view the warm-ups draw (or compile) per type. */
  private warmView(type: number): MetinView {
    const f = this.core.rig.focus;
    return { id: -1 - type, type, x: f.x, z: f.z, phase: 1, phaseT: 5, hpFrac: 1, scale: 1, great: false, auraRadius: 4, warnLeft: 0 };
  }

  /**
   * Stream bookkeeping, once per drawn frame: issues the fetches that came due, uploads one texture to the GPU, and compiles
   * the programs of the types that arrived since (their materials cost a 100-300 ms compile at their first draw otherwise).
   */
  private pumpStream(dt: number): void {
    this.streamTime += dt;
    if (this.pending.length > 0 && this.pending.some((p) => p.due <= this.streamTime)) {
      const due = this.pending.filter((p) => p.due <= this.streamTime);
      this.pending = this.pending.filter((p) => p.due > this.streamTime);
      for (const p of due) this.fetchType(p.type);
    }
    const upload = this.uploads.shift();
    if (upload) this.core.renderer.initTexture(upload);
    if (this.awaiting.size === 0) return;
    const arrived: number[] = [];
    for (const type of this.awaiting) {
      if (!this.ready(type)) continue;
      this.awaiting.delete(type);
      const key = this.types[type]?.key;
      if (key !== undefined && !this.warmed.has(key)) arrived.push(type);
    }
    if (arrived.length > 0) this.warmAhead(arrived);
  }

  /** Compiles the programs of `types` on a detached copy of their stones (never in the scene), then retires the copy. */
  private warmAhead(types: number[]): void {
    const sink = this.warmSink;
    if (!sink) return;
    const holder = new Group();
    const temp: Slot[] = [];
    for (const type of types) {
      const s = this.create(this.warmView(type), holder);
      if (!s) continue;
      temp.push(s);
      this.warmed.add(s.key);
    }
    if (temp.length === 0) return;
    let compiling: Promise<unknown> | void = undefined;
    try {
      compiling = sink(holder);
    } catch (err) {
      console.warn('[metins] compile ahead failed', err);
    }
    // the materials must outlive the compile (three polls their programs until they are linked), then the copy is retired
    const done = (): void => this.retireSlots(temp);
    Promise.resolve(compiling).then(done, done);
  }

  /** Takes stand-in stones apart again; their materials go through `retire` (the first of each program kind is kept). */
  private retireSlots(slots: Slot[]): void {
    for (const s of slots) {
      s.mixer.stopAllAction();
      s.mixer.uncacheRoot(s.inst.root);
      s.root.parent?.remove(s.root);
      // the warm-up render created a GPU bone texture per stone skeleton: free it now
      for (const sm of s.inst.skinned) sm.skeleton.dispose();
      this.retire([...s.mats, s.glow.material as SpriteMaterial, s.trail.material as SpriteMaterial]);
      if (s.heat) { s.heat.dispose(); this.retire([s.heat.mesh.material as Material]); }
    }
  }

  /**
   * Disposes `mats`, parking the first material of each program kind in `warmKeep` instead: disposing the last user of a
   * program deletes it, which would undo the compile (and the next stone compiles it again, inside a frame). Duplicates share
   * the parked material's programs, so they can go; a material that never compiled anything has nothing to keep.
   */
  private retire(mats: Material[]): void {
    for (const m of mats) {
      const sig = this.disposed ? '' : programSignature(this.core.renderer, m);
      if (sig !== '' && !this.warmKeep.has(sig)) this.warmKeep.set(sig, m);
      else m.dispose();
    }
  }

  /**
   * Temporarily instantiates one stone per metin type at the camera focus so every program (stone variants with/without
   * glyph map, glow/trail sprites) compiles behind the loading screen. Returns the cleanup that removes them again.
   */
  addWarmSlots(): () => void {
    const f = this.core.rig.focus;
    const slots: Slot[] = [];
    this.types.forEach((_, type) => {
      const s = this.create(this.warmView(type));
      if (!s) return;
      s.root.position.set(f.x, f.y, f.z);
      slots.push(s);
    });
    return () => {
      // Remove the stones from the scene again. Their materials keep the compiled programs alive, so one per program kind is
      // parked in warmKeep (the rest are disposed): nothing accumulates from run to run.
      for (const s of slots) this.warmed.add(s.key);
      this.retireSlots(slots);
      // r8 M8a: the sink cue's two programs compiled with the stones; an empty pool is not drawn from now on
      this.cue?.release();
    };
  }

  private create(m: MetinView, parent: Object3D = this.core.scene): Slot | null {
    const def = this.types[m.type];
    if (!def || !this.ready(m.type)) return null;
    const inst = this.core.assets.instantiate(def.modelId);
    const ownMask = this.ownMask(def.modelId);
    const ex = ownMask ? this.core.assets.model(def.modelId).extras : null;
    const bodyTint = typeof ex?.bodyTint === 'number' ? ex.bodyTint : null;
    const capEx = ex?.emissiveCap;
    const emCap = parseEmissiveCap(capEx);
    const root = new Group();
    root.add(inst.root);
    const mats: Slot['mats'] = [];
    for (const mesh of inst.meshes) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material | undefined;
      if (mat && (mat as MeshStandardMaterial).isMeshStandardMaterial) {
        const clone = mat.clone() as MeshStandardMaterial;
        mesh.material = clone;
        clone.emissive.set(def.rune);
        // M4: a model with its own emissive mask has no per-type glyph map, so the 13 types are told apart by a 30 % albedo tint toward the type's rune colour
        // r5: a model with extras.bodyTint takes the per-type body colour (metinBodyTint) instead
        // r5 ship: MULTIPLIED into the GLB's own baseColorFactor (copy replaced it; every factor is 1 today, so nothing changes on screen)
        // r7: a model with extras.bodyPalette (its albedo's linear mean luminance) takes the per-type body colour of METIN_TYPE_BODY as a luminance-preserving
        // hue shift in the shader (no albedo multiply: no texel above METIN_TYPE_ALBEDO_CAP, the texture's own detail kept on every type)
        // r8 M8a: extras.typeBody = the model's own corrections of METIN_TYPE_BODY (measured in game under the four zone lights)
        const typeBody = ex?.typeBody && typeof ex.typeBody === 'object' ? (ex.typeBody as Record<string, string>) : null;
        const shift = typeof ex?.bodyPalette === 'number' ? metinTypeShift(def.rune, ex.bodyPalette, typeBody) : null;
        // r8 M8a: extras.veinCore (hot crack core), typeDetail (neutral-type texture), typeWB (zone-light white balance); absent = the r7 shift exactly
        const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        // r9 M9a: extras.veinBaked = the emissive texture carries the hot core (EMISSIVE_MAP_GLSL reads it back as the type's mask)
        if (ownMask && shift) applyTypeShift(clone, shift, { ref: typeof ex?.bodyPalette === 'number' ? ex.bodyPalette : 0, detail: metinTypeDetail(def.rune, num(ex?.typeDetail), typeBody), core: MathUtils.clamp(num(ex?.veinCore), 0, 1), wb: MathUtils.clamp(num(ex?.typeWB), 0, 1), baked: ex?.veinBaked === true });
        else if (ownMask) clone.color.multiply(bodyTint !== null ? metinBodyTint(def.rune, bodyTint) : runeTint(def.rune));
        const glyph = ownMask ? undefined : this.glyphs.get(def.key);
        if (glyph) clone.emissiveMap = glyph;
        mats.push(clone);
      }
    }
    const mixer = new AnimationMixer(inst.root);
    const actions = new Map<string, AnimationAction>();
    for (const clip of inst.clips) actions.set(clip.name.toLowerCase(), mixer.clipAction(clip));
    const rune = new Color(def.rune);
    const glow = new Sprite(
      new SpriteMaterial({ map: this.glowTex, color: rune, blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
    );
    const trail = new Sprite(
      new SpriteMaterial({ map: this.glowTex, color: new Color('#ff8a2a'), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
    );
    glow.renderOrder = 5;
    trail.renderOrder = 5;
    root.add(glow, trail);
    parent.add(root);
    const pieceBones = ownMask && ex?.terrainRest === true ? (inst.skinned[0]?.skeleton.bones ?? []).filter((b) => /^(chunk|frag|shard|core)_/.test(b.name)) : [];
    const breakGlow = ownMask && typeof ex?.breakGlow === 'number' && Number.isFinite(ex.breakGlow) ? MathUtils.clamp(ex.breakGlow, 0, 1) : null;
    const haloK = ownMask && typeof ex?.bodyPalette === 'number' ? METIN_PALETTE_HALO : 1;
    // r9 M9b: extras.rest9 (a terrainRest stone): each piece's own radius from its skinned vertices (once per model geometry)
    let rest9: Slot['rest9'] = null;
    const sk = inst.skinned[0];
    if (ownMask && ex?.rest9 === true && pieceBones.length && sk) {
      const all = metinPieceRadiiCached(sk.geometry, sk.skeleton, sk.bindMatrix);
      const radii = new Float32Array(pieceBones.length);
      pieceBones.forEach((b, i) => { radii[i] = all[sk.skeleton.bones.indexOf(b)] ?? 0.3; });
      rest9 = { radii, pushCur: new Float32Array(pieceBones.length * 2) };
    }
    // r9 M9b: extras.breakHeat: the ground glow (drawn with opacity 0 until the first break frame, so the warm-up compiles its program)
    const heatK = ownMask && typeof ex?.breakHeat === 'number' && Number.isFinite(ex.breakHeat) ? MathUtils.clamp(ex.breakHeat, 0, 1) : 0;
    let heat: MetinGroundGlow | null = null;
    // r10 M10b: extras.breakCold / sinkSteam (absent = the r9 behaviour exactly)
    const cold = ownMask && heatK > 0 && ex?.breakCold === true;
    const steam = ownMask && ex?.sinkSteam === true;
    if (heatK > 0) { heat = new MetinGroundGlow(cold ? (this.ringTex ??= ringTexture()) : (this.heatTex ??= heatTexture())); heat.addTo(parent); heat.mesh.visible = true; }
    return { id: m.id, type: m.type, key: def.key, root, inst, mixer, actions, current: null, mats, rune, glow, trail, maxWarn: Math.max(m.warnLeft, 0.1), seen: true, lastPhase: -1, breakFlash: 0, ownMask, hpLast: m.hpFrac, hitT: Infinity, emCap, pieceBones, terrainOff: new Float32Array(pieceBones.length), sinkW: new Float32Array(pieceBones.length), sinkT: 0, breakGlow, haloK, pushOff: new Float32Array(pieceBones.length * 2), cued: new Uint8Array(pieceBones.length), cues: 0, wbK: ownMask && typeof ex?.bodyPalette === 'number' && typeof ex.typeWB === 'number' && Number.isFinite(ex.typeWB) ? MathUtils.clamp(ex.typeWB, 0, 1) : 0, ember: ownMask && typeof ex?.breakEmber === 'number' && Number.isFinite(ex.breakEmber) ? MathUtils.clamp(ex.breakEmber, 0, 3) : 0, rest9, heat, heatK, cold, steam };
  }

  private drop(slot: Slot): void {
    slot.mixer.stopAllAction();
    slot.mixer.uncacheRoot(slot.inst.root);
    for (const sm of slot.inst.skinned) sm.skeleton.dispose(); // GPU bone texture (cloned skeleton is private to the slot)
    this.core.scene.remove(slot.root);
    // the last stone of a kind must not take its compiled programs with it: the next one would compile them in a frame
    this.retire([...slot.mats, slot.glow.material as SpriteMaterial, slot.trail.material as SpriteMaterial]);
    if (slot.heat) { slot.heat.dispose(); this.retire([slot.heat.mesh.material as Material]); }
  }

  private play(slot: Slot, name: string, t: number, loop: boolean): void {
    const a = slot.actions.get(name) ?? (name === 'pulse' ? slot.actions.get('idle') : undefined);
    if (!a) return;
    if (slot.current !== a) {
      slot.current?.stop();
      a.reset();
      a.setEffectiveWeight(1);
      a.play();
      a.paused = true;
      slot.current = a;
    }
    const d = a.getClip().duration;
    a.time = loop ? (d > 0 ? t % d : 0) : Math.min(t, d);
    slot.mixer.update(0);
  }

  update(dt: number, _alpha: number): void {
    this.time += dt;
    // r8 M8a: the sink cues fly on their own clock (a break's pieces sink while the feed may already be gone); the pool follows the quality tier
    if (this.cue) {
      this.cue.setTier(this.core.quality.tier);
      this.cue.update(dt, this.core.renderer);
    }
    const feed = this.feed;
    this.active.length = 0;
    if (!feed) {
      for (const s of this.slots.values()) s.seen = false;
      this.sweep();
      return;
    }
    for (const s of this.slots.values()) s.seen = false;
    // the run renders: the streamed types (the zone's stones, its great metin) arrive ahead of their wave, outside the
    // blocking zone load
    this.pumpStream(dt);
    const heightAt = this.core.heightAt;
    this.measureLight();
    for (const m of feed) {
      this.active.push(m);
      let slot = this.slots.get(m.id);
      if (!slot) {
        const created = this.create(m);
        if (!created) {
          this.fetchType(m.type); // not here yet: the slot appears once model and glyph are in
          continue;
        }
        slot = created;
        this.slots.set(m.id, slot);
      }
      slot.seen = true;
      this.drive(slot, m, dt, heightAt(m.x, m.z));
    }
    this.sweep();
  }

  private sweep(): void {
    for (const [id, s] of this.slots) {
      if (s.seen) continue;
      this.drop(s);
      this.slots.delete(id);
    }
  }

  /**
   * E3 (c): a stone with its own mask plays its `hit` clip (0.35 s) after every HP drop, then returns to idle / pulse. Returns true
   * while the hit clip drives the pose. Stones without the flag (every forge stone) never take this path.
   */
  private playHit(slot: Slot, m: MetinView, dt: number): boolean {
    if (!slot.ownMask) return false;
    if (m.hpFrac < slot.hpLast - 1e-4) slot.hitT = 0;
    slot.hpLast = m.hpFrac;
    const hit = slot.actions.get('hit');
    if (!hit || slot.hitT === Infinity) return false;
    const d = hit.getClip().duration || HIT_DUR_FALLBACK;
    if (slot.hitT >= d) {
      slot.hitT = Infinity;
      return false;
    }
    this.play(slot, 'hit', slot.hitT, false);
    slot.hitT += dt;
    return true;
  }

  /** r8 M8a: the light on the stones (linear): the sun at a half-lit side plus the sky / ground fill (Environment; the run arc moves both) */
  private measureLight(): void {
    const env = this.core.env as RenderCore['env'] | undefined;
    if (!env) return;
    const s = env.sun.color, si = env.sun.intensity * 0.5, h = env.hemi.color, g = env.hemi.groundColor, hi = env.hemi.intensity;
    this.light[0] = s.r * si + (0.65 * h.r + 0.35 * g.r) * hi;
    this.light[1] = s.g * si + (0.65 * h.g + 0.35 * g.g) * hi;
    this.light[2] = s.b * si + (0.65 * h.b + 0.35 * g.b) * hi;
  }

  /** r8 M8a: the type colour of a typeWB stone white-balanced against this frame's light (metinWhiteBalance), written into the shader's chroma in place */
  private balance(slot: Slot): void {
    if (!(slot.wbK > 0)) return;
    for (const mat of slot.mats) {
      const u = (mat.userData as { metinShift?: ShiftUniforms }).metinShift;
      if (!u) continue;
      const c = metinWhiteBalance([u.base.x, u.base.y, u.base.z], this.light, slot.wbK);
      u.chroma.set(c[0], c[1], c[2]);
    }
  }

  private drive(slot: Slot, m: MetinView, dt: number, groundY: number): void {
    this.balance(slot);
    const def = this.types[m.type];
    const scale = m.scale > 0 ? m.scale : 1;
    const t = this.time;
    const phase = m.phase;
    const pulseClip = slot.actions.get('pulse');
    const dropDur = slot.actions.get('drop')?.getClip().duration ?? DROP_DUR_FALLBACK;
    let y = groundY;
    let glowSize = 0;
    let glowAlpha = 0;
    let emissive = 0.4;
    // r5 ship: the damage ramp of this frame (1 = none), kept apart so a capped stone eases only its base glow (metinCappedEmissive)
    let ramp = 1;
    // 0 = the rune colour, 1 = white-hot orange: a falling stone burns, then cools over the landing clip
    let hot = 0;

    if (phase === 0) {
      slot.maxWarn = Math.max(slot.maxWarn, m.warnLeft);
      const p = MathUtils.clamp(1 - m.warnLeft / slot.maxWarn, 0, 1);
      const h = FALL_HEIGHT * (1 - p) ** 2.2;
      y = groundY + h;
      slot.root.rotation.y = t * 1.4;
      slot.root.rotation.z = 0.35 * (1 - p);
      this.play(slot, 'drop', 0, false);
      // the burning trail (flame head, fire streak, dark smoke) is the VFX layer's metin.fall; the stone itself glows hot orange
      glowSize = scale * 3.4 + 1.2;
      glowAlpha = 0.3 + 0.35 * p;
      emissive = 1.3 + 1.1 * p;
      hot = 1;
    } else {
      slot.root.rotation.z = 0;
      slot.root.rotation.y = 0;
      if (phase === 1) {
        if (m.phaseT < dropDur) {
          this.play(slot, 'drop', m.phaseT, false);
          const cool = 1 - m.phaseT / dropDur;
          emissive = 2.2 * cool + 1.0;
          hot = cool;
        } else {
          if (!this.playHit(slot, m, dt)) this.play(slot, 'idle', this.time, true);
          ramp = slot.ownMask ? metinDamageRamp(m.hpFrac) : 1;
          emissive = (1.15 + 0.35 * Math.sin(t * 2.2)) * ramp;
        }
        glowSize = scale * 3.2;
        glowAlpha = (0.28 + 0.1 * Math.sin(t * 2.2)) * slot.haloK;
      } else if (phase === 2) {
        if (!this.playHit(slot, m, dt)) this.play(slot, pulseClip ? 'pulse' : 'idle', this.time, true);
        const beat = 0.5 + 0.5 * Math.sin(t * 6);
        ramp = slot.ownMask ? metinDamageRamp(m.hpFrac) : 1;
        emissive = (1.7 + 1.3 * beat) * ramp;
        glowSize = scale * (4.2 + beat * 0.8);
        glowAlpha = (0.45 + 0.25 * beat) * slot.haloK;
        // an awakened stone smoulders blood red
        hot = 0.35;
      } else {
        // r6: the baked shatter rests every piece on the stone's own base height; a stone with extras.terrainRest has its pieces follow the terrain under them
        // (a piece that flies past a cliff edge or onto a bridge lands on that ground, not in the air), blended in while the pieces come down. Last frame's
        // offset comes off first: the mixer only writes a bone when its clip value changed (a resting pile would keep adding it).
        if (slot.pieceBones.length) this.unfollowTerrain(slot);
        this.play(slot, 'shatter', m.phaseT, false);
        if (slot.pieceBones.length) this.followTerrain(slot, m, scale, groundY);
        slot.breakFlash = Math.max(0, 1 - m.phaseT * 2.2);
        emissive = 2.4 * slot.breakFlash + 0.2;
        // r8 M8a: a stone with extras.breakEmber keeps its broken veins glowing while the pieces fly and settle (the interior reads), cooling to 0.2 at the clip end
        if (slot.ember > 0) emissive = Math.max(emissive, 0.2 + (slot.ember - 0.2) * (1 - MathUtils.smoothstep(m.phaseT, 0.6, 2.2)));
        glowSize = scale * (4 + m.phaseT * 3);
        glowAlpha = Math.max(0, 0.7 - m.phaseT * 0.5);
        // r6: a stone with extras.breakGlow keeps its break glow round the pile: the additive rune sprite no longer washes the whole screen in its colour
        if (slot.breakGlow !== null) { glowSize = scale * (3.2 + m.phaseT * 1.2); glowAlpha *= slot.breakGlow; }
        hot = slot.breakFlash * 0.6;
        // r9 M9b: a stone with extras.breakHeat lays the break's heat on the ground under the pile (MetinGroundGlow) instead of the billboard the pieces cut
        if (slot.heat) {
          // a lava stone (breakEmber) spills hot orange that cools with its veins; a cold stone spills its own rune light, gone by the time the pile settles
          // r10 M10b: a breakCold stone instead throws a brief ring of whitened rune light that sweeps out and is gone with the flash (metinBreakHeat)
          const bh = metinBreakHeat(m.phaseT, slot.breakFlash, slot.heatK, slot.ember, slot.cold);
          slot.heat.set(m.x, m.z, scale * bh.radius, this.core.heightAt, heatTmp.copy(slot.rune).lerp(HOT, bh.warm).lerp(COLD_WHITE, bh.white), bh.alpha);
          glowAlpha = 0;
        }
      }
    }
    if (slot.heat && phase !== 3) slot.heat.hide();
    slot.lastPhase = phase;

    slot.root.position.set(m.x, y, m.z);
    slot.root.scale.setScalar(scale);
    const gh = 1.4;
    slot.glow.position.set(0, gh, 0);
    // sprites inherit the root scale; compensate so `glowSize` is in metres
    if (slot.emCap && (phase === 1 || phase === 2)) glowSize *= 1 + (ramp - 1) * METIN_CAP_GLOW_SHARE;
    slot.glow.scale.setScalar(glowSize / scale);
    const gm = slot.glow.material as SpriteMaterial;
    gm.opacity = Math.min(1, glowAlpha);
    gm.color.copy(slot.rune).lerp(HOT, hot);
    // the old canvas "trail" blob is gone (metin.fall draws the trail); the sprite stays only so the programs / retire path are unchanged
    slot.trail.visible = false;
    // emissive colour: rune colour -> hot orange (and the awakened stone leans red)
    // r10 M10b: a breakCold stone's break flash whitens its own rune light instead (a frost / lightning stone never burns orange as it shatters)
    const flashTo = phase === 3 && slot.cold ? COLD_WHITE : HOT;
    for (const mat of slot.mats) mat.emissive.copy(slot.rune).lerp(flashTo, hot);
    // r5: the alive / awakened glow of a stone with extras.emissiveCap eases toward its ceiling (the hue survives the tone mapper); fall and break untouched
    // r5 ship: the cap eases the BASE glow only; the damage ramp rides on top (a share in the emissive, a share in the glow sprite above)
    const em = slot.emCap && (phase === 1 || phase === 2) ? metinCappedEmissive(emissive / ramp, ramp, slot.emCap[0], slot.emCap[1]) : emissive;
    for (const mat of slot.mats) mat.emissiveIntensity = em;
    if (this.blobs && phase !== 0) this.blobs.add(m.x, groundY, m.z, scale * 1.6 + 0.4, 0.9);
    else if (this.blobs && phase === 0) {
      const p = MathUtils.clamp(1 - m.warnLeft / slot.maxWarn, 0, 1);
      this.blobs.add(m.x, groundY, m.z, scale * (0.8 + 1.4 * p), 0.25 + 0.6 * p);
    }
  }

  /** r6 / r7: rests every piece bone on what is under it (terrain with a slope fit; lava, deep water and static bodies take the piece under the surface),
   *  weight 0 -> 1 over 0.3 .. 0.75 s, the sink over 0.45 .. 1.0 s (root space, so / scale). r8 M8a: with the run's restWorld every piece is also pushed out
   *  of the static bodies from the first frame of the break (it flies round a prop instead of through it), and a piece going under lava / deep water throws
   *  its splash / ember cue (at most SINK_CUES_PER_BREAK per break) */
  private followTerrain(slot: Slot, m: MetinView, scale: number, groundY: number): void {
    const w = MathUtils.smoothstep(m.phaseT, 0.3, 0.75);
    // r9 M9b: a new break (the first shatter frame, or the clip time went back) also drops the eased push of the last one
    if (slot.rest9 && (slot.lastPhase !== 3 || m.phaseT < slot.sinkT)) slot.rest9.pushCur.fill(0);
    if (w <= 0 || m.phaseT < slot.sinkT) { slot.sinkW.fill(0); slot.sinkT = m.phaseT; slot.cued.fill(0); slot.cues = 0; } // a new break starts with every piece above the surface
    const rw = this.restWorld;
    if (w <= 0 && !rw) return;
    // r7 ship: the sink weight of a piece changes by at most 1 per METIN_SINK_EASE s of shatter time (the first call after a reset takes the target as is)
    const first = slot.sinkT <= 0.3;
    const dtS = Math.max(0, m.phaseT - slot.sinkT);
    const step = first ? Infinity : dtS / METIN_SINK_EASE;
    slot.sinkT = m.phaseT;
    // r9 M9b: a rest9 stone: per-piece radii, stacked bodies and ledges, the eased push, the rise limit, the footprint liquid test, the readable cue
    if (slot.rest9 && rw) {
      // r9 ship (M9b critic MUST): the hero is a transient tall body of the break, so no settled piece sits over him or leans on his shoulder (the camera focus
      // is the local hero; it leads a running hero by a fraction of a metre, inside the disc's slack)
      const near9 = rw.bodiesNear9 ?? rw.bodiesNear;
      const f = this.core.rig.focus;
      const hero: MetinBody = { x: f.x, z: f.z, r: METIN_HERO_CLEAR_R, top: f.y + 2.2, y0: f.y - 1 };
      const bodies9: MetinRestWorld['bodiesNear'] = (x, z, r, cb) => {
        near9(x, z, r, cb);
        if (Math.hypot(x - hero.x, z - hero.z) < hero.r + r) cb(hero);
      };
      const ext9: PieceRest9 = {
        offXZ: slot.pushOff, pushCur: slot.rest9.pushCur, radii: slot.rest9.radii, bodiesNear: bodies9, liquidAt: rw.liquidAt, rootY: groundY,
        pushStep: first ? Infinity : REST9_PUSH_SPEED * dtS, cued: slot.cued,
        onSink: (_i, wx, wz) => {
          const kind = rw.liquidAt(wx, wz);
          if (!this.cue || (kind !== SINK_LAVA && kind !== SINK_WATER) || slot.cues >= SINK_CUES_PER_BREAK) return;
          slot.cues++;
          // r10 M10b: extras.sinkSteam -> the translucent steam plume with rising sparks at the piece (lava; water keeps the readable cue)
          this.cue.emit(kind, wx, rw.liquidY(wx, wz), wz, 0.45 * scale, slot.steam ? 'steam' : true);
        },
      };
      applyPieceRest9(slot.pieceBones, slot.terrainOff, m.x, m.z, slot.root.rotation.y, scale, groundY, w, MathUtils.smoothstep(m.phaseT, 0.45, 1.0), this.core.heightAt, slot.sinkW, step, ext9);
      return;
    }
    const ext: PieceRestExt | undefined = rw
      ? {
          offXZ: slot.pushOff,
          bodiesNear: rw.bodiesNear,
          rootY: groundY,
          pieceR: 0.3,
          cued: slot.cued,
          onSink: (_i, wx, wz) => {
            const kind = rw.liquidAt(wx, wz);
            if (!this.cue || (kind !== SINK_LAVA && kind !== SINK_WATER) || slot.cues >= SINK_CUES_PER_BREAK) return;
            slot.cues++;
            this.cue.emit(kind, wx, rw.liquidY(wx, wz), wz, 0.45 * scale);
          },
        }
      : undefined;
    applyPieceRest(slot.pieceBones, slot.terrainOff, m.x, m.z, slot.root.rotation.y, scale, groundY, w, MathUtils.smoothstep(m.phaseT, 0.45, 1.0), this.core.heightAt, this.core.restAt, slot.sinkW, step, ext);
  }

  /** r6: takes last frame's terrain offsets off the piece bones again (before the mixer writes the clip pose); r8 M8a: and the push out of static bodies */
  private unfollowTerrain(slot: Slot): void {
    clearPieceRest(slot.pieceBones, slot.terrainOff, slot.pushOff);
  }

  dispose(): void {
    this.disposed = true;
    this.cue?.dispose();
    this.cue = null;
    this.restWorld = null;
    for (const s of this.slots.values()) this.drop(s);
    this.slots.clear();
    this.glowTex.dispose();
    this.heatTex?.dispose();
    this.heatTex = null;
    this.ringTex?.dispose();
    this.ringTex = null;
    for (const m of this.warmKeep.values()) m.dispose();
    this.warmKeep.clear();
    this.uploads.length = 0;
    this.pending = [];
    this.awaiting.clear();
  }
}
